import {
  buildBenchmarkProxySeries,
  clearQuantStoreCaches,
  convertSeriesCurrency,
  getQuantFundSeries,
  loadQuantCatalog,
  QuantFundCatalogRow,
  resolveQuantFund,
} from "./quantStore";
import { getAssetMetadata, getHistoricalSeries, guessCurrencyFromIsin } from "./fip/dataProvider";

export interface XRayHoldingInput {
  isin: string;
  name?: string;
  weight: number;
  market_value?: number;
  asset_type?: "fund" | "stock" | "bond" | "cash" | "auto";
  sector?: string | Record<string, number>;
  country?: string | Record<string, number>;
  currency?: string;
  duration?: number;
  ytm?: number;
  credit_rating?: string;
  pe?: number;
  pb?: number;
  dividend_yield?: number;
  fee_pct?: number;
}

export interface PortfolioXRayRequest {
  holdings: XRayHoldingInput[];
  currency?: string;
  total_nav?: number;
  tax_rate?: number;
  ilp_annual_drag_pct?: number;
  include_stress?: boolean;
  rf_rate_pct?: number;
}

export const XRAY_STRESS_WINDOWS = [
  { id: "china_2015_crash", label: "2015 新兴市场/A股去杠杆巨震", label_en: "2015 China/EM Deleveraging Shock", start: "2015-06-12", end: "2015-09-30" },
  { id: "fed_qt_2018_q4", label: "2018 Q4 美联储缩表与贸易摩擦回撤", label_en: "2018 Q4 Fed QT & Trade Shock", start: "2018-09-20", end: "2018-12-24" },
  { id: "covid_2020_crash", label: "2020.03 新冠疫情全球流动性熔断", label_en: "2020 COVID-19 Liquidity Crash", start: "2020-02-19", end: "2020-03-23" },
  { id: "rate_hike_2022", label: "2022 全球激进加息股债双杀", label_en: "2022 Global Rate Hike Shock", start: "2022-01-03", end: "2022-10-21" },
  { id: "q3_2023_yield_spike", label: "2023 下半年美债长端利率飙升", label_en: "2023 H2 Long-Bond Yield Spike", start: "2023-07-31", end: "2023-10-27" },
  { id: "aug_2024_carry_unwind", label: "2024.08 日元套息平仓闪崩", label_en: "Aug 2024 Yen Carry Unwind", start: "2024-07-16", end: "2024-08-09" },
  { id: "tariff_2025_drawdown", label: "2025 关税与政策冲击波动窗", label_en: "2025 Tariff Volatility Window", start: "2025-02-19", end: "2025-04-15" },
];

const GICS_SECTOR_LABELS: Record<string, string> = {
  information_technology: "信息技术",
  financials: "金融",
  health_care: "医疗健康",
  consumer_discretionary: "可选消费",
  consumer_staples: "必选消费",
  industrials: "工业",
  energy: "能源",
  utilities: "公用事业",
  communication_services: "通信服务",
  materials: "原材料",
  real_estate: "房地产",
  government_other: "主权/其他固收",
};

const REGION_LABELS: Record<string, string> = {
  north_america: "北美",
  europe: "欧洲",
  greater_china: "大中华",
  developed_asia_other: "亚太发达/其他",
  emerging_markets: "新兴市场",
  global_other: "全球/未分类",
};

const RATING_KEYS = ["aaa", "aa", "a", "bbb", "bb", "b", "below_b", "other"] as const;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function normalizeHoldingKey(symbol?: string | null, name?: string | null): string {
  const raw = (symbol && symbol.trim().length >= 2 && symbol.trim().toLowerCase() !== "null" ? symbol : name || "")
    .toLowerCase()
    .replace(/\.(us|hk|ss|sz|l|pa|de|to)$/i, "")
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "");
  return raw.slice(0, 28);
}

function normalizeSectorKey(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (/tech|it|software|semiconductor|信息|科技|软件|芯片/.test(s)) return "information_technology";
  if (/financ|bank|insur|金融|银行|保险|券商/.test(s)) return "financials";
  if (/health|pharma|bio|med|医疗|医药|健康/.test(s)) return "health_care";
  if (/discretionary|cyclical|auto|retail|可选|非必需|汽车|家电/.test(s)) return "consumer_discretionary";
  if (/staple|defensive|food|beverage|必选|消费品|食品/.test(s)) return "consumer_staples";
  if (/industr|aerospace|machinery|transport|工业|制造|运输/.test(s)) return "industrials";
  if (/energy|oil|gas|petro|能源|石油|煤炭/.test(s)) return "energy";
  if (/utilit|power|electric|water|公用|电力|水务/.test(s)) return "utilities";
  if (/comm|telecom|media|互联网|通信|传媒/.test(s)) return "communication_services";
  if (/material|chem|mining|metal|材料|化工|有色|矿/.test(s)) return "materials";
  if (/real\s*estate|reit|property|地产|房产/.test(s)) return "real_estate";
  return "government_other";
}

function normalizeRegionKey(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (/north\s*america|united\s*states|usa|\bus\b|canada|北美|美国|加拿大/.test(s)) return "north_america";
  if (/europe|uk|united\s*kingdom|germany|france|swiss|euro|欧洲|英国|德国|法国|瑞士/.test(s)) return "europe";
  if (/china|hong\s*kong|taiwan|greater_china|cn|hk|中国|香港|台湾|大中华|沪深/.test(s)) return "greater_china";
  if (/japan|asia\s*dev|australia|singapore|korea|apac|日本|新加坡|澳洲|亚太发达/.test(s)) return "developed_asia_other";
  if (/emerging|\bem\b|india|brazil|latam|新兴/.test(s)) return "emerging_markets";
  return "global_other";
}

function normalizeAssetBucket(rawClass = "", isin = "", xraySplit?: any): "equity" | "bond" | "cash" | "other" {
  if (isin.toUpperCase().startsWith("CASH_")) return "cash";
  if (xraySplit && typeof xraySplit === "object") {
    const eq = Number(xraySplit.equity || 0);
    const bd = Number(xraySplit.bond || 0);
    const ca = Number(xraySplit.cash || 0);
    if (bd > eq && bd > ca) return "bond";
    if (eq > bd && eq > ca) return "equity";
    if (ca >= eq && ca >= bd && ca > 0) return "cash";
  }
  const s = String(rawClass).toLowerCase();
  if (/cash|money|货币/.test(s)) return "cash";
  if (/bond|fixed|income|debt|treasury|govt|corp|债|固收/.test(s)) return "bond";
  if (/equity|stock|股票|股息|高息/.test(s)) return "equity";
  return "other";
}

