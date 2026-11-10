import { getAssetMetadata, getFxRate, getMarketData, getRealtimePrice, guessCurrencyFromIsin } from "./dataProvider";

export interface Transaction {
  date: string;
  isin: string;
  type: string;
  shares: number;
  price: number;
}

export interface PortfolioMeta {
  id: number;
  name: string;
  base_currency: string;
  dividend_strategy: string;
  target_allocations: Record<string, number>;
  created_at: string;
}

export interface HoldingItem {
  isin: string;
  name: string;
  sector: string;
  country: string;
  shares: number;
  price: number;
  market_value: number;
  total_cost: number;
  dividends: number;
  pnl: number;
  yield: number;
  weight?: number;
  target_weight?: number;
  rebalance_diff?: number;
}

export class PortfolioEngine {
  db: D1Database;
  portfolioId: number;
  meta!: PortfolioMeta;
  transactions: Transaction[] = [];

  constructor(db: D1Database, portfolioId: number) {
    this.db = db;
    this.portfolioId = portfolioId;
  }

  async init() {
    const row = await this.db
      .prepare(
        "SELECT id, name, dividend_strategy, target_allocations, created_at, base_currency FROM portfolios WHERE id = ?"
      )
      .bind(this.portfolioId)
      .first<any>();

    if (row) {
      let targets: Record<string, number> = {};
      if (row.target_allocations) {
        try {
          targets = JSON.parse(row.target_allocations);
        } catch {}
      }
      this.meta = {
        id: Number(row.id),
        name: row.name,
        base_currency: row.base_currency || "USD",
        dividend_strategy: row.dividend_strategy || "CASH",
        target_allocations: targets,
        created_at: row.created_at || new Date().toISOString().slice(0, 10),
      };
    } else {
      this.meta = {
        id: this.portfolioId,
        name: "Unknown",
        base_currency: "USD",
        dividend_strategy: "CASH",
        target_allocations: {},
        created_at: new Date().toISOString().slice(0, 10),
      };
    }

    const { results } = await this.db
      .prepare(
        "SELECT date, isin, type, shares, price FROM transactions WHERE portfolio_id = ? ORDER BY date ASC, id ASC"
      )
      .bind(this.portfolioId)
      .all<any>();

    this.transactions = (results || []).map((t) => ({
      date: t.date,
      isin: String(t.isin || "").trim(),
      type: String(t.type || "").toUpperCase(),
      shares: Number(t.shares || 0),
      price: Number(t.price || 0),
    }));
  }

