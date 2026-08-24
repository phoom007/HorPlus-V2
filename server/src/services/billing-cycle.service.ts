/**
 * @license Apache-2.0
 * BillingCycleService — Production Service Authority (Product Owner Manual UAT Batch 02)
 * Hardened with BillingRateSnapshot Provenance, Optimistic Concurrency, and Forward Propagation.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { getPrismaClient } from '../db/prisma.js';
import {
  IBillingCycleRepository,
  BillingCycleEntity,
  BillingRateSnapshotEntity,
  BillingCycleFilterQuery,
} from '../db/repositories/billing-cycle.repository.js';
import { AuditService } from './audit.service.js';
import { currentCycleResolverService } from './current-cycle-resolver.js';
import { normalizeUtilityBillingMode } from '../utils/billing-mode-normalizer.util.js';
import {
  currentBusinessDateInBangkok,
  toBangkokDateString,
  getAdjacentCycleCode,
} from '../utils/calendar-date.util.js';

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
  expectedVersion: number;
  waterBillingType?: string;
  waterRate?: string;
  electricityBillingType?: string;
  electricityRate?: string;
  commonFee?: string;
  commonFeeMode?: string;
  internetFee?: string;
  internetFeeMode?: string;
  parkingFee?: string;
  parkingFeeMode?: string;
  lateFeeType?: string;
  lateFeeValue?: string;
}

export interface CycleRateSnapshotResult {
  cycle: BillingCycleEntity;
  rateSnapshot: BillingRateSnapshotEntity;
  isLocked: boolean;
  lockReason: string | null;
}

const isUuid = (str?: string | null) =>
  !!str && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

const STRICT_DECIMAL_REGEX = /^\d{1,10}(\.\d{1,2})?$/;

const cleanDec = (val: any, fieldNameOrDflt = 'Monetary field'): string => {
  if (val === undefined || val === null || val === '') {
    if (STRICT_DECIMAL_REGEX.test(String(fieldNameOrDflt))) {
      return new Prisma.Decimal(fieldNameOrDflt).toFixed(2);
    }
    return '0.00';
  }
  const strVal = String(val).trim();
  if (!STRICT_DECIMAL_REGEX.test(strVal)) {
    const err: any = new Error(`${fieldNameOrDflt} must be a valid non-negative decimal string with at most 10 integer digits and 2 decimal places`);
    err.statusCode = 400;
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  try {
    const dec = new Prisma.Decimal(strVal);
    if (dec.isNegative() || !dec.isFinite()) {
      const err: any = new Error(`${fieldNameOrDflt} must be a valid non-negative decimal`);
      err.statusCode = 400;
      err.code = 'VALIDATION_ERROR';
      throw err;
    }
    return dec.toFixed(2);
  } catch (err: any) {
    if (err.statusCode) throw err;
    const validationErr: any = new Error(`${fieldNameOrDflt} must be a valid non-negative decimal`);
    validationErr.statusCode = 400;
    validationErr.code = 'VALIDATION_ERROR';
    throw validationErr;
  }
};

export class BillingCycleService {
  private billingCycleRepo: IBillingCycleRepository;
  private auditService?: AuditService;

  constructor(
    billingCycleRepo: IBillingCycleRepository,
    auditService?: AuditService
  ) {
    this.billingCycleRepo = billingCycleRepo;
    this.auditService = auditService;
  }

  public async createBillingCycle(
    dormitoryId: string,
    data: CreateBillingCycleDto,
    userId?: string
  ): Promise<{ cycle: BillingCycleEntity; rateSnapshot: BillingRateSnapshotEntity }> {
    const prisma = getPrismaClient();

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
            waterBillingType: normalizeUtilityBillingMode(pSnap.waterBillingType),
            waterRate: pSnap.waterRate,
            electricityBillingType: normalizeUtilityBillingMode(pSnap.electricityBillingType),
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
            waterBillingType: normalizeUtilityBillingMode(settings.waterBillingType),
            waterRate: new Prisma.Decimal(settings.waterRate || '0.00').toFixed(2),
            electricityBillingType: normalizeUtilityBillingMode(settings.electricityBillingType),
            electricityRate: new Prisma.Decimal(settings.electricityRate || '0.00').toFixed(2),
            commonFee: new Prisma.Decimal(settings.commonFee || '0.00').toFixed(2),
            commonFeeMode: settings.commonFeeMode || 'room',
            internetFee: new Prisma.Decimal(settings.internetFee || '0.00').toFixed(2),
            internetFeeMode: settings.internetFeeMode || 'room',
            parkingFee: new Prisma.Decimal(settings.parkingRate || '0.00').toFixed(2),
            parkingFeeMode: settings.parkingFeeMode || 'room',
            lateFeeType: settings.lateFeeType || 'none',
            lateFeeValue: new Prisma.Decimal(settings.lateFeeValue || '0.00').toFixed(2),
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

  public async getFirstBillingCycle(dormitoryId: string): Promise<BillingCycleEntity | null> {
    const prisma = getPrismaClient();
    const earliest = await prisma.billingCycle.findFirst({
      where: { dormitoryId },
      orderBy: { periodStart: 'asc' },
    });
    if (!earliest) return null;
    return this.billingCycleRepo.findById(earliest.id, dormitoryId);
  }

  public async isFirstBillingCycle(dormitoryId: string, cycleIdOrCode: string): Promise<boolean> {
    const prisma = getPrismaClient();
    const earliest = await prisma.billingCycle.findFirst({
      where: { dormitoryId },
      orderBy: { periodStart: 'asc' },
    });
    if (!earliest) return false;
    return earliest.id === cycleIdOrCode || earliest.cycleCode === cycleIdOrCode;
  }

  public async getExistingCycleCodes(
    dormitoryId: string,
    cycleCodes: string[]
  ): Promise<string[]> {
    return this.billingCycleRepo.findExistingCycleCodes(dormitoryId, cycleCodes);
  }

  public async getBillingCycles(
    dormitoryId: string,
    filter: BillingCycleFilterQuery = {}
  ): Promise<{ items: (BillingCycleEntity & { isFirstCycle?: boolean })[]; total: number; firstBillingCycleId?: string | null }> {
    const res = await this.billingCycleRepo.findAll(dormitoryId, filter);
    const prisma = getPrismaClient();
    const earliest = await prisma.billingCycle.findFirst({
      where: { dormitoryId },
      orderBy: { periodStart: 'asc' },
    });
    const items = res.items.map((item) => ({
      ...item,
      isFirstCycle: earliest ? earliest.id === item.id : false,
    }));
    return { items, total: res.total, firstBillingCycleId: earliest?.id || null };
  }

  public async getBillingCycleById(
    id: string,
    dormitoryId: string
  ): Promise<{ cycle: BillingCycleEntity & { isFirstCycle?: boolean }; rateSnapshot: BillingRateSnapshotEntity | null; isFirstCycle: boolean }> {
    const cycle = await this.billingCycleRepo.findById(id, dormitoryId);
    if (!cycle) {
      const err = new Error('BILLING_CYCLE_NOT_FOUND');
      (err as any).statusCode = 404;
      (err as any).code = 'BILLING_CYCLE_NOT_FOUND';
      throw err;
    }

    const prisma = getPrismaClient();
    const earliest = await prisma.billingCycle.findFirst({
      where: { dormitoryId },
      orderBy: { periodStart: 'asc' },
    });
    const isFirstCycle = earliest ? earliest.id === cycle.id : false;

    const rateSnapshot = await this.billingCycleRepo.findRateSnapshot(cycle.id, dormitoryId);
    return { cycle: { ...cycle, isFirstCycle }, rateSnapshot, isFirstCycle };
  }

  public async getCycleRateSnapshot(
    dormitoryId: string,
    cycleIdOrCode: string
  ): Promise<CycleRateSnapshotResult> {
    const prisma = getPrismaClient();

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
      // STRICT ALL-ROOM UNISSUED GATE: Rates are editable ONLY IF every room in cycle is still in unissued state
      const nonUnissuedBillsCount = await prisma.bill.count({
        where: {
          dormitoryId,
          billingCycleId: cycle.id,
          status: { notIn: ['draft', 'cancelled', 'voided', 'withdrawn', 'superseded'] },
        },
      });

      if (nonUnissuedBillsCount > 0) {
        isLocked = true;
        lockReason = 'งวดนี้มีห้องพักที่ออกบิลแล้ว จึงไม่สามารถแก้ไขอัตราค่าบริการที่ส่งผลต่อการคำนวณบิลได้';
      } else {
        // Check historical cycle relative to authoritative operational cycle (regardless of cycle.status)
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

    if (data.expectedVersion === undefined || data.expectedVersion === null || typeof data.expectedVersion !== 'number' || data.expectedVersion <= 0) {
      const err: any = new Error('expectedVersion is required and must be a positive integer');
      err.statusCode = 400;
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    const prisma = getPrismaClient();

    // Mode normalizations: 'free' / 'none' enforces fee = '0.00'
    const commonMode = data.commonFeeMode || rateSnapshot.commonFeeMode;
    const commonFee = commonMode === 'free' || commonMode === 'none'
      ? '0.00'
      : (data.commonFee !== undefined ? cleanDec(data.commonFee, 'commonFee') : rateSnapshot.commonFee);

    const internetMode = data.internetFeeMode || rateSnapshot.internetFeeMode;
    const internetFee = internetMode === 'free' || internetMode === 'none'
      ? '0.00'
      : (data.internetFee !== undefined ? cleanDec(data.internetFee, 'internetFee') : rateSnapshot.internetFee);

    const parkingMode = data.parkingFeeMode || rateSnapshot.parkingFeeMode;
    const parkingFee = parkingMode === 'free' || parkingMode === 'none'
      ? '0.00'
      : (data.parkingFee !== undefined ? cleanDec(data.parkingFee, 'parkingFee') : rateSnapshot.parkingFee);

    const waterType = normalizeUtilityBillingMode(data.waterBillingType || rateSnapshot.waterBillingType);
    const waterRate = data.waterRate !== undefined ? cleanDec(data.waterRate, 'waterRate') : rateSnapshot.waterRate;

    const electricityType = normalizeUtilityBillingMode(data.electricityBillingType || rateSnapshot.electricityBillingType);
    const electricityRate = data.electricityRate !== undefined ? cleanDec(data.electricityRate, 'electricityRate') : rateSnapshot.electricityRate;

    const lateType = data.lateFeeType || rateSnapshot.lateFeeType;
    const lateValue = lateType === 'none'
      ? '0.00'
      : (data.lateFeeValue !== undefined ? cleanDec(data.lateFeeValue, 'lateFeeValue') : rateSnapshot.lateFeeValue);

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
      // 0. Transactional race-safe verification: ensure no room in cycle has progressed beyond unissued
      const nonUnissuedCount = await tx.bill.count({
        where: {
          dormitoryId,
          billingCycleId: cycle.id,
          status: { notIn: ['draft', 'cancelled', 'voided', 'withdrawn', 'superseded'] },
        },
      });
      if (nonUnissuedCount > 0) {
        const err: any = new Error('BILLING_CYCLE_RATE_SETTINGS_LOCKED: งวดนี้มีห้องพักที่ออกบิลแล้ว จึงไม่สามารถแก้ไขอัตราค่าบริการได้');
        err.statusCode = 409;
        err.code = 'BILLING_CYCLE_RATE_SETTINGS_LOCKED';
        throw err;
      }

      // 1. Atomic update of target snapshot with OCC version match
      const updateResult = await tx.billingRateSnapshot.updateMany({
        where: {
          id: rateSnapshot.id,
          dormitoryId,
          version: data.expectedVersion,
        },
        data: {
          ...effectiveUpdate,
          source: 'MANUAL_OVERRIDE',
          inheritedFromBillingCycleId: null,
          updatedByUserId: userId || null,
          version: { increment: 1 },
          updatedAt: new Date(),
        },
      });

      if (updateResult.count !== 1) {
        const err: any = new Error('BILLING_RATE_SNAPSHOT_VERSION_CONFLICT');
        err.statusCode = 409;
        err.code = 'BILLING_RATE_SNAPSHOT_VERSION_CONFLICT';
        throw err;
      }

      const updatedSnap = await tx.billingRateSnapshot.findUniqueOrThrow({
        where: { id: rateSnapshot.id },
      });

      // 2. Recalculate any unpaid bills in current editable cycle using authoritative peopleCount
      const unpaidBills = await tx.bill.findMany({
        where: {
          dormitoryId,
          billingCycleId: cycle.id,
          status: { notIn: ['paid', 'partially_paid', 'cancelled', 'voided', 'withdrawn', 'superseded'] },
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
          const currentPeopleCount = await orchestration.resolveCyclePeopleCount(
            dormitoryId,
            cycle.id,
            b.roomId,
            null,
            tx as any
          );
          await orchestration.recalculateUnpaidBill(
            dormitoryId,
            cycle.id,
            b.roomId,
            currentPeopleCount,
            currentPeopleCount,
            tx as any
          );
        }
      }

      // 3. Forward Propagation to subsequent INHERITED and eligible legacy TEMPLATE_DEFAULT cycles
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

        // Stop propagation if future cycle is locked, completed, or has paid bills
        const fcPaidCount = await tx.bill.count({
          where: { dormitoryId, billingCycleId: fc.id, status: 'paid' },
        });
        if (fc.status === 'locked' || fc.status === 'completed' || fcPaidCount > 0) {
          break;
        }

        // Forward propagation traverses INHERITED or eligible legacy TEMPLATE_DEFAULT snapshots
        if (fc.rateSnapshot.source === 'INHERITED' || fc.rateSnapshot.source === 'TEMPLATE_DEFAULT') {
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
    const prisma = getPrismaClient();
    const dorm = await prisma.dormitory.findUnique({
      where: { id: dormitoryId },
      include: { billingSettings: true },
    });

    if (!dorm || !dorm.billingSettings) return [];

    const todayBangkok = currentBusinessDateInBangkok();
    const currentCalCode = todayBangkok.slice(0, 7); // 'YYYY-MM'

    // Resolve operational billing cycle for dormitory
    const operational = await currentCycleResolverService.resolveOperationalBillingCycle(dormitoryId);
    const opCode = operational.cycleCode || currentCalCode;

    const targetCycles: string[] = [];

    // 1. Ensure 3-month rolling window around operational cycle (prev, curr, next)
    const opPrev = getAdjacentCycleCode(opCode, -1);
    const opCurr = opCode;
    const opNext = getAdjacentCycleCode(opCode, 1);
    [opPrev, opCurr, opNext].forEach((c) => {
      if (!targetCycles.includes(c)) targetCycles.push(c);
    });

    // 2. Ensure 3-month rolling window around current calendar Bangkok month (prev, curr, next)
    const calPrev = getAdjacentCycleCode(currentCalCode, -1);
    const calCurr = currentCalCode;
    const calNext = getAdjacentCycleCode(currentCalCode, 1);
    [calPrev, calCurr, calNext].forEach((c) => {
      if (!targetCycles.includes(c)) targetCycles.push(c);
    });

    // 3. Ensure onboarding start month
    const startCode = toBangkokDateString(dorm.createdAt).slice(0, 7);
    if (!targetCycles.includes(startCode)) targetCycles.push(startCode);

    for (const code of targetCycles) {
      try {
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
      } catch (err: any) {
        // If cycle already exists, overlaps with custom cycle, or settings are missing, gracefully proceed
      }
    }

    const res = await this.getBillingCycles(dormitoryId, { pageSize: 50 });
    return res.items;
  }
}
