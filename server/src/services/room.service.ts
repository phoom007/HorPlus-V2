import { IRoomRepository, RoomEntity, RoomFilterQuery, CreateRoomData } from '../db/repositories/room.repository.js';
import { IBuildingRepository } from '../db/repositories/building.repository.js';
import { IPlatformSubscriptionRepository } from '../db/repositories/subscription.repository.js';
import { IPlatformPlanRepository } from '../db/repositories/plan.repository.js';
import { IContractRepository } from '../db/repositories/contract.repository.js';
import { AuditService } from './audit.service.js';

export class RoomService {
  constructor(
    private roomRepo: IRoomRepository,
    private buildingRepo: IBuildingRepository,
    private subRepo: IPlatformSubscriptionRepository,
    private planRepo: IPlatformPlanRepository,
    private contractRepo: IContractRepository,
    private auditService?: AuditService
  ) {}

  public async getRooms(dormitoryId: string, filter?: RoomFilterQuery) {
    return this.roomRepo.findAll(dormitoryId, filter);
  }

  public async getRoomById(id: string, dormitoryId: string) {
    const r = await this.roomRepo.findById(id, dormitoryId);
    if (!r) {
      const err = new Error('ไม่พบข้อมูลห้องพักที่ระบุ');
      (err as any).code = 'ROOM_NOT_FOUND';
      (err as any).statusCode = 404;
      throw err;
    }
    return r;
  }

  public async checkRoomLimit(dormitoryId: string): Promise<void> {
    const sub = await this.subRepo.findByDormitoryId(dormitoryId);
    if (!sub) return; // Default allow if no sub found or during initial provisioning

    const plan = await this.planRepo.findById(sub.planId);
    if (!plan || plan.roomLimit === null || plan.roomLimit === undefined) {
      return; // Enterprise / Unlimited
    }

    const currentCount = await this.roomRepo.countActiveByDormitory(dormitoryId);
    if (currentCount >= plan.roomLimit) {
      const err = new Error(`จำนวนห้องพักเกินโควต้าแพ็กเกจ ${plan.name} (${plan.roomLimit} ห้อง)`);
      (err as any).code = 'ROOM_LIMIT_EXCEEDED';
      (err as any).statusCode = 409;
      throw err;
    }
  }

  public async createRoom(dormitoryId: string, data: CreateRoomData, actorUserId?: string) {
    // 1. Check Room Limit
    await this.checkRoomLimit(dormitoryId);

    // 2. Check Uniqueness
    const existing = await this.roomRepo.findByRoomNumber(dormitoryId, data.roomNumber);
    if (existing) {
      const err = new Error(`หมายเลขห้อง ${data.roomNumber} มีอยู่แล้วในหอพักนี้`);
      (err as any).code = 'ROOM_NUMBER_ALREADY_EXISTS';
      (err as any).statusCode = 409;
      throw err;
    }

    // 3. Check Building Scope if provided
    if (data.buildingId) {
      const building = await this.buildingRepo.findById(data.buildingId, dormitoryId);
      if (!building) {
        const err = new Error('ไม่อนุญาตให้เชื่อมโยงกับอาคารต่างหอพักหรืออาคารที่ไม่พบ');
        (err as any).code = 'CROSS_DORMITORY_RELATION_DENIED';
        (err as any).statusCode = 403;
        throw err;
      }
    }

    const room = await this.roomRepo.create(dormitoryId, data);

    if (this.auditService && actorUserId) {
      await this.auditService.log({
        userId: actorUserId,
        action: 'ROOM_CREATED',
        source: 'property',
        reason: `Created room ${room.roomNumber}`,
        metadata: { dormitoryId, roomId: room.id },
      });
    }

    return room;
  }

  public async updateRoom(
    id: string,
    dormitoryId: string,
    data: Partial<RoomEntity>,
    expectedVersion?: number,
    actorUserId?: string
  ) {
    const room = await this.getRoomById(id, dormitoryId);

    // Prevent direct client tampering of occupancy fields
    delete (data as any).currentTenantId;
    delete (data as any).currentContractId;

    if (data.roomNumber && data.roomNumber !== room.roomNumber) {
      const existing = await this.roomRepo.findByRoomNumber(dormitoryId, data.roomNumber);
      if (existing && existing.id !== id) {
        const err = new Error(`หมายเลขห้อง ${data.roomNumber} มีอยู่แล้วในหอพักนี้`);
        (err as any).code = 'ROOM_NUMBER_ALREADY_EXISTS';
        (err as any).statusCode = 409;
        throw err;
      }
    }

    if (data.buildingId && data.buildingId !== room.buildingId) {
      const building = await this.buildingRepo.findById(data.buildingId, dormitoryId);
      if (!building) {
        const err = new Error('ไม่อนุญาตให้เชื่อมโยงกับอาคารต่างหอพักหรืออาคารที่ไม่พบ');
        (err as any).code = 'CROSS_DORMITORY_RELATION_DENIED';
        (err as any).statusCode = 403;
        throw err;
      }
    }

    const updated = await this.roomRepo.update(id, dormitoryId, data, expectedVersion);

    if (this.auditService && actorUserId && updated) {
      await this.auditService.log({
        userId: actorUserId,
        action: 'ROOM_UPDATED',
        source: 'property',
        reason: `Updated room ${updated.roomNumber}`,
        metadata: { dormitoryId, roomId: id },
      });
    }

    return updated;
  }

  public async archiveRoom(id: string, dormitoryId: string, actorUserId?: string) {
    const room = await this.getRoomById(id, dormitoryId);

    if (room.currentContractId || room.currentTenantId || room.status === 'occupied') {
      const err = new Error('ไม่สามารถเก็บหรือลบห้องพักที่มีผู้เช่าหรือสัญญาที่ใช้งานอยู่ได้');
      (err as any).code = 'ROOM_HAS_ACTIVE_CONTRACT';
      (err as any).statusCode = 409;
      throw err;
    }

    const activeContracts = await this.contractRepo.findActiveContractsForRoom(dormitoryId, id);
    if (activeContracts.length > 0) {
      const err = new Error('ไม่สามารถเก็บหรือลบห้องพักที่มีสัญญาเปิดใช้งานอยู่ได้');
      (err as any).code = 'ROOM_HAS_ACTIVE_CONTRACT';
      (err as any).statusCode = 409;
      throw err;
    }

    const archived = await this.roomRepo.archive(id, dormitoryId);

    if (this.auditService && actorUserId && archived) {
      await this.auditService.log({
        userId: actorUserId,
        action: 'ROOM_ARCHIVED',
        source: 'property',
        reason: `Archived room ${archived.roomNumber}`,
        metadata: { dormitoryId, roomId: id },
      });
    }

    return archived;
  }

  public async getAvailableRooms(dormitoryId: string, startDateStr: string, endDateStr: string, buildingId?: string) {
    const startDate = new Date(startDateStr);
    const endDate = new Date(endDateStr);

    const { items: allRooms } = await this.roomRepo.findAll(dormitoryId, { buildingId, pageSize: 1000 });
    const availableRooms = [];

    for (const room of allRooms) {
      const overlapping = await this.contractRepo.findOverlappingContractsForRoom(
        dormitoryId,
        room.id,
        startDate,
        endDate
      );
      if (overlapping.length === 0) {
        availableRooms.push(room);
      }
    }

    return availableRooms;
  }
}
