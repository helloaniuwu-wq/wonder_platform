/**
 * export-d1.mjs — 将 backend/hk_admin.db 中需要保留的表数据无损导出为 Cloudflare D1 兼容 SQL
 *
 * 用法：node apps/api-worker/scripts/export-d1.mjs
 * 生成：apps/api-worker/migrations/0002_seed_data.sql
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, "../../../backend/hk_admin.db");
const OUT_SQL = resolve(__dirname, "../migrations/0002_seed_data.sql");

// 只导出精简后保留的核心业务表（剔除 HR employees/payroll、leases、broker_trades 等废弃表，以及巨型临时缓存 price_cache）
const TABLES_TO_EXPORT = [
  "users",
  "companies",
  "user_company_access",
  "company_tax_profiles",
  "clients",
  "invoices",
  "invoice_items",
  "payments",
  "expense_categories",
  "expenses",
  "commission_statements",
  "ir56m_statements",
  "compliance_items",
  "portfolios",
  "transactions",
  "manual_dividends",
  "portfolio_stats_cache",
  "assets",
  "advisor_clients",
  "insurance_plans",
  "lab_scenarios",
  "user_ilp_config",
];

if (!existsSync(DB_PATH)) {
  console.error(`❌ 找不到 SQLite 数据库: ${DB_PATH}`);
  process.exit(1);
}

let sqlLines = [
  "-- =============================================================",
  "-- Wonder Platform — Cloudflare D1 Seed Data (Auto-exported from hk_admin.db)",
  `-- Exported at: ${new Date().toISOString()}`,
  "-- =============================================================",
  "PRAGMA foreign_keys = OFF;",
  "",
];

const CUSTOM_QUERIES = {
  user_company_access:
    "SELECT * FROM user_company_access WHERE user_id IN (SELECT id FROM users) AND company_id IN (SELECT id FROM companies);",
};

for (const table of TABLES_TO_EXPORT) {
  try {
    const selectQuery = CUSTOM_QUERIES[table] || `SELECT * FROM ${table};`;
    const dump = execFileSync(
      "sqlite3",
      [DB_PATH, `.mode insert ${table}`, selectQuery],
      { encoding: "utf-8", maxBuffer: 50 * 1024 * 1024 }
    ).trim();

    if (dump) {
      const statements = dump
        .split(";\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => s.replace(/^INSERT INTO /i, "INSERT OR REPLACE INTO ") + ";");

      sqlLines.push(`-- ── Table: ${table} (${statements.length} rows) ──`);
      sqlLines.push(...statements);
      sqlLines.push("");
      console.log(`✅ 导出表 [${table}]: ${statements.length} 行`);
    } else {
      console.log(`⚪ 表 [${table}] 为空，跳过`);
    }
  } catch (err) {
    console.warn(`⚠️ 跳过表 [${table}]: ${err.message}`);
  }
}

writeFileSync(OUT_SQL, sqlLines.join("\n"), "utf-8");
console.log(`\n🎉 D1 数据迁移文件已生成: ${OUT_SQL}`);
