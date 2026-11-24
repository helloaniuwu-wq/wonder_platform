import { Hono } from "hono";
import { Env, Variables } from "../types";
import { generateUuid, HttpError, requireUser } from "../utils/auth";
import { assertPortfolioRead, assertPortfolioWrite } from "../utils/portfolioAccess";
import { parsePositiveIntId } from "../utils/validate";
import { getLatestMacroSnapshot } from "../services/macroStore";
import {
  evaluatePortfolioHealth,
  getOrDefaultMonitoringConfig,
  MacroSensitivity,
  RebalanceMode,
  WrapperType,
} from "../services/fip/portfolioMonitor";
import { confirmRebalanceTicket, reevaluatePortfolioWithAI, updateRebalanceTicketDraft } from "../services/fip/rebalanceEngine";
import { ensureMonitoringSchema } from "../services/fip/monitoringSchema";
import { applyReconciliationAdjustments, parseHoldingsScreenshot } from "../services/holdingsOcr";

export const monitorRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

monitorRouter.use("*", async (c, next) => {
  await ensureMonitoringSchema(c.env.DB);
  await next();
});

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// ── 1. Global Advisor Cockpit Overview ──────────────────────────────────────
monitorRouter.get("/monitor/overview", async (c) => {
  const user = await requireUser(c);
  const macro = await getLatestMacroSnapshot(c.env.DB);

  let sql = "SELECT id, name, base_currency, dividend_strategy, user_id, is_public, created_at FROM portfolios WHERE is_public = 1";
  const params: unknown[] = [];
  if (user.role === "admin") {
    sql = "SELECT id, name, base_currency, dividend_strategy, user_id, is_public, created_at FROM portfolios";
  } else if (user.role === "advisor") {
    sql = `SELECT id, name, base_currency, dividend_strategy, user_id, is_public, created_at FROM portfolios
           WHERE is_public = 1 OR user_id = ?
              OR user_id IN (SELECT client_id FROM advisor_clients WHERE advisor_id = ? AND is_active = 1)`;
    params.push(user.id, user.id);
  } else {
    sql = "SELECT id, name, base_currency, dividend_strategy, user_id, is_public, created_at FROM portfolios WHERE is_public = 1 OR user_id = ?";
    params.push(user.id);
  }
  sql += " ORDER BY sort_order ASC, id DESC";

  const { results: pfRows } = await c.env.DB.prepare(sql).bind(...params).all<any>();
  const portfolios = pfRows || [];

  const configMap = new Map<number, any>();
  const healthMap = new Map<number, any>();
  const draftCountMap = new Map<number, number>();
  const statsMap = new Map<number, any>();

  try {
    const { results: cfgRows } = await c.env.DB.prepare("SELECT * FROM portfolio_monitoring_config").all<any>();
    for (const r of cfgRows || []) configMap.set(Number(r.portfolio_id), r);
  } catch {}

  try {
    const { results: hlRows } = await c.env.DB.prepare(
      `SELECT l.* FROM portfolio_health_logs l
       INNER JOIN (
         SELECT portfolio_id, MAX(snapshot_date) AS max_dt
         FROM portfolio_health_logs
         GROUP BY portfolio_id
       ) m ON m.portfolio_id = l.portfolio_id AND m.max_dt = l.snapshot_date`
    ).all<any>();
    for (const r of hlRows || []) healthMap.set(Number(r.portfolio_id), r);
  } catch {}

  try {
    const { results: tRows } = await c.env.DB.prepare(
      "SELECT portfolio_id, COUNT(*) AS cnt FROM portfolio_rebalance_tickets WHERE status = 'DRAFT' GROUP BY portfolio_id"
    ).all<any>();
    for (const r of tRows || []) draftCountMap.set(Number(r.portfolio_id), Number(r.cnt || 0));
  } catch {}

  try {
    const { results: sRows } = await c.env.DB.prepare(
      "SELECT portfolio_id, total_nav, cumulative_roi, annualized_return FROM portfolio_stats_cache"
    ).all<any>();
    for (const r of sRows || []) statsMap.set(Number(r.portfolio_id), r);
  } catch {}

  const items = portfolios.map((p: any) => {
    const pid = Number(p.id);
    const cfg = configMap.get(pid);
    const hl = healthMap.get(pid);
    const st = statsMap.get(pid);
    let flags: string[] = [];
    try {
      flags = hl?.macro_risk_flags_json ? JSON.parse(hl.macro_risk_flags_json) : [];
    } catch {}
    return {
      portfolio_id: pid,
      name: p.name,
      base_currency: p.base_currency || "USD",
      is_public: Boolean(p.is_public),
      wrapper_type: cfg?.wrapper_type || "AIA_TMP2",
      rebalance_mode: cfg?.rebalance_mode || "CALENDAR_BAND",
      drift_tolerance: cfg?.drift_tolerance ?? 0.05,
      max_drawdown_limit: cfg?.max_drawdown_limit ?? 0.15,
      total_nav: st?.total_nav ?? null,
      cumulative_roi: st?.cumulative_roi ?? null,
      snapshot_date: hl?.snapshot_date || null,
      health_score: hl?.health_score ?? null,
      twr_drawdown: hl?.twr_drawdown ?? null,
      max_asset_drift: hl?.max_asset_drift ?? null,
      macro_risk_flags: flags,
      action_required: Boolean(hl?.action_required),
      pending_draft_tickets: draftCountMap.get(pid) || 0,
    };
  });

  const evaluated = items.filter((i) => i.health_score != null);
  const avgScore =
    evaluated.length > 0
      ? Math.round(evaluated.reduce((s, i) => s + Number(i.health_score || 0), 0) / evaluated.length)
      : null;

  return c.json({
    macro,
    summary: {
      total_portfolios: items.length,
      evaluated_count: evaluated.length,
      action_required_count: items.filter((i) => i.action_required).length,
      pending_draft_tickets: items.reduce((s, i) => s + i.pending_draft_tickets, 0),
      avg_health_score: avgScore,
    },
    items,
  });
});

