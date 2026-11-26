import {
  getQuantFundSeries,
  getQuantFxSeries,
  normalizeMinorCurrency,
  resolveQuantFund,
  sanitizeQuantSeries,
} from "../quantStore";

export interface MarketData {
  symbol: string;
  price: number;
  currency: string;
  base_price: number;
  fx_rate: number;
  name: string;
  sector: string | Record<string, number>;
  country: string | Record<string, number>;
  market_time: string;
}

export interface DividendMetrics {
  trailing_sum: number;
  next_date: string | null;
  next_amount: number | null;
}

const STATIC_FX_TO_USD: Record<string, number> = {
  USD: 1.0,
  HKD: 0.1285,
  EUR: 1.08,
  GBP: 1.27,
  JPY: 0.0065,
  CNY: 0.138,
  CNH: 0.138,
  CAD: 0.72,
  AUD: 0.65,
  SGD: 0.74,
  CHF: 1.13,
};

const YAHOO_OVERRIDES: Record<string, string> = {
  BRK: "BRK-B",
  BF: "BF-B",
};

const memoryMarketCache = new Map<string, { data: MarketData; expiresAt: number }>();
const memoryFxCache = new Map<string, { rate: number; expiresAt: number }>();
const memoryHistoryCache = new Map<string, { series: Record<string, number>; expiresAt: number }>();
const memoryDividendCache = new Map<string, { divs: Record<string, number>; expiresAt: number }>();
const memoryIsinSymbolCache = new Map<string, { symbol: string | null; expiresAt: number }>();

const ISIN_PATTERN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/i;

