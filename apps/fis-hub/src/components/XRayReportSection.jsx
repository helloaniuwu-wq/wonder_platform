import React from 'react';
import { Layers, AlertTriangle, ShieldCheck } from 'lucide-react';

const EQUITY_CELLS = [
  ['large_value', '大盘价值'],
  ['large_blend', '大盘均衡'],
  ['large_growth', '大盘成长'],
  ['mid_value', '中盘价值'],
  ['mid_blend', '中盘均衡'],
  ['mid_growth', '中盘成长'],
  ['small_value', '小盘价值'],
  ['small_blend', '小盘均衡'],
  ['small_growth', '小盘成长'],
];

const BOND_CELLS = [
  ['high_limited', '高信·短久'],
  ['high_moderate', '高信·中久'],
  ['high_extensive', '高信·长久'],
  ['medium_limited', '中信·短久'],
  ['medium_moderate', '中信·中久'],
  ['medium_extensive', '中信·长久'],
  ['low_limited', '低信·短久'],
  ['low_moderate', '低信·中久'],
  ['low_extensive', '低信·长久'],
];

function moneyStr(val, currencySymbol = '$') {
  const n = Number(val);
  if (!Number.isFinite(n)) return '—';
  return `${currencySymbol}${Math.round(n).toLocaleString('en-US')}`;
}

/**
 * 专为 A4 PDF 打印排版的组合 X-Ray 透视专节，可同时嵌入 ClientBriefReport、WealthReport 与独立 XRayPrintReport。
 */
