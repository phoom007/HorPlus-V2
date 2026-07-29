import { Request, Response, NextFunction } from 'express';
import { PermissionService } from '../services/permission.service.js';
import { RoleEntity } from '../db/repositories/role.repository.js';

export function createRequirePermissionMiddleware(
  permissionService: PermissionService,
  moduleName: string,
  actionName: string
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const requestId = (req.headers['x-request-id'] as string) || 'req-unknown';
    const dormCtx = req.dormitoryContext;

    if (!dormCtx) {
      return res.status(400).json({
        error: {
          code: 'DORMITORY_HEADER_REQUIRED',
          message: 'กรุณาระบุบริบทหอพัก (X-Dormitory-Id) ก่อนตรวจสอบสิทธิ์',
          fieldErrors: null,
          requestId,
          timestamp: new Date().toISOString(),
        },
      });
    }

    const pseudoRole: RoleEntity = {
      id: 'active-context-role',
      code: dormCtx.roleCode,
      name: dormCtx.roleCode,
      permissions: dormCtx.permissions,
      isSystem: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const hasAccess = permissionService.hasPermission(pseudoRole, moduleName, actionName);

    if (!hasAccess) {
      return res.status(403).json({
        error: {
          code: 'PERMISSION_DENIED',
          message: `ไม่มีสิทธิ์ดำเนินการ (${moduleName}.${actionName})`,
          fieldErrors: null,
          requestId,
          timestamp: new Date().toISOString(),
        },
      });
    }

    next();
  };
}
