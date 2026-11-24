/**
 * Pure formatting, badge, filtering & drift calculation utilities for Wonder Quant UI.
 */

export function fmtPct(val, digits = 2) {
  if (val === null || val === undefined || Number.isNaN(Number(val))) return '—';
  return `${(Number(val) * 100).toFixed(digits)}%`;
}

export function fmtSignedPct(val, digits = 2) {
  if (val === null || val === undefined || Number.isNaN(Number(val))) return '—';
  const num = Number(val) * 100;
  return `${num >= 0 ? '+' : ''}${num.toFixed(digits)}%`;
}

export function fmtNum(val, digits = 2) {
  if (val === null || val === undefined || Number.isNaN(Number(val))) return '—';
  return Number(val).toFixed(digits);
}

export function gradeMeta(grade) {
  const map = {
    A: { label: 'A', color: 'var(--success)', bg: 'var(--success-bg)' },
    B: { label: 'B', color: 'var(--info)', bg: 'rgba(59, 130, 246, 0.12)' },
    C: { label: 'C', color: 'var(--warning)', bg: 'var(--warning-bg)' },
    D: { label: 'D', color: 'var(--danger)', bg: 'var(--danger-bg)' },
  };
  return map[grade] || { label: '—', color: 'var(--text-muted)', bg: 'var(--surface-subtle)' };
}

export function tierMeta(tier, lang = 'zh') {
  const zh = {
    A: { label: 'Tier A', desc: '市场官方总回报日线', color: 'var(--success)' },
    B: { label: 'Tier B', desc: '底层代理历史回溯 + 官方日度追加', color: 'var(--info)' },
    C: { label: 'Tier C', desc: '单点快照 / 不足 1 年历史', color: 'var(--warning)' },
    U: { label: 'Tier U', desc: '暂缺净值源（支持 CSV 导入）', color: 'var(--text-muted)' },
  };
  const en = {
    A: { label: 'Tier A', desc: 'Official market total-return daily series', color: 'var(--success)' },
    B: { label: 'Tier B', desc: 'Underlying proxy history + official daily appends', color: 'var(--info)' },
    C: { label: 'Tier C', desc: 'Snapshot / < 1Y history', color: 'var(--warning)' },
    U: { label: 'Tier U', desc: 'No feed yet (CSV import supported)', color: 'var(--text-muted)' },
  };
  const dict = lang === 'en' ? en : zh;
  return dict[tier] || dict.U;
}

export function filterAndSortFunds(items = [], filters = {}) {
  const {
    q = '',
    platformGroup = 'all',
    assetClass = 'all',
    minStars = 0,
    tier = 'ALL',
    grade = 'ALL',
    excludeNonRec = false,
    onlyDistributing = false,
    sortKey = 'quant_score',
    sortOrder = 'desc',
  } = filters;

  const query = q.trim().toLowerCase();
  const dir = sortOrder === 'asc' ? 1 : -1;

  const filtered = items.filter((r) => {
    const plat = r.ilas_platform || '';
    if (platformGroup === 'aia' && !plat.startsWith('AIA')) return false;
    if (platformGroup === 'non_ilas' && plat.startsWith('AIA')) return false;
    if (
      platformGroup === 'us_intl' &&
      !['非投连险-美股分红型ETF', '非投连险-国际股票', '非投连险-分红型基金', '非投连险-日本宽基ETF'].includes(plat)
    ) {
      return false;
    }
    if (
      platformGroup === 'cn_hk' &&
      !['非投连险-中国分红', '非投连险-港股通ETF', '非投连险-A股价值型', '非投连险-中国QDII', '非投连险-货币基金'].includes(plat)
    ) {
      return false;
    }
    if (platformGroup === 'bonds' && plat !== '非投连险-债券基金比较' && r.asset_class !== '固定收益') return false;
    if (assetClass !== 'all' && r.asset_class !== assetClass) return false;
    if (minStars > 0 && (r.morningstar_stars || 0) < minStars) return false;
    if (tier !== 'ALL' && r.data_tier !== tier) return false;
    if (grade !== 'ALL' && r.quant_grade !== grade) return false;
    if (excludeNonRec && Array.isArray(r.tags) && r.tags.includes('非推荐选择')) return false;
    if (onlyDistributing && !r.is_distributing) return false;
    if (query) {
      const hay = `${r.slug} ${r.code} ${r.aia_code || ''} ${r.isin || ''} ${r.yahoo_ticker || ''} ${r.name} ${r.manager || ''}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });

  return [...filtered].sort((a, b) => {
    const va = a[sortKey];
    const vb = b[sortKey];
    if (va == null && vb == null) return String(a.slug).localeCompare(String(b.slug));
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === 'number' && typeof vb === 'number') {
      return (va - vb) * dir;
    }
    return String(va).localeCompare(String(vb)) * dir;
  });
}

/**
 * Compute Target vs Actual allocation drift rows for PortfolioView.
 */
export function buildPortfolioDriftRows(details = [], targetAllocations = {}) {
  const totalMv = details.reduce((acc, d) => acc + Math.max(0, Number(d.market_value || 0)), 0);
  if (totalMv <= 0 || !targetAllocations || Object.keys(targetAllocations).length === 0) return [];

  const actualMap = {};
  const nameMap = {};
  const explicitCashKeys = new Set(
    Object.keys(targetAllocations).filter((k) => String(k).trim().toUpperCase().startsWith('CASH_'))
  );
  for (const d of details) {
    const key = String(d.isin || '').trim();
    if (!key) continue;
    if (key.toUpperCase().startsWith('CASH_') && !explicitCashKeys.has(key)) {
      continue;
    }
    actualMap[key] = (actualMap[key] || 0) + Math.max(0, Number(d.market_value || 0)) / totalMv;
    nameMap[key] = d.name || key;
  }

  const allKeys = Array.from(new Set([...Object.keys(targetAllocations), ...Object.keys(actualMap)]));
  return allKeys
    .map((key) => {
      const rawTarget = Number(targetAllocations[key] || 0);
      const target = rawTarget > 1.001 ? rawTarget / 100 : rawTarget;
      const actual = actualMap[key] || 0;
      const drift = actual - target;
      return {
        isin: key,
        name: nameMap[key] || key,
        targetPct: Math.round(target * 1000) / 10,
        actualPct: Math.round(actual * 1000) / 10,
        driftPct: Math.round(drift * 1000) / 10,
        needsRebalance: Math.abs(drift) >= 0.05,
      };
    })
    .sort((a, b) => Math.abs(b.driftPct) - Math.abs(a.driftPct));
}
