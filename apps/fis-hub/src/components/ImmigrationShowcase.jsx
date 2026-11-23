import React, { useState } from 'react'

const PORTFOLIOS = {
  zh: [
    {
      id: 'conservative', emoji: '🛡️',
      name: '资本守护型', tag: '低风险 · 稳健保值', tagColor: '#3b82f6', tagBg: '#1e3a8a33',
      headline: '以债券为核心，守护移港资产',
      stats: [
        { label: '7年目标值', value: 'HK$3,800万', hl: true },
        { label: '年化预期', value: '4.5–5.5%', hl: false },
        { label: '最大回撤', value: '< 8%', hl: false },
        { label: '月现金流', value: '—', hl: false },
      ],
      allocation: [
        { label: '投资级债券（全球/亚洲）', pct: 70, color: '#3b82f6' },
        { label: '多元资产', pct: 20, color: '#60a5fa' },
        { label: '货币市场', pct: 10, color: '#93c5fd' },
      ],
      analysis: '高利率尾段是配置优质投资级债券的合理时机。在ILI结构内，债息享税务递延，实际税后回报显著优于直接持有。7年到期（第二次续期节点），本金大概率完好。',
      risk: '利率上行期债券价格阶段性承压，建议分批建仓，平滑成本。适合能接受短期波动但不接受较大亏损的投资人。',
      persona: '55岁以上 · 财富传承优先 · 移港后无需工作收入 · 以资产保值为第一目标',
      tabs: ['收益分析', '风险提示', '适合人群'],
    },
    {
      id: 'income', emoji: '💰',
      name: '月息现金流型', tag: '中风险 · 稳定派息', tagColor: '#10b981', tagBg: '#064e3b33',
      headline: '每月派息，覆盖香港生活开支',
      stats: [
        { label: '7年目标值', value: 'HK$3,500万+', hl: true },
        { label: '年化预期', value: '5.5–6.5%', hl: false },
        { label: '最大回撤', value: '< 15%', hl: false },
        { label: '月现金流', value: '≈ HK$11万', hl: false },
      ],
      allocation: [
        { label: '多元收益基金（月派）', pct: 40, color: '#10b981' },
        { label: '高息股票/REITs', pct: 35, color: '#34d399' },
        { label: '亚洲债券', pct: 25, color: '#6ee7b7' },
      ],
      analysis: 'HK$2,700万按5%派息率，估算每月税后现金流约HK$11万，足以覆盖香港中等生活开支（含租金约3–4万）。7年累计派息约HK$945万，本金相对稳定，是「7年无忧居港」的最直接实现路径。',
      risk: '衰退期高息资产派息率可能下滑。通过多行业分散（含REITs/高息股/多资产）可有效对冲单一行业风险。',
      persona: '40–55岁 · 移港初期生活成本刚性 · 希望以组合派息覆盖租金及生活费 · 减少对工作收入依赖',
      tabs: ['收益分析', '风险提示', '适合人群'],
    },
    {
      id: 'growth', emoji: '📈',
      name: '全球长线增长型', tag: '中高风险 · 长线复利', tagColor: '#f59e0b', tagBg: '#78350f33',
      headline: '对标全球指数，7年深度复利',
      stats: [
        { label: '7年目标值', value: 'HK$4,650万–5,290万', hl: true },
        { label: '年化预期', value: '8–10%', hl: false },
        { label: '最大回撤', value: '15–25%（单年）', hl: false },
        { label: '月现金流', value: '—', hl: false },
      ],
      allocation: [
        { label: '全球股票累积型', pct: 70, color: '#f59e0b' },
        { label: '科技/主题基金', pct: 20, color: '#fbbf24' },
        { label: '多元对冲', pct: 10, color: '#fde68a' },
      ],
      analysis: '使用累积型基金（利润全部再投入），对标MSCI全球指数历史年化8–10%。7年时间足以穿越一个完整经济周期。ILI结构内资本利得税务递延，是纯直接投资无法比拟的结构优势。',
      risk: '宏观衰退/地缘冲突期波动剧烈（最大回撤可达-25%）。适合心理承受能力强、不需短期提现的投资人。',
      persona: '45岁以下 · 移港是人生新起点 · 不依赖组合收益维生 · 能接受7年内大幅波动以换取更高终值',
      tabs: ['收益分析', '风险提示', '适合人群'],
    },
  ],
  en: [
    {
      id: 'conservative', emoji: '🛡️',
      name: 'Capital Preservation', tag: 'Low Risk · Stable', tagColor: '#3b82f6', tagBg: '#1e3a8a33',
      headline: 'Bond-core strategy to protect HK assets',
      stats: [
        { label: '7-yr Target', value: 'HK$38M', hl: true },
        { label: 'Est. CAGR', value: '4.5–5.5%', hl: false },
        { label: 'Max Drawdown', value: '< 8%', hl: false },
        { label: 'Monthly Flow', value: '—', hl: false },
      ],
      allocation: [
        { label: 'Investment Grade Bonds (Global/Asian)', pct: 70, color: '#3b82f6' },
        { label: 'Multi-Asset', pct: 20, color: '#60a5fa' },
        { label: 'Money Market', pct: 10, color: '#93c5fd' },
      ],
      analysis: 'The tail end of the high rate cycle is an opportune moment for IG bonds. Within ILI, bond income benefits from tax deferral — delivering materially better after-tax returns vs. direct holding. Capital should be well-preserved at the 7-year renewal milestone.',
      risk: 'Bond prices may face temporary pressure if rates rise. Staggered entry is recommended to average cost over time.',
      persona: 'Age 55+ · Wealth transfer priority · No need for employment income in HK · Capital preservation first',
      tabs: ['Return Analysis', 'Risk Notes', 'Target Investor'],
    },
    {
      id: 'income', emoji: '💰',
      name: 'Income Harvest', tag: 'Moderate Risk · Monthly Cash Flow', tagColor: '#10b981', tagBg: '#064e3b33',
      headline: 'Monthly distributions to fund HK living costs',
      stats: [
        { label: '7-yr Target', value: 'HK$35M+', hl: true },
        { label: 'Est. CAGR', value: '5.5–6.5%', hl: false },
        { label: 'Max Drawdown', value: '< 15%', hl: false },
        { label: 'Monthly Flow', value: '≈ HK$110K', hl: false },
      ],
      allocation: [
        { label: 'Multi-Asset Income (Monthly Dist.)', pct: 40, color: '#10b981' },
        { label: 'High Dividend Equity / REITs', pct: 35, color: '#34d399' },
        { label: 'Asian Bonds', pct: 25, color: '#6ee7b7' },
      ],
      analysis: 'HK$27M at 5% yield ≈ HK$110K/month after tax — sufficient to cover moderate HK living expenses including rent of HK$30–40K. Over 7 years, cumulative distributions total ~HK$9.45M while principal remains relatively stable.',
      risk: 'Distribution rates may compress in recession. Diversification across REITs, high-dividend equity and multi-asset funds mitigates single-sector risk.',
      persona: 'Age 40–55 · Rigid living costs in early HK years · Want portfolio income to replace salary · Reduce employment pressure',
      tabs: ['Return Analysis', 'Risk Notes', 'Target Investor'],
    },
    {
      id: 'growth', emoji: '📈',
      name: 'Global Accumulation', tag: 'Moderate-High Risk · Long-term', tagColor: '#f59e0b', tagBg: '#78350f33',
      headline: 'Benchmark global indices, compound over 7 years',
      stats: [
        { label: '7-yr Target', value: 'HK$46.5M–52.9M', hl: true },
        { label: 'Est. CAGR', value: '8–10%', hl: false },
        { label: 'Max Drawdown', value: '15–25% (1yr)', hl: false },
        { label: 'Monthly Flow', value: '—', hl: false },
      ],
      allocation: [
        { label: 'Global Equity Accumulation', pct: 70, color: '#f59e0b' },
        { label: 'Technology / Thematic Funds', pct: 20, color: '#fbbf24' },
        { label: 'Multi-Strategy Hedge', pct: 10, color: '#fde68a' },
      ],
      analysis: 'Accumulation funds (all gains reinvested) benchmarked to MSCI World, historically at 8–10% CAGR. Seven years spans a complete economic cycle. Tax deferral on capital gains within ILI is a structural advantage unavailable through direct investment.',
      risk: 'Macro downturns and geopolitical shocks can trigger drawdowns of up to -25% in a single year. Only suitable for investors with high risk tolerance and no near-term liquidity needs.',
      persona: 'Age under 45 · HK is the start of a new chapter · No reliance on portfolio income · Accept short-term volatility for higher terminal value',
      tabs: ['Return Analysis', 'Risk Notes', 'Target Investor'],
    },
  ],
}

