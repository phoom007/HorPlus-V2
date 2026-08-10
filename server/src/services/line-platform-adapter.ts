/**
 * LINE Platform Adapter (Task-009 — Verification, Profile, Webhook & Push Interface)
 * @license Apache-2.0
 */

export interface LineUserProfile {
  displayName: string;
  pictureUrl?: string | null;
}

export type LinePushResult =
  | { outcome: 'ACCEPTED'; messageId?: string }
  | { outcome: 'ALREADY_ACCEPTED'; messageId?: string }
  | { outcome: 'DEFINITIVE_FAILURE'; errorCode: string; safeMessage: string }
  | { outcome: 'RETRYABLE_UNKNOWN'; errorCode: string; safeMessage: string };

export interface LineBotInfo {
  userId: string;
  basicId: string;
  premiumId?: string | null;
  displayName: string;
  pictureUrl?: string | null;
  chatMode: string;
}

export interface LineWebhookEndpointInfo {
  endpoint: string;
  active: boolean;
}

export interface LineWebhookTestResult {
  success: boolean;
  timestamp: string;
  statusCode: number;
  reason: string;
  detail: string;
}

export interface LinePlatformAdapter {
  verifyAccessToken(channelAccessToken: string): Promise<{ verified: boolean; botInfo?: LineBotInfo }>;
  getProfile(lineUserId: string, accessToken: string): Promise<LineUserProfile | null>;
  pushMessage(
    toLineUserId: string,
    flexMessage: any,
    accessToken: string,
    retryKey: string
  ): Promise<LinePushResult>;

  setWebhookEndpoint(endpointUrl: string, accessToken: string): Promise<{ success: boolean }>;
  testWebhookEndpoint(endpointUrl: string, accessToken: string): Promise<LineWebhookTestResult>;
  getWebhookEndpoint(accessToken: string): Promise<LineWebhookEndpointInfo | null>;
}

/**
 * Production HTTP adapter calling real LINE Messaging API endpoints.
 * Never logs Channel Secret, Access Token, raw LINE User ID, or bearer tokens.
 */
export class HttpLinePlatformAdapter implements LinePlatformAdapter {
  private readonly customBaseUrl?: string;

  constructor(customBaseUrl?: string) {
    this.customBaseUrl = customBaseUrl;
  }

