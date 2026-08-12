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
import { toDecimal, addDecimals, mulDecimals, formatDecimal, subDecimals, compareDecimals, isZeroDecimal } from '../utils/decimal-math.util.js';

export interface GenerateBillDto {
  billingCycleId: string;
  contractId: string;
  roomId: string;
  tenantId: string;
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
  contractId: string;
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
  subtotal: string;
  discountAmount: string;
  totalAmount: string;
  items: Array<{
    type: string;
    description: string;
    quantity: string;
    unitPrice: string;
    amount: string;
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

    // Find active contract for room
    const activeContracts = await this.contractRepo.findActiveContractsForRoom(dormitoryId, roomId);
    if (activeContracts.length === 0) {
      const err = new Error('NO_ACTIVE_CONTRACT_FOR_ROOM');
      (err as any).statusCode = 404;
      (err as any).code = 'NO_ACTIVE_CONTRACT_FOR_ROOM';
      throw err;
    }
    const contract = activeContracts[0];

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

    const waterUsage = toDecimal(waterReading?.usageUnits || '0.00');
    const elecUsage = toDecimal(elecReading?.usageUnits || '0.00');

    const waterAmount = mulDecimals(waterUsage, waterRate);
    const elecAmount = mulDecimals(elecUsage, elecRate);
    const rentAmount = toDecimal(contract.rentAmount);

    const items: Array<{ type: string; description: string; quantity: string; unitPrice: string; amount: string }> = [
      {
        type: 'rent',
        description: 'ค่าเช่าห้องพัก',
        quantity: '1.00',
        unitPrice: formatDecimal(rentAmount),
        amount: formatDecimal(rentAmount),
      },
    ];

    if (!isZeroDecimal(waterUsage) || !isZeroDecimal(waterRate)) {
      items.push({
        type: 'water',
        description: `ค่าน้ำประปา (${formatDecimal(waterUsage)} หน่วย)`,
        quantity: formatDecimal(waterUsage),
        unitPrice: formatDecimal(waterRate),
        amount: formatDecimal(waterAmount),
      });
    }

    if (!isZeroDecimal(elecUsage) || !isZeroDecimal(elecRate)) {
      items.push({
        type: 'electricity',
        description: `ค่าไฟฟ้า (${formatDecimal(elecUsage)} หน่วย)`,
        quantity: formatDecimal(elecUsage),
        unitPrice: formatDecimal(elecRate),
        amount: formatDecimal(elecAmount),
      });
    }

    if (!isZeroDecimal(commonFee)) {
      items.push({
        type: 'common_fee',
        description: 'ค่าส่วนกลาง',
        quantity: '1.00',
        unitPrice: formatDecimal(commonFee),
        amount: formatDecimal(commonFee),
      });
    }

    if (!isZeroDecimal(internetFee)) {
      items.push({
        type: 'internet',
        description: 'ค่าบริการอินเทอร์เน็ต',
        quantity: '1.00',
        unitPrice: formatDecimal(internetFee),
        amount: formatDecimal(internetFee),
      });
    }

    let subtotal = toDecimal('0.00');
    for (const item of items) {
      subtotal = addDecimals(subtotal, item.amount);
    }

    return {
      contractId: contract.id,
      roomId,
      tenantId: contract.tenantId,
      rentAmount: formatDecimal(rentAmount),
      waterUsage: formatDecimal(waterUsage),
      waterRate: formatDecimal(waterRate),
      waterAmount: formatDecimal(waterAmount),
      electricityUsage: formatDecimal(elecUsage),
      electricityRate: formatDecimal(elecRate),
      electricityAmount: formatDecimal(elecAmount),
      commonFee: formatDecimal(commonFee),
      internetFee: formatDecimal(internetFee),
      subtotal: formatDecimal(subtotal),
      discountAmount: '0.00',
      totalAmount: formatDecimal(subtotal),
      items,
    };
  }

