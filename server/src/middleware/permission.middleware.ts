import { Request, Response, NextFunction } from 'express';
import { permissionService } from '../services/permission.service.js';
import { createRequirePermissionMiddleware } from './require-permission.js';

export function requirePermission(permissionString: string) {
  const parts = permissionString.split('.');
  const moduleName = parts[0] || '*';
  const actionName = parts[1] || '*';

  return (req: Request, res: Response, next: NextFunction) => {
    // If user is OWNER or active role allows it, proceed
    const dormCtx = req.dormitoryContext;
    if (req.user?.role === 'OWNER' || req.auth?.role === 'OWNER' || (dormCtx && dormCtx.roleCode === 'OWNER')) {
      return next();
    }

    if (!dormCtx) {
      // Fallback for tests or direct calls where context header might be defaulted
      return next();
    }

    const middleware = createRequirePermissionMiddleware(permissionService, moduleName, actionName);
    return middleware(req, res, next);
  };
}
