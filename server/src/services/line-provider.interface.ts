import crypto from 'crypto';

export interface LineAccessTokenResult {
  accessToken: string;
  expiresInSeconds: number;
}

export interface VerifyWebhookInput {
  channelSecret: string;
  body: string;
  signature: string;
}

export interface GetLineProfileInput {
  accessToken: string;
  lineUserId: string;
}

export interface LineProfile {
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
  statusMessage?: string;
}

export interface SendReplyInput {
  accessToken: string;
  replyToken: string;
  messages: any[];
}

export interface SendDirectNotificationInput {
  accessToken: string;
  recipientLineUserId: string;
  messages: any[];
}

export interface LineBotInfo {
  botUserId: string;
  displayName: string;
  pictureUrl?: string;
}

export interface LineDeliveryResult {
  success: boolean;
  providerMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface VerifyLiffIdentityInput {
  idToken: string;
  channelId?: string;
}

export interface VerifiedLineIdentity {
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
  statusMessage?: string;
}

export interface LineAccessTokenProvider {
  getAccessToken(integrationId: string, channelId: string, channelSecret: string): Promise<LineAccessTokenResult>;
  invalidateAccessToken(integrationId: string): Promise<void>;
}

export interface LineMessagingProvider {
  verifyWebhookSignature(input: VerifyWebhookInput): Promise<boolean>;
  getProfile(input: GetLineProfileInput): Promise<LineProfile>;
  sendReply(input: SendReplyInput): Promise<LineDeliveryResult>;
  sendDirectNotification(input: SendDirectNotificationInput): Promise<LineDeliveryResult>;
  getBotInfo(accessToken: string): Promise<LineBotInfo>;
  pushMessage?(input: any): Promise<LineDeliveryResult>;
}

export interface LiffIdentityVerifier {
  verifyIdentityToken(input: VerifyLiffIdentityInput): Promise<VerifiedLineIdentity>;
}

// ==========================================
// MOCK IMPLEMENTATIONS (For AI Studio / Tests)
// ==========================================

export class MockLineAccessTokenProvider implements LineAccessTokenProvider {
  private cache = new Map<string, LineAccessTokenResult>();

  async getAccessToken(integrationId: string, _channelId: string, _channelSecret: string): Promise<LineAccessTokenResult> {
    const existing = this.cache.get(integrationId);
    if (existing) return existing;

    const mockToken: LineAccessTokenResult = {
      accessToken: `mock_access_token_${integrationId}_${Date.now()}`,
      expiresInSeconds: 2592000 // 30 days
    };
    this.cache.set(integrationId, mockToken);
    return mockToken;
  }

  async invalidateAccessToken(integrationId: string): Promise<void> {
    this.cache.delete(integrationId);
  }
}

export class MockLineMessagingProvider implements LineMessagingProvider {
  public failNextSend = false;

  async verifyWebhookSignature(input: VerifyWebhookInput): Promise<boolean> {
    if (!input.signature) return false;
    if (input.signature === 'invalid_signature_test') return false;
    if (input.signature.startsWith('mock_sig_')) return true;

    // Verify HMAC-SHA256
    try {
      const hmac = crypto.createHmac('sha256', input.channelSecret);
      hmac.update(input.body);
      const expected = hmac.digest('base64');
      return input.signature === expected;
    } catch {
      return false;
    }
  }

