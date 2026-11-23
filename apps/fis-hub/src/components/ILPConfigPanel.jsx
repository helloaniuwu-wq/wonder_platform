import React, { useMemo } from 'react';

// ════════════════════════════════════════════════════════════════════════
//  ILP 投连险配置面板 — 受保人输入 + 费用/奖赏实时计算
// ════════════════════════════════════════════════════════════════════════

// ── COI 保险费用率表（每 $1,000 风险额年率）───────────────────────────
export const ILP_COI_TABLE = {
  male: {
    0:1.81,16:1.35,18:1.16,28:1.18,29:1.19,30:1.19,
    31:1.21,32:1.24,33:1.25,34:1.30,35:1.35,36:1.39,
    37:1.45,38:1.55,39:1.65,40:1.78,41:1.94,42:2.09,
    43:2.26,44:2.46,45:2.68,46:2.91,47:3.19,48:3.51,
    49:3.84,50:4.15,51:4.53,52:4.91,53:5.34,54:5.81,
    55:6.48,56:7.15,57:7.91,58:8.75,59:9.66,60:10.75,
    61:12.09,62:13.58,63:15.28,64:17.18,65:19.23,
    66:21.03,67:22.90,68:24.89,69:27.10,70:29.80,
    71:33.76,72:38.55,73:42.65,74:46.99,75:51.84,
    76:57.09,77:62.86,78:70.14,79:97.51,80:108.76
  },
  female: {
    0:1.81,16:1.33,18:1.15,28:1.15,29:1.15,30:1.15,
    31:1.16,32:1.18,33:1.20,34:1.21,35:1.24,36:1.26,
    37:1.29,38:1.34,39:1.39,40:1.48,41:1.51,42:1.60,
    43:1.71,44:1.84,45:1.98,46:2.15,47:2.38,48:2.65,
    49:2.90,50:3.01,51:3.16,52:3.40,53:3.64,54:3.90,
    55:4.31,56:4.75,57:5.23,58:5.73,59:6.29,60:6.95,
    61:7.80,62:8.73,63:9.88,64:11.16,65:12.61,
    66:14.34,67:16.30,68:17.96,69:19.51,70:21.46,
    71:23.80,72:26.36,73:29.25,74:32.74,75:37.01,
    76:41.80,77:47.21,78:53.24,79:68.43,80:76.34
  }
};

/** 查表：按年龄和性别获取 COI 费率 */
export function lookupCOI(age, gender) {
  const table = ILP_COI_TABLE[gender] || ILP_COI_TABLE.male;
  const keys = Object.keys(table).map(Number).sort((a, b) => b - a);
  for (const k of keys) { if (age >= k) return table[k]; }
  return table[0];
}

/** 开户奖赏推广率（按整付保费匹配档位） */
export function getEnrollmentBonusRate(premium) {
  const tiers = [
    { min: 1000000, rate: 0.060 },
    { min: 500000,  rate: 0.055 },
    { min: 300000,  rate: 0.045 },
    { min: 100000,  rate: 0.035 },
    { min: 50000,   rate: 0.025 },
  ];
  for (const t of tiers) {
    if (premium >= t.min) return t.rate;
  }
  return 0;
}

/** 开户奖赏金额 = 推广率 × 整付保费（一次性） */
export function calcEnrollmentBonus(premium, overrideRate) {
  const rate = overrideRate !== undefined ? overrideRate : getEnrollmentBonusRate(premium);
  return premium * rate;
}

/** 累进长期客户奖赏（第60月起，每月计算） */
export function calcLoyaltyBonus(accountValue) {
  if (accountValue < 6000) return 0;
  const tiers = [
    { limit: 20000,    rate: 0.002 / 12 },
    { limit: 50000,    rate: 0.003 / 12 },
    { limit: 100000,   rate: 0.005 / 12 },
    { limit: Infinity, rate: 0.008 / 12 },
  ];
  let bonus = 0, prev = 0;
  for (const tier of tiers) {
    const slice = Math.min(accountValue, tier.limit) - prev;
    if (slice <= 0) break;
    bonus += slice * tier.rate;
    prev = tier.limit;
  }
  return bonus;
}

/**
 * 月度 ILP 净现金流（主函数）
 * @param {number} month - 当前模拟月份（1-based）
 * @param {number} accountValue - 当前户口价值
 * @param {object} config - { age, gender, totalPremium, enrollmentRate }
 * @returns {object} 所有费用和奖赏项
 */
export function calcILPMonthly(month, accountValue, config) {
  const year = Math.ceil(month / 12);
  const currentAge = config.age + year - 1;
  const sumAssured = config.totalPremium * 1.05;

  // ── 费用 ──
  const initialCharge   = year <= 5 ? config.totalPremium * 0.0135 / 12 : 0;
  const accountCharge   = accountValue * 0.010 / 12;
  const riskAmount      = Math.max(0, sumAssured - accountValue);
  const coiAnnual       = currentAge < 80 ? lookupCOI(currentAge, config.gender) / 1000 : 0;
  const insuranceCharge = riskAmount * coiAnnual / 12;

  // ── 奖赏 ──
  const enrollmentBonus = month === 1 ? calcEnrollmentBonus(config.totalPremium, config.enrollmentRate) : 0;
  const loyaltyBonus    = month >= 60 ? calcLoyaltyBonus(accountValue) : 0;

  const totalDeduction = initialCharge + accountCharge + insuranceCharge;
  const totalBonus     = enrollmentBonus + loyaltyBonus;

  return {
    initialCharge, accountCharge, insuranceCharge,
    enrollmentBonus, loyaltyBonus,
    totalDeduction, totalBonus,
    netDrag: totalDeduction - totalBonus,
    sumAssured
  };
}


// ════════════════════════════════════════════════════════════════════════
//  UI 组件
// ════════════════════════════════════════════════════════════════════════

const ILPConfigPanel = ({
  ilpConfig,
  onConfigChange,
  onOpenEnrollmentModal,
  initialCapital,
}) => {
  const config = ilpConfig || {
    age: 35,
    gender: 'male',
    smoker: false,
    totalPremium: 0,
    currency: 'USD',
    enrollmentRate: null,
  };

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
