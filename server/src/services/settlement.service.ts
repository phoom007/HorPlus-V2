import { getPrismaClient } from '../db/prisma.js';
import { logger } from '../config/logger.js';
import { AppError } from '../types/index.js';
import { Prisma } from '@prisma/client';
import { outboxService } from './outbox.service.js';

export interface AddDamageItemInput {
  dormitoryId: string;
  settlementId: string;
  description: string;
  amount: string | number;
  evidenceUrl?: string;
  actorUserId: string;
  actorRole: string;
}

export interface EditDamageItemInput {
  dormitoryId: string;
  itemId: string;
  description?: string;
  amount?: string | number;
  evidenceUrl?: string;
  actorUserId: string;
  actorRole: string;
}

export class SettlementService {
  /**
   * Get or Calculate Authoritative Contract Settlement
   * Net = Deposit - Unpaid Bills - Active Damage Charges
   * NO rent-proration credit is calculated!
   */
  public async getOrCreateSettlement(dormitoryId: string, contractId: string) {
    const prisma = getPrismaClient();

    const contract = await prisma.contract.findFirst({
      where: { id: contractId, dormitoryId, deletedAt: null },
      include: { room: true, tenant: true },
    });

    if (!contract) {
      throw new AppError('ไม่พบข้อมูลสัญญาเช่าที่ระบุ', 404, 'CONTRACT_NOT_FOUND');
    }

    let settlement = await prisma.contractSettlement.findFirst({
      where: { dormitoryId, contractId },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });

    if (!settlement) {
      // Calculate unpaid bills for contract / room
      const unpaidBills = await prisma.bill.findMany({
        where: {
          dormitoryId,
          contractId,
          status: { in: ['unpaid', 'overdue'] },
        },
      });

      const unpaidBillTotal = unpaidBills.reduce(
        (sum, b) => sum.add(new Prisma.Decimal(b.totalAmount || 0)),
        new Prisma.Decimal(0)
      );

      const deposit = new Prisma.Decimal(contract.depositAmount || 0);
      const damageTotal = new Prisma.Decimal(0);
      const net = deposit.sub(unpaidBillTotal).sub(damageTotal);

      let direction = 'ZERO';
      let status = 'CLOSED_ZERO';

      if (net.gt(0)) {
        direction = 'REFUND';
        status = 'PENDING_REFUND';
      } else if (net.lt(0)) {
        direction = 'PAYMENT_DUE';
        status = 'PENDING_PAYMENT';
      }

      settlement = await prisma.contractSettlement.create({
        data: {
          dormitoryId,
          tenantId: contract.tenantId,
          contractId: contract.id,
          roomId: contract.roomId,
          depositAmount: deposit,
          unpaidBillAmount: unpaidBillTotal,
          damageChargeTotal: damageTotal,
          netSettlement: net,
          settlementDirection: direction,
          settlementStatus: status,
        },
        include: { items: { orderBy: { createdAt: 'asc' } } },
      });
    } else {
      // If settlement is NOT locked, dynamically refresh unpaid bills and damage totals
      if (settlement.settlementStatus !== 'REFUNDED' && settlement.settlementStatus !== 'PAYMENT_RECEIVED') {
        const unpaidBills = await prisma.bill.findMany({
          where: {
            dormitoryId,
            contractId,
            status: { in: ['unpaid', 'overdue'] },
          },
        });

        const unpaidBillTotal = unpaidBills.reduce(
          (sum, b) => sum.add(new Prisma.Decimal(b.totalAmount || 0)),
          new Prisma.Decimal(0)
        );

        const damageTotal = settlement.items
          .filter((item) => !item.isDeleted)
          .reduce(
            (sum, item) => sum.add(new Prisma.Decimal(item.amount || 0)),
            new Prisma.Decimal(0)
          );

        const deposit = new Prisma.Decimal(contract.depositAmount || 0);
        const net = deposit.sub(unpaidBillTotal).sub(damageTotal);

        let direction = 'ZERO';
        let status = 'CLOSED_ZERO';

        if (net.gt(0)) {
          direction = 'REFUND';
          status = 'PENDING_REFUND';
        } else if (net.lt(0)) {
          direction = 'PAYMENT_DUE';
          status = 'PENDING_PAYMENT';
        }

        settlement = await prisma.contractSettlement.update({
          where: { id: settlement.id },
          data: {
            depositAmount: deposit,
            unpaidBillAmount: unpaidBillTotal,
            damageChargeTotal: damageTotal,
            netSettlement: net,
            settlementDirection: direction,
            settlementStatus: status,
          },
          include: { items: { orderBy: { createdAt: 'asc' } } },
        });
      }
    }

    return settlement;
  }

