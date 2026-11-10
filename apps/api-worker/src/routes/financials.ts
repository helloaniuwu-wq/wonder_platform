import { Hono } from "hono";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { Env, Variables } from "../types";
import { assertCompanyAccess, HttpError, requireUser } from "../utils/auth";
import { calculateFiscalYear } from "./expenses";

export const financialsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

function getFiscalYearDates(fy: string): { start: string; end: string } {
  try {
    const startYr = parseInt(fy.split("-")[0], 10);
    return {
      start: `${startYr}-04-01`,
      end: `${startYr + 1}-03-31`,
    };
  } catch {
    const yr = new Date().getFullYear();
    return { start: `${yr}-04-01`, end: `${yr + 1}-03-31` };
  }
}

function estimateProfitsTax(profit: number, isUnlimited: boolean) {
  if (profit <= 0) {
    return { rate_desc: "無須徵稅", estimated_tax: 0, effective_rate: 0 };
  }
  const tier1Limit = 2000000;
  if (!isUnlimited) {
    // 8.25% / 16.5%
    let tax = 0;
    let desc = "";
    if (profit <= tier1Limit) {
      tax = profit * 0.0825;
      desc = "8.25%（法團兩級制首級）";
    } else {
      tax = tier1Limit * 0.0825 + (profit - tier1Limit) * 0.165;
      desc = "8.25% / 16.5%（法團兩級制）";
    }
    return {
      rate_desc: desc,
      estimated_tax: Math.round(tax * 100) / 100,
      effective_rate: Math.round((tax / profit) * 10000) / 100,
    };
  } else {
    // 7.5% / 15%
    let tax = 0;
    let desc = "";
    if (profit <= tier1Limit) {
      tax = profit * 0.075;
      desc = "7.5%（非法團兩級制首級）";
    } else {
      tax = tier1Limit * 0.075 + (profit - tier1Limit) * 0.15;
      desc = "7.5% / 15%（非法團兩級制）";
    }
    return {
      rate_desc: desc,
      estimated_tax: Math.round(tax * 100) / 100,
      effective_rate: Math.round((tax / profit) * 10000) / 100,
    };
  }
}

// ── Fiscal Years Dropdown ──────────────────────────────────────────────────
financialsRouter.get("/fiscal-years", async (c) => {
  const user = await requireUser(c);
  const companyId = c.req.param("company_id") || "";
  await assertCompanyAccess(c.env.DB, companyId, user.id);

  const today = new Date();
  const currentStart = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  const years = [];
  for (let offset = 0; offset < 4; offset++) {
    const yr = currentStart - offset;
    years.push(`${yr}-${String(yr + 1).slice(-2)}`);
  }
  return c.json({ fiscal_years: years, current: years[0] });
});

