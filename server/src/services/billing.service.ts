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
import { toDecimal, addDecimals, mulDecimals, divDecimals, formatDecimal, subDecimals, compareDecimals, isZeroDecimal } from '../utils/decimal-math.util.js';
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

  public async generateBillPreview(
    dormitoryId: string,
    billingCycleId: string,
    roomId: string
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

    const waterMode = (rateSnapshot as any).waterBillingType || 'per_unit';
    const elecMode = (rateSnapshot as any).electricityBillingType || 'per_unit';
    const commonMode = (rateSnapshot as any).commonFeeMode || 'room';
    const internetMode = (rateSnapshot as any).internetFeeMode || 'room';
    const parkingMode = (rateSnapshot as any).parkingFeeMode || 'room';

    // 1. Resolve Contract (Priority 1) or ACTIVE ProvisionalRentalTerm (Priority 2)
    const activeContracts = await this.contractRepo.findActiveContractsForRoom(dormitoryId, roomId);
    let contract = activeContracts.length > 0 ? activeContracts[0] : null;
    let provisionalTerm: any = null;

    const prisma = getPrismaClient();

    if (!contract) {
      provisionalTerm = await prisma.provisionalRentalTerm.findFirst({
        where: {
          dormitoryId,
          roomId,
          status: 'ACTIVE',
          deletedAt: null,
        },
      });

      if (!provisionalTerm) {
        const err = new Error('NO_ACTIVE_CONTRACT_OR_PROVISIONAL_TERM');
        (err as any).statusCode = 404;
        (err as any).code = 'NO_ACTIVE_CONTRACT_OR_PROVISIONAL_TERM';
        (err as any).message = 'ห้องพักไม่มีสัญญาหรือข้อตกลงเช่าที่พร้อมออกบิลสำหรับงวดนี้';
        throw err;
      }

      // Check date overlap with cycle
      const cycleStart = new Date(cycle.periodStart);
      const cycleEnd = new Date(cycle.periodEnd);
      const termStart = new Date(provisionalTerm.startDate);
      const termEnd = new Date(provisionalTerm.endDate);

      if (termStart > cycleEnd || termEnd < cycleStart) {
        const err = new Error('PROVISIONAL_TERM_NOT_ELIGIBLE_FOR_CYCLE');
        (err as any).statusCode = 400;
        (err as any).code = 'PROVISIONAL_TERM_NOT_ELIGIBLE_FOR_CYCLE';
        (err as any).message = 'ข้อตกลงเช่าชั่วคราวไม่อยู่ในช่วงเวลาของรอบบิลนี้';
        throw err;
      }
    }

    const tenantId = contract ? contract.tenantId : provisionalTerm.tenantId;

    // Authoritative billing-cycle peopleCount snapshot resolution
    const peopleCount = await billingOrchestrationService.resolveCyclePeopleCount(
      dormitoryId,
      billingCycleId,
      roomId,
      tenantId
    );
    const peopleCountDec = toDecimal(peopleCount.toString());

    // Find meter readings
    const waterReading = await this.meterRepo.findReadingByCycleRoomAndType(
      dormitoryId,
      billingCycleId,
      roomId,
      'water'
    );
    const elecReading = await this.meterRepo.findReadingByCycleRoomAndType(
      dormitoryId,
      billingCycleId,
      roomId,
      'electricity'
    );

    if (waterMode === 'per_unit' && !waterReading) {
      const err = new Error('MISSING_WATER_METER_READING');
      (err as any).statusCode = 400;
      (err as any).code = 'MISSING_METER_READING';
      (err as any).message = 'กรุณากรอกเลขมิเตอร์น้ำของงวดนี้ก่อนออกบิล';
      throw err;
    }

    if (elecMode === 'per_unit' && !elecReading) {
      const err = new Error('MISSING_ELECTRICITY_METER_READING');
      (err as any).statusCode = 400;
      (err as any).code = 'MISSING_METER_READING';
      (err as any).message = 'กรุณากรอกเลขมิเตอร์ไฟฟ้าของงวดนี้ก่อนออกบิล';
      throw err;
    }

    const waterUsage = toDecimal(waterReading?.usageUnits || '0.00');
    const elecUsage = toDecimal(elecReading?.usageUnits || '0.00');

    let waterQuantity = waterUsage;
    let waterAmount = mulDecimals(waterUsage, waterRate);
    let waterDesc = `ค่าน้ำประปา (${formatDecimal(waterUsage)} หน่วย)`;
    let waterUnit = 'unit';

    if (waterMode === 'per_person' || waterMode === 'person') {
      waterQuantity = peopleCountDec;
      waterAmount = mulDecimals(peopleCountDec, waterRate);
      waterDesc = `ค่าน้ำประปา (${peopleCount} คน)`;
      waterUnit = 'person';
    } else if (waterMode === 'flat_rate' || waterMode === 'per_room' || waterMode === 'room') {
      waterQuantity = toDecimal('1.00');
      waterAmount = waterRate;
      waterDesc = `ค่าน้ำประปา (เหมาจ่าย)`;
      waterUnit = 'room';
    }

    let elecQuantity = elecUsage;
    let elecAmount = mulDecimals(elecUsage, elecRate);
    let elecDesc = `ค่าไฟฟ้า (${formatDecimal(elecUsage)} หน่วย)`;
    let elecUnit = 'unit';

    if (elecMode === 'per_person' || elecMode === 'person') {
      elecQuantity = peopleCountDec;
      elecAmount = mulDecimals(peopleCountDec, elecRate);
      elecDesc = `ค่าไฟฟ้า (${peopleCount} คน)`;
      elecUnit = 'person';
    } else if (elecMode === 'flat_rate' || elecMode === 'per_room' || elecMode === 'room') {
      elecQuantity = toDecimal('1.00');
      elecAmount = elecRate;
      elecDesc = `ค่าไฟฟ้า (เหมาจ่าย)`;
      elecUnit = 'room';
    }

    // Resolve Rent Item
    let rentItem: { type: string; description: string; quantity: string; unit?: string; unitPrice: string; amount: string; metadata?: any } | null = null;

    if (contract) {
      const contractSnapshot = await prisma.contractSnapshot.findUnique({
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
          rentItem = {
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
          };
        } else {
          rentItem = null;
        }
      } else {
        rentItem = {
          type: 'rent',
          description: 'ค่าเช่าห้องพัก',
          quantity: '1.00',
          unit: 'month',
          unitPrice: formatDecimal(rentAmount),
          amount: formatDecimal(rentAmount),
        };
      }
    } else if (provisionalTerm) {
      if (provisionalTerm.rentalType === 'MONTHLY') {
        const unitRent = toDecimal(provisionalTerm.unitRentAmount.toString());
        rentItem = {
          type: 'rent',
          description: 'ค่าเช่าห้องพัก',
          quantity: '1.00',
          unit: 'month',
          unitPrice: formatDecimal(unitRent),
          amount: formatDecimal(unitRent),
        };
      } else {
        // TERM
        const totalRent = toDecimal(provisionalTerm.totalRentAmount.toString());
        const installments = provisionalTerm.termInstallmentCount || 1;
        const termStart = new Date(provisionalTerm.startDate);
        const cycleStart = new Date(cycle.periodStart);
        const cycleOffset = (cycleStart.getFullYear() - termStart.getFullYear()) * 12 + (cycleStart.getMonth() - termStart.getMonth());

        if (cycleOffset >= 0 && cycleOffset < installments) {
          const installmentBase = divDecimals(totalRent, installments.toString());
          const isLast = cycleOffset === installments - 1;
          const priorSum = mulDecimals(installmentBase, (installments - 1).toString());
          const installmentAmt = isLast ? subDecimals(totalRent, priorSum) : installmentBase;
          rentItem = {
            type: 'rent',
            description: `ค่าเช่าห้องพัก (งวดที่ ${cycleOffset + 1}/${installments})`,
            quantity: '1.00',
            unit: 'installment',
            unitPrice: formatDecimal(installmentAmt),
            amount: formatDecimal(installmentAmt),
          };
        } else {
          rentItem = null;
        }
      }
    }

    const items: Array<{ type: string; description: string; quantity: string; unit?: string; unitPrice: string; amount: string; metadata?: any }> = [];
    if (rentItem) {
      items.push(rentItem);
    }

    if (!isZeroDecimal(waterAmount) || !isZeroDecimal(waterRate)) {
      items.push({
        type: 'water',
        description: waterDesc,
        quantity: formatDecimal(waterQuantity),
        unit: waterUnit,
        unitPrice: formatDecimal(waterRate),
        amount: formatDecimal(waterAmount),
        metadata: waterUnit === 'person' ? { mode: 'person', peopleCount } : undefined,
      });
    }

    if (!isZeroDecimal(elecAmount) || !isZeroDecimal(elecRate)) {
      items.push({
        type: 'electricity',
        description: elecDesc,
        quantity: formatDecimal(elecQuantity),
        unit: elecUnit,
        unitPrice: formatDecimal(elecRate),
        amount: formatDecimal(elecAmount),
        metadata: elecUnit === 'person' ? { mode: 'person', peopleCount } : undefined,
      });
    }

    if (!isZeroDecimal(commonFee) && commonMode !== 'none' && commonMode !== 'free') {
      const isPerPerson = commonMode === 'person' || commonMode === 'per_person';
      const q = isPerPerson ? peopleCountDec : toDecimal('1.00');
      const amt = isPerPerson ? mulDecimals(peopleCountDec, commonFee) : commonFee;
      items.push({
        type: 'common_fee',
        description: isPerPerson ? `ค่าส่วนกลาง (${peopleCount} คน)` : 'ค่าส่วนกลาง',
        quantity: formatDecimal(q),
        unit: isPerPerson ? 'person' : 'room',
        unitPrice: formatDecimal(commonFee),
        amount: formatDecimal(amt),
        metadata: isPerPerson ? { mode: 'person', peopleCount } : undefined,
      });
    }

    if (!isZeroDecimal(internetFee) && internetMode !== 'none' && internetMode !== 'free') {
      const isPerPerson = internetMode === 'person' || internetMode === 'per_person';
      const q = isPerPerson ? peopleCountDec : toDecimal('1.00');
      const amt = isPerPerson ? mulDecimals(peopleCountDec, internetFee) : internetFee;
      items.push({
        type: 'internet',
        description: isPerPerson ? `ค่าบริการอินเทอร์เน็ต (${peopleCount} คน)` : 'ค่าบริการอินเทอร์เน็ต',
        quantity: formatDecimal(q),
        unit: isPerPerson ? 'person' : 'room',
        unitPrice: formatDecimal(internetFee),
        amount: formatDecimal(amt),
        metadata: isPerPerson ? { mode: 'person', peopleCount } : undefined,
      });
    }

    if (!isZeroDecimal(parkingFee) && parkingMode !== 'free' && parkingMode !== 'none') {
      const isPerPerson = parkingMode === 'person' || parkingMode === 'per_person';
      const isPerVehicle = parkingMode === 'vehicle' || parkingMode === 'per_vehicle';

      let q = toDecimal('1.00');
      let amt = parkingFee;
      let unit = 'room';
      let desc = 'ค่าที่จอดรถ';
      let meta: any = undefined;

      if (isPerPerson) {
        q = peopleCountDec;
        amt = mulDecimals(peopleCountDec, parkingFee);
        unit = 'person';
        desc = `ค่าที่จอดรถ (${peopleCount} คน)`;
        meta = { mode: 'person', peopleCount };
      } else if (isPerVehicle) {
        const vehicles = await this.tenantRepo.findVehicles(tenantId, dormitoryId);
        const vehicleCount = vehicles.length;
        const vehicleCountDec = toDecimal(vehicleCount.toString());
        q = vehicleCountDec;
        amt = mulDecimals(vehicleCountDec, parkingFee);
        unit = 'vehicle';
        desc = `ค่าที่จอดรถ (${vehicleCount} คัน)`;
        meta = { mode: 'vehicle', vehicleCount };
      }

      if (!isZeroDecimal(amt) || !isZeroDecimal(parkingFee)) {
        items.push({
          type: 'parking',
          description: desc,
          quantity: formatDecimal(q),
          unit,
          unitPrice: formatDecimal(parkingFee),
          amount: formatDecimal(amt),
          metadata: meta,
        });
      }
    }

    // Query RoomBillingCycleSnapshot for manual outstanding and other fees
    const cycleSnapshot = await prisma.roomBillingCycleSnapshot.findUnique({
      where: {
        dormitory_billing_cycle_room_unique: {
          dormitoryId,
          billingCycleId,
          roomId,
        },
      },
    });

    let manualOutstandingStr = '0.00';
    let otherFeesList: Array<{ description: string; amount: string }> = [];

    if (cycleSnapshot) {
      if (cycleSnapshot.manualOutstandingAmount) {
        const outAmt = toDecimal(cycleSnapshot.manualOutstandingAmount.toString());
        manualOutstandingStr = formatDecimal(outAmt);
        if (!isZeroDecimal(outAmt)) {
          items.push({
            type: 'manual_outstanding',
            description: 'ค้างชำระ',
            quantity: '1.00',
            unit: 'charge',
            unitPrice: formatDecimal(outAmt),
            amount: formatDecimal(outAmt),
          });
        }
      }
      if (cycleSnapshot.otherFees && Array.isArray(cycleSnapshot.otherFees)) {
        for (const fee of cycleSnapshot.otherFees as any[]) {
          if (fee && fee.description && fee.amount !== undefined) {
            const feeAmt = toDecimal(String(fee.amount));
            if (!isZeroDecimal(feeAmt)) {
              const feeDesc = String(fee.description).trim();
              const feeFormatted = formatDecimal(feeAmt);
              otherFeesList.push({ description: feeDesc, amount: feeFormatted });
              items.push({
                type: 'other',
                description: feeDesc,
                quantity: '1.00',
                unit: 'item',
                unitPrice: feeFormatted,
                amount: feeFormatted,
              });
            }
          }
        }
      }
    }

    let subtotal = toDecimal('0.00');
    for (const item of items) {
      subtotal = addDecimals(subtotal, item.amount);
    }

    return {
      contractId: contract?.id || null,
      provisionalRentalTermId: provisionalTerm?.id || null,
      roomId,
      tenantId,
      rentAmount: rentItem ? rentItem.amount : '0.00',
      waterUsage: formatDecimal(waterUsage),
      waterRate: formatDecimal(waterRate),
      waterAmount: formatDecimal(waterAmount),
      electricityUsage: formatDecimal(elecUsage),
      electricityRate: formatDecimal(elecRate),
      electricityAmount: formatDecimal(elecAmount),
      commonFee: formatDecimal(commonFee),
      internetFee: formatDecimal(internetFee),
      parkingFee: formatDecimal(parkingFee),
      manualOutstandingAmount: manualOutstandingStr,
      otherFees: otherFeesList,
      peopleCount,
      subtotal: formatDecimal(subtotal),
      discountAmount: '0.00',
      totalAmount: formatDecimal(subtotal),
      items,
    };
  }

  public async generateBill(
    dormitoryId: string,
    data: GenerateBillDto,
    userId?: string,
    issuanceTimestamp?: Date
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

    const prisma = getPrismaClient();
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
      provisionalTerm = await prisma.provisionalRentalTerm.findFirst({
        where: {
          dormitoryId,
          roomId: data.roomId,
          status: 'ACTIVE',
          deletedAt: null,
        },
      });

      if (!provisionalTerm) {
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

    // Check existing non-cancelled current bill for this room & cycle
    const existingBillBefore = await this.billRepo.findByCycleAndRoom(
      dormitoryId,
      data.billingCycleId,
      data.roomId
    );
    if (existingBillBefore) {
      const items = await this.billRepo.getBillItems(existingBillBefore.id, dormitoryId);
      return { bill: existingBillBefore, items, created: false };
    }

    const preview = await this.generateBillPreview(dormitoryId, data.billingCycleId, data.roomId);
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

    const issuanceNow = issuanceTimestamp || new Date();
    const billingDate = resolveBillIssueDate(issuanceNow);
    const dueDate = resolveBillDueDate(issuanceNow, settings.dueDay);

    return this.billRepo.withTransaction(async (tx) => {
      await this.billRepo.executeRawLock(data.roomId, tx);

      const existingBill = await this.billRepo.findByCycleAndRoom(
        dormitoryId,
        data.billingCycleId,
        data.roomId,
        tx
      );
      if (existingBill) {
        const items = await this.billRepo.getBillItems(existingBill.id, dormitoryId, tx);
        return { bill: existingBill, items, created: false };
      }

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
    });
  }

  public async bulkGenerateBills(
    dormitoryId: string,
    billingCycleId: string,
    roomIds?: string[],
    userId?: string
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
      const roomRes = await this.roomRepo.findAll(dormitoryId);
      targetRooms = roomRes.items.map((r) => r.id);
    }

    const generatedBills: BillEntity[] = [];
    const generated: Array<{ roomId: string; billId: string; billNumber: string }> = [];
    const excluded: Array<{ roomId: string; reason: string }> = [];
    const failed: Array<{ roomId: string; error: string; code: string }> = [];

    for (const roomId of targetRooms) {
      const activeContracts = await this.contractRepo.findActiveContractsForRoom(dormitoryId, roomId);
      let contract = activeContracts.length > 0 ? activeContracts[0] : null;
      let provisionalTerm: any = null;

      if (!contract) {
        provisionalTerm = await prisma.provisionalRentalTerm.findFirst({
          where: {
            dormitoryId,
            roomId,
            status: 'ACTIVE',
            deletedAt: null,
          },
        });
      }

      if (!contract && !provisionalTerm) {
        excluded.push({ roomId, reason: 'NO_ACTIVE_CONTRACT_OR_PROVISIONAL_TERM' });
        continue;
      }

      const existing = await this.billRepo.findByCycleAndRoom(dormitoryId, billingCycleId, roomId);
      if (existing) {
        excluded.push({ roomId, reason: 'BILL_ALREADY_EXISTS' });
        continue;
      }

      try {
        const { bill } = await this.generateBill(
          dormitoryId,
          {
            billingCycleId,
            roomId,
          },
          userId,
          issuanceNow
        );
        generatedBills.push(bill);
        generated.push({ roomId, billId: bill.id, billNumber: bill.billNumber });
      } catch (err: any) {
        if (err.code === 'MISSING_METER_READING' || err.code === 'NO_ACTIVE_CONTRACT_OR_PROVISIONAL_TERM' || err.code === 'PROVISIONAL_TERM_NOT_ELIGIBLE_FOR_CYCLE') {
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
