/**
 * @license Apache-2.0
 * Daily Stay Service (LOCAL-07 Batch 02)
 * Comprehensive Daily Stay Domain, Invoicing & Scheduled Lifecycle.
 */

import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../db/prisma.js';
import { AuditService } from './audit.service.js';
import { generateNextTenantNumber } from './tenant-number.service.js';
import { SubscriptionEntitlementService } from './subscription-entitlement.service.js';
import {
  toDecimal,
  addDecimals,
  mulDecimals,
  formatDecimal,
} from '../utils/decimal-math.util.js';

export interface CreateTenantDailyStayRequestDto {
  roomId: string;
  applicantFullName: string;
  applicantPhone?: string | null;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  dailyRateAmount?: string | number;
  depositAmount?: string | number;
  depositDeclaredStatus?: 'PAID' | 'UNPAID';
}

export interface OwnerQuickAddDailyStayDto {
  roomId: string;
  fullName: string;
  phone?: string | null;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  dailyRateAmount?: string | number;
  depositAmount?: string | number;
  depositDeclaredStatus?: 'PAID' | 'UNPAID';
}

export interface UpdatePendingDailyStayDto {
  dailyRateAmount?: string | number;
  depositAmount?: string | number;
  depositDeclaredStatus?: 'PAID' | 'UNPAID';
}

/**
 * Calculates calendar inclusive day count:
 * e.g., 2026-09-01 to 2026-09-03 = 3 days.
 */
export function calculateInclusiveDays(startDateStr: string, endDateStr: string): number {
  const [sy, sm, sd] = startDateStr.split('-').map(Number);
  const [ey, em, ed] = endDateStr.split('-').map(Number);

  const startUtc = Date.UTC(sy, sm - 1, sd);
  const endUtc = Date.UTC(ey, em - 1, ed);

  if (endUtc < startUtc) {
    const err = new Error('วันที่สิ้นสุดต้องไม่น้อยกว่าวันที่เริ่มพัก');
    (err as any).statusCode = 400;
    (err as any).code = 'INVALID_DATE_RANGE';
    throw err;
  }

  const diffDays = Math.round((endUtc - startUtc) / (24 * 3600 * 1000));
  return diffDays + 1;
}

export class DailyStayService {
  constructor(
    private prisma: PrismaClient = getPrismaClient(),
    private entitlementService: SubscriptionEntitlementService = new SubscriptionEntitlementService(),
    private auditService?: AuditService
  ) {}

  /**
   * Generates sequential daily stay invoice number for a dormitory:
   * Format: INV-D-YYYY-MM-XXXX
   */
  private async generateNextDailyInvoiceNumber(
    dormitoryId: string,
    tx: any
  ): Promise<string> {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const prefix = `INV-D-${year}-${month}-`;

    const lastInvoice = await tx.dailyStayInvoice.findFirst({
      where: {
        dormitoryId,
        invoiceNumber: { startsWith: prefix },
      },
      orderBy: { invoiceNumber: 'desc' },
      select: { invoiceNumber: true },
    });

    let nextSeq = 1;
    if (lastInvoice?.invoiceNumber) {
      const match = lastInvoice.invoiceNumber.slice(prefix.length).match(/^(\d+)/);
      if (match) {
        nextSeq = parseInt(match[1], 10) + 1;
      }
    }

    return `${prefix}${String(nextSeq).padStart(4, '0')}`;
  }

