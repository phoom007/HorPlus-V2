/**
 * HorPlus Billing & Co-Occupant Domain Orchestration Service
 * Implements atomic domain orchestration for:
 * 1. Household truth (TenantCoOccupant) management
 * 2. Billing-cycle peopleCount snapshot (RoomBillingCycleSnapshot)
 * 3. Authoritative bill recalculation (unpaid bills only, locked bills immutable)
 * 4. LocalNotificationOutbox creation & post-commit dispatch
 * @license Apache-2.0
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { getPrismaClient } from '../db/prisma.js';
import { OutboxService } from './outbox.service.js';
import { AuditService } from './audit.service.js';
import {
  toDecimal,
  addDecimals,
  mulDecimals,
  subDecimals,
  formatDecimal,
  compareDecimals,
} from '../utils/decimal-math.util.js';

export interface AddCoOccupantInput {
  name: string;
  phone?: string | null;
  relationship?: string | null;
  nationalId?: string | null;
  dateOfBirth?: string | null;
}

export interface RecalculationResult {
  recalculated: boolean;
  reason?: string;
  billId?: string;
  billNumber?: string;
  prevTotal?: string;
  newTotal?: string;
  prevTotalAmount?: string;
  newTotalAmount?: string;
  prevPeopleCount?: number;
  newPeopleCount: number;
  isPaidImmutable?: boolean;
}

export function isBillRecalculatable(bill: {
  status: string;
  paidAmount?: Prisma.Decimal | string | number | null;
}): boolean {
  const status = (bill.status || '').toLowerCase();
  const nonRecalculatableStatuses = ['paid', 'cancelled', 'voided'];
  if (nonRecalculatableStatuses.includes(status)) {
    return false;
  }
  const paidAmount = Number(bill.paidAmount || 0);
  if (paidAmount > 0) {
    return false;
  }
  return true;
}

export class BillingOrchestrationService {
  constructor(
    private prisma: PrismaClient = getPrismaClient(),
    private outboxService: OutboxService = new OutboxService(),
    private auditService?: AuditService
  ) {}

  /**
   * Resolves the authoritative household peopleCount for a tenant
   * householdCount = 1 (main tenant) + active non-deleted co-occupants
   */
  public async getHouseholdCount(
    dormitoryId: string,
    tenantId: string,
    tx?: Prisma.TransactionClient
  ): Promise<number> {
    const client = tx || this.prisma;
    const coCount = await client.tenantCoOccupant.count({
      where: {
        dormitoryId,
        tenantId,
        deletedAt: null,
      },
    });
    return 1 + coCount;
  }

  /**
   * Resolves or seeds the PostgreSQL-authoritative RoomBillingCycleSnapshot
   */
  public async resolveCyclePeopleCount(
    dormitoryId: string,
    billingCycleId: string,
    roomId: string,
    tenantId?: string | null,
    tx?: Prisma.TransactionClient
  ): Promise<number> {
    const client = tx || this.prisma;

    const existing = await client.roomBillingCycleSnapshot.findUnique({
      where: {
        dormitory_billing_cycle_room_unique: {
          dormitoryId,
          billingCycleId,
          roomId,
        },
      },
    });

    if (existing) {
      return existing.peopleCount;
    }

    // Seed from household truth if tenantId available
    let seedCount = 1;
    if (tenantId) {
      seedCount = await this.getHouseholdCount(dormitoryId, tenantId, client);
    } else {
      // Find room active contract or tenant
      const activeContract = await client.contract.findFirst({
        where: {
          dormitoryId,
          roomId,
          status: { in: ['active', 'expiring_soon', 'pending_signature', 'waiting_extension', 'checking_out'] },
          deletedAt: null,
        },
      });
      if (activeContract) {
        seedCount = await this.getHouseholdCount(dormitoryId, activeContract.tenantId, client);
      }
    }

    await client.roomBillingCycleSnapshot.upsert({
      where: {
        dormitory_billing_cycle_room_unique: {
          dormitoryId,
          billingCycleId,
          roomId,
        },
      },
      create: {
        dormitoryId,
        billingCycleId,
        roomId,
        peopleCount: seedCount,
        source: 'HOUSEHOLD_SYNC',
      },
      update: {},
    });

    return seedCount;
  }

  /**
   * Recalculates an unpaid bill for a room and cycle using snapshotted rates
   * Leaves paid/locked bills strictly immutable.
   */
  public async recalculateUnpaidBill(
    dormitoryId: string,
    billingCycleId: string,
    roomId: string,
    newPeopleCount: number,
    prevPeopleCount: number,
    tx: Prisma.TransactionClient
  ): Promise<RecalculationResult> {
    // 1. Find bill for this cycle and room
    const bill = await tx.bill.findFirst({
      where: {
        dormitoryId,
        billingCycleId,
        roomId,
      },
      include: {
        items: {
          orderBy: { displayOrder: 'asc' },
        },
        room: true,
      },
    });

    if (!bill) {
      return {
        recalculated: false,
        reason: 'NO_BILL_ISSUED',
        newPeopleCount,
        prevPeopleCount,
      };
    }

    // 2. Financial Lock Invariant
    if (!isBillRecalculatable(bill)) {
      return {
        recalculated: false,
        reason: 'PAID_OR_LOCKED',
        billId: bill.id,
        billNumber: bill.billNumber,
        newPeopleCount,
        prevPeopleCount,
        isPaidImmutable: true,
      };
    }

    // 3. Find rate snapshot for cycle
    let rateSnapshot = bill.rateSnapshotId
      ? await tx.billingRateSnapshot.findUnique({ where: { id: bill.rateSnapshotId } })
      : null;
    if (!rateSnapshot) {
      rateSnapshot = await tx.billingRateSnapshot.findFirst({
        where: { dormitoryId, billingCycleId },
        orderBy: { createdAt: 'desc' },
      });
    }

    const roomNumber = bill.room?.roomNumber || 'ไม่ระบุ';
    const peopleCountDec = toDecimal(newPeopleCount.toString());

    // 4. Update per-person line items
    let updatedSubtotal = toDecimal('0.00');

    for (const item of bill.items) {
      const isPerPersonItem =
        item.unit === 'person' ||
        (item.metadata as any)?.mode === 'person' ||
        (item.type === 'water' && (rateSnapshot?.waterBillingType === 'per_person' || rateSnapshot?.waterBillingType === 'person')) ||
        (item.type === 'electricity' && (rateSnapshot?.electricityBillingType === 'per_person' || rateSnapshot?.electricityBillingType === 'person')) ||
        (item.type === 'common_fee' && rateSnapshot?.commonFeeMode === 'person') ||
        (item.type === 'internet' && rateSnapshot?.internetFeeMode === 'person') ||
        (item.type === 'parking' && rateSnapshot?.parkingFeeMode === 'person');

      if (isPerPersonItem) {
        const unitPrice = toDecimal(item.unitPrice);
        const newItemAmount = mulDecimals(peopleCountDec, unitPrice);
        let newDescription = item.description;

        if (newDescription.includes('คน')) {
          newDescription = newDescription.replace(/\(\d+\s*คน\)/, `(${newPeopleCount} คน)`);
        } else {
          newDescription = `${newDescription} (${newPeopleCount} คน)`;
        }

        await tx.billItem.update({
          where: { id: item.id },
          data: {
            quantity: formatDecimal(peopleCountDec),
            amount: formatDecimal(newItemAmount),
            unit: 'person',
            description: newDescription,
            metadata: {
              ...(item.metadata as any || {}),
              mode: 'person',
              peopleCount: newPeopleCount,
            },
          },
        });

        updatedSubtotal = addDecimals(updatedSubtotal, newItemAmount);
      } else {
        // Preserved non-person item
        updatedSubtotal = addDecimals(updatedSubtotal, item.amount);
      }
    }

    // 5. Calculate new totalAmount and outstandingAmount
    const discountDec = toDecimal(bill.discountAmount);
    const fineDec = toDecimal(bill.fineAmount);
    const rawTotal = subDecimals(addDecimals(updatedSubtotal, fineDec), discountDec);
    const newTotal = compareDecimals(rawTotal, '0.00') < 0 ? toDecimal('0.00') : rawTotal;
    const paidDec = toDecimal(bill.paidAmount);
    const rawOutstanding = subDecimals(newTotal, paidDec);
    const newOutstanding = compareDecimals(rawOutstanding, '0.00') < 0 ? toDecimal('0.00') : rawOutstanding;

    const prevTotalStr = formatDecimal(bill.totalAmount);
    const newTotalStr = formatDecimal(newTotal);

    await tx.bill.update({
      where: { id: bill.id },
      data: {
        subtotal: formatDecimal(updatedSubtotal),
        totalAmount: newTotalStr,
        outstandingAmount: formatDecimal(newOutstanding),
        updatedAt: new Date(),
      },
    });

    // 6. If total amount changed, create notification outbox event for Tenant
    if (bill.tenantId && prevTotalStr !== newTotalStr) {
      await this.outboxService.createOutboxEvent(tx, {
        dormitoryId,
        eventType: 'UNPAID_BILL_RECALCULATED',
        aggregateType: 'BILL',
        aggregateId: bill.id,
        recipientType: 'TENANT',
        recipientId: bill.tenantId,
        title: `ยอดบิลห้อง ${roomNumber} มีการคำนวณใหม่`,
        body: `ยอดบิลห้อง ${roomNumber} มีการคำนวณใหม่ จำนวนคน ${prevPeopleCount} → ${newPeopleCount} ยอดใหม่ ฿${Number(newTotalStr).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        payload: {
          billId: bill.id,
          billNumber: bill.billNumber,
          roomNumber,
          prevTotal: prevTotalStr,
          newTotal: newTotalStr,
          prevPeopleCount,
          newPeopleCount,
        },
      });
    }

    return {
      recalculated: true,
      billId: bill.id,
      billNumber: bill.billNumber,
      prevTotal: prevTotalStr,
      newTotal: newTotalStr,
      prevTotalAmount: prevTotalStr,
      newTotalAmount: newTotalStr,
      prevPeopleCount,
      newPeopleCount,
    };
  }

  /**
   * Atomically adds a co-occupant for a tenant, reconciles cycle snapshot, recalculates unpaid bill,
   * creates outbox event, and records audit log.
   */
  public async addTenantCoOccupant(
    dormitoryId: string,
    tenantId: string,
    data: AddCoOccupantInput,
    actor: { userId?: string; isTenant?: boolean }
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Verify tenant exists and belongs to dormitory
      const tenant = await tx.tenant.findFirst({
        where: { id: tenantId, dormitoryId, deletedAt: null },
      });
      if (!tenant) {
        const err = new Error('ไม่พบข้อมูลผู้เช่า');
        (err as any).statusCode = 404;
        (err as any).code = 'TENANT_NOT_FOUND';
        throw err;
      }

      // 2. Active contract/room lookup
      const contract = await tx.contract.findFirst({
        where: {
          dormitoryId,
          tenantId,
          status: { in: ['active', 'expiring_soon', 'pending_signature', 'waiting_extension', 'checking_out'] },
          deletedAt: null,
        },
        include: { room: true },
      });

      const prevHouseholdCount = await this.getHouseholdCount(dormitoryId, tenantId, tx);

      // 3. Insert CoOccupant
      const coOccupant = await tx.tenantCoOccupant.create({
        data: {
          dormitoryId,
          tenantId,
          contractId: contract?.id || null,
          name: data.name.trim(),
          phone: data.phone?.trim() || null,
          relationship: data.relationship?.trim() || null,
          status: 'active',
        },
      });

      const newHouseholdCount = prevHouseholdCount + 1;
      const roomNumber = contract?.room?.roomNumber || 'ไม่ระบุ';
      let recalculation: RecalculationResult = {
        recalculated: false,
        newPeopleCount: newHouseholdCount,
        prevPeopleCount: prevHouseholdCount,
      };

      // 4. Find active/latest billing cycle
      const activeCycle = await tx.billingCycle.findFirst({
        where: {
          dormitoryId,
          status: { notIn: ['completed'] },
        },
        orderBy: { periodStart: 'desc' },
      });

      let currentCycleBillPaid = false;

      if (activeCycle && contract?.roomId) {
        // Check current cycle snapshot
        const currentSnapshot = await tx.roomBillingCycleSnapshot.findUnique({
          where: {
            dormitory_billing_cycle_room_unique: {
              dormitoryId,
              billingCycleId: activeCycle.id,
              roomId: contract.roomId,
            },
          },
        });
        const prevCyclePeopleCount = currentSnapshot ? currentSnapshot.peopleCount : prevHouseholdCount;

        // Check if current bill is paid
        const currentBill = await tx.bill.findFirst({
          where: {
            dormitoryId,
            billingCycleId: activeCycle.id,
            roomId: contract.roomId,
          },
        });

        if (currentBill && !isBillRecalculatable(currentBill)) {
          currentCycleBillPaid = true;
          recalculation = {
            recalculated: false,
            reason: 'PAID_OR_LOCKED',
            billId: currentBill.id,
            billNumber: currentBill.billNumber,
            prevPeopleCount: prevHouseholdCount,
            newPeopleCount: newHouseholdCount,
            isPaidImmutable: true,
          };
          // Paid bill is IMMUTABLE: do not update current cycle snapshot or bill
        } else {
          // Financially unlocked: update cycle snapshot and recalculate unpaid bill
          await tx.roomBillingCycleSnapshot.upsert({
            where: {
              dormitory_billing_cycle_room_unique: {
                dormitoryId,
                billingCycleId: activeCycle.id,
                roomId: contract.roomId,
              },
            },
            create: {
              dormitoryId,
              billingCycleId: activeCycle.id,
              roomId: contract.roomId,
              peopleCount: newHouseholdCount,
              source: 'HOUSEHOLD_SYNC',
              updatedByUserId: actor.userId || null,
            },
            update: {
              peopleCount: newHouseholdCount,
              source: 'HOUSEHOLD_SYNC',
              updatedByUserId: actor.userId || null,
            },
          });

          recalculation = await this.recalculateUnpaidBill(
            dormitoryId,
            activeCycle.id,
            contract.roomId,
            newHouseholdCount,
            prevCyclePeopleCount,
            tx
          );
        }
      }

      // 5. Create Outbox Event
      if (actor.isTenant) {
        // Tenant added co-occupant -> notify Staff
        const billingNote = recalculation.recalculated
          ? 'ระบบอัปเดตยอดในบิลที่รอชำระแล้ว'
          : currentCycleBillPaid
          ? 'งวดปัจจุบันชำระแล้ว ระบบจะใช้จำนวนใหม่ในงวดถัดไป'
          : 'ระบบอัปเดตจำนวนคนในงวดปัจจุบันแล้ว';

        await this.outboxService.createOutboxEvent(tx, {
          dormitoryId,
          eventType: 'CO_OCCUPANT_ADDED',
          aggregateType: 'TENANT',
          aggregateId: tenantId,
          recipientType: 'STAFF',
          recipientRoleCode: 'OWNER,MANAGER',
          title: `ห้อง ${roomNumber} เพิ่มผู้พักร่วม`,
          body: `ห้อง ${roomNumber} (${tenant.displayName}) เพิ่มผู้พักร่วมคุณ ${coOccupant.name} จำนวนคนเปลี่ยนจาก ${prevHouseholdCount} เป็น ${newHouseholdCount}. ${billingNote}`,
          payload: {
            tenantId,
            coOccupantId: coOccupant.id,
            coOccupantName: coOccupant.name,
            roomNumber,
            prevHouseholdCount,
            newHouseholdCount,
            recalculation,
          },
        });
      } else {
        // Staff added co-occupant -> notify Tenant
        const billingNote = recalculation.recalculated
          ? 'ระบบอัปเดตยอดบิลรอชำระแล้ว'
          : currentCycleBillPaid
          ? 'การเปลี่ยนแปลงจะมีผลในงวดถัดไป เนื่องจากงวดปัจจุบันชำระเงินแล้ว'
          : '';

        await this.outboxService.createOutboxEvent(tx, {
          dormitoryId,
          eventType: 'CO_OCCUPANT_ADDED_BY_STAFF',
          aggregateType: 'TENANT',
          aggregateId: tenantId,
          recipientType: 'TENANT',
          recipientId: tenantId,
          title: `มีการเพิ่มผู้พักร่วมห้อง ${roomNumber}`,
          body: `เจ้าหน้าที่ได้เพิ่มผู้พักร่วมคุณ ${coOccupant.name} สำหรับห้อง ${roomNumber} จำนวนคนเปลี่ยนจาก ${prevHouseholdCount} เป็น ${newHouseholdCount}. ${billingNote}`,
          payload: {
            tenantId,
            coOccupantId: coOccupant.id,
            roomNumber,
            prevHouseholdCount,
            newHouseholdCount,
          },
        });
      }

      return {
        coOccupant,
        peopleCount: newHouseholdCount,
        prevPeopleCount: prevHouseholdCount,
        recalculation,
      };
    });

    // Post-commit outbox dispatch
    await this.outboxService.processPendingOutboxEvents().catch(() => {});

    if (this.auditService && actor.userId) {
      this.auditService.log({
        dormitoryId,
        actorUserId: actor.userId,
        action: 'tenant.co_occupant.add',
        resourceType: 'tenant_co_occupant',
        resourceId: result.coOccupant.id,
        details: {
          tenantId,
          name: result.coOccupant.name,
          peopleCount: result.peopleCount,
        },
      });
    }

    return result;
  }

  /**
   * Atomically removes a co-occupant, reconciles cycle snapshot, recalculates unpaid bill,
   * creates outbox event, and records audit log.
   */
  public async removeTenantCoOccupant(
    dormitoryId: string,
    tenantId: string,
    coOccupantId: string,
    actor: { userId?: string; isTenant?: boolean }
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      const coOccupant = await tx.tenantCoOccupant.findFirst({
        where: {
          id: coOccupantId,
          dormitoryId,
          tenantId,
          deletedAt: null,
        },
      });

      if (!coOccupant) {
        const err = new Error('ไม่พบข้อมูลผู้พักร่วมที่ระบุ');
        (err as any).statusCode = 404;
        (err as any).code = 'CO_OCCUPANT_NOT_FOUND';
        throw err;
      }

      const tenant = await tx.tenant.findFirst({
        where: { id: tenantId, dormitoryId, deletedAt: null },
      });

      const contract = await tx.contract.findFirst({
        where: {
          dormitoryId,
          tenantId,
          status: { in: ['active', 'expiring_soon', 'pending_signature', 'waiting_extension', 'checking_out'] },
          deletedAt: null,
        },
        include: { room: true },
      });

      const prevHouseholdCount = await this.getHouseholdCount(dormitoryId, tenantId, tx);

      // Soft delete co-occupant
      await tx.tenantCoOccupant.update({
        where: { id: coOccupantId },
        data: {
          deletedAt: new Date(),
          status: 'inactive',
        },
      });

      const newHouseholdCount = Math.max(1, prevHouseholdCount - 1);
      const roomNumber = contract?.room?.roomNumber || 'ไม่ระบุ';
      let recalculation: RecalculationResult = {
        recalculated: false,
        newPeopleCount: newHouseholdCount,
        prevPeopleCount: prevHouseholdCount,
      };

      const activeCycle = await tx.billingCycle.findFirst({
        where: {
          dormitoryId,
          status: { notIn: ['completed'] },
        },
        orderBy: { periodStart: 'desc' },
      });

      let currentCycleBillPaid = false;

      if (activeCycle && contract?.roomId) {
        const currentSnapshot = await tx.roomBillingCycleSnapshot.findUnique({
          where: {
            dormitory_billing_cycle_room_unique: {
              dormitoryId,
              billingCycleId: activeCycle.id,
              roomId: contract.roomId,
            },
          },
        });
        const prevCyclePeopleCount = currentSnapshot ? currentSnapshot.peopleCount : prevHouseholdCount;

        const currentBill = await tx.bill.findFirst({
          where: {
            dormitoryId,
            billingCycleId: activeCycle.id,
            roomId: contract.roomId,
          },
        });

        if (currentBill && !isBillRecalculatable(currentBill)) {
          currentCycleBillPaid = true;
          recalculation = {
            recalculated: false,
            reason: 'PAID_OR_LOCKED',
            billId: currentBill.id,
            billNumber: currentBill.billNumber,
            prevPeopleCount: prevHouseholdCount,
            newPeopleCount: newHouseholdCount,
            isPaidImmutable: true,
          };
          // Paid bill is IMMUTABLE
        } else {
          await tx.roomBillingCycleSnapshot.upsert({
            where: {
              dormitory_billing_cycle_room_unique: {
                dormitoryId,
                billingCycleId: activeCycle.id,
                roomId: contract.roomId,
              },
            },
            create: {
              dormitoryId,
              billingCycleId: activeCycle.id,
              roomId: contract.roomId,
              peopleCount: newHouseholdCount,
              source: 'HOUSEHOLD_SYNC',
              updatedByUserId: actor.userId || null,
            },
            update: {
              peopleCount: newHouseholdCount,
              source: 'HOUSEHOLD_SYNC',
              updatedByUserId: actor.userId || null,
            },
          });

          recalculation = await this.recalculateUnpaidBill(
            dormitoryId,
            activeCycle.id,
            contract.roomId,
            newHouseholdCount,
            prevCyclePeopleCount,
            tx
          );
        }
      }

      // Outbox event
      if (actor.isTenant) {
        const billingNote = recalculation.recalculated
          ? 'ระบบอัปเดตยอดในบิลที่รอชำระแล้ว'
          : currentCycleBillPaid
          ? 'งวดปัจจุบันชำระแล้ว ระบบจะใช้จำนวนใหม่ในงวดถัดไป'
          : 'ระบบอัปเดตจำนวนคนในงวดปัจจุบันแล้ว';

        await this.outboxService.createOutboxEvent(tx, {
          dormitoryId,
          eventType: 'CO_OCCUPANT_REMOVED',
          aggregateType: 'TENANT',
          aggregateId: tenantId,
          recipientType: 'STAFF',
          recipientRoleCode: 'OWNER,MANAGER',
          title: `ห้อง ${roomNumber} ลบผู้พักร่วม`,
          body: `ห้อง ${roomNumber} (${tenant?.displayName || 'ผู้เช่า'}) ลบผู้พักร่วมคุณ ${coOccupant.name} จำนวนคนเปลี่ยนจาก ${prevHouseholdCount} เป็น ${newHouseholdCount}. ${billingNote}`,
          payload: {
            tenantId,
            coOccupantId,
            coOccupantName: coOccupant.name,
            roomNumber,
            prevHouseholdCount,
            newHouseholdCount,
            recalculation,
          },
        });
      } else {
        const billingNote = recalculation.recalculated
          ? 'ระบบอัปเดตยอดบิลรอชำระแล้ว'
          : currentCycleBillPaid
          ? 'การเปลี่ยนแปลงจะมีผลในงวดถัดไป เนื่องจากงวดปัจจุบันชำระเงินแล้ว'
          : '';

        await this.outboxService.createOutboxEvent(tx, {
          dormitoryId,
          eventType: 'CO_OCCUPANT_REMOVED_BY_STAFF',
          aggregateType: 'TENANT',
          aggregateId: tenantId,
          recipientType: 'TENANT',
          recipientId: tenantId,
          title: `มีการนำผู้พักร่วมออกจากห้อง ${roomNumber}`,
          body: `เจ้าหน้าที่ได้นำผู้พักร่วมคุณ ${coOccupant.name} ออกจากห้อง ${roomNumber} จำนวนคนเปลี่ยนจาก ${prevHouseholdCount} เป็น ${newHouseholdCount}. ${billingNote}`,
          payload: {
            tenantId,
            coOccupantId,
            roomNumber,
            prevHouseholdCount,
            newHouseholdCount,
          },
        });
      }

      return {
        removedId: coOccupantId,
        peopleCount: newHouseholdCount,
        prevPeopleCount: prevHouseholdCount,
        recalculation,
      };
    });

    // Post-commit outbox dispatch
    await this.outboxService.processPendingOutboxEvents().catch(() => {});

    if (this.auditService && actor.userId) {
      this.auditService.log({
        dormitoryId,
        actorUserId: actor.userId,
        action: 'tenant.co_occupant.remove',
        resourceType: 'tenant_co_occupant',
        resourceId: coOccupantId,
        details: {
          tenantId,
          peopleCount: result.peopleCount,
        },
      });
    }

    return result;
  }

  /**
   * Corrects the billing-cycle peopleCount snapshot from the Owner Meter page
   * Recalculates any active unpaid bill and notifies the tenant via outbox.
   */
  public async correctMeterCyclePeopleCount(
    dormitoryId: string,
    billingCycleId: string,
    roomId: string,
    newPeopleCount: number,
    userId?: string
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      const room = await tx.room.findUnique({
        where: { id: roomId },
      });
      if (!room || room.dormitoryId !== dormitoryId) {
        const err = new Error('ไม่พบข้อมูลห้องพัก');
        (err as any).statusCode = 404;
        (err as any).code = 'ROOM_NOT_FOUND';
        throw err;
      }

      const existingSnapshot = await tx.roomBillingCycleSnapshot.findUnique({
        where: {
          dormitory_billing_cycle_room_unique: {
            dormitoryId,
            billingCycleId,
            roomId,
          },
        },
      });

      const prevPeopleCount = existingSnapshot ? existingSnapshot.peopleCount : 1;

      // Upsert snapshot
      await tx.roomBillingCycleSnapshot.upsert({
        where: {
          dormitory_billing_cycle_room_unique: {
            dormitoryId,
            billingCycleId,
            roomId,
          },
        },
        create: {
          dormitoryId,
          billingCycleId,
          roomId,
          peopleCount: newPeopleCount,
          source: 'METER_CORRECTION',
          updatedByUserId: userId || null,
        },
        update: {
          peopleCount: newPeopleCount,
          source: 'METER_CORRECTION',
          updatedByUserId: userId || null,
        },
      });

      // Recalculate bill if exists and unpaid
      const recalculation = await this.recalculateUnpaidBill(
        dormitoryId,
        billingCycleId,
        roomId,
        newPeopleCount,
        prevPeopleCount,
        tx
      );

      // Notify tenant if contract/tenant exists
      const activeContract = await tx.contract.findFirst({
        where: {
          dormitoryId,
          roomId,
          status: { in: ['active', 'expiring_soon', 'pending_signature', 'waiting_extension', 'checking_out'] },
          deletedAt: null,
        },
      });

      if (activeContract && prevPeopleCount !== newPeopleCount) {
        const billingNote = recalculation.recalculated
          ? 'ระบบอัปเดตยอดรอชำระแล้ว'
          : recalculation.isPaidImmutable
          ? 'การเปลี่ยนแปลงจะมีผลในงวดถัดไป เนื่องจากงวดปัจจุบันชำระแล้ว'
          : '';

        await this.outboxService.createOutboxEvent(tx, {
          dormitoryId,
          eventType: 'PEOPLE_COUNT_CORRECTED',
          aggregateType: 'ROOM',
          aggregateId: roomId,
          recipientType: 'TENANT',
          recipientId: activeContract.tenantId,
          title: `มีการปรับจำนวนผู้พักอาศัยห้อง ${room.roomNumber}`,
          body: `เจ้าของหอพักปรับจำนวนผู้พักอาศัยห้อง ${room.roomNumber} (จำนวนคน ${prevPeopleCount} → ${newPeopleCount}). ${billingNote}`.trim(),
          payload: {
            roomId,
            roomNumber: room.roomNumber,
            prevPeopleCount,
            newPeopleCount,
            recalculation,
          },
        });
      }

      return {
        roomId,
        peopleCount: newPeopleCount,
        prevPeopleCount,
        recalculation,
      };
    });

    // Post-commit outbox dispatch
    await this.outboxService.processPendingOutboxEvents().catch(() => {});

    if (this.auditService && userId) {
      this.auditService.log({
        dormitoryId,
        actorUserId: userId,
        action: 'meter.people_count.correct',
        resourceType: 'room_billing_cycle_snapshot',
        resourceId: `${billingCycleId}:${roomId}`,
        details: {
          roomId,
          peopleCount: newPeopleCount,
        },
      });
    }

    return result;
  }
}

export const billingOrchestrationService = new BillingOrchestrationService();
