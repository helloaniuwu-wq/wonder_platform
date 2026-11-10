import { Hono } from "hono";
import { Env, Variables } from "../types";
import { assertCompanyAccess, generateUuid, HttpError, requireUser } from "../utils/auth";

export const expensesRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

const DEFAULT_CATEGORIES = [
  { code: "MEAL", name_zh: "餐飲招待", name_en: "Meals & Entertainment", hk_tax_deductible: "partial", hk_tax_note: "商務餐飲50%可抵扣，私人性質不可扣", sort_order: 1 },
  { code: "TRAVEL", name_zh: "差旅交通", name_en: "Travel & Transportation", hk_tax_deductible: "yes", hk_tax_note: "商務差旅全額可扣，須保留單據", sort_order: 2 },
  { code: "OFFICE", name_zh: "辦公耗材", name_en: "Office Supplies", hk_tax_deductible: "yes", hk_tax_note: "文具、打印耗材等全額可扣", sort_order: 3 },
  { code: "SOFTWARE", name_zh: "軟件訂閱", name_en: "Software & SaaS", hk_tax_deductible: "yes", hk_tax_note: "商業用途SaaS/雲服務全額可扣", sort_order: 4 },
  { code: "MARKETING", name_zh: "市場營銷", name_en: "Marketing & Advertising", hk_tax_deductible: "yes", hk_tax_note: "廣告、推廣費用全額可扣", sort_order: 5 },
  { code: "STAFF", name_zh: "員工津貼福利", name_en: "Staff Benefits", hk_tax_deductible: "yes", hk_tax_note: "員工薪酬、福利全額可扣", sort_order: 6 },
  { code: "PROFESSIONAL", name_zh: "專業服務費", name_en: "Professional Fees", hk_tax_deductible: "yes", hk_tax_note: "律師費、會計師費全額可扣", sort_order: 7 },
  { code: "EQUIPMENT", name_zh: "設備採購", name_en: "Equipment & Machinery", hk_tax_deductible: "depreciation", hk_tax_note: "資本性支出按折舊攤銷", sort_order: 8 },
  { code: "UTILITIES", name_zh: "水電通訊", name_en: "Utilities & Comms", hk_tax_deductible: "yes", hk_tax_note: "辦公場所水電、電話按商用比例可扣", sort_order: 9 },
  { code: "RENT", name_zh: "租金", name_en: "Rent", hk_tax_deductible: "yes", hk_tax_note: "商業用途租金全額可扣", sort_order: 10 },
  { code: "INSURANCE", name_zh: "保險", name_en: "Insurance", hk_tax_deductible: "yes", hk_tax_note: "商業保險（非人壽）全額可扣", sort_order: 11 },
  { code: "ENTERTAINMENT", name_zh: "商務娛樂", name_en: "Business Entertainment", hk_tax_deductible: "no", hk_tax_note: "按稅務局規定，商務娛樂不可扣", sort_order: 12 },
  { code: "OTHER", name_zh: "其他", name_en: "Other", hk_tax_deductible: "review", hk_tax_note: "需人工確認是否符合抵扣條件", sort_order: 13 },
];

export function calculateFiscalYear(d: Date): string {
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}

const FALLBACK_RATES: Record<string, number> = {
  HKD: 1.0,
  CNY: 1.08,
  USD: 7.78,
  EUR: 8.5,
  GBP: 10.2,
  JPY: 0.052,
  SGD: 5.8,
  AUD: 4.9,
  MYR: 1.75,
  TWD: 0.24,
};

