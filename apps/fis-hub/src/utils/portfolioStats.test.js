import { describe, it, expect } from 'vitest';
import {
  buildSectorData,
  buildTop10Data,
  getDaysUntil,
  buildHoldingsCsv,
  buildDividendsCsv,
} from './portfolioStats';
import { parseHistoryText } from './reportApi';

const holding = (o) => ({ isin: 'VOO', name: 'Vanguard', sector: 'Tech', market_value: 100, ...o });

describe('buildSectorData', () => {
  it('无数据返回空数组', () => {
    expect(buildSectorData(null)).toEqual([]);
    expect(buildSectorData({})).toEqual([]);
  });

  it('跳过现金，字符串行业按市值汇总并计算占净值百分比', () => {
    const r = buildSectorData({
      total_nav: 400,
      details: [
        holding({ market_value: 100, sector: 'Tech' }),
        holding({ isin: 'QQQ', market_value: 100, sector: 'Tech' }),
        holding({ isin: 'CASH_USD', market_value: 200, sector: 'Cash' }),
      ],
    });
    expect(r).toEqual([{ name: 'Tech', value: 200, pct: 50 }]);
  });

  it('对象/JSON 字符串行业按权重拆分，并把 snake_case 转为标题格式', () => {
    const r = buildSectorData({
      total_nav: 100,
      details: [
        holding({ market_value: 100, sector: { consumer_cyclical: 0.25, technology: 0.75 } }),
        holding({ isin: 'X', market_value: 100, sector: '{"technology":1}' }),
      ],
    });
    const byName = Object.fromEntries(r.map((d) => [d.name, d.value]));
    expect(byName).toEqual({ 'Consumer Cyclical': 25, Technology: 175 });
  });

  it('缺失行业记为 Unknown；零值与非法值被过滤', () => {
    const r = buildSectorData({
      total_nav: 100,
      details: [
        holding({ sector: null, market_value: 50 }),
        holding({ isin: 'Z', sector: 'Zero', market_value: 0 }),
        holding({ isin: 'N', sector: 'Nan', market_value: 'abc' }),
      ],
    });
    expect(r).toEqual([{ name: 'Unknown', value: 50, pct: 50 }]);
  });

  it('total_nav 为 0 时百分比为 0，不出现 NaN/Infinity', () => {
    const r = buildSectorData({ total_nav: 0, details: [holding({ market_value: 10 })] });
    expect(r[0].pct).toBe(0);
  });
});

describe('buildTop10Data', () => {
  it('只取非现金正市值，按市值降序，最多 10 条', () => {
    const details = Array.from({ length: 12 }, (_, i) => holding({ isin: `A${i}`, name: `N${i}`, market_value: i + 1 }));
    details.push(holding({ isin: 'CASH_USD', market_value: 9999 }));
    details.push(holding({ isin: 'NEG', market_value: -5 }));
    const r = buildTop10Data({ total_nav: 1000, details });
    expect(r).toHaveLength(10);
    expect(r[0].isin).toBe('A11');
    expect(r.map((d) => d.isin)).not.toContain('CASH_USD');
    expect(r[0].pct).toBeCloseTo(1.2, 10);
  });

  it('超过 30 字的名称截断为 28 字加省略号，缺名称回退为 ISIN', () => {
    const long = 'x'.repeat(40);
    const r = buildTop10Data({ total_nav: 100, details: [holding({ name: long }), holding({ isin: 'ZZ', name: '', market_value: 1 })] });
    expect(r[0].name).toBe('x'.repeat(28) + '…');
    expect(r[0].fullName).toBe(long);
    expect(r[1].name).toBe('ZZ');
  });
});

describe('getDaysUntil', () => {
  const now = new Date('2025-01-01T00:00:00Z');
  it('向上取整；无日期返回 null；过去为负', () => {
    expect(getDaysUntil('2025-01-04T00:00:00Z', now)).toBe(3);
    expect(getDaysUntil('2025-01-01T06:00:00Z', now)).toBe(1);
    expect(getDaysUntil('2024-12-30T00:00:00Z', now)).toBe(-2);
    expect(getDaysUntil(null, now)).toBeNull();
  });
});

describe('CSV 导出', () => {
  it('持仓 CSV：现金持股显示 1，其余取整数股，均价=总成本/股数', () => {
    const csv = buildHoldingsCsv({
      total_nav: 1000,
      details: [
        { name: 'Vanguard', isin: 'VOO', market_value: 600, shares: 10.7, total_cost: 500, price: 56, dividends: 12.345, yield: 20 },
        { name: 'Wallet', isin: 'CASH_USD', market_value: 400, shares: 400, total_cost: 400, price: 1, dividends: 0, yield: 0 },
      ],
    });
    const lines = csv.split('\n');
    expect(lines[0]).toBe('ASSET,ISIN,ALLOCATION (%),SHARES,AVG COST,PRICE,VALUE,DIVIDENDS,PNL (%)');
    expect(lines[1]).toBe('Vanguard,VOO,60.0%,10,46.73,56.00,600.00,12.35,20.00%');
    expect(lines[2]).toBe('Wallet,CASH_USD,40.0%,1,400.00,1.00,400.00,0.00,0.00%');
  });

  it('分红 CSV：基金名加引号以容纳逗号，每股分红 4 位小数', () => {
    const csv = buildDividendsCsv([
      { date: '2024-06-01', isin: 'VOO', name: 'Fund, Inc.', type: 'Auto', shares_held: 100, amount_per_share: 1.5, total_amount: 150 },
    ]);
    expect(csv.split('\n')[1]).toBe('2024-06-01,VOO,"Fund, Inc.",Auto,100,1.5000,150.00');
  });
});

describe('parseHistoryText', () => {
  it('把 NaN 当 null 处理，过滤无日期或净值无效的点', () => {
    const text = '[{"date":"2024-01-01","value":1.0},{"date":"2024-01-02","value": NaN},{"value":2},{"date":"2024-01-04","value":3}]';
    expect(parseHistoryText(text)).toEqual([
      { date: '2024-01-01', value: 1 },
      { date: '2024-01-04', value: 3 },
    ]);
  });

  it('非数组或非法 JSON 返回 null', () => {
    expect(parseHistoryText('{"detail":"err"}')).toBeNull();
    expect(parseHistoryText('<html>')).toBeNull();
  });
});
