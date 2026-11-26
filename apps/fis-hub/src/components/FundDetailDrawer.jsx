import React, { useEffect, useState } from 'react';
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import {
  X, Plus, Check, Zap, GitCompare, AlertTriangle, Layers, ExternalLink, Info, ArrowLeft, ChevronLeft, ChevronRight, RefreshCw, BookOpen, BookmarkPlus, BookmarkCheck, Sparkles, Download,
} from 'lucide-react';
import { authHeaders } from '../utils/auth';
import { fmtNum, fmtPct, fmtSignedPct, gradeMeta, inferFundRole, resolveFundTwins, tierMeta } from '../utils/fundQuantUtils';
import { buildFundExternalLinks } from '../utils/fundLinks';
import { buildSingleFundSopPrompt, copyAndDownloadSopPrompt } from '../utils/sopPromptBuilder';
import { useLang } from '../i18n/langCore';
import FundSopReportView from './FundSopReportView';

const FundDetailDrawer = ({
  slug,
  allFunds = [],
  onSelectSlug,
  onClose,
  backLabel = null,
  onBackToCatalog = null,
  onAddToLab,
  inLabBasket = false,
  labBasketCount = 0,
  onSendLabBasket,
  onToggleCompare,
  inCompare,
  onPrev,
  onNext,
  positionLabel,
  onRefreshCatalog,
}) => {
  const { lang } = useLang();
  const [range, setRange] = useState('3y');
  const [currency, setCurrency] = useState('NATIVE');
  const [profile, setProfile] = useState(null);
  const [navData, setNavData] = useState(null);
  const [holdingsData, setHoldingsData] = useState(null);
  const [sopData, setSopData] = useState(null);
  const [drawerTab, setDrawerTab] = useState('quant');
  const [showRequestBox, setShowRequestBox] = useState(false);
  const [requestNote, setRequestNote] = useState('');
  const [requestBusy, setRequestBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refreshingHoldings, setRefreshingHoldings] = useState(false);
  const [prevSlug, setPrevSlug] = useState(slug);
  if (slug !== prevSlug) {
    setPrevSlug(slug);
    setDrawerTab('quant');
    setShowRequestBox(false);
  }

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
        const [pRes, nRes, hRes, sRes] = await Promise.all([
          fetch(`/api/quant/funds/${encodeURIComponent(slug)}`, { headers: authHeaders() }),
          fetch(`/api/quant/funds/${encodeURIComponent(slug)}/nav?range=${range}&currency=${currency}`, { headers: authHeaders() }),
          fetch(`/api/quant/funds/${encodeURIComponent(slug)}/holdings`, { headers: authHeaders() }),
          fetch(`/api/quant/funds/${encodeURIComponent(slug)}/sop-report`, { headers: authHeaders() }),
        ]);
        if (!active) return;
        if (pRes.ok) setProfile(await pRes.json());
        if (nRes.ok) setNavData(await nRes.json());
        if (hRes.ok) setHoldingsData(await hRes.json());
        if (sRes.ok) {
          const sJson = await sRes.json();
          setSopData(sJson);
          setRequestNote(sJson?.queue_entry?.my_note || '');
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    loadProfile();
    return () => { active = false; };
  }, [slug, range, currency]);

  const handleSubmitResearchRequest = async () => {
    if (!slug || requestBusy) return;
    setRequestBusy(true);
    try {
      const res = await fetch(`/api/quant/funds/${encodeURIComponent(slug)}/research-request`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: requestNote }),
      });
      if (res.ok) {
        const qEntry = await res.json();
        setSopData((prev) => ({ ...(prev || { has_report: false, slug }), queue_entry: qEntry }));
        setShowRequestBox(false);
        onRefreshCatalog?.();
      }
    } finally {
      setRequestBusy(false);
    }
  };

  const handleCancelResearchRequest = async () => {
    if (!slug || requestBusy) return;
    setRequestBusy(true);
    try {
      const res = await fetch(`/api/quant/funds/${encodeURIComponent(slug)}/research-request`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (res.ok) {
        const dRes = await res.json();
        setSopData((prev) => ({
          ...(prev || { has_report: false, slug }),
          queue_entry: dRes.request_count > 0 ? { ...(prev?.queue_entry || {}), ...dRes } : null,
        }));
        onRefreshCatalog?.();
      }
    } finally {
      setRequestBusy(false);
    }
  };

  const fund = profile?.fund;
  const twins = React.useMemo(() => {
    if (Array.isArray(profile?.twins) && profile.twins.length > 0) return profile.twins;
    if (fund) {
      const localTwins = resolveFundTwins(fund, allFunds);
      if (localTwins.length > 0) return localTwins;
    }
    return profile?.twin ? [profile.twin] : [];
  }, [profile, fund, allFunds]);

  if (!slug) return null;
  const gMeta = gradeMeta(fund?.quant_grade);
  const tMeta = tierMeta(fund?.data_tier, lang);
  const roleKind = fund ? inferFundRole(fund) : 'satellite';
  const points = navData?.points || [];
  const externalLinks = buildFundExternalLinks(fund, lang);
  const fallbackSummary = fund
    ? [
        fund.manager ? `${fund.manager}管理` : null,
        fund.ilas_platform ? `归属平台：${fund.ilas_platform}` : null,
        fund.asset_class ? `资产类别：${fund.asset_class}` : null,
        `组合角色：${roleKind === 'core' ? '核心 (广泛高质量 Beta)' : '卫星 (高收益/新兴/主题)'}`,
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
            style={{
              padding: '6px 12px',
              fontSize: '0.82rem',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              ...(backLabel
                ? { borderColor: 'var(--accent-color)', color: 'var(--accent-color)', fontWeight: 700 }
                : {}),
            }}
          >
            <ArrowLeft size={15} />
            {backLabel || (lang === 'en' ? 'Back to Fund Catalog' : '返回基金库')}
          </button>

          {onBackToCatalog && (
            <button
              type="button"
              onClick={onBackToCatalog}
              className="action-btn-secondary"
              style={{ padding: '6px 10px', fontSize: '0.78rem' }}
            >
              {lang === 'en' ? 'Fund Catalog' : '进入基金库'}
            </button>
          )}

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
            className={inLabBasket ? 'action-btn-secondary' : 'create-btn'}
            style={{
              padding: '7px 14px',
              fontSize: '0.82rem',
              ...(inLabBasket
                ? {
                    borderColor: 'var(--success)',
                    color: 'var(--success)',
                    background: 'rgba(16, 185, 129, 0.12)',
                    fontWeight: 700,
                  }
                : {}),
            }}
            onClick={() => onAddToLab(fund?.code || slug)}
          >
            {inLabBasket ? <Check size={14} /> : <Plus size={14} />}
            {inLabBasket
              ? (lang === 'en' ? 'Selected (Click to Remove)' : '已选入待测篮（点击移出）')
              : (lang === 'en' ? 'Select for Lab' : '选入实验室待测篮')}
          </button>
          {labBasketCount > 0 && onSendLabBasket && (
            <button
              type="button"
              className="create-btn"
              style={{ padding: '7px 14px', fontSize: '0.82rem' }}
              onClick={onSendLabBasket}
            >
              <Zap size={14} /> {lang === 'en' ? `Go to Lab (${labBasketCount})` : `前往实验室 (${labBasketCount})`}
            </button>
          )}
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
          {fund && (
            <span
              style={{
                fontSize: '0.72rem',
                padding: '2px 8px',
                borderRadius: '4px',
                background: roleKind === 'core' ? 'rgba(16,185,129,0.12)' : 'var(--surface-subtle)',
                color: roleKind === 'core' ? 'var(--success)' : 'var(--text-secondary)',
                fontWeight: 700,
              }}
            >
              {roleKind === 'core' ? (lang === 'en' ? 'Core Asset' : '核心资产 (Core)') : (lang === 'en' ? 'Satellite Asset' : '卫星资产 (Satellite)')}
            </span>
          )}
          {fund && (
            <span
              style={{
                fontSize: '0.72rem',
                padding: '2px 8px',
                borderRadius: '4px',
                background: fund.is_distributing ? 'rgba(59,130,246,0.12)' : 'var(--surface-subtle)',
                color: fund.is_distributing ? 'var(--info)' : 'var(--text-secondary)',
                fontWeight: 600,
              }}
            >
              {fund.is_distributing ? (lang === 'en' ? 'Distributing (Dist)' : '分派型 (Dist)') : (lang === 'en' ? 'Accumulating (Acc)' : '累积型 (Acc)')}
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
        {twins.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '10px', padding: '8px 12px', borderRadius: '6px', background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.22)' }}>
            <Layers size={14} style={{ color: '#a855f7', flexShrink: 0 }} />
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {fund?.is_distributing
                ? (lang === 'en' ? 'Corresponding Accumulating Share Class:' : '对应累积型平台代码：')
                : (lang === 'en' ? 'Corresponding Distributing Share Class:' : '对应分派型平台代码：')}
            </span>
            {twins.map((tw) => (
              <button
                key={tw.slug}
                type="button"
                onClick={() => onSelectSlug?.(tw.slug)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '3px 10px',
                  borderRadius: '999px',
                  background: 'var(--surface-card)',
                  border: '1px solid rgba(168,85,247,0.45)',
                  color: '#a855f7',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.76rem',
                  fontWeight: 700,
                  cursor: onSelectSlug ? 'pointer' : 'default',
                }}
              >
                <span>{tw.aia_code || tw.code}</span>
                <span style={{ fontWeight: 500, fontFamily: 'inherit', color: 'var(--text-secondary)' }}>
                  ({tw.is_distributing ? (lang === 'en' ? 'Dist' : '分派') : (lang === 'en' ? 'Acc' : '累积')} · {tw.currency})
                </span>
                <span>→</span>
              </button>
            ))}
          </div>
        )}
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

      {/* Two-Column Full-Width Layout or Full SOP Report View */}
      {sopData?.has_report && (
        <div className="glass-card" style={{ padding: '10px 16px', marginBottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
          <div className="lab-segmented">
            <button type="button" aria-pressed={drawerTab === 'quant'} onClick={() => setDrawerTab('quant')}>
              📊 {lang === 'en' ? 'Quant & Holdings' : '量化体检与持仓'}
            </button>
            <button type="button" aria-pressed={drawerTab === 'sop'} onClick={() => setDrawerTab('sop')}>
              📘 {lang === 'en' ? `SOP Deep Analysis (${sopData.medal_rating})` : `SOP 深度分析 (${sopData.medal_rating})`}
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.76rem', color: 'var(--text-muted)' }}>
            <span>报告日：{sopData.report_date} · 估值水位：{sopData.valuation_zone}</span>
            <button
              type="button"
              onClick={() => setShowRequestBox((v) => !v)}
              className="action-btn-secondary"
              style={{ padding: '4px 10px', fontSize: '0.74rem' }}
            >
              <RefreshCw size={12} /> 申请重检更新
            </button>
          </div>
        </div>
      )}

      {showRequestBox && (
        <div className="glass-card" style={{ padding: '14px 18px', marginBottom: 0, borderColor: 'var(--accent-color)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ fontSize: '0.84rem', fontWeight: 700 }}>
            {sopData?.has_report ? '🔄 申请刷新 SOP 深度分析' : '🔭 标记加入观察分析列表（供管理员后台 SOP 调度）'}
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <input
              type="text"
              value={requestNote}
              onChange={(e) => setRequestNote(e.target.value)}
              placeholder="可选：填写关注重点（如：分红可持续性 / 久期风险 / 同类替代比较）…"
              className="atelier-input"
              style={{ flex: '1 1 280px' }}
            />
            <button
              type="button"
              disabled={requestBusy}
              onClick={handleSubmitResearchRequest}
              className="create-btn"
              style={{ padding: '7px 14px', fontSize: '0.8rem' }}
            >
              {requestBusy ? '提交中…' : '确认加入观察队列'}
            </button>
            <button
              type="button"
              onClick={() => setShowRequestBox(false)}
              className="action-btn-secondary"
              style={{ padding: '7px 12px', fontSize: '0.8rem' }}
            >
              取消
            </button>
          </div>
        </div>
      )}

      {drawerTab === 'sop' && sopData?.has_report ? (
        <FundSopReportView sopData={sopData} />
      ) : (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '18px', alignItems: 'start' }}>
        {/* Left Column: Chart + Drawdown + Quantitative Metrics */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', minWidth: 0 }}>
          <div className="glass-card" style={{ padding: '18px 20px', marginBottom: 0, display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Chart controls */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <div className="lab-segmented">
                {['6m', '1y', '3y', '5y', '10y', 'max'].map((r) => (
                  <button key={r} type="button" aria-pressed={range === r} onClick={() => setRange(r)}>
                    {r.toUpperCase()}
                  </button>
                ))}
              </div>
              <div className="lab-segmented">
                {['NATIVE', ...['USD', 'HKD', 'CNY'].filter((c) => c !== fund?.currency)].map((c) => (
                  <button key={c} type="button" aria-pressed={currency === c} onClick={() => setCurrency(c)}>
                    {c === 'NATIVE' ? (fund?.currency ? `${fund.currency}（原币）` : '原币') : c}
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

            {fund && (
              fund.duration != null ||
              fund.yield_pct != null ||
              fund.avg_rating ||
              fund.credit_quality ||
              sopData?.valuation_summary?.duration_yrs != null ||
              sopData?.valuation_summary?.ytm_pct != null ||
              sopData?.valuation_summary?.pe_current != null ||
              sopData?.valuation_summary?.erp_current_pct != null
            ) && (
              <div style={{ background: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--card-radius)', padding: '12px 14px' }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>
                  {(fund.duration != null || fund.avg_rating || sopData?.valuation_summary?.duration_yrs != null)
                    ? (lang === 'en' ? 'Fixed Income · Duration, YTM & Credit' : '债券久期、到期收益率 (YTM) 与信用质量')
                    : (lang === 'en' ? 'Valuation & Yield Snapshot (SOP)' : '底层估值与股息利差速览 (SOP)')}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px' }}>
                  {(fund.duration != null || fund.avg_rating || sopData?.valuation_summary?.duration_yrs != null) ? (
                    [
                      {
                        k: lang === 'en' ? 'Duration (Yrs)' : '久期 Duration',
                        v: (fund.duration ?? sopData?.valuation_summary?.duration_yrs) != null
                          ? `${Number(fund.duration ?? sopData?.valuation_summary?.duration_yrs).toFixed(2)} 年`
                          : '—',
                      },
                      {
                        k: lang === 'en' ? 'YTM / Yield' : 'YTM / 参考收益率',
                        v: (fund.yield_pct ?? sopData?.valuation_summary?.ytm_pct ?? sopData?.dividend_yield_ttm) != null
                          ? `${Number(fund.yield_pct ?? sopData?.valuation_summary?.ytm_pct ?? sopData?.dividend_yield_ttm).toFixed(2)}%`
                          : '—',
                      },
                      { k: lang === 'en' ? 'Avg Rating' : '平均信用评级', v: fund.avg_rating || '—' },
                      { k: lang === 'en' ? 'Credit Quality' : '信用分布', v: fund.credit_quality || '—' },
                    ].map((item) => (
                      <div key={item.k} style={{ background: 'var(--bg-primary, rgba(0,0,0,0.03))', border: '1px solid var(--border-subtle)', borderRadius: '6px', padding: '8px 10px' }}>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: '2px' }}>{item.k}</div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', fontWeight: 700 }}>{item.v}</div>
                      </div>
                    ))
                  ) : (
                    [
                      {
                        k: lang === 'en' ? 'Current PE / 5Y Pct' : '当前 PE / 5Y分位',
                        v: sopData?.valuation_summary?.pe_current != null
                          ? `${Number(sopData.valuation_summary.pe_current).toFixed(2)}x${sopData?.valuation_pct_5y != null ? ` (${sopData.valuation_pct_5y}%)` : ''}`
                          : '—',
                      },
                      {
                        k: lang === 'en' ? 'TTM Div Yield' : 'TTM 股息率',
                        v: (sopData?.dividend_yield_ttm ?? (fund.div_yield_ttm != null ? fund.div_yield_ttm * 100 : null)) != null
                          ? `${Number(sopData?.dividend_yield_ttm ?? (fund.div_yield_ttm * 100)).toFixed(2)}%`
                          : '—',
                      },
                      {
                        k: lang === 'en' ? 'Spread vs 10Y RF' : '较10Y无风险利差',
                        v: sopData?.dividend_spread_rf != null
                          ? `${sopData.dividend_spread_rf >= 0 ? '+' : ''}${Number(sopData.dividend_spread_rf).toFixed(2)}%`
                          : '—',
                      },
                      {
                        k: lang === 'en' ? 'ERP (Equity Risk Prem)' : '隐含股权风险溢价 ERP',
                        v: sopData?.valuation_summary?.erp_current_pct != null
                          ? `${Number(sopData.valuation_summary.erp_current_pct).toFixed(2)}%`
                          : '—',
                      },
                    ].map((item) => (
                      <div key={item.k} style={{ background: 'var(--bg-primary, rgba(0,0,0,0.03))', border: '1px solid var(--border-subtle)', borderRadius: '6px', padding: '8px 10px' }}>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: '2px' }}>{item.k}</div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', fontWeight: 700 }}>{item.v}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: SOP Status + Overview + External Links + Top 10 Holdings + Twin */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', minWidth: 0 }}>
          {fund && (
            sopData?.has_report ? (
              <div
                className="glass-card"
                style={{
                  padding: '16px 20px',
                  marginBottom: 0,
                  borderColor: 'rgba(217, 119, 6, 0.45)',
                  background: 'rgba(217, 119, 6, 0.05)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: '0.9rem', color: '#d97706' }}>
                    <BookOpen size={15} />
                    SOP v{sopData.sop_version} 深度分析已就绪 · {sopData.medal_rating}
                  </div>
                  <button
                    type="button"
                    onClick={() => setDrawerTab('sop')}
                    className="create-btn"
                    style={{ padding: '5px 12px', fontSize: '0.78rem' }}
                  >
                    阅读完整深度分析 →
                  </button>
                </div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-primary)', lineHeight: 1.5 }}>{sopData.one_liner}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                  估值：{sopData.valuation_zone}
                  {sopData.valuation_pct_5y != null ? ` (${sopData.valuation_pct_5y}% 5Y)` : ''}
                  {' · '}分红率：{sopData.dividend_yield_ttm != null ? `${sopData.dividend_yield_ttm}%` : '—'}
                  {' · '}10Y利差：{sopData.dividend_spread_rf != null ? `${sopData.dividend_spread_rf >= 0 ? '+' : ''}${sopData.dividend_spread_rf}%` : '—'}
                </div>
                {sopData.red_flag_top && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--danger, #dc2626)', lineHeight: 1.45, marginTop: '2px' }}>
                    ⚠️ 首要红旗：{sopData.red_flag_top}
                  </div>
                )}
              </div>
            ) : (
              <div
                className="glass-card"
                style={{
                  padding: '15px 18px',
                  marginBottom: 0,
                  borderColor: sopData?.queue_entry?.requested_by_me ? 'rgba(139, 92, 246, 0.45)' : 'var(--border-subtle)',
                  background: sopData?.queue_entry?.requested_by_me ? 'rgba(139, 92, 246, 0.06)' : 'var(--surface-subtle)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '10px',
                }}
              >
                <div style={{ minWidth: '200px', flex: 1 }}>
                  <div style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '3px' }}>
                    {sopData?.queue_entry?.requested_by_me
                      ? `👀 已在观察分析列表（状态：${sopData.queue_entry.status} · 共 ${sopData.queue_entry.request_count} 人关注）`
                      : '🔭 该基金尚未进行 SOP 深度分析'}
                  </div>
                  <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                    {Array.isArray(sopData?.queue_entry?.notes) && sopData.queue_entry.notes.length > 0
                      ? `关注事项汇总：${sopData.queue_entry.notes.join(' ｜ ')}`
                      : sopData?.queue_entry?.my_note
                        ? `我的关注备注：${sopData.queue_entry.my_note}`
                        : '可一键标记加入观察分析列表，或直接一键导出 SOP Prompt 交给大模型分析。'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={async () => {
                      const promptItem = {
                        ...(fund || {}),
                        slug: fund?.slug || slug,
                        code: fund?.code || slug,
                        fund_name: fund?.name || slug,
                        priority: sopData?.queue_entry?.priority || 'normal',
                        request_count: sopData?.queue_entry?.request_count || 1,
                        requesters: sopData?.queue_entry?.requesters || [],
                        notes: sopData?.queue_entry?.notes || [],
                        my_note: requestNote.trim() || sopData?.queue_entry?.my_note || '',
                        admin_note: sopData?.queue_entry?.admin_note || '',
                      };
                      const prompt = buildSingleFundSopPrompt(promptItem);
                      const code = promptItem.code || slug;
                      await copyAndDownloadSopPrompt(prompt, '', { download: false });
                      alert(`已生成并复制 ${code} 的基金分析 SOP v2.0 Prompt 到剪贴板（可直接粘贴至大模型后台）`);
                    }}
                    className="action-btn-secondary"
                    style={{
                      padding: '6px 11px',
                      fontSize: '0.76rem',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      borderColor: 'rgba(217, 119, 6, 0.45)',
                      color: '#d97706',
                      fontWeight: 700,
                    }}
                    title="一键复制含关注事项的 SOP v2.0 Prompt 到剪贴板"
                  >
                    <Sparkles size={13} /> 复制 SOP Prompt
                  </button>
                  <button
                    type="button"
                    disabled={requestBusy}
                    onClick={() => setShowRequestBox((v) => !v)}
                    className={sopData?.queue_entry?.requested_by_me ? 'action-btn-secondary' : 'create-btn'}
                    style={{ padding: '6px 12px', fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                  >
                    {sopData?.queue_entry?.requested_by_me ? <BookmarkCheck size={14} /> : <BookmarkPlus size={14} />}
                    {sopData?.queue_entry?.requested_by_me ? '修改关注备注' : '标记加入观察分析列表'}
                  </button>
                  {sopData?.queue_entry?.requested_by_me && (
                    <button
                      type="button"
                      disabled={requestBusy}
                      onClick={handleCancelResearchRequest}
                      className="action-btn-secondary"
                      style={{ padding: '6px 10px', fontSize: '0.76rem', color: 'var(--text-muted)' }}
                    >
                      移出
                    </button>
                  )}
                </div>
              </div>
            )
          )}
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

          {twins.length > 0 && (
            <div className="glass-card" style={{ padding: '16px 20px', marginBottom: 0, fontSize: '0.84rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, marginBottom: '10px' }}>
                <Layers size={15} style={{ color: 'var(--accent-secondary)' }} />
                {lang === 'en' ? 'Twin Share Class Comparison (Acc ↔ Dist)' : '孪生份额对照（累积 ↔ 分派）'}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {twins.map((tw) => (
                  <div
                    key={tw.slug}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: '8px',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      background: 'var(--surface-subtle)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', minWidth: 0 }}>
                      <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-color)' }}>
                        {tw.aia_code || tw.code}
                      </strong>
                      <span style={{ fontSize: '0.7rem', padding: '1px 5px', borderRadius: '3px', background: tw.is_distributing ? 'rgba(59,130,246,0.12)' : 'rgba(16,185,129,0.12)', color: tw.is_distributing ? 'var(--info)' : 'var(--success)' }}>
                        {tw.is_distributing ? (lang === 'en' ? 'Dist' : '分派') : (lang === 'en' ? 'Acc' : '累积')} · {tw.currency}
                      </span>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-primary)' }}>{tw.name}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.76rem' }}>
                        3Y: {fmtSignedPct(tw.ret_3y_ann)} · Sharpe: {fmtNum(tw.sharpe_3y)} · Div: {fmtPct(tw.div_yield_ttm)}
                      </span>
                      {onSelectSlug && (
                        <button
                          type="button"
                          onClick={() => onSelectSlug(tw.slug)}
                          className="action-btn-secondary"
                          style={{ padding: '3px 9px', fontSize: '0.74rem' }}
                        >
                          {lang === 'en' ? 'View →' : '查看该份额 →'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  );
};

export default FundDetailDrawer;