export async function convertToHkd(amount: number | null | undefined, currency: string): Promise<number | null> {
  if (amount == null) return null;
  const curr = (currency || "HKD").toUpperCase().trim();
  if (curr === "HKD") return Math.round(amount * 100) / 100;

  try {
    const res = await fetch(`https://api.frankfurter.app/latest?from=${curr}&to=HKD`, {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const data = await res.json<any>();
      const rate = data?.rates?.HKD;
      if (rate) return Math.round(amount * rate * 100) / 100;
    }
  } catch {}

  const fb = FALLBACK_RATES[curr];
  if (fb) return Math.round(amount * fb * 100) / 100;
  return amount;
}

async function ensureCategories(db: D1Database) {
  const row = await db.prepare("SELECT COUNT(*) as cnt FROM expense_categories").first<{ cnt: number }>();
  if ((row?.cnt || 0) === 0) {
    for (const c of DEFAULT_CATEGORIES) {
      await db
        .prepare(
          `INSERT INTO expense_categories (id, code, name_zh, name_en, simple_category, hk_tax_deductible, hk_tax_note, is_active, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`
        )
        .bind(generateUuid(), c.code, c.name_zh, c.name_en, c.code, c.hk_tax_deductible, c.hk_tax_note, c.sort_order)
        .run();
    }
  }
}

// ── Categories List ────────────────────────────────────────────────────────
expensesRouter.get("/categories", async (c) => {
  await ensureCategories(c.env.DB);
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM expense_categories WHERE is_active = 1 ORDER BY sort_order ASC"
  ).all();
  return c.json(
    (results || []).map((r: any) => ({
      id: r.id,
      code: r.code,
      name_zh: r.name_zh,
      name_en: r.name_en,
      hk_tax_deductible: r.hk_tax_deductible,
      hk_tax_note: r.hk_tax_note,
    }))
  );
});

