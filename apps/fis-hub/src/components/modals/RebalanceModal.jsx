import React, { useState, useMemo } from 'react';
import { TrendingUp, Calendar, ChevronRight, RefreshCw, Search } from 'lucide-react';
import { getCurrencySymbol } from '../../utils/currency';

const r2 = (v) => (typeof v === 'number' ? parseFloat(v.toFixed(1)) : 0);

/**
 * Three sub-steps within Step 1:
 *  'date'    → select date, click "测算"
 *  'loading' → fetching live weights
 *  'edit'    → show live weights + editable target inputs
 * Step 2 = rebalancePreview !== null
 */
const RebalanceModal = ({
  showRebalanceModal, setShowRebalanceModal,
  rebalancePreview, setRebalancePreview,
  rebalanceDate, setRebalanceDate,
  rebalanceDraftTargets, setRebalanceDraftTargets,
  handleRebalanceSaveAndCalc,
  handleRebalanceExecute,
  portfolioId,
  authHeaders = () => ({}),
}) => {
  const [subStep, setSubStep]         = useState('date');   // 'date' | 'loading' | 'edit'
  const [liveWeights, setLiveWeights] = useState([]);       // [{isin, name, weight_pct, ...}]
  const [localTargets, setLocalTargets] = useState({});     // { ISIN: '25' } (pct string)
  const [calculating, setCalculating]   = useState(false);

  // 每次打开弹窗时重置本地步骤：渲染期按「是否打开」比较，代替 effect 里同步 setState。
  // （父级的 rebalancePreview 已由 handleRebalancePreview 在打开前置空，这里无需再改父状态。）
  const [wasOpen, setWasOpen] = useState(showRebalanceModal);
  if (showRebalanceModal !== wasOpen) {
    setWasOpen(showRebalanceModal);
    if (showRebalanceModal) {
      setSubStep('date');
      setLiveWeights([]);
      setLocalTargets({});
    }
  }

  // All derived values (hooks must be above early return)
  const totalTargetPct = useMemo(
    () => Object.values(localTargets).reduce((s, v) => s + (parseFloat(v) || 0), 0),
    [localTargets]
  );
  const isStep2    = rebalancePreview !== null;
  const weightOk   = Math.abs(totalTargetPct - 100) <= 0.5;
  const weightOver = totalTargetPct > 100.05;
  const weightUnder = totalTargetPct < 99.5 && totalTargetPct > 0;
  const canSubmit  = weightOk && !calculating;

  if (!showRebalanceModal) return null;

  // ── Fetch live weights at selected date ──
  const handleFetchWeights = async () => {
    setSubStep('loading');
    try {
      const params = new URLSearchParams();
      if (rebalanceDate) params.set('as_of_date', rebalanceDate);
      const res  = await fetch(`/api/portfolios/current_weights/${portfolioId}?${params}`, { headers: authHeaders() });
      const json = await res.json();
      const weights = json.weights || [];
      setLiveWeights(weights);
      // 取到实时权重后，用已保存的草稿目标预填输入框
      if (weights.length > 0) {
        const init = {};
        for (const [isin, dec] of Object.entries(rebalanceDraftTargets || {})) {
          if (dec > 0) init[isin] = String(r2(dec * 100));
        }
        setLocalTargets(init);
      }
      setSubStep('edit');
    } catch (e) {
      console.error(e);
      setSubStep('date');
      alert('获取权重失败，请检查网络或重试');
    }
  };

  const handleWeightChange = (isin, val) => {
    setLocalTargets(prev => ({ ...prev, [isin]: val }));
  };

  const handleConfirm = async () => {
    const decimals = {};
    for (const [isin, valStr] of Object.entries(localTargets)) {
      const v = parseFloat(valStr);
      if (!isNaN(v) && v > 0) decimals[isin] = parseFloat((v / 100).toFixed(6));
    }
    setCalculating(true);
    setRebalanceDraftTargets(decimals);
    await handleRebalanceSaveAndCalc(decimals);
    setCalculating(false);
  };

  // ─────────────────────────────────────────────────────────────────
  //  SUB-STEP: date selector
  // ─────────────────────────────────────────────────────────────────
  const renderDateStep = () => (
    <div style={{ padding: '12px 0' }}>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginBottom: 24, lineHeight: 1.6 }}>
        选择基准日期，系统将按照该日的市场价格计算每个资产的<strong style={{ color: 'var(--accent-secondary)' }}>当前实际占比</strong>，
        然后您可以在此基础上设定新的目标权重并一键再平衡。
      </p>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
        background: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)',
        borderRadius: 12, padding: '20px 24px', marginBottom: 28
      }}>
        <Calendar size={20} style={{ color: 'var(--accent-secondary)', flexShrink: 0 }} />
        <div>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', marginBottom: 6, fontWeight: 600 }}>计算基准日期</div>
          <input
            type="date"
            value={rebalanceDate}
            onChange={e => setRebalanceDate(e.target.value)}
            style={{
              background: 'var(--surface-inset, var(--bg-primary))', border: '1px solid var(--border-strong, var(--border-subtle))',
              borderRadius: 8, color: 'var(--text-primary)', padding: '8px 14px', fontSize: '1rem', cursor: 'pointer'
            }}
          />
        </div>
        <div style={{ marginLeft: 8, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
          {rebalanceDate === new Date().toISOString().split('T')[0]
            ? '📡 实时价格（今天）'
            : '📅 历史价格（该日收盘价）'}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <button
          className="create-btn"
          style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          onClick={handleFetchWeights}
        >
          <Search size={15} /> 测算当前持仓权重
        </button>
        <button className="create-btn cancel" style={{ flex: 1 }} onClick={() => setShowRebalanceModal(false)}>
          ✕ 取消
        </button>
      </div>
    </div>
  );

  // ─────────────────────────────────────────────────────────────────
  //  SUB-STEP: loading
  // ─────────────────────────────────────────────────────────────────
  const renderLoading = () => (
    <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-secondary)' }}>
      <RefreshCw size={32} style={{ animation: 'spin 1s linear infinite', marginBottom: 16, color: 'var(--accent-secondary)' }} />
      <div>正在按 <strong style={{ color: 'var(--accent-secondary)' }}>{rebalanceDate}</strong> 的价格计算持仓权重…</div>
    </div>
  );

  // ─────────────────────────────────────────────────────────────────
  //  SUB-STEP: edit targets
  // ─────────────────────────────────────────────────────────────────
  const renderEditStep = () => (
    <div>
      {/* Date badge */}
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        background: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)',
        borderRadius: 20, padding: '4px 14px', marginBottom: 16, fontSize: '0.8rem'
      }}>
        <Calendar size={12} style={{ color: 'var(--accent-secondary)' }} />
        <span style={{ color: 'var(--text-secondary)' }}>基准日期：</span>
        <strong style={{ color: 'var(--accent-secondary)' }}>{rebalanceDate}</strong>
        <button
          onClick={() => { setSubStep('date'); setLiveWeights([]); }}
          style={{ background: 'none', border: 'none', color: 'var(--accent-color)', cursor: 'pointer', fontSize: '0.78rem', paddingLeft: 4, fontWeight: 600 }}
        >
          重新选择 ›
        </button>
      </div>

      {/* Table */}
      <div className="table-container" style={{ maxHeight: '340px', overflowY: 'auto', marginBottom: 14 }}>
        <table>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>资产</th>
              <th style={{ textAlign: 'right' }}>当前占比</th>
              <th style={{ textAlign: 'center', width: '160px' }}>目标比例 (%)</th>
            </tr>
          </thead>
          <tbody>
            {liveWeights.map(({ isin, name, weight_pct }) => {
              const targetVal = localTargets[isin] ?? '';
              const hasTarget = targetVal !== '' && parseFloat(targetVal) > 0;
              return (
                <tr key={isin}>
                  <td>
                    <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-primary)' }}>{name !== isin ? name : isin}</div>
                    <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', marginTop: 2 }}>{isin}</div>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{weight_pct}%</span>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        placeholder={String(weight_pct)}
                        value={targetVal}
                        onChange={e => handleWeightChange(isin, e.target.value)}
                        style={{
                          width: 78,
                          background: hasTarget ? 'rgba(var(--accent-secondary-rgb, 99, 102, 241), 0.12)' : 'var(--surface-inset, var(--surface-subtle))',
                          border: `1px solid ${hasTarget ? 'var(--accent-secondary)' : 'var(--border-subtle)'}`,
                          borderRadius: 6, color: hasTarget ? 'var(--accent-secondary)' : 'var(--text-primary)',
                          padding: '6px 8px', fontSize: '0.93rem', fontWeight: hasTarget ? 700 : 400,
                          textAlign: 'right',
                        }}
                      />
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>%</span>
                      {hasTarget && Math.abs(parseFloat(targetVal) - weight_pct) > 0.1 && (
                        <span style={{ 
                          fontSize: '0.75rem', 
                          fontWeight: 600,
                          marginLeft: 6,
                          width: '42px',
                          textAlign: 'left',
                          color: parseFloat(targetVal) > weight_pct ? 'var(--success, #10b981)' : 'var(--danger, #f43f5e)' 
                        }}>
                          {parseFloat(targetVal) > weight_pct ? 'BUY' : 'SELL'}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Weight total bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
        padding: '9px 16px', borderRadius: 8, fontSize: '0.84rem',
        background: weightOver ? 'rgba(244,63,94,0.1)' : weightUnder ? 'rgba(245,158,11,0.1)' : weightOk ? 'rgba(16,185,129,0.1)' : 'var(--surface-subtle)',
        border: `1px solid ${weightOver ? 'rgba(244,63,94,0.35)' : weightUnder ? 'rgba(245,158,11,0.35)' : weightOk ? 'rgba(16,185,129,0.35)' : 'var(--border-subtle)'}`,
      }}>
        <span style={{ color: 'var(--text-secondary)' }}>目标合计</span>
        <span style={{
          fontWeight: 700, fontSize: '1.1rem',
          color: weightOver ? 'var(--danger, #f43f5e)' : weightUnder ? 'var(--warning, #d97706)' : weightOk ? 'var(--success, #10b981)' : 'var(--text-muted)'
        }}>
          {r2(totalTargetPct)}%
        </span>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>/ 100%</span>
        {weightOver  && <span style={{ color: 'var(--danger, #f43f5e)' }}>超过 100%，请减少 {r2(totalTargetPct - 100)}%</span>}
        {weightUnder && <span style={{ color: 'var(--warning, #d97706)' }}>还差 <strong>{r2(100 - totalTargetPct)}%</strong>，权重之和必须等于 100%</span>}
        {weightOk    && <span style={{ color: 'var(--success, #10b981)' }}>✓ 已满 100%，可以计算</span>}
      </div>

      {/* Buttons */}
      <div style={{ display: 'flex', gap: 12 }}>
        <button
          className="create-btn"
          style={{
            flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            opacity: canSubmit ? 1 : 0.45, cursor: canSubmit ? 'pointer' : 'not-allowed',
          }}
          onClick={handleConfirm}
          disabled={!canSubmit}
          title={!weightOk ? `权重合计必须等于 100%（当前 ${r2(totalTargetPct)}%）` : ''}
        >
          {calculating
            ? <><RefreshCw size={15} style={{ animation: 'spin 1s linear infinite' }} /> 计算中…</>
            : <><ChevronRight size={15} /> 确认并计算再平衡</>
          }
        </button>
        <button className="create-btn cancel" style={{ flex: 1 }} onClick={() => setShowRebalanceModal(false)}>
          ✕ 取消
        </button>
      </div>
    </div>
  );

  // ─────────────────────────────────────────────────────────────────
  //  STEP 2: trade preview
  // ─────────────────────────────────────────────────────────────────
  const renderStep2 = () => {
    const rbCcy = rebalancePreview.base_currency || 'USD';
    const rbSym = getCurrencySymbol(rbCcy);
    const fmt   = v => `${rbSym}${Math.round(v).toLocaleString()}`;
    return (
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
          {[
            { label: `Total NAV (${rbCcy})`,  value: fmt(rebalancePreview.total_nav_base),   color: 'var(--success, #10b981)', bg: 'rgba(16,185,129,0.08)',  bdr: 'rgba(16,185,129,0.28)' },
            { label: `Cash Pool (${rbCcy})`,  value: fmt(rebalancePreview.total_cash_base),  color: 'var(--warning, #d97706)', bg: 'rgba(245,158,11,0.08)',  bdr: 'rgba(245,158,11,0.28)' },
            { label: 'Cash % of NAV',          value: `${rebalancePreview.cash_pct?.toFixed(1)}%`, color: 'var(--accent-secondary)', bg: 'rgba(168,85,247,0.08)', bdr: 'rgba(168,85,247,0.28)' },
          ].map(c => (
            <div key={c.label} style={{ background: c.bg, border: `1px solid ${c.bdr}`, borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.74rem', marginBottom: 4 }}>{c.label}</div>
              <div style={{ color: c.color, fontWeight: 700, fontSize: '1.05rem' }}>{c.value}</div>
            </div>
          ))}
        </div>

        {rebalancePreview.total_cash_base > 0 && (
          <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 8, padding: '9px 14px', marginBottom: 14, fontSize: '0.81rem', color: 'var(--text-secondary)' }}>
            💡 <strong style={{ color: 'var(--warning, #d97706)' }}>Dividend Cash:</strong> 闲置现金（含分红）已计入 NAV，BUY 指令将把现金部署回目标资产。
          </div>
        )}

        <p style={{ color: 'var(--text-secondary)', marginBottom: 14, fontSize: '0.82rem' }}>
          以 <strong style={{ color: 'var(--accent-secondary)' }}>{rebalancePreview.as_of_date || rebalanceDate}</strong> 价格计算所需交易：
        </p>

        <div className="table-container" style={{ maxHeight: '320px', overflowY: 'auto', marginBottom: 20 }}>
          <table>
            <thead>
              <tr>
                <th>资产</th><th>指令</th><th>股数</th><th>价格</th><th>金额</th><th>当前 → 目标</th>
              </tr>
            </thead>
            <tbody>
              {(rebalancePreview?.trades || []).map((t, i) => {
                const cash = t.is_cash;
                const sym  = getCurrencySymbol(t.currency || 'USD');
                const ac   = cash ? (t.action === 'DEPLOY' ? 'var(--warning, #d97706)' : 'var(--text-secondary)') : (t.action === 'BUY' ? 'var(--success, #10b981)' : 'var(--danger, #f43f5e)');
                return (
                  <tr key={i} style={cash ? { background: 'rgba(245,158,11,0.05)', borderTop: '1px solid rgba(245,158,11,0.2)' } : {}}>
                    <td>
                      <div style={{ fontWeight: 600, color: cash ? 'var(--warning, #d97706)' : 'var(--text-primary)' }}>{t.name || t.isin}</div>
                      <div className="isin-badge" style={cash ? { background: 'rgba(245,158,11,0.14)', color: 'var(--warning, #d97706)' } : {}}>{t.isin}</div>
                    </td>
                    <td><span style={{ color: ac, fontWeight: 700, background: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)', padding: '3px 8px', borderRadius: 5, fontSize: '0.81rem' }}>{t.action}</span></td>
                    <td style={{ color: cash ? 'var(--text-muted)' : 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                      {cash ? '—' : Number(t.shares || 0).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                    </td>
                    <td style={{ color: cash ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                      {cash ? '—' : `${sym}${t.price?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                    </td>
                    <td>
                      {cash ? (
                        <><span style={{ color: 'var(--warning, #d97706)', fontWeight: 600 }}>{sym}{t.amount?.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                        <div style={{ fontSize: '0.71rem', color: 'var(--text-muted)' }}>pool balance</div></>
                      ) : (
                        <>{sym}{t.amount?.toLocaleString()}
                        {t.currency !== 'USD' && t.amount_usd && <div style={{ fontSize: '0.71rem', color: 'var(--text-muted)' }}>≈ ${t.amount_usd?.toLocaleString()}</div>}</>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ color: cash ? 'var(--warning, #d97706)' : 'var(--text-secondary)', fontSize: '0.88rem' }}>{t.current_weight}%</span>
                        <span style={{ color: 'var(--text-muted)' }}>→</span>
                        <span style={{ fontWeight: 700, color: cash ? (t.target_weight < t.current_weight ? 'var(--success, #10b981)' : 'var(--text-secondary)') : 'var(--text-primary)' }}>{t.target_weight}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!rebalancePreview?.trades?.length && (
                <tr><td colSpan="6" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>✅ 组合已完全平衡，无需交易</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={() => { setRebalancePreview(null); setSubStep('edit'); }}
            style={{ background: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)', borderRadius: 8, color: 'var(--text-secondary)', padding: '10px 16px', cursor: 'pointer', fontSize: '0.84rem', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            ← 返回修改目标
          </button>
          <button className="create-btn" style={{ flex: 2 }} onClick={handleRebalanceExecute} disabled={!rebalancePreview?.trades?.filter(t => !t.is_cash).length}>
            ✓ 确认并执行交易
          </button>
          <button className="create-btn cancel" style={{ flex: 1 }} onClick={() => setShowRebalanceModal(false)}>✕ 取消</button>
        </div>
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────────
  //  Breadcrumb label
  // ─────────────────────────────────────────────────────────────────
  const breadcrumbs = [
    { key: 'date',  label: '① 选择日期' },
    { key: 'edit',  label: '② 设置目标' },
    { key: 'step2', label: '③ 交易预览' },
  ];
  const activeBC = isStep2 ? 'step2' : subStep === 'edit' ? 'edit' : 'date';

  return (
    <div className="modal-overlay">
      <div className="glass-card modal-content" style={{ maxWidth: '860px' }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
          <TrendingUp size={18} />
          <h3 style={{ margin: 0 }}>Rebalance</h3>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.77rem' }}>
            {breadcrumbs.map((b, i) => (
              <React.Fragment key={b.key}>
                {i > 0 && <ChevronRight size={10} style={{ color: 'var(--text-muted)' }} />}
                <span style={{
                  padding: '3px 10px', borderRadius: 20, fontWeight: 600,
                  background: activeBC === b.key ? 'rgba(var(--accent-color-rgb, 16, 185, 129), 0.14)' : 'var(--surface-subtle)',
                  color: activeBC === b.key ? 'var(--accent-color)' : 'var(--text-muted)',
                  border: `1px solid ${activeBC === b.key ? 'var(--accent-color)' : 'var(--border-subtle)'}`,
                }}>{b.label}</span>
              </React.Fragment>
            ))}
          </div>
        </div>

        {isStep2       ? renderStep2()
          : subStep === 'loading' ? renderLoading()
          : subStep === 'edit'    ? renderEditStep()
          : renderDateStep()}
      </div>
    </div>
  );
};

export default RebalanceModal;