// ── 2. Per-Portfolio IPS Monitoring Config ──────────────────────────────────
monitorRouter.get("/portfolios/:id/monitor/config", async (c) => {
  const id = parsePositiveIntId(c.req.param("id"), "組合 ID");
  await assertPortfolioRead(c, id);
  const cfg = await getOrDefaultMonitoringConfig(c.env.DB, id);
  return c.json(cfg);
});

monitorRouter.put("/portfolios/:id/monitor/config", async (c) => {
  const user = await requireUser(c);
  const id = parsePositiveIntId(c.req.param("id"), "組合 ID");
  await assertPortfolioWrite(c, user, id);

  const body = await c.req.json<any>().catch(() => ({}));
  const existing = await getOrDefaultMonitoringConfig(c.env.DB, id);

  const wrapperType: WrapperType = ["AIA_TMP2", "BROKER_ETF", "HYBRID"].includes(
    String(body.wrapper_type || "").toUpperCase()
  )
    ? (String(body.wrapper_type).toUpperCase() as WrapperType)
    : existing.wrapper_type;

  const rebalanceMode: RebalanceMode = ["PERIODIC", "TOLERANCE_BAND", "CALENDAR_BAND", "MACRO_TRIGGER"].includes(
    String(body.rebalance_mode || "").toUpperCase()
  )
    ? (String(body.rebalance_mode).toUpperCase() as RebalanceMode)
    : existing.rebalance_mode;

  const sensLevel: MacroSensitivity = ["LOW", "MEDIUM", "HIGH"].includes(
    String(body.macro_sensitivity_level || "").toUpperCase()
  )
    ? (String(body.macro_sensitivity_level).toUpperCase() as MacroSensitivity)
    : existing.macro_sensitivity_level;

  const driftTol = Number.isFinite(Number(body.drift_tolerance))
    ? Math.min(0.5, Math.max(0.01, Number(body.drift_tolerance)))
    : existing.drift_tolerance;
  const maxDd = Number.isFinite(Number(body.max_drawdown_limit))
    ? Math.min(0.6, Math.max(0.03, Number(body.max_drawdown_limit)))
    : existing.max_drawdown_limit;
  const intervalDays = Number.isFinite(Number(body.reeval_interval_days))
    ? Math.min(365, Math.max(7, Math.round(Number(body.reeval_interval_days))))
    : existing.reeval_interval_days;
  const isActive = body.is_active !== undefined ? (body.is_active ? 1 : 0) : existing.is_active ? 1 : 0;
  const ipsProfile =
    body.ips_profile && typeof body.ips_profile === "object" ? body.ips_profile : existing.ips_profile;

  await c.env.DB.prepare(
    `INSERT INTO portfolio_monitoring_config (
      id, portfolio_id, wrapper_type, rebalance_mode, drift_tolerance, max_drawdown_limit,
      reeval_interval_days, macro_sensitivity_level, ips_profile_json, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(portfolio_id) DO UPDATE SET
      wrapper_type = excluded.wrapper_type,
      rebalance_mode = excluded.rebalance_mode,
      drift_tolerance = excluded.drift_tolerance,
      max_drawdown_limit = excluded.max_drawdown_limit,
      reeval_interval_days = excluded.reeval_interval_days,
      macro_sensitivity_level = excluded.macro_sensitivity_level,
      ips_profile_json = excluded.ips_profile_json,
      is_active = excluded.is_active,
      updated_at = CURRENT_TIMESTAMP`
  )
    .bind(
      generateUuid(),
      id,
      wrapperType,
      rebalanceMode,
      driftTol,
      maxDd,
      intervalDays,
      sensLevel,
      JSON.stringify(ipsProfile),
      isActive
    )
    .run();

  return c.json(await getOrDefaultMonitoringConfig(c.env.DB, id));
});

