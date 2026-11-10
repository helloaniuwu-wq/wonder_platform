import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../contexts/AppContext.jsx'
import { commissionsApi } from '../api/index.js'

const fmt = (v) =>
  v == null ? '—' : `HKD ${Number(v).toLocaleString('zh-HK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const STATUS_LABELS = {
  pending:   { label: '待确认', color: '#F59E0B', bg: '#FEF3C7' },
  confirmed: { label: '已确认', color: '#10B981', bg: '#D1FAE5' },
  rejected:  { label: '已驳回', color: '#EF4444', bg: '#FEE2E2' },
}

// ── 当前及往前3个财年 ────────────────────────────────────────────────────
function getCurrentFiscalYear() {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth() + 1
  const start = m >= 4 ? y : y - 1
  return `${start}-${String(start + 1).slice(-2)}`
}
function buildFiscalYearOptions() {
  const fy = getCurrentFiscalYear()
  const startYear = parseInt(fy.slice(0, 4))
  return Array.from({ length: 4 }, (_, i) => {
    const y = startYear - i
    return `${y}-${String(y + 1).slice(-2)}`
  })
}

export default function Commissions() {
  const { currentCompany } = useApp()
  const companyId = currentCompany?.id

  const [fiscalYear, setFiscalYear]   = useState(getCurrentFiscalYear())
  const [statements, setStatements]   = useState([])
  const [summary, setSummary]         = useState(null)
  const [profit, setProfit]           = useState(null)
  const [loading, setLoading]         = useState(false)
  const [uploading, setUploading]     = useState(false)
  const [selectedStmt, setSelectedStmt] = useState(null)
  const [detailOpen, setDetailOpen]   = useState(false)
  const [editMonth, setEditMonth]     = useState('')
  const [toast, setToast]             = useState(null)
  const [confirmingId, setConfirmingId] = useState(null)
  const [ir56ms, setIr56ms]           = useState([])
  const [showUpload, setShowUpload]   = useState(false)
  const [showManualModal, setShowManualModal] = useState(false)

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  const loadAll = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    try {
      const [listRes, summaryRes, profitRes, ir56mRes] = await Promise.all([
        commissionsApi.list(companyId, { fiscal_year: fiscalYear }),
        commissionsApi.annualSummary(companyId, fiscalYear).catch(() => null),
        commissionsApi.profitSummary(companyId, fiscalYear).catch(() => null),
        commissionsApi.getIR56Ms(companyId, { fiscal_year: fiscalYear }).catch(() => null),
      ])
      setStatements(listRes.data || [])
      setSummary(summaryRes?.data || null)
      setProfit(profitRes?.data || null)
      setIr56ms(ir56mRes?.data || [])
    } catch (e) {
      showToast('加载数据失败：' + (e.response?.data?.detail || e.message), 'error')
    } finally {
      setLoading(false)
    }
  }, [companyId, fiscalYear])

  useEffect(() => { loadAll() }, [loadAll])

  const handleConfirmIR56M = async (id) => {
    setConfirmingId(id)
    try {
      await commissionsApi.confirmIR56M(companyId, id)
      showToast('IR56M 已确认')
      loadAll()
    } catch (e) {
      showToast('操作失败', 'error')
    } finally {
      setConfirmingId(null)
    }
  }

  // ── 确认 / 驳回 ───────────────────────────────────────────────────────
  const handleConfirm = async (id) => {
    setConfirmingId(id)
    try {
      if (selectedStmt && selectedStmt.id === id && editMonth && editMonth !== selectedStmt.statement_month) {
        await commissionsApi.update(companyId, id, { statement_month: editMonth })
      }
      await commissionsApi.confirm(companyId, id)
      showToast('已确认')
      loadAll()
      setDetailOpen(false)
    } catch (e) {
      showToast('操作失败', 'error')
    } finally {
      setConfirmingId(null)
    }
  }

  const handleReject = async (id) => {
    try {
      await commissionsApi.reject(companyId, id)
      showToast('已驳回')
      loadAll()
      setDetailOpen(false)
    } catch (e) {
      showToast('操作失败', 'error')
    }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('确定要删除此佣金记录吗？此操作无法撤销。')) return
    try {
      await commissionsApi.delete(companyId, id)
      showToast('已删除')
      loadAll()
      setDetailOpen(false)
    } catch (e) {
      showToast('删除失败', 'error')
    }
  }

  // ── 打开详情 ──────────────────────────────────────────────────────────
  const openDetail = async (stmt) => {
    try {
      const res = await commissionsApi.get(companyId, stmt.id)
      setSelectedStmt(res.data)
      setEditMonth(res.data.statement_month || '')
      setDetailOpen(true)
    } catch {
      setSelectedStmt(stmt)
      setEditMonth(stmt.statement_month || '')
      setDetailOpen(true)
    }
  }

  const fyOptions = buildFiscalYearOptions()
  const confirmedCount = statements.filter(s => s.status === 'confirmed').length
  const pendingCount   = statements.filter(s => s.status === 'pending').length

  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>

      {/* ── 左侧主区 ── */}
      <div style={{ flex: 1, minWidth: 0 }}>

        {/* 页头 */}
        <div className="page-header" style={{ marginBottom: 20 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>📈 佣金台账</h2>
            <p style={{ margin: '4px 0 0', color: 'var(--color-text-muted)', fontSize: 13 }}>
              AIA 月结单管理 · 税务申报数据源
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {/* 财年筛选 */}
            <select
              value={fiscalYear}
              onChange={e => setFiscalYear(e.target.value)}
              className="form-input"
              style={{ width: 120, fontSize: 13 }}
            >
              {fyOptions.map(fy => (
                <option key={fy} value={fy}>{fy} 财年</option>
              ))}
            </select>

            {/* 手动新增额外收入 */}
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setShowManualModal(true)}
              disabled={!companyId}
              style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}
            >
              ✍️ 额外收入
            </button>

            {/* 上传报表 */}
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setShowUpload(v => !v)}
              disabled={!companyId}
            >
              📤 上传报表
            </button>
          </div>
        </div>

        {/* ── 上传区域 ── */}
        {showUpload && (
          <UploadPanel
            companyId={companyId}
            onClose={() => setShowUpload(false)}
            onUploaded={() => loadAll()}
            showToast={showToast}
          />
        )}

        {/* ── 手动录入弹窗 ── */}
        {showManualModal && (
          <ManualIncomeModal
            companyId={companyId}
            onClose={() => setShowManualModal(false)}
            onSuccess={() => { setShowManualModal(false); loadAll(); showToast('额外收入已成功保存！') }}
          />
        )}

        {/* 状态概览条 */}
        {statements.length > 0 && (
          <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
            {[
              { label: `已确认 ${confirmedCount} 份`, bg: '#D1FAE5', color: '#065F46' },
              { label: `待确认 ${pendingCount} 份`, bg: '#FEF3C7', color: '#92400E' },
              { label: `共 ${statements.length} 份`, bg: '  var(--color-surface)', color: 'var(--color-text-secondary)' },
            ].map((item, i) => (
              <span key={i} style={{
                padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                background: item.bg, color: item.color,
              }}>{item.label}</span>
            ))}
          </div>
        )}

        {/* IR56M 列表 */}
        {ir56ms.length > 0 && (
          <div style={{ background: '#F8FAFC', border: '1px solid #CBD5E1', borderRadius: 12, overflow: 'hidden', marginBottom: 20, boxShadow: 'var(--shadow-sm)' }}>
             <div style={{ padding: '12px 16px', background: '#E2E8F0', fontWeight: 700, fontSize: 14, color: '#334155' }}>
               📄 IR56M 报税表 (报税依据)
             </div>
             <table className="table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>代理人</th>
                    <th>期间</th>
                    <th style={{ textAlign: 'right', color: 'var(--color-primary)' }}>年收入合计</th>
                    <th style={{ textAlign: 'center' }}>状态</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {ir56ms.map(s => {
                    const stLabel = STATUS_LABELS[s.status] || STATUS_LABELS.pending
                    return (
                      <tr key={s.id}>
                        <td style={{ fontWeight: 600 }}>{s.agent_name} <span style={{fontSize:11, color:'gray'}}>({s.agent_code})</span></td>
                        <td>{s.period_start} - {s.period_end}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--color-primary)', fontSize: 16 }}>
                          {s.total_income ? `HKD ${Number(s.total_income).toLocaleString('zh-HK', { minimumFractionDigits: 0 })}` : '—'}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <span style={{
                            padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                            background: stLabel.bg, color: stLabel.color,
                          }}>
                            {stLabel.label}
                          </span>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {s.status === 'pending' && (
                            <button
                              className="btn btn-sm"
                              style={{ background: '#D1FAE5', color: '#065F46', fontSize: 11, padding: '3px 10px' }}
                              disabled={confirmingId === s.id}
                              onClick={() => handleConfirmIR56M(s.id)}
                            >
                              {confirmingId === s.id ? '...' : '✓ 确认'}
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
             </table>
          </div>
        )}

        {/* 月结单列表 */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-muted)' }}>
            加载中...
          </div>
        ) : (
          <div style={{ background: '  var(--color-surface)', borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
            {statements.length > 0 ? (
              <table className="table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>月份</th>
                    <th style={{ textAlign: 'right' }}>首年佣金 (A)</th>
                    <th style={{ textAlign: 'right' }}>续保佣金 (B)</th>
                    <th style={{ textAlign: 'right' }}>其他收入 (C)</th>
                    <th style={{ textAlign: 'right', fontWeight: 700, color: 'var(--color-primary)' }}>
                      应税总额 A+B+C
                    </th>
                    <th style={{ textAlign: 'right' }}>实际到账</th>
                    <th style={{ textAlign: 'center' }}>状态</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {statements.map(s => {
                    const stLabel = STATUS_LABELS[s.status] || STATUS_LABELS.pending
                    return (
                      <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => openDetail(s)}>
                        <td style={{ fontWeight: 600 }}>{s.statement_month}</td>
                        <td style={{ textAlign: 'right', fontSize: 13 }}>
                          {s.fyc_subtotal ? `${Number(s.fyc_subtotal).toLocaleString()}` : '—'}
                        </td>
                        <td style={{ textAlign: 'right', fontSize: 13 }}>
                          {s.renewal_subtotal ? `${Number(s.renewal_subtotal).toLocaleString()}` : '—'}
                        </td>
                        <td style={{ textAlign: 'right', fontSize: 13 }}>
                          {s.other_taxable_income ? `${Number(s.other_taxable_income).toLocaleString()}` : '—'}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--color-primary)' }}>
                          {s.total_taxable_income
                            ? `HKD ${Number(s.total_taxable_income).toLocaleString('zh-HK', { minimumFractionDigits: 0 })}`
                            : '—'}
                        </td>
                        <td style={{ textAlign: 'right', fontSize: 13, color: 'var(--color-text-secondary)' }}>
                          {s.payment_this_month ? `${Number(s.payment_this_month).toLocaleString()}` : '—'}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <span style={{
                            padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                            background: stLabel.bg, color: stLabel.color,
                          }}>
                            {stLabel.label}
                          </span>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {s.status === 'pending' && (
                            <button
                              className="btn btn-sm"
                              style={{ background: '#D1FAE5', color: '#065F46', fontSize: 11, padding: '3px 10px' }}
                              disabled={confirmingId === s.id}
                              onClick={e => { e.stopPropagation(); handleConfirm(s.id) }}
                            >
                              {confirmingId === s.id ? '...' : '✓ 确认'}
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            ) : (
              <div style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                此财年暂无月结单
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── 右侧汇总面板 ── */}
      <div style={{ width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* BIR60 数据卡 */}
        <div className="card" style={{ padding: '20px', background: 'linear-gradient(135deg, #1E3A5F 0%, #2563EB 100%)', color: 'white', borderRadius: 14 }}>
          <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 12, fontWeight: 600, letterSpacing: 1 }}>
            📋 BIR60 申报数据 · {fiscalYear} 财年
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <SummaryRow label="首年佣金 (A)" value={summary?.total_fyc_subtotal} light />
            <SummaryRow label="续保佣金 (B)" value={summary?.total_renewal_subtotal} light />
            <SummaryRow label="其他应税收入 (C)" value={summary?.total_other_income} light />
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.3)', paddingTop: 10, marginTop: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>应税总额 (A+B+C)</span>
                <span style={{ fontSize: 20, fontWeight: 800 }}>
                  {summary?.total_taxable_income != null
                    ? `$${Number(summary.total_taxable_income).toLocaleString('zh-HK', { minimumFractionDigits: 0 })}`
                    : '—'}
                </span>
              </div>
            </div>
          </div>

          {/* 月份进度 */}
          <div style={{ marginTop: 14, padding: '10px', background: 'rgba(255,255,255,0.12)', borderRadius: 8 }}>
            <div style={{ fontSize: 11, opacity: 0.9, marginBottom: 6 }}>
              已确认月份进度
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {summary?.monthly_breakdown?.map(m => (
                <span key={m.month} style={{
                  padding: '2px 6px', borderRadius: 6, fontSize: 10, fontWeight: 600,
                  background: m.status === 'confirmed' ? '#10B981' : 'rgba(255,255,255,0.2)',
                  color: 'white',
                }}>
                  {m.month.slice(5)}
                </span>
              ))}
            </div>
            {summary?.missing_months?.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 11, color: '#FCD34D' }}>
                ⚠️ 缺失：{summary.missing_months.map(m => m.slice(5)).join(', ')}
              </div>
            )}
          </div>

          {/* YTD 校验 */}
          {summary?.ytd_check != null && (
            <div style={{ marginTop: 10, fontSize: 11, opacity: 0.85 }}>
              截图 YTD 核对：
              <span style={{ marginLeft: 6, fontWeight: 700, color: Math.abs(summary.ytd_variance) < 1 ? '#6EE7B7' : '#FCD34D' }}>
                {Math.abs(summary.ytd_variance) < 1 ? '✓ 一致' : `差额 HKD ${summary.ytd_variance?.toLocaleString()}`}
              </span>
            </div>
          )}
        </div>

        {/* 利润估算卡 */}
        {profit && (
          <div className="card" style={{ padding: '18px', borderRadius: 14 }}>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600, marginBottom: 12, letterSpacing: 1 }}>
              💹 应评税利润估算
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <SummaryRow label="应税收入" value={profit.total_taxable_income} />
              <SummaryRow label="已确认支出" value={-profit.total_confirmed_expense} negative />
              <div style={{ borderTop: '1px solid var(--color-border-light)', paddingTop: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>估算税前利润</span>
                  <span style={{
                    fontSize: 18, fontWeight: 800,
                    color: profit.estimated_profit >= 0 ? 'var(--color-success)' : 'var(--color-danger)',
                  }}>
                    {profit.estimated_profit != null
                      ? `$${Number(profit.estimated_profit).toLocaleString('zh-HK', { minimumFractionDigits: 0 })}`
                      : '—'}
                  </span>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px', background: '#FEF3C7', borderRadius: 8 }}>
                <span style={{ fontSize: 12, color: '#92400E', fontWeight: 600 }}>利得税估算</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#92400E' }}>
                  {profit.profits_tax_estimate != null
                    ? `HKD ${Number(profit.profits_tax_estimate).toLocaleString('zh-HK', { minimumFractionDigits: 0 })}`
                    : '—'}
                </span>
              </div>
              <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 4 }}>
                {profit.income_source === 'ir56m' ? (
                  <span style={{ color: '#059669', fontWeight: 600 }}>✓ 收入已采用 IR56M</span>
                ) : (
                  <span style={{ color: '#D97706' }}>⚠️ 取自月结单累加 (无 IR56M)</span>
                )}
                <br/>
                首200万@7.5%，超出部分@15%
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── 详情弹窗 ── */}
      {detailOpen && selectedStmt && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000, padding: 20,
        }} onClick={() => setDetailOpen(false)}>
          <div
            style={{ background: '  var(--color-surface)', borderRadius: 16, padding: 28, width: '100%', maxWidth: 600, maxHeight: '85vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
              <div>
                <h3 style={{ margin: 0 }}>{selectedStmt.insurer_name}</h3>
                <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 4, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {selectedStmt.status !== 'confirmed' ? (
                    <input
                      type="month"
                      value={editMonth}
                      onChange={e => setEditMonth(e.target.value)}
                      style={{ padding: '2px 6px', fontSize: 12, border: '1px solid var(--color-border)', borderRadius: 4 }}
                    />
                  ) : (
                    <span>{selectedStmt.statement_month}</span>
                  )}
                  <span>· {selectedStmt.agent_code} · {selectedStmt.agent_name}</span>
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setDetailOpen(false)}>✕</button>
            </div>

            {/* 核心数字 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
              <DetailCard label="首年佣金合计 (A)" value={fmt(selectedStmt.fyc_subtotal)} highlight />
              <DetailCard label="续保佣金合计 (B)" value={fmt(selectedStmt.renewal_subtotal)} highlight />
              <DetailCard label="其他应税收入 (C)" value={fmt(selectedStmt.other_taxable_income)} />
              <DetailCard label="应税总额 A+B+C" value={fmt(selectedStmt.total_taxable_income)} primary />
            </div>

            {/* 细分（若有） */}
            {selectedStmt.fyc_life_annual != null && (
              <details style={{ marginBottom: 16 }}>
                <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--color-text-muted)', fontWeight: 600, marginBottom: 8 }}>
                  ▶ 首年佣金细分
                </summary>
                <div style={{ paddingLeft: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {[
                    ['LIFE - Annual', selectedStmt.fyc_life_annual],
                    ['LIFE - Semi-Annual', selectedStmt.fyc_life_semi_annual],
                    ['LIFE - Quarterly', selectedStmt.fyc_life_quarterly],
                    ['LIFE - Monthly', selectedStmt.fyc_life_monthly],
                    ['LIFE - 10% Extra', selectedStmt.fyc_life_extra],
                    ['Personal Accident', selectedStmt.fyc_pa],
                    ['MPF', selectedStmt.fyc_mpf],
                  ].filter(([, v]) => v != null && v !== 0).map(([l, v]) => (
                    <div key={l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span style={{ color: 'var(--color-text-muted)' }}>{l}</span>
                      <span>{fmt(v)}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}

            {/* 杂项 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
              {[
                ['MISC. INCOME & DEDUCTION', selectedStmt.misc_deduction],
                ['INITIAL FYC / ALLOWANCE', selectedStmt.allowance_offset],
                ['PAYMENT THIS MONTH', selectedStmt.payment_this_month],
              ].map(([l, v]) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span style={{ color: 'var(--color-text-muted)' }}>{l}</span>
                  <span style={{ color: Number(v) < 0 ? 'var(--color-danger)' : 'inherit' }}>{fmt(v)}</span>
                </div>
              ))}
            </div>

            {/* YTD */}
            {selectedStmt.ytd_total_taxable != null && (
              <div style={{ background: 'var(--color-bg-hover)', borderRadius: 8, padding: '10px 14px', marginBottom: 20, fontSize: 12 }}>
                <span style={{ color: 'var(--color-text-muted)' }}>YTD 应税总额（核对用）</span>
                <span style={{ float: 'right', fontWeight: 700 }}>{fmt(selectedStmt.ytd_total_taxable)}</span>
              </div>
            )}

            {/* AI 置信度 */}
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 20 }}>
              AI 识别置信度：<strong>{selectedStmt.ai_confidence ?? '—'}%</strong>
            </div>

            {/* 操作按钮 */}
            {(selectedStmt.status === 'pending' || selectedStmt.status === 'rejected') && (
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  className="btn btn-primary"
                  style={{ flex: 1 }}
                  disabled={confirmingId === selectedStmt.id}
                  onClick={() => handleConfirm(selectedStmt.id)}
                >
                  {confirmingId === selectedStmt.id ? '处理中...' : '✓ 确认此月结单'}
                </button>
                {selectedStmt.status === 'pending' && (
                  <button
                    className="btn btn-ghost"
                    onClick={() => handleReject(selectedStmt.id)}
                  >
                    驳回
                  </button>
                )}
              </div>
            )}
            {selectedStmt.status === 'confirmed' && (
              <div style={{ textAlign: 'center', color: '#10B981', fontWeight: 600, fontSize: 14 }}>✓ 已确认</div>
            )}
            
            {/* 删除按钮 */}
            <div style={{ marginTop: 24, textAlign: 'center' }}>
              <button
                className="btn btn-ghost btn-sm"
                style={{ color: 'var(--color-danger)' }}
                onClick={() => handleDelete(selectedStmt.id)}
              >
                🗑️ 删除此记录
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          background: toast.type === 'error' ? '#EF4444' : '#10B981',
          color: 'white', borderRadius: 10, padding: '12px 20px',
          fontSize: 14, fontWeight: 600, boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          animation: 'slideIn 0.3s ease',
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}

// ── 小组件 ───────────────────────────────────────────────────────────────
function SummaryRow({ label, value, light, negative }) {
  const display = value != null
    ? (negative
        ? `(HKD ${Math.abs(Number(value)).toLocaleString('zh-HK', { minimumFractionDigits: 0 })})`
        : `HKD ${Number(value).toLocaleString('zh-HK', { minimumFractionDigits: 0 })}`)
    : '—'
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
      <span style={{ opacity: light ? 0.75 : 0.65 }}>{label}</span>
      <span style={{ fontWeight: 600, opacity: light ? 0.9 : 1 }}>{display}</span>
    </div>
  )
}

function DetailCard({ label, value, highlight, primary }) {
  return (
    <div style={{
      padding: '12px 14px',
      background: primary ? 'var(--color-primary)' : highlight ? 'var(--color-bg-hover)' : 'var(--color-bg-hover)',
      borderRadius: 10,
      color: primary ? 'white' : 'inherit',
    }}>
      <div style={{ fontSize: 11, color: primary ? 'rgba(255,255,255,0.8)' : 'var(--color-text-muted)', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 700 }}>{value}</div>
    </div>
  )
}

// ── 上传面板 ─────────────────────────────────────────────────────────────
function UploadPanel({ companyId, onClose, onUploaded, showToast }) {
  const [files, setFiles] = useState([])
  const [type, setType] = useState('commission') // 'commission' | 'ir56m'
  const [uploading, setUploading] = useState(false)

  function handleDrop(e) {
    e.preventDefault()
    const dropped = Array.from(e.dataTransfer.files).filter(f =>
      /\.(jpg|jpeg|png|heic|pdf)$/i.test(f.name)
    )
    setFiles(prev => [...prev, ...dropped])
  }

  const handleUpload = async () => {
    if (!files.length) return
    setUploading(true)
    let successCount = 0
    for (const file of files) {
      const fd = new FormData()
      fd.append('file', file)
      try {
        if (type === 'commission') {
          await commissionsApi.upload(companyId, fd)
        } else {
          await commissionsApi.uploadIR56M(companyId, fd)
        }
        successCount++
      } catch (err) {
        showToast(`${file.name} 上传失败：${err.response?.data?.detail || err.message}`, 'error')
      }
    }
    setUploading(false)
    if (successCount > 0) {
      showToast(`成功提取 ${successCount} 份报表`)
      onUploaded()
    }
    setFiles([])
  }

  return (
    <div className="card animate-in" style={{ marginBottom: 20, padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <h3 style={{ fontWeight: 700, fontSize: 15, margin: 0 }}>📤 上传报表</h3>
          <div style={{ display: 'flex', background: 'var(--color-bg-hover)', borderRadius: 8, padding: 4 }}>
            <button
              className={`btn btn-sm ${type === 'commission' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => { setType('commission'); setFiles([]) }}
            >AIA 月结单</button>
            <button
              className={`btn btn-sm ${type === 'ir56m' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => { setType('ir56m'); setFiles([]) }}
            >IR56M (年度报税)</button>
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
      </div>

      <div
        id="drop-zone"
        onDrop={handleDrop}
        onDragOver={e => e.preventDefault()}
        onClick={() => document.getElementById('com-file-input').click()}
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
        <div style={{ fontSize: 36, marginBottom: 8 }}>{type === 'commission' ? '🧾' : '📄'}</div>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>
          拖拽 {type === 'commission' ? 'AIA 月结单截图' : 'IR56M 报税表截图'} 到此处，或点击选择
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>支持 JPG · PNG · HEIC · PDF · 多文件批量上传</div>
        <input
          id="com-file-input"
          type="file"
          multiple
          accept=".jpg,.jpeg,.png,.heic,.pdf"
          style={{ display: 'none' }}
          onChange={e => setFiles(prev => [...prev, ...Array.from(e.target.files)])}
        />
      </div>

      {files.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          {files.map((f, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--color-border-light)', fontSize: 13 }}>
              <span>{/\.pdf$/i.test(f.name) ? '📄' : '🖼️'}</span>
              <span style={{ flex: 1 }}>{f.name}</span>
              <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{(f.size / 1024).toFixed(0)} KB</span>
              <button
                className="btn btn-ghost btn-sm"
                style={{ padding: '2px 6px', color: 'var(--color-danger)' }}
                onClick={(e) => { e.stopPropagation(); setFiles(prev => prev.filter((_, j) => j !== i)) }}
              >✕</button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        {files.length > 0 && (
          <button className="btn btn-primary" onClick={handleUpload} disabled={uploading}>
            {uploading ? <><span className="spinner" /> AI 提取中…</> : `🚀 确认上传（${files.length} 个文件）`}
          </button>
        )}
      </div>
    </div>
  )
}

// ── 手动记账弹窗 (额外收入) ─────────────────────────────────────────────────────────────
function ManualIncomeModal({ companyId, onClose, onSuccess }) {
  const [form, setForm] = useState({
    statement_month: new Date().toISOString().slice(0, 7), // YYYY-MM
    income_source: '',
    amount: '',
    notes: ''
  })
  const [saving, setSaving] = useState(false)

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    try {
      await commissionsApi.addManual(companyId, form)
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
          <div className="modal-title">✍️ 记入额外收入</div>
        </div>
        <form onSubmit={handleSave}>
          <div className="modal-body" style={{ display: 'grid', gap: 16 }}>
            <div className="form-group">
              <label className="form-label">入账月份 <span className="text-danger">*</span></label>
              <input type="month" className="form-control" required value={form.statement_month} onChange={e => setForm({...form, statement_month: e.target.value})} />
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>此收入将计当月财年汇总（BIR60）</div>
            </div>
            <div className="form-group">
              <label className="form-label">收入来源 / 说明 <span className="text-danger">*</span></label>
              <input type="text" className="form-control" required value={form.income_source} onChange={e => setForm({...form, income_source: e.target.value})} placeholder="例如: 某某中介推荐费、顾问费" />
            </div>
            
            <div className="form-group">
              <label className="form-label">金额 (HKD) <span className="text-danger">*</span></label>
              <input type="number" step="0.01" className="form-control" required value={form.amount} onChange={e => setForm({...form, amount: e.target.value})} />
            </div>

            <div className="form-group">
              <label className="form-label">备注</label>
              <textarea className="form-control" rows={2} value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} placeholder="选填，例如无发票原因" />
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


