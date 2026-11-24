import React, { useMemo, useState } from 'react';
import {
  Search, RefreshCw, GitCompare, Plus, ArrowUpDown, Database, Eye, Zap,
} from 'lucide-react';
import { useLang } from '../i18n/langCore';
import {
  filterAndSortFunds, fmtNum, fmtPct, fmtSignedPct, gradeMeta, tierMeta,
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
  refreshFunds,
  onAddFundsToLab,
}) => {
  const { lang } = useLang();
  const [q, setQ] = useState('');
  const [platformGroup, setPlatformGroup] = useState('all');
  const [assetClass, setAssetClass] = useState('all');
  const [minStars, setMinStars] = useState(0);
  const [tier, setTier] = useState('ALL');
  const [grade, setGrade] = useState('ALL');
  const [excludeNonRec, setExcludeNonRec] = useState(true);
  const [onlyDistributing, setOnlyDistributing] = useState(false);
  const [sortKey, setSortKey] = useState('quant_score');
  const [sortOrder, setSortOrder] = useState('desc');

  const rows = useMemo(
    () =>
      filterAndSortFunds(funds, {
        q,
        platformGroup,
        assetClass,
        minStars,
        tier,
        grade,
        excludeNonRec,
        onlyDistributing,
        sortKey,
        sortOrder,
      }),
    [funds, q, platformGroup, assetClass, minStars, tier, grade, excludeNonRec, onlyDistributing, sortKey, sortOrder]
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
        return (
          <FundDetailDrawer
            slug={detailSlug}
            onClose={() => setDetailSlug(null)}
            onAddToLab={(id) => {
              onAddFundsToLab([id]);
              setDetailSlug(null);
            }}
            onToggleCompare={toggleCompareSlug}
            inCompare={compareSlugs.includes(detailSlug)}
            onPrev={onPrev}
            onNext={onNext}
            positionLabel={positionLabel}
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
              ? '309-fund quantitative screening, AIA ILAS + multi-market ETF analytics & direct Strategy Lab pipeline'
              : '覆盖全库 306 只可追踪基金（AIA 卓达智悦 2 + 全球/A/港/日 ETF）的量化体检、多基对比与一键送入策略实验室'}
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
              placeholder={lang === 'en' ? 'Search code, ISIN, name...' : '搜代码 / ISIN / 基金名 / 管理人...'}
              className="atelier-input"
              style={{ width: '100%', paddingLeft: '30px' }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', fontSize: '0.8rem' }}>
          <select value={assetClass} onChange={(e) => setAssetClass(e.target.value)} className="atelier-select" style={{ width: 'auto' }}>
            <option value="all">{lang === 'en' ? 'All Classes' : '全部大类'}</option>
            <option value="股票">{lang === 'en' ? 'Equity' : '股票'}</option>
            <option value="固定收益">{lang === 'en' ? 'Fixed Income' : '固定收益'}</option>
            <option value="混合">{lang === 'en' ? 'Multi-Asset' : '混合'}</option>
            <option value="货币基金">{lang === 'en' ? 'Money Market' : '货币基金'}</option>
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

          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={onlyDistributing} onChange={(e) => setOnlyDistributing(e.target.checked)} />
            {lang === 'en' ? 'Distributing Only' : '仅看派息份额'}
          </label>
        </div>
      </div>

      {error && (
        <div className="glass-card" style={{ borderColor: 'var(--danger)', color: 'var(--danger)', marginBottom: '16px', padding: '12px 16px' }}>
          {error}
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
                  const inCmp = compareSlugs.includes(f.slug);
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
                          {f.is_distributing && (
                            <span style={{ fontSize: '0.64rem', padding: '1px 5px', borderRadius: '3px', background: 'rgba(59,130,246,0.12)', color: 'var(--info)' }}>
                              {lang === 'en' ? 'Dis' : '派息'}
                            </span>
                          )}
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
                        <div>{f.asset_class}</div>
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
                            style={{ padding: '4px 7px' }}
                            title={lang === 'en' ? 'Add to Lab' : '加入策略实验室'}
                            onClick={() => onAddFundsToLab([f.code || f.slug])}
                          >
                            <Plus size={13} />
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

      {/* Floating Comparison Dock */}
      {compareSlugs.length > 0 && (
        <div
          className="glass-card"
          style={{
            position: 'sticky',
            bottom: '16px',
            marginTop: '16px',
            padding: '12px 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '10px',
            borderColor: 'var(--accent-color)',
            boxShadow: '0 8px 30px rgba(0,0,0,0.25)',
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
                onAddFundsToLab(ids);
              }}
            >
              <Zap size={13} /> {lang === 'en' ? 'Send to Lab' : '整篮送入实验室'}
            </button>
          </div>
        </div>
      )}

      </div>
      <FundCompareModal
        open={compareOpen}
        slugs={compareSlugs}
        onClose={() => setCompareOpen(false)}
        onSendBasketToLab={(ids) => onAddFundsToLab(ids)}
      />
    </div>
  );
};

export default FundQuantView;
