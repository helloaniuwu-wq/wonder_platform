import { Hono } from "hono";
import { Env, Variables } from "../types";
import { HttpError, requireUser } from "../utils/auth";

export const adminRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

/** 检查是否为系统管理员 */
async function requireAdmin(c: any) {
  const currentUser = await requireUser(c);
  if (currentUser.role !== "admin") {
    throw new HttpError(403, "權限不足，僅限系統管理員訪問");
  }
  return currentUser;
}

/**
 * GET /admin/users
 * 获取所有用户列表，包含绑定的顾问 ID 和名称
 */
adminRouter.get("/users", async (c) => {
  await requireAdmin(c);

  const { results } = await c.env.DB.prepare(
    `SELECT 
      u.id, 
      u.email, 
      u.name, 
      u.role, 
      u.is_active, 
      u.is_verified, 
      u.created_at, 
      NULL as last_login_at,
      ac.advisor_id,
      adv.name as advisor_name
    FROM users u
    LEFT JOIN advisor_clients ac ON ac.client_id = u.id AND ac.is_active = 1
    LEFT JOIN users adv ON adv.id = ac.advisor_id
    ORDER BY u.created_at DESC`
  ).all();

  return c.json(
    (results || []).map((u: any) => ({
      ...u,
      is_active: Boolean(u.is_active),
      is_verified: Boolean(u.is_verified),
    }))
  );
});

/**
 * GET /admin/stats
 * 系统数据概览（总用户数、各角色分布、组合总数）
 */
adminRouter.get("/stats", async (c) => {
  await requireAdmin(c);

  const userCounts = await c.env.DB.prepare(
    `SELECT 
      COUNT(*) as total_users,
      SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) as admin_count,
      SUM(CASE WHEN role = 'advisor' THEN 1 ELSE 0 END) as advisor_count,
      SUM(CASE WHEN role = 'premium' THEN 1 ELSE 0 END) as premium_count,
      SUM(CASE WHEN role = 'free' OR role IS NULL THEN 1 ELSE 0 END) as free_count
    FROM users`
  ).first<any>();

  const pfCounts = await c.env.DB.prepare(
    "SELECT COUNT(*) as total_portfolios FROM portfolios"
  ).first<any>();

  return c.json({
    total_users: Number(userCounts?.total_users || 0),
    admin_count: Number(userCounts?.admin_count || 0),
    advisor_count: Number(userCounts?.advisor_count || 0),
    premium_count: Number(userCounts?.premium_count || 0),
    free_count: Number(userCounts?.free_count || 0),
    total_portfolios: Number(pfCounts?.total_portfolios || 0),
  });
});

/**
 * PUT /admin/users/:user_id/role
 * 修改用户角色
 */
adminRouter.put("/users/:user_id/role", async (c) => {
  const currentUser = await requireAdmin(c);
  const userId = c.req.param("user_id");

  if (userId === currentUser.id) {
    throw new HttpError(400, "不可修改自己的管理員角色");
  }

  const target = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first<any>();
  if (!target) throw new HttpError(404, "用戶不存在");

  const body = await c.req.json<{ role: string }>();
  const validRoles = ["admin", "advisor", "premium", "free"];
  if (!validRoles.includes(body.role)) {
    throw new HttpError(400, `無效的角色：${body.role}`);
  }

  await c.env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(body.role, userId).run();

  return c.json({
    id: target.id,
    email: target.email,
    name: target.name,
    role: body.role,
    is_active: Boolean(target.is_active),
  });
});

/**
 * PUT /admin/users/:user_id/advisor
 * 为客户分配或解除财务顾问
 */
adminRouter.put("/users/:user_id/advisor", async (c) => {
  const currentUser = await requireAdmin(c);
  const clientId = c.req.param("user_id");

  const target = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(clientId).first<any>();
  if (!target) throw new HttpError(404, "用戶不存在");

  const body = await c.req.json<{ advisor_id: string | null }>();
  const advisorId = body.advisor_id ? String(body.advisor_id) : null;

  // 将之前的关系设为非激活
  await c.env.DB.prepare(
    "UPDATE advisor_clients SET is_active = 0 WHERE client_id = ?"
  ).bind(clientId).run();

  if (advisorId) {
    const adv = await c.env.DB.prepare("SELECT id, role, name FROM users WHERE id = ?").bind(advisorId).first<any>();
    if (!adv) throw new HttpError(404, "指定的顧問不存在");
    if (adv.role !== "advisor" && adv.role !== "admin") {
      throw new HttpError(400, "指定用戶不是財務顧問");
    }

    await c.env.DB.prepare(
      `INSERT INTO advisor_clients (advisor_id, client_id, assigned_by, is_active, assigned_at)
       VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)`
    ).bind(advisorId, clientId, currentUser.id).run();
  }

  return c.json({
    success: true,
    client_id: clientId,
    advisor_id: advisorId,
  });
});

/**
 * PUT /admin/users/:user_id/status
 * 封禁或激活用户账号
 */
adminRouter.put("/users/:user_id/status", async (c) => {
  const currentUser = await requireAdmin(c);
  const userId = c.req.param("user_id");

  if (userId === currentUser.id) {
    throw new HttpError(400, "不可修改自己的帳戶狀態");
  }

  const target = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first<any>();
  if (!target) throw new HttpError(404, "用戶不存在");

  const body = await c.req.json<{ is_active: boolean }>();
  const isActive = body.is_active ? 1 : 0;

  await c.env.DB.prepare("UPDATE users SET is_active = ? WHERE id = ?").bind(isActive, userId).run();

  return c.json({
    success: true,
    id: userId,
    is_active: Boolean(isActive),
  });
});

/**
 * 历史端点兼容：toggle-premium
 */
adminRouter.post("/users/:user_id/toggle-premium", async (c) => {
  await requireAdmin(c);
  const userId = c.req.param("user_id");
  const body = await c.req.json<{ is_premium: boolean }>();

  const target = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first<any>();
  if (!target) throw new HttpError(404, "用戶不存在");
  if (target.role === "admin") throw new HttpError(400, "不能修改管理員角色");

  const newRole = body.is_premium ? "premium" : "free";
  await c.env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(newRole, userId).run();

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
