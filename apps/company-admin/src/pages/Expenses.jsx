import React, { useState, useEffect, useCallback } from 'react'
import { useApp } from '../contexts/AppContext.jsx'
import { expensesApi } from '../api/expenses.js'

// ── 常量 ─────────────────────────────────────────────────────────────────
const TAX_BADGE = {
  yes:         { label: '全额可扣', cls: 'badge-paid' },
  partial:     { label: '部分可扣', cls: 'badge-partial' },
  no:          { label: '不可扣',   cls: 'badge-overdue' },
  depreciation:{ label: '折旧摊销', cls: 'badge-draft' },
  review:      { label: '待确认',   cls: 'badge-sent' },
}

const STATUS_BADGE = {
  'ExpenseStatus.pending':   { label: '待复核', cls: 'badge-sent' },
  'ExpenseStatus.confirmed': { label: '已确认', cls: 'badge-paid' },
  'ExpenseStatus.rejected':  { label: '已驳回', cls: 'badge-void' },
  pending:   { label: '待复核', cls: 'badge-sent' },
  confirmed: { label: '已确认', cls: 'badge-paid' },
  rejected:  { label: '已驳回', cls: 'badge-void' },
}

const CATEGORY_ICONS = {
  MEAL: '🍽️', TRAVEL: '✈️', OFFICE: '📎', SOFTWARE: '💻',
  MARKETING: '📣', STAFF: '👥', PROFESSIONAL: '⚖️', EQUIPMENT: '🖥️',
  UTILITIES: '💡', RENT: '🏢', INSURANCE: '🛡️', ENTERTAINMENT: '🎭', OTHER: '📦',
}

