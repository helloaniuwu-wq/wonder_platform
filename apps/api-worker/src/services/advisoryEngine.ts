import { UserRow } from "../types";
import { loadQuantCatalog, QuantFundCatalogRow } from "./quantStore";

export type RiskLevel =
  | "conservative"
  | "moderate_conservative"
  | "balanced"
  | "growth"
  | "aggressive";

export type PrimaryGoal =
  | "income"
  | "preservation"
  | "balanced"
  | "growth"
  | "retirement"
  | "education";

export type ProductScope =
  | "all"
  | "hk_broker"
  | "hk_broker_etf"
  | "non_ilas"
  | "aia_tmp2"
  | "eu_ucits"
  | "global_etf"
  | "cn_hk_dividend"
  | "bonds_income";

export interface ClientAdvisoryProfile {
  client_name?: string;
  age?: number | null;
  horizon_years: number;
  initial_capital: number;
  currency: string;
  primary_goal: PrimaryGoal;
  risk_score?: number | null;
  risk_level?: RiskLevel;
  target_annual_yield_pct?: number | null;
  annual_withdrawal?: number | null;
  product_scope?: ProductScope;
  ilp_planned?: boolean;
  notes?: string;
  extra_notes?: string;
}

export interface TargetEnvelope {
  risk_level: RiskLevel;
  risk_label_zh: string;
  risk_label_en: string;
  risk_score: number;
  target_equity_pct: number;
  target_bond_pct: number;
  target_other_pct: number;
  equity_hard_cap_pct: number;
  max_vol_pct: number;
  max_drawdown_pct: number;
  income_focus: boolean;
  withdrawal_rate_pct: number;
  suggested_rebalance_freq: string;
  summary_zh: string;
  summary_en: string;
}

export interface ExistingPortfolioMatch {
  id: number;
  name: string;
  base_currency: string;
  dividend_strategy: string;
  match_score: number;
  fit_reasons: string[];
  watchouts: string[];
  allocations: Record<string, number>;
  stats: {
    total_nav: number | null;
    total_return_pct: number | null;
    annualized_return_pct: number | null;
    annualized_yield_pct: number | null;
  };
}

export interface ClassicTemplateHolding {
  isin: string;
  weight_pct: number;
  asset_class: string;
  label_zh: string;
  label_en: string;
}

export interface ClassicTemplateMatch {
  id: string;
  name_zh: string;
  name_en: string;
  origin: string;
  idea_zh: string;
  idea_en: string;
  match_score: number;
  fit_reasons: string[];
  equity_pct: number;
  bond_pct: number;
  other_pct: number;
  holdings: ClassicTemplateHolding[];
}

export interface CustomBasketHolding {
  slug: string;
  code: string;
  lab_id: string;
  isin?: string | null;
  name: string;
  asset_class: string;
  sleeve: "equity" | "bond" | "other";
  core_role: "core" | "satellite";
  homogeneity_cluster?: string;
  ilas_platform: string | null;
  currency: string;
  data_tier: string;
  quant_grade: string | null;
  quant_score: number | null;
  ret_3y_ann: number | null;
  vol_3y: number | null;
  sharpe_3y: number | null;
  alpha_3y?: number | null;
  r2_3y?: number | null;
  div_yield_ttm: number | null;
  fee_pct: number | null;
  is_distributing: boolean;
  weight_pct: number;
  is_admin_core_pick?: boolean;
  admin_core_reasons?: string[];
  rationale_zh: string;
  rationale_en: string;
}

export interface TacticalCandidateFund {
  slug: string;
  lab_id: string;
  code: string;
  isin?: string | null;
  yahoo_ticker?: string | null;
  name: string;
  asset_class: string;
  sleeve: "equity" | "bond" | "other";
  core_role: "core" | "satellite";
  homogeneity_cluster: string;
  ilas_platform: string | null;
  currency: string;
  fee_pct: number | null;
  alpha_3y: number | null;
  r2_3y: number | null;
  beta_3y: number | null;
  vol_3y: number | null;
  div_yield_ttm: number | null;
  quant_grade: string | null;
  is_distributing: boolean;
  is_admin_core_pick?: boolean;
  admin_core_reasons?: string[];
}

export interface CustomFundBasket {
  key: "core" | "alternative";
  universe_mode: "ilas" | "non_ilas" | "hk_broker";
  us_estate_tax_shield?: boolean;
  hk_broker_etf_only?: boolean;
  title_zh: string;
  title_en: string;
  subtitle_zh: string;
  subtitle_en: string;
  holdings: CustomBasketHolding[];
  metrics: {
    est_cagr_pct: number | null;
    est_vol_pct: number | null;
    est_sharpe: number | null;
    est_max_dd_pct: number | null;
    est_div_yield_pct: number | null;
    weighted_fee_pct: number | null;
    equity_pct: number;
    bond_pct: number;
    other_pct: number;
    core_pct: number;
    satellite_pct: number;
    distributing_pct: number;
    series_backed_count: number;
  };
}

export interface AdvisoryRecommendationResult {
  normalized_profile: ClientAdvisoryProfile;
  target_envelope: TargetEnvelope;
  existing_portfolio_matches: ExistingPortfolioMatch[];
  classic_template_matches: ClassicTemplateMatch[];
  custom_fund_baskets: CustomFundBasket[];
  catalog_stats: {
    total_funds: number;
    scoped_funds: number;
    series_backed_funds: number;
    admin_core_picks_count?: number;
  };
}

const RISK_META: Record<
  RiskLevel,
  {
    score: number;
    label_zh: string;
    label_en: string;
    equity: number;
    bond: number;
    other: number;
    maxVol: number;
    maxDd: number;
  }
> = {
  conservative: {
    score: 20,
    label_zh: "保守防御型",
    label_en: "Conservative",
    equity: 20,
    bond: 70,
    other: 10,
    maxVol: 7.0,
    maxDd: 10.0,
  },
  moderate_conservative: {
    score: 38,
    label_zh: "稳健偏收息",
    label_en: "Moderate Conservative",
    equity: 38,
    bond: 52,
    other: 10,
    maxVol: 10.0,
    maxDd: 15.0,
  },
  balanced: {
    score: 55,
    label_zh: "均衡配置型",
    label_en: "Balanced",
    equity: 55,
    bond: 35,
    other: 10,
    maxVol: 13.5,
    maxDd: 22.0,
  },
  growth: {
    score: 75,
    label_zh: "积极成长型",
    label_en: "Growth",
    equity: 75,
    bond: 20,
    other: 5,
    maxVol: 17.5,
    maxDd: 30.0,
  },
  aggressive: {
    score: 90,
    label_zh: "进取增值型",
    label_en: "Aggressive",
    equity: 90,
    bond: 10,
    other: 0,
    maxVol: 22.0,
    maxDd: 40.0,
  },
};

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function riskLevelFromScore(score: number): RiskLevel {
  if (score < 28) return "conservative";
  if (score < 46) return "moderate_conservative";
  if (score < 66) return "balanced";
  if (score < 82) return "growth";
  return "aggressive";
}

export function normalizeProfile(raw: Partial<ClientAdvisoryProfile>): ClientAdvisoryProfile {
  const validGoals: PrimaryGoal[] = [
    "income",
    "preservation",
    "balanced",
    "growth",
    "retirement",
    "education",
  ];
  const validScopes: ProductScope[] = [
    "all",
    "hk_broker",
    "hk_broker_etf",
    "non_ilas",
    "aia_tmp2",
    "eu_ucits",
    "global_etf",
    "cn_hk_dividend",
    "bonds_income",
  ];
  const validRisks: RiskLevel[] = [
    "conservative",
    "moderate_conservative",
    "balanced",
    "growth",
    "aggressive",
  ];

  const horizon = clamp(Math.round(Number(raw.horizon_years || 10)), 1, 40);
  const capital = Math.max(1000, Number(raw.initial_capital || 500000));
  const goal: PrimaryGoal = validGoals.includes(raw.primary_goal as PrimaryGoal)
    ? (raw.primary_goal as PrimaryGoal)
    : "balanced";
  const scope: ProductScope = validScopes.includes(raw.product_scope as ProductScope)
    ? (raw.product_scope as ProductScope)
    : "all";

  let riskLevel: RiskLevel;
  let riskScore: number;
  if (raw.risk_level && validRisks.includes(raw.risk_level)) {
    riskLevel = raw.risk_level;
    riskScore =
      raw.risk_score != null && Number.isFinite(Number(raw.risk_score))
        ? clamp(Number(raw.risk_score), 0, 100)
        : RISK_META[riskLevel].score;
  } else if (raw.risk_score != null && Number.isFinite(Number(raw.risk_score))) {
    riskScore = clamp(Number(raw.risk_score), 0, 100);
    riskLevel = riskLevelFromScore(riskScore);
  } else {
    riskLevel = goal === "preservation" ? "conservative" : goal === "growth" ? "growth" : "balanced";
    riskScore = RISK_META[riskLevel].score;
  }

  const rawNotes = String(raw.extra_notes ?? raw.notes ?? "").trim().slice(0, 1000);
  return {
    client_name: raw.client_name ? String(raw.client_name).trim().slice(0, 80) : "",
    age: raw.age != null && Number.isFinite(Number(raw.age)) ? clamp(Number(raw.age), 18, 95) : null,
    horizon_years: horizon,
    initial_capital: capital,
    currency: String(raw.currency || "USD").trim().toUpperCase().slice(0, 6) || "USD",
    primary_goal: goal,
    risk_score: Math.round(riskScore),
    risk_level: riskLevel,
    target_annual_yield_pct:
      raw.target_annual_yield_pct != null && Number(raw.target_annual_yield_pct) > 0
        ? clamp(Number(raw.target_annual_yield_pct), 0, 15)
        : null,
    annual_withdrawal:
      raw.annual_withdrawal != null && Number(raw.annual_withdrawal) > 0
        ? Number(raw.annual_withdrawal)
        : null,
    product_scope: scope,
    ilp_planned: Boolean(raw.ilp_planned),
    notes: rawNotes,
    extra_notes: rawNotes,
  };
}

export function getHorizonEquityHardCap(horizonYears: number): number {
  const h = Number(horizonYears || 10);
  if (h < 3) return 20;
  if (h < 5) return 35;
  if (h < 10) return 60;
  if (h < 20) return 80;
  return 90;
}

export function getRiskEnvelope(profile: ClientAdvisoryProfile): TargetEnvelope {
  const level = profile.risk_level || riskLevelFromScore(profile.risk_score ?? 55);
  const base = RISK_META[level];
  const equityHardCap = getHorizonEquityHardCap(profile.horizon_years);
  let equity = base.equity;
  let bond = base.bond;
  let other = base.other;

  // Horizon adjustment
  if (profile.horizon_years < 5) {
    const shift = Math.min(10, Math.max(0, equity - 15));
    equity -= shift;
    bond += shift;
  } else if (profile.horizon_years >= 15 && level !== "conservative" && level !== "aggressive") {
    const shift = Math.min(5, Math.max(0, bond - 10));
    equity += shift;
    bond -= shift;
  }

  // Goal adjustment
  if (profile.primary_goal === "income" || profile.primary_goal === "preservation") {
    const shift = Math.min(8, Math.max(0, equity - 15));
    equity -= shift;
    bond += shift;
  } else if (profile.primary_goal === "growth" && level !== "conservative") {
    const shift = Math.min(5, Math.max(0, bond - 10));
    equity += shift;
    bond -= shift;
  }

  // Enforce Obsidian horizon equity hard cap (cannot be breached)
  if (equity > equityHardCap) {
    const excess = equity - equityHardCap;
    equity = equityHardCap;
    bond += excess;
  }

  // Keep exact sum = 100
  other = clamp(100 - equity - bond, 0, 30);
  bond = 100 - equity - other;

  const withdrawalRatePct =
    profile.initial_capital > 0 && (profile.annual_withdrawal || 0) > 0
      ? Math.round(((profile.annual_withdrawal || 0) / profile.initial_capital) * 1000) / 10
      : 0;

  const incomeFocus =
    profile.primary_goal === "income" ||
    profile.primary_goal === "retirement" ||
    (profile.target_annual_yield_pct ?? 0) >= 3.5 ||
    withdrawalRatePct >= 2.0;

  const freq = level === "conservative" ? "年度" : incomeFocus ? "半年度" : "半年度";

  return {
    risk_level: level,
    risk_label_zh: base.label_zh,
    risk_label_en: base.label_en,
    risk_score: profile.risk_score ?? base.score,
    target_equity_pct: equity,
    target_bond_pct: bond,
    target_other_pct: other,
    equity_hard_cap_pct: equityHardCap,
    max_vol_pct: base.maxVol,
    max_drawdown_pct: base.maxDd,
    income_focus: incomeFocus,
    withdrawal_rate_pct: withdrawalRatePct,
    suggested_rebalance_freq: freq,
    summary_zh: `${base.label_zh} · 建议股债多元比 ${equity}% / ${bond}% / ${other}%（期限权益硬顶 ≤${equityHardCap}%），波动预算 ≤${base.maxVol}%${incomeFocus ? " · 侧重派息现金流" : ""}`,
    summary_en: `${base.label_en} · Target ${equity}% Eq / ${bond}% FI / ${other}% Alt (Horizon Eq Cap <=${equityHardCap}%), Vol <= ${base.maxVol}%${incomeFocus ? " · Income tilt" : ""}`,
  };
}

interface ClassicSpec {
  id: string;
  name_zh: string;
  name_en: string;
  origin: string;
  idea_zh: string;
  idea_en: string;
  risk_mid: number;
  income_score: number;
  equity_pct: number;
  bond_pct: number;
  other_pct: number;
  holdings: ClassicTemplateHolding[];
}

