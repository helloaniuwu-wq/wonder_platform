import { beforeEach, describe, expect, it, vi } from "vitest";
import { countBusinessDaysBetween, runQuantWatchdog } from "./quantWatchdog";
import {
  clearQuantStoreCaches,
  convertSeriesCurrency,
  getQuantFundSeries,
  resolveQuantFund,
} from "./quantStore";
import { StrategyLab, classifyAsset, createPrng } from "./fip/strategyLab";
import { PortfolioEngine } from "./fip/portfolioEngine";
import {
  buildCustomFundBaskets,
  getRiskEnvelope,
  matchClassicTemplates,
  normalizeProfile,
} from "./advisoryEngine";
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
    expect(res.text).toContain("Higher for Longer");
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
  it("routes deepseek-pro (and legacy auto/reasoner) to DeepSeek V4 Pro with thinking enabled and >=6144 max_tokens", async () => {
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
      expect(calls[0].body.thinking).toEqual({ type: "enabled" });
      expect(calls[0].body.reasoning_effort).toBe("high");
      expect(calls[0].body.max_tokens).toBeGreaterThanOrEqual(6144);
      expect(res.provider).toBe("deepseek");
      expect(res.modelUsed).toBe("deepseek-v4-pro");
      expect(res.reasoning).toContain("SPY ERP");

      // Legacy "auto" should also map to deepseek-pro
      const resLegacy = await callLlmChat(env, "分析组合", { modelPreference: "auto" });
      expect(resLegacy.modelUsed).toBe("deepseek-v4-pro");
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
