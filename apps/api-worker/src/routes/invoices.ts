import { Hono } from "hono";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { Env, Variables } from "../types";
import { assertCompanyAccess, generateUuid, HttpError, requireUser } from "../utils/auth";

export const invoicesRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

function generateInvoiceNumber(invoiceType: string, count: number): string {
  const prefix = invoiceType === "invoice" ? "INV" : "QUO";
  const year = new Date().getFullYear();
  const num = String(count + 1).padStart(3, "0");
  return `${prefix}-${year}-${num}`;
}

async function recalculateInvoiceTotals(db: D1Database, invoiceId: string) {
  const items = await db
    .prepare("SELECT amount FROM invoice_items WHERE invoice_id = ?")
    .bind(invoiceId)
    .all<{ amount: number }>();

  const subtotal = (items.results || []).reduce((acc, it) => acc + (Number(it.amount) || 0), 0);

  const inv = await db
    .prepare("SELECT discount_amount, due_date, status FROM invoices WHERE id = ?")
    .bind(invoiceId)
    .first<{ discount_amount: number; due_date: string; status: string }>();

  const discount = Number(inv?.discount_amount || 0);
  const totalAmount = Math.max(0, subtotal - discount);

  const payments = await db
    .prepare("SELECT amount FROM payments WHERE invoice_id = ?")
    .bind(invoiceId)
    .all<{ amount: number }>();
  const paidAmount = (payments.results || []).reduce((acc, p) => acc + (Number(p.amount) || 0), 0);

  let newStatus = inv?.status || "draft";
  if (paidAmount >= totalAmount && totalAmount > 0) {
    newStatus = "paid";
  } else if (paidAmount > 0) {
    newStatus = "partial";
  } else if (inv?.due_date && new Date(inv.due_date) < new Date() && newStatus !== "void") {
    newStatus = "overdue";
  }

  await db
    .prepare(
      `UPDATE invoices SET
        subtotal = ?,
        total_amount = ?,
        paid_amount = ?,
        status = ?,
        updated_at = ?
      WHERE id = ?`
    )
    .bind(subtotal, totalAmount, paidAmount, newStatus, new Date().toISOString(), invoiceId)
    .run();
}

async function getFullInvoice(
  db: D1Database,
  invoiceId: string,
  companyId: string
): Promise<(Record<string, any> & { items: any[]; payments: any[] }) | null> {
  const invoice = await db
    .prepare("SELECT * FROM invoices WHERE id = ? AND company_id = ?")
    .bind(invoiceId, companyId)
    .first<Record<string, any>>();
  if (!invoice) return null;

  const items = await db
    .prepare("SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order ASC")
    .bind(invoiceId)
    .all();

  const payments = await db
    .prepare("SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date DESC")
    .bind(invoiceId)
    .all();

  return {
    ...invoice,
    items: items.results || [],
    payments: payments.results || [],
  };
}

