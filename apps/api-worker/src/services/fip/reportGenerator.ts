import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { Env } from "../../types";
import { callLlmChat, ModelPreference } from "../llm";

export interface ReportData {
  clientName?: string;
  advisorName?: string;
  portfolioName?: string;
  totalNav?: number;
  currency?: string;
  expectedReturn?: number;
  volatility?: number;
  sharpeRatio?: number;
  maxDrawdown?: number;
  holdings?: { isin: string; name: string; weight: number; sector: string }[];
  mcPercentiles?: { p10: number; p50: number; p90: number; years: number };
}

export interface ReportNarrativeResult {
  executive_summary: string;
  macro_and_strategy: string;
  holdings_commentary: Record<string, string>;
  cashflow_and_solvency: string;
  risk_and_stress_commentary: string;
  model_used: string;
  provider: string;
}

interface NormalizedHolding {
  isin: string;
  name: string;
  assetClass: string;
  sleeveLabel: string;
  weightPct: number;
  amount: number;
  divYieldPct: number;
  roleRationale: string;
  isProxy: boolean;
  proxyBenchmark: string | null;
}

interface NormalizedReportContext {
  clientName: string;
  clientAge: number | null;
  advisorName: string;
  portfolioName: string;
  currency: string;
  ccySym: string;
  capital: number;
  years: number;
  inflationPct: number;
  targetGoal: number;
  cmaMode: string;
  cmaLabel: string;
  riskLabel: string;
  riskScore: number | null;
  goalsText: string;
  extraNotes: string;
  tacticalSummary: string;
  hasWithdrawal: boolean;
  withdrawal: number;
  withdrawalStart: number;
  withdrawalEnd: number;
  withdrawal2: number;
  withdrawalStart2: number;
  withdrawalEnd2: number;
  withdrawalInflation: boolean;
  contribution: number;
  contributionStart: number;
  contributionYears: number;
  expectedReturnPct: number;
  volatilityPct: number;
  sharpeRatio: number;
  divYieldPct: number;
  maxDrawdownPct: number;
  solvencyRatePct: number;
  successRatePct: number;
  p10: number;
  p50: number;
  p90: number;
  realP50: number;
  irrP10Pct: number;
  irrP50Pct: number;
  irrP90Pct: number;
  ddP10Pct: number;
  ddP50Pct: number;
  ddP90Pct: number;
  annualDivFirstYear: number;
  holdings: NormalizedHolding[];
  milestones: Array<{ year: number; age: number | null; p10: number; p50: number; p90: number; note: string }>;
  stressScenarios: Array<{ label: string; total_return_pct: number | null; max_drawdown_pct: number | null }>;
  existingNarrative: Partial<ReportNarrativeResult> | null;
}

const GOAL_MAP: Record<string, string> = {
  income: "现金流收息",
  preservation: "稳健保值",
  balanced: "平衡增值",
  growth: "长期成长",
  retirement: "退休收入保障",
  education: "子女教育基金",
  legacy: "家族财富传承",
  liquidity: "流动性储备",
};

const CMA_LABEL_MAP: Record<string, string> = {
  forward_looking: "宏观利率与估值时钟前瞻校准",
  shrunk: "贝叶斯大类历史收缩校准",
  ltcma: "长期资本市场先验假设 (LTCMA)",
  raw: "纯历史样本波动与均值",
};

function ccySymbol(ccy: string): string {
  const u = (ccy || "USD").toUpperCase();
  if (u === "HKD") return "HK$";
  if (u === "CNY" || u === "RMB") return "¥";
  if (u === "SGD") return "S$";
  if (u === "EUR") return "€";
  if (u === "GBP") return "£";
  return "$";
}

function fmtMoney(val: number, sym = "$"): string {
  const n = Math.round(Number(val || 0));
  return `${sym}${n.toLocaleString("en-US")}`;
}

function inferSleeveLabel(isin: string, assetClass: string, stats: any): string {
  const ac = `${assetClass} ${stats?.name || ""} ${isin}`.toLowerCase();
  if (
    ac.includes("cash") ||
    ac.includes("货币") ||
    ac.includes("现金") ||
    ac.includes("bond") ||
    ac.includes("债") ||
    ac.includes("固收") ||
    ["BIL", "SGOV", "SHV", "CSH2", "BND", "AGG", "TLT", "IEF", "SHY", "HYG", "LQD"].includes(
      isin.toUpperCase()
    )
  ) {
    return "流动性与高息防线";
  }
  if (
    ac.includes("dividend") ||
    ac.includes("红利") ||
    ac.includes("股息") ||
    ac.includes("income") ||
    ac.includes("收益") ||
    (stats?.dividend_yield || 0) >= 0.03
  ) {
    return "生息防御压舱石";
  }
  return "长期复利增长舱";
}

