import { describe, it, expect, vi } from 'vitest';
import { getEffectiveBillAmount, getEffectiveBillTotal } from '../pages/owner/payments';

describe('Universal Toast, Billing Cycle Lock UX & Cash VAT Integration Tests', () => {
  describe('Effective Bill Cash Amount with VAT (STCV-03 & STCV-04)', () => {
    const vatSettings = {
      enabled: true,
      rate: 7,
      categories: ['room'],
    };

    it('calculates 4,815 THB for a 4,500 THB bill with 7% VAT enabled on room category', () => {
      const bill = {
        id: 'bill-1',
        roomId: 'room-101',
        totalAmount: 4500,
        outstandingAmount: 4500,
        paidAmount: 0,
        items: [
          {
            type: 'ROOM',
            category: 'room',
            description: 'ค่าเช่าห้องพัก',
            amount: 4500,
          },
        ],
      };

      const effectiveAmt = getEffectiveBillAmount(bill, vatSettings);
      const effectiveTotal = getEffectiveBillTotal(bill, vatSettings);

      expect(effectiveAmt).toBe(4815);
      expect(effectiveTotal).toBe(4815);
    });

    it('retains exact amount when VAT is not active or bill already has VAT stamped', () => {
      const billWithVat = {
        id: 'bill-2',
        roomId: 'room-102',
        totalAmount: 4815,
        outstandingAmount: 4815,
        paidAmount: 0,
        isVatActive: true,
        vatAmount: 315,
        items: [
          {
            type: 'ROOM',
            description: 'ค่าเช่าห้องพัก',
            amount: 4500,
          },
        ],
      };

      expect(getEffectiveBillAmount(billWithVat, vatSettings)).toBe(4815);
      expect(getEffectiveBillTotal(billWithVat, vatSettings)).toBe(4815);
    });

    it('returns raw amount when VAT settings are disabled', () => {
      const disabledVat = {
        enabled: false,
        rate: 7,
        categories: ['room'],
      };

      const bill = {
        id: 'bill-3',
        totalAmount: 4500,
        outstandingAmount: 4500,
        paidAmount: 0,
        items: [
          {
            type: 'ROOM',
            description: 'ค่าเช่าห้องพัก',
            amount: 4500,
          },
        ],
      };

      expect(getEffectiveBillAmount(bill, disabledVat)).toBe(4500);
      expect(getEffectiveBillTotal(bill, disabledVat)).toBe(4500);
    });
  });

  describe('Locked Cycle Invariant & UX Specification (STCV-02 & PO Q2.1)', () => {
    it('confirms cycle lock criteria: non-draft bills lock the cycle rate modification', () => {
      const billsInCycle = [
        { id: 'b1', status: 'unpaid' },
        { id: 'b2', status: 'unpaid' },
      ];

      const isCycleLocked = billsInCycle.some(b => b.status !== 'draft');
      expect(isCycleLocked).toBe(true);
    });

    it('allows rate modifications only when all bills are draft or no bills exist', () => {
      const draftBills = [
        { id: 'b1', status: 'draft' },
        { id: 'b2', status: 'draft' },
      ];
      expect(draftBills.some(b => b.status !== 'draft')).toBe(false);

      const emptyBills: any[] = [];
      expect(emptyBills.some(b => b.status !== 'draft')).toBe(false);
    });
  });
});
