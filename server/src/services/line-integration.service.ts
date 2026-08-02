import crypto from 'crypto';
import { LineRepository, lineRepository } from '../db/repositories/line.repository.js';
import {
  LineAccessTokenProvider,
  LineMessagingProvider,
  MockLineAccessTokenProvider,
  MockLineMessagingProvider,
  LiffIdentityVerifier,
  MockLiffIdentityVerifier
} from './line-provider.interface.js';
import { auditService } from './audit.service.js';
import { getRedisClient } from '../db/redis.js';

export class LineIntegrationService {
  constructor(
    private repo: LineRepository = lineRepository,
    private tokenProvider: LineAccessTokenProvider = new MockLineAccessTokenProvider(),
    private messagingProvider: LineMessagingProvider = new MockLineMessagingProvider(),
    private liffVerifier: LiffIdentityVerifier = new MockLiffIdentityVerifier()
  ) {}

  private encryptSecret(secret: string): string {
    // Simple symmetric encryption for stored channel secret in sandbox
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from('12345678901234567890123456789012'), Buffer.from('1234567890123456'));
    let encrypted = cipher.update(secret, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return encrypted;
  }

  private decryptSecret(encrypted: string): string {
    try {
      const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from('12345678901234567890123456789012'), Buffer.from('1234567890123456'));
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch {
      return encrypted;
    }
  }

  private maskSecret(secret: string): string {
    if (!secret || secret.length <= 4) return '••••••••';
    return `${secret.slice(0, 2)}••••••••••••${secret.slice(-2)}`;
  }

  async getIntegrationSettings(dormitoryId: string) {
    const integration = await this.repo.getIntegrationByDormitory(dormitoryId);
    if (!integration) {
      return {
        connected: false,
        status: 'disconnected',
        messagingChannelId: null,
        channelSecretMasked: null,
        lineLoginChannelId: null,
        liffId: null,
        liffEndpointUrl: null,
        webhookUrl: null,
        botDisplayName: null,
        botPictureUrl: null,
        lastConnectionCheckAt: null,
        lastWebhookReceivedAt: null
      };
    }

    const rawSecret = this.decryptSecret(integration.channelSecretEncrypted);
    const host = (process.env.PUBLIC_APP_ORIGIN || process.env.PUBLIC_APP_URL || process.env.APP_URL || 'https://desktop-sgg6vot.tail359964.ts.net').replace(/\/+$/, '');
    const webhookUrl = `${host}/api/v1/webhooks/line/${integration.webhookPublicKey}`;

    return {
      id: integration.id,
      connected: integration.status === 'connected' || integration.status === 'active',
      status: integration.status,
      messagingChannelId: integration.messagingChannelId,
      channelSecretMasked: this.maskSecret(rawSecret),
      lineLoginChannelId: integration.lineLoginChannelId,
      liffId: integration.liffId,
      liffEndpointUrl: integration.liffId ? `https://liff.line.me/${integration.liffId}` : null,
      webhookUrl,
      webhookPublicKey: integration.webhookPublicKey,
      botDisplayName: integration.botDisplayName || null,
      botPictureUrl: integration.botPictureUrl || null,
      lastConnectionCheckAt: integration.lastConnectionCheckAt,
      lastWebhookReceivedAt: integration.lastWebhookReceivedAt
    };
  }

