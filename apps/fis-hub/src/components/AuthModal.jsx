import React, { useState, useEffect, useCallback, useRef } from 'react';
import { authStorage } from '../utils/auth';
import { useLang } from '../i18n/LangContext';


const API = '/api';

/* ── 密码强度计算 ─────────────────────────────────────────────────── */


/* ── 主组件 ──────────────────────────────────────────────────────── */
export default function AuthModal({ onSuccess, onClose }) {
  const { t } = useLang();
  const [mode, setMode] = useState('login'); // 'login' | 'register'

  const calcStrength = (pwd) => {
    if (!pwd) return { score: 0, label: '', color: '#334155' };
    let score = 0;
    if (pwd.length >= 8) score++;
    if (pwd.length >= 12) score++;
    if (/[A-Z]/.test(pwd)) score++;
    if (/[0-9]/.test(pwd)) score++;
    if (/[^A-Za-z0-9]/.test(pwd)) score++;
    const levels = [
      { label: t('auth.pwdVeryWeak'), color: '#ef4444' },
      { label: t('auth.pwdWeak'),     color: '#f97316' },
      { label: t('auth.pwdNormal'),   color: '#eab308' },
      { label: t('auth.pwdStrong'),   color: '#22c55e' },
      { label: t('auth.pwdVeryStrong'), color: '#10b981' },
    ];
    const lvl = levels[Math.min(score, 4)];
    return { score, label: lvl.label, color: lvl.color };
  };

  // ── 登录字段 ──
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPwd,   setLoginPwd]   = useState('');
  const [showLoginPwd, setShowLoginPwd] = useState(false);

  // ── 注册字段 ──
  const [regName,      setRegName]      = useState('');
  const [regEmail,     setRegEmail]     = useState('');
  const [regPwd,       setRegPwd]       = useState('');
  const [regPwd2,      setRegPwd2]      = useState('');
  const [showRegPwd,   setShowRegPwd]   = useState(false);
  const [showRegPwd2,  setShowRegPwd2]  = useState(false);
  const [regType,      setRegType]      = useState('free');    // free | premium
  const [advisorId,    setAdvisorId]    = useState('');        // 选中的顾问 ID
  const [advisors,     setAdvisors]     = useState([]);        // 顾问列表
  const [advisorLoading, setAdvisorLoading] = useState(false);
  const [agreedTerms,  setAgreedTerms]  = useState(false);

  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');

  const pwdStrength = calcStrength(regPwd);
  const pwdMatch    = regPwd2 ? regPwd === regPwd2 : null; // null = 未输入

  /* ── ESC 关闭 ── */
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  /* ── 拉取顾问列表（注册模式 + 选择 premium 才拉） ── */
  useEffect(() => {
    if (mode !== 'register' || regType !== 'premium') return;
    setAdvisorLoading(true);
    fetch(`${API}/auth/advisors`)
      .then(r => r.ok ? r.json() : [])
      .then(list => setAdvisors(Array.isArray(list) ? list : []))
      .catch(() => setAdvisors([]))
      .finally(() => setAdvisorLoading(false));
  }, [mode, regType]);

  /* ── 切换模式时清空 ── */
  const switchMode = (m) => {
    setMode(m);
    setError('');
    setSuccess('');
  };

  /* ── 校验 ── */
  const validateLogin = () => {
    if (!loginEmail.trim())      return t('auth.errEmailReq');
    if (!loginPwd)               return t('auth.errPwdReq');
    return null;
  };

  const validateRegister = () => {
    if (!regName.trim())         return t('auth.errNameReq');
    if (!regEmail.trim())        return t('auth.errEmailReq');
    if (!/\S+@\S+\.\S+/.test(regEmail)) return t('auth.errEmailInvalid');
    if (regPwd.length < 6)       return t('auth.errPwdMin');
    if (regPwd !== regPwd2)      return t('auth.errPwdMatch');
    if (regType === 'premium' && !advisorId) return t('auth.errAdvisorReq');
    if (!agreedTerms)             return t('auth.errTermsReq');
    return null;
  };

  /* ── 提交 ── */
  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    setError('');

    const err = mode === 'login' ? validateLogin() : validateRegister();
    if (err) { setError(err); return; }

    setLoading(true);
    try {
      const url  = mode === 'login' ? `${API}/auth/login` : `${API}/auth/register`;
      const body = mode === 'login'
        ? { email: loginEmail.trim(), password: loginPwd }
        : {
            email: regEmail.trim(),
            name: regName.trim(),
            password: regPwd,
            redirect_url: window.location.origin
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

      // If registration was successful, auto-login to get the access token
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
      if (!tokenValue) { setError(t('auth.errNoToken')); return; }
      authStorage.setToken(tokenValue);

      // 获取完整用户信息
      let userInfo;
      try {
        const meRes = await fetch(`${API}/auth/me`, {
          headers: { 'Authorization': `Bearer ${tokenValue}` }
        });
        userInfo = meRes.ok ? await meRes.json() : null;
      } catch (_) { userInfo = null; }

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
  }, [mode, loginEmail, loginPwd, regEmail, regPwd, regPwd2, regName, regType, advisorId, agreedTerms, onSuccess]);

  /* ═══════════════════════════════════════════════════════════════ */
  return (
    <div style={overlayStyle}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          ...panelStyle,
          width: mode === 'register' ? 480 : 400,
          transition: 'width 0.3s ease',
        }}
      >
        {/* 关闭 */}
        <button onClick={onClose} style={closeBtnStyle}>✕</button>

        {/* 顶部标题 */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 32, marginBottom: 4 }}>
            {mode === 'login' ? '🔐' : '✨'}
          </div>
          <h2 style={{ margin: 0, fontSize: 21, fontWeight: 800, color: '#f1f5f9', letterSpacing: '-0.5px' }}>
            {mode === 'login' ? t('auth.welcome') : t('auth.createAccount')}
          </h2>
          <p style={{ margin: '5px 0 0', color: 'rgba(255,255,255,0.38)', fontSize: 13 }}>
            {t('auth.platformTitle')}
          </p>
        </div>

        {/* ── 模式选项卡 ── */}
        <div style={tabBarStyle}>
          {['login', 'register', 'forgot'].map(m => (
            <button
              key={m}
              onClick={() => switchMode(m === 'forgot' ? 'forgot' : m)}
              style={{
                ...tabBtnBase,
                background: mode === m ? 'rgba(99,102,241,0.22)' : 'transparent',
                color:       mode === m ? '#818cf8' : 'rgba(255,255,255,0.38)',
                borderBottom: mode === m ? '2px solid #818cf8' : '2px solid transparent',
              }}
            >
              {m === 'login' ? t('auth.tabLogin') : m === 'register' ? t('auth.tabRegister') : t('auth.tabForgot')}
            </button>
          ))}
        </div>

        {/* ══════════════════ 找回密码表单 ══════════════════ */}
        {mode === 'forgot' && (
          <form onSubmit={async (e) => {
            e.preventDefault();
            setError('');
            setSuccess('');
            if (!loginEmail.trim()) { setError(t('auth.errEmailReq')); return; }
            setLoading(true);
            try {
              const res = await fetch(`${API}/auth/forgot-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                  email: loginEmail.trim(),
                  redirect_url: window.location.origin
                }),
              });
              const data = await res.json();
              if (res.ok) {
                setSuccess(t('auth.forgotSuccess'));
              } else {
                setError(data.detail || '请求失败');
              }
            } catch (err) {
              setError('网络错误');
            } finally {
              setLoading(false);
            }
          }} noValidate style={{ marginTop: 20 }}>
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginBottom: 16 }}>
              {t('auth.forgotDesc')}
            </p>
            <Field label={t('auth.emailLabel')}>
              <input
                autoFocus
                type="email"
                value={loginEmail}
                onChange={e => setLoginEmail(e.target.value)}
                placeholder={t('auth.emailPlaceholder')}
                style={inputStyle}
              />
            </Field>
            <ErrorBox msg={error} />
            <SuccessBox msg={success} />
            <SubmitBtn loading={loading} label={t('auth.btnForgot')} loadingLabel={t('auth.btnSending')} />
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <button type="button" onClick={() => setMode('login')} style={linkBtnStyle}>{t('auth.backToLogin')}</button>
            </div>
          </form>
        )}

        {/* ══════════════════ 登录表单 ══════════════════ */}
        {mode === 'login' && (
          <form onSubmit={handleSubmit} noValidate style={{ marginTop: 20 }}>
            <Field label={t('auth.emailLabel')}>
              <input
                autoFocus
                type="email"
                value={loginEmail}
                onChange={e => setLoginEmail(e.target.value)}
                placeholder={t('auth.emailPlaceholder')}
                style={inputStyle}
              />
            </Field>

            <Field label={t('auth.pwdLabel')} extra={
              <button type="button" onClick={() => setShowLoginPwd(!showLoginPwd)} style={eyeBtnStyle}>
                {showLoginPwd ? '🙈' : '👁'}
              </button>
            }>
              <input
                type={showLoginPwd ? 'text' : 'password'}
                value={loginPwd}
                onChange={e => setLoginPwd(e.target.value)}
                placeholder={t('auth.pwdPlaceholder')}
                style={{ ...inputStyle, paddingRight: 40 }}
              />
            </Field>

            <div style={{ textAlign: 'right', marginTop: -8, marginBottom: 16 }}>
              <button type="button" onClick={() => setMode('forgot')} style={{ ...linkBtnStyle, fontSize: 12, textDecoration: 'none' }}>
                {t('auth.forgotPwd')}
              </button>
            </div>

            <ErrorBox msg={error} />

            <SubmitBtn loading={loading} label={t('auth.btnLogin')} loadingLabel={t('auth.btnLoggingIn')} />
          </form>
        )}

        {/* ══════════════════ 注册表单 ══════════════════ */}
        {mode === 'register' && (
          <form onSubmit={handleSubmit} noValidate style={{ marginTop: 20 }}>

            {/* 姓名 */}
            <Field label={t('auth.regNameLabel')}>
              <input
                autoFocus
                type="text"
                value={regName}
                onChange={e => setRegName(e.target.value)}
                placeholder={t('auth.regNamePlaceholder')}
                style={inputStyle}
              />
            </Field>

            {/* 邮箱 */}
            <Field label={t('auth.emailLabel')}>
              <input
                type="email"
                value={regEmail}
                onChange={e => setRegEmail(e.target.value)}
                placeholder={t('auth.emailPlaceholder')}
                style={inputStyle}
              />
            </Field>

            {/* 密码 */}
            <Field label={t('auth.pwdLabel')} extra={
              <button type="button" onClick={() => setShowRegPwd(!showRegPwd)} style={eyeBtnStyle}>
                {showRegPwd ? '🙈' : '👁'}
              </button>
            }>
              <input
                type={showRegPwd ? 'text' : 'password'}
                value={regPwd}
                onChange={e => setRegPwd(e.target.value)}
                placeholder={t('auth.regPwdPlaceholder')}
                style={{ ...inputStyle, paddingRight: 40 }}
              />
              {/* 密码强度条 */}
              {regPwd && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {[0,1,2,3,4].map(i => (
                      <div key={i} style={{
                        flex: 1, height: 4, borderRadius: 2,
                        background: i < pwdStrength.score ? pwdStrength.color : 'rgba(255,255,255,0.1)',
                        transition: 'background 0.3s',
                      }} />
                    ))}
                  </div>
                  <span style={{ fontSize: 11, color: pwdStrength.color, marginTop: 3, display: 'block' }}>
                    {t('auth.pwdStrength')}{pwdStrength.label}
                  </span>
                </div>
              )}
            </Field>

            {/* 确认密码 */}
            <Field label={t('auth.regConfirmPwd')} extra={
              <button type="button" onClick={() => setShowRegPwd2(!showRegPwd2)} style={eyeBtnStyle}>
                {showRegPwd2 ? '🙈' : '👁'}
              </button>
            }>
              <input
                type={showRegPwd2 ? 'text' : 'password'}
                value={regPwd2}
                onChange={e => setRegPwd2(e.target.value)}
                placeholder={t('auth.regConfirmPlaceholder')}
                style={{
                  ...inputStyle,
                  paddingRight: 40,
                  borderColor: pwdMatch === false
                    ? 'rgba(239,68,68,0.6)'
                    : pwdMatch === true
                      ? 'rgba(34,197,94,0.6)'
                      : 'rgba(255,255,255,0.12)',
                }}
              />
              {regPwd2 && (
                <span style={{
                  fontSize: 11, marginTop: 3, display: 'block',
                  color: pwdMatch ? '#4ade80' : '#f87171',
                }}>
                  {pwdMatch ? t('auth.pwdMatch') : t('auth.pwdMismatch')}
                </span>
              )}
            </Field>


            {/* 服务条款 */}
            <label style={{
              display: 'flex', alignItems: 'flex-start', gap: 10,
              cursor: 'pointer', marginBottom: 20,
            }}>
              <input
                type="checkbox"
                checked={agreedTerms}
                onChange={e => setAgreedTerms(e.target.checked)}
                style={{ marginTop: 2, accentColor: '#6366f1', width: 16, height: 16, flexShrink: 0 }}
              />
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', lineHeight: 1.7 }}>
                {t('auth.termsLead')}
                <a href="#" style={{ color: '#818cf8', textDecoration: 'none' }}>{t('auth.termsProtocol')}</a>
                {t('auth.termsAnd')}
                <a href="#" style={{ color: '#818cf8', textDecoration: 'none' }}>{t('auth.termsPrivacy')}</a>
                {t('auth.termsConfirm')}
              </span>
            </label>

            <ErrorBox  msg={error}   />
            <SuccessBox msg={success} />
            <SubmitBtn loading={loading} label={t('auth.btnRegister')} loadingLabel={t('auth.btnRegistering')} />
          </form>
        )}

        {/* 底部切换 */}
        <div style={{ textAlign: 'center', marginTop: 18, fontSize: 13, color: 'rgba(255,255,255,0.38)' }}>
          {mode === 'login' ? (
            <>
              {t('auth.noAccount')}{' '}
              <button onClick={() => switchMode('register')} style={linkBtnStyle}>{t('auth.freeRegister')}</button>
            </>
          ) : (
            <>
              {t('auth.hasAccount')}{' '}
              <button onClick={() => switchMode('login')} style={linkBtnStyle}>{t('auth.backToLogin')}</button>
            </>
          )}
        </div>
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}

/* ── 子组件 ─────────────────────────────────────────────────────── */
function Field({ label, children, extra }) {
  return (
    <div style={{ marginBottom: 14, position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <label style={labelStyle}>{label}</label>
        {extra && <div style={{ position: 'absolute', right: 12, bottom: 10 }}>{extra}</div>}
      </div>
      {children}
    </div>
  );
}

function ErrorBox({ msg }) {
  if (!msg) return null;
  return (
    <div style={{
      marginBottom: 14, padding: '10px 14px',
      background: 'rgba(239,68,68,0.1)',
      border: '1px solid rgba(239,68,68,0.3)',
      borderRadius: 10, color: '#fca5a5', fontSize: 13, lineHeight: 1.5,
    }}>
      ⚠️ {msg}
    </div>
  );
}

function SuccessBox({ msg }) {
  if (!msg) return null;
  return (
    <div style={{
      marginBottom: 14, padding: '10px 14px',
      background: 'rgba(34,197,94,0.1)',
      border: '1px solid rgba(34,197,94,0.3)',
      borderRadius: 10, color: '#4ade80', fontSize: 13,
    }}>
      {msg}
    </div>
  );
}

function SubmitBtn({ loading, label, loadingLabel }) {
  return (
    <button type="submit" disabled={loading} style={{
      width: '100%', padding: '13px',
      background: loading ? 'rgba(99,102,241,0.4)' : 'linear-gradient(135deg, #6366f1, #818cf8)',
      border: 'none', borderRadius: 11,
      color: '#fff', fontWeight: 700, fontSize: 15,
      cursor: loading ? 'not-allowed' : 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      boxShadow: loading ? 'none' : '0 4px 24px rgba(99,102,241,0.45)',
      transition: 'all 0.2s',
      letterSpacing: '0.03em',
    }}>
      {loading ? <><span style={spinnerStyle} />{loadingLabel}</> : label}
    </button>
  );
}

/* ── Styles ─────────────────────────────────────────────────────── */
const overlayStyle = {
  position: 'fixed', inset: 0, zIndex: 9000,
  background: 'rgba(0,0,0,0.7)',
  backdropFilter: 'blur(8px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 16,
};

const panelStyle = {
  background: 'linear-gradient(150deg, rgba(15,23,42,0.99), rgba(30,41,59,0.99))',
  border: '1px solid rgba(99,102,241,0.25)',
  borderRadius: 20,
  padding: '36px 32px',
  boxShadow: '0 40px 100px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.04)',
  position: 'relative',
  maxHeight: '90vh',
  overflowY: 'auto',
};

const closeBtnStyle = {
  position: 'absolute', top: 16, right: 16,
  background: 'rgba(255,255,255,0.07)', border: 'none', borderRadius: 8,
  color: 'rgba(255,255,255,0.5)', cursor: 'pointer',
  width: 30, height: 30, fontSize: 16,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

const tabBarStyle = {
  display: 'flex',
  borderBottom: '1px solid rgba(255,255,255,0.08)',
  marginBottom: 4,
};

const tabBtnBase = {
  flex: 1, padding: '10px 0',
  border: 'none', cursor: 'pointer',
  fontWeight: 700, fontSize: 14,
  letterSpacing: '0.05em',
  transition: 'all 0.2s',
  background: 'transparent',
};

const labelStyle = {
  display: 'block',
  color: 'rgba(255,255,255,0.5)', fontSize: 11.5, fontWeight: 700,
  letterSpacing: '0.08em', textTransform: 'uppercase',
};

const inputStyle = {
  width: '100%', padding: '11px 14px',
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 10, color: '#e2e8f0',
  fontSize: 14, outline: 'none',
  boxSizing: 'border-box',
  transition: 'border-color 0.2s',
};

const eyeBtnStyle = {
  background: 'none', border: 'none',
  color: 'rgba(255,255,255,0.4)', cursor: 'pointer',
  fontSize: 15, padding: 0, lineHeight: 1,
};

const linkBtnStyle = {
  background: 'none', border: 'none',
  color: '#818cf8', cursor: 'pointer',
  fontWeight: 700, fontSize: 13,
  textDecoration: 'underline', padding: 0,
};

const spinnerStyle = {
  display: 'inline-block',
  width: 15, height: 15,
  border: '2px solid rgba(255,255,255,0.25)',
  borderTop: '2px solid #fff',
  borderRadius: '50%',
  animation: 'spin 0.8s linear infinite',
  verticalAlign: 'middle',
};
