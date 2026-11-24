import { Hono } from "hono";
import { PortfolioEngine } from "../services/fip/portfolioEngine";
import { getFxRate, getHistoricalPrice, getMarketData, resolveAssetCurrency } from "../services/fip/dataProvider";
import { parseInsurancePlan } from "../services/fip/insuranceParser";
import {
  generateClientReportNarrative,
  generateWealthReportDocx,
} from "../services/fip/reportGenerator";
import { StrategyLab } from "../services/fip/strategyLab";
import { Env, Variables } from "../types";
import { writeAuditLog } from "../utils/audit";
import { AppContext, generateUuid, getOptionalUser, HttpError, requireUser } from "../utils/auth";
import { assertPortfolioRead, assertPortfolioWrite } from "../utils/portfolioAccess";
import {
  optCurrency,
  optEnum,
  optFiniteNumber,
  optIsoDate,
  optWeightRecord,
  parseJsonBody,
  parsePositiveIntId,
  reqNonEmptyString,
  reqPositiveNumber,
} from "../utils/validate";

export const fipRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

// ── Portfolios List & Management ───────────────────────────────────────────
fipRouter.get("/portfolios", async (c) => {
  const user = await getOptionalUser(c);
  let sql = "SELECT * FROM portfolios WHERE is_public = 1";
  const params: unknown[] = [];

  if (user) {
    if (user.role === "admin") {
      sql = "SELECT * FROM portfolios";
    } else if (user.role === "advisor") {
      sql = `SELECT * FROM portfolios 
             WHERE is_public = 1 
                OR user_id = ? 
                OR user_id IN (SELECT client_id FROM advisor_clients WHERE advisor_id = ? AND is_active = 1)`;
      params.push(user.id, user.id);
    } else {
      sql = "SELECT * FROM portfolios WHERE is_public = 1 OR user_id = ?";
      params.push(user.id);
    }
  }

  sql += " ORDER BY sort_order ASC, created_at DESC";
  const { results } = await c.env.DB.prepare(sql).bind(...params).all<any>();

  return c.json(
    (results || []).map((p) => ({
      id: p.id,
      name: p.name,
      base_currency: p.base_currency || "USD",
      dividend_strategy: p.dividend_strategy || "CASH",
      target_allocations: p.target_allocations ? JSON.parse(p.target_allocations) : {},
      is_public: Boolean(p.is_public),
      sort_order: p.sort_order || 0,
      user_id: p.user_id,
      created_at: p.created_at,
      start_date: (p.created_at || "").slice(0, 10),
    }))
  );
});

