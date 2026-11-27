import { Hono } from "hono";
import { Env, Variables } from "../types";
import { getOptionalUser, HttpError, requireUser } from "../utils/auth";
import {
  buildBenchmarkProxySeries,
  clearQuantStoreCaches,
  convertSeriesCurrency,
  getQuantBenchmarkSeries,
  getQuantFundSeries,
  loadQuantCatalog,
  QuantFundCatalogRow,
  resolveQuantFund,
} from "../services/quantStore";
import { countBusinessDaysBetween } from "../services/quantWatchdog";
import {
  buildTacticalCandidatePool,
  getFundDomicile,
  hasUsEstateTaxConcern,
  inferFundRole,
  isEuropeanCategoryFund,
  isIlasFund,
  isIrelandOrLuxembourgFund,
  recommendForClient,
  resolveBasketUniverseMode,
} from "../services/advisoryEngine";
import { callLlmChat, extractAndNormalizeTacticalJson } from "../services/llm";
import { getFundTopHoldings } from "../services/fundHoldings";
import { formatMacroPromptBlock, getLatestMacroSnapshot } from "../services/macroStore";
import { batchEnqueueResearchRequests, computeFullPortfolioXRay } from "../services/portfolioXRayService";

export const quantRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

const PREMIUM_ROLES = new Set(["premium", "advisor", "admin"]);

async function requireQuantAccess(c: any) {
  const user = await requireUser(c);
  if (!PREMIUM_ROLES.has(user.role)) {
    throw new HttpError(403, "基金量化庫僅對 Premium / 顧問 / 管理員開放");
  }
  return user;
}

async function requireAdmin(c: any) {
  const user = await requireUser(c);
  if (user.role !== "admin") {
    throw new HttpError(403, "權限不足，僅限系統管理員操作");
  }
  return user;
}

function isAdvisorOrAdmin(user?: { role?: string } | null): boolean {
  return user?.role === "advisor" || user?.role === "admin";
}

function stripNegativeCommentary(text: string | null | undefined): string | null {
  if (!text) return text ?? null;
  const cleaned = String(text)
    .replace(/\s*[｜|]\s*结构性风险[：:].*$/u, "")
    .replace(/\s*[｜|]\s*红队风险[：:].*$/u, "")
    .trim();
  return cleaned || null;
}

function sanitizeFundRowForRole(row: QuantFundCatalogRow, canSeeWarnings: boolean): QuantFundCatalogRow {
  if (canSeeWarnings) return row;
  return {
    ...row,
    sop_red_flag_top: null,
    sop_medal: row.sop_medal === "Negative" ? null : row.sop_medal,
    anomalies: [],
    commentary: stripNegativeCommentary(row.commentary),
  };
}

function sanitizeSopTabsForClient(tabs: any[]): any[] {
  if (!Array.isArray(tabs)) return [];
  return tabs
    .filter((tab) => {
      const id = String(tab?.id || "").trim();
      const label = String(tab?.label || "").trim();
      if (id === "masters" || id === "risks_onepager") return false;
      if (/risk|stress|red_team|warning/i.test(id)) return false;
      if (/红队|红旗|审问|警示|警告/.test(label)) return false;
      return true;
    })
    .map((tab) => {
      const rawMd = String(tab?.markdown || "");
      const cleanedMd = rawMd
        .split(/\r?\n/)
        .filter(
          (line) =>
            !/^\s*[-*]\s*\*\*结构性最大风险/.test(line) &&
            !/^\s*[-*]\s*🔴/.test(line) &&
            !/^\s*[-*]\s*\*\*主要红旗/.test(line)
        )
        .join("\n");
      return { ...tab, markdown: cleanedMd };
    });
}

function rangeToCutoffIso(rangeStr: string): string {
  const now = new Date();
  const r = (rangeStr || "3y").toLowerCase();
  const daysMap: Record<string, number> = {
    "6m": 185,
    "1y": 370,
    "3y": 365 * 3 + 5,
    "5y": 365 * 5 + 5,
    "10y": 365 * 10 + 5,
    max: 365 * 20,
  };
  const days = daysMap[r] ?? 365 * 3 + 5;
  return new Date(now.getTime() - days * 86400_000).toISOString().slice(0, 10);
}

// ── 1. Pipeline Health & Data Freshness Pill (public/logged-in, reads <= 2 D1 rows) ──
quantRouter.get("/health", async (c) => {
  try {
    const hb = await c.env.DB.prepare("SELECT * FROM wq_heartbeat ORDER BY last_seen_at DESC LIMIT 1").first<any>();
    const lastRun = await c.env.DB.prepare(
      "SELECT run_id, job_type, started_at, finished_at, status, total_funds, succeeded_funds, failed_funds, failure_rate, max_valuation_date, aia_valuation_date FROM wq_pipeline_runs ORDER BY started_at DESC LIMIT 1"
    ).first<any>();

    const nowMs = Date.now();
    const todayIso = new Date(nowMs).toISOString().slice(0, 10);

    let state: "online" | "stale" | "offline" | "uninitialized" = "uninitialized";
    let heartbeatAgeHours: number | null = null;
    let fetchGapBdays: number | null = null;

    if (hb?.last_seen_at) {
      const seenMs = Date.parse(hb.last_seen_at);
      if (!Number.isNaN(seenMs)) {
        heartbeatAgeHours = Math.round(((nowMs - seenMs) / 3600_000) * 10) / 10;
      }
      if (hb.last_fetch_ok_at) {
        fetchGapBdays = countBusinessDaysBetween(hb.last_fetch_ok_at, todayIso);
      }
      if ((heartbeatAgeHours ?? 0) > 6 || (fetchGapBdays ?? 0) > 2) {
        state = "offline";
      } else if ((fetchGapBdays ?? 0) >= 2 || (lastRun && lastRun.status !== "ok")) {
        state = "stale";
      } else {
        state = "online";
      }
    }

    let summaryObj: Record<string, any> = {};
    if (hb?.metrics_summary_json) {
      try {
        summaryObj = JSON.parse(hb.metrics_summary_json);
      } catch {
        // ignore
      }
    }

    return c.json({
      state,
      host_id: hb?.host_id || null,
      wq_version: hb?.wq_version || null,
      last_seen_at: hb?.last_seen_at || null,
      heartbeat_age_hours: heartbeatAgeHours,
      last_fetch_ok_at: hb?.last_fetch_ok_at || null,
      last_writeback_ok_at: hb?.last_writeback_ok_at || null,
      last_aia_val_date: hb?.last_aia_val_date || lastRun?.aia_valuation_date || null,
      max_valuation_date: lastRun?.max_valuation_date || null,
      fetch_gap_bdays: fetchGapBdays,
      last_run: lastRun || null,
      summary: summaryObj,
    });
  } catch (e: any) {
    return c.json({
      state: "uninitialized",
      error: e?.message || "wq tables not migrated yet",
    });
  }
});

