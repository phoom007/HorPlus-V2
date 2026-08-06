import { IBuildingRepository, BuildingEntity, BuildingFilterQuery, CreateBuildingData } from '../db/repositories/building.repository.js';
import { IRoomRepository } from '../db/repositories/room.repository.js';
import { AuditService } from './audit.service.js';

export class BuildingService {
  constructor(
    private buildingRepo: IBuildingRepository,
    private roomRepo: IRoomRepository,
    private auditService?: AuditService
  ) {}

  public async getBuildings(dormitoryId: string, filter?: BuildingFilterQuery) {
    return this.buildingRepo.findAll(dormitoryId, filter);
  }

  public async getBuildingById(id: string, dormitoryId: string) {
    const b = await this.buildingRepo.findById(id, dormitoryId);
    if (!b) {
      const err = new Error('ไม่พบข้อมูลอาคารที่ระบุ');
      (err as any).code = 'BUILDING_NOT_FOUND';
      (err as any).statusCode = 404;
      throw err;
    }
    return b;
  }

  public async createBuilding(dormitoryId: string, data: CreateBuildingData, actorUserId?: string, txClient?: any) {
    const { getPrismaClient } = await import('../db/prisma.js');
    const runInTx = async (tx: any) => {
      const existingName = await tx.building.findFirst({
        where: { dormitoryId, name: data.name, deletedAt: null },
      });
      if (existingName) {
        const err = new Error('ชื่ออาคารนี้มีอยู่แล้วในระบบ');
        (err as any).code = 'BUILDING_NAME_ALREADY_EXISTS';
        (err as any).statusCode = 409;
        throw err;
      }

      if (data.code) {
        const existingCode = await tx.building.findFirst({
          where: { dormitoryId, code: data.code, deletedAt: null },
        });
        if (existingCode) {
          const err = new Error('รหัสอาคารนี้มีอยู่แล้วในระบบ');
          (err as any).code = 'BUILDING_CODE_ALREADY_EXISTS';
          (err as any).statusCode = 409;
          throw err;
        }
      }

      const building = await tx.building.create({
        data: {
          dormitoryId,
          name: data.name,
          code: data.code || null,
          floorCount: data.floorCount || 1,
          description: data.description || null,
          displayOrder: data.displayOrder || 0,
          numberingPattern: data.numberingPattern || null,
          version: 1,
        },
      });

      await tx.auditLog.create({
        data: {
          dormitoryId,
          actorUserId: actorUserId || null,
          entityType: 'BUILDING',
          entityId: building.id,
          action: 'BUILDING_CREATED',
          beforeValues: null,
          afterValues: building as any,
          reason: `Created building ${building.name}`,
        },
      });

      return building;
    };

    if (txClient) {
      return runInTx(txClient);
    }
    const prisma = getPrismaClient();
    const result = await prisma.$transaction(runInTx);

    if (this.auditService && actorUserId) {
      await this.auditService.log({
        userId: actorUserId,
        action: 'BUILDING_CREATED',
        source: 'property',
        reason: `Created building ${result.name}`,
        metadata: { dormitoryId, buildingId: result.id },
      });
    }

    return result;
  }

  public async updateBuilding(
    id: string,
    dormitoryId: string,
    data: Record<string, any>,
    actorUserId?: string,
    txClient?: any
  ) {
    const { expectedVersion, ...changes } = data;
    const targetVersion = expectedVersion !== undefined ? expectedVersion : (data as any).version;

    const { getPrismaClient } = await import('../db/prisma.js');
    const runInTx = async (tx: any) => {
      const existing = await tx.building.findFirst({
        where: { id, dormitoryId, deletedAt: null },
      });
      if (!existing) {
        const err = new Error('ไม่พบข้อมูลอาคาร');
        (err as any).code = 'BUILDING_NOT_FOUND';
        (err as any).statusCode = 404;
        throw err;
      }

      if (targetVersion !== undefined && existing.version !== targetVersion) {
        const err = new Error('ข้อมูลอาคารถูกแก้ไขโดยผู้อื่น กรุณาโหลดข้อมูลใหม่');
        (err as any).code = 'VERSION_CONFLICT';
        (err as any).statusCode = 409;
        (err as any).currentVersion = existing.version;
        throw err;
      }

      const fieldsProtectingParsing = ['code', 'numberingPattern', 'floorCount'];
      const isParsingFieldChanged = fieldsProtectingParsing.some(
        (field) => changes[field] !== undefined && changes[field] !== existing[field]
      );

      if (isParsingFieldChanged) {
        const roomCount = await tx.room.count({
          where: { dormitoryId, buildingId: id, deletedAt: null },
        });
        if (roomCount > 0) {
          const err = new Error('ไม่สามารถเปลี่ยนการตั้งค่ารหัสและรูปแบบของอาคารได้เนื่องจากมีห้องพักในอาคารนี้แล้ว');
          (err as any).code = 'BUILDING_HAS_ROOMS';
          (err as any).statusCode = 409;
          throw err;
        }
      }

      if (changes.name) {
        const existingName = await tx.building.findFirst({
          where: { dormitoryId, name: changes.name, deletedAt: null, NOT: { id } },
        });
        if (existingName) {
          const err = new Error('ชื่ออาคารนี้มีอยู่แล้วในระบบ');
          (err as any).code = 'BUILDING_NAME_ALREADY_EXISTS';
          (err as any).statusCode = 409;
          throw err;
        }
      }

      if (changes.code) {
        const existingCode = await tx.building.findFirst({
          where: { dormitoryId, code: changes.code, deletedAt: null, NOT: { id } },
        });
        if (existingCode) {
          const err = new Error('รหัสอาคารนี้มีอยู่แล้วในระบบ');
          (err as any).code = 'BUILDING_CODE_ALREADY_EXISTS';
          (err as any).statusCode = 409;
          throw err;
        }
      }

      const updateRes = await tx.building.updateMany({
        where: { id, dormitoryId, deletedAt: null, version: targetVersion ?? existing.version },
        data: {
          ...changes,
          version: { increment: 1 },
        },
      });

      if (updateRes.count === 0) {
        const safeCurrent = await tx.building.findUnique({ where: { id } });
        const err = new Error('ข้อมูลอาคารถูกแก้ไขโดยผู้อื่น กรุณาโหลดข้อมูลใหม่');
        (err as any).code = 'VERSION_CONFLICT';
        (err as any).statusCode = 409;
        (err as any).currentVersion = safeCurrent?.version || 1;
        throw err;
      }

      const updated = await tx.building.findUnique({ where: { id } });

      await tx.auditLog.create({
        data: {
          dormitoryId,
          actorUserId: actorUserId || null,
          entityType: 'BUILDING',
          entityId: id,
          action: 'BUILDING_UPDATED',
          beforeValues: existing as any,
          afterValues: updated as any,
          reason: `Updated building ${updated?.name}`,
        },
      });

      return updated;
    };

    if (txClient) {
      return runInTx(txClient);
    }
    const prisma = getPrismaClient();
    const result = await prisma.$transaction(runInTx);

    if (this.auditService && actorUserId && result) {
      await this.auditService.log({
        userId: actorUserId,
        action: 'BUILDING_UPDATED',
        source: 'property',
        reason: `Updated building ${result.name}`,
        metadata: { dormitoryId, buildingId: id },
      });
    }

    return result;
  }

