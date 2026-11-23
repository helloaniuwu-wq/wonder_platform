import React, { useState, useMemo } from 'react';
import { useLang } from '../i18n/langCore';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area, ComposedChart
} from 'recharts';
import {
  Activity, ArrowUpRight, Briefcase, Calendar, Camera, DollarSign, Edit3, MoreHorizontal, Settings, TrendingUp, Undo2
} from 'lucide-react';
import { COLORS, fmtMoney, fmtAxis, fmtCompact } from '../utils/currency';
import ILPSummaryCard from './ILPSummaryCard';
import { calcILPMonthlyFee, getEnrollmentBonusRate } from '../utils/ilpImpactUtils';

/**
 * PortfolioView — Nordic Gallery Minimal & Responsive Multi-Screen Edition.
 */
const PortfolioView = ({
  portfolios, activeId, data, historyData, loading,
  activeSubTab, setActiveSubTab,
  divProjData, divLoading, taxRate, setTaxRate, dripMode, setDripMode,
  sectorData, top10Data, getDaysUntil,
  setShowDivModal, setShowRenameModal, setRenameDraft,
  handleExportCSV, handleExportDividendsCSV,
  handleOpenCompModal, handleOpenManageDivModal,
  handleRebalancePreview, handleUndoRebalance,
  canEdit,
  ilpEnabled, ilpConfig,
  onOpenIlpEnrollmentModal,
}) => {
  const { t } = useLang();
  const ccy = data?.base_currency || 'USD';

  const [applyIlpToChart, setApplyIlpToChart] = useState(false);
  const [isLogScale, setIsLogScale] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  const ilpHistoryData = useMemo(() => {
    if (!applyIlpToChart || !ilpEnabled || !(ilpConfig?.totalPremium > 0) || historyData.length === 0) {
      return historyData;
    }
    const firstVal = historyData[0]?.value || 1;
    const effectivePremium = firstVal;
    const bonusRate = ilpConfig.enrollmentRate ?? getEnrollmentBonusRate(ilpConfig.totalPremium || effectivePremium);
    const enrollmentBonus = effectivePremium * bonusRate;
    const initialMultiplier = (firstVal + enrollmentBonus) / firstVal;
    let ilpMultiplier = initialMultiplier;

    return historyData.map((d, i) => {
      if (i > 0) {
        const growthFactor = firstVal > 0 ? d.value / firstVal : 1;
        const ilpAV = effectivePremium * growthFactor;
        const fees = calcILPMonthlyFee(i + 1, ilpAV, ilpConfig);
        const feeRate = ilpAV > 0 ? fees.netFee / ilpAV : 0;
        ilpMultiplier = ilpMultiplier * (1 - feeRate);
      }
      const ilp_value = Math.max(0, d.value * ilpMultiplier);
      return { ...d, ilp_value, raw_value: d.value, ilp_bonus: i === 0 ? enrollmentBonus : 0 };
    });
  }, [applyIlpToChart, ilpEnabled, ilpConfig, historyData]);

  const ilpSummary = useMemo(() => {
    if (!applyIlpToChart || ilpHistoryData.length === 0) return null;
    const first = ilpHistoryData[0];
    const last  = ilpHistoryData[ilpHistoryData.length - 1];
    const rawCagr = data?.annualized_return != null ? parseFloat(data.annualized_return) : 0;
    const drag = last?.raw_value > 0 ? ((last.raw_value - last.ilp_value) / last.raw_value) * 100 : 0;
    const ilpMultiplier = last?.raw_value > 0 && last?.ilp_value > 0 ? last.ilp_value / last.raw_value : 1;
    const ilpCagr = rawCagr * ilpMultiplier;
    const enrollmentBonus = first?.ilp_bonus ?? 0;
    return { rawFinal: last?.raw_value, ilpFinal: last?.ilp_value, rawCagr, ilpCagr, drag, enrollmentBonus };
  }, [applyIlpToChart, ilpHistoryData, data]);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', paddingTop: '100px', color: 'var(--text-secondary)' }}>
        <h2>{t('empty.analyzingData')}</h2>
      </div>
    );
  }
  if (!data || !data.details) return null;

  const activePfName = portfolios.find(p => p.id === activeId)?.name;
  const activeStrategy = portfolios.find(p => p.id === activeId)?.dividend_strategy;

  return (
    <div className="portfolio-view-scope">
      <header className="portfolio-hero-header">
        <div className="portfolio-hero-title-group">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <h1 className="portfolio-hero-title">
              {activePfName}
            </h1>
            {canEdit && (
              <button
                type="button"
                aria-label="Rename portfolio"
                title="Rename portfolio"
                onClick={() => { setRenameDraft(activePfName || ''); setShowRenameModal(true); }}
                className="action-btn-secondary"
                style={{ padding: '6px 8px' }}
              >
                <Edit3 size={15} aria-hidden="true" />
              </button>
            )}
          </div>

          <div className="header-subtitle">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <Calendar size={14} strokeWidth={2} aria-hidden="true" />
              {t('portfolio.strategyStart')}:
              <strong style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                {data.start_date}
              </strong>
            </span>
            <span style={{ color: 'var(--border-strong)' }}>·</span>
            <span>
              {t('portfolio.resultsAsOf')}:
              <strong style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontWeight: 600, marginLeft: '4px' }}>
                {data.report_date}
              </strong>
            </span>

            {data.wallet_balance !== undefined && (
              <span style={{
                background: 'var(--surface-subtle)',
                padding: '3px 10px',
                borderRadius: '4px',
                color: 'var(--accent-color)',
                fontFamily: 'var(--font-mono)',
                fontWeight: 600,
                fontSize: '0.82rem',
                border: '1px solid var(--border-subtle)',
              }}>
                {t('portfolio.wallet')}: {fmtMoney(data.wallet_balance, 1, ccy)}
              </span>
            )}
          </div>
        </div>

        <div className="portfolio-hero-actions">
          <div className="portfolio-hero-actions-row">
            {canEdit && (
              <>
                <button type="button" onClick={handleOpenCompModal} className="action-btn-secondary" title={t('portfolio.tradingManager')}>
                  <Briefcase size={14} aria-hidden="true" /> {t('portfolio.tradingManager')}
                </button>
                <button type="button" onClick={handleRebalancePreview} className="action-btn-secondary" title={t('portfolio.rebalance')}>
                  <TrendingUp size={14} aria-hidden="true" /> {t('portfolio.rebalance')}
                </button>
                <button type="button" onClick={handleUndoRebalance} className="action-btn-secondary" title={t('portfolio.undo')}>
                  <Undo2 size={14} aria-hidden="true" /> {t('portfolio.undo')}
                </button>
              </>
            )}

            {/* More Menu */}
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                aria-label="More export options"
                onClick={() => setShowMoreMenu(!showMoreMenu)}
                className="action-btn-secondary"
                style={{ padding: '6px 10px' }}
              >
                <MoreHorizontal size={16} aria-hidden="true" />
              </button>
              {showMoreMenu && (
                <div style={{
                  position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 100,
                  background: 'var(--surface-elevated)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: 'var(--card-radius)',
                  padding: '6px',
                  boxShadow: 'var(--card-shadow)',
                  minWidth: '175px',
                  display: 'flex', flexDirection: 'column', gap: '2px',
                }}>
                  <button
                    type="button"
                    onClick={() => { handleExportCSV(); setShowMoreMenu(false); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      padding: '8px 12px', background: 'transparent', border: 'none',
                      color: 'var(--text-primary)', cursor: 'pointer', textAlign: 'left',
                      fontSize: '0.84rem', borderRadius: '4px',
                    }}
                  >
                    <Camera size={14} aria-hidden="true" /> {t('portfolio.exportHoldings')}
                  </button>
                  <button
                    type="button"
                    onClick={() => { handleExportDividendsCSV(); setShowMoreMenu(false); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      padding: '8px 12px', background: 'transparent', border: 'none',
                      color: 'var(--text-primary)', cursor: 'pointer', textAlign: 'left',
                      fontSize: '0.84rem', borderRadius: '4px',
                    }}
                  >
                    <Camera size={14} aria-hidden="true" /> {t('portfolio.exportDiv')}
                  </button>
                </div>
              )}
            </div>
          </div>

          {canEdit && (
            <div className="portfolio-hero-actions-row">
              <button type="button" onClick={handleOpenManageDivModal} className="action-btn-secondary" title={t('portfolio.divManage')}>
                <Settings size={14} aria-hidden="true" /> {t('portfolio.divManage')}
              </button>
              <button
                type="button"
                onClick={() => setShowDivModal(true)}
                className="action-btn-secondary"
                style={{
                  background: 'rgba(var(--accent-color-rgb), 0.08)',
                  borderColor: 'var(--accent-color)',
                  color: 'var(--accent-color)',
                }}
              >
                <DollarSign size={14} aria-hidden="true" /> {t('portfolio.addDiv')}
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Sub-Tabs Navigation */}
      <div style={{
        display: 'flex',
        gap: '24px',
        marginBottom: '28px',
        borderBottom: '1px solid var(--border-subtle)',
      }}>
        <button
          type="button"
          onClick={() => setActiveSubTab('performance')}
          style={{
            padding: '0 4px 12px',
            background: 'transparent',
            border: 'none',
            borderBottom: activeSubTab === 'performance' ? '2px solid var(--accent-color)' : '2px solid transparent',
            color: activeSubTab === 'performance' ? 'var(--accent-color)' : 'var(--text-secondary)',
            cursor: 'pointer',
            fontWeight: activeSubTab === 'performance' ? 700 : 500,
            fontSize: '0.92rem',
            letterSpacing: '0.02em',
            transition: 'all 0.2s',
          }}
        >
          {t('portfolio.tabPerformance')}
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab('dividends')}
          style={{
            padding: '0 4px 12px',
            background: 'transparent',
            border: 'none',
            borderBottom: activeSubTab === 'dividends' ? '2px solid var(--accent-color)' : '2px solid transparent',
            color: activeSubTab === 'dividends' ? 'var(--accent-color)' : 'var(--text-secondary)',
            cursor: 'pointer',
            fontWeight: activeSubTab === 'dividends' ? 700 : 500,
            fontSize: '0.92rem',
            letterSpacing: '0.02em',
            transition: 'all 0.2s',
          }}
        >
          {t('portfolio.tabIncome')}
        </button>
      </div>

      {activeSubTab === 'performance' ? (
        <>
          {/* ILP 状态卡（紧凑模式） */}
          {ilpEnabled && ilpConfig && ilpConfig.totalPremium > 0 && (
            <ILPSummaryCard
              ilpConfig={ilpConfig}
              currentCV={data?.details?.reduce((sum, h) => sum + (h.market_value || 0), 0) || 0}
              currentMonth={0}
              compact={true}
              onEditConfig={onOpenIlpEnrollmentModal}
            />
          )}

          {/* Performance Over Time Chart */}
          <section className="glass-card" style={{ marginBottom: '28px', minHeight: '380px' }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '12px',
              marginBottom: '20px',
            }}>
              <div>
                <div className="stat-label" style={{ fontSize: '0.72rem', marginBottom: '2px' }}>01 / HISTORICAL TRAJECTORY</div>
                <h2 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 700 }}>{t('portfolio.performanceOverTime')}</h2>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                {historyData.length === 0 && (
                  <div style={{ fontSize: '0.84rem', color: 'var(--accent-color)' }}>
                    {t('portfolio.syncingData')}
                  </div>
                )}
                {historyData.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setIsLogScale(v => !v)}
                    className="action-btn-secondary"
                    style={{
                      padding: '5px 12px',
                      fontSize: '0.78rem',
                      background: isLogScale ? 'rgba(var(--accent-color-rgb), 0.1)' : 'var(--surface-subtle)',
                      borderColor: isLogScale ? 'var(--accent-color)' : 'var(--border-subtle)',
                      color: isLogScale ? 'var(--accent-color)' : 'var(--text-secondary)',
                    }}
                  >
                    {isLogScale ? 'Log Scale' : 'Linear Scale'}
                  </button>
                )}
                {ilpEnabled && ilpConfig?.totalPremium > 0 && historyData.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setApplyIlpToChart(v => !v)}
                    className="action-btn-secondary"
                    style={{
                      padding: '5px 12px',
                      fontSize: '0.78rem',
                      background: applyIlpToChart ? 'rgba(var(--accent-color-rgb), 0.1)' : 'var(--surface-subtle)',
                      borderColor: applyIlpToChart ? 'var(--accent-color)' : 'var(--border-subtle)',
                      color: applyIlpToChart ? 'var(--accent-color)' : 'var(--text-secondary)',
                    }}
                  >
                    {applyIlpToChart ? t('portfolio.ilpApplied') : t('portfolio.applyIlp')}
                  </button>
                )}
              </div>
            </div>

            <div style={{ height: '310px', width: '100%' }}>
              {historyData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  {applyIlpToChart ? (
                    <ComposedChart data={ilpHistoryData} margin={{ top: 10, right: 10, left: 4, bottom: 0 }}>
                      <defs>
                        <linearGradient id="rawColor" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor="#1E4D3B" stopOpacity={0.22}/>
                          <stop offset="95%" stopColor="#1E4D3B" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="ilpColor" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor="#9A6F38" stopOpacity={0.24}/>
                          <stop offset="95%" stopColor="#9A6F38" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                      <XAxis
                        dataKey="date"
                        stroke="var(--border-subtle)"
                        tick={{ fill: 'var(--chart-axis)', fontSize: 11, fontFamily: 'var(--font-mono)' }}
                        tickFormatter={(val) => val ? String(val).substring(0, 7) : ''}
                        minTickGap={40}
                      />
                      <YAxis
                        stroke="var(--border-subtle)"
                        tick={{ fill: 'var(--chart-axis)', fontSize: 11, fontFamily: 'var(--font-mono)' }}
                        scale={isLogScale ? 'log' : 'auto'}
                        domain={isLogScale ? ['auto', 'auto'] : [0, 'auto']}
                        tickFormatter={(val) => fmtAxis(Number(val), 1, ccy)}
                        width={65}
                      />
                      <Tooltip
                        content={({ active, payload, label }) => {
                          if (!active || !payload?.length) return null;
                          const raw = payload.find(p => p.dataKey === 'raw_value')?.value;
                          const ilp = payload.find(p => p.dataKey === 'ilp_value')?.value;
                          const drag = raw > 0 && ilp != null ? ((raw - ilp) / raw * 100).toFixed(2) : null;
                          return (
                            <div style={{
                              background: 'var(--tooltip-bg)',
                              border: '1px solid var(--tooltip-border)',
                              borderRadius: '6px',
                              padding: '12px 16px',
                              fontSize: '0.8rem',
                              minWidth: '210px',
                              boxShadow: 'var(--card-shadow)',
                            }}>
                              <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', marginBottom: '8px' }}>{label}</div>
                              {raw != null && (
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '14px', marginBottom: '4px' }}>
                                  <span style={{ color: 'var(--accent-color)' }}>{t('portfolio.ilpTooltipRaw')}</span>
                                  <span style={{ color: 'var(--accent-color)', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{fmtMoney(raw, 1, ccy)}</span>
                                </div>
                              )}
                              {ilp != null && (
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '14px', marginBottom: '4px' }}>
                                  <span style={{ color: 'var(--accent-secondary)' }}>{t('portfolio.ilpTooltipNet')}</span>
                                  <span style={{ color: 'var(--accent-secondary)', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{fmtMoney(ilp, 1, ccy)}</span>
                                </div>
                              )}
                              {drag != null && (
                                <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px dashed var(--border-subtle)', color: 'var(--text-secondary)', fontSize: '0.72rem' }}>
                                  {t('portfolio.ilpTooltipDrag')}：{drag}%
                                </div>
                              )}
                            </div>
                          );
                        }}
                      />
                      <Legend formatter={v => <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{v}</span>} />
                      <Area type="monotone" dataKey="raw_value" stroke="#1E4D3B" strokeWidth={2} name={t('portfolio.ilpTooltipRaw')} fill="url(#rawColor)" dot={false} />
                      <Area type="monotone" dataKey="ilp_value" stroke="#9A6F38" strokeWidth={2.2} strokeDasharray="4 3" fill="url(#ilpColor)" dot={false} name={t('portfolio.ilpTooltipNet')} />
                    </ComposedChart>
                  ) : (
                    <AreaChart data={historyData} margin={{ top: 10, right: 10, left: 4, bottom: 0 }}>
                      <defs>
                        <linearGradient id="navColor" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#1E4D3B" stopOpacity={0.28}/>
                          <stop offset="95%" stopColor="#1E4D3B" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                      <XAxis
                        dataKey="date"
                        stroke="var(--border-subtle)"
                        tick={{ fill: 'var(--chart-axis)', fontSize: 11, fontFamily: 'var(--font-mono)' }}
                        tickFormatter={(val) => val ? String(val).substring(0, 7) : ''}
                        minTickGap={40}
                      />
                      <YAxis
                        domain={isLogScale ? ['auto', 'auto'] : ([dataMin, dataMax]) => {
                          if (isNaN(dataMin) || isNaN(dataMax)) return [0, 1000];
                          if (dataMin === dataMax) {
                            if (dataMin === 0) return [0, 1000];
                            const padding = Math.abs(dataMin * 0.1);
                            return [dataMin - padding, dataMax + padding];
                          }
                          return [dataMin, dataMax];
                        }}
                        scale={isLogScale ? 'log' : 'auto'}
                        stroke="var(--border-subtle)"
                        tick={{ fill: 'var(--chart-axis)', fontSize: 11, fontFamily: 'var(--font-mono)' }}
                        tickFormatter={(val) => fmtAxis(Number(val), 1, ccy)}
                        width={60}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'var(--tooltip-bg)',
                          border: '1px solid var(--tooltip-border)',
                          borderRadius: '6px',
                          boxShadow: 'var(--card-shadow)',
                          color: 'var(--tooltip-text)',
                        }}
                        itemStyle={{ color: 'var(--accent-color)', fontWeight: 700, fontFamily: 'var(--font-mono)' }}
                        formatter={(value) => [fmtMoney(Number(value), 1, ccy), '资产市值']}
                        labelStyle={{ color: 'var(--text-secondary)', marginBottom: '6px', fontFamily: 'var(--font-mono)' }}
                      />
                      <Area type="monotone" dataKey="value" stroke="var(--accent-color)" strokeWidth={2.25} fill="url(#navColor)" animationDuration={1200} />
                    </AreaChart>
                  )}
                </ResponsiveContainer>
              ) : (
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  height: '100%', color: 'var(--text-muted)',
                  border: '1px dashed var(--border-subtle)', borderRadius: 'var(--card-radius)',
                }}>
                  {t('portfolio.buildingTimeSeries')}
                </div>
              )}
            </div>

            {/* ILP 对比摘要条 */}
            {applyIlpToChart && ilpSummary && (
              <div style={{
                marginTop: '16px', padding: '14px 16px', borderRadius: 'var(--card-radius)',
                background: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)',
              }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))', gap: '12px', marginBottom: '10px' }}>
                  {[
                    { label: '开户奖赏（期初计入）', val: `+${fmtMoney(ilpSummary.enrollmentBonus, 1, ccy)}`, color: 'var(--accent-secondary)', sub: 'ILP曲线期初高于原始曲线' },
                    { label: '当前原始市值', val: fmtMoney(ilpSummary.rawFinal, 1, ccy), color: 'var(--accent-color)' },
                    { label: '当前 ILP 净值', val: fmtMoney(ilpSummary.ilpFinal, 1, ccy), color: 'var(--info)' },
                    { label: '综合年化（含分红）', val: `${ilpSummary.rawCagr.toFixed(2)}%`, color: 'var(--text-primary)', sub: '与底部 CAGR 卡片一致' },
                    { label: 'ILP 综合年化（净值）', val: `${ilpSummary.ilpCagr.toFixed(2)}%`, color: 'var(--accent-secondary)', sub: '已扣除前期费/COI/户口费' },
                    { label: 'ILP 净值拖累', val: `${ilpSummary.drag >= 0 ? '-' : '+'}${Math.abs(ilpSummary.drag).toFixed(2)}%`, color: ilpSummary.drag >= 0 ? 'var(--danger)' : 'var(--success)' },
                  ].map((c, i) => (
                    <div key={i}>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: '4px' }}>{c.label}</div>
                      <div style={{ fontSize: '0.92rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: c.color }}>{c.val}</div>
                      {c.sub && <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginTop: '2px' }}>{c.sub}</div>}
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border-subtle)', paddingTop: '8px', lineHeight: 1.5 }}>
                  ILP 曲线期初值 = 组合初始投入 + 开户奖赏（以基金单位计入）· 之后逐月扣减前期费 / 户口价值费 / COI（账户价值 ≥ 保额后 COI = 0）· 第6年起享有长期客户奖赏
                </div>
              </div>
            )}
          </section>

          {/* 4 Core KPI Cards */}
          <section className="stats-grid">
            <div className="glass-card" title={fmtMoney(data.total_market_value || data.total_nav, 1, ccy)}>
              <div className="stat-label">
                {t('portfolio.statMarketValue')}
                <span style={{ fontSize: '0.68rem', color: 'var(--accent-color)', marginLeft: '6px', fontFamily: 'var(--font-mono)' }}>{ccy}</span>
              </div>
              <div className="stat-value">{fmtCompact(data.total_market_value || data.total_nav, 1, ccy)}</div>
              <div className="positive"><TrendingUp size={15} aria-hidden="true" /> {t('portfolio.statMarketValueSub')}</div>
            </div>
            <div className="glass-card">
              <div className="stat-label">
                Cumulative Return
                <span style={{ fontSize: '0.68rem', color: 'var(--accent-secondary)', marginLeft: '6px' }}>累计收益</span>
              </div>
              <div className="stat-value" style={{ color: 'var(--accent-secondary)' }}>{data.cumulative_roi}%</div>
              <div className="positive"><TrendingUp size={15} aria-hidden="true" /> Total ROI</div>
            </div>
            <div className="glass-card" title={fmtMoney(data.total_divs || 0, 1, ccy)}>
              <div className="stat-label">
                Total Dividends
                <span style={{ fontSize: '0.68rem', color: 'var(--info)', marginLeft: '6px', fontFamily: 'var(--font-mono)' }}>{ccy}</span>
              </div>
              <div className="stat-value" style={{ color: 'var(--info)' }}>{fmtCompact(data.total_divs || 0, 1, ccy)}</div>
              <div className="positive"><DollarSign size={15} aria-hidden="true" /> Passive Income</div>
            </div>
            <div className="glass-card">
              <div className="stat-label">Annualized Return</div>
              <div className="stat-value" style={{ color: 'var(--success)' }}>{data.annualized_return}%</div>
              <div className="positive"><TrendingUp size={15} aria-hidden="true" /> CAGR</div>
            </div>
          </section>

          {/* Intelligence Widgets (Sector Exposure + Top 10 Holdings) */}
          <section className="intel-grid">
            <div className="glass-card">
              <div className="stat-label" style={{ marginBottom: '18px' }}>02 / SECTOR EXPOSURE</div>
              <div style={{ height: '250px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={sectorData}
                      cx="50%"
                      cy="50%"
                      innerRadius={62}
                      outerRadius={84}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {sectorData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(val, name, props) => [
                        `${props.payload.pct.toFixed(1)}% ($${val.toLocaleString()})`,
                        name
                      ]}
                      contentStyle={{
                        backgroundColor: 'var(--tooltip-bg)',
                        border: '1px solid var(--tooltip-border)',
                        borderRadius: '6px',
                        fontSize: '0.8rem',
                        color: 'var(--tooltip-text)',
                      }}
                      itemStyle={{ color: 'var(--tooltip-text)', fontFamily: 'var(--font-mono)' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginTop: '12px' }}>
                {sectorData.map((entry, index) => (
                  <div key={index} style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: 9, height: 9, borderRadius: '2px', background: COLORS[index % COLORS.length] }} />
                    <span style={{ color: 'var(--text-primary)' }}>{entry.name}</span>
                    <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{entry.pct.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="glass-card">
              <div className="stat-label" style={{ marginBottom: '18px' }}>03 / {t('portfolio.top10Holdings')}</div>
              <div style={{ height: '250px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={top10Data}
                    layout="vertical"
                    margin={{ top: 0, right: 30, left: 0, bottom: 0 }}
                  >
                    <XAxis type="number" hide domain={[0, 'dataMax']} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={130}
                      tick={{ fill: 'var(--chart-axis)', fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      cursor={{ fill: 'var(--surface-subtle)' }}
                      contentStyle={{
                        backgroundColor: 'var(--tooltip-bg)',
                        border: '1px solid var(--tooltip-border)',
                        borderRadius: '6px',
                        fontSize: '0.8rem',
                        color: 'var(--tooltip-text)',
                      }}
                      itemStyle={{ color: 'var(--tooltip-text)', fontFamily: 'var(--font-mono)' }}
                      formatter={(val, name, props) => [
                        `${props.payload.pct.toFixed(1)}%  (${fmtMoney(val, 1, ccy)})`,
                        props.payload.fullName
                      ]}
                      labelFormatter={() => ''}
                    />
                    <Bar dataKey="value" radius={[0, 3, 3, 0]} barSize={14}>
                      {top10Data.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '12px' }}>
                {top10Data.map((entry, index) => (
                  <div key={index} style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <div style={{ width: 8, height: 8, borderRadius: '2px', background: COLORS[index % COLORS.length], flexShrink: 0 }} />
                    <span style={{ color: 'var(--text-secondary)' }}>{entry.name}</span>
                    <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{entry.pct.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Asset Holdings Table */}
          <section className="glass-card">
            <div className="stat-label" style={{ marginBottom: '16px' }}>
              04 / ASSET HOLDINGS ({activeStrategy} MODE)
            </div>
            <div className="table-container" role="region" aria-label="Asset Holdings Table" tabIndex={0}>
              <table>
                <thead>
                  <tr>
                    <th>ASSET / ISIN</th>
                    <th>ALLOCATION (%)</th>
                    <th>SHARES</th>
                    <th>AVG COST</th>
                    <th>PRICE</th>
                    <th>VALUE</th>
                    <th>DIVIDENDS</th>
                    <th>PNL</th>
                  </tr>
                </thead>
                <tbody>
                  {data.details.map((asset, i) => (
                    <tr key={asset.isin}>
                      <td style={asset.isin.startsWith('CASH_') ? { background: 'var(--surface-subtle)' } : undefined}>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span style={{
                            color: asset.isin.startsWith('CASH_') ? 'var(--accent-color)' : COLORS[i % COLORS.length],
                            fontWeight: 700,
                          }}>
                            {asset.name}
                          </span>
                          <span className="isin-badge">{asset.isin}</span>
                        </div>
                      </td>
                      <td style={{ fontWeight: 700, color: 'var(--accent-color)', fontFamily: 'var(--font-mono)' }}>
                        {(asset.market_value / data.total_nav * 100).toFixed(1)}%
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>
                        {asset.isin.startsWith('CASH_') ? asset.shares.toLocaleString() : Math.floor(asset.shares)}
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>
                        {asset.total_cost ? fmtMoney(asset.total_cost / (asset.isin.startsWith('CASH_') ? 1 : asset.shares), 1, ccy) : '-'}
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{fmtMoney(asset.price, 1, ccy)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{fmtMoney(asset.market_value, 1, ccy)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{fmtMoney(asset.dividends, 1, ccy)}</td>
                      <td>
                        <span className={asset.yield >= 0 ? 'positive' : 'negative'} style={{ fontFamily: 'var(--font-mono)' }}>
                          {asset.yield >= 0 ? '+' : ''}{asset.yield.toFixed(2)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <div className="dividend-analytics">
          {/* Toolbar */}
          <div style={{ display: 'flex', gap: '20px', marginBottom: '24px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', fontWeight: 600 }}>{t('portfolio.withholdingTax')}:</label>
              <select
                className="atelier-select"
                style={{ width: 'auto', padding: '6px 12px' }}
                value={taxRate}
                onChange={e => setTaxRate(parseFloat(e.target.value))}
              >
                <option value={0.0}>Gross (0%)</option>
                <option value={0.30}>US (30%)</option>
                <option value={0.20}>China (20%)</option>
                <option value={0.10}>China R (10%)</option>
              </select>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', fontWeight: 600 }}>{t('portfolio.dripSimulation')}:</label>
              <label className="switch">
                <input type="checkbox" checked={dripMode} onChange={e => setDripMode(e.target.checked)} />
                <span className="slider round"></span>
              </label>
            </div>
          </div>

          {divLoading ? (
            <div style={{ textAlign: 'center', padding: '80px', color: 'var(--text-secondary)' }}>
              <h2>{t('portfolio.calcProjections')}</h2>
            </div>
          ) : divProjData && (divProjData.portfolio_metrics?.total_annual_income > 0 || divProjData.assets?.some(a => a.est_annual_income > 0 || a.source === 'manual_extrapolation')) ? (
            <>
              {/* Dividend Summary Cards */}
              <section className="stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                <div className="glass-card" title={fmtMoney(divProjData?.portfolio_metrics?.total_annual_income || 0, 1, ccy)}>
                  <div className="stat-label">{t('portfolio.estAnnualIncome')} <span style={{ fontSize: '0.68rem', color: 'var(--accent-color)', marginLeft: '4px' }}>{ccy}</span></div>
                  <div className="stat-value" style={{ color: 'var(--accent-color)' }}>{fmtCompact(divProjData?.portfolio_metrics?.total_annual_income || 0, 1, ccy)}</div>
                  <div className="positive"><DollarSign size={15} aria-hidden="true" /> {t('portfolio.projected12m')}</div>
                </div>
                <div className="glass-card">
                  <div className="stat-label">{t('portfolio.portfolioYoc')}</div>
                  <div className="stat-value" style={{ color: 'var(--accent-secondary)' }}>{divProjData?.portfolio_metrics?.portfolio_yoc || '0'}%</div>
                  <div className="positive"><ArrowUpRight size={15} aria-hidden="true" /> {t('portfolio.yieldOnCost')}</div>
                </div>
                <div className="glass-card">
                  <div className="stat-label">{t('portfolio.currentYield')}</div>
                  <div className="stat-value" style={{ color: 'var(--info)' }}>{divProjData?.portfolio_metrics?.portfolio_current_yield || '0'}%</div>
                  <div className="positive"><Activity size={15} aria-hidden="true" /> {t('portfolio.marketPricing')}</div>
                </div>
              </section>

              {/* Projection Chart */}
              <section className="glass-card" style={{ marginBottom: '28px' }}>
                {divProjData.historical_dividends && (
                  <div style={{ marginBottom: '28px' }}>
                    <div className="stat-label" style={{ fontSize: '0.82rem', color: 'var(--text-primary)', marginBottom: '16px' }}>
                      01 / DIVIDEND HISTORY
                    </div>

                    {divProjData.historical_dividends.monthly?.length > 0 && (
                      <>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '10px', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                          Past 12 Months (by month)
                        </div>
                        <div style={{ height: '200px', width: '100%', marginBottom: '24px' }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={divProjData.historical_dividends.monthly}>
                              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                              <XAxis dataKey="month" stroke="var(--border-subtle)" tick={{ fill: 'var(--chart-axis)', fontSize: 10, fontFamily: 'var(--font-mono)' }} />
                              <YAxis
                                stroke="var(--border-subtle)"
                                tick={{ fill: 'var(--chart-axis)', fontSize: 10, fontFamily: 'var(--font-mono)' }}
                                tickFormatter={(val) => fmtAxis(Number(val), 1, ccy)}
                              />
                              <Tooltip
                                cursor={{ fill: 'var(--surface-subtle)' }}
                                contentStyle={{
                                  backgroundColor: 'var(--tooltip-bg)',
                                  border: '1px solid var(--tooltip-border)',
                                  borderRadius: '6px',
                                  fontSize: '0.82rem',
                                  color: 'var(--tooltip-text)',
                                }}
                                formatter={(val) => [fmtMoney(Number(val), 1, ccy), 'Received']}
                              />
                              <Bar dataKey="amount" fill="var(--accent-color)" radius={[3, 3, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </>
                    )}

                    {divProjData.historical_dividends.annual?.length > 0 && (
                      <>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '10px', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                          Previous Calendar Years (Full Year Total)
                        </div>
                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '8px' }}>
                          {divProjData.historical_dividends.annual.map(yr => (
                            <div key={yr.year} style={{
                              flex: '1', minWidth: '110px', maxWidth: '170px',
                              padding: '12px 14px', borderRadius: 'var(--card-radius)',
                              background: 'var(--surface-subtle)',
                              border: '1px solid var(--border-subtle)',
                            }}>
                              <div style={{ fontSize: '0.7rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginBottom: '6px' }}>{yr.year}</div>
                              <div style={{ fontSize: '1rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--accent-secondary)' }}>
                                {fmtMoney(yr.amount, 1, ccy)}
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}

                    <div style={{ borderTop: '1px solid var(--border-subtle)', marginTop: '24px' }} />
                  </div>
                )}

                <div className="stat-label" style={{ fontSize: '0.82rem', color: 'var(--text-primary)', marginBottom: '18px' }}>
                  02 / 12-MONTH EXPECTED CASH FLOW
                </div>

                <div style={{ height: '290px', width: '100%' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={divProjData.chart_data}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                      <XAxis dataKey="month" stroke="var(--border-subtle)" tick={{ fill: 'var(--chart-axis)', fontSize: 11, fontFamily: 'var(--font-mono)' }} />
                      <YAxis
                        stroke="var(--border-subtle)"
                        tick={{ fill: 'var(--chart-axis)', fontSize: 11, fontFamily: 'var(--font-mono)' }}
                        tickFormatter={(val) => fmtAxis(Number(val), 1, ccy)}
                      />
                      <Tooltip
                        cursor={{ fill: 'var(--surface-subtle)' }}
                        contentStyle={{
                          backgroundColor: 'var(--tooltip-bg)',
                          border: '1px solid var(--tooltip-border)',
                          borderRadius: '6px',
                          color: 'var(--tooltip-text)',
                        }}
                        formatter={(val) => [fmtMoney(Number(val), 1, ccy), 'Expected Dividend']}
                      />
                      <Bar dataKey="amount" fill="var(--accent-color)" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>

              {/* Assets Dividend Breakdown Table */}
              <section className="glass-card">
                <div className="stat-label" style={{ marginBottom: '16px' }}>03 / ASSET DIVIDEND BREAKDOWN</div>
                <div className="table-container" role="region" aria-label="Asset Dividend Breakdown" tabIndex={0}>
                  <table>
                    <thead>
                      <tr>
                        <th>ASSET / NAME</th>
                        <th>SHARES</th>
                        <th title="Yield on Cost: Based on your average purchase price">YIELD ON COST (YOC)</th>
                        <th title="Current Yield: Based on today's market price">CURRENT YIELD</th>
                        <th>EST. ANNUAL INCOME</th>
                        <th>NEXT DIVIDEND</th>
                      </tr>
                    </thead>
                    <tbody>
                      {divProjData.assets.map((asset, i) => (
                        <tr key={asset.isin}>
                          <td>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <span style={{ color: COLORS[i % COLORS.length], fontWeight: 700 }}>{asset.name}</span>
                              <span className="isin-badge">{asset.isin}</span>
                            </div>
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)' }}>{Math.floor(asset.shares)}</td>
                          <td style={{ fontWeight: 700, color: 'var(--accent-color)', fontFamily: 'var(--font-mono)' }}>
                            {asset.yoc}%
                            {asset.source === 'manual_extrapolation' && (
                              <span
                                title={`Extrapolated from manual history. Frequency: ${asset.manual_freq}. Assumed growth: ${asset.manual_growth_pct ?? 0}% per period.`}
                                style={{
                                  marginLeft: '6px',
                                  background: 'var(--warning-bg)',
                                  color: 'var(--warning)',
                                  fontSize: '0.65rem',
                                  padding: '1px 5px',
                                  borderRadius: '4px',
                                  cursor: 'help',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                ★ Manual Est.
                              </span>
                            )}
                          </td>
                          <td style={{ fontWeight: 700, color: 'var(--accent-secondary)', fontFamily: 'var(--font-mono)' }}>{asset.current_yield}%</td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{fmtMoney(asset.est_annual_income, 1, ccy)}</td>
                          <td>
                            {asset.next_date ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <span style={{
                                  color: 'var(--success)',
                                  background: 'var(--success-bg)',
                                  padding: '3px 8px',
                                  borderRadius: '4px',
                                  fontSize: '0.78rem',
                                  fontFamily: 'var(--font-mono)',
                                  width: 'fit-content',
                                }}>
                                  {asset.next_date}
                                </span>
                                {getDaysUntil(asset.next_date) !== null && getDaysUntil(asset.next_date) >= 0 && (
                                  <span style={{ color: 'var(--accent-secondary)', fontSize: '0.72rem', fontWeight: 600 }}>
                                    Ex-div in {getDaysUntil(asset.next_date)} days
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>TBD / TTM Shifted</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {divProjData.assets?.some(a => a.source === 'manual_extrapolation') && (
                  <div style={{
                    marginTop: '16px', padding: '12px 16px',
                    background: 'var(--warning-bg)', borderLeft: '3px solid var(--warning)',
                    borderRadius: '0 6px 6px 0', fontSize: '0.82rem', color: 'var(--text-secondary)',
                    lineHeight: 1.6,
                  }}>
                    <span style={{ color: 'var(--warning)', fontWeight: 700 }}>★ Manual Extrapolation</span>
                    {' — Assets marked with ★ have no automatic dividend feed (e.g. LU-ISIN funds). '}
                    Projected payouts are extrapolated from your manually recorded dividends based on detected payment frequency and historical growth rate.
                    <br/>
                    {divProjData.assets
                      .filter(a => a.source === 'manual_extrapolation')
                      .map(a => (
                        <span key={a.isin} style={{ display: 'inline-block', marginTop: '4px', marginRight: '12px' }}>
                          <strong style={{ color: 'var(--text-primary)' }}>{a.name}</strong>:
                          {' '}{a.manual_freq} payments,
                          {' '}{a.manual_growth_pct !== null ? `${a.manual_growth_pct > 0 ? '+' : ''}${a.manual_growth_pct}% growth/period assumed` : 'flat rate assumed'}
                        </span>
                      ))
                    }
                  </div>
                )}
              </section>
            </>
          ) : (
            <div style={{
              textAlign: 'center', padding: '64px 28px',
              background: 'var(--surface-card)', borderRadius: 'var(--card-radius)',
              border: '1px dashed var(--border-strong)',
            }}>
              <h3 style={{ color: 'var(--text-primary)', marginBottom: '8px', fontSize: '1.35rem' }}>{t('portfolio.noDivTitle')}</h3>
              <p style={{ color: 'var(--text-secondary)', maxWidth: '480px', margin: '0 auto 20px', fontSize: '0.9rem', lineHeight: 1.6 }}>
                This portfolio's holdings (e.g. LU-ISIN funds) are not covered by the automatic dividend data source (yfinance).
                {canEdit && <><br/>You can manually record dividends using the <strong style={{ color: 'var(--accent-color)' }}>Add Dividend</strong> button above.</>}
              </p>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => setShowDivModal(true)}
                  className="create-btn"
                >
                  {t('portfolio.addManualDiv')}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PortfolioView;