  async getCurrentPortfolio(): Promise<{
    portfolio: Record<string, { shares: number; avg_cost: number; total_cost: number; total_div_cash: number }>;
    cashBalances: Record<string, number>;
  }> {
    const portfolio: Record<string, { shares: number; avg_cost: number; total_cost: number; total_div_cash: number }> =
      {};
    const cashBalances: Record<string, number> = {};

    for (const row of this.transactions) {
      const isin = row.isin;
      const q = row.shares;
      const p = row.price;
      const t = row.type;

      if (t === "CASH_IN") {
        const cKey = isin.startsWith("CASH_") ? isin : "CASH_USD";
        cashBalances[cKey] = (cashBalances[cKey] || 0) + p;
        continue;
      }
      if (t === "CASH_OUT") {
        const cKey = isin.startsWith("CASH_") ? isin : "CASH_USD";
        cashBalances[cKey] = (cashBalances[cKey] || 0) + p; // p already negative for outflows
        continue;
      }

      if (!portfolio[isin]) {
        portfolio[isin] = { shares: 0, avg_cost: 0, total_cost: 0, total_div_cash: 0 };
      }
      const curr = portfolio[isin];

      if (t === "BUY") {
        const cashNeeded = q * p;
        const currency = guessCurrencyFromIsin(isin);
        const cKey = `CASH_${currency}`;
        cashBalances[cKey] = (cashBalances[cKey] || 0) - cashNeeded;
        const newShares = curr.shares + q;
        if (newShares > 0) {
          curr.avg_cost = (curr.shares * curr.avg_cost + q * p) / newShares;
        }
        curr.shares = newShares;
      } else if (t === "SELL") {
        const cashGained = q * p;
        const currency = guessCurrencyFromIsin(isin);
        const cKey = `CASH_${currency}`;
        cashBalances[cKey] = (cashBalances[cKey] || 0) + cashGained;
        curr.shares -= q;
      } else if (t === "DIV_CASH") {
        const currency = guessCurrencyFromIsin(isin);
        const cKey = `CASH_${currency}`;
        const divAmt = q * p;
        curr.total_div_cash += divAmt;
        cashBalances[cKey] = (cashBalances[cKey] || 0) + divAmt;
      }
    }

    // Manual dividends from manual_dividends table
    const manDivs = await this.db
      .prepare(
        "SELECT isin, amount_per_share, currency FROM manual_dividends WHERE portfolio_id = ?"
      )
      .bind(this.portfolioId)
      .all<any>();

    for (const md of manDivs.results || []) {
      const isin = String(md.isin);
      if (portfolio[isin]) {
        const divAmt = portfolio[isin].shares * Number(md.amount_per_share || 0);
        portfolio[isin].total_div_cash += divAmt;
        const curr = md.currency || guessCurrencyFromIsin(isin);
        const cKey = `CASH_${curr}`;
        cashBalances[cKey] = (cashBalances[cKey] || 0) + divAmt;
      }
    }

    // Filter active holdings
    const activeHoldings: Record<string, any> = {};
    for (const [isin, data] of Object.entries(portfolio)) {
      if (data.shares > 0 || data.total_div_cash > 0) {
        data.total_cost = data.shares * data.avg_cost;
        activeHoldings[isin] = data;
      }
    }

    return { portfolio: activeHoldings, cashBalances };
  }

