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

  public async createBuilding(dormitoryId: string, data: CreateBuildingData, actorUserId?: string) {
    const existingName = await this.buildingRepo.findByName(dormitoryId, data.name);
    if (existingName) {
      const err = new Error('ชื่ออาคารนี้มีอยู่แล้วในระบบ');
      (err as any).code = 'BUILDING_NAME_ALREADY_EXISTS';
      (err as any).statusCode = 409;
      throw err;
    }

    if (data.code) {
      const existingCode = await this.buildingRepo.findByCode(dormitoryId, data.code);
      if (existingCode) {
        const err = new Error('รหัสอาคารนี้มีอยู่แล้วในระบบ');
        (err as any).code = 'BUILDING_CODE_ALREADY_EXISTS';
        (err as any).statusCode = 409;
        throw err;
      }
    }

    const building = await this.buildingRepo.create(dormitoryId, data);

    if (this.auditService && actorUserId) {
      await this.auditService.log({
        userId: actorUserId,
        action: 'BUILDING_CREATED',
        source: 'property',
        reason: `Created building ${building.name}`,
        metadata: { dormitoryId, buildingId: building.id },
      });
    }

    return building;
  }

  public async updateBuilding(id: string, dormitoryId: string, data: Partial<BuildingEntity> & { version?: number }, actorUserId?: string) {
    const existingBuilding = await this.getBuildingById(id, dormitoryId);

    if (data.version !== undefined && (existingBuilding as any).version !== data.version) {
      const err = new Error('ข้อมูลอาคารถูกแก้ไขโดยผู้อื่น กรุณาโหลดข้อมูลใหม่');
      (err as any).code = 'VERSION_CONFLICT';
      (err as any).statusCode = 409;
      (err as any).currentVersion = (existingBuilding as any).version;
      throw err;
    }

    const fieldsProtectingParsing = [
      'code',
      'numberingPattern',
      'floorCount'
    ];

    const isParsingFieldChanged = fieldsProtectingParsing.some(field => 
      (data as any)[field] !== undefined && (data as any)[field] !== (existingBuilding as any)[field]
    );

    if (isParsingFieldChanged) {
      const roomCount = await this.roomRepo.countActiveByBuilding(dormitoryId, id);
      if (roomCount > 0) {
        const err = new Error('ไม่สามารถเปลี่ยนการตั้งค่ารหัสและรูปแบบของอาคารได้เนื่องจากมีห้องพักในอาคารนี้แล้ว');
        (err as any).code = 'BUILDING_HAS_ROOMS';
        (err as any).statusCode = 409;
        throw err;
      }
    }

    if (data.name) {
      const existingName = await this.buildingRepo.findByName(dormitoryId, data.name);
      if (existingName && existingName.id !== id) {
        const err = new Error('ชื่ออาคารนี้มีอยู่แล้วในระบบ');
        (err as any).code = 'BUILDING_NAME_ALREADY_EXISTS';
        (err as any).statusCode = 409;
        throw err;
      }
    }

    if (data.code) {
      const existingCode = await this.buildingRepo.findByCode(dormitoryId, data.code);
      if (existingCode && existingCode.id !== id) {
        const err = new Error('รหัสอาคารนี้มีอยู่แล้วในระบบ');
        (err as any).code = 'BUILDING_CODE_ALREADY_EXISTS';
        (err as any).statusCode = 409;
        throw err;
      }
    }

    const updated = await this.buildingRepo.update(id, dormitoryId, data);

    if (this.auditService && actorUserId && updated) {
      await this.auditService.log({
        userId: actorUserId,
        action: 'BUILDING_UPDATED',
        source: 'property',
        reason: `Updated building ${updated.name}`,
        metadata: { dormitoryId, buildingId: id },
      });
    }

    return updated;
  }

  public async archiveBuilding(id: string, dormitoryId: string, actorUserId?: string) {
    await this.getBuildingById(id, dormitoryId);

    const activeRooms = await this.roomRepo.countActiveByBuilding(dormitoryId, id);
    if (activeRooms > 0) {
      const err = new Error('ไม่สามารถลบหรือเก็บอาคารที่มีห้องพักเปิดใช้งานอยู่ได้');
      (err as any).code = 'BUILDING_HAS_ACTIVE_ROOMS';
      (err as any).statusCode = 409;
      throw err;
    }

    const archived = await this.buildingRepo.archive(id, dormitoryId);

    if (this.auditService && actorUserId && archived) {
      await this.auditService.log({
        userId: actorUserId,
        action: 'BUILDING_ARCHIVED',
        source: 'property',
        reason: `Archived building ${archived.name}`,
        metadata: { dormitoryId, buildingId: id },
      });
    }

    return archived;
  }
}
