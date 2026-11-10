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
  const f = fromCurr.toUpperCase().trim();
  const t = toCurr.toUpperCase().trim();
  if (f === t) return 1.0;

  const ticker = `${f}${t}=X`;
  const mem = memoryFxCache.get(ticker);
  if (mem && mem.expiresAt > Date.now()) {
    return mem.rate;
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
      return Number(row.price);
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
        return rate;
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
      return Number(row.price);
    }
  } catch {
    // ignore
  }

  return getStaticFxRate(f, t);
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
  dividends: Record<string, number>;
} | null> {
  try {
    const eventsParam = includeEvents ? "&events=div" : "";
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      yahooTicker
    )}?interval=1d&range=${rangeStr}${eventsParam}`;
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return null;

    const meta = result.meta || {};
    const timestamps: number[] = result.timestamp || [];
    const closes: (number | null)[] = result.indicators?.quote?.[0]?.close || [];
    const prices: Record<string, number> = {};
    let lastClose: number | null = null;

    for (let i = 0; i < timestamps.length; i++) {
      const c = closes[i];
      if (typeof c === "number" && c > 0 && isFinite(c)) {
        const dStr = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
        prices[dStr] = c;
        lastClose = c;
      }
    }

    const regularPrice =
      typeof meta.regularMarketPrice === "number" && meta.regularMarketPrice > 0
        ? meta.regularMarketPrice
        : lastClose;
    const name = meta.longName || meta.shortName || null;
    const currency = meta.currency || null;

    const dividends: Record<string, number> = {};
    const divEvents = result.events?.dividends || {};
    for (const key of Object.keys(divEvents)) {
      const ev = divEvents[key];
      const ts = ev?.date;
      const amt = ev?.amount;
      if (typeof ts === "number" && typeof amt === "number" && amt > 0) {
        const dStr = new Date(ts * 1000).toISOString().slice(0, 10);
        dividends[dStr] = amt;
      }
    }

    return {
      price: regularPrice,
      name,
      currency,
      prices,
      dividends,
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
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
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

  const meta = await getAssetMetadata(db, isin);
  let currentPrice: number | null = null;
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

  if (finalPrice > 0 && !skipYf) {
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
  daysBack: number = 365
): Promise<Record<string, number>> {
  const cacheKey = `${isin}:${daysBack}`;
  const mem = memoryHistoryCache.get(cacheKey);
  if (mem && mem.expiresAt > Date.now()) {
    return mem.series;
  }

  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - daysBack * 86400 * 1000);
  const startStr = startDate.toISOString().slice(0, 10);
  const endStr = endDate.toISOString().slice(0, 10);

  const results: Record<string, number> = {};

  // 1. Load from D1 `prices` and `price_cache` first (vital for European UCITS / custom ISINs)
  try {
    const dbPrices = await db
      .prepare(
        "SELECT substr(date, 1, 10) as d, price FROM prices WHERE isin = ? AND date >= ? AND price > 0 ORDER BY date ASC"
      )
      .bind(isin, startStr)
      .all<{ d: string; price: number }>();

    for (const r of dbPrices.results || []) {
      if (r.d && r.price > 0) {
        results[r.d] = Number(r.price);
      }
    }

    const dbCache = await db
      .prepare(
        "SELECT substr(date, 1, 10) as d, price FROM price_cache WHERE isin = ? AND date >= ? AND price > 0 ORDER BY date ASC"
      )
      .bind(isin, startStr)
      .all<{ d: string; price: number }>();

    for (const r of dbCache.results || []) {
      if (r.d && r.price > 0) {
        results[r.d] = Number(r.price);
      }
    }
  } catch {
    // ignore
  }

  // If D1 already has price data points covering the asset, return immediately
  if (Object.keys(results).length === 0 && !isin.startsWith("CASH_")) {
    const meta = await getAssetMetadata(db, isin);
    const yahooTicker = normalizeForYahoo(meta.ticker || isin);
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
        : "10y";

    const yfData = await fetchYahooChart(yahooTicker, rangeStr, true);
    if (yfData) {
      for (const [d, p] of Object.entries(yfData.prices)) {
        if (d >= startStr && d <= endStr && p > 0) {
          results[d] = p;
        }
      }

      // Cache dividends if any returned
      const divEntries = Object.entries(yfData.dividends);
      if (divEntries.length > 0) {
        try {
          const stmts = divEntries.slice(-50).map(([d, amt]) =>
            db
              .prepare("INSERT OR REPLACE INTO dividend_cache (isin, date, amount) VALUES (?, ?, ?)")
              .bind(isin, d, amt)
          );
          if (stmts.length > 0) {
            await db.batch(stmts);
          }
        } catch {
          // ignore
        }
      }
    }
  }

  // Fallback to Stooq if still completely empty
  if (Object.keys(results).length === 0 && !isin.startsWith("CASH_")) {
    const stooq = await fetchStooqHistorical(isin);
    for (const [d, p] of Object.entries(stooq)) {
      if (d >= startStr && d <= endStr && p > 0 && results[d] === undefined) {
        results[d] = p;
      }
    }
  }

  memoryHistoryCache.set(cacheKey, { series: results, expiresAt: Date.now() + 10 * 60 * 1000 });
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
