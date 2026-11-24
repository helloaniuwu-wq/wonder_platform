import React, { useEffect, useState } from 'react';
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import {
  X, Plus, GitCompare, AlertTriangle, Layers, ExternalLink, Info, ArrowLeft, ChevronLeft, ChevronRight, RefreshCw,
} from 'lucide-react';
import { authHeaders } from '../utils/auth';
import { fmtNum, fmtPct, fmtSignedPct, gradeMeta, tierMeta } from '../utils/fundQuantUtils';
import { buildFundExternalLinks } from '../utils/fundLinks';
import { useLang } from '../i18n/langCore';

const FundDetailDrawer = ({
  slug,
  onClose,
  onAddToLab,
  onToggleCompare,
  inCompare,
  onPrev,
  onNext,
  positionLabel,
}) => {
  const { lang } = useLang();
  const [range, setRange] = useState('3y');
  const [currency, setCurrency] = useState('NATIVE');
  const [profile, setProfile] = useState(null);
  const [navData, setNavData] = useState(null);
  const [holdingsData, setHoldingsData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshingHoldings, setRefreshingHoldings] = useState(false);

  const handleRefreshHoldings = async () => {
    if (!slug || refreshingHoldings) return;
    setRefreshingHoldings(true);
    try {
      const res = await fetch(`/api/quant/funds/${encodeURIComponent(slug)}/holdings?refresh=true`, {
        headers: authHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setHoldingsData(data);
      }
    } finally {
      setRefreshingHoldings(false);
    }
  };

  useEffect(() => {
    if (!slug) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [slug, onClose]);

  useEffect(() => {
    if (!slug) return;
    let active = true;
    const loadProfile = async () => {
      setLoading(true);
      try {
        const [pRes, nRes, hRes] = await Promise.all([
          fetch(`/api/quant/funds/${encodeURIComponent(slug)}`, { headers: authHeaders() }),
          fetch(`/api/quant/funds/${encodeURIComponent(slug)}/nav?range=${range}&currency=${currency}`, { headers: authHeaders() }),
          fetch(`/api/quant/funds/${encodeURIComponent(slug)}/holdings`, { headers: authHeaders() }),
        ]);
        if (!active) return;
        if (pRes.ok) setProfile(await pRes.json());
        if (nRes.ok) setNavData(await nRes.json());
        if (hRes.ok) setHoldingsData(await hRes.json());
      } finally {
        if (active) setLoading(false);
      }
    };
    loadProfile();
    return () => { active = false; };
  }, [slug, range, currency]);

  if (!slug) return null;

  const fund = profile?.fund;
  const twin = profile?.twin;
  const gMeta = gradeMeta(fund?.quant_grade);
  const tMeta = tierMeta(fund?.data_tier, lang);
  const points = navData?.points || [];
  const externalLinks = buildFundExternalLinks(fund, lang);
  const fallbackSummary = fund
    ? [
        fund.manager ? `${fund.manager}管理` : null,
        fund.ilas_platform ? `归属平台：${fund.ilas_platform}` : null,
        fund.asset_class ? `资产类别：${fund.asset_class}` : null,
        fund.role ? `组合角色：${fund.role}` : null,
        fund.risk_class ? `风险等级：${fund.risk_class}` : null,
        fund.fit_plans?.length ? `适用计划：${fund.fit_plans.join(' / ')}` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      {/* Top Navigation & Action Bar */}
      <div
        className="glass-card"
        style={{
          padding: '14px 20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          marginBottom: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={onClose}
            className="action-btn-secondary"
            style={{ padding: '6px 12px', fontSize: '0.82rem', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <ArrowLeft size={15} />
            {lang === 'en' ? 'Back to Fund Catalog' : '返回基金库'}
          </button>

          {(onPrev || onNext) && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <button
                type="button"
                onClick={onPrev}
                disabled={!onPrev}
                className="action-btn-secondary"
                style={{ padding: '5px 8px', opacity: onPrev ? 1 : 0.4 }}
                title={lang === 'en' ? 'Previous fund' : '上一支'}
              >
                <ChevronLeft size={15} />
              </button>
              {positionLabel && (
                <span style={{ fontSize: '0.76rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', padding: '0 6px' }}>
                  {positionLabel}
                </span>
              )}
              <button
                type="button"
                onClick={onNext}
                disabled={!onNext}
                className="action-btn-secondary"
                style={{ padding: '5px 8px', opacity: onNext ? 1 : 0.4 }}
                title={lang === 'en' ? 'Next fund' : '下一支'}
              >
                <ChevronRight size={15} />
              </button>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            className="create-btn"
            style={{ padding: '7px 14px', fontSize: '0.82rem' }}
            onClick={() => onAddToLab(fund?.code || slug)}
          >
            <Plus size={14} /> {lang === 'en' ? 'Add to Strategy Lab' : '加入策略实验室'}
          </button>
          <button
            type="button"
            className="action-btn-secondary"
            style={{ padding: '7px 14px', fontSize: '0.82rem' }}
            onClick={() => onToggleCompare(slug)}
          >
            <GitCompare size={14} /> {inCompare ? (lang === 'en' ? 'Remove from Compare' : '移出对比篮') : (lang === 'en' ? 'Add to Compare' : '加入对比篮')}
          </button>
          <button type="button" onClick={onClose} className="action-btn-secondary" style={{ padding: '6px' }} aria-label="Close" title="Esc">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Fund Header Card */}
      <div className="glass-card" style={{ padding: '20px 24px', marginBottom: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '1.05rem', color: 'var(--accent-color)' }}>
            {fund?.code || slug}
          </span>
          {fund?.aia_code && (
            <span style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: '4px', background: 'rgba(168,85,247,0.12)', color: '#a855f7', fontWeight: 600 }}>
              AIA {fund.aia_code}
            </span>
          )}
          <span style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: '4px', background: gMeta.bg, color: gMeta.color, fontWeight: 700 }}>
            {lang === 'en' ? `Grade ${gMeta.label}` : `量化评级 ${gMeta.label}`}
          </span>
          <span style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: '4px', border: '1px solid var(--border-subtle)', color: tMeta.color }}>
            {tMeta.label} · {tMeta.desc}
          </span>
        </div>
        <h2 style={{ margin: 0, fontSize: '1.35rem', lineHeight: 1.35 }}>{fund?.name || slug}</h2>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '6px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <span>{fund?.ilas_platform || '—'}</span>
          <span>·</span>
          <span>{fund?.asset_class || '—'}</span>
          {fund?.manager && <><span>·</span><span>{fund.manager}</span></>}
          {fund?.isin && <><span>·</span><span style={{ fontFamily: 'var(--font-mono)' }}>{fund.isin}</span></>}
          {fund?.fee_pct != null && <><span>·</span><span>ER {fund.fee_pct.toFixed(2)}%</span></>}
          {fund?.valuation_date && <><span>·</span><span>{lang === 'en' ? 'As of' : '估值日'} {fund.valuation_date}</span></>}
        </div>

        {fund?.anomalies && fund.anomalies.length > 0 && (
          <div style={{ marginTop: '12px', padding: '10px 12px', borderRadius: '6px', background: 'var(--warning-bg)', border: '1px solid var(--warning)', color: 'var(--warning)', fontSize: '0.8rem', display: 'flex', gap: '8px', alignItems: 'center' }}>
            <AlertTriangle size={15} />
            <span>{lang === 'en' ? 'Data note:' : '数据提示：'} {fund.anomalies.join(' ; ')}</span>
          </div>
        )}
      </div>

      {/* Two-Column Full-Width Layout */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '18px', alignItems: 'start' }}>
        {/* Left Column: Chart + Drawdown + Quantitative Metrics */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', minWidth: 0 }}>
          <div className="glass-card" style={{ padding: '18px 20px', marginBottom: 0, display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Chart controls */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <div className="lab-segmented">
                {['6m', '1y', '3y', '5y', 'max'].map((r) => (
                  <button key={r} type="button" aria-pressed={range === r} onClick={() => setRange(r)}>
                    {r.toUpperCase()}
                  </button>
                ))}
              </div>
              <div className="lab-segmented">
                {['NATIVE', 'USD', 'HKD', 'CNY'].map((c) => (
                  <button key={c} type="button" aria-pressed={currency === c} onClick={() => setCurrency(c)}>
                    {c === 'NATIVE' ? (fund?.currency || '原币') : c}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ background: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--card-radius)', padding: '14px' }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px', display: 'flex', justifyContent: 'space-between' }}>
                <span>{lang === 'en' ? 'Total Return (Base = 100)' : '归一化总回报走势（起点 = 100）'}</span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>vs {navData?.benchmark_code || fund?.benchmark_code || 'SPY'} ({navData?.currency || fund?.currency})</span>
              </div>
              {loading ? (
                <div style={{ height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>Loading...</div>
              ) : points.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={240}>
                    <ComposedChart data={points}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={35} />
                      <YAxis tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
                      <Tooltip />
                      <ReferenceLine y={100} stroke="var(--border-strong)" strokeDasharray="3 3" />
                      <Line type="monotone" dataKey="norm_fund" name={fund?.code || slug} stroke="var(--accent-color)" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="norm_benchmark" name={navData?.benchmark_code || 'Benchmark'} stroke="var(--text-muted)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>

                  <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', margin: '10px 0 4px' }}>
                    {lang === 'en' ? 'Underwater Drawdown (%)' : '历史水下回撤 (%)'}
                  </div>
                  <ResponsiveContainer width="100%" height={110}>
                    <ComposedChart data={points}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                      <XAxis dataKey="date" hide />
                      <YAxis tick={{ fontSize: 10 }} unit="%" domain={['auto', 0]} />
                      <Tooltip formatter={(v) => `${Number(v).toFixed(2)}%`} />
                      <Area type="monotone" dataKey="drawdown_pct" name="Drawdown" stroke="var(--danger)" fill="var(--danger-bg)" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </>
              ) : (
                <div style={{ height: 150, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.84rem' }}>
                  {lang === 'en' ? 'No historical NAV points synced yet. Run wq fetch && wq push-d1.' : '暂无历史净值序列（运行 wq fetch 与 wq push-d1 后自动展示）。'}
                </div>
              )}
            </div>

            {fund && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px' }}>
                {[
                  { k: 'YTD / 1Y', v: `${fmtSignedPct(fund.ret_ytd)} / ${fmtSignedPct(fund.ret_1y)}` },
                  { k: '3Y / 5Y Ann', v: `${fmtSignedPct(fund.ret_3y_ann)} / ${fmtSignedPct(fund.ret_5y_ann)}` },
                  { k: '3Y Vol / Max DD', v: `${fmtPct(fund.vol_3y)} / ${fmtPct(fund.max_dd_3y)}` },
                  { k: 'Sharpe / Sortino', v: `${fmtNum(fund.sharpe_3y)} / ${fmtNum(fund.sortino_3y)}` },
                  { k: 'Calmar / Recovery', v: `${fmtNum(fund.calmar_3y)} / ${fund.dd_recovery_days != null ? `${fund.dd_recovery_days}d` : '—'}` },
                  { k: 'Alpha / Beta / R²', v: `${fmtSignedPct(fund.alpha_3y)} / ${fmtNum(fund.beta_3y)} / ${fmtNum(fund.r2_3y)}` },
                  { k: 'TTM Div Yield', v: fmtPct(fund.div_yield_ttm) },
                  { k: 'Quant Score / Peer', v: `${fmtNum(fund.quant_score, 1)} / ${fund.peer_rank_pct != null ? `Top ${((1 - fund.peer_rank_pct) * 100).toFixed(0)}%` : '—'}` },
                ].map((item) => (
                  <div key={item.k} style={{ background: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)', borderRadius: '6px', padding: '10px 12px' }}>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: '4px' }}>{item.k}</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.84rem', fontWeight: 700 }}>{item.v}</div>
                  </div>
                ))}
              </div>
            )}

            {fund && (fund.duration != null || fund.yield_pct != null || fund.avg_rating || fund.credit_quality) && (
              <div style={{ background: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--card-radius)', padding: '12px 14px' }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>
                  {lang === 'en' ? 'Fixed Income · Duration, YTM & Credit' : '债券久期、到期收益率 (YTM) 与信用质量'}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px' }}>
                  {[
                    { k: lang === 'en' ? 'Duration (Yrs)' : '久期 Duration', v: fund.duration != null ? `${Number(fund.duration).toFixed(2)} 年` : '—' },
                    { k: lang === 'en' ? 'YTM / Yield' : 'YTM / 参考收益率', v: fund.yield_pct != null ? `${Number(fund.yield_pct).toFixed(2)}%` : '—' },
                    { k: lang === 'en' ? 'Avg Rating' : '平均信用评级', v: fund.avg_rating || '—' },
                    { k: lang === 'en' ? 'Credit Quality' : '信用分布', v: fund.credit_quality || '—' },
                  ].map((item) => (
                    <div key={item.k} style={{ background: 'var(--bg-primary, rgba(0,0,0,0.03))', border: '1px solid var(--border-subtle)', borderRadius: '6px', padding: '8px 10px' }}>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: '2px' }}>{item.k}</div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', fontWeight: 700 }}>{item.v}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Overview + External Links + Top 10 Holdings + Twin */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', minWidth: 0 }}>
          {fund && (
            <div className="glass-card" style={{ padding: '18px 20px', marginBottom: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: '0.92rem' }}>
                  <Info size={16} style={{ color: 'var(--accent-color)' }} />
                  {lang === 'en' ? 'Fund Overview & Official Links' : '基金简要介绍与官方资料'}
                </div>
                {fund.morningstar_stars != null && fund.morningstar_stars > 0 && (
                  <span style={{ fontSize: '0.82rem', color: 'var(--warning, #f59e0b)', fontWeight: 700 }}>
                    Morningstar {'★'.repeat(Math.min(5, fund.morningstar_stars))}
                  </span>
                )}
              </div>

              <div style={{ fontSize: '0.85rem', lineHeight: 1.7, color: 'var(--text-secondary)' }}>
                {fund.commentary || fallbackSummary || (lang === 'en' ? 'No commentary available yet.' : '暂无补充投研简介。')}
              </div>

              {fund.tags && fund.tags.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {fund.tags.slice(0, 10).map((tag) => (
                    <span
                      key={tag}
                      style={{
                        fontSize: '0.72rem',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        background: 'var(--surface-subtle)',
                        border: '1px solid var(--border-subtle)',
                        color: 'var(--text-muted)',
                      }}
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              )}

              {externalLinks.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', paddingTop: '4px' }}>
                  {externalLinks.map((lk) => (
                    <a
                      key={lk.key}
                      href={lk.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="action-btn-secondary"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        fontSize: '0.78rem',
                        padding: '6px 11px',
                        textDecoration: 'none',
                      }}
                    >
                      <ExternalLink size={12} />
                      {lk.label}
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}

          {fund && (
            <div className="glass-card" style={{ padding: '18px 20px', marginBottom: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--text-primary)' }}>
                    {lang === 'en' ? 'Top 10 Holdings' : '前十大持仓（Top 10 Holdings）'}
                  </div>
                  <button
                    type="button"
                    onClick={handleRefreshHoldings}
                    disabled={refreshingHoldings}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '2px 8px',
                      fontSize: '0.72rem',
                      borderRadius: '4px',
                      border: '1px solid var(--border-subtle)',
                      background: holdingsData?.sync_status === 'queued_for_local' ? 'rgba(217, 119, 6, 0.1)' : 'var(--surface-subtle)',
                      cursor: 'pointer',
                      color: holdingsData?.sync_status === 'queued_for_local' ? 'var(--warning, #d97706)' : 'var(--text-secondary)'
                    }}
                    title={lang === 'en' ? 'Force refresh latest holdings' : '手动重新同步最新持仓数据'}
                  >
                    <RefreshCw size={11} className={refreshingHoldings ? 'spin' : ''} />
                    {refreshingHoldings
                      ? (lang === 'en' ? 'Syncing...' : '同步中…')
                      : holdingsData?.sync_status === 'queued_for_local'
                        ? (lang === 'en' ? 'Queued for Local' : '已入队待本地拉取')
                        : (lang === 'en' ? 'Sync' : '重新同步')}
                  </button>
                </div>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  {holdingsData?.top10_total_pct != null ? `Top 10 合计 ${holdingsData.top10_total_pct}% · ` : ''}
                  {holdingsData?.source && holdingsData.source !== 'none' ? `来源: ${holdingsData.source}` : ''}
                </div>
              </div>

              {holdingsData?.sync_status === 'queued_for_local' && (
                <div style={{
                  fontSize: '0.76rem',
                  padding: '8px 10px',
                  borderRadius: '6px',
                  marginBottom: '10px',
                  background: 'rgba(217, 119, 6, 0.08)',
                  border: '1px solid rgba(217, 119, 6, 0.25)',
                  color: 'var(--text-secondary)',
                  lineHeight: 1.5,
                }}>
                  {lang === 'en'
                    ? 'Queued for local Factsheet PDF fetch & LLM parsing when the local PC worker runs next.'
                    : (holdingsData.message || '已加入本地 Factsheet 抓取队列，本地空闲时将自动拉取最新月报并通过大模型识别更新。')}
                </div>
              )}

              {holdingsData?.sync_status === 'live_updated' && (
                <div style={{
                  fontSize: '0.76rem',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  marginBottom: '10px',
                  background: 'rgba(16, 185, 129, 0.08)',
                  border: '1px solid rgba(16, 185, 129, 0.25)',
                  color: 'var(--success, #10b981)',
                }}>
                  {lang === 'en' ? 'Holdings updated live from market source.' : (holdingsData.message || '线上已即时更新最新持仓。')}
                </div>
              )}

              {loading && !holdingsData ? (
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', padding: '12px 0' }}>
                  {lang === 'en' ? 'Fetching holdings...' : '正在获取前十大持仓…'}
                </div>
              ) : holdingsData?.holdings?.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {holdingsData.holdings.map((h, idx) => (
                    <div key={`${h.name}-${idx}`} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.82rem' }}>
                      <span style={{ width: '24px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '0.74rem' }}>
                        #{idx + 1}
                      </span>
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ color: 'var(--text-primary)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {h.name}
                        </span>
                        {h.symbol && (
                          <span style={{ fontSize: '0.7rem', fontFamily: 'var(--font-mono)', padding: '1px 5px', borderRadius: '3px', background: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
                            {h.symbol}
                          </span>
                        )}
                      </div>
                      {h.weight_pct != null && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '140px', flexShrink: 0 }}>
                          <div style={{ flex: 1, height: '6px', borderRadius: '3px', background: 'var(--border-subtle)', overflow: 'hidden' }}>
                            <div style={{ width: `${Math.min(100, h.weight_pct * 4)}%`, height: '100%', background: 'var(--accent-color)' }} />
                          </div>
                          <span style={{ width: '48px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.78rem' }}>
                            {h.weight_pct.toFixed(2)}%
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                  {lang === 'en'
                    ? 'Top 10 holdings are not publicly exposed for this ILP share class; use the Morningstar or AIA link above for the latest factsheet.'
                    : '该投连险份额暂未同步公开前十大持仓明细，可点击上方 Morningstar 或 AIA 官方资料链接查看最新月报 Factsheet。'}
                </div>
              )}
            </div>
          )}

          {twin && (
            <div className="glass-card" style={{ padding: '16px 20px', marginBottom: 0, fontSize: '0.84rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, marginBottom: '8px' }}>
                <Layers size={15} style={{ color: 'var(--accent-secondary)' }} />
                {lang === 'en' ? 'Twin Share Class Comparison' : '孪生份额对照（累积 ↔ 分派）'}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', color: 'var(--text-secondary)' }}>
                <span><strong>{twin.code}</strong> · {twin.name}</span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>
                  3Y Ann: {fmtSignedPct(twin.ret_3y_ann)} · Sharpe: {fmtNum(twin.sharpe_3y)} · Div: {fmtPct(twin.div_yield_ttm)}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FundDetailDrawer;