export function normalizeReportContext(raw: any): NormalizedReportContext {
  const isNested = Boolean(raw && (raw.lab_result || raw.mc_settings || raw.client_info));
  const lab = isNested ? raw.lab_result || {} : {};
  const ci = isNested ? raw.client_info || {} : {};
  const mcSet = isNested ? raw.mc_settings || {} : {};
  const mc = lab.monte_carlo || {};

  const currency = String(
    raw?.base_currency || lab.base_currency || raw?.currency || "USD"
  ).toUpperCase();
  const ccySym = ccySymbol(currency);

  const clientName =
    String(ci.client_name || ci.name || raw?.clientName || "贵宾客户").trim() || "贵宾客户";
  const clientAge = ci.age != null && Number.isFinite(Number(ci.age)) ? parseInt(ci.age, 10) : null;
  const advisorName = String(ci.advisor || raw?.advisorName || "WONDER Atelier 财富顾问团队").trim();
  const portfolioName = String(
    ci.basket_title || raw?.portfolioName || "定制多资产财富配置组合"
  ).trim();

  const capital = Math.max(
    1000,
    Number(mcSet.capital ?? raw?.totalNav ?? 500000) || 500000
  );
  const years = Math.max(
    1,
    Math.min(40, Number(mcSet.years ?? raw?.mcPercentiles?.years ?? 10) || 10)
  );
  const inflationPct = Number(mcSet.inflation_pct ?? mcSet.inflation ?? 2.5) || 0;
  const targetGoal = Number(mcSet.target ?? capital) || capital;
  const cmaMode = String(lab.cma_mode || mcSet.cma_mode || "forward_looking");
  const cmaLabel = CMA_LABEL_MAP[cmaMode] || cmaMode;

  const withdrawal = Number(mcSet.withdrawal || 0);
  const withdrawalStart = Number(mcSet.withdrawal_start || 1);
  const withdrawalEnd = Number(mcSet.withdrawal_end || years);
  const withdrawal2 = Number(mcSet.withdrawal_2 || 0);
  const withdrawalStart2 = Number(mcSet.withdrawal_start_2 || years);
  const withdrawalEnd2 = Number(mcSet.withdrawal_end_2 || years);
  const withdrawalInflation = Boolean(mcSet.withdrawal_inflation);
  const contribution = Number(mcSet.contribution || 0);
  const contributionStart = Number(mcSet.contribution_start || 1);
  const contributionYears = Number(mcSet.contribution_years || 0);
  const hasWithdrawal = withdrawal > 0 || withdrawal2 > 0;

  const targetKey =
    lab.mc_target_label || (lab.custom_portfolio ? "custom_portfolio" : "max_sharpe");
  const targetPort = lab[targetKey] || lab.max_sharpe || {};

  const expectedReturnPct = isNested
    ? Math.round((targetPort.expected_return || 0) * 10000) / 100
    : Number(raw?.expectedReturn || 0);
  const volatilityPct = isNested
    ? Math.round((targetPort.volatility || 0) * 10000) / 100
    : Number(raw?.volatility || 0);
  const sharpeRatio = isNested
    ? Math.round((targetPort.sharpe_ratio || 0) * 100) / 100
    : Number(raw?.sharpeRatio || 0);
  const divYieldPct = isNested
    ? Math.round((targetPort.dividend_yield || 0) * 10000) / 100
    : 0;
  const maxDrawdownPct = isNested
    ? Math.round(
        Math.abs(lab.portfolio_diagnostics?.max_drawdown ?? mc.drawdown?.p50 ?? 0) * 1000
      ) / 10
    : Number(raw?.maxDrawdown || 0);

  const chart: any[] = Array.isArray(mc.chart) ? mc.chart : [];
  const lastPt = chart[chart.length - 1] || {};
  const p10 = Number(lastPt.combined_p10 ?? lastPt.p10 ?? raw?.mcPercentiles?.p10 ?? 0);
  const p50 = Number(lastPt.combined_p50 ?? lastPt.p50 ?? raw?.mcPercentiles?.p50 ?? 0);
  const p90 = Number(lastPt.combined_p90 ?? lastPt.p90 ?? raw?.mcPercentiles?.p90 ?? 0);
  const discountFactor = Math.pow(1 + inflationPct / 100, years);
  const realP50 = discountFactor > 0 ? Math.round(p50 / discountFactor) : p50;

  const solvencyRatePct = Math.round(((mc.solvency_rate ?? mc.success_rate ?? 1) * 100) * 10) / 10;
  const successRatePct = Math.round(((mc.success_rate ?? 1) * 100) * 10) / 10;

  const irrP10Pct = Math.round((mc.irr?.p10 || 0) * 1000) / 10;
  const irrP50Pct = Math.round((mc.irr?.p50 || 0) * 1000) / 10;
  const irrP90Pct = Math.round((mc.irr?.p90 || 0) * 1000) / 10;

  const ddP10Pct = Math.round(Math.abs(mc.drawdown?.p10 || 0) * 1000) / 10;
  const ddP50Pct = Math.round(Math.abs(mc.drawdown?.p50 || 0) * 1000) / 10;
  const ddP90Pct = Math.round(Math.abs(mc.drawdown?.p90 || 0) * 1000) / 10;

  const firstYearDiv =
    chart.length > 1 && chart[1]?.div_generated > 0
      ? Number(chart[1].div_generated)
      : Math.round((capital * divYieldPct) / 100);

  const rationaleMap: Record<string, string> = ci.holdings_rationale || {};
  const aiHoldingsMap: Record<string, string> = raw?.ai_narrative?.holdings_commentary || {};
  const assetStats: Record<string, any> = lab.asset_stats || {};

  let holdings: NormalizedHolding[] = [];
  if (targetPort.allocations && Object.keys(targetPort.allocations).length > 0) {
    holdings = Object.entries(targetPort.allocations)
      .filter(([, w]) => Number(w) > 0.001)
      .sort((a, b) => Number(b[1]) - Number(a[1]))
      .map(([isin, w]) => {
        const weightDec = Number(w);
        const weightPct = Math.round(weightDec * 1000) / 10;
        const stats = assetStats[isin] || {};
        const sleeveLabel = inferSleeveLabel(isin, stats.asset_class || "", stats);
        const roleFromEdit = raw?.ai_narrative?.[`role_${isin}`];
        const fallbackRole =
          roleFromEdit ||
          aiHoldingsMap[isin] ||
          rationaleMap[isin] ||
          (sleeveLabel === "流动性与高息防线"
            ? "锁定当前高确定性无风险/固收票息，缓冲组合净值波动与近期用款"
            : sleeveLabel === "生息防御压舱石"
              ? "提供可持续内生股息现金流，减少熊市被迫变卖本金风险"
              : "锚定全球生产率与核心权益扩张，提供长期抗通胀复利弹性");
        return {
          isin,
          name: String(stats.name || isin),
          assetClass: String(stats.asset_class || sleeveLabel),
          sleeveLabel,
          weightPct,
          amount: Math.round(capital * weightDec),
          divYieldPct: Math.round((stats.dividend_yield || 0) * 10000) / 100,
          roleRationale: fallbackRole,
          isProxy: Boolean(stats.is_proxy),
          proxyBenchmark: stats.proxy_benchmark || null,
        };
      });
  } else if (Array.isArray(raw?.holdings)) {
    holdings = raw.holdings.map((h: any) => ({
      isin: String(h.isin || ""),
      name: String(h.name || h.isin || ""),
      assetClass: String(h.sector || "核心资产"),
      sleeveLabel: inferSleeveLabel(String(h.isin || ""), String(h.sector || ""), {}),
      weightPct: Number(h.weight || 0),
      amount: Math.round((capital * Number(h.weight || 0)) / 100),
      divYieldPct: 0,
      roleRationale: "核心战略配置资产",
      isProxy: false,
      proxyBenchmark: null,
    }));
  }

  // Milestones
  const candidateYears = new Set<number>([years]);
  if (withdrawal > 0 && withdrawalStart >= 1 && withdrawalStart <= years) {
    candidateYears.add(withdrawalStart);
  }
  if (withdrawal2 > 0 && withdrawalStart2 >= 1 && withdrawalStart2 <= years) {
    candidateYears.add(withdrawalStart2);
  }
  for (const y of [3, 5, 10, 15, 20, 25, 30]) {
    if (y <= years) candidateYears.add(y);
  }
  if (clientAge) {
    for (const targetAge of [60, 65, 70, 80]) {
      const y = targetAge - clientAge;
      if (y > 0 && y <= years) candidateYears.add(y);
    }
  }
  const chartByYear = new Map<number, any>();
  for (const pt of chart) chartByYear.set(Number(pt.year), pt);
  const milestones = Array.from(candidateYears)
    .sort((a, b) => a - b)
    .slice(0, 8)
    .map((y) => {
      const pt = chartByYear.get(y) || {};
      let note = "复利稳健推进节点";
      if (withdrawal2 > 0 && y === withdrawalStart2) {
        note = `第 ${y} 年专项大额支出 (${fmtMoney(withdrawal2, ccySym)}) 后结余`;
      } else if (withdrawal > 0 && y === withdrawalStart) {
        note = "进入常规现金流提领阶段";
      } else if (y === years) {
        note = "全规划周期终值汇总";
      } else if (clientAge && clientAge + y === 65) {
        note = "65 岁法定/标准退休里程碑";
      }
      return {
        year: y,
        age: clientAge ? clientAge + y : null,
        p10: Number(pt.combined_p10 ?? pt.p10 ?? 0),
        p50: Number(pt.combined_p50 ?? pt.p50 ?? 0),
        p90: Number(pt.combined_p90 ?? pt.p90 ?? 0),
        note,
      };
    })
    .filter((m) => m.p50 > 0 || m.p10 > 0);

  const rawGoals: string[] = Array.isArray(ci.goals) ? ci.goals : [];
  const goalsText =
    rawGoals.length > 0
      ? rawGoals.map((g) => GOAL_MAP[g] || g).join("、")
      : "稳健保值与长期复利配置";

  const stressScenarios = Array.isArray(raw?.stress_test?.scenarios)
    ? raw.stress_test.scenarios
        .filter((s: any) => s && s.available)
        .map((s: any) => ({
          label: String(s.label || s.id),
          total_return_pct: s.total_return_pct != null ? Number(s.total_return_pct) : null,
          max_drawdown_pct: s.max_drawdown_pct != null ? Number(s.max_drawdown_pct) : null,
        }))
    : [];

  return {
    clientName,
    clientAge,
    advisorName,
    portfolioName,
    currency,
    ccySym,
    capital,
    years,
    inflationPct,
    targetGoal,
    cmaMode,
    cmaLabel,
    riskLabel: String(ci.risk_label_zh || ci.risk_level || "均衡稳健型"),
    riskScore: ci.risk_score != null ? Number(ci.risk_score) : null,
    goalsText,
    extraNotes: String(ci.extra_notes || "").trim(),
    tacticalSummary: String(ci.tactical_summary_zh || "").trim(),
    hasWithdrawal,
    withdrawal,
    withdrawalStart,
    withdrawalEnd,
    withdrawal2,
    withdrawalStart2,
    withdrawalEnd2,
    withdrawalInflation,
    contribution,
    contributionStart,
    contributionYears,
    expectedReturnPct,
    volatilityPct,
    sharpeRatio,
    divYieldPct,
    maxDrawdownPct,
    solvencyRatePct,
    successRatePct,
    p10,
    p50,
    p90,
    realP50,
    irrP10Pct,
    irrP50Pct,
    irrP90Pct,
    ddP10Pct,
    ddP50Pct,
    ddP90Pct,
    annualDivFirstYear: firstYearDiv,
    holdings,
    milestones,
    stressScenarios,
    existingNarrative: raw?.ai_narrative || null,
  };
}

