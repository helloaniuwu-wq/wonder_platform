/**
 * insuranceParser.ts — 保险计划书 Excel 解析器（TypeScript / Cloudflare Worker 版）
 *
 * 迁移自 backend/services/fip/insurance_parser.py，行为保持一致：
 * - 自动识别 2–4 行合并表头（识别不到时放宽到 6 行）
 * - 中英文关键词匹配列名
 * - 输出标准化年度现金价值数组
 *
 * 原实现依赖 openpyxl（C 扩展，Worker 不可用），这里改用项目已有的 SheetJS。
 */

import * as XLSX from "xlsx";

type FieldKey =
  | "year"
  | "guaranteed_cv"
  | "rev_bonus"
  | "terminal_bonus"
  | "withdrawal"
  | "premium"
  | "total_cv";

const KEYWORD_MAP: Record<FieldKey, string[]> = {
  year: ["保单年度终结", "保单年度", "年度", "policy year", "year", "期末", "年底"],
  guaranteed_cv: [
    "保证现金价值(a)",
    "保证现金价值 (a)",
    "保证现金价值",
    "保证金额(2)",
    "保证金额",
    "保证",
    "guaranteed cash value",
    "guaranteed cv",
    "保证值",
    "(a)",
    "gcv",
    "基本现金价值",
  ],
  rev_bonus: [
    "复归红利 (b)",
    "复归红利",
    "可归红利",
    "reversionary bonus",
    "rev bonus",
    "rev. bonus",
    "(b)",
    "复归",
    "已宣告红利",
  ],
  terminal_bonus: [
    "终期分红 (c)",
    "终期分红",
    "终期红利",
    "terminal bonus",
    "(c)",
    "终期",
    "terminal dividend",
    "特别红利",
  ],
  withdrawal: [
    "提取金额",
    "现金提取金额(1),(2)",
    "现金提取金额",
    "现金提取",
    "withdrawal",
    "cash withdrawal",
    "每年提取",
    "年提取",
    "退保",
    "部分退保",
  ],
  premium: [
    "保费",
    "目标保费",
    "已缴保费",
    "保费金额",
    "总缴保费",
    "年缴保费",
    "缴付保费",
    "premium",
    "annual premium",
    "paid premium",
  ],
  total_cv: [
    "总额 (a)+(b)+(c)",
    "总额",
    "(a)+(b)+(c)",
    "总现金价值",
    "total",
    "total cv",
    "合计",
    "累计现金价值",
    "总现值",
  ],
};

const normalize = (s: string) => s.toLowerCase().replace(/ /g, "").replace(/\n/g, "");

function matchColumn(text: string): FieldKey | null {
  if (!text) return null;
  const cleaned = normalize(text);
  for (const field of Object.keys(KEYWORD_MAP) as FieldKey[]) {
    for (const kw of KEYWORD_MAP[field]) {
      if (cleaned.includes(normalize(kw))) {
        // 排除把「已缴保费总额」误认成「总现金价值」
        if (field === "total_cv" && (cleaned.includes("保费") || cleaned.includes("premium"))) continue;
        return field;
      }
    }
  }
  return null;
}

/** 返回 { 列索引(0-based): 字段名 } */
function readHeaders(rows: any[][], maxHeaderRows: number): Record<number, FieldKey> {
  const colTexts: Record<number, string> = {};
  for (let r = 0; r < Math.min(maxHeaderRows, rows.length); r++) {
    const row = rows[r] || [];
    for (let c = 0; c < row.length; c++) {
      const val = row[c];
      if (val !== null && val !== undefined && val !== "") {
        colTexts[c] = (colTexts[c] || "") + String(val);
      }
    }
  }

  const colMap: Record<number, FieldKey> = {};
  const used = new Set<FieldKey>();
  for (const [colStr, text] of Object.entries(colTexts)) {
    const field = matchColumn(text);
    if (field && !used.has(field)) {
      colMap[Number(colStr)] = field;
      used.add(field);
    }
  }
  return colMap;
}

function findDataStartRow(rows: any[][], yearCol: number, maxScan = 12): number {
  for (let r = 1; r < Math.min(maxScan + 1, rows.length); r++) {
    const v = (rows[r] || [])[yearCol];
    if (v === null || v === undefined) continue;
    const num = parseFloat(String(v).replace(/,/g, ""));
    if (!Number.isNaN(num) && Math.trunc(num) === 1) return r;
  }
  return 4; // 0-based：对应 Python 的第 5 行
}

function toFloat(v: any): number {
  if (v === null || v === undefined || v === "") return 0;
  const num = parseFloat(String(v).replace(/,/g, ""));
  return Number.isNaN(num) ? 0 : num;
}

export interface InsuranceYearRow {
  year: number;
  premium: number;
  guaranteed_cv: number;
  rev_bonus: number;
  terminal_bonus: number;
  non_guaranteed: number;
  withdrawal: number;
  total_cv_base: number;
}

export interface InsuranceParseResult {
  ok: boolean;
  error?: string;
  policy_name?: string;
  sheet_name?: string;
  sheet_names?: string[];
  total_years?: number;
  years?: InsuranceYearRow[];
}

