/**
 * quantStore.ts — D1 Free-Tier Ultra-Low-Read Data Layer for Wonder Quant.
 *
 * Quota-saving architecture:
 * - Catalog + latest metrics (~306 rows) cached in Worker isolate memory for 5 minutes.
 * - Packed single-row time-series (wq_fund_series / wq_fx_series / wq_benchmark_series)
 *   cost ONLY 1 D1 row read per instrument, cached in memory for 30 minutes.
 */

export interface QuantFundCatalogRow {
  slug: string;
  code: string;
  aia_code: string | null;
  isin: string | null;
  yahoo_ticker: string | null;
  cn_code: string | null;
  name: string;
  name_en: string | null;
  manager: string | null;
  asset_class: string;
  ilas_platform: string | null;
  currency: string;
  risk_class: string | null;
  morningstar_stars: number | null;
  fee_pct: number | null;
  role: string | null;
  fit_plans: string[];
  tags: string[];
  commentary: string | null;
  twin_code: string | null;
  is_distributing: boolean;
  benchmark_code: string;
  primary_source: string;
  data_tier: string;
  is_trackable: boolean;
  status: string;
  // Fixed income & external quote metadata (0007)
  duration?: number | null;
  yield_pct?: number | null;
  avg_rating?: string | null;
  credit_quality?: string | null;
  morningstar_url?: string | null;
  top_holding_keys?: string[];
  // Metrics joined from wq_fund_metrics
  as_of_date: string | null;
  valuation_date: string | null;
  latest_nav: number | null;
  ret_1m: number | null;
  ret_3m: number | null;
  ret_6m: number | null;
  ret_ytd: number | null;
  ret_1y: number | null;
  ret_3y_ann: number | null;
  ret_5y_ann: number | null;
  vol_1y: number | null;
  vol_3y: number | null;
  max_dd_1y: number | null;
  max_dd_3y: number | null;
  max_dd_5y: number | null;
  dd_recovery_days: number | null;
  sharpe_3y: number | null;
  sortino_3y: number | null;
  calmar_3y: number | null;
  beta_3y: number | null;
  alpha_3y: number | null;
  r2_3y: number | null;
  ir_3y: number | null;
  div_yield_ttm: number | null;
  peer_rank_pct: number | null;
  quant_score: number | null;
  quant_grade: string | null;
  obs_days: number;
  anomalies: string[];
}

export interface UnpackedFundSeries {
  slug: string;
  currency: string;
  series_type: string;
  source: string;
  dates: string[];
  nav: number[];
  adj_nav: number[];
  dividends: Record<string, number>;
}

export interface UnpackedFxSeries {
  pair: string;
  latest_rate: number;
  dates: string[];
  rates: number[];
}

export interface UnpackedBenchmarkSeries {
  code: string;
  currency: string;
  dates: string[];
  close: number[];
  adj_close: number[];
}

const CATALOG_TTL_MS = 5 * 60 * 1000;
const SERIES_TTL_MS = 30 * 60 * 1000;

let catalogCache: {
  rows: QuantFundCatalogRow[];
  lookup: Map<string, QuantFundCatalogRow>;
  expiresAt: number;
} | null = null;

const seriesCache = new Map<string, { data: UnpackedFundSeries | null; expiresAt: number }>();
const fxSeriesCache = new Map<string, { data: UnpackedFxSeries | null; expiresAt: number }>();
const bmSeriesCache = new Map<string, { data: UnpackedBenchmarkSeries | null; expiresAt: number }>();

export function clearQuantStoreCaches(): void {
  catalogCache = null;
  seriesCache.clear();
  fxSeriesCache.clear();
  bmSeriesCache.clear();
}

function safeJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

const GENERIC_HOLDING_STOPWORDS = new Set([
  "cash",
  "money market",
  "sl agency",
  "treasury bill",
  "t-bill",
  "currency",
  "usd",
  "hkd",
  "eur",
  "cny",
  "rmb",
  "cash collateral",
  "cash & equivalents",
  "现金",
  "货币",
]);

