import {
  IBillRepository,
  BillEntity,
  BillItemEntity,
  BillFilterQuery,
  CreateBillItemData,
} from '../db/repositories/bill.repository.js';
import { IBillingCycleRepository } from '../db/repositories/billing-cycle.repository.js';
import { IMeterRepository } from '../db/repositories/meter.repository.js';
import { IContractRepository } from '../db/repositories/contract.repository.js';
import { IRoomRepository } from '../db/repositories/room.repository.js';
import { ITenantRepository } from '../db/repositories/tenant.repository.js';
import { AuditService } from './audit.service.js';
import { billingOrchestrationService } from './billing-orchestration.service.js';
import { resolveProvisionalBillingSource as sharedResolveProvisionalBillingSource } from './provisional-billing-source.service.js';
import { ENTITLEMENT_ROOM_LIMITS } from './entitlement.service.js';
import { subscriptionEntitlementService } from './subscription-entitlement.service.js';
import { toDecimal, addDecimals, mulDecimals, divDecimals, formatDecimal, subDecimals, compareDecimals, isZeroDecimal } from '../utils/decimal-math.util.js';
import { calculateInstallmentSchedule } from '../utils/installment-calculator.util.js';
import { normalizeUtilityBillingMode } from '../utils/billing-mode-normalizer.util.js';
import { calculateCanonicalMonthlyUtility } from '../utils/monthly-utility-calculator.util.js';
import { getPrismaClient } from '../db/prisma.js';

/**
 * Canonical helper to calculate authoritative Bill due date from actual bill issuance date and dormitory dueDay.
 * Invariant Rule:
 *   if issueDay <= dueDay: dueDate = dueDay in the SAME calendar month
 *   if issueDay > dueDay:  dueDate = dueDay in the NEXT calendar month (with year rollover if month is 12)
 */
export function resolveBillDueDate(issueDate: Date | string, dueDay: number): Date {
  let y: number;
  let m: number;
  let day: number;

  if (typeof issueDate === 'string') {
    const match = issueDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      y = parseInt(match[1], 10);
      m = parseInt(match[2], 10);
      day = parseInt(match[3], 10);
    } else {
      const parsed = new Date(issueDate);
      y = parsed.getFullYear();
      m = parsed.getMonth() + 1;
      day = parsed.getDate();
    }
  } else {
    y = issueDate.getFullYear();
    m = issueDate.getMonth() + 1;
    day = issueDate.getDate();
  }

  let dueYear: number;
  let dueMonth: number;

  if (day <= dueDay) {
    dueYear = y;
    dueMonth = m;
  } else {
    if (m === 12) {
      dueYear = y + 1;
      dueMonth = 1;
    } else {
      dueYear = y;
      dueMonth = m + 1;
    }
  }

  const lastDayOfDueMonth = new Date(dueYear, dueMonth, 0).getDate();
  const clampedDueDay = Math.min(dueDay, lastDayOfDueMonth);
  const dueIsoStr = `${dueYear}-${String(dueMonth).padStart(2, '0')}-${String(clampedDueDay).padStart(2, '0')}`;
  return new Date(`${dueIsoStr}T00:00:00.000Z`);
}

/**
 * Canonical helper to resolve Bill calendar issue date (billingDate) from issuance timestamp.
 */
export function resolveBillIssueDate(issueDate: Date | string): Date {
  let y: number;
  let m: number;
  let day: number;

  if (typeof issueDate === 'string') {
    const match = issueDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      y = parseInt(match[1], 10);
      m = parseInt(match[2], 10);
      day = parseInt(match[3], 10);
    } else {
      const parsed = new Date(issueDate);
      y = parsed.getFullYear();
      m = parsed.getMonth() + 1;
      day = parsed.getDate();
    }
  } else {
    y = issueDate.getFullYear();
    m = issueDate.getMonth() + 1;
    day = issueDate.getDate();
  }

  const issueIsoStr = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return new Date(`${issueIsoStr}T00:00:00.000Z`);
}

export interface GenerateBillDto {
  billingCycleId: string;
  contractId?: string;
  provisionalRentalTermId?: string;
  roomId: string;
  tenantId?: string;
  billingDate?: string;
  dueDate?: string;
  billKind?: 'MONTHLY_UTILITY' | 'RENT' | 'DEPOSIT' | 'LEGACY_COMBINED' | string;
  customItems?: Array<{
    type: string;
    description: string;
    quantity: string;
    unitPrice: string;
    amount: string;
  }>;
  discountAmount?: string;
}

