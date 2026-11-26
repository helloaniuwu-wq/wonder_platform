import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X, Layers, AlertTriangle, TrendingUp } from 'lucide-react';
import XRayReportSection from './XRayReportSection';

export default function XRayPrintReport({
  open,
  onClose,
  portfolioName = '未命名投资组合',
  currency = 'USD',
  currencySymbol = '$',
  totalNav = 0,
  xrayData = null,
  localXRay = null,
}) {
  useEffect(() => {
    if (!open) return undefined;
    document.body.classList.add('xray-report-open');
    return () => {
      document.body.classList.remove('xray-report-open');
    };
  }, [open]);

  if (!open) return null;

  const server = xrayData && xrayData.summary ? xrayData : null;
  const holdings = server?.holdings || localXRay?.holdings || [];
  const stressList = (server?.stress_test || []).filter((s) => s.available);
  const risk = server?.risk_analytics || {};
  const overlapPairs = server?.overlap?.pairs || [];
  const valSop = server?.valuation_cashflow_sop || {};
  const todayStr = new Date().toISOString().slice(0, 10);

  const modal = (
    <div className="wealth-report-overlay">
      <div className="wealth-report-container">
        {/* Top Floating Controls */}
        <div
          className="no-print"
          style={{
            position: 'sticky',
            top: '14px',
            zIndex: 20,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '12px',
            background: '#18201C',
            color: '#FBF9F4',
            padding: '10px 16px',
            borderRadius: '6px',
            marginBottom: '16px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.28)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.84rem' }}>
            <Layers size={16} color="#C5A059" />
            <span>Morningstar × Wonder Portfolio X-Ray 透视报告预览（A4 排版）</span>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              onClick={() => window.print()}
              style={{
                background: '#C5A059',
                color: '#0A192F',
                border: 'none',
                borderRadius: '4px',
                padding: '6px 14px',
                fontSize: '0.8rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Printer size={14} /> 导出 PDF / 打印
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                background: 'rgba(255,255,255,0.12)',
                color: '#FBF9F4',
                border: 'none',
                borderRadius: '4px',
                padding: '6px 12px',
                fontSize: '0.8rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <X size={14} /> 关闭
            </button>
          </div>
        </div>

        <div id="printable-report" className="ips-paper" style={{ padding: '26px 30px' }}>
          {/* Header */}
          <header
            style={{
              borderBottom: '2px solid #0A192F',
              paddingBottom: '12px',
              marginBottom: '18px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-end',
              gap: '16px',
              flexWrap: 'wrap',
            }}
          >
            <div>
              <div style={{ fontSize: '0.72rem', letterSpacing: '0.14em', color: '#9A6F38', fontWeight: 700 }}>
                WONDER ATELIER · INSTITUTIONAL PORTFOLIO X-RAY
              </div>
              <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', margin: '4px 0 0', color: '#0A192F' }}>
                {portfolioName} — 组合全维穿透体检报告
              </h1>
            </div>
            <div style={{ textAlign: 'right', fontSize: '0.78rem', color: '#5F6662' }}>
              <div>基准币种：<strong>{currency}</strong> ｜ 报告日期：<strong>{todayStr}</strong></div>
              {totalNav > 0 && (
                <div>模拟/实盘资产净值：<strong className="ips-mono">{currencySymbol}{Math.round(totalNav).toLocaleString('en-US')}</strong></div>
              )}
            </div>
          </header>

          {/* 核心 7 维 X-Ray 专节 */}
          <XRayReportSection
            xrayData={server}
            localXRay={localXRay}
            currencySymbol={currencySymbol}
            sectionTitle="一、底层穿透画像、双九宫格风格与 Top 8 合并重仓"
          />

          {/* 持仓明细表 */}
          <section style={{ marginBottom: '18px' }}>
            <h3 className="ips-section-heading" style={{ fontFamily: 'var(--font-display)', fontSize: '1.02rem', margin: '0 0 8px', color: '#0A192F', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <TrendingUp size={15} color="#9A6F38" /> 二、组合持仓明细与 SOP 研究覆盖
            </h3>
            <table className="ips-table ips-table-compact">
              <colgroup>
                <col style={{ width: '11%' }} />
                <col style={{ width: '31%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '7%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '17%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>代码</th>
                  <th>资产名称</th>
                  <th>工具形态</th>
                  <th style={{ textAlign: 'right' }}>权重</th>
                  <th style={{ textAlign: 'right' }}>费率</th>
                  <th style={{ textAlign: 'right' }}>久期</th>
                  <th style={{ textAlign: 'right' }}>分红/YTM</th>
                  <th>SOP 奖牌 / 估值水位</th>
                </tr>
              </thead>
              <tbody>
                {holdings.map((h) => {
                  const typeLbl =
                    h.instrument_type === 'direct_stock'
                      ? '直投股票'
                      : h.instrument_type === 'direct_bond'
                      ? '直投债券'
                      : h.instrument_type === 'cash'
                      ? '现金'
                      : '基金';
                  const wp = h.weight_pct ?? h.weightPct ?? 0;
                  const fp = h.fee_pct ?? h.feePct;
                  const yp = h.yield_pct ?? h.yieldPct;
                  return (
                    <tr key={h.isin}>
                      <td className="ips-mono" style={{ fontWeight: 700 }}>{h.code || h.isin}</td>
                      <td>{h.name}</td>
                      <td className="ips-nowrap">{typeLbl}</td>
                      <td className="ips-mono ips-nowrap" style={{ textAlign: 'right', fontWeight: 700 }}>{Number(wp).toFixed(1)}%</td>
                      <td className="ips-mono ips-nowrap" style={{ textAlign: 'right' }}>{fp != null ? `${Number(fp).toFixed(2)}%` : '—'}</td>
                      <td className="ips-mono ips-nowrap" style={{ textAlign: 'right' }}>{h.duration != null ? `${Number(h.duration).toFixed(1)}Y` : '—'}</td>
                      <td className="ips-mono ips-nowrap" style={{ textAlign: 'right' }}>{yp != null ? `${Number(yp).toFixed(2)}%` : '—'}</td>
                      <td>
                        {h.has_sop_report || h.hasSopReport
                          ? `${h.sop_medal || '已研判'} · ${h.sop_valuation_zone || '已标注'}`
                          : h.instrument_type === 'fund'
                          ? '待深入研究'
                          : '直投证券'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          {/* 重叠、风险贡献与压力测试 */}
          {(overlapPairs.length > 0 || (risk.risk_contributions || []).length > 0 || stressList.length > 0) && (
            <section style={{ marginBottom: '18px' }}>
              <h3 className="ips-section-heading" style={{ fontFamily: 'var(--font-display)', fontSize: '1.02rem', margin: '0 0 8px', color: '#0A192F', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <AlertTriangle size={15} color="#9A6F38" /> 三、持仓重叠、真实风险贡献与历史危机回放
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '10px', breakInside: 'avoid', pageBreakInside: 'avoid' }}>
                {overlapPairs.length > 0 && (
                  <div style={{ border: '1px solid #DFD9CC', borderRadius: '4px', padding: '10px' }}>
                    <div style={{ fontSize: '0.76rem', fontWeight: 700, color: '#5F6662', marginBottom: '6px' }}>两两前十大持仓重叠检视</div>
                    {overlapPairs.slice(0, 5).map((p, idx) => (
                      <div key={idx} style={{ fontSize: '0.74rem', marginBottom: '4px', display: 'flex', justifyContent: 'space-between' }}>
                        <span>{p.left_code} × {p.right_code}</span>
                        <strong className="ips-mono" style={{ color: p.overlap_pct >= 25 ? '#8C3B32' : '#0A192F' }}>{p.overlap_pct}%</strong>
                      </div>
                    ))}
                  </div>
                )}
                {(risk.risk_contributions || []).length > 0 && (
                  <div style={{ border: '1px solid #DFD9CC', borderRadius: '4px', padding: '10px' }}>
                    <div style={{ fontSize: '0.76rem', fontWeight: 700, color: '#5F6662', marginBottom: '6px' }}>协方差真实风险贡献 (% RC)</div>
                    {risk.risk_contributions.slice(0, 6).map((rc) => (
                      <div key={rc.code} style={{ fontSize: '0.74rem', marginBottom: '4px', display: 'flex', justifyContent: 'space-between' }}>
                        <span>{rc.code}（权重 {rc.weight_pct}%）</span>
                        <strong className="ips-mono">贡献 {rc.risk_contrib_pct}%</strong>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {stressList.length > 0 && (
                <table className="ips-table ips-table-compact">
                  <colgroup>
                    <col style={{ width: '28%' }} />
                    <col style={{ width: '26%' }} />
                    <col style={{ width: '14%' }} />
                    <col style={{ width: '16%' }} />
                    <col style={{ width: '16%' }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>历史极端市场窗口</th>
                      <th>区间</th>
                      <th style={{ textAlign: 'right' }}>数据覆盖率</th>
                      <th style={{ textAlign: 'right' }}>区间累计回报</th>
                      <th style={{ textAlign: 'right' }}>最大深水回撤</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stressList.map((s) => (
                      <tr key={s.id}>
                        <td style={{ fontWeight: 600 }}>{s.label}</td>
                        <td className="ips-mono ips-nowrap" style={{ fontSize: '0.72rem' }}>{s.start} → {s.end}</td>
                        <td className="ips-mono ips-nowrap" style={{ textAlign: 'right' }}>{s.coverage_weight}%</td>
                        <td className="ips-mono ips-nowrap" style={{ textAlign: 'right', fontWeight: 700, color: s.total_return_pct >= 0 ? '#1E4D3B' : '#8C3B32' }}>
                          {s.total_return_pct >= 0 ? '+' : ''}{s.total_return_pct}%
                        </td>
                        <td className="ips-mono ips-nowrap" style={{ textAlign: 'right', fontWeight: 700, color: '#8C3B32' }}>
                          {s.max_drawdown_pct}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          )}

          {/* SOP 红旗提醒 */}
          {(valSop.red_flags || []).length > 0 && (
            <section style={{ marginBottom: '14px', pageBreakInside: 'avoid', breakInside: 'avoid' }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#8C3B32', marginBottom: '6px' }}>
                SOP v2.0 红队关键风险摘要（Red Flags）
              </div>
              {valSop.red_flags.map((rf) => (
                <div key={rf.slug} style={{ fontSize: '0.75rem', padding: '6px 10px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '4px', marginBottom: '4px' }}>
                  <strong>{rf.code} ({rf.weight_pct}%)</strong>：{rf.red_flag}
                </div>
              ))}
            </section>
          )}

          <footer style={{ marginTop: '16px', paddingTop: '10px', borderTop: '1px solid #C8C1B4', fontSize: '0.72rem', color: '#5F6662', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
            <div>Wonder Atelier 客观商业与量化穿透引擎生成 · 未穿透底层持仓与行业均如实标示覆盖率，不作推算填补。</div>
            <div>Wonder Platform FIS Hub • {todayStr}</div>
          </footer>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