export function extractHoldingKeys(rawJson: string | null | undefined): string[] {
  if (!rawJson) return [];
  try {
    const parsed = JSON.parse(rawJson);
    const list = Array.isArray(parsed?.holdings) ? parsed.holdings : Array.isArray(parsed) ? parsed : [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of list) {
      const sym = String(item?.symbol || "").trim();
      const name = String(item?.name || "").trim();
      const rawKey = (sym && sym.length >= 2 && sym.toLowerCase() !== "null" ? sym : name)
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, " ")
        .trim();
      if (!rawKey || rawKey.length < 2) continue;
      if (GENERIC_HOLDING_STOPWORDS.has(rawKey) || rawKey.includes("cash funds") || rawKey.includes("sl agency")) {
        continue;
      }
      // Compact normalized fingerprint (first 24 chars without spaces)
      const norm = rawKey.replace(/\s+/g, "").slice(0, 24);
      if (norm && !seen.has(norm)) {
        seen.add(norm);
        out.push(norm);
        if (out.length >= 10) break;
      }
    }
    return out;
  } catch {
    return [];
  }
}

export async function loadQuantCatalog(db: D1Database): Promise<{
  rows: QuantFundCatalogRow[];
  lookup: Map<string, QuantFundCatalogRow>;
}> {
  if (catalogCache && catalogCache.expiresAt > Date.now()) {
    return catalogCache;
  }

  try {
    let results: any[] | undefined;
    try {
      const res = await db
        .prepare(
          `SELECT
            f.slug, f.code, f.aia_code, f.isin, f.yahoo_ticker, f.cn_code,
            f.name, f.name_en, f.manager, f.asset_class, f.ilas_platform,
            f.currency, f.risk_class, f.morningstar_stars, f.fee_pct, f.role,
            f.fit_plans_json, f.tags_json, f.commentary, f.twin_code,
            f.is_distributing, f.benchmark_code, f.primary_source,
            COALESCE(m.data_tier, f.data_tier) AS data_tier,
            f.is_trackable, f.status,
            f.duration, f.yield_pct, f.avg_rating, f.credit_quality, f.morningstar_url, f.top_holdings_json,
            m.as_of_date, m.valuation_date, m.latest_nav,
            m.ret_1m, m.ret_3m, m.ret_6m, m.ret_ytd, m.ret_1y, m.ret_3y_ann, m.ret_5y_ann,
            m.vol_1y, m.vol_3y, m.max_dd_1y, m.max_dd_3y, m.max_dd_5y, m.dd_recovery_days,
            m.sharpe_3y, m.sortino_3y, m.calmar_3y, m.beta_3y, m.alpha_3y, m.r2_3y, m.ir_3y,
            m.div_yield_ttm, m.peer_rank_pct, m.quant_score, m.quant_grade,
            COALESCE(m.obs_days, 0) AS obs_days, m.anomalies_json
           FROM wq_funds f
           LEFT JOIN wq_fund_metrics m ON m.slug = f.slug
           WHERE f.is_trackable = 1`
        )
        .all<any>();
      results = res.results;
    } catch {
      const res = await db
        .prepare(
          `SELECT
            f.slug, f.code, f.aia_code, f.isin, f.yahoo_ticker, f.cn_code,
            f.name, f.name_en, f.manager, f.asset_class, f.ilas_platform,
            f.currency, f.risk_class, f.morningstar_stars, f.fee_pct, f.role,
            f.fit_plans_json, f.tags_json, f.commentary, f.twin_code,
            f.is_distributing, f.benchmark_code, f.primary_source,
            COALESCE(m.data_tier, f.data_tier) AS data_tier,
            f.is_trackable, f.status,
            m.as_of_date, m.valuation_date, m.latest_nav,
            m.ret_1m, m.ret_3m, m.ret_6m, m.ret_ytd, m.ret_1y, m.ret_3y_ann, m.ret_5y_ann,
            m.vol_1y, m.vol_3y, m.max_dd_1y, m.max_dd_3y, m.max_dd_5y, m.dd_recovery_days,
            m.sharpe_3y, m.sortino_3y, m.calmar_3y, m.beta_3y, m.alpha_3y, m.r2_3y, m.ir_3y,
            m.div_yield_ttm, m.peer_rank_pct, m.quant_score, m.quant_grade,
            COALESCE(m.obs_days, 0) AS obs_days, m.anomalies_json
           FROM wq_funds f
           LEFT JOIN wq_fund_metrics m ON m.slug = f.slug
           WHERE f.is_trackable = 1`
        )
        .all<any>();
      results = res.results;
    }

    const rows: QuantFundCatalogRow[] = (results || []).map((r) => ({
      slug: r.slug,
      code: r.code || r.slug,
      aia_code: r.aia_code || null,
      isin: r.isin || null,
      yahoo_ticker: r.yahoo_ticker || null,
      cn_code: r.cn_code || null,
      name: r.name,
      name_en: r.name_en || null,
      manager: r.manager || null,
      asset_class: r.asset_class,
      ilas_platform: r.ilas_platform || null,
      currency: (r.currency || "USD").toUpperCase(),
      risk_class: r.risk_class || null,
      morningstar_stars: r.morningstar_stars != null ? Number(r.morningstar_stars) : null,
      fee_pct: r.fee_pct != null ? Number(r.fee_pct) : null,
      role: r.role || null,
      fit_plans: safeJsonArray(r.fit_plans_json),
      tags: safeJsonArray(r.tags_json),
      commentary: r.commentary || null,
      twin_code: r.twin_code || null,
      is_distributing: Boolean(r.is_distributing),
      benchmark_code: r.benchmark_code || "SPY",
      primary_source: r.primary_source || "none",
      data_tier: r.data_tier || "U",
      is_trackable: Boolean(r.is_trackable),
      status: r.status || "active",
      duration: r.duration != null ? Number(r.duration) : null,
      yield_pct: r.yield_pct != null ? Number(r.yield_pct) : null,
      avg_rating: r.avg_rating || null,
      credit_quality: r.credit_quality || null,
      morningstar_url: r.morningstar_url || null,
      top_holding_keys: extractHoldingKeys(r.top_holdings_json),
      as_of_date: r.as_of_date || null,
      valuation_date: r.valuation_date || null,
      latest_nav: r.latest_nav != null ? Number(r.latest_nav) : null,
      ret_1m: r.ret_1m != null ? Number(r.ret_1m) : null,
      ret_3m: r.ret_3m != null ? Number(r.ret_3m) : null,
      ret_6m: r.ret_6m != null ? Number(r.ret_6m) : null,
      ret_ytd: r.ret_ytd != null ? Number(r.ret_ytd) : null,
      ret_1y: r.ret_1y != null ? Number(r.ret_1y) : null,
      ret_3y_ann: r.ret_3y_ann != null ? Number(r.ret_3y_ann) : null,
      ret_5y_ann: r.ret_5y_ann != null ? Number(r.ret_5y_ann) : null,
      vol_1y: r.vol_1y != null ? Number(r.vol_1y) : null,
      vol_3y: r.vol_3y != null ? Number(r.vol_3y) : null,
      max_dd_1y: r.max_dd_1y != null ? Number(r.max_dd_1y) : null,
      max_dd_3y: r.max_dd_3y != null ? Number(r.max_dd_3y) : null,
      max_dd_5y: r.max_dd_5y != null ? Number(r.max_dd_5y) : null,
      dd_recovery_days: r.dd_recovery_days != null ? Number(r.dd_recovery_days) : null,
      sharpe_3y: r.sharpe_3y != null ? Number(r.sharpe_3y) : null,
      sortino_3y: r.sortino_3y != null ? Number(r.sortino_3y) : null,
      calmar_3y: r.calmar_3y != null ? Number(r.calmar_3y) : null,
      beta_3y: r.beta_3y != null ? Number(r.beta_3y) : null,
      alpha_3y: r.alpha_3y != null ? Number(r.alpha_3y) : null,
      r2_3y: r.r2_3y != null ? Number(r.r2_3y) : null,
      ir_3y: r.ir_3y != null ? Number(r.ir_3y) : null,
      div_yield_ttm: r.div_yield_ttm != null ? Number(r.div_yield_ttm) : null,
      peer_rank_pct: r.peer_rank_pct != null ? Number(r.peer_rank_pct) : null,
      quant_score: r.quant_score != null ? Number(r.quant_score) : null,
      quant_grade: r.quant_grade || null,
      obs_days: Number(r.obs_days || 0),
      anomalies: safeJsonArray(r.anomalies_json),
    }));

    const lookup = new Map<string, QuantFundCatalogRow>();
    for (const row of rows) {
      const keys = [row.slug, row.aia_code, row.isin, row.yahoo_ticker, row.cn_code, row.code];
      for (const k of keys) {
        if (!k) continue;
        const up = k.trim().toUpperCase();
        if (!lookup.has(up)) {
          lookup.set(up, row);
        }
      }
      // Always let exact slug win
      lookup.set(row.slug.toUpperCase(), row);
    }

    catalogCache = { rows, lookup, expiresAt: Date.now() + CATALOG_TTL_MS };
    return catalogCache;
  } catch {
    return { rows: [], lookup: new Map() };
  }
}

