import { getHistoricalSeries, getMarketData } from "./dataProvider";

export interface OptimizationResult {
  allocations: Record<string, number>;
  expected_return: number;
  volatility: number;
  sharpe_ratio: number;
  dividend_yield: number;
  backtest: Array<{ date: string; value: number }>;
}

export interface MonteCarloSettings {
  capital: number;
  years: number;
  contribution?: number;
  contribution_start?: number;
  contribution_years?: number;
  withdrawal?: number;
  withdrawal_start?: number;
  withdrawal_end?: number;
  withdrawal_inflation?: boolean;
  withdrawal_2?: number;
  withdrawal_start_2?: number;
  withdrawal_end_2?: number;
  target?: number;
  inflation?: number;
  stress?: boolean;
  insurance_plan?: any[];
  insurance_alpha_low?: number;
  insurance_alpha_high?: number;
}

export interface StrategyLabAnalysisResult {
  max_sharpe: OptimizationResult;
  min_volatility: OptimizationResult;
  risk_parity: OptimizationResult;
  custom_portfolio?: OptimizationResult;
  benchmark_history: Array<{ date: string; value: number }>;
  correlation_matrix: Array<{ asset1: string; asset2: string; value: number }>;
  asset_stats: Record<
    string,
    { expected_return: number; volatility: number; dividend_yield: number; name: string }
  >;
  valid_assets: string[];
  data_points: number;
  data_warnings: string[];
  risk_contributions?: Record<string, number>;
  mc_target_label?: string;
  monte_carlo: {
    chart: Array<{
      year: number;
      p10: number;
      p25?: number;
      p50: number;
      p75?: number;
      p90: number;
      real_p50?: number | null;
      actual_draw_p10?: number;
      actual_draw_p50?: number;
      actual_draw_p90?: number;
      div_generated?: number;
      div_offset?: number;
      div_reinvested?: number;
      ins_cv_p50?: number;
      ins_cv_low?: number;
      ins_cv_high?: number;
      combined_p10?: number;
      combined_p50?: number;
      combined_p90?: number;
      combined_real_p50?: number;
    }>;
    success_rate: number | null;
    drawdown: { p10: number; p50: number; p90: number };
    combined_drawdown?: { p10: number; p50: number; p90: number } | null;
    irr: { p10: number; p50: number; p90: number };
    stressed_volatility: number | null;
  };
}

