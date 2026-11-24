/**
 * ILP 月度费用计算引擎 v2
 *
 * ════ 核心修正 ════
 * 1. 开户奖赏以基金单位方式进入：奖赏额在 NAV₀ 时买入额外单位，
 *    故初始有效账户价值 = 保费 + 开户奖赏（两者均折算为同等单位数）
 *
 * 2. 账户价值基于实际**保费**（而非 MC 模拟本金）× MC 增长率折算：
 *    ILP_AV[t] = effectivePrincipal × (mc[t] / mc[0])
 *
 * 3. COI 风险额 = max(0, 身故赔偿 - AV)
 *    当 AV >= 身故赔偿时 COI = 0（账户增值超过保额时无保险成本）
 *
 * 费用构成（月度）：
 *   前期费  (月 1-60):  AV × 1.35% / 12
 *   户口价值费 (全期):  AV × 1.00% / 12
 *   保险费 COI:         max(0, 身故赔偿 - AV) × COI_率 / 1000 / 12
 *   长期客户奖赏(月61+): 按 AV 阶梯计算 / 月
 */

import { ILP_COI_TABLE, normalizeIlpGender } from './ilpConfigCalc';

/** 查找 COI 年费率（/千元风险额，复用 AIA 逐龄分性别精确费率表） */
export function lookupCOI(currentAge, gender) {
  const normGender = normalizeIlpGender(gender);
  const table = ILP_COI_TABLE[normGender] || ILP_COI_TABLE.male;
  const keys = Object.keys(table).map(Number).sort((a, b) => b - a);
  for (const k of keys) {
    if (currentAge >= k) return table[k];
  }
  return table[0];
}

/** 开户奖赏推广率（保费档位） */
export function getEnrollmentBonusRate(premium) {
  if (premium >= 1_000_000) return 0.060;
  if (premium >= 500_000)   return 0.055;
  if (premium >= 300_000)   return 0.045;
  if (premium >= 100_000)   return 0.035;
  if (premium >= 50_000)    return 0.025;
  return 0;
}

/**
 * 按账户价值计算当月长期客户奖赏（第 61 月起）
 * 阶梯：< $6k=0 | $6k-$20k=0.2%/年 | $20k-$50k=0.3%/年 | $50k-$100k=0.5%/年 | >$100k=0.8%/年
 */
export function calcLoyaltyBonusMonthly(accountValue) {
  if (accountValue < 6_000) return 0;
  const TIERS = [
    { limit: 20_000,   rate: 0.002 / 12 },
    { limit: 50_000,   rate: 0.003 / 12 },
    { limit: 100_000,  rate: 0.005 / 12 },
    { limit: Infinity, rate: 0.008 / 12 },
  ];
  let bonus = 0, prev = 0;
  for (const t of TIERS) {
    const slice = Math.min(accountValue, t.limit) - prev;
    if (slice <= 0) break;
    bonus += slice * t.rate;
    prev = t.limit;
  }
  return bonus;
}

/**
 * 计算单月 ILP 净费用
 *
 * @param {number} month         第几个月（1-based）
 * @param {number} accountValue  本月 ILP 账户价值（基于保费×增长率）
 * @param {object} ilpConfig     { age, gender, smoker, totalPremium, enrollmentRate }
 * @returns {{ initialCharge, accountCharge, coi, loyaltyBonus, netFee, ageNow, riskAmt }}
 */
export function calcILPMonthlyFee(month, accountValue, ilpConfig) {
  const { age = 35, gender = 'male', totalPremium = 0 } = ilpConfig;
  const normGender = normalizeIlpGender(gender);
  const AV = Math.max(0, accountValue);
  // 身故赔偿 = 已缴保费 × 105%
  const sumAssured = totalPremium * 1.05;

  // 当前实际年龄
  const ageNow = age + Math.floor((month - 1) / 12);

  // 1. 前期费（前5年 = 60个月）: 1.35%/年 ÷ 12
  const initialCharge = month <= 60 ? AV * 0.0135 / 12 : 0;

  // 2. 户口价值费：1.0%/年 ÷ 12
  const accountCharge = AV * 0.01 / 12;

  // 3. 保险费 COI：当 AV >= 身故赔偿时风险额为 0，无保险费
  const riskAmt = Math.max(0, sumAssured - AV);
  const coiAnnualRate = lookupCOI(ageNow, normGender);    // 年费率 / 千元风险额
  const coi = riskAmt * coiAnnualRate / 1000 / 12;        // 月费

  // 4. 长期客户奖赏（第 61 个月起）
  const loyaltyBonus = month >= 61 ? calcLoyaltyBonusMonthly(AV) : 0;

  const netFee = initialCharge + accountCharge + coi - loyaltyBonus;

  return { initialCharge, accountCharge, coi, coiAnnualRate, loyaltyBonus, netFee, ageNow, riskAmt, sumAssured, AV };
}

