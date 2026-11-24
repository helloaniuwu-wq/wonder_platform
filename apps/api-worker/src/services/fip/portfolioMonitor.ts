import type { Env } from "../../types";
import { generateUuid } from "../../utils/auth";
import { sendQuantAlert } from "../alerting";
import { getLatestMacroSnapshot, MacroSnapshotRow } from "../macroStore";
import { QuantFundCatalogRow, resolveQuantFund } from "../quantStore";
import { PortfolioEngine, Transaction } from "./portfolioEngine";
import { ensureMonitoringSchema } from "./monitoringSchema";

export type WrapperType = "AIA_TMP2" | "BROKER_ETF" | "HYBRID";
export type RebalanceMode = "PERIODIC" | "TOLERANCE_BAND" | "CALENDAR_BAND" | "MACRO_TRIGGER";
export type MacroSensitivity = "LOW" | "MEDIUM" | "HIGH";

export interface MonitoringConfig {
  id: string;
  portfolio_id: number;
  wrapper_type: WrapperType;
  rebalance_mode: RebalanceMode;
  drift_tolerance: number;
  max_drawdown_limit: number;
  reeval_interval_days: number;
  last_reeval_at: string | null;
  macro_sensitivity_level: MacroSensitivity;
  ips_profile: Record<string, any>;
  is_active: boolean;
}

export interface TwrMetrics {
  latestTwrNav: number;
  peakTwrNav: number;
  currentDrawdown: number; // negative or zero, e.g. -0.085 for -8.5%
  maxDrawdown: number;
}

export interface PortfolioDnaSummary {
  equity_pct: number;
  bond_pct: number;
  gold_commodity_pct: number;
  cash_pct: number;
  other_pct: number;
  us_equity_pct: number;
  hk_cn_pct: number;
  weighted_fee_pct: number | null;
  laggard_holdings: Array<{
    isin: string;
    name: string;
    quant_grade: string | null;
    peer_rank_pct: number | null;
    weight_pct: number;
    reason: string;
  }>;
}

export interface DriftedAssetItem {
  isin: string;
  name: string;
  target_pct: number;
  actual_pct: number;
  drift_pct: number; // signed difference in percentage points (actual - target)
}

export interface PortfolioHealthReport {
  portfolio_id: number;
  snapshot_date: string;
  config: MonitoringConfig;
  total_nav: number;
  base_currency: string;
  twr_nav: number;
  twr_drawdown: number;
  twr_max_drawdown: number;
  max_asset_drift: number;
  drifted_assets: DriftedAssetItem[];
  macro_risk_flags: string[];
  dna: PortfolioDnaSummary;
  health_score: number;
  action_required: boolean;
  macro_snapshot: MacroSnapshotRow;
}

/**
 * Compute Time-Weighted Return (TWR) unit NAV & drawdown series,
 * stripping external CASH_IN / CASH_OUT cash flows so capital inflows/outflows
 * never trigger false drawdown alarms.
 */
