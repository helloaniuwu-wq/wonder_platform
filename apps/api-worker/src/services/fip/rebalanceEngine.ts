import type { Env } from "../../types";
import { writeAuditLog } from "../../utils/audit";
import { generateUuid } from "../../utils/auth";
import { callLlmChat } from "../llm";
import { formatMacroPromptBlock } from "../macroStore";
import { loadQuantCatalog, QuantFundCatalogRow } from "../quantStore";
import { getAssetMetadata, getFxRate, getMarketData, resolveAssetCurrency } from "./dataProvider";
import { PortfolioEngine } from "./portfolioEngine";
import { ensureMonitoringSchema } from "./monitoringSchema";
import { evaluatePortfolioHealth, PortfolioHealthReport, WrapperType } from "./portfolioMonitor";

export interface AiaSwitchLeg {
  isin: string;
  name: string;
  action: "SWITCH_OUT" | "SWITCH_IN" | "HOLD";
  current_weight_pct: number;
  target_weight_pct: number;
  delta_pct: number;
  estimated_amount_base: number;
  estimated_units: number | null;
}

export interface AiaSwitchOrderPayload {
  mode: "AIA_TMP2";
  total_nav_base: number;
  base_currency: string;
  switching_fee: number;
  min_allocation_rule_pct: number;
  settlement_notice: string;
  target_allocations_pct: Record<string, number>;
  legs: AiaSwitchLeg[];
}

export interface BrokerEtfTradeLeg {
  isin: string;
  name: string;
  action: "SELL" | "BUY";
  shares: number;
  price: number;
  currency: string;
  amount_local: number;
  amount_base: number;
  current_weight_pct: number;
  target_weight_pct: number;
  lot_size: number;
}

export interface BrokerEtfOrderPayload {
  mode: "BROKER_ETF";
  total_nav_base: number;
  base_currency: string;
  cash_balance_base: number;
  cash_buffer_pct: number;
  cash_buffer_reserved_base: number;
  estimated_remaining_cash_base: number;
  lot_size_notes: string[];
  target_allocations_pct: Record<string, number>;
  trades: BrokerEtfTradeLeg[];
}

/**
 * Normalize integer weights summing strictly to 100%, optionally enforcing AIA TMP2 >= 5% active minimum.
 */
export function normalizeWrapperPercentages(
  rawWeightsPct: Record<string, number>,
  minAllocationPct = 0
): Record<string, number> {
  const entries = Object.entries(rawWeightsPct)
    .map(([k, v]) => [k, Math.max(0, Number(v) || 0)] as [string, number])
    .filter(([, v]) => v > 0);

  if (entries.length === 0) return {};

  const totalRaw = entries.reduce((s, [, v]) => s + v, 0);
  if (totalRaw <= 0) return {};

  // First scale to sum ~100 and fold sub-minimum holdings into the largest weight
  let scaled = entries.map(([k, v]) => [k, (v / totalRaw) * 100] as [string, number]);
  if (minAllocationPct > 0) {
    scaled.sort((a, b) => b[1] - a[1]);
    const keep: Array<[string, number]> = [];
    let folded = 0;
    for (const [k, v] of scaled) {
      if (v >= minAllocationPct || keep.length === 0) {
        keep.push([k, v]);
      } else {
        folded += v;
      }
    }
    if (folded > 0 && keep.length > 0) {
      keep[0][1] += folded;
    }
    scaled = keep;
  }

  // Largest-remainder rounding to integer percentages totaling 100
  const sumAfter = scaled.reduce((s, [, v]) => s + v, 0);
  const floats = scaled.map(([k, v]) => {
    const exact = (v / sumAfter) * 100;
    const fl = Math.floor(exact);
    return { k, fl, rem: exact - fl };
  });
  let remainder = 100 - floats.reduce((s, x) => s + x.fl, 0);
  const byRem = [...floats].sort((a, b) => b.rem - a.rem);
  for (let i = 0; i < byRem.length && remainder > 0; i++) {
    byRem[i].fl += 1;
    remainder--;
  }

  const out: Record<string, number> = {};
  for (const x of floats) {
    if (x.fl > 0) out[x.k] = x.fl;
  }
  return out;
}

/**
 * Pure helper: Generate AIA 卓達智悅2 (TMP2) percentage fund-switch order.
 * Enforces: 0 switching fee, integer %, >= 5% minimum per selected fund, sum === 100%.
 */