  public async generateBill(
    dormitoryId: string,
    data: GenerateBillDto,
    userId?: string
  ): Promise<{ bill: BillEntity; items: BillItemEntity[]; created: boolean }> {
    return this.billRepo.withTransaction(async (tx) => {
      await this.billRepo.executeRawLock(data.roomId, tx);

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

      // Derive/validate active contract and tenant for room
      const activeContracts = await this.contractRepo.findActiveContractsForRoom(dormitoryId, data.roomId);
      if (activeContracts.length === 0) {
        const err = new Error('NO_ACTIVE_CONTRACT_FOR_ROOM');
        (err as any).statusCode = 404;
        (err as any).code = 'NO_ACTIVE_CONTRACT_FOR_ROOM';
        throw err;
      }
      const contract = activeContracts[0];

      if (data.contractId && data.contractId !== contract.id) {
        const err = new Error('CONTRACT_ROOM_MISMATCH');
        (err as any).statusCode = 400;
        (err as any).code = 'CONTRACT_ROOM_MISMATCH';
        (err as any).message = 'สัญญาที่ระบุไม่ตรงกับสัญญาของห้องพัก';
        throw err;
      }

      if (data.tenantId && data.tenantId !== contract.tenantId) {
        const err = new Error('TENANT_CONTRACT_MISMATCH');
        (err as any).statusCode = 400;
        (err as any).code = 'TENANT_CONTRACT_MISMATCH';
        (err as any).message = 'ผู้เช่าที่ระบุไม่ตรงกับผู้เช่าในสัญญา';
        throw err;
      }

      const effectiveContractId = contract.id;
      const effectiveTenantId = contract.tenantId;

      const existingBill = await this.billRepo.findByCycleAndContract(
        dormitoryId,
        data.billingCycleId,
        effectiveContractId,
        tx
      );
      if (existingBill) {
        const items = await this.billRepo.getBillItems(existingBill.id, dormitoryId, tx);
        return { bill: existingBill, items, created: false };
      }

      const preview = await this.generateBillPreview(dormitoryId, data.billingCycleId, data.roomId);
      const rateSnapshot = await this.billingCycleRepo.findRateSnapshot(data.billingCycleId, dormitoryId);

      const billItems: CreateBillItemData[] = preview.items.map((i, idx) => ({
        type: i.type,
        description: i.description,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        amount: i.amount,
        displayOrder: idx,
      }));

      if (data.customItems) {
        data.customItems.forEach((ci, idx) => {
          billItems.push({
            type: ci.type,
            description: ci.description,
            quantity: ci.quantity,
            unitPrice: ci.unitPrice,
            amount: ci.amount,
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

      const billingDate = data.billingDate ? new Date(data.billingDate) : new Date(cycle.billingDate);
      const dueDate = data.dueDate ? new Date(data.dueDate) : new Date(cycle.dueDate);

      const countRes = await this.billRepo.findAll(dormitoryId, { billingCycleId: data.billingCycleId });
      const billSeq = (countRes.total + 1).toString().padStart(4, '0');
      const billNumber = `INV-${cycle.cycleCode}-${billSeq}`;

      let createdData;
      try {
        createdData = await this.billRepo.create(
          dormitoryId,
          {
            billingCycleId: data.billingCycleId,
            contractId: effectiveContractId,
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
          },
          billItems,
          tx
        );
      } catch (err: any) {
        if (err.code === 'P2002') {
          const doubleCheckExisting = await this.billRepo.findByCycleAndContract(
            dormitoryId,
            data.billingCycleId,
            effectiveContractId,
            tx
          );
          if (doubleCheckExisting) {
            const items = await this.billRepo.getBillItems(doubleCheckExisting.id, dormitoryId, tx);
            return { bill: doubleCheckExisting, items, created: false };
          }
          const e = new Error('BILL_ALREADY_EXISTS_FOR_CONTRACT');
          (e as any).statusCode = 409;
          (e as any).code = 'BILL_ALREADY_EXISTS_FOR_CONTRACT';
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
          details: { billNumber, cycle: cycle.cycleCode },
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

    let targetRooms: string[] = [];
    if (roomIds && roomIds.length > 0) {
      targetRooms = roomIds;
    } else {
      const roomRes = await this.roomRepo.findAll(dormitoryId);
      targetRooms = roomRes.items.filter((r) => r.status === 'occupied').map((r) => r.id);
    }

    const generatedBills: BillEntity[] = [];
    const generated: Array<{ roomId: string; billId: string; billNumber: string }> = [];
    const excluded: Array<{ roomId: string; reason: string }> = [];
    const failed: Array<{ roomId: string; error: string; code: string }> = [];

    for (const roomId of targetRooms) {
      const activeContracts = await this.contractRepo.findActiveContractsForRoom(dormitoryId, roomId);
      if (activeContracts.length === 0) {
        excluded.push({ roomId, reason: 'NO_ACTIVE_CONTRACT' });
        continue;
      }

      const contract = activeContracts[0];
      const existing = await this.billRepo.findByCycleAndContract(dormitoryId, billingCycleId, contract.id);
      if (existing) {
        excluded.push({ roomId, reason: 'BILL_ALREADY_EXISTS' });
        continue;
      }

      try {
        const { bill } = await this.generateBill(
          dormitoryId,
          {
            billingCycleId,
            contractId: contract.id,
            roomId,
            tenantId: contract.tenantId,
          },
          userId
        );
        generatedBills.push(bill);
        generated.push({ roomId, billId: bill.id, billNumber: bill.billNumber });
      } catch (err: any) {
        if (err.code === 'MISSING_METER_READING' || err.code === 'NO_ACTIVE_CONTRACT_FOR_ROOM') {
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
        generatedAt: new Date(),
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
