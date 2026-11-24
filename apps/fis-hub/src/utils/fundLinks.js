const MANAGER_URL_MAP = [
  { match: /blackrock|ishares|贝莱德|貝萊德/i, label: 'BlackRock 贝莱德官网', url: 'https://www.blackrock.com/hk/zh/products/product-list' },
  { match: /fidelity|富达|富達/i, label: 'Fidelity 富达国际官网', url: 'https://www.fidelity.com.hk/zh/funds/fund-explorer' },
  { match: /jpmorgan|jp morgan|摩根/i, label: 'J.P. Morgan 摩根资产官网', url: 'https://am.jpmorgan.com/hk/zh/asset-management/per/products/fund-explorer/' },
  { match: /allianz|安联|安聯/i, label: 'AllianzGI 安联投资官网', url: 'https://hk.allianzgi.com/zh-hk/retail/products/funds' },
  { match: /pimco|品浩/i, label: 'PIMCO 品浩官网', url: 'https://www.pimco.com.hk/zh-hk/investments/gis' },
  { match: /franklin|templeton|富兰克林|富蘭克林/i, label: 'Franklin Templeton 官网', url: 'https://www.franklintempleton.com.hk/zh-hk/investments/our-funds' },
  { match: /schroder|施罗德|施羅德/i, label: 'Schroders 施罗德官网', url: 'https://www.schroders.com/zh-hk/hk/individual/fund-centre/' },
  { match: /abrdn|aberdeen|安本/i, label: 'abrdn 安本官网', url: 'https://www.abrdn.com/zh-hk/investor/funds' },
  { match: /goldman|高盛/i, label: 'Goldman Sachs AM 官网', url: 'https://www.gsam.com/content/gsam/hkg/zh/individual/products/fund-finder.html' },
  { match: /morgan stanley|摩根士丹利/i, label: 'Morgan Stanley IM 官网', url: 'https://www.morganstanley.com/im/en-hk/individual-investor/product-and-performance/funds.html' },
  { match: /invesco|景顺|景順/i, label: 'Invesco 景顺官网', url: 'https://www.invesco.com/hk/zh/individual-investor/products.html' },
  { match: /hsbc|汇丰|匯豐/i, label: 'HSBC AM 汇丰投资官网', url: 'https://www.assetmanagement.hsbc.com.hk/zh-hk/individual-investor/fund-centre' },
  { match: /ubs|瑞银|瑞銀/i, label: 'UBS AM 瑞银资产官网', url: 'https://www.ubs.com/hk/zh/assetmanagement/funds.html' },
  { match: /pictet|百达|百達/i, label: 'Pictet 百达资产官网', url: 'https://am.pictet/zh/hongkong/individual/funds' },
  { match: /amundi|东方汇理|東方匯理/i, label: 'Amundi 东方汇理官网', url: 'https://www.amundi.com.hk/zh_HK/retail/products' },
  { match: /vanguard|领航|領航/i, label: 'Vanguard 领航官网', url: 'https://investor.vanguard.com/investment-products/list/all' },
];

/**
 * 为基金详情抽屉生成外部官方/权威检索链接（AIA 官网、Morningstar 晨星、Yahoo Finance、管理人官网）。
 */
export function buildFundExternalLinks(fund, lang = 'zh') {
  if (!fund) return [];
  const links = [];

  if (fund.aia_code || (fund.ilas_platform && /aia/i.test(fund.ilas_platform))) {
    links.push({
      key: 'aia',
      label: lang === 'en' ? 'AIA ILAS Prices & Factsheets' : 'AIA 官方投连险基金资料',
      url: 'https://www.aia.com.hk/zh-hk/help-and-support/individuals/investment-information/investment-options-prices.html',
    });
  }

  if (fund.morningstar_url) {
    links.push({
      key: 'morningstar',
      label: lang === 'en' ? 'Morningstar Quote' : 'Morningstar 晨星直达',
      url: fund.morningstar_url,
    });
  } else {
    const msQuery = fund.isin || fund.name || fund.code;
    if (msQuery) {
      links.push({
        key: 'morningstar',
        label: lang === 'en' ? 'Morningstar Quote / Search' : 'Morningstar 晨星检索',
        url: `https://www.morningstar.com/search?query=${encodeURIComponent(msQuery)}`,
      });
    }
  }

  const yfTicker = fund.yahoo_ticker || fund.isin;
  if (yfTicker) {
    links.push({
      key: 'yahoo',
      label: 'Yahoo Finance',
      url: `https://finance.yahoo.com/quote/${encodeURIComponent(yfTicker)}`,
    });
  }

  if (fund.manager) {
    const matched = MANAGER_URL_MAP.find((m) => m.match.test(fund.manager));
    if (matched) {
      links.push({
        key: 'manager',
        label: matched.label,
        url: matched.url,
      });
    }
  }

  return links;
}