export async function resolveQuantFund(
  db: D1Database,
  identifier: string
): Promise<QuantFundCatalogRow | null> {
  if (!identifier) return null;
  const { lookup } = await loadQuantCatalog(db);
  return lookup.get(identifier.trim().toUpperCase()) || null;
}

export async function getQuantFundSeries(
  db: D1Database,
  slug: string
): Promise<UnpackedFundSeries | null> {
  const mem = seriesCache.get(slug);
  if (mem && mem.expiresAt > Date.now()) {
    return mem.data;
  }
  try {
    const row = await db
      .prepare("SELECT slug, currency, series_type, source, series_json FROM wq_fund_series WHERE slug = ?")
      .bind(slug)
      .first<any>();
    if (!row || !row.series_json) {
      seriesCache.set(slug, { data: null, expiresAt: Date.now() + 60_000 });
      return null;
    }
    const parsed = JSON.parse(row.series_json);
    const dates: string[] = Array.isArray(parsed.d) ? parsed.d : [];
    const nav: number[] = Array.isArray(parsed.n) ? parsed.n : [];
    const adj_nav: number[] = Array.isArray(parsed.a) ? parsed.a : nav;
    const dividends: Record<string, number> = {};
    if (Array.isArray(parsed.v)) {
      for (const pair of parsed.v) {
        if (Array.isArray(pair) && pair.length >= 2) {
          const dt = dates[Number(pair[0])];
          const amt = Number(pair[1]);
          if (dt && amt > 0) dividends[dt] = amt;
        }
      }
    }
    const unpacked: UnpackedFundSeries = {
      slug: row.slug,
      currency: (row.currency || "USD").toUpperCase(),
      series_type: row.series_type || parsed.t || "market_etf",
      source: row.source || parsed.s || "yfinance",
      dates,
      nav,
      adj_nav,
      dividends,
    };
    seriesCache.set(slug, { data: unpacked, expiresAt: Date.now() + SERIES_TTL_MS });
    return unpacked;
  } catch {
    return null;
  }
}

