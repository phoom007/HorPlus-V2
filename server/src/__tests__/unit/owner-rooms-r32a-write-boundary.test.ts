import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RoomService } from '../../services/room.service.js';
import { currentCycleResolverService } from '../../services/current-cycle-resolver.js';
import { backfillRoomOperationalStatusBaseline } from '../../services/room-operational-baseline.service.js';
import { subscriptionEntitlementService } from '../../services/subscription-entitlement.service.js';
import { resolveRoomOperationalStatusForCycle } from '../../services/meter.service.js';

describe('OWNER ROOMS R3.2b — Canonical Operational Cycle, One-Time Baseline & Cache Metadata', () => {
  const dormitoryId = 'a1111111-1111-4111-8111-111111111111';
  const roomId = 'b2222222-2222-4222-8222-222222222222';
  const buildingId = 'c3333333-3333-4333-8333-333333333333';

  let roomService: RoomService;
  let mockRoomRepo: any;
  let mockBuildingRepo: any;
  let mockSubRepo: any;
  let mockPrisma: any;
  let persistedStatusChanges: Map<string, any>;

  const cycles = [
    { id: 'cycle-2026-08', dormitoryId, cycleCode: '2026-08', periodStart: new Date('2026-08-01T00:00:00Z'), status: 'draft' },
    { id: 'cycle-2026-09', dormitoryId, cycleCode: '2026-09', periodStart: new Date('2026-09-01T00:00:00Z'), status: 'draft' },
    { id: 'cycle-2026-10', dormitoryId, cycleCode: '2026-10', periodStart: new Date('2026-10-01T00:00:00Z'), status: 'draft' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    persistedStatusChanges = new Map<string, any>();

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
        findMany: vi.fn(({ where }) => {
          // If query checks operationalStatusChanges: { none: {} }
          if (where?.operationalStatusChanges?.none) {
            // Return only rooms that have no history
            const hasHistory = Array.from(persistedStatusChanges.values()).some(
              (sc) => sc.roomId === roomId && sc.dormitoryId === dormitoryId
            );
            if (hasHistory) {
              return Promise.resolve([]);
            }
            return Promise.resolve([{ id: roomId, dormitoryId, roomNumber: '101', status: 'maintenance' }]);
          }
          return Promise.resolve([
            { id: roomId, dormitoryId, roomNumber: '101', status: 'maintenance' },
          ]);
        }),
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
        findFirst: vi.fn(({ where, orderBy }) => {
          // Filter status changes matching dormitoryId, roomId, and periodStart <= target
          const items = Array.from(persistedStatusChanges.values()).filter((item) => {
            if (item.dormitoryId !== where.dormitoryId || item.roomId !== where.roomId) return false;
            if (where.effectiveBillingCycle?.periodStart?.lte) {
              const maxDate = new Date(where.effectiveBillingCycle.periodStart.lte).getTime();
              const itemDate = new Date(item.effectiveBillingCycle.periodStart).getTime();
              return itemDate <= maxDate;
            }
            return true;
          });

          if (items.length === 0) return Promise.resolve(null);
          // Sort desc by periodStart
          items.sort((a, b) => new Date(b.effectiveBillingCycle.periodStart).getTime() - new Date(a.effectiveBillingCycle.periodStart).getTime());
          return Promise.resolve(items[0]);
        }),
        create: vi.fn(({ data }) => {
          const key = `${data.dormitoryId}:${data.roomId}:${data.effectiveBillingCycleId}`;
          const entry = { id: `sc-${Date.now()}`, ...data, effectiveBillingCycle: cycles.find((c) => c.id === data.effectiveBillingCycleId) };
          persistedStatusChanges.set(key, entry);
          return Promise.resolve(entry);
        }),
        createMany: vi.fn(({ data, skipDuplicates }) => {
          let count = 0;
          for (const item of data) {
            const key = `${item.dormitoryId}:${item.roomId}:${item.effectiveBillingCycleId}`;
            if (!persistedStatusChanges.has(key) || !skipDuplicates) {
              const entry = { id: `sc-${Date.now()}-${Math.random()}`, ...item, effectiveBillingCycle: cycles.find((c) => c.id === item.effectiveBillingCycleId) };
              persistedStatusChanges.set(key, entry);
              count++;
            }
          }
          return Promise.resolve({ count });
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

    // Default mock canonical CurrentCycleResolver: 2026-08
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

  describe('Part J & K — One-Time Baseline Semantics & Source-Cycle Inheritance', () => {
    it('1. Initial baseline creates exactly one 2026-08 row when room has zero status history', async () => {
      const res = await backfillRoomOperationalStatusBaseline(dormitoryId, mockPrisma);
      expect(res.processedDormitories).toBe(1);
      expect(res.processedRooms).toBe(1);
      expect(res.createdBaselines).toBe(1);

      // Verify row exists at 2026-08
      const saved = persistedStatusChanges.get(`${dormitoryId}:${roomId}:cycle-2026-08`);
      expect(saved).toBeDefined();
      expect(saved.status).toBe('maintenance');
    });

    it('2. When operational cycle advances to 2026-09, baseline rerun creates 0 synthetic rows and inherits sourceCycleId: 2026-08', async () => {
      // Step A: Run baseline during 2026-08
      await backfillRoomOperationalStatusBaseline(dormitoryId, mockPrisma);
      expect(persistedStatusChanges.size).toBe(1);

      // Step B: Simulate operational cycle advancing to 2026-09
      vi.spyOn(currentCycleResolverService, 'resolveOperationalBillingCycle').mockResolvedValue({
        billingCycleId: 'cycle-2026-09',
        cycleCode: '2026-09',
        reason: 'CURRENT_DATE_ACTIVE',
        cycle: cycles[1],
      });

      // Step C: Run baseline again on server restart during 2026-09
      const secondRun = await backfillRoomOperationalStatusBaseline(dormitoryId, mockPrisma);
      expect(secondRun.createdBaselines).toBe(0); // ZERO new rows created
      expect(persistedStatusChanges.size).toBe(1); // Database still contains ONLY 2026-08 row
      expect(persistedStatusChanges.has(`${dormitoryId}:${roomId}:cycle-2026-09`)).toBe(false);

      // Step D: Resolve effective status for cycle 2026-09 -> returns maintenance inherited from source 2026-08
      const resolved202609 = await resolveRoomOperationalStatusForCycle(dormitoryId, roomId, 'cycle-2026-09', mockPrisma);
      expect(resolved202609.status).toBe('maintenance');
      expect(resolved202609.sourceCycleId).toBe('cycle-2026-08');
    });

    it('3. Pre-onboarding dormitory with no billing cycle is skipped safely without error or synthetic rows', async () => {
      // Mock resolver returning no billingCycleId
      vi.spyOn(currentCycleResolverService, 'resolveOperationalBillingCycle').mockResolvedValue({
        billingCycleId: undefined,
        cycleCode: '2026-08',
        reason: 'ONBOARDING_START',
      });

      const res = await backfillRoomOperationalStatusBaseline(dormitoryId, mockPrisma);
      expect(res.createdBaselines).toBe(0);
      expect(persistedStatusChanges.size).toBe(0);
    });
  });

  describe('Part J — Real Write-Boundary & Operational Resolver Enforcement', () => {
    it('4. Status change writes strictly to canonical operational cycle (2026-08), NOT UI selected (2026-06) or latest draft (2026-10)', async () => {
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
    });

    it('5. Creating a new Room establishes baseline at operational cycle 2026-08 even if future cycles exist', async () => {
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

  describe('Part C — Real Property Route Mutation Response Boundary (R3.2c)', () => {
    it('6. PUT /properties/rooms/:id preserves effectiveRoomStatusCycleId while GET remains pure Room DTO', async () => {
      const express = (await import('express')).default;
      const request = (await import('supertest')).default;
      const { createPropertyRouter } = await import('../../routes/property.routes.js');
      const { defaultsService } = await import('../../services/defaults.service.js');

      // Mock auth service with permissive test auth
      const mockAuthService: any = {
        verifyCsrf: vi.fn().mockReturnValue(true),
        validateSession: vi.fn().mockResolvedValue({
          userId: 'user-1',
          sessionId: 'sess-1',
          dormitoryId,
          role: 'OWNER',
        }),
      };

      // Mock building service
      const mockBuildingService: any = {
        getBuildingsByDormitory: vi.fn().mockResolvedValue([]),
      };

      // Spy on defaultsService.buildAuthoritativeRoomResponse to return pure enriched DTO
      vi.spyOn(defaultsService, 'buildAuthoritativeRoomResponse').mockImplementation(async (_dormId, r: any) => ({
        id: r.id,
        dormitoryId: r.dormitoryId,
        buildingId: r.buildingId,
        roomNumber: r.roomNumber,
        status: r.status,
        monthlyRent: '5000.00',
        termRent: '20000.00',
        dailyRent: '600.00',
        termDeposit: '10000.00',
        monthlyDeposit: '5000.00',
        dailyDeposit: '1000.00',
        floor: 1,
        roomType: 'standard',
        rentCycle: 'monthly',
        maximumOccupants: 2,
        version: r.version || 2,
      } as any));

      // Spy on roomService.updateRoom to return room with mutation metadata
      vi.spyOn(roomService, 'updateRoom').mockResolvedValue({
        id: roomId,
        dormitoryId,
        buildingId,
        roomNumber: '101',
        status: 'maintenance',
        version: 2,
        effectiveRoomStatusCycleId: 'cycle-2026-08',
      } as any);

      // Spy on roomService.getRoomById to return standard room without mutation metadata
      vi.spyOn(roomService, 'getRoomById').mockResolvedValue({
        id: roomId,
        dormitoryId,
        buildingId,
        roomNumber: '101',
        status: 'maintenance',
        version: 2,
      } as any);

      const app = express();
      app.use(express.json());
      // Attach mock test session & dormitory context
      app.use((req, _res, next) => {
        req.headers['x-csrf-token'] = 'test-csrf';
        req.headers['x-dormitory-id'] = dormitoryId;
        (req as any).auth = {
          userId: 'user-1',
          sessionId: 'sess-1',
          dormitoryId,
          role: 'OWNER',
          user: { id: 'user-1', role: 'OWNER' },
          memberships: [{ dormitoryId, role: 'OWNER', roleCode: 'OWNER', status: 'active', permissions: ['*'] }],
        };
        (req as any).dormitoryContext = {
          dormitoryId,
          roleCode: 'OWNER',
          userId: 'user-1',
          permissions: ['*'],
          membership: { dormitoryId, role: 'OWNER', roleCode: 'OWNER', status: 'active' },
        };
        next();
      });

      app.use('/api/v1/properties', createPropertyRouter(mockAuthService, mockBuildingService, roomService));

      // 1. Test PUT /properties/rooms/:id response composition
      const putRes = await request(app)
        .put(`/api/v1/properties/rooms/${roomId}`)
        .send({
          status: 'maintenance',
          expectedVersion: 1,
        })
        .set('x-csrf-token', 'test-csrf');

      expect(putRes.status).toBe(200);
      expect(putRes.body.data).toBeDefined();
      // Crucial R3.2c invariant: mutation metadata preserved on PUT response
      expect(putRes.body.data.effectiveRoomStatusCycleId).toBe('cycle-2026-08');
      // Crucial invariant: authoritative room fields intact
      expect(putRes.body.data.roomNumber).toBe('101');
      expect(putRes.body.data.status).toBe('maintenance');
      expect(putRes.body.data.monthlyRent).toBe('5000.00');

      // 2. Test GET /properties/rooms/:id remains pure Room DTO without mutation metadata
      const getRes = await request(app)
        .get(`/api/v1/properties/rooms/${roomId}`)
        .set('x-csrf-token', 'test-csrf');

      expect(getRes.status).toBe(200);
      expect(getRes.body.data).toBeDefined();
      expect(getRes.body.data.roomNumber).toBe('101');
      expect(getRes.body.data.effectiveRoomStatusCycleId).toBeUndefined();
    });
  });
  });
});
