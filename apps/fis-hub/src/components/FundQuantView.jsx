import React, { useMemo, useState } from 'react';
import {
  Search, RefreshCw, GitCompare, Plus, Check, X, ArrowUpDown, Database, Eye, Zap, Sparkles, Copy,
} from 'lucide-react';
import { useLang } from '../i18n/langCore';
import {
  buildSingleFundSopPrompt,
  buildBatchFundSopPrompt,
  copyAndDownloadSopPrompt,
  extractWatchFocusList,
} from '../utils/sopPromptBuilder';
import {
  collectAvailableFundTags,
  collectAvailableManagers,
  domicileMeta,
  filterAndSortFunds,
  fmtNum,
  fmtPct,
  fmtSignedPct,
  getFundDomicile,
  getFundEffectiveTags,
  gradeMeta,
  inferFundRole,
  isEuropeanCategoryFund,
  resolveFundTwins,
  tierMeta,
} from '../utils/fundQuantUtils';
import FundDetailDrawer from './FundDetailDrawer';
import FundCompareModal from './modals/FundCompareModal';

const FundQuantView = ({
  funds = [],
  facets,
  health,
  loading,
  error,
  detailSlug,
  setDetailSlug,
  compareSlugs,
  setCompareSlugs,
  toggleCompareSlug,
  compareOpen,
  setCompareOpen,
  labBasketIds: propLabBasketIds,
  setLabBasketIds: propSetLabBasketIds,
  toggleLabBasketId: propToggleLabBasketId,
  refreshFunds,
  onAddFundsToLab,
  currentUser,
}) => {
  const { lang } = useLang();
  const [localLabBasketIds, setLocalLabBasketIds] = useState([]);
  const [promptToast, setPromptToast] = useState('');

  const showPromptToast = (msg) => {
    setPromptToast(msg);
    setTimeout(() => setPromptToast(''), 3200);
  };

  const handleExportSingleFundSopPrompt = async (fundRow) => {
    const prompt = buildSingleFundSopPrompt(fundRow);
    const code = fundRow.code || fundRow.slug;
    const focusList = extractWatchFocusList(fundRow);
    await copyAndDownloadSopPrompt(prompt, '', { download: false });
    showPromptToast(`已生成并复制 ${code} 的 SOP 分析 Prompt 到剪贴板（含 ${focusList.length} 条关注事项）`);
  };

  const handleExportBatchQueuedSopPrompt = async (list) => {
    if (!Array.isArray(list) || list.length === 0) return;
    const prompt = buildBatchFundSopPrompt(list);
    await copyAndDownloadSopPrompt(prompt, '', { download: false });
    showPromptToast(`已批量生成并复制 ${list.length} 只待分析基金的 SOP Prompt 到剪贴板`);
  };
  const labBasketIds = propLabBasketIds ?? localLabBasketIds;
  const setLabBasketIds = propSetLabBasketIds ?? setLocalLabBasketIds;
  const toggleLabBasketId =
    propToggleLabBasketId ??
    ((rawId) => {
      const id = String(rawId || '').trim().toUpperCase();
      if (!id) return;
      setLabBasketIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    });
  const handleCommitLabBasket = (replace = true) => {
    if (!labBasketIds || labBasketIds.length === 0) return;
    onAddFundsToLab(labBasketIds, { replace, navigate: true });
  };
  const [q, setQ] = useState('');
  const [platformGroup, setPlatformGroup] = useState('all');
  const [domicile, setDomicile] = useState('all');
  const [regionFilter, setRegionFilter] = useState('all');
  const [managerFilter, setManagerFilter] = useState('all');
  const [distType, setDistType] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [currencyFilter, setCurrencyFilter] = useState('all');
  const [selectedTags, setSelectedTags] = useState([]);
  const [assetClass, setAssetClass] = useState('all');
  const [minStars, setMinStars] = useState(0);
  const [tier, setTier] = useState('ALL');
  const [grade, setGrade] = useState('ALL');
  const [excludeNonRec, setExcludeNonRec] = useState(true);
  const [onlySop, setOnlySop] = useState(false);
  const [onlyQueued, setOnlyQueued] = useState(false);
  const [sortKey, setSortKey] = useState('quant_score');
  const [sortOrder, setSortOrder] = useState('desc');

  const enrichedFunds = useMemo(
    () =>
      funds.map((f) => ({
        ...f,
        twin_funds: resolveFundTwins(f, funds),
      })),
    [funds]
  );

  const availableManagers = useMemo(() => collectAvailableManagers(enrichedFunds), [enrichedFunds]);

  const toggleTag = (tag) => {
    setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  const hasActiveFilters =
    q !== '' ||
    platformGroup !== 'all' ||
    domicile !== 'all' ||
    regionFilter !== 'all' ||
    managerFilter !== 'all' ||
    distType !== 'all' ||
    roleFilter !== 'all' ||
    currencyFilter !== 'all' ||
    selectedTags.length > 0 ||
    assetClass !== 'all' ||
    minStars !== 0 ||
    tier !== 'ALL' ||
    grade !== 'ALL' ||
    !excludeNonRec ||
    onlySop ||
    onlyQueued;

  const resetFilters = () => {
    setQ('');
    setPlatformGroup('all');
    setDomicile('all');
    setRegionFilter('all');
    setManagerFilter('all');
    setDistType('all');
    setRoleFilter('all');
    setCurrencyFilter('all');
    setSelectedTags([]);
    setAssetClass('all');
    setMinStars(0);
    setTier('ALL');
    setGrade('ALL');
    setExcludeNonRec(true);
    setOnlySop(false);
    setOnlyQueued(false);
  };

  // Pre-tag filtered subset so displayed tag counts always match exact click results
  const baseFilteredFunds = useMemo(
    () =>
      filterAndSortFunds(enrichedFunds, {
        q,
        platformGroup,
        domicile,
        region: regionFilter,
        manager: managerFilter,
        distType,
        role: roleFilter,
        currency: currencyFilter,
        tags: [],
        assetClass,
        minStars,
        tier,
        grade,
        excludeNonRec,
        sortKey,
        sortOrder,
      }),
    [
      enrichedFunds,
      q,
      platformGroup,
      domicile,
      regionFilter,
      managerFilter,
      distType,
      roleFilter,
      currencyFilter,
      assetClass,
      minStars,
      tier,
      grade,
      excludeNonRec,
      sortKey,
      sortOrder,
    ]
  );

  const availableTags = useMemo(
    () => collectAvailableFundTags(baseFilteredFunds, selectedTags),
    [baseFilteredFunds, selectedTags]
  );

  const rows = useMemo(
    () => {
      const tagFiltered =
        selectedTags.length === 0
          ? baseFilteredFunds
          : filterAndSortFunds(baseFilteredFunds, {
              tags: selectedTags,
              sortKey,
              sortOrder,
            });
      return tagFiltered.filter((f) => {
        if (onlySop && !f.has_sop_report) return false;
        if (onlyQueued && !['queued', 'watching', 'in_progress'].includes(f.research_queue_status || '')) return false;
        return true;
      });
    },
    [baseFilteredFunds, selectedTags, sortKey, sortOrder, onlySop, onlyQueued]
  );

  const toggleSort = (key) => {
    if (sortKey === key) {
      setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortOrder('desc');
    }
  };

  const healthColor =
    health?.state === 'online'
      ? 'var(--success)'
      : health?.state === 'stale'
      ? 'var(--warning)'
      : 'var(--text-muted)';

  return (
    <div style={{ maxWidth: '1320px' }}>
      {detailSlug && (() => {
        const idx = rows.findIndex((f) => f.slug === detailSlug);
        const onPrev = idx > 0 ? () => setDetailSlug(rows[idx - 1].slug) : null;
        const onNext = idx >= 0 && idx < rows.length - 1 ? () => setDetailSlug(rows[idx + 1].slug) : null;
        const positionLabel = idx >= 0 ? `${idx + 1} / ${rows.length}` : null;
        const drawerFund = funds.find((f) => f.slug === detailSlug);
        const drawerLabId = String(drawerFund?.code || detailSlug || '').toUpperCase();
        const drawerInBasket = labBasketIds.includes(drawerLabId);
        return (
          <FundDetailDrawer
            slug={detailSlug}
            allFunds={enrichedFunds}
            onSelectSlug={setDetailSlug}
            onClose={() => setDetailSlug(null)}
            onAddToLab={(id) => toggleLabBasketId(id)}
            inLabBasket={drawerInBasket}
            labBasketCount={labBasketIds.length}
            onSendLabBasket={() => {
              setDetailSlug(null);
              handleCommitLabBasket(true);
            }}
            onToggleCompare={toggleCompareSlug}
            inCompare={compareSlugs.includes(detailSlug)}
            onPrev={onPrev}
            onNext={onNext}
            positionLabel={positionLabel}
            currentUser={currentUser}
            onRefreshCatalog={refreshFunds}
          />
        );
      })()}
      <div style={{ display: detailSlug ? 'none' : 'block' }}>
      <header className="portfolio-hero-header" style={{ marginBottom: '18px' }}>
        <div className="portfolio-hero-title-group">
          <h1 className="portfolio-hero-title" style={{ marginBottom: '6px' }}>
            {lang === 'en' ? 'Fund Quant Library' : '基金量化库'}
          </h1>
          <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '0.9rem' }}>
            {lang === 'en'
              ? `${facets?.total ?? funds.length}-fund quantitative screening, AIA ILAS + multi-market ETF analytics & direct Strategy Lab pipeline`
              : `覆盖全库 ${facets?.total ?? funds.length} 只可追踪基金（AIA 卓达智悦 2 + 爱尔兰 UCITS + 全球/A/港/日 ETF）的量化体检、多基对比与一键送入策略实验室`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '5px 11px',
              borderRadius: '999px',
              fontSize: '0.74rem',
              fontFamily: 'var(--font-mono)',
              background: 'var(--surface-card)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: healthColor }} />
            <Database size={12} />
            {health?.last_aia_val_date
              ? `AIA ${health.last_aia_val_date}`
              : health?.state === 'uninitialized'
              ? (lang === 'en' ? 'Awaiting PC Sync' : '待本机首次同步')
              : (health?.state || '—')}
          </span>
          <button type="button" onClick={refreshFunds} className="action-btn-secondary" disabled={loading}>
            <RefreshCw size={14} /> {lang === 'en' ? 'Refresh' : '刷新'}
          </button>
        </div>
      </header>

      {/* Top KPI Strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px', marginBottom: '16px' }}>
        {[
          { label: lang === 'en' ? 'Trackable Funds' : '可追踪基金总数', value: facets?.total ?? funds.length },
          { label: lang === 'en' ? 'AIA ILAS (TMP2)' : 'AIA 卓达智悦2', value: facets?.aia ?? '—' },
          { label: lang === 'en' ? 'Europe / UCITS' : '欧洲 / UCITS 基金', value: facets?.eu_ucits ?? funds.filter(isEuropeanCategoryFund).length },
          { label: lang === 'en' ? 'Non-ILAS ETFs/Funds' : '非投连险 ETF/基金', value: facets?.non_ilas ?? '—' },
          {
            label: lang === 'en' ? 'Data Coverage (A / B)' : '数据覆盖层级 (A / B)',
            value: facets?.tiers ? `${facets.tiers.A || 0} / ${facets.tiers.B || 0}` : '—',
          },
          { label: lang === 'en' ? 'Filtered Results' : '当前筛选命中', value: rows.length },
        ].map((card) => (
          <div key={card.label} className="glass-card" style={{ padding: '14px 16px', marginBottom: 0 }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '4px' }}>{card.label}</div>
            <div style={{ fontSize: '1.3rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
              {card.value}
            </div>
          </div>
        ))}
      </div>

      {/* Multi-Facet Filter Bar */}
      <div className="glass-card" style={{ marginBottom: '16px', padding: '16px' }}>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '12px' }}>
          <div className="lab-segmented">
            {[
              { id: 'all', zh: '全部', en: 'All' },
              { id: 'aia', zh: 'AIA 卓达智悦2', en: 'AIA TMP2' },
              { id: 'eu_ucits', zh: '欧洲基金 (UCITS)', en: 'Europe / UCITS' },
              { id: 'us_intl', zh: '美/日/国际 ETF', en: 'US/Intl ETF' },
              { id: 'cn_hk', zh: 'A/港股通 ETF', en: 'CN/HK ETF' },
              { id: 'bonds', zh: '债券基金', en: 'Bonds' },
            ].map((p) => (
              <button key={p.id} type="button" aria-pressed={platformGroup === p.id} onClick={() => setPlatformGroup(p.id)}>
                {lang === 'en' ? p.en : p.zh}
              </button>
            ))}
          </div>

          <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: '340px', marginLeft: 'auto' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-muted)' }} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={lang === 'en' ? 'Search code, ISIN, tags...' : '搜代码 / ISIN / 爱尔兰 / 标签...'}
              className="atelier-input"
              style={{ width: '100%', paddingLeft: '30px' }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', fontSize: '0.8rem' }}>
          <select value={domicile} onChange={(e) => setDomicile(e.target.value)} className="atelier-select" style={{ width: 'auto' }}>
            <option value="all">{lang === 'en' ? 'All Domiciles' : '全部注册地/税籍'}</option>
            <option value="eu_ucits">{lang === 'en' ? 'Europe UCITS (IE/LU)' : '欧洲 UCITS (IE/LU)'}</option>
            <option value="ie">{lang === 'en' ? 'Ireland (IE)' : '爱尔兰 (IE)'}</option>
            <option value="lu">{lang === 'en' ? 'Luxembourg (LU)' : '卢森堡 (LU)'}</option>
            <option value="non_us">{lang === 'en' ? 'Non-US Situs (Estate Tax Exempt)' : '非美税籍 (免美遗产税)'}</option>
            <option value="hk">{lang === 'en' ? 'Hong Kong (HK)' : '香港 (HK)'}</option>
            <option value="cn">{lang === 'en' ? 'Mainland China (CN)' : '中国内地 (CN)'}</option>
            <option value="jp">{lang === 'en' ? 'Japan (JP)' : '日本 (JP)'}</option>
            <option value="us">{lang === 'en' ? 'United States (US)' : '美国 (US)'}</option>
          </select>

          <select value={regionFilter} onChange={(e) => setRegionFilter(e.target.value)} className="atelier-select" style={{ width: 'auto' }}>
            <option value="all">{lang === 'en' ? 'All Regions' : '全部市场区域'}</option>
            <option value="us">{lang === 'en' ? 'US Market' : '美国市场'}</option>
            <option value="global">{lang === 'en' ? 'Global / Developed' : '全球 / 发达'}</option>
            <option value="cn_hk">{lang === 'en' ? 'China / HK' : '中国 / 港澳'}</option>
            <option value="japan">{lang === 'en' ? 'Japan' : '日本市场'}</option>
            <option value="europe">{lang === 'en' ? 'Europe' : '欧洲市场'}</option>
            <option value="apac_em">{lang === 'en' ? 'APAC / EM' : '亚太 / 新兴市场'}</option>
          </select>

          <select value={distType} onChange={(e) => setDistType(e.target.value)} className="atelier-select" style={{ width: 'auto' }}>
            <option value="all">{lang === 'en' ? 'All Share Classes' : '全部份额 (累积+派息)'}</option>
            <option value="acc">{lang === 'en' ? 'Accumulating (Acc)' : '累积型 (Acc)'}</option>
            <option value="dist">{lang === 'en' ? 'Distributing (Dist)' : '分派 / 派息型 (Dist)'}</option>
          </select>

          {availableManagers.length > 0 && (
            <select value={managerFilter} onChange={(e) => setManagerFilter(e.target.value)} className="atelier-select" style={{ width: 'auto' }}>
              <option value="all">{lang === 'en' ? 'All Managers' : '全部管理人'}</option>
              {availableManagers.map((m) => (
                <option key={m.manager} value={m.manager}>
                  {m.manager} ({m.count})
                </option>
              ))}
            </select>
          )}

          <select value={assetClass} onChange={(e) => setAssetClass(e.target.value)} className="atelier-select" style={{ width: 'auto' }}>
            <option value="all">{lang === 'en' ? 'All Classes' : '全部大类'}</option>
            <option value="股票">{lang === 'en' ? 'Equity' : '股票'}</option>
            <option value="固定收益">{lang === 'en' ? 'Fixed Income' : '固定收益'}</option>
            <option value="混合">{lang === 'en' ? 'Multi-Asset' : '混合'}</option>
            <option value="货币基金">{lang === 'en' ? 'Money Market' : '货币基金'}</option>
          </select>

          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="atelier-select" style={{ width: 'auto' }}>
            <option value="all">{lang === 'en' ? 'All Roles' : '全部核心/卫星'}</option>
            <option value="core">{lang === 'en' ? 'Core (Broad Equity / Dividend / IG Bond)' : '核心仓 Core (广泛宽基/红利/高评级债)'}</option>
            <option value="satellite">{lang === 'en' ? 'Satellite (HY / EM / Theme)' : '卫星仓 Satellite (高收益/新兴/主题)'}</option>
          </select>

          <select value={currencyFilter} onChange={(e) => setCurrencyFilter(e.target.value)} className="atelier-select" style={{ width: 'auto' }}>
            <option value="all">{lang === 'en' ? 'All Currencies' : '全部币种'}</option>
            <option value="USD">USD</option>
            <option value="CNY">CNY</option>
            <option value="EUR">EUR</option>
            <option value="JPY">JPY</option>
            <option value="HKD">HKD</option>
            <option value="GBP">GBP</option>
          </select>

          <select value={grade} onChange={(e) => setGrade(e.target.value)} className="atelier-select" style={{ width: 'auto' }}>
            <option value="ALL">{lang === 'en' ? 'All Grades' : '全部量化评级'}</option>
            <option value="A">Grade A (Top 25%)</option>
            <option value="B">Grade B</option>
            <option value="C">Grade C</option>
            <option value="D">Grade D</option>
          </select>

          <select value={tier} onChange={(e) => setTier(e.target.value)} className="atelier-select" style={{ width: 'auto' }}>
            <option value="ALL">{lang === 'en' ? 'All Data Tiers' : '全部数据层'}</option>
            <option value="A">Tier A</option>
            <option value="B">Tier B</option>
            <option value="C">Tier C</option>
          </select>

          <select value={minStars} onChange={(e) => setMinStars(Number(e.target.value))} className="atelier-select" style={{ width: 'auto' }}>
            <option value={0}>{lang === 'en' ? 'Any Stars' : '晨星不限'}</option>
            <option value={4}>★★★★+</option>
            <option value={5}>★★★★★</option>
          </select>

          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={excludeNonRec} onChange={(e) => setExcludeNonRec(e.target.checked)} />
            {lang === 'en' ? 'Hide Non-Recommended' : '隐藏「非推荐选择」'}
          </label>

          <button
            type="button"
            onClick={() => {
              setOnlySop((v) => !v);
              if (!onlySop) setOnlyQueued(false);
            }}
            className={onlySop ? 'create-btn' : 'action-btn-secondary'}
            style={{ padding: '4px 10px', fontSize: '0.76rem' }}
          >
            📘 {lang === 'en' ? `SOP Deep Reports (${facets?.sop_covered ?? 0})` : `已有深度分析 (${facets?.sop_covered ?? 0})`}
          </button>

          <button
            type="button"
            onClick={() => {
              setOnlyQueued((v) => !v);
              if (!onlyQueued) setOnlySop(false);
            }}
            className={onlyQueued ? 'create-btn' : 'action-btn-secondary'}
            style={{ padding: '4px 10px', fontSize: '0.76rem' }}
          >
            👀 {lang === 'en' ? `Watchlist Queue (${facets?.queued_research ?? 0})` : `观察待分析 (${facets?.queued_research ?? 0})`}
          </button>

          {hasActiveFilters && (
            <button type="button" onClick={resetFilters} className="action-btn-secondary" style={{ padding: '4px 10px', fontSize: '0.76rem' }}>
              {lang === 'en' ? 'Reset' : '重置筛选'}
            </button>
          )}
        </div>

        {/* Curated Theme Tags (OR union matching) */}
        {availableTags.length > 0 && (
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', marginTop: '12px', paddingTop: '10px', borderTop: '1px dashed var(--border-subtle)' }}>
            <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 600, marginRight: '2px' }}>
              {lang === 'en' ? 'Theme Tags (Any Match OR):' : '主题标签 (多选满足任一 OR):'}
            </span>
            {availableTags.map(({ tag, count }) => {
              const active = selectedTags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  aria-pressed={active}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '3px 9px',
                    borderRadius: '999px',
                    fontSize: '0.73rem',
                    cursor: 'pointer',
                    border: active ? '1px solid var(--accent-color)' : '1px solid var(--border-subtle)',
                    background: active ? 'rgba(var(--accent-color-rgb), 0.14)' : 'var(--surface-subtle)',
                    color: active ? 'var(--accent-color)' : 'var(--text-secondary)',
                    fontWeight: active ? 700 : 500,
                  }}
                >
                  <span>{tag}</span>
                  <span style={{ fontSize: '0.66rem', opacity: 0.7, fontFamily: 'var(--font-mono)' }}>{count}</span>
                </button>
              );
            })}
            {selectedTags.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedTags([])}
                className="action-btn-secondary"
                style={{ padding: '2px 8px', fontSize: '0.72rem', borderRadius: '999px' }}
              >
                {lang === 'en' ? 'Clear Tags' : '清除标签'}
              </button>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="glass-card" style={{ borderColor: 'var(--danger)', color: 'var(--danger)', marginBottom: '16px', padding: '12px 16px' }}>
          {error}
        </div>
      )}

      {promptToast && (
        <div className="glass-card" style={{ borderColor: 'var(--success)', background: 'var(--success-bg)', color: 'var(--success)', marginBottom: '14px', padding: '10px 16px', fontSize: '0.82rem', fontWeight: 600 }}>
          {promptToast}
        </div>
      )}

      {onlyQueued && rows.length > 0 && (
        <div
          className="glass-card"
          style={{
            marginBottom: '14px',
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '10px',
            borderColor: 'rgba(139, 92, 246, 0.45)',
            background: 'rgba(139, 92, 246, 0.06)',
          }}
        >
          <div>
            <div style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              👀 当前处于「观察待分析」基金队列（共 {rows.length} 只）
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
              点击单只基金旁「复制Prompt」或右侧批量按钮，即可一键将包含全部关注事项的 SOP v2.0 大模型分析指令复制到剪贴板
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => handleExportBatchQueuedSopPrompt(rows)}
              className="create-btn"
              style={{ padding: '6px 12px', fontSize: '0.76rem', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
            >
              <Copy size={13} /> 批量复制 SOP Prompt
            </button>
          </div>
        </div>
      )}

      {/* Quant Screener Table */}
      <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="table-container" style={{ maxHeight: '640px', overflowY: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>{lang === 'en' ? 'Fund' : '代码 / 名称'}</th>
                <th>{lang === 'en' ? 'Class / Fee' : '大类 / 费率'}</th>
                {[
                  { key: 'ret_1y', label: '1Y' },
                  { key: 'ret_3y_ann', label: '3Y Ann' },
                  { key: 'vol_3y', label: '3Y Vol' },
                  { key: 'max_dd_3y', label: '3Y MaxDD' },
                  { key: 'sharpe_3y', label: 'Sharpe' },
                  { key: 'div_yield_ttm', label: 'Div' },
                  { key: 'quant_score', label: lang === 'en' ? 'Score' : '量化分' },
                ].map((col) => (
                  <th
                    key={col.key}
                    onClick={() => toggleSort(col.key)}
                    style={{ cursor: 'pointer', textAlign: 'right', whiteSpace: 'nowrap' }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                      {col.label}
                      <ArrowUpDown size={11} style={{ opacity: sortKey === col.key ? 1 : 0.35 }} />
                    </span>
                  </th>
                ))}
                <th style={{ textAlign: 'center' }}>{lang === 'en' ? 'Actions' : '操作'}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10} style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}>
                    {lang === 'en' ? 'Loading quantitative catalog...' : '正在加载全库量化数据...'}
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}>
                    {funds.length === 0
                      ? (lang === 'en' ? 'No synced quant records in D1 yet. Run wq run-daily on Windows PC.' : 'D1 尚无同步数据，请先在 Windows 本机运行 wq run-daily 推送。')
                      : (lang === 'en' ? 'No funds match current filters.' : '当前筛选条件下无匹配基金。')}
                  </td>
                </tr>
              ) : (
                rows.map((f) => {
                  const gm = gradeMeta(f.quant_grade);
                  const tm = tierMeta(f.data_tier, lang);
                  const dom = getFundDomicile(f);
                  const dm = domicileMeta(dom, lang);
                  const showDomBadge = dom === 'IE' || dom === 'LU' || dom === 'EU_UCITS';
                  const rowTags = getFundEffectiveTags(f)
                    .filter((t) => !['UCITS/欧基', '免美遗产税', '含孪生份额(Acc↔Dist)'].includes(t))
                    .slice(0, 2);
                  const twins = Array.isArray(f.twin_funds) ? f.twin_funds : [];
                  const primaryTwin = twins[0] || null;
                  const roleKind = inferFundRole(f);
                  const inCmp = compareSlugs.includes(f.slug);
                  const fundLabId = String(f.code || f.slug).toUpperCase();
                  const inLabBasket = labBasketIds.includes(fundLabId);
                  return (
                    <tr key={f.slug}>
                      <td style={{ minWidth: '240px', maxWidth: '340px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            onClick={() => setDetailSlug(f.slug)}
                            style={{
                              background: 'none',
                              border: 'none',
                              padding: 0,
                              cursor: 'pointer',
                              fontFamily: 'var(--font-mono)',
                              fontWeight: 700,
                              color: 'var(--accent-color)',
                              fontSize: '0.86rem',
                            }}
                          >
                            {f.code}
                          </button>
                          <span style={{ fontSize: '0.66rem', padding: '1px 5px', borderRadius: '3px', border: '1px solid var(--border-subtle)', color: tm.color }} title={tm.desc}>
                            {f.data_tier}
                          </span>
                          {showDomBadge && (
                            <span style={{ fontSize: '0.64rem', padding: '1px 5px', borderRadius: '3px', background: dm.bg, color: dm.color, fontWeight: 700 }}>
                              {dm.label}
                            </span>
                          )}
                          {f.is_distributing && (
                            <span style={{ fontSize: '0.64rem', padding: '1px 5px', borderRadius: '3px', background: 'rgba(59,130,246,0.12)', color: 'var(--info)' }}>
                              {lang === 'en' ? 'Dis' : '派息'}
                            </span>
                          )}
                          {f.has_sop_report ? (
                            <span
                              style={{
                                fontSize: '0.64rem',
                                padding: '1px 6px',
                                borderRadius: '3px',
                                background: 'rgba(217, 119, 6, 0.14)',
                                color: '#d97706',
                                fontWeight: 700,
                              }}
                              title={`SOP 深度分析 (${f.sop_report_date || ''}) · ${f.sop_valuation_zone || ''}`}
                            >
                              📘 {f.sop_medal || 'SOP'}{f.sop_valuation_zone ? ` · ${f.sop_valuation_zone}` : ''}
                            </span>
                          ) : ['queued', 'watching', 'in_progress'].includes(f.research_queue_status || '') ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                              <span
                                style={{
                                  fontSize: '0.64rem',
                                  padding: '1px 6px',
                                  borderRadius: '3px',
                                  background: 'rgba(139, 92, 246, 0.12)',
                                  color: '#8b5cf6',
                                  fontWeight: 700,
                                }}
                                title={
                                  Array.isArray(f.research_notes) && f.research_notes.length > 0
                                    ? `关注事项：${f.research_notes.join(' ｜ ')}`
                                    : '已加入观察分析列表，等待管理员后台 SOP 调度'
                                }
                              >
                                👀 待分析 ({f.research_request_count || 1})
                              </span>
                              <button
                                type="button"
                                onClick={() => handleExportSingleFundSopPrompt(f)}
                                style={{
                                  fontSize: '0.64rem',
                                  padding: '1px 6px',
                                  borderRadius: '3px',
                                  background: 'rgba(217, 119, 6, 0.14)',
                                  border: '1px solid rgba(217, 119, 6, 0.35)',
                                  color: '#d97706',
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '3px',
                                }}
                                title="一键复制含关注事项的基金分析 SOP Prompt 到剪贴板"
                              >
                                <Copy size={10} /> 复制Prompt
                              </button>
                            </span>
                          ) : null}
                          {primaryTwin && (
                            <button
                              type="button"
                              onClick={() => setDetailSlug(primaryTwin.slug)}
                              title={
                                lang === 'en'
                                  ? `Switch to twin share class: ${twins.map((tw) => `${tw.aia_code || tw.code} (${tw.is_distributing ? 'Dist' : 'Acc'} · ${tw.currency})`).join(', ')}`
                                  : `点击查看对应${primaryTwin.is_distributing ? '分派' : '累积'}型代码：${twins.map((tw) => `${tw.aia_code || tw.code} (${tw.is_distributing ? '分派' : '累积'} · ${tw.currency})`).join(' / ')}`
                              }
                              style={{
                                background: 'rgba(168,85,247,0.10)',
                                border: '1px solid rgba(168,85,247,0.3)',
                                color: '#a855f7',
                                borderRadius: '3px',
                                padding: '1px 5px',
                                fontSize: '0.64rem',
                                fontFamily: 'var(--font-mono)',
                                fontWeight: 700,
                                cursor: 'pointer',
                              }}
                            >
                              ⇄ {primaryTwin.is_distributing ? (lang === 'en' ? 'Dis' : '派息') : (lang === 'en' ? 'Acc' : '累积')}: {primaryTwin.aia_code || primaryTwin.code}
                              {twins.length > 1 ? ` +${twins.length - 1}` : ''}
                            </button>
                          )}
                          {rowTags.map((tg) => (
                            <span key={tg} style={{ fontSize: '0.62rem', padding: '1px 5px', borderRadius: '3px', background: 'var(--surface-subtle)', color: 'var(--text-muted)' }}>
                              {tg}
                            </span>
                          ))}
                        </div>
                        <div
                          onClick={() => setDetailSlug(f.slug)}
                          style={{
                            fontSize: '0.8rem',
                            color: 'var(--text-primary)',
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                          title={f.name}
                        >
                          {f.name}
                        </div>
                      </td>
                      <td style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                          <span>{f.asset_class}</span>
                          <span
                            style={{
                              fontSize: '0.62rem',
                              padding: '0 4px',
                              borderRadius: '3px',
                              fontWeight: 700,
                              background: roleKind === 'core' ? 'rgba(16,185,129,0.12)' : 'var(--surface-subtle)',
                              color: roleKind === 'core' ? 'var(--success)' : 'var(--text-muted)',
                            }}
                          >
                            {roleKind === 'core' ? (lang === 'en' ? 'Core' : '核心') : (lang === 'en' ? 'Sat' : '卫星')}
                          </span>
                        </div>
                        <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                          {f.fee_pct != null ? `${f.fee_pct.toFixed(2)}%` : '—'} · {f.currency}
                        </div>
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: (f.ret_1y || 0) >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                        {fmtSignedPct(f.ret_1y)}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                        {fmtSignedPct(f.ret_3y_ann)}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtPct(f.vol_3y)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--danger)' }}>{fmtPct(f.max_dd_3y)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{fmtNum(f.sharpe_3y)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--info)' }}>{fmtPct(f.div_yield_ttm)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                        <span style={{ padding: '2px 7px', borderRadius: '4px', background: gm.bg, color: gm.color, fontWeight: 700, fontSize: '0.76rem' }}>
                          {gm.label} {f.quant_score != null ? f.quant_score.toFixed(0) : ''}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'inline-flex', gap: '4px' }}>
                          <button type="button" className="action-btn-secondary" style={{ padding: '4px 7px' }} title="Detail" onClick={() => setDetailSlug(f.slug)}>
                            <Eye size={13} />
                          </button>
                          {['queued', 'watching', 'in_progress'].includes(f.research_queue_status || '') && (
                            <button
                              type="button"
                              className="action-btn-secondary"
                              style={{ padding: '4px 7px', color: '#8b5cf6', borderColor: 'rgba(139, 92, 246, 0.4)' }}
                              title="一键复制该待分析基金的 SOP Prompt 到剪贴板（含关注事项）"
                              onClick={() => handleExportSingleFundSopPrompt(f)}
                            >
                              <Copy size={13} />
                            </button>
                          )}
                          <button
                            type="button"
                            className="action-btn-secondary"
                            style={{ padding: '4px 7px', borderColor: inCmp ? 'var(--accent-color)' : undefined, color: inCmp ? 'var(--accent-color)' : undefined }}
                            title="Compare"
                            onClick={() => toggleCompareSlug(f.slug)}
                          >
                            <GitCompare size={13} />
                          </button>
                          <button
                            type="button"
                            className="action-btn-secondary"
                            style={{
                              padding: '4px 7px',
                              ...(inLabBasket
                                ? {
                                    borderColor: 'var(--success)',
                                    color: 'var(--success)',
                                    background: 'rgba(16, 185, 129, 0.12)',
                                  }
                                : {}),
                            }}
                            title={
                              inLabBasket
                                ? (lang === 'en' ? 'Selected for Lab (Click to remove)' : '已选入实验室待测篮（点击移出）')
                                : (lang === 'en' ? 'Select for Strategy Lab (Multi-select)' : '加入实验室待测篮（支持连续多选）')
                            }
                            onClick={() => toggleLabBasketId(f.code || f.slug)}
                          >
                            {inLabBasket ? <Check size={13} /> : <Plus size={13} />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Floating Selection & Comparison Dock */}
      {(labBasketIds.length > 0 || compareSlugs.length > 0) && (
        <div
          className="glass-card"
          style={{
            position: 'sticky',
            bottom: '16px',
            marginTop: '16px',
            padding: '12px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            borderColor: 'var(--accent-color)',
            boxShadow: '0 8px 30px rgba(0,0,0,0.25)',
          }}
        >
          {labBasketIds.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', fontSize: '0.82rem' }}>
                <strong style={{ color: 'var(--success)' }}>
                  {lang === 'en' ? `Lab Selection (${labBasketIds.length}):` : `实验室待测篮 (${labBasketIds.length} 只)：`}
                </strong>
                {labBasketIds.map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => toggleLabBasketId(id)}
                    title={lang === 'en' ? 'Remove' : '点击移出'}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      background: 'rgba(16, 185, 129, 0.10)',
                      border: '1px solid rgba(16, 185, 129, 0.35)',
                      color: 'var(--text-primary)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.78rem',
                      cursor: 'pointer',
                    }}
                  >
                    <span>{id}</span>
                    <X size={11} style={{ opacity: 0.7 }} />
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button type="button" className="action-btn-secondary" style={{ fontSize: '0.78rem' }} onClick={() => setLabBasketIds([])}>
                  {lang === 'en' ? 'Clear' : '清空'}
                </button>
                <button
                  type="button"
                  className="action-btn-secondary"
                  style={{ fontSize: '0.78rem' }}
                  title={lang === 'en' ? 'Append selected funds to existing Lab assets' : '保留实验室现有资产并追加本次所选基金'}
                  onClick={() => handleCommitLabBasket(false)}
                >
                  <Plus size={13} /> {lang === 'en' ? 'Append to Lab' : '追加至现有沙盒'}
                </button>
                <button
                  type="button"
                  className="create-btn"
                  style={{ padding: '6px 14px', fontSize: '0.78rem' }}
                  onClick={() => handleCommitLabBasket(true)}
                >
                  <Zap size={13} /> {lang === 'en' ? `Send to Lab (${labBasketIds.length}) →` : `送入策略实验室 (${labBasketIds.length}) →`}
                </button>
              </div>
            </div>
          )}

          {compareSlugs.length > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '10px',
                ...(labBasketIds.length > 0 ? { paddingTop: '10px', borderTop: '1px dashed var(--border-subtle)' } : {}),
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', fontSize: '0.82rem' }}>
                <strong>{lang === 'en' ? `Compare Basket (${compareSlugs.length}/6):` : `对比篮 (${compareSlugs.length}/6)：`}</strong>
                {compareSlugs.map((s) => {
                  const f = funds.find((x) => x.slug === s);
                  return (
                    <span key={s} style={{ padding: '2px 8px', borderRadius: '4px', background: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)', fontFamily: 'var(--font-mono)' }}>
                      {f?.code || s}
                    </span>
                  );
                })}
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button type="button" className="action-btn-secondary" style={{ fontSize: '0.78rem' }} onClick={() => setCompareSlugs([])}>
                  {lang === 'en' ? 'Clear' : '清空'}
                </button>
                <button
                  type="button"
                  className="action-btn-secondary"
                  style={{ fontSize: '0.78rem' }}
                  disabled={compareSlugs.length < 2}
                  onClick={() => setCompareOpen(true)}
                >
                  <GitCompare size={13} /> {lang === 'en' ? 'Compare' : '开始对比'}
                </button>
                <button
                  type="button"
                  className="create-btn"
                  style={{ padding: '6px 14px', fontSize: '0.78rem' }}
                  disabled={compareSlugs.length < 2}
                  onClick={() => {
                    const ids = compareSlugs.map((s) => funds.find((x) => x.slug === s)?.code || s);
                    onAddFundsToLab(ids, { replace: true, navigate: true });
                  }}
                >
                  <Zap size={13} /> {lang === 'en' ? 'Send to Lab' : '对比篮送入实验室'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      </div>
      <FundCompareModal
        open={compareOpen}
        slugs={compareSlugs}
        onClose={() => setCompareOpen(false)}
        onSendBasketToLab={(ids) => onAddFundsToLab(ids, { replace: true, navigate: true })}
      />
    </div>
  );
};

export default FundQuantView;
