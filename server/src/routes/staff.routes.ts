/**
 * Staff & Access Grant Routes (Task-009 Final Product Model)
 * @license Apache-2.0
 */

import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { AccessGrantService } from '../services/access-grant.service.js';
import { LineFriendService } from '../services/line-friend.service.js';
import { requireDormitoryPermission } from '../middleware/permission.js';
import { AppError } from '../types/index.js';
import { getEnv } from '../config/env.js';

export function createStaffRoutes(prisma: PrismaClient): Router {
  const router = Router();
  const grantService = new AccessGrantService(prisma);
  const friendService = new LineFriendService(prisma);

  // --------------------------------------------------------------------------
  // PUBLIC BEARER REDEMPTION
  // --------------------------------------------------------------------------

  /**
   * POST /api/v1/staff-access/redeem
   * Request body: { token: "<raw 256-bit bearer token>" }
   * Places canonical encrypted session token in HttpOnly SESSION_COOKIE_NAME
   */
  router.post('/staff-access/redeem', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { token } = req.body;
      if (!token) {
        throw new AppError('Bearer access token is required', 400, 'MISSING_TOKEN');
      }

      const userAgentHash = req.headers['user-agent'] ? String(req.headers['user-agent']) : undefined;
      const ipMetadata = req.ip || undefined;

      const result = await grantService.redeemAccessGrant(token, userAgentHash, ipMetadata);
      const env = getEnv();

      // Set canonical HttpOnly session cookie
      res.cookie(env.SESSION_COOKIE_NAME, result.sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
      });

      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');

      return res.status(200).json({
        success: true,
        data: {
          grant: result.grant
        }
      });
    } catch (err) {
      next(err);
    }
  });

  // --------------------------------------------------------------------------
  // AUTHENTICATED OWNER STAFF MANAGEMENT API
  // --------------------------------------------------------------------------

  /**
   * GET /api/v1/properties/:id/staff
   * List staff members, permanent Google owners, active grants, and slot meter
   */
  router.get(
    '/properties/:id/staff',
    requireDormitoryPermission('staff:read'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dormitoryId = req.params.id;
        const staff = await grantService.listDormitoryStaff(dormitoryId);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({
          success: true,
          data: staff
        });
      } catch (err) {
        next(err);
      }
    }
  );

  /**
   * GET /api/v1/properties/:id/line-friends
   * List sanitized LINE friend directory for dormitory (NO identity hashes/encrypted blobs)
   */
  router.get(
    '/properties/:id/line-friends',
    requireDormitoryPermission('staff:read'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dormitoryId = req.params.id;
        const friends = await friendService.getFriendsByDormitory(dormitoryId);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({
          success: true,
          data: friends
        });
      } catch (err) {
        next(err);
      }
    }
  );

  /**
   * POST /api/v1/properties/:id/access-grants
   * Issue new Access Grant link to a LINE Friend
   */
  router.post(
    '/properties/:id/access-grants',
    requireDormitoryPermission('staff:write'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dormitoryId = req.params.id;
        const { lineFriendId, roleCode } = req.body;

        if (!lineFriendId || !roleCode) {
          throw new AppError('lineFriendId and roleCode are required', 400, 'MISSING_FIELDS');
        }

        const createdByPrincipal = req.user ? `usr_${req.user.id}` : 'usr_owner';

        const result = await grantService.createAccessGrant(
          dormitoryId,
          lineFriendId,
          roleCode,
          createdByPrincipal
        );

        res.setHeader('Cache-Control', 'no-store');
        return res.status(201).json({
          success: true,
          data: result
        });
      } catch (err) {
        next(err);
      }
    }
  );

  /**
   * PATCH /api/v1/properties/:id/access-grants/:grantId/role
   * Change Role of an active Access Grant
   */
  router.patch(
    '/properties/:id/access-grants/:grantId/role',
    requireDormitoryPermission('staff:write'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id: dormitoryId, grantId } = req.params;
        const { roleCode } = req.body;

        if (!roleCode) {
          throw new AppError('roleCode is required', 400, 'MISSING_ROLE_CODE');
        }

        const updatedByPrincipal = req.user ? `usr_${req.user.id}` : 'usr_owner';

        const updated = await grantService.changeGrantRole(
          dormitoryId,
          grantId,
          roleCode,
          updatedByPrincipal
        );

        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({
          success: true,
          data: updated
        });
      } catch (err) {
        next(err);
      }
    }
  );

  /**
   * DELETE /api/v1/properties/:id/access-grants/:grantId
   * Revoke Access Grant immediately
   */
  router.delete(
    '/properties/:id/access-grants/:grantId',
    requireDormitoryPermission('staff:write'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id: dormitoryId, grantId } = req.params;
        const revokedByPrincipal = req.user ? `usr_${req.user.id}` : 'usr_owner';

        const revoked = await grantService.revokeAccessGrant(
          dormitoryId,
          grantId,
          revokedByPrincipal
        );

        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({
          success: true,
          data: {
            revoked: true,
            grantId: revoked.id
          }
        });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