export function parseInsurancePlan(fileBytes: ArrayBuffer, filename: string): InsuranceParseResult {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(new Uint8Array(fileBytes), { type: "array", cellDates: false });
  } catch (e: any) {
    return { ok: false, error: `无法打开 Excel 文件：${e?.message || e}` };
  }

  const sheetNames = wb.SheetNames || [];
  if (sheetNames.length === 0) return { ok: false, error: "Excel 文件中没有工作表。" };

  const policyName = filename ? filename.replace(/\.[^.]+$/, "") : "保险计划书";

  // SheetJS 不暴露 Excel 的 activeTab（openpyxl 的 wb.active），
  // 因此逐页尝试，取「年度覆盖最完整」的那一页；长度相同则取靠前的一页。
  // 这样既不会因为第一页只是某个短方案而少读几十年，也保持结果可复现。
  let best: { sheet: string; years: InsuranceYearRow[] } | null = null;
  let firstError: string | null = null;

  for (const name of sheetNames) {
    const parsed = parseSheet(wb.Sheets[name]);
    if (!parsed.ok) {
      if (!firstError) firstError = parsed.error || null;
      continue;
    }
    if (!best || (parsed.years?.length || 0) > best.years.length) {
      best = { sheet: name, years: parsed.years || [] };
    }
  }

  if (!best) {
    return {
      ok: false,
      error: firstError || "未能识别「保单年度」列。请确认上传的是保险计划书 Excel，且包含标准列名。",
      sheet_names: sheetNames,
    };
  }

  return {
    ok: true,
    policy_name: policyName,
    sheet_name: best.sheet,
    sheet_names: sheetNames,
    total_years: best.years.length,
    years: best.years,
  };
}

function parseSheet(
  ws: XLSX.WorkSheet | undefined
): { ok: boolean; error?: string; years?: InsuranceYearRow[] } {
    if (!ws) return { ok: false, error: "工作表为空。" };

    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });

    let colMap = readHeaders(rows, 4);
    if (!Object.values(colMap).includes("year")) {
      colMap = readHeaders(rows, 6);
    }
    if (!Object.values(colMap).includes("year")) {
      return {
        ok: false,
        error:
          "未能识别「保单年度」列。请确认上传的是保险计划书 Excel，且包含「保单年度」、「保证现金价值」等标准列名。",
      };
    }

    const fieldToCol: Partial<Record<FieldKey, number>> = {};
    for (const [colStr, field] of Object.entries(colMap)) {
      fieldToCol[field] = Number(colStr);
    }

    const yearCol = fieldToCol.year!;
    const gcvCol = fieldToCol.guaranteed_cv;
    const revCol = fieldToCol.rev_bonus;
    const termCol = fieldToCol.terminal_bonus;
    const totalCol = fieldToCol.total_cv;
    const wdrawCol = fieldToCol.withdrawal;
    const premCol = fieldToCol.premium;

    const dataStart = findDataStartRow(rows, yearCol, 12);
    const yearsData: InsuranceYearRow[] = [];
    let prevYear = 0;

    for (let r = dataStart; r < rows.length; r++) {
      const row = rows[r] || [];
      const yearVal = row[yearCol];
      if (yearVal === null || yearVal === undefined || yearVal === "") break;

      const yearNum = parseFloat(String(yearVal).replace(/,/g, ""));
      if (Number.isNaN(yearNum)) continue;
      const year = Math.trunc(yearNum);
      if (year <= prevYear) continue;
      prevYear = year;

      const cell = (col?: number) => (col === undefined ? 0 : Math.abs(toFloat(row[col])));

      const gcv = cell(gcvCol);
      const rev = cell(revCol);
      const terminal = cell(termCol);
      let total = cell(totalCol);
      const withdrawal = cell(wdrawCol);
      const premium = cell(premCol);

      const nonGuaranteed = rev + terminal;
      if (total === 0 && (gcv > 0 || nonGuaranteed > 0)) total = gcv + nonGuaranteed;

      yearsData.push({
        year,
        premium: Math.round(premium * 100) / 100,
        guaranteed_cv: Math.round(gcv * 100) / 100,
        rev_bonus: Math.round(rev * 100) / 100,
        terminal_bonus: Math.round(terminal * 100) / 100,
        non_guaranteed: Math.round(nonGuaranteed * 100) / 100,
        withdrawal: Math.round(withdrawal * 100) / 100,
        total_cv_base: Math.round(total * 100) / 100,
      });
    }

    if (yearsData.length === 0) {
      return { ok: false, error: "未能从文件中读取任何有效数据行。请检查文件格式或数据列是否正确。" };
    }

    // 累计保费 → 逐年保费
    if (yearsData.length > 1 && yearsData[1].premium > yearsData[0].premium) {
      let lastP = 0;
      for (const row of yearsData) {
        const trueP = row.premium - lastP;
        row.premium = Math.max(0, Math.round(trueP * 100) / 100);
        lastP += row.premium;
      }
    }

    const hasMeaningful = yearsData.some((r) => r.guaranteed_cv > 0 || r.total_cv_base > 0);
    if (!hasMeaningful) {
      return { ok: false, error: "已读取数据，但所有现金价值均为 0。请确认选择的 Sheet 包含现金价值数据。" };
    }

    return { ok: true, years: yearsData };
}
