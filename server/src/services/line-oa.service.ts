/**
 * Per-Dormitory LINE OA Configuration & Webhook Service (SECURITY DEFINER Resolver & Concurrency Dedupe)
 * @license Apache-2.0
 */

import { PrismaClient } from '@prisma/client';
import {
  encryptText,
  decryptText,
  generateOpaqueWebhookKey,
  hashToken,
  verifyLineSignature
} from '../utils/crypto-encryption.js';
import { AppError } from '../types/index.js';
import { LineFriendService } from './line-friend.service.js';
import { LinePlatformAdapter, MockLinePlatformAdapter } from './line-platform-adapter.js';

export class LineOaService {
  private friendService: LineFriendService;
  private lineAdapter: LinePlatformAdapter;

  constructor(private prisma: PrismaClient, adapter?: LinePlatformAdapter) {
    this.friendService = new LineFriendService(prisma);
    this.lineAdapter = adapter || new MockLinePlatformAdapter();
  }

  /**
   * Get LINE OA connection status (Secrets REDACTED)
   */
  async getDormitoryLineConfig(dormitoryId: string, baseUrl = 'https://app.horplus.com') {
    return await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;

      const config = await tx.dormitoryLineConfig.findUnique({
        where: { dormitoryId }
      });

      if (!config) {
        return {
          connected: false,
          hasChannelSecret: false,
          hasAccessToken: false,
          lineOaId: null,
          channelId: null,
          lastVerifiedAt: null,
          webhookUrl: null
        };
      }

      let webhookUrl: string | null = null;
      if (config.webhookKeyEncrypted) {
        try {
          const rawKey = decryptText(config.webhookKeyEncrypted);
          webhookUrl = `${baseUrl}/api/v1/line/webhook/${rawKey}`;
        } catch (err) {
          webhookUrl = null;
        }
      }

      return {
        connected: config.isConnected,
        hasChannelSecret: !!config.channelSecretEncrypted,
        hasAccessToken: !!config.channelAccessTokenEncrypted,
        lineOaId: config.lineOaId,
        channelId: config.channelId,
        lastVerifiedAt: config.lastVerifiedAt,
        webhookUrl
      };
    });
  }

  /**
   * Update or configure LINE OA credentials (Encrypted at rest & Verified via LineAdapter)
   */
  async updateDormitoryLineConfig(
    dormitoryId: string,
    data: {
      lineOaId?: string;
      channelId?: string;
      channelSecret?: string;
      channelAccessToken?: string;
    }
  ) {
    return await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;

      const existing = await tx.dormitoryLineConfig.findUnique({
        where: { dormitoryId }
      });

      let webhookKeyHash = existing?.webhookKeyHash;
      let webhookKeyEncrypted = existing?.webhookKeyEncrypted;

      if (!webhookKeyHash) {
        const opaque = generateOpaqueWebhookKey();
        webhookKeyHash = opaque.keyHash;
        webhookKeyEncrypted = opaque.keyEncrypted;
      }

      const channelSecretEncrypted = data.channelSecret
        ? encryptText(data.channelSecret)
        : existing?.channelSecretEncrypted;

      const channelAccessTokenEncrypted = data.channelAccessToken
        ? encryptText(data.channelAccessToken)
        : existing?.channelAccessTokenEncrypted;

      const hasCredentials = !!(channelSecretEncrypted && channelAccessTokenEncrypted);
      let verifiedSuccess = false;

      if (hasCredentials) {
        const secret = data.channelSecret || (existing?.channelSecretEncrypted ? decryptText(existing.channelSecretEncrypted) : undefined);
        const token = data.channelAccessToken || (existing?.channelAccessTokenEncrypted ? decryptText(existing.channelAccessTokenEncrypted) : undefined);

        verifiedSuccess = await this.lineAdapter.verifyCredentials({ channelSecret: secret, channelAccessToken: token });
        if (!verifiedSuccess) {
          throw new AppError('LINE OA credential verification failed. Please check Channel Secret and Access Token.', 400, 'LINE_VERIFICATION_FAILED');
        }
      }

      const isConnected = hasCredentials && verifiedSuccess;

      const updated = await tx.dormitoryLineConfig.upsert({
        where: { dormitoryId },
        update: {
          lineOaId: data.lineOaId ?? existing?.lineOaId,
          channelId: data.channelId ?? existing?.channelId,
          channelSecretEncrypted,
          channelAccessTokenEncrypted,
          webhookKeyHash: webhookKeyHash!,
          webhookKeyEncrypted: webhookKeyEncrypted!,
          isConnected,
          lastVerifiedAt: isConnected ? new Date() : existing?.lastVerifiedAt
        },
        create: {
          dormitoryId,
          lineOaId: data.lineOaId,
          channelId: data.channelId,
          channelSecretEncrypted,
          channelAccessTokenEncrypted,
          webhookKeyHash: webhookKeyHash!,
          webhookKeyEncrypted: webhookKeyEncrypted!,
          isConnected,
          lastVerifiedAt: isConnected ? new Date() : null
        }
      });

      await tx.auditLog.create({
        data: {
          dormitoryId,
          action: 'LINE_OA_CONFIG_UPDATED',
          entityType: 'DormitoryLineConfig',
          entityId: updated.id,
          afterValues: {
            lineOaId: updated.lineOaId,
            channelId: updated.channelId,
            hasChannelSecret: !!updated.channelSecretEncrypted,
            hasAccessToken: !!updated.channelAccessTokenEncrypted,
            isConnected: updated.isConnected
          }
        }
      });

      let webhookUrl: string | null = null;
      if (updated.webhookKeyEncrypted) {
        try {
          const rawKey = decryptText(updated.webhookKeyEncrypted);
          webhookUrl = `https://app.horplus.com/api/v1/line/webhook/${rawKey}`;
        } catch (err) {
          webhookUrl = null;
        }
      }

      return {
        connected: updated.isConnected,
        hasChannelSecret: !!updated.channelSecretEncrypted,
        hasAccessToken: !!updated.channelAccessTokenEncrypted,
        lineOaId: updated.lineOaId,
        channelId: updated.channelId,
        lastVerifiedAt: updated.lastVerifiedAt,
        webhookUrl
      };
    });
  }

  /**
   * Disconnect LINE OA
   */
  async disconnectLineConfig(dormitoryId: string) {
    return await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;

      const existing = await tx.dormitoryLineConfig.findUnique({
        where: { dormitoryId }
      });

      if (!existing) {
        return {
          connected: false,
          hasChannelSecret: false,
          hasAccessToken: false,
          lineOaId: null,
          channelId: null,
          lastVerifiedAt: null,
          webhookUrl: null
        };
      }

      await tx.dormitoryLineConfig.update({
        where: { dormitoryId },
        data: { isConnected: false }
      });

      await tx.auditLog.create({
        data: {
          dormitoryId,
          action: 'LINE_OA_DISCONNECTED',
          entityType: 'DormitoryLineConfig',
          entityId: existing.id,
          afterValues: { isConnected: false }
        }
      });

      return {
        connected: false,
        hasChannelSecret: !!existing.channelSecretEncrypted,
        hasAccessToken: !!existing.channelAccessTokenEncrypted,
        lineOaId: existing.lineOaId,
        channelId: existing.channelId,
        lastVerifiedAt: existing.lastVerifiedAt,
        webhookUrl: null
      };
    });
  }

  /**
   * Rotate Webhook Key
   */
  async rotateWebhookKey(dormitoryId: string) {
    return await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;

      const opaque = generateOpaqueWebhookKey();

      const updated = await tx.dormitoryLineConfig.update({
        where: { dormitoryId },
        data: {
          webhookKeyHash: opaque.keyHash,
          webhookKeyEncrypted: opaque.keyEncrypted
        }
      });

      await tx.auditLog.create({
        data: {
          dormitoryId,
          action: 'LINE_OA_WEBHOOK_KEY_ROTATED',
          entityType: 'DormitoryLineConfig',
          entityId: updated.id,
          afterValues: { rotated: true }
        }
      });

      let webhookUrl: string | null = null;
      if (updated.webhookKeyEncrypted) {
        try {
          const rawKey = decryptText(updated.webhookKeyEncrypted);
          webhookUrl = `https://app.horplus.com/api/v1/line/webhook/${rawKey}`;
        } catch {
          webhookUrl = null;
        }
      }

      return {
        connected: updated.isConnected,
        hasChannelSecret: !!updated.channelSecretEncrypted,
        hasAccessToken: !!updated.channelAccessTokenEncrypted,
        lineOaId: updated.lineOaId,
        channelId: updated.channelId,
        lastVerifiedAt: updated.lastVerifiedAt,
        webhookUrl
      };
    });
  }

  /**
   * Process raw LINE Webhook payload via SECURITY DEFINER resolver, RLS context & dedupe concurrency
   */
  async processWebhookEvent(rawKey: string, bodyBuffer: Buffer, signatureHeader: string) {
    const keyHash = hashToken(rawKey);

    // Call narrow SECURITY DEFINER resolver function (fixed search_path)
    const configs = await this.prisma.$queryRaw<any[]>`
      SELECT id, dormitory_id, channel_secret_encrypted, is_connected
      FROM public.resolve_line_webhook_config(${keyHash})
    `;

    if (!configs || configs.length === 0 || !configs[0].channel_secret_encrypted) {
      throw new AppError('LINE webhook endpoint configuration not found', 404, 'WEBHOOK_CONFIG_NOT_FOUND');
    }

    const resolvedConfig = configs[0];
    const channelSecret = decryptText(resolvedConfig.channel_secret_encrypted);

    // Signature Verification
    const isValid = verifyLineSignature(bodyBuffer, channelSecret, signatureHeader);
    if (!isValid) {
      throw new AppError('Invalid x-line-signature header', 401, 'INVALID_SIGNATURE');
    }

    let payload: any = {};
    try {
      payload = JSON.parse(bodyBuffer.toString('utf8'));
    } catch (err) {
      throw new AppError('Failed to parse webhook JSON body', 400, 'INVALID_JSON_BODY');
    }

    const events = payload.events || [];
    let processedCount = 0;
    let deduplicatedCount = 0;

    for (const event of events) {
      const eventId = event.webhookEventId || event.eventId || `${event.type}_${event.timestamp}_${event.source?.userId}`;

      // Deduplication check via database transaction with RLS context
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${resolvedConfig.dormitory_id}, true)`;

          const receipt = await tx.lineWebhookEventReceipt.create({
            data: {
              dormitoryId: resolvedConfig.dormitory_id,
              webhookEventId: eventId,
              eventType: event.type || 'unknown',
              status: 'processing',
              receivedAt: new Date(),
              processedAt: null
            }
          });

          const lineUserId = event.source?.userId;
          if (lineUserId) {
            let profile = await this.lineAdapter.getProfile(lineUserId).catch(() => null);
            const displayName = profile?.displayName || `LINE User (${lineUserId.slice(-4)})`;
            const pictureUrl = profile?.pictureUrl || null;

            if (event.type === 'follow') {
              await this.friendService.upsertFriendFromWebhook(
                resolvedConfig.dormitory_id,
                lineUserId,
                displayName,
                pictureUrl,
                'FOLLOWING'
              );
            } else if (event.type === 'unfollow') {
              await this.friendService.upsertFriendFromWebhook(
                resolvedConfig.dormitory_id,
                lineUserId,
                displayName,
                pictureUrl,
                'UNFOLLOWED'
              );
            } else if (event.type === 'message' || event.type === 'postback') {
              await this.friendService.upsertFriendFromWebhook(
                resolvedConfig.dormitory_id,
                lineUserId,
                displayName,
                pictureUrl,
                'FOLLOWING'
              );
            }
          }

          // Mark receipt completed
          await tx.lineWebhookEventReceipt.update({
            where: { id: receipt.id },
            data: {
              status: 'processed',
              processedAt: new Date()
            }
          });
        });

        processedCount++;
      } catch (err: any) {
        if (err.code === 'P2002' || err.message?.includes('unique constraint')) {
          deduplicatedCount++;
          continue;
        }
        throw err;
      }
    }

    return {
      success: true,
      processedCount,
      deduplicatedCount
    };
  }
}
