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
    const existing = await this.billingCycleRepo.findByCode(dormitoryId, data.cycleCode);
    if (existing) {
      const err = new Error('DUPLICATE_CYCLE_CODE');
      (err as any).statusCode = 409;
      (err as any).code = 'DUPLICATE_CYCLE_CODE';
      throw err;
    }

    const periodStart = new Date(data.periodStart);
    const periodEnd = new Date(data.periodEnd);
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

    const cycle = await this.billingCycleRepo.create(dormitoryId, {
      cycleCode: data.cycleCode,
      name: data.name,
      periodStart,
      periodEnd,
      billingDate: new Date(data.billingDate),
      dueDate: new Date(data.dueDate),
      status: 'draft',
      createdByUserId: userId,
    });

    const rateSnapshot = await this.billingCycleRepo.createRateSnapshot(dormitoryId, {
      billingCycleId: cycle.id,
      ...data.rateSnapshot,
    });

    if (this.auditService) {
      await this.auditService.log({
        dormitoryId,
        actorUserId: userId || 'system',
        action: 'billing_cycle.create',
        resourceType: 'billing_cycle',
        resourceId: cycle.id,
        payload: { cycleCode: cycle.cycleCode, name: cycle.name },
      });
    }

    return { cycle, rateSnapshot };
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
        payload: { updateData },
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
        payload: { status: 'locked' },
      });
    }

    return updated;
  }
}