const CLASSIC_ARCHETYPES: ClassicSpec[] = [
  {
    id: "all-weather",
    name_zh: "全天候组合",
    name_en: "All Weather",
    origin: "Ray Dalio / Bridgewater",
    idea_zh: "围绕增长与通胀四象限配置，重仓长债平衡股票与商品波动，追求全周期稳健。",
    idea_en: "Balances growth and inflation regimes using long bonds, equities, gold, and commodities.",
    risk_mid: 40,
    income_score: 55,
    equity_pct: 30,
    bond_pct: 55,
    other_pct: 15,
    holdings: [
      { isin: "VTI", weight_pct: 30, asset_class: "equity", label_zh: "美国全市场股票", label_en: "US Total Stock Market" },
      { isin: "TLT", weight_pct: 40, asset_class: "bond", label_zh: "美国长期国债(20Y+)", label_en: "US Long Treasuries" },
      { isin: "IEF", weight_pct: 15, asset_class: "bond", label_zh: "美国中期国债(7-10Y)", label_en: "US Interm Treasuries" },
      { isin: "GLD", weight_pct: 7.5, asset_class: "gold", label_zh: "黄金", label_en: "Gold" },
      { isin: "DBC", weight_pct: 7.5, asset_class: "commodity", label_zh: "大宗商品", label_en: "Commodities" },
    ],
  },
  {
    id: "permanent",
    name_zh: "永久组合",
    name_en: "Permanent Portfolio",
    origin: "Harry Browne",
    idea_zh: "股票、长债、国库券现金、黄金各 25%，极端防回撤与抗通胀/通缩冲击。",
    idea_en: "Equal 25% quarters across equities, long bonds, T-bills, and gold.",
    risk_mid: 25,
    income_score: 60,
    equity_pct: 25,
    bond_pct: 50,
    other_pct: 25,
    holdings: [
      { isin: "VTI", weight_pct: 25, asset_class: "equity", label_zh: "美国全市场股票", label_en: "US Total Stock Market" },
      { isin: "TLT", weight_pct: 25, asset_class: "bond", label_zh: "美国长期国债", label_en: "US Long Treasuries" },
      { isin: "BIL", weight_pct: 25, asset_class: "cash", label_zh: "1-3月国库券", label_en: "US T-Bills 1-3M" },
      { isin: "GLD", weight_pct: 25, asset_class: "gold", label_zh: "黄金", label_en: "Gold" },
    ],
  },
  {
    id: "golden-butterfly",
    name_zh: "金蝴蝶组合",
    name_en: "Golden Butterfly",
    origin: "Tyler",
    idea_zh: "在永久组合基础上加入小盘价值股，五个 20% 仓位兼顾长期增长与高夏普稳健。",
    idea_en: "Adds small-cap value to Permanent Portfolio across five 20% slices.",
    risk_mid: 42,
    income_score: 52,
    equity_pct: 40,
    bond_pct: 40,
    other_pct: 20,
    holdings: [
      { isin: "VTI", weight_pct: 20, asset_class: "equity", label_zh: "美国全市场股票", label_en: "US Total Stock Market" },
      { isin: "VBR", weight_pct: 20, asset_class: "equity", label_zh: "美国小盘价值股", label_en: "US Small-Cap Value" },
      { isin: "TLT", weight_pct: 20, asset_class: "bond", label_zh: "美国长期国债", label_en: "US Long Treasuries" },
      { isin: "SHY", weight_pct: 20, asset_class: "bond", label_zh: "美国短期国债", label_en: "US Short Treasuries" },
      { isin: "GLD", weight_pct: 20, asset_class: "gold", label_zh: "黄金", label_en: "Gold" },
    ],
  },
  {
    id: "three-fund",
    name_zh: "三基金组合",
    name_en: "Three-Fund",
    origin: "Bogleheads",
    idea_zh: "美股、国际股、美债三只低费指数，简洁透明，适合 5–20 年定投复利。",
    idea_en: "Low-cost US equity, international equity, and US aggregate bond core.",
    risk_mid: 60,
    income_score: 48,
    equity_pct: 60,
    bond_pct: 40,
    other_pct: 0,
    holdings: [
      { isin: "VTI", weight_pct: 42, asset_class: "equity", label_zh: "美国全市场股票", label_en: "US Total Stock Market" },
      { isin: "VXUS", weight_pct: 18, asset_class: "equity", label_zh: "国际股票", label_en: "International ex-US" },
      { isin: "BND", weight_pct: 40, asset_class: "bond", label_zh: "美国综合债券", label_en: "US Aggregate Bonds" },
    ],
  },
  {
    id: "sixty-forty",
    name_zh: "60/40 经典组合",
    name_en: "60/40 Classic",
    origin: "传统平衡型基准",
    idea_zh: "六成标普 500 搭配四成美债，攻守兼备的全球机构基准参照。",
    idea_en: "Traditional 60% S&P 500 and 40% aggregate bond benchmark.",
    risk_mid: 58,
    income_score: 45,
    equity_pct: 60,
    bond_pct: 40,
    other_pct: 0,
    holdings: [
      { isin: "SPY", weight_pct: 60, asset_class: "equity", label_zh: "标普 500", label_en: "S&P 500" },
      { isin: "BND", weight_pct: 40, asset_class: "bond", label_zh: "美国综合债券", label_en: "US Aggregate Bonds" },
    ],
  },
  {
    id: "yale-swensen",
    name_zh: "耶鲁捐赠基金式",
    name_en: "Yale Endowment Style",
    origin: "David Swensen",
    idea_zh: "融入房产信托 REITs 与通胀保值债券 TIPS，适合长期抗通胀高成长规划。",
    idea_en: "Diversifies equities with REITs and TIPS for long-horizon real growth.",
    risk_mid: 74,
    income_score: 62,
    equity_pct: 50,
    bond_pct: 30,
    other_pct: 20,
    holdings: [
      { isin: "VTI", weight_pct: 30, asset_class: "equity", label_zh: "美国全市场股票", label_en: "US Total Stock" },
      { isin: "VEA", weight_pct: 15, asset_class: "equity", label_zh: "发达市场股票", label_en: "Developed Intl" },
      { isin: "VWO", weight_pct: 5, asset_class: "equity", label_zh: "新兴市场股票", label_en: "Emerging Markets" },
      { isin: "VNQ", weight_pct: 20, asset_class: "reit", label_zh: "美国 REITs", label_en: "US REITs" },
      { isin: "TLT", weight_pct: 15, asset_class: "bond", label_zh: "美国长期国债", label_en: "US Long Treasuries" },
      { isin: "TIP", weight_pct: 15, asset_class: "bond", label_zh: "抗通胀国债 TIPS", label_en: "TIPS" },
    ],
  },
  {
    id: "barbell-risk",
    name_zh: "杠铃组合（风险型）",
    name_en: "Barbell (Risk)",
    origin: "Nassim Taleb",
    idea_zh: "90% 极安全短债现金锁定下限，10% 高弹性资产博取长尾上行空间。",
    idea_en: "90% ultra-safe T-bills paired with 10% high-convexity growth sleeve.",
    risk_mid: 32,
    income_score: 70,
    equity_pct: 10,
    bond_pct: 90,
    other_pct: 0,
    holdings: [
      { isin: "BIL", weight_pct: 90, asset_class: "cash", label_zh: "1-3月美国国库券", label_en: "US T-Bills 1-3M" },
      { isin: "QQQ", weight_pct: 10, asset_class: "equity", label_zh: "纳斯达克 100", label_en: "Nasdaq-100" },
    ],
  },
  {
    id: "barbell-duration",
    name_zh: "杠铃组合（久期型）",
    name_en: "Barbell (Duration)",
    origin: "经典固收久期杠铃",
    idea_zh: "短债提供流动性与票息再投资，长债把握利率下行周期的资本利得。",
    idea_en: "Holds short and long treasury ends for liquidity plus rate-cut upside.",
    risk_mid: 28,
    income_score: 78,
    equity_pct: 0,
    bond_pct: 100,
    other_pct: 0,
    holdings: [
      { isin: "SHY", weight_pct: 50, asset_class: "bond", label_zh: "美国短期国债", label_en: "US Short Treasuries" },
      { isin: "TLT", weight_pct: 50, asset_class: "bond", label_zh: "美国长期国债", label_en: "US Long Treasuries" },
    ],
  },
];

const CLASSIC_UCITS_REMAP: Record<
  string,
  { isin: string; asset_class: string; label_zh: string; label_en: string }
> = {
  VTI: { isin: "VWRA", asset_class: "equity", label_zh: "全球全市场股票 (爱尔兰 UCITS)", label_en: "FTSE All-World (IE UCITS)" },
  SPY: { isin: "CSPX", asset_class: "equity", label_zh: "标普 500 核心股票 (爱尔兰 UCITS)", label_en: "Core S&P 500 (IE UCITS)" },
  VXUS: { isin: "MXWO", asset_class: "equity", label_zh: "发达国际股票 (爱尔兰 UCITS)", label_en: "Intl Equity (IE UCITS)" },
  VEA: { isin: "MXWO", asset_class: "equity", label_zh: "发达国际股票 (爱尔兰 UCITS)", label_en: "Developed Intl (IE UCITS)" },
  VBR: { isin: "IWVL", asset_class: "equity", label_zh: "全球价值因子股票 (爱尔兰 UCITS)", label_en: "World Value (IE UCITS)" },
  VWO: { isin: "VHYD", asset_class: "equity", label_zh: "全球高股息股票 (爱尔兰 UCITS)", label_en: "All-World High Div (IE UCITS)" },
  QQQ: { isin: "CNDX", asset_class: "equity", label_zh: "纳斯达克 100 科技成长 (爱尔兰 UCITS)", label_en: "NASDAQ 100 (IE UCITS)" },
  BND: { isin: "AGGU", asset_class: "bond", label_zh: "全球综合债券美元对冲 (爱尔兰 UCITS)", label_en: "Global Aggregate Bond USD Hedged (IE UCITS)" },
  IEF: { isin: "CBU0", asset_class: "bond", label_zh: "7-10年美国国债 (爱尔兰 UCITS)", label_en: "US 7-10Y Treasury (IE UCITS)" },
  TLT: { isin: "DTLA", asset_class: "bond", label_zh: "20+年超长期美债 (爱尔兰 UCITS)", label_en: "US 20+Y Treasury (IE UCITS)" },
  TIP: { isin: "CBU7", asset_class: "bond", label_zh: "3-7年中期美债替代 (爱尔兰 UCITS)", label_en: "US 3-7Y Treasury (IE UCITS)" },
  BIL: { isin: "IB01", asset_class: "cash", label_zh: "0-1年超短美债 (爱尔兰 UCITS)", label_en: "US Treasury 0-1Y (IE UCITS)" },
  SHY: { isin: "IBTA", asset_class: "bond", label_zh: "1-3年短期美债 (爱尔兰 UCITS)", label_en: "US 1-3Y Treasury (IE UCITS)" },
  GLD: { isin: "VHYD", asset_class: "equity", label_zh: "高股息防御替代 (爱尔兰 UCITS)", label_en: "All-World High Div (IE UCITS)" },
  DBC: { isin: "JREG", asset_class: "equity", label_zh: "全球核心分散替代 (爱尔兰 UCITS)", label_en: "Global Core Diversifier (IE UCITS)" },
  VNQ: { isin: "VHYD", asset_class: "equity", label_zh: "全球高股息收益替代 (爱尔兰 UCITS)", label_en: "All-World High Div (IE UCITS)" },
};

function remapHoldingsToUcits(holdings: ClassicTemplateHolding[]): ClassicTemplateHolding[] {
  const merged = new Map<string, ClassicTemplateHolding>();
  for (const h of holdings) {
    const mapped = CLASSIC_UCITS_REMAP[h.isin.toUpperCase()];
    const targetIsin = mapped ? mapped.isin : h.isin;
    const prev = merged.get(targetIsin);
    if (prev) {
      prev.weight_pct = Math.round((prev.weight_pct + h.weight_pct) * 10) / 10;
    } else {
      merged.set(targetIsin, {
        isin: targetIsin,
        weight_pct: h.weight_pct,
        asset_class: mapped ? mapped.asset_class : h.asset_class,
        label_zh: mapped ? mapped.label_zh : h.label_zh,
        label_en: mapped ? mapped.label_en : h.label_en,
      });
    }
  }
  return Array.from(merged.values());
}

