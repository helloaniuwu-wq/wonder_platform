import type { Env } from "../types";
import { writeAuditLog } from "../utils/audit";
import { generateUuid } from "../utils/auth";
import { loadQuantCatalog, resolveQuantFund } from "./quantStore";
import { callVisionApi } from "./vision";
import { PortfolioEngine } from "./fip/portfolioEngine";

export interface OcrExtractedHolding {
  symbol: string | null;
  name: string;
  units: number | null;
  price: number | null;
  market_value: number | null;
  currency: string;
  weight_pct: number | null;
}

export interface ReconciliationRow {
  matched_isin: string | null;
  detected_symbol: string | null;
  detected_name: string;
  ledger_shares: number;
  screenshot_shares: number;
  diff_shares: number;
  price: number;
  currency: string;
  estimated_diff_value: number;
  status: "MATCHED" | "DIFF" | "NEW_IN_SCREENSHOT" | "MISSING_IN_SCREENSHOT";
}

const HOLDINGS_OCR_PROMPT = `你是一位專注於香港投資顧問與券商對賬的金融憑證解析專家。請仔細識別用戶上傳的投資帳戶持倉截圖（可能來自 AIA Connect / AIA 卓達智悅2 App、富途牛牛、IBKR 盈透證券、老虎證券或銀行網銀持倉列表）。

請嚴格提取所有可見持倉行，返回純 JSON 物件（不要包含多餘說明）：
{
  "platform_detected": "AIA_CONNECT / IBKR / FUTU / BANK / UNKNOWN",
  "as_of_date": "YYYY-MM-DD 或 null",
  "currency": "帳戶主要幣種，如 USD 或 HKD",
  "cash_balance": 現金餘額數字或 null,
  "confidence": 85,
  "holdings": [
    {
      "symbol": "股票/ETF 代碼或 AIA 基金代碼 (如 SPY, 2800.HK, F51, T01)，無則填 null",
      "name": "基金或股票名稱（保持原文）",
      "units": 持有股數或基金單位數（純數字，保留4位小數）,
      "price": 當前單價/淨值（純數字，無則 null）,
      "market_value": 當前市值（純數字，無則 null）,
      "currency": "該標的幣種 (USD/HKD/CNY 等)",
      "weight_pct": 占比百分比 (如 25.4，無則 null)
    }
  ]
}`;

function normText(s: string | null | undefined): string {
  return String(s || "")
    .toUpperCase()
    .replace(/[^A-Z0-9\u4e00-\u9fa5]/g, "");
}