export function buildAiaSwitchOrder(
  currentHoldings: Array<{ isin: string; name: string; market_value: number; price?: number }>,
  proposedWeightsPct: Record<string, number>,
  totalNavBase: number,
  baseCcy = "USD"
): AiaSwitchOrderPayload {
  const normalizedPct = normalizeWrapperPercentages(proposedWeightsPct, 5);
  const byIsin = new Map(currentHoldings.map((h) => [h.isin, h]));
  const allIsins = new Set<string>([...byIsin.keys(), ...Object.keys(normalizedPct)]);

  const legs: AiaSwitchLeg[] = [];
  for (const isin of allIsins) {
    if (isin.startsWith("CASH_")) continue;
    const cur = byIsin.get(isin);
    const curVal = cur?.market_value || 0;
    const curPct = totalNavBase > 0 ? Math.round((curVal / totalNavBase) * 1000) / 10 : 0;
    const targetPct = normalizedPct[isin] || 0;
    const deltaPct = Math.round((targetPct - curPct) * 10) / 10;
    const estAmount = Math.round(Math.abs(deltaPct / 100) * totalNavBase * 100) / 100;
    const px = cur?.price && cur.price > 0 ? cur.price : null;
    const estUnits = px ? Math.round((estAmount / px) * 10000) / 10000 : null;

    const action: AiaSwitchLeg["action"] =
      deltaPct <= -0.5 ? "SWITCH_OUT" : deltaPct >= 0.5 ? "SWITCH_IN" : "HOLD";

    legs.push({
      isin,
      name: cur?.name || isin,
      action,
      current_weight_pct: curPct,
      target_weight_pct: targetPct,
      delta_pct: deltaPct,
      estimated_amount_base: estAmount,
      estimated_units: estUnits,
    });
  }

  legs.sort((a, b) => {
    const order = { SWITCH_OUT: 0, SWITCH_IN: 1, HOLD: 2 };
    if (order[a.action] !== order[b.action]) return order[a.action] - order[b.action];
    return Math.abs(b.delta_pct) - Math.abs(a.delta_pct);
  });

  return {
    mode: "AIA_TMP2",
    total_nav_base: Math.round(totalNavBase * 100) / 100,
    base_currency: baseCcy,
    switching_fee: 0,
    min_allocation_rule_pct: 5,
    settlement_notice: "AIA 卓達智悅2 零轉換費，預計受理 1–2 工作日，基金結算生效 T+2~T+4。",
    target_allocations_pct: normalizedPct,
    legs,
  };
}

/**
 * Pure helper: Cash-first Brokerage ETF rebalance order (SELL first, reserve cash buffer, respect HK lot sizes).
 */
