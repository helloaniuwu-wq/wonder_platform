import {
  getAssetMetadata,
  getDividendHistory,
  getDividendMetrics,
  getFxRate,
  getHistoricalPrice,
  getHistoricalSeries,
  getMarketData,
  guessCurrencyFromIsin,
  resolveAssetCurrency,
} from "./dataProvider";

export interface Transaction {
  id?: number;
  date: string;
  isin: string;
  type: string;
  shares: number;
  price: number;
  batch_id?: string | null;
  notes?: string | null;
}

export interface PortfolioMeta {
  id: number;
  name: string;
  base_currency: string;
  dividend_strategy: string;
  target_allocations: Record<string, number>;
  created_at: string;
}

export interface HoldingItem {
  isin: string;
  name: string;
  sector: string;
  country: string;
  shares: number;
  price: number;
  market_value: number;
  total_cost: number;
  dividends: number;
  pnl: number;
  yield: number;
  weight?: number;
  target_weight?: number;
  rebalance_diff?: number;
}

function resolveCashFlowAmount(shares: number, price: number): number {
  // 兼容旧版 /portfolios/new 误将金额写入 shares 且 price=1.0 的历史 CASH_IN 记录
  if (shares > 1 && Math.abs(price) === 1) {
    return shares * price;
  }
  return price;
}

export class PortfolioEngine {
  db: D1Database;
  portfolioId: number;
  meta!: PortfolioMeta;
  transactions: Transaction[] = [];

  /**
   * 累计「已派发」分红，按 ISIN 归集、统一折算为组合基准币。
   * 与 total_div_cash 的区别：total_div_cash 只统计进现金账户的分红，用于避免
   * REINVEST 的 PnL 双计；本字段无论 CASH / REINVEST 都统计，供报告展示 Total Dividends。
   */
  dividendsReceivedBase: Record<string, number> = {};

  constructor(db: D1Database, portfolioId: number) {
    this.db = db;
    this.portfolioId = portfolioId;
  }

  static async clearStatsCache(db: D1Database, portfolioId: number): Promise<void> {
    try {
      if (db && typeof db.prepare === "function") {
        await db.prepare("DELETE FROM portfolio_stats_cache WHERE portfolio_id = ?").bind(portfolioId).run();
      }
    } catch {
      // ignore if cache table doesn't exist
    }
  }

  async init() {
    const row = await this.db
      .prepare(
        "SELECT id, name, dividend_strategy, target_allocations, created_at, base_currency FROM portfolios WHERE id = ?"
      )
      .bind(this.portfolioId)
      .first<any>();

    if (row) {
      let targets: Record<string, number> = {};
      if (row.target_allocations) {
        try {
          targets = JSON.parse(row.target_allocations);
        } catch {}
      }
      this.meta = {
        id: Number(row.id),
        name: row.name,
        base_currency: row.base_currency || "USD",
        dividend_strategy: row.dividend_strategy || "CASH",
        target_allocations: targets,
        created_at: row.created_at || new Date().toISOString().slice(0, 10),
      };
    } else {
      this.meta = {
        id: this.portfolioId,
        name: "Unknown",
        base_currency: "USD",
        dividend_strategy: "CASH",
        target_allocations: {},
        created_at: new Date().toISOString().slice(0, 10),
      };
    }

    const { results } = await this.db
      .prepare(
        "SELECT date, isin, type, shares, price FROM transactions WHERE portfolio_id = ? ORDER BY date ASC, id ASC"
      )
      .bind(this.portfolioId)
      .all<any>();

    this.transactions = (results || []).map((t) => ({
      date: t.date,
      isin: String(t.isin || "").trim(),
      type: String(t.type || "").toUpperCase(),
      shares: Number(t.shares || 0),
      price: Number(t.price || 0),
    }));
  }

  /**
   * 步骤一：仅根据 transactions 重建持仓与现金（不含任何分红派发）。
   * 单独拆出来，供 getDividendDetails 反查建仓时使用，避免与 getCurrentPortfolio 相互递归。
   */
  async buildBaseHoldings(asOfDate?: string): Promise<{
    portfolio: Record<string, { shares: number; avg_cost: number; total_cost: number; total_div_cash: number }>;
    cashBalances: Record<string, number>;
  }> {
    const portfolio: Record<string, { shares: number; avg_cost: number; total_cost: number; total_div_cash: number }> =
      {};
    const cashBalances: Record<string, number> = {};
    const baseCcy = (this.meta.base_currency || "USD").toUpperCase();
    const baseKey = `CASH_${baseCcy}`;
    const cutoff = asOfDate?.slice(0, 10);
    const ledger = cutoff ? this.transactions.filter((t) => t.date <= cutoff) : this.transactions;

    for (const row of ledger) {
      const isin = row.isin;
      const q = row.shares;
      const p = row.price;
      const t = row.type;

      if (t === "CASH_IN") {
        const cKey = isin.startsWith("CASH_") ? isin : "CASH_USD";
        cashBalances[cKey] = (cashBalances[cKey] || 0) + resolveCashFlowAmount(q, p);
        continue;
      }
      if (t === "CASH_OUT") {
        const cKey = isin.startsWith("CASH_") ? isin : "CASH_USD";
        cashBalances[cKey] = (cashBalances[cKey] || 0) + resolveCashFlowAmount(q, p); // p already negative for outflows
        continue;
      }

      if (!portfolio[isin]) {
        portfolio[isin] = { shares: 0, avg_cost: 0, total_cost: 0, total_div_cash: 0 };
      }
      const curr = portfolio[isin];

      if (t === "BUY") {
        const cashNeeded = q * p;
        const currency = (await resolveAssetCurrency(this.db, isin)).toUpperCase();
        const cKey = `CASH_${currency}`;
        if (cKey !== baseKey) {
          const availForeign = Math.max(0, cashBalances[cKey] || 0);
          const shortfallForeign = Math.max(0, cashNeeded - availForeign);
          const availBase = cashBalances[baseKey] || 0;
          if (shortfallForeign > 0 && availBase > 0) {
            const fxAssetToBase = await getFxRate(this.db, currency, baseCcy);
            if (fxAssetToBase > 0) {
              const neededBase = shortfallForeign * fxAssetToBase;
              const convertBase = Math.min(availBase, neededBase);
              const convertedForeign = convertBase / fxAssetToBase;
              cashBalances[baseKey] = availBase - convertBase;
              cashBalances[cKey] = (cashBalances[cKey] || 0) + convertedForeign;
            }
          }
        }
        cashBalances[cKey] = (cashBalances[cKey] || 0) - cashNeeded;
        if (Math.abs(cashBalances[cKey] || 0) < 1e-6) {
          cashBalances[cKey] = 0;
        }
        if (cashBalances[baseKey] !== undefined && Math.abs(cashBalances[baseKey]) < 1e-6) {
          cashBalances[baseKey] = 0;
        }
        const newShares = curr.shares + q;
        if (newShares > 0) {
          curr.avg_cost = (curr.shares * curr.avg_cost + q * p) / newShares;
        }
        curr.shares = newShares;
      } else if (t === "SELL") {
        const cashGained = q * p;
        const currency = await resolveAssetCurrency(this.db, isin);
        const cKey = `CASH_${currency}`;
        cashBalances[cKey] = (cashBalances[cKey] || 0) + cashGained;
        curr.shares -= q;
      } else if (t === "DIV_CASH") {
        const currency = await resolveAssetCurrency(this.db, isin);
        const cKey = `CASH_${currency}`;
        const divAmt = q * p;
        const baseCcy = this.meta.base_currency || "USD";
        const fx = currency && currency !== baseCcy ? await getFxRate(this.db, currency, baseCcy) : 1;
        // total_div_cash 统一存基准币；现金账户仍按原币入账
        curr.total_div_cash += divAmt * fx;
        cashBalances[cKey] = (cashBalances[cKey] || 0) + divAmt;
      }
    }

    // 注意：手动/自动分红统一在 applyDividends() 里按「派发日持股数」入账，
    // 此处不再叠加，否则会与 getDividendDetails 的计算重复。
    const activeHoldings: Record<string, any> = {};
    for (const [isin, data] of Object.entries(portfolio)) {
      if (data.shares > 0 || data.total_div_cash > 0) {
        data.total_cost = data.shares * data.avg_cost;
        activeHoldings[isin] = data;
      }
    }

    return { portfolio: activeHoldings, cashBalances };
  }

