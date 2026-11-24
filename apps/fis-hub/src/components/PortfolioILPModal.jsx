import React, { useState } from 'react';
import { authHeaders } from '../utils/auth';
import { getEnrollmentBonusRate, lookupCOI, normalizeIlpGender } from '../utils/ilpConfigCalc';

/**
 * PortfolioILPModal — 「我的组合」专属投连险受保人（性别/年龄）与费率匹配设置弹窗。
 * 每个组合独立保存至 portfolio_ilp_config，不再套用全局单一账号默认值。
 */
const PortfolioILPModal = ({
  open,
  onClose,
  portfolioId,
  portfolioName,
  baseCurrency = 'USD',
  suggestedPremium = 100000,
  initialConfig = null,
  canEdit = false,
  onSaved,
}) => {
  const buildDraft = (cfg) => ({
    age: cfg?.age != null ? Number(cfg.age) : 35,
    gender: normalizeIlpGender(cfg?.gender),
    smoker: Boolean(cfg?.smoker),
    totalPremium:
      cfg?.totalPremium > 0
        ? Number(cfg.totalPremium)
        : Math.max(1000, Math.round(Number(suggestedPremium) || 100000)),
    currency: cfg?.currency || baseCurrency || 'USD',
    enrollmentRate:
      cfg?.enrollmentRate !== undefined && cfg?.enrollmentRate !== null
        ? Number(cfg.enrollmentRate)
        : null,
  });

  const [form, setForm] = useState(() => buildDraft(initialConfig));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // React 官方推荐渲染期按 key 重置弹窗草稿，避免 effect 内同步 setState
  const resetKey = open
    ? `${portfolioId}|${initialConfig?.configured ? '1' : '0'}|${initialConfig?.updated_at || ''}`
    : null;
  const [syncedKey, setSyncedKey] = useState(null);
  if (resetKey !== syncedKey) {
    setSyncedKey(resetKey);
    if (resetKey) {
      setForm(buildDraft(initialConfig));
      setError('');
    }
  }

  if (!open) return null;

  const safeAge = Math.max(0, Math.min(80, Math.round(Number(form.age) || 0)));
  const normGender = normalizeIlpGender(form.gender);
  const coiRate = lookupCOI(safeAge, normGender);
  const premium = Math.max(0, Number(form.totalPremium) || 0);
  const sumAssured = premium * 1.05;
  const enrollRate =
    form.enrollmentRate !== null && form.enrollmentRate !== undefined
      ? form.enrollmentRate
      : getEnrollmentBonusRate(premium);
  const enrollBonus = premium * enrollRate;
  const fmt = (v) => '$' + Math.round(v).toLocaleString();

  const handleSave = async (nextEnabled = true) => {
    setSaving(true);
    setError('');
    const payload = {
      enabled: nextEnabled,
      age: safeAge,
      gender: normGender,
      smoker: Boolean(form.smoker),
      premium,
      currency: form.currency || baseCurrency || 'USD',
      enrollment_rate:
        form.enrollmentRate !== null && form.enrollmentRate !== undefined
          ? Number(form.enrollmentRate)
          : null,
    };

    try {
      let savedResult = {
        ...payload,
        configured: true,
        totalPremium: payload.premium,
        enrollmentRate: payload.enrollment_rate,
        updated_at: new Date().toISOString(),
      };

      if (canEdit && portfolioId) {
        const res = await fetch(`/api/portfolios/${portfolioId}/ilp-config`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify(payload),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(json.detail || `HTTP ${res.status}`);
        }
        savedResult = {
          configured: true,
          enabled: Boolean(json.enabled),
          age: Number(json.age ?? safeAge),
          gender: normalizeIlpGender(json.gender),
          smoker: Boolean(json.smoker),
          totalPremium: Number(json.premium ?? premium),
          currency: json.currency || payload.currency,
          enrollmentRate: json.enrollment_rate ?? null,
          updated_at: json.updated_at || new Date().toISOString(),
        };
      }

      onSaved?.(savedResult);
      onClose?.();
    } catch (e) {
      setError(`保存失败：${e?.message || '请求异常'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose?.();
      }}
    >
      <div
        className="glass-card modal-content"
        style={{ maxWidth: '540px', width: '95vw', maxHeight: '92vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', marginBottom: '14px' }}>
          <div>
            <div style={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color: 'var(--accent-color)', fontWeight: 700, marginBottom: '4px' }}>
              PER-PORTFOLIO ILP INSURED PROFILE
            </div>
            <h3 style={{ margin: 0, fontSize: '1.15rem' }}>
              投连险受保人与费率适配 · {portfolioName || `组合 #${portfolioId}`}
            </h3>
          </div>
          <button
            type="button"
            aria-label="关闭弹窗"
            onClick={onClose}
            disabled={saving}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: '1.2rem', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>

        {!canEdit && (
          <div
            style={{
              marginBottom: '14px',
              padding: '8px 12px',
              borderRadius: '6px',
              background: 'rgba(245, 158, 11, 0.12)',
              border: '1px solid rgba(245, 158, 11, 0.35)',
              color: 'var(--warning, #d97706)',
              fontSize: '0.78rem',
            }}
          >
            当前为只读/访客预览模式：确认后仅在当前页面实时试算该组合 ILP 费率，不会覆盖原组合数据库配置。
          </div>
        )}

        {/* 受保人性别 & 年龄选择 */}
        <div
          style={{
            background: 'var(--surface-subtle)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '8px',
            padding: '14px 16px',
            marginBottom: '14px',
          }}
        >
          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '10px' }}>
            一 · 受保人信息（匹配 AIA 逐龄分性别 COI 费率表）
          </div>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label>受保人性别</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {[
                  { value: 'male', label: '男 (Male)' },
                  { value: 'female', label: '女 (Female)' },
                ].map((opt) => {
                  const active = normGender === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setForm((prev) => ({ ...prev, gender: opt.value }))}
                      style={{
                        padding: '8px 10px',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: active ? 700 : 500,
                        fontSize: '0.84rem',
                        border: active ? '1px solid var(--accent-color)' : '1px solid var(--border-subtle)',
                        background: active ? 'rgba(var(--accent-color-rgb), 0.14)' : 'var(--surface-card)',
                        color: active ? 'var(--accent-color)' : 'var(--text-secondary)',
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="form-group" style={{ flex: 0.7 }}>
              <label>投保年龄 (0–80 岁)</label>
              <input
                type="number"
                min={0}
                max={80}
                value={form.age}
                onChange={(e) => setForm((prev) => ({ ...prev, age: parseInt(e.target.value, 10) || 0 }))}
              />
            </div>

            <div className="form-group" style={{ flex: 0.7 }}>
              <label>吸烟状况</label>
              <select
                value={form.smoker ? 'yes' : 'no'}
                onChange={(e) => setForm((prev) => ({ ...prev, smoker: e.target.value === 'yes' }))}
              >
                <option value="no">非吸烟</option>
                <option value="yes">吸烟</option>
              </select>
            </div>
          </div>
        </div>

        {/* 保费与开户奖赏 */}
        <div
          style={{
            background: 'var(--surface-subtle)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '8px',
            padding: '14px 16px',
            marginBottom: '14px',
          }}
        >
          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '10px' }}>
            二 · 整付保费与开户奖赏
          </div>
          <div className="form-row">
            <div className="form-group" style={{ flex: 1.4 }}>
              <label>整付保费 ({form.currency})</label>
              <input
                type="number"
                min={0}
                step={10000}
                value={form.totalPremium}
                onChange={(e) => setForm((prev) => ({ ...prev, totalPremium: e.target.value }))}
              />
            </div>
            <div className="form-group" style={{ flex: 0.8 }}>
              <label>保单货币</label>
              <select
                value={form.currency}
                onChange={(e) => setForm((prev) => ({ ...prev, currency: e.target.value }))}
              >
                <option value="USD">USD</option>
                <option value="HKD">HKD</option>
                <option value="CNY">CNY</option>
                <option value="SGD">SGD</option>
                <option value="EUR">EUR</option>
              </select>
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label>开户奖赏率 %（空=自动）</label>
              <input
                type="number"
                min={0}
                max={10}
                step={0.1}
                placeholder={`自动 ${(getEnrollmentBonusRate(premium) * 100).toFixed(1)}%`}
                value={
                  form.enrollmentRate !== null && form.enrollmentRate !== undefined
                    ? (Number(form.enrollmentRate) * 100).toFixed(1)
                    : ''
                }
                onChange={(e) => {
                  const v = e.target.value;
                  setForm((prev) => ({
                    ...prev,
                    enrollmentRate: v === '' ? null : Math.max(0, Math.min(10, parseFloat(v) || 0)) / 100,
                  }));
                }}
              />
            </div>
          </div>
        </div>

        {/* 实时费率匹配预览 */}
        <div
          style={{
            background: 'rgba(var(--accent-color-rgb), 0.06)',
            border: '1px solid var(--accent-color)',
            borderRadius: '8px',
            padding: '12px 14px',
            marginBottom: '16px',
            fontSize: '0.82rem',
          }}
        >
          <div style={{ fontWeight: 700, color: 'var(--accent-color)', marginBottom: '8px' }}>
            实时匹配费率预览（{safeAge} 岁 · {normGender === 'female' ? '女' : '男'}）
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '5px 14px' }}>
            <span style={{ color: 'var(--text-secondary)' }}>匹配 COI 保险成本年率</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--accent-color)' }}>
              ${coiRate.toFixed(2)} / $1,000 风险额·年 ({(coiRate / 10).toFixed(3)}%/年)
            </span>
            <span style={{ color: 'var(--text-secondary)' }}>前期行政费（首 5 年）</span>
            <span style={{ fontFamily: 'var(--font-mono)' }}>1.35% / 年</span>
            <span style={{ color: 'var(--text-secondary)' }}>户口价值费（全期）</span>
            <span style={{ fontFamily: 'var(--font-mono)' }}>1.00% / 年</span>
            <span style={{ color: 'var(--text-secondary)' }}>身故保障额（105% 已缴保费）</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{fmt(sumAssured)}</span>
            <span style={{ color: 'var(--text-secondary)' }}>开户奖赏（{(enrollRate * 100).toFixed(1)}%）</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--success)' }}>
              +{fmt(enrollBonus)}
            </span>
          </div>
        </div>

        {error && (
          <div
            style={{
              marginBottom: '12px',
              padding: '8px 12px',
              borderRadius: '6px',
              background: 'var(--danger-bg, rgba(239, 68, 68, 0.1))',
              color: 'var(--danger, #ef4444)',
              fontSize: '0.8rem',
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button
            type="button"
            disabled={saving}
            onClick={() => handleSave(true)}
            className="create-btn"
            style={{ flex: 1, justifyContent: 'center' }}
          >
            {saving ? '正在匹配并保存...' : '确认并应用到本组合'}
          </button>
          {initialConfig?.configured && initialConfig?.enabled && (
            <button
              type="button"
              disabled={saving}
              onClick={() => handleSave(false)}
              className="action-btn-secondary"
            >
              关闭本组合 ILP 适配
            </button>
          )}
          <button type="button" disabled={saving} onClick={onClose} className="action-btn-secondary">
            取消
          </button>
        </div>
      </div>
    </div>
  );
};

export default PortfolioILPModal;