  /**
   * Helper: check date-range overlap with active contracts, provisional terms, and daily stays
   */
  public async checkRoomAvailability(
    dormitoryId: string,
    roomId: string,
    startDate: Date,
    endDate: Date,
    excludeDailyStayId?: string,
    txClient?: any
  ): Promise<{ available: boolean; reason?: string }> {
    const db = txClient || this.prisma;

    // 1. Check contracts
    const contractOverlap = await db.contract.findFirst({
      where: {
        dormitoryId,
        roomId,
        status: {
          in: ['active', 'expiring_soon', 'pending_signature', 'waiting_extension', 'checking_out', 'draft'],
        },
        deletedAt: null,
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
    });

    if (contractOverlap) {
      return { available: false, reason: 'ROOM_OCCUPIED_BY_CONTRACT' };
    }

    // 2. Check provisional rental terms
    const provisionalOverlap = await db.provisionalRentalTerm.findFirst({
      where: {
        dormitoryId,
        roomId,
        status: { in: ['RESERVED', 'ACTIVE'] },
        deletedAt: null,
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
    });

    if (provisionalOverlap) {
      return { available: false, reason: 'ROOM_OCCUPIED_BY_PROVISIONAL_TERM' };
    }

    // 3. Check daily stays
    const dailyOverlap = await db.dailyStay.findFirst({
      where: {
        dormitoryId,
        roomId,
        status: { in: ['RESERVED', 'ACTIVE'] },
        deletedAt: null,
        ...(excludeDailyStayId ? { id: { not: excludeDailyStayId } } : {}),
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
    });

    if (dailyOverlap) {
      return { available: false, reason: 'ROOM_OCCUPIED_BY_DAILY_STAY' };
    }

    return { available: true };
  }

  /**
   * Tenant creates Daily Stay Request (Option 2A):
   * Status: PENDING_APPROVAL
   * No Tenant row created. No Occupancy. No Invoice.
   */
  public async createTenantDailyStayRequest(
    dormitoryId: string,
    data: CreateTenantDailyStayRequestDto,
    requesterUserId?: string
  ) {
    const fullNameClean = data.applicantFullName?.trim();
    if (!fullNameClean) {
      const err = new Error('ชื่อ-นามสกุลจำเป็นต้องระบุ');
      (err as any).statusCode = 400;
      (err as any).code = 'VALIDATION_ERROR';
      throw err;
    }

    const phoneClean = data.applicantPhone && data.applicantPhone.trim() !== '' ? data.applicantPhone.trim() : null;

    // Validate operational room entitlement & existence
    await this.entitlementService.assertRoomOperationalEntitlement(dormitoryId, data.roomId);

    const [sy, sm, sd] = data.startDate.split('-').map(Number);
    const [ey, em, ed] = data.endDate.split('-').map(Number);
    const startDate = new Date(Date.UTC(sy, sm - 1, sd));
    const endDate = new Date(Date.UTC(ey, em - 1, ed));

    const inclusiveDayCount = calculateInclusiveDays(data.startDate, data.endDate);

    const room = await this.prisma.room.findFirst({
      where: { id: data.roomId, dormitoryId, deletedAt: null },
      include: { building: true },
    });

    if (!room) {
      const err = new Error('ไม่พบข้อมูลห้องพัก');
      (err as any).statusCode = 404;
      (err as any).code = 'ROOM_NOT_FOUND';
      throw err;
    }

    // Default daily rate from Room -> Building
    let dailyRate = '0.00';
    if (data.dailyRateAmount !== undefined && data.dailyRateAmount !== null) {
      dailyRate = formatDecimal(toDecimal(String(data.dailyRateAmount)));
    } else if (room.dailyRent) {
      dailyRate = formatDecimal(room.dailyRent);
    } else if (room.building?.dailyRent) {
      dailyRate = formatDecimal(room.building.dailyRent);
    }

    // Default deposit amount from Room -> Building (0 is explicitly valid)
    let deposit = '0.00';
    if (data.depositAmount !== undefined && data.depositAmount !== null) {
      deposit = formatDecimal(toDecimal(String(data.depositAmount)));
    } else if (room.depositAmount) {
      deposit = formatDecimal(room.depositAmount);
    } else if (room.building?.depositAmount) {
      deposit = formatDecimal(room.building.depositAmount);
    }

    const totalRent = formatDecimal(mulDecimals(toDecimal(dailyRate), inclusiveDayCount.toString()));
    const depositDeclaredStatus = data.depositDeclaredStatus || 'UNPAID';

    return this.prisma.dailyStay.create({
      data: {
        dormitoryId,
        roomId: data.roomId,
        requestSource: 'TENANT',
        applicantFullName: fullNameClean,
        applicantPhone: phoneClean,
        requesterUserId: requesterUserId || null,
        startDate,
        endDate,
        inclusiveDayCount,
        dailyRateAmount: toDecimal(dailyRate),
        totalRentAmount: toDecimal(totalRent),
        depositAmount: toDecimal(deposit),
        depositDeclaredStatus,
        status: 'PENDING_APPROVAL',
      },
      include: {
        room: true,
      },
    });
  }

  /**
   * Owner edits pending Daily Stay values before approval (Edit-Before-Approve):
   * Can edit dailyRateAmount, depositAmount, depositDeclaredStatus
   */
  public async updatePendingDailyStay(
    dormitoryId: string,
    stayId: string,
    data: UpdatePendingDailyStayDto,
    _userId?: string
  ) {
    const stay = await this.prisma.dailyStay.findFirst({
      where: { id: stayId, dormitoryId, deletedAt: null },
    });

    if (!stay) {
      const err = new Error('ไม่พบข้อมูลคำขอเข้าพักรายวัน');
      (err as any).statusCode = 404;
      (err as any).code = 'DAILY_STAY_NOT_FOUND';
      throw err;
    }

    if (stay.status !== 'PENDING_APPROVAL') {
      const err = new Error('สามารถแก้ไขได้เฉพาะคำขอที่อยู่ในสถานะรออนุมัติเท่านั้น');
      (err as any).statusCode = 400;
      (err as any).code = 'DAILY_STAY_NOT_PENDING';
      throw err;
    }

    let dailyRate = formatDecimal(stay.dailyRateAmount);
    if (data.dailyRateAmount !== undefined && data.dailyRateAmount !== null) {
      dailyRate = formatDecimal(toDecimal(String(data.dailyRateAmount)));
    }

    let deposit = formatDecimal(stay.depositAmount);
    if (data.depositAmount !== undefined && data.depositAmount !== null) {
      deposit = formatDecimal(toDecimal(String(data.depositAmount)));
    }

    const totalRent = formatDecimal(mulDecimals(toDecimal(dailyRate), stay.inclusiveDayCount.toString()));
    const depositDeclaredStatus = data.depositDeclaredStatus || stay.depositDeclaredStatus;

    return this.prisma.dailyStay.update({
      where: { id: stayId },
      data: {
        dailyRateAmount: toDecimal(dailyRate),
        totalRentAmount: toDecimal(totalRent),
        depositAmount: toDecimal(deposit),
        depositDeclaredStatus,
      },
      include: {
        room: true,
      },
    });
  }

  /**
   * Owner approves Daily Stay request:
   * In 1 atomic transaction:
   * 1. Advisory room lock
   * 2. Re-check availability and operational entitlement
   * 3. Create or reuse Tenant row losslessly
   * 4. Link DailyStay.tenantId
   * 5. Freeze financial snapshot
   * 6. Create exactly 1 DailyStayInvoice and 2 items (DAILY_RENT, DEPOSIT)
   * 7. Transition to ACTIVE or RESERVED
   * 8. Create Occupancy (DailyStay.occupancyId) and update Room status
   */
  public async approveDailyStay(
    dormitoryId: string,
    stayId: string,
    userId: string,
    txClient?: any
  ) {
    const runInTx = async (tx: any) => {
      const stay = await tx.dailyStay.findFirst({
        where: { id: stayId, dormitoryId, deletedAt: null },
      });

      if (!stay) {
        const err = new Error('ไม่พบข้อมูลคำขอเข้าพักรายวัน');
        (err as any).statusCode = 404;
        (err as any).code = 'DAILY_STAY_NOT_FOUND';
        throw err;
      }

      if (stay.status !== 'PENDING_APPROVAL') {
        const err = new Error('คำขอนี้ได้รับการดำเนินการไปแล้ว');
        (err as any).statusCode = 400;
        (err as any).code = 'DAILY_STAY_ALREADY_PROCESSED';
        throw err;
      }

      // 1. Advisory room lock
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${dormitoryId + ':' + stay.roomId}))`;

      // 2. Validate operational room entitlement
      await this.entitlementService.assertRoomOperationalEntitlement(dormitoryId, stay.roomId, new Date(), tx);

      // 3. Check room availability
      const availability = await this.checkRoomAvailability(
        dormitoryId,
        stay.roomId,
        stay.startDate,
        stay.endDate,
        stay.id,
        tx
      );

      if (!availability.available) {
        const err = new Error('ห้องพักมีผู้พักอาศัยหรือมีการจองที่ทับซ้อนกับช่วงเวลาดังกล่าว');
        (err as any).statusCode = 409;
        (err as any).code = 'ROOM_OCCUPIED_OR_HAS_ACTIVE_AGREEMENT';
        throw err;
      }

      const todayStr = new Date().toISOString().slice(0, 10);
      const stayStartStr = stay.startDate.toISOString().slice(0, 10);
      const isFuture = stayStartStr > todayStr;

      // 4. Create Tenant losslessly if not already linked
      let tenantId = stay.tenantId;
      if (!tenantId) {
        const tenantNumber = await generateNextTenantNumber(dormitoryId, tx);
        const tenant = await tx.tenant.create({
          data: {
            dormitoryId,
            tenantNumber,
            firstName: stay.applicantFullName || 'ผู้เช่ารายวัน',
            lastName: null,
            displayName: stay.applicantFullName || 'ผู้เช่ารายวัน',
            phone: stay.applicantPhone || null,
            status: 'active',
            linkedUserId: stay.requesterUserId || null,
          },
        });
        tenantId = tenant.id;
      }

      // 5. Create Occupancy
      const occupancy = await tx.occupancy.create({
        data: {
          dormitoryId,
          roomId: stay.roomId,
          tenantId,
          status: isFuture ? 'RESERVED' : 'ACTIVE',
          startedAt: isFuture ? stay.startDate : new Date(),
        },
      });

      // 6. Freeze financial snapshot & Calculate invoice totals
      const totalRent = formatDecimal(stay.totalRentAmount);
      const deposit = formatDecimal(stay.depositAmount);
      const totalAgreed = formatDecimal(addDecimals(toDecimal(totalRent), toDecimal(deposit)));
      const outstanding =
        stay.depositDeclaredStatus === 'PAID'
          ? totalRent
          : totalAgreed;

      const invoiceNumber = await this.generateNextDailyInvoiceNumber(dormitoryId, tx);

      const invoice = await tx.dailyStayInvoice.create({
        data: {
          dormitoryId,
          dailyStayId: stay.id,
          invoiceNumber,
          totalRentAmount: toDecimal(totalRent),
          depositAmount: toDecimal(deposit),
          totalAgreedAmount: toDecimal(totalAgreed),
          outstandingAmount: toDecimal(outstanding),
          depositDeclaredStatus: stay.depositDeclaredStatus,
          status: 'ISSUED',
          items: {
            create: [
              {
                itemType: 'DAILY_RENT',
                description: `ค่าเช่าห้องพักรายวัน (${stay.inclusiveDayCount} วัน)`,
                amount: toDecimal(totalRent),
                status: 'OUTSTANDING',
              },
              {
                itemType: 'DEPOSIT',
                description: 'เงินประกัน/มัดจำรายวัน',
                amount: toDecimal(deposit),
                status: stay.depositDeclaredStatus === 'PAID' ? 'DECLARED_PAID' : 'OUTSTANDING',
              },
            ],
          },
        },
        include: { items: true },
      });

      // 7. Update DailyStay record
      const updatedStay = await tx.dailyStay.update({
        where: { id: stay.id },
        data: {
          tenantId,
          occupancyId: occupancy.id,
          status: isFuture ? 'RESERVED' : 'ACTIVE',
          approvedAt: new Date(),
          approvedByUserId: userId,
        },
        include: {
          room: true,
          tenant: true,
          occupancy: true,
          invoice: { include: { items: true } },
        },
      });

      // 8. Update Room status
      if (!isFuture) {
        await tx.room.update({
          where: { id: stay.roomId },
          data: { status: 'occupied', currentTenantId: tenantId },
        });
      } else {
        const currentRoom = await tx.room.findUnique({ where: { id: stay.roomId } });
        if (currentRoom?.status === 'vacant') {
          await tx.room.update({
            where: { id: stay.roomId },
            data: { status: 'reserved' },
          });
        }
      }

      if (this.auditService) {
        await this.auditService.logSecurityEvent({
          action: 'daily_stay.approve',
          dormitoryId,
          userId,
          details: {
            stayId: stay.id,
            roomId: stay.roomId,
            invoiceNumber,
            totalAgreed,
            outstanding,
          },
        });
      }

      return updatedStay;
    };

    if (txClient) {
      return runInTx(txClient);
    }
    return this.prisma.$transaction(runInTx);
  }

  /**
   * Owner Quick Add Daily Stay (1-step atomic create & approve):
   */
  public async ownerQuickAddDailyStay(
    dormitoryId: string,
    data: OwnerQuickAddDailyStayDto,
    userId: string
  ) {
    const fullNameClean = data.fullName?.trim();
    if (!fullNameClean) {
      const err = new Error('ชื่อ-นามสกุลจำเป็นต้องระบุ');
      (err as any).statusCode = 400;
      (err as any).code = 'VALIDATION_ERROR';
      throw err;
    }

    const phoneClean = data.phone && data.phone.trim() !== '' ? data.phone.trim() : null;

    return this.prisma.$transaction(async (tx) => {
      // 1. Advisory room lock
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${dormitoryId + ':' + data.roomId}))`;

      // 2. Validate operational room entitlement
      await this.entitlementService.assertRoomOperationalEntitlement(dormitoryId, data.roomId, new Date(), tx);

      const room = await tx.room.findFirst({
        where: { id: data.roomId, dormitoryId, deletedAt: null },
        include: { building: true },
      });

      if (!room) {
        const err = new Error('ไม่พบข้อมูลห้องพัก');
        (err as any).statusCode = 404;
        (err as any).code = 'ROOM_NOT_FOUND';
        throw err;
      }

      const [sy, sm, sd] = data.startDate.split('-').map(Number);
      const [ey, em, ed] = data.endDate.split('-').map(Number);
      const startDate = new Date(Date.UTC(sy, sm - 1, sd));
      const endDate = new Date(Date.UTC(ey, em - 1, ed));

      const inclusiveDayCount = calculateInclusiveDays(data.startDate, data.endDate);

      // Check room availability
      const availability = await this.checkRoomAvailability(
        dormitoryId,
        data.roomId,
        startDate,
        endDate,
        undefined,
        tx
      );

      if (!availability.available) {
        const err = new Error('ห้องพักมีผู้พักอาศัยหรือมีการจองที่ทับซ้อนกับช่วงเวลาดังกล่าว');
        (err as any).statusCode = 409;
        (err as any).code = 'ROOM_OCCUPIED_OR_HAS_ACTIVE_AGREEMENT';
        throw err;
      }

      const todayStr = new Date().toISOString().slice(0, 10);
      const isFuture = data.startDate > todayStr;

      // Default daily rate from Room -> Building
      let dailyRate = '0.00';
      if (data.dailyRateAmount !== undefined && data.dailyRateAmount !== null) {
        dailyRate = formatDecimal(toDecimal(String(data.dailyRateAmount)));
      } else if (room.dailyRent) {
        dailyRate = formatDecimal(room.dailyRent);
      } else if (room.building?.dailyRent) {
        dailyRate = formatDecimal(room.building.dailyRent);
      }

      // Default deposit amount from Room -> Building (0 is explicitly valid)
      let deposit = '0.00';
      if (data.depositAmount !== undefined && data.depositAmount !== null) {
        deposit = formatDecimal(toDecimal(String(data.depositAmount)));
      } else if (room.depositAmount) {
        deposit = formatDecimal(room.depositAmount);
      } else if (room.building?.depositAmount) {
        deposit = formatDecimal(room.building.depositAmount);
      }

      const totalRent = formatDecimal(mulDecimals(toDecimal(dailyRate), inclusiveDayCount.toString()));
      const depositDeclaredStatus = data.depositDeclaredStatus || 'UNPAID';

      // 3. Create Tenant losslessly
      const tenantNumber = await generateNextTenantNumber(dormitoryId, tx);
      const tenant = await tx.tenant.create({
        data: {
          dormitoryId,
          tenantNumber,
          firstName: fullNameClean,
          lastName: null,
          displayName: fullNameClean,
          phone: phoneClean,
          status: 'active',
          linkedUserId: null,
        },
      });

      // 4. Create Occupancy
      const occupancy = await tx.occupancy.create({
        data: {
          dormitoryId,
          roomId: data.roomId,
          tenantId: tenant.id,
          status: isFuture ? 'RESERVED' : 'ACTIVE',
          startedAt: isFuture ? startDate : new Date(),
        },
      });

      // 5. Create DailyStay (approved directly)
      const dailyStay = await tx.dailyStay.create({
        data: {
          dormitoryId,
          roomId: data.roomId,
          tenantId: tenant.id,
          occupancyId: occupancy.id,
          requestSource: 'OWNER',
          applicantFullName: fullNameClean,
          applicantPhone: phoneClean,
          requesterUserId: userId,
          startDate,
          endDate,
          inclusiveDayCount,
          dailyRateAmount: toDecimal(dailyRate),
          totalRentAmount: toDecimal(totalRent),
          depositAmount: toDecimal(deposit),
          depositDeclaredStatus,
          status: isFuture ? 'RESERVED' : 'ACTIVE',
          approvedAt: new Date(),
          approvedByUserId: userId,
        },
      });

      // 6. Create DailyStayInvoice
      const totalAgreed = formatDecimal(addDecimals(toDecimal(totalRent), toDecimal(deposit)));
      const outstanding =
        depositDeclaredStatus === 'PAID'
          ? totalRent
          : totalAgreed;

      const invoiceNumber = await this.generateNextDailyInvoiceNumber(dormitoryId, tx);

      const invoice = await tx.dailyStayInvoice.create({
        data: {
          dormitoryId,
          dailyStayId: dailyStay.id,
          invoiceNumber,
          totalRentAmount: toDecimal(totalRent),
          depositAmount: toDecimal(deposit),
          totalAgreedAmount: toDecimal(totalAgreed),
          outstandingAmount: toDecimal(outstanding),
          depositDeclaredStatus,
          status: 'ISSUED',
          items: {
            create: [
              {
                itemType: 'DAILY_RENT',
                description: `ค่าเช่าห้องพักรายวัน (${inclusiveDayCount} วัน)`,
                amount: toDecimal(totalRent),
                status: 'OUTSTANDING',
              },
              {
                itemType: 'DEPOSIT',
                description: 'เงินประกัน/มัดจำรายวัน',
                amount: toDecimal(deposit),
                status: depositDeclaredStatus === 'PAID' ? 'DECLARED_PAID' : 'OUTSTANDING',
              },
            ],
          },
        },
        include: { items: true },
      });

      // 7. Update Room status
      if (!isFuture) {
        await tx.room.update({
          where: { id: data.roomId },
          data: { status: 'occupied', currentTenantId: tenant.id },
        });
      } else if (room.status === 'vacant') {
        await tx.room.update({
          where: { id: data.roomId },
          data: { status: 'reserved' },
        });
      }

      if (this.auditService) {
        await this.auditService.logSecurityEvent({
          action: 'daily_stay.quick_add',
          dormitoryId,
          userId,
          details: {
            stayId: dailyStay.id,
            roomId: data.roomId,
            invoiceNumber,
            totalAgreed,
            outstanding,
          },
        });
      }

      return {
        ...dailyStay,
        tenant,
        room,
        occupancy,
        invoice,
      };
    });
  }

