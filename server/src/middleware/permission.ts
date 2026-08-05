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
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      let context = (req as any).dormitoryContext;
      if (!context) {
        try {
          context = resolveAuthoritativeDormitoryContext(req);
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

      // Domain wildcard (e.g. "room:*" covers "room:write")
      const colonIdx = requiredPermission.indexOf(':');
      if (colonIdx > 0) {
        const domain = requiredPermission.substring(0, colonIdx);
        if (normalizedPerms.includes(`${domain}:*`)) {
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
export function resolveDormitoryContextMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    const context = resolveAuthoritativeDormitoryContext(req);
    (req as any).dormitoryContext = context;
    next();
  } catch (err) {
    next(err);
  }
}