/**
 * 对 MC 图表（含 p10/p50/p90）应用 ILP 后处理
 *
 * ════ 修正后的核心算法 ════
 * 1. 有效初始本金 = 保费 + 开户奖赏（奖赏以单位方式进入，同等计息）
 * 2. ILP账户价值[t] = 有效本金 × (mc[t] / mc[0])  ← 借用 MC 增长率，按实际保费放大
 * 3. 逐月扣减费用后的净账户价值用于展示和进一步计算
 *
 * @param {object[]} mcChart   labData.monte_carlo.chart（按年数组）
 * @param {object}   ilpConfig
 * @returns {{ chart, annualBreakdown, enrollmentBonus, effectivePrincipal }}
 */
export function applyILPToMCChart(mcChart, ilpConfig) {
  if (!mcChart || mcChart.length === 0) return { chart: mcChart, annualBreakdown: [], enrollmentBonus: 0 };

  const { totalPremium = 0, enrollmentRate = null } = ilpConfig;

  // ── Step 1: 开户奖赏 ─────────────────────────────────────────────────────
  const bonusRate = enrollmentRate !== null ? enrollmentRate : getEnrollmentBonusRate(totalPremium);
  const enrollmentBonus = totalPremium * bonusRate;
  const effectivePrincipal = totalPremium + enrollmentBonus;

  // ── Step 2: MC 基准（防止 null/0 导致除法产生 NaN）────────────────────────
  const mc0_p50 = (mcChart[0]?.p50 != null && mcChart[0].p50 > 0) ? mcChart[0].p50 : 1;
  const mc0_p10 = (mcChart[0]?.p10 != null && mcChart[0].p10 > 0) ? mcChart[0].p10 : 1;
  const mc0_p90 = (mcChart[0]?.p90 != null && mcChart[0].p90 > 0) ? mcChart[0].p90 : 1;

  // ── Step 3: 累积折扣系数（三条曲线各自独立追踪）────────────────────────────
  // net_value[t] = gross_value[t] × cumulativeDiscount[t]
  // 每月：cumulativeDiscount *= (1 - feeRate_month)
  // 这样 net 曲线 = gross × 累积折扣，20年费用拖累会完整体现
  let disc_p50 = 1.0;
  let disc_p10 = 1.0;
  let disc_p90 = 1.0;

  // ILP 初始倍数 > 1（开户奖赏立即以单位计入，初始净值高于原始投入）
  // 第0年 gross = effectivePrincipal × growthFactor = effectivePrincipal（factor=1）
  // 第0年 net   = effectivePrincipal（折扣=1）
  const annualBreakdown = [];

  const newChart = mcChart.map((d, yearIdx) => {
    // 防护：p50/p10/p90 可能为 null（后端用 null 替换 NaN），安全地回退到上一年值或 1
    const safe_p50 = (d.p50 != null && isFinite(d.p50)) ? d.p50 : mc0_p50;
    const safe_p10 = (d.p10 != null && isFinite(d.p10)) ? d.p10 : mc0_p10;
    const safe_p90 = (d.p90 != null && isFinite(d.p90)) ? d.p90 : mc0_p90;

    const growthFactor_p50 = safe_p50 / mc0_p50;
    const growthFactor_p10 = safe_p10 / mc0_p10;
    const growthFactor_p90 = safe_p90 / mc0_p90;

    const ilp_gross_p50 = effectivePrincipal * growthFactor_p50;
    const ilp_gross_p10 = effectivePrincipal * growthFactor_p10;
    const ilp_gross_p90 = effectivePrincipal * growthFactor_p90;

    if (yearIdx === 0) {
      return {
        ...d,
        ilp_gross_p50, ilp_gross_p10, ilp_gross_p90,
        ilp_net_p50: effectivePrincipal,
        ilp_net_p10: effectivePrincipal,
        ilp_net_p90: effectivePrincipal,
        ilp_net_fee: 0,
        ilp_drag_pct: 0,
      };
    }

    // ── 逐月更新累积折扣系数 ─────────────────────────────────────────────
    const monthStart = (yearIdx - 1) * 12 + 1;
    let yearFee = 0, yearInit = 0, yearAcct = 0, yearCOI = 0, yearLoyalty = 0;
    let yearCoiZeroMonths = 0;

    for (let m = 0; m < 12; m++) {
      const month = monthStart + m;
      const t = (m + 0.5) / 12;  // 月中点（更准确的月内插值）

      const prev = mcChart[yearIdx - 1];
      const prevSafe_p50 = (prev.p50 != null && isFinite(prev.p50)) ? prev.p50 : mc0_p50;
      const prevSafe_p10 = (prev.p10 != null && isFinite(prev.p10)) ? prev.p10 : mc0_p10;
      const prevSafe_p90 = (prev.p90 != null && isFinite(prev.p90)) ? prev.p90 : mc0_p90;

      const prevGrowth_p50 = prevSafe_p50 / mc0_p50;
      const currGrowth_p50 = safe_p50 / mc0_p50;
      const prevGrowth_p10 = prevSafe_p10 / mc0_p10;
      const currGrowth_p10 = safe_p10 / mc0_p10;
      const prevGrowth_p90 = prevSafe_p90 / mc0_p90;
      const currGrowth_p90 = safe_p90 / mc0_p90;

      // 月中 ILP 账户价值（用于 COI 和费率计算）
      const monthAV_p50 = Math.max(0, effectivePrincipal * (prevGrowth_p50 + (currGrowth_p50 - prevGrowth_p50) * t));
      const monthAV_p10 = Math.max(0, effectivePrincipal * (prevGrowth_p10 + (currGrowth_p10 - prevGrowth_p10) * t));
      const monthAV_p90 = Math.max(0, effectivePrincipal * (prevGrowth_p90 + (currGrowth_p90 - prevGrowth_p90) * t));

      // ── P50 费率 → 累积折扣 ──
      const fees_p50 = calcILPMonthlyFee(month, monthAV_p50, ilpConfig);
      const feeRate_p50 = monthAV_p50 > 0 ? fees_p50.netFee / monthAV_p50 : 0;
      disc_p50 = disc_p50 * (1 - feeRate_p50);

      // ── P10 费率 → 累积折扣 ──
      const fees_p10 = calcILPMonthlyFee(month, monthAV_p10, ilpConfig);
      const feeRate_p10 = monthAV_p10 > 0 ? fees_p10.netFee / monthAV_p10 : 0;
      disc_p10 = disc_p10 * (1 - feeRate_p10);

      // ── P90 费率 → 累积折扣 ──
      const fees_p90 = calcILPMonthlyFee(month, monthAV_p90, ilpConfig);
      const feeRate_p90 = monthAV_p90 > 0 ? fees_p90.netFee / monthAV_p90 : 0;
      disc_p90 = disc_p90 * (1 - feeRate_p90);

      // 年度明细（用 P50 口径汇总）
      yearFee     += fees_p50.netFee;
      yearInit    += fees_p50.initialCharge;
      yearAcct    += fees_p50.accountCharge;
      yearCOI     += fees_p50.coi;
      yearLoyalty += fees_p50.loyaltyBonus;
      if (fees_p50.riskAmt === 0) yearCoiZeroMonths++;
    }

    // ── ILP 净值 = gross × 累积折扣系数 ─────────────────────────────────
    const ilp_net_p50 = Math.max(0, ilp_gross_p50 * disc_p50);
    const ilp_net_p10 = Math.max(0, ilp_gross_p10 * disc_p10);
    const ilp_net_p90 = Math.max(0, ilp_gross_p90 * disc_p90);

    annualBreakdown.push({
      year: yearIdx,
      initialCharge: yearInit,
      accountCharge: yearAcct,
      coi: yearCOI,
      loyaltyBonus: yearLoyalty,
      netFee: yearFee,
      coiZeroMonths: yearCoiZeroMonths,
      enrollmentBonus: yearIdx === 1 ? enrollmentBonus : 0,
      grossAV_p50: ilp_gross_p50,
      netAV_p50: ilp_net_p50,
    });

    return {
      ...d,
      ilp_gross_p50,
      ilp_gross_p10,
      ilp_gross_p90,
      ilp_net_p50,
      ilp_net_p10,
      ilp_net_p90,
      ilp_net_fee: yearFee,
      ilp_drag_pct: ilp_gross_p50 > 0 ? ((ilp_gross_p50 - ilp_net_p50) / ilp_gross_p50) * 100 : 0,
    };
  });

  return { chart: newChart, annualBreakdown, enrollmentBonus, effectivePrincipal };
}
