import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MeterService } from '../services/meter.service.js';
import * as prismaModule from '../db/prisma.js';

describe('Owner Round 2.4F: Authoritative First-Cycle PeopleCount Pull Previous Flow', () => {
  const dormitoryId = 'dorm-24f-test-01';
  const roomId = 'room-101-24f';
  const cycle1Id = 'cycle-2026-06-id';
  const cycle2Id = 'cycle-2026-07-id';

  let mockPrisma: any;
  let mockBillingCycleRepo: any;
  let mockRoomRepo: any;
  let mockMeterRepo: any;
  let meterService: MeterService;

  beforeEach(() => {
    mockBillingCycleRepo = {
      findById: vi.fn().mockImplementation(async (id: string, dormId: string) => {
        if (id === cycle2Id && dormId === dormitoryId) {
          return {
            id: cycle2Id,
            dormitoryId,
            cycleCode: '2026-07',
            periodStart: new Date('2026-07-01T00:00:00.000Z'),
            periodEnd: new Date('2026-07-31T23:59:59.999Z'),
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
        findFirst: vi.fn().mockResolvedValue({
          id: cycle1Id,
          dormitoryId,
          cycleCode: '2026-06',
          periodStart: new Date('2026-06-01T00:00:00.000Z'),
          periodEnd: new Date('2026-06-30T23:59:59.999Z'),
        }),
      },
      room: {
        findMany: vi.fn().mockResolvedValue([{ id: roomId }]),
      },
      meterReading: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      roomBillingCycleSnapshot: {
        findMany: vi.fn(),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
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

  it('pulls peopleCount = 1 from previous first-cycle snapshot when next cycle created', async () => {
    // 1. Previous cycle snapshot has peopleCount = 1 (materialized first-cycle default)
    mockPrisma.roomBillingCycleSnapshot.findMany.mockResolvedValue([
      {
        roomId,
        dormitoryId,
        billingCycleId: cycle1Id,
        peopleCount: 1,
        source: 'FIRST_CYCLE_DEFAULT',
      },
    ]);

    // 2. Invoke pullPreviousWorkspaceData for Cycle 2
    const result = await meterService.pullPreviousWorkspaceData(dormitoryId, cycle2Id);

    // 3. Assertions: previous cycle detected and pulled previousCyclePeopleCount is 1 (not 0 or blank)
    expect(result.hasPreviousCycle).toBe(true);
    expect(result.previousCycleId).toBe(cycle1Id);
    expect(result.previousCycleCode).toBe('2026-06');
    expect(result.rooms.length).toBe(1);

    const roomData = result.rooms[0];
    expect(roomData.roomId).toBe(roomId);
    expect(roomData.previousCyclePeopleCount).toBe(1);
  });

  it('CRITICAL AUDIT RULE: If previous cycle snapshot explicitly has peopleCount = 0, Pull Previous returns 0 (never forced to 1)', async () => {
    // 1. Previous cycle snapshot has explicit peopleCount = 0
    mockPrisma.roomBillingCycleSnapshot.findMany.mockResolvedValue([
      {
        roomId,
        dormitoryId,
        billingCycleId: cycle1Id,
        peopleCount: 0,
        source: 'MANUAL_EDIT',
      },
    ]);

    // 2. Invoke pullPreviousWorkspaceData for Cycle 2
    const result = await meterService.pullPreviousWorkspaceData(dormitoryId, cycle2Id);

    // 3. Assertions: explicit 0 is preserved with absolute fidelity
    expect(result.hasPreviousCycle).toBe(true);
    const roomData = result.rooms[0];
    expect(roomData.roomId).toBe(roomId);
    expect(roomData.previousCyclePeopleCount).toBe(0);
  });

  it('correctly reports currentHouseholdPeopleCount = 1 when active tenant is in room during cycle 2', async () => {
    mockPrisma.roomBillingCycleSnapshot.findMany.mockResolvedValue([
      {
        roomId,
        dormitoryId,
        billingCycleId: cycle1Id,
        peopleCount: 1,
        source: 'FIRST_CYCLE_DEFAULT',
      },
    ]);

    mockPrisma.contract.findMany.mockResolvedValue([
      {
        id: 'contract-1',
        roomId,
        dormitoryId,
        tenantId: 'tenant-1',
        status: 'active',
        startDate: new Date('2026-07-01'),
        endDate: new Date('2026-12-31'),
        tenant: { id: 'tenant-1', name: 'Somchai', status: 'active' },
      },
    ]);

    const result = await meterService.pullPreviousWorkspaceData(dormitoryId, cycle2Id);
    expect(result.rooms[0].previousCyclePeopleCount).toBe(1);
    expect(result.rooms[0].currentHouseholdPeopleCount).toBe(1);
  });
});
