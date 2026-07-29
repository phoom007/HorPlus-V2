import { Router, Request, Response, NextFunction } from 'express';
import { staffRoleAssignmentService } from '../services/staff-role-assignment.service.js';
import { requirePermission } from '../middleware/permission.middleware.js';

export const staffRoleRouter = Router();

// GET /api/v1/line/followers
staffRoleRouter.get(
  '/line/followers',
  requirePermission('staff_access.view'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dormId = req.dormitoryId || 'dorm-001';
      const friendStatus = req.query.friendStatus as string;
      const search = req.query.search as string;

      const followers = await staffRoleAssignmentService.listFollowers(dormId, { friendStatus, search });
      res.json({ success: true, data: followers });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/staff-role-assignments
staffRoleRouter.get(
  '/staff-role-assignments',
  requirePermission('staff_access.view'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dormId = req.dormitoryId || 'dorm-001';
      const followers = await staffRoleAssignmentService.listFollowers(dormId);
      const assigned = followers.filter(f => f.roleCode !== null);
      res.json({ success: true, data: assigned });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/staff-role-assignments
staffRoleRouter.post(
  '/staff-role-assignments',
  requirePermission('staff_access.manage'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dormId = req.dormitoryId || 'dorm-001';
      const { followerId, roleCode, sendLineNotification } = req.body;

      if (!followerId || !roleCode) {
        res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'followerId and roleCode are required' } });
        return;
      }

      const assignedByUserId = req.user?.id || req.auth?.userId || 'user-001';
      const result = await staffRoleAssignmentService.assignRole({
        dormitoryId: dormId,
        followerId,
        roleCode,
        sendLineNotification: !!sendLineNotification,
        assignedByUserId
      });

      res.json({ success: true, data: result });
    } catch (err: any) {
      if (err.message?.startsWith('INVALID_ROLE_CODE')) {
        res.status(400).json({ success: false, error: { code: 'INVALID_ROLE', message: err.message } });
        return;
      }
      next(err);
    }
  }
);

// POST /api/v1/staff-role-assignments/:assignmentId/revoke
staffRoleRouter.post(
  '/staff-role-assignments/:assignmentId/revoke',
  requirePermission('staff_access.manage'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dormId = req.dormitoryId || 'dorm-001';
      const assignmentId = req.params.assignmentId;
      const revokedByUserId = req.user?.id || req.auth?.userId || 'user-001';
      const { reason } = req.body;

      const result = await staffRoleAssignmentService.revokeRole({
        dormitoryId: dormId,
        assignmentId,
        revokedByUserId,
        reason
      });

      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);