export function computeTwrSeries(
  transactions: Array<Pick<Transaction, "date" | "isin" | "type" | "shares" | "price">>,
  histChart: Array<{ date: string; value: number }>
): TwrMetrics {
  if (!histChart || histChart.length === 0) {
    return { latestTwrNav: 100, peakTwrNav: 100, currentDrawdown: 0, maxDrawdown: 0 };
  }

  const netFlowsByDate: Record<string, number> = {};
  for (const tx of transactions || []) {
    const t = String(tx.type || "").toUpperCase();
    if (t !== "CASH_IN" && t !== "CASH_OUT") continue;
    const d = String(tx.date || "").slice(0, 10);
    if (!d) continue;
    const shares = Number(tx.shares || 0);
    const price = Number(tx.price || 0);
    const amt = shares > 1 && Math.abs(price) === 1 ? shares * price : price;
    netFlowsByDate[d] = (netFlowsByDate[d] || 0) + amt;
  }

  // Group flows between chart points so flows occurring on non-chart dates are attributed to the next point
  const sortedFlowDates = Object.keys(netFlowsByDate).sort();
  let flowCursor = 0;
  // Consume any flows up to and including the initial chart date
  const firstDate = histChart[0].date;
  while (flowCursor < sortedFlowDates.length && sortedFlowDates[flowCursor] <= firstDate) {
    flowCursor++;
  }

  let twrNav = 100.0;
  let peakTwrNav = 100.0;
  let maxDrawdown = 0.0;
  let prevVal = Number(histChart[0].value || 0);

  for (let i = 1; i < histChart.length; i++) {
    const pt = histChart[i];
    const currVal = Number(pt.value || 0);
    let intervalFlow = 0;
    while (flowCursor < sortedFlowDates.length && sortedFlowDates[flowCursor] <= pt.date) {
      intervalFlow += netFlowsByDate[sortedFlowDates[flowCursor]];
      flowCursor++;
    }

    if (prevVal > 0 && currVal > 0) {
      // Mid-period cash flow adjustment: Modified Dietz / start-of-day cashflow guard
      const rawRet = (currVal - intervalFlow) / prevVal - 1;
      // Guard pathological first-day funding or tiny denominator spikes
      const boundedRet = Math.abs(intervalFlow) > prevVal * 0.9 && rawRet < -0.5 ? 0 : Math.max(-0.6, Math.min(1.0, rawRet));
      twrNav = twrNav * (1 + boundedRet);
      if (twrNav > peakTwrNav) peakTwrNav = twrNav;
      if (peakTwrNav > 0) {
        const dd = (twrNav - peakTwrNav) / peakTwrNav;
        if (dd < maxDrawdown) maxDrawdown = dd;
      }
    }
    if (currVal > 0) prevVal = currVal;
  }

  const currentDrawdown = peakTwrNav > 0 ? (twrNav - peakTwrNav) / peakTwrNav : 0;
  return {
    latestTwrNav: Math.round(twrNav * 1000) / 1000,
    peakTwrNav: Math.round(peakTwrNav * 1000) / 1000,
    currentDrawdown: Math.round(currentDrawdown * 10000) / 10000,
    maxDrawdown: Math.round(maxDrawdown * 10000) / 10000,
  };
}

function classifyHoldingSleeve(
  isin: string,
  name: string,
  sector: string,
  qFund: QuantFundCatalogRow | null
): { sleeve: "equity" | "bond" | "gold_commodity" | "cash" | "other"; isUs: boolean; isHkCn: boolean } {
  const up = isin.toUpperCase();
  const hay = `${up} ${name} ${sector} ${qFund?.asset_class || ""} ${qFund?.ilas_platform || ""}`.toUpperCase();

  if (up.startsWith("CASH_") || ["BIL", "SGOV", "SHV"].includes(up) || hay.includes("货币") || hay.includes("MONEY MARKET")) {
    return { sleeve: "cash", isUs: false, isHkCn: false };
  }
  if (
    ["GLD", "IAU", "GC=F", "DBC", "GSG", "GDX", "SLV", "CL=F", "HG=F"].includes(up) ||
    hay.includes("GOLD") ||
    hay.includes("黄金") ||
    hay.includes("COMMODIT") ||
    hay.includes("大宗商品") ||
    hay.includes("NATURAL RESOURCE") ||
    hay.includes("MINING")
  ) {
    return { sleeve: "gold_commodity", isUs: false, isHkCn: false };
  }
  if (
    ["TLT", "IEF", "SHY", "AGG", "BND", "HYG", "JNK", "LQD", "EMB"].includes(up) ||
    hay.includes("BOND") ||
    hay.includes("FIXED INCOME") ||
    hay.includes("固定收益") ||
    hay.includes("债券") ||
    hay.includes("TREASURY") ||
    hay.includes("CREDIT")
  ) {
    return { sleeve: "bond", isUs: false, isHkCn: false };
  }
  if (hay.includes("MULTI") || hay.includes("BALANCED") || hay.includes("多元") || hay.includes("平衡")) {
    return { sleeve: "other", isUs: false, isHkCn: false };
  }

  const isHkCn =
    up.endsWith(".HK") ||
    up.endsWith(".SS") ||
    up.endsWith(".SZ") ||
    hay.includes("CHINA") ||
    hay.includes("HONG KONG") ||
    hay.includes("中国") ||
    hay.includes("香港") ||
    hay.includes("港股");
  const isUs =
    !isHkCn &&
    (["SPY", "VOO", "VTI", "QQQ", "VYM", "SCHD", "JEPI", "JEPQ", "BRK-B"].includes(up) ||
      hay.includes("US ") ||
      hay.includes("U.S.") ||
      hay.includes("AMERICAN") ||
      hay.includes("美国") ||
      hay.includes("北美") ||
      hay.includes("GLOBAL") ||
      hay.includes("全球"));

  return { sleeve: "equity", isUs, isHkCn };
}

