import {
  IBillingCycleRepository,
  BillingCycleEntity,
  BillingRateSnapshotEntity,
  BillingCycleFilterQuery,
} from '../db/repositories/billing-cycle.repository.js';
import { AuditService } from './audit.service.js';

export interface CreateBillingCycleDto {
  cycleCode: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  billingDate: string;
  dueDate: string;
  rateSnapshot?: {
    waterBillingType?: string;
    waterRate?: string;
    electricityBillingType?: string;
    electricityRate?: string;
    commonFee?: string;
    internetFee?: string;
    lateFeeType?: string;
    lateFeeValue?: string;
    currency?: string;
  };
}

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

    // Check existing first
    const existing = await this.billingCycleRepo.findByCode(dormitoryId, data.cycleCode);
    if (existing) {
      let snapshot = await this.billingCycleRepo.findRateSnapshot(existing.id, dormitoryId);
      if (!snapshot) {
        // Guarantee rateSnapshot is non-null even if concurrent race created cycle without snapshot
        const settings = await prisma.dormitoryBillingSettings.findUnique({ where: { dormitoryId } });
        snapshot = await this.billingCycleRepo.createRateSnapshot(dormitoryId, {
          billingCycleId: existing.id,
          waterBillingType: settings?.waterBillingType || 'per_unit',
          waterRate: settings ? String(settings.waterRate) : '0.00',
          electricityBillingType: settings?.electricityBillingType || 'per_unit',
          electricityRate: settings ? String(settings.electricityRate) : '0.00',
          commonFee: settings ? String(settings.commonFee) : '0.00',
          internetFee: settings ? String(settings.internetFee) : '0.00',
          lateFeeType: settings?.lateFeeType || 'fixed',
          lateFeeValue: settings ? String(settings.lateFeeValue) : '0.00',
          currency: 'THB',
        });
      }
      return { cycle: existing, rateSnapshot: snapshot! };
    }

    // Determine periodStart and periodEnd
    let pStartStr = data.periodStart;
    let pEndStr = data.periodEnd;
    let bDateStr = data.billingDate;
    let dDateStr = data.dueDate;

    if (!pStartStr || !pEndStr) {
      const parts = data.cycleCode.split('-');
      if (parts.length === 2) {
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        const lastDay = new Date(y, m, 0).getDate();
        pStartStr = `${y}-${String(m).padStart(2, '0')}-01`;
        pEndStr = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
        bDateStr = bDateStr || `${y}-${String(m).padStart(2, '0')}-25`;

        const nextM = m === 12 ? 1 : m + 1;
        const nextY = m === 12 ? y + 1 : y;
        dDateStr = dDateStr || `${nextY}-${String(nextM).padStart(2, '0')}-05`;
      }
    }

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

    // Fetch authoritative billing settings for rate derivation
    const settings = await prisma.dormitoryBillingSettings.findUnique({ where: { dormitoryId } });

    const snapshotData = {
      waterBillingType: settings?.waterBillingType || data.rateSnapshot?.waterBillingType || 'per_unit',
      waterRate: settings ? String(settings.waterRate) : (data.rateSnapshot?.waterRate !== undefined ? String(data.rateSnapshot.waterRate) : '0.00'),
      electricityBillingType: settings?.electricityBillingType || data.rateSnapshot?.electricityBillingType || 'per_unit',
      electricityRate: settings ? String(settings.electricityRate) : (data.rateSnapshot?.electricityRate !== undefined ? String(data.rateSnapshot.electricityRate) : '0.00'),
      commonFee: settings ? String(settings.commonFee) : (data.rateSnapshot?.commonFee !== undefined ? String(data.rateSnapshot.commonFee) : '0.00'),
      internetFee: settings ? String(settings.internetFee) : (data.rateSnapshot?.internetFee !== undefined ? String(data.rateSnapshot.internetFee) : '0.00'),
      lateFeeType: settings?.lateFeeType || data.rateSnapshot?.lateFeeType || 'fixed',
      lateFeeValue: settings ? String(settings.lateFeeValue) : (data.rateSnapshot?.lateFeeValue !== undefined ? String(data.rateSnapshot.lateFeeValue) : '0.00'),
      currency: data.rateSnapshot?.currency || 'THB',
    };

    try {
      // Execute cycle + rate snapshot creation in single transaction
      const result = await prisma.$transaction(async (tx) => {
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
          waterRate: result.rateSnapshot.waterRate.toString(),
          electricityBillingType: result.rateSnapshot.electricityBillingType,
          electricityRate: result.rateSnapshot.electricityRate.toString(),
          commonFee: result.rateSnapshot.commonFee.toString(),
          internetFee: result.rateSnapshot.internetFee.toString(),
          lateFeeType: result.rateSnapshot.lateFeeType,
          lateFeeValue: result.rateSnapshot.lateFeeValue.toString(),
          currency: result.rateSnapshot.currency,
          createdAt: result.rateSnapshot.createdAt,
        },
      };
    } catch (err: any) {
      if (err.code === 'P2002' || (err.message && err.message.includes('unique'))) {
        const raceExisting = await this.billingCycleRepo.findByCode(dormitoryId, data.cycleCode);
        if (raceExisting) {
          let snapshot = await this.billingCycleRepo.findRateSnapshot(raceExisting.id, dormitoryId);
          if (!snapshot) {
            snapshot = await this.billingCycleRepo.createRateSnapshot(dormitoryId, {
              billingCycleId: raceExisting.id,
              ...snapshotData,
            });
          }
          return { cycle: raceExisting, rateSnapshot: snapshot! };
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
}
