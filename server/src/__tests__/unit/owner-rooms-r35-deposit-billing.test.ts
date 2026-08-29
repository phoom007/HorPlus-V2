import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDepositBillForAgreementInTx, generateNextBillNumberInTx } from '../../utils/deposit-billing.util.js';
import { Decimal } from '@prisma/client/runtime/library.js';

describe('OWNER ROOMS R3.5a — Canonical Deposit Billing & Lifecycle Suite', () => {
  let mockTx: any;
  let mockBillDb: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockBillDb = {
      id: 'bill-deposit-001',
      dormitoryId: 'dorm-1',
      billingCycleId: 'cycle-2026-08',
      roomId: 'room-2',
      tenantId: 'tenant-2',
      provisionalRentalTermId: 'agr-term-202',
      billKind: 'DEPOSIT',
      billNumber: 'INV-2026-08-0001',
      status: 'unpaid',
      subtotal: new Decimal(9000),
      totalAmount: new Decimal(9000),
      paidAmount: new Decimal(0),
      outstandingAmount: new Decimal(9000),
      items: [{ id: 'bi-1', amount: new Decimal(9000), type: 'deposit' }],
      dormitory: { name: 'หอพัก A', taxId: null, address: null, phone: null },
      tenant: { name: 'สมศักดิ์' },
      room: { roomNumber: '101' },
    };

    mockTx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      bill: {
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
          return mockBillDb;
        }),
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockImplementation(async ({ data }: any) => {
          mockBillDb = {
            id: 'bill-deposit-001',
            ...data,
            items: data.items?.create || [{ id: 'bi-1', amount: data.totalAmount, type: 'deposit' }],
            dormitory: { name: 'หอพัก A' },
            tenant: { name: 'สมศักดิ์' },
            room: { roomNumber: '101' },
          };
          return mockBillDb;
        }),
        update: vi.fn().mockImplementation(async ({ where, data }: any) => {
          mockBillDb = { ...mockBillDb, ...data };
          return mockBillDb;
        }),
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
        findUnique: vi.fn().mockResolvedValue({
          id: 'payment-deposit-001',
          method: 'CASH',
          paymentDate: new Date(),
          reviewedAt: new Date(),
        }),
      },
      paymentStatusHistory: {
        create: vi.fn().mockResolvedValue({ id: 'psh-1' }),
      },
      billStatusHistory: {
        create: vi.fn().mockResolvedValue({ id: 'bsh-1' }),
      },
      receiptSequence: {
        upsert: vi.fn().mockResolvedValue({ lastValue: 1 }),
      },
      receipt: {
        create: vi.fn().mockImplementation(async ({ data }: any) => ({
          id: 'receipt-001',
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

    it('throws error when agreement identity invariant (contractId XOR provisionalRentalTermId) is violated', async () => {
      // Both missing
      await expect(
        createDepositBillForAgreementInTx(mockTx, {
          dormitoryId: 'dorm-1',
          roomId: 'room-1',
          agreementType: 'MONTHLY',
          startDate: new Date('2026-08-01T00:00:00.000Z'),
          depositAmount: 5000,
          depositDeclaredStatus: 'UNPAID',
        })
      ).rejects.toThrow('createDepositBillForAgreementInTx requires exactly one agreement identity');

      // Both present
      await expect(
        createDepositBillForAgreementInTx(mockTx, {
          dormitoryId: 'dorm-1',
          roomId: 'room-1',
          agreementType: 'MONTHLY',
          contractId: 'ctr-1',
          provisionalRentalTermId: 'prt-1',
          startDate: new Date('2026-08-01T00:00:00.000Z'),
          depositAmount: 5000,
          depositDeclaredStatus: 'UNPAID',
        })
      ).rejects.toThrow('createDepositBillForAgreementInTx requires exactly one agreement identity');
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

    it('settles through canonical recordCashPaymentInTx with Payment, Histories, and Receipt when depositDeclaredStatus is PAID', async () => {
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
      expect(mockTx.bill.update).toHaveBeenCalledTimes(1);

      // Settle update on Bill
      const billUpdateArg = mockTx.bill.update.mock.calls[0][0].data;
      expect(billUpdateArg.status).toBe('PAID');
      expect(billUpdateArg.paidAmount).toEqual(new Decimal(9000));
      expect(billUpdateArg.outstandingAmount).toEqual(new Decimal(0));
      expect(billUpdateArg.paidAt).toBeInstanceOf(Date);

      // Canonical CASH Payment
      expect(mockTx.payment.create).toHaveBeenCalledTimes(1);
      const paymentArg = mockTx.payment.create.mock.calls[0][0].data;
      expect(paymentArg.billId).toBe('bill-deposit-001');
      expect(paymentArg.method).toBe('CASH');
      expect(paymentArg.status).toBe('APPROVED');
      expect(paymentArg.amount).toEqual(new Decimal(9000));
      expect(paymentArg.reviewedByUserId).toBe('00000000-0000-0000-0000-000000000001');

      // Canonical PaymentStatusHistory
      expect(mockTx.paymentStatusHistory.create).toHaveBeenCalledTimes(1);
      const pshArg = mockTx.paymentStatusHistory.create.mock.calls[0][0].data;
      expect(pshArg.toStatus).toBe('APPROVED');

      // Canonical BillStatusHistory
      expect(mockTx.billStatusHistory.create).toHaveBeenCalledTimes(1);
      const bshArg = mockTx.billStatusHistory.create.mock.calls[0][0].data;
      expect(bshArg.toStatus).toBe('PAID');

      // Canonical Receipt
      expect(mockTx.receipt.create).toHaveBeenCalledTimes(1);
      const receiptArg = mockTx.receipt.create.mock.calls[0][0].data;
      expect(receiptArg.snapshotData.total).toBe('9000.00');
      expect(receiptArg.snapshotData.discount).toBe('0.00');
      expect(receiptArg.receiptNumber).toMatch(/^RC-/);
    });
  });

  describe('2. Idempotency, Start-Cycle Resolution & Bill Number Allocator', () => {
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

    it('throws DEPOSIT_BILLING_CYCLE_NOT_FOUND when exact start-date billing cycle does not exist (no fallback)', async () => {
      // Missing start-cycle in September 2026
      mockTx.billingCycle.findFirst.mockResolvedValue(null);

      await expect(
        createDepositBillForAgreementInTx(mockTx, {
          dormitoryId: 'dorm-1',
          roomId: 'room-1',
          agreementType: 'MONTHLY',
          contractId: 'agr-future-sept',
          startDate: new Date('2026-09-01T00:00:00.000Z'),
          depositAmount: 4800,
          depositDeclaredStatus: 'UNPAID',
        })
      ).rejects.toMatchObject({
        code: 'DEPOSIT_BILLING_CYCLE_NOT_FOUND',
        statusCode: 409,
      });

      expect(mockTx.bill.create).not.toHaveBeenCalled();
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
        depositDeclaredStatus: 'UNPAID',
      });

      expect(result).toBeDefined();
      expect(mockTx.bill.create).toHaveBeenCalledTimes(1);
      const billData = mockTx.bill.create.mock.calls[0][0].data;
      expect(billData.items.create.length).toBe(1);
      expect(billData.items.create[0].amount).toEqual(new Decimal(10000));
    });

    it('generates sequential bill numbers and locks on dormitory/cycle scope', async () => {
      mockTx.bill.findFirst.mockResolvedValueOnce({ billNumber: 'INV-2026-08-0042' });

      const num = await generateNextBillNumberInTx(mockTx, 'dorm-1', '2026-08');
      expect(num).toBe('INV-2026-08-0043');
      expect(mockTx.$executeRaw).toHaveBeenCalled();
    });
  });
});
