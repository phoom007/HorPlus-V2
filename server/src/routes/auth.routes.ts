import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getEnv } from '../config/env.js';
import { AuthenticationService } from '../services/auth.service.js';
import { referralService } from '../services/referral.service.js';
import { createRequireSessionMiddleware } from '../middleware/require-session.js';
import { createCsrfMiddleware } from '../middleware/csrf.js';
import { createRateLimiterMiddleware } from '../middleware/rate-limiter.js';
import { notFoundMiddleware } from '../middleware/not-found.js';
import { getPrismaClient } from '../db/prisma.js';

const googleAuthSchema = z.object({
  idToken: z.string().min(1, 'idToken is required'),
  intent: z.enum(['owner', 'staff']).optional().default('owner'),
  referralCode: z.string().optional(),
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

      // Bind referral code if provided during Google Auth
      let boundReferral = null;
      if (parsed.data.referralCode && /^[1-9]\d{5}$/.test(parsed.data.referralCode.trim())) {
        try {
          boundReferral = await referralService.validateAndBindReferral(
            authResult.user.id,
            parsed.data.referralCode.trim()
          );
        } catch (refErr) {
          console.warn('Failed to bind referral code during Google Auth:', refErr);
        }
      }

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
          referral: boundReferral,
        },
      });
    } catch (err: any) {
      next(err);
    }
  });

  // GET /api/v1/auth/session
  router.get('/session', requireSession, async (req: Request, res: Response) => {
    const auth = req.auth!;
    const activeMemberships = auth.memberships.filter((m) => m.status === 'active' && (!m.dormitoryStatus || m.dormitoryStatus === 'active'));

    // Auto-issue / refresh canonical signed CSRF cookie for active session
    const csrfToken = authService.getCsrfService().generateCsrfToken(auth.sessionId);
    res.cookie(env.CSRF_COOKIE_NAME, csrfToken, {
      httpOnly: false,
      secure: isProd,
      sameSite: sameSite,
      path: '/',
      maxAge: env.SESSION_TTL_SECONDS * 1000,
    });

    return res.status(200).json({
      data: {
        authenticated: true,
        csrfToken,
        user: {
          id: auth.user.id,
          email: auth.user.email,
          name: auth.user.name,
          avatarUrl: auth.user.avatarUrl,
          isDirectAccess: auth.user.id.startsWith('ag_user_'),
        },
        memberships: activeMemberships.map((m) => ({
          id: m.id,
          dormitoryId: m.dormitoryId,
          dormitoryName: m.dormitoryName,
          roleCode: m.roleCode || 'OWNER',
          status: m.status,
          hasLogo: m.hasLogo ?? false,
          logoUrl: m.logoUrl || null,
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

  // GET /api/v1/auth/dev-login (DEV ONLY: One-Click Local Login for Google Owner & other test users)
  router.get('/dev-login', async (req: Request, res: Response, next) => {
    try {
      if (isProd) {
        return res.status(404).json({ error: 'Not Found' });
      }

      const userId = (req.query.userId as string) || '20000002-0000-4000-8000-000000000002';
      const authResult = await authService.authenticateTestUser(userId);

      res.cookie(env.SESSION_COOKIE_NAME, authResult.sessionToken, {
        httpOnly: true,
        secure: isProd,
        sameSite: sameSite,
        path: '/',
        maxAge: env.SESSION_TTL_SECONDS * 1000,
      });

      res.cookie(env.CSRF_COOKIE_NAME, authResult.csrfToken, {
        httpOnly: false,
        secure: isProd,
        sameSite: sameSite,
        path: '/',
        maxAge: env.SESSION_TTL_SECONDS * 1000,
      });

      const appUrl = process.env.PUBLIC_APP_URL || 'http://127.0.0.1:5173';
      const redirectUrl = (req.query.redirect as string) || `${appUrl}/owner/dashboard`;
      return res.redirect(redirectUrl);
    } catch (err: any) {
      next(err);
    }
  });

  // GET /api/v1/auth/dev-tenant-login (DEV ONLY: One-Click Local Login for Tenant Portal)
  router.get('/dev-tenant-login', async (req: Request, res: Response, next) => {
    try {
      if (isProd) {
        return res.status(404).json({ error: 'Not Found' });
      }

      const prisma = getPrismaClient();
      const CANONICAL_UAT_DORMITORY_ID = '20000001-0000-4000-8000-000000000002'; // หอพัก HorPlus UAT Comprehensive Manor
      const requestedTenantId = req.query.tenantId as string | undefined;
      const requestedRoomNumber = req.query.roomNumber as string | undefined;
      const isUnregisteredMode = req.query.mode === 'unregistered' || req.query.unregistered === 'true';
      const rawDormId = (req.query.dormitoryId || req.cookies?.active_dormitory_id) as string | undefined;
      const effectiveDormitoryId = rawDormId && rawDormId !== 'undefined' && rawDormId !== 'null' ? rawDormId : CANONICAL_UAT_DORMITORY_ID;

      // Find tenant
      let targetTenant: any = null;
      if (isUnregisteredMode) {
        // Find tenant without active contracts/rooms in the target/canonical dormitory
        targetTenant = await prisma.tenant.findFirst({
          where: {
            dormitoryId: effectiveDormitoryId,
            deletedAt: null,
            contracts: { none: { status: 'active' } }
          },
          include: { dormitory: true },
          orderBy: { createdAt: 'desc' }
        });

        // If none found, create a designated unregistered test tenant
        if (!targetTenant) {
          targetTenant = await prisma.tenant.create({
            data: {
              dormitoryId: effectiveDormitoryId,
              tenantNumber: `TNT-UNREG-${Date.now()}`,
              firstName: 'ผู้เช่าใหม่',
              lastName: '(ยังไม่มีห้อง)',
              displayName: 'ผู้เช่าใหม่ (รอลงทะเบียน)',
              phone: '0899990000',
              status: 'active'
            },
            include: { dormitory: true }
          });
        }
      } else if (requestedTenantId) {
        targetTenant = await prisma.tenant.findUnique({
          where: { id: requestedTenantId },
          include: { dormitory: true }
        });
      } else if (requestedRoomNumber) {
        // Prioritize room in effective/canonical dormitory
        let room = await prisma.room.findFirst({
          where: {
            roomNumber: requestedRoomNumber,
            deletedAt: null,
            dormitoryId: effectiveDormitoryId
          }
        });
        if (!room) {
          room = await prisma.room.findFirst({
            where: {
              roomNumber: requestedRoomNumber,
              deletedAt: null
            }
          });
        }
        if (room) {
          // 1. Try active contract
          let contract = await prisma.contract.findFirst({
            where: { roomId: room.id, status: 'active' },
            include: { tenant: { include: { dormitory: true } } },
            orderBy: { createdAt: 'desc' }
          });

          // 2. If no active contract, try latest contract (e.g. expired / terminated for Room 204)
          if (!contract) {
            contract = await prisma.contract.findFirst({
              where: { roomId: room.id },
              include: { tenant: { include: { dormitory: true } } },
              orderBy: { createdAt: 'desc' }
            });
          }
          targetTenant = contract?.tenant;

          // 3. Try room currentTenantId
          if (!targetTenant && (room as any).currentTenantId) {
            targetTenant = await prisma.tenant.findUnique({
              where: { id: (room as any).currentTenantId },
              include: { dormitory: true }
            });
          }

          // 4. Try daily stay for daily rooms (e.g. Room 106)
          if (!targetTenant) {
            const daily = await prisma.dailyStay.findFirst({
              where: { roomId: room.id },
              include: { tenant: { include: { dormitory: true } } },
              orderBy: { createdAt: 'desc' }
            });
            targetTenant = daily?.tenant;
          }

          // 5. Try occupancy
          if (!targetTenant) {
            const occ = await prisma.occupancy.findFirst({
              where: { roomId: room.id },
              include: { tenant: { include: { dormitory: true } } },
              orderBy: { startedAt: 'desc' }
            });
            targetTenant = occ?.tenant;
          }
        }
      }

      // If not found yet, find active tenant with contract within effectiveDormitoryId
      if (!targetTenant) {
        const activeContract = await prisma.contract.findFirst({
          where: {
            status: 'active',
            tenant: { deletedAt: null },
            dormitoryId: effectiveDormitoryId
          },
          include: { tenant: { include: { dormitory: true } } },
          orderBy: { createdAt: 'desc' }
        });
        targetTenant = activeContract?.tenant;
      }

      // Fallback to non-deleted tenant within effectiveDormitoryId (or globally)
      if (!targetTenant) {
        targetTenant = await prisma.tenant.findFirst({
          where: {
            deletedAt: null,
            dormitoryId: effectiveDormitoryId
          },
          include: { dormitory: true }
        });
      }

      // Global fallback if still not found
      if (!targetTenant) {
        targetTenant = await prisma.tenant.findFirst({
          where: { deletedAt: null },
          include: { dormitory: true }
        });
      }

      if (!targetTenant) {
        return res.status(404).json({ error: 'No active tenant found in system for dev login' });
      }

      // Ensure tenant has a linked user
      let tenantUserId = targetTenant.linkedUserId;
      if (!tenantUserId) {
        const userEmail = `tenant.${targetTenant.id.slice(0, 8)}@horplus.local`;
        let user = await prisma.user.findFirst({
          where: { email: userEmail }
        });
        if (!user) {
          user = await prisma.user.create({
            data: {
              email: userEmail,
              emailNormalized: userEmail.toLowerCase(),
              name: targetTenant.displayName || `${targetTenant.firstName || ''} ${targetTenant.lastName || ''}`.trim() || 'ผู้เช่าตัวอย่าง',
              googleSubject: `dev_tenant_sub_${targetTenant.id}`,
              status: 'active'
            }
          });
        }
        tenantUserId = user.id;
        await prisma.tenant.update({
          where: { id: targetTenant.id },
          data: { linkedUserId: user.id }
        });
      }

      // Ensure DormitoryMember exists with role TENANT
      let tenantRole = await prisma.role.findFirst({
        where: { code: 'TENANT' }
      });
      if (!tenantRole) {
        tenantRole = await prisma.role.create({
          data: {
            code: 'TENANT',
            name: 'ผู้เช่า',
            permissions: [],
            isSystem: true
          }
        });
      }

      const existingMember = await prisma.dormitoryMember.findFirst({
        where: {
          dormitoryId: targetTenant.dormitoryId,
          userId: tenantUserId
        }
      });

      if (!existingMember) {
        await prisma.dormitoryMember.create({
          data: {
            dormitoryId: targetTenant.dormitoryId,
            userId: tenantUserId,
            roleId: tenantRole.id,
            status: 'active'
          }
        });
      }

      const authResult = await authService.authenticateTestUser(tenantUserId);

      res.cookie(env.SESSION_COOKIE_NAME, authResult.sessionToken, {
        httpOnly: true,
        secure: isProd,
        sameSite: sameSite,
        path: '/',
        maxAge: env.SESSION_TTL_SECONDS * 1000,
      });

      res.cookie(env.CSRF_COOKIE_NAME, authResult.csrfToken, {
        httpOnly: false,
        secure: isProd,
        sameSite: sameSite,
        path: '/',
        maxAge: env.SESSION_TTL_SECONDS * 1000,
      });

      res.cookie('active_dormitory_id', targetTenant.dormitoryId, {
        httpOnly: false,
        secure: isProd,
        sameSite: sameSite,
        path: '/',
        maxAge: env.SESSION_TTL_SECONDS * 1000,
      });

      const appUrl = process.env.PUBLIC_APP_URL || 'http://127.0.0.1:5173';
      const redirectUrl = (req.query.redirect as string) || `${appUrl}/tenant/dashboard`;
      return res.redirect(redirectUrl);
    } catch (err: any) {
      next(err);
    }
  });

  // POST /api/v1/auth/e2e-login (TEST ONLY)
  router.post('/e2e-login', async (req: Request, res: Response, next) => {
    try {
      if (isProd) {
        return res.status(404).json({ error: 'Not Found' });
      }

      const { userId } = req.body;
      if (!userId || typeof userId !== 'string') {
        return res.status(400).json({ error: 'userId is required for E2E login' });
      }

      // Mock google login internal
      const authResult = await authService.authenticateTestUser(userId);

      res.cookie(env.SESSION_COOKIE_NAME, authResult.sessionToken, {
        httpOnly: true,
        secure: isProd,
        sameSite: sameSite,
        path: '/',
        maxAge: env.SESSION_TTL_SECONDS * 1000,
      });

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

  router.use(notFoundMiddleware);

  return router;
}