export function buildDeterministicReportNarrative(ctx: NormalizedReportContext): ReportNarrativeResult {
  const capStr = fmtMoney(ctx.capital, ctx.ccySym);
  const p50Str = fmtMoney(ctx.p50, ctx.ccySym);
  const realStr = fmtMoney(ctx.realP50, ctx.ccySym);
  const divStr = fmtMoney(ctx.annualDivFirstYear, ctx.ccySym);

  const extraClause = ctx.extraNotes
    ? `针对您特别提及的财务安排（${ctx.extraNotes}），本建议书在仓位久期与流动性层级上作出了专项隔离。`
    : "结合您的资金期限与风险预算，本建议书以跨周期资产分散作为核心防线。";

  const withdrawalClause = ctx.hasWithdrawal
    ? `在未来 ${ctx.years} 年内按计划执行资金提领的前提下，组合全程资金不断流保障率达 ${ctx.solvencyRatePct}%，期末中性净值（P50）预计达 ${p50Str}（折合今日真实购买力约 ${realStr}）。`
    : `在 ${ctx.years} 年长期复利持有期间，组合全程稳健运行概率达 ${ctx.solvencyRatePct}%，期末中性净值（P50）预计达 ${p50Str}（折合今日购买力约 ${realStr}）。`;

  const executive_summary =
    `尊敬的${ctx.clientName}：围绕您的核心目标「${ctx.goalsText}」与当前「${ctx.riskLabel}」风险预算，我们为您构建了 ${capStr} 规模的专属全球多资产配置方案。${extraClause}${withdrawalClause}`;

  const macro_and_strategy =
    `本方案采用「${ctx.cmaLabel}」进行前瞻性收益与风险预算建模。在当前美元基准利率维持 4.5% 高位区间、美股核心成长指数估值分位较高且股权风险溢价（ERP）相对收窄的宏观环境下，方案采取“三层架构”分工协同：` +
    (ctx.tacticalSummary ? ` ${ctx.tacticalSummary}` : " 以高确定性短债及优质固收锁定票息底仓，搭配低估值红利资产提供内生派息现金流，并保留全球核心权益捕捉长期通胀对冲与生产力复利。");

  const holdings_commentary: Record<string, string> = {};
  for (const h of ctx.holdings) {
    holdings_commentary[h.isin] = h.roleRationale;
  }

  const coveragePct =
    ctx.withdrawal > 0 ? Math.min(100, Math.round((ctx.annualDivFirstYear / ctx.withdrawal) * 100)) : 100;

  const cashflow_and_solvency = ctx.hasWithdrawal
    ? `按当前 ${ctx.divYieldPct}% 的组合参考派息率测算，首年预计自动产生内生分红现金流约 ${divStr}` +
      (ctx.withdrawal > 0 ? `（约可自然覆盖当期常规提领需求的 ${coveragePct}%，其余缺口通过再平衡有序调节）。` : "。") +
      (ctx.withdrawal2 > 0
        ? ` 对于第 ${ctx.withdrawalStart2} 年安排的 ${fmtMoney(ctx.withdrawal2, ctx.ccySym)} 专项大额支出，高息防御仓位将提供充裕的流动性安全垫，避免在市场波动期折价变现权益头寸。`
        : "")
    : `组合首年预计产生内生派息约 ${divStr}（年化股息率 ${ctx.divYieldPct}%）。在无定期提领阶段，全部派息将自动触发复利再投资（DRIP），持续压低持仓成本并增厚长期财富雪球。`;

  const worstHistorical = ctx.stressScenarios.reduce(
    (worst, s) =>
      s.max_drawdown_pct != null && (worst == null || s.max_drawdown_pct < (worst.max_drawdown_pct ?? 0))
        ? s
        : worst,
    null as { label: string; total_return_pct: number | null; max_drawdown_pct: number | null } | null
  );

  const risk_and_stress_commentary =
    `在 2,000 次前瞻蒙特卡洛压力模拟中，组合年化波动率为 ${ctx.volatilityPct}%，中性情景最大回撤约 ${ctx.ddP50Pct}%，极端 10% 逆风情景（P10）下回撤边界为 ${ctx.ddP10Pct}%。` +
    (worstHistorical
      ? ` 在历史真实危机回放中，即使面对「${worstHistorical.label}」，本组合历史最大回撤仍控制在 ${worstHistorical.max_drawdown_pct}% 以内，展现出显著优于单一股票头寸的抗跌韧性。`
      : " 建议严格执行半年度检视或 ±5% 资产权重偏离自动再平衡纪律，在牛市适度兑现盈利反哺防线，在市场恐慌期坚守底仓不割肉。");

  return {
    executive_summary,
    macro_and_strategy,
    holdings_commentary,
    cashflow_and_solvency,
    risk_and_stress_commentary,
    model_used: "WONDER Quant IPS Engine",
    provider: "deterministic",
  };
}

