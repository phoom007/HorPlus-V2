import { generateNextBillNumberInTx } from '../utils/bill-number.util.js';
import {
  IBillRepository,
  BillEntity,
  BillItemEntity,
  BillFilterQuery,
  CreateBillItemData,
  PrismaBillRepository,
} from '../db/repositories/bill.repository.js';
import { IBillingCycleRepository, PrismaBillingCycleRepository } from '../db/repositories/billing-cycle.repository.js';
import { IMeterRepository, PrismaMeterRepository } from '../db/repositories/meter.repository.js';
import { IContractRepository, PrismaContractRepository } from '../db/repositories/contract.repository.js';
import { IRoomRepository, PrismaRoomRepository } from '../db/repositories/room.repository.js';
import { ITenantRepository, PrismaTenantRepository } from '../db/repositories/tenant.repository.js';
import { AuditService } from './audit.service.js';
import { billingOrchestrationService } from './billing-orchestration.service.js';
import { resolveProvisionalBillingSource as sharedResolveProvisionalBillingSource } from './provisional-billing-source.service.js';
import { ENTITLEMENT_ROOM_LIMITS } from './entitlement.service.js';
import { subscriptionEntitlementService } from './subscription-entitlement.service.js';
import { toDecimal, addDecimals, mulDecimals, divDecimals, formatDecimal, subDecimals, compareDecimals, isZeroDecimal } from '../utils/decimal-math.util.js';
import { calculateInstallmentSchedule } from '../utils/installment-calculator.util.js';
import { normalizeUtilityBillingMode } from '../utils/billing-mode-normalizer.util.js';
import { calculateCanonicalMonthlyUtility, calculateCategoryStrictVat } from '../utils/monthly-utility-calculator.util.js';
import { isAgreementEligibleForBillingCycle } from '../utils/calendar-date.util.js';
import { resolveCycleAwareVehicleCount, resolveCurrentActiveVehicleCount } from '../utils/vehicle-billing.util.js';
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
  vatableSubtotal?: string;
  vatAmount?: string;
  discountAmount: string;
  totalAmount: string;
  netTotal?: string;
  isVatActive?: boolean;
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

  /**
   * Authoritatively resolves the active billing agreement (Contract or ProvisionalRentalTerm) for a room in a cycle.
   *
   * Priority 1: Eligible active Contract (status active, deletedAt null, overlapping cycle: startDate <= periodEnd && endDate >= periodStart)
   * Priority 2: Eligible active ProvisionalRentalTerm (status ACTIVE, deletedAt null, overlapping cycle: startDate <= periodEnd && endDate >= periodStart)
   *
   * Rejections:
   * - If active contracts exist for the room but none overlap target cycle -> CONTRACT_NOT_ELIGIBLE_FOR_CYCLE (400)
   * - If no active contracts exist, but active provisional terms exist out of cycle -> PROVISIONAL_TERM_NOT_ELIGIBLE_FOR_CYCLE (400)
   * - If no active contract or provisional term exists -> NO_ACTIVE_CONTRACT_OR_PROVISIONAL_TERM (404)
   */
  public async resolveActiveAgreementBillingSource(
    dormitoryId: string,
    roomId: string,
    billingCycle: { periodStart: Date | string; periodEnd: Date | string },
    tx?: any
  ): Promise<{ contract: any | null; provisionalTerm: any | null }> {
    // 1. Fetch cycle-eligible contracts for room (cleanly separated from physical-active semantics)
    const activeContracts = typeof (this.contractRepo as any).findCycleEligibleContractsForRoom === 'function'
      ? await (this.contractRepo as any).findCycleEligibleContractsForRoom(dormitoryId, roomId, tx)
      : await this.contractRepo.findActiveContractsForRoom(dormitoryId, roomId);

    if (activeContracts && activeContracts.length > 0) {
      const overlappingContracts = activeContracts.filter((c: any) =>
        isAgreementEligibleForBillingCycle({
          agreementStartDate: c.startDate,
          agreementEndDate: c.endDate,
          cyclePeriodStart: billingCycle.periodStart,
          cyclePeriodEnd: billingCycle.periodEnd,
          status: c.status,
          terminationEffectiveDate: c.terminationEffectiveDate || (c.status === 'terminated' ? c.terminatedAt : null),
        })
      );

      if (overlappingContracts.length === 0) {
        const err = new Error('CONTRACT_NOT_ELIGIBLE_FOR_CYCLE');
        (err as any).statusCode = 400;
        (err as any).code = 'CONTRACT_NOT_ELIGIBLE_FOR_CYCLE';
        (err as any).message = 'สัญญาเช่าไม่อยู่ในช่วงเวลาของรอบบิลนี้';
        throw err;
      }

      overlappingContracts.sort((a: any, b: any) => {
        const aStart = new Date(a.startDate).getTime();
        const bStart = new Date(b.startDate).getTime();
        if (aStart !== bStart) return aStart - bStart;
        const aCreated = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bCreated = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bCreated - aCreated;
      });

      return { contract: overlappingContracts[0], provisionalTerm: null };
    }

    // 2. If no active contracts exist, resolve ProvisionalRentalTerm (Priority 2)
    const provisionalTerm = await this.resolveProvisionalBillingSource(dormitoryId, roomId, billingCycle, tx);

    if (provisionalTerm) {
      return { contract: null, provisionalTerm };
    }

    const prisma = getPrismaClient();
    const client = tx || prisma;
    const anyActiveTerm = await client.provisionalRentalTerm.findFirst({
      where: {
        dormitoryId,
        roomId,
        status: 'ACTIVE',
        deletedAt: null,
      },
    });

    if (anyActiveTerm) {
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

  public async generateBillPreview(
    dormitoryId: string,
    billingCycleId: string,
    roomId: string,
    tx?: any,
    billKind: string = 'LEGACY_COMBINED',
    asOfDate?: Date | string | null,
    billDueDate?: Date | string | null
  ): Promise<BillPreviewResult> {
    const prisma = getPrismaClient();
    const client = tx || prisma;

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

    // 1. Resolve Contract (Priority 1) or ACTIVE ProvisionalRentalTerm (Priority 2) with cycle eligibility
    const { contract, provisionalTerm } = await this.resolveActiveAgreementBillingSource(
      dormitoryId,
      roomId,
      cycle,
      tx
    );

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
    let waterRateStr = formatDecimal(waterRate);
    let waterItemAmount = '0.00';
    let elecUsageStr = '0.00';
    let elecRateStr = formatDecimal(elecRate);
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
        let vehicles: any[] = [];
        if (tenantId) {
          if (client?.tenantVehicle?.findMany) {
            vehicles = await client.tenantVehicle.findMany({
              where: { tenantId, dormitoryId, deletedAt: null },
            });
          } else {
            vehicles = await this.tenantRepo.findVehicles(tenantId, dormitoryId);
          }
        }
        vehicleCount = resolveCurrentActiveVehicleCount(vehicles);
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

      // DECISION F3 & F5: Late fee applies ONLY to issued bills using Bill.dueDate.
      // If billDueDate is not explicitly passed, look up whether an issued bill exists for this room + cycle.
      let effectiveDueDate: Date | string | null = billDueDate !== undefined ? billDueDate : null;
      if (effectiveDueDate === null && tx) {
        const existingIssuedBill = await tx.bill.findFirst({
          where: {
            dormitoryId,
            billingCycleId,
            roomId,
            billKind: 'MONTHLY_UTILITY',
          },
          select: { dueDate: true },
        });
        if (existingIssuedBill) {
          effectiveDueDate = existingIssuedBill.dueDate;
        }
      }

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
        dueDate: effectiveDueDate,
        asOfDate: asOfDate || new Date(),
      });

      items.push(...utilityResult.items);
      waterUsageStr = utilityResult.waterUsage;
      waterRateStr = utilityResult.waterRate;
      waterItemAmount = utilityResult.waterAmount;
      elecUsageStr = utilityResult.electricityUsage;
      elecRateStr = utilityResult.electricityRate;
      elecItemAmount = utilityResult.electricityAmount;
      commonItemAmount = utilityResult.commonFee;
      internetItemAmount = utilityResult.internetFee;
      parkingItemAmount = utilityResult.parkingFee;
      manualOutstandingStr = utilityResult.manualOutstandingAmount;
      otherFeesList = utilityResult.otherFees;
    }

    let billingSettings: any = null;
    try {
      billingSettings = await client.dormitoryBillingSettings.findUnique({
        where: { dormitoryId },
      });
    } catch {
      // Fallback gracefully if database or mock
    }
    const vatSettings = (billingSettings?.vatSettings as any) || null;
    const vatCalc = calculateCategoryStrictVat(items, vatSettings);

    const enrichedItems = vatCalc.items.map((vi) => {
      const item = { ...vi.item };
      if (vi.isTaxable) {
        item.metadata = {
          ...(item.metadata || {}),
          isTaxable: true,
          vatRate: vi.vatRate,
          vatAmount: vi.vatAmount,
          netAmount: vi.netAmount,
        };
      }
      return item;
    });

    const rentItemAmount = items.find((i) => i.type === 'rent')?.amount || '0.00';

    return {
      contractId: contract ? contract.id : null,
      provisionalRentalTermId: provisionalTerm ? provisionalTerm.id : null,
      roomId,
      tenantId: tenantId || (tenant ? tenant.id : ''),
      rentAmount: rentItemAmount,
      waterUsage: waterUsageStr,
      waterRate: waterRateStr,
      waterAmount: waterItemAmount,
      electricityUsage: elecUsageStr,
      electricityRate: elecRateStr,
      electricityAmount: elecItemAmount,
      commonFee: commonItemAmount,
      internetFee: internetItemAmount,
      parkingFee: parkingItemAmount,
      manualOutstandingAmount: manualOutstandingStr,
      lateFeeAmount: items.find((i) => i.type === 'late_fee')?.amount || '0.00',
      otherFees: otherFeesList,
      peopleCount,
      subtotal: vatCalc.baseSubtotal,
      vatableSubtotal: vatCalc.vatableSubtotal,
      vatAmount: vatCalc.vatAmount,
      discountAmount: '0.00',
      totalAmount: vatCalc.netTotal,
      netTotal: vatCalc.netTotal,
      isVatActive: vatCalc.isVatActive,
      items: enrichedItems,
    };
  }

  public async generateBill(
    dormitoryId: string,
    data: GenerateBillDto,
    userId?: string,
    issuanceTimestamp?: Date,
    existingTx?: any,
    options?: { suppressLineNotification?: boolean }
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

    // Derive/validate active contract or active provisional rental term for room with cycle eligibility
    const { contract, provisionalTerm } = await this.resolveActiveAgreementBillingSource(
      dormitoryId,
      data.roomId,
      cycle,
      existingTx
    );

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

    const billKind = data.billKind || 'LEGACY_COMBINED';

    let billingDate: Date;
    let dueDate: Date;

    if (billKind === 'RENT') {
      billingDate = new Date(cycle.periodStart);
      dueDate = cycle.dueDate
        ? new Date(cycle.dueDate)
        : resolveBillDueDate(new Date(cycle.periodStart), settings.dueDay);
    } else {
      billingDate = data.billingDate ? new Date(data.billingDate) : resolveBillIssueDate(issuanceNow);
      dueDate = data.dueDate ? new Date(data.dueDate) : resolveBillDueDate(issuanceNow, settings.dueDay);
    }

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

      const preview = await this.generateBillPreview(
        dormitoryId,
        data.billingCycleId,
        data.roomId,
        tx,
        billKind,
        issuanceNow,
        dueDate
      );
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

      if (billKind === 'RENT' && billItems.length === 0) {
        const err = new Error('NO_RENT_DUE_FOR_CYCLE');
        (err as any).statusCode = 400;
        (err as any).code = 'NO_RENT_DUE_FOR_CYCLE';
        (err as any).message = 'ไม่มีรายการค่าเช่าที่ต้องชำระในรอบบิลนี้';
        throw err;
      }

      const discountDec = toDecimal(data.discountAmount || '0.00');
      const vatSettings = (settings?.vatSettings as any) || null;
      const vatCalc = calculateCategoryStrictVat(billItems, vatSettings, formatDecimal(discountDec));

      // Enrich bill items with VAT metadata
      vatCalc.items.forEach((vi, idx) => {
        if (vi.isTaxable) {
          billItems[idx].metadata = {
            ...(billItems[idx].metadata || {}),
            isTaxable: true,
            vatRate: vi.vatRate,
            vatAmount: vi.vatAmount,
            netAmount: vi.netAmount,
          };
        }
      });

      const totalDec = toDecimal(vatCalc.netTotal);
      const isZeroTotal = isZeroDecimal(totalDec);
      const effectiveStatus = isZeroTotal ? 'paid' : 'unpaid';
      const effectiveOutstanding = isZeroTotal ? '0.00' : formatDecimal(totalDec);
      const effectivePaidAmount = '0.00';

      const billNumber = await generateNextBillNumberInTx(tx, dormitoryId, cycle.cycleCode);

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
            status: effectiveStatus,
            billingDate,
            dueDate,
            subtotal: vatCalc.baseSubtotal,
            discountAmount: formatDecimal(discountDec),
            totalAmount: formatDecimal(totalDec),
            paidAmount: effectivePaidAmount,
            outstandingAmount: effectiveOutstanding,
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

    const result = existingTx ? await executeInTx(existingTx) : await this.billRepo.withTransaction(executeInTx);

    if (result.created && !options?.suppressLineNotification && result.bill?.tenantId) {
      try {
        const { lineOaService, buildTenantInvoiceFlexMessage } = await import('./line-oa.service.js');
        const db = getPrismaClient();
        const dorm = await db.dormitory.findUnique({
          where: { id: dormitoryId },
          select: { name: true },
        });
        const room = await db.room.findUnique({
          where: { id: data.roomId },
          select: { roomNumber: true },
        });
        const dormitoryName = dorm?.name || 'หอพัก';
        const roomNumber = room?.roomNumber || 'GEN';

        await lineOaService.sendTenantLineNotification({
          dormitoryId,
          tenantId: result.bill.tenantId,
          eventType: 'INVOICE',
          eventId: `bill-issued:${result.bill.id}`,
          flexMessage: buildTenantInvoiceFlexMessage(
            dormitoryName,
            roomNumber,
            [
              {
                billNumber: result.bill.billNumber,
                billKind: result.bill.billKind,
                totalAmount: result.bill.totalAmount,
                dueDate: result.bill.dueDate,
              },
            ],
            result.bill.totalAmount,
            result.bill.dueDate
          ),
        });
      } catch (err: any) {
        console.warn(`[BillingService] Failed to send bill notification for bill ${result.bill.id}:`, err.message);
      }
    }

    return result;
  }

  public async bulkGenerateBills(
    dormitoryId: string,
    billingCycleId: string,
    roomIds?: string[],
    userId?: string,
    dirtyRows?: any[],
    requestedBillKind?: 'LEGACY_COMBINED' | 'MONTHLY_UTILITY' | 'RENT' | 'DEPOSIT'
  ): Promise<{
    generatedCount: number;
    bills: BillEntity[];
    generated: Array<{ roomId: string; billId: string; billNumber: string }>;
    excluded: Array<{ roomId: string; reason: string }>;
    failed: Array<{ roomId: string; error: string; code: string }>;
  }> {
    const targetBillKind = requestedBillKind || 'MONTHLY_UTILITY';
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
              { billingCycleId, roomId, billKind: targetBillKind },
              userId,
              issuanceNow,
              tx,
              { suppressLineNotification: true }
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
            err.code === 'CONTRACT_NOT_ELIGIBLE_FOR_CYCLE' ||
            err.code === 'PROVISIONAL_TERM_NOT_ELIGIBLE_FOR_CYCLE' ||
            err.code === 'NO_RENT_DUE_FOR_CYCLE' ||
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
        try {
          await this.resolveActiveAgreementBillingSource(dormitoryId, roomId, cycle);

          const existing = await this.billRepo.findByCycleAndRoom(dormitoryId, billingCycleId, roomId, targetBillKind);
          if (existing) {
            excluded.push({ roomId, reason: 'BILL_ALREADY_EXISTS' });
            continue;
          }

          const { bill, created } = await this.generateBill(
            dormitoryId,
            {
              billingCycleId,
              roomId,
              billKind: targetBillKind,
            },
            userId,
            issuanceNow,
            undefined,
            { suppressLineNotification: true }
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
            err.code === 'CONTRACT_NOT_ELIGIBLE_FOR_CYCLE' ||
            err.code === 'PROVISIONAL_TERM_NOT_ELIGIBLE_FOR_CYCLE' ||
            err.code === 'NO_RENT_DUE_FOR_CYCLE' ||
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

    // Update cycle status to generated if at least one bill generated (RENT alone does not activate operational cycle)
    if (cycle.status === 'draft' && generatedBills.length > 0 && targetBillKind !== 'RENT') {
      await this.billingCycleRepo.update(billingCycleId, dormitoryId, {
        status: 'generated',
        generatedAt: issuanceNow,
      });
    }

    // Send grouped LINE notifications per tenant (PO Decision A1)
    if (generatedBills.length > 0) {
      try {
        const { lineOaService, buildTenantInvoiceFlexMessage } = await import('./line-oa.service.js');
        const db = getPrismaClient();
        const dorm = await db.dormitory.findUnique({
          where: { id: dormitoryId },
          select: { name: true },
        });
        const dormitoryName = dorm?.name || 'หอพัก';

        const tenantBillsMap = new Map<string, BillEntity[]>();
        for (const bill of generatedBills) {
          if (bill.tenantId) {
            if (!tenantBillsMap.has(bill.tenantId)) {
              tenantBillsMap.set(bill.tenantId, []);
            }
            tenantBillsMap.get(bill.tenantId)!.push(bill);
          }
        }

        for (const [tId, billsForTenant] of tenantBillsMap.entries()) {
          try {
            const firstRoomId = billsForTenant[0].roomId;
            const room = await db.room.findUnique({
              where: { id: firstRoomId },
              select: { roomNumber: true },
            });
            const roomNumber = room?.roomNumber || 'GEN';

            const combinedTotal = billsForTenant.reduce(
              (sum, b) => sum + Number(b.totalAmount || 0),
              0
            );

            const dueDates = billsForTenant
              .map((b) => (b.dueDate ? new Date(b.dueDate).getTime() : Infinity))
              .filter((t) => t !== Infinity);
            const effectiveDueDate = dueDates.length > 0 ? new Date(Math.min(...dueDates)) : null;

            await lineOaService.sendTenantLineNotification({
              dormitoryId,
              tenantId: tId,
              eventType: 'INVOICE',
              eventId: `bulk-bill:${billingCycleId}:${tId}`,
              flexMessage: buildTenantInvoiceFlexMessage(
                dormitoryName,
                roomNumber,
                billsForTenant.map((b) => ({
                  billNumber: b.billNumber,
                  billKind: b.billKind,
                  totalAmount: b.totalAmount,
                  dueDate: b.dueDate,
                })),
                combinedTotal,
                effectiveDueDate
              ),
            });
          } catch (tErr: any) {
            console.warn(`[BillingService] Failed to send bulk bill notification to tenant ${tId}:`, tErr.message);
          }
        }
      } catch (lineErr: any) {
        console.warn('[BillingService] Failed to process bulk bill notifications:', lineErr.message);
      }
    }

    return {
      generatedCount: generatedBills.length,
      bills: generatedBills,
      generated,
      excluded,
      failed,
    };
  }

  public async generateRecurringRentBills(
    dormitoryId: string,
    billingCycleId: string,
    roomIds?: string[],
    userId?: string
  ) {
    return this.bulkGenerateBills(dormitoryId, billingCycleId, roomIds, userId, undefined, 'RENT');
  }

  public async reconcileRecurringRentBillsForAllDormitories(asOfDate: Date = new Date()): Promise<number> {
    const prisma = getPrismaClient();
    let totalGenerated = 0;
    try {
      const { billingCycleService } = await import('./billing-cycle.service.js');
      const { toBangkokDateString, getAdjacentCycleCode } = await import('../utils/calendar-date.util.js');

      const activeDorms = await prisma.dormitory.findMany({
        where: { status: 'active' },
        select: { id: true },
      });

      for (const dorm of activeDorms) {
        try {
          await billingCycleService.ensureRollingBillingCycles(dorm.id);
        } catch (err: any) {
          // continue for other dorms
        }
      }

      const bkkDateStr = toBangkokDateString(asOfDate);
      const currentCalCycle = bkkDateStr.slice(0, 7);
      const nextCalCycle = getAdjacentCycleCode(currentCalCycle, 1);

      const cycles = await prisma.billingCycle.findMany({
        where: {
          dormitoryId: { in: activeDorms.map((d) => d.id) },
          status: { notIn: ['completed', 'locked'] },
          cycleCode: { gte: currentCalCycle, lte: nextCalCycle },
        },
        select: { id: true, dormitoryId: true, cycleCode: true },
        orderBy: { periodStart: 'asc' },
      });

      for (const cycle of cycles) {
        try {
          const res = await this.generateRecurringRentBills(cycle.dormitoryId, cycle.id);
          totalGenerated += res.generatedCount;
        } catch (err: any) {
          // Continue reconciling next cycles
        }
      }
    } catch (err: any) {
      console.error('[BillingService] reconcileRecurringRentBillsForAllDormitories error', err);
    }
    return totalGenerated;
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

    if (['paid', 'cancelled', 'void', 'voided'].includes(bill.status)) {
      const err = new Error('BILL_CANNOT_BE_CANCELLED');
      (err as any).statusCode = 400;
      (err as any).code = 'BILL_CANNOT_BE_CANCELLED';
      (err as any).message = bill.status === 'paid'
        ? 'ไม่สามารถยกเลิกบิลที่ชำระแล้วได้ ต้องใช้กระบวนการปรับปรุงยอด (Adjustment/Refund)'
        : 'บิลนี้ถูกยกเลิกแล้ว';
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

  public async resolveBillDirectRecalculationEligibilityInTx(
    dormitoryId: string,
    billId: string,
    tx?: any
  ): Promise<BillRecalculationEligibilityResult> {
    return resolveBillDirectRecalculationEligibilityInTx(dormitoryId, billId, tx);
  }

  /**
   * Authoritative dynamic parking synchronization for completely open/unpaid Monthly Utility Bills.
   * Product Owner Decisions:
   * 1. Mutable parking requires BOTH:
   *    - paidAmount === 0 (no payments received)
   *    - canonical direct-recalculation eligibility = eligible (no submitted slips, payments under review, allocations, or receipts)
   * 2. Price and mode are governed strictly by the bill's cycle BillingRateSnapshot.
   * 3. Vehicle quantity dynamically reflects current active TenantVehicle records.
   * 4. BillItem synchronization is idempotent using canonical item type ('parking') or code ('PARKING'),
   *    preserving all other line items (rent, water, electricity, common, internet, custom).
   * 5. Recomputes bill subtotal, fine, total, outstanding using canonical decimal math.
   */
  public async syncOpenUnpaidMonthlyBillParkingInTx(
    dormitoryId: string,
    tenantId: string,
    tx?: any
  ): Promise<void> {
    const prisma = tx || getPrismaClient();

    // Find candidate rooms for this tenant
    const activeContracts = await prisma.contract.findMany({
      where: { tenantId, dormitoryId, deletedAt: null },
      select: { roomId: true },
    });
    const activeProvs = prisma.provisionalRentalTerm
      ? await prisma.provisionalRentalTerm.findMany({
          where: { tenantId, dormitoryId, deletedAt: null },
          select: { roomId: true },
        })
      : [];
    const roomIds = Array.from(
      new Set([
        ...activeContracts.map((c: any) => c.roomId),
        ...activeProvs.map((p: any) => p.roomId),
      ])
    );

    // Query open Monthly Utility bills for this tenant/room
    const candidateBills = await prisma.bill.findMany({
      where: {
        dormitoryId,
        billKind: 'MONTHLY_UTILITY',
        status: { in: ['UNPAID', 'ISSUED', 'OVERDUE', 'DRAFT', 'PUBLISHED'] },
        OR: [
          { tenantId },
          ...(roomIds.length > 0 ? [{ roomId: { in: roomIds } }] : []),
        ],
      },
      include: {
        items: true,
      },
    });

    if (!candidateBills || candidateBills.length === 0) {
      return;
    }

    // Query current active vehicles for this tenant
    const rawVehicles = await prisma.tenantVehicle.findMany({
      where: {
        dormitoryId,
        tenantId,
        deletedAt: null,
      },
    });
    const currentActiveCount = resolveCurrentActiveVehicleCount(rawVehicles);

    for (const bill of candidateBills) {
      // 1. Strict Payment Freeze Boundary: paidAmount must be strictly 0
      const paidNum = Number(bill.paidAmount || 0);
      if (paidNum > 0) {
        continue; // FROZEN — money already received
      }

      // 2. Strict Financial Evidence Guard: must be eligible for direct recalculation
      const eligibility = await resolveBillDirectRecalculationEligibilityInTx(dormitoryId, bill.id, tx);
      if (!eligibility.eligible) {
        continue; // FROZEN — pending slips, payment under review, allocations, etc.
      }

      // 3. Billing Rate Snapshot Authority: read rate and mode from snapshot
      const rateSnapshot = await this.billingCycleRepo.findRateSnapshot(bill.billingCycleId, dormitoryId);
      if (!rateSnapshot) {
        continue;
      }

      const rawParkingMode = (rateSnapshot as any).parkingFeeMode || 'room';
      // Only per_vehicle mode dynamically reacts to vehicle count changes
      if (rawParkingMode !== 'vehicle' && rawParkingMode !== 'per_vehicle') {
        continue;
      }

      const parkingRate = toDecimal((rateSnapshot as any).parkingFee ?? '0.00');
      const vQtyDec = toDecimal(currentActiveCount.toString());
      const newParkingAmountDec = mulDecimals(vQtyDec, parkingRate);

      // 4. Idempotent BillItem synchronization using canonical type/code
      await prisma.billItem.deleteMany({
        where: {
          billId: bill.id,
          dormitoryId,
          OR: [
            { type: 'parking' },
            { code: 'PARKING' },
          ],
        },
      });

      if (currentActiveCount > 0 && !isZeroDecimal(parkingRate)) {
        await prisma.billItem.create({
          data: {
            dormitoryId,
            billId: bill.id,
            type: 'parking',
            code: 'PARKING',
            description: `ค่าที่จอดรถ (${currentActiveCount} คัน)`,
            quantity: formatDecimal(vQtyDec),
            unit: 'vehicle',
            unitPrice: formatDecimal(parkingRate),
            amount: formatDecimal(newParkingAmountDec),
            metadata: {
              mode: 'vehicle',
              vehicleCount: currentActiveCount,
              rateSnapshotId: rateSnapshot.id,
            },
            displayOrder: 5,
          },
        });
      }

      // 5. Recompute bill totals via existing billing authority math
      const allCurrentItems = await prisma.billItem.findMany({
        where: { billId: bill.id, dormitoryId },
      });

      let subtotalDec = toDecimal('0.00');
      let fineDec = toDecimal('0.00');
      for (const item of allCurrentItems) {
        if (item.type === 'late_fee' || item.type === 'fine') {
          fineDec = addDecimals(fineDec, item.amount);
        } else {
          subtotalDec = addDecimals(subtotalDec, item.amount);
        }
      }
      const discountDec = toDecimal(bill.discountAmount || '0.00');
      const rawTotal = subDecimals(addDecimals(subtotalDec, fineDec), discountDec);
      const totalDec = compareDecimals(rawTotal, '0.00') < 0 ? toDecimal('0.00') : rawTotal;
      const paidDec = toDecimal('0.00');
      const outstandingDec = totalDec;

      await prisma.bill.update({
        where: { id: bill.id },
        data: {
          subtotal: formatDecimal(subtotalDec),
          fineAmount: formatDecimal(fineDec),
          totalAmount: formatDecimal(totalDec),
          paidAmount: formatDecimal(paidDec),
          outstandingAmount: formatDecimal(outstandingDec),
          version: { increment: 1 },
        },
      });

      if (this.auditService) {
        await this.auditService.log({
          dormitoryId,
          actorUserId: 'system',
          action: 'VEHICLE_MUTATION_PARKING_SYNC',
          resourceType: 'bill',
          resourceId: bill.id,
          details: {
            tenantId,
            vehicleCount: currentActiveCount,
            newParkingAmount: formatDecimal(newParkingAmountDec),
            newTotal: formatDecimal(totalDec),
          },
        });
      }
    }
  }

  public async sendManualBillLineNotifications(input: {
    dormitoryId: string;
    cycleId?: string;
    tenantIds: string[];
    billIds?: string[];
    actor?: any;
  }): Promise<{
    success: boolean;
    sentCount: number;
    failedCount: number;
    unboundCount: number;
    warning?: string;
    results: Array<{
      tenantId: string;
      roomNumber?: string;
      billCount?: number;
      status: 'SENT' | 'NO_LINE_BINDING' | 'QUOTA_EXHAUSTED' | 'NOT_FOUND' | 'ERROR';
      message?: string;
    }>;
  }> {
    const { dormitoryId, cycleId, tenantIds, billIds } = input;
    const db = getPrismaClient();

    // 1. Fetch dormitory name once (Rule 57: no query inside loop)
    const dorm = await db.dormitory.findUnique({
      where: { id: dormitoryId },
      select: { name: true },
    });
    const dormitoryName = dorm?.name || 'หอพัก';

    // 2. Fetch all matching unpaid bills with room details in ONE single query (Rule 57: no query inside loop)
    const billsWhere: any = {
      dormitoryId,
      tenantId: { in: tenantIds },
      status: { notIn: ['paid', 'cancelled'] },
    };
    const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    if (billIds && billIds.length > 0) {
      billsWhere.id = { in: billIds };
    } else if (cycleId) {
      if (UUID_REGEX.test(cycleId)) {
        billsWhere.billingCycleId = cycleId;
      } else {
        billsWhere.billingCycle = { cycleCode: cycleId.trim() };
      }
    }

    let unpaidBills = await db.bill.findMany({
      where: billsWhere,
      include: {
        room: { select: { id: true, roomNumber: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (unpaidBills.length === 0 && cycleId) {
      const fallbackWhere = { ...billsWhere };
      delete fallbackWhere.billingCycleId;
      delete fallbackWhere.billingCycle;
      unpaidBills = await db.bill.findMany({
        where: fallbackWhere,
        include: {
          room: { select: { id: true, roomNumber: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    // 3. Group bills by tenantId
    const billsByTenant = new Map<string, typeof unpaidBills>();
    for (const b of unpaidBills) {
      if (b.tenantId) {
        if (!billsByTenant.has(b.tenantId)) {
          billsByTenant.set(b.tenantId, []);
        }
        billsByTenant.get(b.tenantId)!.push(b);
      }
    }

    const { lineOaService, buildTenantInvoiceFlexMessage } = await import('./line-oa.service.js');

    let sentCount = 0;
    let failedCount = 0;
    let unboundCount = 0;
    let warning: string | undefined = undefined;
    const results: Array<{
      tenantId: string;
      roomNumber?: string;
      billCount?: number;
      status: 'SENT' | 'NO_LINE_BINDING' | 'QUOTA_EXHAUSTED' | 'NOT_FOUND' | 'ERROR';
      message?: string;
    }> = [];

    // 4. Iterate over requested tenantIds
    for (const tId of tenantIds) {
      const tenantBills = billsByTenant.get(tId);
      if (!tenantBills || tenantBills.length === 0) {
        results.push({
          tenantId: tId,
          status: 'NOT_FOUND',
          message: 'ไม่พบบิลค้างชำระสำหรับผู้เช่ารายนี้',
        });
        continue;
      }

      const roomNumber = tenantBills[0].room?.roomNumber || 'GEN';
      const combinedTotal = tenantBills.reduce(
        (sum, b) => sum + Number(b.outstandingAmount ?? b.totalAmount ?? 0),
        0
      );
      const dueDates = tenantBills
        .map((b) => (b.dueDate ? new Date(b.dueDate).getTime() : Infinity))
        .filter((t) => t !== Infinity);
      const effectiveDueDate = dueDates.length > 0 ? new Date(Math.min(...dueDates)) : null;

      const flexMessage = buildTenantInvoiceFlexMessage(
        dormitoryName,
        roomNumber,
        tenantBills.map((b) => ({
          billNumber: b.billNumber,
          billKind: b.billKind,
          totalAmount: Number(b.outstandingAmount ?? b.totalAmount ?? 0),
          dueDate: b.dueDate,
        })),
        combinedTotal,
        effectiveDueDate
      );

      try {
        const sendRes = await lineOaService.sendTenantLineNotification({
          dormitoryId,
          tenantId: tId,
          eventType: 'INVOICE',
          eventId: `manual-bill-reminder:${cycleId || 'manual'}:${tId}:${Date.now()}`,
          flexMessage,
        });

        if (sendRes.sent) {
          sentCount++;
          results.push({
            tenantId: tId,
            roomNumber,
            billCount: tenantBills.length,
            status: 'SENT',
            message: 'ส่งแจ้งเตือนผ่าน LINE สำเร็จ',
          });
        } else if (sendRes.reason === 'NO_LINE_BINDING') {
          unboundCount++;
          results.push({
            tenantId: tId,
            roomNumber,
            billCount: tenantBills.length,
            status: 'NO_LINE_BINDING',
            message: 'ผู้เช่ายังไม่ได้ผูก LINE',
          });
        } else if (sendRes.reason === 'QUOTA_EXHAUSTED' || sendRes.warningMessage) {
          failedCount++;
          warning = sendRes.warningMessage || 'จำนวนการส่งข้อความเดือนนี้หมดแล้ว';
          results.push({
            tenantId: tId,
            roomNumber,
            billCount: tenantBills.length,
            status: 'QUOTA_EXHAUSTED',
            message: warning,
          });
        } else {
          failedCount++;
          results.push({
            tenantId: tId,
            roomNumber,
            billCount: tenantBills.length,
            status: 'ERROR',
            message: sendRes.reason || 'ส่งไม่สำเร็จ',
          });
        }
      } catch (err: any) {
        failedCount++;
        results.push({
          tenantId: tId,
          roomNumber,
          billCount: tenantBills.length,
          status: 'ERROR',
          message: err?.message || 'เกิดข้อผิดพลาดในการส่งข้อความ',
        });
      }
    }

    return {
      success: true,
      sentCount,
      failedCount,
      unboundCount,
      warning,
      results,
    };
  }
}

export interface BillRecalculationEligibilityResult {
  eligible: boolean;
  code?: string;
  message?: string;
  bill?: any;
}

/**
 * Canonical Bill Recalculation Eligibility Guard (Owner Decisions 1A & 2A Authority).
 * Inspects full relational graph to guarantee that issued bills with any financial evidence
 * cannot be recalculated directly from meter workspace.
 */
export async function resolveBillDirectRecalculationEligibilityInTx(
  dormitoryId: string,
  billId: string,
  tx?: any
): Promise<BillRecalculationEligibilityResult> {
  const prisma = tx || getPrismaClient();

  const bill = await prisma.bill.findFirst({
    where: { id: billId, dormitoryId },
    include: {
      Payment: true,
      allocations: true,
      Receipt: true,
      paymentGroupBillTargets: {
        include: { paymentGroup: true },
      },
      paymentUploadIntents: true,
    },
  });

  if (!bill) {
    return {
      eligible: false,
      code: 'BILL_NOT_FOUND',
      message: 'ไม่พบบิลที่ต้องการคำนวณใหม่',
    };
  }

  if (bill.billKind !== 'MONTHLY_UTILITY') {
    return {
      eligible: false,
      code: 'INVALID_BILL_KIND_FOR_METER_SYNC',
      message: 'สามารถปรับยอดได้เฉพาะบิลค่าใช้จ่ายรายเดือน (MONTHLY_UTILITY) เท่านั้น',
      bill,
    };
  }

  const rawStatus = (bill.status || '').toUpperCase();
  if (['CANCELLED', 'VOID', 'VOIDED'].includes(rawStatus)) {
    return {
      eligible: false,
      code: 'BILL_CANCELLED',
      message: 'บิลนี้ถูกยกเลิกแล้ว ไม่สามารถแก้ไขได้',
      bill,
    };
  }

  // Financial Evidence Check
  const paidAmountNum = Number(bill.paidAmount || 0);
  const isPaidOrPartial = ['PAID', 'PARTIALLY_PAID', 'REFUNDED', 'REVERSED'].includes(rawStatus) || paidAmountNum > 0;

  const hasApprovedOrReviewPayment = (bill.Payment || []).some((p: any) => {
    const st = (p.status || '').toUpperCase();
    return ['APPROVED', 'VERIFIED', 'UNDER_REVIEW', 'PENDING'].includes(st);
  });

  const hasPaymentAllocations = (bill.allocations || []).some((a: any) => Number(a.allocatedAmount || 0) > 0);

  const hasApprovedOrReviewGroup = (bill.paymentGroupBillTargets || []).some((t: any) => {
    const st = (t.paymentGroup?.status || '').toUpperCase();
    return ['APPROVED', 'PARTIALLY_APPROVED', 'UNDER_REVIEW', 'PENDING'].includes(st);
  });

  const hasReceipts = (bill.Receipt || []).some((r: any) => {
    const st = (r.status || '').toUpperCase();
    return st !== 'CANCELLED' && st !== 'VOID';
  });

  const hasActiveUploadIntent = (bill.paymentUploadIntents || []).some((u: any) => {
    const st = (u.status || '').toUpperCase();
    return ['PENDING', 'SUBMITTED', 'UNDER_REVIEW'].includes(st);
  });

  if (
    isPaidOrPartial ||
    hasApprovedOrReviewPayment ||
    hasPaymentAllocations ||
    hasApprovedOrReviewGroup ||
    hasReceipts ||
    hasActiveUploadIntent
  ) {
    return {
      eligible: false,
      code: 'BILL_HAS_FINANCIAL_EVIDENCE',
      message: 'บิลนี้มีรายการชำระเงินหรือสลิปที่เกี่ยวข้องแล้ว\nไม่สามารถแก้ยอดโดยตรงได้',
      bill,
    };
  }

  // Allowed editable statuses: UNPAID, ISSUED, OVERDUE, DRAFT, PUBLISHED
  if (!['UNPAID', 'ISSUED', 'OVERDUE', 'DRAFT', 'PUBLISHED'].includes(rawStatus)) {
    return {
      eligible: false,
      code: 'BILL_STATUS_NOT_ELIGIBLE',
      message: 'สถานะของบิลไม่อนุญาตให้แก้ไขยอดโดยตรง',
      bill,
    };
  }

  return {
    eligible: true,
    bill,
  };
}

const defaultPrisma = getPrismaClient();
export const billingService = new BillingService(
  new PrismaBillRepository(defaultPrisma),
  new PrismaBillingCycleRepository(defaultPrisma),
  new PrismaMeterRepository(defaultPrisma),
  new PrismaContractRepository(defaultPrisma),
  new PrismaRoomRepository(defaultPrisma),
  new PrismaTenantRepository(defaultPrisma)
);