// ── P&L Statement ──────────────────────────────────────────────────────────
financialsRouter.get("/pnl", async (c) => {
  const user = await requireUser(c);
  const companyId = c.req.param("company_id") || "";
  const company = await assertCompanyAccess(c.env.DB, companyId, user.id);

  const fiscalYear = c.req.query("fiscal_year") || calculateFiscalYear(new Date());
  const { start, end } = getFiscalYearDates(fiscalYear);

  // 1. Invoices paid
  const invRows = await c.env.DB.prepare(
    `SELECT invoice_number, client_name, issue_date, paid_amount, currency
     FROM invoices
     WHERE company_id = ? AND status IN ('paid', 'partial')
       AND date(issue_date) >= ? AND date(issue_date) <= ?`
  )
    .bind(companyId, start, end)
    .all<any>();

  let invoiceIncome = 0;
  const invoiceList = (invRows.results || []).map((inv: any) => {
    const paid = Number(inv.paid_amount || 0);
    invoiceIncome += paid;
    return {
      invoice_number: inv.invoice_number,
      client_name: inv.client_name,
      issue_date: inv.issue_date?.slice(0, 10) || "",
      amount: paid,
      currency: inv.currency,
    };
  });

  // 2. Commission income
  let commissionIncome = 0;
  let commissionSource = "monthly";
  const commissionList = [];

  const ir56m = await c.env.DB.prepare(
    "SELECT * FROM ir56m_statements WHERE company_id = ? AND fiscal_year = ? AND status = 'confirmed' LIMIT 1"
  )
    .bind(companyId, fiscalYear)
    .first<any>();

  if (ir56m && Number(ir56m.total_income) > 0) {
    commissionIncome = Number(ir56m.total_income);
    commissionSource = "ir56m";
    commissionList.push({
      source: "IR56M 年度申報表",
      period: ir56m.period_start && ir56m.period_end ? `${ir56m.period_start} 至 ${ir56m.period_end}` : fiscalYear,
      amount: commissionIncome,
      note: "來自 IR56M 官方申報",
    });
  } else {
    const stmts = await c.env.DB.prepare(
      "SELECT statement_month, total_taxable_income FROM commission_statements WHERE company_id = ? AND fiscal_year = ? AND status = 'confirmed'"
    )
      .bind(companyId, fiscalYear)
      .all<any>();

    for (const s of stmts.results || []) {
      const amt = Number(s.total_taxable_income || 0);
      commissionIncome += amt;
      commissionList.push({
        source: `月結單 ${s.statement_month || ""}`,
        period: s.statement_month || "",
        amount: amt,
      });
    }
  }

  const totalIncome = invoiceIncome + commissionIncome;

  // 3. Expenses
  const expRows = await c.env.DB.prepare(
    `SELECT c.code, c.name_zh, c.name_en, c.hk_tax_deductible,
            SUM(e.amount_hkd) as total_hkd, COUNT(e.id) as count
     FROM expense_categories c
     LEFT JOIN expenses e ON e.category_id = c.id AND e.company_id = ? AND e.status = 'confirmed' AND e.fiscal_year = ?
     GROUP BY c.id`
  )
    .bind(companyId, fiscalYear)
    .all<any>();

  let totalExpense = 0;
  let totalTaxDeductible = 0;
  const expenseCategories = [];

  for (const r of expRows.results || []) {
    const amt = Number(r.total_hkd || 0);
    if (amt > 0) {
      totalExpense += amt;
      const isDed = ["yes", "partial", "depreciation"].includes(r.hk_tax_deductible);
      if (isDed) totalTaxDeductible += amt;
      expenseCategories.push({
        code: r.code,
        name_zh: r.name_zh,
        name_en: r.name_en || r.code,
        hk_tax_deductible: r.hk_tax_deductible,
        total_hkd: Math.round(amt * 100) / 100,
        count: Number(r.count || 0),
        deductible_pct: 0,
      });
    }
  }

  // Uncategorized
  const uncatRow = await c.env.DB.prepare(
    "SELECT SUM(amount_hkd) as total, COUNT(id) as count FROM expenses WHERE company_id = ? AND status = 'confirmed' AND fiscal_year = ? AND category_id IS NULL"
  )
    .bind(companyId, fiscalYear)
    .first<{ total: number; count: number }>();

  const uncatAmt = Number(uncatRow?.total || 0);
  if (uncatAmt > 0) {
    totalExpense += uncatAmt;
    expenseCategories.push({
      code: "未分類",
      name_zh: "未分類支出",
      name_en: "Uncategorised",
      hk_tax_deductible: "review",
      total_hkd: Math.round(uncatAmt * 100) / 100,
      count: Number(uncatRow?.count || 0),
      deductible_pct: 0,
    });
  }

  for (const ec of expenseCategories) {
    ec.deductible_pct = totalExpense > 0 ? Math.round((ec.total_hkd / totalExpense) * 1000) / 10 : 0;
  }
  expenseCategories.sort((a, b) => b.total_hkd - a.total_hkd);

  const grossProfit = totalIncome - totalExpense;
  const assessableProfit = Math.max(0, totalIncome - totalTaxDeductible);
  const isUnlimited = ["unlimited", "sole_prop"].includes(String(company.company_legal_type));
  const taxInfo = estimateProfitsTax(assessableProfit, isUnlimited);
  const netProfit = grossProfit - taxInfo.estimated_tax;

  return c.json({
    company: {
      id: company.id,
      name_zh: company.name_zh,
      name_en: company.name_en,
      base_currency: company.base_currency || "HKD",
      business_mode: company.business_mode || "trading_sme",
      company_legal_type: company.company_legal_type || "limited",
    },
    fiscal_year: fiscalYear,
    period_start: start,
    period_end: end,
    invoice_income: Math.round(invoiceIncome * 100) / 100,
    commission_income: Math.round(commissionIncome * 100) / 100,
    commission_source: commissionSource,
    total_income: Math.round(totalIncome * 100) / 100,
    invoice_rows: invoiceList,
    commission_rows: commissionList,
    total_expense: Math.round(totalExpense * 100) / 100,
    total_tax_deductible: Math.round(totalTaxDeductible * 100) / 100,
    expense_categories: expenseCategories,
    gross_profit: Math.round(grossProfit * 100) / 100,
    assessable_profit: Math.round(assessableProfit * 100) / 100,
    tax_info: taxInfo,
    net_profit: Math.round(netProfit * 100) / 100,
  });
});

