/**
 * 组合构成管理：交易流水编辑、新增资产。
 * 从 App.jsx 原样搬出，行为不变。
 */
import { useState } from 'react';
import { apiFetch } from '../api/client';

export function useComposition({ activeId, setData }) {
  // Portfolio Composition Management State
  const [showCompModal, setShowCompModal] = useState(false);
  const [compTxs, setCompTxs] = useState([]);
  const [compTargets, setCompTargets] = useState({});
  const [compEditing, setCompEditing] = useState({});
  const [compNewAsset, setCompNewAsset] = useState({ isin: '', type: 'BUY', shares: 0, price: 0, date: new Date().toISOString().split('T')[0] });

  // ── Portfolio Composition Management ──────────────────────────────────────
  const handleOpenCompModal = async () => {
    if (!activeId) return;
    try {
      const res = await apiFetch(`/api/portfolios/transactions/${activeId}`);
      if (!res.ok) throw new Error('Failed to fetch transactions');
      const result = await res.json();
      setCompTxs(result.transactions || []);
      setCompTargets(result.target_allocations || {});
      setCompEditing({});
      setCompNewAsset({ isin: '', type: 'BUY', shares: 0, price: 0, date: new Date().toISOString().split('T')[0] });
      setShowCompModal(true);
    } catch (err) {
      console.error(err);
      alert('Failed to load portfolio composition');
    }
  };

  const handleCompEdit = (txId, field, value) => {
    setCompEditing(prev => ({
      ...prev,
      [txId]: { ...(prev[txId] || {}), [field]: value }
    }));
  };

  const handleCompSave = async (txId) => {
    const edits = compEditing[txId];
    if (!edits) return;
    try {
      // Save transaction changes (isin, shares, price)
      const txUpdate = {};
      if (edits.isin !== undefined) txUpdate.isin = edits.isin;
      if (edits.shares !== undefined) txUpdate.shares = edits.shares;
      if (edits.price !== undefined) txUpdate.price = edits.price;
      if (edits.date !== undefined) txUpdate.date = edits.date;
      if (Object.keys(txUpdate).length > 0) {
        await apiFetch(`/api/portfolios/transactions/${txId}`, {
          method: 'PUT',
          body: txUpdate
        });
      }
      // Target weight updating logic has been removed as it's now handled by RebalanceModal
      // Refresh
      handleOpenCompModal();
      const repRes = await apiFetch(`/api/report/${activeId}`);
      setData(await repRes.json());
    } catch (err) {
      console.error(err);
      alert('Failed to save changes');
    }
  };

  const handleCompDelete = async (txId) => {
    if (!window.confirm('Delete this transaction? This cannot be undone.')) return;
    try {
      await apiFetch(`/api/portfolios/transactions/${txId}`, { method: 'DELETE' });
      handleOpenCompModal();
      const repRes = await apiFetch(`/api/report/${activeId}`);
      setData(await repRes.json());
    } catch {
      alert('Failed to delete transaction');
    }
  };

  const handleCompAddAsset = async () => {
    if (!compNewAsset.isin || compNewAsset.shares <= 0 || compNewAsset.price <= 0) {
      alert('Please fill in ISIN, shares and price');
      return;
    }
    try {
      await apiFetch(`/api/portfolios/transactions/${activeId}`, {
        method: 'POST',
        body: compNewAsset
      });
      handleOpenCompModal();
      const repRes = await apiFetch(`/api/report/${activeId}`);
      setData(await repRes.json());
    } catch {
      alert('Failed to add asset');
    }
  };

  return {
    showCompModal,
    setShowCompModal,
    compTxs,
    setCompTxs,
    compTargets,
    setCompTargets,
    compEditing,
    setCompEditing,
    compNewAsset,
    setCompNewAsset,
    handleOpenCompModal,
    handleCompEdit,
    handleCompSave,
    handleCompDelete,
    handleCompAddAsset,
  };
}
