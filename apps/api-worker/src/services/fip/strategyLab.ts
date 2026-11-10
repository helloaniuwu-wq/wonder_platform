import { getDividendMetrics, getHistoricalSeries, getMarketData } from "./dataProvider";

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
    insurance_stats?: {
      total_insurance_withdrawal: number;
      total_target_withdrawal: number;
      withdrawal_coverage_pct: number;
      avg_cv_at_year_end: { low: number; mid: number; high: number };
    } | null;
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
    // 去重 + 去空：前端允许重复添加同一 ISIN，重复会让权重字典塌缩成负权重
    isins = Array.from(
      new Set((isins || []).map((s) => String(s || "").trim()).filter((s) => s.length > 0))
    );
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

      // 尝试获取资产名称与真实股息率
      let assetName = isin;
      let divYield = 0;
      try {
        const md = await getMarketData(this.db, isin);
        if (md && md.name) assetName = md.name;
        if (md && md.price > 0) {
          const dm = await getDividendMetrics(this.db, isin);
          divYield = Math.max(0, Math.min(0.2, (dm.trailing_sum || 0) / md.price));
        }
      } catch {
        // ignore
      }

      assetStats[isin] = {
        expected_return: Math.round(annualizedReturn * 10000) / 10000,
        volatility: Math.round(annualizedVol * 10000) / 10000,
        dividend_yield: Math.round(divYield * 10000) / 10000,
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

      // 股息率按资产实际 trailing 股息率加权，与蒙特卡洛部分口径保持一致。
      // 原先此处写死 0.025，会让所有优化组合一律显示 2.5%，与资产构成无关。
      let pDivYield = 0;
      for (const isin of validIsins) {
        pDivYield += (weights[isin] || 0) * (assetStats[isin]?.dividend_yield || 0);
      }

      return {
        allocations: weights,
        expected_return: Math.round(pRet * 10000) / 10000,
        volatility: Math.round(pVol * 10000) / 10000,
        sharpe_ratio: Math.round(sharpe * 100) / 100,
        dividend_yield: Math.round(Math.max(0, Math.min(0.15, pDivYield)) * 10000) / 10000,
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

    /**
     * 把任意权重向量投影到 { w: Σw = 1, 0 ≤ w_i ≤ cap } 上。
     *
     * 旧实现是「超限截断 + 整体归一化」，归一化会把权重重新推回 cap 之上，
     * 导致 max_weight 形同虚设（实测 cap=0.35 时输出 0.998）。
     * 这里改为迭代封顶：超限者钉在 cap，超额部分按剩余权重比例分摊给未封顶者。
     */
    const projectToCappedSimplex = (raw: number[], cap: number): Record<string, number> => {
      const n = raw.length;
      const w = raw.slice();
      const capped = new Array(n).fill(false);

      for (let iter = 0; iter < n + 2; iter++) {
        let excess = 0;
        for (let i = 0; i < n; i++) {
          if (!capped[i] && w[i] > cap + 1e-12) {
            excess += w[i] - cap;
            w[i] = cap;
            capped[i] = true;
          }
        }
        if (excess <= 1e-12) break;

        const freeIdx = [];
        let freeSum = 0;
        for (let i = 0; i < n; i++) {
          if (!capped[i]) {
            freeIdx.push(i);
            freeSum += w[i];
          }
        }
        if (freeIdx.length === 0) break;
        if (freeSum <= 1e-12) {
          for (const i of freeIdx) w[i] += excess / freeIdx.length;
        } else {
          for (const i of freeIdx) w[i] += (w[i] / freeSum) * excess;
        }
      }

      const total = w.reduce((a, b) => a + b, 0);
      const out: Record<string, number> = {};
      validIsins.forEach((isin, i) => {
        out[isin] = total > 0 ? w[i] / total : 1 / n;
      });
      return out;
    };

    // 上限若不可行（n × cap < 1），退化为等权
    const feasibleCap = maxBound * validIsins.length >= 1 - 1e-9 ? maxBound : 1.0;

    for (let t = 0; t < trials; t++) {
      // Dirichlet(1,...,1) 随机分配
      const raw = validIsins.map(() => -Math.log(Math.random() + 1e-12));
      const sumRaw = raw.reduce((a, b) => a + b, 0);
      const candidate = projectToCappedSimplex(
        raw.map((r) => r / sumRaw),
        feasibleCap
      );

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
      // 调整舍入漂移，使总和严格等于 1.0；
      // 漂移补给当前权重最小、且加完不越界的那一项，避免把某只资产顶过 max_weight。
      const drift = Math.round((1.0 - sum) * 1000) / 1000;
      if (validIsins.length > 0 && Math.abs(drift) > 0) {
        const sorted = [...validIsins].sort((a, b) => res[a] - res[b]);
        const target = sorted.find((isin) => res[isin] + drift <= maxBound + 1e-9) || sorted[0];
        res[target] = Math.round((res[target] + drift) * 1000) / 1000;
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
    // 风险平价同样受 max_weight 约束，否则会出现单资产 60%+ 越界配置
    const riskParity = evaluatePortfolio(
      cleanWeights(projectToCappedSimplex(validIsins.map((i) => invVolAlloc[i]), feasibleCap))
    );

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
    // 第二段提领（退休后通常从「生活提领」切到「护理提领」），旧实现完全忽略
    const mcWithdrawal2 = Number(mcSettings?.withdrawal_2 || 0);
    const mcWithdrawalStart2 = Number(mcSettings?.withdrawal_start_2 || 1);
    const mcWithdrawalEnd2 = Number(mcSettings?.withdrawal_end_2 || 100);
    const mcWithdrawalInflation = Boolean(mcSettings?.withdrawal_inflation);
    const mcTargetGoal = Number(mcSettings?.target || 0);
    // 注意：入参口径为「百分数」（前端直接传 2.5），此处统一除以 100。
    // 之前前端又额外除了一次，导致 2.5% 被当成 0.025%，通胀折现形同虚设。
    const mcInflation = Math.max(0, Number(mcSettings?.inflation || 0)) / 100;
    const mcStress = Boolean(mcSettings?.stress);

    const insurancePlan =
      Array.isArray(mcSettings?.insurance_plan) && mcSettings!.insurance_plan!.length > 0
        ? mcSettings!.insurance_plan!
        : null;
    const alphaLow = Number(mcSettings?.insurance_alpha_low ?? 0.8) || 0.8;
    const alphaHigh = Number(mcSettings?.insurance_alpha_high ?? 1.2) || 1.2;

    let simVol = targetPortfolio.volatility;
    let stressedVol: number | null = null;
    if (mcStress) {
      simVol = Math.max(simVol * 1.35, 0.22);
      stressedVol = simVol;
    }
    const simRet = targetPortfolio.expected_return;

    // 组合股息率：按目标权重加权的个股已实现股息率
    let portfolioDivYield = 0;
    for (const isin of validIsins) {
      portfolioDivYield += (targetPortfolio.allocations[isin] || 0) * (assetStats[isin]?.dividend_yield || 0);
    }
    portfolioDivYield = Math.max(0, Math.min(0.15, portfolioDivYield));

    const numSims = 2000;
    const paths: number[][] = [];
    const actualDrawPaths: number[][] = [];
    const divIncomePaths: number[][] = [];
    const divOffsetPaths: number[][] = [];
    const maxDrawdowns: number[] = [];

    const targetDrawOfYear = (y: number): number => {
      const inflFactor = mcWithdrawalInflation ? Math.pow(1 + mcInflation, y - 1) : 1.0;
      let draw = 0;
      if (y >= mcWithdrawalStart && y <= mcWithdrawalEnd) draw += mcWithdrawal * inflFactor;
      if (y >= mcWithdrawalStart2 && y <= mcWithdrawalEnd2) draw += mcWithdrawal2 * inflFactor;
      return draw;
    };

    for (let s = 0; s < numSims; s++) {
      const path: number[] = [mcCapital];
      const drawPath: number[] = [0];
      const divPath: number[] = [0];
      const offPath: number[] = [0];
      let curr = mcCapital;
      let peak = mcCapital;
      let maxDd = 0.0;

      for (let y = 1; y <= mcYears; y++) {
        // 年初现金注入
        const cont = y >= mcContributionStart && y <= mcContributionYears ? mcContribution : 0;
        const targetDraw = targetDrawOfYear(y);

        // 组合内生分红：先抵提领，剩余部分留存/再投；不足部分才卖本金
        const prev = curr;
        const divIncome = prev * portfolioDivYield;
        const offsetFromDiv = Math.min(divIncome, targetDraw);
        const actualDraw = offsetFromDiv + Math.min(prev, Math.max(0, targetDraw - offsetFromDiv));

        drawPath.push(actualDraw);
        divPath.push(divIncome);
        offPath.push(offsetFromDiv);

        let pStart = prev + cont - (actualDraw - offsetFromDiv) + (divIncome - offsetFromDiv);
        pStart = Math.max(0, pStart);

        // Box-Muller 随机正态几何布朗运动 (GBM)
        const u1 = Math.random();
        const u2 = Math.random();
        const z = Math.sqrt(-2.0 * Math.log(u1 + 1e-12)) * Math.cos(2.0 * Math.PI * u2);

        const r = Math.exp(simRet - 0.5 * simVol * simVol + simVol * z) - 1;
        curr = Math.max(0, pStart * (1 + r));

        if (curr > peak) peak = curr;
        const dd = peak > 0 ? (peak - curr) / peak : 0;
        if (dd > maxDd) maxDd = dd;

        path.push(curr);
      }
      paths.push(path);
      actualDrawPaths.push(drawPath);
      divIncomePaths.push(divPath);
      divOffsetPaths.push(offPath);
      maxDrawdowns.push(-maxDd);
    }

    // 分位数工具（线性插值，避免 2000 条路径下取整造成的台阶）
    const percentile = (arr: number[], q: number): number => {
      if (arr.length === 0) return 0;
      const sorted = [...arr].sort((a, b) => a - b);
      const pos = (sorted.length - 1) * q;
      const lo = Math.floor(pos);
      const hi = Math.ceil(pos);
      if (lo === hi) return sorted[lo];
      return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
    };

    const insuranceValueAt = (year: number): { low: number; mid: number; high: number } | null => {
      if (!insurancePlan || year <= 0) return null;
      const row = insurancePlan[Math.min(year, insurancePlan.length) - 1];
      if (!row) return null;
      const gcv = Number(row.guaranteed_cv || 0);
      const ng = Number(row.non_guaranteed || 0);
      return { low: gcv + ng * alphaLow, mid: gcv + ng, high: gcv + ng * alphaHigh };
    };

    // 统计各年份百分位数
    const chart: Array<any> = [];
    for (let y = 0; y <= mcYears; y++) {
      const vals = paths.map((p) => p[y]);
      const p10 = percentile(vals, 0.1);
      const p25 = percentile(vals, 0.25);
      const p50 = percentile(vals, 0.5);
      const p75 = percentile(vals, 0.75);
      const p90 = percentile(vals, 0.9);

      const realP50 = mcInflation > 0 ? p50 / Math.pow(1 + mcInflation, y) : null;

      const row: any = {
        year: y,
        p10: Math.round(p10),
        p25: Math.round(p25),
        p50: Math.round(p50),
        p75: Math.round(p75),
        p90: Math.round(p90),
        real_p50: realP50 === null ? null : Math.round(realP50),
        actual_draw_p10: Math.round(percentile(actualDrawPaths.map((p) => p[y]), 0.1)),
        actual_draw_p50: Math.round(percentile(actualDrawPaths.map((p) => p[y]), 0.5)),
        actual_draw_p90: Math.round(percentile(actualDrawPaths.map((p) => p[y]), 0.9)),
        div_generated: Math.round(percentile(divIncomePaths.map((p) => p[y]), 0.5)),
        div_offset: Math.round(percentile(divOffsetPaths.map((p) => p[y]), 0.5)),
      };
      row.div_reinvested = Math.max(0, row.div_generated - row.div_offset);

      const ins = insuranceValueAt(y);
      if (ins) {
        row.ins_cv_p50 = Math.round(ins.mid);
        row.ins_cv_low = Math.round(ins.low);
        row.ins_cv_high = Math.round(ins.high);
        row.ins_withdrawal = Math.round(Number(insurancePlan![Math.min(y, insurancePlan!.length) - 1]?.withdrawal || 0));
        row.combined_p50 = Math.round(p50 + ins.mid);
        row.combined_p10 = Math.round(p10 + ins.low);
        row.combined_p90 = Math.round(p90 + ins.high);
        row.combined_real_p50 =
          mcInflation > 0 ? Math.round(row.combined_p50 / Math.pow(1 + mcInflation, y)) : row.combined_p50;
      }

      chart.push(row);
    }

    // 成功率统计（启用保险时，把期末现金价值按路径分位并入达标判定）
    let successRate: number | null = null;
    if (mcTargetGoal > 0) {
      const finalVals = paths.map((p) => p[mcYears]);
      const endIns = insuranceValueAt(mcYears);
      let successes = 0;
      if (endIns) {
        // 按期末组合净值排序，用秩映射到 [alphaLow, alphaHigh] 的红利实现率
        const order = finalVals.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
        const rank = new Array(finalVals.length).fill(0);
        order.forEach((o, idx) => (rank[o.i] = idx));
        for (let i = 0; i < finalVals.length; i++) {
          const alpha = alphaLow + (rank[i] / Math.max(1, finalVals.length - 1)) * (alphaHigh - alphaLow);
          // low 对应 alphaLow、high 对应 alphaHigh，按秩线性插值
          const insVal =
            endIns.low + ((alpha - alphaLow) / Math.max(1e-9, alphaHigh - alphaLow)) * (endIns.high - endIns.low);
          if (finalVals[i] + insVal >= mcTargetGoal) successes++;
        }
      } else {
        successes = finalVals.filter((v) => v >= mcTargetGoal).length;
      }
      successRate = Math.round((successes / numSims) * 1000) / 1000;
    } else {
      const solvent = paths.filter((p) => p[mcYears] > 0).length;
      successRate = Math.round((solvent / numSims) * 1000) / 1000;
    }

    // 回撤统计
    maxDrawdowns.sort((a, b) => a - b);
    const drawdown = {
      p10: Math.round(percentile(maxDrawdowns, 0.1) * 1000) / 1000,
      p50: Math.round(percentile(maxDrawdowns, 0.5) * 1000) / 1000,
      p90: Math.round(percentile(maxDrawdowns, 0.9) * 1000) / 1000,
    };

    // 合并资产（组合 + 保单现金价值）回撤
    let combinedDrawdown: { p10: number; p50: number; p90: number } | null = null;
    if (insurancePlan) {
      const combinedDds: number[] = [];
      for (const p of paths) {
        let peakC = p[0];
        let worst = 0;
        for (let y = 1; y <= mcYears; y++) {
          const ins = insuranceValueAt(y);
          const combined = p[y] + (ins ? ins.low : 0);
          if (combined > peakC) peakC = combined;
          const dd = peakC > 0 ? (combined - peakC) / peakC : 0;
          if (dd < worst) worst = dd;
        }
        combinedDds.push(worst);
      }
      combinedDds.sort((a, b) => a - b);
      combinedDrawdown = {
        p10: Math.round(percentile(combinedDds, 0.1) * 1000) / 1000,
        p50: Math.round(percentile(combinedDds, 0.5) * 1000) / 1000,
        p90: Math.round(percentile(combinedDds, 0.9) * 1000) / 1000,
      };
    }

    // IRR 计算（现金流需含第二段提领）
    const baseCfs = [-mcCapital];
    for (let y = 1; y <= mcYears; y++) {
      const cont = y >= mcContributionStart && y <= mcContributionYears ? mcContribution : 0;
      baseCfs.push(targetDrawOfYear(y) - cont);
    }
    const irr = {
      p10: Math.round(calculateIrr([...baseCfs.slice(0, -1), baseCfs[baseCfs.length - 1] + chart[mcYears].p10], mcYears) * 1000) / 1000,
      p50: Math.round(calculateIrr([...baseCfs.slice(0, -1), baseCfs[baseCfs.length - 1] + chart[mcYears].p50], mcYears) * 1000) / 1000,
      p90: Math.round(calculateIrr([...baseCfs.slice(0, -1), baseCfs[baseCfs.length - 1] + chart[mcYears].p90], mcYears) * 1000) / 1000,
    };

    // 保险方案统计
    let insuranceStats: any = null;
    if (insurancePlan) {
      const endIns = insuranceValueAt(mcYears);
      const totalInsWithdrawal = insurancePlan
        .slice(0, mcYears)
        .reduce((s, p: any) => s + Number(p?.withdrawal || 0), 0);
      let totalTargetWithdrawal = 0;
      for (let y = 1; y <= mcYears; y++) totalTargetWithdrawal += targetDrawOfYear(y);
      insuranceStats = {
        total_insurance_withdrawal: Math.round(totalInsWithdrawal * 100) / 100,
        total_target_withdrawal: Math.round(totalTargetWithdrawal * 100) / 100,
        withdrawal_coverage_pct:
          Math.round((totalInsWithdrawal / Math.max(1, totalTargetWithdrawal)) * 1000) / 10,
        avg_cv_at_year_end: {
          low: Math.round((endIns?.low || 0) * 100) / 100,
          mid: Math.round((endIns?.mid || 0) * 100) / 100,
          high: Math.round((endIns?.high || 0) * 100) / 100,
        },
      };
    }

    // 风险贡献度：RC_i = w_i · (Σw)_i / σ_p
    const riskContributions: Record<string, number> = {};
    try {
      const w = targetPortfolio.allocations;
      let totalRc = 0;
      const rawRc: Record<string, number> = {};
      for (const a of validIsins) {
        let marginal = 0;
        for (const b of validIsins) marginal += (w[b] || 0) * covMatrix[a][b];
        rawRc[a] = (w[a] || 0) * marginal;
        totalRc += rawRc[a];
      }
      for (const a of validIsins) {
        riskContributions[a] = totalRc > 0 ? Math.round((rawRc[a] / totalRc) * 1000) / 1000 : 0;
      }
    } catch {
      // ignore
    }

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
      risk_contributions: riskContributions,
      mc_target_label: mcTargetLabel,
      monte_carlo: {
        chart,
        success_rate: successRate,
        drawdown,
        combined_drawdown: combinedDrawdown,
        irr,
        insurance_stats: insuranceStats,
        stressed_volatility: stressedVol,
      },
    };
  }
}
