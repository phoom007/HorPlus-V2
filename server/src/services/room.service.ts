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

export interface UpdateRoomCommand {
  roomId: string;
  dormitoryId: string;
  changes: Record<string, any>;
  expectedVersion: number;
  actorUserId?: string;
  requestId?: string;
}

export interface ArchiveRoomCommand {
  roomId: string;
  dormitoryId: string;
  expectedVersion: number;
  actorUserId?: string;
  requestId?: string;
}

export class RoomService {
  private contractRepo: IContractRepository;
  private auditService?: AuditService;
  private prisma?: any;

  constructor(
    private roomRepo: IRoomRepository,
    private buildingRepo: IBuildingRepository,
    private subRepo: ISubscriptionRepository,
    arg4?: any,
    arg5?: any,
    arg6?: any,
    arg7?: any,
    prisma?: any
  ) {
    if (arg4 && typeof arg4.findActiveContractsForRoom === 'function') {
      this.contractRepo = arg4;
      this.auditService = arg5;
    } else {
      this.contractRepo = arg5;
      this.auditService = arg6;
    }

    const detectedPrisma = [arg4, arg5, arg6, arg7, prisma].find((x) => x && typeof x.$transaction === 'function');
    this.prisma = detectedPrisma || prisma;
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

    let entitledRoomIds = new Set<string>();
    try {
      const sub = await subscriptionEntitlementService.getCurrentSubscription(dormitoryId);
      const roomLimit = sub.plan.roomLimit || 10;
      const allActiveRooms = await this.roomRepo.findAll(dormitoryId);
      const activeEligible = (allActiveRooms.items || []).filter((r: any) => r.status !== 'archived');
      activeEligible.sort((a: any, b: any) => {
        const timeA = new Date(a.createdAt || 0).getTime();
        const timeB = new Date(b.createdAt || 0).getTime();
        if (timeA !== timeB) return timeA - timeB;
        return (a.id || '').localeCompare(b.id || '');
      });
      entitledRoomIds = new Set(activeEligible.slice(0, roomLimit).map((r: any) => r.id));
    } catch {
      // Fallback: mark entitled if subscription check unavailable
    }

    const items = result.items.map((room: any) => ({
      ...room,
      buildingName: buildingMap.get(room.buildingId) || 'Building',
      isEntitled: entitledRoomIds.size > 0 ? entitledRoomIds.has(room.id) : true,
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

  public async createRoom(dormIdOrData: any, dataOrDormId?: any, userId?: string, txClient?: any) {
    let dormitoryId: string;
    let data: any;

    if (typeof dormIdOrData === 'string') {
      dormitoryId = dormIdOrData;
      data = dataOrDormId;
    } else {
      data = dormIdOrData;
      dormitoryId = dataOrDormId;
    }

    const { normalizeRoomNumber, validateRoomNumberInput } = await import('../utils/room-number.normalizer.js');
    const { getPrismaClient } = await import('../db/prisma.js');

    const validation = validateRoomNumberInput(data.roomNumber);
    if (!validation.isValid) {
      throw new AppError(validation.errorMessage || 'หมายเลขห้องพักไม่ถูกต้อง', 400, 'VALIDATION_ERROR');
    }

    const normalizedRoomNumber = validation.normalized;

    const runInTx = async (tx: any) => {
      // Check Building exists and is not archived
      const building = await tx.building.findFirst({
        where: { id: data.buildingId, dormitoryId, deletedAt: null },
      });
      if (!building) {
        throw new AppError('ไม่พบข้อมูลอาคารที่ระบุ', 404, 'BUILDING_NOT_FOUND');
      }

      if (building.status === 'archived') {
        throw new AppError('ไม่สามารถเพิ่มห้องพักในอาคารที่ถูกจัดเก็บแล้วได้', 400, 'BUILDING_ARCHIVED');
      }

      // Check Dormitory-scoped Duplicate Room
      const existingRoom = await tx.room.findFirst({
        where: {
          dormitoryId,
          normalizedRoomNumber,
          deletedAt: null,
        },
      });

      if (existingRoom) {
        throw new AppError(
          `หมายเลขห้องพัก "${data.roomNumber}" มีอยู่แล้วในหอพักนี้`,
          409,
          'ROOM_NUMBER_ALREADY_EXISTS'
        );
      }

      if (typeof tx.$executeRaw === 'function') {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${dormitoryId}))`;
      }

      // Seed cycle deposits from DormitoryPropertyDefaults.defaultDeposit if omitted
      const dormPropertyDefaults = tx.dormitoryPropertyDefaults
        ? await tx.dormitoryPropertyDefaults.findUnique({
            where: { dormitoryId },
          })
        : null;
      const defaultDepositStr = dormPropertyDefaults?.defaultDeposit ? String(dormPropertyDefaults.defaultDeposit) : '0.00';

      const termDeposit = data.termDeposit !== undefined && data.termDeposit !== null ? data.termDeposit : (data.depositAmount || defaultDepositStr);
      const monthlyDeposit = data.monthlyDeposit !== undefined && data.monthlyDeposit !== null ? data.monthlyDeposit : (data.depositAmount || defaultDepositStr);
      const dailyDeposit = data.dailyDeposit !== undefined && data.dailyDeposit !== null ? data.dailyDeposit : (data.depositAmount || defaultDepositStr);

      const created = await tx.room.create({
        data: {
          dormitoryId,
          buildingId: data.buildingId,
          roomNumber: data.roomNumber,
          normalizedRoomNumber,
          floor: data.floor || 1,
          roomType: data.roomType || 'standard',
          status: data.status || 'vacant',
          rentCycle: data.rentCycle || 'monthly',
          monthlyRent: data.monthlyRent || null,
          termRent: data.termRent || null,
          dailyRent: data.dailyRent || null,
          termDeposit,
          monthlyDeposit,
          dailyDeposit,
          depositAmount: data.depositAmount || monthlyDeposit,
          parkingFee: data.parkingFee || null,
          maximumOccupants: data.maximumOccupants || 2,
          waterMeterNumber: data.waterMeterNumber || null,
          electricityMeterNumber: data.electricityMeterNumber || null,
          initialWaterReading: data.initialWaterReading || '0.00',
          initialElectricityReading: data.initialElectricityReading || '0.00',
          amenities: data.amenities || [],
          images: data.images || [],
          notes: data.notes || null,
          version: 1,
        },
      });

      await tx.auditLog.create({
        data: {
          dormitoryId,
          actorUserId: userId || null,
          entityType: 'ROOM',
          entityId: created.id,
          action: 'ROOM_CREATED',
          beforeValues: null,
          afterValues: created as any,
          reason: `Created room ${data.roomNumber}`,
        },
      });

      return created;
    };

    try {
      if (txClient) {
        return await runInTx(txClient);
      }
      const prisma = getPrismaClient();
      const created = await prisma.$transaction(runInTx);

      if (this.auditService && userId) {
        await this.auditService.logSecurityEvent({
          userId,
          dormitoryId,
          action: 'ROOM_CREATED',
          reason: `Created room ${data.roomNumber}`,
          severity: 'info',
        });
      }

      return created;
    } catch (err: any) {
      if (err.code === 'P2002') {
        throw new AppError(
          `หมายเลขห้องพัก "${data.roomNumber}" มีอยู่แล้วในหอพักนี้`,
          409,
          'ROOM_NUMBER_ALREADY_EXISTS'
        );
      }
      throw err;
    }
  }

  public async updateRoom(command: UpdateRoomCommand, txClient?: any) {
    const { roomId: id, dormitoryId: targetDormId, changes, expectedVersion, actorUserId: userId } = command;

    if (expectedVersion === undefined || typeof expectedVersion !== 'number') {
      throw new AppError('ต้องระบุ expectedVersion สำหรับการแก้ไขข้อมูลห้องพัก', 400, 'VALIDATION_ERROR');
    }

    await subscriptionEntitlementService.assertDormitoryWritable(targetDormId);

    const { getPrismaClient } = await import('../db/prisma.js');

    const runInTx = async (tx: any) => {
      const existing = await tx.room.findFirst({
        where: { id, dormitoryId: targetDormId, deletedAt: null },
      });

      if (!existing) {
        throw new AppError('ไม่พบข้อมูลห้องพัก', 404, 'ROOM_NOT_FOUND');
      }

      if (existing.version !== expectedVersion) {
        const err: any = new AppError('ข้อมูลห้องพักถูกแก้ไขโดยผู้อื่น กรุณาโหลดข้อมูลใหม่', 409, 'VERSION_CONFLICT');
        err.currentVersion = existing.version;
        throw err;
      }

      let normalizedRoomNumber = existing.normalizedRoomNumber;
      if (changes.roomNumber) {
        const { validateRoomNumberInput } = await import('../utils/room-number.normalizer.js');
        const validation = validateRoomNumberInput(changes.roomNumber);
        if (!validation.isValid) {
          throw new AppError(validation.errorMessage || 'หมายเลขห้องพักไม่ถูกต้อง', 400, 'VALIDATION_ERROR');
        }
        normalizedRoomNumber = validation.normalized;

        if (normalizedRoomNumber !== existing.normalizedRoomNumber) {
          const duplicate = await tx.room.findFirst({
            where: {
              dormitoryId: targetDormId,
              normalizedRoomNumber,
              id: { not: id },
              deletedAt: null,
            },
          });
          if (duplicate) {
            throw new AppError(
              `หมายเลขห้องพัก "${changes.roomNumber}" มีอยู่แล้วในหอพักนี้`,
              409,
              'ROOM_NUMBER_ALREADY_EXISTS'
            );
          }
        }
      }

      const finalChanges = { ...changes };
      if (finalChanges.depositAmount !== undefined && finalChanges.depositInheritsBuildingDefault === undefined) {
        if (finalChanges.depositAmount !== null) {
          finalChanges.depositInheritsBuildingDefault = false;
        } else {
          finalChanges.depositInheritsBuildingDefault = true;
        }
      }

      const updateRes = await tx.room.updateMany({
        where: { id, dormitoryId: targetDormId, deletedAt: null, version: expectedVersion },
        data: {
          ...finalChanges,
          normalizedRoomNumber,
          version: { increment: 1 },
        },
      });

      if (updateRes.count === 0) {
        const safeCurrent = await tx.room.findUnique({ where: { id } });
        const err: any = new AppError('ข้อมูลห้องพักถูกแก้ไขโดยผู้อื่น กรุณาโหลดข้อมูลใหม่', 409, 'VERSION_CONFLICT');
        err.currentVersion = safeCurrent?.version || 1;
        throw err;
      }

      const updated = await tx.room.findUnique({ where: { id } });

      await tx.auditLog.create({
        data: {
          dormitoryId: targetDormId,
          actorUserId: userId || null,
          entityType: 'ROOM',
          entityId: id,
          action: 'ROOM_UPDATED',
          beforeValues: existing as any,
          afterValues: updated as any,
          reason: `Updated room ${existing.roomNumber}`,
        },
      });

      return updated;
    };

    try {
      if (txClient) {
        return await runInTx(txClient);
      }
      const prisma = getPrismaClient();
      const updated = await prisma.$transaction(runInTx);

      if (this.auditService && userId) {
        await this.auditService.logSecurityEvent({
          userId,
          dormitoryId: targetDormId,
          action: 'ROOM_UPDATED',
          reason: `Updated room ${updated.roomNumber}`,
          severity: 'info',
        });
      }

      return updated;
    } catch (err: any) {
      if (err.code === 'P2002') {
        throw new AppError(
          `หมายเลขห้องพัก "${changes.roomNumber || ''}" มีอยู่แล้วในหอพักนี้`,
          409,
          'ROOM_NUMBER_ALREADY_EXISTS'
        );
      }
      throw err;
    }
  }

  public async archiveRoom(command: ArchiveRoomCommand, txClient?: any) {
    const { roomId: id, dormitoryId: targetDormId, expectedVersion, actorUserId: effectiveUserId } = command;

    if (expectedVersion === undefined || typeof expectedVersion !== 'number') {
      throw new AppError('ต้องระบุ expectedVersion สำหรับการจัดเก็บห้องพัก', 400, 'VALIDATION_ERROR');
    }

    await subscriptionEntitlementService.assertDormitoryWritable(targetDormId);

    const { getPrismaClient } = await import('../db/prisma.js');

    const runInTx = async (tx: any) => {
      const existing = await tx.room.findFirst({
        where: { id, dormitoryId: targetDormId, deletedAt: null },
      });
      if (!existing) {
        throw new AppError('ไม่พบข้อมูลห้องพัก', 404, 'ROOM_NOT_FOUND');
      }

      if (existing.version !== expectedVersion) {
        const err: any = new AppError('ข้อมูลห้องพักถูกแก้ไขโดยผู้อื่น กรุณาโหลดข้อมูลใหม่', 409, 'VERSION_CONFLICT');
        err.currentVersion = existing.version;
        throw err;
      }

      const activeContracts = await tx.contract.findMany({
        where: {
          roomId: id,
          dormitoryId: targetDormId,
          status: { in: ['active', 'approved', 'expiring_soon', 'waiting_extension', 'checking_out'] },
        },
      });

      if (activeContracts && activeContracts.length > 0) {
        throw new AppError('ไม่สามารถยกเลิกห้องที่มีผู้เช่าอยู่ได้', 400, 'ROOM_HAS_ACTIVE_TENANT');
      }

      const updateRes = await tx.room.updateMany({
        where: { id, dormitoryId: targetDormId, deletedAt: null, version: expectedVersion },
        data: {
          deletedAt: new Date(),
          version: { increment: 1 },
        },
      });

      if (updateRes.count === 0) {
        const safeCurrent = await tx.room.findUnique({ where: { id } });
        const err: any = new AppError('ข้อมูลห้องพักถูกแก้ไขโดยผู้อื่น กรุณาโหลดข้อมูลใหม่', 409, 'VERSION_CONFLICT');
        err.currentVersion = safeCurrent?.version || 1;
        throw err;
      }

      const archived = await tx.room.findUnique({ where: { id } });

      await tx.auditLog.create({
        data: {
          dormitoryId: targetDormId,
          actorUserId: effectiveUserId || null,
          entityType: 'ROOM',
          entityId: id,
          action: 'ROOM_ARCHIVED',
          beforeValues: existing as any,
          afterValues: archived as any,
          reason: `Archived room ${existing.roomNumber}`,
        },
      });

      return archived;
    };

    if (txClient) {
      return await runInTx(txClient);
    }
    const prisma = getPrismaClient();
    const archived = await prisma.$transaction(runInTx);

    if (this.auditService && effectiveUserId) {
      await this.auditService.logSecurityEvent({
        userId: effectiveUserId,
        dormitoryId: targetDormId,
        action: 'ROOM_ARCHIVED',
        reason: `Archived room ${archived.roomNumber}`,
        severity: 'info',
      });
    }

    return archived;
  }
}