  /**
   * Owner rejects pending Daily Stay request:
   * Marks status REJECTED without orphan tenant creation.
   */
  public async rejectDailyStay(
    dormitoryId: string,
    stayId: string,
    userId?: string
  ) {
    const stay = await this.prisma.dailyStay.findFirst({
      where: { id: stayId, dormitoryId, deletedAt: null },
    });

    if (!stay) {
      const err = new Error('ไม่พบข้อมูลคำขอเข้าพักรายวัน');
      (err as any).statusCode = 404;
      (err as any).code = 'DAILY_STAY_NOT_FOUND';
      throw err;
    }

    if (stay.status !== 'PENDING_APPROVAL') {
      const err = new Error('คำขอนี้ได้รับการดำเนินการไปแล้ว');
      (err as any).statusCode = 400;
      (err as any).code = 'DAILY_STAY_ALREADY_PROCESSED';
      throw err;
    }

    return this.prisma.dailyStay.update({
      where: { id: stayId },
      data: {
        status: 'REJECTED',
        deletedAt: new Date(),
      },
    });
  }

  /**
   * Early Checkout:
   * Transitions Daily Stay to CHECKED_OUT, ends Occupancy, frees room immediately.
   * Preserves DailyStayInvoice unchanged (no automatic refund).
   */
  public async checkoutDailyStay(
    dormitoryId: string,
    stayId: string,
    userId: string
  ) {
    return this.prisma.$transaction(async (tx) => {
      const stay = await tx.dailyStay.findFirst({
        where: { id: stayId, dormitoryId, deletedAt: null },
        include: { room: true },
      });

      if (!stay) {
        const err = new Error('ไม่พบข้อมูลการเข้าพักรายวัน');
        (err as any).statusCode = 404;
        (err as any).code = 'DAILY_STAY_NOT_FOUND';
        throw err;
      }

      if (stay.status !== 'ACTIVE') {
        const err = new Error('สามารถแจ้งเช็คเอาท์ได้เฉพาะการเข้าพักที่กำลังใช้งานอยู่เท่านั้น');
        (err as any).statusCode = 400;
        (err as any).code = 'DAILY_STAY_NOT_ACTIVE';
        throw err;
      }

      // Advisory room lock
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${dormitoryId + ':' + stay.roomId}))`;

      const now = new Date();

      // Update DailyStay status
      const updatedStay = await tx.dailyStay.update({
        where: { id: stayId },
        data: {
          status: 'CHECKED_OUT',
          actualCheckedOutAt: now,
          checkedOutByUserId: userId,
        },
      });

      // End Occupancy if exists
      if (stay.occupancyId) {
        await tx.occupancy.update({
          where: { id: stay.occupancyId },
          data: {
            status: 'ENDED',
            endedAt: now,
            endedByUserId: userId,
            endedReason: 'DAILY_STAY_CHECKED_OUT',
          },
        });
      }

      // Check if any other active occupancy exists
      const otherOccupancy = await tx.occupancy.findFirst({
        where: {
          dormitoryId,
          roomId: stay.roomId,
          status: 'ACTIVE',
        },
      });

      if (!otherOccupancy) {
        await tx.room.update({
          where: { id: stay.roomId },
          data: { status: 'vacant', currentTenantId: null },
        });
      }

      return updatedStay;
    });
  }

  /**
   * Scheduled Lifecycle: Activate RESERVED daily stays on arrival of startDate
   */
  public async activateScheduledDailyStays(
    dormitoryId?: string,
    effectiveDate?: Date | string,
    actorUserId?: string
  ) {
    const evalDate = effectiveDate
      ? typeof effectiveDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)
        ? new Date(effectiveDate)
        : new Date(effectiveDate)
      : new Date();

    const evalDateOnly = new Date(Date.UTC(evalDate.getUTCFullYear(), evalDate.getUTCMonth(), evalDate.getUTCDate()));

    const whereClause: any = {
      deletedAt: null,
      status: 'RESERVED',
      startDate: { lte: evalDateOnly },
    };
    if (dormitoryId) {
      whereClause.dormitoryId = dormitoryId;
    }

    const reservedStays = await this.prisma.dailyStay.findMany({
      where: whereClause,
      include: { room: true, tenant: true },
      orderBy: { startDate: 'asc' },
    });

    const activated: any[] = [];
    const skipped: any[] = [];

    for (const stay of reservedStays) {
      try {
        const result = await this.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${stay.dormitoryId + ':' + stay.roomId}))`;

          const freshStay = await tx.dailyStay.findFirst({
            where: { id: stay.id, deletedAt: null },
          });

          if (!freshStay || freshStay.status !== 'RESERVED') {
            return { activated: false, reason: 'STAY_NOT_RESERVED' };
          }

          // Check conflicting active occupant
          const conflictingOccupancy = await tx.occupancy.findFirst({
            where: {
              dormitoryId: stay.dormitoryId,
              roomId: stay.roomId,
              status: 'ACTIVE',
              tenantId: stay.tenantId ? { not: stay.tenantId } : undefined,
            },
          });

          if (conflictingOccupancy) {
            return { activated: false, reason: 'ROOM_OCCUPIED_BY_OTHER_TENANT' };
          }

          await tx.dailyStay.update({
            where: { id: stay.id },
            data: { status: 'ACTIVE' },
          });

          if (stay.occupancyId) {
            await tx.occupancy.update({
              where: { id: stay.occupancyId },
              data: { status: 'ACTIVE', startedAt: new Date() },
            });
          }

          await tx.room.update({
            where: { id: stay.roomId },
            data: { status: 'occupied', currentTenantId: stay.tenantId },
          });

          return { activated: true };
        });

        if (result.activated) {
          activated.push({ id: stay.id, roomId: stay.roomId });
        } else {
          skipped.push({ id: stay.id, roomId: stay.roomId, reason: result.reason });
        }
      } catch (err: any) {
        skipped.push({ id: stay.id, roomId: stay.roomId, reason: err.message });
      }
    }

    return { activatedCount: activated.length, activated, skippedCount: skipped.length, skipped };
  }

  /**
   * Scheduled Lifecycle: Complete ended daily stays on arrival of endDate + 1 (natural stay completion)
   * Example: 1-3 Sep inclusive -> room available 4 Sep
   */
  public async completeEndedDailyStays(
    dormitoryId?: string,
    effectiveDate?: Date | string,
    _actorUserId?: string
  ) {
    const evalDate = effectiveDate
      ? typeof effectiveDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)
        ? new Date(effectiveDate)
        : new Date(effectiveDate)
      : new Date();

    const evalDateOnly = new Date(Date.UTC(evalDate.getUTCFullYear(), evalDate.getUTCMonth(), evalDate.getUTCDate()));

    const whereClause: any = {
      deletedAt: null,
      status: 'ACTIVE',
      endDate: { lt: evalDateOnly },
    };
    if (dormitoryId) {
      whereClause.dormitoryId = dormitoryId;
    }

    const endedStays = await this.prisma.dailyStay.findMany({
      where: whereClause,
      include: { room: true },
      orderBy: { endDate: 'asc' },
    });

    const completed: any[] = [];

    for (const stay of endedStays) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${stay.dormitoryId + ':' + stay.roomId}))`;

          await tx.dailyStay.update({
            where: { id: stay.id },
            data: { status: 'COMPLETED' },
          });

          if (stay.occupancyId) {
            await tx.occupancy.update({
              where: { id: stay.occupancyId },
              data: { status: 'ENDED', endedAt: new Date(), endedReason: 'DAILY_STAY_COMPLETED' },
            });
          }

          const otherOccupancy = await tx.occupancy.findFirst({
            where: {
              dormitoryId: stay.dormitoryId,
              roomId: stay.roomId,
              status: 'ACTIVE',
            },
          });

          if (!otherOccupancy) {
            await tx.room.update({
              where: { id: stay.roomId },
              data: { status: 'vacant', currentTenantId: null },
            });
          }
        });

        completed.push({ id: stay.id, roomId: stay.roomId });
      } catch (_err) {
        // Skip failure
      }
    }

    return { completedCount: completed.length, completed };
  }

  /**
   * Query daily stays for dormitory
   */
  public async getDailyStays(dormitoryId: string, status?: string) {
    const where: any = { dormitoryId, deletedAt: null };
    if (status) {
      where.status = status;
    }

    return this.prisma.dailyStay.findMany({
      where,
      include: {
        room: true,
        tenant: true,
        invoice: { include: { items: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Query daily stay invoices for payments presentation
   */
  public async getDailyStayInvoices(dormitoryId: string) {
    return this.prisma.dailyStayInvoice.findMany({
      where: { dormitoryId, deletedAt: null },
      include: {
        items: true,
        dailyStay: {
          include: {
            room: true,
            tenant: true,
          },
        },
      },
      orderBy: { issuedAt: 'desc' },
    });
  }
}

export const dailyStayService = new DailyStayService();
