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
    const host = process.env.PUBLIC_APP_URL || 'https://api.horplus.com';
    const webhookUrl = `${host}/api/v1/webhooks/line/${integration.webhookPublicKey}`;

    return {
      id: integration.id,
      connected: integration.status === 'connected' || integration.status === 'active',
      status: integration.status,
      messagingChannelId: integration.messagingChannelId,
      channelSecretMasked: this.maskSecret(rawSecret),
      lineLoginChannelId: integration.lineLoginChannelId,
      liffId: integration.liffId,
      liffEndpointUrl: integration.liffEndpointUrl,
      webhookUrl,
      webhookPublicKey: integration.webhookPublicKey,
      botDisplayName: integration.botDisplayName || 'หอพัก HorPlus OA',
      botPictureUrl: integration.botPictureUrl || 'https://api.dicebear.com/7.x/bottts/svg?seed=horplus_oa',
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
    // If user didn't change masked secret, keep existing secret
    if (params.channelSecret.includes('••••')) {
      const existing = await this.repo.getIntegrationByDormitory(params.dormitoryId);
      if (existing) {
        secretToEncrypt = this.decryptSecret(existing.channelSecretEncrypted);
      }
    }

    const encryptedSecret = this.encryptSecret(secretToEncrypt);

    // Get Bot Info
    let botInfo = { botUserId: 'U_bot_default', displayName: 'หอพัก HorPlus OA', pictureUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=horplus_oa' };
    try {
      const token = await this.tokenProvider.getAccessToken('temp_id', params.messagingChannelId, secretToEncrypt);
      botInfo = await this.messagingProvider.getBotInfo(token.accessToken);
    } catch {
      // Mock fallback
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

  async testConnection(dormitoryId: string) {
    const integration = await this.repo.getIntegrationByDormitory(dormitoryId);
    if (!integration) {
      throw new Error('NO_LINE_INTEGRATION_FOUND');
    }

    const secret = this.decryptSecret(integration.channelSecretEncrypted);
    try {
      const token = await this.tokenProvider.getAccessToken(integration.id, integration.messagingChannelId, secret);
      const botInfo = await this.messagingProvider.getBotInfo(token.accessToken);

      await this.repo.upsertIntegration({
        dormitoryId,
        messagingChannelId: integration.messagingChannelId,
        channelSecretEncrypted: integration.channelSecretEncrypted,
        botUserId: botInfo.botUserId,
        botDisplayName: botInfo.displayName,
        botPictureUrl: botInfo.pictureUrl,
        status: 'connected',
        lastConnectionCheckAt: new Date()
      });

      return {
        success: true,
        message: 'เชื่อมต่อ LINE OA สำเร็จและพร้อมใช้งาน',
        botDisplayName: botInfo.displayName,
        botPictureUrl: botInfo.pictureUrl
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
    const identity = await this.repo.upsertLineIdentity({
      lineUserId: verified.lineUserId,
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
