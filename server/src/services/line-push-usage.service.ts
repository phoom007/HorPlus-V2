/**
 * LINE Push Usage & Quota Reservation Service (Task-009 Checkpoint 1C)
 * Atomic quota reservation + delivery attempt creation.
 * Idempotent attempt finalization permanently bound to attempt.periodKey.
 * @license Apache-2.0
 */

import { PrismaClient } from '@prisma/client';
import { AppError } from '../types/index.js';
import { LinePushResult } from './line-platform-adapter.js';

export interface QuotaStatus {
  periodKey: string;
  successCount: number;
  reservedCount: number;
  quotaLimit: number;
  remaining: number;
  isAvailable: boolean;
}

export interface ReservationResult {
  attemptId: string;
  lineRetryKey: string;
  periodKey: string;
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
  async getQuotaStatus(dormitoryId: string, tx?: any): Promise<QuotaStatus> {
    const run = async (db: any) => {
      await db.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;

      const dorm = await db.dormitory.findUnique({
        where: { id: dormitoryId },
        select: { timezone: true },
      });
      const timezone = dorm?.timezone || 'Asia/Bangkok';
      const periodKey = this.getCurrentPeriodKey(timezone);
      const quotaLimit = await this.getQuotaLimit(dormitoryId, db);

      const usage = await db.linePushUsage.findUnique({
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
    };

    if (tx) {
      return await run(tx);
    }
    return await this.prisma.$transaction(run);
  }

  /**
   * Atomically reserve one push quota slot AND create a LinePushDeliveryAttempt in ONE transaction.
   * If creation fails, the reservation is rolled back atomically.
   */
  async reserveQuotaAndCreateAttempt(
    dormitoryId: string,
    accessGrantId: string
  ): Promise<ReservationResult> {
    const dorm = await this.prisma.dormitory.findUnique({
      where: { id: dormitoryId },
      select: { timezone: true },
    });
    const timezone = dorm?.timezone || 'Asia/Bangkok';
    const periodKey = this.getCurrentPeriodKey(timezone);
    const lineRetryKey = crypto.randomUUID();
    const now = new Date();
    const retryKeyExpiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24-hour lifetime

    return await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;

      const quotaLimit = await this.getQuotaLimit(dormitoryId, tx);

      // 1. Upsert usage row
      await tx.$executeRaw`
        INSERT INTO "line_push_usage" ("id", "dormitory_id", "period_key", "success_count", "reserved_count", "created_at", "updated_at")
        VALUES (gen_random_uuid(), ${dormitoryId}::uuid, ${periodKey}, 0, 0, NOW(), NOW())
        ON CONFLICT ("dormitory_id", "period_key") DO NOTHING
      `;

      // 2. Lock usage row FOR UPDATE
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

      // 3. Increment reservedCount
      await tx.$executeRaw`
        UPDATE "line_push_usage"
        SET "reserved_count" = "reserved_count" + 1, "updated_at" = NOW()
        WHERE "id" = ${row.id}::uuid
      `;

      // 4. Create LinePushDeliveryAttempt record in SAME transaction
      const attempt = await tx.linePushDeliveryAttempt.create({
        data: {
          dormitoryId,
          accessGrantId,
          periodKey,
          lineRetryKey,
          status: 'RESERVED',
          attemptedAt: now,
          retryKeyCreatedAt: now,
          retryKeyExpiresAt,
        },
      });

      return {
        attemptId: attempt.id,
        lineRetryKey,
        periodKey,
      };
    });
  }