// ── Expenses List ──────────────────────────────────────────────────────────
expensesRouter.get("/", async (c) => {
  const user = await requireUser(c);
  const companyId = c.req.query("company_id") || "";
  if (!companyId) throw new HttpError(400, "請提供 company_id");
  await assertCompanyAccess(c.env.DB, companyId, user.id);

  const fiscalYear = c.req.query("fiscal_year");
  const categoryCode = c.req.query("category_code");
  const status = c.req.query("status");
  const receiptType = c.req.query("receipt_type");
  const dateFrom = c.req.query("date_from");
  const dateTo = c.req.query("date_to");
  const page = Math.max(1, parseInt(c.req.query("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query("page_size") || "20", 10)));
  const offset = (page - 1) * pageSize;

  let sql = `
    SELECT e.*, c.code as cat_code, c.name_zh as cat_name_zh, c.hk_tax_deductible as cat_tax, c.hk_tax_note as cat_tax_note
    FROM expenses e
    LEFT JOIN expense_categories c ON c.id = e.category_id
    WHERE e.company_id = ?
  `;
  const params: unknown[] = [companyId];

  if (fiscalYear) {
    if (fiscalYear === "none") {
      sql += " AND e.fiscal_year IS NULL";
    } else {
      sql += " AND e.fiscal_year = ?";
      params.push(fiscalYear);
    }
  }
  if (status) {
    sql += " AND e.status = ?";
    params.push(status);
  }
  if (receiptType) {
    sql += " AND e.receipt_type = ?";
    params.push(receiptType);
  }
  if (dateFrom) {
    sql += " AND e.receipt_date >= ?";
    params.push(dateFrom);
  }
  if (dateTo) {
    sql += " AND e.receipt_date <= ?";
    params.push(dateTo);
  }
  if (categoryCode) {
    sql += " AND c.code = ?";
    params.push(categoryCode);
  }

  const countSql = `SELECT COUNT(*) as total FROM (${sql})`;
  const countRow = await c.env.DB.prepare(countSql).bind(...params).first<{ total: number }>();
  const total = countRow?.total || 0;

  sql += " ORDER BY e.receipt_date DESC, e.created_at DESC LIMIT ? OFFSET ?";
  params.push(pageSize, offset);

  const { results } = await c.env.DB.prepare(sql).bind(...params).all();

  const items = (results || []).map((e: any) => ({
    id: e.id,
    voucher_number: e.voucher_number,
    receipt_type: e.receipt_type,
    receipt_date: e.receipt_date,
    fiscal_year: e.fiscal_year,
    vendor_name: e.vendor_name,
    vendor_tax_id: e.vendor_tax_id,
    description: e.description,
    currency: e.currency,
    amount_original: e.amount_original != null ? Number(e.amount_original) : null,
    tax_rate: e.tax_rate != null ? Number(e.tax_rate) : null,
    tax_amount: e.tax_amount != null ? Number(e.tax_amount) : null,
    total_amount: e.total_amount != null ? Number(e.total_amount) : null,
    amount_hkd: e.amount_hkd != null ? Number(e.amount_hkd) : null,
    cn_invoice_code: e.cn_invoice_code,
    cn_invoice_number: e.cn_invoice_number,
    category: e.category_id
      ? {
          code: e.cat_code,
          name_zh: e.cat_name_zh,
          hk_tax_deductible: e.cat_tax,
          hk_tax_note: e.cat_tax_note,
        }
      : null,
    ai_confidence: e.ai_confidence,
    receipt_image_path: e.receipt_image_path,
    receipt_original_filename: e.receipt_original_filename,
    source_format: e.source_format,
    status: e.status,
    notes: e.notes,
    upload_date: e.upload_date,
    created_at: e.created_at,
  }));

  return c.json({ total, page, page_size: pageSize, items });
});

// ── Upload Receipts (AI Scan + R2 Put) ──────────────────────────────────────
const EXTRACT_PROMPT = `你是專業的會計助手，需要從收據/發票圖片中提取結構化數據。
請認真識別並以純 JSON 格式返回，不要有任何其他文字：
{
  "receipt_type": "cn_vat_special|cn_vat_general|cn_ordinary|hk_receipt|other",
  "receipt_date": "YYYY-MM-DD",
  "vendor_name": "商戶全稱",
  "vendor_tax_id": "納稅人識別號（僅內地發票有，其他填null）",
  "currency": "CNY|HKD|USD|EUR|...",
  "amount_original": 0.00,
  "tax_rate": 0.09,
  "tax_amount": 0.00,
  "total_amount": 0.00,
  "cn_invoice_code": "發票代碼（僅內地發票有，其他填null）",
  "cn_invoice_number": "發票號碼（僅內地發票有，其他填null）",
  "description": "消費內容簡述",
  "suggested_category": "MEAL|TRAVEL|OFFICE|MARKETING|STAFF|PROFESSIONAL|EQUIPMENT|UTILITIES|RENT|INSURANCE|ENTERTAINMENT|OTHER",
  "confidence": 85
}`;

expensesRouter.post("/upload", async (c) => {
  const user = await requireUser(c);
  const formData = await c.req.formData();
  const companyId = String(formData.get("company_id") || "");
  if (!companyId) throw new HttpError(400, "請提供 company_id");
  await assertCompanyAccess(c.env.DB, companyId, user.id);
  await ensureCategories(c.env.DB);

  const files = formData.getAll("files") as unknown as File[];
  if (!files || files.length === 0) throw new HttpError(400, "請上傳文件");

  const results: any[] = [];

  for (const file of files) {
    const filename = file.name || "unknown.jpg";
    try {
      const buffer = await file.arrayBuffer();
      const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const fileHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

      const existing = await c.env.DB.prepare(
        "SELECT voucher_number FROM expenses WHERE company_id = ? AND file_hash = ?"
      )
        .bind(companyId, fileHash)
        .first<{ voucher_number: string }>();

      if (existing) {
        results.push({
          filename,
          status: "error",
          error: `防重攔截：該憑證已存在 (${existing.voucher_number})`,
        });
        continue;
      }

      // Store in R2
      const monthPrefix = new Date().toISOString().slice(0, 7);
      const uniqueSuffix = generateUuid().slice(0, 8);
      const ext = filename.split(".").pop() || "jpg";
      const storedKey = `receipts/${monthPrefix}/${uniqueSuffix}_${filename}`;
      await c.env.BUCKET.put(storedKey, buffer, {
        httpMetadata: { contentType: file.type || "image/jpeg" },
      });

      // Call Vision API via OpenRouter
      const uint8 = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i]);
      const base64Data = btoa(binary);

      const mimeType = file.type || (filename.endsWith(".pdf") ? "application/pdf" : "image/jpeg");
      const dataUrl = `data:${mimeType};base64,${base64Data}`;

      let aiData: any = {};
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
                  { type: "text", text: EXTRACT_PROMPT },
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
              aiData = JSON.parse(match[0]);
            } catch {}
          }
        }
      }

      const receiptDate = aiData.receipt_date || new Date().toISOString().slice(0, 10);
      const fiscalYear = calculateFiscalYear(new Date(receiptDate));
      const currency = (aiData.currency || "HKD").toUpperCase();
      const totalAmount = aiData.total_amount != null ? Number(aiData.total_amount) : 0;
      const amountHkd = await convertToHkd(totalAmount, currency);

      const catCode = aiData.suggested_category || "OTHER";
      const catRow = await c.env.DB.prepare(
        "SELECT id FROM expense_categories WHERE code = ?"
      )
        .bind(catCode)
        .first<{ id: string }>();

      const countRow = await c.env.DB.prepare(
        "SELECT COUNT(*) as cnt FROM expenses WHERE company_id = ? AND receipt_date = ?"
      )
        .bind(companyId, receiptDate)
        .first<{ cnt: number }>();
      const count = (countRow?.cnt || 0) + 1;
      const voucherNumber = `EXP-${receiptDate.replace(/-/g, "").slice(0, 6)}-${String(count).padStart(3, "0")}-${generateUuid().slice(0, 4).toUpperCase()}`;

      const expenseId = generateUuid();
      const now = new Date().toISOString();

      await c.env.DB.prepare(
        `INSERT INTO expenses (
          id, company_id, voucher_number, receipt_type, receipt_date, upload_date,
          vendor_name, vendor_tax_id, description, currency, amount_original,
          tax_rate, tax_amount, total_amount, amount_hkd, cn_invoice_code,
          cn_invoice_number, category_id, ai_confidence, ai_raw_response,
          receipt_image_path, receipt_original_filename, source_format, fiscal_year,
          file_hash, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
      )
        .bind(
          expenseId,
          companyId,
          voucherNumber,
          aiData.receipt_type || "hk_receipt",
          receiptDate,
          now,
          aiData.vendor_name || null,
          aiData.vendor_tax_id || null,
          aiData.description || null,
          currency,
          aiData.amount_original != null ? Number(aiData.amount_original) : totalAmount,
          aiData.tax_rate != null ? Number(aiData.tax_rate) : null,
          aiData.tax_amount != null ? Number(aiData.tax_amount) : null,
          totalAmount,
          amountHkd,
          aiData.cn_invoice_code || null,
          aiData.cn_invoice_number || null,
          catRow?.id || null,
          aiData.confidence || null,
          rawText || null,
          `./${storedKey}`,
          filename,
          ext,
          fiscalYear,
          fileHash,
          now,
          now
        )
        .run();

      results.push({
        filename,
        status: "success",
        voucher_number: voucherNumber,
        vendor_name: aiData.vendor_name || null,
        total_amount: totalAmount,
        amount_hkd: amountHkd,
        currency,
        receipt_date: receiptDate,
        fiscal_year: fiscalYear,
        ai_confidence: aiData.confidence || null,
        expense_id: expenseId,
      });
    } catch (err: any) {
      results.push({ filename, status: "error", error: err.message });
    }
  }

  const successCount = results.filter((r) => r.status === "success").length;
  return c.json({
    total: files.length,
    success: successCount,
    failed: files.length - successCount,
    results,
  });
});

// ── Manual Expense ─────────────────────────────────────────────────────────
expensesRouter.post("/manual", async (c) => {
  const user = await requireUser(c);
  const formData = await c.req.formData();
  const companyId = String(formData.get("company_id") || "");
  if (!companyId) throw new HttpError(400, "請提供 company_id");
  await assertCompanyAccess(c.env.DB, companyId, user.id);
  await ensureCategories(c.env.DB);

  const receiptDate = String(formData.get("receipt_date") || new Date().toISOString().slice(0, 10));
  const vendorName = String(formData.get("vendor_name") || "");
  const totalAmount = Number(formData.get("total_amount") || 0);
  const categoryCode = String(formData.get("category_code") || "OTHER");
  const currency = String(formData.get("currency") || "HKD").toUpperCase();
  const description = formData.get("description") ? String(formData.get("description")) : null;
  const notes = formData.get("notes") ? String(formData.get("notes")) : null;

  const fiscalYear = calculateFiscalYear(new Date(receiptDate));
  const amountHkd = await convertToHkd(totalAmount, currency);

  const catRow = await c.env.DB.prepare("SELECT id FROM expense_categories WHERE code = ?")
    .bind(categoryCode)
    .first<{ id: string }>();

  const countRow = await c.env.DB.prepare(
    "SELECT COUNT(*) as cnt FROM expenses WHERE company_id = ? AND receipt_date = ?"
  )
    .bind(companyId, receiptDate)
    .first<{ cnt: number }>();
  const count = (countRow?.cnt || 0) + 1;
  const voucherNumber = `EXP-${receiptDate.replace(/-/g, "").slice(0, 6)}-M${String(count).padStart(3, "0")}-${generateUuid().slice(0, 4).toUpperCase()}`;

  const id = generateUuid();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO expenses (
      id, company_id, voucher_number, receipt_type, receipt_date, upload_date,
      vendor_name, description, currency, total_amount, amount_hkd, category_id,
      fiscal_year, status, notes, created_at, updated_at
    ) VALUES (?, ?, ?, 'other', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?)`
  )
    .bind(
      id,
      companyId,
      voucherNumber,
      receiptDate,
      now,
      vendorName,
      description,
      currency,
      totalAmount,
      amountHkd,
      catRow?.id || null,
      fiscalYear,
      notes,
      now,
      now
    )
    .run();

  const created = await c.env.DB.prepare("SELECT * FROM expenses WHERE id = ?").bind(id).first();
  return c.json(created);
});

