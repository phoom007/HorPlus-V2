import { IRoomRepository } from '../db/repositories/room.repository.js';
import { IBuildingRepository } from '../db/repositories/building.repository.js';
import { ITenantRepository } from '../db/repositories/tenant.repository.js';
import { IContractRepository } from '../db/repositories/contract.repository.js';
import { parseRoomIdentifier } from '../utils/normalization.js';
import { getPrismaClient } from '../db/prisma.js';
import { logger } from '../config/logger.js';

export interface OccupancySummary {
  totalRooms: number;
  occupiedRooms: number;
  vacantRooms: number;
  reservedRooms: number;
  maintenanceRooms: number;
  occupancyRate: number; // percentage e.g. 85.5
  totalTenants: number;
  activeContracts: number;
  expiringContracts: number;
  buildingsSummary: Array<{
    buildingId: string;
    buildingName: string;
    totalRooms: number;
    occupiedRooms: number;
    vacantRooms: number;
    occupancyRate: number;
  }>;
}

export interface FloorPlanView {
  buildingId: string;
  buildingName: string;
  floors: Array<{
    floorNumber: number;
    rooms: Array<{
      id: string;
      roomNumber: string;
      roomType: string;
      status: string;
      monthlyRent: string;
      currentTenantName?: string | null;
      contractEndDate?: Date | null;
    }>;
  }>;
}

export class OccupancyService {
  constructor(
    private roomRepo: IRoomRepository,
    private buildingRepo: IBuildingRepository,
    private tenantRepo: ITenantRepository,
    private contractRepo: IContractRepository
  ) {}

  public async getOccupancySummary(dormitoryId: string): Promise<OccupancySummary> {
    const { items: rooms } = await this.roomRepo.findAll(dormitoryId, { pageSize: 1000 });
    const { items: buildings } = await this.buildingRepo.findAll(dormitoryId, { pageSize: 100 });
    const totalTenants = await this.tenantRepo.countActiveByDormitory(dormitoryId);
    const activeContracts = await this.contractRepo.countActiveByDormitory(dormitoryId);
    const expiringContracts = await this.contractRepo.countExpiringByDormitory(dormitoryId, 30);

    let occupiedCount = 0;
    let vacantCount = 0;
    let reservedCount = 0;
    let maintenanceCount = 0;

    for (const r of rooms) {
      if (r.status === 'occupied') occupiedCount++;
      else if (r.status === 'vacant') vacantCount++;
      else if (r.status === 'reserved') reservedCount++;
      else if (r.status === 'maintenance') maintenanceCount++;
    }

    const totalRooms = rooms.length;
    const occupancyRate = totalRooms > 0 ? Number(((occupiedCount / totalRooms) * 100).toFixed(1)) : 0;

    const buildingsSummary = [];
    for (const b of buildings) {
      const bRooms = rooms.filter((r) => r.buildingId === b.id);
      const bTotal = bRooms.length;
      const bOccupied = bRooms.filter((r) => r.status === 'occupied').length;
      const bVacant = bRooms.filter((r) => r.status === 'vacant').length;
      const bRate = bTotal > 0 ? Number(((bOccupied / bTotal) * 100).toFixed(1)) : 0;

      buildingsSummary.push({
        buildingId: b.id,
        buildingName: b.name,
        totalRooms: bTotal,
        occupiedRooms: bOccupied,
        vacantRooms: bVacant,
        occupancyRate: bRate,
      });
    }

    return {
      totalRooms,
      occupiedRooms: occupiedCount,
      vacantRooms: vacantCount,
      reservedRooms: reservedCount,
      maintenanceRooms: maintenanceCount,
      occupancyRate,
      totalTenants,
      activeContracts,
      expiringContracts,
      buildingsSummary,
    };
  }