  async saveIntegrationSettings(params: {
    dormitoryId: string;
    messagingChannelId: string;
    channelSecret: string;
    lineLoginChannelId?: string;
    liffId?: string;
    liffEndpointUrl?: string;
    userId?: string;
  }) {
    let secretToEncrypt = params.channelSecret;
    if (params.channelSecret.includes('••••')) {
      const existing = await this.repo.getIntegrationByDormitory(params.dormitoryId);
      if (existing) {
        secretToEncrypt = this.decryptSecret(existing.channelSecretEncrypted);
      }
    }

    const encryptedSecret = this.encryptSecret(secretToEncrypt);

    let botInfo = { botUserId: 'U_bot_default', displayName: 'หอพัก HorPlus OA', pictureUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=horplus_oa' };
    
    const existing = await this.repo.getIntegrationByDormitory(params.dormitoryId);
    if (existing) {
      botInfo = {
        botUserId: existing.botUserId || botInfo.botUserId,
        displayName: existing.botDisplayName || botInfo.displayName,
        pictureUrl: existing.botPictureUrl || botInfo.pictureUrl
      };
    }

    try {
      if (secretToEncrypt) {
        const token = await this.requestTemporaryAccessToken(params.messagingChannelId, secretToEncrypt);
        const response = await fetch('https://api.line.me/v2/bot/info', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
          const fetchedInfo = await response.json() as any;
          botInfo = {
            botUserId: fetchedInfo.basicId || botInfo.botUserId,
            displayName: fetchedInfo.displayName || botInfo.displayName,
            pictureUrl: fetchedInfo.pictureUrl || botInfo.pictureUrl
          };
        } else if (response.status === 401) {
          const redis = getRedisClient();
          await redis.del(`line_token:${params.messagingChannelId}`).catch(() => {});
        }
      }
    } catch (err) {
      console.error('Failed to fetch bot info during save:', err);
    }

    const integration = await this.repo.upsertIntegration({
      dormitoryId: params.dormitoryId,
      messagingChannelId: params.messagingChannelId,
      channelSecretEncrypted: encryptedSecret,
      lineLoginChannelId: params.lineLoginChannelId,
      liffId: params.liffId,
      liffEndpointUrl: params.liffEndpointUrl,
      botUserId: botInfo.botUserId,
      botDisplayName: botInfo.displayName,
      botPictureUrl: botInfo.pictureUrl,
      status: 'connected',
      connectedAt: new Date(),
      lastConnectionCheckAt: new Date(),
      createdByUserId: params.userId
    });

    await auditService.record({
      dormitoryId: params.dormitoryId,
      actorUserId: params.userId,
      actorRole: 'OWNER',
      action: 'LINE_OA_CONNECTED',
      targetType: 'line_oa_integration',
      targetId: integration.id,
      summary: 'เชื่อมต่อ LINE OA สำเร็จ'
    });

    return this.getIntegrationSettings(params.dormitoryId);
  }

  async requestTemporaryAccessToken(channelId: string, channelSecret: string): Promise<string> {
    const redis = getRedisClient();
    const cacheKey = `line_token:${channelId}`;
    
    try {
      const cachedToken = await redis.get(cacheKey);
      if (cachedToken) return cachedToken;
    } catch (err) {
      console.warn('Redis error while getting cached token, proceeding to issue new one:', err);
    }

    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', channelId);
    params.append('client_secret', channelSecret);

    const response = await fetch('https://api.line.me/oauth2/v3/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    if (!response.ok) {
      console.error('Failed to issue LINE access token', await response.text());
      throw new Error('FAILED_TO_ISSUE_TOKEN');
    }

    const data = await response.json() as any;
    const token = data.access_token;
    const expiresIn = data.expires_in;

    try {
      const ttl = Math.max(0, expiresIn - 3600); // 1 hour buffer
      if (ttl > 0) {
        await redis.setex(cacheKey, ttl, token);
      }
    } catch (err) {
      console.warn('Redis error while saving issued token:', err);
    }

    return token;
  }

  async testConnection(dormitoryId: string, providedSecret?: string) {
    const integration = await this.repo.getIntegrationByDormitory(dormitoryId);
    if (!integration) {
      throw new Error('NO_LINE_INTEGRATION_FOUND');
    }

    const secret = providedSecret || this.decryptSecret(integration.channelSecretEncrypted);
    try {
      const accessToken = await this.requestTemporaryAccessToken(integration.messagingChannelId, secret);

      const response = await fetch('https://api.line.me/v2/bot/info', {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      
      if (!response.ok) {
        if (response.status === 401) {
          const redis = getRedisClient();
          await redis.del(`line_token:${integration.messagingChannelId}`).catch(() => {});
        }
        throw new Error('UNAUTHORIZED');
      }
      
      const info = await response.json() as any;
      const botUserId = info.basicId || info.userId;

      await this.repo.upsertIntegration({
        dormitoryId,
        messagingChannelId: integration.messagingChannelId,
        channelSecretEncrypted: this.encryptSecret(secret),
        botUserId: botUserId,
        botDisplayName: info.displayName,
        botPictureUrl: info.pictureUrl,
        status: 'connected',
        lastConnectionCheckAt: new Date()
      });

      return {
        success: true,
        displayName: info.displayName,
        pictureUrl: info.pictureUrl,
        basicId: botUserId,
        status: 'connected'
      };
    } catch (err: any) {
      await this.repo.updateIntegrationStatus(integration.id, 'token_error');
      return {
        success: false,
        message: 'ไม่สามารถเชื่อมต่อ LINE OA ได้ กรุณาตรวจสอบ Channel ID และ Channel Secret'
      };
    }
  }

  async disconnectIntegration(dormitoryId: string, userId?: string) {
    const result = await this.repo.disconnectIntegration(dormitoryId);
    if (result) {
      await auditService.record({
        dormitoryId,
        actorUserId: userId,
        actorRole: 'OWNER',
        action: 'LINE_OA_DISCONNECTED',
        targetType: 'line_oa_integration',
        targetId: result.id,
        summary: 'ยกเลิกการเชื่อมต่อ LINE OA'
      });
    }
    return { success: true };
  }

  async bindOwnerLineAccount(params: {
    dormitoryId: string;
    userId: string;
    memberId: string;
    liffIdToken: string;
  }) {
    const verified = await this.liffVerifier.verifyIdentityToken({ idToken: params.liffIdToken });

    // Upsert line identity
    const identity = await this.repo.upsertLineIdentity(verified.lineUserId, {
      displayName: verified.displayName,
      pictureUrl: verified.pictureUrl
    });

    // Create OWNER role assignment
    const assignment = await this.repo.upsertRoleAssignment({
      dormitoryId: params.dormitoryId,
      lineIdentityId: identity.id,
      dormitoryMemberId: params.memberId,
      roleCode: 'OWNER',
      assignedByUserId: params.userId
    });

    await auditService.record({
      dormitoryId: params.dormitoryId,
      actorUserId: params.userId,
      actorRole: 'OWNER',
      action: 'OWNER_LINE_BOUND',
      targetType: 'line_role_assignment',
      targetId: assignment.id,
      summary: `ผูกบัญชี LINE ของเจ้าของสำเร็จ (${verified.displayName})`
    });

    return {
      success: true,
      lineUserId: identity.lineUserId,
      displayName: identity.displayName,
      roleCode: 'OWNER'
    };
  }
}

export const lineIntegrationService = new LineIntegrationService();
