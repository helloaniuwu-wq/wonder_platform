import React, { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import {
  Layers,
  ShieldCheck,
  AlertTriangle,
  Sparkles,
  Printer,
  RefreshCw,
  PieChart as PieIcon,
  Network,
  Activity,
  Coins,
  BookmarkPlus,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react';
import { authHeaders, canViewInternalWarnings } from '../utils/auth';
import { computePortfolioXRay } from '../utils/portfolioXRay';
import XRayPrintReport from './XRayPrintReport';

const BAR_COLORS = [
  '#0A192F',
  '#1B4D3E',
  '#C5A059',
  '#3B82F6',
  '#64748B',
  '#8B5CF6',
  '#0D9488',
  '#D97706',
  '#6366F1',
  '#EC4899',
  '#94A3B8',
];

const EQUITY_GRID = [
  ['large_value', '大盘价值'],
  ['large_blend', '大盘均衡'],
  ['large_growth', '大盘成长'],
  ['mid_value', '中盘价值'],
  ['mid_blend', '中盘均衡'],
  ['mid_growth', '中盘成长'],
  ['small_value', '小盘价值'],
  ['small_blend', '小盘均衡'],
  ['small_growth', '小盘成长'],
];

const BOND_GRID = [
  ['high_limited', '高信·短久'],
  ['high_moderate', '高信·中久'],
  ['high_extensive', '高信·长久'],
  ['medium_limited', '中信·短久'],
  ['medium_moderate', '中信·中久'],
  ['medium_extensive', '中信·长久'],
  ['low_limited', '低信·短久'],
  ['low_moderate', '低信·中久'],
  ['low_extensive', '低信·长久'],
];

const SUB_TABS = [
  { id: 'overview', label: '总览与风格箱', icon: PieIcon },
  { id: 'underlying', label: '底层重仓与重叠', icon: Layers },
  { id: 'sectors', label: '行业与地理区域', icon: Network },
  { id: 'risk', label: '相关性与风险贡献', icon: Activity },
  { id: 'valuation', label: '估值、现金流与SOP', icon: Coins },
];

/**
 * 晨星组合透视面板 v2（Morningstar × Wonder SOP Portfolio X-Ray）：
 * 统一支持 基金 + 直投个股 + 直投债券 + 现金 的 7 维度深度穿透，带 A4 PDF 导出与一键批量加入观察队列。
 */
export default function PortfolioXRayPanel({
  currentUser = null,
  holdings = [],
  quantFunds = [],
  totalNav = 0,
  currency = 'USD',
  currencySymbol = '$',
  taxRate = 0,
  ilpAnnualDragPct = 0,
  portfolioName = '当前组合',
  title = '晨星组合透视 · Portfolio X-Ray v2',
  onXRayDataChange = null,
  onOpenFundDetail = null,
}) {
  const showWarnings = canViewInternalWarnings(currentUser);
  const [subTab, setSubTab] = useState('overview');
  const [serverXRay, setServerXRay] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [printOpen, setPrintOpen] = useState(false);
  const [enqueueState, setEnqueueState] = useState({ busy: false, msg: '', done: false });

  const localXRay = useMemo(
    () => computePortfolioXRay({ holdings, quantFunds, totalNav, taxRate, ilpAnnualDragPct }),
    [holdings, quantFunds, totalNav, taxRate, ilpAnnualDragPct]
  );

  const holdingsSignature = useMemo(
    () =>
      JSON.stringify(
        (holdings || [])
          .filter((h) => h && Number(h.weight) > 0)
          .map((h) => ({
            isin: h.isin,
            name: h.name,
            weight: Number(Number(h.weight).toFixed(5)),
            asset_type: h.asset_type,
            sector: h.sector,
            country: h.country,
            currency: h.currency,
            duration: h.duration,
            ytm: h.ytm,
            credit_rating: h.credit_rating,
            dividend_yield: h.dividend_yield,
            fee_pct: h.fee_pct,
          }))
      ),
    [holdings]
  );

  useEffect(() => {
    const parsedHoldings = JSON.parse(holdingsSignature);
    if (!parsedHoldings.length) {
      if (onXRayDataChange) onXRayDataChange(null);
      return undefined;
    }

    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/quant/xray', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          signal: ctrl.signal,
          body: JSON.stringify({
            holdings: parsedHoldings,
            currency,
            total_nav: totalNav,
            tax_rate: taxRate,
            ilp_annual_drag_pct: ilpAnnualDragPct,
            include_stress: true,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setServerXRay(data);
        if (onXRayDataChange) onXRayDataChange(data);
      } catch (err) {
        if (err?.name !== 'AbortError') {
          setServerXRay(null);
          if (onXRayDataChange) onXRayDataChange(localXRay);
        }
      } finally {
        setLoading(false);
      }
    }, 220);

    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdingsSignature, currency, totalNav, taxRate, ilpAnnualDragPct, refreshNonce]);

  if (!localXRay.holdings.length) return null;

  const sSum = serverXRay?.summary || {};
  const assetClasses = serverXRay?.asset_classes || localXRay.assetClasses;
  const currencies = serverXRay?.currencies || localXRay.currencies;
  const rawDiagnostics = serverXRay?.diagnostics || localXRay.diagnostics;
  const diagnostics = showWarnings
    ? rawDiagnostics
    : (() => {
        const filtered = (rawDiagnostics || []).filter((d) => d.level !== 'warn');
        if (filtered.length > 0) return filtered;
        return localXRay.holdings.length > 0
          ? [{ level: 'good', text: '已完成组合多维穿透分析，大类资产、风格箱与现金流结构均已清晰呈现，建议结合持有周期定期检视。' }]
          : [];
      })();
  const instMix = sSum.instrument_mix || localXRay.instrumentMix || {};

  const avgStars = sSum.weighted_stars ?? localXRay.avgStars;
  const avgSharpe = sSum.weighted_sharpe_3y ?? localXRay.avgSharpe;
  const avgFeePct = sSum.weighted_fee_pct ?? localXRay.avgFeePct;
  const estAnnualFee = sSum.est_annual_fee ?? localXRay.estAnnualFeeAmount;
  const feeDrag10yPct = sSum.fee_drag_10y_pct ?? localXRay.feeDrag10yPct;
  const effectiveN = sSum.effective_n ?? localXRay.effectiveN;
  const maxSingle = sSum.max_single_holding || localXRay.maxSingleHolding;

  const risk = serverXRay?.risk_analytics || {};
  const fiStyle = serverXRay?.style_boxes?.fixed_income || localXRay?.style_boxes?.fixed_income || {};
  const eqStyle = serverXRay?.style_boxes?.equity || localXRay?.style_boxes?.equity || {};
  const valSop = serverXRay?.valuation_cashflow_sop || {};
  const underlying = serverXRay?.underlying_holdings || { coverage_pct: 0, items: [] };
  const overlap = serverXRay?.overlap || { pairs: [], high_overlap_count: 0 };
  const sectors = serverXRay?.sectors || { coverage_pct: 0, items: [] };
  const regions = serverXRay?.regions || { coverage_pct: 0, items: [] };
  const stressRows = (serverXRay?.stress_test || []).filter((s) => s.available);

  const weightedDuration = fiStyle.weighted_duration ?? localXRay.weightedDuration;
  const aftertaxYield = valSop.aftertax_yield_pct ?? localXRay.aftertaxYieldPct;
  const sopCoveredWeight = valSop.sop_covered_weight_pct ?? localXRay.sopCoveredWeightPct;
  const uncoveredFunds = valSop.uncovered_funds || [];

  const feeColor =
    avgFeePct == null
      ? 'var(--text-primary)'
      : avgFeePct <= 0.6
      ? 'var(--success, #10b981)'
      : avgFeePct > 1.35
      ? 'var(--danger, #f43f5e)'
      : 'var(--warning, #d97706)';

  const handleBatchEnqueue = async () => {
    if (!uncoveredFunds.length || enqueueState.busy) return;
    setEnqueueState({ busy: true, msg: '', done: false });
    try {
      const res = await fetch('/api/quant/research-request/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          slugs: uncoveredFunds.map((u) => u.slug),
          note: `从组合「${portfolioName}」X-Ray 透视一键提交 SOP 深度研究需求`,
        }),
      });
      if (res.status === 401 || res.status === 403) {
        setEnqueueState({ busy: false, msg: '请先登录后再将未研究基金加入观察队列', done: false });
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const out = await res.json();
      setEnqueueState({
        busy: false,
        msg: `已入队 ${out.enqueued_count} 只基金（跳过 ${out.skipped_count} 只）`,
        done: true,
      });
      setRefreshNonce((n) => n + 1);
    } catch (e) {
      setEnqueueState({ busy: false, msg: `入队失败：${e.message}`, done: false });
    }
  };

  return (
    <section
      className="glass-card"
      style={{
        marginTop: '20px',
        borderTop: '3px solid var(--accent-secondary)',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
      }}
    >
      {/* Header + Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <Layers size={18} style={{ color: 'var(--accent-secondary)' }} />
          <h3 style={{ margin: 0, fontSize: '1.08rem' }}>{title}</h3>
          <span
            style={{
              fontSize: '0.7rem',
              padding: '2px 8px',
              borderRadius: '99px',
              background: 'var(--surface-subtle)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-secondary)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {loading ? '正在实时穿透计算...' : serverXRay ? `已穿透 · 底层覆盖 ${underlying.coverage_pct}%` : '本地基础模式'}
          </span>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="action-btn-secondary"
            style={{ fontSize: '0.75rem', padding: '5px 10px', display: 'flex', alignItems: 'center', gap: '5px' }}
            onClick={() => setRefreshNonce((n) => n + 1)}
            disabled={loading}
          >
            <RefreshCw size={13} /> 刷新穿透
          </button>
          <button
            type="button"
            className="create-btn"
            style={{ fontSize: '0.75rem', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '5px' }}
            onClick={() => setPrintOpen(true)}
          >
            <Printer size={13} /> 导出 X-Ray PDF 报告
          </button>
        </div>
      </div>

      {/* 6 核心穿透 KPI 卡片 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px' }}>
        <div style={{ background: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '11px 13px' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '3px' }}>协方差真实波动率</div>
          <div style={{ fontSize: '1.14rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
            {risk.true_portfolio_vol_pct != null ? `${risk.true_portfolio_vol_pct}%` : localXRay.avgVol != null ? `${localXRay.avgVol.toFixed(1)}%` : '—'}
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--success, #10b981)', marginTop: '2px' }}>
            {risk.diversification_benefit_pct != null ? `分散降波红利 ${risk.diversification_benefit_pct}%` : '线性加权口径'}
          </div>
        </div>

        <div style={{ background: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '11px 13px' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '3px' }}>穿透管理费率 (MPS)</div>
          <div style={{ fontSize: '1.14rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: feeColor }}>
            {avgFeePct != null ? `${Number(avgFeePct).toFixed(2)}%` : '—'}
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
            {estAnnualFee != null
              ? `年费约 ${currencySymbol}${Math.round(estAnnualFee).toLocaleString()}`
              : feeDrag10yPct != null
              ? `10Y复利侵蚀 ${feeDrag10yPct}%`
              : `覆盖 ${sSum.fee_coverage_pct ?? localXRay.feeCoveragePct}%`}
          </div>
        </div>

        <div style={{ background: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '11px 13px' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '3px' }}>晨星星级 / SOP 质量</div>
          <div style={{ fontSize: '1.14rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--warning, #f59e0b)' }}>
            {avgStars != null ? `${Number(avgStars).toFixed(1)} ★` : '—'}
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
            {sSum.weighted_sop_pillar_score != null
              ? `SOP五支柱 ${sSum.weighted_sop_pillar_score >= 0 ? '+' : ''}${sSum.weighted_sop_pillar_score}`
              : avgSharpe != null
              ? `加权夏普 ${Number(avgSharpe).toFixed(2)}`
              : `SOP 覆盖 ${sopCoveredWeight}%`}
          </div>
        </div>

        <div style={{ background: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '11px 13px' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '3px' }}>固收久期 / ±100bps冲击</div>
          <div style={{ fontSize: '1.14rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
            {weightedDuration != null ? `${Number(weightedDuration).toFixed(2)} 年` : '—'}
          </div>
          <div style={{ fontSize: '0.68rem', color: showWarnings && weightedDuration != null && weightedDuration >= 5 ? 'var(--danger, #f43f5e)' : 'var(--text-secondary)', marginTop: '2px' }}>
            {weightedDuration != null ? `加息100bp冲击 -${Number(weightedDuration).toFixed(1)}%` : '纯权益或未标注久期'}
          </div>
        </div>

        <div style={{ background: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '11px 13px' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '3px' }}>组合税后年化现金流</div>
          <div style={{ fontSize: '1.14rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--success, #10b981)' }}>
            {aftertaxYield != null ? `${Number(aftertaxYield).toFixed(2)}%` : '—'}
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
            {valSop.est_annual_income != null
              ? `年收息约 ${currencySymbol}${Math.round(valSop.est_annual_income).toLocaleString()}`
              : valSop.spread_vs_rf_bps != null
              ? `相对无风险 ${valSop.spread_vs_rf_bps >= 0 ? '+' : ''}${valSop.spread_vs_rf_bps} bps`
              : `预扣税率 ${(taxRate * 100).toFixed(0)}%`}
          </div>
        </div>

        <div style={{ background: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '11px 13px' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '3px' }}>有效持仓与工具结构</div>
          <div style={{ fontSize: '1.14rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--accent-color)' }}>
            {effectiveN > 0 ? `${Number(effectiveN).toFixed(1)} 只` : '—'}
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
            最大单一 {Number(maxSingle.weightPct || 0).toFixed(1)}% · 直投 {(Number(instMix.direct_stocks_pct || 0) + Number(instMix.direct_bonds_pct || 0)).toFixed(0)}%
          </div>
        </div>
      </div>

      {/* 子页签切换栏 */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '8px' }}>
        {SUB_TABS.map((tb) => {
          const Icon = tb.icon;
          const active = subTab === tb.id;
          return (
            <button
              key={tb.id}
              type="button"
              onClick={() => setSubTab(tb.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '0.78rem',
                fontWeight: active ? 700 : 500,
                cursor: 'pointer',
                border: active ? '1px solid var(--accent-secondary)' : '1px solid var(--border-subtle)',
                background: active ? 'rgba(197, 160, 89, 0.14)' : 'var(--surface-subtle)',
                color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}
            >
              <Icon size={13} />
              <span>{tb.label}</span>
              {showWarnings && tb.id === 'underlying' && overlap.high_overlap_count > 0 && (
                <span style={{ fontSize: '0.66rem', background: '#B91C1C', color: '#fff', padding: '0 5px', borderRadius: '99px' }}>
                  重叠{overlap.high_overlap_count}
                </span>
              )}
              {tb.id === 'valuation' && uncoveredFunds.length > 0 && (
                <span style={{ fontSize: '0.66rem', background: '#D97706', color: '#fff', padding: '0 5px', borderRadius: '99px' }}>
                  待研{uncoveredFunds.length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* TAB 1: 总览与风格箱 */}
      {subTab === 'overview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '14px' }}>
            {/* 资产大类与工具结构 */}
            <div style={{ background: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '13px' }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 700, marginBottom: '8px', color: 'var(--text-primary)' }}>
                资产大类与工具形态穿透（基金/直投股/直投债）
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px', fontSize: '0.72rem' }}>
                <span className="isin-badge">基金 {instMix.funds_pct ?? 0}%</span>
                <span className="isin-badge">直投个股 {instMix.direct_stocks_pct ?? 0}%</span>
                <span className="isin-badge">直投债券 {instMix.direct_bonds_pct ?? 0}%</span>
                <span className="isin-badge">现金 {instMix.cash_pct ?? 0}%</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {assetClasses.map((item, idx) => (
                  <div key={item.label}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.77rem', marginBottom: '3px' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>{item.label}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{item.pct}%</span>
                    </div>
                    <div style={{ height: '7px', borderRadius: '4px', background: 'var(--border-subtle)', overflow: 'hidden' }}>
                      <div style={{ width: `${Math.min(100, item.pct)}%`, height: '100%', background: BAR_COLORS[idx % BAR_COLORS.length] }} />
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '10px', paddingTop: '8px', borderTop: '1px dashed var(--border-subtle)' }}>
                {currencies.map((c) => (
                  <span key={c.label} style={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono)', padding: '2px 7px', border: '1px solid var(--border-subtle)', borderRadius: '4px' }}>
                    {c.label}: <strong>{c.pct}%</strong>
                  </span>
                ))}
              </div>
            </div>

            {/* 股债双九宫格风格箱 */}
            <div style={{ background: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '13px' }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 700, marginBottom: '8px', color: 'var(--text-primary)' }}>
                晨星股债双九宫格风格箱（Morningstar Style Box）
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <div
                    style={{ fontSize: '0.71rem', color: 'var(--text-muted)', marginBottom: '5px' }}
                    title={eqStyle.inferred_pct > 0 ? `实测风格 ${eqStyle.verified_pct || 0}% + 类别映射 ${eqStyle.inferred_pct}%` : undefined}
                  >
                    权益九宫格（{(eqStyle.coverage_pct ?? 0) === 0 && (eqStyle.sleeve_weight_pct ?? 0) === 0 ? '无权益持仓' : `已穿透 ${eqStyle.coverage_pct ?? 0}%`}）
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '3px' }}>
                    {EQUITY_GRID.map(([k, lbl]) => {
                      const val = Number(eqStyle.grid?.[k] || 0);
                      return (
                        <div
                          key={k}
                          style={{
                            padding: '6px 3px',
                            borderRadius: '4px',
                            border: '1px solid var(--border-subtle)',
                            textAlign: 'center',
                            fontSize: '0.67rem',
                            background: val > 0 ? `rgba(10, 25, 47, ${Math.min(0.85, 0.16 + val / 80)})` : 'transparent',
                            color: val >= 40 ? '#FFFFFF' : 'var(--text-primary)',
                          }}
                        >
                          <div>{lbl}</div>
                          <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{val > 0 ? `${val}%` : '—'}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <div
                    style={{ fontSize: '0.71rem', color: 'var(--text-muted)', marginBottom: '5px' }}
                    title={fiStyle.inferred_pct > 0 ? `实测久期/评级 ${fiStyle.verified_pct || 0}% + 类别映射 ${fiStyle.inferred_pct}%` : undefined}
                  >
                    固收九宫格（{(fiStyle.coverage_pct ?? 0) === 0 && (fiStyle.sleeve_weight_pct ?? 0) === 0 ? '无固收持仓' : `已穿透 ${fiStyle.coverage_pct ?? 0}%`}）
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '3px' }}>
                    {BOND_GRID.map(([k, lbl]) => {
                      const val = Number(fiStyle.grid?.[k] || 0);
                      return (
                        <div
                          key={k}
                          style={{
                            padding: '6px 3px',
                            borderRadius: '4px',
                            border: '1px solid var(--border-subtle)',
                            textAlign: 'center',
                            fontSize: '0.67rem',
                            background: val > 0 ? `rgba(27, 77, 62, ${Math.min(0.85, 0.16 + val / 80)})` : 'transparent',
                            color: val >= 40 ? '#FFFFFF' : 'var(--text-primary)',
                          }}
                        >
                          <div>{lbl}</div>
                          <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{val > 0 ? `${val}%` : '—'}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
              {Array.isArray(fiStyle.credit_ratings) && fiStyle.credit_ratings.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginTop: '8px', fontSize: '0.7rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>信用评级：</span>
                  {fiStyle.credit_ratings.map((r) => (
                    <span key={r.label} className="isin-badge">{r.label}: {r.pct}%</span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 诊断告警 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {diagnostics.map((d, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  fontSize: '0.79rem',
                  background: d.level === 'warn' ? 'rgba(245, 158, 11, 0.08)' : 'rgba(16, 185, 129, 0.08)',
                  border: `1px solid ${d.level === 'warn' ? 'rgba(245, 158, 11, 0.25)' : 'rgba(16, 185, 129, 0.25)'}`,
                  color: d.level === 'warn' ? 'var(--warning, #d97706)' : 'var(--success, #10b981)',
                }}
              >
                {d.level === 'warn' ? <AlertTriangle size={14} /> : d.level === 'good' ? <ShieldCheck size={14} /> : <Sparkles size={14} />}
                <span style={{ color: 'var(--text-primary)' }}>{d.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 2: 底层重仓与重叠 */}
      {subTab === 'underlying' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
            底层前十大持仓穿透覆盖组合权重 <strong>{underlying.coverage_pct}%</strong>（自动合并基金穿透持仓与直投个股/债券，揭示隐性单票集中度）。
          </div>
          {underlying.items.length > 0 ? (
            <div style={{ overflowX: 'auto' }}>
              <table className="holdings-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>底层标的 / 发行人</th>
                    <th style={{ textAlign: 'right' }}>合并总敞口</th>
                    <th style={{ textAlign: 'right' }}>直投占比</th>
                    <th style={{ textAlign: 'right' }}>基金穿透</th>
                    <th>持仓贡献拆解</th>
                  </tr>
                </thead>
                <tbody>
                  {underlying.items.map((u) => (
                    <tr key={u.key}>
                      <td>
                        <strong style={{ color: 'var(--text-primary)' }}>{u.name}</strong>
                        {u.symbol && <span className="isin-badge" style={{ marginLeft: '6px' }}>{u.symbol}</span>}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: showWarnings && u.total_weight_pct >= 10 ? '#B91C1C' : 'var(--accent-color)' }}>
                        {u.total_weight_pct.toFixed(2)}%
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                        {u.direct_weight_pct > 0 ? `${u.direct_weight_pct.toFixed(2)}%` : '—'}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                        {u.fund_weight_pct > 0 ? `${u.fund_weight_pct.toFixed(2)}%` : '—'}
                      </td>
                      <td style={{ fontSize: '0.73rem', color: 'var(--text-secondary)' }}>
                        {(u.sources || []).slice(0, 4).map((s) => `${s.is_direct ? '直投' : s.code} ${s.contribution_pct}%`).join(' + ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', padding: '12px' }}>
              当前持仓尚无前十大明细，可在单只基金详情打开「持仓抓取」或运行 SOP 同步补全。
            </div>
          )}

          {overlap.pairs.length > 0 && (
            <div style={{ background: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '12px' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 700, marginBottom: '8px', color: 'var(--text-primary)' }}>
                两两持仓底层标的重合度检视（Overlap Detector）
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '8px' }}>
                {overlap.pairs.map((p, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: `1px solid ${showWarnings && p.overlap_pct >= 25 ? 'rgba(185,28,28,0.4)' : 'var(--border-subtle)'}`,
                      background: showWarnings && p.overlap_pct >= 25 ? 'rgba(185,28,28,0.06)' : 'transparent',
                      fontSize: '0.75rem',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, marginBottom: '3px' }}>
                      <span>{p.left_code} × {p.right_code}</span>
                      <span className="isin-badge" style={{ color: showWarnings && p.overlap_pct >= 25 ? '#B91C1C' : 'var(--text-primary)' }}>
                        重合 {p.overlap_pct}%
                      </span>
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      共同重仓：{(p.shared_holdings || []).join('、')}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: 行业与地理区域 */}
      {subTab === 'sectors' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '14px' }}>
          <div style={{ background: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '13px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 700 }}>GICS 11 大行业板块穿透</span>
              <span className="isin-badge">覆盖 {sectors.coverage_pct}%</span>
            </div>
            {sectors.items.length > 0 ? (
              <div style={{ width: '100%', height: 240 }}>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={sectors.items.slice(0, 10)} layout="vertical" margin={{ top: 4, right: 20, left: 6, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" horizontal={false} />
                    <XAxis type="number" unit="%" tick={{ fontSize: 10.5 }} />
                    <YAxis type="category" dataKey="label" width={92} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v) => [`${v}%`, '占比(已穿透归一化)']} />
                    <Bar dataKey="pct" barSize={14} radius={[0, 4, 4, 0]}>
                      {sectors.items.slice(0, 10).map((_, idx) => (
                        <Cell key={`sec-${idx}`} fill={BAR_COLORS[idx % BAR_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', padding: '20px 0' }}>
                暂无行业穿透数据（待同步基金月报或补充直投板块属性）。
              </div>
            )}
          </div>

          <div style={{ background: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '13px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 700 }}>底层真实地理区域分布</span>
              <span className="isin-badge">覆盖 {regions.coverage_pct}%</span>
            </div>
            {regions.items.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {regions.items.map((r, idx) => (
                  <div key={r.key}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.77rem', marginBottom: '3px' }}>
                      <span>{r.label}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{r.pct}%</span>
                    </div>
                    <div style={{ height: '7px', borderRadius: '4px', background: 'var(--border-subtle)', overflow: 'hidden' }}>
                      <div style={{ width: `${Math.min(100, r.pct)}%`, height: '100%', background: BAR_COLORS[(idx + 2) % BAR_COLORS.length] }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', padding: '20px 0' }}>
                暂无地理区域拆解（请先抓基金画像或填入直投股票国家）。
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: 相关性与风险贡献 */}
      {subTab === 'risk' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '14px' }}>
            {/* 权重 vs 风险贡献 */}
            <div style={{ background: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '13px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 700 }}>权重 vs 真实风险贡献 (% MCTR)</span>
                <span className="isin-badge">序列覆盖 {risk.coverage_pct || 0}% · {risk.obs_days || 0}日</span>
              </div>
              {(risk.risk_contributions || []).length > 0 ? (
                <div style={{ width: '100%', height: 220 }}>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={risk.risk_contributions.slice(0, 8)} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                      <XAxis dataKey="code" tick={{ fontSize: 10.5 }} />
                      <YAxis unit="%" tick={{ fontSize: 10.5 }} width={38} />
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: '11px' }} />
                      <Bar dataKey="weight_pct" name="名义权重(%)" fill="#64748B" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="risk_contrib_pct" name="总波动风险贡献(%)" fill="#0A192F" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', padding: '20px 0' }}>
                  对齐历史净值样本不足 30 日，暂无法生成协方差风险分解。
                </div>
              )}
            </div>

            {/* 相关性矩阵 */}
            <div style={{ background: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '13px', overflowX: 'auto' }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 700, marginBottom: '8px' }}>
                {showWarnings ? '历史日收益相关性矩阵（r ≥ 0.85 高相关告警）' : '历史日收益相关性矩阵'}
              </div>
              {risk.correlation_matrix?.codes?.length > 0 ? (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.71rem', fontFamily: 'var(--font-mono)' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: '4px' }}>标的</th>
                      {risk.correlation_matrix.codes.map((c) => (
                        <th key={c} style={{ textAlign: 'center', padding: '4px' }}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {risk.correlation_matrix.codes.map((rowCode, rIdx) => (
                      <tr key={rowCode}>
                        <td style={{ fontWeight: 700, padding: '4px' }}>{rowCode}</td>
                        {risk.correlation_matrix.matrix[rIdx].map((val, cIdx) => {
                          const hi = showWarnings && rIdx !== cIdx && val >= 0.85;
                          const neg = val < 0;
                          return (
                            <td
                              key={`${rIdx}-${cIdx}`}
                              style={{
                                textAlign: 'center',
                                padding: '5px 4px',
                                border: '1px solid var(--border-subtle)',
                                background:
                                  rIdx === cIdx
                                    ? 'rgba(10,25,47,0.12)'
                                    : hi
                                    ? 'rgba(185,28,28,0.16)'
                                    : neg
                                    ? 'rgba(16,185,129,0.16)'
                                    : 'transparent',
                                color: hi ? '#B91C1C' : 'var(--text-primary)',
                                fontWeight: hi ? 700 : 500,
                              }}
                            >
                              {val.toFixed(2)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', padding: '20px 0' }}>
                  暂无可计算的相关性矩阵样本。
                </div>
              )}
            </div>
          </div>

          {/* 历史危机压力测试表 */}
          {stressRows.length > 0 && (
            <div style={{ background: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '13px', overflowX: 'auto' }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 700, marginBottom: '8px' }}>
                7 大历史极端市场危机穿透回放（Actual Weight Stress Replay）
              </div>
              <table className="holdings-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>危机窗口</th>
                    <th>时间区间</th>
                    <th style={{ textAlign: 'right' }}>序列覆盖权重</th>
                    <th style={{ textAlign: 'right' }}>区间累计回报</th>
                    <th style={{ textAlign: 'right' }}>最大深水回撤</th>
                  </tr>
                </thead>
                <tbody>
                  {stressRows.map((s) => (
                    <tr key={s.id}>
                      <td><strong>{s.label}</strong></td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.74rem' }}>{s.start} → {s.end}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{s.coverage_weight}%</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: s.total_return_pct >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                        {s.total_return_pct >= 0 ? '+' : ''}{s.total_return_pct}%
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--danger)' }}>
                        {s.max_drawdown_pct}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 5: 估值、现金流与 SOP */}
      {subTab === 'valuation' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '14px' }}>
            <div style={{ background: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '13px' }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 700, marginBottom: '8px' }}>
                SOP v2.0 估值水位与晨星奖牌分布
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                已深度研究：<strong>{valSop.sop_covered_count ?? 0} / {valSop.total_fund_count ?? 0} 只</strong>（占基金总权重 <strong>{sopCoveredWeight}%</strong>）
                {valSop.weighted_pe != null && ` · 加权 PE ${valSop.weighted_pe}x`}
                {valSop.weighted_pb != null && ` · 加权 PB ${valSop.weighted_pb}x`}
              </div>
              {(valSop.valuation_zones || []).length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
                  {valSop.valuation_zones.map((z) => (
                    <span key={z.label} className="isin-badge">{z.label}: <strong>{z.pct}%</strong></span>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginBottom: '8px' }}>尚未有持仓基金完成 SOP 估值水位入库。</div>
              )}
              {(valSop.medal_distribution || []).filter((m) => showWarnings || m.label !== 'Negative').length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {(valSop.medal_distribution || [])
                    .filter((m) => showWarnings || m.label !== 'Negative')
                    .map((m) => (
                    <span key={m.label} className="isin-badge" style={{ borderColor: '#C5A059' }}>{m.label}: <strong>{m.pct}%</strong></span>
                  ))}
                </div>
              )}
            </div>

            <div style={{ background: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '13px' }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 700, marginBottom: '8px' }}>
                税前 / 税后分红收益与 Bogle 费用复利侵蚀
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '0.76rem' }}>
                <div>税前派息/YTM：<strong className="ips-mono">{valSop.pretax_yield_pct != null ? `${valSop.pretax_yield_pct}%` : '—'}</strong></div>
                <div>税后净到手率：<strong className="ips-mono" style={{ color: 'var(--success)' }}>{aftertaxYield != null ? `${aftertaxYield}%` : '—'}</strong></div>
                <div>10Y 无风险利差：<strong className="ips-mono">{valSop.spread_vs_rf_bps != null ? `${valSop.spread_vs_rf_bps >= 0 ? '+' : ''}${valSop.spread_vs_rf_bps} bps` : '—'}</strong></div>
                <div>10Y 费用复利侵蚀：<strong className="ips-mono" style={{ color: showWarnings ? 'var(--danger)' : 'var(--text-primary)' }}>{feeDrag10yPct != null ? `${feeDrag10yPct}%` : '—'}</strong></div>
              </div>
              {sSum.fee_drag_20y_amount != null && (
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '8px' }}>
                  按 6.5% 名义毛回报测算：当前综合费率 20 年复利累计摩擦约{' '}
                  <strong style={{ color: showWarnings ? 'var(--danger)' : 'var(--text-primary)' }}>{currencySymbol}{Number(sSum.fee_drag_20y_amount).toLocaleString()}</strong>（侵蚀 {sSum.fee_drag_20y_pct}% 复利增量）。
                </div>
              )}
            </div>
          </div>

          {/* 红旗告警与一键批量加入观察队列 */}
          {showWarnings && (valSop.red_flags || []).length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {valSop.red_flags.map((rf) => (
                <div
                  key={rf.slug}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    background: 'rgba(185, 28, 28, 0.08)',
                    border: '1px solid rgba(185, 28, 28, 0.3)',
                    fontSize: '0.78rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '10px',
                    flexWrap: 'wrap',
                  }}
                >
                  <span>
                    <strong style={{ color: '#B91C1C' }}>🔴 {rf.code} ({rf.weight_pct}%) 红旗：</strong>
                    {rf.red_flag}
                  </span>
                  {onOpenFundDetail && (
                    <button type="button" className="action-btn-secondary" style={{ fontSize: '0.7rem', padding: '3px 8px' }} onClick={() => onOpenFundDetail(rf.slug)}>
                      查看 SOP <ExternalLink size={11} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {uncoveredFunds.length > 0 && (
            <div
              style={{
                background: 'var(--surface-subtle)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '8px',
                padding: '12px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '12px',
                flexWrap: 'wrap',
              }}
            >
              <div>
                <div style={{ fontSize: '0.8rem', fontWeight: 700, marginBottom: '4px' }}>
                  尚有 {uncoveredFunds.length} 只持仓基金未完成 SOP v2.0 深度分析
                </div>
                <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>
                  {uncoveredFunds.map((u) => `${u.code} (${u.weight_pct}%)`).join('、')}
                </div>
                {enqueueState.msg && (
                  <div style={{ fontSize: '0.73rem', marginTop: '5px', color: enqueueState.done ? 'var(--success)' : 'var(--warning)' }}>
                    {enqueueState.done && <CheckCircle2 size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} />}
                    {enqueueState.msg}
                  </div>
                )}
              </div>
              <button
                type="button"
                className="create-btn"
                style={{ fontSize: '0.76rem', padding: '7px 14px', display: 'flex', alignItems: 'center', gap: '6px' }}
                onClick={handleBatchEnqueue}
                disabled={enqueueState.busy}
              >
                <BookmarkPlus size={14} />
                {enqueueState.busy ? '加入队列中...' : `一键将 ${uncoveredFunds.length} 只加入观察分析队列`}
              </button>
            </div>
          )}
        </div>
      )}

      <XRayPrintReport
        open={printOpen}
        onClose={() => setPrintOpen(false)}
        portfolioName={portfolioName}
        currency={currency}
        currencySymbol={currencySymbol}
        totalNav={totalNav}
        xrayData={serverXRay}
        localXRay={localXRay}
      />
    </section>
  );
}
