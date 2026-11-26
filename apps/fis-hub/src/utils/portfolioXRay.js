/**
 * 晨星组合透视（Morningstar Portfolio X-Ray）计算引擎（本地兼容与兜底层）。
 * 结合 Obsidian《基金评估体系_Morningstar框架》与多资产直投（个股/债券）统一穿透规则：
 * 1. 工具结构识别（基金 / 直投个股 / 直投债券 / 现金）
 * 2. 资产大类透视（Asset Class）
 * 3. 币种与地区敞口（Currency / Region）
 * 4. 费用透视与 Bogle 10年复利侵蚀（Price / MPS 加权费率）
 * 5. 晨星质量与 SOP 2026 覆盖率、加权久期、税前分红率
 * 6. 分散度与基础风险透视（Effective N、集中度、加权波动率/夏普/最大回撤）
 */

function normalizeAssetBucket(rawClass = '', isin = '', instrumentType = 'fund') {
  if (instrumentType === 'cash' || isin.toUpperCase().startsWith('CASH_')) return '现金及货币';
  if (instrumentType === 'direct_bond') return '固定收益 / 债券';
  if (instrumentType === 'direct_stock') return '股票资产';
  const s = String(rawClass).toLowerCase();
  if (/equity|stock|股票|股息|高息/.test(s)) return '股票资产';
  if (/bond|fixed|income|debt|treasury|govt|corp|债|固收|收益/.test(s)) return '固定收益 / 债券';
  if (/mixed|multi|balanced|allocation|混合|多元|平衡/.test(s)) return '多元资产 / 混合';
  if (/cash|money|货币|短债/.test(s)) return '现金及货币';
  if (/commodity|gold|reit|real estate|alt|另类|黄金|地产/.test(s)) return '另类 / 实物资产';
  return rawClass || '其他资产';
}

export function findCatalogFund(quantFunds, identifier) {
  if (!Array.isArray(quantFunds) || !identifier) return null;
  const key = String(identifier).trim().toUpperCase();
  return (
    quantFunds.find((f) => {
      const candidates = [f.code, f.aia_code, f.isin, f.slug].filter(Boolean);
      return candidates.some((c) => String(c).trim().toUpperCase() === key);
    }) || null
  );
}

export function classifyHoldingInstrument(holding = {}, cat = null) {
  const code = String(holding.isin || '').trim().toUpperCase();
  if (holding.asset_type === 'cash' || code.startsWith('CASH_')) return 'cash';
  if (cat) return 'fund';
  if (holding.asset_type === 'fund') return 'fund';
  if (holding.asset_type === 'bond') return 'direct_bond';
  if (holding.asset_type === 'stock') return 'direct_stock';

  const hint = `${code} ${String(holding.name || '')} ${typeof holding.sector === 'string' ? holding.sector : ''}`;
  if (
    holding.duration != null ||
    holding.ytm != null ||
    holding.credit_rating != null ||
    /(^BOND_|TREASURY|T-BILL|GOVT|CORP\s*BOND|FIXED\s*INCOME|国债|企业债|公司债|债券)/i.test(hint)
  ) {
    return 'direct_bond';
  }
  return 'direct_stock';
}

/**
 * @param {Object} params
 * @param {Array<{isin: string, name?: string, weight: number, sector?: string, country?: string, currency?: string, market_value?: number, asset_type?: string, duration?: number, ytm?: number, credit_rating?: string, dividend_yield?: number, fee_pct?: number}>} params.holdings
 * @param {Array} params.quantFunds
 * @param {number} [params.totalNav]
 * @param {number} [params.taxRate]
 * @param {number} [params.ilpAnnualDragPct]
 */
