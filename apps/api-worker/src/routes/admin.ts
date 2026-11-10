import { Hono } from "hono";
import { Env, Variables } from "../types";
import { HttpError, requireUser } from "../utils/auth";

export const adminRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

adminRouter.get("/users", async (c) => {
  const currentUser = await requireUser(c);
  if (currentUser.role !== "admin") {
    throw new HttpError(403, "權限不足，僅限系統管理員訪問");
  }
  const { results } = await c.env.DB.prepare(
    "SELECT id, email, name, role, is_active, is_verified, created_at FROM users ORDER BY created_at DESC"
  ).all();

  return c.json(
    (results || []).map((u) => ({
      ...u,
      is_active: Boolean(u.is_active),
      is_verified: Boolean(u.is_verified),
    }))
  );
});

adminRouter.post("/users/:user_id/toggle-premium", async (c) => {
  const currentUser = await requireUser(c);
  if (currentUser.role !== "admin") {
    throw new HttpError(403, "權限不足，僅限系統管理員訪問");
  }
  const userId = c.req.param("user_id");
  const body = await c.req.json<{ is_premium: boolean }>();

  const target = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?")
    .bind(userId)
    .first();
  if (!target) {
    throw new HttpError(404, "用戶不存在");
  }
  if (target.role === "admin") {
    throw new HttpError(400, "不能修改管理員角色");
  }

  const newRole = body.is_premium ? "premium" : "free";
  await c.env.DB.prepare("UPDATE users SET role = ? WHERE id = ?")
    .bind(newRole, userId)
    .run();

  return c.json({
    id: target.id,
    email: target.email,
    name: target.name,
    role: newRole,
    is_active: Boolean(target.is_active),
    is_verified: Boolean(target.is_verified),
    created_at: target.created_at,
  });
});