  /**
   * 步骤二：把「已发生」的分红派发按派发日持股数入账。
   *
   * 与迁移前 Python 版 portfolio_engine 保持一致：
   * - Manual / CASH 策略：分红进现金账户，并累计进 total_div_cash（用于 Total Dividends 与 PnL）
   * - REINVEST 策略：按派发日收盘价折算为份额，不足 1 股部分留现金；
   *   分红已通过份额体现为市值，故不再重复计入 total_div_cash，避免 PnL 双计。
   *
   * 这是迁移到 TypeScript 时唯一漏掉的环节 —— 之前 total_divs 恒为 0、净值曲线末端跳空，
   * 根因都在这里。
   */
  async applyDividends(
    base: {
      portfolio: Record<string, { shares: number; avg_cost: number; total_cost: number; total_div_cash: number }>;
      cashBalances: Record<string, number>;
    },
    asOfDate?: string
  ) {
    const { portfolio, cashBalances } = base;
    const baseCcy = this.meta.base_currency || "USD";
    const cutoff = asOfDate?.slice(0, 10);
    let divs = await this.getDividendDetails(base);
    if (cutoff) divs = divs.filter((d) => d.date <= cutoff);

    this.dividendsReceivedBase = {};

    // getDividendDetails 为便于前端展示按日期倒序返回，入账必须按日期正序：
    // 否则 REINVEST 的下一期派发无法基于上一期折股后的持股数，复利会整体丢失。
    const ordered = [...divs].sort((a, b) => a.date.localeCompare(b.date));
    const reinvestExtraShares: Record<string, number> = {};

    for (const d of ordered) {
      const isin = d.isin;
      const ccy = d.currency || guessCurrencyFromIsin(isin);
      const cKey = `CASH_${ccy}`;
      const fx = ccy && ccy !== baseCcy ? await getFxRate(this.db, ccy, baseCcy) : 1;

      // DIV_CASH 交易已在 buildBaseHoldings 入账，这里只补展示口径，避免重复计入现金
      if (d.type === "Recorded") {
        this.dividendsReceivedBase[isin] =
          (this.dividendsReceivedBase[isin] || 0) + Number(d.total_amount || 0) * fx;
        continue;
      }

      // REINVEST 下本期派发应按「派发日持股 + 历次折股」计算
      const effectiveShares = d.shares_held + (reinvestExtraShares[isin] || 0);
      const amount = Math.round(d.amount_per_share * effectiveShares * 100) / 100;
      if (!(amount > 0)) continue;
      const amountBase = amount * fx;

      this.dividendsReceivedBase[isin] = (this.dividendsReceivedBase[isin] || 0) + amountBase;

      let holding = portfolio[isin];
      if (!holding) {
        // 资产已清仓也要入账：分红是真实收到的现金，与当前是否持有无关
        holding = { shares: 0, avg_cost: 0, total_cost: 0, total_div_cash: 0 };
        portfolio[isin] = holding;
      }

      const reinvest = d.type !== "Manual" && this.meta.dividend_strategy === "REINVEST";
      if (!reinvest) {
        holding.total_div_cash += amountBase; // 基准币
        cashBalances[cKey] = (cashBalances[cKey] || 0) + amount;
        continue;
      }

      const px = await getHistoricalPrice(this.db, isin, d.date);
      if (px > 0) {
        const buyShares = Math.floor(amount / px);
        if (buyShares > 0) {
          const prevCost = holding.shares * holding.avg_cost;
          holding.shares += buyShares;
          holding.avg_cost = (prevCost + buyShares * px) / holding.shares;
          reinvestExtraShares[isin] = (reinvestExtraShares[isin] || 0) + buyShares;
        }
        cashBalances[cKey] = (cashBalances[cKey] || 0) + (amount - buyShares * px);
      } else {
        // 拿不到派发日价格时退化为现金分红，避免整笔丢失
        holding.total_div_cash += amountBase;
        cashBalances[cKey] = (cashBalances[cKey] || 0) + amount;
      }
    }

    for (const data of Object.values(portfolio)) {
      data.total_cost = data.shares * data.avg_cost;
    }

    return base;
  }

  /** 对外统一入口：基础持仓 + 分红入账。传入 asOfDate 可做历史快照。 */
  async getCurrentPortfolio(asOfDate?: string) {
    const base = await this.buildBaseHoldings(asOfDate);
    return this.applyDividends(base, asOfDate);
  }

