/**
 * LINE Platform Adapter (Task-009 Verification, Profile & Push Interface)
 * @license Apache-2.0
 */

export interface LineUserProfile {
  displayName: string;
  pictureUrl?: string | null;
}

export interface LinePlatformAdapter {
  verifyCredentials(credentials: { channelSecret?: string; channelAccessToken?: string }): Promise<boolean>;
  getProfile(lineUserId: string, accessToken?: string): Promise<LineUserProfile | null>;
  pushMessage(toLineUserId: string, flexMessage: any, accessToken?: string): Promise<{ success: boolean; messageId?: string }>;
}

export class MockLinePlatformAdapter implements LinePlatformAdapter {
  public pushCalls: Array<{ toLineUserId: string; flexMessage: any }> = [];

  async verifyCredentials(credentials: { channelSecret?: string; channelAccessToken?: string }): Promise<boolean> {
    if (!credentials.channelSecret || !credentials.channelAccessToken) {
      return false;
    }
    if (credentials.channelSecret === 'invalid_secret' || credentials.channelAccessToken === 'invalid_token') {
      return false;
    }
    return credentials.channelSecret.length >= 8 && credentials.channelAccessToken.length >= 8;
  }

  async getProfile(lineUserId: string, accessToken?: string): Promise<LineUserProfile | null> {
    if (!lineUserId) return null;
    const suffix = lineUserId.slice(-4);
    return {
      displayName: `LINE User (${suffix})`,
      pictureUrl: `https://profile.line-scdn.net/mock_${suffix}.png`
    };
  }

  async pushMessage(toLineUserId: string, flexMessage: any, accessToken?: string): Promise<{ success: boolean; messageId?: string }> {
    if (!toLineUserId || !flexMessage) {
      return { success: false };
    }
    this.pushCalls.push({ toLineUserId, flexMessage });
    return {
      success: true,
      messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
    };
  }
}