export function matchClassicTemplates(
  profile: ClientAdvisoryProfile,
  envelope: TargetEnvelope
): ClassicTemplateMatch[] {
  const useUcitsRemap =
    resolveBasketUniverseMode(profile) === "non_ilas" &&
    profile.product_scope !== "hk_broker_etf" &&
    hasUsEstateTaxConcern(profile);
  const scored = CLASSIC_ARCHETYPES.map((spec) => {
    const equityDiff = Math.abs(spec.equity_pct - envelope.target_equity_pct);
    const bondDiff = Math.abs(spec.bond_pct - envelope.target_bond_pct);
    const riskDiff = Math.abs(spec.risk_mid - envelope.risk_score);

    let score = 96 - equityDiff * 0.65 - bondDiff * 0.25 - riskDiff * 0.35;
    if (envelope.income_focus) {
      score += (spec.income_score - 55) * 0.35;
    }
    if (profile.primary_goal === "growth" && spec.equity_pct >= 50) {
      score += 6;
    }
    if (profile.horizon_years >= 12 && spec.id === "yale-swensen") {
      score += 5;
    }
    const matchScore = Math.round(clamp(score, 40, 99));

    const reasons: string[] = [];
    if (useUcitsRemap) {
      reasons.push("已自动映射为爱尔兰/卢森堡 UCITS 标的以规避美国遗产税");
    }
    if (equityDiff <= 15) {
      reasons.push(`股票仓位 ${spec.equity_pct}% 贴合客户目标（${envelope.target_equity_pct}%）`);
    }
    if (spec.other_pct > 0) {
      reasons.push(`含 ${spec.other_pct}% 黄金/商品/REITs 抗通胀分散`);
    }
    if (envelope.income_focus && spec.income_score >= 60) {
      reasons.push("高固定收益/现金流占比，契合周期提取或收息需求");
    }
    if (reasons.length === 0) {
      reasons.push(spec.idea_zh.slice(0, 32) + "…");
    }

    return {
      id: spec.id,
      name_zh: useUcitsRemap ? `${spec.name_zh}（UCITS 欧基版）` : spec.name_zh,
      name_en: useUcitsRemap ? `${spec.name_en} (IE/LU UCITS)` : spec.name_en,
      origin: spec.origin,
      idea_zh: spec.idea_zh,
      idea_en: spec.idea_en,
      match_score: matchScore,
      fit_reasons: reasons,
      equity_pct: spec.equity_pct,
      bond_pct: spec.bond_pct,
      other_pct: spec.other_pct,
      holdings: useUcitsRemap ? remapHoldingsToUcits(spec.holdings) : spec.holdings,
    };
  });

  return scored.sort((a, b) => b.match_score - a.match_score).slice(0, 3);
}

export async function matchExistingPortfolios(
  db: D1Database,
  user: UserRow,
  profile: ClientAdvisoryProfile,
  envelope: TargetEnvelope,
  catalogLookup: Map<string, QuantFundCatalogRow>
): Promise<ExistingPortfolioMatch[]> {
  try {
    let sql = `
      SELECT p.id, p.name, p.base_currency, p.dividend_strategy, p.target_allocations, p.is_public,
             c.total_nav, c.cumulative_roi, c.annualized_return, c.total_divs
      FROM portfolios p
      LEFT JOIN portfolio_stats_cache c ON c.portfolio_id = p.id
    `;
    const params: unknown[] = [];
    if (user.role === "admin") {
      // visible to all
    } else if (user.role === "advisor") {
      sql += ` WHERE p.is_public = 1 OR p.user_id = ? OR p.user_id IN (SELECT client_id FROM advisor_clients WHERE advisor_id = ? AND is_active = 1)`;
      params.push(user.id, user.id);
    } else {
      sql += ` WHERE p.is_public = 1 OR p.user_id = ?`;
      params.push(user.id);
    }
    sql += ` ORDER BY p.sort_order ASC, p.created_at DESC LIMIT 30`;

    const { results } = await db.prepare(sql).bind(...params).all<any>();
    const matches: ExistingPortfolioMatch[] = [];

    for (const r of results || []) {
      let alloc: Record<string, number> = {};
      if (r.target_allocations) {
        try {
          const parsed = JSON.parse(r.target_allocations);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            alloc = parsed;
          }
        } catch {
          // ignore
        }
      }
      const allocEntries = Object.entries(alloc).filter(([k, v]) => !k.startsWith("CASH_") && Number(v) > 0);
      if (allocEntries.length === 0) continue;

      // Normalize weights
      const rawSum = allocEntries.reduce((s, [, v]) => s + Number(v), 0);
      const normAlloc: Record<string, number> = {};
      let eqWeight = 0;
      let bondWeight = 0;
      let ilasCount = 0;
      let nonIlasCount = 0;
      let usSitusCount = 0;
      let nonUsNonIlasCount = 0;
      let ieLuEtfCount = 0;
      for (const [k, v] of allocEntries) {
        const w = rawSum > 1.001 ? Number(v) / rawSum : Number(v) / (rawSum || 1);
        normAlloc[k] = Math.round(w * 1000) / 10; // store %
        const meta = catalogLookup.get(k.toUpperCase());
        if (meta) {
          if (isIrelandOrLuxembourgEtf(meta)) ieLuEtfCount++;
          if (isIlasFund(meta)) {
            ilasCount++;
          } else {
            nonIlasCount++;
            if (getFundDomicile(meta) === "US") usSitusCount++;
            else nonUsNonIlasCount++;
          }
          const ac = meta.asset_class || "";
          if (ac.includes("固") || ac.includes("债") || ac.includes("货币")) bondWeight += w * 100;
          else eqWeight += w * 100;
        }
      }

      const nameLower = String(r.name || "").toLowerCase();
      const divStrat = String(r.dividend_strategy || "CASH").toUpperCase();
      const totalNav = r.total_nav != null ? Number(r.total_nav) : null;
      const totalDivs = r.total_divs != null ? Number(r.total_divs) : null;
      const annYield =
        totalNav && totalNav > 0 && totalDivs && totalDivs > 0
          ? Math.round((totalDivs / totalNav) * 10000) / 100
          : null;

      let score = 68;
      const fitReasons: string[] = [];
      const watchouts: string[] = [];

      // Currency fit
      if (String(r.base_currency || "USD").toUpperCase() === profile.currency) {
        score += 8;
        fitReasons.push(`计价币种 ${profile.currency} 与客户一致`);
      }

      // Dividend / Income alignment
      const isIncomeName =
        nameLower.includes("income") || nameLower.includes("高息") || nameLower.includes("分红") || nameLower.includes("dividend");
      if (envelope.income_focus) {
        if (divStrat === "CASH" || isIncomeName || (annYield ?? 0) >= 3) {
          score += 14;
          fitReasons.push(
            annYield != null && annYield > 0
              ? `现金派息机制（参考分红率 ${annYield.toFixed(1)}%）契合现金流需求`
              : "采用现金派息策略，适合定期提取或收息"
          );
        } else {
          score -= 6;
        }
      } else if (profile.primary_goal === "growth" && divStrat === "REINVEST") {
        score += 10;
        fitReasons.push("分红再投资机制利于长期复利滚存");
      }

      // Risk/sleeve alignment when catalog resolves holdings
      if (eqWeight + bondWeight > 20) {
        const diff = Math.abs(eqWeight - envelope.target_equity_pct);
        score += Math.max(-15, Math.round(14 - diff * 0.35));
        fitReasons.push(`股/债结构（约 ${Math.round(eqWeight)}% / ${Math.round(bondWeight)}%）接近目标配比`);
      } else if (envelope.risk_level === "conservative" && isIncomeName) {
        score += 6;
      }

      // Strict pure ILAS vs Non-ILAS vs HK Broker alignment
      const universeMode = resolveBasketUniverseMode(profile);
      if (universeMode === "ilas") {
        if (ilasCount > 0 && nonIlasCount === 0) {
          score += 10;
          fitReasons.push("纯血投连险（AIA）平台标的，架构完全匹配");
        } else if (nonIlasCount > 0 || ilasCount === 0) {
          score -= 18;
          watchouts.push("含平台外非投连险标的（与纯投连险架构隔离）");
        }
      } else if (universeMode === "hk_broker") {
        if (ieLuEtfCount > 0) {
          score -= 22;
          watchouts.push("含爱尔兰/卢森堡注册 ETF（大部分香港券商无法直接交易，建议改配互惠基金或美/港 ETF）");
        } else if (allocEntries.length > 0) {
          score += 8;
          fitReasons.push("全仓均不含爱尔兰/卢森堡 ETF，适配香港券商渠道");
        }
        if (hasUsEstateTaxConcern(profile)) {
          if (usSitusCount > 0) {
            score -= 20;
            watchouts.push("含美国本土注册 ETF（存在非美居民美股遗产税敞口，建议改配爱尔兰/卢森堡互惠基金）");
          } else if (nonUsNonIlasCount > 0 || (ieLuEtfCount === 0 && usSitusCount === 0)) {
            score += 12;
            fitReasons.push("采用非美税籍（互惠基金/港股等）结构，规避美股遗产税与渠道限制");
          }
        }
      } else {
        if (ilasCount > 0) {
          score -= 18;
          watchouts.push("含投连险平台标的（与纯非投连险架构隔离）");
        }
        if (profile.product_scope === "hk_broker_etf") {
          if (ieLuEtfCount > 0) {
            score -= 22;
            watchouts.push("含爱尔兰/卢森堡注册 ETF（香港券商无法直接买入，纯低费 ETF 方案已剔除）");
          } else if (allocEntries.length > 0 && ilasCount === 0) {
            score += 8;
            fitReasons.push("纯低费美/港/日 ETF 结构，剔除爱尔兰/卢森堡 ETF 与互惠基金");
          }
        } else if (hasUsEstateTaxConcern(profile)) {
          if (usSitusCount > 0) {
            score -= 20;
            watchouts.push("含美国本土注册 ETF（存在非美居民美股遗产税敞口，建议改配爱尔兰/卢森堡 UCITS 标的）");
          } else if (nonUsNonIlasCount > 0 && ilasCount === 0) {
            score += 12;
            fitReasons.push("采用非美税籍（爱尔兰/卢森堡/香港）注册标的，规避美股遗产税敞口");
          }
        }
      }

      if (allocEntries.length <= 2) {
        watchouts.push(`持仓仅 ${allocEntries.length} 只标的，集中度偏高，建议配合多资产分散`);
      }

      matches.push({
        id: Number(r.id),
        name: String(r.name),
        base_currency: String(r.base_currency || "USD").toUpperCase(),
        dividend_strategy: divStrat,
        match_score: Math.round(clamp(score, 35, 98)),
        fit_reasons: fitReasons.slice(0, 3),
        watchouts,
        allocations: normAlloc,
        stats: {
          total_nav: totalNav,
          total_return_pct: r.cumulative_roi != null ? Number(r.cumulative_roi) : null,
          annualized_return_pct: r.annualized_return != null ? Number(r.annualized_return) : null,
          annualized_yield_pct: annYield,
        },
      });
    }

    return matches.sort((a, b) => b.match_score - a.match_score).slice(0, 3);
  } catch {
    return [];
  }
}

export function classifyFundSleeve(row: QuantFundCatalogRow): "equity" | "bond" | "other" {
  const ac = (row.asset_class || "").toLowerCase();
  if (
    ac.includes("多元") ||
    ac.includes("混合") ||
    ac.includes("平衡") ||
    ac.includes("商品") ||
    ac.includes("黄金") ||
    ac.includes("multi") ||
    ac.includes("balanced") ||
    ac.includes("commodity") ||
    ac.includes("gold")
  ) {
    return "other";
  }
  if (
    ac.includes("固") ||
    ac.includes("债") ||
    ac.includes("货币") ||
    ac.includes("票据") ||
    ac.includes("bond") ||
    ac.includes("fixed") ||
    ac.includes("cash") ||
    ac.includes("treasury") ||
    ac.includes("t-bill")
  ) {
    return "bond";
  }
  if (ac.includes("股") || ac.includes("权益") || ac.includes("equity") || ac.includes("stock")) {
    return "equity";
  }
  const nm = (row.name || "").toLowerCase();
  if (
    nm.includes("bond") ||
    nm.includes("treasury") ||
    nm.includes("t-bill") ||
    nm.includes("fixed income") ||
    nm.includes("债") ||
    nm.includes("货币")
  ) {
    return "bond";
  }
  return "equity";
}

export type FundDomicile = "IE" | "LU" | "EU_UCITS" | "HK" | "CN" | "JP" | "US" | "OTHER";

const IE_UCITS_CODES = new Set([
  "IWDA",
  "IWVG",
  "IWVL",
  "JREG",
  "MXWO",
  "VHYA",
  "VHYD",
  "VHYL",
  "IB01",
  "IB0D",
  "IBTU",
  "IBTA",
  "IBTS",
  "IDBT",
  "CBU7",
  "CBU0",
  "IDTM",
  "DTLA",
  "IDTL",
  "VDTA",
  "VDTY",
  "LQDA",
  "LQDE",
  "AGGU",
  "IHYU",
  "UYLX",
  "I37MXN",
  "ID27",
  "IDTXX",
  "IMMXX",
  "VMSTX",
  "CSPX",
  "VUAA",
  "SPYL",
  "CNDX",
  "EQAC",
  "VWRA",
  "VWRD",
  "VUSD",
  "IUSA",
  "IDUS",
  "EQQQ",
  "EQQU",
  "IUIT",
]);

const LU_UCITS_CODES = new Set(["CSH2", "PRIP", "PURC", "UHYC", "YIEL"]);

export function getFundDomicile(row: Partial<QuantFundCatalogRow>): FundDomicile {
  const isin = String(row.isin || "").trim().toUpperCase();
  if (isin.startsWith("IE")) return "IE";
  if (isin.startsWith("LU")) return "LU";
  if (/^(FR|DE|GB|NL|CH|AT|IT|ES)/.test(isin)) return "EU_UCITS";
  if (isin.startsWith("HK")) return "HK";
  if (isin.startsWith("CN")) return "CN";
  if (isin.startsWith("JP")) return "JP";
  if (isin.startsWith("US")) return "US";
  if (isin.length >= 2) return "OTHER";

  const yt = String(row.yahoo_ticker || "").trim().toUpperCase();
  const code = String(row.code || "").trim().toUpperCase();
  const name = String(row.name || "");
  const plat = String(row.ilas_platform || "");

  // USHY is a US NYSE Arca iShares ETF unless explicitly suffixed with a European exchange
  if ((yt === "USHY" || code === "USHY") && !/\.(L|DE|PA|AS|MI|SW|F|MU|LU)$/.test(yt)) {
    return "US";
  }

  if (
    IE_UCITS_CODES.has(code) ||
    /\(ireland\)|\bicav\b/i.test(name) ||
    (/\bucits\b/i.test(name) && /\b(ishares|vanguard|invesco|spdr|jpmorgan)\b/i.test(name))
  ) {
    return "IE";
  }
  if (
    LU_UCITS_CODES.has(code) ||
    /luxembourg|\bsicav\b/i.test(name) ||
    (/\bucits\b/i.test(name) && /\b(amundi|lyxor|xtrackers|dws)\b/i.test(name))
  ) {
    return "LU";
  }
  if (/\.(L|DE|PA|AS|MI|SW|F|MU|LU)$/.test(yt) || /\bucits\b/i.test(name)) {
    return "EU_UCITS";
  }
  if (row.cn_code || /A股|中国分红|中国QDII|港股通/.test(plat)) {
    return "CN";
  }
  if (yt.endsWith(".HK") || code.endsWith(".HK")) {
    return "HK";
  }
  if (yt.endsWith(".T")) {
    return "JP";
  }
  if (!isIlasFund(row)) {
    return "US";
  }
  return "OTHER";
}