export async function buildPortfolioDna(
  db: D1Database,
  details: Array<{ isin: string; name: string; sector: string; market_value: number; weight?: number }>,
  totalNav: number
): Promise<{ dna: PortfolioDnaSummary; inferredWrapper: WrapperType }> {
  let equity = 0;
  let bond = 0;
  let goldCommodity = 0;
  let cash = 0;
  let other = 0;
  let usEquity = 0;
  let hkCn = 0;
  let feeSum = 0;
  let feeCov = 0;
  let aiaHits = 0;
  let etfHits = 0;
  const laggards: PortfolioDnaSummary["laggard_holdings"] = [];

  for (const h of details) {
    const mv = Number(h.market_value || 0);
    const wPct = totalNav > 0 ? (mv / totalNav) * 100 : Number(h.weight || 0);
    let qFund: QuantFundCatalogRow | null = null;
    try {
      if (db && typeof db.prepare === "function" && !h.isin.startsWith("CASH_")) {
        qFund = await resolveQuantFund(db, h.isin);
      }
    } catch {
      // ignore
    }

    if (qFund) {
      if ((qFund.ilas_platform || "").startsWith("AIA")) aiaHits++;
      else etfHits++;
      if (typeof qFund.fee_pct === "number" && qFund.fee_pct >= 0) {
        feeSum += (wPct / 100) * qFund.fee_pct;
        feeCov += wPct / 100;
      }
      const isNonRec = (qFund.tags || []).includes("非推荐选择");
      if (qFund.quant_grade === "D" || (qFund.peer_rank_pct != null && qFund.peer_rank_pct >= 75) || isNonRec) {
        laggards.push({
          isin: h.isin,
          name: qFund.name || h.name || h.isin,
          quant_grade: qFund.quant_grade,
          peer_rank_pct: qFund.peer_rank_pct,
          weight_pct: Math.round(wPct * 10) / 10,
          reason: isNonRec
            ? "量化库标记为非推荐选择"
            : qFund.quant_grade === "D"
            ? "量化综合评级降至 D 级"
            : `同类绩效排名后 ${Math.round(100 - (qFund.peer_rank_pct || 75))}%`,
        });
      }
    } else if (!h.isin.startsWith("CASH_")) {
      etfHits++;
    }

    const cls = classifyHoldingSleeve(h.isin, h.name || "", String(h.sector || ""), qFund);
    if (cls.sleeve === "equity") equity += wPct;
    else if (cls.sleeve === "bond") bond += wPct;
    else if (cls.sleeve === "gold_commodity") goldCommodity += wPct;
    else if (cls.sleeve === "cash") cash += wPct;
    else other += wPct;

    if (cls.isUs) usEquity += wPct;
    if (cls.isHkCn) hkCn += wPct;
  }

  const inferredWrapper: WrapperType = aiaHits > 0 && etfHits === 0 ? "AIA_TMP2" : aiaHits > 0 && etfHits > 0 ? "HYBRID" : "BROKER_ETF";
  return {
    dna: {
      equity_pct: Math.round(equity * 10) / 10,
      bond_pct: Math.round(bond * 10) / 10,
      gold_commodity_pct: Math.round(goldCommodity * 10) / 10,
      cash_pct: Math.round(cash * 10) / 10,
      other_pct: Math.round(other * 10) / 10,
      us_equity_pct: Math.round(usEquity * 10) / 10,
      hk_cn_pct: Math.round(hkCn * 10) / 10,
      weighted_fee_pct: feeCov > 0.25 ? Math.round((feeSum / feeCov) * 100) / 100 : null,
      laggard_holdings: laggards,
    },
    inferredWrapper,
  };
}

