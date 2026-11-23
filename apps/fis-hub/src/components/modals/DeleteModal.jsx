import React from 'react';
import { Trash2 } from 'lucide-react';

const DeleteModal = ({ showDeleteModal, setShowDeleteModal, handleDelete, setDeleteCandidate }) => {
  if (!showDeleteModal) return null;
  return (
    <div className="modal-overlay" onClick={() => { setShowDeleteModal(false); setDeleteCandidate(null); }}>
      <div className="glass-card modal-content" style={{ maxWidth: '380px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
        <Trash2 size={32} style={{ color: 'var(--danger)', margin: '0 auto 14px' }} aria-hidden="true" />
        <h3 style={{ marginTop: 0, color: 'var(--text-primary)' }}>Delete Portfolio?</h3>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '24px', fontSize: '0.9rem', lineHeight: 1.6 }}>
          This action cannot be undone. All transactions and data associated with this portfolio will be permanently deleted.
        </p>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            type="button"
            className="create-btn"
            style={{ flex: 1, background: 'var(--danger)', borderColor: 'var(--danger)', color: '#fff' }}
            onClick={handleDelete}
          >
            Yes, Delete
          </button>
          <button
            type="button"
            className="create-btn cancel"
            style={{ flex: 1 }}
            onClick={() => { setShowDeleteModal(false); setDeleteCandidate(null); }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeleteModal;
