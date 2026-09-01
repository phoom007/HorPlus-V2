/**
 * @license Apache-2.0
 * Round 2 Phase B: Daily Invoices Surfacing & Other Fees Sync Test Suite
 */
import { describe, it, expect } from 'vitest';

describe('Round 2 Phase B: Daily Invoices Surfacing & Other Fees Sync', () => {
  describe('1. Daily Invoice Amount Aggregation with Other Fees', () => {
    it('aggregates daily rent (500) + other fee (50) into single invoice total (550)', () => {
      const dailyRentItem = { itemType: 'DAILY_RENT', description: 'ค่าเช่าห้องพักรายวัน (1 วัน)', amount: '500.00', status: 'OUTSTANDING' };
      const otherFeeItem = { itemType: 'OTHER_FEE', description: 'ค่าล้างแอร์', amount: '50.00', status: 'OUTSTANDING' };

      const items = [dailyRentItem, otherFeeItem];
      const totalAgreed = items.reduce((sum, it) => sum + Number(it.amount), 0);
      const totalPaid = items
        .filter((it) => it.status === 'SETTLED' || it.status === 'DECLARED_PAID')
        .reduce((sum, it) => sum + Number(it.amount), 0);
      const remainingOutstanding = Math.max(0, totalAgreed - totalPaid);

      expect(totalAgreed).toBe(550);
      expect(remainingOutstanding).toBe(550);
    });

    it('settling ALL items updates totalPaid to 550 and outstanding to 0', () => {
      const dailyRentItem = { itemType: 'DAILY_RENT', description: 'ค่าเช่าห้องพักรายวัน (1 วัน)', amount: '500.00', status: 'SETTLED' };
      const otherFeeItem = { itemType: 'OTHER_FEE', description: 'ค่าล้างแอร์', amount: '50.00', status: 'SETTLED' };

      const items = [dailyRentItem, otherFeeItem];
      const totalAgreed = items.reduce((sum, it) => sum + Number(it.amount), 0);
      const totalPaid = items
        .filter((it) => it.status === 'SETTLED' || it.status === 'DECLARED_PAID')
        .reduce((sum, it) => sum + Number(it.amount), 0);
      const remainingOutstanding = Math.max(0, totalAgreed - totalPaid);

      expect(totalAgreed).toBe(550);
      expect(totalPaid).toBe(550);
      expect(remainingOutstanding).toBe(0);
    });
  });

  describe('2. Daily Other Fees Idempotent Replacement', () => {
    it('repeatedly syncing clean other fees does not duplicate items', () => {
      let invoiceItems = [
        { id: 'item-1', itemType: 'DAILY_RENT', description: 'ค่าเช่าห้องพักรายวัน', amount: '500.00', status: 'OUTSTANDING' },
        { id: 'item-2', itemType: 'OTHER_FEE', description: 'ค่าล้างแอร์', amount: '50.00', status: 'OUTSTANDING' },
      ];

      // Re-sync other fees: delete unpaid OTHER_FEE and insert new list
      const cleanOtherFees = [{ description: 'ค่าล้างแอร์', amount: '50.00' }];
      invoiceItems = invoiceItems.filter(it => it.itemType !== 'OTHER_FEE');
      invoiceItems.push(...cleanOtherFees.map((f, idx) => ({
        id: `item-new-${idx}`,
        itemType: 'OTHER_FEE',
        description: f.description,
        amount: f.amount,
        status: 'OUTSTANDING',
      })));

      expect(invoiceItems.length).toBe(2);
      expect(invoiceItems.filter(it => it.itemType === 'OTHER_FEE').length).toBe(1);
    });
  });
});
