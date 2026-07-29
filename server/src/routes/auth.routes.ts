import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getEnv } from '../config/env.js';
import { AuthenticationService } from '../services/auth.service.js';
import { createRequireSessionMiddleware } from '../middleware/require-session.js';
import { createCsrfMiddleware } from '../middleware/csrf.js';
import { createRateLimiterMiddleware } from '../middleware/rate-limiter.js';

const googleAuthSchema = z.object({
  idToken: z.string().min(1, 'idToken is required'),
  intent: z.enum(['owner', 'staff']).optional().default('owner'),
});

export function createAuthRouter(authService: AuthenticationService): Router {
  const router = Router();
  const env = getEnv();

  const requireSession = createRequireSessionMiddleware(authService);
  const csrfMiddleware = createCsrfMiddleware(authService);
  const authRateLimiter = createRateLimiterMiddleware({ windowMs: 15 * 60 * 1000, maxRequests: 20 });

  // Cookie helper options
  const isProd = env.COOKIE_SECURE || env.NODE_ENV === 'production';
  const sameSite = env.COOKIE_SAME_SITE;

  // POST /api/v1/auth/google
  router.post('/google', authRateLimiter, async (req: Request, res: Response, next) => {
    try {
      const parsed = googleAuthSchema.safeParse(req.body);
      if (!parsed.success) {
        const requestId = (req.headers['x-request-id'] as string) || 'req-unknown';
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'ข้อมูลการเข้าสู่ระบบไม่ถูกต้อง',
            fieldErrors: parsed.error.flatten().fieldErrors,
            requestId,
            timestamp: new Date().toISOString(),
          },
        });
      }

      const userAgent = req.headers['user-agent'];
      const ipMetadata = (req.headers['x-forwarded-for'] as string) || req.ip;
      const requestId = (req.headers['x-request-id'] as string) || 'req-unknown';

      const authResult = await authService.authenticateGoogle({
        idToken: parsed.data.idToken,
        intent: parsed.data.intent,
        userAgent,
        ipMetadata,
        requestId,
      });

      // Set HttpOnly Session Cookie
      res.cookie(env.SESSION_COOKIE_NAME, authResult.sessionToken, {
        httpOnly: true,
        secure: isProd,
        sameSite: sameSite,
        path: '/',
        maxAge: env.SESSION_TTL_SECONDS * 1000,
      });

      // Set CSRF Cookie (readable by JS to include in X-CSRF-Token header)
      res.cookie(env.CSRF_COOKIE_NAME, authResult.csrfToken, {
        httpOnly: false,
        secure: isProd,
        sameSite: sameSite,
        path: '/',
        maxAge: env.SESSION_TTL_SECONDS * 1000,
      });

      return res.status(200).json({
        data: {
          user: authResult.user,
          memberships: authResult.memberships,
          onboardingRequired: authResult.onboardingRequired,
          csrfToken: authResult.csrfToken,
        },
      });
    } catch (err: any) {
      next(err);
    }
  });

  // GET /api/v1/auth/session
  router.get('/session', requireSession, async (req: Request, res: Response) => {
    const auth = req.auth!;
    const activeMemberships = auth.memberships.filter((m) => m.status === 'active');

    return res.status(200).json({
      data: {
        authenticated: true,
        user: {
          id: auth.user.id,
          email: auth.user.email,
          name: auth.user.name,
          avatarUrl: auth.user.avatarUrl,
        },
        memberships: auth.memberships.map((m) => ({
          id: m.id,
          dormitoryId: m.dormitoryId,
          dormitoryName: m.dormitoryName,
          roleCode: m.roleCode || 'OWNER',
          status: m.status,
        })),
        onboardingRequired: activeMemberships.length === 0,
        expiresAt: auth.session.expiresAt,
      },
    });
  });

  // POST /api/v1/auth/logout
  router.post('/logout', authRateLimiter, requireSession, csrfMiddleware, async (req: Request, res: Response, next) => {
    try {
      const requestId = (req.headers['x-request-id'] as string) || 'req-unknown';
      await authService.logout(req.auth!.sessionId, req.auth!.userId, requestId);

      res.clearCookie(env.SESSION_COOKIE_NAME, { path: '/', httpOnly: true, secure: isProd, sameSite });
      res.clearCookie(env.CSRF_COOKIE_NAME, { path: '/', httpOnly: false, secure: isProd, sameSite });

      return res.status(200).json({
        data: {
          success: true,
          message: 'ออกจากระบบสำเร็จ',
        },
      });
    } catch (err: any) {
      next(err);
    }
  });

  // POST /api/v1/auth/logout-all
  router.post('/logout-all', authRateLimiter, requireSession, csrfMiddleware, async (req: Request, res: Response, next) => {
    try {
      const requestId = (req.headers['x-request-id'] as string) || 'req-unknown';
      const count = await authService.logoutAll(req.auth!.userId, requestId);

      res.clearCookie(env.SESSION_COOKIE_NAME, { path: '/', httpOnly: true, secure: isProd, sameSite });
      res.clearCookie(env.CSRF_COOKIE_NAME, { path: '/', httpOnly: false, secure: isProd, sameSite });

      return res.status(200).json({
        data: {
          success: true,
          revokedCount: count,
          message: 'ออกจากระบบทุกอุปกรณ์เรียบร้อยแล้ว',
        },
      });
    } catch (err: any) {
      next(err);
    }
  });

  return router;
}
