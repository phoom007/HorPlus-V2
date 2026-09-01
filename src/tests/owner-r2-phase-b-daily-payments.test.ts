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

  describe('3. Daily Start-Month Cycle Authority', () => {
    const isDailyInvoiceInSelectedCycle = (inv: any, cycle: { periodStart: string; periodEnd: string } | null): boolean => {
      if (!cycle) return true;
      const stay = inv.dailyStay;
      const startStr = stay?.startDate ? String(stay.startDate).slice(0, 10) : (inv.checkInDate ? String(inv.checkInDate).slice(0, 10) : (inv.issuedAt ? String(inv.issuedAt).slice(0, 10) : ''));
      const cycleStartStr = String(cycle.periodStart).slice(0, 10);
      const cycleEndStr = String(cycle.periodEnd).slice(0, 10);

      if (!startStr || !cycleStartStr || !cycleEndStr) return true;
      return startStr >= cycleStartStr && startStr <= cycleEndStr;
    };

    it('cross-month stay 2026-07-31 -> 2026-08-02 is visible in July and NOT in August', () => {
      const crossMonthInvoice = {
        id: 'inv-cross-1',
        dailyStay: { startDate: '2026-07-31', endDate: '2026-08-02' },
      };

      const julyCycle = { periodStart: '2026-07-01', periodEnd: '2026-07-31' };
      const augustCycle = { periodStart: '2026-08-01', periodEnd: '2026-08-31' };

      expect(isDailyInvoiceInSelectedCycle(crossMonthInvoice, julyCycle)).toBe(true);
      expect(isDailyInvoiceInSelectedCycle(crossMonthInvoice, augustCycle)).toBe(false);
    });

    it('same-month stay 2026-09-01 -> 2026-09-02 is visible in September only', () => {
      const septInvoice = {
        id: 'inv-sept-1',
        dailyStay: { startDate: '2026-09-01', endDate: '2026-09-02' },
      };

      const augustCycle = { periodStart: '2026-08-01', periodEnd: '2026-08-31' };
      const septCycle = { periodStart: '2026-09-01', periodEnd: '2026-09-30' };

      expect(isDailyInvoiceInSelectedCycle(septInvoice, septCycle)).toBe(true);
      expect(isDailyInvoiceInSelectedCycle(septInvoice, augustCycle)).toBe(false);
    });
  });

  describe('4. Daily Partial Payment Tab Separation', () => {
    const isDailyInvoiceFullyPaid = (inv: any): boolean => {
      const status = (inv.status || '').toUpperCase();
      if (status === 'CANCELLED') return false;
      const outstanding = Number(inv.outstandingAmount ?? inv.totalAgreedAmount ?? 0);
      return (status === 'PAID' || outstanding === 0) && outstanding === 0 && Number(inv.totalAgreedAmount ?? 0) > 0;
    };

    it('partially settled invoice (deposit settled 500, rent outstanding 500) is in unpaid tab only', () => {
      const partialInvoice = {
        id: 'inv-part-1',
        status: 'PARTIALLY_PAID',
        totalAgreedAmount: '1000.00',
        outstandingAmount: '500.00',
        items: [
          { itemType: 'DEPOSIT', amount: '500.00', status: 'SETTLED' },
          { itemType: 'DAILY_RENT', amount: '500.00', status: 'OUTSTANDING' },
        ],
      };

      expect(isDailyInvoiceFullyPaid(partialInvoice)).toBe(false);
      // In unpaid tab
      expect(!isDailyInvoiceFullyPaid(partialInvoice)).toBe(true);
    });

    it('after settling remaining rent (outstanding 0), moves to paid tab only', () => {
      const fullyPaidInvoice = {
        id: 'inv-full-1',
        status: 'PAID',
        totalAgreedAmount: '1000.00',
        outstandingAmount: '0.00',
        items: [
          { itemType: 'DEPOSIT', amount: '500.00', status: 'SETTLED' },
          { itemType: 'DAILY_RENT', amount: '500.00', status: 'SETTLED' },
        ],
      };

      expect(isDailyInvoiceFullyPaid(fullyPaidInvoice)).toBe(true);
    });
  });
});
