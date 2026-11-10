import { Hono } from "hono";
import { Env, Variables } from "../types";
import { assertCompanyAccess, generateUuid, HttpError, requireUser } from "../utils/auth";
import { calculateFiscalYear } from "./expenses";

export const commissionsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

const AIA_EXTRACT_PROMPT = `你是專業的香港保險代理稅務助手。這是一張 AIA International Limited 的 Agent Statement Summary 截圖。
請仔細識別截圖中的所有數字，以純 JSON 格式返回以下字段，不要有任何其他文字：
{
  "insurer_name": "AIA International Limited",
  "agent_code": "代理人編號",
  "agent_name": "代理人姓名",
  "statement_month": "YYYY-MM",
  "fyc_life_annual": 0.0,
  "fyc_life_semi_annual": 0.0,
  "fyc_life_quarterly": 0.0,
  "fyc_life_monthly": 0.0,
  "fyc_life_extra": 0.0,
  "fyc_pa": 0.0,
  "fyc_mpf": 0.0,
  "fyc_subtotal": 0.0,
  "renewal_life": 0.0,
  "renewal_pa": 0.0,
  "renewal_mpf": 0.0,
  "renewal_subtotal": 0.0,
  "other_taxable_income": 0.0,
  "total_taxable_income": 0.0,
  "misc_deduction": 0.0,
  "allowance_offset": 0.0,
  "payment_this_month": 0.0,
  "ytd_fyc_subtotal": 0.0,
  "ytd_renewal_subtotal": 0.0,
  "ytd_other_income": 0.0,
  "ytd_total_taxable": 0.0,
  "ytd_payment": 0.0,
  "confidence": 90
}`;

const IR56M_EXTRACT_PROMPT = `你是專業的香港保險代理稅務助手。這是一張香港稅務局的 IR56M 表格。
請仔細識別截圖中的所有數字，以純 JSON 格式返回以下字段，不要有任何其他文字：
{
  "payer_name": "NAME OF PAYER",
  "agent_code": "CODE NO.",
  "agent_name": "NAME OF RECIPIENT",
  "period_start": "DD/MM/YYYY",
  "period_end": "DD/MM/YYYY",
  "fiscal_year": "YYYY-YY",
  "total_income": 0.0,
  "confidence": 90
}`;

function calculateStatementFiscalYear(monthStr: string): string {
  try {
    const parts = monthStr.split("-");
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    return calculateFiscalYear(new Date(y, m - 1, 1));
  } catch {
    return calculateFiscalYear(new Date());
  }
}

