"use client"

import { useState, useEffect, useRef } from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { Turnstile } from "@/components/Turnstile"
import { API_BASE } from "@/lib/api"

// ── 产品数据 ──────────────────────────────────────────────────────────────────

const PRODUCTS = [
  {
    id: "ec",
    icon: "🛡️",
    badge: "法定強制",
    badgeColor: "#EF4444",
    title: "雇員補償保險",
    titleEn: "Employees' Compensation",
    law: "Cap. 282 雇員補償條例",
    highlight: "違反屬刑事罪行，罰款最高 HK$100,000 + 監禁 2 年",
    highlightColor: "#EF4444",
    highlights: [
      "涵蓋工傷意外、職業病及上下班途中意外",
      "每名員工最高賠償無上限（按薪酬計算）",
      "包括法律費用及醫療費用保障",
    ],
    formFields: ["employees", "industry", "avgSalary", "effectDate"],
  },
  {
    id: "mpf",
    icon: "🏦",
    badge: "強制供款",
    badgeColor: "#6366F1",
    title: "強制性公積金（MPF）",
    titleEn: "Mandatory Provident Fund",
    law: "Cap. 485 強積金條例",
    highlight: "雇主雇員各供 5%，2025年5月起取消抵銷遣散費安排",
    highlightColor: "#6366F1",
    highlights: [
      "專業受托人篩選，比較基金表現與收費",
      "自願性供款（TVC）靈活安排，稅務扣減",
      "員工入職 60 天內必須完成登記",
    ],
    formFields: ["employees", "avgSalary", "currentProvider", "effectDate"],
  },
  {
    id: "medical",
    icon: "🏥",
    badge: "員工福利",
    badgeColor: "#10B981",
    title: "團體醫療保險",
    titleEn: "Group Medical Insurance",
    law: "自願醫保計劃 (VHIS) 認可",
    highlight: "提升員工留存率，保費支出可作稅務扣減",
    highlightColor: "#10B981",
    highlights: [
      "住院、手術、門診、專科三層保障可選",
      "附加危疾、牙科、視光、家屬擴展",
      "彈性計劃設計，按公司預算度身訂造",
    ],
    formFields: ["employees", "planLevel", "includeDependents", "effectDate"],
  },
]

const INDUSTRIES = [
  "建築及工程", "零售及餐飲", "物流及倉庫", "製造業", "金融及保險",
  "資訊科技", "醫療及健保", "教育", "貿易及進出口", "其他"
]

// ── 主页面 ───────────────────────────────────────────────────────────────────

