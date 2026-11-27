import React, { useState } from 'react';
import { Award, ShieldAlert, TrendingUp, Coins, Users, Lock, BookOpen } from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
  Legend,
} from 'recharts';
import { useLang } from '../i18n/langCore';
import { canViewInternalWarnings } from '../utils/auth';

const MEDAL_STYLE = {
  Gold: { bg: 'rgba(217, 119, 6, 0.16)', color: '#d97706', border: 'rgba(217, 119, 6, 0.4)' },
  Silver: { bg: 'rgba(148, 163, 184, 0.18)', color: '#64748b', border: 'rgba(148, 163, 184, 0.45)' },
  Bronze: { bg: 'rgba(180, 83, 9, 0.14)', color: '#b45309', border: 'rgba(180, 83, 9, 0.35)' },
  Neutral: { bg: 'var(--surface-subtle)', color: 'var(--text-secondary)', border: 'var(--border-subtle)' },
  Negative: { bg: 'var(--danger-bg)', color: 'var(--danger)', border: 'var(--danger)' },
};

const ZONE_STYLE = {
  极度低估: { color: 'var(--success)', bg: 'rgba(16, 185, 129, 0.14)' },
  合理偏低: { color: 'var(--success)', bg: 'rgba(16, 185, 129, 0.10)' },
  合理中性: { color: 'var(--text-secondary)', bg: 'var(--surface-subtle)' },
  偏高拥挤: { color: 'var(--warning)', bg: 'rgba(245, 158, 11, 0.15)' },
};

