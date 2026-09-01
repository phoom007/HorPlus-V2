/**
 * @license Apache-2.0
 * Round 2 Phase C: Immediate Rent Billing & Go-Live Boundary Tests
 */
import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  createDepositBillForAgreementInTx,
  createImmediateRentBillForAgreementInTx,
} from '../../utils/deposit-billing.util.js';

describe('Round 2 Phase C: Immediate Rent Billing & Go-Live Boundary', () => {
  it('1. creates immediate first Rent Bill for Monthly agreement in matching cycle', async () => {
    let createdBill: any = null;
    const cycleSeptember = {
      id: 'cycle-sep-uuid',
      cycleCode: '2026-09',
      periodStart: new Date('2026-09-01'),
      periodEnd: new Date('2026-09-30'),
      billingDate: new Date('2026-09-01'),
      dueDate: new Date('2026-09-05'),
    };
    const mockTx = {
      billingCycle: {
        findFirst: vi.fn().mockResolvedValue(cycleSeptember),
        findMany: vi.fn().mockResolvedValue([cycleSeptember]),
      },
      bill: {
        findFirst: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockImplementation((args) => {
          createdBill = { id: 'bill-rent-1', ...args.data };
          return createdBill;
        }),
      },
      dormitoryBillingSettings: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };

    const bill = await createImmediateRentBillForAgreementInTx(mockTx, {
      dormitoryId: 'dorm-1',
      roomId: 'room-1',
      tenantId: 'tenant-1',
      provisionalRentalTermId: 'prov-1',
      agreementType: 'MONTHLY',
      startDate: '2026-09-01',
      unitRentAmount: '4500.00',
      totalRentAmount: '13500.00',
    });

    expect(bill).toBeDefined();
    expect(mockTx.bill.create).toHaveBeenCalled();
    expect(createdBill.billKind).toBe('RENT');
    expect(Number(createdBill.subtotal)).toBe(4500);
    expect(createdBill.items.create[0].description).toBe('ค่าเช่าห้องพัก (รายเดือน)');
  });

  it('2. creates immediate first Installment Rent Bill for Term agreement', async () => {
    let createdBill: any = null;
    const cycleSeptember = {
      id: 'cycle-sep-uuid',
      cycleCode: '2026-09',
      periodStart: new Date('2026-09-01'),
      periodEnd: new Date('2026-09-30'),
      billingDate: new Date('2026-09-01'),
      dueDate: new Date('2026-09-05'),
    };
    const mockTx = {
      billingCycle: {
        findFirst: vi.fn().mockResolvedValue(cycleSeptember),
        findMany: vi.fn().mockResolvedValue([cycleSeptember]),
      },
      bill: {
        findFirst: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockImplementation((args) => {
          createdBill = { id: 'bill-term-1', ...args.data };
          return createdBill;
        }),
      },
      dormitoryBillingSettings: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };

    const bill = await createImmediateRentBillForAgreementInTx(mockTx, {
      dormitoryId: 'dorm-1',
      roomId: 'room-1',
      tenantId: 'tenant-1',
      provisionalRentalTermId: 'prov-1',
      agreementType: 'TERM',
      startDate: '2026-09-01',
      unitRentAmount: '12000.00',
      totalRentAmount: '12000.00',
      termInstallmentCount: 3,
    });

    expect(bill).toBeDefined();
    expect(createdBill.billKind).toBe('RENT');
    expect(Number(createdBill.subtotal)).toBe(4000);
    expect(createdBill.items.create[0].description).toBe('ค่าเช่าห้องพัก (งวดที่ 1/3)');
  });

  it('3. attaches pre-HorPlus agreement bills to the earliest HorPlus-managed billing cycle (Go-Live Boundary)', async () => {
    const earliestCycle = {
      id: 'cycle-jul-uuid',
      cycleCode: '2026-07',
      periodStart: new Date('2026-07-01'),
      periodEnd: new Date('2026-07-31'),
      billingDate: new Date('2026-07-01'),
      dueDate: new Date('2026-07-05'),
    };

    const mockTx = {
      billingCycle: {
        findFirst: vi.fn()
          // First query: exact period containment (returns null for May)
          .mockResolvedValueOnce(null)
          // Second query: earliest cycle for dormitory (returns July)
          .mockResolvedValueOnce(earliestCycle),
      },
      bill: {
        findFirst: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockImplementation((args) => ({ id: 'bill-dep-jul', ...args.data })),
      },
      dormitoryBillingSettings: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };

    const depBill = await createDepositBillForAgreementInTx(mockTx, {
      dormitoryId: 'dorm-1',
      roomId: 'room-1',
      tenantId: 'tenant-1',
      provisionalRentalTermId: 'prov-may-1',
      agreementType: 'MONTHLY',
      startDate: '2026-05-01',
      depositAmount: '5000.00',
    });

    expect(depBill).toBeDefined();
    expect(depBill.billingCycleId).toBe('cycle-jul-uuid');
  });
});
