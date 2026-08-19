/**
 * @license Apache-2.0
 * Tenant Claim Routes (LOCAL-07 Batch 02)
 * Pre-link authenticated candidate discovery & self-claim execution with durable composite & actor-level rate limiting.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthenticationService } from '../services/auth.service.js';
import { TenantClaimService } from '../services/tenant-claim.service.js';
import { createRequireSessionMiddleware } from '../middleware/require-session.js';
import { createCsrfMiddleware } from '../middleware/csrf.js';
import { InMemoryRateLimiterStore } from '../middleware/rate-limiter.js';
import { getRedisClient } from '../db/redis.js';

class DistributedClaimRateLimiter {
  private memoryStore = new InMemoryRateLimiterStore();

  public async isAllowed(key: string, maxRequests: number, windowMs: number): Promise<boolean> {
    const isProduction = process.env.NODE_ENV === 'production';
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
      if (isProduction) {
        const err = new Error('Durable rate limiter is temporarily unavailable');
        (err as any).statusCode = 503;
        (err as any).code = 'RATE_LIMITER_UNAVAILABLE';
        throw err;
      }
    }

    if (isProduction) {
      const err = new Error('Durable rate limiter is required in production');
      (err as any).statusCode = 503;
      (err as any).code = 'RATE_LIMITER_UNAVAILABLE';
      throw err;
    }

    // Explicit non-production fallback for tests & local dev
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
  const requireCsrf = createCsrfMiddleware(authService);

  // Composite & Actor-level dual rate limiter:
  // 1. Room-scoped: max 5 attempts per 15 minutes per room/user/IP
  // 2. Actor-scoped: max 15 attempts per 15 minutes per user/IP across all rooms
  const claimRateLimiter = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ip = req.ip || (req.headers['x-forwarded-for'] as string) || '127.0.0.1';
      const userId = req.auth?.userId || 'anonymous';
      const dormId = (req.body?.dormitoryId as string) || (req.query?.dormitoryId as string) || 'global';
      const roomRef =
        (req.body?.roomId as string) ||
        (req.body?.roomNumber as string) ||
        (req.query?.roomId as string) ||
        (req.query?.roomNumber as string) ||
        'global';

      const roomKey = `rate_limit:tenant_claim:room:${dormId}:${roomRef}:${userId}:${ip}`;
      const actorKey = `rate_limit:tenant_claim:actor:${userId}:${ip}`;

      const [roomAllowed, actorAllowed] = await Promise.all([
        claimRateLimiterStore.isAllowed(roomKey, 5, 15 * 60 * 1000),
        claimRateLimiterStore.isAllowed(actorKey, 15, 15 * 60 * 1000),
      ]);

      if (!roomAllowed || !actorAllowed) {
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
    } catch (err: any) {
      if (err.statusCode === 503 || err.code === 'RATE_LIMITER_UNAVAILABLE') {
        return res.status(503).json({
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'ระบบรักษาความปลอดภัยชั่วคราวไม่พร้อมใช้งาน กรุณาลองใหม่อีกครั้ง',
            fieldErrors: null,
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }
      next(err);
    }
  };

  const handleServiceError = (res: Response, err: any, req: Request) => {
    const internalCode = err.code || 'CLAIM_OPERATION_FAILED';

    // List of standard claim business-denial / identity failure codes that must NOT be enumerated
    const isClaimDenial = [
      'CLAIM_MATCH_FAILED',
      'CLAIM_MEMBERSHIP_CONFLICT',
      'CLAIM_CORRUPTED_MEMBERSHIP_ROLE',
      'CLAIM_ALREADY_LINKED',
      'CLAIM_USER_ALREADY_LINKED_IN_DORM',
      'CLAIM_CANDIDATE_UNAVAILABLE',
      'CLAIM_AMBIGUOUS_CANDIDATE',
      'CLAIM_UNAVAILABLE',
      'ROOM_NOT_FOUND',
    ].includes(internalCode);

    if (isClaimDenial) {
      return res.status(404).json({
        error: {
          code: 'CLAIM_UNAVAILABLE',
          message: 'ไม่พบข้อมูลผู้เช่าที่ตรงกับข้อมูลที่ระบุ หรือห้องพักนี้ไม่สามารถยืนยันสิทธิ์ได้ในขณะนี้',
          fieldErrors: null,
          requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
          timestamp: new Date().toISOString(),
        },
      });
    }

    const statusCode = err.statusCode || err.status || 500;
    res.status(statusCode).json({
      error: {
        code: internalCode,
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
      const queryDormId = (req.query.dormitoryId as string)?.trim();
      const headerDormId = (req.headers['x-dormitory-id'] as string)?.trim();

      if (queryDormId && headerDormId && queryDormId !== headerDormId) {
        return res.status(400).json({
          error: {
            code: 'DORMITORY_ID_MISMATCH',
            message: 'รหัสหอพักใน Header และ Query parameter ไม่ตรงกัน',
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const dormitoryId = queryDormId || headerDormId;
      const roomId = (req.query.roomId as string)?.trim();
      const roomNumber = (req.query.roomNumber as string)?.trim();

      if (!dormitoryId || (!roomId && !roomNumber)) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'กรุณาระบุ dormitoryId และ roomId หรือ roomNumber',
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const result = await claimService.getCandidateForRoom(dormitoryId, { roomId, roomNumber });

      res.json({ data: result });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // 2. Execute Claim (Pre-link authenticated + rate limited)
  const ClaimSchema = z
    .object({
      dormitoryId: z.string().uuid('รหัสหอพักไม่ถูกต้อง'),
      roomId: z.string().uuid('รหัสห้องพักไม่ถูกต้อง').optional(),
      roomNumber: z.string().optional(),
      claimInput: z.string().trim().min(1, 'กรุณาระบุชื่อ-นามสกุล หรือ เบอร์โทรศัพท์'),
    })
    .refine((data) => !!data.roomId || !!data.roomNumber, {
      message: 'กรุณาระบุห้องพัก (roomId หรือ roomNumber)',
      path: ['roomNumber'],
    });

  router.post('/claim', requireSession, requireCsrf, claimRateLimiter, async (req: Request, res: Response) => {
    try {
      const parsed = ClaimSchema.parse(req.body);
      const headerDormId = (req.headers['x-dormitory-id'] as string)?.trim();

      if (headerDormId && headerDormId !== parsed.dormitoryId) {
        return res.status(400).json({
          error: {
            code: 'DORMITORY_ID_MISMATCH',
            message: 'รหัสหอพักใน Header และ Body ไม่ตรงกัน',
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }

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
