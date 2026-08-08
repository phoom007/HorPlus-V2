/**
 * LINE Platform Adapter (Task-009 — Verification, Profile & Push Interface)
 * @license Apache-2.0
 */

export interface LineUserProfile {
  displayName: string;
  pictureUrl?: string | null;
}

/** Discriminated push result for idempotent delivery finalization */
export type LinePushResult =
  | { outcome: 'ACCEPTED'; messageId?: string }
  | { outcome: 'ALREADY_ACCEPTED'; messageId?: string }
  | { outcome: 'DEFINITIVE_FAILURE'; errorCode: string; safeMessage: string }
  | { outcome: 'RETRYABLE_UNKNOWN'; errorCode: string; safeMessage: string };

export interface LineBotInfo {
  userId: string;
  basicId: string;
  displayName: string;
  chatMode: string;
}

export interface LinePlatformAdapter {
  /**
   * Verify Channel Access Token by calling GET /v2/bot/info.
   * Does NOT verify Channel Secret (webhook verification does that).
   */
  verifyAccessToken(channelAccessToken: string): Promise<{ verified: boolean; botInfo?: LineBotInfo }>;

  /** Fetch LINE user profile via GET /v2/bot/profile/{userId} */
  getProfile(lineUserId: string, accessToken: string): Promise<LineUserProfile | null>;

  /**
   * Push a message via POST /v2/bot/message/push.
   * Requires X-Line-Retry-Key header for idempotent delivery.
   */
  pushMessage(
    toLineUserId: string,
    flexMessage: any,
    accessToken: string,
    retryKey: string
  ): Promise<LinePushResult>;
}

/**
 * Production HTTP adapter calling real LINE Messaging API endpoints.
 * Never logs Channel Secret, Access Token, raw LINE User ID, or bearer tokens.
 */
export class HttpLinePlatformAdapter implements LinePlatformAdapter {
  private readonly baseUrl: string;

  constructor(customBaseUrl?: string) {
    const testUrl = process.env.LINE_PLATFORM_URL || process.env.LINE_API_BASE_URL;
    if (customBaseUrl) {
      this.baseUrl = customBaseUrl;
    } else if (testUrl) {
      this.baseUrl = testUrl;
    } else {
      this.baseUrl = 'https://api.line.me';
    }
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
          displayName: body.displayName || '',
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

      // 409 Conflict handling: require x-line-accepted-request-id header for ALREADY_ACCEPTED
      if (res.status === 409) {
        const acceptedRequestId = res.headers.get('x-line-accepted-request-id');
        if (acceptedRequestId) {
          const body = await res.json().catch(() => ({})) as any;
          return {
            outcome: 'ALREADY_ACCEPTED',
            messageId: body.sentMessages?.[0]?.id || acceptedRequestId,
          };
        }
        // Fail closed if accepted request ID header is missing
        return {
          outcome: 'DEFINITIVE_FAILURE',
          errorCode: 'HTTP_409_UNACCEPTED_RETRY',
          safeMessage: 'LINE API returned 409 without accepted request ID evidence',
        };
      }

      // 4xx (non-409) = definitive failure
      if (res.status >= 400 && res.status < 500) {
        return {
          outcome: 'DEFINITIVE_FAILURE',
          errorCode: `HTTP_${res.status}`,
          safeMessage: `LINE API returned ${res.status}`,
        };
      }

      // 5xx = retryable
      return {
        outcome: 'RETRYABLE_UNKNOWN',
        errorCode: `HTTP_${res.status}`,
        safeMessage: `LINE API returned ${res.status}`,
      };
    } catch (err: any) {
      // Network timeout / DNS failure = retryable unknown
      return {
        outcome: 'RETRYABLE_UNKNOWN',
        errorCode: err.code || 'NETWORK_ERROR',
        safeMessage: 'Network error contacting LINE API',
      };
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

  async verifyAccessToken(channelAccessToken: string): Promise<{ verified: boolean; botInfo?: LineBotInfo }> {
    this.verifyAccessTokenCalls.push({ accessToken: channelAccessToken });
    if (!channelAccessToken || channelAccessToken === 'invalid_token' || channelAccessToken.length < 8) {
      return { verified: false };
    }
    return {
      verified: true,
      botInfo: {
        userId: 'U_BOT_MOCK',
        basicId: '@mock_bot',
        displayName: 'Mock Bot',
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
}