export async function getOrDefaultMonitoringConfig(
  db: D1Database,
  portfolioId: number,
  inferredWrapper: WrapperType = "AIA_TMP2"
): Promise<MonitoringConfig> {
  try {
    const row = await db
      .prepare("SELECT * FROM portfolio_monitoring_config WHERE portfolio_id = ?")
      .bind(portfolioId)
      .first<any>();
    if (row) {
      let ips: Record<string, any> = {};
      try {
        ips = JSON.parse(row.ips_profile_json || "{}");
      } catch {
        // ignore
      }
      return {
        id: row.id,
        portfolio_id: Number(row.portfolio_id),
        wrapper_type: row.wrapper_type || inferredWrapper,
        rebalance_mode: row.rebalance_mode || "CALENDAR_BAND",
        drift_tolerance: Number(row.drift_tolerance ?? 0.05),
        max_drawdown_limit: Number(row.max_drawdown_limit ?? 0.15),
        reeval_interval_days: Number(row.reeval_interval_days ?? 90),
        last_reeval_at: row.last_reeval_at || null,
        macro_sensitivity_level: row.macro_sensitivity_level || "MEDIUM",
        ips_profile: ips,
        is_active: Boolean(row.is_active ?? 1),
      };
    }
  } catch {
    // ignore if table not migrated yet
  }

  return {
    id: `default_${portfolioId}`,
    portfolio_id: portfolioId,
    wrapper_type: inferredWrapper,
    rebalance_mode: "CALENDAR_BAND",
    drift_tolerance: 0.05,
    max_drawdown_limit: 0.15,
    reeval_interval_days: 90,
    last_reeval_at: null,
    macro_sensitivity_level: "MEDIUM",
    ips_profile: {},
    is_active: true,
  };
}

