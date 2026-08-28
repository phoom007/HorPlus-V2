import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RoomService } from '../../services/room.service.js';
import { CreateRoomSchema } from '../../schemas/property-tenant-contract.schemas.js';
import { subscriptionEntitlementService } from '../../services/subscription-entitlement.service.js';

describe('RoomService.createRoom & CreateRoomSchema Status Persistence', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('validates status in CreateRoomSchema with maintenance support and default vacant', () => {
    const validVacant = CreateRoomSchema.safeParse({
      buildingId: 'bld-1',
      roomNumber: '101',
    });
    expect(validVacant.success).toBe(true);
    if (validVacant.success) {
      expect(validVacant.data.status).toBe('vacant');
    }

    const validMaintenance = CreateRoomSchema.safeParse({
      buildingId: 'bld-1',
      roomNumber: '102',
      status: 'maintenance',
    });
    expect(validMaintenance.success).toBe(true);
    if (validMaintenance.success) {
      expect(validMaintenance.data.status).toBe('maintenance');
    }
  });

  it('persists status="maintenance" when creating a room with maintenance status', async () => {
    vi.spyOn(subscriptionEntitlementService, 'assertRoomCreationAllowed').mockResolvedValue(undefined as any);

    const mockRoomRepo: any = {};
    const mockBuildingRepo: any = {};
    const mockSubRepo: any = {};

    const service = new RoomService(mockRoomRepo, mockBuildingRepo, mockSubRepo);

    let createdData: any = null;
    const mockTx: any = {
      building: {
        findFirst: vi.fn().mockResolvedValue({ id: 'bld-1', dormitoryId: 'dorm-1', status: 'active', deletedAt: null }),
      },
      room: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation((args: any) => {
          createdData = args.data;
          return { id: 'rm-101', ...args.data };
        }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({ id: 'log-1' }),
      },
      $executeRaw: vi.fn().mockResolvedValue(1),
    };

    const roomPayload = {
      buildingId: 'bld-1',
      roomNumber: '101',
      floor: 1,
      status: 'maintenance' as const,
      depositAmount: '9000.00',
    };

    const result = await service.createRoom('dorm-1', roomPayload, 'user-1', mockTx);

    expect(mockTx.room.create).toHaveBeenCalledTimes(1);
    expect(createdData).toBeDefined();
    expect(createdData.status).toBe('maintenance');
    expect(result.status).toBe('maintenance');
  });

  it('persists status="vacant" by default when status is omitted', async () => {
    vi.spyOn(subscriptionEntitlementService, 'assertRoomCreationAllowed').mockResolvedValue(undefined as any);

    const mockRoomRepo: any = {};
    const mockBuildingRepo: any = {};
    const mockSubRepo: any = {};

    const service = new RoomService(mockRoomRepo, mockBuildingRepo, mockSubRepo);

    let createdData: any = null;
    const mockTx: any = {
      building: {
        findFirst: vi.fn().mockResolvedValue({ id: 'bld-1', dormitoryId: 'dorm-1', status: 'active', deletedAt: null }),
      },
      room: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation((args: any) => {
          createdData = args.data;
          return { id: 'rm-102', ...args.data };
        }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({ id: 'log-1' }),
      },
      $executeRaw: vi.fn().mockResolvedValue(1),
    };

    const roomPayload = {
      buildingId: 'bld-1',
      roomNumber: '102',
      floor: 1,
    };

    const result = await service.createRoom('dorm-1', roomPayload, 'user-1', mockTx);

    expect(mockTx.room.create).toHaveBeenCalledTimes(1);
    expect(createdData).toBeDefined();
    expect(createdData.status).toBe('vacant');
    expect(result.status).toBe('vacant');
  });
});
