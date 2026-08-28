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
import { currentBusinessDateInBangkok } from '../utils/calendar-date.util.js';
import {
  getContractPhysicalInterval,
  getProvisionalTermPhysicalInterval,
  getDailyStayPhysicalInterval,
  doHalfOpenIntervalsOverlap,
  acquireRoomAvailabilityLock,
} from '../utils/occupancy-interval.util.js';

export interface CreateTenantDailyStayRequestDto {
  roomId?: string;
  roomNumber?: string;
  applicantFullName: string;
  applicantPhone?: string | null;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  checkInTime?: string | null;
  checkOutTime?: string | null;
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
  checkInTime?: string | null;
  checkOutTime?: string | null;
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
 * Resolves Bangkok canonical checkInAt/checkOutAt timestamps and pricing day count:
 * - Default check-in: startDate 00:00:00+07:00
 * - Default check-out: day after endDate 00:00:00+07:00
 * - Optional checkInTime (e.g. 14:00) / checkOutTime (e.g. 18:00)
 * - Pricing days = Math.max(1, dateDiff(endDate, startDate))
 */
export function resolveDailyTimestampsAndPricing(
  startDateStr: string,
  endDateStr: string,
  checkInTimeStr?: string | null,
  checkOutTimeStr?: string | null
): { checkInAt: Date; checkOutAt: Date; inclusiveDayCount: number } {
  const inTime = checkInTimeStr && /^\d{2}:\d{2}(:\d{2})?$/.test(checkInTimeStr.trim())
    ? (checkInTimeStr.trim().length === 5 ? `${checkInTimeStr.trim()}:00` : checkInTimeStr.trim())
    : '00:00:00';

  const checkInAt = new Date(`${startDateStr}T${inTime}+07:00`);

  let checkOutAt: Date;
  if (checkOutTimeStr && /^\d{2}:\d{2}(:\d{2})?$/.test(checkOutTimeStr.trim())) {
    const outTime = checkOutTimeStr.trim().length === 5 ? `${checkOutTimeStr.trim()}:00` : checkOutTimeStr.trim();
    checkOutAt = new Date(`${endDateStr}T${outTime}+07:00`);
  } else {
    // Default checkout: day AFTER endDate at 00:00:00 Asia/Bangkok
    const [ey, em, ed] = endDateStr.split('-').map(Number);
    const nextDay = new Date(Date.UTC(ey, em - 1, ed + 1));
    const nextDayStr = nextDay.toISOString().slice(0, 10);
    checkOutAt = new Date(`${nextDayStr}T00:00:00+07:00`);
  }

  if (checkOutAt.getTime() <= checkInAt.getTime()) {
    const err = new Error('วันและเวลาเช็คเอาท์ต้องมากกว่าวันและเวลาเช็คอิน');
    (err as any).statusCode = 400;
    (err as any).code = 'INVALID_DATE_RANGE';
    throw err;
  }

  const [sy, sm, sd] = startDateStr.split('-').map(Number);
  const [ey, em, ed] = endDateStr.split('-').map(Number);
  const startUtc = Date.UTC(sy, sm - 1, sd);
  const endUtc = Date.UTC(ey, em - 1, ed);
  const diffDays = Math.round((endUtc - startUtc) / (24 * 3600 * 1000));
  const inclusiveDayCount = Math.max(1, diffDays);

  return { checkInAt, checkOutAt, inclusiveDayCount };
}

/**
 * Calculates calendar inclusive day count:
 * e.g., 2026-09-01 to 2026-09-03 = 3 days.
 */
export function calculateInclusiveDays(
  startDateStr: string,
  endDateStr: string,
  checkInTimeStr?: string | null,
  checkOutTimeStr?: string | null
): number {
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

  const todayBangkok = currentBusinessDateInBangkok();
  if (endDateStr < todayBangkok) {
    const err = new Error('วันที่สิ้นสุดต้องไม่น้อยกว่าวันที่ปัจจุบัน');
    (err as any).statusCode = 400;
    (err as any).code = 'INVALID_DATE_RANGE';
    throw err;
  }

  if (checkInTimeStr || checkOutTimeStr) {
    const { inclusiveDayCount } = resolveDailyTimestampsAndPricing(startDateStr, endDateStr, checkInTimeStr, checkOutTimeStr);
    return inclusiveDayCount;
  }

  const diffDays = Math.round((endUtc - startUtc) / (24 * 3600 * 1000));
  return Math.max(1, diffDays);
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

    // Transaction-safe dormitory/month namespace lock to serialize invoice numbers across all rooms
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'daily_invoice:' + dormitoryId + ':' + year + '-' + month}))`;

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
   * Uses canonical half-open interval algebra [start, end) and exact timestamps.
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
    const targetInterval = { start: startDate, end: endDate };

    // 1. Check contracts
    const candidateContracts = await db.contract.findMany({
      where: {
        dormitoryId,
        roomId,
        status: {
          in: [
            'active',
            'ACTIVE',
            'approved',
            'expiring_soon',
            'pending_signature',
            'waiting_extension',
            'checking_out',
            'ended',
            'ENDED',
            'terminated',
            'TERMINATED',
          ],
        },
        deletedAt: null,
      },
    });

    for (const c of candidateContracts) {
      const cInterval = getContractPhysicalInterval(c);
      if (doHalfOpenIntervalsOverlap(targetInterval, cInterval)) {
        return { available: false, reason: 'ROOM_OCCUPIED_BY_CONTRACT' };
      }
    }

    // 2. Check provisional rental terms
    const candidateProvisionals = await db.provisionalRentalTerm.findMany({
      where: {
        dormitoryId,
        roomId,
        status: { in: ['RESERVED', 'ACTIVE', 'reserved', 'active', 'CONVERTED', 'ENDED'] },
        deletedAt: null,
      },
    });

    for (const p of candidateProvisionals) {
      const pInterval = getProvisionalTermPhysicalInterval(p);
      if (doHalfOpenIntervalsOverlap(targetInterval, pInterval)) {
        return { available: false, reason: 'ROOM_OCCUPIED_BY_PROVISIONAL_TERM' };
      }
    }

    // 3. Check daily stays
    const candidateDailyStays = await db.dailyStay.findMany({
      where: {
        dormitoryId,
        roomId,
        status: { in: ['RESERVED', 'ACTIVE', 'reserved', 'active'] },
        deletedAt: null,
        ...(excludeDailyStayId ? { id: { not: excludeDailyStayId } } : {}),
      },
    });

    for (const d of candidateDailyStays) {
      const dInterval = getDailyStayPhysicalInterval(d);
      if (doHalfOpenIntervalsOverlap(targetInterval, dInterval)) {
        return { available: false, reason: 'ROOM_OCCUPIED_BY_DAILY_STAY' };
      }
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

    const { checkInAt, checkOutAt, inclusiveDayCount } = resolveDailyTimestampsAndPricing(
      data.startDate,
      data.endDate,
      data.checkInTime,
      data.checkOutTime
    );

    if (checkOutAt.getTime() <= Date.now()) {
      const err = new Error('วันและเวลาเช็คเอาท์ต้องอยู่ในอนาคต');
      (err as any).statusCode = 400;
      (err as any).code = 'INVALID_DATE_RANGE';
      throw err;
    }

    const roomWhere: any = {
      dormitoryId,
      deletedAt: null,
      status: { not: 'archived' },
    };
    if (data.roomNumber) {
      roomWhere.roomNumber = data.roomNumber;
    }
    if (data.roomId) {
      roomWhere.id = data.roomId;
    }

    const room = await this.prisma.room.findFirst({
      where: roomWhere,
      include: { building: true },
    });

    if (!room) {
      const err = new Error('ไม่พบข้อมูลห้องพัก');
      (err as any).statusCode = 404;
      (err as any).code = 'ROOM_NOT_FOUND';
      throw err;
    }

    // Validate operational room entitlement & existence
    await this.entitlementService.assertRoomOperationalEntitlement(dormitoryId, room.id);

    const { defaultsService } = await import('./defaults.service.js');
    const effective = await defaultsService.resolveEffectiveRoomDefaults(
      dormitoryId,
      room.buildingId,
      room.id,
      this.prisma
    );

    // Fail closed if daily rate is unconfigured (null / undefined)
    if (effective.dailyRent?.value === null || effective.dailyRent?.value === undefined) {
      const err = new Error('ยังไม่ได้กำหนดอัตราค่าเช่ารายวันสำหรับห้องพักนี้');
      (err as any).statusCode = 409;
      (err as any).code = 'DAILY_RATE_NOT_CONFIGURED';
      throw err;
    }

    // Authoritative daily rate strictly from DefaultsService authority (Tenant cannot author or override this)
    const dailyRate = formatDecimal(toDecimal(String(effective.dailyRent.value)));

    // Default deposit amount from canonical DefaultsService authority (0 is explicitly valid)
    let deposit = '0.00';
    if (data.depositAmount !== undefined && data.depositAmount !== null) {
      deposit = formatDecimal(toDecimal(String(data.depositAmount)));
    } else if (effective.dailyDeposit?.value !== null && effective.dailyDeposit?.value !== undefined) {
      deposit = formatDecimal(toDecimal(String(effective.dailyDeposit.value)));
    }

    const totalRent = formatDecimal(mulDecimals(toDecimal(dailyRate), inclusiveDayCount.toString()));
    const depositDeclaredStatus = data.depositDeclaredStatus || 'UNPAID';

    const [sy, sm, sd] = data.startDate.split('-').map(Number);
    const [ey, em, ed] = data.endDate.split('-').map(Number);
    const startDate = new Date(Date.UTC(sy, sm - 1, sd));
    const endDate = new Date(Date.UTC(ey, em - 1, ed));

    return this.prisma.dailyStay.create({
      data: {
        dormitoryId,
        roomId: room.id,
        requestSource: 'TENANT',
        applicantFullName: fullNameClean,
        applicantPhone: phoneClean,
        requesterUserId: requesterUserId || null,
        startDate,
        endDate,
        checkInAt,
        checkOutAt,
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
      await acquireRoomAvailabilityLock(tx, dormitoryId, stay.roomId);

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

      const todayStr = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
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

      let invoice = await tx.dailyStayInvoice.findUnique({
        where: { dailyStayId: stay.id },
        include: { items: true },
      });

      let invoiceNumber = invoice?.invoiceNumber;
      if (!invoice) {
        invoiceNumber = await this.generateNextDailyInvoiceNumber(dormitoryId, tx);

        invoice = await tx.dailyStayInvoice.create({
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
                  paidAt: stay.depositDeclaredStatus === 'PAID' ? new Date() : null,
                },
              ],
            },
          },
          include: { items: true },
        });
      }

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
    userId: string,
    idCardData?: {
      idCardObjectKey?: string | null;
      idCardSha256?: string | null;
      idCardMimeType?: string | null;
      idCardByteSize?: number | null;
      idCardUploadedAt?: Date | null;
      idCardUploadedByUserId?: string | null;
    } | null
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
      await acquireRoomAvailabilityLock(tx, dormitoryId, data.roomId);

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

      if (room.status === 'maintenance') {
        const err = new Error('ไม่สามารถบันทึกการเข้าพักสำหรับห้องที่อยู่ระหว่างปิดปรับปรุงได้');
        (err as any).statusCode = 409;
        (err as any).code = 'ROOM_UNDER_MAINTENANCE';
        throw err;
      }

      const { checkInAt, checkOutAt, inclusiveDayCount } = resolveDailyTimestampsAndPricing(
        data.startDate,
        data.endDate,
        data.checkInTime,
        data.checkOutTime
      );

      if (checkOutAt.getTime() <= Date.now()) {
        const err = new Error('วันและเวลาเช็คเอาท์ต้องอยู่ในอนาคต');
        (err as any).statusCode = 400;
        (err as any).code = 'INVALID_DATE_RANGE';
        throw err;
      }

      // Check room availability
      const availability = await this.checkRoomAvailability(
        dormitoryId,
        data.roomId,
        checkInAt,
        checkOutAt,
        undefined,
        tx
      );

      if (!availability.available) {
        const err = new Error('ห้องพักมีผู้พักอาศัยหรือมีการจองที่ทับซ้อนกับช่วงเวลาดังกล่าว');
        (err as any).statusCode = 409;
        (err as any).code = 'ROOM_OCCUPIED_OR_HAS_ACTIVE_AGREEMENT';
        throw err;
      }

      const todayStr = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
      const isFuture = data.startDate > todayStr;

      const { defaultsService } = await import('./defaults.service.js');
      const effective = await defaultsService.resolveEffectiveRoomDefaults(
        dormitoryId,
        room.buildingId,
        room.id,
        tx
      );

      // Default daily rate from canonical DefaultsService authority (Fail closed if unconfigured and not supplied)
      let dailyRate: string;
      if (data.dailyRateAmount !== undefined && data.dailyRateAmount !== null && String(data.dailyRateAmount).trim() !== '') {
        dailyRate = formatDecimal(toDecimal(String(data.dailyRateAmount)));
      } else if (effective.dailyRent?.value !== null && effective.dailyRent?.value !== undefined) {
        dailyRate = formatDecimal(toDecimal(String(effective.dailyRent.value)));
      } else {
        const err = new Error('ยังไม่ได้กำหนดอัตราค่าเช่ารายวันสำหรับห้องพักนี้ กรุณาระบุอัตราค่าเช่ารายวัน');
        (err as any).statusCode = 409;
        (err as any).code = 'DAILY_RATE_NOT_CONFIGURED';
        throw err;
      }

      // Default deposit amount from canonical DefaultsService authority (0 is explicitly valid)
      let deposit = '0.00';
      if (data.depositAmount !== undefined && data.depositAmount !== null) {
        deposit = formatDecimal(toDecimal(String(data.depositAmount)));
      } else if (effective.dailyDeposit?.value !== null && effective.dailyDeposit?.value !== undefined) {
        deposit = formatDecimal(toDecimal(String(effective.dailyDeposit.value)));
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
          idCardObjectKey: idCardData?.idCardObjectKey || null,
          idCardSha256: idCardData?.idCardSha256 || null,
          idCardMimeType: idCardData?.idCardMimeType || null,
          idCardByteSize: idCardData?.idCardByteSize || null,
          idCardUploadedAt: idCardData?.idCardUploadedAt || null,
          idCardUploadedByUserId: idCardData?.idCardUploadedByUserId || null,
        },
      });

      // 4. Create Occupancy
      const occupancy = await tx.occupancy.create({
        data: {
          dormitoryId,
          roomId: data.roomId,
          tenantId: tenant.id,
          status: isFuture ? 'RESERVED' : 'ACTIVE',
          startedAt: isFuture ? checkInAt : new Date(),
        },
      });

      const [sy, sm, sd] = data.startDate.split('-').map(Number);
      const [ey, em, ed] = data.endDate.split('-').map(Number);
      const startDate = new Date(Date.UTC(sy, sm - 1, sd));
      const endDate = new Date(Date.UTC(ey, em - 1, ed));

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
          checkInAt,
          checkOutAt,
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
                paidAt: depositDeclaredStatus === 'PAID' ? new Date() : null,
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
      await acquireRoomAvailabilityLock(tx, dormitoryId, stay.roomId);

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
          await acquireRoomAvailabilityLock(tx, stay.dormitoryId, stay.roomId);

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
          await acquireRoomAvailabilityLock(tx, stay.dormitoryId, stay.roomId);

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

  /**
   * Settles a specific daily stay invoice item (e.g. DAILY_RENT or DEPOSIT) canonically.
   * Updates item status to 'SETTLED', sets paidAt if not already populated (first-write immutability),
   * recalculates outstandingAmount, and updates invoice status to 'PAID' if all items are settled.
   */
  public async settleDailyStayInvoiceItem(
    dormitoryId: string,
    invoiceId: string,
    itemType: 'DAILY_RENT' | 'RENT' | 'DEPOSIT',
    actorUserId?: string,
    txClient?: any
  ) {
    const execute = async (tx: any) => {
      const invoice = await tx.dailyStayInvoice.findFirst({
        where: { id: invoiceId, dormitoryId, deletedAt: null },
        include: { items: true, dailyStay: true },
      });

      if (!invoice) {
        const err = new Error('ไม่พบใบแจ้งหนี้รายวัน');
        (err as any).statusCode = 404;
        (err as any).code = 'INVOICE_NOT_FOUND';
        throw err;
      }

      const targetItems = invoice.items.filter(
        (it: any) => it.itemType === itemType || (itemType === 'DAILY_RENT' && it.itemType === 'RENT')
      );

      if (targetItems.length === 0) {
        const err = new Error(`ไม่พบรายการ ${itemType} ในใบแจ้งหนี้`);
        (err as any).statusCode = 404;
        (err as any).code = 'INVOICE_ITEM_NOT_FOUND';
        throw err;
      }

      const now = new Date();
      for (const item of targetItems) {
        await tx.dailyStayInvoiceItem.update({
          where: { id: item.id },
          data: {
            status: 'SETTLED',
            paidAt: item.paidAt || now, // First paid event sets paidAt; subsequent payment does not rewrite
          },
        });
      }

      // Fetch fresh items to re-evaluate aggregate invoice status
      const updatedItems = await tx.dailyStayInvoiceItem.findMany({
        where: { invoiceId: invoice.id },
      });

      const totalAgreed = updatedItems.reduce(
        (sum: number, it: any) => sum + Number(it.amount),
        0
      );

      const totalPaid = updatedItems
        .filter((it: any) => it.status === 'SETTLED' || it.status === 'DECLARED_PAID')
        .reduce((sum: number, it: any) => sum + Number(it.amount), 0);

      const remainingOutstanding = Math.max(0, totalAgreed - totalPaid);

      let newStatus = 'ISSUED';
      if (remainingOutstanding === 0 && totalAgreed > 0) {
        newStatus = 'PAID';
      } else if (totalPaid > 0) {
        newStatus = 'PARTIALLY_PAID';
      } else {
        newStatus = 'ISSUED';
      }

      const isDepositSettled = updatedItems.some(
        (it: any) => it.itemType === 'DEPOSIT' && (it.status === 'SETTLED' || it.status === 'DECLARED_PAID')
      );

      const updatedInvoice = await tx.dailyStayInvoice.update({
        where: { id: invoice.id },
        data: {
          totalAgreedAmount: toDecimal(totalAgreed.toFixed(2)),
          outstandingAmount: toDecimal(remainingOutstanding.toFixed(2)),
          status: newStatus,
          depositDeclaredStatus: isDepositSettled ? 'PAID' : invoice.depositDeclaredStatus,
        },
        include: {
          items: true,
          dailyStay: {
            include: {
              room: true,
              tenant: true,
            },
          },
        },
      });

      return {
        ...updatedInvoice,
        totalPaidAmount: toDecimal(totalPaid.toFixed(2)),
      };
    };

    if (txClient) {
      return execute(txClient);
    } else {
      return this.prisma.$transaction(execute);
    }
  }
}

export const dailyStayService = new DailyStayService();
