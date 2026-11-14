import api, { API_BASE } from './index.js'
import { prepareUploadFiles } from '../utils/uploadImage.js'

// ── Expenses ──────────────────────────────────────────────────────────────
export const expensesApi = {
  // 分类列表
  categories: () => api.get('/expenses/categories'),

  // 支出列表（多维筛选）
  list: (params) => api.get('/expenses', { params }),

  // 单条详情
  get: (id) => api.get(`/expenses/${id}`),

  // 批量上传（FormData）— 图片先做 EXIF 转正 + 压缩，PDF 原样上传
  upload: async (companyId, files) => {
    const optimized = await prepareUploadFiles(files)
    const form = new FormData()
    form.append('company_id', companyId)
    optimized.forEach(f => form.append('files', f))
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

  // 图片预览 URL：R2 静态文件实际由 Worker 提供，必须拼 Worker 的绝对地址。
  // 若用 /receipts/... 这种相对路径，请求会落在 Pages 上并被 SPA fallback
  // 返回 index.html，浏览器 <img> 解码失败，表现为「图片加载失败」。
  receiptImageUrl: (imagePath) => {
    if (!imagePath) return null
    let p = String(imagePath).replace(/\\/g, '/').trim()
    if (/^https?:\/\//i.test(p)) return p          // 已是完整 URL
    p = p.replace(/^\.\//, '').replace(/^\/+/, '')  // 去掉 ./ 与开头的 /
    p = p.replace(/\/\.\//g, '/')                    // 去掉中间的 /./
    // 旧版曾拼出 /receipts/./receipts/... ，这里把重复前缀折叠掉
    p = p.replace(/^(receipts|statements)\/(?:\.\/)?\1\//, '$1/')
    // 数据库里混有 4 种历史格式，统一保留原有目录：
    //   receipts/YYYY-MM/xxx.jpg                      （Worker 上传）
    //   receipts_archive/YYYY-MM/xxx.jpg              （旧 Python）
    //   receipts_archive/<companyId>/YYYY-MM/xxx.webp （旧 Python）
    //   statements/...                              （佣金月结单）
    // Worker 对 receipts_archive / statements_archive 都有别名路由。
    return `${API_BASE}/${p}`
  },

  // 导出支出明细（触发浏览器下载，直接请求 Worker）
  exportUrl: (companyId, format = 'excel', filters = {}) => {
    const params = new URLSearchParams({ company_id: companyId, format })
    if (filters.status)        params.append('status', filters.status)
    if (filters.fiscal_year)   params.append('fiscal_year', filters.fiscal_year)
    if (filters.category_code) params.append('category_code', filters.category_code)
    // 浏览器直接打开链接不会带 Authorization header，后端 requireUser 支持 query token
    const token = localStorage.getItem('token')
    if (token) params.append('token', token)
    return `${API_BASE}/expenses/export?${params.toString()}`
  },
}
