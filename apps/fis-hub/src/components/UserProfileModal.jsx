import React, { useState } from 'react';
import {
  Mail,
  User,
  CheckCircle2,
  AlertTriangle,
  Send,
  Save,
  X,
  ShieldCheck,
  RefreshCw,
} from 'lucide-react';
import { authStorage, authHeaders } from '../utils/auth';
import { useLang } from '../i18n/langCore';

const API = '/api';

export default function UserProfileModal({ currentUser, onUpdateUser, onClose }) {
  const { t } = useLang();
  const [name, setName] = useState(currentUser?.name || '');
  const [email, setEmail] = useState(currentUser?.email || '');
  const [isVerified, setIsVerified] = useState(Boolean(currentUser?.is_verified));
  const [saving, setSaving] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSave = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!name.trim()) {
      setError(t('auth.errNameReq'));
      return;
    }
    if (!email.trim() || !/\S+@\S+\.\S+/.test(email.trim())) {
      setError(t('auth.errEmailInvalid'));
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`${API}/auth/profile`, {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          redirect_url: window.location.origin,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || '更新个人信息失败');
      }

      setSuccess(data.message || t('auth.profileUpdated'));
      if (data.user) {
        authStorage.setUser(data.user);
        setIsVerified(Boolean(data.user.is_verified));
        onUpdateUser?.(data.user);
      }
    } catch (err) {
      setError(err.message || t('auth.errNetwork'));
    } finally {
      setSaving(false);
    }
  };

  const handleResend = async () => {
    setError('');
    setSuccess('');
    setResending(true);
    try {
      const res = await fetch(`${API}/auth/resend-verification`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ redirect_url: window.location.origin }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || '发送验证邮件失败');
      }
      setSuccess(data.message || t('auth.resendVerifySuccess'));
    } catch (err) {
      setError(err.message || t('auth.errNetwork'));
    } finally {
      setResending(false);
    }
  };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        {/* 关闭按钮 */}
        <button
          type="button"
          onClick={onClose}
          style={{
            position: 'absolute',
            top: 18,
            right: 18,
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            padding: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <X size={18} />
        </button>

        {/* 顶部图标与标题 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 8,
              background: 'var(--accent-secondary, #9A6F38)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <User size={20} />
          </div>
          <div>
            <div style={{ fontSize: 10, letterSpacing: '0.08em', fontWeight: 700, color: 'var(--text-muted)' }}>
              WONDER WISDOM · PROFILE
            </div>
            <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--text-primary)' }}>
              {t('auth.profileTitle')}
            </h3>
          </div>
        </div>

        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 16px', lineHeight: 1.5 }}>
          {t('auth.profileSubtitle')}
        </p>

        {/* 状态通知 */}
        {error && (
          <div style={{ ...alertStyle, background: 'var(--danger-bg)', borderColor: 'var(--danger)', color: 'var(--danger)' }}>
            <AlertTriangle size={15} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}
        {success && (
          <div style={{ ...alertStyle, background: 'var(--success-bg)', borderColor: 'var(--success)', color: 'var(--success)' }}>
            <CheckCircle2 size={15} style={{ flexShrink: 0 }} />
            <span>{success}</span>
          </div>
        )}

        {/* 邮箱验证状态卡片 */}
        <div
          style={{
            background: isVerified ? 'var(--success-bg)' : 'var(--warning-bg)',
            border: `1px solid ${isVerified ? 'var(--success)' : 'var(--warning)'}`,
            borderRadius: 'var(--card-radius, 6px)',
            padding: '12px 14px',
            marginBottom: 18,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {isVerified ? (
              <CheckCircle2 size={18} style={{ color: 'var(--success)' }} />
            ) : (
              <AlertTriangle size={18} style={{ color: 'var(--warning)' }} />
            )}
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: isVerified ? 'var(--success)' : 'var(--warning)' }}>
                {isVerified ? t('auth.verifyStatusVerified') : t('auth.verifyStatusUnverified')}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                {isVerified ? '您的邮箱已通过安全验证' : '邮箱未验证可能影响重要通知接收'}
              </div>
            </div>
          </div>

          {!isVerified && (
            <button
              type="button"
              onClick={handleResend}
              disabled={resending}
              className="action-btn-secondary"
              style={{
                fontSize: 11,
                padding: '5px 10px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                flexShrink: 0,
              }}
            >
              {resending ? <RefreshCw size={12} className="animate-spin" /> : <Send size={12} />}
              {resending ? t('auth.resendingVerify') : t('auth.resendVerify')}
            </button>
          )}
        </div>

        {/* 表单 */}
        <form onSubmit={handleSave}>
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>
              {t('auth.regNameLabel')}
            </label>
            <div style={{ position: 'relative' }}>
              <User size={15} style={inputIconStyle} />
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('auth.regNamePlaceholder')}
                className="atelier-input"
                style={{ width: '100%', paddingLeft: 34, boxSizing: 'border-box' }}
                disabled={saving}
              />
            </div>
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>
              {t('auth.emailLabel')}
            </label>
            <div style={{ position: 'relative' }}>
              <Mail size={15} style={inputIconStyle} />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('auth.emailPlaceholder')}
                className="atelier-input"
                style={{ width: '100%', paddingLeft: 34, boxSizing: 'border-box' }}
                disabled={saving}
              />
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              * 若修改电子邮箱，系统将自动重新向新邮箱发送验证邮件并要求重新验证。
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onClose}
              className="action-btn-secondary"
              style={{ padding: '8px 16px', fontSize: 13 }}
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving}
              className="create-btn"
              style={{
                padding: '8px 18px',
                fontSize: 13,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Save size={14} />
              {saving ? t('auth.savingProfile') : t('auth.saveProfile')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const overlayStyle = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(10, 25, 47, 0.65)',
  backdropFilter: 'blur(6px)',
  zIndex: 1000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
};

const panelStyle = {
  position: 'relative',
  background: 'var(--surface-elevated, #fff)',
  border: '1px solid var(--border-strong, #e2e8f0)',
  borderTop: '3px solid var(--accent-color, #1B4D3E)',
  borderRadius: 'var(--card-radius, 8px)',
  padding: '28px 26px 24px',
  width: '100%',
  maxWidth: 440,
  boxShadow: 'var(--card-shadow, 0 20px 40px rgba(0,0,0,0.18))',
};

const labelStyle = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text-primary)',
  marginBottom: 6,
};

const inputIconStyle = {
  position: 'absolute',
  left: 11,
  top: '50%',
  transform: 'translateY(-50%)',
  color: 'var(--text-muted)',
  pointerEvents: 'none',
};

const alertStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 12px',
  borderRadius: 'var(--card-radius, 6px)',
  border: '1px solid',
  fontSize: 12,
  marginBottom: 14,
  lineHeight: 1.45,
};