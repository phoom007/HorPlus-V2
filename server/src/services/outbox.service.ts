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
   * Main Dispatcher: Processes PENDING outbox events using PostgreSQL FOR UPDATE SKIP LOCKED
   */
  public async processPendingOutboxEvents(batchSize: number = 50): Promise<{
    processedCount: number;
    failedCount: number;
  }> {
    let processedCount = 0;
    let failedCount = 0;

    for (let i = 0; i < batchSize; i++) {
      let eventProcessed = false;
      let eventFailed = false;

      try {
        await this.client.$transaction(async (tx) => {
          // Lock & claim next eligible PENDING outbox row using FOR UPDATE SKIP LOCKED
          const claimedRows = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT id FROM local_notification_outbox
            WHERE status = 'PENDING'
            ORDER BY created_at ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
          `;

          if (!claimedRows || claimedRows.length === 0) {
            return;
          }

          const eventId = claimedRows[0].id;
          const currentEvent = await tx.localNotificationOutbox.findUnique({
            where: { id: eventId },
          });

          if (!currentEvent || currentEvent.status !== 'PENDING') {
            return;
          }

          // Validate required fields
          if (!currentEvent.dormitoryId || !currentEvent.title || !currentEvent.body) {
            await tx.localNotificationOutbox.update({
              where: { id: eventId },
              data: {
                status: 'FAILED',
                lastError: 'Malformed outbox event: missing required fields',
              },
            });
            eventFailed = true;
            return;
          }

          if (currentEvent.recipientType === 'TENANT') {
            if (currentEvent.recipientId) {
              const existingNotice = await tx.tenantNotice.findUnique({
                where: { sourceOutboxId: currentEvent.id },
              });

              if (!existingNotice) {
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

            if (activeMembers.length === 0) {
              await tx.localNotificationOutbox.update({
                where: { id: eventId },
                data: {
                  status: 'FAILED',
                  lastError: 'NO_ACTIVE_RECIPIENTS',
                },
              });
              eventFailed = true;
              return;
            }

            for (const member of activeMembers) {
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
            }
          }

          // Mark PROCESSED inside same transaction
          await tx.localNotificationOutbox.update({
            where: { id: eventId },
            data: {
              status: 'PROCESSED',
              processedAt: new Date(),
            },
          });

          eventProcessed = true;
        });

        if (eventProcessed) {
          processedCount++;
        } else if (eventFailed) {
          failedCount++;
        } else {
          // No more PENDING events available to claim
          break;
        }
      } catch (err: any) {
        logger.error({
          event: 'OUTBOX_DISPATCH_EVENT_ERROR',
          error: err.message,
        });
        failedCount++;
      }
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