export function buildBrokerEtfOrder(
  currentHoldings: Array<{ isin: string; name: string; shares: number; market_value: number }>,
  proposedWeightsPct: Record<string, number>,
  cashBalanceBase: number,
  totalNavBase: number,
  baseCcy: string,
  prices: Record<string, number>,
  currencies: Record<string, string>,
  fxRates: Record<string, number>,
  options?: { cashBufferPct?: number; lotSizes?: Record<string, number>; allowFractionalUs?: boolean }
): BrokerEtfOrderPayload {
  const cashBufferPct = options?.cashBufferPct ?? 0.015;
  const allowFractionalUs = options?.allowFractionalUs ?? false;
  const normalizedPct = normalizeWrapperPercentages(proposedWeightsPct, 0);
  const byIsin = new Map(currentHoldings.map((h) => [h.isin, h]));
  const allIsins = Array.from(new Set<string>([...byIsin.keys(), ...Object.keys(normalizedPct)])).filter(
    (i) => !i.startsWith("CASH_")
  );

  const reservedBuffer = Math.round(totalNavBase * cashBufferPct * 100) / 100;
  const deployableTotal = Math.max(0, totalNavBase - reservedBuffer);
  const sells: BrokerEtfTradeLeg[] = [];
  const buyNeeds: Array<{
    isin: string;
    name: string;
    twPct: number;
    curW: number;
    desiredBuyBase: number;
    px: number;
    ccy: string;
    fx: number;
    lot: number;
  }> = [];
  const lotNotes: string[] = [];

  let totalSellProceeds = 0;

  for (const isin of allIsins) {
    const cur = byIsin.get(isin);
    const curShares = cur?.shares || 0;
    const curMv = cur?.market_value || 0;
    const curW = totalNavBase > 0 ? Math.round((curMv / totalNavBase) * 1000) / 10 : 0;
    const twPct = normalizedPct[isin] || 0;
    const px = prices[isin] || 0;
    const ccy = currencies[isin] || "USD";
    const fx = fxRates[isin] || 1;
    if (!(px > 0) || !(fx > 0)) continue;

    const isHk = isin.toUpperCase().endsWith(".HK");
    const lot = options?.lotSizes?.[isin] ?? (isHk ? 100 : allowFractionalUs ? 0.0001 : 1);
    const targetValBase = deployableTotal * (twPct / 100);
    const diffBase = targetValBase - curMv;

    if (diffBase < -10 && curShares > 0) {
      const rawSellShares = Math.min(curShares, Math.abs(diffBase) / (px * fx));
      const sellShares =
        lot >= 1
          ? Math.min(curShares, Math.floor(rawSellShares / lot) * lot)
          : Math.min(curShares, Math.round(rawSellShares * 10000) / 10000);
      if (sellShares > 0) {
        const amtLocal = sellShares * px;
        const amtBase = amtLocal * fx;
        totalSellProceeds += amtBase;
        sells.push({
          isin,
          name: cur?.name || isin,
          action: "SELL",
          shares: Math.round(sellShares * 10000) / 10000,
          price: Math.round(px * 10000) / 10000,
          currency: ccy,
          amount_local: Math.round(amtLocal * 100) / 100,
          amount_base: Math.round(amtBase * 100) / 100,
          current_weight_pct: curW,
          target_weight_pct: twPct,
          lot_size: lot,
        });
      }
    } else if (diffBase > 10 && twPct > 0) {
      buyNeeds.push({
        isin,
        name: cur?.name || isin,
        twPct,
        curW,
        desiredBuyBase: diffBase,
        px,
        ccy,
        fx,
        lot,
      });
    }
  }

  const availableBuyCash = Math.max(0, cashBalanceBase + totalSellProceeds - reservedBuffer);
  const totalDesiredBuy = buyNeeds.reduce((s, b) => s + b.desiredBuyBase, 0);
  const scaleFactor = totalDesiredBuy > 0 ? Math.min(1, availableBuyCash / totalDesiredBuy) : 0;
  const buys: BrokerEtfTradeLeg[] = [];
  let totalBuySpent = 0;

  for (const b of buyNeeds) {
    const budgetBase = b.desiredBuyBase * scaleFactor;
    const rawShares = budgetBase / (b.px * b.fx);
    const buyShares =
      b.lot >= 1 ? Math.floor(rawShares / b.lot) * b.lot : Math.round(rawShares * 10000) / 10000;
    if (b.lot >= 1 && buyShares === 0 && rawShares > 0) {
      lotNotes.push(`${b.isin} 不足 1 手 (${b.lot} 股)，該部分折算留存現金。`);
      continue;
    }
    if (buyShares <= 0) continue;
    const amtLocal = buyShares * b.px;
    const amtBase = amtLocal * b.fx;
    totalBuySpent += amtBase;
    buys.push({
      isin: b.isin,
      name: b.name,
      action: "BUY",
      shares: Math.round(buyShares * 10000) / 10000,
      price: Math.round(b.px * 10000) / 10000,
      currency: b.ccy,
      amount_local: Math.round(amtLocal * 100) / 100,
      amount_base: Math.round(amtBase * 100) / 100,
      current_weight_pct: b.curW,
      target_weight_pct: b.twPct,
      lot_size: b.lot,
    });
  }

  return {
    mode: "BROKER_ETF",
    total_nav_base: Math.round(totalNavBase * 100) / 100,
    base_currency: baseCcy,
    cash_balance_base: Math.round(cashBalanceBase * 100) / 100,
    cash_buffer_pct: Math.round(cashBufferPct * 1000) / 10,
    cash_buffer_reserved_base: reservedBuffer,
    estimated_remaining_cash_base: Math.round((cashBalanceBase + totalSellProceeds - totalBuySpent) * 100) / 100,
    lot_size_notes: lotNotes,
    target_allocations_pct: normalizedPct,
    trades: [...sells, ...buys],
  };
}

function pickCandidatePool(
  catalogRows: QuantFundCatalogRow[],
  wrapperType: WrapperType,
  existingIsins: Set<string>
): Array<{ lab_id: string; name: string; asset_class: string; quant_grade: string | null; sharpe_3y: number | null }> {
  const isAia = wrapperType === "AIA_TMP2";
  const eligible = catalogRows.filter((r) => {
    if (!r.is_trackable || (r.tags || []).includes("非推荐选择")) return false;
    const platformAia = (r.ilas_platform || "").startsWith("AIA");
    if (isAia && !platformAia) return false;
    if (!isAia && platformAia) return false;
    return r.quant_grade === "A" || r.quant_grade === "B" || existingIsins.has(r.aia_code || r.code);
  });

  eligible.sort((a, b) => (b.quant_score || 0) - (a.quant_score || 0));
  const picked: QuantFundCatalogRow[] = [];
  const byClass: Record<string, number> = {};
  for (const r of eligible) {
    const cls = r.asset_class || "其他";
    if ((byClass[cls] || 0) >= 4) continue;
    byClass[cls] = (byClass[cls] || 0) + 1;
    picked.push(r);
    if (picked.length >= 16) break;
  }

  return picked.map((r) => ({
    lab_id: isAia ? r.aia_code || r.code || r.slug : r.yahoo_ticker || r.code || r.slug,
    name: r.name,
    asset_class: r.asset_class,
    quant_grade: r.quant_grade,
    sharpe_3y: r.sharpe_3y,
  }));
}