fipRouter.post("/portfolios/new", async (c) => {
  const user = await requireUser(c);
  const body = await parseJsonBody(c, (raw) => {
    const name = reqNonEmptyString(raw, "name", "請輸入組合名稱", { maxLen: 120 });
    const base_currency = optCurrency(raw, "base_currency", "USD");
    const dividend_strategy = optEnum(raw, "dividend_strategy", ["CASH", "REINVEST", "DRIP"] as const, "CASH", "分紅策略");
    const allocations = optWeightRecord(raw, "allocations");
    const target_allocations = optWeightRecord(raw, "target_allocations");
    const budget = optFiniteNumber(raw, "budget", 0, { min: 0, label: "初始資金" });
    const date = optIsoDate(raw, "date", new Date().toISOString().slice(0, 10));
    const manual_prices = optWeightRecord(raw, "manual_prices");
    return {
      name,
      base_currency,
      dividend_strategy,
      allocations,
      target_allocations,
      budget,
      date,
      manual_prices,
      is_public: Boolean(raw.is_public),
      client_id: typeof raw.client_id === "string" && raw.client_id.trim() ? raw.client_id.trim() : null,
      monitoring_config:
        raw.monitoring_config && typeof raw.monitoring_config === "object" && !Array.isArray(raw.monitoring_config)
          ? (raw.monitoring_config as Record<string, any>)
          : null,
      ilp_config:
        raw.ilp_config && typeof raw.ilp_config === "object" && !Array.isArray(raw.ilp_config)
          ? (raw.ilp_config as Record<string, unknown>)
          : null,
    };
  });

  const { name, base_currency: baseCurrency, dividend_strategy: divStrategy } = body;
  const targetAllocations = body.allocations
    ? JSON.stringify(body.allocations)
    : body.target_allocations
    ? JSON.stringify(body.target_allocations)
    : "{}";
  const now = new Date().toISOString();

  // 检查是否为客户创建
  let targetUserId = user.id;
  if (body.client_id) {
    if (user.role === "admin") {
      targetUserId = body.client_id;
    } else if (user.role === "advisor") {
      const link = await c.env.DB.prepare(
        "SELECT 1 FROM advisor_clients WHERE advisor_id = ? AND client_id = ? AND is_active = 1"
      )
        .bind(user.id, body.client_id)
        .first();
      if (!link) {
        throw new HttpError(403, "該客戶不在你的服務範圍內");
      }
      targetUserId = body.client_id;
    } else if (body.client_id !== user.id) {
      throw new HttpError(403, "僅顧問或管理員可為客戶建立組合");
    }
  }

  const maxOrder = await c.env.DB.prepare("SELECT MAX(sort_order) as m FROM portfolios").first<{ m: number }>();
  const sortOrder = (maxOrder?.m || 0) + 1;

  const res = await c.env.DB.prepare(
    `INSERT INTO portfolios (name, base_currency, dividend_strategy, target_allocations, user_id, is_public, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(name, baseCurrency, divStrategy, targetAllocations, targetUserId, body.is_public ? 1 : 0, sortOrder, now)
    .run();

  const id = res.meta.last_row_id;

  // 如果提供了 budget 与 allocations，自动初始化入金和买入记录
  const budget = body.budget;
  const startDate = body.date;
  const txStmts: any[] = [];

  if (budget > 0) {
    txStmts.push(
      c.env.DB.prepare(
        "INSERT INTO transactions (portfolio_id, date, isin, type, shares, price) VALUES (?, ?, ?, 'CASH_IN', 1.0, ?)"
      ).bind(id, startDate, `CASH_${baseCurrency}`, budget)
    );
  }

  const allocations = body.allocations || {};
  const manualPrices = body.manual_prices || {};
  const allocEntries = Object.entries(allocations).filter(([isin, w]) => Boolean(isin) && Number(w) > 0);
  const priceFallbackIsins: string[] = [];
  const todayStr = new Date().toISOString().slice(0, 10);

  const resolvedAssets = await Promise.all(
    allocEntries.map(async ([isin]) => {
      const assetCcy = await resolveAssetCurrency(c.env.DB, isin);
      const fxBaseToAsset =
        assetCcy !== baseCurrency ? await getFxRate(c.env.DB, baseCurrency, assetCcy) : 1.0;

      const manual = Number(manualPrices[isin]);
      if (Number.isFinite(manual) && manual > 0) {
        return { price: manual, fxBaseToAsset, isFallback: false };
      }
      try {
        const hist = await getHistoricalPrice(c.env.DB, isin, startDate);
        if (hist > 0) return { price: hist, fxBaseToAsset, isFallback: false };
      } catch {
        // fallback to realtime quote below
      }
      try {
        const md = await getMarketData(c.env.DB, isin);
        if (md && md.price > 0) {
          const mdCcy = md.currency ? md.currency.toUpperCase() : assetCcy;
          const mdFx = mdCcy !== baseCurrency ? await getFxRate(c.env.DB, baseCurrency, mdCcy) : 1.0;
          return { price: md.price, fxBaseToAsset: mdFx, isFallback: false };
        }
      } catch {
        // fallback below
      }
      priceFallbackIsins.push(isin);
      return { price: 100.0, fxBaseToAsset: 1.0, isFallback: true };
    })
  );

  for (let idx = 0; idx < allocEntries.length; idx++) {
    const [isin, weightVal] = allocEntries[idx];
    const weight = Number(weightVal);
    const allocBudgetBase = budget * weight;
    const { price, fxBaseToAsset } = resolvedAssets[idx];
    const allocBudgetInAssetCcy = allocBudgetBase * (fxBaseToAsset > 0 ? fxBaseToAsset : 1.0);
    const shares = Math.round((allocBudgetInAssetCcy / price) * 10000) / 10000;
    txStmts.push(
      c.env.DB.prepare(
        "INSERT INTO transactions (portfolio_id, date, isin, type, shares, price) VALUES (?, ?, ?, 'BUY', ?, ?)"
      ).bind(id, startDate, isin, shares, price)
    );
  }

  if (txStmts.length > 0) {
    if (typeof (c.env.DB as any).batch === "function") {
      await c.env.DB.batch(txStmts);
    } else {
      for (const stmt of txStmts) await stmt.run();
    }
  }

  // Persist IPS & monitoring config if provided (graceful if migration 0008 hasn't run in tests)
  if (body.monitoring_config) {
    try {
      const mc = body.monitoring_config;
      const wrapperType = ["AIA_TMP2", "BROKER_ETF", "HYBRID"].includes(String(mc.wrapper_type || "").toUpperCase())
        ? String(mc.wrapper_type).toUpperCase()
        : "AIA_TMP2";
      const rebalanceMode = ["PERIODIC", "TOLERANCE_BAND", "CALENDAR_BAND", "MACRO_TRIGGER"].includes(
        String(mc.rebalance_mode || "").toUpperCase()
      )
        ? String(mc.rebalance_mode).toUpperCase()
        : "CALENDAR_BAND";
      const driftTol = Number.isFinite(Number(mc.drift_tolerance))
        ? Math.min(0.5, Math.max(0.01, Number(mc.drift_tolerance)))
        : 0.05;
      const maxDdLim = Number.isFinite(Number(mc.max_drawdown_limit))
        ? Math.min(0.6, Math.max(0.03, Number(mc.max_drawdown_limit)))
        : 0.15;
      const intervalDays = Number.isFinite(Number(mc.reeval_interval_days))
        ? Math.min(365, Math.max(7, Math.round(Number(mc.reeval_interval_days))))
        : 90;
      const sensLevel = ["LOW", "MEDIUM", "HIGH"].includes(String(mc.macro_sensitivity_level || "").toUpperCase())
        ? String(mc.macro_sensitivity_level).toUpperCase()
        : "MEDIUM";
      const ipsJson = JSON.stringify(mc.ips_profile || {});

      await c.env.DB.prepare(
        `INSERT INTO portfolio_monitoring_config (
          id, portfolio_id, wrapper_type, rebalance_mode, drift_tolerance, max_drawdown_limit,
          reeval_interval_days, macro_sensitivity_level, ips_profile_json, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(portfolio_id) DO UPDATE SET
          wrapper_type = excluded.wrapper_type,
          rebalance_mode = excluded.rebalance_mode,
          drift_tolerance = excluded.drift_tolerance,
          max_drawdown_limit = excluded.max_drawdown_limit,
          reeval_interval_days = excluded.reeval_interval_days,
          macro_sensitivity_level = excluded.macro_sensitivity_level,
          ips_profile_json = excluded.ips_profile_json,
          updated_at = CURRENT_TIMESTAMP`
      )
        .bind(
          generateUuid(),
          id,
          wrapperType,
          rebalanceMode,
          driftTol,
          maxDdLim,
          intervalDays,
          sensLevel,
          ipsJson
        )
        .run();
    } catch {
      // ignore if monitoring table doesn't exist in mock/legacy DB
    }
  }

  if (body.ilp_config) {
    try {
      await writePortfolioIlpConfig(c.env.DB, Number(id), body.ilp_config);
    } catch {
      // ignore if portfolio_ilp_config table doesn't exist in mock DB
    }
  }

  await writeAuditLog(c.env.DB, {
    userId: user.id,
    action: "portfolio.create",
    resourceType: "portfolio",
    resourceId: id,
    detail: { name, targetUserId, baseCurrency, priceFallbackIsins },
  });

  return c.json({
    id,
    portfolio_id: id,
    name,
    base_currency: baseCurrency,
    dividend_strategy: divStrategy,
    user_id: targetUserId,
    ...(priceFallbackIsins.length > 0 ? { price_fallback_isins: priceFallbackIsins } : {}),
  });
});

fipRouter.get("/portfolios/:id", async (c) => {
  const id = parsePositiveIntId(c.req.param("id"), "組合 ID");
  const row = await assertPortfolioRead(c, id);

  return c.json({
    id: row.id,
    name: row.name,
    base_currency: row.base_currency || "USD",
    dividend_strategy: row.dividend_strategy || "CASH",
    target_allocations: row.target_allocations ? JSON.parse(row.target_allocations) : {},
    is_public: Boolean(row.is_public),
    sort_order: row.sort_order || 0,
    user_id: row.user_id,
    created_at: row.created_at,
  });
});

fipRouter.put("/portfolios/:id", async (c) => {
  const user = await requireUser(c);
  const id = parsePositiveIntId(c.req.param("id"), "組合 ID");
  await assertPortfolioWrite(c, user, id);
  const body = await parseJsonBody(c, (raw) => ({
    name: raw.name !== undefined ? reqNonEmptyString(raw, "name", "組合名稱不能為空", { maxLen: 120 }) : undefined,
    base_currency: raw.base_currency !== undefined ? optCurrency(raw, "base_currency", "USD") : undefined,
    dividend_strategy:
      raw.dividend_strategy !== undefined
        ? optEnum(raw, "dividend_strategy", ["CASH", "REINVEST", "DRIP"] as const, "CASH", "分紅策略")
        : undefined,
    target_allocations: raw.target_allocations !== undefined ? optWeightRecord(raw, "target_allocations") : undefined,
    is_public: raw.is_public !== undefined ? Boolean(raw.is_public) : undefined,
  }));

  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.name !== undefined) {
    updates.push("name = ?");
    values.push(body.name);
  }
  if (body.base_currency !== undefined) {
    updates.push("base_currency = ?");
    values.push(String(body.base_currency).toUpperCase());
  }
  if (body.dividend_strategy !== undefined) {
    updates.push("dividend_strategy = ?");
    values.push(String(body.dividend_strategy).toUpperCase());
  }
  if (body.target_allocations !== undefined) {
    updates.push("target_allocations = ?");
    values.push(JSON.stringify(body.target_allocations));
  }
  if (body.is_public !== undefined) {
    updates.push("is_public = ?");
    values.push(body.is_public ? 1 : 0);
  }

  if (updates.length > 0) {
    values.push(id);
    await c.env.DB.prepare(`UPDATE portfolios SET ${updates.join(", ")} WHERE id = ?`)
      .bind(...values)
      .run();
  }

  return c.json({ success: true, id });
});

fipRouter.delete("/portfolios/:id", async (c) => {
  const user = await requireUser(c);
  const id = parseInt(c.req.param("id"), 10);
  await assertPortfolioWrite(c, user, id);

  await c.env.DB.prepare("DELETE FROM transactions WHERE portfolio_id = ?").bind(id).run();
  await c.env.DB.prepare("DELETE FROM manual_dividends WHERE portfolio_id = ?").bind(id).run();
  await c.env.DB.prepare("DELETE FROM portfolio_stats_cache WHERE portfolio_id = ?").bind(id).run();
  for (const tbl of ["portfolio_health_logs", "portfolio_rebalance_tickets", "portfolio_monitoring_config"]) {
    try {
      await c.env.DB.prepare(`DELETE FROM ${tbl} WHERE portfolio_id = ?`).bind(id).run();
    } catch {
      // ignore if 0008 hasn't been applied
    }
  }
  await c.env.DB.prepare("DELETE FROM portfolios WHERE id = ?").bind(id).run();

  await writeAuditLog(c.env.DB, {
    userId: user.id,
    action: "portfolio.delete",
    resourceType: "portfolio",
    resourceId: id,
  });

  return c.json({ success: true, id });
});

const handleReorderPortfolios = async (c: any) => {
  const user = await requireUser(c);
  const body = (await c.req.json()) as { ids?: number[]; ordered_ids?: number[] };
  const list = Array.isArray(body.ordered_ids) ? body.ordered_ids : Array.isArray(body.ids) ? body.ids : [];
  for (let i = 0; i < list.length; i++) {
    const pid = Number(list[i]);
    if (!Number.isFinite(pid)) continue;
    await assertPortfolioWrite(c, user, pid);
  }
  for (let i = 0; i < list.length; i++) {
    const pid = Number(list[i]);
    if (!Number.isFinite(pid)) continue;
    await c.env.DB.prepare("UPDATE portfolios SET sort_order = ? WHERE id = ?")
      .bind(i + 1, pid)
      .run();
  }
  return c.json({ status: "success", success: true });
};
fipRouter.post("/portfolios/reorder", handleReorderPortfolios);
fipRouter.put("/portfolios/reorder", handleReorderPortfolios);

// ── Portfolio Report & Stats ───────────────────────────────────────────────
fipRouter.get("/report/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  await assertPortfolioRead(c, id);
  const refresh = c.req.query("refresh") === "true";

  // 1. 如果没有要求强制刷新，优先从 portfolio_stats_cache 毫秒级读取历史快照
  if (!refresh) {
    const cache = await c.env.DB.prepare(
      "SELECT * FROM portfolio_stats_cache WHERE portfolio_id = ?"
    )
      .bind(id)
      .first<any>();

    const portfolio = await c.env.DB.prepare(
      "SELECT name, base_currency, dividend_strategy, created_at FROM portfolios WHERE id = ?"
    )
      .bind(id)
      .first<any>();

    if (cache && portfolio && cache.details) {
      let details = [];
      try {
        details = JSON.parse(cache.details);
      } catch {}

      const sectorMap: Record<string, number> = {};
      const countryMap: Record<string, number> = {};
      for (const d of details) {
        if (d.sector) sectorMap[d.sector] = Math.round(((sectorMap[d.sector] || 0) + (d.market_value || 0)) * 100) / 100;
        if (d.country) countryMap[d.country] = Math.round(((countryMap[d.country] || 0) + (d.market_value || 0)) * 100) / 100;
      }

      const totalNav = Number(cache.total_nav || 0);
      const totalPnl = Number(cache.total_pnl || 0);
      const totalDivs = Number(cache.total_divs || 0);
      const totalCost =
        cache.total_cost != null
          ? Number(cache.total_cost)
          : // 兼容尚未回填 total_cost 的旧缓存行
            Math.round((totalNav - totalPnl + totalDivs) * 100) / 100;
      const startDate = (portfolio.created_at || "").slice(0, 10);
      const reportDate = (cache.last_updated || new Date().toISOString()).slice(0, 10);
      const walletBal = Number(cache.wallet_balance || 0);

      return c.json({
        id,
        name: portfolio.name,
        base_currency: portfolio.base_currency || "USD",
        dividend_strategy: portfolio.dividend_strategy || "CASH",
        created_at: portfolio.created_at,
        start_date: startDate,
        report_date: reportDate,
        total_nav: totalNav,
        total_market_value: Math.round((totalNav - walletBal) * 100) / 100,
        wallet_balance: walletBal,
        total_cost: totalCost,
        total_pnl: totalPnl,
        total_divs: totalDivs,
        cumulative_roi: Number(cache.cumulative_roi || 0),
        annualized_return: Number(cache.annualized_return || 0),
        details,
        sector_allocation: sectorMap,
        country_allocation: countryMap,
        last_updated: cache.last_updated,
      });
    }
  }

  // 2. 无缓存或指定刷新时执行完整计算
  const engine = new PortfolioEngine(c.env.DB, id);
  await engine.init();
  const navData = await engine.calculateNav();
  const todayStr = new Date().toISOString().slice(0, 10);
  const startDate = (engine.meta.created_at || todayStr).slice(0, 10);

  return c.json({
    id,
    name: engine.meta.name,
    base_currency: engine.meta.base_currency,
    dividend_strategy: engine.meta.dividend_strategy,
    created_at: engine.meta.created_at,
    start_date: startDate,
    report_date: todayStr,
    total_market_value: Math.round((navData.total_nav - navData.wallet_balance) * 100) / 100,
    ...navData,
  });
});

fipRouter.get("/report/history/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  await assertPortfolioRead(c, id);
  const refresh = c.req.query("refresh") === "true";

  // 1. Check cache first for instant sub-millisecond response
  if (!refresh) {
    try {
      const cache = await c.env.DB.prepare(
        "SELECT historical_chart FROM portfolio_stats_cache WHERE portfolio_id = ?"
      )
        .bind(id)
        .first<{ historical_chart: string }>();

      if (cache && cache.historical_chart) {
        const parsed = JSON.parse(cache.historical_chart);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return c.json(parsed);
        }
      }
    } catch {
      // ignore
    }
  }

  // 2. Compute via portfolio engine
  const engine = new PortfolioEngine(c.env.DB, id);
  await engine.init();
  const hist = await engine.getHistoricalChartData();

  // 3. Persist to cache
  if (Array.isArray(hist) && hist.length > 0) {
    try {
      await c.env.DB.prepare(
        "UPDATE portfolio_stats_cache SET historical_chart = ? WHERE portfolio_id = ?"
      )
        .bind(JSON.stringify(hist), id)
        .run();
    } catch {
      // ignore
    }
  }

  return c.json(hist);
});

// ── Dividends Projections & Management ────────────────────────────────────
fipRouter.get("/portfolios/dividends/projections/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  await assertPortfolioRead(c, id);
  const taxRate = parseFloat(c.req.query("tax_rate") || "0.0") || 0.0;
  const drip = c.req.query("drip") === "true";

  const engine = new PortfolioEngine(c.env.DB, id);
  await engine.init();
  const proj = await engine.getDividendProjections(taxRate, drip);

  return c.json(proj);
});

fipRouter.get("/portfolios/dividends/export/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  await assertPortfolioRead(c, id);
  const engine = new PortfolioEngine(c.env.DB, id);
  await engine.init();
  const list = await engine.getDividendDetails();

  return c.json(list);
});

fipRouter.post("/portfolios/dividend/manual/:id", async (c) => {
  const user = await requireUser(c);
  const id = parsePositiveIntId(c.req.param("id"), "組合 ID");
  await assertPortfolioWrite(c, user, id);
  const body = await parseJsonBody(c, (raw) => ({
    isin: reqNonEmptyString(raw, "isin", "請輸入 ISIN", { maxLen: 32 }),
    date: optIsoDate(raw, "date", new Date().toISOString().slice(0, 10)),
    amount_per_share: reqPositiveNumber(raw, "amount_per_share", "每股分紅金額"),
    currency: optCurrency(raw, "currency", "USD"),
  }));

  await c.env.DB.prepare(
    "INSERT INTO manual_dividends (portfolio_id, isin, date, amount_per_share, currency) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(id, body.isin, body.date, body.amount_per_share, body.currency)
    .run();

  return c.json({ success: true });
});

fipRouter.delete("/dividends/manual/:div_id", async (c) => {
  const user = await requireUser(c);
  const divId = parseInt(c.req.param("div_id"), 10);
  const divRow = await c.env.DB.prepare("SELECT portfolio_id FROM manual_dividends WHERE id = ?")
    .bind(divId)
    .first<{ portfolio_id: number }>();
  if (!divRow) throw new HttpError(404, "分紅記錄不存在");
  await assertPortfolioWrite(c, user, divRow.portfolio_id);

  await c.env.DB.prepare("DELETE FROM manual_dividends WHERE id = ?").bind(divId).run();
  return c.json({ success: true });
});

fipRouter.get("/heartbeat/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  await assertPortfolioRead(c, id);
  const cache = await c.env.DB.prepare(
    "SELECT total_nav, last_updated FROM portfolio_stats_cache WHERE portfolio_id = ?"
  )
    .bind(id)
    .first<any>();

  return c.json({
    id,
    total_nav: cache?.total_nav || 0,
    last_updated: cache?.last_updated || new Date().toISOString(),
  });
});

// ── Transactions ───────────────────────────────────────────────────────────
fipRouter.get("/portfolios/transactions/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  await assertPortfolioRead(c, id);
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM transactions WHERE portfolio_id = ? ORDER BY date DESC, id DESC"
  )
    .bind(id)
    .all<any>();

  return c.json(results || []);
});

fipRouter.post("/portfolios/transactions/:id", async (c) => {
  const user = await requireUser(c);
  const id = parsePositiveIntId(c.req.param("id"), "組合 ID");
  await assertPortfolioWrite(c, user, id);
  const body = await parseJsonBody(c, (raw) => ({
    date: optIsoDate(raw, "date", new Date().toISOString().slice(0, 10)),
    isin: reqNonEmptyString(raw, "isin", "請輸入 ISIN", { maxLen: 32 }),
    type: optEnum(raw, "type", ["BUY", "SELL", "CASH_IN", "CASH_OUT", "DIVIDEND"] as const, "BUY", "交易類型"),
    shares: reqPositiveNumber(raw, "shares", "數量/份額"),
    price: optFiniteNumber(raw, "price", 0, { min: 0, label: "價格" }),
  }));

  await c.env.DB.prepare(
    "INSERT INTO transactions (portfolio_id, date, isin, type, shares, price) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(id, body.date, body.isin, body.type, body.shares, body.price)
    .run();

  await PortfolioEngine.clearStatsCache(c.env.DB, id);
  return c.json({ success: true });
});

fipRouter.delete("/portfolios/transactions/:tx_id", async (c) => {
  const user = await requireUser(c);
  const txId = parseInt(c.req.param("tx_id"), 10);
  const txRow = await c.env.DB.prepare("SELECT portfolio_id FROM transactions WHERE id = ?")
    .bind(txId)
    .first<{ portfolio_id: number }>();
  if (!txRow) throw new HttpError(404, "交易記錄不存在");
  await assertPortfolioWrite(c, user, txRow.portfolio_id);
  await c.env.DB.prepare("DELETE FROM transactions WHERE id = ?").bind(txId).run();
  await PortfolioEngine.clearStatsCache(c.env.DB, txRow.portfolio_id);
  return c.json({ success: true, id: txId });
});

// ── Manual Dividends 的 POST / DELETE 已在上方「Dividends Projections & Management」
//    段内注册，此处不再重复注册（Hono 只会命中先注册的那一条，重复注册属于死代码）。
//    前端 DividendModal 提交的是 amount_per_share，故保留上方版本。

// ── Strategy Lab Endpoints ─────────────────────────────────────────────────
/**
 * 保险计划书 Excel 解析。
 * 迁移时整条端点缺失，导致「储蓄分红险配置」上传即 404，实验室的保险叠加功能完全不可用。
 * Worker 无法运行 openpyxl，改用 SheetJS 复用同一套表头识别规则。
 */
fipRouter.post("/lab/insurance/parse", async (c) => {
  await requireUser(c);
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    throw new HttpError(400, "请以 multipart/form-data 上传计划书文件");
  }

  const file = form.get("file");
  if (!file || typeof file === "string") {
    throw new HttpError(400, "未收到文件");
  }

  const buf = await (file as File).arrayBuffer();
  if (buf.byteLength > 10 * 1024 * 1024) {
    throw new HttpError(400, "文件过大（上限 10MB）");
  }

  const result = parseInsurancePlan(buf, (file as File).name || "保险计划书");
  if (!result.ok) {
    throw new HttpError(422, result.error || "解析失败");
  }
  return c.json(result);
});

fipRouter.post("/lab/analyze", async (c) => {
  await requireUser(c);
  const body = await c.req.json<any>();
  const isins: string[] = body.isins || [];
  if (isins.length === 0) throw new HttpError(400, "請選擇至少一項資產進行分析");

  const lab = new StrategyLab(c.env.DB);
  const result = await lab.runAnalysis(
    isins,
    Number(body.days_back || 1825),
    Number(body.max_weight || 0.35),
    body.custom_weights,
    {
      capital: Number(body.mc_capital || 1000000),
      years: Number(body.mc_years || 15),
      contribution: Number(body.mc_contribution || 0),
      contribution_start: Number(body.mc_contribution_start || 1),
      contribution_years: Number(body.mc_contribution_years || 100),
      withdrawal: Number(body.mc_withdrawal || 0),
      withdrawal_start: Number(body.mc_withdrawal_start || 1),
      withdrawal_end: Number(body.mc_withdrawal_end || 100),
      withdrawal_inflation: Boolean(body.mc_withdrawal_inflation),
      withdrawal_2: Number(body.mc_withdrawal_2 || 0),
      withdrawal_start_2: Number(body.mc_withdrawal_start_2 || 1),
      withdrawal_end_2: Number(body.mc_withdrawal_end_2 || 100),
      target: Number(body.mc_target || 0),
      inflation: Number(body.mc_inflation || 0),
      stress: Boolean(body.mc_stress),
      insurance_plan: body.insurance_plan,
      insurance_alpha_low: body.insurance_alpha_low,
      insurance_alpha_high: body.insurance_alpha_high,
      cma_mode: body.cma_mode || body.mc_cma_mode || "shrunk",
    },
    body.risk_free_rate != null && Number.isFinite(Number(body.risk_free_rate))
      ? Number(body.risk_free_rate)
      : undefined,
    (body.cma_mode || body.mc_cma_mode || "shrunk") as any,
    String(body.base_currency || "USD")
  );

  return c.json(result);
});

fipRouter.post("/lab/report-narrative", async (c) => {
  await requireUser(c);
  const body = await c.req.json<any>().catch(() => ({}));
  const narrative = await generateClientReportNarrative(body, c.env);
  return c.json(narrative);
});

fipRouter.post("/lab/generate-report", async (c) => {
  await requireUser(c);
  const body = await c.req.json<any>().catch(() => ({}));
  const docxBytes = await generateWealthReportDocx(body, c.env);

  return new Response(docxBytes as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="Wealth_Report_${new Date().toISOString().slice(0, 10)}.docx"`,
    },
  });
});

