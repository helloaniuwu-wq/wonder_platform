/**
 * 分红：手动录入分红表单、分红记录管理弹窗。
 * 从 App.jsx 原样搬出，行为不变。
 */
import { useState } from 'react';
import { apiFetch } from '../api/client';

export function useDividends({ activeId, setData }) {
  const [showDivModal, setShowDivModal] = useState(false);

  // Manage Dividends State
  const [showManageDivModal, setShowManageDivModal] = useState(false);
  const [dividendHistory, setDividendHistory] = useState([]);

  // Manual Dividend Form State
  const [mDiv, setMDiv] = useState({ isin: '', date: new Date().toISOString().split('T')[0], amount: 0 });

  const handleManualDiv = async (e) => {
    e.preventDefault();
    await apiFetch(`/api/portfolios/dividend/manual/${activeId}`, {
      method: 'POST',
      body: { isin: mDiv.isin, date: mDiv.date, amount_per_share: parseFloat(mDiv.amount) }
    });
    setShowDivModal(false);
    // Refresh report
    const res = await apiFetch(`/api/report/${activeId}`);
    setData(await res.json());
  };

  const handleOpenManageDivModal = async () => {
    if (!activeId) return;
    try {
      const res = await apiFetch(`/api/portfolios/dividends/export/${activeId}`);
      if (!res.ok) throw new Error("Failed to fetch dividends");
      const divs = await res.json();
      setDividendHistory(divs);
      setShowManageDivModal(true);
    } catch (err) {
      console.error(err);
      alert("Failed to load dividends");
    }
  };

  const handleDeleteManualDividend = async (divId) => {
    if (!window.confirm("Are you sure you want to delete this manual dividend?")) return;
    try {
      await apiFetch(`/api/dividends/manual/${divId}`, { method: 'DELETE' });
      const res = await apiFetch(`/api/portfolios/dividends/export/${activeId}`);
      setDividendHistory(await res.json());
      
      const repRes = await apiFetch(`/api/report/${activeId}`);
      setData(await repRes.json());
    } catch (err) {
      console.error(err);
      alert("Failed to delete dividend");
    }
  };

  return {
    showDivModal,
    setShowDivModal,
    showManageDivModal,
    setShowManageDivModal,
    dividendHistory,
    setDividendHistory,
    mDiv,
    setMDiv,
    handleManualDiv,
    handleOpenManageDivModal,
    handleDeleteManualDividend,
  };
}
