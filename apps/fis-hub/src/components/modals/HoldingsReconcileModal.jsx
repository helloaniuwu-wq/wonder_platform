import React, { useState } from 'react';
import { Camera, CheckCircle2, RefreshCw, Upload, X } from 'lucide-react';
import { apiFetch } from '../../api/client';
import { getCurrencySymbol } from '../../utils/currency';

const STATUS_META = {
  MATCHED: { label: '一致', color: 'var(--success, #10b981)', bg: 'rgba(16,185,129,0.12)' },
  DIFF: { label: '數量差異', color: 'var(--warning, #d97706)', bg: 'rgba(245,158,11,0.12)' },
  NEW_IN_SCREENSHOT: { label: '截圖新增', color: 'var(--accent-color)', bg: 'rgba(99,102,241,0.12)' },
  MISSING_IN_SCREENSHOT: { label: '截圖缺失', color: 'var(--danger, #f43f5e)', bg: 'rgba(244,63,94,0.12)' },
};

const HoldingsReconcileModal = ({
  open,
  onClose,
  portfolioId,
  portfolioName,
  onReconciled,
}) => {
  const [parsing, setParsing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const [ocrResult, setOcrResult] = useState(null);
  const [rows, setRows] = useState([]);
  const [selectedIds, setSelectedIds] = useState({});

  if (!open) return null;

  const handleFile = async (file) => {
    if (!file) return;
    setError('');
    setParsing(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await apiFetch(`/api/portfolios/${portfolioId}/reconcile/ocr`, {
        method: 'POST',
        body: formData,
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.detail || json.message || `識別失敗 (HTTP ${res.status})`);
      }
      setOcrResult(json);
      const recRows = Array.isArray(json.reconciliation_rows) ? json.reconciliation_rows : [];
      setRows(recRows);
      const initSel = {};
      recRows.forEach((r, idx) => {
        if (r.matched_isin && Math.abs(Number(r.diff_shares || 0)) >= 0.0001 && Number(r.price) > 0) {
          initSel[idx] = true;
        }
      });
      setSelectedIds(initSel);
    } catch (err) {
      setError(err?.message || '截圖解析失敗，請確認圖片清晰並重試');
    } finally {
      setParsing(false);
    }
  };

  const handleRowEdit = (idx, field, val) => {
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== idx) return r;
        const next = { ...r, [field]: val };
        if (field === 'screenshot_shares' || field === 'price') {
          const ss = Number(next.screenshot_shares || 0);
          const ls = Number(next.ledger_shares || 0);
          const px = Number(next.price || 0);
          next.diff_shares = Math.round((ss - ls) * 10000) / 10000;
          next.estimated_diff_value = Math.round(next.diff_shares * px * 100) / 100;
        }
        return next;
      })
    );
  };

  const handleApply = async () => {
    const adjustments = rows
      .filter((r, idx) => selectedIds[idx] && r.matched_isin && Math.abs(Number(r.diff_shares || 0)) >= 0.0001 && Number(r.price) > 0)
      .map((r) => ({
        isin: r.matched_isin,
        diff_shares: Number(r.diff_shares),
        price: Number(r.price),
        date: ocrResult?.as_of_date || undefined,
      }));

    if (adjustments.length === 0) {
      setError('請至少勾選一項存在有效差異與單價的校準行');
      return;
    }

    setApplying(true);
    setError('');
    try {
      const res = await apiFetch(`/api/portfolios/${portfolioId}/reconcile/apply`, {
        method: 'POST',
        body: { adjustments },
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.detail || '校準寫入失敗');
      }
      await onReconciled?.();
      onClose();
    } catch (err) {
      setError(err?.message || '寫入失敗');
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="glass-card modal-content"
        style={{ maxWidth: '880px', width: '94vw', position: 'relative' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            background: 'transparent',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
          }}
        >
          <X size={18} />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <Camera size={18} style={{ color: 'var(--accent-color)' }} />
          <h3 style={{ margin: 0 }}>實盤持倉截圖 OCR 輔助對賬 — {portfolioName}</h3>
        </div>
        <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', marginTop: 0, marginBottom: 16 }}>
          上傳 AIA Connect (卓達智悅2) 或券商 App 持倉頁面截圖，系統自動比對帳本份額並生成差額校準流水。
        </p>

        <label
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '22px 16px',
            borderRadius: 10,
            border: '2px dashed var(--border-strong, var(--border-subtle))',
            background: 'var(--surface-subtle)',
            cursor: parsing ? 'wait' : 'pointer',
            marginBottom: 16,
          }}
        >
          <input
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            disabled={parsing}
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
          {parsing ? (
            <>
              <RefreshCw size={22} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-color)' }} />
              <span style={{ fontSize: '0.86rem', color: 'var(--text-primary)' }}>AI 視覺識別與比對中...</span>
            </>
          ) : (
            <>
              <Upload size={22} style={{ color: 'var(--accent-color)' }} />
              <span style={{ fontSize: '0.86rem', fontWeight: 600 }}>點擊選擇或拖入持倉截圖（PNG / JPG）</span>
            </>
          )}
        </label>

        {error && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: 8,
              background: 'rgba(244,63,94,0.1)',
              border: '1px solid rgba(244,63,94,0.35)',
              color: 'var(--danger, #f43f5e)',
              fontSize: '0.84rem',
              marginBottom: 14,
            }}
          >
            {error}
          </div>
        )}

        {ocrResult && (
          <>
            <div
              style={{
                display: 'flex',
                gap: 16,
                flexWrap: 'wrap',
                fontSize: '0.8rem',
                color: 'var(--text-secondary)',
                marginBottom: 12,
                padding: '8px 12px',
                borderRadius: 8,
                background: 'var(--surface-subtle)',
              }}
            >
              <span>識別平台：<strong>{ocrResult.platform_detected}</strong></span>
              <span>截圖日期：<strong>{ocrResult.as_of_date}</strong></span>
              <span>幣種：<strong>{ocrResult.currency}</strong></span>
              {ocrResult.confidence != null && <span>置信度：<strong>{Math.round(ocrResult.confidence)}%</strong></span>}
            </div>

            <div className="table-container" style={{ maxHeight: '320px', overflowY: 'auto', marginBottom: 16 }}>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 34 }}>校準</th>
                    <th>資產</th>
                    <th style={{ textAlign: 'right' }}>帳本份額</th>
                    <th style={{ textAlign: 'right' }}>截圖實盤份額</th>
                    <th style={{ textAlign: 'right' }}>差異份額</th>
                    <th style={{ textAlign: 'right' }}>單價</th>
                    <th>狀態</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => {
                    const st = STATUS_META[r.status] || STATUS_META.DIFF;
                    const sym = getCurrencySymbol(r.currency || 'USD');
                    return (
                      <tr key={idx}>
                        <td>
                          <input
                            type="checkbox"
                            checked={Boolean(selectedIds[idx])}
                            disabled={!r.matched_isin || Math.abs(Number(r.diff_shares || 0)) < 0.0001}
                            onChange={(e) => setSelectedIds((p) => ({ ...p, [idx]: e.target.checked }))}
                          />
                        </td>
                        <td>
                          <div style={{ fontWeight: 600, fontSize: '0.84rem' }}>{r.detected_name}</div>
                          <input
                            value={r.matched_isin || ''}
                            placeholder="填入系統代碼/ISIN"
                            onChange={(e) => handleRowEdit(idx, 'matched_isin', e.target.value.toUpperCase())}
                            style={{
                              marginTop: 4,
                              padding: '2px 6px',
                              fontSize: '0.74rem',
                              width: 130,
                              fontFamily: 'var(--font-mono)',
                            }}
                          />
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                          {Number(r.ledger_shares || 0).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <input
                            type="number"
                            step="0.0001"
                            value={r.screenshot_shares ?? 0}
                            onChange={(e) => handleRowEdit(idx, 'screenshot_shares', parseFloat(e.target.value) || 0)}
                            style={{ width: 92, textAlign: 'right', padding: '4px 6px', fontFamily: 'var(--font-mono)' }}
                          />
                        </td>
                        <td
                          style={{
                            textAlign: 'right',
                            fontFamily: 'var(--font-mono)',
                            fontWeight: 700,
                            color: r.diff_shares > 0 ? 'var(--success, #10b981)' : r.diff_shares < 0 ? 'var(--danger, #f43f5e)' : 'var(--text-muted)',
                          }}
                        >
                          {r.diff_shares > 0 ? '+' : ''}
                          {Number(r.diff_shares || 0).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <span style={{ fontSize: '0.75rem', marginRight: 2 }}>{sym}</span>
                          <input
                            type="number"
                            step="0.0001"
                            value={r.price ?? 0}
                            onChange={(e) => handleRowEdit(idx, 'price', parseFloat(e.target.value) || 0)}
                            style={{ width: 76, textAlign: 'right', padding: '4px 6px', fontFamily: 'var(--font-mono)' }}
                          />
                        </td>
                        <td>
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: 12,
                              fontSize: '0.73rem',
                              fontWeight: 600,
                              color: st.color,
                              background: st.bg,
                            }}
                          >
                            {st.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" className="create-btn cancel" onClick={onClose}>
                關閉
              </button>
              <button
                type="button"
                className="create-btn"
                onClick={handleApply}
                disabled={applying}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <CheckCircle2 size={15} />
                {applying ? '正在寫入校準流水...' : '一鍵按實盤校準帳本'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default HoldingsReconcileModal;
