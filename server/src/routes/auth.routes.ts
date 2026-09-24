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
import crypto from 'crypto';
import { consumeDirectEntryTicket } from '../services/line-richmenu.service.js';
import { SessionTokenService } from '../services/session-token.service.js';
import { tenantRegistrationInviteService } from '../services/tenant-registration-invite.service.js';
import { generateGrantToken, encryptText, hashToken } from '../utils/crypto-encryption.js';
import { getActiveAppOrigin } from '../services/line-oa.service.js';
import { lineTokenService } from '../services/line-token.service.js';

const googleAuthSchema = z.object({
  idToken: z.string().min(1, 'idToken is required'),
  intent: z.enum(['owner', 'staff']).optional().default('owner'),
  referralCode: z.string().optional(),
});

/**
 * Sanitizes redirect target URLs to prevent open redirects.
 * Only allows safe relative paths (e.g. '/owner/home') and rejects
 * absolute URLs (http:, https:, protocol-relative //, javascript:, data:).
 */
export function sanitizeRedirectUrl(target: unknown, fallback: string): string {
  if (typeof target !== 'string') return fallback;
  const trimmed = target.trim();
  if (!trimmed) return fallback;

  // Must begin with a single '/' and not followed by another '/' or '\'
  // Also forbid control characters and newlines
  if (/^\/[^\/\\]/.test(trimmed) || trimmed === '/') {
    if (/[\r\n\t]/.test(trimmed)) return fallback;
    return trimmed;
  }

  return fallback;
}