// ── Upload Statement Screenshot ────────────────────────────────────────────
commissionsRouter.post("/upload", async (c) => {
  const user = await requireUser(c);
  const companyId = c.req.param("company_id") || "";
  await assertCompanyAccess(c.env.DB, companyId, user.id);

  const formData = await c.req.formData();
  const file = formData.get("file") as unknown as File;
  if (!file) throw new HttpError(400, "請上傳月結單截圖");

  const buffer = await file.arrayBuffer();
  const filename = file.name || "statement.jpg";
  const monthPrefix = new Date().toISOString().slice(0, 7);
  const uniqueSuffix = generateUuid().slice(0, 8);
  const storedKey = `statements/${monthPrefix}/${uniqueSuffix}_${filename}`;

  await c.env.BUCKET.put(storedKey, buffer, {
    httpMetadata: { contentType: file.type || "image/jpeg" },
  });

  const uint8 = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i]);
  const base64Data = btoa(binary);

  const dataUrl = `data:${file.type || "image/jpeg"};base64,{base64Data}`.replace("{base64Data}", base64Data);

  let extracted: any = {};
  let rawText = "";

  if (c.env.OPENROUTER_API_KEY) {
    const aiRes = await fetch(`${c.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1"}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${c.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: c.env.OPENROUTER_VISION_MODEL || "google/gemini-2.0-flash-001",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: AIA_EXTRACT_PROMPT },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        max_tokens: 1024,
        temperature: 0.1,
      }),
    });

    if (aiRes.ok) {
      const aiJson = await aiRes.json<any>();
      rawText = aiJson.choices?.[0]?.message?.content || "";
      const match = rawText.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          extracted = JSON.parse(match[0]);
        } catch {}
      }
    }
  }

  const id = generateUuid();
  const statementMonth = extracted.statement_month || new Date().toISOString().slice(0, 7);
  const fiscalYear = calculateStatementFiscalYear(statementMonth);
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO commission_statements (
      id, company_id, insurer_name, agent_code, agent_name, statement_month, fiscal_year,
      fyc_life_annual, fyc_life_semi_annual, fyc_life_quarterly, fyc_life_monthly, fyc_life_extra,
      fyc_pa, fyc_mpf, fyc_subtotal, renewal_life, renewal_pa, renewal_mpf, renewal_subtotal,
      other_taxable_income, total_taxable_income, misc_deduction, allowance_offset, payment_this_month,
      ytd_fyc_subtotal, ytd_renewal_subtotal, ytd_other_income, ytd_total_taxable, ytd_payment,
      source_image_path, source_original_filename, ai_confidence, ai_raw_response, status, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, 'pending', ?, ?
    )`
  )
    .bind(
      id,
      companyId,
      extracted.insurer_name || "AIA International Limited",
      extracted.agent_code || null,
      extracted.agent_name || null,
      statementMonth,
      fiscalYear,
      extracted.fyc_life_annual != null ? Number(extracted.fyc_life_annual) : null,
      extracted.fyc_life_semi_annual != null ? Number(extracted.fyc_life_semi_annual) : null,
      extracted.fyc_life_quarterly != null ? Number(extracted.fyc_life_quarterly) : null,
      extracted.fyc_life_monthly != null ? Number(extracted.fyc_life_monthly) : null,
      extracted.fyc_life_extra != null ? Number(extracted.fyc_life_extra) : null,
      extracted.fyc_pa != null ? Number(extracted.fyc_pa) : null,
      extracted.fyc_mpf != null ? Number(extracted.fyc_mpf) : null,
      extracted.fyc_subtotal != null ? Number(extracted.fyc_subtotal) : null,
      extracted.renewal_life != null ? Number(extracted.renewal_life) : null,
      extracted.renewal_pa != null ? Number(extracted.renewal_pa) : null,
      extracted.renewal_mpf != null ? Number(extracted.renewal_mpf) : null,
      extracted.renewal_subtotal != null ? Number(extracted.renewal_subtotal) : null,
      extracted.other_taxable_income != null ? Number(extracted.other_taxable_income) : null,
      extracted.total_taxable_income != null ? Number(extracted.total_taxable_income) : null,
      extracted.misc_deduction != null ? Number(extracted.misc_deduction) : null,
      extracted.allowance_offset != null ? Number(extracted.allowance_offset) : null,
      extracted.payment_this_month != null ? Number(extracted.payment_this_month) : null,
      extracted.ytd_fyc_subtotal != null ? Number(extracted.ytd_fyc_subtotal) : null,
      extracted.ytd_renewal_subtotal != null ? Number(extracted.ytd_renewal_subtotal) : null,
      extracted.ytd_other_income != null ? Number(extracted.ytd_other_income) : null,
      extracted.ytd_total_taxable != null ? Number(extracted.ytd_total_taxable) : null,
      extracted.ytd_payment != null ? Number(extracted.ytd_payment) : null,
      `./${storedKey}`,
      filename,
      extracted.confidence || null,
      rawText || null,
      now,
      now
    )
    .run();

  const created = await c.env.DB.prepare("SELECT * FROM commission_statements WHERE id = ?").bind(id).first();
  return c.json(created);
});

