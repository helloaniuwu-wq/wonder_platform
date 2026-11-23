import { Hono } from "hono";
import { Env, Variables } from "../types";
import { HttpError, requireUser } from "../utils/auth";

export const advisorRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

/** 验证当前用户是否为顾问或管理员 */
async function requireAdvisorOrAdmin(c: any) {
  const user = await requireUser(c);
  if (user.role !== "advisor" && user.role !== "admin") {
    throw new HttpError(403, "權限不足，僅限財務顧問或系統管理員訪問");
  }
  return user;
}

/**
 * GET /advisor/clients
 * 获取当前顾问的名下客户；若是管理员则获取所有客户
 */
advisorRouter.get("/clients", async (c) => {
  const user = await requireAdvisorOrAdmin(c);

  if (user.role === "admin") {
    const { results } = await c.env.DB.prepare(
      `SELECT 
        u.id, 
        u.name, 
        u.email, 
        u.role,
        u.is_active,
        u.created_at, 
        NULL as last_login_at,
        adv.id as advisor_id,
        adv.name as advisor_name,
        (SELECT COUNT(*) FROM portfolios p WHERE p.user_id = u.id) as portfolio_count,
        (SELECT COUNT(*) FROM insurance_plans ip WHERE ip.client_id = u.id) as insurance_count
      FROM users u
      LEFT JOIN advisor_clients ac ON ac.client_id = u.id AND ac.is_active = 1
      LEFT JOIN users adv ON adv.id = ac.advisor_id
      WHERE u.role IN ('free', 'premium') OR ac.id IS NOT NULL
      ORDER BY u.created_at DESC`
    ).all();

    return c.json(
      (results || []).map((row: any) => ({
        ...row,
        is_active: Boolean(row.is_active),
        portfolio_count: Number(row.portfolio_count || 0),
        insurance_count: Number(row.insurance_count || 0),
      }))
    );
  }

  // 顾问角色：仅查绑定到自身的客户
  const { results } = await c.env.DB.prepare(
    `SELECT 
      u.id, 
      u.name, 
      u.email, 
      u.role,
      u.is_active,
      u.created_at, 
      NULL as last_login_at,
      adv.id as advisor_id,
      adv.name as advisor_name,
      (SELECT COUNT(*) FROM portfolios p WHERE p.user_id = u.id) as portfolio_count,
      (SELECT COUNT(*) FROM insurance_plans ip WHERE ip.client_id = u.id) as insurance_count
    FROM advisor_clients ac
    JOIN users u ON u.id = ac.client_id
    LEFT JOIN users adv ON adv.id = ac.advisor_id
    WHERE ac.advisor_id = ? AND ac.is_active = 1
    ORDER BY u.name ASC`
  )
    .bind(user.id)
    .all();

  return c.json(
    (results || []).map((row: any) => ({
      ...row,
      is_active: Boolean(row.is_active),
      portfolio_count: Number(row.portfolio_count || 0),
      insurance_count: Number(row.insurance_count || 0),
    }))
  );
});

/**
 * GET /advisor/clients/:client_id/portfolios
 * 获取指定客户的投资组合列表
 */
advisorRouter.get("/clients/:client_id/portfolios", async (c) => {
  const user = await requireAdvisorOrAdmin(c);
  const clientId = c.req.param("client_id");

  // 顾问权限检查
  if (user.role !== "admin") {
    const link = await c.env.DB.prepare(
      "SELECT 1 FROM advisor_clients WHERE advisor_id = ? AND client_id = ? AND is_active = 1"
    )
      .bind(user.id, clientId)
      .first();
    if (!link) {
      throw new HttpError(403, "該客戶不在你的服務範圍內");
    }
  }

  const { results } = await c.env.DB.prepare(
    `SELECT id, name, dividend_strategy, base_currency, target_allocations, is_public, sort_order, user_id, created_at
     FROM portfolios
     WHERE user_id = ?
     ORDER BY sort_order ASC, created_at DESC`
  )
    .bind(clientId)
    .all();

  return c.json(
    (results || []).map((p: any) => ({
      id: p.id,
      name: p.name,
      base_currency: p.base_currency || "USD",
      dividend_strategy: p.dividend_strategy || "CASH",
      target_allocations: p.target_allocations ? JSON.parse(p.target_allocations) : {},
      is_public: Boolean(p.is_public),
      sort_order: p.sort_order || 0,
      user_id: p.user_id,
      created_at: p.created_at,
    }))
  );
});
