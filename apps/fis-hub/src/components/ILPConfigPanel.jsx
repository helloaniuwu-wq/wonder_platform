import React, { useMemo } from 'react';
import { lookupCOI, getEnrollmentBonusRate, calcLoyaltyBonus } from '../utils/ilpConfigCalc';

// ════════════════════════════════════════════════════════════════════════
//  ILP 投连险配置面板 — 受保人输入 + 费用/奖赏实时计算
// ════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════
//  UI 组件
// ════════════════════════════════════════════════════════════════════════

// 模块级常量：保证 ilpConfig 缺省时 config 引用稳定（useMemo 依赖不会每次渲染都变）
const DEFAULT_ILP_CONFIG = {
  age: 35,
  gender: 'male',
  smoker: false,
  totalPremium: 0,
  currency: 'USD',
  enrollmentRate: null,
};

const ILPConfigPanel = ({
  ilpConfig,
  onConfigChange,
  onOpenEnrollmentModal,
  initialCapital,
}) => {
  const config = ilpConfig || DEFAULT_ILP_CONFIG;

  const update = (key, value) => {
    onConfigChange({ ...config, [key]: value });
  };

  // ── 实时摘要计算 ──
  const summary = useMemo(() => {
    const premium = config.totalPremium || 0;
    if (premium <= 0) return null;

    const sumAssured = premium * 1.05;
    const cv = initialCapital || premium; // 用初始资本估算首年 CV

    // 年化费用（首年）
    const initialChargeAnnual = premium * 0.0135;
    const accountChargeAnnual = cv * 0.01;
    const riskAmount = Math.max(0, sumAssured - cv);
    const coiRate = lookupCOI(config.age, config.gender) / 1000;
    const insuranceChargeAnnual = riskAmount * coiRate;
    const totalChargeY1 = initialChargeAnnual + accountChargeAnnual + insuranceChargeAnnual;
    const dragPctY1 = cv > 0 ? (totalChargeY1 / cv * 100) : 0;

    // 第6年起（无前期费）
    const totalChargeY6 = accountChargeAnnual + insuranceChargeAnnual;
    const dragPctY6 = cv > 0 ? (totalChargeY6 / cv * 100) : 0;

    // 开户奖赏
    const enrollRate = config.enrollmentRate !== null && config.enrollmentRate !== undefined
      ? config.enrollmentRate
      : getEnrollmentBonusRate(premium);
    const enrollBonus = premium * enrollRate;

    // 长期奖赏预估（假设第60月 CV 约1.5倍）
    const estCV60 = cv * 1.5;
    const monthlyLoyalty = calcLoyaltyBonus(estCV60);
    const loyaltyAnnual = monthlyLoyalty * 12;
    const loyaltyPct = estCV60 > 0 ? (loyaltyAnnual / estCV60 * 100) : 0;

    return {
      sumAssured, 
      initialChargeAnnual, accountChargeAnnual, insuranceChargeAnnual,
      totalChargeY1, dragPctY1,
      totalChargeY6, dragPctY6,
      enrollRate, enrollBonus,
      monthlyLoyalty, loyaltyAnnual, loyaltyPct, estCV60
    };
  }, [config, initialCapital]);

  const fmt = (v) => '$' + Math.round(isFinite(v) ? v : 0).toLocaleString();
  const fmtPct = (v) => (isFinite(v) ? v : 0).toFixed(2) + '%';

  return (
    <div style={{
      background: 'var(--surface-card)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--card-radius)',
      padding: '16px',
      marginTop: '12px',
    }}>
      {/* 受保人信息 */}
      <div style={{
        display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end',
        marginBottom: '16px', paddingBottom: '14px',
        borderBottom: '1px solid var(--border-subtle)'
      }}>
        <div style={{display: 'flex', flexDirection: 'column', gap: '4px'}}>
          <span style={{fontSize: '0.75rem', color: 'var(--text-secondary)'}}>受保人年龄</span>
          <input type="number" min="0" max="80" value={config.age}
            onChange={e => update('age', parseInt(e.target.value) || 0)}
            style={{background: 'var(--surface-subtle)', border: '1px solid var(--border-strong)',
              color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', borderRadius: '4px', padding: '6px', width: '68px'}} />
        </div>
        <div style={{display: 'flex', flexDirection: 'column', gap: '4px'}}>
          <span style={{fontSize: '0.75rem', color: 'var(--text-secondary)'}}>性别</span>
          <select value={config.gender} onChange={e => update('gender', e.target.value)}
            style={{background: 'var(--surface-subtle)', border: '1px solid var(--border-strong)',
              color: 'var(--text-primary)', borderRadius: '4px', padding: '6px'}}>
            <option value="male">男</option>
            <option value="female">女</option>
          </select>
        </div>
        <div style={{display: 'flex', flexDirection: 'column', gap: '4px'}}>
          <span style={{fontSize: '0.75rem', color: 'var(--text-secondary)'}}>吸烟</span>
          <select value={config.smoker ? 'yes' : 'no'} onChange={e => update('smoker', e.target.value === 'yes')}
            style={{background: 'var(--surface-subtle)', border: '1px solid var(--border-strong)',
              color: 'var(--text-primary)', borderRadius: '4px', padding: '6px'}}>
            <option value="no">否</option>
            <option value="yes">是</option>
          </select>
        </div>
        <div style={{display: 'flex', flexDirection: 'column', gap: '4px'}}>
          <span style={{fontSize: '0.75rem', color: 'var(--text-secondary)'}}>整付保费 ($)</span>
          <input type="number" min="0" step="10000" value={config.totalPremium}
            onChange={e => update('totalPremium', parseFloat(e.target.value) || 0)}
            style={{background: 'var(--surface-subtle)', border: '1px solid var(--border-strong)',
              color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', borderRadius: '4px', padding: '6px', width: '130px'}} />
        </div>
        <div style={{display: 'flex', flexDirection: 'column', gap: '4px'}}>
          <span style={{fontSize: '0.75rem', color: 'var(--text-secondary)'}}>货币</span>
          <select value={config.currency} onChange={e => update('currency', e.target.value)}
            style={{background: 'var(--surface-subtle)', border: '1px solid var(--border-strong)',
              color: 'var(--text-primary)', borderRadius: '4px', padding: '6px'}}>
            <option value="USD">USD</option>
            <option value="HKD">HKD</option>
            <option value="CNY">CNY</option>
          </select>
        </div>
      </div>

      {/* 摘要 — 仅在有保费时显示 */}
      {summary && (
        <div style={{display: 'flex', flexDirection: 'column', gap: '12px'}}>
          {/* 身故赔偿 */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '12px',
            background: 'var(--surface-subtle)', padding: '10px 14px', borderRadius: 'var(--card-radius)',
            border: '1px solid var(--border-subtle)', borderLeft: '3px solid var(--accent-color)'
          }}>
            <div>
              <div style={{fontSize: '0.8rem', color: 'var(--text-secondary)'}}>身故赔偿（已缴保费 × 105%）</div>
              <div style={{fontSize: '1.1rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--accent-color)'}}>{fmt(summary.sumAssured)}</div>
            </div>
          </div>

          {/* 开户奖赏 */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: 'var(--surface-subtle)', padding: '10px 14px', borderRadius: 'var(--card-radius)',
            border: '1px solid var(--border-subtle)', borderLeft: '3px solid var(--accent-secondary)'
          }}>
            <div style={{display: 'flex', alignItems: 'center', gap: '12px'}}>
              <div>
                <div style={{fontSize: '0.8rem', color: 'var(--text-secondary)'}}>
                  开户奖赏（一次性） — 推广率 {(summary.enrollRate * 100).toFixed(1)}%
                </div>
                <div style={{fontSize: '1.1rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--accent-secondary)'}}>
                  {fmt(summary.enrollBonus)}
                </div>
              </div>
            </div>
            {onOpenEnrollmentModal && (
              <button type="button" onClick={onOpenEnrollmentModal} className="action-btn-secondary" style={{padding: '4px 10px', fontSize: '0.8rem'}}>
                调整
              </button>
            )}
          </div>

          {/* 费用摘要 */}
          <div style={{
            background: 'var(--surface-subtle)', padding: '12px 14px', borderRadius: 'var(--card-radius)',
            border: '1px solid var(--border-subtle)', borderLeft: '3px solid var(--danger)'
          }}>
            <div style={{fontSize: '0.85rem', fontWeight: 700, color: 'var(--danger)', marginBottom: '8px'}}>
              费用摘要（年化估算）
            </div>
            <div style={{display: 'grid', gridTemplateColumns: '1fr auto', gap: '4px 20px', fontSize: '0.82rem'}}>
              <span style={{color: 'var(--text-secondary)'}}>前期费（首5年）</span>
              <span style={{textAlign: 'right', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)'}}>{fmt(summary.initialChargeAnnual)}/年（1.35%）</span>
              <span style={{color: 'var(--text-secondary)'}}>户口价值费</span>
              <span style={{textAlign: 'right', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)'}}>~{fmt(summary.accountChargeAnnual)}/年（1.0%）</span>
              <span style={{color: 'var(--text-secondary)'}}>保险费（{config.age}岁{config.gender === 'male' ? '男' : '女'}）</span>
              <span style={{textAlign: 'right', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)'}}>~{fmt(summary.insuranceChargeAnnual)}/年</span>
              <div style={{gridColumn: '1 / -1', borderTop: '1px solid var(--border-subtle)', margin: '4px 0'}} />
              <span style={{fontWeight: 600, color: 'var(--danger)'}}>首年总拖累</span>
              <span style={{textAlign: 'right', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--danger)'}}>
                ~{fmt(summary.totalChargeY1)}/年（≈{fmtPct(summary.dragPctY1)}）
              </span>
              <span style={{color: 'var(--text-muted)', fontSize: '0.78rem'}}>第6年起（无前期费）</span>
              <span style={{textAlign: 'right', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '0.78rem'}}>
                ~{fmt(summary.totalChargeY6)}/年（≈{fmtPct(summary.dragPctY6)}）
              </span>
            </div>
          </div>

          {/* 长期客户奖赏预览 */}
          <div style={{
            background: 'var(--surface-subtle)', padding: '12px 14px', borderRadius: 'var(--card-radius)',
            border: '1px solid var(--border-subtle)', borderLeft: '3px solid var(--info)'
          }}>
            <div style={{fontSize: '0.85rem', fontWeight: 700, color: 'var(--info)', marginBottom: '8px'}}>
              长期客户奖赏预览（第60月起）
            </div>
            <div style={{fontSize: '0.82rem', color: 'var(--text-secondary)'}}>
              预估第60月户口价值 ≈ {fmt(summary.estCV60)}
            </div>
            <div style={{fontSize: '0.92rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--info)', marginTop: '4px'}}>
              月奖赏 ≈ {fmt(summary.monthlyLoyalty)} · 年化 ≈ {fmt(summary.loyaltyAnnual)}（{fmtPct(summary.loyaltyPct)}）
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ILPConfigPanel;
