#!/usr/bin/env node
/**
 * 一次性工具：把「公众号版」HTML 客户通讯转成专栏用的 Markdown（保留正文 + 数据表）。
 * 用法：node scripts/_convert_newsletter.mjs <input.html> <slug> <date> <title> <summary> <tagsCSV>
 * 输出：src/content/blog/<slug>.md（含 frontmatter）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import TurndownService from "turndown";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const BLOG_DIR = path.join(ROOT, "src/content/blog");

function cellText(cell) {
  // 用 textContent 拉平，换行/多余空白压成单空格
  let t = cell.textContent || "";
  return t.replace(/\s+/g, " ").trim();
}
function escapePipe(t) {
  return t.replace(/\|/g, "\\|");
}

const turndown = new TurndownService({
  headingStyle: "atx",
  hr: "---",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
});

// 自定义表格规则：直接从 DOM 节点重建 GFM 表格，忽略 turndown 默认展平
turndown.addRule("gfmTable", {
  filter: "table",
  replacement: function (_content, node) {
    const rows = Array.from(node.querySelectorAll("tr"));
    if (rows.length === 0) return "";
    const buildRow = (cells) =>
      "| " + cells.map((c) => escapePipe(cellText(c))).join(" | ") + " |";
    const firstCells = Array.from(rows[0].querySelectorAll("th, td"));
    const header = buildRow(firstCells);
    const sep = "| " + firstCells.map(() => "---").join(" | ") + " |";
    const bodyRows = rows.slice(1).map((tr) =>
      buildRow(Array.from(tr.querySelectorAll("th, td")))
    );
    return "\n" + [header, sep, ...bodyRows].join("\n") + "\n";
  },
});

// 去掉 h1（专栏 H1 由 frontmatter 标题生成）
turndown.remove(["h1"]);

function extractBody(html) {
  const m = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return m ? m[1] : html;
}

function convertBody(html) {
  // 只取 body，避免 <head> 里的 <title> 泄漏成正文
  const body = extractBody(html);
  let md = turndown.turndown(body);

  // 去掉泄露出来的 H1（《Wonder客户月度通讯…》），专栏标题由 frontmatter 生成
  md = md.replace(/^#\s+.*$/m, "").replace(/^#\s+.*\n/, "");

  // 装饰性分隔符（— ◆ — / — — —）转为真实分隔线
  md = md.replace(/^[—\s◆·]+$/gm, "---");

  // 清理：多余空行
  md = md.replace(/\n{3,}/g, "\n\n").trim();
  return md;
}

function main() {
  const [, , input, slug, date, title, summary, tagsCSV] = process.argv;
  if (!input || !slug || !date || !title) {
    console.error("用法：node _convert_newsletter.mjs <input.html> <slug> <date> <title> <summary> <tagsCSV>");
    process.exit(1);
  }
  const raw = fs.readFileSync(input, "utf-8");
  const body = convertBody(raw);

  const tags = (tagsCSV || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (tags.length === 0) tags.push("客户通讯");

  const frontmatter = [
    "---",
    `title: "${title.replace(/"/g, '\\"')}"`,
    `slug: "${slug}"`,
    `date: "${date}"`,
    `category: "客户通讯"`,
    `summary: "${String(summary || "").replace(/"/g, '\\"')}"`,
    `tags: [${tags.map((t) => `"${t}"`).join(", ")}]`,
    `author: "WONDER 研究团队"`,
    `restricted: true`,
    "---",
    "",
  ].join("\n");

  const out = frontmatter + "\n" + body + "\n";
  fs.mkdirSync(BLOG_DIR, { recursive: true });
  const outPath = path.join(BLOG_DIR, `${slug}.md`);
  fs.writeFileSync(outPath, out, "utf-8");
  console.log(`✅ 已生成：${outPath}（${body.length} 字符正文）`);
}

main();
