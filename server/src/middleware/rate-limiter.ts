import { Request, Response, NextFunction } from 'express';

export interface RateLimiterOptions {
  windowMs?: number; // default 15 mins (900000 ms)
  maxRequests?: number; // default 30 requests per window
}

export class InMemoryRateLimiterStore {
  private hits: Map<string, { count: number; resetTime: number }> = new Map();

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

  public resetKey(key: string): void {
    this.hits.delete(key);
  }
}

const defaultStore = new InMemoryRateLimiterStore();

export function createRateLimiterMiddleware(options: RateLimiterOptions = {}) {
  const windowMs = options.windowMs || 15 * 60 * 1000;
  const maxRequests = options.maxRequests || 30;

  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || '127.0.0.1';
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
