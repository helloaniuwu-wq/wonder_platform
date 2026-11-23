// ── Currency & Formatting Utilities ───────────────────────────────────────────
// Shared across PortfolioView, StrategyLabView, and chart components.

// Nordic Gallery & Private Wealth Curated Palette (Pine, Bronze, Prussian Blue, Terracotta, Sage, Umber, Slate, Ochre)
export const COLORS = ['#1E4D3B', '#9A6F38', '#28547A', '#8C3B32', '#4A6B5D', '#7C5836', '#3A6B88', '#6B5B4E'];

export const CURRENCY_SYMBOLS = {
  USD: '$', HKD: 'HK$', JPY: '¥', CNY: '¥', EUR: '€',
  GBP: '£', SGD: 'S$', AUD: 'A$', CAD: 'C$', CHF: 'CHF ',
  KRW: '₩', TWD: 'NT$'
};

export const getCurrencySymbol = (ccy) => CURRENCY_SYMBOLS[ccy] || (ccy + ' ');

/**
 * Format a USD value into the portfolio's base currency for display.
 * @param {number} usdVal - Value in USD (from backend)
 * @param {number} fx     - usd_to_base_fx exchange rate (e.g. 150 for JPY)
 * @param {string} ccy    - base_currency string (e.g. 'HKD')
 */
export const fmtMoney = (usdVal, fx = 1, ccy = 'USD') => {
  const localVal = usdVal * fx;
  const sym = getCurrencySymbol(ccy);
  // For high-value currencies (JPY, KRW) show 0 decimals; else 2 decimals
  const decimals = ['JPY', 'KRW'].includes(ccy) ? 0 : 2;
  return `${sym}${localVal.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
};

/**
 * Short K/M suffix formatter for chart axes.
 */
export const fmtAxis = (usdVal, fx = 1, ccy = 'USD') => {
  const v = usdVal * fx;
  const sym = getCurrencySymbol(ccy);
  if (Math.abs(v) >= 1_000_000) return `${sym}${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000)    return `${sym}${(v / 1_000).toFixed(0)}k`;
  return `${sym}${v.toFixed(0)}`;
};

/**
 * Compact formatter for stat cards to avoid overflow (e.g. $1.2M).
 */
export const fmtCompact = (usdVal, fx = 1, ccy = 'USD') => {
  const v = usdVal * fx;
  const sym = getCurrencySymbol(ccy);
  const absV = Math.abs(v);
  if (absV >= 1_000_000_000) return `${sym}${(v / 1_000_000_000).toFixed(2)}B`;
  if (absV >= 1_000_000)     return `${sym}${(v / 1_000_000).toFixed(2)}M`;
  if (absV >= 10_000)        return `${sym}${(v / 1_000).toFixed(1)}k`;
  return fmtMoney(usdVal, fx, ccy);
};
