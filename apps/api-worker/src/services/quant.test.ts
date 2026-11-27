import { beforeEach, describe, expect, it, vi } from "vitest";
import { countBusinessDaysBetween, runQuantWatchdog } from "./quantWatchdog";
import {
  clearQuantStoreCaches,
  convertSeriesCurrency,
  getQuantFundSeries,
  loadQuantCatalog,
  normalizeMinorCurrency,
  resolveQuantFund,
  sanitizeQuantSeries,
  unpackSeriesDates,
} from "./quantStore";
import { getDividendMetrics } from "./fip/dataProvider";
import { StrategyLab, classifyAsset, createPrng } from "./fip/strategyLab";
import { PortfolioEngine } from "./fip/portfolioEngine";
import {
  buildCustomFundBaskets,
  buildTacticalCandidatePool,
  compareHomogeneousFunds,
  computeHoldingsOverlap,
  getFundDomicile,
  getHorizonEquityHardCap,
  getRiskEnvelope,
  hasUsEstateTaxConcern,
  inferFundRole,
  isHkBrokerEligibleFund,
  isHkBrokerLowFeeEtf,
  isIlasFund,
  isIrelandOrLuxembourgEtf,
  isIrelandOrLuxembourgFund,
  isUsMutualFund,
  matchClassicTemplates,
  normalizeProfile,
  resolveBasketUniverseMode,
  resolveEffectiveFundRole,
} from "./advisoryEngine";
import { DEFAULT_MACRO_SNAPSHOT, formatMacroPromptBlock } from "./macroStore";
import {
  buildDeterministicTacticalAdjustment,
  callLlmChat,
  extractAndNormalizeTacticalJson,
} from "./llm";
import {
  generateClientReportNarrative,
  generateWealthReportDocx,
  normalizeReportContext,
} from "./fip/reportGenerator";

// Minimal in-memory D1 mock tailored for Wonder Quant & Portfolio tables
function createMockD1(seed: {
  funds?: any[];
  metrics?: any[];
  series?: Record<string, any>;
  fx?: Record<string, any>;
  benchmarks?: Record<string, any>;
  heartbeat?: any;
  runs?: any[];
  portfolios?: any[];
  transactions?: any[];
  priceCache?: any[];
}) {
  const state = {
    heartbeat: seed.heartbeat ? { ...seed.heartbeat } : null,
  };

  const prepare = (sql: string) => {
    let bound: any[] = [];
    const stmt = {
      bind(...args: any[]) {
        bound = args;
        return stmt;
      },
      async first<T = any>(): Promise<T | null> {
        if (sql.includes("FROM wq_heartbeat")) {
          return (state.heartbeat as T) || null;
        }
        if (sql.includes("FROM wq_pipeline_runs")) {
          return ((seed.runs || [])[0] as T) || null;
        }
        if (sql.includes("FROM wq_fund_series")) {
          return (seed.series?.[bound[0]] as T) || null;
        }
        if (sql.includes("FROM wq_fx_series")) {
          return (seed.fx?.[bound[0]] as T) || null;
        }
        if (sql.includes("FROM wq_benchmark_series")) {
          return (seed.benchmarks?.[bound[0]] as T) || null;
        }
        if (sql.includes("FROM portfolios WHERE id")) {
          return ((seed.portfolios || []).find((p) => p.id === bound[0]) as T) || null;
        }
        if (sql.includes("FROM price_cache")) {
          const hit = (seed.priceCache || []).find((r) => r.isin === bound[0]);
          return (hit as T) || null;
        }
        return null;
      },
      async all<T = any>(): Promise<{ results: T[] }> {
        if (sql.includes("FROM wq_funds")) {
          const mMap = new Map((seed.metrics || []).map((m) => [m.slug, m]));
          const joined = (seed.funds || []).map((f) => ({ ...f, ...(mMap.get(f.slug) || {}) }));
          return { results: joined as T[] };
        }
        if (sql.includes("FROM transactions")) {
          return {
            results: (seed.transactions || []).filter((t) => t.portfolio_id === bound[0]) as T[],
          };
        }
        return { results: [] };
      },
      async run() {
        if (sql.includes("UPDATE wq_heartbeat") && state.heartbeat) {
          state.heartbeat.last_alert_sent_at = bound[0];
          state.heartbeat.last_alert_fingerprint = bound[1];
        }
        return { success: true, meta: { changes: 1 } };
      },
    };
    return stmt;
  };

  return { db: { prepare } as unknown as D1Database, state };
}

