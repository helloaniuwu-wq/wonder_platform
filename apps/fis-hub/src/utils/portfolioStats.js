/**
 * 组合报告的纯数据加工函数（从 App.jsx 抽出，便于测试）。
 * data 为 /api/report/:id 的返回值：{ details: [...], total_nav }。
 */

const isCash = (isin) => String(isin || '').startsWith('CASH_');

/** 按行业汇总市值（跳过现金）。sector 可能是字符串、JSON 字符串或 {行业: 权重} 对象 */
export function buildSectorData(data) {
  try {
    if (!data || !data.details) return [];
    const map = {};
    data.details.forEach((d) => {
      if (isCash(d.isin)) return;
      let sectorObj = d.sector;
      if (typeof sectorObj === 'string' && sectorObj.startsWith('{')) {
        try { sectorObj = JSON.parse(sectorObj); } catch { /* 保持原字符串 */ }
      }

      if (typeof sectorObj === 'object' && !Array.isArray(sectorObj) && sectorObj !== null) {
        Object.entries(sectorObj).forEach(([k, weight]) => {
          // "consumer_cyclical" -> "Consumer Cyclical"
          const name = String(k).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
          map[name] = (map[name] || 0) + (Number(d.market_value) || 0) * (Number(weight) || 0);
        });
      } else {
        const s = String(sectorObj || 'Unknown');
        map[s] = (map[s] || 0) + (Number(d.market_value) || 0);
      }
    });
    return Object.entries(map)
      .map(([name, value]) => ({ name, value, pct: data.total_nav > 0 ? (value / data.total_nav) * 100 : 0 }))
      .filter((d) => d.value > 0 && !isNaN(d.value) && isFinite(d.value));
  } catch (e) {
    console.error('Safeguard: Sector processing failed', e);
    return [];
  }
}

/** 市值前十的非现金持仓 */
export function buildTop10Data(data) {
  try {
    if (!data || !data.details) return [];
    return data.details
      .filter((d) => !isCash(d.isin) && Number(d.market_value) > 0)
      .sort((a, b) => Number(b.market_value) - Number(a.market_value))
      .slice(0, 10)
      .map((d) => ({
        name: d.name && d.name.length > 30 ? d.name.substring(0, 28) + '…' : d.name || d.isin,
        fullName: d.name || d.isin,
        isin: d.isin,
        value: Number(d.market_value),
        pct: data.total_nav > 0 ? (Number(d.market_value) / data.total_nav) * 100 : 0,
      }));
  } catch (e) {
    console.error('Safeguard: Top10 processing failed', e);
    return [];
  }
}

/** 距离某日期还有几天（向上取整）；无日期返回 null */
export function getDaysUntil(dateStr, now = new Date()) {
  if (!dateStr) return null;
  const diffTime = new Date(dateStr) - now;
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

/** 持仓明细 → CSV 文本 */
export function buildHoldingsCsv(data) {
  const headers = ['ASSET', 'ISIN', 'ALLOCATION (%)', 'SHARES', 'AVG COST', 'PRICE', 'VALUE', 'DIVIDENDS', 'PNL (%)'];
  const rows = data.details.map((a) => [
    a.name,
    a.isin,
    ((a.market_value / data.total_nav) * 100).toFixed(1) + '%',
    isCash(a.isin) ? '1' : Math.floor(a.shares),
    a.total_cost ? (a.total_cost / (isCash(a.isin) ? 1 : a.shares)).toFixed(2) : '0',
    a.price.toFixed(2),
    a.market_value.toFixed(2),
    a.dividends.toFixed(2),
    a.yield.toFixed(2) + '%',
  ]);
  return [headers, ...rows].map((e) => e.join(',')).join('\n');
}

/** 分红记录 → CSV 文本（基金名加引号以容纳逗号） */
export function buildDividendsCsv(divs) {
  const headers = ['DATE', 'ASSET / ISIN', 'FUND NAME', 'TYPE', 'SHARES HELD', 'AMOUNT PER SHARE', 'TOTAL DIVIDEND ($)'];
  const rows = divs.map((d) => [
    d.date,
    d.isin,
    `"${d.name}"`,
    d.type,
    d.shares_held,
    d.amount_per_share.toFixed(4),
    d.total_amount.toFixed(2),
  ]);
  return [headers, ...rows].map((e) => e.join(',')).join('\n');
}

/** 触发浏览器下载 CSV */
export function downloadCsv(csvContent, filename) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
