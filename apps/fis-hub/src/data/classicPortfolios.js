/**
 * 业界经典资产配置模板库（教育与演示用途，不构成投资建议）。
 *
 * 结构说明
 * - holdings.us    ：美股上市 ETF 版本（第一期）。
 * - holdings.ucits ：UCITS（爱尔兰/欧洲上市，用 ISIN）版本，预留；为 null 表示尚未提供。
 *   香港投资者持有美国上市 ETF 可能面临美国遗产税等问题，UCITS 版本将在 ISIN 经数据源验证后补充。
 * - weight 为百分数，每个版本合计必须等于 100（见 classicPortfolios.test.js）。
 * - assetClass 用于卡片上的权重条着色：equity | bond | gold | commodity | reit | cash。
 */

const h = (isin, weight, assetClass, zh, en) => ({ isin, weight, assetClass, label: { zh, en } });

export const CLASSIC_PORTFOLIOS = [
  {
    id: 'all-weather',
    name: { zh: '全天候组合', en: 'All Weather' },
    origin: { zh: 'Ray Dalio / 桥水（散户 ETF 版因 Tony Robbins 推广）', en: 'Ray Dalio / Bridgewater (retail ETF version popularised by Tony Robbins)' },
    idea: {
      zh: '围绕「增长、通胀」各自上行或下行的四种环境配置资产，重仓长债以平衡风险贡献，追求任何环境下都不大亏。',
      en: 'Allocates across the four growth/inflation regimes, leaning on long bonds to balance risk contribution, so no single environment hurts too much.',
    },
    risk: 'lowMid',
    holdings: {
      us: [
        h('VTI', 30, 'equity', '美国全市场股票', 'US Total Stock Market'),
        h('TLT', 40, 'bond', '美国长期国债（20年+）', 'US Long-Term Treasuries (20Y+)'),
        h('IEF', 15, 'bond', '美国中期国债（7–10年）', 'US Intermediate Treasuries (7–10Y)'),
        h('GLD', 7.5, 'gold', '黄金', 'Gold'),
        h('DBC', 7.5, 'commodity', '大宗商品', 'Broad Commodities'),
      ],
      ucits: null,
    },
  },
  {
    id: 'permanent',
    name: { zh: '永久组合', en: 'Permanent Portfolio' },
    origin: { zh: 'Harry Browne', en: 'Harry Browne' },
    idea: {
      zh: '股票、长债、现金、黄金各占四分之一，分别对应繁荣、通缩、衰退/紧缩、通胀四种经济环境，几乎无需再平衡以外的操作。',
      en: 'Equal quarters of stocks, long bonds, cash and gold — one for each of prosperity, deflation, recession/tight money and inflation.',
    },
    risk: 'low',
    holdings: {
      us: [
        h('VTI', 25, 'equity', '美国全市场股票', 'US Total Stock Market'),
        h('TLT', 25, 'bond', '美国长期国债（20年+）', 'US Long-Term Treasuries (20Y+)'),
        h('BIL', 25, 'cash', '1–3月美国国库券（现金）', 'US T-Bills 1–3M (cash)'),
        h('GLD', 25, 'gold', '黄金', 'Gold'),
      ],
      ucits: null,
    },
  },
  {
    id: 'golden-butterfly',
    name: { zh: '金蝴蝶组合', en: 'Golden Butterfly' },
    origin: { zh: 'Tyler（永久组合改良版）', en: 'Tyler (a Permanent Portfolio variant)' },
    idea: {
      zh: '在永久组合基础上加入小盘价值股，用五个各占 20% 的资产提高长期增长，同时保留长短债与黄金的防御。',
      en: 'Adds small-cap value to the Permanent Portfolio: five 20% sleeves for more long-term growth while keeping bond and gold defences.',
    },
    risk: 'lowMid',
    holdings: {
      us: [
        h('VTI', 20, 'equity', '美国全市场股票', 'US Total Stock Market'),
        h('VBR', 20, 'equity', '美国小盘价值股', 'US Small-Cap Value'),
        h('TLT', 20, 'bond', '美国长期国债（20年+）', 'US Long-Term Treasuries (20Y+)'),
        h('SHY', 20, 'bond', '美国短期国债（1–3年）', 'US Short-Term Treasuries (1–3Y)'),
        h('GLD', 20, 'gold', '黄金', 'Gold'),
      ],
      ucits: null,
    },
  },
  {
    id: 'barbell-risk',
    name: { zh: '杠铃组合（风险型）', en: 'Barbell (Risk)' },
    origin: { zh: 'Nassim Taleb《反脆弱》', en: 'Nassim Taleb, Antifragile' },
    idea: {
      zh: '约 90% 放在极度安全的国库券，约 10% 押在高风险高弹性资产，刻意回避「中等风险」。最大亏损被锁定在风险端的那部分仓位，上行空间保持开放。',
      en: 'About 90% in ultra-safe T-bills and about 10% in a highly aggressive asset, deliberately avoiding the middle. Downside is capped at the risk sleeve; upside stays open.',
    },
    note: {
      zh: 'Taleb 的原意是安全端 85–90%、风险端 10–15%。风险端用纳指 ETF 仅作示例，可在套用后替换为你主观选择的标的并调整权重。',
      en: 'Taleb suggests 85–90% safe and 10–15% aggressive. The Nasdaq ETF is only an example — swap it for your own high-risk choice after applying.',
    },
    risk: 'lowMid',
    holdings: {
      us: [
        h('BIL', 90, 'cash', '1–3月美国国库券（现金）', 'US T-Bills 1–3M (cash)'),
        h('QQQ', 10, 'equity', '纳斯达克100（风险端示例）', 'Nasdaq-100 (example risk sleeve)'),
      ],
      ucits: null,
    },
  },
  {
    id: 'barbell-duration',
    name: { zh: '杠铃组合（久期型）', en: 'Barbell (Duration)' },
    origin: { zh: '固定收益经典策略', en: 'Classic fixed-income strategy' },
    idea: {
      zh: '债券只持有最短和最长两端期限，跳过中间期限：短债提供流动性与再投资弹性，长债在利率下行时提供更高的资本利得。',
      en: 'Holds only the shortest and longest maturities and skips the middle: short bonds give liquidity and reinvestment flexibility, long bonds give more upside if rates fall.',
    },
    note: {
      zh: '这是纯债券策略，利率上行时长债端波动较大；与「风险型杠铃」不是一回事。',
      en: 'A bond-only strategy; the long end is volatile when rates rise. Not the same as the risk barbell.',
    },
    risk: 'mid',
    holdings: {
      us: [
        h('TLT', 50, 'bond', '美国长期国债（20年+）', 'US Long-Term Treasuries (20Y+)'),
        h('SHY', 50, 'bond', '美国短期国债（1–3年）', 'US Short-Term Treasuries (1–3Y)'),
      ],
      ucits: null,
    },
  },
  {
    id: 'three-fund',
    name: { zh: '三基金组合', en: 'Three-Fund' },
    origin: { zh: 'Bogleheads（John Bogle 理念）', en: 'Bogleheads (John Bogle philosophy)' },
    idea: {
      zh: '美国股票、国际股票、美国债券三只低成本指数基金，简单、透明、费用极低，是长期被动投资的基准做法。',
      en: 'US stocks, international stocks and US bonds in three ultra-low-cost index funds — simple, transparent and the benchmark for passive investing.',
    },
    note: {
      zh: '股债比例可按风险承受能力调整（例如 42/18/40 对应约 60% 股票）。',
      en: 'Adjust the stock/bond split to risk tolerance (42/18/40 is about 60% equities).',
    },
    risk: 'mid',
    holdings: {
      us: [
        h('VTI', 42, 'equity', '美国全市场股票', 'US Total Stock Market'),
        h('VXUS', 18, 'equity', '美国以外全市场股票', 'International Stocks ex-US'),
        h('BND', 40, 'bond', '美国综合债券', 'US Total Bond Market'),
      ],
      ucits: null,
    },
  },
  {
    id: 'sixty-forty',
    name: { zh: '60/40 经典组合', en: '60/40' },
    origin: { zh: '传统平衡型基准', en: 'Traditional balanced benchmark' },
    idea: {
      zh: '六成股票、四成债券，是业界最常用的比较基准：债券在股市下跌时提供缓冲，但在股债同跌（如通胀飙升）时保护有限。',
      en: 'Sixty percent stocks, forty percent bonds — the industry reference portfolio. Bonds cushion equity drawdowns but help less when both fall together, as in an inflation shock.',
    },
    risk: 'mid',
    holdings: {
      us: [
        h('SPY', 60, 'equity', '标普500', 'S&P 500'),
        h('BND', 40, 'bond', '美国综合债券', 'US Total Bond Market'),
      ],
      ucits: null,
    },
  },
  {
    id: 'yale-swensen',
    name: { zh: '耶鲁捐赠基金式', en: 'Yale Endowment Style' },
    origin: { zh: 'David Swensen（《非常规成功》）', en: 'David Swensen (Unconventional Success)' },
    idea: {
      zh: '针对个人投资者的耶鲁模式简化版：加入房地产信托与抗通胀债券，用六类资产的低相关性做分散，减少对美股的单一依赖。',
      en: 'A retail version of the Yale model: adds REITs and inflation-protected bonds so six low-correlation asset classes reduce reliance on US equities.',
    },
    risk: 'mid',
    holdings: {
      us: [
        h('VTI', 30, 'equity', '美国全市场股票', 'US Total Stock Market'),
        h('VEA', 15, 'equity', '发达市场（美国以外）股票', 'Developed Markets ex-US'),
        h('VWO', 5, 'equity', '新兴市场股票', 'Emerging Markets'),
        h('VNQ', 20, 'reit', '美国房地产信托（REITs）', 'US REITs'),
        h('IEF', 15, 'bond', '美国中期国债（7–10年）', 'US Intermediate Treasuries (7–10Y)'),
        h('TIP', 15, 'bond', '通胀保值国债（TIPS）', 'Inflation-Protected Treasuries (TIPS)'),
      ],
      ucits: null,
    },
  },
  {
    id: 'ivy-five',
    name: { zh: '常春藤五资产', en: 'Ivy 5' },
    origin: { zh: 'Mebane Faber（《The Ivy Portfolio》）', en: 'Mebane Faber (The Ivy Portfolio)' },
    idea: {
      zh: '模仿大学捐赠基金：美股、海外股、债券、房地产、大宗商品五类资产等权重各 20%，不预测、只分散。',
      en: 'Mimics university endowments: US stocks, foreign stocks, bonds, real estate and commodities at 20% each — diversify, don’t forecast.',
    },
    risk: 'mid',
    holdings: {
      us: [
        h('VTI', 20, 'equity', '美国全市场股票', 'US Total Stock Market'),
        h('VEU', 20, 'equity', '全球（美国以外）股票', 'All-World ex-US Stocks'),
        h('BND', 20, 'bond', '美国综合债券', 'US Total Bond Market'),
        h('VNQ', 20, 'reit', '美国房地产信托（REITs）', 'US REITs'),
        h('DBC', 20, 'commodity', '大宗商品', 'Broad Commodities'),
      ],
      ucits: null,
    },
  },
  {
    id: 'buffett-90-10',
    name: { zh: '巴菲特 90/10', en: 'Buffett 90/10' },
    origin: { zh: 'Warren Buffett（2013 年致股东信中的遗嘱建议）', en: 'Warren Buffett (trust instructions in his 2013 shareholder letter)' },
    idea: {
      zh: '九成标普500低成本指数基金、一成短期国债：长期几乎全仓股票，靠极低成本和持有纪律取胜，回撤较大，适合能长期持有的资金。',
      en: 'Ninety percent low-cost S&P 500 index fund, ten percent short-term government bonds. Nearly all equity with big drawdowns — only for money that can stay invested for decades.',
    },
    risk: 'midHigh',
    holdings: {
      us: [
        h('VOO', 90, 'equity', '标普500', 'S&P 500'),
        h('SHY', 10, 'bond', '美国短期国债（1–3年）', 'US Short-Term Treasuries (1–3Y)'),
      ],
      ucits: null,
    },
  },
  {
    id: 'core-satellite',
    name: { zh: '核心-卫星组合', en: 'Core-Satellite' },
    origin: { zh: '机构与私人银行常用框架', en: 'Common institutional / private-bank framework' },
    idea: {
      zh: '八成配置全球低成本指数作为「核心」，二成用于主题、行业或主动策略作为「卫星」，在控制总体风险的同时保留个性化观点。',
      en: 'About 80% in a low-cost global index as the core, 20% in thematic, sector or active ideas as satellites — personal views without putting the whole portfolio at risk.',
    },
    note: {
      zh: '卫星部分用纳指 ETF 仅作示例，可替换为任意主题或行业标的。',
      en: 'The Nasdaq ETF is only an example satellite — replace it with any theme or sector.',
    },
    risk: 'midHigh',
    holdings: {
      us: [
        h('VT', 80, 'equity', '全球全市场股票', 'Total World Stock'),
        h('QQQ', 20, 'equity', '纳斯达克100（卫星示例）', 'Nasdaq-100 (example satellite)'),
      ],
      ucits: null,
    },
  },
  {
    id: 'coffeehouse',
    name: { zh: '咖啡馆组合', en: 'Coffeehouse' },
    origin: { zh: 'Bill Schultheis（《The Coffeehouse Investor》）', en: 'Bill Schultheis (The Coffeehouse Investor)' },
    idea: {
      zh: '四成债券，其余六类股票资产（大盘、大盘价值、小盘、小盘价值、房地产、国际）各占一成，强调简单易坚持。',
      en: 'Forty percent bonds, plus six equity sleeves (large, large value, small, small value, REIT, international) at 10% each — built to be simple enough to stick with.',
    },
    risk: 'mid',
    holdings: {
      us: [
        h('BND', 40, 'bond', '美国综合债券', 'US Total Bond Market'),
        h('VOO', 10, 'equity', '美国大盘（标普500）', 'US Large-Cap (S&P 500)'),
        h('IWD', 10, 'equity', '美国大盘价值股', 'US Large-Cap Value'),
        h('IJR', 10, 'equity', '美国小盘股', 'US Small-Cap'),
        h('IJS', 10, 'equity', '美国小盘价值股', 'US Small-Cap Value'),
        h('VNQ', 10, 'reit', '美国房地产信托（REITs）', 'US REITs'),
        h('VXUS', 10, 'equity', '美国以外全市场股票', 'International Stocks ex-US'),
      ],
      ucits: null,
    },
  },
];

/** 某个组合在指定版本（us | ucits）下的持仓；该版本尚未提供时返回 null */
export function getHoldings(portfolio, variant = 'us') {
  return portfolio.holdings[variant] || null;
}

/** 转成实验室使用的 { isins, weights }（weights 为 ticker → 百分数） */
export function toLabTemplate(portfolio, variant = 'us') {
  const list = getHoldings(portfolio, variant);
  if (!list) return null;
  const weights = {};
  list.forEach(({ isin, weight }) => { weights[isin] = weight; });
  return { isins: list.map((x) => x.isin), weights };
}
