import type { Env } from "../types";

/**
 * 视觉模型链（按顺序尝试，只有前一个失败才用下一个）：
 *   1. dots-studio/dots-3-note-preview:free  $0/次 —— 对 4032×3024 实拍大图、旋转图、PDF 都能正确读数
 *   2. nvidia/nemotron-3.5-super-vl:free     $0/次 —— 转正/压缩图、PDF 表现好；超大原图会被上游以 415 拒绝
 *   3. inclusionai/ling-3.0-flash-vl         ~$0.00015/次 —— 最后防线，只在两个免费模型都失效时才产生费用
 *
 * 不要再把 google/gemma-3-4b-it 放到链里：它是 4B 小模型，读不清实拍凭证时会
 * 照抄提示词里的示例数字编造出一套自洽但完全错误的金额/日期（2026-11-12 故障即此）。
 */
const DEFAULT_MODELS = [
  "dots-studio/dots-3-note-preview:free",
  "nvidia/nemotron-3.5-super-vl:free",
  "inclusionai/ling-3.0-flash-vl",
];

export interface VisionResult {
  data: Record<string, any>;
  rawText: string;
  modelUsed: string;
}

export interface VisionOptions {
  maxTokens?: number;
  filename?: string;
}

/**
 * 从模型回复里取出第一个完整 JSON 对象。
 * 兼容 ```json 代码块包裹、前后多余文字、以及返回多个对象的情况。
 * 不用 /\{[\s\S]*\}/ 贪婪匹配，否则跨对象时会拼出无效 JSON。
 */
function firstJsonObject(text: string): Record<string, any> | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          const obj = JSON.parse(text.slice(start, i + 1));
          return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

// 只对这些「金额类」字段做数值化；含 id/code/number/name/date 的键一律跳过，
// 避免把纳税人识别号、发票号码、日期等字符串误转成数字。
const NUMERIC_KEY = /(amount|total|rate|confidence|price|fee|commission|bonus|premium|subtotal|balance)/i;
// 用锚定的 id 形态，不能用裸 "id"：confidence 里也含 "id" 子串，会被误排除。
const NON_NUMERIC_KEY = /(^id$|_id\b|^_|code|number|no_|name|date|type|currency|desc)/i;

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const isPercent = value.includes("%");
  const cleaned = value.replace(/[^0-9.\-]/g, ""); // 去掉 $ , 千分位、货币符号、空格、%
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return isPercent ? n / 100 : n;
}

/**
 * 模型常把金额写成 "$1,463.0" / "1,463.00" / "10%" 这类字符串。
 * 不清洗的话 Number("$1,463.0") = NaN，落库会变成 0 或 NULL。
 */
function normalizeVisionData(data: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { ...data };
  for (const [key, value] of Object.entries(out)) {
    if (value == null) continue;
    if (NUMERIC_KEY.test(key) && !NON_NUMERIC_KEY.test(key) &&
        (typeof value === "number" || typeof value === "string")) {
      let n = toNumber(value);
      // 有些模型把 confidence 返回成 0.95，库里统一按 0-100 存
      if (key === "confidence" && n !== null && n > 0 && n <= 1) n = n * 100;
      out[key] = n;
    } else if (key === "currency" && typeof value === "string") {
      out[key] = value.trim().toUpperCase();
    } else if (key === "receipt_date" && typeof value === "string") {
      out[key] = /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? value.trim() : null;
    }
  }
  return out;
}

/** 调用 OpenRouter 视觉模型做凭证 / 月结单结构化提取，失败时逐级回退，全失败则抛错。 */
export async function callVisionApi(
  env: Env,
  prompt: string,
  dataUrl: string,
  options: VisionOptions = {}
): Promise<VisionResult> {
  if (!env.OPENROUTER_API_KEY) {
    throw new Error("未設定 OPENROUTER_API_KEY");
  }

  const baseUrl = env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
  const models = [
    env.OPENROUTER_VISION_MODEL || DEFAULT_MODELS[0],
    env.OPENROUTER_VISION_MODEL_FALLBACK || DEFAULT_MODELS[1],
    env.OPENROUTER_VISION_MODEL_LASTRESORT || DEFAULT_MODELS[2],
  ].filter((m, i, arr) => m && arr.indexOf(m) === i);
  const failures: string[] = [];
  const maxTokens = options.maxTokens ?? 1024;

  // PDF 必须走 OpenRouter 的 file 格式。用 image_url 传 application/pdf 会被
  // 主模型以 422（内容安全拦截）、兜底模型以 400（无法解码图片）直接拒绝。
  const isPdf = dataUrl.startsWith("data:application/pdf");
  const mediaPart = isPdf
    ? { type: "file", file: { filename: options.filename || "receipt.pdf", file_data: dataUrl } }
    : { type: "image_url", image_url: { url: dataUrl } };

  for (const model of models) {
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                mediaPart,
              ],
            },
          ],
          max_tokens: maxTokens,
          temperature: 0.1,
          // 免费 VL 模型默认是推理型；不关掉 reasoning 会把全部 token 花在思考上，
          // 最终 content 为空，看起来就像「识别失败」。
          reasoning: { enabled: false },
        }),
        signal: AbortSignal.timeout(45000),
      });

      if (!res.ok) {
        const body = await res.text();
        failures.push(`${model}: HTTP ${res.status} ${body.slice(0, 180)}`);
        continue;
      }

      const json = await res.json<any>();
      // OpenRouter 会把上游错误包装成 HTTP 200 + {"error": ...}（例如 Nvidia 对
      // 超大图片返回 415 Unsupported Media Type）。不检查就会被当成「空结果」
      // 静默回落，进而写入一条由弱模型编造的记录。
      if (json?.error) {
        failures.push(`${model}: ${json.error.message || JSON.stringify(json.error).slice(0, 160)}`);
        continue;
      }

      const rawText = json.choices?.[0]?.message?.content || "";
      const parsed = firstJsonObject(rawText);
      if (!parsed) {
        failures.push(`${model}: 未返回可解析 JSON (${rawText.slice(0, 120) || "empty"})`);
        continue;
      }

      const data = normalizeVisionData(parsed);
      // 有 total_amount 字段的场景（支出凭证）必须拿到有效正数，否则视为该模型失败。
      if ("total_amount" in data &&
          (typeof data.total_amount !== "number" || !Number.isFinite(data.total_amount) || data.total_amount <= 0)) {
        failures.push(`${model}: total_amount 無效 (${String(parsed.total_amount)})`);
        continue;
      }
      return { data, rawText, modelUsed: model };
    } catch (err: any) {
      failures.push(`${model}: ${err?.message || String(err)}`);
    }
  }

  throw new Error(`AI 識別失敗（已嘗試 ${models.join(" → ")}）：${failures.join(" | ")}`);
}