// ── Dashboard Stats ────────────────────────────────────────────────────────
invoicesRouter.get("/dashboard", async (c) => {
  const user = await requireUser(c);
  const companyId = c.req.param("company_id") || "";
  const company = await assertCompanyAccess(c.env.DB, companyId, user.id);

  const activeInvoices = await c.env.DB.prepare(
    "SELECT total_amount, paid_amount FROM invoices WHERE company_id = ? AND status IN ('sent', 'partial', 'overdue')"
  )
    .bind(companyId)
    .all<{ total_amount: number; paid_amount: number }>();

  const totalOutstanding = (activeInvoices.results || []).reduce(
    (acc, inv) => acc + (Number(inv.total_amount || 0) - Number(inv.paid_amount || 0)),
    0
  );

  const overdueInvoices = await c.env.DB.prepare(
    "SELECT total_amount, paid_amount FROM invoices WHERE company_id = ? AND status = 'overdue'"
  )
    .bind(companyId)
    .all<{ total_amount: number; paid_amount: number }>();

  const totalOverdue = (overdueInvoices.results || []).reduce(
    (acc, inv) => acc + (Number(inv.total_amount || 0) - Number(inv.paid_amount || 0)),
    0
  );

  const now = new Date();
  const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthPayments = await c.env.DB.prepare(
    `SELECT p.amount FROM payments p
     INNER JOIN invoices i ON i.id = p.invoice_id
     WHERE i.company_id = ? AND strftime('%Y-%m', p.payment_date) = ?`
  )
    .bind(companyId, currentYearMonth)
    .all<{ amount: number }>();

  const totalPaidThisMonth = (monthPayments.results || []).reduce(
    (acc, p) => acc + Number(p.amount || 0),
    0
  );

  const statuses = ["draft", "sent", "paid", "partial", "overdue", "void"];
  const invoiceCountByStatus: Record<string, number> = {};
  for (const st of statuses) {
    const row = await c.env.DB.prepare(
      "SELECT COUNT(*) as count FROM invoices WHERE company_id = ? AND status = ?"
    )
      .bind(companyId, st)
      .first<{ count: number }>();
    invoiceCountByStatus[st] = row?.count || 0;
  }

  const recent = await c.env.DB.prepare(
    "SELECT * FROM invoices WHERE company_id = ? ORDER BY created_at DESC LIMIT 10"
  )
    .bind(companyId)
    .all();

  const recentInvoices = (recent.results || []).map((inv: any) => ({
    id: String(inv.id),
    invoice_number: inv.invoice_number,
    client_name: inv.client_name,
    total_amount: Number(inv.total_amount || 0),
    paid_amount: Number(inv.paid_amount || 0),
    balance_due: Number(inv.total_amount || 0) - Number(inv.paid_amount || 0),
    status: inv.status,
    currency: inv.currency,
    issue_date: inv.issue_date,
    due_date: inv.due_date,
  }));

  const fyYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const targetFy = c.req.query("fiscal_year") || `${fyYear}-${String(fyYear + 1).slice(-2)}`;

  const expenseYtdRow = await c.env.DB.prepare(
    "SELECT SUM(amount_hkd) as total FROM expenses WHERE company_id = ? AND fiscal_year = ? AND status = 'confirmed'"
  )
    .bind(companyId, targetFy)
    .first<{ total: number }>();

  let commissionYtd = 0;
  let commissionLastMonth = 0;
  const businessMode = company.business_mode || "trading_sme";

  if (businessMode === "insurance_agent") {
    const ir56m = await c.env.DB.prepare(
      "SELECT total_income FROM ir56m_statements WHERE company_id = ? AND fiscal_year = ? AND status = 'confirmed' LIMIT 1"
    )
      .bind(companyId, targetFy)
      .first<{ total_income: number }>();

    if (ir56m && ir56m.total_income) {
      commissionYtd = Number(ir56m.total_income);
    } else {
      const commRow = await c.env.DB.prepare(
        "SELECT SUM(total_taxable_income) as total FROM commission_statements WHERE company_id = ? AND fiscal_year = ? AND status = 'confirmed'"
      )
        .bind(companyId, targetFy)
        .first<{ total: number }>();
      commissionYtd = Number(commRow?.total || 0);
    }

    const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthStr = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, "0")}`;
    const commLastRow = await c.env.DB.prepare(
      "SELECT SUM(total_taxable_income) as total FROM commission_statements WHERE company_id = ? AND statement_month = ? AND status = 'confirmed'"
    )
      .bind(companyId, lastMonthStr)
      .first<{ total: number }>();
    commissionLastMonth = Number(commLastRow?.total || 0);
  }

  return c.json({
    total_outstanding: totalOutstanding,
    total_overdue: totalOverdue,
    total_paid_this_month: totalPaidThisMonth,
    invoice_count_by_status: invoiceCountByStatus,
    recent_invoices: recentInvoices,
    commission_ytd: commissionYtd,
    commission_last_month: commissionLastMonth,
    expense_ytd: Number(expenseYtdRow?.total || 0),
    fiscal_year: targetFy,
  });
});

// ── Invoices CRUD ──────────────────────────────────────────────────────────
invoicesRouter.get("/invoices", async (c) => {
  const user = await requireUser(c);
  const companyId = c.req.param("company_id") || "";
  await assertCompanyAccess(c.env.DB, companyId, user.id);

  const status = c.req.query("status");
  const search = c.req.query("search");
  const page = Math.max(1, parseInt(c.req.query("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query("page_size") || "20", 10)));
  const offset = (page - 1) * pageSize;

  let sql = "SELECT * FROM invoices WHERE company_id = ?";
  const params: unknown[] = [companyId];

  if (status) {
    sql += " AND status = ?";
    params.push(status);
  }
  if (search) {
    sql += " AND (invoice_number LIKE ? COLLATE NOCASE OR client_name LIKE ? COLLATE NOCASE)";
    params.push(`%${search}%`, `%${search}%`);
  }

  sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  params.push(pageSize, offset);

  const { results } = await c.env.DB.prepare(sql).bind(...params).all();
  const invoices = results || [];

  const fullList = await Promise.all(
    invoices.map(async (inv: any) => {
      const items = await c.env.DB.prepare(
        "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order ASC"
      )
        .bind(inv.id)
        .all();
      const payments = await c.env.DB.prepare(
        "SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date DESC"
      )
        .bind(inv.id)
        .all();
      return {
        ...inv,
        items: items.results || [],
        payments: payments.results || [],
      };
    })
  );

  return c.json(fullList);
});

invoicesRouter.post("/invoices", async (c) => {
  const user = await requireUser(c);
  const companyId = c.req.param("company_id") || "";
  await assertCompanyAccess(c.env.DB, companyId, user.id);

  const body = await c.req.json<any>();
  const id = generateUuid();
  const now = new Date().toISOString();
  const invoiceType = body.invoice_type || "invoice";

  let invoiceNumber = body.invoice_number;
  if (!invoiceNumber) {
    const year = new Date().getFullYear();
    const countRow = await c.env.DB.prepare(
      "SELECT COUNT(*) as count FROM invoices WHERE company_id = ? AND invoice_type = ? AND strftime('%Y', created_at) = ?"
    )
      .bind(companyId, invoiceType, String(year))
      .first<{ count: number }>();
    invoiceNumber = generateInvoiceNumber(invoiceType, countRow?.count || 0);
  }

  const discountAmount = Number(body.discount_amount || 0);

  await c.env.DB.prepare(
    `INSERT INTO invoices (
      id, company_id, client_id, invoice_number, invoice_type, status,
      client_name, client_address, client_email, issue_date, due_date,
      currency, subtotal, discount_amount, tax_amount, total_amount, paid_amount,
      notes, terms, bank_info, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, 0, ?, 0, 0, 0, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      companyId,
      body.client_id ? String(body.client_id) : null,
      invoiceNumber,
      invoiceType,
      body.client_name || "",
      body.client_address || null,
      body.client_email || null,
      body.issue_date || now,
      body.due_date || null,
      body.currency || "HKD",
      discountAmount,
      body.notes || null,
      body.terms || null,
      body.bank_info || null,
      now,
      now
    )
    .run();

  if (Array.isArray(body.items)) {
    for (let i = 0; i < body.items.length; i++) {
      const it = body.items[i];
      const q = Number(it.quantity || 1);
      const p = Number(it.unit_price || 0);
      const amt = it.amount !== undefined ? Number(it.amount) : q * p;
      await c.env.DB.prepare(
        `INSERT INTO invoice_items (id, invoice_id, sort_order, description, quantity, unit_price, amount)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(generateUuid(), id, i, it.description || "", q, p, amt)
        .run();
    }
  }

  await recalculateInvoiceTotals(c.env.DB, id);
  const created = await getFullInvoice(c.env.DB, id, companyId);
  return c.json(created, 201);
});

invoicesRouter.get("/invoices/:invoice_id", async (c) => {
  const user = await requireUser(c);
  const companyId = c.req.param("company_id") || "";
  const invoiceId = c.req.param("invoice_id") || "";
  await assertCompanyAccess(c.env.DB, companyId, user.id);

  const invoice = await getFullInvoice(c.env.DB, invoiceId, companyId);
  if (!invoice) throw new HttpError(404, "發票不存在");
  return c.json(invoice);
});

invoicesRouter.put("/invoices/:invoice_id", async (c) => {
  const user = await requireUser(c);
  const companyId = c.req.param("company_id") || "";
  const invoiceId = c.req.param("invoice_id") || "";
  await assertCompanyAccess(c.env.DB, companyId, user.id);

  const existing = await c.env.DB.prepare(
    "SELECT id, status FROM invoices WHERE id = ? AND company_id = ?"
  )
    .bind(invoiceId, companyId)
    .first<{ id: string; status: string }>();
  if (!existing) throw new HttpError(404, "發票不存在");
  if (existing.status === "void") throw new HttpError(400, "已作廢的發票不能修改");

  const body = await c.req.json<any>();
  const fields = [
    "client_id",
    "client_name",
    "client_address",
    "client_email",
    "issue_date",
    "due_date",
    "currency",
    "discount_amount",
    "notes",
    "terms",
    "bank_info",
    "invoice_type",
  ];

  const updates: string[] = ["updated_at = ?"];
  const values: unknown[] = [new Date().toISOString()];
  for (const f of fields) {
    if (f in body && body[f] !== undefined) {
      updates.push(`${f} = ?`);
      values.push(body[f]);
    }
  }

  values.push(invoiceId, companyId);
  await c.env.DB.prepare(
    `UPDATE invoices SET ${updates.join(", ")} WHERE id = ? AND company_id = ?`
  )
    .bind(...values)
    .run();

  if (Array.isArray(body.items)) {
    await c.env.DB.prepare("DELETE FROM invoice_items WHERE invoice_id = ?").bind(invoiceId).run();
    for (let i = 0; i < body.items.length; i++) {
      const it = body.items[i];
      const q = Number(it.quantity || 1);
      const p = Number(it.unit_price || 0);
      const amt = it.amount !== undefined ? Number(it.amount) : q * p;
      await c.env.DB.prepare(
        `INSERT INTO invoice_items (id, invoice_id, sort_order, description, quantity, unit_price, amount)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(generateUuid(), invoiceId, i, it.description || "", q, p, amt)
        .run();
    }
  }

  await recalculateInvoiceTotals(c.env.DB, invoiceId);
  const updated = await getFullInvoice(c.env.DB, invoiceId, companyId);
  return c.json(updated);
});

