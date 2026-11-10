import { Hono } from "hono";
import { Env, Variables } from "../types";
import { assertCompanyAccess, generateUuid, HttpError, requireUser } from "../utils/auth";

export const clientsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

function formatClient(row: Record<string, unknown>) {
  return {
    ...row,
    is_active: Boolean(row.is_active),
  };
}

clientsRouter.get("/", async (c) => {
  const user = await requireUser(c);
  const companyId = c.req.param("company_id") || c.req.query("company_id") || "";
  await assertCompanyAccess(c.env.DB, companyId, user.id);

  const search = (c.req.query("search") || "").trim();
  let sql = "SELECT * FROM clients WHERE company_id = ? AND is_active = 1";
  const params: unknown[] = [companyId];

  if (search) {
    sql +=
      " AND (name_zh LIKE ? COLLATE NOCASE OR name_en LIKE ? COLLATE NOCASE OR contact_person LIKE ? COLLATE NOCASE)";
    const pattern = `%${search}%`;
    params.push(pattern, pattern, pattern);
  }

  sql += " ORDER BY name_zh ASC";

  const { results } = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json((results || []).map((r) => formatClient(r as Record<string, unknown>)));
});

clientsRouter.post("/", async (c) => {
  const user = await requireUser(c);
  const companyId = c.req.param("company_id") || c.req.query("company_id") || "";
  await assertCompanyAccess(c.env.DB, companyId, user.id);

  const body = await c.req.json<Record<string, unknown>>();
  if (!body.name_zh) {
    throw new HttpError(400, "請填寫客戶中文名稱");
  }

  const id = generateUuid();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO clients (
      id, company_id, name_zh, name_en, contact_person, email, phone, address, is_active, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
  )
    .bind(
      id,
      companyId,
      String(body.name_zh),
      body.name_en ? String(body.name_en) : null,
      body.contact_person ? String(body.contact_person) : null,
      body.email ? String(body.email) : null,
      body.phone ? String(body.phone) : null,
      body.address ? String(body.address) : null,
      now
    )
    .run();

  const created = await c.env.DB.prepare("SELECT * FROM clients WHERE id = ?").bind(id).first();
  return c.json(formatClient(created as Record<string, unknown>), 201);
});

clientsRouter.get("/:client_id", async (c) => {
  const user = await requireUser(c);
  const companyId = c.req.param("company_id") || "";
  const clientId = c.req.param("client_id");
  await assertCompanyAccess(c.env.DB, companyId, user.id);

  const client = await c.env.DB.prepare(
    "SELECT * FROM clients WHERE id = ? AND company_id = ?"
  )
    .bind(clientId, companyId)
    .first();

  if (!client) {
    throw new HttpError(404, "客戶不存在");
  }

  return c.json(formatClient(client as Record<string, unknown>));
});

clientsRouter.put("/:client_id", async (c) => {
  const user = await requireUser(c);
  const companyId = c.req.param("company_id") || "";
  const clientId = c.req.param("client_id");
  await assertCompanyAccess(c.env.DB, companyId, user.id);

  const existing = await c.env.DB.prepare(
    "SELECT * FROM clients WHERE id = ? AND company_id = ?"
  )
    .bind(clientId, companyId)
    .first();

  if (!existing) {
    throw new HttpError(404, "客戶不存在");
  }

  const body = await c.req.json<Record<string, unknown>>();
  const allowedFields = [
    "name_zh",
    "name_en",
    "contact_person",
    "email",
    "phone",
    "address",
    "is_active",
  ];

  const updates: string[] = [];
  const values: unknown[] = [];

  for (const field of allowedFields) {
    if (field in body && body[field] !== undefined) {
      updates.push(`${field} = ?`);
      if (field === "is_active") {
        values.push(body[field] ? 1 : 0);
      } else {
        values.push(body[field]);
      }
    }
  }

  if (updates.length > 0) {
    values.push(clientId, companyId);
    await c.env.DB.prepare(
      `UPDATE clients SET ${updates.join(", ")} WHERE id = ? AND company_id = ?`
    )
      .bind(...values)
      .run();
  }

  const updated = await c.env.DB.prepare("SELECT * FROM clients WHERE id = ?")
    .bind(clientId)
    .first();
  return c.json(formatClient(updated as Record<string, unknown>));
});

clientsRouter.delete("/:client_id", async (c) => {
  const user = await requireUser(c);
  const companyId = c.req.param("company_id") || "";
  const clientId = c.req.param("client_id");
  await assertCompanyAccess(c.env.DB, companyId, user.id);

  const existing = await c.env.DB.prepare(
    "SELECT id FROM clients WHERE id = ? AND company_id = ?"
  )
    .bind(clientId, companyId)
    .first();

  if (!existing) {
    throw new HttpError(404, "客戶不存在");
  }

  await c.env.DB.prepare("UPDATE clients SET is_active = 0 WHERE id = ? AND company_id = ?")
    .bind(clientId, companyId)
    .run();

  return c.body(null, 204);
});
