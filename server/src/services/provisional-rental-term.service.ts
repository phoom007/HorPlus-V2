/**
 * @license Apache-2.0
 * Provisional Rental Term Service (LOCAL-07 Batch 01)
 * Contractless Monthly / Term Rental Terms foundation for Owner-created tenants.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { getPrismaClient } from '../db/prisma.js';
import { AuditService } from './audit.service.js';
import { generateNextTenantNumber } from './tenant-number.service.js';
import { toDecimal, mulDecimals, formatDecimal } from '../utils/decimal-math.util.js';
import {
  getContractPhysicalInterval,
  getProvisionalTermPhysicalInterval,
  getDailyStayPhysicalInterval,
  doHalfOpenIntervalsOverlap,
  acquireRoomAvailabilityLock,
} from '../utils/occupancy-interval.util.js';
import {
  createDepositBillForAgreementInTx,
  createImmediateRentBillForAgreementInTx,
  toBangkokDateString,
  generateNextBillNumberInTx,
} from '../utils/deposit-billing.util.js';
import { generateReceiptInTx } from '../utils/payment-transaction.util.js';

export interface CreateProvisionalRentalTermDto {
  roomId: string;
  fullName: string;
  phone?: string | null;
  rentalType: 'MONTHLY' | 'TERM';
  startDate: string;
  endDate?: string;
  durationMonths?: number;
  unitRentAmount: string | number;
  totalRentAmount?: string | number;
  depositAmount?: string | number | null;
  depositDeclaredStatus?: 'PAID' | 'UNPAID' | null;
  termInstallmentCount?: number;
  migratedPaidPeriods?: string[];
  migratedPaidInstallments?: number[];
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
    userId?: string,
    idCardData?: {
      idCardObjectKey?: string | null;
      idCardSha256?: string | null;
      idCardMimeType?: string | null;
      idCardByteSize?: number | null;
      idCardUploadedAt?: Date | null;
      idCardUploadedByUserId?: string | null;
    } | null
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

    const todayStr = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
    const isFuture = data.startDate > todayStr;

    let durationMonths = 1;
    let endDate: Date;
    let unitRent: string;
    let totalRent: string;
    let termMonthsSnapshot: number | null = null;
    let termInstallmentCount: number | null = null;

    if (data.rentalType === 'MONTHLY') {
      durationMonths = Math.max(1, data.durationMonths || 1);
      if (data.endDate && /^\d{4}-\d{2}-\d{2}$/.test(data.endDate)) {
        const [ey, em, ed] = data.endDate.split('-').map(Number);
        endDate = new Date(Date.UTC(ey, em - 1, ed));
        if (endDate < startDate) {
          const err = new Error('วันที่สิ้นสุดต้องไม่น้อยกว่าวันที่เริ่มต้น');
          (err as any).statusCode = 400;
          (err as any).code = 'VALIDATION_ERROR';
          throw err;
        }
      } else {
        endDate = calculateRentalEndDate(data.startDate, durationMonths);
      }
      unitRent = formatDecimal(toDecimal(String(data.unitRentAmount)));
      totalRent = data.totalRentAmount !== undefined
        ? formatDecimal(toDecimal(String(data.totalRentAmount)))
        : formatDecimal(mulDecimals(toDecimal(unitRent), durationMonths.toString()));
    } else {
      // TERM: termInstallmentCount is strictly required
      if (data.termInstallmentCount === undefined || data.termInstallmentCount === null) {
        const err = new Error('กรุณาระบุจำนวนงวดชำระสำหรับสัญญาแบบเทอม (termInstallmentCount)');
        (err as any).statusCode = 400;
        (err as any).code = 'TERM_INSTALLMENT_COUNT_REQUIRED';
        throw err;
      }
      unitRent = formatDecimal(toDecimal(String(data.unitRentAmount)));
      totalRent = data.totalRentAmount !== undefined
        ? formatDecimal(toDecimal(String(data.totalRentAmount)))
        : unitRent;
    }

    return this.prisma.$transaction(async (tx) => {
      // Room advisory lock to prevent concurrent double-submit or race conditions
      await acquireRoomAvailabilityLock(tx, dormitoryId, data.roomId);

      const room = await tx.room.findFirst({
        where: { id: data.roomId, dormitoryId, deletedAt: null },
      });

      if (!room) {
        const err = new Error('ไม่พบห้องพักที่ระบุ');
        (err as any).statusCode = 404;
        (err as any).code = 'ROOM_NOT_FOUND';
        throw err;
      }

      if (room.status === 'maintenance') {
        const err = new Error('ไม่สามารถสร้างสัญญาสำหรับห้องที่อยู่ระหว่างปิดปรับปรุงได้');
        (err as any).statusCode = 409;
        (err as any).code = 'ROOM_UNDER_MAINTENANCE';
        throw err;
      }

      if (data.rentalType === 'TERM') {
        const building = room.buildingId ? await tx.building.findUnique({ where: { id: room.buildingId } }) : null;
        if (!building || !building.termMonths || building.termMonths < 1) {
          const err = new Error('อาคารยังไม่ได้กำหนดระยะเวลาสัญญาแบบเทอม (termMonths)');
          (err as any).statusCode = 400;
          (err as any).code = 'BUILDING_TERM_CONFIG_INVALID';
          throw err;
        }

        const maxInstallments = building.maxTermRentInstallments || 1;
        if (data.termInstallmentCount! < 1 || data.termInstallmentCount! > maxInstallments) {
          const err = new Error(`จำนวนงวดชำระต้องอยู่ระหว่าง 1 ถึง ${maxInstallments} งวด`);
          (err as any).statusCode = 400;
          (err as any).code = 'TERM_INSTALLMENTS_EXCEED_MAX';
          throw err;
        }

        const inputMonths = data.durationMonths && Number(data.durationMonths) >= 1 ? Number(data.durationMonths) : building.termMonths;
        termInstallmentCount = data.termInstallmentCount!;
        termMonthsSnapshot = inputMonths;
        durationMonths = inputMonths;
        endDate = calculateRentalEndDate(data.startDate, durationMonths);
      }

      // Check overlap using canonical half-open physical intervals [start, end)
      const targetInterval = getProvisionalTermPhysicalInterval({ startDate: data.startDate, endDate });

      // 1. Check contracts
      const candidateContracts = await tx.contract.findMany({
        where: {
          dormitoryId,
          roomId: data.roomId,
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
        if (doHalfOpenIntervalsOverlap(targetInterval, getContractPhysicalInterval(c))) {
          const err = new Error('ห้องพักมีสัญญาที่ทับซ้อนกับช่วงเวลาดังกล่าว');
          (err as any).statusCode = 409;
          (err as any).code = 'ROOM_OCCUPIED_OR_HAS_ACTIVE_AGREEMENT';
          throw err;
        }
      }

      // 2. Check provisional rental terms
      const candidateProvisionals = await tx.provisionalRentalTerm.findMany({
        where: {
          dormitoryId,
          roomId: data.roomId,
          status: { in: ['RESERVED', 'ACTIVE', 'reserved', 'active', 'CONVERTED', 'ENDED'] },
          deletedAt: null,
        },
      });

      for (const p of candidateProvisionals) {
        if (doHalfOpenIntervalsOverlap(targetInterval, getProvisionalTermPhysicalInterval(p))) {
          const err = new Error('ห้องพักมีการจองหรือข้อตกลงชั่วคราวที่ทับซ้อนกับช่วงเวลาดังกล่าว');
          (err as any).statusCode = 409;
          (err as any).code = 'ROOM_OCCUPIED_OR_HAS_ACTIVE_AGREEMENT';
          throw err;
        }
      }

      // 3. Check daily stays
      const candidateDaily = await tx.dailyStay.findMany({
        where: {
          dormitoryId,
          roomId: data.roomId,
          status: { in: ['RESERVED', 'ACTIVE', 'reserved', 'active'] },
          deletedAt: null,
        },
      });

      for (const d of candidateDaily) {
        if (doHalfOpenIntervalsOverlap(targetInterval, getDailyStayPhysicalInterval(d))) {
          const err = new Error('ห้องพักมีผู้พักอาศัยรายวันที่ทับซ้อนกับช่วงเวลาดังกล่าว');
          (err as any).statusCode = 409;
          (err as any).code = 'ROOM_OCCUPIED_OR_HAS_ACTIVE_AGREEMENT';
          throw err;
        }
      }

      // Canonical tenant number generation (shared authority & dormitory lock-safe)
      const tenantNumber = await generateNextTenantNumber(dormitoryId, tx);

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
          idCardObjectKey: idCardData?.idCardObjectKey || null,
          idCardSha256: idCardData?.idCardSha256 || null,
          idCardMimeType: idCardData?.idCardMimeType || null,
          idCardByteSize: idCardData?.idCardByteSize || null,
          idCardUploadedAt: idCardData?.idCardUploadedAt || null,
          idCardUploadedByUserId: idCardData?.idCardUploadedByUserId || null,
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
          depositAmount: (() => {
            if (data.depositAmount !== null && data.depositAmount !== undefined && String(data.depositAmount).trim() !== '') {
              return new Prisma.Decimal(data.depositAmount);
            }
            if (data.rentalType === 'TERM') {
              return (room as any).termDeposit !== null && (room as any).termDeposit !== undefined
                ? new Prisma.Decimal((room as any).termDeposit)
                : new Prisma.Decimal(room.depositAmount || 0);
            }
            return (room as any).monthlyDeposit !== null && (room as any).monthlyDeposit !== undefined
              ? new Prisma.Decimal((room as any).monthlyDeposit)
              : new Prisma.Decimal(room.depositAmount || 0);
          })(),
          termMonthsSnapshot,
          termInstallmentCount,
          status: termStatus,
          createdByUserId: userId && /^[0-9a-fA-F-]{36}$/.test(userId) ? userId : null,
        },
      });

      // 3.5. Create exactly one Deposit Bill for this agreement in the start billing cycle
      await createDepositBillForAgreementInTx(tx, {
        dormitoryId,
        roomId: data.roomId,
        tenantId: tenant.id,
        agreementType: data.rentalType,
        startDate: data.startDate,
        depositAmount: provisionalTerm.depositAmount || '0.00',
        depositDeclaredStatus: (data.depositDeclaredStatus as any) === 'PAID' ? 'PAID' : 'UNPAID',
        provisionalRentalTermId: provisionalTerm.id,
        actorUserId: userId,
      });

      // 3.6. Create immediate HorPlus-managed Rent Bills for this agreement
      await createImmediateRentBillForAgreementInTx(tx, {
        dormitoryId,
        roomId: data.roomId,
        tenantId: tenant.id,
        agreementType: data.rentalType,
        startDate: data.startDate,
        endDate: data.endDate,
        unitRentAmount: provisionalTerm.unitRentAmount || '0.00',
        totalRentAmount: provisionalTerm.totalRentAmount || '0.00',
        termInstallmentCount: provisionalTerm.termInstallmentCount,
        provisionalRentalTermId: provisionalTerm.id,
        actorUserId: userId,
      });

      // 3.7. Historical Pre-HorPlus Rent & Deposit Records (Real Financial Rows)
      const recordedPeriods: string[] = [];
      const recordedInstallments: number[] = [];
      const earliestCycle = await tx.billingCycle.findFirst({
        where: { dormitoryId },
        orderBy: { periodStart: 'asc' },
      });

      if (earliestCycle) {
        const earliestPeriodStartStr = toBangkokDateString(new Date(earliestCycle.periodStart));
        const unitRentDec = new Prisma.Decimal(formatDecimal(provisionalTerm.unitRentAmount || '0.00'));
        const safeUserId = userId && /^[0-9a-fA-F-]{36}$/.test(userId) ? userId : null;
        const now = new Date();

        const formatThaiPeriodLabel = (periodStr: string): string => {
          const parts = periodStr.split('-');
          if (parts.length < 2) return periodStr;
          const year = parseInt(parts[0], 10);
          const month = parts[1];
          const thaiYear = ((year + 543) % 100).toString().padStart(2, '0');
          const monthNames: Record<string, string> = {
            '01': 'ม.ค.', '02': 'ก.พ.', '03': 'มี.ค.', '04': 'เม.ย.',
            '05': 'พ.ค.', '06': 'มิ.ย.', '07': 'ก.ค.', '08': 'ส.ค.',
            '09': 'ก.ย.', '10': 'ต.ค.', '11': 'พ.ย.', '12': 'ธ.ค.'
          };
          const mName = monthNames[month] || month;
          return `${mName} ${thaiYear}`;
        };

        if (unitRentDec.greaterThan(0)) {
          if (data.rentalType === 'MONTHLY') {
            const startYear = parseInt(data.startDate.slice(0, 4), 10);
            const startMonth = parseInt(data.startDate.slice(5, 7), 10);
            const duration = data.durationMonths || 12;

            for (let i = 0; i < duration; i++) {
              const pDate = new Date(Date.UTC(startYear, startMonth - 1 + i, 1));
              const pStr = pDate.toISOString().slice(0, 7);
              const pStartStr = `${pStr}-01`;
              if (pStartStr >= earliestPeriodStartStr) {
                break;
              }

              const isPaid = Array.isArray(data.migratedPaidPeriods) && data.migratedPaidPeriods.includes(pStr);
              const pLabel = formatThaiPeriodLabel(pStr);
              const billNumber = await generateNextBillNumberInTx(tx, dormitoryId, earliestCycle.cycleCode);

              const bill = await tx.bill.create({
                data: {
                  dormitoryId,
                  billingCycleId: earliestCycle.id,
                  roomId: data.roomId,
                  tenantId: tenant.id,
                  provisionalRentalTermId: provisionalTerm.id,
                  billKind: 'RENT',
                  billNumber,
                  status: isPaid ? 'PAID' : 'ISSUED',
                  billingDate: new Date(earliestCycle.periodStart),
                  dueDate: earliestCycle.dueDate ? new Date(earliestCycle.dueDate) : new Date(earliestCycle.periodStart),
                  subtotal: unitRentDec,
                  totalAmount: unitRentDec,
                  paidAmount: isPaid ? unitRentDec : new Prisma.Decimal('0.00'),
                  outstandingAmount: isPaid ? new Prisma.Decimal('0.00') : unitRentDec,
                  paidAt: isPaid ? now : null,
                  generatedByUserId: safeUserId,
                  generatedAt: now,
                  items: {
                    create: [
                      {
                        dormitoryId,
                        type: 'rent',
                        description: `ค่าเช่าห้องพัก ${pLabel}`,
                        amount: unitRentDec,
                        unitPrice: unitRentDec,
                        quantity: new Prisma.Decimal('1.00'),
                        metadata: {
                          isHistoricalImport: true,
                          originalPeriod: pStr,
                          originalPeriodLabel: pLabel,
                          originalPaymentDateKnown: false,
                          importedAt: now.toISOString(),
                        },
                      },
                    ],
                  },
                },
              });

              if (isPaid) {
                recordedPeriods.push(pStr);
                const group = await tx.combinedPaymentGroup.create({
                  data: {
                    dormitoryId,
                    tenantId: tenant.id,
                    totalAmount: unitRentDec,
                    method: 'CASH',
                    status: 'APPROVED',
                    paymentDate: now,
                    recordedByUserId: safeUserId,
                    notes: `ประวัติการชำระเงินก่อนเริ่มใช้ HorPlus • ${pLabel}`,
                  },
                });

                await tx.combinedPaymentGroupBillTarget.create({
                  data: {
                    dormitoryId,
                    paymentGroupId: group.id,
                    billId: bill.id,
                    targetOrder: 1,
                  },
                });

                const payment = await tx.payment.create({
                  data: {
                    dormitoryId,
                    billId: bill.id,
                    tenantId: tenant.id,
                    paymentGroupId: group.id,
                    method: 'CASH',
                    amount: unitRentDec,
                    status: 'APPROVED',
                    paymentDate: null,
                    reviewedByUserId: safeUserId,
                    reviewedAt: now,
                    metadata: {
                      isHistoricalImport: true,
                      originalPeriod: pStr,
                      originalPeriodLabel: pLabel,
                      originalPaymentDateKnown: false,
                      importedAt: now.toISOString(),
                    },
                  },
                });

                await tx.paymentAllocation.create({
                  data: {
                    dormitoryId,
                    paymentId: payment.id,
                    billId: bill.id,
                    allocatedAmount: unitRentDec,
                  },
                });

                await generateReceiptInTx(
                  tx,
                  payment.id,
                  dormitoryId,
                  bill.id,
                  safeUserId,
                  group.id,
                  new Prisma.Decimal(unitRentDec.toString()) as any
                );
              }
            }
          } else if (data.rentalType === 'TERM') {
            const startYear = parseInt(data.startDate.slice(0, 4), 10);
            const startMonth = parseInt(data.startDate.slice(5, 7), 10);
            const instCount = termInstallmentCount || 1;

            for (let instNo = 1; instNo <= instCount; instNo++) {
              const instDate = new Date(Date.UTC(startYear, startMonth - 1 + (instNo - 1), 1));
              const instMonthStr = instDate.toISOString().slice(0, 10);
              if (instMonthStr >= earliestPeriodStartStr) {
                break;
              }

              const pStr = instDate.toISOString().slice(0, 7);
              const pLabel = `งวดที่ ${instNo} (${formatThaiPeriodLabel(pStr)})`;
              const isPaid = Array.isArray(data.migratedPaidInstallments) && data.migratedPaidInstallments.includes(instNo);
              const billNumber = await generateNextBillNumberInTx(tx, dormitoryId, earliestCycle.cycleCode);

              const bill = await tx.bill.create({
                data: {
                  dormitoryId,
                  billingCycleId: earliestCycle.id,
                  roomId: data.roomId,
                  tenantId: tenant.id,
                  provisionalRentalTermId: provisionalTerm.id,
                  billKind: 'RENT',
                  billNumber,
                  status: isPaid ? 'PAID' : 'ISSUED',
                  billingDate: new Date(earliestCycle.periodStart),
                  dueDate: earliestCycle.dueDate ? new Date(earliestCycle.dueDate) : new Date(earliestCycle.periodStart),
                  subtotal: unitRentDec,
                  totalAmount: unitRentDec,
                  paidAmount: isPaid ? unitRentDec : new Prisma.Decimal('0.00'),
                  outstandingAmount: isPaid ? new Prisma.Decimal('0.00') : unitRentDec,
                  paidAt: isPaid ? now : null,
                  generatedByUserId: safeUserId,
                  generatedAt: now,
                  items: {
                    create: [
                      {
                        dormitoryId,
                        type: 'rent',
                        description: `ค่าเช่าห้องพัก ${pLabel}`,
                        amount: unitRentDec,
                        unitPrice: unitRentDec,
                        quantity: new Prisma.Decimal('1.00'),
                        metadata: {
                          isHistoricalImport: true,
                          originalPeriod: pStr,
                          originalPeriodLabel: pLabel,
                          originalPaymentDateKnown: false,
                          importedAt: now.toISOString(),
                        },
                      },
                    ],
                  },
                },
              });

              if (isPaid) {
                recordedInstallments.push(instNo);
                const group = await tx.combinedPaymentGroup.create({
                  data: {
                    dormitoryId,
                    tenantId: tenant.id,
                    totalAmount: unitRentDec,
                    method: 'CASH',
                    status: 'APPROVED',
                    paymentDate: now,
                    recordedByUserId: safeUserId,
                    notes: `ประวัติการชำระเงินก่อนเริ่มใช้ HorPlus • ${pLabel}`,
                  },
                });

                await tx.combinedPaymentGroupBillTarget.create({
                  data: {
                    dormitoryId,
                    paymentGroupId: group.id,
                    billId: bill.id,
                    targetOrder: 1,
                  },
                });

                const payment = await tx.payment.create({
                  data: {
                    dormitoryId,
                    billId: bill.id,
                    tenantId: tenant.id,
                    paymentGroupId: group.id,
                    method: 'CASH',
                    amount: unitRentDec,
                    status: 'APPROVED',
                    paymentDate: null,
                    reviewedByUserId: safeUserId,
                    reviewedAt: now,
                    metadata: {
                      isHistoricalImport: true,
                      originalPeriod: pStr,
                      originalPeriodLabel: pLabel,
                      originalPaymentDateKnown: false,
                      importedAt: now.toISOString(),
                    },
                  },
                });

                await tx.paymentAllocation.create({
                  data: {
                    dormitoryId,
                    paymentId: payment.id,
                    billId: bill.id,
                    allocatedAmount: unitRentDec,
                  },
                });

                await generateReceiptInTx(
                  tx,
                  payment.id,
                  dormitoryId,
                  bill.id,
                  safeUserId,
                  group.id,
                  new Prisma.Decimal(unitRentDec.toString()) as any
                );
              }
            }
          }
        }

        if (recordedPeriods.length > 0 || recordedInstallments.length > 0) {
          await tx.auditLog.create({
            data: {
              dormitoryId,
              actorUserId: safeUserId,
              action: 'MIGRATION_HISTORICAL_PAID_MARKERS',
              entityType: 'PROVISIONAL_RENTAL_TERM',
              entityId: provisionalTerm.id,
              afterValues: {
                roomId: data.roomId,
                tenantId: tenant.id,
                migratedPaidPeriods: recordedPeriods,
                migratedPaidInstallments: recordedInstallments,
              },
            },
          });
        }
      }

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
            durationMonths,
            unitRent,
          },
        });
      }

      return {
        tenant,
        occupancy,
        provisionalTerm,
        migratedPaidMarkers: {
          periods: recordedPeriods,
          installments: recordedInstallments,
        },
      };
    });
  }

  public async getProvisionalTermMigrationMarkers(termId: string, tx?: any) {
    const client = tx || this.prisma;
    const log = await client.auditLog.findFirst({
      where: {
        entityType: 'PROVISIONAL_RENTAL_TERM',
        entityId: termId,
        action: 'MIGRATION_HISTORICAL_PAID_MARKERS',
      },
      orderBy: { createdAt: 'desc' },
    });
    return (log?.afterValues as any) || { periods: [], installments: [] };
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

  /**
   * Authoritative Scheduled Activation for Provisional Rental Terms:
   * Transitions RESERVED -> ACTIVE when startDate is reached on or before effectiveDate.
   */
  public async activateScheduledProvisionalTerms(
    dormitoryId?: string,
    effectiveDate?: Date | string,
    actorUserId?: string
  ) {
    const evalDate = effectiveDate
      ? (typeof effectiveDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)
          ? new Date(effectiveDate)
          : new Date(effectiveDate))
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

    const reservedTerms = await this.prisma.provisionalRentalTerm.findMany({
      where: whereClause,
      include: { room: true, tenant: true },
      orderBy: { startDate: 'asc' },
    });

    const activated: any[] = [];
    const skipped: any[] = [];

    for (const term of reservedTerms) {
      try {
        const result = await this.prisma.$transaction(async (tx) => {
          await acquireRoomAvailabilityLock(tx, term.dormitoryId, term.roomId);

          // Re-verify status
          const freshTerm = await tx.provisionalRentalTerm.findFirst({
            where: { id: term.id, deletedAt: null },
          });
          if (!freshTerm || freshTerm.status !== 'RESERVED') {
            return { activated: false, reason: 'TERM_NOT_RESERVED' };
          }

          // Check conflict with active contract for another tenant
          const conflictingContract = await tx.contract.findFirst({
            where: {
              dormitoryId: term.dormitoryId,
              roomId: term.roomId,
              status: { in: ['active', 'expiring_soon', 'pending_signature', 'waiting_extension', 'checking_out'] },
              tenantId: { not: term.tenantId },
              deletedAt: null,
            },
          });
          if (conflictingContract) {
            return { activated: false, reason: 'ROOM_OCCUPIED_BY_CONTRACT' };
          }

          // Check conflict with active occupancy for another tenant
          const conflictingOccupancy = await tx.occupancy.findFirst({
            where: {
              dormitoryId: term.dormitoryId,
              roomId: term.roomId,
              status: 'ACTIVE',
              tenantId: { not: term.tenantId },
            },
          });
          if (conflictingOccupancy) {
            return { activated: false, reason: 'ROOM_OCCUPIED_BY_OTHER_TENANT' };
          }

          // Activate term
          const updatedTerm = await tx.provisionalRentalTerm.update({
            where: { id: term.id },
            data: {
              status: 'ACTIVE',
              version: { increment: 1 },
              updatedAt: new Date(),
            },
          });

          // Activate occupancy if exists
          if (term.occupancyId) {
            await tx.occupancy.update({
              where: { id: term.occupancyId },
              data: {
                status: 'ACTIVE',
              },
            });
          }

          // Update room
          await tx.room.update({
            where: { id: term.roomId },
            data: {
              status: 'occupied',
              currentTenantId: term.tenantId,
            },
          });

          return { activated: true, term: updatedTerm };
        });

        if (result.activated) {
          activated.push(result.term);
          if (this.auditService) {
            await this.auditService.log({
              dormitoryId: term.dormitoryId,
              actorUserId: actorUserId || 'system',
              action: 'provisional_rental_term.activate',
              resourceType: 'provisional_rental_term',
              resourceId: term.id,
              details: { roomId: term.roomId, tenantId: term.tenantId },
            });
          }
        } else {
          skipped.push({ termId: term.id, reason: result.reason });
        }
      } catch (err: any) {
        skipped.push({ termId: term.id, reason: err.message });
      }
    }

    return { activatedCount: activated.length, skippedCount: skipped.length, activated, skipped };
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