export async function getQuantFxSeries(db: D1Database, pair: string): Promise<UnpackedFxSeries | null> {
  const key = pair.toUpperCase();
  const mem = fxSeriesCache.get(key);
  if (mem && mem.expiresAt > Date.now()) {
    return mem.data;
  }
  try {
    const row = await db
      .prepare("SELECT pair, latest_rate, series_json FROM wq_fx_series WHERE pair = ?")
      .bind(key)
      .first<any>();
    if (!row || !row.series_json) {
      fxSeriesCache.set(key, { data: null, expiresAt: Date.now() + 60_000 });
      return null;
    }
    const parsed = JSON.parse(row.series_json);
    const unpacked: UnpackedFxSeries = {
      pair: row.pair,
      latest_rate: Number(row.latest_rate || 1.0),
      dates: Array.isArray(parsed.d) ? parsed.d : [],
      rates: Array.isArray(parsed.r) ? parsed.r : [],
    };
    fxSeriesCache.set(key, { data: unpacked, expiresAt: Date.now() + SERIES_TTL_MS });
    return unpacked;
  } catch {
    return null;
  }
}

export async function getQuantBenchmarkSeries(
  db: D1Database,
  code: string
): Promise<UnpackedBenchmarkSeries | null> {
  const mem = bmSeriesCache.get(code);
  if (mem && mem.expiresAt > Date.now()) {
    return mem.data;
  }
  try {
    const row = await db
      .prepare("SELECT code, currency, series_json FROM wq_benchmark_series WHERE code = ?")
      .bind(code)
      .first<any>();
    if (!row || !row.series_json) {
      bmSeriesCache.set(code, { data: null, expiresAt: Date.now() + 60_000 });
      return null;
    }
    const parsed = JSON.parse(row.series_json);
    const unpacked: UnpackedBenchmarkSeries = {
      code: row.code,
      currency: (row.currency || "USD").toUpperCase(),
      dates: Array.isArray(parsed.d) ? parsed.d : [],
      close: Array.isArray(parsed.c) ? parsed.c : [],
      adj_close: Array.isArray(parsed.a) ? parsed.a : parsed.c || [],
    };
    bmSeriesCache.set(code, { data: unpacked, expiresAt: Date.now() + SERIES_TTL_MS });
    return unpacked;
  } catch {
    return null;
  }
}

