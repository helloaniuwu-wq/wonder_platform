import { Hono } from "hono";
import { cors } from "hono/cors";
import { adminRouter } from "./routes/admin";
import { authRouter } from "./routes/auth";
import { clientsRouter } from "./routes/clients";
import { commissionsRouter } from "./routes/commissions";
import { companiesRouter } from "./routes/companies";
import { complianceRouter } from "./routes/compliance";
import { expensesRouter } from "./routes/expenses";
import { fipRouter } from "./routes/fip";
import { financialsRouter } from "./routes/financials";
import { invoicesRouter } from "./routes/invoices";
import { Env, Variables } from "./types";
import { HttpError } from "./utils/auth";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ── Global CORS Middleware ─────────────────────────────────────────────────
app.use(
  "*",
  cors({
    origin: (origin) => {
      // 允许所有来自 wonderwisdom.online、Cloudflare Pages (*.pages.dev) 以及本地开发的请求
      if (!origin) return "*";
      if (
        origin.endsWith(".pages.dev") ||
        origin.endsWith("wonderwisdom.online") ||
        origin.includes("localhost") ||
        origin.includes("127.0.0.1")
      ) {
        return origin;
      }
      return origin;
    },
    allowHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
    maxAge: 86400,
  })
);

// ── Global Error Handling ──────────────────────────────────────────────────
app.onError((err, c) => {
  console.error("Worker Error:", err);
  if (err instanceof HttpError) {
    return c.json({ detail: err.detail }, err.status as any);
  }
  return c.json({ detail: err.message || "Internal Server Error" }, 500);
});

// ── Health Check ───────────────────────────────────────────────────────────
app.get("/", (c) => c.json({ status: "ok", app: "Wonder Platform Cloudflare Serverless API" }));
app.get("/health", (c) => c.json({ status: "ok", app: c.env.APP_NAME || "Wonder Platform Worker" }));
app.get("/api/health", (c) => c.json({ status: "ok", app: c.env.APP_NAME || "Wonder Platform Worker" }));

// ── Static R2 File Serving (/receipts/* and /statements/*) ─────────────────
async function serveFromR2(c: any, prefix: string) {
  let path = c.req.path.replace(/^\/api/, "").replace(/^\/+/, "");
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
api.route("/companies", companiesRouter);
api.route("/companies/:company_id/clients", clientsRouter);
api.route("/companies/:company_id/invoices", invoicesRouter);
api.route("/companies/:company_id/commissions", commissionsRouter);
api.route("/companies/:company_id/financials", financialsRouter);
api.route("/companies/:company_id/compliance", complianceRouter);
api.route("/expenses", expensesRouter);
api.route("/", fipRouter);

// Support both /api/* and /* paths seamlessly
app.route("/api", api);
app.route("/", api);

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    console.log("Daily Cron Triggered:", event.cron);
    // Background price updates or cache warming can be performed here
  },
};