// ── Lab Scenarios (按用户隔离，修复跨用户越权审计项) ──────────────────────────
fipRouter.get("/lab/scenarios", async (c) => {
  const user = await requireUser(c);
  const stmt =
    user.role === "admin"
      ? c.env.DB.prepare(
          "SELECT id, name, created_at, assets_json, weights_json, summary_json, user_id FROM lab_scenarios ORDER BY created_at DESC"
        )
      : c.env.DB.prepare(
          "SELECT id, name, created_at, assets_json, weights_json, summary_json, user_id FROM lab_scenarios WHERE user_id = ? ORDER BY created_at DESC"
        ).bind(user.id);
  const { results } = await stmt.all<any>();
  return c.json(
    (results || []).map((s) => ({
      id: s.id,
      name: s.name,
      created_at: s.created_at,
      assets: JSON.parse(s.assets_json || "[]"),
      weights: JSON.parse(s.weights_json || "{}"),
      summary: JSON.parse(s.summary_json || "{}"),
    }))
  );
});

fipRouter.get("/lab/scenarios/:id", async (c) => {
  const user = await requireUser(c);
  const id = parseInt(c.req.param("id"), 10);
  const s = await c.env.DB.prepare("SELECT * FROM lab_scenarios WHERE id = ?").bind(id).first<any>();
  if (!s) throw new HttpError(404, "Scenario not found");
  if (user.role !== "admin" && s.user_id !== user.id) {
    throw new HttpError(403, "無權存取他人的策略方案");
  }

  const settingsRaw = JSON.parse(s.settings_json || "{}");
  const mcSettings: Record<string, any> = {};
  for (const [k, v] of Object.entries(settingsRaw)) {
    if (!k.startsWith("_")) {
      mcSettings[k] = v;
    }
  }
  const parsedChart = JSON.parse(s.chart_json || "[]");
  const chartData = Array.isArray(parsedChart) ? parsedChart : [];

  return c.json({
    id: s.id,
    name: s.name,
    created_at: s.created_at,
    assets: JSON.parse(s.assets_json || "[]"),
    weights: JSON.parse(s.weights_json || "{}"),
    mc_settings: mcSettings,
    settings: settingsRaw,
    summary: JSON.parse(s.summary_json || "{}"),
    chart_data: chartData,
    chart: chartData,
    ilp_enabled: settingsRaw._ilp_enabled ?? null,
    ilp_config: settingsRaw._ilp_config ?? null,
    insurance_enabled: settingsRaw._ins_enabled ?? null,
    insurance_plan: settingsRaw._ins_plan ?? null,
    insurance_alpha_low: settingsRaw._ins_alpha_low ?? null,
    insurance_alpha_high: settingsRaw._ins_alpha_high ?? null,
  });
});