export function isIrelandOrLuxembourgFund(row: Partial<QuantFundCatalogRow>): boolean {
  const dom = getFundDomicile(row);
  return dom === "IE" || dom === "LU" || dom === "EU_UCITS";
}

export function isIrelandOrLuxembourgEtf(row: Partial<QuantFundCatalogRow>): boolean {
  const code = String(row.code || "").trim().toUpperCase();
  const yt = String(row.yahoo_ticker || "").trim().toUpperCase();
  const name = String(row.name || "");

  if (IE_UCITS_CODES.has(code) || LU_UCITS_CODES.has(code)) {
    return true;
  }
  if (/\bucits\b/i.test(name) && /\b(etf|etp|etc|icav)\b/i.test(name)) {
    return true;
  }
  if (isIrelandOrLuxembourgFund(row)) {
    if (/\b(etf|etp|etc|icav)\b/i.test(name) || /exchange[\s-]*traded/i.test(name)) {
      return true;
    }
    if (/\.(L|DE|PA|AS|MI|SW|F|MU|LU|MX)$/i.test(yt)) {
      return true;
    }
  }
  return false;
}

export function isHkBrokerEligibleFund(row: Partial<QuantFundCatalogRow>): boolean {
  if (isIrelandOrLuxembourgEtf(row)) return false;
  if (!isIlasFund(row)) return true;
  const isin = String(row.isin || "").trim().toUpperCase();
  return /^(LU|IE|HK|GB|SG|AU)[A-Z0-9]{10}$/.test(isin);
}

export function isUsMutualFund(row: Partial<QuantFundCatalogRow>): boolean {
  const clean = String(row.yahoo_ticker || row.code || "").trim().toUpperCase();
  if (!clean || clean.includes(".")) return false;
  return /^[A-Z]{4}X$/.test(clean);
}

const HK_BROKER_LOW_FEE_ETF_PLATFORMS = new Set([
  "非投连险-美股分红型ETF",
  "非投连险-国际股票",
  "非投连险-分红型基金",
  "非投连险-日本宽基ETF",
  "非投连险-债券基金比较",
  "非投连险-货币基金",
]);

export function isHkBrokerLowFeeEtf(row: Partial<QuantFundCatalogRow>): boolean {
  if (isIlasFund(row)) return false;
  if (isIrelandOrLuxembourgEtf(row) || isIrelandOrLuxembourgFund(row)) return false;
  if (isUsMutualFund(row)) return false;
  return HK_BROKER_LOW_FEE_ETF_PLATFORMS.has(row.ilas_platform || "");
}

export function isEuropeanCategoryFund(row: Partial<QuantFundCatalogRow>): boolean {
  if (!isIlasFund(row) && isIrelandOrLuxembourgFund(row)) return true;
  if (Array.isArray(row.tags) && row.tags.some((t) => /欧洲|UCITS|爱尔兰|卢森堡/i.test(t))) return true;
  return /欧洲|europe/i.test(row.name || "");
}

export function hasUsEstateTaxConcern(profile?: Partial<ClientAdvisoryProfile> | null): boolean {
  if (!profile) return false;
  if (profile.product_scope === "eu_ucits") return true;
  const text = `${profile.extra_notes || ""} ${profile.notes || ""}`.toLowerCase();
  return /遗产税|继承税|美股税|6万.*免税|60,?000|us[\s-]*situs|u\.s\.[\s-]*situs|estate\s*tax|inheritance\s*tax|爱尔兰(基金|etf|籍|注册|ucits)?|卢森堡(基金|etf|sicav|籍|注册|ucits)?|欧洲基金|欧基|\bucits\b/i.test(
    text
  );
}

export function isIlasFund(row: { ilas_platform?: string | null; aia_code?: string | null }): boolean {
  const plat = (row.ilas_platform || "").trim();
  if (!plat) return Boolean(row.aia_code && row.aia_code.trim());
  if (plat.startsWith("非投连险")) return false;
  return (
    plat.startsWith("AIA") ||
    plat.includes("投连险") ||
    plat.toUpperCase().includes("ILAS") ||
    plat.toUpperCase().includes("ILP")
  );
}

export function resolveBasketUniverseMode(
  profile: Partial<ClientAdvisoryProfile>,
  currentHoldings?: Array<{
    ilas_platform?: string | null;
    aia_code?: string | null;
    slug?: string;
    lab_id?: string;
    code?: string;
  }>,
  catalogRows?: QuantFundCatalogRow[]
): "ilas" | "non_ilas" | "hk_broker" {
  if (profile.product_scope === "hk_broker") {
    return "hk_broker";
  }
  if (Array.isArray(currentHoldings) && currentHoldings.length > 0) {
    const catalogByKey = new Map<string, QuantFundCatalogRow>();
    for (const r of catalogRows || []) {
      [r.slug, r.code, r.aia_code]
        .filter(Boolean)
        .forEach((k) => catalogByKey.set(String(k).toUpperCase().trim(), r));
    }
    let resolvedCount = 0;
    let anyIlas = false;
    for (const h of currentHoldings) {
      const matched = [h.slug, h.lab_id, h.code]
        .filter(Boolean)
        .map((k) => catalogByKey.get(String(k).toUpperCase().trim()))
        .find(Boolean);
      if (matched) {
        resolvedCount++;
        if (isIlasFund(matched)) anyIlas = true;
      } else if (h.ilas_platform != null || h.aia_code != null) {
        resolvedCount++;
        if (isIlasFund(h)) anyIlas = true;
      }
    }
    if (resolvedCount > 0) {
      return anyIlas ? "ilas" : "non_ilas";
    }
  }

  const scope = profile.product_scope || "all";
  if (scope === "aia_tmp2") return "ilas";
  if (scope === "hk_broker_etf" || scope === "eu_ucits" || scope === "global_etf" || scope === "cn_hk_dividend" || scope === "non_ilas") {
    return "non_ilas";
  }
  return profile.ilp_planned ? "ilas" : "non_ilas";
}

function matchesProductScope(row: QuantFundCatalogRow, scope: ProductScope): boolean {
  const plat = row.ilas_platform || "";
  if (scope === "aia_tmp2") return isIlasFund(row);
  if (scope === "hk_broker") return isHkBrokerEligibleFund(row);
  if (scope === "hk_broker_etf") return isHkBrokerLowFeeEtf(row);
  if (scope === "non_ilas") return !isIlasFund(row);
  if (scope === "eu_ucits") return !isIlasFund(row) && isIrelandOrLuxembourgFund(row);
  if (scope === "global_etf") {
    return [
      "非投连险-美股分红型ETF",
      "非投连险-国际股票",
      "非投连险-分红型基金",
      "非投连险-日本宽基ETF",
      "非投连险-债券基金比较",
    ].includes(plat);
  }
  if (scope === "cn_hk_dividend") {
    return [
      "非投连险-中国分红",
      "非投连险-港股通ETF",
      "非投连险-A股价值型",
      "非投连险-中国QDII",
      "非投连险-货币基金",
    ].includes(plat);
  }
  if (scope === "bonds_income") {
    return classifyFundSleeve(row) === "bond" || row.is_distributing;
  }
  return true;
}

const CORE_FUND_CODES = new Set([
  // Broad Global / Developed / US Market-Cap Core Equities
  "SPY", "VOO", "IVV", "VTI", "VT", "ACWI",
  "CSPX", "VUAA", "SPYL", "VUSD", "IUSA", "IDUS",
  "IWDA", "VWRA", "VWRD", "MXWO", "JREG", "IXUS",
  "A22", "M01", "CG1",
  // Broad Global / Developed / US Dividend & Equity-Income Core Equities
  "VHYA", "VHYD", "VHYL", "VYMI", "VIGI",
  "SCHD", "VYM", "VIG", "HDV", "SPYD", "DGRO", "NOBL", "DVY", "SDY",
  "I17", "Z17", "Z37", "J16", "R51", "Z51",
  // Broad Sovereign / IG Aggregate / 100% IG Corporate / Short IG / Money Market
  "AGG", "BND", "BNDX", "SCHZ", "SPAB", "IUSB", "FBND", "AGGU",
  "VDTA", "VDTY", "CBU7", "CBU0", "IDTM", "IEF",
  "LQDA", "LQDE", "PURC", "PRIP", "VCIT", "IGSB", "SCHJ", "VSCSX",
  "BIL", "SGOV", "IB01", "IB0D", "IBTU", "IBTA", "IBTS", "IDBT", "CSH2",
  "SCHO", "SPTS", "BSV", "VBIRX", "VSBSX", "VSGBX", "VUSB", "JPST", "MINT", "EMNT",
  "BUBIX", "BSBSX", "FSHBX", "FJRLX", "FLTB", "PAIAX", "PSHAX", "TSDUX", "BOXX",
  "VTIP", "SCHP", "9096.HK",
  "B01", "M11", "M13", "N08", "CG9", "Z29", "Z39", "W06", "Z36", "Z66", "E05", "W04", "A05",
  // Broad Core Balanced / Allocation (60/40, 80/20, 30/70, Target Date Index)
  "AOA", "AOR", "AOK", "IRTR", "ITDB", "ITDC", "ITDD", "ITDE", "ITDF", "ITDG", "ITDH", "ITDI", "ITDJ",
  "R03", "Z33",
]);

const HARD_SATELLITE_CODES = new Set([
  // High-Yield / Sub-IG / Opportunistic / Flexible / Convertible / Preferred / CEF
  "F16", "Z12", "Z32",
  "G16", "Z16", "Z26", "I28", "M10", "Z13", "P08", "Z08", "R52", "Z52", "U06", "ZU6", "X15", "Z15", "Z25",
  "C03", "C09", "Z69", "J07", "NB1", "Z05", "I27", "L51", "ZL1", "Q02", "Y02", "Y22", "Z11", "Z22",
  "N01", "PC4", "ZP4",
  "P07", "Z07", "Z27", "D18", "Z18", "Z28", "J20", "Z20", "Z30", "W07", "Z77", "A32", "Z06", "V07",
  "A15", "GG", "I23", "N06", "N07", "L52",
  "V02", "Z01", "Z21", "F15", "Z04", "Z24", "Q01",
  "HYG", "HYGH", "JNK", "SJNK", "SCYB", "USHY", "UHYC", "YIEL", "IHYU", "NEMD",
  "TFLR", "HFSI", "JFLX", "JPIE", "PSDM", "SDMZX", "BRTR", "FPNIX", "JCPB", "UYLX",
  "BINC", "BTZ", "EFR", "FLC", "JPC", "PCN", "PTY", "VTEB",
  "DIVO", "IDVO", "BDJ", "DNP", "UTF", "JEPI", "JEPQ", "R01", "Z31",
  "DTLA", "IDTL", "TLT", "EDV",
  "I37MXN", "ID27", "IDTXX", "IMMXX", "VMSTX",
  "IWVL", "IWVG", "EFV", "IQLT", "MOAT",
  "CNDX", "EQAC", "EQQQ", "EQQU", "IUIT", "QQQ",
]);

const UCITS_SHARE_TWINS: Record<string, string> = {
  VHYD: "VHYA",
  VHYA: "VHYD",
  CSPX: "IUSA",
  IUSA: "CSPX",
  VUAA: "VUSD",
  VUSD: "VUAA",
  VWRA: "VWRD",
  VWRD: "VWRA",
  EQAC: "EQQQ",
  EQQQ: "EQAC",
  IB01: "IB0D",
  IB0D: "IB01",
  IBTA: "IBTS",
  IBTS: "IBTA",
  CBU0: "IDTM",
  IDTM: "CBU0",
  DTLA: "IDTL",
  IDTL: "DTLA",
  VDTA: "VDTY",
  VDTY: "VDTA",
  LQDA: "LQDE",
  LQDE: "LQDA",
  IWVL: "IWVG",
  IWVG: "IWVL",
  PRIP: "PURC",
  PURC: "PRIP",
};

/**
 * 依据《机构级核心—卫星配置标准》严格划分「核心 (广泛高质量 Beta 压舱)」与「卫星 (高收益/新兴市场/单一国别/主题因子)」：
 * 高收益债、新兴市场、亚洲/中国/日本等单一区域、可转债/优先证券及行业红利主题资产一律强制归入卫星，优先覆盖任何历史标签。
 */