  public async getFloorPlanView(dormitoryId: string, buildingId?: string): Promise<FloorPlanView[]> {
    const { items: buildings } = await this.buildingRepo.findAll(dormitoryId, { pageSize: 100 });
    const { items: rooms } = await this.roomRepo.findAll(dormitoryId, { buildingId, pageSize: 1000 });

    const targetBuildings = buildingId ? buildings.filter((b) => b.id === buildingId) : buildings;
    const result: FloorPlanView[] = [];

    for (const b of targetBuildings) {
      const bRooms = rooms.filter((r) => r.buildingId === b.id);
      const floorMap = new Map<number, any[]>();

      for (const r of bRooms) {
        const bConfig = { code: b.code, numberingPattern: b.numberingPattern, floorCount: b.floorCount };
        const parsed = parseRoomIdentifier(bConfig as any, r.roomNumber);
        const floorToUse = parsed.isValid ? parsed.derivedFloor : 'error';
        if (!floorMap.has(floorToUse as any)) {
          floorMap.set(floorToUse as any, []);
        }

        let tenantName: string | null = null;
        let contractEndDate: Date | null = null;

        if (r.currentTenantId) {
          const tenant = await this.tenantRepo.findById(r.currentTenantId, dormitoryId);
          if (tenant) tenantName = tenant.displayName;
        }

        if (r.currentContractId) {
          const contract = await this.contractRepo.findById(r.currentContractId, dormitoryId);
          if (contract) contractEndDate = contract.endDate;
        }

        floorMap.get(floorToUse as any)!.push({
          id: r.id,
          roomNumber: r.roomNumber,
          roomType: r.roomType,
          status: r.status,
          monthlyRent: r.monthlyRent,
          currentTenantName: tenantName,
          contractEndDate,
        });
      }

      const floors = Array.from(floorMap.entries())
        .sort(([fA], [fB]) => String(fA).localeCompare(String(fB), undefined, { numeric: true }))
        .map(([floorNumber, fRooms]) => ({
          floorNumber,
          rooms: fRooms.sort((a, b) => a.roomNumber.localeCompare(b.roomNumber)),
        }));

      result.push({
        buildingId: b.id,
        buildingName: b.name,
        floors,
      });
    }

    return result;
  }

  public async moveOut(
    dormitoryId: string,
    roomId: string,
    moveOutDateStr: string,
    userId: string
  ) {
    const prisma = getPrismaClient();
    
    const moveOutDate = new Date(moveOutDateStr);
    if (isNaN(moveOutDate.getTime())) {
      const err: any = new Error('INVALID_DATE: วันที่ย้ายออกไม่ถูกต้อง');
      err.code = 'INVALID_DATE';
      err.status = 400;
      throw err;
    }

    const result = await prisma.$transaction(async (tx) => {
      const occupancy = await tx.occupancy.findFirst({ where: { roomId, status: 'ACTIVE' } });
      if (!occupancy || occupancy.dormitoryId !== dormitoryId) {
        const err: any = new Error('OCCUPANCY_NOT_FOUND: ไม่พบข้อมูลการพักอาศัยที่ยังเปิดใช้งานอยู่');
        err.code = 'OCCUPANCY_NOT_FOUND';
        err.status = 404;
        throw err;
      }
      
      const startedAt = new Date(occupancy.startedAt);
      if (moveOutDate < startedAt) {
        const err: any = new Error('INVALID_DATE: วันที่ย้ายออกต้องไม่ก่อนวันที่ย้ายเข้า');
        err.code = 'INVALID_DATE';
        err.status = 400;
        throw err;
      }

      // Row-level lock on the room to safely serialize concurrent operations on this specific room
      await tx.$executeRawUnsafe('SELECT id FROM rooms WHERE id = $1 FOR UPDATE', occupancy.roomId);

      const updatedOccupancy = await tx.occupancy.update({
        where: { id: occupancy.id },
        data: {
          status: 'ENDED',
          endedAt: moveOutDate,
          endedByUserId: userId,
          endedReason: 'Owner-initiated Move Out'
        }
      });

      await tx.room.update({
        where: { id: occupancy.roomId },
        data: {
          status: 'vacant',
          currentTenantId: null,
          currentContractId: null
        }
      });

      return updatedOccupancy;
    });

    logger.info({
      event: 'SECURITY_AUDIT',
      action: 'OWNER_MOVE_OUT',
      dormitoryId,
      occupancyId: result.id,
      actorUserId: userId
    });

    return result;
  }