function buildFallbackRebalanceTargets(
  health: PortfolioHealthReport,
  details: Array<{ isin: string; name: string; market_value: number }>,
  currentTargets: Record<string, number>,
  candidates: Array<{ lab_id: string; name: string; asset_class: string; quant_grade: string | null }>
): { weightsPct: Record<string, number>; rationale: string; triggerReason: string } {
  const basePct: Record<string, number> = {};
  if (Object.keys(currentTargets).length > 0) {
    for (const [k, v] of Object.entries(currentTargets)) {
      const n = Number(v || 0);
      if (n > 0) basePct[k] = n <= 1 ? n * 100 : n;
    }
  } else {
    for (const d of details) {
      if (d.isin.startsWith("CASH_") || d.market_value <= 0) continue;
      basePct[d.isin] = health.total_nav > 0 ? (d.market_value / health.total_nav) * 100 : 0;
    }
  }

  // Replace Grade D laggards if strong candidate exists in same class or core defensive sleeve
  const replacements: string[] = [];
  for (const lag of health.dna.laggard_holdings) {
    const w = basePct[lag.isin];
    if (!w || w <= 0) continue;
    const alt = candidates.find(
      (c) =>
        c.lab_id !== lag.isin &&
        !basePct[c.lab_id] &&
        (c.quant_grade === "A" || c.quant_grade === "B")
    );
    if (alt) {
      delete basePct[lag.isin];
      basePct[alt.lab_id] = (basePct[alt.lab_id] || 0) + w;
      replacements.push(`將劣後標的 ${lag.isin} 替換為優選標的 ${alt.lab_id} (${alt.name})`);
    }
  }

  // Macro hedge tilt: add 5-10% gold/commodity or defensive bond if macro triggers unhedged inflation/gold breakout
  const notes: string[] = [...replacements];
  if (
    (health.macro_risk_flags.includes("GOLD_HEDGE_MISSING") ||
      health.macro_risk_flags.includes("INFLATION_UNHEDGED_DURATION")) &&
    candidates.length > 0
  ) {
    const goldCand = candidates.find((c) => /GOLD|黃金|GLD/i.test(`${c.lab_id} ${c.name} ${c.asset_class}`));
    const hedgeSym = goldCand?.lab_id || (health.config.wrapper_type === "BROKER_ETF" ? "GLD" : null);
    if (hedgeSym && !basePct[hedgeSym]) {
      // Trim 5-10% from largest holding
      const top = Object.entries(basePct).sort((a, b) => b[1] - a[1])[0];
      if (top && top[1] > 15) {
        basePct[top[0]] -= 8;
        basePct[hedgeSym] = 8;
        notes.push(`因應黃金/通脹宏觀信號，從重倉 ${top[0]} 調撥 8% 至避險對沖資產 ${hedgeSym}`);
      }
    }
  }

  const minRule = health.config.wrapper_type === "AIA_TMP2" ? 5 : 0;
  const normalized = normalizeWrapperPercentages(basePct, minRule);
  const triggerParts: string[] = [];
  if (health.drifted_assets.length > 0) {
    triggerParts.push(`資產權重偏離超限 (最大偏離 ${(health.max_asset_drift * 100).toFixed(1)}%)`);
  }
  if (health.macro_risk_flags.length > 0) {
    triggerParts.push(`觸發信號: ${health.macro_risk_flags.join(", ")}`);
  }
  const triggerReason = triggerParts.join("；") || "定期組合再評估與偏離回歸校準";
  const rationale =
    notes.length > 0
      ? `系統定量規則再評估：${notes.join("；")}，同時將其餘持倉校準回目標策略中樞。`
      : `當前組合目標權重整體穩健，按既定 IPS 紀律執行回歸再平衡以鎖定紀律收益並控制偏離度。`;

  return { weightsPct: normalized, rationale, triggerReason };
}

async function resolveCashBalanceBase(
  db: D1Database,
  cashBalances: Record<string, number>,
  baseCcy: string
): Promise<number> {
  let cashBalanceBase = 0;
  for (const [cIsin, bal] of Object.entries(cashBalances)) {
    const ccy = cIsin.replace("CASH_", "");
    const fx = ccy !== baseCcy ? await getFxRate(db, ccy, baseCcy) : 1.0;
    cashBalanceBase += bal * fx;
  }
  return cashBalanceBase;
}

