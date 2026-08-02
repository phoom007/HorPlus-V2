import { IRoomRepository, RoomEntity, RoomFilterQuery, CreateRoomData } from '../db/repositories/room.repository.js';
import { IBuildingRepository } from '../db/repositories/building.repository.js';
import { ISubscriptionRepository } from '../db/repositories/subscription.repository.js';
import { IPlanRepository } from '../db/repositories/plan.repository.js';
import { IContractRepository } from '../db/repositories/contract.repository.js';
import { AuditService } from './audit.service.js';
import { parseRoomIdentifier } from '../utils/normalization.js';

import crypto from 'crypto';
import { EntitlementService } from './entitlement.service.js';

export class RoomService {
  private entitlementService: EntitlementService;

  constructor(
    private roomRepo: IRoomRepository,
    private buildingRepo: IBuildingRepository,
    private subRepo: ISubscriptionRepository,
    private planRepo: IPlanRepository,
    private contractRepo: IContractRepository,
    private auditService?: AuditService,
    entitlementService?: EntitlementService,
    private prisma?: any
  ) {
    this.entitlementService = entitlementService || new EntitlementService(this.subRepo, this.planRepo);
  }

  public async getRooms(dormitoryId: string, filter?: RoomFilterQuery) {
    const result = await this.roomRepo.findAll(dormitoryId, filter);
    const buildingsResult = await this.buildingRepo.findAll(dormitoryId);

    const decoratedItems = result.items.map(room => {
      const b = buildingsResult.items.find(bld => bld.id === room.buildingId);
      const bConfig = b ? { code: b.code, numberingPattern: b.numberingPattern, floorCount: b.floorCount } : { code: null, numberingPattern: null, floorCount: 1 };
      const parsed = parseRoomIdentifier(bConfig, room.roomNumber);
      return { ...room, derivedFloor: parsed.isValid ? parsed.derivedFloor : null, error: parsed.isValid ? undefined : parsed.error };
    });

    return { ...result, items: decoratedItems };
  }

  public async getRoomById(id: string, dormitoryId: string) {
    const r = await this.roomRepo.findById(id, dormitoryId);
    if (!r) {
      const err = new Error('ไม่พบข้อมูลห้องพักที่ระบุ');
      (err as any).code = 'ROOM_NOT_FOUND';
      (err as any).statusCode = 404;
      throw err;
    }
    
    let bConfig = { code: null, numberingPattern: null, floorCount: 1 };
    if (r.buildingId) {
      const b = await this.buildingRepo.findById(r.buildingId, dormitoryId);
      if (b) {
        bConfig = { code: b.code as any, numberingPattern: b.numberingPattern as any, floorCount: b.floorCount as any };
      }
    }
    const parsed = parseRoomIdentifier(bConfig, r.roomNumber);
    
    return { ...r, derivedFloor: parsed.isValid ? parsed.derivedFloor : null, error: parsed.isValid ? undefined : parsed.error };
  }

  public async checkRoomLimit(dormitoryId: string, tx?: any): Promise<void> {
    const entitlement = await this.entitlementService.resolveDormitoryEntitlement(dormitoryId);

    let currentCount: number;
    if (tx && typeof tx.room?.count === 'function') {
      currentCount = await tx.room.count({
        where: { dormitoryId, deletedAt: null, status: { not: 'archived' } }
      });
    } else {
      currentCount = await this.roomRepo.countActiveByDormitory(dormitoryId);
    }

    if (currentCount >= entitlement.roomLimit) {
      const err = new Error(`จำนวนห้องพักเกินโควต้าแพ็กเกจ (${entitlement.roomLimit} ห้อง)`);
      (err as any).code = 'ROOM_LIMIT_EXCEEDED';
      (err as any).statusCode = 409;
      throw err;
    }
  }

