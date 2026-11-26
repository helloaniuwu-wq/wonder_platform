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
  twin_codes?: string[];
  twin_funds?: Array<{
    slug: string;
    code: string;
    aia_code: string | null;
    name: string;
    currency: string;
    is_distributing: boolean;
  }>;
  is_distributing: boolean;
  benchmark_code: string;
  primary_source: string;
  data_tier: string;
  is_trackable: boolean;
  status: string;
  // Fixed income & external quote metadata (0007 / 0012)
  duration?: number | null;
  yield_pct?: number | null;
  avg_rating?: string | null;
  credit_quality?: string | null;
  morningstar_url?: string | null;
  top_holding_keys?: string[];
  top_holdings?: Array<{ name: string; symbol?: string; weight_pct: number | null }>;
  xray_profile?: Record<string, any> | null;
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
  // Lightweight SOP & Research Queue metadata (0011)
  has_sop_report?: boolean;
  sop_medal?: string | null;
  sop_pillar_score?: number | null;
  sop_valuation_zone?: string | null;
  sop_report_date?: string | null;
  sop_valuation_pct_5y?: number | null;
  sop_dividend_yield_ttm?: number | null;
  sop_dividend_spread_rf?: number | null;
  sop_red_flag_top?: string | null;
  research_queue_status?: string | null;
  research_priority?: string | null;
  research_admin_note?: string | null;
  research_notes?: string[];
  research_request_count?: number;
  research_requester_ids?: string[];
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

function safeJsonObject(raw: string | null | undefined): Record<string, any> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function extractTopHoldingsList(rawJson: string | null | undefined): Array<{ name: string; symbol?: string; weight_pct: number | null }> {
  if (!rawJson) return [];
  try {
    const parsed = JSON.parse(rawJson);
    const list = Array.isArray(parsed?.holdings) ? parsed.holdings : Array.isArray(parsed) ? parsed : [];
    return list
      .filter((h: any) => h && (h.name || h.symbol))
      .slice(0, 15)
      .map((h: any) => ({
        name: String(h.name || h.symbol || "").trim(),
        symbol: h.symbol ? String(h.symbol).trim() : undefined,
        weight_pct: h.weight_pct != null && Number.isFinite(Number(h.weight_pct)) ? Number(h.weight_pct) : null,
      }));
  } catch {
    return [];
  }
}

function extractRequesterIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item: any) => (item && item.user_id != null ? String(item.user_id) : ""))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function extractRequesterNotes(raw: string | null | undefined, adminNote?: string | null): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const pushUnique = (val: string) => {
    const clean = val.trim();
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      out.push(clean);
    }
  };
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const note = item && item.note ? String(item.note).trim() : "";
          if (!note) continue;
          const who = item.name || item.email || "";
          pushUnique(who ? `${who}：${note}` : note);
        }
      }
    } catch {
      // ignore invalid json
    }
  }
  if (adminNote && String(adminNote).trim()) {
    pushUnique(`管理员备注：${String(adminNote).trim()}`);
  }
  return out;
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