// ── 2. Screener & Catalog List (5m Worker isolate cached join, 0 extra D1 reads on filter/sort) ──
quantRouter.get("/funds", async (c) => {
  const user = await requireQuantAccess(c);
  const { rows } = await loadQuantCatalog(c.env.DB);

  const q = (c.req.query("q") || "").trim().toLowerCase();
  const platformGroup = (c.req.query("platform_group") || "all").trim();
  const domicile = (c.req.query("domicile") || "all").trim().toLowerCase();
  const roleFilter = (c.req.query("role") || "all").trim().toLowerCase();
  const currencyFilter = (c.req.query("currency") || "all").trim().toUpperCase();
  const tagsParam = (c.req.query("tags") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const assetClass = (c.req.query("asset_class") || "").trim();
  const minStars = parseInt(c.req.query("min_stars") || "0", 10) || 0;
  const tier = (c.req.query("tier") || "").trim().toUpperCase();
  const grade = (c.req.query("grade") || "").trim().toUpperCase();
  const excludeNonRec = c.req.query("exclude_non_rec") === "true";
  const onlyDistributing = c.req.query("only_distributing") === "true";
  const onlySop = c.req.query("only_sop") === "true";
  const onlyQueued = c.req.query("only_queued") === "true";
  const onlyAdminCore = c.req.query("only_admin_core") === "true";
  const distType = (c.req.query("dist_type") || "all").trim().toLowerCase();
  const sortKey = (c.req.query("sort") || "quant_score").trim();
  const order = (c.req.query("order") || "desc").toLowerCase() === "asc" ? 1 : -1;

  // Facets computed over full catalog
  const facets = {
    total: rows.length,
    aia: 0,
    non_ilas: 0,
    eu_ucits: 0,
    sop_covered: 0,
    queued_research: 0,
    admin_core_picks: 0,
    domiciles: {} as Record<string, number>,
    tiers: { A: 0, B: 0, C: 0, U: 0 } as Record<string, number>,
    asset_classes: {} as Record<string, number>,
  };
  for (const r of rows) {
    if ((r.ilas_platform || "").startsWith("AIA")) facets.aia++;
    else facets.non_ilas++;
    if (isEuropeanCategoryFund(r)) facets.eu_ucits++;
    if (r.has_sop_report) facets.sop_covered++;
    if (r.research_queue_status && ["queued", "watching", "in_progress"].includes(r.research_queue_status)) {
      facets.queued_research++;
    }
    if (r.is_admin_core_pick) facets.admin_core_picks++;
    const dom = getFundDomicile(r);
    facets.domiciles[dom] = (facets.domiciles[dom] || 0) + 1;
    facets.tiers[r.data_tier] = (facets.tiers[r.data_tier] || 0) + 1;
    facets.asset_classes[r.asset_class] = (facets.asset_classes[r.asset_class] || 0) + 1;
  }

  let filtered = rows.filter((r) => {
    if (platformGroup === "aia" && !(r.ilas_platform || "").startsWith("AIA")) return false;
    if (platformGroup === "non_ilas" && (r.ilas_platform || "").startsWith("AIA")) return false;
    if (platformGroup === "eu_ucits" && !isEuropeanCategoryFund(r)) return false;
    if (platformGroup === "us_intl" && !["非投连险-美股分红型ETF", "非投连险-国际股票", "非投连险-分红型基金", "非投连险-日本宽基ETF"].includes(r.ilas_platform || "")) return false;
    if (platformGroup === "cn_hk" && !["非投连险-中国分红", "非投连险-港股通ETF", "非投连险-A股价值型", "非投连险-中国QDII", "非投连险-货币基金"].includes(r.ilas_platform || "")) return false;
    if (platformGroup === "bonds" && r.ilas_platform !== "非投连险-债券基金比较" && r.asset_class !== "固定收益") return false;
    if (domicile && domicile !== "all") {
      const dom = getFundDomicile(r);
      if (domicile === "eu_ucits" && !isIrelandOrLuxembourgFund(r)) return false;
      else if (domicile === "ie" && dom !== "IE") return false;
      else if (domicile === "lu" && dom !== "LU") return false;
      else if (domicile === "non_us" && !isIlasFund(r) && dom === "US") return false;
      else if (domicile === "hk" && dom !== "HK") return false;
      else if (domicile === "cn" && dom !== "CN") return false;
      else if (domicile === "jp" && dom !== "JP") return false;
      else if (domicile === "us" && (isIlasFund(r) || dom !== "US")) return false;
    }
    if (roleFilter === "core" && inferFundRole(r) !== "core") return false;
    if (roleFilter === "satellite" && inferFundRole(r) !== "satellite") return false;
    if (currencyFilter && currencyFilter !== "ALL" && r.currency !== currencyFilter) return false;
    if (tagsParam.length > 0 && !tagsParam.some((t) => r.tags.includes(t))) return false;
    if (assetClass && assetClass !== "all" && r.asset_class !== assetClass) return false;
    if (minStars > 0 && (r.morningstar_stars || 0) < minStars) return false;
    if (tier && tier !== "ALL" && r.data_tier !== tier) return false;
    if (grade && grade !== "ALL" && r.quant_grade !== grade) return false;
    if (excludeNonRec && r.tags.includes("非推荐选择")) return false;
    if (onlySop && !r.has_sop_report) return false;
    if (onlyQueued && !["queued", "watching", "in_progress"].includes(r.research_queue_status || "")) return false;
    if (onlyAdminCore && !r.is_admin_core_pick) return false;
    if (onlyDistributing || distType === "dist") {
      if (!r.is_distributing) return false;
    } else if (distType === "acc") {
      if (r.is_distributing) return false;
    }
    if (q) {
      const hay = `${r.slug} ${r.code} ${r.aia_code || ""} ${r.isin || ""} ${r.yahoo_ticker || ""} ${r.name} ${r.manager || ""} ${r.tags.join(" ")} ${(r.admin_core_reasons || []).join(" ")} ${r.admin_core_note || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const numKeys = new Set<keyof QuantFundCatalogRow>([
    "quant_score",
    "sharpe_3y",
    "sortino_3y",
    "calmar_3y",
    "ret_ytd",
    "ret_1y",
    "ret_3y_ann",
    "ret_5y_ann",
    "vol_3y",
    "max_dd_3y",
    "div_yield_ttm",
    "fee_pct",
    "morningstar_stars",
    "obs_days",
  ]);

  filtered = filtered.sort((a, b) => {
    if (numKeys.has(sortKey as keyof QuantFundCatalogRow)) {
      const va = (a as any)[sortKey];
      const vb = (b as any)[sortKey];
      if (va == null && vb == null) return a.slug.localeCompare(b.slug);
      if (va == null) return 1;
      if (vb == null) return -1;
      return (Number(va) - Number(vb)) * order;
    }
    return String((a as any)[sortKey] || "").localeCompare(String((b as any)[sortKey] || "")) * order;
  });

  const canSeeWarnings = isAdvisorOrAdmin(user);
  const itemsOut = filtered.map(({ research_requester_ids, ...rest }) => ({
    ...sanitizeFundRowForRole(rest as QuantFundCatalogRow, canSeeWarnings),
    requested_by_me: Array.isArray(research_requester_ids) && research_requester_ids.includes(String(user.id)),
  }));

  return c.json({
    total_matched: itemsOut.length,
    facets,
    items: itemsOut,
  });
});

// ── 3. Single Fund Quant Profile + Twin Comparison ──────────────────────────
quantRouter.get("/funds/:slug", async (c) => {
  const user = await requireQuantAccess(c);
  const canSeeWarnings = isAdvisorOrAdmin(user);
  const slug = c.req.param("slug");
  const { lookup } = await loadQuantCatalog(c.env.DB);
  const fund = lookup.get(slug.trim().toUpperCase()) || (await resolveQuantFund(c.env.DB, slug));
  if (!fund) throw new HttpError(404, `未找到基金: ${slug}`);

  const twins: QuantFundCatalogRow[] = [];
  const seenTwinSlugs = new Set<string>([fund.slug]);
  if (Array.isArray(fund.twin_funds)) {
    for (const tf of fund.twin_funds) {
      if (tf?.slug && !seenTwinSlugs.has(tf.slug)) {
        const full = lookup.get(tf.slug.toUpperCase());
        if (full) {
          twins.push(full);
          seenTwinSlugs.add(full.slug);
        }
      }
    }
  }
  if (fund.twin_code) {
    const direct = lookup.get(fund.twin_code.trim().toUpperCase());
    if (direct && !seenTwinSlugs.has(direct.slug)) {
      twins.unshift(direct);
      seenTwinSlugs.add(direct.slug);
    }
  }
  const sanitizedTwins = twins.map((tw) => sanitizeFundRowForRole(tw, canSeeWarnings));
  return c.json({
    fund: sanitizeFundRowForRole(fund, canSeeWarnings),
    twin: sanitizedTwins[0] || null,
    twins: sanitizedTwins,
  });
});

// ── 3.1 Fund Top 10 Holdings (D1 Cache -> Yahoo Finance -> Commentary) ──────
quantRouter.get("/funds/:slug/holdings", async (c) => {
  await requireQuantAccess(c);
  const slug = c.req.param("slug");
  const forceRefresh = c.req.query("refresh") === "true";
  const fund = await resolveQuantFund(c.env.DB, slug);
  if (!fund) throw new HttpError(404, `未找到基金: ${slug}`);

  const result = await getFundTopHoldings(c.env.DB, fund, forceRefresh);
  return c.json({
    slug: fund.slug,
    code: fund.code,
    name: fund.name,
    ...result,
  });
});

// ── 4. Fund NAV + Benchmark + Drawdown Series (1-3 D1 rows read!) ───────────
quantRouter.get("/funds/:slug/nav", async (c) => {
  await requireQuantAccess(c);
  const slug = c.req.param("slug");
  const range = c.req.query("range") || "3y";
  const targetCcy = (c.req.query("currency") || "NATIVE").toUpperCase();

  const fund = await resolveQuantFund(c.env.DB, slug);
  if (!fund) throw new HttpError(404, `未找到基金: ${slug}`);

  const packed = await getQuantFundSeries(c.env.DB, fund.slug);
  if (!packed || packed.dates.length === 0) {
    return c.json({
      slug: fund.slug,
      currency: fund.currency,
      benchmark_code: fund.benchmark_code,
      points: [],
      dividends: [],
    });
  }

  const cutoff = rangeToCutoffIso(range);
  let adjMap: Record<string, number> = {};
  const navMap: Record<string, number> = {};
  for (let i = 0; i < packed.dates.length; i++) {
    const d = packed.dates[i];
    if (d >= cutoff) {
      adjMap[d] = packed.adj_nav[i];
      navMap[d] = packed.nav[i];
    }
  }
  if (targetCcy !== "NATIVE" && targetCcy !== packed.currency) {
    adjMap = await convertSeriesCurrency(c.env.DB, adjMap, packed.currency, targetCcy);
  }

  const bmPacked = await getQuantBenchmarkSeries(c.env.DB, fund.benchmark_code);
  let bmMap: Record<string, number> = {};
  if (bmPacked) {
    for (let i = 0; i < bmPacked.dates.length; i++) {
      if (bmPacked.dates[i] >= cutoff) {
        bmMap[bmPacked.dates[i]] = bmPacked.adj_close[i];
      }
    }
    if (targetCcy !== "NATIVE" && targetCcy !== bmPacked.currency) {
      bmMap = await convertSeriesCurrency(c.env.DB, bmMap, bmPacked.currency, targetCcy);
    }
  }

  const sortedDates = Object.keys(adjMap).sort();
  if (sortedDates.length === 0) {
    return c.json({ slug: fund.slug, currency: targetCcy === "NATIVE" ? packed.currency : targetCcy, points: [], dividends: [] });
  }

  const baseFund = adjMap[sortedDates[0]];
  let baseBm = 0;
  let lastBm = 0;
  let peak = 0;

  const points = sortedDates.map((d) => {
    const fVal = adjMap[d];
    const normFund = baseFund > 0 ? Math.round((fVal / baseFund) * 10000) / 100 : 100;
    if (normFund > peak) peak = normFund;
    const ddPct = peak > 0 ? Math.round(((normFund - peak) / peak) * 10000) / 100 : 0;

    if (bmMap[d] && bmMap[d] > 0) lastBm = bmMap[d];
    if (baseBm === 0 && lastBm > 0) baseBm = lastBm;
    const normBm = baseBm > 0 && lastBm > 0 ? Math.round((lastBm / baseBm) * 10000) / 100 : null;

    return {
      date: d,
      nav: navMap[d],
      norm_fund: normFund,
      norm_benchmark: normBm,
      drawdown_pct: ddPct,
      dividend: packed.dividends[d] || 0,
    };
  });

  const dividends = Object.entries(packed.dividends)
    .filter(([d]) => d >= cutoff)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, amount]) => ({ date, amount }));

  return c.json({
    slug: fund.slug,
    code: fund.code,
    name: fund.name,
    currency: targetCcy === "NATIVE" ? packed.currency : targetCcy,
    native_currency: packed.currency,
    series_type: packed.series_type,
    benchmark_code: fund.benchmark_code,
    points,
    dividends,
  });
});

// ── 5. Multi-Fund Side-by-Side Comparison (2–8 funds, 1 D1 row read per fund) ──
quantRouter.post("/compare", async (c) => {
  await requireQuantAccess(c);
  const body = await c.req.json<any>();
  const rawSlugs: string[] = Array.isArray(body.slugs) ? body.slugs.slice(0, 8) : [];
  if (rawSlugs.length < 2) {
    throw new HttpError(400, "請選擇 2 至 8 隻基金進行對比");
  }
  const range = String(body.range || "3y");
  const targetCcy = String(body.currency || "USD").toUpperCase();
  const cutoff = rangeToCutoffIso(range);

  const funds: QuantFundCatalogRow[] = [];
  const seriesBySlug: Record<string, Record<string, number>> = {};

  for (const s of rawSlugs) {
    const f = await resolveQuantFund(c.env.DB, s);
    if (!f) continue;
    funds.push(f);
    const packed = await getQuantFundSeries(c.env.DB, f.slug);
    if (!packed) continue;
    let adjMap: Record<string, number> = {};
    for (let i = 0; i < packed.dates.length; i++) {
      if (packed.dates[i] >= cutoff) adjMap[packed.dates[i]] = packed.adj_nav[i];
    }
    if (targetCcy !== "NATIVE" && targetCcy !== packed.currency) {
      adjMap = await convertSeriesCurrency(c.env.DB, adjMap, packed.currency, targetCcy);
    }
    seriesBySlug[f.slug] = adjMap;
  }

  const slugsWithData = funds.map((f) => f.slug).filter((s) => Object.keys(seriesBySlug[s] || {}).length >= 10);
  if (slugsWithData.length < 2) {
    return c.json({ funds, currency: targetCcy, chart: [], scatter: [], correlation_matrix: [] });
  }

  // Intersect dates (or fallback to union with ffill if strict intersection < 20)
  let dates = Object.keys(seriesBySlug[slugsWithData[0]]);
  for (let i = 1; i < slugsWithData.length; i++) {
    const setI = new Set(Object.keys(seriesBySlug[slugsWithData[i]]));
    dates = dates.filter((d) => setI.has(d));
  }
  dates.sort();
  if (dates.length < 20) {
    const allDates = new Set<string>();
    for (const s of slugsWithData) Object.keys(seriesBySlug[s]).forEach((d) => allDates.add(d));
    dates = Array.from(allDates).sort();
  }

  const aligned: Record<string, number[]> = {};
  for (const s of slugsWithData) {
    const m = seriesBySlug[s];
    let last = 0;
    const firstValid = Object.values(m).find((v) => v > 0) || 1;
    aligned[s] = dates.map((d) => {
      if (m[d] && m[d] > 0) last = m[d];
      return last > 0 ? last : firstValid;
    });
  }

  // Normalized chart (start = 100)
  const chart = dates.map((d, idx) => {
    const row: Record<string, any> = { date: d };
    for (const s of slugsWithData) {
      const base = aligned[s][0] || 1;
      row[s] = Math.round((aligned[s][idx] / base) * 10000) / 100;
    }
    return row;
  });

  // Correlation matrix on daily returns
  const retsBySlug: Record<string, number[]> = {};
  for (const s of slugsWithData) {
    const arr = aligned[s];
    const rets: number[] = [];
    for (let i = 1; i < arr.length; i++) {
      rets.push(arr[i - 1] > 0 ? arr[i] / arr[i - 1] - 1 : 0);
    }
    retsBySlug[s] = rets;
  }

  const correlationMatrix: Array<{ asset1: string; asset2: string; value: number }> = [];
  for (const a of slugsWithData) {
    const ra = retsBySlug[a];
    const ma = ra.reduce((acc, x) => acc + x, 0) / Math.max(1, ra.length);
    const va = ra.reduce((acc, x) => acc + (x - ma) ** 2, 0);
    for (const b of slugsWithData) {
      const rb = retsBySlug[b];
      const mb = rb.reduce((acc, x) => acc + x, 0) / Math.max(1, rb.length);
      const vb = rb.reduce((acc, x) => acc + (x - mb) ** 2, 0);
      let cov = 0;
      for (let i = 0; i < ra.length; i++) cov += (ra[i] - ma) * (rb[i] - mb);
      const denom = Math.sqrt(va * vb);
      const corr = denom > 0 ? Math.max(-1, Math.min(1, cov / denom)) : 1;
      correlationMatrix.push({ asset1: a, asset2: b, value: Math.round(corr * 100) / 100 });
    }
  }

  const scatter = funds.map((f) => ({
    slug: f.slug,
    code: f.code,
    name: f.name,
    asset_class: f.asset_class,
    vol_pct: f.vol_3y != null ? Math.round(f.vol_3y * 10000) / 100 : null,
    ret_pct: f.ret_3y_ann != null ? Math.round(f.ret_3y_ann * 10000) / 100 : f.ret_1y != null ? Math.round(f.ret_1y * 10000) / 100 : null,
    sharpe: f.sharpe_3y,
  }));

  return c.json({
    currency: targetCcy,
    funds,
    chart,
    scatter,
    correlation_matrix: correlationMatrix,
  });
});

// ── 6. Historical Stress-Test Replay (uses D1 packed series + benchmarks) ──
const STRESS_WINDOWS = [
  { id: "china_2015_crash", label: "2015 新兴市场/A股去杠杆巨震", label_en: "2015 China/EM Deleveraging Shock", start: "2015-06-12", end: "2015-09-30" },
  { id: "fed_qt_2018_q4", label: "2018 Q4 美联储缩表与贸易摩擦回撤", label_en: "2018 Q4 Fed QT & Trade Shock", start: "2018-09-20", end: "2018-12-24" },
  { id: "covid_2020_crash", label: "2020.03 新冠疫情全球流动性熔断", label_en: "2020 COVID-19 Liquidity Crash", start: "2020-02-19", end: "2020-03-23" },
  { id: "rate_hike_2022", label: "2022 全球激进加息股债双杀", label_en: "2022 Global Rate Hike Shock", start: "2022-01-03", end: "2022-10-21" },
  { id: "q3_2023_yield_spike", label: "2023 下半年美债长端利率飙升", label_en: "2023 H2 Long-Bond Yield Spike", start: "2023-07-31", end: "2023-10-27" },
  { id: "aug_2024_carry_unwind", label: "2024.08 日元套息平仓闪崩", label_en: "Aug 2024 Yen Carry Unwind", start: "2024-07-16", end: "2024-08-09" },
  { id: "tariff_2025_drawdown", label: "2025 关税与政策冲击波动窗", label_en: "2025 Tariff Volatility Window", start: "2025-02-19", end: "2025-04-15" },
];

quantRouter.post("/stress-test", async (c) => {
  await requireQuantAccess(c);
  const body = await c.req.json<any>();
  const allocations: Record<string, number> = body.allocations || {};
  const targetCcy = String(body.currency || "USD").toUpperCase();
  const entries = Object.entries(allocations).filter(([, w]) => Number(w) > 0);
  if (entries.length === 0) throw new HttpError(400, "請提供有效的資產權重");

  const totalW = entries.reduce((acc, [, w]) => acc + Number(w), 0);
  const normWeights: Record<string, number> = {};
  for (const [k, w] of entries) normWeights[k] = Number(w) / totalW;

  const seriesByAsset: Record<string, Record<string, number>> = {};
  for (const [assetId] of entries) {
    const f = await resolveQuantFund(c.env.DB, assetId);
    const packed = f ? await getQuantFundSeries(c.env.DB, f.slug) : null;
    if (packed && packed.dates.length >= 20) {
      let m: Record<string, number> = {};
      for (let i = 0; i < packed.dates.length; i++) m[packed.dates[i]] = packed.adj_nav[i];
      if (targetCcy !== "NATIVE" && targetCcy !== packed.currency) {
        m = await convertSeriesCurrency(c.env.DB, m, packed.currency, targetCcy);
      }
      // Pre-inception benchmark back-stitching so newer funds (e.g. SPYL) also participate in 2015/2018/2020 stress replay
      const realDates = Object.keys(m).sort();
      const firstReal = realDates[0];
      if (firstReal && firstReal > "2015-07-01") {
        const proxy = await buildBenchmarkProxySeries(
          c.env.DB,
          f || { code: assetId, name: assetId },
          5500,
          targetCcy
        );
        if (proxy && Object.keys(proxy.series).length >= 20 && proxy.series[firstReal] > 0 && m[firstReal] > 0) {
          const scale = m[firstReal] / proxy.series[firstReal];
          for (const [pd, pv] of Object.entries(proxy.series)) {
            if (pd < firstReal && pv > 0) {
              m[pd] = Math.round(pv * scale * 1e6) / 1e6;
            }
          }
        }
      }
      seriesByAsset[assetId] = m;
    } else {
      const proxy = await buildBenchmarkProxySeries(
        c.env.DB,
        f || { code: assetId, name: assetId },
        5500,
        targetCcy
      );
      if (proxy && Object.keys(proxy.series).length >= 20) {
        seriesByAsset[assetId] = proxy.series;
      }
    }
  }

  const scenarios = STRESS_WINDOWS.map((win) => {
    const covered = entries.filter(([id]) => {
      const m = seriesByAsset[id];
      if (!m) return false;
      const ds = Object.keys(m).filter((d) => d >= win.start && d <= win.end);
      return ds.length >= 5;
    });
    if (covered.length === 0) {
      return { ...win, available: false, coverage_weight: 0, total_return_pct: null, max_drawdown_pct: null };
    }
    const covW = covered.reduce((acc, [id]) => acc + normWeights[id], 0);
    const allDates = Array.from(
      new Set(
        covered.flatMap(([id]) => Object.keys(seriesByAsset[id]).filter((d) => d >= win.start && d <= win.end))
      )
    ).sort();

    let peak = 100;
    let maxDd = 0;
    let lastVal = 100;
    const startPrices: Record<string, number> = {};
    const lastPrices: Record<string, number> = {};

    for (const d of allDates) {
      let portVal = 0;
      for (const [id] of covered) {
        const p = seriesByAsset[id][d];
        if (p && p > 0) lastPrices[id] = p;
        if (!startPrices[id] && lastPrices[id]) startPrices[id] = lastPrices[id];
        const ratio = startPrices[id] && lastPrices[id] ? lastPrices[id] / startPrices[id] : 1;
        portVal += (normWeights[id] / covW) * 100 * ratio;
      }
      lastVal = portVal;
      if (portVal > peak) peak = portVal;
      const dd = peak > 0 ? (portVal - peak) / peak : 0;
      if (dd < maxDd) maxDd = dd;
    }

    return {
      ...win,
      available: true,
      coverage_weight: Math.round(covW * 1000) / 10,
      total_return_pct: Math.round((lastVal - 100) * 100) / 100,
      max_drawdown_pct: Math.round(maxDd * 10000) / 100,
    };
  });

  return c.json({ currency: targetCcy, scenarios });
});

// ── 7. Client Profile & Needs Recommendation Engine (0 D1 writes) ───────────
quantRouter.post("/recommend", async (c) => {
  const user = await requireQuantAccess(c);
  const body = await c.req.json<any>().catch(() => ({}));
  const result = await recommendForClient(c.env.DB, user, body || {});
  return c.json(result);
});

// ── 7.5 Latest Macro & Commodity Snapshot (0 D1 writes) ─────────────────
quantRouter.get("/macro/latest", async (c) => {
  await requireQuantAccess(c);
  const snap = await getLatestMacroSnapshot(c.env.DB);
  return c.json(snap);
});

// ── 8. AI-Powered Portfolio Explanation & Macro Regime Analysis (0 D1 writes) ──
quantRouter.post("/recommend/explain", async (c) => {
  await requireQuantAccess(c);
  const body = await c.req.json<any>().catch(() => ({}));
  const profile = body.profile || {};
  const rec = body.recommendation || {};
  const model = body.model || "deepseek-pro";
  const [macroSnap, catalogData] = await Promise.all([
    getLatestMacroSnapshot(c.env.DB),
    loadQuantCatalog(c.env.DB),
  ]);
  const macroBlock = formatMacroPromptBlock(macroSnap);
  const effectiveProfile =
    rec?.hk_broker_etf_only && !profile?.product_scope
      ? { ...profile, product_scope: "hk_broker_etf" }
      : rec?.universe_mode === "hk_broker" && !profile?.product_scope
        ? { ...profile, product_scope: "hk_broker" }
        : profile;
  const candidatePool = buildTacticalCandidatePool(
    catalogData.rows,
    effectiveProfile,
    Array.isArray(rec.holdings) ? rec.holdings : [],
    14
  );

  const holdingsSummary = Array.isArray(rec.holdings)
    ? rec.holdings
        .map(
          (h: any) =>
            `- ${h.lab_id || h.slug} (${h.name || "未命名"})${
              h.is_admin_core_pick
                ? ` [⭐管理员核心推荐${Array.isArray(h.admin_core_reasons) && h.admin_core_reasons.length > 0 ? `(${h.admin_core_reasons.join("/")})` : "(投委会首选)"}]`
                : ""
            }: 权重 ${h.weight_pct || h.weight}%, 角色=${h.core_role === "satellite" ? "卫星" : "核心"}, 资产类型=${h.asset_class || "大类标的"}, 费率=${h.fee_pct != null ? `${h.fee_pct}%` : "N/A"}, Alpha=${h.alpha_3y != null ? `${(h.alpha_3y * 100).toFixed(2)}%` : "N/A"}, R²=${h.r2_3y != null ? h.r2_3y.toFixed(2) : "N/A"}, 逻辑: ${h.rationale_zh || h.rationale_en || "核心资产"}`
        )
        .join("\n")
    : "暂无明细";

  const candidatePoolBlock =
    candidatePool.length > 0
      ? candidatePool
          .map(
            (cand) =>
              `- ${cand.lab_id} (${cand.name})${
                cand.is_admin_core_pick
                  ? ` [⭐管理员核心推荐${Array.isArray(cand.admin_core_reasons) && cand.admin_core_reasons.length > 0 ? `(${cand.admin_core_reasons.join("/")})` : "(投委会首选)"}]`
                  : ""
              }: 类别=${cand.asset_class}, 定位=${cand.core_role === "core" ? "核心" : "卫星"}, 税籍=${getFundDomicile(cand as any)}, 赛道=${cand.homogeneity_cluster}, 平台=${cand.ilas_platform || "全市场"}, 费率=${cand.fee_pct != null ? `${cand.fee_pct}%` : "N/A"}, Alpha=${cand.alpha_3y != null ? `${(cand.alpha_3y * 100).toFixed(2)}%` : "N/A"}, R²=${cand.r2_3y != null ? cand.r2_3y.toFixed(2) : "N/A"}, 股息=${cand.div_yield_ttm != null ? `${(cand.div_yield_ttm * 100).toFixed(1)}%` : "N/A"}, 评级=${cand.quant_grade || "N/A"}`
          )
          .join("\n")
      : "无额外候补基金（请基于原篮子标的调整权重）";

  const recUniverse =
    rec?.universe_mode === "ilas" || rec?.universe_mode === "non_ilas" || rec?.universe_mode === "hk_broker"
      ? rec.universe_mode
      : resolveBasketUniverseMode(
          effectiveProfile,
          Array.isArray(rec.holdings) ? rec.holdings : [],
          catalogData.rows
        );
  const isIlasMode = recUniverse === "ilas";
  const isHkBrokerMode = recUniverse === "hk_broker";
  const isHkBrokerEtfOnly =
    !isIlasMode && (effectiveProfile?.product_scope === "hk_broker_etf" || Boolean(rec?.hk_broker_etf_only));
  const estateTaxShield = !isIlasMode && !isHkBrokerEtfOnly && hasUsEstateTaxConcern(effectiveProfile);
  const ilasConstraintRule = isIlasMode
    ? "4. 【纯投连险平台硬约束】本组合为纯投连险（AIA 卓达智悦2）组合，严禁混入任何平台外非投连险基金/ETF，且所有保留或新增标的的 `adjusted_weight_pct` 必须为 >= 10 的整数（或设为 0 表示剔除）；"
    : isHkBrokerEtfOnly
      ? "4. 【香港券商纯低费 ETF 硬约束】本组合为纯低费 ETF 方案（适配香港主流券商），严禁推荐或换入任何爱尔兰/卢森堡注册 ETF（如 CSPX/VWRA/IWDA/IB01/CSH2/AGGU/LQDA 等）以及任何互惠基金（含投连险基金与美股互惠基金）；仅允许保留或增配香港券商可直接交易的美/港/日低费 ETF，单只权重建议 >= 5%；"
      : isHkBrokerMode
        ? `4. 【香港券商平台硬约束】本组合面向香港本地主流券商渠道，严禁推荐或换入任何爱尔兰或卢森堡注册的 UCITS ETF（如 CSPX/VWRA/IWDA/IB01/CSH2/AGGU/LQDA 等欧交所挂牌 ETF）；仅允许保留或增配香港券商可交易的互惠基金（Mutual Fund / SICAV，含爱尔兰/卢森堡注册互惠基金）与美/港/日/中港通 ETF；单只保留或新增标的建议权重 >= 5%；${
            estateTaxShield
              ? "\n4b. 【香港券商 + 美国遗产税隔离硬约束】客户同时关注美国遗产税风险（非美居民持有美国本土 ETF 免税额仅 6 万美元），因香港券商无法直接购买爱尔兰/卢森堡 ETF，请优先且仅选用爱尔兰/卢森堡注册互惠基金（Mutual Fund / SICAV）来规避美国遗产税，严禁建议美国本土 ETF 或爱尔兰/卢森堡 ETF；"
              : ""
          }`
        : `4. 【纯非投连险硬约束】本组合为纯平台外基金/ETF 组合，严禁混入任何投连险（AIA/ILAS）平台基金；单只保留或新增标的建议权重 >= 5%，避免过于零碎；${
            estateTaxShield
              ? "\n4b. 【美国遗产税隔离硬约束】客户关注美国遗产税风险（非美税务居民持有美国本土 US-Situs ETF 免税额仅 6 万美元，超额税率最高 40%）。本组合为非投连险平台架构，所有保留或替换标的必须 100% 采用爱尔兰（IE）或卢森堡（LU）注册的欧洲 UCITS 基金，严禁建议任何美国本土注册 ETF，并在报告第二章阐明爱尔兰/卢森堡 UCITS 架构在规避美股遗产税及股息预扣税协定上的核心优势；"
              : ""
          }`;

  const metricsSummary = rec.metrics
    ? `预期3Y年化: ${rec.metrics.est_cagr_pct}%, 年化波动率: ${rec.metrics.est_vol_pct}%, 夏普比率: ${rec.metrics.est_sharpe}, 参考股息率: ${rec.metrics.est_div_yield_pct}%, 加权年费率: ${rec.metrics.weighted_fee_pct || 0}%`
    : "未提供汇总指标";

  const prompt = `请作为买方量化首席投资顾问，为以下客户及为其匹配的资产组合出具一份专业、客观中立的投资配置分析与归因报告。

【客户基本画像与核心需求】
- 客户姓名/称呼: ${profile.client_name || "尊贵客户"}
- 年龄: ${profile.age || "未指定"} 岁
- 初始配置资金: ${profile.currency || "USD"} ${profile.initial_capital ? Number(profile.initial_capital).toLocaleString() : "500,000"}
- 投资期限: ${profile.horizon_years || 10} 年
- 主要财务目标: ${profile.primary_goal || "均衡增值"}
- 风险评级: ${profile.risk_level || "稳健"} (评分: ${profile.risk_score || 55}/100)
- 现金流提取诉求: ${profile.annual_withdrawal ? `每年提取 ${profile.currency} ${profile.annual_withdrawal}` : "无定期提取需求"}
- 期望年化股息率: ${profile.target_annual_yield_pct ? `${profile.target_annual_yield_pct}%` : "未特别设定"}
- 架构平台: ${
  isIlasMode
    ? "纯投连险架构 (AIA 卓达智悦2)"
    : isHkBrokerEtfOnly
      ? "香港券商 · 纯低费 ETF（美/港/日 ETF，剔除爱尔兰/卢森堡 ETF 与互惠基金）"
      : isHkBrokerMode
        ? "香港券商平台（保留互惠基金与美/港/日 ETF，剔除爱尔兰/卢森堡 ETF）"
        : "纯平台外非投连险基金/ETF"
}（${profile.product_scope || "strict"}）
- 【重要】客户补充背景与特别诉求:
${profile.extra_notes ? profile.extra_notes : "无特别补充事项"}

【当前推荐组合方案与持仓明细】
方案名称: ${rec.title_zh || rec.title || "量化优选配置方案"}
组合概括: ${rec.subtitle_zh || rec.subtitle || ""}
量化指标: ${metricsSummary}
底层资产持仓明细:
${holdingsSummary}

【同平台候补基金白名单池（如客户特殊诉求或宏观对冲需要替换/新增标的，可直接选用池内真实代码，严禁编造池外代码）】
${candidatePoolBlock}

${macroBlock}

【配置原则与报告输出要求】
1. 严格遵循「核心—卫星」配置原则（核心资产 ≥ 70% 承担广泛高质量 Beta 压舱，仅限全球/发达/美股大盘宽基与全球/美股红利高股息、主权国债/全球及美元投资级综合债、短债/货币现金与经典股债平衡；高收益债、新兴市场/亚洲/单一非美国家资产、可转债/优先证券、期权备兑及行业主题资产一律只能归为卫星资产，且卫星合计 ≤ 30%），并审视同质性、费率与指数贴合度/Alpha 效率；凡标注「⭐管理员核心推荐」的标的均为投委会严选核心池标的，在符合平台隔离、美国遗产税与客户风险上限前提下应优先保留并维持较高权重；
2. 完全基于上方实时宏观数据客观判断所处利率与估值周期，禁止套用刻板预设观点；任何偏离或换基建议必须附带明确的**退出/复位条件**。
请使用规范清晰的 Markdown 格式输出，包含以下章节结构：
### 一、宏观利率与市场估值时钟研判（基于当期利率、利差、ERP 与大宗商品数据的中性客观研判）
### 二、客户画像与个性化诉求深度响应（结合客户补充背景、税务/开支/久期/外部资产敞口精准分析）
### 三、核心—卫星角色分工、底层重合度与换基增配评估（审视当前组合并论证是否需从候补池替换或增配标的）
### 四、多宏观情景推演与极端压力韧性（利率上行/降息周期、滞胀、权益回调下的表现预案与退出复位纪律）
### 五、量身定制的操作建议与后续跟踪要点（建仓节奏、再平衡阈值、分红再投资建议）

要求：专业严谨、数据扎实、结构清晰；每节精炼在 180–300 字（总正文约 1200–1600 字，直击数据与决策，避免冗长套话），不要将正文包裹在 \`\`\`markdown 代码块中。

【重要：结构化战术调仓、换基与实验室参数指令输出】
在整份正文报告的**最末尾**，请务必紧跟一段严格合法的 JSON（用 <tactical_json> 和 </tactical_json> 标签包裹），把你的分析结论转化为可直接指导「权重修正 / 换基增配」与「策略实验室模拟」的结构化指令：
1. \`adjusted_holdings\` 中的 \`lab_id\` 只能来自上方【底层资产持仓明细】或【同平台候补基金白名单池】（严禁编造池外代码）；
2. 若认为应从候补池替换或新增标的（如增配黄金、短债或港股红利等），可在 \`adjusted_holdings\` 中将原被替换标的设为 \`0\`（或替换），并加入候补池标的的 \`lab_id\` 与目标整数权重；
3. 所有 \`adjusted_weight_pct\` 必须为非负整数且严格相加等于 100，并尽量保持卫星合计 ≤ 30%；
${ilasConstraintRule}
5. 如果客户补充诉求中有特定年份刚性大额支出（例如3年后留学支出15万）或分阶段提领需求，请精准提取到 \`lab_directives\` 的 \`withdrawal\` / \`withdrawal_2\` 与起止年份中；
6. 格式示例如下（请替换为你的真实测算数值）：
<tactical_json>
{
  "tactical_summary_zh": "一句话概括本次核心—卫星调整/换基依据及退出复位条件",
  "adjusted_holdings": [
    { "lab_id": "BIL", "adjusted_weight_pct": 35, "reason_zh": "调整或保留理由（若为新增请说明补充角色）" }
  ],
  "lab_directives": {
    "cma_mode": "forward_looking",
    "capital": ${profile.initial_capital ? Number(profile.initial_capital) : 500000},
    "years": ${profile.horizon_years ? Number(profile.horizon_years) : 10},
    "withdrawal": ${profile.annual_withdrawal ? Number(profile.annual_withdrawal) : 0},
    "withdrawal_start": 1,
    "withdrawal_end": ${profile.horizon_years ? Number(profile.horizon_years) : 10},
    "withdrawal_2": 0,
    "withdrawal_start_2": 1,
    "withdrawal_end_2": 10,
    "stress": false,
    "directive_notes_zh": "概括为何设定这些实验室模拟与现金流验证参数"
  }
}
</tactical_json>`;

  const wantStream =
    body.stream === true ||
    (c.req.header("accept") || "").toLowerCase().includes("text/event-stream");

  if (!wantStream) {
    const llmResult = await callLlmChat(c.env, prompt, {
      modelPreference: model,
      temperature: 0.35,
      maxTokens: 8192,
      useUpstreamStream: true,
    });

    const { cleanMarkdown, tacticalAdjustment } = extractAndNormalizeTacticalJson(
      llmResult.text,
      profile,
      rec,
      candidatePool
    );

    return c.json({
      analysis: cleanMarkdown,
      tactical_adjustment: tacticalAdjustment,
      model_used: llmResult.modelUsed,
      provider: llmResult.provider,
      reasoning: llmResult.reasoning || null,
      fallback_reason: llmResult.fallbackReason || null,
      candidate_pool_count: candidatePool.length,
    });
  }

  const encoder = new TextEncoder();
  const startedAt = Date.now();
  let latestProgress = {
    stage: "connecting" as "connecting" | "thinking" | "writing",
    model: String(model || "deepseek-pro"),
    reasoning_chars: 0,
    content_chars: 0,
  };

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  let closed = false;
  let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  let writeChain = Promise.resolve();

  const enqueueChunk = (chunkStr: string) => {
    if (closed) return;
    writeChain = writeChain
      .then(async () => {
        if (!closed) {
          await writer.write(encoder.encode(chunkStr));
        }
      })
      .catch(() => {
        closed = true;
      });
  };

  const sendEvent = (eventName: string, dataObj: unknown) => {
    enqueueChunk(`event: ${eventName}\ndata: ${JSON.stringify(dataObj)}\n\n`);
  };

  const scheduleHeartbeat = () => {
    if (closed) return;
    heartbeatTimer = setTimeout(() => {
      if (closed) return;
      sendEvent("progress", {
        elapsed: Math.round((Date.now() - startedAt) / 1000),
        ...latestProgress,
      });
      scheduleHeartbeat();
    }, 2000);
  };

  // Emit immediate SSE comment + progress frame so Cloudflare flushes HTTP 200 & CORS headers at once
  enqueueChunk(": ok\n\n");
  sendEvent("progress", {
    elapsed: 0,
    ...latestProgress,
  });
  scheduleHeartbeat();

  const pumpPromise = (async () => {
    try {
      const llmResult = await callLlmChat(c.env, prompt, {
        modelPreference: model,
        temperature: 0.35,
        maxTokens: 8192,
        useUpstreamStream: true,
        onProgress: (info) => {
          latestProgress = {
            stage: info.stage,
            model: info.model,
            reasoning_chars: info.reasoningChars,
            content_chars: info.contentChars,
          };
          sendEvent("progress", {
            elapsed: Math.round((Date.now() - startedAt) / 1000),
            ...latestProgress,
          });
        },
      });

      const { cleanMarkdown, tacticalAdjustment } = extractAndNormalizeTacticalJson(
        llmResult.text,
        profile,
        rec,
        candidatePool
      );

      sendEvent("result", {
        analysis: cleanMarkdown,
        tactical_adjustment: tacticalAdjustment,
        model_used: llmResult.modelUsed,
        provider: llmResult.provider,
        reasoning: llmResult.reasoning || null,
        fallback_reason: llmResult.fallbackReason || null,
        candidate_pool_count: candidatePool.length,
      });
    } catch (err: any) {
      sendEvent("error", {
        detail: err?.message || "AI 投顾生成失败，请稍后重试",
      });
    } finally {
      if (heartbeatTimer) {
        clearTimeout(heartbeatTimer);
        heartbeatTimer = null;
      }
      await writeChain.catch(() => {});
      if (!closed) {
        closed = true;
        try {
          await writer.close();
        } catch {
          // ignore already-closed pipe
        }
      }
    }
  })();

  try {
    c.executionCtx?.waitUntil(pumpPromise);
  } catch {
    // Unit test environment without ExecutionContext
  }

  return c.body(readable, 200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
  });
});

// ── 9. Factsheet Async Refresh Queue Status ────────────────────────────────
quantRouter.get("/factsheet-queue", async (c) => {
  await requireQuantAccess(c);
  try {
    const { results } = await c.env.DB.prepare(
      "SELECT * FROM wq_factsheet_queue ORDER BY CASE WHEN status='pending' THEN 0 ELSE 1 END, requested_at DESC LIMIT 50"
    ).all();
    return c.json({ items: results || [] });
  } catch {
    return c.json({ items: [] });
  }
});

// ── 10. Single-Fund SOP v2.0 Deep Analysis & Research Watchlist Queue ──────
function safeParseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

quantRouter.get("/funds/:slug/sop-report", async (c) => {
  const user = await requireQuantAccess(c);
  const rawSlug = c.req.param("slug");
  const fund = await resolveQuantFund(c.env.DB, rawSlug);
  const canonicalSlug = fund?.slug || rawSlug.trim();

  let reportRow: any = null;
  let queueRow: any = null;
  try {
    reportRow = await c.env.DB.prepare(
      "SELECT * FROM wq_fund_sop_reports WHERE slug = ? COLLATE NOCASE OR code = ? COLLATE NOCASE"
    )
      .bind(canonicalSlug, canonicalSlug)
      .first<any>();
  } catch {
    reportRow = null;
  }
  try {
    queueRow = await c.env.DB.prepare("SELECT * FROM wq_fund_research_queue WHERE slug = ?")
      .bind(canonicalSlug)
      .first<any>();
  } catch {
    queueRow = null;
  }

  const requesters = safeParseJson<any[]>(queueRow?.requesters_json, []);
  const myEntry = requesters.find((r) => String(r?.user_id) === String(user.id)) || null;
  const allNotes = requesters
    .map((r) => {
      const n = String(r?.note || "").trim();
      if (!n) return "";
      const who = String(r?.name || r?.email || "").trim();
      return who ? `${who}：${n}` : n;
    })
    .filter(Boolean);
  if (queueRow?.admin_note && String(queueRow.admin_note).trim()) {
    allNotes.push(`管理员备注：${String(queueRow.admin_note).trim()}`);
  }
  const queueSummary = queueRow
    ? {
        slug: queueRow.slug,
        status: queueRow.status,
        priority: queueRow.priority,
        request_count: Number(queueRow.request_count || requesters.length || 0),
        requested_by_me: Boolean(myEntry),
        my_note: myEntry?.note || "",
        notes: allNotes,
        requesters: requesters.map((r) => ({
          name: r?.name || r?.email || "用户",
          role: r?.role || "",
          note: r?.note || "",
          requested_at: r?.requested_at || null,
        })),
        first_requested_at: queueRow.first_requested_at,
        last_requested_at: queueRow.last_requested_at,
        admin_note: queueRow.admin_note || null,
      }
    : null;

  const canViewSopWarnings = isAdvisorOrAdmin(user);
  if (!reportRow) {
    return c.json({
      has_report: false,
      slug: canonicalSlug,
      code: fund?.code || rawSlug,
      can_view_internal_decision: user.role === "admin",
      can_view_sop_warnings: canViewSopWarnings,
      queue_entry: queueSummary,
    });
  }

  const isAdmin = user.role === "admin";
  const rawTabs = safeParseJson<any[]>(reportRow.commercial_tabs_json, []);
  const rawMasters = safeParseJson<any[]>(reportRow.masters_json, []);
  return c.json({
    has_report: true,
    slug: reportRow.slug,
    code: reportRow.code,
    fund_name: reportRow.fund_name,
    sop_version: reportRow.sop_version,
    report_date: reportRow.report_date,
    data_as_of: reportRow.data_as_of,
    fund_type: reportRow.fund_type,
    val_route: reportRow.val_route,
    medal_rating: !canViewSopWarnings && reportRow.medal_rating === "Negative" ? "" : reportRow.medal_rating,
    pillar_score: reportRow.pillar_score != null ? Number(reportRow.pillar_score) : null,
    g1_g5_pass: Boolean(reportRow.g1_g5_pass),
    uncertainty: reportRow.uncertainty,
    valuation_zone: reportRow.valuation_zone,
    valuation_pct_5y: reportRow.valuation_pct_5y != null ? Number(reportRow.valuation_pct_5y) : null,
    dividend_yield_ttm: reportRow.dividend_yield_ttm != null ? Number(reportRow.dividend_yield_ttm) : null,
    dividend_spread_rf: reportRow.dividend_spread_rf != null ? Number(reportRow.dividend_spread_rf) : null,
    one_liner: reportRow.one_liner || "",
    red_flag_top: canViewSopWarnings ? reportRow.red_flag_top || "" : "",
    pillars: safeParseJson<Record<string, any>>(reportRow.pillar_json, {}),
    valuation_summary: safeParseJson<Record<string, any>>(reportRow.valuation_summary_json, {}),
    dividend_summary: safeParseJson<Record<string, any>>(reportRow.dividend_summary_json, {}),
    masters: canViewSopWarnings ? rawMasters : [],
    commercial_tabs: canViewSopWarnings ? rawTabs : sanitizeSopTabsForClient(rawTabs),
    one_pager_md: reportRow.one_pager_md || "",
    // Compliance Isolation: internal B-edition decision tree strictly restricted to admin; SOP warnings/negative red-team restricted to advisor & admin
    can_view_internal_decision: isAdmin,
    can_view_sop_warnings: canViewSopWarnings,
    decision_md: isAdmin ? reportRow.decision_md || null : null,
    published_at: reportRow.published_at,
    updated_at: reportRow.updated_at,
    queue_entry: queueSummary,
  });
});

quantRouter.post("/funds/:slug/research-request", async (c) => {
  const user = await requireQuantAccess(c);
  const rawSlug = c.req.param("slug");
  const fund = await resolveQuantFund(c.env.DB, rawSlug);
  if (!fund) {
    throw new HttpError(404, `未找到基金: ${rawSlug}`);
  }

  let body: { note?: string; priority_hint?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const note = String(body.note || "").trim().slice(0, 300);
  const hint = body.priority_hint === "P0_urgent" || body.priority_hint === "P1_high" ? body.priority_hint : "normal";
  const nowIso = new Date().toISOString();

  const existing = await c.env.DB.prepare("SELECT * FROM wq_fund_research_queue WHERE slug = ?")
    .bind(fund.slug)
    .first<any>();

  const requesters = safeParseJson<any[]>(existing?.requesters_json, []);
  const uid = String(user.id);
  const idx = requesters.findIndex((r) => String(r?.user_id) === uid);
  const entry = {
    user_id: uid,
    name: user.name || user.email,
    email: user.email,
    role: user.role,
    note,
    requested_at: nowIso,
  };
  if (idx >= 0) {
    requesters[idx] = entry;
  } else {
    requesters.push(entry);
  }

  const reqCount = requesters.length;
  const nextStatus =
    !existing || existing.status === "dismissed" || existing.status === "completed"
      ? "queued"
      : existing.status;
  const prioRank: Record<string, number> = { P0_urgent: 0, P1_high: 1, normal: 2 };
  const currentPrio = existing?.priority || "normal";
  const nextPriority = prioRank[hint] < prioRank[currentPrio] ? hint : currentPrio;

  await c.env.DB.prepare(
    `INSERT INTO wq_fund_research_queue (
      slug, code, fund_name, asset_class, ilas_platform, status, priority,
      request_count, requesters_json, first_requested_at, last_requested_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      code = excluded.code,
      fund_name = excluded.fund_name,
      asset_class = excluded.asset_class,
      ilas_platform = excluded.ilas_platform,
      status = excluded.status,
      priority = excluded.priority,
      request_count = excluded.request_count,
      requesters_json = excluded.requesters_json,
      last_requested_at = excluded.last_requested_at`
  )
    .bind(
      fund.slug,
      fund.code || fund.slug,
      fund.name,
      fund.asset_class,
      fund.ilas_platform || null,
      nextStatus,
      nextPriority,
      reqCount,
      JSON.stringify(requesters),
      existing?.first_requested_at || nowIso,
      nowIso
    )
    .run();

  clearQuantStoreCaches();

  return c.json({
    success: true,
    slug: fund.slug,
    status: nextStatus,
    priority: nextPriority,
    request_count: reqCount,
    requested_by_me: true,
    my_note: note,
  });
});

quantRouter.delete("/funds/:slug/research-request", async (c) => {
  const user = await requireQuantAccess(c);
  const rawSlug = c.req.param("slug");
  const fund = await resolveQuantFund(c.env.DB, rawSlug);
  const canonicalSlug = fund?.slug || rawSlug.trim();

  const existing = await c.env.DB.prepare("SELECT * FROM wq_fund_research_queue WHERE slug = ?")
    .bind(canonicalSlug)
    .first<any>();

  if (!existing) {
    return c.json({ success: true, slug: canonicalSlug, request_count: 0, requested_by_me: false });
  }

  const uid = String(user.id);
  const remaining = safeParseJson<any[]>(existing.requesters_json, []).filter(
    (r) => String(r?.user_id) !== uid
  );

  if (remaining.length === 0 && existing.status === "queued") {
    await c.env.DB.prepare("DELETE FROM wq_fund_research_queue WHERE slug = ?")
      .bind(canonicalSlug)
      .run();
    clearQuantStoreCaches();
    return c.json({ success: true, slug: canonicalSlug, request_count: 0, requested_by_me: false });
  }

  await c.env.DB.prepare(
    "UPDATE wq_fund_research_queue SET request_count = ?, requesters_json = ? WHERE slug = ?"
  )
    .bind(remaining.length, JSON.stringify(remaining), canonicalSlug)
    .run();

  clearQuantStoreCaches();
  return c.json({
    success: true,
    slug: canonicalSlug,
    request_count: remaining.length,
    requested_by_me: false,
  });
});

// ── 10. Full Institutional Portfolio X-Ray v2 (Funds + Direct Stocks/Bonds) ─
quantRouter.post("/xray", async (c) => {
  const user = await getOptionalUser(c);
  const body = await c.req.json<any>().catch(() => ({}));
  if (!Array.isArray(body?.holdings) || body.holdings.length === 0) {
    throw new HttpError(400, "請提供至少一項有效持倉進行組合透視");
  }
  const includeInternalWarnings = isAdvisorOrAdmin(user) && !Boolean(body?.client_report_mode);
  const result = await computeFullPortfolioXRay(c.env.DB, body, { includeInternalWarnings });
  return c.json(result);
});

quantRouter.post("/research-request/batch", async (c) => {
  const user = await requireQuantAccess(c);
  const body = await c.req.json<any>().catch(() => ({}));
  const slugs = Array.isArray(body?.slugs) ? body.slugs : [];
  if (slugs.length === 0) {
    throw new HttpError(400, "請提供需要加入研究隊列的基金列表");
  }
  const res = await batchEnqueueResearchRequests(c.env.DB, user, slugs, body.note);
  return c.json({ success: true, ...res });
});

// ── 11. Admin Core Pick Favorites & Structured Reason Tagging ───────────────
quantRouter.put("/funds/:slug/admin-core-pick", async (c) => {
  const admin = await requireAdmin(c);
  const rawSlug = c.req.param("slug");
  const fund = await resolveQuantFund(c.env.DB, rawSlug);
  if (!fund) {
    throw new HttpError(404, `未找到基金: ${rawSlug}`);
  }

  let body: { reasons?: unknown; note?: unknown; priority?: unknown } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const rawReasons = Array.isArray(body.reasons) ? body.reasons : [];
  const seenReasons = new Set<string>();
  const cleanReasons: string[] = [];
  for (const item of rawReasons) {
    const trimmed = String(item || "").trim().slice(0, 30);
    if (trimmed && !seenReasons.has(trimmed)) {
      seenReasons.add(trimmed);
      cleanReasons.push(trimmed);
      if (cleanReasons.length >= 8) break;
    }
  }

  const rawNote = body.note != null ? String(body.note).trim().slice(0, 200) : "";
  const cleanNote = rawNote || null;
  const parsedPriority = parseInt(String(body.priority ?? "1"), 10);
  const cleanPriority = Number.isFinite(parsedPriority) ? Math.min(3, Math.max(1, parsedPriority)) : 1;
  const nowIso = new Date().toISOString();
  const updatedBy = admin.name || admin.email || "admin";

  await c.env.DB.prepare(
    `INSERT INTO wq_admin_core_picks (
      slug, reasons_json, note, priority, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      reasons_json = excluded.reasons_json,
      note = excluded.note,
      priority = excluded.priority,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at`
  )
    .bind(
      fund.slug,
      JSON.stringify(cleanReasons),
      cleanNote,
      cleanPriority,
      updatedBy,
      nowIso,
      nowIso
    )
    .run();

  clearQuantStoreCaches();

  return c.json({
    success: true,
    slug: fund.slug,
    is_admin_core_pick: true,
    admin_core_reasons: cleanReasons,
    admin_core_note: cleanNote,
    admin_core_updated_at: nowIso,
    admin_core_updated_by: updatedBy,
  });
});

quantRouter.delete("/funds/:slug/admin-core-pick", async (c) => {
  await requireAdmin(c);
  const rawSlug = c.req.param("slug");
  const fund = await resolveQuantFund(c.env.DB, rawSlug);
  const canonicalSlug = fund?.slug || rawSlug.trim();

  await c.env.DB.prepare("DELETE FROM wq_admin_core_picks WHERE slug = ? COLLATE NOCASE")
    .bind(canonicalSlug)
    .run();

  clearQuantStoreCaches();

  return c.json({
    success: true,
    slug: canonicalSlug,
    is_admin_core_pick: false,
    admin_core_reasons: [],
    admin_core_note: null,
  });
});
