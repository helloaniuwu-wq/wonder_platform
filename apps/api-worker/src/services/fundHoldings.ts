import { QuantFundCatalogRow } from "./quantStore";

export interface TopHoldingItem {
  name: string;
  symbol?: string;
  weight_pct: number | null;
}

export interface FundXRayProfile {
  source: string;
  updated_at?: string;
  asset_split?: { equity: number; bond: number; cash: number; other: number };
  sectors?: Record<string, number>;
  regions?: Record<string, number>;
  equity_style?: { size: "large" | "mid" | "small"; style: "value" | "blend" | "growth" } | null;
  bond_style?: { credit: "high" | "medium" | "low"; sensitivity: "limited" | "moderate" | "extensive" } | null;
  bond_ratings?: Record<string, number>;
  valuation?: { pe?: number | null; pb?: number | null; ytm?: number | null; duration?: number | null };
}

export interface TopHoldingsResult {
  source: string;
  holdings: TopHoldingItem[];
  top10_total_pct?: number | null;
  xray_profile?: FundXRayProfile | null;
  sync_status?: "live_updated" | "queued_for_local" | "cached" | "none";
  queued_at?: string | null;
  factsheet_url?: string | null;
  message?: string | null;
}

const YAHOO_SECTOR_KEY_MAP: Record<string, string> = {
  technology: "information_technology",
  financial_services: "financials",
  healthcare: "health_care",
  energy: "energy",
  utilities: "utilities",
  industrials: "industrials",
  consumer_cyclical: "consumer_discretionary",
  consumer_defensive: "consumer_staples",
  communication_services: "communication_services",
  basic_materials: "materials",
  realestate: "real_estate",
};

function numRaw(val: any): number | null {
  const raw = val && typeof val === "object" && "raw" in val ? val.raw : val;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function parseYahooXRayProfile(json: any): FundXRayProfile | null {
  const result = json?.quoteSummary?.result?.[0];
  const th = result?.topHoldings;
  if (!th) return null;

  const sectors: Record<string, number> = {};
  if (Array.isArray(th.sectorWeightings)) {
    for (const item of th.sectorWeightings) {
      if (!item || typeof item !== "object") continue;
      for (const [k, v] of Object.entries(item)) {
        const pct = numRaw(v);
        if (pct != null && pct > 0) {
          const normKey = YAHOO_SECTOR_KEY_MAP[k] || k;
          sectors[normKey] = Math.round((sectors[normKey] || 0) * 100 + pct * 10000) / 100;
        }
      }
    }
  }

  const eq = numRaw(th.stockPosition);
  const bd = numRaw(th.bondPosition);
  const ca = numRaw(th.cashPosition);
  const ot = numRaw(th.otherPosition);
  const asset_split =
    eq != null || bd != null || ca != null
      ? {
          equity: Math.round((eq || 0) * 1000) / 10,
          bond: Math.round((bd || 0) * 1000) / 10,
          cash: Math.round((ca || 0) * 1000) / 10,
          other: Math.round((ot || 0) * 1000) / 10,
        }
      : undefined;

  const bond_ratings: Record<string, number> = {};
  if (Array.isArray(th.bondRatings)) {
    for (const item of th.bondRatings) {
      if (!item || typeof item !== "object") continue;
      for (const [k, v] of Object.entries(item)) {
        const pct = numRaw(v);
        if (pct != null && pct > 0) {
          bond_ratings[k.toLowerCase()] = Math.round(pct * 1000) / 10;
        }
      }
    }
  }

  const pe = numRaw(th.equityHoldings?.priceToEarnings);
  const pb = numRaw(th.equityHoldings?.priceToBook);
  const duration = numRaw(th.bondHoldings?.duration);

  const catName = String(result?.fundProfile?.categoryName || "").toLowerCase();
  let equity_style: FundXRayProfile["equity_style"] = null;
  if (/large|mid|small/.test(catName) && /value|blend|growth/.test(catName)) {
    const size = catName.includes("small") ? "small" : catName.includes("mid") ? "mid" : "large";
    const style = catName.includes("value") ? "value" : catName.includes("growth") ? "growth" : "blend";
    equity_style = { size, style };
  }
  let bond_style: FundXRayProfile["bond_style"] = null;
  if (duration != null || Object.keys(bond_ratings).length > 0) {
    const sensitivity = duration != null ? (duration < 3.5 ? "limited" : duration <= 6.5 ? "moderate" : "extensive") : "moderate";
    const highW = (bond_ratings.aaa || 0) + (bond_ratings.aa || 0) + (bond_ratings.a || 0) + (bond_ratings.us_government || 0);
    const lowW = (bond_ratings.bb || 0) + (bond_ratings.b || 0) + (bond_ratings.below_b || 0);
    const credit = lowW > 30 ? "low" : highW >= 50 ? "high" : "medium";
    bond_style = { credit, sensitivity };
  }

  const hasContent =
    Object.keys(sectors).length > 0 ||
    asset_split != null ||
    Object.keys(bond_ratings).length > 0 ||
    pe != null ||
    pb != null ||
    duration != null;
  if (!hasContent) return null;

  return {
    source: "Yahoo Finance",
    updated_at: new Date().toISOString().slice(0, 10),
    asset_split,
    sectors: Object.keys(sectors).length > 0 ? sectors : undefined,
    equity_style,
    bond_style,
    bond_ratings: Object.keys(bond_ratings).length > 0 ? bond_ratings : undefined,
    valuation: {
      pe: pe != null && pe > 0 && pe < 200 ? Math.round(pe * 100) / 100 : null,
      pb: pb != null && pb > 0 && pb < 50 ? Math.round(pb * 100) / 100 : null,
      duration: duration != null && duration >= -5 && duration <= 40 ? Math.round(duration * 100) / 100 : null,
    },
  };
}

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * 解析 Yahoo Finance quoteSummary(topHoldings) JSON 結構。
 */
export function parseYahooTopHoldings(json: any): TopHoldingsResult | null {
  const th = json?.quoteSummary?.result?.[0]?.topHoldings;
  if (!th || !Array.isArray(th.holdings) || th.holdings.length === 0) return null;

  const holdings: TopHoldingItem[] = [];
  for (const h of th.holdings.slice(0, 10)) {
    const name = String(h?.holdingName || h?.symbol || "").trim();
    if (!name) continue;
    const rawPct = h?.holdingPercent?.raw ?? h?.holdingPercent;
    const pct =
      typeof rawPct === "number" && Number.isFinite(rawPct)
        ? Math.round(rawPct * 10000) / 100
        : null;
    holdings.push({
      name,
      symbol: h?.symbol ? String(h.symbol).trim() : undefined,
      weight_pct: pct,
    });
  }

  if (holdings.length === 0) return null;
  const total = holdings.reduce((s, x) => s + (x.weight_pct ?? 0), 0);
  return {
    source: "Yahoo Finance",
    holdings,
    top10_total_pct: total > 0 ? Math.round(total * 100) / 100 : null,
  };
}

/**
 * 解析斜線分隔的前十大持倉文本（兼容 Obsidian 基金檔案格式，如 "騰訊 9.5% / 阿里 6.5%"）。
 */
export function parseTopHoldingsText(text: string | null | undefined): TopHoldingItem[] {
  if (!text || typeof text !== "string") return [];
  const cleaned = text.replace(/（前十大[^）]*）/g, "").replace(/\(前十大[^)]*\)/g, "");
  if (!cleaned.includes("/")) return [];

  const parts = cleaned.split("/").map((p) => p.trim()).filter(Boolean);
  const items: TopHoldingItem[] = [];
  for (const part of parts.slice(0, 10)) {
    const m = /^(.+?)\s+(\d+(?:\.\d+)?)%?$/.exec(part);
    if (m) {
      items.push({
        name: m[1].trim(),
        weight_pct: Number(m[2]),
      });
    } else if (parts.length >= 3) {
      items.push({ name: part, weight_pct: null });
    }
  }
  return items.length >= 2 ? items : [];
}