fipRouter.put("/lab/scenarios/:id", async (c) => {
  const user = await requireUser(c);
  const id = parseInt(c.req.param("id"), 10);
  const existing = await c.env.DB.prepare("SELECT user_id FROM lab_scenarios WHERE id = ?").bind(id).first<{ user_id: string | null }>();
  if (!existing) throw new HttpError(404, "Scenario not found");
  if (user.role !== "admin" && existing.user_id !== user.id) {
    throw new HttpError(403, "無權修改他人的策略方案");
  }
  const body = await c.req.json<any>();
  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.name !== undefined) {
    const newName = String(body.name || "").trim();
    if (!newName) throw new HttpError(400, "Name is required");
    updates.push("name = ?");
    values.push(newName);
  }
  if (body.assets !== undefined) {
    updates.push("assets_json = ?");
    values.push(JSON.stringify(body.assets));
  }
  if (body.custom_weights !== undefined || body.weights !== undefined) {
    updates.push("weights_json = ?");
    values.push(JSON.stringify(body.custom_weights || body.weights));
  }
  if (body.mc_settings !== undefined || body.settings !== undefined) {
    updates.push("settings_json = ?");
    values.push(JSON.stringify(body.mc_settings || body.settings));
  }
  if (body.summary !== undefined) {
    updates.push("summary_json = ?");
    values.push(JSON.stringify(body.summary));
  }
  if (body.chart_data !== undefined || body.chart !== undefined) {
    updates.push("chart_json = ?");
    values.push(JSON.stringify(body.chart_data || body.chart));
  }

  if (updates.length > 0) {
    values.push(id);
    await c.env.DB.prepare(`UPDATE lab_scenarios SET ${updates.join(", ")} WHERE id = ?`)
      .bind(...values)
      .run();
  }
  return c.json({ success: true, id, message: "方案名称已更新" });
});