// ── 3. Per-Portfolio Health, TWR Drawdown & Manual Check ───────────────────
monitorRouter.get("/portfolios/:id/monitor/health", async (c) => {
  const id = parsePositiveIntId(c.req.param("id"), "組合 ID");
  await assertPortfolioRead(c, id);
  const persist = c.req.query("refresh") === "true";
  const report = await evaluatePortfolioHealth(c.env.DB, id, { persist });

  let history: any[] = [];
  try {
    const { results } = await c.env.DB.prepare(
      `SELECT snapshot_date, twr_nav, twr_drawdown, max_asset_drift, health_score, action_required, macro_risk_flags_json
       FROM portfolio_health_logs
       WHERE portfolio_id = ?
       ORDER BY snapshot_date DESC
       LIMIT 30`
    )
      .bind(id)
      .all<any>();
    history = (results || []).reverse().map((r) => ({
      snapshot_date: r.snapshot_date,
      twr_nav: Number(r.twr_nav),
      twr_drawdown: Number(r.twr_drawdown),
      max_asset_drift: Number(r.max_asset_drift),
      health_score: Number(r.health_score),
      action_required: Boolean(r.action_required),
    }));
  } catch {}

  return c.json({ ...report, history });
});

monitorRouter.post("/portfolios/:id/monitor/check", async (c) => {
  const user = await requireUser(c);
  const id = parsePositiveIntId(c.req.param("id"), "組合 ID");
  await assertPortfolioWrite(c, user, id);
  const report = await evaluatePortfolioHealth(c.env.DB, id, { persist: true });
  return c.json(report);
});

// ── 4. AI Reevaluation & Two-Stage Rebalance Tickets ───────────────────────
monitorRouter.post("/portfolios/:id/reevaluate", async (c) => {
  const user = await requireUser(c);
  const id = parsePositiveIntId(c.req.param("id"), "組合 ID");
  await assertPortfolioWrite(c, user, id);
  const body = await c.req.json<any>().catch(() => ({}));
  const ticket = await reevaluatePortfolioWithAI(c.env, c.env.DB, id, user, {
    wrapperOverride: body?.wrapper_type,
    triggerReason: body?.trigger_reason,
  });
  return c.json(ticket);
});

monitorRouter.get("/portfolios/:id/tickets", async (c) => {
  const id = parsePositiveIntId(c.req.param("id"), "組合 ID");
  await assertPortfolioRead(c, id);

  try {
    const { results } = await c.env.DB.prepare(
      "SELECT * FROM portfolio_rebalance_tickets WHERE portfolio_id = ? ORDER BY created_at DESC LIMIT 30"
    )
      .bind(id)
      .all<any>();

    return c.json(
      (results || []).map((r) => ({
        id: r.id,
        portfolio_id: Number(r.portfolio_id),
        batch_id: r.batch_id,
        wrapper_type: r.wrapper_type,
        ticket_type: r.ticket_type,
        status: r.status,
        trigger_reason: r.trigger_reason,
        proposed_allocations: JSON.parse(r.proposed_allocations_json || "{}"),
        order_payload: JSON.parse(r.order_payload_json || "{}"),
        ai_analysis: r.ai_analysis,
        macro_snapshot_date: r.macro_snapshot_date,
        created_by: r.created_by,
        confirmed_at: r.confirmed_at,
        confirmed_by: r.confirmed_by,
        created_at: r.created_at,
      }))
    );
  } catch {
    return c.json([]);
  }
});