  async calculateNav(): Promise<{
    total_nav: number;
    wallet_balance: number;
    total_cost: number;
    total_pnl: number;
    total_divs: number;
    cumulative_roi: number;
    annualized_return: number;
    details: HoldingItem[];
    sector_allocation: Record<string, number>;
    country_allocation: Record<string, number>;
  }> {
    const { portfolio, cashBalances } = await this.getCurrentPortfolio();
    const baseCcy = this.meta.base_currency || "USD";

    let totalNav = 0;
    let walletBalance = 0;
    let totalCost = 0;
    let totalDivs = 0;
    const details: HoldingItem[] = [];

    // Process Cash
    for (const [cIsin, bal] of Object.entries(cashBalances)) {
      if (bal === 0) continue;
      const ccy = cIsin.replace("CASH_", "");
      const fx = await getFxRate(this.db, ccy, baseCcy);
      const marketVal = bal * fx;
      walletBalance += marketVal;
      totalNav += marketVal;
      totalCost += marketVal;

      details.push({
        isin: cIsin,
        name: `Wallet (${ccy})`,
        sector: "Cash & Equivalents",
        country: "Global",
        shares: Math.round(bal * 100) / 100,
        price: fx,
        market_value: Math.round(marketVal * 100) / 100,
        total_cost: Math.round(marketVal * 100) / 100,
        dividends: 0,
        pnl: 0,
        yield: 0,
      });
    }

    // Process Stock/ETF Assets
    for (const [isin, data] of Object.entries(portfolio)) {
      if (data.shares <= 0) continue;

      const mData = await getMarketData(this.db, isin);
      const ccy = mData.currency || guessCurrencyFromIsin(isin);
      const fx = await getFxRate(this.db, ccy, baseCcy);
      let currPrice = mData.price * fx;

      if (currPrice === 0 && data.avg_cost > 0) {
        currPrice = data.avg_cost * fx;
      }

      const marketVal = data.shares * currPrice;
      const cost = data.total_cost * fx;
      const divFx = await getFxRate(this.db, guessCurrencyFromIsin(isin), baseCcy);
      const divTotal = data.total_div_cash * divFx;

      totalNav += marketVal;
      totalCost += cost;
      totalDivs += divTotal;

      const pnl = marketVal - cost;
      const itemYield = cost > 0 ? ((marketVal + divTotal - cost) / cost) * 100 : 0;

      const meta = await getAssetMetadata(this.db, isin);
      const name = meta.name || mData.name || isin;
      const sector =
        typeof mData.sector === "string"
          ? mData.sector
          : typeof meta.sector === "string"
          ? meta.sector
          : Object.keys(meta.sector || {})[0] || "Unknown Sector";
      const country =
        typeof mData.country === "string"
          ? mData.country
          : typeof meta.country === "string"
          ? meta.country
          : Object.keys(meta.country || {})[0] || "Global";

      details.push({
        isin,
        name,
        sector,
        country,
        shares: Math.round(data.shares),
        price: Math.round(currPrice * 100) / 100,
        market_value: Math.round(marketVal * 100) / 100,
        total_cost: Math.round(cost * 100) / 100,
        dividends: Math.round(divTotal * 100) / 100,
        pnl: Math.round(pnl * 100) / 100,
        yield: Math.round(itemYield * 100) / 100,
      });
    }

    // Weight and Rebalance targets
    for (const d of details) {
      d.weight = totalNav > 0 ? Math.round((d.market_value / totalNav) * 1000) / 10 : 0;
      const targetPct = this.meta.target_allocations[d.isin] ?? null;
      if (targetPct != null) {
        d.target_weight = targetPct;
        d.rebalance_diff = Math.round((d.weight - targetPct) * 10) / 10;
      }
    }

    const totalPnl = totalNav - totalCost + totalDivs;
    const cumulativeRoi = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

    // CAGR
    const firstTxDate = this.transactions[0]?.date ? new Date(this.transactions[0].date) : new Date();
    const daysElapsed = Math.max(1, (Date.now() - firstTxDate.getTime()) / (1000 * 3600 * 24));
    const yearsElapsed = daysElapsed / 365.25;
    let cagr = 0;
    if (yearsElapsed >= 0.1 && totalCost > 0 && totalNav + totalDivs > 0) {
      cagr = (Math.pow((totalNav + totalDivs) / totalCost, 1 / yearsElapsed) - 1) * 100;
    } else {
      cagr = cumulativeRoi;
    }

    // Breakdown allocations
    const sectorMap: Record<string, number> = {};
    const countryMap: Record<string, number> = {};
    for (const d of details) {
      sectorMap[d.sector] = Math.round(((sectorMap[d.sector] || 0) + d.market_value) * 100) / 100;
      countryMap[d.country] = Math.round(((countryMap[d.country] || 0) + d.market_value) * 100) / 100;
    }

    // Update stats cache
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO portfolio_stats_cache (
          portfolio_id, total_nav, wallet_balance, total_pnl, total_divs,
          cumulative_roi, annualized_return, details, last_updated
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        this.portfolioId,
        Math.round(totalNav * 100) / 100,
        Math.round(walletBalance * 100) / 100,
        Math.round(totalPnl * 100) / 100,
        Math.round(totalDivs * 100) / 100,
        Math.round(cumulativeRoi * 100) / 100,
        Math.round(cagr * 100) / 100,
        JSON.stringify(details),
        new Date().toISOString()
      )
      .run();

    return {
      total_nav: Math.round(totalNav * 100) / 100,
      wallet_balance: Math.round(walletBalance * 100) / 100,
      total_cost: Math.round(totalCost * 100) / 100,
      total_pnl: Math.round(totalPnl * 100) / 100,
      total_divs: Math.round(totalDivs * 100) / 100,
      cumulative_roi: Math.round(cumulativeRoi * 100) / 100,
      annualized_return: Math.round(cagr * 100) / 100,
      details,
      sector_allocation: sectorMap,
      country_allocation: countryMap,
    };
  }
}
