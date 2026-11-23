/**
 * 官网（wonder-hub）公开接口。
 *
 * 官网改为静态导出到 Cloudflare Pages 后，原先 Next.js 的 route handlers
 * 及 SSR 访问控制全部平移到此处，后端仍以 api-worker 为唯一入口。
 *
 * 路由同时挂在 /api 与 / 下（见 index.ts），因此以下两种路径均可用：
 *   /api/geo          /geo
 *   /api/articles/:s  /articles/:s
 */
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { Env, Variables } from "../types";
import { getOptionalUser } from "../utils/auth";
import { RESTRICTED_ARTICLES } from "../data/restrictedArticles";

type Ctx = { Bindings: Env; Variables: Variables };
export const publicRouter = new Hono<Ctx>();

const MIDDLE_EAST = ["AE", "SA", "QA", "KW", "BH", "OM", "JO", "EG", "LB", "IQ", "YE", "SY", "LY", "TN", "MA", "DZ"];
const CHINESE = ["CN", "HK", "MO", "TW"];
const PRIVILEGED_ROLES = ["admin", "premium", "advisor"];
const WECHAT_SECRET_FALLBACK = "wonder-wechat-2024";

const PRODUCT_NAMES: Record<string, string> = {
  ec: "雇員補償保險 (EC Insurance)",
  mpf: "強制性公積金 (MPF)",
  medical: "團體醫療保險 (Group Medical)",
};

// ── 地区判定（原 /api/geo）───────────────────────────────────────────────
publicRouter.get("/geo", (c) => {
  const country =
    c.req.header("cf-ipcountry") ||
    c.req.header("x-vercel-ip-country") ||
    c.req.header("x-country") ||
    "";
  let lang: "zh" | "en" | "ar" = "en";
  if (CHINESE.includes(country.toUpperCase())) lang = "zh";
  else if (MIDDLE_EAST.includes(country.toUpperCase())) lang = "ar";
  return c.json({ lang, country });
});

// ── 客户通讯全文（静态化后替代 SSR 访问控制）──────────────────────────
function verifyWechatToken(token: string, slug: string, env: Env): boolean {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf-8");
    const parts = decoded.split("::");
    return parts[0] === slug && parts[1] === (env.WECHAT_TOKEN_SECRET || WECHAT_SECRET_FALLBACK);
  } catch {
    return false;
  }
}

publicRouter.get("/articles/:slug", async (c) => {
  const slug = c.req.param("slug");
  const content = RESTRICTED_ARTICLES[slug];
  if (!content) return c.json({ error: "文章不存在" }, 404);

  // 1. 微信公众号专属链接 ?wc=TOKEN（永久有效，不看角色）
  const wc = c.req.query("wc");
  if (wc && verifyWechatToken(wc, slug, c.env)) return c.json({ content });

  // 2. 访问口令（由前端把用户输入透传过来，口令只在服务端校验）
  const passcode = c.req.query("passcode") || getCookie(c, "wonder_passcode") || "";
  if (passcode.trim().toLowerCase() === "wonder") {
    return c.json({ content });
  }

  // 3. 已登录且有权限的角色（jose 验签 + D1 查用户）
  const user = await getOptionalUser(c);
  if (user && PRIVILEGED_ROLES.includes(user.role)) return c.json({ content });

  return c.json({ error: "尚未取得閱讀權限" }, 401);
});