/**
 * 调用高阶 AI 模型（DeepSeek R1 / Claude 3.7 Sonnet / Gemini 2.5 Pro 等）协同撰写专属私行 IPS 报告叙事
 */
export async function generateClientReportNarrative(
  payload: any,
  env: Env
): Promise<ReportNarrativeResult> {
  const ctx = normalizeReportContext(payload);
  const fallback = buildDeterministicReportNarrative(ctx);
  const modelPref = (payload?.model || "auto") as ModelPreference;

  const holdingsText = ctx.holdings
    .map(
      (h) =>
        `- ${h.isin} (${h.name}): 类别=${h.sleeveLabel}, 权重=${h.weightPct}%, 首期金额=${fmtMoney(h.amount, ctx.ccySym)}, 股息率=${h.divYieldPct}%, 已有定位=${h.roleRationale}${h.isProxy ? ` [注: 代理基准 ${h.proxyBenchmark}]` : ""}`
    )
    .join("\n");

  const stressText =
    ctx.stressScenarios.length > 0
      ? ctx.stressScenarios
          .map(
            (s) =>
              `- ${s.label}: 区间收益 ${s.total_return_pct ?? "—"}%, 最大回撤 ${s.max_drawdown_pct ?? "—"}%`
          )
          .join("\n")
      : "未附加历史危机回放数据";

  const prompt = `你正在为瑞银/摩根大通水准的「WONDER Atelier 私人财富管理」撰写发给高净值客户的《专属资产配置与长期财富规划建议书 (IPS)》正文叙事。

【严格文风与准则】
1. 语气：庄重、克制、权威且富有同理心的私人银行首席投资官 (CIO) 口吻，使用简体中文。
2. 严禁使用任何 Emoji 表情符号，严禁空洞营销口号或保本承诺，所有论断必须锚定下方提供的真实数字。
3. 必须直面响应【客户补充情况与特别诉求】，把“为什么这样配权重”、“当前高利率+权益高估值宏观背景”以及“资金提领不断流机制”讲透。

【客户真实画像与约束】
- 客户称谓：${ctx.clientName}${ctx.clientAge ? `（${ctx.clientAge} 岁）` : ""}
- 核心目标：${ctx.goalsText} | 风险预算：${ctx.riskLabel}${ctx.riskScore != null ? ` (${ctx.riskScore}/100)` : ""}
- 配置资金：${fmtMoney(ctx.capital, ctx.ccySym)} (${ctx.currency}) | 规划期限：${ctx.years} 年 | 年化通胀假设：${ctx.inflationPct}%
- 现金流安排：${ctx.hasWithdrawal ? `第${ctx.withdrawalStart}-${ctx.withdrawalEnd}年常规提领 ${fmtMoney(ctx.withdrawal, ctx.ccySym)}/年${ctx.withdrawal2 > 0 ? `；第${ctx.withdrawalStart2}-${ctx.withdrawalEnd2}年专项/阶段提领 ${fmtMoney(ctx.withdrawal2, ctx.ccySym)}/年` : ""}` : "无定期提领，全额分红再投资"}
- 客户补充背景与特别诉求：${ctx.extraNotes || "无额外特殊诉求"}

【量化模拟与建仓方案】
- 组合名：${ctx.portfolioName} | 收益校准模型：${ctx.cmaLabel}
- 预期年化回报：${ctx.expectedReturnPct}% | 年化波动率：${ctx.volatilityPct}% | 夏普比率：${ctx.sharpeRatio} | 组合股息率：${ctx.divYieldPct}%
- 全程不断流保障率：${ctx.solvencyRatePct}% | P10/P50/P90 期末净值：${fmtMoney(ctx.p10, ctx.ccySym)} / ${fmtMoney(ctx.p50, ctx.ccySym)} / ${fmtMoney(ctx.p90, ctx.ccySym)}（P50折合今日购买力 ${fmtMoney(ctx.realP50, ctx.ccySym)}）
- 首年预计内生派息额：${fmtMoney(ctx.annualDivFirstYear, ctx.ccySym)}
- 底层资产与建仓明细：
${holdingsText}

【历史极端危机压力测试表现】
${stressText}

【输出格式要求】
请直接输出严格合法的 JSON 对象（不要加多余前缀后缀解释），字段如下：
{
  "executive_summary": "180-260字，面向客户的卷首执行摘要，总结客户诉求、配置总额与长期不断流保障",
  "macro_and_strategy": "200-300字，结合当前美元高利率与权益估值环境，阐明本方案三层防线设计思路与前瞻校准逻辑",
  "holdings_commentary": {
    "${ctx.holdings[0]?.isin || "ASSET"}": "25-45字，简明阐述该标的具体战略分工与匹配客户诉求的逻辑（必须覆盖上述每一个资产代码）"
  },
  "cashflow_and_solvency": "150-240字，解析组合内生股息覆盖比例、专项用款（如留学/退休）的流动性隔离与防割肉机制",
  "risk_and_stress_commentary": "160-240字，解读蒙特卡洛悲观边界 P10 与历史危机压力测试表现，给出再平衡纪律与极端情景应对指南"
}`;

  const llmRes = await callLlmChat(env, prompt, {
    modelPreference: modelPref,
    temperature: 0.3,
    maxTokens: 2800,
    systemPrompt:
      "你是 WONDER Atelier 私人银行首席投资官 (CIO) 与量化策略负责人，擅长为高净值家庭撰写严谨克制、数据详实的资产配置投资政策说明书 (IPS)。请严格返回合法 JSON。",
  });

  if (llmRes.provider === "fallback_rule") {
    return {
      ...fallback,
      model_used: llmRes.modelUsed,
      provider: llmRes.provider,
    };
  }

  try {
    let rawText = llmRes.text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    const fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced) rawText = fenced[1].trim();
    const startIdx = rawText.indexOf("{");
    const endIdx = rawText.lastIndexOf("}");
    if (startIdx >= 0 && endIdx > startIdx) {
      rawText = rawText.slice(startIdx, endIdx + 1);
    }
    const parsed = JSON.parse(rawText);

    const mergedHoldingsCommentary: Record<string, string> = { ...fallback.holdings_commentary };
    if (parsed?.holdings_commentary && typeof parsed.holdings_commentary === "object") {
      for (const h of ctx.holdings) {
        const candidate = parsed.holdings_commentary[h.isin];
        if (typeof candidate === "string" && candidate.trim()) {
          mergedHoldingsCommentary[h.isin] = candidate.trim();
        }
      }
    }

    return {
      executive_summary:
        typeof parsed?.executive_summary === "string" && parsed.executive_summary.trim()
          ? parsed.executive_summary.trim()
          : fallback.executive_summary,
      macro_and_strategy:
        typeof parsed?.macro_and_strategy === "string" && parsed.macro_and_strategy.trim()
          ? parsed.macro_and_strategy.trim()
          : fallback.macro_and_strategy,
      holdings_commentary: mergedHoldingsCommentary,
      cashflow_and_solvency:
        typeof parsed?.cashflow_and_solvency === "string" && parsed.cashflow_and_solvency.trim()
          ? parsed.cashflow_and_solvency.trim()
          : fallback.cashflow_and_solvency,
      risk_and_stress_commentary:
        typeof parsed?.risk_and_stress_commentary === "string" &&
        parsed.risk_and_stress_commentary.trim()
          ? parsed.risk_and_stress_commentary.trim()
          : fallback.risk_and_stress_commentary,
      model_used: llmRes.modelUsed,
      provider: llmRes.provider,
    };
  } catch {
    return {
      ...fallback,
      model_used: llmRes.modelUsed,
      provider: llmRes.provider,
    };
  }
}

