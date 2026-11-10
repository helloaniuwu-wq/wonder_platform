import React, { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useApp } from '../contexts/AppContext.jsx'

// ── 各业务模式的导航规则 ──────────────────────────────────────────
const ALL_NAV = [
  { to: '/',            icon: '📊', label: '儀表板',   modes: ['insurance_agent', 'trading_sme', 'freelancer', 'holding'] },
  { to: '/financials',  icon: '📈', label: '財務報表',  modes: ['insurance_agent', 'trading_sme', 'freelancer', 'holding'] },
  { to: '/compliance',  icon: '📅', label: '合規日曆',  modes: ['insurance_agent', 'trading_sme', 'freelancer', 'holding'] },
  { to: '/invoices',   icon: '🧾', label: '發票管理',  modes: ['trading_sme', 'freelancer'] },
  { to: '/clients',    icon: '👥', label: '客戶管理',  modes: ['trading_sme'] },
  { to: '/expenses',   icon: '💰', label: '支出憑證',  modes: ['insurance_agent', 'trading_sme', 'freelancer', 'holding'] },
  { to: '/commissions',icon: '📋', label: '佣金台賬',  modes: ['insurance_agent'] },
]

function getNavItems(businessMode) {
  return ALL_NAV.filter(item => item.modes.includes(businessMode || 'trading_sme'))
}

const MODE_BADGE = {
  insurance_agent: { label: '🛡️ 保险代理', color: '#6366F1' },
  trading_sme:     { label: '📦 贸易SME',  color: '#10B981' },
  freelancer:      { label: '🧑‍💻 自由职业', color: '#F59E0B' },
  holding:         { label: '🏛️ 持股架构', color: '#8B5CF6' },
}

export default function Layout({ children }) {
  const { user, companies, currentCompany, switchCompany, logout } = useApp()
  const [showCompanyDrop, setShowCompanyDrop] = useState(false)
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <div className="app-shell">
      {/* ── 侧边栏 ── */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <h1>🏢 港行政</h1>
          <span>香港企業管理系統</span>
        </div>

        {/* 业务模式显示标签 */}
        {currentCompany && (() => {
          const badge = MODE_BADGE[currentCompany.business_mode] || MODE_BADGE.trading_sme
          return (
            <div style={{
              margin: '0 12px 4px',
              padding: '4px 10px',
              borderRadius: 20,
              fontSize: 11,
              fontWeight: 700,
              background: badge.color + '18',
              color: badge.color,
              display: 'inline-block',
              maxWidth: '100%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {badge.label}
            </div>
          )
        })()}

        <nav className="sidebar-nav">
          <div className="nav-group-label">主要功能</div>
          {getNavItems(currentCompany?.business_mode).map(({ to, icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <span style={{ fontSize: 15 }}>{icon}</span>
              {label}
            </NavLink>
          ))}

          {user?.role?.toLowerCase() === 'admin' && (
            <>
              <div className="nav-group-label" style={{ marginTop: 24 }}>系統管理</div>
              <NavLink to="/admin" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
                <span style={{ fontSize: 15 }}>⚙️</span>
                系統用戶
              </NavLink>
            </>
          )}
        </nav>

        {/* 底部用户 */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--color-border-light)' }}>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 4 }}>
            {user?.name} ({user?.role})
          </div>
          <button className="btn btn-ghost btn-sm w-full" style={{ justifyContent: 'flex-start' }} onClick={handleLogout}>
            登出
          </button>
        </div>
      </aside>

      {/* ── 主区域 ── */}
      <div className="main-content">
        {/* 顶部栏 */}
        <header className="topbar">
          {/* 公司切换器 */}
          <div className="company-switcher">
            <button
              className="company-switcher-btn"
              onClick={() => setShowCompanyDrop(v => !v)}
            >
              🏢 <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {currentCompany?.name_zh || '選擇公司'}
              </span>
              <span style={{ marginLeft: 'auto', fontSize: 10 }}>▾</span>
            </button>

            {showCompanyDrop && (
              <div className="company-dropdown animate-in">
                {companies.map(c => (
                  <div
                    key={c.id}
                    className={`company-dropdown-item${currentCompany?.id === c.id ? ' active' : ''}`}
                    onClick={() => { switchCompany(c); setShowCompanyDrop(false) }}
                  >
                    🏢 {c.name_zh}
                  </div>
                ))}
                <div style={{ borderTop: '1px solid var(--color-border-light)', margin: '4px 0' }} />
                <div
                  className="company-dropdown-item"
                  onClick={() => { navigate('/companies/new'); setShowCompanyDrop(false) }}
                >
                  ＋ 新增公司
                </div>
              </div>
            )}
          </div>

          <div style={{ flex: 1 }} />

          <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
            {currentCompany?.base_currency || 'HKD'}
          </div>
        </header>

        {/* 页面内容 */}
        <main className="page-content animate-in">
          {children}
        </main>
      </div>

      {/* 点击空白关闭下拉 */}
      {showCompanyDrop && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setShowCompanyDrop(false)} />
      )}
    </div>
  )
}
