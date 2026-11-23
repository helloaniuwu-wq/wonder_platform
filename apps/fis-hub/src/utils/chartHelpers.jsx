import React from 'react';

/**
 * Custom Tooltip for the "Combined Cash Flow to Pocket" BarChart.
 * Displays individual line items PLUS a summary section:
 *  - 总流入 (Total Inflow)
 *  - 总流出 (Total Outflow)
 *  - 净现金流 (Net Cash Flow)
 */
export const CombinedCashFlowTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    const totalInflow = (data.portInflow || 0) + (data.insInflow || 0);
    const totalOutflow = Math.abs((data.portOutflow || 0) + (data.insOutflow || 0));
    const netCF = totalInflow - totalOutflow;
    return (
      <div style={{
        backgroundColor: 'var(--tooltip-bg)',
        border: '1px solid var(--tooltip-border)',
        padding: '12px 16px',
        borderRadius: '6px',
        boxShadow: 'var(--card-shadow)',
        color: 'var(--tooltip-text)',
        minWidth: '220px'
      }}>
        <div style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: '6px', marginBottom: '8px', fontWeight: 700, fontFamily: 'var(--font-display)', fontSize: '0.95rem' }}>
          {label}
        </div>
        {payload.map((entry, index) => (
          <div key={index} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', padding: '2px 0' }}>
            <span style={{ fontSize: '0.74rem', color: entry.color, fontWeight: 500 }}>{entry.name}</span>
            <span style={{ fontWeight: 600, color: entry.color, fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', fontSize: '0.84rem' }}>
              ${Math.round(Math.abs(entry.value)).toLocaleString()}
            </span>
          </div>
        ))}
        <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed var(--border-subtle)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
            <span style={{ fontSize: '0.74rem', color: 'var(--success)' }}>总流入 (Total Inflow)</span>
            <span style={{ fontWeight: 700, color: 'var(--success)', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', fontSize: '0.84rem' }}>
              +${Math.round(totalInflow).toLocaleString()}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <span style={{ fontSize: '0.74rem', color: 'var(--danger)' }}>总流出 (Total Outflow)</span>
            <span style={{ fontWeight: 700, color: 'var(--danger)', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', fontSize: '0.84rem' }}>
              -${Math.round(totalOutflow).toLocaleString()}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border-subtle)', paddingTop: '6px', marginTop: '4px' }}>
            <span style={{ fontSize: '0.74rem', color: 'var(--text-primary)', fontWeight: 600 }}>净现金流 (Net Cash Flow)</span>
            <span style={{ fontWeight: 700, color: netCF >= 0 ? 'var(--success)' : 'var(--danger)', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', fontSize: '0.92rem' }}>
              {netCF >= 0 ? '+' : '-'}${Math.round(Math.abs(netCF)).toLocaleString()}
            </span>
          </div>
        </div>
      </div>
    );
  }
  return null;
};