// ── 企业保险询价（原 /api/insurance-inquiry）────────────────────────────
function row(label: string, value: unknown) {
  if (!value) return "";
  const safe = String(value).replace(/[&<>"]/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch] || ch
  );
  return `<tr><td style="padding:6px 0;font-size:12px;color:#6B7280;width:130px;vertical-align:top;">${label}</td><td style="padding:6px 0;font-size:13px;color:#111827;font-weight:600;">${safe}</td></tr>`;
}

publicRouter.post("/insurance-inquiry", async (c) => {
  try {
    const body = await c.req.json<any>();
    const {
      companyName, contactName, phone, email, employees, avgSalary, industry,
      currentProvider, planLevel, includeDependents, effectDate, remarks, selectedTypes = [],
    } = body;

    const turnstileToken =
      body["cf-turnstile-response"] || body["cf_turnstile_response"] || body.turnstileToken;
    const secret = c.env.TURNSTILE_SECRET;

    if (secret) {
      if (!turnstileToken) {
        return c.json({ ok: false, error: "請完成真人安全驗證" }, 400);
      }
      const clientIp = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "";
      const verifyRes = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          secret,
          response: turnstileToken,
          ...(clientIp ? { remoteip: clientIp } : {}),
        }),
      });
      const verifyData = (await verifyRes.json()) as { success?: boolean; action?: string };
      if (!verifyData.success || (verifyData.action && verifyData.action !== "insurance_inquiry")) {
        return c.json({ ok: false, error: "人機安全驗證失敗，請重試" }, 400);
      }
    }

    const productsText = (selectedTypes as string[])
      .map((id) => PRODUCT_NAMES[id] || id)
      .join("、");

    const advisorEmail = c.env.ADVISOR_EMAIL || "";
    const resendKey = c.env.RESEND_API_KEY || "";

    // 原 Next 版在缺密钥时只打日志并返回 ok:true，前端会误报「已提交」。
    // 这里改为显式失败，避免客户以为询价已经送达。
    if (!resendKey || !advisorEmail) {
      console.warn("[insurance-inquiry] RESEND_API_KEY / ADVISOR_EMAIL 未配置，拒绝提交");
      return c.json(
        { ok: false, mode: "unconfigured", error: "郵件服務尚未開通，請直接電郵聯絡我們" },
        503
      );
    }

    const html = `<!DOCTYPE html><html lang="zh-HK"><head><meta charset="UTF-8"><title>企業保險詢價</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#f9fafb;">
<div style="background:#fff;border-radius:16px;overflow:hidden;">
<div style="background:#1a1a2e;padding:28px 32px;"><div style="font-size:11px;color:#F59E0B;font-weight:700;letter-spacing:2px;">WONDER HUB</div><h1 style="margin:6px 0 0;color:#fff;font-size:22px;">新企業保險詢價</h1><p style="margin:6px 0 0;color:rgba(255,255,255,.55);font-size:13px;">${new Date().toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong" })}</p></div>
<div style="padding:20px 32px 0;"><div style="font-size:12px;color:#374151;">${productsText}</div></div>
<div style="padding:24px 32px;"><div style="font-size:11px;color:#9CA3AF;margin-bottom:16px;">公司資料</div><table style="width:100%;border-collapse:collapse;">${row("公司名稱", companyName)}${row("聯絡人", contactName)}${row("電話", phone)}${row("電郵", email)}</table></div>
<div style="height:1px;background:#F3F4F6;margin:0 32px;"></div>
<div style="padding:24px 32px;"><div style="font-size:11px;color:#9CA3AF;margin-bottom:16px;">投保要素</div><table style="width:100%;border-collapse:collapse;">${row("員工人數", employees)}${row("平均月薪", avgSalary)}${row("行業 / 工種", industry)}${row("現有 MPF 受托人", currentProvider)}${row("醫療計劃級別", planLevel)}${includeDependents ? row("家屬保障", "需要") : ""}${row("期望生效日期", effectDate)}${row("備註", remarks)}</table></div>
<div style="padding:20px 32px;background:#F9FAFB;border-top:1px solid #F3F4F6;"><p style="margin:0;font-size:12px;color:#9CA3AF;text-align:center;">此郵件由 WONDER HUB 企業保險詢價系統自動發出</p></div>
</div></body></html>`;

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: "WONDER HUB 詢價系統 <inquiry@wonderhub.hk>",
        to: [advisorEmail],
        subject: `新企業保險詢價 — ${companyName}（${productsText}）`,
        html,
        reply_to: email,
      }),
    });

    if (!resendRes.ok) {
      console.error("Resend error:", await resendRes.text());
      return c.json({ ok: false, error: "郵件發送失敗" }, 500);
    }
    return c.json({ ok: true });
  } catch (err) {
    console.error("Insurance inquiry error:", err);
    return c.json({ ok: false, error: "伺服器錯誤" }, 500);
  }
});

// ── 小红书文案生成（原 /xhs-creator/api）────────────────────────────────
publicRouter.post("/xhs-generate", async (c) => {
  try {
    const { url } = await c.req.json<{ url?: string }>();
    if (!url) return c.json({ error: "请提供链接" }, 400);

    let textContent = "";
    try {
      const pageRes = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      });
      const html = await pageRes.text();
      textContent = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .slice(0, 10000);
    } catch {
      textContent = url.slice(0, 5000);
    }

    const prompt = `你是一个顶尖的小红书爆款图文排版专家。请根据以下提取的内容，将其改写/总结成适合用来生成小红书多图卡片（图文排版）的 Markdown 格式文案。
要求：
1. 提取最核心的价值点和情绪价值。
2. 使用 \`## 标题\` 来强制分页（每出现一个 \`## \` 就代表新的一张图片）。
3. 第一张卡片（首页）需要一个极其吸引人的大标题（作为封面）。
4. 中间的内容要用简短有力的句子、无序列表等方式清晰表达。
5. 适度使用金句、引用（> ）。
6. 最后一张卡片留下行动号召。
7. 直接输出纯文本，不要代码块标记。

内容素材：
${textContent}`;

    const aiRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${c.env.OPENROUTER_API_KEY}`,
        "HTTP-Referer": "https://wonderwisdom.online",
        "X-Title": "Wonder Hub",
      },
      body: JSON.stringify({
        model: "deepseek/deepseek-v4-pro",
        messages: [
          { role: "system", content: "You are an expert copywriter for Xiaohongshu." },
          { role: "user", content: prompt },
        ],
        temperature: 0.7,
      }),
    });

    if (!aiRes.ok) {
      console.error(`AI API failed: ${aiRes.status} - ${await aiRes.text()}`);
      return c.json({ error: "AI 生成失败" }, 500);
    }
    const aiData = (await aiRes.json()) as { choices: { message: { content: string } }[] };
    const markdown = aiData.choices[0].message.content
      .replace(/^```markdown\n/, "")
      .replace(/\n```$/, "");
    return c.json({ markdown });
  } catch (err) {
    console.error("XHS AI Error:", err);
    return c.json({ error: "AI 生成失败" }, 500);
  }
});