function normalizeRatingBucket(raw?: string | null): typeof RATING_KEYS[number] {
  const s = String(raw || "").trim().toUpperCase();
  if (!s) return "other";
  if (s.includes("AAA") || s.includes("GOVT") || s.includes("US_GOVERNMENT")) return "aaa";
  if (s.startsWith("AA")) return "aa";
  if (s.startsWith("A")) return "a";
  if (s.startsWith("BBB")) return "bbb";
  if (s.startsWith("BB")) return "bb";
  if (s.startsWith("B")) return "b";
  if (/^(CCC|CC|C|D|BELOW)/.test(s)) return "below_b";
  return "other";
}

function mapBondStyleSensitivity(duration: number): "limited" | "moderate" | "extensive" {
  if (duration < 3.5) return "limited";
  if (duration <= 6.5) return "moderate";
  return "extensive";
}

function mapBondStyleCredit(avgRating?: string | null, creditQuality?: string | null): "high" | "medium" | "low" {
  const q = String(creditQuality || "").toLowerCase();
  if (q === "high" || q === "medium" || q === "low") return q;
  const b = normalizeRatingBucket(avgRating);
  if (b === "aaa" || b === "aa" || b === "a") return "high";
  if (b === "bbb") return "medium";
  if (b === "bb" || b === "b" || b === "below_b") return "low";
  return "medium";
}

export function classifyHoldingInstrument(
  h: XRayHoldingInput,
  cat: QuantFundCatalogRow | null
): "fund" | "direct_stock" | "direct_bond" | "cash" {
  const codeUp = String(h.isin || "").trim().toUpperCase();
  if (h.asset_type === "cash" || codeUp.startsWith("CASH_")) return "cash";
  if (cat) return "fund";
  if (h.asset_type === "fund") return "fund";
  if (h.asset_type === "bond") return "direct_bond";
  if (h.asset_type === "stock") return "direct_stock";

  const nameAndCode = `${codeUp} ${String(h.name || "")} ${typeof h.sector === "string" ? h.sector : ""}`;
  if (
    h.duration != null ||
    h.ytm != null ||
    h.credit_rating != null ||
    /(^BOND_|TREASURY|T-BILL|GOVT|CORP\s*BOND|FIXED\s*INCOME|国债|企业债|公司债|债券)/i.test(nameAndCode)
  ) {
    return "direct_bond";
  }
  return "direct_stock";
}

function parseDistributionMap(
  raw: string | Record<string, number> | undefined,
  normalizer: (k: string) => string
): Record<string, number> | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    const clean = raw.trim();
    if (!clean || /unknown|未知/i.test(clean)) return null;
    return { [normalizer(clean)]: 100 };
  }
  if (typeof raw === "object") {
    const out: Record<string, number> = {};
    let sum = 0;
    for (const [k, v] of Object.entries(raw)) {
      const num = Number(v);
      if (!Number.isFinite(num) || num <= 0) continue;
      const nk = normalizer(k);
      out[nk] = (out[nk] || 0) + num;
      sum += num;
    }
    if (sum <= 0) return null;
    // Normalize if provided as ratios (<=1.01) instead of percentages
    if (sum <= 1.05) {
      for (const k of Object.keys(out)) out[k] = out[k] * 100;
    }
    return out;
  }
  return null;
}

export function computeStressReplay(
  normWeights: Record<string, number>,
  seriesByAsset: Record<string, Record<string, number>>
) {
  const entries = Object.entries(normWeights).filter(([, w]) => w > 0);
  return XRAY_STRESS_WINDOWS.map((win) => {
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
      new Set(covered.flatMap(([id]) => Object.keys(seriesByAsset[id]).filter((d) => d >= win.start && d <= win.end)))
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
      coverage_weight: round1(covW * 100),
      total_return_pct: round2(lastVal - 100),
      max_drawdown_pct: round2(maxDd * 100),
    };
  });
}