/**
 * Convert a daily date->value map from `fromCcy` into `toCcy` using packed D1 `wq_fx_series` (pivoted via USD).
 */
export async function convertSeriesCurrency(
  db: D1Database,
  series: Record<string, number>,
  fromCcy: string,
  toCcy: string
): Promise<Record<string, number>> {
  const f = fromCcy.toUpperCase();
  const t = toCcy.toUpperCase();
  if (f === t || t === "NATIVE") return series;

  const fromFx = f === "USD" ? null : await getQuantFxSeries(db, `${f}USD`);
  const toFx = t === "USD" ? null : await getQuantFxSeries(db, `${t}USD`);

  const buildLookup = (fx: UnpackedFxSeries | null) => {
    const m = new Map<string, number>();
    if (!fx) return { map: m, latest: 1.0 };
    for (let i = 0; i < fx.dates.length; i++) {
      m.set(fx.dates[i], fx.rates[i]);
    }
    return { map: m, latest: fx.latest_rate || 1.0 };
  };

  const fromMap = buildLookup(fromFx);
  const toMap = buildLookup(toFx);
  const sortedDates = Object.keys(series).sort();

  const out: Record<string, number> = {};
  let lastFrom = fromMap.latest;
  let lastTo = toMap.latest;
  for (const d of sortedDates) {
    if (fromMap.map.has(d)) lastFrom = fromMap.map.get(d)!;
    if (toMap.map.has(d)) lastTo = toMap.map.get(d)!;
    const rate = lastTo > 0 ? lastFrom / lastTo : 1.0;
    out[d] = Math.round(series[d] * rate * 1e6) / 1e6;
  }
  return out;
}

export interface BenchmarkProxyResult {
  series: Record<string, number>;
  proxyLabel: string;
  benchmarkCodes: string[];
  feeDragPct: number;
}

interface BenchmarkRecipe {
  legs: Array<{ code: string; weight: number }>;
  betaMultiplier: number;
  proxyLabel: string;
}