  /**
   * Finalize delivery attempt atomically and idempotently.
   * Permanently updates the attempt's stored periodKey row regardless of current calendar month.
   */
  async finalizeDeliveryAttempt(
    attemptId: string,
    dormitoryId: string,
    accessGrantId: string,
    result: LinePushResult
  ): Promise<{ pushed: boolean; deliveryStatus: string }> {
    return await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;

      // 1. Lock attempt row FOR UPDATE
      const attempts = await tx.$queryRaw<any[]>`
        SELECT "id", "dormitory_id", "access_grant_id", "period_key", "status"
        FROM "line_push_delivery_attempts"
        WHERE "id" = ${attemptId}::uuid AND "dormitory_id" = ${dormitoryId}::uuid
        FOR UPDATE
      `;

      if (!attempts || attempts.length === 0) {
        return { pushed: false, deliveryStatus: 'failed' };
      }

      const attempt = attempts[0];
      const currentAttemptStatus = attempt.status;

      // If already terminal, return stored terminal status without re-modifying quota
      if (['SENT', 'ALREADY_ACCEPTED', 'FAILED', 'RETRY_WINDOW_EXPIRED'].includes(currentAttemptStatus)) {
        const isSuccess = ['SENT', 'ALREADY_ACCEPTED'].includes(currentAttemptStatus);
        const mappedStatus = currentAttemptStatus === 'RETRY_WINDOW_EXPIRED'
          ? 'retry_window_expired'
          : (isSuccess ? 'sent' : 'failed');
        return { pushed: isSuccess, deliveryStatus: mappedStatus };
      }

      // 2. Lock usage row for attempt.period_key FOR UPDATE
      const usageRows = await tx.$queryRaw<any[]>`
        SELECT "id", "reserved_count", "success_count"
        FROM "line_push_usage"
        WHERE "dormitory_id" = ${dormitoryId}::uuid AND "period_key" = ${attempt.period_key}
        FOR UPDATE
      `;

      const usageRow = usageRows?.[0];

      // 3. Process outcome
      let finalStatus: string;
      let lastDeliveryStatus: string;
      let lastErrorCode: string | null = null;
      let isSuccess = false;

      switch (result.outcome) {
        case 'ACCEPTED':
        case 'ALREADY_ACCEPTED': {
          isSuccess = true;
          finalStatus = result.outcome === 'ACCEPTED' ? 'SENT' : 'ALREADY_ACCEPTED';
          lastDeliveryStatus = 'sent';

          if (usageRow) {
            await tx.$executeRaw`
              UPDATE "line_push_usage"
              SET "success_count" = "success_count" + 1,
                  "reserved_count" = GREATEST("reserved_count" - 1, 0),
                  "updated_at" = NOW()
              WHERE "id" = ${usageRow.id}::uuid
            `;
          }
          break;
        }

        case 'DEFINITIVE_FAILURE': {
          finalStatus = 'FAILED';
          lastDeliveryStatus = 'failed';
          lastErrorCode = result.errorCode;

          if (usageRow) {
            await tx.$executeRaw`
              UPDATE "line_push_usage"
              SET "reserved_count" = GREATEST("reserved_count" - 1, 0),
                  "updated_at" = NOW()
              WHERE "id" = ${usageRow.id}::uuid
            `;
          }
          break;
        }

        case 'RETRYABLE_UNKNOWN': {
          finalStatus = 'RETRY_PENDING';
          lastDeliveryStatus = 'retry_pending';
          lastErrorCode = result.errorCode;
          break;
        }

        default: {
          finalStatus = 'FAILED';
          lastDeliveryStatus = 'failed';
        }
      }

      // Update attempt row
      await tx.linePushDeliveryAttempt.update({
        where: { id: attemptId },
        data: {
          status: finalStatus,
          lineMessageId: (result as any).messageId || null,
          errorCode: lastErrorCode,
          finalizedAt: new Date(),
        },
      });

      // Update grant delivery status summary
      await tx.dormitoryAccessGrant.update({
        where: { id: accessGrantId },
        data: {
          lastDeliveryStatus,
          lastDeliveryAttemptAt: new Date(),
          lastDeliverySuccessAt: isSuccess ? new Date() : undefined,
          lastDeliveryErrorCode: lastErrorCode,
        },
      });

      return { pushed: isSuccess, deliveryStatus: lastDeliveryStatus };
    });
  }

  /**
   * Release reservation for an expired attempt atomically and idempotently.
   * Concurrent or repeat calls release at most ONE quota reservation.
   */
  async markAttemptExpired(
    attemptId: string,
    dormitoryId: string,
    accessGrantId: string,
    periodKey: string
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;

      // 1. SELECT exact attempt FOR UPDATE
      const attempts = await tx.$queryRaw<any[]>`
        SELECT "id", "status"
        FROM "line_push_delivery_attempts"
        WHERE "id" = ${attemptId}::uuid AND "dormitory_id" = ${dormitoryId}::uuid
        FOR UPDATE
      `;

      if (!attempts || attempts.length === 0) return;

      const attempt = attempts[0];

      // If attempt is already in terminal status, return immediately without touching quota
      if (['SENT', 'ALREADY_ACCEPTED', 'FAILED', 'EXPIRED', 'RETRY_WINDOW_EXPIRED'].includes(attempt.status)) {
        return;
      }

      if (attempt.status !== 'RETRY_PENDING' && attempt.status !== 'RESERVED') {
        return;
      }

      // 2. SELECT exact LinePushUsage row FOR UPDATE
      const usageRows = await tx.$queryRaw<any[]>`
        SELECT "id" FROM "line_push_usage"
        WHERE "dormitory_id" = ${dormitoryId}::uuid AND "period_key" = ${periodKey}
        FOR UPDATE
      `;

      // 3. Update attempt status
      await tx.linePushDeliveryAttempt.update({
        where: { id: attemptId },
        data: {
          status: 'RETRY_WINDOW_EXPIRED',
          errorCode: 'RETRY_WINDOW_EXPIRED',
          finalizedAt: new Date(),
        },
      });

      // 4. Decrement reservedCount by exactly 1
      if (usageRows && usageRows.length > 0) {
        await tx.$executeRaw`
          UPDATE "line_push_usage"
          SET "reserved_count" = GREATEST("reserved_count" - 1, 0),
              "updated_at" = NOW()
          WHERE "id" = ${usageRows[0].id}::uuid
        `;
      }

      // 5. Update Grant delivery summary
      await tx.dormitoryAccessGrant.update({
        where: { id: accessGrantId },
        data: {
          lastDeliveryStatus: 'retry_window_expired',
          lastDeliveryErrorCode: 'RETRY_WINDOW_EXPIRED',
        },
      });
    });
  }
}
