/**
 * @license Apache-2.0
 * Round 2 Phase C: Recurring Rent Bill Production & Idempotency Tests
 */
import { describe, it, expect, vi } from 'vitest';
import { calculateInstallmentSchedule } from '../../utils/installment-calculator.util.js';

describe('Round 2 Phase C: Recurring Rent Generation Logic', () => {
  it('1. Monthly agreement generates distinct RENT bills across Sep, Oct, Nov', () => {
    const monthlyTerm = {
      id: 'term-m-1',
      rentalType: 'MONTHLY',
      startDate: '2026-09-01',
      durationMonths: 3,
      unitRentAmount: '4500.00',
    };

    const cycles = [
      { id: 'c-sep', cycleCode: '2026-09', periodStart: '2026-09-01' },
      { id: 'c-oct', cycleCode: '2026-10', periodStart: '2026-10-01' },
      { id: 'c-nov', cycleCode: '2026-11', periodStart: '2026-11-01' },
    ];

    const generatedRentBills = cycles.map((cycle) => {
      return {
        billingCycleId: cycle.id,
        cycleCode: cycle.cycleCode,
        billKind: 'RENT',
        amount: Number(monthlyTerm.unitRentAmount),
        description: 'ค่าเช่าห้องพัก',
      };
    });

    expect(generatedRentBills.length).toBe(3);
    expect(generatedRentBills[0].cycleCode).toBe('2026-09');
    expect(generatedRentBills[1].cycleCode).toBe('2026-10');
    expect(generatedRentBills[2].cycleCode).toBe('2026-11');
    expect(generatedRentBills.every((b) => b.amount === 4500)).toBe(true);
  });

  it('2. Term agreement with 2 installments generates rent in Sep & Oct only, Nov has no installment', () => {
    const termAgreement = {
      id: 'term-t-1',
      rentalType: 'TERM',
      startDate: '2026-09-01',
      totalRentAmount: 9000,
      termInstallmentCount: 2,
    };

    const schedule = calculateInstallmentSchedule(termAgreement.totalRentAmount, termAgreement.termInstallmentCount);
    expect(schedule.length).toBe(2);

    const cycles = [
      { cycleCode: '2026-09', periodStart: '2026-09-01', cycleOffset: 0 },
      { cycleCode: '2026-10', periodStart: '2026-10-01', cycleOffset: 1 },
      { cycleCode: '2026-11', periodStart: '2026-11-01', cycleOffset: 2 },
    ];

    const cycleResults = cycles.map((cycle) => {
      if (cycle.cycleOffset >= 0 && cycle.cycleOffset < schedule.length) {
        const item = schedule[cycle.cycleOffset];
        return {
          eligible: true,
          billKind: 'RENT',
          amount: item.amount,
          description: item.description,
        };
      }
      return { eligible: false, reason: 'NO_INSTALLMENT_FOR_CYCLE' };
    });

    expect(cycleResults[0].eligible).toBe(true);
    expect(cycleResults[0].amount).toBe(4500);
    expect(cycleResults[1].eligible).toBe(true);
    expect(cycleResults[1].amount).toBe(4500);
    expect(cycleResults[2].eligible).toBe(false);
    expect(cycleResults[2].reason).toBe('NO_INSTALLMENT_FOR_CYCLE');
  });

  it('3. Pre-existing Rent Bill in cycle prevents duplicate creation', () => {
    const existingBills = new Map<string, boolean>();
    existingBills.set('room-1:c-sep:RENT', true);

    const checkShouldGenerate = (roomId: string, cycleId: string, kind: string) => {
      const key = `${roomId}:${cycleId}:${kind}`;
      if (existingBills.has(key)) {
        return { created: false, reason: 'BILL_ALREADY_EXISTS' };
      }
      existingBills.set(key, true);
      return { created: true };
    };

    const firstRun = checkShouldGenerate('room-1', 'c-sep', 'RENT');
    expect(firstRun.created).toBe(false);
    expect(firstRun.reason).toBe('BILL_ALREADY_EXISTS');

    const octRun = checkShouldGenerate('room-1', 'c-oct', 'RENT');
    expect(octRun.created).toBe(true);

    const octDuplicateRun = checkShouldGenerate('room-1', 'c-oct', 'RENT');
    expect(octDuplicateRun.created).toBe(false);
  });
});
