/**
 * @license Apache-2.0
 * BillingCycleService — Production Service Authority (Product Owner Manual UAT Batch 02)
 * Hardened with BillingRateSnapshot Provenance, Optimistic Concurrency, and Forward Propagation.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import {
  IBillingCycleRepository,
  BillingCycleEntity,
  BillingRateSnapshotEntity,
  BillingCycleFilterQuery,
} from '../db/repositories/billing-cycle.repository.js';
import { AuditService } from './audit.service.js';
import { currentCycleResolverService } from './current-cycle-resolver.js';

export interface CreateBillingCycleDto {
  cycleCode: string;
  name?: string;
  periodStart: string;
  periodEnd: string;
  billingDate: string;
  dueDate?: string;
  rateSnapshot?: {
    waterBillingType?: string;
    waterRate?: number | string;
    electricityBillingType?: string;
    electricityRate?: number | string;
    commonFee?: number | string;
    commonFeeMode?: string;
    internetFee?: number | string;
    internetFeeMode?: string;
    parkingFee?: number | string;
    parkingFeeMode?: string;
    lateFeeType?: string;
    lateFeeValue?: number | string;
    currency?: string;
    [key: string]: any;
  };
}

export interface UpdateCycleRateSnapshotDto {
  waterBillingType?: string;
  waterRate?: string | number;
  electricityBillingType?: string;
  electricityRate?: string | number;
  commonFee?: string | number;
  commonFeeMode?: string;
  internetFee?: string | number;
  internetFeeMode?: string;
  parkingFee?: string | number;
  parkingFeeMode?: string;
  lateFeeType?: string;
  lateFeeValue?: string | number;
  expectedVersion?: number;
}

export interface CycleRateSnapshotResult {
  cycle: BillingCycleEntity;
  rateSnapshot: BillingRateSnapshotEntity;
  isLocked: boolean;
  lockReason: string | null;
}

const isUuid = (str?: string | null) =>
  !!str && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

const cleanDec = (val: any, dflt = '0.00'): string => {
  if (val === undefined || val === null || val === '') return dflt;
  try {
    return new Prisma.Decimal(val.toString()).toFixed(2);
  } catch {
    return dflt;
  }
};

export class BillingCycleService {
  constructor(
    private billingCycleRepo: IBillingCycleRepository,
    private auditService?: AuditService
  ) {}

  public async createBillingCycle(
    dormitoryId: string,
    data: CreateBillingCycleDto,
    userId?: string
  ): Promise<{ cycle: BillingCycleEntity; rateSnapshot: BillingRateSnapshotEntity }> {
    const prisma = (await import('../db/prisma.js')).getPrismaClient();

    // Invariant: EVERY new BillingCycle creation requires authoritative persisted DormitoryBillingSettings
    const settings = await prisma.dormitoryBillingSettings.findUnique({ where: { dormitoryId } });
    if (!settings) {
      const err = new Error(
        'DORMITORY_BILLING_SETTINGS_REQUIRED: Authoritative dormitory billing settings are required to create a billing cycle'
      );
      (err as any).statusCode = 400;
      (err as any).code = 'DORMITORY_BILLING_SETTINGS_REQUIRED';
      throw err;
    }

    if (settings.dueDay === null || settings.dueDay === undefined || settings.dueDay < 1 || settings.dueDay > 28) {
      const err = new Error('DUE_DAY_REQUIRED: Authoritative billing settings must configure valid dueDay (1-28)');
      (err as any).statusCode = 400;
      (err as any).code = 'DUE_DAY_REQUIRED';
      throw err;
    }

    // Check existing first: existing cycle without snapshot must NOT invent history -> fail closed
    const existing = await this.billingCycleRepo.findByCode(dormitoryId, data.cycleCode);
    if (existing) {
      const snapshot = await this.billingCycleRepo.findRateSnapshot(existing.id, dormitoryId);
      if (!snapshot) {
        const err = new Error('BILLING_RATE_SNAPSHOT_MISSING: Historical cycle is missing its rate snapshot');
        (err as any).statusCode = 404;
        (err as any).code = 'BILLING_RATE_SNAPSHOT_MISSING';
        throw err;
      }
      return { cycle: existing, rateSnapshot: snapshot };
    }

    // Determine periodStart, periodEnd, billingDate, and dueDate
    let pStartStr = data.periodStart;
    let pEndStr = data.periodEnd;
    let bDateStr = data.billingDate;

    const configuredDueDay = settings.dueDay;
    const configuredBillingDay =
      settings.billingDay !== null && settings.billingDay !== undefined ? settings.billingDay : 25;

    const standardCycleMatch = data.cycleCode.match(/^(\d{4})-(\d{2})$/);
    let y: number;
    let m: number;

    if (standardCycleMatch) {
      y = parseInt(standardCycleMatch[1], 10);
      m = parseInt(standardCycleMatch[2], 10);
    } else {
      const refDate = pStartStr ? new Date(pStartStr) : pEndStr ? new Date(pEndStr) : new Date();
      y = refDate.getFullYear();
      m = refDate.getMonth() + 1;
    }

    const lastDay = new Date(y, m, 0).getDate();
    pStartStr = pStartStr || `${y}-${String(m).padStart(2, '0')}-01`;
    pEndStr = pEndStr || `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const bDayClamped = Math.min(configuredBillingDay, lastDay);
    bDateStr = bDateStr || `${y}-${String(m).padStart(2, '0')}-${String(bDayClamped).padStart(2, '0')}`;

    const nextM = m === 12 ? 1 : m + 1;
    const nextY = m === 12 ? y + 1 : y;
    const nextMonthLastDay = new Date(nextY, nextM, 0).getDate();
    const dDayClamped = Math.min(configuredDueDay, nextMonthLastDay);
    const dDateStr = `${nextY}-${String(nextM).padStart(2, '0')}-${String(dDayClamped).padStart(2, '0')}`;

    const periodStart = new Date(pStartStr);
    const periodEnd = new Date(pEndStr);
    if (periodStart > periodEnd) {
      const err = new Error('INVALID_PERIOD_DATES');
      (err as any).statusCode = 400;
      (err as any).code = 'INVALID_PERIOD_DATES';
      throw err;
    }

    const overlapping = await this.billingCycleRepo.findOverlapping(dormitoryId, periodStart, periodEnd);
    if (overlapping.length > 0) {
      const err = new Error('OVERLAPPING_BILLING_CYCLE');
      (err as any).statusCode = 409;
      (err as any).code = 'OVERLAPPING_BILLING_CYCLE';
      throw err;
    }

    try {
      // Execute cycle + rate snapshot creation in single transaction
      const result = await prisma.$transaction(async (tx) => {
        // Find preceding cycle to inherit from
        const precedingCycle = await tx.billingCycle.findFirst({
          where: {
            dormitoryId,
            periodStart: { lt: periodStart },
          },
          orderBy: { periodStart: 'desc' },
          include: { rateSnapshot: true },
        });

        let snapshotData: any;
        if (precedingCycle?.rateSnapshot) {
          const pSnap = precedingCycle.rateSnapshot;
          snapshotData = {
            waterBillingType: pSnap.waterBillingType,
            waterRate: pSnap.waterRate,
            electricityBillingType: pSnap.electricityBillingType,
            electricityRate: pSnap.electricityRate,
            commonFee: pSnap.commonFee,
            commonFeeMode: pSnap.commonFeeMode,
            internetFee: pSnap.internetFee,
            internetFeeMode: pSnap.internetFeeMode,
            parkingFee: pSnap.parkingFee,
            parkingFeeMode: pSnap.parkingFeeMode,
            lateFeeType: pSnap.lateFeeType,
            lateFeeValue: pSnap.lateFeeValue,
            currency: pSnap.currency || 'THB',
            source: 'INHERITED',
            inheritedFromBillingCycleId: precedingCycle.id,
            updatedByUserId: null,
            version: 1,
          };
        } else {
          snapshotData = {
            waterBillingType: settings.waterBillingType,
            waterRate: new Prisma.Decimal(settings.waterRate).toFixed(2),
            electricityBillingType: settings.electricityBillingType,
            electricityRate: new Prisma.Decimal(settings.electricityRate).toFixed(2),
            commonFee: new Prisma.Decimal(settings.commonFee).toFixed(2),
            commonFeeMode: settings.commonFeeMode,
            internetFee: new Prisma.Decimal(settings.internetFee).toFixed(2),
            internetFeeMode: settings.internetFeeMode,
            parkingFee: new Prisma.Decimal(settings.parkingRate).toFixed(2),
            parkingFeeMode: settings.parkingFeeMode,
            lateFeeType: settings.lateFeeType,
            lateFeeValue: new Prisma.Decimal(settings.lateFeeValue).toFixed(2),
            currency: 'THB',
            source: 'TEMPLATE_DEFAULT',
            inheritedFromBillingCycleId: null,
            updatedByUserId: null,
            version: 1,
          };
        }

        const cycle = await tx.billingCycle.create({
          data: {
            dormitoryId,
            cycleCode: data.cycleCode,
            name: data.name || data.cycleCode,
            periodStart,
            periodEnd,
            billingDate: new Date(bDateStr || pStartStr),
            dueDate: new Date(dDateStr || pEndStr),
            status: 'draft',
            createdByUserId: userId,
          },
        });

        const rateSnapshot = await tx.billingRateSnapshot.create({
          data: {
            dormitoryId,
            billingCycleId: cycle.id,
            ...snapshotData,
          },
        });

        return { cycle, rateSnapshot };
      });

      if (this.auditService) {
        await this.auditService.log({
          dormitoryId,
          actorUserId: userId || 'system',
          action: 'billing_cycle.create',
          resourceType: 'billing_cycle',
          resourceId: result.cycle.id,
          details: { cycleCode: result.cycle.cycleCode, name: result.cycle.name },
        });
      }

      return {
        cycle: {
          id: result.cycle.id,
          dormitoryId: result.cycle.dormitoryId,
          cycleCode: result.cycle.cycleCode,
          name: result.cycle.name,
          periodStart: result.cycle.periodStart,
          periodEnd: result.cycle.periodEnd,
          billingDate: result.cycle.billingDate,
          dueDate: result.cycle.dueDate,
          status: result.cycle.status,
          version: result.cycle.version,
          createdAt: result.cycle.createdAt,
          updatedAt: result.cycle.updatedAt,
        },
        rateSnapshot: {
          id: result.rateSnapshot.id,
          dormitoryId: result.rateSnapshot.dormitoryId,
          billingCycleId: result.rateSnapshot.billingCycleId,
          waterBillingType: result.rateSnapshot.waterBillingType,
          waterRate: new Prisma.Decimal(result.rateSnapshot.waterRate).toFixed(2),
          electricityBillingType: result.rateSnapshot.electricityBillingType,
          electricityRate: new Prisma.Decimal(result.rateSnapshot.electricityRate).toFixed(2),
          commonFee: new Prisma.Decimal(result.rateSnapshot.commonFee).toFixed(2),
          commonFeeMode: result.rateSnapshot.commonFeeMode,
          internetFee: new Prisma.Decimal(result.rateSnapshot.internetFee).toFixed(2),
          internetFeeMode: result.rateSnapshot.internetFeeMode,
          parkingFee: new Prisma.Decimal(result.rateSnapshot.parkingFee).toFixed(2),
          parkingFeeMode: result.rateSnapshot.parkingFeeMode,
          lateFeeType: result.rateSnapshot.lateFeeType,
          lateFeeValue: new Prisma.Decimal(result.rateSnapshot.lateFeeValue).toFixed(2),
          currency: result.rateSnapshot.currency,
          source: result.rateSnapshot.source,
          inheritedFromBillingCycleId: result.rateSnapshot.inheritedFromBillingCycleId,
          updatedByUserId: result.rateSnapshot.updatedByUserId,
          version: result.rateSnapshot.version,
          createdAt: result.rateSnapshot.createdAt,
          updatedAt: result.rateSnapshot.updatedAt,
        },
      };
    } catch (err: any) {
      if (err.code === 'P2002' || (err.message && err.message.includes('unique'))) {
        const raceExisting = await this.billingCycleRepo.findByCode(dormitoryId, data.cycleCode);
        if (raceExisting) {
          const snapshot = await this.billingCycleRepo.findRateSnapshot(raceExisting.id, dormitoryId);
          if (!snapshot) {
            const err2 = new Error('BILLING_RATE_SNAPSHOT_MISSING: Historical cycle is missing its rate snapshot');
            (err2 as any).statusCode = 404;
            (err2 as any).code = 'BILLING_RATE_SNAPSHOT_MISSING';
            throw err2;
          }
          return { cycle: raceExisting, rateSnapshot: snapshot };
        }
      }
      throw err;
    }
  }

  public async getBillingCycles(
    dormitoryId: string,
    filter: BillingCycleFilterQuery = {}
  ): Promise<{ items: BillingCycleEntity[]; total: number }> {
    return this.billingCycleRepo.findAll(dormitoryId, filter);
  }

  public async getBillingCycleById(
    id: string,
    dormitoryId: string
  ): Promise<{ cycle: BillingCycleEntity; rateSnapshot: BillingRateSnapshotEntity | null }> {
    const cycle = await this.billingCycleRepo.findById(id, dormitoryId);
    if (!cycle) {
      const err = new Error('BILLING_CYCLE_NOT_FOUND');
      (err as any).statusCode = 404;
      (err as any).code = 'BILLING_CYCLE_NOT_FOUND';
      throw err;
    }

    const rateSnapshot = await this.billingCycleRepo.findRateSnapshot(cycle.id, dormitoryId);
    return { cycle, rateSnapshot };
  }

  public async getCycleRateSnapshot(
    dormitoryId: string,
    cycleIdOrCode: string
  ): Promise<CycleRateSnapshotResult> {
    const prisma = (await import('../db/prisma.js')).getPrismaClient();

    let cycle: BillingCycleEntity | null = null;
    if (isUuid(cycleIdOrCode)) {
      cycle = await this.billingCycleRepo.findById(cycleIdOrCode, dormitoryId);
    }
    if (!cycle) {
      cycle = await this.billingCycleRepo.findByCode(dormitoryId, cycleIdOrCode);
    }

    if (!cycle) {
      const err = new Error('BILLING_CYCLE_NOT_FOUND');
      (err as any).statusCode = 404;
      (err as any).code = 'BILLING_CYCLE_NOT_FOUND';
      throw err;
    }

    const rateSnapshot = await this.billingCycleRepo.findRateSnapshot(cycle.id, dormitoryId);
    if (!rateSnapshot) {
      const err = new Error('BILLING_RATE_SNAPSHOT_MISSING: Cycle is missing its rate snapshot');
      (err as any).statusCode = 404;
      (err as any).code = 'BILLING_RATE_SNAPSHOT_MISSING';
      throw err;
    }

    // Determine isLocked & lockReason
    let isLocked = false;
    let lockReason: string | null = null;

    if (cycle.status === 'locked' || cycle.status === 'completed') {
      isLocked = true;
      lockReason = 'งวดนี้ถูกล็อคแล้ว จึงไม่สามารถแก้ไขค่าที่มีผลต่อบิลได้';
    } else {
      // Check paid bills in cycle
      const paidBillsCount = await prisma.bill.count({
        where: {
          dormitoryId,
          billingCycleId: cycle.id,
          status: 'paid',
        },
      });

      if (paidBillsCount > 0) {
        isLocked = true;
        lockReason = 'งวดนี้มีรายการชำระเงินแล้ว จึงไม่สามารถแก้ไขค่าที่มีผลต่อบิลย้อนหลังได้';
      } else {
        // Check historical cycle relative to operational cycle
        const operational = await currentCycleResolverService.resolveOperationalBillingCycle(dormitoryId);
        if (operational.billingCycleId && operational.billingCycleId !== cycle.id) {
          const opCycle = await prisma.billingCycle.findUnique({ where: { id: operational.billingCycleId } });
          if (opCycle && cycle.periodStart < opCycle.periodStart) {
            isLocked = true;
            lockReason = 'งวดนี้เป็นงวดในอดีตที่ปิดรอบการดำเนินงานแล้ว';
          }
        }
      }
    }

    return {
      cycle,
      rateSnapshot,
      isLocked,
      lockReason,
    };
  }

  public async updateCycleRateSnapshot(
    dormitoryId: string,
    cycleIdOrCode: string,
    data: UpdateCycleRateSnapshotDto,
    userId?: string
  ): Promise<{
    cycle: BillingCycleEntity;
    rateSnapshot: BillingRateSnapshotEntity;
    propagatedCount: number;
    isLocked: boolean;
  }> {
    const { cycle, rateSnapshot, isLocked, lockReason } = await this.getCycleRateSnapshot(dormitoryId, cycleIdOrCode);

    if (isLocked) {
      const err = new Error(
        lockReason || 'BILLING_CYCLE_RATE_SETTINGS_LOCKED: Cannot edit rate settings of locked cycle'
      );
      (err as any).statusCode = 400;
      (err as any).code = 'BILLING_CYCLE_RATE_SETTINGS_LOCKED';
      throw err;
    }

    if (data.expectedVersion !== undefined && rateSnapshot.version !== data.expectedVersion) {
      const err = new Error('BILLING_RATE_SNAPSHOT_VERSION_CONFLICT');
      (err as any).statusCode = 409;
      (err as any).code = 'BILLING_RATE_SNAPSHOT_VERSION_CONFLICT';
      throw err;
    }

    const prisma = (await import('../db/prisma.js')).getPrismaClient();

    // Mode normalizations: 'free' / 'none' enforces fee = '0.00'
    const commonMode = data.commonFeeMode || rateSnapshot.commonFeeMode;
    const commonFee = commonMode === 'free' || commonMode === 'none'
      ? '0.00'
      : (data.commonFee !== undefined ? cleanDec(data.commonFee) : rateSnapshot.commonFee);

    const internetMode = data.internetFeeMode || rateSnapshot.internetFeeMode;
    const internetFee = internetMode === 'free' || internetMode === 'none'
      ? '0.00'
      : (data.internetFee !== undefined ? cleanDec(data.internetFee) : rateSnapshot.internetFee);

    const parkingMode = data.parkingFeeMode || rateSnapshot.parkingFeeMode;
    const parkingFee = parkingMode === 'free' || parkingMode === 'none'
      ? '0.00'
      : (data.parkingFee !== undefined ? cleanDec(data.parkingFee) : rateSnapshot.parkingFee);

    const waterType = data.waterBillingType || rateSnapshot.waterBillingType;
    const waterRate = data.waterRate !== undefined ? cleanDec(data.waterRate) : rateSnapshot.waterRate;

    const electricityType = data.electricityBillingType || rateSnapshot.electricityBillingType;
    const electricityRate = data.electricityRate !== undefined ? cleanDec(data.electricityRate) : rateSnapshot.electricityRate;

    const lateType = data.lateFeeType || rateSnapshot.lateFeeType;
    const lateValue = data.lateFeeValue !== undefined ? cleanDec(data.lateFeeValue) : rateSnapshot.lateFeeValue;

    const effectiveUpdate = {
      waterBillingType: waterType,
      waterRate,
      electricityBillingType: electricityType,
      electricityRate,
      commonFee,
      commonFeeMode: commonMode,
      internetFee,
      internetFeeMode: internetMode,
      parkingFee,
      parkingFeeMode: parkingMode,
      lateFeeType: lateType,
      lateFeeValue: lateValue,
    };

    const txResult = await prisma.$transaction(async (tx) => {
      // 1. Update target snapshot with MANUAL_OVERRIDE
      const updatedSnap = await tx.billingRateSnapshot.update({
        where: { id: rateSnapshot.id },
        data: {
          ...effectiveUpdate,
          source: 'MANUAL_OVERRIDE',
          inheritedFromBillingCycleId: null,
          updatedByUserId: userId || null,
          version: { increment: 1 },
          updatedAt: new Date(),
        },
      });

      // 2. Recalculate any unpaid bills in current editable cycle
      const unpaidBills = await tx.bill.findMany({
        where: {
          dormitoryId,
          billingCycleId: cycle.id,
          status: { notIn: ['paid', 'cancelled', 'voided', 'withdrawn', 'superseded'] },
          cancelledAt: null,
        },
        include: { room: true },
      });

      if (unpaidBills.length > 0) {
        const { BillingOrchestrationService } = await import('./billing-orchestration.service.js');
        const { OutboxService } = await import('./outbox.service.js');

        const orchestration = new BillingOrchestrationService(
          tx as any,
          new OutboxService(),
          this.auditService
        );

        for (const b of unpaidBills) {
          await orchestration.recalculateUnpaidBill(dormitoryId, cycle.id, b.roomId, 1, 1, tx);
        }
      }

      // 3. Forward Propagation to subsequent INHERITED cycles
      const futureCycles = await tx.billingCycle.findMany({
        where: {
          dormitoryId,
          periodStart: { gt: cycle.periodStart },
        },
        orderBy: { periodStart: 'asc' },
        include: { rateSnapshot: true },
      });

      let propagatedCount = 0;
      let currentSourceCycleId = cycle.id;

      for (const fc of futureCycles) {
        if (!fc.rateSnapshot) continue;

        // Stop propagation upon encountering an explicit manual override
        if (fc.rateSnapshot.source === 'MANUAL_OVERRIDE') {
          break;
        }

        if (fc.rateSnapshot.source === 'INHERITED') {
          // Stop propagation if future cycle is locked or has paid bills
          const fcPaidCount = await tx.bill.count({
            where: { dormitoryId, billingCycleId: fc.id, status: 'paid' },
          });
          if (fc.status === 'locked' || fc.status === 'completed' || fcPaidCount > 0) {
            break;
          }

          await tx.billingRateSnapshot.update({
            where: { id: fc.rateSnapshot.id },
            data: {
              ...effectiveUpdate,
              source: 'INHERITED',
              inheritedFromBillingCycleId: currentSourceCycleId,
              updatedByUserId: null,
              version: { increment: 1 },
              updatedAt: new Date(),
            },
          });

          propagatedCount++;
          currentSourceCycleId = fc.id;
        }
      }

      return {
        updatedSnapshot: updatedSnap,
        propagatedCount,
      };
    });

    if (this.auditService) {
      await this.auditService.log({
        dormitoryId,
        actorUserId: userId || 'system',
        action: 'billing_cycle.rate_snapshot_override',
        resourceType: 'billing_rate_snapshot',
        resourceId: txResult.updatedSnapshot.id,
        details: {
          cycleCode: cycle.cycleCode,
          propagatedCount: txResult.propagatedCount,
          effectiveUpdate,
        },
      });
    }

    const mappedSnapshot: BillingRateSnapshotEntity = {
      id: txResult.updatedSnapshot.id,
      dormitoryId: txResult.updatedSnapshot.dormitoryId,
      billingCycleId: txResult.updatedSnapshot.billingCycleId,
      waterBillingType: txResult.updatedSnapshot.waterBillingType,
      waterRate: new Prisma.Decimal(txResult.updatedSnapshot.waterRate).toFixed(2),
      electricityBillingType: txResult.updatedSnapshot.electricityBillingType,
      electricityRate: new Prisma.Decimal(txResult.updatedSnapshot.electricityRate).toFixed(2),
      commonFee: new Prisma.Decimal(txResult.updatedSnapshot.commonFee).toFixed(2),
      commonFeeMode: txResult.updatedSnapshot.commonFeeMode,
      internetFee: new Prisma.Decimal(txResult.updatedSnapshot.internetFee).toFixed(2),
      internetFeeMode: txResult.updatedSnapshot.internetFeeMode,
      parkingFee: new Prisma.Decimal(txResult.updatedSnapshot.parkingFee).toFixed(2),
      parkingFeeMode: txResult.updatedSnapshot.parkingFeeMode,
      lateFeeType: txResult.updatedSnapshot.lateFeeType,
      lateFeeValue: new Prisma.Decimal(txResult.updatedSnapshot.lateFeeValue).toFixed(2),
      currency: txResult.updatedSnapshot.currency,
      source: txResult.updatedSnapshot.source,
      inheritedFromBillingCycleId: txResult.updatedSnapshot.inheritedFromBillingCycleId,
      updatedByUserId: txResult.updatedSnapshot.updatedByUserId,
      version: txResult.updatedSnapshot.version,
      createdAt: txResult.updatedSnapshot.createdAt,
      updatedAt: txResult.updatedSnapshot.updatedAt,
    };

    return {
      cycle,
      rateSnapshot: mappedSnapshot,
      propagatedCount: txResult.propagatedCount,
      isLocked: false,
    };
  }

  public async updateBillingCycle(
    id: string,
    dormitoryId: string,
    data: Partial<CreateBillingCycleDto> & { version?: number },
    userId?: string
  ): Promise<BillingCycleEntity> {
    const { cycle } = await this.getBillingCycleById(id, dormitoryId);
    if (cycle.status === 'locked' || cycle.status === 'completed') {
      const err = new Error('BILLING_CYCLE_LOCKED');
      (err as any).statusCode = 400;
      (err as any).code = 'BILLING_CYCLE_LOCKED';
      throw err;
    }

    const updateData: Partial<BillingCycleEntity> = {};
    if (data.name) updateData.name = data.name;
    if (data.periodStart) updateData.periodStart = new Date(data.periodStart);
    if (data.periodEnd) updateData.periodEnd = new Date(data.periodEnd);
    if (data.billingDate) updateData.billingDate = new Date(data.billingDate);
    if (data.dueDate) updateData.dueDate = new Date(data.dueDate);

    const updated = await this.billingCycleRepo.update(id, dormitoryId, updateData, data.version);
    if (!updated) {
      const err = new Error('BILLING_CYCLE_NOT_FOUND');
      (err as any).statusCode = 404;
      (err as any).code = 'BILLING_CYCLE_NOT_FOUND';
      throw err;
    }

    if (this.auditService) {
      await this.auditService.log({
        dormitoryId,
        actorUserId: userId || 'system',
        action: 'billing_cycle.update',
        resourceType: 'billing_cycle',
        resourceId: id,
        details: { updateData },
      });
    }

    return updated;
  }

  public async lockBillingCycle(id: string, dormitoryId: string, userId?: string): Promise<BillingCycleEntity> {
    const { cycle } = await this.getBillingCycleById(id, dormitoryId);
    const updated = await this.billingCycleRepo.update(
      id,
      dormitoryId,
      { status: 'locked', lockedAt: new Date() },
      cycle.version
    );
    if (!updated) {
      const err = new Error('BILLING_CYCLE_NOT_FOUND');
      (err as any).statusCode = 404;
      (err as any).code = 'BILLING_CYCLE_NOT_FOUND';
      throw err;
    }

    if (this.auditService) {
      await this.auditService.log({
        dormitoryId,
        actorUserId: userId || 'system',
        action: 'billing_cycle.lock',
        resourceType: 'billing_cycle',
        resourceId: id,
        details: { status: 'locked' },
      });
    }

    return updated;
  }

  public async ensureRollingBillingCycles(dormitoryId: string, userId?: string): Promise<BillingCycleEntity[]> {
    const prisma = (await import('../db/prisma.js')).getPrismaClient();
    const dorm = await prisma.dormitory.findUnique({
      where: { id: dormitoryId },
      include: { billingSettings: true },
    });

    if (!dorm) return [];

    const now = new Date();
    const startYear = dorm.createdAt.getFullYear();
    const startMonth = dorm.createdAt.getMonth() + 1;

    // Ensure cycles for onboarding month + next 2 future months (rolling window of 3 months)
    const targetCycles: string[] = [];
    for (let offset = 0; offset <= 2; offset++) {
      let curM = startMonth + offset;
      let curY = startYear;
      while (curM > 12) {
        curM -= 12;
        curY += 1;
      }
      targetCycles.push(`${curY}-${String(curM).padStart(2, '0')}`);
    }

    // Also include up to current calendar month + 1
    const currentCalY = now.getFullYear();
    const currentCalM = now.getMonth() + 1;
    const nextCalM = currentCalM === 12 ? 1 : currentCalM + 1;
    const nextCalY = currentCalM === 12 ? currentCalY + 1 : currentCalY;
    const currentCalCode = `${currentCalY}-${String(currentCalM).padStart(2, '0')}`;
    const nextCalCode = `${nextCalY}-${String(nextCalM).padStart(2, '0')}`;

    if (!targetCycles.includes(currentCalCode)) targetCycles.push(currentCalCode);
    if (!targetCycles.includes(nextCalCode)) targetCycles.push(nextCalCode);

    for (const code of targetCycles) {
      await this.createBillingCycle(
        dormitoryId,
        {
          cycleCode: code,
          name: code,
          periodStart: '',
          periodEnd: '',
          billingDate: '',
          dueDate: '',
        },
        userId
      );
    }

    const res = await this.getBillingCycles(dormitoryId, { pageSize: 50 });
    return res.items;
  }
}
