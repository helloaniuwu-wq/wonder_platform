import React from 'react';
import { useLang } from '../i18n/LangContext';
import { ShieldAlert } from 'lucide-react';

// ── 合规确认弹窗（首次进入时展示）──────────────────────────────────────────
export default function ComplianceGateModal({ onAcknowledge }) {
  const { t } = useLang();
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 99999,
      background: 'rgba(20, 20, 19, 0.72)',
      backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '16px',
    }}>
      <div style={{
        background: 'var(--surface-elevated)',
        border: '1px solid var(--border-strong)',
        borderTop: '3px solid var(--accent-color)',
        borderRadius: 'var(--card-radius)',
        padding: '36px 32px',
        maxWidth: '540px',
        width: '100%',
        boxShadow: '0 24px 60px rgba(0, 0, 0, 0.25)',
      }}>
        {/* 标题 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '24px' }}>
          <div style={{
            width: 44, height: 44, borderRadius: '6px',
            background: 'var(--warning-bg)',
            border: '1px solid var(--border-strong)',
            color: 'var(--accent-secondary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <ShieldAlert size={22} aria-hidden="true" />
          </div>
          <div>
            <h2 style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)', fontSize: '1.45rem', fontWeight: 700, margin: 0, lineHeight: 1.25 }}>
              {t('compliance.title')}
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '12px', margin: '4px 0 0' }}>
              {t('compliance.subtitle')} · Please read before proceeding
            </p>
          </div>
        </div>

        {/* 核心声明 */}
        <div style={{
          background: 'var(--surface-subtle)',
          border: '1px solid var(--border-subtle)',
          borderLeft: '3px solid var(--accent-secondary)',
          borderRadius: 'var(--card-radius)',
          padding: '16px 18px',
          marginBottom: '16px',
        }}>
          <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: 1.75, margin: 0 }}>
            <strong style={{ color: 'var(--accent-secondary)' }}>Wonder Wisdom. · </strong>
            {t('compliance.body')}
            <strong style={{ color: 'var(--text-primary)' }}>{t('compliance.bodyBold1')}</strong>
            {t('compliance.bodyMid')}
            <strong style={{ color: 'var(--text-primary)' }}>{t('compliance.bodyBold2')}</strong>
          </p>
        </div>

        <div style={{
          background: 'var(--surface-card)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--card-radius)',
          padding: '12px 18px',
          marginBottom: '24px',
        }}>
          <p style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.7, margin: 0 }}>
            {t('compliance.bodyEn')}
          </p>
        </div>

        {/* 确认按钮 */}
        <button
          id="compliance-acknowledge-btn"
          onClick={onAcknowledge}
          className="create-btn"
          style={{
            width: '100%',
            padding: '13px',
            fontSize: '14px',
            fontWeight: 700,
          }}
        >
          {t('compliance.btn')}
        </button>
        <p style={{ textAlign: 'center', fontSize: '11px', color: 'var(--text-muted)', marginTop: '12px', marginBottom: 0 }}>
          {t('compliance.footer')} · Continuing constitutes acceptance of the above terms
        </p>
      </div>
    </div>
  );
}
