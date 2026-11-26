import { describe, it, expect, vi, beforeEach } from "vitest";
import * as dataProvider from "./dataProvider";

// 只替换需要网络/D1 的行情函数，保留 guessCurrencyFromIsin 真实实现
vi.mock("./dataProvider", async (orig) => {
  const actual = await orig<typeof import("./dataProvider")>();
  return {
    ...actual,
    getFxRate: vi.fn(async (_db: unknown, from: string, to: string) => {
      if (from === to) return 1;
      if (from === "HKD" && to === "USD") return 0.128;
      return 1;
    }),
    getHistoricalPrice: vi.fn(async () => 0),
  };
});

import { PortfolioEngine, type Transaction } from "./portfolioEngine";

/** 构造一个无需真实 D1 的引擎：直接注入 meta 与流水 */
function makeEngine(
  txs: Transaction[],
  meta: Partial<PortfolioEngine["meta"]> = {}
): PortfolioEngine {
  const engine = new PortfolioEngine({} as D1Database, 1);
  engine.meta = {
    id: 1,
    name: "test",
    base_currency: "USD",
    dividend_strategy: "CASH",
    target_allocations: {},
    created_at: "2020-01-01",
    ...meta,
  };
  engine.transactions = txs;
  return engine;
}

const tx = (
  date: string,
  isin: string,
  type: string,
  shares: number,
  price: number
): Transaction => ({ date, isin, type, shares, price });

describe("PortfolioEngine.buildBaseHoldings", () => {
  it("两次买入按加权平均计算成本，并扣减现金", async () => {
    const engine = makeEngine([
      tx("2024-01-02", "VOO", "BUY", 10, 100),
      tx("2024-02-01", "VOO", "BUY", 10, 120),
    ]);

    const { portfolio, cashBalances } = await engine.buildBaseHoldings();

    expect(portfolio.VOO.shares).toBe(20);
    expect(portfolio.VOO.avg_cost).toBeCloseTo(110, 10);
    expect(portfolio.VOO.total_cost).toBeCloseTo(2200, 10);
    expect(cashBalances.CASH_USD).toBeCloseTo(-2200, 10);
  });

  it("卖出减少持股、现金入账，且不改变剩余持仓的平均成本", async () => {
    const engine = makeEngine([
      tx("2024-01-02", "VOO", "BUY", 10, 100),
      tx("2024-03-01", "VOO", "SELL", 4, 150),
    ]);

    const { portfolio, cashBalances } = await engine.buildBaseHoldings();

    expect(portfolio.VOO.shares).toBe(6);
    expect(portfolio.VOO.avg_cost).toBeCloseTo(100, 10);
    expect(cashBalances.CASH_USD).toBeCloseTo(-1000 + 600, 10);
  });

  it("CASH_IN / CASH_OUT 直接调整对应币种现金（出金价格已为负数）", async () => {
    const engine = makeEngine([
      tx("2024-01-01", "CASH_USD", "CASH_IN", 0, 5000),
      tx("2024-01-05", "CASH_USD", "CASH_OUT", 0, -1200),
      tx("2024-01-06", "CASH_HKD", "CASH_IN", 0, 800),
    ]);

    const { cashBalances, portfolio } = await engine.buildBaseHoldings();

    expect(cashBalances.CASH_USD).toBe(3800);
    expect(cashBalances.CASH_HKD).toBe(800);
    expect(Object.keys(portfolio)).toHaveLength(0);
  });

  it("港股按港币计价，买入扣减港币现金而非美元", async () => {
    const engine = makeEngine([tx("2024-01-02", "0005.HK", "BUY", 100, 60)]);

    const { cashBalances } = await engine.buildBaseHoldings();

    expect(cashBalances.CASH_HKD).toBe(-6000);
    expect(cashBalances.CASH_USD).toBeUndefined();
  });

  it("传入 asOfDate 时只统计该日期（含）之前的流水", async () => {
    const engine = makeEngine([
      tx("2024-01-02", "VOO", "BUY", 10, 100),
      tx("2024-06-01", "VOO", "BUY", 10, 200),
    ]);

    const { portfolio } = await engine.buildBaseHoldings("2024-03-31");

    expect(portfolio.VOO.shares).toBe(10);
    expect(portfolio.VOO.avg_cost).toBe(100);
  });

  it("清仓后不再出现在活跃持仓中", async () => {
    const engine = makeEngine([
      tx("2024-01-02", "VOO", "BUY", 10, 100),
      tx("2024-02-02", "VOO", "SELL", 10, 110),
    ]);

    const { portfolio } = await engine.buildBaseHoldings();

    expect(portfolio.VOO).toBeUndefined();
  });

  it("DIV_CASH 现金入账按原币，total_div_cash 统一折算为基准币", async () => {
    const engine = makeEngine([
      tx("2024-01-02", "0005.HK", "BUY", 100, 60),
      tx("2024-05-01", "0005.HK", "DIV_CASH", 100, 2), // 200 HKD
    ]);

    const { portfolio, cashBalances } = await engine.buildBaseHoldings();

    expect(cashBalances.CASH_HKD).toBeCloseTo(-6000 + 200, 10);
    expect(portfolio["0005.HK"].total_div_cash).toBeCloseTo(200 * 0.128, 10);
  });
});

