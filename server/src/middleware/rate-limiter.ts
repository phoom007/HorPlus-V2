import { Request, Response, NextFunction } from 'express';
import { getRedisClient } from '../db/redis.js';
import { resolveAuthoritativeDormitoryContext } from './dormitory-context.js';

export interface RateLimiterOptions {
  windowMs?: number; // default 15 mins (900000 ms)
  maxRequests?: number; // default 30 requests per window
}

export class InMemoryRateLimiterStore {
  private hits: Map<string, { count: number; resetTime: number }> = new Map();
  private cooldowns: Map<string, number> = new Map();
  private locks: Map<string, { value: string; expiresAt: number }> = new Map();

  public isAllowed(key: string, maxRequests: number, windowMs: number): boolean {
    const now = Date.now();
    const entry = this.hits.get(key);

    if (!entry || entry.resetTime <= now) {
      this.hits.set(key, { count: 1, resetTime: now + windowMs });
      return true;
    }

    if (entry.count < maxRequests) {
      entry.count++;
      return true;
    }

    return false;
  }

  public checkCooldown(key: string, cooldownMs: number): boolean {
    const now = Date.now();
    const expiresAt = this.cooldowns.get(key);
    if (expiresAt && now < expiresAt) {
      return false; // In cooldown, blocked
    }
    this.cooldowns.set(key, now + cooldownMs);
    return true; // Cooldown recorded, allowed
  }

  public acquireLock(key: string, value: string, ttlSeconds: number = 30): boolean {
    const now = Date.now();
    const lock = this.locks.get(key);
    if (lock && now < lock.expiresAt) {
      return false; // Already locked
    }
    this.locks.set(key, { value, expiresAt: now + (ttlSeconds * 1000) });
    return true;
  }

  public releaseLock(key: string, value: string): void {
    const lock = this.locks.get(key);
    if (lock && lock.value === value) {
      this.locks.delete(key);
    }
  }

  public resetKey(key: string): void {
    this.hits.delete(key);
    this.cooldowns.delete(key);
    this.locks.delete(key);
  }

  public clear(): void {
    this.hits.clear();
    this.cooldowns.clear();
    this.locks.clear();
  }
}

export class DistributedRateLimiterStore {
  private memoryStore = new InMemoryRateLimiterStore();

  public async isAllowed(key: string, maxRequests: number, windowMs: number): Promise<boolean> {
    try {
      const redis = getRedisClient();
      if (redis && redis.status === 'ready') {
        const count = await redis.incr(key);
        if (count === 1) {
          await redis.pexpire(key, windowMs);
        }
        return count <= maxRequests;
      }
    } catch (_err) {
      // Fall back cleanly to memory store
    }
    return this.memoryStore.isAllowed(key, maxRequests, windowMs);
  }

  public async checkCooldown(key: string, cooldownMs: number): Promise<boolean> {
    try {
      const redis = getRedisClient();
      if (redis && redis.status === 'ready') {
        const res = await redis.set(key, '1', 'PX', cooldownMs, 'NX');
        return res === 'OK';
      }
    } catch (_err) {
      // Fall back cleanly to memory store
    }
    return this.memoryStore.checkCooldown(key, cooldownMs);
  }

  public async acquireLock(key: string, value: string, ttlSeconds: number = 30): Promise<boolean> {
    try {
      const redis = getRedisClient();
      if (redis && redis.status === 'ready') {
        const res = await redis.set(key, value, 'EX', ttlSeconds, 'NX');
        return res === 'OK';
      }
    } catch (_err) {
      // Fall back cleanly to memory store
    }
    return this.memoryStore.acquireLock(key, value, ttlSeconds);
  }

  public async releaseLock(key: string, value: string): Promise<void> {
    try {
      const redis = getRedisClient();
      if (redis && redis.status === 'ready') {
        const luaScript = `
          if redis.call("get", KEYS[1]) == ARGV[1] then
            return redis.call("del", KEYS[1])
          else
            return 0
          end
        `;
        await redis.eval(luaScript, 1, key, value);
        return;
      }
    } catch (_err) {
      // Fall back cleanly to memory store
    }
    this.memoryStore.releaseLock(key, value);
  }

  public resetKey(key: string): void {
    try {
      const redis = getRedisClient();
      if (redis && redis.status === 'ready') {
        redis.del(key).catch(() => {});
      }
    } catch (_err) {}
    this.memoryStore.resetKey(key);
  }

  public clear(): void {
    this.memoryStore.clear();
  }
}

const defaultStore = new InMemoryRateLimiterStore();
export const distributedRateLimiterStore = new DistributedRateLimiterStore();

export function createRateLimiterMiddleware(options: RateLimiterOptions = {}) {
  const windowMs = options.windowMs || 15 * 60 * 1000;
  const maxRequests = options.maxRequests || 30;

  return (req: Request, res: Response, next: NextFunction) => {
    const ip = (req.ip || req.socket?.remoteAddress || '127.0.0.1').toString().trim();
    const key = `rate_limit:${req.path}:${ip}`;

    const allowed = defaultStore.isAllowed(key, maxRequests, windowMs);

    if (!allowed) {
      const requestId = (req.headers['x-request-id'] as string) || 'req-unknown';
      return res.status(429).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'คำขอเข้าใช้งานถี่เกินไป กรุณารอครู่หนึ่งแล้วลองใหม่อีกครั้ง',
          fieldErrors: null,
          requestId,
          timestamp: new Date().toISOString(),
        },
      });
    }

    next();
  };
}