async function fetchYahooTopHoldings(ticker: string): Promise<TopHoldingsResult | null> {
  const clean = ticker.trim();
  if (!clean) return null;

  for (const host of ["query2.finance.yahoo.com", "query1.finance.yahoo.com"]) {
    try {
      const url = `https://${host}/v10/finance/quoteSummary/${encodeURIComponent(clean)}?modules=topHoldings,fundProfile`;
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) continue;
      const json = await res.json();
      const parsed = parseYahooTopHoldings(json);
      const xray = parseYahooXRayProfile(json);
      if (parsed) {
        if (xray) parsed.xray_profile = xray;
        return parsed;
      }
    } catch {
      // try next host
    }
  }
  return null;
}

function inferDeterministicFactsheetUrl(fund: QuantFundCatalogRow): string | null {
  if (fund.isin && (/abrdn|安本/i.test(fund.name) || /abrdn|安本/i.test(fund.manager || ""))) {
    return `https://abrdn.kurtosysweb.com/pdfs/F_STDR_en-gb-NN_${fund.isin}.pdf`;
  }
  return (fund as any).morningstar_url || null;
}

async function enqueueFactsheetRefresh(
  db: D1Database,
  fund: QuantFundCatalogRow,
  factsheetUrl: string | null
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO wq_factsheet_queue (slug, code, isin, factsheet_url, status, requested_at, last_error)
         VALUES (?, ?, ?, ?, 'pending', datetime('now'), NULL)
         ON CONFLICT(slug) DO UPDATE SET
           status = 'pending',
           factsheet_url = COALESCE(excluded.factsheet_url, wq_factsheet_queue.factsheet_url),
           requested_at = datetime('now'),
           last_error = NULL`
      )
      .bind(fund.slug, fund.code || null, fund.isin || null, factsheetUrl)
      .run();
  } catch {
    // 若隊列表尚未遷移則靜默忽略
  }
}

export async function getFundTopHoldings(
  db: D1Database,
  fund: QuantFundCatalogRow,
  forceRefresh: boolean = false
): Promise<TopHoldingsResult> {
  // 0. 讀取既有 D1 緩存與隊列狀態（若有）
  let existingCache: TopHoldingsResult | null = null;
  let queueRow: { status: string; requested_at: string | null; factsheet_url: string | null } | null = null;

  try {
    const row = await db
      .prepare("SELECT top_holdings_json FROM wq_funds WHERE slug = ?")
      .bind(fund.slug)
      .first<{ top_holdings_json: string | null }>();
    if (row?.top_holdings_json) {
      const parsed = JSON.parse(row.top_holdings_json);
      if (Array.isArray(parsed?.holdings) && parsed.holdings.length > 0) {
        existingCache = {
          source: parsed.source || "D1 基金庫緩存",
          holdings: parsed.holdings,
          top10_total_pct: parsed.top10_total_pct ?? null,
        };
      }
    }
  } catch {
    // 列尚未遷移或 JSON 無效時忽略
  }

  try {
    queueRow = await db
      .prepare("SELECT status, requested_at, factsheet_url FROM wq_factsheet_queue WHERE slug = ?")
      .bind(fund.slug)
      .first<{ status: string; requested_at: string | null; factsheet_url: string | null }>();
  } catch {
    // 隊列表尚未遷移時忽略
  }

  // 1. 若非強制刷新且既有緩存存在，直接返回
  if (!forceRefresh && existingCache) {
    return {
      ...existingCache,
      sync_status: queueRow?.status === "pending" ? "queued_for_local" : "cached",
      queued_at: queueRow?.requested_at || null,
      factsheet_url: queueRow?.factsheet_url || null,
    };
  }

  // 2. 嘗試透過 Yahoo Finance 即時抓取最新持倉
  const candidates = [fund.yahoo_ticker, fund.isin, fund.code].filter(
    (x): x is string => typeof x === "string" && x.trim().length > 0
  );
  for (const ticker of Array.from(new Set(candidates))) {
    const live = await fetchYahooTopHoldings(ticker);
    if (live && live.holdings && live.holdings.length > 0) {
      const holdingsPayload = JSON.stringify({
        source: live.source,
        holdings: live.holdings,
        top10_total_pct: live.top10_total_pct ?? null,
      });
      const xrayPayload = live.xray_profile ? JSON.stringify(live.xray_profile) : null;
      try {
        try {
          await db
            .prepare("UPDATE wq_funds SET top_holdings_json = ?, xray_profile_json = COALESCE(?, xray_profile_json) WHERE slug = ?")
            .bind(holdingsPayload, xrayPayload, fund.slug)
            .run();
        } catch {
          await db
            .prepare("UPDATE wq_funds SET top_holdings_json = ? WHERE slug = ?")
            .bind(holdingsPayload, fund.slug)
            .run();
        }
        if (queueRow) {
          await db
            .prepare(
              "UPDATE wq_factsheet_queue SET status = 'completed', completed_at = datetime('now'), result_summary = 'live_updated' WHERE slug = ?"
            )
            .bind(fund.slug)
            .run();
        }
      } catch {
        // ignore if column/table not migrated yet
      }
      return {
        ...live,
        sync_status: "live_updated",
        message: "线上已即时更新最新持仓",
      };
    }
  }

  // 3. 回退計算（既有緩存或 commentary 摘要）
  let fallbackResult: TopHoldingsResult | null = existingCache;
  if (!fallbackResult) {
    const fromText = parseTopHoldingsText(fund.commentary);
    if (fromText.length > 0) {
      const total = fromText.reduce((s, x) => s + (x.weight_pct ?? 0), 0);
      fallbackResult = {
        source: "投研摘要解析",
        holdings: fromText,
        top10_total_pct: total > 0 ? Math.round(total * 100) / 100 : null,
      };
    }
  }

  // 4. 若使用者點擊了手動強制更新且線上無法直接獲取，將任務寫入 D1 本地異步隊列
  if (forceRefresh) {
    const factsheetUrl = inferDeterministicFactsheetUrl(fund);
    await enqueueFactsheetRefresh(db, fund, factsheetUrl);
    const base = fallbackResult || { source: "none", holdings: [], top10_total_pct: null };
    return {
      ...base,
      sync_status: "queued_for_local",
      queued_at: new Date().toISOString(),
      factsheet_url: factsheetUrl,
      message: "已加入本地 Factsheet 抓取队列，本地空闲时将自动拉取最新月报并通过大模型识别更新",
    };
  }

  if (fallbackResult) {
    return {
      ...fallbackResult,
      sync_status: queueRow?.status === "pending" ? "queued_for_local" : "cached",
      queued_at: queueRow?.requested_at || null,
      factsheet_url: queueRow?.factsheet_url || null,
    };
  }

  return {
    source: "none",
    holdings: [],
    top10_total_pct: null,
    sync_status: queueRow?.status === "pending" ? "queued_for_local" : "none",
    queued_at: queueRow?.requested_at || null,
    factsheet_url: queueRow?.factsheet_url || null,
  };
}
