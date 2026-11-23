import React, { useMemo, useState } from 'react';
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, Area,
} from 'recharts';
import { applyILPToMCChart } from '../utils/ilpImpactUtils';

const fmtAmt = v => {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return (v < 0 ? '-' : '') + '$' + (abs / 1_000_000).toFixed(2) + 'M';
  if (abs >= 1_000)     return (v < 0 ? '-' : '') + '$' + (abs / 1_000).toFixed(1) + 'k';
  return (v < 0 ? '-' : '') + '$' + Math.round(abs).toLocaleString();
};
const fmt = v => '$' + Math.round(Math.abs(v)).toLocaleString();

const CUSTOM_TOOLTIP_STYLE = {
  background: 'var(--tooltip-bg)',
  border: '1px solid var(--tooltip-border)',
  borderRadius: '6px',
  padding: '12px 16px',
  fontSize: '0.8rem',
  minWidth: '240px',
  color: 'var(--tooltip-text)',
  boxShadow: 'var(--card-shadow)',
};

export default function ILPImpactPanel({ mcChart, ilpConfig, labMcSettings }) {
  const [view, setView] = useState('chart');

  const processed = useMemo(() => {
    if (!mcChart || !ilpConfig || !(ilpConfig.totalPremium > 0)) return null;
    return applyILPToMCChart(mcChart, ilpConfig);
  }, [mcChart, ilpConfig]);

  if (!processed) return null;

  const { chart: ilpChart, annualBreakdown, enrollmentBonus, effectivePrincipal } = processed;
  const years = parseInt(labMcSettings?.years) || 20;
  const totalPremium = ilpConfig.totalPremium || 0;
  const sumAssured = totalPremium * 1.05;

  const last = ilpChart[ilpChart.length - 1] || {};
  const totalFees  = annualBreakdown.reduce((s, r) => s + r.netFee, 0);
  const grossFinal = last.ilp_gross_p50 || 0;
  const netFinal   = last.ilp_net_p50  || 0;
  const dragAmt    = grossFinal - netFinal;
  const dragPct    = grossFinal > 0 ? (dragAmt / grossFinal) * 100 : 0;

  const early5 = annualBreakdown.filter(r => r.year <= 5);
  const fees5yr = early5.reduce((s, r) => s + r.netFee, 0);
  const yr5entry = ilpChart.find(d => d.year === 5) || ilpChart[Math.min(5, ilpChart.length - 1)];
  const growthFactor5 = yr5entry?.ilp_gross_p50 && effectivePrincipal > 0
    ? yr5entry.ilp_gross_p50 / effectivePrincipal
    : 1;
  const bonusValueAt5 = enrollmentBonus * growthFactor5;
  const bonusOffsetRatio = fees5yr > 0 ? bonusValueAt5 / fees5yr : 0;
  const netCostAfterBonus5 = Math.max(0, fees5yr - bonusValueAt5);

  const bonusValueByYear = {};
  annualBreakdown.forEach(r => {
    const yrEntry = ilpChart.find(d => d.year === r.year);
    const gf = yrEntry?.ilp_gross_p50 && effectivePrincipal > 0
      ? yrEntry.ilp_gross_p50 / effectivePrincipal : 1;
    bonusValueByYear[r.year] = enrollmentBonus * gf;
  });

  const bonusGrowthByYear = {};
  annualBreakdown.forEach((r, i) => {
    const prevBonusVal = i === 0 ? enrollmentBonus : bonusValueByYear[r.year - 1] ?? enrollmentBonus;
    bonusGrowthByYear[r.year] = (bonusValueByYear[r.year] ?? enrollmentBonus) - prevBonusVal;
  });

  const tabBtn = (active) => ({
    padding: '6px 14px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.78rem',
    fontWeight: active ? 700 : 500, transition: 'all 0.18s',
    border: `1px solid ${active ? 'var(--accent-color)' : 'var(--border-subtle)'}`,
    background: active ? 'rgba(var(--accent-color-rgb), 0.1)' : 'var(--surface-card)',
    color: active ? 'var(--accent-color)' : 'var(--text-secondary)',
  });

  const summaryCards = [
    { label: '开户奖赏（单位方式进入）', val: `+${fmt(enrollmentBonus)}`, color: 'var(--accent-secondary)' },
    { label: '有效初始账户价值', val: fmtAmt(effectivePrincipal), color: 'var(--info)',
      sub: `保费 ${fmtAmt(totalPremium)} + 奖赏 ${fmtAmt(enrollmentBonus)}` },
    { label: '身故保障额（SA）', val: fmtAmt(sumAssured), color: 'var(--accent-color)',
      sub: '已缴保费 × 105%（AV > SA 后 COI = 0）' },
    { label: `${years}年理论账户价值（P50）`, val: fmtAmt(grossFinal), color: 'var(--text-primary)' },
    { label: `${years}年净账户价值（含ILP费）`, val: fmtAmt(netFinal), color: 'var(--accent-color)' },
    { label: `${years}年累计净费用`, val: `-${fmtAmt(totalFees)}`, color: 'var(--danger)',
      sub: `拖累率 ${dragPct.toFixed(1)}%` },
  ];

  return (
    <div style={{
      marginTop: '24px',
      background: 'var(--surface-subtle)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--card-radius)',
      padding: '20px 22px',
    }}>
      {/* 标题栏 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
        <div>
          <h4 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--accent-color)', fontWeight: 700 }}>
            ILP 投连险费用影响分析
          </h4>
          <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '3px' }}>
            账户价值基于实际保费 × MC 增长率 · 逐月扣减前期费/户口价值费/COI · 奖赏以基金单位计入
          </div>
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button type="button" style={tabBtn(view === 'chart')} onClick={() => setView('chart')}>对比图</button>
          <button type="button" style={tabBtn(view === 'table')} onClick={() => setView('table')}>年度费用</button>
        </div>
      </div>

      {/* 摘要卡 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))', gap: '10px', marginBottom: '18px' }}>
        {summaryCards.map((c, i) => (
          <div key={i} style={{
            background: 'var(--surface-card)', borderRadius: 'var(--card-radius)',
            padding: '12px 14px', border: '1px solid var(--border-subtle)',
          }}>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: '5px' }}>{c.label}</div>
            <div style={{ fontSize: '0.96rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: c.color }}>{c.val}</div>
            {c.sub && <div style={{ fontSize: '0.64rem', color: 'var(--text-muted)', marginTop: '3px' }}>{c.sub}</div>}
          </div>
        ))}
      </div>

      {/* 前5年奖赏抵扣分析 */}
      <div style={{
        marginBottom: '18px',
        padding: '16px 18px',
        borderRadius: 'var(--card-radius)',
        background: 'var(--surface-card)',
        border: '1px solid var(--border-subtle)',
        borderLeft: '3px solid var(--accent-secondary)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '14px' }}>
          <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--accent-secondary)' }}>前5年：开户奖赏抵扣分析</span>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            奖赏以基金单位增值，用第5年末价值对比累计费用
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px', marginBottom: '14px' }}>
          {[
            {
              label: '前5年累计净费用', val: `-${fmtAmt(fees5yr)}`,
              sub: '前期费 + 户口价值费 + COI',
              color: 'var(--danger)',
            },
            {
              label: `开户奖赏（第5年末增值后）`, val: `+${fmtAmt(bonusValueAt5)}`,
              sub: `奖赏 ${fmtAmt(enrollmentBonus)} × ${growthFactor5.toFixed(3)}（5年增长率）`,
              color: 'var(--accent-secondary)',
            },
            {
              label: '奖赏抵扣后 5年净成本',
              val: netCostAfterBonus5 < 0.01 ? '✓ 完全覆盖' : `-${fmtAmt(netCostAfterBonus5)}`,
              sub: `奖赏抵扣率 ${(bonusOffsetRatio * 100).toFixed(1)}%`,
              color: bonusOffsetRatio >= 1 ? 'var(--success)' : bonusOffsetRatio >= 0.7 ? 'var(--accent-secondary)' : 'var(--danger)',
            },
          ].map((c, i) => (
            <div key={i} style={{
              background: 'var(--surface-subtle)', borderRadius: 'var(--card-radius)',
              padding: '12px 14px', border: '1px solid var(--border-subtle)',
            }}>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>{c.label}</div>
              <div style={{ fontSize: '1.05rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: c.color }}>{c.val}</div>
              <div style={{ fontSize: '0.64rem', color: 'var(--text-muted)', marginTop: '4px' }}>{c.sub}</div>
            </div>
          ))}
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '5px' }}>
            <span>奖赏抵扣率（第5年末奖赏价值 / 前5年总费用）</span>
            <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', color: bonusOffsetRatio >= 1 ? 'var(--success)' : 'var(--accent-secondary)' }}>
              {(bonusOffsetRatio * 100).toFixed(1)}%
            </span>
          </div>
          <div style={{ height: '8px', borderRadius: '4px', background: 'var(--surface-inset)', overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${Math.min(100, bonusOffsetRatio * 100).toFixed(1)}%`,
              borderRadius: '4px',
              background: bonusOffsetRatio >= 1
                ? 'var(--success)'
                : bonusOffsetRatio >= 0.7
                  ? 'var(--accent-secondary)'
                  : 'var(--danger)',
              transition: 'width 0.8s ease',
            }} />
          </div>
        </div>

        <div style={{
          marginTop: '12px', padding: '10px 12px',
          borderRadius: 'var(--card-radius)', fontSize: '0.78rem', lineHeight: 1.6,
          background: bonusOffsetRatio >= 1 ? 'var(--success-bg)' : 'var(--warning-bg)',
          border: '1px solid var(--border-subtle)',
          color: 'var(--text-secondary)',
        }}>
          {bonusOffsetRatio >= 1 ? (
            <>✓ <strong style={{ color: 'var(--success)' }}>开户奖赏已完全覆盖前5年费用</strong>。
              奖赏增值后为 {fmtAmt(bonusValueAt5)}，超出费用 {fmtAmt(bonusValueAt5 - fees5yr)}，
              投资人在前5年享受保险保障的同时，<strong>净成本为零</strong>。
            </>
          ) : (
            <>开户奖赏可抵扣前5年费用的 <strong style={{ color: 'var(--accent-secondary)' }}>{(bonusOffsetRatio * 100).toFixed(1)}%</strong>。
              5年末奖赏增值为 {fmtAmt(bonusValueAt5)}，
              尚余 {fmtAmt(netCostAfterBonus5)} 为净费用成本
              （约为保费的 {totalPremium > 0 ? ((netCostAfterBonus5 / totalPremium) * 100).toFixed(2) : 0}%）。
            </>
          )}
        </div>
      </div>

      {/* 对比图 */}
      {view === 'chart' && (
        <>
          <div style={{ height: '380px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={ilpChart}>
                <defs>
                  <linearGradient id="grossGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#28547A" stopOpacity={0.18} />
                    <stop offset="95%" stopColor="#28547A" stopOpacity={0.01} />
                  </linearGradient>
                  <linearGradient id="netGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#1E4D3B" stopOpacity={0.16} />
                    <stop offset="95%" stopColor="#1E4D3B" stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                <XAxis dataKey="year" stroke="var(--border-subtle)" tick={{ fill: 'var(--chart-axis)', fontSize: 11, fontFamily: 'var(--font-mono)' }} />
                <YAxis stroke="var(--border-subtle)" tick={{ fill: 'var(--chart-axis)', fontSize: 11, fontFamily: 'var(--font-mono)' }} tickFormatter={v => fmtAmt(v)} width={76} />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0]?.payload || {};
                    const coi0 = annualBreakdown.find(r => r.year === label)?.coiZeroMonths || 0;
                    return (
                      <div style={CUSTOM_TOOLTIP_STYLE}>
                        <div style={{ fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--text-primary)', marginBottom: '10px' }}>第 {label} 年</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                          {[
                            { k: 'ilp_gross_p90', label: '理论账户 P90（乐观）', color: 'var(--success)' },
                            { k: 'ilp_gross_p50', label: '理论账户 P50（中性）', color: 'var(--info)' },
                            { k: 'ilp_gross_p10', label: '理论账户 P10（悲观）', color: 'var(--danger)' },
                            { k: 'ilp_net_p90',   label: 'ILP净值 P90',  color: 'var(--accent-color)', dash: true },
                            { k: 'ilp_net_p50',   label: 'ILP净值 P50',  color: 'var(--accent-secondary)', dash: true },
                            { k: 'ilp_net_p10',   label: 'ILP净值 P10',  color: 'var(--danger)', dash: true },
                          ].map(row => d[row.k] != null && (
                            <div key={row.k} style={{ display: 'flex', justifyContent: 'space-between', gap: '14px' }}>
                              <span style={{ color: row.color, fontSize: '0.75rem' }}>
                                {row.dash ? '‥ ' : ''}{row.label}
                              </span>
                              <span style={{ fontWeight: 700, color: row.color, fontFamily: 'var(--font-mono)' }}>
                                {fmtAmt(d[row.k])}
                              </span>
                            </div>
                          ))}
                          {d.ilp_net_fee != null && label > 0 && (
                            <>
                              <div style={{ borderTop: '1px dashed var(--border-subtle)', marginTop: '6px', paddingTop: '6px' }} />
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '14px' }}>
                                <span style={{ color: 'var(--danger)', fontSize: '0.75rem' }}>本年 ILP 净费用</span>
                                <span style={{ fontWeight: 700, color: 'var(--danger)', fontFamily: 'var(--font-mono)' }}>
                                  -{fmtAmt(d.ilp_net_fee)}
                                </span>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '14px' }}>
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>费用拖累率</span>
                                <span style={{ fontWeight: 700, color: d.ilp_drag_pct > 5 ? 'var(--danger)' : 'var(--accent-secondary)', fontFamily: 'var(--font-mono)' }}>
                                  {d.ilp_drag_pct?.toFixed(2)}%
                                </span>
                              </div>
                              {coi0 > 0 && (
                                <div style={{ color: 'var(--success)', fontSize: '0.7rem', marginTop: '2px' }}>
                                  ✓ COI 为零 {coi0} 个月（账户价值 ≥ 保额）
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    );
                  }}
                />
                <Legend formatter={v => <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>{v}</span>} />
                <Area type="monotone" dataKey="ilp_gross_p50" stroke="#28547A" strokeWidth={2.2} fill="url(#grossGrad)" dot={false} name="理论账户 P50（无费用）" />
                <Line type="monotone" dataKey="ilp_gross_p90" stroke="#1E4D3B" strokeWidth={1.5} strokeDasharray="6 3" dot={false} name="理论账户 P90" />
                <Line type="monotone" dataKey="ilp_gross_p10" stroke="#8C3B32" strokeWidth={1.5} strokeDasharray="6 3" dot={false} name="理论账户 P10" />
                <Area type="monotone" dataKey="ilp_net_p50" stroke="#9A6F38" strokeWidth={2.2} strokeDasharray="4 3" fill="url(#netGrad)" dot={false} name="ILP 净值 P50" />
                <Line type="monotone" dataKey="ilp_net_p90" stroke="#4A6B5D" strokeWidth={1.5} strokeDasharray="3 3" dot={false} name="ILP 净值 P90" />
                <Line type="monotone" dataKey="ilp_net_p10" stroke="#B45309" strokeWidth={1.5} strokeDasharray="3 3" dot={false} name="ILP 净值 P10" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div style={{ textAlign: 'center', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '8px' }}>
            实色区域 = 理论账户价值（未扣费） &nbsp;·&nbsp; 虚色区域 = ILP 净值（已扣月度净费用）
          </div>
        </>
      )}

      {/* 年度费用明细表 */}
      {view === 'table' && (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                {['年', '理论账户值(P50)', '前期费', '户口价值费', '保险费(COI)', '长期客户奖赏', '年净费用', '奖赏增值', '奖赏覆盖率', '费用率'].map((h, i) => (
                  <th key={h} style={{ textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {annualBreakdown.map((row) => {
                const inEarlyPhase = row.year <= 5;
                const inLoyaltyPhase = row.year >= 6;
                const dragPctRow = row.ilp_drag_pct ?? (row.grossAV_p50 > 0 ? (row.netFee / row.grossAV_p50) * 100 : 0);
                const bv = bonusValueByYear[row.year] ?? enrollmentBonus;
                const bg = bonusGrowthByYear[row.year] ?? 0;
                const coverPct = row.netFee > 0 ? (bv / fees5yr) * 100 : 0;
                return (
                  <tr key={row.year}>
                    <td style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                      Year {row.year}
                      {row.year === 1 && row.enrollmentBonus > 0 && (
                        <div style={{ fontSize: '0.64rem', color: 'var(--accent-secondary)', marginTop: '2px' }}>
                          +{fmt(row.enrollmentBonus)}
                        </div>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--info)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                      {fmtAmt(row.grossAV_p50)}
                      {row.coiZeroMonths > 0 && (
                        <div style={{ fontSize: '0.6rem', color: 'var(--success)' }}>COI=0 × {row.coiZeroMonths}月</div>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', color: inEarlyPhase ? 'var(--danger)' : 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      {inEarlyPhase ? `-${fmtAmt(row.initialCharge)}` : '—'}
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--danger)', fontFamily: 'var(--font-mono)' }}>
                      -{fmtAmt(row.accountCharge)}
                    </td>
                    <td style={{ textAlign: 'right', color: row.coi > 0 ? 'var(--warning)' : 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      {row.coi > 0 ? `-${fmtAmt(row.coi)}` : '—'}
                    </td>
                    <td style={{ textAlign: 'right', color: inLoyaltyPhase && row.loyaltyBonus > 0 ? 'var(--success)' : 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      {inLoyaltyPhase && row.loyaltyBonus > 0 ? `+${fmtAmt(row.loyaltyBonus)}` : '—'}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700, fontFamily: 'var(--font-mono)', color: row.netFee > 0 ? 'var(--danger)' : 'var(--success)' }}>
                      {row.netFee > 0 ? `-${fmtAmt(row.netFee)}` : `+${fmtAmt(-row.netFee)}`}
                    </td>
                    <td style={{ textAlign: 'right', color: inEarlyPhase ? 'var(--accent-secondary)' : 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      {inEarlyPhase ? (
                        <>
                          <span style={{ fontWeight: 600 }}>{fmtAmt(bv)}</span>
                          {bg > 0 && <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>+{fmtAmt(bg)} 增值</div>}
                        </>
                      ) : '—'}
                    </td>
                    <td style={{ textAlign: 'right', color: inEarlyPhase ? (coverPct >= 100 ? 'var(--success)' : 'var(--accent-secondary)') : 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      {inEarlyPhase ? `${coverPct.toFixed(1)}%` : '—'}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: dragPctRow > 5 ? 'var(--danger)' : dragPctRow > 2 ? 'var(--warning)' : 'var(--text-secondary)' }}>
                      {dragPctRow.toFixed(2)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td style={{ fontWeight: 700, color: 'var(--accent-color)', background: 'var(--surface-subtle)' }}>合计</td>
                <td style={{ textAlign: 'right', color: 'var(--text-muted)', background: 'var(--surface-subtle)' }}>—</td>
                <td style={{ textAlign: 'right', color: 'var(--danger)', fontWeight: 600, fontFamily: 'var(--font-mono)', background: 'var(--surface-subtle)' }}>
                  -{fmtAmt(annualBreakdown.reduce((s, r) => s + r.initialCharge, 0))}
                </td>
                <td style={{ textAlign: 'right', color: 'var(--danger)', fontWeight: 600, fontFamily: 'var(--font-mono)', background: 'var(--surface-subtle)' }}>
                  -{fmtAmt(annualBreakdown.reduce((s, r) => s + r.accountCharge, 0))}
                </td>
                <td style={{ textAlign: 'right', color: 'var(--warning)', fontWeight: 600, fontFamily: 'var(--font-mono)', background: 'var(--surface-subtle)' }}>
                  -{fmtAmt(annualBreakdown.reduce((s, r) => s + r.coi, 0))}
                </td>
                <td style={{ textAlign: 'right', color: 'var(--success)', fontWeight: 600, fontFamily: 'var(--font-mono)', background: 'var(--surface-subtle)' }}>
                  +{fmtAmt(annualBreakdown.reduce((s, r) => s + r.loyaltyBonus, 0))}
                </td>
                <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--danger)', fontFamily: 'var(--font-mono)', background: 'var(--surface-subtle)' }}>
                  -{fmtAmt(annualBreakdown.reduce((s, r) => s + r.netFee, 0))}
                </td>
                <td colSpan={3} style={{ background: 'var(--surface-subtle)' }} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