  async calculateNav(): Promise<{
    total_nav: number;
    wallet_balance: number;
    total_cost: number;
    total_pnl: number;
    total_divs: number;
    cumulative_roi: number;
    annualized_return: number;
    details: HoldingItem[];
    sector_allocation: Record<string, number>;
    country_allocation: Record<string, number>;
  }> {
    const { portfolio, cashBalances } = await this.getCurrentPortfolio();
    const baseCcy = this.meta.base_currency || "USD";

    let totalNav = 0;
    let walletBalance = 0;
    let totalCost = 0;
    let totalDivs = 0;
    const details: HoldingItem[] = [];

    // Process Cash
    for (const [cIsin, bal] of Object.entries(cashBalances)) {
      if (Math.abs(bal) < 0.01) continue;
      const ccy = cIsin.replace("CASH_", "");
      const fx = await getFxRate(this.db, ccy, baseCcy);
      const marketVal = bal * fx;
      if (Math.abs(marketVal) < 0.01) continue;
      walletBalance += marketVal;
      totalNav += marketVal;
      totalCost += marketVal;

      details.push({
        isin: cIsin,
        name: `Wallet (${ccy})`,
        sector: "Cash & Equivalents",
        country: "Global",
        shares: Math.round(bal * 100) / 100,
        price: fx,
        market_value: Math.round(marketVal * 100) / 100,
        total_cost: Math.round(marketVal * 100) / 100,
        dividends: 0,
        pnl: 0,
        yield: 0,
      });
    }

    // Process Stock/ETF Assets
    for (const [isin, data] of Object.entries(portfolio)) {
      if (data.shares <= 0) continue;

      const mData = await getMarketData(this.db, isin);
      const ccy = mData.currency || (await resolveAssetCurrency(this.db, isin));
      const fx = await getFxRate(this.db, ccy, baseCcy);
      let currPrice = mData.price * fx;

      if (currPrice === 0 && data.avg_cost > 0) {
        currPrice = data.avg_cost * fx;
      }

      const marketVal = data.shares * currPrice;
      const cost = data.total_cost * fx;
      // total_div_cash 已在入账时折算为基准币，此处不再二次乘汇率。
      // 它只含「进现金账户」的分红，REINVEST 的分红已体现在市值里，不重复计入收益率。
      const divTotal = data.total_div_cash;
      // 报告展示用：累计已派发分红（CASH 与 REINVEST 都统计）
      const divReceived = this.dividendsReceivedBase[isin] || 0;

      totalNav += marketVal;
      totalCost += cost;

      const pnl = marketVal - cost;
      const itemYield = cost > 0 ? ((marketVal + divTotal - cost) / cost) * 100 : 0;

      const meta = await getAssetMetadata(this.db, isin);
      const name = meta.name || mData.name || isin;
      const sector =
        typeof mData.sector === "string"
          ? mData.sector
          : typeof meta.sector === "string"
          ? meta.sector
          : Object.keys(meta.sector || {})[0] || "Unknown Sector";
      const country =
        typeof mData.country === "string"
          ? mData.country
          : typeof meta.country === "string"
          ? meta.country
          : Object.keys(meta.country || {})[0] || "Global";

      details.push({
        isin,
        name,
        sector,
        country,
        shares: Math.round(data.shares * 10000) / 10000,
        price: Math.round(currPrice * 10000) / 10000,
        market_value: Math.round(marketVal * 100) / 100,
        total_cost: Math.round(cost * 100) / 100,
        dividends: Math.round(divReceived * 100) / 100,
        pnl: Math.round(pnl * 100) / 100,
        yield: Math.round(itemYield * 100) / 100,
      });
    }

    // Weight and Rebalance targets
    for (const d of details) {
      d.weight = totalNav > 0 ? Math.round((d.market_value / totalNav) * 1000) / 10 : 0;
      const rawTarget = this.meta.target_allocations[d.isin];
      if (rawTarget != null) {
        // target_allocations 以小数存储（0.4 = 40%），而 weight 是百分数。
        // 旧代码直接相减，把 39.1 − 0.4 当成偏离度，单位错了一百倍。
        const n = Number(rawTarget) || 0;
        const targetPct = n <= 1 ? n * 100 : n; // 兼容历史里已存成百分数的行
        d.target_weight = Math.round(targetPct * 10) / 10;
        d.rebalance_diff = Math.round(((d.weight || 0) - targetPct) * 10) / 10;
      }
    }

    // Total Dividends = 全部已派发分红（含 REINVEST 折股、含已清仓资产），
    // 与净值/收益计算解耦，避免为了展示而把分红二次塞进 PnL。
    totalDivs = Object.values(this.dividendsReceivedBase).reduce((s, v) => s + v, 0);

    // 投入本金口径：净入金 = Σ CASH_IN − Σ CASH_OUT（按当时币种折算到基准币）。
    // 不能用「持仓成本 + 现金余额」，否则累计在账上的分红现金会被误当成新增本金，
    // 从而把 ROI / CAGR 系统性低估。
    let investedCapital = 0;
    let hasCashFlow = false;
    for (const tx of this.transactions) {
      if (tx.type !== "CASH_IN" && tx.type !== "CASH_OUT") continue;
      hasCashFlow = true;
      const ccy = tx.isin.startsWith("CASH_") ? tx.isin.slice(5) : baseCcy;
      const fx = ccy && ccy !== baseCcy ? await getFxRate(this.db, ccy, baseCcy) : 1.0;
      // CASH_OUT 的 price 本身已为负数，直接累加即可
      investedCapital += resolveCashFlowAmount(tx.shares, tx.price) * fx;
    }
    // 无入金记录时退回持仓成本，避免除零
    if (!hasCashFlow || investedCapital <= 0) {
      investedCapital = totalCost;
    }

    totalCost = investedCapital;
    const totalPnl = totalNav - totalCost;
    const cumulativeRoi = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

    // CAGR：净值已包含分红现金，不再二次叠加
    const firstTxDate = this.transactions[0]?.date ? new Date(this.transactions[0].date) : new Date();
    const daysElapsed = Math.max(1, (Date.now() - firstTxDate.getTime()) / (1000 * 3600 * 24));
    const yearsElapsed = daysElapsed / 365.25;
    let cagr = 0;
    if (yearsElapsed >= 0.1 && totalCost > 0 && totalNav > 0) {
      cagr = (Math.pow(totalNav / totalCost, 1 / yearsElapsed) - 1) * 100;
    } else {
      cagr = cumulativeRoi;
    }

    // Breakdown allocations
    const sectorMap: Record<string, number> = {};
    const countryMap: Record<string, number> = {};
    for (const d of details) {
      sectorMap[d.sector] = Math.round(((sectorMap[d.sector] || 0) + d.market_value) * 100) / 100;
      countryMap[d.country] = Math.round(((countryMap[d.country] || 0) + d.market_value) * 100) / 100;
    }

    // Update stats cache. 必须用 UPSERT 而非 INSERT OR REPLACE：
    // REPLACE 会把未列出的 historical_chart / dividend_history 清空，
    // 导致每次刷新后净值曲线消失、下一次读取只能重算。
    await this.db
      .prepare(
        `INSERT INTO portfolio_stats_cache (
          portfolio_id, total_nav, wallet_balance, total_pnl, total_divs,
          cumulative_roi, annualized_return, details, total_cost, last_updated
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(portfolio_id) DO UPDATE SET
          total_nav = excluded.total_nav,
          wallet_balance = excluded.wallet_balance,
          total_pnl = excluded.total_pnl,
          total_divs = excluded.total_divs,
          cumulative_roi = excluded.cumulative_roi,
          annualized_return = excluded.annualized_return,
          details = excluded.details,
          total_cost = excluded.total_cost,
          last_updated = excluded.last_updated`
      )
      .bind(
        this.portfolioId,
        Math.round(totalNav * 100) / 100,
        Math.round(walletBalance * 100) / 100,
        Math.round(totalPnl * 100) / 100,
        Math.round(totalDivs * 100) / 100,
        Math.round(cumulativeRoi * 100) / 100,
        Math.round(cagr * 100) / 100,
        JSON.stringify(details),
        Math.round(totalCost * 100) / 100,
        new Date().toISOString()
      )
      .run();

    return {
      total_nav: Math.round(totalNav * 100) / 100,
      wallet_balance: Math.round(walletBalance * 100) / 100,
      total_cost: Math.round(totalCost * 100) / 100,
      total_pnl: Math.round(totalPnl * 100) / 100,
      total_divs: Math.round(totalDivs * 100) / 100,
      cumulative_roi: Math.round(cumulativeRoi * 100) / 100,
      annualized_return: Math.round(cagr * 100) / 100,
      details,
      sector_allocation: sectorMap,
      country_allocation: countryMap,
    };
  }

