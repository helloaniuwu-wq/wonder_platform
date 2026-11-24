import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER_DIR = path.resolve(__dirname, "..");
const MIGRATIONS_DIR = path.join(WORKER_DIR, "migrations");
const DB_NAME = "wonder-db";
// 0001-0004 为早期初始化与种子脚本，不纳入 CI 增量迁移；从 0005 起自动增量执行
const MIN_MIGRATION_PREFIX = "0005_";
const dryRun = process.argv.includes("--dry-run");

function runWrangler(args) {
  const localWrangler = path.join(WORKER_DIR, "node_modules", "wrangler", "bin", "wrangler.js");
  if (fs.existsSync(localWrangler)) {
    return execFileSync(process.execPath, [localWrangler, ...args], {
      cwd: WORKER_DIR,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
  const cmd = process.platform === "win32" ? "npx.cmd" : "npx";
  return execFileSync(cmd, ["wrangler", ...args], {
    cwd: WORKER_DIR,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function listIncrementalMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql") && f >= MIN_MIGRATION_PREFIX)
    .sort();
}

function main() {
  const files = listIncrementalMigrations();
  console.log(`[migrate] Found ${files.length} incremental migration(s):`, files);
  if (files.length === 0) return;

  if (dryRun) {
    console.log("[migrate] --dry-run mode, skipping remote D1 execution.");
    return;
  }

  runWrangler([
    "d1",
    "execute",
    DB_NAME,
    "--remote",
    "--command",
    "CREATE TABLE IF NOT EXISTS _ci_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);",
  ]);

  const rawOut = runWrangler([
    "d1",
    "execute",
    DB_NAME,
    "--remote",
    "--json",
    "--command",
    "SELECT name FROM _ci_migrations;",
  ]);

  const parsed = JSON.parse(rawOut);
  const appliedSet = new Set(
    (parsed?.[0]?.results || []).map((r) => String(r.name))
  );

  for (const file of files) {
    if (appliedSet.has(file)) {
      console.log(`[migrate] Skip already applied: ${file}`);
      continue;
    }
    console.log(`[migrate] Applying ${file}...`);
    runWrangler(["d1", "execute", DB_NAME, "--remote", "--file", `./migrations/${file}`]);
    const now = new Date().toISOString();
    runWrangler([
      "d1",
      "execute",
      DB_NAME,
      "--remote",
      "--command",
      `INSERT OR IGNORE INTO _ci_migrations (name, applied_at) VALUES ('${file}', '${now}');`,
    ]);
    console.log(`[migrate] Applied ${file}`);
  }
}

main();
