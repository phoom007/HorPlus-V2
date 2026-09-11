import { describe, it, expect } from 'vitest';
import {
  parseOptionalConfiguredNumber,
  resolveFirstDefinedNumber,
  mapRegistrationBuildingForFinalize,
} from '../pages/owner/register';

describe('Owner Round 2.4F: Registration Pricing Authority (Missing Value vs Explicit Zero)', () => {
  it('parseOptionalConfiguredNumber distinguishes between genuine 0 and missing values', () => {
    expect(parseOptionalConfiguredNumber(0)).toBe(0);
    expect(parseOptionalConfiguredNumber('0')).toBe(0);
    expect(parseOptionalConfiguredNumber(4500)).toBe(4500);
    expect(parseOptionalConfiguredNumber('4500')).toBe(4500);

    expect(parseOptionalConfiguredNumber('')).toBeNull();
    expect(parseOptionalConfiguredNumber(null)).toBeNull();
    expect(parseOptionalConfiguredNumber(undefined)).toBeNull();
    expect(parseOptionalConfiguredNumber('abc')).toBeNull();
  });

  it('resolveFirstDefinedNumber respects explicit 0 and does not fall back when 0 is configured', () => {
    // Explicit 0 in first position must win
    expect(resolveFirstDefinedNumber(0, 5000)).toBe(0);
    expect(resolveFirstDefinedNumber('0', 5000)).toBe(0);

    // Empty first position must fall back to second
    expect(resolveFirstDefinedNumber('', 5000)).toBe(5000);
    expect(resolveFirstDefinedNumber(null, 5000)).toBe(5000);
    expect(resolveFirstDefinedNumber(undefined, 5000)).toBe(5000);

    // If all are empty, returns null (never forced to 0)
    expect(resolveFirstDefinedNumber('', '', '')).toBeNull();
    expect(resolveFirstDefinedNumber(null, undefined, '')).toBeNull();
  });

  it('CRITICAL AUDIT RULE: mapRegistrationBuildingForFinalize preserves null for missing monthlyRent and does not create artificial 0', () => {
    const rawBuilding = {
      id: 'b-1',
      name: 'อาคาร 1',
      totalFloors: 2,
      rentRates: {
        monthly: '', // unconfigured
        daily: '',
        term: '',
      },
      termDeposit: '',
      monthlyDeposit: '',
      dailyDeposit: '',
    };

    const finalized = mapRegistrationBuildingForFinalize(rawBuilding, 0, '');

    expect(finalized.monthlyRent).toBeNull();
    expect(finalized.dailyRent).toBeNull();
    expect(finalized.termRent).toBeNull();
    expect(finalized.monthlyDeposit).toBeNull();
    expect(finalized.termDeposit).toBeNull();
    expect(finalized.dailyDeposit).toBeNull();
  });

  it('mapRegistrationBuildingForFinalize preserves genuinely configured 0', () => {
    const rawBuilding = {
      id: 'b-2',
      name: 'อาคาร 2',
      totalFloors: 1,
      rentRates: {
        monthly: 0, // explicit 0 (e.g. free staff room building)
        daily: '0',
        term: null,
      },
      termDeposit: 0,
      monthlyDeposit: 0,
      dailyDeposit: 0,
    };

    const finalized = mapRegistrationBuildingForFinalize(rawBuilding, 1, '');

    expect(finalized.monthlyRent).toBe(0);
    expect(finalized.dailyRent).toBe(0);
    expect(finalized.termRent).toBeNull();
    expect(finalized.monthlyDeposit).toBe(0);
    expect(finalized.termDeposit).toBe(0);
    expect(finalized.dailyDeposit).toBe(0);
  });

  it('AUTHORITATIVE AUDIT RULE: Independent per-rental-type deposits do not collapse into single generic value', () => {
    const rawBuilding = {
      id: 'b-3',
      name: 'อาคาร 3',
      totalFloors: 3,
      rentRates: {
        monthly: 3500,
        daily: 500,
        term: 14000,
      },
      monthlyDeposit: 5000,
      termDeposit: 10000,
      dailyDeposit: 1000,
    };

    const finalized = mapRegistrationBuildingForFinalize(rawBuilding, 2, 5000);

    expect(finalized.monthlyDeposit).toBe(5000);
    expect(finalized.termDeposit).toBe(10000);
    expect(finalized.dailyDeposit).toBe(1000);
  });
});