  public async transferRoom(
    dormitoryId: string,
    sourceRoomId: string,
    targetRoomId: string,
    transferDateStr: string,
    userId: string
  ) {
    const prisma = getPrismaClient();
    
    const transferDate = new Date(transferDateStr);
    if (isNaN(transferDate.getTime())) {
      const err: any = new Error('INVALID_DATE: วันที่ย้ายห้องไม่ถูกต้อง');
      err.code = 'INVALID_DATE';
      err.status = 400;
      throw err;
    }

    const result = await prisma.$transaction(async (tx) => {
      const sourceOccupancy = await tx.occupancy.findFirst({ where: { roomId: sourceRoomId, status: 'ACTIVE' } });
      if (!sourceOccupancy || sourceOccupancy.dormitoryId !== dormitoryId) {
        const err: any = new Error('OCCUPANCY_NOT_FOUND: ไม่พบข้อมูลการพักอาศัยที่ยังเปิดใช้งานอยู่');
        err.code = 'OCCUPANCY_NOT_FOUND';
        err.status = 404;
        throw err;
      }

      if (sourceOccupancy.roomId === targetRoomId) {
        const err: any = new Error('SAME_ROOM: ห้องเป้าหมายเป็นห้องเดิม');
        err.code = 'SAME_ROOM';
        err.status = 400;
        throw err;
      }

      const startedAt = new Date(sourceOccupancy.startedAt);
      if (transferDate < startedAt) {
        const err: any = new Error('INVALID_DATE: วันที่ย้ายห้องต้องไม่ก่อนวันที่ย้ายเข้าเดิม');
        err.code = 'INVALID_DATE';
        err.status = 400;
        throw err;
      }

      const targetRoom = await tx.room.findUnique({ where: { id: targetRoomId } });
      if (!targetRoom || targetRoom.dormitoryId !== dormitoryId) {
        const err: any = new Error('ROOM_NOT_FOUND: ไม่พบห้องเป้าหมาย');
        err.code = 'ROOM_NOT_FOUND';
        err.status = 404;
        throw err;
      }
      if (targetRoom.status === 'occupied') {
        const err: any = new Error('ROOM_OCCUPIED: ห้องเป้าหมายไม่ว่าง');
        err.code = 'ROOM_OCCUPIED';
        err.status = 409;
        throw err;
      }

      // Row-level lock on both rooms to prevent concurrent modifications, sort IDs to prevent deadlocks
      const roomsToLock = [sourceOccupancy.roomId, targetRoomId].sort();
      await tx.$executeRawUnsafe('SELECT id FROM rooms WHERE id IN ($1, $2) FOR UPDATE', roomsToLock[0], roomsToLock[1]);

      // End source occupancy
      const endedOccupancy = await tx.occupancy.update({
        where: { id: sourceOccupancy.id },
        data: {
          status: 'ENDED',
          endedAt: transferDate,
          endedByUserId: userId,
          endedReason: 'Owner-initiated Transfer Room'
        }
      });

      // Update source room to vacant
      await tx.room.update({
        where: { id: sourceOccupancy.roomId },
        data: {
          status: 'vacant',
          currentTenantId: null,
          currentContractId: null
        }
      });

      // Create new occupancy
      const newOccupancy = await tx.occupancy.create({
        data: {
          dormitoryId,
          roomId: targetRoomId,
          tenantId: sourceOccupancy.tenantId,
          registrationId: sourceOccupancy.registrationId,
          contractId: sourceOccupancy.contractId,
          startedAt: transferDate,
          status: 'ACTIVE'
        }
      });

      // Update target room
      await tx.room.update({
        where: { id: targetRoomId },
        data: {
          status: 'occupied',
          currentTenantId: sourceOccupancy.tenantId,
          currentContractId: sourceOccupancy.contractId
        }
      });

      return { old: endedOccupancy, new: newOccupancy };
    });

    logger.info({
      event: 'SECURITY_AUDIT',
      action: 'OWNER_TRANSFER_ROOM',
      dormitoryId,
      sourceOccupancyId: result.old.id,
      targetRoomId,
      actorUserId: userId
    });

    return result;
  }
}
