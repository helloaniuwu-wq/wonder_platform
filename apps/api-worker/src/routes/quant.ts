import { Hono } from "hono";
import { Env, Variables } from "../types";
import { HttpError, requireUser } from "../utils/auth";
import {
  buildBenchmarkProxySeries,
  convertSeriesCurrency,
  getQuantBenchmarkSeries,
  getQuantFundSeries,
  loadQuantCatalog,
  QuantFundCatalogRow,
  resolveQuantFund,
} from "../services/quantStore";
import { countBusinessDaysBetween } from "../services/quantWatchdog";
import { recommendForClient } from "../services/advisoryEngine";
import { callLlmChat, extractAndNormalizeTacticalJson } from "../services/llm";
import { getFundTopHoldings } from "../services/fundHoldings";
import { formatMacroPromptBlock, getLatestMacroSnapshot } from "../services/macroStore";

export const quantRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

const PREMIUM_ROLES = new Set(["premium", "advisor", "admin"]);

async function requireQuantAccess(c: any) {
  const user = await requireUser(c);
  if (!PREMIUM_ROLES.has(user.role)) {
    throw new HttpError(403, "基金量化庫僅對 Premium / 顧問 / 管理員開放");
  }
  return user;
}

function rangeToCutoffIso(rangeStr: string): string {
  const now = new Date();
  const r = (rangeStr || "3y").toLowerCase();
  const daysMap: Record<string, number> = {
    "6m": 185,
    "1y": 370,
    "3y": 365 * 3 + 5,
    "5y": 365 * 5 + 5,
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
  await requireQuantAccess(c);
  const { rows } = await loadQuantCatalog(c.env.DB);

  const q = (c.req.query("q") || "").trim().toLowerCase();
  const platformGroup = (c.req.query("platform_group") || "all").trim();
  const assetClass = (c.req.query("asset_class") || "").trim();
  const minStars = parseInt(c.req.query("min_stars") || "0", 10) || 0;
  const tier = (c.req.query("tier") || "").trim().toUpperCase();
  const grade = (c.req.query("grade") || "").trim().toUpperCase();
  const excludeNonRec = c.req.query("exclude_non_rec") === "true";
  const onlyDistributing = c.req.query("only_distributing") === "true";
  const sortKey = (c.req.query("sort") || "quant_score").trim();
  const order = (c.req.query("order") || "desc").toLowerCase() === "asc" ? 1 : -1;

  // Facets computed over full catalog
  const facets = {
    total: rows.length,
    aia: 0,
    non_ilas: 0,
    tiers: { A: 0, B: 0, C: 0, U: 0 } as Record<string, number>,
    asset_classes: {} as Record<string, number>,
  };
  for (const r of rows) {
    if ((r.ilas_platform || "").startsWith("AIA")) facets.aia++;
    else facets.non_ilas++;
    facets.tiers[r.data_tier] = (facets.tiers[r.data_tier] || 0) + 1;
    facets.asset_classes[r.asset_class] = (facets.asset_classes[r.asset_class] || 0) + 1;
  }

  let filtered = rows.filter((r) => {
    if (platformGroup === "aia" && !(r.ilas_platform || "").startsWith("AIA")) return false;
    if (platformGroup === "non_ilas" && (r.ilas_platform || "").startsWith("AIA")) return false;
    if (platformGroup === "us_intl" && !["非投连险-美股分红型ETF", "非投连险-国际股票", "非投连险-分红型基金", "非投连险-日本宽基ETF"].includes(r.ilas_platform || "")) return false;
    if (platformGroup === "cn_hk" && !["非投连险-中国分红", "非投连险-港股通ETF", "非投连险-A股价值型", "非投连险-中国QDII", "非投连险-货币基金"].includes(r.ilas_platform || "")) return false;
    if (platformGroup === "bonds" && r.ilas_platform !== "非投连险-债券基金比较" && r.asset_class !== "固定收益") return false;
    if (assetClass && assetClass !== "all" && r.asset_class !== assetClass) return false;
    if (minStars > 0 && (r.morningstar_stars || 0) < minStars) return false;
    if (tier && tier !== "ALL" && r.data_tier !== tier) return false;
    if (grade && grade !== "ALL" && r.quant_grade !== grade) return false;
    if (excludeNonRec && r.tags.includes("非推荐选择")) return false;
    if (onlyDistributing && !r.is_distributing) return false;
    if (q) {
      const hay = `${r.slug} ${r.code} ${r.aia_code || ""} ${r.isin || ""} ${r.yahoo_ticker || ""} ${r.name} ${r.manager || ""} ${r.tags.join(" ")}`.toLowerCase();
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

  return c.json({
    total_matched: filtered.length,
    facets,
    items: filtered,
  });
});

// ── 3. Single Fund Quant Profile + Twin Comparison ──────────────────────────
quantRouter.get("/funds/:slug", async (c) => {
  await requireQuantAccess(c);
  const slug = c.req.param("slug");
  const fund = await resolveQuantFund(c.env.DB, slug);
  if (!fund) throw new HttpError(404, `未找到基金: ${slug}`);

  let twin: QuantFundCatalogRow | null = null;
  if (fund.twin_code) {
    twin = await resolveQuantFund(c.env.DB, fund.twin_code);
  }
  return c.json({
    fund,
    twin,
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
      seriesByAsset[assetId] = m;
    } else {
      const proxy = await buildBenchmarkProxySeries(
        c.env.DB,
        f || { code: assetId, name: assetId },
        3650,
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
  const macroSnap = await getLatestMacroSnapshot(c.env.DB);
  const macroBlock = formatMacroPromptBlock(macroSnap);

  const holdingsSummary = Array.isArray(rec.holdings)
    ? rec.holdings
        .map(
          (h: any) =>
            `- ${h.lab_id || h.slug} (${h.name || "未命名"}): 权重 ${h.weight_pct || h.weight}%, 资产类型: ${h.asset_class || "大类标的"}, 角色逻辑: ${h.rationale_zh || h.rationale_en || "核心资产"}`
        )
        .join("\n")
    : "暂无明细";

  const metricsSummary = rec.metrics
    ? `预期3Y年化: ${rec.metrics.est_cagr_pct}%, 年化波动率: ${rec.metrics.est_vol_pct}%, 夏普比率: ${rec.metrics.est_sharpe}, 参考股息率: ${rec.metrics.est_div_yield_pct}%, 加权年费率: ${rec.metrics.weighted_fee_pct || 0}%`
    : "未提供汇总指标";

  const prompt = `请作为买方量化首席投资顾问，为以下客户及为其量身匹配的资产组合出具一份专业的投资配置分析与归因报告。

【客户基本画像与核心需求】
- 客户姓名/称呼: ${profile.client_name || "尊贵客户"}
- 年龄: ${profile.age || "未指定"} 岁
- 初始配置资金: ${profile.currency || "USD"} ${profile.initial_capital ? Number(profile.initial_capital).toLocaleString() : "500,000"}
- 投资期限: ${profile.horizon_years || 10} 年
- 主要财务目标: ${profile.primary_goal || "均衡增值"}
- 风险评级: ${profile.risk_level || "稳健"} (评分: ${profile.risk_score || 55}/100)
- 现金流提取诉求: ${profile.annual_withdrawal ? `每年提取 ${profile.currency} ${profile.annual_withdrawal}` : "无定期提取需求"}
- 期望年化股息率: ${profile.target_annual_yield_pct ? `${profile.target_annual_yield_pct}%` : "未特别设定"}
- 架构平台: ${profile.product_scope || "全市场"} ${profile.ilp_planned ? "(含 ILP 投连险架构)" : ""}
- 【重要】客户补充背景与特别诉求:
${profile.extra_notes ? profile.extra_notes : "无特别补充事项"}

【为其量身定制的资产组合方案】
方案名称: ${rec.title_zh || rec.title || "量化优选配置方案"}
组合概括: ${rec.subtitle_zh || rec.subtitle || ""}
量化指标: ${metricsSummary}
底层资产持仓明细:
${holdingsSummary}

${macroBlock}

【报告输出要求】
请使用规范清晰的 Markdown 格式输出，包含以下章节结构：
### 一、宏观利率与估值时钟研判（结合当前高息固收与权益估值分位数的配置必要性）
### 二、客户画像与个性化诉求深度响应（结合客户补充背景、税务/开支/久期精准分析）
### 三、推荐组合底层资产角色分工与攻守机制（详述短债/红利/宽基各资产的作用与互补性）
### 四、未来宏观情景推演与极端压力韧性（降息释放资本利得、通胀滞胀、权益回调下的表现预案）
### 五、量身定制的操作建议与后续跟踪要点（建仓节奏、再平衡阈值、分红再投资建议）

要求：专业严谨、数据扎实、结构清晰，不要将正文包裹在 \`\`\`markdown 代码块中。

【重要：结构化战术调仓与实验室参数指令输出】
在整份正文报告的**最末尾**，请务必紧跟一段严格合法的 JSON（用 <tactical_json> 和 </tactical_json> 标签包裹），把你的分析结论转化为可直接指导「组合权重修正」与「策略实验室模拟」的结构化指令：
1. \`adjusted_holdings\` 只能包含上述底层资产持仓明细里已有的 \`lab_id\`（严禁新增或编造外部代码），各 \`adjusted_weight_pct\` 必须为非负整数且严格相加等于 100；
2. 如果客户补充诉求中有特定年份刚性大额支出（例如3年后留学支出15万）或分阶段提领需求，请精准提取到 \`lab_directives\` 的 \`withdrawal\` / \`withdrawal_2\` 与起止年份中；
3. 格式示例如下（请替换为你的真实测算数值）：
<tactical_json>
{
  "tactical_summary_zh": "一句话高度概括本次战术偏离的核心依据与方向",
  "adjusted_holdings": [
    { "lab_id": "BIL", "adjusted_weight_pct": 35, "reason_zh": "上调理由与在组合中角色" }
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

  const llmResult = await callLlmChat(c.env, prompt, {
    modelPreference: model,
    temperature: 0.35,
    maxTokens: 8192,
  });

  const { cleanMarkdown, tacticalAdjustment } = extractAndNormalizeTacticalJson(
    llmResult.text,
    profile,
    rec
  );

  return c.json({
    analysis: cleanMarkdown,
    tactical_adjustment: tacticalAdjustment,
    model_used: llmResult.modelUsed,
    provider: llmResult.provider,
    reasoning: llmResult.reasoning || null,
    fallback_reason: llmResult.fallbackReason || null,
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
