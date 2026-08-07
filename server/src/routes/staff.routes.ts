/**
 * Staff & Access Grant Routes (Task-009 Checkpoint 1C)
 * Public: bearer redemption & CSRF credential issuance
 * Protected: staff management, grant CRUD, copy link, retry-delivery
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
import { AppError } from '../types/index.js';
import { getEnv } from '../config/env.js';

export function createStaffRoutes(
  prisma: PrismaClient,
  authService?: AuthenticationService,
  lineAdapter?: LinePlatformAdapter
) {
  const publicRouter = Router();
  const protectedRouter = Router();
  const grantService = new AccessGrantService(prisma, lineAdapter);
  const friendService = new LineFriendService(prisma);

  const requireSession = authService
    ? authService.requireAuth()
    : (_req: Request, _res: Response, next: NextFunction) => next();

  const authGuard = (permission: string) => [
    requireSession,
    requireDormitoryPermission(permission),
  ];

  const mutationGuard = (permission: string) => [
    requireSession,
    requireDormitoryPermission(permission),
    requireDormitoryWriteEntitlement,
  ];

  // ---------- CSRF helper ----------
  const verifyCsrf = (req: Request, res: Response): boolean => {
    if (!authService) return true;
    const env = getEnv();
    const csrfHeaderName = 'x-csrf-token';
    const csrfCookieName = env.CSRF_COOKIE_NAME || 'horplus_csrf';
    const csrfToken = (req.headers[csrfHeaderName] as string) || req.cookies?.[csrfCookieName];
    const sessionId = req.auth?.sessionId;
    if (!sessionId || !authService.verifyCsrf(csrfToken, sessionId)) {
      res.status(403).json({
        error: {
          code: 'CSRF_INVALID',
          message: 'CSRF Token ไม่ถูกต้องหรือหมดอายุแล้ว',
          fieldErrors: null,
          requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
          timestamp: new Date().toISOString(),
        },
      });
      return false;
    }
    return true;
  };

  // ---------- Dormitory context resolver & route mismatch validator ----------
  const getDormitoryId = (req: Request): string => {
    const context = (req as any).dormitoryContext || resolveAuthoritativeDormitoryContext(req);
    return context.dormitoryId;
  };

  const verifyDormitoryMatch = (req: Request, res: Response, next: NextFunction) => {
    const routeDormId = req.params.id || req.params.dormId || req.params.dormitoryId;
    const authDormId = getDormitoryId(req);
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
  };

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

      // Issue Session Cookie
      res.cookie(env.SESSION_COOKIE_NAME, result.sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });

      // Issue Canonical CSRF Cookie
      res.cookie(env.CSRF_COOKIE_NAME, result.csrfToken, {
        httpOnly: false,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');

      return res.status(200).json({
        success: true,
        data: {
          sessionToken: result.sessionToken,
          csrfToken: result.csrfToken,
          grant: result.grant,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  // ==========================================================================
  // PROTECTED STAFF MANAGEMENT API
  // ==========================================================================

  /**
   * GET /api/v1/properties/:id/staff
   */
  protectedRouter.get(
    '/properties/:id/staff',
    ...authGuard('staff:read'),
    verifyDormitoryMatch,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dormitoryId = getDormitoryId(req);
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
    verifyDormitoryMatch,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dormitoryId = getDormitoryId(req);
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
    verifyDormitoryMatch,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dormitoryId = getDormitoryId(req);
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
    verifyDormitoryMatch,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!verifyCsrf(req, res)) return;
        const dormitoryId = getDormitoryId(req);
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
    verifyDormitoryMatch,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!verifyCsrf(req, res)) return;
        const dormitoryId = getDormitoryId(req);
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
    verifyDormitoryMatch,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!verifyCsrf(req, res)) return;
        const dormitoryId = getDormitoryId(req);
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
    verifyDormitoryMatch,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!verifyCsrf(req, res)) return;
        const dormitoryId = getDormitoryId(req);
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
