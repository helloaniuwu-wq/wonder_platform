import { Hono } from "hono";
import { Env, Variables } from "../types";
import { assertCompanyAccess, generateUuid, HttpError, requireUser } from "../utils/auth";

export const companiesRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

companiesRouter.get("/", async (c) => {
  const user = await requireUser(c);
  const { results } = await c.env.DB.prepare(
    `SELECT c.* FROM companies c
     INNER JOIN user_company_access a ON a.company_id = c.id
     WHERE a.user_id = ? AND c.is_active = 1
     ORDER BY c.created_at ASC`
  )
    .bind(user.id)
    .all();

  return c.json(
    (results || []).map((row) => ({
      ...row,
      is_active: Boolean(row.is_active),
    }))
  );
});

companiesRouter.post("/", async (c) => {
  const user = await requireUser(c);
  if (!["admin", "premium"].includes(user.role)) {
    const countRow = await c.env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM user_company_access WHERE user_id = ?"
    )
      .bind(user.id)
      .first<{ cnt: number }>();
    if ((countRow?.cnt || 0) >= 1) {
      throw new HttpError(403, "免費版帳戶只能建立一間公司。如需建立更多，請升級帳戶。");
    }
  }

  const body = await c.req.json<Record<string, unknown>>();
  const id = generateUuid();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO companies (
      id, name_zh, name_en, cr_number, br_number, incorporation_date,
      fiscal_year_end_month, base_currency, address, phone, email, logo_url,
      is_active, created_at, business_mode, company_legal_type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
  )
    .bind(
      id,
      String(body.name_zh || ""),
      body.name_en ? String(body.name_en) : null,
      body.cr_number ? String(body.cr_number) : null,
      body.br_number ? String(body.br_number) : null,
      body.incorporation_date ? String(body.incorporation_date) : null,
      String(body.fiscal_year_end_month || "03"),
      String(body.base_currency || "HKD"),
      body.address ? String(body.address) : null,
      body.phone ? String(body.phone) : null,
      body.email ? String(body.email) : null,
      body.logo_url ? String(body.logo_url) : null,
      now,
      String(body.business_mode || "trading_sme"),
      String(body.company_legal_type || "limited")
    )
    .run();

  await c.env.DB.prepare(
    "INSERT INTO user_company_access (id, user_id, company_id, role, created_at) VALUES (?, ?, ?, 'admin', ?)"
  )
    .bind(generateUuid(), user.id, id, now)
    .run();

  const created = await c.env.DB.prepare("SELECT * FROM companies WHERE id = ?").bind(id).first();
  return c.json({ ...created, is_active: true }, 201);
});

companiesRouter.get("/:company_id", async (c) => {
  const user = await requireUser(c);
  const companyId = c.req.param("company_id");
  const company = await assertCompanyAccess(c.env.DB, companyId, user.id);
  return c.json({ ...company, is_active: Boolean(company.is_active) });
});

companiesRouter.put("/:company_id", async (c) => {
  const user = await requireUser(c);
  const companyId = c.req.param("company_id");
  await assertCompanyAccess(c.env.DB, companyId, user.id);
  const body = await c.req.json<Record<string, unknown>>();

  const allowedFields = [
    "name_zh",
    "name_en",
    "cr_number",
    "br_number",
    "incorporation_date",
    "fiscal_year_end_month",
    "base_currency",
    "address",
    "phone",
    "email",
    "logo_url",
    "business_mode",
    "company_legal_type",
  ];

  const updates: string[] = [];
  const values: unknown[] = [];
  for (const field of allowedFields) {
    if (field in body && body[field] !== undefined) {
      updates.push(`${field} = ?`);
      values.push(body[field]);
    }
  }

  if (updates.length > 0) {
    values.push(companyId);
    await c.env.DB.prepare(`UPDATE companies SET ${updates.join(", ")} WHERE id = ?`)
      .bind(...values)
      .run();
  }

  const updated = await c.env.DB.prepare("SELECT * FROM companies WHERE id = ?")
    .bind(companyId)
    .first();
  return c.json({ ...updated, is_active: Boolean(updated?.is_active) });
});

companiesRouter.get("/:company_id/tax-profile", async (c) => {
  const user = await requireUser(c);
  const companyId = c.req.param("company_id");
  await assertCompanyAccess(c.env.DB, companyId, user.id);

  let profile = await c.env.DB.prepare(
    "SELECT * FROM company_tax_profiles WHERE company_id = ?"
  )
    .bind(companyId)
    .first();

  if (!profile) {
    const id = generateUuid();
    await c.env.DB.prepare(
      `INSERT INTO company_tax_profiles (
        id, company_id, marital_status, spouse_net_income, children_count,
        dependent_parents_60, dependent_parents_55, mpf_self_contribution, other_deductions
      ) VALUES (?, ?, 'single', '0', '0', '0', '0', '0', '0')`
    )
      .bind(id, companyId)
      .run();
    profile = await c.env.DB.prepare("SELECT * FROM company_tax_profiles WHERE id = ?")
      .bind(id)
      .first();
  }

  return c.json(profile);
});

companiesRouter.put("/:company_id/tax-profile", async (c) => {
  const user = await requireUser(c);
  const companyId = c.req.param("company_id");
  await assertCompanyAccess(c.env.DB, companyId, user.id);
  const body = await c.req.json<Record<string, unknown>>();

  let profile = await c.env.DB.prepare(
    "SELECT * FROM company_tax_profiles WHERE company_id = ?"
  )
    .bind(companyId)
    .first();

  if (!profile) {
    const id = generateUuid();
    await c.env.DB.prepare(
      `INSERT INTO company_tax_profiles (
        id, company_id, marital_status, spouse_net_income, children_count,
        dependent_parents_60, dependent_parents_55, mpf_self_contribution, other_deductions
      ) VALUES (?, ?, 'single', '0', '0', '0', '0', '0', '0')`
    )
      .bind(id, companyId)
      .run();
  }

  const allowed = [
    "marital_status",
    "spouse_net_income",
    "children_count",
    "dependent_parents_60",
    "dependent_parents_55",
    "mpf_self_contribution",
    "other_deductions",
  ];
  const updates: string[] = [];
  const values: unknown[] = [];
  for (const f of allowed) {
    if (f in body && body[f] !== undefined) {
      updates.push(`${f} = ?`);
      values.push(String(body[f]));
    }
  }
  if (updates.length > 0) {
    values.push(companyId);
    await c.env.DB.prepare(
      `UPDATE company_tax_profiles SET ${updates.join(", ")} WHERE company_id = ?`
    )
      .bind(...values)
      .run();
  }

  const updated = await c.env.DB.prepare(
    "SELECT * FROM company_tax_profiles WHERE company_id = ?"
  )
    .bind(companyId)
    .first();
  return c.json(updated);
});