/**
 * Two-Tier Slip Upload Rate Limiter Middleware:
 * - Tier 1: User / Dormitory limit: 5 uploads per minute
 * - Tier 2: IP address limit: 15 uploads per 5 minutes
 * - Cooldown: 5-second mandatory cooldown between consecutive uploads per user
 */
export function createSlipUploadRateLimiter(store: DistributedRateLimiterStore = distributedRateLimiterStore) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const ip = (req.ip || req.socket?.remoteAddress || '127.0.0.1').toString().trim();
    const requestId = (req.headers['x-request-id'] as string) || (req as any).id || 'req-unknown';

    let userId = (req as any).auth?.userId || (req as any).user?.id;
    let dormitoryId = (req as any).dormitoryContext?.dormitoryId || (req as any).auth?.dormitoryId;

    if (!userId || !dormitoryId) {
      try {
        const ctx = (req as any).dormitoryContext || (await resolveAuthoritativeDormitoryContext(req));
        userId = ctx.userId;
        dormitoryId = ctx.dormitoryId;
        (req as any).dormitoryContext = ctx;
      } catch (_e) {
        // Unauthenticated or context failure will be handled by requireAuth downstream
        userId = userId || 'anon-user';
        dormitoryId = dormitoryId || 'global';
      }
    }

    // 1. Mandatory 5-Second Cooldown (Anti-rapid bursts / UI double-click)
    const cooldownKey = `cooldown:slip:${dormitoryId}:${userId}`;
    const cooldownAllowed = await store.checkCooldown(cooldownKey, 5000);
    if (!cooldownAllowed) {
      return res.status(429).json({
        error: {
          code: 'COOLDOWN_ACTIVE',
          message: 'กรุณารอ 5 วินาทีก่อนส่งตรวจสอบสลิปอีกครั้ง',
          fieldErrors: null,
          requestId,
          timestamp: new Date().toISOString(),
        },
      });
    }

    // 2. Tier 1: 5 uploads / 60 seconds per User / Dormitory
    const userLimitKey = `rate_limit:slip:user:${dormitoryId}:${userId}`;
    const userAllowed = await store.isAllowed(userLimitKey, 5, 60 * 1000);
    if (!userAllowed) {
      return res.status(429).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'คุณส่งคำขอตรวจสอบสลิปถี่เกินไป (จำกัด 5 ครั้งต่อนาที) กรุณารอสักครู่แล้วลองใหม่อีกครั้ง',
          fieldErrors: null,
          requestId,
          timestamp: new Date().toISOString(),
        },
      });
    }

    // 3. Tier 2: 15 uploads / 300 seconds per IP address
    const ipLimitKey = `rate_limit:slip:ip:${ip}`;
    const ipAllowed = await store.isAllowed(ipLimitKey, 15, 5 * 60 * 1000);
    if (!ipAllowed) {
      return res.status(429).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'IP ของคุณส่งคำขอตรวจสอบสลิปถี่เกินไป (จำกัด 15 ครั้งต่อ 5 นาที) กรุณารอสักครู่แล้วลองใหม่อีกครั้ง',
          fieldErrors: null,
          requestId,
          timestamp: new Date().toISOString(),
        },
      });
    }

    next();
  };
}

/**
 * Rate Limiter Middleware for Public Tenant Registration and Claim Endpoints:
 * - 15 requests per 15 minutes per IP address
 * - Protects /verify-claim, /complete-claim, and POST /tenant-registrations
 */
export function createTenantRegistrationRateLimiter(store: DistributedRateLimiterStore = distributedRateLimiterStore) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const ip = (req.ip || req.socket?.remoteAddress || '127.0.0.1').toString().trim();
    const requestId = (req.headers['x-request-id'] as string) || (req as any).id || 'req-unknown';

    const key = `rate_limit:registration:ip:${ip}`;
    const allowed = await store.isAllowed(key, 15, 15 * 60 * 1000);

    if (!allowed) {
      return res.status(429).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'คำขอลงทะเบียนหรือยืนยันสิทธิ์ถี่เกินไป กรุณารอ 15 นาทีแล้วลองใหม่อีกครั้ง',
          fieldErrors: null,
          requestId,
          timestamp: new Date().toISOString(),
        },
      });
    }

    next();
  };
}

/**
 * Rate Limiter Middleware for LINE OA Webhook:
 * - 120 requests per 1 minute per IP address
 * - High threshold to handle burst traffic from LINE messaging without dropping events or blocking legitimate retries
 */
export function createLineWebhookRateLimiter(store: DistributedRateLimiterStore = distributedRateLimiterStore) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const ip = (req.ip || req.socket?.remoteAddress || '127.0.0.1').toString().trim();
    const requestId = (req.headers['x-request-id'] as string) || (req as any).id || 'req-unknown';

    const key = `rate_limit:webhook:line:ip:${ip}`;
    const allowed = await store.isAllowed(key, 120, 60 * 1000);

    if (!allowed) {
      return res.status(429).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Webhook request limit exceeded. Please retry after a brief delay.',
          fieldErrors: null,
          requestId,
          timestamp: new Date().toISOString(),
        },
      });
    }

    next();
  };
}

