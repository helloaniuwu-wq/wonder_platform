import { Hono } from "hono";
import { PortfolioEngine } from "../services/fip/portfolioEngine";
import { parseInsurancePlan } from "../services/fip/insuranceParser";
import { generateWealthReportDocx } from "../services/fip/reportGenerator";
import { StrategyLab } from "../services/fip/strategyLab";
import { Env, Variables } from "../types";
import { generateUuid, getOptionalUser, HttpError, requireUser } from "../utils/auth";

export const fipRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

// ── Portfolios List & Management ───────────────────────────────────────────
fipRouter.get("/portfolios", async (c) => {
  const user = await getOptionalUser(c);
  let sql = "SELECT * FROM portfolios WHERE is_public = 1";
  const params: unknown[] = [];

  if (user) {
    if (user.role === "admin") {
      sql = "SELECT * FROM portfolios";
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
  const body = await c.req.json<any>();
  const name = String(body.name || "").trim();
  if (!name) throw new HttpError(400, "請輸入組合名稱");

  const baseCurrency = String(body.base_currency || "USD").toUpperCase();
  const divStrategy = String(body.dividend_strategy || "CASH").toUpperCase();
  const targetAllocations = body.target_allocations ? JSON.stringify(body.target_allocations) : "{}";
  const now = new Date().toISOString();

  const maxOrder = await c.env.DB.prepare("SELECT MAX(sort_order) as m FROM portfolios").first<{ m: number }>();
  const sortOrder = (maxOrder?.m || 0) + 1;

  const res = await c.env.DB.prepare(
    `INSERT INTO portfolios (name, base_currency, dividend_strategy, target_allocations, user_id, is_public, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
  )
    .bind(name, baseCurrency, divStrategy, targetAllocations, user.id, sortOrder, now)
    .run();

  const id = res.meta.last_row_id;
  return c.json({ id, name, base_currency: baseCurrency, dividend_strategy: divStrategy });
});

fipRouter.get("/portfolios/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const row = await c.env.DB.prepare("SELECT * FROM portfolios WHERE id = ?").bind(id).first<any>();
  if (!row) throw new HttpError(404, "組合不存在");

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
  const id = parseInt(c.req.param("id"), 10);
  const body = await c.req.json<any>();

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

  await c.env.DB.prepare("DELETE FROM transactions WHERE portfolio_id = ?").bind(id).run();
  await c.env.DB.prepare("DELETE FROM manual_dividends WHERE portfolio_id = ?").bind(id).run();
  await c.env.DB.prepare("DELETE FROM portfolio_stats_cache WHERE portfolio_id = ?").bind(id).run();
  await c.env.DB.prepare("DELETE FROM portfolios WHERE id = ?").bind(id).run();

  return c.json({ success: true, id });
});

fipRouter.post("/portfolios/reorder", async (c) => {
  const user = await requireUser(c);
  const body = await c.req.json<{ ids: number[] }>();
  if (Array.isArray(body.ids)) {
    for (let i = 0; i < body.ids.length; i++) {
      await c.env.DB.prepare("UPDATE portfolios SET sort_order = ? WHERE id = ?")
        .bind(i + 1, body.ids[i])
        .run();
    }
  }
  return c.json({ success: true });
});

// ── Portfolio Report & Stats ───────────────────────────────────────────────
fipRouter.get("/report/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
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
  const taxRate = parseFloat(c.req.query("tax_rate") || "0.0") || 0.0;
  const drip = c.req.query("drip") === "true";

  const engine = new PortfolioEngine(c.env.DB, id);
  await engine.init();
  const proj = await engine.getDividendProjections(taxRate, drip);

  return c.json(proj);
});

fipRouter.get("/portfolios/dividends/export/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const engine = new PortfolioEngine(c.env.DB, id);
  await engine.init();
  const list = await engine.getDividendDetails();

  return c.json(list);
});

fipRouter.post("/portfolios/dividend/manual/:id", async (c) => {
  const user = await requireUser(c);
  const id = parseInt(c.req.param("id"), 10);
  const body = await c.req.json<any>();

  const isin = String(body.isin || "").trim();
  const date = String(body.date || new Date().toISOString().slice(0, 10)).trim();
  const amount = Number(body.amount_per_share || 0);
  const currency = String(body.currency || "USD").toUpperCase();

  await c.env.DB.prepare(
    "INSERT INTO manual_dividends (portfolio_id, isin, date, amount_per_share, currency) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(id, isin, date, amount, currency)
    .run();

  return c.json({ success: true });
});

fipRouter.delete("/dividends/manual/:div_id", async (c) => {
  const user = await requireUser(c);
  const divId = parseInt(c.req.param("div_id"), 10);

  await c.env.DB.prepare("DELETE FROM manual_dividends WHERE id = ?").bind(divId).run();
  return c.json({ success: true });
});

fipRouter.get("/heartbeat/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
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
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM transactions WHERE portfolio_id = ? ORDER BY date DESC, id DESC"
  )
    .bind(id)
    .all<any>();

  return c.json(results || []);
});

fipRouter.post("/portfolios/transactions/:id", async (c) => {
  const user = await requireUser(c);
  const id = parseInt(c.req.param("id"), 10);
  const body = await c.req.json<any>();

  const date = body.date || new Date().toISOString().slice(0, 10);
  const isin = String(body.isin || "").trim();
  const type = String(body.type || "BUY").toUpperCase();
  const shares = Number(body.shares || 0);
  const price = Number(body.price || 0);

  await c.env.DB.prepare(
    "INSERT INTO transactions (portfolio_id, date, isin, type, shares, price) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(id, date, isin, type, shares, price)
    .run();

  return c.json({ success: true });
});

fipRouter.delete("/portfolios/transactions/:tx_id", async (c) => {
  const user = await requireUser(c);
  const txId = parseInt(c.req.param("tx_id"), 10);
  await c.env.DB.prepare("DELETE FROM transactions WHERE id = ?").bind(txId).run();
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
    },
    Number(body.risk_free_rate || 0.04)
  );

  return c.json(result);
});

fipRouter.post("/lab/generate-report", async (c) => {
  const body = await c.req.json<any>();
  const docxBytes = await generateWealthReportDocx(body, c.env);

  return new Response(docxBytes, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="Wealth_Report_${new Date().toISOString().slice(0, 10)}.docx"`,
    },
  });
});