function fmtHKD(n) {
  if (n == null) return '—'
  return 'HKD ' + Number(n).toLocaleString('zh-HK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtAmt(amount, currency) {
  if (amount == null) return '—'
  return `${currency || ''} ${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function calculateFiscalYear(dateStr) {
  if (!dateStr) return ''
  const parts = dateStr.split('-')
  if (parts.length < 2) return ''
  const year = parseInt(parts[0])
  const month = parseInt(parts[1])
  const startYear = month >= 4 ? year : year - 1
  return `${startYear}-${(startYear + 1).toString().slice(-2)}`
}

// ── 主页面组件 ────────────────────────────────────────────────────────────
export default function ExpensesPage() {
  const { currentCompany } = useApp()

  const [expenses, setExpenses]       = useState([])
  const [total, setTotal]             = useState(0)
  const [page, setPage]               = useState(1)
  const [loading, setLoading]         = useState(false)
  const [categories, setCategories]   = useState([])
  const [fiscalYears, setFiscalYears] = useState([])

  // 筛选条件
  const [filters, setFilters] = useState({
    status: 'pending',
    fiscal_year: '',
    category_code: '',
  })

  // 快捷入口：点击「薪资凭证」后自动应用筛选
  function applyPayrollFilter() {
    setFilters({ status: 'confirmed', fiscal_year: '', category_code: 'STAFF' })
    setPage(1)
  }

  function clearFilters() {
    setFilters({ status: 'pending', fiscal_year: '', category_code: '' })
    setPage(1)
  }

  // 选中的凭证（用于复核弹窗）
  const [selected, setSelected] = useState(null)
  
  // 是否显示手动录入弹窗
  const [showManualModal, setShowManualModal] = useState(false)

  // 导出
  const [showExportMenu, setShowExportMenu] = useState(false)

  // 上传区域
  const [showUpload, setShowUpload] = useState(false)
  const [uploadFiles, setUploadFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const [uploadResults, setUploadResults] = useState(null)

  // ── 数据加载 ──────────────────────────────────────────────────────────
  const loadExpenses = useCallback(async () => {
    if (!currentCompany?.id) return
    setLoading(true)
    try {
      const params = {
        company_id: currentCompany.id,
        page,
        page_size: 20,
        ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
      }
      const res = await expensesApi.list(params)
      setExpenses(res.data.items)
      setTotal(res.data.total)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [currentCompany, page, filters])

  useEffect(() => { loadExpenses() }, [loadExpenses])

  useEffect(() => {
    if (!currentCompany?.id) return
    expensesApi.categories().then(r => setCategories(r.data)).catch(() => {})
    expensesApi.statsByFiscalYear(currentCompany.id).then(r => {
      setFiscalYears(r.data.map(x => x.fiscal_year))
    }).catch(() => {})
  }, [currentCompany])

  // ── 上传 ─────────────────────────────────────────────────────────────
  async function handleUpload() {
    if (!uploadFiles.length) return
    if (!currentCompany?.id) {
      alert('上传失败：未识别到当前公司，请尝试刷新页面或重新选择公司')
      return
    }
    setUploading(true)
    setUploadResults(null)
    try {
      const res = await expensesApi.upload(currentCompany.id, uploadFiles)
      setUploadResults(res.data)
      setUploadFiles([])
      loadExpenses()
    } catch (e) {
      alert('上传失败：' + (e.response?.data?.detail || e.message))
    } finally {
      setUploading(false)
    }
  }

  // ── 确认 / 驳回 ───────────────────────────────────────────────────────
  async function handleConfirm(id) {
    await expensesApi.confirm(id)
    setSelected(null)
    loadExpenses()
  }

  async function handleReject(id, reason) {
    await expensesApi.reject(id, reason)
    setSelected(null)
    loadExpenses()
  }

  async function handleDelete(id) {
    if (!window.confirm('警告：此操作将彻底删除凭证记录和已归档的文件。确定要删除吗？')) return
    await expensesApi.delete(id)
    setSelected(null)
    loadExpenses()
  }

  // ── 按财年统计 banner ─────────────────────────────────────────────────
  const pendingCount = expenses.filter(e => {
    const s = e.status?.replace('ExpenseStatus.', '')
    return s === 'pending'
  }).length

  const PAGE_SIZE = 20
  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="animate-in">
      {/* ── 页头 ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">💰 支出凭证</h1>
          <p className="page-subtitle">AI 智能识别 · 一键归档 · 港税可扣标记</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            className="btn btn-secondary"
            onClick={() => setShowManualModal(true)}
            id="btn-manual-entry"
            style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}
          >
            ✍️ 手动记账
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => setShowUpload(v => !v)}
            id="btn-upload-toggle"
          >
            📤 上传收据
          </button>

          {/* 导出按钮（下拉选 Excel / CSV） */}
          <div style={{ position: 'relative' }}>
            <button
              className="btn btn-secondary"
              onClick={() => setShowExportMenu(v => !v)}
              id="btn-export-toggle"
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              📥 导出 <span style={{ fontSize: 10 }}>▾</span>
            </button>
            {showExportMenu && (
              <div style={{
                position: 'absolute',
                top: '110%',
                right: 0,
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                zIndex: 100,
                minWidth: 180,
                overflow: 'hidden',
              }}>
                <ExportMenuItem
                  icon="📊"
                  label="导出 Excel (.xlsx)"
                  hint="含格式、色标、汇总行"
                  onClick={() => {
                    if (!currentCompany?.id) return alert('导出失败：请先选择公司')
                    const url = expensesApi.exportUrl(currentCompany.id, 'excel', filters)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = 'expenses_export.xlsx'
                    document.body.appendChild(a)
                    a.click()
                    document.body.removeChild(a)
                    setShowExportMenu(false)
                  }}
                  id="btn-export-excel"
                />
                <ExportMenuItem
                  icon="📄"
                  label="导出 CSV (.csv)"
                  hint="通用格式，适合导入其他系统"
                  onClick={() => {
                    if (!currentCompany?.id) return alert('导出失败：请先选择公司')
                    const url = expensesApi.exportUrl(currentCompany.id, 'csv', filters)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = 'expenses_export.csv'
                    document.body.appendChild(a)
                    a.click()
                    document.body.removeChild(a)
                    setShowExportMenu(false)
                  }}
                  id="btn-export-csv"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── 上传区域 ── */}
      {showUpload && (
        <UploadPanel
          files={uploadFiles}
          setFiles={setUploadFiles}
          uploading={uploading}
          results={uploadResults}
          onUpload={handleUpload}
          onClose={() => { setShowUpload(false); setUploadResults(null) }}
        />
      )}

      {/* ── 筛选栏 ── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, padding: '14px 20px', flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-muted)' }}>状态</label>
          {[['', '全部'], ['pending', '待复核'], ['confirmed', '已确认'], ['rejected', '已驳回']].map(([v, l]) => (
            <button
              key={v}
              className={`btn btn-sm ${filters.status === v ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => { setFilters(f => ({ ...f, status: v })); setPage(1) }}
              id={`filter-status-${v || 'all'}`}
            >{l}</button>
          ))}

          <div style={{ flex: 1 }} />

          {/* 财年筛选 */}
          <select
            className="form-select"
            style={{ width: 140, padding: '6px 10px' }}
            value={filters.fiscal_year}
            onChange={e => { setFilters(f => ({ ...f, fiscal_year: e.target.value })); setPage(1) }}
            id="filter-fiscal-year"
          >
            <option value="">所有财年</option>
            {fiscalYears.map(y => <option key={y} value={y}>{y}</option>)}
          </select>

          {/* 分类筛选 */}
          <select
            className="form-select"
            style={{ width: 160, padding: '6px 10px' }}
            value={filters.category_code}
            onChange={e => { setFilters(f => ({ ...f, category_code: e.target.value })); setPage(1) }}
            id="filter-category"
          >
            <option value="">所有分类</option>
            {categories.map(c => (
              <option key={c.code} value={c.code}>
                {CATEGORY_ICONS[c.code] || '📦'} {c.name_zh}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ── 薪資 / MPF 凭證快捷篩選 ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '0 2px' }}>
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>快捷視圖：</span>
        <button
          id="filter-payroll-source"
          onClick={applyPayrollFilter}
          style={{
            background: filters.category_code === 'STAFF' && filters.status === 'confirmed'
              ? '#4F46E5' : 'var(--color-surface)',
            color: filters.category_code === 'STAFF' && filters.status === 'confirmed'
              ? '#fff' : 'var(--color-text-primary)',
            border: '1px solid var(--color-border)',
            borderRadius: 20, padding: '4px 14px', fontSize: 12, cursor: 'pointer',
            fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5,
          }}
        >
          💸 薪資 / MPF 凭證
        </button>
        <button
          id="filter-no-fiscal-year"
          onClick={() => { setFilters({ status: '', fiscal_year: 'none', category_code: '' }); setPage(1); }}
          style={{
            background: filters.fiscal_year === 'none'
              ? '#EF4444' : 'var(--color-surface)',
            color: filters.fiscal_year === 'none'
              ? '#fff' : 'var(--color-text-primary)',
            border: '1px solid var(--color-border)',
            borderRadius: 20, padding: '4px 14px', fontSize: 12, cursor: 'pointer',
            fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5,
          }}
        >
          📅 未设定财务年度
        </button>
        {(filters.category_code !== '' || filters.fiscal_year !== '' || filters.status !== 'pending') && (
          <button
            onClick={clearFilters}
            style={{ background: 'transparent', border: 'none', fontSize: 12, color: 'var(--color-text-muted)', cursor: 'pointer' }}
          >
            × 重置篩選
          </button>
        )}
      </div>

      {/* ── 待复核提示 ── */}
      {pendingCount > 0 && filters.status !== 'confirmed' && (
        <div style={{
          background: 'var(--color-warning-light)',
          border: '1px solid var(--color-warning)',
          borderRadius: 'var(--radius-md)',
          padding: '10px 16px',
          marginBottom: 16,
          fontSize: 13,
          color: '#92400E',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          ⚠️ 本页有 <strong>{pendingCount}</strong> 条 AI 识别结果等待人工复核，点击行即可查看原始凭证并确认。
        </div>
      )}

      {/* ── 主列表 ── */}
      <div className="card">
        {loading ? (
          <div style={{ padding: 60, textAlign: 'center' }}>
            <span className="spinner" style={{ width: 32, height: 32 }} />
          </div>
        ) : expenses.length === 0 ? (
          <EmptyState filters={filters} />
        ) : (
          <div className="table-container" style={{ border: 'none', borderRadius: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>凭证号</th>
                  <th>日期</th>
                  <th>商户</th>
                  <th>分类</th>
                  <th style={{ textAlign: 'right' }}>原始金额</th>
                  <th style={{ textAlign: 'right' }}>HKD 金额</th>
                  <th>港税</th>
                  <th>置信度</th>
                  <th>状态</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {expenses.map(exp => (
                  <ExpenseRow
                    key={exp.id}
                    exp={exp}
                    onClick={() => setSelected(exp)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 分页 */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: '16px 0', borderTop: '1px solid var(--color-border-light)' }}>
            <button className="btn btn-secondary btn-sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
              ← 上一页
            </button>
            <span style={{ fontSize: 13, color: 'var(--color-text-muted)', alignSelf: 'center' }}>
              {page} / {totalPages}（共 {total} 条）
            </span>
            <button className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
              下一页 →
            </button>
          </div>
        )}
      </div>

      {/* ── 复核弹窗 ── */}
      {selected && (
        <ReviewModal
          expense={selected}
          categories={categories}
          onConfirm={() => handleConfirm(selected.id)}
          onReject={(reason) => handleReject(selected.id, reason)}
          onDelete={() => handleDelete(selected.id)}
          onClose={() => setSelected(null)}
          onUpdated={() => { setSelected(null); loadExpenses() }}
        />
      )}
      
      {/* ── 手动录入弹窗 ── */}
      {showManualModal && (
        <ManualExpenseModal
          companyId={currentCompany.id}
          categories={categories}
          onClose={() => setShowManualModal(false)}
          onSuccess={() => { setShowManualModal(false); loadExpenses() }}
        />
      )}
    </div>
  )
}

// ── 列表行 ────────────────────────────────────────────────────────────────
function ExpenseRow({ exp, onClick }) {
  const status = exp.status?.replace('ExpenseStatus.', '') || exp.status
  const sb = STATUS_BADGE[status] || STATUS_BADGE[exp.status] || { label: status, cls: 'badge-draft' }
  const tb = TAX_BADGE[exp.category?.hk_tax_deductible] || { label: '—', cls: 'badge-draft' }
  const catCode = exp.category?.code || 'OTHER'
  const icon = CATEGORY_ICONS[catCode] || '📦'

  const isPending = status === 'pending'

  return (
    <tr
      onClick={onClick}
      style={{ cursor: 'pointer', background: isPending ? 'rgba(251,191,36,0.04)' : undefined }}
      id={`expense-row-${exp.id}`}
    >
      <td>
        <span style={{ fontFamily: 'monospace', fontSize: 12.5, fontWeight: 600, color: 'var(--color-primary)' }}>
          {exp.voucher_number}
        </span>
      </td>
      <td className="td-muted" style={{ whiteSpace: 'nowrap' }}>{exp.receipt_date || '—'}</td>
      <td>
        <div style={{ fontWeight: 600, fontSize: 13.5 }}>{exp.vendor_name || '—'}</div>
        <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>{exp.description?.slice(0, 30)}</div>
      </td>
      <td>
        <span style={{ fontSize: 13 }}>
          {icon} {exp.category?.name_zh || '未分类'}
        </span>
      </td>
      <td className="td-number" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
        {fmtAmt(exp.total_amount, exp.currency)}
      </td>
      <td className="td-amount" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
        {fmtHKD(exp.amount_hkd)}
      </td>
      <td>
        <span className={`badge ${tb.cls}`}>{tb.label}</span>
      </td>
      <td>
        <ConfidenceDot score={exp.ai_confidence} />
      </td>
      <td>
        <span className={`badge ${sb.cls}`}>{sb.label}</span>
      </td>
      <td>
        <button className="btn btn-ghost btn-sm" style={{ padding: '4px 8px' }}>查看 →</button>
      </td>
    </tr>
  )
}

// ── 置信度指示点 ──────────────────────────────────────────────────────────
function ConfidenceDot({ score }) {
  if (score == null) return <span style={{ color: 'var(--color-text-muted)' }}>—</span>
  const color = score >= 85 ? 'var(--color-success)' : score >= 60 ? 'var(--color-warning)' : 'var(--color-danger)'
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />
      <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{score}%</span>
    </span>
  )
}

// ── 上传面板 ─────────────────────────────────────────────────────────────
function UploadPanel({ files, setFiles, uploading, results, onUpload, onClose }) {
  function handleDrop(e) {
    e.preventDefault()
    const dropped = Array.from(e.dataTransfer.files).filter(f =>
      /\.(jpg|jpeg|png|heic|pdf)$/i.test(f.name)
    )
    setFiles(prev => [...prev, ...dropped])
  }

  return (
    <div className="card animate-in" style={{ marginBottom: 20, padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ fontWeight: 700, fontSize: 15 }}>📤 上传收据文件</h3>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
      </div>

      {/* 拖拽区域 */}
      <div
        id="drop-zone"
        onDrop={handleDrop}
        onDragOver={e => e.preventDefault()}
        onClick={() => document.getElementById('file-input').click()}
        style={{
          border: '2px dashed var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          padding: '32px 24px',
          textAlign: 'center',
          cursor: 'pointer',
          background: 'var(--color-bg)',
          transition: 'border-color 0.15s',
          marginBottom: 16,
        }}
        onDragEnter={e => e.currentTarget.style.borderColor = 'var(--color-primary)'}
        onDragLeave={e => e.currentTarget.style.borderColor = 'var(--color-border)'}
      >
        <div style={{ fontSize: 36, marginBottom: 8 }}>🧾</div>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>拖拽收据文件到此处，或点击选择</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>支持 JPG · PNG · HEIC（iPhone照片）· PDF · 多文件批量上传</div>
        <input
          id="file-input"
          type="file"
          multiple
          accept=".jpg,.jpeg,.png,.heic,.pdf"
          style={{ display: 'none' }}
          onChange={e => setFiles(prev => [...prev, ...Array.from(e.target.files)])}
        />
      </div>

      {/* 文件列表 */}
      {files.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          {files.map((f, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--color-border-light)', fontSize: 13 }}>
              <span>{/\.pdf$/i.test(f.name) ? '📄' : '🖼️'}</span>
              <span style={{ flex: 1 }}>{f.name}</span>
              <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{(f.size / 1024).toFixed(0)} KB</span>
              <button className="btn btn-ghost btn-sm" style={{ padding: '2px 6px', color: 'var(--color-danger)' }} onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        {files.length > 0 && (
          <button className="btn btn-primary" onClick={onUpload} disabled={uploading} id="btn-confirm-upload">
            {uploading ? <><span className="spinner" /> AI 识别中…</> : `🚀 开始识别（${files.length} 个文件）`}
          </button>
        )}
      </div>

      {/* 上传结果 */}
      {results && (
        <div style={{ marginTop: 16, padding: 16, background: 'var(--color-bg)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
          <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 14 }}>
            识别完成：✅ {results.success} 成功  {results.failed > 0 ? `❌ ${results.failed} 失败` : ''}
          </div>
          {results.results.map((r, i) => (
            <div key={i} style={{ fontSize: 13, marginBottom: 6, display: 'flex', gap: 10 }}>
              <span>{r.status === 'success' ? '✅' : '❌'}</span>
              <span style={{ flex: 1 }}>{r.filename}</span>
              {r.status === 'success' && (
                <span style={{ color: 'var(--color-text-muted)' }}>
                  {r.vendor_name} · {r.currency} {r.total_amount} · {r.voucher_number}
                </span>
              )}
              {r.status === 'error' && (
                <span style={{ color: 'var(--color-danger)', fontSize: 12 }}>{r.error}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ReviewModal({ expense, categories, onConfirm, onReject, onDelete, onClose, onUpdated }) {
  const [editing, setEditing] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [showReject, setShowReject] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    vendor_name: expense.vendor_name || '',
    description: expense.description || '',
    receipt_date: expense.receipt_date || '',
    currency: expense.currency || 'HKD',
    total_amount: expense.total_amount || '',
    category_code: expense.category?.code || '',
    notes: expense.notes || '',
    fiscal_year: expense.fiscal_year || '',
  })

  const currentYear = new Date().getFullYear()
  const yearOptions = []
  for (let i = currentYear - 4; i <= currentYear + 1; i++) {
    yearOptions.push(`${i}-${(i + 1).toString().slice(-2)}`)
  }
  if (form.fiscal_year && !yearOptions.includes(form.fiscal_year)) {
    yearOptions.push(form.fiscal_year)
  }
  yearOptions.sort().reverse()

  const handleDateChange = (e) => {
    const val = e.target.value
    const calculated = calculateFiscalYear(val)
    setForm(f => ({ ...f, receipt_date: val, fiscal_year: calculated }))
  }

  const imageUrl = expensesApi.receiptImageUrl(expense.receipt_image_path)
  const status = expense.status?.replace('ExpenseStatus.', '') || expense.status
  const isPending = status === 'pending'
  const tb = TAX_BADGE[expense.category?.hk_tax_deductible] || { label: '—', cls: 'badge-draft' }

  async function handleSave() {
    setSaving(true)
    try {
      await expensesApi.update(expense.id, form)
      onUpdated()
    } catch (e) {
      alert('保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 840, width: '95%' }} id={`review-modal-${expense.id}`}>
        {/* 头部 */}
        <div className="modal-header">
          <div>
            <div style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--color-primary)', marginBottom: 2 }}>
              {expense.voucher_number}
            </div>
            <div className="modal-title">凭证复核</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className={`badge ${STATUS_BADGE[status]?.cls || 'badge-draft'}`}>
              {STATUS_BADGE[status]?.label || status}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ padding: '4px 8px' }}>✕</button>
          </div>
        </div>

        <div className="modal-body" style={{ padding: 0 }}>
          {/* 两栏布局：左图 右表单 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', minHeight: 420 }}>
            {/* 左侧：原始收据图片/文件 */}
            <div style={{
              background: '#0F172A',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 20,
              borderRight: '1px solid var(--color-border)',
              minHeight: 360,
              position: 'relative',
              gap: 12,
            }}>
              {imageUrl ? (
                expense.source_format === 'pdf' ? (
                  <>
                    <embed
                      src={imageUrl}
                      type="application/pdf"
                      style={{ width: '100%', height: 420, borderRadius: 8, border: 'none' }}
                    />
                    <a href={imageUrl} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', textDecoration: 'underline' }}>
                      📄 在新窗口打开 PDF
                    </a>
                  </>
                ) : (
                  <>
                    <img
                      src={imageUrl}
                      alt="原始收据"
                      style={{ maxWidth: '100%', maxHeight: 460, objectFit: 'contain', borderRadius: 8 }}
                      onError={e => {
                        e.target.style.display = 'none'
                        const fb = document.getElementById('img-fallback-' + expense.id)
                        if (fb) fb.style.display = 'flex'
                      }}
                    />
                    <div id={'img-fallback-' + expense.id}
                      style={{ display: 'none', flexDirection: 'column', alignItems: 'center', gap: 8, color: 'rgba(255,255,255,0.4)' }}>
                      <span style={{ fontSize: 48 }}>🖼️</span>
                      <span style={{ fontSize: 13 }}>图片加载失败</span>
                    </div>
                    <a href={imageUrl} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', textDecoration: 'underline' }}>
                      🔗 在新窗口打开原图
                    </a>
                  </>
                )
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: 'rgba(255,255,255,0.4)' }}>
                  <span style={{ fontSize: 48 }}>🧾</span>
                  <span style={{ fontSize: 13 }}>暂无文件预览</span>
                  <span style={{ fontSize: 11.5 }}>{expense.receipt_original_filename}</span>
                </div>
              )}

              {/* 置信度指示 */}
              {expense.ai_confidence != null && (
                <div style={{
                  position: 'absolute',
                  top: 12,
                  right: 12,
                  background: expense.ai_confidence >= 85 ? 'rgba(16,185,129,0.85)' : 'rgba(245,158,11,0.85)',
                  color: 'white',
                  borderRadius: 20,
                  padding: '3px 10px',
                  fontSize: 12,
                  fontWeight: 700,
                }}>
                  AI {expense.ai_confidence}%
                </div>
              )}
            </div>

            {/* 右侧：AI 提取结果 */}
            <div style={{ padding: 24, overflowY: 'auto', maxHeight: 560 }}>
              {editing ? (
                /* ── 编辑模式 ── */
                <div>
                  <div style={{ fontWeight: 700, marginBottom: 16, color: 'var(--color-warning)' }}>✏️ 编辑模式</div>
                  <div className="form-group">
                    <label className="form-label">商户名称</label>
                    <input className="form-input" value={form.vendor_name} onChange={e => setForm(f => ({ ...f, vendor_name: e.target.value }))} id="edit-vendor-name" />
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">收据日期</label>
                      <input type="date" className="form-input" value={form.receipt_date} onChange={handleDateChange} id="edit-date" />
                    </div>
                    <div className="form-group">
                      <label className="form-label">货币</label>
                      <select className="form-select" value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))} id="edit-currency">
                        {['HKD', 'CNY', 'USD', 'EUR', 'GBP', 'JPY', 'SGD', 'AUD'].map(c => <option key={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">财政年度</label>
                    <select className="form-select" value={form.fiscal_year} onChange={e => setForm(f => ({ ...f, fiscal_year: e.target.value }))} id="edit-fiscal-year">
                      <option value="">— 选择财年 —</option>
                      {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">含税总金额</label>
                    <input type="number" className="form-input" value={form.total_amount} onChange={e => setForm(f => ({ ...f, total_amount: e.target.value }))} id="edit-amount" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">支出分类</label>
                    <select className="form-select" value={form.category_code} onChange={e => setForm(f => ({ ...f, category_code: e.target.value }))} id="edit-category">
                      <option value="">— 选择分类 —</option>
                      {categories.map(c => (
                        <option key={c.code} value={c.code}>
                          {CATEGORY_ICONS[c.code] || '📦'} {c.name_zh}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">摘要描述</label>
                    <textarea className="form-textarea" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} id="edit-description" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">备注</label>
                    <textarea className="form-textarea" style={{ minHeight: 60 }} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} id="edit-notes" />
                  </div>
                </div>
              ) : (
                /* ── 显示模式 ── */
                <div>
                  <FieldRow label="商户" value={expense.vendor_name} highlight />
                  <FieldRow label="日期" value={expense.receipt_date} />
                  <FieldRow label="财政年度" value={expense.fiscal_year} />
                  <FieldRow label="发票类型" value={RECEIPT_TYPE_LABEL[expense.receipt_type] || expense.receipt_type} />

                  <div style={{ borderTop: '1px solid var(--color-border-light)', margin: '14px 0' }} />

                  <FieldRow label="货币" value={expense.currency} />
                  <FieldRow label="原始金额" value={fmtAmt(expense.total_amount, expense.currency)} highlight />
                  <FieldRow label="港元换算" value={fmtHKD(expense.amount_hkd)} highlight />

                  {expense.tax_rate != null && (
                    <FieldRow label="税率" value={`${(expense.tax_rate * 100).toFixed(0)}%`} />
                  )}
                  {expense.vendor_tax_id && (
                    <FieldRow label="纳税人识别号" value={expense.vendor_tax_id} mono />
                  )}
                  {expense.cn_invoice_number && (
                    <FieldRow label="发票号码" value={expense.cn_invoice_number} mono />
                  )}

                  <div style={{ borderTop: '1px solid var(--color-border-light)', margin: '14px 0' }} />

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)' }}>支出分类</span>
                    <span style={{ fontSize: 13.5 }}>{CATEGORY_ICONS[expense.category?.code] || '📦'} {expense.category?.name_zh || '未分类'}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)' }}>港税可扣</span>
                    <span className={`badge ${tb.cls}`}>{tb.label}</span>
                  </div>
                  {expense.category?.hk_tax_note && (
                    <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', background: 'var(--color-bg)', padding: '6px 10px', borderRadius: 6, marginBottom: 12, lineHeight: 1.6 }}>
                      ℹ️ {expense.category.hk_tax_note}
                    </div>
                  )}

                  {expense.description && (
                    <>
                      <div style={{ borderTop: '1px solid var(--color-border-light)', margin: '14px 0' }} />
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 4 }}>摘要</div>
                      <div style={{ fontSize: 13, lineHeight: 1.6 }}>{expense.description}</div>
                    </>
                  )}
                  {expense.notes && (
                    <div style={{ marginTop: 10, fontSize: 12, color: 'var(--color-text-muted)', background: 'var(--color-warning-light)', padding: '6px 10px', borderRadius: 6 }}>
                      📝 {expense.notes}
                    </div>
                  )}
                </div>
              )}

              {/* 驳回理由输入 */}
              {showReject && (
                <div style={{ marginTop: 16, padding: 14, background: 'var(--color-danger-light)', borderRadius: 8 }}>
                  <div style={{ fontWeight: 600, marginBottom: 8, color: 'var(--color-danger)', fontSize: 13 }}>驳回原因（可选）</div>
                  <textarea
                    className="form-textarea"
                    style={{ minHeight: 60 }}
                    placeholder="例：重复录入、图片模糊无法确认、非公司业务支出…"
                    value={rejectReason}
                    onChange={e => setRejectReason(e.target.value)}
                    id="reject-reason-input"
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 底部操作 */}
        <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {/* 编辑 / 保存 */}
            {editing ? (
              <>
                <button className="btn btn-secondary btn-sm" onClick={() => setEditing(false)}>取消</button>
                <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving} id="btn-save-edit">
                  {saving ? '保存中…' : '💾 保存修改'}
                </button>
              </>
            ) : (
              <>
                <button className="btn btn-secondary btn-sm" onClick={() => setEditing(true)} id="btn-edit">
                  ✏️ 修正
                </button>
                <button className="btn btn-danger btn-sm" onClick={onDelete} id="btn-delete" style={{ background: 'var(--color-danger)', border: 'none' }}>
                  🗑️ 删除记录
                </button>
              </>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            {/* 驳回 */}
            {isPending && !showReject && (
              <button
                className="btn btn-danger btn-sm"
                onClick={() => setShowReject(true)}
                id="btn-reject"
              >
                ✕ 驳回
              </button>
            )}
            {showReject && (
              <>
                <button className="btn btn-secondary btn-sm" onClick={() => setShowReject(false)}>取消</button>
                <button className="btn btn-danger btn-sm" onClick={() => onReject(rejectReason)} id="btn-confirm-reject">
                  确认驳回
                </button>
              </>
            )}

            {/* 确认 */}
            {isPending && !showReject && (
              <button
                className="btn btn-primary btn-sm"
                onClick={onConfirm}
                id="btn-confirm"
                style={{ background: 'var(--color-success)' }}
              >
                ✓ 确认入账
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── 辅助子组件 ────────────────────────────────────────────────────────────
function FieldRow({ label, value, highlight, mono }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', minWidth: 80 }}>{label}</span>
      <span style={{
        fontSize: highlight ? 14 : 13.5,
        fontWeight: highlight ? 700 : 400,
        fontFamily: mono ? 'monospace' : 'inherit',
        color: highlight ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
        textAlign: 'right',
      }}>
        {value || '—'}
      </span>
    </div>
  )
}

function EmptyState({ filters }) {
  const isPending = filters.status === 'pending'
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{isPending ? '🎉' : '🔍'}</div>
      <h3>{isPending ? '没有待复核的凭证' : '没有符合条件的记录'}</h3>
      <p>{isPending ? '所有 AI 识别结果已复核完毕，太棒了！' : '尝试调整筛选条件'}</p>
    </div>
  )
}

const RECEIPT_TYPE_LABEL = {
  cn_vat_special: '增值税专用发票',
  cn_vat_general: '增值税普通发票',
  cn_ordinary:    '内地普通收据',
  hk_receipt:     '香港收据',
  other:          '其他',
}

// ── 导出菜单项 ───────────────────────────────────────────────────────────
function ExportMenuItem({ icon, label, hint, onClick, id }) {
  return (
    <button
      id={id}
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        width: '100%',
        padding: '12px 16px',
        background: 'none',
        border: 'none',
        borderBottom: '1px solid var(--color-border-light)',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'background 0.12s',
      }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg)'}
      onMouseLeave={e => e.currentTarget.style.background = 'none'}
    >
      <div style={{ fontWeight: 600, fontSize: 13.5 }}>{icon} {label}</div>
      <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginTop: 2 }}>{hint}</div>
    </button>
  )
}

// ── 手动记账弹窗 ─────────────────────────────────────────────────────────────
function ManualExpenseModal({ companyId, categories, onClose, onSuccess }) {
  const [form, setForm] = useState({
    company_id: companyId,
    receipt_date: new Date().toISOString().split('T')[0],
    vendor_name: '',
    category_code: '',
    currency: 'HKD',
    total_amount: '',
    description: '',
    notes: ''
  })
  const [saving, setSaving] = useState(false)

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    try {
      await expensesApi.addManual(form)
      onSuccess()
    } catch (err) {
      alert('保存失败：' + (err.response?.data?.detail || err.message))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 500, width: '95%' }}>
        <div className="modal-header">
          <div className="modal-title">✍️ 手动记账 (无发票凭证)</div>
        </div>
        <form onSubmit={handleSave}>
          <div className="modal-body" style={{ display: 'grid', gap: 16 }}>
            <div className="form-group">
              <label className="form-label">消费日期 <span className="text-danger">*</span></label>
              <input type="date" className="form-control" required value={form.receipt_date} onChange={e => setForm({...form, receipt_date: e.target.value})} />
            </div>
            <div className="form-group">
              <label className="form-label">商户/收款方 <span className="text-danger">*</span></label>
              <input type="text" className="form-control" required value={form.vendor_name} onChange={e => setForm({...form, vendor_name: e.target.value})} placeholder="例如: 某某餐厅、的士" />
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
              <div className="form-group">
                <label className="form-label">币种</label>
                <select className="form-control" value={form.currency} onChange={e => setForm({...form, currency: e.target.value})}>
                  <option value="HKD">HKD</option>
                  <option value="CNY">CNY</option>
                  <option value="USD">USD</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">金额 <span className="text-danger">*</span></label>
                <input type="number" step="0.01" className="form-control" required value={form.total_amount} onChange={e => setForm({...form, total_amount: e.target.value})} />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">支出分类 <span className="text-danger">*</span></label>
              <select className="form-control" required value={form.category_code} onChange={e => setForm({...form, category_code: e.target.value})}>
                <option value="">请选择分类...</option>
                {categories.map(c => <option key={c.code} value={c.code}>{c.name_zh}</option>)}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">摘要说明</label>
              <input type="text" className="form-control" value={form.description} onChange={e => setForm({...form, description: e.target.value})} placeholder="简短说明支出用途" />
            </div>

            <div className="form-group">
              <label className="form-label">备注 / 缺少发票原因</label>
              <textarea className="form-control" rows={2} value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} placeholder="请输入原因，例如：的士丢失收据、私人转账无需收据等" />
            </div>
          </div>
          <div className="modal-footer" style={{ gap: 10 }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>取消</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? '保存中...' : '确认入账'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
