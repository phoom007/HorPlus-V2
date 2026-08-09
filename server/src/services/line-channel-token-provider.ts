/**
 * Distributed LINE Channel Access Token Provider (Task-009 — Redis Token Caching & Distributed Locking)
 * @license Apache-2.0
 */

import crypto from 'crypto';
import { Redis } from 'ioredis';
import { AppError } from '../types/index.js';

export interface LineStatelessTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface ILineChannelTokenProvider {
  getChannelAccessToken(channelId: string, channelSecret: string): Promise<string>;
  clearCache?(channelId: string): Promise<void>;
}

export class FakeLineTokenProvider implements ILineChannelTokenProvider {
  constructor(private token: string = 'fake_stateless_token_12345') {}

  async getChannelAccessToken(channelId: string, channelSecret: string): Promise<string> {
    if (!channelId || !channelSecret) {
      throw new AppError('Channel ID and Channel Secret are required for stateless token issuance', 400, 'INVALID_CHANNEL_CREDENTIALS');
    }
    return `fake_stateless_token_${channelId}`;
  }

  async clearCache(_channelId: string): Promise<void> {}
}

export class LineChannelTokenProvider implements ILineChannelTokenProvider {
  private redisClient: Redis | null = null;
  private memoryCache: Map<string, { token: string; expiresAt: number }> = new Map();
  private inFlightRequests: Map<string, Promise<string>> = new Map();

  constructor(private lineBaseUrl: string = 'https://api.line.me', customRedisClient?: Redis) {
    if (customRedisClient) {
      this.redisClient = customRedisClient;
    } else {
      const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
      try {
        this.redisClient = new Redis(redisUrl, {
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
        });
        this.redisClient.on('error', () => {
          // Catch Redis connection errors
        });
      } catch {
        this.redisClient = null;
      }
    }
  }

  public async ensureRedisConnected(): Promise<boolean> {
    if (!this.redisClient) return false;
    if ((this.redisClient.status as string) === 'ready') return true;

    try {
      if (this.redisClient.status === 'connecting' || this.redisClient.status === 'connect') {
        const start = Date.now();
        while (Date.now() - start < 2000) {
          if ((this.redisClient.status as string) === 'ready') return true;
          await new Promise((r) => setTimeout(r, 50));
        }
      } else if (this.redisClient.status === 'wait' || this.redisClient.status === 'close') {
        await this.redisClient.connect();
      }
    } catch {
      return false;
    }
    return (this.redisClient.status as string) === 'ready';
  }

  private getCacheKey(channelId: string): string {
    return `line:stateless_token:${channelId}`;
  }

  private getLockKey(channelId: string): string {
    return `line:token-lock:${channelId}`;
  }

