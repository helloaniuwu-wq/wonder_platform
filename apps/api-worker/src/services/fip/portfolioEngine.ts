import {
  getAssetMetadata,
  getDividendHistory,
  getDividendMetrics,
  getFxRate,
  getMarketData,
  getRealtimePrice,
  guessCurrencyFromIsin,
} from "./dataProvider";

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

  async getDividendDetails(): Promise<
    Array<{
      id?: number;
      isin: string;
      name?: string;
      date: string;
      amount_per_share: number;
      shares_held: number;
      total_amount: number;
      currency: string;
      source: string;
    }>
  > {
    const list: Array<any> = [];

    // 1. Manual dividends
    const manRows = await this.db
      .prepare(
        "SELECT id, isin, date, amount_per_share, currency FROM manual_dividends WHERE portfolio_id = ? ORDER BY date DESC"
      )
      .bind(this.portfolioId)
      .all<any>();

    const holdingsMap: Record<string, number> = {};
    for (const tx of this.transactions) {
      if (tx.type === "BUY") holdingsMap[tx.isin] = (holdingsMap[tx.isin] || 0) + tx.shares;
      else if (tx.type === "SELL") holdingsMap[tx.isin] = Math.max(0, (holdingsMap[tx.isin] || 0) - tx.shares);
    }

    for (const r of manRows.results || []) {
      const shares = holdingsMap[r.isin] || 0;
      const meta = await getAssetMetadata(this.db, r.isin);
      list.push({
        id: r.id,
        isin: r.isin,
        name: meta.name || r.isin,
        date: r.date,
        amount_per_share: Number(r.amount_per_share || 0),
        shares_held: shares,
        total_amount: Math.round(shares * Number(r.amount_per_share || 0) * 100) / 100,
        currency: r.currency || guessCurrencyFromIsin(r.isin),
        source: "Manual",
      });
    }

    // 2. Recorded dividend transactions
    for (const tx of this.transactions) {
      if (tx.type === "DIV_CASH") {
        const meta = await getAssetMetadata(this.db, tx.isin);
        list.push({
          isin: tx.isin,
          name: meta.name || tx.isin,
          date: tx.date,
          amount_per_share: tx.price,
          shares_held: tx.shares,
          total_amount: Math.round(tx.shares * tx.price * 100) / 100,
          currency: guessCurrencyFromIsin(tx.isin),
          source: "Recorded",
        });
      }
    }

    return list.sort((a, b) => b.date.localeCompare(a.date));
  }

  async getDividendProjections(taxRate: number = 0.0, drip: boolean = false) {
    const { portfolio } = await this.getCurrentPortfolio();
    const isins = Object.keys(portfolio).filter((i) => !i.startsWith("CASH_") && portfolio[i].shares > 0);
    const baseCcy = this.meta.base_currency || "USD";

    // 12 months buckets
    const now = new Date();
    const projectionMonths: Record<string, number> = {};
    for (let i = 1; i <= 12; i++) {
      const future = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const mKey = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, "0")}`;
      projectionMonths[mKey] = 0;
    }

    // Manual dividends by ISIN
    const manDivs = await this.db
      .prepare(
        "SELECT id, isin, date, amount_per_share, currency FROM manual_dividends WHERE portfolio_id = ? ORDER BY date ASC"
      )
      .bind(this.portfolioId)
      .all<any>();
    const manByIsin: Record<string, Array<{ date: string; amount: number }>> = {};
    for (const r of manDivs.results || []) {
      if (!manByIsin[r.isin]) manByIsin[r.isin] = [];
      manByIsin[r.isin].push({ date: r.date, amount: Number(r.amount_per_share || 0) });
    }

    let totalAnnualIncome = 0;
    let totalMarketValue = 0;
    let totalCostBasis = 0;
    const assetsMetrics: any[] = [];
    const oneYearAgoStr = new Date(Date.now() - 365 * 86400 * 1000).toISOString().slice(0, 10);
    const todayStr = new Date().toISOString().slice(0, 10);

    for (const isin of isins) {
      const item = portfolio[isin];
      const initialShares = item.shares;
      const avgCost = item.avg_cost;

      const mData = await getMarketData(this.db, isin);
      const currPrice = mData.price || avgCost || 0;
      const assetCcy = mData.currency || guessCurrencyFromIsin(isin);
      const fx = await getFxRate(this.db, assetCcy, baseCcy);
      const basePrice = currPrice * fx;

      totalMarketValue += initialShares * basePrice;
      totalCostBasis += initialShares * avgCost * fx;

      const divMetrics = await getDividendMetrics(this.db, isin);
      let trailingSum = divMetrics.trailing_sum || 0;

      const histDivs = await getDividendHistory(this.db, isin, oneYearAgoStr);

      let isManual = false;
      let manualGrowthRate = 0;
      let manualFreqLabel = "";

      let events: Array<{ date: string; amount_per_share: number; type: string }> = [];
      const processedSlots = new Set<string>();

      if (divMetrics.next_date && divMetrics.next_amount) {
        const mKey = divMetrics.next_date.slice(0, 7);
        events.push({
          date: divMetrics.next_date,
          amount_per_share: divMetrics.next_amount,
          type: "Official",
        });
        processedSlots.add(mKey);
      }

      for (const [d, amt] of Object.entries(histDivs)) {
        if (amt > 0) {
          const dObj = new Date(d);
          dObj.setFullYear(dObj.getFullYear() + 1);
          const shiftedDate = dObj.toISOString().slice(0, 10);
          const mKey = shiftedDate.slice(0, 7);
          if (shiftedDate > todayStr && projectionMonths[mKey] !== undefined && !processedSlots.has(mKey)) {
            events.push({
              date: shiftedDate,
              amount_per_share: amt,
              type: "Projected",
            });
          }
        }
      }

      if (manByIsin[isin] && manByIsin[isin].length > 0) {
        isManual = true;
        const manList = manByIsin[isin];
        if (trailingSum === 0) {
          trailingSum = manList.reduce((sum, x) => sum + x.amount, 0);
        }

        const avgGap =
          manList.length > 1
            ? (new Date(manList[manList.length - 1].date).getTime() - new Date(manList[0].date).getTime()) /
              ((manList.length - 1) * 86400000)
            : 365;

        let freqDays = 365;
        if (avgGap <= 45) {
          freqDays = 30;
          manualFreqLabel = "Monthly";
        } else if (avgGap <= 120) {
          freqDays = 91;
          manualFreqLabel = "Quarterly";
        } else if (avgGap <= 250) {
          freqDays = 182;
          manualFreqLabel = "Semi-Annual";
        } else {
          freqDays = 365;
          manualFreqLabel = "Annual";
        }

        if (manList.length >= 2) {
          const rates: number[] = [];
          for (let k = 0; k < manList.length - 1; k++) {
            if (manList[k].amount > 0) {
              rates.push((manList[k + 1].amount - manList[k].amount) / manList[k].amount);
            }
          }
          if (rates.length > 0) {
            manualGrowthRate = Math.max(-0.5, Math.min(0.5, rates.reduce((a, b) => a + b, 0) / rates.length));
          }
        }

        let lastDate = new Date(manList[manList.length - 1].date);
        let currAmt = manList[manList.length - 1].amount * (1 + manualGrowthRate);
        const oneYearOut = new Date(Date.now() + 365 * 86400000);

        const manualFutureByMonth: Record<string, { date: string; amount_per_share: number; type: string }> = {};
        lastDate = new Date(lastDate.getTime() + freqDays * 86400000);
        while (lastDate <= oneYearOut) {
          const dStr = lastDate.toISOString().slice(0, 10);
          if (dStr > todayStr) {
            const mKey = dStr.slice(0, 7);
            if (projectionMonths[mKey] !== undefined) {
              manualFutureByMonth[mKey] = {
                date: dStr,
                amount_per_share: currAmt,
                type: "Manual Extrapolation",
              };
            }
          }
          currAmt *= 1 + manualGrowthRate;
          lastDate = new Date(lastDate.getTime() + freqDays * 86400000);
        }

        if (Object.keys(manualFutureByMonth).length > 0) {
          const eventsByMonth: Record<string, any> = {};
          for (const ev of events) eventsByMonth[ev.date.slice(0, 7)] = ev;
          Object.assign(eventsByMonth, manualFutureByMonth);
          events = Object.values(eventsByMonth);
        }
      }

      events.sort((a, b) => a.date.localeCompare(b.date));

      let currentShares = initialShares;
      let assetProjectedAnnualIncome = 0;
      const projectedIndividual: any[] = [];

      for (const ev of events) {
        const netAmtPerShare = ev.amount_per_share * (1 - taxRate) * fx;
        const payout = netAmtPerShare * currentShares;
        const mKey = ev.date.slice(0, 7);
        if (projectionMonths[mKey] !== undefined) {
          projectionMonths[mKey] += payout;
        }

        projectedIndividual.push({
          date: ev.date,
          amount: Math.round(payout * 100) / 100,
          type: ev.type,
        });
        assetProjectedAnnualIncome += payout;

        if (drip && currPrice > 0) {
          const localPayout = ev.amount_per_share * (1 - taxRate) * currentShares;
          currentShares += localPayout / currPrice;
        }
      }

      totalAnnualIncome += assetProjectedAnnualIncome;

      const localTrailingSum = trailingSum * (1 - taxRate);
      const currentYield = currPrice > 0 ? (localTrailingSum / currPrice) * 100 : 0;
      const yoc = avgCost > 0 ? (localTrailingSum / avgCost) * 100 : 0;

      const meta = await getAssetMetadata(this.db, isin);
      assetsMetrics.push({
        isin,
        name: meta.name || mData.name || isin,
        shares: Math.round((drip ? currentShares : initialShares) * 100) / 100,
        avg_cost: Math.round(avgCost * 100) / 100,
        curr_price: Math.round(currPrice * 100) / 100,
        trailing_div_per_share: Math.round(localTrailingSum * 10000) / 10000,
        current_yield: Math.round(currentYield * 100) / 100,
        yoc: Math.round(yoc * 100) / 100,
        est_annual_income: Math.round(assetProjectedAnnualIncome * 100) / 100,
        next_date: divMetrics.next_date,
        projections: projectedIndividual,
        source: isManual ? "manual_extrapolation" : trailingSum > 0 ? "auto" : "none",
        manual_freq: manualFreqLabel,
        manual_growth_pct: isManual ? Math.round(manualGrowthRate * 10000) / 100 : null,
      });
    }

    const chartData = Object.keys(projectionMonths)
      .sort()
      .map((m) => ({
        month: m,
        amount: Math.round(projectionMonths[m] * 100) / 100,
      }));

    // Historical past 5 years & 12 months dividends
    const historicalDividends: { monthly: any[]; annual: any[] } = { monthly: [], annual: [] };
    const histMonthlyMap: Record<string, number> = {};
    const histAnnualMap: Record<string, number> = {};

    const fiveYearsAgoStr = new Date(Date.now() - 5 * 365 * 86400000).toISOString().slice(0, 10);
    for (const isin of isins) {
      const shares = portfolio[isin].shares;
      const assetCcy = guessCurrencyFromIsin(isin);
      const fx = await getFxRate(this.db, assetCcy, baseCcy);
      const divs = await getDividendHistory(this.db, isin, fiveYearsAgoStr);

      for (const [d, amt] of Object.entries(divs)) {
        const amtBase = amt * shares * fx;
        const yr = parseInt(d.slice(0, 4), 10);
        if (yr < now.getFullYear()) {
          histAnnualMap[yr] = (histAnnualMap[yr] || 0) + amtBase;
        }
        if (d >= oneYearAgoStr) {
          const mk = d.slice(0, 7);
          histMonthlyMap[mk] = (histMonthlyMap[mk] || 0) + amtBase;
        }
      }
    }

    historicalDividends.monthly = Object.keys(histMonthlyMap)
      .sort()
      .map((k) => ({ month: k, amount: Math.round(histMonthlyMap[k] * 100) / 100 }));

    historicalDividends.annual = Object.keys(histAnnualMap)
      .sort((a, b) => Number(b) - Number(a))
      .map((k) => ({ year: parseInt(k, 10), amount: Math.round(histAnnualMap[k] * 100) / 100 }));

    return {
      portfolio_metrics: {
        total_annual_income: Math.round(totalAnnualIncome * 100) / 100,
        portfolio_current_yield:
          totalMarketValue > 0 ? Math.round((totalAnnualIncome / totalMarketValue) * 10000) / 100 : 0,
        portfolio_yoc: totalCostBasis > 0 ? Math.round((totalAnnualIncome / totalCostBasis) * 10000) / 100 : 0,
      },
      chart_data: chartData,
      assets: assetsMetrics.sort((a, b) => b.est_annual_income - a.est_annual_income),
      historical_dividends: historicalDividends,
    };
  }
}