  getSharesOnDate(isin: string, targetDate: string): number {
    let shares = 0;
    for (const tx of this.transactions) {
      if (tx.isin === isin && tx.date <= targetDate) {
        if (tx.type === "BUY") shares += tx.shares;
        else if (tx.type === "SELL") shares -= tx.shares;
      }
    }
    return Math.max(0, shares);
  }

  async getDividendDetails(baseHoldings?: {
    portfolio: Record<string, { shares: number; avg_cost: number; total_cost: number; total_div_cash: number }>;
    cashBalances: Record<string, number>;
  }): Promise<
    Array<{
      id?: number | null;
      isin: string;
      name?: string;
      date: string;
      type: "Manual" | "Auto" | "Recorded";
      amount_per_share: number;
      shares_held: number;
      total_amount: number;
      currency?: string;
    }>
  > {
    const list: Array<any> = [];
    const { portfolio } = baseHoldings ?? (await this.buildBaseHoldings());
    // 曾经在账本里出现过的资产都要参与分红计算，不能只看当前持仓：
    // 已清仓资产在持有期间派发的分红同样是真实收到的现金。
    const isins = Array.from(
      new Set([
        ...Object.keys(portfolio).filter((i) => !i.startsWith("CASH_")),
        ...this.transactions.map((t) => t.isin).filter((i) => i && !i.startsWith("CASH_")),
      ])
    );

    // 1. 手动分红 (Manual Dividends)
    const manRows = await this.db
      .prepare(
        "SELECT id, isin, date, amount_per_share, currency FROM manual_dividends WHERE portfolio_id = ? ORDER BY date ASC"
      )
      .bind(this.portfolioId)
      .all<any>();

    const manualDatesByIsin: Record<string, Set<string>> = {};

    for (const r of manRows.results || []) {
      const isin = r.isin;
      if (!manualDatesByIsin[isin]) manualDatesByIsin[isin] = new Set();
      manualDatesByIsin[isin].add(r.date);

      const sharesAtTime = this.getSharesOnDate(isin, r.date);
      const shares = sharesAtTime > 0 ? sharesAtTime : portfolio[isin]?.shares || 0;
      const meta = await getAssetMetadata(this.db, isin);
      const amtPerShare = Number(r.amount_per_share || 0);
      const total = Math.round(shares * amtPerShare * 100) / 100;

      list.push({
        id: r.id,
        date: r.date,
        isin,
        name: meta.name || isin,
        type: "Manual",
        shares_held: shares,
        amount_per_share: amtPerShare,
        total_amount: total,
        currency: r.currency || guessCurrencyFromIsin(isin),
      });
    }

    // 2. 自动分红 (Automatic Dividends from dividend_cache / Yahoo)
    const firstTxDate = this.transactions[0]?.date || "2020-01-01";
    const todayStr = new Date().toISOString().slice(0, 10);
    for (const isin of isins) {
      const blockedDates = manualDatesByIsin[isin] || new Set();
      const meta = await getAssetMetadata(this.db, isin);
      const divHistory = await getDividendHistory(this.db, isin, firstTxDate);

      for (const [dateStr, amt] of Object.entries(divHistory)) {
        if (blockedDates.has(dateStr)) continue;
        if (amt <= 0) continue;
        // 未来派发日尚未发生，不计入当期资产
        if (dateStr > todayStr) continue;

        const sharesAtTime = this.getSharesOnDate(isin, dateStr);
        if (sharesAtTime > 0) {
          const total = Math.round(sharesAtTime * amt * 100) / 100;
          list.push({
            id: null,
            date: dateStr,
            isin,
            name: meta.name || isin,
            type: "Auto",
            shares_held: sharesAtTime,
            amount_per_share: amt,
            total_amount: total,
            currency: guessCurrencyFromIsin(isin),
          });
        }
      }
    }

    // 3. 显式交易记录中类型为 DIV_CASH 的分红
    for (const tx of this.transactions) {
      if (tx.type === "DIV_CASH") {
        const meta = await getAssetMetadata(this.db, tx.isin);
        list.push({
          id: null,
          isin: tx.isin,
          name: meta.name || tx.isin,
          date: tx.date,
          type: "Recorded",
          amount_per_share: tx.price,
          shares_held: tx.shares,
          total_amount: Math.round(tx.shares * tx.price * 100) / 100,
          currency: guessCurrencyFromIsin(tx.isin),
        });
      }
    }

    return list.sort((a, b) => b.date.localeCompare(a.date));
  }