function calculateIrr(cashFlows: number[], years: number): number {
  if (!cashFlows || cashFlows.length === 0 || cashFlows.every((v) => v === 0)) return 0.0;
  const npv = (r: number) => {
    let total = 0;
    for (let i = 0; i < cashFlows.length; i++) {
      total += cashFlows[i] / Math.pow(1 + r, i);
    }
    return total;
  };

  let low = -0.99;
  let high = 2.0;
  for (let iter = 0; iter < 60; iter++) {
    const mid = (low + high) / 2;
    const val = npv(mid);
    if (Math.abs(val) < 1e-4) return mid;
    if (val > 0) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return (low + high) / 2;
}

export class StrategyLab {
  db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async runAnalysis(
    isins: string[],
    daysBack: number = 1825,
    maxWeight: number = 0.35,
    customWeights?: Record<string, number>,
    mcSettings?: MonteCarloSettings,
    riskFreeRate: number = 0.04
  ): Promise<StrategyLabAnalysisResult> {
    const warnings: string[] = [];
    if (!isins || isins.length === 0) {
      throw new Error("请选择至少一项资产进行分析");
    }

    // 1. 获取各资产的历史日线数据
    const rawSeriesMap: Record<string, Record<string, number>> = {};
    const validIsins: string[] = [];

    await Promise.all(
      isins.map(async (isin) => {
        try {
          const series = await getHistoricalSeries(this.db, isin, daysBack);
          if (series && Object.keys(series).length >= 20) {
            rawSeriesMap[isin] = series;
            validIsins.push(isin);
          } else {
            warnings.push(`资产 ${isin} 历史数据不足（少于 20 个交易日），已从组合中剔除。`);
          }
        } catch (e: any) {
          warnings.push(`获取资产 ${isin} 历史数据失败: ${e.message}`);
        }
      })
    );

    if (validIsins.length === 0) {
      throw new Error("未能获取到任何所选资产的有效历史数据");
    }

    // 2. 日期求交集对齐
    let commonDates = Object.keys(rawSeriesMap[validIsins[0]] || {});
    for (let i = 1; i < validIsins.length; i++) {
      const datesSet = new Set(Object.keys(rawSeriesMap[validIsins[i]] || {}));
      commonDates = commonDates.filter((d) => datesSet.has(d));
    }
    commonDates.sort();

    if (commonDates.length < 30) {
      // 若强交集过短，退化为第一只资产日期，其余资产采用最近有效值填充 (ffill)
      commonDates = Object.keys(rawSeriesMap[validIsins[0]]).sort();
    }

    const alignedPrices: Record<string, number[]> = {};
    for (const isin of validIsins) {
      const s = rawSeriesMap[isin];
      let lastPrice = 0;
      alignedPrices[isin] = commonDates.map((d) => {
        if (s[d] && s[d] > 0) {
          lastPrice = s[d];
        }
        return lastPrice;
      });
    }

    const numDays = commonDates.length;
    const returnsMatrix: Record<string, number[]> = {};
    for (const isin of validIsins) {
      const p = alignedPrices[isin];
      const rets: number[] = [];
      for (let i = 1; i < p.length; i++) {
        rets.push(p[i - 1] > 0 ? (p[i] - p[i - 1]) / p[i - 1] : 0);
      }
      returnsMatrix[isin] = rets;
    }

    const tradingDays = Math.max(1, numDays - 1);

    // 3. 计算单资产均值、波动率与协方差矩阵
    const meanReturns: Record<string, number> = {};
    const vols: Record<string, number> = {};
    const assetStats: Record<string, any> = {};

    for (const isin of validIsins) {
      const r = returnsMatrix[isin];
      const meanDaily = r.reduce((a, b) => a + b, 0) / tradingDays;
      const annualizedReturn = meanDaily * 252;
      const varianceDaily =
        r.reduce((acc, v) => acc + Math.pow(v - meanDaily, 2), 0) / Math.max(1, tradingDays - 1);
      const annualizedVol = Math.sqrt(varianceDaily * 252);

      meanReturns[isin] = annualizedReturn;
      vols[isin] = annualizedVol;

      // 尝试获取资产名称
      let assetName = isin;
      try {
        const md = await getMarketData(this.db, isin);
        if (md && md.name) assetName = md.name;
      } catch {
        // ignore
      }

      assetStats[isin] = {
        expected_return: Math.round(annualizedReturn * 10000) / 10000,
        volatility: Math.round(annualizedVol * 10000) / 10000,
        dividend_yield: 0.025, // 参考股息率
        name: assetName,
      };
    }

    // 协方差与相关系数矩阵
    const covMatrix: Record<string, Record<string, number>> = {};
    const corrList: Array<{ asset1: string; asset2: string; value: number }> = [];

    for (const a of validIsins) {
      covMatrix[a] = {};
      const rA = returnsMatrix[a];
      const mA = rA.reduce((s, x) => s + x, 0) / tradingDays;
      const varA = rA.reduce((s, x) => s + Math.pow(x - mA, 2), 0);

      for (const b of validIsins) {
        const rB = returnsMatrix[b];
        const mB = rB.reduce((s, x) => s + x, 0) / tradingDays;
        const varB = rB.reduce((s, x) => s + Math.pow(x - mB, 2), 0);

        let covDaily = 0;
        for (let i = 0; i < tradingDays; i++) {
          covDaily += (rA[i] - mA) * (rB[i] - mB);
        }
        covDaily = covDaily / Math.max(1, tradingDays - 1);
        covMatrix[a][b] = covDaily * 252;

        const denom = Math.sqrt(varA * varB);
        const corrVal = denom > 0 ? covDaily / (Math.sqrt(varA / (tradingDays - 1)) * Math.sqrt(varB / (tradingDays - 1))) : 1.0;
        corrList.push({
          asset1: a,
          asset2: b,
          value: Math.round(Math.min(1.0, Math.max(-1.0, corrVal)) * 100) / 100,
        });
      }
    }

    // 4. 辅助函数：计算组合收益、波动率与回测净值曲线
    const evaluatePortfolio = (weights: Record<string, number>) => {
      let pRet = 0;
      for (const isin of validIsins) {
        pRet += (weights[isin] || 0) * meanReturns[isin];
      }

      let pVar = 0;
      for (const a of validIsins) {
        for (const b of validIsins) {
          pVar += (weights[a] || 0) * (weights[b] || 0) * covMatrix[a][b];
        }
      }
      const pVol = Math.sqrt(Math.max(1e-6, pVar));
      const sharpe = (pRet - riskFreeRate) / pVol;

      // 历史回测曲线（基准 10,000）
      const backtest: Array<{ date: string; value: number }> = [];
      let nav = 10000;
      if (commonDates.length > 0) {
        backtest.push({ date: commonDates[0], value: nav });
        for (let t = 0; t < tradingDays; t++) {
          let dayRet = 0;
          for (const isin of validIsins) {
            dayRet += (weights[isin] || 0) * returnsMatrix[isin][t];
          }
          nav *= 1 + dayRet;
          backtest.push({
            date: commonDates[t + 1],
            value: Math.round(nav * 100) / 100,
          });
        }
      }

      return {
        allocations: weights,
        expected_return: Math.round(pRet * 10000) / 10000,
        volatility: Math.round(pVol * 10000) / 10000,
        sharpe_ratio: Math.round(sharpe * 100) / 100,
        dividend_yield: 0.025,
        backtest,
      };
    };

    // 5. 组合优化搜索 (Monte Carlo Dirichlet sampling)
    let bestSharpeAlloc: Record<string, number> = {};
    let bestSharpeVal = -999;
    let minVolAlloc: Record<string, number> = {};
    let minVolVal = 999;

    const trials = Math.min(8000, Math.max(1500, validIsins.length * 800));
    const maxBound = Math.min(1.0, Math.max(1.0 / validIsins.length, maxWeight));

    for (let t = 0; t < trials; t++) {
      // 随机分配并限制单个资产上限
      const raw = validIsins.map(() => -Math.log(Math.random() + 1e-12));
      const sumRaw = raw.reduce((a, b) => a + b, 0);
      let candidate: Record<string, number> = {};
      validIsins.forEach((isin, idx) => {
        candidate[isin] = raw[idx] / sumRaw;
      });

      // 裁剪上限并重新归一化
      let capped = false;
      for (const isin of validIsins) {
        if (candidate[isin] > maxBound) {
          candidate[isin] = maxBound;
          capped = true;
        }
      }
      if (capped) {
        const s = Object.values(candidate).reduce((a, b) => a + b, 0);
        if (s > 0) {
          for (const isin of validIsins) candidate[isin] = candidate[isin] / s;
        }
      }

      // 计算当前权重表现
      let pRet = 0;
      let pVar = 0;
      for (const a of validIsins) {
        pRet += candidate[a] * meanReturns[a];
        for (const b of validIsins) {
          pVar += candidate[a] * candidate[b] * covMatrix[a][b];
        }
      }
      const pVol = Math.sqrt(Math.max(1e-6, pVar));
      const sharpe = (pRet - riskFreeRate) / pVol;

      if (sharpe > bestSharpeVal) {
        bestSharpeVal = sharpe;
        bestSharpeAlloc = { ...candidate };
      }
      if (pVol < minVolVal) {
        minVolVal = pVol;
        minVolAlloc = { ...candidate };
      }
    }

    // 格式化百分比分配
    const cleanWeights = (w: Record<string, number>) => {
      const res: Record<string, number> = {};
      let sum = 0;
      for (const isin of validIsins) {
        const val = Math.round((w[isin] || 0) * 1000) / 1000;
        res[isin] = val;
        sum += val;
      }
      // 调整微小漂移使总和严格等于 1.0
      if (validIsins.length > 0 && Math.abs(1.0 - sum) > 0.0001) {
        res[validIsins[0]] = Math.round((res[validIsins[0]] + (1.0 - sum)) * 1000) / 1000;
      }
      return res;
    };

    const maxSharpe = evaluatePortfolio(cleanWeights(bestSharpeAlloc));
    const minVol = evaluatePortfolio(cleanWeights(minVolAlloc));

    // 6. 风险平价 (Risk Parity) 组合
    // 逆波动率加权作为稳健风险平价近似
    const invVolAlloc: Record<string, number> = {};
    let sumInvVol = 0;
    for (const isin of validIsins) {
      const iv = 1.0 / Math.max(0.01, vols[isin]);
      invVolAlloc[isin] = iv;
      sumInvVol += iv;
    }
    for (const isin of validIsins) {
      invVolAlloc[isin] = invVolAlloc[isin] / sumInvVol;
    }
    const riskParity = evaluatePortfolio(cleanWeights(invVolAlloc));

    // 7. 用户自定义权重组合 (Custom Portfolio)
    let customPortfolio: OptimizationResult | undefined = undefined;
    if (customWeights && Object.keys(customWeights).length > 0) {
      const cAlloc: Record<string, number> = {};
      let cSum = 0;
      for (const isin of validIsins) {
        const rawW = Number(customWeights[isin] || 0);
        const wVal = rawW > 1.0 ? rawW / 100 : rawW;
        cAlloc[isin] = wVal;
        cSum += wVal;
      }
      if (cSum > 0) {
        for (const isin of validIsins) cAlloc[isin] = cAlloc[isin] / cSum;
      } else {
        validIsins.forEach((isin) => (cAlloc[isin] = 1.0 / validIsins.length));
      }
      customPortfolio = evaluatePortfolio(cleanWeights(cAlloc));
    }

    // 8. 标杆指数基准回测 (SPY / Benchmark)
    const benchmarkHistory: Array<{ date: string; value: number }> = [];
    try {
      const spySeries = await getHistoricalSeries(this.db, "SPY", daysBack);
      if (spySeries && Object.keys(spySeries).length > 20) {
        let spyStart = 0;
        let lastSpy = 0;
        for (const d of commonDates) {
          if (spySeries[d] && spySeries[d] > 0) lastSpy = spySeries[d];
          if (spyStart === 0 && lastSpy > 0) spyStart = lastSpy;
          benchmarkHistory.push({
            date: d,
            value: spyStart > 0 ? Math.round((10000 * lastSpy) / spyStart) : 10000,
          });
        }
      }
    } catch {
      // ignore
    }

    // 容灾兜底：若 SPY 暂缺，使用等权资产基准填充
    if (benchmarkHistory.length === 0 && commonDates.length > 0) {
      const eqWeights: Record<string, number> = {};
      validIsins.forEach((i) => (eqWeights[i] = 1.0 / validIsins.length));
      const eqEval = evaluatePortfolio(eqWeights);
      benchmarkHistory.push(...eqEval.backtest);
    }

    // 9. 蒙特卡洛多路径财富推演 (Monte Carlo Simulation)
    const targetPortfolio = customPortfolio || maxSharpe;
    const mcTargetLabel = customPortfolio ? "custom_portfolio" : "max_sharpe";

    const mcYears = Math.min(40, Math.max(3, Number(mcSettings?.years || 15)));
    const mcCapital = Number(mcSettings?.capital || 1000000);
    const mcContribution = Number(mcSettings?.contribution || 0);
    const mcContributionStart = Number(mcSettings?.contribution_start || 1);
    const mcContributionYears = Number(mcSettings?.contribution_years || 100);
    const mcWithdrawal = Number(mcSettings?.withdrawal || 0);
    const mcWithdrawalStart = Number(mcSettings?.withdrawal_start || 1);
    const mcWithdrawalEnd = Number(mcSettings?.withdrawal_end || 100);
    const mcWithdrawalInflation = Boolean(mcSettings?.withdrawal_inflation);
    const mcTargetGoal = Number(mcSettings?.target || 0);
    const mcInflation = Number(mcSettings?.inflation || 0) / 100;
    const mcStress = Boolean(mcSettings?.stress);

    let simVol = targetPortfolio.volatility;
    let stressedVol: number | null = null;
    if (mcStress) {
      simVol = Math.max(simVol * 1.35, 0.22);
      stressedVol = simVol;
    }
    const simRet = targetPortfolio.expected_return;

    const numSims = 2000;
    const paths: number[][] = [];
    const maxDrawdowns: number[] = [];

    for (let s = 0; s < numSims; s++) {
      const path: number[] = [mcCapital];
      let curr = mcCapital;
      let peak = mcCapital;
      let maxDd = 0.0;

      for (let y = 1; y <= mcYears; y++) {
        // 年初现金注入
        const hasCont = y >= mcContributionStart && y <= mcContributionYears;
        const cont = hasCont ? mcContribution : 0;

        // 年内提领（考虑通胀递增）
        const hasDraw = y >= mcWithdrawalStart && y <= mcWithdrawalEnd;
        const inflFactor = mcWithdrawalInflation ? Math.pow(1 + mcInflation, y - 1) : 1.0;
        const draw = hasDraw ? mcWithdrawal * inflFactor : 0;

        curr = Math.max(0, curr + cont - draw);

        // Box-Muller 随机正态几何布朗运动 (GBM)
        const u1 = Math.random();
        const u2 = Math.random();
        const z = Math.sqrt(-2.0 * Math.log(u1 + 1e-12)) * Math.cos(2.0 * Math.PI * u2);

        const r = Math.exp(simRet - 0.5 * simVol * simVol + simVol * z) - 1;
        curr = Math.max(0, curr * (1 + r));

        if (curr > peak) peak = curr;
        const dd = peak > 0 ? (peak - curr) / peak : 0;
        if (dd > maxDd) maxDd = dd;

        path.push(curr);
      }
      paths.push(path);
      maxDrawdowns.push(-maxDd);
    }

    // 统计各年份百分位数
    const chart: Array<any> = [];
    for (let y = 0; y <= mcYears; y++) {
      const vals = paths.map((p) => p[y]).sort((a, b) => a - b);
      const p10 = vals[Math.floor(numSims * 0.1)];
      const p25 = vals[Math.floor(numSims * 0.25)];
      const p50 = vals[Math.floor(numSims * 0.5)];
      const p75 = vals[Math.floor(numSims * 0.75)];
      const p90 = vals[Math.floor(numSims * 0.9)];

      const realP50 = mcInflation > 0 ? Math.round(p50 / Math.pow(1 + mcInflation, y)) : p50;

      chart.push({
        year: y,
        p10: Math.round(p10),
        p25: Math.round(p25),
        p50: Math.round(p50),
        p75: Math.round(p75),
        p90: Math.round(p90),
        real_p50: Math.round(realP50),
      });
    }

    // 成功率统计
    let successRate: number | null = null;
    if (mcTargetGoal > 0) {
      const successes = paths.filter((p) => p[mcYears] >= mcTargetGoal).length;
      successRate = Math.round((successes / numSims) * 1000) / 1000;
    } else {
      const solvent = paths.filter((p) => p[mcYears] > 0).length;
      successRate = Math.round((solvent / numSims) * 1000) / 1000;
    }

    // 回撤统计
    maxDrawdowns.sort((a, b) => a - b);
    const drawdown = {
      p10: Math.round(maxDrawdowns[Math.floor(numSims * 0.1)] * 1000) / 1000,
      p50: Math.round(maxDrawdowns[Math.floor(numSims * 0.5)] * 1000) / 1000,
      p90: Math.round(maxDrawdowns[Math.floor(numSims * 0.9)] * 1000) / 1000,
    };

    // IRR 计算
    const baseCfs = [-mcCapital];
    for (let y = 1; y <= mcYears; y++) {
      const cont = y >= mcContributionStart && y <= mcContributionYears ? mcContribution : 0;
      const draw = y >= mcWithdrawalStart && y <= mcWithdrawalEnd ? mcWithdrawal : 0;
      baseCfs.push(draw - cont);
    }
    const irr = {
      p10: Math.round(calculateIrr([...baseCfs.slice(0, -1), baseCfs[baseCfs.length - 1] + chart[mcYears].p10], mcYears) * 1000) / 1000,
      p50: Math.round(calculateIrr([...baseCfs.slice(0, -1), baseCfs[baseCfs.length - 1] + chart[mcYears].p50], mcYears) * 1000) / 1000,
      p90: Math.round(calculateIrr([...baseCfs.slice(0, -1), baseCfs[baseCfs.length - 1] + chart[mcYears].p90], mcYears) * 1000) / 1000,
    };

    return {
      max_sharpe: maxSharpe,
      min_volatility: minVol,
      risk_parity: riskParity,
      ...(customPortfolio ? { custom_portfolio: customPortfolio } : {}),
      benchmark_history: benchmarkHistory,
      correlation_matrix: corrList,
      asset_stats: assetStats,
      valid_assets: validIsins,
      data_points: tradingDays,
      data_warnings: warnings,
      mc_target_label: mcTargetLabel,
      monte_carlo: {
        chart,
        success_rate: successRate,
        drawdown,
        irr,
        stressed_volatility: stressedVol,
      },
    };
  }
}