invoicesRouter.patch("/invoices/:invoice_id/send", async (c) => {
  const user = await requireUser(c);
  const companyId = c.req.param("company_id") || "";
  const invoiceId = c.req.param("invoice_id") || "";
  await assertCompanyAccess(c.env.DB, companyId, user.id);

  const inv = await c.env.DB.prepare(
    "SELECT id, status FROM invoices WHERE id = ? AND company_id = ?"
  )
    .bind(invoiceId, companyId)
    .first<{ id: string; status: string }>();
  if (!inv) throw new HttpError(404, "發票不存在");

  if (inv.status === "draft") {
    await c.env.DB.prepare(
      "UPDATE invoices SET status = 'sent', updated_at = ? WHERE id = ?"
    )
      .bind(new Date().toISOString(), invoiceId)
      .run();
  }

  return c.json(await getFullInvoice(c.env.DB, invoiceId, companyId));
});

invoicesRouter.patch("/invoices/:invoice_id/void", async (c) => {
  const user = await requireUser(c);
  const companyId = c.req.param("company_id") || "";
  const invoiceId = c.req.param("invoice_id") || "";
  await assertCompanyAccess(c.env.DB, companyId, user.id);

  await c.env.DB.prepare(
    "UPDATE invoices SET status = 'void', updated_at = ? WHERE id = ? AND company_id = ?"
  )
    .bind(new Date().toISOString(), invoiceId, companyId)
    .run();

  return c.json(await getFullInvoice(c.env.DB, invoiceId, companyId));
});

