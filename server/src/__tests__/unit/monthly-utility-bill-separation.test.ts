import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InMemoryBillRepository, PrismaBillRepository, BillEntity } from '../../db/repositories/bill.repository.js';
import { MeterService } from '../../services/meter.service.js';
import * as prismaModule from '../../db/prisma.js';

vi.mock('../../db/prisma.js', () => {
  const mockPrisma = {
    room: { findMany: vi.fn() },
    contract: { findMany: vi.fn() },
    provisionalRentalTerm: { findMany: vi.fn() },
    dailyStay: { findMany: vi.fn() },
    householdMember: { groupBy: vi.fn() },
    tenantVehicle: { findMany: vi.fn() },
    tenantCoOccupant: { findMany: vi.fn() },
    bill: { findMany: vi.fn(), findFirst: vi.fn() },
    meterReading: { findMany: vi.fn() },
    roomBillingCycleSnapshot: { findMany: vi.fn() },
    meterWorkspaceRoomSnapshot: { findMany: vi.fn() },
    roomOperationalStatusChange: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return {
    getPrismaClient: () => mockPrisma,
    prisma: mockPrisma,
  };
});

describe('MUB-01 to MUB-05: Monthly Utility Bill Separation and Meter Sync', () => {
  const dormitoryId = 'dorm-test-mub';
  const billingCycleId = 'cycle-2026-09';
  const roomId = 'room-w102';

  describe('1. InMemoryBillRepository.findActiveMonthlyUtilityByRoomAndCycle', () => {
    let repo: InMemoryBillRepository;

    beforeEach(() => {
      repo = new InMemoryBillRepository();
    });

    it('returns null when only RENT or DEPOSIT bills exist', async () => {
      const rentBill: BillEntity = {
        id: 'bill-rent-1',
        dormitoryId,
        billingCycleId,
        roomId,
        billNumber: 'INV-RENT-01',
        billKind: 'RENT',
        status: 'unpaid',
        billingDate: new Date(),
        dueDate: new Date(),
        subtotal: '4.28',
        discountAmount: '0.00',
        fineAmount: '0.00',
        totalAmount: '4.28',
        paidAmount: '0.00',
        outstandingAmount: '4.28',
        currency: 'THB',
        generatedAt: new Date(),
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const depositBill: BillEntity = {
        id: 'bill-deposit-1',
        dormitoryId,
        billingCycleId,
        roomId,
        billNumber: 'INV-DEP-01',
        billKind: 'DEPOSIT',
        status: 'unpaid',
        billingDate: new Date(),
        dueDate: new Date(),
        subtotal: '2.00',
        discountAmount: '0.00',
        fineAmount: '0.00',
        totalAmount: '2.00',
        paidAmount: '0.00',
        outstandingAmount: '2.00',
        currency: 'THB',
        generatedAt: new Date(),
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (repo as any).bills.set(rentBill.id, rentBill);
      (repo as any).bills.set(depositBill.id, depositBill);

      const found = await repo.findActiveMonthlyUtilityByRoomAndCycle(dormitoryId, billingCycleId, roomId);
      expect(found).toBeNull();
    });

    it('returns the bill when MONTHLY_UTILITY, COMBINED, or LEGACY_COMBINED exists', async () => {
      const utilityBill: BillEntity = {
        id: 'bill-mu-1',
        dormitoryId,
        billingCycleId,
        roomId,
        billNumber: 'INV-MU-01',
        billKind: 'MONTHLY_UTILITY',
        status: 'unpaid',
        billingDate: new Date(),
        dueDate: new Date(),
        subtotal: '500.00',
        discountAmount: '0.00',
        fineAmount: '0.00',
        totalAmount: '500.00',
        paidAmount: '0.00',
        outstandingAmount: '500.00',
        currency: 'THB',
        generatedAt: new Date(),
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (repo as any).bills.set(utilityBill.id, utilityBill);

      const found = await repo.findActiveMonthlyUtilityByRoomAndCycle(dormitoryId, billingCycleId, roomId);
      expect(found).not.toBeNull();
      expect(found?.id).toBe('bill-mu-1');
      expect(found?.billKind).toBe('MONTHLY_UTILITY');
    });
  });

  describe('2. PrismaBillRepository.findActiveMonthlyUtilityByRoomAndCycle', () => {
    it('queries Prisma with billKind strictly restricted to MONTHLY_UTILITY, COMBINED, and LEGACY_COMBINED', async () => {
      const mockPrisma = {
        bill: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      };

      const repo = new PrismaBillRepository(mockPrisma as any);
      await repo.findActiveMonthlyUtilityByRoomAndCycle(dormitoryId, billingCycleId, roomId);

      expect(mockPrisma.bill.findFirst).toHaveBeenCalledWith({
        where: {
          dormitoryId,
          billingCycleId,
          roomId,
          billKind: { in: ['MONTHLY_UTILITY', 'COMBINED', 'LEGACY_COMBINED'] },
          status: { notIn: ['cancelled', 'void'] },
        },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('3. MeterService.getMeterBillingPreviewContext', () => {
    let meterService: MeterService;
    let mockPrisma: any;
    let mockCycleRepo: any;

    beforeEach(() => {
      vi.clearAllMocks();
      mockPrisma = (prismaModule as any).getPrismaClient();

      mockCycleRepo = {
        findById: vi.fn().mockResolvedValue({
          id: billingCycleId,
          dormitoryId,
          cycleCode: '2026-09',
          periodStart: new Date('2026-09-01T00:00:00.000Z'),
          periodEnd: new Date('2026-09-30T23:59:59.999Z'),
          status: 'OPEN',
        }),
        findRateSnapshot: vi.fn().mockResolvedValue({
          waterRate: '18.00',
          electricityRate: '7.00',
          waterBillingType: 'per_unit',
          electricityBillingType: 'per_unit',
          parkingFee: '0.00',
          commonFee: '0.00',
          garbageFee: '0.00',
        }),
      };

      const mockRoomRepo = {
        findAll: vi.fn().mockResolvedValue({
          items: [{ id: roomId, roomNumber: 'W102', dormitoryId, floor: 1, status: 'occupied' }],
        }),
      };

      meterService = new MeterService(
        {} as any,
        mockCycleRepo,
        mockRoomRepo as any,
        {} as any,
        {} as any
      );
    });

    it('evaluates monthlyUtilityBillStatus to draft when room has only RENT and DEPOSIT bills', async () => {
      mockPrisma.room.findMany.mockResolvedValue([
        {
          id: roomId,
          dormitoryId,
          roomNumber: 'W102',
          floor: 1,
          status: 'occupied',
        },
      ]);

      mockPrisma.contract.findMany.mockResolvedValue([
        {
          id: 'contract-w102',
          dormitoryId,
          roomId,
          tenantId: 'tenant-w102',
          status: 'ACTIVE',
          startDate: new Date('2026-09-01T00:00:00.000Z'),
          endDate: new Date('2027-08-31T23:59:59.999Z'),
          rentAmount: '4.28',
          depositAmount: '2.00',
          tenant: { id: 'tenant-w102', displayName: 'สมชาย', firstName: 'สมชาย', lastName: 'มีทรัพย์' },
        },
      ]);

      mockPrisma.provisionalRentalTerm.findMany.mockResolvedValue([]);
      mockPrisma.dailyStay.findMany.mockResolvedValue([]);
      mockPrisma.householdMember.groupBy.mockResolvedValue([]);
      mockPrisma.tenantVehicle.findMany.mockResolvedValue([]);
      mockPrisma.tenantCoOccupant.findMany.mockResolvedValue([]);

      mockPrisma.bill.findMany.mockResolvedValue([
        {
          id: 'bill-deposit-1',
          dormitoryId,
          billingCycleId,
          roomId,
          billKind: 'DEPOSIT',
          status: 'unpaid',
          totalAmount: '2.00',
          paidAmount: '0.00',
          outstandingAmount: '2.00',
        },
        {
          id: 'bill-rent-1',
          dormitoryId,
          billingCycleId,
          roomId,
          billKind: 'RENT',
          status: 'unpaid',
          totalAmount: '4.28',
          paidAmount: '0.00',
          outstandingAmount: '4.28',
        },
      ]);

      mockPrisma.meterReading.findMany.mockResolvedValue([]);
      mockPrisma.roomBillingCycleSnapshot.findMany.mockResolvedValue([]);
      mockPrisma.meterWorkspaceRoomSnapshot.findMany.mockResolvedValue([]);

      const result = await meterService.getMeterBillingPreviewContext(dormitoryId, billingCycleId);
      expect(result.rooms).toHaveLength(1);
      const roomCtx = result.rooms[0];

      expect(roomCtx.monthlyUtilityBillStatus).toBe('draft');
      expect(roomCtx.isMonthlyUtilityPaid).toBe(false);

      const utilityComp = roomCtx.chargeComponents?.find((c: any) => c.type === 'monthly_utility');
      expect(utilityComp).toBeDefined();
      expect(['PREVIEW', 'INVALID']).toContain(utilityComp?.status);
    });
  });

  describe('4. MeterService.toggleRoomBillSwitch', () => {
    it('issues a MONTHLY_UTILITY bill when room has an existing RENT bill instead of returning early', async () => {
      const mockBillRepo = {
        findActiveMonthlyUtilityByRoomAndCycle: vi.fn().mockResolvedValue(null),
        getBillItems: vi.fn(),
      };

      const mockTx = {
        dormitory: { findUnique: vi.fn().mockResolvedValue({ status: 'ACTIVE' }) },
        room: {
          findUnique: vi.fn().mockResolvedValue({ status: 'occupied' }),
          count: vi.fn().mockResolvedValue(1),
          findMany: vi.fn().mockResolvedValue([{ id: roomId }]),
        },
        subscriptionPlan: { findUnique: vi.fn().mockResolvedValue({ roomLimit: 10 }) },
        ownerSubscription: { findFirst: vi.fn().mockResolvedValue(null) },
      };

      const mockMeterRepo = {
        withTransaction: vi.fn().mockImplementation((cb) => cb(mockTx)),
        executeRawLock: vi.fn().mockResolvedValue(undefined),
      };

      const mockBillingService = {
        generateBill: vi.fn().mockResolvedValue({
          bill: {
            id: 'new-mu-bill-1',
            dormitoryId,
            billingCycleId,
            roomId,
            billKind: 'MONTHLY_UTILITY',
            status: 'unpaid',
          },
          items: [],
          created: true,
        }),
      };

      const meterService = new MeterService(
        mockMeterRepo as any,
        {} as any,
        {} as any,
        mockBillRepo as any,
        {} as any
      );

      (meterService as any).saveSingleRoomWorkspaceInTx = vi.fn().mockResolvedValue(undefined);

      const res = await meterService.toggleRoomBillSwitch(
        dormitoryId,
        {
          billingCycleId,
          roomId,
          action: 'issue',
        },
        'user-test-1',
        mockBillingService
      );

      expect(mockBillRepo.findActiveMonthlyUtilityByRoomAndCycle).toHaveBeenCalledWith(
        dormitoryId,
        billingCycleId,
        roomId,
        mockTx
      );

      expect(mockBillingService.generateBill).toHaveBeenCalledWith(
        dormitoryId,
        {
          billingCycleId,
          roomId,
          billKind: 'MONTHLY_UTILITY',
        },
        'user-test-1',
        undefined,
        mockTx
      );

      expect(res.action).toBe('issue');
      expect(res.created).toBe(true);
      expect(res.bill.billKind).toBe('MONTHLY_UTILITY');
    });
  });
});
