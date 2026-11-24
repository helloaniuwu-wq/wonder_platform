import React, { useState } from 'react';
import { authHeaders } from '../utils/auth';

const InsurancePlanPanel = ({
  enabled,
  onToggle,
  insurancePlan,
  onPlanLoaded,
  alphaLow,
  alphaHigh,
  onAlphaChange
}) => {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [showAllRows, setShowAllRows] = useState(false);

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploading(true);
    setUploadError(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/lab/insurance/parse', {
        method: 'POST',
        headers: authHeaders(),
        body: formData,
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.detail || 'Parse error');

      onPlanLoaded(result);
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const clearPlan = () => {
    onPlanLoaded(null);
    setShowAllRows(false);
  };

  const formatMoney = (val) => val === 0 ? '-' : Math.round(val).toLocaleString();

  return (
    <div style={{
      background: 'var(--surface-card)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--card-radius)',
      marginTop: '12px',
      overflow: 'hidden',
    }}>
      {/* Header with Toggle */}
      <div
        style={{
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: enabled ? 'rgba(var(--accent-color-rgb), 0.08)' : 'var(--surface-card)',
          borderBottom: enabled ? '1px solid var(--border-subtle)' : 'none',
          cursor: 'pointer',
        }}
        onClick={onToggle}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <h4 style={{ margin: 0, color: enabled ? 'var(--accent-color)' : 'var(--text-primary)', fontSize: '0.95rem' }}>
            储蓄分红险配置 (Participating Insurance Plan)
          </h4>
        </div>
        <div style={{
          width: '40px', height: '22px', borderRadius: '11px',
          background: enabled ? 'var(--accent-color)' : 'var(--border-strong)',
          position: 'relative', transition: 'background 0.2s', flexShrink: 0,
        }}>
          <div style={{
            width: '18px', height: '18px', borderRadius: '50%', background: '#fff',
            position: 'absolute', top: '2px', left: enabled ? '20px' : '2px',
            transition: 'left 0.2s',
          }} />
        </div>
      </div>

      {/* Expanded Content */}
      {enabled && (
        <div style={{ padding: '16px' }}>
          {/* Upload Area */}
          <div style={{ marginBottom: '20px' }}>
            {!insurancePlan ? (
              <div>
                <label className="action-btn-secondary" style={{ cursor: 'pointer' }}>
                  {uploading ? '解析中...' : '上传保险计划书 (Excel)'}
                  <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={handleFileUpload} disabled={uploading} />
                </label>
                {uploadError && <p style={{ color: 'var(--danger)', fontSize: '0.85rem', marginTop: '8px' }}>{uploadError}</p>}
                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '8px' }}>
                  提取建议：计划书中的“保证现金价值”、“复归红利”、“终期分红”及“现金提取”列。
                </p>
              </div>
            ) : (
              <div style={{
                background: 'var(--surface-subtle)',
                border: '1px solid var(--border-subtle)',
                borderLeft: '3px solid var(--accent-color)',
                padding: '12px 14px',
                borderRadius: 'var(--card-radius)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '8px',
              }}>
                <div>
                  <div style={{ color: 'var(--accent-color)', fontWeight: 700 }}>✓ 已加载: {insurancePlan.policy_name}</div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', marginTop: '4px' }}>
                    包含 {insurancePlan.total_years} 年现金流数据
                    {insurancePlan.sheet_name ? ` · 解析页签「${insurancePlan.sheet_name}」` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); clearPlan(); }}
                  className="action-btn-secondary"
                  style={{ padding: '4px 10px', fontSize: '0.78rem' }}
                >
                  清除
                </button>
              </div>
            )}
          </div>

          {/* Alpha Slider Controls */}
          {insurancePlan && (
            <div style={{ marginBottom: '20px', background: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)', padding: '14px', borderRadius: 'var(--card-radius)' }}>
              <div style={{ fontSize: '0.86rem', fontWeight: 600, marginBottom: '12px', color: 'var(--text-primary)' }}>
                非保证成分实现率 (α) 模拟范围约束：
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '20px', alignItems: 'center' }}>
                <div>
                  <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '4px', color: 'var(--text-secondary)' }}>
                    <span>下限 (最悲观)</span>
                    <span style={{ color: 'var(--danger)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{Math.round(alphaLow * 100)}%</span>
                  </label>
                  <input
                    type="range" min="0" max="1" step="0.05" value={alphaLow}
                    onChange={(e) => onAlphaChange(parseFloat(e.target.value), Math.max(parseFloat(e.target.value), alphaHigh))}
                    style={{ width: '100%', accentColor: 'var(--danger)' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '4px', color: 'var(--text-secondary)' }}>
                    <span>上限 (最乐观)</span>
                    <span style={{ color: 'var(--success)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{Math.round(alphaHigh * 100)}%</span>
                  </label>
                  <input
                    type="range" min="0" max="2" step="0.05" value={alphaHigh}
                    onChange={(e) => onAlphaChange(Math.min(alphaLow, parseFloat(e.target.value)), parseFloat(e.target.value))}
                    style={{ width: '100%', accentColor: 'var(--accent-color)' }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Data Table Preview */}
          {insurancePlan && (
            <div>
              <div style={{ fontSize: '0.85rem', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>现金流数据预览 (USD)</span>
                <button
                  type="button"
                  style={{ background: 'none', border: 'none', color: 'var(--accent-color)', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600, minBlockSize: 'auto' }}
                  onClick={() => setShowAllRows(!showAllRows)}
                >
                  {showAllRows ? '只看前5年' : `展开全部 ${insurancePlan.total_years} 行...`}
                </button>
              </div>
              <div className="table-container" style={{ maxHeight: showAllRows ? '400px' : 'none', overflowY: showAllRows ? 'auto' : 'hidden' }}>
                <table>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'center' }}>年度</th>
                      <th style={{ textAlign: 'right' }}>提取额</th>
                      <th style={{ textAlign: 'right' }}>保证CV</th>
                      <th style={{ textAlign: 'right' }}>非保证CV</th>
                      <th style={{ textAlign: 'right' }}>期末总CV</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(showAllRows ? insurancePlan.years : insurancePlan.years.slice(0, 5)).map((row) => (
                      <tr key={row.year}>
                        <td style={{ textAlign: 'center', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{row.year}</td>
                        <td style={{ textAlign: 'right', color: row.withdrawal > 0 ? 'var(--accent-secondary)' : 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{formatMoney(row.withdrawal)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{formatMoney(row.guaranteed_cv)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{formatMoney(row.non_guaranteed)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{formatMoney(row.total_cv_base)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default InsurancePlanPanel;