fipRouter.post("/lab/scenarios/save", async (c) => {
  const user = await requireUser(c);
  const body = await c.req.json<any>();
  const name = String(body.name || "未命名方案").trim();
  const now = new Date().toISOString();

  const rawSettings = body.mc_settings || body.settings || {};
  const settingsExt: Record<string, any> = { ...rawSettings };
  if (body.ilp_enabled !== undefined && body.ilp_enabled !== null) {
    settingsExt._ilp_enabled = body.ilp_enabled;
    settingsExt._ilp_config = body.ilp_config ?? null;
  }
  if (body.insurance_enabled !== undefined && body.insurance_enabled !== null) {
    settingsExt._ins_enabled = body.insurance_enabled;
    settingsExt._ins_plan = body.insurance_plan ?? null;
    settingsExt._ins_alpha_low = body.insurance_alpha_low ?? null;
    settingsExt._ins_alpha_high = body.insurance_alpha_high ?? null;
  }

  const weights = body.custom_weights || body.weights || {};
  const chartData = body.chart_data || body.chart || [];

  const res = await c.env.DB.prepare(
    `INSERT INTO lab_scenarios (name, assets_json, weights_json, settings_json, summary_json, chart_json, user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      name,
      JSON.stringify(body.assets || []),
      JSON.stringify(weights),
      JSON.stringify(settingsExt),
      JSON.stringify(body.summary || {}),
      JSON.stringify(Array.isArray(chartData) ? chartData : []),
      user.id,
      now
    )
    .run();

  return c.json({ success: true, id: res.meta.last_row_id, name, message: "方案已保存成功" });
});

fipRouter.delete("/lab/scenarios/:id", async (c) => {
  const user = await requireUser(c);
  const id = parseInt(c.req.param("id"), 10);
  const existing = await c.env.DB.prepare("SELECT user_id FROM lab_scenarios WHERE id = ?").bind(id).first<{ user_id: string | null }>();
  if (!existing) throw new HttpError(404, "Scenario not found");
  if (user.role !== "admin" && existing.user_id !== user.id) {
    throw new HttpError(403, "無權刪除他人的策略方案");
  }
  await c.env.DB.prepare("DELETE FROM lab_scenarios WHERE id = ?").bind(id).run();
  return c.json({ success: true, id });
});

// ── Rebalance ─────────────────────────────────────────────────────────────
// 迁移到 Worker 时整段遗漏：前端 PortfolioView 的按钮与 RebalanceModal 两步流程
// 一直存在，但四个端点全部 404。以下按旧 Python fip_router.py 的契约补齐。
fipRouter.get("/portfolios/current_weights/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  await assertPortfolioRead(c, id);
  const engine = new PortfolioEngine(c.env.DB, id);
  await engine.init();
  return c.json(await engine.getCurrentWeights(c.req.query("as_of_date") || undefined));
});

fipRouter.get("/portfolios/rebalance/preview/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  await assertPortfolioRead(c, id);
  const engine = new PortfolioEngine(c.env.DB, id);
  await engine.init();
  const wrapperQuery = c.req.query("wrapper_type");
  let wrapperType: "AIA_TMP2" | "BROKER_ETF" | "HYBRID" | undefined =
    wrapperQuery === "AIA_TMP2" || wrapperQuery === "BROKER_ETF" || wrapperQuery === "HYBRID"
      ? wrapperQuery
      : undefined;
  if (!wrapperType) {
    try {
      const cfg = await c.env.DB.prepare("SELECT wrapper_type FROM portfolio_monitoring_config WHERE portfolio_id = ?")
        .bind(id)
        .first<{ wrapper_type: string }>();
      if (cfg?.wrapper_type === "AIA_TMP2" || cfg?.wrapper_type === "BROKER_ETF" || cfg?.wrapper_type === "HYBRID") {
        wrapperType = cfg.wrapper_type;
      }
    } catch {
      // ignore if table not migrated
    }
  }
  return c.json(await engine.getRebalancePreview(c.req.query("as_of_date") || undefined, { wrapperType }));
});

fipRouter.post("/portfolios/rebalance/:id", async (c) => {
  const user = await requireUser(c);
  const id = parseInt(c.req.param("id"), 10);
  await assertPortfolioWrite(c, user, id);
  const body = await c.req.json<any>().catch(() => ({}));
  const engine = new PortfolioEngine(c.env.DB, id);
  await engine.init();
  const result = await engine.executeRebalance(body?.as_of_date || undefined, {
    wrapperType: body?.wrapper_type,
    batchId: body?.batch_id,
    notes: body?.notes,
  });
  await writeAuditLog(c.env.DB, {
    userId: user.id,
    action: "portfolio.rebalance",
    resourceType: "portfolio",
    resourceId: id,
    detail: { as_of_date: body?.as_of_date || null, batch_id: result.batch_id },
  });
  return c.json({ status: "success", ...result });
});

fipRouter.post("/portfolios/rebalance/undo/:id", async (c) => {
  const user = await requireUser(c);
  const id = parseInt(c.req.param("id"), 10);
  await assertPortfolioWrite(c, user, id);

  let deleted = 0;
  let undoDate: string | null = null;
  let undoBatchId: string | null = null;

  try {
    const batchRow = await c.env.DB.prepare(
      "SELECT batch_id, date FROM transactions WHERE portfolio_id = ? AND batch_id IS NOT NULL ORDER BY date DESC, id DESC LIMIT 1"
    )
      .bind(id)
      .first<{ batch_id: string | null; date: string | null }>();
    if (batchRow?.batch_id) {
      undoBatchId = batchRow.batch_id;
      undoDate = batchRow.date;
      const res = await c.env.DB.prepare("DELETE FROM transactions WHERE portfolio_id = ? AND batch_id = ?")
        .bind(id, undoBatchId)
        .run();
      deleted = res.meta.changes ?? 0;
      try {
        await c.env.DB.prepare(
          "UPDATE portfolio_rebalance_tickets SET status = 'CANCELLED' WHERE portfolio_id = ? AND batch_id = ?"
        )
          .bind(id, undoBatchId)
          .run();
      } catch {
        // ignore
      }
    }
  } catch {
    // fallback if batch_id column doesn't exist yet
  }

  if (!undoBatchId) {
    const row = await c.env.DB.prepare(
      "SELECT MAX(date) as d FROM transactions WHERE portfolio_id = ? AND type IN ('BUY', 'SELL')"
    )
      .bind(id)
      .first<{ d: string | null }>();
    if (!row?.d) return c.json({ status: "success", deleted: 0 });
    undoDate = row.d;
    const res = await c.env.DB.prepare(
      "DELETE FROM transactions WHERE portfolio_id = ? AND date = ? AND type IN ('BUY', 'SELL')"
    )
      .bind(id, row.d)
      .run();
    deleted = res.meta.changes ?? 0;
  }

  await PortfolioEngine.clearStatsCache(c.env.DB, id);
  await writeAuditLog(c.env.DB, {
    userId: user.id,
    action: "portfolio.rebalance_undo",
    resourceType: "portfolio",
    resourceId: id,
    detail: { date: undoDate, batch_id: undoBatchId, deleted },
  });
  return c.json({ status: "success", deleted, date: undoDate, batch_id: undoBatchId });
});

// ── ILP Config ─────────────────────────────────────────────────────────────
const ILP_DEFAULTS = {
  age: 35,
  gender: "male" as const,
  smoker: false,
  premium: 100000,
  currency: "USD",
  enrollment_rate: null as number | null,
};

function normalizeIlpGender(raw: unknown, defaultVal: "male" | "female" = "male"): "male" | "female" {
  if (raw === undefined || raw === null || String(raw).trim() === "") return defaultVal;
  const val = String(raw).trim().toLowerCase();
  if (val === "male" || val === "m" || val === "男") return "male";
  if (val === "female" || val === "f" || val === "女") return "female";
  throw new HttpError(400, "性別 必須為 male / female (或 M / F)");
}

let portfolioIlpSchemaReady = false;
async function ensurePortfolioIlpTable(db: D1Database) {
  if (portfolioIlpSchemaReady) return;
  try {
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS portfolio_ilp_config (
          portfolio_id INTEGER NOT NULL PRIMARY KEY,
          enabled INTEGER NOT NULL DEFAULT 0,
          age INTEGER NOT NULL DEFAULT 35,
          gender TEXT NOT NULL DEFAULT 'male',
          smoker INTEGER NOT NULL DEFAULT 0,
          premium REAL NOT NULL DEFAULT 0,
          currency TEXT NOT NULL DEFAULT 'USD',
          enrollment_rate REAL,
          updated_at TEXT DEFAULT (CURRENT_TIMESTAMP)
        )`
      )
      .run();
    portfolioIlpSchemaReady = true;
  } catch {
    // Graceful no-op in mock D1 test environments
  }
}

