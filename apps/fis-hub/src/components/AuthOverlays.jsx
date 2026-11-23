import React, { useState, useEffect } from 'react';
import { useLang } from '../i18n/langCore';


const API = '/api';

export function VerifyEmailOverlay({ token, onClose }) {
  const { t } = useLang();
  // result 为空 = 验证中；没有 token 直接是失败结果（无需在 effect 里同步 setState）。
  // 只存「服务端文案 / 兜底翻译 key」，翻译在渲染时做，这样切换语言不会重复请求验证接口。
  const [result, setResult] = useState(
    token ? null : { status: 'error', fallbackKey: 'auth.verifyFail' }
  );
  const status = result ? result.status : 'verifying';
  const message = result ? (result.serverText || t(result.fallbackKey)) : '';

  useEffect(() => {
    if (!token) return;

    fetch(`${API}/auth/verify-email?token=${token}`)
      .then(r => r.json().then(data => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (ok) {
          setResult({ status: 'success', serverText: data.message, fallbackKey: 'auth.verifySuccess' });
        } else {
          setResult({ status: 'error', serverText: data.detail, fallbackKey: 'auth.verifyFail' });
        }
      })
      .catch(() => {
        setResult({ status: 'error', fallbackKey: 'auth.errNetwork' });
      });
  }, [token]);

  return (
    <div style={overlayStyle}>
      <div style={panelStyle}>
        <div style={{ fontSize: 48, marginBottom: 20 }}>
          {status === 'verifying' ? '⏳' : status === 'success' ? '✅' : '❌'}
        </div>
        <h2 style={{ color: '#fff', marginBottom: 12 }}>
          {status === 'verifying' ? t('auth.verifying') : status === 'success' ? t('auth.verifySuccess') : t('auth.verifyFail')}
        </h2>
        <p style={{ color: 'rgba(255,255,255,0.6)', marginBottom: 24 }}>{message}</p>
        <button onClick={onClose} style={btnStyle}>{t('auth.verifyBtn')}</button>
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
    if (pwd.length < 6) { setError(t('auth.errPwdMin')); return; }
    if (pwd !== pwd2) { setError(t('auth.errPwdMatch')); return; }

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
        <div style={{ fontSize: 48, marginBottom: 20 }}>🔐</div>
        <h2 style={{ color: '#fff', marginBottom: 12 }}>{t('auth.resetTitle')}</h2>
        
        {success ? (
          <>
            <p style={{ color: '#4ade80', marginBottom: 24 }}>{success}</p>
            <button onClick={onClose} style={btnStyle}>{t('auth.resetBtn')}</button>
          </>
        ) : (
          <form onSubmit={handleReset} style={{ width: '100%' }}>
            <div style={{ marginBottom: 16, textAlign: 'left' }}>
              <label style={labelStyle}>{t('auth.resetLabel')}</label>
              <input 
                type="password" 
                value={pwd} 
                onChange={e => setPwd(e.target.value)} 
                style={inputStyle} 
                placeholder={t('auth.resetPlaceholder')}
              />
            </div>
            <div style={{ marginBottom: 20, textAlign: 'left' }}>
              <label style={labelStyle}>{t('auth.resetConfirmLabel')}</label>
              <input 
                type="password" 
                value={pwd2} 
                onChange={e => setPwd2(e.target.value)} 
                style={inputStyle} 
                placeholder={t('auth.resetConfirmPlaceholder')}
              />
            </div>
            {error && <p style={{ color: '#f87171', fontSize: 13, marginBottom: 16 }}>⚠️ {error}</p>}
            <button type="submit" disabled={loading} style={btnStyle}>
              {loading ? t('auth.resetSubmitting') : t('auth.resetSubmit')}
            </button>
            <button type="button" onClick={onClose} style={{ ...btnStyle, background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', marginTop: 12 }}>
              {t('common.cancel')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

const overlayStyle = {
  position: 'fixed', inset: 0, zIndex: 10000,
  background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(12px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
};

const panelStyle = {
  background: 'linear-gradient(150deg, #0f172a, #1e293b)',
  border: '1px solid rgba(99,102,241,0.25)',
  borderRadius: 20, padding: 40, textAlign: 'center',
  maxWidth: 400, width: '100%', boxShadow: '0 40px 100px rgba(0,0,0,0.5)'
};

const btnStyle = {
  width: '100%', padding: 12, borderRadius: 10, border: 'none',
  background: 'linear-gradient(135deg, #6366f1, #818cf8)',
  color: '#fff', fontWeight: 700, cursor: 'pointer'
};

const labelStyle = { display: 'block', color: 'rgba(255,255,255,0.5)', fontSize: 12, marginBottom: 8 };
const inputStyle = { 
  width: '100%', padding: 12, background: 'rgba(255,255,255,0.05)', 
  border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#fff', outline: 'none' 
};
