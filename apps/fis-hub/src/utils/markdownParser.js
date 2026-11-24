/**
 * 轻量级、零依赖 Markdown 块级与行内解析器（用于 AI 投顾研报安全渲染）。
 * 输出纯结构化 AST，不生成 HTML 字符串，天然防 XSS。
 */

const TABLE_SEP_RE = /^\s*\|?(\s*:?-{2,}:?\s*\|)+\s*:?-{2,}:?\s*\|?\s*$/;

function splitTableRow(line) {
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
  return trimmed.split('|').map((cell) => cell.trim());
}

/**
 * 预处理：把被模型或换行压扁到同一行的表格（如 `标题 |A|B| |---|---| |1|2|`）拆回标准多行表格。
 */
function normalizeMarkdown(markdown) {
  const rawLines = markdown.replace(/\r\n/g, '\n').split('\n');
  const out = [];

  for (const line of rawLines) {
    // 检测同一行内出现 `| |` 且包含 `|---` 的压扁表格
    if (/\|\s+\|/.test(line) && /\|[\s:-]*-{2,}[\s:-]*\|/.test(line)) {
      const firstPipe = line.indexOf('|');
      const prefix = line.slice(0, firstPipe).trim();
      const tablePart = line.slice(firstPipe).trim();
      if (prefix) out.push(prefix);
      const rows = tablePart.split(/\|\s+\|/).map((seg, idx, arr) => {
        let s = seg.trim();
        if (idx > 0 && !s.startsWith('|')) s = `|${s}`;
        if (idx < arr.length - 1 && !s.endsWith('|')) s = `${s}|`;
        return s;
      });
      out.push(...rows);
    } else {
      out.push(line);
    }
  }

  return out;
}

/**
 * 解析行内格式：**bold**、*italic*、`code`、[label](https://...)
 */
export function parseInlineTokens(text) {
  if (!text) return [];
  const tokens = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`\n]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g;
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    const raw = match[0];
    if (raw.startsWith('**') && raw.endsWith('**')) {
      tokens.push({ type: 'bold', value: raw.slice(2, -2) });
    } else if (raw.startsWith('*') && raw.endsWith('*')) {
      tokens.push({ type: 'italic', value: raw.slice(1, -1) });
    } else if (raw.startsWith('`') && raw.endsWith('`')) {
      tokens.push({ type: 'code', value: raw.slice(1, -1) });
    } else if (raw.startsWith('[')) {
      const m = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(raw);
      if (m) {
        tokens.push({ type: 'link', label: m[1], href: m[2] });
      } else {
        tokens.push({ type: 'text', value: raw });
      }
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    tokens.push({ type: 'text', value: text.slice(lastIndex) });
  }
  return tokens;
}

/**
 * 将 Markdown 文本解析为块级节点数组。
 */
export function parseMarkdownBlocks(markdown) {
  if (!markdown || typeof markdown !== 'string') return [];
  const lines = normalizeMarkdown(markdown);
  const blocks = [];
  let i = 0;

  const isTableStart = (idx) =>
    idx + 1 < lines.length &&
    lines[idx].includes('|') &&
    TABLE_SEP_RE.test(lines[idx + 1]);

  const isUl = (s) => /^\s*[-*•]\s+/.test(s);
  const isOl = (s) => /^\s*\d+\.\s+/.test(s);

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // 1. 分割线
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    // 2. 标题 (# ~ ####)
    const headingMatch = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length,
        text: headingMatch[2].trim(),
      });
      i++;
      continue;
    }

    // 3. 表格（当前行含 | 且下一行是分隔符 |---|）
    if (isTableStart(i)) {
      const headers = splitTableRow(line);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      blocks.push({ type: 'table', headers, rows });
      continue;
    }

    // 4. 引用块 (>)
    if (trimmed.startsWith('>')) {
      const quoteLines = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'blockquote', text: quoteLines.join('\n') });
      continue;
    }

    // 5. 有序/无序列表（有序列表中的 `-` 子项挂载为 children，避免被编号成 4、5、6）
    if (isUl(line) || isOl(line)) {
      const ordered = isOl(line);
      const items = [];
      while (i < lines.length) {
        const cur = lines[i];
        if (!cur.trim()) {
          if (i + 1 < lines.length && (ordered ? isOl(lines[i + 1]) : isUl(lines[i + 1]))) {
            i++;
            continue;
          }
          break;
        }
        // 遇到表格起始时立即结束列表，让外层表格解析器接管
        if (isTableStart(i) || cur.trim().startsWith('|')) {
          break;
        }
        if (ordered && isOl(cur)) {
          items.push({ text: cur.replace(/^\s*\d+\.\s+/, ''), children: [] });
          i++;
        } else if (ordered && isUl(cur) && items.length > 0) {
          items[items.length - 1].children.push(cur.replace(/^\s*[-*•]\s+/, ''));
          i++;
        } else if (!ordered && isUl(cur)) {
          const indent = cur.search(/\S/);
          const text = cur.replace(/^\s*[-*•]\s+/, '');
          if (indent >= 2 && items.length > 0) {
            items[items.length - 1].children.push(text);
          } else {
            items.push({ text, children: [] });
          }
          i++;
        } else if (/^\s{2,}\S/.test(cur) && items.length > 0) {
          items[items.length - 1].text += ` ${cur.trim()}`;
          i++;
        } else {
          break;
        }
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    // 6. 普通段落
    const paraLines = [];
    while (i < lines.length) {
      const cur = lines[i];
      const curTrim = cur.trim();
      if (
        !curTrim ||
        /^(#{1,4})\s+/.test(curTrim) ||
        /^(-{3,}|\*{3,}|_{3,})$/.test(curTrim) ||
        curTrim.startsWith('>') ||
        isUl(cur) ||
        isOl(cur) ||
        isTableStart(i)
      ) {
        break;
      }
      paraLines.push(curTrim);
      i++;
    }
    blocks.push({ type: 'paragraph', text: paraLines.join(' ') });
  }

  return blocks;
}