export function catalogRichnessScore(row: QuantFundCatalogRow): number {
  let score = 0;
  if (row.has_sop_report) score += 100;
  if (row.xray_profile && Object.keys(row.xray_profile).length > 0) score += 40;
  if (Array.isArray(row.top_holdings) && row.top_holdings.length > 0) score += 15;
  if (row.duration != null) score += 10;
  if (row.avg_rating || row.credit_quality) score += 5;
  if (row.fee_pct != null) score += 5;
  if (row.morningstar_stars != null) score += 3;
  return score;
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
            f.duration, f.yield_pct, f.avg_rating, f.credit_quality, f.morningstar_url, f.top_holdings_json, f.xray_profile_json,
            m.as_of_date, m.valuation_date, m.latest_nav,
            m.ret_1m, m.ret_3m, m.ret_6m, m.ret_ytd, m.ret_1y, m.ret_3y_ann, m.ret_5y_ann,
            m.vol_1y, m.vol_3y, m.max_dd_1y, m.max_dd_3y, m.max_dd_5y, m.dd_recovery_days,
            m.sharpe_3y, m.sortino_3y, m.calmar_3y, m.beta_3y, m.alpha_3y, m.r2_3y, m.ir_3y,
            m.div_yield_ttm, m.peer_rank_pct, m.quant_score, m.quant_grade,
            COALESCE(m.obs_days, 0) AS obs_days, m.anomalies_json,
            CASE WHEN sr.slug IS NOT NULL THEN 1 ELSE 0 END AS has_sop_report,
            sr.medal_rating AS sop_medal,
            sr.pillar_score AS sop_pillar_score,
            sr.valuation_zone AS sop_valuation_zone,
            sr.report_date AS sop_report_date,
            sr.valuation_pct_5y AS sop_valuation_pct_5y,
            sr.dividend_yield_ttm AS sop_dividend_yield_ttm,
            sr.dividend_spread_rf AS sop_dividend_spread_rf,
            sr.red_flag_top AS sop_red_flag_top,
            rq.status AS research_queue_status,
            rq.priority AS research_priority,
            rq.admin_note AS research_admin_note,
            COALESCE(rq.request_count, 0) AS research_request_count,
            rq.requesters_json AS research_requesters_json
           FROM wq_funds f
           LEFT JOIN wq_fund_metrics m ON m.slug = f.slug
           LEFT JOIN wq_fund_sop_reports sr ON sr.slug = f.slug COLLATE NOCASE
           LEFT JOIN wq_fund_research_queue rq ON rq.slug = f.slug
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
            COALESCE(m.obs_days, 0) AS obs_days, m.anomalies_json,
            CASE WHEN sr.slug IS NOT NULL THEN 1 ELSE 0 END AS has_sop_report,
            sr.medal_rating AS sop_medal,
            sr.pillar_score AS sop_pillar_score,
            sr.valuation_zone AS sop_valuation_zone,
            sr.report_date AS sop_report_date,
            rq.status AS research_queue_status,
            rq.priority AS research_priority,
            rq.admin_note AS research_admin_note,
            COALESCE(rq.request_count, 0) AS research_request_count,
            rq.requesters_json AS research_requesters_json
           FROM wq_funds f
           LEFT JOIN wq_fund_metrics m ON m.slug = f.slug
           LEFT JOIN wq_fund_sop_reports sr ON sr.slug = f.slug COLLATE NOCASE
           LEFT JOIN wq_fund_research_queue rq ON rq.slug = f.slug
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
      currency: normalizeMinorCurrency(r.currency).currency,
      risk_class: r.risk_class || null,
      morningstar_stars: r.morningstar_stars != null ? Number(r.morningstar_stars) : null,
      fee_pct:
        r.fee_pct != null && Number(r.fee_pct) >= 0 && Number(r.fee_pct) <= 5
          ? Number(r.fee_pct)
          : null,
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
      duration:
        r.duration != null && Number(r.duration) >= -5 && Number(r.duration) <= 40
          ? Number(r.duration)
          : null,
      yield_pct:
        r.yield_pct != null && Number(r.yield_pct) > 0 && Number(r.yield_pct) <= 25
          ? Number(r.yield_pct)
          : null,
      avg_rating: r.avg_rating || null,
      credit_quality: r.credit_quality || null,
      morningstar_url: r.morningstar_url || null,
      top_holding_keys: extractHoldingKeys(r.top_holdings_json),
      top_holdings: extractTopHoldingsList(r.top_holdings_json),
      xray_profile: safeJsonObject(r.xray_profile_json),
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
      div_yield_ttm:
        r.div_yield_ttm != null && Number(r.div_yield_ttm) > 0 && Number(r.div_yield_ttm) < 0.25
          ? Number(r.div_yield_ttm)
          : r.sop_dividend_yield_ttm != null && Number(r.sop_dividend_yield_ttm) > 0 && Number(r.sop_dividend_yield_ttm) < 25
            ? Number(r.sop_dividend_yield_ttm) / 100
            : r.yield_pct != null && Number(r.yield_pct) > 0 && Number(r.yield_pct) < 25
              ? Number(r.yield_pct) / 100
              : r.div_yield_ttm != null && Number(r.div_yield_ttm) === 0
                ? 0
                : null,
      peer_rank_pct: r.peer_rank_pct != null ? Number(r.peer_rank_pct) : null,
      quant_score: r.quant_score != null ? Number(r.quant_score) : null,
      quant_grade: r.quant_grade || null,
      obs_days: Number(r.obs_days || 0),
      anomalies: safeJsonArray(r.anomalies_json),
      has_sop_report: Boolean(r.has_sop_report),
      sop_medal: r.sop_medal || null,
      sop_pillar_score: r.sop_pillar_score != null ? Number(r.sop_pillar_score) : null,
      sop_valuation_zone: r.sop_valuation_zone || null,
      sop_report_date: r.sop_report_date || null,
      sop_valuation_pct_5y: r.sop_valuation_pct_5y != null ? Number(r.sop_valuation_pct_5y) : null,
      sop_dividend_yield_ttm: r.sop_dividend_yield_ttm != null ? Number(r.sop_dividend_yield_ttm) : null,
      sop_dividend_spread_rf: r.sop_dividend_spread_rf != null ? Number(r.sop_dividend_spread_rf) : null,
      sop_red_flag_top: r.sop_red_flag_top || null,
      research_queue_status: r.research_queue_status || null,
      research_priority: r.research_priority || null,
      research_admin_note: r.research_admin_note || null,
      research_notes: extractRequesterNotes(r.research_requesters_json, r.research_admin_note),
      research_request_count: Number(r.research_request_count || 0),
      research_requester_ids: extractRequesterIds(r.research_requesters_json),
    }));

    const lookup = new Map<string, QuantFundCatalogRow>();
    // 1. 共享别名键（isin / yahoo_ticker / cn_code / code）：信息丰富度更高的份额优先胜出
    for (const row of rows) {
      const sharedKeys = [row.isin, row.yahoo_ticker, row.cn_code, row.code];
      const rowScore = catalogRichnessScore(row);
      for (const k of sharedKeys) {
        if (!k) continue;
        const up = k.trim().toUpperCase();
        const existing = lookup.get(up);
        if (!existing || rowScore > catalogRichnessScore(existing)) {
          lookup.set(up, row);
        }
      }
    }
    // 2. 精确主键：aia_code（如无冲突或同 code）与 slug（始终精确绑定）
    for (const row of rows) {
      if (row.aia_code) {
        const up = row.aia_code.trim().toUpperCase();
        const existing = lookup.get(up);
        if (!existing || existing.code === row.code || catalogRichnessScore(row) >= catalogRichnessScore(existing)) {
          lookup.set(up, row);
        }
      }
      lookup.set(row.slug.toUpperCase(), row);
    }

    // LSE alternate trading tickers for identical Ireland UCITS ISINs (GBP vs USD lines)
    const UCITS_TICKER_ALIASES: Record<string, string> = {
      VHYL: "VHYD",
      "VHYL.L": "VHYD",
      IDUS: "IUSA",
      "IDUS.L": "IUSA",
      EQQU: "EQQQ",
      "EQQU.L": "EQQQ",
      IBTU: "IB0D",
      "IBTU.L": "IB0D",
      IDBT: "IBTS",
      "IDBT.L": "IBTS",
    };
    for (const [alias, canonical] of Object.entries(UCITS_TICKER_ALIASES)) {
      if (!lookup.has(alias)) {
        const target = lookup.get(canonical);
        if (target) lookup.set(alias, target);
      }
    }

    // Bidirectional twin share-class linking (Acc <-> Dist), 0 extra D1 reads
    const rowBySlug = new Map(rows.map((r) => [r.slug, r]));
    const reverseTwins = new Map<string, QuantFundCatalogRow[]>();
    for (const r of rows) {
      if (!r.twin_code) continue;
      const target = lookup.get(r.twin_code.trim().toUpperCase());
      if (target && target.slug !== r.slug) {
        const list = reverseTwins.get(target.slug) || [];
        list.push(r);
        reverseTwins.set(target.slug, list);
      }
    }
    for (const r of rows) {
      const twinMap = new Map<string, QuantFundCatalogRow>();
      if (r.twin_code) {
        const direct = lookup.get(r.twin_code.trim().toUpperCase());
        if (direct && direct.slug !== r.slug) {
          twinMap.set(direct.slug, direct);
        }
      }
      for (const rev of reverseTwins.get(r.slug) || []) {
        if (rev.slug !== r.slug && !twinMap.has(rev.slug)) {
          twinMap.set(rev.slug, rev);
        }
      }
      if (twinMap.size > 0) {
        const sortedTwins = Array.from(twinMap.values()).sort((a, b) => {
          const sameCcyA = a.currency === r.currency ? 0 : 1;
          const sameCcyB = b.currency === r.currency ? 0 : 1;
          if (sameCcyA !== sameCcyB) return sameCcyA - sameCcyB;
          const oppDistA = a.is_distributing !== r.is_distributing ? 0 : 1;
          const oppDistB = b.is_distributing !== r.is_distributing ? 0 : 1;
          if (oppDistA !== oppDistB) return oppDistA - oppDistB;
          return a.code.localeCompare(b.code);
        });
        r.twin_funds = sortedTwins.map((tw) => ({
          slug: tw.slug,
          code: tw.code,
          aia_code: tw.aia_code,
          name: tw.name,
          currency: tw.currency,
          is_distributing: tw.is_distributing,
        }));
        r.twin_codes = sortedTwins.map((tw) => tw.aia_code || tw.code);
        if (!r.twin_code) {
          r.twin_code = sortedTwins[0].aia_code || sortedTwins[0].code;
        }
      }
    }
    // Reference rowBySlug to silence any unused warning if needed
    void rowBySlug;

    if (rows.length > 0) {
      catalogCache = { rows, lookup, expiresAt: Date.now() + CATALOG_TTL_MS };
    }
    return { rows, lookup };
  } catch (err: any) {
    console.error("loadQuantCatalog error:", err);
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

function arrayMedian(vals: number[]): number | null {
  if (!vals.length) return null;
  const s = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function normalizeMinorCurrency(currency: string | null | undefined): {
  currency: string;
  unitScale: number;
} {
  const raw = (currency || "USD").trim();
  if (!raw) return { currency: "USD", unitScale: 1 };
  // Check exact case-sensitive "GBp"/"ZAc" BEFORE uppercasing ("GBP" is pounds, "GBp" is pence)
  if (raw === "GBp" || raw.toUpperCase() === "GBX") return { currency: "GBP", unitScale: 0.01 };
  if (raw === "ZAc" || raw.toUpperCase() === "ZAC") return { currency: "ZAR", unitScale: 0.01 };
  if (raw.toUpperCase() === "ILA") return { currency: "ILS", unitScale: 0.01 };
  if (raw.toUpperCase() === "USX") return { currency: "USD", unitScale: 0.01 };
  return { currency: raw.toUpperCase(), unitScale: 1 };
}

export function sanitizeQuantSeries(
  rawDates: string[],
  rawNav: number[],
  rawAdjNav: number[],
  rawDividends: Record<string, number>
): {
  dates: string[];
  nav: number[];
  adj_nav: number[];
  dividends: Record<string, number>;
} {
  const n = Math.min(rawDates.length, rawNav.length);
  if (n < 3) {
    return {
      dates: [...rawDates],
      nav: [...rawNav],
      adj_nav: [...rawAdjNav],
      dividends: { ...rawDividends },
    };
  }

  const dates = rawDates.slice(0, n);
  const nav = rawNav.slice(0, n);
  const adj = Array.from({ length: n }, (_, i) =>
    Number.isFinite(rawAdjNav[i]) && rawAdjNav[i] > 0 ? rawAdjNav[i] : nav[i]
  );
  const dividends: Record<string, number> = { ...rawDividends };

  // Step 1: Normalize 100x currency-regime flips anchored to terminal window
  const tail = nav.slice(Math.max(0, n - 10)).filter((v) => v > 0 && Number.isFinite(v));
  const anchor = arrayMedian(tail);
  if (anchor && anchor > 0) {
    for (let i = 0; i < n; i++) {
      const v = nav[i];
      if (!Number.isFinite(v) || v <= 0) continue;
      const ratio = v / anchor;
      let scale = 1;
      if (ratio >= 50 && ratio <= 200) scale = 0.01;
      else if (ratio >= 0.005 && ratio <= 0.02) scale = 100;
      if (scale !== 1) {
        nav[i] = Number((nav[i] * scale).toFixed(6));
        adj[i] = Number((adj[i] * scale).toFixed(6));
        const dt = dates[i];
        const dv = dividends[dt];
        if (dv && dv > 0) {
          if (scale === 0.01 && dv / nav[i] > 0.2) {
            dividends[dt] = Number((dv * scale).toFixed(6));
          } else if (scale === 100 && (dv * 100) / nav[i] <= 0.15 && dv / v <= 0.15) {
            dividends[dt] = Number((dv * scale).toFixed(6));
          }
        }
      }
    }
  }

  // Step 2: Repair 1..5 bar transient glitches (longest block first; endpoints must match baseline)
  for (let k = Math.min(5, Math.max(1, n - 4)); k >= 1; k--) {
    for (let i = 2; i <= n - k - 2; i++) {
      const pre = nav.slice(Math.max(0, i - 3), i).filter((x) => x > 0);
      const post = nav.slice(i + k, Math.min(n, i + k + 3)).filter((x) => x > 0);
      const preMed = arrayMedian(pre);
      const postMed = arrayMedian(post);
      if (!preMed || !postMed) continue;
      const drift = preMed / postMed;
      if (drift < 0.65 || drift > 1.54) continue;
      const baseline = 0.5 * (preMed + postMed);
      const leftNav = nav[i - 1];
      const rightNav = nav[i + k];
      if (
        !(leftNav > 0 && rightNav > 0 && leftNav / baseline >= 0.65 && leftNav / baseline <= 1.54 && rightNav / baseline >= 0.65 && rightNav / baseline <= 1.54)
      ) {
        continue;
      }
      let allGlitched = true;
      for (let j = i; j < i + k; j++) {
        if (nav[j] <= 0) continue;
        const r = nav[j] / baseline;
        if (r <= 2.5 && r >= 0.4) {
          allGlitched = false;
          break;
        }
      }
      if (allGlitched) {
        const leftAdj = adj[i - 1];
        const rightAdj = adj[i + k];
        const span = k + 1;
        for (let step = 0; step < k; step++) {
          const j = i + step;
          const frac = (step + 1) / span;
          nav[j] = Number((leftNav + (rightNav - leftNav) * frac).toFixed(6));
          adj[j] = Number((leftAdj + (rightAdj - leftAdj) * frac).toFixed(6));
        }
        i += k - 1;
      }
    }
  }

  // Step 3: Guard single-bar minor-unit dividends on major-unit NAV (or impossible >25% single dividend)
  const navByDate = new Map<string, number>();
  for (let i = 0; i < n; i++) navByDate.set(dates[i], nav[i]);
  for (const [dt, dv] of Object.entries(dividends)) {
    const px = navByDate.get(dt);
    if (!px || px <= 0 || dv <= 0) continue;
    const singleYield = dv / px;
    if (singleYield > 0.2) {
      if ((dv / 100) / px <= 0.15) {
        dividends[dt] = Number((dv / 100).toFixed(6));
      } else if (singleYield > 0.25) {
        delete dividends[dt];
      }
    }
  }

  return { dates, nav, adj_nav: adj, dividends };
}

export function unpackSeriesDates(parsed: any): string[] {
  if (Array.isArray(parsed?.d) && parsed.d.length > 0) {
    return parsed.d.map((s: any) => String(s).slice(0, 10));
  }
  if (typeof parsed?.d0 === "string" && parsed.d0.length >= 10 && Array.isArray(parsed?.dd)) {
    const startMs = Date.parse(`${parsed.d0.slice(0, 10)}T00:00:00Z`);
    if (!Number.isFinite(startMs)) return [];
    const out: string[] = [parsed.d0.slice(0, 10)];
    let curMs = startMs;
    for (let i = 0; i < parsed.dd.length; i++) {
      const delta = Number(parsed.dd[i]);
      curMs += (Number.isFinite(delta) ? delta : 1) * 86400_000;
      out.push(new Date(curMs).toISOString().slice(0, 10));
    }
    return out;
  }
  return [];
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
    const rawDates: string[] = unpackSeriesDates(parsed);
    const rawNav: number[] = Array.isArray(parsed.n) ? parsed.n : [];
    const rawAdjNav: number[] =
      Array.isArray(parsed.a) && parsed.a.length === rawNav.length ? parsed.a : rawNav;
    const rawDividends: Record<string, number> = {};
    if (Array.isArray(parsed.v)) {
      for (const pair of parsed.v) {
        if (Array.isArray(pair) && pair.length >= 2) {
          const dt = rawDates[Number(pair[0])];
          const amt = Number(pair[1]);
          if (dt && amt > 0) rawDividends[dt] = amt;
        }
      }
    }
    const cleaned = sanitizeQuantSeries(rawDates, rawNav, rawAdjNav, rawDividends);
    const unpacked: UnpackedFundSeries = {
      slug: row.slug,
      currency: normalizeMinorCurrency(row.currency).currency,
      series_type: row.series_type || parsed.t || "market_etf",
      source: row.source || parsed.s || "yfinance",
      dates: cleaned.dates,
      nav: cleaned.nav,
      adj_nav: cleaned.adj_nav,
      dividends: cleaned.dividends,
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
      dates: unpackSeriesDates(parsed),
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
    const closeArr: number[] = Array.isArray(parsed.c) ? parsed.c : [];
    const unpacked: UnpackedBenchmarkSeries = {
      code: row.code,
      currency: (row.currency || "USD").toUpperCase(),
      dates: unpackSeriesDates(parsed),
      close: closeArr,
      adj_close:
        Array.isArray(parsed.a) && parsed.a.length === closeArr.length ? parsed.a : closeArr,
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
  const codeUpper = String(fund?.code || "").trim().toUpperCase().replace(/\.[A-Z]+$/, "");
  const name = `${fund?.name || ""} ${fund?.name_en || ""}`;
  const nameLower = name.toLowerCase();
  const bmCode = String(fund?.benchmark_code || "").trim();

  // 1. 现金 / 货币市场基金 (如 M13 富达美元现金基金, IB01/IB0D 0-1yr)
  if (
    ac.includes("货币") ||
    ac.includes("现金") ||
    ac.includes("cash") ||
    bmCode === "BIL" ||
    ["IB01", "IB0D", "IBTU", "SGOV", "BIL"].includes(codeUpper) ||
    name.includes("美元現金") ||
    name.includes("美元现金") ||
    name.includes("货币") ||
    nameLower.includes("cash") ||
    nameLower.includes("money market") ||
    nameLower.includes("0-1yr")
  ) {
    if (["IBTA", "IBTS", "IDBT", "SHY"].includes(codeUpper) || nameLower.includes("1-3yr")) {
      return {
        legs: [
          { code: "BIL", weight: 0.5 },
          { code: "AGG", weight: 0.5 },
        ],
        betaMultiplier: 1.0,
        proxyLabel: "50% BIL + 50% AGG 短债基准",
      };
    }
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
    nameLower.includes("fixed income") ||
    nameLower.includes("treasury")
  ) {
    if (
      ["IBTA", "IBTS", "IDBT", "SHY"].includes(codeUpper) ||
      nameLower.includes("1-3yr") ||
      nameLower.includes("short term") ||
      name.includes("短期")
    ) {
      return {
        legs: [
          { code: "BIL", weight: 0.5 },
          { code: "AGG", weight: 0.5 },
        ],
        betaMultiplier: 1.0,
        proxyLabel: "50% BIL + 50% AGG 短债基准",
      };
    }
    if (
      ["DTLA", "IDTL", "TLT", "EDV", "ZROZ"].includes(codeUpper) ||
      nameLower.includes("20+yr") ||
      nameLower.includes("20+") ||
      name.includes("超长期")
    ) {
      return {
        legs: [{ code: "AGG", weight: 1.0 }],
        betaMultiplier: 2.1,
        proxyLabel: "AGG 长久期美债弹性校准基准",
      };
    }
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

  // 4. 标普 500 & 纳指/科技成长（优先于泛美股/国际股票）
  if (
    ["CNDX", "EQAC", "EQQQ", "EQQU", "IUIT", "QQQ", "QQQM", "XLK"].includes(codeUpper) ||
    nameLower.includes("nasdaq") ||
    nameLower.includes("information technology") ||
    name.includes("纳斯达克") ||
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
      betaMultiplier: ["CNDX", "EQAC", "EQQQ", "EQQU", "IUIT", "QQQ"].includes(codeUpper) ? 1.2 : 1.15,
      proxyLabel: `${code} 科技成长弹性校准基准`,
    };
  }

  if (
    ["CSPX", "VUAA", "SPYL", "VUSD", "IUSA", "IDUS", "SPY", "VOO", "IVV"].includes(codeUpper) ||
    nameLower.includes("s&p 500") ||
    name.includes("标普500") ||
    name.includes("标普 500")
  ) {
    return {
      legs: [{ code: "SPY", weight: 1.0 }],
      betaMultiplier: 1.0,
      proxyLabel: "SPY 标普500基准",
    };
  }

  // 5. 大中华 / 香港 / 中国股票基金 (如 A17 柏瑞大中华股票基金)
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

  // 6. 日本股票基金
  if (name.includes("日本") || nameLower.includes("japan") || bmCode === "1306.T") {
    return {
      legs: [{ code: "1306.T", weight: 1.0 }],
      betaMultiplier: 1.0,
      proxyLabel: "1306.T 日本东证指数基准",
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
