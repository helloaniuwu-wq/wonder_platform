import { describe, expect, it } from 'vitest';
import { calcILPMonthlyFee, lookupCOI } from './ilpImpactUtils';
import { normalizeIlpGender } from './ilpConfigCalc';

describe('ILP per-age & gender COI matching', () => {
  it('normalizes legacy and standard gender representations', () => {
    expect(normalizeIlpGender('male')).toBe('male');
    expect(normalizeIlpGender('M')).toBe('male');
    expect(normalizeIlpGender('男')).toBe('male');
    expect(normalizeIlpGender('female')).toBe('female');
    expect(normalizeIlpGender('F')).toBe('female');
    expect(normalizeIlpGender('女')).toBe('female');
  });

  it('matches exact age-by-age male vs female COI mortality rates', () => {
    expect(lookupCOI(42, 'male')).toBe(2.09);
    expect(lookupCOI(42, 'female')).toBe(1.60);
    expect(lookupCOI(42, 'F')).toBe(1.60);
    expect(lookupCOI(55, 'male')).toBe(6.48);
    expect(lookupCOI(55, 'female')).toBe(4.31);
  });

  it('computes distinct monthly COI charges for male vs female and younger vs older insured', () => {
    const youngFemale = calcILPMonthlyFee(1, 90000, { age: 32, gender: 'female', totalPremium: 100000 });
    const olderMale = calcILPMonthlyFee(1, 90000, { age: 52, gender: 'male', totalPremium: 100000 });
    const legacyFemaleCode = calcILPMonthlyFee(1, 90000, { age: 32, gender: 'F', totalPremium: 100000 });

    expect(youngFemale.coiAnnualRate).toBe(1.18);
    expect(legacyFemaleCode.coiAnnualRate).toBe(1.18);
    expect(olderMale.coiAnnualRate).toBe(4.91);
    expect(olderMale.coi).toBeGreaterThan(youngFemale.coi);
  });
});
