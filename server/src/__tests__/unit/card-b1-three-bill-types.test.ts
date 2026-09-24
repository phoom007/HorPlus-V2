import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRecordCashPaymentInTx = vi.fn().mockResolvedValue({
  payment: { id: 'payment-1', amount: '8000.00' },
  receipt: { id: 'receipt-1', receiptNumber: 'RC-202609-103-0001' },
});
const mockGenerateNextBillNumberInTx = vi.fn().mockImplementation(async (_tx, _dormId, cycleCode) => {
  return `INV-${cycleCode || '202609'}-0001`;
});

vi.mock('../../utils/payment-transaction.util.js', () => ({
  recordCashPaymentInTx: (...args: any[]) => mockRecordCashPaymentInTx(...args),
}));

vi.mock('../../utils/bill-number.util.js', () => ({
  generateNextBillNumberInTx: (...args: any[]) => mockGenerateNextBillNumberInTx(...args),
}));

import {
  createDepositBillForAgreementInTx,
  createImmediateRentBillForAgreementInTx,
} from '../../utils/deposit-billing.util';
import { isBillVisibleToTenant } from '../../utils/tenant-visibility.util';

describe('Card B1: Three Bill Display Rules (PO-10, OQ-2, OQ-19)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('B1-1: Initial RENT bill and DEPOSIT bill creation upon approval', () => {
    it('creates Round 1 RENT bill with immediate visibility (billingDate = now, isInitialRentBill: true) and full monthly contract rent', async () => {
      const createdBills: any[] = [];

      const mockTx: any = {
        billingCycle: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'cycle-current',
              cycleCode: '2026-09',
              periodStart: new Date('2026-09-01T00:00:00.000Z'),
              periodEnd: new Date('2026-09-30T23:59:59.000Z'),
            },
            {
              id: 'cycle-next',
              cycleCode: '2026-10',
              periodStart: new Date('2026-10-01T00:00:00.000Z'),
              periodEnd: new Date('2026-10-31T23:59:59.000Z'),
            },
          ]),
        },
        bill: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockImplementation(async ({ data }) => {
            const bill = { id: `bill-${createdBills.length + 1}`, ...data };
            createdBills.push(bill);
            return bill;
          }),
        },
      };

      const firstBill = await createImmediateRentBillForAgreementInTx(mockTx, {
        dormitoryId: 'dorm-1',
        tenantId: 'tenant-td',
        roomId: 'room-102',
        contractId: 'contract-td',
        agreementType: 'MONTHLY',
        startDate: new Date('2026-09-24T00:00:00.000Z'),
        endDate: new Date('2026-10-31T00:00:00.000Z'),
        unitRentAmount: 4500,
        actorUserId: '20000001-0000-4000-8000-000000000001',
      });

      expect(firstBill).not.toBeNull();
      expect(createdBills).toHaveLength(2);
      expect(createdBills[0].billKind).toBe('RENT');
      expect(createdBills[0].status).toBe('unpaid');
      expect(Number(createdBills[0].totalAmount)).toBe(4500);

      // Round 1 must have isInitialRentBill: true
      expect(createdBills[0].items.create[0].metadata).toMatchObject({
        isInitialRentBill: true,
        rentRound: 1,
      });

      // Round 2 must have billingDate = cycle.periodStart (2026-10-01) and isInitialRentBill: false
      expect(createdBills[1].billingDate.toISOString()).toBe('2026-10-01T00:00:00.000Z');
      expect(createdBills[1].items.create[0].metadata).toMatchObject({
        isInitialRentBill: false,
        rentRound: 2,
      });
    });

    it('falls back to earliest active cycle when onboarding occurs before the earliest DB cycle (Go-live boundary)', async () => {
      const createdBills: any[] = [];

      const mockTx: any = {
        billingCycle: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'cycle-2027-01',
              cycleCode: '2027-01',
              periodStart: new Date('2027-01-01T00:00:00.000Z'),
              periodEnd: new Date('2027-01-31T23:59:59.000Z'),
            },
          ]),
        },
        bill: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockImplementation(async ({ data }) => {
            const bill = { id: 'bill-initial', ...data };
            createdBills.push(bill);
            return bill;
          }),
        },
      };

      const firstBill = await createImmediateRentBillForAgreementInTx(mockTx, {
        dormitoryId: 'dorm-1',
        tenantId: 'tenant-td',
        roomId: 'room-102',
        contractId: 'contract-td',
        agreementType: 'MONTHLY',
        startDate: new Date('2026-09-24T00:00:00.000Z'),
        endDate: new Date('2026-11-30T00:00:00.000Z'),
        unitRentAmount: 4500,
        actorUserId: '20000001-0000-4000-8000-000000000001',
      });

      expect(firstBill).not.toBeNull();
      expect(createdBills).toHaveLength(1);
      expect(createdBills[0].billingCycleId).toBe('cycle-2027-01');
      expect(createdBills[0].items.create[0].metadata).toMatchObject({
        isInitialRentBill: true,
        rentRound: 1,
      });
    });
  });

  describe('B1-2: OQ-2 (no retroactive unpaid rent bills) & OQ-19 (pre-paid deposit settled as PAID with receipt)', () => {
    it('does NOT generate retroactive unpaid RENT bills for months before the current onboarding month (OQ-2)', async () => {
      const createdBills: any[] = [];
      const mockTx: any = {
        billingCycle: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'cycle-2025-12',
              cycleCode: '2025-12',
              periodStart: new Date('2025-12-01T00:00:00.000Z'),
              periodEnd: new Date('2025-12-31T23:59:59.000Z'),
            },
            {
              id: 'cycle-2026-08',
              cycleCode: '2026-08',
              periodStart: new Date('2026-08-01T00:00:00.000Z'),
              periodEnd: new Date('2026-08-31T23:59:59.000Z'),
            },
            {
              id: 'cycle-2026-09',
              cycleCode: '2026-09',
              periodStart: new Date('2026-09-01T00:00:00.000Z'),
              periodEnd: new Date('2026-09-30T23:59:59.000Z'),
            },
          ]),
        },
        bill: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockImplementation(async ({ data }) => {
            const bill = { id: `bill-${createdBills.length + 1}`, ...data };
            createdBills.push(bill);
            return bill;
          }),
        },
      };

      // Backdated startDate (e.g. 2025-12-01)
      await createImmediateRentBillForAgreementInTx(mockTx, {
        dormitoryId: 'dorm-1',
        tenantId: 'tenant-tx',
        roomId: 'room-103',
        contractId: 'contract-tx',
        agreementType: 'MONTHLY',
        startDate: new Date('2025-12-01T00:00:00.000Z'),
        endDate: null,
        unitRentAmount: 4000,
        actorUserId: '20000001-0000-4000-8000-000000000001',
      });

      // Only the current onboarding month (2026-09) bill is created; 2025-12 and 2026-08 are skipped
      expect(createdBills).toHaveLength(1);
      expect(createdBills[0].billingCycleId).toBe('cycle-2026-09');
    });

    it('settles deposit as PAID and issues receipt when depositDeclaredStatus = PAID (OQ-19)', async () => {
      const mockTx: any = {
        billingCycle: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'cycle-1',
            cycleCode: '2026-09',
            periodStart: new Date('2026-09-01T00:00:00.000Z'),
            periodEnd: new Date('2026-09-30T23:59:59.000Z'),
          }),
        },
        bill: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({
            id: 'deposit-bill-paid',
            billNumber: 'DEP-202609-103-1',
            billKind: 'DEPOSIT',
            status: 'unpaid',
            totalAmount: '8000.00',
            paidAmount: '0.00',
            outstandingAmount: '8000.00',
          }),
          findUnique: vi.fn().mockResolvedValue({
            id: 'deposit-bill-paid',
            billNumber: 'DEP-202609-103-1',
            billKind: 'DEPOSIT',
            status: 'paid',
            totalAmount: '8000.00',
            paidAmount: '8000.00',
            outstandingAmount: '0.00',
          }),
        },
      };

      const bill = await createDepositBillForAgreementInTx(mockTx, {
        dormitoryId: 'dorm-1',
        tenantId: 'tenant-tx',
        roomId: 'room-103',
        contractId: 'contract-tx',
        agreementType: 'MONTHLY',
        startDate: new Date('2026-09-01T00:00:00.000Z'),
        depositAmount: 8000,
        depositDeclaredStatus: 'PAID',
        actorUserId: '20000001-0000-4000-8000-000000000001',
      });

      expect(bill).not.toBeNull();
      expect(bill.status).toBe('paid');
      expect(mockRecordCashPaymentInTx).toHaveBeenCalledTimes(1);
      expect(mockRecordCashPaymentInTx).toHaveBeenCalledWith(
        mockTx,
        expect.objectContaining({
          billId: 'deposit-bill-paid',
          amount: '8000.00',
        })
      );
    });
  });

  describe('B1-3 & B1-4: isBillVisibleToTenant for RENT, DEPOSIT, and MONTHLY_UTILITY', () => {
    it('shows Round 1 RENT bill immediately even when periodStart is in a future cycle', () => {
      const round1Bill = {
        billKind: 'RENT',
        status: 'unpaid',
        billingDate: new Date('2026-09-24T10:00:00.000Z'),
        billingCycle: {
          periodStart: new Date('2027-01-01T00:00:00.000Z'),
        },
        items: [
          {
            type: 'rent',
            metadata: { isInitialRentBill: true, rentRound: 1 },
          },
        ],
      };

      expect(isBillVisibleToTenant(round1Bill, new Date('2026-09-24T12:00:00.000Z'))).toBe(true);
    });

    it('hides Round 2+ RENT bill before the 1st of that month and shows it on/after the 1st of that month (B1-4)', () => {
      const round2Bill = {
        billKind: 'RENT',
        status: 'unpaid',
        billingDate: new Date('2026-10-01T00:00:00.000Z'),
        billingCycle: {
          periodStart: new Date('2026-10-01T00:00:00.000Z'),
        },
        items: [
          {
            type: 'rent',
            metadata: { isInitialRentBill: false, rentRound: 2 },
          },
        ],
      };

      // Before 1st of Oct 2026 (2026-09-30 in BKK) -> hidden
      expect(isBillVisibleToTenant(round2Bill, new Date('2026-09-30T10:00:00.000Z'))).toBe(false);

      // On 1st of Oct 2026 (2026-10-01 in BKK) -> visible
      expect(isBillVisibleToTenant(round2Bill, new Date('2026-10-01T01:00:00.000Z'))).toBe(true);
    });

    it('shows DEPOSIT and MONTHLY_UTILITY bills immediately when status is unpaid/ISSUED and hides DRAFT', () => {
      const depositBill = {
        billKind: 'DEPOSIT',
        status: 'unpaid',
        billingDate: new Date('2026-09-24T10:00:00.000Z'),
      };
      const utilityBill = {
        billKind: 'MONTHLY_UTILITY',
        status: 'unpaid',
        billingDate: new Date('2026-09-24T10:00:00.000Z'),
      };
      const draftUtilityBill = {
        billKind: 'MONTHLY_UTILITY',
        status: 'DRAFT',
        billingDate: new Date('2026-09-24T10:00:00.000Z'),
      };

      expect(isBillVisibleToTenant(depositBill, new Date('2026-09-24T12:00:00.000Z'))).toBe(true);
      expect(isBillVisibleToTenant(utilityBill, new Date('2026-09-24T12:00:00.000Z'))).toBe(true);
      expect(isBillVisibleToTenant(draftUtilityBill, new Date('2026-09-24T12:00:00.000Z'))).toBe(false);
    });
  });
});
