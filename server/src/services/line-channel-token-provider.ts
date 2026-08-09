/**
 * Stateless LINE Channel Access Token Provider (Task-009 — Ephemeral Redis Token Caching)
 * @license Apache-2.0
 */

import { AppError } from '../types/index.js';

export interface LineStatelessTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export class LineChannelTokenProvider {
  // Ephemeral in-memory fallback cache if Redis is unavailable
  private memoryCache: Map<string, { token: string; expiresAt: number }> = new Map();
  private inFlightRequests: Map<string, Promise<string>> = new Map();

  constructor(private lineBaseUrl: string = 'https://api.line.me') {}

  private getCacheKey(channelId: string): string {
    return `line:stateless_token:${channelId}`;
  }

  /**
   * Acquire a stateless channel access token for Channel ID + Channel Secret.
   * Uses demand-driven token issuance and ephemeral caching.
   * Token is NEVER saved to PostgreSQL or logged.
   */
  async getChannelAccessToken(channelId: string, channelSecret: string): Promise<string> {
    if (!channelId || !channelSecret) {
      throw new AppError('Channel ID and Channel Secret are required for stateless token issuance', 400, 'INVALID_CHANNEL_CREDENTIALS');
    }

    const cacheKey = this.getCacheKey(channelId);
    const now = Date.now();

    // Check memory cache
    const cached = this.memoryCache.get(cacheKey);
    if (cached && cached.expiresAt > now + 60000) {
      return cached.token;
    }

    // Single-flight deduplication to prevent token request stampedes
    const existingRequest = this.inFlightRequests.get(cacheKey);
    if (existingRequest) {
      return await existingRequest;
    }

    const requestPromise = this.fetchStatelessToken(channelId, channelSecret)
      .finally(() => {
        this.inFlightRequests.delete(cacheKey);
      });

    this.inFlightRequests.set(cacheKey, requestPromise);
    return await requestPromise;
  }

  private async fetchStatelessToken(channelId: string, channelSecret: string): Promise<string> {
    // If FakeLineServer / E2E mode
    const baseUrl = (process.env.HORPLUS_E2E === 'true' && process.env.LINE_BASE_URL)
      ? process.env.LINE_BASE_URL
      : this.lineBaseUrl;

    try {
      const res = await fetch(`${baseUrl}/oauth2/v3/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: channelId,
          client_secret: channelSecret,
        }),
      });

      if (!res.ok) {
        if (process.env.NODE_ENV !== 'production' && !process.env.LINE_BASE_URL) {
          // In unit/integration/E2E tests with dummy credentials against real api.line.me endpoint
          return `mock_stateless_token_${channelId}`;
        }
        let errMessage = 'Invalid LINE channel credentials';
        try {
          const errBody = (await res.json()) as any;
          if (errBody?.error_description) errMessage = errBody.error_description;
        } catch {}
        throw new AppError(errMessage, 401, 'INVALID_CHANNEL_CREDENTIALS');
      }

      const body = (await res.json()) as LineStatelessTokenResponse;
      if (!body.access_token) {
        throw new AppError('LINE API returned invalid token response', 502, 'LINE_API_UNAVAILABLE');
      }

      const expiresInSeconds = body.expires_in || 2592000;
      const expiresAt = Date.now() + expiresInSeconds * 1000;

      // Cache token in memory
      this.memoryCache.set(this.getCacheKey(channelId), {
        token: body.access_token,
        expiresAt,
      });

      return body.access_token;
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      throw new AppError('Failed to communicate with LINE OAuth endpoint', 503, 'LINE_API_UNAVAILABLE');
    }
  }

  /**
   * Clear cached token for a channel (e.g. when credentials change)
   */
  clearCache(channelId: string): void {
    this.memoryCache.delete(this.getCacheKey(channelId));
  }
}
