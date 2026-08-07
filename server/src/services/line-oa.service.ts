/**
 * Per-Dormitory LINE OA Configuration & Webhook Service
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
    const config = await this.prisma.dormitoryLineConfig.findUnique({
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
    const existing = await this.prisma.dormitoryLineConfig.findUnique({
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

    const updated = await this.prisma.dormitoryLineConfig.upsert({
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

    await this.prisma.auditLog.create({
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

    return this.getDormitoryLineConfig(dormitoryId);
  }

  /**
   * Disconnect LINE OA
   */
  async disconnectLineConfig(dormitoryId: string) {
    const existing = await this.prisma.dormitoryLineConfig.findUnique({
      where: { dormitoryId }
    });

    if (!existing) {
      return this.getDormitoryLineConfig(dormitoryId);
    }

    await this.prisma.dormitoryLineConfig.update({
      where: { dormitoryId },
      data: { isConnected: false }
    });

    await this.prisma.auditLog.create({
      data: {
        dormitoryId,
        action: 'LINE_OA_DISCONNECTED',
        entityType: 'DormitoryLineConfig',
        entityId: existing.id,
        afterValues: { isConnected: false }
      }
    });

    return this.getDormitoryLineConfig(dormitoryId);
  }

  /**
   * Rotate Webhook Key
   */
  async rotateWebhookKey(dormitoryId: string) {
    const opaque = generateOpaqueWebhookKey();

    const updated = await this.prisma.dormitoryLineConfig.update({
      where: { dormitoryId },
      data: {
        webhookKeyHash: opaque.keyHash,
        webhookKeyEncrypted: opaque.keyEncrypted
      }
    });

    await this.prisma.auditLog.create({
      data: {
        dormitoryId,
        action: 'LINE_OA_WEBHOOK_KEY_ROTATED',
        entityType: 'DormitoryLineConfig',
        entityId: updated.id,
        afterValues: { rotated: true }
      }
    });

    return this.getDormitoryLineConfig(dormitoryId);
  }

  /**
   * Process raw LINE Webhook payload with signature verification & deduplication
   */
  async processWebhookEvent(rawKey: string, bodyBuffer: Buffer, signatureHeader: string) {
    const keyHash = hashToken(rawKey);

    const config = await this.prisma.dormitoryLineConfig.findUnique({
      where: { webhookKeyHash: keyHash }
    });

    if (!config || !config.channelSecretEncrypted) {
      throw new AppError('LINE webhook endpoint configuration not found', 404, 'WEBHOOK_CONFIG_NOT_FOUND');
    }

    const channelSecret = decryptText(config.channelSecretEncrypted);

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

      // Deduplication check
      const existingReceipt = await this.prisma.lineWebhookEventReceipt.findUnique({
        where: { webhookEventId: eventId }
      });

      if (existingReceipt) {
        deduplicatedCount++;
        continue;
      }

      // Record receipt initial state: receivedAt = now(), processedAt = NULL
      const receipt = await this.prisma.lineWebhookEventReceipt.create({
        data: {
          dormitoryId: config.dormitoryId,
          webhookEventId: eventId,
          eventType: event.type || 'unknown',
          status: 'processing',
          receivedAt: new Date(),
          processedAt: null
        }
      });

      // Handle Event Types
      const lineUserId = event.source?.userId;
      if (lineUserId) {
        if (event.type === 'follow') {
          await this.friendService.upsertFriendFromWebhook(
            config.dormitoryId,
            lineUserId,
            'LINE Follower',
            undefined,
            'FOLLOWING'
          );
        } else if (event.type === 'unfollow') {
          await this.friendService.upsertFriendFromWebhook(
            config.dormitoryId,
            lineUserId,
            'LINE Follower',
            undefined,
            'UNFOLLOWED'
          );
        } else if (event.type === 'message' || event.type === 'postback') {
          await this.friendService.upsertFriendFromWebhook(
            config.dormitoryId,
            lineUserId,
            'LINE User',
            undefined,
            'FOLLOWING'
          );
        }
      }

      // Mark receipt completed: status = 'processed', processedAt = now()
      await this.prisma.lineWebhookEventReceipt.update({
        where: { id: receipt.id },
        data: {
          status: 'processed',
          processedAt: new Date()
        }
      });

      processedCount++;
    }

    return {
      success: true,
      processedCount,
      deduplicatedCount
    };
  }
}