invoicesRouter.delete("/invoices/:invoice_id", async (c) => {
  const user = await requireUser(c);
  const companyId = c.req.param("company_id") || "";
  const invoiceId = c.req.param("invoice_id") || "";
  await assertCompanyAccess(c.env.DB, companyId, user.id);

  await c.env.DB.prepare("DELETE FROM payments WHERE invoice_id = ?").bind(invoiceId).run();
  await c.env.DB.prepare("DELETE FROM invoice_items WHERE invoice_id = ?").bind(invoiceId).run();
  await c.env.DB.prepare("DELETE FROM invoices WHERE id = ? AND company_id = ?")
    .bind(invoiceId, companyId)
    .run();

  return c.json({ message: "發票已刪除" });
});

invoicesRouter.post("/invoices/:invoice_id/payments", async (c) => {
  const user = await requireUser(c);
  const companyId = c.req.param("company_id") || "";
  const invoiceId = c.req.param("invoice_id") || "";
  await assertCompanyAccess(c.env.DB, companyId, user.id);

  const inv = await c.env.DB.prepare("SELECT id FROM invoices WHERE id = ? AND company_id = ?")
    .bind(invoiceId, companyId)
    .first();
  if (!inv) throw new HttpError(404, "發票不存在");

  const body = await c.req.json<any>();
  const id = generateUuid();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO payments (id, invoice_id, company_id, payment_date, amount, method, reference, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      invoiceId,
      companyId,
      body.payment_date || now,
      Number(body.amount || 0),
      body.method || "bank_transfer",
      body.reference || null,
      body.notes || null,
      now
    )
    .run();

  await recalculateInvoiceTotals(c.env.DB, invoiceId);
  return c.json(await getFullInvoice(c.env.DB, invoiceId, companyId), 201);
});