export interface BillPreviewResult {
  contractId?: string | null;
  provisionalRentalTermId?: string | null;
  roomId: string;
  tenantId: string;
  rentAmount: string;
  waterUsage: string;
  waterRate: string;
  waterAmount: string;
  electricityUsage: string;
  electricityRate: string;
  electricityAmount: string;
  commonFee: string;
  internetFee: string;
  parkingFee?: string;
  manualOutstandingAmount?: string;
  lateFeeAmount?: string;
  otherFees?: Array<{ description: string; amount: string }>;
  peopleCount: number;
  subtotal: string;
  discountAmount: string;
  totalAmount: string;
  items: Array<{
    type: string;
    description: string;
    quantity: string;
    unit?: string;
    unitPrice: string;
    amount: string;
    metadata?: any;
  }>;
}

export class BillingService {
  constructor(
    private billRepo: IBillRepository,
    private billingCycleRepo: IBillingCycleRepository,
    private meterRepo: IMeterRepository,
    private contractRepo: IContractRepository,
    private roomRepo: IRoomRepository,
    private tenantRepo: ITenantRepository,
    private auditService?: AuditService
  ) {}

  /**
   * Authoritative canonical resolver for provisional billing source.
   * Enforces:
   * 1. status = 'ACTIVE'
   * 2. deletedAt = null
   * 3. startDate <= billingCycle.periodEnd
   * 4. endDate >= billingCycle.periodStart
   * 5. Deterministic ordering: [{ startDate: 'asc' }, { createdAt: 'desc' }]
   * Rejects RESERVED, CONVERTED, ENDED, CANCELLED, and non-overlapping terms.
   */
  public async resolveProvisionalBillingSource(
    dormitoryId: string,
    roomId: string,
    billingCycle: { periodStart: Date | string; periodEnd: Date | string },
    tx?: any
  ): Promise<any | null> {
    return sharedResolveProvisionalBillingSource({
      dormitoryId,
      roomId,
      billingCycle,
      tx,
    });
  }

