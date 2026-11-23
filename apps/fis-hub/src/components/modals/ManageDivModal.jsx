import React from 'react';
import { Trash2 } from 'lucide-react';

const ManageDivModal = ({
  showManageDivModal, setShowManageDivModal,
  dividendHistory, handleDeleteManualDividend,
}) => {
  if (!showManageDivModal) return null;
  return (
    <div className="modal-overlay" onClick={() => setShowManageDivModal(false)}>
      <div className="glass-card modal-content" style={{ maxWidth: '800px' }} onClick={e => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>Manage Dividends</h2>
        <div className="table-container" style={{ maxHeight: '400px', overflowY: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>DATE</th>
                <th>ASSET</th>
                <th>TYPE</th>
                <th>SHARES</th>
                <th>AMOUNT/SH ($)</th>
                <th>TOTAL ($)</th>
                <th>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {dividendHistory.map((d, i) => (
                <tr key={i}>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{d.date}</td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontWeight: 600 }}>{d.name}</span>
                      <span className="isin-badge">{d.isin}</span>
                    </div>
                  </td>
                  <td>
                    <span style={{
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      background: d.type === 'Manual' ? 'var(--warning-bg)' : 'var(--success-bg)',
                      color: d.type === 'Manual' ? 'var(--warning)' : 'var(--success)',
                    }}>
                      {d.type}
                    </span>
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{d.shares_held}</td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>${d.amount_per_share.toFixed(4)}</td>
                  <td style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--accent-secondary)' }}>${d.total_amount.toFixed(2)}</td>
                  <td>
                    {d.type === 'Manual' && d.id && (
                      <button
                        type="button"
                        aria-label="Delete manual dividend"
                        onClick={() => handleDeleteManualDividend(d.id)}
                        style={{
                          background: 'var(--danger-bg)',
                          color: 'var(--danger)',
                          border: '1px solid var(--border-subtle)',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        <Trash2 size={12} aria-hidden="true" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {dividendHistory.length === 0 && (
                <tr>
                  <td colSpan="7" style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
                    No dividend records found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}>
          <button type="button" onClick={() => setShowManageDivModal(false)} className="action-btn-secondary">Close</button>
        </div>
      </div>
    </div>
  );
};

export default ManageDivModal;
