/**
 * Staff Administration Routes (Task-009 Checkpoint 1B)
 * Public: bearer token redemption
 * Protected: staff listing, friend listing, access grant creation/role change/revocation/retry
 * @license Apache-2.0
 */

import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { AccessGrantService } from '../services/access-grant.service.js';
import { LineFriendService } from '../services/line-friend.service.js';
import { AuthenticationService } from '../services/auth.service.js';
import { LinePlatformAdapter } from '../services/line-platform-adapter.js';
import { requireDormitoryPermission } from '../middleware/permission.js';
import { requireDormitoryWriteEntitlement } from '../middleware/entitlement.js';
import { resolveAuthoritativeDormitoryContext } from '../middleware/dormitory-context.js';
import { createRequireActiveDormitoryMiddleware } from '../middleware/require-dormitory.js';
import { createCsrfMiddleware } from '../middleware/csrf.js';
import { AppError } from '../types/index.js';
import { getEnv } from '../config/env.js';

export function createStaffRoutes(
  prisma: PrismaClient,
  authService: AuthenticationService,
  lineAdapter?: LinePlatformAdapter
) {
  if (!authService) {
    throw new Error('AuthenticationService is required for protected staff routes construction');
  }

  const publicRouter = Router();
  const protectedRouter = Router();
  const grantService = new AccessGrantService(prisma, lineAdapter);
  const friendService = new LineFriendService(prisma);

  const requireSession = authService.requireAuth();
  const csrfMiddleware = createCsrfMiddleware(authService);

  const getDormitoryId = async (req: Request): Promise<string> => {
    const context = (req as any).dormitoryContext || (await resolveAuthoritativeDormitoryContext(req));
    return context.dormitoryId;
  };

  const verifyDormitoryMatch = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const routeDormId = req.params.id || req.params.dormId || req.params.dormitoryId;
      const authDormId = await getDormitoryId(req);
      if (routeDormId && authDormId && routeDormId !== authDormId) {
        return res.status(403).json({
          error: {
            code: 'DORMITORY_MISMATCH',
            message: 'Target dormitory ID does not match authenticated dormitory context',
            fieldErrors: null,
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }
      next();
    } catch (err) {
      next(err);
    }
  };

  const requireOwnerRole = (req: Request, res: Response, next: NextFunction) => {
    const context = (req as any).dormitoryContext || (req.auth as any);
    const roleCode = context?.roleCode || context?.role || context?.memberships?.[0]?.roleCode;
    if (roleCode !== 'OWNER') {
      console.error('[REQUIRE OWNER ROLE ERROR]', { path: req.originalUrl, roleCode, contextRole: context?.roleCode, authRole: (req as any).auth?.role });
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'การจัดการพนักงานและ LINE OA อนุญาตเฉพาะเจ้าของหอพักเท่านั้น (OWNER role required)',
          fieldErrors: null,
          requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
          timestamp: new Date().toISOString(),
        },
      });
    }
    next();
  };

  const resolveDormContext = async (req: Request, _res: Response, next: NextFunction) => {
    try {
      await resolveAuthoritativeDormitoryContext(req);
      next();
    } catch (err) {
      next(err);
    }
  };

  const requireActiveDormitory = createRequireActiveDormitoryMiddleware(prisma);

  const authGuard = (permission: string) => [
    requireSession,
    resolveDormContext,
    requireActiveDormitory,
    requireDormitoryPermission(permission),
    verifyDormitoryMatch,
    requireOwnerRole,
  ];

  const mutationGuard = (permission: string) => [
    requireSession,
    resolveDormContext,
    requireActiveDormitory,
    requireDormitoryPermission(permission),
    requireDormitoryWriteEntitlement,
    csrfMiddleware,
    verifyDormitoryMatch,
    requireOwnerRole,
  ];

  // ==========================================================================
  // PUBLIC BEARER REDEMPTION (no session required)
  // ==========================================================================

  /**
   * POST /api/v1/staff-access/redeem
   * Request body: { token: "<raw 256-bit bearer token>" }
   */
  publicRouter.post('/staff-access/redeem', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { token } = req.body;
      if (!token) {
        throw new AppError('Bearer access token is required', 400, 'MISSING_BEARER_TOKEN');
      }

      const userAgentHash = req.headers['user-agent'] ? String(req.headers['user-agent']) : undefined;
      const ipMetadata = req.ip || undefined;

      const result = await grantService.redeemAccessGrant(token, userAgentHash, ipMetadata);
      const env = getEnv();

      // Issue Session Cookie as HttpOnly
      res.cookie(env.SESSION_COOKIE_NAME, result.sessionToken, {
        httpOnly: true,
        secure: env.COOKIE_SECURE ?? (process.env.NODE_ENV === 'production'),
        sameSite: env.COOKIE_SAME_SITE || 'lax',
        path: '/',
        maxAge: env.SESSION_TTL_SECONDS * 1000,
      });

      // Issue Canonical CSRF Cookie
      res.cookie(env.CSRF_COOKIE_NAME, result.csrfToken, {
        httpOnly: false,
        secure: env.COOKIE_SECURE ?? (process.env.NODE_ENV === 'production'),
        sameSite: env.COOKIE_SAME_SITE || 'lax',
        path: '/',
        maxAge: env.SESSION_TTL_SECONDS * 1000,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');

      // Return ONLY safe grant display profile & csrfToken (NO sessionToken or rawSessionId in JSON)
      return res.status(200).json({
        success: true,
        data: {
          grant: result.grant,
          csrfToken: result.csrfToken,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  // ==========================================================================
  // PROTECTED STAFF MANAGEMENT API (OWNER-only)
  // ==========================================================================

  /**
   * GET /api/v1/properties/:id/staff
   */
  protectedRouter.get(
    '/properties/:id/staff',
    ...authGuard('staff:read'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dormitoryId = await getDormitoryId(req);
        const staff = await grantService.listDormitoryStaff(dormitoryId);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, data: staff });
      } catch (err) {
        next(err);
      }
    }
  );

  /**
   * GET /api/v1/properties/:id/line-friends
   */
  protectedRouter.get(
    '/properties/:id/line-friends',
    ...authGuard('staff:read'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dormitoryId = await getDormitoryId(req);
        const friends = await friendService.getFriendsByDormitory(dormitoryId);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, data: friends });
      } catch (err) {
        next(err);
      }
    }
  );

  /**
   * GET /api/v1/properties/:id/access-grants/:grantId/copy-link
   */
  protectedRouter.get(
    '/properties/:id/access-grants/:grantId/copy-link',
    ...authGuard('staff:read'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dormitoryId = await getDormitoryId(req);
        const { grantId } = req.params;
        const copyLink = await grantService.getGrantCopyLink(dormitoryId, grantId);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, data: copyLink });
      } catch (err) {
        next(err);
      }
    }
  );

  /**
   * POST /api/v1/properties/:id/access-grants
   */
  protectedRouter.post(
    '/properties/:id/access-grants',
    ...mutationGuard('staff:write'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dormitoryId = await getDormitoryId(req);
        const { lineFriendId, roleCode } = req.body;

        if (!lineFriendId || !roleCode) {
          throw new AppError('lineFriendId and roleCode are required', 400, 'MISSING_FIELDS');
        }

        const createdByPrincipal = req.auth ? `usr_${req.auth.userId}` : 'usr_owner';

        const result = await grantService.createAccessGrant(
          dormitoryId, lineFriendId, roleCode, createdByPrincipal
        );

        res.setHeader('Cache-Control', 'no-store');
        return res.status(201).json({ success: true, data: result });
      } catch (err) {
        next(err);
      }
    }
  );

  /**
   * PATCH /api/v1/properties/:id/access-grants/:grantId/role
   */
  protectedRouter.patch(
    '/properties/:id/access-grants/:grantId/role',
    ...mutationGuard('staff:write'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dormitoryId = await getDormitoryId(req);
        const { grantId } = req.params;
        const { roleCode } = req.body;

        if (!roleCode) {
          throw new AppError('roleCode is required', 400, 'MISSING_ROLE_CODE');
        }

        const updatedByPrincipal = req.auth ? `usr_${req.auth.userId}` : 'usr_owner';

        const updated = await grantService.changeGrantRole(
          dormitoryId, grantId, roleCode, updatedByPrincipal
        );

        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, data: updated });
      } catch (err) {
        next(err);
      }
    }
  );

  /**
   * DELETE /api/v1/properties/:id/access-grants/:grantId
   */
  protectedRouter.delete(
    '/properties/:id/access-grants/:grantId',
    ...mutationGuard('staff:write'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dormitoryId = await getDormitoryId(req);
        const { grantId } = req.params;
        const revokedByPrincipal = req.auth ? `usr_${req.auth.userId}` : 'usr_owner';

        const revoked = await grantService.revokeAccessGrant(
          dormitoryId, grantId, revokedByPrincipal
        );

        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({
          success: true,
          data: { revoked: true, grantId: revoked.id }
        });
      } catch (err) {
        next(err);
      }
    }
  );

  /**
   * POST /api/v1/properties/:id/access-grants/:grantId/retry-delivery
   */
  protectedRouter.post(
    '/properties/:id/access-grants/:grantId/retry-delivery',
    ...mutationGuard('staff:write'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dormitoryId = await getDormitoryId(req);
        const { grantId } = req.params;

        const result = await grantService.retryDelivery(grantId, dormitoryId);

        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({
          success: true,
          data: result
        });
      } catch (err) {
        next(err);
      }
    }
  );

  return { publicRouter, protectedRouter };
}
