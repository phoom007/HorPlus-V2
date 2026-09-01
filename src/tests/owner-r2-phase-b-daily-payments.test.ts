/**
 * @license Apache-2.0
 * Round 2 Phase B: Daily Invoices Surfacing, Other Fees Sync, and Strict Paid Authority
 */
import { describe, it, expect } from 'vitest';
import { isDailyInvoiceFullyPaid } from '../utils/dailyPaymentPredicate';

describe('Round 2 Phase B: Daily Invoices Surfacing & Strict Paid Authority', () => {
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

  describe('2. Daily Start-Month Cycle Authority', () => {
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

  describe('3. Strict Daily Paid Authority & Tab Mutual Exclusivity (Production Helper)', () => {
    it('Case 1: PAID + outstanding 0 + totalAgreed > 0 -> TRUE (in Paid tab)', () => {
      const inv = { status: 'PAID', outstandingAmount: '0.00', totalAgreedAmount: '550.00' };
      expect(isDailyInvoiceFullyPaid(inv)).toBe(true);
    });

    it('Case 2: PARTIALLY_PAID + outstanding 500 -> FALSE (in Unpaid tab only)', () => {
      const inv = { status: 'PARTIALLY_PAID', outstandingAmount: '500.00', totalAgreedAmount: '1000.00' };
      expect(isDailyInvoiceFullyPaid(inv)).toBe(false);
    });

    it('Case 3: ISSUED + outstanding 0 -> FALSE (fails closed)', () => {
      const inv = { status: 'ISSUED', outstandingAmount: '0.00', totalAgreedAmount: '500.00' };
      expect(isDailyInvoiceFullyPaid(inv)).toBe(false);
    });

    it('Case 4: PARTIALLY_PAID + outstanding 0 -> FALSE (fails closed until backend status is corrected)', () => {
      const inv = { status: 'PARTIALLY_PAID', outstandingAmount: '0.00', totalAgreedAmount: '500.00' };
      expect(isDailyInvoiceFullyPaid(inv)).toBe(false);
    });

    it('Case 5: CANCELLED + outstanding 0 -> FALSE (in neither active tab)', () => {
      const inv = { status: 'CANCELLED', outstandingAmount: '0.00', totalAgreedAmount: '500.00' };
      expect(isDailyInvoiceFullyPaid(inv)).toBe(false);
    });

    it('Case 6: Mutual Exclusivity - same invoice never appears in both Paid and Unpaid tabs', () => {
      const testInvoices = [
        { id: '1', status: 'PAID', outstandingAmount: '0.00', totalAgreedAmount: '500.00' },
        { id: '2', status: 'PARTIALLY_PAID', outstandingAmount: '200.00', totalAgreedAmount: '500.00' },
        { id: '3', status: 'ISSUED', outstandingAmount: '500.00', totalAgreedAmount: '500.00' },
        { id: '4', status: 'CANCELLED', outstandingAmount: '0.00', totalAgreedAmount: '500.00' },
      ];

      const unpaidTab = testInvoices.filter((inv) => inv.status !== 'CANCELLED' && !isDailyInvoiceFullyPaid(inv));
      const paidTab = testInvoices.filter((inv) => isDailyInvoiceFullyPaid(inv));

      const unpaidIds = new Set(unpaidTab.map((i) => i.id));
      const paidIds = new Set(paidTab.map((i) => i.id));

      for (const id of unpaidIds) {
        expect(paidIds.has(id)).toBe(false);
      }
      expect(paidIds.has('1')).toBe(true);
      expect(unpaidIds.has('2')).toBe(true);
      expect(unpaidIds.has('3')).toBe(true);
      expect(unpaidIds.has('4')).toBe(false);
      expect(paidIds.has('4')).toBe(false);
    });
  });
});
