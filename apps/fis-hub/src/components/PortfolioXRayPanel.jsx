import React, { useMemo } from 'react';
import { Layers, ShieldCheck, AlertTriangle, Sparkles } from 'lucide-react';
import { computePortfolioXRay } from '../utils/portfolioXRay';

const BAR_COLORS = [
  'var(--accent-color)',
  'var(--accent-secondary)',
  'var(--info, #3b82f6)',
  'var(--warning, #f59e0b)',
  '#8b5cf6',
  '#ec4899',
];

/**
 * 晨星组合透视面板（Morningstar Portfolio X-Ray）：
 * 展示资产大类穿透、币种敞口、加权费率（MPS）、晨星星级/质量、分散度与诊断建议。
 */
export default function PortfolioXRayPanel({
  holdings = [],
  quantFunds = [],
  totalNav = 0,
  currencySymbol = '$',
  title = '晨星组合透视 · Morningstar X-Ray',
}) {
  const xray = useMemo(
    () => computePortfolioXRay({ holdings, quantFunds, totalNav }),
    [holdings, quantFunds, totalNav]
  );

  if (!xray.holdings.length) return null;

  const feeColor =
    xray.feeTier === 'low'
      ? 'var(--success, #10b981)'
      : xray.feeTier === 'high'
      ? 'var(--danger, #f43f5e)'
      : 'var(--warning, #d97706)';

  return (
    <section
      className="glass-card"
      style={{
        marginTop: '20px',
        borderTop: '3px solid var(--accent-secondary)',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Layers size={18} style={{ color: 'var(--accent-secondary)' }} />
          <h3 style={{ margin: 0, fontSize: '1.08rem' }}>{title}</h3>
        </div>
        <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
          5 支柱质量 · 穿透费率 (MPS) · 集中度诊断
        </span>
      </div>

      {/* 核心透视指标卡 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))', gap: '10px' }}>
        <div style={{ background: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '12px 14px' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '4px' }}>加权晨星星级</div>
          <div style={{ fontSize: '1.18rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--warning, #f59e0b)' }}>
            {xray.avgStars != null ? `${xray.avgStars.toFixed(1)} ★` : '—'}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
            {xray.avgSharpe != null ? `加权夏普 ${xray.avgSharpe.toFixed(2)}` : '按权重加权'}
          </div>
        </div>

        <div style={{ background: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '12px 14px' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '4px' }}>穿透管理费率 (MPS)</div>
          <div style={{ fontSize: '1.18rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: feeColor }}>
            {xray.avgFeePct != null ? `${xray.avgFeePct.toFixed(2)}%` : '—'}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
            {xray.estAnnualFeeAmount != null
              ? `预估年费 ${currencySymbol}${Math.round(xray.estAnnualFeeAmount).toLocaleString()}`
              : `覆盖权重 ${xray.feeCoveragePct}%`}
          </div>
        </div>

        <div style={{ background: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '12px 14px' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '4px' }}>有效持仓分散度</div>
          <div style={{ fontSize: '1.18rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--accent-color)' }}>
            {xray.effectiveN > 0 ? `${xray.effectiveN.toFixed(1)} 只` : '—'}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
            最大单一持仓 {xray.maxSingleHolding.weightPct.toFixed(1)}%
          </div>
        </div>

        <div style={{ background: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '12px 14px' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '4px' }}>加权 3Y 波动 / 回撤</div>
          <div style={{ fontSize: '1.18rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
            {xray.avgVol != null ? `${xray.avgVol.toFixed(1)}%` : '—'}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--danger, #f43f5e)', marginTop: '2px' }}>
            {xray.avgMaxDd != null ? `加权最大回撤 ${xray.avgMaxDd.toFixed(1)}%` : '需同步基金库序列'}
          </div>
        </div>
      </div>

      {/* 资产大类穿透 + 币种/评级分布 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' }}>
        <div style={{ background: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '14px' }}>
          <div style={{ fontSize: '0.82rem', fontWeight: 700, marginBottom: '10px', color: 'var(--text-primary)' }}>
            资产大类穿透（Asset Class X-Ray）
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {xray.assetClasses.map((item, idx) => (
              <div key={item.label}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBottom: '3px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>{item.label}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{item.pct}%</span>
                </div>
                <div style={{ height: '7px', borderRadius: '4px', background: 'var(--border-subtle)', overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${Math.min(100, item.pct)}%`,
                      height: '100%',
                      background: BAR_COLORS[idx % BAR_COLORS.length],
                      borderRadius: '4px',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ background: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '14px' }}>
          <div style={{ fontSize: '0.82rem', fontWeight: 700, marginBottom: '10px', color: 'var(--text-primary)' }}>
            币种敞口与晨星量化评级分布
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
            {xray.currencies.map((c) => (
              <span
                key={c.label}
                style={{
                  fontSize: '0.74rem',
                  padding: '3px 9px',
                  borderRadius: '4px',
                  background: 'var(--bg-primary, rgba(0,0,0,0.04))',
                  border: '1px solid var(--border-subtle)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {c.label}: <strong>{c.pct}%</strong>
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {xray.gradeDistribution.map((g) => (
              <span
                key={g.label}
                style={{
                  fontSize: '0.74rem',
                  padding: '3px 9px',
                  borderRadius: '4px',
                  background: 'rgba(var(--accent-secondary-rgb, 99, 102, 241), 0.1)',
                  color: 'var(--accent-secondary)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {g.label === 'Unrated' ? '未评级/指数' : `评级 ${g.label}`}: <strong>{g.pct}%</strong>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* 诊断结论 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {xray.diagnostics.map((d, idx) => (
          <div
            key={idx}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 12px',
              borderRadius: '6px',
              fontSize: '0.8rem',
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
    </section>
  );
}
