import React, { useState } from 'react';

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
        body: formData,
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.detail || 'Parse error');

      onPlanLoaded(result);
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
      e.target.value = ''; // Allow re-upload
    }
  };

  const clearPlan = () => {
    onPlanLoaded(null);
    setShowAllRows(false);
  };

  const formatMoney = (val) => val === 0 ? '-' : Math.round(val).toLocaleString();

  return (
    <div style={{
      background: 'var(--card-bg, #1e1e24)',
      border: '1px solid var(--border-color, rgba(255,255,255,0.1))',
      borderRadius: '8px',
      marginTop: '16px',
      overflow: 'hidden'
    }}>
      {/* Header with Toggle */}
      <div 
        style={{
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: enabled ? 'rgba(16, 185, 129, 0.1)' : 'rgba(255,255,255,0.02)',
          borderBottom: enabled ? '1px solid var(--border-color, rgba(255,255,255,0.1))' : 'none',
          cursor: 'pointer'
        }}
        onClick={onToggle}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '1.2rem' }}>🛡</span>
          <h4 style={{ margin: 0, color: enabled ? '#10b981' : '#fff' }}>储蓄分红险配置</h4>
        </div>
        <div style={{
            width: '40px', height: '22px', borderRadius: '11px', 
            background: enabled ? '#10b981' : 'rgba(255,255,255,0.2)',
            position: 'relative', transition: 'background 0.2s'
        }}>
          <div style={{
              width: '18px', height: '18px', borderRadius: '50%', background: '#fff',
              position: 'absolute', top: '2px', left: enabled ? '20px' : '2px',
              transition: 'left 0.2s'
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
                <label style={{
                  display: 'inline-block',
                  background: 'rgba(255,255,255,0.1)',
                  padding: '8px 16px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '0.9rem'
                }}>
                  {uploading ? '⏳ 解析中...' : '📎 上传保险计划书 (Excel)'}
                  <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={handleFileUpload} disabled={uploading} />
                </label>
                {uploadError && <p style={{ color: '#ef4444', fontSize: '0.85rem', marginTop: '8px' }}>❌ {uploadError}</p>}
                <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.8rem', marginTop: '8px' }}>
                  提取建议：计划书中的“保证现金价值”、“复归红利”、“终期分红”及“现金提取”列。
                </p>
              </div>
            ) : (
              <div style={{
                background: 'rgba(16, 185, 129, 0.05)',
                border: '1px solid rgba(16, 185, 129, 0.2)',
                padding: '12px',
                borderRadius: '6px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <div>
                  <div style={{ color: '#10b981', fontWeight: 'bold' }}>✓ 已加载: {insurancePlan.policy_name}</div>
                  <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.85rem', marginTop: '4px' }}>
                    包含 {insurancePlan.total_years} 年现金流数据
                    {insurancePlan.sheet_name ? ` · 解析页签「${insurancePlan.sheet_name}」` : ''}
                  </div>
                </div>
                <button 
                  onClick={(e) => { e.stopPropagation(); clearPlan(); }}
                  style={{
                    background: 'transparent', border: '1px solid rgba(255,255,255,0.2)',
                    color: '#fff', padding: '4px 12px', borderRadius: '4px', cursor: 'pointer'
                  }}
                >
                  ✕ 清除
                </button>
              </div>
            )}
          </div>

          {/* Alpha Slider Controls */}
          {insurancePlan && (
            <div style={{ marginBottom: '20px', background: 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: '6px' }}>
              <div style={{ fontSize: '0.9rem', marginBottom: '12px', color: 'rgba(255,255,255,0.8)' }}>
                非保证成分实现率 (α) 模拟范围约束：
              </div>
              <div style={{ display: 'flex', gap: '24px', alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '4px' }}>
                    <span>下限 (最悲观)</span>
                    <span style={{ color: '#ef4444' }}>{Math.round(alphaLow * 100)}%</span>
                  </label>
                  <input 
                    type="range" min="0" max="1" step="0.05" value={alphaLow}
                    onChange={(e) => onAlphaChange(parseFloat(e.target.value), Math.max(parseFloat(e.target.value), alphaHigh))}
                    style={{ width: '100%', accentColor: '#ef4444' }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '4px' }}>
                    <span>上限 (最乐观)</span>
                    <span style={{ color: '#10b981' }}>{Math.round(alphaHigh * 100)}%</span>
                  </label>
                  <input 
                    type="range" min="0" max="2" step="0.05" value={alphaHigh}
                    onChange={(e) => onAlphaChange(Math.min(alphaLow, parseFloat(e.target.value)), parseFloat(e.target.value))}
                    style={{ width: '100%', accentColor: '#10b981' }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Data Table Preview */}
          {insurancePlan && (
            <div>
              <div style={{ fontSize: '0.9rem', marginBottom: '8px', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'rgba(255,255,255,0.6)' }}>现金流数据预览 (USD)</span>
                <span style={{ color: '#3b82f6', cursor: 'pointer', fontSize: '0.85rem' }} onClick={() => setShowAllRows(!showAllRows)}>
                  {showAllRows ? '只看前5年' : `展开全部 ${insurancePlan.total_years} 行...`}
                </span>
              </div>
              <div style={{ overflowX: 'auto', maxHeight: showAllRows ? '400px' : 'none', overflowY: showAllRows ? 'auto' : 'hidden' }}>
                <table style={{ width: '100%', textAlign: 'right', fontSize: '0.85rem', borderCollapse: 'collapse' }}>
                  <thead style={{ position: showAllRows ? 'sticky' : 'static', top: 0, background: '#1e1e24' }}>
                    <tr style={{ color: 'rgba(255,255,255,0.5)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                      <th style={{ padding: '8px 4px', textAlign: 'center' }}>年度</th>
                      <th style={{ padding: '8px 4px' }}>提取额</th>
                      <th style={{ padding: '8px 4px' }}>保证CV</th>
                      <th style={{ padding: '8px 4px' }}>非保证CV</th>
                      <th style={{ padding: '8px 4px' }}>期末总CV</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(showAllRows ? insurancePlan.years : insurancePlan.years.slice(0, 5)).map((row) => (
                      <tr key={row.year} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        <td style={{ padding: '6px 4px', textAlign: 'center', color: 'rgba(255,255,255,0.6)' }}>{row.year}</td>
                        <td style={{ padding: '6px 4px', color: row.withdrawal > 0 ? '#f59e0b' : 'inherit' }}>{formatMoney(row.withdrawal)}</td>
                        <td style={{ padding: '6px 4px' }}>{formatMoney(row.guaranteed_cv)}</td>
                        <td style={{ padding: '6px 4px', color: 'rgba(255,255,255,0.8)' }}>{formatMoney(row.non_guaranteed)}</td>
                        <td style={{ padding: '6px 4px', fontWeight: 'bold' }}>{formatMoney(row.total_cv_base)}</td>
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
