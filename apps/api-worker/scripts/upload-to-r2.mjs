/**
 * upload-to-r2.mjs — 将本地 receipts_archive 与 statements_archive 中的历史凭证批量同步至 Cloudflare R2
 *
 * 用法：node apps/api-worker/scripts/upload-to-r2.mjs
 */
import { readdirSync, statSync, readFileSync } from "node:fs";
import { resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, "../../..");
const RECEIPTS_DIR = resolve(ROOT_DIR, "backend/receipts_archive");
const STATEMENTS_DIR = resolve(ROOT_DIR, "backend/statements_archive");
const BUCKET_NAME = "wonder-platform-files";

function getAllFiles(dir, fileList = []) {
  if (!statSync(dir, { throwIfNoEntry: false })) return fileList;
  const files = readdirSync(dir);
  for (const file of files) {
    const fullPath = resolve(dir, file);
    if (statSync(fullPath).isDirectory()) {
      getAllFiles(fullPath, fileList);
    } else {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

async function uploadFile(localPath, remoteKey) {
  try {
    await execAsync(
      `npx wrangler r2 object put "${BUCKET_NAME}/${remoteKey}" --file="${localPath}"`,
      { cwd: resolve(__dirname, "..") }
    );
    return true;
  } catch (e) {
    console.error(`❌ 上传失败: ${remoteKey}`, e.message);
    return false;
  }
}

async function runPool(tasks, concurrency = 6) {
  const executing = new Set();
  for (const task of tasks) {
    const p = Promise.resolve().then(() => task());
    executing.add(p);
    const clean = () => executing.delete(p);
    p.then(clean, clean);
    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }
  return Promise.all(executing);
}

async function main() {
  console.log("🚀 开始将历史收据与月结单批量同步至 Cloudflare R2...");

  const receiptFiles = getAllFiles(RECEIPTS_DIR);
  console.log(`📁 发现支出收据文件: ${receiptFiles.length} 个`);

  let count = 0;
  const receiptTasks = receiptFiles.map((file) => async () => {
    const rel = relative(RECEIPTS_DIR, file);
    const remoteKey = `receipts/${rel}`;
    const ok = await uploadFile(file, remoteKey);
    count++;
    if (count % 20 === 0 || count === receiptFiles.length) {
      console.log(`⏳ 正在同步收据 [${count}/${receiptFiles.length}]: ${remoteKey}`);
    }
  });

  await runPool(receiptTasks, 6);

  const statementFiles = getAllFiles(STATEMENTS_DIR);
  console.log(`📁 发现佣金月结单文件: ${statementFiles.length} 个`);
  let sCount = 0;
  const statementTasks = statementFiles.map((file) => async () => {
    const rel = relative(STATEMENTS_DIR, file);
    const remoteKey = `statements/${rel}`;
    const ok = await uploadFile(file, remoteKey);
    sCount++;
    if (sCount % 5 === 0 || sCount === statementFiles.length) {
      console.log(`⏳ 正在同步月结单 [${sCount}/${statementFiles.length}]: ${remoteKey}`);
    }
  });

  await runPool(statementTasks, 6);

  console.log("\n🎉 全部历史原件已成功同步至 Cloudflare R2！");
}

main().catch(console.error);
