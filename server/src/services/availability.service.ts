import { getPrismaClient } from '../db/prisma.js';
import { AppError } from '../types/index.js';

export interface RoomAvailabilityOptions {
  dormitoryId: string;
  startDate: string;
  endDate: string;
  buildingId?: string;
  roomId?: string;
}

export interface RoomAvailabilityResult {
  roomId: string;
  roomNumber: string;
  buildingId: string;
  isAvailable: boolean;
  blockingReason?: string;
}

export class AvailabilityService {
  /**
   * Evaluates availability of a single Room or all Rooms in a Dormitory for a date interval
   * Overlap rule: existingStart < requestedEnd AND existingEnd > requestedStart
   */
  public async getAvailableRooms(options: RoomAvailabilityOptions): Promise<any[]> {
    const { dormitoryId, startDate, endDate, buildingId } = options;

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new AppError('วันที่ระบุไม่ถูกต้อง', 400, 'VALIDATION_ERROR');
    }

    if (start >= end) {
      throw new AppError('วันเริ่มต้นต้องมาก่อนวันสิ้นสุด', 400, 'VALIDATION_ERROR');
    }

    const prisma = getPrismaClient();

    // 1. Fetch all active/non-archived rooms in the dormitory (optionally filtered by building)
    const roomWhere: any = {
      dormitoryId,
      status: { notIn: ['archived', 'maintenance'] },
      deletedAt: null,
    };
    if (buildingId) {
      roomWhere.buildingId = buildingId;
    }

    const rooms = await prisma.room.findMany({
      where: roomWhere,
      include: {
        building: true,
      },
    });

    // 2. Query all overlapping blocking contracts for this dormitory
    // Blocking statuses: active, approved, expiring_soon, waiting_extension, checking_out
    const blockingContracts = await prisma.contract.findMany({
      where: {
        dormitoryId,
        deletedAt: null,
        status: { in: ['active', 'approved', 'expiring_soon', 'waiting_extension', 'checking_out'] },
        startDate: { lt: end },
        endDate: { gt: start },
      },
    });

    const blockedRoomIds = new Set(blockingContracts.map((c) => c.roomId));

    // 3. Query all active occupancies overlapping the interval
    const blockingOccupancies = await prisma.occupancy.findMany({
      where: {
        dormitoryId,
        status: 'ACTIVE',
        startedAt: { lt: end },
        OR: [
          { endedAt: null },
          { endedAt: { gt: start } },
        ],
      },
    });

    blockingOccupancies.forEach((occ) => blockedRoomIds.add(occ.roomId));

    // 4. Filter rooms that are available
    const availableRooms = rooms
      .filter((room) => !blockedRoomIds.has(room.id))
      .map((room) => ({
        ...room,
        buildingName: room.building?.name || 'Building',
      }));

    return availableRooms;
  }

  /**
   * Check if a specific Room is available for a date interval
   */
  public async isRoomAvailable(options: RoomAvailabilityOptions): Promise<boolean> {
    const availableRooms = await this.getAvailableRooms(options);
    return availableRooms.some((r) => r.id === options.roomId);
  }
}

export const availabilityService = new AvailabilityService();
