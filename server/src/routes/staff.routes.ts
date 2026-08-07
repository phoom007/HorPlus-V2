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

export function createStaffRoutes(prisma: PrismaClient) {
  const router = Router();
  const grantService = new AccessGrantService(prisma);
  const friendService = new LineFriendService(prisma);

  // --------------------------------------------------------------------------
  // Public Bearer Access Grant Redemption Endpoint
  // --------------------------------------------------------------------------

  /**
   * POST /api/v1/staff-access/redeem
   * Request body: { token: "<raw 256-bit bearer token>" }
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

      // Set HttpOnly session cookie
      res.cookie('horplus_session', result.rawSessionId, {
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
        data: result
      });
    } catch (err) {
      next(err);
    }
  });

  // --------------------------------------------------------------------------
  // OWNER-Only Staff & Access Grant Management Routes
  // --------------------------------------------------------------------------

  /**
   * GET /api/v1/dormitories/:dormId/staff
   * List staff members, active access grants, and slot usage
   */
  router.get(
    '/dormitories/:dormId/staff',
    requireDormitoryPermission('staff:manage'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dormId = req.params.dormId;
        const staff = await grantService.listDormitoryStaff(dormId);
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
   * GET /api/v1/dormitories/:dormId/line-friends
   * List LINE Friend Directory for selecting grant recipient
   */
  router.get(
    '/dormitories/:dormId/line-friends',
    requireDormitoryPermission('staff:manage'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dormId = req.params.dormId;
        const friends = await friendService.getFriendsByDormitory(dormId);
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
   * POST /api/v1/dormitories/:dormId/staff/access-grants
   * Create a revocable bearer Access Grant for a LINE friend
   * Body: { lineFriendId: string, roleCode: 'OWNER'|'MANAGER'|'TECH' }
   */
  router.post(
    '/dormitories/:dormId/staff/access-grants',
    requireDormitoryPermission('staff:manage'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dormId = req.params.dormId;
        const { lineFriendId, roleCode } = req.body;

        if (!lineFriendId || !roleCode) {
          throw new AppError('lineFriendId and roleCode are required', 400, 'INVALID_PAYLOAD');
        }

        const authUser = (req as any).auth?.user;
        const principalId = authUser ? `usr_${authUser.id}` : 'principal_owner';

        const result = await grantService.createAccessGrant(
          dormId,
          lineFriendId,
          roleCode,
          principalId
        );

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
   * PATCH /api/v1/dormitories/:dormId/staff/access-grants/:grantId
   * Change Role of an active Access Grant (Takes effect immediately)
   * Body: { roleCode: 'OWNER'|'MANAGER'|'TECH' }
   */
  router.patch(
    '/dormitories/:dormId/staff/access-grants/:grantId',
    requireDormitoryPermission('staff:manage'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { dormId, grantId } = req.params;
        const { roleCode } = req.body;

        if (!roleCode) {
          throw new AppError('roleCode is required', 400, 'INVALID_PAYLOAD');
        }

        const authUser = (req as any).auth?.user;
        const principalId = authUser ? `usr_${authUser.id}` : 'principal_owner';

        const updated = await grantService.changeGrantRole(
          dormId,
          grantId,
          roleCode,
          principalId
        );

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
   * DELETE /api/v1/dormitories/:dormId/staff/access-grants/:grantId
   * Revoke an Access Grant (Releases 1 slot immediately & revokes all active sessions)
   */
  router.delete(
    '/dormitories/:dormId/staff/access-grants/:grantId',
    requireDormitoryPermission('staff:manage'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { dormId, grantId } = req.params;
        const authUser = (req as any).auth?.user;
        const principalId = authUser ? `usr_${authUser.id}` : 'principal_owner';

        const revoked = await grantService.revokeAccessGrant(
          dormId,
          grantId,
          principalId
        );

        return res.status(200).json({
          success: true,
          data: revoked
        });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
