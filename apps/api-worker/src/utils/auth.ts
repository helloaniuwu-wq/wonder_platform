import { Context } from "hono";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { Env, UserRow, Variables } from "../types";

export type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

const DEFAULT_SECRET = "wonder-platform-cloudflare-secret-key-change-in-prod";

function getSecretKey(env: Env): Uint8Array {
  return new TextEncoder().encode(env.JWT_SECRET || env.SECRET_KEY || DEFAULT_SECRET);
}

export async function verifyPassword(plain: string, hashed: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hashed);
  } catch {
    return false;
  }
}

export async function hashPassword(password: string): Promise<string> {
  return await bcrypt.hash(password, 10);
}

export async function createAccessToken(
  payload: Record<string, unknown>,
  env: Env
): Promise<string> {
  const minutes = parseInt(env.ACCESS_TOKEN_EXPIRE_MINUTES || "10080", 10);
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${minutes}m`)
    .sign(getSecretKey(env));
}

export async function getOptionalUser(c: AppContext): Promise<UserRow | null> {
  let token: string | undefined;
  const authHeader = c.req.header("Authorization") || "";
  if (authHeader.startsWith("Bearer ")) {
    token = authHeader.slice(7).trim();
  }
  if (!token) {
    token = c.req.query("token");
  }
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getSecretKey(c.env));
    const userId = payload.sub;
    if (!userId) return null;

    const user = await c.env.DB.prepare(
      "SELECT id, email, name, password_hash, is_active, created_at, role, is_verified FROM users WHERE id = ? AND is_active = 1"
    )
      .bind(String(userId))
      .first<UserRow>();
    return user || null;
  } catch {
    return null;
  }
}

export async function requireUser(c: AppContext): Promise<UserRow> {
  const user = await getOptionalUser(c);
  if (!user) {
    throw new HttpError(401, "無效的認證憑證");
  }
  return user;
}

export async function assertCompanyAccess(
  db: D1Database,
  companyId: string,
  userId: string
): Promise<Record<string, unknown>> {
  const access = await db
    .prepare("SELECT id, role FROM user_company_access WHERE company_id = ? AND user_id = ?")
    .bind(companyId, userId)
    .first();
  if (!access) {
    throw new HttpError(403, "無此公司訪問權限");
  }
  const company = await db
    .prepare("SELECT * FROM companies WHERE id = ? AND is_active = 1")
    .bind(companyId)
    .first();
  if (!company) {
    throw new HttpError(404, "公司不存在");
  }
  return company;
}

export class HttpError extends Error {
  status: number;
  detail: string;
  constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
    this.detail = detail;
  }
}

export function generateUuid(): string {
  return crypto.randomUUID();
}

export async function sendResendEmail(
  env: Env,
  to: string,
  subject: string,
  html: string
): Promise<boolean> {
  if (!env.RESEND_API_KEY) {
    console.warn(`[Email Skipped] RESEND_API_KEY not configured. To: ${to}, Subject: ${subject}`);
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "WONDER Platform <onboarding@resend.dev>",
        to: [to],
        subject,
        html,
      }),
    });
    return res.ok;
  } catch (e) {
    console.error("Failed to send Resend email:", e);
    return false;
  }
}
