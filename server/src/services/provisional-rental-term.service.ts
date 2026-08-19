/**
 * @license Apache-2.0
 * Provisional Rental Term Service (LOCAL-07 Batch 01)
 * Contractless Monthly / Term Rental Terms foundation for Owner-created tenants.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { getPrismaClient } from '../db/prisma.js';
import { AuditService } from './audit.service.js';
import { toDecimal, mulDecimals, formatDecimal } from '../utils/decimal-math.util.js';

export interface CreateProvisionalRentalTermDto {
  roomId: string;
  fullName: string;
  phone?: string | null;
  rentalType: 'MONTHLY' | 'TERM';
  startDate: string;
  durationMonths?: number;
  unitRentAmount: string | number;
  totalRentAmount?: string | number;
  termInstallmentCount?: number;
}

/**
 * Calculates end date as startDate + N calendar months - 1 day
 */
export function calculateRentalEndDate(startDateStr: string, months: number): Date {
  const [y, m, d] = startDateStr.split('-').map(Number);
  const startObj = new Date(Date.UTC(y, m - 1, d));

  let targetYear = y;
  let targetMonth = (m - 1) + months; // 0-indexed month
  targetYear += Math.floor(targetMonth / 12);
  targetMonth = targetMonth % 12;

  // Last day of the target month
  const maxDayInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(d, maxDayInTargetMonth);

  // Target anniversary date
  const targetAnniversary = new Date(Date.UTC(targetYear, targetMonth, targetDay));
  // Subtract 1 day
  targetAnniversary.setUTCDate(targetAnniversary.getUTCDate() - 1);
  return targetAnniversary;
}

export class ProvisionalRentalTermService {
  constructor(
    private prisma: PrismaClient = getPrismaClient(),
    private auditService?: AuditService
  ) {}