  public async generateBillPreview(
    dormitoryId: string,
    billingCycleId: string,
    roomId: string,
    tx?: any,
    billKind: string = 'LEGACY_COMBINED',
    asOfDate?: Date | string | null
  ): Promise<BillPreviewResult> {
    const cycle = await this.billingCycleRepo.findById(billingCycleId, dormitoryId);
    if (!cycle) {
      const err = new Error('BILLING_CYCLE_NOT_FOUND');
      (err as any).statusCode = 404;
      (err as any).code = 'BILLING_CYCLE_NOT_FOUND';
      throw err;
    }

    const rateSnapshot = await this.billingCycleRepo.findRateSnapshot(billingCycleId, dormitoryId);
    if (!rateSnapshot) {
      const err = new Error('MISSING_RATE_SNAPSHOT');
      (err as any).statusCode = 422;
      (err as any).code = 'MISSING_RATE_SNAPSHOT';
      (err as any).message = 'ไม่พบบันทึกอัตราค่าน้ำค่าไฟของงวดบิลนี้ กรุณากำหนดอัตราก่อนออกบิล';
      throw err;
    }
    const waterRate = toDecimal(rateSnapshot.waterRate);
    const elecRate = toDecimal(rateSnapshot.electricityRate);
    const commonFee = toDecimal(rateSnapshot.commonFee);
    const internetFee = toDecimal(rateSnapshot.internetFee);
    const parkingFee = toDecimal((rateSnapshot as any).parkingFee || '0.00');

    const waterMode = normalizeUtilityBillingMode((rateSnapshot as any).waterBillingType || 'per_unit');
    const elecMode = normalizeUtilityBillingMode((rateSnapshot as any).electricityBillingType || 'per_unit');
    const commonMode = (rateSnapshot as any).commonFeeMode || 'room';
    const internetMode = (rateSnapshot as any).internetFeeMode || 'room';
    const parkingMode = (rateSnapshot as any).parkingFeeMode || 'room';

    const room = await this.roomRepo.findById(roomId, dormitoryId);
    if (!room) {
      const err = new Error('ROOM_NOT_FOUND');
      (err as any).statusCode = 404;
      (err as any).code = 'ROOM_NOT_FOUND';
      throw err;
    }

    // 1. Resolve Contract (Priority 1) or ACTIVE ProvisionalRentalTerm (Priority 2)
    const activeContracts = await this.contractRepo.findActiveContractsForRoom(dormitoryId, roomId);
    let contract = activeContracts.length > 0 ? activeContracts[0] : null;
    let provisionalTerm: any = null;

    const prisma = getPrismaClient();
    const client = tx || prisma;

    if (!contract) {
      provisionalTerm = await this.resolveProvisionalBillingSource(dormitoryId, roomId, cycle, tx);

      if (!provisionalTerm) {
        // Check if there is an active provisional term out of cycle range
        const anyActive = await client.provisionalRentalTerm.findFirst({
          where: {
            dormitoryId,
            roomId,
            status: 'ACTIVE',
            deletedAt: null,
          },
        });
        if (anyActive) {
          const err = new Error('PROVISIONAL_TERM_NOT_ELIGIBLE_FOR_CYCLE');
          (err as any).statusCode = 400;
          (err as any).code = 'PROVISIONAL_TERM_NOT_ELIGIBLE_FOR_CYCLE';
          (err as any).message = 'ข้อตกลงเช่าชั่วคราวไม่อยู่ในช่วงเวลาของรอบบิลนี้';
          throw err;
        }
        const err = new Error('NO_ACTIVE_CONTRACT_OR_PROVISIONAL_TERM');
        (err as any).statusCode = 404;
        (err as any).code = 'NO_ACTIVE_CONTRACT_OR_PROVISIONAL_TERM';
        (err as any).message = 'ห้องพักไม่มีสัญญาหรือข้อตกลงเช่าที่พร้อมออกบิลสำหรับงวดนี้';
        throw err;
      }
    }

    const tenantId = contract ? contract.tenantId : provisionalTerm.tenantId;
    const tenant = tenantId ? await this.tenantRepo.findById(tenantId, dormitoryId) : null;

    // Resolve People Count
    const peopleCount = await billingOrchestrationService.resolveCyclePeopleCount(
      dormitoryId,
      billingCycleId,
      roomId,
      tenantId,
      tx
    );
    const peopleCountDec = toDecimal(peopleCount.toString());

    const items: Array<{ type: string; description: string; quantity: string; unit?: string; unitPrice: string; amount: string; metadata?: any }> = [];

    // Rent Fee: ONLY include when billKind is 'RENT' or 'LEGACY_COMBINED' (MONTHLY_UTILITY never absorbs rent)
    const shouldIncludeRent = billKind === 'RENT' || billKind === 'LEGACY_COMBINED';
    if (shouldIncludeRent) {
      if (contract) {
        const contractSnapshot = await client.contractSnapshot.findUnique({
          where: { contractId: contract.id },
        });
        const rentAmount = toDecimal(contract.rentAmount);
        const installmentConfig = contractSnapshot?.installmentConfig as any;
        if (installmentConfig && Array.isArray(installmentConfig.installmentSchedule) && installmentConfig.installmentSchedule.length > 0) {
          const contractStart = new Date(contract.startDate);
          const cycleStart = new Date(cycle.periodStart);
          const cycleOffset = (cycleStart.getFullYear() - contractStart.getFullYear()) * 12 + (cycleStart.getMonth() - contractStart.getMonth());

          const scheduleItem = installmentConfig.installmentSchedule.find((s: any) => s.cycleOffset === cycleOffset);
          if (scheduleItem) {
            items.push({
              type: 'rent',
              description: scheduleItem.description || `ค่าเช่าห้องพัก (งวดที่ ${scheduleItem.installmentNo}/${installmentConfig.selectedInstallments})`,
              quantity: '1.00',
              unit: 'installment',
              unitPrice: scheduleItem.amount,
              amount: scheduleItem.amount,
              metadata: {
                installmentNo: scheduleItem.installmentNo,
                totalInstallments: installmentConfig.selectedInstallments,
                termRentTotal: installmentConfig.termRentTotal,
                cycleOffset,
                isFinalInstallment: scheduleItem.installmentNo === installmentConfig.selectedInstallments,
              },
            });
          }
        } else {
          items.push({
            type: 'rent',
            description: 'ค่าเช่าห้องพัก',
            quantity: '1.00',
            unit: 'month',
            unitPrice: formatDecimal(rentAmount),
            amount: formatDecimal(rentAmount),
          });
        }
      } else if (provisionalTerm) {
        if (provisionalTerm.rentalType === 'MONTHLY') {
          const unitRent = toDecimal(provisionalTerm.unitRentAmount.toString());
          if (!isZeroDecimal(unitRent)) {
            items.push({
              type: 'rent',
              description: 'ค่าเช่าห้องพัก',
              quantity: '1.00',
              unit: 'month',
              unitPrice: formatDecimal(unitRent),
              amount: formatDecimal(unitRent),
              metadata: {
                provisionalRentalTermId: provisionalTerm.id,
                rentalType: 'MONTHLY',
              },
            });
          }
        } else {
          // TERM
          const installments = provisionalTerm.termInstallmentCount || 1;
          const termStart = new Date(provisionalTerm.startDate);
          const cycleStart = new Date(cycle.periodStart);
          const cycleOffset = (cycleStart.getFullYear() - termStart.getFullYear()) * 12 + (cycleStart.getMonth() - termStart.getMonth());

          if (cycleOffset >= 0 && cycleOffset < installments) {
            const schedule = calculateInstallmentSchedule(Number(provisionalTerm.totalRentAmount), installments);
            const currentInstallment = schedule[cycleOffset];
            const installmentAmt = toDecimal(currentInstallment.formattedAmount);
            items.push({
              type: 'rent',
              description: `ค่าเช่าห้องพัก (งวดที่ ${cycleOffset + 1}/${installments})`,
              quantity: '1.00',
              unit: 'installment',
              unitPrice: formatDecimal(installmentAmt),
              amount: formatDecimal(installmentAmt),
              metadata: {
                provisionalRentalTermId: provisionalTerm.id,
                rentalType: 'TERM',
                installmentNo: cycleOffset + 1,
                totalInstallments: installments,
              },
            });
          }
        }
      }
    }

    let waterUsageStr = '0.00';
    let waterItemAmount = '0.00';
    let elecUsageStr = '0.00';
    let elecItemAmount = '0.00';
    let commonItemAmount = '0.00';
    let internetItemAmount = '0.00';
    let parkingItemAmount = '0.00';
    let manualOutstandingStr = '0.00';
    let otherFeesList: Array<{ description: string; amount: string }> = [];

    // Utility Charges: ONLY include when billKind is 'MONTHLY_UTILITY' or 'LEGACY_COMBINED'
    const shouldIncludeUtilities = billKind === 'MONTHLY_UTILITY' || billKind === 'LEGACY_COMBINED';

    if (shouldIncludeUtilities) {
      const waterReading = await this.meterRepo.findReadingByCycleRoomAndType(
        dormitoryId,
        billingCycleId,
        roomId,
        'water',
        tx
      );

      const elecReading = await this.meterRepo.findReadingByCycleRoomAndType(
        dormitoryId,
        billingCycleId,
        roomId,
        'electricity',
        tx
      );

      let vehicleCount = 0;
      const parkingMode = (rateSnapshot as any).parkingFeeMode || 'room';
      if (parkingMode === 'vehicle' || parkingMode === 'per_vehicle') {
        const vehicles = tenantId ? await this.tenantRepo.findVehicles(tenantId, dormitoryId) : [];
        vehicleCount = vehicles.length;
      }

      const cycleSnapshot = await client.roomBillingCycleSnapshot.findUnique({
        where: {
          dormitory_billing_cycle_room_unique: {
            dormitoryId,
            billingCycleId,
            roomId,
          },
        },
      });

      const utilityResult = calculateCanonicalMonthlyUtility({
        dormitoryId,
        billingCycleId,
        roomId,
        rateSnapshot,
        waterReading,
        electricReading: elecReading,
        peopleCount,
        parkingQuantity: vehicleCount,
        manualOutstanding: cycleSnapshot?.manualOutstandingAmount ? cycleSnapshot.manualOutstandingAmount.toString() : undefined,
        otherFees: (cycleSnapshot?.otherFees as any[]) || [],
        dueDate: cycle?.dueDate,
        asOfDate: asOfDate || new Date(),
      });

      items.push(...utilityResult.items);
      waterUsageStr = utilityResult.waterUsage;
      waterItemAmount = utilityResult.waterAmount;
      elecUsageStr = utilityResult.electricityUsage;
      elecItemAmount = utilityResult.electricityAmount;
      commonItemAmount = utilityResult.commonFee;
      internetItemAmount = utilityResult.internetFee;
      parkingItemAmount = utilityResult.parkingFee;
      manualOutstandingStr = utilityResult.manualOutstandingAmount;
      otherFeesList = utilityResult.otherFees;
    }

    let subtotalDec = toDecimal('0.00');
    for (const item of items) {
      subtotalDec = addDecimals(subtotalDec, item.amount);
    }

    const rentItemAmount = items.find((i) => i.type === 'rent')?.amount || '0.00';

    return {
      contractId: contract ? contract.id : null,
      provisionalRentalTermId: provisionalTerm ? provisionalTerm.id : null,
      roomId,
      tenantId: tenantId || (tenant ? tenant.id : ''),
      rentAmount: rentItemAmount,
      waterUsage: waterUsageStr,
      waterRate: formatDecimal(waterRate),
      waterAmount: waterItemAmount,
      electricityUsage: elecUsageStr,
      electricityRate: formatDecimal(elecRate),
      electricityAmount: elecItemAmount,
      commonFee: commonItemAmount,
      internetFee: internetItemAmount,
      parkingFee: parkingItemAmount,
      manualOutstandingAmount: manualOutstandingStr,
      lateFeeAmount: items.find((i) => i.type === 'late_fee')?.amount || '0.00',
      otherFees: otherFeesList,
      peopleCount,
      subtotal: formatDecimal(subtotalDec),
      discountAmount: '0.00',
      totalAmount: formatDecimal(subtotalDec),
      items,
    };
  }

