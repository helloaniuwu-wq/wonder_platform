import { beforeEach, describe, expect, it } from "vitest";
import { clearQuantStoreCaches } from "./quantStore";
import { computeCovarianceAnalytics, computeFullPortfolioXRay } from "./portfolioXRayService";

function createXRayMockDb(opts: {
  funds?: Array<Record<string, any>>;
  series?: Record<string, { currency: string; dates: string[]; adj_nav: number[] }>;
  sopReports?: Record<string, Record<string, any>>;
} = {}): D1Database {
  const funds = opts.funds || [];
  const series = opts.series || {};
  const sopReports = opts.sopReports || {};
  const queue: Record<string, any> = {};

  const prepare = (sql: string) => {
    let params: unknown[] = [];
    const stmt = {
      bind: (...args: unknown[]) => {
        params = args;
        return stmt;
      },
      first: async <T = unknown>(): Promise<T | null> => {
        if (sql.includes("FROM wq_fund_series WHERE slug = ?")) {
          const slug = String(params[0]);
          const s = series[slug];
          if (!s) return null;
          return {
            slug,
            currency: s.currency,
            series_type: "market_etf",
            source: "test",
            series_json: JSON.stringify({ d: s.dates, n: s.adj_nav, a: s.adj_nav }),
          } as T;
        }
        if (sql.includes("FROM wq_fund_sop_reports WHERE slug = ?")) {
          return (sopReports[String(params[0])] || null) as T | null;
        }
        if (sql.includes("FROM wq_fund_research_queue WHERE slug = ?")) {
          return (queue[String(params[0])] || null) as T | null;
        }
        return null;
      },
      all: async <T = unknown>() => {
        if (sql.includes("FROM wq_funds f")) {
          const results = funds.map((f) => {
            const sr = sopReports[f.slug];
            return {
              ...f,
              has_sop_report: sr ? 1 : 0,
              sop_medal: sr?.medal_rating || null,
              sop_pillar_score: sr?.pillar_score ?? null,
              sop_valuation_zone: sr?.valuation_zone || null,
              sop_report_date: sr?.report_date || null,
              sop_valuation_pct_5y: sr?.valuation_pct_5y ?? null,
              sop_dividend_yield_ttm: sr?.dividend_yield_ttm ?? null,
              sop_dividend_spread_rf: sr?.dividend_spread_rf ?? null,
              sop_red_flag_top: sr?.red_flag_top || null,
              research_queue_status: queue[f.slug]?.status || null,
              research_request_count: queue[f.slug]?.request_count || 0,
              research_requesters_json: queue[f.slug]?.requesters_json || "[]",
            };
          });
          return { results: results as T[], success: true, meta: {} };
        }
        return { results: [] as T[], success: true, meta: {} };
      },
      run: async () => ({ success: true, meta: { changes: 1 } }),
    };
    return stmt;
  };

  return { prepare } as unknown as D1Database;
}