function selectBenchmarkRecipe(fund: Partial<QuantFundCatalogRow> | null): BenchmarkRecipe {
  const ac = String(fund?.asset_class || "").toLowerCase();
  const name = `${fund?.name || ""} ${fund?.name_en || ""}`;
  const nameLower = name.toLowerCase();
  const bmCode = String(fund?.benchmark_code || "").trim();

  // 1. 现金 / 货币市场基金 (如 M13 富达美元现金基金)
  if (
    ac.includes("货币") ||
    ac.includes("现金") ||
    ac.includes("cash") ||
    bmCode === "BIL" ||
    name.includes("美元現金") ||
    name.includes("美元现金") ||
    name.includes("货币") ||
    nameLower.includes("cash") ||
    nameLower.includes("money market")
  ) {
    return {
      legs: [{ code: "BIL", weight: 1.0 }],
      betaMultiplier: 1.0,
      proxyLabel: "BIL 短期美债/美元现金基准",
    };
  }

  // 2. 股债平衡 / 多元混合基金 (如 R03 骏利亨德森平衡基金)
  if (
    ac.includes("多元") ||
    ac.includes("平衡") ||
    ac.includes("混合") ||
    ac.includes("balanced") ||
    ac.includes("multi") ||
    name.includes("平衡") ||
    name.includes("多元") ||
    name.includes("收益及增长") ||
    nameLower.includes("balanced") ||
    nameLower.includes("multi-asset")
  ) {
    return {
      legs: [
        { code: "SPY", weight: 0.6 },
        { code: "AGG", weight: 0.4 },
      ],
      betaMultiplier: 1.0,
      proxyLabel: "60% SPY + 40% AGG 股债平衡基准",
    };
  }

  // 3. 固定收益 / 债券基金
  if (
    ac.includes("债") ||
    ac.includes("固收") ||
    ac.includes("bond") ||
    ac.includes("fixed") ||
    name.includes("債券") ||
    name.includes("债券") ||
    nameLower.includes("bond") ||
    nameLower.includes("fixed income")
  ) {
    if (
      name.includes("高收益") ||
      name.includes("高息") ||
      ac.includes("高收益") ||
      nameLower.includes("high yield") ||
      bmCode === "HYG"
    ) {
      return {
        legs: [{ code: "HYG", weight: 1.0 }],
        betaMultiplier: 1.0,
        proxyLabel: "HYG 美元高收益债基准",
      };
    }
    return {
      legs: [{ code: "AGG", weight: 1.0 }],
      betaMultiplier: 1.0,
      proxyLabel: "AGG 综合投资级债券基准",
    };
  }

  // 4. 大中华 / 香港 / 中国股票基金 (如 A17 柏瑞大中华股票基金)
  if (
    name.includes("大中華") ||
    name.includes("大中华") ||
    name.includes("中國") ||
    name.includes("中国") ||
    name.includes("香港") ||
    nameLower.includes("greater china") ||
    nameLower.includes("china") ||
    nameLower.includes("hong kong") ||
    bmCode === "2800.HK" ||
    bmCode === "sh510300"
  ) {
    if (name.includes("A股") || name.includes("沪深") || bmCode === "sh510300") {
      return {
        legs: [{ code: "sh510300", weight: 1.0 }],
        betaMultiplier: 1.0,
        proxyLabel: "sh510300 沪深300基准",
      };
    }
    return {
      legs: [{ code: "2800.HK", weight: 1.0 }],
      betaMultiplier: 1.0,
      proxyLabel: "2800.HK 港股/大中华基准",
    };
  }

  // 5. 日本股票基金
  if (name.includes("日本") || nameLower.includes("japan") || bmCode === "1306.T") {
    return {
      legs: [{ code: "1306.T", weight: 1.0 }],
      betaMultiplier: 1.0,
      proxyLabel: "1306.T 日本东证指数基准",
    };
  }

  // 6. 行业高弹性成长基金：生物科技 / 科技 / 医疗健康 (如 D05 富兰克林生物科技)
  if (
    name.includes("生物科技") ||
    name.includes("科技") ||
    name.includes("健康") ||
    name.includes("医疗") ||
    name.includes("醫療") ||
    nameLower.includes("biotech") ||
    nameLower.includes("technology") ||
    nameLower.includes("health")
  ) {
    const code = bmCode || "SPY";
    return {
      legs: [{ code, weight: 1.0 }],
      betaMultiplier: 1.15,
      proxyLabel: `${code} 行业高弹性校准基准`,
    };
  }

  // 7. 默认：采用库内 benchmark_code（缺省回退 VT 全球股票基准）
  const fallbackCode = bmCode || "VT";
  return {
    legs: [{ code: fallbackCode, weight: 1.0 }],
    betaMultiplier: 1.0,
    proxyLabel: `${fallbackCode} 对标指数基准`,
  };
}

/**
 * 为缺乏公开直连日线序列的基金（如 Tier U 投连险内部份额）从 `wq_benchmark_series` 合成对标基准代理日线。
 * 按目标币种换算后，叠加行业弹性校准与基金年化管理费率（fee_pct）日度扣减，确保组合权重与风控模拟不失真。
 */
