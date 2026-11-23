import React, { useMemo, useState, useCallback } from 'react';
import {
  AreaChart, Area, BarChart, Bar, ComposedChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  Legend, ResponsiveContainer, ReferenceLine
} from 'recharts';

// ── 可编辑文本块（必须定义在组件外部，保证 React 组件类型稳定）────
// 使用 useRef + useEffect 控制 contentEditable DOM。
// React 完全不在 re-render 时动 innerHTML，只在 fieldKey/editMode 切换时
// 初始化一次内容；onBlur 时把用户输入持久化到 state。
const EditableText = ({ fieldKey, tag = 'p', style, className, children, editMode, editableFields, onBlur }) => {
  const Tag = tag;
  const ref = React.useRef(null);

  // 每当 editMode 开启、或 fieldKey 变化时，将当前值同步到 DOM（仅一次）
  React.useEffect(() => {
    if (editMode && ref.current && ref.current.isConnected) {
      const val = editableFields[fieldKey];
      ref.current.innerText =
        val !== undefined && val !== null
          ? val
          : (typeof children === 'string' ? children : (ref.current.innerText || ''));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode, fieldKey]);

  if (!editMode) {
    return <Tag style={style} className={className}>{editableFields[fieldKey] ?? children}</Tag>;
  }

  return (
    <Tag
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      onBlur={(e) => onBlur(fieldKey, e)}
      style={{
        ...style,
        outline: '2px dashed #f59e0b',
        borderRadius: 4,
        minHeight: '1.2em',
        cursor: 'text',
        background: 'rgba(245,158,11,0.06)',
      }}
      className={className}
    />
  );
};

// ── 格式化工具 ────────────────────────────────────────────────
function numFmt(val) {
  if (val === undefined || val === null || isNaN(val)) return '0';
  return Math.round(val).toLocaleString('zh-CN');
}
// ── 目标中文映射 ──────────────────────────────────────────────
const GOAL_LABELS = {
  retirement: '退休收入保障',
  education:  '子女教育基金',
  legacy:     '遗产传承规划',
  growth:     '资产保值增值',
  liquidity:  '流动性储备',
};

// ── 关键时间节点计算 ──────────────────────────────────────────
function buildMilestones(chart, mcSettings, clientAge) {
  const years = parseInt(mcSettings.years) || 40;
  const contribEnd = parseInt(mcSettings.contribution_years) || 0;
  const withdrawStart = parseInt(mcSettings.withdrawal_start) || 0;

  // 候选里程碑（年份）
  const candidates = [];
  if (contribEnd > 0 && contribEnd <= years) {
    candidates.push({ year: contribEnd, label: clientAge ? `缴费期结束（${clientAge + contribEnd}岁）` : `缴费期结束（第${contribEnd}年）`, note: '初期积累阶段完成，资金进入自由增长期' });
  }
  if (withdrawStart > 0 && withdrawStart <= years) {
    candidates.push({ year: withdrawStart, label: clientAge ? `开始提取（${clientAge + withdrawStart}岁）` : `开始提取（第${withdrawStart}年）`, note: '现金流正式激活，组合进入"养你"模式' });
  }
  // 每10年一个展示节点
  for (let y = 10; y < years; y += 10) {
    if (!candidates.find(c => c.year === y)) {
      const label = clientAge ? `第${y}年（${clientAge + y}岁）` : `第${y}年`;
      const note = y === 10 ? '布局初步成型，复利效应开始显现' :
                   y === 20 ? '长期持有效果明显，抗通胀能力凸显' :
                   y === 30 ? '深度复利阶段，财富积累加速' : 
                   y === 40 ? '穿越多轮牛熊，资产基数实现跨越' :
                   '超长期限复利，跨越世代的财富沉淀';
      candidates.push({ year: y, label, note });
    }
  }
  // 人生关键年龄（如有年龄）
  if (clientAge) {
    [60, 65, 70, 80].forEach(targetAge => {
      const yr = targetAge - clientAge;
      if (yr > 0 && yr <= years && !candidates.find(c => c.year === yr)) {
        const note = targetAge === 65 ? '退休规划关键节点，收入切换到提取模式' :
                     targetAge === 70 ? '晚年生活质量保障期' :
                     targetAge === 80 ? '长寿风险规划，财富是否仍能支撑？' : '';
        candidates.push({ year: yr, label: `${targetAge}岁（第${yr}年）`, note });
      }
    });
  }

  // 加上终点
  if (!candidates.find(c => c.year === years)) {
    candidates.push({ year: years, label: clientAge ? `规划终点（${clientAge + years}岁）` : `规划终点（第${years}年）`, note: '全期终值汇总' });
  }

  // 排序、去重、过滤
  const sorted = candidates.sort((a, b) => a.year - b.year);
  const uniqueYears = new Set();
  const result = sorted.filter(c => {
    if (uniqueYears.has(c.year)) return false;
    uniqueYears.add(c.year);
    return true;
  });

  // 从 chart 取对应数据
  const chartMap = {};
  (chart || []).forEach(pt => { chartMap[pt.year] = pt; });

  return result.map(m => {
    const pt = chartMap[m.year] || {};
    return { ...m, p10: pt.p10 || null, p50: pt.p50 || null, p90: pt.p90 || null };
  }).filter(m => m.p50 !== null);
}

// ── 主组件 ────────────────────────────────────────────────────
// 内部组件：调用方已保证 labData.monte_carlo 存在，因此下面所有 hook 都是无条件调用。
const WealthReportContent = ({ labData, labMcSettings, insurancePlan, insuranceEnabled, clientInfo, onClose, onGenerateWord, reportLoading, onSwitchBrief }) => {
  const mcResult = labData.monte_carlo;

  // 兜底回撤数据，防止部分老缓存/加载的方案中没有 drawdown 引发白屏崩溃
  const dd = mcResult.drawdown || { p10: 0, p50: 0, p90: 0 };
  const cdd = mcResult.combined_drawdown || { p10: 0, p50: 0, p90: 0 };

  const ci = clientInfo || {};
  const clientAge = ci.age ? parseInt(ci.age) : null;
  const clientName = ci.name || '';
  const clientGoals = ci.goals || [];
  const advisorName = ci.advisor || '';

  // 当前使用的组合
  const mcTargetKey = labData.mc_target_label || 'max_sharpe';
  const mcTargetPortfolio = labData[mcTargetKey] || labData.max_sharpe || {};

  // 通胀折算
  const inflationDec = parseFloat(labMcSettings.inflation) / 100 || 0;
  const runYears = parseInt(labMcSettings.years) || 40;
  const discountFactor = Math.pow(1 + inflationDec, runYears);

  // 最终终值
  const lastChartPoint = mcResult.chart[mcResult.chart.length - 1] || {};
  const isCombined = insuranceEnabled && lastChartPoint.combined_p50 !== undefined;
  const p10 = isCombined ? lastChartPoint.combined_p10 : (lastChartPoint.p10 || 0);
  const p50 = isCombined ? lastChartPoint.combined_p50 : (lastChartPoint.p50 || 0);
  const p90 = isCombined ? lastChartPoint.combined_p90 : (lastChartPoint.p90 || 0);
  // 纯投资组合终值（不含保险）
  const pureP10 = lastChartPoint.p10 || 0;
  const pureP50 = lastChartPoint.p50 || 0;
  const realP50 = p50 / discountFactor;

  const successRate = (mcResult.success_rate * 100).toFixed(1);
  const isHealthy = mcResult.success_rate >= 0.8;
  const isDanger  = mcResult.success_rate < 0.5;
  const successColor = isDanger ? '#dc2626' : isHealthy ? '#16a34a' : '#d97706';

  // ── 保险量化影响数据 ─────────────────────────────────────────
  const insStats = mcResult.insurance_stats || null;
  // 保险底座在终值中的贡献（中性/悲观）
  const insContribP50 = isCombined ? (lastChartPoint.combined_p50 - lastChartPoint.p50) : 0;
  const insContribP10 = isCombined ? (lastChartPoint.combined_p10 - lastChartPoint.p10) : 0;
  // 回撤收窄幅度（正数 = 改善了多少个百分点）
  const ddImprovementP10 = isCombined ? Math.abs(dd.p10) - Math.abs(cdd.p10) : 0;
  // 保险计划末期 CV（三情景）
  const insCvAtEnd = insStats?.avg_cv_at_year_end || null;
  // 提取覆盖率
  const withdrawalCovPct = insStats?.withdrawal_coverage_pct || 0;
  // 保险总提取金额
  const totInsWithdrawal = insStats?.total_insurance_withdrawal || 0;

  // 关键时间节点里程碑
  const milestones = useMemo(() =>
    buildMilestones(mcResult.chart, labMcSettings, clientAge),
    [mcResult.chart, labMcSettings, clientAge]
  );

  // 现金流数据
  const cfData = useMemo(() => {
    const maxYears = parseInt(labMcSettings.years) || 40;
    const initialCapital = parseFloat(labMcSettings.capital) || 0;
    const data = [{ name: 'Yr 0', portOutflow: initialCapital > 0 ? -initialCapital : 0, insOutflow: 0, portInflow: 0, insInflow: 0 }];
    for (let y = 1; y <= maxYears; y++) {
      let portAdd = 0, portDraw = 0, insPrem = 0, insDraw = 0;
      if (y >= parseInt(labMcSettings.contribution_start) && y <= parseInt(labMcSettings.contribution_years))
        portAdd = parseFloat(labMcSettings.contribution || 0);
      if (y >= parseInt(labMcSettings.withdrawal_start) && y <= parseInt(labMcSettings.withdrawal_end)) {
        portDraw = parseFloat(labMcSettings.withdrawal || 0);
        if (labMcSettings.withdrawal_inflation)
          portDraw *= Math.pow(1 + inflationDec, y - 1);
      }
      if (insuranceEnabled && insurancePlan?.years && y <= insurancePlan.years.length) {
        const py = insurancePlan.years[y - 1];
        insPrem = py.premium || 0;
        insDraw = py.withdrawal || 0;
      }
      data.push({ name: `Yr ${y}`, portOutflow: portAdd > 0 ? -portAdd : 0, insOutflow: insPrem > 0 ? -insPrem : 0, portInflow: portDraw > 0 ? portDraw : 0, insInflow: insDraw > 0 ? insDraw : 0 });
    }
    return data;
  }, [labMcSettings, insurancePlan, insuranceEnabled, inflationDec]);

  // 保费汇总（保险章节用）
  const insPremiumData = useMemo(() => {
    if (!insuranceEnabled || !insurancePlan?.years) return null;
    let total = 0, payYears = 0;
    insurancePlan.years.forEach(py => {
      if (py.premium && parseFloat(py.premium) > 0) { total += parseFloat(py.premium); payYears++; }
    });
    return total > 0 ? { total, payYears } : null;
  }, [insuranceEnabled, insurancePlan]);

  // 保险底座杠杆效果：总回报 = 终点CV贡献 + 保险期间累计提取（两者都是保险「真实创造」的价值）
  const insTotalReturn = insContribP50 + totInsWithdrawal;
  const insLeverage = insPremiumData && insTotalReturn > 0 && insPremiumData.total > 0
    ? insTotalReturn / insPremiumData.total
    : null;

  // 提取计划（完整计算后过滤展示）
  const withdrawScheduleFullInfo = useMemo(() => {
    const base = parseFloat(labMcSettings.withdrawal) || 0;
    const start = parseInt(labMcSettings.withdrawal_start) || 0;
    const end = parseInt(labMcSettings.withdrawal_end) || runYears;
    const base2 = parseFloat(labMcSettings.withdrawal_2) || 0;
    const start2 = parseInt(labMcSettings.withdrawal_start_2) || 0;
    const end2 = parseInt(labMcSettings.withdrawal_end_2) || runYears;

    if (base <= 0 && base2 <= 0 && !(insuranceEnabled && insurancePlan?.years)) return { displayed: [], totalCount: 0, endYear: 0 };
    
    const allRows = [];
    const insYears = insurancePlan?.years || [];
    const maxYear = Math.max(
      base > 0 ? Math.min(end, runYears) : 0,
      base2 > 0 ? Math.min(end2, runYears) : 0,
      insYears.length > 0 ? Math.min(insYears.length, runYears) : 0
    );
    const startRow = Math.min(
      base > 0 ? start : 999,
      base2 > 0 ? start2 : 999
    ) === 999 ? 1 : Math.min(base > 0 ? start : 999, base2 > 0 ? start2 : 999);
    
    let originalIndex = 0;
    let cumulative = 0;
    for (let y = startRow; y <= maxYear; y++) {
      const factor = labMcSettings.withdrawal_inflation ? Math.pow(1 + inflationDec, y - 1) : 1;
      let portAmt = 0;
      if (base > 0 && y >= start && y <= end) portAmt += Math.round(base * factor);
      if (base2 > 0 && y >= start2 && y <= end2) portAmt += Math.round(base2 * factor);
      const insPy = insYears[y - 1] || {};
      const insAmt = Math.round(insPy.withdrawal || 0);
      
      if (portAmt > 0 || insAmt > 0) {
        const total = portAmt + insAmt;
        cumulative += total;
        allRows.push({ year: y, amount: portAmt, insAmount: insAmt, total, cumulative, originalIndex });
        originalIndex++;
      }
    }
    
    // 过滤规则：前5年连续展示，后续每5年展示一次（即第10, 15, 20年...），以及最后一年
    const totalCount = allRows.length;
    const displayed = allRows.filter((r, i) => i < 5 || (i + 1) % 5 === 0 || i === totalCount - 1);
    
    return { displayed, totalCount, endYear: allRows.length > 0 ? allRows[allRows.length - 1].year : 0 };
  }, [labMcSettings, runYears, inflationDec, insurancePlan, insuranceEnabled]);
  
  const withdrawSchedule = withdrawScheduleFullInfo.displayed;

  const handlePrint = () => window.print();

  // ── 编辑模式 ─────────────────────────────────────────────
  const [editMode, setEditMode] = useState(false);
  // 可编辑字段 state（这些字段允许用户自由修改后打印）
  const [editableFields, setEditableFields] = useState({
    aboutUs: advisorName
      ? `本报告由 ${advisorName} 编制。我们致力于以科学、透明、有温度的方式，为高净值家庭提供长期财富规划服务。`
      : '本报告由您的财富规划顾问编制。我们致力于以科学、透明、有温度的方式，为高净值家庭提供长期财富规划服务。',
    aboutService: '财富规划绝不是一次性的交易，而是长期的陪伴。在未来的财富成长过程中，我们会为您持续监控投资组合的健康状况，进行及时的动态再平衡（Rebalancing）。我们将每半年为您提供一次深度的财务复盘，确保您的资产配置始终与人生目标保持同步。',
    aboutUsFootnote: '＊ 机构背景、资质信息及完整服务说明，将在正式版本中补充。如需了解更多，请与您的顾问联系。',
    reportTitle: clientName ? `${clientName} 财富规划方案` : '您的长期财富规划方案',
    openingLine: clientName ? `${clientName}，如果您正在考虑` : '如果您正在考虑',
    ch1BodyA: '财富管理的核心挑战，从来不是「今年能赚多少」——而是如何让您的资产在几十年的时间跨度里，穿越通货膨胀、市场大跌与人生变局，依然能够支撑您和家人想要的生活。',
    ch1BodyB: '本方案通过对全球资产配置进行科学优化，并结合 10,000 次模拟未来可能发生的不同市场路径，为您呈现一个诚实、立体、有风险边界的长期财富蓝图——不只告诉您「可能赚多少」，更告诉您「最坏会怎样」，以及「什么情况下需要调整」。',
    disclaimer1: '本报告中所有财富预测数据均来自蒙特卡洛统计模拟，基于历史价格数据，通过几何布朗运动模型（GBM）生成10,000条随机路径。P10/P50/P90 为概率分位数，不代表实际投资结果将落在此区间。',
    disclaimer2: '保险产品中标注「保证」的现金价值由保单合同约定，具有法律效力；标注「非保证」的红利部分（包括复归红利、终期红利）由保险公司视乎实际经营表现而定，存在高于或低于演示值的可能性。',
    disclaimer3: '所有投资均涉及风险，包括本金损失的可能性。过去的表现不代表未来结果。分散投资不能保证收益或防止损失。',
    disclaimer4: '本报告仅供参考，不构成任何形式的投资建议、保险销售要约或财务规划合同。具体决策请结合您的实际财务状况、风险承受能力及相关监管规定，在专业顾问指导下进行。',
  });

  // contentEditable 字段通用处理
  const handleFieldBlur = useCallback((fieldKey, e) => {
    // 立即缓存 innerText，不能依赖事件对象（异步 setState 后 currentTarget 可能已 detach）
    const text = e.currentTarget.innerText;
    setEditableFields(prev => ({ ...prev, [fieldKey]: text }));
  }, []);

  // EditableText 通用 props（每次使用时展开，避免重复书写）
  const editProps = { editMode, editableFields, onBlur: handleFieldBlur };

  // 客户称谓
  const salutation = clientName ? `${clientName}，` : '';
  // 目标中文列表
  const goalText = clientGoals.length > 0
    ? clientGoals.map(g => GOAL_LABELS[g] || g).join('、')
    : '长期财富积累与风险管控';

  // 报告日期
  const reportDate = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div className="wealth-report-overlay">
      <div className="wealth-report-container" onClick={(e) => e.stopPropagation()}>

        {/* 控制栏 — 打印时隐藏 */}
        <div className="wealth-report-controls no-print">
          <button onClick={handlePrint} style={{ background: '#1e3a8a', color: '#fff', border: 'none', padding: '10px 22px', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '0.9rem' }}>
            🖨️ 打印 / 导出 PDF
          </button>
          {onSwitchBrief && (
            <button
              onClick={onSwitchBrief}
              style={{
                background: 'rgba(5,150,105,0.12)',
                color: '#047857',
                border: '1px solid rgba(5,150,105,0.35)',
                padding: '10px 22px',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: 700,
                fontSize: '0.9rem',
                marginLeft: 8,
              }}
              title="切换到适合客户阅读的简明版报告"
            >
              📋 客户简报版
            </button>
          )}
          {onGenerateWord && (
            <button
              onClick={onGenerateWord}
              disabled={reportLoading}
              style={{
                background: reportLoading ? 'rgba(37,99,235,0.08)' : 'rgba(37,99,235,0.18)',
                color: reportLoading ? 'rgba(255,255,255,0.4)' : '#60a5fa',
                border: '1px solid rgba(37,99,235,0.4)',
                padding: '10px 22px',
                borderRadius: '8px',
                cursor: reportLoading ? 'not-allowed' : 'pointer',
                fontWeight: 700,
                fontSize: '0.9rem',
                marginLeft: 8,
                transition: 'all 0.2s'
              }}
            >
              {reportLoading ? '⏳ 生成中…' : '⬇ 下载 Word'}
            </button>
          )}
          {/* ✏️ 编辑内容按钮 */}
          <button
            onClick={() => setEditMode(m => !m)}
            style={{
              background: editMode ? 'rgba(245,158,11,0.25)' : 'rgba(245,158,11,0.08)',
              color: editMode ? '#f59e0b' : '#94a3b8',
              border: `1px solid ${editMode ? '#f59e0b' : '#334155'}`,
              padding: '10px 22px',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: '0.9rem',
              marginLeft: 8,
              transition: 'all 0.2s',
            }}
            title={editMode ? '点击退出编辑模式（黄色虚线框内容可直接点击修改）' : '点击进入编辑模式，直接修改报告文本'}
          >
            {editMode ? '✅ 完成编辑' : '✏️ 编辑内容'}
          </button>
          <button onClick={onClose} style={{ background: 'transparent', color: '#94a3b8', border: '1px solid #334155', padding: '10px 22px', borderRadius: '8px', cursor: 'pointer', marginLeft: 8 }}>
            ✖ 返回分析室
          </button>
        </div>
        {/* 编辑模式提示条 */}
        {editMode && (
          <div style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: 8, padding: '10px 18px', color: '#fbbf24', fontSize: '0.87rem', display: 'flex', alignItems: 'center', gap: 10 }}>
            ✏️ <strong>编辑模式已开启</strong>：黄色虚线框内的文字可直接点击修改。编辑完成后点击「✅ 完成编辑」，再点击「🖨️ 打印/导出 PDF」输出。
          </div>
        )}

        {/* ══ 报告正文 ══════════════════════════════════════════ */}
        <div className="wealth-report-content" id="printable-report">

          {/* ── 封面 ── */}
          <div className="report-header">
            <div className="no-print" style={{ background: 'rgba(59, 130, 246, 0.1)', border: '1px solid #3b82f6', color: '#1d4ed8', padding: '12px', borderRadius: '8px', marginBottom: '24px', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
              💡 <span>当前为网页数据预览版报告。顶部工具栏提供 <strong>🖨️ 打印/PDF</strong> 与 <strong>⬇ 下载 Word</strong> 两种导出方式，Word 版本由 AI 定制叙事生成，内含个性化解读与完整格式排版。</span>
            </div>
            
            <div style={{ fontSize: '0.8rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '2px', marginBottom: 14 }}>
              PERSONAL WEALTH PLANNING REPORT
            </div>
            <h1 style={{ fontSize: '2.0rem', margin: '0 0 10px', color: '#0f172a', letterSpacing: '-0.5px' }}>
              您的长期财富规划方案
            </h1>
            <p style={{ color: '#64748b', fontSize: '1.0rem', margin: '0 0 20px' }}>
              基于 {runYears} 年蒙特卡洛模拟 · 10,000 次平行路径概率分析
              {isCombined ? ' · 投资组合 + 保险双核架构' : ''}
            </p>

            {/* 摘要指标行 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginTop: 20, marginBottom: 10 }}>
              {[
                { label: '目标达成概率', value: `${successRate}%`, color: successColor },
                { label: `${runYears}年中性终值`, value: `$${numFmt(p50)}`, color: '#1e3a8a' },
                { label: '折算今日购买力', value: `$${numFmt(realP50)}`, color: '#475569' },
                { label: '规划预期收益 (IRR)', value: `${((mcResult.irr?.p50 || 0) * 100).toFixed(1)}%`, color: '#059669' },
              ].map(kpi => (
                <div key={kpi.label} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '14px 16px', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: 6 }}>{kpi.label}</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 800, color: kpi.color }}>{kpi.value}</div>
                </div>
              ))}
            </div>

            {/* 报告元信息 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', color: '#94a3b8', marginTop: 14, paddingTop: 14, borderTop: '1px solid #e2e8f0' }}>
              <span>报告日期：{reportDate}</span>
              {advisorName && <span>制作顾问：{advisorName}</span>}
              <span>Powered by Antigravity Wealth Engine</span>
            </div>
          </div>

          {/* ══ 第一章：这份方案想为您解决什么问题 ══ */}
          <section className="report-section page-break-inside-avoid">
            <h2>一、这份方案想为您解决什么问题？</h2>
            <div className="summary-statement">
              {salutation}如果您正在考虑
              <strong>「{goalText}」</strong>，
              这份方案正是为此而设计的。
            </div>
            <EditableText fieldKey="ch1BodyA" className="desc-text mt-15" {...editProps}>
              财富管理的核心挑战，从来不是「今年能赚多少」——而是如何让您的资产在几十年的时间跨度里，穿越通货膨胀、市场大跌与人生变局，依然能够支撑您和家人想要的生活。
            </EditableText>
            <EditableText fieldKey="ch1BodyB" className="desc-text" {...editProps}>
              本方案通过对全球资产配置进行科学优化，并结合 10,000 次模拟未来可能发生的不同市场路径，为您呈现一个诚实、立体、有风险边界的长期财富蓝图——不只告诉您「可能赚多少」，更告诉您「最坏会怎样」，以及「什么情况下需要调整」。
            </EditableText>
            {clientGoals.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
                {clientGoals.map(g => (
                  <span key={g} style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1d4ed8', padding: '4px 12px', borderRadius: 20, fontSize: '0.85rem', fontWeight: 600 }}>
                    ✓ {GOAL_LABELS[g] || g}
                  </span>
                ))}
              </div>
            )}
          </section>

          {/* ══ 第二章：方案的核心策略与假设 ══ */}
          <section className="report-section page-break-inside-avoid">
            <h2>二、方案的核心策略与财务假设</h2>
            <p className="desc-text">这是本次模拟的"剧本设定"——所有预测都建立在以下参数之上：</p>

            <div className="grid-2-col" style={{ marginTop: 16 }}>
              {/* 左：资金安排 */}
              <div>
                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>💰 资金安排</div>
                <ul className="params-list">
                  <li><span>初始投入</span><strong>${numFmt(labMcSettings.capital)}</strong></li>
                  {parseFloat(labMcSettings.contribution) > 0 && (
                    <li><span>年度追加</span><strong>${numFmt(labMcSettings.contribution)} / 年（第{labMcSettings.contribution_start}–{labMcSettings.contribution_years}年）</strong></li>
                  )}
                  {insPremiumData && (
                    <li><span>保险保费</span><strong>${numFmt(insPremiumData.total)}（分{insPremiumData.payYears}年缴纳）</strong></li>
                  )}
                  <li><span>模拟年限</span><strong>{runYears} 年</strong></li>
                </ul>
              </div>
              {/* 右：目标与规划 */}
              <div>
                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>🎯 目标与规划</div>
                <ul className="params-list">
                  <li><span>财富里程碑目标</span><strong>${numFmt(labMcSettings.target)}</strong></li>
                  {parseFloat(labMcSettings.withdrawal) > 0 && (
                    <li>
                      <span>年度提取</span>
                      <strong>
                        ${numFmt(labMcSettings.withdrawal)} / 年（第{labMcSettings.withdrawal_start}–{labMcSettings.withdrawal_end}年）
                        {labMcSettings.withdrawal_inflation ? ' ·随通胀递增' : ''}
                      </strong>
                    </li>
                  )}
                  <li>
                    <span>通胀假设</span>
                    <strong style={{ color: '#d97706' }}>{labMcSettings.inflation}% / 年</strong>
                  </li>
                  {mcResult.stressed_volatility && (
                    <li><span>压力测试</span><strong style={{ color: '#dc2626' }}>已启用（危机场景）</strong></li>
                  )}
                </ul>
              </div>
            </div>

            <p className="desc-text mt-15" style={{ fontSize: '0.88rem', background: '#fffbeb', padding: '10px 16px', borderLeft: '3px solid #fbbf24', borderRadius: '0 6px 6px 0' }}>
              ⚠️ <strong>重要说明：</strong>以上参数仅为模拟假设，实际投资结果受市场条件、费用、税务等因素影响，模拟结果不构成任何收益承诺。
            </p>
          </section>

          {/* ══ 第三章：资产配置方案 ══ */}
          <section className="report-section page-break-inside-avoid">
            <h2>三、资产配置方案：您的财富如何运转</h2>
            <p className="desc-text">
              本方案采用「<strong>科学优化的多元资产组合</strong>」策略，通过现代投资组合理论（MPT）在历史数据中寻找
              <strong>单位风险内最大化回报</strong>的配置方式。
            </p>

            <div className={insuranceEnabled ? 'allocation-wrapper' : ''} style={{ marginTop: 16 }}>
              {/* 保险底座（可选） */}
              {insuranceEnabled && insurancePlan && (
                <div className="alloc-box" style={{ borderLeft: '4px solid #059669', flex: 1 }}>
                  <h3 style={{ margin: '0 0 4px', fontSize: '1.05rem', color: '#047857' }}>🛡️ 防守基石（保险底座）</h3>
                  <p className="micro-desc" style={{ margin: '0 0 12px' }}>
                    {insurancePlan.label || '分红储蓄保险'} · 提供确定性现金价值底线
                  </p>
                  <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '12px 16px', fontSize: '0.9rem', color: '#065f46', lineHeight: 1.7 }}>
                    <p style={{ margin: '0 0 8px' }}>
                      <strong>它的作用：</strong>在投资组合遭遇系统性大跌时，保险的<strong>现金价值（CV）不随市场波动</strong>，
                      为您提供一道"刚性底线"——当市场血雨腥风，您至少还有这部分确定性资产可以依靠。
                    </p>
                    {insPremiumData && (
                      <p style={{ margin: 0 }}>
                        总保费投入：<strong>${numFmt(insPremiumData.total)}</strong>，分 <strong>{insPremiumData.payYears} 年</strong>缴纳。
                      </p>
                    )}
                  </div>
                  <p className="micro-desc mt-15" style={{ color: '#dc2626', fontSize: '0.8rem' }}>
                    ⚠️ 保险的非保证红利部分将随实际经营表现浮动，现金价值演示不代表确定承诺。
                  </p>
                </div>
              )}

              {/* 投资组合 */}
              <div className="alloc-box" style={{ borderLeft: '4px solid #2563eb', flex: insuranceEnabled ? 1.2 : undefined }}>
                <h3 style={{ margin: '0 0 4px', fontSize: '1.05rem', color: '#1d4ed8' }}>⚔️ 进攻引擎（投资组合）</h3>
                <p className="micro-desc" style={{ margin: '0 0 12px' }}>
                  预期年化收益 {((mcTargetPortfolio.expected_return || 0) * 100).toFixed(1)}% · 夏普比率 {(mcTargetPortfolio.sharpe_ratio || 0).toFixed(2)} · 波动率 {((mcTargetPortfolio.volatility || 0) * 100).toFixed(1)}%
                  {mcTargetPortfolio.dividend_yield > 0 && ` · 股息率 ${(mcTargetPortfolio.dividend_yield * 100).toFixed(1)}%`}
                </p>
                <table className="alloc-table">
                  <thead>
                    <tr>
                      <th>资产代码</th>
                      <th>资产名称</th>
                      <th style={{ textAlign: 'right' }}>配置权重</th>
                      <th style={{ textAlign: 'right' }}>在组合中的作用</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(mcTargetPortfolio.allocations || {})
                      .filter(([, w]) => w > 0.001)
                      .sort((a, b) => b[1] - a[1])
                      .map(([isin, weight]) => {
                        const stats = labData.asset_stats?.[isin] || {};
                        const autoRole = stats.expected_return > 0.1 ? '高成长引擎'
                          : stats.volatility < 0.1 ? '稳定压舱石'
                          : stats.dividend_yield > 0.03 ? '股息收益来源'
                          : '多元化缓冲';
                        const roleKey = `role_${isin}`;
                        const displayRole = editableFields[roleKey] ?? autoRole;
                        return (
                          <tr key={isin}>
                            <td><span className="isin-badge" style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1d4ed8' }}>{isin}</span></td>
                            <td style={{ color: '#475569', fontSize: '0.88rem' }}>{stats.name || '—'}</td>
                            <td style={{ textAlign: 'right', fontWeight: 700 }}>{(weight * 100).toFixed(1)}%</td>
                            <td style={{ textAlign: 'right', fontSize: '0.8rem', color: '#64748b' }}>
                              <EditableText tag="span" fieldKey={roleKey} {...editProps}>
                                {displayRole}
                              </EditableText>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {/* ══ 第四章：未来关键时间点的财富预估 ══ */}
          <section className="report-section page-break-inside-avoid">
            <h2>四、未来关键时间点的财富预估</h2>
            <div className="desc-text" style={{ marginBottom: '1.5rem', lineHeight: '1.6' }}>
              <p style={{ margin: '0 0 0.8rem 0' }}>为了让您更直观地感受未来的财富走向，我们提取了10,000次模拟结果，为您呈现三种可能的“市场天气”：</p>
              <ul style={{ paddingLeft: '1.5rem', margin: 0, color: '#334155' }}>
                <li style={{ marginBottom: '0.6rem' }}>
                  <strong style={{ color: '#1e3a8a' }}>中性预估 (P50)</strong>：<strong>常规的经济环境。</strong>这是最有可能发生的稳定预期，是我们做规划的核心基准。
                </li>
                <li style={{ marginBottom: '0.6rem' }}>
                  <strong style={{ color: '#dc2626' }}>悲观预估 (P10)</strong>：<strong>经济寒冬或金融危机。</strong>在极端的坏运气下（最差的10%情况）才会触及的底线数字。如果您发现即使是这个数字，依然能保障您的生活标准，说明方案具备足够的防御力。
                </li>
                <li>
                  <strong style={{ color: '#059669' }}>乐观预估 (P90)</strong>：<strong>经济繁荣的顺风局。</strong>排名前10%的好运气，可以说是市场给予长期投资者的额外奖励。
                </li>
              </ul>
            </div>

            <div style={{ overflowX: 'auto', marginTop: 16 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                <thead>
                  <tr style={{ background: '#1e3a8a', color: '#fff' }}>
                    <th style={{ padding: '12px 14px', textAlign: 'left', fontWeight: 600 }}>时间节点</th>
                    <th style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 600 }}>悲观预估 (P10)</th>
                    <th style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 600 }}>中性预估 (P50)</th>
                    <th style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 600 }}>乐观预估 (P90)</th>
                    {isCombined && <th style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 600, background: 'rgba(5,150,105,0.6)' }}>🛡️ 含保险 (P50)</th>}
                    <th style={{ padding: '12px 14px', textAlign: 'left', fontWeight: 600 }}>这意味着什么</th>
                  </tr>
                </thead>
                <tbody>
                  {milestones.map((m, i) => {
                    // 从原始chart中找对应年份的combined_p50
                    const chartPt = (mcResult.chart || []).find(pt => pt.year === m.year) || {};
                    return (
                      <tr key={m.year} style={{ background: i % 2 === 0 ? '#f8fafc' : '#fff', borderBottom: '1px solid #e2e8f0' }}>
                        <td style={{ padding: '12px 14px', fontWeight: 600, color: '#334155' }}>{m.label}</td>
                        <td style={{ padding: '12px 14px', textAlign: 'right', color: '#dc2626', fontWeight: 600 }}>
                          {m.p10 ? `$${numFmt(m.p10)}` : '—'}
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'right', color: '#1e3a8a', fontWeight: 700, fontSize: '1.0rem' }}>
                          {m.p50 ? `$${numFmt(m.p50)}` : '—'}
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'right', color: '#059669', fontWeight: 600 }}>
                          {m.p90 ? `$${numFmt(m.p90)}` : '—'}
                        </td>
                        {isCombined && (
                          <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 700, color: '#047857', background: 'rgba(240, 253, 244, 0.7)' }}>
                            {chartPt.combined_p50 ? `$${numFmt(chartPt.combined_p50)}` : '—'}
                          </td>
                        )}
                        <td style={{ padding: '12px 14px', color: '#64748b', fontSize: '0.82rem' }}>{m.note}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {isCombined && (
                <p style={{ fontSize: '0.8rem', color: '#047857', margin: '8px 0 0', textAlign: 'right' }}>
                  🛡️ 「含保险 (P50)」= 投资组合中性预估 + 保险中性现金价值，反映双核体系合并终值
                </p>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 20 }}>
              {[
                { label: '🚨 悲观情景 (P10)', val: p10, color: '#dc2626', bg: '#fef2f2', border: '#fca5a5', desc: '10,000次模拟中，仅有10%的结果更差。这是您需要心理准备应对的底线。' },
                { label: '⚖️ 中性情景 (P50)', val: p50, color: '#1e3a8a', bg: '#eff6ff', border: '#bfdbfe', desc: '中位数预期。一半的模拟路径高于此值，一半低于此值。最可能的结局。' },
                { label: '🚀 乐观情景 (P90)', val: p90, color: '#059669', bg: '#f0fdf4', border: '#86efac', desc: '超额顺风情景。90%的路径低于此值，属于较理想的市场发展状况。' },
              ].map(card => (
                <div key={card.label} style={{ background: card.bg, border: `1px solid ${card.border}`, borderRadius: 8, padding: '16px', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#475569', marginBottom: 8 }}>{card.label}</div>
                  <div style={{ fontSize: '1.7rem', fontWeight: 800, color: card.color }}>${numFmt(card.val)}</div>
                  <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: 8, lineHeight: 1.5 }}>{card.desc}</div>
                </div>
              ))}
            </div>

            {inflationDec > 0 && (
              <p className="desc-text mt-15" style={{ fontSize: '0.88rem', background: '#fdf4ff', padding: '10px 16px', borderLeft: '3px solid #a855f7', borderRadius: '0 6px 6px 0' }}>
                💡 <strong>通胀提醒：</strong>以上金额均为名义值。按 {labMcSettings.inflation}% 年均通胀计算，
                {runYears} 年后的 ${numFmt(p50)} 相当于今日购买力约 <strong style={{ color: '#7e22ce' }}>${numFmt(realP50)}</strong>。
                真正的财富保值，需要名义增长<strong>超越</strong>通胀速度。
              </p>
            )}
          </section>

          {/* ══ 第五章：年度提取计划 ══ */}
          {withdrawSchedule.length > 0 && (
            <section className="report-section page-break-inside-avoid">
              <h2>五、您的年度提取计划</h2>
              <p className="desc-text">
                从<strong>第{labMcSettings.withdrawal_start}年</strong>起，您计划每年从组合中提取资金用于生活支出或其他安排。
                {labMcSettings.withdrawal_inflation
                  ? `由于设定了"随通胀调整"，提取金额将每年递增 ${labMcSettings.inflation}%，确保实际购买力不缩水。`
                  : '提取金额保持固定，随时间通胀率将侵蚀实际购买力，建议定期复评该参数。'}
              </p>

              <div className="chart-print-container" style={{ marginTop: 16 }}>
                <ResponsiveContainer width="100%" height={280}>
                  <ComposedChart data={cfData} margin={{ top: 10, right: 20, left: 20, bottom: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 11 }} interval={Math.floor(cfData.length / 10)} />
                    <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={{ fill: '#64748b', fontSize: 11 }} />
                    <Legend wrapperStyle={{ fontSize: '12px' }} verticalAlign="top" height={36} />
                    <Bar dataKey="insOutflow" stackId="out" fill="#fbbf24" name="保险保费" />
                    <Bar dataKey="portOutflow" stackId="out" fill="#f87171" name="组合投入" />
                    <Bar dataKey="insInflow"   stackId="in"  fill="#34d399" name="保险提取" />
                    <Bar dataKey="portInflow"  stackId="in"  fill="#60a5fa" name="组合提取" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              <div style={{ overflowX: 'auto', marginTop: 16 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ background: '#1e3a8a', color: '#fff' }}>
                      <th style={{ padding: '10px 14px', textAlign: 'left' }}>年份</th>
                      <th style={{ padding: '10px 14px', textAlign: 'right' }}>组合提取</th>
                      {insuranceEnabled && insurancePlan && <th style={{ padding: '10px 14px', textAlign: 'right', background: 'rgba(5,150,105,0.6)' }}>🛡️ 保单提取</th>}
                      {insuranceEnabled && insurancePlan && <th style={{ padding: '10px 14px', textAlign: 'right', background: 'rgba(29,78,216,0.5)' }}>合计到手</th>}
                      <th style={{ padding: '10px 14px', textAlign: 'right' }}>累计提取</th>
                      <th style={{ padding: '10px 14px', textAlign: 'left' }}>说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {withdrawSchedule.map((row, idx) => {
                      const i = row.originalIndex;
                      return (
                      <tr key={row.year} style={{ background: idx % 2 === 0 ? '#f8fafc' : '#fff', borderBottom: '1px solid #e2e8f0' }}>
                        <td style={{ padding: '10px 14px', color: '#334155' }}>第{row.year}年{clientAge ? `（${clientAge + row.year}岁）` : ''}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: row.amount > 0 ? '#1e3a8a' : '#94a3b8' }}>
                          {row.amount > 0 ? `$${numFmt(row.amount)}` : '—'}
                        </td>
                        {insuranceEnabled && insurancePlan && (
                          <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: row.insAmount > 0 ? '#047857' : '#94a3b8', background: 'rgba(240,253,244,0.5)' }}>
                            {row.insAmount > 0 ? `$${numFmt(row.insAmount)}` : '—'}
                          </td>
                        )}
                        {insuranceEnabled && insurancePlan && (
                          <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 800, color: '#1d4ed8', background: 'rgba(239,246,255,0.5)' }}>
                            ${numFmt(row.total)}
                          </td>
                        )}
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: '#475569' }}>
                          ${numFmt(row.cumulative)}
                        </td>
                        <td style={{ padding: '10px 14px', color: '#64748b', fontSize: '0.82rem' }}>
                          {i === 0 ? '开始提取' : ''}
                          {row.amount > 0 && i > 0 ? (labMcSettings.withdrawal_inflation ? `组合基准×(1+${labMcSettings.inflation}%)^${i}` : '组合固定提取') : ''}
                          {row.amount > 0 && row.insAmount > 0 ? '；' : ''}
                          {row.insAmount > 0 ? '保单按约定提取' : ''}
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
                {withdrawScheduleFullInfo.totalCount > 5 && (
                  <p style={{ fontSize: '0.82rem', color: '#94a3b8', margin: '8px 0 0', textAlign: 'right' }}>
                    ＊仅展示前5年及后续每5年间隔数据；完整提取计划延续至第{withdrawScheduleFullInfo.endYear}年
                  </p>
                )}
              </div>
            </section>
          )}

          {/* ══ 第六章：保险对整体资产配置的量化影响 ══ */}
          {insuranceEnabled && insurancePlan && (
            <section className="report-section page-break-inside-avoid">
              <h2>六、保险如何改变了整个资产配置的格局？</h2>
              <p className="desc-text">
                引入保险底座，不只是增加了一张保单——它从根本上改变了整个财富体系的风险特征与长期表现。
                以下是本次蒙特卡洛模拟计算出的<strong>量化改变</strong>：
              </p>

              {/* ─ 终值贡献对比卡片 ─ */}
              {isCombined && (
                <>
                  <h3 style={{ fontSize: '1.05rem', color: '#334155', marginTop: 20, marginBottom: 12 }}>📈 {runYears}年后终值：叠加保险底座的实际贡献</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                    {[
                      {
                        label: '纯投资组合终值 (P50)',
                        val: pureP50,
                        color: '#1e3a8a',
                        bg: '#f8fafc',
                        border: '#cbd5e1',
                        desc: '投资组合单独运作的中性结果'
                      },
                      {
                        label: '保险底座额外贡献',
                        val: insContribP50,
                        color: '#047857',
                        bg: '#f0fdf4',
                        border: '#86efac',
                        desc: '保险现金价值（中性实现率）在终点新增的确定性资产'
                      },
                      {
                        label: '双核合并终值 (P50)',
                        val: p50,
                        color: '#1d4ed8',
                        bg: '#eff6ff',
                        border: '#bfdbfe',
                        desc: '投资组合 + 保险CV的综合财富总量'
                      },
                    ].map(card => (
                      <div key={card.label} style={{ background: card.bg, border: `1px solid ${card.border}`, borderRadius: 8, padding: '16px', textAlign: 'center' }}>
                        <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: 6 }}>{card.label}</div>
                        <div style={{ fontSize: '1.5rem', fontWeight: 800, color: card.color }}>${numFmt(card.val)}</div>
                        <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 6, lineHeight: 1.4 }}>{card.desc}</div>
                      </div>
                    ))}
                  </div>

                  {/* 杠杆效果说明 */}
                  {insLeverage && (
                    <div style={{ marginTop: 12, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '12px 16px', fontSize: '0.88rem', color: '#92400e' }}>
                      💡 <strong>保险杠杆效果：</strong>您投入保费合计 <strong>${numFmt(insPremiumData?.total)}</strong>，
                      保险在 {runYears} 年内共创造了两项价值：
                      期间累计提取 <strong>${numFmt(totInsWithdrawal)}</strong>
                      {totInsWithdrawal > 0 ? ' + ' : ''}
                      {totInsWithdrawal > 0 && <>终点合并底线 <strong>${numFmt(insContribP50)}</strong></>}
                      {totInsWithdrawal <= 0 && <>终点形成合并底线 <strong>${numFmt(insContribP50)}</strong></>}
                      ，两者合计 <strong>${numFmt(insTotalReturn)}</strong>——
                      相当于原始保费的 <strong>{insLeverage.toFixed(1)}x</strong>（中性实现率下）。
                    </div>
                  )}

                  {/* 悲观情景：保险价值尤为突出 */}
                  <h3 style={{ fontSize: '1.05rem', color: '#334155', marginTop: 24, marginBottom: 12 }}>🌩️ 危机时刻：P10 悲观情景下，保险的守护价值</h3>
                  <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '16px 20px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: 4 }}>纯组合悲观终值</div>
                        <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#dc2626' }}>${numFmt(pureP10)}</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: 4 }}>保险底座悲观贡献</div>
                        <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#d97706' }}>+${numFmt(insContribP10)}</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: 4 }}>合并悲观终值</div>
                        <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#dc2626' }}>${numFmt(p10)}</div>
                      </div>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.88rem', color: '#7f1d1d', lineHeight: 1.6 }}>
                      在最坏的10%市场场景下，投资组合跌至 ${numFmt(pureP10)}。此时保险的确定性现金价值
                      额外托底 <strong>${numFmt(insContribP10)}</strong>，令您的实际可用财富提升至 ${numFmt(p10)}。
                      这笔钱的意义，是在市场最黑暗的时刻，让您不必恐慌性卖出资产来应急。
                    </p>
                  </div>
                </>
              )}

              {/* ─ 回撤收窄对比 ─ */}
              {isCombined && (
                <>
                  <h3 style={{ fontSize: '1.05rem', color: '#334155', marginTop: 24, marginBottom: 12 }}>📉 波动性改变：保险如何平滑了组合的极端跌幅</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '16px 18px' }}>
                      <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#dc2626', marginBottom: 10 }}>❌ 纯投资组合（裸露风险）</div>
                      <div style={{ fontSize: '0.88rem', color: '#7f1d1d', lineHeight: 1.8 }}>
                        <div>悲观情景最大回撤：<strong>{(Math.abs(dd.p10) * 100).toFixed(1)}%</strong></div>
                        <div>中性情景最大回撤：<strong>{(Math.abs(dd.p50) * 100).toFixed(1)}%</strong></div>
                        <div>乐观情景最大回撤：<strong>{(Math.abs(dd.p90) * 100).toFixed(1)}%</strong></div>
                      </div>
                    </div>
                    <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, padding: '16px 18px' }}>
                      <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#047857', marginBottom: 10 }}>✅ 双核合并体系（保险已生效）</div>
                      <div style={{ fontSize: '0.88rem', color: '#065f46', lineHeight: 1.8 }}>
                        <div>悲观情景最大回撤：<strong>{(Math.abs(cdd.p10) * 100).toFixed(1)}%</strong>
                          {ddImprovementP10 > 0.001 && <span style={{ marginLeft: 6, fontSize: '0.78rem', background: '#dcfce7', color: '#047857', padding: '1px 6px', borderRadius: 10 }}>↓ 收窄 {(ddImprovementP10 * 100).toFixed(1)}%</span>}
                        </div>
                        <div>中性情景最大回撤：<strong>{(Math.abs(cdd.p50) * 100).toFixed(1)}%</strong></div>
                        <div>乐观情景最大回撤：<strong>{(Math.abs(cdd.p90) * 100).toFixed(1)}%</strong></div>
                      </div>
                    </div>
                  </div>
                  <div style={{ marginTop: 10, background: '#f0fdf4', border: '1px solid #a7f3d0', borderRadius: 6, padding: '10px 14px', fontSize: '0.85rem', color: '#065f46' }}>
                    🔍 <strong>解读：</strong>引入保险后，最差市场环境下的最大回撤从 <strong>{(Math.abs(dd.p10) * 100).toFixed(1)}%</strong> 收窄至 <strong>{(Math.abs(cdd.p10) * 100).toFixed(1)}%</strong>，
                    收窄了约 <strong>{(ddImprovementP10 * 100).toFixed(1)} 个百分点</strong>。
                    这个数字的背后含义是：当市场崩溃最深的时候，保险充当了"减震器"，
                    让您的整体净值不至于同步大幅缩水。
                  </div>
                </>
              )}

              {/* ─ 终期CV分层 ─ */}
              {insCvAtEnd && (
                <>
                  <h3 style={{ fontSize: '1.05rem', color: '#334155', marginTop: 24, marginBottom: 12 }}>📊 第{runYears}年保险现金价值：三情景分层</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                    {[
                      { label: '悲观实现率 (α=80%)', val: insCvAtEnd.low, color: '#d97706', bg: '#fffbeb', border: '#fde68a', desc: '非保证红利以80%比例实现时的保险终值' },
                      { label: '中性实现率 (α=100%)', val: insCvAtEnd.mid, color: '#047857', bg: '#f0fdf4', border: '#86efac', desc: '非保证红利以100%全额实现时的保险终值（计划书演示值）' },
                      { label: '乐观实现率 (α=115%)', val: insCvAtEnd.high, color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe', desc: '非保证红利超额实现时的保险终值（历史较好表现）' },
                    ].map(c => (
                      <div key={c.label} style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 8, padding: '14px', textAlign: 'center' }}>
                        <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: 6 }}>{c.label}</div>
                        <div style={{ fontSize: '1.4rem', fontWeight: 800, color: c.color }}>${numFmt(c.val)}</div>
                        <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: 5, lineHeight: 1.4 }}>{c.desc}</div>
                      </div>
                    ))}
                  </div>
                  <p style={{ fontSize: '0.82rem', color: '#64748b', margin: '10px 0 0' }}>
                    ⚠️ 「悲观/中性/乐观」三档对应非保证红利的不同实现率，保证现金价值部分在所有情景下均以合同约定数额生效。
                  </p>
                </>
              )}

              {/* ─ 提取覆盖率 ─ */}
              {withdrawalCovPct > 0 && (
                <>
                  <h3 style={{ fontSize: '1.05rem', color: '#334155', marginTop: 24, marginBottom: 12 }}>💰 保险现金流：对年度提取的覆盖能力</h3>
                  <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8, padding: '16px 20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
                      <div style={{ textAlign: 'center', minWidth: 120 }}>
                        <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: 4 }}>保险累计提取</div>
                        <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0369a1' }}>${numFmt(totInsWithdrawal)}</div>
                      </div>
                      <div style={{ textAlign: 'center', minWidth: 120 }}>
                        <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: 4 }}>对投资组合提取的覆盖率</div>
                        <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0ea5e9' }}>{withdrawalCovPct.toFixed(1)}%</div>
                      </div>
                      <div style={{ flex: 1, fontSize: '0.88rem', color: '#0c4a6e', lineHeight: 1.7, minWidth: 200 }}>
                        在提取阶段，保险每年释放的现金可以覆盖您 {withdrawalCovPct.toFixed(0)}% 的资金需求，
                        这意味着投资组合被取用的压力相应减少——
                        <strong>资产更有机会在市场中以复利滚动，而不是被迫变现</strong>。
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* ─ 家人保障与传承 ─ */}
              <h3 style={{ fontSize: '1.05rem', color: '#334155', marginTop: 24, marginBottom: 12 }}>🏛️ 对家人：财富传承的确定性工具</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, padding: '18px 20px' }}>
                  <h4 style={{ margin: '0 0 10px', color: '#047857', fontSize: '1.0rem' }}>🛡️ 对您自己：刚性现金底线</h4>
                  <p style={{ margin: 0, fontSize: '0.9rem', color: '#065f46', lineHeight: 1.7 }}>
                    无论市场如何剧烈波动，保单的<strong>保证现金价值</strong>依约生效——
                    不受股市崩盘拖累，不受利率周期影响。
                    这是您在最坏情景下，仍然握有的那笔"不会消失"的资产底线。
                  </p>
                </div>
                <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '18px 20px' }}>
                  <h4 style={{ margin: '0 0 10px', color: '#1d4ed8', fontSize: '1.0rem' }}>🏛️ 对家人：灵活多元的传承通道</h4>
                  <p style={{ margin: 0, fontSize: '0.9rem', color: '#1e40af', lineHeight: 1.7 }}>
                    储蓄分红险提供<strong>两条并行的传承路径</strong>：
                  </p>
                  <ul style={{ margin: '10px 0 0', paddingLeft: 20, fontSize: '0.9rem', color: '#1e40af', lineHeight: 1.8 }}>
                    <li>
                      <strong>身故赔偿：</strong>以「保证现金价值、已缴保费或保单价值三者取高赔付」执行，
                      家人收到的赔偿金通常不低于总投入，且<strong>无需遗嘱认证</strong>，私密高效。
                    </li>
                    <li>
                      <strong>无限次更改受保人：</strong>在保单有效期内，您可不限次数地更换受保人——
                      将保单直接传递给子女甚至孙辈，实现跨代财富延续，
                      且全程<strong>无需触发遗产税或赠与税节点</strong>，是比遗嘱更灵活的主动传承工具。
                    </li>
                  </ul>
                </div>
              </div>

              {/* ─ 动态增配建议 ─ */}
              <h3 style={{ fontSize: '1.05rem', color: '#334155', marginTop: 24, marginBottom: 12 }}>🛡️ 动态增配法则：何时需要为扩大的资产池加配保险？</h3>
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '16px 20px', fontSize: '0.88rem', color: '#475569', lineHeight: 1.7 }}>
                <p style={{ margin: '0 0 8px' }}>
                  虽然当前的保险为您构建了坚实的防线，但随着未来<strong>投资组合净值的不断放大</strong>（复利滚雪球），原本的保险现金价值在总资产中的占比将被不断稀释，兜底保护的效力也会相应减弱。
                </p>
                <p style={{ margin: '0 0 8px' }}>
                  <strong>系统建议触发条件：</strong>当您的风险资产规模由于市场大幅上涨，导致<strong>保单现金价值占总净资产的比例低于 15% - 20%</strong> 时；或者当您的<strong>年度基础开销超过保单可提取金额的 3 倍</strong>时。
                </p>
                <p style={{ margin: 0 }}>
                  <strong>执行动作：</strong>此时应考虑将部分投资组合的超额利润（Profit Taking）进行兑现，<strong>增配新的保险资产或稳健固收类资产</strong>，重新将防御底座的比例筑高，锁定胜利果实，确保面对下一次黑天鹅危机时依然保有充足的底气。
                </p>
              </div>

              <div style={{ marginTop: 24, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '14px 18px' }}>
                <p style={{ margin: 0, fontSize: '0.88rem', color: '#92400e', lineHeight: 1.7 }}>
                  ⚠️ <strong>合规提示：</strong>保险的<strong>非保证红利</strong>（复归红利、终期分红）
                  依赖保险公司实际经营表现，存在波动可能性。上述量化结果基于蒙特卡洛统计模拟及当前精算假设，
                  不构成任何形式的收益承诺或合同保证。请结合计划书中明确标注的"保证/非保证"栏目综合评估。
                </p>
              </div>
            </section>
          )}

          {/* ══ 第七章：方案的灵活性与风险边界 ══ */}
          <section className="report-section page-break-inside-avoid">
            <h2>{insuranceEnabled ? '七' : '六'}、方案的灵活性与风险边界</h2>
            <p className="desc-text">
              真实的财富规划，必须提前回答"如果市场走坏，会发生什么"这个诚实的问题。
              以下是本方案在极端情景下的行为分析——以及您拥有的调整空间。
            </p>

            {/* 回撤分析 */}
            <h3 style={{ fontSize: '1.05rem', color: '#334155', marginTop: 20, marginBottom: 12 }}>📉 极端市场下的回撤压力</h3>
            <div className="drawdown-comparison">
              <div className="dd-row">
                <h4>投资组合（单独）<span className="dd-tag">裸露风险</span></h4>
                <div className="dd-stats">
                  <span>悲观情景: <strong style={{ color: '#dc2626' }}>{(dd.p10 * 100).toFixed(1)}%</strong></span>
                  <span>中性情景: <strong>{(dd.p50 * 100).toFixed(1)}%</strong></span>
                  <span>乐观情景: <strong style={{ color: '#16a34a' }}>{(dd.p90 * 100).toFixed(1)}%</strong></span>
                </div>
              </div>
              {insuranceEnabled && (
                <div className="dd-row mt-10">
                  <h4>双核合并体系<span className="dd-tag safe">对冲生效</span></h4>
                  <div className="dd-stats">
                    <span>悲观情景: <strong style={{ color: '#d97706' }}>{(cdd.p10 * 100).toFixed(1)}%</strong></span>
                    <span>中性情景: <strong>{(cdd.p50 * 100).toFixed(1)}%</strong></span>
                    <span>乐观情景: <strong style={{ color: '#16a34a' }}>{(cdd.p90 * 100).toFixed(1)}%</strong></span>
                  </div>
                </div>
              )}
            </div>

            <div className="insight-quote" style={{ marginTop: 16 }}>
              💡 <strong>关键解读：</strong>
              {insuranceEnabled && mcResult.combined_drawdown
                ? `叠加保险底座后，极端悲观情景（P10）下的组合最大回撤从 ${(Math.abs(dd.p10) * 100).toFixed(1)}% 缩减至 ${(Math.abs(cdd.p10) * 100).toFixed(1)}%。
                   这不只是数字差距，而是当市场像2008年金融危机那样暴跌时，
                   您能否熬过最艰难阶段、等到反弹的关键。`
                : `在最悲观的10%情景下，组合可能经历 ${(Math.abs(dd.p10) * 100).toFixed(1)}% 的最大回撤。
                   这是一个需要有心理准备的数字——但历史数据告诉我们，
                   能够坚守长期策略、不在恐慌中卖出的投资者，最终都取得了正回报。`}
            </div>

            {/* 调整弹性 */}
            <div className="rules-grid" style={{ marginTop: 20 }}>
              <div className="rule-box">
                <h4 style={{ color: '#dc2626' }}>⚠️ 当遭遇熊市：请做什么</h4>
                <p>
                  <strong>不要在恐慌中卖出</strong>。应优先动用保险现金价值或现金储备度过低谷期，
                  保留住投资组合等待均值回归。每每季度或每半年度进行配置复评，但不要因为恐惧而频繁操作。
                </p>
              </div>
              <div className="rule-box">
                <h4 style={{ color: '#059669' }}>🎯 当遭遇牛市：请做什么</h4>
                <p>
                  建议每季度或每半年度进行一次「纪律性再平衡」——切削涨幅过大的资产，补充跌落的资产，
                  维持原设计的风险敞口，不要被短期高收益诱导偏离长期策略。
                </p>
              </div>
            </div>
          </section>

          {/* ══ 第八章：关于我们 ══ */}
          <section className="report-section page-break-inside-avoid">
            <h2>{insuranceEnabled ? '八' : '七'}、关于我们的服务</h2>
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '24px 28px', color: '#475569', lineHeight: 1.9, fontSize: '0.92rem' }}>
              <p style={{ margin: '0 0 8px', fontStyle: 'italic', color: '#94a3b8', fontSize: '0.78rem' }}>
                {editMode ? '↓ 点击下方文字直接编辑' : '── 顾问/机构简介 ──'}
              </p>
              <EditableText
                fieldKey="aboutUs"
                style={{ margin: '0 0 12px', display: 'block', lineHeight: 1.9 }}
                {...editProps}
              >
                {advisorName
                  ? `本报告由 ${advisorName} 编制。我们致力于以科学、透明、有温度的方式，为高净值家庭提供长期财富规划服务。`
                  : '本报告由您的财富规划顾问编制。我们致力于以科学、透明、有温度的方式，为高净值家庭提供长期财富规划服务。'}
              </EditableText>
              <EditableText
                fieldKey="aboutService"
                style={{ margin: '0 0 16px', display: 'block', lineHeight: 1.9, color: '#0369a1', fontWeight: 500 }}
                {...editProps}
              >
                财富规划绝不是一次性的交易，而是长期的陪伴。在未来的财富成长过程中，我们会为您持续监控投资组合的健康状况，进行及时的动态再平衡（Rebalancing）。我们将每半年为您提供一次深度的财务复盘，确保您的资产配置始终与人生目标保持同步。
              </EditableText>
              <EditableText
                fieldKey="aboutUsFootnote"
                style={{ margin: 0, color: '#94a3b8', fontSize: '0.82rem', display: 'block' }}
                {...editProps}
              >
                ＊ 机构背景、资质信息及完整服务说明，将在正式版本中补充。如需了解更多，请与您的顾问联系。
              </EditableText>
            </div>
          </section>

          {/* ══ 第九章：法律声明 ══ */}
          <section className="report-section page-break-inside-avoid">
            <h2 style={{ color: '#94a3b8', fontSize: '1.1rem' }}>{insuranceEnabled ? '九' : '八'}、重要声明与法律提示</h2>
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '16px 20px', fontSize: '0.82rem', color: '#64748b', lineHeight: 1.8 }}>
              <p style={{ margin: '0 0 4px', fontWeight: 600, color: '#475569' }}>关于模拟性质：</p>
              <EditableText fieldKey="disclaimer1" style={{ margin: '0 0 10px', display: 'block' }} {...editProps}>
                本报告中所有财富预测数据均来自蒙特卡洛统计模拟，基于历史价格数据，通过几何布朗运动模型（GBM）生成10,000条随机路径。P10/P50/P90 为概率分位数，不代表实际投资结果将落在此区间。
              </EditableText>
              <p style={{ margin: '0 0 4px', fontWeight: 600, color: '#475569' }}>关于保证与非保证：</p>
              <EditableText fieldKey="disclaimer2" style={{ margin: '0 0 10px', display: 'block' }} {...editProps}>
                保险产品中标注「保证」的现金价值由保单合同约定，具有法律效力；标注「非保证」的红利部分（包括复归红利、终期红利）由保险公司视乎实际经营表现而定，存在高于或低于演示值的可能性。
              </EditableText>
              <p style={{ margin: '0 0 4px', fontWeight: 600, color: '#475569' }}>关于投资风险：</p>
              <EditableText fieldKey="disclaimer3" style={{ margin: '0 0 10px', display: 'block' }} {...editProps}>
                所有投资均涉及风险，包括本金损失的可能性。过去的表现不代表未来结果。分散投资不能保证收益或防止损失。
              </EditableText>
              <p style={{ margin: '0 0 4px', fontWeight: 600, color: '#475569' }}>关于建议性质：</p>
              <EditableText fieldKey="disclaimer4" style={{ margin: 0, display: 'block' }} {...editProps}>
                本报告仅供参考，不构成任何形式的投资建议、保险销售要约或财务规划合同。具体决策请结合您的实际财务状况、风险承受能力及相关监管规定，在专业顾问指导下进行。
              </EditableText>
            </div>

            <div className="footer-signoff">
              <p>Generated by <strong>Antigravity Wealth Engine</strong> · {reportDate}</p>
            </div>
          </section>

        </div>{/* end wealth-report-content */}
      </div>{/* end wealth-report-container */}
    </div>
  );
};

// 外层守卫：没有蒙特卡洛结果时不渲染（hook 不能放在提前 return 之后）。
const WealthReport = (props) => {
  if (!props.labData?.monte_carlo) return null;
  return <WealthReportContent {...props} />;
};

export default WealthReport;
