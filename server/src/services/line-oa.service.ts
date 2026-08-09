/**
 * Per-Dormitory LINE OA Configuration & Webhook Service
 * SECURITY DEFINER resolver returns minimal routing identity.
 * Full config read under RLS after context is set.
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

import { createLinePlatformAdapter } from './line-adapter-factory.js';

import { LineChannelTokenProvider } from './line-channel-token-provider.js';

export class LineOaService {
  private friendService: LineFriendService;
  private lineAdapter: LinePlatformAdapter;
  private tokenProvider: LineChannelTokenProvider;

  constructor(private prisma: PrismaClient, adapter?: LinePlatformAdapter) {
    this.friendService = new LineFriendService(prisma);
    this.tokenProvider = new LineChannelTokenProvider();
    if (adapter) {
      this.lineAdapter = adapter;
    } else if (process.env.NODE_ENV === 'test' && process.env.HORPLUS_E2E !== 'true') {
      this.lineAdapter = new MockLinePlatformAdapter();
    } else {
      this.lineAdapter = createLinePlatformAdapter();
    }
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
          accessTokenVerifiedAt: null,
          webhookVerifiedAt: null,
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
        hasAccessToken: !!config.channelAccessTokenEncrypted || !!(config.channelId && config.channelSecretEncrypted),
        lineOaId: config.lineOaId,
        channelId: config.channelId,
        accessTokenVerifiedAt: config.accessTokenVerifiedAt,
        webhookVerifiedAt: config.webhookVerifiedAt,
        webhookUrl
      };
    });
  }

  /**
   * Update or configure LINE OA credentials (Encrypted at rest)
   * Access token verified via GET /v2/bot/info.
   * webhookVerifiedAt is NOT set here — only set when a real webhook passes HMAC.
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
    let newAccessTokenVerifiedAt: Date | null = null;
    let isStateless = false;

    // Stateless OAuth flow using Channel ID + Channel Secret (External HTTP calls outside transaction)
    if (data.channelId && data.channelSecret) {
      try {
        const statelessToken = await this.tokenProvider.getChannelAccessToken(data.channelId, data.channelSecret);
        const verifyResult = await this.lineAdapter.verifyAccessToken(statelessToken);
        if (!verifyResult.verified) {
          throw new AppError('LINE Channel Access Token verification failed', 400, 'LINE_ACCESS_TOKEN_VERIFICATION_FAILED');
        }
        newAccessTokenVerifiedAt = new Date();
        isStateless = true;
      } catch (err: any) {
        if (err instanceof AppError) throw err;
        throw new AppError('LINE Channel verification failed', 400, 'LINE_ACCESS_TOKEN_VERIFICATION_FAILED');
      }
    } else if (data.channelAccessToken) {
      const verifyResult = await this.lineAdapter.verifyAccessToken(data.channelAccessToken);
      if (!verifyResult.verified) {
        throw new AppError(
          'LINE Channel Access Token verification failed. GET /v2/bot/info returned non-OK.',
          400,
          'LINE_ACCESS_TOKEN_VERIFICATION_FAILED'
        );
      }
      newAccessTokenVerifiedAt = new Date();
    }

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

      let channelAccessTokenEncrypted = isStateless
        ? null
        : data.channelAccessToken
        ? encryptText(data.channelAccessToken)
        : existing?.channelAccessTokenEncrypted;

      const accessTokenVerifiedAt = newAccessTokenVerifiedAt || existing?.accessTokenVerifiedAt || null;
      const isConnected = !!(channelSecretEncrypted && accessTokenVerifiedAt);

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
          accessTokenVerifiedAt,
          // webhookVerifiedAt is NOT touched here — only set on real webhook HMAC pass
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
          accessTokenVerifiedAt,
          webhookVerifiedAt: null,
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
            isConnected: updated.isConnected,
            accessTokenVerified: !!updated.accessTokenVerifiedAt
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
        hasAccessToken: !!updated.channelAccessTokenEncrypted || !!(updated.channelId && updated.channelSecretEncrypted),
        lineOaId: updated.lineOaId,
        channelId: updated.channelId,
        accessTokenVerifiedAt: updated.accessTokenVerifiedAt,
        webhookVerifiedAt: updated.webhookVerifiedAt,
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
          accessTokenVerifiedAt: null,
          webhookVerifiedAt: null,
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
        accessTokenVerifiedAt: existing.accessTokenVerifiedAt,
        webhookVerifiedAt: existing.webhookVerifiedAt,
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
          webhookKeyEncrypted: opaque.keyEncrypted,
          // Rotating webhook key invalidates webhook verification
          webhookVerifiedAt: null
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
        accessTokenVerifiedAt: updated.accessTokenVerifiedAt,
        webhookVerifiedAt: updated.webhookVerifiedAt,
        webhookUrl
      };
    });
  }

  /**
   * Resolve per-dormitory decrypted Channel Access Token (internal use for push/profile).
   * NEVER expose or log the returned value.
   */
  async resolveAccessToken(dormitoryId: string): Promise<string | null> {
    return await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;
      const config = await tx.dormitoryLineConfig.findUnique({
        where: { dormitoryId },
        select: {
          channelId: true,
          channelSecretEncrypted: true,
          channelAccessTokenEncrypted: true,
          isConnected: true,
        }
      });
      if (!config || !config.isConnected) return null;

      // 1. Legacy encrypted access token
      if (config.channelAccessTokenEncrypted) {
        try {
          return decryptText(config.channelAccessTokenEncrypted);
        } catch {}
      }

      // 2. Stateless OAuth via Channel ID + Channel Secret
      if (config.channelId && config.channelSecretEncrypted) {
        try {
          const secret = decryptText(config.channelSecretEncrypted);
          return await this.tokenProvider.getChannelAccessToken(config.channelId, secret);
        } catch {
          return null;
        }
      }

      return null;
    });
  }

  /**
   * Process raw LINE Webhook payload.
   * Flow: hash key -> minimal SECURITY DEFINER lookup -> set RLS context ->
   *       read full config under RLS -> verify HMAC -> process events.
   */
  async processWebhookEvent(rawKey: string, bodyBuffer: Buffer, signatureHeader: string) {
    const keyHash = hashToken(rawKey);

    // 1. Narrow SECURITY DEFINER lookup — returns ONLY routing identity
    const configs = await this.prisma.$queryRaw<any[]>`
      SELECT config_id, dormitory_id
      FROM public.resolve_line_webhook_config(${keyHash})
    `;

    if (!configs || configs.length === 0) {
      throw new AppError('LINE webhook endpoint configuration not found', 404, 'WEBHOOK_CONFIG_NOT_FOUND');
    }

    const resolvedDormitoryId = configs[0].dormitory_id as string;

    // 2. Begin transaction with RLS context to read full config
    return await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${resolvedDormitoryId}, true)`;

      // 3. Read full config under normal RLS
      const fullConfig = await tx.dormitoryLineConfig.findUnique({
        where: { dormitoryId: resolvedDormitoryId },
        select: {
          channelSecretEncrypted: true,
          channelAccessTokenEncrypted: true,
          isConnected: true,
          webhookVerifiedAt: true,
          id: true
        }
      });

      if (!fullConfig || !fullConfig.channelSecretEncrypted) {
        throw new AppError('LINE webhook config credentials not found', 404, 'WEBHOOK_CONFIG_NOT_FOUND');
      }

      // 4. Decrypt channel secret and verify HMAC signature
      const channelSecret = decryptText(fullConfig.channelSecretEncrypted);
      const isValid = verifyLineSignature(bodyBuffer, channelSecret, signatureHeader);
      if (!isValid) {
        throw new AppError('Invalid x-line-signature header', 401, 'INVALID_SIGNATURE');
      }

      // 5. Set webhookVerifiedAt on first successful HMAC verification
      if (!fullConfig.webhookVerifiedAt) {
        await tx.dormitoryLineConfig.update({
          where: { dormitoryId: resolvedDormitoryId },
          data: { webhookVerifiedAt: new Date() }
        });
      }

      // 6. Decrypt access token for profile lookups
      let accessToken: string | null = null;
      if (fullConfig.channelAccessTokenEncrypted) {
        try {
          accessToken = decryptText(fullConfig.channelAccessTokenEncrypted);
        } catch {
          accessToken = null;
        }
      }

      // 7. Parse payload
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

        try {
          // Deduplicate via unique constraint on webhook_event_id
          const receipt = await tx.lineWebhookEventReceipt.create({
            data: {
              dormitoryId: resolvedDormitoryId,
              webhookEventId: eventId,
              eventType: event.type || 'unknown',
              status: 'processing',
              receivedAt: new Date(),
              processedAt: null
            }
          });

          const lineUserId = event.source?.userId;
          if (lineUserId) {
            if (!accessToken) {
              accessToken = await this.resolveAccessToken(resolvedDormitoryId).catch(() => null);
            }
            let profile = accessToken ? await this.lineAdapter.getProfile(lineUserId, accessToken).catch(() => null) : null;
            const displayName = profile?.displayName || `LINE User (${lineUserId.slice(-4)})`;
            const pictureUrl = profile?.pictureUrl || null;

            if (event.type === 'follow') {
              await this.friendService.upsertFriendFromWebhook(
                resolvedDormitoryId, lineUserId, displayName, pictureUrl, 'FOLLOWING'
              );
            } else if (event.type === 'unfollow') {
              await this.friendService.upsertFriendFromWebhook(
                resolvedDormitoryId, lineUserId, displayName, pictureUrl, 'UNFOLLOWED'
              );
            } else if (event.type === 'message' || event.type === 'postback') {
              await this.friendService.upsertFriendFromWebhook(
                resolvedDormitoryId, lineUserId, displayName, pictureUrl, 'FOLLOWING'
              );
            }
          }

          await tx.lineWebhookEventReceipt.update({
            where: { id: receipt.id },
            data: { status: 'processed', processedAt: new Date() }
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

      return { success: true, processedCount, deduplicatedCount };
    });
  }
}