export async function buildBenchmarkProxySeries(
  db: D1Database,
  fund: Partial<QuantFundCatalogRow> | null,
  daysBack: number = 1825,
  targetCcy: string = "USD"
): Promise<BenchmarkProxyResult | null> {
  const recipe = selectBenchmarkRecipe(fund);
  const cutoffDate = new Date(Date.now() - Math.max(30, daysBack) * 86400_000)
    .toISOString()
    .slice(0, 10);

  const loadedLegs: Array<{ weight: number; code: string; prices: Record<string, number> }> = [];
  for (const leg of recipe.legs) {
    let bm = await getQuantBenchmarkSeries(db, leg.code);
    let actualCode = leg.code;
    if ((!bm || bm.dates.length < 20) && leg.code !== "SPY") {
      bm = await getQuantBenchmarkSeries(db, "SPY");
      actualCode = "SPY";
    }
    if (!bm || bm.dates.length < 20) continue;

    const allMap: Record<string, number> = {};
    const filteredMap: Record<string, number> = {};
    for (let i = 0; i < bm.dates.length; i++) {
      const d = bm.dates[i];
      const v = bm.adj_close[i] ?? bm.close[i];
      if (d && d > "1990-01-01" && typeof v === "number" && v > 0) {
        allMap[d] = v;
        if (d >= cutoffDate) filteredMap[d] = v;
      }
    }
    const chosenMap = Object.keys(filteredMap).length >= 30 ? filteredMap : allMap;
    if (Object.keys(chosenMap).length < 20) continue;

    const convertedMap =
      targetCcy !== "NATIVE" && targetCcy !== bm.currency
        ? await convertSeriesCurrency(db, chosenMap, bm.currency, targetCcy)
        : chosenMap;

    loadedLegs.push({ weight: leg.weight, code: actualCode, prices: convertedMap });
  }

  if (loadedLegs.length === 0) return null;

  const weightSum = loadedLegs.reduce((s, l) => s + l.weight, 0) || 1;
  const normalizedLegs = loadedLegs.map((l) => ({ ...l, weight: l.weight / weightSum }));

  const primaryDates = Object.keys(normalizedLegs[0].prices).sort();
  if (primaryDates.length < 20) return null;

  // 将各腿序列按主日期表前向对齐
  const alignedLegs: number[][] = normalizedLegs.map((leg) => {
    const legDates = Object.keys(leg.prices).sort();
    let lastPx = legDates.length > 0 ? leg.prices[legDates[0]] : 1;
    let cursor = 0;
    return primaryDates.map((d) => {
      while (cursor < legDates.length && legDates[cursor] <= d) {
        const px = leg.prices[legDates[cursor]];
        if (px > 0) lastPx = px;
        cursor++;
      }
      if (leg.prices[d] && leg.prices[d] > 0) lastPx = leg.prices[d];
      return lastPx;
    });
  });

  const feePct = typeof fund?.fee_pct === "number" && fund.fee_pct > 0 ? fund.fee_pct : 0;
  const netAnnualFeeDrag = Math.max(0, Math.min(0.03, feePct / 100 - 0.0009));
  const dailyFeeDrag = netAnnualFeeDrag / 252;

  const series: Record<string, number> = {};
  let nav = 100.0;
  series[primaryDates[0]] = nav;

  for (let i = 1; i < primaryDates.length; i++) {
    let blendedRet = 0;
    for (let l = 0; l < normalizedLegs.length; l++) {
      const prevPx = alignedLegs[l][i - 1];
      const currPx = alignedLegs[l][i];
      const legRet = prevPx > 0 && currPx > 0 ? currPx / prevPx - 1 : 0;
      blendedRet += normalizedLegs[l].weight * legRet;
    }
    const r = blendedRet * recipe.betaMultiplier - dailyFeeDrag;
    nav = Math.round(nav * Math.max(0.2, 1 + r) * 1e6) / 1e6;
    series[primaryDates[i]] = nav;
  }

  return {
    series,
    proxyLabel: recipe.proxyLabel,
    benchmarkCodes: normalizedLegs.map((l) => l.code),
    feeDragPct: feePct,
  };
}