  public async generateBill(
    dormitoryId: string,
    data: GenerateBillDto,
    userId?: string,
    issuanceTimestamp?: Date,
    existingTx?: any
  ): Promise<{ bill: BillEntity; items: BillItemEntity[]; created: boolean }> {
    const cycle = await this.billingCycleRepo.findById(data.billingCycleId, dormitoryId);
    if (!cycle) {
      const err = new Error('BILLING_CYCLE_NOT_FOUND');
      (err as any).statusCode = 404;
      (err as any).code = 'BILLING_CYCLE_NOT_FOUND';
      throw err;
    }

    if (cycle.status === 'locked' || cycle.status === 'completed') {
      const err = new Error('BILLING_CYCLE_LOCKED');
      (err as any).statusCode = 400;
      (err as any).code = 'BILLING_CYCLE_LOCKED';
      throw err;
    }

    const issuanceNow = issuanceTimestamp || new Date();

    // Assert room operational entitlement before any operational bill issuance
    await subscriptionEntitlementService.assertRoomOperationalEntitlement(
      dormitoryId,
      data.roomId,
      issuanceNow,
      existingTx
    );

    const prisma = existingTx || getPrismaClient();
    const settings = await prisma.dormitoryBillingSettings.findUnique({
      where: { dormitoryId },
    });
    if (!settings || settings.dueDay === null || settings.dueDay === undefined) {
      const err = new Error('DORMITORY_BILLING_SETTINGS_REQUIRED: Authoritative dormitory dueDay is required to issue bills');
      (err as any).statusCode = 400;
      (err as any).code = 'DORMITORY_BILLING_SETTINGS_REQUIRED';
      throw err;
    }

    // Derive/validate active contract or active provisional rental term for room
    const activeContracts = await this.contractRepo.findActiveContractsForRoom(dormitoryId, data.roomId);
    let contract = activeContracts.length > 0 ? activeContracts[0] : null;
    let provisionalTerm: any = null;

    if (!contract) {
      provisionalTerm = await this.resolveProvisionalBillingSource(dormitoryId, data.roomId, cycle, existingTx);

      if (!provisionalTerm) {
        const anyActive = await (existingTx || prisma).provisionalRentalTerm.findFirst({
          where: {
            dormitoryId,
            roomId: data.roomId,
            status: 'ACTIVE',
            deletedAt: null,
          },
        });
        if (anyActive) {
          const err = new Error('PROVISIONAL_TERM_NOT_ELIGIBLE_FOR_CYCLE');
          (err as any).statusCode = 400;
          (err as any).code = 'PROVISIONAL_TERM_NOT_ELIGIBLE_FOR_CYCLE';
          (err as any).message = 'ข้อตกลงเช่าชั่วคราวไม่อยู่ในช่วงเวลาของรอบบิลนี้';
          throw err;
        }
        const err = new Error('NO_ACTIVE_CONTRACT_OR_PROVISIONAL_TERM');
        (err as any).statusCode = 404;
        (err as any).code = 'NO_ACTIVE_CONTRACT_OR_PROVISIONAL_TERM';
        throw err;
      }
    }

    const effectiveContractId = contract ? contract.id : null;
    const effectiveProvisionalRentalTermId = provisionalTerm ? provisionalTerm.id : null;
    const effectiveTenantId = contract ? contract.tenantId : provisionalTerm.tenantId;

    if (data.contractId && effectiveContractId && data.contractId !== effectiveContractId) {
      const err = new Error('CONTRACT_ROOM_MISMATCH');
      (err as any).statusCode = 400;
      (err as any).code = 'CONTRACT_ROOM_MISMATCH';
      (err as any).message = 'สัญญาที่ระบุไม่ตรงกับสัญญาของห้องพัก';
      throw err;
    }

    if (data.tenantId && data.tenantId !== effectiveTenantId) {
      const err = new Error('TENANT_CONTRACT_MISMATCH');
      (err as any).statusCode = 400;
      (err as any).code = 'TENANT_CONTRACT_MISMATCH';
      (err as any).message = 'ผู้เช่าที่ระบุไม่ตรงกับผู้เช่าในห้องพัก';
      throw err;
    }

    const billingDate = resolveBillIssueDate(issuanceNow);
    const dueDate = resolveBillDueDate(issuanceNow, settings.dueDay);
    const billKind = data.billKind || 'LEGACY_COMBINED';

    const executeInTx = async (tx: any) => {
      await this.billRepo.executeRawLock(data.roomId, tx);

      const existingBill = await this.billRepo.findByCycleAndRoom(
        dormitoryId,
        data.billingCycleId,
        data.roomId,
        billKind,
        tx
      );
      if (existingBill) {
        const items = await this.billRepo.getBillItems(existingBill.id, dormitoryId, tx);
        return { bill: existingBill, items, created: false };
      }

      const preview = await this.generateBillPreview(dormitoryId, data.billingCycleId, data.roomId, tx, billKind);
      const rateSnapshot = await this.billingCycleRepo.findRateSnapshot(data.billingCycleId, dormitoryId);

      const billItems: CreateBillItemData[] = preview.items.map((i, idx) => ({
        type: i.type,
        description: i.description,
        quantity: i.quantity,
        unit: i.unit || null,
        unitPrice: i.unitPrice,
        amount: i.amount,
        metadata: i.metadata || null,
        displayOrder: idx,
      }));

      if (data.customItems) {
        data.customItems.forEach((ci, idx) => {
          billItems.push({
            type: ci.type,
            description: ci.description,
            quantity: ci.quantity,
            unit: (ci as any).unit || null,
            unitPrice: ci.unitPrice,
            amount: ci.amount,
            metadata: (ci as any).metadata || null,
            displayOrder: preview.items.length + idx,
          });
        });
      }

      let subtotalDec = toDecimal('0.00');
      for (const item of billItems) {
        subtotalDec = addDecimals(subtotalDec, item.amount);
      }

      const discountDec = toDecimal(data.discountAmount || '0.00');
      const rawTotal = subDecimals(subtotalDec, discountDec);
      const totalDec = compareDecimals(rawTotal, '0.00') < 0 ? toDecimal('0.00') : rawTotal;

      const countRes = await this.billRepo.findAll(dormitoryId, { billingCycleId: data.billingCycleId }, tx);
      const billSeq = (countRes.total + 1).toString().padStart(4, '0');
      const billNumber = `INV-${cycle.cycleCode}-${billSeq}`;

      let createdData;
      try {
        createdData = await this.billRepo.create(
          dormitoryId,
          {
            billingCycleId: data.billingCycleId,
            contractId: effectiveContractId,
            provisionalRentalTermId: effectiveProvisionalRentalTermId,
            roomId: data.roomId,
            tenantId: effectiveTenantId,
            billKind,
            billNumber,
            status: 'unpaid',
            billingDate,
            dueDate,
            subtotal: formatDecimal(subtotalDec),
            discountAmount: formatDecimal(discountDec),
            totalAmount: formatDecimal(totalDec),
            outstandingAmount: formatDecimal(totalDec),
            rateSnapshotId: rateSnapshot?.id,
            generatedByUserId: userId,
            generatedAt: issuanceNow,
          },
          billItems,
          tx
        );
      } catch (err: any) {
        if (err.code === 'P2002') {
          const doubleCheckExisting = await this.billRepo.findByCycleAndRoom(
            dormitoryId,
            data.billingCycleId,
            data.roomId,
            billKind,
            tx
          );
          if (doubleCheckExisting) {
            const items = await this.billRepo.getBillItems(doubleCheckExisting.id, dormitoryId, tx);
            return { bill: doubleCheckExisting, items, created: false };
          }
          const e = new Error('BILL_ALREADY_EXISTS_FOR_ROOM');
          (e as any).statusCode = 409;
          (e as any).code = 'BILL_ALREADY_EXISTS_FOR_ROOM';
          throw e;
        }
        throw err;
      }

      const { bill, items } = createdData;

      if (this.auditService) {
        await this.auditService.log({
          dormitoryId,
          actorUserId: userId || 'system',
          action: 'bill.generate',
          resourceType: 'bill',
          resourceId: bill.id,
          details: { billNumber, cycle: cycle.cycleCode, roomId: data.roomId },
        });
      }

      return { bill, items, created: true };
    };

    if (existingTx) {
      return executeInTx(existingTx);
    }
    return this.billRepo.withTransaction(executeInTx);
  }

