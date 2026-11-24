export interface MacroSnapshotRow {
  as_of_date: string;
  us10y_yield: number | null;
  us3m_yield: number | null;
  us5y_yield: number | null;
  yield_curve_10y_3m: number | null;
  spy_pe_est: number | null;
  spy_pe_pctile: number | null;
  spy_erp: number | null;
  hsi_pe_pctile: number | null;
  gold_price: number | null;
  gold_ma200_pct: number | null;
  wti_oil_price: number | null;
  brent_oil_price: number | null;
  oil_ret_20d: number | null;
  copper_price: number | null;
  copper_gold_ratio: number | null;
  copper_gold_trend: "RISING" | "FALLING" | "NEUTRAL";
  dbc_price: number | null;
  dxy_index: number | null;
  hyg_ief_ratio: number | null;
  regime_flags: string[];
  indicators: Record<string, any>;
  source: "d1" | "fallback";
}

export const DEFAULT_MACRO_SNAPSHOT: MacroSnapshotRow = {
  as_of_date: "baseline",
  us10y_yield: 4.35,
  us3m_yield: 4.45,
  us5y_yield: 4.2,
  yield_curve_10y_3m: -0.1,
  spy_pe_est: 25.0,
  spy_pe_pctile: 78.0,
  spy_erp: -0.35,
  hsi_pe_pctile: 22.0,
  gold_price: 2650.0,
  gold_ma200_pct: 8.5,
  wti_oil_price: 70.0,
  brent_oil_price: 74.0,
  oil_ret_20d: 1.5,
  copper_price: 4.2,
  copper_gold_ratio: 1.585,
  copper_gold_trend: "NEUTRAL",
  dbc_price: 22.5,
  dxy_index: 105.0,
  hyg_ief_ratio: 0.83,
  regime_flags: ["RATES_ELEVATED", "HK_DEEP_VALUE"],
  indicators: {},
  source: "fallback",
};

const MACRO_TTL_MS = 15 * 60 * 1000;
let macroCache: { data: MacroSnapshotRow; expiresAt: number } | null = null;

export function clearMacroStoreCache(): void {
  macroCache = null;
}

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function getLatestMacroSnapshot(db: D1Database): Promise<MacroSnapshotRow> {
  if (macroCache && macroCache.expiresAt > Date.now()) {
    return macroCache.data;
  }

  try {
    if (!db || typeof db.prepare !== "function") {
      return DEFAULT_MACRO_SNAPSHOT;
    }
    const row = await db
      .prepare("SELECT * FROM wq_macro_snapshot ORDER BY as_of_date DESC LIMIT 1")
      .first<any>();
    if (!row) {
      return DEFAULT_MACRO_SNAPSHOT;
    }

    const parsed: MacroSnapshotRow = {
      as_of_date: String(row.as_of_date || "baseline"),
      us10y_yield: row.us10y_yield != null ? Number(row.us10y_yield) : null,
      us3m_yield: row.us3m_yield != null ? Number(row.us3m_yield) : null,
      us5y_yield: row.us5y_yield != null ? Number(row.us5y_yield) : null,
      yield_curve_10y_3m: row.yield_curve_10y_3m != null ? Number(row.yield_curve_10y_3m) : null,
      spy_pe_est: row.spy_pe_est != null ? Number(row.spy_pe_est) : null,
      spy_pe_pctile: row.spy_pe_pctile != null ? Number(row.spy_pe_pctile) : null,
      spy_erp: row.spy_erp != null ? Number(row.spy_erp) : null,
      hsi_pe_pctile: row.hsi_pe_pctile != null ? Number(row.hsi_pe_pctile) : null,
      gold_price: row.gold_price != null ? Number(row.gold_price) : null,
      gold_ma200_pct: row.gold_ma200_pct != null ? Number(row.gold_ma200_pct) : null,
      wti_oil_price: row.wti_oil_price != null ? Number(row.wti_oil_price) : null,
      brent_oil_price: row.brent_oil_price != null ? Number(row.brent_oil_price) : null,
      oil_ret_20d: row.oil_ret_20d != null ? Number(row.oil_ret_20d) : null,
      copper_price: row.copper_price != null ? Number(row.copper_price) : null,
      copper_gold_ratio: row.copper_gold_ratio != null ? Number(row.copper_gold_ratio) : null,
      copper_gold_trend:
        row.copper_gold_trend === "RISING" || row.copper_gold_trend === "FALLING"
          ? row.copper_gold_trend
          : "NEUTRAL",
      dbc_price: row.dbc_price != null ? Number(row.dbc_price) : null,
      dxy_index: row.dxy_index != null ? Number(row.dxy_index) : null,
      hyg_ief_ratio: row.hyg_ief_ratio != null ? Number(row.hyg_ief_ratio) : null,
      regime_flags: safeJsonParse<string[]>(row.regime_flags_json, []),
      indicators: safeJsonParse<Record<string, any>>(row.payload_json, {}),
      source: "d1",
    };

    macroCache = { data: parsed, expiresAt: Date.now() + MACRO_TTL_MS };
    return parsed;
  } catch {
    return DEFAULT_MACRO_SNAPSHOT;
  }
}

export function formatMacroPromptBlock(snap: MacroSnapshotRow): string {
  const fmt = (v: number | null, suffix = "") => (v != null ? `${v}${suffix}` : "N/A");
  return [
    `【当前宏观利率、估值与大宗商品时钟 (观测日: ${snap.as_of_date}, 数据源: ${snap.source})】`,
    `1. **利率与收益率曲线**: 美债 10Y = ${fmt(snap.us10y_yield, "%")}，3M 短端现金利率 = ${fmt(snap.us3m_yield, "%")}，10Y-3M 利差 = ${fmt(snap.yield_curve_10y_3m, "%")}。`,
    `2. **全球权益估值与 ERP**: 标普500 估算 PE = ${fmt(snap.spy_pe_est, "x")}（近5年分位 ${fmt(snap.spy_pe_pctile, "%")}），股权风险溢价 (ERP) = ${fmt(snap.spy_erp, "%")}；恒生指数 5 年估值分位 = ${fmt(snap.hsi_pe_pctile, "%")}。`,
    `3. **黄金与通胀避险**: COMEX 黄金 = USD ${fmt(snap.gold_price)}（偏离 200 日均线 ${fmt(snap.gold_ma200_pct, "%")}）。`,
    `4. **原油、铜与商品周期**: WTI 原油 = USD ${fmt(snap.wti_oil_price)}（20日涨跌 ${fmt(snap.oil_ret_20d, "%")}），布伦特 = USD ${fmt(snap.brent_oil_price)}；COMEX 铜 = USD ${fmt(snap.copper_price)}，铜金比 = ${fmt(snap.copper_gold_ratio)}（趋势: ${snap.copper_gold_trend}），商品指数 DBC = USD ${fmt(snap.dbc_price)}。`,
    `5. **美元与信用利差**: 美元指数 DXY = ${fmt(snap.dxy_index)}，高收益债/国债比值 HYG/IEF = ${fmt(snap.hyg_ief_ratio)}。`,
    `6. **系统触发宏观信号 (Regime Flags)**: ${snap.regime_flags.length > 0 ? snap.regime_flags.join(", ") : "NEUTRAL"}`,
  ].join("\n");
}
