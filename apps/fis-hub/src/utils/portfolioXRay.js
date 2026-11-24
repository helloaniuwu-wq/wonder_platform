/**
 * 晨星组合透视（Morningstar Portfolio X-Ray）计算引擎。
 * 结合 Obsidian《基金评估体系_Morningstar框架》的 5 支柱理念与 X-Ray 穿透维度：
 * 1. 资产大类透视（Asset Class）
 * 2. 币种与地区敞口（Currency / Region）
 * 3. 费用透视（Price / MPS 加权费率）
 * 4. 晨星质量与 5 支柱代理（Stars / Quant Grade）
 * 5. 分散度与风险透视（Effective N、集中度、加权波动率/夏普/最大回撤）
 */

function normalizeAssetBucket(rawClass = '', isin = '') {
  if (isin.startsWith('CASH_')) return '现金及货币';
  const s = String(rawClass).toLowerCase();
  if (/equity|stock|股票|股息|高息/.test(s)) return '股票资产';
  if (/bond|fixed|income|debt|债|固收|收益/.test(s)) return '固定收益 / 债券';
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

/**
 * @param {Object} params
 * @param {Array<{isin: string, name?: string, weight: number, sector?: string, country?: string, currency?: string, market_value?: number}>} params.holdings
 * @param {Array} params.quantFunds
 * @param {number} [params.totalNav]
 */
export function computePortfolioXRay({ holdings = [], quantFunds = [], totalNav = 0 }) {
  const valid = holdings.filter((h) => h && Number(h.weight) > 0);
  const totalWeight = valid.reduce((s, h) => s + Number(h.weight), 0) || 1;

  const assetClassMap = {};
  const currencyMap = {};
  const gradeMap = { 'A+': 0, A: 0, 'B+': 0, B: 0, C: 0, Unrated: 0 };

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

  let nonCashWeightSum = 0;
  let hhi = 0;
  let maxSingleHolding = { isin: '', name: '', weightPct: 0 };

  const enrichedHoldings = valid.map((h) => {
    const w = Number(h.weight) / totalWeight;
    const cat = findCatalogFund(quantFunds, h.isin);
    const isCash = h.isin.startsWith('CASH_');
    const resolvedName =
      h.name && h.name !== h.isin ? h.name : cat?.name || h.isin;
    const assetBucket = normalizeAssetBucket(cat?.asset_class || h.sector, h.isin);
    const ccy = cat?.currency || h.currency || (isCash ? h.isin.replace('CASH_', '') : 'USD');

    assetClassMap[assetBucket] = (assetClassMap[assetBucket] || 0) + w;
    currencyMap[ccy] = (currencyMap[ccy] || 0) + w;

    if (!isCash) {
      nonCashWeightSum += w;
      hhi += w * w;
      if (w * 100 > maxSingleHolding.weightPct) {
        maxSingleHolding = { isin: h.isin, name: resolvedName, weightPct: w * 100 };
      }

      const grade = cat?.quant_grade;
      if (grade && gradeMap[grade] !== undefined) {
        gradeMap[grade] += w;
      } else {
        gradeMap.Unrated += w;
      }

      if (cat?.fee_pct != null && Number.isFinite(Number(cat.fee_pct))) {
        feeWeightSum += w;
        weightedFee += w * Number(cat.fee_pct);
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
      name: resolvedName,
      weightPct: Math.round(w * 1000) / 10,
      assetBucket,
      currency: ccy,
      stars: cat?.morningstar_stars ?? null,
      grade: cat?.quant_grade ?? null,
      feePct: cat?.fee_pct ?? null,
    };
  });

  const toSortedList = (map) =>
    Object.entries(map)
      .map(([label, w]) => ({ label, pct: Math.round(w * 1000) / 10 }))
      .filter((x) => x.pct > 0)
      .sort((a, b) => b.pct - a.pct);

  const avgFeePct = feeWeightSum > 0 ? weightedFee / feeWeightSum : null;
  const avgStars = starWeightSum > 0 ? weightedStars / starWeightSum : null;
  const avgVol = volWeightSum > 0 ? weightedVol / volWeightSum : null;
  const avgSharpe = sharpeWeightSum > 0 ? weightedSharpe / sharpeWeightSum : null;
  const avgMaxDd = ddWeightSum > 0 ? weightedMaxDd / ddWeightSum : null;
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
    avgFeePct,
    feeCoveragePct: Math.round(feeWeightSum * 1000) / 10,
    feeTier,
    estAnnualFeeAmount,
    avgStars,
    avgVol,
    avgSharpe,
    avgMaxDd,
    effectiveN,
    maxSingleHolding,
    diagnostics,
    holdings: enrichedHoldings,
  };
}
