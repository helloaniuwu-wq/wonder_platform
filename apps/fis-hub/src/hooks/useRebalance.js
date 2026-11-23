/**
 * 再平衡：目标权重编辑、预览、执行、撤销。
 * 从 App.jsx 原样搬出，行为不变。
 */
import { useState } from 'react';
import { authHeaders } from '../utils/auth';
import { reloadReportAndHistory } from '../utils/reportApi';

export function useRebalance({ activeId, setData, setHistoryData, setLoading, setCompTargets }) {
  const [showRebalanceModal, setShowRebalanceModal] = useState(false);
  const [rebalancePreview, setRebalancePreview] = useState(null);
  const [rebalanceDate, setRebalanceDate] = useState(new Date().toISOString().split('T')[0]);
  const [rebalanceDraftTargets, setRebalanceDraftTargets] = useState({}); // editable in modal Step 1

  // ── Undo Confirm Dialog State ────────────────────────────────────────────
  const [undoConfirmOpen, setUndoConfirmOpen] = useState(false);

  const handleUndoRebalance = () => {
    if (!activeId) return;
    setUndoConfirmOpen(true);
  };

  const handleUndoConfirmed = async () => {
    setUndoConfirmOpen(false);
    try {
      const res = await fetch(`/api/portfolios/rebalance/undo/${activeId}`, {
        method: 'POST',
        headers: authHeaders()
      });
      const data = await res.json();
      if (data.status === 'success') {
        await reloadReportAndHistory(activeId, { setData, setHistoryData });
      } else {
        alert(`Failed to undo: ${data.message || 'Unknown error'}`);
      }
    } catch (err) {
      alert(`Error during undo: ${err}`);
    }
  };

  // Step 1: Open modal and load current target_allocations into draft editor
  const handleRebalancePreview = async () => {
    if (!activeId) return;
    try {
      // Load current saved targets to pre-populate the editor
      const txRes = await fetch(`/api/portfolios/transactions/${activeId}`, { headers: authHeaders() });
      const txData = await txRes.json();
      const savedTargets = txData.target_allocations || {};
      setRebalanceDraftTargets(savedTargets);
      setRebalancePreview(null); // reset preview so modal starts on Step 1
      setShowRebalanceModal(true);
    } catch (e) {
      console.error(e);
    }
  };

  // Step 2: Save new targets to DB, then fetch fresh preview
  const handleRebalanceSaveAndCalc = async (draftTargets) => {
    if (!activeId) return;
    // 1. Persist the edited targets
    await fetch(`/api/portfolios/${activeId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ target_allocations: draftTargets })
    });
    // 2. Fetch the preview with updated targets
    const params = new URLSearchParams();
    if (rebalanceDate) params.set('as_of_date', rebalanceDate);
    const res = await fetch(`/api/portfolios/rebalance/preview/${activeId}?${params}`);
    const json = await res.json();
    setRebalancePreview(json);
    // Also sync compTargets so composition modal stays consistent
    setCompTargets(draftTargets);
  };


  const handleRebalanceExecute = async () => {
    setLoading(true);
    setShowRebalanceModal(false);
    try {
      const rbRes = await fetch(`/api/portfolios/rebalance/${activeId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ as_of_date: rebalanceDate || null })
      });
      if (!rbRes.ok) {
        const err = await rbRes.json().catch(() => ({ detail: 'Unknown server error' }));
        alert(`⚠️ Rebalance 执行失败：${err.detail || rbRes.status}`);
        setLoading(false);
        return;
      }
      await reloadReportAndHistory(activeId, { setData, setHistoryData });
    } catch (e) {
      alert(`⚠️ Rebalance 网络错误：${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  return {
    showRebalanceModal,
    setShowRebalanceModal,
    rebalancePreview,
    setRebalancePreview,
    rebalanceDate,
    setRebalanceDate,
    rebalanceDraftTargets,
    setRebalanceDraftTargets,
    undoConfirmOpen,
    setUndoConfirmOpen,
    handleUndoRebalance,
    handleUndoConfirmed,
    handleRebalancePreview,
    handleRebalanceSaveAndCalc,
    handleRebalanceExecute,
  };
}
