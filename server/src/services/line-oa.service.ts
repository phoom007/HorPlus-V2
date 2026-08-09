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
import { LineChannelTokenProvider, ILineChannelTokenProvider, FakeLineTokenProvider } from './line-channel-token-provider.js';

export function getPublicWebhookOrigin(): string {
  const origin = process.env.PUBLIC_WEBHOOK_ORIGIN || process.env.PUBLIC_APP_ORIGIN || process.env.APPLICATION_URL || (process.env.NODE_ENV === 'production' ? 'https://app.horplus.com' : 'http://127.0.0.1:3001');
  return origin.replace(/\/+$/, '');
}

export class LineOaService {
  private friendService: LineFriendService;
  private lineAdapter: LinePlatformAdapter;
  private tokenProvider: ILineChannelTokenProvider;

  constructor(private prisma: PrismaClient, adapter?: LinePlatformAdapter, tokenProvider?: ILineChannelTokenProvider) {
    this.friendService = new LineFriendService(prisma);
    if (adapter && tokenProvider) {
      this.lineAdapter = adapter;
      this.tokenProvider = tokenProvider;
    } else if (adapter && !tokenProvider) {
      this.lineAdapter = adapter;
      if (adapter instanceof MockLinePlatformAdapter) {
        this.tokenProvider = new FakeLineTokenProvider();
      } else {
        this.tokenProvider = new LineChannelTokenProvider();
      }
    } else if (process.env.NODE_ENV === 'test' && process.env.HORPLUS_E2E !== 'true') {
      this.lineAdapter = new MockLinePlatformAdapter();
      this.tokenProvider = tokenProvider || new FakeLineTokenProvider();
    } else {
      this.lineAdapter = createLinePlatformAdapter();
      this.tokenProvider = tokenProvider || new LineChannelTokenProvider();
    }
  }

