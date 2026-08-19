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
import { resolveProvisionalBillingSource } from './provisional-billing-source.service.js';
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

    const targetCycle = await client.billingCycle.findUnique({
      where: { id: billingCycleId },
    });

    let seedCount = 1;
    let seedSource = 'HOUSEHOLD_SYNC';

    // 1. Check pending Owner next-cycle correction
    // Must target the immediate EARLIEST future cycle strictly after the source cycle
    const pendingCorrection = await client.roomNextCycleCorrection.findFirst({
      where: {
        dormitoryId,
        roomId,
        consumedAt: null,
      },
      orderBy: { updatedAt: 'desc' },
    });

    let isEligibleNextCycle = false;
    if (pendingCorrection && targetCycle) {
      let sourcePeriodStart: Date | null = pendingCorrection.effectiveAfterPeriodStart;
      if (!sourcePeriodStart && pendingCorrection.sourceBillingCycleId) {
        const sourceCycle = await client.billingCycle.findUnique({
          where: { id: pendingCorrection.sourceBillingCycleId },
        });
        if (sourceCycle) {
          sourcePeriodStart = sourceCycle.periodStart;
        }
      }

      if (sourcePeriodStart) {
        // Find the earliest billing cycle strictly after the source cycle
        const earliestFutureCycle = await client.billingCycle.findFirst({
          where: {
            dormitoryId,
            periodStart: { gt: sourcePeriodStart },
          },
          orderBy: { periodStart: 'asc' },
        });

        // The pending correction is eligible ONLY when targetCycle is the immediate earliest future cycle
        if (earliestFutureCycle && earliestFutureCycle.id === targetCycle.id) {
          isEligibleNextCycle = true;
        }
      }
    }

    if (isEligibleNextCycle && pendingCorrection) {
      seedCount = Math.max(0, pendingCorrection.peopleCount);
      seedSource = 'METER_CORRECTION';
      await client.roomNextCycleCorrection.update({
        where: { id: pendingCorrection.id },
        data: { consumedAt: new Date() },
      });
    } else {
      // 2. Resolve from household truth
      let householdCount = 0;
      if (tenantId) {
        householdCount = await this.getHouseholdCount(dormitoryId, tenantId, client);
      } else {
        const activeContract = await client.contract.findFirst({
          where: {
            dormitoryId,
            roomId,
            status: { in: ['active', 'expiring_soon', 'pending_signature', 'waiting_extension', 'checking_out'] },
            deletedAt: null,
          },
        });
        if (activeContract) {
          householdCount = await this.getHouseholdCount(dormitoryId, activeContract.tenantId, client);
        } else {
          // Resolve ACTIVE ProvisionalRentalTerm via shared canonical authority
          const activeProvisional = targetCycle
            ? await resolveProvisionalBillingSource({
                dormitoryId,
                roomId,
                billingCycle: targetCycle,
                tx: client,
              })
            : null;

          if (activeProvisional) {
            householdCount = await this.getHouseholdCount(dormitoryId, activeProvisional.tenantId, client);
          } else {
            householdCount = 0;
          }
        }
      }
      seedCount = householdCount;
      seedSource = 'HOUSEHOLD_SYNC';
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
        source: seedSource,
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

    const items = bill.items;
    let newSubtotal = toDecimal('0.00');
    let itemsUpdated = 0;
    const peopleCountDec = toDecimal(newPeopleCount);

    for (const item of items) {
      let updatedAmount = toDecimal(item.amount);
      let updatedQuantity = toDecimal(item.quantity);
      let updatedDesc = item.description;
      let updatedMeta = item.metadata ? { ...(item.metadata as any) } : {};
      let unitPrice = item.unitPrice ? toDecimal(item.unitPrice) : toDecimal('0.00');

      const itemMetaMode = (item.metadata as any)?.mode;
      const itemMetaBillingType = (item.metadata as any)?.billingType;
      const isPerPersonUnit = item.unit === 'person';
      const isPerPersonMeta = itemMetaMode === 'person' || itemMetaBillingType === 'person';

      let isPerPerson = isPerPersonUnit || isPerPersonMeta;

      if (rateSnapshot) {
        if (item.type === 'common_fee') {
          unitPrice = toDecimal(rateSnapshot.commonFee);
          if (rateSnapshot.commonFeeMode === 'person' || rateSnapshot.commonFeeMode === 'per_person') {
            isPerPerson = true;
          } else if (rateSnapshot.commonFeeMode === 'free' || rateSnapshot.commonFeeMode === 'none') {
            isPerPerson = false;
            unitPrice = toDecimal('0.00');
            updatedQuantity = toDecimal(1);
            updatedAmount = toDecimal('0.00');
            updatedDesc = 'ค่าส่วนกลาง';
            updatedMeta = { ...updatedMeta, mode: 'free' };
          } else {
            isPerPerson = false;
            updatedQuantity = toDecimal(1);
            updatedAmount = unitPrice;
            updatedDesc = 'ค่าส่วนกลาง';
            updatedMeta = { ...updatedMeta, mode: 'room' };
          }
        } else if (item.type === 'internet') {
          unitPrice = toDecimal(rateSnapshot.internetFee);
          if (rateSnapshot.internetFeeMode === 'person' || rateSnapshot.internetFeeMode === 'per_person') {
            isPerPerson = true;
          } else if (rateSnapshot.internetFeeMode === 'free' || rateSnapshot.internetFeeMode === 'none') {
            isPerPerson = false;
            unitPrice = toDecimal('0.00');
            updatedQuantity = toDecimal(1);
            updatedAmount = toDecimal('0.00');
            updatedDesc = 'ค่าบริการอินเทอร์เน็ต';
            updatedMeta = { ...updatedMeta, mode: 'free' };
          } else {
            isPerPerson = false;
            updatedQuantity = toDecimal(1);
            updatedAmount = unitPrice;
            updatedDesc = 'ค่าบริการอินเทอร์เน็ต';
            updatedMeta = { ...updatedMeta, mode: 'room' };
          }
        } else if (item.type === 'parking') {
          unitPrice = toDecimal(rateSnapshot.parkingFee);
          if (rateSnapshot.parkingFeeMode === 'person' || rateSnapshot.parkingFeeMode === 'per_person') {
            isPerPerson = true;
          } else if (rateSnapshot.parkingFeeMode === 'free' || rateSnapshot.parkingFeeMode === 'none') {
            isPerPerson = false;
            unitPrice = toDecimal('0.00');
            updatedQuantity = toDecimal(1);
            updatedAmount = toDecimal('0.00');
            updatedDesc = 'ค่าที่จอดรถ';
            updatedMeta = { ...updatedMeta, mode: 'free' };
          } else {
            isPerPerson = false;
            updatedAmount = mulDecimals(updatedQuantity, unitPrice);
            updatedDesc = 'ค่าที่จอดรถ';
            updatedMeta = { ...updatedMeta, mode: rateSnapshot.parkingFeeMode };
          }
        } else if (item.type === 'water' && (rateSnapshot.waterBillingType === 'person' || rateSnapshot.waterBillingType === 'per_person')) {
          unitPrice = toDecimal(rateSnapshot.waterRate);
          isPerPerson = true;
        } else if (item.type === 'electricity' && (rateSnapshot.electricityBillingType === 'person' || rateSnapshot.electricityBillingType === 'per_person')) {
          unitPrice = toDecimal(rateSnapshot.electricityRate);
          isPerPerson = true;
        }
      }

      if (isPerPerson && item.type !== 'rent') {
        updatedQuantity = peopleCountDec;
        updatedAmount = mulDecimals(peopleCountDec, unitPrice);

        if (item.type === 'water') {
          updatedDesc = `ค่าน้ำประปา (${newPeopleCount} คน)`;
        } else if (item.type === 'electricity') {
          updatedDesc = `ค่าไฟฟ้า (${newPeopleCount} คน)`;
        } else if (item.type === 'common_fee') {
          updatedDesc = `ค่าส่วนกลาง (${newPeopleCount} คน)`;
        } else if (item.type === 'internet') {
          updatedDesc = `ค่าบริการอินเทอร์เน็ต (${newPeopleCount} คน)`;
        } else if (item.type === 'parking') {
          updatedDesc = `ค่าที่จอดรถ (${newPeopleCount} คน)`;
        } else if (item.description.match(/\(\d+\s*คน\)/)) {
          updatedDesc = item.description.replace(/\(\d+\s*คน\)/, `(${newPeopleCount} คน)`);
        }

        updatedMeta = { ...updatedMeta, peopleCount: newPeopleCount, mode: 'person' };
        itemsUpdated++;
      }

      newSubtotal = addDecimals(newSubtotal, updatedAmount);

      if (
        !updatedAmount.equals(toDecimal(item.amount)) ||
        !updatedQuantity.equals(toDecimal(item.quantity)) ||
        (item.unitPrice && !unitPrice.equals(toDecimal(item.unitPrice))) ||
        updatedDesc !== item.description
      ) {
        await tx.billItem.update({
          where: { id: item.id },
          data: {
            unitPrice: formatDecimal(unitPrice),
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

      if (!contract) {
        const activeOccupancy = await tx.occupancy.findFirst({
          where: {
            dormitoryId,
            tenantId,
            status: 'ACTIVE',
          },
        });
        if (!activeOccupancy) {
          const err = new Error('ผู้เช่าไม่มีสัญญาหรือสถานะการพักอาศัยที่เปิดใช้งานอยู่');
          (err as any).code = 'NO_ACTIVE_TENANCY';
          (err as any).statusCode = 403;
          throw err;
        }
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

      if (!contract) {
        const activeOccupancy = await tx.occupancy.findFirst({
          where: {
            dormitoryId,
            tenantId,
            status: 'ACTIVE',
          },
        });
        if (!activeOccupancy) {
          const err = new Error('ผู้เช่าไม่มีสัญญาหรือสถานะการพักอาศัยที่เปิดใช้งานอยู่');
          (err as any).code = 'NO_ACTIVE_TENANCY';
          (err as any).statusCode = 403;
          throw err;
        }
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

      let defaultPeople = 0;
      if (room.currentTenantId) {
        defaultPeople = await this.getHouseholdCount(dormitoryId, room.currentTenantId, tx);
      }
      const prevPeopleCount = existingSnapshot ? existingSnapshot.peopleCount : defaultPeople;

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

        // Always persist pending next-cycle correction with source/effective boundary so future cycles honor it
        await tx.roomNextCycleCorrection.upsert({
          where: {
            dormitory_room_next_cycle_correction_unique: {
              dormitoryId,
              roomId,
            },
          },
          create: {
            dormitoryId,
            roomId,
            peopleCount: newPeopleCount,
            source: 'METER_CORRECTION',
            sourceBillingCycleId: billingCycleId,
            effectiveAfterPeriodStart: targetCycle ? targetCycle.periodStart : new Date(),
            updatedByUserId: userId || null,
            consumedAt: nextCycle ? new Date() : null,
          },
          update: {
            peopleCount: newPeopleCount,
            source: 'METER_CORRECTION',
            sourceBillingCycleId: billingCycleId,
            effectiveAfterPeriodStart: targetCycle ? targetCycle.periodStart : new Date(),
            updatedByUserId: userId || null,
            consumedAt: nextCycle ? new Date() : null,
            updatedAt: new Date(),
          },
        });

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