  public async createRoom(dormitoryId: string, data: CreateRoomData, actorUserId?: string) {
    const executeCreate = async (tx?: any) => {
      if (tx && typeof tx.$executeRawUnsafe === 'function') {
        const lockKey = String(BigInt(`0x${crypto.createHash('md5').update(dormitoryId).digest('hex').substring(0, 15)}`) % BigInt(2147483647));
        await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`);
      }

      // 1. Check Room Limit
      await this.checkRoomLimit(dormitoryId, tx);

      // 2. Check Uniqueness
      const tempBConfig = data.buildingId 
        ? await this.buildingRepo.findById(data.buildingId, dormitoryId)
        : null;
      const preParse = parseRoomIdentifier(tempBConfig ? { code: tempBConfig.code as any, numberingPattern: tempBConfig.numberingPattern as any, floorCount: tempBConfig.floorCount as any } : { code: null, numberingPattern: null, floorCount: 1 }, data.roomNumber);

      if (data.buildingId) {
        const building = await this.buildingRepo.findById(data.buildingId, dormitoryId);
        if (!building) {
          const err = new Error('ไม่อนุญาตให้เชื่อมโยงกับอาคารต่างหอพักหรืออาคารที่ไม่พบ');
          (err as any).code = 'CROSS_DORMITORY_RELATION_DENIED';
          (err as any).statusCode = 403;
          throw err;
        }
        
        const parsed = parseRoomIdentifier({ code: building.code as any, numberingPattern: building.numberingPattern as any, floorCount: building.floorCount as any, roomsPerFloor: (building as any).roomsPerFloor }, data.roomNumber);
        if (!parsed.isValid) {
          const err = new Error(`รูปแบบหมายเลขห้องไม่ถูกต้อง: ${parsed.error}`);
          (err as any).code = 'INVALID_ROOM_NUMBER_FORMAT';
          (err as any).statusCode = 422;
          throw err;
        }
        data.roomNumber = parsed.displayValue;
        data.normalizedRoomNumber = parsed.normalizedValue;
      } else {
        const parsed = parseRoomIdentifier({ code: null, numberingPattern: null, floorCount: 1 }, data.roomNumber);
        if (!parsed.isValid) {
          const err = new Error(`รูปแบบหมายเลขห้องไม่ถูกต้อง: ${parsed.error}`);
          (err as any).code = 'INVALID_ROOM_NUMBER_FORMAT';
          (err as any).statusCode = 422;
          throw err;
        }
        data.roomNumber = parsed.displayValue;
        data.normalizedRoomNumber = parsed.normalizedValue;
      }

      try {
        const room = await this.roomRepo.create(dormitoryId, data, tx);
        if (this.auditService && actorUserId) {
          await this.auditService.log({
            userId: actorUserId,
            action: 'ROOM_CREATED',
            source: 'property',
            reason: `Created room ${room.roomNumber}`,
            ipMetadata: { dormitoryId, roomId: room.id },
          });
        }
        return room;
      } catch (e: any) {
        if (e.code === 'P2002') {
          const err = new Error(`หมายเลขห้อง ${data.roomNumber} มีอยู่แล้วในหอพัก`);
          (err as any).code = 'ROOM_NUMBER_ALREADY_EXISTS';
          (err as any).statusCode = 409;
          throw err;
        }
        throw e;
      }
    };

    if (this.prisma && typeof this.prisma.$transaction === 'function') {
      return this.prisma.$transaction(executeCreate);
    }

    return executeCreate();
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

    // We will rely on P2002 unique constraint error below instead of checking findByRoomNumber,
    // since uniqueness is now scoped to buildingId + normalizedRoomNumber.

    if (data.buildingId && data.buildingId !== room.buildingId) {
      const building = await this.buildingRepo.findById(data.buildingId, dormitoryId);
      if (!building) {
        const err = new Error('ไม่อนุญาตให้เชื่อมโยงกับอาคารต่างหอพักหรืออาคารที่ไม่พบ');
        (err as any).code = 'CROSS_DORMITORY_RELATION_DENIED';
        (err as any).statusCode = 403;
        throw err;
      }
    }

    if (data.roomNumber || data.buildingId) {
      const bId = data.buildingId || room.buildingId;
      let bConfig = { code: null, numberingPattern: null, floorCount: 1 };
      if (bId) {
        const b = await this.buildingRepo.findById(bId, dormitoryId);
        if (b) bConfig = { code: b.code as any, numberingPattern: b.numberingPattern as any, floorCount: b.floorCount as any };
      }
      const roomNumToCheck = data.roomNumber || room.roomNumber;
      
      const parsed = parseRoomIdentifier(bConfig, roomNumToCheck);
      if (!parsed.isValid) {
        const err = new Error(`รูปแบบหมายเลขห้องไม่ถูกต้อง: ${parsed.error}`);
        (err as any).code = 'INVALID_ROOM_NUMBER_FORMAT';
        (err as any).statusCode = 422;
        throw err;
      }
      data.roomNumber = parsed.displayValue;
      (data as any).normalizedRoomNumber = parsed.normalizedValue;
    }

    let updated;
    try {
      updated = await this.roomRepo.update(id, dormitoryId, data, expectedVersion);
    } catch (e: any) {
      if (e.code === 'P2002') {
        const err = new Error(`หมายเลขห้อง ${data.roomNumber || room.roomNumber} มีอยู่แล้วในหอพัก`);
        (err as any).code = 'ROOM_NUMBER_ALREADY_EXISTS';
        (err as any).statusCode = 409;
        throw err;
      }
      throw e;
    }

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
        ipMetadata: { dormitoryId, roomId: id },
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