  public get baseUrl(): string {
    const isProduction = process.env.NODE_ENV === 'production';
    const isAllowedBoundary = !isProduction && (process.env.NODE_ENV === 'test' || process.env.HORPLUS_E2E === 'true');
    const requestedOverride = this.customBaseUrl || process.env.LINE_PLATFORM_URL || process.env.LINE_API_BASE_URL;

    if (requestedOverride && isAllowedBoundary) {
      return requestedOverride;
    }
    return 'https://api.line.me';
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  async verifyAccessToken(channelAccessToken: string): Promise<{ verified: boolean; botInfo?: LineBotInfo }> {
    try {
      const res = await fetch(`${this.baseUrl}/v2/bot/info`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${channelAccessToken}`,
        },
      });

      if (!res.ok) {
        console.warn('LINE verifyAccessToken: non-OK status', { status: res.status });
        return { verified: false };
      }

      const body = await res.json() as any;
      return {
        verified: true,
        botInfo: {
          userId: body.userId || '',
          basicId: body.basicId || '',
          premiumId: body.premiumId || null,
          displayName: body.displayName || '',
          pictureUrl: body.pictureUrl || null,
          chatMode: body.chatMode || '',
        },
      };
    } catch (err: any) {
      console.warn('LINE verifyAccessToken: network error', { errorCode: err.code || 'UNKNOWN' });
      return { verified: false };
    }
  }

  async getProfile(lineUserId: string, accessToken: string): Promise<LineUserProfile | null> {
    try {
      const res = await fetch(`${this.baseUrl}/v2/bot/profile/${lineUserId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      if (!res.ok) {
        console.warn('LINE getProfile: non-OK status', { status: res.status });
        return null;
      }

      const body = await res.json() as any;
      return {
        displayName: body.displayName || 'LINE User',
        pictureUrl: body.pictureUrl || null,
      };
    } catch (err: any) {
      console.warn('LINE getProfile: network error', { errorCode: err.code || 'UNKNOWN' });
      return null;
    }
  }

  async pushMessage(
    toLineUserId: string,
    flexMessage: any,
    accessToken: string,
    retryKey: string
  ): Promise<LinePushResult> {
    try {
      const res = await fetch(`${this.baseUrl}/v2/bot/message/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'X-Line-Retry-Key': retryKey,
        },
        body: JSON.stringify({
          to: toLineUserId,
          messages: [flexMessage],
        }),
      });

      if (res.ok) {
        const body = await res.json().catch(() => ({})) as any;
        return { outcome: 'ACCEPTED', messageId: body.sentMessages?.[0]?.id };
      }

      if (res.status === 409) {
        const acceptedRequestId = res.headers.get('x-line-accepted-request-id');
        if (acceptedRequestId) {
          const body = await res.json().catch(() => ({})) as any;
          return {
            outcome: 'ALREADY_ACCEPTED',
            messageId: body.sentMessages?.[0]?.id || acceptedRequestId,
          };
        }
        return {
          outcome: 'DEFINITIVE_FAILURE',
          errorCode: 'HTTP_409_UNACCEPTED_RETRY',
          safeMessage: 'LINE API returned 409 without accepted request ID evidence',
        };
      }

      if (res.status >= 400 && res.status < 500) {
        return {
          outcome: 'DEFINITIVE_FAILURE',
          errorCode: `HTTP_${res.status}`,
          safeMessage: `LINE API returned ${res.status}`,
        };
      }

      return {
        outcome: 'RETRYABLE_UNKNOWN',
        errorCode: `HTTP_${res.status}`,
        safeMessage: `LINE API returned ${res.status}`,
      };
    } catch (err: any) {
      return {
        outcome: 'RETRYABLE_UNKNOWN',
        errorCode: err.code || 'NETWORK_ERROR',
        safeMessage: 'Network error contacting LINE API',
      };
    }
  }

  async setWebhookEndpoint(endpointUrl: string, accessToken: string): Promise<{ success: boolean }> {
    try {
      const res = await fetch(`${this.baseUrl}/v2/bot/channel/webhook/endpoint`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ endpoint: endpointUrl }),
      });
      return { success: res.ok };
    } catch {
      return { success: false };
    }
  }

  async testWebhookEndpoint(endpointUrl: string, accessToken: string): Promise<LineWebhookTestResult> {
    try {
      const res = await fetch(`${this.baseUrl}/v2/bot/channel/webhook/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ endpoint: endpointUrl }),
      });
      if (res.ok) {
        const body = await res.json().catch(() => ({})) as any;
        return {
          success: body.success ?? true,
          timestamp: body.timestamp || new Date().toISOString(),
          statusCode: body.statusCode || 200,
          reason: body.reason || 'OK',
          detail: body.detail || 'Webhook test succeeded',
        };
      }
      return {
        success: false,
        timestamp: new Date().toISOString(),
        statusCode: res.status,
        reason: 'HTTP_ERROR',
        detail: `LINE API returned HTTP ${res.status}`,
      };
    } catch (err: any) {
      return {
        success: false,
        timestamp: new Date().toISOString(),
        statusCode: 500,
        reason: 'NETWORK_ERROR',
        detail: err.message || 'Failed to reach LINE API',
      };
    }
  }

  async getWebhookEndpoint(accessToken: string): Promise<LineWebhookEndpointInfo | null> {
    try {
      const res = await fetch(`${this.baseUrl}/v2/bot/channel/webhook/endpoint`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });
      if (!res.ok) return null;
      const body = await res.json() as any;
      return {
        endpoint: body.endpoint || '',
        active: body.active ?? false,
      };
    } catch {
      return null;
    }
  }
}

/**
 * Test-only mock adapter. Never used in production/dev/staging.
 * Must be explicitly injected in test constructors.
 */
