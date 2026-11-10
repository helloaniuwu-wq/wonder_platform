import React from 'react';
import { useLang } from '../i18n/LangContext';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line, Area, ComposedChart, ReferenceLine
} from 'recharts';
import {
  AlertTriangle, HelpCircle, History, Info, Plus, Search, Target, Trash2, Zap
} from 'lucide-react';
import InsurancePlanPanel from './InsurancePlanPanel';
import ILPConfigPanel from './ILPConfigPanel';
import ILPSummaryCard from './ILPSummaryCard';
import ILPImpactPanel from './ILPImpactPanel';
import NumberInputWithCommas from './NumberInput';
import { CombinedCashFlowTooltip } from '../utils/chartHelpers';

/**
 * StrategyLabView — renders the full Strategy Lab tab UI.
 * All state and handlers are passed in as props from App.jsx.
 */
const StrategyLabView = ({
  // Lab asset state
  labIsins, labInput, setLabInput,
  labData, labLoading, labError,
  labDaysBack, setLabDaysBack,
  labMaxWeight, setLabMaxWeight,
  labMode, setLabMode,
  labCustomWeights, setLabCustomWeights,
  labTab, setLabTab,
  labChartFontSize, setLabChartFontSize,
  // Monte Carlo settings
  labMcSettings, setLabMcSettings,
  // Insurance
  insuranceEnabled, setInsuranceEnabled,
  insurancePlan, setInsurancePlan,
  insuranceAlphaLow, setInsuranceAlphaLow,
  insuranceAlphaHigh, setInsuranceAlphaHigh,
  // Scenario saving
  saveDialogOpen, setSaveDialogOpen,
  scenarioName, setScenarioName,
  scenarioSaving,
  // Modals
  reportModalOpen, setReportModalOpen,
  showMcDoc, setShowMcDoc,
  // Handlers
  handleAddLabIsin, handleRemoveLabIsin,
  handleRunLabAnalysis, handleDeployLabStrategy,
  handleSaveScenario, applyLabTemplate,
  reportLoading, handleGenerateReport, handleGenerateWordReport,
  // Computed
  labSum, isLabReady,
  // ILP
  ilpEnabled, setIlpEnabled,
  ilpConfig, setIlpConfig,
  onOpenIlpEnrollmentModal,
}) => {
  const { t } = useLang();
  const [showDivDoc, setShowDivDoc] = React.useState(false);
  const [showDdDoc, setShowDdDoc] = React.useState(false);
  return (
          <>
          <div className="strategy-lab-scope" style={{padding: '20px', maxWidth: '1200px'}}>
            <header style={{marginBottom: '30px', display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
              <div>
                <h1 style={{margin: '0 0 10px 0'}}>{t('lab.title')}</h1>
                <p style={{color: 'rgba(255,255,255,0.6)', margin: 0}}>{t('lab.subtitle')}</p>
              </div>
              <div style={{display: 'flex', gap: '10px', alignItems: 'center'}}>
                <div style={{fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif', fontWeight: 900, fontSize: '1.4rem', letterSpacing: '2px', background: 'linear-gradient(135deg, #10b981 0%, #3b82f6 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', display: 'flex', alignItems: 'center'}}>
                  WONDER.
                </div>
              </div>
            </header>

            <div className="glass-card" style={{marginBottom: '20px'}}>
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px'}}>
                <h3 style={{margin: 0}}><Target size={18} style={{verticalAlign: 'middle', marginRight: '8px'}}/>{t('lab.assetSandbox')}</h3>
                <span style={{fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.2)', padding: '3px 10px', borderRadius: '20px'}}>{t('lab.customPortfolio')}</span>
              </div>

              <div style={{display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '15px'}}>
                {labIsins.map(isin => {
                  const stats = labData?.asset_stats?.[isin];
                  return (
                    <div key={isin} style={{background: 'rgba(244,63,94,0.1)', color: '#f43f5e', border: '1px solid rgba(244,63,94,0.3)', padding: '8px 14px', borderRadius: '12px', fontSize: '0.85rem', display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '140px'}}>
                      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '15px'}}>
                        <div style={{display: 'flex', flexDirection: 'column'}}>
                          <span style={{fontWeight: 600, fontSize: '1.2em'}}>{isin}</span>
                          {stats && <span style={{fontSize: '0.6rem', color: 'rgba(255,255,255,0.4)', maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{stats.name}</span>}
                        </div>
                        <Trash2 size={16} style={{cursor: 'pointer', opacity: 0.7}} onClick={() => handleRemoveLabIsin(isin)} />
                      </div>
                      
                      {stats && (
                        <div style={{display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'rgba(255,255,255,0.8)', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '5px', marginTop: '2px'}}>
                          <div style={{display: 'flex', flexDirection: 'column'}}>
                            <span style={{fontSize: '0.6rem', color: 'rgba(255,255,255,0.4)'}}>Mean</span>
                            <span style={{color: stats.expected_return >= 0 ? '#10b981' : '#f43f5e'}}>{(stats.expected_return * 100).toFixed(1)}%</span>
                          </div>
                          <div style={{display: 'flex', flexDirection: 'column', textAlign: 'center'}}>
                            <span style={{fontSize: '0.6rem', color: 'rgba(255,255,255,0.4)'}}>Std Dev</span>
                            <span>{(stats.volatility * 100).toFixed(1)}%</span>
                          </div>
                          <div style={{display: 'flex', flexDirection: 'column', textAlign: 'right'}}>
                            <span style={{fontSize: '0.6rem', color: 'rgba(255,255,255,0.4)'}}>Div Yield</span>
                            <span style={{color: '#3b82f6'}}>{stats.dividend_yield !== undefined ? (stats.dividend_yield * 100).toFixed(1) + '%' : '-'}</span>
                          </div>
                        </div>
                      )}

                      {/* Weight input — always visible in custom mode */}
                      <div style={{display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '8px'}}>
                        <input 
                          type="number" 
                          min="0" max="100" step="10" 
                          placeholder="0"
                          value={labCustomWeights[isin] !== undefined ? labCustomWeights[isin] : ''} 
                          onChange={e => setLabCustomWeights({...labCustomWeights, [isin]: e.target.value})}
                          style={{width: '60px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '6px', padding: '6px 8px', fontSize: '0.9rem', textAlign: 'right'}}
                        /><span style={{fontSize: '0.8rem', opacity: 0.8}}>%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{display: 'flex', gap: '15px', marginBottom: '15px', flexWrap: 'wrap', alignItems: 'center'}}>
                <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                  <span style={{fontSize: '0.85rem', color: 'rgba(255,255,255,0.7)'}}>{t('lab.template')}:</span>
                  <button onClick={() => applyLabTemplate(['VTI', 'TLT', 'IEF', 'GLD', 'DBC'], {'VTI':30,'TLT':40,'IEF':15,'GLD':7.5,'DBC':7.5})} className="action-btn-secondary" style={{fontSize: '0.75rem', padding: '4px 8px'}}>All‑Weather</button>
                  <button onClick={() => applyLabTemplate(['SPY', 'BND'], { 'SPY': 60, 'BND': 40 })} className="action-btn-secondary" style={{fontSize: '0.75rem', padding: '4px 8px'}}>60/40</button>
                  <button onClick={() => applyLabTemplate(['VTI', 'VBR', 'TLT', 'SHY', 'GLD'], {'VTI':20,'VBR':20,'TLT':20,'SHY':20,'GLD':20})} className="action-btn-secondary" style={{fontSize: '0.75rem', padding: '4px 8px'}}>Golden Butterfly</button>
                </div>
                <div style={{display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto'}}>
                  <span style={{fontSize: '0.85rem', color: 'rgba(255,255,255,0.7)'}}>{t('lab.backtestPeriod')}:</span>
                  <select value={labDaysBack} onChange={e => setLabDaysBack(parseInt(e.target.value))} style={{background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '4px', padding: '4px', fontSize: '0.8rem'}}>
                   <option value={1825}>{t('lab.years') === 'Years' ? '5 Years' : '5年'}</option>
                   <option value={3650}>{t('lab.years') === 'Years' ? '10 Years' : '10年'}</option>
                   <option value={5475}>{t('lab.years') === 'Years' ? '15 Years' : '15年'}</option>
                  </select>
                </div>
                {labSum > 0 && (
                  <div style={{fontSize: '0.8rem', padding: '4px 10px', borderRadius: '6px',
                    background: Math.abs(labSum - 100) < 0.5 ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)',
                    color: Math.abs(labSum - 100) < 0.5 ? '#10b981' : '#f59e0b',
                    border: `1px solid ${Math.abs(labSum - 100) < 0.5 ? 'rgba(16,185,129,0.3)' : 'rgba(245,158,11,0.3)'}`
                  }}>
                    {t('lab.totalWeight')}: {labSum}%{Math.abs(labSum - 100) < 0.5 ? ' ✓' : ` (${t('lab.mustBe100')})`}
                  </div>
                )}
              </div>
              <form onSubmit={handleAddLabIsin} style={{display: 'flex', gap: '10px'}}>
                <input 
                  value={labInput} 
                  onChange={e => setLabInput(e.target.value)} 
                  placeholder={t('lab.isinPlaceholder')} 
                  style={{flex: 1, maxWidth: '300px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', padding: '8px 12px', borderRadius: '8px', color: '#fff'}}
                />
                <button type="submit" className="create-btn" style={{padding: '8px 16px', background: 'rgba(255,255,255,0.1)', color: '#fff'}} disabled={labLoading}><Plus size={16}/> {t('lab.addAsset')}</button>
                <button 
                  type="button" 
                  onClick={handleRunLabAnalysis} 
                  className="create-btn" 
                  style={{
                    padding: '8px 24px', 
                    opacity: isLabReady ? 1 : 0.5, 
                    cursor: isLabReady ? 'pointer' : 'not-allowed',
                    background: isLabReady ? '' : 'rgba(255,255,255,0.05)'
                  }} 
                  disabled={labLoading || !isLabReady}
                >
                  {labLoading ? `${t('lab.analyzing')} ${Math.round(labDaysBack/365)}...` : <><Zap size={16} /> {t('lab.runOptimization')}</>}
                </button>
              </form>
              {labError && <div style={{color: '#f43f5e', background: 'rgba(244,63,94,0.1)', padding: '10px', borderRadius: '8px', marginTop: '15px', fontSize: '0.85rem'}}>{labError}</div>}
              
              {labData && labData.data_warnings && labData.data_warnings.length > 0 && (
                <div style={{color: '#fbbf24', background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.3)', padding: '15px', borderRadius: '12px', marginTop: '15px', fontSize: '0.85rem'}}>
                  <div style={{display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', fontWeight: 600}}>
                    <AlertTriangle size={18} />
                    {t('lab.dataWarnings')}
                  </div>
                  <ul style={{margin: 0, paddingLeft: '20px', lineHeight: '1.6'}}>
                    {labData.data_warnings.map((msg, idx) => (
                      <li key={idx}>{msg}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* ── Phase 2: Results Tabs ── */}
            {labData && (
              <div style={{display: 'flex', gap: '2px', marginBottom: '15px', background: 'rgba(255,255,255,0.03)', padding: '4px', borderRadius: '8px', width: 'fit-content'}}>
                <button 
                  onClick={() => setLabTab('optimization')}
                  style={{
                    padding: '8px 20px', fontSize: '0.85rem', border: 'none', borderRadius: '6px', cursor: 'pointer',
                    background: labTab === 'optimization' ? '#818cf8' : 'transparent',
                    color: labTab === 'optimization' ? '#fff' : 'rgba(255,255,255,0.5)',
                    fontWeight: labTab === 'optimization' ? 600 : 400,
                    transition: 'all 0.2s'
                  }}
                >
                  <Search size={14} style={{marginRight: '6px'}} /> {t('lab.tabOptimization')}
                </button>
                <button 
                  onClick={() => setLabTab('backtest')}
                  style={{
                    padding: '8px 20px', fontSize: '0.85rem', border: 'none', borderRadius: '6px', cursor: 'pointer',
                    background: labTab === 'backtest' ? '#818cf8' : 'transparent',
                    color: labTab === 'backtest' ? '#fff' : 'rgba(255,255,255,0.5)',
                    fontWeight: labTab === 'backtest' ? 600 : 400,
                    transition: 'all 0.2s'
                  }}
                >
                  <History size={14} style={{marginRight: '6px'}} /> {t('lab.tabBacktest')}
                </button>
              </div>
            )}

            {/* ── Portfolio Comparison Table ─────────────────────────────────── */}
            {labData && (
              <div className="glass-card" style={{marginBottom: '20px'}}>
                <div style={{display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px'}}>
                  <h3 style={{margin: 0}}>{t('lab.portfolioComparison')}</h3>
                  <span style={{fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.06)', padding: '2px 10px', borderRadius: '12px'}}>
                    {labData.data_points} {t('lab.tradingDays')}
                  </span>
                  {labData.mc_target_label && (
                    <span style={{fontSize: '0.72rem', color: '#818cf8', background: 'rgba(129,140,248,0.1)', padding: '2px 10px', borderRadius: '12px', marginLeft: 'auto'}}>
                      {t('lab.mcActiveOn')}
                    </span>
                  )}
                </div>
                <div style={{overflowX: 'auto'}}>
                  <table style={{width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem'}}>
                    <thead>
                      <tr style={{borderBottom: '1px solid rgba(255,255,255,0.1)'}}>
                        <th style={{textAlign: 'left', padding: '10px 14px', color: 'rgba(255,255,255,0.4)', fontWeight: 400}}>{t('lab.metric')}</th>
                        {labData.custom_portfolio && (
                          <th style={{padding: '10px 14px', color: '#f43f5e', fontWeight: 600, textAlign: 'center'}}>{t('lab.customAllocation')}</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { label: t('lab.annualReturn'), key: 'expected_return', fmt: v => v != null ? (v*100).toFixed(2)+'%' : '–', col: '#10b981' },
                        { label: t('lab.volatility'),    key: 'volatility',      fmt: v => v != null ? (v*100).toFixed(2)+'%' : '–', col: '#f43f5e' },
                        { label: t('lab.sharpeRatio'),   key: 'sharpe_ratio',    fmt: v => v != null ? v.toFixed(3) : '–',            col: null      },
                      ].map(row => (
                        <tr key={row.label} style={{borderBottom: '1px solid rgba(255,255,255,0.05)'}}>
                          <td style={{padding: '10px 14px', color: 'rgba(255,255,255,0.6)'}}>{row.label}</td>
                          {labData.custom_portfolio && (
                            <td style={{padding: '10px 14px', textAlign: 'center', fontWeight: 600, color: row.col || '#fff'}}>
                              {row.fmt(labData.custom_portfolio[row.key])}
                            </td>
                          )}
                        </tr>
                      ))}
                      {(() => {
                        if (!labData.monte_carlo) return null;
                        const last = labData.monte_carlo.chart.slice(-1)[0];
                        const srColor = labData.monte_carlo.success_rate > 0.8 ? '#10b981' : labData.monte_carlo.success_rate > 0.5 ? '#f59e0b' : '#f43f5e';
                        
                        return (
                          <>
                            <tr style={{borderBottom: '1px solid rgba(255,255,255,0.05)', background: 'rgba(129,140,248,0.04)'}}>
                              <td style={{padding: '10px 14px', color: 'rgba(255,255,255,0.6)'}}>{t('lab.mcMedian')} ({labMcSettings.years}yr)</td>
                              {labData.custom_portfolio && (
                                <td style={{padding: '10px 14px', textAlign: 'center', fontWeight: 600, color: '#818cf8'}}>${(last.p50/1000).toFixed(0)}K</td>
                              )}
                            </tr>
                            {labData.monte_carlo.success_rate !== null && (
                              <tr style={{background: 'rgba(129,140,248,0.04)'}}>
                                <td style={{padding: '10px 14px', color: 'rgba(255,255,255,0.6)'}}>{t('lab.successRate')}</td>
                                {labData.custom_portfolio && (
                                  <td style={{padding: '10px 14px', textAlign: 'center', fontWeight: 600, color: srColor}}>{(labData.monte_carlo.success_rate*100).toFixed(1)}%</td>
                                )}
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

            {labTab === 'backtest' && labData && (
              <div className="glass-card" style={{marginBottom: '20px'}}>
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '25px'}}>
                  <div>
                    <h3 style={{margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.4rem'}}><History size={24} color="#818cf8"/> {t('lab.historicalPerf')}</h3>
                    <p style={{fontSize: '0.9rem', color: 'rgba(255,255,255,0.6)', margin: '6px 0 0'}}>
                      {t('lab.historicalPerfSub')} {labData.data_points} {t('lab.tradingDays')}.
                    </p>
                  </div>
                  <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
                    <div style={{display: 'flex', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)'}}>
                      <button onClick={() => setLabChartFontSize(p => Math.max(10, p - 2))} style={{padding: '6px 10px', background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', borderRight: '1px solid rgba(255,255,255,0.1)'}}>A-</button>
                      <div style={{padding: '6px 10px', fontSize: '0.85rem', color: 'rgba(255,255,255,0.6)', display: 'flex', alignItems: 'center'}}>{labChartFontSize}px</div>
                      <button onClick={() => setLabChartFontSize(p => Math.min(24, p + 2))} style={{padding: '6px 10px', background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', borderLeft: '1px solid rgba(255,255,255,0.1)'}}>A+</button>
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
                      <div style={{height: 450, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px dashed rgba(255,255,255,0.1)'}}>
                        <Info size={32} style={{marginBottom: '10px', opacity: 0.5}}/>
                        <p style={{margin: 0, fontWeight: 500}}>Insufficient Historical Data for Chart</p>
                        <p style={{margin: '5px 0 0', fontSize: '0.8rem', opacity: 0.7}}>Assets in this portfolio do not have enough overlapping price history to synthesize a backtest.</p>
                      </div>
                    );
                  }

                  const lines = [
                    <Line key="bench" type="monotone" dataKey="benchmark" stroke="rgba(255,255,255,0.4)" strokeWidth={1} strokeDasharray="3 3" dot={false} name="Benchmark (SPY)" />
                  ];
                  
                  if (labData.max_sharpe?.backtest) {
                    lines.push(<Line key="ms" type="monotone" dataKey="max_sharpe" stroke="#10b981" strokeWidth={2} dot={false} name="Max Sharpe" />);
                  }
                  if (labData.min_volatility?.backtest) {
                    lines.push(<Line key="mv" type="monotone" dataKey="min_volatility" stroke="#818cf8" strokeWidth={2} dot={false} name="Min Volatility" />);
                  }
                  if (labData.risk_parity?.backtest) {
                    lines.push(<Line key="rp" type="monotone" dataKey="risk_parity" stroke="#6366f1" strokeWidth={2} dot={false} name="Risk Parity" />);
                  }
                  if (labData.custom_portfolio?.backtest) {
                    lines.push(<Line key="cp" type="monotone" dataKey="custom" stroke="#f43f5e" strokeWidth={3} dot={false} name="Custom Portfolio" />);
                  }

                  return (
                    <ResponsiveContainer width="100%" height={450}>
                      <LineChart data={combinedChartData} margin={{ top: 10, right: 30, left: 20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="date" hide type="category" allowDuplicatedCategory={false} />
                        <YAxis stroke="rgba(255,255,255,0.3)" tick={{fontSize: labChartFontSize, fill: 'rgba(255,255,255,0.6)'}} domain={['auto', 'auto']} tickFormatter={v => '$' + (v/1000).toFixed(0) + 'k'} />
                        <Tooltip 
                          labelFormatter={v => v}
                          formatter={(v, name) => ['$' + Math.round(v).toLocaleString(), name]}
                          contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', fontSize: `${labChartFontSize + 1}px` }}
                        />
                        <Legend wrapperStyle={{fontSize: `${labChartFontSize}px`, paddingBottom: '10px'}} verticalAlign="top" height={Math.max(42, labChartFontSize * 2 + 10)}/>
                        {lines}
                      </LineChart>
                    </ResponsiveContainer>
                  );
                })()}

                <div style={{display: 'flex', gap: '15px', marginTop: '20px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '20px'}}>
                  {[
                    ...(labData.custom_portfolio ? [{name: t('lab.customAllocation'), key: 'custom_portfolio', color: '#f43f5e'}] : [])
                  ].map(p => {
                    const bt = labData[p.key]?.backtest;
                    if (!bt || bt.length === 0) return null;
                    const end = bt[bt.length-1].value;
                    const totalRet = (end/10000 - 1) * 100;
                    return (
                      <div key={p.key} style={{flex: 1, padding: '15px', borderRadius: '10px', background: 'rgba(255,255,255,0.03)', border: `1px solid ${p.color}22`}}>
                        <div style={{fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)', marginBottom: '5px'}}>{p.name}</div>
                        <div style={{fontSize: '1.2rem', fontWeight: 700, color: p.color}}>{totalRet > 0 ? '+' : ''}{totalRet.toFixed(1)}%</div>
                        <div style={{fontSize: '0.65rem', color: 'rgba(255,255,255,0.3)'}}>Total Return</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {labTab === 'optimization' && labData && (
              <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', alignItems: 'start', marginBottom: '20px'}}>
                <div style={{display: 'flex', flexDirection: 'column', gap: '20px'}}>
                   {labData.custom_portfolio && (
                     <div className="glass-card" style={{border: '1px solid rgba(244,63,94,0.3)'}}>
                       <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: '15px'}}><h3 style={{margin: 0, color: '#f43f5e'}}>{t('lab.customAllocation')}</h3><button onClick={() => handleDeployLabStrategy(labData.custom_portfolio.allocations)} className="action-btn-secondary" style={{fontSize: '0.75rem'}}>{t('lab.deploy')}</button></div>
                       <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: '12px', fontSize: '0.7rem', color: 'rgba(255,255,255,0.7)', background: 'rgba(0,0,0,0.15)', padding: '10px', borderRadius: '6px'}}>
                          <div style={{textAlign: 'center'}}><div>{t('lab.annualReturn')}</div><div style={{fontWeight: 600, color: '#10b981', marginTop: '2px'}}>{(labData.custom_portfolio.expected_return * 100).toFixed(1)}%</div></div>
                          <div style={{textAlign: 'center'}}><div>{t('lab.volatility')}</div><div style={{fontWeight: 600, color: '#f59e0b', marginTop: '2px'}}>{(labData.custom_portfolio.volatility * 100).toFixed(1)}%</div></div>
                          <div style={{textAlign: 'center'}}><div>{t('lab.sharpeRatio')}</div><div style={{fontWeight: 600, marginTop: '2px'}}>{labData.custom_portfolio.sharpe_ratio?.toFixed(2)}</div></div>
                          <div style={{textAlign: 'center'}}><div>{t('lab.divYieldLabel')}</div><div style={{fontWeight: 600, color: '#3b82f6', marginTop: '2px'}}>{(labData.custom_portfolio.dividend_yield * 100).toFixed(2)}%</div></div>
                       </div>
                       <div style={{background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px'}}>
                          {Object.entries(labData.custom_portfolio.allocations).sort((a,b)=>b[1]-a[1]).map(([isin, w]) => (
                            <div key={isin} style={{display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '4px'}}>
                              <span style={{color: 'rgba(255,255,255,0.6)'}}>{isin}</span><span style={{fontWeight: 600}}>{(w*100).toFixed(1)}%</span>
                            </div>
                          ))}
                       </div>
                     </div>
                   )}
                </div>
                <div style={{display: 'flex', flexDirection: 'column', gap: '20px'}}>
                  {labData.correlation_matrix && labData.valid_assets && (
                    <div className="glass-card">
                      <h3 style={{marginTop: 0, marginBottom: '15px'}}>Correlation Matrix</h3>
                      <div style={{display: 'grid', gridTemplateColumns: `80px repeat(${labData.valid_assets.length}, 1fr)`, gap: '2px', fontSize: '0.7rem'}}>
                        <div />
                        {labData.valid_assets.map(a => <div key={a} style={{textAlign: 'center', color:'rgba(255,255,255,0.5)'}}>{a}</div>)}
                        {labData.valid_assets.map(a1 => (
                          <React.Fragment key={a1}>
                            <div style={{color: 'rgba(255,255,255,0.5)', textAlign: 'right', paddingRight: '6px'}}>{a1}</div>
                            {labData.valid_assets.map(a2 => {
                               const val = labData.correlation_matrix.find(c => (c.asset1 === a1 && c.asset2 === a2) || (c.asset1 === a2 && c.asset2 === a1))?.value || 0;
                               const alpha = Math.abs(val) * 0.4;
                               return <div key={a2} style={{background: `rgba(129,140,248, ${alpha})`, aspectRatio: '1/1', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '2px'}}>{val.toFixed(1)}</div>;
                            })}
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}



            {/* Monte Carlo Projection full-width module */}
            {labData && labData.monte_carlo && (
              <div className="glass-card" style={{marginTop: '20px', display: 'flex', flexDirection: 'column'}}>
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px'}}>
                  <div>
                    <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
                      <h3 style={{marginTop: 0, marginBottom: '4px'}}>{labMcSettings.years}{t('lab.mcProjection')}</h3>
                      <button 
                        onClick={() => setShowMcDoc(true)} 
                        style={{background: 'rgba(255,255,255,0.05)', border: 'none', color: '#818cf8', borderRadius: '50%', width: '22px', height: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer'}}
                        title="View Documentation"
                      >
                        <HelpCircle size={14} />
                      </button>
                    </div>
                    <p style={{fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)', margin: 0}}>
                      {labData.custom_portfolio ? `Simulated via Geometric Brownian Motion (10,000 paths) on your Custom Allocation.` : `Simulated via Geometric Brownian Motion (10,000 paths) on the Maximum Sharpe portfolio.`}
                      {labData.monte_carlo.stressed_volatility && <span style={{color: '#f43f5e', marginLeft: '5px'}}>(Stress Mode Active)</span>}
                    </p>
                  </div>
                  <div style={{display: 'flex', gap: '15px'}}></div>
                </div>

                {/* Simulation Control Panels Container */}
                <div style={{display: 'flex', flexDirection: 'column', gap: '20px', marginBottom: '20px'}}>
                  {/* Block 1: 波动资产假设 (Portfolio Assumptions) */}
                  <div style={{background: 'rgba(0,0,0,0.2)', padding: '15px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)'}}>
                    <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '15px'}}>
                      <h3 style={{margin: '0', fontSize: '1rem', color: '#60a5fa'}}>1. 波动投资组合配置 (Portfolio Cash Flows)</h3>
                      {labData?.monte_carlo?.chart && (
                        <div style={{display: 'flex', gap: '15px'}}>
                          {[
                            {label: '乐观 (90th)', key: 'p90', color: '#10b981'},
                            {label: '中性 (50th)', key: 'p50', color: '#818cf8'},
                            {label: '悲观 (10th)', key: 'p10', color: '#f43f5e'}
                          ].map(s => {
                            const mcChart = labData.monte_carlo.chart;
                            const lastVal = mcChart[mcChart.length - 1][s.key];
                            const cagr = (Math.pow(lastVal / (labMcSettings.capital || 1), 1 / labMcSettings.years) - 1) * 100;
                            const irrVal = labData.monte_carlo.irr?.[s.key] * 100;

                            return (
                              <div key={s.key} style={{textAlign: 'right'}}>
                                <div style={{fontSize: '0.7rem', color: 'rgba(255,255,255,0.5)'}}>{s.label}</div>
                                <div style={{fontSize: '0.9rem', fontWeight: 600, color: cagr <= -99.9 ? '#ef4444' : s.color}}>
                                  {cagr <= -99.9 ? (
                                    <>{t('lab.depleted')} <span style={{fontSize: '0.6rem', color: 'rgba(255,255,255,0.4)', fontWeight: 400}}>{t('lab.depletedSub')}</span></>
                                  ) : (
                                    <>{cagr > 0 ? '+' : ''}{cagr.toFixed(2)}% <span style={{fontSize: '0.6rem', color: 'rgba(255,255,255,0.4)', fontWeight: 400}}>CAGR</span></>
                                  )}
                                  {irrVal !== undefined && (
                                    <div style={{fontSize: '0.75rem', fontWeight: 500, marginTop: '-2px', color: 'rgba(255,255,255,0.8)'}}>
                                      {irrVal > 0 ? '+' : ''}{irrVal.toFixed(2)}% <span style={{fontSize: '0.6rem', color: 'rgba(255,255,255,0.4)', fontWeight: 400}}>IRR</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}

                    </div>
                    <div style={{display: 'flex', gap: '15px', flexWrap: 'wrap'}}>
                      {/* Initial Capital — ILP 启用时显示联动标识 */}
                      <div style={{display: 'flex', flexDirection: 'column', gap: '4px'}}>
                        <span style={{fontSize: '0.75rem', color: ilpEnabled ? '#818cf8' : 'rgba(255,255,255,0.6)', display: 'flex', alignItems: 'center', gap: '4px'}}>
                          {ilpEnabled && <span title="已与ILP保费联动" style={{fontSize: '0.7rem'}}>🔗</span>}
                          Initial Capital ($)
                          {ilpEnabled && <span style={{fontSize: '0.62rem', color: 'rgba(99,102,241,0.7)'}}>= 整付保费</span>}
                        </span>
                        <NumberInputWithCommas
                          value={labMcSettings.capital}
                          onChange={v => setLabMcSettings({...labMcSettings, capital: v})}
                          style={{
                            background: ilpEnabled ? 'rgba(99,102,241,0.08)' : 'rgba(255,255,255,0.05)',
                            border: `1px solid ${ilpEnabled ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.1)'}`,
                            color: '#fff', borderRadius: '4px', padding: '6px', width: '100px'
                          }}
                        />
                      </div>

                      {/* Annual Add — ILP 启用时锁定为 0 */}
                      <div style={{display: 'flex', flexDirection: 'column', gap: '4px'}}>
                        <span style={{fontSize: '0.75rem', color: ilpEnabled ? 'rgba(255,160,60,0.8)' : 'rgba(255,255,255,0.6)', display: 'flex', alignItems: 'center', gap: '4px'}}>
                          {ilpEnabled && <span style={{fontSize: '0.7rem'}}>🔒</span>}
                          Annual Add ($) | Yr Start-End
                          {ilpEnabled && <span style={{fontSize: '0.62rem', color: 'rgba(255,160,60,0.7)'}}>已锁定 = 0</span>}
                        </span>
                        <div style={{display: 'flex', gap: '5px'}}>
                          <NumberInputWithCommas
                            value={ilpEnabled ? 0 : labMcSettings.contribution}
                            onChange={v => !ilpEnabled && setLabMcSettings({...labMcSettings, contribution: v})}
                            style={{
                              background: ilpEnabled ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.05)',
                              border: `1px solid ${ilpEnabled ? 'rgba(255,160,60,0.2)' : 'rgba(255,255,255,0.1)'}`,
                              color: ilpEnabled ? 'rgba(255,255,255,0.3)' : '#fff',
                              borderRadius: '4px', padding: '6px', width: '80px',
                              cursor: ilpEnabled ? 'not-allowed' : 'text',
                            }}
                          />
                          <input type="number" value={labMcSettings.contribution_start}
                            onChange={e => !ilpEnabled && setLabMcSettings({...labMcSettings, contribution_start: e.target.value})}
                            disabled={ilpEnabled}
                            style={{background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: ilpEnabled ? 'rgba(255,255,255,0.3)' : '#fff', borderRadius: '4px', padding: '6px', width: '40px', cursor: ilpEnabled ? 'not-allowed' : 'text'}} title="Start Year" />
                          <span style={{color: 'rgba(255,255,255,0.5)', alignSelf: 'center'}}>-</span>
                          <input type="number" value={labMcSettings.contribution_years}
                            onChange={e => !ilpEnabled && setLabMcSettings({...labMcSettings, contribution_years: e.target.value})}
                            disabled={ilpEnabled}
                            style={{background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: ilpEnabled ? 'rgba(255,255,255,0.3)' : '#fff', borderRadius: '4px', padding: '6px', width: '40px', cursor: ilpEnabled ? 'not-allowed' : 'text'}} title="End Year" />
                        </div>
                        {ilpEnabled && (
                          <span style={{fontSize: '0.62rem', color: 'rgba(255,160,60,0.6)', lineHeight: 1.4}}>
                            ILP 为整付保费产品，无后续追加
                          </span>
                        )}
                      </div>

                      <div style={{display: 'flex', flexDirection: 'column', gap: '4px'}}>
                        <span style={{fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)'}}>Annual Draw ($) | Yr Start-End</span>
                        <div style={{display: 'flex', gap: '5px', marginBottom: '2px'}}>
                          <NumberInputWithCommas value={labMcSettings.withdrawal} onChange={v => setLabMcSettings({...labMcSettings, withdrawal: v})} style={{background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '4px', padding: '6px', width: '80px'}} />
                          <input type="number" value={labMcSettings.withdrawal_start} onChange={e => setLabMcSettings({...labMcSettings, withdrawal_start: e.target.value})} style={{background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '4px', padding: '6px', width: '40px'}} title="Start Year" />
                          <span style={{color: 'rgba(255,255,255,0.5)', alignSelf: 'center'}}>-</span>
                          <input type="number" value={labMcSettings.withdrawal_end} onChange={e => setLabMcSettings({...labMcSettings, withdrawal_end: e.target.value})} style={{background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '4px', padding: '6px', width: '40px'}} title="End Year" />
                        </div>
                        <div style={{display: 'flex', gap: '5px'}}>
                          <NumberInputWithCommas value={labMcSettings.withdrawal_2 || 0} onChange={v => setLabMcSettings({...labMcSettings, withdrawal_2: v})} style={{background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '4px', padding: '6px', width: '80px'}} />
                          <input type="number" value={labMcSettings.withdrawal_start_2 || 1} onChange={e => setLabMcSettings({...labMcSettings, withdrawal_start_2: e.target.value})} style={{background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '4px', padding: '6px', width: '40px'}} title="Start Year (Stage 2)" />
                          <span style={{color: 'rgba(255,255,255,0.5)', alignSelf: 'center'}}>-</span>
                          <input type="number" value={labMcSettings.withdrawal_end_2 || 100} onChange={e => setLabMcSettings({...labMcSettings, withdrawal_end_2: e.target.value})} style={{background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '4px', padding: '6px', width: '40px'}} title="End Year (Stage 2)" />
                        </div>
                        <label style={{display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '0.7rem', color: labMcSettings.withdrawal_inflation ? '#a855f7' : 'rgba(255,255,255,0.4)', marginTop: '2px'}}>
                          <input type="checkbox" checked={labMcSettings.withdrawal_inflation} onChange={e => setLabMcSettings({...labMcSettings, withdrawal_inflation: e.target.checked})} style={{accentColor: '#a855f7'}} />
                          随通胀调整 (Adjust w/ Inflation)
                        </label>
                      </div>
                      <div style={{display: 'flex', flexDirection: 'column', gap: '4px'}}>
                        <span style={{fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)'}}>Years</span>
                        <input type="number" value={labMcSettings.years} onChange={e => setLabMcSettings({...labMcSettings, years: e.target.value})} style={{background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '4px', padding: '6px', width: '60px'}} />
                      </div>

                    </div>
                  </div>

                  {/* ILP 投连险 Toggle（位于 Block 1 末尾） */}
                  <div style={{
                    marginTop: '14px', paddingTop: '14px',
                    borderTop: '1px solid rgba(255,255,255,0.08)'
                  }}>
                    <div
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        cursor: 'pointer', padding: '8px 12px', borderRadius: '8px',
                        background: ilpEnabled ? 'rgba(99,102,241,0.1)' : 'rgba(255,255,255,0.02)',
                        border: `1px solid ${ilpEnabled ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.08)'}`,
                        transition: '0.2s'
                      }}
                      onClick={() => setIlpEnabled(!ilpEnabled)}
                    >
                      <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                        <span style={{fontSize: '1.1rem'}}>🔗</span>
                        <span style={{fontWeight: 600, color: ilpEnabled ? '#818cf8' : 'rgba(255,255,255,0.7)'}}>通过投连险（ILP）实现本组合</span>
                        <span style={{fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)'}}>费用自动从回报中扣减，叠加奖赏收益</span>
                      </div>
                      <div style={{
                        width: '40px', height: '22px', borderRadius: '11px',
                        background: ilpEnabled ? '#818cf8' : 'rgba(255,255,255,0.2)',
                        position: 'relative', transition: 'background 0.2s'
                      }}>
                        <div style={{
                          width: '18px', height: '18px', borderRadius: '50%', background: '#fff',
                          position: 'absolute', top: '2px', left: ilpEnabled ? '20px' : '2px',
                          transition: 'left 0.2s'
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

                  {/* Block 2: 稳健保险配置 (Insurance Configuration) */}
                  <div style={{background: 'rgba(0,0,0,0.2)', padding: '15px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)'}}>
                    <h3 style={{margin: '0 0 15px 0', fontSize: '1rem', color: '#10b981'}}>2. 稳健保险产品配置 (Insurance Plan Integration)</h3>
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

                  {/* Block 3: 合并现金流预览图 (Combined Cash Flow) */}
                  {(() => {
                    const maxYears = parseInt(labMcSettings.years) || 40;
                    const initialCapital = parseFloat(labMcSettings.capital) || 0;
                    const cfData = [];
                    // Year 0: Initial capital injection
                    cfData.push({
                      name: 'Yr 0',
                      portOutflow: initialCapital > 0 ? -initialCapital : 0,
                      insOutflow: 0,
                      portInflow: 0,
                      insInflow: 0,
                    });
                    for(let y=1; y<=maxYears; y++) {
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
                    let cumTotalDiv = 0;   // 累计总分红（含抵扣+复投）
                    let cumReinvested = 0; // 仅复投部分（图表用）
                    let breakevenYear = null;
                    let firstYearDiv = 0;
                    let lastYearDiv = 0;
                    let maxDivYears = 0;
                    const targetWithdrawal = parseFloat(labMcSettings.withdrawal) || 0;

                    // 总投入本金 = 初始本金 + 所有年度追加投入合计
                    const contribPerYear = parseFloat(labMcSettings.contribution) || 0;
                    const contribStart   = parseInt(labMcSettings.contribution_start) || 1;
                    const contribEnd     = parseInt(labMcSettings.contribution_years) || 0;
                    const numContribYears = contribEnd >= contribStart ? contribEnd - contribStart + 1 : 0;
                    const totalContributions = contribPerYear * numContribYears;
                    const totalCapitalInvested = initialCapital + totalContributions; // 零成本拐点基准

                    if (labData?.monte_carlo?.chart) {
                      labData.monte_carlo.chart.forEach((d, i) => {
                         if (i === 0) return; // Skip year 0
                         maxDivYears = i;
                         const divOff = d.div_offset || 0;
                         const divRe = d.div_reinvested || 0;
                         const divGen = divOff + divRe;
                         
                         if (i === 1) firstYearDiv = divGen;
                         lastYearDiv = divGen;
                         
                         cumTotalDiv += divGen;   // 累计全部分红
                         cumReinvested += divRe;  // 仅复投部分
                         
                         // Breakeven：累计总分红 >= 总投入本金（初始 + 所有追加）
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
                        <div style={{background: 'rgba(0,0,0,0.2)', padding: '15px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', marginBottom: '15px'}}>
                        <h3 style={{margin: '0 0 15px 0', fontSize: '1rem', color: '#f59e0b'}}>3. 综合现金流预览 (Combined Cash Flow to Pocket)</h3>
                        <div style={{ height: 220, width: '100%' }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={cfData}>
                               <CartesianGrid strokeDasharray="3 3" opacity={0.1}/>
                               <XAxis dataKey="name" stroke="rgba(255,255,255,0.5)" fontSize={12} />
                               <YAxis stroke="rgba(255,255,255,0.5)" fontSize={12} tickFormatter={(v)=>'$'+v/1000+'k'} />
                               <Tooltip content={<CombinedCashFlowTooltip />} />
                               <Legend wrapperStyle={{fontSize: '0.85rem'}} />
                               <Bar dataKey="portInflow" stackId="a" fill="#10b981" name="组合流入 (Portfolio Draw)" />
                               <Bar dataKey="insInflow" stackId="a" fill="#3b82f6" name="保险流入 (Insurance Draw)" />
                               <Bar dataKey="portOutflow" stackId="a" fill="#f43f5e" name="组合定投 (Portfolio Contrib)" />
                               <Bar dataKey="insOutflow" stackId="a" fill="#f59e0b" name="保险保费 (Insurance Premium)" />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                      
                      {divData.length > 0 && (
                        <div style={{background: 'rgba(0,0,0,0.2)', padding: '15px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)'}}>
                          <h3 style={{margin: '0 0 15px 0', fontSize: '1rem', color: '#10b981', display: 'flex', alignItems: 'center', gap: '8px'}}>
                            4. 内生分红与复投追踪 (Dividend Lifecycle)
                            <button
                              onClick={() => setShowDivDoc(!showDivDoc)}
                              style={{background: 'none', border: 'none', color: '#818cf8', cursor: 'pointer', padding: 0, display: 'flex', transition: 'color 0.2s'}}
                              title="什么是累计复投差额比？"
                            >
                              <HelpCircle size={16} />
                            </button>
                          </h3>
                          
                          {showDivDoc && (
                            <div style={{background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', padding: '12px 16px', borderRadius: '8px', marginBottom: '15px', fontSize: '0.85rem', color: 'rgba(255,255,255,0.9)', lineHeight: 1.6}}>
                              <strong style={{color: '#60a5fa'}}>💡 财务指标与内生分红追踪指南</strong><br />
                              <ul style={{margin: '8px 0 0 20px', padding: 0}}>
                                <li style={{marginBottom: '4px'}}><strong style={{color: '#10b981'}}>期末成本收益率 (YOC)</strong>: 模拟期末当年的总分红金额，占最初投入总本金的比例。它直观反映了随时间推移，资产自身持续派息能力的成长情况。</li>
                                <li style={{marginBottom: '4px'}}><strong style={{color: '#3b82f6'}}>分红复合增长率 (DGR)</strong>: 模拟周期内，每年分红金额的年化复合增长率。体现了这套方案的被动收入抵抗真实世界通货膨胀的能力。</li>
                                <li style={{marginBottom: '4px'}}><strong style={{color: '#f59e0b'}}>期末目标支出覆盖率</strong>: 期末当年的总分红除以您设定的年度提款需求。若达到或超过 100%，意味着仅靠分红就足以完全覆盖您的日常目标开销。</li>
                                <li style={{marginBottom: '4px'}}><strong style={{color: '#a855f7'}}>零成本拐点 (Breakeven)</strong>: 累计未提取并重新买入底仓的内生分红总额，达到初始投入本金所需的年数。意味着光靠“利滚利”就能收回最初本金。</li>
                                <li><strong style={{color: '#3b82f6'}}>累计总分红比 (vs Capital %)</strong>: 图表蓝线，表示累计总分红（含抵扣提取+复投两部分）占初始本金的百分比。蓝线突破100%即为零成本拐点。</li>
                              </ul>
                            </div>
                          )}

                          <div style={{display: 'flex', gap: '15px', marginBottom: '15px', flexWrap: 'wrap'}}>
                            <div style={{flex: 1, minWidth: '130px', background: 'rgba(0,0,0,0.3)', padding: '12px', borderRadius: '8px', borderLeft: '3px solid #10b981'}}>
                               <div style={{fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer'}} onClick={() => setShowDivDoc(!showDivDoc)}>
                                 期末成本收益率 (YOC)
                                 <HelpCircle size={12} />
                               </div>
                               <div style={{fontSize: '1.25rem', fontWeight: 600, color: '#10b981'}}>{yocFinal.toFixed(2)}%</div>
                            </div>
                            <div style={{flex: 1, minWidth: '130px', background: 'rgba(0,0,0,0.3)', padding: '12px', borderRadius: '8px', borderLeft: '3px solid #3b82f6'}}>
                               <div style={{fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer'}} onClick={() => setShowDivDoc(!showDivDoc)}>
                                 分红复合增长率 (DGR)
                                 <HelpCircle size={12} />
                               </div>
                               <div style={{fontSize: '1.25rem', fontWeight: 600, color: '#3b82f6'}}>{dgr.toFixed(2)}%</div>
                            </div>
                            <div style={{flex: 1, minWidth: '130px', background: 'rgba(0,0,0,0.3)', padding: '12px', borderRadius: '8px', borderLeft: '3px solid #f59e0b'}}>
                               <div style={{fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer'}} onClick={() => setShowDivDoc(!showDivDoc)}>
                                 期末目标支出覆盖率
                                 <HelpCircle size={12} />
                               </div>
                               <div style={{fontSize: '1.25rem', fontWeight: 600, color: '#f59e0b'}}>{targetWithdrawal > 0 ? incomeReplacement.toFixed(1) + '%' : 'N/A'}</div>
                            </div>
                            <div style={{flex: 1, minWidth: '130px', background: 'rgba(0,0,0,0.3)', padding: '12px', borderRadius: '8px', borderLeft: '3px solid #a855f7'}}>
                               <div style={{fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer'}} onClick={() => setShowDivDoc(!showDivDoc)}>
                                 零成本拐点 (Breakeven)
                                 <HelpCircle size={12} />
                               </div>
                               <div style={{fontSize: '1.25rem', fontWeight: 600, color: '#a855f7'}}>{breakevenText}</div>
                            </div>
                          </div>

                          <div style={{ height: 220, width: '100%' }}>
                            <ResponsiveContainer width="100%" height="100%">
                              <ComposedChart data={divData}>
                                 <CartesianGrid strokeDasharray="3 3" opacity={0.1}/>
                                 <XAxis dataKey="name" stroke="rgba(255,255,255,0.5)" fontSize={12} />
                                 <YAxis yAxisId="left" stroke="rgba(255,255,255,0.5)" fontSize={12} tickFormatter={(v)=>'$'+(v/1000).toFixed(0)+'k'} />
                                 <YAxis yAxisId="right" orientation="right" stroke="rgba(255,255,255,0.5)" fontSize={12} tickFormatter={(v)=>v.toFixed(1)+'%'} />
                                 <Tooltip contentStyle={{backgroundColor: '#1f2937', borderColor: '#374151', color: '#fff'}} formatter={(val, name) => {
                                    if(name.includes('比') || name.includes('YOC')) return val.toFixed(1) + '%';
                                    return '$' + Math.abs(val).toLocaleString();
                                 }} />
                                 <Legend wrapperStyle={{fontSize: '0.85rem'}} />
                                 <Bar yAxisId="left" dataKey="divOffset" stackId="div" fill="#f59e0b" name="抵扣提取 (Offset)" />
                                 <Bar yAxisId="left" dataKey="divReinvested" stackId="div" fill="#10b981" name="滚雪球复投 (Reinvested)" />
                                 <Line yAxisId="right" type="monotone" dataKey="cumReinvestedPct" stroke="#3b82f6" strokeWidth={2} dot={false} name="累计总分红比 (vs Capital %)" />
                                 <Line yAxisId="left" type="monotone" dataKey="cumReinvestedValue" stroke="rgba(59,130,246,0.3)" strokeDasharray="3 3" dot={false} name="累计总分红绝对值 ($)" />
                                 <Line yAxisId="right" type="monotone" dataKey="yoc" stroke="#10b981" strokeWidth={0} dot={false} activeDot={false} isAnimationActive={false} legendType="none" name="当年分红占初始投入 (YOC)" />
                              </ComposedChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      )}
                    </>
                  )
                })()}

                  {/* Actions & Global Settings */}
                  <div style={{display: 'flex', gap: '15px', flexWrap: 'wrap', alignItems: 'center', background: 'rgba(0,0,0,0.2)', padding: '15px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)'}}>
                    <label style={{display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.85rem', color: labMcSettings.stress ? '#f43f5e' : 'rgba(255,255,255,0.8)'}}>
                      <input type="checkbox" checked={labMcSettings.stress} onChange={e => setLabMcSettings({...labMcSettings, stress: e.target.checked})} style={{cursor: 'pointer'}} />
                      Enable Stress Mode (Correlation Spike)
                    </label>
                    <label style={{display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.85rem', color: 'rgba(255,255,255,0.8)'}}>
                       Inflation %:
                       <input type="number" step="0.1" value={labMcSettings.inflation} onChange={e => setLabMcSettings({...labMcSettings, inflation: e.target.value})} style={{background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '4px', padding: '6px', width: '60px', marginLeft: '4px'}} />
                    </label>
                    <label style={{display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.85rem', color: 'rgba(255,255,255,0.8)'}}>
                       综合目标 (Target Goal):
                       <NumberInputWithCommas value={labMcSettings.target} onChange={v => setLabMcSettings({...labMcSettings, target: v})} style={{background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '4px', padding: '6px', width: '100px', marginLeft: '4px'}} />
                    </label>

                    <div style={{marginLeft: 'auto', display: 'flex', gap: '10px', alignItems: 'center'}}>
                      {labData?.monte_carlo?.success_rate !== undefined && labData.monte_carlo.success_rate !== null && (
                        <div style={{
                          textAlign: 'center', 
                          background: labData.monte_carlo.success_rate > 0.8 ? 'rgba(16,185,129,0.15)' : labData.monte_carlo.success_rate > 0.5 ? 'rgba(245,158,11,0.15)' : 'rgba(244,63,94,0.15)', 
                          padding: '6px 15px', 
                          borderRadius: '8px', 
                          border: `1px solid ${labData.monte_carlo.success_rate > 0.8 ? '#10b981' : labData.monte_carlo.success_rate > 0.5 ? '#f59e0b' : '#f43f5e'}`,
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          minWidth: '120px',
                          marginRight: '15px'
                        }}>
                          <div style={{fontSize: '0.6rem', fontWeight: 600, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', marginBottom: '1px', display: 'flex', alignItems: 'center', gap: '4px'}}>
                            {labData.monte_carlo.success_rate > 0.8 ? '🟢 High Success' : labData.monte_carlo.success_rate > 0.5 ? '🟡 Moderate Risk' : '🔴 Critical Barrier'}
                          </div>
                          <div style={{fontSize: '1.2rem', fontWeight: 800, color: labData.monte_carlo.success_rate > 0.8 ? '#10b981' : labData.monte_carlo.success_rate > 0.5 ? '#f59e0b' : '#f43f5e'}}>
                            {(labData.monte_carlo.success_rate * 100).toFixed(1)}%
                          </div>
                          <div style={{fontSize: '0.6rem', color: 'rgba(255,255,255,0.4)', marginTop: '-2px'}}>Target Reach Prob</div>
                        </div>
                      )}
                      <button 
                        type="button" 
                        onClick={handleRunLabAnalysis} 
                        className="create-btn"
                        style={{padding: '8px 20px', fontSize: '0.9rem'}}
                        disabled={labLoading}
                      >
                        {labLoading ? 'Updating...' : <><Zap size={16} /> 执行综合测试 / Run Monte Carlo</>}
                      </button>
                      <button
                        type="button"
                        onClick={handleGenerateReport}
                        disabled={!labData?.monte_carlo}
                        style={{
                          padding: '8px 20px',
                          fontSize: '0.9rem',
                          background: !labData?.monte_carlo
                            ? 'rgba(255,255,255,0.08)'
                            : 'linear-gradient(135deg, #059669, #10b981)',
                          border: 'none',
                          borderRadius: '8px',
                          color: '#fff',
                          cursor: !labData?.monte_carlo ? 'not-allowed' : 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          fontWeight: 600,
                          opacity: !labData?.monte_carlo ? 0.4 : 1,
                          transition: 'all 0.2s'
                        }}
                      >
                        <>📄 预览客户版报告</>
                      </button>
                      <></> {/* Word 下载已整合至预览报告内部 */}
                      {/* ── Save Scenario Button ── */}
                      {labData?.monte_carlo && (
                        <button
                          type="button"
                          onClick={() => { setScenarioName(''); setSaveDialogOpen(true); }}
                          style={{
                            padding: '8px 16px',
                            fontSize: '0.9rem',
                            background: 'rgba(16,185,129,0.12)',
                            border: '1px solid rgba(16,185,129,0.35)',
                            borderRadius: '8px',
                            color: '#10b981',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            fontWeight: 600,
                            transition: 'all 0.2s'
                          }}
                        >
                          💾 保存此方案
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {(() => {
                  if (!labData.monte_carlo.chart || labData.monte_carlo.chart.length === 0) return null;
                  const lastObj = labData.monte_carlo.chart[labData.monte_carlo.chart.length - 1];
                  const hasInflation = labMcSettings.inflation > 0;
                  const insuranceIsActive = insuranceEnabled && insurancePlan && (labData.monte_carlo.chart?.length > 1 ? labData.monte_carlo.chart[1].ins_cv_p50 !== undefined : false);
                  // 保险相关字段从 year 1 起才有（year 0 是期初本金），判定要看第 1 年而不是第 0 年
                  const probeRow = labData.monte_carlo.chart.length > 1 ? labData.monte_carlo.chart[1] : lastObj;
                  
                  const mcLines = [];
                  
                  if (insuranceIsActive) {
                    // Stacked Bar for Combined Mode
                    mcLines.push(
                      <Bar key="ins_cv_p50" dataKey="ins_cv_p50" stackId="1" fill="#f59e0b" fillOpacity={0.9} name="保底资产基石 (Insurance CV P50)" />,
                      <Bar key="p50" dataKey="p50" stackId="1" fill="#3b82f6" fillOpacity={0.9} name="叠加投资组合波段 (Portfolio P50)" />
                    );
                    mcLines.push(
                      <Line key="combined_p90" type="monotone" dataKey="combined_p90" stroke="#10b981" strokeWidth={2} strokeDasharray="5 5" dot={false} name="合并资产乐观极值 (Combined 90th)" />,
                      <Line key="combined_p10" type="monotone" dataKey="combined_p10" stroke="#ef4444" strokeWidth={2} strokeDasharray="5 5" dot={false} name="合并资产悲观底线 (Combined 10th)" />
                    );
                  } else {
                    // Normal lines (no active insurance)
                    mcLines.push(
                      <Area key="area" type="monotone" dataKey="range" stroke="none" fill="#818cf8" fillOpacity={0.1} />,
                      <Line key="p90" type="monotone" dataKey="p90" stroke="#10b981" strokeWidth={2} strokeDasharray="5 5" dot={false} name="乐观 (Optimistic 90th)" />,
                      <Line key="p50" type="monotone" dataKey="p50" stroke={labData.custom_portfolio ? "#3b82f6" : "#3b82f6"} strokeWidth={3} dot={false} name={labData.custom_portfolio ? "自定义中性 (Neutral 50th)" : "推荐中性 (Neutral 50th)"} />,
                      <Line key="p10" type="monotone" dataKey="p10" stroke="#ef4444" strokeWidth={2} strokeDasharray="5 5" dot={false} name="悲观 (Pessimistic 10th)" />
                    );
                  }
                  
                    if (hasInflation) {
                      if (insuranceIsActive && probeRow.combined_real_p50 !== undefined) {
                        mcLines.push(
                          <Line key="rp50" type="monotone" dataKey="combined_real_p50" stroke="#f59e0b" strokeWidth={2} strokeDasharray="3 3" dot={false} name={`合并资产真实购买力 (Real Value @${labMcSettings.inflation}%)`} />
                        );
                      } else if (probeRow.real_p50 !== undefined) {
                        mcLines.push(
                          <Line key="rp50" type="monotone" dataKey="real_p50" stroke="#f59e0b" strokeWidth={2} strokeDasharray="3 3" dot={false} name={`真实购买力 (Real Value @${labMcSettings.inflation}%)`} />
                        );
                      }
                    }
                  
                  return (
                    <div style={{width: '100%', marginTop: '20px'}}>
                      <div style={{display: 'flex', gap: '15px', marginBottom: '15px'}}>
                        <div style={{flex: 1, height: '450px', background: 'rgba(0,0,0,0.2)', padding: '20px', borderRadius: '12px'}}>
                          {insuranceIsActive ? (
                            // Area Chart wrapper for Stacked mode
                            <ResponsiveContainer width="100%" height="100%">
                              <ComposedChart data={labData.monte_carlo.chart}>
                                <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                                <XAxis dataKey="year" stroke="rgba(255,255,255,0.4)" fontSize={0.8} />
                                <YAxis stroke="rgba(255,255,255,0.4)" fontSize={0.8} tickFormatter={(val) => '$'+(val/1000).toFixed(0)+'k'} domain={[0, 'auto']} />
                                <Tooltip 
                                  content={({ active, payload, label }) => {
                                    if (active && payload && payload.length) {
                                      const dataRow = payload[0]?.payload || {};
                                      const actual_draw = dataRow.actual_draw_p50;
                                      const target_draw = labMcSettings.withdrawal || 0;
                                      const isShortfall = actual_draw !== undefined && target_draw > 0 && actual_draw < target_draw * 0.9;
                                      return (
                                        <div style={{ backgroundColor: 'rgba(15, 23, 42, 0.98)', border: '1px solid rgba(255,255,255,0.15)', padding: '12px 14px', borderRadius: '8px', boxShadow: '0 6px 16px rgba(0,0,0,0.6)', color: '#fff', minWidth: '220px' }}>
                                          <div style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '6px', marginBottom: '8px', fontWeight: '800', fontSize: '0.9rem' }}>第 {label} 年</div>
                                          {payload.map((entry, index) => (
                                            <div key={index} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', padding: '2px 0' }}>
                                              <span style={{ fontSize: '0.72rem', color: entry.color, fontWeight: 500 }}>{entry.name}</span>
                                              <span style={{ fontWeight: 700, color: entry.color, fontFamily: 'monospace', fontSize: '0.85rem' }}>${Math.round(entry.value).toLocaleString()}</span>
                                            </div>
                                          ))}
                                          {(dataRow.div_generated > 0 || (actual_draw !== undefined && target_draw > 0)) && (
                                            <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed rgba(255,255,255,0.15)' }}>
                                              {dataRow.div_generated > 0 && (
                                                <div style={{ marginBottom: (actual_draw !== undefined && target_draw > 0) ? '8px' : '0' }}>
                                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                                                    <span style={{ fontSize: '0.72rem', color: '#10b981' }}>分红总收益 (P50)</span>
                                                    <span style={{ fontWeight: '800', color: '#10b981', fontFamily: 'monospace', fontSize: '0.85rem' }}>+${Math.round(dataRow.div_generated).toLocaleString()}</span>
                                                  </div>
                                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingLeft: '8px' }}>
                                                    <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.4)' }}>↪ 抵扣提取需求</span>
                                                    <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>${Math.round(dataRow.div_offset || 0).toLocaleString()}</span>
                                                  </div>
                                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingLeft: '8px' }}>
                                                    <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.4)' }}>↪ 并入本金复投</span>
                                                    <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>${Math.round(dataRow.div_reinvested || 0).toLocaleString()}</span>
                                                  </div>
                                                </div>
                                              )}
                                              {actual_draw !== undefined && target_draw > 0 && (
                                                <>
                                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>预计实际可提取 (P50)</span>
                                                    <span style={{ fontWeight: '800', color: isShortfall ? '#ef4444' : '#fbbf24', fontFamily: 'monospace', fontSize: '0.85rem' }}>
                                                      ${Math.round(actual_draw).toLocaleString()}
                                                    </span>
                                                  </div>
                                                  {isShortfall && (
                                                    <div style={{ fontSize: '0.65rem', color: '#ef4444', marginTop: '3px', textAlign: 'right' }}>⚠ 资金不足，提取受限</div>
                                                  )}
                                                </>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    }
                                    return null;
                                  }}
                                />
                                <Legend />
                                {labMcSettings.target > 0 && (
                                  <ReferenceLine y={labMcSettings.target} stroke="#a855f7" strokeDasharray="5 5" label={{ position: 'insideTopLeft', value: '目标 (Target)', fill: '#a855f7', fontSize: 12 }} />
                                )}
                                {mcLines}
                              </ComposedChart>
                            </ResponsiveContainer>
                          ) : (
                            // Use standard Composed/Line wrapper... actually AreaChart can render Lines too.
                            <ResponsiveContainer width="100%" height="100%">
                              <ComposedChart data={labData.monte_carlo.chart}>
                                <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                                <XAxis dataKey="year" stroke="rgba(255,255,255,0.4)" fontSize={0.8} />
                                <YAxis stroke="rgba(255,255,255,0.4)" fontSize={0.8} tickFormatter={(val) => '$'+(val/1000).toFixed(0)+'k'} />
                                <Tooltip 
                                  content={({ active, payload, label }) => {
                                    if (active && payload && payload.length) {
                                      const dataRow = payload[0]?.payload || {};
                                      const actual_draw = dataRow.actual_draw_p50;
                                      const target_draw = labMcSettings.withdrawal || 0;
                                      const isShortfall = actual_draw !== undefined && target_draw > 0 && actual_draw < target_draw * 0.9;
                                      return (
                                        <div style={{ backgroundColor: 'rgba(15, 23, 42, 0.98)', border: '1px solid rgba(255,255,255,0.15)', padding: '12px 14px', borderRadius: '8px', boxShadow: '0 6px 16px rgba(0,0,0,0.6)', color: '#fff', minWidth: '220px' }}>
                                          <div style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '6px', marginBottom: '8px', fontWeight: '800', fontSize: '0.9rem' }}>第 {label} 年</div>
                                          {payload.map((entry, index) => (
                                            <div key={index} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', padding: '2px 0' }}>
                                              <span style={{ fontSize: '0.72rem', color: entry.color, fontWeight: 500 }}>{entry.name}</span>
                                              <span style={{ fontWeight: 700, color: entry.color, fontFamily: 'monospace', fontSize: '0.85rem' }}>${Math.round(entry.value).toLocaleString()}</span>
                                            </div>
                                          ))}
                                          {(dataRow.div_generated > 0 || (actual_draw !== undefined && target_draw > 0)) && (
                                            <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed rgba(255,255,255,0.15)' }}>
                                              {dataRow.div_generated > 0 && (
                                                <div style={{ marginBottom: (actual_draw !== undefined && target_draw > 0) ? '8px' : '0' }}>
                                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                                                    <span style={{ fontSize: '0.72rem', color: '#10b981' }}>分红总收益 (P50)</span>
                                                    <span style={{ fontWeight: '800', color: '#10b981', fontFamily: 'monospace', fontSize: '0.85rem' }}>+${Math.round(dataRow.div_generated).toLocaleString()}</span>
                                                  </div>
                                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingLeft: '8px' }}>
                                                    <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.4)' }}>↪ 抵扣提取需求</span>
                                                    <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>${Math.round(dataRow.div_offset || 0).toLocaleString()}</span>
                                                  </div>
                                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingLeft: '8px' }}>
                                                    <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.4)' }}>↪ 并入本金复投</span>
                                                    <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>${Math.round(dataRow.div_reinvested || 0).toLocaleString()}</span>
                                                  </div>
                                                </div>
                                              )}
                                              {actual_draw !== undefined && target_draw > 0 && (
                                                <>
                                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>预计实际可提取 (P50)</span>
                                                    <span style={{ fontWeight: '800', color: isShortfall ? '#ef4444' : '#fbbf24', fontFamily: 'monospace', fontSize: '0.85rem' }}>
                                                      ${Math.round(actual_draw).toLocaleString()}
                                                    </span>
                                                  </div>
                                                  {isShortfall && (
                                                    <div style={{ fontSize: '0.65rem', color: '#ef4444', marginTop: '3px', textAlign: 'right' }}>⚠ 资金不足，提取受限</div>
                                                  )}
                                                </>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    }
                                    return null;
                                  }}
                                />
                                {labMcSettings.target > 0 && (
                                  <ReferenceLine y={labMcSettings.target} stroke="#a855f7" strokeDasharray="5 5" label={{ position: 'insideTopLeft', value: '目标 (Target)', fill: '#a855f7', fontSize: 12 }} />
                                )}
                                {mcLines}
                              </ComposedChart>
                            </ResponsiveContainer>
                          )}
                        </div>
                      </div>

                      {hasInflation && lastObj.real_p50 && (
                        <div style={{textAlign: 'center', marginBottom: '15px', padding: '10px', background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)', borderRadius: '8px'}}>
                          <span style={{color: '#f59e0b', fontSize: '0.9rem', fontWeight: 500}}>
                            {labMcSettings.years} 年后预测中性值为 ${Math.round(lastObj.p50).toLocaleString()}，折算今日购买力约 ${Math.round(lastObj.real_p50).toLocaleString()}。
                          </span>
                        </div>
                      )}
                      
                      {insuranceEnabled && labData.monte_carlo.insurance_stats && (
                        <div style={{display: 'flex', gap: '15px', marginBottom: '15px', flexWrap: 'wrap'}}>
                          <div style={{flex: 1, padding: '12px', background: 'rgba(16, 185, 129, 0.05)', border: '1px solid rgba(16, 185, 129, 0.2)', borderRadius: '8px'}}>
                            <div style={{color: '#10b981', fontSize: '0.8rem', marginBottom: '4px'}}>保险提取分摊抵扣率</div>
                            <div style={{fontSize: '1.2rem', fontWeight: 'bold'}}>{labData.monte_carlo.insurance_stats.withdrawal_coverage_pct.toFixed(1)}%</div>
                            <div style={{color: 'rgba(255,255,255,0.5)', fontSize: '0.75rem'}}>占全部提款需求</div>
                          </div>
                          <div style={{flex: 1, padding: '12px', background: 'rgba(59, 130, 246, 0.05)', border: '1px solid rgba(59, 130, 246, 0.2)', borderRadius: '8px'}}>
                            <div style={{color: '#3b82f6', fontSize: '0.8rem', marginBottom: '4px'}}>{labMcSettings.years} 年期末保单剩余CV (中性)</div>
                            <div style={{fontSize: '1.2rem', fontWeight: 'bold'}}>${Math.round(labData.monte_carlo.insurance_stats.avg_cv_at_year_end.mid).toLocaleString()}</div>
                          </div>
                          <div style={{flex: 1, padding: '12px', background: 'rgba(245, 158, 11, 0.05)', border: '1px solid rgba(245, 158, 11, 0.2)', borderRadius: '8px'}}>
                            <div style={{color: '#f59e0b', fontSize: '0.8rem', marginBottom: '4px'}}>模拟期内保险总提取</div>
                            <div style={{fontSize: '1.2rem', fontWeight: 'bold'}}>${Math.round(labData.monte_carlo.insurance_stats.total_insurance_withdrawal).toLocaleString()}</div>
                          </div>
                        </div>
                      )}

                      {/* Removed duplicated ComposedChart */}
                    </div>
                  );
                })()}

                {labData.monte_carlo.drawdown && (
                  <>
                    <div 
                      style={{marginTop: '25px', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: '#f43f5e', fontSize: '0.9rem', fontWeight: 600, width: 'fit-content'}} 
                      onClick={() => setShowDdDoc(!showDdDoc)}
                    >
                      如何理解最大回撤 (Max Drawdown)? <HelpCircle size={15} />
                    </div>
                    
                    {showDdDoc && (
                      <div style={{background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.3)', padding: '12px 16px', borderRadius: '8px', marginTop: '10px', fontSize: '0.85rem', color: 'rgba(255,255,255,0.9)', lineHeight: 1.6}}>
                        <strong style={{color: '#fb7185'}}>💡 最大回撤 (Max Drawdown)</strong><br />
                        它衡量的是在整个投资周期内，账户从<strong style={{color: '#f43f5e'}}>“历史最高峰”跌至“谷底”的最大幅度</strong>，代表了您在最坏情况下需要承受的**“账面浮亏心理极限”**。<br/>
                        把它想象成投资旅途中的“最大过山车落差”。例如，-40% 意味着如果运气极差在最高点买入，您的账户中途会缩水四成。经验表明，回撤超过 -30% 就会导致多数普通投资者恐慌性“割肉”离场，从而彻底倒在黎明前。<br/>
                        这也是为什么我们同时展示<strong style={{color: '#f59e0b'}}>合并组合 (Combined)</strong>的原因——将高波动的基金与零波动的保险资产合并计算后，通常能大幅缓冲整体回撤，提供必要的“情绪价值”，帮您在熊市中拿得住资产。
                      </div>
                    )}

                    <div style={{display: 'flex', alignItems: 'center', gap: '12px', marginTop: '10px', padding: '14px 18px', background: 'rgba(244,63,94,0.06)', border: '1px solid rgba(244,63,94,0.15)', borderRadius: '10px'}}>
                      <div style={{color: '#f43f5e', fontWeight: 600, fontSize: '0.85rem', minWidth: '130px'}}>📉 Max Drawdown<br/><span style={{fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)'}}>(波动组合 Volatile)</span></div>
                      {[
                        { label: '悲观 (10th)', key: 'p10', tip: 'Worst 10% of paths' },
                        { label: '中性 (50th)', key: 'p50', tip: 'Median path' },
                        { label: '乐观 (90th)', key: 'p90', tip: 'Best 10% of paths' },
                      ].map(s => (
                        <div key={s.key} style={{flex: 1, textAlign: 'center'}}>
                          <div style={{fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', marginBottom: '2px'}}>{s.label}</div>
                          {labData.monte_carlo.drawdown[s.key] <= -0.999 ? (
                            <>
                              <div style={{fontSize: '1.15rem', fontWeight: 700, color: '#ef4444'}}>💀 完全耗尽</div>
                              <div style={{fontSize: '0.65rem', color: '#ef4444'}}>Portfolio Depleted</div>
                            </>
                          ) : (
                            <>
                              <div style={{fontSize: '1.15rem', fontWeight: 700, color: s.key === 'p90' ? '#f59e0b' : '#f43f5e'}}>
                                {(labData.monte_carlo.drawdown[s.key] * 100).toFixed(1)}%
                              </div>
                              <div style={{fontSize: '0.65rem', color: 'rgba(255,255,255,0.3)'}}>{s.tip}</div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                    {labData.monte_carlo.combined_drawdown && (
                      <div style={{display: 'flex', alignItems: 'center', gap: '12px', marginTop: '10px', padding: '14px 18px', background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.15)', borderRadius: '10px'}}>
                        <div style={{color: '#f59e0b', fontWeight: 600, fontSize: '0.85rem', minWidth: '130px'}}>📉 Max Drawdown<br/><span style={{fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)'}}>(合并组合 Combined)</span></div>
                        {[
                          { label: '悲观 (10th)', key: 'p10', tip: 'Worst 10% of paths' },
                          { label: '中性 (50th)', key: 'p50', tip: 'Median path' },
                          { label: '乐观 (90th)', key: 'p90', tip: 'Best 10% of paths' },
                        ].map(s => (
                          <div key={s.key} style={{flex: 1, textAlign: 'center'}}>
                            <div style={{fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', marginBottom: '2px'}}>{s.label}</div>
                            {labData.monte_carlo.combined_drawdown[s.key] <= -0.999 ? (
                              <>
                                <div style={{fontSize: '1.15rem', fontWeight: 700, color: '#ef4444'}}>💀 完全耗尽</div>
                                <div style={{fontSize: '0.65rem', color: '#ef4444'}}>Portfolio Depleted</div>
                              </>
                            ) : (
                              <>
                                <div style={{fontSize: '1.15rem', fontWeight: 700, color: s.key === 'p90' ? '#10b981' : '#f59e0b'}}>
                                  {(labData.monte_carlo.combined_drawdown[s.key] * 100).toFixed(1)}%
                                </div>
                                <div style={{fontSize: '0.65rem', color: 'rgba(255,255,255,0.3)'}}>{s.tip}</div>
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
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '14px', padding: '28px 32px', width: '360px', boxShadow: '0 20px 60px rgba(0,0,0,0.8)' }}>
                <div style={{ fontWeight: 800, fontSize: '1.15rem', marginBottom: '8px' }}>💾 保存此方案</div>
                <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.45)', marginBottom: '20px' }}>将保存当前资产配置、MC参数及图表数据</div>
                <input
                  autoFocus
                  type="text"
                  placeholder="方案名称，如：稳健50/50 退休规划"
                  value={scenarioName}
                  onChange={e => setScenarioName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleSaveScenario(); if (e.key === 'Escape') setSaveDialogOpen(false); }}
                  style={{ width: '100%', padding: '10px 14px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', color: '#fff', fontSize: '0.9rem', boxSizing: 'border-box' }}
                />
                <div style={{ display: 'flex', gap: '10px', marginTop: '18px', justifyContent: 'flex-end' }}>
                  <button onClick={() => setSaveDialogOpen(false)} style={{ padding: '8px 18px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: '0.85rem' }}>取消</button>
                  <button onClick={handleSaveScenario} disabled={!scenarioName.trim() || scenarioSaving} style={{ padding: '8px 22px', background: scenarioName.trim() ? 'linear-gradient(135deg, #059669, #10b981)' : 'rgba(255,255,255,0.08)', border: 'none', borderRadius: '8px', color: '#fff', cursor: scenarioName.trim() ? 'pointer' : 'not-allowed', fontWeight: 700, fontSize: '0.85rem' }}>{scenarioSaving ? '保存中...' : '确认保存'}</button>
                </div>
              </div>
            </div>
          )}

          </>
  );
};

export default StrategyLabView;
