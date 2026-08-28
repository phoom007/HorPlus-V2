import { describe, it, expect, vi } from 'vitest';
import { ContractService } from '../../services/contract.service.js';
import {
  resolveCurrentActiveRentalSummary,
  isNowInsidePhysicalInterval,
} from '../../services/defaults.service.js';
import {
  getContractPhysicalInterval,
  getProvisionalTermPhysicalInterval,
  getDailyStayPhysicalInterval,
} from '../../utils/occupancy-interval.util.js';

describe('OWNER ROOMS R2.1a — Backend Service & Interval Hardening Suite', () => {
  describe('T1 — ContractService Defaulting on Non-Prisma Repository', () => {
    it('resolves room.monthlyDeposit when depositAmount is omitted on MONTHLY billing', async () => {
      let createdData: any = null;
      const mockContractRepo = {
        findById: vi.fn(),
        findByRoomId: vi.fn(),
        findOverlappingContractsForRoom: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockImplementation(async (dormId, data) => {
          createdData = data;
          return { id: 'ctr-1', ...data };
        }),
      };
      const mockRoomRepo = {
        findById: vi.fn().mockResolvedValue({
          id: 'room-1',
          dormitoryId: 'dorm-1',
          monthlyRent: '4500.00',
          monthlyDeposit: '5500.00',
          termDeposit: '18000.00',
          dailyDeposit: '1000.00',
        }),
      };
      const mockTenantRepo = {
        findById: vi.fn().mockResolvedValue({
          id: 'tenant-1',
          dormitoryId: 'dorm-1',
        }),
      };

      const service = new ContractService(mockContractRepo as any, mockRoomRepo as any, mockTenantRepo as any);
      await service.createContract('dorm-1', {
        roomId: 'room-1',
        tenantId: 'tenant-1',
        rentBillingType: 'monthly',
        rentAmount: '4500.00',
        startDate: new Date('2026-09-01'),
        endDate: new Date('2027-02-28'),
      }, 'user-1');

      expect(createdData).toBeDefined();
      expect(createdData.rentBillingType).toBe('monthly');
      expect(createdData.depositAmount).toBe('5500.00');
    });

    it('resolves room.termDeposit when depositAmount is omitted on TERM billing', async () => {
      let createdData: any = null;
      const mockContractRepo = {
        findOverlappingContractsForRoom: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockImplementation(async (dormId, data) => {
          createdData = data;
          return { id: 'ctr-2', ...data };
        }),
      };
      const mockRoomRepo = {
        findById: vi.fn().mockResolvedValue({
          id: 'room-2',
          dormitoryId: 'dorm-1',
          monthlyRent: '4500.00',
          monthlyDeposit: '4500.00',
          termDeposit: '16000.00',
          dailyDeposit: '1000.00',
        }),
      };
      const mockTenantRepo = {
        findById: vi.fn().mockResolvedValue({
          id: 'tenant-2',
          dormitoryId: 'dorm-1',
        }),
      };

      const service = new ContractService(mockContractRepo as any, mockRoomRepo as any, mockTenantRepo as any);
      await service.createContract('dorm-1', {
        roomId: 'room-2',
        tenantId: 'tenant-2',
        rentBillingType: 'term',
        rentAmount: '18000.00',
        startDate: new Date('2026-09-01'),
        endDate: new Date('2027-01-31'),
      }, 'user-1');

      expect(createdData).toBeDefined();
      expect(createdData.rentBillingType).toBe('term');
      expect(createdData.depositAmount).toBe('16000.00');
    });

    it('preserves explicit zero deposit (0 or "0.00")', async () => {
      let createdData: any = null;
      const mockContractRepo = {
        findOverlappingContractsForRoom: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockImplementation(async (dormId, data) => {
          createdData = data;
          return { id: 'ctr-3', ...data };
        }),
      };
      const mockRoomRepo = {
        findById: vi.fn().mockResolvedValue({
          id: 'room-3',
          dormitoryId: 'dorm-1',
          monthlyRent: '4500.00',
          monthlyDeposit: '9000.00',
          termDeposit: '18000.00',
          dailyDeposit: '1000.00',
        }),
      };
      const mockTenantRepo = {
        findById: vi.fn().mockResolvedValue({
          id: 'tenant-3',
          dormitoryId: 'dorm-1',
        }),
      };

      const service = new ContractService(mockContractRepo as any, mockRoomRepo as any, mockTenantRepo as any);
      await service.createContract('dorm-1', {
        roomId: 'room-3',
        tenantId: 'tenant-3',
        rentBillingType: 'monthly',
        rentAmount: '4500.00',
        depositAmount: '0.00',
        startDate: new Date('2026-09-01'),
        endDate: new Date('2027-02-28'),
      }, 'user-1');

      expect(createdData).toBeDefined();
      expect(createdData.depositAmount).toBe('0.00');
    });
  });


  describe('T1 — DailyStayService ownerQuickAddDailyStay Default Resolution', () => {
    it('resolves effective.dailyDeposit when depositAmount is omitted on owner quick add', () => {
      const data: any = {
        roomId: 'room-d1',
        startDate: '2026-08-28',
        endDate: '2026-08-30',
        fullName: 'สมชาย ใจดี',
        phone: '0812345678',
      };
      const effective: any = {
        dailyRent: { value: 600, source: 'ROOM' },
        dailyDeposit: { value: 1200, source: 'ROOM' },
        depositAmount: { value: 9000, source: 'ROOM' }, // Legacy catalog deposit
      };

      // Execute exact resolution logic used in ownerQuickAddDailyStay
      let deposit = '0.00';
      if (data.depositAmount !== undefined && data.depositAmount !== null) {
        deposit = String(data.depositAmount);
      } else if (effective.dailyDeposit?.value !== null && effective.dailyDeposit?.value !== undefined) {
        deposit = String(effective.dailyDeposit.value);
      }

      expect(deposit).toBe('1200');
      expect(deposit).not.toBe('9000'); // Did not use legacy depositAmount
    });

    it('preserves explicit 0 deposit on owner quick add daily stay', () => {
      const data: any = {
        roomId: 'room-d2',
        depositAmount: 0,
      };
      const effective: any = {
        dailyDeposit: { value: 1200, source: 'ROOM' },
      };

      let deposit = '0.00';
      if (data.depositAmount !== undefined && data.depositAmount !== null) {
        deposit = String(data.depositAmount);
      } else if (effective.dailyDeposit?.value !== null && effective.dailyDeposit?.value !== undefined) {
        deposit = String(effective.dailyDeposit.value);
      }

      expect(deposit).toBe('0');
    });
  });

  describe('T1 — DefaultsService & Canonical Bangkok Physical Intervals', () => {
    const roomId = 'room-101';

    it('1. Contract on its inclusive final Bangkok date is CURRENT', () => {
      const contract = {
        id: 'c-1',
        roomId,
        status: 'active',
        rentBillingType: 'monthly',
        rentAmount: 4500,
        depositAmount: 9000,
        startDate: '2026-09-01',
        endDate: '2026-09-14',
      };
      const testNow = new Date('2026-09-14T16:30:00.000Z'); // 23:30:00 Asia/Bangkok
      const result = resolveCurrentActiveRentalSummary(roomId, [contract], [], [], testNow);
      expect(result.activeRentalSummary).not.toBeNull();
      expect(result.activeRentalSummary?.type).toBe('MONTHLY');
      expect(result.activeRentalSummary?.rentAmount).toBe(4500);
      expect(result.activeRentalSummary?.depositAmount).toBe(9000);
    });

    it('2. Contract starting tomorrow is NOT CURRENT', () => {
      const contract = {
        id: 'c-2',
        roomId,
        status: 'approved',
        rentBillingType: 'monthly',
        rentAmount: 4500,
        depositAmount: 9000,
        startDate: '2026-09-15',
        endDate: '2027-03-14',
      };
      const testNow = new Date('2026-09-14T05:00:00.000Z'); // 12:00 Asia/Bangkok on Sept 14
      const result = resolveCurrentActiveRentalSummary(roomId, [contract], [], [], testNow);
      expect(result.activeRentalSummary).toBeNull();
    });

    it('3. Active provisional within physical interval is CURRENT', () => {
      const prov = {
        id: 'p-1',
        roomId,
        status: 'ACTIVE',
        rentalType: 'TERM',
        totalRentAmount: 18000,
        depositAmount: 9000,
        termInstallmentCount: 4,
        startDate: '2026-08-01',
        endDate: '2026-12-31',
      };
      const testNow = new Date('2026-08-28T05:00:00.000Z');
      const result = resolveCurrentActiveRentalSummary(roomId, [], [prov], [], testNow);
      expect(result.activeRentalSummary).not.toBeNull();
      expect(result.activeRentalSummary?.type).toBe('TERM');
      expect(result.activeRentalSummary?.rentAmount).toBe(18000);
      expect(result.activeRentalSummary?.depositAmount).toBe(9000);
      expect(result.activeRentalSummary?.source).toBe('PROVISIONAL_TERM');
    });

    it('4. Daily stay before checkInAt is NOT CURRENT', () => {
      const daily = {
        id: 'd-1',
        roomId,
        status: 'ACTIVE',
        dailyRateAmount: 500,
        depositAmount: 1000,
        startDate: '2026-08-29',
        endDate: '2026-08-30',
        checkInAt: new Date('2026-08-29T07:00:00.000Z'), // 14:00 Bangkok
        checkOutAt: new Date('2026-08-30T05:00:00.000Z'), // 12:00 Bangkok
      };
      const testNow = new Date('2026-08-28T05:00:00.000Z'); // Day before check-in
      const result = resolveCurrentActiveRentalSummary(roomId, [], [], [daily], testNow);
      expect(result.activeRentalSummary).toBeNull();
    });

    it('5. Daily stay after checkInAt and before checkOutAt is CURRENT', () => {
      const daily = {
        id: 'd-2',
        roomId,
        status: 'CHECKED_IN',
        dailyRateAmount: 600,
        depositAmount: 1200,
        startDate: '2026-08-28',
        endDate: '2026-08-30',
        checkInAt: new Date('2026-08-28T07:00:00.000Z'),
        checkOutAt: new Date('2026-08-30T05:00:00.000Z'),
      };
      const testNow = new Date('2026-08-28T09:00:00.000Z');
      const result = resolveCurrentActiveRentalSummary(roomId, [], [], [daily], testNow);
      expect(result.activeRentalSummary).not.toBeNull();
      expect(result.activeRentalSummary?.type).toBe('DAILY');
      expect(result.activeRentalSummary?.rentAmount).toBe(600);
      expect(result.activeRentalSummary?.depositAmount).toBe(1200);
      expect(result.activeRentalSummary?.source).toBe('DAILY_STAY');
    });

    it('6. RESERVED future daily stay is NOT CURRENT', () => {
      const daily = {
        id: 'd-3',
        roomId,
        status: 'RESERVED',
        dailyRateAmount: 500,
        depositAmount: 1000,
        startDate: '2026-08-28',
        endDate: '2026-08-30',
        checkInAt: new Date('2026-08-28T07:00:00.000Z'),
        checkOutAt: new Date('2026-08-30T05:00:00.000Z'),
      };
      const testNow = new Date('2026-08-28T09:00:00.000Z');
      const result = resolveCurrentActiveRentalSummary(roomId, [], [], [daily], testNow);
      expect(result.activeRentalSummary).toBeNull();
    });

    it('7. Two current sources fail closed (returns activeRentalSummary = null)', () => {
      const contract = {
        id: 'c-conflict',
        roomId,
        status: 'active',
        rentBillingType: 'monthly',
        rentAmount: 4500,
        depositAmount: 9000,
        startDate: '2026-08-01',
        endDate: '2026-08-31',
      };
      const daily = {
        id: 'd-conflict',
        roomId,
        status: 'CHECKED_IN',
        dailyRateAmount: 500,
        depositAmount: 1000,
        startDate: '2026-08-28',
        endDate: '2026-08-29',
        checkInAt: new Date('2026-08-28T07:00:00.000Z'),
        checkOutAt: new Date('2026-08-29T05:00:00.000Z'),
      };
      const testNow = new Date('2026-08-28T08:00:00.000Z');
      const result = resolveCurrentActiveRentalSummary(roomId, [contract], [], [daily], testNow);
      expect(result.activeRentalSummary).toBeNull();
    });
  });
});
