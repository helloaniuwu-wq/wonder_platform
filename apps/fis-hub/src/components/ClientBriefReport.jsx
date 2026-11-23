import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

function fmt(val) {
  if (!val) return '$0';
  if (val >= 1000000) return `$${(val / 1000000).toFixed(1)}M`;
  if (val >= 1000) return `$${(val / 1000).toFixed(0)}K`;
  return `$${Math.round(val).toLocaleString()}`;
}
function numFmt(val) {
  if (!val) return '0';
  return Math.round(val).toLocaleString('zh-CN');
}

const ClientBriefReport = ({ labData, labMcSettings, insurancePlan, insuranceEnabled, clientInfo, onClose, onSwitchProfessional }) => {
  const mcResult = labData?.monte_carlo;
  if (!mcResult) return null;

  const ci = clientInfo || {};
  const clientName = ci.name || '';
  const clientAge = ci.age ? parseInt(ci.age) : null;
  const advisorName = ci.advisor || '';
  const reportDate = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });

  const runYears = parseInt(labMcSettings.years) || 40;
  const capital = parseFloat(labMcSettings.capital) || 0;
  const withdrawal = parseFloat(labMcSettings.withdrawal) || 0;

  const lastChartPoint = mcResult.chart[mcResult.chart.length - 1] || {};
  const isCombined = insuranceEnabled && lastChartPoint.combined_p50 !== undefined;
  const p10 = isCombined ? (lastChartPoint.combined_p10 || lastChartPoint.p10 || 0) : (lastChartPoint.p10 || 0);
  const p50 = isCombined ? (lastChartPoint.combined_p50 || lastChartPoint.p50 || 0) : (lastChartPoint.p50 || 0);
  const p90 = isCombined ? (lastChartPoint.combined_p90 || lastChartPoint.p90 || 0) : (lastChartPoint.p90 || 0);
  const successRate = (mcResult.success_rate * 100).toFixed(0);
  const irr = ((mcResult.irr?.p50 || 0) * 100).toFixed(1);

  // 每10年里程碑
  const milestoneYears = [];
  for (let y = 10; y <= runYears; y += 10) milestoneYears.push(y);
  if (!milestoneYears.includes(runYears)) milestoneYears.push(runYears);
  const chartMap = {};
  (mcResult.chart || []).forEach(pt => { chartMap[pt.year] = pt; });
  const milestones = milestoneYears.map(y => {
    const pt = chartMap[y] || {};
    return {
      year: y,
      age: clientAge ? clientAge + y : null,
      p50: isCombined ? (pt.combined_p50 || pt.p50 || 0) : (pt.p50 || 0),
      p10: isCombined ? (pt.combined_p10 || pt.p10 || 0) : (pt.p10 || 0),
    };
  }).filter(m => m.p50 > 0);

  // 提取计划：换算成月收入表述
  const monthlyWithdrawal = withdrawal > 0 ? Math.round(withdrawal / 12) : 0;

  // 图表数据：简化，只展示P50和P10
  const chartData = (mcResult.chart || []).filter((_, i) => i % 2 === 0 || i === mcResult.chart.length - 1)
    .map(pt => ({
      year: `第${pt.year}年`,
      '预期净值': Math.round(isCombined ? (pt.combined_p50 || pt.p50 || 0) : (pt.p50 || 0)),
      '保守预估': Math.round(isCombined ? (pt.combined_p10 || pt.p10 || 0) : (pt.p10 || 0)),
    }));

  // 保险简介
  const insLabel = insurancePlan?.label || '分红储蓄保险';
  let insTotalPremium = 0;
  if (insurancePlan?.years) {
    insurancePlan.years.forEach(py => { insTotalPremium += (py.premium || 0); });
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9999, overflowY: 'auto', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '24px 12px' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, maxWidth: 860, width: '100%', boxShadow: '0 24px 80px rgba(0,0,0,0.3)' }}>

        {/* ── 顶部工具栏 */}
        <div className="no-print" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '16px 24px', borderBottom: '1px solid #e2e8f0', flexWrap: 'wrap' }}>
          <button onClick={() => window.print()} style={{ background: '#1e3a8a', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: '0.88rem' }}>
            🖨️ 打印 / 导出 PDF
          </button>
          <button onClick={onSwitchProfessional} style={{ background: 'rgba(99,102,241,0.1)', color: '#6366f1', border: '1px solid rgba(99,102,241,0.3)', padding: '9px 18px', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: '0.88rem' }}>
            📊 查看专业版报告
          </button>
          <button onClick={onClose} style={{ background: 'transparent', color: '#94a3b8', border: '1px solid #e2e8f0', padding: '9px 18px', borderRadius: 8, cursor: 'pointer', marginLeft: 'auto' }}>
            ✖ 返回
          </button>
        </div>

        <div style={{ padding: '32px 36px' }} id="client-brief-printable">

          {/* ── 封面头部 */}
          <div style={{ textAlign: 'center', marginBottom: 36, paddingBottom: 28, borderBottom: '2px solid #e2e8f0' }}>
            <div style={{ display: 'inline-block', background: 'linear-gradient(135deg, #1e3a8a, #2563eb)', color: '#fff', fontSize: '0.72rem', letterSpacing: '3px', padding: '5px 16px', borderRadius: 20, marginBottom: 18, fontWeight: 700 }}>
              个人财富蓝图
            </div>
            <h1 style={{ margin: '0 0 8px', fontSize: '2rem', color: '#0f172a', fontWeight: 800 }}>
              {clientName ? `${clientName}的财富规划` : '您的财富规划'}
            </h1>
            <p style={{ color: '#64748b', fontSize: '1rem', margin: '0 0 20px' }}>
              一份写给您自己的简明财富说明书
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 24, fontSize: '0.82rem', color: '#94a3b8' }}>
              <span>规划日期：{reportDate}</span>
              {advisorName && <span>您的顾问：{advisorName}</span>}
              <span>规划周期：{runYears} 年</span>
            </div>
          </div>

          {/* ── 模块 1：一句话摘要 */}
          <div style={{ background: 'linear-gradient(135deg, #eff6ff, #f0fdf4)', border: '1px solid #bfdbfe', borderRadius: 16, padding: '28px 32px', marginBottom: 28, textAlign: 'center' }}>
            <div style={{ fontSize: '0.85rem', color: '#1d4ed8', fontWeight: 700, marginBottom: 12, letterSpacing: 1 }}>📌 核心结论</div>
            <div style={{ fontSize: '1.25rem', color: '#0f172a', lineHeight: 1.8, fontWeight: 500 }}>
              您投入 <strong style={{ color: '#1e3a8a', fontSize: '1.4rem' }}>{fmt(capital)}</strong>，
              经过 {runYears} 年的稳健增长，
              {withdrawal > 0 ? (
                <>同时每年领取生活费约 <strong style={{ color: '#047857', fontSize: '1.4rem' }}>{fmt(withdrawal)}</strong>，</>
              ) : null}
              <br />
              资产预计增长至 <strong style={{ color: '#1e3a8a', fontSize: '1.7rem' }}>{fmt(p50)}</strong>，
              实现概率约 <strong style={{ color: parseInt(successRate) >= 80 ? '#059669' : '#d97706', fontSize: '1.5rem' }}>{successRate}%</strong>。
            </div>
          </div>

          {/* ── 模块 2：三个关键数字 */}
          <div style={{ marginBottom: 28 }}>
            <h2 style={{ fontSize: '1.1rem', color: '#334155', fontWeight: 700, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ background: '#1e3a8a', color: '#fff', borderRadius: '50%', width: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', flexShrink: 0 }}>1</span>
              {runYears} 年后，您的钱可能变成多少？
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
              {[
                { emoji: '☁️', label: '如果遇到市场下行', sublabel: '最坏10%情景的底线', val: p10, color: '#dc2626', bg: '#fef2f2', border: '#fca5a5', desc: '即使遇到经济寒冬，您至少还有这些' },
                { emoji: '⭐', label: '正常市场下', sublabel: '最有可能发生的结果', val: p50, color: '#1e3a8a', bg: '#eff6ff', border: '#bfdbfe', desc: '这是我们规划的核心基准数字', highlight: true },
                { emoji: '🚀', label: '如果市场表现好', sublabel: '顺风情景的潜在空间', val: p90, color: '#059669', bg: '#f0fdf4', border: '#86efac', desc: '市场给长期投资者的额外奖励' },
              ].map(c => (
                <div key={c.label} style={{ background: c.bg, border: `${c.highlight ? 2 : 1}px solid ${c.border}`, borderRadius: 12, padding: '20px 16px', textAlign: 'center', boxShadow: c.highlight ? '0 4px 20px rgba(30,58,138,0.12)' : 'none' }}>
                  <div style={{ fontSize: '1.6rem', marginBottom: 8 }}>{c.emoji}</div>
                  <div style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600, marginBottom: 4 }}>{c.label}</div>
                  <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginBottom: 12 }}>{c.sublabel}</div>
                  <div style={{ fontSize: '1.9rem', fontWeight: 900, color: c.color }}>{fmt(c.val)}</div>
                  <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: 10, lineHeight: 1.5 }}>{c.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── 模块 3：财富成长路线图（图表） */}
          <div style={{ marginBottom: 28 }}>
            <h2 style={{ fontSize: '1.1rem', color: '#334155', fontWeight: 700, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ background: '#1e3a8a', color: '#fff', borderRadius: '50%', width: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', flexShrink: 0 }}>2</span>
              财富成长路线图
            </h2>
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: '20px 16px' }}>
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={chartData} margin={{ top: 8, right: 16, left: 16, bottom: 4 }}>
                  <defs>
                    <linearGradient id="briefGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#2563eb" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#2563eb" stopOpacity={0.01} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="year" tick={{ fill: '#64748b', fontSize: 11 }} interval={Math.floor(chartData.length / 6)} />
                  <YAxis tickFormatter={v => fmt(v)} tick={{ fill: '#64748b', fontSize: 11 }} width={70} />
                  <Tooltip formatter={(v, n) => [fmt(v), n]} contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: '0.82rem' }} />
                  <Area type="monotone" dataKey="预期净值" stroke="#2563eb" strokeWidth={2.5} fill="url(#briefGrad)" />
                  <Area type="monotone" dataKey="保守预估" stroke="#dc2626" strokeWidth={1.5} strokeDasharray="4 3" fill="none" />
                  {capital > 0 && <ReferenceLine y={capital} stroke="#94a3b8" strokeDasharray="4 3" label={{ value: '初始投入', position: 'insideTopLeft', fontSize: 11, fill: '#94a3b8' }} />}
                </AreaChart>
              </ResponsiveContainer>
              <div style={{ display: 'flex', gap: 20, justifyContent: 'center', marginTop: 8, fontSize: '0.78rem', color: '#64748b' }}>
                <span><span style={{ display: 'inline-block', width: 20, height: 3, background: '#2563eb', marginRight: 6, verticalAlign: 'middle' }} />预期路径</span>
                <span><span style={{ display: 'inline-block', width: 20, height: 2, marginRight: 6, verticalAlign: 'middle', borderTop: '2px dashed #dc2626', background: 'transparent' }} />保守路径</span>
              </div>
            </div>
          </div>

          {/* ── 模块 4：每10年净值快照 */}
          {milestones.length > 0 && (
            <div style={{ marginBottom: 28 }}>
              <h2 style={{ fontSize: '1.1rem', color: '#334155', fontWeight: 700, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ background: '#1e3a8a', color: '#fff', borderRadius: '50%', width: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', flexShrink: 0 }}>3</span>
                重要时间节点的财富快照
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(milestones.length, 4)}, 1fr)`, gap: 12 }}>
                {milestones.map(m => (
                  <div key={m.year} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '16px 14px', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginBottom: 4 }}>第 {m.year} 年</div>
                    {m.age && <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: 8, fontWeight: 600 }}>{m.age} 岁</div>}
                    <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#1e3a8a' }}>{fmt(m.p50)}</div>
                    <div style={{ fontSize: '0.72rem', color: '#dc2626', marginTop: 6 }}>最差情景：{fmt(m.p10)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── 模块 5：您的现金流安排 */}
          {withdrawal > 0 && (
            <div style={{ marginBottom: 28 }}>
              <h2 style={{ fontSize: '1.1rem', color: '#334155', fontWeight: 700, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ background: '#1e3a8a', color: '#fff', borderRadius: '50%', width: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', flexShrink: 0 }}>4</span>
                您的现金流安排
              </h2>
              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 12, padding: '20px 24px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                  <div>
                    <div style={{ fontSize: '0.82rem', color: '#047857', fontWeight: 700, marginBottom: 8 }}>💰 提取计划</div>
                    <div style={{ fontSize: '0.9rem', color: '#065f46', lineHeight: 1.8 }}>
                      <p style={{ margin: '0 0 6px' }}>每年可提取：<strong style={{ fontSize: '1.15rem' }}>{fmt(withdrawal)}</strong></p>
                      <p style={{ margin: '0 0 6px' }}>折算月均：约 <strong>{fmt(monthlyWithdrawal)} / 月</strong></p>
                      <p style={{ margin: 0 }}>提取期限：第 {labMcSettings.withdrawal_start} 年 — 第 {labMcSettings.withdrawal_end} 年</p>
                      {labMcSettings.withdrawal_2 > 0 && (
                        <p style={{ margin: '6px 0 0', color: '#047857' }}>
                          第二阶段：{fmt(labMcSettings.withdrawal_2)} / 年（第{labMcSettings.withdrawal_start_2}–{labMcSettings.withdrawal_end_2}年）
                        </p>
                      )}
                    </div>
                  </div>
                  <div style={{ borderLeft: '1px solid #bbf7d0', paddingLeft: 20 }}>
                    <div style={{ fontSize: '0.82rem', color: '#047857', fontWeight: 700, marginBottom: 8 }}>📋 通胀说明</div>
                    <div style={{ fontSize: '0.88rem', color: '#065f46', lineHeight: 1.7 }}>
                      {labMcSettings.withdrawal_inflation
                        ? `提取金额每年随通胀（${labMcSettings.inflation}%）自动调整，确保实际购买力不缩水。`
                        : `提取金额固定不变。请注意通胀（${labMcSettings.inflation}%/年）会逐年降低实际购买力，建议定期与顾问复盘。`}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── 模块 6：保险底座（如有） */}
          {insuranceEnabled && insurancePlan && (
            <div style={{ marginBottom: 28 }}>
              <h2 style={{ fontSize: '1.1rem', color: '#334155', fontWeight: 700, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ background: '#059669', color: '#fff', borderRadius: '50%', width: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', flexShrink: 0 }}>5</span>
                您的安全底座：保险
              </h2>
              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 12, padding: '20px 24px' }}>
                <p style={{ margin: '0 0 12px', color: '#065f46', fontSize: '0.95rem', lineHeight: 1.7 }}>
                  🛡️ 您的方案中包含 <strong>{insLabel}</strong>，
                  {insTotalPremium > 0 && <>总保费 <strong>${numFmt(insTotalPremium)}</strong>，</>}
                  它的作用就像一道「防火墙」——
                  <strong>无论市场如何波动，保险的现金价值不会随股市下跌</strong>，为您的财富提供刚性底线保障。
                </p>
                <div style={{ background: 'rgba(5,150,105,0.08)', borderRadius: 8, padding: '12px 16px', fontSize: '0.85rem', color: '#047857' }}>
                  💡 <strong>通俗理解：</strong>把您的财富想象成一座楼——投资组合是楼层（越建越高），保险是地基（永远稳固）。地基越牢，楼才能建得越高、越安心。
                </div>
              </div>
            </div>
          )}

          {/* ── 模块 7：方案的可靠性 */}
          <div style={{ marginBottom: 28 }}>
            <h2 style={{ fontSize: '1.1rem', color: '#334155', fontWeight: 700, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ background: '#1e3a8a', color: '#fff', borderRadius: '50%', width: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', flexShrink: 0 }}>{insuranceEnabled ? '6' : '5'}</span>
              这个方案有多可靠？
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div style={{ background: parseInt(successRate) >= 80 ? '#f0fdf4' : '#fffbeb', border: `1px solid ${parseInt(successRate) >= 80 ? '#bbf7d0' : '#fde68a'}`, borderRadius: 12, padding: '20px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: 8 }}>目标达成概率</div>
                <div style={{ fontSize: '3rem', fontWeight: 900, color: parseInt(successRate) >= 80 ? '#059669' : '#d97706' }}>{successRate}%</div>
                <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: 8, lineHeight: 1.5 }}>
                  在 10,000 次模拟中，有 {successRate}% 的情况下，<br />您的资产能达到既定目标。
                </div>
              </div>
              <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 12, padding: '20px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: 8 }}>预期年化收益率</div>
                <div style={{ fontSize: '3rem', fontWeight: 900, color: '#1e3a8a' }}>{irr}%</div>
                <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: 8, lineHeight: 1.5 }}>
                  经过科学优化的组合，<br />在历史数据下的长期平均表现。
                </div>
              </div>
            </div>
          </div>

          {/* ── 模块 8：您值得拥有的持续服务 */}
          <div style={{ marginBottom: 28, background: 'linear-gradient(135deg, #1e3a8a, #1d4ed8)', borderRadius: 16, padding: '28px 32px', color: '#fff' }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: 16, color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
              🤝 我们对您的承诺
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              {[
                { icon: '⚖️', title: '动态再平衡', desc: '市场变动时，我们会主动调整配置，让您的财富始终走在正确的轨道上。' },
                { icon: '📅', title: '每半年深度复盘', desc: '每半年一次全面财务检视，确保方案始终与您的人生阶段同步。' },
                { icon: '🚨', title: '风险预警陪伴', desc: '市场出现重大波动时，您会第一时间收到分析和应对建议。' },
                { icon: '💬', title: '随时响应咨询', desc: '您的任何财务疑问，都有专属顾问为您解答和跟进。' },
              ].map(s => (
                <div key={s.title} style={{ display: 'flex', gap: 12 }}>
                  <span style={{ fontSize: '1.4rem', flexShrink: 0 }}>{s.icon}</span>
                  <div>
                    <div style={{ fontWeight: 700, marginBottom: 4, color: '#bfdbfe' }}>{s.title}</div>
                    <div style={{ fontSize: '0.82rem', color: 'rgba(255,255,255,0.7)', lineHeight: 1.6 }}>{s.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── 免责声明（简化版） */}
          <div style={{ fontSize: '0.75rem', color: '#94a3b8', lineHeight: 1.7, borderTop: '1px solid #e2e8f0', paddingTop: 16 }}>
            <strong>重要说明：</strong>本报告中所有财富预测数据均来自蒙特卡洛统计模拟，基于历史数据测算，不代表实际投资结果，不构成任何投资或保险购买建议。所有投资均涉及风险，包括本金损失的可能性。具体决策请在专业顾问指导下进行。
            {advisorName && ` | 制作顾问：${advisorName}`}
          </div>

        </div>
      </div>
    </div>
  );
};

export default ClientBriefReport;