describe("quantWatchdog", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("counts weekday business days correctly across weekends", () => {
    // Fri 2026-11-20 -> Mon 2026-11-23 is 1 business day (Sat/Sun skipped)
    expect(countBusinessDaysBetween("2026-11-20", "2026-11-23")).toBe(1);
    // Mon 2026-11-16 -> Mon 2026-11-23 is 5 business days
    expect(countBusinessDaysBetween("2026-11-16", "2026-11-23")).toBe(5);
    expect(countBusinessDaysBetween("2026-11-23", "2026-11-23")).toBe(0);
  });

  it("stays healthy when heartbeat, fetch and AIA date are fresh", async () => {
    const { db } = createMockD1({
      heartbeat: {
        host_id: "desktop-0vi9ath",
        last_seen_at: "2026-11-23T12:00:00Z",
        last_fetch_ok_at: "2026-11-23T12:00:00Z",
        last_aia_val_date: "2026-11-19", // 2 bdays ago (tolerates up to 4)
      },
      runs: [{ run_id: "r1", status: "ok", failure_rate: 0.02, failed_funds: 6, total_funds: 306 }],
    });
    const rep = await runQuantWatchdog({ DB: db } as any, new Date("2026-11-23T14:00:00Z"));
    expect(rep.healthy).toBe(true);
    expect(rep.findings).toHaveLength(0);
  });

  it("triggers alerts on offline PC, stale pipeline, AIA lag >4 bdays & respects 6h cooldown", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok", { status: 200 }));
    const { db } = createMockD1({
      heartbeat: {
        host_id: "desktop-0vi9ath",
        last_seen_at: "2026-11-23T01:00:00Z", // 13h gap -> PC_OFFLINE
        last_fetch_ok_at: "2026-11-18T12:00:00Z", // 3 bdays -> PIPELINE_STALE
        last_aia_val_date: "2026-11-13", // 6 bdays -> AIA_VALUATION_LAG
      },
      runs: [{ run_id: "r2", status: "circuit_open", failure_rate: 0.35, failed_funds: 100, total_funds: 306 }],
    });
    const env = { DB: db, ALERT_WEBHOOK_URL: "https://example.test/webhook" } as any;
    const now = new Date("2026-11-23T14:00:00Z");

    const rep1 = await runQuantWatchdog(env, now);
    expect(rep1.healthy).toBe(false);
    expect(rep1.findings.map((f) => f.code).sort()).toEqual([
      "AIA_VALUATION_LAG",
      "FETCH_DEGRADED",
      "PC_OFFLINE",
      "PIPELINE_STALE",
    ]);
    expect(rep1.alertSent).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 2 hours later same findings -> suppressed by 6h cooldown
    const rep2 = await runQuantWatchdog(env, new Date("2026-11-23T16:00:00Z"));
    expect(rep2.suppressedByCooldown).toBe(true);
    expect(rep2.alertSent).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("quantStore & StrategyLab integration", () => {
  beforeEach(() => {
    clearQuantStoreCaches();
  });

  function buildSyntheticDates(n: number): string[] {
    const out: string[] = [];
    const cur = new Date("2024-01-02T00:00:00Z");
    while (out.length < n) {
      if (cur.getUTCDay() !== 0 && cur.getUTCDay() !== 6) {
        out.push(cur.toISOString().slice(0, 10));
      }
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return out;
  }

  it("resolves funds by slug/AIA code/ISIN, unpacks 1-row series, converts FX, and runs StrategyLab with frontier", async () => {
    const dates = buildSyntheticDates(120);
    const navA = dates.map((_, i) => Number((100 * Math.pow(1.00045, i) * (1 + 0.01 * Math.sin(i / 4))).toFixed(4)));
    const navB = dates.map((_, i) => Number((50 * Math.pow(1.0002, i) * (1 + 0.004 * Math.cos(i / 5))).toFixed(4)));
    const fxCny = dates.map(() => 0.14);

    const { db } = createMockD1({
      funds: [
        {
          slug: "Z01_F",
          code: "Z01",
          aia_code: "Z01",
          isin: "HK0000288743",
          name: "惠理高息股票基金",
          asset_class: "股票",
          ilas_platform: "AIA 卓达智悦2",
          currency: "USD",
          fee_pct: 1.25,
          benchmark_code: "2800.HK",
          primary_source: "aia_fundinfo2",
          data_tier: "B",
          is_trackable: 1,
          status: "active",
        },
        {
          slug: "CN_515080",
          code: "515080",
          cn_code: "sh515080",
          name: "招商中证红利ETF",
          asset_class: "股票",
          ilas_platform: "非投连险-中国分红",
          currency: "CNY",
          fee_pct: 0.3,
          benchmark_code: "sh510300",
          primary_source: "tencent_hfq",
          data_tier: "A",
          is_trackable: 1,
          status: "active",
        },
      ],
      metrics: [
        { slug: "Z01_F", latest_nav: navA[navA.length - 1], div_yield_ttm: 0.05, obs_days: 120, data_tier: "B" },
        { slug: "CN_515080", latest_nav: navB[navB.length - 1], div_yield_ttm: 0.045, obs_days: 120, data_tier: "A" },
      ],
      series: {
        Z01_F: {
          slug: "Z01_F",
          currency: "USD",
          series_type: "proxy_underlying",
          source: "yfinance",
          series_json: JSON.stringify({ d: dates, n: navA, a: navA, v: [[60, 0.5]], t: "proxy_underlying", s: "yfinance" }),
        },
        CN_515080: {
          slug: "CN_515080",
          currency: "CNY",
          series_type: "market_etf",
          source: "tencent_hfq",
          series_json: JSON.stringify({ d: dates, n: navB, a: navB, v: [], t: "market_etf", s: "tencent_hfq" }),
        },
      },
      fx: {
        CNYUSD: {
          pair: "CNYUSD",
          latest_rate: 0.14,
          series_json: JSON.stringify({ d: dates, r: fxCny }),
        },
      },
    });

    // Resolution by AIA code, ISIN, and slug
    const byAia = await resolveQuantFund(db, "Z01");
    expect(byAia?.slug).toBe("Z01_F");
    const byIsin = await resolveQuantFund(db, "HK0000288743");
    expect(byIsin?.slug).toBe("Z01_F");

    // Packed series unpacking
    const s = await getQuantFundSeries(db, "Z01_F");
    expect(s?.dates).toHaveLength(120);
    expect(s?.dividends[dates[60]]).toBe(0.5);

    // FX conversion CNY -> USD
    const converted = await convertSeriesCurrency(db, { [dates[0]]: 100 }, "CNY", "USD");
    expect(converted[dates[0]]).toBeCloseTo(14.0, 4);

    // Full StrategyLab run directly on AIA code Z01 + A-share ETF 515080 (0 network calls!)
    const lab = new StrategyLab(db);
    const res = await lab.runAnalysis(["Z01", "CN_515080"], 3650, 0.8, { Z01: 0.5, CN_515080: 0.5 }, { capital: 1000000, years: 10 }, 0.04, "raw", "USD");
    expect(res.valid_assets).toEqual(["Z01", "CN_515080"]);
    expect(res.asset_stats["Z01"].name).toBe("惠理高息股票基金");
    expect(res.efficient_frontier && res.efficient_frontier.length).toBeGreaterThan(0);
    for (const pt of res.efficient_frontier || []) {
      expect(pt.allocations).toBeDefined();
      const vals = Object.values(pt.allocations || {});
      expect(vals.reduce((a, b) => a + b, 0)).toBeCloseTo(1.0, 2);
      expect(vals.every((w) => w >= -1e-6 && w <= 0.8 + 1e-6)).toBe(true);
    }
    for (const key of ["max_sharpe", "min_volatility", "risk_parity"] as const) {
      const vals = Object.values(res[key].allocations);
      expect(vals.reduce((a, b) => a + b, 0)).toBeCloseTo(1.0, 2);
    }
    expect(res.portfolio_diagnostics?.weighted_fee_pct).toBeCloseTo(0.78, 1);
    expect(res.base_currency).toBe("USD");
  });
});

describe("advisoryEngine & PortfolioEngine regression", () => {
  beforeEach(() => {
    clearQuantStoreCaches();
    vi.restoreAllMocks();
  });

  it("computes conservative vs growth risk envelopes cleanly", () => {
    const consProfile = normalizeProfile({
      risk_level: "conservative",
      primary_goal: "income",
      horizon_years: 4,
      initial_capital: 200000,
      annual_withdrawal: 10000,
      currency: "USD",
    });
    const consEnv = getRiskEnvelope(consProfile);
    expect(consEnv.income_focus).toBe(true);
    expect(consEnv.target_equity_pct).toBeLessThanOrEqual(20);
    expect(consEnv.target_equity_pct + consEnv.target_bond_pct + consEnv.target_other_pct).toBe(100);

    const growthProfile = normalizeProfile({
      risk_score: 80,
      primary_goal: "growth",
      horizon_years: 20,
      initial_capital: 500000,
      currency: "USD",
    });
    const growthEnv = getRiskEnvelope(growthProfile);
    expect(growthEnv.risk_level).toBe("growth");
    expect(growthEnv.target_equity_pct).toBeGreaterThanOrEqual(75);
    expect(growthEnv.target_equity_pct + growthEnv.target_bond_pct + growthEnv.target_other_pct).toBe(100);

    const classicMatches = matchClassicTemplates(growthProfile, growthEnv);
    expect(classicMatches).toHaveLength(3);
    for (const m of classicMatches) {
      expect(m.match_score).toBeGreaterThanOrEqual(40);
      expect(m.match_score).toBeLessThanOrEqual(99);
    }
  });

  it("builds custom fund baskets summing to 100%, excluding 非推荐选择, and honoring scopes", () => {
    const mkRow = (over: Partial<any>) => ({
      slug: over.slug,
      code: over.code || over.slug,
      aia_code: over.aia_code || null,
      isin: over.isin || null,
      yahoo_ticker: null,
      cn_code: null,
      name: over.name || over.slug,
      name_en: null,
      manager: "Mgr",
      asset_class: over.asset_class || "股票",
      ilas_platform: over.ilas_platform || "AIA 卓达智悦2",
      currency: "USD",
      risk_class: null,
      morningstar_stars: 4,
      fee_pct: 1.0,
      role: null,
      fit_plans: [],
      tags: over.tags || ["推荐选择"],
      commentary: null,
      twin_code: null,
      is_distributing: Boolean(over.is_distributing),
      benchmark_code: "SPY",
      primary_source: "yfinance",
      data_tier: "B",
      is_trackable: true,
      status: "active",
      as_of_date: "2026-11-20",
      valuation_date: "2026-11-20",
      latest_nav: 10,
      ret_1m: 0.01,
      ret_3m: 0.03,
      ret_6m: 0.05,
      ret_ytd: 0.08,
      ret_1y: 0.1,
      ret_3y_ann: over.ret_3y_ann ?? 0.07,
      ret_5y_ann: 0.07,
      vol_1y: 0.1,
      vol_3y: 0.12,
      max_dd_1y: -0.05,
      max_dd_3y: -0.1,
      max_dd_5y: -0.15,
      dd_recovery_days: 30,
      sharpe_3y: 0.65,
      sortino_3y: 0.8,
      calmar_3y: 0.7,
      beta_3y: 0.8,
      alpha_3y: 0.01,
      r2_3y: 0.8,
      ir_3y: 0.2,
      div_yield_ttm: over.is_distributing ? 0.045 : 0.01,
      peer_rank_pct: 20,
      quant_score: over.quant_score ?? 75,
      quant_grade: "A",
      obs_days: 250,
      anomalies: [],
    });

    const catalog = [
      mkRow({ slug: "Z01_F", code: "Z01", is_distributing: true, ilas_platform: "AIA 卓达智悦2", asset_class: "股票" }),
      mkRow({ slug: "Z02_F", code: "Z02", is_distributing: false, ilas_platform: "AIA 卓达智悦2", asset_class: "股票" }),
      mkRow({ slug: "BAD_F", code: "BAD", tags: ["非推荐选择"], quant_score: 99, ilas_platform: "AIA 卓达智悦2", asset_class: "股票" }),
      mkRow({ slug: "B01_F", code: "B01", is_distributing: true, ilas_platform: "AIA 卓达智悦2", asset_class: "固定收益" }),
      mkRow({ slug: "B02_F", code: "B02", is_distributing: false, ilas_platform: "AIA 卓达智悦2", asset_class: "固定收益" }),
      mkRow({ slug: "M01_F", code: "M01", is_distributing: true, ilas_platform: "AIA 卓达智悦2", asset_class: "多元资产" }),
      mkRow({ slug: "US_SCHD", code: "SCHD", is_distributing: true, ilas_platform: "非投连险-美股分红型ETF", asset_class: "股票" }),
      mkRow({ slug: "US_VTI", code: "VTI", is_distributing: false, ilas_platform: "非投连险-国际股票", asset_class: "股票" }),
      mkRow({ slug: "US_AGG", code: "AGG", is_distributing: true, ilas_platform: "非投连险-债券基金比较", asset_class: "固定收益" }),
    ];

    const aiaProf = normalizeProfile({ product_scope: "aia_tmp2", primary_goal: "income", risk_level: "balanced" });
    const aiaRes = buildCustomFundBaskets(catalog, aiaProf, getRiskEnvelope(aiaProf));
    expect(aiaRes.baskets).toHaveLength(2);
    for (const b of aiaRes.baskets) {
      const weightSum = b.holdings.reduce((s, h) => s + h.weight_pct, 0);
      expect(weightSum).toBe(100);
      expect(b.holdings.every((h) => !h.slug.startsWith("BAD"))).toBe(true);
      expect(b.holdings.every((h) => (h.ilas_platform || "").startsWith("AIA"))).toBe(true);
    }

    const etfProf = normalizeProfile({ product_scope: "global_etf", primary_goal: "growth", risk_level: "growth" });
    const etfRes = buildCustomFundBaskets(catalog, etfProf, getRiskEnvelope(etfProf));
    expect(etfRes.baskets.length).toBeGreaterThanOrEqual(1);
    for (const b of etfRes.baskets) {
      expect(b.holdings.reduce((s, h) => s + h.weight_pct, 0)).toBe(100);
      expect(b.holdings.every((h) => !(h.ilas_platform || "").startsWith("AIA"))).toBe(true);
    }
  });

  it("does not clamp historical portfolio NAV up to avgCost when market NAV trades below purchase price", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 404 }));
    const dates = ["2026-01-02", "2026-01-05", "2026-01-15", "2026-01-30", "2026-02-27"];
    const navs = [10.0, 9.8, 9.2, 8.5, 8.8];
    const { db } = createMockD1({
      portfolios: [
        {
          id: 99,
          name: "IncomeDropTest",
          base_currency: "USD",
          dividend_strategy: "CASH",
          target_allocations: JSON.stringify({ TEST_DROP: 1.0 }),
          created_at: "2026-01-02",
        },
      ],
      transactions: [
        { portfolio_id: 99, date: "2026-01-02", isin: "CASH_USD", type: "CASH_IN", shares: 1, price: 100000 },
        { portfolio_id: 99, date: "2026-01-02", isin: "TEST_DROP", type: "BUY", shares: 10000, price: 10.0 },
      ],
      funds: [
        {
          slug: "TEST_DROP",
          code: "TEST_DROP",
          name: "Test Income Fund",
          asset_class: "固定收益",
          currency: "USD",
          is_trackable: 1,
        },
      ],
      series: {
        TEST_DROP: {
          slug: "TEST_DROP",
          currency: "USD",
          series_type: "market_etf",
          source: "test",
          series_json: JSON.stringify({ d: dates, n: navs, a: navs, v: [] }),
        },
      },
      priceCache: [{ isin: "TEST_DROP", price: 8.8, date: new Date().toISOString().slice(0, 10) }],
    });

    const engine = new PortfolioEngine(db, 99);
    await engine.init();
    const chart = await engine.getHistoricalChartData();
    const janEnd = chart.find((p) => p.date.startsWith("2026-01-3"));
    expect(janEnd).toBeDefined();
    expect(janEnd!.value).toBeCloseTo(85000, 0);
    expect(janEnd!.value).toBeLessThan(100000);
  });

  it("callLlmChat falls back to structured rule-based analysis when keys are absent", async () => {
    const mockEnv: any = {
      DEEPSEEK_API_KEY: "",
      OPENROUTER_API_KEY: "",
    };
    const res = await callLlmChat(mockEnv, "测试提示词", { modelPreference: "auto" });
    expect(res.provider).toBe("fallback_rule");
    expect(res.text).toContain("宏观利率与估值时钟研判");
    expect(res.text).toContain("利率周期与收益率曲线观察");
    expect(res.text).toContain("核心—卫星底层资产分工");
    expect(res.text).toContain("股权风险溢价（ERP）");
  });

  it("classifyAsset correctly categorizes Chinese assets and AIA funds via meta and Chinese names", () => {
    // Chinese bond fund
    const b1 = classifyAsset("B01", "富达美元现金基金", { asset_class: "cash" });
    expect(b1.class_key).toBe("CASH_EQUIVALENTS");

    // Chinese dividend ETF
    const d1 = classifyAsset("515080", "中证红利ETF", { asset_class: "equity" });
    expect(d1.class_key).toBe("CHINA_EQUITY");

    // Broad Bond
    const bond = classifyAsset("LU1128926489", "安联收益及增长基金", { asset_class: "bond" });
    expect(bond.class_key).toBe("COVERED_CALL_INCOME"); // 收益及增长 is hybrid covered call income
  });

  it("createPrng generates deterministic repeatable sequence for same seed", () => {
    const rng1 = createPrng(42);
    const rng2 = createPrng(42);
    const seq1 = [rng1(), rng1(), rng1()];
    const seq2 = [rng2(), rng2(), rng2()];
    expect(seq1).toEqual(seq2);
  });

  it("buildDeterministicTacticalAdjustment shifts weights defensively for near-term spend & US valuation concerns and extracts lab directives", () => {
    const profile = {
      initial_capital: 800000,
      horizon_years: 10,
      annual_withdrawal: 30000,
      extra_notes: "计划3年后支出15万用于子女留学；担忧美股高估值，希望锁定当前美元高息",
    };
    const rec = {
      holdings: [
        { lab_id: "BIL", name: "短期美债", weight_pct: 20, asset_class: "cash" },
        { lab_id: "SCHD", name: "美股红利", weight_pct: 30, asset_class: "equity" },
        { lab_id: "QQQ", name: "纳斯达克100", weight_pct: 50, asset_class: "equity" },
      ],
    };

    const tac = buildDeterministicTacticalAdjustment(profile, rec);
    const totalW = tac.adjusted_holdings.reduce((s, h) => s + h.adjusted_weight_pct, 0);
    expect(totalW).toBe(100);

    const bil = tac.adjusted_holdings.find((h) => h.lab_id === "BIL")!;
    const qqq = tac.adjusted_holdings.find((h) => h.lab_id === "QQQ")!;
    expect(bil.adjusted_weight_pct).toBeGreaterThan(20);
    expect(qqq.adjusted_weight_pct).toBeLessThan(50);

    expect(tac.lab_directives.cma_mode).toBe("forward_looking");
    expect(tac.lab_directives.withdrawal).toBe(30000);
    expect(tac.lab_directives.withdrawal_2).toBe(150000);
    expect(tac.lab_directives.withdrawal_start_2).toBe(3);
    expect(tac.lab_directives.withdrawal_end_2).toBe(3);
    expect(tac.lab_directives.stress).toBe(true);
  });

  it("extractAndNormalizeTacticalJson strips <tactical_json>, ignores unknown tickers, and normalizes weights to 100%", () => {
    const profile = { initial_capital: 500000, horizon_years: 10 };
    const rec = {
      holdings: [
        { lab_id: "BIL", name: "短期美债", weight_pct: 30 },
        { lab_id: "VT", name: "全球股票", weight_pct: 70 },
      ],
    };
    const raw = `### 报告正文
这是一份干净的研判报告。

<tactical_json>
{
  "tactical_summary_zh": "提高短债防御比例至45%",
  "adjusted_holdings": [
    { "lab_id": "BIL", "adjusted_weight_pct": 45, "reason_zh": "锁息" },
    { "lab_id": "VT", "adjusted_weight_pct": 55, "reason_zh": "降仓" },
    { "lab_id": "FAKE_TICKER", "adjusted_weight_pct": 20, "reason_zh": "应被过滤" }
  ],
  "lab_directives": {
    "cma_mode": "forward_looking",
    "capital": 500000,
    "years": 12,
    "withdrawal": 20000,
    "withdrawal_start": 1,
    "withdrawal_end": 12,
    "stress": true
  }
}
</tactical_json>`;

    const { cleanMarkdown, tacticalAdjustment } = extractAndNormalizeTacticalJson(raw, profile, rec);
    expect(cleanMarkdown).toContain("### 报告正文");
    expect(cleanMarkdown).not.toContain("<tactical_json>");
    expect(tacticalAdjustment.adjusted_holdings.map((h) => h.lab_id)).toEqual(["BIL", "VT"]);
    expect(tacticalAdjustment.adjusted_holdings.reduce((s, h) => s + h.adjusted_weight_pct, 0)).toBe(100);
    expect(tacticalAdjustment.adjusted_holdings[0].adjusted_weight_pct).toBe(45);
    expect(tacticalAdjustment.adjusted_holdings[0].delta_pct).toBe(15);
    expect(tacticalAdjustment.lab_directives.years).toBe(12);
    expect(tacticalAdjustment.lab_directives.stress).toBe(true);
  });

  it("StrategyLab.runAnalysis retains Tier-U AIA funds (D05, M13, A17, R03) via benchmark proxy fallback instead of dropping them", async () => {
    clearQuantStoreCaches();
    // Avoid real network calls during unit test so Tier-U funds immediately hit benchmark proxy fallback
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));

    const dates: string[] = [];
    const start = new Date("2025-01-02T00:00:00Z");
    for (let i = 0; i < 60; i++) {
      const d = new Date(start.getTime() + i * 86400_000);
      if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) {
        dates.push(d.toISOString().slice(0, 10));
      }
    }

    const mkSeries = (code: string, ccy: string, dailyRet: number) => {
      const arr = [100];
      for (let i = 1; i < dates.length; i++) {
        arr.push(Number((arr[i - 1] * (1 + dailyRet * (i % 3 === 0 ? -0.5 : 1.5))).toFixed(4)));
      }
      return {
        code,
        currency: ccy,
        series_json: JSON.stringify({ d: dates, c: arr, a: arr }),
      };
    };

    const { db } = createMockD1({
      funds: [
        {
          slug: "D05_F",
          code: "D05",
          aia_code: "D05",
          name: "富蘭克林生物科技新領域基金A股（累算）",
          asset_class: "股票",
          currency: "USD",
          fee_pct: 1.82,
          benchmark_code: "SPY",
          data_tier: "U",
          is_trackable: 1,
        },
        {
          slug: "M13_F",
          code: "M13",
          aia_code: "M13",
          name: "Fidelity Funds - US Dollar Cash Fund",
          asset_class: "货币",
          currency: "USD",
          fee_pct: 0.4,
          benchmark_code: "BIL",
          data_tier: "U",
          is_trackable: 1,
        },
        {
          slug: "A17_F",
          code: "A17",
          aia_code: "A17",
          name: "柏瑞環球基金 - 柏瑞大中華股票基金 A",
          asset_class: "股票",
          currency: "USD",
          fee_pct: 1.9,
          benchmark_code: "2800.HK",
          data_tier: "U",
          is_trackable: 1,
        },
        {
          slug: "R03_F",
          code: "R03",
          aia_code: "R03",
          name: "駿利亨德森平衡基金-A2美元類",
          asset_class: "多元资产",
          currency: "USD",
          fee_pct: 1.88,
          benchmark_code: "SPY",
          data_tier: "U",
          is_trackable: 1,
        },
      ],
      benchmarks: {
        SPY: mkSeries("SPY", "USD", 0.0005),
        BIL: mkSeries("BIL", "USD", 0.00018),
        AGG: mkSeries("AGG", "USD", 0.0002),
        "2800.HK": mkSeries("2800.HK", "HKD", 0.0004),
      },
      fx: {
        HKDUSD: {
          pair: "HKDUSD",
          latest_rate: 0.128,
          series_json: JSON.stringify({ d: dates, r: dates.map(() => 0.128) }),
        },
      },
    });

    const lab = new StrategyLab(db);
    const res = await lab.runAnalysis(
      ["D05", "M13", "A17", "R03"],
      365,
      0.35,
      { D05: 0.2, M13: 0.3, A17: 0.25, R03: 0.25 },
      { capital: 500000, years: 10, cma_mode: "forward_looking", seed: 42 },
      0.04,
      "forward_looking",
      "USD"
    );

    vi.unstubAllGlobals();

    expect(res.valid_assets).toEqual(["D05", "M13", "A17", "R03"]);
    expect(Object.keys(res.custom_portfolio!.allocations)).toEqual(["D05", "M13", "A17", "R03"]);
    expect(res.custom_portfolio!.allocations.M13).toBeCloseTo(0.3, 4);
    expect(res.data_warnings.length).toBe(4);
    expect(res.data_warnings.some((w) => w.includes("对标基准 [BIL 短期美债/美元现金基准]"))).toBe(true);
    expect(res.data_warnings.some((w) => w.includes("对标基准 [60% SPY + 40% AGG 股债平衡基准]"))).toBe(true);
    expect(res.asset_stats.D05.proxy_benchmark).toContain("SPY");
  });
});