// ── Lab Scenarios ──────────────────────────────────────────────────────────
fipRouter.get("/lab/scenarios", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM lab_scenarios ORDER BY created_at DESC").all<any>();
  return c.json(
    (results || []).map((s) => ({
      id: s.id,
      name: s.name,
      created_at: s.created_at,
      assets: JSON.parse(s.assets_json || "[]"),
      weights: JSON.parse(s.weights_json || "{}"),
      settings: JSON.parse(s.settings_json || "{}"),
      summary: JSON.parse(s.summary_json || "{}"),
      chart: JSON.parse(s.chart_json || "{}"),
    }))
  );
});

fipRouter.get("/lab/scenarios/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const s = await c.env.DB.prepare("SELECT * FROM lab_scenarios WHERE id = ?").bind(id).first<any>();
  if (!s) throw new HttpError(404, "Scenario not found");
  return c.json({
    id: s.id,
    name: s.name,
    created_at: s.created_at,
    assets: JSON.parse(s.assets_json || "[]"),
    weights: JSON.parse(s.weights_json || "{}"),
    settings: JSON.parse(s.settings_json || "{}"),
    summary: JSON.parse(s.summary_json || "{}"),
    chart: JSON.parse(s.chart_json || "{}"),
  });
});

fipRouter.put("/lab/scenarios/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const body = await c.req.json<any>();
  await c.env.DB.prepare(
    `UPDATE lab_scenarios SET name = ?, assets_json = ?, weights_json = ?, settings_json = ?, summary_json = ?, chart_json = ? WHERE id = ?`
  )
    .bind(
      String(body.name || "未命名方案"),
      JSON.stringify(body.assets || []),
      JSON.stringify(body.weights || {}),
      JSON.stringify(body.settings || {}),
      JSON.stringify(body.summary || {}),
      JSON.stringify(body.chart || {}),
      id
    )
    .run();
  return c.json({ success: true, id });
});

fipRouter.post("/lab/scenarios/save", async (c) => {
  const user = await getOptionalUser(c);
  const body = await c.req.json<any>();
  const name = String(body.name || "未命名方案");
  const now = new Date().toISOString();

  const res = await c.env.DB.prepare(
    `INSERT INTO lab_scenarios (name, assets_json, weights_json, settings_json, summary_json, chart_json, user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      name,
      JSON.stringify(body.assets || []),
      JSON.stringify(body.weights || {}),
      JSON.stringify(body.settings || {}),
      JSON.stringify(body.summary || {}),
      JSON.stringify(body.chart || {}),
      user?.id || null,
      now
    )
    .run();

  return c.json({ success: true, id: res.meta.last_row_id });
});

fipRouter.delete("/lab/scenarios/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  await c.env.DB.prepare("DELETE FROM lab_scenarios WHERE id = ?").bind(id).run();
  return c.json({ success: true, id });
});

// ── ILP Config ─────────────────────────────────────────────────────────────
fipRouter.get("/ilp/config", async (c) => {
  const user = await requireUser(c);
  const row = await c.env.DB.prepare("SELECT * FROM user_ilp_config WHERE user_id = ?").bind(user.id).first<any>();

  if (!row) {
    return c.json({
      age: 35,
      gender: "M",
      smoker: 0,
      premium: 100000,
      currency: "USD",
      enrollment_rate: 0.05,
    });
  }

  return c.json({
    age: row.age,
    gender: row.gender,
    smoker: row.smoker,
    premium: row.premium,
    currency: row.currency,
    enrollment_rate: row.enrollment_rate,
  });
});

fipRouter.put("/ilp/config", async (c) => {
  const user = await requireUser(c);
  const body = await c.req.json<any>();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT OR REPLACE INTO user_ilp_config (user_id, age, gender, smoker, premium, currency, enrollment_rate, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      user.id,
      Number(body.age || 35),
      body.gender || "M",
      body.smoker ? 1 : 0,
      Number(body.premium || 100000),
      body.currency || "USD",
      Number(body.enrollment_rate || 0.05),
      now
    )
    .run();

  return c.json({ success: true });
});