  public async archiveBuilding(
    id: string,
    dormitoryId: string,
    expectedVersionOrUser?: number | string,
    actorUserId?: string,
    txClient?: any
  ) {
    let targetVersion: number | undefined = undefined;
    let effectiveUserId: string | undefined = actorUserId;

    if (typeof expectedVersionOrUser === 'number') {
      targetVersion = expectedVersionOrUser;
    } else if (typeof expectedVersionOrUser === 'string') {
      effectiveUserId = expectedVersionOrUser;
    }

    const { getPrismaClient } = await import('../db/prisma.js');
    const runInTx = async (tx: any) => {
      const existing = await tx.building.findFirst({
        where: { id, dormitoryId, deletedAt: null },
      });
      if (!existing) {
        const err = new Error('ไม่พบข้อมูลอาคาร');
        (err as any).code = 'BUILDING_NOT_FOUND';
        (err as any).statusCode = 404;
        throw err;
      }

      if (targetVersion !== undefined && existing.version !== targetVersion) {
        const err = new Error('ข้อมูลอาคารถูกแก้ไขโดยผู้อื่น กรุณาโหลดข้อมูลใหม่');
        (err as any).code = 'VERSION_CONFLICT';
        (err as any).statusCode = 409;
        (err as any).currentVersion = existing.version;
        throw err;
      }

      const activeRooms = await tx.room.count({
        where: { dormitoryId, buildingId: id, deletedAt: null },
      });
      if (activeRooms > 0) {
        const err = new Error('ไม่สามารถลบหรือเก็บอาคารที่มีห้องพักเปิดใช้งานอยู่ได้');
        (err as any).code = 'BUILDING_HAS_ACTIVE_ROOMS';
        (err as any).statusCode = 409;
        throw err;
      }

      const updateRes = await tx.building.updateMany({
        where: { id, dormitoryId, deletedAt: null, version: targetVersion ?? existing.version },
        data: {
          deletedAt: new Date(),
          version: { increment: 1 },
        },
      });

      if (updateRes.count === 0) {
        const safeCurrent = await tx.building.findUnique({ where: { id } });
        const err = new Error('ข้อมูลอาคารถูกแก้ไขโดยผู้อื่น กรุณาโหลดข้อมูลใหม่');
        (err as any).code = 'VERSION_CONFLICT';
        (err as any).statusCode = 409;
        (err as any).currentVersion = safeCurrent?.version || 1;
        throw err;
      }

      const archived = await tx.building.findUnique({ where: { id } });

      await tx.auditLog.create({
        data: {
          dormitoryId,
          actorUserId: effectiveUserId || null,
          entityType: 'BUILDING',
          entityId: id,
          action: 'BUILDING_ARCHIVED',
          beforeValues: existing as any,
          afterValues: archived as any,
          reason: `Archived building ${existing.name}`,
        },
      });

      return archived;
    };

    if (txClient) {
      return runInTx(txClient);
    }
    const prisma = getPrismaClient();
    const result = await prisma.$transaction(runInTx);

    if (this.auditService && effectiveUserId && result) {
      await this.auditService.log({
        userId: effectiveUserId,
        action: 'BUILDING_ARCHIVED',
        source: 'property',
        reason: `Archived building ${result.name}`,
        metadata: { dormitoryId, buildingId: id },
      });
    }

    return result;
  }
}