async function resolveYahooSymbolByIsin(isin: string): Promise<string | null> {
  const key = String(isin || "").trim().toUpperCase();
  if (!ISIN_PATTERN.test(key)) return null;

  const cached = memoryIsinSymbolCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.symbol;
  }

  let resolved: string | null = null;
  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(
      key
    )}&quotesCount=3&newsCount=0`;
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      const json: any = await res.json();
      const firstSym = json?.quotes?.[0]?.symbol;
      if (typeof firstSym === "string" && firstSym.trim().length > 0) {
        resolved = firstSym.trim();
      }
    }
  } catch {
    // ignore
  }

  memoryIsinSymbolCache.set(key, { symbol: resolved, expiresAt: Date.now() + 24 * 3600 * 1000 });
  return resolved;
}

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function nowIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function nowDateTimeStr(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

export function guessCurrencyFromIsin(isin: string): string {
  const upper = String(isin || "").toUpperCase();
  if (upper.startsWith("CASH_")) {
    return upper.slice(5) || "USD";
  }
  if (upper.endsWith(".HK")) return "HKD";
  if (upper.endsWith(".T")) return "JPY";
  if (upper.endsWith(".L")) return "GBP";
  if (upper.endsWith(".PA") || upper.endsWith(".AS") || upper.endsWith(".DE")) return "EUR";
  if (upper.endsWith(".TO") || upper.endsWith(".V")) return "CAD";
  if (upper.endsWith(".AX")) return "AUD";
  if (upper.endsWith(".SZ") || upper.endsWith(".SS")) return "CNY";
  return "USD";
}

/**
 * Resolve asset currency using Wonder Quant catalog metadata & D1 prices table
 * before falling back to ISIN/ticker suffix heuristics.
 */
export async function resolveAssetCurrency(db: D1Database, isin: string): Promise<string> {
  const upper = String(isin || "").trim().toUpperCase();
  if (upper.startsWith("CASH_")) {
    return upper.slice(5) || "USD";
  }

  try {
    if (db && typeof db.prepare === "function") {
      const qFund = await resolveQuantFund(db, isin);
      if (qFund && qFund.currency) {
        return qFund.currency.toUpperCase();
      }
      const pRow = await db
        .prepare("SELECT currency FROM prices WHERE isin = ? AND currency IS NOT NULL ORDER BY date DESC LIMIT 1")
        .bind(isin)
        .first<{ currency: string | null }>();
      if (pRow && pRow.currency) {
        return String(pRow.currency).trim().toUpperCase();
      }
    }
  } catch {
    // ignore and fallback
  }

  return guessCurrencyFromIsin(isin);
}

export function normalizeForYahoo(isin: string): string {
  const trimmed = String(isin || "").trim();
  const upper = trimmed.toUpperCase();
  if (YAHOO_OVERRIDES[upper]) {
    return YAHOO_OVERRIDES[upper];
  }
  if (upper.endsWith(".HK")) {
    const parts = trimmed.split(".");
    const suffix = parts.pop()!;
    const num = parts.join(".").replace(/^0+/, "") || "0";
    return `${num.padStart(4, "0")}.${suffix.toUpperCase()}`;
  }
  return trimmed;
}

function getStooqTicker(isin: string): string {
  const upper = isin.toUpperCase();
  if (upper.length === 3 || ["VOO", "QQQ", "SPY", "DIA", "IWM"].includes(upper)) {
    return `${upper}.US`;
  }
  if (upper.endsWith(".HK")) {
    return upper;
  }
  if (/^[A-Z]{1,5}$/.test(upper)) {
    return `${upper}.US`;
  }
  return upper;
}

export async function getAssetMetadata(
  db: D1Database,
  isin: string
): Promise<{
  name: string;
  sector: string | Record<string, number>;
  country: string | Record<string, number>;
  ticker?: string;
}> {
  let name = isin;
  let sector: string | Record<string, number> = "Unknown Sector";
  let country: string | Record<string, number> = "Unknown Region";
  let ticker: string | undefined;

  try {
    const assetRow = await db
      .prepare("SELECT name, ticker, sector, country FROM assets WHERE isin = ?")
      .bind(isin)
      .first<{ name: string | null; ticker: string | null; sector: string | null; country: string | null }>();

    if (assetRow) {
      if (assetRow.name) name = assetRow.name;
      if (assetRow.ticker) ticker = assetRow.ticker;
      if (assetRow.sector) {
        try {
          sector = JSON.parse(assetRow.sector);
        } catch {
          sector = assetRow.sector;
        }
      }
      if (assetRow.country) {
        try {
          country = JSON.parse(assetRow.country);
        } catch {
          country = assetRow.country;
        }
      }
    }
  } catch {
    // ignore
  }

  try {
    const cacheRow = await db
      .prepare(
        "SELECT name, sector, country FROM price_cache WHERE isin = ? ORDER BY date DESC LIMIT 1"
      )
      .bind(isin)
      .first<{ name: string | null; sector: string | null; country: string | null }>();

    if (cacheRow) {
      if (name === isin && cacheRow.name) name = cacheRow.name;
      if (sector === "Unknown Sector" && cacheRow.sector) {
        try {
          sector = JSON.parse(cacheRow.sector);
        } catch {
          sector = cacheRow.sector;
        }
      }
      if (country === "Unknown Region" && cacheRow.country) {
        try {
          country = JSON.parse(cacheRow.country);
        } catch {
          country = cacheRow.country;
        }
      }
    }
  } catch {
    // ignore
  }

  if (name === isin || sector === "Unknown Sector") {
    try {
      const upper = isin.toUpperCase();
      const wqRow = await db
        .prepare(
          "SELECT name, asset_class FROM wq_funds WHERE UPPER(code) = ? OR UPPER(aia_code) = ? OR UPPER(isin) = ? OR UPPER(slug) = ? LIMIT 1"
        )
        .bind(upper, upper, upper, upper)
        .first<{ name: string | null; asset_class: string | null }>();

      if (wqRow) {
        if (name === isin && wqRow.name) name = wqRow.name;
        if (sector === "Unknown Sector" && wqRow.asset_class) sector = wqRow.asset_class;
      }
    } catch {
      // ignore
    }
  }

  return { name, sector, country, ticker };
}

export async function getProxyTicker(db: D1Database, isin: string): Promise<string> {
  const upper = isin.toUpperCase();
  if (upper.endsWith(".HK")) return "2800.HK";
  if (upper.endsWith(".T")) return "1306.T";
  if (upper.endsWith(".PA") || upper.endsWith(".DE")) return "VGK";

  try {
    const meta = await getAssetMetadata(db, isin);
    const name = String(meta.name || "").toUpperCase();
    if (
      ["BOND", "FI ", "FIXED INCOME", "TREASURY", "GOVT", "CORP", "HIGH YIELD", "CREDIT"].some((k) =>
        name.includes(k)
      )
    ) {
      if (name.includes("HIGH YIELD")) return "HYG";
      if (name.includes("SHORT") || name.includes("ULTRA SHORT")) return "BIL";
      return "AGG";
    }
    if (["TECH", "NASDAQ", "GROWTH", "INNOVATION", "CLOUD", "AI "].some((k) => name.includes(k))) {
      return "QQQ";
    }
    if (["DIVIDEND", "VALUE", "INCOME EQUITY"].some((k) => name.includes(k))) {
      return "VYM";
    }
    if (["REIT", "REAL ESTATE", "PROPERTY", "ESTATE"].some((k) => name.includes(k))) {
      return "VNQ";
    }
    if (name.includes("GOLD")) return "GLD";
    if (name.includes(" COMM") || name.includes("NATURAL RESOURCE")) return "DBC";
  } catch {
    // ignore
  }

  return "SPY";
}

function getStaticFxRate(fromCurr: string, toCurr: string): number {
  const f = fromCurr.toUpperCase();
  const t = toCurr.toUpperCase();
  if (f === t) return 1.0;
  const fUsd = STATIC_FX_TO_USD[f] ?? 1.0;
  const tUsd = STATIC_FX_TO_USD[t] ?? 1.0;
  return tUsd > 0 ? fUsd / tUsd : 1.0;
}

export async function getFxRate(
  db: D1Database,
  fromCurr: string,
  toCurr: string = "USD"
): Promise<number> {
  if (!fromCurr || !toCurr) return 1.0;
  const { currency: f, unitScale: fromScale } = normalizeMinorCurrency(fromCurr);
  const { currency: t, unitScale: toScale } = normalizeMinorCurrency(toCurr);
  const scaleFactor = fromScale / toScale;
  if (f === t) return scaleFactor;

  const ticker = `${f}${t}=X`;
  const mem = memoryFxCache.get(ticker);
  if (mem && mem.expiresAt > Date.now()) {
    return mem.rate * scaleFactor;
  }

  // 0. Check Wonder Quant packed FX table (1 D1 row read, 30m isolate cache)
  try {
    const qFrom = f === "USD" ? 1.0 : (await getQuantFxSeries(db, `${f}USD`))?.latest_rate;
    const qTo = t === "USD" ? 1.0 : (await getQuantFxSeries(db, `${t}USD`))?.latest_rate;
    if (qFrom && qFrom > 0 && qTo && qTo > 0) {
      const rate = qFrom / qTo;
      memoryFxCache.set(ticker, { rate, expiresAt: Date.now() + 15 * 60 * 1000 });
      return rate * scaleFactor;
    }
  } catch {
    // ignore
  }

  // 1. Check D1 price_cache within 6 hours
  try {
    const cutoff = new Date(Date.now() - 6 * 3600 * 1000)
      .toISOString()
      .replace("T", " ")
      .slice(0, 19);
    const row = await db
      .prepare("SELECT price FROM price_cache WHERE isin = ? AND date > ? ORDER BY date DESC LIMIT 1")
      .bind(ticker, cutoff)
      .first<{ price: number }>();
    if (row && row.price && row.price > 0) {
      memoryFxCache.set(ticker, { rate: Number(row.price), expiresAt: Date.now() + 15 * 60 * 1000 });
      return Number(row.price) * scaleFactor;
    }
  } catch {
    // ignore
  }

  // 2. Fetch from Yahoo Finance v8 chart API (with strict 1.5s timeout)
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`;
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(1500),
    });
    if (res.ok) {
      const json: any = await res.json();
      const result = json?.chart?.result?.[0];
      const closes: (number | null)[] = result?.indicators?.quote?.[0]?.close || [];
      const validCloses = closes.filter((c): c is number => typeof c === "number" && c > 0);
      const metaPrice = result?.meta?.regularMarketPrice;
      const rate =
        validCloses.length > 0
          ? validCloses[validCloses.length - 1]
          : typeof metaPrice === "number" && metaPrice > 0
          ? metaPrice
          : 0;

      if (rate > 0) {
        memoryFxCache.set(ticker, { rate, expiresAt: Date.now() + 15 * 60 * 1000 });
        try {
          await db
            .prepare("INSERT OR REPLACE INTO price_cache (isin, date, price) VALUES (?, ?, ?)")
            .bind(ticker, nowDateTimeStr(), rate)
            .run();
        } catch {
          // ignore
        }
        return rate * scaleFactor;
      }
    }
  } catch {
    // ignore
  }

  // 3. Fallback to any cached rate in D1 price_cache or static FX table
  try {
    const row = await db
      .prepare("SELECT price FROM price_cache WHERE isin = ? ORDER BY date DESC LIMIT 1")
      .bind(ticker)
      .first<{ price: number }>();
    if (row && row.price && row.price > 0) {
      return Number(row.price) * scaleFactor;
    }
  } catch {
    // ignore
  }

  return getStaticFxRate(f, t) * scaleFactor;
}

