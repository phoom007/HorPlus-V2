/**
 * @license Apache-2.0
 * Round 2 Phase C: Recurring Rent Bill Production, Pre-Generation & Idempotency Tests
 * Directly tests production BillingService logic with mocked repositories
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import { BillingService } from '../../services/billing.service.js';
import { subscriptionEntitlementService } from '../../services/subscription-entitlement.service.js';
import { billingOrchestrationService } from '../../services/billing-orchestration.service.js';
import { billingCycleService } from '../../services/billing-cycle.service.js';
import { isBillVisibleToTenant } from '../../utils/tenant-visibility.util.js';
import * as prismaModule from '../../db/prisma.js';

describe('Round 2 Phase C: Recurring Rent Generation & Next-Cycle Pre-Generation', () => {
  const DORM_ID = '11111111-1111-4111-8111-111111111111';
  const ROOM_ID = '22222222-2222-4222-8222-222222222222';
  const TENANT_ID = '33333333-3333-4333-8333-333333333333';
  const CYCLE_SEP_ID = '44444444-4444-4444-8444-444444444444';
  const CYCLE_OCT_ID = '55555555-5555-4555-8555-555555555555';
  const CYCLE_NOV_ID = '66666666-6666-4666-8666-666666666666';

  let billingService: BillingService;
  let mockBillRepo: any;
  let mockBillingCycleRepo: any;
  let mockMeterRepo: any;
  let mockContractRepo: any;
  let mockRoomRepo: any;
  let mockTenantRepo: any;
  let mockPrisma: any;

  beforeEach(() => {
    vi.spyOn(subscriptionEntitlementService, 'assertRoomOperationalEntitlement').mockResolvedValue(undefined as any);
    vi.spyOn(subscriptionEntitlementService, 'resolveOperationalRoomEntitlementSet').mockResolvedValue({
      operationalRoomIds: new Set([ROOM_ID]),
      lockedRoomIds: new Set(),
      dormitoryStatus: 'active',
      planCode: 'PRO',
      roomLimit: 100,
      totalRooms: 1,
    } as any);
    vi.spyOn(billingOrchestrationService, 'resolveCyclePeopleCount').mockResolvedValue(1);
    vi.spyOn(billingCycleService, 'ensureRollingBillingCycles').mockResolvedValue([]);

    mockPrisma = {
      dormitory: {
        findMany: vi.fn().mockResolvedValue([{ id: DORM_ID }]),
      },
      billingCycle: {
        findMany: vi.fn().mockImplementation(async ({ where }) => {
          const lte = where.cycleCode?.lte;
          const allCycles = [
            { id: CYCLE_SEP_ID, dormitoryId: DORM_ID, cycleCode: '2026-09', periodStart: new Date('2026-09-01T00:00:00.000Z') },
            { id: CYCLE_OCT_ID, dormitoryId: DORM_ID, cycleCode: '2026-10', periodStart: new Date('2026-10-01T00:00:00.000Z') },
            { id: CYCLE_NOV_ID, dormitoryId: DORM_ID, cycleCode: '2026-11', periodStart: new Date('2026-11-01T00:00:00.000Z') },
          ];
          if (lte) {
            return allCycles.filter((c) => c.cycleCode <= lte);
          }
          return allCycles;
        }),
      },
      dormitoryBillingSettings: {
        findUnique: vi.fn().mockResolvedValue({ dueDay: 5 }),
      },
      provisionalRentalTerm: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      contractSnapshot: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      roomBillingCycleSnapshot: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      bill: {
        findFirst: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(0),
      },
    };
    vi.spyOn(prismaModule, 'getPrismaClient').mockReturnValue(mockPrisma as any);

    mockBillRepo = {
      executeRawLock: vi.fn().mockResolvedValue(undefined),
      withTransaction: vi.fn().mockImplementation(async (cb) => cb(mockPrisma)),
      findByCycleAndRoom: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async (dormId, billData, items) => {
        const createdBill = {
          id: `bill-${billData.billKind.toLowerCase()}-created`,
          ...billData,
        };
        const createdItems = items.map((it: any, idx: number) => ({ id: `item-${idx}`, ...it }));
        return {
          bill: createdBill,
          items: createdItems,
        };
      }),
      getBillItems: vi.fn().mockResolvedValue([]),
    };

    mockBillingCycleRepo = {
      findById: vi.fn().mockImplementation(async (id) => {
        if (id === CYCLE_OCT_ID) {
          return {
            id: CYCLE_OCT_ID,
            cycleCode: '2026-10',
            periodStart: new Date('2026-10-01T00:00:00.000Z'),
            periodEnd: new Date('2026-10-31T23:59:59.999Z'),
            billingDate: new Date('2026-10-01T00:00:00.000Z'),
            dueDate: new Date('2026-10-05T00:00:00.000Z'),
            status: 'draft',
          };
        }
        if (id === CYCLE_NOV_ID) {
          return {
            id: CYCLE_NOV_ID,
            cycleCode: '2026-11',
            periodStart: new Date('2026-11-01T00:00:00.000Z'),
            periodEnd: new Date('2026-11-30T23:59:59.999Z'),
            billingDate: new Date('2026-11-01T00:00:00.000Z'),
            dueDate: new Date('2026-11-05T00:00:00.000Z'),
            status: 'draft',
          };
        }
        return {
          id: CYCLE_SEP_ID,
          cycleCode: '2026-09',
          periodStart: new Date('2026-09-01T00:00:00.000Z'),
          periodEnd: new Date('2026-09-30T23:59:59.999Z'),
          billingDate: new Date('2026-09-01T00:00:00.000Z'),
          dueDate: new Date('2026-09-05T00:00:00.000Z'),
          status: 'draft',
        };
      }),
      findRateSnapshot: vi.fn().mockResolvedValue({
        id: 'snap-1',
        waterBillingType: 'fixed',
        waterRate: new Prisma.Decimal('100.00'),
        electricityBillingType: 'per_unit',
        electricityRate: new Prisma.Decimal('8.00'),
      }),
      update: vi.fn().mockResolvedValue({}),
    };

    mockMeterRepo = {
      withTransaction: vi.fn().mockImplementation(async (cb) => cb(mockPrisma)),
      executeRawLock: vi.fn().mockResolvedValue(undefined),
    };

    mockContractRepo = {
      findActiveContractsForRoom: vi.fn().mockResolvedValue([]),
    };

    mockRoomRepo = {
      findById: vi.fn().mockResolvedValue({ id: ROOM_ID, roomNumber: '101' }),
      findAll: vi.fn().mockResolvedValue({ items: [{ id: ROOM_ID }] }),
    };

    mockTenantRepo = {
      findById: vi.fn().mockResolvedValue({ id: TENANT_ID, name: 'Somchai' }),
    };

    billingService = new BillingService(
      mockBillRepo,
      mockBillingCycleRepo,
      mockMeterRepo,
      mockContractRepo,
      mockRoomRepo,
      mockTenantRepo
    );
  });

  it('1. Monthly agreement: early generation on 2026-09-15 for October cycle has billingDate=2026-10-01 and dueDate=2026-10-05', async () => {
    vi.spyOn(billingService as any, 'resolveProvisionalBillingSource').mockResolvedValue({
      id: 'prov-monthly-1',
      tenantId: TENANT_ID,
      rentalType: 'MONTHLY',
      startDate: new Date('2026-09-01'),
      durationMonths: 6,
      unitRentAmount: new Prisma.Decimal('4500.00'),
    });

    const earlyIssuanceDate = new Date('2026-09-15T10:00:00.000Z');

    const result = await billingService.generateBill(
      DORM_ID,
      {
        billingCycleId: CYCLE_OCT_ID,
        roomId: ROOM_ID,
        billKind: 'RENT',
        // Client attempt to supply invalid dates must be ignored by server authority
        billingDate: '2026-09-15',
        dueDate: '2026-09-20',
      },
      'owner-user-1',
      earlyIssuanceDate
    );

    expect(result.created).toBe(true);
    expect(result.bill.billKind).toBe('RENT');
    // billingDate must be October 1st, NOT September 15th
    expect(result.bill.billingDate.toISOString().slice(0, 10)).toBe('2026-10-01');
    // dueDate must be October 5th, NOT September 20th
    expect(result.bill.dueDate.toISOString().slice(0, 10)).toBe('2026-10-05');
    expect(Number(result.bill.totalAmount)).toBe(4500);
    expect(result.items[0].description).toBe('ค่าเช่าห้องพัก');
  });

  it('2. TERM agreement: 2-installment agreement (Sep, Oct) generates installment 1 in Sep, 2 in Oct, and Nov is excluded with NO_RENT_DUE_FOR_CYCLE', async () => {
    vi.spyOn(billingService as any, 'resolveProvisionalBillingSource').mockResolvedValue({
      id: 'prov-term-1',
      tenantId: TENANT_ID,
      rentalType: 'TERM',
      startDate: new Date('2026-09-01'),
      durationMonths: 2,
      totalRentAmount: new Prisma.Decimal('9000.00'),
      termInstallmentCount: 2,
    });

    // October generation (Installment 2)
    const octRes = await billingService.bulkGenerateBills(DORM_ID, CYCLE_OCT_ID, [ROOM_ID], 'owner-1', undefined, 'RENT');
    expect(octRes.generatedCount).toBe(1);
    expect(octRes.bills[0].billKind).toBe('RENT');
    // Generating RENT alone must NOT update cycle status to 'generated' (preserves draft status)
    expect(mockBillingCycleRepo.update).not.toHaveBeenCalled();

    // Reset bill repo call history
    mockBillRepo.create.mockClear();

    // November generation (No installment scheduled)
    const novRes = await billingService.bulkGenerateBills(DORM_ID, CYCLE_NOV_ID, [ROOM_ID], 'owner-1', undefined, 'RENT');
    expect(novRes.generatedCount).toBe(0);
    expect(novRes.excluded.length).toBe(1);
    expect(novRes.excluded[0].reason).toBe('NO_RENT_DUE_FOR_CYCLE');
    // Crucial: BillRepo.create must NOT have been called for November
    expect(mockBillRepo.create).not.toHaveBeenCalled();
  });

  it('3. Pre-existing RENT bill in cycle prevents duplicate creation and excludes with BILL_ALREADY_EXISTS', async () => {
    vi.spyOn(billingService as any, 'resolveProvisionalBillingSource').mockResolvedValue({
      id: 'prov-monthly-1',
      tenantId: TENANT_ID,
      rentalType: 'MONTHLY',
      startDate: new Date('2026-09-01'),
      durationMonths: 6,
      unitRentAmount: new Prisma.Decimal('4500.00'),
    });

    mockBillRepo.findByCycleAndRoom.mockResolvedValueOnce({
      id: 'bill-existing-rent',
      billKind: 'RENT',
      billNumber: 'BILL-202609-001',
    });

    const res = await billingService.bulkGenerateBills(DORM_ID, CYCLE_SEP_ID, [ROOM_ID], 'owner-1', undefined, 'RENT');
    expect(res.generatedCount).toBe(0);
    expect(res.excluded.length).toBe(1);
    expect(res.excluded[0].reason).toBe('BILL_ALREADY_EXISTS');
    expect(mockBillRepo.create).not.toHaveBeenCalled();
  });

  it('4. Next-Cycle Pre-Generation: on 2026-09-15, reconciler generates September (current) and October (next opened) RENT, but NOT November', async () => {
    vi.spyOn(billingService as any, 'resolveProvisionalBillingSource').mockResolvedValue({
      id: 'prov-monthly-1',
      tenantId: TENANT_ID,
      rentalType: 'MONTHLY',
      startDate: new Date('2026-09-01'),
      durationMonths: 6,
      unitRentAmount: new Prisma.Decimal('4500.00'),
    });

    const asOfSep15 = new Date('2026-09-15T09:00:00.000Z');

    const totalGenerated = await billingService.reconcileRecurringRentBillsForAllDormitories(asOfSep15);

    expect(billingCycleService.ensureRollingBillingCycles).toHaveBeenCalledWith(DORM_ID);
    // Generated Sep (1) + Oct (1) = 2 bills
    expect(totalGenerated).toBe(2);
    // November was excluded because cycleCode '2026-11' > '2026-10'
    expect(mockBillRepo.create).toHaveBeenCalledTimes(2);

    // Verify October bill has correct periodStart and is hidden from tenant until Oct 1
    const octRentBill = {
      id: 'oct-rent-pregenerated',
      billKind: 'RENT',
      billingCycle: { periodStart: new Date('2026-10-01T00:00:00.000Z') },
    };

    const sept30NightUtc = new Date('2026-09-30T16:59:59.000Z'); // 23:59:59 Bangkok
    const oct01MidnightUtc = new Date('2026-09-30T17:00:00.000Z'); // 00:00:00 Bangkok on Oct 1

    expect(isBillVisibleToTenant(octRentBill, sept30NightUtc)).toBe(false);
    expect(isBillVisibleToTenant(octRentBill, oct01MidnightUtc)).toBe(true);
  });

  it('5. Server Startup Catch-Up: starts on Oct 1 08:00 Bangkok, reconciles October cycle immediately without waiting for midnight timer', async () => {
    vi.spyOn(billingService as any, 'resolveProvisionalBillingSource').mockResolvedValue({
      id: 'prov-monthly-1',
      tenantId: TENANT_ID,
      rentalType: 'MONTHLY',
      startDate: new Date('2026-09-01'),
      durationMonths: 6,
      unitRentAmount: new Prisma.Decimal('4500.00'),
    });

    const oct01MorningUtc = new Date('2026-10-01T01:00:00.000Z'); // 08:00 Bangkok on Oct 1

    const generated = await billingService.reconcileRecurringRentBillsForAllDormitories(oct01MorningUtc);
    expect(generated).toBeGreaterThan(0);
    expect(billingCycleService.ensureRollingBillingCycles).toHaveBeenCalledWith(DORM_ID);
  });
});
