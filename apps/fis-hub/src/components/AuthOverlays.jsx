import React, { useState, useEffect } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  KeyRound,
  MailCheck,
  Loader2,
} from 'lucide-react';
import { useLang } from '../i18n/langCore';

const API = '/api';

export function VerifyEmailOverlay({ token, onClose }) {
  const { t } = useLang();
  const [result, setResult] = useState(
    token ? null : { status: 'error', fallbackKey: 'auth.verifyFail' }
  );
  const status = result ? result.status : 'verifying';
  const message = result ? result.serverText || t(result.fallbackKey) : '';

  useEffect(() => {
    if (!token) return;

    fetch(`${API}/auth/verify-email?token=${token}`)
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (ok) {
          setResult({
            status: 'success',
            serverText: data.message,
            fallbackKey: 'auth.verifySuccess',
          });
        } else {
          setResult({
            status: 'error',
            serverText: data.detail,
            fallbackKey: 'auth.verifyFail',
          });
        }
      })
      .catch(() => {
        setResult({ status: 'error', fallbackKey: 'auth.errNetwork' });
      });
  }, [token]);

  return (
    <div style={overlayStyle}>
      <div style={panelStyle}>
        <div
          style={{
            ...iconBadgeStyle,
            margin: '0 auto 16px',
            color:
              status === 'success'
                ? 'var(--success)'
                : status === 'error'
                  ? 'var(--danger)'
                  : 'var(--accent-secondary)',
            background:
              status === 'success'
                ? 'var(--success-bg)'
                : status === 'error'
                  ? 'var(--danger-bg)'
                  : 'var(--warning-bg)',
          }}
        >
          {status === 'verifying' ? (
            <Loader2 size={22} className="animate-spin" />
          ) : status === 'success' ? (
            <MailCheck size={22} />
          ) : (
            <AlertTriangle size={22} />
          )}
        </div>

        <div style={eyebrowStyle}>WONDER WISDOM · PORTFOLIO ATELIER</div>
        <h2 style={headingStyle}>
          {status === 'verifying'
            ? t('auth.verifying')
            : status === 'success'
              ? t('auth.verifySuccess')
              : t('auth.verifyFail')}
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6, margin: '10px 0 22px' }}>
          {message}
        </p>
        <button type="button" onClick={onClose} className="create-btn" style={{ width: '100%' }}>
          {t('auth.verifyBtn')}
        </button>
      </div>
    </div>
  );
}

export function ResetPasswordOverlay({ token, onClose }) {
  const { t } = useLang();
  const [pwd, setPwd] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleReset = async (e) => {
    e.preventDefault();
    if (pwd.length < 6) {
      setError(t('auth.errPwdMin'));
      return;
    }
    if (pwd !== pwd2) {
      setError(t('auth.errPwdMatch'));
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, new_password: pwd }),
      });
      const data = await res.json();
      if (res.ok) {
        setSuccess(t('auth.resetSuccess'));
      } else {
        setError(data.detail || t('auth.errLoginFail'));
      }
    } catch {
      setError(t('auth.errNetwork'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={overlayStyle}>
      <div style={panelStyle}>
        <div style={{ ...iconBadgeStyle, margin: '0 auto 16px' }}>
          <KeyRound size={22} />
        </div>
        <div style={eyebrowStyle}>WONDER WISDOM · PORTFOLIO ATELIER</div>
        <h2 style={{ ...headingStyle, marginBottom: 18 }}>{t('auth.resetTitle')}</h2>

        {success ? (
          <>
            <div
              style={{
                padding: '12px 14px',
                background: 'var(--success-bg)',
                border: '1px solid var(--success)',
                borderLeft: '3px solid var(--success)',
                borderRadius: 'var(--card-radius, 6px)',
                color: 'var(--success)',
                fontSize: 13,
                fontWeight: 600,
                marginBottom: 20,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              <CheckCircle2 size={16} />
              <span>{success}</span>
            </div>
            <button type="button" onClick={onClose} className="create-btn" style={{ width: '100%' }}>
              {t('auth.resetBtn')}
            </button>
          </>
        ) : (
          <form onSubmit={handleReset} style={{ width: '100%', textAlign: 'left' }}>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>{t('auth.resetLabel')}</label>
              <input
                type="password"
                value={pwd}
                onChange={(e) => setPwd(e.target.value)}
                className="atelier-input"
                style={inputStyle}
                placeholder={t('auth.resetPlaceholder')}
              />
            </div>
            <div style={{ marginBottom: 18 }}>
              <label style={labelStyle}>{t('auth.resetConfirmLabel')}</label>
              <input
                type="password"
                value={pwd2}
                onChange={(e) => setPwd2(e.target.value)}
                className="atelier-input"
                style={inputStyle}
                placeholder={t('auth.resetConfirmPlaceholder')}
              />
            </div>
            {error && (
              <div
                style={{
                  padding: '10px 12px',
                  background: 'var(--danger-bg)',
                  border: '1px solid var(--danger)',
                  borderLeft: '3px solid var(--danger)',
                  borderRadius: 'var(--card-radius, 6px)',
                  color: 'var(--danger)',
                  fontSize: 12.5,
                  fontWeight: 600,
                  marginBottom: 16,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <AlertTriangle size={15} />
                <span>{error}</span>
              </div>
            )}
            <button
              type="submit"
              disabled={loading}
              className="create-btn"
              style={{ width: '100%', padding: '12px 16px' }}
            >
              {loading ? t('auth.resetSubmitting') : t('auth.resetSubmit')}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="action-btn-secondary"
              style={{ width: '100%', marginTop: 10, padding: '10px 16px' }}
            >
              {t('common.cancel')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

const overlayStyle = {
  position: 'fixed',
  inset: 0,
  zIndex: 10000,
  background: 'rgba(20, 20, 19, 0.72)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 20,
};

const panelStyle = {
  background: 'var(--surface-elevated)',
  border: '1px solid var(--border-strong)',
  borderTop: '3px solid var(--accent-color)',
  borderRadius: 'var(--card-radius, 6px)',
  padding: '32px 28px',
  textAlign: 'center',
  maxWidth: 420,
  width: '100%',
  boxShadow: '0 24px 60px rgba(0, 0, 0, 0.28)',
};

const iconBadgeStyle = {
  width: 46,
  height: 46,
  borderRadius: 'var(--card-radius, 6px)',
  background: 'var(--warning-bg)',
  border: '1px solid var(--border-strong)',
  color: 'var(--accent-secondary)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const eyebrowStyle = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '0.1em',
  color: 'var(--accent-secondary)',
  textTransform: 'uppercase',
  marginBottom: 4,
};

const headingStyle = {
  margin: 0,
  fontFamily: 'var(--font-display)',
  fontSize: '1.5rem',
  fontWeight: 700,
  color: 'var(--text-primary)',
  letterSpacing: '-0.02em',
};

const labelStyle = {
  display: 'block',
  color: 'var(--text-secondary)',
  fontSize: 11.5,
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  marginBottom: 6,
};

const inputStyle = {
  width: '100%',
  height: 40,
  padding: '9px 12px',
  background: 'var(--surface-card)',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--card-radius, 6px)',
  color: 'var(--text-primary)',
  fontSize: 13.5,
  outline: 'none',
  boxSizing: 'border-box',
};
