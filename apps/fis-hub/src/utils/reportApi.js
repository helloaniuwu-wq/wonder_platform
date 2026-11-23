/**
 * 历史净值接口偶尔返回非法 JSON（含 NaN）。把 NaN 替换为 null 后解析，
 * 并过滤掉没有日期或净值无效的点。解析失败时返回 null。
 */
export function parseHistoryText(text) {
  let parsed;
  try {
    parsed = JSON.parse(String(text).replace(/:\s*NaN/g, ': null'));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  return parsed.filter((d) => d && d.date && d.value !== null && !isNaN(d.value));
}

/**
 * 重新拉取组合报告与历史净值曲线（调仓/撤销后复用）。
 * 报告接口返回 { detail } 视为失败，不覆盖现有数据；历史曲线失败静默忽略。
 */
export async function reloadReportAndHistory(portfolioId, { setData, setHistoryData }) {
  const repRes = await fetch(`/api/report/${portfolioId}`);
  const repData = await repRes.json();
  if (!repData.detail) setData(repData);

  fetch(`/api/report/history/${portfolioId}`)
    .then((r) => r.text())
    .then((text) => {
      const history = parseHistoryText(text);
      if (history) setHistoryData(history);
    })
    .catch(() => {});
}
