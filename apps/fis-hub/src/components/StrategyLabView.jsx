import React from 'react';
import { useLang } from '../i18n/langCore';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line, Area, ComposedChart, ReferenceLine
} from 'recharts';
import {
  AlertTriangle, HelpCircle, History, Info, Plus, Search, Target, Trash2, Zap, FileText, Bookmark
} from 'lucide-react';
import InsurancePlanPanel from './InsurancePlanPanel';
import ILPConfigPanel from './ILPConfigPanel';
import ClassicPortfoliosModal from './modals/ClassicPortfoliosModal';
import { CLASSIC_PORTFOLIOS, toLabTemplate } from '../data/classicPortfolios';
import ILPSummaryCard from './ILPSummaryCard';
import ILPImpactPanel from './ILPImpactPanel';
import NumberInputWithCommas from './NumberInput';
import { CombinedCashFlowTooltip } from '../utils/chartHelpers';

/**
 * StrategyLabView — Nordic Gallery Minimal & Responsive Multi-Screen Edition.
 * Preserves 100% of calculations, props, and data contracts.
 */
// 单个组合的「配置卡片」：关键指标 + 权重明细 + 部署按钮。
// 自定义模式展示 1 张（自定义配置），自动优化模式展示 3 张（最大夏普 / 最小波动 / 风险平价）。
const AllocationCard = ({ portfolio, name, color, onDeploy }) => {
  const { t } = useLang();
  return (
            <div className="glass-card" style={{ borderTop: `3px solid ${color}`, marginBottom: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h3 style={{ margin: 0, color: color, fontSize: '1.2rem' }}>{name}</h3>
                <button type="button" onClick={() => onDeploy(portfolio.allocations)} className="action-btn-secondary" style={{ fontSize: '0.76rem' }}>
                  {t('lab.deploy')}
                </button>
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: '8px',
                marginBottom: '14px',
                fontSize: '0.74rem',
                color: 'var(--text-secondary)',
                background: 'var(--surface-subtle)',
                border: '1px solid var(--border-subtle)',
                padding: '12px',
                borderRadius: 'var(--card-radius)',
              }}>
                <div style={{ textAlign: 'center' }}>
                  <div>{t('lab.annualReturn')}</div>
                  <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--success)', marginTop: '4px', fontSize: '0.9rem' }}>
                    {((portfolio.expected_return || 0) * 100).toFixed(1)}%
                  </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div>{t('lab.volatility')}</div>
                  <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--warning)', marginTop: '4px', fontSize: '0.9rem' }}>
                    {((portfolio.volatility || 0) * 100).toFixed(1)}%
                  </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div>{t('lab.sharpeRatio')}</div>
                  <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', marginTop: '4px', fontSize: '0.9rem' }}>
                    {portfolio.sharpe_ratio?.toFixed(2)}
                  </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div>{t('lab.divYieldLabel')}</div>
                  <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--info)', marginTop: '4px', fontSize: '0.9rem' }}>
                    {((portfolio.dividend_yield || 0) * 100).toFixed(2)}%
                  </div>
                </div>
              </div>
              <div style={{ background: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)', padding: '12px 14px', borderRadius: 'var(--card-radius)' }}>
                {Object.entries(portfolio.allocations || {}).sort((a,b) => b[1] - a[1]).map(([isin, w]) => {
                  const numW = parseFloat(w) || 0;
                  const pctW = numW > 1.001 ? numW : numW * 100;
                  return (
                    <div key={isin} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.84rem', fontFamily: 'var(--font-mono)', padding: '4px 0', borderBottom: '1px dashed var(--border-subtle)' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>{isin}</span>
                      <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{pctW.toFixed(1)}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
  );
};

// 工具栏里直接展示的快捷模板（其余在「经典组合库」弹窗中）
const QUICK_TEMPLATE_IDS = ['all-weather', 'sixty-forty', 'golden-butterfly'];

const StrategyLabView = ({
  labIsins = [], labInput, setLabInput,
  labData, labLoading, labError,
  labDaysBack, setLabDaysBack,
  labMaxWeight, setLabMaxWeight,
  labMode, setLabMode,
  labCustomWeights = {}, setLabCustomWeights,
  labTab, setLabTab,
  labChartFontSize, setLabChartFontSize,
  labMcSettings: rawLabMcSettings, setLabMcSettings,
  insuranceEnabled, setInsuranceEnabled,
  insurancePlan, setInsurancePlan,
  insuranceAlphaLow, setInsuranceAlphaLow,
  insuranceAlphaHigh, setInsuranceAlphaHigh,
  saveDialogOpen, setSaveDialogOpen,
  scenarioName, setScenarioName,
  scenarioSaving,
  setShowMcDoc,
  handleAddLabIsin, handleRemoveLabIsin,
  handleRunLabAnalysis, handleDeployLabStrategy,
  handleSaveScenario, applyLabTemplate,
  handleGenerateReport,
  labSum, isLabReady,
  ilpEnabled, setIlpEnabled,
  ilpConfig, setIlpConfig,
  onOpenIlpEnrollmentModal,
}) => {
  const labMcSettings = rawLabMcSettings || {
    capital: 1000000,
    contribution: 0,
    contribution_start: 1,
    contribution_years: 10,
    withdrawal: 0,
    withdrawal_start: 1,
    withdrawal_end: 30,
    withdrawal_2: 0,
    withdrawal_start_2: 31,
    withdrawal_end_2: 60,
    withdrawal_inflation: false,
    years: 30,
    target: 2000000,
    stress: false,
    inflation: 2.5,
  };
  const { t, lang } = useLang();
  const [showClassicLibrary, setShowClassicLibrary] = React.useState(false);
  const [showDivDoc, setShowDivDoc] = React.useState(false);
  const [showDdDoc, setShowDdDoc] = React.useState(false);

  // 套用经典组合：转成实验室模板（美股版）并关闭弹窗；applyLabTemplate 会同时切到自定义权重模式
  // 结果区展示哪些组合：自定义模式 = 自定义配置一列；自动优化模式 = 优化器给出的三个组合
  const resultPortfolios = !labData ? [] : labData.custom_portfolio
    ? [{ key: 'custom_portfolio', name: t('lab.customAllocation'), color: 'var(--accent-color)' }]
    : [
        { key: 'max_sharpe', name: t('lab.maxSharpe'), color: 'var(--accent-color)' },
        { key: 'min_volatility', name: t('lab.minVolatility'), color: 'var(--info)' },
        { key: 'risk_parity', name: t('lab.riskParity'), color: 'var(--accent-secondary)' },
      ].filter(p => labData[p.key]);

  const handleApplyClassic = (portfolio, variant = 'us') => {
    const tpl = toLabTemplate(portfolio, variant);
    if (!tpl) return;
    applyLabTemplate(tpl.isins, tpl.weights);
    setShowClassicLibrary(false);
  };

  const inputBoxStyle = {
    background: 'var(--surface-card)',
    border: '1px solid var(--border-strong)',
    color: 'var(--text-primary)',
    borderRadius: '4px',
    padding: '6px 8px',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.86rem',
  };

  return (
    <>
      <ClassicPortfoliosModal
        open={showClassicLibrary}
        onClose={() => setShowClassicLibrary(false)}
        onApply={handleApplyClassic}
      />
      <div className="strategy-lab-scope" style={{ maxWidth: '1240px' }}>
        <header className="portfolio-hero-header">
          <div className="portfolio-hero-title-group">
            <h1 className="portfolio-hero-title" style={{ marginBottom: '8px' }}>{t('lab.title')}</h1>
            <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '0.94rem' }}>{t('lab.subtitle')}</p>
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: '1.35rem',
              letterSpacing: '0.12em',
              color: 'var(--accent-color)',
              border: '1px solid var(--border-strong)',
              padding: '4px 12px',
              borderRadius: '4px',
              background: 'var(--surface-card)',
            }}>
              WONDER <span style={{ fontStyle: 'italic', fontWeight: 500, color: 'var(--accent-secondary)' }}>Atelier</span>
            </div>
          </div>
        </header>

        {/* ── Asset Sandbox Card ── */}
        <div className="glass-card" style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '16px' }}>
            <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.25rem' }}>
              <Target size={18} style={{ color: 'var(--accent-color)' }} aria-hidden="true" />
              {t('lab.assetSandbox')}
            </h3>
            <div role="group" aria-label={t('lab.modeLabel')} className="lab-segmented">
              <button type="button" aria-pressed={labMode === 'auto'} onClick={() => setLabMode('auto')}>
                {t('lab.modeAuto')}
              </button>
              <button type="button" aria-pressed={labMode === 'custom'} onClick={() => setLabMode('custom')}>
                {t('lab.modeCustom')}
              </button>
            </div>
          </div>

          <div className="lab-asset-grid">
            {labIsins.map(isin => {
              const stats = labData?.asset_stats?.[isin];
              return (
                <div
                  key={isin}
                  style={{
                    background: 'var(--surface-subtle)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-subtle)',
                    borderTop: '2px solid var(--accent-color)',
                    padding: '12px 14px',
                    borderRadius: 'var(--card-radius)',
                    fontSize: '0.85rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontWeight: 700, fontSize: '1.05rem', fontFamily: 'var(--font-mono)', color: 'var(--accent-color)' }}>{isin}</span>
                        {stats?.asset_class && (
                          <span style={{
                            fontSize: '0.66rem',
                            padding: '1px 5px',
                            borderRadius: '3px',
                            background: 'var(--surface-raised)',
                            border: '1px solid var(--border-subtle)',
                            color: 'var(--accent-secondary)',
                            fontWeight: 500,
                            whiteSpace: 'nowrap'
                          }}>
                            {stats.asset_class}
                          </span>
                        )}
                      </div>
                      {stats && (
                        <span style={{
                          fontSize: '0.7rem',
                          color: 'var(--text-muted)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}>
                          {stats.name}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      aria-label={`Remove ${isin}`}
                      onClick={() => handleRemoveLabIsin(isin)}
                      className="action-icon"
                      style={{ background: 'transparent', border: 'none', padding: '2px', minBlockSize: '24px', minInlineSize: '24px' }}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  </div>

                  {stats && (
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '0.74rem',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--text-primary)',
                      borderTop: '1px solid var(--border-subtle)',
                      paddingTop: '6px',
                      marginTop: '2px',
                    }}>
                      <div style={{ display: 'flex', flexDirection: 'column' }} title={stats.raw_return !== undefined ? `校准后预期: ${(stats.expected_return * 100).toFixed(1)}% (回测原始样本: ${(stats.raw_return * 100).toFixed(1)}%)` : undefined}>
                        <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>Mean</span>
                        <span style={{ color: stats.expected_return >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>
                          {(stats.expected_return * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', textAlign: 'center' }}>
                        <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>Std Dev</span>
                        <span>{(stats.volatility * 100).toFixed(1)}%</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', textAlign: 'right' }}>
                        <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>Div Yield</span>
                        <span style={{ color: 'var(--info)', fontWeight: 600 }}>
                          {stats.dividend_yield !== undefined ? (stats.dividend_yield * 100).toFixed(1) + '%' : '-'}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Weight input — 自动优化模式下由优化器决定，不显示输入 */}
                  {labMode === 'auto' ? (
                    <div style={{
                      marginTop: 'auto',
                      borderTop: '1px solid var(--border-subtle)',
                      paddingTop: '8px',
                      fontSize: '0.72rem',
                      color: 'var(--text-muted)',
                      fontStyle: 'italic',
                    }}>
                      {t('lab.autoWeightByOptimizer')}
                    </div>
                  ) : (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '6px',
                    marginTop: 'auto',
                    borderTop: '1px solid var(--border-subtle)',
                    paddingTop: '8px',
                  }}>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Weight</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <input
                        type="number"
                        min="0" max="100" step="10"
                        placeholder="0"
                        value={labCustomWeights[isin] !== undefined ? labCustomWeights[isin] : ''}
                        onChange={e => setLabCustomWeights({ ...labCustomWeights, [isin]: e.target.value })}
                        style={{
                          ...inputBoxStyle,
                          width: '68px',
                          textAlign: 'right',
                        }}
                      />
                      <span style={{ fontSize: '0.8rem', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>%</span>
                    </div>
                  </div>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', fontWeight: 600 }}>{t('lab.template')}:</span>
              {QUICK_TEMPLATE_IDS.map((id) => {
                const p = CLASSIC_PORTFOLIOS.find((x) => x.id === id);
                return (
                  <button key={id} type="button" onClick={() => handleApplyClassic(p)}
                    className="action-btn-secondary" style={{ fontSize: '0.76rem', padding: '4px 10px' }}>
                    {p.name[lang]}
                  </button>
                );
              })}
              <button type="button" onClick={() => setShowClassicLibrary(true)}
                className="action-btn-secondary" style={{ fontSize: '0.76rem', padding: '4px 10px', borderStyle: 'dashed' }}>
                {t('lab.classicMore')}
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginLeft: 'auto', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', fontWeight: 600 }}>{t('lab.cmaMode')}:</span>
                <select
                  value={labMcSettings.cma_mode || 'shrunk'}
                  onChange={e => setLabMcSettings({ ...labMcSettings, cma_mode: e.target.value })}
                  className="atelier-select"
                  style={{ width: 'auto', padding: '4px 10px', fontSize: '0.8rem' }}
                  title="预测收益率校准模型"
                >
                  <option value="shrunk">{t('lab.cmaShrunk')}</option>
                  <option value="ltcma">{t('lab.cmaLtcma')}</option>
                  <option value="raw">{t('lab.cmaRaw')}</option>
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', fontWeight: 600 }}>{t('lab.backtestPeriod')}:</span>
                <select
                  value={labDaysBack}
                  onChange={e => setLabDaysBack(parseInt(e.target.value))}
                  className="atelier-select"
                  style={{ width: 'auto', padding: '4px 10px', fontSize: '0.8rem' }}
                >
                  <option value={1825}>{t('lab.years') === 'Years' ? '5 Years' : '5年'}</option>
                  <option value={3650}>{t('lab.years') === 'Years' ? '10 Years' : '10年'}</option>
                  <option value={5475}>{t('lab.years') === 'Years' ? '15 Years' : '15年'}</option>
                </select>
              </div>
            </div>
            {labMode === 'auto' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }} title={t('lab.autoHint')}>
                <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', fontWeight: 600 }}>{t('lab.maxWeight')}:</span>
                <select
                  value={labMaxWeight}
                  onChange={e => setLabMaxWeight(parseFloat(e.target.value))}
                  className="atelier-select"
                  style={{ width: 'auto', padding: '4px 10px', fontSize: '0.8rem' }}
                >
                  {[0.2, 0.25, 0.3, 0.35, 0.4, 0.5].map(v => (
                    <option key={v} value={v}>{Math.round(v * 100)}%</option>
                  ))}
                  <option value={1}>{t('lab.maxWeightNone')}</option>
                </select>
              </div>
            )}
            {labMode === 'custom' && labSum > 0 && (
              <div style={{
                fontSize: '0.78rem',
                fontFamily: 'var(--font-mono)',
                fontWeight: 600,
                padding: '4px 10px',
                borderRadius: '4px',
                background: Math.abs(labSum - 100) < 0.5 ? 'var(--success-bg)' : 'var(--warning-bg)',
                color: Math.abs(labSum - 100) < 0.5 ? 'var(--success)' : 'var(--warning)',
                border: `1px solid ${Math.abs(labSum - 100) < 0.5 ? 'var(--success)' : 'var(--warning)'}`,
              }}>
                {t('lab.totalWeight')}: {labSum}%{Math.abs(labSum - 100) < 0.5 ? ' ✓' : ` (${t('lab.mustBe100')})`}
              </div>
            )}
          </div>

          <form onSubmit={handleAddLabIsin} style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <input
              value={labInput}
              onChange={e => setLabInput(e.target.value)}
              placeholder={t('lab.isinPlaceholder')}
              className="atelier-input"
              style={{ flex: '1 1 200px', maxWidth: '320px' }}
            />
            <button
              type="submit"
              className="action-btn-secondary"
              disabled={labLoading}
            >
              <Plus size={16} aria-hidden="true" /> {t('lab.addAsset')}
            </button>
            <button
              type="button"
              onClick={handleRunLabAnalysis}
              className="create-btn"
              style={{
                opacity: isLabReady ? 1 : 0.45,
                cursor: isLabReady ? 'pointer' : 'not-allowed',
              }}
              disabled={labLoading || !isLabReady}
            >
              {labLoading ? `${t('lab.analyzing')} ${Math.round(labDaysBack/365)}...` : <><Zap size={16} aria-hidden="true" /> {t('lab.runOptimization')}</>}
            </button>
          </form>

          {labError && (
            <div style={{
              color: 'var(--danger)',
              background: 'var(--danger-bg)',
              border: '1px solid var(--danger)',
              padding: '10px 14px',
              borderRadius: 'var(--card-radius)',
              marginTop: '14px',
              fontSize: '0.85rem',
            }}>
              {labError}
            </div>
          )}

          {labData && labData.data_warnings && labData.data_warnings.length > 0 && (
            <div style={{
              color: 'var(--warning)',
              background: 'var(--warning-bg)',
              border: '1px solid var(--border-strong)',
              borderLeft: '3px solid var(--warning)',
              padding: '14px 16px',
              borderRadius: 'var(--card-radius)',
              marginTop: '14px',
              fontSize: '0.84rem',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', fontWeight: 700 }}>
                <AlertTriangle size={17} aria-hidden="true" />
                {t('lab.dataWarnings')}
              </div>
              <ul style={{ margin: 0, paddingLeft: '20px', lineHeight: 1.6, color: 'var(--text-secondary)' }}>
                {labData.data_warnings.map((msg, idx) => (
                  <li key={idx}>{msg}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* ── Phase 2: Results Tabs ── */}
        {labData && (
          <div style={{
            display: 'inline-flex',
            gap: '4px',
            marginBottom: '16px',
            background: 'var(--surface-inset)',
            border: '1px solid var(--border-subtle)',
            padding: '4px',
            borderRadius: 'var(--card-radius)',
          }}>
            <button
              type="button"
              onClick={() => setLabTab('optimization')}
              className={`sidebar-mode-btn ${labTab === 'optimization' ? 'active' : ''}`}
              style={{ padding: '7px 18px' }}
            >
              <Search size={14} aria-hidden="true" /> {t('lab.tabOptimization')}
            </button>
            <button
              type="button"
              onClick={() => setLabTab('backtest')}
              className={`sidebar-mode-btn ${labTab === 'backtest' ? 'active' : ''}`}
              style={{ padding: '7px 18px' }}
            >
              <History size={14} aria-hidden="true" /> {t('lab.tabBacktest')}
            </button>
          </div>
        )}

        {/* ── Portfolio Comparison Table ─────────────────────────────────── */}
        {labData && (
          <div className="glass-card" style={{ marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '1.2rem' }}>{t('lab.portfolioComparison')}</h3>
              <span style={{
                fontSize: '0.72rem',
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-secondary)',
                background: 'var(--surface-subtle)',
                border: '1px solid var(--border-subtle)',
                padding: '2px 10px',
                borderRadius: '4px',
              }}>
                {labData.data_points} {t('lab.tradingDays')}
              </span>
              {labData.mc_target_label && (
                <span style={{
                  fontSize: '0.72rem',
                  color: 'var(--accent-color)',
                  background: 'rgba(var(--accent-color-rgb), 0.08)',
                  border: '1px solid var(--border-subtle)',
                  padding: '2px 10px',
                  borderRadius: '4px',
                  marginLeft: 'auto',
                }}>
                  {labData.custom_portfolio ? t('lab.mcActiveOn') : t('lab.mcActiveOnMaxSharpe')}
                </span>
              )}
            </div>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>{t('lab.metric')}</th>
                    {resultPortfolios.map(p => (
                      <th key={p.key} style={{ color: p.color, textAlign: 'center' }}>{p.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: t('lab.annualReturn'), key: 'expected_return', fmt: v => v != null ? (v*100).toFixed(2)+'%' : '–', col: 'var(--success)' },
                    { label: t('lab.volatility'),    key: 'volatility',      fmt: v => v != null ? (v*100).toFixed(2)+'%' : '–', col: 'var(--danger)' },
                    { label: t('lab.sharpeRatio'),   key: 'sharpe_ratio',    fmt: v => v != null ? v.toFixed(3) : '–',            col: 'var(--text-primary)' },
                  ].map(row => (
                    <tr key={row.label}>
                      <td style={{ color: 'var(--text-secondary)' }}>{row.label}</td>
                      {resultPortfolios.map(p => (
                        <td key={p.key} style={{ textAlign: 'center', fontWeight: 700, fontFamily: 'var(--font-mono)', color: row.col }}>
                          {row.fmt(labData[p.key][row.key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {(() => {
                    if (!labData.monte_carlo || !Array.isArray(labData.monte_carlo.chart) || labData.monte_carlo.chart.length === 0) return null;
                    const last = labData.monte_carlo.chart.slice(-1)[0];
                    if (!last || last.p50 == null) return null;
                    const srColor = labData.monte_carlo.success_rate > 0.8 ? 'var(--success)' : labData.monte_carlo.success_rate > 0.5 ? 'var(--warning)' : 'var(--danger)';

                    return (
                      <>
                        <tr>
                          <td style={{ color: 'var(--text-secondary)', background: 'var(--surface-subtle)' }}>{t('lab.mcMedian')} ({labMcSettings.years}yr)</td>
                          {resultPortfolios.map(p => (
                            <td key={p.key} style={{ textAlign: 'center', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--accent-color)', background: 'var(--surface-subtle)' }}>
                              {p.key === labData.mc_target_label ? `$${(last.p50/1000).toFixed(0)}K` : '–'}
                            </td>
                          ))}
                        </tr>
                        {labData.monte_carlo.success_rate !== null && labData.monte_carlo.success_rate !== undefined && (
                          <tr>
                            <td style={{ color: 'var(--text-secondary)', background: 'var(--surface-subtle)' }}>{t('lab.successRate')}</td>
                            {resultPortfolios.map(p => (
                              <td key={p.key} style={{ textAlign: 'center', fontWeight: 700, fontFamily: 'var(--font-mono)', color: srColor, background: 'var(--surface-subtle)' }}>
                                {p.key === labData.mc_target_label ? `${(labData.monte_carlo.success_rate*100).toFixed(1)}%` : '–'}
                              </td>
                            ))}
                          </tr>
                        )}
                      </>
                    );
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Backtest Tab ── */}
        {labTab === 'backtest' && labData && (
          <div className="glass-card" style={{ marginBottom: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px', marginBottom: '24px' }}>
              <div>
                <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.35rem' }}>
                  <History size={22} style={{ color: 'var(--accent-color)' }} aria-hidden="true" />
                  {t('lab.historicalPerf')}
                </h3>
                <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', margin: '6px 0 0' }}>
                  {t('lab.historicalPerfSub')} {labData.data_points} {t('lab.tradingDays')}.
                </p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ display: 'flex', background: 'var(--surface-subtle)', borderRadius: '6px', overflow: 'hidden', border: '1px solid var(--border-subtle)' }}>
                  <button type="button" onClick={() => setLabChartFontSize(p => Math.max(10, p - 2))} style={{ padding: '4px 10px', background: 'transparent', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', borderRight: '1px solid var(--border-subtle)' }}>A-</button>
                  <div style={{ padding: '4px 10px', fontSize: '0.8rem', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center' }}>{labChartFontSize}px</div>
                  <button type="button" onClick={() => setLabChartFontSize(p => Math.min(24, p + 2))} style={{ padding: '4px 10px', background: 'transparent', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', borderLeft: '1px solid var(--border-subtle)' }}>A+</button>
                </div>
              </div>
            </div>

            {(() => {
              const combinedChartData = labData.benchmark_history ? labData.benchmark_history.map((b, i) => ({
                date: b.date,
                benchmark: b.value,
                max_sharpe: labData.max_sharpe?.backtest?.[i]?.value || null,
                min_volatility: labData.min_volatility?.backtest?.[i]?.value || null,
                risk_parity: labData.risk_parity?.backtest?.[i]?.value || null,
                custom: labData.custom_portfolio?.backtest?.[i]?.value || null
              })) : [];

              if (combinedChartData.length === 0) {
                return (
                  <div style={{
                    height: 380, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--text-muted)', background: 'var(--surface-subtle)', borderRadius: 'var(--card-radius)',
                    border: '1px dashed var(--border-subtle)', padding: '20px', textAlign: 'center',
                  }}>
                    <Info size={32} style={{ marginBottom: '10px', opacity: 0.6 }} aria-hidden="true" />
                    <p style={{ margin: 0, fontWeight: 600, color: 'var(--text-primary)' }}>Insufficient Historical Data for Chart</p>
                    <p style={{ margin: '5px 0 0', fontSize: '0.82rem' }}>Assets in this portfolio do not have enough overlapping price history to synthesize a backtest.</p>
                  </div>
                );
              }

              const lines = [
                <Line key="bench" type="monotone" dataKey="benchmark" stroke="var(--text-muted)" strokeWidth={1.25} strokeDasharray="3 3" dot={false} name="Benchmark (SPY)" />
              ];

              if (labData.max_sharpe?.backtest) {
                lines.push(<Line key="ms" type="monotone" dataKey="max_sharpe" stroke="#1E4D3B" strokeWidth={2} dot={false} name="Max Sharpe" />);
              }
              if (labData.min_volatility?.backtest) {
                lines.push(<Line key="mv" type="monotone" dataKey="min_volatility" stroke="#28547A" strokeWidth={2} dot={false} name="Min Volatility" />);
              }
              if (labData.risk_parity?.backtest) {
                lines.push(<Line key="rp" type="monotone" dataKey="risk_parity" stroke="#9A6F38" strokeWidth={2} dot={false} name="Risk Parity" />);
              }
              if (labData.custom_portfolio?.backtest) {
                lines.push(<Line key="cp" type="monotone" dataKey="custom" stroke="#8C3B32" strokeWidth={2.75} dot={false} name="Custom Portfolio" />);
              }

              return (
                <ResponsiveContainer width="100%" height={420}>
                  <LineChart data={combinedChartData} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                    <XAxis dataKey="date" hide type="category" allowDuplicatedCategory={false} />
                    <YAxis stroke="var(--border-subtle)" tick={{ fontSize: labChartFontSize, fill: 'var(--chart-axis)', fontFamily: 'var(--font-mono)' }} domain={['auto', 'auto']} tickFormatter={v => '$' + (v/1000).toFixed(0) + 'k'} />
                    <Tooltip
                      labelFormatter={v => v}
                      formatter={(v, name) => ['$' + Math.round(v).toLocaleString(), name]}
                      contentStyle={{ background: 'var(--tooltip-bg)', border: '1px solid var(--tooltip-border)', color: 'var(--tooltip-text)', borderRadius: '6px', fontSize: `${labChartFontSize}px` }}
                    />
                    <Legend wrapperStyle={{ fontSize: `${labChartFontSize}px`, paddingBottom: '10px' }} verticalAlign="top" height={Math.max(42, labChartFontSize * 2 + 10)} />
                    {lines}
                  </LineChart>
                </ResponsiveContainer>
              );
            })()}

            <div style={{ display: 'flex', gap: '15px', marginTop: '20px', borderTop: '1px solid var(--border-subtle)', paddingTop: '20px', flexWrap: 'wrap' }}>
              {resultPortfolios.map(p => {
                const bt = labData[p.key]?.backtest;
                if (!bt || bt.length === 0) return null;
                const end = bt[bt.length-1].value;
                const totalRet = (end/10000 - 1) * 100;
                return (
                  <div key={p.key} style={{ flex: 1, minWidth: '180px', padding: '14px 16px', borderRadius: 'var(--card-radius)', background: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>{p.name}</div>
                    <div style={{ fontSize: '1.35rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: p.color }}>{totalRet > 0 ? '+' : ''}{totalRet.toFixed(1)}%</div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Total Return</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Optimization Tab (Custom Allocation + Correlation Matrix) ── */}
        {labTab === 'optimization' && labData && (
          <div className="lab-two-col">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {resultPortfolios.map(p => (
                <AllocationCard key={p.key} portfolio={labData[p.key]} name={p.name} color={p.color}
                  onDeploy={handleDeployLabStrategy} />
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {labData.correlation_matrix && labData.valid_assets && (
                <div className="glass-card" style={{ marginBottom: 0, overflowX: 'auto' }}>
                  <h3 style={{ marginTop: 0, marginBottom: '15px', fontSize: '1.2rem' }}>Correlation Matrix</h3>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: `minmax(65px, 80px) repeat(${labData.valid_assets.length}, minmax(42px, 1fr))`,
                    gap: '3px',
                    fontSize: '0.72rem',
                    fontFamily: 'var(--font-mono)',
                  }}>
                    <div />
                    {labData.valid_assets.map(a => (
                      <div key={a} style={{ textAlign: 'center', color: 'var(--text-secondary)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{a}</div>
                    ))}
                    {labData.valid_assets.map(a1 => (
                      <React.Fragment key={a1}>
                        <div style={{ color: 'var(--text-secondary)', fontWeight: 600, textAlign: 'right', paddingRight: '6px', alignSelf: 'center', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a1}</div>
                        {labData.valid_assets.map(a2 => {
                          const val = labData.correlation_matrix.find(c => (c.asset1 === a1 && c.asset2 === a2) || (c.asset1 === a2 && c.asset2 === a1))?.value || 0;
                          const alpha = Math.max(0.06, Math.abs(val) * 0.35);
                          return (
                            <div
                              key={a2}
                              style={{
                                background: `rgba(var(--accent-color-rgb), ${alpha})`,
                                border: '1px solid var(--border-subtle)',
                                color: 'var(--text-primary)',
                                aspectRatio: '1/1',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                borderRadius: '3px',
                                fontWeight: 600,
                              }}
                            >
                              {val.toFixed(1)}
                            </div>
                          );
                        })}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Monte Carlo Projection Full-Width Module ── */}
        {labData && labData.monte_carlo && (
          <div className="glass-card" style={{ marginTop: '20px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px', marginBottom: '20px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <h3 style={{ marginTop: 0, marginBottom: '4px', fontSize: '1.35rem' }}>{labMcSettings.years}{t('lab.mcProjection')}</h3>
                  <button
                    type="button"
                    aria-label="View Monte Carlo Documentation"
                    onClick={() => setShowMcDoc(true)}
                    style={{
                      background: 'var(--surface-subtle)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--accent-color)',
                      borderRadius: '50%',
                      width: '24px', height: '24px', minBlockSize: '24px', minInlineSize: '24px',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                    }}
                    title="View Documentation"
                  >
                    <HelpCircle size={14} aria-hidden="true" />
                  </button>
                </div>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0 }}>
                  {labData.custom_portfolio
                    ? `Simulated via Geometric Brownian Motion (10,000 paths) on your Custom Allocation.`
                    : `Simulated via Geometric Brownian Motion (10,000 paths) on the Maximum Sharpe portfolio.`}
                  {labData.monte_carlo.stressed_volatility && (
                    <span style={{ color: 'var(--danger)', fontWeight: 600, marginLeft: '6px' }}>(Stress Mode Active)</span>
                  )}
                </p>
              </div>
            </div>

            {/* Simulation Control Panels Container */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', marginBottom: '20px' }}>
              {/* Block 1: 波动资产假设 (Portfolio Assumptions) */}
              <div style={{ background: 'var(--surface-subtle)', padding: '18px', borderRadius: 'var(--card-radius)', border: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
                  <h3 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--accent-color)' }}>
                    01 / 波动投资组合配置 (Portfolio Cash Flows)
                  </h3>
                  {Array.isArray(labData?.monte_carlo?.chart) && labData.monte_carlo.chart.length > 0 && (
                    <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap' }}>
                      {[
                        { label: '乐观 (90th)', key: 'p90', color: 'var(--success)' },
                        { label: '中性 (50th)', key: 'p50', color: 'var(--accent-color)' },
                        { label: '悲观 (10th)', key: 'p10', color: 'var(--danger)' }
                      ].map(s => {
                        const mcChart = labData.monte_carlo.chart;
                        const lastVal = mcChart[mcChart.length - 1]?.[s.key] ?? 0;
                        const cagr = (Math.pow(lastVal / (parseFloat(labMcSettings.capital) || 1), 1 / (parseFloat(labMcSettings.years) || 1)) - 1) * 100;
                        const rawIrr = labData.monte_carlo.irr?.[s.key];
                        const irrVal = rawIrr !== undefined && rawIrr !== null && !isNaN(rawIrr) ? rawIrr * 100 : undefined;

                        return (
                          <div key={s.key} style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-sans)' }}>{s.label}</div>
                            <div style={{ fontSize: '0.92rem', fontWeight: 700, color: cagr <= -99.9 ? 'var(--danger)' : s.color }}>
                              {cagr <= -99.9 ? (
                                <>{t('lab.depleted')} <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', fontWeight: 400 }}>{t('lab.depletedSub')}</span></>
                              ) : (
                                <>{cagr > 0 ? '+' : ''}{cagr.toFixed(2)}% <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', fontWeight: 400 }}>CAGR</span></>
                              )}
                              {irrVal !== undefined && (
                                <div style={{ fontSize: '0.76rem', fontWeight: 600, marginTop: '1px', color: 'var(--text-secondary)' }}>
                                  {irrVal > 0 ? '+' : ''}{irrVal.toFixed(2)}% <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', fontWeight: 400 }}>IRR</span>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="mc-cashflow-inputs">
                  {/* Initial Capital */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ fontSize: '0.76rem', fontWeight: 600, color: ilpEnabled ? 'var(--accent-color)' : 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      Initial Capital ($)
                      {ilpEnabled && <span style={{ fontSize: '0.65rem', color: 'var(--accent-secondary)' }}>= 整付保费</span>}
                    </span>
                    <NumberInputWithCommas
                      value={labMcSettings.capital}
                      onChange={v => setLabMcSettings({ ...labMcSettings, capital: v })}
                      style={{
                        ...inputBoxStyle,
                        width: '100%',
                        borderColor: ilpEnabled ? 'var(--accent-color)' : 'var(--border-strong)',
                      }}
                    />
                  </div>

                  {/* Annual Add */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ fontSize: '0.76rem', fontWeight: 600, color: ilpEnabled ? 'var(--warning)' : 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      Annual Add ($) | Yr Start-End
                      {ilpEnabled && <span style={{ fontSize: '0.65rem', color: 'var(--warning)' }}>已锁定 = 0</span>}
                    </span>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <NumberInputWithCommas
                        value={ilpEnabled ? 0 : labMcSettings.contribution}
                        onChange={v => !ilpEnabled && setLabMcSettings({ ...labMcSettings, contribution: v })}
                        style={{
                          ...inputBoxStyle,
                          flex: 1,
                          minWidth: '80px',
                          opacity: ilpEnabled ? 0.5 : 1,
                          cursor: ilpEnabled ? 'not-allowed' : 'text',
                        }}
                      />
                      <input
                        type="number"
                        value={labMcSettings.contribution_start}
                        onChange={e => !ilpEnabled && setLabMcSettings({ ...labMcSettings, contribution_start: e.target.value })}
                        disabled={ilpEnabled}
                        style={{ ...inputBoxStyle, width: '52px', opacity: ilpEnabled ? 0.5 : 1 }}
                        title="Start Year"
                      />
                      <span style={{ color: 'var(--text-muted)' }}>–</span>
                      <input
                        type="number"
                        value={labMcSettings.contribution_years}
                        onChange={e => !ilpEnabled && setLabMcSettings({ ...labMcSettings, contribution_years: e.target.value })}
                        disabled={ilpEnabled}
                        style={{ ...inputBoxStyle, width: '52px', opacity: ilpEnabled ? 0.5 : 1 }}
                        title="End Year"
                      />
                    </div>
                    {ilpEnabled && (
                      <span style={{ fontSize: '0.65rem', color: 'var(--warning)' }}>
                        ILP 为整付保费产品，无后续追加
                      </span>
                    )}
                  </div>

                  {/* Annual Draw */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ fontSize: '0.76rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Annual Draw ($) | Yr Start-End</span>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '4px' }}>
                      <NumberInputWithCommas
                        value={labMcSettings.withdrawal}
                        onChange={v => setLabMcSettings({ ...labMcSettings, withdrawal: v })}
                        style={{ ...inputBoxStyle, flex: 1, minWidth: '80px' }}
                      />
                      <input type="number" value={labMcSettings.withdrawal_start} onChange={e => setLabMcSettings({ ...labMcSettings, withdrawal_start: e.target.value })} style={{ ...inputBoxStyle, width: '52px' }} title="Start Year" />
                      <span style={{ color: 'var(--text-muted)' }}>–</span>
                      <input type="number" value={labMcSettings.withdrawal_end} onChange={e => setLabMcSettings({ ...labMcSettings, withdrawal_end: e.target.value })} style={{ ...inputBoxStyle, width: '52px' }} title="End Year" />
                    </div>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <NumberInputWithCommas
                        value={labMcSettings.withdrawal_2 || 0}
                        onChange={v => setLabMcSettings({ ...labMcSettings, withdrawal_2: v })}
                        style={{ ...inputBoxStyle, flex: 1, minWidth: '80px' }}
                      />
                      <input type="number" value={labMcSettings.withdrawal_start_2 || 1} onChange={e => setLabMcSettings({ ...labMcSettings, withdrawal_start_2: e.target.value })} style={{ ...inputBoxStyle, width: '52px' }} title="Start Year (Stage 2)" />
                      <span style={{ color: 'var(--text-muted)' }}>–</span>
                      <input type="number" value={labMcSettings.withdrawal_end_2 || 100} onChange={e => setLabMcSettings({ ...labMcSettings, withdrawal_end_2: e.target.value })} style={{ ...inputBoxStyle, width: '52px' }} title="End Year (Stage 2)" />
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.74rem', color: labMcSettings.withdrawal_inflation ? 'var(--accent-color)' : 'var(--text-secondary)', marginTop: '2px' }}>
                      <input
                        type="checkbox"
                        checked={labMcSettings.withdrawal_inflation}
                        onChange={e => setLabMcSettings({ ...labMcSettings, withdrawal_inflation: e.target.checked })}
                        style={{ accentColor: 'var(--accent-color)' }}
                      />
                      随通胀调整 (Adjust w/ Inflation)
                    </label>
                  </div>

                  {/* Years */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ fontSize: '0.76rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Simulation Years</span>
                    <input
                      type="number"
                      value={labMcSettings.years}
                      onChange={e => setLabMcSettings({ ...labMcSettings, years: e.target.value })}
                      style={{ ...inputBoxStyle, width: '90px' }}
                    />
                  </div>
                </div>

                {/* ILP 投连险 Toggle */}
                <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px solid var(--border-subtle)' }}>
                  <div
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px',
                      cursor: 'pointer', padding: '10px 14px', borderRadius: 'var(--card-radius)',
                      background: ilpEnabled ? 'rgba(var(--accent-color-rgb), 0.08)' : 'var(--surface-card)',
                      border: `1px solid ${ilpEnabled ? 'var(--accent-color)' : 'var(--border-subtle)'}`,
                      transition: '0.2s',
                    }}
                    onClick={() => setIlpEnabled(!ilpEnabled)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, color: ilpEnabled ? 'var(--accent-color)' : 'var(--text-primary)' }}>
                        通过投连险（ILP）实现本组合
                      </span>
                      <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                        费用自动从回报中扣减，叠加奖赏收益
                      </span>
                    </div>
                    <div style={{
                      width: '40px', height: '22px', borderRadius: '11px',
                      background: ilpEnabled ? 'var(--accent-color)' : 'var(--border-strong)',
                      position: 'relative', transition: 'background 0.2s', flexShrink: 0,
                    }}>
                      <div style={{
                        width: '18px', height: '18px', borderRadius: '50%', background: '#fff',
                        position: 'absolute', top: '2px', left: ilpEnabled ? '20px' : '2px',
                        transition: 'left 0.2s',
                      }} />
                    </div>
                  </div>

                  {ilpEnabled && (
                    <ILPConfigPanel
                      ilpConfig={ilpConfig}
                      onConfigChange={setIlpConfig}
                      onOpenEnrollmentModal={onOpenIlpEnrollmentModal}
                      initialCapital={parseFloat(labMcSettings.capital) || 0}
                    />
                  )}
                </div>
              </div>

              {/* Block 2: 稳健保险配置 */}
              <div style={{ background: 'var(--surface-subtle)', padding: '18px', borderRadius: 'var(--card-radius)', border: '1px solid var(--border-subtle)' }}>
                <h3 style={{ margin: '0 0 12px 0', fontSize: '1.05rem', color: 'var(--accent-secondary)' }}>
                  02 / 稳健保险产品配置 (Insurance Plan Integration)
                </h3>
                <InsurancePlanPanel
                  enabled={insuranceEnabled}
                  onToggle={() => setInsuranceEnabled(!insuranceEnabled)}
                  insurancePlan={insurancePlan}
                  onPlanLoaded={(plan) => setInsurancePlan(plan)}
                  alphaLow={insuranceAlphaLow}
                  alphaHigh={insuranceAlphaHigh}
                  onAlphaChange={(low, high) => {
                    setInsuranceAlphaLow(low);
                    setInsuranceAlphaHigh(high);
                  }}
                />
              </div>

              {/* Block 3 & 4: Combined Cash Flow & Dividend Lifecycle */}
              {(() => {
                const maxYears = parseInt(labMcSettings.years) || 40;
                const initialCapital = parseFloat(labMcSettings.capital) || 0;
                const cfData = [];
                cfData.push({
                  name: 'Yr 0',
                  portOutflow: initialCapital > 0 ? -initialCapital : 0,
                  insOutflow: 0,
                  portInflow: 0,
                  insInflow: 0,
                });
                for (let y = 1; y <= maxYears; y++) {
                  let portAdd = 0, portDraw = 0, insPrem = 0, insDraw = 0;
                  if (y >= parseInt(labMcSettings.contribution_start) && y <= parseInt(labMcSettings.contribution_years)) portAdd = parseFloat(labMcSettings.contribution || 0);
                  if (y >= parseInt(labMcSettings.withdrawal_start) && y <= parseInt(labMcSettings.withdrawal_end)) {
                    portDraw = parseFloat(labMcSettings.withdrawal || 0);
                    if (labMcSettings.withdrawal_inflation) {
                      portDraw = portDraw * Math.pow(1 + (parseFloat(labMcSettings.inflation) || 0) / 100, y - 1);
                    }
                  }

                  if (insuranceEnabled && insurancePlan && insurancePlan.years && y <= insurancePlan.years.length) {
                    const py = insurancePlan.years[y-1];
                    insPrem = py.premium || 0;
                    insDraw = py.withdrawal || 0;
                  }

                  cfData.push({
                    name: `Yr ${y}`,
                    portOutflow: portAdd > 0 ? -portAdd : 0,
                    insOutflow: insPrem > 0 ? -insPrem : 0,
                    portInflow: portDraw > 0 ? portDraw : 0,
                    insInflow: insDraw > 0 ? insDraw : 0,
                  });
                }

                const divData = [];
                let cumTotalDiv = 0;
                let breakevenYear = null;
                let firstYearDiv = 0;
                let lastYearDiv = 0;
                let maxDivYears = 0;
                const targetWithdrawal = parseFloat(labMcSettings.withdrawal) || 0;

                const contribPerYear = parseFloat(labMcSettings.contribution) || 0;
                const contribStart   = parseInt(labMcSettings.contribution_start) || 1;
                const contribEnd     = parseInt(labMcSettings.contribution_years) || 0;
                const numContribYears = contribEnd >= contribStart ? contribEnd - contribStart + 1 : 0;
                const totalContributions = contribPerYear * numContribYears;
                const totalCapitalInvested = initialCapital + totalContributions;

                if (labData?.monte_carlo?.chart) {
                  labData.monte_carlo.chart.forEach((d, i) => {
                    if (i === 0) return;
                    maxDivYears = i;
                    const divOff = d.div_offset || 0;
                    const divRe = d.div_reinvested || 0;
                    const divGen = divOff + divRe;

                    if (i === 1) firstYearDiv = divGen;
                    lastYearDiv = divGen;

                    cumTotalDiv += divGen;

                    if (breakevenYear === null && totalCapitalInvested > 0 && cumTotalDiv >= totalCapitalInvested) {
                      breakevenYear = d.year;
                    }

                    divData.push({
                      name: `Yr ${d.year}`,
                      divOffset: divOff,
                      divReinvested: divRe,
                      cumReinvestedValue: cumTotalDiv,
                      cumReinvestedPct: totalCapitalInvested > 0 ? (cumTotalDiv / totalCapitalInvested) * 100 : 0,
                      yoc: totalCapitalInvested > 0 ? (divGen / totalCapitalInvested) * 100 : 0
                    });
                  });
                }

                const yocFinal = totalCapitalInvested > 0 ? (lastYearDiv / totalCapitalInvested) * 100 : 0;
                const incomeReplacement = targetWithdrawal > 0 ? (lastYearDiv / targetWithdrawal) * 100 : 0;
                const dgr = (firstYearDiv > 0 && maxDivYears > 1) ? (Math.pow(lastYearDiv / firstYearDiv, 1 / (maxDivYears - 1)) - 1) * 100 : 0;
                const breakevenText = breakevenYear ? `第 ${breakevenYear} 年` : `> ${maxDivYears} 年`;

                return (
                  <>
                    <div style={{ background: 'var(--surface-subtle)', padding: '18px', borderRadius: 'var(--card-radius)', border: '1px solid var(--border-subtle)' }}>
                      <h3 style={{ margin: '0 0 15px 0', fontSize: '1.05rem', color: 'var(--info)' }}>
                        03 / 综合现金流预览 (Combined Cash Flow to Pocket)
                      </h3>
                      <div style={{ height: 220, width: '100%' }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={cfData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                            <XAxis dataKey="name" stroke="var(--border-subtle)" tick={{ fill: 'var(--chart-axis)', fontSize: 11, fontFamily: 'var(--font-mono)' }} />
                            <YAxis stroke="var(--border-subtle)" tick={{ fill: 'var(--chart-axis)', fontSize: 11, fontFamily: 'var(--font-mono)' }} tickFormatter={(v) => '$' + v/1000 + 'k'} />
                            <Tooltip content={<CombinedCashFlowTooltip />} />
                            <Legend wrapperStyle={{ fontSize: '0.8rem' }} />
                            <Bar dataKey="portInflow" stackId="a" fill="#1E4D3B" name="组合流入 (Portfolio Draw)" />
                            <Bar dataKey="insInflow" stackId="a" fill="#28547A" name="保险流入 (Insurance Draw)" />
                            <Bar dataKey="portOutflow" stackId="a" fill="#8C3B32" name="组合定投 (Portfolio Contrib)" />
                            <Bar dataKey="insOutflow" stackId="a" fill="#9A6F38" name="保险保费 (Insurance Premium)" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {divData.length > 0 && (
                      <div style={{ background: 'var(--surface-subtle)', padding: '18px', borderRadius: 'var(--card-radius)', border: '1px solid var(--border-subtle)' }}>
                        <h3 style={{ margin: '0 0 15px 0', fontSize: '1.05rem', color: 'var(--accent-color)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          04 / 内生分红与复投追踪 (Dividend Lifecycle)
                          <button
                            type="button"
                            aria-label="Toggle Dividend Lifecycle Documentation"
                            onClick={() => setShowDivDoc(!showDivDoc)}
                            style={{ background: 'none', border: 'none', color: 'var(--accent-secondary)', cursor: 'pointer', padding: 0, display: 'flex', minBlockSize: 'auto', minInlineSize: 'auto' }}
                            title="什么是累计复投差额比？"
                          >
                            <HelpCircle size={16} aria-hidden="true" />
                          </button>
                        </h3>

                        {showDivDoc && (
                          <div style={{
                            background: 'var(--surface-card)',
                            border: '1px solid var(--border-strong)',
                            borderLeft: '3px solid var(--info)',
                            padding: '12px 16px',
                            borderRadius: 'var(--card-radius)',
                            marginBottom: '15px',
                            fontSize: '0.84rem',
                            color: 'var(--text-secondary)',
                            lineHeight: 1.65,
                          }}>
                            <strong style={{ color: 'var(--text-primary)' }}>财务指标与内生分红追踪指南</strong><br />
                            <ul style={{ margin: '8px 0 0 20px', padding: 0 }}>
                              <li style={{ marginBottom: '4px' }}><strong style={{ color: 'var(--accent-color)' }}>期末成本收益率 (YOC)</strong>: 模拟期末当年的总分红金额，占最初投入总本金的比例。</li>
                              <li style={{ marginBottom: '4px' }}><strong style={{ color: 'var(--info)' }}>分红复合增长率 (DGR)</strong>: 模拟周期内，每年分红金额的年化复合增长率。</li>
                              <li style={{ marginBottom: '4px' }}><strong style={{ color: 'var(--accent-secondary)' }}>期末目标支出覆盖率</strong>: 期末当年的总分红除以您设定的年度提款需求。</li>
                              <li style={{ marginBottom: '4px' }}><strong style={{ color: 'var(--text-primary)' }}>零成本拐点 (Breakeven)</strong>: 累计内生分红总额达到初始投入本金所需的年数。</li>
                              <li><strong style={{ color: 'var(--info)' }}>累计总分红比 (vs Capital %)</strong>: 图表蓝线，表示累计总分红占初始本金的百分比。</li>
                            </ul>
                          </div>
                        )}

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', marginBottom: '16px' }}>
                          <div style={{ background: 'var(--surface-card)', padding: '12px 14px', borderRadius: 'var(--card-radius)', border: '1px solid var(--border-subtle)', borderLeft: '3px solid var(--accent-color)' }}>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }} onClick={() => setShowDivDoc(!showDivDoc)}>
                              期末成本收益率 (YOC) <HelpCircle size={12} aria-hidden="true" />
                            </div>
                            <div style={{ fontSize: '1.25rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--accent-color)' }}>{yocFinal.toFixed(2)}%</div>
                          </div>
                          <div style={{ background: 'var(--surface-card)', padding: '12px 14px', borderRadius: 'var(--card-radius)', border: '1px solid var(--border-subtle)', borderLeft: '3px solid var(--info)' }}>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }} onClick={() => setShowDivDoc(!showDivDoc)}>
                              分红复合增长率 (DGR) <HelpCircle size={12} aria-hidden="true" />
                            </div>
                            <div style={{ fontSize: '1.25rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--info)' }}>{dgr.toFixed(2)}%</div>
                          </div>
                          <div style={{ background: 'var(--surface-card)', padding: '12px 14px', borderRadius: 'var(--card-radius)', border: '1px solid var(--border-subtle)', borderLeft: '3px solid var(--accent-secondary)' }}>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }} onClick={() => setShowDivDoc(!showDivDoc)}>
                              期末目标支出覆盖率 <HelpCircle size={12} aria-hidden="true" />
                            </div>
                            <div style={{ fontSize: '1.25rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--accent-secondary)' }}>{targetWithdrawal > 0 ? incomeReplacement.toFixed(1) + '%' : 'N/A'}</div>
                          </div>
                          <div style={{ background: 'var(--surface-card)', padding: '12px 14px', borderRadius: 'var(--card-radius)', border: '1px solid var(--border-subtle)', borderLeft: '3px solid var(--success)' }}>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }} onClick={() => setShowDivDoc(!showDivDoc)}>
                              零成本拐点 (Breakeven) <HelpCircle size={12} aria-hidden="true" />
                            </div>
                            <div style={{ fontSize: '1.25rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{breakevenText}</div>
                          </div>
                        </div>

                        <div style={{ height: 220, width: '100%' }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={divData}>
                              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                              <XAxis dataKey="name" stroke="var(--border-subtle)" tick={{ fill: 'var(--chart-axis)', fontSize: 11, fontFamily: 'var(--font-mono)' }} />
                              <YAxis yAxisId="left" stroke="var(--border-subtle)" tick={{ fill: 'var(--chart-axis)', fontSize: 11, fontFamily: 'var(--font-mono)' }} tickFormatter={(v) => '$' + (v/1000).toFixed(0) + 'k'} />
                              <YAxis yAxisId="right" orientation="right" stroke="var(--border-subtle)" tick={{ fill: 'var(--chart-axis)', fontSize: 11, fontFamily: 'var(--font-mono)' }} tickFormatter={(v) => v.toFixed(1) + '%'} />
                              <Tooltip
                                contentStyle={{ backgroundColor: 'var(--tooltip-bg)', borderColor: 'var(--tooltip-border)', color: 'var(--tooltip-text)', borderRadius: '6px' }}
                                formatter={(val, name) => {
                                  if (name.includes('比') || name.includes('YOC')) return val.toFixed(1) + '%';
                                  return '$' + Math.abs(val).toLocaleString();
                                }}
                              />
                              <Legend wrapperStyle={{ fontSize: '0.8rem' }} />
                              <Bar yAxisId="left" dataKey="divOffset" stackId="div" fill="#9A6F38" name="抵扣提取 (Offset)" />
                              <Bar yAxisId="left" dataKey="divReinvested" stackId="div" fill="#1E4D3B" name="滚雪球复投 (Reinvested)" />
                              <Line yAxisId="right" type="monotone" dataKey="cumReinvestedPct" stroke="#28547A" strokeWidth={2} dot={false} name="累计总分红比 (vs Capital %)" />
                              <Line yAxisId="left" type="monotone" dataKey="cumReinvestedValue" stroke="rgba(40, 84, 122, 0.35)" strokeDasharray="3 3" dot={false} name="累计总分红绝对值 ($)" />
                              <Line yAxisId="right" type="monotone" dataKey="yoc" stroke="#1E4D3B" strokeWidth={0} dot={false} activeDot={false} isAnimationActive={false} legendType="none" name="当年分红占初始投入 (YOC)" />
                            </ComposedChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}

              {/* Actions & Global Settings */}
              <div style={{
                display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'center',
                background: 'var(--surface-subtle)', padding: '16px 18px',
                borderRadius: 'var(--card-radius)', border: '1px solid var(--border-subtle)',
              }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.84rem', fontWeight: 600, color: labMcSettings.stress ? 'var(--danger)' : 'var(--text-primary)' }}>
                  <input
                    type="checkbox"
                    checked={labMcSettings.stress}
                    onChange={e => setLabMcSettings({ ...labMcSettings, stress: e.target.checked })}
                    style={{ cursor: 'pointer', accentColor: 'var(--danger)' }}
                  />
                  Enable Stress Mode (Correlation Spike)
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Inflation %:
                  <input
                    type="number"
                    step="0.1"
                    value={labMcSettings.inflation}
                    onChange={e => setLabMcSettings({ ...labMcSettings, inflation: e.target.value })}
                    style={{ ...inputBoxStyle, width: '64px' }}
                  />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  综合目标 (Target Goal):
                  <NumberInputWithCommas
                    value={labMcSettings.target}
                    onChange={v => setLabMcSettings({ ...labMcSettings, target: v })}
                    style={{ ...inputBoxStyle, width: '115px' }}
                  />
                </label>

                <div style={{ marginLeft: 'auto', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                  {labData?.monte_carlo?.success_rate !== undefined && labData.monte_carlo.success_rate !== null && (
                    <div style={{
                      textAlign: 'center',
                      background: labData.monte_carlo.success_rate > 0.8 ? 'var(--success-bg)' : labData.monte_carlo.success_rate > 0.5 ? 'var(--warning-bg)' : 'var(--danger-bg)',
                      padding: '6px 14px',
                      borderRadius: 'var(--card-radius)',
                      border: `1px solid ${labData.monte_carlo.success_rate > 0.8 ? 'var(--success)' : labData.monte_carlo.success_rate > 0.5 ? 'var(--warning)' : 'var(--danger)'}`,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minWidth: '120px',
                    }}>
                      <div style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        {labData.monte_carlo.success_rate > 0.8 ? 'High Success' : labData.monte_carlo.success_rate > 0.5 ? 'Moderate Risk' : 'Critical Barrier'}
                      </div>
                      <div style={{ fontSize: '1.15rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: labData.monte_carlo.success_rate > 0.8 ? 'var(--success)' : labData.monte_carlo.success_rate > 0.5 ? 'var(--warning)' : 'var(--danger)' }}>
                        {(labData.monte_carlo.success_rate * 100).toFixed(1)}%
                      </div>
                      <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>Target Reach Prob</div>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleRunLabAnalysis}
                    className="create-btn"
                    disabled={labLoading}
                  >
                    {labLoading ? 'Updating...' : <><Zap size={15} aria-hidden="true" /> 执行综合测试 / Run Monte Carlo</>}
                  </button>

                  <button
                    type="button"
                    onClick={handleGenerateReport}
                    disabled={!labData?.monte_carlo}
                    className="action-btn-secondary"
                    style={{
                      borderColor: 'var(--accent-secondary)',
                      color: 'var(--accent-secondary)',
                      opacity: !labData?.monte_carlo ? 0.4 : 1,
                      cursor: !labData?.monte_carlo ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <FileText size={15} aria-hidden="true" /> 预览客户版报告
                  </button>

                  {labData?.monte_carlo && (
                    <button
                      type="button"
                      onClick={() => { setScenarioName(''); setSaveDialogOpen(true); }}
                      className="action-btn-secondary"
                      style={{
                        borderColor: 'var(--accent-color)',
                        color: 'var(--accent-color)',
                      }}
                    >
                      <Bookmark size={15} aria-hidden="true" /> 保存此方案
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Monte Carlo Main Chart */}
            {(() => {
              if (!labData.monte_carlo.chart || labData.monte_carlo.chart.length === 0) return null;
              const lastObj = labData.monte_carlo.chart[labData.monte_carlo.chart.length - 1];
              const hasInflation = labMcSettings.inflation > 0;
              const insuranceIsActive = insuranceEnabled && insurancePlan && (labData.monte_carlo.chart?.length > 1 ? labData.monte_carlo.chart[1].ins_cv_p50 !== undefined : false);
              const probeRow = labData.monte_carlo.chart.length > 1 ? labData.monte_carlo.chart[1] : lastObj;

              const mcLines = [];

              if (insuranceIsActive) {
                mcLines.push(
                  <Bar key="ins_cv_p50" dataKey="ins_cv_p50" stackId="1" fill="#9A6F38" fillOpacity={0.88} name="保底资产基石 (Insurance CV P50)" />,
                  <Bar key="p50" dataKey="p50" stackId="1" fill="#28547A" fillOpacity={0.88} name="叠加投资组合波段 (Portfolio P50)" />
                );
                mcLines.push(
                  <Line key="combined_p90" type="monotone" dataKey="combined_p90" stroke="#1E4D3B" strokeWidth={2} strokeDasharray="5 5" dot={false} name="合并资产乐观极值 (Combined 90th)" />,
                  <Line key="combined_p10" type="monotone" dataKey="combined_p10" stroke="#8C3B32" strokeWidth={2} strokeDasharray="5 5" dot={false} name="合并资产悲观底线 (Combined 10th)" />
                );
              } else {
                mcLines.push(
                  <Area key="area" type="monotone" dataKey="range" stroke="none" fill="#1E4D3B" fillOpacity={0.08} />,
                  <Line key="p90" type="monotone" dataKey="p90" stroke="#1E4D3B" strokeWidth={2} strokeDasharray="5 5" dot={false} name="乐观 (Optimistic 90th)" />,
                  <Line key="p50" type="monotone" dataKey="p50" stroke="#28547A" strokeWidth={2.75} dot={false} name={labData.custom_portfolio ? "自定义中性 (Neutral 50th)" : "推荐中性 (Neutral 50th)"} />,
                  <Line key="p10" type="monotone" dataKey="p10" stroke="#8C3B32" strokeWidth={2} strokeDasharray="5 5" dot={false} name="悲观 (Pessimistic 10th)" />
                );
              }

              if (hasInflation) {
                if (insuranceIsActive && probeRow.combined_real_p50 !== undefined) {
                  mcLines.push(
                    <Line key="rp50" type="monotone" dataKey="combined_real_p50" stroke="#9A6F38" strokeWidth={2} strokeDasharray="3 3" dot={false} name={`合并资产真实购买力 (Real Value @${labMcSettings.inflation}%)`} />
                  );
                } else if (probeRow.real_p50 !== undefined) {
                  mcLines.push(
                    <Line key="rp50" type="monotone" dataKey="real_p50" stroke="#9A6F38" strokeWidth={2} strokeDasharray="3 3" dot={false} name={`真实购买力 (Real Value @${labMcSettings.inflation}%)`} />
                  );
                }
              }

              const renderMcTooltip = ({ active, payload, label }) => {
                if (active && payload && payload.length) {
                  const dataRow = payload[0]?.payload || {};
                  const actual_draw = dataRow.actual_draw_p50;
                  const target_draw = labMcSettings.withdrawal || 0;
                  const isShortfall = actual_draw !== undefined && target_draw > 0 && actual_draw < target_draw * 0.9;
                  return (
                    <div style={{
                      backgroundColor: 'var(--tooltip-bg)',
                      border: '1px solid var(--tooltip-border)',
                      padding: '12px 14px',
                      borderRadius: '6px',
                      boxShadow: 'var(--card-shadow)',
                      color: 'var(--tooltip-text)',
                      minWidth: '220px',
                    }}>
                      <div style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: '6px', marginBottom: '8px', fontWeight: 700, fontFamily: 'var(--font-display)', fontSize: '0.95rem' }}>
                        第 {label} 年
                      </div>
                      {payload.map((entry, index) => (
                        <div key={index} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', padding: '2px 0' }}>
                          <span style={{ fontSize: '0.72rem', color: entry.color, fontWeight: 600 }}>{entry.name}</span>
                          <span style={{ fontWeight: 700, color: entry.color, fontFamily: 'var(--font-mono)', fontSize: '0.84rem' }}>
                            ${Math.round(entry.value).toLocaleString()}
                          </span>
                        </div>
                      ))}
                      {(dataRow.div_generated > 0 || (actual_draw !== undefined && target_draw > 0)) && (
                        <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed var(--border-subtle)' }}>
                          {dataRow.div_generated > 0 && (
                            <div style={{ marginBottom: (actual_draw !== undefined && target_draw > 0) ? '8px' : '0' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                                <span style={{ fontSize: '0.72rem', color: 'var(--success)' }}>分红总收益 (P50)</span>
                                <span style={{ fontWeight: 700, color: 'var(--success)', fontFamily: 'var(--font-mono)', fontSize: '0.84rem' }}>+${Math.round(dataRow.div_generated).toLocaleString()}</span>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingLeft: '8px' }}>
                                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>↪ 抵扣提取需求</span>
                                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>${Math.round(dataRow.div_offset || 0).toLocaleString()}</span>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingLeft: '8px' }}>
                                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>↪ 并入本金复投</span>
                                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>${Math.round(dataRow.div_reinvested || 0).toLocaleString()}</span>
                              </div>
                            </div>
                          )}
                          {actual_draw !== undefined && target_draw > 0 && (
                            <>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>预计实际可提取 (P50)</span>
                                <span style={{ fontWeight: 700, color: isShortfall ? 'var(--danger)' : 'var(--accent-secondary)', fontFamily: 'var(--font-mono)', fontSize: '0.84rem' }}>
                                  ${Math.round(actual_draw).toLocaleString()}
                                </span>
                              </div>
                              {isShortfall && (
                                <div style={{ fontSize: '0.65rem', color: 'var(--danger)', marginTop: '3px', textAlign: 'right' }}>⚠ 资金不足，提取受限</div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                }
                return null;
              };

              return (
                <div style={{ width: '100%', marginTop: '12px' }}>
                  <div style={{ height: '430px', background: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)', padding: '18px', borderRadius: 'var(--card-radius)', marginBottom: '15px' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={labData.monte_carlo.chart}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                        <XAxis dataKey="year" stroke="var(--border-subtle)" tick={{ fill: 'var(--chart-axis)', fontSize: 11, fontFamily: 'var(--font-mono)' }} />
                        <YAxis stroke="var(--border-subtle)" tick={{ fill: 'var(--chart-axis)', fontSize: 11, fontFamily: 'var(--font-mono)' }} tickFormatter={(val) => '$' + (val/1000).toFixed(0) + 'k'} domain={insuranceIsActive ? [0, 'auto'] : ['auto', 'auto']} />
                        <Tooltip content={renderMcTooltip} />
                        <Legend wrapperStyle={{ fontSize: '0.8rem' }} />
                        {labMcSettings.target > 0 && (
                          <ReferenceLine y={labMcSettings.target} stroke="var(--accent-secondary)" strokeDasharray="5 5" label={{ position: 'insideTopLeft', value: '目标 (Target)', fill: 'var(--accent-secondary)', fontSize: 12 }} />
                        )}
                        {mcLines}
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>

                  {hasInflation && lastObj.real_p50 && (
                    <div style={{ textAlign: 'center', marginBottom: '15px', padding: '10px 14px', background: 'var(--warning-bg)', border: '1px solid var(--border-strong)', borderRadius: 'var(--card-radius)' }}>
                      <span style={{ color: 'var(--accent-secondary)', fontSize: '0.88rem', fontWeight: 600 }}>
                        {labMcSettings.years} 年后预测中性值为 ${Math.round(lastObj.p50).toLocaleString()}，折算今日购买力约 ${Math.round(lastObj.real_p50).toLocaleString()}。
                      </span>
                    </div>
                  )}

                  {insuranceEnabled && labData.monte_carlo.insurance_stats && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '15px' }}>
                      <div style={{ padding: '12px 14px', background: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)', borderTop: '2px solid var(--accent-color)', borderRadius: 'var(--card-radius)' }}>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.76rem', marginBottom: '4px' }}>保险提取分摊抵扣率</div>
                        <div style={{ fontSize: '1.25rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--accent-color)' }}>{labData.monte_carlo.insurance_stats.withdrawal_coverage_pct.toFixed(1)}%</div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>占全部提款需求</div>
                      </div>
                      <div style={{ padding: '12px 14px', background: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)', borderTop: '2px solid var(--info)', borderRadius: 'var(--card-radius)' }}>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.76rem', marginBottom: '4px' }}>{labMcSettings.years} 年期末保单剩余CV (中性)</div>
                        <div style={{ fontSize: '1.25rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--info)' }}>${Math.round(labData.monte_carlo.insurance_stats.avg_cv_at_year_end.mid).toLocaleString()}</div>
                      </div>
                      <div style={{ padding: '12px 14px', background: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)', borderTop: '2px solid var(--accent-secondary)', borderRadius: 'var(--card-radius)' }}>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.76rem', marginBottom: '4px' }}>模拟期内保险总提取</div>
                        <div style={{ fontSize: '1.25rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--accent-secondary)' }}>${Math.round(labData.monte_carlo.insurance_stats.total_insurance_withdrawal).toLocaleString()}</div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Max Drawdown Comparison */}
            {labData.monte_carlo.drawdown && (
              <>
                <div
                  style={{ marginTop: '20px', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: 'var(--danger)', fontSize: '0.88rem', fontWeight: 600, width: 'fit-content' }}
                  onClick={() => setShowDdDoc(!showDdDoc)}
                >
                  如何理解最大回撤 (Max Drawdown)? <HelpCircle size={15} aria-hidden="true" />
                </div>

                {showDdDoc && (
                  <div style={{
                    background: 'var(--surface-subtle)',
                    border: '1px solid var(--border-strong)',
                    borderLeft: '3px solid var(--danger)',
                    padding: '12px 16px',
                    borderRadius: 'var(--card-radius)',
                    marginTop: '10px',
                    fontSize: '0.84rem',
                    color: 'var(--text-secondary)',
                    lineHeight: 1.65,
                  }}>
                    <strong style={{ color: 'var(--danger)' }}>最大回撤 (Max Drawdown)</strong><br />
                    衡量在整个投资周期内，账户从<strong style={{ color: 'var(--text-primary)' }}>“历史最高峰”跌至“谷底”的最大幅度</strong>，代表您在极端行情下需要承受的“账面浮亏心理极限”。将高波动组合与稳健保险资产合并计算后，可有效缓冲整体回撤。
                  </div>
                )}

                <div className="drawdown-bar-row" style={{ background: 'var(--danger-bg)', border: '1px solid var(--border-subtle)', borderLeft: '3px solid var(--danger)' }}>
                  <div style={{ color: 'var(--danger)', fontWeight: 700, fontSize: '0.84rem' }}>
                    Max Drawdown<br/>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 400 }}>(波动组合 Volatile)</span>
                  </div>
                  {[
                    { label: '悲观 (10th)', key: 'p10', tip: 'Worst 10% of paths' },
                    { label: '中性 (50th)', key: 'p50', tip: 'Median path' },
                    { label: '乐观 (90th)', key: 'p90', tip: 'Best 10% of paths' },
                  ].map(s => (
                    <div key={s.key} style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '2px' }}>{s.label}</div>
                      {labData.monte_carlo.drawdown[s.key] <= -0.999 ? (
                        <>
                          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--danger)' }}>完全耗尽</div>
                          <div style={{ fontSize: '0.65rem', color: 'var(--danger)' }}>Portfolio Depleted</div>
                        </>
                      ) : (
                        <>
                          <div style={{ fontSize: '1.15rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: s.key === 'p90' ? 'var(--warning)' : 'var(--danger)' }}>
                            {(labData.monte_carlo.drawdown[s.key] * 100).toFixed(1)}%
                          </div>
                          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{s.tip}</div>
                        </>
                      )}
                    </div>
                  ))}
                </div>

                {labData.monte_carlo.combined_drawdown && (
                  <div className="drawdown-bar-row" style={{ background: 'var(--warning-bg)', border: '1px solid var(--border-subtle)', borderLeft: '3px solid var(--accent-secondary)' }}>
                    <div style={{ color: 'var(--accent-secondary)', fontWeight: 700, fontSize: '0.84rem' }}>
                      Max Drawdown<br/>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 400 }}>(合并组合 Combined)</span>
                    </div>
                    {[
                      { label: '悲观 (10th)', key: 'p10', tip: 'Worst 10% of paths' },
                      { label: '中性 (50th)', key: 'p50', tip: 'Median path' },
                      { label: '乐观 (90th)', key: 'p90', tip: 'Best 10% of paths' },
                    ].map(s => (
                      <div key={s.key} style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '2px' }}>{s.label}</div>
                        {labData.monte_carlo.combined_drawdown[s.key] <= -0.999 ? (
                          <>
                            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--danger)' }}>完全耗尽</div>
                            <div style={{ fontSize: '0.65rem', color: 'var(--danger)' }}>Portfolio Depleted</div>
                          </>
                        ) : (
                          <>
                            <div style={{ fontSize: '1.15rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: s.key === 'p90' ? 'var(--success)' : 'var(--accent-secondary)' }}>
                              {(labData.monte_carlo.combined_drawdown[s.key] * 100).toFixed(1)}%
                            </div>
                            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{s.tip}</div>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* ILP 保障与传承展示区块 */}
            {ilpEnabled && ilpConfig && ilpConfig.totalPremium > 0 && (
              <ILPSummaryCard
                ilpConfig={ilpConfig}
                currentCV={(() => {
                  const mc = labData?.monte_carlo?.chart;
                  if (!mc || mc.length === 0) return parseFloat(labMcSettings.capital) || 0;
                  return mc[mc.length - 1]?.p50 || parseFloat(labMcSettings.capital) || 0;
                })()}
                currentMonth={(() => {
                  const mc = labData?.monte_carlo?.chart;
                  if (!mc || mc.length === 0) return 0;
                  return (mc[mc.length - 1]?.year || 0) * 12;
                })()}
                p50EstimateEnd={(() => {
                  const mc = labData?.monte_carlo?.chart;
                  if (!mc || mc.length === 0) return 0;
                  return mc[mc.length - 1]?.p50 || 0;
                })()}
              />
            )}

            {/* ILP 费用影响分析面板 */}
            {ilpEnabled && ilpConfig && ilpConfig.totalPremium > 0 && labData?.monte_carlo?.chart && (
              <ILPImpactPanel
                mcChart={labData.monte_carlo.chart}
                ilpConfig={ilpConfig}
                labMcSettings={labMcSettings}
              />
            )}
          </div>
        )}
      </div>

      {/* ── Save Scenario Dialog ────────────────────────────────────────────── */}
      {saveDialogOpen && (
        <div className="modal-overlay" onClick={() => setSaveDialogOpen(false)}>
          <div className="glass-card modal-content" style={{ maxWidth: '380px' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 6px', fontSize: '1.3rem' }}>保存此方案</h3>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '18px' }}>
              将保存当前资产配置、MC参数及图表数据
            </div>
            <input
              autoFocus
              type="text"
              placeholder="方案名称，如：稳健50/50 退休规划"
              value={scenarioName}
              onChange={e => setScenarioName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleSaveScenario();
                if (e.key === 'Escape') setSaveDialogOpen(false);
              }}
              className="atelier-input"
            />
            <div style={{ display: 'flex', gap: '10px', marginTop: '18px', justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setSaveDialogOpen(false)} className="action-btn-secondary">
                取消
              </button>
              <button
                type="button"
                onClick={handleSaveScenario}
                disabled={!scenarioName.trim() || scenarioSaving}
                className="create-btn"
                style={{ opacity: scenarioName.trim() ? 1 : 0.45 }}
              >
                {scenarioSaving ? '保存中...' : '确认保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default StrategyLabView;