async function fetchYahooChart(
  yahooTicker: string,
  rangeStr: string = "5d",
  includeEvents: boolean = false
): Promise<{
  price: number | null;
  name: string | null;
  currency: string | null;
  prices: Record<string, number>;
  adjPrices?: Record<string, number>;
  dividends: Record<string, number>;
} | null> {
  try {
    const eventsParam = includeEvents ? "&events=div" : "";
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      yahooTicker
    )}?interval=1d&range=${rangeStr}${eventsParam}`;
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(4500),
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return null;

    const meta = result.meta || {};
    const { currency: normCurrency, unitScale } = normalizeMinorCurrency(meta.currency);
    const timestamps: number[] = result.timestamp || [];
    const closes: (number | null)[] = result.indicators?.quote?.[0]?.close || [];
    const adjCloses: (number | null)[] = result.indicators?.adjclose?.[0]?.adjclose || closes;

    // Deduplicate ordered bars before sanitizing 100x regime flips / transient spikes
    const byDate = new Map<string, { nav: number; adj: number }>();
    for (let i = 0; i < timestamps.length; i++) {
      const c = closes[i];
      const a = adjCloses[i];
      if (typeof c === "number" && c > 0 && isFinite(c)) {
        const dStr = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
        const navScaled = c * unitScale;
        const adjScaled = typeof a === "number" && a > 0 && isFinite(a) ? a * unitScale : navScaled;
        byDate.set(dStr, { nav: navScaled, adj: adjScaled });
      }
    }

    const sortedDates = Array.from(byDate.keys()).sort();
    const rawNavs = sortedDates.map((d) => byDate.get(d)!.nav);
    const rawAdjs = sortedDates.map((d) => byDate.get(d)!.adj);

    const rawDividends: Record<string, number> = {};
    const divEvents = result.events?.dividends || {};
    for (const key of Object.keys(divEvents)) {
      const ev = divEvents[key];
      const ts = ev?.date;
      const amt = ev?.amount;
      if (typeof ts === "number" && typeof amt === "number" && amt > 0) {
        const dStr = new Date(ts * 1000).toISOString().slice(0, 10);
        rawDividends[dStr] = amt * unitScale;
      }
    }

    const sanitized = sanitizeQuantSeries(sortedDates, rawNavs, rawAdjs, rawDividends);
    const prices: Record<string, number> = {};
    const adjPrices: Record<string, number> = {};
    for (let i = 0; i < sanitized.dates.length; i++) {
      prices[sanitized.dates[i]] = sanitized.nav[i];
      adjPrices[sanitized.dates[i]] = sanitized.adj_nav[i];
    }
    const lastCleanNav = sanitized.nav.length > 0 ? sanitized.nav[sanitized.nav.length - 1] : null;
    const rawRegular =
      typeof meta.regularMarketPrice === "number" && meta.regularMarketPrice > 0
        ? meta.regularMarketPrice * unitScale
        : null;
    let regularPrice = rawRegular ?? lastCleanNav;
    if (regularPrice != null && lastCleanNav != null && lastCleanNav > 0) {
      const r = regularPrice / lastCleanNav;
      if ((r >= 50 && r <= 200) || (r >= 0.005 && r <= 0.02)) {
        regularPrice = lastCleanNav;
      }
    }

    return {
      price: regularPrice,
      name: meta.longName || meta.shortName || null,
      currency: meta.currency ? normCurrency : null,
      prices,
      adjPrices,
      dividends: sanitized.dividends,
    };
  } catch {
    return null;
  }
}

export async function fetchStooqHistorical(isin: string): Promise<Record<string, number>> {
  const ticker = getStooqTicker(isin);
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(ticker)}&i=d`;
  const results: Record<string, number> = {};
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      // 没有超时保护时，无效/退市代码会让 Stooq 请求长时间挂起，
      // 单个坏 ISIN 就能把 /lab/analyze 拖到 80s+ 并撞上 Worker 的墙钟上限。
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return results;
    const text = await res.text();
    if (!text || text.length < 50) return results;
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return results;
    const headers = lines[0].split(",").map((h) => h.trim());
    const dateIdx = headers.indexOf("Date");
    const closeIdx = headers.indexOf("Close");
    if (dateIdx === -1 || closeIdx === -1) return results;

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      if (cols.length <= Math.max(dateIdx, closeIdx)) continue;
      const d = cols[dateIdx].trim();
      const val = parseFloat(cols[closeIdx].trim());
      if (d && !isNaN(val) && val > 0) {
        results[d] = val;
      }
    }
  } catch {
    // ignore
  }
  return results;
}

