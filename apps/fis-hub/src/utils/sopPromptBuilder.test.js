import { describe, it, expect } from 'vitest';
import {
  extractWatchFocusList,
  buildSingleFundSopPrompt,
  buildBatchFundSopPrompt,
} from './sopPromptBuilder';

describe('sopPromptBuilder', () => {
  it('aggregates user requester notes and admin note without duplicates', () => {
    const item = {
      slug: 'PC4_F',
      code: 'PC4',
      fund_name: '信安环球投资基金－优先证券基金 美元A类累积',
      asset_class: '固定收益',
      ilas_platform: 'AIA 卓达智悦2',
      priority: 'P0_urgent',
      request_count: 2,
      requesters: [
        { name: 'Derek', note: '核查与孪生份额ZP4的资本返还(ROC)差异及CoCo减记风险' },
        { name: 'Advisor A', note: '重点看2023瑞信事件期间回撤和恢复天数' },
      ],
      admin_note: '优先完成并推送线上生产库',
    };

    const focus = extractWatchFocusList(item);
    expect(focus).toHaveLength(3);
    expect(focus[0]).toContain('Derek');
    expect(focus[0]).toContain('ROC');
    expect(focus[1]).toContain('2023瑞信事件');
    expect(focus[2]).toContain('优先完成并推送线上生产库');

    const prompt = buildSingleFundSopPrompt(item);
    expect(prompt).toContain('fund-analysis-sop');
    expect(prompt).toContain('PC4_F');
    expect(prompt).toContain('核查与孪生份额ZP4的资本返还(ROC)差异及CoCo减记风险');
    expect(prompt).toContain('重点看2023瑞信事件期间回撤和恢复天数');
    expect(prompt).toContain('优先完成并推送线上生产库');
    expect(prompt).toContain('publish-sop PC4_F');
  });

  it('supports adminNoteOverride and catalog research_notes fallback', () => {
    const catalogRow = {
      slug: 'Z29_F',
      code: 'Z29',
      name: '资本集团全球公司债基金',
      asset_class: '固定收益',
      ilas_platform: 'AIA 卓达智悦2',
      research_priority: 'P1_high',
      research_request_count: 1,
      research_notes: ['张顾问：核实卢森堡B类份额真实TER与10Y美债利差'],
    };

    const prompt = buildSingleFundSopPrompt(catalogRow, {
      adminNoteOverride: '对比同平台Z12与Z69',
    });
    expect(prompt).toContain('Z29_F');
    expect(prompt).toContain('核实卢森堡B类份额真实TER与10Y美债利差');
    expect(prompt).toContain('对比同平台Z12与Z69');
  });

  it('builds batch prompt for multiple queued funds', () => {
    const batch = buildBatchFundSopPrompt([
      { slug: 'PC4_F', code: 'PC4', fund_name: '信安优先证券', admin_note: '查CoCo比例' },
      { slug: 'Z29_F', code: 'Z29', fund_name: '资本集团公司债', admin_note: '查TER费率' },
    ]);
    expect(batch).toContain('2 只 FIS 观察分析队列基金');
    expect(batch).toContain('查CoCo比例');
    expect(batch).toContain('查TER费率');
  });
});
