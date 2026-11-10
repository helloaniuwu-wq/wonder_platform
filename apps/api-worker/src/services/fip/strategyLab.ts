import { getHistoricalSeries } from "./dataProvider";

export interface AssetReturnData {
  isin: string;
  meanReturn: number; // Annualized
  volatility: number; // Annualized
  dailyReturns: number[];
}

export interface OptimizationResult {
  weights: Record<string, number>;
  expectedReturn: number;
  volatility: number;
  sharpeRatio: number;
}

export interface MonteCarloSettings {
  initialNav: number;
  years: number;
  simulations: number;
  annualReturn: number;
  annualVol: number;
  annualContribution?: number;
  annualWithdrawal?: number;
  ilpFeeRate?: number;
}

export interface MonteCarloResult {
  years: number[];
  p10: number[];
  p25: number[];
  p50: number[];
  p75: number[];
  p90: number[];
}

export class StrategyLab {
  db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async alignHistoricalData(
    isins: string[],
    daysBack = 1825
  ): Promise<{
    dates: string[];
    priceMatrix: Record<string, number[]>;
    returnsMatrix: Record<string, number[]>;
  }> {
    const seriesMap: Record<string, Record<string, number>> = {};
    for (const isin of isins) {
      seriesMap[isin] = await getHistoricalSeries(this.db, isin, daysBack);
    }

    // Find intersection of dates where at least most assets have prices
    const allDateSets = isins.map((isin) => new Set(Object.keys(seriesMap[isin] || {})));
    let commonDates = Array.from(allDateSets[0] || []);
    for (let i = 1; i < allDateSets.length; i++) {
      commonDates = commonDates.filter((d) => allDateSets[i].has(d));
    }
    commonDates.sort();

    const priceMatrix: Record<string, number[]> = {};
    const returnsMatrix: Record<string, number[]> = {};

    for (const isin of isins) {
      priceMatrix[isin] = commonDates.map((d) => seriesMap[isin][d] || 0);
      const returns: number[] = [];
      for (let i = 1; i < commonDates.length; i++) {
        const p0 = priceMatrix[isin][i - 1];
        const p1 = priceMatrix[isin][i];
        returns.push(p0 > 0 ? (p1 - p0) / p0 : 0);
      }
      returnsMatrix[isin] = returns;
    }

    return {
      dates: commonDates.slice(1),
      priceMatrix,
      returnsMatrix,
    };
  }

  computeStats(
    isins: string[],
    returnsMatrix: Record<string, number[]>,
    weights: Record<string, number>,
    riskFreeRate = 0.04
  ): {
    annualizedReturn: number;
    annualizedVol: number;
    sharpeRatio: number;
    maxDrawdown: number;
    correlationMatrix: Record<string, Record<string, number>>;
  } {
    const n = isins.length;
    const numDays = returnsMatrix[isins[0]]?.length || 0;
    if (numDays === 0) {
      return {
        annualizedReturn: 0,
        annualizedVol: 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
        correlationMatrix: {},
      };
    }

    // Daily portfolio returns
    const portDailyReturns: number[] = new Array(numDays).fill(0);
    for (let d = 0; d < numDays; d++) {
      for (const isin of isins) {
        const w = (weights[isin] || 0) / 100;
        portDailyReturns[d] += (returnsMatrix[isin]?.[d] || 0) * w;
      }
    }

    const meanDaily = portDailyReturns.reduce((a, b) => a + b, 0) / numDays;
    const annualizedReturn = meanDaily * 252;

    const varianceDaily =
      portDailyReturns.reduce((acc, r) => acc + Math.pow(r - meanDaily, 2), 0) / Math.max(1, numDays - 1);
    const annualizedVol = Math.sqrt(varianceDaily * 252);

    const sharpeRatio = annualizedVol > 0 ? (annualizedReturn - riskFreeRate) / annualizedVol : 0;

    // Max Drawdown
    let peak = 1.0;
    let maxDd = 0.0;
    let currVal = 1.0;
    for (const r of portDailyReturns) {
      currVal *= 1 + r;
      if (currVal > peak) peak = currVal;
      const dd = (peak - currVal) / peak;
      if (dd > maxDd) maxDd = dd;
    }

    // Correlation Matrix
    const correlationMatrix: Record<string, Record<string, number>> = {};
    for (const a of isins) {
      correlationMatrix[a] = {};
      const rA = returnsMatrix[a] || [];
      const meanA = rA.reduce((s, x) => s + x, 0) / Math.max(1, rA.length);
      const varA = rA.reduce((s, x) => s + Math.pow(x - meanA, 2), 0);

      for (const b of isins) {
        const rB = returnsMatrix[b] || [];
        const meanB = rB.reduce((s, x) => s + x, 0) / Math.max(1, rB.length);
        const varB = rB.reduce((s, x) => s + Math.pow(x - meanB, 2), 0);

        let cov = 0;
        for (let i = 0; i < rA.length; i++) {
          cov += (rA[i] - meanA) * (rB[i] - meanB);
        }
        const denom = Math.sqrt(varA * varB);
        correlationMatrix[a][b] = denom > 0 ? Math.round((cov / denom) * 100) / 100 : 1;
      }
    }

    return {
      annualizedReturn: Math.round(annualizedReturn * 1000) / 10,
      annualizedVol: Math.round(annualizedVol * 1000) / 10,
      sharpeRatio: Math.round(sharpeRatio * 100) / 100,
      maxDrawdown: Math.round(maxDd * 1000) / 10,
      correlationMatrix,
    };
  }

