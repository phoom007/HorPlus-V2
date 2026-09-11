import { Request, Response, NextFunction } from 'express';
import { resolveAuthoritativeDormitoryContext } from './dormitory-context.js';

/**
 * Middleware factory that enforces domain-level mutation permission.
 * Must be mounted AFTER authentication (req.auth populated) and
 * BEFORE entitlement/CSRF checks.
 *
 * Middleware ordering for protected mutations:
 *   requireSession → resolveDormitoryContextMiddleware → requireDormitoryPermission(perm)
 *   → requireDormitoryWriteEntitlement → verifyCsrf → handler
 */
export function requireDormitoryPermission(requiredPermission: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      let context = (req as any).dormitoryContext;
      if (!context) {
        try {
          context = await resolveAuthoritativeDormitoryContext(req);
          (req as any).dormitoryContext = context;
        } catch {
          return res.status(403).json({
            error: {
              code: 'FORBIDDEN',
              message: 'Dormitory context not resolved.',
              requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
              timestamp: new Date().toISOString(),
            },
          });
        }
      }

      const { roleCode, permissions } = context;

      // OWNER role code grants implicit full access
      if (roleCode === 'OWNER') {
        return next();
      }

      // Check normalized permissions
      const normalizedPerms: string[] = permissions || [];

      // Global wildcard
      if (normalizedPerms.includes('*')) {
        return next();
      }

      // Exact permission match
      if (normalizedPerms.includes(requiredPermission)) {
        return next();
      }

      // Check view <-> read aliases
      if (['tenants:view', 'tenant:view'].includes(requiredPermission)) {
        if (normalizedPerms.includes('tenant:read') || normalizedPerms.includes('tenants:read')) {
          return next();
        }
      }

      // Check legacy write alias for create, update, archive, and document:write
      if (
        ['tenants:create', 'tenants:update', 'tenants:archive', 'tenant:create', 'tenant:update', 'tenant:archive', 'tenants:document:write', 'tenant:document:write'].includes(requiredPermission)
      ) {
        if (normalizedPerms.includes('tenant:write') || normalizedPerms.includes('tenants:write')) {
          return next();
        }
      }

      // Check singular/plural aliases (e.g. tenant:document:read vs tenants:document:read)
      const altPermission = requiredPermission.startsWith('tenant:')
        ? requiredPermission.replace('tenant:', 'tenants:')
        : requiredPermission.startsWith('tenants:')
        ? requiredPermission.replace('tenants:', 'tenant:')
        : null;

      if (altPermission && normalizedPerms.includes(altPermission)) {
        return next();
      }

      // Domain wildcard (e.g. "room:*" covers "room:write")
      const colonIdx = requiredPermission.indexOf(':');
      if (colonIdx > 0) {
        const domain = requiredPermission.substring(0, colonIdx);
        if (normalizedPerms.includes(`${domain}:*`)) {
          return next();
        }
      }

      if (altPermission) {
        const altColonIdx = altPermission.indexOf(':');
        const altDomain = altPermission.substring(0, altColonIdx);
        if (normalizedPerms.includes(`${altDomain}:*`)) {
          return next();
        }
      }

      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Insufficient dormitory permission.',
          requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Express middleware that resolves dormitory context and stores it on req.
 * Must run after authentication populates req.auth.
 */
export async function resolveDormitoryContextMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    const context = await resolveAuthoritativeDormitoryContext(req);
    (req as any).dormitoryContext = context;
    next();
  } catch (err: any) {
    console.error('[RESOLVE DORM CONTEXT ERROR]', { path: req.originalUrl, code: err.code, message: err.message });
    next(err);
  }
}
