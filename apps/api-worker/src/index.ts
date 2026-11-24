import { Hono } from "hono";
import { cors } from "hono/cors";
import { adminRouter } from "./routes/admin";
import { advisorRouter } from "./routes/advisor";
import { authRouter } from "./routes/auth";
import { clientsRouter } from "./routes/clients";
import { commissionsRouter } from "./routes/commissions";
import { companiesRouter } from "./routes/companies";
import { complianceRouter } from "./routes/compliance";
import { expensesRouter } from "./routes/expenses";
import { fipRouter } from "./routes/fip";
import { financialsRouter } from "./routes/financials";
import { getDashboardStats, invoicesRouter } from "./routes/invoices";
import { monitorRouter } from "./routes/monitor";
import { publicRouter } from "./routes/public";
import { quantRouter } from "./routes/quant";
import { getMarketData } from "./services/fip/dataProvider";
import { PortfolioEngine } from "./services/fip/portfolioEngine";
import { runDailyPortfolioMonitor } from "./services/fip/portfolioMonitor";
import { sendQuantAlert } from "./services/alerting";
import { runQuantWatchdog } from "./services/quantWatchdog";
import { Env, Variables } from "./types";
import { HttpError } from "./utils/auth";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ── Request ID Middleware ──────────────────────────────────────────────────
app.use("*", async (c, next) => {
  const reqId = c.req.header("X-Request-Id") || crypto.randomUUID().slice(0, 8);
  c.set("requestId", reqId);
  await next();
  c.header("X-Request-Id", reqId);
});

// ── Internal Trailing Slash Rewrite (Transparent, No 301 Redirect) ───────────
app.use("*", async (c, next) => {
  if (c.req.path !== "/" && c.req.path.endsWith("/")) {
    const cleanPath = c.req.path.slice(0, -1);
    const newUrl = new URL(c.req.url);
    newUrl.pathname = cleanPath;
    return app.fetch(new Request(newUrl.toString(), c.req.raw), c.env, c.executionCtx);
  }
  await next();
});

// ── Global CORS Middleware ─────────────────────────────────────────────────
export function isAllowedOrigin(origin: string, envOrigins?: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }

  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "wonderwisdom.online" ||
    hostname.endsWith(".wonderwisdom.online") ||
    hostname.endsWith(".pages.dev")
  ) {
    return true;
  }

  if (envOrigins) {
    const allowed = envOrigins
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (allowed.includes(origin)) {
      return true;
    }
  }

  return false;
}

app.use(
  "*",
  cors({
    origin: (origin, c) => {
      if (!origin) return null;
      return isAllowedOrigin(origin, c.env?.CORS_ORIGINS) ? origin : null;
    },
    allowHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
    maxAge: 86400,
  })
);

// ── Global Error Handling ──────────────────────────────────────────────────
app.onError((err, c) => {
  const reqId = c.get("requestId") || "-";
  console.error(`Worker Error [${reqId}]:`, err);
  if (err instanceof HttpError) {
    return c.json({ detail: err.detail, request_id: reqId }, err.status as any);
  }
  return c.json({ detail: err.message || "Internal Server Error", request_id: reqId }, 500);
});

// ── Health Check ───────────────────────────────────────────────────────────
app.get("/", (c) => c.json({ status: "ok", app: "Wonder Platform Cloudflare Serverless API" }));
app.get("/health", (c) => c.json({ status: "ok", app: c.env.APP_NAME || "Wonder Platform Worker" }));
app.get("/api/health", (c) => c.json({ status: "ok", app: c.env.APP_NAME || "Wonder Platform Worker" }));