export default function XRayReportSection({ xrayData, localXRay = null, currencySymbol = '$', sectionTitle = '组合底层穿透 X-Ray（Morningstar × Wonder SOP 体检）' }) {
  const server = xrayData && xrayData.summary ? xrayData : null;
  const fallback = localXRay;
  if (!server && !fallback) return null;

  const sum = server?.summary || {};
  const instMix = sum.instrument_mix || fallback?.instrumentMix || {};
  const assetClasses = server?.asset_classes || fallback?.assetClasses || [];
  const underlying = server?.underlying_holdings?.items || [];
  const sectors = server?.sectors?.items || [];
  const regions = server?.regions?.items || [];
  const eqStyleObj = server?.style_boxes?.equity || fallback?.style_boxes?.equity || {};
  const eqGrid = eqStyleObj.grid || {};
  const fiStyle = server?.style_boxes?.fixed_income || fallback?.style_boxes?.fixed_income || {};
  const risk = server?.risk_analytics || {};
  const valSop = server?.valuation_cashflow_sop || {};
  const diagnostics = server?.diagnostics || fallback?.diagnostics || [];

  const avgFeePct = sum.weighted_fee_pct ?? fallback?.avgFeePct;
  const estAnnualFee = sum.est_annual_fee ?? fallback?.estAnnualFeeAmount;
  const weightedDuration = fiStyle.weighted_duration ?? fallback?.weightedDuration;
  const aftertaxYield = valSop.aftertax_yield_pct ?? fallback?.aftertaxYieldPct;

  return (
    <section style={{ marginBottom: '20px' }}>
      <div
        className="ips-section-heading"
        style={{
          fontSize: '0.72rem',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: '#9A6F38',
          fontWeight: 700,
          marginBottom: '6px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}
      >
        <Layers size={13} aria-hidden="true" />
        PORTFOLIO X-RAY LOOK-THROUGH
      </div>
      <h2 className="ips-section-heading" style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', margin: '0 0 10px', color: '#18201C' }}>
        {sectionTitle}
      </h2>

      {/* 核心穿透指标条 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '8px', marginBottom: '12px', breakInside: 'avoid', pageBreakInside: 'avoid' }}>
        <div style={{ background: '#F4F1EA', border: '1px solid #DFD9CC', borderRadius: '4px', padding: '8px 10px' }}>
          <div style={{ fontSize: '0.7rem', color: '#5F6662' }}>穿透综合费率 / 10Y侵蚀</div>
          <div className="ips-mono" style={{ fontSize: '0.96rem', fontWeight: 700, color: '#0A192F' }}>
            {avgFeePct != null ? `${Number(avgFeePct).toFixed(2)}%` : '—'}
          </div>
          <div style={{ fontSize: '0.68rem', color: '#5F6662' }}>
            {estAnnualFee != null ? `年费约 ${moneyStr(estAnnualFee, currencySymbol)}` : sum.fee_drag_10y_pct != null ? `10Y侵蚀 ${sum.fee_drag_10y_pct}%` : 'MPS口径'}
          </div>
        </div>

        <div style={{ background: '#F4F1EA', border: '1px solid #DFD9CC', borderRadius: '4px', padding: '8px 10px' }}>
          <div style={{ fontSize: '0.7rem', color: '#5F6662' }}>协方差真实波动 / 分散红利</div>
          <div className="ips-mono" style={{ fontSize: '0.96rem', fontWeight: 700, color: '#1E4D3B' }}>
            {risk.true_portfolio_vol_pct != null ? `${risk.true_portfolio_vol_pct}%` : fallback?.avgVol != null ? `${fallback.avgVol.toFixed(1)}%` : '—'}
          </div>
          <div style={{ fontSize: '0.68rem', color: '#5F6662' }}>
            {risk.diversification_benefit_pct != null ? `分散降波 ${risk.diversification_benefit_pct}%` : '基于历史协方差'}
          </div>
        </div>

        <div style={{ background: '#F4F1EA', border: '1px solid #DFD9CC', borderRadius: '4px', padding: '8px 10px' }}>
          <div style={{ fontSize: '0.7rem', color: '#5F6662' }}>有效久期 / 利率+100bps</div>
          <div className="ips-mono" style={{ fontSize: '0.96rem', fontWeight: 700, color: '#0A192F' }}>
            {weightedDuration != null ? `${Number(weightedDuration).toFixed(2)} Y` : '—'}
          </div>
          <div style={{ fontSize: '0.68rem', color: '#8C3B32' }}>
            {weightedDuration != null ? `理论冲击 -${Number(weightedDuration).toFixed(1)}%` : '权益/货币为主'}
          </div>
        </div>

        <div style={{ background: '#F4F1EA', border: '1px solid #DFD9CC', borderRadius: '4px', padding: '8px 10px' }}>
          <div style={{ fontSize: '0.7rem', color: '#5F6662' }}>税后派息 / SOP 覆盖权重</div>
          <div className="ips-mono" style={{ fontSize: '0.96rem', fontWeight: 700, color: '#1E4D3B' }}>
            {aftertaxYield != null ? `${Number(aftertaxYield).toFixed(2)}%` : '—'}
          </div>
          <div style={{ fontSize: '0.68rem', color: '#5F6662' }}>
            SOP 覆盖 {valSop.sop_covered_weight_pct ?? fallback?.sopCoveredWeightPct ?? 0}%
          </div>
        </div>
      </div>

      {/* 工具结构 + 资产穿透 + 股债双九宫格 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px', breakInside: 'avoid', pageBreakInside: 'avoid' }}>
        <div style={{ border: '1px solid #DFD9CC', borderRadius: '4px', padding: '10px', background: '#FAF8F3' }}>
          <div style={{ fontSize: '0.76rem', fontWeight: 700, color: '#18201C', marginBottom: '6px' }}>
            工具形态与资产大类穿透
          </div>
          <div style={{ fontSize: '0.74rem', color: '#333B37', marginBottom: '6px' }}>
            基金 {instMix.funds_pct ?? 0}% ｜ 直投股票 {instMix.direct_stocks_pct ?? 0}% ｜ 直投债券 {instMix.direct_bonds_pct ?? 0}% ｜ 现金 {instMix.cash_pct ?? 0}%
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {assetClasses.map((ac) => (
              <span key={ac.label} className="ips-mono" style={{ fontSize: '0.72rem', background: '#FFFFFF', border: '1px solid #DFD9CC', padding: '2px 7px', borderRadius: '3px' }}>
                {ac.label}: <strong>{ac.pct}%</strong>
              </span>
            ))}
          </div>
          {(sectors.length > 0 || regions.length > 0) && (
            <div style={{ marginTop: '8px', paddingTop: '6px', borderTop: '1px dashed #DFD9CC', fontSize: '0.72rem', color: '#333B37', lineHeight: 1.5 }}>
              {sectors.length > 0 && (
                <div>
                  <strong>前五大行业</strong>（覆盖 {server?.sectors?.coverage_pct ?? 0}%）：
                  {sectors.slice(0, 5).map((s) => `${s.label} ${s.pct}%`).join(' · ')}
                </div>
              )}
              {regions.length > 0 && (
                <div>
                  <strong>地理区域</strong>（覆盖 {server?.regions?.coverage_pct ?? 0}%）：
                  {regions.slice(0, 4).map((r) => `${r.label} ${r.pct}%`).join(' · ')}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ border: '1px solid #DFD9CC', borderRadius: '4px', padding: '10px', background: '#FAF8F3' }}>
          <div style={{ fontSize: '0.76rem', fontWeight: 700, color: '#18201C', marginBottom: '6px' }}>
            晨星股债双九宫格（Equity & Fixed Income Style Box）
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <div>
              <div style={{ fontSize: '0.68rem', color: '#5F6662', marginBottom: '4px' }}>
                权益风格（{(eqStyleObj.coverage_pct ?? 0) === 0 && (eqStyleObj.sleeve_weight_pct ?? 0) === 0 ? '无权益持仓' : `覆盖 ${eqStyleObj.coverage_pct ?? 0}%`}）
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '2px' }}>
                {EQUITY_CELLS.map(([k, lbl]) => {
                  const val = Number(eqGrid[k] || 0);
                  return (
                    <div
                      key={k}
                      style={{
                        fontSize: '0.64rem',
                        padding: '4px 2px',
                        textAlign: 'center',
                        border: '1px solid #E5DFD3',
                        background: val > 0 ? `rgba(10, 25, 47, ${Math.min(0.85, 0.14 + val / 80)})` : '#FFFFFF',
                        color: val >= 40 ? '#FFFFFF' : '#18201C',
                      }}
                    >
                      <div>{lbl}</div>
                      <strong className="ips-mono">{val > 0 ? `${val}%` : '—'}</strong>
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <div style={{ fontSize: '0.68rem', color: '#5F6662', marginBottom: '4px' }}>
                固收风格（{(fiStyle.coverage_pct ?? 0) === 0 && (fiStyle.sleeve_weight_pct ?? 0) === 0 ? '无固收持仓' : `覆盖 ${fiStyle.coverage_pct ?? 0}%`}）
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '2px' }}>
                {BOND_CELLS.map(([k, lbl]) => {
                  const val = Number(fiStyle.grid?.[k] || 0);
                  return (
                    <div
                      key={k}
                      style={{
                        fontSize: '0.64rem',
                        padding: '4px 2px',
                        textAlign: 'center',
                        border: '1px solid #E5DFD3',
                        background: val > 0 ? `rgba(27, 77, 62, ${Math.min(0.85, 0.14 + val / 80)})` : '#FFFFFF',
                        color: val >= 40 ? '#FFFFFF' : '#18201C',
                      }}
                    >
                      <div>{lbl}</div>
                      <strong className="ips-mono">{val > 0 ? `${val}%` : '—'}</strong>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 底层 Top 8 穿透合并重仓 */}
      {underlying.length > 0 && (
        <div style={{ marginBottom: '10px' }}>
          <div className="ips-section-heading" style={{ fontSize: '0.76rem', fontWeight: 700, color: '#5F6662', marginBottom: '5px' }}>
            底层穿透合并 Top {Math.min(8, underlying.length)} 重仓（基金持仓 + 直投个股/债券合并，覆盖率 {server?.underlying_holdings?.coverage_pct ?? 0}%）
          </div>
          <table className="ips-table ips-table-compact">
            <colgroup>
              <col style={{ width: '34%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '31%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>标的 / 发行人</th>
                <th style={{ textAlign: 'right' }}>合并总敞口</th>
                <th style={{ textAlign: 'right' }}>直投部分</th>
                <th style={{ textAlign: 'right' }}>基金穿透</th>
                <th>来源拆解</th>
              </tr>
            </thead>
            <tbody>
              {underlying.slice(0, 8).map((u) => (
                <tr key={u.key}>
                  <td style={{ fontWeight: 600 }}>{u.name} {u.symbol ? `(${u.symbol})` : ''}</td>
                  <td className="ips-mono ips-nowrap" style={{ textAlign: 'right', fontWeight: 700, color: u.total_weight_pct >= 10 ? '#8C3B32' : '#0A192F' }}>
                    {u.total_weight_pct.toFixed(2)}%
                  </td>
                  <td className="ips-mono ips-nowrap" style={{ textAlign: 'right' }}>{u.direct_weight_pct > 0 ? `${u.direct_weight_pct.toFixed(2)}%` : '—'}</td>
                  <td className="ips-mono ips-nowrap" style={{ textAlign: 'right' }}>{u.fund_weight_pct > 0 ? `${u.fund_weight_pct.toFixed(2)}%` : '—'}</td>
                  <td style={{ fontSize: '0.72rem', color: '#5F6662' }}>
                    {(u.sources || []).slice(0, 3).map((s) => `${s.is_direct ? '直投' : s.code} ${s.contribution_pct}%`).join(' + ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 风控诊断摘要 */}
      {diagnostics.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', breakInside: 'avoid', pageBreakInside: 'avoid' }}>
          {diagnostics.slice(0, 4).map((d, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '0.75rem',
                padding: '6px 9px',
                borderRadius: '4px',
                background: d.level === 'warn' ? '#FEF3C7' : '#ECFDF5',
                border: `1px solid ${d.level === 'warn' ? '#F59E0B' : '#10B981'}`,
                color: '#18201C',
              }}
            >
              {d.level === 'warn' ? <AlertTriangle size={13} color="#B45309" /> : <ShieldCheck size={13} color="#047857" />}
              <span>{d.text}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