  /**
   * Acquire a stateless channel access token for Channel ID + Channel Secret.
   * Uses Redis distributed caching with distributed TTL and SET NX PX distributed locking.
   * Token is NEVER saved to PostgreSQL or logged.
   */
  async getChannelAccessToken(channelId: string, channelSecret: string): Promise<string> {
    if (!channelId || !channelSecret) {
      throw new AppError('Channel ID and Channel Secret are required for stateless token issuance', 400, 'INVALID_CHANNEL_CREDENTIALS');
    }

    const isProd = process.env.NODE_ENV === 'production';
    const isRedisAvailable = await this.ensureRedisConnected();

    if (isProd && !isRedisAvailable) {
      throw new AppError('Distributed coordination unavailable', 503, 'REDIS_UNAVAILABLE');
    }

    const cacheKey = this.getCacheKey(channelId);
    const lockKey = this.getLockKey(channelId);
    const now = Date.now();

    // 1. Check L1 Memory Cache
    const l1Cached = this.memoryCache.get(cacheKey);
    if (l1Cached && l1Cached.expiresAt > now + 300000) {
      return l1Cached.token;
    }

    // 2. Check L2 Redis Cache
    if (isRedisAvailable && this.redisClient) {
      try {
        const redisCached = await this.redisClient.get(cacheKey);
        if (redisCached) {
          const ttl = await this.redisClient.ttl(cacheKey);
          this.memoryCache.set(cacheKey, {
            token: redisCached,
            expiresAt: now + Math.max(ttl, 0) * 1000,
          });
          return redisCached;
        }
      } catch {
        // Fall back to lock/fetch if Redis read fails
      }
    }

    // 3. Distributed Redis SET NX PX Lock
    if (isRedisAvailable && this.redisClient) {
      const uniqueOwnerId = crypto.randomUUID();
      const lockTTL = 10000; // 10 seconds
      let lockAcquired = false;

      try {
        const lockResult = await this.redisClient.set(lockKey, uniqueOwnerId, 'PX', lockTTL, 'NX');
        lockAcquired = lockResult === 'OK';
      } catch {
        lockAcquired = false;
      }

      if (lockAcquired) {
        try {
          // Re-check cache after acquiring lock
          const rechecked = await this.redisClient.get(cacheKey);
          if (rechecked) {
            return rechecked;
          }

          const token = await this.fetchStatelessToken(channelId, channelSecret);
          return token;
        } finally {
          // Atomic compare-and-delete release using Lua script
          const luaReleaseScript = `
            if redis.call('get', KEYS[1]) == ARGV[1] then
              return redis.call('del', KEYS[1])
            else
              return 0
            end
          `;
          try {
            await this.redisClient.eval(luaReleaseScript, 1, lockKey, uniqueOwnerId);
          } catch {
            // Non-blocking catch on lock release error
          }
        }
      } else {
        // Lock not acquired: poll token cache using bounded backoff + jitter
        const maxWaitMs = 5000;
        const startTime = Date.now();
        let pollDelay = 50;

        while (Date.now() - startTime < maxWaitMs) {
          await new Promise((resolve) => setTimeout(resolve, pollDelay + Math.floor(Math.random() * 20)));
          pollDelay = Math.min(pollDelay * 1.5, 300);

          try {
            const polledToken = await this.redisClient.get(cacheKey);
            if (polledToken) {
              return polledToken;
            }
          } catch {
            // Continue polling
          }
        }

        throw new AppError('LINE token lock acquisition timed out', 503, 'LINE_TOKEN_LOCK_TIMEOUT');
      }
    }

    // Degraded mode for local/dev without Redis: in-process single-flight deduplication
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
    const baseUrl = process.env.LINE_PLATFORM_URL || process.env.LINE_BASE_URL || this.lineBaseUrl;

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
      // Reserve 5 minutes safety margin for TTL
      const ttlSeconds = Math.max(expiresInSeconds - 300, 60);
      const expiresAt = Date.now() + ttlSeconds * 1000;

      // Cache token in Memory L1
      this.memoryCache.set(this.getCacheKey(channelId), {
        token: body.access_token,
        expiresAt,
      });

      // Cache token in Redis L2
      if (this.redisClient && ((this.redisClient.status as string) === 'ready' || await this.ensureRedisConnected())) {
        try {
          await this.redisClient.set(this.getCacheKey(channelId), body.access_token, 'EX', ttlSeconds);
        } catch {
          // Non-blocking catch
        }
      }

      return body.access_token;
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      throw new AppError('Failed to communicate with LINE OAuth endpoint', 503, 'LINE_API_UNAVAILABLE');
    }
  }

  /**
   * Clear cached token for a channel (e.g. when credentials change)
   */
  async clearCache(channelId: string): Promise<void> {
    const cacheKey = this.getCacheKey(channelId);
    this.memoryCache.delete(cacheKey);
    if (this.redisClient && (this.redisClient.status as string) === 'ready') {
      try {
        await this.redisClient.del(cacheKey);
      } catch {
        // Non-blocking catch
      }
    }
  }
}


