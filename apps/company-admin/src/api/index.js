import axios from 'axios'

const api = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL || '/api' })

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export default api

// ── Auth ─────────────────────────────────────────────────────────────────
export const authApi = {
  login: (email, password) => api.post('/auth/login', { email, password }),
  register: (data) => api.post('/auth/register', { ...data, redirect_url: window.location.origin }),
  me: () => api.get('/auth/me'),
  forgotPassword: (email) => api.post('/auth/forgot-password', { email, redirect_url: window.location.origin }),
  resetPassword: (token, new_password) => api.post('/auth/reset-password', { token, new_password }),
  verifyEmail: (token) => api.get('/auth/verify-email', { params: { token } }),
}

// ── Companies ─────────────────────────────────────────────────────────────
export const companiesApi = {
  list: () => api.get('/companies/'),
  create: (data) => api.post('/companies/', data),
  get: (id) => api.get(`/companies/${id}`),
  update: (id, data) => api.put(`/companies/${id}`, data),
  getTaxProfile: (id) => api.get(`/companies/${id}/tax-profile`),
  updateTaxProfile: (id, data) => api.put(`/companies/${id}/tax-profile`, data),
}

// ── Clients ───────────────────────────────────────────────────────────────
export const clientsApi = {
  list: (companyId, params) => api.get(`/companies/${companyId}/clients/`, { params }),
  create: (companyId, data) => api.post(`/companies/${companyId}/clients/`, data),
  update: (companyId, id, data) => api.put(`/companies/${companyId}/clients/${id}`, data),
  delete: (companyId, id) => api.delete(`/companies/${companyId}/clients/${id}`),
}

// ── Invoices ──────────────────────────────────────────────────────────────
export const invoicesApi = {
  dashboard: (companyId, fiscalYear) => api.get(`/companies/${companyId}/dashboard`, {
    params: fiscalYear ? { fiscal_year: fiscalYear } : {}
  }),
  list: (companyId, params) => api.get(`/companies/${companyId}/invoices`, { params }),
  get: (companyId, id) => api.get(`/companies/${companyId}/invoices/${id}`),
  create: (companyId, data) => api.post(`/companies/${companyId}/invoices`, data),
  update: (companyId, id, data) => api.put(`/companies/${companyId}/invoices/${id}`, data),
  send: (companyId, id) => api.patch(`/companies/${companyId}/invoices/${id}/send`),
  void: (companyId, id) => api.patch(`/companies/${companyId}/invoices/${id}/void`),
  pdfUrl: (companyId, id) => `/api/companies/${companyId}/invoices/${id}/pdf`,
  addPayment: (companyId, id, data) => api.post(`/companies/${companyId}/invoices/${id}/payments`, data),
}

