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

export type LineReplyDeliveryResult =
  | {
      outcome: 'DELIVERED';
      httpStatus: number;
      requestId?: string;
    }
  | {
      outcome: 'FAILED';
      httpStatus: number;
      errorCode?: string;
      requestId?: string;
    }
  | {
      outcome: 'UNKNOWN';
      httpStatus?: number;
      errorCode?: string;
      transportErrorCode?: string;
      requestId?: string;
    };

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

  replyMessage(
    replyToken: string,
    messages: any[],
    accessToken: string
  ): Promise<LineReplyDeliveryResult>;

  setWebhookEndpoint(endpointUrl: string, accessToken: string): Promise<{ success: boolean }>;
  testWebhookEndpoint(endpointUrl: string, accessToken: string): Promise<LineWebhookTestResult>;
  getWebhookEndpoint(accessToken: string): Promise<LineWebhookEndpointInfo | null>;
  getQuota(accessToken: string): Promise<{ type: 'limited' | 'none'; value?: number } | null>;
  getQuotaConsumption(accessToken: string): Promise<{ totalUsage: number } | null>;
  displayLoadingAnimation(chatId: string, accessToken: string, loadingSeconds?: number): Promise<boolean>;
  getFollowers(accessToken: string): Promise<{ userIds: string[]; next?: string } | null>;

  createRichMenu(richMenu: any, accessToken: string): Promise<string | null>;
  uploadRichMenuImage(richMenuId: string, imageBuffer: Buffer, contentType: string, accessToken: string): Promise<boolean>;
  setDefaultRichMenu(richMenuId: string, accessToken: string): Promise<boolean>;
  linkRichMenuToUser(lineUserId: string, richMenuId: string, accessToken: string): Promise<boolean>;
  unlinkRichMenuFromUser(lineUserId: string, accessToken: string): Promise<boolean>;
  getRichMenuList(accessToken: string): Promise<any[]>;
  deleteRichMenu(richMenuId: string, accessToken: string): Promise<boolean>;
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

  async replyMessage(replyToken: string, messages: any[], accessToken: string): Promise<LineReplyDeliveryResult> {
    try {
      const res = await fetch(`${this.baseUrl}/v2/bot/message/reply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          replyToken,
          messages,
        }),
      });

      const requestId = res.headers.get('x-line-request-id') || undefined;

      if (res.ok) {
        return {
          outcome: 'DELIVERED',
          httpStatus: res.status,
          requestId,
        };
      }

      // Server error 5xx (500, 501, 502, 503, 504, etc.) or 408 Request Timeout:
      // According to official LINE Messaging API documentation, LINE may have accepted/delivered the message despite 5xx or timeout.
      // MUST NOT treat as definitive failure. Must classify as UNKNOWN.
      if (res.status >= 500 || res.status === 408) {
        return {
          outcome: 'UNKNOWN',
          httpStatus: res.status,
          errorCode: `HTTP_${res.status}`,
          transportErrorCode: res.status === 408 ? 'HTTP_408_REQUEST_TIMEOUT' : `HTTP_${res.status}_SERVER_ERROR`,
          requestId,
        };
      }

      // Deterministic Client Rejection (400, 401, 403, 404, 429)
      return {
        outcome: 'FAILED',
        httpStatus: res.status,
        errorCode: `HTTP_${res.status}`,
        requestId,
      };
    } catch (err: any) {
      console.warn('LINE replyMessage: network transport uncertainty', { errorCode: err.code || err.name || 'UNKNOWN' });
      return {
        outcome: 'UNKNOWN',
        transportErrorCode: err.code || err.name || 'NETWORK_ERROR',
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

  async getQuota(accessToken: string): Promise<{ type: 'limited' | 'none'; value?: number } | null> {
    try {
      const res = await fetch(`${this.baseUrl}/v2/bot/message/quota`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });
      if (!res.ok) {
        console.warn('LINE getQuota: non-OK status', { status: res.status });
        return null;
      }
      const body = await res.json() as any;
      return {
        type: body.type || 'none',
        value: body.value !== undefined ? Number(body.value) : undefined,
      };
    } catch (err: any) {
      console.warn('LINE getQuota: network error', { errorCode: err.code || 'UNKNOWN' });
      return null;
    }
  }

  async getQuotaConsumption(accessToken: string): Promise<{ totalUsage: number } | null> {
    try {
      const res = await fetch(`${this.baseUrl}/v2/bot/message/quota/consumption`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });
      if (!res.ok) {
        console.warn('LINE getQuotaConsumption: non-OK status', { status: res.status });
        return null;
      }
      const body = await res.json() as any;
      return {
        totalUsage: Number(body.totalUsage || 0),
      };
    } catch (err: any) {
      console.warn('LINE getQuotaConsumption: network error', { errorCode: err.code || 'UNKNOWN' });
      return null;
    }
  }

  async displayLoadingAnimation(chatId: string, accessToken: string, loadingSeconds: number = 5): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/v2/bot/chat/loading/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          chatId,
          loadingSeconds: Math.min(Math.max(1, loadingSeconds), 60),
        }),
      });
      return res.ok || res.status === 202;
    } catch (err: any) {
      console.warn('LINE displayLoadingAnimation: network error', { errorCode: err.code || 'UNKNOWN' });
      return false;
    }
  }

  async getFollowers(accessToken: string): Promise<{ userIds: string[]; next?: string } | null> {
    try {
      const res = await fetch(`${this.baseUrl}/v2/bot/followers/ids?limit=10`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });
      if (!res.ok) {
        console.warn('LINE getFollowers: non-OK status', { status: res.status });
        return null;
      }
      const body = await res.json() as any;
      return {
        userIds: Array.isArray(body.userIds) ? body.userIds : [],
        next: body.next,
      };
    } catch (err: any) {
      console.warn('LINE getFollowers: network error', { errorCode: err.code || 'UNKNOWN' });
      return null;
    }
  }

  async createRichMenu(richMenu: any, accessToken: string): Promise<string | null> {
    try {
      const res = await fetch(`${this.baseUrl}/v2/bot/richmenu`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify(richMenu),
      });
      if (!res.ok) {
        console.warn('LINE createRichMenu: non-OK status', { status: res.status });
        return null;
      }
      const body = await res.json() as any;
      return body.richMenuId || null;
    } catch (err: any) {
      console.warn('LINE createRichMenu: network error', { errorCode: err.code || 'UNKNOWN' });
      return null;
    }
  }

  async uploadRichMenuImage(
    richMenuId: string,
    imageBuffer: Buffer,
    contentType: string,
    accessToken: string
  ): Promise<boolean> {
    try {
      const uploadBaseUrl = this.baseUrl.includes('api.line.me') ? 'https://api-data.line.me' : this.baseUrl;
      const res = await fetch(`${uploadBaseUrl}/v2/bot/richmenu/${richMenuId}/content`, {
        method: 'POST',
        headers: {
          'Content-Type': contentType,
          'Authorization': `Bearer ${accessToken}`,
        },
        body: imageBuffer,
      });
      return res.ok;
    } catch (err: any) {
      console.warn('LINE uploadRichMenuImage: network error', { errorCode: err.code || 'UNKNOWN' });
      return false;
    }
  }

  async setDefaultRichMenu(richMenuId: string, accessToken: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/v2/bot/user/all/richmenu/${richMenuId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });
      return res.ok;
    } catch (err: any) {
      console.warn('LINE setDefaultRichMenu: network error', { errorCode: err.code || 'UNKNOWN' });
      return false;
    }
  }

  async linkRichMenuToUser(lineUserId: string, richMenuId: string, accessToken: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/v2/bot/user/${lineUserId}/richmenu/${richMenuId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });
      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        console.warn('LINE linkRichMenuToUser failed:', { status: res.status, statusText: res.statusText, errorText, lineUserId, richMenuId });
        return false;
      }
      return true;
    } catch (err: any) {
      console.warn('LINE linkRichMenuToUser: network error', { errorCode: err.code || 'UNKNOWN', message: err.message });
      return false;
    }
  }

  async unlinkRichMenuFromUser(lineUserId: string, accessToken: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/v2/bot/user/${lineUserId}/richmenu`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });
      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        console.warn('LINE unlinkRichMenuFromUser failed:', { status: res.status, statusText: res.statusText, errorText, lineUserId });
        return false;
      }
      return true;
    } catch (err: any) {
      console.warn('LINE unlinkRichMenuFromUser: network error', { errorCode: err.code || 'UNKNOWN', message: err.message });
      return false;
    }
  }

  async getRichMenuList(accessToken: string): Promise<any[]> {
    try {
      const res = await fetch(`${this.baseUrl}/v2/bot/richmenu/list`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });
      if (!res.ok) return [];
      const body = await res.json() as any;
      return body.richmenus || [];
    } catch (err: any) {
      console.warn('LINE getRichMenuList: network error', { errorCode: err.code || 'UNKNOWN' });
      return [];
    }
  }

  async deleteRichMenu(richMenuId: string, accessToken: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/v2/bot/richmenu/${richMenuId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });
      return res.ok;
    } catch (err: any) {
      console.warn('LINE deleteRichMenu: network error', { errorCode: err.code || 'UNKNOWN' });
      return false;
    }
  }
}

