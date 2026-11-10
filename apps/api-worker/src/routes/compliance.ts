import { Hono } from "hono";
import { Env, Variables } from "../types";
import { assertCompanyAccess, generateUuid, HttpError, requireUser } from "../utils/auth";
import { calculateFiscalYear } from "./expenses";

export const complianceRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

const DEFAULT_COMPLIANCE_TEMPLATES = [
  {
    code: "C01",
    title: "商業登記證續期 (BR)",
    title_en: "Business Registration Certificate Renewal",
    category: "ird",
    authority: "稅務局 (IRD)",
    applies_to: "all",
    legal_ref: "Cap. 310 商業登記條例",
    penalty_note: "逾期罰款 HK$300–$3,000，每年或每三年續期",
    reminder_days_before: 45,
    needs_manual: 1,
    offset_days: 0,
  },
  {
    code: "C02",
    title: "周年申報表 (NAR1)",
    title_en: "Annual Return (Form NAR1)",
    category: "cr",
    authority: "公司註冊處 (CR)",
    applies_to: "limited",
    legal_ref: "Cap. 32 § 662",
    penalty_note: "逾期將被徵收高額登記費並可能被起訴，法定日期不可延期",
    reminder_days_before: 30,
    needs_manual: 0,
    offset_days: 42,
  },
  {
    code: "C03",
    title: "利得稅申報 BIR51（法團）",
    title_en: "Profits Tax Return (BIR51) – Corporation",
    category: "ird",
    authority: "稅務局 (IRD)",
    applies_to: "limited",
    legal_ref: "Cap. 112 稅務條例 § 51",
    penalty_note: "須連同核數財務報表提交，逾期罰款及估計評稅",
    reminder_days_before: 30,
    needs_manual: 0,
    offset_days: 300,
  },
  {
    code: "C04",
    title: "利得稅申報 BIR60（個人入息）",
    title_en: "Tax Return (BIR60) – Individual/Sole Prop",
    category: "ird",
    authority: "稅務局 (IRD)",
    applies_to: "unlimited,sole_prop",
    legal_ref: "Cap. 112 稅務條例 § 51",
    penalty_note: "逾期罰款及估計評稅；網上申報可延至6月30日",
    reminder_days_before: 45,
    needs_manual: 0,
    offset_days: 60,
  },
  {
    code: "C05",
    title: "法定核數報告（審計）",
    title_en: "Statutory Audit Report",
    category: "internal",
    authority: "香港會計師公會 (HKICPA)",
    applies_to: "limited",
    legal_ref: "Cap. 32 § 379–406",
    penalty_note: "審計報告是提交BIR51的前置條件",
    reminder_days_before: 60,
    needs_manual: 0,
    offset_days: 270,
  },
];

async function ensureComplianceItems(db: D1Database, companyId: string, company: any, fiscalYear: string) {
  const existing = await db
    .prepare("SELECT COUNT(*) as cnt FROM compliance_items WHERE company_id = ? AND fiscal_year = ?")
    .bind(companyId, fiscalYear)
    .first<{ cnt: number }>();

  if ((existing?.cnt || 0) === 0) {
    const isLimited = (company.company_legal_type || "limited") === "limited";
    const now = new Date().toISOString();
    const startYear = parseInt(fiscalYear.split("-")[0], 10);

    for (const t of DEFAULT_COMPLIANCE_TEMPLATES) {
      if (t.applies_to === "limited" && !isLimited) continue;
      if (t.applies_to === "unlimited,sole_prop" && isLimited) continue;

      let dueDate: string | null = null;
      if (t.code === "C02" && company.incorporation_date) {
        try {
          const inc = new Date(company.incorporation_date);
          const anniversary = new Date(startYear, inc.getMonth(), inc.getDate());
          anniversary.setDate(anniversary.getDate() + (t.offset_days || 42));
          dueDate = anniversary.toISOString().slice(0, 10);
        } catch {}
      } else if (t.code === "C04") {
        dueDate = `${startYear + 1}-05-31`;
      } else {
        const d = new Date(startYear, 3, 1);
        d.setDate(d.getDate() + (t.offset_days || 30));
        dueDate = d.toISOString().slice(0, 10);
      }

      await db
        .prepare(
          `INSERT INTO compliance_items (
            id, company_id, code, fiscal_year, title, title_en, category,
            applies_to, legal_ref, authority, penalty_note, due_date,
            is_manual_date, needs_manual, reminder_days_before, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'pending', ?, ?)`
        )
        .bind(
          generateUuid(),
          companyId,
          t.code,
          fiscalYear,
          t.title,
          t.title_en,
          t.category,
          t.applies_to,
          t.legal_ref,
          t.authority,
          t.penalty_note,
          dueDate,
          t.needs_manual,
          t.reminder_days_before,
          now,
          now
        )
        .run();
    }
  }
}