monitorRouter.put("/portfolios/:id/tickets/:ticketId", async (c) => {
  const user = await requireUser(c);
  const id = parsePositiveIntId(c.req.param("id"), "組合 ID");
  await assertPortfolioWrite(c, user, id);
  const ticketId = c.req.param("ticketId");
  const body = await c.req.json<any>().catch(() => ({}));
  try {
    const updated = await updateRebalanceTicketDraft(c.env.DB, id, ticketId, user, {
      proposed_allocations: body?.proposed_allocations,
      trigger_reason: body?.trigger_reason,
      ai_analysis: body?.ai_analysis,
    });
    return c.json(updated);
  } catch (err: any) {
    throw new HttpError(400, err?.message || "儲存草稿失敗");
  }
});

monitorRouter.post("/portfolios/:id/tickets/:ticketId/confirm", async (c) => {
  const user = await requireUser(c);
  const id = parsePositiveIntId(c.req.param("id"), "組合 ID");
  await assertPortfolioWrite(c, user, id);
  const ticketId = c.req.param("ticketId");
  const body = await c.req.json<any>().catch(() => ({}));
  try {
    const res = await confirmRebalanceTicket(c.env.DB, id, ticketId, user, {
      proposed_allocations: body?.proposed_allocations,
      as_of_date: body?.as_of_date,
    });
    return c.json(res);
  } catch (err: any) {
    throw new HttpError(400, err?.message || "確認執行單失敗");
  }
});

monitorRouter.post("/portfolios/:id/tickets/:ticketId/cancel", async (c) => {
  const user = await requireUser(c);
  const id = parsePositiveIntId(c.req.param("id"), "組合 ID");
  await assertPortfolioWrite(c, user, id);
  const ticketId = c.req.param("ticketId");

  const res = await c.env.DB.prepare(
    "UPDATE portfolio_rebalance_tickets SET status = 'CANCELLED' WHERE id = ? AND portfolio_id = ? AND status = 'DRAFT'"
  )
    .bind(ticketId, id)
    .run();

  if ((res.meta.changes ?? 0) === 0) {
    throw new HttpError(404, "未找到可取消的草稿執行單");
  }
  return c.json({ status: "CANCELLED", ticket_id: ticketId });
});

// ── 5. Auxiliary Holdings Screenshot OCR Reconciliation ───────────────────
monitorRouter.post("/portfolios/:id/reconcile/ocr", async (c) => {
  const user = await requireUser(c);
  const id = parsePositiveIntId(c.req.param("id"), "組合 ID");
  await assertPortfolioWrite(c, user, id);

  const contentType = c.req.header("content-type") || "";
  let dataUrl = "";
  let filename = "holdings.png";

  if (contentType.includes("multipart/form-data")) {
    const form = await c.req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") {
      throw new HttpError(400, "請上傳持倉截圖圖片");
    }
    const f = file as File;
    const buf = await f.arrayBuffer();
    if (buf.byteLength > 10 * 1024 * 1024) {
      throw new HttpError(400, "圖片大小不能超過 10MB");
    }
    const mime = f.type || "image/png";
    filename = f.name || "holdings.png";
    dataUrl = `data:${mime};base64,${arrayBufferToBase64(buf)}`;
  } else {
    const body = await c.req.json<any>().catch(() => ({}));
    dataUrl = String(body?.image_data_url || "").trim();
    filename = String(body?.filename || "holdings.png");
  }

  if (!dataUrl.startsWith("data:")) {
    throw new HttpError(400, "無效的圖片格式");
  }

  const result = await parseHoldingsScreenshot(c.env, c.env.DB, id, dataUrl, filename);
  return c.json(result);
});

monitorRouter.post("/portfolios/:id/reconcile/apply", async (c) => {
  const user = await requireUser(c);
  const id = parsePositiveIntId(c.req.param("id"), "組合 ID");
  await assertPortfolioWrite(c, user, id);

  const body = await c.req.json<any>().catch(() => ({}));
  const adjustments = Array.isArray(body?.adjustments) ? body.adjustments : [];
  if (adjustments.length === 0) {
    throw new HttpError(400, "沒有需要校準的持倉差異");
  }

  const res = await applyReconciliationAdjustments(c.env.DB, id, user, adjustments);
  return c.json({ status: "success", ...res });
});
