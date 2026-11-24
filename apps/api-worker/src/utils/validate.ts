import { AppContext, HttpError } from "./auth";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;

export function parsePositiveIntId(raw: string | undefined, label = "ID"): number {
  if (!raw || !/^\d+$/.test(raw)) {
    throw new HttpError(400, `無效的 ${label}`);
  }
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new HttpError(400, `無效的 ${label}`);
  }
  return n;
}

export async function parseJsonBody<T>(
  c: AppContext,
  validate: (raw: Record<string, unknown>) => T
): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new HttpError(400, "無效的 JSON 請求體");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new HttpError(400, "請求體必須為 JSON 物件");
  }
  return validate(raw as Record<string, unknown>);
}

export function reqNonEmptyString(
  obj: Record<string, unknown>,
  key: string,
  msg: string,
  opts?: { maxLen?: number; uppercase?: boolean }
): string {
  const val = typeof obj[key] === "string" ? obj[key].trim() : "";
  if (!val) throw new HttpError(400, msg);
  if (opts?.maxLen && val.length > opts.maxLen) {
    throw new HttpError(400, `${key} 長度不能超過 ${opts.maxLen}`);
  }
  return opts?.uppercase ? val.toUpperCase() : val;
}

export function optFiniteNumber(
  obj: Record<string, unknown>,
  key: string,
  defaultVal: number,
  opts?: { min?: number; max?: number; label?: string }
): number {
  const raw = obj[key];
  if (raw === undefined || raw === null || raw === "") return defaultVal;
  const n = Number(raw);
  const label = opts?.label || key;
  if (!Number.isFinite(n)) throw new HttpError(400, `${label} 必須為有效數字`);
  if (opts?.min !== undefined && n < opts.min) {
    throw new HttpError(400, `${label} 不能小於 ${opts.min}`);
  }
  if (opts?.max !== undefined && n > opts.max) {
    throw new HttpError(400, `${label} 不能大於 ${opts.max}`);
  }
  return n;
}

export function reqPositiveNumber(obj: Record<string, unknown>, key: string, label?: string): number {
  const raw = obj[key];
  const n = Number(raw);
  if (raw === undefined || raw === null || raw === "" || !Number.isFinite(n) || n <= 0) {
    throw new HttpError(400, `${label || key} 必須為大於 0 的數字`);
  }
  return n;
}

export function optCurrency(obj: Record<string, unknown>, key: string, defaultVal = "USD"): string {
  const raw = obj[key];
  if (raw === undefined || raw === null || raw === "") return defaultVal;
  const code = String(raw).trim().toUpperCase();
  if (!CURRENCY_RE.test(code)) {
    throw new HttpError(400, `無效的幣種代碼: ${code}`);
  }
  return code;
}

export function optEnum<T extends string>(
  obj: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  defaultVal: T,
  label?: string
): T {
  const raw = obj[key];
  if (raw === undefined || raw === null || raw === "") return defaultVal;
  const val = String(raw).trim().toUpperCase() as T;
  if (!allowed.includes(val)) {
    throw new HttpError(400, `${label || key} 必須為 ${allowed.join(" / ")}`);
  }
  return val;
}

export function optIsoDate(obj: Record<string, unknown>, key: string, defaultVal: string): string {
  const raw = obj[key];
  if (raw === undefined || raw === null || raw === "") return defaultVal;
  const s = String(raw).trim();
  if (!ISO_DATE_RE.test(s)) {
    throw new HttpError(400, `${key} 日期格式須為 YYYY-MM-DD`);
  }
  return s;
}

export function optWeightRecord(
  obj: Record<string, unknown>,
  key: string
): Record<string, number> | undefined {
  const raw = obj[key];
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new HttpError(400, `${key} 必須為鍵值對物件`);
  }
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) {
      throw new HttpError(400, `${key}[${k}] 權重必須為非負數字`);
    }
    out[k.trim()] = n;
  }
  return out;
}