// ── Single Expense Detail ──────────────────────────────────────────────────
expensesRouter.get("/:expense_id", async (c) => {
  const user = await requireUser(c);
  const expenseId = c.req.param("expense_id");
  const row = await c.env.DB.prepare(
    `SELECT e.*, c.code as cat_code, c.name_zh as cat_name_zh, c.hk_tax_deductible as cat_tax, c.hk_tax_note as cat_tax_note
     FROM expenses e
     LEFT JOIN expense_categories c ON c.id = e.category_id
     WHERE e.id = ?`
  )
    .bind(expenseId)
    .first<any>();

  if (!row) throw new HttpError(404, "記錄不存在");
  await assertCompanyAccess(c.env.DB, row.company_id, user.id);

  return c.json({
    ...row,
    amount_original: row.amount_original != null ? Number(row.amount_original) : null,
    total_amount: row.total_amount != null ? Number(row.total_amount) : null,
    amount_hkd: row.amount_hkd != null ? Number(row.amount_hkd) : null,
    category: row.category_id
      ? {
          code: row.cat_code,
          name_zh: row.cat_name_zh,
          hk_tax_deductible: row.cat_tax,
          hk_tax_note: row.cat_tax_note,
        }
      : null,
  });
});

// ── Update Expense ─────────────────────────────────────────────────────────
expensesRouter.put("/:expense_id", async (c) => {
  const user = await requireUser(c);
  const expenseId = c.req.param("expense_id");
  const existing = await c.env.DB.prepare("SELECT * FROM expenses WHERE id = ?").bind(expenseId).first<any>();
  if (!existing) throw new HttpError(404, "記錄不存在");
  await assertCompanyAccess(c.env.DB, existing.company_id, user.id);

  const formData = await c.req.formData();
  const vendorName = formData.get("vendor_name");
  const description = formData.get("description");
  const receiptDate = formData.get("receipt_date");
  const currency = formData.get("currency");
  const totalAmount = formData.get("total_amount");
  const categoryCode = formData.get("category_code");
  const notes = formData.get("notes");
  const fiscalYear = formData.get("fiscal_year");

  let newCurrency = currency ? String(currency).toUpperCase() : existing.currency;
  let newTotal = totalAmount != null ? Number(totalAmount) : Number(existing.total_amount);
  let newHkd = await convertToHkd(newTotal, newCurrency);

  let catId = existing.category_id;
  if (categoryCode) {
    const cat = await c.env.DB.prepare("SELECT id FROM expense_categories WHERE code = ?")
      .bind(String(categoryCode))
      .first<{ id: string }>();
    if (cat) catId = cat.id;
  }

  let finalFy = fiscalYear ? String(fiscalYear) : existing.fiscal_year;
  if (receiptDate) {
    finalFy = calculateFiscalYear(new Date(String(receiptDate)));
  }

  await c.env.DB.prepare(
    `UPDATE expenses SET
      vendor_name = COALESCE(?, vendor_name),
      description = COALESCE(?, description),
      receipt_date = COALESCE(?, receipt_date),
      currency = ?,
      total_amount = ?,
      amount_hkd = ?,
      category_id = ?,
      fiscal_year = ?,
      notes = COALESCE(?, notes),
      updated_at = ?
    WHERE id = ?`
  )
    .bind(
      vendorName != null ? String(vendorName) : null,
      description != null ? String(description) : null,
      receiptDate != null ? String(receiptDate) : null,
      newCurrency,
      newTotal,
      newHkd,
      catId,
      finalFy,
      notes != null ? String(notes) : null,
      new Date().toISOString(),
      expenseId
    )
    .run();

  const updated = await c.env.DB.prepare("SELECT * FROM expenses WHERE id = ?").bind(expenseId).first();
  return c.json(updated);
});

