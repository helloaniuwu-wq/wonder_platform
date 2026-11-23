import React from 'react';
import { Plus, Trash2 } from 'lucide-react';

/**
 * Modal for creating a new portfolio.
 */
const CreatePortfolioModal = ({
  showModal, setShowModal,
  newPf, setNewPf, totalWeight,
  handleCreatePortfolio,
}) => {
  if (!showModal) return null;
  return (
        <div className="modal-overlay">
          <div className="glass-card modal-content" onClick={e => e.stopPropagation()} style={{position: 'relative'}}>
            <button 
              type="button"
              aria-label="Close modal"
              onClick={() => setShowModal(false)}
              style={{
                position: 'absolute', top: '15px', right: '15px', 
                background: 'transparent', border: 'none', color: 'var(--text-muted)', 
                fontSize: '1.25rem', cursor: 'pointer', transition: 'color 0.2s'
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
              </div>

              <div className="form-group">
                <label>Allocations (Total: {(totalWeight * 100).toFixed(0)}%)</label>
                {newPf.allocations.map((a, i) => (
                  <div key={i} className="allocation-row">
                    <input style={{flex: 2}} placeholder="ISIN" value={a.isin} onChange={e => {
                      const next = [...newPf.allocations]; next[i].isin = e.target.value; setNewPf({...newPf, allocations: next});
                    }} />
                    <input style={{flex: 1}} type="number" step="0.01" placeholder="Weight (e.g. 0.5)" value={a.weight} onChange={e => {
                      const next = [...newPf.allocations]; next[i].weight = e.target.value; setNewPf({...newPf, allocations: next});
                    }} />
                    <input style={{flex: 1.5}} type="number" placeholder="Manual Price (opt)" value={a.manual_price} onChange={e => {
                      const next = [...newPf.allocations]; next[i].manual_price = e.target.value; setNewPf({...newPf, allocations: next});
                    }} />
                  </div>
                ))}
                <button type="button" className="add-asset-btn" onClick={() => setNewPf({...newPf, allocations: [...newPf.allocations, {isin:'', weight:0, manual_price:''}]})}>+ Add Asset</button>
              </div>

              <div style={{marginTop: '24px', display: 'flex', gap: '12px'}}>
                <button type="submit" className="create-btn" style={{flex: 1}} disabled={Math.abs(totalWeight-1.0)>0.001}>Deploy Strategy</button>
                <button type="button" className="create-btn cancel" onClick={() => setShowModal(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>

  );
};

export default CreatePortfolioModal;
