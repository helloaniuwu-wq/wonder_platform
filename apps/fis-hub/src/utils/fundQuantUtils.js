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

const IE_UCITS_CODES = new Set([
  'IWDA', 'IWVG', 'IWVL', 'JREG', 'MXWO', 'VHYA', 'VHYD', 'VHYL',
  'IB01', 'IB0D', 'IBTU', 'IBTA', 'IBTS', 'IDBT', 'CBU7', 'CBU0', 'IDTM',
  'DTLA', 'IDTL', 'VDTA', 'VDTY', 'LQDA', 'LQDE', 'AGGU', 'IHYU',
  'UYLX', 'I37MXN', 'ID27', 'IDTXX', 'IMMXX', 'VMSTX',
  'CSPX', 'VUAA', 'SPYL', 'CNDX', 'EQAC', 'VWRA', 'VWRD', 'VUSD',
  'IUSA', 'IDUS', 'EQQQ', 'EQQU', 'IUIT',
]);

const LU_UCITS_CODES = new Set(['CSH2', 'PRIP', 'PURC', 'UHYC', 'YIEL']);

const PINNED_TAG_ORDER = [
  '免美遗产税',
  'UCITS/欧基',
  '高股息/红利',
  '低费率(≤0.3%)',
  '标普500/美股宽基',
  '科技/纳指成长',
  '短债/现金管理',
  '中长久期美债',
  '投资级企业债',
  '高收益债/优先证券',
  '含孪生份额(Acc↔Dist)',
  '资本返还派息',
  'ESG可持续',
];

const MANAGER_NORMALIZE_RULES = [
  [/摩根[資资]管|jpmorgan|\bjpm\b/i, '摩根资管 (JPM)'],
  [/貝萊德|贝莱德|blackrock|ishares/i, '贝莱德 / iShares'],
  [/vanguard|領航|领航/i, 'Vanguard (领航)'],
  [/富蘭克林|富兰克林|franklin|templeton/i, '富兰克林坦伯顿 (FT)'],
  [/富達|富达|fidelity/i, '富达国际 (Fidelity)'],
  [/施羅德|施罗德|schroder/i, '施罗德 (Schroders)'],
  [/安聯|安联|allianz/i, '安联投资 (Allianz)'],
  [/柏瑞|pinebridge/i, '柏瑞投资 (PineBridge)'],
  [/景順|景顺|invesco/i, '景顺 (Invesco)'],
  [/滙豐|汇丰|\bhsbc\b/i, '汇丰 (HSBC)'],
  [/惠理|value partners/i, '惠理 (Value Partners)'],
  [/霸菱|barings/i, '霸菱 (Barings)'],
  [/晉達|晋达|ninety one/i, '晋达 (Ninety One)'],
  [/東方匯理|东方汇理|amundi/i, '东方汇理 (Amundi)'],
  [/駿利亨德森|骏利亨德森|janus henderson/i, '骏利亨德森 (JH)'],
  [/安本|abrdn|aberdeen/i, '安本 (abrdn)'],
  [/瑞銀|瑞银|\bubs\b/i, '瑞银 (UBS)'],
  [/首域|首源|first sentier/i, '首域盈信 / 首源'],
  [/路博邁|路博迈|neuberger/i, '路博迈 (NB)'],
  [/聯博|联博|alliancebernstein|\bab\b/i, '联博 (AB)'],
  [/資本集團|资本集团|capital group|capital international/i, '资本集团 (CG)'],
  [/摩根士丹利|morgan stanley/i, '摩根士丹利 (MS)'],
  [/信安|principal/i, '信安 (Principal)'],
  [/友邦|\baia\b/i, '友邦 (AIA)'],
  [/spdr|state street/i, 'SPDR (道富)'],
  [/野村|nomura/i, '野村资管 (Nomura)'],
  [/日興|日兴|nikko/i, '日兴资管 (Nikko)'],
  [/大和|daiwa/i, '大和资管 (Daiwa)'],
  [/三菱|mufg|maxis/i, '三菱UFJ (MUFG)'],
  [/schwab|嘉信/i, '嘉信 (Schwab)'],
];

export function normalizeManagerName(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  for (const [rx, canonical] of MANAGER_NORMALIZE_RULES) {
    if (rx.test(s)) return canonical;
  }
  return s;
}

