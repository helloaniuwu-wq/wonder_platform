import React, { useMemo, useState, useCallback } from 'react';
import {
  AreaChart,
  Area,
  Bar,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import {
  Sparkles,
  Printer,
  Download,
  Edit3,
  Check,
  UserCheck,
  FileText,
  X,
  ShieldCheck,
  Scale,
  Compass,
} from 'lucide-react';
import { authHeaders } from '../utils/auth';
import XRayReportSection from './XRayReportSection';
import { computePortfolioXRay } from '../utils/portfolioXRay';

// ── 可编辑文本块（定义在外部，确保焦点与 DOM 稳定性）──────────────────────────
const EditableText = ({ fieldKey, tag = 'p', style, className, children, editMode, editableFields, onBlur }) => {
  const Tag = tag;
  const ref = React.useRef(null);

  React.useEffect(() => {
    if (editMode && ref.current && ref.current.isConnected) {
      const val = editableFields[fieldKey];
      ref.current.innerText =
        val !== undefined && val !== null
          ? val
          : typeof children === 'string'
            ? children
            : ref.current.innerText || '';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode, fieldKey]);

  if (!editMode) {
    return (
      <Tag style={style} className={className}>
        {editableFields[fieldKey] ?? children}
      </Tag>
    );
  }

  return (
    <Tag
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      onBlur={(e) => onBlur(fieldKey, e)}
      style={{
        ...style,
        outline: '1.5px dashed #9A6F38',
        borderRadius: 4,
        minHeight: '1.2em',
        cursor: 'text',
        background: 'rgba(154, 111, 56, 0.06)',
        padding: '2px 4px',
      }}
      className={className}
    />
  );
};

const GOAL_LABELS = {
  income: '现金流收息',
  preservation: '稳健保值',
  balanced: '平衡增值',
  growth: '长期成长',
  retirement: '退休收入保障',
  education: '子女教育基金',
  legacy: '家族财富传承',
  liquidity: '高流动性储备',
};

const CMA_LABELS = {
  forward_looking: '宏观利率与估值时钟前瞻',
  shrunk: '贝叶斯大类历史收缩',
  ltcma: '长期资本市场假设 (LTCMA)',
  raw: '纯历史样本回归',
};

function ccySym(ccy = 'USD') {
  const u = String(ccy || 'USD').toUpperCase();
  if (u === 'HKD') return 'HK$';
  if (u === 'CNY' || u === 'RMB') return '¥';
  if (u === 'SGD') return 'S$';
  if (u === 'EUR') return '€';
  if (u === 'GBP') return '£';
  return '$';
}

function numFmt(val) {
  if (val === undefined || val === null || isNaN(val)) return '0';
  return Math.round(Number(val)).toLocaleString('zh-CN');
}

function inferSleeve(isin, stats = {}) {
  const ac = `${stats.asset_class || ''} ${stats.name || ''} ${isin}`.toLowerCase();
  if (
    ac.includes('cash') ||
    ac.includes('货币') ||
    ac.includes('现金') ||
    ac.includes('bond') ||
    ac.includes('债') ||
    ac.includes('固收') ||
    ['BIL', 'SGOV', 'SHV', 'CSH2', 'BND', 'AGG', 'TLT', 'IEF', 'SHY', 'HYG', 'LQD'].includes(
      String(isin).toUpperCase()
    )
  ) {
    return { label: '流动性与高息防线', badge: 'bronze' };
  }
  if (
    ac.includes('dividend') ||
    ac.includes('红利') ||
    ac.includes('股息') ||
    ac.includes('income') ||
    ac.includes('收益') ||
    (stats.dividend_yield || 0) >= 0.03
  ) {
    return { label: '生息防御压舱石', badge: 'forest' };
  }
  return { label: '长期复利增长舱', badge: 'forest' };
}

function buildMilestones(chart, mcSettings, clientAge, sym) {
  const years = parseInt(mcSettings.years, 10) || 15;
  const contribEnd = parseInt(mcSettings.contribution_years, 10) || 0;
  const withdrawStart = parseInt(mcSettings.withdrawal_start, 10) || 0;
  const w2 = parseFloat(mcSettings.withdrawal_2) || 0;
  const w2Start = parseInt(mcSettings.withdrawal_start_2, 10) || 0;

  const candidates = [];
  if (w2 > 0 && w2Start > 0 && w2Start <= years) {
    candidates.push({
      year: w2Start,
      label: clientAge ? `第 ${w2Start} 年（${clientAge + w2Start} 岁）` : `第 ${w2Start} 年`,
      note: `专项大额支出（${sym}${numFmt(w2)}）执行后账户结余检验`,
    });
  }
  if ((parseFloat(mcSettings.withdrawal) || 0) > 0 && withdrawStart > 0 && withdrawStart <= years && !candidates.find((c) => c.year === withdrawStart)) {
    candidates.push({
      year: withdrawStart,
      label: clientAge ? `第 ${withdrawStart} 年（${clientAge + withdrawStart} 岁）` : `第 ${withdrawStart} 年`,
      note: '启动常规现金流提取阶段',
    });
  }
  if (contribEnd > 0 && (parseFloat(mcSettings.contribution) || 0) > 0 && contribEnd <= years && !candidates.find((c) => c.year === contribEnd)) {
    candidates.push({
      year: contribEnd,
      label: clientAge ? `第 ${contribEnd} 年（${clientAge + contribEnd} 岁）` : `第 ${contribEnd} 年`,
      note: '定投/追加期圆满完成，进入纯复利期',
    });
  }
  for (const y of [5, 10, 15, 20, 25, 30]) {
    if (y <= years && !candidates.find((c) => c.year === y)) {
      candidates.push({
        year: y,
        label: clientAge ? `第 ${y} 年（${clientAge + y} 岁）` : `第 ${y} 年`,
        note: y <= 10 ? '中期复利稳步成型，防御防线验证' : '跨周期长期复利加速与抗通胀检验',
      });
    }
  }
  if (clientAge) {
    [60, 65, 70, 80].forEach((targetAge) => {
      const yr = targetAge - clientAge;
      if (yr > 0 && yr <= years && !candidates.find((c) => c.year === yr)) {
        candidates.push({
          year: yr,
          label: `${targetAge} 岁（第 ${yr} 年）`,
          note: targetAge === 65 ? '标准退休人生关键切换点' : '长寿现金流可持续性核心节点',
        });
      }
    });
  }
  if (!candidates.find((c) => c.year === years)) {
    candidates.push({
      year: years,
      label: clientAge ? `规划终点（${clientAge + years} 岁）` : `规划终点（第 ${years} 年）`,
      note: '全规划周期期末资产总清算快照',
    });
  }

  const chartMap = {};
  (chart || []).forEach((pt) => {
    chartMap[pt.year] = pt;
  });

  return candidates
    .sort((a, b) => a.year - b.year)
    .slice(0, 8)
    .map((m) => {
      const pt = chartMap[m.year] || {};
      return {
        ...m,
        p10: pt.combined_p10 ?? pt.p10 ?? null,
        p50: pt.combined_p50 ?? pt.p50 ?? null,
        p90: pt.combined_p90 ?? pt.p90 ?? null,
      };
    })
    .filter((m) => m.p50 !== null);
}

const WealthReportContent = ({
  labData,
  labMcSettings,
  labBaseCurrency,
  stressTestData,
  xrayData = null,
  quantFunds = [],
  ilpEnabled,
  ilpConfig,
  insurancePlan,
  insuranceEnabled,
  clientInfo,
  onOpenClientInfo,
  onClose,
  onGenerateWord,
  reportLoading,
  onSwitchBrief,
}) => {
  const mcResult = labData.monte_carlo;
  const currency = (labBaseCurrency || labData?.base_currency || 'USD').toUpperCase();
  const sym = ccySym(currency);

  const dd = mcResult.drawdown || { p10: 0, p50: 0, p90: 0 };
  const cdd = mcResult.combined_drawdown || { p10: 0, p50: 0, p90: 0 };

  const ci = clientInfo || {};
  const clientAge = ci.age ? parseInt(ci.age, 10) : null;
  const clientName = ci.client_name || ci.name || '';
  const clientGoals = Array.isArray(ci.goals) ? ci.goals : [];
  const advisorName = ci.advisor || 'WONDER Atelier 财富顾问团队';
  const extraNotes = ci.extra_notes || '';
  const riskLabelZh = ci.risk_label_zh || '均衡稳健型';
  const riskScore = ci.risk_score;
  const envelope = ci.target_envelope || null;
  const portfolioTitle = ci.basket_title || '多资产全球配置专户方案';
  const tacticalSummary = ci.tactical_summary_zh || '';

  const mcTargetKey = labData.mc_target_label || (labData.custom_portfolio ? 'custom_portfolio' : 'max_sharpe');
  const mcTargetPortfolio = labData[mcTargetKey] || labData.max_sharpe || {};
  const cmaMode = labData.cma_mode || labMcSettings.cma_mode || 'forward_looking';
  const cmaLabel = CMA_LABELS[cmaMode] || cmaMode;

  const inflationDec = (parseFloat(labMcSettings.inflation) || 0) / 100;
  const runYears = parseInt(labMcSettings.years, 10) || 15;
  const capital = parseFloat(labMcSettings.capital) || 0;
  const discountFactor = Math.pow(1 + inflationDec, runYears);

  const lastChartPoint = mcResult.chart[mcResult.chart.length - 1] || {};
  const isCombined = insuranceEnabled && lastChartPoint.combined_p50 !== undefined;
  const p10 = isCombined ? lastChartPoint.combined_p10 : lastChartPoint.p10 || 0;
  const p50 = isCombined ? lastChartPoint.combined_p50 : lastChartPoint.p50 || 0;
  const pureP50 = lastChartPoint.p50 || 0;
  const realP50 = discountFactor > 0 ? p50 / discountFactor : p50;

  const withdrawal1 = parseFloat(labMcSettings.withdrawal) || 0;
  const withdrawal2 = parseFloat(labMcSettings.withdrawal_2) || 0;
  const hasWithdrawal = withdrawal1 > 0 || withdrawal2 > 0;

  const solvencyRate = mcResult.solvency_rate ?? mcResult.success_rate ?? 1;
  const solvencyPctStr = (solvencyRate * 100).toFixed(1);
  const successPctStr = ((mcResult.success_rate ?? 1) * 100).toFixed(1);

  const insStats = mcResult.insurance_stats || null;
  const insContribP50 = isCombined ? lastChartPoint.combined_p50 - lastChartPoint.p50 : 0;
  const insContribP10 = isCombined ? lastChartPoint.combined_p10 - lastChartPoint.p10 : 0;
  const ddImprovementP10 = isCombined ? Math.abs(dd.p10) - Math.abs(cdd.p10) : 0;
  const totInsWithdrawal = insStats?.total_insurance_withdrawal || 0;
  const withdrawalCovPct = insStats?.withdrawal_coverage_pct || 0;

  const divYieldPct = (mcTargetPortfolio.dividend_yield || 0) * 100;
  const firstYrDiv =
    mcResult.chart.length > 1 && mcResult.chart[1]?.div_generated > 0
      ? mcResult.chart[1].div_generated
      : Math.round((capital * divYieldPct) / 100);
  const divCoverRatio = withdrawal1 > 0 ? Math.min(100, Math.round((firstYrDiv / withdrawal1) * 100)) : 100;

  const maxHistDdPct = Math.abs(labData.portfolio_diagnostics?.max_drawdown ?? dd.p50 ?? 0) * 100;

  const holdingRows = useMemo(() => {
    const rationaleMap = ci.holdings_rationale || {};
    return Object.entries(mcTargetPortfolio.allocations || {})
      .filter(([, w]) => Number(w) > 0.001)
      .sort((a, b) => Number(b[1]) - Number(a[1]))
      .map(([isin, weight]) => {
        const w = Number(weight);
        const stats = labData.asset_stats?.[isin] || {};
        const sleeve = inferSleeve(isin, stats);
        const defaultRole =
          rationaleMap[isin] ||
          (sleeve.label === '流动性与高息防线'
            ? '锁定当前高确定性无风险/固收票息，缓冲组合波动并保障近期用款'
            : sleeve.label === '生息防御压舱石'
              ? '提供可持续内生股息现金流，减少市场回调期被迫变卖本金需求'
              : '捕捉全球核心生产力与权益复利，对抗长期通胀侵蚀');
        return {
          isin,
          name: stats.name || isin,
          assetClass: stats.asset_class || sleeve.label,
          sleeve,
          weightPct: w * 100,
          amount: capital * w,
          expRetPct: (stats.expected_return || 0) * 100,
          divYieldPct: (stats.dividend_yield || 0) * 100,
          defaultRole,
          isProxy: Boolean(stats.is_proxy),
          proxyBenchmark: stats.proxy_benchmark || null,
        };
      });
  }, [mcTargetPortfolio.allocations, labData.asset_stats, capital, ci.holdings_rationale]);

  const milestones = useMemo(
    () => buildMilestones(mcResult.chart, labMcSettings, clientAge, sym),
    [mcResult.chart, labMcSettings, clientAge, sym]
  );

  // Cashflow schedule summary rows
  const withdrawSchedule = useMemo(() => {
    const start = parseInt(labMcSettings.withdrawal_start, 10) || 1;
    const end = parseInt(labMcSettings.withdrawal_end, 10) || runYears;
    const start2 = parseInt(labMcSettings.withdrawal_start_2, 10) || 1;
    const end2 = parseInt(labMcSettings.withdrawal_end_2, 10) || runYears;
    const insYears = insurancePlan?.years || [];
    if (!hasWithdrawal && !(insuranceEnabled && insYears.length > 0)) return [];

    const rows = [];
    let cum = 0;
    for (let y = 1; y <= runYears; y++) {
      const factor = labMcSettings.withdrawal_inflation ? Math.pow(1 + inflationDec, y - 1) : 1;
      let portDraw = 0;
      if (withdrawal1 > 0 && y >= start && y <= end) portDraw += Math.round(withdrawal1 * factor);
      if (withdrawal2 > 0 && y >= start2 && y <= end2) portDraw += Math.round(withdrawal2 * factor);
      const insAmt = insuranceEnabled && insYears[y - 1] ? Math.round(insYears[y - 1].withdrawal || 0) : 0;
      if (portDraw > 0 || insAmt > 0) {
        cum += portDraw + insAmt;
        const pt = (mcResult.chart || []).find((c) => c.year === y) || {};
        rows.push({
          year: y,
          age: clientAge ? clientAge + y : null,
          portDraw,
          insAmt,
          total: portDraw + insAmt,
          divGenerated: Math.round(pt.div_generated || 0),
          cumulative: cum,
        });
      }
    }
    if (rows.length <= 10) return rows;
    return rows.filter((r, i) => i < 4 || r.year === start2 || (r.year % 5 === 0) || i === rows.length - 1);
  }, [labMcSettings, runYears, inflationDec, insurancePlan, insuranceEnabled, hasWithdrawal, withdrawal1, withdrawal2, mcResult.chart, clientAge]);

  const cfChartData = useMemo(() => {
    const data = [];
    const start1 = parseInt(labMcSettings.withdrawal_start, 10) || 1;
    const end1 = parseInt(labMcSettings.withdrawal_end, 10) || runYears;
    const start2 = parseInt(labMcSettings.withdrawal_start_2, 10) || 1;
    const end2 = parseInt(labMcSettings.withdrawal_end_2, 10) || runYears;
    const cStart = parseInt(labMcSettings.contribution_start, 10) || 1;
    const cEnd = parseInt(labMcSettings.contribution_years, 10) || 0;

    for (let y = 1; y <= runYears; y++) {
      const factor = labMcSettings.withdrawal_inflation ? Math.pow(1 + inflationDec, y - 1) : 1;
      let draw = 0;
      if (withdrawal1 > 0 && y >= start1 && y <= end1) draw += Math.round(withdrawal1 * factor);
      if (withdrawal2 > 0 && y >= start2 && y <= end2) draw += Math.round(withdrawal2 * factor);
      const add = !ilpEnabled && (parseFloat(labMcSettings.contribution) || 0) > 0 && y >= cStart && y <= cEnd
        ? -Math.round(parseFloat(labMcSettings.contribution))
        : 0;
      const pt = (mcResult.chart || []).find((c) => c.year === y) || {};
      const insAmt = insuranceEnabled && insurancePlan?.years?.[y - 1]
        ? Math.round(insurancePlan.years[y - 1].withdrawal || 0)
        : 0;
      data.push({
        name: `Y${y}`,
        组合追加: add,
        组合提取: draw,
        保单提取: insAmt,
        内生分红: Math.round(pt.div_generated || 0),
      });
    }
    return data;
  }, [labMcSettings, runYears, inflationDec, withdrawal1, withdrawal2, ilpEnabled, insuranceEnabled, insurancePlan, mcResult.chart]);

  const availableStress = useMemo(
    () => (Array.isArray(stressTestData?.scenarios) ? stressTestData.scenarios.filter((s) => s.available) : []),
    [stressTestData]
  );

  const goalText =
    clientGoals.length > 0
      ? clientGoals.map((g) => GOAL_LABELS[g] || g).join(' · ')
      : '资产稳健保值 · 跨周期风险收益平衡';

  const reportDate = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });

  // ── Inline Editable Narratives & AI Co-Author State ─────────────────────────
  const [editMode, setEditMode] = useState(false);
  const [aiModel, setAiModel] = useState('reasoner');
  const [aiWriting, setAiWriting] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiUsedLabel, setAiUsedLabel] = useState('');

  const defaultExecSummary = `${clientName ? `尊敬的${clientName}：` : ''}围绕您设定的核心目标「${goalText}」与「${riskLabelZh}」风险预算，本建议书构建了初始规模 ${sym}${numFmt(capital)}（${currency}）的跨周期配置方案。${extraNotes ? `针对您特别提及的诉求（${extraNotes}），组合在流动性层级与权益风险暴露上均作了专项久期校准。` : ''}在 ${runYears} 年前瞻蒙特卡洛压力测试中，全周期资金不断流保障率达 ${solvencyPctStr}%，期末中性预期净值达 ${sym}${numFmt(p50)}（折合今日购买力约 ${sym}${numFmt(realP50)}）。`;

  const defaultMacroStrategy = `本方案采用「${cmaLabel}」进行前瞻期望校准。针对当前美元无风险利率处于高位区间（短债收益率具备约 4.5% 确定性票息支撑）、而美股宽基核心指数估值分位较高且股权风险溢价（ERP）相对收窄的市场结构，组合采取三层防御与增长耦合设计：${tacticalSummary || '以短久期高息债构筑安全气垫与近期刚性用款专款锁仓，搭配低估值红利资产贡献内生派息，并保留核心宽基敞口对抗长期通胀购买力缩水。'}`;

  const defaultCashflowSolvency = hasWithdrawal
    ? `组合年化参考派息率达 ${divYieldPct.toFixed(2)}%，首年预计自动生成内生股息与票息现金流约 ${sym}${numFmt(firstYrDiv)}${withdrawal1 > 0 ? `（约可自然覆盖当期常规提领需求 ${divCoverRatio}%）` : ''}。${withdrawal2 > 0 ? `针对第 ${labMcSettings.withdrawal_start_2} 年预设的 ${sym}${numFmt(withdrawal2)} 专项大额支出，高息流动性底仓可提前隔离市场波动风险，杜绝熊市折价卖股。` : ''}`
    : `组合首年预计产生内生派息约 ${sym}${numFmt(firstYrDiv)}（参考派息率 ${divYieldPct.toFixed(2)}%）。在积累阶段，全部派息将自动触发分红再投资（DRIP），持续积累低成本份额、加速长期复利滚雪球。`;

  const defaultRiskCommentary = `前瞻蒙特卡洛 2,000 条平行路径显示，组合年化波动率为 ${((mcTargetPortfolio.volatility || 0) * 100).toFixed(1)}%，中性情景最大回撤约 ${(Math.abs(dd.p50) * 100).toFixed(1)}%，极端逆风 P10 情景最大回撤边界为 ${(Math.abs(dd.p10) * 100).toFixed(1)}%。${availableStress.length > 0 ? '历史极端危机压力窗口回放验证了多资产跨周期对冲韧性。' : ''}建议严守 ±5% 漂移再平衡或半年度定期检视纪律，顺周期锁利、逆周期保持筹码稳定。`;

  const [editableFields, setEditableFields] = useState({
    executive_summary: defaultExecSummary,
    macro_and_strategy: defaultMacroStrategy,
    cashflow_and_solvency: defaultCashflowSolvency,
    risk_and_stress_commentary: defaultRiskCommentary,
    aboutUs: `本《专属资产配置建议书 (IPS)》由 ${advisorName} 依托 WONDER Atelier 买方量化研究引擎编制。我们致力于以机构级风控标准与透明买方视角，协助家庭穿越宏观利率周期与市场波动。`,
    aboutService:
      '投资组合交付仅是长期陪伴的起点。我们将持续为您跟踪持仓权重漂移（±5% 阈值触发提醒）、底仓派息覆盖率与宏观估值分位数切换，并每半年度出具深度检视复盘。',
  });

  const handleFieldBlur = useCallback((fieldKey, e) => {
    const text = e.currentTarget.innerText;
    setEditableFields((prev) => ({ ...prev, [fieldKey]: text }));
  }, []);

  const editProps = { editMode, editableFields, onBlur: handleFieldBlur };

  const handleAiCoAuthor = async () => {
    setAiWriting(true);
    setAiError('');
    try {
      const res = await fetch('/api/lab/report-narrative', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          model: aiModel,
          lab_result: labData,
          client_info: clientInfo || {},
          stress_test: stressTestData || null,
          base_currency: currency,
          mc_settings: {
            ...labMcSettings,
            inflation_pct: Number(labMcSettings.inflation),
          },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.detail || json.error || `HTTP ${res.status}`);

      setEditableFields((prev) => {
        const next = {
          ...prev,
          executive_summary: json.executive_summary || prev.executive_summary,
          macro_and_strategy: json.macro_and_strategy || prev.macro_and_strategy,
          cashflow_and_solvency: json.cashflow_and_solvency || prev.cashflow_and_solvency,
          risk_and_stress_commentary: json.risk_and_stress_commentary || prev.risk_and_stress_commentary,
        };
        if (json.holdings_commentary && typeof json.holdings_commentary === 'object') {
          Object.entries(json.holdings_commentary).forEach(([k, v]) => {
            if (typeof v === 'string' && v.trim()) {
              next[`role_${k}`] = v.trim();
            }
          });
        }
        return next;
      });
      setAiUsedLabel(`${json.model_used || aiModel}`);
    } catch (err) {
      setAiError(err.message || 'AI 撰写失败，请检查模型配置或稍后重试');
    } finally {
      setAiWriting(false);
    }
  };

  const buildWordPayloadFromEdits = () => {
    const holdings_commentary = {};
    holdingRows.forEach((h) => {
      holdings_commentary[h.isin] = editableFields[`role_${h.isin}`] || h.defaultRole;
    });
    return {
      executive_summary: editableFields.executive_summary,
      macro_and_strategy: editableFields.macro_and_strategy,
      cashflow_and_solvency: editableFields.cashflow_and_solvency,
      risk_and_stress_commentary: editableFields.risk_and_stress_commentary,
      holdings_commentary,
    };
  };

  return (
    <div className="wealth-report-overlay">
      <div className="wealth-report-container" onClick={(e) => e.stopPropagation()}>
        {/* ── 控制工具栏（打印时自动隐藏）──────────────────────────────────── */}
        <div
          className="wealth-report-controls no-print"
          style={{
            background: '#1C1B19',
            border: '1px solid #35322D',
            borderRadius: '8px',
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '10px',
            flexWrap: 'wrap',
          }}
        >
          {/* 左：模式与客户档案 */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#D4B07A', padding: '5px 10px', borderRadius: '4px', background: 'rgba(154,111,56,0.16)', border: '1px solid rgba(154,111,56,0.4)' }}>
              <FileText size={13} style={{ verticalAlign: '-2px', marginRight: '4px' }} />
              完整投顾建议书 (IPS)
            </span>
            {onSwitchBrief && (
              <button
                type="button"
                onClick={onSwitchBrief}
                style={{ background: 'rgba(255,255,255,0.06)', color: '#E7E4DC', border: '1px solid #3D3A34', padding: '6px 12px', borderRadius: '5px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 }}
              >
                切换高管简报版 (2页)
              </button>
            )}
            {onOpenClientInfo && (
              <button
                type="button"
                onClick={onOpenClientInfo}
                style={{ background: 'rgba(255,255,255,0.06)', color: '#E7E4DC', border: '1px solid #3D3A34', padding: '6px 12px', borderRadius: '5px', cursor: 'pointer', fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
              >
                <UserCheck size={13} /> 客户与诉求设置
              </button>
            )}
          </div>

          {/* 中：AI 模型撰写栏 */}
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              value={aiModel}
              onChange={(e) => setAiModel(e.target.value)}
              style={{
                background: '#272521',
                color: '#F5F2EA',
                border: '1px solid #44403A',
                borderRadius: '5px',
                padding: '5px 8px',
                fontSize: '0.76rem',
              }}
            >
              <option value="reasoner">DeepSeek R1 (深度推理旗舰)</option>
              <option value="auto">DeepSeek V3 (推荐极速)</option>
              <option value="claude-sonnet">Claude 3.7 Sonnet (私行文风)</option>
              <option value="gemini-pro">Gemini 2.5 Pro (宏观投研)</option>
              <option value="gemini">Gemini 2.5 Flash</option>
            </select>
            <button
              type="button"
              onClick={handleAiCoAuthor}
              disabled={aiWriting}
              style={{
                background: '#9A6F38',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: '5px',
                padding: '6px 12px',
                cursor: aiWriting ? 'wait' : 'pointer',
                fontSize: '0.78rem',
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
              }}
            >
              <Sparkles size={13} />
              {aiWriting ? 'AI 深度撰写中...' : 'AI 撰写定制叙事'}
            </button>
            {aiUsedLabel && (
              <span style={{ fontSize: '0.7rem', color: '#86EFAC', fontFamily: 'var(--font-mono)' }}>
                ✓ {aiUsedLabel}
              </span>
            )}
          </div>

          {/* 右：编辑 / PDF / Word / 关闭 */}
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setEditMode((m) => !m)}
              style={{
                background: editMode ? 'rgba(154,111,56,0.28)' : 'rgba(255,255,255,0.06)',
                color: editMode ? '#FCD34D' : '#D6D3CD',
                border: `1px solid ${editMode ? '#9A6F38' : '#3D3A34'}`,
                padding: '6px 11px',
                borderRadius: '5px',
                cursor: 'pointer',
                fontSize: '0.78rem',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              {editMode ? <><Check size={13} /> 完成编辑</> : <><Edit3 size={13} /> 编辑文案</>}
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              style={{
                background: '#1E4D3B',
                color: '#FAF8F3',
                border: '1px solid #2B6A52',
                padding: '6px 13px',
                borderRadius: '5px',
                cursor: 'pointer',
                fontWeight: 700,
                fontSize: '0.78rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
              }}
            >
              <Printer size={13} /> 导出 PDF / 打印
            </button>
            {onGenerateWord && (
              <button
                type="button"
                onClick={() => onGenerateWord(buildWordPayloadFromEdits())}
                disabled={reportLoading}
                style={{
                  background: '#28547A',
                  color: '#FFFFFF',
                  border: '1px solid #356B9A',
                  padding: '6px 13px',
                  borderRadius: '5px',
                  cursor: reportLoading ? 'wait' : 'pointer',
                  fontWeight: 700,
                  fontSize: '0.78rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
              >
                <Download size={13} /> {reportLoading ? '生成中...' : '下载 Word (.docx)'}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              style={{
                background: 'transparent',
                color: '#A8A29E',
                border: '1px solid #3D3A34',
                padding: '6px 10px',
                borderRadius: '5px',
                cursor: 'pointer',
                fontSize: '0.78rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <X size={14} /> 返回
            </button>
          </div>
        </div>

        {aiError && (
          <div className="no-print" style={{ background: '#7F1D1D', color: '#FECACA', padding: '8px 14px', borderRadius: '6px', fontSize: '0.8rem' }}>
            {aiError}
          </div>
        )}
        {editMode && (
          <div className="no-print" style={{ background: 'rgba(154,111,56,0.18)', border: '1px solid #9A6F38', borderRadius: '6px', padding: '8px 14px', color: '#FDE68A', fontSize: '0.8rem' }}>
            已开启文案微调：虚线框内文字均可直接点击修改，修改完成后会同步保留在 PDF 打印与 Word 导出文件内。
          </div>
        )}

        {/* ══ 私人银行建议书纸面正文 ══════════════════════════════════════════ */}
        <div className="wealth-report-content ips-paper" id="printable-report">
          {/* ── 封面刊头 & 摘要 KPI ── */}
          <header className="ips-masthead ips-block-keep">
            <div className="ips-brand-overline">WONDER ATELIER · PRIVATE WEALTH INVESTMENT POLICY STATEMENT</div>
            <h1 className="ips-title">
              {clientName ? `${clientName} · 专属资产配置与长期财富规划建议书` : '专属多资产配置与长期财富规划建议书'}
            </h1>
            <div style={{ fontSize: '0.88rem', color: '#57534E' }}>
              {portfolioTitle} · 基于 {runYears} 年期前瞻蒙特卡洛 2,000 次路径及历史极端危机压力回测
              {isCombined ? ' · 投资组合 + 确定性保险底座双核协同' : ''}
            </div>

            <div className="ips-meta-grid">
              <div>
                <span>委托客户：</span>
                <strong>{clientName || '贵宾客户'}{clientAge ? ` (${clientAge}岁)` : ''}</strong>
              </div>
              <div>
                <span>风险预算：</span>
                <strong>{riskLabelZh}{riskScore != null ? ` (${riskScore}/100)` : ''}</strong>
              </div>
              <div>
                <span>初始本金：</span>
                <strong className="ips-mono">{sym}{numFmt(capital)} ({currency})</strong>
              </div>
              <div>
                <span>基准模型：</span>
                <strong>{cmaLabel}</strong>
              </div>
              <div>
                <span>编制顾问：</span>
                <strong>{advisorName}</strong>
              </div>
              <div>
                <span>签发日期：</span>
                <strong className="ips-mono">{reportDate}</strong>
              </div>
            </div>

            <div className="ips-kpi-grid">
              <div className="ips-kpi-card">
                <div className="ips-kpi-label">{hasWithdrawal ? '全程资金不断流率' : '方案长期稳健运行率'}</div>
                <div className="ips-kpi-value" style={{ color: solvencyRate >= 0.85 ? '#1E4D3B' : '#9A5B13' }}>
                  {solvencyPctStr}%
                </div>
                <div className="ips-kpi-sub">
                  {hasWithdrawal ? `里程碑达标率 ${successPctStr}%` : `${runYears} 年期模拟不断流检验`}
                </div>
              </div>
              <div className="ips-kpi-card bronze">
                <div className="ips-kpi-label">预期年化回报 / 派息率</div>
                <div className="ips-kpi-value" style={{ color: '#9A6F38' }}>
                  {((mcTargetPortfolio.expected_return || 0) * 100).toFixed(1)}%
                </div>
                <div className="ips-kpi-sub">
                  参考股息率 {divYieldPct.toFixed(2)}% · 夏普 {(mcTargetPortfolio.sharpe_ratio || 0).toFixed(2)}
                </div>
              </div>
              <div className="ips-kpi-card slate">
                <div className="ips-kpi-label">{runYears} 年中性净值 (P50)</div>
                <div className="ips-kpi-value" style={{ color: '#28547A' }}>
                  {sym}{numFmt(p50)}
                </div>
                <div className="ips-kpi-sub">
                  今日真实购买力 ≈ {sym}{numFmt(realP50)}
                </div>
              </div>
              <div className="ips-kpi-card risk">
                <div className="ips-kpi-label">极端逆风底线 (P10)</div>
                <div className="ips-kpi-value" style={{ color: '#991B1B' }}>
                  {sym}{numFmt(p10)}
                </div>
                <div className="ips-kpi-sub">
                  历史最大回撤 -{maxHistDdPct.toFixed(1)}% · 波动率 {((mcTargetPortfolio.volatility || 0) * 100).toFixed(1)}%
                </div>
              </div>
            </div>
          </header>

          {/* ══ 第一章：客户画像、特殊诉求与执行摘要 ══ */}
          <section className="ips-chapter">
            <div className="ips-chapter-header">
              <span className="ips-chapter-num">01</span>
              <h2 className="ips-chapter-title">客户财务画像、核心诉求与执行摘要</h2>
              <span className="ips-chapter-en">CLIENT MANDATE &amp; SUMMARY</span>
            </div>

            <div className="ips-callout forest">
              <EditableText fieldKey="executive_summary" className="ips-prose" style={{ margin: 0 }} {...editProps}>
                {defaultExecSummary}
              </EditableText>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px' }}>
              <div style={{ background: '#FFFFFF', border: '1px solid #DFDBD2', borderRadius: '4px', padding: '12px 14px' }}>
                <div style={{ fontSize: '0.74rem', fontWeight: 700, color: '#1E4D3B', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Scale size={14} /> 目标约束与风险容忍预算
                </div>
                <div style={{ fontSize: '0.82rem', color: '#57534E', lineHeight: 1.7 }}>
                  <div>核心财务诉求：<strong style={{ color: '#141413' }}>{goalText}</strong></div>
                  <div>年度通胀假定：<strong className="ips-mono" style={{ color: '#141413' }}>{labMcSettings.inflation}%</strong></div>
                  {envelope && (
                    <div style={{ marginTop: '4px' }}>
                      建议战略中枢：权益 <strong className="ips-mono">{envelope.target_equity_pct}%</strong> / 固收 <strong className="ips-mono">{envelope.target_bond_pct}%</strong> / 另类多元 <strong className="ips-mono">{envelope.target_other_pct}%</strong>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ background: '#FFFFFF', border: '1px solid #DFDBD2', borderRadius: '4px', padding: '12px 14px' }}>
                <div style={{ fontSize: '0.74rem', fontWeight: 700, color: '#9A6F38', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <ShieldCheck size={14} /> 客户特定情况与刚性约束响应
                </div>
                <div style={{ fontSize: '0.82rem', color: '#292524', lineHeight: 1.68 }}>
                  {extraNotes ? (
                    <>{extraNotes}</>
                  ) : (
                    <>当前按标准「{riskLabelZh}」与「{runYears}年期」参数执行；若涉及未来大额刚性支出、海外税务身份或存量保单隔离需求，可通过工具栏补充诉求后重新生成叙事。</>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* ══ 第二章：宏观时钟研判与首期建仓架构 ══ */}
          <section className="ips-chapter">
            <div className="ips-chapter-header">
              <span className="ips-chapter-num">02</span>
              <h2 className="ips-chapter-title">宏观时钟研判与首期建仓配置方案</h2>
              <span className="ips-chapter-en">MACRO REGIME &amp; PORTFOLIO ARCHITECTURE</span>
            </div>

            <EditableText fieldKey="macro_and_strategy" className="ips-prose" {...editProps}>
              {defaultMacroStrategy}
            </EditableText>

            <div style={{ overflowX: 'auto' }}>
              <table className="ips-table">
                <thead>
                  <tr>
                    <th style={{ width: '92px' }}>标的代码</th>
                    <th>资产名称与战略层级</th>
                    <th style={{ textAlign: 'right', width: '74px' }}>配置权重</th>
                    <th style={{ textAlign: 'right', width: '115px' }}>首期配置金额</th>
                    <th style={{ textAlign: 'right', width: '76px' }}>参考股息</th>
                    <th>战略角色与选基逻辑</th>
                  </tr>
                </thead>
                <tbody>
                  {holdingRows.map((h) => (
                    <tr key={h.isin}>
                      <td>
                        <span className={`ips-badge ${h.sleeve.badge === 'bronze' ? 'bronze' : ''}`}>
                          {h.isin}
                        </span>
                      </td>
                      <td>
                        <div style={{ fontWeight: 600, color: '#141413' }}>{h.name}</div>
                        <div style={{ fontSize: '0.72rem', color: '#78736A', marginTop: '2px' }}>
                          {h.sleeve.label} · {h.assetClass}
                          {h.isProxy && h.proxyBenchmark ? ` (对标代理: ${h.proxyBenchmark})` : ''}
                        </div>
                      </td>
                      <td className="ips-mono" style={{ textAlign: 'right', fontWeight: 700 }}>
                        {h.weightPct.toFixed(1)}%
                      </td>
                      <td className="ips-mono" style={{ textAlign: 'right', fontWeight: 700, color: '#1E4D3B' }}>
                        {sym}{numFmt(h.amount)}
                      </td>
                      <td className="ips-mono" style={{ textAlign: 'right', color: '#9A6F38' }}>
                        {h.divYieldPct > 0 ? `${h.divYieldPct.toFixed(2)}%` : '—'}
                      </td>
                      <td style={{ fontSize: '0.78rem', color: '#44403C', lineHeight: 1.55 }}>
                        <EditableText tag="span" fieldKey={`role_${h.isin}`} {...editProps}>
                          {h.defaultRole}
                        </EditableText>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>合计</td>
                    <td>{holdingRows.length} 项跨周期核心标的（加权年费率 {labData.portfolio_diagnostics?.weighted_fee_pct != null ? `${labData.portfolio_diagnostics.weighted_fee_pct}%` : '—'}）</td>
                    <td className="ips-mono" style={{ textAlign: 'right' }}>100.0%</td>
                    <td className="ips-mono" style={{ textAlign: 'right' }}>{sym}{numFmt(capital)}</td>
                    <td className="ips-mono" style={{ textAlign: 'right', color: '#9A6F38' }}>{divYieldPct.toFixed(2)}%</td>
                    <td style={{ fontSize: '0.76rem' }}>首年预计自动产生派息现金流约 {sym}{numFmt(firstYrDiv)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {ilpEnabled && (
              <div className="ips-callout" style={{ marginTop: '12px' }}>
                <strong>ILP 投连险账户包裹配置已激活：</strong>
                整付保费 <span className="ips-mono">{sym}{numFmt(ilpConfig?.totalPremium || capital)}</span>，模拟回报已按内扣平台行政管理费与奖赏率净值化计算，确保所得数字贴近保单实盘净表现。
              </div>
            )}
          </section>

          {/* ══ 第三章：内生派息引擎与全周期现金流规划 ══ */}
          <section className="ips-chapter">
            <div className="ips-chapter-header">
              <span className="ips-chapter-num">03</span>
              <h2 className="ips-chapter-title">内生派息引擎与全周期现金流规划</h2>
              <span className="ips-chapter-en">DIVIDEND ENGINE &amp; CASHFLOW SCHEDULE</span>
            </div>

            <EditableText fieldKey="cashflow_and_solvency" className="ips-prose" {...editProps}>
              {defaultCashflowSolvency}
            </EditableText>

            <div className="ips-kpi-grid" style={{ marginTop: 0, marginBottom: '14px' }}>
              <div className="ips-kpi-card bronze">
                <div className="ips-kpi-label">首年预计内生派息</div>
                <div className="ips-kpi-value" style={{ fontSize: '1.35rem', color: '#9A6F38' }}>
                  {sym}{numFmt(firstYrDiv)}
                </div>
                <div className="ips-kpi-sub">约合 {sym}{numFmt(firstYrDiv / 12)} / 月</div>
              </div>
              <div className="ips-kpi-card">
                <div className="ips-kpi-label">常规提领派息覆盖度</div>
                <div className="ips-kpi-value" style={{ fontSize: '1.35rem' }}>
                  {withdrawal1 > 0 ? `${divCoverRatio}%` : '全额复投'}
                </div>
                <div className="ips-kpi-sub">
                  {withdrawal1 > 0 ? '优先消耗股息，保护权益本金' : 'DRIP 滚雪球复利模式'}
                </div>
              </div>
              <div className="ips-kpi-card slate">
                <div className="ips-kpi-label">第一段常规提领计划</div>
                <div className="ips-kpi-value" style={{ fontSize: '1.35rem', color: '#28547A' }}>
                  {withdrawal1 > 0 ? `${sym}${numFmt(withdrawal1)}` : '无'}
                </div>
                <div className="ips-kpi-sub">
                  {withdrawal1 > 0
                    ? `第 ${labMcSettings.withdrawal_start}–${labMcSettings.withdrawal_end} 年${labMcSettings.withdrawal_inflation ? ` · 通胀递增` : ''}`
                    : '积累期零提领'}
                </div>
              </div>
              <div className="ips-kpi-card risk">
                <div className="ips-kpi-label">第二段 / 专项大额支出</div>
                <div className="ips-kpi-value" style={{ fontSize: '1.35rem', color: '#991B1B' }}>
                  {withdrawal2 > 0 ? `${sym}${numFmt(withdrawal2)}` : '无'}
                </div>
                <div className="ips-kpi-sub">
                  {withdrawal2 > 0
                    ? `第 ${labMcSettings.withdrawal_start_2}–${labMcSettings.withdrawal_end_2} 年专项用款`
                    : '未设阶段大额用款'}
                </div>
              </div>
            </div>

            {cfChartData.length > 0 && (
              <div className="ips-chart-box ips-block-keep">
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#1E4D3B', marginBottom: '8px' }}>
                  年度现金流出/入与内生分红覆盖透视（名义值 · {currency}）
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={cfChartData} margin={{ top: 8, right: 16, left: 10, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E7E4DC" />
                    <XAxis dataKey="name" tick={{ fill: '#57534E', fontSize: 10 }} interval={Math.max(0, Math.floor(cfChartData.length / 10))} />
                    <YAxis tickFormatter={(v) => `${sym}${(v / 1000).toFixed(0)}k`} tick={{ fill: '#57534E', fontSize: 10 }} width={62} />
                    <RechartsTooltip formatter={(val, name) => [`${sym}${numFmt(Math.abs(val))}`, name]} />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    <Bar dataKey="组合提取" fill="#28547A" name="计划提领额" />
                    {isCombined && <Bar dataKey="保单提取" fill="#1E4D3B" name="保单协同给付" />}
                    <Bar dataKey="内生分红" fill="#9A6F38" name="内生派息现金流" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}

            {withdrawSchedule.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table className="ips-table">
                  <thead>
                    <tr>
                      <th>年度 / 年龄</th>
                      <th style={{ textAlign: 'right' }}>组合计划提取</th>
                      {isCombined && <th style={{ textAlign: 'right' }}>保单给付</th>}
                      <th style={{ textAlign: 'right' }}>预计内生分红</th>
                      <th style={{ textAlign: 'right' }}>累计提取总额</th>
                    </tr>
                  </thead>
                  <tbody>
                    {withdrawSchedule.map((r) => (
                      <tr key={r.year}>
                        <td>
                          第 {r.year} 年{r.age ? `（${r.age} 岁）` : ''}
                        </td>
                        <td className="ips-mono" style={{ textAlign: 'right', fontWeight: 700 }}>
                          {sym}{numFmt(r.portDraw)}
                        </td>
                        {isCombined && (
                          <td className="ips-mono" style={{ textAlign: 'right', color: '#1E4D3B', fontWeight: 600 }}>
                            {r.insAmt > 0 ? `${sym}${numFmt(r.insAmt)}` : '—'}
                          </td>
                        )}
                        <td className="ips-mono" style={{ textAlign: 'right', color: '#9A6F38' }}>
                          {sym}{numFmt(r.divGenerated)}
                        </td>
                        <td className="ips-mono" style={{ textAlign: 'right', fontWeight: 600 }}>
                          {sym}{numFmt(r.cumulative)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* ══ 第四章：前瞻蒙特卡洛财富走廊与人生关键节点 ══ */}
          <section className="ips-chapter">
            <div className="ips-chapter-header">
              <span className="ips-chapter-num">04</span>
              <h2 className="ips-chapter-title">前瞻财富演进走廊与人生里程碑快照</h2>
              <span className="ips-chapter-en">MONTE CARLO CORRIDOR &amp; MILESTONES</span>
            </div>

            <div className="ips-chart-box ips-block-keep">
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#1E4D3B', marginBottom: '8px' }}>
                {runYears} 年期财富概率走廊（P90 顺风 / P50 基准中枢 / P10 极端逆风底线 · {currency}）
              </div>
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart
                  data={(mcResult.chart || []).map((pt) => ({
                    year: `第${pt.year}年`,
                    P90顺风: Math.round(isCombined ? pt.combined_p90 ?? pt.p90 : pt.p90),
                    P50基准: Math.round(isCombined ? pt.combined_p50 ?? pt.p50 : pt.p50),
                    P10底线: Math.round(isCombined ? pt.combined_p10 ?? pt.p10 : pt.p10),
                  }))}
                  margin={{ top: 8, right: 16, left: 10, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#E7E4DC" />
                  <XAxis dataKey="year" tick={{ fill: '#57534E', fontSize: 10 }} interval={Math.max(0, Math.floor((mcResult.chart?.length || 1) / 7))} />
                  <YAxis tickFormatter={(v) => `${sym}${(v / 1000).toFixed(0)}k`} tick={{ fill: '#57534E', fontSize: 10 }} width={64} />
                  <RechartsTooltip formatter={(v, n) => [`${sym}${numFmt(v)}`, n]} />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                  <Area type="monotone" dataKey="P90顺风" stroke="#9A6F38" fill="rgba(154,111,56,0.08)" strokeWidth={1.5} />
                  <Area type="monotone" dataKey="P50基准" stroke="#1E4D3B" fill="rgba(30,77,59,0.14)" strokeWidth={2.5} />
                  <Area type="monotone" dataKey="P10底线" stroke="#991B1B" fill="none" strokeDasharray="4 3" strokeWidth={1.5} />
                  {capital > 0 && (
                    <ReferenceLine y={capital} stroke="#78736A" strokeDasharray="3 3" label={{ value: '期初本金线', position: 'insideTopLeft', fontSize: 10, fill: '#78736A' }} />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {milestones.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table className="ips-table">
                  <thead>
                    <tr>
                      <th>时间里程碑</th>
                      <th style={{ textAlign: 'right' }}>悲观底线 (P10)</th>
                      <th style={{ textAlign: 'right' }}>中性基准 (P50)</th>
                      <th style={{ textAlign: 'right' }}>乐观展望 (P90)</th>
                      <th>阶段财务意义</th>
                    </tr>
                  </thead>
                  <tbody>
                    {milestones.map((m) => (
                      <tr key={m.year}>
                        <td style={{ fontWeight: 600 }}>{m.label}</td>
                        <td className="ips-mono" style={{ textAlign: 'right', color: '#991B1B', fontWeight: 600 }}>
                          {sym}{numFmt(m.p10)}
                        </td>
                        <td className="ips-mono" style={{ textAlign: 'right', color: '#1E4D3B', fontWeight: 700 }}>
                          {sym}{numFmt(m.p50)}
                        </td>
                        <td className="ips-mono" style={{ textAlign: 'right', color: '#166534' }}>
                          {sym}{numFmt(m.p90)}
                        </td>
                        <td style={{ fontSize: '0.78rem', color: '#57534E' }}>{m.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {isCombined && (
              <div className="ips-callout forest" style={{ marginTop: '12px' }}>
                <strong>双核保险底座量化增效：</strong>
                叠加「{insurancePlan?.label || '稳健储蓄保险'}」后，期末合并净值由纯组合 {sym}{numFmt(pureP50)} 提升至 {sym}{numFmt(p50)}（确定性现金价值增量 +{sym}{numFmt(insContribP50)}）；在 P10 极端危机下额外托底 +{sym}{numFmt(insContribP10)}，悲观最大回撤由 {(Math.abs(dd.p10) * 100).toFixed(1)}% 收窄至 {(Math.abs(cdd.p10) * 100).toFixed(1)}%（改善 {(ddImprovementP10 * 100).toFixed(1)} 个百分点）
                {withdrawalCovPct > 0 ? `，期间保单协同提取覆盖目标支出的 ${withdrawalCovPct.toFixed(1)}%` : ''}
                {totInsWithdrawal > 0 ? `（累计释放保单现金 ${sym}${numFmt(totInsWithdrawal)}）` : ''}。
              </div>
            )}
          </section>

          {/* ══ 第五章：历史真实危机压力测试与风险控制边界 ══ */}
          <section className="ips-chapter">
            <div className="ips-chapter-header">
              <span className="ips-chapter-num">05</span>
              <h2 className="ips-chapter-title">历史真实危机压力测试与风控纪律</h2>
              <span className="ips-chapter-en">HISTORICAL STRESS TESTS &amp; RISK GUARDRAILS</span>
            </div>

            <EditableText fieldKey="risk_and_stress_commentary" className="ips-prose" {...editProps}>
              {defaultRiskCommentary}
            </EditableText>

            {availableStress.length > 0 && (
              <div style={{ overflowX: 'auto', marginBottom: '14px' }}>
                <table className="ips-table">
                  <thead>
                    <tr>
                      <th>真实历史宏观危机窗口</th>
                      <th style={{ textAlign: 'right' }}>样本权重覆盖</th>
                      <th style={{ textAlign: 'right' }}>区间累积总回报</th>
                      <th style={{ textAlign: 'right' }}>区间最大回撤</th>
                    </tr>
                  </thead>
                  <tbody>
                    {availableStress.map((sc) => (
                      <tr key={sc.id || sc.label}>
                        <td style={{ fontWeight: 600 }}>{sc.label}</td>
                        <td className="ips-mono" style={{ textAlign: 'right', color: '#57534E' }}>
                          {sc.coverage_weight ?? 100}%
                        </td>
                        <td
                          className="ips-mono"
                          style={{
                            textAlign: 'right',
                            fontWeight: 700,
                            color: (sc.total_return_pct || 0) >= 0 ? '#166534' : '#991B1B',
                          }}
                        >
                          {sc.total_return_pct != null ? `${sc.total_return_pct >= 0 ? '+' : ''}${sc.total_return_pct}%` : '—'}
                        </td>
                        <td className="ips-mono" style={{ textAlign: 'right', fontWeight: 700, color: '#991B1B' }}>
                          {sc.max_drawdown_pct != null ? `${sc.max_drawdown_pct}%` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '12px' }}>
              <div style={{ background: '#FFFFFF', border: '1px solid #DFDBD2', borderLeft: '3px solid #991B1B', borderRadius: '4px', padding: '12px 14px' }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#991B1B', marginBottom: '6px' }}>
                  系统性熊市防御应对守则
                </div>
                <p style={{ margin: 0, fontSize: '0.8rem', color: '#44403C', lineHeight: 1.65 }}>
                  保持长期配置定力，避免在市场波动低位被动减仓。优先使用组合内生派息、短期美债票息及保单备用现金度过 6–18 个月的市场下行窗口，保留底部筹码等待估值修复。
                </p>
              </div>
              <div style={{ background: '#FFFFFF', border: '1px solid #DFDBD2', borderLeft: '3px solid #1E4D3B', borderRadius: '4px', padding: '12px 14px' }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#1E4D3B', marginBottom: '6px' }}>
                  顺周期牛市再平衡锁利纪律
                </div>
                <p style={{ margin: 0, fontSize: '0.8rem', color: '#44403C', lineHeight: 1.65 }}>
                  严格执行每半年度检视或单一资产权重偏离 ±5% 触发机械再平衡：自动兑现超涨高估值权益的浮盈，逆向加仓短债与低估红利，将整体波动风险严控在预算之内。
                </p>
              </div>
            </div>
          </section>

          <XRayReportSection
            xrayData={xrayData}
            localXRay={computePortfolioXRay({
              holdings: Object.entries(mcTargetPortfolio.allocations || {})
                .filter(([, w]) => Number(w) > 0)
                .map(([isin, weight]) => ({ isin, weight: Number(weight) })),
              quantFunds,
              totalNav: Number(labMcSettings?.capital) || 0,
            })}
            currencySymbol={sym}
            sectionTitle="底层穿透 X-Ray（工具结构 · 双风格箱 · 合并重仓 · SOP 体检）"
          />

          {/* ══ 第六章：首期执行清单、顾问陪伴机制与合规声明 ══ */}
          <section className="ips-chapter" style={{ marginBottom: 0 }}>
            <div className="ips-chapter-header">
              <span className="ips-chapter-num">06</span>
              <h2 className="ips-chapter-title">首期执行清单、陪伴机制与合规声明</h2>
              <span className="ips-chapter-en">EXECUTION &amp; GOVERNANCE</span>
            </div>

            <div style={{ background: '#FFFFFF', border: '1px solid #DFDBD2', borderRadius: '4px', padding: '14px 16px', marginBottom: '12px', fontSize: '0.84rem', lineHeight: 1.75, color: '#292524' }}>
              <div style={{ fontWeight: 700, color: '#1E4D3B', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Compass size={15} /> 顾问机构服务承诺
              </div>
              <EditableText fieldKey="aboutUs" style={{ margin: '0 0 8px' }} {...editProps}>
                {editableFields.aboutUs}
              </EditableText>
              <EditableText fieldKey="aboutService" style={{ margin: 0, color: '#57534E' }} {...editProps}>
                {editableFields.aboutService}
              </EditableText>
            </div>

            <div style={{ background: '#EFECE4', border: '1px solid #DFDBD2', borderRadius: '4px', padding: '12px 16px', fontSize: '0.74rem', color: '#57534E', lineHeight: 1.68 }}>
              <strong>重要合规声明与风险披露：</strong>
              本建议书由 WONDER Atelier 量化研究引擎基于历史净值与前瞻资本市场假设模拟编制，仅作为资产配置思路研讨、教学演示与长期现金流规划参考之用，不构成香港证监会（SFC）或任何司法辖区牌照项下的正式投资要约、买入/卖出建议或保本承诺。涉及保险计划之非保证红利演示随承保机构实际分红实现率浮动。过往历史及回测表现不预示未来真实结果，所有投资均存在本金亏损风险。
              <div style={{ marginTop: '6px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: '#78736A' }}>
                WONDER ATELIER WEALTH ENGINE · {reportDate} · {advisorName}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

const WealthReport = (props) => {
  if (!props.labData?.monte_carlo) return null;
  return <WealthReportContent {...props} />;
};

export default WealthReport;
