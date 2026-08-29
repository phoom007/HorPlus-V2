import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDepositBillForAgreementInTx } from '../../utils/deposit-billing.util.js';
import { Decimal } from '@prisma/client/runtime/library.js';

describe('OWNER ROOMS R3.5 — Canonical Deposit Billing & Lifecycle Suite', () => {
  let mockTx: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTx = {
      bill: {
        findFirst: vi.fn(),
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockImplementation(async ({ data }: any) => ({
          id: 'bill-deposit-001',
          ...data,
        })),
      },
      billingCycle: {
        findFirst: vi.fn(),
        create: vi.fn(),
      },
      payment: {
        create: vi.fn().mockImplementation(async ({ data }: any) => ({
          id: 'payment-deposit-001',
          ...data,
        })),
      },
    };
  });

  describe('1. Deposit Billing Creation & Status Invariants', () => {
    it('returns null and creates no bill when depositAmount is 0 or negative', async () => {
      const resultZero = await createDepositBillForAgreementInTx(mockTx, {
        dormitoryId: 'dorm-1',
        roomId: 'room-1',
        agreementType: 'MONTHLY',
        contractId: 'agr-1',
        startDate: new Date('2026-08-01T00:00:00.000Z'),
        depositAmount: 0,
        depositDeclaredStatus: 'UNPAID',
      });

      expect(resultZero).toBeNull();
      expect(mockTx.bill.create).not.toHaveBeenCalled();

      const resultNeg = await createDepositBillForAgreementInTx(mockTx, {
        dormitoryId: 'dorm-1',
        roomId: 'room-1',
        agreementType: 'MONTHLY',
        contractId: 'agr-1',
        startDate: new Date('2026-08-01T00:00:00.000Z'),
        depositAmount: -100,
        depositDeclaredStatus: 'PAID',
      });

      expect(resultNeg).toBeNull();
      expect(mockTx.bill.create).not.toHaveBeenCalled();
    });

    it('creates UNPAID deposit bill with 0 paidAmount and full outstandingAmount when depositDeclaredStatus is UNPAID', async () => {
      mockTx.billingCycle.findFirst.mockResolvedValue({
        id: 'cycle-2026-08',
        cycleCode: '2026-08',
        periodStart: new Date('2026-08-01T00:00:00.000Z'),
        periodEnd: new Date('2026-08-31T23:59:59.999Z'),
      });

      const result = await createDepositBillForAgreementInTx(mockTx, {
        dormitoryId: 'dorm-1',
        roomId: 'room-1',
        tenantId: 'tenant-1',
        agreementType: 'MONTHLY',
        contractId: 'agr-101',
        startDate: new Date('2026-08-01T00:00:00.000Z'),
        depositAmount: 5000,
        depositDeclaredStatus: 'UNPAID',
        actorUserId: '00000000-0000-0000-0000-000000000001',
      });

      expect(result).toBeDefined();
      expect(mockTx.bill.create).toHaveBeenCalledTimes(1);

      const billCreateArg = mockTx.bill.create.mock.calls[0][0].data;
      expect(billCreateArg.billKind).toBe('DEPOSIT');
      expect(billCreateArg.status).toBe('unpaid');
      expect(billCreateArg.paidAmount).toEqual(new Decimal(0));
      expect(billCreateArg.outstandingAmount).toEqual(new Decimal(5000));
      expect(billCreateArg.paidAt).toBeNull();
      expect(billCreateArg.contractId).toBe('agr-101');
      expect(billCreateArg.billingCycleId).toBe('cycle-2026-08');

      // Bill Item verification
      expect(billCreateArg.items.create.length).toBe(1);
      expect(billCreateArg.items.create[0].type).toBe('deposit');
      expect(billCreateArg.items.create[0].amount).toEqual(new Decimal(5000));

      // No payment evidence for UNPAID
      expect(mockTx.payment.create).not.toHaveBeenCalled();
    });

    it('creates PAID deposit bill with paidAmount=deposit, outstandingAmount=0, and CASH Payment record when depositDeclaredStatus is PAID', async () => {
      mockTx.billingCycle.findFirst.mockResolvedValue({
        id: 'cycle-2026-08',
        cycleCode: '2026-08',
        periodStart: new Date('2026-08-01T00:00:00.000Z'),
        periodEnd: new Date('2026-08-31T23:59:59.999Z'),
      });

      const result = await createDepositBillForAgreementInTx(mockTx, {
        dormitoryId: 'dorm-1',
        roomId: 'room-2',
        tenantId: 'tenant-2',
        agreementType: 'TERM',
        provisionalRentalTermId: 'agr-term-202',
        startDate: new Date('2026-08-01T00:00:00.000Z'),
        depositAmount: 9000,
        depositDeclaredStatus: 'PAID',
        actorUserId: '00000000-0000-0000-0000-000000000001',
      });

      expect(result).toBeDefined();
      expect(mockTx.bill.create).toHaveBeenCalledTimes(1);

      const billCreateArg = mockTx.bill.create.mock.calls[0][0].data;
      expect(billCreateArg.billKind).toBe('DEPOSIT');
      expect(billCreateArg.status).toBe('paid');
      expect(billCreateArg.paidAmount).toEqual(new Decimal(9000));
      expect(billCreateArg.outstandingAmount).toEqual(new Decimal(0));
      expect(billCreateArg.paidAt).toBeInstanceOf(Date);
      expect(billCreateArg.provisionalRentalTermId).toBe('agr-term-202');

      // Bill Item
      expect(billCreateArg.items.create[0].type).toBe('deposit');
      expect(billCreateArg.items.create[0].amount).toEqual(new Decimal(9000));

      // CASH Payment Evidence
      expect(mockTx.payment.create).toHaveBeenCalledTimes(1);
      const paymentArg = mockTx.payment.create.mock.calls[0][0].data;
      expect(paymentArg.billId).toBe('bill-deposit-001');
      expect(paymentArg.method).toBe('CASH');
      expect(paymentArg.status).toBe('APPROVED');
      expect(paymentArg.amount).toEqual(new Decimal(9000));
      expect(paymentArg.reviewedByUserId).toBe('00000000-0000-0000-0000-000000000001');
    });
  });

  describe('2. Idempotency & Lifecycle Invariants', () => {
    it('returns existing deposit bill and does NOT create a duplicate bill on retry', async () => {
      const existingBill = {
        id: 'bill-existing-dep',
        billKind: 'DEPOSIT',
        status: 'unpaid',
        totalAmount: new Decimal(5000),
        contractId: 'agr-101',
      };
      mockTx.bill.findFirst.mockResolvedValue(existingBill);

      const result = await createDepositBillForAgreementInTx(mockTx, {
        dormitoryId: 'dorm-1',
        roomId: 'room-1',
        agreementType: 'MONTHLY',
        contractId: 'agr-101',
        startDate: new Date('2026-08-01T00:00:00.000Z'),
        depositAmount: 5000,
        depositDeclaredStatus: 'UNPAID',
      });

      expect(result).toBe(existingBill);
      expect(mockTx.bill.create).not.toHaveBeenCalled();
      expect(mockTx.payment.create).not.toHaveBeenCalled();
    });

    it('resolves deposit billing cycle from agreement start date (future reservation belongs to future cycle)', async () => {
      // Agreement starting in September 2026
      const septStart = new Date('2026-09-01T00:00:00.000Z');
      mockTx.billingCycle.findFirst.mockResolvedValue({
        id: 'cycle-2026-09',
        cycleCode: '2026-09',
        periodStart: septStart,
        periodEnd: new Date('2026-09-30T23:59:59.999Z'),
      });

      await createDepositBillForAgreementInTx(mockTx, {
        dormitoryId: 'dorm-1',
        roomId: 'room-1',
        agreementType: 'MONTHLY',
        contractId: 'agr-future-sept',
        startDate: septStart,
        depositAmount: 4800,
        depositDeclaredStatus: 'UNPAID',
      });

      const billCreateArg = mockTx.bill.create.mock.calls[0][0].data;
      expect(billCreateArg.billingCycleId).toBe('cycle-2026-09');
    });

    it('creates only ONE deposit bill for TERM agreement regardless of installments count', async () => {
      mockTx.billingCycle.findFirst.mockResolvedValue({
        id: 'cycle-2026-08',
        cycleCode: '2026-08',
        periodStart: new Date('2026-08-01T00:00:00.000Z'),
        periodEnd: new Date('2026-08-31T23:59:59.999Z'),
      });

      const result = await createDepositBillForAgreementInTx(mockTx, {
        dormitoryId: 'dorm-1',
        roomId: 'room-term-1',
        tenantId: 'tenant-term-1',
        agreementType: 'TERM',
        provisionalRentalTermId: 'term-agr-555',
        startDate: new Date('2026-08-01T00:00:00.000Z'),
        depositAmount: 10000,
        depositDeclaredStatus: 'PAID',
      });

      expect(result).toBeDefined();
      expect(mockTx.bill.create).toHaveBeenCalledTimes(1);
      const billData = mockTx.bill.create.mock.calls[0][0].data;
      expect(billData.items.create.length).toBe(1);
      expect(billData.items.create[0].amount).toEqual(new Decimal(10000));
    });
  });
});
