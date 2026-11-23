import React, { useState, useEffect } from 'react';
import { authHeaders } from '../utils/auth';
import { getEnrollmentBonusRate } from '../utils/ilpConfigCalc';

// ════════════════════════════════════════════════════════════════════════
//  ILPSettingsModal — 通用 ILP 配置弹窗
//  - 普通用户：保存自己的配置（PUT /api/ilp/config）
//  - Advisor/Admin 为指定客户保存（PUT /api/ilp/config/{userId}）
//  - "对齐用户"：弹窗顶部明确 Badge 显示正在操作的账号
// ════════════════════════════════════════════════════════════════════════

const DEFAULT_CONFIG = {
  age: 35,
  gender: 'male',
  smoker: false,
  premium: 0,
  currency: 'USD',
  enrollment_rate: null,
};

const ILPSettingsModal = ({
  open,
  onClose,
  onSaved,
  targetUserId,      // 为指定客户设置时传入（advisor/admin 模式）
  targetUserName,    // 客户姓名（显示用）
  targetUserEmail,   // 客户邮箱（对齐用户，防误操作）
  isAdvisorMode,     // true = 顾问/Admin 替客户设置
}) => {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const apiUrl = isAdvisorMode && targetUserId
    ? `/api/ilp/config/${targetUserId}`
    : '/api/ilp/config';

  // 打开 / 切换目标用户时重置加载状态：
  // 用「渲染期按 key 比较」代替 effect 里同步 setState（React 官方推荐的重置方式）。
  const loadKey = open ? apiUrl : null;
  const [loadedKey, setLoadedKey] = useState(null);
  if (loadKey !== loadedKey) {
    setLoadedKey(loadKey);
    if (loadKey) {
      setLoading(true);
      setError('');
      setSaved(false);
    }
  }

  // 加载现有配置（切换目标用户时重新加载）
  useEffect(() => {
    if (!open) return;
    fetch(apiUrl, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => {
        setConfig({
          age: data.age ?? 35,
          gender: data.gender ?? 'male',
          smoker: data.smoker ?? false,
          premium: data.premium ?? 0,
          currency: data.currency ?? 'USD',
          enrollment_rate: data.enrollment_rate ?? null,
        });
      })
      .catch(() => setConfig(DEFAULT_CONFIG))
      .finally(() => setLoading(false));
  }, [open, apiUrl]);

  const update = (key, val) => setConfig(prev => ({ ...prev, [key]: val }));

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(apiUrl, {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...config,
          premium: parseFloat(config.premium) || 0,
          age: parseInt(config.age) || 35,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSaved(true);
      onSaved && onSaved({ ...config, totalPremium: parseFloat(config.premium) || 0 });
      setTimeout(() => { setSaved(false); onClose(); }, 900);
    } catch (e) {
      setError('保存失败：' + e.message);
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const premium = parseFloat(config.premium) || 0;
  const sumAssured = premium * 1.05;
  const enrollRate = config.enrollment_rate !== null
    ? config.enrollment_rate
    : getEnrollmentBonusRate(premium);
  const enrollBonus = premium * enrollRate;
  const fmt = v => '$' + Math.round(v).toLocaleString();
  const displayName = targetUserName || '未知客户';

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9998,
        background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
        borderRadius: '14px', padding: '26px 28px',
        width: '500px', maxWidth: '95vw', maxHeight: '92vh', overflowY: 'auto',
        border: `1px solid ${isAdvisorMode ? 'rgba(59,130,246,0.4)' : 'rgba(99,102,241,0.3)'}`,
        boxShadow: '0 24px 64px rgba(0,0,0,0.65)',
      }}>

        {/* ── 顶栏 ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '1.25rem' }}>🔗</span>
            <h3 style={{ margin: 0, fontSize: '1rem', color: isAdvisorMode ? '#60a5fa' : '#818cf8' }}>
              ILP 投连险配置
            </h3>
          </div>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.35)',
            cursor: 'pointer', fontSize: '1.15rem', padding: '2px 6px', borderRadius: '4px',
          }}>✕</button>
        </div>

        {/* ══ 用户对齐 Badge ══ 核心：明确显示正在操作哪个账号 */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '12px',
          padding: '12px 14px', borderRadius: '10px', marginBottom: '20px',
          background: isAdvisorMode ? 'rgba(59,130,246,0.07)' : 'rgba(16,185,129,0.05)',
          border: `1px solid ${isAdvisorMode ? 'rgba(59,130,246,0.25)' : 'rgba(16,185,129,0.18)'}`,
        }}>
          {/* 用户头像 */}
          <div style={{
            width: '42px', height: '42px', borderRadius: '50%', flexShrink: 0,
            background: isAdvisorMode ? 'rgba(59,130,246,0.18)' : 'rgba(16,185,129,0.14)',
            border: `1px solid ${isAdvisorMode ? 'rgba(59,130,246,0.35)' : 'rgba(16,185,129,0.28)'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1.05rem', fontWeight: 800,
            color: isAdvisorMode ? '#60a5fa' : '#34d399',
          }}>
            {isAdvisorMode ? displayName[0]?.toUpperCase() : '👤'}
          </div>

          {/* 用户信息文字 */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, fontSize: '0.92rem', color: '#f1f5f9' }}>
                {isAdvisorMode ? displayName : '当前登录账号（本人）'}
              </span>
              {/* 操作类型 Badge */}
              <span style={{
                padding: '2px 8px', borderRadius: '4px', fontSize: '0.67rem', fontWeight: 700,
                background: isAdvisorMode ? 'rgba(239,68,68,0.15)' : 'rgba(16,185,129,0.15)',
                color: isAdvisorMode ? '#fca5a5' : '#34d399',
                border: `1px solid ${isAdvisorMode ? 'rgba(239,68,68,0.3)' : 'rgba(16,185,129,0.3)'}`,
              }}>
                {isAdvisorMode ? '⚡ 代客操作' : '✓ 本人'}
              </span>
            </div>
            <div style={{ fontSize: '0.71rem', color: 'rgba(255,255,255,0.38)', marginTop: '4px' }}>
              {isAdvisorMode ? (
                <>
                  {targetUserEmail && <span>📧 {targetUserEmail} &nbsp;&nbsp;</span>}
                  <span style={{ color: 'rgba(250,160,60,0.85)' }}>
                    保存后将覆盖该用户的 ILP 配置
                  </span>
                </>
              ) : (
                '此配置将保存至您的账号，应用于您名下所有 ILP 模拟'
              )}
            </div>
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'rgba(255,255,255,0.4)' }}>
            ⏳ 加载中…
          </div>
        ) : (
          <>
            {/* 受保人信息 */}
            <div style={{
              background: 'rgba(255,255,255,0.03)', borderRadius: '10px',
              padding: '16px', marginBottom: '14px',
              border: '1px solid rgba(255,255,255,0.07)'
            }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'rgba(255,255,255,0.45)', marginBottom: '12px', letterSpacing: '0.05em' }}>
                受保人信息
              </div>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '0.71rem', color: 'rgba(255,255,255,0.45)' }}>年龄</span>
                  <input type="number" min="0" max="80" value={config.age}
                    onChange={e => update('age', parseInt(e.target.value) || 0)}
                    style={inputStyle({ width: '64px' })} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '0.71rem', color: 'rgba(255,255,255,0.45)' }}>性别</span>
                  <select value={config.gender} onChange={e => update('gender', e.target.value)}
                    style={inputStyle({})}>
                    <option value="male">男</option>
                    <option value="female">女</option>
                  </select>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '0.71rem', color: 'rgba(255,255,255,0.45)' }}>吸烟</span>
                  <select value={config.smoker ? 'yes' : 'no'}
                    onChange={e => update('smoker', e.target.value === 'yes')}
                    style={inputStyle({})}>
                    <option value="no">否</option>
                    <option value="yes">是</option>
                  </select>
                </div>
              </div>
            </div>

            {/* 保费信息 */}
            <div style={{
              background: 'rgba(255,255,255,0.03)', borderRadius: '10px',
              padding: '16px', marginBottom: '14px',
              border: '1px solid rgba(255,255,255,0.07)'
            }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'rgba(255,255,255,0.45)', marginBottom: '12px', letterSpacing: '0.05em' }}>
                保费信息
              </div>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '0.71rem', color: 'rgba(255,255,255,0.45)' }}>整付保费</span>
                  <input type="number" min="0" step="10000" value={config.premium}
                    onChange={e => update('premium', e.target.value)}
                    style={inputStyle({ width: '130px' })} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '0.71rem', color: 'rgba(255,255,255,0.45)' }}>货币</span>
                  <select value={config.currency} onChange={e => update('currency', e.target.value)}
                    style={inputStyle({})}>
                    <option value="USD">USD</option>
                    <option value="HKD">HKD</option>
                    <option value="CNY">CNY</option>
                  </select>
                </div>
              </div>

              {/* 开户奖赏率 */}
              <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ fontSize: '0.71rem', color: 'rgba(255,255,255,0.45)', marginBottom: '8px' }}>
                  开户奖赏推广率（留空 = 系统按保费档位自动匹配）
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="number" min="0" max="10" step="0.1"
                    placeholder={`系统推荐 ${(getEnrollmentBonusRate(premium) * 100).toFixed(1)}%`}
                    value={config.enrollment_rate !== null ? (config.enrollment_rate * 100).toFixed(2) : ''}
                    onChange={e => {
                      const v = e.target.value;
                      update('enrollment_rate', v === '' ? null : Math.max(0, Math.min(10, parseFloat(v))) / 100);
                    }}
                    style={inputStyle({ width: '80px' })}
                  />
                  <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.85rem' }}>%</span>
                  {config.enrollment_rate !== null && (
                    <button onClick={() => update('enrollment_rate', null)}
                      style={{ background: 'transparent', color: 'rgba(255,255,255,0.35)',
                        cursor: 'pointer', fontSize: '0.78rem', padding: '2px 8px',
                        borderRadius: '4px', border: '1px solid rgba(255,255,255,0.1)' }}>
                      重置
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* 预览摘要 */}
            {premium > 0 && (
              <div style={{
                background: 'rgba(99,102,241,0.06)', borderRadius: '10px',
                padding: '14px', marginBottom: '14px',
                border: '1px solid rgba(99,102,241,0.15)'
              }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#818cf8', marginBottom: '10px' }}>预览摘要</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '0.82rem' }}>
                  <div style={{ color: 'rgba(255,255,255,0.55)' }}>身故赔偿（已缴保费 × 105%）</div>
                  <div style={{ textAlign: 'right', color: '#10b981', fontWeight: 700 }}>{fmt(sumAssured)}</div>
                  <div style={{ color: 'rgba(255,255,255,0.55)' }}>开户奖赏（推广率 {(enrollRate * 100).toFixed(1)}%）</div>
                  <div style={{ textAlign: 'right', color: '#f59e0b', fontWeight: 700 }}>{fmt(enrollBonus)}</div>
                </div>
              </div>
            )}

            {/* 错误提示 */}
            {error && (
              <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: '8px', padding: '10px 14px', color: '#fca5a5', fontSize: '0.85rem', marginBottom: '14px' }}>
                ⚠️ {error}
              </div>
            )}

            {/* 操作按钮 */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '4px' }}>
              <button onClick={onClose}
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.14)',
                  color: 'rgba(255,255,255,0.7)', padding: '9px 22px', borderRadius: '8px', cursor: 'pointer' }}>
                取消
              </button>
              <button onClick={handleSave} disabled={saving || saved}
                style={{
                  background: saved
                    ? 'linear-gradient(135deg, #10b981, #059669)'
                    : isAdvisorMode
                      ? 'linear-gradient(135deg, #3b82f6, #2563eb)'
                      : 'linear-gradient(135deg, #818cf8, #6366f1)',
                  border: 'none', color: '#fff',
                  padding: '9px 28px', borderRadius: '8px',
                  cursor: saving ? 'not-allowed' : 'pointer',
                  fontWeight: 600, transition: 'background 0.3s',
                  opacity: saving ? 0.7 : 1,
                }}>
                {saved ? '✓ 已保存' : saving ? '保存中…' : isAdvisorMode ? '保存至客户账号' : '保存配置'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const inputStyle = (extra = {}) => ({
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.12)',
  color: '#fff', borderRadius: '6px', padding: '7px 10px',
  fontSize: '0.88rem', ...extra,
});

export default ILPSettingsModal;