describe("Client IPS Report Generator & Narrative Co-Author", () => {
  const sampleNestedPayload = {
    base_currency: "USD",
    client_info: {
      client_name: "陈先生",
      age: 48,
      risk_level: "balanced",
      risk_label_zh: "稳健平衡型",
      risk_score: 62,
      extra_notes: "预留5年后子女留学学费 40 万美元，保持高流动性防御垫",
      target_envelope: "退休现金流与留学双重目标",
      goals: ["retirement_income", "education"],
      holdings_rationale: {
        BIL: "留学准备金与短债高息防御垫",
      },
      tactical_summary_zh: "兼顾稳健派息与全球权益复利。",
    },
    mc_settings: {
      capital: 2000000,
      years: 20,
      target: 3000000,
      inflation: 2.5,
      withdrawal: 80000,
      withdrawal_start: 1,
      withdrawal_end: 20,
      withdrawal_2: 400000,
      withdrawal_start_2: 5,
      withdrawal_end_2: 5,
      withdrawal_inflation: true,
      cma_mode: "forward_looking",
    },
    lab_result: {
      mc_target_label: "custom_portfolio",
      custom_portfolio: {
        expected_return: 0.072,
        volatility: 0.095,
        sharpe_ratio: 0.58,
        dividend_yield: 0.032,
        allocations: { BIL: 0.3, SCHD: 0.4, VT: 0.3 },
      },
      asset_stats: {
        BIL: { name: "SPDR Bloomberg 1-3 Month T-Bill ETF", asset_class: "Cash / Treasury", dividend_yield: 0.045 },
        SCHD: { name: "Schwab US Dividend Equity ETF", asset_class: "Dividend Equity", dividend_yield: 0.036 },
        VT: { name: "Vanguard Total World Stock ETF", asset_class: "Global Equity", dividend_yield: 0.019 },
      },
      portfolio_diagnostics: { max_drawdown: -0.145 },
      monte_carlo: {
        solvency_rate: 0.945,
        success_rate: 0.382,
        chart: [
          { year: 0, p10: 2000000, p50: 2000000, p90: 2000000 },
          { year: 1, p10: 1920000, p50: 2080000, p90: 2240000, div_generated: 64000 },
          { year: 5, p10: 1680000, p50: 2150000, p90: 2780000, div_generated: 71000 },
          { year: 20, p10: 1620000, p50: 3450000, p90: 6200000, div_generated: 98000 },
        ],
        drawdown: { p10: -0.22, p50: -0.135, p90: -0.06 },
        irr: { p10: 0.032, p50: 0.068, p90: 0.098 },
      },
    },
    stress_test: {
      scenarios: [
        { id: "gfc_2008", label: "2008全球金融危机", available: true, total_return_pct: -14.2, max_drawdown_pct: -18.5 },
        { id: "rate_hike_2022", label: "2022美联储激进加息", available: true, total_return_pct: -6.8, max_drawdown_pct: -11.2 },
      ],
    },
  };

  it("normalizeReportContext extracts nested lab holdings, dollar amounts, extraNotes, solvencyRatePct, and stressScenarios", () => {
    const ctx = normalizeReportContext(sampleNestedPayload);
    expect(ctx.clientName).toBe("陈先生");
    expect(ctx.riskLabel).toBe("稳健平衡型");
    expect(ctx.extraNotes).toContain("子女留学学费 40 万美元");
    expect(ctx.solvencyRatePct).toBe(94.5);
    expect(ctx.holdings).toHaveLength(3);

    const bil = ctx.holdings.find((h) => h.isin === "BIL");
    expect(bil).toBeDefined();
    expect(bil?.weightPct).toBe(30);
    expect(bil?.amount).toBe(600000);

    const schd = ctx.holdings.find((h) => h.isin === "SCHD");
    expect(schd?.amount).toBe(800000);

    expect(ctx.stressScenarios).toHaveLength(2);
    expect(ctx.stressScenarios[0].label).toBe("2008全球金融危机");
  });

  it("generateClientReportNarrative returns structured 5-section IPS commentary and per-holding notes under deterministic fallback", async () => {
    const narrative = await generateClientReportNarrative(sampleNestedPayload, {
      DEEPSEEK_API_KEY: "",
      OPENROUTER_API_KEY: "",
    } as any);

    expect(narrative.executive_summary.length).toBeGreaterThan(20);
    expect(narrative.macro_and_strategy.length).toBeGreaterThan(20);
    expect(narrative.cashflow_and_solvency.length).toBeGreaterThan(20);
    expect(narrative.risk_and_stress_commentary.length).toBeGreaterThan(20);
    expect(narrative.holdings_commentary.BIL).toBeTruthy();
    expect(narrative.holdings_commentary.SCHD).toBeTruthy();
    expect(narrative.holdings_commentary.VT).toBeTruthy();
  });

  it("generateWealthReportDocx builds a valid PK-signed .docx archive with length > 1000", async () => {
    const emptyEnv = { DEEPSEEK_API_KEY: "", OPENROUTER_API_KEY: "" } as any;
    const narrative = await generateClientReportNarrative(sampleNestedPayload, emptyEnv);
    const docxBytes = await generateWealthReportDocx(
      { ...sampleNestedPayload, ai_narrative: narrative },
      emptyEnv
    );

    expect(docxBytes).toBeInstanceOf(Uint8Array);
    expect(docxBytes.byteLength).toBeGreaterThan(1000);
    expect(docxBytes[0]).toBe(0x50);
    expect(docxBytes[1]).toBe(0x4b);
  });
});

