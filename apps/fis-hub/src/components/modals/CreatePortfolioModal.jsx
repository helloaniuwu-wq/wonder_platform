import React, { useState } from 'react';
import { Database } from 'lucide-react';
import FundCatalogPickerModal from './FundCatalogPickerModal';
import { lookupCOI } from '../../utils/ilpConfigCalc';

/**
 * Modal for creating a new portfolio.
 */
const CreatePortfolioModal = ({
  showModal, setShowModal,
  newPf, setNewPf, totalWeight,
  handleCreatePortfolio,
  creatingPf = false,
  createPfError = '',
  setCreatePfError,
  quantFunds = [],
}) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  if (!showModal) return null;
  const closeModal = () => {
    if (creatingPf) return;
    setCreatePfError?.('');
    setShowModal(false);
  };
  return (
        <>
        <FundCatalogPickerModal
          open={pickerOpen}
          funds={quantFunds}
          existingIds={newPf.allocations.map((a) => a.isin).filter(Boolean)}
          onClose={() => setPickerOpen(false)}
          onConfirm={(ids) => {
            const nonEmpty = newPf.allocations.filter((a) => a.isin && a.isin.trim());
            const mergedIds = Array.from(new Set([...nonEmpty.map((a) => a.isin.trim()), ...ids]));
            const eq = mergedIds.length > 0 ? Number((1 / mergedIds.length).toFixed(4)) : 0;
            const next = mergedIds.map((id, idx) => ({
              isin: id,
              weight: idx === mergedIds.length - 1 ? Number((1 - eq * (mergedIds.length - 1)).toFixed(4)) : eq,
              manual_price: '',
            }));
            setNewPf({ ...newPf, allocations: next });
          }}
        />
        <div className="modal-overlay">
          <div className="glass-card modal-content" onClick={e => e.stopPropagation()} style={{position: 'relative'}}>
            <button 
              type="button"
              aria-label="Close modal"
              onClick={closeModal}
              disabled={creatingPf}
              style={{
                position: 'absolute', top: '15px', right: '15px', 
                background: 'transparent', border: 'none', color: 'var(--text-muted)', 
                fontSize: '1.25rem', cursor: creatingPf ? 'not-allowed' : 'pointer', transition: 'color 0.2s'
              }}
            >✕</button>
            <h2 style={{marginTop: 0}}>New Portfolio Strategy</h2>
            <form onSubmit={handleCreatePortfolio}>
              <div className="form-row">
                <div className="form-group" style={{flex: 2}}>
                  <label>Name</label>
                  <input required value={newPf.name} onChange={e => setNewPf({...newPf, name: e.target.value})} />
                </div>
                <div className="form-group" style={{flex: 1}}>
                  <label>Start Date</label>
                  <input type="date" value={newPf.date} onChange={e => setNewPf({...newPf, date: e.target.value})} />
                </div>
              </div>
              
              <div className="form-row">
                <div className="form-group" style={{flex: 1}}>
                  <label>Base Currency <span style={{color:'#a855f7', fontSize:'0.75rem'}}>组合计价货币</span></label>
                  <select
                    value={newPf.base_currency}
                    onChange={e => setNewPf({...newPf, base_currency: e.target.value})}
                    style={{fontSize: '0.9rem'}}
                  >
                    <option value="USD">🇺🇸 USD — 美元</option>
                    <option value="HKD">🇭🇰 HKD — 港元</option>
                    <option value="JPY">🇯🇵 JPY — 日元</option>
                    <option value="CNY">🇨🇳 CNY — 人民币</option>
                    <option value="EUR">🇪🇺 EUR — 欧元</option>
                    <option value="GBP">🇬🇧 GBP — 英镑</option>
                    <option value="SGD">🇸🇬 SGD — 新加坡元</option>
                    <option value="AUD">🇦🇺 AUD — 澳元</option>
                    <option value="CAD">🇨🇦 CAD — 加元</option>
                    <option value="CHF">🇨🇭 CHF — 瑞士法郎</option>
                    <option value="KRW">🇰🇷 KRW — 韩元</option>
                    <option value="TWD">🇹🇼 TWD — 新台币</option>
                  </select>
                </div>
                <div className="form-group" style={{flex: 1}}>
                  <label>Dividend Strategy</label>
                  <select value={newPf.dividend_strategy} onChange={e => setNewPf({...newPf, dividend_strategy: e.target.value})}>
                    <option value="CASH">Cash Payout</option>
                    <option value="REINVEST">Reinvest (DRIP)</option>
                  </select>
                </div>
                <div className="form-group" style={{flex: 1, display: 'flex', alignItems: 'center', paddingTop: '1.5rem', gap: '8px'}}>
                  <input 
                    type="checkbox" 
                    id="is_public_cb"
                    checked={newPf.is_public || false} 
                    onChange={e => setNewPf({...newPf, is_public: e.target.checked})} 
                    style={{width: 'auto', cursor: 'pointer', accentColor: '#a855f7'}}
                  />
                  <label htmlFor="is_public_cb" style={{cursor: 'pointer', margin: 0, fontWeight: 500}}>公开可见 (Publicly Visible)</label>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group" style={{flex: 1}}>
                  <label>Initial Budget ({newPf.base_currency || 'USD'})</label>
                  <input type="number" value={newPf.budget} onChange={e => setNewPf({...newPf, budget: e.target.value})} />
                </div>
                <div className="form-group" style={{flex: 1.2}}>
                  <label>Execution Wrapper <span style={{color:'#a855f7', fontSize:'0.75rem'}}>實盤執行載體</span></label>
                  <select
                    value={newPf.wrapper_type || 'AIA_TMP2'}
                    onChange={e => setNewPf({...newPf, wrapper_type: e.target.value})}
                  >
                    <option value="AIA_TMP2">AIA 卓達智悅2 (ILP 投連險)</option>
                    <option value="BROKER_ETF">券商海外 ETF 專戶</option>
                    <option value="HYBRID">混合架構 (Hybrid)</option>
                  </select>
                </div>
                <div className="form-group" style={{flex: 0.7}}>
                  <label>漂移閾值 (%)</label>
                  <input
                    type="number"
                    min="1"
                    max="30"
                    value={newPf.drift_tolerance_pct ?? 5}
                    onChange={e => setNewPf({...newPf, drift_tolerance_pct: e.target.value})}
                  />
                </div>
                <div className="form-group" style={{flex: 0.7}}>
                  <label>回撤警戒 (%)</label>
                  <input
                    type="number"
                    min="3"
                    max="50"
                    value={newPf.max_drawdown_pct ?? 15}
                    onChange={e => setNewPf({...newPf, max_drawdown_pct: e.target.value})}
                  />
                </div>
              </div>

              {(newPf.wrapper_type || 'AIA_TMP2') === 'AIA_TMP2' && (
                <div
                  style={{
                    background: 'rgba(var(--accent-color-rgb), 0.05)',
                    border: '1px solid var(--border-subtle)',
                    borderLeft: '3px solid var(--accent-color)',
                    borderRadius: '6px',
                    padding: '10px 12px',
                    marginBottom: '12px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '6px' }}>
                    <span style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--accent-color)' }}>
                      投连险受保人费率匹配（每个组合独立）
                    </span>
                    <span style={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                      匹配 COI：{lookupCOI(Number(newPf.ilp_age ?? 35), newPf.ilp_gender || 'male').toFixed(2)}‰/年
                    </span>
                  </div>
                  <div className="form-row" style={{ marginBottom: 0 }}>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                      <label>受保人性别</label>
                      <select
                        value={newPf.ilp_gender || 'male'}
                        onChange={e => setNewPf({ ...newPf, ilp_gender: e.target.value })}
                      >
                        <option value="male">男 (Male)</option>
                        <option value="female">女 (Female)</option>
                      </select>
                    </div>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                      <label>投保年龄</label>
                      <input
                        type="number"
                        min="0"
                        max="80"
                        value={newPf.ilp_age ?? 35}
                        onChange={e => setNewPf({ ...newPf, ilp_age: parseInt(e.target.value, 10) || 0 })}
                      />
                    </div>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                      <label>吸烟状况</label>
                      <select
                        value={newPf.ilp_smoker ? 'yes' : 'no'}
                        onChange={e => setNewPf({ ...newPf, ilp_smoker: e.target.value === 'yes' })}
                      >
                        <option value="no">非吸烟</option>
                        <option value="yes">吸烟</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              <div className="form-group">
                <label>Allocations (Total: {(totalWeight * 100).toFixed(0)}%)</label>
                {newPf.allocations.map((a, i) => (
                  <div key={i} className="allocation-row">
                    <input style={{flex: 1.6, minWidth: 0}} placeholder="ISIN / Code" value={a.isin} onChange={e => {
                      const next = [...newPf.allocations]; next[i] = { ...next[i], isin: e.target.value }; setNewPf({...newPf, allocations: next});
                    }} />
                    <input style={{flex: 1, minWidth: 0}} type="number" step="0.01" placeholder="Weight" value={a.weight} onChange={e => {
                      const next = [...newPf.allocations]; next[i] = { ...next[i], weight: e.target.value }; setNewPf({...newPf, allocations: next});
                    }} />
                    <input style={{flex: 1.4, minWidth: 0}} type="number" placeholder="Price (opt)" value={a.manual_price} onChange={e => {
                      const next = [...newPf.allocations]; next[i] = { ...next[i], manual_price: e.target.value }; setNewPf({...newPf, allocations: next});
                    }} />
                    {newPf.allocations.length > 1 && (
                      <button
                        type="button"
                        aria-label="Remove asset"
                        onClick={() => {
                          const next = newPf.allocations.filter((_, idx) => idx !== i);
                          setNewPf({ ...newPf, allocations: next });
                        }}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--text-muted)',
                          cursor: 'pointer',
                          padding: '0 6px',
                          fontSize: '1rem',
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button type="button" className="add-asset-btn" onClick={() => setNewPf({...newPf, allocations: [...newPf.allocations, {isin:'', weight:0, manual_price:''}]})}>+ Add Asset</button>
                  {quantFunds.length > 0 && (
                    <button type="button" className="add-asset-btn" onClick={() => setPickerOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <Database size={13} /> 从 309 只基金库选基
                    </button>
                  )}
                </div>
              </div>

              {createPfError && (
                <div style={{
                  marginTop: '14px',
                  padding: '10px 12px',
                  borderRadius: '6px',
                  background: 'var(--danger-bg, rgba(239, 68, 68, 0.1))',
                  border: '1px solid var(--danger, #ef4444)',
                  color: 'var(--danger, #ef4444)',
                  fontSize: '0.84rem',
                }}>
                  {createPfError}
                </div>
              )}

              <div style={{marginTop: '24px', display: 'flex', gap: '12px'}}>
                <button
                  type="submit"
                  className="create-btn"
                  style={{flex: 1, opacity: creatingPf ? 0.7 : 1}}
                  disabled={creatingPf || Math.abs(totalWeight - 1.0) > 0.001}
                >
                  {creatingPf ? 'Creating...' : 'Deploy Strategy'}
                </button>
                <button type="button" className="create-btn cancel" onClick={closeModal} disabled={creatingPf}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
        </>

  );
};

export default CreatePortfolioModal;