  /**
   * Add Damage / Charge Item
   */
  public async addDamageItem(input: AddDamageItemInput) {
    const { dormitoryId, settlementId, description, amount, evidenceUrl, actorUserId, actorRole } = input;

    if (actorRole !== 'OWNER' && actorRole !== 'MANAGER') {
      throw new AppError('เฉพาะเจ้าของหอพักหรือผู้จัดการเท่านั้นที่สามารถเพิ่มรายการค่าเสียหายได้', 403, 'FORBIDDEN');
    }

    if (!description || !description.trim()) {
      throw new AppError('กรุณาระบุรายละเอียด/สาเหตุของค่าเสียหาย', 400, 'DESCRIPTION_REQUIRED');
    }

    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      throw new AppError('จำนวนเงินค่าเสียหายต้องมากกว่า 0', 400, 'INVALID_AMOUNT');
    }

    const prisma = getPrismaClient();
    const settlement = await prisma.contractSettlement.findUnique({
      where: { id: settlementId },
    });

    if (!settlement || settlement.dormitoryId !== dormitoryId) {
      throw new AppError('ไม่พบข้อมูลการคิดเงินย้ายออกที่ระบุ', 404, 'SETTLEMENT_NOT_FOUND');
    }

    // Lock check: Confirmed settlements are locked & immutable!
    if (settlement.settlementStatus === 'REFUNDED' || settlement.settlementStatus === 'PAYMENT_RECEIVED') {
      throw new AppError('รายการคิดเงินย้ายออกนี้ถูกยืนยันเรียบร้อยแล้ว ไม่สามารถแก้ไขได้อีก', 400, 'SETTLEMENT_LOCKED');
    }

    const item = await prisma.contractSettlementItem.create({
      data: {
        settlementId,
        description: description.trim(),
        amount: new Prisma.Decimal(numAmount),
        evidenceUrl: evidenceUrl?.trim() || null,
        isDeleted: false,
      },
    });

    // Recalculate settlement
    await this.recalculateSettlement(settlement.id);

    logger.info({
      event: 'SECURITY_AUDIT',
      dormitoryId,
      settlementId,
      itemId: item.id,
      actorUserId,
      action: 'DAMAGE_ITEM_ADDED',
      msg: `Added damage item ${item.id} to settlement ${settlementId}`,
    });

