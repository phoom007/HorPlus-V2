/**
 * @license Apache-2.0
 * Tenant Claim Routes (LOCAL-07 Batch 02)
 * Pre-link authenticated candidate discovery & self-claim execution with durable composite rate limiting.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthenticationService } from '../services/auth.service.js';
import { TenantClaimService } from '../services/tenant-claim.service.js';
import { createRequireSessionMiddleware } from '../middleware/require-session.js';
import { InMemoryRateLimiterStore } from '../middleware/rate-limiter.js';
import { getRedisClient } from '../db/redis.js';

class DistributedClaimRateLimiter {
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
      // Graceful fallback to memory store
    }
    return this.memoryStore.isAllowed(key, maxRequests, windowMs);
  }
}

const claimRateLimiterStore = new DistributedClaimRateLimiter();

export function createTenantClaimRouter(
  authService: AuthenticationService,
  claimService: TenantClaimService
): Router {
  const router = Router();
  const requireSession = createRequireSessionMiddleware(authService);

  // Composite rate limiter: max 5 claim attempts per 15 minutes per user/IP/dorm/room
  const claimRateLimiter = async (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || (req.headers['x-forwarded-for'] as string) || '127.0.0.1';
    const userId = req.auth?.userId || 'anonymous';
    const dormId = (req.body?.dormitoryId as string) || (req.query?.dormitoryId as string) || 'global';
    const roomId = (req.body?.roomId as string) || (req.query?.roomId as string) || 'global';

    const key = `rate_limit:tenant_claim:${dormId}:${roomId}:${userId}:${ip}`;
    const allowed = await claimRateLimiterStore.isAllowed(key, 5, 15 * 60 * 1000);

    if (!allowed) {
      const requestId = (req.headers['x-request-id'] as string) || 'req-unknown';
      return res.status(429).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'คุณได้พยายามยืนยันสิทธิ์เกินจำนวนครั้งที่กำหนด กรุณารอ 15 นาทีแล้วลองใหม่อีกครั้ง',
          fieldErrors: null,
          requestId,
          timestamp: new Date().toISOString(),
        },
      });
    }

    next();
  };

  const handleServiceError = (res: Response, err: any, req: Request) => {
    const statusCode = err.statusCode || err.status || 500;
    res.status(statusCode).json({
      error: {
        code: err.code || 'CLAIM_OPERATION_FAILED',
        message: err.message || 'เกิดข้อผิดพลาดในการยืนยันสิทธิ์ผู้เช่า',
        fieldErrors: err.fieldErrors || null,
        requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
        timestamp: new Date().toISOString(),
      },
    });
  };

  // 1. Candidate Discovery (Pre-link authenticated + rate limited)
  router.get('/candidate', requireSession, claimRateLimiter, async (req: Request, res: Response) => {
    try {
      const dormitoryId = req.query.dormitoryId as string;
      const roomId = req.query.roomId as string;

      if (!dormitoryId || !roomId) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'กรุณาระบุ dormitoryId และ roomId',
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const result = await claimService.getCandidateForRoom(dormitoryId, roomId);

      res.json({ data: result });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // 2. Execute Claim (Pre-link authenticated + rate limited)
  const ClaimSchema = z.object({
    dormitoryId: z.string().uuid('รหัสหอพักไม่ถูกต้อง'),
    roomId: z.string().min(1, 'กรุณาระบุห้องพัก'),
    claimInput: z.string().trim().min(1, 'กรุณาระบุชื่อ-นามสกุล หรือ เบอร์โทรศัพท์'),
  });

  router.post('/claim', requireSession, claimRateLimiter, async (req: Request, res: Response) => {
    try {
      const parsed = ClaimSchema.parse(req.body);
      const userId = req.auth!.userId;
      const ip = req.ip || (req.headers['x-forwarded-for'] as string) || '127.0.0.1';

      const result = await claimService.claimTenant(parsed, userId, ip);

      res.json({
        data: result,
        message: 'ยืนยันสิทธิ์ผู้เช่าสำเร็จเรียบร้อยแล้ว',
      });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: err.errors[0]?.message || 'ข้อมูลไม่ถูกต้อง',
            fieldErrors: err.errors,
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }
      handleServiceError(res, err, req);
    }
  });

  return router;
}
