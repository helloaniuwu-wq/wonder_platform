import { describe, it, expect } from 'vitest';
import { CLASSIC_PORTFOLIOS, getHoldings, toLabTemplate } from './classicPortfolios';

const VARIANTS = ['us', 'ucits'];
const RISKS = ['low', 'lowMid', 'mid', 'midHigh'];
const CLASSES = ['equity', 'bond', 'gold', 'commodity', 'reit', 'cash'];

describe('经典组合库数据完整性', () => {
  it('id 唯一，且收录了计划中的 12 个组合', () => {
    const ids = CLASSIC_PORTFOLIOS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      expect.arrayContaining([
        'all-weather', 'permanent', 'golden-butterfly', 'barbell-risk', 'barbell-duration',
        'three-fund', 'sixty-forty', 'yale-swensen', 'ivy-five', 'buffett-90-10',
        'core-satellite', 'coffeehouse',
      ])
    );
    expect(ids).toHaveLength(12);
  });

  it.each(CLASSIC_PORTFOLIOS.map((p) => [p.id, p]))('%s：中英文文案、风险档位齐全', (_id, p) => {
    for (const field of ['name', 'origin', 'idea']) {
      expect(p[field].zh?.trim(), `${field}.zh`).toBeTruthy();
      expect(p[field].en?.trim(), `${field}.en`).toBeTruthy();
    }
    if (p.note) {
      expect(p.note.zh?.trim()).toBeTruthy();
      expect(p.note.en?.trim()).toBeTruthy();
    }
    expect(RISKS).toContain(p.risk);
  });

  it.each(
    CLASSIC_PORTFOLIOS.flatMap((p) =>
      VARIANTS.filter((v) => getHoldings(p, v)).map((v) => [`${p.id}/${v}`, p, v])
    )
  )('%s：权重合计恰为 100，标的不重复，权重为正', (_label, p, variant) => {
    const list = getHoldings(p, variant);
    const sum = list.reduce((s, x) => s + x.weight, 0);
    expect(sum).toBeCloseTo(100, 6);
    const isins = list.map((x) => x.isin);
    expect(new Set(isins).size).toBe(isins.length);
    expect(list.length).toBeGreaterThanOrEqual(2); // 实验室至少需要 2 个标的
    for (const x of list) {
      expect(x.weight).toBeGreaterThan(0);
      expect(CLASSES).toContain(x.assetClass);
      expect(x.label.zh && x.label.en).toBeTruthy();
    }
  });

  it('每个组合至少提供美股版', () => {
    for (const p of CLASSIC_PORTFOLIOS) expect(getHoldings(p, 'us'), p.id).toBeTruthy();
  });
});

describe('toLabTemplate', () => {
  it('转为实验室需要的 isins 与权重表', () => {
    const aw = CLASSIC_PORTFOLIOS.find((p) => p.id === 'all-weather');
    expect(toLabTemplate(aw)).toEqual({
      isins: ['VTI', 'TLT', 'IEF', 'GLD', 'DBC'],
      weights: { VTI: 30, TLT: 40, IEF: 15, GLD: 7.5, DBC: 7.5 },
    });
  });

  it('尚未提供的版本（UCITS）返回 null，而不是空模板', () => {
    const aw = CLASSIC_PORTFOLIOS.find((p) => p.id === 'all-weather');
    expect(toLabTemplate(aw, 'ucits')).toBeNull();
  });
});