type DivDetail = Awaited<ReturnType<PortfolioEngine["getDividendDetails"]>>[number];

const div = (date: string, isin: string, perShare: number, held: number, type: DivDetail["type"] = "Auto"): DivDetail => ({
  isin,
  date,
  type,
  amount_per_share: perShare,
  shares_held: held,
  total_amount: perShare * held,
  currency: "USD",
});

describe("PortfolioEngine.applyDividends", () => {
  beforeEach(() => {
    // 默认拿不到历史价格；需要折股的用例自行覆盖。放在 beforeEach 里避免失败用例污染后续
    vi.mocked(dataProvider.getHistoricalPrice).mockReset();
    vi.mocked(dataProvider.getHistoricalPrice).mockResolvedValue(0);
  });

  it("CASH 策略：分红进入现金并累计 total_div_cash，持股不变", async () => {
    const engine = makeEngine([tx("2024-01-02", "VOO", "BUY", 100, 100)]);
    vi.spyOn(engine, "getDividendDetails").mockResolvedValue([div("2024-06-01", "VOO", 1.5, 100)]);

    const base = await engine.buildBaseHoldings();
    const { portfolio, cashBalances } = await engine.applyDividends(base);

    expect(cashBalances.CASH_USD).toBeCloseTo(-10000 + 150, 10);
    expect(portfolio.VOO.total_div_cash).toBeCloseTo(150, 10);
    expect(portfolio.VOO.shares).toBe(100);
    expect(engine.dividendsReceivedBase.VOO).toBeCloseTo(150, 10);
  });

  it("REINVEST 策略：按派发日价格折股，不足 1 股部分留现金，且不计入 total_div_cash", async () => {
    vi.mocked(dataProvider.getHistoricalPrice).mockResolvedValue(40);
    const engine = makeEngine([tx("2024-01-02", "VOO", "BUY", 100, 100)], {
      dividend_strategy: "REINVEST",
    });
    vi.spyOn(engine, "getDividendDetails").mockResolvedValue([div("2024-06-01", "VOO", 1.5, 100)]); // 150 美元

    const base = await engine.buildBaseHoldings();
    const { portfolio, cashBalances } = await engine.applyDividends(base);

    // 150 / 40 = 3 股，剩余 30 美元留现金
    expect(portfolio.VOO.shares).toBe(103);
    expect(cashBalances.CASH_USD).toBeCloseTo(-10000 + 30, 10);
    expect(portfolio.VOO.total_div_cash).toBe(0);
    expect(engine.dividendsReceivedBase.VOO).toBeCloseTo(150, 10); // 展示口径仍计入
  });

  it("REINVEST 复利：按日期正序入账，第二期派发基于第一期折股后的持股数", async () => {
    // 两期派发日价格不同，保证入账顺序一旦错误，结果必然不同
    vi.mocked(dataProvider.getHistoricalPrice).mockImplementation(async (_db, _isin, date) =>
      date === "2024-06-01" ? 50 : 25
    );
    const engine = makeEngine([tx("2024-01-02", "VOO", "BUY", 100, 100)], {
      dividend_strategy: "REINVEST",
    });
    // getDividendDetails 实际按日期倒序返回，故意倒序传入以验证内部会重新排序
    vi.spyOn(engine, "getDividendDetails").mockResolvedValue([
      div("2024-09-01", "VOO", 1, 100),
      div("2024-06-01", "VOO", 1, 100),
    ]);

    const base = await engine.buildBaseHoldings();
    await engine.applyDividends(base);

    // 6 月：100 美元 / 50 = 2 股 -> 102 股；9 月：按 102 股得 102 美元 / 25 = 4 股 -> 106 股
    expect(base.portfolio.VOO.shares).toBe(106);
    expect(engine.dividendsReceivedBase.VOO).toBeCloseTo(100 + 102, 10);
  });

  it("拿不到派发日价格时退化为现金分红，避免整笔丢失", async () => {
    const engine = makeEngine([tx("2024-01-02", "VOO", "BUY", 100, 100)], {
      dividend_strategy: "REINVEST",
    });
    vi.spyOn(engine, "getDividendDetails").mockResolvedValue([div("2024-06-01", "VOO", 1, 100)]);

    const base = await engine.buildBaseHoldings();
    const { portfolio, cashBalances } = await engine.applyDividends(base);

    expect(portfolio.VOO.shares).toBe(100);
    expect(portfolio.VOO.total_div_cash).toBeCloseTo(100, 10);
    expect(cashBalances.CASH_USD).toBeCloseTo(-10000 + 100, 10);
  });

  it("已记录(Recorded)的分红只补展示口径，不重复入账现金", async () => {
    const engine = makeEngine([
      tx("2024-01-02", "VOO", "BUY", 100, 100),
      tx("2024-06-01", "VOO", "DIV_CASH", 100, 1),
    ]);
    vi.spyOn(engine, "getDividendDetails").mockResolvedValue([div("2024-06-01", "VOO", 1, 100, "Recorded")]);

    const base = await engine.buildBaseHoldings();
    const cashBefore = base.cashBalances.CASH_USD;
    const { cashBalances } = await engine.applyDividends(base);

    expect(cashBalances.CASH_USD).toBe(cashBefore);
    expect(engine.dividendsReceivedBase.VOO).toBeCloseTo(100, 10);
  });

  it("asOfDate 之后的分红不入账", async () => {
    const engine = makeEngine([tx("2024-01-02", "VOO", "BUY", 100, 100)]);
    vi.spyOn(engine, "getDividendDetails").mockResolvedValue([
      div("2024-03-01", "VOO", 1, 100),
      div("2024-09-01", "VOO", 1, 100),
    ]);

    const base = await engine.buildBaseHoldings("2024-06-30");
    const { portfolio } = await engine.applyDividends(base, "2024-06-30");

    expect(portfolio.VOO.total_div_cash).toBeCloseTo(100, 10);
  });

  it("CASH_IN 兼容 shares=1/price=金额 与旧版 shares=金额/price=1 两种写法", async () => {
    const standard = makeEngine([
      tx("2024-01-01", "CASH_USD", "CASH_IN", 1, 500000),
      tx("2024-01-01", "VOO", "BUY", 5000, 100),
    ]);
    const legacy = makeEngine([
      tx("2024-01-01", "CASH_USD", "CASH_IN", 500000, 1),
      tx("2024-01-01", "VOO", "BUY", 5000, 100),
    ]);

    const b1 = await standard.buildBaseHoldings();
    const b2 = await legacy.buildBaseHoldings();

    expect(b1.cashBalances.CASH_USD).toBeCloseTo(0, 6);
    expect(b2.cashBalances.CASH_USD).toBeCloseTo(0, 6);
  });

  it("AIA_TMP2 再平衡保留 4 位小数基金单位数，不被强制截断为整数", async () => {
    vi.mocked(dataProvider.getHistoricalPrice).mockResolvedValue(15.25);
    const engine = makeEngine(
      [
        tx("2024-01-01", "CASH_USD", "CASH_IN", 1, 10000),
        tx("2024-01-01", "F51", "BUY", 327.8689, 15.25), // 5000 USD
        tx("2024-01-01", "F02", "BUY", 327.8689, 15.25), // 5000 USD
      ],
      { target_allocations: { F51: 0.6, F02: 0.4 } }
    );
    vi.spyOn(engine, "getDividendDetails").mockResolvedValue([]);

    const preview = await engine.getRebalancePreview("2024-06-01", { wrapperType: "AIA_TMP2" });
    const f51Trade = preview.trades.find((t) => t.isin === "F51");
    expect(f51Trade).toBeDefined();
    expect(f51Trade.action).toBe("BUY");
    // 6000 / 15.25 = 393.4426 - 327.8689 = 65.5737 units (4 decimal precision preserved)
    expect(f51Trade.shares).toBeCloseTo(65.5737, 4);
    expect(Number.isInteger(f51Trade.shares)).toBe(false);
  });

  it("USD 组合入金后买入 CNY/HKD 资产时自动从 CASH_USD 结汇扣款，不产生虚高美元与负外币钱包", async () => {
    vi.mocked(dataProvider.getFxRate).mockImplementation(async (_db: unknown, from: string, to: string = "USD") => {
      if (from === to) return 1;
      if (from === "CNY" && to === "USD") return 0.15;
      if (from === "HKD" && to === "USD") return 0.128;
      return 1;
    });
    const engine = makeEngine([
      tx("2026-09-11", "CASH_USD", "CASH_IN", 1, 100000),
      tx("2026-09-11", "159545.SZ", "BUY", 100000, 1.0), // 100,000 CNY = 15,000 USD
      tx("2026-09-11", "2269.HK", "BUY", 1000, 50.0), // 50,000 HKD = 6,400 USD
    ]);

    const { cashBalances } = await engine.buildBaseHoldings();

    expect(cashBalances.CASH_CNY).toBe(0);
    expect(cashBalances.CASH_HKD).toBe(0);
    expect(cashBalances.CASH_USD).toBeCloseTo(100000 - 15000 - 6400, 4);
  });

  it("resolveAssetCurrency 在 prices 表存在历史污染 USD 时仍优先识别 .SZ/.SS/.HK 后缀币种", async () => {
    const fakeDb = {
      prepare: (sql: string) => ({
        bind: () => ({
          first: async () => {
            if (sql.includes("FROM wq_funds")) return null;
            if (sql.includes("FROM prices")) return { currency: "USD" };
            return null;
          },
        }),
      }),
    } as unknown as D1Database;

    await expect(dataProvider.resolveAssetCurrency(fakeDb, "159545.SZ")).resolves.toBe("CNY");
    await expect(dataProvider.resolveAssetCurrency(fakeDb, "515080.SS")).resolves.toBe("CNY");
    await expect(dataProvider.resolveAssetCurrency(fakeDb, "3690.hk")).resolves.toBe("HKD");
  });

  it("calculateNav 过滤绝对值 < 0.01 的灰尘钱包残余行", async () => {
    const fakeDb = {
      prepare: () => ({
        bind: () => ({
          first: async () => null,
          all: async () => ({ results: [] }),
          run: async () => ({}),
        }),
      }),
    } as unknown as D1Database;

    const engine = makeEngine([
      tx("2026-09-11", "CASH_USD", "CASH_IN", 1, 1000.004),
      tx("2026-09-11", "VOO", "BUY", 10, 100),
    ]);
    engine.db = fakeDb;
    vi.spyOn(engine, "getDividendDetails").mockResolvedValue([]);

    const nav = await engine.calculateNav();
    expect(nav.details.some((d) => d.isin.startsWith("CASH_"))).toBe(false);
    expect(nav.wallet_balance).toBe(0);
  });
});
