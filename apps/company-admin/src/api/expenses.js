import api from './index.js'

// ── Expenses ──────────────────────────────────────────────────────────────
export const expensesApi = {
  // 分类列表
  categories: () => api.get('/expenses/categories'),

  // 支出列表（多维筛选）
  list: (params) => api.get('/expenses', { params }),

  // 单条详情
  get: (id) => api.get(`/expenses/${id}`),

  // 批量上传（FormData）
  upload: (companyId, files) => {
    const form = new FormData()
    form.append('company_id', companyId)
    files.forEach(f => form.append('files', f))
    return api.post('/expenses/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },

  // 人工修正字段
  update: (id, data) => {
    const form = new FormData()
    Object.entries(data).forEach(([k, v]) => v !== undefined && form.append(k, v))
    return api.put(`/expenses/${id}`, form)
  },

  // 手动新增记账
  addManual: (data) => {
    const form = new FormData()
    Object.entries(data).forEach(([k, v]) => v !== undefined && form.append(k, v))
    return api.post(`/expenses/manual`, form)
  },

  // 确认凭证
  confirm: (id) => api.put(`/expenses/${id}/confirm`),

  // 驳回凭证
  reject: (id, reason) => {
    const form = new FormData()
    if (reason) form.append('reason', reason)
    return api.put(`/expenses/${id}/reject`, form)
  },

  // 彻底删除凭证
  delete: (id) => api.delete(`/expenses/${id}`),

  // 按分类统计
  statsByCategory: (companyId, fiscalYear) =>
    api.get('/expenses/stats/by-category', { params: { company_id: companyId, fiscal_year: fiscalYear } }),

  // 按财年统计
  statsByFiscalYear: (companyId) =>
    api.get('/expenses/stats/by-fiscal-year', { params: { company_id: companyId } }),

  // 图片预览 URL（静态文件服务）
  receiptImageUrl: (imagePath) => {
    if (!imagePath) return null
    // imagePath 格式: ./receipts_archive/YYYY-MM/EXP-xxx.jpg
    // 转换为: /receipts/YYYY-MM/EXP-xxx.jpg
    const parts = imagePath.replace('./receipts_archive/', '').replace('receipts_archive/', '')
    return `/receipts/${parts}`
  },

  // 导出支出明细（触发浏览器下载，直接请求后端避免 Vite 代理问题）
  exportUrl: (companyId, format = 'excel', filters = {}) => {
    const BASE = import.meta.env.VITE_API_BASE_URL || ''  // 生产环境使用相对路径，由 nginx 代理
    const params = new URLSearchParams({ company_id: companyId, format })
    if (filters.status)        params.append('status', filters.status)
    if (filters.fiscal_year)   params.append('fiscal_year', filters.fiscal_year)
    if (filters.category_code) params.append('category_code', filters.category_code)
    return `${BASE}/expenses/export?${params.toString()}`
  },
}
