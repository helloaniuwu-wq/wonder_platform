import React, { useEffect, useState } from 'react';
import { Activity, AlertTriangle, ArrowRight, RefreshCw, ShieldCheck } from 'lucide-react';
import { apiFetch } from '../api/client';
import { getCurrencySymbol } from '../utils/currency';

const MonitorOverviewView = ({ currentUser, onOpenPortfolioMonitor }) => {
  const [loading, setLoading] = useState(Boolean(currentUser));
  const [overview, setOverview] = useState(null);
  const [runningId, setRunningId] = useState(null);

  const fetchOverview = async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/monitor/overview');
      if (res.ok) {
        setOverview(await res.json());
      }
    } catch (err) {
      console.error('Monitor overview error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!currentUser) return undefined;
    let cancelled = false;
    apiFetch('/api/monitor/overview')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled && json) setOverview(json);
      })
      .catch((err) => console.error('Monitor overview error:', err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  const handleQuickCheck = async (portfolioId) => {
    setRunningId(portfolioId);
    try {
      await apiFetch(`/api/portfolios/${portfolioId}/monitor/check`, { method: 'POST' });
      await fetchOverview();
    } finally {
      setRunningId(null);
    }
  };

  if (!currentUser) {
    return (
      <div className="glass-card" style={{ padding: 40, textAlign: 'center' }}>
        <h3>請先登入顧問 / 帳戶後查看跨組合持續監控看板</h3>
      </div>
    );
  }

  if (loading && !overview) {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-secondary)' }}>
        正在載入跨組合監控數據與宏觀儀表板...
      </div>
    );
  }

  const macro = overview?.macro || {};
  const summary = overview?.summary || {};
  const items = overview?.items || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="stat-label">CONTINUOUS PORTFOLIO SURVEILLANCE</div>
          <h1 style={{ margin: '4px 0 0', fontSize: '1.65rem' }}>實盤組合持續追蹤與宏觀預警看板</h1>
        </div>
        <button type="button" onClick={fetchOverview} className="action-btn-secondary">
          <RefreshCw size={14} /> 刷新大盤
        </button>
      </div>

      {/* Macro & Commodity Regime Strip */}
      <section className="glass-card" style={{ padding: '18px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
            <Activity size={16} style={{ color: 'var(--accent-color)' }} />
            每日宏觀與核心商品價格脈衝 ({macro.as_of_date || 'baseline'})
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(macro.regime_flags || []).map((f) => (
              <span
                key={f}
                style={{
                  padding: '2px 9px',
                  borderRadius: 12,
                  fontSize: '0.73rem',
                  fontWeight: 600,
                  background: 'rgba(168,85,247,0.14)',
                  color: 'var(--accent-secondary)',
                }}
              >
                {f}
              </span>
            ))}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          {[
            { k: '美債 10Y 殖利率', v: macro.us10y_yield != null ? `${macro.us10y_yield}%` : '—' },
            { k: '10Y-3M 曲線斜率', v: macro.yield_curve_10y_3m != null ? `${macro.yield_curve_10y_3m}%` : '—' },
            { k: 'SPY 5Y 估值分位', v: macro.spy_pe_pctile != null ? `${macro.spy_pe_pctile}%` : '—' },
            { k: 'COMEX 黃金', v: macro.gold_price != null ? `$${macro.gold_price}` : '—' },
            { k: 'WTI 原油', v: macro.wti_oil_price != null ? `$${macro.wti_oil_price}` : '—' },
            { k: 'COMEX 銅 / 銅金比', v: macro.copper_gold_ratio != null ? `${macro.copper_gold_ratio} (${macro.copper_gold_trend})` : '—' },
          ].map((m) => (
            <div key={m.k} style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--surface-subtle)' }}>
              <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>{m.k}</div>
              <div style={{ fontSize: '1.05rem', fontWeight: 700, fontFamily: 'var(--font-mono)', marginTop: 2 }}>{m.v}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Summary KPI Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
        <div className="glass-card" style={{ padding: 16 }}>
          <div className="stat-label">納管組合總數</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{summary.total_portfolios ?? 0}</div>
        </div>
        <div className="glass-card" style={{ padding: 16 }}>
          <div className="stat-label">觸發預警 / 需關注</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: (summary.action_required_count || 0) > 0 ? 'var(--warning, #d97706)' : 'var(--success, #10b981)' }}>
            {summary.action_required_count ?? 0}
          </div>
        </div>
        <div className="glass-card" style={{ padding: 16 }}>
          <div className="stat-label">待確認執行草稿單</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: (summary.pending_draft_tickets || 0) > 0 ? 'var(--accent-color)' : 'inherit' }}>
            {summary.pending_draft_tickets ?? 0}
          </div>
        </div>
        <div className="glass-card" style={{ padding: 16 }}>
          <div className="stat-label">已體檢平均健康分</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
            {summary.avg_health_score ?? '—'}
          </div>
        </div>
      </div>

      {/* Portfolios Table */}
      <section className="glass-card" style={{ padding: 20 }}>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>組合名稱</th>
                <th>載體</th>
                <th style={{ textAlign: 'right' }}>最新淨值</th>
                <th style={{ textAlign: 'right' }}>健康度</th>
                <th style={{ textAlign: 'right' }}>最大偏離</th>
                <th style={{ textAlign: 'right' }}>TWR 回撤</th>
                <th>狀態 / 待辦</th>
                <th style={{ textAlign: 'right' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.portfolio_id}>
                  <td style={{ fontWeight: 600 }}>{row.name}</td>
                  <td>
                    <span style={{ fontSize: '0.74rem', padding: '2px 7px', borderRadius: 6, background: 'var(--surface-subtle)' }}>
                      {row.wrapper_type}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                    {row.total_nav != null ? `${getCurrencySymbol(row.base_currency)}${Number(row.total_nav).toLocaleString()}` : '—'}
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                    {row.health_score != null ? `${row.health_score}` : '未體檢'}
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                    {row.max_asset_drift != null ? `${(row.max_asset_drift * 100).toFixed(1)}%` : '—'}
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                    {row.twr_drawdown != null ? `${(row.twr_drawdown * 100).toFixed(2)}%` : '—'}
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      {row.action_required ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', color: 'var(--warning, #d97706)', fontWeight: 600 }}>
                          <AlertTriangle size={13} /> 需檢視
                        </span>
                      ) : row.health_score != null ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', color: 'var(--success, #10b981)' }}>
                          <ShieldCheck size={13} /> 正常
                        </span>
                      ) : null}
                      {row.pending_draft_tickets > 0 && (
                        <span style={{ fontSize: '0.73rem', padding: '2px 7px', borderRadius: 10, background: 'rgba(99,102,241,0.14)', color: 'var(--accent-color)', fontWeight: 700 }}>
                          {row.pending_draft_tickets} 張草稿單
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: 6 }}>
                      <button
                        type="button"
                        onClick={() => handleQuickCheck(row.portfolio_id)}
                        disabled={runningId === row.portfolio_id}
                        className="action-btn-secondary"
                        style={{ padding: '4px 10px', fontSize: '0.76rem' }}
                      >
                        {runningId === row.portfolio_id ? '體檢中...' : '體檢'}
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenPortfolioMonitor(row.portfolio_id)}
                        className="create-btn"
                        style={{ padding: '4px 10px', fontSize: '0.76rem', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                      >
                        處理 <ArrowRight size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

export default MonitorOverviewView;