export async function parseHoldingsScreenshot(
  env: Env,
  db: D1Database,
  portfolioId: number,
  dataUrl: string,
  filename = "holdings.png"
) {
  const vision = await callVisionApi(env, HOLDINGS_OCR_PROMPT, dataUrl, {
    maxTokens: 2048,
    filename,
    mode: "holdings",
  });

  const rawData = vision.data || {};
  const rawHoldings: any[] = Array.isArray(rawData.holdings) ? rawData.holdings : [];
  const accountCcy = String(rawData.currency || "USD").toUpperCase();

  const engine = new PortfolioEngine(db, portfolioId);
  await engine.init();
  const { portfolio } = await engine.getCurrentPortfolio();
  const navData = await engine.calculateNav();
  const ledgerByIsin = new Map(navData.details.map((d) => [d.isin, d]));
  const catalog = await loadQuantCatalog(db);

  const extracted: OcrExtractedHolding[] = rawHoldings.map((h) => ({
    symbol: h?.symbol ? String(h.symbol).trim().toUpperCase() : null,
    name: String(h?.name || h?.symbol || "Unknown Asset").trim(),
    units: h?.units != null ? Number(h.units) : h?.shares != null ? Number(h.shares) : null,
    price: h?.price != null ? Number(h.price) : null,
    market_value: h?.market_value != null ? Number(h.market_value) : null,
    currency: String(h?.currency || accountCcy).toUpperCase(),
    weight_pct: h?.weight_pct != null ? Number(h.weight_pct) : null,
  }));

  const matchedLedgerIsins = new Set<string>();
  const rows: ReconciliationRow[] = [];

  for (const item of extracted) {
    let matchedIsin: string | null = null;

    // 1. Exact or normalized match on current ledger symbols/names
    if (item.symbol) {
      const symUp = item.symbol.toUpperCase();
      for (const d of navData.details) {
        if (d.isin.startsWith("CASH_")) continue;
        if (d.isin.toUpperCase() === symUp) {
          matchedIsin = d.isin;
          break;
        }
      }
      if (!matchedIsin) {
        const qFund = await resolveQuantFund(db, symUp);
        if (qFund) {
          const candidates = [qFund.aia_code, qFund.code, qFund.yahoo_ticker, qFund.isin, qFund.slug].filter(Boolean);
          for (const c of candidates) {
            const hit = navData.details.find((d) => d.isin.toUpperCase() === String(c).toUpperCase());
            if (hit) {
              matchedIsin = hit.isin;
              break;
            }
          }
          if (!matchedIsin) {
            matchedIsin = qFund.aia_code || qFund.yahoo_ticker || qFund.code || qFund.slug;
          }
        }
      }
    }

    // 2. Fuzzy name match against ledger holdings, then quant catalog
    if (!matchedIsin && item.name) {
      const nKey = normText(item.name);
      if (nKey.length >= 4) {
        const ledgerHit = navData.details.find((d) => {
          if (d.isin.startsWith("CASH_")) return false;
          const dn = normText(d.name);
          return dn.includes(nKey) || nKey.includes(dn);
        });
        if (ledgerHit) {
          matchedIsin = ledgerHit.isin;
        } else {
          const catHit = catalog.rows.find((r) => {
            const rn = normText(r.name);
            const rne = normText(r.name_en);
            return (rn && (rn.includes(nKey) || nKey.includes(rn))) || (rne && (rne.includes(nKey) || nKey.includes(rne)));
          });
          if (catHit) {
            matchedIsin = catHit.aia_code || catHit.yahoo_ticker || catHit.code || catHit.slug;
          }
        }
      }
    }

    const fallbackSym = matchedIsin || item.symbol;
    const ledgerHolding = fallbackSym ? ledgerByIsin.get(fallbackSym) : undefined;
    const rawLedgerShares = fallbackSym ? portfolio[fallbackSym]?.shares ?? ledgerHolding?.shares ?? 0 : 0;
    const ledgerShares = Math.round(rawLedgerShares * 10000) / 10000;

    let price = item.price && item.price > 0 ? item.price : ledgerHolding?.price || 0;
    let screenshotShares = item.units != null && Number.isFinite(item.units) ? item.units : 0;
    if (screenshotShares === 0 && item.market_value && item.market_value > 0 && price > 0) {
      screenshotShares = Math.round((item.market_value / price) * 10000) / 10000;
    }
    if (price === 0 && screenshotShares > 0 && item.market_value && item.market_value > 0) {
      price = Math.round((item.market_value / screenshotShares) * 10000) / 10000;
    }

    if (matchedIsin && ledgerHolding) {
      matchedLedgerIsins.add(matchedIsin);
    }

    const diffShares = Math.round((screenshotShares - ledgerShares) * 10000) / 10000;
    const estDiffVal = Math.round(diffShares * (price || 0) * 100) / 100;
    const status: ReconciliationRow["status"] = !ledgerHolding
      ? "NEW_IN_SCREENSHOT"
      : Math.abs(diffShares) < 0.01
      ? "MATCHED"
      : "DIFF";

    rows.push({
      matched_isin: fallbackSym,
      detected_symbol: item.symbol,
      detected_name: item.name,
      ledger_shares: ledgerShares,
      screenshot_shares: Math.round(screenshotShares * 10000) / 10000,
      diff_shares: diffShares,
      price: Math.round(price * 10000) / 10000,
      currency: item.currency,
      estimated_diff_value: estDiffVal,
      status,
    });
  }

  // Flag ledger holdings absent from screenshot
  for (const d of navData.details) {
    if (d.isin.startsWith("CASH_") || d.shares <= 0 || matchedLedgerIsins.has(d.isin)) continue;
    rows.push({
      matched_isin: d.isin,
      detected_symbol: d.isin,
      detected_name: d.name,
      ledger_shares: d.shares,
      screenshot_shares: 0,
      diff_shares: Math.round(-d.shares * 10000) / 10000,
      price: d.price,
      currency: engine.meta.base_currency || "USD",
      estimated_diff_value: Math.round(-d.shares * d.price * 100) / 100,
      status: "MISSING_IN_SCREENSHOT",
    });
  }

  return {
    platform_detected: String(rawData.platform_detected || "UNKNOWN"),
    as_of_date: rawData.as_of_date || new Date().toISOString().slice(0, 10),
    currency: accountCcy,
    cash_balance: rawData.cash_balance != null ? Number(rawData.cash_balance) : null,
    confidence: rawData.confidence != null ? Number(rawData.confidence) : null,
    model_used: vision.modelUsed,
    extracted_holdings: extracted,
    reconciliation_rows: rows,
  };
}

export async function applyReconciliationAdjustments(
  db: D1Database,
  portfolioId: number,
  user: { id: string; role: string },
  adjustments: Array<{ isin: string; diff_shares: number; price: number; date?: string }>
) {
  const dateStr = new Date().toISOString().slice(0, 10);
  const batchId = `rec_${dateStr.replace(/-/g, "")}_${generateUuid().slice(0, 8)}`;
  const valid = adjustments.filter((a) => a.isin && Math.abs(Number(a.diff_shares)) >= 0.0001 && Number(a.price) > 0);
  if (valid.length === 0) {
    return { inserted: 0, batch_id: batchId, date: dateStr };
  }

  try {
    const stmts = valid.map((a) => {
      const diff = Number(a.diff_shares);
      const txType = diff > 0 ? "BUY" : "SELL";
      return db
        .prepare(
          "INSERT INTO transactions (portfolio_id, date, isin, type, shares, price, batch_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(
          portfolioId,
          a.date || dateStr,
          String(a.isin).trim(),
          txType,
          Math.round(Math.abs(diff) * 10000) / 10000,
          Number(a.price),
          batchId,
          "OCR Holdings Reconciliation Adjustment"
        );
    });
    await db.batch(stmts);
  } catch {
    const stmts = valid.map((a) => {
      const diff = Number(a.diff_shares);
      const txType = diff > 0 ? "BUY" : "SELL";
      return db
        .prepare("INSERT INTO transactions (portfolio_id, date, isin, type, shares, price) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(
          portfolioId,
          a.date || dateStr,
          String(a.isin).trim(),
          txType,
          Math.round(Math.abs(diff) * 10000) / 10000,
          Number(a.price)
        );
    });
    await db.batch(stmts);
  }

  await PortfolioEngine.clearStatsCache(db, portfolioId);
  await writeAuditLog(db, {
    userId: user.id,
    action: "portfolio.reconcile_apply",
    resourceType: "portfolio",
    resourceId: portfolioId,
    detail: { batch_id: batchId, adjustments: valid.length },
  });

  return { inserted: valid.length, batch_id: batchId, date: dateStr };
}
