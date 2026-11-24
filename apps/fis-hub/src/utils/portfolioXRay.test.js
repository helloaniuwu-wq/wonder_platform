import { describe, expect, it } from 'vitest';
import { computePortfolioXRay } from './portfolioXRay';

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
  });
});