export function computeCovarianceAnalytics(
  items: Array<{ code: string; name: string; weight: number; series?: Record<string, number> }>
) {
  const eligible = items.filter((it) => it.weight > 0 && it.series && Object.keys(it.series).length >= 30);
  if (eligible.length === 0) {
    return {
      coverage_pct: 0,
      obs_days: 0,
      true_portfolio_vol_pct: null,
      linear_weighted_vol_pct: null,
      diversification_benefit_pct: null,
      diversification_ratio: null,
      true_max_dd_pct: null,
      correlation_matrix: { labels: [], codes: [], matrix: [] },
      high_corr_pairs: [],
      risk_contributions: [],
    };
  }

  const covWeight = eligible.reduce((s, x) => s + x.weight, 0);
  const wNorm = eligible.map((x) => x.weight / covWeight);

  // Align common sorted dates across eligible instruments (fall back to pairwise if intersection is small)
  const dateSets = eligible.map((x) => new Set(Object.keys(x.series!)));
  const firstDates = Object.keys(eligible[0].series!).sort();
  let commonDates = firstDates.filter((d) => dateSets.every((s) => s.has(d)));
  if (commonDates.length > 760) {
    commonDates = commonDates.slice(-760);
  }

  if (commonDates.length < 30) {
    return {
      coverage_pct: round1(covWeight * 100),
      obs_days: commonDates.length,
      true_portfolio_vol_pct: null,
      linear_weighted_vol_pct: null,
      diversification_benefit_pct: null,
      diversification_ratio: null,
      true_max_dd_pct: null,
      correlation_matrix: { labels: [], codes: [], matrix: [] },
      high_corr_pairs: [],
      risk_contributions: [],
    };
  }

  const n = eligible.length;
  const m = commonDates.length - 1;
  const returns: number[][] = eligible.map((it) => {
    const arr: number[] = [];
    for (let t = 1; t < commonDates.length; t++) {
      const p0 = it.series![commonDates[t - 1]];
      const p1 = it.series![commonDates[t]];
      arr.push(p0 > 0 && p1 > 0 ? p1 / p0 - 1 : 0);
    }
    return arr;
  });

  const means = returns.map((r) => r.reduce((s, v) => s + v, 0) / m);
  const cov: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  const vols: number[] = Array(n).fill(0);

  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let sum = 0;
      for (let t = 0; t < m; t++) {
        sum += (returns[i][t] - means[i]) * (returns[j][t] - means[j]);
      }
      const c = (sum / Math.max(1, m - 1)) * 252;
      cov[i][j] = c;
      cov[j][i] = c;
    }
    vols[i] = Math.sqrt(Math.max(0, cov[i][i]));
  }

  const corrMatrix: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (__, j) => {
      if (i === j) return 1;
      const denom = vols[i] * vols[j];
      if (denom <= 1e-12) return 0;
      return round2(Math.max(-1, Math.min(1, cov[i][j] / denom)));
    })
  );

  // Portfolio variance w^T * Sigma * w
  const sigmaW: number[] = Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let j = 0; j < n; j++) acc += cov[i][j] * wNorm[j];
    sigmaW[i] = acc;
  }
  const portVar = wNorm.reduce((s, wi, i) => s + wi * sigmaW[i], 0);
  const portVol = Math.sqrt(Math.max(0, portVar));
  const linearVol = wNorm.reduce((s, wi, i) => s + wi * vols[i], 0);
  const divRatio = portVol > 1e-9 ? linearVol / portVol : 1;
  const divBenefitPct = linearVol > 1e-9 ? ((linearVol - portVol) / linearVol) * 100 : 0;

  // True daily portfolio cumulative drawdown over aligned window
  let nav = 100;
  let peak = 100;
  let maxDd = 0;
  for (let t = 0; t < m; t++) {
    let dayRet = 0;
    for (let i = 0; i < n; i++) dayRet += wNorm[i] * returns[i][t];
    nav *= 1 + dayRet;
    if (nav > peak) peak = nav;
    const dd = peak > 0 ? (nav - peak) / peak : 0;
    if (dd < maxDd) maxDd = dd;
  }

  const highCorrPairs: Array<{ left: string; right: string; corr: number }> = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (corrMatrix[i][j] >= 0.85) {
        highCorrPairs.push({
          left: eligible[i].code,
          right: eligible[j].code,
          corr: corrMatrix[i][j],
        });
      }
    }
  }
  highCorrPairs.sort((a, b) => b.corr - a.corr);

  const riskContributions = eligible
    .map((it, i) => ({
      code: it.code,
      name: it.name,
      weight_pct: round1(wNorm[i] * 100),
      risk_contrib_pct: portVar > 1e-12 ? round1(((wNorm[i] * sigmaW[i]) / portVar) * 100) : round1(wNorm[i] * 100),
    }))
    .sort((a, b) => b.risk_contrib_pct - a.risk_contrib_pct);

  return {
    coverage_pct: round1(covWeight * 100),
    obs_days: commonDates.length,
    true_portfolio_vol_pct: round2(portVol * 100),
    linear_weighted_vol_pct: round2(linearVol * 100),
    diversification_benefit_pct: round1(divBenefitPct),
    diversification_ratio: round2(divRatio),
    true_max_dd_pct: round2(maxDd * 100),
    correlation_matrix: {
      labels: eligible.map((e) => e.name),
      codes: eligible.map((e) => e.code),
      matrix: corrMatrix,
    },
    high_corr_pairs: highCorrPairs.slice(0, 6),
    risk_contributions: riskContributions,
  };
}