// ── DOCX Styling Helpers (Nordic Private Bank Aesthetic) ─────────────────────
const FOREST = "1E4D3B";
const BRONZE = "9A6F38";
const CHARCOAL = "141413";
const SLATE = "57534E";
const IVORY = "FAF8F3";
const SUBTLE = "EFECE4";
const BORDER_HEX = "D5CFC3";

const CELL_BORDERS = {
  top: { style: BorderStyle.SINGLE, size: 4, color: BORDER_HEX },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDER_HEX },
  left: { style: BorderStyle.SINGLE, size: 4, color: BORDER_HEX },
  right: { style: BorderStyle.SINGLE, size: 4, color: BORDER_HEX },
};

function makeCell(
  text: string,
  opts: {
    bold?: boolean;
    color?: string;
    fill?: string;
    align?: (typeof AlignmentType)[keyof typeof AlignmentType];
    size?: number;
  } = {}
): TableCell {
  return new TableCell({
    borders: CELL_BORDERS,
    margins: { top: 90, bottom: 90, left: 130, right: 130 },
    ...(opts.fill
      ? { shading: { type: ShadingType.CLEAR, color: "auto", fill: opts.fill } }
      : {}),
    children: [
      new Paragraph({
        alignment: opts.align || AlignmentType.LEFT,
        children: [
          new TextRun({
            text: text || "—",
            bold: Boolean(opts.bold),
            color: opts.color || CHARCOAL,
            size: opts.size || 20,
          }),
        ],
      }),
    ],
  });
}