async function readPortfolioIlpConfig(db: D1Database, portfolioId: number) {
  await ensurePortfolioIlpTable(db);
  try {
    const row = await db
      .prepare("SELECT * FROM portfolio_ilp_config WHERE portfolio_id = ?")
      .bind(portfolioId)
      .first<any>();
    if (!row) {
      return {
        portfolio_id: portfolioId,
        configured: false,
        enabled: false,
        age: 35,
        gender: "male" as const,
        smoker: false,
        premium: 0,
        currency: "USD",
        enrollment_rate: null as number | null,
        updated_at: null as string | null,
      };
    }
    return {
      portfolio_id: portfolioId,
      configured: true,
      enabled: Boolean(row.enabled),
      age: Number(row.age ?? 35),
      gender: normalizeIlpGender(row.gender),
      smoker: Boolean(row.smoker),
      premium: Number(row.premium ?? 0),
      currency: row.currency || "USD",
      enrollment_rate: row.enrollment_rate != null ? Number(row.enrollment_rate) : null,
      updated_at: row.updated_at || null,
    };
  } catch {
    return {
      portfolio_id: portfolioId,
      configured: false,
      enabled: false,
      age: 35,
      gender: "male" as const,
      smoker: false,
      premium: 0,
      currency: "USD",
      enrollment_rate: null as number | null,
      updated_at: null as string | null,
    };
  }
}

