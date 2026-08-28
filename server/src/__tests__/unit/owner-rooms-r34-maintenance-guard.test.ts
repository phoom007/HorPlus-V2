import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RoomService } from '../../services/room.service.js';
import { currentCycleResolverService } from '../../services/current-cycle-resolver.js';
import { subscriptionEntitlementService } from '../../services/subscription-entitlement.service.js';

const { mockPrisma, state } = vi.hoisted(() => {
  const state = {
    contracts: [] as any[],
    provisionals: [] as any[],
    dailyStays: [] as any[],
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
      findMany: vi.fn(({ where }) => {
        // Assert no non-canonical fields queried
        if ('checkInDate' in (where || {}) || 'checkOutDate' in (where || {})) {
          throw new Error('NON_CANONICAL_FIELD_QUERIED');
        }
        return Promise.resolve(state.contracts);
      }),
      findFirst: vi.fn(() => Promise.resolve(state.contracts[0] || null)),
    },
    provisionalRentalTerm: {
      findMany: vi.fn(({ where }) => {
        if ('checkInDate' in (where || {}) || 'checkOutDate' in (where || {})) {
          throw new Error('NON_CANONICAL_FIELD_QUERIED');
        }
        return Promise.resolve(state.provisionals);
      }),
      findFirst: vi.fn(() => Promise.resolve(state.provisionals[0] || null)),
    },
    dailyStay: {
      findMany: vi.fn(({ where }) => {
        if ('checkInDate' in (where || {}) || 'checkOutDate' in (where || {})) {
          throw new Error('NON_CANONICAL_FIELD_QUERIED');
        }
        return Promise.resolve(state.dailyStays);
      }),
      findFirst: vi.fn(() => Promise.resolve(state.dailyStays[0] || null)),
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

describe('OWNER ROOMS R3.4a — Canonical Maintenance Occupancy & Reservation Guard', () => {
  const dormitoryId = 'a1111111-1111-4111-8111-111111111111';
  const roomId = 'b2222222-2222-4222-8222-222222222222';
  const tenantId = 't3333333-3333-4333-8333-333333333333';

  let roomService: RoomService;
  let mockRoomRepo: any;
  let mockBuildingRepo: any;

  beforeEach(() => {
    vi.clearAllMocks();
    state.contracts = [];
    state.provisionals = [];
    state.dailyStays = [];
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
    state.contracts = [{
      id: 'ctr-1',
      roomId,
      dormitoryId,
      status: 'active',
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
    }];

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
    state.provisionals = [{
      id: 'prov-1',
      roomId,
      dormitoryId,
      status: 'ACTIVE',
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
    }];

    await expect(
      roomService.updateRoom({
        roomId,
        dormitoryId,
        changes: { status: 'maintenance' },
        expectedVersion: 1,
      }, mockPrisma)
    ).rejects.toThrow('ไม่สามารถปิดปรับปรุงได้ เนื่องจากห้องนี้มีผู้เช่าพักอยู่');
  });

  it('3. Active DailyStay occupant (canonical startDate/endDate/checkInAt) blocks switching room to maintenance', async () => {
    const now = new Date();
    state.dailyStays = [{
      id: 'daily-1',
      roomId,
      dormitoryId,
      status: 'ACTIVE',
      startDate: new Date(now.getTime() - 2 * 86400000),
      endDate: new Date(now.getTime() + 3 * 86400000),
      checkInAt: new Date(now.getTime() - 2 * 86400000),
      checkOutAt: new Date(now.getTime() + 3 * 86400000),
    }];

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
    const now = new Date();
    state.contracts = [{
      id: 'future-ctr-1',
      roomId,
      dormitoryId,
      status: 'reserved',
      startDate: new Date(now.getTime() + 10 * 86400000),
      endDate: new Date(now.getTime() + 180 * 86400000),
    }];

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
    const now = new Date();
    state.provisionals = [{
      id: 'future-prov-1',
      roomId,
      dormitoryId,
      status: 'RESERVED',
      startDate: new Date(now.getTime() + 10 * 86400000),
      endDate: new Date(now.getTime() + 180 * 86400000),
    }];

    await expect(
      roomService.updateRoom({
        roomId,
        dormitoryId,
        changes: { status: 'maintenance' },
        expectedVersion: 1,
      }, mockPrisma)
    ).rejects.toThrow('ไม่สามารถปิดปรับปรุงได้ เนื่องจากห้องนี้มีการจองล่วงหน้า');
  });

  it('6. Future DailyStay reservation (RESERVED) blocks switching room to maintenance', async () => {
    const now = new Date();
    state.dailyStays = [{
      id: 'future-daily-1',
      roomId,
      dormitoryId,
      status: 'RESERVED',
      startDate: new Date(now.getTime() + 5 * 86400000),
      endDate: new Date(now.getTime() + 10 * 86400000),
      checkInAt: new Date(now.getTime() + 5 * 86400000),
      checkOutAt: new Date(now.getTime() + 10 * 86400000),
    }];

    await expect(
      roomService.updateRoom({
        roomId,
        dormitoryId,
        changes: { status: 'maintenance' },
        expectedVersion: 1,
      }, mockPrisma)
    ).rejects.toThrow('ไม่สามารถปิดปรับปรุงได้ เนื่องจากห้องนี้มีการจองล่วงหน้า');
  });

  it('7. Historical checked-out DailyStay does NOT block switching room to maintenance', async () => {
    const now = new Date();
    state.dailyStays = [{
      id: 'past-daily-1',
      roomId,
      dormitoryId,
      status: 'CHECKED_OUT',
      startDate: new Date(now.getTime() - 20 * 86400000),
      endDate: new Date(now.getTime() - 15 * 86400000),
      actualCheckedOutAt: new Date(now.getTime() - 15 * 86400000),
    }];

    await roomService.updateRoom({
      roomId,
      dormitoryId,
      changes: { status: 'maintenance' },
      expectedVersion: 1,
    }, mockPrisma);

    expect(mockPrisma.room.updateMany).toHaveBeenCalledWith({
      where: { id: roomId, dormitoryId, deletedAt: null, version: 1 },
      data: expect.objectContaining({ status: 'maintenance' }),
    });
  });

  it('8. Soft-deleted DailyStay / Contract does NOT block switching room to maintenance', async () => {
    state.dailyStays = [{
      id: 'del-daily-1',
      roomId,
      dormitoryId,
      status: 'ACTIVE',
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
      deletedAt: new Date(),
    }];

    await roomService.updateRoom({
      roomId,
      dormitoryId,
      changes: { status: 'maintenance' },
      expectedVersion: 1,
    }, mockPrisma);

    expect(mockPrisma.room.updateMany).toHaveBeenCalledWith({
      where: { id: roomId, dormitoryId, deletedAt: null, version: 1 },
      data: expect.objectContaining({ status: 'maintenance' }),
    });
  });

  it('9. Stale currentTenantId on room does NOT block maintenance if all authoritative occupancy ended', async () => {
    state.currentTenantId = 'stale-tenant-id';
    state.contracts = [{
      id: 'past-ctr-1',
      roomId,
      dormitoryId,
      status: 'terminated',
      startDate: new Date('2025-01-01'),
      endDate: new Date('2025-12-31'),
      terminatedAt: new Date('2025-12-31'),
    }];

    await roomService.updateRoom({
      roomId,
      dormitoryId,
      changes: { status: 'maintenance' },
      expectedVersion: 1,
    }, mockPrisma);

    expect(mockPrisma.room.updateMany).toHaveBeenCalledWith({
      where: { id: roomId, dormitoryId, deletedAt: null, version: 1 },
      data: expect.objectContaining({ status: 'maintenance' }),
    });
  });

  it('10. Occupied room allows editing permitted catalog fields without blocking', async () => {
    state.currentTenantId = tenantId;
    state.currentRoomStatus = 'occupied';

    await roomService.updateRoom({
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
