import { describe, expect, it } from 'vitest';
import {
  buildPortfolioDriftRows,
  filterAndSortFunds,
  fmtNum,
  fmtPct,
  fmtSignedPct,
  gradeMeta,
  tierMeta,
} from './fundQuantUtils';

describe('fundQuantUtils', () => {
  it('formats percentages and numbers cleanly', () => {
    expect(fmtPct(0.0842)).toBe('8.42%');
    expect(fmtPct(null)).toBe('—');
    expect(fmtSignedPct(0.1234)).toBe('+12.34%');
    expect(fmtSignedPct(-0.051)).toBe('-5.10%');
    expect(fmtNum(1.256, 2)).toBe('1.26');
  });

  it('filters by platform, query, non-rec tag and sorts nulls last', () => {
    const sample = [
      { slug: 'Z01_F', code: 'Z01', aia_code: 'Z01', name: '惠理高息股票', ilas_platform: 'AIA 卓达智悦2', asset_class: '股票', quant_score: 78, data_tier: 'B', quant_grade: 'A', tags: ['推荐选择'], is_distributing: true },
      { slug: 'B01_F', code: 'B01', aia_code: 'B01', name: '联博短债', ilas_platform: 'AIA 卓达智悦2', asset_class: '固定收益', quant_score: null, data_tier: 'B', quant_grade: null, tags: ['非推荐选择'], is_distributing: false },
      { slug: 'US_SCHD', code: 'SCHD', name: 'Schwab US Dividend', ilas_platform: '非投连险-美股分红型ETF', asset_class: '股票', quant_score: 88, data_tier: 'A', quant_grade: 'A', tags: [], is_distributing: true },
    ];

    const aiaOnly = filterAndSortFunds(sample, { platformGroup: 'aia', excludeNonRec: true });
    expect(aiaOnly.map((x) => x.slug)).toEqual(['Z01_F']);

    const sortedDesc = filterAndSortFunds(sample, { sortKey: 'quant_score', sortOrder: 'desc' });
    expect(sortedDesc.map((x) => x.slug)).toEqual(['US_SCHD', 'Z01_F', 'B01_F']);

    const searched = filterAndSortFunds(sample, { q: 'schd' });
    expect(searched).toHaveLength(1);
    expect(searched[0].slug).toBe('US_SCHD');
  });

  it('computes portfolio allocation drift and flags >=5% threshold while ignoring unallocated CASH rows', () => {
    const details = [
      { isin: 'CASH_USD', name: 'USD Cash', market_value: 20000 },
      { isin: 'Z01', name: 'Value Partners', market_value: 50000 },
      { isin: 'AGG', name: 'US Bond', market_value: 30000 },
    ];
    const rows = buildPortfolioDriftRows(details, { Z01: 0.5, AGG: 0.5 });
    expect(rows.map((r) => r.isin)).toEqual(['AGG', 'Z01']);
    expect(rows.find((r) => r.isin === 'CASH_USD')).toBeUndefined();
    expect(rows.find((r) => r.isin === 'AGG')?.driftPct).toBe(-20);
    expect(rows.find((r) => r.isin === 'AGG')?.needsRebalance).toBe(true);
    expect(rows.find((r) => r.isin === 'Z01')?.driftPct).toBe(0);
  });

  it('returns grade & tier metadata', () => {
    expect(gradeMeta('A').label).toBe('A');
    expect(tierMeta('B', 'en').label).toBe('Tier B');
  });
});