  public async bulkGenerateBills(
    dormitoryId: string,
    billingCycleId: string,
    roomIds?: string[],
    userId?: string,
    dirtyRows?: any[]
  ): Promise<{
    generatedCount: number;
    bills: BillEntity[];
    generated: Array<{ roomId: string; billId: string; billNumber: string }>;
    excluded: Array<{ roomId: string; reason: string }>;
    failed: Array<{ roomId: string; error: string; code: string }>;
  }> {
    const cycle = await this.billingCycleRepo.findById(billingCycleId, dormitoryId);
    if (!cycle) {
      const err = new Error('BILLING_CYCLE_NOT_FOUND');
      (err as any).statusCode = 404;
      (err as any).code = 'BILLING_CYCLE_NOT_FOUND';
      throw err;
    }

    const issuanceNow = new Date();
    const prisma = getPrismaClient();

    let targetRooms: string[] = [];
    if (roomIds && roomIds.length > 0) {
      targetRooms = roomIds;
    } else {
      const roomRes = await this.roomRepo.findAll(dormitoryId, {
        pageSize: ENTITLEMENT_ROOM_LIMITS.PAID,
      });
      targetRooms = roomRes.items.map((r) => r.id);
    }

    const dirtyRowsMap = new Map<string, any>();
    if (dirtyRows && Array.isArray(dirtyRows)) {
      for (const dr of dirtyRows) {
        if (dr && dr.roomId) {
          dirtyRowsMap.set(dr.roomId, dr);
        }
      }
    }

    // Resolve authoritative operational room entitlement set once (O(1) in-memory check per room)
    const entitlementSet = await subscriptionEntitlementService.resolveOperationalRoomEntitlementSet(
      dormitoryId,
      issuanceNow
    );

    const generatedBills: BillEntity[] = [];
    const generated: Array<{ roomId: string; billId: string; billNumber: string }> = [];
    const excluded: Array<{ roomId: string; reason: string }> = [];
    const failed: Array<{ roomId: string; error: string; code: string }> = [];

    const { meterService } = await import('./meter.service.js');

    for (const roomId of targetRooms) {
      if (entitlementSet.operationalRoomIds.has(roomId)) {
        // Operational room -> proceed
      } else if (entitlementSet.lockedRoomIds.has(roomId)) {
        excluded.push({ roomId, reason: 'ROOM_ENTITLEMENT_LOCKED' });
        continue;
      } else {
        // Foreign room, archived room, or nonexistent room UUID
        excluded.push({ roomId, reason: 'ROOM_NOT_FOUND' });
        continue;
      }

      const dirtyRow = dirtyRowsMap.get(roomId);

      if (dirtyRow) {
        // Atomic per-room transaction: save dirty row + issue bill
        try {
          await this.meterRepo.withTransaction(async (tx) => {
            await this.meterRepo.executeRawLock(roomId, tx);
            await meterService.saveSingleRoomWorkspaceInTx(dormitoryId, billingCycleId, dirtyRow, userId, tx);
            const { bill, created } = await this.generateBill(
              dormitoryId,
              { billingCycleId, roomId, billKind: 'MONTHLY_UTILITY' },
              userId,
              issuanceNow,
              tx
            );
            if (created) {
              generatedBills.push(bill);
              generated.push({ roomId, billId: bill.id, billNumber: bill.billNumber });
            } else {
              excluded.push({ roomId, reason: 'BILL_ALREADY_EXISTS' });
            }
          });
        } catch (err: any) {
          if (
            err.code === 'MISSING_METER_READING' ||
            err.code === 'NO_ACTIVE_CONTRACT_OR_PROVISIONAL_TERM' ||
            err.code === 'PROVISIONAL_TERM_NOT_ELIGIBLE_FOR_CYCLE' ||
            err.code === 'BILL_ALREADY_EXISTS' ||
            err.code === 'ROOM_ENTITLEMENT_LOCKED' ||
            err.code === 'ROOM_NOT_FOUND'
          ) {
            excluded.push({ roomId, reason: err.code });
          } else {
            failed.push({
              roomId,
              error: err.message || 'Error generating bill',
              code: err.code || 'BILL_GENERATION_FAILED',
            });
          }
        }
      } else {
        // Standard room issuance without dirty row
        const activeContracts = await this.contractRepo.findActiveContractsForRoom(dormitoryId, roomId);
        let contract = activeContracts.length > 0 ? activeContracts[0] : null;
        let provisionalTerm: any = null;

        if (!contract) {
          provisionalTerm = await this.resolveProvisionalBillingSource(dormitoryId, roomId, cycle);
        }

        if (!contract && !provisionalTerm) {
          excluded.push({ roomId, reason: 'NO_ACTIVE_CONTRACT_OR_PROVISIONAL_TERM' });
          continue;
        }

        const existing = await this.billRepo.findActiveMonthlyUtilityByRoomAndCycle(dormitoryId, billingCycleId, roomId);
        if (existing) {
          excluded.push({ roomId, reason: 'BILL_ALREADY_EXISTS' });
          continue;
        }

        try {
          const { bill, created } = await this.generateBill(
            dormitoryId,
            {
              billingCycleId,
              roomId,
              billKind: 'MONTHLY_UTILITY',
            },
            userId,
            issuanceNow
          );
          if (created) {
            generatedBills.push(bill);
            generated.push({ roomId, billId: bill.id, billNumber: bill.billNumber });
          } else {
            excluded.push({ roomId, reason: 'BILL_ALREADY_EXISTS' });
          }
        } catch (err: any) {
          if (
            err.code === 'MISSING_METER_READING' ||
            err.code === 'NO_ACTIVE_CONTRACT_OR_PROVISIONAL_TERM' ||
            err.code === 'PROVISIONAL_TERM_NOT_ELIGIBLE_FOR_CYCLE' ||
            err.code === 'BILL_ALREADY_EXISTS' ||
            err.code === 'ROOM_ENTITLEMENT_LOCKED' ||
            err.code === 'ROOM_NOT_FOUND'
          ) {
            excluded.push({ roomId, reason: err.code });
          } else {
            failed.push({
              roomId,
              error: err.message || 'Error generating bill',
              code: err.code || 'BILL_GENERATION_FAILED',
            });
          }
        }
      }
    }

    // Update cycle status to generated if at least one bill generated
    if (cycle.status === 'draft' && generatedBills.length > 0) {
      await this.billingCycleRepo.update(billingCycleId, dormitoryId, {
        status: 'generated',
        generatedAt: issuanceNow,
      });
    }

    return {
      generatedCount: generatedBills.length,
      bills: generatedBills,
      generated,
      excluded,
      failed,
    };
  }