describe("callLlmChat deep-analysis model routing", () => {
  it("routes deepseek-pro to fast deepseek-v4-pro (>=8192) and deepseek-pro-thinking to enabled reasoning (>=16384)", async () => {
    const calls: Array<{ url: string; body: any }> = [];
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      calls.push({ url, body });
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "### 一、宏观利率与估值时钟研判\n深度分析正文",
                reasoning_content: "先评估美债10Y与SPY ERP，再配置短债与红利底仓。",
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    try {
      const env: any = {
        DEEPSEEK_API_KEY: "ds-test-key",
        OPENROUTER_API_KEY: "or-test-key",
        DEEPSEEK_BASE_URL: "https://api.deepseek.com",
        DEEPSEEK_MODEL: "deepseek-v4-pro",
      };

      const res = await callLlmChat(env, "分析组合", {
        modelPreference: "deepseek-pro",
        maxTokens: 3200,
      });

      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe("https://api.deepseek.com/chat/completions");
      expect(calls[0].body.model).toBe("deepseek-v4-pro");
      expect(calls[0].body.thinking).toEqual({ type: "disabled" });
      expect(calls[0].body.reasoning_effort).toBeUndefined();
      expect(calls[0].body.max_tokens).toBeGreaterThanOrEqual(8192);
      expect(res.provider).toBe("deepseek");
      expect(res.modelUsed).toBe("deepseek-v4-pro");

      // Legacy "auto" should also map to fast deepseek-pro
      const resLegacy = await callLlmChat(env, "分析组合", { modelPreference: "auto" });
      expect(resLegacy.modelUsed).toBe("deepseek-v4-pro");

      // Explicit thinking mode should enable reasoning_effort=low and >=16384 max_tokens
      const resThink = await callLlmChat(env, "分析组合", { modelPreference: "deepseek-pro-thinking" });
      expect(calls[2].body.thinking).toEqual({ type: "enabled" });
      expect(calls[2].body.reasoning_effort).toBe("low");
      expect(calls[2].body.max_tokens).toBeGreaterThanOrEqual(16384);
      expect(resThink.reasoning).toContain("SPY ERP");
    } finally {
      spy.mockRestore();
    }
  });

  it("streams upstream SSE chunks and fires onProgress callbacks without starving content", async () => {
    const progressEvents: any[] = [];
    const encoder = new TextEncoder();
    const sseBody = new ReadableStream({
      start(controller) {
        const chunks = [
          `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "先评估客户流动性与利率周期。" } }] })}\n\n`,
          `data: ${JSON.stringify({ choices: [{ delta: { content: "### 一、宏观研判\n" } }] })}\n\n`,
          `data: ${JSON.stringify({ choices: [{ delta: { content: "正文结论完整。" } }] })}\n\n`,
          "data: [DONE]\n\n",
        ];
        for (const ch of chunks) controller.enqueue(encoder.encode(ch));
        controller.close();
      },
    });

    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const reqBody = init?.body ? JSON.parse(String(init.body)) : {};
      expect(reqBody.stream).toBe(true);
      expect(reqBody.max_tokens).toBeGreaterThanOrEqual(16384);
      return new Response(sseBody, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    try {
      const env: any = {
        DEEPSEEK_API_KEY: "ds-test-key",
        DEEPSEEK_BASE_URL: "https://api.deepseek.com",
        DEEPSEEK_MODEL: "deepseek-v4-pro",
      };
      const res = await callLlmChat(env, "分析组合", {
        modelPreference: "deepseek-pro-thinking",
        useUpstreamStream: true,
        onProgress: (info) => progressEvents.push(info),
      });

      expect(res.provider).toBe("deepseek");
      expect(res.reasoning).toContain("流动性与利率周期");
      expect(res.text).toBe("### 一、宏观研判\n正文结论完整。");
      expect(progressEvents.length).toBeGreaterThanOrEqual(2);
      expect(progressEvents[progressEvents.length - 1].stage).toBe("writing");
    } finally {
      spy.mockRestore();
    }
  });

  it("routes gemini-deep, qwen-deep, and claude-sonnet to OpenRouter primary models", async () => {
    const requestedModels: string[] = [];
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
      requestedModels.push(body.model);
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "OpenRouter 深度报告", reasoning: "CoT trace" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    try {
      const env: any = {
        DEEPSEEK_API_KEY: "ds-test-key",
        OPENROUTER_API_KEY: "or-test-key",
        OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
      };

      const r1 = await callLlmChat(env, "p1", { modelPreference: "gemini-deep" });
      const r2 = await callLlmChat(env, "p2", { modelPreference: "qwen-deep" });
      const r3 = await callLlmChat(env, "p3", { modelPreference: "claude-sonnet" });

      expect(requestedModels).toEqual([
        "google/gemini-3.8-flash",
        "qwen/qwen3.7-plus",
        "anthropic/claude-sonnet-5.5",
      ]);
      expect(r1.provider).toBe("openrouter");
      expect(r2.modelUsed).toBe("qwen/qwen3.7-plus");
      expect(r3.modelUsed).toBe("anthropic/claude-sonnet-5.5");
      expect(r1.reasoning).toBe("CoT trace");
    } finally {
      spy.mockRestore();
    }
  });

  it("falls back along OpenRouter chain, then to DeepSeek, and returns fallbackReason when all fail", async () => {
    const attempts: string[] = [];
    let shouldAllFail = false;

    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      attempts.push(`${url}#${body.model}`);

      if (!shouldAllFail && body.model === "google/gemini-3.7-flash") {
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "fallback to 3.7 flash ok" } }] }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response("upstream error", { status: 500 });
    });

    try {
      const env: any = {
        DEEPSEEK_API_KEY: "ds-test-key",
        OPENROUTER_API_KEY: "or-test-key",
        OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
        DEEPSEEK_BASE_URL: "https://api.deepseek.com",
      };

      const resDegraded = await callLlmChat(env, "p", { modelPreference: "gemini-deep" });
      expect(resDegraded.provider).toBe("openrouter");
      expect(resDegraded.modelUsed).toBe("google/gemini-3.7-flash");
      expect(attempts[0]).toContain("google/gemini-3.8-flash");
      expect(attempts[1]).toContain("google/gemini-3.7-flash");

      shouldAllFail = true;
      attempts.length = 0;
      const resAllFailed = await callLlmChat(env, "测试提示词", { modelPreference: "gemini-deep" });
      expect(resAllFailed.provider).toBe("fallback_rule");
      expect(resAllFailed.fallbackReason).toContain("HTTP 500");
      expect(attempts.some((a) => a.startsWith("https://api.deepseek.com/chat/completions#deepseek-v4-pro"))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("Core-Satellite, Homogeneous Deduplication, Hard Caps & AI Fund Swapping", () => {
  const mkFund = (over: Partial<any>) => ({
    slug: over.slug,
    code: over.code || over.slug,
    aia_code: over.aia_code || null,
    isin: over.isin || null,
    yahoo_ticker: over.yahoo_ticker || null,
    cn_code: null,
    name: over.name || over.slug,
    name_en: over.name_en || null,
    manager: over.manager || "DefaultMgr",
    asset_class: over.asset_class || "股票",
    ilas_platform: over.ilas_platform ?? "AIA 卓达智悦2",
    currency: over.currency || "USD",
    risk_class: null,
    morningstar_stars: over.morningstar_stars ?? 4,
    fee_pct: over.fee_pct ?? 0.5,
    role: over.role ?? null,
    fit_plans: [],
    tags: over.tags || ["推荐选择"],
    commentary: null,
    twin_code: over.twin_code || null,
    is_distributing: Boolean(over.is_distributing),
    benchmark_code: over.benchmark_code || "SPY",
    primary_source: "yfinance",
    data_tier: over.data_tier || "A",
    is_trackable: true,
    status: "active",
    top_holding_keys: over.top_holding_keys || [],
    as_of_date: "2026-11-24",
    valuation_date: "2026-11-24",
    latest_nav: 10,
    ret_1m: 0.01,
    ret_3m: 0.03,
    ret_6m: 0.05,
    ret_ytd: 0.08,
    ret_1y: 0.1,
    ret_3y_ann: over.ret_3y_ann ?? 0.08,
    ret_5y_ann: 0.08,
    vol_1y: 0.11,
    vol_3y: over.vol_3y ?? 0.12,
    max_dd_1y: -0.05,
    max_dd_3y: -0.1,
    max_dd_5y: -0.15,
    dd_recovery_days: 30,
    sharpe_3y: over.sharpe_3y ?? 0.7,
    sortino_3y: 0.85,
    calmar_3y: 0.8,
    beta_3y: over.beta_3y ?? 1.0,
    alpha_3y: over.alpha_3y ?? 0.0,
    r2_3y: over.r2_3y ?? 0.9,
    ir_3y: 0.2,
    div_yield_ttm: over.div_yield_ttm ?? 0.02,
    peer_rank_pct: 20,
    quant_score: over.quant_score ?? 75,
    quant_grade: over.quant_grade || "A",
    obs_days: 750,
    anomalies: [],
  });

  it("ranks homogeneous funds by lowest-fee + highest-alpha, or closest index fit + lowest-fee when alpha is absent", () => {
    const activeHighAlphaLowFee = mkFund({
      slug: "ACT_BEST",
      name: "Global Active Leaders A",
      alpha_3y: 0.04,
      fee_pct: 0.8,
      r2_3y: 0.78,
    });
    const activeLowAlphaHighFee = mkFund({
      slug: "ACT_EXP",
      name: "Global Active Leaders B",
      alpha_3y: 0.015,
      fee_pct: 1.6,
      r2_3y: 0.85,
    });
    expect(compareHomogeneousFunds(activeHighAlphaLowFee as any, activeLowAlphaHighFee as any)).toBeLessThan(0);

    const passiveLowFeeTightFit = mkFund({
      slug: "IDX_VOO",
      name: "S&P 500 Low Cost ETF",
      alpha_3y: -0.0005,
      fee_pct: 0.03,
      r2_3y: 0.99,
      beta_3y: 1.0,
    });
    const passiveHighFeeLooseFit = mkFund({
      slug: "IDX_EXP",
      name: "US Large Cap Feeder",
      alpha_3y: -0.008,
      fee_pct: 1.25,
      r2_3y: 0.86,
      beta_3y: 0.85,
    });
    expect(compareHomogeneousFunds(passiveLowFeeTightFit as any, passiveHighFeeLooseFit as any)).toBeLessThan(0);
  });

  it("prevents selecting funds with >=35% Top-10 holdings overlap and enforces Core >=70%, Satellite <=30%, Horizon Hard Cap & ILAS >=10%", () => {
    const sharedTechHoldings = ["aapl", "msft", "nvda", "amzn", "googl", "meta", "tsla", "avgo"];
    const catalog = [
      // Two overlapping US Broad Equity funds: VOO (cheap & tight fit) vs SPY_FEEDER (expensive, overlapping holdings)
      mkFund({
        slug: "US_VOO",
        code: "VOO",
        name: "Vanguard S&P 500 Core ETF",
        manager: "Vanguard",
        asset_class: "股票",
        ilas_platform: "AIA 卓达智悦2",
        role: "核心",
        fee_pct: 0.03,
        alpha_3y: 0.0,
        r2_3y: 0.99,
        beta_3y: 1.0,
        top_holding_keys: sharedTechHoldings,
      }),
      mkFund({
        slug: "US_SPY_HI",
        code: "SPY_HI",
        name: "Expensive US Equity Fund",
        manager: "OtherMgr",
        asset_class: "股票",
        ilas_platform: "AIA 卓达智悦2",
        role: "核心",
        fee_pct: 1.65,
        alpha_3y: -0.01,
        r2_3y: 0.88,
        beta_3y: 0.92,
        top_holding_keys: [...sharedTechHoldings.slice(0, 6), "brk.b", "lly"],
      }),
      mkFund({
        slug: "GL_CORE",
        code: "VT",
        name: "Global All-World Core Equity",
        manager: "Vanguard",
        asset_class: "股票",
        ilas_platform: "AIA 卓达智悦2",
        role: "核心",
        fee_pct: 0.07,
        r2_3y: 0.98,
        beta_3y: 1.0,
        benchmark_code: "VT",
        top_holding_keys: ["nesn", "novn", "tsm", "asml", "sap", "mc", "sony", "toyota"],
      }),
      mkFund({
        slug: "BD_CORE1",
        code: "B01",
        name: "AB Short Duration Bond",
        manager: "AB",
        asset_class: "固定收益",
        ilas_platform: "AIA 卓达智悦2",
        role: "核心",
        fee_pct: 0.55,
        benchmark_code: "BIL",
      }),
      mkFund({
        slug: "BD_CORE2",
        code: "M11",
        name: "Fidelity Global Aggregate Bond",
        manager: "Fidelity",
        asset_class: "固定收益",
        ilas_platform: "AIA 卓达智悦2",
        role: "核心",
        fee_pct: 0.71,
        benchmark_code: "AGG",
      }),
      mkFund({
        slug: "SAT_HK",
        code: "Z01",
        name: "Value Partners High-Dividend HK Equity",
        manager: "ValuePartners",
        asset_class: "股票",
        ilas_platform: "AIA 卓达智悦2",
        role: "卫星",
        fee_pct: 1.25,
        alpha_3y: 0.032,
        is_distributing: true,
        benchmark_code: "2800.HK",
      }),
      mkFund({
        slug: "SAT_GOLD",
        code: "GLD",
        name: "SPDR Gold Trust",
        manager: "StateStreet",
        asset_class: "多元资产",
        ilas_platform: "AIA 卓达智悦2",
        role: "卫星",
        fee_pct: 0.4,
        benchmark_code: "GLD",
      }),
    ];

    expect(computeHoldingsOverlap(catalog[0] as any, catalog[1] as any).isHighOverlap).toBe(true);
    expect(inferFundRole(catalog[0] as any)).toBe("core");
    expect(inferFundRole(catalog[5] as any)).toBe("satellite");

    // 1. Short horizon < 3 years MUST clamp equity <= 20%
    expect(getHorizonEquityHardCap(2)).toBe(20);
    const shortProf = normalizeProfile({ horizon_years: 2, risk_level: "aggressive", product_scope: "aia_tmp2" });
    const shortEnv = getRiskEnvelope(shortProf);
    expect(shortEnv.equity_hard_cap_pct).toBe(20);
    expect(shortEnv.target_equity_pct).toBeLessThanOrEqual(20);

    // 2. Balanced ILAS portfolio: Core >= 70%, Satellite <= 30%, each holding >= 10%, no overlapping US_SPY_HI
    const balProf = normalizeProfile({ horizon_years: 10, risk_level: "balanced", product_scope: "aia_tmp2" });
    const res = buildCustomFundBaskets(catalog as any, balProf, getRiskEnvelope(balProf));
    const coreBasket = res.baskets[0];
    expect(coreBasket.metrics.core_pct).toBeGreaterThanOrEqual(70);
    expect(coreBasket.metrics.satellite_pct).toBeLessThanOrEqual(30);
    expect(coreBasket.holdings.reduce((s, h) => s + h.weight_pct, 0)).toBe(100);
    expect(coreBasket.holdings.every((h) => h.weight_pct >= 10)).toBe(true);
    expect(coreBasket.holdings.some((h) => h.slug === "US_SPY_HI")).toBe(false);
  });

  it("allows AI advisor to swap/add whitelist candidate funds while blocking hallucinated tickers, and keeps macro prompt neutral", () => {
    const catalog = [
      mkFund({ slug: "US_VOO", code: "VOO", name: "Vanguard S&P 500", asset_class: "股票", ilas_platform: "非投连险-国际股票", role: "核心", fee_pct: 0.03 }),
      mkFund({ slug: "US_AGG", code: "AGG", name: "iShares Core US Aggregate Bond", asset_class: "固定收益", ilas_platform: "非投连险-债券基金比较", role: "核心", fee_pct: 0.03, benchmark_code: "AGG" }),
      mkFund({ slug: "SAT_GLD", code: "GLD", name: "SPDR Gold Shares", asset_class: "多元资产", ilas_platform: "非投连险-国际股票", role: "卫星", fee_pct: 0.4, benchmark_code: "GLD" }),
      mkFund({ slug: "SAT_2800", code: "2800.HK", name: "Tracker Fund of Hong Kong", asset_class: "股票", ilas_platform: "非投连险-港股通ETF", role: "卫星", fee_pct: 0.09, benchmark_code: "2800.HK" }),
    ];

    const baseRec = {
      holdings: [
        { lab_id: "VOO", slug: "US_VOO", name: "Vanguard S&P 500", weight_pct: 60, asset_class: "股票", core_role: "core" },
        { lab_id: "AGG", slug: "US_AGG", name: "iShares Core US Aggregate Bond", weight_pct: 40, asset_class: "固定收益", core_role: "core" },
      ],
    };

    const candidates = buildTacticalCandidatePool(catalog as any, { product_scope: "all" }, baseRec.holdings, 10);
    expect(candidates.some((c) => c.lab_id === "GLD")).toBe(true);
    expect(candidates.some((c) => c.lab_id === "VOO")).toBe(false);

    const llmRaw = `### 一、客观研判
建议新增黄金作为卫星对冲。

<tactical_json>
{
  "tactical_summary_zh": "保留核心股债并从白名单新增黄金卫星，退出条件：实际利率转正且地缘溢价消退",
  "adjusted_holdings": [
    { "lab_id": "VOO", "adjusted_weight_pct": 0, "reason_zh": "替换为黄金对冲" },
    { "lab_id": "AGG", "adjusted_weight_pct": 80, "reason_zh": "增厚核心固收" },
    { "lab_id": "GLD", "adjusted_weight_pct": 20, "reason_zh": "从白名单增配黄金卫星" },
    { "lab_id": "FAKE_999", "adjusted_weight_pct": 15, "reason_zh": "幻觉代码必须被过滤" }
  ],
  "lab_directives": { "cma_mode": "forward_looking", "capital": 500000, "years": 10 }
}
</tactical_json>`;

    const { tacticalAdjustment } = extractAndNormalizeTacticalJson(
      llmRaw,
      { initial_capital: 500000, horizon_years: 10 },
      baseRec,
      candidates
    );

    const ids = tacticalAdjustment.adjusted_holdings.map((h) => h.lab_id);
    expect(ids).not.toContain("FAKE_999");
    expect(ids).toContain("GLD");

    const voo = tacticalAdjustment.adjusted_holdings.find((h) => h.lab_id === "VOO")!;
    const agg = tacticalAdjustment.adjusted_holdings.find((h) => h.lab_id === "AGG")!;
    const gld = tacticalAdjustment.adjusted_holdings.find((h) => h.lab_id === "GLD")!;

    expect(voo.action).toBe("REMOVE");
    expect(voo.adjusted_weight_pct).toBe(0);
    expect(agg.action).toBe("INCREASE");
    expect(gld.action).toBe("ADD");
    expect(gld.adjusted_weight_pct).toBe(20);
    expect(tacticalAdjustment.adjusted_holdings.reduce((s, h) => s + h.adjusted_weight_pct, 0)).toBe(100);

    // Macro prompt block should be purely factual & neutral
    const macroText = formatMacroPromptBlock(DEFAULT_MACRO_SNAPSHOT);
    expect(macroText).not.toContain("短久期美元固收具备确定性票息保护");
    expect(macroText).not.toContain("高债务与地缘周期中黄金作为尾部避险");
  });

  it("strictly isolates pure ILAS and pure Non-ILAS funds across baskets, candidate pool, and AI tactical adjustments", () => {
    const mixedCatalog = [
      mkFund({ slug: "AIA_EQ1", code: "CG9", aia_code: "CG9", name: "AIA Global Equity", asset_class: "股票", ilas_platform: "AIA 卓达智悦2", role: "核心", fee_pct: 1.5 }),
      mkFund({ slug: "AIA_BD1", code: "B01", aia_code: "B01", name: "AIA Short Bond", asset_class: "固定收益", ilas_platform: "AIA 卓达智悦2", role: "核心", fee_pct: 0.7, benchmark_code: "BIL", is_distributing: true }),
      mkFund({ slug: "AIA_BD2", code: "M11", aia_code: "M11", name: "AIA Global Bond", asset_class: "固定收益", ilas_platform: "AIA 卓达智悦2", role: "核心", fee_pct: 0.9, benchmark_code: "AGG", is_distributing: true }),
      mkFund({ slug: "AIA_GLD", code: "G01", aia_code: "G01", name: "AIA World Gold", asset_class: "多元资产", ilas_platform: "AIA 卓达智悦2", role: "卫星", fee_pct: 1.7, benchmark_code: "GLD" }),
      mkFund({ slug: "AIA_HK", code: "A17", aia_code: "A17", name: "AIA Greater China", asset_class: "股票", ilas_platform: "AIA 卓达智悦2", role: "卫星", fee_pct: 1.8, benchmark_code: "2800.HK", is_distributing: true }),
      mkFund({ slug: "EXT_VOO", code: "VOO", name: "Vanguard S&P 500 ETF", asset_class: "股票", ilas_platform: "非投连险-国际股票", role: "核心", fee_pct: 0.03 }),
      mkFund({ slug: "EXT_AGG", code: "AGG", name: "iShares Core US Agg", asset_class: "固定收益", ilas_platform: "非投连险-债券基金比较", role: "核心", fee_pct: 0.03, benchmark_code: "AGG", is_distributing: true }),
      mkFund({ slug: "EXT_BIL", code: "BIL", name: "SPDR 1-3M T-Bill", asset_class: "固定收益", ilas_platform: "非投连险-货币基金", role: "核心", fee_pct: 0.14, benchmark_code: "BIL", is_distributing: true }),
      mkFund({ slug: "EXT_GLD", code: "GLD", name: "SPDR Gold Trust", asset_class: "多元资产", ilas_platform: "非投连险-国际股票", role: "卫星", fee_pct: 0.4, benchmark_code: "GLD" }),
      mkFund({ slug: "EXT_HK", code: "2800.HK", name: "Tracker Fund HK", asset_class: "股票", ilas_platform: "非投连险-港股通ETF", role: "卫星", fee_pct: 0.09, benchmark_code: "2800.HK", is_distributing: true }),
    ];

    // 1) product_scope="all", ilp_planned=false -> 100% pure Non-ILAS
    const offProf = normalizeProfile({ product_scope: "all", ilp_planned: false, risk_level: "balanced", horizon_years: 10 });
    const offRes = buildCustomFundBaskets(mixedCatalog as any, offProf, getRiskEnvelope(offProf));
    expect(offRes.baskets.length).toBeGreaterThanOrEqual(1);
    for (const b of offRes.baskets) {
      expect(b.universe_mode).toBe("non_ilas");
      expect(b.holdings.every((h) => !isIlasFund(h))).toBe(true);
    }

    // 2) product_scope="all", ilp_planned=true & product_scope="aia_tmp2" -> 100% pure ILAS
    const ilpAllProf = normalizeProfile({ product_scope: "all", ilp_planned: true, risk_level: "balanced", horizon_years: 10 });
    const ilpAllRes = buildCustomFundBaskets(mixedCatalog as any, ilpAllProf, getRiskEnvelope(ilpAllProf));
    for (const b of ilpAllRes.baskets) {
      expect(b.universe_mode).toBe("ilas");
      expect(b.holdings.every((h) => isIlasFund(h))).toBe(true);
    }

    const aiaProf = normalizeProfile({ product_scope: "aia_tmp2", ilp_planned: true, risk_level: "balanced", horizon_years: 10 });
    const aiaRes = buildCustomFundBaskets(mixedCatalog as any, aiaProf, getRiskEnvelope(aiaProf));
    for (const b of aiaRes.baskets) {
      expect(b.universe_mode).toBe("ilas");
      expect(b.holdings.every((h) => isIlasFund(h))).toBe(true);
    }

    // 3) bonds_income stays strictly isolated by ilp_planned
    const bondsOff = normalizeProfile({ product_scope: "bonds_income", ilp_planned: false, risk_level: "conservative", horizon_years: 5 });
    const bondsOffRes = buildCustomFundBaskets(mixedCatalog as any, bondsOff, getRiskEnvelope(bondsOff));
    for (const b of bondsOffRes.baskets) {
      expect(b.universe_mode).toBe("non_ilas");
      expect(b.holdings.every((h) => !isIlasFund(h))).toBe(true);
    }

    const bondsOn = normalizeProfile({ product_scope: "bonds_income", ilp_planned: true, risk_level: "conservative", horizon_years: 5 });
    const bondsOnRes = buildCustomFundBaskets(mixedCatalog as any, bondsOn, getRiskEnvelope(bondsOn));
    for (const b of bondsOnRes.baskets) {
      expect(b.universe_mode).toBe("ilas");
      expect(b.holdings.every((h) => isIlasFund(h))).toBe(true);
    }

    // 4) Candidate whitelist stays strictly inside same universe
    const ilasCands = buildTacticalCandidatePool(mixedCatalog as any, aiaProf, aiaRes.baskets[0].holdings, 14);
    expect(ilasCands.length).toBeGreaterThan(0);
    expect(ilasCands.every((c) => isIlasFund(c))).toBe(true);

    const offCands = buildTacticalCandidatePool(mixedCatalog as any, offProf, offRes.baskets[0].holdings, 14);
    expect(offCands.length).toBeGreaterThan(0);
    expect(offCands.every((c) => !isIlasFund(c))).toBe(true);

    // 5) extractAndNormalizeTacticalJson rejects cross-platform candidate even if injected
    const poisonedCandPool = [
      ...ilasCands,
      {
        slug: "EXT_GLD",
        lab_id: "GLD",
        code: "GLD",
        name: "SPDR Gold Trust (Cross-platform should be blocked)",
        asset_class: "多元资产",
        sleeve: "other" as const,
        core_role: "satellite" as const,
        homogeneity_cluster: "other|GOLD_COMMODITY",
        ilas_platform: "非投连险-国际股票",
        currency: "USD",
        fee_pct: 0.4,
        alpha_3y: null,
        r2_3y: null,
        beta_3y: null,
        vol_3y: null,
        div_yield_ttm: null,
        quant_grade: "A",
        is_distributing: false,
      },
    ];
    const llmWithCrossPlatform = `### 客观研判
仅可在纯投连险池内替换。

<tactical_json>
{
  "tactical_summary_zh": "新增黄金卫星",
  "adjusted_holdings": [
    { "lab_id": "CG9", "adjusted_weight_pct": 50, "reason_zh": "核心" },
    { "lab_id": "B01", "adjusted_weight_pct": 30, "reason_zh": "固收" },
    { "lab_id": "GLD", "adjusted_weight_pct": 20, "reason_zh": "跨平台应被拦截" }
  ]
}
</tactical_json>`;
    const normalized = extractAndNormalizeTacticalJson(
      llmWithCrossPlatform,
      aiaProf,
      aiaRes.baskets[0],
      poisonedCandPool
    );
    expect(normalized.tacticalAdjustment.adjusted_holdings.some((h) => h.lab_id === "GLD")).toBe(false);
  });

  it("enforces Ireland/Luxembourg UCITS funds on Non-ILAS recommendations when extra_notes mentions US estate tax", () => {
    const euAndUsCatalog = [
      { slug: "US_SPY", code: "SPY", yahoo_ticker: "SPY", name: "SPDR S&P 500 ETF Trust", asset_class: "股票", ilas_platform: "非投连险-国际股票", currency: "USD", fee_pct: 0.09, data_tier: "A", quant_score: 96, quant_grade: "A", ret_3y_ann: 0.16, vol_3y: 0.14, sharpe_3y: 1.1, is_distributing: true, tags: [] },
      { slug: "US_SCHD", code: "SCHD", yahoo_ticker: "SCHD", name: "Schwab US Dividend Equity ETF", asset_class: "股票", ilas_platform: "非投连险-美股分红型ETF", currency: "USD", fee_pct: 0.06, data_tier: "A", quant_score: 94, quant_grade: "A", ret_3y_ann: 0.12, vol_3y: 0.12, sharpe_3y: 1.0, div_yield_ttm: 0.04, is_distributing: true, tags: [] },
      { slug: "BD_BIL", code: "BIL", yahoo_ticker: "BIL", name: "SPDR Blmbg 1-3 Mth T-Bill ETF", asset_class: "固定收益", ilas_platform: "非投连险-债券基金比较", currency: "USD", fee_pct: 0.14, data_tier: "A", quant_score: 92, quant_grade: "A", ret_3y_ann: 0.05, vol_3y: 0.01, sharpe_3y: 1.6, is_distributing: true, tags: [] },
      { slug: "BD_USHY", code: "USHY", yahoo_ticker: "USHY", name: "Amundi Index Solution - Amundi USD High Yield", asset_class: "固定收益", ilas_platform: "非投连险-债券基金比较", currency: "USD", fee_pct: 0.15, data_tier: "A", quant_score: 80, quant_grade: "A", ret_3y_ann: 0.07, vol_3y: 0.06, sharpe_3y: 0.8, is_distributing: false, tags: [] },
      { slug: "BD_IWDA", code: "IWDA", yahoo_ticker: "IWDA.L", name: "iShares Core MSCI World UCITS ETF USD (Acc)", asset_class: "股票", ilas_platform: "非投连险-债券基金比较", currency: "USD", fee_pct: 0.2, data_tier: "A", quant_score: 76, quant_grade: "A", ret_3y_ann: 0.16, vol_3y: 0.13, sharpe_3y: 0.91, is_distributing: false, tags: [] },
      { slug: "BD_VHYD", code: "VHYD", yahoo_ticker: "VHYD.L", name: "Vanguard FTSE All-World High Dividend Yield UCITS ETF", asset_class: "股票", ilas_platform: "非投连险-债券基金比较", currency: "USD", fee_pct: 0.29, data_tier: "A", quant_score: 91, quant_grade: "A", ret_3y_ann: 0.17, vol_3y: 0.12, sharpe_3y: 1.15, div_yield_ttm: 0.038, is_distributing: true, tags: [] },
      { slug: "BD_VHYA", code: "VHYA", yahoo_ticker: "VHYA.L", name: "Vanguard FTSE All-World High Dividend Yield UCITS ETF Acc", asset_class: "股票", ilas_platform: "非投连险-债券基金比较", currency: "USD", fee_pct: 0.29, data_tier: "A", quant_score: 91, quant_grade: "A", ret_3y_ann: 0.17, vol_3y: 0.12, sharpe_3y: 1.11, is_distributing: false, tags: [] },
      { slug: "BD_JREG", code: "JREG", yahoo_ticker: "JREG.L", name: "JPMorgan ETFs (Ireland) ICAV - Global Research Enhanced", asset_class: "股票", ilas_platform: "非投连险-债券基金比较", currency: "USD", fee_pct: 0.25, data_tier: "A", quant_score: 74, quant_grade: "A", ret_3y_ann: 0.15, vol_3y: 0.13, sharpe_3y: 0.87, is_distributing: false, tags: [] },
      { slug: "BD_IB01", code: "IB01", yahoo_ticker: "IB01.L", name: "短期美债 iShares $ Treasury Bond 0-1yr UCITS ETF", asset_class: "固定收益", ilas_platform: "非投连险-债券基金比较", currency: "USD", fee_pct: 0.07, data_tier: "A", quant_score: 79, quant_grade: "A", ret_3y_ann: 0.045, vol_3y: 0.01, sharpe_3y: 1.29, is_distributing: false, tags: [] },
      { slug: "BD_CSH2", code: "CSH2", yahoo_ticker: "CSH2.L", name: "短期美债 Amundi Smart Overnight Return", asset_class: "固定收益", ilas_platform: "非投连险-债券基金比较", currency: "GBP", fee_pct: 0.1, data_tier: "A", quant_score: 83, quant_grade: "A", ret_3y_ann: 0.048, vol_3y: 0.01, sharpe_3y: 2.06, is_distributing: false, tags: [] },
      { slug: "BD_CBU7", code: "CBU7", yahoo_ticker: "CBU7.L", name: "CBU7 iShares $ Treasury Bond 3-7yr UCITS ETF", asset_class: "固定收益", ilas_platform: "非投连险-债券基金比较", currency: "USD", fee_pct: 0.07, data_tier: "A", quant_score: 31, quant_grade: "C", ret_3y_ann: 0.039, vol_3y: 0.05, sharpe_3y: -0.02, is_distributing: false, tags: [] },
      { slug: "Z01_F", code: "Z01", aia_code: "Z01", isin: "HK0000288743", name: "惠理高息股票", asset_class: "股票", ilas_platform: "AIA 卓达智悦2", currency: "USD", fee_pct: 1.25, data_tier: "B", quant_score: 78, quant_grade: "A", is_distributing: true, tags: [] },
    ];

    const estateProf = normalizeProfile({
      product_scope: "all",
      ilp_planned: false,
      risk_level: "balanced",
      horizon_years: 10,
      extra_notes: "客户为香港居民，十分关注美国遗产税风险，请配置非投连险欧洲基金",
    });
    expect(estateProf.extra_notes).toContain("美国遗产税");
    expect(hasUsEstateTaxConcern(estateProf)).toBe(true);

    const env = getRiskEnvelope(estateProf);
    const res = buildCustomFundBaskets(euAndUsCatalog as any, estateProf, env);
    expect(res.baskets.length).toBeGreaterThanOrEqual(1);
    for (const b of res.baskets) {
      expect(b.universe_mode).toBe("non_ilas");
      expect(b.us_estate_tax_shield).toBe(true);
      expect(b.holdings.every((h) => !isIlasFund(h) && isIrelandOrLuxembourgFund(h))).toBe(true);
      expect(b.holdings.some((h) => ["SPY", "SCHD", "BIL", "USHY"].includes(h.code))).toBe(false);
      // Share-class twin dedup: VHYD and VHYA should not appear together
      const codes = b.holdings.map((h) => h.code);
      expect(codes.includes("VHYD") && codes.includes("VHYA")).toBe(false);
    }

    // Classic templates also remap US ETFs to IE/LU UCITS
    const templates = matchClassicTemplates(estateProf, env);
    expect(templates.length).toBeGreaterThan(0);
    expect(templates[0].name_zh).toContain("UCITS");
    expect(
      templates[0].holdings.every((h) =>
        ["CSPX", "VWRA", "CNDX", "AGGU", "CBU0", "DTLA", "IBTA", "IWDA", "MXWO", "IWVL", "VHYD", "JREG", "CBU7", "IB01"].includes(
          h.isin
        )
      )
    ).toBe(true);

    // Tactical pool contains only IE/LU UCITS and rejects injected US SPY
    const cands = buildTacticalCandidatePool(euAndUsCatalog as any, estateProf, res.baskets[0].holdings, 14);
    expect(cands.every((c) => !isIlasFund(c) && isIrelandOrLuxembourgFund(c))).toBe(true);
    expect(getFundDomicile({ code: "USHY", yahoo_ticker: "USHY", ilas_platform: "非投连险-债券基金比较" })).toBe("US");

    const poisonedPool = [
      ...cands,
      {
        slug: "US_SPY",
        lab_id: "SPY",
        code: "SPY",
        isin: null,
        yahoo_ticker: "SPY",
        name: "SPDR S&P 500 ETF Trust",
        asset_class: "股票",
        sleeve: "equity" as const,
        core_role: "core" as const,
        homogeneity_cluster: "equity|US_BROAD",
        ilas_platform: "非投连险-国际股票",
        currency: "USD",
        fee_pct: 0.09,
        alpha_3y: null,
        r2_3y: null,
        beta_3y: null,
        vol_3y: null,
        div_yield_ttm: null,
        quant_grade: "A",
        is_distributing: true,
      },
    ];
    const llmOut = `<tactical_json>
{
  "tactical_summary_zh": "测试注入美股 ETF 拦截",
  "adjusted_holdings": [
    { "lab_id": "${res.baskets[0].holdings[0].lab_id}", "adjusted_weight_pct": 80, "reason_zh": "保留" },
    { "lab_id": "SPY", "adjusted_weight_pct": 20, "reason_zh": "应被遗产税规则拦截" }
  ]
}
</tactical_json>`;
    const normalized = extractAndNormalizeTacticalJson(llmOut, estateProf, res.baskets[0], poisonedPool);
    expect(normalized.tacticalAdjustment.adjusted_holdings.some((h) => h.lab_id === "SPY")).toBe(false);
  });

  it("normalizes GBp/GBP regimes, cleans UYLX pence dividends, and rejects corrupt catalog metrics", async () => {
    clearQuantStoreCaches();

    expect(normalizeMinorCurrency("GBp")).toEqual({ currency: "GBP", unitScale: 0.01 });
    expect(normalizeMinorCurrency("GBX")).toEqual({ currency: "GBP", unitScale: 0.01 });
    expect(normalizeMinorCurrency("GBP")).toEqual({ currency: "GBP", unitScale: 1 });
    expect(normalizeMinorCurrency("ZAc")).toEqual({ currency: "ZAR", unitScale: 0.01 });

    // Simulated BD_UYLX packed series: 100x spikes + pence dividends (4.8625 on GBP NAV, 4.598 on GBp NAV)
    const dates = [
      "2026-05-01",
      "2026-05-04",
      "2026-06-11",
      "2026-06-12",
      "2026-09-09",
      "2026-09-10",
      "2026-09-11",
      "2026-11-18",
      "2026-11-19",
      "2026-11-20",
    ];
    const navs = [3.71, 3.73, 3.767, 3.75, 360.1, 361.60001, 3.68, 3.72, 3.721, 3.72225];
    const adjs = [...navs];
    const rawDivs: Record<string, number> = {
      "2026-06-11": 4.8625,
      "2026-09-10": 4.598,
    };

    const directCleaned = sanitizeQuantSeries(dates, navs, adjs, rawDivs);
    expect(Math.max(...directCleaned.nav)).toBeLessThan(10);
    expect(directCleaned.dividends["2026-06-11"]).toBeCloseTo(0.048625, 5);
    expect(directCleaned.dividends["2026-09-10"]).toBeCloseTo(0.04598, 5);

    const { db } = createMockD1({
      funds: [
        {
          slug: "BD_UYLX",
          code: "UYLX",
          isin: "IE0006LBEDV2",
          yahoo_ticker: "UYLX.L",
          name: "UYLX ETF",
          asset_class: "固定收益",
          currency: "GBp",
          fee_pct: 20.0,
          duration: 120,
          yield_pct: 250000,
          is_distributing: 1,
          primary_source: "yfinance",
          data_tier: "A",
          is_trackable: 1,
          status: "active",
        },
      ],
      metrics: [
        {
          slug: "BD_UYLX",
          latest_nav: 3.72225,
          div_yield_ttm: 0.3,
          obs_days: 183,
          quant_grade: "B",
        },
      ],
      series: {
        BD_UYLX: {
          slug: "BD_UYLX",
          currency: "GBp",
          series_type: "market_etf",
          source: "yfinance",
          series_json: JSON.stringify({
            d: dates,
            n: navs,
            a: adjs,
            v: [
              [2, 4.8625],
              [5, 4.598],
            ],
          }),
        },
      },
    });

    const cat = await loadQuantCatalog(db);
    expect(cat.rows[0].currency).toBe("GBP");
    expect(cat.rows[0].fee_pct).toBeNull();
    expect(cat.rows[0].duration).toBeNull();
    expect(cat.rows[0].yield_pct).toBeNull();
    expect(cat.rows[0].div_yield_ttm).toBeNull();

    const unpacked = await getQuantFundSeries(db, "BD_UYLX");
    expect(unpacked?.currency).toBe("GBP");
    expect(Math.max(...(unpacked?.nav || []))).toBeLessThan(10);

    const dm = await getDividendMetrics(db, "UYLX");
    const impliedYield = dm.trailing_sum / 3.72225;
    expect(impliedYield).toBeGreaterThan(0.02);
    expect(impliedYield).toBeLessThan(0.04);
  });

  it("resolves UCITS LSE ticker aliases (VHYL/IBTU/IDUS/IDBT/EQQU) and dedupes Acc/Dist share twins", async () => {
    clearQuantStoreCaches();
    const { db } = createMockD1({
      funds: [
        { slug: "BD_VHYD", code: "VHYD", isin: "IE00B8GKDB10", yahoo_ticker: "VHYD.L", name: "Vanguard High Div (Dist)", asset_class: "股票", ilas_platform: "非投连险-国际股票", currency: "USD", fee_pct: 0.29, twin_code: "VHYA", is_distributing: 1, primary_source: "yfinance", data_tier: "A", is_trackable: 1, status: "active" },
        { slug: "EU_IB0D", code: "IB0D", isin: "IE00BGR7L912", yahoo_ticker: "IBTU.L", name: "iShares $ Treasury 0-1yr (Dist)", asset_class: "固定收益", ilas_platform: "非投连险-债券基金比较", currency: "USD", fee_pct: 0.07, twin_code: "IB01", is_distributing: 1, primary_source: "yfinance", data_tier: "A", is_trackable: 1, status: "active" },
        { slug: "EU_IUSA", code: "IUSA", isin: "IE0031442068", yahoo_ticker: "IDUS.L", name: "iShares Core S&P 500 (Dist)", asset_class: "股票", ilas_platform: "非投连险-国际股票", currency: "USD", fee_pct: 0.07, twin_code: "CSPX", is_distributing: 1, primary_source: "yfinance", data_tier: "A", is_trackable: 1, status: "active" },
        { slug: "EU_EQQQ", code: "EQQQ", isin: "IE0032077012", yahoo_ticker: "EQQU.L", name: "Invesco EQQQ Nasdaq-100 (Dist)", asset_class: "股票", ilas_platform: "非投连险-国际股票", currency: "USD", fee_pct: 0.30, twin_code: "EQAC", is_distributing: 1, primary_source: "yfinance", data_tier: "A", is_trackable: 1, status: "active" },
        { slug: "EU_IBTS", code: "IBTS", isin: "IE00B14X4S71", yahoo_ticker: "IDBT.L", name: "iShares $ Treasury 1-3yr (Dist)", asset_class: "固定收益", ilas_platform: "非投连险-债券基金比较", currency: "USD", fee_pct: 0.07, twin_code: "IBTA", is_distributing: 1, primary_source: "yfinance", data_tier: "A", is_trackable: 1, status: "active" },
      ],
    });

    expect((await resolveQuantFund(db, "VHYL"))?.slug).toBe("BD_VHYD");
    expect((await resolveQuantFund(db, "IBTU"))?.slug).toBe("EU_IB0D");
    expect((await resolveQuantFund(db, "IDUS"))?.slug).toBe("EU_IUSA");
    expect((await resolveQuantFund(db, "EQQU"))?.slug).toBe("EU_EQQQ");
    expect((await resolveQuantFund(db, "IDBT"))?.slug).toBe("EU_IBTS");

    // Ensure CSPX/IUSA and VWRA/VWRD Acc/Dist twins are never co-selected under income preference
    const twinCatalog = [
      { slug: "EU_CSPX", code: "CSPX", isin: "IE00B5BMR087", yahoo_ticker: "CSPX.L", name: "iShares Core S&P 500 UCITS ETF (Acc)", asset_class: "股票", ilas_platform: "非投连险-国际股票", currency: "USD", fee_pct: 0.07, data_tier: "A", quant_score: 96, quant_grade: "A", ret_3y_ann: 0.17, vol_3y: 0.14, sharpe_3y: 1.15, r2_3y: 0.99, beta_3y: 1.0, is_distributing: false, twin_code: "IUSA", tags: [] },
      { slug: "EU_IUSA", code: "IUSA", isin: "IE0031442068", yahoo_ticker: "IDUS.L", name: "iShares Core S&P 500 UCITS ETF (Dist)", asset_class: "股票", ilas_platform: "非投连险-国际股票", currency: "USD", fee_pct: 0.07, data_tier: "A", quant_score: 95, quant_grade: "A", ret_3y_ann: 0.17, vol_3y: 0.14, sharpe_3y: 1.14, r2_3y: 0.99, beta_3y: 1.0, div_yield_ttm: 0.01, is_distributing: true, twin_code: "CSPX", tags: [] },
      { slug: "EU_VWRA", code: "VWRA", isin: "IE00BK5BQT80", yahoo_ticker: "VWRA.L", name: "Vanguard FTSE All-World UCITS ETF (Acc)", asset_class: "股票", ilas_platform: "非投连险-国际股票", currency: "USD", fee_pct: 0.22, data_tier: "A", quant_score: 94, quant_grade: "A", ret_3y_ann: 0.16, vol_3y: 0.138, sharpe_3y: 1.1, is_distributing: false, twin_code: "VWRD", tags: [] },
      { slug: "EU_VWRD", code: "VWRD", isin: "IE00B3RBWM25", yahoo_ticker: "VWRD.L", name: "Vanguard FTSE All-World UCITS ETF (Dist)", asset_class: "股票", ilas_platform: "非投连险-国际股票", currency: "USD", fee_pct: 0.22, data_tier: "A", quant_score: 93, quant_grade: "A", ret_3y_ann: 0.16, vol_3y: 0.138, sharpe_3y: 1.09, div_yield_ttm: 0.015, is_distributing: true, twin_code: "VWRA", tags: [] },
      { slug: "EU_VDTY", code: "VDTY", isin: "IE00BZ163M45", yahoo_ticker: "VDTY.L", name: "Vanguard USD Treasury Bond UCITS ETF (Dist)", asset_class: "固定收益", ilas_platform: "非投连险-债券基金比较", currency: "USD", fee_pct: 0.07, data_tier: "A", quant_score: 84, quant_grade: "B", ret_3y_ann: 0.036, vol_3y: 0.046, sharpe_3y: 0.2, div_yield_ttm: 0.042, is_distributing: true, twin_code: "VDTA", tags: [] },
      { slug: "EU_IB0D", code: "IB0D", isin: "IE00BGR7L912", yahoo_ticker: "IBTU.L", name: "iShares $ Treasury Bond 0-1yr UCITS ETF (Dist)", asset_class: "固定收益", ilas_platform: "非投连险-债券基金比较", currency: "USD", fee_pct: 0.07, data_tier: "A", quant_score: 90, quant_grade: "A", ret_3y_ann: 0.045, vol_3y: 0.005, sharpe_3y: 1.4, div_yield_ttm: 0.038, is_distributing: true, twin_code: "IB01", tags: [] },
    ];
    const prof = normalizeProfile({
      product_scope: "eu_ucits",
      ilp_planned: false,
      risk_level: "balanced",
      horizon_years: 10,
      primary_goal: "income",
    });
    const res = buildCustomFundBaskets(twinCatalog as any, prof, getRiskEnvelope(prof));
    for (const b of res.baskets) {
      const codes = b.holdings.map((h) => h.code);
      expect(codes.includes("CSPX") && codes.includes("IUSA")).toBe(false);
      expect(codes.includes("VWRA") && codes.includes("VWRD")).toBe(false);
    }
  });

  it("unpacks compact delta dates (d0/dd), resolves bidirectional twins, classifies .L S&P 500 as US equity, and back-stitches young funds in StrategyLab", async () => {
    clearQuantStoreCaches();
    // 1. Compact delta-date unpacking with omitted `a`
    const recon = unpackSeriesDates({ d0: "2020-01-02", dd: [1, 3, 1] });
    expect(recon).toEqual(["2020-01-02", "2020-01-03", "2020-01-06", "2020-01-07"]);

    // 2. .L US broad equity classification check
    expect(classifyAsset("CSPX.L", "iShares Core S&P 500 UCITS ETF (Acc)").class_key).toBe("US_BROAD_EQUITY");
    expect(classifyAsset("SPYL", "SPDR S&P 500 UCITS ETF (Acc)").class_key).toBe("US_BROAD_EQUITY");
    expect(classifyAsset("IWDA.L", "iShares Core MSCI World UCITS ETF (Acc)").class_key).toBe("GLOBAL_DEVELOPED_EQUITY");

    // 3. Build 300-day history (2023-01-02 onward) for CSPX + SPY benchmark, and only 60-day history for SPYL
    const genDates = (startIso: string, count: number) => {
      const out: string[] = [];
      const cur = new Date(`${startIso}T00:00:00Z`);
      while (out.length < count) {
        if (cur.getUTCDay() !== 0 && cur.getUTCDay() !== 6) out.push(cur.toISOString().slice(0, 10));
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
      return out;
    };
    const longDates = genDates("2023-01-02", 300);
    const shortDates = longDates.slice(240); // 60 days starting way later (>90 calendar days gap)
    const ddLong = longDates.slice(1).map((d, idx) =>
      Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${longDates[idx]}T00:00:00Z`)) / 86400000)
    );
    const pxLong = longDates.map((_, i) => Number((400 * Math.pow(1.0004, i)).toFixed(4)));
    const pxShort = shortDates.map((_, i) => Number((12 * Math.pow(1.0004, i)).toFixed(4)));

    const { db } = createMockD1({
      funds: [
        { slug: "V02_F", code: "V02", aia_code: "V02", name: "惠理高息股票 (累積)", asset_class: "股票", ilas_platform: "AIA 卓达智悦2", currency: "USD", twin_code: null, is_distributing: 0, benchmark_code: "2800.HK", primary_source: "aia_fundinfo2", data_tier: "B", is_trackable: 1, status: "active" },
        { slug: "Z01_F", code: "Z01", aia_code: "Z01", name: "惠理高息股票 (派息)", asset_class: "股票", ilas_platform: "AIA 卓达智悦2", currency: "USD", twin_code: "V02", is_distributing: 1, benchmark_code: "2800.HK", primary_source: "aia_fundinfo2", data_tier: "B", is_trackable: 1, status: "active" },
        { slug: "EU_CSPX", code: "CSPX", yahoo_ticker: "CSPX.L", name: "iShares Core S&P 500 UCITS ETF (Acc)", asset_class: "股票", ilas_platform: "非投连险-国际股票", currency: "USD", fee_pct: 0.07, benchmark_code: "SPY", primary_source: "yfinance", data_tier: "A", is_trackable: 1, status: "active" },
        { slug: "EU_SPYL", code: "SPYL", yahoo_ticker: "SPYL.L", name: "SPDR S&P 500 UCITS ETF (Acc)", asset_class: "股票", ilas_platform: "非投连险-国际股票", currency: "USD", fee_pct: 0.03, benchmark_code: "SPY", primary_source: "yfinance", data_tier: "A", is_trackable: 1, status: "active" },
      ],
      series: {
        EU_CSPX: {
          slug: "EU_CSPX",
          currency: "USD",
          series_type: "market_etf",
          source: "yfinance",
          series_json: JSON.stringify({ d0: longDates[0], dd: ddLong, n: pxLong, t: "market_etf", s: "yfinance" }),
        },
        EU_SPYL: {
          slug: "EU_SPYL",
          currency: "USD",
          series_type: "market_etf",
          source: "yfinance",
          series_json: JSON.stringify({ d: shortDates, n: pxShort, t: "market_etf", s: "yfinance" }),
        },
      },
      benchmarks: {
        SPY: {
          code: "SPY",
          currency: "USD",
          series_json: JSON.stringify({ d0: longDates[0], dd: ddLong, c: pxLong }),
        },
      },
    });

    const cat = await loadQuantCatalog(db);
    const v02 = cat.lookup.get("V02");
    expect(v02?.twin_codes).toEqual(["Z01"]);
    expect(v02?.twin_funds?.[0]?.slug).toBe("Z01_F");

    const lab = new StrategyLab(db);
    const res = await lab.runAnalysis(["CSPX", "SPYL"], 5475, 0.7, { CSPX: 0.5, SPYL: 0.5 }, { capital: 100000, years: 10 }, 0.04, "raw", "USD");
    // Back-stitching preserves full ~300d window instead of truncating to SPYL's 60d window!
    expect(res.data_points).toBeGreaterThanOrEqual(290);
    expect(res.sample_window?.start_date).toBe(longDates[0]);
    expect(res.asset_stats["SPYL"].backstitched_from).toBe(shortDates[0]);

    // 4. Institutional Core vs. Satellite enforcement overrides stale legacy role='核心' on HY & EM funds
    expect(inferFundRole({ code: "I28", aia_code: "I28", name: "貝萊德環球高收益債券基金", asset_class: "固定收益", role: "核心" } as any)).toBe("satellite");
    expect(inferFundRole({ code: "F16", aia_code: "F16", name: "摩根環球債券收益基金", asset_class: "固定收益", role: "核心" } as any)).toBe("satellite");
    expect(inferFundRole({ code: "J07", aia_code: "J07", name: "施羅德新興市場債券", asset_class: "固定收益", role: "核心" } as any)).toBe("satellite");
    expect(inferFundRole({ code: "NB1", aia_code: "NB1", name: "路博邁新興市場債券", asset_class: "固定收益", role: "核心" } as any)).toBe("satellite");
    expect(inferFundRole({ code: "HYG", name: "iShares iBoxx $ High Yield Corp Bd ETF", asset_class: "固定收益", benchmark_code: "HYG" } as any)).toBe("satellite");
    expect(inferFundRole({ code: "VWO", name: "Vanguard FTSE Emerging Markets ETF", asset_class: "股票" } as any)).toBe("satellite");
    expect(inferFundRole({ code: "CSPX", name: "iShares Core S&P 500 UCITS ETF (Acc)", asset_class: "股票" } as any)).toBe("core");
    expect(inferFundRole({ code: "AGG", name: "iShares Core US Aggregate Bond ETF", asset_class: "固定收益" } as any)).toBe("core");
    expect(inferFundRole({ code: "A05", aia_code: "A05", name: "PineBridge Hong Kong Dollar Money Market Fund", asset_class: "货币基金" } as any)).toBe("core");
    expect(inferFundRole({ code: "CG9", aia_code: "CG9", name: "Capital Group Global Corporate Bond (LUX)", asset_class: "固定收益" } as any)).toBe("core");
    expect(inferFundRole({ code: "VHYD", name: "Vanguard FTSE All-World High Dividend Yield UCITS ETF", asset_class: "股票" } as any)).toBe("core");
    expect(inferFundRole({ code: "SCHD", name: "美国红利股ETF", asset_class: "股票" } as any)).toBe("core");
    expect(inferFundRole({ code: "I17", aia_code: "I17", name: "贝莱德系统分析环球股票高息基金", asset_class: "股票" } as any)).toBe("core");
    expect(inferFundRole({ code: "Z01", aia_code: "Z01", name: "惠理高息股票基金 (亚太)", asset_class: "股票" } as any)).toBe("satellite");
    expect(inferFundRole({ code: "DIVO", name: "Amplify CWP Enhanced Dividend Income ETF", asset_class: "股票" } as any)).toBe("satellite");
  });

  it("prioritizes admin core picks as first-tier selections with elevated weights while respecting isolation & tax rules", () => {
    const mockCatalog = [
      // Equity Core 1: Admin Core Pick (slightly lower quant_score than rival EQ_RIVAL, still should win & get higher weight)
      {
        slug: "EU_CSPX", code: "CSPX", isin: "IE00B5BMR087", yahoo_ticker: "CSPX.L",
        name: "iShares Core S&P 500 UCITS ETF (Acc)", asset_class: "股票", ilas_platform: "非投连险-国际股票",
        currency: "USD", fee_pct: 0.07, data_tier: "A", quant_score: 82, quant_grade: "B",
        ret_3y_ann: 0.14, vol_3y: 0.15, sharpe_3y: 0.9, r2_3y: 0.99, beta_3y: 1.0,
        is_distributing: false, tags: [], is_admin_core_pick: true, admin_core_reasons: ["核心美国", "低波动增强"],
      },
      // Equity Core 2: Rival Non-Admin US Broad (higher quant_score 95, should NOT beat admin core pick, and should yield higher weight to admin pick)
      {
        slug: "EU_SPYL", code: "SPYL", isin: "IE000XZSV718", yahoo_ticker: "SPYL.L",
        name: "SPDR S&P 500 UCITS ETF (Acc)", asset_class: "股票", ilas_platform: "非投连险-国际股票",
        currency: "USD", fee_pct: 0.03, data_tier: "A", quant_score: 95, quant_grade: "A",
        ret_3y_ann: 0.16, vol_3y: 0.15, sharpe_3y: 1.05, r2_3y: 0.99, beta_3y: 1.0,
        is_distributing: false, tags: [],
      },
      // Equity Core 3: Non-Admin Global Developed Broad
      {
        slug: "EU_IWDA", code: "IWDA", isin: "IE00B4L5Y983", yahoo_ticker: "IWDA.L",
        name: "iShares Core MSCI World UCITS ETF (Acc)", asset_class: "股票", ilas_platform: "非投连险-国际股票",
        currency: "USD", fee_pct: 0.2, data_tier: "A", quant_score: 91, quant_grade: "A",
        ret_3y_ann: 0.13, vol_3y: 0.14, sharpe_3y: 0.85, r2_3y: 0.98, beta_3y: 0.98,
        is_distributing: false, tags: [],
      },
      // Equity Satellite: Admin Core Pick tagged as 卫星行业
      {
        slug: "EU_IUIT", code: "IUIT", isin: "IE00B3WJKG14", yahoo_ticker: "IUIT.L",
        name: "iShares S&P 500 Info Tech Sector UCITS ETF", asset_class: "股票", ilas_platform: "非投连险-国际股票",
        currency: "USD", fee_pct: 0.15, data_tier: "A", quant_score: 79, quant_grade: "B",
        ret_3y_ann: 0.18, vol_3y: 0.22, sharpe_3y: 0.8, is_distributing: false, tags: [],
        is_admin_core_pick: true, admin_core_reasons: ["卫星行业"],
      },
      // Equity Satellite Rival (higher raw score but not admin pick)
      {
        slug: "EU_EIMI", code: "EIMI", isin: "IE00BKM4GZ66", yahoo_ticker: "EIMI.L",
        name: "iShares Core MSCI EM IMI UCITS ETF", asset_class: "股票", ilas_platform: "非投连险-国际股票",
        currency: "USD", fee_pct: 0.18, data_tier: "A", quant_score: 94, quant_grade: "A",
        ret_3y_ann: 0.11, vol_3y: 0.17, sharpe_3y: 0.65, is_distributing: false, tags: [],
      },
      // Bond Core 1: Admin Core Pick
      {
        slug: "EU_IB01", code: "IB01", isin: "IE00BGSF1X88", yahoo_ticker: "IB01.L",
        name: "iShares $ Treasury Bond 0-1yr UCITS ETF", asset_class: "固定收益", ilas_platform: "非投连险-债券基金比较",
        currency: "USD", fee_pct: 0.07, data_tier: "A", quant_score: 88, quant_grade: "A",
        ret_3y_ann: 0.048, vol_3y: 0.008, sharpe_3y: 2.1, is_distributing: false, tags: [],
        is_admin_core_pick: true, admin_core_reasons: ["核心固收", "低波动增强"],
      },
      // Bond Core 2: Rival Bond
      {
        slug: "EU_AGGU", code: "AGGU", isin: "IE00BDBRDM35", yahoo_ticker: "AGGU.L",
        name: "iShares Core Global Aggregate Bond UCITS ETF", asset_class: "固定收益", ilas_platform: "非投连险-债券基金比较",
        currency: "USD", fee_pct: 0.1, data_tier: "A", quant_score: 84, quant_grade: "B",
        ret_3y_ann: 0.03, vol_3y: 0.055, sharpe_3y: 0.25, is_distributing: false, tags: [],
      },
      // US-situs ETF (also marked admin pick to verify US estate tax hard isolation still excludes it in eu_ucits mode!)
      {
        slug: "US_VOO", code: "VOO", isin: "US9229083632", yahoo_ticker: "VOO",
        name: "Vanguard S&P 500 ETF", asset_class: "股票", ilas_platform: "非投连险-国际股票",
        currency: "USD", fee_pct: 0.03, data_tier: "A", quant_score: 99, quant_grade: "A",
        ret_3y_ann: 0.17, vol_3y: 0.15, sharpe_3y: 1.15, is_distributing: false, tags: [],
        is_admin_core_pick: true, admin_core_reasons: ["核心美国"],
      },
      // ILAS fund (also marked admin pick to verify ILAS isolation still excludes it in non-ILAS baskets!)
      {
        slug: "AIA_A22", code: "A22", aia_code: "A22",
        name: "AIA 全球股票核心基金", asset_class: "股票", ilas_platform: "AIA 卓达智悦2",
        currency: "USD", fee_pct: 1.2, data_tier: "B", quant_score: 95, quant_grade: "A",
        ret_3y_ann: 0.15, vol_3y: 0.15, sharpe_3y: 0.9, is_distributing: false, tags: [],
        is_admin_core_pick: true, admin_core_reasons: ["核心全球"],
      },
    ];

    expect(resolveEffectiveFundRole(mockCatalog[0] as any)).toBe("core");
    expect(resolveEffectiveFundRole(mockCatalog[3] as any)).toBe("satellite");

    const prof = normalizeProfile({
      product_scope: "eu_ucits",
      ilp_planned: false,
      risk_level: "growth",
      horizon_years: 15,
      primary_goal: "growth",
    });
    const res = buildCustomFundBaskets(mockCatalog as any, prof, getRiskEnvelope(prof));
    const planA = res.baskets[0];
    const codesA = planA.holdings.map((h) => h.code);

    // 1. Admin core picks are selected first within matching universe
    expect(codesA).toContain("CSPX");
    expect(codesA).toContain("IUIT");
    expect(codesA).toContain("IB01");
    // 2. Hard constraints remain intact: VOO (US-situs) & A22 (ILAS) are excluded under eu_ucits
    expect(codesA).not.toContain("VOO");
    expect(codesA).not.toContain("A22");
    // 3. Elevated weight for admin equity core pick vs non-admin equity core sibling
    const cspx = planA.holdings.find((h) => h.code === "CSPX")!;
    const iwda = planA.holdings.find((h) => h.code === "IWDA");
    expect(cspx.is_admin_core_pick).toBe(true);
    expect(cspx.admin_core_reasons).toEqual(["核心美国", "低波动增强"]);
    expect(cspx.rationale_zh).toContain("管理员核心推荐");
    if (iwda) {
      expect(cspx.weight_pct).toBeGreaterThan(iwda.weight_pct);
    }
    // Core-Satellite constraint remains intact (>= 70% core)
    expect(planA.metrics.core_pct).toBeGreaterThanOrEqual(70);

    // 4. Tactical candidate pool propagates admin core pick metadata
    const pool = buildTacticalCandidatePool(
      mockCatalog as any,
      prof,
      [{ code: "IWDA" }],
      10
    );
    const poolCspx = pool.find((c) => c.code === "CSPX");
    expect(poolCspx?.is_admin_core_pick).toBe(true);
    expect(poolCspx?.admin_core_reasons).toEqual(["核心美国", "低波动增强"]);
  });
});

describe("HK Broker platform product scope (hk_broker)", () => {
  it("distinguishes IE/LU UCITS ETFs from IE/LU mutual funds and US/HK/JP ETFs", () => {
    // IE/LU UCITS ETFs -> true (excluded in hk_broker)
    expect(isIrelandOrLuxembourgEtf({ code: "CSPX", yahoo_ticker: "CSPX.L", isin: "IE00B5BMR087", name: "iShares Core S&P 500 UCITS ETF" })).toBe(true);
    expect(isIrelandOrLuxembourgEtf({ code: "VWRA", yahoo_ticker: "VWRA.L", isin: "IE00BK5BQT80", name: "Vanguard FTSE All-World UCITS ETF" })).toBe(true);
    expect(isIrelandOrLuxembourgEtf({ code: "IB01", yahoo_ticker: "IB01.L", isin: "IE00BGSF1X88", name: "iShares $ Treasury Bond 0-1yr UCITS ETF" })).toBe(true);
    expect(isIrelandOrLuxembourgEtf({ code: "CSH2", yahoo_ticker: "CSH2.L", isin: "LU1230136894", name: "短期美债" })).toBe(true);
    expect(isIrelandOrLuxembourgEtf({ code: "PRIP", yahoo_ticker: "PRIP.DE", isin: "LU2089238203", name: "Amundi Prime US Corporates" })).toBe(true);
    expect(isIrelandOrLuxembourgEtf({ code: "I37MXN", yahoo_ticker: "I37MXN.MX", isin: "IE00BD8PGZ49", name: "iShares $ Treasury Bond 3-7yr" })).toBe(true);
    expect(
      isIrelandOrLuxembourgEtf({
        code: "USHY",
        yahoo_ticker: "USHY",
        isin: null,
        name: "Amundi Index Solution - Amundi USD High Yield Corporate Bond ESG UCITS ETF Dis",
      })
    ).toBe(true);

    // IE/LU Mutual Funds (SICAV / Unit Trust) -> false (eligible on HK brokers)
    expect(
      isIrelandOrLuxembourgEtf({
        code: "CG9",
        isin: "LU1746179297",
        yahoo_ticker: null,
        name: "Capital International 基金 - 資本集團全球公司債券基金（盧森堡）B 美元類別",
      })
    ).toBe(false);
    expect(
      isIrelandOrLuxembourgEtf({
        code: "L51",
        isin: "IE00B2Q1FD82",
        yahoo_ticker: null,
        name: "Franklin Templeton Global Funds plc - FTGF Western Asset Asian Opportunities Fund - Class A ACC",
      })
    ).toBe(false);
    expect(
      isIrelandOrLuxembourgEtf({
        code: "I17",
        isin: "LU0265550359",
        yahoo_ticker: null,
        name: "貝萊德系統分析環球股票高息基金 A2 美元",
      })
    ).toBe(false);

    // US / HK / JP ETFs -> false (eligible on HK brokers)
    expect(isIrelandOrLuxembourgEtf({ code: "VOO", isin: "US9229083632", yahoo_ticker: "VOO", name: "Vanguard S&P 500 ETF" })).toBe(false);
    expect(isIrelandOrLuxembourgEtf({ code: "SCHD", isin: "US8085247976", yahoo_ticker: "SCHD", name: "Schwab US Dividend Equity ETF" })).toBe(false);
    expect(isIrelandOrLuxembourgEtf({ code: "9096.HK", isin: "HK0000849809", yahoo_ticker: "9096.HK", name: "CSOP USD Money Market ETF" })).toBe(false);
    expect(isIrelandOrLuxembourgEtf({ code: "1306.T", isin: "JP3027630007", yahoo_ticker: "1306.T", name: "NEXT FUNDS TOPIX ETF" })).toBe(false);

    // Non-public ILAS-only code without public ISIN -> ineligible for hk_broker
    expect(isHkBrokerEligibleFund({ code: "A22", aia_code: "A22", isin: null, ilas_platform: "AIA 卓达智悦2", name: "AIA 内部专享基金" })).toBe(false);
    expect(isHkBrokerEligibleFund({ code: "CG9", aia_code: "CG9", isin: "LU1746179297", ilas_platform: "AIA 卓达智悦2", name: "Capital Group Global Corporate Bond (LUX)" })).toBe(true);
  });

  it("buildCustomFundBaskets and buildTacticalCandidatePool exclude IE/LU UCITS ETFs while retaining IE/LU mutual funds and US/HK ETFs", () => {
    const catalog = [
      // IE/LU UCITS ETFs (even admin core pick must be strictly excluded!)
      {
        slug: "IE_CSPX", code: "CSPX", isin: "IE00B5BMR087", yahoo_ticker: "CSPX.L",
        name: "iShares Core S&P 500 UCITS ETF", asset_class: "股票", ilas_platform: "非投连险-国际股票",
        currency: "USD", fee_pct: 0.07, data_tier: "A", quant_score: 99, quant_grade: "A",
        ret_3y_ann: 0.16, vol_3y: 0.14, sharpe_3y: 1.1, is_distributing: false, tags: [],
        is_admin_core_pick: true, admin_core_reasons: ["核心美国"],
      },
      {
        slug: "IE_IB01", code: "IB01", isin: "IE00BGSF1X88", yahoo_ticker: "IB01.L",
        name: "iShares $ Treasury Bond 0-1yr UCITS ETF", asset_class: "固定收益", ilas_platform: "非投连险-债券基金比较",
        currency: "USD", fee_pct: 0.07, data_tier: "A", quant_score: 98, quant_grade: "A",
        ret_3y_ann: 0.05, vol_3y: 0.01, sharpe_3y: 2.0, is_distributing: false, tags: [],
        is_admin_core_pick: true, admin_core_reasons: ["低波动增强"],
      },
      {
        slug: "BD_USHY", code: "USHY", isin: null, yahoo_ticker: "USHY",
        name: "Amundi Index Solution - Amundi USD High Yield Corporate Bond ESG UCITS ETF Dis", asset_class: "固定收益", ilas_platform: "非投连险-债券基金比较",
        currency: "USD", fee_pct: 0.30, data_tier: "A", quant_score: 90, quant_grade: "A",
        ret_3y_ann: 0.07, vol_3y: 0.07, sharpe_3y: 0.8, is_distributing: true, tags: [],
      },
      // Eligible US & HK ETFs
      {
        slug: "US_VOO", code: "VOO", isin: "US9229083632", yahoo_ticker: "VOO",
        name: "Vanguard S&P 500 ETF", asset_class: "股票", ilas_platform: "非投连险-国际股票",
        currency: "USD", fee_pct: 0.03, data_tier: "A", quant_score: 96, quant_grade: "A",
        ret_3y_ann: 0.16, vol_3y: 0.14, sharpe_3y: 1.05, is_distributing: false, tags: [],
      },
      {
        slug: "US_AGG", code: "AGG", isin: "US4642872265", yahoo_ticker: "AGG",
        name: "iShares Core U.S. Aggregate Bond ETF", asset_class: "固定收益", ilas_platform: "非投连险-债券基金比较",
        currency: "USD", fee_pct: 0.03, data_tier: "A", quant_score: 88, quant_grade: "B",
        ret_3y_ann: 0.04, vol_3y: 0.06, sharpe_3y: 0.5, is_distributing: true, tags: [],
      },
      {
        slug: "HK_9096", code: "9096.HK", isin: "HK0000849809", yahoo_ticker: "9096.HK",
        name: "CSOP USD Money Market ETF", asset_class: "固定收益", ilas_platform: "非投连险-货币基金",
        currency: "USD", fee_pct: 0.35, data_tier: "A", quant_score: 86, quant_grade: "B",
        ret_3y_ann: 0.05, vol_3y: 0.005, sharpe_3y: 2.1, is_distributing: false, tags: [],
      },
      // Eligible LU/IE Mutual Funds (SFC-authorized retail funds)
      {
        slug: "CG9_F", code: "CG9", aia_code: "CG9", isin: "LU1746179297",
        name: "Capital International 基金 - 資本集團全球公司債券基金（盧森堡）B 美元類別",
        asset_class: "固定收益", ilas_platform: "AIA 卓达智悦2",
        currency: "USD", fee_pct: 1.04, data_tier: "A", quant_score: 89, quant_grade: "B",
        ret_3y_ann: 0.05, vol_3y: 0.05, sharpe_3y: 0.65, is_distributing: false, tags: [],
      },
      {
        slug: "I17_F", code: "I17", aia_code: "I17", isin: "LU0265550359",
        name: "貝萊德系統分析環球股票高息基金 A2 美元",
        asset_class: "股票", ilas_platform: "AIA 卓达智悦2",
        currency: "USD", fee_pct: 1.50, data_tier: "A", quant_score: 91, quant_grade: "A",
        ret_3y_ann: 0.12, vol_3y: 0.13, sharpe_3y: 0.85, is_distributing: true, tags: [],
      },
      {
        slug: "M11_F", code: "M11", aia_code: "M11", isin: "LU0261946288",
        name: "富達基金 - 環球債券基金 A類別股份 - 累積 - 美元",
        asset_class: "固定收益", ilas_platform: "AIA 卓达智悦2",
        currency: "USD", fee_pct: 0.71, data_tier: "A", quant_score: 85, quant_grade: "B",
        ret_3y_ann: 0.04, vol_3y: 0.05, sharpe_3y: 0.55, is_distributing: false, tags: [],
      },
      {
        slug: "L51_F", code: "L51", aia_code: "L51", isin: "IE00B2Q1FD82",
        name: "Franklin Templeton Global Funds plc - FTGF Western Asset Asian Opportunities Fund - Class A ACC",
        asset_class: "固定收益", ilas_platform: "AIA 卓达智悦2",
        currency: "USD", fee_pct: 1.15, data_tier: "A", quant_score: 80, quant_grade: "B",
        ret_3y_ann: 0.04, vol_3y: 0.06, sharpe_3y: 0.45, is_distributing: false, tags: [],
      },
    ];

    const hkProf = normalizeProfile({
      product_scope: "hk_broker",
      ilp_planned: false,
      risk_level: "balanced",
      horizon_years: 10,
      primary_goal: "balanced",
    });
    expect(hkProf.product_scope).toBe("hk_broker");

    const res = buildCustomFundBaskets(catalog as any, hkProf, getRiskEnvelope(hkProf));
    expect(res.baskets.length).toBeGreaterThanOrEqual(1);
    for (const b of res.baskets) {
      expect(b.universe_mode).toBe("hk_broker");
      const codes = b.holdings.map((h) => h.code);
      expect(codes).not.toContain("CSPX");
      expect(codes).not.toContain("IB01");
      expect(codes).not.toContain("USHY");
      expect(b.holdings.some((h) => h.code === "CG9" || h.code === "I17" || h.code === "VOO")).toBe(true);
    }

    // resolveBasketUniverseMode preserves hk_broker even when basket contains AIA-tagged LU mutual fund
    expect(
      resolveBasketUniverseMode(hkProf, res.baskets[0].holdings as any, catalog as any)
    ).toBe("hk_broker");

    const pool = buildTacticalCandidatePool(catalog as any, hkProf, [{ code: "VOO" }], 14);
    const poolCodes = pool.map((c) => c.code);
    expect(poolCodes).not.toContain("CSPX");
    expect(poolCodes).not.toContain("IB01");
    expect(poolCodes).not.toContain("USHY");
    expect(poolCodes.some((c) => c === "CG9" || c === "I17" || c === "AGG")).toBe(true);

    // Combined hk_broker + US estate tax concern: keeps IE/LU mutual funds only, excludes BOTH IE/LU ETFs AND US ETFs
    const hkTaxProf = normalizeProfile({
      product_scope: "hk_broker",
      ilp_planned: false,
      risk_level: "balanced",
      horizon_years: 10,
      extra_notes: "关注美国遗产税风险（非美居民6万美元免税额上限）",
    });
    const taxRes = buildCustomFundBaskets(catalog as any, hkTaxProf, getRiskEnvelope(hkTaxProf));
    const taxCodes = taxRes.baskets[0].holdings.map((h) => h.code);
    expect(taxRes.baskets[0].us_estate_tax_shield).toBe(true);
    expect(taxCodes).not.toContain("CSPX");
    expect(taxCodes).not.toContain("IB01");
    expect(taxCodes).not.toContain("VOO");
    expect(taxCodes).not.toContain("AGG");
    expect(taxCodes.some((c) => c === "CG9" || c === "I17" || c === "M11")).toBe(true);
  });

  it("extractAndNormalizeTacticalJson rejects IE/LU UCITS ETF swaps under hk_broker mode", () => {
    const baseRec = {
      universe_mode: "hk_broker",
      holdings: [
        { lab_id: "VOO", slug: "US_VOO", code: "VOO", name: "Vanguard S&P 500 ETF", asset_class: "股票", core_role: "core", weight_pct: 60 },
        { lab_id: "CG9", slug: "CG9_F", code: "CG9", isin: "LU1746179297", name: "Capital Group Global Corporate Bond (LUX)", asset_class: "固定收益", core_role: "core", ilas_platform: "AIA 卓达智悦2", weight_pct: 40 },
      ],
    };
    const pool: any[] = [
      {
        slug: "IE_CSPX", lab_id: "CSPX", code: "CSPX", isin: "IE00B5BMR087", yahoo_ticker: "CSPX.L",
        name: "iShares Core S&P 500 UCITS ETF", asset_class: "股票", sleeve: "equity", core_role: "core",
        homogeneity_cluster: "us_large_cap", ilas_platform: "非投连险-国际股票", currency: "USD",
        fee_pct: 0.07, alpha_3y: 0, r2_3y: 1, beta_3y: 1, vol_3y: 0.14, div_yield_ttm: 0.01, quant_grade: "A", is_distributing: false,
      },
      {
        slug: "HK_9096", lab_id: "9096.HK", code: "9096.HK", isin: "HK0000849809", yahoo_ticker: "9096.HK",
        name: "CSOP USD Money Market ETF", asset_class: "固定收益", sleeve: "bond", core_role: "core",
        homogeneity_cluster: "usd_mmf", ilas_platform: "非投连险-货币基金", currency: "USD",
        fee_pct: 0.35, alpha_3y: 0, r2_3y: 0.9, beta_3y: 0, vol_3y: 0.005, div_yield_ttm: 0.04, quant_grade: "B", is_distributing: false,
      },
    ];
    const llmReply = `报告正文

\`\`\`json
{
  "tactical_summary_zh": "测试调仓",
  "adjusted_holdings": [
    { "lab_id": "VOO", "adjusted_weight_pct": 50, "reason_zh": "保留美股" },
    { "lab_id": "CG9", "adjusted_weight_pct": 30, "reason_zh": "保留卢森堡互惠债基" },
    { "lab_id": "CSPX", "adjusted_weight_pct": 10, "reason_zh": "试图换入爱尔兰ETF" },
    { "lab_id": "9096.HK", "adjusted_weight_pct": 10, "reason_zh": "增配港币/美元货币ETF" }
  ],
  "lab_directives": { "rebalance_freq": "Q" }
}
\`\`\``;

    const { tacticalAdjustment } = extractAndNormalizeTacticalJson(
      llmReply,
      { product_scope: "hk_broker" },
      baseRec,
      pool
    );
    const outIds = tacticalAdjustment.adjusted_holdings
      .filter((h) => h.adjusted_weight_pct > 0)
      .map((h) => h.lab_id);
    expect(outIds).not.toContain("CSPX");
    expect(outIds).toContain("9096.HK");
    expect(outIds).toContain("CG9");
    expect(outIds).toContain("VOO");
  });

  it("hk_broker_etf keeps only pure low-fee US/HK/JP ETFs while excluding IE/LU ETFs and all mutual funds", () => {
    // isUsMutualFund & isHkBrokerLowFeeEtf classification
    expect(isUsMutualFund({ code: "VBIRX", yahoo_ticker: "VBIRX" })).toBe(true);
    expect(isUsMutualFund({ code: "VSBSX", yahoo_ticker: "VSBSX" })).toBe(true);
    expect(isUsMutualFund({ code: "BSBSX", yahoo_ticker: "BSBSX" })).toBe(true);
    expect(isUsMutualFund({ code: "BOXX", yahoo_ticker: "BOXX" })).toBe(false);
    expect(isUsMutualFund({ code: "9096.HK", yahoo_ticker: "9096.HK" })).toBe(false);

    expect(
      isHkBrokerLowFeeEtf({ code: "VOO", isin: "US9229083632", yahoo_ticker: "VOO", name: "Vanguard S&P 500 ETF", ilas_platform: "非投连险-国际股票" })
    ).toBe(true);
    expect(
      isHkBrokerLowFeeEtf({ code: "9096.HK", yahoo_ticker: "9096.HK", name: "CSOP USD Money Market ETF", ilas_platform: "非投连险-货币基金" })
    ).toBe(true);
    expect(
      isHkBrokerLowFeeEtf({ code: "1306.T", yahoo_ticker: "1306.T", name: "NEXT FUNDS TOPIX ETF", ilas_platform: "非投连险-日本宽基ETF" })
    ).toBe(true);
    expect(
      isHkBrokerLowFeeEtf({ code: "CSPX", isin: "IE00B5BMR087", yahoo_ticker: "CSPX.L", name: "iShares Core S&P 500 UCITS ETF", ilas_platform: "非投连险-国际股票" })
    ).toBe(false);
    expect(
      isHkBrokerLowFeeEtf({ code: "VBIRX", yahoo_ticker: "VBIRX", name: "Vanguard Short-Term Bond Index", ilas_platform: "非投连险-债券基金比较" })
    ).toBe(false);
    expect(
      isHkBrokerLowFeeEtf({ code: "CG9", aia_code: "CG9", isin: "LU1746179297", name: "Capital Group Global Corporate Bond (LUX)", ilas_platform: "AIA 卓达智悦2" })
    ).toBe(false);

    const catalog = [
      // IE/LU UCITS ETFs (even admin core pick must be strictly excluded!)
      {
        slug: "IE_CSPX", code: "CSPX", isin: "IE00B5BMR087", yahoo_ticker: "CSPX.L",
        name: "iShares Core S&P 500 UCITS ETF", asset_class: "股票", ilas_platform: "非投连险-国际股票",
        currency: "USD", fee_pct: 0.07, data_tier: "A", quant_score: 99, quant_grade: "A",
        ret_3y_ann: 0.16, vol_3y: 0.14, sharpe_3y: 1.1, is_distributing: false, tags: [],
        is_admin_core_pick: true, admin_core_reasons: ["核心美国"],
      },
      {
        slug: "IE_IB01", code: "IB01", isin: "IE00BGSF1X88", yahoo_ticker: "IB01.L",
        name: "iShares $ Treasury Bond 0-1yr UCITS ETF", asset_class: "固定收益", ilas_platform: "非投连险-债券基金比较",
        currency: "USD", fee_pct: 0.07, data_tier: "A", quant_score: 98, quant_grade: "A",
        ret_3y_ann: 0.05, vol_3y: 0.01, sharpe_3y: 2.0, is_distributing: false, tags: [],
        is_admin_core_pick: true, admin_core_reasons: ["低波动增强"],
      },
      // US open-end mutual fund (excluded in pure ETF mode)
      {
        slug: "BD_VBIRX", code: "VBIRX", isin: null, yahoo_ticker: "VBIRX",
        name: "Vanguard Short-Term Bond Index", asset_class: "固定收益", ilas_platform: "非投连险-债券基金比较",
        currency: "USD", fee_pct: 0.07, data_tier: "A", quant_score: 94, quant_grade: "A",
        ret_3y_ann: 0.04, vol_3y: 0.03, sharpe_3y: 1.2, is_distributing: true, tags: [],
      },
      // LU retail mutual fund under AIA (excluded in pure ETF mode)
      {
        slug: "CG9_F", code: "CG9", aia_code: "CG9", isin: "LU1746179297",
        name: "Capital Group Global Corporate Bond (LUX)", asset_class: "固定收益", ilas_platform: "AIA 卓达智悦2",
        currency: "USD", fee_pct: 1.04, data_tier: "A", quant_score: 95, quant_grade: "A",
        ret_3y_ann: 0.05, vol_3y: 0.05, sharpe_3y: 0.7, is_distributing: false, tags: [],
      },
      // Pure low-fee US/HK/JP ETFs
      {
        slug: "US_VOO", code: "VOO", isin: "US9229083632", yahoo_ticker: "VOO",
        name: "Vanguard S&P 500 ETF", asset_class: "股票", ilas_platform: "非投连险-国际股票",
        currency: "USD", fee_pct: 0.03, data_tier: "A", quant_score: 96, quant_grade: "A",
        ret_3y_ann: 0.16, vol_3y: 0.14, sharpe_3y: 1.05, is_distributing: false, tags: [],
      },
      {
        slug: "US_SCHD", code: "SCHD", isin: "US8085247976", yahoo_ticker: "SCHD",
        name: "Schwab US Dividend Equity ETF", asset_class: "股票", ilas_platform: "非投连险-美股分红型ETF",
        currency: "USD", fee_pct: 0.06, data_tier: "A", quant_score: 90, quant_grade: "A",
        ret_3y_ann: 0.11, vol_3y: 0.13, sharpe_3y: 0.75, is_distributing: true, tags: [],
      },
      {
        slug: "US_AGG", code: "AGG", isin: "US4642872265", yahoo_ticker: "AGG",
        name: "iShares Core U.S. Aggregate Bond ETF", asset_class: "固定收益", ilas_platform: "非投连险-债券基金比较",
        currency: "USD", fee_pct: 0.03, data_tier: "A", quant_score: 88, quant_grade: "B",
        ret_3y_ann: 0.04, vol_3y: 0.06, sharpe_3y: 0.5, is_distributing: true, tags: [],
      },
      {
        slug: "HK_9096", code: "9096.HK", isin: "HK0000849809", yahoo_ticker: "9096.HK",
        name: "CSOP USD Money Market ETF", asset_class: "固定收益", ilas_platform: "非投连险-货币基金",
        currency: "USD", fee_pct: 0.35, data_tier: "A", quant_score: 86, quant_grade: "B",
        ret_3y_ann: 0.05, vol_3y: 0.005, sharpe_3y: 2.1, is_distributing: false, tags: [],
      },
    ];

    const prof = normalizeProfile({
      product_scope: "hk_broker_etf",
      ilp_planned: false,
      risk_level: "balanced",
      horizon_years: 10,
      extra_notes: "关注美国遗产税风险（即便备注遗产税，纯低费ETF模式也不应回流IE/LU ETF）",
    });
    expect(prof.product_scope).toBe("hk_broker_etf");

    const res = buildCustomFundBaskets(catalog as any, prof, getRiskEnvelope(prof));
    expect(res.baskets.length).toBeGreaterThanOrEqual(1);
    for (const b of res.baskets) {
      expect(b.universe_mode).toBe("non_ilas");
      expect(b.hk_broker_etf_only).toBe(true);
      expect(b.us_estate_tax_shield).toBe(false);
      const codes = b.holdings.map((h) => h.code);
      expect(codes).not.toContain("CSPX");
      expect(codes).not.toContain("IB01");
      expect(codes).not.toContain("VBIRX");
      expect(codes).not.toContain("CG9");
      expect(codes.some((c) => c === "VOO" || c === "SCHD" || c === "AGG" || c === "9096.HK")).toBe(true);
    }

    const pool = buildTacticalCandidatePool(catalog as any, prof, [{ code: "VOO" }], 14);
    const poolCodes = pool.map((c) => c.code);
    expect(poolCodes).not.toContain("CSPX");
    expect(poolCodes).not.toContain("IB01");
    expect(poolCodes).not.toContain("VBIRX");
    expect(poolCodes).not.toContain("CG9");
    expect(poolCodes.some((c) => c === "SCHD" || c === "AGG" || c === "9096.HK")).toBe(true);

    // LLM tactical guard blocks IE/LU ETFs, ILAS/LU mutual funds, and US mutual funds under hk_broker_etf
    const baseRec = {
      universe_mode: "non_ilas",
      hk_broker_etf_only: true,
      holdings: [
        { lab_id: "VOO", slug: "US_VOO", code: "VOO", name: "Vanguard S&P 500 ETF", asset_class: "股票", core_role: "core", weight_pct: 60 },
        { lab_id: "AGG", slug: "US_AGG", code: "AGG", name: "iShares Core U.S. Aggregate Bond ETF", asset_class: "固定收益", core_role: "core", weight_pct: 40 },
      ],
    };
    const tacticalPool: any[] = [
      {
        slug: "IE_CSPX", lab_id: "CSPX", code: "CSPX", isin: "IE00B5BMR087", yahoo_ticker: "CSPX.L",
        name: "iShares Core S&P 500 UCITS ETF", asset_class: "股票", sleeve: "equity", core_role: "core",
        homogeneity_cluster: "us_large_cap", ilas_platform: "非投连险-国际股票", currency: "USD",
        fee_pct: 0.07, alpha_3y: 0, r2_3y: 1, beta_3y: 1, vol_3y: 0.14, div_yield_ttm: 0.01, quant_grade: "A", is_distributing: false,
      },
      {
        slug: "BD_VBIRX", lab_id: "VBIRX", code: "VBIRX", isin: null, yahoo_ticker: "VBIRX",
        name: "Vanguard Short-Term Bond Index", asset_class: "固定收益", sleeve: "bond", core_role: "core",
        homogeneity_cluster: "us_short_bond", ilas_platform: "非投连险-债券基金比较", currency: "USD",
        fee_pct: 0.07, alpha_3y: 0, r2_3y: 0.9, beta_3y: 0.2, vol_3y: 0.03, div_yield_ttm: 0.04, quant_grade: "A", is_distributing: true,
      },
      {
        slug: "CG9_F", lab_id: "CG9", code: "CG9", isin: "LU1746179297", yahoo_ticker: null,
        name: "Capital Group Global Corporate Bond (LUX)", asset_class: "固定收益", sleeve: "bond", core_role: "core",
        homogeneity_cluster: "global_corp_bond", ilas_platform: "AIA 卓达智悦2", currency: "USD",
        fee_pct: 1.04, alpha_3y: 0, r2_3y: 0.9, beta_3y: 0.2, vol_3y: 0.05, div_yield_ttm: 0.04, quant_grade: "A", is_distributing: false,
      },
      {
        slug: "HK_9096", lab_id: "9096.HK", code: "9096.HK", isin: "HK0000849809", yahoo_ticker: "9096.HK",
        name: "CSOP USD Money Market ETF", asset_class: "固定收益", sleeve: "bond", core_role: "core",
        homogeneity_cluster: "usd_mmf", ilas_platform: "非投连险-货币基金", currency: "USD",
        fee_pct: 0.35, alpha_3y: 0, r2_3y: 0.9, beta_3y: 0, vol_3y: 0.005, div_yield_ttm: 0.04, quant_grade: "B", is_distributing: false,
      },
    ];
    const llmReply = `正文

\`\`\`json
{
  "tactical_summary_zh": "测试纯ETF拦截",
  "adjusted_holdings": [
    { "lab_id": "VOO", "adjusted_weight_pct": 40, "reason_zh": "保留" },
    { "lab_id": "AGG", "adjusted_weight_pct": 20, "reason_zh": "保留" },
    { "lab_id": "CSPX", "adjusted_weight_pct": 15, "reason_zh": "IE ETF应被拦截" },
    { "lab_id": "VBIRX", "adjusted_weight_pct": 10, "reason_zh": "US互惠基金应被拦截" },
    { "lab_id": "CG9", "adjusted_weight_pct": 5, "reason_zh": "LU互惠基金应被拦截" },
    { "lab_id": "9096.HK", "adjusted_weight_pct": 10, "reason_zh": "允许港元/美元货币ETF" }
  ],
  "lab_directives": { "rebalance_freq": "Q" }
}
\`\`\``;
    const { tacticalAdjustment } = extractAndNormalizeTacticalJson(
      llmReply,
      { product_scope: "hk_broker_etf" },
      baseRec,
      tacticalPool
    );
    const activeIds = tacticalAdjustment.adjusted_holdings
      .filter((h) => h.adjusted_weight_pct > 0)
      .map((h) => h.lab_id);
    expect(activeIds).not.toContain("CSPX");
    expect(activeIds).not.toContain("VBIRX");
    expect(activeIds).not.toContain("CG9");
    expect(activeIds).toContain("9096.HK");
    expect(activeIds).toContain("VOO");
    expect(activeIds).toContain("AGG");
  });
});
