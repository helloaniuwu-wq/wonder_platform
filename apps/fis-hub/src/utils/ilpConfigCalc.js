/**
 * ILP 投连险「配置面板」使用的费用 / 奖赏计算（原 components/ILPConfigPanel.jsx 内的模块级函数）。
 *
 * 注意：与 utils/ilpImpactUtils.js 中的 calcILPMonthlyFee 等函数是两套独立实现，
 * 口径并不完全一致（前期费计费基数、奖赏起算月份、COI 年龄上限等），
 * 此处仅做原样搬迁以满足 react-refresh 规则，未合并。
 */

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