function PortfolioCard({ p }) {
  const [tab, setTab] = useState(0)
  const tabContent = [p.analysis, p.risk, p.persona]

  const S = {
    card: {
      background: 'linear-gradient(180deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.02) 100%)',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: 24,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
    },
    header: {
      padding: '24px 24px 20px',
      borderBottom: '1px solid rgba(255,255,255,0.08)',
    },
    topRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
    emoji: { fontSize: 32 },
    badge: {
      fontSize: 11, fontWeight: 600, padding: '4px 12px', borderRadius: 20,
      color: p.tagColor, background: p.tagBg,
    },
    name: { margin: '0 0 4px', fontSize: 20, fontWeight: 700, color: 'white' },
    headline: { margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.55)' },
    statsGrid: {
      display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
      padding: '16px 24px', borderBottom: '1px solid rgba(255,255,255,0.08)',
    },
    stat: (hl) => ({
      background: hl ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)',
      borderRadius: 12, padding: '10px 12px', textAlign: 'center',
    }),
    statLabel: { fontSize: 10, color: 'rgba(255,255,255,0.45)', marginBottom: 4 },
    statValue: { fontSize: 13, fontWeight: 700, color: 'white' },
    allocSection: { padding: '16px 24px 12px' },
    bar: { display: 'flex', borderRadius: 4, overflow: 'hidden', height: 6, marginBottom: 10 },
    allocRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 },
    dot: (color) => ({ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }),
    allocLabel: { flex: 1, fontSize: 11, color: 'rgba(255,255,255,0.55)' },
    allocPct: { fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.75)' },
    tabBar: { display: 'flex', borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: 4 },
    tabBtn: (active) => ({
      flex: 1, padding: '10px 4px', fontSize: 11, fontWeight: 600, border: 'none',
      background: 'transparent', cursor: 'pointer', transition: 'all 0.2s',
      color: active ? 'white' : 'rgba(255,255,255,0.35)',
      borderBottom: active ? '2px solid #6366f1' : '2px solid transparent',
    }),
    tabContent: {
      padding: '14px 24px 20px', fontSize: 13, lineHeight: 1.7,
      color: 'rgba(255,255,255,0.65)', minHeight: 80,
    },
  }

  return (
    <div style={S.card}>
      <div style={S.header}>
        <div style={S.topRow}>
          <span style={S.emoji}>{p.emoji}</span>
          <span style={S.badge}>{p.tag}</span>
        </div>
        <h3 style={S.name}>{p.name}</h3>
        <p style={S.headline}>{p.headline}</p>
      </div>

      <div style={S.statsGrid}>
        {p.stats.map((s, i) => (
          <div key={i} style={S.stat(s.hl)}>
            <div style={S.statLabel}>{s.label}</div>
            <div style={S.statValue}>{s.value}</div>
          </div>
        ))}
      </div>

      <div style={S.allocSection}>
        <div style={S.bar}>
          {p.allocation.map((a, i) => (
            <div key={i} style={{ width: `${a.pct}%`, background: a.color }} />
          ))}
        </div>
        {p.allocation.map((a, i) => (
          <div key={i} style={S.allocRow}>
            <div style={S.dot(a.color)} />
            <span style={S.allocLabel}>{a.label}</span>
            <span style={S.allocPct}>{a.pct}%</span>
          </div>
        ))}
      </div>

      <div style={S.tabBar}>
        {p.tabs.map((t, i) => (
          <button key={i} style={S.tabBtn(tab === i)} onClick={() => setTab(i)}>{t}</button>
        ))}
      </div>
      <div style={S.tabContent}>{tabContent[tab]}</div>
    </div>
  )
}