  /**
   * Get LINE OA connection status (Secrets REDACTED)
   */
  async getDormitoryLineConfig(dormitoryId: string, baseUrl = getPublicWebhookOrigin()) {
    return await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;

      const config = await tx.dormitoryLineConfig.findUnique({
        where: { dormitoryId }
      });

      if (!config) {
        return {
          connected: false,
          isReady: false,
          credentialsVerified: false,
          webhookEndpointSet: false,
          webhookTestSucceeded: false,
          webhookActive: false,
          hasChannelSecret: false,
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
        } catch {
          webhookUrl = null;
        }
      }

      const credentialsVerified = !!(config.channelId && config.channelSecretEncrypted && config.accessTokenVerifiedAt);
      const webhookEndpointSet = !!config.webhookEndpointSetAt;
      const webhookTestSucceeded = !!config.webhookTestSucceededAt;
      const webhookActive = Boolean(config.webhookActive);
      const isReady = credentialsVerified && webhookEndpointSet && webhookTestSucceeded && webhookActive;

      return {
        connected: credentialsVerified,
        isReady,
        credentialsVerified,
        webhookEndpointSet,
        webhookTestSucceeded,
        webhookActive,
        hasChannelSecret: !!config.channelSecretEncrypted,
        hasAccessToken: !!config.accessTokenVerifiedAt,
        lineOaId: config.lineOaId,
        channelId: config.channelId,
        accessTokenVerifiedAt: config.accessTokenVerifiedAt,
        webhookVerifiedAt: config.webhookVerifiedAt,
        webhookEndpointSetAt: config.webhookEndpointSetAt,
        webhookTestSucceededAt: config.webhookTestSucceededAt,
        webhookUrl
      };
    });
  }

  /**
   * Configure LINE OA Channel ID & Channel Secret ONLY.
   * Access token is statelessly issued and verified via GET /v2/bot/info.
   */
  async updateDormitoryLineConfig(
    dormitoryId: string,
    data: { channelId?: string; channelSecret?: string; lineOaId?: string },
    baseUrl = getPublicWebhookOrigin()
  ) {
    return await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;

      const existing = await tx.dormitoryLineConfig.findUnique({
        where: { dormitoryId }
      });

      let channelSecretEncrypted = existing?.channelSecretEncrypted;
      let accessTokenVerifiedAt = existing?.accessTokenVerifiedAt;
      let lineOaId = data.lineOaId || existing?.lineOaId;

      const isChannelIdChanged = data.channelId && data.channelId !== existing?.channelId;
      const isSecretProvided = !!data.channelSecret;

      if (isChannelIdChanged || isSecretProvided) {
        const channelIdToVerify = data.channelId || existing?.channelId;
        const channelSecretToVerify = data.channelSecret || (existing?.channelSecretEncrypted ? decryptText(existing.channelSecretEncrypted) : null);

        if (channelIdToVerify && channelSecretToVerify) {
          if (existing?.channelId) {
            await this.tokenProvider.clearCache?.(existing.channelId);
          }
          if (channelIdToVerify) {
            await this.tokenProvider.clearCache?.(channelIdToVerify);
          }

          const statelessToken = await this.tokenProvider.getChannelAccessToken(channelIdToVerify, channelSecretToVerify);
          const verification = await this.lineAdapter.verifyAccessToken(statelessToken);

          if (!verification.verified) {
            throw new AppError('LINE Channel Credentials validation failed. Check your Channel ID and Secret.', 400, 'INVALID_CHANNEL_CREDENTIALS');
          }

          accessTokenVerifiedAt = new Date();
          if (verification.botInfo?.basicId) {
            lineOaId = verification.botInfo.basicId;
          }
        }
      }

      if (data.channelSecret) {
        channelSecretEncrypted = encryptText(data.channelSecret);
      }

      let encryptedWebhookKey = existing?.webhookKeyEncrypted;
      let webhookKeyHash = existing?.webhookKeyHash;
      if (!encryptedWebhookKey) {
        const opaque = generateOpaqueWebhookKey();
        encryptedWebhookKey = opaque.keyEncrypted;
        webhookKeyHash = opaque.keyHash;
      }

      const updated = await tx.dormitoryLineConfig.upsert({
        where: { dormitoryId },
        create: {
          dormitoryId,
          channelId: data.channelId || null,
          channelSecretEncrypted: channelSecretEncrypted || null,
          lineOaId: lineOaId || null,
          webhookKeyHash: webhookKeyHash!,
          webhookKeyEncrypted: encryptedWebhookKey!,
          accessTokenVerifiedAt,
          webhookActive: false,
          isConnected: false,
        },
        update: {
          channelId: data.channelId !== undefined ? data.channelId : existing?.channelId,
          channelSecretEncrypted,
          lineOaId,
          accessTokenVerifiedAt,
        }
      });

      let webhookUrl: string | null = null;
      if (updated.webhookKeyEncrypted) {
        try {
          const rawKey = decryptText(updated.webhookKeyEncrypted);
          webhookUrl = `${baseUrl}/api/v1/line/webhook/${rawKey}`;
        } catch {
          webhookUrl = null;
        }
      }

      const credentialsVerified = !!(updated.channelId && updated.channelSecretEncrypted && updated.accessTokenVerifiedAt);
      const webhookEndpointSet = !!updated.webhookEndpointSetAt;
      const webhookTestSucceeded = !!updated.webhookTestSucceededAt;
      const webhookActive = Boolean(updated.webhookActive);
      const isReady = credentialsVerified && webhookEndpointSet && webhookTestSucceeded && webhookActive;

      return {
        connected: credentialsVerified,
        isReady,
        credentialsVerified,
        webhookEndpointSet,
        webhookTestSucceeded,
        webhookActive,
        hasChannelSecret: !!updated.channelSecretEncrypted,
        hasAccessToken: !!updated.accessTokenVerifiedAt,
        lineOaId: updated.lineOaId,
        channelId: updated.channelId,
        accessTokenVerifiedAt: updated.accessTokenVerifiedAt,
        webhookVerifiedAt: updated.webhookVerifiedAt,
        webhookUrl
      };
    });
  }

  /**
   * Set Webhook Endpoint on LINE Platform
   */
  async setWebhookEndpoint(dormitoryId: string, baseUrl = getPublicWebhookOrigin()) {
    let config = await this.getDormitoryLineConfig(dormitoryId, baseUrl);
    if (!config.credentialsVerified) {
      throw new AppError('Credentials must be verified before setting webhook endpoint', 400, 'LINE_CREDENTIALS_REQUIRED');
    }

    if (!config.webhookUrl) {
      await this.rotateWebhookKey(dormitoryId, baseUrl);
      config = await this.getDormitoryLineConfig(dormitoryId, baseUrl);
    }

    if (!config.webhookUrl) {
      throw new AppError('Webhook URL is missing', 400, 'WEBHOOK_URL_MISSING');
    }

    const accessToken = await this.resolveAccessToken(dormitoryId);
    if (!accessToken) {
      throw new AppError('Failed to acquire stateless token for webhook setup', 500, 'TOKEN_ISSUANCE_FAILED');
    }

    const setRes = await this.lineAdapter.setWebhookEndpoint(config.webhookUrl, accessToken);
    if (!setRes.success) {
      throw new AppError('Failed to set webhook endpoint on LINE platform', 400, 'LINE_WEBHOOK_SET_FAILED');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;
      await tx.dormitoryLineConfig.update({
        where: { dormitoryId },
        data: { webhookEndpointSetAt: new Date() },
      });
    });

    return await this.getDormitoryLineConfig(dormitoryId, baseUrl);
  }

  /**
   * Test Webhook Endpoint on LINE Platform (Fail-closed on webhookActive)
   */
  async testWebhookEndpoint(dormitoryId: string, baseUrl = getPublicWebhookOrigin()) {
    const config = await this.getDormitoryLineConfig(dormitoryId, baseUrl);
    if (!config.webhookUrl) {
      throw new AppError('Webhook URL is missing', 400, 'WEBHOOK_URL_MISSING');
    }

    const accessToken = await this.resolveAccessToken(dormitoryId);
    if (!accessToken) {
      throw new AppError('Failed to acquire stateless token for webhook test', 500, 'TOKEN_ISSUANCE_FAILED');
    }

    const testResult = await this.lineAdapter.testWebhookEndpoint(config.webhookUrl, accessToken);
    const getEndpointInfo = await this.lineAdapter.getWebhookEndpoint(accessToken);

    // LINE-02: webhookTestSucceeded and webhookActive are strictly separated and fail-closed
    const webhookTestSucceeded = testResult.success === true;
    const isWebhookActive = Boolean(getEndpointInfo && getEndpointInfo.active === true);

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;
      await tx.dormitoryLineConfig.update({
        where: { dormitoryId },
        data: {
          webhookTestSucceededAt: webhookTestSucceeded ? new Date() : null,
          webhookActive: isWebhookActive,
          webhookActiveCheckedAt: new Date(),
          isConnected: webhookTestSucceeded && isWebhookActive,
        },
      });
    });

    return {
      testResult,
      config: await this.getDormitoryLineConfig(dormitoryId, baseUrl),
    };
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
          isReady: false,
          credentialsVerified: false,
          webhookEndpointSet: false,
          webhookTestSucceeded: false,
          webhookActive: false,
          hasChannelSecret: false,
          lineOaId: null,
          channelId: null,
          accessTokenVerifiedAt: null,
          webhookVerifiedAt: null,
          webhookUrl: null
        };
      }

      await tx.dormitoryLineConfig.update({
        where: { dormitoryId },
        data: {
          isConnected: false,
          webhookActive: false,
          webhookEndpointSetAt: null,
          webhookTestSucceededAt: null,
        }
      });

      return {
        connected: false,
        isReady: false,
        credentialsVerified: !!(existing.channelId && existing.channelSecretEncrypted && existing.accessTokenVerifiedAt),
        webhookEndpointSet: false,
        webhookTestSucceeded: false,
        webhookActive: false,
        hasChannelSecret: !!existing.channelSecretEncrypted,
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
  async rotateWebhookKey(dormitoryId: string, baseUrl = getPublicWebhookOrigin()) {
    return await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;

      const opaque = generateOpaqueWebhookKey();

      const updated = await tx.dormitoryLineConfig.update({
        where: { dormitoryId },
        data: {
          webhookKeyHash: opaque.keyHash,
          webhookKeyEncrypted: opaque.keyEncrypted,
          webhookVerifiedAt: null,
          webhookEndpointSetAt: null,
          webhookTestSucceededAt: null,
          webhookActive: false,
          isConnected: false,
        }
      });

      let webhookUrl: string | null = null;
      if (updated.webhookKeyEncrypted) {
        try {
          const rawKey = decryptText(updated.webhookKeyEncrypted);
          webhookUrl = `${baseUrl}/api/v1/line/webhook/${rawKey}`;
        } catch {
          webhookUrl = null;
        }
      }

      return {
        connected: false,
        isReady: false,
        credentialsVerified: !!(updated.channelId && updated.channelSecretEncrypted && updated.accessTokenVerifiedAt),
        webhookEndpointSet: false,
        webhookTestSucceeded: false,
        webhookActive: false,
        hasChannelSecret: !!updated.channelSecretEncrypted,
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
        }
      });
      if (!config) return null;

      if (config.channelAccessTokenEncrypted) {
        try {
          return decryptText(config.channelAccessTokenEncrypted);
        } catch {}
      }

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
   */
  async processWebhookEvent(rawKey: string, bodyBuffer: Buffer, signatureHeader: string) {
    const keyHash = hashToken(rawKey);

    const configs = await this.prisma.$queryRaw<any[]>`
      SELECT config_id, dormitory_id
      FROM public.resolve_line_webhook_config(${keyHash})
    `;

    if (!configs || configs.length === 0) {
      throw new AppError('LINE webhook endpoint configuration not found', 404, 'WEBHOOK_CONFIG_NOT_FOUND');
    }

    const resolvedDormitoryId = configs[0].dormitory_id as string;

    return await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${resolvedDormitoryId}, true)`;

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

      const channelSecret = decryptText(fullConfig.channelSecretEncrypted);
      const isValid = verifyLineSignature(bodyBuffer, channelSecret, signatureHeader);
      if (!isValid) {
        throw new AppError('Invalid x-line-signature header', 401, 'INVALID_SIGNATURE');
      }

      if (!fullConfig.webhookVerifiedAt) {
        await tx.dormitoryLineConfig.update({
          where: { dormitoryId: resolvedDormitoryId },
          data: { webhookVerifiedAt: new Date() }
        });
      }

      let accessToken: string | null = null;
      if (fullConfig.channelAccessTokenEncrypted) {
        try {
          accessToken = decryptText(fullConfig.channelAccessTokenEncrypted);
        } catch {
          accessToken = null;
        }
      }

      let payload: any = {};
      try {
        payload = JSON.parse(bodyBuffer.toString('utf8'));
      } catch {
        throw new AppError('Failed to parse webhook JSON body', 400, 'INVALID_JSON_BODY');
      }

      const events = payload.events || [];
      let processedCount = 0;
      let deduplicatedCount = 0;

      for (const event of events) {
        const eventId = event.webhookEventId || event.eventId || `${event.type}_${event.timestamp}_${event.source?.userId}`;

        try {
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
                resolvedDormitoryId, lineUserId, displayName, pictureUrl, 'FOLLOWING', tx
              );
            } else if (event.type === 'unfollow') {
              await this.friendService.upsertFriendFromWebhook(
                resolvedDormitoryId, lineUserId, displayName, pictureUrl, 'UNFOLLOWED', tx
              );
            } else if (event.type === 'message' || event.type === 'postback') {
              await this.friendService.upsertFriendFromWebhook(
                resolvedDormitoryId, lineUserId, displayName, pictureUrl, 'FOLLOWING', tx
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