export async function getRealtimePrice(db: D1Database, isin: string): Promise<number> {
  const md = await getMarketData(db, isin);
  return md.price;
}

export async function getMarketData(db: D1Database, isin: string): Promise<MarketData> {
  const cached = memoryMarketCache.get(isin);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  // 0. Check Wonder Quant D1 catalog first (0 external HTTP calls, supports AIA codes & CN ETFs)
  try {
    const qFund = await resolveQuantFund(db, isin);
    if (qFund && qFund.latest_nav && qFund.latest_nav > 0) {
      const fxToUsd = await getFxRate(db, qFund.currency, "USD");
      const result: MarketData = {
        symbol: isin,
        price: qFund.latest_nav,
        currency: qFund.currency,
        base_price: qFund.latest_nav * fxToUsd,
        fx_rate: fxToUsd,
        name: qFund.name,
        sector: qFund.asset_class,
        country: qFund.ilas_platform || "Global",
        market_time: qFund.valuation_date || nowDateTimeStr(),
      };
      memoryMarketCache.set(isin, { data: result, expiresAt: Date.now() + 5 * 60 * 1000 });
      return result;
    }
  } catch {
    // ignore and fallback
  }

  const meta = await getAssetMetadata(db, isin);
  let currentPrice: number | null = null;
  let fetchedFresh = false;
  let name = meta.name;
  const sector = meta.sector;
  const country = meta.country;
  const todayStr = nowIsoDate();

  // 1. Check today's price in D1 price_cache
  try {
    const row = await db
      .prepare("SELECT price, date FROM price_cache WHERE isin = ? ORDER BY date DESC LIMIT 1")
      .bind(isin)
      .first<{ price: number | null; date: string | null }>();
    if (row && row.price && row.price > 0 && row.date && row.date.slice(0, 10) === todayStr) {
      currentPrice = Number(row.price);
    }
  } catch {
    // ignore
  }

  // 2. Fetch live quote from Yahoo Finance if not cached today
  const skipYf = isin.includes("US-T") || isin.startsWith("CASH_");
  if ((currentPrice === null || currentPrice <= 0) && !skipYf) {
    const yahooTicker = normalizeForYahoo(meta.ticker || isin);
    const yfData = await fetchYahooChart(yahooTicker, "5d", false);
    if (yfData) {
      if (yfData.price && yfData.price > 0) {
        currentPrice = yfData.price;
        fetchedFresh = true;
      }
      if (name === isin && yfData.name) {
        name = yfData.name;
      }
    }
  }

  // 3. Fallback to most recent price in D1 price_cache or prices table
  if ((currentPrice === null || currentPrice <= 0) && !skipYf) {
    try {
      const pcRow = await db
        .prepare("SELECT price FROM price_cache WHERE isin = ? AND price > 0 ORDER BY date DESC LIMIT 1")
        .bind(isin)
        .first<{ price: number }>();
      if (pcRow && pcRow.price > 0) {
        currentPrice = Number(pcRow.price);
      } else {
        const pRow = await db
          .prepare("SELECT price FROM prices WHERE isin = ? AND price > 0 ORDER BY date DESC LIMIT 1")
          .bind(isin)
          .first<{ price: number }>();
        if (pRow && pRow.price > 0) {
          currentPrice = Number(pRow.price);
        }
      }
    } catch {
      // ignore
    }
  }

  // 4. Fallback to historical series if still missing
  if ((currentPrice === null || currentPrice <= 0) && !skipYf) {
    try {
      const hist = await getHistoricalSeries(db, isin, 15);
      const dates = Object.keys(hist).sort().reverse();
      for (const d of dates) {
        if (hist[d] > 0) {
          currentPrice = hist[d];
          break;
        }
      }
    } catch {
      // ignore
    }
  }

  const finalPrice = currentPrice && currentPrice > 0 ? currentPrice : 0.0;

  // 仅在实际从远端拉取到新行情时才写入 D1 price_cache，命中本地缓存绝不重复写入，保护 D1 写额度
  if (fetchedFresh && finalPrice > 0 && !skipYf) {
    try {
      const sectorStr =
        sector === "Unknown Sector"
          ? null
          : typeof sector === "string"
          ? sector
          : JSON.stringify(sector);
      const countryStr =
        country === "Unknown Region"
          ? null
          : typeof country === "string"
          ? country
          : JSON.stringify(country);
      await db
        .prepare(
          "INSERT OR REPLACE INTO price_cache (isin, date, price, name, sector, country) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .bind(
          isin,
          nowDateTimeStr(),
          finalPrice,
          name !== isin ? name : null,
          sectorStr,
          countryStr
        )
        .run();
    } catch {
      // ignore
    }
  }

  const currency = guessCurrencyFromIsin(isin);
  const fxToUsd = await getFxRate(db, currency, "USD");
  const basePrice = finalPrice * fxToUsd;

  const result: MarketData = {
    symbol: isin,
    price: finalPrice,
    currency,
    base_price: basePrice,
    fx_rate: fxToUsd,
    name,
    sector,
    country,
    market_time: nowDateTimeStr(),
  };

  memoryMarketCache.set(isin, { data: result, expiresAt: Date.now() + 5 * 60 * 1000 });
  return result;
}