/**
 * Test-only mock adapter. Never used in production/dev/staging.
 * Must be explicitly injected in test constructors.
 */
export class MockLinePlatformAdapter implements LinePlatformAdapter {
  public pushCalls: Array<{ toLineUserId: string; flexMessage: any; retryKey: string }> = [];
  public replyCalls: Array<{ replyToken: string; messages: any[]; accessToken: string }> = [];
  public profileCalls: Array<{ lineUserId: string; accessToken: string }> = [];
  public verifyAccessTokenCalls: Array<{ accessToken: string }> = [];

  public mockPushResult?: LinePushResult;
  public mockReplySuccess: boolean = true;
  public customBotInfo?: LineBotInfo;
  public simulate409WithAcceptedId = false;
  public simulate409WithoutAcceptedId = false;

  public storedWebhookEndpoint: string = '';
  public storedWebhookActive: boolean = true;
  public forceVerifyFail: boolean = false;

  public setVerifyResult(result: { verified: boolean; botInfo?: LineBotInfo }) {
    if (result.verified && result.botInfo) {
      this.customBotInfo = result.botInfo;
      this.forceVerifyFail = false;
    } else {
      this.forceVerifyFail = !result.verified;
      this.customBotInfo = undefined;
    }
  }

  async verifyAccessToken(channelAccessToken: string): Promise<{ verified: boolean; botInfo?: LineBotInfo }> {
    this.verifyAccessTokenCalls.push({ accessToken: channelAccessToken });
    if (this.forceVerifyFail) {
      this.forceVerifyFail = false;
      return { verified: false };
    }
    if (!channelAccessToken || channelAccessToken === 'invalid_token' || channelAccessToken.length < 8) {
      return { verified: false };
    }
    if (this.customBotInfo) {
      return {
        verified: true,
        botInfo: this.customBotInfo,
      };
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

  public mockReplyResult?: LineReplyDeliveryResult;
  public simulateReplyTimeout = false;
  public simulateReplyExplicitFailStatus?: number;

  async replyMessage(replyToken: string, messages: any[], accessToken: string): Promise<LineReplyDeliveryResult> {
    this.replyCalls.push({ replyToken, messages, accessToken });
    if (this.mockReplyResult) {
      return this.mockReplyResult;
    }
    if (this.simulateReplyTimeout) {
      return { outcome: 'UNKNOWN', transportErrorCode: 'NETWORK_TIMEOUT' };
    }
    if (this.simulateReplyExplicitFailStatus) {
      const status = this.simulateReplyExplicitFailStatus;
      if (status >= 500 || status === 408) {
        return {
          outcome: 'UNKNOWN',
          httpStatus: status,
          errorCode: `HTTP_${status}`,
          transportErrorCode: status === 408 ? 'HTTP_408_REQUEST_TIMEOUT' : `HTTP_${status}_SERVER_ERROR`,
          requestId: `req_mock_unknown_${Date.now()}`,
        };
      }
      return {
        outcome: 'FAILED',
        httpStatus: status,
        errorCode: `HTTP_${status}`,
        requestId: `req_mock_fail_${Date.now()}`,
      };
    }
    return {
      outcome: 'DELIVERED',
      httpStatus: 200,
      requestId: `req_mock_${Date.now()}`,
    };
  }

  public mockQuota: { type: 'limited' | 'none'; value?: number } = { type: 'limited', value: 500 };
  public mockQuotaConsumption: { totalUsage: number } = { totalUsage: 0 };
  public loadingAnimationCalls: Array<{ chatId: string; loadingSeconds: number }> = [];

  async getQuota(_accessToken: string): Promise<{ type: 'limited' | 'none'; value?: number } | null> {
    return this.mockQuota;
  }

  async getQuotaConsumption(_accessToken: string): Promise<{ totalUsage: number } | null> {
    return this.mockQuotaConsumption;
  }

  async displayLoadingAnimation(chatId: string, _accessToken: string, loadingSeconds: number = 5): Promise<boolean> {
    this.loadingAnimationCalls.push({ chatId, loadingSeconds });
    return true;
  }

  public mockFollowers: string[] = ['U_MOCK_FIRST_FOLLOWER'];
  async getFollowers(_accessToken: string): Promise<{ userIds: string[]; next?: string } | null> {
    return { userIds: this.mockFollowers };
  }

  public mockRichMenus: Map<string, any> = new Map();
  public defaultRichMenuId: string | null = null;
  public userRichMenuLinks: Map<string, string> = new Map();

  async createRichMenu(richMenu: any, _accessToken: string): Promise<string | null> {
    const id = `richmenu_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    this.mockRichMenus.set(id, richMenu);
    return id;
  }

  async uploadRichMenuImage(_richMenuId: string, _imageBuffer: Buffer, _contentType: string, _accessToken: string): Promise<boolean> {
    return true;
  }

  async setDefaultRichMenu(richMenuId: string, _accessToken: string): Promise<boolean> {
    this.defaultRichMenuId = richMenuId;
    return true;
  }

  async linkRichMenuToUser(lineUserId: string, richMenuId: string, _accessToken: string): Promise<boolean> {
    this.userRichMenuLinks.set(lineUserId, richMenuId);
    return true;
  }

  async unlinkRichMenuFromUser(lineUserId: string, _accessToken: string): Promise<boolean> {
    this.userRichMenuLinks.delete(lineUserId);
    return true;
  }

  async getRichMenuList(_accessToken: string): Promise<any[]> {
    const list: any[] = [];
    for (const [richMenuId, menu] of this.mockRichMenus.entries()) {
      list.push({ richMenuId, ...menu });
    }
    return list;
  }

  async deleteRichMenu(richMenuId: string, _accessToken: string): Promise<boolean> {
    this.mockRichMenus.delete(richMenuId);
    if (this.defaultRichMenuId === richMenuId) {
      this.defaultRichMenuId = null;
    }
    for (const [userId, mId] of this.userRichMenuLinks.entries()) {
      if (mId === richMenuId) this.userRichMenuLinks.delete(userId);
    }
    return true;
  }
}
