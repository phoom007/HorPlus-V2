import { LineRepository, lineRepository } from '../db/repositories/line.repository.js';
import {
  LineMessagingProvider,
  MockLineMessagingProvider,
  LineAccessTokenProvider,
  MockLineAccessTokenProvider
} from './line-provider.interface.js';

export class LineWebhookService {
  constructor(
    private repo: LineRepository = lineRepository,
    private messagingProvider: LineMessagingProvider = new MockLineMessagingProvider(),
    private tokenProvider: LineAccessTokenProvider = new MockLineAccessTokenProvider()
  ) {}

  private decryptSecret(encrypted: string): string {
    try {
      const crypto = require('crypto');
      const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from('12345678901234567890123456789012'), Buffer.from('1234567890123456'));
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch {
      return encrypted;
    }
  }

  async processWebhook(params: {
    webhookPublicKey: string;
    signature: string;
    body: string;
    ipAddress?: string;
  }) {
    const integration = await this.repo.getIntegrationByPublicKey(params.webhookPublicKey);
    if (!integration) {
      await this.repo.recordWebhookAudit({
        webhookKey: params.webhookPublicKey,
        ipAddress: params.ipAddress,
        signature: params.signature,
        isValidSignature: false,
        statusCode: 404,
        errorMessage: 'INTEGRATION_NOT_FOUND'
      });
      return { status: 404, message: 'Integration not found' };
    }

    const channelSecret = this.decryptSecret(integration.channelSecretEncrypted);
    const isValid = await this.messagingProvider.verifyWebhookSignature({
      channelSecret,
      body: params.body,
      signature: params.signature
    });

    if (!isValid) {
      await this.repo.recordWebhookAudit({
        dormitoryId: integration.dormitoryId,
        lineOaIntegrationId: integration.id,
        webhookKey: params.webhookPublicKey,
        ipAddress: params.ipAddress,
        signature: params.signature,
        isValidSignature: false,
        statusCode: 401,
        errorMessage: 'INVALID_SIGNATURE'
      });
      return { status: 401, message: 'Invalid signature' };
    }

    await this.repo.updateLastWebhookTimestamp(integration.id);

    let payload: any;
    try {
      payload = JSON.parse(params.body);
    } catch {
      return { status: 400, message: 'Invalid JSON payload' };
    }

    const events = payload?.events || [];
    for (const event of events) {
      const eventId = event.webhookEventId || event.replyToken || `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

      const isDuplicate = await this.repo.hasProcessedWebhookEvent(eventId);
      if (isDuplicate) continue;

      const eventType = event.type || 'unknown';
      const sourceLineUserId = event.source?.userId;

      await this.repo.recordWebhookEvent({
        lineOaIntegrationId: integration.id,
        eventId,
        eventType,
        replyToken: event.replyToken,
        sourceLineUserId,
        payload: event,
        processed: true
      });

      await this.repo.recordWebhookAudit({
        dormitoryId: integration.dormitoryId,
        lineOaIntegrationId: integration.id,
        webhookKey: params.webhookPublicKey,
        ipAddress: params.ipAddress,
        signature: params.signature,
        isValidSignature: true,
        eventType,
        eventId,
        statusCode: 200
      });

      if (sourceLineUserId) {
        await this.handleSingleEvent({
          integration,
          event,
          eventType,
          sourceLineUserId
        });
      }
    }

    return { status: 200, message: 'OK' };
  }

  private async handleSingleEvent(params: {
    integration: any;
    event: any;
    eventType: string;
    sourceLineUserId: string;
  }) {
    const { integration, event, eventType, sourceLineUserId } = params;

    // Fetch or create LINE Identity
    let profile = { displayName: `LINE User (${sourceLineUserId.slice(0, 6)})`, pictureUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${sourceLineUserId}` };
    try {
      const token = await this.tokenProvider.getAccessToken(integration.id, integration.messagingChannelId, this.decryptSecret(integration.channelSecretEncrypted));
      profile = await this.messagingProvider.getProfile({ accessToken: token.accessToken, lineUserId: sourceLineUserId });
    } catch {
      // Mock fallback
    }

    const identity = await this.repo.upsertLineIdentity({
      lineUserId: sourceLineUserId,
      displayName: profile.displayName,
      pictureUrl: profile.pictureUrl
    });

    const friendStatus = eventType === 'unfollow' ? 'blocked_or_unfollowed' : 'following';
    await this.repo.upsertFollower({
      dormitoryId: integration.dormitoryId,
      lineOaIntegrationId: integration.id,
      lineIdentityId: identity.id,
      friendStatus
    });

    // Handle Follow or Message Events
    if (eventType === 'follow' || (eventType === 'message' && event.replyToken)) {
      await this.sendFollowReply({
        integration,
        identity,
        replyToken: event.replyToken
      });
    }
  }

  private async sendFollowReply(params: {
    integration: any;
    identity: any;
    replyToken?: string;
  }) {
    if (!params.replyToken) return;

    const { integration, identity, replyToken } = params;
    const dormitoryId = integration.dormitoryId;

    // Check staff role
    const staffRole = await this.repo.getRoleAssignment(dormitoryId, identity.id);
    // Check tenant binding
    const tenantBinding = await this.repo.getTenantBindingForIdentity(dormitoryId, identity.id);
    // Check pending registration
    const pendingRegistration = await this.repo.getPendingRegistrationForIdentity(dormitoryId, identity.id);

    let replyText = 'ยินดีต้อนรับสู่หอพัก\n\nลงทะเบียนผู้เช่าเพื่อเข้าใช้งานระบบบิล ใบเสร็จ สัญญา และแจ้งซ่อม';
    let buttonLabel = 'ลงทะเบียนผู้เช่า';
    let liffUrl = `${integration.liffEndpointUrl || 'https://liff.line.me/' + (integration.liffId || 'mock-liff-id')}`;

    if (staffRole && staffRole.status === 'active') {
      replyText = 'ยินดีต้อนรับกลับ\n\nคุณมีสิทธิ์เข้าใช้งานระบบหอพัก';
      buttonLabel = 'เปิดระบบ';
    } else if (tenantBinding && tenantBinding.status === 'active') {
      replyText = 'ยินดีต้อนรับกลับ\n\nคุณสามารถเปิดระบบผู้เช่าได้แล้ว';
      buttonLabel = 'เปิดระบบผู้เช่า';
    } else if (pendingRegistration) {
      replyText = 'คำขอลงทะเบียนของคุณกำลังรออนุมัติ';
      buttonLabel = 'ตรวจสอบสถานะ';
    }

    const messages = [
      {
        type: 'text',
        text: `${replyText}\n\n👉 [ ${buttonLabel} ]\n${liffUrl}`
      }
    ];

    try {
      const token = await this.tokenProvider.getAccessToken(integration.id, integration.messagingChannelId, this.decryptSecret(integration.channelSecretEncrypted));
      const deliveryRes = await this.messagingProvider.sendReply({
        accessToken: token.accessToken,
        replyToken,
        messages
      });

      // System replies are free (isQuotaCounted = false)
      if (deliveryRes.success) {
        await this.repo.createOutboxAndDelivery({
          dormitoryId,
          lineOaIntegrationId: integration.id,
          recipientLineIdentityId: identity.id,
          messageCategory: 'webhook_reply',
          deliveryType: 'reply',
          payload: { text: replyText, buttonLabel, liffUrl },
          idempotencyKey: `reply_${replyToken}`
        });
      }
    } catch {
      // Mock handling
    }
  }
}

export const lineWebhookService = new LineWebhookService();