// ── Manual Income ──────────────────────────────────────────────────────────
commissionsRouter.post("/manual", async (c) => {
  const user = await requireUser(c);
  const companyId = c.req.param("company_id") || "";
  await assertCompanyAccess(c.env.DB, companyId, user.id);

  const statementMonth = c.req.query("statement_month") || "";
  const incomeSource = c.req.query("income_source") || "Other Income";
  const amount = Number(c.req.query("amount") || 0);
  const notes = c.req.query("notes") || null;

  const fiscalYear = calculateStatementFiscalYear(statementMonth);
  const id = generateUuid();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO commission_statements (
      id, company_id, insurer_name, statement_month, fiscal_year,
      fyc_subtotal, renewal_subtotal, other_taxable_income, total_taxable_income,
      payment_this_month, status, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?, 'confirmed', ?, ?, ?)`
  )
    .bind(id, companyId, incomeSource, statementMonth, fiscalYear, amount, amount, amount, notes, now, now)
    .run();

  const created = await c.env.DB.prepare("SELECT * FROM commission_statements WHERE id = ?").bind(id).first();
  return c.json(created);
});

// ── IR56M Upload & CRUD ────────────────────────────────────────────────────
commissionsRouter.post("/ir56m/upload", async (c) => {
  const user = await requireUser(c);
  const companyId = c.req.param("company_id") || "";
  await assertCompanyAccess(c.env.DB, companyId, user.id);

  const formData = await c.req.formData();
  const file = formData.get("file") as unknown as File;
  if (!file) throw new HttpError(400, "請上傳 IR56M 截圖");

  const buffer = await file.arrayBuffer();
  const filename = file.name || "ir56m.jpg";
  const uniqueSuffix = generateUuid().slice(0, 8);
  const storedKey = `statements/ir56m/${uniqueSuffix}_${filename}`;

  await c.env.BUCKET.put(storedKey, buffer, {
    httpMetadata: { contentType: file.type || "image/jpeg" },
  });

  const uint8 = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i]);
  const base64Data = btoa(binary);

  const dataUrl = `data:${file.type || "image/jpeg"};base64,{base64Data}`.replace("{base64Data}", base64Data);

  let extracted: any = {};
  let rawText = "";

  if (c.env.OPENROUTER_API_KEY) {
    const aiRes = await fetch(`${c.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1"}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${c.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: c.env.OPENROUTER_VISION_MODEL || "google/gemini-2.0-flash-001",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: IR56M_EXTRACT_PROMPT },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        max_tokens: 1024,
        temperature: 0.1,
      }),
    });

    if (aiRes.ok) {
      const aiJson = await aiRes.json<any>();
      rawText = aiJson.choices?.[0]?.message?.content || "";
      const match = rawText.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          extracted = JSON.parse(match[0]);
        } catch {}
      }
    }
  }

  const id = generateUuid();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO ir56m_statements (
      id, company_id, payer_name, agent_code, agent_name, period_start, period_end,
      fiscal_year, total_income, source_image_path, source_original_filename,
      ai_confidence, ai_raw_response, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
  )
    .bind(
      id,
      companyId,
      extracted.payer_name || "AIA INTERNATIONAL LIMITED",
      extracted.agent_code || null,
      extracted.agent_name || null,
      extracted.period_start || null,
      extracted.period_end || null,
      extracted.fiscal_year || calculateFiscalYear(new Date()),
      extracted.total_income != null ? Number(extracted.total_income) : 0,
      `./${storedKey}`,
      filename,
      extracted.confidence || null,
      rawText || null,
      now,
      now
    )
    .run();

  const created = await c.env.DB.prepare("SELECT * FROM ir56m_statements WHERE id = ?").bind(id).first();
  return c.json(created);
});

commissionsRouter.get("/ir56m", async (c) => {
  const user = await requireUser(c);
  const companyId = c.req.param("company_id") || "";
  await assertCompanyAccess(c.env.DB, companyId, user.id);

  const fiscalYear = c.req.query("fiscal_year");
  let sql = "SELECT * FROM ir56m_statements WHERE company_id = ?";
  const params: unknown[] = [companyId];
  if (fiscalYear) {
    sql += " AND fiscal_year = ?";
    params.push(fiscalYear);
  }
  sql += " ORDER BY fiscal_year DESC";

  const { results } = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json(results || []);
});

commissionsRouter.post("/ir56m/:stmt_id/confirm", async (c) => {
  const user = await requireUser(c);
  const companyId = c.req.param("company_id") || "";
  const stmtId = c.req.param("stmt_id") || "";
  await assertCompanyAccess(c.env.DB, companyId, user.id);

  await c.env.DB.prepare(
    "UPDATE ir56m_statements SET status = 'confirmed', updated_at = ? WHERE id = ? AND company_id = ?"
  )
    .bind(new Date().toISOString(), stmtId, companyId)
    .run();

  return c.json({ status: "confirmed", id: stmtId });
});

