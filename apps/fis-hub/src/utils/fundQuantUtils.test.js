import { describe, expect, it } from 'vitest';
import {
  ADMIN_CORE_PICK_REASONS,
  buildPortfolioDriftRows,
  collectAvailableFundTags,
  collectAvailableManagers,
  filterAndSortFunds,
  fmtNum,
  fmtPct,
  fmtSignedPct,
  getFundDomicile,
  gradeMeta,
  inferFundRole,
  inferFundRegion,
  normalizeManagerName,
  resolveFundTwins,
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

  it('classifies European UCITS funds (IE/LU), excludes USHY/SCHD, and filters by domicile and multiple tags', () => {
    const catalog = [
      { slug: 'BD_IWDA', code: 'IWDA', yahoo_ticker: 'IWDA.L', name: 'iShares Core MSCI World UCITS ETF', ilas_platform: '非投连险-债券基金比较', asset_class: '股票', currency: 'USD', fee_pct: 0.2, role: '核心', quant_score: 76, tags: ['基金档案', '非投连险', '全球'], is_distributing: false },
      { slug: 'BD_VHYD', code: 'VHYD', yahoo_ticker: 'VHYD.L', name: 'Vanguard FTSE All-World High Dividend Yield UCITS ETF', ilas_platform: '非投连险-债券基金比较', asset_class: '股票', currency: 'USD', fee_pct: 0.29, div_yield_ttm: 0.045, quant_score: 91, tags: ['基金档案', '高股息'], is_distributing: true },
      { slug: 'BD_CSH2', code: 'CSH2', yahoo_ticker: 'CSH2.L', name: '短期美债 Amundi Overnight', ilas_platform: '非投连险-债券基金比较', asset_class: '固定收益', currency: 'GBP', fee_pct: 0.1, role: '核心', quant_score: 83, tags: ['基金档案'], is_distributing: false },
      { slug: 'BD_USHY', code: 'USHY', yahoo_ticker: 'USHY', name: 'Amundi Index Solution - Amundi USD High Yield', ilas_platform: '非投连险-债券基金比较', asset_class: '固定收益', currency: 'USD', quant_score: 65, tags: ['基金档案'], is_distributing: false },
      { slug: 'US_SCHD', code: 'SCHD', yahoo_ticker: 'SCHD', name: '美国红利股ETF', ilas_platform: '非投连险-美股分红型ETF', asset_class: '股票', currency: 'USD', fee_pct: 0.06, div_yield_ttm: 0.042, quant_score: 88, tags: ['基金档案', '客户-李红'], is_distributing: true },
    ];

    expect(getFundDomicile(catalog[0])).toBe('IE');
    expect(getFundDomicile(catalog[2])).toBe('LU');
    expect(getFundDomicile(catalog[3])).toBe('US');
    expect(getFundDomicile(catalog[4])).toBe('US');

    const euOnly = filterAndSortFunds(catalog, { platformGroup: 'eu_ucits' });
    expect(euOnly.map((x) => x.code)).toEqual(['VHYD', 'CSH2', 'IWDA']);

    const ieOnly = filterAndSortFunds(catalog, { domicile: 'ie' });
    expect(ieOnly.map((x) => x.code)).toEqual(['VHYD', 'IWDA']);

    const luOnly = filterAndSortFunds(catalog, { domicile: 'lu' });
    expect(luOnly.map((x) => x.code)).toEqual(['CSH2']);

    const coreUsd = filterAndSortFunds(catalog, { role: 'core', currency: 'USD' });
    expect(coreUsd.map((x) => x.code)).toEqual(['VHYD', 'SCHD', 'IWDA']);

    const multiTagOr = filterAndSortFunds(catalog, { tags: ['低费率(≤0.3%)', '高股息/红利'] });
    expect(multiTagOr.map((x) => x.code)).toEqual(['VHYD', 'SCHD', 'CSH2', 'IWDA']);

    const available = collectAvailableFundTags(catalog).map((t) => t.tag);
    expect(available).toContain('免美遗产税');
    expect(available).toContain('低费率(≤0.3%)');
    expect(available).not.toContain('爱尔兰(IE)');
    expect(available).not.toContain('基金档案');
    expect(available).not.toContain('客户-李红');

    // Newly injected LSE USD UCITS ETFs + VHYL alias search + Acc/Dist/Region/Manager/Twin resolution
    const newUcits = [
      { slug: 'EU_CSPX', code: 'CSPX', isin: 'IE00B5BMR087', yahoo_ticker: 'CSPX.L', manager: 'BlackRock (iShares)', name: 'iShares Core S&P 500 UCITS ETF (Acc)', ilas_platform: '非投连险-国际股票', asset_class: '股票', currency: 'USD', fee_pct: 0.07, role: '核心', quant_score: 92, tags: ['爱尔兰UCITS', 'LSE美元'], twin_code: 'IUSA', is_distributing: false },
      { slug: 'EU_IBTA', code: 'IBTA', isin: 'IE00BYXPSP02', yahoo_ticker: 'IBTA.L', manager: 'iShares', name: 'iShares $ Treasury Bond 1-3yr UCITS ETF (Acc)', ilas_platform: '非投连险-债券基金比较', asset_class: '固定收益', currency: 'USD', fee_pct: 0.07, role: '核心', quant_score: 85, tags: ['爱尔兰UCITS'], is_distributing: false },
      { slug: 'EU_VDTY', code: 'VDTY', isin: 'IE00BZ163M45', yahoo_ticker: 'VDTY.L', manager: 'Vanguard', name: 'Vanguard USD Treasury Bond UCITS ETF (Dist)', ilas_platform: '非投连险-债券基金比较', asset_class: '固定收益', currency: 'USD', fee_pct: 0.07, role: '核心', quant_score: 80, tags: ['爱尔兰UCITS', '每月派息'], is_distributing: true },
      { slug: 'BD_VHYD', code: 'VHYD', isin: 'IE00B8GKDB10', yahoo_ticker: 'VHYD.L', manager: 'Vanguard', name: 'Vanguard FTSE All-World High Dividend Yield UCITS ETF (Dist · VHYD/VHYL)', ilas_platform: '非投连险-国际股票', asset_class: '股票', currency: 'USD', fee_pct: 0.29, quant_score: 91, tags: ['VHYL', '爱尔兰UCITS'], is_distributing: true },
      { slug: 'V02_F', code: 'V02', aia_code: 'V02', manager: '惠理(Value Partners)', name: '惠理高息股票基金 (累積)', ilas_platform: 'AIA 卓达智悦2', asset_class: '股票', currency: 'USD', quant_score: 88, is_distributing: false },
      { slug: 'Z01_F', code: 'Z01', aia_code: 'Z01', manager: '惠理(Value Partners)', name: '惠理高息股票基金 (分派)', ilas_platform: 'AIA 卓达智悦2', asset_class: '股票', currency: 'USD', quant_score: 86, twin_code: 'V02', is_distributing: true },
    ];
    expect(newUcits.slice(0, 4).every((f) => getFundDomicile(f) === 'IE')).toBe(true);
    expect(filterAndSortFunds(newUcits, { platformGroup: 'eu_ucits' })).toHaveLength(4);
    expect(filterAndSortFunds(newUcits, { q: 'vhyl' }).map((f) => f.slug)).toEqual(['BD_VHYD']);
    expect(filterAndSortFunds(newUcits, { tags: ['短债/现金管理'] }).map((f) => f.code)).toEqual(['IBTA']);
    expect(filterAndSortFunds(newUcits, { distType: 'dist' }).map((f) => f.code)).toEqual(['VHYD', 'Z01', 'VDTY']);
    expect(filterAndSortFunds(newUcits, { distType: 'acc' }).map((f) => f.code)).toEqual(['CSPX', 'V02', 'IBTA']);
    expect(normalizeManagerName('BlackRock (iShares)')).toBe('贝莱德 / iShares');
    expect(collectAvailableManagers(newUcits).map((m) => m.manager)).toContain('Vanguard (领航)');
    expect(inferFundRegion(newUcits[0])).toBe('us');
    expect(resolveFundTwins(newUcits[4], newUcits).map((tw) => tw.code)).toEqual(['Z01']);
    expect(resolveFundTwins(newUcits[5], newUcits).map((tw) => tw.code)).toEqual(['V02']);

    // Institutional Core vs Satellite checks (HY / EM / Dividend = satellite; Broad IG / Broad Equity = core)
    expect(inferFundRole(newUcits[0])).toBe('core'); // CSPX
    expect(inferFundRole(newUcits[1])).toBe('core'); // IBTA
    expect(inferFundRole(newUcits[2])).toBe('core'); // VDTY
    expect(inferFundRole(newUcits[3])).toBe('core'); // VHYD (Global High Dividend Core)
    expect(inferFundRole({ code: 'SCHD', name: '美国红利股ETF', asset_class: '股票' })).toBe('core');
    expect(inferFundRole({ code: 'Z01', name: '惠理高息股票基金 (Value Partners High Dividend Stocks Fund)', asset_class: '股票' })).toBe('satellite');
    expect(inferFundRole({ code: 'DIVO', name: 'Amplify CWP Enhanced Dividend Income ETF', asset_class: '股票' })).toBe('satellite');
    expect(inferFundRole({ code: 'I28', name: '貝萊德環球高收益債券', asset_class: '固定收益', role: '核心' })).toBe('satellite');
    expect(inferFundRole({ code: 'J07', name: '施羅德新興市場債券', asset_class: '固定收益', role: '核心' })).toBe('satellite');
    expect(inferFundRole({ code: 'A05', name: 'PineBridge Hong Kong Dollar Money Market Fund', asset_class: '货币基金' })).toBe('core');
    expect(filterAndSortFunds(newUcits, { role: 'core' }).map((f) => f.code)).toEqual(['CSPX', 'VHYD', 'IBTA', 'VDTY']);

    // Admin core pick preset reasons & searchability
    expect(ADMIN_CORE_PICK_REASONS.map((r) => r.id)).toContain('核心美国');
    expect(ADMIN_CORE_PICK_REASONS.map((r) => r.id)).toContain('低波动增强');
    const taggedWithCoreReason = [
      { ...newUcits[0], is_admin_core_pick: true, admin_core_reasons: ['核心美国', '低波动增强'], admin_core_note: '旗舰标普底仓' },
      { ...newUcits[1], is_admin_core_pick: false, admin_core_reasons: [] },
    ];
    expect(filterAndSortFunds(taggedWithCoreReason, { q: '低波动增强' }).map((f) => f.code)).toEqual(['CSPX']);
    expect(filterAndSortFunds(taggedWithCoreReason, { q: '旗舰标普底仓' }).map((f) => f.code)).toEqual(['CSPX']);
  });
});
