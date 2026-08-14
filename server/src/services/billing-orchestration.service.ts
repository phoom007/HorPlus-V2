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
  oldTotalAmount?: string;
  prevPeopleCount?: number;
  newPeopleCount: number;
  isPaidImmutable?: boolean;
  itemsUpdated?: number;
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
   * Resolves the true current billing cycle for a dormitory:
   * 1. Active/open cycle whose periodStart <= now <= periodEnd
   * 2. Active/open cycle whose periodStart <= now (ordered by periodStart desc)
   * 3. Earliest upcoming active/open cycle (ordered by periodStart asc)
   */
  public async resolveCurrentBillingCycle(
    dormitoryId: string,
    tx: Prisma.TransactionClient
  ) {
    const now = new Date();

    // 1. Non-completed cycle currently in effect (periodStart <= now <= periodEnd)
    const currentRangeCycle = await tx.billingCycle.findFirst({
      where: {
        dormitoryId,
        status: { notIn: ['completed'] },
        periodStart: { lte: now },
        periodEnd: { gte: now },
      },
      orderBy: { periodStart: 'desc' },
    });
    if (currentRangeCycle) return currentRangeCycle;

    // 2. Non-completed cycle that has already started (periodStart <= now)
    const pastStartedCycle = await tx.billingCycle.findFirst({
      where: {
        dormitoryId,
        status: { notIn: ['completed'] },
        periodStart: { lte: now },
      },
      orderBy: { periodStart: 'desc' },
    });
    if (pastStartedCycle) return pastStartedCycle;

    // 3. Fallback: earliest upcoming non-completed cycle
    return await tx.billingCycle.findFirst({
      where: {
        dormitoryId,
        status: { notIn: ['completed'] },
      },
      orderBy: { periodStart: 'asc' },
    });
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

    // Check if previous cycle had a meter correction snapshot to propagate if higher
    const targetCycle = await client.billingCycle.findUnique({ where: { id: billingCycleId } });
    if (targetCycle) {
      const prevCycleSnapshot = await client.roomBillingCycleSnapshot.findFirst({
        where: {
          dormitoryId,
          roomId,
          billingCycle: {
            periodStart: { lt: targetCycle.periodStart },
          },
        },
        orderBy: { billingCycle: { periodStart: 'desc' } },
      });
      if (prevCycleSnapshot && prevCycleSnapshot.source === 'METER_CORRECTION') {
        seedCount = Math.max(seedCount, prevCycleSnapshot.peopleCount);
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
    // 1. Find authoritative active/unpaid bill for this cycle and room
    const bill = await tx.bill.findFirst({
      where: {
        dormitoryId,
        billingCycleId,
        roomId,
        status: { notIn: ['cancelled', 'voided', 'withdrawn', 'superseded'] },
        cancelledAt: null,
      },
      orderBy: { createdAt: 'desc' },
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

    // 3. Load Billing Rate Snapshot for this cycle
    const rateSnapshot = await tx.billingRateSnapshot.findFirst({
      where: { billingCycleId },
      orderBy: { createdAt: 'desc' },
    });

    // Fallback to DormitoryBillingSettings if rate snapshot not found
    const liveSettings = !rateSnapshot
      ? await tx.dormitoryBillingSettings.findUnique({ where: { dormitoryId } })
      : null;

    const waterRate = rateSnapshot
      ? toDecimal(rateSnapshot.waterRate)
      : liveSettings?.waterRate
      ? toDecimal(liveSettings.waterRate)
      : toDecimal('0.00');

    const commonFee = rateSnapshot
      ? toDecimal(rateSnapshot.commonFee)
      : liveSettings?.commonFee
      ? toDecimal(liveSettings.commonFee)
      : toDecimal('0.00');

    const commonFeeMode = rateSnapshot
      ? rateSnapshot.commonFeeMode
      : liveSettings?.commonFeeMode || 'room';

    const items = bill.items;
    let newSubtotal = toDecimal('0.00');
    let itemsUpdated = 0;
    const peopleCountDec = toDecimal(newPeopleCount);

    for (const item of items) {
      let updatedAmount = toDecimal(item.amount);
      let updatedQuantity = toDecimal(item.quantity);
      let updatedDesc = item.description;
      let updatedMeta = item.metadata ? { ...(item.metadata as any) } : {};

      if (item.type === 'water') {
        const isPerPerson =
          (item.metadata as any)?.mode === 'person' ||
          item.unit === 'person' ||
          (rateSnapshot && rateSnapshot.waterBillingType === 'person');

        if (isPerPerson) {
          const unitPrice = item.unitPrice ? toDecimal(item.unitPrice) : waterRate;
          updatedQuantity = peopleCountDec;
          updatedAmount = mulDecimals(peopleCountDec, unitPrice);
          updatedDesc = `ค่าน้ำประปา (${newPeopleCount} คน)`;
          updatedMeta = { ...updatedMeta, peopleCount: newPeopleCount, mode: 'person' };
          itemsUpdated++;
        }
      } else if (item.type === 'common_fee') {
        const isPerPerson =
          commonFeeMode === 'person' ||
          (item.metadata as any)?.mode === 'person' ||
          item.unit === 'person';

        if (isPerPerson) {
          const unitPrice = item.unitPrice ? toDecimal(item.unitPrice) : commonFee;
          updatedQuantity = peopleCountDec;
          updatedAmount = mulDecimals(peopleCountDec, unitPrice);
          updatedDesc = `ค่าส่วนกลาง (${newPeopleCount} คน)`;
          updatedMeta = { ...updatedMeta, peopleCount: newPeopleCount, mode: 'person' };
          itemsUpdated++;
        }
      }

      newSubtotal = addDecimals(newSubtotal, updatedAmount);

      if (
        !updatedAmount.equals(toDecimal(item.amount)) ||
        !updatedQuantity.equals(toDecimal(item.quantity)) ||
        updatedDesc !== item.description
      ) {
        await tx.billItem.update({
          where: { id: item.id },
          data: {
            quantity: formatDecimal(updatedQuantity),
            amount: formatDecimal(updatedAmount),
            description: updatedDesc,
            metadata: updatedMeta,
          },
        });
      }
    }

    const discountAmount = toDecimal(bill.discountAmount);
    const fineAmount = toDecimal(bill.fineAmount);
    const rawTotal = subDecimals(addDecimals(newSubtotal, fineAmount), discountAmount);
    const newTotalAmount = compareDecimals(rawTotal, '0.00') < 0 ? toDecimal('0.00') : rawTotal;
    const paidAmount = toDecimal(bill.paidAmount);
    const rawOutstanding = subDecimals(newTotalAmount, paidAmount);
    const newOutstandingAmount = compareDecimals(rawOutstanding, '0.00') < 0 ? toDecimal('0.00') : rawOutstanding;

    await tx.bill.update({
      where: { id: bill.id },
      data: {
        subtotal: formatDecimal(newSubtotal),
        totalAmount: formatDecimal(newTotalAmount),
        outstandingAmount: formatDecimal(newOutstandingAmount),
      },
    });

    return {
      recalculated: true,
      billId: bill.id,
      billNumber: bill.billNumber,
      prevPeopleCount,
      newPeopleCount,
      oldTotalAmount: formatDecimal(bill.totalAmount),
      newTotalAmount: formatDecimal(newTotalAmount),
      prevTotalAmount: formatDecimal(bill.totalAmount),
      prevTotal: formatDecimal(bill.totalAmount),
      newTotal: formatDecimal(newTotalAmount),
      itemsUpdated,
    };
  }

  /**
   * Atomically adds a co-occupant, reconciles cycle snapshot, recalculates unpaid bill,
   * creates outbox event, and records audit log.
   */
  public async addTenantCoOccupant(
    dormitoryId: string,
    tenantId: string,
    data: AddCoOccupantInput,
    actor: { userId?: string; isTenant?: boolean }
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      // Find active contract to lock by room
      const contract = await tx.contract.findFirst({
        where: {
          dormitoryId,
          tenantId,
          status: { in: ['active', 'expiring_soon', 'pending_signature', 'waiting_extension', 'checking_out'] },
          deletedAt: null,
        },
        include: { room: true },
      });

      // PostgreSQL transactional advisory lock to guarantee serialized concurrency
      if (contract?.roomId) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${dormitoryId + ':' + contract.roomId}))`;
      } else {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${dormitoryId + ':' + tenantId}))`;
      }

      // 1. Verify Tenant exists in this dormitory
      const tenant = await tx.tenant.findFirst({
        where: { id: tenantId, dormitoryId, deletedAt: null },
      });

      if (!tenant) {
        const err = new Error('ไม่พบข้อมูลผู้เช่า');
        (err as any).statusCode = 404;
        (err as any).code = 'TENANT_NOT_FOUND';
        throw err;
      }

      const prevHouseholdCount = await this.getHouseholdCount(dormitoryId, tenantId, tx);

      // 2. Insert CoOccupant
      const coOccupant = await tx.tenantCoOccupant.create({
        data: {
          dormitoryId,
          tenantId,
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

      // 3. Find active/current billing cycle (contextually overlapping or current)
      const activeCycle = await this.resolveCurrentBillingCycle(dormitoryId, tx);

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

        // Check authoritative current bill
        const currentBill = await tx.bill.findFirst({
          where: {
            dormitoryId,
            billingCycleId: activeCycle.id,
            roomId: contract.roomId,
            status: { notIn: ['cancelled', 'voided', 'withdrawn', 'superseded'] },
            cancelledAt: null,
          },
          orderBy: { createdAt: 'desc' },
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

      // 4. Create Outbox Event
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

      // PostgreSQL transactional advisory lock
      if (contract?.roomId) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${dormitoryId + ':' + contract.roomId}))`;
      } else {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${dormitoryId + ':' + tenantId}))`;
      }

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

      // Find active/current billing cycle (contextually overlapping or current)
      const activeCycle = await this.resolveCurrentBillingCycle(dormitoryId, tx);

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

        // Check authoritative current bill
        const currentBill = await tx.bill.findFirst({
          where: {
            dormitoryId,
            billingCycleId: activeCycle.id,
            roomId: contract.roomId,
            status: { notIn: ['cancelled', 'voided', 'withdrawn', 'superseded'] },
            cancelledAt: null,
          },
          orderBy: { createdAt: 'desc' },
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
   * If current cycle is PAID / locked: leaves current snapshot & bill strictly immutable,
   * applies to next cycle snapshot.
   */
  public async correctMeterCyclePeopleCount(
    dormitoryId: string,
    billingCycleId: string,
    roomId: string,
    newPeopleCount: number,
    userId?: string
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      // PostgreSQL transactional advisory lock
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${dormitoryId + ':' + roomId}))`;

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

      // Check authoritative current bill
      const currentBill = await tx.bill.findFirst({
        where: {
          dormitoryId,
          billingCycleId,
          roomId,
          status: { notIn: ['cancelled', 'voided', 'withdrawn', 'superseded'] },
          cancelledAt: null,
        },
        orderBy: { createdAt: 'desc' },
      });

      const isPaidOrLocked = currentBill && !isBillRecalculatable(currentBill);

      const targetCycle = await tx.billingCycle.findUnique({
        where: { id: billingCycleId },
      });

      const activeContract = await tx.contract.findFirst({
        where: {
          dormitoryId,
          roomId,
          status: { in: ['active', 'expiring_soon', 'pending_signature', 'waiting_extension', 'checking_out'] },
          deletedAt: null,
        },
      });

      if (isPaidOrLocked) {
        // PAID / FINANCIALLY LOCKED:
        // Current cycle bill and RoomBillingCycleSnapshot remain STRICTLY IMMUTABLE!
        // Apply correction to the next billing cycle if it exists
        const nextCycle = targetCycle
          ? await tx.billingCycle.findFirst({
              where: {
                dormitoryId,
                status: { notIn: ['completed'] },
                periodStart: { gt: targetCycle.periodStart },
              },
              orderBy: { periodStart: 'asc' },
            })
          : null;

        if (nextCycle) {
          await tx.roomBillingCycleSnapshot.upsert({
            where: {
              dormitory_billing_cycle_room_unique: {
                dormitoryId,
                billingCycleId: nextCycle.id,
                roomId,
              },
            },
            create: {
              dormitoryId,
              billingCycleId: nextCycle.id,
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
        }

        if (activeContract && prevPeopleCount !== newPeopleCount) {
          await this.outboxService.createOutboxEvent(tx, {
            dormitoryId,
            eventType: 'CO_OCCUPANT_UPDATED',
            aggregateType: 'ROOM',
            aggregateId: roomId,
            recipientType: 'TENANT',
            recipientId: activeContract.tenantId,
            title: `งวดปัจจุบันชำระแล้ว - จำนวนคนจะปรับใช้ในงวดถัดไป`,
            body: `เจ้าหน้าที่ได้แก้ไขจำนวนคนสำหรับห้อง ${room.roomNumber} จาก ${prevPeopleCount} เป็น ${newPeopleCount} คน ซึ่งจะมีผลในรอบบิลถัดไป`,
            payload: {
              type: 'METER_PEOPLE_COUNT_CORRECTED',
              roomId,
              prevPeopleCount,
              newPeopleCount,
              billingCycleId,
              recalculated: false,
              appliesToNextCycle: true,
              note: 'การเปลี่ยนแปลงจะมีผลในงวดถัดไป เนื่องจากงวดปัจจุบันชำระแล้ว',
            },
          });
        }

        return {
          appliedToCurrentCycle: false,
          appliesToNextCycle: true,
          reason: 'PAID_OR_LOCKED',
          currentCyclePeopleCount: prevPeopleCount,
          requestedPeopleCount: newPeopleCount,
          peopleCount: prevPeopleCount,
          prevPeopleCount,
          recalculation: {
            recalculated: false,
            reason: 'PAID_OR_LOCKED',
            billId: currentBill.id,
            billNumber: currentBill.billNumber,
            prevPeopleCount,
            newPeopleCount,
            isPaidImmutable: true,
          },
        };
      }

      // Financially unlocked: upsert snapshot on current cycle
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