export default function InsurancePage() {
  const [selectedTypes, setSelectedTypes] = useState<string[]>([])
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [activeCard, setActiveCard] = useState<string | null>(null)
  const [turnstileToken, setTurnstileToken] = useState<string>("")
  const [errorMessage, setErrorMessage] = useState<string>("")
  const formRef = useRef<HTMLDivElement>(null)

  const [form, setForm] = useState({
    companyName: "",
    contactName: "",
    phone: "",
    email: "",
    employees: "",
    avgSalary: "",
    industry: "",
    currentProvider: "",
    planLevel: "",
    includeDependents: false,
    effectDate: "",
    remarks: "",
  })

  // 读取 URL 参数自动预选险种并滚动至表单
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const type = params.get("type")
    if (type && PRODUCTS.find(p => p.id === type)) {
      setSelectedTypes([type])
      setActiveCard(type)
      setTimeout(() => {
        formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
      }, 400)
    }
  }, [])

  function toggleType(id: string) {
    setSelectedTypes(prev =>
      prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
    )
  }

  function handleScrollToForm(id: string) {
    if (!selectedTypes.includes(id)) setSelectedTypes(prev => [...prev, id])
    setActiveCard(id)
    setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    }, 100)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErrorMessage("")
    if (selectedTypes.length === 0) {
      alert("請選擇至少一項保險方案")
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch(`${API_BASE}/api/insurance-inquiry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          selectedTypes,
          "cf-turnstile-response": turnstileToken,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) {
        setSubmitted(true)
        window.scrollTo({ top: 0, behavior: "smooth" })
      } else {
        setErrorMessage(data.error || "提交失敗，請稍後再試或直接聯絡我們")
      }
    } catch (err) {
      console.error(err)
      setErrorMessage("網絡異常，請稍後再試")
    } finally {
      setSubmitting(false)
    }
  }

  // 需要显示的动态字段（所有选中险种的并集）
  const neededFields = new Set(
    PRODUCTS.filter(p => selectedTypes.includes(p.id)).flatMap(p => p.formFields)
  )

  // ── 提交成功状态 ────────────────────────────────────────────────────────────
  if (submitted) {
    return (
      <main className="flex-1 flex flex-col items-center justify-center min-h-screen bg-background text-foreground px-6">
        <div className="max-w-lg mx-auto text-center space-y-6">
          <div className="text-7xl mb-4">✅</div>
          <h1 className="text-4xl font-bold text-card-foreground">詢價已提交</h1>
          <p className="text-lg text-foreground/70 leading-relaxed">
            感謝您的查詢！我們的顧問將於 <strong>1–2 個工作日</strong> 內聯絡您，提供定制化保障方案報價。
          </p>
          <div className="pt-4 flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/"
              className="inline-flex items-center justify-center h-12 px-8 rounded-xl bg-primary text-primary-foreground font-semibold hover:opacity-90 transition-opacity"
            >
              返回首頁
            </Link>
            <Link
              href="/blog"
              className="inline-flex items-center justify-center h-12 px-8 rounded-xl border border-border bg-card/50 hover:bg-card text-foreground font-medium transition-colors"
            >
              閱讀專業洞察
            </Link>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="flex-1 bg-background text-foreground min-h-screen">

      {/* ── Hero ── */}
      <section className="relative overflow-hidden py-24 px-6">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[400px] bg-primary/4 rounded-full blur-[140px] pointer-events-none" />
        <div className="max-w-4xl mx-auto text-center relative z-10 space-y-6">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-border bg-card/50 text-sm text-foreground/70 font-medium">
            <span>🛡️</span> 企業保障方案
          </div>
          <h1 className="text-5xl md:text-6xl font-bold tracking-tight text-card-foreground leading-tight">
            為您的團隊提供<br />
            <span className="bg-gradient-to-r from-amber-500 to-orange-500 bg-clip-text text-transparent">
              全面合規保障
            </span>
          </h1>
          <p className="text-xl text-foreground/60 max-w-2xl mx-auto leading-relaxed">
            雇員補償、強積金、團體醫療 — 三項企業必備保障方案。<br />
            填寫詢價表，顧問將於 1–2 個工作日內為您定制報價。
          </p>
        </div>
      </section>

      {/* ── 产品卡片 ── */}
      <section className="max-w-6xl mx-auto px-6 pb-16">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {PRODUCTS.map(product => {
            const isSelected = selectedTypes.includes(product.id)
            const isActive = activeCard === product.id
            return (
              <div
                key={product.id}
                className="group relative flex flex-col rounded-[1.75rem] border transition-all duration-300"
                style={{
                  background: isSelected ? `${product.badgeColor}08` : "var(--card)",
                  borderColor: isSelected ? `${product.badgeColor}60` : "hsl(var(--border))",
                  boxShadow: isActive ? `0 0 0 3px ${product.badgeColor}40` : "none",
                }}
              >
                {/* 选中勾 */}
                {isSelected && (
                  <div
                    className="absolute top-4 right-4 w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold"
                    style={{ background: product.badgeColor }}
                  >
                    ✓
                  </div>
                )}

                <div className="p-8 flex-1">
                  {/* 图标 + 法规 */}
                  <div className="flex items-start gap-3 mb-5">
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
                      style={{ background: `${product.badgeColor}15` }}
                    >
                      {product.icon}
                    </div>
                    <div>
                      <div
                        className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold mb-1"
                        style={{ background: `${product.badgeColor}20`, color: product.badgeColor }}
                      >
                        {product.badge}
                      </div>
                      <div className="text-xs text-foreground/40">{product.law}</div>
                    </div>
                  </div>

                  {/* 名称 */}
                  <h3 className="text-xl font-bold text-card-foreground mb-1">{product.title}</h3>
                  <p className="text-sm text-foreground/50 mb-5">{product.titleEn}</p>

                  {/* 警示条 */}
                  <div
                    className="rounded-lg px-3 py-2 mb-5 text-xs leading-relaxed font-medium"
                    style={{ background: `${product.highlightColor}10`, color: product.highlightColor }}
                  >
                    ⚠️ {product.highlight}
                  </div>

                  {/* 亮点列表 */}
                  <ul className="space-y-2.5">
                    {product.highlights.map((h, i) => (
                      <li key={i} className="flex items-start gap-2.5 text-sm text-foreground/70">
                        <span
                          className="mt-0.5 w-4 h-4 rounded-full flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0"
                          style={{ background: product.badgeColor }}
                        >
                          ✓
                        </span>
                        {h}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* 按钮组 */}
                <div className="px-8 pb-8 flex gap-3">
                  <button
                    onClick={() => toggleType(product.id)}
                    className="flex-1 h-10 rounded-xl text-sm font-semibold transition-all duration-200"
                    style={{
                      background: isSelected ? `${product.badgeColor}20` : "hsl(var(--muted))",
                      color: isSelected ? product.badgeColor : "hsl(var(--muted-foreground))",
                      border: `1px solid ${isSelected ? product.badgeColor + "50" : "transparent"}`,
                    }}
                  >
                    {isSelected ? "✓ 已選擇" : "加入詢價"}
                  </button>
                  <button
                    onClick={() => handleScrollToForm(product.id)}
                    className="h-10 px-4 rounded-xl text-sm font-bold text-white transition-all duration-200 hover:opacity-85"
                    style={{ background: product.badgeColor }}
                  >
                    獲取報價 →
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* ── 询价表单 ── */}
      <section
        ref={formRef}
        className="max-w-3xl mx-auto px-6 pb-24 scroll-mt-8"
      >
        <div className="rounded-[2rem] border border-border bg-card/50 backdrop-blur-sm overflow-hidden">
          {/* 表单头 */}
          <div className="px-10 pt-10 pb-6 border-b border-border">
            <h2 className="text-3xl font-bold text-card-foreground mb-2">填寫詢價資料</h2>
            <p className="text-foreground/60 text-sm">
              {selectedTypes.length > 0
                ? `已選：${selectedTypes.map(id => PRODUCTS.find(p => p.id === id)?.title).join("、")}`
                : "請先在上方選擇需要詢價的保險方案"}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="px-10 py-8 space-y-6">

            {/* ── 险种选择 ── */}
            <div>
              <label className="block text-sm font-semibold text-foreground/70 mb-3">
                詢價險種 <span className="text-red-500">*</span>
              </label>
              <div className="flex flex-wrap gap-3">
                {PRODUCTS.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggleType(p.id)}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border transition-all duration-200"
                    style={{
                      background: selectedTypes.includes(p.id) ? `${p.badgeColor}15` : "transparent",
                      borderColor: selectedTypes.includes(p.id) ? `${p.badgeColor}70` : "hsl(var(--border))",
                      color: selectedTypes.includes(p.id) ? p.badgeColor : "hsl(var(--foreground))",
                    }}
                  >
                    <span>{p.icon}</span> {p.title}
                  </button>
                ))}
              </div>
            </div>

            {/* ── 公司信息 ── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <Field label="公司名稱" required>
                <input
                  type="text"
                  required
                  placeholder="XXX 有限公司"
                  value={form.companyName}
                  onChange={e => setForm(f => ({ ...f, companyName: e.target.value }))}
                  className="form-input"
                  id="insurance-company-name"
                />
              </Field>
              <Field label="聯絡人姓名" required>
                <input
                  type="text"
                  required
                  placeholder="王先生 / 陳小姐"
                  value={form.contactName}
                  onChange={e => setForm(f => ({ ...f, contactName: e.target.value }))}
                  className="form-input"
                  id="insurance-contact-name"
                />
              </Field>
              <Field label="聯絡電話" required>
                <input
                  type="tel"
                  required
                  placeholder="6xxx xxxx"
                  value={form.phone}
                  onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                  className="form-input"
                  id="insurance-phone"
                />
              </Field>
              <Field label="電郵地址" required>
                <input
                  type="email"
                  required
                  placeholder="name@company.com"
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  className="form-input"
                  id="insurance-email"
                />
              </Field>
            </div>

            {/* ── 动态字段 ── */}
            {selectedTypes.length > 0 && (
              <div className="space-y-5 pt-2">
                <div className="text-xs font-semibold text-foreground/40 uppercase tracking-wider">投保要素</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  {neededFields.has("employees") && (
                    <Field label="員工人數" required>
                      <select
                        value={form.employees}
                        onChange={e => setForm(f => ({ ...f, employees: e.target.value }))}
                        className="form-input"
                        id="insurance-employees"
                        required
                      >
                        <option value="">請選擇</option>
                        <option>1–5 人</option>
                        <option>6–10 人</option>
                        <option>11–20 人</option>
                        <option>21–50 人</option>
                        <option>50 人以上</option>
                      </select>
                    </Field>
                  )}
                  {neededFields.has("avgSalary") && (
                    <Field label="員工平均月薪">
                      <select
                        value={form.avgSalary}
                        onChange={e => setForm(f => ({ ...f, avgSalary: e.target.value }))}
                        className="form-input"
                        id="insurance-avg-salary"
                      >
                        <option value="">請選擇</option>
                        <option>HK$10,000 以下</option>
                        <option>HK$10,000–20,000</option>
                        <option>HK$20,000–40,000</option>
                        <option>HK$40,000 以上</option>
                      </select>
                    </Field>
                  )}
                  {neededFields.has("industry") && (
                    <Field label="行業 / 工種" required={selectedTypes.includes("ec")}>
                      <select
                        value={form.industry}
                        onChange={e => setForm(f => ({ ...f, industry: e.target.value }))}
                        className="form-input"
                        id="insurance-industry"
                        required={selectedTypes.includes("ec")}
                      >
                        <option value="">請選擇</option>
                        {INDUSTRIES.map(i => <option key={i}>{i}</option>)}
                      </select>
                    </Field>
                  )}
                  {neededFields.has("currentProvider") && (
                    <Field label="現有 MPF 受托人">
                      <input
                        type="text"
                        placeholder="如已有，請填寫（選填）"
                        value={form.currentProvider}
                        onChange={e => setForm(f => ({ ...f, currentProvider: e.target.value }))}
                        className="form-input"
                        id="insurance-current-provider"
                      />
                    </Field>
                  )}
                  {neededFields.has("planLevel") && (
                    <Field label="醫療計劃級別">
                      <select
                        value={form.planLevel}
                        onChange={e => setForm(f => ({ ...f, planLevel: e.target.value }))}
                        className="form-input"
                        id="insurance-plan-level"
                      >
                        <option value="">請選擇</option>
                        <option>基礎（住院為主）</option>
                        <option>中級（住院 + 門診）</option>
                        <option>高級（全面專科 + 牙科）</option>
                      </select>
                    </Field>
                  )}
                  {neededFields.has("effectDate") && (
                    <Field label="期望生效日期">
                      <input
                        type="date"
                        value={form.effectDate}
                        onChange={e => setForm(f => ({ ...f, effectDate: e.target.value }))}
                        className="form-input"
                        id="insurance-effect-date"
                        min={new Date().toISOString().split("T")[0]}
                      />
                    </Field>
                  )}
                </div>
                {neededFields.has("includeDependents") && (
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.includeDependents}
                      onChange={e => setForm(f => ({ ...f, includeDependents: e.target.checked }))}
                      className="w-4 h-4 rounded"
                      id="insurance-include-dependents"
                    />
                    <span className="text-sm text-foreground/80">包含家屬（配偶 / 子女）保障</span>
                  </label>
                )}
              </div>
            )}

            {/* 备注 */}
            <Field label="其他備註">
              <textarea
                placeholder="如有特殊要求或問題，請在此說明…"
                value={form.remarks}
                onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))}
                rows={3}
                className="form-input resize-none"
                id="insurance-remarks"
              />
            </Field>

            {/* 免责声明 */}
            <p className="text-xs text-foreground/40 leading-relaxed">
              本詢價表僅用於收集投保資訊，不構成任何保險合約或報價承諾。最終保費及保障條款由保險公司釐定，顧問將以人工審核方式跟進。
            </p>

            {/* 错误提示 */}
            {errorMessage && (
              <p className="text-sm text-red-500 text-center font-medium">⚠️ {errorMessage}</p>
            )}

            {/* Cloudflare Turnstile 人机验证 */}
            <div className="py-2">
              <Turnstile
                action="insurance_inquiry"
                theme="light"
                onSuccess={(token) => setTurnstileToken(token)}
                onExpire={() => setTurnstileToken("")}
              />
            </div>

            {/* 提交按钮 */}
            <button
              type="submit"
              disabled={submitting || selectedTypes.length === 0}
              className={cn(
                "w-full h-14 rounded-2xl text-base font-bold transition-all duration-200",
                selectedTypes.length === 0
                  ? "bg-muted text-muted-foreground cursor-not-allowed"
                  : "bg-primary text-primary-foreground hover:opacity-90 shadow-lg shadow-primary/20"
              )}
              id="insurance-submit"
            >
              {submitting ? "提交中…" : "📬 提交詢價"}
            </button>
          </form>
        </div>
      </section>
    </main>
  )
}

// ── 字段包裹组件 ──────────────────────────────────────────────────────────────

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-semibold text-foreground/70">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
    </div>
  )
}
