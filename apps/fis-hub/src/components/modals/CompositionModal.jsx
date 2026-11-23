import React from 'react';
import { Trash2 } from 'lucide-react';

const CompositionModal = ({
  showCompModal, setShowCompModal,
  compTxs, compEditing,
  compNewAsset, setCompNewAsset,
  handleCompEdit, handleCompSave, handleCompDelete, handleCompAddAsset,
}) => {
  if (!showCompModal) return null;

  const cellInputStyle = {
    background: 'var(--surface-subtle)',
    border: '1px solid var(--border-subtle)',
    borderRadius: '4px',
    padding: '4px 8px',
    color: 'var(--text-primary)',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.84rem',
  };

  return (
    <div className="modal-overlay" onClick={() => setShowCompModal(false)}>
      <div className="glass-card modal-content" style={{ maxWidth: '960px' }} onClick={e => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>Transaction History</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '20px', fontSize: '0.86rem' }}>
          View and edit past transactions. Adjust dates, shares, and prices.
        </p>

        <div className="table-container" style={{ maxHeight: '400px', overflowY: 'auto', marginBottom: '20px' }}>
          <table>
            <thead>
              <tr>
                <th>DATE</th>
                <th>TYPE</th>
                <th>ISIN</th>
                <th>NAME</th>
                <th>SHARES</th>
                <th>PRICE</th>
                <th>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {compTxs.map(tx => {
                const edits = compEditing[tx.id] || {};
                const isEdited = Object.keys(edits).length > 0;
                const txType = edits.type !== undefined ? edits.type : tx.type;
                return (
                  <tr key={tx.id}>
                    <td>
                      <input
                        type="date"
                        value={edits.date !== undefined ? edits.date : tx.date}
                        onChange={e => handleCompEdit(tx.id, 'date', e.target.value)}
                        style={{ ...cellInputStyle, width: '126px' }}
                      />
                    </td>
                    <td>
                      <select
                        value={txType}
                        onChange={e => handleCompEdit(tx.id, 'type', e.target.value)}
                        style={{
                          background: txType === 'BUY' ? 'var(--success-bg)' : (txType === 'CASH_IN' ? 'var(--info-bg)' : 'var(--danger-bg)'),
                          color: txType === 'BUY' ? 'var(--success)' : (txType === 'CASH_IN' ? 'var(--info)' : 'var(--danger)'),
                          border: '1px solid var(--border-subtle)',
                          borderRadius: '4px',
                          padding: '3px 8px',
                          fontSize: '0.75rem',
                          fontFamily: 'var(--font-mono)',
                          fontWeight: 700,
                          outline: 'none',
                          cursor: 'pointer',
                        }}
                      >
                        <option value="BUY">BUY</option>
                        <option value="SELL">SELL</option>
                        <option value="CASH_IN">CASH_IN</option>
                        <option value="CASH_OUT">CASH_OUT</option>
                        <option value="DIV_CASH">DIV_CASH</option>
                      </select>
                    </td>
                    <td>
                      <input
                        value={edits.isin !== undefined ? edits.isin : tx.isin}
                        onChange={e => handleCompEdit(tx.id, 'isin', e.target.value)}
                        style={{ ...cellInputStyle, width: '120px' }}
                      />
                    </td>
                    <td style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{tx.name}</td>
                    <td>
                      <input
                        type="number"
                        value={edits.shares !== undefined ? edits.shares : tx.shares}
                        onChange={e => handleCompEdit(tx.id, 'shares', parseFloat(e.target.value))}
                        style={{ ...cellInputStyle, width: '90px' }}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        value={edits.price !== undefined ? edits.price : tx.price}
                        onChange={e => handleCompEdit(tx.id, 'price', parseFloat(e.target.value))}
                        style={{ ...cellInputStyle, width: '90px', color: 'var(--accent-secondary)', fontWeight: 700 }}
                      />
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        {isEdited && (
                          <button
                            type="button"
                            onClick={() => handleCompSave(tx.id)}
                            style={{
                              background: 'var(--success-bg)',
                              color: 'var(--success)',
                              border: '1px solid var(--success)',
                              padding: '4px 10px',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontSize: '0.78rem',
                              fontWeight: 600,
                            }}
                          >
                            Save
                          </button>
                        )}
                        <button
                          type="button"
                          aria-label="Delete transaction"
                          onClick={() => handleCompDelete(tx.id)}
                          style={{
                            background: 'var(--danger-bg)',
                            color: 'var(--danger)',
                            border: '1px solid var(--border-subtle)',
                            padding: '4px 8px',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                          }}
                        >
                          <Trash2 size={12} aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {compTxs.length === 0 && (
                <tr>
                  <td colSpan="7" style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
                    No transactions found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Add New Transaction Row */}
        <div style={{
          background: 'var(--surface-subtle)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--card-radius)',
          padding: '16px',
          marginBottom: '20px',
        }}>
          <div style={{ fontSize: '0.86rem', fontWeight: 700, marginBottom: '12px', color: 'var(--accent-color)' }}>
            + Add Transaction
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 130px' }}>
              <label style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Date</label>
              <input
                type="date"
                value={compNewAsset.date}
                onChange={e => setCompNewAsset({ ...compNewAsset, date: e.target.value })}
                className="atelier-input"
              />
            </div>
            <div style={{ flex: '1 1 110px' }}>
              <label style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Type</label>
              <select
                value={compNewAsset.type}
                onChange={e => setCompNewAsset({ ...compNewAsset, type: e.target.value })}
                className="atelier-select"
              >
                <option value="BUY">BUY</option>
                <option value="SELL">SELL</option>
                <option value="CASH_IN">CASH_IN</option>
                <option value="CASH_OUT">CASH_OUT</option>
                <option value="DIV_CASH">DIV_CASH</option>
              </select>
            </div>
            <div style={{ flex: '1.5 1 140px' }}>
              <label style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>ISIN / Ticker</label>
              <input
                placeholder="VOO / CASH_USD"
                value={compNewAsset.isin}
                onChange={e => setCompNewAsset({ ...compNewAsset, isin: e.target.value })}
                className="atelier-input"
              />
            </div>
            <div style={{ flex: '1 1 90px' }}>
              <label style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Shares</label>
              <input
                type="number"
                placeholder="100"
                value={compNewAsset.shares}
                onChange={e => setCompNewAsset({ ...compNewAsset, shares: parseFloat(e.target.value) })}
                className="atelier-input"
              />
            </div>
            <div style={{ flex: '1 1 90px' }}>
              <label style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Price / Amt</label>
              <input
                type="number"
                step="0.01"
                placeholder="100.00"
                value={compNewAsset.price}
                onChange={e => setCompNewAsset({ ...compNewAsset, price: parseFloat(e.target.value) })}
                className="atelier-input"
              />
            </div>
            <button
              type="button"
              onClick={handleCompAddAsset}
              className="create-btn"
              style={{ padding: '8px 20px', whiteSpace: 'nowrap' }}
            >
              + Add
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" onClick={() => setShowCompModal(false)} className="action-btn-secondary">Close</button>
        </div>
      </div>
    </div>
  );
};

export default CompositionModal;