export class MockLinePlatformAdapter implements LinePlatformAdapter {
  public pushCalls: Array<{ toLineUserId: string; flexMessage: any; retryKey: string }> = [];
  public profileCalls: Array<{ lineUserId: string; accessToken: string }> = [];
  public verifyAccessTokenCalls: Array<{ accessToken: string }> = [];

  public mockPushResult?: LinePushResult;
  public simulate409WithAcceptedId = false;
  public simulate409WithoutAcceptedId = false;

  public storedWebhookEndpoint: string = '';
  public storedWebhookActive: boolean = true;
  public forceVerifyFail: boolean = false;

  async verifyAccessToken(channelAccessToken: string): Promise<{ verified: boolean; botInfo?: LineBotInfo }> {
    this.verifyAccessTokenCalls.push({ accessToken: channelAccessToken });
    if (this.forceVerifyFail) {
      this.forceVerifyFail = false;
      return { verified: false };
    }
    if (!channelAccessToken || channelAccessToken === 'invalid_token' || channelAccessToken.length < 8) {
      return { verified: false };
    }
    return {
      verified: true,
      botInfo: {
        userId: 'U_BOT_MOCK',
        basicId: '@mock_bot',
        premiumId: null,
        displayName: 'Mock Bot',
        pictureUrl: 'https://profile.line-scdn.net/mock_bot_avatar.png',
        chatMode: 'chat',
      },
    };
  }

  async getProfile(lineUserId: string, accessToken: string): Promise<LineUserProfile | null> {
    this.profileCalls.push({ lineUserId, accessToken });
    if (!lineUserId) return null;
    const suffix = lineUserId.slice(-4);
    return {
      displayName: `LINE User (${suffix})`,
      pictureUrl: `https://profile.line-scdn.net/mock_${suffix}.png`,
    };
  }

  async pushMessage(
    toLineUserId: string,
    flexMessage: any,
    accessToken: string,
    retryKey: string
  ): Promise<LinePushResult> {
    if (!toLineUserId || !flexMessage) {
      return { outcome: 'DEFINITIVE_FAILURE', errorCode: 'MISSING_PARAMS', safeMessage: 'Missing required parameters' };
    }
    this.pushCalls.push({ toLineUserId, flexMessage, retryKey });
    if (toLineUserId === 'U_E2E_FAILURE') {
      return { outcome: 'DEFINITIVE_FAILURE', errorCode: 'USER_BLOCKED', safeMessage: 'User blocked bot' };
    }
    if (toLineUserId === 'U_E2E_RETRY') {
      return { outcome: 'RETRYABLE_UNKNOWN', errorCode: 'NETWORK_TIMEOUT', safeMessage: 'Network timeout' };
    }
    if (this.mockPushResult) {
      return this.mockPushResult;
    }
    if (this.simulate409WithAcceptedId) {
      return { outcome: 'ALREADY_ACCEPTED', messageId: `msg_accepted_${retryKey}` };
    }
    if (this.simulate409WithoutAcceptedId) {
      return { outcome: 'DEFINITIVE_FAILURE', errorCode: 'HTTP_409_UNACCEPTED_RETRY', safeMessage: 'LINE API returned 409 without accepted request ID evidence' };
    }
    return { outcome: 'ACCEPTED', messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}` };
  }

  async setWebhookEndpoint(endpointUrl: string, _accessToken: string): Promise<{ success: boolean }> {
    this.storedWebhookEndpoint = endpointUrl;
    return { success: true };
  }

  async testWebhookEndpoint(endpointUrl: string, _accessToken: string): Promise<LineWebhookTestResult> {
    return {
      success: true,
      timestamp: new Date().toISOString(),
      statusCode: 200,
      reason: 'OK',
      detail: 'Webhook test succeeded',
    };
  }

  async getWebhookEndpoint(_accessToken: string): Promise<LineWebhookEndpointInfo | null> {
    return {
      endpoint: this.storedWebhookEndpoint,
      active: this.storedWebhookActive,
    };
  }
}