// ── Commissions ───────────────────────────────────────────────────────────
export const commissionsApi = {
  /** 手动新增额外收入 (Other Income) */
  addManual: (companyId, params) =>
    api.post(`/companies/${companyId}/commissions/manual`, null, { params }),
  /** 获取月结单列表（可按财年/状态筛选） */
  list: (companyId, params) =>
    api.get(`/companies/${companyId}/commissions/`, { params }),
  /** 获取单条详情（含细分字段） */
  get: (companyId, id) =>
    api.get(`/companies/${companyId}/commissions/${id}`),
  /** 上传单张月结单截图（form-data） */
  upload: (companyId, formData) =>
    api.post(`/companies/${companyId}/commissions/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  /** 触发 statements_inbox/ 扫描 */
  scanInbox: (companyId) =>
    api.post(`/companies/${companyId}/commissions/scan-inbox`),
  /** 人工修正字段 */
  update: (companyId, id, data) =>
    api.put(`/companies/${companyId}/commissions/${id}`, data),
  /** 确认 */
  confirm: (companyId, id) =>
    api.post(`/companies/${companyId}/commissions/${id}/confirm`),
  /** 驳回 */
  reject: (companyId, id, notes) =>
    api.post(`/companies/${companyId}/commissions/${id}/reject`, { notes }),
  /** 删除 */
  delete: (companyId, id) =>
    api.delete(`/companies/${companyId}/commissions/${id}`),
  /** 财年汇总（BIR60 数据源） */
  annualSummary: (companyId, fiscalYear) =>
    api.get(`/companies/${companyId}/commissions/summary/annual`, {
      params: { fiscal_year: fiscalYear },
    }),
  /** 收支对比利润估算 */
  profitSummary: (companyId, fiscalYear) =>
    api.get(`/companies/${companyId}/commissions/summary/profit`, {
      params: { fiscal_year: fiscalYear },
    }),
  /** 获取所有财年列表 */
  fiscalYears: (companyId) =>
    api.get(`/companies/${companyId}/commissions/fiscal-years/list`),
  /** 上传 IR56M */
  uploadIR56M: (companyId, formData) =>
    api.post(`/companies/${companyId}/commissions/ir56m/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  /** 获取 IR56M 列表 */
  getIR56Ms: (companyId, params) =>
    api.get(`/companies/${companyId}/commissions/ir56m`, { params }),
  /** 确认 IR56M */
  confirmIR56M: (companyId, id) =>
    api.post(`/companies/${companyId}/commissions/ir56m/${id}/confirm`),
}

// ── Financials ────────────────────────────────────────────────
export const financialsApi = {
  /** 获取可选财政年度列表 */
  fiscalYears: (companyId) =>
    api.get(`/companies/${companyId}/financials/fiscal-years`),
  /** 损益表 */
  pnl: (companyId, fiscalYear) =>
    api.get(`/companies/${companyId}/financials/pnl`, {
      params: fiscalYear ? { fiscal_year: fiscalYear } : {},
    }),
  /** 应收账款摘要 */
  ar: (companyId, fiscalYear) =>
    api.get(`/companies/${companyId}/financials/ar`, {
      params: fiscalYear ? { fiscal_year: fiscalYear } : {},
    }),
  /** 支出分析 */
  expenseAnalysis: (companyId, fiscalYear) =>
    api.get(`/companies/${companyId}/financials/expense-analysis`, {
      params: fiscalYear ? { fiscal_year: fiscalYear } : {},
    }),
  /** 导出损益表数据流 */
  pnlExport: (companyId, fiscalYear, format = 'pdf') =>
    api.get(`/companies/${companyId}/financials/pnl/export`, {
      params: { fiscal_year: fiscalYear, format },
      responseType: 'blob'
    }),
}

// ── Compliance ────────────────────────────────────────────────────────────
export const complianceApi = {
  /** 获取全年合规清单（自动生成或读缓存），year 如 "2025-26" */
  list: (companyId, year) =>
    api.get(`/companies/${companyId}/compliance/`, { params: year ? { year } : {} }),
  /** 更新单个合规事件（status / due_date / notes 等）*/
  update: (companyId, itemId, data) =>
    api.put(`/companies/${companyId}/compliance/${itemId}`, data),
  /** 强制重新生成清单（保留已完成状态）*/
  regenerate: (companyId, year) =>
    api.post(`/companies/${companyId}/compliance/regenerate`, null, { params: year ? { year } : {} }),
  /** Dashboard 摘要：逾期/即将到期数量 */
  summary: (companyId, year) =>
    api.get(`/companies/${companyId}/compliance/summary`, { params: year ? { year } : {} }),
}

// ── Leases (物业租约) ────────────────────────────────────────────────────────
export const leasesApi = {
  list: (companyId, params) => api.get(`/companies/${companyId}/leases/`, { params }),
  summary: (companyId) => api.get(`/companies/${companyId}/leases/summary`),
  get: (companyId, id) => api.get(`/companies/${companyId}/leases/${id}`),
  create: (companyId, data) => api.post(`/companies/${companyId}/leases/`, data),
  update: (companyId, id, data) => api.put(`/companies/${companyId}/leases/${id}`, data),
  delete: (companyId, id) => api.delete(`/companies/${companyId}/leases/${id}`),
  generatePayments: (companyId, id, months) => 
    api.post(`/companies/${companyId}/leases/${id}/generate-payments`, null, { params: { months_to_generate: months } }),
  updatePayment: (companyId, paymentId, data) => 
    api.put(`/companies/${companyId}/leases/payments/${paymentId}`, data),
  deletePayment: (companyId, paymentId) => 
    api.delete(`/companies/${companyId}/leases/payments/${paymentId}`),
  createMiscFee: (companyId, id, data) => 
    api.post(`/companies/${companyId}/leases/${id}/misc`, data),
  updateMiscFee: (companyId, feeId, data) => 
    api.put(`/companies/${companyId}/leases/misc/${feeId}`, data),
  deleteMiscFee: (companyId, feeId) => 
    api.delete(`/companies/${companyId}/leases/misc/${feeId}`),
}

// ── Admin (系統管理) ──────────────────────────────────────────
export const adminApi = {
  listUsers: () => api.get('/admin/users', { params: { per_page: 100 } }),
  togglePremium: (userId, isPremium) => api.post(`/admin/users/${userId}/toggle-premium`, { is_premium: isPremium }),
}