export async function evaluatePortfolioHealth(
  db: D1Database,
  portfolioId: number,
  options?: { persist?: boolean; snapshotDate?: string }
): Promise<PortfolioHealthReport> {
  await ensureMonitoringSchema(db);
  const engine = new PortfolioEngine(db, portfolioId);
  await engine.init();

  const navData = await engine.calculateNav();
  let histChart: Array<{ date: string; value: number }> = [];
  try {
    const cacheRow = await db
      .prepare("SELECT historical_chart FROM portfolio_stats_cache WHERE portfolio_id = ?")
      .bind(portfolioId)
      .first<{ historical_chart: string | null }>();
    if (cacheRow?.historical_chart) {
      const parsed = JSON.parse(cacheRow.historical_chart);
      if (Array.isArray(parsed) && parsed.length >= 2) histChart = parsed;
    }
  } catch {
    // ignore
  }
  if (histChart.length < 2) {
    try {
      histChart = await engine.getHistoricalChartData();
    } catch {
      histChart = [];
    }
  }

  const twr = computeTwrSeries(engine.transactions, histChart);
  const { dna, inferredWrapper } = await buildPortfolioDna(db, navData.details, navData.total_nav);
  const config = await getOrDefaultMonitoringConfig(db, portfolioId, inferredWrapper);
  const macro = await getLatestMacroSnapshot(db);
  const snapshotDate = options?.snapshotDate || new Date().toISOString().slice(0, 10);

  // Compute asset drifts against target_allocations
  const targets = engine.meta.target_allocations || {};
  const detailsByIsin = new Map(navData.details.map((d) => [d.isin, d]));
  const allIsins = new Set<string>([
    ...Object.keys(targets),
    ...navData.details.filter((d) => !d.isin.startsWith("CASH_") && d.market_value > 0).map((d) => d.isin),
  ]);

  let maxDrift = 0;
  const driftedAssets: DriftedAssetItem[] = [];
  const tolPct = config.drift_tolerance * 100;

  for (const isin of allIsins) {
    const rawT = Number(targets[isin] || 0);
    const targetPct = rawT <= 1 ? rawT * 100 : rawT;
    const d = detailsByIsin.get(isin);
    const actualPct = d && navData.total_nav > 0 ? (d.market_value / navData.total_nav) * 100 : 0;
    const driftPct = Math.round((actualPct - targetPct) * 10) / 10;
    const absDrift = Math.abs(driftPct) / 100;
    if (absDrift > maxDrift) maxDrift = absDrift;
    if (Math.abs(driftPct) >= tolPct - 0.05 && Object.keys(targets).length > 0) {
      driftedAssets.push({
        isin,
        name: d?.name || isin,
        target_pct: Math.round(targetPct * 10) / 10,
        actual_pct: Math.round(actualPct * 10) / 10,
        drift_pct: driftPct,
      });
    }
  }
  driftedAssets.sort((a, b) => Math.abs(b.drift_pct) - Math.abs(a.drift_pct));

  // Cross-check portfolio exposure with live macro & commodity risk flags
  const portfolioMacroFlags: string[] = [];
  if (macro.regime_flags.includes("US_VALUATION_ELEVATED") && dna.us_equity_pct >= 40) {
    portfolioMacroFlags.push("US_VALUATION_EXPOSURE_HIGH");
  }
  if (macro.regime_flags.includes("OIL_INFLATION_SHOCK") && dna.bond_pct >= 35 && dna.gold_commodity_pct < 5) {
    portfolioMacroFlags.push("INFLATION_UNHEDGED_DURATION");
  }
  if (macro.regime_flags.includes("GOLD_BREAKOUT") && dna.gold_commodity_pct < 2) {
    portfolioMacroFlags.push("GOLD_HEDGE_MISSING");
  }
  if (macro.regime_flags.includes("COPPER_GOLD_RISK_OFF") && dna.equity_pct >= 65) {
    portfolioMacroFlags.push("CYCLICAL_SLOWDOWN_RISK");
  }
  if (macro.regime_flags.includes("CREDIT_STRESS") && dna.bond_pct >= 25) {
    portfolioMacroFlags.push("CREDIT_SPREAD_WATCH");
  }
  if (dna.laggard_holdings.length > 0) {
    portfolioMacroFlags.push("LAGGARD_FUND_DETECTED");
  }
  if (Math.abs(twr.currentDrawdown) >= config.max_drawdown_limit) {
    portfolioMacroFlags.push("MAX_DRAWDOWN_BREACH");
  }
  if (config.last_reeval_at) {
    const daysSince = (Date.now() - Date.parse(config.last_reeval_at)) / 86400_000;
    if (Number.isFinite(daysSince) && daysSince >= config.reeval_interval_days) {
      portfolioMacroFlags.push("REEVAL_PERIODIC_DUE");
    }
  }

  // Health score (0-100)
  let score = 100;
  if (driftedAssets.length > 0) {
    score -= Math.min(25, Math.round(maxDrift * 200));
  }
  if (Math.abs(twr.currentDrawdown) > config.max_drawdown_limit * 0.7) {
    score -= Math.min(30, Math.round((Math.abs(twr.currentDrawdown) / Math.max(0.05, config.max_drawdown_limit)) * 20));
  }
  score -= Math.min(20, dna.laggard_holdings.length * 10);
  const sensWeight = config.macro_sensitivity_level === "HIGH" ? 8 : config.macro_sensitivity_level === "MEDIUM" ? 5 : 2;
  score -= Math.min(20, portfolioMacroFlags.filter((f) => !["LAGGARD_FUND_DETECTED", "MAX_DRAWDOWN_BREACH"].includes(f)).length * sensWeight);
  score = Math.max(0, Math.min(100, score));

  const actionRequired =
    driftedAssets.length > 0 ||
    Math.abs(twr.currentDrawdown) >= config.max_drawdown_limit ||
    dna.laggard_holdings.length > 0 ||
    (config.macro_sensitivity_level !== "LOW" && portfolioMacroFlags.length >= 2) ||
    score < 75;

  if (options?.persist !== false) {
    try {
      await db
        .prepare(
          `INSERT INTO portfolio_health_logs (
            id, portfolio_id, snapshot_date, twr_nav, twr_drawdown, max_asset_drift,
            drifted_assets_json, macro_risk_flags_json, dna_summary_json, health_score, action_required
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(portfolio_id, snapshot_date) DO UPDATE SET
            twr_nav = excluded.twr_nav,
            twr_drawdown = excluded.twr_drawdown,
            max_asset_drift = excluded.max_asset_drift,
            drifted_assets_json = excluded.drifted_assets_json,
            macro_risk_flags_json = excluded.macro_risk_flags_json,
            dna_summary_json = excluded.dna_summary_json,
            health_score = excluded.health_score,
            action_required = excluded.action_required`
        )
        .bind(
          generateUuid(),
          portfolioId,
          snapshotDate,
          twr.latestTwrNav,
          twr.currentDrawdown,
          Math.round(maxDrift * 10000) / 10000,
          JSON.stringify(driftedAssets),
          JSON.stringify(portfolioMacroFlags),
          JSON.stringify(dna),
          score,
          actionRequired ? 1 : 0
        )
        .run();
    } catch {
      // ignore if migration 0008 hasn't been applied
    }
  }

  return {
    portfolio_id: portfolioId,
    snapshot_date: snapshotDate,
    config,
    total_nav: navData.total_nav,
    base_currency: engine.meta.base_currency || "USD",
    twr_nav: twr.latestTwrNav,
    twr_drawdown: twr.currentDrawdown,
    twr_max_drawdown: twr.maxDrawdown,
    max_asset_drift: Math.round(maxDrift * 10000) / 10000,
    drifted_assets: driftedAssets,
    macro_risk_flags: portfolioMacroFlags,
    dna,
    health_score: score,
    action_required: actionRequired,
    macro_snapshot: macro,
  };
}

