import { describe, expect, it } from 'vitest';
import { classifyHoldingInstrument, computePortfolioXRay } from './portfolioXRay';

describe('computePortfolioXRay', () => {
  const catalog = [
    {
      code: 'Z17',
      slug: 'z17',
      name: '贝莱德全球高息股',
      asset_class: '股票',
      currency: 'USD',
      fee_pct: 1.5,
      morningstar_stars: 4,
      quant_grade: 'A',
      vol_3y: 10.2,
      sharpe_3y: 1.1,
      max_dd_3y: -12.5,
      has_sop_report: true,
    },
    {
      code: 'Z36',
      slug: 'z36',
      name: '东方汇理美元短债',
      asset_class: '债券',
      currency: 'USD',
      fee_pct: 0.5,
      morningstar_stars: 5,
      quant_grade: 'A+',
      vol_3y: 1.5,
      sharpe_3y: 1.8,
      max_dd_3y: -1.8,
      duration: 1.2,
      yield_pct: 4.3,
    },
  ];

  it('aggregates asset classes, weighted fee, stars, and effective N', () => {
    const xray = computePortfolioXRay({
      holdings: [
        { isin: 'Z17', weight: 0.6 },
        { isin: 'Z36', weight: 0.4 },
      ],
      quantFunds: catalog,
      totalNav: 100000,
    });

    expect(xray.assetClasses).toEqual([
      { label: '股票资产', pct: 60 },
      { label: '固定收益 / 债券', pct: 40 },
    ]);
    expect(xray.avgFeePct).toBeCloseTo(1.1, 4);
    expect(xray.estAnnualFeeAmount).toBeCloseTo(1100, 1);
    expect(xray.avgStars).toBeCloseTo(4.4, 4);
    expect(xray.effectiveN).toBeCloseTo(1 / (0.36 + 0.16), 4);
    expect(xray.maxSingleHolding.weightPct).toBeCloseTo(60, 1);
    expect(xray.diagnostics.some((d) => d.level === 'warn')).toBe(true);
    expect(xray.sopCoveredWeightPct).toBeCloseTo(60, 1);
  });

  it('classifies and integrates direct stocks and direct bonds seamlessly', () => {
    expect(classifyHoldingInstrument({ isin: 'AAPL', asset_type: 'stock' }, null)).toBe('direct_stock');
    expect(classifyHoldingInstrument({ isin: 'US10Y_BOND', duration: 8.0, ytm: 4.5 }, null)).toBe('direct_bond');
    expect(classifyHoldingInstrument({ isin: 'CASH_USD' }, null)).toBe('cash');

    const xray = computePortfolioXRay({
      holdings: [
        { isin: 'Z36', weight: 0.4 },
        { isin: 'AAPL', name: 'Apple Inc.', weight: 0.3, asset_type: 'stock', dividend_yield: 0.5 },
        { isin: 'US10Y_BOND', name: 'US Treasury 10Y', weight: 0.3, asset_type: 'bond', duration: 8.2, ytm: 4.5 },
      ],
      quantFunds: catalog,
      totalNav: 100000,
    });

    expect(xray.instrumentMix).toEqual({
      funds_pct: 40,
      direct_stocks_pct: 30,
      direct_bonds_pct: 30,
      cash_pct: 0,
    });
    expect(xray.weightedDuration).toBeGreaterThan(4);
    // Z36 fee 0.5% (40%) + direct AAPL 0% (30%) + direct bond 0% (30%) => avg 0.20%
    expect(xray.avgFeePct).toBeCloseTo(0.2, 4);
  });
});