expensesRouter.put("/:expense_id/confirm", async (c) => {
  const user = await requireUser(c);
  const expenseId = c.req.param("expense_id");
  const existing = await c.env.DB.prepare("SELECT company_id, voucher_number FROM expenses WHERE id = ?")
    .bind(expenseId)
    .first<{ company_id: string; voucher_number: string }>();
  if (!existing) throw new HttpError(404, "記錄不存在");
  await assertCompanyAccess(c.env.DB, existing.company_id, user.id);

  await c.env.DB.prepare("UPDATE expenses SET status = 'confirmed', updated_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), expenseId)
    .run();

  return c.json({ message: "已確認", voucher_number: existing.voucher_number });
});

expensesRouter.put("/:expense_id/reject", async (c) => {
  const user = await requireUser(c);
  const expenseId = c.req.param("expense_id");
  const existing = await c.env.DB.prepare("SELECT company_id, voucher_number, notes FROM expenses WHERE id = ?")
    .bind(expenseId)
    .first<{ company_id: string; voucher_number: string; notes: string }>();
  if (!existing) throw new HttpError(404, "記錄不存在");
  await assertCompanyAccess(c.env.DB, existing.company_id, user.id);

  const formData = await c.req.formData();
  const reason = formData.get("reason");
  const newNotes = reason ? `[駁回原因] ${reason}\n${existing.notes || ""}` : existing.notes;

  await c.env.DB.prepare("UPDATE expenses SET status = 'rejected', notes = ?, updated_at = ? WHERE id = ?")
    .bind(newNotes, new Date().toISOString(), expenseId)
    .run();

  return c.json({ message: "已駁回", voucher_number: existing.voucher_number });
});

expensesRouter.delete("/:expense_id", async (c) => {
  const user = await requireUser(c);
  const expenseId = c.req.param("expense_id");
  const existing = await c.env.DB.prepare("SELECT company_id, receipt_image_path FROM expenses WHERE id = ?")
    .bind(expenseId)
    .first<{ company_id: string; receipt_image_path: string }>();
  if (!existing) throw new HttpError(404, "記錄不存在");
  await assertCompanyAccess(c.env.DB, existing.company_id, user.id);

  if (existing.receipt_image_path) {
    const key = existing.receipt_image_path.replace(/^\.\//, "");
    try {
      await c.env.BUCKET.delete(key);
    } catch {}
  }

  await c.env.DB.prepare("DELETE FROM expenses WHERE id = ?").bind(expenseId).run();
  return c.json({ message: "已刪除" });
});

// ── Stats ──────────────────────────────────────────────────────────────────
expensesRouter.get("/stats/by-category", async (c) => {
  const user = await requireUser(c);
  const companyId = c.req.query("company_id") || "";
  if (!companyId) throw new HttpError(400, "請提供 company_id");
  await assertCompanyAccess(c.env.DB, companyId, user.id);

  const fiscalYear = c.req.query("fiscal_year");
  let sql = `
    SELECT c.code as category_code, c.name_zh as category_name, c.hk_tax_deductible,
           COUNT(e.id) as count, SUM(e.amount_hkd) as total_hkd
    FROM expense_categories c
    LEFT JOIN expenses e ON e.category_id = c.id AND e.company_id = ? AND e.status != 'rejected'
  `;
  const params: unknown[] = [companyId];
  if (fiscalYear) {
    sql += " AND e.fiscal_year = ?";
    params.push(fiscalYear);
  }
  sql += " GROUP BY c.code, c.name_zh, c.hk_tax_deductible ORDER BY c.sort_order ASC";

  const { results } = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json(
    (results || []).map((r: any) => ({
      category_code: r.category_code,
      category_name: r.category_name,
      hk_tax_deductible: r.hk_tax_deductible,
      count: Number(r.count || 0),
      total_hkd: Number(r.total_hkd || 0),
    }))
  );
});

expensesRouter.get("/stats/by-fiscal-year", async (c) => {
  const user = await requireUser(c);
  const companyId = c.req.query("company_id") || "";
  if (!companyId) throw new HttpError(400, "請提供 company_id");
  await assertCompanyAccess(c.env.DB, companyId, user.id);

  const { results } = await c.env.DB.prepare(
    `SELECT fiscal_year, COUNT(id) as count, SUM(amount_hkd) as total_hkd
     FROM expenses
     WHERE company_id = ? AND status != 'rejected' AND fiscal_year IS NOT NULL
     GROUP BY fiscal_year
     ORDER BY fiscal_year DESC`
  )
    .bind(companyId)
    .all();

  return c.json(
    (results || []).map((r: any) => ({
      fiscal_year: r.fiscal_year,
      count: Number(r.count || 0),
      total_hkd: Number(r.total_hkd || 0),
    }))
  );
});

// ── Export CSV / Excel ─────────────────────────────────────────────────────
expensesRouter.get("/export", async (c) => {
  const user = await requireUser(c);
  const companyId = c.req.query("company_id") || "";
  if (!companyId) throw new HttpError(400, "請提供 company_id");
  await assertCompanyAccess(c.env.DB, companyId, user.id);

  const fiscalYear = c.req.query("fiscal_year");
  const status = c.req.query("status");
  const categoryCode = c.req.query("category_code");

  let sql = `
    SELECT e.*, c.name_zh as category_name
    FROM expenses e
    LEFT JOIN expense_categories c ON c.id = e.category_id
    WHERE e.company_id = ?
  `;
  const params: unknown[] = [companyId];
  if (fiscalYear) {
    sql += " AND e.fiscal_year = ?";
    params.push(fiscalYear);
  }
  if (status) {
    sql += " AND e.status = ?";
    params.push(status);
  }
  if (categoryCode) {
    sql += " AND c.code = ?";
    params.push(categoryCode);
  }
  sql += " ORDER BY e.receipt_date DESC";

  const { results } = await c.env.DB.prepare(sql).bind(...params).all();
  const rows = results || [];

  const headers = [
    "憑證號",
    "收據日期",
    "財政年度",
    "商戶名稱",
    "貨幣",
    "原始金額",
    "港元金額(HKD)",
    "支出分類",
    "狀態",
    "摘要",
    "備註",
  ];

  let csvContent = "\uFEFF" + headers.join(",") + "\n";
  for (const r of rows as any[]) {
    const line = [
      `"${r.voucher_number || ""}"`,
      `"${r.receipt_date || ""}"`,
      `"${r.fiscal_year || ""}"`,
      `"${(r.vendor_name || "").replace(/"/g, '""')}"`,
      `"${r.currency || ""}"`,
      Number(r.total_amount || 0).toFixed(2),
      Number(r.amount_hkd || 0).toFixed(2),
      `"${r.category_name || "未分類"}"`,
      `"${r.status || ""}"`,
      `"${(r.description || "").replace(/"/g, '""')}"`,
      `"${(r.notes || "").replace(/"/g, '""')}"`,
    ];
    csvContent += line.join(",") + "\n";
  }

  return new Response(csvContent, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="expenses_${fiscalYear || "all"}.csv"`,
    },
  });
});
