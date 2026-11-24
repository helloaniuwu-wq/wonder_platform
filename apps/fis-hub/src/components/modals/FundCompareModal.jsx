import React, { useEffect, useState } from 'react';
import {
  LineChart, Line, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ZAxis,
} from 'recharts';
import { X, Zap } from 'lucide-react';
import { authHeaders } from '../../utils/auth';
import { fmtNum, fmtPct, fmtSignedPct } from '../../utils/fundQuantUtils';
import { useLang } from '../../i18n/langCore';

const LINE_COLORS = ['#c59b5f', '#3b82f6', '#10b981', '#a855f7', '#ef4444', '#f59e0b'];

const FundCompareModal = ({ open, slugs = [], onClose, onSendBasketToLab }) => {
  const { lang } = useLang();
  const [range, setRange] = useState('3y');
  const [currency, setCurrency] = useState('USD');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || slugs.length < 2) return;
    let active = true;
    const run = async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/quant/compare', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ slugs, range, currency }),
        });
        if (active && res.ok) {
          setData(await res.json());
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    run();
    return () => { active = false; };
  }, [open, slugs, range, currency]);

  if (!open) return null;

  const funds = data?.funds || [];
  const chart = data?.chart || [];
  const scatter = (data?.scatter || []).filter((p) => p.vol_pct != null && p.ret_pct != null);
  const corrMatrix = data?.correlation_matrix || [];
  const corrLookup = new Map(corrMatrix.map((c) => [`${c.asset1}:${c.asset2}`, c.value]));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="glass-card modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(1040px, 96vw)', maxHeight: '90vh', overflowY: 'auto', padding: '24px' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.25rem' }}>
              {lang === 'en' ? `Multi-Fund Quant Comparison (${slugs.length})` : `多基金量化对比工作台（${slugs.length} 只）`}
            </h2>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="lab-segmented">
              {['1y', '3y', '5y'].map((r) => (
                <button key={r} type="button" aria-pressed={range === r} onClick={() => setRange(r)}>{r.toUpperCase()}</button>
              ))}
            </div>
            <div className="lab-segmented">
              {['USD', 'HKD', 'CNY'].map((c) => (
                <button key={c} type="button" aria-pressed={currency === c} onClick={() => setCurrency(c)}>{c}</button>
              ))}
            </div>
            <button
              type="button"
              className="create-btn"
              style={{ padding: '6px 14px', fontSize: '0.8rem' }}
              onClick={() => {
                onSendBasketToLab(funds.map((f) => f.code || f.slug));
                onClose();
              }}
            >
              <Zap size={14} /> {lang === 'en' ? 'Optimize Basket in Lab' : '整篮送入策略实验室'}
            </button>
            <button type="button" onClick={onClose} className="action-btn-secondary" style={{ padding: '6px' }}>
              <X size={16} />
            </button>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--text-muted)' }}>Loading comparison...</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            {/* Normalized Multi-Line Growth */}
            {chart.length > 0 && (
              <div style={{ background: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--card-radius)', padding: '14px' }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
                  {lang === 'en' ? `Normalized Total Return (Base=100, ${currency})` : `归一化总回报对比（起点=100，${currency}）`}
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={chart}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={40} />
                    <YAxis tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
                    <Tooltip />
                    <Legend />
                    {funds.map((f, idx) => (
                      <Line
                        key={f.slug}
                        type="monotone"
                        dataKey={f.slug}
                        name={`${f.code} · ${f.name.slice(0, 16)}`}
                        stroke={LINE_COLORS[idx % LINE_COLORS.length]}
                        strokeWidth={2}
                        dot={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Risk-Return Scatter & Correlation Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px' }}>
              {scatter.length > 0 && (
                <div style={{ background: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--card-radius)', padding: '14px' }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
                    {lang === 'en' ? 'Risk-Return Map (3Y Vol vs Ann Return)' : '风险—收益散点分布（3Y 波动 vs 年化收益）'}
                  </div>
                  <ResponsiveContainer width="100%" height={210}>
                    <ScatterChart>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                      <XAxis type="number" dataKey="vol_pct" name="Vol" unit="%" tick={{ fontSize: 10 }} />
                      <YAxis type="number" dataKey="ret_pct" name="Return" unit="%" tick={{ fontSize: 10 }} />
                      <ZAxis range={[90, 90]} />
                      <Tooltip cursor={{ strokeDasharray: '3 3' }} formatter={(v, n) => [`${v}%`, n]} />
                      <Scatter name="Funds" data={scatter} fill="var(--accent-color)" />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              )}

              {funds.length >= 2 && corrMatrix.length > 0 && (
                <div style={{ background: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--card-radius)', padding: '14px', overflowX: 'auto' }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
                    {lang === 'en' ? 'Daily Return Correlation Matrix' : '日收益相关性热力矩阵'}
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left', padding: '6px' }}></th>
                        {funds.map((f) => <th key={f.slug} style={{ padding: '6px', textAlign: 'center' }}>{f.code}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {funds.map((fa) => (
                        <tr key={fa.slug}>
                          <td style={{ padding: '6px', fontWeight: 700 }}>{fa.code}</td>
                          {funds.map((fb) => {
                            const val = corrLookup.get(`${fa.slug}:${fb.slug}`);
                            const alpha = val != null ? Math.min(0.45, Math.abs(val) * 0.45) : 0;
                            const bg = val == null ? 'transparent' : val >= 0 ? `rgba(197,155,95,${alpha})` : `rgba(59,130,246,${alpha})`;
                            return (
                              <td key={fb.slug} style={{ padding: '6px', textAlign: 'center', background: bg, border: '1px solid var(--border-subtle)' }}>
                                {val != null ? val.toFixed(2) : '—'}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Side-by-side Metrics Table */}
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>{lang === 'en' ? 'Fund' : '基金'}</th>
                    <th>1Y</th>
                    <th>3Y Ann</th>
                    <th>3Y Vol</th>
                    <th>3Y MaxDD</th>
                    <th>Sharpe</th>
                    <th>Div Yield</th>
                    <th>Fee</th>
                    <th>Grade</th>
                  </tr>
                </thead>
                <tbody>
                  {funds.map((f) => (
                    <tr key={f.slug}>
                      <td><strong>{f.code}</strong> · {f.name}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{fmtSignedPct(f.ret_1y)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{fmtSignedPct(f.ret_3y_ann)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{fmtPct(f.vol_3y)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--danger)' }}>{fmtPct(f.max_dd_3y)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{fmtNum(f.sharpe_3y)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{fmtPct(f.div_yield_ttm)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{f.fee_pct != null ? `${f.fee_pct.toFixed(2)}%` : '—'}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{f.quant_grade || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default FundCompareModal;