/**
 * Daily Cron portfolio monitor: idempotently evaluates portfolios that haven't been checked today.
 */
export async function runDailyPortfolioMonitor(env: Env, limit = 8): Promise<{ checked: number; alerts: number }> {
  const todayStr = new Date().toISOString().slice(0, 10);
  try {
    const { results } = await env.DB.prepare(
      `SELECT p.id, p.name FROM portfolios p
       LEFT JOIN portfolio_monitoring_config mc ON mc.portfolio_id = p.id
       LEFT JOIN portfolio_health_logs hl ON hl.portfolio_id = p.id AND hl.snapshot_date = ?
       WHERE COALESCE(mc.is_active, 1) = 1 AND hl.id IS NULL
       ORDER BY p.id ASC
       LIMIT ?`
    )
      .bind(todayStr, limit)
      .all<{ id: number; name: string }>();

    const rows = results || [];
    const flagged: string[] = [];
    let checked = 0;

    for (const row of rows) {
      try {
        const rep = await evaluatePortfolioHealth(env.DB, Number(row.id), { persist: true, snapshotDate: todayStr });
        checked++;
        if (rep.action_required) {
          flagged.push(
            `#${row.id} ${row.name}: Score=${rep.health_score}, Drift=${(rep.max_asset_drift * 100).toFixed(1)}%, TWR_DD=${(rep.twr_drawdown * 100).toFixed(1)}% [${rep.macro_risk_flags.join(",")}]`
          );
        }
      } catch (e) {
        console.warn(`[monitor-cron] portfolio ${row.id} failed:`, e);
      }
    }

    if (flagged.length > 0) {
      await sendQuantAlert(env, `FIS 組合每日健康預警 (${flagged.length} 個組合需關注)`, flagged.slice(0, 12), "WARN");
    }
    return { checked, alerts: flagged.length };
  } catch {
    return { checked: 0, alerts: 0 };
  }
}