// ── Compliance List ────────────────────────────────────────────────────────
complianceRouter.get("/", async (c) => {
  const user = await requireUser(c);
  const companyId = c.req.param("company_id") || "";
  const company = await assertCompanyAccess(c.env.DB, companyId, user.id);

  const fiscalYear = c.req.query("year") || calculateFiscalYear(new Date());
  await ensureComplianceItems(c.env.DB, companyId, company, fiscalYear);

  const { results } = await c.env.DB.prepare(
    "SELECT * FROM compliance_items WHERE company_id = ? AND fiscal_year = ? ORDER BY due_date ASC, code ASC"
  )
    .bind(companyId, fiscalYear)
    .all<any>();

  const today = new Date().toISOString().slice(0, 10);
  const items = (results || []).map((it) => {
    let status = it.status;
    if (status === "pending" && it.due_date && it.due_date.slice(0, 10) < today) {
      status = "overdue";
    }
    return {
      ...it,
      status,
      is_manual_date: Boolean(it.is_manual_date),
      needs_manual: Boolean(it.needs_manual),
    };
  });

  return c.json(items);
});

// ── Summary ────────────────────────────────────────────────────────────────
complianceRouter.get("/summary", async (c) => {
  const user = await requireUser(c);
  const companyId = c.req.param("company_id") || "";
  const company = await assertCompanyAccess(c.env.DB, companyId, user.id);

  const fiscalYear = c.req.query("year") || calculateFiscalYear(new Date());
  await ensureComplianceItems(c.env.DB, companyId, company, fiscalYear);

  const { results } = await c.env.DB.prepare(
    "SELECT status, due_date FROM compliance_items WHERE company_id = ? AND fiscal_year = ?"
  )
    .bind(companyId, fiscalYear)
    .all<any>();

  const today = new Date().toISOString().slice(0, 10);
  let pending = 0;
  let overdue = 0;
  let completed = 0;

  for (const it of results || []) {
    if (it.status === "completed") {
      completed++;
    } else if (it.due_date && it.due_date.slice(0, 10) < today) {
      overdue++;
    } else {
      pending++;
    }
  }

  return c.json({
    fiscal_year: fiscalYear,
    total: (results || []).length,
    pending,
    overdue,
    completed,
  });
});

// ── Update Item ────────────────────────────────────────────────────────────
complianceRouter.put("/:item_id", async (c) => {
  const user = await requireUser(c);
  const companyId = c.req.param("company_id") || "";
  const itemId = c.req.param("item_id") || "";
  await assertCompanyAccess(c.env.DB, companyId, user.id);

  const body = await c.req.json<any>();
  const updates: string[] = ["updated_at = ?"];
  const values: unknown[] = [new Date().toISOString()];

  if (body.status !== undefined) {
    updates.push("status = ?");
    values.push(body.status);
    if (body.status === "completed") {
      updates.push("completed_at = ?");
      values.push(new Date().toISOString());
    } else {
      updates.push("completed_at = NULL");
    }
  }

  if (body.due_date !== undefined) {
    updates.push("due_date = ?");
    values.push(body.due_date);
    updates.push("is_manual_date = 1");
  }

  if (body.notes !== undefined) {
    updates.push("notes = ?");
    values.push(body.notes);
  }

  values.push(itemId, companyId);
  await c.env.DB.prepare(
    `UPDATE compliance_items SET ${updates.join(", ")} WHERE id = ? AND company_id = ?`
  )
    .bind(...values)
    .run();

  const updated = await c.env.DB.prepare("SELECT * FROM compliance_items WHERE id = ?").bind(itemId).first();
  return c.json(updated);
});
