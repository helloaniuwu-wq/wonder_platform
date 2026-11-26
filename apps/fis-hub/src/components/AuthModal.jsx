import React, { useState, useEffect, useCallback } from 'react';
import {
  KeyRound,
  UserPlus,
  Mail,
  Eye,
  EyeOff,
  X,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  RotateCcw,
} from 'lucide-react';
import { authStorage } from '../utils/auth';
import { useLang } from '../i18n/langCore';

const API = '/api';

/* ── 主组件：FIS · Portfolio & Strategy Atelier 统一视觉认证弹窗 ── */
export default function AuthModal({ onSuccess, onClose }) {
  const { t } = useLang();
  const [mode, setMode] = useState('login'); // 'login' | 'register' | 'forgot'

  const calcStrength = (pwd) => {
    if (!pwd) return { score: 0, label: '', color: 'var(--border-strong)' };
    let score = 0;
    if (pwd.length >= 8) score++;
    if (pwd.length >= 12) score++;
    if (/[A-Z]/.test(pwd)) score++;
    if (/[0-9]/.test(pwd)) score++;
    if (/[^A-Za-z0-9]/.test(pwd)) score++;
    const levels = [
      { label: t('auth.pwdVeryWeak'), color: 'var(--danger)' },
      { label: t('auth.pwdWeak'), color: 'var(--warning)' },
      { label: t('auth.pwdNormal'), color: 'var(--accent-secondary)' },
      { label: t('auth.pwdStrong'), color: 'var(--info)' },
      { label: t('auth.pwdVeryStrong'), color: 'var(--success)' },
    ];
    const lvl = levels[Math.min(score, 4)];
    return { score, label: lvl.label, color: lvl.color };
  };

  // ── 登录字段 ──
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPwd, setLoginPwd] = useState('');
  const [showLoginPwd, setShowLoginPwd] = useState(false);

  // ── 注册字段 ──
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPwd, setRegPwd] = useState('');
  const [regPwd2, setRegPwd2] = useState('');
  const [showRegPwd, setShowRegPwd] = useState(false);
  const [showRegPwd2, setShowRegPwd2] = useState(false);
  const [agreedTerms, setAgreedTerms] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const pwdStrength = calcStrength(regPwd);
  const pwdMatch = regPwd2 ? regPwd === regPwd2 : null;

  /* ── ESC 关闭 ── */
  useEffect(() => {
    const h = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  /* ── 切换模式时清空 ── */
  const switchMode = (m) => {
    setMode(m);
    setError('');
    setSuccess('');
  };

  /* ── 提交登录 / 注册 ── */
  const handleSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      setError('');

      const validateLogin = () => {
        if (!loginEmail.trim()) return t('auth.errEmailReq');
        if (!loginPwd) return t('auth.errPwdReq');
        return null;
      };

      const validateRegister = () => {
        if (!regName.trim()) return t('auth.errNameReq');
        if (!regEmail.trim()) return t('auth.errEmailReq');
        if (!/\S+@\S+\.\S+/.test(regEmail)) return t('auth.errEmailInvalid');
        if (regPwd.length < 6) return t('auth.errPwdMin');
        if (regPwd !== regPwd2) return t('auth.errPwdMatch');
        if (!agreedTerms) return t('auth.errTermsReq');
        return null;
      };

      const err = mode === 'login' ? validateLogin() : validateRegister();
      if (err) {
        setError(err);
        return;
      }

      setLoading(true);
      try {
        const url = mode === 'login' ? `${API}/auth/login` : `${API}/auth/register`;
        const body =
          mode === 'login'
            ? { email: loginEmail.trim(), password: loginPwd }
            : {
                email: regEmail.trim(),
                name: regName.trim(),
                password: regPwd,
                redirect_url: window.location.origin,
              };

        let data;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        data = await res.json();

        if (!res.ok) {
          setError(data.detail || (mode === 'login' ? t('auth.errLoginFail') : t('auth.errRegFail')));
          return;
        }

        if (mode === 'register') {
          const loginRes = await fetch(`${API}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: body.email, password: body.password }),
          });
          data = await loginRes.json();
          if (!loginRes.ok) {
            setError(t('auth.errAutoLoginFail'));
            return;
          }
        }

        const tokenValue = data.access_token || data.token;
        if (!tokenValue) {
          setError(t('auth.errNoToken'));
          return;
        }
        authStorage.setToken(tokenValue);

        let userInfo;
        try {
          const meRes = await fetch(`${API}/auth/me`, {
            headers: { Authorization: `Bearer ${tokenValue}` },
          });
          userInfo = meRes.ok ? await meRes.json() : null;
        } catch {
          userInfo = null;
        }

        const user = userInfo || {
          id: data.user_id || data.id,
          email: data.email || (mode === 'login' ? loginEmail : regEmail),
          role: data.role,
          name: data.name,
        };
        authStorage.setUser(user);

        if (mode === 'register') {
          setSuccess(`${t('auth.regSuccess')}${user.name}`);
          setTimeout(() => onSuccess(user), 1200);
        } else {
          onSuccess(user);
        }
      } catch {
        setError(t('auth.errNetwork'));
      } finally {
        setLoading(false);
      }
    },
    [t, mode, loginEmail, loginPwd, regEmail, regPwd, regPwd2, regName, agreedTerms, onSuccess]
  );

  const ModeIcon = mode === 'register' ? UserPlus : mode === 'forgot' ? RotateCcw : KeyRound;

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          ...panelStyle,
          maxWidth: mode === 'register' ? 490 : 440,
        }}
      >
        {/* 顶部右上关闭按钮 */}
        <button
          type="button"
          onClick={onClose}
          style={closeBtnStyle}
          aria-label="Close authentication modal"
          title="关闭 (Esc)"
        >
          <X size={16} />
        </button>

        {/* ── 品牌与头部（对齐 ComplianceGateModal & Sidebar Portfolio Atelier 风格）── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 20 }}>
          <div style={iconBadgeStyle}>
            <ModeIcon size={20} aria-hidden="true" />
          </div>
          <div style={{ flex: 1, minWidth: 0, paddingRight: 24 }}>
            <div style={eyebrowStyle}>
              WONDER WISDOM · PORTFOLIO ATELIER
            </div>
            <h2 style={headingStyle}>
              {mode === 'login'
                ? t('auth.welcome')
                : mode === 'register'
                  ? t('auth.createAccount')
                  : t('auth.tabForgot')}
            </h2>
            <p style={subHeadingStyle}>
              {t('auth.platformTitle')}
            </p>
          </div>
        </div>

        {/* ── 模式分段切换器（对齐全站 .lab-segmented 画廊分段器）── */}
        <div
          className="lab-segmented"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            width: '100%',
            marginBottom: 20,
          }}
        >
          {[
            { id: 'login', label: t('auth.tabLogin') },
            { id: 'register', label: t('auth.tabRegister') },
            { id: 'forgot', label: t('auth.tabForgot') },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={mode === item.id}
              onClick={() => switchMode(item.id)}
              style={{
                justifyContent: 'center',
                fontWeight: mode === item.id ? 700 : 500,
                fontSize: 12.5,
                padding: '7px 10px',
              }}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* ══════════════════ 找回密码表单 ══════════════════ */}
        {mode === 'forgot' && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setError('');
              setSuccess('');
              if (!loginEmail.trim()) {
                setError(t('auth.errEmailReq'));
                return;
              }
              setLoading(true);
              try {
                const res = await fetch(`${API}/auth/forgot-password`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    email: loginEmail.trim(),
                    redirect_url: window.location.origin,
                  }),
                });
                const data = await res.json();
                if (res.ok) {
                  setSuccess(t('auth.forgotSuccess'));
                } else {
                  setError(data.detail || '请求失败');
                }
              } catch {
                setError('网络错误');
              } finally {
                setLoading(false);
              }
            }}
            noValidate
          >
            <div style={infoCalloutStyle}>
              <Mail size={15} style={{ color: 'var(--accent-secondary)', flexShrink: 0, marginTop: 2 }} />
              <span>{t('auth.forgotDesc')}</span>
            </div>

            <Field label={t('auth.emailLabel')}>
              <input
                autoFocus
                type="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder={t('auth.emailPlaceholder')}
                className="atelier-input"
                style={inputStyle}
              />
            </Field>

            <ErrorBox msg={error} />
            <SuccessBox msg={success} />

            <SubmitBtn
              loading={loading}
              label={t('auth.btnForgot')}
              loadingLabel={t('auth.btnSending')}
            />

            <div style={footerSwitchStyle}>
              <button type="button" onClick={() => switchMode('login')} style={linkBtnStyle}>
                {t('auth.backToLogin')}
              </button>
            </div>
          </form>
        )}

        {/* ══════════════════ 登录表单 ══════════════════ */}
        {mode === 'login' && (
          <form onSubmit={handleSubmit} noValidate>
            <Field label={t('auth.emailLabel')}>
              <input
                autoFocus
                type="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder={t('auth.emailPlaceholder')}
                className="atelier-input"
                style={inputStyle}
              />
            </Field>

            <Field
              label={t('auth.pwdLabel')}
              headerRight={
                <button
                  type="button"
                  onClick={() => switchMode('forgot')}
                  style={{ ...linkBtnStyle, fontSize: 11.5, fontWeight: 600 }}
                >
                  {t('auth.forgotPwd')}
                </button>
              }
              inputAction={
                <button
                  type="button"
                  onClick={() => setShowLoginPwd(!showLoginPwd)}
                  style={eyeBtnStyle}
                  aria-label={showLoginPwd ? 'Hide password' : 'Show password'}
                >
                  {showLoginPwd ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              }
            >
              <input
                type={showLoginPwd ? 'text' : 'password'}
                value={loginPwd}
                onChange={(e) => setLoginPwd(e.target.value)}
                placeholder={t('auth.pwdPlaceholder')}
                className="atelier-input"
                style={{ ...inputStyle, paddingRight: 38 }}
              />
            </Field>

            <ErrorBox msg={error} />

            <SubmitBtn
              loading={loading}
              label={t('auth.btnLogin')}
              loadingLabel={t('auth.btnLoggingIn')}
            />
          </form>
        )}

        {/* ══════════════════ 注册表单 ══════════════════ */}
        {mode === 'register' && (
          <form onSubmit={handleSubmit} noValidate>
            <Field label={t('auth.regNameLabel')}>
              <input
                autoFocus
                type="text"
                value={regName}
                onChange={(e) => setRegName(e.target.value)}
                placeholder={t('auth.regNamePlaceholder')}
                className="atelier-input"
                style={inputStyle}
              />
            </Field>

            <Field label={t('auth.emailLabel')}>
              <input
                type="email"
                value={regEmail}
                onChange={(e) => setRegEmail(e.target.value)}
                placeholder={t('auth.emailPlaceholder')}
                className="atelier-input"
                style={inputStyle}
              />
            </Field>

            <Field
              label={t('auth.pwdLabel')}
              inputAction={
                <button
                  type="button"
                  onClick={() => setShowRegPwd(!showRegPwd)}
                  style={eyeBtnStyle}
                  aria-label={showRegPwd ? 'Hide password' : 'Show password'}
                >
                  {showRegPwd ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              }
            >
              <input
                type={showRegPwd ? 'text' : 'password'}
                value={regPwd}
                onChange={(e) => setRegPwd(e.target.value)}
                placeholder={t('auth.regPwdPlaceholder')}
                className="atelier-input"
                style={{ ...inputStyle, paddingRight: 38 }}
              />
              {regPwd && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {[0, 1, 2, 3, 4].map((i) => (
                      <div
                        key={i}
                        style={{
                          flex: 1,
                          height: 4,
                          borderRadius: 2,
                          background:
                            i < pwdStrength.score
                              ? pwdStrength.color
                              : 'var(--surface-inset, rgba(120,115,106,0.22))',
                          transition: 'background 0.25s ease',
                        }}
                      />
                    ))}
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      color: pwdStrength.color,
                      marginTop: 4,
                      display: 'block',
                      fontWeight: 600,
                    }}
                  >
                    {t('auth.pwdStrength')}
                    {pwdStrength.label}
                  </span>
                </div>
              )}
            </Field>

            <Field
              label={t('auth.regConfirmPwd')}
              inputAction={
                <button
                  type="button"
                  onClick={() => setShowRegPwd2(!showRegPwd2)}
                  style={eyeBtnStyle}
                  aria-label={showRegPwd2 ? 'Hide confirm password' : 'Show confirm password'}
                >
                  {showRegPwd2 ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              }
            >
              <input
                type={showRegPwd2 ? 'text' : 'password'}
                value={regPwd2}
                onChange={(e) => setRegPwd2(e.target.value)}
                placeholder={t('auth.regConfirmPlaceholder')}
                className="atelier-input"
                style={{
                  ...inputStyle,
                  paddingRight: 38,
                  borderColor:
                    pwdMatch === false
                      ? 'var(--danger)'
                      : pwdMatch === true
                        ? 'var(--success)'
                        : 'var(--border-strong)',
                }}
              />
              {regPwd2 && (
                <span
                  style={{
                    fontSize: 11,
                    marginTop: 4,
                    display: 'block',
                    fontWeight: 600,
                    color: pwdMatch ? 'var(--success)' : 'var(--danger)',
                  }}
                >
                  {pwdMatch ? t('auth.pwdMatch') : t('auth.pwdMismatch')}
                </span>
              )}
            </Field>

            {/* 服务条款 */}
            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                cursor: 'pointer',
                marginBottom: 18,
                padding: '10px 12px',
                borderRadius: 'var(--card-radius, 6px)',
                background: 'var(--surface-subtle)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <input
                type="checkbox"
                checked={agreedTerms}
                onChange={(e) => setAgreedTerms(e.target.checked)}
                style={{
                  marginTop: 2,
                  accentColor: 'var(--accent-color)',
                  width: 15,
                  height: 15,
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.65 }}>
                {t('auth.termsLead')}
                <a
                  href="#terms"
                  onClick={(e) => e.preventDefault()}
                  style={{ color: 'var(--accent-color)', fontWeight: 600, textDecoration: 'underline' }}
                >
                  {t('auth.termsProtocol')}
                </a>
                {t('auth.termsAnd')}
                <a
                  href="#privacy"
                  onClick={(e) => e.preventDefault()}
                  style={{ color: 'var(--accent-color)', fontWeight: 600, textDecoration: 'underline' }}
                >
                  {t('auth.termsPrivacy')}
                </a>
                {t('auth.termsConfirm')}
              </span>
            </label>

            <ErrorBox msg={error} />
            <SuccessBox msg={success} />

            <SubmitBtn
              loading={loading}
              label={t('auth.btnRegister')}
              loadingLabel={t('auth.btnRegistering')}
            />
          </form>
        )}

        {/* ── 底部登录/注册引导切换 ── */}
        {mode !== 'forgot' && (
          <div style={footerSwitchStyle}>
            {mode === 'login' ? (
              <>
                <span>{t('auth.noAccount')}</span>{' '}
                <button type="button" onClick={() => switchMode('register')} style={linkBtnStyle}>
                  {t('auth.freeRegister')}
                </button>
              </>
            ) : (
              <>
                <span>{t('auth.hasAccount')}</span>{' '}
                <button type="button" onClick={() => switchMode('login')} style={linkBtnStyle}>
                  {t('auth.backToLogin')}
                </button>
              </>
            )}
          </div>
        )}

        {/* 底部安全背书微标 */}
        <div
          style={{
            marginTop: 14,
            paddingTop: 12,
            borderTop: '1px dashed var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            fontSize: 11,
            color: 'var(--text-muted)',
          }}
        >
          <ShieldCheck size={13} style={{ color: 'var(--accent-secondary)' }} />
          <span>Institutional Portfolio &amp; Fund Research Access · Encrypted Session</span>
        </div>
      </div>
    </div>
  );
}

/* ── 子组件 ─────────────────────────────────────────────────────── */
function Field({ label, headerRight, inputAction, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 6,
        }}
      >
        <label style={labelStyle}>{label}</label>
        {headerRight}
      </div>
      <div style={{ position: 'relative' }}>
        {children}
        {inputAction && (
          <div
            style={{
              position: 'absolute',
              right: 10,
              top: 0,
              height: 40,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            {inputAction}
          </div>
        )}
      </div>
    </div>
  );
}

function ErrorBox({ msg }) {
  if (!msg) return null;
  return (
    <div
      style={{
        marginBottom: 14,
        padding: '10px 12px',
        background: 'var(--danger-bg)',
        border: '1px solid var(--danger)',
        borderLeft: '3px solid var(--danger)',
        borderRadius: 'var(--card-radius, 6px)',
        color: 'var(--danger)',
        fontSize: 12.5,
        lineHeight: 1.5,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontWeight: 600,
      }}
    >
      <AlertTriangle size={15} style={{ flexShrink: 0 }} />
      <span>{msg}</span>
    </div>
  );
}

function SuccessBox({ msg }) {
  if (!msg) return null;
  return (
    <div
      style={{
        marginBottom: 14,
        padding: '10px 12px',
        background: 'var(--success-bg)',
        border: '1px solid var(--success)',
        borderLeft: '3px solid var(--success)',
        borderRadius: 'var(--card-radius, 6px)',
        color: 'var(--success)',
        fontSize: 12.5,
        lineHeight: 1.5,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontWeight: 600,
      }}
    >
      <CheckCircle2 size={15} style={{ flexShrink: 0 }} />
      <span>{msg}</span>
    </div>
  );
}

function SubmitBtn({ loading, label, loadingLabel }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="create-btn"
      style={{
        width: '100%',
        padding: '12px 16px',
        fontSize: 14,
        fontWeight: 700,
        opacity: loading ? 0.72 : 1,
        cursor: loading ? 'not-allowed' : 'pointer',
      }}
    >
      {loading ? (
        <span>{loadingLabel}</span>
      ) : (
        <>
          <span>{label}</span>
          <ArrowRight size={15} />
        </>
      )}
    </button>
  );
}

/* ── Styles（100% 绑定 index.css Atelier 主题变量，自适应日间画廊 & 暗夜黑金）── */
const overlayStyle = {
  position: 'fixed',
  inset: 0,
  zIndex: 9000,
  background: 'rgba(20, 20, 19, 0.72)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
};

const panelStyle = {
  background: 'var(--surface-elevated)',
  border: '1px solid var(--border-strong)',
  borderTop: '3px solid var(--accent-color)',
  borderRadius: 'var(--card-radius, 6px)',
  padding: '30px 28px 24px',
  width: '100%',
  boxShadow: '0 24px 60px rgba(0, 0, 0, 0.28)',
  position: 'relative',
  maxHeight: '92vh',
  overflowY: 'auto',
  transition: 'max-width 0.25s ease, background-color 0.25s ease',
};

const closeBtnStyle = {
  position: 'absolute',
  top: 16,
  right: 16,
  background: 'var(--surface-subtle)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--card-radius, 6px)',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  width: 30,
  height: 30,
  padding: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'all 0.15s ease',
};

const iconBadgeStyle = {
  width: 42,
  height: 42,
  borderRadius: 'var(--card-radius, 6px)',
  background: 'var(--warning-bg)',
  border: '1px solid var(--border-strong)',
  color: 'var(--accent-secondary)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};

const eyebrowStyle = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '0.1em',
  color: 'var(--accent-secondary)',
  textTransform: 'uppercase',
  marginBottom: 3,
};

const headingStyle = {
  margin: 0,
  fontFamily: 'var(--font-display)',
  fontSize: '1.55rem',
  fontWeight: 700,
  color: 'var(--text-primary)',
  letterSpacing: '-0.02em',
  lineHeight: 1.2,
};

const subHeadingStyle = {
  margin: '4px 0 0',
  color: 'var(--text-muted)',
  fontSize: 12.5,
  lineHeight: 1.45,
};

const infoCalloutStyle = {
  background: 'var(--surface-subtle)',
  border: '1px solid var(--border-subtle)',
  borderLeft: '3px solid var(--accent-secondary)',
  borderRadius: 'var(--card-radius, 6px)',
  padding: '10px 12px',
  marginBottom: 16,
  fontSize: 12.5,
  color: 'var(--text-secondary)',
  lineHeight: 1.6,
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
};

const labelStyle = {
  display: 'block',
  color: 'var(--text-secondary)',
  fontSize: 11.5,
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
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
  transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
};

const eyeBtnStyle = {
  background: 'none',
  border: 'none',
  color: 'var(--text-muted)',
  cursor: 'pointer',
  padding: 4,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const linkBtnStyle = {
  background: 'none',
  border: 'none',
  color: 'var(--accent-color)',
  cursor: 'pointer',
  fontWeight: 700,
  fontSize: 12.5,
  textDecoration: 'underline',
  textUnderlineOffset: '3px',
  padding: 0,
};

const footerSwitchStyle = {
  textAlign: 'center',
  marginTop: 18,
  fontSize: 12.5,
  color: 'var(--text-secondary)',
};