async function buildWrapperOrderForHoldings(
  db: D1Database,
  details: Array<{ isin: string; name: string; shares: number; market_value: number; price: number }>,
  cashBalanceBase: number,
  totalNavBase: number,
  baseCcy: string,
  wrapperType: WrapperType,
  proposedWeightsPct: Record<string, number>
) {
  const existingSet = new Set(details.map((d) => d.isin).filter((i) => !i.startsWith("CASH_")));
  const targetIsins = Array.from(
    new Set([...existingSet, ...Object.keys(proposedWeightsPct)])
  ).filter((i) => !i.startsWith("CASH_"));
  const prices: Record<string, number> = {};
  const currencies: Record<string, string> = {};
  const fxRates: Record<string, number> = {};
  const namesMap: Record<string, string> = {};

  for (const d of details) {
    if (!d.isin.startsWith("CASH_")) namesMap[d.isin] = d.name;
  }

  await Promise.all(
    targetIsins.map(async (isin) => {
      try {
        const md = await getMarketData(db, isin);
        const ccy = md.currency || (await resolveAssetCurrency(db, isin));
        currencies[isin] = ccy;
        fxRates[isin] = ccy !== baseCcy ? await getFxRate(db, ccy, baseCcy) : 1.0;
        prices[isin] = md.price > 0 ? md.price : 100.0;
        if (!namesMap[isin]) {
          const meta = await getAssetMetadata(db, isin);
          namesMap[isin] = meta.name || md.name || isin;
        }
      } catch {
        currencies[isin] = baseCcy;
        fxRates[isin] = 1.0;
        prices[isin] = 100.0;
      }
    })
  );

  const enrichedHoldings = details.map((d) => ({
    ...d,
    name: namesMap[d.isin] || d.name,
    price: prices[d.isin] ? prices[d.isin] * (fxRates[d.isin] || 1) : d.price,
  }));

  const orderPayload =
    wrapperType === "AIA_TMP2"
      ? buildAiaSwitchOrder(enrichedHoldings, proposedWeightsPct, totalNavBase, baseCcy)
      : buildBrokerEtfOrder(
          enrichedHoldings,
          proposedWeightsPct,
          cashBalanceBase,
          totalNavBase,
          baseCcy,
          prices,
          currencies,
          fxRates
        );

  if (orderPayload.mode === "AIA_TMP2") {
    for (const leg of orderPayload.legs) {
      if (namesMap[leg.isin]) leg.name = namesMap[leg.isin];
    }
  } else {
    for (const tr of orderPayload.trades) {
      if (namesMap[tr.isin]) tr.name = namesMap[tr.isin];
    }
  }

  const proposedDecimal: Record<string, number> = {};
  for (const [k, pct] of Object.entries(orderPayload.target_allocations_pct)) {
    proposedDecimal[k] = Math.round((pct / 100) * 10000) / 10000;
  }
  return { orderPayload, proposedDecimal };
}