export function computePortfolioXRay({
  holdings = [],
  quantFunds = [],
  totalNav = 0,
  taxRate = 0,
  ilpAnnualDragPct = 0,
}) {
  const valid = holdings.filter((h) => h && Number(h.weight) > 0);
  const totalWeight = valid.reduce((s, h) => s + Number(h.weight), 0) || 1;

  const assetClassMap = {};
  const currencyMap = {};
  const gradeMap = { 'A+': 0, A: 0, 'B+': 0, B: 0, C: 0, Unrated: 0 };
  const instrumentMixWeights = { funds: 0, direct_stocks: 0, direct_bonds: 0, cash: 0 };

  let feeWeightSum = 0;
  let weightedFee = 0;
  let starWeightSum = 0;
  let weightedStars = 0;
  let volWeightSum = 0;
  let weightedVol = 0;
  let sharpeWeightSum = 0;
  let weightedSharpe = 0;
  let ddWeightSum = 0;
  let weightedMaxDd = 0;
  let durationWeightSum = 0;
  let weightedDuration = 0;
  let yieldWeightSum = 0;
  let weightedYield = 0;
  let totalFundWeight = 0;
  let sopCoveredWeight = 0;

  let nonCashWeightSum = 0;
  let hhi = 0;
  let maxSingleHolding = { isin: '', name: '', weightPct: 0 };

  const enrichedHoldings = valid.map((h) => {
    const w = Number(h.weight) / totalWeight;
    const cat = findCatalogFund(quantFunds, h.isin);
    const instrumentType = classifyHoldingInstrument(h, cat);
    const isCash = instrumentType === 'cash';

    if (isCash) instrumentMixWeights.cash += w;
    else if (instrumentType === 'fund') instrumentMixWeights.funds += w;
    else if (instrumentType === 'direct_stock') instrumentMixWeights.direct_stocks += w;
    else instrumentMixWeights.direct_bonds += w;

    const resolvedName = h.name && h.name !== h.isin ? h.name : cat?.name || h.isin;
    const assetBucket = normalizeAssetBucket(
      cat?.asset_class || (typeof h.sector === 'string' ? h.sector : ''),
      h.isin,
      instrumentType
    );
    const ccy = cat?.currency || h.currency || (isCash ? h.isin.replace('CASH_', '') : 'USD');

    assetClassMap[assetBucket] = (assetClassMap[assetBucket] || 0) + w;
    currencyMap[ccy] = (currencyMap[ccy] || 0) + w;

    const feeVal = h.fee_pct != null ? Number(h.fee_pct) : instrumentType === 'fund' ? cat?.fee_pct : 0;
    const durVal = h.duration != null ? Number(h.duration) : cat?.duration ?? null;
    const yldVal =
      h.dividend_yield != null
        ? Number(h.dividend_yield)
        : h.ytm != null
        ? Number(h.ytm)
        : cat?.sop_dividend_yield_ttm != null
        ? Number(cat.sop_dividend_yield_ttm)
        : cat?.div_yield_ttm != null
        ? Number(cat.div_yield_ttm) * 100
        : cat?.yield_pct ?? null;

    if (!isCash) {
      nonCashWeightSum += w;
      hhi += w * w;
      if (w * 100 > maxSingleHolding.weightPct) {
        maxSingleHolding = { isin: h.isin, name: resolvedName, weightPct: w * 100 };
      }

      if (instrumentType === 'fund') {
        totalFundWeight += w;
        if (cat?.has_sop_report) sopCoveredWeight += w;
      }

      const grade = cat?.quant_grade;
      if (grade && gradeMap[grade] !== undefined) {
        gradeMap[grade] += w;
      } else {
        gradeMap.Unrated += w;
      }

      if (feeVal != null && Number.isFinite(Number(feeVal))) {
        feeWeightSum += w;
        weightedFee += w * Number(feeVal);
      }
      if (durVal != null && Number.isFinite(Number(durVal))) {
        durationWeightSum += w;
        weightedDuration += w * Number(durVal);
      }
      if (yldVal != null && Number.isFinite(Number(yldVal)) && Number(yldVal) >= 0) {
        yieldWeightSum += w;
        weightedYield += w * Number(yldVal);
      }
      if (cat?.morningstar_stars != null && Number(cat.morningstar_stars) > 0) {
        starWeightSum += w;
        weightedStars += w * Number(cat.morningstar_stars);
      }
      if (cat?.vol_3y != null && Number.isFinite(Number(cat.vol_3y))) {
        volWeightSum += w;
        weightedVol += w * Number(cat.vol_3y);
      }
      if (cat?.sharpe_3y != null && Number.isFinite(Number(cat.sharpe_3y))) {
        sharpeWeightSum += w;
        weightedSharpe += w * Number(cat.sharpe_3y);
      }
      if (cat?.max_dd_3y != null && Number.isFinite(Number(cat.max_dd_3y))) {
        ddWeightSum += w;
        weightedMaxDd += w * Number(cat.max_dd_3y);
      }
    }

    return {
      isin: h.isin,
      slug: cat?.slug || null,
      name: resolvedName,
      instrument_type: instrumentType,
      weightPct: Math.round(w * 1000) / 10,
      assetBucket,
      currency: ccy,
      stars: cat?.morningstar_stars ?? null,
      grade: cat?.quant_grade ?? null,
      feePct: feeVal != null && Number.isFinite(Number(feeVal)) ? Number(feeVal) : null,
      duration: durVal,
      yieldPct: yldVal,
      hasSopReport: Boolean(cat?.has_sop_report),
    };
  });

  const toSortedList = (map) =>
    Object.entries(map)
      .map(([label, w]) => ({ label, pct: Math.round(w * 1000) / 10 }))
      .filter((x) => x.pct > 0)
      .sort((a, b) => b.pct - a.pct);

  const avgFeePct =
    feeWeightSum > 0
      ? weightedFee / feeWeightSum + Number(ilpAnnualDragPct || 0)
      : ilpAnnualDragPct > 0
      ? Number(ilpAnnualDragPct)
      : null;
  const avgStars = starWeightSum > 0 ? weightedStars / starWeightSum : null;
  const avgVol = volWeightSum > 0 ? weightedVol / volWeightSum : null;
  const avgSharpe = sharpeWeightSum > 0 ? weightedSharpe / sharpeWeightSum : null;
  const avgMaxDd = ddWeightSum > 0 ? weightedMaxDd / ddWeightSum : null;
  const weightedDurationVal = durationWeightSum > 0 ? Math.round((weightedDuration / durationWeightSum) * 100) / 100 : null;
  const weightedYieldPct = yieldWeightSum > 0 ? Math.round((weightedYield / yieldWeightSum) * 100) / 100 : null;
  const aftertaxYieldPct =
    weightedYieldPct != null ? Math.round(weightedYieldPct * (1 - Math.max(0, Math.min(0.5, Number(taxRate || 0)))) * 100) / 100 : null;

  const grossR = 0.065;
  const feeR = (avgFeePct || 0) / 100;
  const feeDrag10yPct =
    avgFeePct != null
      ? Math.round((((Math.pow(1 + grossR, 10) - Math.pow(1 + grossR - feeR, 10)) / Math.pow(1 + grossR, 10)) * 100) * 10) / 10
      : null;

  const normalizedHhi = nonCashWeightSum > 0 ? hhi / (nonCashWeightSum * nonCashWeightSum) : 0;
  const effectiveN = normalizedHhi > 0 ? 1 / normalizedHhi : 0;
  const estAnnualFeeAmount = avgFeePct != null && totalNav > 0 ? (totalNav * avgFeePct) / 100 : null;

  const feeTier =
    avgFeePct == null
      ? 'unknown'
      : avgFeePct <= 0.6
      ? 'low'
      : avgFeePct <= 1.35
      ? 'moderate'
      : 'high';

  const diagnostics = [];
  if (maxSingleHolding.weightPct >= 35) {
    diagnostics.push({
      level: 'warn',
      text: `单一持仓集中度偏高：${maxSingleHolding.name} 占比 ${maxSingleHolding.weightPct.toFixed(1)}%（建议控制在 35% 以内）`,
    });
  }
  if (effectiveN > 0 && effectiveN < 3) {
    diagnostics.push({
      level: 'warn',
      text: `有效持仓数仅 ${effectiveN.toFixed(1)} 只，分散度偏低，建议增加低相关性资产。`,
    });
  }
  if (avgFeePct != null && avgFeePct > 1.35) {
    diagnostics.push({
      level: 'warn',
      text: `加权管理费率 ${avgFeePct.toFixed(2)}% 偏高（Morningstar MPS 理念提示高费率会持续侵蚀复利）。`,
    });
  }
  if (weightedDurationVal != null && weightedDurationVal >= 5) {
    diagnostics.push({
      level: 'warn',
      text: `固定收益加权久期 ${weightedDurationVal.toFixed(2)} 年：利率上行 +100bps 理论冲击约 -${weightedDurationVal.toFixed(1)}%。`,
    });
  }
  if (avgStars != null && avgStars >= 4) {
    diagnostics.push({
      level: 'good',
      text: `加权晨星评级达 ${avgStars.toFixed(1)}★，整体底层基金质量处于同类前列。`,
    });
  }
  if (diagnostics.length === 0 && enrichedHoldings.length > 0) {
    diagnostics.push({
      level: 'good',
      text: '组合资产分散度与费用结构整体均衡，未发现明显集中度或费率异常。',
    });
  }

  return {
    assetClasses: toSortedList(assetClassMap),
    currencies: toSortedList(currencyMap),
    gradeDistribution: toSortedList(gradeMap),
    instrumentMix: {
      funds_pct: Math.round(instrumentMixWeights.funds * 1000) / 10,
      direct_stocks_pct: Math.round(instrumentMixWeights.direct_stocks * 1000) / 10,
      direct_bonds_pct: Math.round(instrumentMixWeights.direct_bonds * 1000) / 10,
      cash_pct: Math.round(instrumentMixWeights.cash * 1000) / 10,
    },
    avgFeePct,
    feeCoveragePct: Math.round(feeWeightSum * 1000) / 10,
    feeTier,
    feeDrag10yPct,
    estAnnualFeeAmount,
    avgStars,
    avgVol,
    avgSharpe,
    avgMaxDd,
    weightedDuration: weightedDurationVal,
    weightedYieldPct,
    aftertaxYieldPct,
    sopCoveredWeightPct: totalFundWeight > 0 ? Math.round((sopCoveredWeight / totalFundWeight) * 1000) / 10 : 0,
    effectiveN,
    maxSingleHolding,
    diagnostics,
    holdings: enrichedHoldings,
  };
}
