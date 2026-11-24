import React, { useEffect, useState } from 'react';
import {
  Activity, AlertTriangle, Camera, CheckCircle2, Edit3, RefreshCw, Save, Settings, Sparkles, XCircle
} from 'lucide-react';
import { apiFetch } from '../api/client';
import { getCurrencySymbol } from '../utils/currency';

const FLAG_LABELS = {
  RATES_ELEVATED: '美債長端利率高位',
  CURVE_INVERTED: '收益率曲線倒掛',
  US_VALUATION_ELEVATED: '美股估值分位偏高',
  HK_DEEP_VALUE: '港股處於低估區間',
  GOLD_BREAKOUT: '黃金趨勢走強',
  OIL_INFLATION_SHOCK: '原油與再通膨風險',
  COPPER_GOLD_RISK_OFF: '銅金比走弱(避險)',
  CREDIT_STRESS: '高收益信用利差走闊',
  US_VALUATION_EXPOSURE_HIGH: '高估美股敞口較重',
  INFLATION_UNHEDGED_DURATION: '久期暴露且缺大宗對沖',
  GOLD_HEDGE_MISSING: '建議增配黃金對沖',
  CYCLICAL_SLOWDOWN_RISK: '週期放緩高股票風險',
  CREDIT_SPREAD_WATCH: '信用債利差觀察',
  LAGGARD_FUND_DETECTED: '含 D 級 / 落後基金',
  MAX_DRAWDOWN_BREACH: '觸及 TWR 最大回撤線',
  REEVAL_PERIODIC_DUE: '已達定期再評估日',
};