export async function reevaluatePortfolioWithAI(
  env: Env,
  db: D1Database,
  portfolioId: number,
  user: { id: string; role: string },
  options?: { wrapperOverride?: WrapperType; triggerReason?: string }
) {
  await ensureMonitoringSchema(db);
  const health = await evaluatePortfolioHealth(db, portfolioId, { persist: true });
  const wrapperType: WrapperType = options?.wrapperOverride || health.config.wrapper_type;
  health.config.wrapper_type = wrapperType;

  const engine = new PortfolioEngine(db, portfolioId);
  await engine.init();
  const navData = await engine.calculateNav();
  const { cashBalances } = await engine.getCurrentPortfolio();
  const baseCcy = engine.meta.base_currency || "USD";

  const cashBalanceBase = await resolveCashBalanceBase(db, cashBalances, baseCcy);

  const existingSet = new Set(navData.details.map((d) => d.isin).filter((i) => !i.startsWith("CASH_")));
  const catalog = await loadQuantCatalog(db);
  const candidatePool = pickCandidatePool(catalog.rows, wrapperType, existingSet);
  const allowedSymbols = new Set<string>([...existingSet, ...candidatePool.map((c) => c.lab_id)]);
  if (wrapperType === "BROKER_ETF") {
    for (const sym of ["SPY", "VTI", "QQQ", "VYM", "TLT", "IEF", "SHY", "BIL", "GLD", "DBC", "2800.HK"]) {
      allowedSymbols.add(sym);
    }
  }

  const fallback = buildFallbackRebalanceTargets(health, navData.details, engine.meta.target_allocations, candidatePool);
  let proposedWeightsPct = fallback.weightsPct;
  let aiAnalysis = fallback.rationale;
  let triggerReason = options?.triggerReason || fallback.triggerReason;
  let aiProvider = "fallback_rule";
  let modelUsed = "deterministic";

  // Call LLM if API key is available
  if (env.DEEPSEEK_API_KEY || env.OPENROUTER_API_KEY) {
    const holdingsBlock = navData.details
      .filter((d) => !d.isin.startsWith("CASH_") && d.market_value > 0)
      .map(
        (d) =>
          `- ${d.isin} (${d.name}): 當前占比 ${d.weight ?? 0}% (目標 ${d.target_weight ?? "未設定"}%, 偏離 ${d.rebalance_diff ?? 0}%)`
      )
      .join("\n");

    const candBlock = candidatePool
      .map((c) => `- ${c.lab_id}: ${c.name} [${c.asset_class}, 評級 ${c.quant_grade || "N/A"}]`)
      .join("\n");

    const wrapperRule =
      wrapperType === "AIA_TMP2"
        ? "【AIA 卓達智悅2 約束】1) 純百分比基金轉換 (0 手續費)；2) 任何保留基金占比必須為 >= 5 的整數 (%)；3) 總和嚴格等於 100%。"
        : "【券商海外 ETF 約束】1) 需留存約 1.5% 現金緩衝防滑點；2) 優先賣出超配與劣後標的；3) 權重為整數百分比且總和等於 100%。";

    const prompt = `你是一位資深買方投資組合經理。請對以下實盤跟蹤組合進行「再評估與再平衡決策」。

${formatMacroPromptBlock(health.macro_snapshot)}

【組合現狀與健康診斷】
- 組合 ID: #${portfolioId} (${engine.meta.name})
- 總淨值: ${baseCcy} ${health.total_nav.toLocaleString()}
- 交易載體: ${wrapperType}
- 時間加權動態回撤 (TWR Drawdown): ${(health.twr_drawdown * 100).toFixed(2)}% (IPS 上限: ${(health.config.max_drawdown_limit * 100).toFixed(1)}%)
- 最大單一資產偏離度: ${(health.max_asset_drift * 100).toFixed(2)}% (閾值: ${(health.config.drift_tolerance * 100).toFixed(1)}%)
- 健康度得分: ${health.health_score}/100
- 活躍預警信號: ${health.macro_risk_flags.join(", ") || "無"}
- 劣後表現持倉: ${health.dna.laggard_holdings.map((l) => `${l.isin}(${l.reason})`).join("; ") || "無"}

【當前持倉明細】
${holdingsBlock || "暫無非現金持倉"}

${wrapperRule}

【允許替換或新增的候選白名單標的池（嚴禁編造名單外代碼）】
${candBlock || "沿用現有持倉調整權重"}

請輸出簡潔專業的調倉分析報告（繁體/簡體中文均可，300字以內），並在最末尾輸出嚴格 JSON：
<reeval_json>
{
  "trigger_reason": "一句話總結核心觸發原因",
  "rationale": "再平衡邏輯、宏觀響應與基金替換說明",
  "proposed_weights_pct": { "ASSET_CODE": 25 }
}
</reeval_json>`;

    try {
      const llmRes = await callLlmChat(env, prompt, {
        modelPreference: "deepseek-pro",
        maxTokens: 4096,
        temperature: 0.25,
      });
      aiProvider = llmRes.provider;
      modelUsed = llmRes.modelUsed;
      const tagMatch = llmRes.text.match(/<reeval_json>\s*([\s\S]*?)\s*<\/reeval_json>/i);
      const cleanText = tagMatch ? llmRes.text.replace(tagMatch[0], "").trim() : llmRes.text.trim();
      if (tagMatch) {
        const parsed = JSON.parse(tagMatch[1].trim());
        const rawMap = parsed?.proposed_weights_pct;
        if (rawMap && typeof rawMap === "object") {
          const filtered: Record<string, number> = {};
          for (const [k, v] of Object.entries(rawMap)) {
            const sym = String(k || "").trim();
            const val = Number(v);
            if (sym && Number.isFinite(val) && val > 0 && allowedSymbols.has(sym)) {
              filtered[sym] = val;
            }
          }
          if (Object.keys(filtered).length > 0) {
            proposedWeightsPct = normalizeWrapperPercentages(filtered, wrapperType === "AIA_TMP2" ? 5 : 0);
            if (typeof parsed.trigger_reason === "string" && parsed.trigger_reason.trim()) {
              triggerReason = parsed.trigger_reason.trim();
            }
            if (typeof parsed.rationale === "string" && parsed.rationale.trim()) {
              aiAnalysis = cleanText ? `${cleanText}\n\n${parsed.rationale.trim()}` : parsed.rationale.trim();
            } else if (cleanText) {
              aiAnalysis = cleanText;
            }
          }
        }
      } else if (cleanText) {
        aiAnalysis = `${cleanText}\n\n（權重維持量化規則校準）`;
      }
    } catch (err: any) {
      console.warn("[reevaluate] LLM call failed, using deterministic fallback:", err?.message || err);
    }
  }

  const { orderPayload, proposedDecimal } = await buildWrapperOrderForHoldings(
    db,
    navData.details,
    cashBalanceBase,
    health.total_nav,
    baseCcy,
    wrapperType,
    proposedWeightsPct
  );

  const ticketId = generateUuid();
  const todayStr = new Date().toISOString().slice(0, 10);
  const batchId = `tkt_${todayStr.replace(/-/g, "")}_${ticketId.slice(0, 8)}`;

  const ticketType = health.dna.laggard_holdings.length > 0
    ? "ASSET_SWITCH"
    : health.drifted_assets.length > 0
    ? "DRIFT_REBALANCE"
    : "MACRO_TACTICAL";

  await db
    .prepare(
      `INSERT INTO portfolio_rebalance_tickets (
        id, portfolio_id, batch_id, wrapper_type, ticket_type, status,
        trigger_reason, proposed_allocations_json, order_payload_json,
        ai_analysis, macro_snapshot_date, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    )
    .bind(
      ticketId,
      portfolioId,
      batchId,
      wrapperType,
      ticketType,
      triggerReason,
      JSON.stringify(proposedDecimal),
      JSON.stringify(orderPayload),
      aiAnalysis,
      health.macro_snapshot.as_of_date,
      user.id
    )
    .run();

  await writeAuditLog(db, {
    userId: user.id,
    action: "portfolio.reevaluate",
    resourceType: "rebalance_ticket",
    resourceId: ticketId,
    detail: { portfolio_id: portfolioId, wrapper_type: wrapperType, ticket_type: ticketType },
  });

  return {
    id: ticketId,
    portfolio_id: portfolioId,
    batch_id: batchId,
    wrapper_type: wrapperType,
    ticket_type: ticketType,
    status: "DRAFT" as const,
    trigger_reason: triggerReason,
    proposed_allocations: proposedDecimal,
    order_payload: orderPayload,
    ai_analysis: aiAnalysis,
    ai_provider: aiProvider,
    model_used: modelUsed,
    macro_snapshot_date: health.macro_snapshot.as_of_date,
    created_at: new Date().toISOString(),
  };
}

export async function updateRebalanceTicketDraft(
  db: D1Database,
  portfolioId: number,
  ticketId: string,
  user: { id: string; role: string },
  updates: {
    proposed_allocations?: Record<string, number>;
    trigger_reason?: string;
    ai_analysis?: string;
  }
) {
  await ensureMonitoringSchema(db);
  const row = await db
    .prepare("SELECT * FROM portfolio_rebalance_tickets WHERE id = ? AND portfolio_id = ?")
    .bind(ticketId, portfolioId)
    .first<any>();
  if (!row) throw new Error("執行單不存在");
  if (row.status !== "DRAFT") throw new Error(`僅草稿狀態執行單可儲存修改（當前：${row.status}）`);

  const wrapperType: WrapperType = row.wrapper_type || "AIA_TMP2";
  const currentDecimal: Record<string, number> = JSON.parse(row.proposed_allocations_json || "{}");

  const rawMap =
    updates.proposed_allocations && Object.keys(updates.proposed_allocations).length > 0
      ? updates.proposed_allocations
      : currentDecimal;
  const pctMap: Record<string, number> = {};
  for (const [k, v] of Object.entries(rawMap)) {
    const n = Number(v || 0);
    if (n > 0) pctMap[k] = n <= 1 ? n * 100 : n;
  }
  const normalizedPct = normalizeWrapperPercentages(pctMap, wrapperType === "AIA_TMP2" ? 5 : 0);

  const engine = new PortfolioEngine(db, portfolioId);
  await engine.init();
  const navData = await engine.calculateNav();
  const { cashBalances } = await engine.getCurrentPortfolio();
  const baseCcy = engine.meta.base_currency || "USD";
  const cashBalanceBase = await resolveCashBalanceBase(db, cashBalances, baseCcy);

  const { orderPayload, proposedDecimal } = await buildWrapperOrderForHoldings(
    db,
    navData.details,
    cashBalanceBase,
    navData.total_nav,
    baseCcy,
    wrapperType,
    normalizedPct
  );

  const nextReason =
    typeof updates.trigger_reason === "string" && updates.trigger_reason.trim()
      ? updates.trigger_reason.trim()
      : row.trigger_reason;
  const nextAnalysis =
    typeof updates.ai_analysis === "string" ? updates.ai_analysis.trim() : row.ai_analysis;

  await db
    .prepare(
      `UPDATE portfolio_rebalance_tickets
       SET trigger_reason = ?, proposed_allocations_json = ?, order_payload_json = ?, ai_analysis = ?
       WHERE id = ? AND portfolio_id = ?`
    )
    .bind(
      nextReason,
      JSON.stringify(proposedDecimal),
      JSON.stringify(orderPayload),
      nextAnalysis,
      ticketId,
      portfolioId
    )
    .run();

  await writeAuditLog(db, {
    userId: user.id,
    action: "portfolio.ticket_draft_save",
    resourceType: "rebalance_ticket",
    resourceId: ticketId,
    detail: { portfolio_id: portfolioId, wrapper_type: wrapperType },
  });

  return {
    id: row.id,
    portfolio_id: Number(row.portfolio_id),
    batch_id: row.batch_id,
    wrapper_type: wrapperType,
    ticket_type: row.ticket_type,
    status: "DRAFT" as const,
    trigger_reason: nextReason,
    proposed_allocations: proposedDecimal,
    order_payload: orderPayload,
    ai_analysis: nextAnalysis,
    macro_snapshot_date: row.macro_snapshot_date,
    created_by: row.created_by,
    created_at: row.created_at,
  };
}

export async function confirmRebalanceTicket(
  db: D1Database,
  portfolioId: number,
  ticketId: string,
  user: { id: string; role: string },
  overrides?: { proposed_allocations?: Record<string, number>; as_of_date?: string }
) {
  const row = await db
    .prepare("SELECT * FROM portfolio_rebalance_tickets WHERE id = ? AND portfolio_id = ?")
    .bind(ticketId, portfolioId)
    .first<any>();
  if (!row) throw new Error("執行單不存在");
  if (row.status !== "DRAFT") throw new Error(`執行單狀態為 ${row.status}，無法重複確認`);

  const wrapperType: WrapperType = row.wrapper_type || "AIA_TMP2";
  const dateStr = overrides?.as_of_date || new Date().toISOString().slice(0, 10);

  let targetDecimal: Record<string, number> = JSON.parse(row.proposed_allocations_json || "{}");
  if (overrides?.proposed_allocations && Object.keys(overrides.proposed_allocations).length > 0) {
    const pctMap: Record<string, number> = {};
    for (const [k, v] of Object.entries(overrides.proposed_allocations)) {
      const n = Number(v || 0);
      if (n > 0) pctMap[k] = n <= 1 ? n * 100 : n;
    }
    const normPct = normalizeWrapperPercentages(pctMap, wrapperType === "AIA_TMP2" ? 5 : 0);
    targetDecimal = {};
    for (const [k, pct] of Object.entries(normPct)) {
      targetDecimal[k] = Math.round((pct / 100) * 10000) / 10000;
    }
  }

  // Persist confirmed target_allocations first so PortfolioEngine generates exact matching trades
  await db
    .prepare("UPDATE portfolios SET target_allocations = ? WHERE id = ?")
    .bind(JSON.stringify(targetDecimal), portfolioId)
    .run();

  const engine = new PortfolioEngine(db, portfolioId);
  await engine.init();
  const execResult = await engine.executeRebalance(dateStr, {
    wrapperType,
    batchId: row.batch_id,
    notes: JSON.stringify({ ticket_id: ticketId, wrapper_type: wrapperType, trigger: row.trigger_reason }),
  });

  const nowIso = new Date().toISOString();
  await db
    .prepare(
      `UPDATE portfolio_rebalance_tickets
       SET status = 'CONFIRMED', proposed_allocations_json = ?, confirmed_at = ?, confirmed_by = ?
       WHERE id = ?`
    )
    .bind(JSON.stringify(targetDecimal), nowIso, user.id, ticketId)
    .run();

  try {
    await db
      .prepare("UPDATE portfolio_monitoring_config SET last_reeval_at = ?, updated_at = CURRENT_TIMESTAMP WHERE portfolio_id = ?")
      .bind(nowIso, portfolioId)
      .run();
  } catch {
    // ignore
  }

  await PortfolioEngine.clearStatsCache(db, portfolioId);
  await writeAuditLog(db, {
    userId: user.id,
    action: "portfolio.ticket_confirm",
    resourceType: "rebalance_ticket",
    resourceId: ticketId,
    detail: { portfolio_id: portfolioId, batch_id: row.batch_id, inserted: execResult.inserted },
  });

  return {
    status: "CONFIRMED",
    ticket_id: ticketId,
    batch_id: row.batch_id,
    inserted: execResult.inserted,
    date: execResult.date,
    proposed_allocations: targetDecimal,
  };
}
