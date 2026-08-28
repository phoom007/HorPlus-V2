import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RoomService } from '../../services/room.service.js';
import { currentCycleResolverService } from '../../services/current-cycle-resolver.js';
import { subscriptionEntitlementService } from '../../services/subscription-entitlement.service.js';

const { mockPrisma, state } = vi.hoisted(() => {
  const state = {
    activeContractResult: null as any,
    activeProvResult: null as any,
    activeDailyResult: null as any,
    futureContractResult: null as any,
    futureProvResult: null as any,
    futureDailyResult: null as any,
    currentRoomStatus: 'vacant',
    currentTenantId: null as string | null,
  };
  const mockPrisma: any = {
    $transaction: vi.fn((cb) => cb(mockPrisma)),
    room: {
      findFirst: vi.fn(() =>
        Promise.resolve({
          id: 'b2222222-2222-4222-8222-222222222222',
          dormitoryId: 'a1111111-1111-4111-8111-111111111111',
          roomNumber: '101',
          normalizedRoomNumber: '101',
          status: state.currentRoomStatus,
          currentTenantId: state.currentTenantId,
          version: 1,
        })
      ),
      findUnique: vi.fn(() =>
        Promise.resolve({
          id: 'b2222222-2222-4222-8222-222222222222',
          dormitoryId: 'a1111111-1111-4111-8111-111111111111',
          roomNumber: '101',
          status: 'maintenance',
          version: 2,
        })
      ),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    contract: {
      findFirst: vi.fn(({ where }) => {
        if (where?.startDate?.gt) {
          return Promise.resolve(state.futureContractResult);
        }
        return Promise.resolve(state.activeContractResult);
      }),
    },
    provisionalRentalTerm: {
      findFirst: vi.fn(({ where }) => {
        if (where?.startDate?.lte) {
          return Promise.resolve(state.activeProvResult);
        }
        return Promise.resolve(state.futureProvResult);
      }),
    },
    dailyStay: {
      findFirst: vi.fn(({ where }) => {
        if (where?.OR || where?.checkInDate?.gt) {
          return Promise.resolve(state.futureDailyResult);
        }
        return Promise.resolve(state.activeDailyResult);
      }),
    },
    roomOperationalStatusChange: {
      upsert: vi.fn().mockResolvedValue({ id: 'sc-1' }),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({ id: 'log-1' }),
    },
  };
  return { mockPrisma, state };
});

vi.mock('../../db/prisma.js', () => ({
  getPrismaClient: () => mockPrisma,
  prisma: mockPrisma,
}));

describe('OWNER ROOMS R3.4 — Decision F1: Maintenance Occupancy & Reservation Guard', () => {
  const dormitoryId = 'a1111111-1111-4111-8111-111111111111';
  const roomId = 'b2222222-2222-4222-8222-222222222222';
  const tenantId = 't3333333-3333-4333-8333-333333333333';

  let roomService: RoomService;
  let mockRoomRepo: any;
  let mockBuildingRepo: any;

  beforeEach(() => {
    vi.clearAllMocks();
    state.activeContractResult = null;
    state.activeProvResult = null;
    state.activeDailyResult = null;
    state.futureContractResult = null;
    state.futureProvResult = null;
    state.futureDailyResult = null;
    state.currentRoomStatus = 'vacant';
    state.currentTenantId = null;

    vi.spyOn(subscriptionEntitlementService, 'assertDormitoryWritable').mockResolvedValue(undefined as any);
    vi.spyOn(currentCycleResolverService, 'resolveOperationalBillingCycle').mockResolvedValue({
      billingCycleId: 'cycle-2026-08',
      cycleCode: '2026-08',
      isDefault: false,
    } as any);

    mockRoomRepo = {
      findById: vi.fn(),
      update: vi.fn(),
    };
    mockBuildingRepo = {
      findAll: vi.fn().mockResolvedValue({ items: [] }),
    };

    roomService = new RoomService(mockRoomRepo, mockBuildingRepo, {} as any);
  });

  it('1. Active Contract occupant blocks switching room to maintenance', async () => {
    state.activeContractResult = {
      id: 'ctr-1',
      roomId,
      dormitoryId,
      status: 'active',
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
    };

    await expect(
      roomService.updateRoom({
        roomId,
        dormitoryId,
        changes: { status: 'maintenance' },
        expectedVersion: 1,
      }, mockPrisma)
    ).rejects.toThrow('ไม่สามารถปิดปรับปรุงได้ เนื่องจากห้องนี้มีผู้เช่าพักอยู่');
  });

  it('2. Active Provisional occupant blocks switching room to maintenance', async () => {
    state.activeProvResult = {
      id: 'prov-1',
      roomId,
      dormitoryId,
      status: 'ACTIVE',
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
    };

    await expect(
      roomService.updateRoom({
        roomId,
        dormitoryId,
        changes: { status: 'maintenance' },
        expectedVersion: 1,
      }, mockPrisma)
    ).rejects.toThrow('ไม่สามารถปิดปรับปรุงได้ เนื่องจากห้องนี้มีผู้เช่าพักอยู่');
  });

  it('3. Active DailyStay occupant blocks switching room to maintenance', async () => {
    state.activeDailyResult = {
      id: 'daily-1',
      roomId,
      dormitoryId,
      status: 'OCCUPIED',
      checkInDate: new Date('2026-08-20'),
      checkOutDate: new Date('2026-08-30'),
    };

    await expect(
      roomService.updateRoom({
        roomId,
        dormitoryId,
        changes: { status: 'maintenance' },
        expectedVersion: 1,
      }, mockPrisma)
    ).rejects.toThrow('ไม่สามารถปิดปรับปรุงได้ เนื่องจากห้องนี้มีผู้เช่าพักอยู่');
  });

  it('4. Future Contract reservation blocks switching room to maintenance', async () => {
    state.futureContractResult = {
      id: 'future-ctr-1',
      roomId,
      dormitoryId,
      status: 'reserved',
      startDate: new Date('2026-09-01'),
      endDate: new Date('2027-02-28'),
    };

    await expect(
      roomService.updateRoom({
        roomId,
        dormitoryId,
        changes: { status: 'maintenance' },
        expectedVersion: 1,
      }, mockPrisma)
    ).rejects.toThrow('ไม่สามารถปิดปรับปรุงได้ เนื่องจากห้องนี้มีการจองล่วงหน้า');
  });

  it('5. Future Provisional reservation blocks switching room to maintenance', async () => {
    state.futureProvResult = {
      id: 'future-prov-1',
      roomId,
      dormitoryId,
      status: 'RESERVED',
      startDate: new Date('2026-09-01'),
      endDate: new Date('2027-02-28'),
    };

    await expect(
      roomService.updateRoom({
        roomId,
        dormitoryId,
        changes: { status: 'maintenance' },
        expectedVersion: 1,
      }, mockPrisma)
    ).rejects.toThrow('ไม่สามารถปิดปรับปรุงได้ เนื่องจากห้องนี้มีการจองล่วงหน้า');
  });

  it('6. Future DailyStay reservation blocks switching room to maintenance', async () => {
    state.futureDailyResult = {
      id: 'future-daily-1',
      roomId,
      dormitoryId,
      status: 'CONFIRMED',
      checkInDate: new Date('2026-09-10'),
      checkOutDate: new Date('2026-09-15'),
    };

    await expect(
      roomService.updateRoom({
        roomId,
        dormitoryId,
        changes: { status: 'maintenance' },
        expectedVersion: 1,
      }, mockPrisma)
    ).rejects.toThrow('ไม่สามารถปิดปรับปรุงได้ เนื่องจากห้องนี้มีการจองล่วงหน้า');
  });

  it('7. Empty vacant room with no reservations permits switching to maintenance', async () => {
    const result = await roomService.updateRoom({
      roomId,
      dormitoryId,
      changes: { status: 'maintenance' },
      expectedVersion: 1,
    }, mockPrisma);

    expect(mockPrisma.room.updateMany).toHaveBeenCalledWith({
      where: { id: roomId, dormitoryId, deletedAt: null, version: 1 },
      data: expect.objectContaining({ status: 'maintenance' }),
    });
    expect(mockPrisma.roomOperationalStatusChange.upsert).toHaveBeenCalled();
  });

  it('8. Occupied room allows editing permitted catalog fields (rent, deposit, maxOccupants) without blocking', async () => {
    state.currentTenantId = tenantId;
    state.currentRoomStatus = 'occupied';

    const result = await roomService.updateRoom({
      roomId,
      dormitoryId,
      changes: {
        monthlyRent: '5500.00',
        maximumOccupants: 3,
      },
      expectedVersion: 1,
    }, mockPrisma);

    expect(mockPrisma.room.updateMany).toHaveBeenCalledWith({
      where: { id: roomId, dormitoryId, deletedAt: null, version: 1 },
      data: expect.objectContaining({
        monthlyRent: '5500.00',
        maximumOccupants: 3,
      }),
    });
  });
});
