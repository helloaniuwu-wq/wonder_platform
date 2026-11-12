/**
 * 把「客户通讯 / restricted」文章正文同步到 api-worker 的内联数据表。
 *
 * 背景：官网改为静态导出后，受限文章正文不能再由 Next SSR 输出，
 * 改由 Worker 在鉴权通过后按需返回。正文只存在于 Worker bundle 内，
 * 不会进入静态站点的 HTML / RSC payload。
 *
 * 用法：node scripts/sync-restricted-articles.mjs
 * 博客内容有更新时重跑本脚本，再部署一次 Worker。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const BLOG_DIR = path.join(ROOT, "src/content/blog");
const OUT_FILE = path.resolve(ROOT, "../api-worker/src/data/restrictedArticles.ts");
const RESTRICTED_CATEGORY = "客户通讯";

// 必须与 src/lib/blog.ts 的 extractSlug 保持一致
function extractSlug(filename, frontmatterSlug) {
  if (frontmatterSlug && /^[a-z0-9-_]+$/i.test(frontmatterSlug)) return frontmatterSlug;
  const nameWithoutExt = filename.replace(/\.(mdx?)$/g, "");
  if (/^[\x00-\x7F]+$/.test(nameWithoutExt)) return nameWithoutExt;
  if (frontmatterSlug) return frontmatterSlug;
  return nameWithoutExt;
}

const articles = {};
const files = fs
  .readdirSync(BLOG_DIR)
  .filter((f) => f.endsWith(".md") || f.endsWith(".mdx"))
  .sort();

for (const filename of files) {
  const raw = fs.readFileSync(path.join(BLOG_DIR, filename), "utf-8");
  const { data, content } = matter(raw);
  const restricted = data.restricted === true || data.category === RESTRICTED_CATEGORY;
  if (!restricted) continue;
  articles[extractSlug(filename, data.slug)] = content;
}

const slugs = Object.keys(articles);
if (slugs.length === 0) {
  console.error("未找到任何受限文章，拒绝生成空表（避免误覆盖）");
  process.exit(1);
}

const banner = [
  "// 由 apps/wonder-hub/scripts/sync-restricted-articles.mjs 自动生成，请勿手改。",
  "// 内容属于客户通讯，仅在 Worker 鉴权通过后返回，切勿复制到静态站点。",
  `// 生成时间：${new Date().toISOString()}　共 ${slugs.length} 篇`,
  "",
].join("\n");

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(
  OUT_FILE,
  `${banner}export const RESTRICTED_ARTICLES: Record<string, string> = ${JSON.stringify(
    articles,
    null,
    2
  )};\n\nexport const RESTRICTED_SLUGS: string[] = ${JSON.stringify(slugs, null, 2)};\n`,
  "utf-8"
);

console.log(`已同步 ${slugs.length} 篇受限文章 → ${OUT_FILE}`);
console.log(`总体积 ${(fs.statSync(OUT_FILE).size / 1024).toFixed(1)} KB`);