export async function getHistoricalSeries(
  db: D1Database,
  isin: string,
  daysBack: number = 365,
  useTotalReturn: boolean = true
): Promise<Record<string, number>> {
  const cacheKey = `${isin}:${daysBack}:${useTotalReturn ? "tr" : "px"}`;
  const mem = memoryHistoryCache.get(cacheKey);
  if (mem && mem.expiresAt > Date.now()) {
    return mem.series;
  }

  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - daysBack * 86400 * 1000);
  const startStr = startDate.toISOString().slice(0, 10);
  const endStr = endDate.toISOString().slice(0, 10);

  const results: Record<string, number> = {};

  // 0. Check Wonder Quant packed single-row series first (1 D1 row read, 0 external HTTP calls!)
  let quantYahooTicker: string | null = null;
  try {
    const qFund = await resolveQuantFund(db, isin);
    if (qFund) {
      if (qFund.yahoo_ticker) {
        quantYahooTicker = qFund.yahoo_ticker;
      }
      const qSeries = await getQuantFundSeries(db, qFund.slug);
      if (qSeries && qSeries.dates.length > 0) {
        const vals = useTotalReturn ? qSeries.adj_nav : qSeries.nav;
        for (let i = 0; i < qSeries.dates.length; i++) {
          const d = qSeries.dates[i];
          const v = vals[i];
          if (d > "1990-01-01" && d >= startStr && d <= endStr && typeof v === "number" && v > 0) {
            results[d] = v;
          }
        }
        const firstAvailable = qSeries.dates[0];
        const coverageToleranceDate = new Date(startDate.getTime() + 60 * 86400 * 1000)
          .toISOString()
          .slice(0, 10);
        const hitCount = Object.keys(results).length;
        // Return immediately when D1 already covers the requested horizon OR holds full inception history (>=60 pts)
        if (hitCount >= 5 && (firstAvailable <= coverageToleranceDate || qSeries.dates.length >= 60)) {
          memoryHistoryCache.set(cacheKey, { series: results, expiresAt: Date.now() + 30 * 60 * 1000 });
          return results;
        }
      }
    }
  } catch {
    // ignore and fallback
  }

  // 1. Load from D1 `prices` and `price_cache` first (vital for European UCITS / custom ISINs)
  try {
    const dbPrices = await db
      .prepare(
        "SELECT substr(date, 1, 10) as d, price FROM prices WHERE isin = ? AND date >= ? AND substr(date, 1, 10) > '1990-01-01' AND price > 0 ORDER BY date ASC"
      )
      .bind(isin, startStr)
      .all<{ d: string; price: number }>();

    for (const r of dbPrices.results || []) {
      if (r.d && r.d > "1990-01-01" && r.price > 0) {
        results[r.d] = Number(r.price);
      }
    }

    // 仅从 price_cache 查最新 1 条行情补齐当天快照（单次查 1 行，严控 D1 读额度）
    const latestCache = await db
      .prepare(
        "SELECT substr(date, 1, 10) as d, price FROM price_cache WHERE isin = ? AND date >= ? AND substr(date, 1, 10) > '1990-01-01' AND price > 0 ORDER BY date DESC LIMIT 1"
      )
      .bind(isin, startStr)
      .first<{ d: string; price: number }>();

    if (latestCache && latestCache.d && latestCache.d > "1990-01-01" && latestCache.price > 0) {
      results[latestCache.d] = Number(latestCache.price);
    }
  } catch {
    // ignore
  }

  // 2. If D1 doesn't have sufficient historical data points covering the requested period, fetch from Yahoo Finance.
  // When an asset has only 1 or a few intraday records in price_cache, we MUST still fetch the full historical series.
  const minRequiredPoints = Math.min(Math.max(20, Math.floor(daysBack * 0.35)), 200);
  if (Object.keys(results).length < minRequiredPoints && !isin.startsWith("CASH_")) {
    const meta = await getAssetMetadata(db, isin);
    let rawYahooSymbol: string | null = meta.ticker || null;
    if (!rawYahooSymbol && ISIN_PATTERN.test(isin)) {
      rawYahooSymbol = (await resolveYahooSymbolByIsin(isin)) || quantYahooTicker || isin;
    } else if (!rawYahooSymbol) {
      rawYahooSymbol = quantYahooTicker || isin;
    }
    const yahooTicker = normalizeForYahoo(rawYahooSymbol);
    const rangeStr =
      daysBack <= 30
        ? "1mo"
        : daysBack <= 95
        ? "3mo"
        : daysBack <= 185
        ? "6mo"
        : daysBack <= 370
        ? "1y"
        : daysBack <= 740
        ? "2y"
        : daysBack <= 1850
        ? "5y"
        : daysBack <= 3700
        ? "10y"
        : "max";

    const yfData = await fetchYahooChart(yahooTicker, rangeStr, true);
    if (yfData) {
      const srcSeries = useTotalReturn && yfData.adjPrices ? yfData.adjPrices : yfData.prices;

      // Scale-Guard: if D1 `prices` already has rows for this ISIN (e.g. A6 distributing share class),
      // verify overlapping quote scale so an unaligned accumulation/proxy ticker never creates artificial jumps.
      let scale = 1.0;
      const d1Dates = Object.keys(results).sort();
      if (d1Dates.length > 0) {
        const srcDates = Object.keys(srcSeries).filter((d) => srcSeries[d] > 0).sort();
        let d1Anchor: number | null = null;
        let yfAnchor: number | null = null;
        for (let i = d1Dates.length - 1; i >= 0; i--) {
          const d = d1Dates[i];
          if (srcSeries[d] && srcSeries[d] > 0) {
            d1Anchor = results[d];
            yfAnchor = srcSeries[d];
            break;
          }
        }
        if ((d1Anchor === null || yfAnchor === null) && srcDates.length > 0) {
          const d1RefStr = d1Dates[0];
          const d1RefMs = Date.parse(d1RefStr);
          let bestDiff = Infinity;
          for (const sd of srcDates) {
            const diff = Math.abs(Date.parse(sd) - d1RefMs);
            if (diff <= 14 * 86400 * 1000 && diff < bestDiff) {
              bestDiff = diff;
              d1Anchor = results[d1RefStr];
              yfAnchor = srcSeries[sd];
            }
          }
        }
        if (d1Anchor && yfAnchor && yfAnchor > 0 && Math.abs(yfAnchor / d1Anchor - 1) > 0.25) {
          scale = d1Anchor / yfAnchor;
        }
      }

      for (const [d, p] of Object.entries(srcSeries)) {
        if (d > "1990-01-01" && d >= startStr && d <= endStr && p > 0 && results[d] === undefined) {
          results[d] = Math.round(p * scale * 1000000) / 1000000;
        }
      }

      // 将随附的分红数据写入 Worker 内存缓存（0 次 D1 写操作，彻底杜绝刷爆 D1 写入配额）
      // 真正的 D1 离线持久化由用户明确查看分红明细时的 getDividendHistory 按需把控
      if (yfData.dividends && Object.keys(yfData.dividends).length > 0) {
        memoryDividendCache.set(`${isin}:${startStr}`, {
          divs: yfData.dividends,
          expiresAt: Date.now() + 30 * 60 * 1000,
        });
      }
    }
  }

  // 3. Fallback to Stooq if still insufficient (< 20 points)
  if (Object.keys(results).length < 20 && !isin.startsWith("CASH_")) {
    const stooq = await fetchStooqHistorical(isin);
    for (const [d, p] of Object.entries(stooq)) {
      if (d >= startStr && d <= endStr && p > 0 && results[d] === undefined) {
        results[d] = p;
      }
    }
  }

  // 提升时序内存缓存时长到 30 分钟（同一 Worker 实例下重复计算实现 0 D1 读、0 D1 写）
  memoryHistoryCache.set(cacheKey, { series: results, expiresAt: Date.now() + 30 * 60 * 1000 });
  return results;
}