  async getDividendProjections(taxRate: number = 0.0, drip: boolean = false) {
    const { portfolio } = await this.getCurrentPortfolio();
    const isins = Object.keys(portfolio).filter((i) => !i.startsWith("CASH_") && portfolio[i].shares > 0);
    const baseCcy = this.meta.base_currency || "USD";

    // 12 months buckets
    const now = new Date();
    const projectionMonths: Record<string, number> = {};
    for (let i = 1; i <= 12; i++) {
      const future = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const mKey = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, "0")}`;
      projectionMonths[mKey] = 0;
    }

    // Manual dividends by ISIN
    const manDivs = await this.db
      .prepare(
        "SELECT id, isin, date, amount_per_share, currency FROM manual_dividends WHERE portfolio_id = ? ORDER BY date ASC"
      )
      .bind(this.portfolioId)
      .all<any>();
    const manByIsin: Record<string, Array<{ date: string; amount: number }>> = {};
    for (const r of manDivs.results || []) {
      if (!manByIsin[r.isin]) manByIsin[r.isin] = [];
      manByIsin[r.isin].push({ date: r.date, amount: Number(r.amount_per_share || 0) });
    }

    let totalAnnualIncome = 0;
    let totalMarketValue = 0;
    let totalCostBasis = 0;
    const assetsMetrics: any[] = [];
    const oneYearAgoStr = new Date(Date.now() - 365 * 86400 * 1000).toISOString().slice(0, 10);
    const todayStr = new Date().toISOString().slice(0, 10);

    for (const isin of isins) {
      const item = portfolio[isin];
      const initialShares = item.shares;
      const avgCost = item.avg_cost;

      const mData = await getMarketData(this.db, isin);
      const currPrice = mData.price || avgCost || 0;
      const assetCcy = mData.currency || guessCurrencyFromIsin(isin);
      const fx = await getFxRate(this.db, assetCcy, baseCcy);
      const basePrice = currPrice * fx;

      totalMarketValue += initialShares * basePrice;
      totalCostBasis += initialShares * avgCost * fx;

      const divMetrics = await getDividendMetrics(this.db, isin);
      let trailingSum = divMetrics.trailing_sum || 0;

      const histDivs = await getDividendHistory(this.db, isin, oneYearAgoStr);

      let isManual = false;
      let manualGrowthRate = 0;
      let manualFreqLabel = "";

      let events: Array<{ date: string; amount_per_share: number; type: string }> = [];
      const processedSlots = new Set<string>();

      if (divMetrics.next_date && divMetrics.next_amount) {
        const mKey = divMetrics.next_date.slice(0, 7);
        events.push({
          date: divMetrics.next_date,
          amount_per_share: divMetrics.next_amount,
          type: "Official",
        });
        processedSlots.add(mKey);
      }

      for (const [d, amt] of Object.entries(histDivs)) {
        if (amt > 0) {
          const dObj = new Date(d);
          dObj.setFullYear(dObj.getFullYear() + 1);
          const shiftedDate = dObj.toISOString().slice(0, 10);
          const mKey = shiftedDate.slice(0, 7);
          if (shiftedDate > todayStr && projectionMonths[mKey] !== undefined && !processedSlots.has(mKey)) {
            events.push({
              date: shiftedDate,
              amount_per_share: amt,
              type: "Projected",
            });
          }
        }
      }

      if (manByIsin[isin] && manByIsin[isin].length > 0) {
        isManual = true;
        const manList = manByIsin[isin];
        if (trailingSum === 0) {
          trailingSum = manList.reduce((sum, x) => sum + x.amount, 0);
        }

        const avgGap =
          manList.length > 1
            ? (new Date(manList[manList.length - 1].date).getTime() - new Date(manList[0].date).getTime()) /
              ((manList.length - 1) * 86400000)
            : 365;

        let freqDays = 365;
        if (avgGap <= 45) {
          freqDays = 30;
          manualFreqLabel = "Monthly";
        } else if (avgGap <= 120) {
          freqDays = 91;
          manualFreqLabel = "Quarterly";
        } else if (avgGap <= 250) {
          freqDays = 182;
          manualFreqLabel = "Semi-Annual";
        } else {
          freqDays = 365;
          manualFreqLabel = "Annual";
        }

        if (manList.length >= 2) {
          const rates: number[] = [];
          for (let k = 0; k < manList.length - 1; k++) {
            if (manList[k].amount > 0) {
              rates.push((manList[k + 1].amount - manList[k].amount) / manList[k].amount);
            }
          }
          if (rates.length > 0) {
            manualGrowthRate = Math.max(-0.5, Math.min(0.5, rates.reduce((a, b) => a + b, 0) / rates.length));
          }
        }

        let lastDate = new Date(manList[manList.length - 1].date);
        let currAmt = manList[manList.length - 1].amount * (1 + manualGrowthRate);
        const oneYearOut = new Date(Date.now() + 365 * 86400000);

        const manualFutureByMonth: Record<string, { date: string; amount_per_share: number; type: string }> = {};
        lastDate = new Date(lastDate.getTime() + freqDays * 86400000);
        while (lastDate <= oneYearOut) {
          const dStr = lastDate.toISOString().slice(0, 10);
          if (dStr > todayStr) {
            const mKey = dStr.slice(0, 7);
            if (projectionMonths[mKey] !== undefined) {
              manualFutureByMonth[mKey] = {
                date: dStr,
                amount_per_share: currAmt,
                type: "Manual Extrapolation",
              };
            }
          }
          currAmt *= 1 + manualGrowthRate;
          lastDate = new Date(lastDate.getTime() + freqDays * 86400000);
        }

        if (Object.keys(manualFutureByMonth).length > 0) {
          const eventsByMonth: Record<string, any> = {};
          for (const ev of events) eventsByMonth[ev.date.slice(0, 7)] = ev;
          Object.assign(eventsByMonth, manualFutureByMonth);
          events = Object.values(eventsByMonth);
        }
      }

      events.sort((a, b) => a.date.localeCompare(b.date));

      let currentShares = initialShares;
      let assetProjectedAnnualIncome = 0;
      const projectedIndividual: any[] = [];

      for (const ev of events) {
        const netAmtPerShare = ev.amount_per_share * (1 - taxRate) * fx;
        const payout = netAmtPerShare * currentShares;
        const mKey = ev.date.slice(0, 7);
        if (projectionMonths[mKey] !== undefined) {
          projectionMonths[mKey] += payout;
        }

        projectedIndividual.push({
          date: ev.date,
          amount: Math.round(payout * 100) / 100,
          type: ev.type,
        });
        assetProjectedAnnualIncome += payout;

        if (drip && currPrice > 0) {
          const localPayout = ev.amount_per_share * (1 - taxRate) * currentShares;
          currentShares += localPayout / currPrice;
        }
      }

      totalAnnualIncome += assetProjectedAnnualIncome;

      const localTrailingSum = trailingSum * (1 - taxRate);
      const currentYield = currPrice > 0 ? (localTrailingSum / currPrice) * 100 : 0;
      const yoc = avgCost > 0 ? (localTrailingSum / avgCost) * 100 : 0;

      const meta = await getAssetMetadata(this.db, isin);
      assetsMetrics.push({
        isin,
        name: meta.name || mData.name || isin,
        shares: Math.round((drip ? currentShares : initialShares) * 100) / 100,
        avg_cost: Math.round(avgCost * 100) / 100,
        curr_price: Math.round(currPrice * 100) / 100,
        trailing_div_per_share: Math.round(localTrailingSum * 10000) / 10000,
        current_yield: Math.round(currentYield * 100) / 100,
        yoc: Math.round(yoc * 100) / 100,
        est_annual_income: Math.round(assetProjectedAnnualIncome * 100) / 100,
        next_date: divMetrics.next_date,
        projections: projectedIndividual,
        source: isManual ? "manual_extrapolation" : trailingSum > 0 ? "auto" : "none",
        manual_freq: manualFreqLabel,
        manual_growth_pct: isManual ? Math.round(manualGrowthRate * 10000) / 100 : null,
      });
    }

    const chartData = Object.keys(projectionMonths)
      .sort()
      .map((m) => ({
        month: m,
        amount: Math.round(projectionMonths[m] * 100) / 100,
      }));

    // Historical past 5 years & 12 months dividends
    const historicalDividends: { monthly: any[]; annual: any[] } = { monthly: [], annual: [] };
    const histMonthlyMap: Record<string, number> = {};
    const histAnnualMap: Record<string, number> = {};

    const fiveYearsAgoStr = new Date(Date.now() - 5 * 365 * 86400000).toISOString().slice(0, 10);
    for (const isin of isins) {
      const shares = portfolio[isin].shares;
      const assetCcy = await resolveAssetCurrency(this.db, isin);
      const fx = await getFxRate(this.db, assetCcy, baseCcy);
      const divs = await getDividendHistory(this.db, isin, fiveYearsAgoStr);

      for (const [d, amt] of Object.entries(divs)) {
        const amtBase = amt * shares * fx;
        const yr = parseInt(d.slice(0, 4), 10);
        if (yr < now.getFullYear()) {
          histAnnualMap[yr] = (histAnnualMap[yr] || 0) + amtBase;
        }
        if (d >= oneYearAgoStr) {
          const mk = d.slice(0, 7);
          histMonthlyMap[mk] = (histMonthlyMap[mk] || 0) + amtBase;
        }
      }
    }

    historicalDividends.monthly = Object.keys(histMonthlyMap)
      .sort()
      .map((k) => ({ month: k, amount: Math.round(histMonthlyMap[k] * 100) / 100 }));

    historicalDividends.annual = Object.keys(histAnnualMap)
      .sort((a, b) => Number(b) - Number(a))
      .map((k) => ({ year: parseInt(k, 10), amount: Math.round(histAnnualMap[k] * 100) / 100 }));

    return {
      portfolio_metrics: {
        total_annual_income: Math.round(totalAnnualIncome * 100) / 100,
        portfolio_current_yield:
          totalMarketValue > 0 ? Math.round((totalAnnualIncome / totalMarketValue) * 10000) / 100 : 0,
        portfolio_yoc: totalCostBasis > 0 ? Math.round((totalAnnualIncome / totalCostBasis) * 10000) / 100 : 0,
      },
      chart_data: chartData,
      assets: assetsMetrics.sort((a, b) => b.est_annual_income - a.est_annual_income),
      historical_dividends: historicalDividends,
    };
  }

  async getHistoricalChartData(): Promise<Array<{ date: string; value: number }>> {
    const baseCcy = this.meta.base_currency || "USD";
    const uniqueIsins = Array.from(
      new Set(
        this.transactions
          .map((t) => t.isin)
          .filter((isin) => isin && !isin.startsWith("CASH_"))
      )
    );

    if (this.transactions.length === 0) {
      return [];
    }

    // 1. 起始时间
    const startDateStr = this.transactions.reduce(
      (min, t) => (t.date < min ? t.date : min),
      (this.meta.created_at || "2024-01-01").slice(0, 10)
    );
    const startDateObj = new Date(startDateStr);
    const todayObj = new Date();
    const daysSinceStart = Math.max(
      30,
      Math.ceil((todayObj.getTime() - startDateObj.getTime()) / (86400 * 1000)) + 15
    );

    // 2. 并行拉取所有持仓资产的原始净值/收盘价序列（useTotalReturn = false，因为步骤 3 已显式计入分红现金流）
    const historicalData: Record<string, Record<string, number>> = {};
    const sortedPriceDates: Record<string, string[]> = {};
    await Promise.all(
      uniqueIsins.map(async (isin) => {
        try {
          const rawSeries = await getHistoricalSeries(this.db, isin, daysSinceStart, false);
          historicalData[isin] = rawSeries;
          sortedPriceDates[isin] = Object.keys(rawSeries)
            .filter((dt) => dt > "1990-01-01" && rawSeries[dt] > 0)
            .sort();
        } catch {
          historicalData[isin] = {};
          sortedPriceDates[isin] = [];
        }
      })
    );

    // 3. 整合分红记录到现金流中
    const allDivs = await this.getDividendDetails();
    const combinedTx: Array<{ date: string; isin: string; type: string; shares: number; price: number }> = [
      ...this.transactions.map((t) => ({ ...t })),
    ];
    for (const d of allDivs) {
      combinedTx.push({
        date: d.date,
        isin: d.isin,
        type: "DIVIDEND",
        shares: d.shares_held,
        price: d.amount_per_share,
      });
    }
    combinedTx.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    // 4. 生成月末日期序列 (ME - Month End)
    const dates: string[] = [];
    dates.push(startDateStr);

    let cur = new Date(startDateObj.getFullYear(), startDateObj.getMonth() + 1, 0); // 首月末
    const todayStr = todayObj.toISOString().slice(0, 10);

    while (cur <= todayObj) {
      const curStr = cur.toISOString().slice(0, 10);
      if (curStr >= startDateStr && curStr <= todayStr) {
        dates.push(curStr);
      }
      cur = new Date(cur.getFullYear(), cur.getMonth() + 2, 0);
    }
    if (dates[dates.length - 1] !== todayStr) {
      dates.push(todayStr);
    }
    const uniqueDates = Array.from(new Set(dates)).sort();

    // 5. 逐月末推算投资组合净值 (现金 + 持仓市值)
    const dailyShares: Record<string, number> = {};
    uniqueIsins.forEach((isin) => (dailyShares[isin] = 0));
    let cash = 0;
    let txIdx = 0;
    const histChart: Array<{ date: string; value: number }> = [];

    // 计算每个资产买入均价以备兜底，并缓存资产币种
    const avgCosts: Record<string, number> = {};
    const isinCcyMap = new Map<string, string>();
    for (const isin of uniqueIsins) {
      isinCcyMap.set(isin, await resolveAssetCurrency(this.db, isin));
      const buys = this.transactions.filter((t) => t.isin === isin && t.type.toUpperCase() === "BUY");
      if (buys.length > 0) {
        const totalPaid = buys.reduce((s, b) => s + b.shares * b.price, 0);
        const totalShares = buys.reduce((s, b) => s + b.shares, 0);
        avgCosts[isin] = totalShares > 0 ? totalPaid / totalShares : 0;
      } else {
        avgCosts[isin] = 0;
      }
    }

    for (const d of uniqueDates) {
      while (txIdx < combinedTx.length && combinedTx[txIdx].date <= d) {
        const row = combinedTx[txIdx];
        const t = row.type.toUpperCase();
        const p = Number(row.price || 0);
        const q = Number(row.shares || 0);
        const isin = row.isin;

        let fx = 1.0;
        if (isin.startsWith("CASH_")) {
          const ccy = isin.split("_")[1] || "USD";
          if (ccy !== baseCcy) {
            fx = await getFxRate(this.db, ccy, baseCcy);
          }
        } else {
          const isinCcy = isinCcyMap.get(isin) || (await resolveAssetCurrency(this.db, isin));
          if (isinCcy && isinCcy !== baseCcy) {
            fx = await getFxRate(this.db, isinCcy, baseCcy);
          }
        }

        // CASH_OUT 的 price 本身已是负数（与 buildBaseHoldings / investedCapital 口径一致），
        // 必须直接累加；写成 cash -= p 会把出金反过来做成入金。
        if (t === "CASH_IN" || t === "CASH_OUT") cash += resolveCashFlowAmount(q, p) * fx;
        else if (t === "DIVIDEND") {
          const divAmt = q * p;
          if (this.meta.dividend_strategy === "REINVEST") {
            // 再投资分红不进现金，按派发日价格折成份额，否则曲线会低估复利
            const px = historicalData[isin]?.[d] || avgCosts[isin] || 0;
            if (px > 0) {
              const addShares = Math.floor(divAmt / px);
              dailyShares[isin] = (dailyShares[isin] || 0) + addShares;
              cash += (divAmt - addShares * px) * fx;
            } else {
              cash += divAmt * fx;
            }
          } else {
            cash += divAmt * fx;
          }
        } else if (t === "BUY" && !isin.startsWith("CASH_")) {
          cash -= q * p * fx;
          dailyShares[isin] = (dailyShares[isin] || 0) + q;
        } else if (t === "SELL" && !isin.startsWith("CASH_")) {
          cash += q * p * fx;
          dailyShares[isin] = Math.max(0, (dailyShares[isin] || 0) - q);
        }
        txIdx++;
      }

      let dailyNav = cash;
      for (const isin of uniqueIsins) {
        const shares = dailyShares[isin] || 0;
        if (shares > 0) {
          const prices = historicalData[isin] || {};
          let price = prices[d];

          // 从预排序历史日期中二分查找 <= d 的最近有效交易日收盘价（无 40 天窗口截断）
          if (!price || price <= 0) {
            const availDates = sortedPriceDates[isin] || [];
            let lo = 0;
            let hi = availDates.length - 1;
            let bestDate = "";
            while (lo <= hi) {
              const mid = (lo + hi) >> 1;
              if (availDates[mid] <= d) {
                bestDate = availDates[mid];
                lo = mid + 1;
              } else {
                hi = mid - 1;
              }
            }
            if (bestDate && prices[bestDate] > 0) {
              price = prices[bestDate];
            }
          }

          // 仅在完全没有任何历史行情时回退至买入成本，保留真实市价波动与派息除权曲线
          const avgCost = avgCosts[isin] || 0;
          if (!price || price <= 0) {
            if (avgCost > 0) price = avgCost;
          }

          if (price && price > 0) {
            const isinCcy = isinCcyMap.get(isin) || (await resolveAssetCurrency(this.db, isin));
            let pFx = 1.0;
            if (isinCcy && isinCcy !== baseCcy) {
              pFx = await getFxRate(this.db, isinCcy, baseCcy);
            }
            dailyNav += shares * price * pFx;
          }
        }
      }

      if (dailyNav <= 0 && cash > 0) {
        dailyNav = cash;
      }

      histChart.push({ date: d, value: Math.round(dailyNav * 100) / 100 });
    }

    // 6. 今日最新 live NAV 校准
    try {
      const live = await this.calculateNav();
      const todayNav = Math.round(Number(live.total_nav || 0) * 100) / 100;
      if (todayNav > 0) {
        if (histChart.length > 0 && histChart[histChart.length - 1].date === todayStr) {
          histChart[histChart.length - 1].value = todayNav;
        } else {
          histChart.push({ date: todayStr, value: todayNav });
        }
      }
    } catch {
      // ignore
    }

    return histChart;
  }

  /** 再平衡 Step 1：按指定日期（或实时）返回各持仓的市值与权重 */
  async getCurrentWeights(asOfDate?: string) {
    const { portfolio } = await this.getCurrentPortfolio(asOfDate);
    const rows: Array<{
      isin: string;
      name: string;
      shares: number;
      price: number;
      currency: string;
      market_value_usd: number;
      weight_pct: number;
    }> = [];
    let total = 0;

    for (const [isin, data] of Object.entries(portfolio)) {
      if (isin.startsWith("CASH_") || data.shares <= 0) continue;
      const px = asOfDate
        ? await getHistoricalPrice(this.db, isin, asOfDate)
        : (await getMarketData(this.db, isin)).price;
      if (!(px > 0)) continue;
      const ccy = await resolveAssetCurrency(this.db, isin);
      const fx = await getFxRate(this.db, ccy, "USD");
      const mv = data.shares * px * fx;
      const meta = await getAssetMetadata(this.db, isin);
      rows.push({
        isin,
        name: meta.name || isin,
        shares: Math.round(data.shares * 10000) / 10000,
        price: Math.round(px * 10000) / 10000,
        currency: ccy,
        market_value_usd: Math.round(mv * 100) / 100,
        weight_pct: 0,
      });
      total += mv;
    }
    for (const r of rows) {
      r.weight_pct = total > 0 ? Math.round((r.market_value_usd / total) * 10000) / 100 : 0;
    }
    rows.sort((a, b) => b.market_value_usd - a.market_value_usd);
    return {
      weights: rows,
      total_nav_usd: Math.round(total * 100) / 100,
      as_of_date: asOfDate || new Date().toISOString().slice(0, 10),
    };
  }

  /** 再平衡 Step 2：按目标权重生成交易清单（支持 AIA 4位小数份额与 ETF 整手/现金缓冲） */
  async getRebalancePreview(
    asOfDate?: string,
    options?: {
      wrapperType?: "AIA_TMP2" | "BROKER_ETF" | "HYBRID";
      cashBufferPct?: number;
      lotSizes?: Record<string, number>;
    }
  ) {
    const targets = this.meta.target_allocations || {};
    const baseCcy = this.meta.base_currency || "USD";
    const dateStr = asOfDate || new Date().toISOString().slice(0, 10);
    const wrapperType = options?.wrapperType || "AIA_TMP2";
    const cashBufferPct = options?.cashBufferPct ?? (wrapperType === "BROKER_ETF" ? 0.015 : 0);
    const empty = {
      trades: [] as any[],
      as_of_date: dateStr,
      base_currency: baseCcy,
      wrapper_type: wrapperType,
      total_nav_usd: 0,
      total_nav_base: 0,
      total_cash_usd: 0,
      total_cash_base: 0,
      cash_pct: 0,
    };
    if (Object.keys(targets).length === 0) return empty;

    const { portfolio, cashBalances } = await this.getCurrentPortfolio(asOfDate);
    const prices: Record<string, number> = {};
    const currencies: Record<string, string> = {};
    const fxRates: Record<string, number> = {};
    const assetMv: Record<string, number> = {};
    let totalAssets = 0;

    for (const [isin, data] of Object.entries(portfolio)) {
      if (isin.startsWith("CASH_") || data.shares <= 0) continue;
      const px = asOfDate
        ? await getHistoricalPrice(this.db, isin, asOfDate)
        : (await getMarketData(this.db, isin)).price;
      if (!(px > 0)) continue;
      prices[isin] = px;
      const ccy = await resolveAssetCurrency(this.db, isin);
      const fx = await getFxRate(this.db, ccy, baseCcy);
      currencies[isin] = ccy;
      fxRates[isin] = fx;
      const mv = data.shares * px * fx;
      assetMv[isin] = mv;
      totalAssets += mv;
    }

    let totalCashBase = 0;
    for (const [cIsin, bal] of Object.entries(cashBalances)) {
      const ccy = cIsin.replace("CASH_", "");
      const fx = await getFxRate(this.db, ccy, baseCcy);
      totalCashBase += bal * fx;
    }

    const totalValue = totalAssets + totalCashBase;
    if (!(totalValue > 0)) return empty;

    // 目标权重统一归一化为 0-1 小数（兼容历史里误存成 40 而非 0.4 的行）
    const normTarget = (v: unknown) => {
      const n = Number(v) || 0;
      return n <= 1 ? n : n / 100;
    };
    const targetSum = Object.values(targets).reduce((s, v) => s + normTarget(v), 0);
    const cashTargetWeight = Math.max(0, 1 - targetSum);
    const allIsins = new Set<string>([
      ...Object.keys(targets),
      ...Object.keys(portfolio).filter((i) => !i.startsWith("CASH_") && portfolio[i].shares > 0),
    ]);

    // 先处理 SELL 再评估可用现金（BROKER_ETF 模式保留现金缓冲 + 港股整手约束）
    const effectiveDeployBudget = Math.max(0, totalValue * (1 - cashBufferPct));
    const trades: any[] = [];
    for (const isin of allIsins) {
      const tw = normTarget(targets[isin]);
      let px = prices[isin];
      if (!(px > 0)) {
        px = asOfDate
          ? await getHistoricalPrice(this.db, isin, asOfDate)
          : (await getMarketData(this.db, isin)).price;
      }
      if (!(px > 0)) continue;
      const ccy = currencies[isin] || (await resolveAssetCurrency(this.db, isin));
      const fx = fxRates[isin] || (await getFxRate(this.db, ccy, baseCcy));
      const currentShares = portfolio[isin]?.shares || 0;
      const rawTargetShares = (effectiveDeployBudget * tw) / (px * fx);

      let targetShares: number;
      if (wrapperType === "BROKER_ETF" && isin.toUpperCase().endsWith(".HK")) {
        const lot = options?.lotSizes?.[isin] || 100;
        targetShares = Math.floor(rawTargetShares / lot) * lot;
      } else {
        targetShares = Math.round(rawTargetShares * 10000) / 10000;
      }

      const diff = Math.round((targetShares - currentShares) * 10000) / 10000;
      const diffNotionalBase = Math.abs(diff) * px * fx;
      if (Math.abs(diff) < 0.0001 || diffNotionalBase < 1) continue;

      const meta = await getAssetMetadata(this.db, isin);
      const amount = Math.abs(diff) * px;
      trades.push({
        isin,
        name: meta.name || isin,
        is_cash: false,
        action: diff > 0 ? "BUY" : "SELL",
        shares: Math.abs(diff),
        price: Math.round(px * 10000) / 10000,
        currency: ccy,
        amount: Math.round(amount * 100) / 100,
        amount_usd: Math.round(amount * fx * 100) / 100,
        current_weight: Math.round(((assetMv[isin] || 0) / totalValue) * 10000) / 100,
        target_weight: Math.round(tw * 10000) / 100,
      });
    }

    // 先卖后买排序
    trades.sort((a, b) => {
      if (a.action === b.action) return b.amount_usd - a.amount_usd;
      return a.action === "SELL" ? -1 : 1;
    });

    trades.push({
      isin: `CASH_${baseCcy}`,
      name: `Cash & Equivalents (${baseCcy})`,
      is_cash: true,
      action: cashTargetWeight > 0.01 ? "HOLD" : "DEPLOY",
      shares: null,
      price: null,
      currency: baseCcy,
      amount: Math.round(totalCashBase * 100) / 100,
      amount_usd: Math.round(totalCashBase * 100) / 100,
      current_weight: Math.round((totalCashBase / totalValue) * 10000) / 100,
      target_weight: Math.round(cashTargetWeight * 10000) / 100,
    });

    return {
      trades,
      as_of_date: dateStr,
      base_currency: baseCcy,
      wrapper_type: wrapperType,
      total_nav_usd: Math.round(totalValue * 100) / 100,
      total_nav_base: Math.round(totalValue * 100) / 100,
      total_cash_usd: Math.round(totalCashBase * 100) / 100,
      total_cash_base: Math.round(totalCashBase * 100) / 100,
      cash_pct: Math.round((totalCashBase / totalValue) * 10000) / 100,
    };
  }

  /** 再平衡执行：只写 BUY/SELL 并附带统一 batch_id，同时清理统计缓存 */
  async executeRebalance(
    asOfDate?: string,
    options?: { wrapperType?: "AIA_TMP2" | "BROKER_ETF" | "HYBRID"; batchId?: string; notes?: string }
  ) {
    const preview = await this.getRebalancePreview(asOfDate, { wrapperType: options?.wrapperType });
    const dateStr = asOfDate || new Date().toISOString().slice(0, 10);
    const batchId =
      options?.batchId || `reb_${dateStr.replace(/-/g, "")}_${crypto.randomUUID().slice(0, 8)}`;
    const notesStr = options?.notes || `Rebalance (${preview.wrapper_type || "AIA_TMP2"})`;
    const tradeRows = preview.trades.filter((t) => !t.is_cash && t.shares != null && t.price != null);

    if (tradeRows.length > 0) {
      try {
        const stmts = tradeRows.map((t) =>
          this.db
            .prepare(
              "INSERT INTO transactions (portfolio_id, date, isin, type, shares, price, batch_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
            )
            .bind(this.portfolioId, dateStr, t.isin, t.action, t.shares, t.price, batchId, notesStr)
        );
        await this.db.batch(stmts);
      } catch {
        // 兼容尚未执行 0008 迁移的本地库
        const stmts = tradeRows.map((t) =>
          this.db
            .prepare(
              "INSERT INTO transactions (portfolio_id, date, isin, type, shares, price) VALUES (?, ?, ?, ?, ?, ?)"
            )
            .bind(this.portfolioId, dateStr, t.isin, t.action, t.shares, t.price)
        );
        await this.db.batch(stmts);
      }
    }

    await PortfolioEngine.clearStatsCache(this.db, this.portfolioId);
    return { inserted: tradeRows.length, date: dateStr, batch_id: batchId };
  }
}
