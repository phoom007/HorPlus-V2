/**
 * LINE Push Usage & Quota Reservation Service (Task-009)
 * Atomic reservation pattern: reservedCount + successCount < limit
 * Monthly period derived from Dormitory timezone.
 * @license Apache-2.0
 */

import { PrismaClient } from '@prisma/client';
import { AppError } from '../types/index.js';

export interface QuotaStatus {
  periodKey: string;
  successCount: number;
  reservedCount: number;
  quotaLimit: number;
  remaining: number;
  isAvailable: boolean;
}

export class LinePushUsageService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Derive the current monthly period key from Dormitory timezone.
   * Format: "YYYY-MM" in the dormitory's local time.
   */
  getCurrentPeriodKey(timezone: string): string {
    try {
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
      });
      const formatted = formatter.format(now);
      return formatted.substring(0, 7);
    } catch {
      const now = new Date();
      return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    }
  }

  /**
   * Resolve quota limit from authoritative Wave 1F subscription model:
   * DormitorySubscription → SubscriptionPlan → messageQuotaMonthly
   * FREE = 30, PAID = 300
   */
  async getQuotaLimit(dormitoryId: string, tx?: any): Promise<number> {
    const db = tx || this.prisma;

    const sub = await db.dormitorySubscription.findUnique({
      where: { dormitoryId },
      include: { plan: true },
    });

    if (!sub || !sub.plan) {
      return 30;
    }

    return sub.plan.messageQuotaMonthly ?? 30;
  }

  /**
   * Get current quota status for a dormitory.
   */
  async getQuotaStatus(dormitoryId: string): Promise<QuotaStatus> {
    return await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;

      const dorm = await tx.dormitory.findUnique({
        where: { id: dormitoryId },
        select: { timezone: true },
      });
      const timezone = dorm?.timezone || 'Asia/Bangkok';
      const periodKey = this.getCurrentPeriodKey(timezone);
      const quotaLimit = await this.getQuotaLimit(dormitoryId, tx);

      const usage = await tx.linePushUsage.findUnique({
        where: { dormitory_push_period_unique: { dormitoryId, periodKey } },
      });

      const successCount = usage?.successCount ?? 0;
      const reservedCount = usage?.reservedCount ?? 0;
      const remaining = Math.max(0, quotaLimit - successCount - reservedCount);

      return {
        periodKey,
        successCount,
        reservedCount,
        quotaLimit,
        remaining,
        isAvailable: remaining > 0,
      };
    });
  }

  /**
   * Atomically reserve one push quota slot.
   * Uses row-level lock on the usage row to prevent double-reservation.
   * Returns the period key or throws QUOTA_EXHAUSTED.
   */
  async reserveQuotaSlot(dormitoryId: string): Promise<{ periodKey: string; usageId: string }> {
    const dorm = await this.prisma.dormitory.findUnique({
      where: { id: dormitoryId },
      select: { timezone: true },
    });
    const timezone = dorm?.timezone || 'Asia/Bangkok';
    const periodKey = this.getCurrentPeriodKey(timezone);

    return await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;

      const quotaLimit = await this.getQuotaLimit(dormitoryId, tx);

      // Upsert with row lock via raw SQL for atomicity
      await tx.$executeRaw`
        INSERT INTO "line_push_usage" ("id", "dormitory_id", "period_key", "success_count", "reserved_count", "created_at", "updated_at")
        VALUES (gen_random_uuid(), ${dormitoryId}::uuid, ${periodKey}, 0, 0, NOW(), NOW())
        ON CONFLICT ("dormitory_id", "period_key") DO NOTHING
      `;

      // Lock and check capacity
      const rows = await tx.$queryRaw<any[]>`
        SELECT "id", "success_count", "reserved_count"
        FROM "line_push_usage"
        WHERE "dormitory_id" = ${dormitoryId}::uuid AND "period_key" = ${periodKey}
        FOR UPDATE
      `;

      if (!rows || rows.length === 0) {
        throw new AppError('Failed to acquire push usage row', 500, 'PUSH_USAGE_LOCK_FAILED');
      }

      const row = rows[0];
      const used = (row.success_count || 0) + (row.reserved_count || 0);

      if (used >= quotaLimit) {
        throw new AppError(
          `Push quota exhausted (${used}/${quotaLimit} used this month)`,
          429,
          'QUOTA_EXHAUSTED'
        );
      }

      // Increment reservedCount
      await tx.$executeRaw`
        UPDATE "line_push_usage"
        SET "reserved_count" = "reserved_count" + 1, "updated_at" = NOW()
        WHERE "id" = ${row.id}::uuid
      `;

      return { periodKey, usageId: row.id };
    });
  }

  /**
   * Finalize a successful delivery: reserved → success.
   * Idempotent: only finalizes if not already done.
   */
  async finalizeSuccess(dormitoryId: string, periodKey: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;

      const rows = await tx.$queryRaw<any[]>`
        SELECT "id", "reserved_count"
        FROM "line_push_usage"
        WHERE "dormitory_id" = ${dormitoryId}::uuid AND "period_key" = ${periodKey}
        FOR UPDATE
      `;

      if (!rows || rows.length === 0) return;

      const row = rows[0];
      if ((row.reserved_count || 0) <= 0) return; // Already finalized

      await tx.$executeRaw`
        UPDATE "line_push_usage"
        SET "success_count" = "success_count" + 1,
            "reserved_count" = GREATEST("reserved_count" - 1, 0),
            "updated_at" = NOW()
        WHERE "id" = ${row.id}::uuid
      `;
    });
  }

  /**
   * Release a reservation on definitive failure.
   * Idempotent: only releases if reservedCount > 0.
   */
  async releaseReservation(dormitoryId: string, periodKey: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;

      const rows = await tx.$queryRaw<any[]>`
        SELECT "id", "reserved_count"
        FROM "line_push_usage"
        WHERE "dormitory_id" = ${dormitoryId}::uuid AND "period_key" = ${periodKey}
        FOR UPDATE
      `;

      if (!rows || rows.length === 0) return;

      const row = rows[0];
      if ((row.reserved_count || 0) <= 0) return;

      await tx.$executeRaw`
        UPDATE "line_push_usage"
        SET "reserved_count" = GREATEST("reserved_count" - 1, 0),
            "updated_at" = NOW()
        WHERE "id" = ${row.id}::uuid
      `;
    });
  }
}
