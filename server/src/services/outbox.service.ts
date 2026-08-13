import { PrismaClient, Prisma } from '@prisma/client';
import { getPrismaClient } from '../db/prisma.js';
import { logger } from '../config/logger.js';
import crypto from 'crypto';

export interface CreateOutboxInput {
  dormitoryId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  recipientType: 'TENANT' | 'STAFF';
  recipientId?: string | null;
  recipientRoleCode?: string | null;
  title: string;
  body: string;
  payload?: any;
  idempotencyKey?: string;
}

export class OutboxService {
  constructor(private client: PrismaClient = getPrismaClient()) {}

  /**
   * Atomically writes an outbox record inside an existing Prisma transaction context
   */
  public async createOutboxEvent(
    tx: Prisma.TransactionClient,
    input: CreateOutboxInput
  ) {
    const idempotencyKey =
      input.idempotencyKey ||
      `${input.eventType}-${input.aggregateId}-${input.recipientType}-${input.recipientId || input.recipientRoleCode || 'ALL'}-${crypto.randomUUID()}`;

    // Ensure zero secrets in payload
    const safePayload = this.sanitizePayload(input.payload);

    return tx.localNotificationOutbox.create({
      data: {
        dormitoryId: input.dormitoryId,
        eventType: input.eventType,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        recipientType: input.recipientType,
        recipientId: input.recipientId || null,
        recipientRoleCode: input.recipientRoleCode || null,
        title: input.title.trim(),
        body: input.body.trim(),
        payload: safePayload || Prisma.JsonNull,
        status: 'PENDING',
        idempotencyKey,
      },
    });
  }

  /**
   * Main Dispatcher: Processes PENDING outbox events idempotently
   */
  public async processPendingOutboxEvents(batchSize: number = 50): Promise<{
    processedCount: number;
    failedCount: number;
  }> {
    let processedCount = 0;
    let failedCount = 0;

    try {
      const pendingEvents = await this.client.localNotificationOutbox.findMany({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        take: batchSize,
      });

      if (pendingEvents.length === 0) {
        return { processedCount: 0, failedCount: 0 };
      }

      for (const event of pendingEvents) {
        try {
          await this.client.$transaction(async (tx) => {
            // Re-verify event status inside transaction
            const currentEvent = await tx.localNotificationOutbox.findUnique({
              where: { id: event.id },
            });

            if (!currentEvent || currentEvent.status !== 'PENDING') {
              return;
            }

            if (currentEvent.recipientType === 'TENANT') {
              if (currentEvent.recipientId) {
                // Check if notice already exists for this source outbox ID
                const existing = await tx.tenantNotice.findFirst({
                  where: { sourceOutboxId: currentEvent.id },
                });

                if (!existing) {
                  await tx.tenantNotice.create({
                    data: {
                      dormitoryId: currentEvent.dormitoryId,
                      tenantId: currentEvent.recipientId,
                      title: currentEvent.title,
                      message: currentEvent.body,
                      type: currentEvent.eventType,
                      sourceOutboxId: currentEvent.id,
                    },
                  });
                }
              }
            } else if (currentEvent.recipientType === 'STAFF') {
              // Resolve active staff members for this dormitory
              const memberWhere: any = {
                dormitoryId: currentEvent.dormitoryId,
                status: 'active',
              };

              if (currentEvent.recipientRoleCode) {
                const roles = currentEvent.recipientRoleCode
                  .split(',')
                  .map((r) => r.trim().toUpperCase());
                memberWhere.role = {
                  code: { in: roles },
                };
              }

              const activeMembers = await tx.dormitoryMember.findMany({
                where: memberWhere,
                include: { role: true },
              });

              for (const member of activeMembers) {
                try {
                  await tx.staffNotification.upsert({
                    where: {
                      staff_notice_source_outbox_user_unique: {
                        sourceOutboxId: currentEvent.id,
                        userId: member.userId,
                      },
                    },
                    create: {
                      dormitoryId: currentEvent.dormitoryId,
                      userId: member.userId,
                      roleCode: member.role.code,
                      category: currentEvent.eventType,
                      title: currentEvent.title,
                      message: currentEvent.body,
                      metadata: (currentEvent.payload as any) || Prisma.JsonNull,
                      sourceOutboxId: currentEvent.id,
                    },
                    update: {}, // Idempotent: leave existing untouched if re-processed
                  });
                } catch (memberErr: any) {
                  logger.warn({
                    event: 'STAFF_NOTICE_DISPATCH_SINGLE_USER_ERROR',
                    sourceOutboxId: currentEvent.id,
                    userId: member.userId,
                    error: memberErr.message,
                  });
                }
              }
            }

            // Mark event PROCESSED atomically
            await tx.localNotificationOutbox.update({
              where: { id: currentEvent.id },
              data: {
                status: 'PROCESSED',
                processedAt: new Date(),
              },
            });
          });

          processedCount++;
        } catch (err: any) {
          logger.error({
            event: 'OUTBOX_DISPATCH_EVENT_ERROR',
            outboxId: event.id,
            error: err.message,
          });

          try {
            await this.client.localNotificationOutbox.update({
              where: { id: event.id },
              data: {
                status: 'FAILED',
                lastError: err.message ? err.message.slice(0, 1000) : 'Unknown error',
              },
            });
          } catch (failUpdateErr) {
            logger.error({
              event: 'OUTBOX_FAILED_STATUS_UPDATE_ERROR',
              outboxId: event.id,
              error: (failUpdateErr as any)?.message,
            });
          }

          failedCount++;
        }
      }
    } catch (err: any) {
      logger.error({
        event: 'OUTBOX_DISPATCHER_BATCH_ERROR',
        error: err.message,
      });
    }

    return { processedCount, failedCount };
  }

  /**
   * Sanitizes payload data to ensure no sensitive secrets/tokens are serialized into outbox
   */
  private sanitizePayload(payload: any): any {
    if (!payload || typeof payload !== 'object') {
      return payload;
    }

    const forbiddenKeys = [
      'password',
      'passwordHash',
      'secret',
      'channelSecret',
      'channelAccessToken',
      'token',
      'tokenHash',
      'tokenEncrypted',
      'sessionId',
      'csrfSecret',
      'nationalIdEncrypted',
      'promptPayValueEncrypted',
      'bankAccountNumberEncrypted',
    ];

    const clean: any = Array.isArray(payload) ? [] : {};
    for (const [key, val] of Object.entries(payload)) {
      if (forbiddenKeys.some((fk) => key.toLowerCase().includes(fk.toLowerCase()))) {
        continue; // Strip forbidden sensitive key
      }
      if (val && typeof val === 'object') {
        clean[key] = this.sanitizePayload(val);
      } else {
        clean[key] = val;
      }
    }
    return clean;
  }
}

export const outboxService = new OutboxService();