export function createAuthRouter(authService: AuthenticationService): Router {
  const router = Router();
  const env = getEnv();

  const requireSession = createRequireSessionMiddleware(authService);
  const csrfMiddleware = createCsrfMiddleware(authService);
  const authRateLimiter = createRateLimiterMiddleware({ windowMs: 15 * 60 * 1000, maxRequests: 20 });

  // Cookie helper options
  const isProduction = env.NODE_ENV === 'production';
  const isCookieSecure = env.COOKIE_SECURE || isProduction;
  const isProd = isCookieSecure; // Maintain backward compat for cookie security references
  const sameSite = env.COOKIE_SAME_SITE;

  const resolveAppUrl = (req: Request) => {
    const isExternalLineOrigin = (urlStr: string) =>
      urlStr.includes('line.me') || urlStr.includes('line-scdn.net') || urlStr.includes('line.naver.jp');

    // 1. Check referer or origin header from browser request (accurately captures public tunnel / mobile origin)
    const referer = req.get('referer');
    if (referer) {
      try {
        const refUrl = new URL(referer);
        if (
          refUrl.origin &&
          !refUrl.origin.includes('localhost') &&
          !refUrl.origin.includes('127.0.0.1') &&
          !isExternalLineOrigin(refUrl.origin)
        ) {
          return refUrl.origin;
        }
      } catch {}
    }
    const origin = req.get('origin');
    if (
      origin &&
      !origin.includes('localhost') &&
      !origin.includes('127.0.0.1') &&
      !isExternalLineOrigin(origin)
    ) {
      return origin;
    }

    // 2. Check forwarded host or request host
    const host = req.get('x-forwarded-host') || req.get('host');
    if (host && (host.includes('.trycloudflare.com') || host.includes('ngrok') || (!host.includes('localhost') && !host.includes('127.0.0.1')))) {
      const proto =
        req.get('x-forwarded-proto') === 'https' ||
        req.protocol === 'https' ||
        host.includes('.trycloudflare.com') ||
        host.includes('ngrok')
          ? 'https'
          : 'http';
      return `${proto}://${host}`;
    }

    // 3. Configured public URL takes precedence over dynamic memory cache
    const configuredPublicUrl = (process.env.PUBLIC_APP_URL || process.env.PUBLIC_APP_ORIGIN || '').trim().replace(/\/+$/, '');
    if (configuredPublicUrl && !configuredPublicUrl.includes('localhost') && !configuredPublicUrl.includes('127.0.0.1')) {
      return configuredPublicUrl;
    }

    const dynamicOrigin = getActiveAppOrigin();
    if (dynamicOrigin && !dynamicOrigin.includes('localhost') && !dynamicOrigin.includes('127.0.0.1')) {
      return dynamicOrigin;
    }

    // 4. If referer exists even on localhost (preserves active dev port e.g. 5173 / 5174), use its origin
    if (referer) {
      try {
        const refUrl = new URL(referer);
        if (refUrl.origin) return refUrl.origin;
      } catch {}
    }

    return configuredPublicUrl || 'http://127.0.0.1:5173';
  };

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

  // GET /api/v1/auth/dev-login (One-Click Direct Login for Dormitory Owner - Dev/Test only)
  router.get('/dev-login', async (req: Request, res: Response, next) => {
    try {
      if (process.env.NODE_ENV === 'production' || isProduction || env.NODE_ENV === 'production') {
        return res.status(404).json({ error: 'Not Found' });
      }

      const grantId = req.query.grantId as string | undefined;
      const prisma = getPrismaClient();

      if (grantId) {
        const rows = await prisma.$queryRaw<any[]>`
          SELECT dormitory_id FROM public.resolve_access_grant_by_id(${grantId}::uuid)
        `.catch(() => []);
        const targetDormitoryId = rows?.[0]?.dormitory_id;

        if (targetDormitoryId) {
          const grant = await prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${targetDormitoryId}, true)`;
            return await tx.dormitoryAccessGrant.findUnique({
              where: { id: grantId },
              include: { lineFriend: true, dormitory: true }
            });
          });

          if (grant && grant.status === 'ACTIVE') {
            const sessionId = crypto.randomUUID();
            const sessionIdHash = SessionTokenService.hashSessionId(sessionId);
            const ttlSeconds = env.SESSION_TTL_SECONDS || (30 * 24 * 60 * 60);
            const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
            const userAgent = req.headers['user-agent'] ? String(req.headers['user-agent']) : undefined;
            const userAgentHash = userAgent ? crypto.createHash('sha256').update(userAgent).digest('hex') : undefined;
            const ipMetadata = (req.headers['x-forwarded-for'] as string) || req.ip || undefined;

            await prisma.session.create({
              data: {
                principalType: 'ACCESS_GRANT',
                accessGrantId: grant.id,
                sessionIdHash,
                tokenVersion: 1,
                status: 'active',
                expiresAt,
                userAgentHash,
                ipMetadata,
              },
            });

            const sessionToken = authService.getSessionTokenService().encryptToken(
              { sub: `ag_${grant.id}`, sid: sessionId, type: 'session', version: 1 },
              ttlSeconds
            );
            const csrfToken = authService.getCsrfService().generateCsrfToken(sessionId);

            res.cookie(env.SESSION_COOKIE_NAME, sessionToken, {
              httpOnly: true,
              secure: isProd,
              sameSite: sameSite,
              path: '/',
              maxAge: ttlSeconds * 1000,
            });

            res.cookie(env.CSRF_COOKIE_NAME, csrfToken, {
              httpOnly: false,
              secure: isProd,
              sameSite: sameSite,
              path: '/',
              maxAge: ttlSeconds * 1000,
            });

            res.cookie('active_dormitory_id', grant.dormitoryId, {
              httpOnly: false,
              secure: isProd,
              sameSite: sameSite,
              path: '/',
              maxAge: ttlSeconds * 1000,
            });

            const appUrl = resolveAppUrl(req);
            const redirectUrl = sanitizeRedirectUrl(req.query.redirect, `${appUrl}/owner/home`);
            return res.redirect(redirectUrl);
          }
        }
      }

      const userId = (req.query.userId as string) || '10000000-0000-4000-8000-000000000001';
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

      if (authResult.memberships && authResult.memberships.length > 0) {
        res.cookie('active_dormitory_id', authResult.memberships[0].dormitoryId, {
          httpOnly: false,
          secure: isProd,
          sameSite: sameSite,
          path: '/',
          maxAge: env.SESSION_TTL_SECONDS * 1000,
        });
      }

      const appUrl = resolveAppUrl(req);
      const redirectUrl = sanitizeRedirectUrl(req.query.redirect, `${appUrl}/owner/home`);
      return res.redirect(redirectUrl);
    } catch (err: any) {
      next(err);
    }
  });

  // GET /api/v1/auth/dev-tenant-login (DEV ONLY: One-Click Local Login for Tenant Portal)
  router.get('/dev-tenant-login', async (req: Request, res: Response, next) => {
    try {
      if (process.env.NODE_ENV === 'production' || isProduction || env.NODE_ENV === 'production') {
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

      const appUrl = resolveAppUrl(req);
      const redirectUrl = sanitizeRedirectUrl(req.query.redirect, `${appUrl}/tenant/dashboard`);
      return res.redirect(redirectUrl);
    } catch (err: any) {
      next(err);
    }
  });

  // POST /api/v1/auth/e2e-login (TEST ONLY)
  router.post('/e2e-login', async (req: Request, res: Response, next) => {
    try {
      if (
        process.env.NODE_ENV === 'production' ||
        isProduction ||
        env.NODE_ENV === 'production' ||
        (!env.E2E_TEST_MODE && process.env.NODE_ENV !== 'test' && env.NODE_ENV !== 'test')
      ) {
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

  // GET /api/v1/auth/line-direct-entry (One-Click Auto-Authentication for LINE OA Owner/Staff)
  router.get('/line-direct-entry', async (req: Request, res: Response, next) => {
    try {
      const ticket = req.query.ticket as string;
      if (!ticket) {
        return res.status(400).send(`
          <!DOCTYPE html>
          <html lang="th">
            <head>
              <meta charset="utf-8" />
              <title>ไม่พบรหัสเข้าสู่ระบบ - HorPlus</title>
              <meta name="viewport" content="width=device-width, initial-scale=1" />
              <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; color: #1e293b; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 16px; }
                .card { max-width: 400px; width: 100%; background: white; padding: 32px; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.06); text-align: center; }
                .icon { font-size: 56px; margin-bottom: 16px; }
                h2 { font-size: 20px; font-weight: 700; margin-bottom: 12px; color: #0f172a; }
                p { font-size: 14px; line-height: 1.6; color: #64748b; margin-bottom: 24px; }
              </style>
            </head>
            <body>
              <div class="card">
                <div class="icon">🔑</div>
                <h2>ไม่พบรหัสเข้าสู่ระบบ</h2>
                <p>กรุณากดปุ่ม <strong>"จัดการหอพัก"</strong> ใน LINE OA อีกครั้งเพื่อเข้าสู่ระบบ</p>
              </div>
            </body>
          </html>
        `);
      }

      const ticketData = consumeDirectEntryTicket(ticket);
      if (!ticketData) {
        return res.status(401).send(`
          <!DOCTYPE html>
          <html lang="th">
            <head>
              <meta charset="utf-8" />
              <title>ลิงก์หมดอายุ - HorPlus</title>
              <meta name="viewport" content="width=device-width, initial-scale=1" />
              <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; color: #1e293b; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 16px; }
                .card { max-width: 400px; width: 100%; background: white; padding: 32px; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.06); text-align: center; }
                .icon { font-size: 56px; margin-bottom: 16px; }
                h2 { font-size: 20px; font-weight: 700; margin-bottom: 12px; color: #0f172a; }
                p { font-size: 14px; line-height: 1.6; color: #64748b; margin-bottom: 24px; }
              </style>
            </head>
            <body>
              <div class="card">
                <div class="icon">⏱️</div>
                <h2>ลิงก์เข้าสู่ระบบหมดอายุแล้ว</h2>
                <p>ลิงก์เข้าใช้งานแบบปลอดภัยมีอายุ 60 วินาที เพื่อความปลอดภัยของข้อมูลหอพัก กรุณากดปุ่ม <strong>"จัดการหอพัก"</strong> ใน LINE OA อีกครั้งเพื่อรับลิงก์ใหม่</p>
              </div>
            </body>
          </html>
        `);
      }

      const prisma = getPrismaClient();
      const sessionId = crypto.randomUUID();
      const sessionIdHash = SessionTokenService.hashSessionId(sessionId);
      const ttlSeconds = env.SESSION_TTL_SECONDS || (30 * 24 * 60 * 60);
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
      const userAgent = req.headers['user-agent'] ? String(req.headers['user-agent']) : undefined;
      const userAgentHash = userAgent ? crypto.createHash('sha256').update(userAgent).digest('hex') : undefined;
      const ipMetadata = (req.headers['x-forwarded-for'] as string) || req.ip || undefined;

      await prisma.session.create({
        data: {
          userId: ticketData.userId || undefined,
          principalType: ticketData.grantId ? 'ACCESS_GRANT' : 'GOOGLE_USER',
          accessGrantId: ticketData.grantId || null,
          sessionIdHash,
          tokenVersion: 1,
          status: 'active',
          expiresAt,
          userAgentHash,
          ipMetadata,
        },
      });

      const sub = ticketData.grantId ? `ag_${ticketData.grantId}` : ticketData.userId!;
      const sessionToken = authService.getSessionTokenService().encryptToken(
        { sub, sid: sessionId, type: 'session', version: 1 },
        ttlSeconds
      );
      const csrfToken = authService.getCsrfService().generateCsrfToken(sessionId);

      res.cookie(env.SESSION_COOKIE_NAME, sessionToken, {
        httpOnly: true,
        secure: isProd,
        sameSite: sameSite,
        path: '/',
        maxAge: ttlSeconds * 1000,
      });

      res.cookie(env.CSRF_COOKIE_NAME, csrfToken, {
        httpOnly: false,
        secure: isProd,
        sameSite: sameSite,
        path: '/',
        maxAge: ttlSeconds * 1000,
      });

      res.cookie('active_dormitory_id', ticketData.dormitoryId, {
        httpOnly: false,
        secure: isProd,
        sameSite: sameSite,
        path: '/',
        maxAge: ttlSeconds * 1000,
      });

      const appUrl = resolveAppUrl(req);
      return res.redirect(`${appUrl}/owner/home`);
    } catch (err: any) {
      next(err);
    }
  });

  // GET /api/v1/auth/line-tenant-entry (One-Click Auto-Authentication for LINE Tenant Registration / Portal)
  router.get('/line-tenant-entry', async (req: Request, res: Response, next) => {
    try {
      let rawToken = (req.query.t || req.query.token) as string;

      // Fallback 1: inspect query object keys for percent-encoded formats (e.g. t%3D<token> or t=<token> stored as query key)
      if (!rawToken || typeof rawToken !== 'string' || !rawToken.trim()) {
        for (const [key, val] of Object.entries(req.query)) {
          if (key === 't' || key === 'token') {
            if (typeof val === 'string' && val.trim()) {
              rawToken = val.trim();
              break;
            }
          }
          if (/^t(?:=|%3D)/i.test(key)) {
            rawToken = key.replace(/^t(?:=|%3D)/i, '').trim();
            break;
          }
          if (/^token(?:=|%3D)/i.test(key)) {
            rawToken = key.replace(/^token(?:=|%3D)/i, '').trim();
            break;
          }
        }
      }

      // Fallback 2: parse from req.originalUrl / req.url query string directly
      if (!rawToken || typeof rawToken !== 'string' || !rawToken.trim()) {
        const rawUrl = req.originalUrl || req.url || '';
        const qIndex = rawUrl.indexOf('?');
        if (qIndex !== -1) {
          const rawQuery = rawUrl.slice(qIndex + 1);
          for (const cand of [rawQuery, decodeURIComponent(rawQuery)]) {
            const match = cand.match(/(?:^|[&?])(?:t|token)(?:=|%3D)([^&?#]+)/i);
            if (match && match[1]) {
              rawToken = decodeURIComponent(match[1]).trim();
              break;
            }
          }
        }
      }

      // Fallback 3: check liff.state parameter if passed through LIFF redirect
      if (!rawToken || typeof rawToken !== 'string' || !rawToken.trim()) {
        const liffState = (req.query['liff.state'] || req.query['liff_state']) as string;
        if (liffState) {
          try {
            let decoded = decodeURIComponent(liffState);
            if (decoded.includes('%')) {
              try { decoded = decodeURIComponent(decoded); } catch {}
            }
            const match = decoded.match(/(?:^|[&?#/])(?:t|token)(?:=|%3D)([^&?#]+)/i);
            if (match && match[1]) {
              rawToken = decodeURIComponent(match[1]).trim();
            }
          } catch {}
        }
      }

      if (!rawToken || typeof rawToken !== 'string' || !rawToken.trim()) {
        return res.status(400).send(`
          <!DOCTYPE html>
          <html lang="th">
            <head>
              <meta charset="utf-8" />
              <title>ลิงก์ไม่ถูกต้อง - HorPlus</title>
              <meta name="viewport" content="width=device-width, initial-scale=1" />
              <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; color: #1e293b; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 16px; }
                .card { max-width: 400px; width: 100%; background: white; padding: 32px; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.06); text-align: center; }
                .icon { font-size: 56px; margin-bottom: 16px; }
                h2 { font-size: 20px; font-weight: 700; margin-bottom: 12px; color: #0f172a; }
                p { font-size: 14px; line-height: 1.6; color: #64748b; margin-bottom: 24px; }
              </style>
            </head>
            <body>
              <div class="card">
                <div class="icon">⚠️</div>
                <h2>ไม่พบรหัสเชิญลงทะเบียน</h2>
                <p>กรุณากดปุ่ม <strong>"ลงทะเบียนผู้เช่า"</strong> ใน LINE OA ของหอพักอีกครั้งเพื่อรับลิงก์ใหม่</p>
              </div>
            </body>
          </html>
        `);
      }

      let invite: any;
      try {
        invite = await tenantRegistrationInviteService.resolveInvite(rawToken.trim());
      } catch (err: any) {
        return res.status(err.statusCode || 401).send(`
          <!DOCTYPE html>
          <html lang="th">
            <head>
              <meta charset="utf-8" />
              <title>ลิงก์หมดอายุหรือถูกยกเลิก - HorPlus</title>
              <meta name="viewport" content="width=device-width, initial-scale=1" />
              <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; color: #1e293b; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 16px; }
                .card { max-width: 400px; width: 100%; background: white; padding: 32px; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.06); text-align: center; }
                .icon { font-size: 56px; margin-bottom: 16px; }
                h2 { font-size: 20px; font-weight: 700; margin-bottom: 12px; color: #0f172a; }
                p { font-size: 14px; line-height: 1.6; color: #64748b; margin-bottom: 24px; }
              </style>
            </head>
            <body>
              <div class="card">
                <div class="icon">⏱️</div>
                <h2>${err.message || 'ลิงก์ลงทะเบียนหมดอายุแล้ว'}</h2>
                <p>ลิงก์ลงทะเบียนผู้เช่ามีอายุ 7 วัน กรุณากดปุ่ม <strong>"ลงทะเบียนผู้เช่า"</strong> ใน LINE OA อีกครั้งเพื่อรับลิงก์ใหม่</p>
              </div>
            </body>
          </html>
        `);
      }

      const prisma = getPrismaClient();

      const { grant, sessionId } = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${invite.dormitoryId}, true)`;

        // Find existing active DormitoryAccessGrant for this LINE friend in this dormitory
        let g = invite.lineFriendId
          ? await tx.dormitoryAccessGrant.findFirst({
              where: {
                dormitoryId: invite.dormitoryId,
                lineFriendId: invite.lineFriendId,
                roleCode: 'TENANT',
                status: 'ACTIVE',
              },
            })
          : null;

        if (!g) {
          try {
            const { rawToken: grantRawToken, tokenHash, tokenPrefix } = generateGrantToken();
            const tokenEncrypted = encryptText(grantRawToken);
            g = await tx.dormitoryAccessGrant.create({
              data: {
                dormitoryId: invite.dormitoryId,
                lineFriendId: invite.lineFriendId,
                tokenHash,
                tokenEncrypted,
                tokenPrefix,
                roleCode: 'TENANT',
                status: 'ACTIVE',
                createdByPrincipal: 'system_line_tenant_entry',
              },
            });
          } catch (err: any) {
            // In case of concurrent request or existing active grant race condition
            if (err?.code === 'P2002' && invite.lineFriendId) {
              g = await tx.dormitoryAccessGrant.findFirst({
                where: {
                  dormitoryId: invite.dormitoryId,
                  lineFriendId: invite.lineFriendId,
                  roleCode: 'TENANT',
                  status: 'ACTIVE',
                },
              });
            }
            if (!g) throw err;
          }
        }

        const sid = crypto.randomUUID();
        const sessionIdHash = SessionTokenService.hashSessionId(sid);
        const ttlSeconds = env.SESSION_TTL_SECONDS || (30 * 24 * 60 * 60);
        const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
        const userAgent = req.headers['user-agent'] ? String(req.headers['user-agent']) : undefined;
        const userAgentHash = userAgent ? crypto.createHash('sha256').update(userAgent).digest('hex') : undefined;
        const ipMetadata = (req.headers['x-forwarded-for'] as string) || req.ip || undefined;

        await tx.session.create({
          data: {
            principalType: 'ACCESS_GRANT',
            accessGrantId: g.id,
            sessionIdHash,
            tokenVersion: 1,
            status: 'active',
            expiresAt,
            userAgentHash,
            ipMetadata,
          },
        });

        return { grant: g, sessionId: sid };
      });

      const ttlSeconds = env.SESSION_TTL_SECONDS || (30 * 24 * 60 * 60);
      const sessionToken = authService.getSessionTokenService().encryptToken(
        { sub: `ag_${grant.id}`, sid: sessionId, type: 'session', version: 1 },
        ttlSeconds
      );
      const csrfToken = authService.getCsrfService().generateCsrfToken(sessionId);

      res.cookie(env.SESSION_COOKIE_NAME, sessionToken, {
        httpOnly: true,
        secure: isProd,
        sameSite: sameSite,
        path: '/',
        maxAge: ttlSeconds * 1000,
      });

      res.cookie(env.CSRF_COOKIE_NAME, csrfToken, {
        httpOnly: false,
        secure: isProd,
        sameSite: sameSite,
        path: '/',
        maxAge: ttlSeconds * 1000,
      });

      res.cookie('active_dormitory_id', invite.dormitoryId, {
        httpOnly: false,
        secure: isProd,
        sameSite: sameSite,
        path: '/',
        maxAge: ttlSeconds * 1000,
      });

      const appUrl = resolveAppUrl(req);

      // Check if this tenant is already registered, active, or pending approval
      const targetFriendId = invite.lineFriendId || grant.lineFriendId;
      let isRegistered = false;

      if (targetFriendId) {
        let existingTenant = await prisma.tenant.findFirst({
          where: {
            dormitoryId: invite.dormitoryId,
            lineFriendId: targetFriendId,
            deletedAt: null,
            status: 'active',
          },
        });

        if (!existingTenant) {
          const reqWithApproved = await prisma.tenantRegistrationRequest.findFirst({
            where: {
              dormitoryId: invite.dormitoryId,
              lineFollowerId: targetFriendId,
              status: 'approved',
              approvedTenantId: { not: null },
            },
            orderBy: { createdAt: 'desc' },
          });
          if (reqWithApproved?.approvedTenantId) {
            existingTenant = await prisma.tenant.findFirst({
              where: {
                id: reqWithApproved.approvedTenantId,
                dormitoryId: invite.dormitoryId,
                deletedAt: null,
                status: 'active',
              },
            });
            if (existingTenant && !existingTenant.lineFriendId) {
              await prisma.tenant.update({
                where: { id: existingTenant.id },
                data: { lineFriendId: targetFriendId },
              });
            }
          }
        }

        if (existingTenant) {
          isRegistered = true;
          // R1: Self-healing / Sync Active Tenant Rich Menu for active tenants
          if (targetFriendId) {
            try {
              const lineFriend = await prisma.dormitoryLineFriend.findUnique({
                where: { id: targetFriendId },
              });
              if (lineFriend && lineFriend.lineUserIdEncrypted) {
                const { decryptText } = await import('../utils/crypto-encryption.js');
                const lineUserId = decryptText(lineFriend.lineUserIdEncrypted);
                const { LineRichMenuService } = await import('../services/line-richmenu.service.js');
                const richMenuService = new LineRichMenuService(prisma);
                richMenuService.linkActiveTenantRichMenu(invite.dormitoryId, lineUserId).catch(() => {});
              }
            } catch {}
          }
        } else {
          const existingReq = await prisma.tenantRegistrationRequest.findFirst({
            where: {
              dormitoryId: invite.dormitoryId,
              lineFollowerId: targetFriendId,
              status: { in: ['pending_owner_approval', 'awaiting_tenant_confirmation', 'approved', 'rejected'] },
            },
          });
          if (existingReq) {
            isRegistered = true;
          }
        }
      }

      if (isRegistered) {
        return res.redirect(`${appUrl}/tenant`);
      }

      return res.redirect(`${appUrl}/tenant?sub=register${rawToken ? `&t=${encodeURIComponent(rawToken)}` : ''}`);
    } catch (err: any) {
      next(err);
    }
  });

  /**
   * POST /api/v1/auth/line-liff-session
   * Establishes a verified tenant session using a cryptographically verified LIFF ID token.
   * Satisfies Card S2 (ADR-003:16, REQUIREMENTS-LOCK §10 line 171).
   */
  router.post('/line-liff-session', authRateLimiter, async (req: Request, res: Response, next) => {
    try {
      const { idToken, entryToken, dormitoryId: clientDormitoryId } = req.body || {};

      if (!idToken || typeof idToken !== 'string' || !idToken.trim()) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'MISSING_ID_TOKEN',
            message: 'ไม่พบโทเค็นระบุตัวตน LINE (ID Token)',
          },
        });
      }

      // 1. Verify LINE ID token via LineTokenService
      const verification = await lineTokenService.verifyLineIdToken({ idToken: idToken.trim() });
      if (!verification.valid || !verification.lineUserId) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'โทเค็น LINE ไม่ถูกต้องหรือหมดอายุแล้ว กรุณาล็อกอินใหม่อีกครั้ง',
            detail: verification.error,
          },
        });
      }

      const verifiedLineUserId = verification.lineUserId;
      const verifiedLineUserIdHash = hashToken(verifiedLineUserId);
      const prisma = getPrismaClient();

      let targetDormitoryId: string | null = null;
      let targetFriendId: string | null = null;

      // 2. If entryToken is provided, resolve invite
      if (entryToken && typeof entryToken === 'string' && entryToken.trim()) {
        try {
          const invite = await tenantRegistrationInviteService.resolveInvite(entryToken.trim());
          if (invite) {
            targetDormitoryId = invite.dormitoryId;
            targetFriendId = invite.lineFriendId;
          }
        } catch {
          // If invite token invalid/expired, continue with line friend lookup
        }
      }

      // 3. If no targetDormitoryId yet, look up lineFriend by lineUserIdHash
      if (!targetDormitoryId) {
        const matchingFriend = await prisma.dormitoryLineFriend.findFirst({
          where: clientDormitoryId
            ? { dormitoryId: clientDormitoryId, lineUserIdHash: verifiedLineUserIdHash }
            : { lineUserIdHash: verifiedLineUserIdHash },
          orderBy: { lastSeenAt: 'desc' },
        });

        if (matchingFriend) {
          targetDormitoryId = matchingFriend.dormitoryId;
          targetFriendId = matchingFriend.id;
        }
      }

      // 4. If still no dormitory found, look up active tenant grant for this line user
      if (!targetDormitoryId) {
        const grantWithFriend = await prisma.dormitoryAccessGrant.findFirst({
          where: {
            lineFriend: { lineUserIdHash: verifiedLineUserIdHash },
            roleCode: 'TENANT',
            status: 'ACTIVE',
          },
          orderBy: { updatedAt: 'desc' },
        });
        if (grantWithFriend) {
          targetDormitoryId = grantWithFriend.dormitoryId;
          targetFriendId = grantWithFriend.lineFriendId;
        }
      }

      // 5. Fallback: if client provided dormitoryId, verify it exists
      if (!targetDormitoryId && clientDormitoryId) {
        const dormExists = await prisma.dormitory.findUnique({
          where: { id: clientDormitoryId },
          select: { id: true },
        });
        if (dormExists) {
          targetDormitoryId = dormExists.id;
        }
      }

      if (!targetDormitoryId) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'LINE_FRIEND_NOT_FOUND',
            message: 'ไม่พบประวัติการเชื่อมต่อ LINE กับหอพัก กรุณาเพิ่มเพื่อนกับ LINE OA ของหอพักก่อนเข้าใช้งาน',
          },
        });
      }

      // 6. Ensure DormitoryLineFriend exists and is updated with latest profile info
      if (!targetFriendId) {
        const existingFriend = await prisma.dormitoryLineFriend.findUnique({
          where: {
            dormitory_line_friend_unique: {
              dormitoryId: targetDormitoryId,
              lineUserIdHash: verifiedLineUserIdHash,
            },
          },
        });
        if (existingFriend) {
          targetFriendId = existingFriend.id;
          await prisma.dormitoryLineFriend.update({
            where: { id: existingFriend.id },
            data: {
              lastSeenAt: new Date(),
              displayName: verification.displayName || existingFriend.displayName,
              pictureUrl: verification.pictureUrl !== undefined ? verification.pictureUrl : existingFriend.pictureUrl,
            },
          });
        } else {
          const newFriend = await prisma.dormitoryLineFriend.create({
            data: {
              dormitoryId: targetDormitoryId,
              lineUserIdHash: verifiedLineUserIdHash,
              lineUserIdEncrypted: encryptText(verifiedLineUserId),
              displayName: verification.displayName || 'ผู้ใช้งาน LINE',
              pictureUrl: verification.pictureUrl,
              friendStatus: 'FOLLOWING',
            },
          });
          targetFriendId = newFriend.id;
        }
      }

      // 7. Ensure DormitoryAccessGrant exists for TENANT and issue session
      const { grant, sessionId } = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${targetDormitoryId}, true)`;

        let g = await tx.dormitoryAccessGrant.findFirst({
          where: {
            dormitoryId: targetDormitoryId!,
            lineFriendId: targetFriendId!,
            roleCode: 'TENANT',
            status: 'ACTIVE',
          },
        });

        if (!g) {
          const { rawToken: grantRawToken, tokenHash, tokenPrefix } = generateGrantToken();
          const tokenEncrypted = encryptText(grantRawToken);
          g = await tx.dormitoryAccessGrant.create({
            data: {
              dormitoryId: targetDormitoryId!,
              lineFriendId: targetFriendId!,
              tokenHash,
              tokenEncrypted,
              tokenPrefix,
              roleCode: 'TENANT',
              status: 'ACTIVE',
              createdByPrincipal: 'system_line_liff_session',
            },
          });
        }

        const sid = crypto.randomUUID();
        const sessionIdHash = SessionTokenService.hashSessionId(sid);
        const ttlSeconds = env.SESSION_TTL_SECONDS || (30 * 24 * 60 * 60);
        const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
        const userAgent = req.headers['user-agent'] ? String(req.headers['user-agent']) : undefined;
        const userAgentHash = userAgent ? crypto.createHash('sha256').update(userAgent).digest('hex') : undefined;
        const ipMetadata = (req.headers['x-forwarded-for'] as string) || req.ip || undefined;

        await tx.session.create({
          data: {
            principalType: 'ACCESS_GRANT',
            accessGrantId: g.id,
            sessionIdHash,
            tokenVersion: 1,
            status: 'active',
            expiresAt,
            userAgentHash,
            ipMetadata,
          },
        });

        return { grant: g, sessionId: sid };
      });

      // 8. Issue session & CSRF cookies
      const ttlSeconds = env.SESSION_TTL_SECONDS || (30 * 24 * 60 * 60);
      const sessionToken = authService.getSessionTokenService().encryptToken(
        { sub: `ag_${grant.id}`, sid: sessionId, type: 'session', version: 1 },
        ttlSeconds
      );
      const csrfToken = authService.getCsrfService().generateCsrfToken(sessionId);

      res.cookie(env.SESSION_COOKIE_NAME, sessionToken, {
        httpOnly: true,
        secure: isProd,
        sameSite: sameSite,
        path: '/',
        maxAge: ttlSeconds * 1000,
      });

      res.cookie(env.CSRF_COOKIE_NAME, csrfToken, {
        httpOnly: false,
        secure: isProd,
        sameSite: sameSite,
        path: '/',
        maxAge: ttlSeconds * 1000,
      });

      res.cookie('active_dormitory_id', targetDormitoryId, {
        httpOnly: false,
        secure: isProd,
        sameSite: sameSite,
        path: '/',
        maxAge: ttlSeconds * 1000,
      });

      // 9. Self-healing / Sync Active Tenant Rich Menu in background
      try {
        const { LineRichMenuService } = await import('../services/line-richmenu.service.js');
        const richMenuService = new LineRichMenuService(prisma);
        richMenuService.linkActiveTenantRichMenu(targetDormitoryId, verifiedLineUserId).catch(() => {});
      } catch {}

      return res.status(200).json({
        success: true,
        data: {
          dormitoryId: targetDormitoryId,
          grantId: grant.id,
          lineUserId: verifiedLineUserId,
          displayName: verification.displayName,
        },
      });
    } catch (err: any) {
      next(err);
    }
  });

  router.use(notFoundMiddleware);

  return router;
}