  public async createProvisionalTenantAndTerm(
    dormitoryId: string,
    data: CreateProvisionalRentalTermDto,
    userId?: string
  ) {
    const fullNameClean = data.fullName.trim();
    if (!fullNameClean) {
      const err = new Error('ชื่อ-นามสกุลจำเป็นต้องระบุ');
      (err as any).statusCode = 400;
      (err as any).code = 'VALIDATION_ERROR';
      throw err;
    }

    const phoneClean = data.phone && data.phone.trim() !== '' ? data.phone.trim() : null;

    const [sy, sm, sd] = data.startDate.split('-').map(Number);
    const startDate = new Date(Date.UTC(sy, sm - 1, sd));

    const todayStr = new Date().toISOString().slice(0, 10);
    const isFuture = data.startDate > todayStr;

    let durationMonths = 1;
    let endDate: Date;
    let unitRent: string;
    let totalRent: string;
    let termMonthsSnapshot: number | null = null;
    let termInstallmentCount: number | null = null;

    if (data.rentalType === 'MONTHLY') {
      durationMonths = Math.max(1, data.durationMonths || 1);
      endDate = calculateRentalEndDate(data.startDate, durationMonths);
      unitRent = formatDecimal(toDecimal(String(data.unitRentAmount)));
      totalRent = data.totalRentAmount !== undefined
        ? formatDecimal(toDecimal(String(data.totalRentAmount)))
        : formatDecimal(mulDecimals(toDecimal(unitRent), durationMonths.toString()));
    } else {
      // TERM
      unitRent = formatDecimal(toDecimal(String(data.unitRentAmount)));
      totalRent = data.totalRentAmount !== undefined
        ? formatDecimal(toDecimal(String(data.totalRentAmount)))
        : unitRent;
      termInstallmentCount = data.termInstallmentCount || 1;
      termMonthsSnapshot = data.durationMonths || null;
      durationMonths = data.durationMonths || 1;
      endDate = calculateRentalEndDate(data.startDate, durationMonths);
    }

    return this.prisma.$transaction(async (tx) => {
      // Room advisory lock to prevent concurrent double-submit or race conditions
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${dormitoryId + ':' + data.roomId}))`;

      const room = await tx.room.findFirst({
        where: { id: data.roomId, dormitoryId, deletedAt: null },
      });

      if (!room) {
        const err = new Error('ไม่พบห้องพักที่ระบุ');
        (err as any).statusCode = 404;
        (err as any).code = 'ROOM_NOT_FOUND';
        throw err;
      }

      if (data.rentalType === 'TERM') {
        const building = room.buildingId ? await tx.building.findUnique({ where: { id: room.buildingId } }) : null;
        termMonthsSnapshot = data.durationMonths || building?.termMonths || 6;
        termInstallmentCount = data.termInstallmentCount || building?.maxTermRentInstallments || 1;
        durationMonths = termMonthsSnapshot;
        endDate = calculateRentalEndDate(data.startDate, termMonthsSnapshot);
      }

      // Check overlap with active/reserved contracts
      const overlappingContract = await tx.contract.findFirst({
        where: {
          dormitoryId,
          roomId: data.roomId,
          status: { in: ['active', 'expiring_soon', 'pending_signature', 'waiting_extension', 'checking_out', 'draft'] },
          deletedAt: null,
          startDate: { lte: endDate },
          endDate: { gte: startDate },
        },
      });

      if (overlappingContract) {
        const err = new Error('ห้องพักมีสัญญาที่ทับซ้อนกับช่วงเวลาดังกล่าว');
        (err as any).statusCode = 409;
        (err as any).code = 'ROOM_OCCUPIED_OR_HAS_ACTIVE_AGREEMENT';
        throw err;
      }

      // Check overlap with active/reserved provisional rental terms
      const overlappingProvisional = await tx.provisionalRentalTerm.findFirst({
        where: {
          dormitoryId,
          roomId: data.roomId,
          status: { in: ['RESERVED', 'ACTIVE'] },
          deletedAt: null,
          startDate: { lte: endDate },
          endDate: { gte: startDate },
        },
      });

      if (overlappingProvisional) {
        const err = new Error('ห้องพักมีการจองหรือข้อตกลงชั่วคราวที่ทับซ้อนกับช่วงเวลาดังกล่าว');
        (err as any).statusCode = 409;
        (err as any).code = 'ROOM_OCCUPIED_OR_HAS_ACTIVE_AGREEMENT';
        throw err;
      }

      // If starting now/past, check active occupancy
      if (!isFuture) {
        const activeOccupancy = await tx.occupancy.findFirst({
          where: {
            dormitoryId,
            roomId: data.roomId,
            status: 'ACTIVE',
          },
        });
        if (activeOccupancy) {
          const err = new Error('ห้องพักมีผู้พักอาศัยอยู่แล้วในปัจจุบัน');
          (err as any).statusCode = 409;
          (err as any).code = 'ROOM_OCCUPIED_OR_HAS_ACTIVE_AGREEMENT';
          throw err;
        }
      }

      // Authoritative tenant number generation
      const tenantCount = await tx.tenant.count({ where: { dormitoryId } });
      const tenantNumber = `TNT-${Date.now()}-${(tenantCount + 1).toString().padStart(4, '0')}`;

      // 1. Create Tenant losslessly
      const tenant = await tx.tenant.create({
        data: {
          dormitoryId,
          tenantNumber,
          firstName: fullNameClean,
          lastName: null,
          displayName: fullNameClean,
          phone: phoneClean,
          status: 'active',
        },
      });

      // 2. Create Occupancy
      const occupancy = await tx.occupancy.create({
        data: {
          dormitoryId,
          roomId: data.roomId,
          tenantId: tenant.id,
          status: isFuture ? 'RESERVED' : 'ACTIVE',
          startedAt: isFuture ? startDate : new Date(),
        },
      });

      // 3. Create ProvisionalRentalTerm
      const termStatus = isFuture ? 'RESERVED' : 'ACTIVE';
      const provisionalTerm = await tx.provisionalRentalTerm.create({
        data: {
          dormitoryId,
          roomId: data.roomId,
          tenantId: tenant.id,
          occupancyId: occupancy.id,
          rentalType: data.rentalType,
          startDate,
          endDate,
          durationMonths,
          unitRentAmount: unitRent,
          totalRentAmount: totalRent,
          termMonthsSnapshot,
          termInstallmentCount,
          status: termStatus,
          createdByUserId: userId && /^[0-9a-fA-F-]{36}$/.test(userId) ? userId : null,
        },
      });

      // 4. Update Room status
      if (!isFuture) {
        await tx.room.update({
          where: { id: data.roomId },
          data: {
            status: 'occupied',
            currentTenantId: tenant.id,
          },
        });
      } else {
        // If room is vacant, mark as reserved (do NOT mark occupied before start date)
        if (room.status === 'vacant') {
          await tx.room.update({
            where: { id: data.roomId },
            data: {
              status: 'reserved',
            },
          });
        }
      }

      if (this.auditService) {
        await this.auditService.log({
          dormitoryId,
          actorUserId: userId || 'system',
          action: 'provisional_rental_term.create',
          resourceType: 'provisional_rental_term',
          resourceId: provisionalTerm.id,
          details: {
            roomId: data.roomId,
            tenantId: tenant.id,
            rentalType: data.rentalType,
            status: termStatus,
            startDate: data.startDate,
            endDate: endDate.toISOString().slice(0, 10),
          },
        });
      }

      return {
        tenant,
        occupancy,
        provisionalTerm,
      };
    });
  }

  public async findActiveProvisionalTermForRoom(
    dormitoryId: string,
    roomId: string,
    asOfDate: Date = new Date(),
    tx?: Prisma.TransactionClient
  ) {
    const client = tx || this.prisma;
    return client.provisionalRentalTerm.findFirst({
      where: {
        dormitoryId,
        roomId,
        status: 'ACTIVE',
        deletedAt: null,
        startDate: { lte: asOfDate },
        endDate: { gte: asOfDate },
      },
      include: {
        tenant: true,
        room: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  public async findProvisionalTermById(
    id: string,
    dormitoryId: string,
    tx?: Prisma.TransactionClient
  ) {
    const client = tx || this.prisma;
    return client.provisionalRentalTerm.findFirst({
      where: { id, dormitoryId, deletedAt: null },
      include: {
        tenant: true,
        room: true,
      },
    });
  }
}

export const provisionalRentalTermService = new ProvisionalRentalTermService();
