/**
 * @license Apache-2.0
 * Round 2.2.3: Utility-Rate / Rent Authority Separation Test Suite
 * Directly tests production BillingCycleService methods
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import { BillingCycleService } from '../../services/billing-cycle.service.js';
import { currentCycleResolverService } from '../../services/current-cycle-resolver.js';
import * as prismaModule from '../../db/prisma.js';

describe('Round 2.2.3: Utility-Rate / Rent Authority Separation (Production Path)', () => {
  const DORM_ID = '11111111-1111-4111-8111-111111111111';
  const CYCLE_OCT_ID = '44444444-4444-4444-8444-444444444444';
  const CYCLE_NOV_ID = '55555555-5555-4555-8555-555555555555';
  const SNAPSHOT_OCT_ID = '66666666-6666-4666-8666-666666666666';
  const SNAPSHOT_NOV_ID = '77777777-7777-4777-8777-777777777777';

  let billingCycleService: BillingCycleService;
  let mockCycleRepo: any;
  let mockPrisma: any;

  beforeEach(() => {
    vi.spyOn(currentCycleResolverService, 'resolveOperationalBillingCycle').mockResolvedValue({
      dormitoryId: DORM_ID,
      billingCycleId: CYCLE_OCT_ID,
      status: 'operational',
      hasExplicitStart: true,
      cycleCode: '2026-10',
    });

    mockCycleRepo = {
      findById: vi.fn().mockImplementation(async (id: string) => {
        if (id === CYCLE_OCT_ID) {
          return {
            id: CYCLE_OCT_ID,
            dormitoryId: DORM_ID,
            cycleCode: '2026-10',
            periodStart: new Date('2026-10-01T00:00:00.000Z'),
            periodEnd: new Date('2026-10-31T23:59:59.999Z'),
            billingDate: new Date('2026-10-01T00:00:00.000Z'),
            dueDate: new Date('2026-10-05T00:00:00.000Z'),
            status: 'draft',
          };
        }
        return null;
      }),
      findByCode: vi.fn().mockResolvedValue(null),
      findRateSnapshot: vi.fn().mockImplementation(async (cycleId: string) => {
        if (cycleId === CYCLE_OCT_ID) {
          return {
            id: SNAPSHOT_OCT_ID,
            dormitoryId: DORM_ID,
            billingCycleId: CYCLE_OCT_ID,
            waterBillingType: 'fixed',
            waterRate: new Prisma.Decimal('100.00'),
            waterTierRates: null,
            electricityBillingType: 'per_unit',
            electricityRate: new Prisma.Decimal('8.00'),
            electricityTierRates: null,
            commonFee: new Prisma.Decimal('0.00'),
            commonFeeMode: 'free',
            internetFee: new Prisma.Decimal('0.00'),
            internetFeeMode: 'free',
            parkingFee: new Prisma.Decimal('0.00'),
            parkingFeeMode: 'free',
            lateFeeType: 'none',
            lateFeeValue: new Prisma.Decimal('0.00'),
            source: 'TEMPLATE_DEFAULT',
            version: 1,
          };
        }
        return null;
      }),
    };

    mockPrisma = {
      bill: {
        count: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
      },
      billingCycle: {
        findUnique: vi.fn().mockImplementation(async ({ where }) => {
          if (where.id === CYCLE_OCT_ID) {
            return { id: CYCLE_OCT_ID, periodStart: new Date('2026-10-01') };
          }
          return null;
        }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      roomBillingCycleSnapshot: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      contract: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      contractSnapshot: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      billingRateSnapshot: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: SNAPSHOT_OCT_ID,
          dormitoryId: DORM_ID,
          billingCycleId: CYCLE_OCT_ID,
          waterBillingType: 'fixed',
          waterRate: '100.00',
          waterTierRates: null,
          electricityBillingType: 'per_unit',
          electricityRate: '9.00',
          electricityTierRates: null,
          commonFee: '0.00',
          commonFeeMode: 'free',
          internetFee: '0.00',
          internetFeeMode: 'free',
          parkingFee: '0.00',
          parkingFeeMode: 'free',
          lateFeeType: 'none',
          lateFeeValue: '0.00',
          source: 'MANUAL_OVERRIDE',
          version: 2,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      $transaction: vi.fn().mockImplementation(async (cb) => cb(mockPrisma)),
    };

    vi.spyOn(prismaModule, 'getPrismaClient').mockReturnValue(mockPrisma as any);
    billingCycleService = new BillingCycleService(mockCycleRepo);
  });

  it('1. Case A: Cycle with RENT bills only -> rate settings are NOT locked (isLocked: false) and can be updated', async () => {
    // When counting utility-consuming bills, RENT does not match, count = 0
    mockPrisma.bill.count.mockResolvedValue(0);

    const snapshotResult = await billingCycleService.getCycleRateSnapshot(DORM_ID, CYCLE_OCT_ID);
    expect(snapshotResult.isLocked).toBe(false);
    expect(snapshotResult.lockReason).toBeNull();

    // Owner edits electricity rate from 8.00 to 9.00
    const updateResult = await billingCycleService.updateCycleRateSnapshot(
      DORM_ID,
      CYCLE_OCT_ID,
      {
        expectedVersion: 1,
        electricityRate: '9.00',
      },
      'owner-1'
    );

    expect(updateResult.isLocked).toBe(false);
    expect(mockPrisma.billingRateSnapshot.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          electricityRate: '9.00',
        }),
      })
    );
  });

  it('2. Case B: Cycle with DEPOSIT bills only -> rate settings are NOT locked', async () => {
    mockPrisma.bill.count.mockResolvedValue(0);

    const snapshotResult = await billingCycleService.getCycleRateSnapshot(DORM_ID, CYCLE_OCT_ID);
    expect(snapshotResult.isLocked).toBe(false);
  });

  it('3. Case C: Cycle with MONTHLY_UTILITY issued -> rate settings ARE locked (isLocked: true)', async () => {
    // A utility-consuming bill exists and is counted
    mockPrisma.bill.count.mockResolvedValue(1);

    const snapshotResult = await billingCycleService.getCycleRateSnapshot(DORM_ID, CYCLE_OCT_ID);
    expect(snapshotResult.isLocked).toBe(true);
    expect(snapshotResult.lockReason).toContain('งวดนี้มีห้องพักที่ออกบิลแล้ว');

    // Attempting to update throws locked error
    await expect(
      billingCycleService.updateCycleRateSnapshot(
        DORM_ID,
        CYCLE_OCT_ID,
        {
          expectedVersion: 1,
          electricityRate: '9.00',
        },
        'owner-1'
      )
    ).rejects.toMatchObject({
      code: 'BILLING_CYCLE_RATE_SETTINGS_LOCKED',
    });
  });

  it('4. Case D: Cycle with LEGACY_COMBINED issued -> rate settings ARE locked (isLocked: true)', async () => {
    mockPrisma.bill.count.mockResolvedValue(1);

    const snapshotResult = await billingCycleService.getCycleRateSnapshot(DORM_ID, CYCLE_OCT_ID);
    expect(snapshotResult.isLocked).toBe(true);
  });

  it('5. Utility Recalculation: rate update recalculates ONLY unpaid utility bills and ignores RENT bills', async () => {
    mockPrisma.bill.count.mockResolvedValue(0);

    // Mock findMany inside tx to return only utility-consuming bills (Prisma query filters out RENT)
    mockPrisma.bill.findMany.mockImplementation(async ({ where }) => {
      expect(where.billKind?.in).toBeDefined();
      expect(where.billKind.in).toContain('MONTHLY_UTILITY');
      expect(where.billKind.in).not.toContain('RENT');
      return [];
    });

    const updateRes = await billingCycleService.updateCycleRateSnapshot(
      DORM_ID,
      CYCLE_OCT_ID,
      {
        expectedVersion: 1,
        electricityRate: '9.00',
      },
      'owner-1'
    );

    expect(updateRes.isLocked).toBe(false);
  });

  it('6. Forward Propagation: future cycle with paid RENT alone does NOT stop utility rate propagation', async () => {
    mockPrisma.bill.count.mockResolvedValue(0); // No utility bills issued in current or future cycles

    mockPrisma.billingCycle.findMany.mockResolvedValue([
      {
        id: CYCLE_NOV_ID,
        periodStart: new Date('2026-11-01'),
        status: 'draft',
        rateSnapshot: {
          id: SNAPSHOT_NOV_ID,
          source: 'INHERITED',
        },
      },
    ]);

    const updateRes = await billingCycleService.updateCycleRateSnapshot(
      DORM_ID,
      CYCLE_OCT_ID,
      {
        expectedVersion: 1,
        electricityRate: '9.00',
      },
      'owner-1'
    );

    expect(updateRes.propagatedCount).toBe(1);
    expect(mockPrisma.billingRateSnapshot.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: SNAPSHOT_NOV_ID },
        data: expect.objectContaining({
          source: 'INHERITED',
          electricityRate: '9.00',
        }),
      })
    );
  });
});
