import React from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import {
  Printer,
  FileText,
  UserCog,
  Download,
  X,
  ShieldCheck,
  TrendingUp,
  Layers,
  AlertTriangle,
} from 'lucide-react';
import XRayReportSection from './XRayReportSection';
import { computePortfolioXRay } from '../utils/portfolioXRay';

const CURRENCY_SYMBOL_MAP = {
  USD: '$',
  HKD: 'HK$',
  SGD: 'S$',
  CNY: '¥',
  RMB: '¥',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
};

function currencySymbol(code) {
  const key = String(code || 'USD').toUpperCase();
  return CURRENCY_SYMBOL_MAP[key] || `${key} `;
}

function fmtMoney(val, currency = 'USD') {
  const num = Number(val);
  if (!Number.isFinite(num)) return '—';
  const sym = currencySymbol(currency);
  const absFormatted = Math.round(Math.abs(num)).toLocaleString('en-US');
  return num < 0 ? `-${sym}${absFormatted}` : `${sym}${absFormatted}`;
}

function fmtCompact(val, currency = 'USD') {
  const num = Number(val);
  if (!Number.isFinite(num)) return '—';
  const sym = currencySymbol(currency);
  if (Math.abs(num) >= 1_000_000) return `${sym}${(num / 1_000_000).toFixed(2)}M`;
  if (Math.abs(num) >= 1_000) return `${sym}${Math.round(num / 1_000)}k`;
  return `${sym}${Math.round(num)}`;
}

function fmtPct(ratio, digits = 1, alreadyPct = false) {
  const num = Number(ratio);
  if (!Number.isFinite(num)) return '—';
  const pctVal = alreadyPct ? num : num * 100;
  return `${pctVal.toFixed(digits)}%`;
}

function resolveRationale(isin, weightPct, stats, clientInfo) {
  const map = clientInfo?.holdings_rationale;
  if (map && typeof map === 'object' && !Array.isArray(map)) {
    const direct = map[isin] || map[String(isin).toUpperCase()];
    if (direct && String(direct).trim()) return String(direct).trim();
  }
  const cls = String(stats?.asset_class || stats?.category || '').toLowerCase();
  const dy = Number(stats?.dividend_yield || 0);
  if (cls.includes('cash') || cls.includes('money') || cls.includes('bond') || cls.includes('treasury')) {
    return '防御流动性与利率压舱石，平抑极端回撤并承接现金流需求';
  }
  if (dy >= 0.035 || dy >= 3.5) {
    return '高息内生现金流来源，降低熊市期被动卖出本金的序列风险';
  }
  if (weightPct >= 25) {
    return '核心配置底层锚定资产，承担长期复利与组合 beta 驱动主力';
  }
  return '多元分散因子补充，增强跨周期夏普比率与抗通胀韧性';
}

const BriefTooltip = ({ active, payload, label, currency }) => {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload || {};
  return (
    <div
      style={{
        background: '#FAF8F3',
        border: '1px solid #C8C1B4',
        borderRadius: '4px',
        padding: '10px 12px',
        boxShadow: '0 4px 14px rgba(24, 32, 28, 0.12)',
        color: '#18201C',
        minWidth: '200px',
        fontSize: '0.78rem',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: '0.92rem',
          borderBottom: '1px solid #E5DFD3',
          paddingBottom: '4px',
          marginBottom: '6px',
        }}
      >
        第 {label} 年财富推演快照
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '14px', padding: '2px 0' }}>
        <span style={{ color: '#9A6F38', fontWeight: 600 }}>乐观情景 (P90)</span>
        <span className="ips-mono" style={{ fontWeight: 700 }}>{fmtMoney(row.p90Val, currency)}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '14px', padding: '2px 0' }}>
        <span style={{ color: '#1E4D3B', fontWeight: 600 }}>中性预期 (P50)</span>
        <span className="ips-mono" style={{ fontWeight: 700, color: '#1E4D3B' }}>{fmtMoney(row.p50Val, currency)}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '14px', padding: '2px 0' }}>
        <span style={{ color: '#8C3B32', fontWeight: 600 }}>防御底线 (P10)</span>
        <span className="ips-mono" style={{ fontWeight: 700, color: '#8C3B32' }}>{fmtMoney(row.p10Val, currency)}</span>
      </div>
      {row.realP50Val != null && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '14px', padding: '4px 0 0', marginTop: '4px', borderTop: '1px dashed #E5DFD3' }}>
          <span style={{ color: '#5F6662' }}>折现购买力 (P50)</span>
          <span className="ips-mono">{fmtMoney(row.realP50Val, currency)}</span>
        </div>
      )}
      {row.divGenerated > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '14px', padding: '2px 0' }}>
          <span style={{ color: '#1E4D3B' }}>当年内生分红</span>
          <span className="ips-mono">+{fmtMoney(row.divGenerated, currency)}</span>
        </div>
      )}
    </div>
  );
};