async function writePortfolioIlpConfig(
  db: D1Database,
  portfolioId: number,
  rawBody: Record<string, unknown>
) {
  await ensurePortfolioIlpTable(db);
  const age = Math.round(optFiniteNumber(rawBody, "age", 35, { min: 0, max: 80, label: "受保人年齡" }));
  const gender = normalizeIlpGender(rawBody.gender);
  const smoker = Boolean(rawBody.smoker);
  const premium = optFiniteNumber(rawBody, "premium", 0, { min: 0, label: "整付保費" });
  const currency = optCurrency(rawBody, "currency", "USD");
  const rawEnroll = rawBody.enrollment_rate;
  const enrollmentRate =
    rawEnroll === null || rawEnroll === undefined || rawEnroll === ""
      ? null
      : optFiniteNumber(rawBody, "enrollment_rate", 0, { min: 0, max: 1, label: "開戶獎賞率" });
  const enabled = rawBody.enabled !== undefined ? Boolean(rawBody.enabled) : true;
  const nowIso = new Date().toISOString();

  await db
    .prepare(
      `INSERT OR REPLACE INTO portfolio_ilp_config
         (portfolio_id, enabled, age, gender, smoker, premium, currency, enrollment_rate, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      portfolioId,
      enabled ? 1 : 0,
      age,
      gender,
      smoker ? 1 : 0,
      premium,
      currency,
      enrollmentRate,
      nowIso
    )
    .run();

  return {
    portfolio_id: portfolioId,
    configured: true,
    enabled,
    age,
    gender,
    smoker,
    premium,
    currency,
    enrollment_rate: enrollmentRate,
    updated_at: nowIso,
  };
}

fipRouter.get("/portfolios/:id/ilp-config", async (c) => {
  const id = parsePositiveIntId(c.req.param("id"), "組合 ID");
  await assertPortfolioRead(c, id);
  return c.json(await readPortfolioIlpConfig(c.env.DB, id));
});

fipRouter.put("/portfolios/:id/ilp-config", async (c) => {
  const user = await requireUser(c);
  const id = parsePositiveIntId(c.req.param("id"), "組合 ID");
  await assertPortfolioWrite(c, user, id);
  const body = await parseJsonBody(c, (raw) => raw as Record<string, unknown>);
  const saved = await writePortfolioIlpConfig(c.env.DB, id, body);
  await writeAuditLog(c.env.DB, {
    userId: user.id,
    action: "portfolio.ilp_config_update",
    resourceType: "portfolio",
    resourceId: id,
    detail: saved,
  });
  return c.json({ success: true, ...saved });
});

async function readIlpConfig(db: D1Database, userId: string) {
  const row = await db.prepare("SELECT * FROM user_ilp_config WHERE user_id = ?").bind(userId).first<any>();
  if (!row) return { ...ILP_DEFAULTS };
  return {
    age: Number(row.age ?? 35),
    gender: normalizeIlpGender(row.gender),
    smoker: Boolean(row.smoker),
    premium: Number(row.premium ?? 0),
    currency: row.currency || "USD",
    enrollment_rate: row.enrollment_rate != null ? Number(row.enrollment_rate) : null,
  };
}

async function writeIlpConfig(db: D1Database, userId: string, rawBody: Record<string, unknown>) {
  const age = Math.round(optFiniteNumber(rawBody, "age", 35, { min: 0, max: 80, label: "年齡" }));
  const gender = normalizeIlpGender(rawBody.gender);
  const premium = optFiniteNumber(rawBody, "premium", 100000, { min: 0, label: "保費" });
  const currency = optCurrency(rawBody, "currency", "USD");
  const rawEnroll = rawBody.enrollment_rate;
  const enrollmentRate =
    rawEnroll === null || rawEnroll === undefined || rawEnroll === ""
      ? null
      : optFiniteNumber(rawBody, "enrollment_rate", 0.05, { min: 0, max: 1, label: "費率" });
  await db
    .prepare(
      `INSERT OR REPLACE INTO user_ilp_config (user_id, age, gender, smoker, premium, currency, enrollment_rate, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      userId,
      age,
      gender,
      rawBody.smoker ? 1 : 0,
      premium,
      currency,
      enrollmentRate,
      new Date().toISOString()
    )
    .run();
}

/** 顾问只能操作分配给自己的客户；admin 不限。 */
async function assertAdvisorAccess(c: any, user: any, targetUserId: string) {
  if (user.role === "admin") return;
  if (user.role !== "advisor") throw new HttpError(403, "僅顧問或管理員可存取客戶配置");
  const row = await c.env.DB.prepare(
    "SELECT 1 FROM advisor_clients WHERE advisor_id = ? AND client_id = ? AND is_active = 1"
  )
    .bind(user.id, targetUserId)
    .first();
  if (!row) throw new HttpError(403, "該客戶不在你的服務範圍內");
}

fipRouter.get("/ilp/config", async (c) => {
  const user = await requireUser(c);
  return c.json(await readIlpConfig(c.env.DB, user.id));
});

fipRouter.put("/ilp/config", async (c) => {
  const user = await requireUser(c);
  const body = await c.req.json<any>();
  await writeIlpConfig(c.env.DB, user.id, body);
  return c.json({ success: true });
});

// 顾问 / Admin 代客读写（前端 ILPSettingsModal 在选中客户时走这条路径）
fipRouter.get("/ilp/config/:target_user_id", async (c) => {
  const user = await requireUser(c);
  const targetUserId = c.req.param("target_user_id");
  await assertAdvisorAccess(c, user, targetUserId);
  return c.json(await readIlpConfig(c.env.DB, targetUserId));
});

fipRouter.put("/ilp/config/:target_user_id", async (c) => {
  const user = await requireUser(c);
  const targetUserId = c.req.param("target_user_id");
  await assertAdvisorAccess(c, user, targetUserId);
  const body = await c.req.json<any>();
  await writeIlpConfig(c.env.DB, targetUserId, body);
  await writeAuditLog(c.env.DB, {
    userId: user.id,
    action: "ilp.advisor_update",
    resourceType: "user_ilp_config",
    resourceId: targetUserId,
  });
  return c.json({ status: "success", success: true, message: `客戶 ${targetUserId} 的 ILP 配置已更新` });
});