function makeSectionTitle(num: string, title: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 280, after: 120 },
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 6, color: FOREST },
    },
    children: [
      new TextRun({ text: `${num}  `, bold: true, color: BRONZE, size: 24 }),
      new TextRun({ text: title, bold: true, color: FOREST, size: 26 }),
    ],
  });
}

function makeBodyParagraph(text: string, spacingAfter = 140): Paragraph {
  return new Paragraph({
    spacing: { after: spacingAfter, line: 340 },
    children: [new TextRun({ text: text || "", color: CHARCOAL, size: 21 })],
  });
}

export async function generateWealthReportDocx(rawPayload: any, env: Env): Promise<Uint8Array> {
  const ctx = normalizeReportContext(rawPayload);
  const nowStr = new Date().toISOString().slice(0, 10);

  // 若前端已传入 AI 或人工编辑后的叙事段落，直接采用以保证所见即所得；否则按需调用 AI 生成
  const ex = ctx.existingNarrative;
  const hasCompleteClientNarrative = Boolean(
    ex &&
      typeof ex.executive_summary === "string" &&
      ex.executive_summary.trim() &&
      typeof ex.macro_and_strategy === "string" &&
      ex.macro_and_strategy.trim()
  );

  let narrative: ReportNarrativeResult;
  if (hasCompleteClientNarrative) {
    const fb = buildDeterministicReportNarrative(ctx);
    narrative = {
      executive_summary: ex!.executive_summary!.trim(),
      macro_and_strategy: ex!.macro_and_strategy!.trim(),
      holdings_commentary: { ...fb.holdings_commentary, ...(ex!.holdings_commentary || {}) },
      cashflow_and_solvency:
        (ex!.cashflow_and_solvency && ex!.cashflow_and_solvency.trim()) || fb.cashflow_and_solvency,
      risk_and_stress_commentary:
        (ex!.risk_and_stress_commentary && ex!.risk_and_stress_commentary.trim()) ||
        fb.risk_and_stress_commentary,
      model_used: "Client Edited / Pre-Generated",
      provider: "client",
    };
  } else if (env?.OPENROUTER_API_KEY || env?.DEEPSEEK_API_KEY) {
    narrative = await generateClientReportNarrative(rawPayload, env);
  } else {
    narrative = buildDeterministicReportNarrative(ctx);
  }

  const children: (Paragraph | Table)[] = [
    // Masthead
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
      children: [
        new TextRun({
          text: "WONDER ATELIER  ·  PRIVATE WEALTH MANAGEMENT",
          bold: true,
          color: BRONZE,
          size: 18,
        }),
      ],
    }),
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [
        new TextRun({
          text: `${ctx.clientName} · 专属资产配置与长期财富规划建议书`,
          bold: true,
          color: FOREST,
          size: 36,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 260 },
      children: [
        new TextRun({
          text: `${ctx.portfolioName}  |  基准币种 ${ctx.currency}  |  规划周期 ${ctx.years} 年  |  报告日期 ${nowStr}`,
          color: SLATE,
          size: 19,
        }),
      ],
    }),

    // Metadata Table
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            makeCell(`客户姓名：${ctx.clientName}${ctx.clientAge ? ` (${ctx.clientAge}岁)` : ""}`, {
              bold: true,
              fill: IVORY,
            }),
            makeCell(`专属顾问：${ctx.advisorName}`, { bold: true, fill: IVORY }),
          ],
        }),
        new TableRow({
          children: [
            makeCell(
              `风险预算：${ctx.riskLabel}${ctx.riskScore != null ? ` (${ctx.riskScore}/100)` : ""}`,
              { fill: "FFFFFF" }
            ),
            makeCell(`财务目标：${ctx.goalsText}`, { fill: "FFFFFF" }),
          ],
        }),
        new TableRow({
          children: [
            makeCell(`初始配置规模：${fmtMoney(ctx.capital, ctx.ccySym)} (${ctx.currency})`, {
              fill: IVORY,
            }),
            makeCell(`收益校准模型：${ctx.cmaLabel}`, { fill: IVORY }),
          ],
        }),
      ],
    }),

    // Chapter 01: Executive Mandate & Client Profile
    makeSectionTitle("01", "客户财务画像、核心诉求与执行摘要"),
    makeBodyParagraph(narrative.executive_summary),
    ...(ctx.extraNotes
      ? [
          new Paragraph({
            spacing: { after: 160 },
            shading: { type: ShadingType.CLEAR, color: "auto", fill: SUBTLE },
            border: { left: { style: BorderStyle.SINGLE, size: 18, color: BRONZE } },
            children: [
              new TextRun({ text: "  客户补充诉求与家庭财务约束：", bold: true, color: FOREST, size: 20 }),
              new TextRun({ text: ctx.extraNotes, color: CHARCOAL, size: 20 }),
            ],
          }),
        ]
      : []),

    // Chapter 02: KPI & Monte Carlo Overview
    makeSectionTitle("02", "组合核心风险收益与蒙特卡洛前瞻总览"),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            makeCell("核心量化评估维度", { bold: true, color: "FFFFFF", fill: FOREST }),
            makeCell("测算结果", { bold: true, color: "FFFFFF", fill: FOREST, align: AlignmentType.RIGHT }),
            makeCell("专业含义解读", { bold: true, color: "FFFFFF", fill: FOREST }),
          ],
        }),
        new TableRow({
          children: [
            makeCell("全程资金不断流保障率", { bold: true, fill: IVORY }),
            makeCell(`${ctx.solvencyRatePct}%`, { bold: true, color: FOREST, fill: IVORY, align: AlignmentType.RIGHT }),
            makeCell("在 2,000 条模拟路径中全周期资金保持充裕不断流的比例", { fill: IVORY }),
          ],
        }),
        new TableRow({
          children: [
            makeCell("组合预期年化总回报", { bold: true }),
            makeCell(`${ctx.expectedReturnPct}%`, { bold: true, align: AlignmentType.RIGHT }),
            makeCell(`基于「${ctx.cmaLabel}」的前瞻年化中枢`, {}),
          ],
        }),
        new TableRow({
          children: [
            makeCell("年化波动率 / 夏普比率", { bold: true, fill: IVORY }),
            makeCell(`${ctx.volatilityPct}% / ${ctx.sharpeRatio}`, { bold: true, fill: IVORY, align: AlignmentType.RIGHT }),
            makeCell("单位波动风险所换取的超额收益效率评估", { fill: IVORY }),
          ],
        }),
        new TableRow({
          children: [
            makeCell("组合内生参考派息率", { bold: true }),
            makeCell(`${ctx.divYieldPct}% (${fmtMoney(ctx.annualDivFirstYear, ctx.ccySym)}/年)`, {
              bold: true,
              color: BRONZE,
              align: AlignmentType.RIGHT,
            }),
            makeCell("底层成分股/债首年预计自然派息现金流", {}),
          ],
        }),
        new TableRow({
          children: [
            makeCell(`${ctx.years} 年中性期末净值 (P50)`, { bold: true, fill: IVORY }),
            makeCell(`${fmtMoney(ctx.p50, ctx.ccySym)}`, { bold: true, color: FOREST, fill: IVORY, align: AlignmentType.RIGHT }),
            makeCell(`按 ${ctx.inflationPct}% 年均通胀折算今日真实购买力约 ${fmtMoney(ctx.realP50, ctx.ccySym)}`, { fill: IVORY }),
          ],
        }),
        new TableRow({
          children: [
            makeCell(`极端逆风底线 / 顺风展望 (P10 / P90)`, { bold: true }),
            makeCell(`${fmtMoney(ctx.p10, ctx.ccySym)} / ${fmtMoney(ctx.p90, ctx.ccySym)}`, {
              bold: true,
              align: AlignmentType.RIGHT,
            }),
            makeCell(`蒙特卡洛 10% 最差尾部底线与 90% 顺风预期`, {}),
          ],
        }),
      ],
    }),

    // Chapter 03: Macro Clock & 3-Layer Allocation Plan
    makeSectionTitle("03", "宏观时钟建构思路与首期建仓清单"),
    makeBodyParagraph(narrative.macro_and_strategy),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            makeCell("代码", { bold: true, color: "FFFFFF", fill: FOREST }),
            makeCell("资产名称与战略层级", { bold: true, color: "FFFFFF", fill: FOREST }),
            makeCell("权重", { bold: true, color: "FFFFFF", fill: FOREST, align: AlignmentType.RIGHT }),
            makeCell("首期建仓金额", { bold: true, color: "FFFFFF", fill: FOREST, align: AlignmentType.RIGHT }),
            makeCell("股息率", { bold: true, color: "FFFFFF", fill: FOREST, align: AlignmentType.RIGHT }),
            makeCell("配置角色与选基逻辑", { bold: true, color: "FFFFFF", fill: FOREST }),
          ],
        }),
        ...ctx.holdings.map((h, i) => {
          const fill = i % 2 === 0 ? IVORY : "FFFFFF";
          const comment = narrative.holdings_commentary[h.isin] || h.roleRationale;
          return new TableRow({
            children: [
              makeCell(h.isin, { bold: true, color: FOREST, fill }),
              makeCell(`${h.name} [${h.sleeveLabel}]${h.isProxy ? ` (基准代理: ${h.proxyBenchmark})` : ""}`, { fill }),
              makeCell(`${h.weightPct.toFixed(1)}%`, { bold: true, fill, align: AlignmentType.RIGHT }),
              makeCell(fmtMoney(h.amount, ctx.ccySym), { bold: true, fill, align: AlignmentType.RIGHT }),
              makeCell(h.divYieldPct > 0 ? `${h.divYieldPct.toFixed(2)}%` : "—", { fill, align: AlignmentType.RIGHT }),
              makeCell(comment, { fill, size: 18 }),
            ],
          });
        }),
        new TableRow({
          children: [
            makeCell("合计", { bold: true, fill: SUBTLE }),
            makeCell(`共 ${ctx.holdings.length} 项跨周期核心配置标的`, { bold: true, fill: SUBTLE }),
            makeCell("100.0%", { bold: true, color: FOREST, fill: SUBTLE, align: AlignmentType.RIGHT }),
            makeCell(fmtMoney(ctx.capital, ctx.ccySym), { bold: true, color: FOREST, fill: SUBTLE, align: AlignmentType.RIGHT }),
            makeCell(`${ctx.divYieldPct.toFixed(2)}%`, { bold: true, color: BRONZE, fill: SUBTLE, align: AlignmentType.RIGHT }),
            makeCell(`首年预计产生内生派息约 ${fmtMoney(ctx.annualDivFirstYear, ctx.ccySym)}`, { fill: SUBTLE, size: 18 }),
          ],
        }),
      ],
    }),

    // Chapter 04: Cashflow & Life Milestones
    makeSectionTitle("04", "全周期现金流规划与人生关键里程碑"),
    makeBodyParagraph(narrative.cashflow_and_solvency),
    ...(ctx.milestones.length > 0
      ? [
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  makeCell("关键年份", { bold: true, color: "FFFFFF", fill: FOREST }),
                  makeCell("对应年龄", { bold: true, color: "FFFFFF", fill: FOREST, align: AlignmentType.CENTER }),
                  makeCell("悲观底线 (P10)", { bold: true, color: "FFFFFF", fill: FOREST, align: AlignmentType.RIGHT }),
                  makeCell("中性基准 (P50)", { bold: true, color: "FFFFFF", fill: FOREST, align: AlignmentType.RIGHT }),
                  makeCell("乐观展望 (P90)", { bold: true, color: "FFFFFF", fill: FOREST, align: AlignmentType.RIGHT }),
                  makeCell("阶段规划意义", { bold: true, color: "FFFFFF", fill: FOREST }),
                ],
              }),
              ...ctx.milestones.map((m, idx) => {
                const fill = idx % 2 === 0 ? IVORY : "FFFFFF";
                return new TableRow({
                  children: [
                    makeCell(`第 ${m.year} 年`, { bold: true, fill }),
                    makeCell(m.age ? `${m.age} 岁` : "—", { fill, align: AlignmentType.CENTER }),
                    makeCell(fmtMoney(m.p10, ctx.ccySym), { color: "991B1B", fill, align: AlignmentType.RIGHT }),
                    makeCell(fmtMoney(m.p50, ctx.ccySym), { bold: true, color: FOREST, fill, align: AlignmentType.RIGHT }),
                    makeCell(fmtMoney(m.p90, ctx.ccySym), { color: "166534", fill, align: AlignmentType.RIGHT }),
                    makeCell(m.note, { fill, size: 18 }),
                  ],
                });
              }),
            ],
          }),
        ]
      : []),

    // Chapter 05: Historical Stress Replay & Risk Boundaries
    makeSectionTitle("05", "历史真实危机压力测试与风控边界"),
    makeBodyParagraph(narrative.risk_and_stress_commentary),
    ...(ctx.stressScenarios.length > 0
      ? [
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  makeCell("历史极端市场危机窗口", { bold: true, color: "FFFFFF", fill: FOREST }),
                  makeCell("组合区间累积回报", { bold: true, color: "FFFFFF", fill: FOREST, align: AlignmentType.RIGHT }),
                  makeCell("组合区间最大回撤", { bold: true, color: "FFFFFF", fill: FOREST, align: AlignmentType.RIGHT }),
                ],
              }),
              ...ctx.stressScenarios.map((sc, i) => {
                const fill = i % 2 === 0 ? IVORY : "FFFFFF";
                return new TableRow({
                  children: [
                    makeCell(sc.label, { bold: true, fill }),
                    makeCell(
                      sc.total_return_pct != null ? `${sc.total_return_pct >= 0 ? "+" : ""}${sc.total_return_pct}%` : "—",
                      {
                        bold: true,
                        color: (sc.total_return_pct || 0) >= 0 ? "166534" : "991B1B",
                        fill,
                        align: AlignmentType.RIGHT,
                      }
                    ),
                    makeCell(
                      sc.max_drawdown_pct != null ? `${sc.max_drawdown_pct}%` : "—",
                      { bold: true, color: "991B1B", fill, align: AlignmentType.RIGHT }
                    ),
                  ],
                });
              }),
            ],
          }),
        ]
      : []),

    // Chapter 06: Governance & Disclaimers
    makeSectionTitle("06", "后续陪伴纪律与重要合规声明"),
    makeBodyParagraph(
      "• 再平衡纪律：建议设定 ±5% 权重偏离触发机制或每半年度定期检视，避免情绪化追涨杀跌。\n" +
        "• 熊市应对守则：遭遇系统性回撤时优先动用货币/短债票息及分红安全垫应对现金需求，避免在估值底部折价变现核心权益。\n" +
        `• 顾问联系：${ctx.advisorName} 将持续为您跟踪组合漂移与宏观估值时钟变化。`
    ),
    new Paragraph({
      spacing: { before: 160 },
      shading: { type: ShadingType.CLEAR, color: "auto", fill: SUBTLE },
      children: [
        new TextRun({
          text:
            "重要合规提示：本建议书所载量化模拟与压力测试数据基于历史样本与前瞻资本市场假设推演，仅供资产配置研究与规划探讨之用，不构成任何证券买卖要约、保本承诺或监管牌照项下正式投资建议。市场有风险，过往表现不预示未来回报。",
          color: SLATE,
          size: 17,
        }),
      ],
    }),
  ];

  const doc = new Document({
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return new Uint8Array(buffer);
}