export async function getHistoricalPrice(
  db: D1Database,
  isin: string,
  dateStr: string
): Promise<number> {
  const target = dateStr.slice(0, 10);
  const today = nowIsoDate();
  if (target >= today) {
    const md = await getMarketData(db, isin);
    if (md.price > 0) return md.price;
  }

  // Check D1 prices / price_cache up to 10 days before target
  try {
    const row = await db
      .prepare(
        "SELECT price FROM prices WHERE isin = ? AND substr(date, 1, 10) <= ? AND price > 0 ORDER BY date DESC LIMIT 1"
      )
      .bind(isin, target)
      .first<{ price: number }>();
    if (row && row.price > 0) return Number(row.price);

    const cacheRow = await db
      .prepare(
        "SELECT price FROM price_cache WHERE isin = ? AND substr(date, 1, 10) <= ? AND price > 0 ORDER BY date DESC LIMIT 1"
      )
      .bind(isin, target)
      .first<{ price: number }>();
    if (cacheRow && cacheRow.price > 0) return Number(cacheRow.price);
  } catch {
    // ignore
  }

  // Fetch historical series and pick closest date <= target (or earliest available)
  const daysDiff = Math.max(
    30,
    Math.ceil((Date.now() - new Date(target).getTime()) / (86400 * 1000)) + 15
  );
  const series = await getHistoricalSeries(db, isin, daysDiff);
  const sortedDates = Object.keys(series).sort();
  if (sortedDates.length === 0) {
    const md = await getMarketData(db, isin);
    return md.price || 0;
  }

  const beforeOrAt = sortedDates.filter((d) => d <= target);
  if (beforeOrAt.length > 0) {
    return series[beforeOrAt[beforeOrAt.length - 1]];
  }
  return series[sortedDates[0]];
}

