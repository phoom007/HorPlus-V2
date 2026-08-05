import { IRoomRepository } from '../db/repositories/room.repository.js';
import { IBuildingRepository } from '../db/repositories/building.repository.js';
import { ISubscriptionRepository } from '../db/repositories/subscription.repository.js';
import { IContractRepository } from '../db/repositories/contract.repository.js';
import { AuditService } from './audit.service.js';
import { AppError } from '../types/index.js';
import { subscriptionEntitlementService } from './subscription-entitlement.service.js';

export interface RoomFilterQuery {
  buildingId?: string;
  floor?: number;
  status?: string;
  roomType?: string;
  page?: number;
  pageSize?: number;
}

export class RoomService {
  private contractRepo: IContractRepository;
  private auditService?: AuditService;

  constructor(
    private roomRepo: IRoomRepository,
    private buildingRepo: IBuildingRepository,
    private subRepo: ISubscriptionRepository,
    arg4?: any,
    arg5?: any,
    arg6?: any,
    arg7?: any,
    private prisma?: any
  ) {
    if (arg4 && typeof arg4.findActiveContractsForRoom === 'function') {
      this.contractRepo = arg4;
      this.auditService = arg5;
      this.prisma = arg7 || prisma;
    } else {
      this.contractRepo = arg5;
      this.auditService = arg6;
      this.prisma = arg7 || prisma;
    }
  }

  public async checkRoomLimit(dormitoryId: string, tx?: any): Promise<void> {
    const db = tx || this.prisma;
    if (db && typeof db.$executeRaw === 'function') {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${dormitoryId}))`;
    }

    await subscriptionEntitlementService.assertRoomCreationAllowed(dormitoryId, new Date(), tx);
  }

  public async getRooms(dormitoryId: string, filter?: RoomFilterQuery) {
    const result = await this.roomRepo.findAll(dormitoryId, filter);
    const buildingsResult = await this.buildingRepo.findAll(dormitoryId);

    const buildingMap = new Map(
      buildingsResult.items.map((b: any) => [b.id, b.name])
    );

    const items = result.items.map((room: any) => ({
      ...room,
      buildingName: buildingMap.get(room.buildingId) || 'Building'
    }));

    return {
      items,
      total: result.total,
      page: filter?.page || 1,
      pageSize: filter?.pageSize || 20,
      totalPages: Math.ceil(result.total / (filter?.pageSize || 20))
    };
  }

  public async getAvailableRooms(dormitoryId: string, _startDate?: string, _endDate?: string, buildingId?: string) {
    const result = await this.roomRepo.findAll(dormitoryId, { buildingId, status: 'vacant' });
    return result.items;
  }

  public async getRoomById(id: string, dormitoryId: string) {
    const room = await this.roomRepo.findById(id, dormitoryId);
    if (!room) {
      throw new AppError('ไม่พบข้อมูลห้องพัก', 404, 'ROOM_NOT_FOUND');
    }

    const building = await this.buildingRepo.findById(room.buildingId, dormitoryId);

    return {
      ...room,
      buildingName: building ? building.name : 'Building'
    };
  }

  public async createRoom(dormIdOrData: any, dataOrDormId?: any, userId?: string) {
    let dormitoryId: string;
    let data: any;

    if (typeof dormIdOrData === 'string') {
      dormitoryId = dormIdOrData;
      data = dataOrDormId;
    } else {
      data = dormIdOrData;
      dormitoryId = dataOrDormId;
    }

    if (this.prisma && typeof this.prisma.$transaction === 'function') {
      return await this.prisma.$transaction(async (tx: any) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${dormitoryId}))`;

        await subscriptionEntitlementService.assertRoomCreationAllowed(dormitoryId, new Date(), tx);

        const created = await this.roomRepo.create(dormitoryId, data, tx);

        if (this.auditService && userId) {
          this.auditService.logSecurityEvent({
            userId,
            dormitoryId,
            action: 'ROOM_CREATED',
            reason: `Created room ${data.roomNumber}`,
            severity: 'info'
          });
        }

        return created;
      });
    }

    await this.checkRoomLimit(dormitoryId);
    const created = await this.roomRepo.create(dormitoryId, data);

    if (this.auditService && userId) {
      this.auditService.logSecurityEvent({
        userId,
        dormitoryId,
        action: 'ROOM_CREATED',
        reason: `Created room ${data.roomNumber}`,
        severity: 'info'
      });
    }

    return created;
  }

  public async updateRoom(id: string, dataOrDormId: any, dormIdOrData?: any, userId?: string) {
    let targetDormId: string = typeof dormIdOrData === 'string' ? dormIdOrData : (typeof dataOrDormId === 'string' ? dataOrDormId : id);
    let targetData: any = typeof dataOrDormId === 'object' ? dataOrDormId : (typeof dormIdOrData === 'object' ? dormIdOrData : dataOrDormId);

    await subscriptionEntitlementService.assertDormitoryWritable(targetDormId);

    const existing = await this.roomRepo.findById(id, targetDormId);
    if (!existing) {
      throw new AppError('ไม่พบข้อมูลห้องพัก', 404, 'ROOM_NOT_FOUND');
    }

    const updated = await this.roomRepo.update(id, targetDormId, targetData);

    if (this.auditService && userId) {
      this.auditService.logSecurityEvent({
        userId,
        dormitoryId: targetDormId,
        action: 'ROOM_UPDATED',
        reason: `Updated room ${existing.roomNumber}`,
        severity: 'info'
      });
    }

    return updated;
  }

  public async archiveRoom(id: string, dormitoryId: string, userId?: string) {
    let targetDormId = typeof dormitoryId === 'string' ? dormitoryId : (typeof userId === 'string' ? userId : id);

    await subscriptionEntitlementService.assertDormitoryWritable(targetDormId);

    const existing = await this.roomRepo.findById(id, targetDormId);
    if (!existing) {
      throw new AppError('ไม่พบข้อมูลห้องพัก', 404, 'ROOM_NOT_FOUND');
    }

    const activeContracts = await this.contractRepo.findActiveContractsForRoom(id, targetDormId);
    if (activeContracts && activeContracts.length > 0) {
      throw new AppError('ไม่สามารถยกเลิกห้องที่มีผู้เช่าอยู่ได้', 400, 'ROOM_HAS_ACTIVE_TENANT');
    }

    const archived = await this.roomRepo.archive(id, targetDormId);

    if (this.auditService && userId) {
      this.auditService.logSecurityEvent({
        userId,
        dormitoryId: targetDormId,
        action: 'ROOM_ARCHIVED',
        reason: `Archived room ${existing.roomNumber}`,
        severity: 'info'
      });
    }

    return archived;
  }
}
