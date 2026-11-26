import { Hono } from "hono";
import { Env, Variables } from "../types";
import { HttpError, requireUser } from "../utils/auth";
import { clearQuantStoreCaches } from "../services/quantStore";

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

// ── 基金观察分析队列调度台 (Admin Only) ────────────────────────────────────
function parseJsonArraySafe(raw: string | null | undefined): any[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

adminRouter.get("/fund-research-queue", async (c) => {
  await requireAdmin(c);
  const statusFilter = (c.req.query("status") || "all").trim();

  let totalFunds = 0;
  let sopCovered = 0;
  let queueRows: any[] = [];
  try {
    const fRow = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM wq_funds WHERE is_trackable = 1").first<any>();
    totalFunds = Number(fRow?.cnt || 0);
  } catch {
    totalFunds = 0;
  }
  try {
    const sRow = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM wq_fund_sop_reports").first<any>();
    sopCovered = Number(sRow?.cnt || 0);
  } catch {
    sopCovered = 0;
  }
  try {
    const qRes = await c.env.DB.prepare(
      `SELECT rq.*,
              CASE WHEN sr.slug IS NOT NULL THEN 1 ELSE 0 END AS has_sop_report,
              sr.medal_rating AS sop_medal,
              sr.report_date AS sop_report_date
       FROM wq_fund_research_queue rq
       LEFT JOIN wq_fund_sop_reports sr ON sr.slug = rq.slug
       ORDER BY
         CASE rq.status WHEN 'in_progress' THEN 0 WHEN 'queued' THEN 1 WHEN 'watching' THEN 2 WHEN 'completed' THEN 3 ELSE 4 END,
         CASE rq.priority WHEN 'P0_urgent' THEN 0 WHEN 'P1_high' THEN 1 ELSE 2 END,
         rq.request_count DESC,
         rq.last_requested_at DESC`
    ).all<any>();
    queueRows = qRes.results || [];
  } catch {
    queueRows = [];
  }

  const items = queueRows
    .map((r) => ({
      slug: r.slug,
      code: r.code || r.slug,
      fund_name: r.fund_name || r.slug,
      asset_class: r.asset_class || "",
      ilas_platform: r.ilas_platform || "",
      status: r.status,
      priority: r.priority,
      request_count: Number(r.request_count || 0),
      requesters: parseJsonArraySafe(r.requesters_json),
      admin_note: r.admin_note || "",
      assigned_to: r.assigned_to || "",
      first_requested_at: r.first_requested_at,
      last_requested_at: r.last_requested_at,
      started_at: r.started_at || null,
      completed_at: r.completed_at || null,
      has_sop_report: Boolean(r.has_sop_report),
      sop_medal: r.sop_medal || null,
      sop_report_date: r.sop_report_date || null,
    }))
    .filter((item) => statusFilter === "all" || item.status === statusFilter);

  const queuedCount = queueRows.filter((r) => r.status === "queued").length;
  const watchingCount = queueRows.filter((r) => r.status === "watching").length;
  const inProgressCount = queueRows.filter((r) => r.status === "in_progress").length;
  const completedCount = queueRows.filter((r) => r.status === "completed").length;

  return c.json({
    summary: {
      total_funds: totalFunds,
      sop_covered_count: sopCovered,
      coverage_pct: totalFunds > 0 ? Math.round((sopCovered / totalFunds) * 1000) / 10 : 0,
      queued_count: queuedCount,
      watching_count: watchingCount,
      in_progress_count: inProgressCount,
      completed_count: completedCount,
    },
    items,
  });
});

adminRouter.put("/fund-research-queue/:slug", async (c) => {
  await requireAdmin(c);
  const slug = c.req.param("slug");
  const existing = await c.env.DB.prepare("SELECT * FROM wq_fund_research_queue WHERE slug = ?")
    .bind(slug)
    .first<any>();
  if (!existing) {
    throw new HttpError(404, `观察队列中不存在基金: ${slug}`);
  }

  const body = await c.req.json<{
    status?: string;
    priority?: string;
    admin_note?: string;
    assigned_to?: string;
  }>();

  const validStatuses = new Set(["queued", "watching", "in_progress", "completed", "dismissed"]);
  const validPrios = new Set(["P0_urgent", "P1_high", "normal"]);

  const nextStatus = body.status && validStatuses.has(body.status) ? body.status : existing.status;
  const nextPrio = body.priority && validPrios.has(body.priority) ? body.priority : existing.priority;
  const nextNote = body.admin_note !== undefined ? String(body.admin_note) : existing.admin_note;
  const nextAssigned = body.assigned_to !== undefined ? String(body.assigned_to) : existing.assigned_to;

  const nowIso = new Date().toISOString();
  const nextStarted =
    nextStatus === "in_progress" && !existing.started_at ? nowIso : existing.started_at;
  const nextCompleted =
    nextStatus === "completed" && !existing.completed_at ? nowIso : existing.completed_at;

  await c.env.DB.prepare(
    `UPDATE wq_fund_research_queue
     SET status = ?, priority = ?, admin_note = ?, assigned_to = ?, started_at = ?, completed_at = ?
     WHERE slug = ?`
  )
    .bind(nextStatus, nextPrio, nextNote, nextAssigned, nextStarted, nextCompleted, slug)
    .run();

  clearQuantStoreCaches();

  return c.json({
    success: true,
    slug,
    status: nextStatus,
    priority: nextPrio,
    admin_note: nextNote || "",
    assigned_to: nextAssigned || "",
  });
});

adminRouter.get("/fund-research-queue/export", async (c) => {
  await requireAdmin(c);
  const fmt = (c.req.query("format") || "markdown").toLowerCase();
  const res = await c.env.DB.prepare(
    `SELECT * FROM wq_fund_research_queue
     WHERE status IN ('queued', 'watching', 'in_progress')
     ORDER BY
       CASE priority WHEN 'P0_urgent' THEN 0 WHEN 'P1_high' THEN 1 ELSE 2 END,
       request_count DESC,
       first_requested_at ASC`
  ).all<any>();
  const rows = res.results || [];

  if (fmt === "json") {
    return c.json({ count: rows.length, items: rows });
  }

  const lines = [
    "# 🔍 FIS 观察分析基金线索清单（管理员导出）",
    "",
    `> 导出时间：${new Date().toISOString()}`,
    "",
  ];
  for (const r of rows) {
    const reqs = parseJsonArraySafe(r.requesters_json);
    const notes = reqs.map((x: any) => String(x?.note || "").trim()).filter(Boolean);
    const focus = notes.length > 0 ? notes.join(" / ") : r.admin_note || "常规深度体检";
    lines.push(
      `- [ ] ${r.slug} (${r.code || r.slug} · ${r.fund_name || ""}) | 状态:${r.status} | 优先级:${r.priority} | 关注:${r.request_count || 1}人 | 平台:${r.ilas_platform || "—"} | 焦点: ${focus}`
    );
  }
  return c.text(lines.join("\n") + "\n", 200, {
    "Content-Type": "text/markdown; charset=utf-8",
  });
});

adminRouter.post("/quant/invalidate-cache", async (c) => {
  await requireAdmin(c);
  clearQuantStoreCaches();
  return c.json({ success: true, invalidated_at: new Date().toISOString() });
});