export async function getDividendHistory(
  db: D1Database,
  isin: string,
  startDate: string
): Promise<Record<string, number>> {
  const startStr = startDate.slice(0, 10);
  const cacheKey = `${isin}:${startStr}`;
  const mem = memoryDividendCache.get(cacheKey);
  if (mem && mem.expiresAt > Date.now()) {
    return mem.divs;
  }

  const results: Record<string, number> = {};

  // 1. Check D1 dividend_cache
  try {
    const rows = await db
      .prepare(
        "SELECT substr(date, 1, 10) as d, amount FROM dividend_cache WHERE isin = ? AND date >= ? ORDER BY date ASC"
      )
      .bind(isin, startStr)
      .all<{ d: string; amount: number }>();
    for (const r of rows.results || []) {
      if (r.d && r.amount > 0) {
        results[r.d] = Number(r.amount);
      }
    }
  } catch {
    // ignore
  }

  // 2. If empty and not CASH, try Yahoo Finance 10y chart with events=div
  if (Object.keys(results).length === 0 && !isin.startsWith("CASH_")) {
    const meta = await getAssetMetadata(db, isin);
    const yahooTicker = normalizeForYahoo(meta.ticker || isin);
    const yfData = await fetchYahooChart(yahooTicker, "10y", true);
    if (yfData && Object.keys(yfData.dividends).length > 0) {
      const stmts: D1PreparedStatement[] = [];
      for (const [d, amt] of Object.entries(yfData.dividends)) {
        if (d >= startStr) {
          results[d] = amt;
        }
        stmts.push(
          db
            .prepare("INSERT OR REPLACE INTO dividend_cache (isin, date, amount) VALUES (?, ?, ?)")
            .bind(isin, d, amt)
        );
      }
      if (stmts.length > 0) {
        try {
          await db.batch(stmts.slice(-100));
        } catch {
          // ignore
        }
      }
    }
  }

  memoryDividendCache.set(cacheKey, { divs: results, expiresAt: Date.now() + 10 * 60 * 1000 });
  return results;
}

