import { authHeaders } from '../utils/auth';

export class ApiError extends Error {
  constructor(message, status, data = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

/**
 * 统一 API 请求封装：自动注入 Authorization 头、超时控制、401 通知与错误解析。
 */
export async function apiFetch(url, options = {}) {
  const { timeoutMs = 30000, headers = {}, body, ...rest } = options;

  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  const mergedHeaders = {
    ...authHeaders(),
    ...(body && !isFormData && !headers['Content-Type'] ? { 'Content-Type': 'application/json' } : {}),
    ...headers,
  };

  const controller = new AbortController();
  const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const res = await fetch(url, {
      ...rest,
      headers: mergedHeaders,
      body: body && !isFormData && typeof body !== 'string' ? JSON.stringify(body) : body,
      signal: options.signal || controller.signal,
    });

    if (res.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('fis:unauthorized', { detail: { url } }));
    }

    return res;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 发起请求并解析 JSON；非 2xx 时抛出 ApiError。
 */
export async function apiJson(url, options = {}) {
  const res = await apiFetch(url, options);
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const msg = (data && (data.detail || data.message)) || `HTTP ${res.status}`;
    throw new ApiError(msg, res.status, data);
  }
  return data;
}
