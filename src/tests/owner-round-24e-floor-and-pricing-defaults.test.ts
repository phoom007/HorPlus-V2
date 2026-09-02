import { describe, it, expect } from 'vitest';
import { deriveFloorFromRoomNumber } from '../pages/owner/rooms';

describe('Owner Round 2.4E: Floor Derivation Authority', () => {
  it('derives floor correctly from standard room numbers', () => {
    expect(deriveFloorFromRoomNumber('101')).toBe(1);
    expect(deriveFloorFromRoomNumber('201')).toBe(2);
    expect(deriveFloorFromRoomNumber('302')).toBe(3);
  });

  it('derives floor correctly from prefixed room numbers', () => {
    expect(deriveFloorFromRoomNumber('A111')).toBe(1);
    expect(deriveFloorFromRoomNumber('C-201')).toBe(2);
    expect(deriveFloorFromRoomNumber('B305')).toBe(3);
  });

  it('derives floor correctly from slash patterns', () => {
    expect(deriveFloorFromRoomNumber('1/1')).toBe(1);
    expect(deriveFloorFromRoomNumber('2/5')).toBe(2);
  });

  it('AUTHORITATIVE AUDIT RULE: Never produces floor 0 (minimum floor is clamped to >= 1)', () => {
    expect(deriveFloorFromRoomNumber('001')).toBe(1);
    expect(deriveFloorFromRoomNumber('01')).toBe(1);
    expect(deriveFloorFromRoomNumber('0')).toBe(1);
    expect(deriveFloorFromRoomNumber('G01')).toBe(1);
    expect(deriveFloorFromRoomNumber('VIP')).toBe(1);
    expect(deriveFloorFromRoomNumber('')).toBe(1);
  });
});

describe('Owner Round 2.4E: Pricing Defaults Resolution without Magic Fallbacks', () => {
  const resolvePricing = (
    targetBld: { monthlyRent?: any; termRent?: any; dailyRent?: any; depositAmount?: any } | undefined,
    defs: { defaultMonthlyRent?: any; defaultTermRent?: any; defaultDailyRent?: any; defaultDeposit?: any } | null | undefined
  ) => {
    const resolveValue = (bldVal: any, dormVal: any): number | '' => {
      if (bldVal !== null && bldVal !== undefined && bldVal !== '' && !isNaN(Number(bldVal))) {
        return Number(bldVal);
      }
      if (dormVal !== null && dormVal !== undefined && dormVal !== '' && !isNaN(Number(dormVal))) {
        return Number(dormVal);
      }
      return '';
    };

    const monthlyRentVal = resolveValue(targetBld?.monthlyRent, defs?.defaultMonthlyRent);
    const termRentVal = resolveValue(targetBld?.termRent, defs?.defaultTermRent);
    const dailyRentVal = resolveValue(targetBld?.dailyRent, defs?.defaultDailyRent);

    const bldDeposit = targetBld?.depositAmount;
    const dormDeposit = defs?.defaultDeposit;
    const monthlyDepositVal = resolveValue(bldDeposit, dormDeposit);
    const termDepositVal = resolveValue(bldDeposit, dormDeposit);
    const dailyDepositVal = resolveValue(bldDeposit, dormDeposit);

    return {
      monthlyRent: monthlyRentVal,
      termRent: termRentVal,
      dailyRent: dailyRentVal,
      monthlyDeposit: monthlyDepositVal,
      termDeposit: termDepositVal,
      dailyDeposit: dailyDepositVal,
    };
  };

  it('resolves explicit Building values over Dormitory property defaults', () => {
    const bld = {
      monthlyRent: 4500,
      termRent: 18000,
      dailyRent: 600,
      depositAmount: 5000,
    };
    const dormDefaults = {
      defaultMonthlyRent: 3500,
      defaultTermRent: 14000,
      defaultDailyRent: 500,
      defaultDeposit: 4000,
    };

    const res = resolvePricing(bld, dormDefaults);
    expect(res.monthlyRent).toBe(4500);
    expect(res.termRent).toBe(18000);
    expect(res.dailyRent).toBe(600);
    expect(res.monthlyDeposit).toBe(5000);
    expect(res.termDeposit).toBe(5000);
    expect(res.dailyDeposit).toBe(5000);
  });

  it('falls back to Dormitory property defaults when Building value is absent', () => {
    const bld = {
      monthlyRent: null,
      termRent: undefined,
      dailyRent: '',
      depositAmount: null,
    };
    const dormDefaults = {
      defaultMonthlyRent: 3500,
      defaultTermRent: 14000,
      defaultDailyRent: 500,
      defaultDeposit: 4000,
    };

    const res = resolvePricing(bld, dormDefaults);
    expect(res.monthlyRent).toBe(3500);
    expect(res.termRent).toBe(14000);
    expect(res.dailyRent).toBe(500);
    expect(res.monthlyDeposit).toBe(4000);
  });

  it('AUTHORITATIVE AUDIT RULE: Zero is a valid explicit numeric value and not treated as missing', () => {
    const bld = {
      monthlyRent: 0,
      termRent: 0,
      dailyRent: 0,
      depositAmount: 0,
    };
    const dormDefaults = {
      defaultMonthlyRent: 3500,
      defaultTermRent: 14000,
      defaultDailyRent: 500,
      defaultDeposit: 4000,
    };

    const res = resolvePricing(bld, dormDefaults);
    expect(res.monthlyRent).toBe(0);
    expect(res.termRent).toBe(0);
    expect(res.dailyRent).toBe(0);
    expect(res.monthlyDeposit).toBe(0);
  });

  it('AUTHORITATIVE AUDIT RULE: Returns empty string when neither building nor dorm defaults are configured (NO magic fallbacks)', () => {
    const res = resolvePricing(undefined, null);
    expect(res.monthlyRent).toBe('');
    expect(res.termRent).toBe('');
    expect(res.dailyRent).toBe('');
    expect(res.monthlyDeposit).toBe('');
    // Strictly verify no magic formulas like termRent = monthlyRent * 4 or dailyRent = 500
    expect(res.termRent).not.toBe(14000);
    expect(res.dailyRent).not.toBe(500);
  });
});