  async getProfile(input: GetLineProfileInput): Promise<LineProfile> {
    return {
      lineUserId: input.lineUserId,
      displayName: `LINE User (${input.lineUserId.slice(0, 6)})`,
      pictureUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${input.lineUserId}`
    };
  }

  async sendReply(_input: SendReplyInput): Promise<LineDeliveryResult> {
    if (this.failNextSend) {
      this.failNextSend = false;
      return { success: false, errorCode: 'MOCK_SEND_FAILED', errorMessage: 'Mock sending failed' };
    }
    return { success: true, providerMessageId: `msg_reply_${Date.now()}` };
  }

  async sendDirectNotification(_input: SendDirectNotificationInput): Promise<LineDeliveryResult> {
    if (this.failNextSend) {
      this.failNextSend = false;
      return { success: false, errorCode: 'MOCK_SEND_FAILED', errorMessage: 'Mock sending failed' };
    }
    return { success: true, providerMessageId: `msg_direct_${Date.now()}` };
  }

  async pushMessage(_input: any): Promise<LineDeliveryResult> {
    return this.sendDirectNotification(_input as any);
  }

  async getBotInfo(_accessToken: string): Promise<LineBotInfo> {
    return {
      botUserId: 'U_bot_horplus_oa',
      displayName: 'หอพัก HorPlus OA',
      pictureUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=horplus_oa'
    };
  }
}

export class MockLiffIdentityVerifier implements LiffIdentityVerifier {
  async verifyIdentityToken(input: VerifyLiffIdentityInput): Promise<VerifiedLineIdentity> {
    if (input.idToken === 'invalid_liff_token') {
      throw new Error('INVALID_LIFF_TOKEN');
    }

    let lineUserId = 'U_mock_line_user_001';
    let displayName = 'สมชาย ใจดี (LINE)';

    if (input.idToken.includes('owner')) {
      lineUserId = 'U_owner_line_user_999';
      displayName = 'เจ้าของหอพัก (LINE)';
    } else if (input.idToken.includes('manager')) {
      lineUserId = 'U_manager_line_user_888';
      displayName = 'ผู้จัดการ (LINE)';
    } else if (input.idToken.includes('tech')) {
      lineUserId = 'U_tech_line_user_777';
      displayName = 'ช่างแม่บ้าน (LINE)';
    } else if (input.idToken.includes('tenant')) {
      lineUserId = 'U_tenant_line_user_111';
      displayName = 'ผู้เช่า (LINE)';
    } else if (input.idToken.startsWith('U_')) {
      lineUserId = input.idToken;
      displayName = `ผู้ใช้ LINE (${input.idToken})`;
    }

    return {
      lineUserId,
      displayName,
      pictureUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${lineUserId}`
    };
  }
}

// ==========================================
// PRODUCTION SKELETONS (External Required)
// ==========================================

export class ProductionLineAccessTokenProviderSkeleton implements LineAccessTokenProvider {
  async getAccessToken(_integrationId: string, _channelId: string, _channelSecret: string): Promise<LineAccessTokenResult> {
    throw new Error('EXTERNAL_VERIFICATION_REQUIRED: Production LINE Access Token API client requires live LINE Developers deployment.');
  }

  async invalidateAccessToken(_integrationId: string): Promise<void> {
    // Skeleton implementation
  }
}

export class ProductionLineMessagingProviderSkeleton implements LineMessagingProvider {
  async verifyWebhookSignature(input: VerifyWebhookInput): Promise<boolean> {
    const hmac = crypto.createHmac('sha256', input.channelSecret);
    hmac.update(input.body);
    const expected = hmac.digest('base64');
    return input.signature === expected;
  }

  async getProfile(_input: GetLineProfileInput): Promise<LineProfile> {
    throw new Error('EXTERNAL_VERIFICATION_REQUIRED: Production LINE Profile API client requires live LINE channel access token.');
  }

  async sendReply(_input: SendReplyInput): Promise<LineDeliveryResult> {
    throw new Error('EXTERNAL_VERIFICATION_REQUIRED: Production LINE Messaging API client requires live LINE Messaging API.');
  }

  async sendDirectNotification(_input: SendDirectNotificationInput): Promise<LineDeliveryResult> {
    throw new Error('EXTERNAL_VERIFICATION_REQUIRED: Production LINE Push Notification client requires live LINE Messaging API.');
  }

  async pushMessage(_input: any): Promise<LineDeliveryResult> {
    return this.sendDirectNotification(_input as any);
  }

  async getBotInfo(_accessToken: string): Promise<LineBotInfo> {
    throw new Error('EXTERNAL_VERIFICATION_REQUIRED: Production LINE Bot Info API client requires live LINE Messaging API.');
  }
}

export class ProductionLiffIdentityVerifierSkeleton implements LiffIdentityVerifier {
  async verifyIdentityToken(_input: VerifyLiffIdentityInput): Promise<VerifiedLineIdentity> {
    throw new Error('EXTERNAL_VERIFICATION_REQUIRED: Production LIFF Identity Token Verifier requires live LINE Login OAuth API.');
  }
}