export async function computeFullPortfolioXRay(
  db: D1Database,
  req: PortfolioXRayRequest
) {
  const validInputs = (req.holdings || []).filter((h) => h && Number(h.weight) > 0 && h.isin);
  const totalWeight = validInputs.reduce((s, h) => s + Number(h.weight), 0) || 1;
  const targetCcy = String(req.currency || "USD").toUpperCase();
  const totalNav = Number(req.total_nav || 0);
  const taxRate = Math.max(0, Math.min(0.5, Number(req.tax_rate || 0)));
  const ilpDragPct = Math.max(0, Number(req.ilp_annual_drag_pct || 0));
  const rfRatePct =
    req.rf_rate_pct != null && Number.isFinite(Number(req.rf_rate_pct))
      ? Number(req.rf_rate_pct)
      : targetCcy === "CNY" || targetCcy === "CNH"
      ? 1.6
      : 4.2;

  const { lookup } = await loadQuantCatalog(db);

  // Aggregation accumulators
  const instrumentMix = { funds: 0, direct_stocks: 0, direct_bonds: 0, cash: 0 };
  const assetClassWeights: Record<string, number> = { equity: 0, bond: 0, cash: 0, other: 0 };
  const currencyWeights: Record<string, number> = {};
  const sectorWeights: Record<string, number> = {};
  let sectorCoveredW = 0;
  const regionWeights: Record<string, number> = {};
  let regionCoveredW = 0;

  const equityGrid: Record<string, number> = {
    large_value: 0, large_blend: 0, large_growth: 0,
    mid_value: 0, mid_blend: 0, mid_growth: 0,
    small_value: 0, small_blend: 0, small_growth: 0,
  };
  let eqStyleCoveredW = 0;

  const bondGrid: Record<string, number> = {
    high_limited: 0, high_moderate: 0, high_extensive: 0,
    medium_limited: 0, medium_moderate: 0, medium_extensive: 0,
    low_limited: 0, low_moderate: 0, low_extensive: 0,
  };
  let bondStyleCoveredW = 0;
  const ratingWeights: Record<string, number> = {};
  let ratingCoveredW = 0;

  // Underlying holdings map for Stock/Issuer Intersection + Overlap
  const underlyingMap = new Map<
    string,
    {
      key: string;
      name: string;
      symbol?: string;
      totalW: number;
      directW: number;
      fundW: number;
      sources: Array<{ code: string; name: string; contribution_pct: number; is_direct: boolean }>;
    }
  >();
  let underlyingCoveredW = 0;

  // Per-holding normalized top holdings vectors for pairwise overlap
  const holdingVectors: Array<{ code: string; name: string; portW: number; map: Map<string, { name: string; frac: number }> }> = [];

  // Weighted metrics
  let nonCashW = 0;
  let hhi = 0;
  let maxSingleHolding = { isin: "", name: "", weightPct: 0 };

  let feeW = 0;
  let feeWeighted = 0;
  let starW = 0;
  let starWeighted = 0;
  let sharpeW = 0;
  let sharpeWeighted = 0;
  let sopPillarW = 0;
  let sopPillarWeighted = 0;

  let durationW = 0;
  let durationWeighted = 0;
  let ytmW = 0;
  let ytmWeighted = 0;
  let peW = 0;
  let peWeighted = 0;
  let pbW = 0;
  let pbWeighted = 0;
  let yieldW = 0;
  let yieldWeighted = 0;

  let totalFundW = 0;
  let fundCount = 0;
  let sopCoveredFundCount = 0;
  let sopCoveredW = 0;
  const valuationZoneWeights: Record<string, number> = {};
  const medalWeights: Record<string, number> = {};
  const redFlags: Array<{ slug: string; code: string; name: string; weight_pct: number; red_flag: string }> = [];
  const uncoveredFunds: Array<{ slug: string; code: string; name: string; weight_pct: number; research_queue_status: string | null }> = [];

  const enrichedHoldings: any[] = [];
  const seriesItems: Array<{ code: string; name: string; weight: number; series?: Record<string, number> }> = [];
  const seriesByAsset: Record<string, Record<string, number>> = {};
  const normWeights: Record<string, number> = {};

  for (const h of validInputs) {
    const w = Number(h.weight) / totalWeight;
    normWeights[h.isin] = w;
    const cat = lookup.get(String(h.isin).trim().toUpperCase()) || (await resolveQuantFund(db, h.isin));
    const instType = classifyHoldingInstrument(h, cat);

    if (instType === "cash") instrumentMix.cash += w;
    else if (instType === "fund") instrumentMix.funds += w;
    else if (instType === "direct_stock") instrumentMix.direct_stocks += w;
    else instrumentMix.direct_bonds += w;

    let resolvedName = h.name && h.name !== h.isin ? h.name : cat?.name || h.isin;
    let resolvedSectorInput = h.sector;
    let resolvedCountryInput = h.country;

    if (!cat && instType !== "cash") {
      try {
        const meta = await getAssetMetadata(db, h.isin);
        if (resolvedName === h.isin && meta.name && meta.name !== h.isin) resolvedName = meta.name;
        if (!resolvedSectorInput) resolvedSectorInput = meta.sector;
        if (!resolvedCountryInput) resolvedCountryInput = meta.country;
      } catch {
        // ignore metadata lookup failures in test/offline mode
      }
    }

    const ccy = (h.currency || cat?.currency || guessCurrencyFromIsin(h.isin) || "USD").toUpperCase();
    currencyWeights[ccy] = (currencyWeights[ccy] || 0) + w;

    // Asset class split
    const xray = cat?.xray_profile || null;
    if (instType === "cash") {
      assetClassWeights.cash += w;
    } else if (instType === "direct_stock") {
      assetClassWeights.equity += w;
    } else if (instType === "direct_bond") {
      assetClassWeights.bond += w;
    } else if (xray?.asset_split) {
      const sp = xray.asset_split;
      const tot = Number(sp.equity || 0) + Number(sp.bond || 0) + Number(sp.cash || 0) + Number(sp.other || 0);
      if (tot > 0) {
        assetClassWeights.equity += w * (Number(sp.equity || 0) / tot);
        assetClassWeights.bond += w * (Number(sp.bond || 0) / tot);
        assetClassWeights.cash += w * (Number(sp.cash || 0) / tot);
        assetClassWeights.other += w * (Number(sp.other || 0) / tot);
      } else {
        const bk = normalizeAssetBucket(cat?.asset_class, h.isin);
        assetClassWeights[bk] += w;
      }
    } else {
      const bk = normalizeAssetBucket(cat?.asset_class || (typeof h.sector === "string" ? h.sector : ""), h.isin);
      assetClassWeights[bk] += w;
    }

    if (instType !== "cash") {
      nonCashW += w;
      hhi += w * w;
      if (w * 100 > maxSingleHolding.weightPct) {
        maxSingleHolding = { isin: h.isin, name: resolvedName, weightPct: round1(w * 100) };
      }

      // Fee (direct holdings 0% unless overridden)
      const feeVal = h.fee_pct != null ? Number(h.fee_pct) : instType === "fund" ? cat?.fee_pct : 0;
      if (feeVal != null && Number.isFinite(Number(feeVal))) {
        feeW += w;
        feeWeighted += w * Number(feeVal);
      }

      // Stars & Sharpe
      if (cat?.morningstar_stars != null && cat.morningstar_stars > 0) {
        starW += w;
        starWeighted += w * cat.morningstar_stars;
      }
      if (cat?.sharpe_3y != null && Number.isFinite(cat.sharpe_3y)) {
        sharpeW += w;
        sharpeWeighted += w * cat.sharpe_3y;
      }

      // Sectors & Regions
      const fundSectors = xray?.sectors ? parseDistributionMap(xray.sectors, normalizeSectorKey) : parseDistributionMap(resolvedSectorInput, normalizeSectorKey);
      if (fundSectors) {
        sectorCoveredW += w;
        const totS = Object.values(fundSectors).reduce((a, b) => a + b, 0) || 100;
        for (const [sk, sv] of Object.entries(fundSectors)) {
          sectorWeights[sk] = (sectorWeights[sk] || 0) + w * (sv / totS);
        }
      }
      const fundRegions = xray?.regions ? parseDistributionMap(xray.regions, normalizeRegionKey) : parseDistributionMap(resolvedCountryInput, normalizeRegionKey);
      if (fundRegions) {
        regionCoveredW += w;
        const totR = Object.values(fundRegions).reduce((a, b) => a + b, 0) || 100;
        for (const [rk, rv] of Object.entries(fundRegions)) {
          regionWeights[rk] = (regionWeights[rk] || 0) + w * (rv / totR);
        }
      }

      // Style Box (Equity & Bond)
      if (instType === "direct_stock") {
        // Direct stock sits in equity style only if size/style metadata unavailable -> keep style uncovered instead of guessing
      } else if (xray?.equity_style?.size && xray?.equity_style?.style) {
        const key = `${xray.equity_style.size}_${xray.equity_style.style}`;
        if (key in equityGrid) {
          equityGrid[key] += w;
          eqStyleCoveredW += w;
        }
      }

      const effDur =
        h.duration != null
          ? Number(h.duration)
          : cat?.duration != null
          ? Number(cat.duration)
          : xray?.valuation?.duration != null
          ? Number(xray.valuation.duration)
          : null;
      const effYtm =
        h.ytm != null
          ? Number(h.ytm)
          : cat?.yield_pct != null
          ? Number(cat.yield_pct)
          : xray?.valuation?.ytm != null
          ? Number(xray.valuation.ytm)
          : null;

      if (effDur != null && Number.isFinite(effDur)) {
        durationW += w;
        durationWeighted += w * effDur;
      }
      if (effYtm != null && Number.isFinite(effYtm)) {
        ytmW += w;
        ytmWeighted += w * effYtm;
      }

      const bStyle =
        xray?.bond_style ||
        (instType === "direct_bond" || (cat && normalizeAssetBucket(cat.asset_class, h.isin, xray?.asset_split) === "bond")
          ? effDur != null || h.credit_rating || cat?.avg_rating
            ? {
                credit: mapBondStyleCredit(h.credit_rating || cat?.avg_rating, cat?.credit_quality),
                sensitivity: mapBondStyleSensitivity(effDur ?? 5.0),
              }
            : null
          : null);
      if (bStyle?.credit && bStyle?.sensitivity) {
        const bKey = `${bStyle.credit}_${bStyle.sensitivity}`;
        if (bKey in bondGrid) {
          bondGrid[bKey] += w;
          bondStyleCoveredW += w;
        }
      }

      if (xray?.bond_ratings && typeof xray.bond_ratings === "object") {
        ratingCoveredW += w;
        const totRat = Object.values(xray.bond_ratings).reduce((a: number, b: any) => a + Number(b || 0), 0) || 100;
        for (const [rk, rv] of Object.entries(xray.bond_ratings)) {
          const nb = normalizeRatingBucket(rk);
          ratingWeights[nb] = (ratingWeights[nb] || 0) + w * (Number(rv || 0) / totRat);
        }
      } else if (instType === "direct_bond" && h.credit_rating) {
        ratingCoveredW += w;
        const nb = normalizeRatingBucket(h.credit_rating);
        ratingWeights[nb] = (ratingWeights[nb] || 0) + w;
      } else if (cat?.avg_rating) {
        ratingCoveredW += w;
        const nb = normalizeRatingBucket(cat.avg_rating);
        ratingWeights[nb] = (ratingWeights[nb] || 0) + w;
      }

      // Valuation PE / PB & Dividend Yield
      const effPe = h.pe ?? xray?.valuation?.pe ?? null;
      const effPb = h.pb ?? xray?.valuation?.pb ?? null;
      if (effPe != null && Number(effPe) > 0) {
        peW += w;
        peWeighted += w * Number(effPe);
      }
      if (effPb != null && Number(effPb) > 0) {
        pbW += w;
        pbWeighted += w * Number(effPb);
      }

      const rawYield =
        h.dividend_yield != null
          ? Number(h.dividend_yield)
          : cat?.sop_dividend_yield_ttm != null
          ? Number(cat.sop_dividend_yield_ttm)
          : cat?.div_yield_ttm != null
          ? Number(cat.div_yield_ttm) * 100
          : effYtm;
      if (rawYield != null && Number.isFinite(Number(rawYield)) && Number(rawYield) >= 0) {
        yieldW += w;
        yieldWeighted += w * Number(rawYield);
      }

      // Underlying Top Holdings Penetration
      const vec = new Map<string, { name: string; frac: number }>();
      if (instType === "direct_stock" || instType === "direct_bond") {
        const uk = normalizeHoldingKey(h.isin, resolvedName) || h.isin.toLowerCase();
        underlyingCoveredW += w;
        vec.set(uk, { name: resolvedName, frac: 1 });
        const curEntry = underlyingMap.get(uk) || {
          key: uk,
          name: resolvedName,
          symbol: h.isin,
          totalW: 0,
          directW: 0,
          fundW: 0,
          sources: [],
        };
        curEntry.totalW += w;
        curEntry.directW += w;
        curEntry.sources.push({
          code: h.isin,
          name: resolvedName,
          contribution_pct: round2(w * 100),
          is_direct: true,
        });
        underlyingMap.set(uk, curEntry);
      } else if (cat?.top_holdings && cat.top_holdings.length > 0) {
        underlyingCoveredW += w;
        for (const sub of cat.top_holdings) {
          const pct = sub.weight_pct != null ? Number(sub.weight_pct) : 0;
          if (pct <= 0) continue;
          const frac = pct / 100;
          const contribW = w * frac;
          const uk = normalizeHoldingKey(sub.symbol, sub.name);
          if (!uk) continue;
          const prevVec = vec.get(uk);
          vec.set(uk, { name: sub.name || uk, frac: (prevVec?.frac || 0) + frac });
          const curEntry = underlyingMap.get(uk) || {
            key: uk,
            name: sub.name || sub.symbol || uk,
            symbol: sub.symbol,
            totalW: 0,
            directW: 0,
            fundW: 0,
            sources: [],
          };
          curEntry.totalW += contribW;
          curEntry.fundW += contribW;
          curEntry.sources.push({
            code: cat.code || h.isin,
            name: resolvedName,
            contribution_pct: round2(contribW * 100),
            is_direct: false,
          });
          underlyingMap.set(uk, curEntry);
        }
      }
      if (vec.size > 0) {
        holdingVectors.push({ code: cat?.code || h.isin, name: resolvedName, portW: w, map: vec });
      }

      // SOP governance aggregation (funds only)
      if (instType === "fund") {
        fundCount += 1;
        totalFundW += w;
        if (cat?.has_sop_report) {
          sopCoveredFundCount += 1;
          sopCoveredW += w;
          if (cat.sop_pillar_score != null) {
            sopPillarW += w;
            sopPillarWeighted += w * Number(cat.sop_pillar_score);
          }
          const vz = cat.sop_valuation_zone || "未标注";
          valuationZoneWeights[vz] = (valuationZoneWeights[vz] || 0) + w;
          const md = cat.sop_medal || "Neutral";
          medalWeights[md] = (medalWeights[md] || 0) + w;
          if (cat.sop_red_flag_top) {
            redFlags.push({
              slug: cat.slug,
              code: cat.code,
              name: resolvedName,
              weight_pct: round1(w * 100),
              red_flag: cat.sop_red_flag_top,
            });
          }
        } else if (cat) {
          uncoveredFunds.push({
            slug: cat.slug,
            code: cat.code,
            name: resolvedName,
            weight_pct: round1(w * 100),
            research_queue_status: cat.research_queue_status || null,
          });
        }
      }

      // Historical time-series lookup for Covariance & Stress Testing
      let seriesMap: Record<string, number> | undefined;
      try {
        if (cat) {
          const packed = await getQuantFundSeries(db, cat.slug);
          if (packed && packed.dates.length >= 20) {
            let m: Record<string, number> = {};
            for (let i = 0; i < packed.dates.length; i++) m[packed.dates[i]] = packed.adj_nav[i];
            if (targetCcy !== "NATIVE" && targetCcy !== packed.currency) {
              m = await convertSeriesCurrency(db, m, packed.currency, targetCcy);
            }
            // Back-stitch pre-inception proxy for stress replay
            const firstReal = packed.dates[0];
            if (req.include_stress !== false && firstReal && firstReal > "2015-07-01") {
              const proxy = await buildBenchmarkProxySeries(db, cat, 5500, targetCcy);
              if (proxy && proxy.series[firstReal] > 0 && m[firstReal] > 0) {
                const scale = m[firstReal] / proxy.series[firstReal];
                for (const [pd, pv] of Object.entries(proxy.series)) {
                  if (pd < firstReal && pv > 0) m[pd] = Math.round(pv * scale * 1e6) / 1e6;
                }
              }
            }
            seriesMap = m;
          }
        } else if (instType === "direct_stock" || instType === "direct_bond") {
          const rawSeries = await getHistoricalSeries(db, h.isin, 1150);
          if (rawSeries && Object.keys(rawSeries).length >= 20) {
            seriesMap =
              targetCcy !== "NATIVE" && targetCcy !== ccy
                ? await convertSeriesCurrency(db, rawSeries, ccy, targetCcy)
                : rawSeries;
          }
        }
      } catch {
        // tolerate missing cache tables in isolated tests
      }

      if (seriesMap && Object.keys(seriesMap).length >= 20) {
        seriesByAsset[h.isin] = seriesMap;
        seriesItems.push({ code: cat?.code || h.isin, name: resolvedName, weight: w, series: seriesMap });
      }
    }

    enrichedHoldings.push({
      isin: h.isin,
      slug: cat?.slug || null,
      code: cat?.code || h.isin,
      name: resolvedName,
      instrument_type: instType,
      weight_pct: round1(w * 100),
      currency: ccy,
      fee_pct: h.fee_pct != null ? Number(h.fee_pct) : instType === "fund" ? cat?.fee_pct ?? null : 0,
      stars: cat?.morningstar_stars ?? null,
      grade: cat?.quant_grade ?? null,
      duration: h.duration ?? cat?.duration ?? xray?.valuation?.duration ?? null,
      yield_pct: h.dividend_yield ?? h.ytm ?? cat?.yield_pct ?? cat?.sop_dividend_yield_ttm ?? null,
      has_sop_report: Boolean(cat?.has_sop_report),
      sop_medal: cat?.sop_medal || null,
      sop_valuation_zone: cat?.sop_valuation_zone || null,
    });
  }

  // Summary metrics
  const normalizedHhi = nonCashW > 0 ? hhi / (nonCashW * nonCashW) : 0;
  const effectiveN = normalizedHhi > 0 ? round1(1 / normalizedHhi) : 0;
  const avgFeePct = feeW > 0 ? round2(feeWeighted / feeW + ilpDragPct) : ilpDragPct > 0 ? round2(ilpDragPct) : null;
  const estAnnualFee = avgFeePct != null && totalNav > 0 ? Math.round((totalNav * avgFeePct) / 100) : null;

  // Bogle 10Y / 20Y compounding fee drag on 6.5% gross baseline
  const grossR = 0.065;
  const feeR = (avgFeePct || 0) / 100;
  const feeDrag10yPct = avgFeePct != null ? round1(((Math.pow(1 + grossR, 10) - Math.pow(1 + grossR - feeR, 10)) / Math.pow(1 + grossR, 10)) * 100) : null;
  const feeDrag20yPct = avgFeePct != null ? round1(((Math.pow(1 + grossR, 20) - Math.pow(1 + grossR - feeR, 20)) / Math.pow(1 + grossR, 20)) * 100) : null;
  const feeDrag10yAmount =
    avgFeePct != null && totalNav > 0 ? Math.round(totalNav * (Math.pow(1 + grossR, 10) - Math.pow(1 + grossR - feeR, 10))) : null;
  const feeDrag20yAmount =
    avgFeePct != null && totalNav > 0 ? Math.round(totalNav * (Math.pow(1 + grossR, 20) - Math.pow(1 + grossR - feeR, 20))) : null;

  // Pairwise Overlap
  const overlapPairs: Array<{ left_code: string; left_name: string; right_code: string; right_name: string; overlap_pct: number; shared_holdings: string[] }> = [];
  for (let i = 0; i < holdingVectors.length; i++) {
    for (let j = i + 1; j < holdingVectors.length; j++) {
      let overlapSum = 0;
      const shared: string[] = [];
      for (const [uk, leftVal] of holdingVectors[i].map.entries()) {
        const rightVal = holdingVectors[j].map.get(uk);
        if (rightVal) {
          overlapSum += Math.min(leftVal.frac, rightVal.frac);
          shared.push(leftVal.name);
        }
      }
      if (overlapSum > 0.005) {
        overlapPairs.push({
          left_code: holdingVectors[i].code,
          left_name: holdingVectors[i].name,
          right_code: holdingVectors[j].code,
          right_name: holdingVectors[j].name,
          overlap_pct: round1(overlapSum * 100),
          shared_holdings: shared.slice(0, 6),
        });
      }
    }
  }
  overlapPairs.sort((a, b) => b.overlap_pct - a.overlap_pct);

  const topUnderlying = Array.from(underlyingMap.values())
    .sort((a, b) => b.totalW - a.totalW)
    .slice(0, 15)
    .map((u) => ({
      key: u.key,
      name: u.name,
      symbol: u.symbol,
      total_weight_pct: round2(u.totalW * 100),
      direct_weight_pct: round2(u.directW * 100),
      fund_weight_pct: round2(u.fundW * 100),
      sources: u.sources.sort((a, b) => b.contribution_pct - a.contribution_pct),
    }));

  const weightedDuration = durationW > 0 ? round2(durationWeighted / durationW) : null;
  const weightedYtm = ytmW > 0 ? round2(ytmWeighted / ytmW) : null;
  const pretaxYieldPct = yieldW > 0 ? round2(yieldWeighted / yieldW) : null;
  const aftertaxYieldPct = pretaxYieldPct != null ? round2(pretaxYieldPct * (1 - taxRate)) : null;
  const estAnnualIncome = aftertaxYieldPct != null && totalNav > 0 ? Math.round((totalNav * aftertaxYieldPct) / 100) : null;
  const spreadVsRfBps = aftertaxYieldPct != null ? Math.round((aftertaxYieldPct - rfRatePct) * 100) : null;

  const riskAnalytics = computeCovarianceAnalytics(seriesItems);
  const stressTest = req.include_stress === false ? [] : computeStressReplay(normWeights, seriesByAsset);

  // Build normalized grids
  const normGrid = (grid: Record<string, number>, cov: number) => {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(grid)) {
      out[k] = cov > 0 ? round1((v / cov) * 100) : 0;
    }
    return out;
  };

  // Diagnostics
  const diagnostics: Array<{ level: "warn" | "good" | "info"; text: string }> = [];
  if (maxSingleHolding.weightPct >= 35) {
    diagnostics.push({
      level: "warn",
      text: `单一组合持仓集中度偏高：${maxSingleHolding.name} 占比 ${maxSingleHolding.weightPct}%（建议控制在 35% 以内）`,
    });
  }
  if (topUnderlying[0] && topUnderlying[0].total_weight_pct >= 10) {
    diagnostics.push({
      level: "warn",
      text: `底层穿透单一发行人/股票暴露达 ${topUnderlying[0].total_weight_pct}%（${topUnderlying[0].name}），请留意隐性集中风险`,
    });
  }
  if (overlapPairs[0] && overlapPairs[0].overlap_pct >= 25) {
    diagnostics.push({
      level: "warn",
      text: `发现重仓重叠：${overlapPairs[0].left_code} 与 ${overlapPairs[0].right_code} 前十大持仓重叠度达 ${overlapPairs[0].overlap_pct}%，存在伪分散嫌疑`,
    });
  }
  if (riskAnalytics.high_corr_pairs.length > 0) {
    const p = riskAnalytics.high_corr_pairs[0];
    diagnostics.push({
      level: "warn",
      text: `高相关性冗余提醒：${p.left} 与 ${p.right} 日度相关性达 ${p.corr}，抗危机分散效应有限`,
    });
  }
  const topSector = Object.entries(sectorWeights)
    .map(([k, v]) => ({ key: k, label: GICS_SECTOR_LABELS[k] || k, pct: round1((v / (sectorCoveredW || 1)) * 100) }))
    .sort((a, b) => b.pct - a.pct);
  if (topSector[0] && sectorCoveredW > 0.2 && topSector[0].pct >= 35) {
    diagnostics.push({
      level: "warn",
      text: `单一行业板块超配：${topSector[0].label} 在已穿透部分占比 ${topSector[0].pct}%（>35% 警戒线）`,
    });
  }
  if (weightedDuration != null && weightedDuration * 1.0 >= 5.0) {
    diagnostics.push({
      level: "warn",
      text: `固收有效久期 ${weightedDuration} 年：若利率陡升 +100 bps，债券端理论净值承压约 -${round1(weightedDuration)}%`,
    });
  }
  if (avgFeePct != null && avgFeePct > 1.35) {
    diagnostics.push({
      level: "warn",
      text: `穿透综合费率（含平台）${avgFeePct}% 偏高，按 6.5% 毛回报基准测算 10 年复利收益将被侵蚀 ${feeDrag10yPct}%`,
    });
  }
  if (redFlags.length > 0) {
    diagnostics.push({
      level: "warn",
      text: `SOP 红队一级告警（${redFlags[0].code}）：${redFlags[0].red_flag}`,
    });
  }
  if (riskAnalytics.diversification_benefit_pct != null && riskAnalytics.diversification_benefit_pct >= 12) {
    diagnostics.push({
      level: "good",
      text: `协方差实测分散化红利达 ${riskAnalytics.diversification_benefit_pct}%（真实波动 ${riskAnalytics.true_portfolio_vol_pct}% vs 线性加权 ${riskAnalytics.linear_weighted_vol_pct}%）`,
    });
  }
  if (diagnostics.length === 0 && enrichedHoldings.length > 0) {
    diagnostics.push({
      level: "good",
      text: "组合多维穿透结构均衡，集中度、久期与费率水平处于健康区间。",
    });
  }

  return {
    currency: targetCcy,
    total_nav: totalNav,
    summary: {
      total_holdings: enrichedHoldings.length,
      instrument_mix: {
        funds_pct: round1(instrumentMix.funds * 100),
        direct_stocks_pct: round1(instrumentMix.direct_stocks * 100),
        direct_bonds_pct: round1(instrumentMix.direct_bonds * 100),
        cash_pct: round1(instrumentMix.cash * 100),
      },
      effective_n: effectiveN,
      max_single_holding: maxSingleHolding,
      weighted_fee_pct: avgFeePct,
      fee_coverage_pct: round1(feeW * 100),
      est_annual_fee: estAnnualFee,
      fee_drag_10y_pct: feeDrag10yPct,
      fee_drag_20y_pct: feeDrag20yPct,
      fee_drag_10y_amount: feeDrag10yAmount,
      fee_drag_20y_amount: feeDrag20yAmount,
      weighted_stars: starW > 0 ? round2(starWeighted / starW) : null,
      weighted_sop_pillar_score: sopPillarW > 0 ? round2(sopPillarWeighted / sopPillarW) : null,
      weighted_sharpe_3y: sharpeW > 0 ? round2(sharpeWeighted / sharpeW) : null,
    },
    asset_classes: [
      { key: "equity", label: "股票资产", pct: round1(assetClassWeights.equity * 100) },
      { key: "bond", label: "固定收益 / 债券", pct: round1(assetClassWeights.bond * 100) },
      { key: "cash", label: "现金及货币", pct: round1(assetClassWeights.cash * 100) },
      { key: "other", label: "多元 / 其他资产", pct: round1(assetClassWeights.other * 100) },
    ]
      .filter((x) => x.pct > 0)
      .sort((a, b) => b.pct - a.pct),
    currencies: Object.entries(currencyWeights)
      .map(([label, v]) => ({ label, pct: round1(v * 100) }))
      .filter((x) => x.pct > 0)
      .sort((a, b) => b.pct - a.pct),
    underlying_holdings: {
      coverage_pct: round1(underlyingCoveredW * 100),
      items: topUnderlying,
    },
    overlap: {
      pairs: overlapPairs.slice(0, 8),
      high_overlap_count: overlapPairs.filter((p) => p.overlap_pct >= 25).length,
    },
    sectors: {
      coverage_pct: round1(sectorCoveredW * 100),
      items: topSector.filter((x) => x.pct > 0),
    },
    regions: {
      coverage_pct: round1(regionCoveredW * 100),
      items: Object.entries(regionWeights)
        .map(([k, v]) => ({ key: k, label: REGION_LABELS[k] || k, pct: round1((v / (regionCoveredW || 1)) * 100) }))
        .filter((x) => x.pct > 0)
        .sort((a, b) => b.pct - a.pct),
    },
    style_boxes: {
      equity: {
        coverage_pct: round1(eqStyleCoveredW * 100),
        grid: normGrid(equityGrid, eqStyleCoveredW),
      },
      fixed_income: {
        coverage_pct: round1(bondStyleCoveredW * 100),
        grid: normGrid(bondGrid, bondStyleCoveredW),
        weighted_duration: weightedDuration,
        duration_coverage_pct: round1(durationW * 100),
        weighted_ytm_pct: weightedYtm,
        rate_shock_plus_100bps_pct: weightedDuration != null ? round2(-weightedDuration) : null,
        rate_shock_minus_100bps_pct: weightedDuration != null ? round2(weightedDuration) : null,
        credit_ratings: Object.entries(ratingWeights)
          .map(([k, v]) => ({ label: k.toUpperCase(), pct: round1((v / (ratingCoveredW || 1)) * 100) }))
          .filter((x) => x.pct > 0),
      },
    },
    risk_analytics: riskAnalytics,
    valuation_cashflow_sop: {
      sop_covered_count: sopCoveredFundCount,
      total_fund_count: fundCount,
      sop_covered_weight_pct: totalFundW > 0 ? round1((sopCoveredW / totalFundW) * 100) : 0,
      valuation_zones: Object.entries(valuationZoneWeights)
        .map(([label, v]) => ({ label, pct: round1((v / (sopCoveredW || 1)) * 100) }))
        .sort((a, b) => b.pct - a.pct),
      medal_distribution: Object.entries(medalWeights)
        .map(([label, v]) => ({ label, pct: round1((v / (sopCoveredW || 1)) * 100) }))
        .sort((a, b) => b.pct - a.pct),
      weighted_pe: peW > 0 ? round2(peWeighted / peW) : null,
      weighted_pb: pbW > 0 ? round2(pbWeighted / pbW) : null,
      pretax_yield_pct: pretaxYieldPct,
      aftertax_yield_pct: aftertaxYieldPct,
      est_annual_income: estAnnualIncome,
      rf_rate_pct: rfRatePct,
      spread_vs_rf_bps: spreadVsRfBps,
      red_flags: redFlags,
      uncovered_funds: uncoveredFunds.sort((a, b) => b.weight_pct - a.weight_pct),
    },
    stress_test: stressTest,
    diagnostics,
    holdings: enrichedHoldings,
  };
}