export default function ImmigrationShowcase({ lang = 'zh', onBack }) {
  const portfolios = PORTFOLIOS[lang] || PORTFOLIOS.zh
  const isZh = lang === 'zh'

  const S = {
    root: {
      all: 'initial', display: 'block',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", sans-serif',
      minHeight: '100vh',
      background: 'linear-gradient(180deg, #050d1f 0%, #0d1a35 40%, #0f1117 100%)',
      color: 'white', boxSizing: 'border-box',
    },
    backBtn: {
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '12px 20px', fontSize: 13, color: 'rgba(255,255,255,0.45)',
      background: 'none', border: 'none', cursor: 'pointer',
    },
    heroBadge: {
      display: 'inline-block', padding: '6px 18px', borderRadius: 20, fontSize: 13, fontWeight: 500,
      border: '1px solid rgba(96,165,250,0.3)', background: 'rgba(59,130,246,0.1)', color: '#93c5fd',
      marginBottom: 20,
    },
    h1: { margin: '0 0 16px', fontSize: 'clamp(26px, 4vw, 40px)', fontWeight: 800, color: 'white', lineHeight: 1.25 },
    subtitle: { margin: '0 0 12px', fontSize: 14, color: 'rgba(255,255,255,0.55)', lineHeight: 1.7, maxWidth: 560 },
    disclaimer: { fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 8 },
    grid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
      gap: 24, maxWidth: 1100, margin: '0 auto', padding: '0 24px 60px',
    },
    ctaBox: {
      maxWidth: 1100, margin: '0 auto 60px', padding: '0 24px',
    },
    ctaInner: {
      background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: 24, padding: 40, textAlign: 'center',
    },
    ctaH3: { margin: '0 0 10px', fontSize: 22, fontWeight: 700, color: 'white' },
    ctaP: { margin: '0 0 24px', fontSize: 14, color: 'rgba(255,255,255,0.55)', lineHeight: 1.7 },
    ctaBtn: {
      display: 'inline-block', padding: '14px 36px', borderRadius: 50, fontWeight: 700, fontSize: 15,
      background: 'linear-gradient(135deg, #2563eb, #1d4ed8)', color: 'white',
      textDecoration: 'none', boxShadow: '0 8px 24px rgba(37,99,235,0.4)',
    },
  }


  return (
    <div style={S.root}>
      {onBack && (
        <button style={S.backBtn} onClick={onBack}>← {isZh ? '返回' : 'Back'}</button>
      )}

      <div style={{ textAlign: 'center', padding: '40px 24px 40px' }}>
        <div style={S.heroBadge}>{isZh ? 'CIES · ILI 三大配置方案' : 'CIES · Three ILI Portfolio Plans'}</div>
        <h1 style={S.h1}>
          {isZh ? 'HK$2,700万 · 如何配置才最适合你？' : 'HK$27M — Which Portfolio Fits You?'}
        </h1>
        <p style={{ ...S.subtitle, margin: '0 auto 12px' }}>
          {isZh
            ? '以下三个组合均以ILI投连险为载体，满足CIES获许金融资产要求。由专业CFA及财富管理团队设计，对应不同人生阶段与风险偏好。'
            : 'All three portfolios use ILI to meet the CIES permissible financial asset requirement. Designed by our CFA-qualified team for different life stages and risk profiles.'}
        </p>
        <p style={S.disclaimer}>
          ⚠️ {isZh
            ? '以上分析仅供参考，不构成投资建议。过往回报不代表未来表现。'
            : 'For reference only. Past performance does not guarantee future results.'}
        </p>
      </div>

      <div style={S.grid}>
        {portfolios.map(p => <PortfolioCard key={p.id} p={p} />)}
      </div>

      <div style={S.ctaBox}>
        <div style={S.ctaInner}>
          <h3 style={S.ctaH3}>{isZh ? '不确定哪个适合你？' : 'Not sure which fits you?'}</h3>
          <p style={S.ctaP}>
            {isZh
              ? '预约15分钟免费咨询，顾问根据你的年龄、资产结构与家庭规划量身推荐。'
              : 'Book a 15-min free consultation. Our advisor will tailor a recommendation based on your profile.'}
          </p>
          <a href="http://localhost:3000/immigration" style={S.ctaBtn}>
            {isZh ? '预约顾问咨询' : 'Book a Consultation'}
          </a>
        </div>
      </div>
    </div>
  )
}