describe("computeFullPortfolioXRay", () => {
  beforeEach(() => {
    clearQuantStoreCaches();
  });

  it("merges direct stocks with fund top_holdings and detects overlap", async () => {
    const db = createXRayMockDb({
      funds: [
        {
          slug: "US_QQQ",
          code: "QQQ",
          name: "Invesco QQQ Trust",
          asset_class: "股票",
          currency: "USD",
          fee_pct: 0.2,
          morningstar_stars: 5,
          is_trackable: 1,
          primary_source: "yfinance",
          top_holdings_json: JSON.stringify({
            holdings: [
              { symbol: "AAPL", name: "Apple Inc", weight_pct: 10 },
              { symbol: "MSFT", name: "Microsoft Corp", weight_pct: 9 },
            ],
          }),
          xray_profile_json: JSON.stringify({
            asset_split: { equity: 100, bond: 0, cash: 0, other: 0 },
            sectors: { information_technology: 60, communication_services: 15, consumer_discretionary: 25 },
            regions: { north_america: 98, developed_asia_other: 2 },
            equity_style: { size: "large", style: "growth" },
            valuation: { pe: 31.2 },
          }),
        },
        {
          slug: "US_VOO",
          code: "VOO",
          name: "Vanguard S&P 500 ETF",
          asset_class: "股票",
          currency: "USD",
          fee_pct: 0.03,
          morningstar_stars: 5,
          is_trackable: 1,
          primary_source: "yfinance",
          top_holdings_json: JSON.stringify({
            holdings: [
              { symbol: "AAPL", name: "Apple Inc", weight_pct: 7 },
              { symbol: "MSFT", name: "Microsoft Corp", weight_pct: 6.5 },
            ],
          }),
        },
      ],
    });

    const res = await computeFullPortfolioXRay(db, {
      holdings: [
        { isin: "QQQ", weight: 0.5 },
        { isin: "VOO", weight: 0.3 },
        { isin: "AAPL", name: "Apple Inc.", weight: 0.2, asset_type: "stock", sector: "Information Technology", country: "USA" },
      ],
      total_nav: 100000,
      include_stress: false,
    });

    expect(res.summary.instrument_mix.funds_pct).toBeCloseTo(80, 1);
    expect(res.summary.instrument_mix.direct_stocks_pct).toBeCloseTo(20, 1);

    const aapl = res.underlying_holdings.items.find((x) => x.key === "aapl");
    expect(aapl).toBeDefined();
    // 0.5 * 10% (5%) + 0.3 * 7% (2.1%) + direct 20% = 27.1%
    expect(aapl!.total_weight_pct).toBeCloseTo(27.1, 1);
    expect(aapl!.direct_weight_pct).toBeCloseTo(20, 1);
    expect(aapl!.fund_weight_pct).toBeCloseTo(7.1, 1);
    expect(res.overlap.pairs.length).toBeGreaterThan(0);
    expect(res.diagnostics.some((d) => d.text.includes("Apple"))).toBe(true);
  });

  it("aggregates direct bonds with bond funds for duration, rate shock, and fixed income style box", async () => {
    const db = createXRayMockDb({
      funds: [
        {
          slug: "Z29_F",
          code: "Z29",
          name: "Capital Group Global Corp Bond",
          asset_class: "债券",
          currency: "USD",
          fee_pct: 1.1,
          duration: 5.6,
          yield_pct: 5.4,
          avg_rating: "A",
          is_trackable: 1,
          primary_source: "aia",
          xray_profile_json: JSON.stringify({
            asset_split: { equity: 0, bond: 98, cash: 2, other: 0 },
            bond_style: { credit: "high", sensitivity: "moderate" },
            bond_ratings: { aaa: 2, aa: 14, a: 40, bbb: 44 },
          }),
        },
      ],
      sopReports: {
        Z29_F: {
          slug: "Z29_F",
          medal_rating: "Neutral",
          pillar_score: 0.35,
          valuation_zone: "合理中性",
          dividend_yield_ttm: 5.0,
          red_flag_top: "费率透明度欠缺，零售费用可能侵蚀信用利差",
        },
      },
    });

    const res = await computeFullPortfolioXRay(db, {
      holdings: [
        { isin: "Z29", weight: 0.5 },
        { isin: "US10Y_BOND", name: "US Treasury 10Y Note", weight: 0.5, asset_type: "bond", duration: 8.0, ytm: 4.5, credit_rating: "AAA" },
      ],
      total_nav: 200000,
      include_stress: false,
    });

    expect(res.summary.instrument_mix.direct_bonds_pct).toBeCloseTo(50, 1);
    expect(res.style_boxes.fixed_income.weighted_duration).toBeCloseTo(6.8, 1);
    expect(res.style_boxes.fixed_income.rate_shock_plus_100bps_pct).toBeCloseTo(-6.8, 1);
    expect(res.style_boxes.fixed_income.grid.high_moderate).toBeCloseTo(50, 1);
    expect(res.style_boxes.fixed_income.grid.high_extensive).toBeCloseTo(50, 1);
    expect(res.valuation_cashflow_sop.sop_covered_count).toBe(1);
    expect(res.valuation_cashflow_sop.red_flags.length).toBe(1);
  });

  it("computes real covariance volatility lower than linear sum and risk contributions summing to 100%", () => {
    const dates: string[] = [];
    const navA: Record<string, number> = {};
    const navB: Record<string, number> = {};
    let pa = 100;
    let pb = 100;
    const base = new Date("2025-01-01T00:00:00Z");
    for (let i = 0; i < 90; i++) {
      const dt = new Date(base.getTime() + i * 86400000).toISOString().slice(0, 10);
      dates.push(dt);
      const ra = i % 2 === 0 ? 0.012 : -0.008;
      const rb = i % 2 === 0 ? -0.007 : 0.011;
      pa *= 1 + ra;
      pb *= 1 + rb;
      navA[dt] = pa;
      navB[dt] = pb;
    }

    const risk = computeCovarianceAnalytics([
      { code: "A", name: "Asset A", weight: 0.5, series: navA },
      { code: "B", name: "Asset B", weight: 0.5, series: navB },
    ]);

    expect(risk.true_portfolio_vol_pct).not.toBeNull();
    expect(risk.linear_weighted_vol_pct).not.toBeNull();
    expect(risk.true_portfolio_vol_pct!).toBeLessThan(risk.linear_weighted_vol_pct!);
    expect(risk.diversification_benefit_pct!).toBeGreaterThan(20);
    const totalRc = risk.risk_contributions.reduce((s, r) => s + r.risk_contrib_pct, 0);
    expect(totalRc).toBeCloseTo(100, 0);
  });
});
