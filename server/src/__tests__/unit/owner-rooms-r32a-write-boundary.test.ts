import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RoomService } from '../../services/room.service.js';
import { currentCycleResolverService } from '../../services/current-cycle-resolver.js';
import { backfillRoomOperationalStatusBaseline } from '../../services/room-operational-baseline.service.js';
import { subscriptionEntitlementService } from '../../services/subscription-entitlement.service.js';

describe('OWNER ROOMS R3.2a — Canonical Operational Cycle Write Boundary & Baseline', () => {
  const dormitoryId = 'a1111111-1111-4111-8111-111111111111';
  const roomId = 'b2222222-2222-4222-8222-222222222222';
  const buildingId = 'c3333333-3333-4333-8333-333333333333';

  let roomService: RoomService;
  let mockRoomRepo: any;
  let mockBuildingRepo: any;
  let mockSubRepo: any;
  let mockPrisma: any;

  const cycles = [
    { id: 'cycle-2026-08', dormitoryId, cycleCode: '2026-08', periodStart: new Date('2026-08-01T00:00:00Z'), status: 'draft' },
    { id: 'cycle-2026-09', dormitoryId, cycleCode: '2026-09', periodStart: new Date('2026-09-01T00:00:00Z'), status: 'draft' },
    { id: 'cycle-2026-10', dormitoryId, cycleCode: '2026-10', periodStart: new Date('2026-10-01T00:00:00Z'), status: 'draft' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();

    vi.spyOn(subscriptionEntitlementService, 'assertDormitoryWritable').mockResolvedValue(undefined as any);

    mockRoomRepo = {
      findAll: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      findById: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    };

    mockBuildingRepo = {
      findAll: vi.fn().mockResolvedValue({ items: [] }),
    };

    mockSubRepo = {};

    const persistedStatusChanges = new Map<string, any>();

    mockPrisma = {
      $transaction: vi.fn((cb) => cb(mockPrisma)),
      dormitory: {
        findMany: vi.fn().mockResolvedValue([{ id: dormitoryId, name: 'Test Dorm' }]),
        findUnique: vi.fn().mockResolvedValue({ id: dormitoryId, status: 'active' }),
      },
      building: {
        findFirst: vi.fn().mockResolvedValue({ id: buildingId, dormitoryId, name: 'Building A' }),
      },
      billingCycle: {
        findFirst: vi.fn(({ where }) => {
          if (where?.id) {
            return Promise.resolve(cycles.find((c) => c.id === where.id) || null);
          }
          return Promise.resolve(cycles[0]);
        }),
      },
      room: {
        findFirst: vi.fn(({ where }) => {
          if (where?.normalizedRoomNumber === '102') {
            return Promise.resolve(null);
          }
          return Promise.resolve({
            id: roomId,
            dormitoryId,
            roomNumber: '101',
            normalizedRoomNumber: '101',
            status: 'vacant',
            version: 1,
            monthlyRent: '5000.00',
          });
        }),
        findUnique: vi.fn().mockResolvedValue({
          id: roomId,
          dormitoryId,
          roomNumber: '101',
          normalizedRoomNumber: '101',
          status: 'maintenance',
          version: 2,
          monthlyRent: '5000.00',
        }),
        findMany: vi.fn().mockResolvedValue([
          { id: roomId, dormitoryId, roomNumber: '101', status: 'maintenance' },
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockResolvedValue({
          id: 'room-new-1',
          dormitoryId,
          roomNumber: '102',
          status: 'vacant',
          version: 1,
        }),
      },
      roomOperationalStatusChange: {
        findUnique: vi.fn(({ where }) => {
          const key = `${where.dormitory_room_effective_cycle_unique.dormitoryId}:${where.dormitory_room_effective_cycle_unique.roomId}:${where.dormitory_room_effective_cycle_unique.effectiveBillingCycleId}`;
          return Promise.resolve(persistedStatusChanges.get(key) || null);
        }),
        findFirst: vi.fn(({ where }) => {
          for (const item of persistedStatusChanges.values()) {
            if (item.dormitoryId === where.dormitoryId && item.roomId === where.roomId) {
              return Promise.resolve(item);
            }
          }
          return Promise.resolve(null);
        }),
        create: vi.fn(({ data }) => {
          const key = `${data.dormitoryId}:${data.roomId}:${data.effectiveBillingCycleId}`;
          const entry = { id: `sc-${Date.now()}`, ...data, effectiveBillingCycle: cycles.find((c) => c.id === data.effectiveBillingCycleId) };
          persistedStatusChanges.set(key, entry);
          return Promise.resolve(entry);
        }),
        upsert: vi.fn(({ where, create, update }) => {
          const key = `${where.dormitory_room_effective_cycle_unique.dormitoryId}:${where.dormitory_room_effective_cycle_unique.roomId}:${where.dormitory_room_effective_cycle_unique.effectiveBillingCycleId}`;
          const existing = persistedStatusChanges.get(key);
          if (existing) {
            existing.status = update.status;
            existing.version = (existing.version || 1) + 1;
            return Promise.resolve(existing);
          } else {
            const entry = { id: `sc-${Date.now()}`, ...create, effectiveBillingCycle: cycles.find((c) => c.id === create.effectiveBillingCycleId) };
            persistedStatusChanges.set(key, entry);
            return Promise.resolve(entry);
          }
        }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({ id: 'log-1' }),
      },
    };

    // Mock canonical CurrentCycleResolver to return 2026-08
    vi.spyOn(currentCycleResolverService, 'resolveOperationalBillingCycle').mockResolvedValue({
      billingCycleId: 'cycle-2026-08',
      cycleCode: '2026-08',
      reason: 'CURRENT_DATE_ACTIVE',
      cycle: cycles[0],
    });

    roomService = new RoomService(
      mockRoomRepo,
      mockBuildingRepo,
      mockSubRepo,
      undefined,
      undefined,
      undefined,
      undefined,
      mockPrisma
    );
  });

  describe('Part J — Real Write-Boundary & Operational Resolver Enforcement', () => {
    it('1. Status change writes strictly to canonical operational cycle (2026-08), NOT UI selected (2026-06) or latest draft (2026-10)', async () => {
      const command = {
        roomId,
        dormitoryId,
        changes: { status: 'maintenance' },
        expectedVersion: 1,
        actorUserId: 'user-1',
      };

      const result = await roomService.updateRoom(command, mockPrisma);

      expect(result.effectiveRoomStatusCycleId).toBe('cycle-2026-08');

      // Assert upsert was called with operational cycle 2026-08
      expect(mockPrisma.roomOperationalStatusChange.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            dormitory_room_effective_cycle_unique: {
              dormitoryId,
              roomId,
              effectiveBillingCycleId: 'cycle-2026-08',
            },
          },
          create: expect.objectContaining({
            effectiveBillingCycleId: 'cycle-2026-08',
            status: 'maintenance',
          }),
        })
      );

      // Verify it was NOT written to 2026-06 or 2026-10
      expect(mockPrisma.roomOperationalStatusChange.upsert).not.toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            dormitory_room_effective_cycle_unique: expect.objectContaining({
              effectiveBillingCycleId: 'cycle-2026-06',
            }),
          },
        })
      );
      expect(mockPrisma.roomOperationalStatusChange.upsert).not.toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            dormitory_room_effective_cycle_unique: expect.objectContaining({
              effectiveBillingCycleId: 'cycle-2026-10',
            }),
          },
        })
      );
    });

    it('2. Repeated status changes in the same operational cycle update the unique row (no duplicates)', async () => {
      // First update to maintenance
      await roomService.updateRoom({
        roomId,
        dormitoryId,
        changes: { status: 'maintenance' },
        expectedVersion: 1,
      }, mockPrisma);

      // Second update back to vacant
      mockPrisma.room.findFirst.mockResolvedValueOnce({
        id: roomId,
        dormitoryId,
        roomNumber: '101',
        normalizedRoomNumber: '101',
        status: 'maintenance',
        version: 2,
      });

      await roomService.updateRoom({
        roomId,
        dormitoryId,
        changes: { status: 'vacant' },
        expectedVersion: 2,
      }, mockPrisma);

      // Expect upsert was used both times for the same unique key
      expect(mockPrisma.roomOperationalStatusChange.upsert).toHaveBeenCalledTimes(2);
    });

    it('3. Creating a new Room establishes baseline at operational cycle 2026-08 even if future cycles exist', async () => {
      await roomService.createRoom(
        dormitoryId,
        {
          buildingId,
          roomNumber: '102',
          floor: 1,
          monthlyRent: 5000,
          status: 'vacant',
        } as any,
        'user-1',
        mockPrisma
      );

      expect(mockPrisma.roomOperationalStatusChange.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            dormitoryId,
            effectiveBillingCycleId: 'cycle-2026-08',
            status: 'vacant',
          }),
        })
      );
    });
  });

  describe('Part K — Existing Baseline Backfill Service', () => {
    it('4. backfillRoomOperationalStatusBaseline establishes baseline at operational cycle without retroactive historical copies', async () => {
      const backfillRes = await backfillRoomOperationalStatusBaseline(dormitoryId, mockPrisma);
      expect(backfillRes.processedDormitories).toBe(1);
      expect(backfillRes.processedRooms).toBe(1);
      expect(backfillRes.createdBaselines).toBe(1);

      // Verify baseline was created at 2026-08 with room status
      expect(mockPrisma.roomOperationalStatusChange.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            dormitoryId,
            roomId,
            effectiveBillingCycleId: 'cycle-2026-08',
            status: 'maintenance',
          }),
        })
      );
    });
  });
});
