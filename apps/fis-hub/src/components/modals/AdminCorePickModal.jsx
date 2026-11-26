import React, { useEffect, useState } from 'react';
import { Star, X, Trash2, Check } from 'lucide-react';
import { authHeaders } from '../../utils/auth';
import { ADMIN_CORE_PICK_REASONS } from '../../utils/fundQuantUtils';
import { useLang } from '../../i18n/langCore';

const GROUP_META = [
  { key: 'core', zh: '核心底仓定位', en: 'Core Sleeves' },
  { key: 'satellite', zh: '卫星配置定位', en: 'Satellite Sleeves' },
  { key: 'enhancer', zh: '因子与现金流增强', en: 'Style & Income Tilts' },
];

const AdminCorePickModal = ({ open, fund, onClose, onSaved }) => {
  const { lang } = useLang();
  const isEn = lang === 'en';
  const [selectedReasons, setSelectedReasons] = useState(() =>
    Array.isArray(fund?.admin_core_reasons) ? [...fund.admin_core_reasons] : []
  );
  const [note, setNote] = useState(() => fund?.admin_core_note || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  if (!open || !fund) return null;

  const isExisting = Boolean(fund.is_admin_core_pick);
  const toggleReason = (id) => {
    setSelectedReasons((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id].slice(0, 8)
    );
  };

  const handleSave = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/quant/funds/${encodeURIComponent(fund.slug)}/admin-core-pick`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          reasons: selectedReasons,
          note: note.trim(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.detail || json.error || `HTTP ${res.status}`);
      }
      onSaved?.(json);
      onClose?.();
    } catch (err) {
      setError(err?.message || (isEn ? 'Failed to save core pick' : '保存核心推荐失败'));
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/quant/funds/${encodeURIComponent(fund.slug)}/admin-core-pick`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.detail || json.error || `HTTP ${res.status}`);
      }
      onSaved?.(json);
      onClose?.();
    } catch (err) {
      setError(err?.message || (isEn ? 'Failed to remove core pick' : '取消核心推荐失败'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose?.()}>
      <div
        className="glass-card modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(560px, 95vw)', padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Star size={18} style={{ color: '#f59e0b', fill: isExisting ? '#f59e0b' : 'none' }} />
              <h2 style={{ margin: 0, fontSize: '1.12rem' }}>
                {isEn ? 'Admin Core Pick & Reason Tags' : '管理员核心推荐收藏与打标'}
              </h2>
            </div>
            <div style={{ marginTop: '6px', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--accent-color)', marginRight: '8px' }}>
                {fund.code || fund.slug}
              </span>
              <span>{fund.name}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => !busy && onClose?.()}
            className="action-btn-secondary"
            style={{ padding: '5px' }}
            aria-label="Close"
          >
            <X size={15} />
          </button>
        </div>

        <div
          style={{
            padding: '10px 12px',
            borderRadius: '6px',
            background: 'rgba(245, 158, 11, 0.08)',
            border: '1px solid rgba(245, 158, 11, 0.28)',
            fontSize: '0.78rem',
            color: 'var(--text-secondary)',
            lineHeight: 1.55,
          }}
        >
          {isEn
            ? 'Core-picked funds are selected first as primary candidates when the portfolio advisory engine runs and receive elevated target weights within their risk & tax-jurisdiction envelope.'
            : '设为「管理员核心推荐」后，组合推荐引擎运行时将在合规平台与风控上限内优先将其纳入首批候选，并赋予更高目标权重。'}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {GROUP_META.map((grp) => {
            const items = ADMIN_CORE_PICK_REASONS.filter((r) => r.group === grp.key);
            return (
              <div key={grp.key} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)' }}>
                  {isEn ? grp.en : grp.zh}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {items.map((item) => {
                    const active = selectedReasons.includes(item.id);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => toggleReason(item.id)}
                        aria-pressed={active}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '5px',
                          padding: '5px 12px',
                          borderRadius: '999px',
                          fontSize: '0.78rem',
                          fontWeight: active ? 700 : 500,
                          cursor: 'pointer',
                          border: active ? '1px solid rgba(245, 158, 11, 0.85)' : '1px solid var(--border-subtle)',
                          background: active ? 'rgba(245, 158, 11, 0.16)' : 'var(--surface-subtle)',
                          color: active ? '#d97706' : 'var(--text-secondary)',
                        }}
                      >
                        {active && <Check size={12} />}
                        <span>{isEn ? item.labelEn : item.labelZh}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontSize: '0.76rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
            {isEn ? 'Admin Note (Optional)' : '推荐备注（可选，最多 200 字）'}
          </label>
          <input
            type="text"
            maxLength={200}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={isEn ? 'e.g. Institutional core US S&P 500 anchor (0.07% TER)' : '例如：机构首选美股压舱底仓，极低费率 0.07%'}
            className="atelier-input"
            style={{ width: '100%' }}
          />
        </div>

        {error && (
          <div style={{ fontSize: '0.8rem', color: 'var(--danger)', background: 'var(--danger-bg)', padding: '8px 10px', borderRadius: '4px' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap', paddingTop: '4px' }}>
          <div>
            {isExisting && (
              <button
                type="button"
                onClick={handleRemove}
                disabled={busy}
                className="action-btn-secondary"
                style={{ fontSize: '0.78rem', color: 'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.4)' }}
              >
                <Trash2 size={13} /> {isEn ? 'Remove Pick' : '取消核心推荐'}
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="action-btn-secondary"
              style={{ fontSize: '0.8rem' }}
            >
              {isEn ? 'Cancel' : '取消'}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={busy}
              className="create-btn"
              style={{ fontSize: '0.8rem', padding: '7px 16px' }}
            >
              <Star size={13} style={{ fill: 'currentColor' }} />
              {busy
                ? (isEn ? 'Saving...' : '保存中…')
                : (isEn ? 'Save Core Pick' : '保存核心推荐')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminCorePickModal;