export function collectAvailableManagers(items = []) {
  const counts = new Map();
  for (const r of items) {
    const m = normalizeManagerName(r?.manager);
    if (!m) continue;
    counts.set(m, (counts.get(m) || 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([manager, count]) => ({ manager, count }));
}

export function inferFundRegion(r) {
  const name = String(r?.name || '');
  const plat = String(r?.ilas_platform || '');
  const tagsText = Array.isArray(r?.tags) ? r.tags.join(' ') : '';
  const hay = `${plat} ${name} ${tagsText}`;
  const hayUpper = hay.toUpperCase();
  const code = String(r?.code || '').trim().toUpperCase();
  const yt = String(r?.yahoo_ticker || '').trim().toUpperCase();

  if (
    /全球|環球|环球|发达市场|MSCI WORLD|ALL-WORLD|FTSE ALL-WORLD|GLOBAL/i.test(hay) &&
    !/美国|美股|S&P 500|NASDAQ|中国|中國|亚洲|亞太|日本|欧洲|歐洲|新兴|新興/.test(
      `${name} ${plat}`.replace(/Global Investors|Global Funds|Global Corporate|Global Equity/gi, '')
    )
  ) {
    return 'global';
  }
  if (/日本|JAPAN|TOPIX|NIKKEI/i.test(hay) || yt.endsWith('.T')) return 'japan';
  if (/A股|沪深|中证|港股|中国|中國|大中华|大中華|香港|CHINA|HONG KONG|GREATER CHINA/i.test(hay) || Boolean(r?.cn_code) || yt.endsWith('.HK')) {
    return 'cn_hk';
  }
  if (/欧洲|歐洲|欧元|歐元|EUROPE|EURO\b/i.test(hay)) return 'europe';
  if (/亚太|亞太|亚洲|亞洲|新兴市场|新興市場|东盟|印度|拉丁美洲|巴西|ASIA|EMERGING|ASEAN|INDIA|LATIN|BRAZIL/i.test(hay)) {
    return 'apac_em';
  }
  if (
    /美国|美國|美股|S&P 500|标普|NASDAQ|纳斯达克|TREASURY|US\s|USD\s|\bUSA\b/i.test(hay) ||
    ['CSPX', 'VUAA', 'SPYL', 'CNDX', 'EQAC', 'IUIT', 'VUSD', 'IUSA', 'EQQQ', 'IB01', 'IB0D', 'IBTA', 'IBTS', 'CBU7', 'CBU0', 'IDTM', 'DTLA', 'IDTL', 'VDTA', 'VDTY', 'LQDA', 'LQDE', 'IHYU', 'SPY', 'QQQ', 'SCHD', 'VOO', 'AGG', 'BIL', 'SGOV', 'TLT', 'HYG'].includes(code)
  ) {
    return 'us';
  }
  if (/全球|環球|环球|GLOBAL|WORLD|国际/i.test(hayUpper)) return 'global';
  return 'other';
}

export function resolveFundTwins(fund, allFunds = []) {
  if (!fund) return [];
  if (Array.isArray(fund.twin_funds) && fund.twin_funds.length > 0) {
    return fund.twin_funds;
  }
  const byKey = new Map();
  for (const item of allFunds) {
    if (!item?.slug) continue;
    for (const k of [item.slug, item.aia_code, item.code]) {
      if (k) {
        const up = String(k).trim().toUpperCase();
        if (!byKey.has(up)) byKey.set(up, item);
      }
    }
    byKey.set(String(item.slug).trim().toUpperCase(), item);
  }
  const found = new Map();
  if (fund.twin_code) {
    const direct = byKey.get(String(fund.twin_code).trim().toUpperCase());
    if (direct && direct.slug !== fund.slug) found.set(direct.slug, direct);
  }
  const selfKeys = new Set(
    [fund.slug, fund.aia_code, fund.code].filter(Boolean).map((k) => String(k).trim().toUpperCase())
  );
  for (const item of allFunds) {
    if (!item?.twin_code || item.slug === fund.slug) continue;
    if (selfKeys.has(String(item.twin_code).trim().toUpperCase())) {
      found.set(item.slug, item);
    }
  }
  return Array.from(found.values()).sort((a, b) => {
    const sameCcyA = a.currency === fund.currency ? 0 : 1;
    const sameCcyB = b.currency === fund.currency ? 0 : 1;
    if (sameCcyA !== sameCcyB) return sameCcyA - sameCcyB;
    const oppA = Boolean(a.is_distributing) !== Boolean(fund.is_distributing) ? 0 : 1;
    const oppB = Boolean(b.is_distributing) !== Boolean(fund.is_distributing) ? 0 : 1;
    if (oppA !== oppB) return oppA - oppB;
    return String(a.code || '').localeCompare(String(b.code || ''));
  });
}

export function isIlasPlatform(r) {
  const plat = String(r?.ilas_platform || '').trim();
  if (!plat) return Boolean(r?.aia_code && String(r.aia_code).trim());
  if (plat.startsWith('非投连险')) return false;
  return plat.startsWith('AIA') || plat.includes('投连险') || /ILAS|ILP/i.test(plat);
}

export function getFundDomicile(r) {
  const isin = String(r?.isin || '').trim().toUpperCase();
  if (isin.startsWith('IE')) return 'IE';
  if (isin.startsWith('LU')) return 'LU';
  if (/^(FR|DE|GB|NL|CH|AT|IT|ES)/.test(isin)) return 'EU_UCITS';
  if (isin.startsWith('HK')) return 'HK';
  if (isin.startsWith('CN')) return 'CN';
  if (isin.startsWith('JP')) return 'JP';
  if (isin.startsWith('US')) return 'US';
  if (isin.length >= 2) return 'OTHER';

  const yt = String(r?.yahoo_ticker || '').trim().toUpperCase();
  const code = String(r?.code || '').trim().toUpperCase();
  const name = String(r?.name || '');
  const plat = String(r?.ilas_platform || '');

  if ((yt === 'USHY' || code === 'USHY') && !/\.(L|DE|PA|AS|MI|SW|F|MU|LU)$/.test(yt)) {
    return 'US';
  }
  if (
    IE_UCITS_CODES.has(code) ||
    /\(ireland\)|\bicav\b/i.test(name) ||
    (/\bucits\b/i.test(name) && /\b(ishares|vanguard|invesco|spdr|jpmorgan)\b/i.test(name))
  ) {
    return 'IE';
  }
  if (
    LU_UCITS_CODES.has(code) ||
    /luxembourg|\bsicav\b/i.test(name) ||
    (/\bucits\b/i.test(name) && /\b(amundi|lyxor|xtrackers|dws)\b/i.test(name))
  ) {
    return 'LU';
  }
  if (/\.(L|DE|PA|AS|MI|SW|F|MU|LU)$/.test(yt) || /\bucits\b/i.test(name)) {
    return 'EU_UCITS';
  }
  if (r?.cn_code || /A股|中国分红|中国QDII|港股通/.test(plat)) return 'CN';
  if (yt.endsWith('.HK') || code.endsWith('.HK')) return 'HK';
  if (yt.endsWith('.T')) return 'JP';
  if (!isIlasPlatform(r)) return 'US';
  return 'OTHER';
}

export function isIrelandOrLuxembourgFund(r) {
  const dom = getFundDomicile(r);
  return dom === 'IE' || dom === 'LU' || dom === 'EU_UCITS';
}

export function isEuropeanCategoryFund(r) {
  if (!isIlasPlatform(r) && isIrelandOrLuxembourgFund(r)) return true;
  if (Array.isArray(r?.tags) && r.tags.some((t) => /欧洲|UCITS|爱尔兰|卢森堡/i.test(t))) return true;
  return /欧洲|europe/i.test(r?.name || '');
}

export function domicileMeta(domicile, lang = 'zh') {
  const map = {
    IE: {
      code: 'IE',
      zh: '爱尔兰 IE',
      en: 'Ireland IE',
      color: 'var(--success)',
      bg: 'rgba(16, 185, 129, 0.12)',
      estateTaxExempt: true,
    },
    LU: {
      code: 'LU',
      zh: '卢森堡 LU',
      en: 'Luxembourg LU',
      color: 'var(--success)',
      bg: 'rgba(16, 185, 129, 0.12)',
      estateTaxExempt: true,
    },
    EU_UCITS: {
      code: 'UCITS',
      zh: '欧洲 UCITS',
      en: 'EU UCITS',
      color: 'var(--success)',
      bg: 'rgba(16, 185, 129, 0.12)',
      estateTaxExempt: true,
    },
    HK: { code: 'HK', zh: '香港 HK', en: 'HK', color: 'var(--info)', bg: 'rgba(59, 130, 246, 0.12)', estateTaxExempt: true },
    CN: { code: 'CN', zh: '中国内地', en: 'CN', color: 'var(--text-secondary)', bg: 'var(--surface-subtle)', estateTaxExempt: true },
    JP: { code: 'JP', zh: '日本 JP', en: 'JP', color: 'var(--text-secondary)', bg: 'var(--surface-subtle)', estateTaxExempt: true },
    US: { code: 'US', zh: '美国 US', en: 'US', color: 'var(--warning)', bg: 'rgba(245, 158, 11, 0.12)', estateTaxExempt: false },
    OTHER: { code: '—', zh: '其他', en: 'Other', color: 'var(--text-muted)', bg: 'var(--surface-subtle)', estateTaxExempt: true },
  };
  const item = map[domicile] || map.OTHER;
  return { ...item, label: lang === 'en' ? item.en : item.zh };
}

const CORE_FUND_CODES = new Set([
  'SPY', 'VOO', 'IVV', 'VTI', 'VT', 'ACWI',
  'CSPX', 'VUAA', 'SPYL', 'VUSD', 'IUSA', 'IDUS',
  'IWDA', 'VWRA', 'VWRD', 'MXWO', 'JREG', 'IXUS',
  'A22', 'M01', 'CG1',
  'VHYA', 'VHYD', 'VHYL', 'VYMI', 'VIGI',
  'SCHD', 'VYM', 'VIG', 'HDV', 'SPYD', 'DGRO', 'NOBL', 'DVY', 'SDY',
  'I17', 'Z17', 'Z37', 'J16', 'R51', 'Z51',
  'AGG', 'BND', 'BNDX', 'SCHZ', 'SPAB', 'IUSB', 'FBND', 'AGGU',
  'VDTA', 'VDTY', 'CBU7', 'CBU0', 'IDTM', 'IEF',
  'LQDA', 'LQDE', 'PURC', 'PRIP', 'VCIT', 'IGSB', 'SCHJ', 'VSCSX',
  'BIL', 'SGOV', 'IB01', 'IB0D', 'IBTU', 'IBTA', 'IBTS', 'IDBT', 'CSH2',
  'SCHO', 'SPTS', 'BSV', 'VBIRX', 'VSBSX', 'VSGBX', 'VUSB', 'JPST', 'MINT', 'EMNT',
  'BUBIX', 'BSBSX', 'FSHBX', 'FJRLX', 'FLTB', 'PAIAX', 'PSHAX', 'TSDUX', 'BOXX',
  'VTIP', 'SCHP', '9096.HK',
  'B01', 'M11', 'M13', 'N08', 'CG9', 'Z29', 'Z39', 'W06', 'Z36', 'Z66', 'E05', 'W04', 'A05',
  'AOA', 'AOR', 'AOK', 'IRTR', 'ITDB', 'ITDC', 'ITDD', 'ITDE', 'ITDF', 'ITDG', 'ITDH', 'ITDI', 'ITDJ',
  'R03', 'Z33',
]);

const HARD_SATELLITE_CODES = new Set([
  'F16', 'Z12', 'Z32',
  'G16', 'Z16', 'Z26', 'I28', 'M10', 'Z13', 'P08', 'Z08', 'R52', 'Z52', 'U06', 'ZU6', 'X15', 'Z15', 'Z25',
  'C03', 'C09', 'Z69', 'J07', 'NB1', 'Z05', 'I27', 'L51', 'ZL1', 'Q02', 'Y02', 'Y22', 'Z11', 'Z22',
  'N01', 'PC4', 'ZP4',
  'P07', 'Z07', 'Z27', 'D18', 'Z18', 'Z28', 'J20', 'Z20', 'Z30', 'W07', 'Z77', 'A32', 'Z06', 'V07',
  'A15', 'GG', 'I23', 'N06', 'N07', 'L52',
  'V02', 'Z01', 'Z21', 'F15', 'Z04', 'Z24', 'Q01',
  'HYG', 'HYGH', 'JNK', 'SJNK', 'SCYB', 'USHY', 'UHYC', 'YIEL', 'IHYU', 'NEMD',
  'TFLR', 'HFSI', 'JFLX', 'JPIE', 'PSDM', 'SDMZX', 'BRTR', 'FPNIX', 'JCPB', 'UYLX',
  'BINC', 'BTZ', 'EFR', 'FLC', 'JPC', 'PCN', 'PTY', 'VTEB',
  'DIVO', 'IDVO', 'BDJ', 'DNP', 'UTF', 'JEPI', 'JEPQ', 'R01', 'Z31',
  'DTLA', 'IDTL', 'TLT', 'EDV',
  'I37MXN', 'ID27', 'IDTXX', 'IMMXX', 'VMSTX',
  'IWVL', 'IWVG', 'EFV', 'IQLT', 'MOAT',
  'CNDX', 'EQAC', 'EQQQ', 'EQQU', 'IUIT', 'QQQ',
]);

export function inferFundRole(r) {
  const codeUp = String(r?.aia_code || r?.code || '').trim().toUpperCase();
  const codeBase = codeUp.replace(/\.[A-Z]+$/, '');
  const text = `${r?.name || ''} ${r?.name_en || ''} ${r?.ilas_platform || ''}`;

  if (
    HARD_SATELLITE_CODES.has(codeUp) ||
    HARD_SATELLITE_CODES.has(codeBase) ||
    String(r?.currency || '').toUpperCase() === 'MXN' ||
    String(r?.benchmark_code || '').toUpperCase() === 'HYG' ||
    /高收益|備兌|备兑|新兴|新興|亚洲|亞洲|亚太|亞太|太平洋|东盟|印度|南韓|韩国|台灣|台湾|拉丁美洲|巴西|東歐|东欧|澳洲|中國|中国|神州|大中華|大中华|港股|A股|沪深|中证|恒生|日本|歐洲.*股票|欧洲.*股票|歐洲遠見|歐洲動態|科技|纳斯达克|生物|醫療|医疗|健康|能源|環境|礦業|黃金|貴金屬|資源|消費|品牌|房地產|基建|可轉換|可转换|優先證券|优先证券|coco|小型|中小|20\+yr|20\+年|超长期|焦點|焦点|機會基金|優勢基金|high\s*yield|hi\s*yld|\bhy\b|covered\s*call|enhanced\s*dividend|superdividend|emerging|\bem\b|asian|asia|china|chinese|greater\s*china|taiwan|korea|india|asean|latin|brazil|japan|nikkei|topix|convertible|preferred|floating\s*rate|flexible|strategic\s*income|credit\s*allocation|multi-sector|yield\s*plus|nasdaq|technology|biotech|health|energy|gold|mining|resources|real\s*estate|reit|infrastructure|thematic|small[\s-]*cap|value\s*factor|basic\s*value|moat|mxn\s*hedged|tax-exempt/i.test(
      text
    )
  ) {
    return 'satellite';
  }

  const isCash = r?.asset_class === '货币基金' || /money\s*market|货币|現金|现金/i.test(text);
  if (!isCash && /香港|hong\s*kong/i.test(text)) {
    return 'satellite';
  }

  if (CORE_FUND_CODES.has(codeUp) || CORE_FUND_CODES.has(codeBase)) return 'core';

  const rawRole = String(r?.role || '').trim();
  if (rawRole === '核心') return 'core';
  if (rawRole === '卫星') return 'satellite';

  if (
    /全球综合债|环球债券|全球公司债|标普\s*500|全世界|全市场|短期国债|短期美债|美元短期债|极短期债|货币市场|美元现金|美股分红型ETF|美国红利|美国高股息|全球高股息|环球股票高息|环球收益股票|high\s*dividend\s*yield|dividend\s*appreciation|dividend\s*equity|s&p\s*500|ftse\s*all-world|msci\s*world|total\s*world|total\s*intl|total\s*stock|total\s*bond|aggregate\s*bond|treasury\s*bond|short[- ]term\s*(bond|treasury|corporate)|ultra[- ]short|money\s*market/i.test(
      text
    )
  ) {
    return 'core';
  }

  return 'satellite';
}

export function getFundEffectiveTags(r) {
  const rawTags = Array.isArray(r?.tags) ? r.tags.map((t) => String(t).trim()).filter(Boolean) : [];
  const rawJoined = rawTags.join(' ');
  const name = String(r?.name || '');
  const code = String(r?.code || '').trim().toUpperCase();
  const ac = String(r?.asset_class || '');
  const dom = getFundDomicile(r);
  const ilas = isIlasPlatform(r);
  const out = [];
  const add = (t) => {
    if (t && !out.includes(t)) out.push(t);
  };

  if (ilas || dom !== 'US') add('免美遗产税');
  if (!ilas && isIrelandOrLuxembourgFund(r)) add('UCITS/欧基');

  if (
    (r?.div_yield_ttm || 0) >= 0.04 ||
    rawTags.some((t) => /高派息|高股息|红利|分红/.test(t)) ||
    (/高息|红利|dividend|equity income/i.test(name) && !ac.includes('货币'))
  ) {
    add('高股息/红利');
  }
  if (r?.fee_pct != null && Number(r.fee_pct) <= 0.3) {
    add('低费率(≤0.3%)');
  }
  if (
    /^(SPY|VOO|IVV|VTI|CSPX|VUAA|SPYL|VUSD|IUSA|IDUS)$/i.test(code) ||
    /标普500|S&P 500/i.test(`${name} ${rawJoined}`)
  ) {
    add('标普500/美股宽基');
  }
  if (
    /^(QQQ|QQQM|CNDX|EQAC|EQQQ|EQQU|IUIT|XLK)$/i.test(code) ||
    /纳斯达克|NASDAQ|科技|半导体|Information Technology/i.test(`${name} ${rawJoined}`)
  ) {
    add('科技/纳指成长');
  }
  if (
    ac === '货币基金' ||
    /^(IB01|IB0D|IBTU|IBTA|IBTS|IDBT|CSH2|BIL|SGOV|SHY|BSV|9096\.HK|B01|M13|W06|Z36|Z66|E05)$/i.test(code) ||
    /短期美债|超短美债|短债|货币|国库券|0-3 Month|0-1yr|1-3yr|1-3 Mth|UltraShort|Short Term Bond/i.test(`${name} ${rawJoined}`)
  ) {
    add('短债/现金管理');
  }
  if (
    /^(CBU7|CBU0|IDTM|DTLA|IDTL|VDTA|VDTY|IEF|IEI|TLT|GOVT|EDV)$/i.test(code) ||
    /中期美债|中长期美债|超长期美债|全期限美债|20\+年|3-7yr|7-10yr|20\+yr|USD Treasury Bond/i.test(`${name} ${rawJoined}`)
  ) {
    add('中长久期美债');
  }
  if (
    /^(LQDA|LQDE|LQD|VCIT)$/i.test(code) ||
    (/企业债|公司债|Corp Bond|Corporate Bond/i.test(`${name} ${rawJoined}`) && !/高收益|High Yield/i.test(`${name} ${rawJoined}`))
  ) {
    add('投资级企业债');
  }
  if (
    /^(IHYU|HYG|JNK|USHY|P08|Z08|M10|Z13|X15|Z15|Z25|G16|Z16|Z26|U06|ZU6|R52|Z52|PC4|ZP4)$/i.test(code) ||
    /高收益|High Yield|优先证券|Preferred|CoCo/i.test(`${name} ${rawJoined}`)
  ) {
    add('高收益债/优先证券');
  }
  if (r?.twin_code || (Array.isArray(r?.twin_funds) && r.twin_funds.length > 0)) {
    add('含孪生份额(Acc↔Dist)');
  }
  if (rawTags.includes('资本返还')) {
    add('资本返还派息');
  }
  if (rawTags.some((t) => /ESG|可持续/i.test(t)) || /\bESG\b|可持续|Sustainable/i.test(name)) {
    add('ESG可持续');
  }

  return out;
}

export function collectAvailableFundTags(items = [], activeSelectedTags = []) {
  const counts = new Map();
  for (const r of items) {
    for (const t of getFundEffectiveTags(r)) {
      counts.set(t, (counts.get(t) || 0) + 1);
    }
  }
  const activeSet = new Set(Array.isArray(activeSelectedTags) ? activeSelectedTags : []);
  const pinnedSet = new Set(PINNED_TAG_ORDER);
  const pinned = PINNED_TAG_ORDER
    .filter((t) => (counts.get(t) || 0) > 0 || activeSet.has(t))
    .map((t) => ({ tag: t, count: counts.get(t) || 0, pinned: true }));
  const others = Array.from(counts.entries())
    .filter(([t, c]) => !pinnedSet.has(t) && (c > 0 || activeSet.has(t)))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag, count]) => ({ tag, count, pinned: false }));
  return [...pinned, ...others];
}