    return item;
  }

  /**
   * Edit Damage Item
   */
  public async editDamageItem(input: EditDamageItemInput) {
    const { dormitoryId, itemId, description, amount, evidenceUrl, actorUserId, actorRole } = input;

    if (actorRole !== 'OWNER' && actorRole !== 'MANAGER') {
      throw new AppError('เฉพาะเจ้าของหอพักหรือผู้จัดการเท่านั้นที่สามารถแก้ไขรายการค่าเสียหายได้', 403, 'FORBIDDEN');
    }

    const prisma = getPrismaClient();
    const item = await prisma.contractSettlementItem.findUnique({
      where: { id: itemId },
      include: { settlement: true },
    });

    if (!item || item.settlement.dormitoryId !== dormitoryId || item.isDeleted) {
      throw new AppError('ไม่พบรายการค่าเสียหายที่ระบุ', 404, 'ITEM_NOT_FOUND');
    }

    if (item.settlement.settlementStatus === 'REFUNDED' || item.settlement.settlementStatus === 'PAYMENT_RECEIVED') {
      throw new AppError('รายการคิดเงินย้ายออกนี้ถูกยืนยันเรียบร้อยแล้ว ไม่สามารถแก้ไขได้อีก', 400, 'SETTLEMENT_LOCKED');
    }

    const dataToUpdate: any = {};
    if (description !== undefined) {
      if (!description.trim()) throw new AppError('รายละเอียดค่าเสียหายต้องไม่เป็นค่าว่าง', 400, 'DESCRIPTION_REQUIRED');
      dataToUpdate.description = description.trim();
    }
    if (amount !== undefined) {
      const numAmount = Number(amount);
      if (isNaN(numAmount) || numAmount <= 0) throw new AppError('จำนวนเงินค่าเสียหายต้องมากกว่า 0', 400, 'INVALID_AMOUNT');
      dataToUpdate.amount = new Prisma.Decimal(numAmount);
    }
    if (evidenceUrl !== undefined) {
      dataToUpdate.evidenceUrl = evidenceUrl.trim() || null;
    }

    const updated = await prisma.contractSettlementItem.update({
      where: { id: itemId },
      data: dataToUpdate,
    });

    await this.recalculateSettlement(item.settlementId);

    logger.info({
      event: 'SECURITY_AUDIT',
      dormitoryId,
      itemId,
      actorUserId,
      action: 'DAMAGE_ITEM_EDITED',
      msg: `Edited damage item ${itemId}`,
    });

    return updated;
  }

  /**
   * Soft-Remove Damage Item (HARD DELETE IS FORBIDDEN)
   */
  public async softRemoveDamageItem(dormitoryId: string, itemId: string, actorUserId: string, actorRole: string) {
    if (actorRole !== 'OWNER' && actorRole !== 'MANAGER') {
      throw new AppError('เฉพาะเจ้าของหอพักหรือผู้จัดการเท่านั้นที่สามารถลบรายการค่าเสียหายได้', 403, 'FORBIDDEN');
    }

    const prisma = getPrismaClient();
    const item = await prisma.contractSettlementItem.findUnique({
      where: { id: itemId },
      include: { settlement: true },
    });

    if (!item || item.settlement.dormitoryId !== dormitoryId || item.isDeleted) {
      throw new AppError('ไม่พบรายการค่าเสียหายที่ระบุ', 404, 'ITEM_NOT_FOUND');
    }

    if (item.settlement.settlementStatus === 'REFUNDED' || item.settlement.settlementStatus === 'PAYMENT_RECEIVED') {
      throw new AppError('รายการคิดเงินย้ายออกนี้ถูกยืนยันเรียบร้อยแล้ว ไม่สามารถแก้ไขได้อีก', 400, 'SETTLEMENT_LOCKED');
    }

    const safeActorId = actorUserId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actorUserId) ? actorUserId : null;

    const softRemoved = await prisma.contractSettlementItem.update({
      where: { id: itemId },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
        deletedByUserId: safeActorId,
      },
    });

    await this.recalculateSettlement(item.settlementId);

    logger.info({
      event: 'SECURITY_AUDIT',
      dormitoryId,
      itemId,
      actorUserId,
      action: 'DAMAGE_ITEM_SOFT_REMOVED',
      msg: `Soft-removed damage item ${itemId}`,
    });

    return softRemoved;
  }

  /**
   * Confirm Settlement Status (Mark refund or payment difference confirmed outside HorPlus)
   */
  public async confirmSettlementStatus(dormitoryId: string, settlementId: string, targetStatus: string, actorUserId: string, actorRole: string) {
    if (actorRole !== 'OWNER' && actorRole !== 'MANAGER') {
      throw new AppError('เฉพาะเจ้าของหอพักหรือผู้จัดการเท่านั้นที่สามารถยืนยันสถานะการคืนเงิน/ชำระส่วนต่างได้', 403, 'FORBIDDEN');
    }

    const prisma = getPrismaClient();
    const settlement = await prisma.contractSettlement.findUnique({
      where: { id: settlementId },
    });

    if (!settlement || settlement.dormitoryId !== dormitoryId) {
      throw new AppError('ไม่พบข้อมูลการคิดเงินย้ายออกที่ระบุ', 404, 'SETTLEMENT_NOT_FOUND');
    }

    if (settlement.settlementStatus === 'REFUNDED' || settlement.settlementStatus === 'PAYMENT_RECEIVED') {
      return settlement; // Idempotent return
    }

    if (targetStatus !== 'REFUNDED' && targetStatus !== 'PAYMENT_RECEIVED') {
      throw new AppError('สถานะการยืนยันไม่ถูกต้อง', 400, 'INVALID_STATUS');
    }

    if (targetStatus === 'REFUNDED' && settlement.settlementStatus !== 'PENDING_REFUND') {
      throw new AppError('ไม่สามารถยืนยันคืนเงินได้เนื่องจากยอดย้ายออกไม่ได้อยู่ในสถานะรอคืนเงิน', 400, 'INVALID_SETTLEMENT_STATE');
    }

    if (targetStatus === 'PAYMENT_RECEIVED' && settlement.settlementStatus !== 'PENDING_PAYMENT') {
      throw new AppError('ไม่สามารถยืนยันชำระส่วนต่างได้เนื่องจากยอดย้ายออกไม่ได้อยู่ในสถานะรอชำระส่วนต่าง', 400, 'INVALID_SETTLEMENT_STATE');
    }

    const safeActorId = actorUserId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actorUserId) ? actorUserId : null;

    const updated = await prisma.$transaction(async (tx) => {
      const res = await tx.contractSettlement.update({
        where: { id: settlementId },
        data: {
          settlementStatus: targetStatus,
          confirmedAt: new Date(),
          confirmedByUserId: safeActorId,
        },
      });

      await outboxService.createOutboxEvent(tx, {
        dormitoryId,
        eventType: 'SETTLEMENT_CONFIRMED',
        aggregateType: 'CONTRACT_SETTLEMENT',
        aggregateId: settlementId,
        recipientType: 'TENANT',
        recipientId: settlement.tenantId,
        title: 'แจ้งยืนยันการคิดเงินย้ายออก',
        body: `รายการคิดเงินย้ายออกสำหรับสัญญาของคุณได้รับการยืนยันสถานะ ${targetStatus} เรียบร้อยแล้ว`,
      });

      return res;
    });

    outboxService.processPendingOutboxEvents().catch((err) => {
      logger.error({ event: 'OUTBOX_DISPATCH_AFTER_SETTLEMENT_CONFIRM_ERROR', error: err.message });
    });

    logger.info({
      event: 'SECURITY_AUDIT',
      dormitoryId,
      settlementId,
      actorUserId,
      targetStatus,
      action: 'SETTLEMENT_STATUS_CONFIRMED',
      msg: `Confirmed settlement ${settlementId} status to ${targetStatus}`,
    });

    return updated;
  }

  private async recalculateSettlement(settlementId: string) {
    const prisma = getPrismaClient();
    const settlement = await prisma.contractSettlement.findUnique({
      where: { id: settlementId },
      include: { items: { where: { isDeleted: false } } },
    });

    if (!settlement) return;

    const activeDamageTotal = settlement.items.reduce(
      (sum, item) => sum.add(new Prisma.Decimal(item.amount || 0)),
      new Prisma.Decimal(0)
    );

    const deposit = new Prisma.Decimal(settlement.depositAmount || 0);
    const unpaid = new Prisma.Decimal(settlement.unpaidBillAmount || 0);
    const net = deposit.sub(unpaid).sub(activeDamageTotal);

    let direction = 'ZERO';
    let status = 'CLOSED_ZERO';

    if (net.gt(0)) {
      direction = 'REFUND';
      status = 'PENDING_REFUND';
    } else if (net.lt(0)) {
      direction = 'PAYMENT_DUE';
      status = 'PENDING_PAYMENT';
    }

    await prisma.contractSettlement.update({
      where: { id: settlementId },
      data: {
        damageChargeTotal: activeDamageTotal,
        netSettlement: net,
        settlementDirection: direction,
        settlementStatus: status,
      },
    });
  }
}

export const settlementService = new SettlementService();
