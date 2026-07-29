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
    const waterRate = Number(rateSnapshot?.waterRate || '18.00');
    const elecRate = Number(rateSnapshot?.electricityRate || '7.00');
    const commonFee = Number(rateSnapshot?.commonFee || '0.00');
    const internetFee = Number(rateSnapshot?.internetFee || '0.00');

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

    const waterUsage = Number(waterReading?.usageUnits || '0.00');
    const elecUsage = Number(elecReading?.usageUnits || '0.00');

    const waterAmount = (waterUsage * waterRate).toFixed(2);
    const elecAmount = (elecUsage * elecRate).toFixed(2);
    const rentAmount = Number(contract.rentAmount).toFixed(2);

    const items: Array<{ type: string; description: string; quantity: string; unitPrice: string; amount: string }> = [
      {
        type: 'rent',
        description: 'ค่าเช่าห้องพัก',
        quantity: '1.00',
        unitPrice: rentAmount,
        amount: rentAmount,
      },
    ];

    if (waterUsage > 0 || waterRate > 0) {
      items.push({
        type: 'water',
        description: `ค่าน้ำประปา (${waterUsage} หน่วย)`,
        quantity: waterUsage.toFixed(2),
        unitPrice: waterRate.toFixed(2),
        amount: waterAmount,
      });
    }

    if (elecUsage > 0 || elecRate > 0) {
      items.push({
        type: 'electricity',
        description: `ค่าไฟฟ้า (${elecUsage} หน่วย)`,
        quantity: elecUsage.toFixed(2),
        unitPrice: elecRate.toFixed(2),
        amount: elecAmount,
      });
    }

    if (commonFee > 0) {
      items.push({
        type: 'common_fee',
        description: 'ค่าส่วนกลาง',
        quantity: '1.00',
        unitPrice: commonFee.toFixed(2),
        amount: commonFee.toFixed(2),
      });
    }

    if (internetFee > 0) {
      items.push({
        type: 'internet',
        description: 'ค่าบริการอินเทอร์เน็ต',
        quantity: '1.00',
        unitPrice: internetFee.toFixed(2),
        amount: internetFee.toFixed(2),
      });
    }

    let subtotal = 0;
    for (const item of items) {
      subtotal += Number(item.amount);
    }

    return {
      contractId: contract.id,
      roomId,
      tenantId: contract.tenantId,
      rentAmount,
      waterUsage: waterUsage.toFixed(2),
      waterRate: waterRate.toFixed(2),
      waterAmount,
      electricityUsage: elecUsage.toFixed(2),
      electricityRate: elecRate.toFixed(2),
      electricityAmount: elecAmount,
      commonFee: commonFee.toFixed(2),
      internetFee: internetFee.toFixed(2),
      subtotal: subtotal.toFixed(2),
      discountAmount: '0.00',
      totalAmount: subtotal.toFixed(2),
      items,
    };
  }

  public async generateBill(
    dormitoryId: string,
    data: GenerateBillDto,
    userId?: string
  ): Promise<{ bill: BillEntity; items: BillItemEntity[] }> {
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

    const existingBill = await this.billRepo.findByCycleAndContract(
      dormitoryId,
      data.billingCycleId,
      data.contractId
    );
    if (existingBill) {
      const err = new Error('BILL_ALREADY_EXISTS_FOR_CONTRACT');
      (err as any).statusCode = 409;
      (err as any).code = 'BILL_ALREADY_EXISTS_FOR_CONTRACT';
      throw err;
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

    let subtotalNum = 0;
    for (const item of billItems) {
      subtotalNum += Number(item.amount);
    }

    const discountNum = Number(data.discountAmount || '0.00');
    const totalNum = Math.max(0, subtotalNum - discountNum);

    const billingDate = data.billingDate ? new Date(data.billingDate) : new Date(cycle.billingDate);
    const dueDate = data.dueDate ? new Date(data.dueDate) : new Date(cycle.dueDate);

    const countRes = await this.billRepo.findAll(dormitoryId, { billingCycleId: data.billingCycleId });
    const billSeq = (countRes.total + 1).toString().padStart(4, '0');
    const billNumber = `INV-${cycle.cycleCode}-${billSeq}`;

    const { bill, items } = await this.billRepo.create(
      dormitoryId,
      {
        billingCycleId: data.billingCycleId,
        contractId: data.contractId,
        roomId: data.roomId,
        tenantId: data.tenantId,
        billNumber,
        status: 'unpaid',
        billingDate,
        dueDate,
        subtotal: subtotalNum.toFixed(2),
        discountAmount: discountNum.toFixed(2),
        totalAmount: totalNum.toFixed(2),
        outstandingAmount: totalNum.toFixed(2),
        rateSnapshotId: rateSnapshot?.id,
        generatedByUserId: userId,
      },
      billItems
    );

    if (this.auditService) {
      await this.auditService.log({
        dormitoryId,
        actorUserId: userId || 'system',
        action: 'bill.generate',
        resourceType: 'bill',
        resourceId: bill.id,
        payload: { billNumber, totalAmount: bill.totalAmount },
      });
    }

    return { bill, items };
  }

  public async bulkGenerateBills(
    dormitoryId: string,
    billingCycleId: string,
    roomIds?: string[],
    userId?: string
  ): Promise<{ generatedCount: number; bills: BillEntity[] }> {
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

    for (const roomId of targetRooms) {
      try {
        const activeContracts = await this.contractRepo.findActiveContractsForRoom(dormitoryId, roomId);
        if (activeContracts.length === 0) continue;

        const contract = activeContracts[0];
        const existing = await this.billRepo.findByCycleAndContract(dormitoryId, billingCycleId, contract.id);
        if (existing) continue;

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
      } catch (err) {
        // Continue generation for remaining rooms
      }
    }

    // Update cycle status to generated
    if (cycle.status === 'draft') {
      await this.billingCycleRepo.update(billingCycleId, dormitoryId, {
        status: 'generated',
        generatedAt: new Date(),
      });
    }

    return { generatedCount: generatedBills.length, bills: generatedBills };
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
        payload: { reason },
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
