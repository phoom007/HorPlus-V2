import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MeterService } from '../services/meter.service.js';
import * as prismaModule from '../db/prisma.js';

describe('Owner Round 2.4G: Stateful First-Cycle Materialization & Pull Previous Proof', () => {
  const dormitoryId = 'dorm-24g-stateful-test';
  const roomId = 'room-101-24g';
  const cycle1Id = 'cycle-2026-05-id';
  const cycle2Id = 'cycle-2026-06-id';

  // Real in-memory state store simulating persistent storage
  let persistedSnapshots: Array<{
    id: string;
    dormitoryId: string;
    billingCycleId: string;
    roomId: string;
    peopleCount: number;
    snapshotVersion: number;
    createdAt: Date;
    updatedAt: Date;
  }>;

  let mockPrisma: any;
  let mockBillingCycleRepo: any;
  let mockRoomRepo: any;
  let mockMeterRepo: any;
  let meterService: MeterService;

  beforeEach(() => {
    persistedSnapshots = [];

    mockBillingCycleRepo = {
      findById: vi.fn().mockImplementation(async (id: string, dormId: string) => {
        if (id === cycle2Id && dormId === dormitoryId) {
          return {
            id: cycle2Id,
            dormitoryId,
            cycleCode: '2026-06',
            periodStart: new Date('2026-06-01T00:00:00.000Z'),
            periodEnd: new Date('2026-06-30T23:59:59.999Z'),
          };
        }
        return null;
      }),
    };

    mockRoomRepo = {
      findAll: vi.fn().mockResolvedValue({
        items: [
          {
            id: roomId,
            dormitoryId,
            roomNumber: '101',
            floor: 1,
            status: 'vacant',
          },
        ],
        total: 1,
      }),
    };

    mockMeterRepo = {
      findDeviceByRoomAndType: vi.fn().mockResolvedValue(null),
    };

    mockPrisma = {
      billingCycle: {
        // cycle 1 is the earliest and preceding cycle
        findFirst: vi.fn().mockResolvedValue({
          id: cycle1Id,
          dormitoryId,
          cycleCode: '2026-05',
          periodStart: new Date('2026-05-01T00:00:00.000Z'),
          periodEnd: new Date('2026-05-31T23:59:59.999Z'),
        }),
      },
      room: {
        findMany: vi.fn().mockResolvedValue([{ id: roomId }]),
      },
      meterReading: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      roomBillingCycleSnapshot: {
        findMany: vi.fn().mockImplementation(async (args?: any) => {
          return persistedSnapshots.filter((s) => {
            if (args?.where?.dormitoryId && s.dormitoryId !== args.where.dormitoryId) return false;
            if (args?.where?.billingCycleId && s.billingCycleId !== args.where.billingCycleId) return false;
            if (args?.where?.roomId && s.roomId !== args.where.roomId) return false;
            return true;
          });
        }),
        createMany: vi.fn().mockImplementation(async (args: { data: any[]; skipDuplicates?: boolean }) => {
          let count = 0;
          for (const row of args.data) {
            const exists = persistedSnapshots.some(
              (s) => s.dormitoryId === row.dormitoryId && s.billingCycleId === row.billingCycleId && s.roomId === row.roomId
            );
            if (!exists || !args.skipDuplicates) {
              persistedSnapshots.push({
                id: `snap-${Date.now()}-${Math.random()}`,
                dormitoryId: row.dormitoryId,
                billingCycleId: row.billingCycleId,
                roomId: row.roomId,
                peopleCount: row.peopleCount,
                snapshotVersion: row.snapshotVersion || 1,
                createdAt: new Date(),
                updatedAt: new Date(),
              });
              count++;
            }
          }
          return { count };
        }),
      },
      contract: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      provisionalRentalTerm: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      dailyStay: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      tenantCoOccupant: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    vi.spyOn(prismaModule, 'getPrismaClient').mockReturnValue(mockPrisma);

    meterService = new MeterService(
      mockMeterRepo,
      mockBillingCycleRepo,
      mockRoomRepo
    );
  });

  it('proves stateful materialization mutation: no snapshot -> materialization persists 1 -> pull previous reads 1', async () => {
    // 1. Verify precondition: NO snapshot exists in persistence
    expect(persistedSnapshots).toHaveLength(0);

    // 2. Execute Pull Previous on Cycle 2
    // Inside pullPreviousWorkspaceData:
    // - previousCycle is detected as Cycle 1
    // - materializeFirstCyclePeopleSnapshots(dormitoryId) runs
    // - finds earliest cycle = Cycle 1, room has no snapshot
    // - calls prisma.roomBillingCycleSnapshot.createMany with peopleCount = 1
    // - state store receives the mutated snapshot
    // - subsequent prisma.roomBillingCycleSnapshot.findMany for Cycle 1 reads the newly created record
    const result = await meterService.pullPreviousWorkspaceData(dormitoryId, cycle2Id);

    // 3. Prove persistence was genuinely mutated
    expect(persistedSnapshots).toHaveLength(1);
    expect(persistedSnapshots[0].roomId).toBe(roomId);
    expect(persistedSnapshots[0].billingCycleId).toBe(cycle1Id);
    expect(persistedSnapshots[0].peopleCount).toBe(1);

    // 4. Prove production read authoritative value
    expect(result.rooms).toHaveLength(1);
    expect(result.rooms[0].roomId).toBe(roomId);
    expect(result.rooms[0].previousCyclePeopleCount).toBe(1);
    expect(result.rooms[0].currentHouseholdPeopleCount).toBe(0);
  });

  it('proves explicit persisted 0 is preserved and NOT overwritten by materializer', async () => {
    // 1. Pre-populate persistence with explicit peopleCount = 0
    persistedSnapshots.push({
      id: 'existing-snap-0',
      dormitoryId,
      billingCycleId: cycle1Id,
      roomId,
      peopleCount: 0,
      snapshotVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    expect(persistedSnapshots).toHaveLength(1);
    expect(persistedSnapshots[0].peopleCount).toBe(0);

    // 2. Execute Pull Previous on Cycle 2
    const result = await meterService.pullPreviousWorkspaceData(dormitoryId, cycle2Id);

    // 3. Prove persistence still contains the exact 0 and was NOT overwritten with 1
    expect(persistedSnapshots).toHaveLength(1);
    expect(persistedSnapshots[0].peopleCount).toBe(0);

    // 4. Prove Pull Previous returns explicit 0
    expect(result.rooms[0].previousCyclePeopleCount).toBe(0);
    expect(result.rooms[0].currentHouseholdPeopleCount).toBe(0);
  });
});