const PortfolioMonitorTab = ({ portfolioId, canEdit, onOpenOcrModal, onPortfolioMutated }) => {
  const [health, setHealth] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [reevaluating, setReevaluating] = useState(false);
  const [confirmingId, setConfirmingId] = useState(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [savingCfg, setSavingCfg] = useState(false);
  const [cfgDraft, setCfgDraft] = useState({
    wrapper_type: 'AIA_TMP2',
    rebalance_mode: 'CALENDAR_BAND',
    drift_tolerance: 5,
    max_drawdown_limit: 15,
    reeval_interval_days: 90,
    macro_sensitivity_level: 'MEDIUM',
  });
  const [ticketEdits, setTicketEdits] = useState({}); // { ticketId: { isin: pct } }
  const [ticketNotesEdits, setTicketNotesEdits] = useState({}); // { ticketId: string }
  const [editingNotesId, setEditingNotesId] = useState(null);
  const [savingDraftId, setSavingDraftId] = useState(null);
  const [msg, setMsg] = useState('');

  const [loadedKey, setLoadedKey] = useState(null);
  if (portfolioId !== loadedKey) {
    setLoadedKey(portfolioId);
    if (portfolioId) setLoading(true);
  }

  const loadAll = async (refreshHealth = false, { withSpinner = true } = {}) => {
    if (!portfolioId) return;
    if (withSpinner) setLoading(true);
    try {
      const [hRes, tRes] = await Promise.all([
        apiFetch(`/api/portfolios/${portfolioId}/monitor/health${refreshHealth ? '?refresh=true' : ''}`),
        apiFetch(`/api/portfolios/${portfolioId}/tickets`),
      ]);
      if (hRes.ok) {
        const hJson = await hRes.json();
        setHealth(hJson);
        if (hJson.config) {
          setCfgDraft({
            wrapper_type: hJson.config.wrapper_type || 'AIA_TMP2',
            rebalance_mode: hJson.config.rebalance_mode || 'CALENDAR_BAND',
            drift_tolerance: Math.round((hJson.config.drift_tolerance ?? 0.05) * 100),
            max_drawdown_limit: Math.round((hJson.config.max_drawdown_limit ?? 0.15) * 100),
            reeval_interval_days: hJson.config.reeval_interval_days ?? 90,
            macro_sensitivity_level: hJson.config.macro_sensitivity_level || 'MEDIUM',
          });
        }
      }
      if (tRes.ok) {
        const tList = await tRes.json();
        setTickets(Array.isArray(tList) ? tList : []);
      }
    } catch (err) {
      console.error('Load monitor error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!portfolioId) return undefined;
    let cancelled = false;
    Promise.all([
      apiFetch(`/api/portfolios/${portfolioId}/monitor/health`).then((r) => (r.ok ? r.json() : null)),
      apiFetch(`/api/portfolios/${portfolioId}/tickets`).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([hJson, tList]) => {
        if (cancelled) return;
        if (hJson) {
          setHealth(hJson);
          if (hJson.config) {
            setCfgDraft({
              wrapper_type: hJson.config.wrapper_type || 'AIA_TMP2',
              rebalance_mode: hJson.config.rebalance_mode || 'CALENDAR_BAND',
              drift_tolerance: Math.round((hJson.config.drift_tolerance ?? 0.05) * 100),
              max_drawdown_limit: Math.round((hJson.config.max_drawdown_limit ?? 0.15) * 100),
              reeval_interval_days: hJson.config.reeval_interval_days ?? 90,
              macro_sensitivity_level: hJson.config.macro_sensitivity_level || 'MEDIUM',
            });
          }
        }
        if (Array.isArray(tList)) {
          setTickets(tList);
        }
      })
      .catch((err) => console.error('Load monitor error:', err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [portfolioId]);

  const handleRunCheck = async () => {
    setChecking(true);
    setMsg('');
    try {
      const res = await apiFetch(`/api/portfolios/${portfolioId}/monitor/check`, { method: 'POST' });
      if (res.ok) {
        await loadAll(false);
        setMsg('已完成最新 TWR 回撤與偏離體檢並寫入監控日誌。');
      }
    } finally {
      setChecking(false);
    }
  };

  const handleSaveConfig = async (e) => {
    e.preventDefault();
    setSavingCfg(true);
    setMsg('');
    try {
      const res = await apiFetch(`/api/portfolios/${portfolioId}/monitor/config`, {
        method: 'PUT',
        body: {
          wrapper_type: cfgDraft.wrapper_type,
          rebalance_mode: cfgDraft.rebalance_mode,
          drift_tolerance: Number(cfgDraft.drift_tolerance) / 100,
          max_drawdown_limit: Number(cfgDraft.max_drawdown_limit) / 100,
          reeval_interval_days: Number(cfgDraft.reeval_interval_days),
          macro_sensitivity_level: cfgDraft.macro_sensitivity_level,
        },
      });
      if (res.ok) {
        setConfigOpen(false);
        await loadAll(false);
        setMsg('IPS 監控契約與執行載體規則已更新。');
      }
    } finally {
      setSavingCfg(false);
    }
  };

  const handleAiReevaluate = async () => {
    setReevaluating(true);
    setMsg('');
    try {
      const res = await apiFetch(`/api/portfolios/${portfolioId}/reevaluate`, {
        method: 'POST',
        body: { wrapper_type: cfgDraft.wrapper_type },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail || '再評估生成失敗');
      await loadAll(false);
      setMsg('已生成再平衡草稿執行單，請核對明細後點擊一鍵記帳。');
    } catch (err) {
      setMsg(`⚠️ ${err?.message || '生成失敗'}`);
    } finally {
      setReevaluating(false);
    }
  };

  const handleConfirmTicket = async (ticket) => {
    setConfirmingId(ticket.id);
    setMsg('');
    try {
      const edits = ticketEdits[ticket.id];
      const body = edits ? { proposed_allocations: edits } : {};
      const res = await apiFetch(`/api/portfolios/${portfolioId}/tickets/${ticket.id}/confirm`, {
        method: 'POST',
        body,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail || '記帳失敗');
      setMsg(`✓ 執行單已確認落帳 (${json.inserted} 筆交易, 批次號 ${json.batch_id})，組合統計已同步刷新。`);
      await Promise.all([loadAll(true), onPortfolioMutated?.()]);
    } catch (err) {
      setMsg(`⚠️ ${err?.message || '確認執行失敗'}`);
    } finally {
      setConfirmingId(null);
    }
  };

  const handleSaveDraft = async (ticket) => {
    setSavingDraftId(ticket.id);
    setMsg('');
    try {
      const edits = ticketEdits[ticket.id] || ticket.order_payload?.target_allocations_pct;
      const notes = ticketNotesEdits[ticket.id];
      const res = await apiFetch(`/api/portfolios/${portfolioId}/tickets/${ticket.id}`, {
        method: 'PUT',
        body: {
          ...(edits ? { proposed_allocations: edits } : {}),
          ...(notes !== undefined ? { ai_analysis: notes } : {}),
        },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail || '儲存草稿失敗');
      setTickets((prev) => prev.map((t) => (t.id === ticket.id ? json : t)));
      setTicketEdits((prev) => {
        const next = { ...prev };
        delete next[ticket.id];
        return next;
      });
      setTicketNotesEdits((prev) => {
        const next = { ...prev };
        delete next[ticket.id];
        return next;
      });
      setEditingNotesId((prev) => (prev === ticket.id ? null : prev));
      setMsg(`✓ 草稿已儲存（Batch: ${json.batch_id}），調倉明細已按最新目標權重重新測算。`);
    } catch (err) {
      setMsg(`⚠️ ${err?.message || '儲存草稿失敗'}`);
    } finally {
      setSavingDraftId(null);
    }
  };

  const handleCancelTicket = async (ticketId) => {
    const res = await apiFetch(`/api/portfolios/${portfolioId}/tickets/${ticketId}/cancel`, { method: 'POST' });
    if (res.ok) {
      await loadAll(false);
    }
  };

  if (loading && !health) {
    return (
      <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-secondary)' }}>
        正在讀取組合健康度、TWR 回撤與宏觀指標...
      </div>
    );
  }

  const macro = health?.macro_snapshot || {};
  const draftTickets = tickets.filter((t) => t.status === 'DRAFT');
  const pastTickets = tickets.filter((t) => t.status !== 'DRAFT');
  const sym = getCurrencySymbol(health?.base_currency || 'USD');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Action Toolbar */}
      <section className="glass-card" style={{ padding: '16px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                fontSize: '0.76rem',
                fontWeight: 700,
                background: cfgDraft.wrapper_type === 'AIA_TMP2' ? 'rgba(239,68,68,0.12)' : 'rgba(59,130,246,0.12)',
                color: cfgDraft.wrapper_type === 'AIA_TMP2' ? '#ef4444' : '#3b82f6',
              }}
            >
              {cfgDraft.wrapper_type === 'AIA_TMP2' ? 'AIA 卓達智悅2 (ILP)' : cfgDraft.wrapper_type === 'BROKER_ETF' ? '券商海外 ETF' : '混合賬戶'}
            </span>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              偏離容忍 ±{cfgDraft.drift_tolerance}% · 回撤警戒 -{cfgDraft.max_drawdown_limit}%
            </span>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => setConfigOpen((v) => !v)} className="action-btn-secondary">
              <Settings size={14} /> IPS 規則設定
            </button>
            {canEdit && (
              <>
                <button type="button" onClick={handleRunCheck} disabled={checking} className="action-btn-secondary">
                  <RefreshCw size={14} style={checking ? { animation: 'spin 1s linear infinite' } : undefined} />
                  {checking ? '體檢中...' : '立即體檢'}
                </button>
                <button type="button" onClick={onOpenOcrModal} className="action-btn-secondary">
                  <Camera size={14} /> 截圖 OCR 對賬
                </button>
                <button
                  type="button"
                  onClick={handleAiReevaluate}
                  disabled={reevaluating}
                  className="create-btn"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', fontSize: '0.84rem' }}
                >
                  <Sparkles size={14} />
                  {reevaluating ? 'AI 分析生成中...' : 'AI 宏觀再評估生成執行單'}
                </button>
              </>
            )}
          </div>
        </div>

        {msg && (
          <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 6, background: 'var(--surface-subtle)', fontSize: '0.82rem' }}>
            {msg}
          </div>
        )}

        {configOpen && canEdit && (
          <form
            onSubmit={handleSaveConfig}
            style={{
              marginTop: 16,
              paddingTop: 16,
              borderTop: '1px solid var(--border-subtle)',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: 12,
              alignItems: 'end',
            }}
          >
            <div className="form-group" style={{ margin: 0 }}>
              <label>落地載體</label>
              <select value={cfgDraft.wrapper_type} onChange={(e) => setCfgDraft({ ...cfgDraft, wrapper_type: e.target.value })}>
                <option value="AIA_TMP2">AIA 卓達智悅2 (ILP)</option>
                <option value="BROKER_ETF">券商海外 ETF</option>
                <option value="HYBRID">混合模式</option>
              </select>
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label>再平衡觸發模式</label>
              <select value={cfgDraft.rebalance_mode} onChange={(e) => setCfgDraft({ ...cfgDraft, rebalance_mode: e.target.value })}>
                <option value="CALENDAR_BAND">定期 + 偏離閾值</option>
                <option value="TOLERANCE_BAND">純偏離帶觸發</option>
                <option value="MACRO_TRIGGER">宏觀時鐘事件聯動</option>
                <option value="PERIODIC">純日曆定期</option>
              </select>
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label>單資產偏離閾值 (%)</label>
              <input
                type="number"
                min="1"
                max="30"
                value={cfgDraft.drift_tolerance}
                onChange={(e) => setCfgDraft({ ...cfgDraft, drift_tolerance: e.target.value })}
              />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label>最大回撤警戒 (%)</label>
              <input
                type="number"
                min="3"
                max="50"
                value={cfgDraft.max_drawdown_limit}
                onChange={(e) => setCfgDraft({ ...cfgDraft, max_drawdown_limit: e.target.value })}
              />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label>宏觀敏感度</label>
              <select
                value={cfgDraft.macro_sensitivity_level}
                onChange={(e) => setCfgDraft({ ...cfgDraft, macro_sensitivity_level: e.target.value })}
              >
                <option value="LOW">LOW (少調倉)</option>
                <option value="MEDIUM">MEDIUM (均衡)</option>
                <option value="HIGH">HIGH (積極對沖)</option>
              </select>
            </div>
            <button type="submit" className="create-btn" disabled={savingCfg}>
              {savingCfg ? '儲存中...' : '儲存契約'}
            </button>
          </form>
        )}
      </section>

      {/* Health & TWR Risk Summary */}
      <div className="kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14 }}>
        <div className="glass-card" style={{ padding: 16 }}>
          <div className="stat-label">HEALTH SCORE</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: (health?.health_score ?? 100) >= 80 ? 'var(--success, #10b981)' : 'var(--warning, #d97706)' }}>
            {health?.health_score ?? '—'} <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>/ 100</span>
          </div>
          <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
            {health?.action_required ? '⚠️ 建議關注與檢視調倉' : '✓ 組合狀態健康'}
          </div>
        </div>
        <div className="glass-card" style={{ padding: 16 }}>
          <div className="stat-label">TWR 動態回撤</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
            {((health?.twr_drawdown ?? 0) * 100).toFixed(2)}%
          </div>
          <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
            時間加權淨值（剔除充提干擾）· 歷史最大 {((health?.twr_max_drawdown ?? 0) * 100).toFixed(2)}%
          </div>
        </div>
        <div className="glass-card" style={{ padding: 16 }}>
          <div className="stat-label">最大單一資產偏離</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: (health?.drifted_assets?.length || 0) > 0 ? 'var(--warning, #d97706)' : 'inherit' }}>
            {((health?.max_asset_drift ?? 0) * 100).toFixed(1)}%
          </div>
          <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
            超標資產：{health?.drifted_assets?.length || 0} 隻
          </div>
        </div>
        <div className="glass-card" style={{ padding: 16 }}>
          <div className="stat-label">劣後基金篩查</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: (health?.dna?.laggard_holdings?.length || 0) > 0 ? 'var(--danger, #f43f5e)' : 'inherit' }}>
            {health?.dna?.laggard_holdings?.length || 0}
          </div>
          <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
            D 級 / 同類後 25% 持倉數量
          </div>
        </div>
      </div>

      {/* Live Macro & Commodity Pulse */}
      <section className="glass-card" style={{ padding: '16px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: '0.9rem' }}>
            <Activity size={16} style={{ color: 'var(--accent-color)' }} />
            宏觀利率、估值與黃金/原油/商品觀察哨兵 ({macro.as_of_date || 'baseline'})
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(health?.macro_risk_flags || []).map((f) => (
              <span
                key={f}
                style={{
                  padding: '2px 8px',
                  borderRadius: 12,
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  background: 'rgba(245,158,11,0.14)',
                  color: 'var(--warning, #d97706)',
                }}
              >
                {FLAG_LABELS[f] || f}
              </span>
            ))}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: 10, fontSize: '0.8rem' }}>
          <div style={{ padding: '8px 10px', borderRadius: 6, background: 'var(--surface-subtle)' }}>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>美債 10Y / 3M 利差</div>
            <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
              {macro.us10y_yield ?? '—'}% / {macro.yield_curve_10y_3m ?? '—'}%
            </div>
          </div>
          <div style={{ padding: '8px 10px', borderRadius: 6, background: 'var(--surface-subtle)' }}>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>標普 PE 分位 / ERP</div>
            <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
              {macro.spy_pe_pctile ?? '—'}% / {macro.spy_erp ?? '—'}%
            </div>
          </div>
          <div style={{ padding: '8px 10px', borderRadius: 6, background: 'var(--surface-subtle)' }}>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>COMEX 黃金 (GC=F)</div>
            <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
              ${macro.gold_price ?? '—'} ({macro.gold_ma200_pct != null ? `${macro.gold_ma200_pct > 0 ? '+' : ''}${macro.gold_ma200_pct}% MA200` : '—'})
            </div>
          </div>
          <div style={{ padding: '8px 10px', borderRadius: 6, background: 'var(--surface-subtle)' }}>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>WTI 原油 (CL=F)</div>
            <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
              ${macro.wti_oil_price ?? '—'} ({macro.oil_ret_20d != null ? `${macro.oil_ret_20d > 0 ? '+' : ''}${macro.oil_ret_20d}% 20D` : '—'})
            </div>
          </div>
          <div style={{ padding: '8px 10px', borderRadius: 6, background: 'var(--surface-subtle)' }}>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>銅金比 / 商品趨勢</div>
            <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
              {macro.copper_gold_ratio ?? '—'} ({macro.copper_gold_trend || 'NEUTRAL'})
            </div>
          </div>
          <div style={{ padding: '8px 10px', borderRadius: 6, background: 'var(--surface-subtle)' }}>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>DXY / HYG-IEF 信用</div>
            <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
              {macro.dxy_index ?? '—'} / {macro.hyg_ief_ratio ?? '—'}
            </div>
          </div>
        </div>
      </section>

      {/* Draft Execution Tickets (Two-stage Advisor Confirmation) */}
      {draftTickets.map((tkt) => {
        const order = tkt.order_payload || {};
        const isAia = order.mode === 'AIA_TMP2' || tkt.wrapper_type === 'AIA_TMP2';
        const editableTargets = ticketEdits[tkt.id] || order.target_allocations_pct || {};
        const targetSumPct = Math.round(
          Object.values(editableTargets).reduce((s, v) => s + (Number(v) || 0), 0) * 10
        ) / 10;
        const isDirty = Boolean(ticketEdits[tkt.id]) || ticketNotesEdits[tkt.id] !== undefined;
        const notesValue = ticketNotesEdits[tkt.id] !== undefined ? ticketNotesEdits[tkt.id] : (tkt.ai_analysis || '');
        return (
          <section
            key={tkt.id}
            className="glass-card"
            style={{ padding: 20, border: '1px solid var(--accent-color)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertTriangle size={18} style={{ color: 'var(--warning, #d97706)' }} />
                <h3 style={{ margin: 0, fontSize: '1.05rem' }}>
                  待確認執行單 ({isAia ? 'AIA 卓達智悅2 基金轉換單' : '券商 ETF 調倉買賣單'})
                </h3>
                {isDirty && (
                  <span style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: 10, background: 'rgba(245,158,11,0.14)', color: 'var(--warning, #d97706)', fontWeight: 600 }}>
                    有未儲存修改
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: Math.abs(targetSumPct - 100) < 0.2 ? 'var(--success, #10b981)' : 'var(--warning, #d97706)', fontWeight: 700 }}>
                  目標合計 {targetSumPct}%
                </span>
                <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                  Batch: {tkt.batch_id}
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
              <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
                <strong>觸發原因：</strong>{tkt.trigger_reason}
              </div>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => setEditingNotesId((prev) => (prev === tkt.id ? null : tkt.id))}
                  className="action-btn-secondary"
                  style={{ padding: '3px 9px', fontSize: '0.74rem', display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}
                >
                  <Edit3 size={12} /> {editingNotesId === tkt.id ? '收起備註編輯' : '編輯分析備註'}
                </button>
              )}
            </div>
            {editingNotesId === tkt.id ? (
              <textarea
                rows={4}
                value={notesValue}
                onChange={(e) => setTicketNotesEdits((prev) => ({ ...prev, [tkt.id]: e.target.value }))}
                placeholder="輸入顧問再評估備註與調倉說明..."
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--border-strong, var(--border-subtle))',
                  background: 'var(--surface-inset, var(--surface-subtle))',
                  color: 'var(--text-primary)',
                  fontSize: '0.82rem',
                  lineHeight: 1.5,
                  marginBottom: 14,
                  resize: 'vertical',
                }}
              />
            ) : (
              notesValue && (
                <div
                  style={{
                    padding: '10px 14px',
                    borderRadius: 8,
                    background: 'var(--surface-subtle)',
                    fontSize: '0.82rem',
                    lineHeight: 1.55,
                    marginBottom: 14,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {notesValue}
                </div>
              )
            )}

            {isAia && (
              <div
                style={{
                  padding: '8px 12px',
                  borderRadius: 6,
                  background: 'rgba(16,185,129,0.08)',
                  border: '1px solid rgba(16,185,129,0.25)',
                  fontSize: '0.78rem',
                  marginBottom: 12,
                }}
              >
                ℹ️ {order.settlement_notice || 'AIA 卓達智悅2 零轉換費，單隻基金最低 5%，T+2~T+4 結算生效。'}
              </div>
            )}

            {!isAia && order.cash_buffer_reserved_base != null && (
              <div
                style={{
                  padding: '8px 12px',
                  borderRadius: 6,
                  background: 'rgba(59,130,246,0.08)',
                  border: '1px solid rgba(59,130,246,0.25)',
                  fontSize: '0.78rem',
                  marginBottom: 12,
                }}
              >
                💵 執行策略：先賣超配回籠資金，預留 {order.cash_buffer_pct}% 現金緩衝（{sym}{Number(order.cash_buffer_reserved_base).toLocaleString()}），港股按整手下取。
              </div>
            )}

            {!isAia && Object.keys(editableTargets).length > 0 && canEdit && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  flexWrap: 'wrap',
                  padding: '8px 12px',
                  borderRadius: 6,
                  background: 'var(--surface-subtle)',
                  marginBottom: 12,
                  fontSize: '0.78rem',
                }}
              >
                <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>目標權重調整：</span>
                {Object.entries(editableTargets).map(([isin, pct]) => (
                  <label key={isin} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-mono)' }}>
                    <span>{isin}</span>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      value={pct}
                      onChange={(e) =>
                        setTicketEdits((prev) => ({
                          ...prev,
                          [tkt.id]: { ...editableTargets, [isin]: Number(e.target.value) || 0 },
                        }))
                      }
                      style={{ width: 54, textAlign: 'right', padding: '2px 5px', fontFamily: 'var(--font-mono)' }}
                    />%
                  </label>
                ))}
              </div>
            )}

            <div className="table-container" style={{ marginBottom: 14 }}>
              {isAia ? (
                <table>
                  <thead>
                    <tr>
                      <th>基金名稱 / 代碼</th>
                      <th>轉換指令</th>
                      <th style={{ textAlign: 'right' }}>現有占比</th>
                      <th style={{ textAlign: 'right' }}>建議目標占比 (%)</th>
                      <th style={{ textAlign: 'right' }}>變動 (%)</th>
                      <th style={{ textAlign: 'right' }}>預計換算金額</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(order.legs || []).map((leg) => (
                      <tr key={leg.isin}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{leg.name}</div>
                          <span className="isin-badge">{leg.isin}</span>
                        </td>
                        <td>
                          <span
                            style={{
                              fontWeight: 700,
                              fontSize: '0.78rem',
                              color: leg.action === 'SWITCH_IN' ? 'var(--success, #10b981)' : leg.action === 'SWITCH_OUT' ? 'var(--danger, #f43f5e)' : 'var(--text-muted)',
                            }}
                          >
                            {leg.action}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{leg.current_weight_pct}%</td>
                        <td style={{ textAlign: 'right' }}>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="1"
                            value={editableTargets[leg.isin] ?? leg.target_weight_pct}
                            onChange={(e) =>
                              setTicketEdits((prev) => ({
                                ...prev,
                                [tkt.id]: { ...editableTargets, [leg.isin]: Number(e.target.value) || 0 },
                              }))
                            }
                            style={{ width: 64, textAlign: 'right', padding: '4px 6px', fontFamily: 'var(--font-mono)' }}
                          />%
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                          {leg.delta_pct > 0 ? '+' : ''}{leg.delta_pct}%
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                          {sym}{Number(leg.estimated_amount_base || 0).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>ETF / 股票</th>
                      <th>指令</th>
                      <th style={{ textAlign: 'right' }}>股數</th>
                      <th style={{ textAlign: 'right' }}>價格</th>
                      <th style={{ textAlign: 'right' }}>金額</th>
                      <th style={{ textAlign: 'right' }}>現有 → 目標</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(order.trades || []).map((tr, idx) => (
                      <tr key={idx}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{tr.name}</div>
                          <span className="isin-badge">{tr.isin}</span>
                        </td>
                        <td>
                          <span style={{ fontWeight: 700, color: tr.action === 'BUY' ? 'var(--success, #10b981)' : 'var(--danger, #f43f5e)' }}>
                            {tr.action}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                          {Number(tr.shares || 0).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                          {getCurrencySymbol(tr.currency || 'USD')}{tr.price}
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                          {getCurrencySymbol(tr.currency || 'USD')}{Number(tr.amount_local || 0).toLocaleString()}
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                          {tr.current_weight_pct}% → {tr.target_weight_pct}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {canEdit && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => handleCancelTicket(tkt.id)}
                  className="action-btn-secondary"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
                >
                  <XCircle size={14} /> 捨棄草稿
                </button>
                <button
                  type="button"
                  onClick={() => handleSaveDraft(tkt)}
                  disabled={savingDraftId === tkt.id || confirmingId === tkt.id}
                  className="action-btn-secondary"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, borderColor: 'var(--accent-color)', color: 'var(--accent-color)' }}
                >
                  <Save size={14} />
                  {savingDraftId === tkt.id ? '儲存中...' : '儲存草稿'}
                </button>
                <button
                  type="button"
                  onClick={() => handleConfirmTicket(tkt)}
                  disabled={confirmingId === tkt.id || savingDraftId === tkt.id}
                  className="create-btn"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  <CheckCircle2 size={15} />
                  {confirmingId === tkt.id ? '記帳中...' : '✓ 顧問確認執行並一鍵記帳'}
                </button>
              </div>
            )}
          </section>
        );
      })}

      {/* Audit History of Past Tickets */}
      {pastTickets.length > 0 && (
        <section className="glass-card" style={{ padding: '16px 20px' }}>
          <div className="stat-label" style={{ marginBottom: 10 }}>REBALANCE EXECUTION AUDIT LOG</div>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>建立時間</th>
                  <th>載體</th>
                  <th>類型</th>
                  <th>觸發原因</th>
                  <th>狀態</th>
                  <th>Batch ID</th>
                </tr>
              </thead>
              <tbody>
                {pastTickets.map((tkt) => (
                  <tr key={tkt.id}>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>{(tkt.created_at || '').slice(0, 16)}</td>
                    <td>{tkt.wrapper_type}</td>
                    <td>{tkt.ticket_type}</td>
                    <td style={{ maxWidth: 280, fontSize: '0.8rem' }}>{tkt.trigger_reason}</td>
                    <td>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: 10,
                          fontSize: '0.74rem',
                          fontWeight: 600,
                          background: tkt.status === 'CONFIRMED' ? 'rgba(16,185,129,0.12)' : 'var(--surface-subtle)',
                          color: tkt.status === 'CONFIRMED' ? 'var(--success, #10b981)' : 'var(--text-muted)',
                        }}
                      >
                        {tkt.status}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.76rem' }}>{tkt.batch_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
};

export default PortfolioMonitorTab;