export function filterAndSortFunds(items = [], filters = {}) {
  const {
    q = '',
    platformGroup = 'all',
    domicile = 'all',
    region = 'all',
    manager = 'all',
    distType = 'all',
    role = 'all',
    currency = 'all',
    tags = [],
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
  const requiredTags = Array.isArray(tags) ? tags.filter(Boolean) : [];

  const filtered = items.filter((r) => {
    const plat = r.ilas_platform || '';
    if (platformGroup === 'aia' && !plat.startsWith('AIA')) return false;
    if (platformGroup === 'non_ilas' && plat.startsWith('AIA')) return false;
    if (platformGroup === 'eu_ucits' && !isEuropeanCategoryFund(r)) return false;
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

    if (domicile && domicile !== 'all') {
      const dom = getFundDomicile(r);
      const ilas = isIlasPlatform(r);
      if (domicile === 'eu_ucits' && !isIrelandOrLuxembourgFund(r)) return false;
      else if (domicile === 'ie' && dom !== 'IE') return false;
      else if (domicile === 'lu' && dom !== 'LU') return false;
      else if (domicile === 'non_us' && !ilas && dom === 'US') return false;
      else if (domicile === 'hk' && dom !== 'HK') return false;
      else if (domicile === 'cn' && dom !== 'CN') return false;
      else if (domicile === 'jp' && dom !== 'JP') return false;
      else if (domicile === 'us' && (ilas || dom !== 'US')) return false;
    }

    if (region && region !== 'all' && inferFundRegion(r) !== region) return false;
    if (manager && manager !== 'all' && normalizeManagerName(r.manager) !== manager) return false;

    if (onlyDistributing || distType === 'dist') {
      if (!r.is_distributing) return false;
    } else if (distType === 'acc') {
      if (r.is_distributing) return false;
    }

    if (role === 'core' && inferFundRole(r) !== 'core') return false;
    if (role === 'satellite' && inferFundRole(r) !== 'satellite') return false;
    if (currency && currency !== 'all' && currency !== 'ALL' && String(r.currency || '').toUpperCase() !== currency.toUpperCase()) {
      return false;
    }
    if (assetClass !== 'all' && r.asset_class !== assetClass) return false;
    if (minStars > 0 && (r.morningstar_stars || 0) < minStars) return false;
    if (tier !== 'ALL' && r.data_tier !== tier) return false;
    if (grade !== 'ALL' && r.quant_grade !== grade) return false;
    if (excludeNonRec && Array.isArray(r.tags) && r.tags.includes('非推荐选择')) return false;

    const effTags = requiredTags.length > 0 || query ? getFundEffectiveTags(r) : [];
    // Multi-tag selection uses OR (union) semantics so clicking multiple tags expands matching funds
    if (requiredTags.length > 0 && !requiredTags.some((t) => effTags.includes(t))) return false;

    if (query) {
      const rawTagsStr = Array.isArray(r.tags) ? r.tags.join(' ') : '';
      const twinStr = [
        r.twin_code || '',
        ...(Array.isArray(r.twin_codes) ? r.twin_codes : []),
        ...(Array.isArray(r.twin_funds) ? r.twin_funds.map((tw) => `${tw.code} ${tw.aia_code || ''}`) : []),
      ].join(' ');
      const hay = `${r.slug} ${r.code} ${r.aia_code || ''} ${r.isin || ''} ${r.yahoo_ticker || ''} ${r.name} ${r.manager || ''} ${effTags.join(' ')} ${rawTagsStr} ${twinStr}`.toLowerCase();
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
