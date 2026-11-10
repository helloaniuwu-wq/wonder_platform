import React, { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../contexts/AppContext.jsx'
import { invoicesApi, complianceApi } from '../api/index.js'

// ── 财年工具函数 ─────────────────────────────────────────────────────
function buildFiscalYearOptions() {
  const now = new Date()
  const m = now.getMonth() + 1
  const y = now.getFullYear()
  const currentStart = m >= 4 ? y : y - 1
  // 生成当前财年及往前4年，共5个选项
  return Array.from({ length: 5 }, (_, i) => {
    const start = currentStart - i
    return `${start}-${String(start + 1).slice(-2)}`
  })
}
const STATUS_ZH = {
  draft: '草稿', sent: '已发出', paid: '已收款',
  partial: '部分收款', overdue: '逾期', void: '已作废'
}

const STATUS_CLASS = {
  draft: 'badge-draft', sent: 'badge-sent', paid: 'badge-paid',
  partial: 'badge-partial', overdue: 'badge-overdue', void: 'badge-void',
}

function formatHKD(amount) {
  return `HK$ ${Number(amount).toLocaleString('zh-HK', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

// ── 通用 StatCard ────────────────────────────────────────────────────
function StatCard({ icon, iconClass, label, value, sub, accent }) {
  return (
    <div className="stat-card" style={accent ? { borderTop: `3px solid ${accent}` } : {}}>
      <div className={`stat-icon ${iconClass}`}>
        <span style={{ fontSize: 18 }}>{icon}</span>
      </div>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-sub">{sub}</div>
    </div>
  )
}

// ── 合规警告条 ────────────────────────────────────────────────────────────
function ComplianceBanner({ companyId }) {
  const [summary, setSummary] = useState(null)
  useEffect(() => {
    if (!companyId) return
    complianceApi.summary(companyId).then(r => setSummary(r.data)).catch(() => {})
  }, [companyId])

  if (!summary) return null
  const { overdue, due_soon_7d } = summary
  if (!overdue && !due_soon_7d) return null

  return (
    <div style={{
      padding: '12px 18px', borderRadius: 'var(--radius-lg)',
      background: overdue > 0 ? '#EF444410' : '#F59E0B10',
      border: `1px solid ${overdue > 0 ? '#EF444440' : '#F59E0B40'}`,
      color: overdue > 0 ? '#B91C1C' : '#B45309',
      fontSize: 13, fontWeight: 600,
      display: 'flex', alignItems: 'center', gap: 14,
      marginBottom: 20,
    }}>
      <span style={{ fontSize: 18 }}>{overdue > 0 ? '🚨' : '⚠️'}</span>
      <span>
        {overdue > 0 && <><b>{overdue} 項合規事件已逾期</b>，{' '}</>}
        {due_soon_7d > 0 && <><b>{due_soon_7d} 項</b>將在 7 天内截止，{' '}</>}
        請盡快處理。
      </span>
      <Link to="/compliance" style={{
        marginLeft: 'auto', flexShrink: 0,
        color: 'inherit', fontWeight: 700, textDecoration: 'none',
        padding: '4px 12px', borderRadius: 20,
        background: overdue > 0 ? '#EF444420' : '#F59E0B20',
        border: `1px solid ${overdue > 0 ? '#EF444460' : '#F59E0B60'}`,
      }}>
        查看合規日曆 →
      </Link>
    </div>
  )
}

// ── 最近发票/收入表格（通用） ───────────────────────────────────────
function RecentInvoiceTable({ invoices }) {
  if (!invoices?.length) return (
    <div className="card-body empty-state" style={{ padding: '40px 24px' }}>
      <div className="empty-state-icon">🧾</div>
      <h3>尚无发票记录</h3>
      <p>点击右上角「新增发票」开始记账</p>
    </div>
  )
  return (
    <div className="table-container" style={{ border: 'none', borderRadius: 0 }}>
      <table>
        <thead>
          <tr>
            <th>发票号码</th>
            <th>客户</th>
            <th>状态</th>
            <th>开票日期</th>
            <th style={{ textAlign: 'right' }}>金额</th>
            <th style={{ textAlign: 'right' }}>待收</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map(inv => (
            <tr key={inv.id}>
              <td>
                <Link to={`/invoices/${inv.id}`} style={{ color: 'var(--color-primary)', fontWeight: 600 }}>
                  {inv.invoice_number}
                </Link>
              </td>
              <td>{inv.client_name}</td>
              <td><span className={`badge ${STATUS_CLASS[inv.status]}`}>{STATUS_ZH[inv.status]}</span></td>
              <td className="td-muted">{inv.issue_date?.slice(0, 10)}</td>
              <td className="td-amount" style={{ textAlign: 'right' }}>
                {inv.currency} {inv.total_amount?.toLocaleString('en-HK', { minimumFractionDigits: 2 })}
              </td>
              <td style={{ textAlign: 'right' }}>
                <span style={{ color: inv.balance_due > 0 ? 'var(--color-danger)' : 'var(--color-success)', fontWeight: 700 }}>
                  {inv.balance_due > 0
                    ? `${inv.currency} ${inv.balance_due.toLocaleString('en-HK', { minimumFractionDigits: 2 })}`
                    : '✓'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════
// ── 策略一：保险代理 Dashboard ─────────────────────────────────────
// ══════════════════════════════════════════════════════════════════
function AgentDashboard({ s, company, fiscalYear }) {
  const netProfit = (s.commission_ytd || 0) - (s.expense_ytd || 0)
  // 财年标签：将 "2025-26" 格式转换为 "2025/26 财年"
  const fyLabel = fiscalYear ? fiscalYear.replace('-', '/') + ' 财年' : ''

  return (
    <>
      {/* 核心 KPI */}
      <div style={{ marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-muted)' }}>
          🌟 {fyLabel} · 核心业务概览
        </span>
      </div>
      <div className="stats-grid" style={{ marginBottom: 24 }}>
        <StatCard icon="📈" iconClass="blue" accent="#6366F1"
          label="本财年累计佣金"
          value={formatHKD(s.commission_ytd || 0)}
          sub="各渠道已确认收入合计"
        />
        <StatCard icon="🧾" iconClass="amber" accent="#F59E0B"
          label="本财年可扣除支出"
          value={formatHKD(s.expense_ytd || 0)}
          sub="已入账业务开支"
        />
        <StatCard icon="💵" iconClass="green" accent="#10B981"
          label="上月佣金结转"
          value={formatHKD(s.commission_last_month || 0)}
          sub="最近一个月税前收入"
        />
        <StatCard icon="💡" iconClass="purple" accent={netProfit >= 0 ? '#10B981' : '#EF4444'}
          label="预估净利润（纳税基数）"
          value={formatHKD(netProfit)}
          sub="佣金 - 可扣除支出"
        />
      </div>

      {/* 快捷入口 */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 28 }}>
        <Link to="/commissions" className="btn btn-primary" style={{ flex: 1, textAlign: 'center' }}>
          📈 查看佣金台账
        </Link>
        <Link to="/expenses" className="btn btn-secondary" style={{ flex: 1, textAlign: 'center' }}>
          💰 查看支出凭证
        </Link>
      </div>
    </>
  )
}

// ══════════════════════════════════════════════════════════════════
// ── 策略二：贸易 SME Dashboard ─────────────────────────────────────
// ══════════════════════════════════════════════════════════════════
function SmeDashboard({ s, company }) {
  return (
    <>
      <div style={{ marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-muted)' }}>
          📦 应收账款与发票概览
        </span>
      </div>
      <div className="stats-grid" style={{ marginBottom: 24 }}>
        <StatCard icon="💰" iconClass="blue"
          label="待收款项" value={formatHKD(s.total_outstanding || 0)} sub="所有未付发票合计"
        />
        <StatCard icon="⚠️" iconClass="red"
          label="逾期款项" value={formatHKD(s.total_overdue || 0)} sub="须立即跟进"
        />
        <StatCard icon="✅" iconClass="green"
          label="本月已收" value={formatHKD(s.total_paid_this_month || 0)}
          sub={`${new Date().getMonth() + 1}月收款合计`}
        />
        <StatCard icon="📑" iconClass="amber"
          label="发票总数"
          value={Object.values(s.invoice_count_by_status || {}).reduce((a, b) => a + b, 0)}
          sub="所有状态"
        />
      </div>

      {s.invoice_count_by_status && (
        <div className="card mb-6" style={{ marginBottom: 24 }}>
          <div className="card-header">
            <span className="card-title">发票状态分布</span>
            <Link to="/invoices" className="btn btn-ghost btn-sm">查看全部 →</Link>
          </div>
          <div className="card-body">
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {Object.entries(s.invoice_count_by_status).filter(([, v]) => v > 0).map(([status, count]) => (
                <div key={status} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 14px', background: 'var(--color-border-light)',
                  borderRadius: 'var(--radius-md)',
                }}>
                  <span className={`badge ${STATUS_CLASS[status] || 'badge-draft'}`}>{STATUS_ZH[status] || status}</span>
                  <span style={{ fontWeight: 700, fontSize: 16 }}>{count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, marginBottom: 28 }}>
        <Link to="/invoices/new" className="btn btn-primary" style={{ flex: 1, textAlign: 'center' }}>
          ＋ 新增发票
        </Link>
        <Link to="/clients" className="btn btn-secondary" style={{ flex: 1, textAlign: 'center' }}>
          👥 客户管理
        </Link>
      </div>
    </>
  )
}

// ══════════════════════════════════════════════════════════════════
// ── 策略三：自由职业者 Dashboard ────────────────────────────────────
// ══════════════════════════════════════════════════════════════════
function FreelancerDashboard({ s }) {
  return (
    <>
      <div className="stats-grid" style={{ marginBottom: 24 }}>
        <StatCard icon="💰" iconClass="blue"
          label="待收款项" value={formatHKD(s.total_outstanding || 0)} sub="未付发票合计"
        />
        <StatCard icon="✅" iconClass="green"
          label="本月已收" value={formatHKD(s.total_paid_this_month || 0)}
          sub={`${new Date().getMonth() + 1}月收款合计`}
        />
        <StatCard icon="🧾" iconClass="amber"
          label="本财年可扣除支出" value={formatHKD(s.expense_ytd || 0)} sub="已入账业务开支"
        />
        <StatCard icon="📑" iconClass="purple"
          label="发票总数"
          value={Object.values(s.invoice_count_by_status || {}).reduce((a, b) => a + b, 0)}
          sub="所有状态"
        />
      </div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 28 }}>
        <Link to="/invoices/new" className="btn btn-primary" style={{ flex: 1, textAlign: 'center' }}>
          ＋ 新增发票
        </Link>
        <Link to="/expenses" className="btn btn-secondary" style={{ flex: 1, textAlign: 'center' }}>
          💰 记录支出
        </Link>
      </div>
    </>
  )
}

// ══════════════════════════════════════════════════════════════════
// ── 策略四：持股架构 Dashboard ──────────────────────────────────────
// ══════════════════════════════════════════════════════════════════
function HoldingDashboard({ s }) {
  return (
    <>
      <div className="stats-grid" style={{ marginBottom: 24 }}>
        <StatCard icon="🧾" iconClass="amber"
          label="本财年已入账支出" value={formatHKD(s.expense_ytd || 0)} sub="账务记录合计"
        />
        <StatCard icon="📑" iconClass="purple"
          label="本月支出凭证"
          value={`${new Date().getMonth() + 1}月`}
          sub="查看凭证管理"
        />
      </div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 28 }}>
        <Link to="/expenses" className="btn btn-primary" style={{ flex: 1, textAlign: 'center' }}>
          💰 查看支出账务
        </Link>
      </div>
    </>
  )
}

// ══════════════════════════════════════════════════════════════════
// ── 主 Dashboard 组件 ─────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════
export default function Dashboard() {
  const { currentCompany } = useApp()
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const fyOptions = useMemo(() => buildFiscalYearOptions(), [])
  const [selectedFY, setSelectedFY] = useState(() => buildFiscalYearOptions()[0])

  useEffect(() => {
    if (!currentCompany) return
    setLoading(true)
    invoicesApi.dashboard(currentCompany.id, selectedFY)
      .then(r => setStats(r.data))
      .catch((err) => {
        console.error("Failed to load dashboard stats:", err)
      })
      .finally(() => setLoading(false))
  }, [currentCompany?.id, selectedFY])

  if (!currentCompany) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">🏢</div>
        <h3>尚未设定公司</h3>
        <p>请先新增一家公司以开始使用系统</p>
        <Link to="/companies/new" className="btn btn-primary">新增公司</Link>
      </div>
    )
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <span className="spinner" style={{ width: 32, height: 32 }} />
      </div>
    )
  }

  const s = stats || {}
  const mode = currentCompany.business_mode || 'trading_sme'

  const MODE_META = {
    insurance_agent: { icon: '🛡️', title: '保险代理业务总览', cta: '/companies/' + currentCompany.id + '/edit' },
    trading_sme:     { icon: '📦', title: '财务总览',           cta: '/invoices/new' },
    freelancer:      { icon: '🧑‍💻', title: '接案收支总览',      cta: '/invoices/new' },
    holding:         { icon: '🏛️', title: '持股架构账务',       cta: '/expenses' },
  }
  const meta = MODE_META[mode] || MODE_META.trading_sme

  return (
    <div>
      {/* 合规警告条 */}
      <ComplianceBanner companyId={currentCompany.id} />

      {/* 页头 */}
      <div className="page-header">
        <div>
          <h1 className="page-title">{meta.icon} {meta.title}</h1>
          <p className="page-subtitle" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {currentCompany.name_zh}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {/* 财年选择器 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>财年</span>
            <select
              value={selectedFY}
              onChange={e => setSelectedFY(e.target.value)}
              style={{
                fontSize: 13, fontWeight: 700,
                padding: '6px 10px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-surface)',
                color: 'var(--color-primary)',
                cursor: 'pointer',
              }}
            >
              {fyOptions.map(fy => (
                <option key={fy} value={fy}>{fy}</option>
              ))}
            </select>
          </div>
          {mode === 'trading_sme' || mode === 'freelancer' ? (
            <Link to="/invoices/new" className="btn btn-primary" id="new-invoice-btn">
              ＋ 新增发票
            </Link>
          ) : (
            <Link to={'/companies/' + currentCompany.id + '/edit'} className="btn btn-secondary">
              ✏️ 编辑公司设定
            </Link>
          )}
        </div>
      </div>

      {/* 策略路由：根据 business_mode 渲染不同 Dashboard */}
      {mode === 'insurance_agent' && <AgentDashboard s={s} company={currentCompany} fiscalYear={selectedFY} />}
      {mode === 'trading_sme'     && <SmeDashboard s={s} company={currentCompany} />}
      {mode === 'freelancer'      && <FreelancerDashboard s={s} />}
      {mode === 'holding'         && <HoldingDashboard s={s} />}

      {/* 通用最近发票表格（SME & Freelancer 才显示） */}
      {(mode === 'trading_sme' || mode === 'freelancer') && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">最新发票</span>
            <Link to="/invoices" className="btn btn-ghost btn-sm">查看全部 →</Link>
          </div>
          <RecentInvoiceTable invoices={s.recent_invoices} />
        </div>
      )}
    </div>
  )
}