  optimizeFrontier(
    isins: string[],
    returnsMatrix: Record<string, number[]>,
    riskFreeRate = 0.04,
    trials = 2000
  ): {
    maxSharpe: OptimizationResult;
    minVol: OptimizationResult;
    frontier: { return: number; vol: number; sharpe: number }[];
  } {
    let bestSharpe: OptimizationResult = {
      weights: {},
      expectedReturn: 0,
      volatility: 999,
      sharpeRatio: -999,
    };
    let minVol: OptimizationResult = {
      weights: {},
      expectedReturn: 0,
      volatility: 999,
      sharpeRatio: -999,
    };

    const frontier: { return: number; vol: number; sharpe: number }[] = [];
    const n = isins.length;

    for (let t = 0; t < trials; t++) {
      // Generate Dirichlet-like random weights summing to 100
      const rawWeights = isins.map(() => -Math.log(Math.random() + 1e-10));
      const sumRaw = rawWeights.reduce((a, b) => a + b, 0);
      const weightsObj: Record<string, number> = {};
      isins.forEach((isin, idx) => {
        weightsObj[isin] = Math.round((rawWeights[idx] / sumRaw) * 1000) / 10;
      });

      const stats = this.computeStats(isins, returnsMatrix, weightsObj, riskFreeRate);
      const ret = stats.annualizedReturn / 100;
      const vol = stats.annualizedVol / 100;
      const sharpe = stats.sharpeRatio;

      if (sharpe > bestSharpe.sharpeRatio) {
        bestSharpe = {
          weights: weightsObj,
          expectedReturn: stats.annualizedReturn,
          volatility: stats.annualizedVol,
          sharpeRatio: sharpe,
        };
      }

      if (vol < minVol.volatility / 100 && vol > 0.001) {
        minVol = {
          weights: weightsObj,
          expectedReturn: stats.annualizedReturn,
          volatility: stats.annualizedVol,
          sharpeRatio: sharpe,
        };
      }

      if (t % 20 === 0) {
        frontier.push({
          return: stats.annualizedReturn,
          vol: stats.annualizedVol,
          sharpe,
        });
      }
    }

    frontier.sort((a, b) => a.vol - b.vol);

    return { maxSharpe: bestSharpe, minVol, frontier };
  }

  runMonteCarlo(settings: MonteCarloSettings): MonteCarloResult {
    const {
      initialNav,
      years,
      simulations = 1000,
      annualReturn,
      annualVol,
      annualContribution = 0,
      annualWithdrawal = 0,
      ilpFeeRate = 0,
    } = settings;

    const mu = annualReturn / 100 - ilpFeeRate / 100;
    const sigma = annualVol / 100;
    const paths: number[][] = [];

    for (let s = 0; s < simulations; s++) {
      const path: number[] = [initialNav];
      let current = initialNav;

      for (let y = 1; y <= years; y++) {
        // Box-Muller random standard normal
        const u1 = Math.random();
        const u2 = Math.random();
        const z = Math.sqrt(-2.0 * Math.log(u1 + 1e-10)) * Math.cos(2.0 * Math.PI * u2);

        const r = Math.exp(mu - 0.5 * sigma * sigma + sigma * z) - 1;
        current = current * (1 + r) + annualContribution - annualWithdrawal;
        current = Math.max(0, current);
        path.push(current);
      }
      paths.push(path);
    }

    // Compute percentiles for each year
    const yearList = Array.from({ length: years + 1 }, (_, i) => i);
    const p10: number[] = [];
    const p25: number[] = [];
    const p50: number[] = [];
    const p75: number[] = [];
    const p90: number[] = [];

    for (let y = 0; y <= years; y++) {
      const yearValues = paths.map((p) => p[y]).sort((a, b) => a - b);
      const idx = (pct: number) => Math.min(yearValues.length - 1, Math.floor(yearValues.length * pct));
      p10.push(Math.round(yearValues[idx(0.1)]));
      p25.push(Math.round(yearValues[idx(0.25)]));
      p50.push(Math.round(yearValues[idx(0.5)]));
      p75.push(Math.round(yearValues[idx(0.75)]));
      p90.push(Math.round(yearValues[idx(0.9)]));
    }

    return {
      years: yearList,
      p10,
      p25,
      p50,
      p75,
      p90,
    };
  }
}