// ── Statements List & Details ──────────────────────────────────────────────
commissionsRouter.get("/", async (c) => {
  const user = await requireUser(c);
  const companyId = c.req.param("company_id") || "";
  await assertCompanyAccess(c.env.DB, companyId, user.id);

  const fiscalYear = c.req.query("fiscal_year");
  const status = c.req.query("status");

  let sql = "SELECT * FROM commission_statements WHERE company_id = ?";
  const params: unknown[] = [companyId];
  if (fiscalYear) {
    sql += " AND fiscal_year = ?";
    params.push(fiscalYear);
  }
  if (status) {
    sql += " AND status = ?";
    params.push(status);
  }
  sql += " ORDER BY statement_month DESC";

  const { results } = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json(results || []);
});

commissionsRouter.get("/:stmt_id", async (c) => {
  const user = await requireUser(c);
  const companyId = c.req.param("company_id") || "";
  const stmtId = c.req.param("stmt_id") || "";
  await assertCompanyAccess(c.env.DB, companyId, user.id);

  const stmt = await c.env.DB.prepare(
    "SELECT * FROM commission_statements WHERE id = ? AND company_id = ?"
  )
    .bind(stmtId, companyId)
    .first();
  if (!stmt) throw new HttpError(404, "佣金記錄不存在");
  return c.json(stmt);
});

commissionsRouter.put("/:stmt_id", async (c) => {
  const user = await requireUser(c);
  const companyId = c.req.param("company_id") || "";
  const stmtId = c.req.param("stmt_id") || "";
  await assertCompanyAccess(c.env.DB, companyId, user.id);

  const body = await c.req.json<any>();
  const editable = [
    "fyc_subtotal",
    "renewal_subtotal",
    "other_taxable_income",
    "total_taxable_income",
    "misc_deduction",
    "allowance_offset",
    "payment_this_month",
    "ytd_total_taxable",
    "statement_month",
    "fiscal_year",
    "agent_code",
    "notes",
  ];

  const updates: string[] = ["updated_at = ?"];
  const values: unknown[] = [new Date().toISOString()];

  for (const f of editable) {
    if (f in body && body[f] !== undefined) {
      updates.push(`${f} = ?`);
      values.push(body[f]);
    }
  }

  values.push(stmtId, companyId);
  await c.env.DB.prepare(
    `UPDATE commission_statements SET ${updates.join(", ")} WHERE id = ? AND company_id = ?`
  )
    .bind(...values)
    .run();

  const updated = await c.env.DB.prepare(
    "SELECT * FROM commission_statements WHERE id = ? AND company_id = ?"
  )
    .bind(stmtId, companyId)
    .first();
  return c.json(updated);
});

commissionsRouter.post("/:stmt_id/confirm", async (c) => {
  const user = await requireUser(c);
  const companyId = c.req.param("company_id") || "";
  const stmtId = c.req.param("stmt_id") || "";
  await assertCompanyAccess(c.env.DB, companyId, user.id);

  await c.env.DB.prepare(
    "UPDATE commission_statements SET status = 'confirmed', updated_at = ? WHERE id = ? AND company_id = ?"
  )
    .bind(new Date().toISOString(), stmtId, companyId)
    .run();

  return c.json({ status: "confirmed", id: stmtId });
});

commissionsRouter.post("/:stmt_id/reject", async (c) => {
  const user = await requireUser(c);
  const companyId = c.req.param("company_id") || "";
  const stmtId = c.req.param("stmt_id") || "";
  await assertCompanyAccess(c.env.DB, companyId, user.id);

  const body = await c.req.json<any>().catch(() => ({}));
  await c.env.DB.prepare(
    "UPDATE commission_statements SET status = 'rejected', notes = COALESCE(?, notes), updated_at = ? WHERE id = ? AND company_id = ?"
  )
    .bind(body.notes || null, new Date().toISOString(), stmtId, companyId)
    .run();

  return c.json({ status: "rejected", id: stmtId });
});