// ── Static R2 File Serving (/receipts/* and /statements/*) ─────────────────
async function serveFromR2(c: any, prefix: string) {
  let path = c.req.path.replace(/^\/api/, "").replace(/^\/+/, "");
  // 兼容历史 DB 值与旧版前端拼出的 /receipts/./receipts/... —— 浏览器会把
  // URL 里的 /./ 规范化掉，这里再折叠一次重复前缀，避免 404。
  path = path.replace(/\/\.\//g, "/");
  for (const p of ["receipts", "statements"]) {
    if (path.startsWith(`${p}/${p}/`)) path = path.slice(p.length + 1);
  }
  let object = await c.env.BUCKET.get(path);

  if (!object && path.startsWith("receipts_archive/")) {
    object = await c.env.BUCKET.get(path.replace("receipts_archive/", "receipts/"));
  }
  if (!object && path.startsWith("statements_archive/")) {
    object = await c.env.BUCKET.get(path.replace("statements_archive/", "statements/"));
  }
  if (!object && !path.startsWith("receipts/") && !path.startsWith("statements/")) {
    object = await c.env.BUCKET.get(`${prefix}/${path}`);
  }

  if (!object) {
    return c.text("File Not Found", 404);
  }
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  return new Response(object.body, { headers });
}

app.get("/receipts/*", (c) => serveFromR2(c, "receipts"));
app.get("/api/receipts/*", (c) => serveFromR2(c, "receipts"));
app.get("/receipts_archive/*", (c) => serveFromR2(c, "receipts"));
app.get("/api/receipts_archive/*", (c) => serveFromR2(c, "receipts"));
app.get("/statements/*", (c) => serveFromR2(c, "statements"));
app.get("/api/statements/*", (c) => serveFromR2(c, "statements"));
app.get("/statements_archive/*", (c) => serveFromR2(c, "statements"));
app.get("/api/statements_archive/*", (c) => serveFromR2(c, "statements"));

// ── Mount Routes (Supporting both direct and /api/ prefixed calls) ──────────
const api = new Hono<{ Bindings: Env; Variables: Variables }>();

api.route("/auth", authRouter);
api.route("/admin", adminRouter);
api.route("/advisor", advisorRouter);
api.route("/companies", companiesRouter);
api.get("/companies/:company_id/dashboard", getDashboardStats);
api.route("/companies/:company_id/clients", clientsRouter);
// invoicesRouter 内部的路由自带 /invoices 前缀（/invoices、/invoices/:id/pdf 等），
// 因此挂载点只能是 /companies/:company_id，不能再拼一层 /invoices，
// 否则实际路径会变成 /companies/:id/invoices/invoices/... 而前端全部 404。
api.route("/companies/:company_id", invoicesRouter);
api.route("/companies/:company_id/commissions", commissionsRouter);
api.route("/companies/:company_id/financials", financialsRouter);
api.route("/companies/:company_id/compliance", complianceRouter);
api.route("/expenses", expensesRouter);
api.route("/quant", quantRouter);
api.route("/", fipRouter);
api.route("/", monitorRouter);
// 官网公开接口：/api/geo、/api/insurance-inquiry、/api/xhs-generate、
// /api/articles/:slug（客户通讯全文，鉴权后返回）
api.route("/", publicRouter);

// Support both /api/* and /* paths seamlessly
app.route("/api", api);
app.route("/", api);

/**
 * 定时刷新组合统计缓存。
 * 原本 scheduled 只打一行日志，导致 prices / portfolio_history / portfolio_stats_cache
 * 全部停在迁移当天，净值与分红永远不更新。
 *
 * 每轮只挑「最久未更新」的若干组合轮转覆盖，并限制并发，避免单次 Cron 因
 * 外部行情抓取过慢而超时。
 *
 * 必须走 getHistoricalChartData() 而不是只调 calculateNav()：前者末尾会调用
 * calculateNav() 刷新统计并把曲线末端校准到最新 NAV，一次调用同时更新「报告数字」
 * 与「历史曲线」。只刷统计会让曲线缓存停在旧口径，第二天又出现末端跳空。
 */
async function refreshPortfolioStats(env: Env, limit = 6) {
  const { results } = await env.DB.prepare(
    `SELECT p.id FROM portfolios p
     LEFT JOIN portfolio_stats_cache c ON c.portfolio_id = p.id
     ORDER BY COALESCE(c.last_updated, '1970-01-01') ASC
     LIMIT ?`
  )
    .bind(limit)
    .all<{ id: number }>();

  const rows = results || [];
  let ok = 0;
  let failed = 0;

  // 先按标的去重预热行情缓存，避免多个组合持有同一标的新增重复外部请求
  if (rows.length > 0) {
    try {
      const placeholders = rows.map(() => "?").join(",");
      const { results: isinRows } = await env.DB.prepare(
        `SELECT DISTINCT isin FROM transactions WHERE portfolio_id IN (${placeholders}) AND isin NOT LIKE 'CASH_%'`
      )
        .bind(...rows.map((r) => r.id))
        .all<{ isin: string }>();
      const uniqueIsins = (isinRows || []).map((r) => r.isin).filter(Boolean);
      for (let i = 0; i < uniqueIsins.length; i += 4) {
        await Promise.allSettled(uniqueIsins.slice(i, i + 4).map((isin) => getMarketData(env.DB, isin)));
      }
    } catch (e) {
      console.warn("[cron] unique ISIN pre-warm failed:", e);
    }
  }

  for (let i = 0; i < rows.length; i += 2) {
    const batch = rows.slice(i, i + 2);
    const settled = await Promise.allSettled(
      batch.map(async (row) => {
        const id = Number(row.id);
        const engine = new PortfolioEngine(env.DB, id);
        await engine.init();
        // 同时刷新统计缓存与历史曲线，保证曲线末端与报告 NAV 永远对齐
        const hist = await engine.getHistoricalChartData();
        if (Array.isArray(hist) && hist.length > 0) {
          await env.DB.prepare("UPDATE portfolio_stats_cache SET historical_chart = ? WHERE portfolio_id = ?")
            .bind(JSON.stringify(hist), id)
            .run();
        }
      })
    );
    for (const [idx, r] of settled.entries()) {
      if (r.status === "fulfilled") ok++;
      else {
        failed++;
        console.error(`[cron] portfolio ${batch[idx].id} refresh failed:`, r.reason);
      }
    }
  }
  console.log(`[cron] stats cache refreshed ok=${ok} failed=${failed} total=${rows.length}`);
  return { ok, failed, total: rows.length };
}

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    console.log("Daily Cron Triggered:", event.cron);
    ctx.waitUntil(
      Promise.allSettled([
        refreshPortfolioStats(env).then((res) => {
          if (res.failed > 0) {
            return sendQuantAlert(
              env,
              "FIS 組合定時刷新部分失敗",
              [`ok=${res.ok}, failed=${res.failed}, total=${res.total}`],
              "WARN"
            );
          }
        }),
        runQuantWatchdog(env).then((rep) => {
          if (!rep.healthy) {
            console.warn("[quant-watchdog] findings:", JSON.stringify(rep));
          }
        }),
        runDailyPortfolioMonitor(env).then((mon) => {
          console.log(`[cron] portfolio monitor checked=${mon.checked} alerts=${mon.alerts}`);
        }),
      ])
    );
  },
};