// ── AR Summary ─────────────────────────────────────────────────────────────
financialsRouter.get("/ar", async (c) => {
  const user = await requireUser(c);
  const companyId = c.req.param("company_id") || "";
  await assertCompanyAccess(c.env.DB, companyId, user.id);

  const fiscalYear = c.req.query("fiscal_year") || calculateFiscalYear(new Date());
  const { start, end } = getFiscalYearDates(fiscalYear);

  const { results } = await c.env.DB.prepare(
    `SELECT client_name, total_amount, paid_amount, due_date
     FROM invoices
     WHERE company_id = ? AND status IN ('sent', 'partial', 'overdue', 'paid')
       AND date(issue_date) >= ? AND date(issue_date) <= ?`
  )
    .bind(companyId, start, end)
    .all<any>();

  const today = new Date().toISOString().slice(0, 10);
  const clientMap: Record<string, any> = {};

  for (const inv of results || []) {
    const cname = inv.client_name || "未知客戶";
    if (!clientMap[cname]) {
      clientMap[cname] = {
        client_name: cname,
        invoice_count: 0,
        total_billed: 0,
        total_paid: 0,
        balance_due: 0,
        overdue_amount: 0,
      };
    }
    const tot = Number(inv.total_amount || 0);
    const paid = Number(inv.paid_amount || 0);
    const bal = tot - paid;

    clientMap[cname].invoice_count++;
    clientMap[cname].total_billed += tot;
    clientMap[cname].total_paid += paid;
    clientMap[cname].balance_due += bal;

    if (inv.due_date && inv.due_date.slice(0, 10) < today && bal > 0) {
      clientMap[cname].overdue_amount += bal;
    }
  }

  const clients = Object.values(clientMap).sort((a: any, b: any) => b.balance_due - a.balance_due);
  return c.json({ fiscal_year: fiscalYear, clients });
});

// ── Expense Analysis ───────────────────────────────────────────────────────
financialsRouter.get("/expense-analysis", async (c) => {
  const user = await requireUser(c);
  const companyId = c.req.param("company_id") || "";
  await assertCompanyAccess(c.env.DB, companyId, user.id);

  const fiscalYear = c.req.query("fiscal_year") || calculateFiscalYear(new Date());

  const { results } = await c.env.DB.prepare(
    `SELECT strftime('%Y-%m', receipt_date) as month, SUM(amount_hkd) as total
     FROM expenses
     WHERE company_id = ? AND fiscal_year = ? AND status = 'confirmed'
     GROUP BY month
     ORDER BY month ASC`
  )
    .bind(companyId, fiscalYear)
    .all<any>();

  return c.json({ fiscal_year: fiscalYear, monthly: results || [] });
});

// ── Export PnL PDF ─────────────────────────────────────────────────────────
financialsRouter.get("/export/pdf", async (c) => {
  const user = await requireUser(c);
  const companyId = c.req.param("company_id") || "";
  const company = await assertCompanyAccess(c.env.DB, companyId, user.id);

  const fiscalYear = c.req.query("fiscal_year") || calculateFiscalYear(new Date());

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  page.drawText(String(company.name_en || company.name_zh || "WONDER COMPANY"), {
    x: 40,
    y: 800,
    size: 16,
    font: fontBold,
  });

  page.drawText(`PROFIT & LOSS STATEMENT (${fiscalYear})`, {
    x: 40,
    y: 775,
    size: 14,
    font: fontBold,
    color: rgb(0.15, 0.25, 0.45),
  });

  page.drawText(`Generated on: ${new Date().toISOString().slice(0, 10)}`, {
    x: 40,
    y: 755,
    size: 9,
    font,
    color: rgb(0.4, 0.4, 0.4),
  });

  const pdfBytes = await pdfDoc.save();
  return new Response(pdfBytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="PnL_${fiscalYear}.pdf"`,
    },
  });
});
