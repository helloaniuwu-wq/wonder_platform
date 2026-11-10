import { Hono } from "hono";
import { Env, Variables } from "../types";
import {
  createAccessToken,
  generateUuid,
  hashPassword,
  HttpError,
  requireUser,
  sendResendEmail,
  verifyPassword,
} from "../utils/auth";

export const authRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

function formatUserOut(user: Record<string, unknown>) {
  return {
    id: String(user.id),
    email: String(user.email),
    name: String(user.name),
    role: String(user.role || "free"),
    is_active: Boolean(user.is_active),
    is_verified: Boolean(user.is_verified),
    created_at: user.created_at || new Date().toISOString(),
  };
}

authRouter.post("/register", async (c) => {
  const body = await c.req.json<{
    email: string;
    name: string;
    password: string;
    redirect_url?: string;
  }>();

  const existing = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?")
    .bind(body.email)
    .first();
  if (existing) {
    throw new HttpError(400, "此電郵已被註冊");
  }

  const userId = generateUuid();
  const passwordHash = await hashPassword(body.password);
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    "INSERT INTO users (id, email, name, password_hash, is_active, created_at, role, is_verified) VALUES (?, ?, ?, ?, 1, ?, 'free', 0)"
  )
    .bind(userId, body.email, body.name, passwordHash, now)
    .run();

  const tokenStr = generateUuid().replace(/-/g, "") + generateUuid().replace(/-/g, "");
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

  await c.env.DB.prepare(
    "INSERT INTO user_tokens (id, user_id, token, type, expires_at, created_at) VALUES (?, ?, ?, 'verification', ?, ?)"
  )
    .bind(generateUuid(), userId, tokenStr, expiresAt, now)
    .run();

  const frontendUrl = body.redirect_url || "https://company.wonderwisdom.online";
  await sendResendEmail(
    c.env,
    body.email,
    "【WONDER】請驗證您的電郵地址",
    `<p>您好 ${body.name}，請點擊以下連結完成電郵驗證：</p><p><a href="${frontendUrl}/verify-email?token=${tokenStr}">${frontendUrl}/verify-email?token=${tokenStr}</a></p>`
  );

  return c.json(
    {
      id: userId,
      email: body.email,
      name: body.name,
      role: "free",
      is_active: true,
      is_verified: false,
      created_at: now,
    },
    201
  );
});

authRouter.post("/login", async (c) => {
  const body = await c.req.json<{ email?: string; username?: string; password: string }>();
  const identifier = String(body.email || body.username || "").trim();
  const user = await c.env.DB.prepare(
    "SELECT id, email, name, password_hash, is_active, created_at, role, is_verified FROM users WHERE (LOWER(email) = LOWER(?) OR LOWER(name) = LOWER(?)) AND is_active = 1"
  )
    .bind(identifier, identifier)
    .first();

  if (!user || !(await verifyPassword(body.password, String(user.password_hash)))) {
    throw new HttpError(401, "電郵/用戶名或密碼錯誤");
  }

  const token = await createAccessToken(
    {
      sub: String(user.id),
      email: String(user.email),
      name: String(user.name),
      role: String(user.role || "free"),
    },
    c.env
  );

  return c.json({
    access_token: token,
    token_type: "bearer",
    user_id: String(user.id),
    name: String(user.name),
    role: String(user.role || "free"),
  });
});

authRouter.post("/forgot-password", async (c) => {
  const body = await c.req.json<{ email: string; redirect_url?: string }>();
  const user = await c.env.DB.prepare(
    "SELECT id, email, name FROM users WHERE email = ? AND is_active = 1"
  )
    .bind(body.email)
    .first();

  if (user) {
    const tokenStr = generateUuid().replace(/-/g, "") + generateUuid().replace(/-/g, "");
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();
    await c.env.DB.prepare(
      "INSERT INTO user_tokens (id, user_id, token, type, expires_at, created_at) VALUES (?, ?, ?, 'reset', ?, ?)"
    )
      .bind(generateUuid(), String(user.id), tokenStr, expiresAt, now)
      .run();

    const frontendUrl = body.redirect_url || "https://company.wonderwisdom.online";
    await sendResendEmail(
      c.env,
      String(user.email),
      "【WONDER】重設您的登入密碼",
      `<p>您好，請點擊以下連結重設密碼（1小時內有效）：</p><p><a href="${frontendUrl}/reset-password?token=${tokenStr}">${frontendUrl}/reset-password?token=${tokenStr}</a></p>`
    );
  }

  return c.json({ message: "如果該電郵已註冊，您將很快收到密碼重設郵件。" });
});

authRouter.post("/reset-password", async (c) => {
  const body = await c.req.json<{ token: string; new_password: string }>();
  const now = new Date().toISOString();
  const dbToken = await c.env.DB.prepare(
    "SELECT id, user_id FROM user_tokens WHERE token = ? AND type = 'reset' AND expires_at > ?"
  )
    .bind(body.token, now)
    .first();

  if (!dbToken) {
    throw new HttpError(400, "無效或已過期的 Token");
  }

  const newHash = await hashPassword(body.new_password);
  await c.env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?")
    .bind(newHash, String(dbToken.user_id))
    .run();
  await c.env.DB.prepare("DELETE FROM user_tokens WHERE id = ?")
    .bind(String(dbToken.id))
    .run();

  return c.json({ message: "密碼已成功重設，請使用新密碼登錄。" });
});

authRouter.get("/verify-email", async (c) => {
  const token = c.req.query("token") || "";
  const now = new Date().toISOString();
  const dbToken = await c.env.DB.prepare(
    "SELECT id, user_id FROM user_tokens WHERE token = ? AND type = 'verification' AND expires_at > ?"
  )
    .bind(token, now)
    .first();

  if (!dbToken) {
    throw new HttpError(400, "無效或已過期的驗證連結");
  }

  await c.env.DB.prepare("UPDATE users SET is_verified = 1 WHERE id = ?")
    .bind(String(dbToken.user_id))
    .run();
  await c.env.DB.prepare("DELETE FROM user_tokens WHERE id = ?")
    .bind(String(dbToken.id))
    .run();

  return c.json({ message: "電郵驗證成功！您的帳戶已激活。" });
});

authRouter.get("/me", async (c) => {
  const user = await requireUser(c);
  return c.json(formatUserOut(user as unknown as Record<string, unknown>));
});