  public async getBills(
    dormitoryId: string,
    filter: BillFilterQuery = {}
  ): Promise<{ items: BillEntity[]; total: number }> {
    return this.billRepo.findAll(dormitoryId, filter);
  }

  public async getBillById(
    id: string,
    dormitoryId: string
  ): Promise<{ bill: BillEntity; items: BillItemEntity[] }> {
    const bill = await this.billRepo.findById(id, dormitoryId);
    if (!bill) {
      const err = new Error('BILL_NOT_FOUND');
      (err as any).statusCode = 404;
      (err as any).code = 'BILL_NOT_FOUND';
      throw err;
    }

    const items = await this.billRepo.getBillItems(bill.id, dormitoryId);
    return { bill, items };
  }

  public async cancelBill(
    id: string,
    dormitoryId: string,
    reason: string,
    userId?: string
  ): Promise<BillEntity> {
    const bill = await this.billRepo.findById(id, dormitoryId);
    if (!bill) {
      const err = new Error('BILL_NOT_FOUND');
      (err as any).statusCode = 404;
      (err as any).code = 'BILL_NOT_FOUND';
      throw err;
    }

    if (bill.status === 'paid' || bill.status === 'cancelled') {
      const err = new Error('BILL_CANNOT_BE_CANCELLED');
      (err as any).statusCode = 400;
      (err as any).code = 'BILL_CANNOT_BE_CANCELLED';
      throw err;
    }

    const updated = await this.billRepo.update(
      id,
      dormitoryId,
      {
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelledByUserId: userId,
        cancellationReason: reason,
      },
      bill.version
    );

    if (!updated) {
      const err = new Error('BILL_NOT_FOUND');
      (err as any).statusCode = 404;
      (err as any).code = 'BILL_NOT_FOUND';
      throw err;
    }

    await this.billRepo.addStatusHistory(
      dormitoryId,
      id,
      bill.status,
      'cancelled',
      reason,
      userId
    );

    if (this.auditService) {
      await this.auditService.log({
        dormitoryId,
        actorUserId: userId || 'system',
        action: 'bill.cancel',
        resourceType: 'bill',
        resourceId: id,
        details: { reason },
      });
    }

    return updated;
  }

  public async getBillingSummary(
    dormitoryId: string,
    billingCycleId?: string
  ): Promise<{
    totalBills: number;
    totalAmount: string;
    paidAmount: string;
    outstandingAmount: string;
    statusCounts: Record<string, number>;
  }> {
    return this.billRepo.getSummary(dormitoryId, billingCycleId);
  }
}