export async function getDividendMetrics(
  db: D1Database,
  isin: string
): Promise<DividendMetrics> {
  try {
    // 0. Check Wonder Quant pre-computed TTM dividend yield (guarded < 0.20) or sanitized series dividends
    const qFund = await resolveQuantFund(db, isin);
    if (
      qFund &&
      qFund.latest_nav &&
      qFund.latest_nav > 0 &&
      qFund.div_yield_ttm != null &&
      qFund.div_yield_ttm > 0 &&
      qFund.div_yield_ttm < 0.20
    ) {
      return {
        trailing_sum: qFund.div_yield_ttm * qFund.latest_nav,
        next_date: null,
        next_amount: null,
      };
    }

    if (qFund?.slug) {
      const qSeries = await getQuantFundSeries(db, qFund.slug);
      if (qSeries && qSeries.dates.length > 0 && Object.keys(qSeries.dividends).length > 0) {
        const endDate = qSeries.dates[qSeries.dates.length - 1];
        const cutoff = new Date(new Date(`${endDate}T00:00:00Z`).getTime() - 365 * 86400 * 1000)
          .toISOString()
          .slice(0, 10);
        let qTrailingSum = 0;
        for (const [dt, amt] of Object.entries(qSeries.dividends)) {
          if (dt >= cutoff && dt <= endDate && amt > 0) {
            qTrailingSum += amt;
          }
        }
        if (qTrailingSum > 0) {
          return {
            trailing_sum: qTrailingSum,
            next_date: null,
            next_amount: null,
          };
        }
      }
    }

    const oneYearAgo = new Date(Date.now() - 365 * 86400 * 1000).toISOString().slice(0, 10);
    const divHistory = await getDividendHistory(db, isin, oneYearAgo);
    const todayStr = nowIsoDate();

    let trailingSum = 0;
    let nextDate: string | null = null;
    let nextAmount: number | null = null;

    for (const [d, amt] of Object.entries(divHistory)) {
      if (d <= todayStr) {
        trailingSum += amt;
      } else if (!nextDate || d < nextDate) {
        nextDate = d;
        nextAmount = amt;
      }
    }

    return {
      trailing_sum: trailingSum,
      next_date: nextDate,
      next_amount: nextAmount,
    };
  } catch {
    return {
      trailing_sum: 0,
      next_date: null,
      next_amount: null,
    };
  }
}
