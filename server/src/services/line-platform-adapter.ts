/**
 * LINE Platform Adapter (Task-009 Verification & Push Notification Interface)
 * @license Apache-2.0
 */

export interface LinePlatformAdapter {
  verifyCredentials(credentials: { channelSecret?: string; channelAccessToken?: string }): Promise<boolean>;
  pushMessage(to: string, flexMessage: any, accessToken?: string): Promise<{ success: boolean; messageId?: string }>;
}

export class MockLinePlatformAdapter implements LinePlatformAdapter {
  async verifyCredentials(credentials: { channelSecret?: string; channelAccessToken?: string }): Promise<boolean> {
    if (!credentials.channelSecret || !credentials.channelAccessToken) {
      return false;
    }
    if (credentials.channelSecret === 'invalid_secret' || credentials.channelAccessToken === 'invalid_token') {
      return false;
    }
    return credentials.channelSecret.length >= 8 && credentials.channelAccessToken.length >= 8;
  }

  async pushMessage(to: string, flexMessage: any, accessToken?: string): Promise<{ success: boolean; messageId?: string }> {
    if (!to || !flexMessage) {
      return { success: false };
    }
    return {
      success: true,
      messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
    };
  }
}