commissionsRouter.delete("/:stmt_id", async (c) => {
  const user = await requireUser(c);
  const companyId = c.req.param("company_id") || "";
  const stmtId = c.req.param("stmt_id") || "";
  await assertCompanyAccess(c.env.DB, companyId, user.id);

  const stmt = await c.env.DB.prepare(
    "SELECT source_image_path FROM commission_statements WHERE id = ? AND company_id = ?"
  )
    .bind(stmtId, companyId)
    .first<{ source_image_path: string }>();

  if (stmt?.source_image_path) {
    try {
      await c.env.BUCKET.delete(stmt.source_image_path.replace(/^\.\//, ""));
    } catch {}
  }

  await c.env.DB.prepare("DELETE FROM commission_statements WHERE id = ? AND company_id = ?")
    .bind(stmtId, companyId)
    .run();

  return c.json({ status: "deleted", id: stmtId });
});

// ── Summaries ──────────────────────────────────────────────────────────────
commissionsRouter.get("/summary/annual", async (c) => {
  const user = await requireUser(c);
  const companyId = c.req.param("company_id") || "";
  await assertCompanyAccess(c.env.DB, companyId, user.id);

  const fiscalYear = c.req.query("fiscal_year") || calculateFiscalYear(new Date());

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM commission_statements
     WHERE company_id = ? AND fiscal_year = ? AND status = 'confirmed'
     ORDER BY statement_month ASC`
  )
    .bind(companyId, fiscalYear)
    .all<any>();

  const stmts = results || [];
  const totalFyc = stmts.reduce((a, s) => a + Number(s.fyc_subtotal || 0), 0);
  const totalRenewal = stmts.reduce((a, s) => a + Number(s.renewal_subtotal || 0), 0);
  const totalOther = stmts.reduce((a, s) => a + Number(s.other_taxable_income || 0), 0);
  const totalTaxable = stmts.reduce((a, s) => a + Number(s.total_taxable_income || 0), 0);

  const latest = stmts.length > 0 ? stmts[stmts.length - 1] : null;
  const ytdCheck = latest && latest.ytd_total_taxable != null ? Number(latest.ytd_total_taxable) : null;

  return c.json({
    fiscal_year: fiscalYear,
    statement_count: stmts.length,
    total_fyc: totalFyc,
    total_renewal: totalRenewal,
    total_other_income: totalOther,
    total_taxable_income: totalTaxable,
    ytd_check: ytdCheck,
    is_balanced: ytdCheck != null ? Math.abs(totalTaxable - ytdCheck) < 1.0 : true,
    statements: stmts,
  });
});

commissionsRouter.get("/summary/profit", async (c) => {
  const user = await requireUser(c);
  const companyId = c.req.param("company_id") || "";
  await assertCompanyAccess(c.env.DB, companyId, user.id);

  const fiscalYear = c.req.query("fiscal_year") || calculateFiscalYear(new Date());

  const incRow = await c.env.DB.prepare(
    "SELECT SUM(total_taxable_income) as total FROM commission_statements WHERE company_id = ? AND fiscal_year = ? AND status = 'confirmed'"
  )
    .bind(companyId, fiscalYear)
    .first<{ total: number }>();

  const expRow = await c.env.DB.prepare(
    "SELECT SUM(amount_hkd) as total FROM expenses WHERE company_id = ? AND fiscal_year = ? AND status = 'confirmed'"
  )
    .bind(companyId, fiscalYear)
    .first<{ total: number }>();

  const totalIncome = Number(incRow?.total || 0);
  const totalExpense = Number(expRow?.total || 0);
  const netProfit = totalIncome - totalExpense;

  return c.json({
    fiscal_year: fiscalYear,
    total_income: totalIncome,
    total_expense: totalExpense,
    net_profit: netProfit,
  });
});

commissionsRouter.get("/summary/fiscal-years", async (c) => {
  const user = await requireUser(c);
  const companyId = c.req.param("company_id") || "";
  await assertCompanyAccess(c.env.DB, companyId, user.id);

  const { results } = await c.env.DB.prepare(
    `SELECT DISTINCT fiscal_year FROM commission_statements
     WHERE company_id = ? AND fiscal_year IS NOT NULL
     ORDER BY fiscal_year DESC`
  )
    .bind(companyId)
    .all<{ fiscal_year: string }>();

  return c.json((results || []).map((r) => r.fiscal_year));
});