export default function ClientBriefReport({
  labData,
  labMcSettings,
  labBaseCurrency = 'USD',
  stressTestData = null,
  xrayData = null,
  quantFunds = [],
  insuranceEnabled = false,
  insurancePlan = null,
  clientInfo = null,
  onOpenClientInfo,
  onGenerateWord,
  reportLoading = false,
  onClose,
  onSwitchProfessional,
}) {
  if (!labData || !labData.monte_carlo) return null;

  const mc = labData.monte_carlo;
  const settings = labMcSettings || {};
  const currency = labBaseCurrency || 'USD';
  const years = Number(settings.years || (mc.chart?.length ? mc.chart[mc.chart.length - 1].year : 20) || 20);
  const capital = Number(settings.capital || 1000000);
  const target = Number(settings.target || 0);
  const inflation = Number(settings.inflation || 0);
  const hasInflation = inflation > 0;
  const contribution = Number(settings.contribution || 0);
  const withdrawal1 = Number(settings.withdrawal || 0);
  const withdrawal2 = Number(settings.withdrawal_2 || 0);
  const hasWithdrawal = withdrawal1 > 0 || withdrawal2 > 0;

  const targetKey = labData.mc_target_label || (labData.custom_portfolio ? 'custom_portfolio' : 'max_sharpe');
  const targetPf = labData[targetKey] || labData.custom_portfolio || labData.max_sharpe || labData.min_volatility || labData.risk_parity || {};

  const rawChart = Array.isArray(mc.chart) ? mc.chart : [];
  const insuranceIsActive = Boolean(
    insuranceEnabled && insurancePlan && rawChart.length > 1 && rawChart[1]?.ins_cv_p50 !== undefined
  );

  const chartSeries = rawChart.map((row) => {
    const p10Val = Number(insuranceIsActive && row.combined_p10 !== undefined ? row.combined_p10 : row.p10 ?? 0);
    const p50Val = Number(insuranceIsActive && row.combined_p50 !== undefined ? row.combined_p50 : row.p50 ?? 0);
    const p90Val = Number(insuranceIsActive && row.combined_p90 !== undefined ? row.combined_p90 : row.p90 ?? 0);
    const realRaw = insuranceIsActive && row.combined_real_p50 !== undefined ? row.combined_real_p50 : row.real_p50;
    return {
      year: row.year,
      p10Val,
      p50Val,
      p90Val,
      corridor: [p10Val, p90Val],
      realP50Val: hasInflation && realRaw !== undefined ? Number(realRaw) : null,
      divGenerated: Number(row.div_generated || 0),
      actualDraw: row.actual_draw_p50 !== undefined ? Number(row.actual_draw_p50) : null,
    };
  });

  const lastRow = chartSeries[chartSeries.length - 1] || { p10Val: capital, p50Val: capital, p90Val: capital };
  const firstYearRow = chartSeries.find((r) => Number(r.year) === 1) || chartSeries[1] || lastRow;

  const allocationsEntries = Object.entries(targetPf.allocations || {})
    .map(([isin, rawW]) => {
      const numW = parseFloat(rawW) || 0;
      const weightPct = numW > 1.001 ? numW : numW * 100;
      return {
        isin,
        weightPct,
        amount: capital * (weightPct / 100),
        stats: labData.asset_stats?.[isin] || {},
      };
    })
    .filter((item) => item.weightPct > 0.01)
    .sort((a, b) => b.weightPct - a.weightPct);

  const drawdownObj = (insuranceIsActive && mc.combined_drawdown) ? mc.combined_drawdown : mc.drawdown;
  const p50DdStr = drawdownObj?.p50 != null ? `${(drawdownObj.p50 * 100).toFixed(1)}%` : '—';
  const p10DdStr = drawdownObj?.p10 != null ? (drawdownObj.p10 <= -0.999 ? '极端提领边界' : `${(drawdownObj.p10 * 100).toFixed(1)}%`) : '—';

  // Milestones at ~1/3, ~2/3, and final horizon
  const candidateYears = Array.from(
    new Set([
      Math.max(1, Math.round(years / 3)),
      Math.max(2, Math.round((years * 2) / 3)),
      years,
    ])
  ).sort((a, b) => a - b);
  const milestoneRows = candidateYears
    .map((yr) => chartSeries.find((r) => Number(r.year) === yr) || chartSeries[Math.min(yr, chartSeries.length - 1)])
    .filter(Boolean);

  const availableStressScenarios = Array.isArray(stressTestData?.scenarios)
    ? stressTestData.scenarios.filter((s) => s.available)
    : [];

  const solvencyRate = mc.solvency_rate;
  const successRate = mc.success_rate;
  const useSolvencyPrimary = hasWithdrawal && solvencyRate != null;

  const clientName = (clientInfo?.client_name || clientInfo?.name || '').trim() || '尊贵客户';
  const riskBadge = clientInfo?.risk_label_zh || clientInfo?.risk_level || '稳健均衡型';
  const cmaLabel = settings.cma_mode === 'forward_looking' ? '前瞻估值利率修正 CMA' : '历史收缩均衡 CMA';
  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <div className="wealth-report-overlay" onClick={onClose}>
      <div className="wealth-report-container" onClick={(e) => e.stopPropagation()}>
        {/* Top Floating Controls (hidden in PDF print) */}
        <div className="wealth-report-controls no-print">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                fontSize: '1.05rem',
                color: '#1E4D3B',
                letterSpacing: '0.02em',
              }}
            >
              WONDER ATELIER · 客户执行简报 (2-Page Brief)
            </span>
            {clientInfo?.basket_title && (
              <span className="ips-badge bronze">{clientInfo.basket_title}</span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn-report primary"
              onClick={() => window.print()}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <Printer size={15} aria-hidden="true" />
              导出 PDF / 打印
            </button>

            {onSwitchProfessional && (
              <button
                type="button"
                className="btn-report secondary"
                onClick={onSwitchProfessional}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                <FileText size={15} aria-hidden="true" />
                切换完整建议书 (6章 IPS)
              </button>
            )}

            {onOpenClientInfo && (
              <button
                type="button"
                className="btn-report secondary"
                onClick={onOpenClientInfo}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                <UserCog size={15} aria-hidden="true" />
                客户与诉求设置
              </button>
            )}

            {onGenerateWord && (
              <button
                type="button"
                className="btn-report secondary"
                disabled={reportLoading}
                onClick={() => onGenerateWord()}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  opacity: reportLoading ? 0.65 : 1,
                }}
              >
                <Download size={15} aria-hidden="true" />
                {reportLoading ? '生成 Word 中...' : '下载 Word (.docx)'}
              </button>
            )}

            <button
              type="button"
              className="btn-report close"
              onClick={onClose}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
            >
              <X size={15} aria-hidden="true" />
              返回
            </button>
          </div>
        </div>

        {/* Printable 2-Page Nordic Private Bank Brief */}
        <div id="printable-report" className="wealth-report-content ips-paper">
          {/* Masthead */}
          <header className="ips-masthead">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <div className="ips-brand-overline">WONDER ATELIER · PRIVATE WEALTH EXECUTIVE BRIEF</div>
                <h1 className="ips-title">专户资产配置与财富推演执行摘要</h1>
                <div className="ips-subtitle">
                  客户专案委托书执行简版 · {riskBadge} · {years} 年规划周期 · 计价本币 {currency}
                </div>
              </div>
              <div style={{ textAlign: 'right', fontSize: '0.78rem', color: '#5F6662' }}>
                <div className="ips-mono" style={{ fontWeight: 600, color: '#1E4D3B' }}>
                  BRIEF-IPS-{todayStr.replaceAll('-', '')}
                </div>
                <div>编制日期：{todayStr}</div>
                <div>估值模型：{cmaLabel}</div>
              </div>
            </div>

            <div className="ips-meta-grid">
              <div>
                <div className="ips-meta-label">委托客户 / 年龄</div>
                <div className="ips-meta-value">
                  {clientName}
                  {clientInfo?.age ? ` · ${clientInfo.age} 岁` : ''}
                </div>
              </div>
              <div>
                <div className="ips-meta-label">风险偏好与评分</div>
                <div className="ips-meta-value">
                  {riskBadge}
                  {clientInfo?.risk_score != null ? ` (${clientInfo.risk_score})` : ''}
                </div>
              </div>
              <div>
                <div className="ips-meta-label">首期委托本金 / 目标</div>
                <div className="ips-meta-value ips-mono">
                  {fmtMoney(capital, currency)}
                  {target > 0 ? ` → ${fmtCompact(target, currency)}` : ''}
                </div>
              </div>
              <div>
                <div className="ips-meta-label">现金流安排</div>
                <div className="ips-meta-value">
                  {hasWithdrawal
                    ? `年提领 ${fmtMoney(withdrawal1, currency)}`
                    : contribution > 0
                      ? `年定投 ${fmtMoney(contribution, currency)}`
                      : '纯复利累积阶段'}
                </div>
              </div>
            </div>
          </header>

          {/* 4 Core KPI Cards */}
          <section className="ips-kpi-grid ips-block-keep" aria-label="核心量化摘要指标">
            <div className="ips-kpi-card">
              <div className="ips-kpi-label">
                {useSolvencyPrimary ? '现金流永续保障率 (SOLVENCY)' : '目标达成概率 (GOAL REACH)'}
              </div>
              <div className="ips-kpi-value ips-mono">
                {useSolvencyPrimary
                  ? fmtPct(solvencyRate, 1)
                  : successRate != null
                    ? fmtPct(successRate, 1)
                    : '—'}
              </div>
              <div className="ips-kpi-sub">
                {useSolvencyPrimary
                  ? `期满零枯竭率 · 期末净值达标率 ${successRate != null ? fmtPct(successRate, 1) : '—'}`
                  : '1,000 次蒙特卡洛路径达标概率'}
              </div>
            </div>

            <div className="ips-kpi-card bronze">
              <div className="ips-kpi-label">组合预期年化收益 / 分红</div>
              <div className="ips-kpi-value ips-mono">
                {fmtPct(targetPf.expected_return, 2)}
              </div>
              <div className="ips-kpi-sub">
                年化波动 {fmtPct(targetPf.volatility, 2)} · 内生股息 {fmtPct(targetPf.dividend_yield, 2)}
              </div>
            </div>

            <div className="ips-kpi-card slate">
              <div className="ips-kpi-label">第 {years} 年中性净值 (P50)</div>
              <div className="ips-kpi-value ips-mono">
                {fmtCompact(lastRow.p50Val, currency)}
              </div>
              <div className="ips-kpi-sub">
                {hasInflation && lastRow.realP50Val != null
                  ? `折合今日购买力 ${fmtCompact(lastRow.realP50Val, currency)} (@${inflation}%)`
                  : `夏普比率 ${(targetPf.sharpe_ratio ?? 0).toFixed(2)}`}
              </div>
            </div>

            <div className="ips-kpi-card risk">
              <div className="ips-kpi-label">极端防守底线 (P10 FLOOR)</div>
              <div className="ips-kpi-value ips-mono">
                {fmtCompact(lastRow.p10Val, currency)}
              </div>
              <div className="ips-kpi-sub">
                P50 回撤 {p50DdStr} · P10 回撤 {p10DdStr}
              </div>
            </div>
          </section>

          {/* Section 1: Client Mandate & Extra Notes */}
          <section className="ips-chapter ips-block-keep">
            <div className="ips-chapter-header">
              <div className="ips-chapter-title-wrap">
                <span className="ips-chapter-num">01</span>
                <span className="ips-chapter-title">委托诉求与核心配置思路</span>
              </div>
              <span className="ips-chapter-en">CLIENT MANDATE & THESIS</span>
            </div>

            <p className="ips-prose" style={{ marginBottom: '10px' }}>
              {clientInfo?.tactical_summary_zh ||
                `基于客户 ${riskBadge} 的风险承载特征，本方案采用跨资产核心-卫星架构，首期投入 ${fmtMoney(capital, currency)}，兼顾 ${years} 年期中枢复合增长、波动率预算控制及${hasWithdrawal ? '稳定现金流提领连续性' : '长期通胀购买力保值'}。`}
            </p>

            {(clientInfo?.extra_notes || clientInfo?.target_envelope || clientInfo?.ai_analysis_text) && (
              <div className="ips-callout forest">
                {clientInfo?.target_envelope && (
                  <div style={{ marginBottom: '4px', fontSize: '0.82rem' }}>
                    <strong>组合目标框架：</strong>
                    {clientInfo.target_envelope}
                  </div>
                )}
                {clientInfo?.extra_notes && (
                  <div style={{ marginBottom: clientInfo?.ai_analysis_text ? '6px' : 0, fontSize: '0.84rem' }}>
                    <strong>客户个性化补充约束：</strong>
                    {clientInfo.extra_notes}
                  </div>
                )}
                {clientInfo?.ai_analysis_text && (
                  <div style={{ fontSize: '0.82rem', color: '#424A46', lineHeight: 1.65 }}>
                    <strong>AI 投研摘要：</strong>
                    {clientInfo.ai_analysis_text.length > 360
                      ? `${clientInfo.ai_analysis_text.slice(0, 360)}...`
                      : clientInfo.ai_analysis_text}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Section 2: Initial Portfolio Allocation & Funding Schedule */}
          <section className="ips-chapter">
            <div className="ips-chapter-header">
              <div className="ips-chapter-title-wrap">
                <span className="ips-chapter-num">02</span>
                <span className="ips-chapter-title">首期建仓配置与金额一览表</span>
              </div>
              <span className="ips-chapter-en">CAPITAL ALLOCATION & EXECUTION</span>
            </div>

            <table className="ips-table">
              <thead>
                <tr>
                  <th style={{ width: '110px' }}>资产代码</th>
                  <th style={{ width: '24%' }}>标的 / 策略名称</th>
                  <th style={{ width: '76px', textAlign: 'right' }}>配置权重</th>
                  <th style={{ width: '118px', textAlign: 'right' }}>首期建仓金额 ({currency})</th>
                  <th style={{ width: '72px', textAlign: 'right' }}>参考股息</th>
                  <th>战略定位与风控角色</th>
                </tr>
              </thead>
              <tbody>
                {allocationsEntries.map((row) => {
                  const displayName = row.stats?.name && row.stats.name !== row.isin ? row.stats.name : row.isin;
                  const rawDy = row.stats?.dividend_yield;
                  const dyStr = rawDy != null
                    ? `${(Number(rawDy) > 1 ? Number(rawDy) : Number(rawDy) * 100).toFixed(2)}%`
                    : '—';
                  return (
                    <tr key={row.isin}>
                      <td>
                        <span className="ips-badge">{row.isin}</span>
                      </td>
                      <td style={{ fontWeight: 600, color: '#18201C' }}>{displayName}</td>
                      <td className="ips-mono" style={{ textAlign: 'right', fontWeight: 700, color: '#1E4D3B' }}>
                        {row.weightPct.toFixed(1)}%
                      </td>
                      <td className="ips-mono" style={{ textAlign: 'right', fontWeight: 600 }}>
                        {fmtMoney(row.amount, currency)}
                      </td>
                      <td className="ips-mono" style={{ textAlign: 'right', color: '#5F6662' }}>
                        {dyStr}
                      </td>
                      <td style={{ fontSize: '0.79rem', color: '#424A46', lineHeight: 1.5 }}>
                        {resolveRationale(row.isin, row.weightPct, row.stats, clientInfo)}
                      </td>
                    </tr>
                  );
                })}
                <tr style={{ background: '#F3EFE6', fontWeight: 700 }}>
                  <td colSpan={2} style={{ color: '#1E4D3B' }}>组合合计 ({allocationsEntries.length} 项资产)</td>
                  <td className="ips-mono" style={{ textAlign: 'right', color: '#1E4D3B' }}>
                    {allocationsEntries.reduce((s, r) => s + r.weightPct, 0).toFixed(1)}%
                  </td>
                  <td className="ips-mono" style={{ textAlign: 'right', color: '#1E4D3B' }}>
                    {fmtMoney(capital, currency)}
                  </td>
                  <td className="ips-mono" style={{ textAlign: 'right', color: '#9A6F38' }}>
                    {fmtPct(targetPf.dividend_yield, 2)}
                  </td>
                  <td style={{ fontSize: '0.78rem', color: '#5F6662' }}>
                    {labData.portfolio_diagnostics?.weighted_fee_pct != null
                      ? `加权年费率 ${Number(labData.portfolio_diagnostics.weighted_fee_pct).toFixed(2)}% · 历史最大回撤 ${fmtPct(labData.portfolio_diagnostics.max_drawdown, 2)}`
                      : '跨资产再平衡后组合基准口径'}
                  </td>
                </tr>
              </tbody>
            </table>
          </section>

          {/* Section 3: Wealth Corridor Chart & Life Milestones */}
          <section className="ips-chapter ips-block-keep" style={{ pageBreakBefore: 'auto' }}>
            <div className="ips-chapter-header">
              <div className="ips-chapter-title-wrap">
                <span className="ips-chapter-num">03</span>
                <span className="ips-chapter-title">全周期财富走廊推演与关键里程碑</span>
              </div>
              <span className="ips-chapter-en">MONTE CARLO WEALTH CORRIDOR</span>
            </div>

            <div className="ips-chart-box" style={{ marginBottom: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', fontSize: '0.78rem', color: '#5F6662' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600, color: '#1E4D3B' }}>
                  <TrendingUp size={14} aria-hidden="true" />
                  10th / 50th / 90th 分位净值推演曲线{insuranceIsActive ? ' (含保单合并基础价值)' : ''}
                </span>
                <span className="ips-mono">
                  本金 {fmtCompact(capital, currency)} → 中性期末 {fmtCompact(lastRow.p50Val, currency)}
                </span>
              </div>
              <div style={{ width: '100%', height: 245 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartSeries} margin={{ top: 8, right: 16, left: 6, bottom: 0 }}>
                    <defs>
                      <linearGradient id="ipsBriefForestFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#1E4D3B" stopOpacity={0.22} />
                        <stop offset="95%" stopColor="#1E4D3B" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5DFD3" />
                    <XAxis
                      dataKey="year"
                      tick={{ fill: '#5F6662', fontSize: 11, fontFamily: 'var(--font-mono)' }}
                      stroke="#D7D0C3"
                      tickFormatter={(v) => `Y${v}`}
                    />
                    <YAxis
                      tick={{ fill: '#5F6662', fontSize: 11, fontFamily: 'var(--font-mono)' }}
                      stroke="#D7D0C3"
                      tickFormatter={(v) => fmtCompact(v, currency)}
                      width={68}
                    />
                    <Tooltip content={<BriefTooltip currency={currency} />} />
                    {target > 0 && (
                      <ReferenceLine
                        y={target}
                        stroke="#9A6F38"
                        strokeDasharray="4 4"
                        label={{
                          value: `目标 ${fmtCompact(target, currency)}`,
                          position: 'insideTopLeft',
                          fill: '#9A6F38',
                          fontSize: 11,
                        }}
                      />
                    )}
                    <Area
                      type="monotone"
                      dataKey="corridor"
                      stroke="none"
                      fill="#1E4D3B"
                      fillOpacity={0.09}
                      isAnimationActive={false}
                      name="P10–P90 概率置信带"
                    />
                    <Area
                      type="monotone"
                      dataKey="p90Val"
                      stroke="#9A6F38"
                      strokeWidth={1.6}
                      strokeDasharray="4 4"
                      fill="none"
                      isAnimationActive={false}
                      name="乐观情景 (P90)"
                    />
                    <Area
                      type="monotone"
                      dataKey="p50Val"
                      stroke="#1E4D3B"
                      strokeWidth={2.4}
                      fill="url(#ipsBriefForestFill)"
                      isAnimationActive={false}
                      name="中性预期 (P50)"
                    />
                    <Area
                      type="monotone"
                      dataKey="p10Val"
                      stroke="#8C3B32"
                      strokeWidth={1.6}
                      strokeDasharray="4 4"
                      fill="none"
                      isAnimationActive={false}
                      name="防御底线 (P10)"
                    />
                    {hasInflation && (
                      <Area
                        type="monotone"
                        dataKey="realP50Val"
                        stroke="#64748b"
                        strokeWidth={1.3}
                        strokeDasharray="2 3"
                        fill="none"
                        isAnimationActive={false}
                        name="通胀折现购买力"
                      />
                    )}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Milestones strip */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${Math.max(milestoneRows.length, 1)}, minmax(0, 1fr))`,
                gap: '12px',
              }}
            >
              {milestoneRows.map((m) => (
                <div
                  key={m.year}
                  style={{
                    background: '#F4F1EA',
                    border: '1px solid #DFD9CC',
                    borderTop: '2px solid #9A6F38',
                    borderRadius: '4px',
                    padding: '10px 12px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <span style={{ fontSize: '0.76rem', fontWeight: 700, color: '#9A6F38' }}>
                      第 {m.year} 年里程碑
                    </span>
                    {m.divGenerated > 0 && (
                      <span className="ips-mono" style={{ fontSize: '0.7rem', color: '#1E4D3B' }}>
                        年分红 +{fmtCompact(m.divGenerated, currency)}
                      </span>
                    )}
                  </div>
                  <div className="ips-mono" style={{ fontSize: '1.1rem', fontWeight: 700, color: '#18201C' }}>
                    {fmtMoney(m.p50Val, currency)}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#5F6662', marginTop: '3px' }}>
                    P10 防守底线 {fmtCompact(m.p10Val, currency)}
                    {m.realP50Val != null ? ` · 实质购买力 ${fmtCompact(m.realP50Val, currency)}` : ''}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Section 4: Cashflow, Insurance & Stress-Test Summary */}
          <section className="ips-chapter ips-block-keep">
            <div className="ips-chapter-header">
              <div className="ips-chapter-title-wrap">
                <span className="ips-chapter-num">04</span>
                <span className="ips-chapter-title">现金流永续安排、风险预算与历史危机回放</span>
              </div>
              <span className="ips-chapter-en">CASHFLOW & STRESS RESILIENCE</span>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: '12px',
                marginBottom: availableStressScenarios.length > 0 ? '14px' : 0,
              }}
            >
              <div style={{ background: '#F4F1EA', border: '1px solid #DFD9CC', borderRadius: '4px', padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', fontWeight: 700, color: '#1E4D3B', marginBottom: '6px' }}>
                  <Layers size={14} aria-hidden="true" />
                  收支现金流与分红缓冲
                </div>
                <div style={{ fontSize: '0.8rem', color: '#333B37', lineHeight: 1.65 }}>
                  <div>
                    <strong>首年预计内生分红：</strong>
                    <span className="ips-mono">{fmtMoney(firstYearRow.divGenerated, currency)}</span>
                    {' · '}
                    <strong>期末年分红：</strong>
                    <span className="ips-mono">{fmtMoney(lastRow.divGenerated, currency)}</span>
                  </div>
                  <div>
                    <strong>定投 / 提取结构：</strong>
                    {contribution > 0
                      ? `第 ${settings.contribution_start || 1}–${settings.contribution_years || 10} 年年定投 ${fmtMoney(contribution, currency)}`
                      : '无追加定投'}
                    {' · '}
                    {hasWithdrawal
                      ? `第 ${settings.withdrawal_start || 1}–${settings.withdrawal_end || years} 年年提取 ${fmtMoney(withdrawal1, currency)}${settings.withdrawal_inflation ? ' (随通胀上调)' : ''}`
                      : '暂未设定固定提款'}
                  </div>
                </div>
              </div>

              <div style={{ background: '#F4F1EA', border: '1px solid #DFD9CC', borderRadius: '4px', padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', fontWeight: 700, color: '#9A6F38', marginBottom: '6px' }}>
                  <ShieldCheck size={14} aria-hidden="true" />
                  波动边界与保底护城河
                </div>
                <div style={{ fontSize: '0.8rem', color: '#333B37', lineHeight: 1.65 }}>
                  <div>
                    <strong>路径最大回撤：</strong>
                    中性 P50 <span className="ips-mono">{p50DdStr}</span> · 极端 P10 <span className="ips-mono" style={{ color: '#8C3B32' }}>{p10DdStr}</span>
                  </div>
                  {mc.insurance_stats ? (
                    <div>
                      <strong>保单护城河叠加：</strong>
                      分摊总提款需求{' '}
                      <span className="ips-mono">{Number(mc.insurance_stats.withdrawal_coverage_pct || 0).toFixed(1)}%</span>
                      ，期满保单 CV 中值 <span className="ips-mono">{fmtCompact(mc.insurance_stats.avg_cv_at_year_end?.mid, currency)}</span>
                    </div>
                  ) : (
                    <div>
                      <strong>风控纪律：</strong>
                      建议每年检视股债再平衡阈值 (±5%)，避免单一资产波动偏离风险预算
                    </div>
                  )}
                </div>
              </div>
            </div>

            {availableStressScenarios.length > 0 && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', fontWeight: 700, color: '#5F6662', marginBottom: '8px' }}>
                  <AlertTriangle size={13} style={{ color: '#9A6F38' }} aria-hidden="true" />
                  历史极端市场危机压力回放 (Actual Weight Replay)
                </div>
                <table className="ips-table">
                  <thead>
                    <tr>
                      <th>历史危机情景</th>
                      <th>回放区间</th>
                      <th style={{ textAlign: 'right' }}>底层数据覆盖率</th>
                      <th style={{ textAlign: 'right' }}>区间累计收益</th>
                      <th style={{ textAlign: 'right' }}>最大深水回撤</th>
                    </tr>
                  </thead>
                  <tbody>
                    {availableStressScenarios.map((s) => (
                      <tr key={s.id}>
                        <td style={{ fontWeight: 600 }}>{s.label || s.label_en}</td>
                        <td className="ips-mono" style={{ fontSize: '0.76rem', color: '#5F6662' }}>
                          {s.start} → {s.end}
                        </td>
                        <td className="ips-mono" style={{ textAlign: 'right' }}>{s.coverage_weight}%</td>
                        <td
                          className="ips-mono"
                          style={{
                            textAlign: 'right',
                            fontWeight: 700,
                            color: (s.total_return_pct || 0) >= 0 ? '#1E4D3B' : '#8C3B32',
                          }}
                        >
                          {(s.total_return_pct || 0) >= 0 ? '+' : ''}
                          {s.total_return_pct}%
                        </td>
                        <td className="ips-mono" style={{ textAlign: 'right', fontWeight: 700, color: '#8C3B32' }}>
                          {s.max_drawdown_pct}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <XRayReportSection
            xrayData={xrayData}
            localXRay={computePortfolioXRay({
              holdings: Object.entries(targetPf.allocations || {})
                .filter(([, w]) => Number(w) > 0)
                .map(([isin, weight]) => ({ isin, weight: Number(weight) })),
              quantFunds,
              totalNav: capital,
            })}
            currencySymbol={currencySymbol(currency)}
            sectionTitle="底层穿透 X-Ray（工具结构 · 双风格箱 · 合并重仓 · SOP 体检）"
          />

          {/* Compliance Signoff Footer */}
          <footer
            style={{
              marginTop: '22px',
              paddingTop: '14px',
              borderTop: '1px solid #C8C1B4',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-end',
              gap: '20px',
              flexWrap: 'wrap',
              fontSize: '0.74rem',
              color: '#5F6662',
              lineHeight: 1.55,
            }}
          >
            <div style={{ flex: '1 1 380px' }}>
              <div style={{ fontWeight: 700, color: '#18201C', marginBottom: '3px' }}>
                重要合规披露与投资风险提示 (IMPORTANT DISCLOSURE)
              </div>
              本执行简报由 Wonder Atelier 量化投资引擎基于客户风险问卷、{cmaLabel}及蒙特卡洛 1,000 次随机路径生成，仅供专属财富配置方案沟通之用。历史绩效与压力测试回放不代表未来表现，实际建仓需结合流动性窗口与个人税务框架确认。
            </div>
            <div style={{ textAlign: 'right', minWidth: '180px' }}>
              <div style={{ borderBottom: '1px solid #8D867A', paddingBottom: '4px', marginBottom: '4px', color: '#18201C', fontWeight: 600 }}>
                Wonder Atelier Advisory Desk
              </div>
              <div>Client Signature / Date: ____________</div>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