invoicesRouter.delete("/invoices/:invoice_id/payments/:payment_id", async (c) => {
  const user = await requireUser(c);
  const companyId = c.req.param("company_id") || "";
  const invoiceId = c.req.param("invoice_id") || "";
  const paymentId = c.req.param("payment_id") || "";
  await assertCompanyAccess(c.env.DB, companyId, user.id);

  await c.env.DB.prepare("DELETE FROM payments WHERE id = ? AND invoice_id = ? AND company_id = ?")
    .bind(paymentId, invoiceId, companyId)
    .run();

  await recalculateInvoiceTotals(c.env.DB, invoiceId);
  return c.json(await getFullInvoice(c.env.DB, invoiceId, companyId));
});

// ── Invoice PDF Generation ─────────────────────────────────────────────────
invoicesRouter.get("/invoices/:invoice_id/pdf", async (c) => {
  const user = await requireUser(c);
  const companyId = c.req.param("company_id") || "";
  const invoiceId = c.req.param("invoice_id") || "";
  const company = await assertCompanyAccess(c.env.DB, companyId, user.id);

  const inv = await getFullInvoice(c.env.DB, invoiceId, companyId);
  if (!inv) throw new HttpError(404, "發票不存在");

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const isInvoice = inv.invoice_type === "invoice";
  const title = isInvoice ? "INVOICE" : "QUOTATION";

  // Header
  page.drawText(String(company.name_en || company.name_zh || "WONDER COMPANY"), {
    x: 40,
    y: 800,
    size: 16,
    font: fontBold,
    color: rgb(0.1, 0.1, 0.2),
  });

  if (company.address) {
    page.drawText(String(company.address), {
      x: 40,
      y: 780,
      size: 9,
      font,
      color: rgb(0.4, 0.4, 0.4),
    });
  }

  page.drawText(title, {
    x: 420,
    y: 800,
    size: 24,
    font: fontBold,
    color: rgb(0.15, 0.25, 0.45),
  });

  page.drawText(`No: ${inv.invoice_number}`, {
    x: 420,
    y: 780,
    size: 10,
    font,
    color: rgb(0.3, 0.3, 0.3),
  });

  page.drawText(`Date: ${inv.issue_date?.slice(0, 10) || ""}`, {
    x: 420,
    y: 765,
    size: 10,
    font,
    color: rgb(0.3, 0.3, 0.3),
  });

  // Client Info
  page.drawText("BILL TO:", { x: 40, y: 720, size: 10, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText(String(inv.client_name || ""), { x: 40, y: 705, size: 11, font, color: rgb(0.1, 0.1, 0.1) });
  if (inv.client_address) {
    page.drawText(String(inv.client_address), { x: 40, y: 690, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
  }

  // Items Table
  let currentY = 640;
  page.drawLine({
    start: { x: 40, y: currentY + 15 },
    end: { x: 555, y: currentY + 15 },
    thickness: 1,
    color: rgb(0.2, 0.3, 0.5),
  });

  page.drawText("Description", { x: 45, y: currentY, size: 10, font: fontBold });
  page.drawText("Qty", { x: 340, y: currentY, size: 10, font: fontBold });
  page.drawText("Price", { x: 400, y: currentY, size: 10, font: fontBold });
  page.drawText("Amount", { x: 480, y: currentY, size: 10, font: fontBold });

  page.drawLine({
    start: { x: 40, y: currentY - 8 },
    end: { x: 555, y: currentY - 8 },
    thickness: 0.5,
    color: rgb(0.7, 0.7, 0.7),
  });

  currentY -= 25;
  for (const it of inv.items) {
    page.drawText(String(it.description || ""), { x: 45, y: currentY, size: 9, font });
    page.drawText(String(it.quantity || "1"), { x: 340, y: currentY, size: 9, font });
    page.drawText(`${inv.currency} ${Number(it.unit_price || 0).toFixed(2)}`, {
      x: 400,
      y: currentY,
      size: 9,
      font,
    });
    page.drawText(`${inv.currency} ${Number(it.amount || 0).toFixed(2)}`, {
      x: 480,
      y: currentY,
      size: 9,
      font,
    });
    currentY -= 20;
  }

  // Totals
  currentY -= 15;
  page.drawLine({
    start: { x: 340, y: currentY + 10 },
    end: { x: 555, y: currentY + 10 },
    thickness: 0.5,
    color: rgb(0.7, 0.7, 0.7),
  });

  page.drawText("Subtotal:", { x: 360, y: currentY, size: 10, font });
  page.drawText(`${inv.currency} ${Number(inv.subtotal || 0).toFixed(2)}`, { x: 460, y: currentY, size: 10, font });
  currentY -= 18;

  if (Number(inv.discount_amount) > 0) {
    page.drawText("Discount:", { x: 360, y: currentY, size: 10, font });
    page.drawText(`-${inv.currency} ${Number(inv.discount_amount).toFixed(2)}`, { x: 460, y: currentY, size: 10, font });
    currentY -= 18;
  }

  page.drawText("Total Due:", { x: 360, y: currentY, size: 11, font: fontBold, color: rgb(0.15, 0.25, 0.45) });
  page.drawText(`${inv.currency} ${Number(inv.total_amount || 0).toFixed(2)}`, {
    x: 460,
    y: currentY,
    size: 11,
    font: fontBold,
    color: rgb(0.15, 0.25, 0.45),
  });

  const pdfBytes = await pdfDoc.save();
  return new Response(pdfBytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${inv.invoice_number}.pdf"`,
    },
  });
});