export async function batchEnqueueResearchRequests(
  db: D1Database,
  user: { id: string | number; name?: string | null; email: string; role: string },
  slugs: string[],
  note: string = "从组合 X-Ray 一键加入深度研究观察队列"
) {
  const uniqueSlugs = Array.from(new Set(slugs.map((s) => String(s || "").trim()).filter(Boolean))).slice(0, 30);
  if (uniqueSlugs.length === 0) {
    return { enqueued_count: 0, skipped_count: 0, items: [] };
  }

  const nowIso = new Date().toISOString();
  const cleanNote = String(note || "").trim().slice(0, 300);
  const uid = String(user.id);
  const items: Array<{ slug: string; status: string }> = [];
  let enqueued = 0;
  let skipped = 0;

  for (const s of uniqueSlugs) {
    const fund = await resolveQuantFund(db, s);
    if (!fund) {
      skipped += 1;
      continue;
    }
    const existingReport = await db.prepare("SELECT slug FROM wq_fund_sop_reports WHERE slug = ?").bind(fund.slug).first();
    if (existingReport) {
      skipped += 1;
      continue;
    }

    const existing = await db.prepare("SELECT * FROM wq_fund_research_queue WHERE slug = ?").bind(fund.slug).first<any>();
    let requesters: any[] = [];
    try {
      requesters = existing?.requesters_json ? JSON.parse(existing.requesters_json) : [];
    } catch {
      requesters = [];
    }
    const idx = requesters.findIndex((r) => String(r?.user_id) === uid);
    const entry = {
      user_id: uid,
      name: user.name || user.email,
      email: user.email,
      role: user.role,
      note: cleanNote,
      requested_at: nowIso,
    };
    if (idx >= 0) requesters[idx] = entry;
    else requesters.push(entry);

    const nextStatus = !existing || existing.status === "dismissed" || existing.status === "completed" ? "queued" : existing.status;

    await db
      .prepare(
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
        existing?.priority || "normal",
        requesters.length,
        JSON.stringify(requesters),
        existing?.first_requested_at || nowIso,
        nowIso
      )
      .run();

    enqueued += 1;
    items.push({ slug: fund.slug, status: nextStatus });
  }

  clearQuantStoreCaches();
  return { enqueued_count: enqueued, skipped_count: skipped, items };
}