export function inferFundRole(row: QuantFundCatalogRow): "core" | "satellite" {
  const codeUp = (row.aia_code || row.code || "").trim().toUpperCase();
  const codeBase = codeUp.replace(/\.[A-Z]+$/, "");
  const text = `${row.name || ""} ${row.name_en || ""} ${row.ilas_platform || ""}`;

  // 1. Hard Satellite Disqualifiers (ALWAYS override legacy row.role)
  if (
    HARD_SATELLITE_CODES.has(codeUp) ||
    HARD_SATELLITE_CODES.has(codeBase) ||
    String(row.currency || "").toUpperCase() === "MXN" ||
    String(row.benchmark_code || "").toUpperCase() === "HYG"
  ) {
    return "satellite";
  }

  const isSatelliteKeyword =
    /高收益|備兌|备兑|新兴|新興|亚洲|亞洲|亚太|亞太|太平洋|东盟|印度|南韓|韩国|台灣|台湾|拉丁美洲|巴西|東歐|东欧|澳洲|中國|中国|神州|大中華|大中华|港股|A股|沪深|中证|恒生|日本|歐洲.*股票|欧洲.*股票|歐洲遠見|歐洲動態|科技|纳斯达克|生物|醫療|医疗|健康|能源|環境|礦業|黃金|貴金屬|資源|消費|品牌|房地產|基建|可轉換|可转换|優先證券|优先证券|coco|小型|中小|20\+yr|20\+年|超长期|焦點|焦点|機會基金|優勢基金|high\s*yield|hi\s*yld|\bhy\b|covered\s*call|enhanced\s*dividend|superdividend|emerging|\bem\b|asian|asia|china|chinese|greater\s*china|taiwan|korea|india|asean|latin|brazil|japan|nikkei|topix|convertible|preferred|floating\s*rate|flexible|strategic\s*income|credit\s*allocation|multi-sector|yield\s*plus|nasdaq|technology|biotech|health|energy|gold|mining|resources|real\s*estate|reit|infrastructure|thematic|small[\s-]*cap|value\s*factor|basic\s*value|moat|mxn\s*hedged|tax-exempt/i.test(
      text
    );
  if (isSatelliteKeyword) return "satellite";

  const isCash = row.asset_class === "货币基金" || /money\s*market|货币|現金|现金/i.test(text);
  if (!isCash && /香港|hong\s*kong/i.test(text)) {
    return "satellite";
  }

  // 2. Broad High-Quality Core Whitelist & Safe Core Keywords
  if (CORE_FUND_CODES.has(codeUp) || CORE_FUND_CODES.has(codeBase)) return "core";

  const rawRole = (row.role || "").trim();
  if (rawRole === "核心") return "core";
  if (rawRole === "卫星") return "satellite";

  const isCoreKeyword =
    /全球综合债|环球债券|全球公司债|标普\s*500|全世界|全市场|短期国债|短期美债|美元短期债|极短期债|货币市场|美元现金|美股分红型ETF|美国红利|美国高股息|全球高股息|环球股票高息|环球收益股票|high\s*dividend\s*yield|dividend\s*appreciation|dividend\s*equity|s&p\s*500|ftse\s*all-world|msci\s*world|total\s*world|total\s*intl|total\s*stock|total\s*bond|aggregate\s*bond|treasury\s*bond|short[- ]term\s*(bond|treasury|corporate)|ultra[- ]short|money\s*market/i.test(
      text
    );
  if (isCoreKeyword) return "core";

  return "satellite";
}

const ADMIN_CORE_ROLE_REASONS = new Set(["核心美国", "核心全球", "核心固收"]);
const ADMIN_SAT_ROLE_REASONS = new Set(["卫星行业", "卫星国家", "抗通胀避险"]);

/**
 * 若管理员在核心推荐中显式打标了「核心*」或「卫星* / 抗通胀避险」理由，则优先据此决定核心/卫星角色；
 * 否则回退至机构级核心—卫星准则 inferFundRole。
 */
export function resolveEffectiveFundRole(row: QuantFundCatalogRow): "core" | "satellite" {
  if (row.is_admin_core_pick && Array.isArray(row.admin_core_reasons) && row.admin_core_reasons.length > 0) {
    const hasCoreTag = row.admin_core_reasons.some((r) => ADMIN_CORE_ROLE_REASONS.has(r));
    const hasSatTag = row.admin_core_reasons.some((r) => ADMIN_SAT_ROLE_REASONS.has(r));
    if (hasSatTag && !hasCoreTag) return "satellite";
    if (hasCoreTag) return "core";
  }
  return inferFundRole(row);
}

/**
 * 识别基金的细分子赛道（底层资产同质性集群），防止选入底层高度相似的重复标的。
 */
export function getFundHomogeneityCluster(row: QuantFundCatalogRow): string {
  const sleeve = classifyFundSleeve(row);
  const text = `${row.code || ""} ${row.aia_code || ""} ${row.name || ""} ${row.name_en || ""} ${row.ilas_platform || ""} ${row.benchmark_code || ""}`.toLowerCase();

  if (sleeve === "other") {
    if (/黄金|gold|gld|iau|商品|commodity|dbc|原油|油/i.test(text)) return "other|GOLD_COMMODITY";
    if (/reit|vnq|地产|房产/i.test(text)) return "other|REIT";
    return "other|MULTI_ASSET";
  }

  if (sleeve === "bond") {
    if (
      row.benchmark_code === "BIL" ||
      /货币|现金|t-bill|国库券|短债|短期债|极短期|0-1yr|1-3yr|short|ultra|bil|sgov|shy|bsv|csh2|ib01|ib0d|ibtu|ibta|ibts|idbt|boxx|m13|b01|w06/i.test(
        text
      )
    ) {
      return "bond|SHORT_CASH";
    }
    if (/优先|preferred|pc4|zp4/i.test(text)) return "bond|PREFERRED";
    if (/新兴|emerging|亚洲债|asian.*bond|中国债|china.*bond|c03|c09|z69|j07|i27|z22/i.test(text)) {
      return "bond|EM_ASIA_BOND";
    }
    if (
      row.benchmark_code === "HYG" ||
      /高收益|high yield|hyg|ihyu|i28|g16|m10|z08|credit allocation/i.test(text)
    ) {
      return "bond|HY_CREDIT";
    }
    if (/超长期|长期|20\+y|20y|tlt|dtla|idtl|long treasury/i.test(text)) return "bond|LONG_TREASURY";
    return "bond|IG_CORE";
  }

  // sleeve === "equity"
  if (/科技|nasdaq|qqq|eqqq|eqac|cndx|iuit|生物|医疗|医药|半导体|biotech|tech|health|semiconductor|d05/i.test(text)) {
    return "equity|SECTOR_THEME";
  }
  if (/日本|japan|1306|topix|nikkei/i.test(text)) return "equity|JAPAN";
  if (
    row.benchmark_code === "2800.HK" ||
    row.benchmark_code === "sh510300" ||
    /中国|港股|恒生|hsi|沪深|中证|a股|大中华|china|hk|a17|z01|v02|51\d{4}|159\d{3}|2800/i.test(
      text
    )
  ) {
    return "equity|HK_CN";
  }
  if (/新兴|亚洲|亚太|emerging|asia|vwo|eimi/i.test(text)) return "equity|EM_ASIA";
  if (/红利|股息|价值|schd|vym|vig|dgro|hdv|jepi|jepq|divo|dividend|value/i.test(text)) {
    return /美|us|schd|vym|vig|dgro|hdv|jepi|jepq|divo/i.test(text)
      ? "equity|US_DIV_VALUE"
      : "equity|GLOBAL_DIV_VALUE";
  }
  if (/美股|标普|美国|s&p|spy|voo|vti|cspx|vuaa|spyl|vusd|iusa|russell/i.test(text)) return "equity|US_BROAD";
  if (/收益|高息|派息|income|covered|备兑/i.test(text)) return "equity|GLOBAL_INCOME";
  if (row.benchmark_code === "SPY") return "equity|US_BROAD";
  return "equity|GLOBAL_BROAD";
}

/**
 * 基于前十大持仓指纹识别底层资产真实重合度。
 */
export function computeHoldingsOverlap(
  a: QuantFundCatalogRow,
  b: QuantFundCatalogRow
): { jaccard: number; sharedCount: number; isHighOverlap: boolean } {
  const keysA = a.top_holding_keys || [];
  const keysB = b.top_holding_keys || [];
  if (keysA.length < 4 || keysB.length < 4) {
    return { jaccard: 0, sharedCount: 0, isHighOverlap: false };
  }
  const setA = new Set(keysA);
  const setB = new Set(keysB);
  let sharedCount = 0;
  for (const k of setA) {
    if (setB.has(k)) sharedCount++;
  }
  const unionSize = setA.size + setB.size - sharedCount;
  const jaccard = unionSize > 0 ? sharedCount / unionSize : 0;
  return {
    jaccard,
    sharedCount,
    isHighOverlap: jaccard >= 0.35 || sharedCount >= 4,
  };
}

/**
 * 同质基金优胜劣汰打分（用户准则）：
 * 1) 优先选择费率最低 + 显著正向 Alpha（扣费后净 Alpha > 0.5%）最高的基金；
 * 2) 若无显著正向 Alpha（被动指数或 Alpha <= 0），则选择与基准指数最贴合（高 R²、Beta 近 1.0）且费率最低的基金。
 */
export function computeHomogeneousQualityScore(row: QuantFundCatalogRow): number {
  const fee = row.fee_pct != null ? row.fee_pct : 0.65;
  const alphaPct = row.alpha_3y != null ? row.alpha_3y * 100 : null;
  const netAlphaPct = alphaPct != null ? alphaPct - fee : null;
  const tierBonus = row.data_tier === "A" ? 4 : row.data_tier === "B" ? 2 : 0;

  if (alphaPct != null && alphaPct > 0.2 && netAlphaPct != null && netAlphaPct > 0.5) {
    return 70 + clamp(netAlphaPct * 8, 0, 45) - clamp(fee * 3, 0, 12) + tierBonus;
  }

  const r2 = row.r2_3y != null ? clamp(row.r2_3y, 0, 1) : 0.5;
  const betaDiff = row.beta_3y != null ? Math.abs(row.beta_3y - 1.0) : 0.25;
  return 40 + r2 * 35 - clamp(betaDiff * 14, 0, 20) - clamp(fee * 14, 0, 30) + tierBonus;
}

export function compareHomogeneousFunds(a: QuantFundCatalogRow, b: QuantFundCatalogRow): number {
  const adminDiff = Number(Boolean(b.is_admin_core_pick)) - Number(Boolean(a.is_admin_core_pick));
  if (adminDiff !== 0) return adminDiff;
  const diff = computeHomogeneousQualityScore(b) - computeHomogeneousQualityScore(a);
  if (Math.abs(diff) > 1e-6) return diff;
  const feeA = a.fee_pct ?? 0.65;
  const feeB = b.fee_pct ?? 0.65;
  if (Math.abs(feeA - feeB) > 1e-6) return feeA - feeB;
  return (b.quant_score ?? 50) - (a.quant_score ?? 50);
}

function scoreFundCandidate(
  row: QuantFundCatalogRow,
  envelope: TargetEnvelope,
  mode: "core" | "income_boost" | "defensive",
  preferredCurrency: string
): number {
  let score = row.quant_score != null ? row.quant_score : 52;

  // Prefer live/backtested series coverage so Strategy Lab simulation succeeds immediately
  if (row.data_tier === "A") score += 16;
  else if (row.data_tier === "B") score += 12;
  else if (row.data_tier === "C") score += 4;

  // Admin Core Pick strong priority boost + reason alignment bonus
  const wantIncome = mode === "income_boost" || (mode === "core" && envelope.income_focus);
  if (row.is_admin_core_pick) {
    score += 65;
    const reasons = Array.isArray(row.admin_core_reasons) ? row.admin_core_reasons : [];
    if (mode === "defensive" && (reasons.includes("低波动增强") || reasons.includes("核心固收"))) {
      score += 12;
    }
    if (wantIncome && reasons.includes("高股息现金流")) {
      score += 12;
    }
    if (mode === "core" && (reasons.includes("核心美国") || reasons.includes("核心全球") || reasons.includes("核心固收"))) {
      score += 8;
    }
  }

  // Sharpe, Alpha/R2/Fee quality & Morningstar bonuses
  if (row.sharpe_3y != null) score += clamp(row.sharpe_3y * 8, -10, 14);
  if (row.morningstar_stars != null) score += (row.morningstar_stars - 3) * 3;
  if (row.tags.includes("推荐选择")) score += 6;
  score += clamp((computeHomogeneousQualityScore(row) - 55) * 0.35, -12, 18);

  // Currency convenience slight bonus; strongly penalize exotic MXN-hedged UCITS shares for non-MXN clients
  if (row.currency === preferredCurrency) score += 2.5;
  if (row.currency === "MXN" && preferredCurrency !== "MXN") score -= 35;

  // Income tilt
  if (wantIncome) {
    if (row.is_distributing) score += 10;
    if (row.div_yield_ttm != null && row.div_yield_ttm > 0) {
      score += clamp(row.div_yield_ttm * 160, 0, 14);
    }
  }

  // Defensive mode penalizes heavy volatility/drawdown
  if (mode === "defensive") {
    if (row.vol_3y != null) score -= row.vol_3y * 55;
    if (row.max_dd_3y != null) score -= Math.abs(row.max_dd_3y) * 28;
  } else if (row.vol_3y != null && row.vol_3y * 100 > envelope.max_vol_pct * 1.25) {
    score -= 8;
  }

  // Lower fee rewarded (Obsidian A6: cost is the only certain return)
  if (row.fee_pct != null) {
    score -= clamp(row.fee_pct * 4.0, 0, 10);
  }

  return score;
}

function allocateBucketWeights(pickedRows: QuantFundCatalogRow[], bucketTotalWeight: number): number[] {
  if (pickedRows.length === 0) return [];
  if (pickedRows.length === 1) return [bucketTotalWeight];
  const factors = pickedRows.map((r) => (r.is_admin_core_pick ? 1.65 : 1.0));
  const factorSum = factors.reduce((s, f) => s + f, 0) || pickedRows.length;
  return factors.map((f) => (bucketTotalWeight * f) / factorSum);
}

