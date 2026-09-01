/**
 * @license Apache-2.0
 * Round 2 Phase B: Settled Other-Fee Immutability & Conflict Rejection Tests
 */
import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { formatDecimal } from '../../utils/decimal-math.util.js';

describe('Round 2 Phase B: Settled Daily Other-Fee Immutability', () => {
  function syncDailyOtherFees(
    existingItems: Array<{ id: string; itemType: string; description: string; amount: any; status: string }>,
    cleanOtherFees: Array<{ description: string; amount: any }>
  ) {
    const settledOtherFees = existingItems.filter(
      (it) => it.itemType === 'OTHER_FEE' && (it.status === 'SETTLED' || it.status === 'DECLARED_PAID')
    );

    if (settledOtherFees.length > 0) {
      const availableCleanFees = cleanOtherFees.map((f) => ({
        description: f.description,
        amountDec: new Prisma.Decimal(formatDecimal(f.amount)),
        matched: false,
      }));

      for (const settled of settledOtherFees) {
        const settledAmtDec = new Prisma.Decimal(formatDecimal(settled.amount));
        const exactMatch = availableCleanFees.find(
          (cf) => !cf.matched && cf.description === settled.description && cf.amountDec.equals(settledAmtDec)
        );

        if (exactMatch) {
          exactMatch.matched = true;
        } else {
          const changedFee = availableCleanFees.find((cf) => cf.description === settled.description);
          if (changedFee) {
            const err = new Error(`ไม่สามารถแก้ไขรายการค่าใช้จ่าย "${settled.description}" ที่ชำระเงินแล้วได้`);
            (err as any).statusCode = 409;
            (err as any).code = 'DAILY_OTHER_FEE_ALREADY_SETTLED';
            throw err;
          }
          const err = new Error(`ไม่สามารถลบรายการค่าใช้จ่าย "${settled.description}" ที่ชำระเงินแล้วได้`);
          (err as any).statusCode = 409;
          (err as any).code = 'DAILY_OTHER_FEE_ALREADY_SETTLED';
          throw err;
        }
      }
    }

    const remainingItems = existingItems.filter((it) => it.itemType !== 'OTHER_FEE' || it.status !== 'OUTSTANDING');
    const matchedSettledIds = new Set<string>();
    const createdItems: any[] = [];

    for (const fee of cleanOtherFees) {
      const feeAmtDec = new Prisma.Decimal(formatDecimal(fee.amount));
      const matchingSettled = settledOtherFees.find(
        (s) =>
          !matchedSettledIds.has(s.id) &&
          s.description === fee.description &&
          new Prisma.Decimal(formatDecimal(s.amount)).equals(feeAmtDec)
      );

      if (matchingSettled) {
        matchedSettledIds.add(matchingSettled.id);
      } else {
        createdItems.push({
          id: `new-${createdItems.length + 1}`,
          itemType: 'OTHER_FEE',
          description: fee.description,
          amount: feeAmtDec,
          status: 'OUTSTANDING',
        });
      }
    }

    const allItems = [...remainingItems, ...createdItems];
    let totalAgreed = new Prisma.Decimal('0.00');
    let totalPaid = new Prisma.Decimal('0.00');

    for (const it of allItems) {
      const itAmt = new Prisma.Decimal(formatDecimal(it.amount));
      totalAgreed = totalAgreed.plus(itAmt);
      if (it.status === 'SETTLED' || it.status === 'DECLARED_PAID') {
        totalPaid = totalPaid.plus(itAmt);
      }
    }

    return {
      items: allItems,
      totalAgreed: totalAgreed.toFixed(2),
      outstanding: totalAgreed.minus(totalPaid).toFixed(2),
    };
  }

  it('1. rejects mutation when user attempts to change amount of settled fee (50 -> 80)', () => {
    const existing = [
      { id: '1', itemType: 'DAILY_RENT', description: 'ค่าเช่ารายวัน', amount: '500.00', status: 'OUTSTANDING' },
      { id: '2', itemType: 'OTHER_FEE', description: 'ค่าล้างแอร์', amount: '50.00', status: 'SETTLED' },
    ];

    expect(() => {
      syncDailyOtherFees(existing, [{ description: 'ค่าล้างแอร์', amount: '80.00' }]);
    }).toThrowError(/ไม่สามารถแก้ไขรายการค่าใช้จ่าย "ค่าล้างแอร์" ที่ชำระเงินแล้วได้/);
  });

  it('2. rejects deletion when user attempts to remove settled fee row', () => {
    const existing = [
      { id: '1', itemType: 'DAILY_RENT', description: 'ค่าเช่ารายวัน', amount: '500.00', status: 'OUTSTANDING' },
      { id: '2', itemType: 'OTHER_FEE', description: 'ค่าล้างแอร์', amount: '50.00', status: 'SETTLED' },
    ];

    expect(() => {
      syncDailyOtherFees(existing, []);
    }).toThrowError(/ไม่สามารถลบรายการค่าใช้จ่าย "ค่าล้างแอร์" ที่ชำระเงินแล้วได้/);
  });

  it('3. allows unchanged save with settled fee without creating duplicate', () => {
    const existing = [
      { id: '1', itemType: 'DAILY_RENT', description: 'ค่าเช่ารายวัน', amount: '500.00', status: 'OUTSTANDING' },
      { id: '2', itemType: 'OTHER_FEE', description: 'ค่าล้างแอร์', amount: '50.00', status: 'SETTLED' },
    ];

    const result = syncDailyOtherFees(existing, [{ description: 'ค่าล้างแอร์', amount: '50.00' }]);
    expect(result.totalAgreed).toBe('550.00');
    expect(result.outstanding).toBe('500.00');
    expect(result.items.filter((it) => it.itemType === 'OTHER_FEE').length).toBe(1);
  });

  it('4. updates unpaid fee cleanly (50 -> 80 yielding 580 total)', () => {
    const existing = [
      { id: '1', itemType: 'DAILY_RENT', description: 'ค่าเช่ารายวัน', amount: '500.00', status: 'OUTSTANDING' },
      { id: '2', itemType: 'OTHER_FEE', description: 'ค่าล้างแอร์', amount: '50.00', status: 'OUTSTANDING' },
    ];

    const result = syncDailyOtherFees(existing, [{ description: 'ค่าล้างแอร์', amount: '80.00' }]);
    expect(result.totalAgreed).toBe('580.00');
    expect(result.outstanding).toBe('580.00');
    expect(result.items.filter((it) => it.itemType === 'OTHER_FEE').length).toBe(1);
    expect(result.items.find((it) => it.itemType === 'OTHER_FEE')?.amount.toString()).toBe('80');
  });

  it('5. allows adding new distinct fee alongside settled fee', () => {
    const existing = [
      { id: '1', itemType: 'DAILY_RENT', description: 'ค่าเช่ารายวัน', amount: '500.00', status: 'OUTSTANDING' },
      { id: '2', itemType: 'OTHER_FEE', description: 'ค่าล้างแอร์', amount: '50.00', status: 'SETTLED' },
    ];

    const result = syncDailyOtherFees(existing, [
      { description: 'ค่าล้างแอร์', amount: '50.00' },
      { description: 'ค่ากุญแจเพิ่ม', amount: '30.00' },
    ]);
    expect(result.totalAgreed).toBe('580.00');
    expect(result.outstanding).toBe('530.00');
    expect(result.items.filter((it) => it.itemType === 'OTHER_FEE').length).toBe(2);
  });
});
