import { describe, expect, it } from 'vitest';
import { parseInlineTokens, parseMarkdownBlocks } from './markdownParser';

describe('markdownParser', () => {
  it('parses headings, paragraphs, tables, and nested sub-bullets inside ordered lists', () => {
    const md = [
      '### 一、宏观利率与估值时钟研判',
      '',
      '当前处于**高利率**环境：',
      '',
      '1. **固收资产战略价值凸显**',
      '- 美元短债提供 `4.3%-5.0%` 票息',
      '2. **跨资产性价比矩阵**',
      '| 资产类别 | 收益率 | 波动率 |',
      '|---|---|---|',
      '| 全球高息股 | 8.1% | 12.3% |',
      '| 美元短债 | 5.0% | 1.2% |',
      '',
      '> 核心结论：保持久期可控。',
    ].join('\n');

    const blocks = parseMarkdownBlocks(md);
    expect(blocks.map((b) => b.type)).toEqual([
      'heading',
      'paragraph',
      'list',
      'table',
      'blockquote',
    ]);
    expect(blocks[0]).toEqual({ type: 'heading', level: 3, text: '一、宏观利率与估值时钟研判' });
    expect(blocks[2].ordered).toBe(true);
    expect(blocks[2].items).toHaveLength(2);
    expect(blocks[2].items[0].children).toEqual(['美元短债提供 `4.3%-5.0%` 票息']);
    expect(blocks[3].headers).toEqual(['资产类别', '收益率', '波动率']);
    expect(blocks[3].rows).toEqual([
      ['全球高息股', '8.1%', '12.3%'],
      ['美元短债', '5.0%', '1.2%'],
    ]);
  });

  it('splits flattened single-line tables into proper table blocks', () => {
    const md =
      '3. **跨资产性价比矩阵** |资产类别|收益率| |---|---| |全球高息股|8.1%| |美元短债|5.0%|';
    const blocks = parseMarkdownBlocks(md);
    expect(blocks.map((b) => b.type)).toEqual(['list', 'table']);
    expect(blocks[1].headers).toEqual(['资产类别', '收益率']);
    expect(blocks[1].rows).toEqual([
      ['全球高息股', '8.1%'],
      ['美元短债', '5.0%'],
    ]);
  });

  it('parses inline bold, italic, code, and safe links', () => {
    const tokens = parseInlineTokens('推荐 **Z36** 与 `SPY`，详见 [官网](https://wonderwisdom.online)。');
    expect(tokens).toEqual([
      { type: 'text', value: '推荐 ' },
      { type: 'bold', value: 'Z36' },
      { type: 'text', value: ' 与 ' },
      { type: 'code', value: 'SPY' },
      { type: 'text', value: '，详见 ' },
      { type: 'link', label: '官网', href: 'https://wonderwisdom.online' },
      { type: 'text', value: '。' },
    ]);
  });
});