function renderInline(text) {
  if (!text) return null;
  const clean = String(text)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
  const parts = clean.split(/(\*\*`[^`]+`\*\*|\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, idx) => {
    if (p.startsWith('**`') && p.endsWith('`**') && p.length > 5) {
      return (
        <strong key={idx}>
          <code
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.84em',
              padding: '1px 5px',
              borderRadius: '4px',
              background: 'var(--surface-subtle)',
            }}
          >
            {p.slice(3, -3)}
          </code>
        </strong>
      );
    }
    if (p.startsWith('**') && p.endsWith('**') && p.length > 4) {
      const inner = p.slice(2, -2);
      if (inner.startsWith('`') && inner.endsWith('`') && inner.length > 2) {
        return (
          <strong key={idx}>
            <code
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.84em',
                padding: '1px 5px',
                borderRadius: '4px',
                background: 'var(--surface-subtle)',
              }}
            >
              {inner.slice(1, -1)}
            </code>
          </strong>
        );
      }
      return <strong key={idx}>{inner}</strong>;
    }
    if (p.startsWith('`') && p.endsWith('`') && p.length > 2) {
      return (
        <code
          key={idx}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.84em',
            padding: '1px 5px',
            borderRadius: '4px',
            background: 'var(--surface-subtle)',
          }}
        >
          {p.slice(1, -1)}
        </code>
      );
    }
    return <React.Fragment key={idx}>{p}</React.Fragment>;
  });
}

function SimpleMarkdown({ content }) {
  const lines = String(content || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    // Image Markdown
    const imgMatch = line.trim().match(/^!\[(.*?)\]\((.*?)\)$/);
    if (imgMatch) {
      const [, altText] = imgMatch;
      blocks.push(
        <div
          key={`img-card-${i}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            margin: '12px 0',
            padding: '10px 14px',
            background: 'var(--surface-subtle)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '8px',
            fontSize: '0.82rem',
            color: 'var(--text-primary)',
            fontWeight: 600,
          }}
        >
          <TrendingUp size={16} style={{ color: 'var(--accent-color)', flexShrink: 0 }} />
          <span>📊 图表索引：{altText}</span>
          <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 400, marginLeft: 'auto' }}>
            （已在上部图表交互区动态渲染）
          </span>
        </div>
      );
      i++;
      continue;
    }
    // Code fence
    if (line.trim().startsWith('```')) {
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      blocks.push(
        <pre
          key={`code-${i}`}
          style={{
            background: 'var(--surface-subtle)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '6px',
            padding: '10px 12px',
            overflowX: 'auto',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.78rem',
            lineHeight: 1.5,
          }}
        >
          {codeLines.join('\n')}
        </pre>
      );
      continue;
    }
    // Table
    if (line.trim().startsWith('|') && i + 1 < lines.length && /^\s*\|?[\s:-]+\|/.test(lines[i + 1])) {
      const parseRow = (rowStr) =>
        rowStr
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((c) => c.trim());
      const headers = parseRow(line);
      i += 2;
      const bodyRows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        bodyRows.push(parseRow(lines[i]));
        i++;
      }
      blocks.push(
        <div key={`tbl-${i}`} style={{ overflowX: 'auto', margin: '10px 0' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ background: 'var(--surface-subtle)', borderBottom: '1px solid var(--border-subtle)' }}>
                {headers.map((h, hi) => (
                  <th key={hi} style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {renderInline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((row, ri) => (
                <tr key={ri} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  {headers.map((_, ci) => (
                    <td key={ci} style={{ padding: '7px 10px', verticalAlign: 'top', lineHeight: 1.5 }}>
                      {renderInline(row[ci] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }
    // Headings
    const hm = line.match(/^(#{1,4})\s+(.*)$/);
    if (hm) {
      const level = hm[1].length;
      const sizes = { 1: '1.22rem', 2: '1.06rem', 3: '0.96rem', 4: '0.88rem' };
      blocks.push(
        <div
          key={`h-${i}`}
          style={{
            fontSize: sizes[level] || '0.9rem',
            fontWeight: 700,
            color: 'var(--text-primary)',
            marginTop: level <= 2 ? '16px' : '12px',
            marginBottom: '6px',
            paddingBottom: level === 2 ? '4px' : 0,
            borderBottom: level === 2 ? '1px solid var(--border-subtle)' : 'none',
          }}
        >
          {renderInline(hm[2])}
        </div>
      );
      i++;
      continue;
    }
    // Blockquote
    if (line.trim().startsWith('>')) {
      const qLines = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        qLines.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      blocks.push(
        <blockquote
          key={`q-${i}`}
          style={{
            margin: '8px 0',
            padding: '8px 12px',
            borderLeft: '3px solid var(--accent-color)',
            background: 'var(--surface-subtle)',
            borderRadius: '0 6px 6px 0',
            fontSize: '0.83rem',
            lineHeight: 1.6,
            color: 'var(--text-secondary)',
          }}
        >
          {qLines.map((ql, qi) => (
            <div key={qi}>{renderInline(ql)}</div>
          ))}
        </blockquote>
      );
      continue;
    }
    // Unordered or ordered list
    if (/^\s*(?:[-*+]|\d+\.)\s+/.test(line)) {
      const listItems = [];
      while (i < lines.length && /^\s*(?:[-*+]|\d+\.)\s+/.test(lines[i])) {
        listItems.push(lines[i].replace(/^\s*(?:[-*+]|\d+\.)\s+/, ''));
        i++;
      }
      blocks.push(
        <ul key={`ul-${i}`} style={{ margin: '6px 0', paddingLeft: '20px', fontSize: '0.84rem', lineHeight: 1.65 }}>
          {listItems.map((li, lidx) => (
            <li key={lidx} style={{ marginBottom: '3px' }}>
              {renderInline(li)}
            </li>
          ))}
        </ul>
      );
      continue;
    }
    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      blocks.push(<hr key={`hr-${i}`} style={{ border: 'none', borderTop: '1px solid var(--border-subtle)', margin: '12px 0' }} />);
      i++;
      continue;
    }
    // Paragraph
    blocks.push(
      <p key={`p-${i}`} style={{ margin: '6px 0', fontSize: '0.85rem', lineHeight: 1.7, color: 'var(--text-secondary)' }}>
        {renderInline(line)}
      </p>
    );
    i++;
  }

  return <div>{blocks}</div>;
}

export default function FundSopReportView({ sopData, currentUser = null }) {
  const { lang } = useLang();
  const showWarnings = currentUser
    ? canViewInternalWarnings(currentUser)
    : Boolean(sopData?.can_view_sop_warnings);
  const rawTabs = Array.isArray(sopData?.commercial_tabs) ? sopData.commercial_tabs : [];
  const tabs = showWarnings
    ? rawTabs
    : rawTabs.filter((t) => {
        const id = String(t?.id || '').trim();
        const label = String(t?.label || '').trim();
        if (id === 'masters' || id === 'risks_onepager') return false;
        if (/risk|stress|red_team|warning/i.test(id)) return false;
        if (/红队|红旗|审问|警示|警告/.test(label)) return false;
        return true;
      });
  const hasInternal = Boolean(sopData?.can_view_internal_decision && sopData?.decision_md);
  const [activeTabId, setActiveTabId] = useState(tabs[0]?.id || 'executive_memo');

  if (!sopData?.has_report) return null;

  const effectiveMedal = !showWarnings && sopData.medal_rating === 'Negative' ? '' : sopData.medal_rating;
  const mStyle = MEDAL_STYLE[effectiveMedal] || MEDAL_STYLE.Neutral;
  const zStyle = ZONE_STYLE[sopData.valuation_zone] || ZONE_STYLE.合理中性;
  const currentTab =
    activeTabId === '__internal_decision__' && hasInternal
      ? { id: '__internal_decision__', label: '🎯 内部决策与 Plan A-D', markdown: sopData.decision_md }
      : tabs.find((t) => t.id === activeTabId) || tabs[0];

  const valSum = sopData.valuation_summary || {};
  const divSum = sopData.dividend_summary || {};
  const masters = Array.isArray(sopData.masters) ? sopData.masters : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Executive Metric Banner */}
      <div className="glass-card" style={{ padding: '18px 20px', marginBottom: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px', marginBottom: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '6px' }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '3px 10px',
                  borderRadius: '6px',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  background: mStyle.bg,
                  color: mStyle.color,
                  border: `1px solid ${mStyle.border}`,
                }}
              >
                <Award size={14} />
                {effectiveMedal
                  ? `Morningstar 2026: ${effectiveMedal} (${sopData.pillar_score != null ? Number(sopData.pillar_score).toFixed(2) : '—'})`
                  : (lang === 'en' ? 'SOP Deep Research Covered' : 'SOP 深度商业研究已覆盖')}
              </span>
              <span
                style={{
                  padding: '3px 9px',
                  borderRadius: '6px',
                  fontSize: '0.76rem',
                  fontWeight: 700,
                  background: zStyle.bg,
                  color: zStyle.color,
                }}
              >
                {sopData.val_route} 估值水位: {sopData.valuation_zone}
                {sopData.valuation_pct_5y != null ? ` (${Number(sopData.valuation_pct_5y).toFixed(1)}%分位)` : ''}
              </span>
              <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                SOP v{sopData.sop_version} · 报告日 {sopData.report_date} · 数据截至 {sopData.data_as_of}
              </span>
            </div>
            <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.5 }}>
              {sopData.one_liner}
            </div>
          </div>
        </div>

        {/* Key Quant Highlights */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '10px', marginBottom: '12px' }}>
          <div style={{ background: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)', borderRadius: '6px', padding: '10px 12px' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <TrendingUp size={12} /> {lang === 'en' ? 'Valuation Anchor' : '历史估值中枢'}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.88rem', fontWeight: 700, marginTop: '4px' }}>
              {valSum.pe_current != null
                ? `PE ${valSum.pe_current} (${valSum.pe_5y_pct ?? '—'}% 5Y)`
                : valSum.ytm_pct != null
                ? `YTM ${valSum.ytm_pct}% (久期 ${valSum.duration_yrs ?? '—'}y)`
                : sopData.valuation_zone}
            </div>
          </div>

          <div style={{ background: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)', borderRadius: '6px', padding: '10px 12px' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Coins size={12} /> {lang === 'en' ? 'Dividend & After-Tax' : '税前 / 税后分红率'}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.88rem', fontWeight: 700, marginTop: '4px', color: 'var(--info)' }}>
              {sopData.dividend_yield_ttm != null ? `${Number(sopData.dividend_yield_ttm).toFixed(2)}%` : '—'}
              {divSum.div_yield_after_tax_pct != null ? ` / ${Number(divSum.div_yield_after_tax_pct).toFixed(2)}%` : ''}
            </div>
          </div>

          <div style={{ background: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)', borderRadius: '6px', padding: '10px 12px' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              {lang === 'en' ? 'Spread vs 10Y RF' : '相对 10Y 国债利差'}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.88rem', fontWeight: 700, marginTop: '4px' }}>
              {sopData.dividend_spread_rf != null
                ? `${sopData.dividend_spread_rf >= 0 ? '+' : ''}${Number(sopData.dividend_spread_rf).toFixed(2)}%`
                : '—'}
              {divSum.spread_5y_pctile != null ? ` (${divSum.spread_5y_pctile}%分位)` : ''}
            </div>
          </div>

          <div style={{ background: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)', borderRadius: '6px', padding: '10px 12px' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Users size={12} /> {showWarnings ? (lang === 'en' ? 'Value Masters Consensus' : '六大价值大师审问') : (lang === 'en' ? 'Research Dimensions' : '深度研究覆盖维度')}
            </div>
            <div style={{ fontSize: '0.82rem', fontWeight: 700, marginTop: '4px' }}>
              {showWarnings
                ? (masters.length > 0
                    ? `${masters.filter((m) => String(m.stance).includes('支持')).length} 支持 / ${masters.length} 位已审`
                    : '已覆盖 6 流派')
                : (lang === 'en' ? 'Mechanics · Valuation · Dividend' : '商业机制 · 历史估值 · 分红')}
            </div>
          </div>
        </div>

        {showWarnings && sopData.red_flag_top && (
          <div
            style={{
              padding: '9px 12px',
              borderRadius: '6px',
              background: 'var(--danger-bg)',
              border: '1px solid var(--danger)',
              color: 'var(--danger)',
              fontSize: '0.8rem',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <ShieldAlert size={15} style={{ flexShrink: 0 }} />
            <span>
              <strong>最大结构性风险：</strong>
              {sopData.red_flag_top}
            </span>
          </div>
        )}
      </div>

      {/* Sub-Tabs Navigation */}
      <div className="glass-card" style={{ padding: '14px 18px', marginBottom: 0 }}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', paddingBottom: '12px', borderBottom: '1px solid var(--border-subtle)', marginBottom: '14px' }}>
          {tabs.map((t) => {
            const active = currentTab?.id === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTabId(t.id)}
                className={active ? 'create-btn' : 'action-btn-secondary'}
                style={{ padding: '6px 12px', fontSize: '0.8rem' }}
              >
                {t.label}
              </button>
            );
          })}
          {hasInternal && (
            <button
              type="button"
              onClick={() => setActiveTabId('__internal_decision__')}
              className={currentTab?.id === '__internal_decision__' ? 'create-btn' : 'action-btn-secondary'}
              style={{
                padding: '6px 12px',
                fontSize: '0.8rem',
                marginLeft: 'auto',
                borderColor: 'var(--danger)',
                color: currentTab?.id === '__internal_decision__' ? '#fff' : 'var(--danger)',
                background: currentTab?.id === '__internal_decision__' ? 'var(--danger)' : 'var(--danger-bg)',
              }}
            >
              <Lock size={13} /> 内部决策 B稿 (Admin)
            </button>
          )}
        </div>

        {currentTab?.id === 'valuation_dividend' && (
          (Array.isArray(valSum.band_series) && valSum.band_series.length > 0) ||
          (Array.isArray(divSum.yield_series) && divSum.yield_series.length > 0) ||
          (Array.isArray(divSum.yield_compare_bars) && divSum.yield_compare_bars.length > 0)
        ) && (() => {
          const bandSeries = Array.isArray(valSum.band_series) ? valSum.band_series : [];
          const bandLevels = valSum.band_levels || {};
          const yieldSeries = Array.isArray(divSum.yield_series) ? divSum.yield_series : [];
          const compareBars = Array.isArray(divSum.yield_compare_bars) ? divSum.yield_compare_bars : [];
          const barColors = {
            current: '#0A192F',
            aftertax: '#1B4D3E',
            history: '#C5A059',
            rf: '#64748B',
            peer: '#94A3B8',
          };
          const fmtTickDate = (v) => (typeof v === 'string' && v.length >= 7 ? v.slice(0, 7) : v);

          return (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '14px', marginBottom: '18px' }}>
              {bandSeries.length > 0 && (
                <div style={{ background: '#FCFBF9', border: '1px solid #CBD5E1', borderRadius: '10px', padding: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.88rem', fontWeight: 700, color: '#0A192F' }}>
                      {valSum.chart_title || '历史估值 Band 与当前水位'}
                    </span>
                    <span style={{ fontSize: '0.72rem', color: '#64748B', fontWeight: 600 }}>
                      {valSum.val_route || ''} {valSum.valuation_zone ? `· ${valSum.valuation_zone}` : ''}
                    </span>
                  </div>
                  <div style={{ width: '100%', height: 240 }}>
                    <ResponsiveContainer width="100%" height={240}>
                      <ComposedChart data={bandSeries} margin={{ top: 10, right: 18, left: 0, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                        <XAxis dataKey="date" tickFormatter={fmtTickDate} tick={{ fontSize: 11, fill: '#64748B' }} minTickGap={24} />
                        <YAxis domain={['auto', 'auto']} tick={{ fontSize: 11, fill: '#64748B' }} width={42} />
                        <Tooltip
                          contentStyle={{ background: '#FCFBF9', border: '1px solid #C5A059', fontSize: '12px' }}
                          formatter={(val, name) => [typeof val === 'number' ? val.toFixed(2) : val, name]}
                        />
                        <Legend wrapperStyle={{ fontSize: '11px' }} />
                        {valSum.val_route === 'FV1' ? (
                          <>
                            {bandLevels.p10 != null && bandLevels.p90 != null && (
                              <ReferenceArea y1={bandLevels.p10} y2={bandLevels.p90} fill="#E2E8F0" fillOpacity={0.45} />
                            )}
                            {bandLevels.p25 != null && bandLevels.p75 != null && (
                              <ReferenceArea y1={bandLevels.p25} y2={bandLevels.p75} fill="#BFDBFE" fillOpacity={0.35} />
                            )}
                            {bandLevels.p50 != null && (
                              <ReferenceLine y={bandLevels.p50} stroke="#C5A059" strokeDasharray="4 4" label={{ value: `P50 ${bandLevels.p50}`, position: 'insideTopRight', fill: '#C5A059', fontSize: 10 }} />
                            )}
                            <Line type="monotone" dataKey="value" name={valSum.metric_label || 'PE-TTM'} stroke="#0A192F" strokeWidth={2.2} dot={{ r: 2.5, fill: '#0A192F' }} activeDot={{ r: 5, fill: '#B91C1C' }} />
                          </>
                        ) : valSum.val_route === 'FV2' ? (
                          <>
                            <Line type="monotone" dataKey="rf" name="10Y无风险基准(%)" stroke="#64748B" strokeWidth={1.8} dot={false} />
                            <Line type="monotone" dataKey="ytm_gross" name="组合毛YTM(%)" stroke="#0A192F" strokeWidth={2.2} dot={false} />
                            {bandLevels.ytm_net_pct != null && (
                              <Line type="monotone" dataKey="ytm_net" name="扣费净YTM(%)" stroke="#C5A059" strokeWidth={1.8} strokeDasharray="4 3" dot={false} />
                            )}
                          </>
                        ) : (
                          <Line type="monotone" dataKey="value" name={valSum.metric_label || '估值指标'} stroke="#0A192F" strokeWidth={2} dot={{ r: 2.5 }} />
                        )}
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  {valSum.chart_note && (
                    <div style={{ fontSize: '0.73rem', color: '#64748B', marginTop: '6px' }}>{valSum.chart_note}</div>
                  )}
                </div>
              )}

              {(yieldSeries.length > 0 || compareBars.length > 0) && (
                <div style={{ background: '#FCFBF9', border: '1px solid #CBD5E1', borderRadius: '10px', padding: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.88rem', fontWeight: 700, color: '#0A192F' }}>
                      {divSum.chart_title || '历史与现在分红收益率对比'}
                    </span>
                    <span style={{ fontSize: '0.72rem', color: '#1B4D3E', fontWeight: 600 }}>
                      {divSum.rf_label || '10Y无风险对比'}
                    </span>
                  </div>
                  {yieldSeries.length > 0 && (
                    <div style={{ width: '100%', height: 185 }}>
                      <ResponsiveContainer width="100%" height={185}>
                        <ComposedChart data={yieldSeries} margin={{ top: 8, right: 16, left: 0, bottom: 2 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                          <XAxis dataKey="date" tickFormatter={fmtTickDate} tick={{ fontSize: 10.5, fill: '#64748B' }} minTickGap={24} />
                          <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10.5, fill: '#64748B' }} width={40} unit="%" />
                          <Tooltip
                            contentStyle={{ background: '#FCFBF9', border: '1px solid #C5A059', fontSize: '12px' }}
                            formatter={(val, name) => [typeof val === 'number' ? `${val.toFixed(2)}%` : val, name]}
                          />
                          <Legend wrapperStyle={{ fontSize: '11px' }} />
                          {divSum.history_median_pct != null && (
                            <ReferenceLine y={divSum.history_median_pct} stroke="#C5A059" strokeDasharray="4 4" label={{ value: `历史中位 ${divSum.history_median_pct}%`, position: 'insideTopRight', fill: '#C5A059', fontSize: 10 }} />
                          )}
                          <Line type="monotone" dataKey="yield_pct" name={divSum.yield_label || '分红率(%)'} stroke="#0A192F" strokeWidth={2.2} dot={false} activeDot={{ r: 5, fill: '#B91C1C' }} />
                          <Line type="monotone" dataKey="rf" name={divSum.rf_label || '10Y基准(%)'} stroke="#64748B" strokeWidth={1.7} dot={false} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                  {compareBars.length > 0 && (
                    <div style={{ width: '100%', height: Math.max(135, compareBars.length * 28), marginTop: '6px' }}>
                      <ResponsiveContainer width="100%" height={Math.max(135, compareBars.length * 28)}>
                        <BarChart data={compareBars} layout="vertical" margin={{ top: 4, right: 24, left: 10, bottom: 2 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" horizontal={false} />
                          <XAxis type="number" tick={{ fontSize: 10.5, fill: '#64748B' }} unit="%" />
                          <YAxis type="category" dataKey="label" width={120} tick={{ fontSize: 10.5, fill: '#0A192F' }} />
                          <Tooltip
                            contentStyle={{ background: '#FCFBF9', border: '1px solid #C5A059', fontSize: '12px' }}
                            formatter={(val) => [`${Number(val).toFixed(2)}%`, '年化收益率']}
                          />
                          <Bar dataKey="value" barSize={15} radius={[0, 4, 4, 0]}>
                            {compareBars.map((entry, idx) => (
                              <Cell key={`bar-${idx}`} fill={barColors[entry.category] || '#94A3B8'} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                  {divSum.chart_note && (
                    <div style={{ fontSize: '0.73rem', color: '#64748B', marginTop: '6px' }}>{divSum.chart_note}</div>
                  )}
                </div>
              )}
            </div>
          );
        })()}

        {currentTab ? (
          <SimpleMarkdown content={currentTab.markdown} />
        ) : (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', padding: '16px 0', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <BookOpen size={15} /> 暂无分段正文内容
          </div>
        )}
      </div>
    </div>
  );
}