function normalizeBasketWeights(
  holdings: CustomBasketHolding[],
  opts: {
    minWeightPct?: number;
    maxWeightPct?: number;
    maxSatelliteTotalPct?: number;
  } = {}
): CustomBasketHolding[] {
  if (holdings.length === 0) return [];
  const n = holdings.length;
  const minW = Math.min(opts.minWeightPct ?? 5, Math.floor(100 / n));
  const step = minW >= 10 ? 5 : 5;
  // Ensure feasible upper bound when n is small (e.g. 3 holdings can't sum to 100 if max=35)
  const feasibleMax = Math.max(opts.maxWeightPct ?? 35, Math.ceil(100 / n / step) * step);
  const holdingMax = (h: CustomBasketHolding) =>
    h.is_admin_core_pick && h.core_role === "core" ? Math.max(45, feasibleMax) : feasibleMax;
  const satCap = opts.maxSatelliteTotalPct ?? 30;

  const rawTotal = holdings.reduce((s, h) => s + Math.max(0, h.weight_pct), 0) || 100;
  const weights = holdings.map((h) => {
    const scaled = (Math.max(0, h.weight_pct) / rawTotal) * 100;
    const snapped = Math.round(scaled / step) * step;
    return clamp(snapped, minW, holdingMax(h));
  });

  // Enforce Core-Satellite rule: total satellite weight <= satCap (excess flows to core)
  const coreIdx = holdings
    .map((h, i) => (h.core_role === "core" ? i : -1))
    .filter((i) => i >= 0);
  const satIdx = holdings
    .map((h, i) => (h.core_role === "satellite" ? i : -1))
    .filter((i) => i >= 0);

  if (coreIdx.length > 0 && satIdx.length > 0) {
    let satSum = satIdx.reduce((s, i) => s + weights[i], 0);
    while (satSum > satCap) {
      // Find largest satellite above minW (reducing non-admin picks first), then shift step to admin core pick first
      const decTarget = satIdx
        .filter((i) => weights[i] - step >= minW)
        .sort(
          (a, b) =>
            Number(Boolean(holdings[a].is_admin_core_pick)) -
              Number(Boolean(holdings[b].is_admin_core_pick)) || weights[b] - weights[a]
        )[0];
      const incTarget = coreIdx
        .filter((i) => weights[i] + step <= holdingMax(holdings[i]))
        .sort(
          (a, b) =>
            Number(Boolean(holdings[b].is_admin_core_pick)) -
              Number(Boolean(holdings[a].is_admin_core_pick)) || weights[a] - weights[b]
        )[0];
      if (decTarget == null || incTarget == null) break;
      weights[decTarget] -= step;
      weights[incTarget] += step;
      satSum -= step;
    }
  }

  // Reconcile sum === 100 in 5% (or 1%) steps while respecting bounds and satellite cap
  let diff = 100 - weights.reduce((s, w) => s + w, 0);
  let guard = 0;
  while (diff !== 0 && guard < 100) {
    guard++;
    const delta = diff > 0 ? Math.min(step, diff) : -Math.min(step, -diff);
    const satSumNow = satIdx.reduce((s, i) => s + weights[i], 0);
    const candidates = holdings
      .map((_, i) => i)
      .filter((i) => {
        const next = weights[i] + delta;
        if (next < minW || next > holdingMax(holdings[i])) return false;
        if (
          delta > 0 &&
          holdings[i].core_role === "satellite" &&
          coreIdx.length > 0 &&
          satSumNow + delta > satCap
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (delta > 0) {
          // Prefer boosting core first, then admin core picks
          if (holdings[a].core_role !== holdings[b].core_role) {
            return holdings[a].core_role === "core" ? -1 : 1;
          }
          const adminDiff =
            Number(Boolean(holdings[b].is_admin_core_pick)) -
            Number(Boolean(holdings[a].is_admin_core_pick));
          if (adminDiff !== 0) return adminDiff;
          return weights[a] - weights[b];
        }
        // Prefer trimming non-admin picks first
        const adminDiff =
          Number(Boolean(holdings[a].is_admin_core_pick)) -
          Number(Boolean(holdings[b].is_admin_core_pick));
        if (adminDiff !== 0) return adminDiff;
        return weights[b] - weights[a];
      });

    if (candidates.length === 0) {
      // Final fallback without feasibleMax cap so total strictly equals 100
      const fallbackIdx = coreIdx[0] ?? 0;
      weights[fallbackIdx] = Math.max(minW, weights[fallbackIdx] + diff);
      break;
    }
    weights[candidates[0]] += delta;
    diff -= delta;
  }

  return holdings.map((h, i) => ({ ...h, weight_pct: weights[i] }));
}

function buildFundRationale(
  row: QuantFundCatalogRow,
  sleeve: "equity" | "bond" | "other",
  coreRole: "core" | "satellite",
  wantIncome: boolean
) {
  const partsZh: string[] = [];
  const partsEn: string[] = [];

  if (row.is_admin_core_pick) {
    const reasons = Array.isArray(row.admin_core_reasons) ? row.admin_core_reasons : [];
    partsZh.push(reasons.length > 0 ? `⭐ 管理员核心推荐(${reasons.join("/")})` : "⭐ 管理员核心推荐");
    partsEn.push(reasons.length > 0 ? `⭐ Admin Core Pick (${reasons.join("/")})` : "⭐ Admin Core Pick");
  }

  partsZh.push(coreRole === "core" ? "核心仓(Beta)" : "卫星仓(Alpha/分散)");
  partsEn.push(coreRole === "core" ? "Core (Beta)" : "Satellite (Alpha/Diversifier)");

  if (sleeve === "bond") {
    partsZh.push("压舱固收");
    partsEn.push("Fixed income");
  } else if (sleeve === "other") {
    partsZh.push("多元分散");
    partsEn.push("Multi-asset");
  } else {
    partsZh.push("权益增长");
    partsEn.push("Equity");
  }

  if (!isIlasFund(row)) {
    const dom = getFundDomicile(row);
    if (dom === "IE") {
      partsZh.push("爱尔兰UCITS(免美遗产税)");
      partsEn.push("IE UCITS (Estate-Tax Exempt)");
    } else if (dom === "LU") {
      partsZh.push("卢森堡UCITS(免美遗产税)");
      partsEn.push("LU UCITS (Estate-Tax Exempt)");
    } else if (dom === "EU_UCITS") {
      partsZh.push("欧洲UCITS(免美遗产税)");
      partsEn.push("EU UCITS (Estate-Tax Exempt)");
    }
  }

  const fee = row.fee_pct;
  const alphaPct = row.alpha_3y != null ? row.alpha_3y * 100 : null;
  if (alphaPct != null && alphaPct > 0.2 && (fee == null || alphaPct - fee > 0.5)) {
    partsZh.push(`超额 α +${alphaPct.toFixed(1)}%`);
    partsEn.push(`Alpha +${alphaPct.toFixed(1)}%`);
  } else if (row.r2_3y != null && row.r2_3y >= 0.85) {
    partsZh.push(`高贴合 R²=${row.r2_3y.toFixed(2)}`);
    partsEn.push(`Index fit R²=${row.r2_3y.toFixed(2)}`);
  }

  if (fee != null) {
    partsZh.push(`费率 ${fee.toFixed(2)}%`);
    partsEn.push(`TER ${fee.toFixed(2)}%`);
  }
  if (row.quant_grade) {
    partsZh.push(`量化 ${row.quant_grade} 级`);
    partsEn.push(`Quant ${row.quant_grade}`);
  }
  if (row.sharpe_3y != null) {
    partsZh.push(`夏普 ${row.sharpe_3y.toFixed(2)}`);
    partsEn.push(`Sharpe ${row.sharpe_3y.toFixed(2)}`);
  }
  if (wantIncome && row.is_distributing) {
    const yStr = row.div_yield_ttm != null ? `(${(row.div_yield_ttm * 100).toFixed(1)}%)` : "";
    partsZh.push(`派息${yStr}`);
    partsEn.push(`Dist${yStr}`);
  }

  return {
    zh: partsZh.join(" · "),
    en: partsEn.join(" · "),
  };
}

// Helper for TypeScript without adding unused property onto CustomBasketHolding
type InternalHolding = CustomBasketHolding & { max_dd_3y: number | null };

function computeMetricsSafe(holdings: InternalHolding[]) {
  const wAvg = (fn: (h: InternalHolding) => number | null): number | null => {
    let w = 0;
    let s = 0;
    for (const h of holdings) {
      const v = fn(h);
      if (v != null && Number.isFinite(v)) {
        s += v * h.weight_pct;
        w += h.weight_pct;
      }
    }
    return w >= 20 ? s / w : null;
  };
  const cagr = wAvg((h) => h.ret_3y_ann);
  const rawVol = wAvg((h) => h.vol_3y);
  const divFactor = holdings.length >= 4 ? 0.86 : holdings.length >= 3 ? 0.91 : 1.0;
  const estVol = rawVol != null ? rawVol * divFactor : null;
  const estSharpe =
    cagr != null && estVol != null && estVol > 0 ? (cagr - 0.03) / estVol : wAvg((h) => h.sharpe_3y);
  const estMaxDd = wAvg((h) => h.max_dd_3y);
  const divYield = wAvg((h) => (h.div_yield_ttm != null ? h.div_yield_ttm : h.is_distributing ? 0.035 : 0));
  const fee = wAvg((h) => h.fee_pct);

  let eq = 0;
  let bd = 0;
  let oth = 0;
  let corePct = 0;
  let satPct = 0;
  let dist = 0;
  let backed = 0;
  for (const h of holdings) {
    if (h.sleeve === "equity") eq += h.weight_pct;
    else if (h.sleeve === "bond") bd += h.weight_pct;
    else oth += h.weight_pct;
    if (h.core_role === "core") corePct += h.weight_pct;
    else satPct += h.weight_pct;
    if (h.is_distributing) dist += h.weight_pct;
    if (h.data_tier === "A" || h.data_tier === "B") backed++;
  }

  return {
    est_cagr_pct: cagr != null ? Math.round(cagr * 10000) / 100 : null,
    est_vol_pct: estVol != null ? Math.round(estVol * 10000) / 100 : null,
    est_sharpe: estSharpe != null ? Math.round(estSharpe * 100) / 100 : null,
    est_max_dd_pct: estMaxDd != null ? Math.round(estMaxDd * 10000) / 100 : null,
    est_div_yield_pct: divYield != null ? Math.round(divYield * 10000) / 100 : null,
    weighted_fee_pct: fee != null ? Math.round(fee * 100) / 100 : null,
    equity_pct: eq,
    bond_pct: bd,
    other_pct: oth,
    core_pct: corePct,
    satellite_pct: satPct,
    distributing_pct: dist,
    series_backed_count: backed,
  };
}

interface PickDiverseState {
  usedTwins: Set<string>;
  usedSlugs: Set<string>;
  usedClusters: Set<string>;
  usedNameKeys: Set<string>;
  managerCounts: Map<string, number>;
  pickedRows: QuantFundCatalogRow[];
}

function createPickState(): PickDiverseState {
  return {
    usedTwins: new Set<string>(),
    usedSlugs: new Set<string>(),
    usedClusters: new Set<string>(),
    usedNameKeys: new Set<string>(),
    managerCounts: new Map<string, number>(),
    pickedRows: [],
  };
}

/**
 * 同质赛道内仅保留「最低费率 + 最高 Alpha（无显著 Alpha 时取最高 R² 指数贴合 + 最低费率）」的头号胜出者，
 * 再跨赛道挑选，同时检查前十大持仓指纹重合度与管理人集中度（≤2 只）。
 */
function pickDiverseFromPool(
  pool: QuantFundCatalogRow[],
  limit: number,
  state: PickDiverseState,
  opts: { allowClusterReuseFallback?: boolean } = {}
): QuantFundCatalogRow[] {
  if (limit <= 0 || pool.length === 0) return [];

  // Group by homogeneity cluster and rank within each cluster strictly by compareHomogeneousFunds
  const bestByCluster = new Map<string, QuantFundCatalogRow[]>();
  for (const row of pool) {
    const cl = getFundHomogeneityCluster(row);
    const list = bestByCluster.get(cl) || [];
    list.push(row);
    bestByCluster.set(cl, list);
  }
  const clusterRepresentatives: QuantFundCatalogRow[] = [];
  for (const [, list] of bestByCluster.entries()) {
    list.sort(compareHomogeneousFunds);
    clusterRepresentatives.push(list[0]);
  }
  // Order representatives by the caller's overall candidate score order
  const poolIndex = new Map(pool.map((r, idx) => [r.slug, idx]));
  clusterRepresentatives.sort((a, b) => (poolIndex.get(a.slug) ?? 0) - (poolIndex.get(b.slug) ?? 0));

  const picked: QuantFundCatalogRow[] = [];
  const tryPick = (candidates: QuantFundCatalogRow[], strictClusterAndMgr: boolean) => {
    for (const row of candidates) {
      if (picked.length >= limit) break;
      if (state.usedSlugs.has(row.slug)) continue;

      const codeKey = (row.code || row.slug).toUpperCase();
      const implicitTwin = row.twin_code || UCITS_SHARE_TWINS[codeKey];
      if (state.usedTwins.has(codeKey) || (implicitTwin && state.usedTwins.has(implicitTwin.toUpperCase()))) {
        continue;
      }
      const baseName = (row.name || "").split("(")[0].split("（")[0].trim().slice(0, 24);
      if (baseName && state.usedNameKeys.has(baseName)) continue;

      const cluster = getFundHomogeneityCluster(row);
      if (strictClusterAndMgr && state.usedClusters.has(cluster)) continue;

      const mgr = (row.manager || "").trim().toLowerCase();
      if (strictClusterAndMgr && mgr && mgr !== "mgr" && (state.managerCounts.get(mgr) || 0) >= 2) {
        continue;
      }

      // Check Top 10 holdings overlap against all already picked funds
      const hasHoldingsCollision = state.pickedRows.some((prev) => computeHoldingsOverlap(prev, row).isHighOverlap);
      if (hasHoldingsCollision) continue;

      picked.push(row);
      state.pickedRows.push(row);
      state.usedSlugs.add(row.slug);
      state.usedClusters.add(cluster);
      state.usedTwins.add(codeKey);
      if (implicitTwin) state.usedTwins.add(implicitTwin.toUpperCase());
      if (baseName) state.usedNameKeys.add(baseName);
      if (mgr) state.managerCounts.set(mgr, (state.managerCounts.get(mgr) || 0) + 1);
    }
  };

  tryPick(clusterRepresentatives, true);
  if (picked.length < limit && opts.allowClusterReuseFallback) {
    tryPick(pool, false);
  }
  return picked;
}

function buildSingleBasket(
  rows: QuantFundCatalogRow[],
  profile: ClientAdvisoryProfile,
  envelope: TargetEnvelope,
  key: "core" | "alternative",
  mode: "core" | "income_boost" | "defensive",
  titleZh: string,
  titleEn: string,
  subtitleZh: string,
  subtitleEn: string,
  excludeSlugs: Set<string> = new Set()
): CustomFundBasket {
  let targetEq = envelope.target_equity_pct;
  let targetBd = envelope.target_bond_pct;
  let targetOth = envelope.target_other_pct;

  if (mode === "defensive") {
    const shift = Math.min(15, Math.max(0, targetEq - 15));
    targetEq -= shift;
    targetBd += shift;
  } else if (mode === "income_boost" && targetEq > 60) {
    targetEq -= 10;
    targetBd += 10;
  }

  // Re-assert Obsidian horizon equity hard cap
  if (targetEq > envelope.equity_hard_cap_pct) {
    const excess = targetEq - envelope.equity_hard_cap_pct;
    targetEq = envelope.equity_hard_cap_pct;
    targetBd += excess;
  }

  const scoredPool = [...rows]
    .filter((r) => !excludeSlugs.has(r.slug))
    .sort(
      (a, b) =>
        scoreFundCandidate(b, envelope, mode, profile.currency) -
        scoreFundCandidate(a, envelope, mode, profile.currency)
    );
  const activePool =
    scoredPool.length >= 4
      ? scoredPool
      : [...rows].sort(
          (a, b) =>
            scoreFundCandidate(b, envelope, mode, profile.currency) -
            scoreFundCandidate(a, envelope, mode, profile.currency)
        );

  const universeMode = resolveBasketUniverseMode(profile);
  const isIlas = universeMode === "ilas";
  const minWeightPct = isIlas ? 10 : 5;
  const maxSatelliteTotalPct =
    envelope.risk_level === "conservative" || mode === "defensive" ? 15 : 30;

  // Partition into Core vs Satellite pools while respecting equity/bond/other sleeves
  const eqCorePool = activePool.filter((r) => classifyFundSleeve(r) === "equity" && resolveEffectiveFundRole(r) === "core");
  const eqSatPool = activePool.filter((r) => classifyFundSleeve(r) === "equity" && resolveEffectiveFundRole(r) === "satellite");
  const bdCorePool = activePool.filter((r) => classifyFundSleeve(r) === "bond" && resolveEffectiveFundRole(r) === "core");
  const bdSatPool = activePool.filter((r) => classifyFundSleeve(r) === "bond" && resolveEffectiveFundRole(r) === "satellite");
  const othPool = activePool.filter((r) => classifyFundSleeve(r) === "other");

  const eqAllPool = activePool.filter((r) => classifyFundSleeve(r) === "equity");
  const bdAllPool = activePool.filter((r) => classifyFundSleeve(r) === "bond");

  const state = createPickState();
  const pickedWithRole: Array<{ row: QuantFundCatalogRow; sleeve: "equity" | "bond" | "other"; coreRole: "core" | "satellite"; weight: number }> = [];

  // Allocate Core slots first (>= 70% of portfolio)
  const satBudget = isIlas
    ? maxSatelliteTotalPct >= 20
      ? 20
      : maxSatelliteTotalPct >= 10
        ? 10
        : 0
    : maxSatelliteTotalPct;
  const eqSatTarget = targetEq >= 35 && eqSatPool.length > 0 ? Math.min(15, satBudget) : 0;
  const othSatTarget = targetOth >= minWeightPct && othPool.length > 0 ? Math.min(targetOth, Math.max(minWeightPct, satBudget - eqSatTarget)) : 0;
  const bdSatTarget =
    targetBd >= 40 && bdSatPool.length > 0 && eqSatTarget + othSatTarget + minWeightPct <= satBudget
      ? minWeightPct
      : 0;

  const eqCoreTarget = Math.max(0, targetEq - eqSatTarget);
  const bdCoreTarget = Math.max(0, targetBd - bdSatTarget);

  const eqCoreSlots = eqCoreTarget >= 50 ? 2 : eqCoreTarget > 0 ? 1 : 0;
  const bdCoreSlots = bdCoreTarget >= 45 ? 2 : bdCoreTarget > 0 ? 1 : 0;

  const pickedEqCore = pickDiverseFromPool(
    eqCorePool.length > 0 ? eqCorePool : eqAllPool,
    eqCoreSlots,
    state,
    { allowClusterReuseFallback: true }
  );
  const pickedBdCore = pickDiverseFromPool(
    bdCorePool.length > 0 ? bdCorePool : bdAllPool,
    bdCoreSlots,
    state,
    { allowClusterReuseFallback: true }
  );

  // Pick up to 2 satellite slots across equity/other/bond without overlapping core clusters or holdings
  const pickedEqSat =
    eqSatTarget >= minWeightPct
      ? pickDiverseFromPool(eqSatPool, 1, state)
      : [];
  const pickedOthSat =
    othSatTarget >= minWeightPct
      ? pickDiverseFromPool(othPool, 1, state)
      : [];
  const pickedBdSat =
    bdSatTarget >= minWeightPct
      ? pickDiverseFromPool(bdSatPool, 1, state)
      : [];

  // Redistribute weights cleanly across actual picked buckets
  const wEqCore = pickedEqCore.length > 0 ? eqCoreTarget : 0;
  const wEqSat = pickedEqSat.length > 0 ? eqSatTarget : 0;
  const wBdCore = pickedBdCore.length > 0 ? bdCoreTarget : 0;
  const wBdSat = pickedBdSat.length > 0 ? bdSatTarget : 0;
  const wOth = pickedOthSat.length > 0 ? othSatTarget : 0;

  let residual = 100 - (wEqCore + wEqSat + wBdCore + wBdSat + wOth);
  let adjEqCore = wEqCore;
  let adjBdCore = wBdCore;
  if (residual > 0) {
    if (pickedEqCore.length > 0 && pickedBdCore.length === 0) adjEqCore += residual;
    else if (pickedBdCore.length > 0 && pickedEqCore.length === 0) adjBdCore += residual;
    else if (pickedBdCore.length > 0 && targetBd >= targetEq) adjBdCore += residual;
    else if (pickedEqCore.length > 0) adjEqCore += residual;
    else if (pickedBdCore.length > 0) adjBdCore += residual;
    residual = 0;
  }

  const eqCoreWeights = allocateBucketWeights(pickedEqCore, adjEqCore);
  pickedEqCore.forEach((r, idx) => {
    pickedWithRole.push({ row: r, sleeve: "equity", coreRole: "core", weight: eqCoreWeights[idx] });
  });
  const bdCoreWeights = allocateBucketWeights(pickedBdCore, adjBdCore);
  pickedBdCore.forEach((r, idx) => {
    pickedWithRole.push({ row: r, sleeve: "bond", coreRole: "core", weight: bdCoreWeights[idx] });
  });
  const eqSatWeights = allocateBucketWeights(pickedEqSat, wEqSat);
  pickedEqSat.forEach((r, idx) => {
    pickedWithRole.push({ row: r, sleeve: "equity", coreRole: "satellite", weight: eqSatWeights[idx] });
  });
  const bdSatWeights = allocateBucketWeights(pickedBdSat, wBdSat);
  pickedBdSat.forEach((r, idx) => {
    pickedWithRole.push({ row: r, sleeve: "bond", coreRole: "satellite", weight: bdSatWeights[idx] });
  });
  const othWeights = allocateBucketWeights(pickedOthSat, wOth);
  pickedOthSat.forEach((r, idx) => {
    pickedWithRole.push({
      row: r,
      sleeve: "other",
      coreRole: resolveEffectiveFundRole(r),
      weight: othWeights[idx],
    });
  });

  // Ensure at least 3 holdings when catalog allows
  if (pickedWithRole.length < 3 && activePool.length > pickedWithRole.length) {
    const coreFirst = [
      ...activePool.filter((r) => resolveEffectiveFundRole(r) === "core"),
      ...activePool.filter((r) => resolveEffectiveFundRole(r) === "satellite"),
    ];
    const extra = pickDiverseFromPool(coreFirst, 3 - pickedWithRole.length, state, {
      allowClusterReuseFallback: true,
    });
    for (const r of extra) {
      pickedWithRole.push({
        row: r,
        sleeve: classifyFundSleeve(r),
        coreRole: resolveEffectiveFundRole(r),
        weight: r.is_admin_core_pick ? minWeightPct * 1.5 : minWeightPct,
      });
    }
  }

  const wantIncome = mode === "income_boost" || (mode === "core" && envelope.income_focus);
  const internalHoldings: InternalHolding[] = pickedWithRole.map(({ row, sleeve, coreRole, weight }) => {
    const labId = row.code && row.code !== "—" ? row.code : row.slug;
    const rat = buildFundRationale(row, sleeve, coreRole, wantIncome);
    return {
      slug: row.slug,
      code: row.code || row.slug,
      lab_id: labId,
      isin: row.isin ?? null,
      name: row.name,
      asset_class: row.asset_class,
      sleeve,
      core_role: coreRole,
      homogeneity_cluster: getFundHomogeneityCluster(row),
      ilas_platform: row.ilas_platform,
      currency: row.currency,
      data_tier: row.data_tier,
      quant_grade: row.quant_grade,
      quant_score: row.quant_score,
      ret_3y_ann: row.ret_3y_ann,
      vol_3y: row.vol_3y,
      sharpe_3y: row.sharpe_3y,
      alpha_3y: row.alpha_3y,
      r2_3y: row.r2_3y,
      max_dd_3y: row.max_dd_3y,
      div_yield_ttm: row.div_yield_ttm,
      fee_pct: row.fee_pct,
      is_distributing: row.is_distributing,
      weight_pct: weight,
      is_admin_core_pick: Boolean(row.is_admin_core_pick),
      admin_core_reasons: Array.isArray(row.admin_core_reasons) ? row.admin_core_reasons : [],
      rationale_zh: rat.zh,
      rationale_en: rat.en,
    };
  });

  const normHoldings = normalizeBasketWeights(internalHoldings, {
    minWeightPct,
    maxWeightPct: 35,
    maxSatelliteTotalPct,
  }).map((h, i) => ({
    ...internalHoldings[i],
    weight_pct: h.weight_pct,
  }));

  const isHkBrokerEtfOnly = profile.product_scope === "hk_broker_etf";
  const publicHoldings: CustomBasketHolding[] = normHoldings.map(({ max_dd_3y: _ignored, ...rest }) => rest);
  return {
    key,
    universe_mode: universeMode,
    us_estate_tax_shield:
      !isHkBrokerEtfOnly &&
      (universeMode === "non_ilas" || universeMode === "hk_broker") &&
      hasUsEstateTaxConcern(profile),
    hk_broker_etf_only: isHkBrokerEtfOnly,
    title_zh: titleZh,
    title_en: titleEn,
    subtitle_zh: subtitleZh,
    subtitle_en: subtitleEn,
    holdings: publicHoldings,
    metrics: computeMetricsSafe(normHoldings),
  };
}

export function buildCustomFundBaskets(
  catalogRows: QuantFundCatalogRow[],
  profile: ClientAdvisoryProfile,
  envelope: TargetEnvelope
): { baskets: CustomFundBasket[]; scopedCount: number; backedCount: number } {
  // 硬约束：投连险平台基金与平台外基金严格隔离，同一组合内绝不混配；香港券商模式剔除 IE/LU ETF；纯低费 ETF 模式更进一步仅保留美/港/日低费 ETF
  const universeMode = resolveBasketUniverseMode(profile);
  const wantIlas = universeMode === "ilas";
  const isHkBroker = universeMode === "hk_broker";
  const isHkBrokerEtfOnly = !wantIlas && profile.product_scope === "hk_broker_etf";
  const universeRows = isHkBroker
    ? catalogRows.filter((r) => isHkBrokerEligibleFund(r))
    : catalogRows.filter((r) => isIlasFund(r) === wantIlas);
  const requireEuDomicile = !wantIlas && !isHkBrokerEtfOnly && hasUsEstateTaxConcern(profile);
  let effectiveUniverse = universeRows;
  if (isHkBrokerEtfOnly) {
    effectiveUniverse = universeRows.filter((r) => isHkBrokerLowFeeEtf(r));
  } else if (isHkBroker && requireEuDomicile) {
    const euMutualFunds = universeRows.filter((r) => isIrelandOrLuxembourgFund(r) && !isIrelandOrLuxembourgEtf(r));
    effectiveUniverse = euMutualFunds.length >= 3 ? euMutualFunds : universeRows;
  } else if (!isHkBroker && requireEuDomicile) {
    effectiveUniverse = universeRows.filter((r) => isIrelandOrLuxembourgFund(r));
  }

  const recommendedOnly = effectiveUniverse.filter((r) => !r.tags.includes("非推荐选择") || r.is_admin_core_pick);
  const scope = profile.product_scope || "all";
  let scoped = recommendedOnly.filter((r) => matchesProductScope(r, scope));
  if (scoped.length < 3) {
    scoped = effectiveUniverse.filter((r) => matchesProductScope(r, scope));
  }
  if (scoped.length < 3) {
    scoped = recommendedOnly.length > 0 ? recommendedOnly : effectiveUniverse;
  }

  const backedCount = scoped.filter((r) => r.data_tier === "A" || r.data_tier === "B").length;

  const planATitleZh = isHkBrokerEtfOnly
    ? "方案一 · 香港券商纯低费 ETF 核心+卫星组合（剔除爱尔兰/卢森堡 ETF）"
    : isHkBroker
      ? requireEuDomicile
        ? "方案一 · 香港券商互惠基金优选组合（爱尔兰/卢森堡互惠基金·免美遗产税）"
        : "方案一 · 香港券商可交易核心+卫星组合（剔除爱尔兰/卢森堡 ETF）"
      : requireEuDomicile
        ? "方案一 · 欧基核心+卫星优选组合（爱尔兰/卢森堡免美遗产税）"
        : "方案一 · 核心+卫星量化优选组合";
  const planATitleEn = isHkBrokerEtfOnly
    ? "Plan A · HK Broker Pure Low-Fee ETF Core-Satellite (Excl. IE/LU ETFs)"
    : isHkBroker
      ? requireEuDomicile
        ? "Plan A · HK Broker Mutual Fund Core-Satellite (IE/LU Mutual Funds, Estate-Tax Exempt)"
        : "Plan A · HK Broker Core-Satellite (Excl. IE/LU ETFs)"
      : requireEuDomicile
        ? "Plan A · IE/LU UCITS Core-Satellite (US Estate-Tax Exempt)"
        : "Plan A · Core-Satellite Quant Allocation";
  const planASubtitleZh = isHkBrokerEtfOnly
    ? "纯低费美/港/日 ETF 组合：严禁爱尔兰/卢森堡注册 ETF 及互惠基金，100% 适配香港主流券商直接下单"
    : isHkBroker
      ? requireEuDomicile
        ? "适配香港本地券商渠道，剔除爱尔兰/卢森堡注册 ETF，采用爱尔兰/卢森堡互惠基金规避美股遗产税"
        : "适配香港大部分券商渠道：剔除无法直接买卖的爱尔兰/卢森堡注册 ETF，保留互惠基金与美/港/日 ETF"
      : requireEuDomicile
        ? "全仓采用爱尔兰/卢森堡注册欧洲 UCITS 基金，规避非美居民 6 万美元以上美股遗产税敞口，遵循核心 ≥70% 纪律"
        : "遵循核心 ≥70%（Beta压舱）/ 卫星 ≤30%（Alpha分散）原则，优先纳入管理员核心推荐标的";
  const planASubtitleEn = isHkBrokerEtfOnly
    ? "Pure low-fee US/HK/JP ETFs only: strictly excludes IE/LU UCITS ETFs and mutual funds for direct HK broker execution"
    : isHkBroker
      ? requireEuDomicile
        ? "Built for Hong Kong retail brokers: excludes IE/LU UCITS ETFs and uses IE/LU mutual funds to avoid US estate tax"
        : "Tailored for Hong Kong brokers: removes IE/LU UCITS ETFs while retaining mutual funds and US/HK/JP ETFs"
      : requireEuDomicile
        ? "100% Ireland/Luxembourg domiciled UCITS ETFs shielding non-US residents from US-situs estate tax"
        : "Core ≥70% / Satellite ≤30% discipline prioritizing Admin Core Picks";

  const coreBasket = buildSingleBasket(
    scoped,
    profile,
    envelope,
    "core",
    "core",
    planATitleZh,
    planATitleEn,
    planASubtitleZh,
    planASubtitleEn,
    new Set()
  );

  // Exclude top-2 non-admin core picks first so Plan B retains admin core picks when available while offering meaningful variation
  const nonAdminFromPlanA = coreBasket.holdings.filter((h) => !h.is_admin_core_pick);
  const excludeSource =
    nonAdminFromPlanA.length >= 2
      ? nonAdminFromPlanA.slice(0, 2)
      : [...nonAdminFromPlanA, ...coreBasket.holdings.filter((h) => h.is_admin_core_pick)].slice(0, 2);
  const excludeForAlt = new Set(excludeSource.map((h) => h.slug));
  const useDefensiveAlt = envelope.income_focus || envelope.risk_level === "conservative";

  const planBSuffixZh = isHkBrokerEtfOnly
    ? "（香港券商纯低费 ETF）"
    : isHkBroker
      ? requireEuDomicile
        ? "（香港券商·欧基互惠基金）"
        : "（香港券商平台）"
      : requireEuDomicile
        ? "（欧基免遗产税）"
        : "";
  const planBSuffixEn = isHkBrokerEtfOnly
    ? " (HK Broker Pure ETFs)"
    : isHkBroker
      ? requireEuDomicile
        ? " (HK Broker · IE/LU Mutual Funds)"
        : " (HK Broker)"
      : requireEuDomicile
        ? " (IE/LU UCITS)"
        : "";

  const altBasket = buildSingleBasket(
    scoped,
    profile,
    envelope,
    "alternative",
    useDefensiveAlt ? "defensive" : "income_boost",
    useDefensiveAlt
      ? `方案二 · 低波稳健防御备选${planBSuffixZh}`
      : `方案二 · 高息现金流增强备选${planBSuffixZh}`,
    useDefensiveAlt
      ? `Plan B · Low-Vol Defensive Alt${planBSuffixEn}`
      : `Plan B · Income & Dividend Enhanced${planBSuffixEn}`,
    useDefensiveAlt
      ? "加厚核心固收压舱仓位，严控卫星比例，在市场回撤期进一步压缩净值下行"
      : "在核心底仓上提高高股息与现金派息比例，兼顾长期增长与可支配现金分红",
    useDefensiveAlt
      ? "Tilts further into core low-volatility fixed income to dampen drawdowns"
      : "Increases distributing dividend sleeve alongside core holdings for steady cashflow",
    excludeForAlt
  );

  return {
    baskets: [coreBasket, altBasket].filter((b) => b.holdings.length > 0),
    scopedCount: scoped.length,
    backedCount,
  };
}

/**
 * 为 AI 首席投顾构建同平台 Top 14 候补基金白名单池（严格限定与原组合同属纯投连险或纯非投连险，每个细分同质赛道保留最优 1 只，优先覆盖当前篮子尚未涵盖的互补品种）。
 */
export function buildTacticalCandidatePool(
  catalogRows: QuantFundCatalogRow[],
  rawProfile: Partial<ClientAdvisoryProfile>,
  currentHoldings: Array<{
    slug?: string;
    lab_id?: string;
    code?: string;
    ilas_platform?: string | null;
    aia_code?: string | null;
  }>,
  limit = 14
): TacticalCandidateFund[] {
  const profile = normalizeProfile(rawProfile);
  const scope = profile.product_scope || "all";
  const universeMode = resolveBasketUniverseMode(profile, currentHoldings, catalogRows);
  const wantIlas = universeMode === "ilas";
  const isHkBroker = universeMode === "hk_broker";
  const isHkBrokerEtfOnly = !wantIlas && scope === "hk_broker_etf";
  const universeRows = isHkBroker
    ? catalogRows.filter((r) => isHkBrokerEligibleFund(r))
    : catalogRows.filter((r) => isIlasFund(r) === wantIlas);
  const requireEuDomicile = !wantIlas && !isHkBrokerEtfOnly && hasUsEstateTaxConcern(profile);
  let effectiveUniverse = universeRows;
  if (isHkBrokerEtfOnly) {
    effectiveUniverse = universeRows.filter((r) => isHkBrokerLowFeeEtf(r));
  } else if (isHkBroker && requireEuDomicile) {
    const euMutualFunds = universeRows.filter((r) => isIrelandOrLuxembourgFund(r) && !isIrelandOrLuxembourgEtf(r));
    effectiveUniverse = euMutualFunds.length >= 4 ? euMutualFunds : universeRows;
  } else if (!isHkBroker && requireEuDomicile) {
    effectiveUniverse = universeRows.filter((r) => isIrelandOrLuxembourgFund(r));
  }

  const recommendedOnly = effectiveUniverse.filter((r) => !r.tags.includes("非推荐选择") || r.is_admin_core_pick);
  let scoped = recommendedOnly.filter((r) => matchesProductScope(r, scope));
  if (scoped.length < 4) {
    scoped = effectiveUniverse.filter((r) => matchesProductScope(r, scope));
  }
  if (scoped.length < 4) {
    scoped = recommendedOnly.length > 0 ? recommendedOnly : effectiveUniverse;
  }

  const currentIds = new Set<string>();
  const currentClusters = new Set<string>();
  const currentRows: QuantFundCatalogRow[] = [];

  for (const h of currentHoldings || []) {
    if (h.slug) currentIds.add(String(h.slug).toUpperCase());
    if (h.lab_id) currentIds.add(String(h.lab_id).toUpperCase());
    if (h.code) currentIds.add(String(h.code).toUpperCase());
  }

  for (const r of catalogRows) {
    const keys = [r.slug, r.code, r.aia_code, r.isin].filter(Boolean).map((x) => String(x).toUpperCase());
    if (keys.some((k) => currentIds.has(k))) {
      currentRows.push(r);
      currentClusters.add(getFundHomogeneityCluster(r));
      if (r.twin_code) currentIds.add(r.twin_code.toUpperCase());
    }
  }

  // Group remaining candidates by homogeneity cluster and keep the #1 winner per cluster
  const bestByCluster = new Map<string, QuantFundCatalogRow>();
  for (const r of scoped) {
    const keys = [r.slug, r.code, r.aia_code, r.isin, r.twin_code]
      .filter(Boolean)
      .map((x) => String(x).toUpperCase());
    if (keys.some((k) => currentIds.has(k))) continue;
    if (currentRows.some((cur) => computeHoldingsOverlap(cur, r).isHighOverlap)) continue;

    const cluster = getFundHomogeneityCluster(r);
    const existing = bestByCluster.get(cluster);
    if (!existing || compareHomogeneousFunds(r, existing) < 0) {
      bestByCluster.set(cluster, r);
    }
  }

  const reps = Array.from(bestByCluster.values());
  // Prioritize clusters NOT yet represented in currentHoldings, then Admin Core Picks, then quality
  reps.sort((a, b) => {
    const clA = getFundHomogeneityCluster(a);
    const clB = getFundHomogeneityCluster(b);
    const missingA = currentClusters.has(clA) ? 0 : 1;
    const missingB = currentClusters.has(clB) ? 0 : 1;
    if (missingA !== missingB) return missingB - missingA;
    const adminA = a.is_admin_core_pick ? 1 : 0;
    const adminB = b.is_admin_core_pick ? 1 : 0;
    if (adminA !== adminB) return adminB - adminA;
    return compareHomogeneousFunds(a, b);
  });

  return reps.slice(0, limit).map((r) => ({
    slug: r.slug,
    lab_id: r.code && r.code !== "—" ? r.code : r.slug,
    code: r.code || r.slug,
    isin: r.isin ?? null,
    yahoo_ticker: r.yahoo_ticker ?? null,
    name: r.name,
    asset_class: r.asset_class,
    sleeve: classifyFundSleeve(r),
    core_role: resolveEffectiveFundRole(r),
    homogeneity_cluster: getFundHomogeneityCluster(r),
    ilas_platform: r.ilas_platform,
    currency: r.currency,
    fee_pct: r.fee_pct,
    alpha_3y: r.alpha_3y,
    r2_3y: r.r2_3y,
    beta_3y: r.beta_3y,
    vol_3y: r.vol_3y,
    div_yield_ttm: r.div_yield_ttm,
    quant_grade: r.quant_grade,
    is_distributing: r.is_distributing,
    is_admin_core_pick: Boolean(r.is_admin_core_pick),
    admin_core_reasons: Array.isArray(r.admin_core_reasons) ? r.admin_core_reasons : [],
  }));
}

export async function recommendForClient(
  db: D1Database,
  user: UserRow,
  rawProfile: Partial<ClientAdvisoryProfile>
): Promise<AdvisoryRecommendationResult> {
  const profile = normalizeProfile(rawProfile);
  const envelope = getRiskEnvelope(profile);
  const { rows, lookup } = await loadQuantCatalog(db);

  const [existingMatches, customBuilt] = await Promise.all([
    matchExistingPortfolios(db, user, profile, envelope, lookup),
    Promise.resolve(buildCustomFundBaskets(rows, profile, envelope)),
  ]);
  const classicMatches = matchClassicTemplates(profile, envelope);

  return {
    normalized_profile: profile,
    target_envelope: envelope,
    existing_portfolio_matches: existingMatches,
    classic_template_matches: classicMatches,
    custom_fund_baskets: customBuilt.baskets,
    catalog_stats: {
      total_funds: rows.length,
      scoped_funds: customBuilt.scopedCount,
      series_backed_funds: customBuilt.backedCount,
      admin_core_picks_count: rows.filter((r) => r.is_admin_core_pick).length,
    },
  };
}
