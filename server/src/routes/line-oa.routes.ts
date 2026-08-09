/**
 * LINE OA Administration & Webhook Routes (Task-009 Checkpoint 1E)
 * Public: webhook ingestion (opaque key + signature verification)
 * Protected: OA config management (OWNER-only)
 * @license Apache-2.0
 */

import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { LineOaService } from '../services/line-oa.service.js';
import { AuthenticationService } from '../services/auth.service.js';
import { LinePlatformAdapter } from '../services/line-platform-adapter.js';
import { requireDormitoryPermission } from '../middleware/permission.js';
import { requireDormitoryWriteEntitlement } from '../middleware/entitlement.js';
import { resolveAuthoritativeDormitoryContext } from '../middleware/dormitory-context.js';
import { createCsrfMiddleware } from '../middleware/csrf.js';

export function createLineOaRoutes(
  prisma: PrismaClient,
  authService: AuthenticationService,
  lineAdapter?: LinePlatformAdapter
) {
  if (!authService) {
    throw new Error('AuthenticationService is required for protected LINE OA routes construction');
  }

  const publicRouter = Router();
  const protectedRouter = Router();
  const lineOaService = new LineOaService(prisma, lineAdapter);

  const requireSession = authService.requireAuth();
  const csrfMiddleware = createCsrfMiddleware(authService);

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

  const requireOwnerRole = (req: Request, res: Response, next: NextFunction) => {
    const context = (req as any).dormitoryContext || (req.auth as any);
    const roleCode = context?.roleCode || context?.role || context?.memberships?.[0]?.roleCode;
    if (roleCode !== 'OWNER') {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'การจัดการ LINE OA อนุญาตเฉพาะเจ้าของหอพักเท่านั้น (OWNER role required)',
          fieldErrors: null,
          requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
          timestamp: new Date().toISOString(),
        },
      });
    }
    next();
  };

  const resolveDormContext = (req: Request, _res: Response, next: NextFunction) => {
    try {
      resolveAuthoritativeDormitoryContext(req);
      next();
    } catch (err) {
      next(err);
    }
  };

  const authGuard = (permission: string) => [
    requireSession,
    resolveDormContext,
    requireDormitoryPermission(permission),
    verifyDormitoryMatch,
    requireOwnerRole,
  ];

  const mutationGuard = (permission: string) => [
    requireSession,
    resolveDormContext,
    requireDormitoryPermission(permission),
    requireDormitoryWriteEntitlement,
    csrfMiddleware,
    verifyDormitoryMatch,
    requireOwnerRole,
  ];

  // ==========================================================================
  // PUBLIC WEBHOOK (no session required — opaque key + HMAC signature)
  // ==========================================================================

  publicRouter.post(
    '/line/webhook/:opaqueWebhookKey',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const opaqueKey = req.params.opaqueWebhookKey;
        const signatureHeader = req.headers['x-line-signature'] as string;

        const bodyBuffer = Buffer.isBuffer(req.body)
          ? req.body
          : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}));

        const result = await lineOaService.processWebhookEvent(
          opaqueKey, bodyBuffer, signatureHeader
        );

        return res.status(200).json(result);
      } catch (err) {
        next(err);
      }
    }
  );

  // ==========================================================================
  // PROTECTED LINE OA CONFIG (OWNER-only)
  // ==========================================================================

  protectedRouter.get(
    ['/dormitories/:dormId/line-oa', '/dormitories/:dormId/line-oa/config'],
    ...authGuard('line_oa:manage'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dormId = getDormitoryId(req);
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const config = await lineOaService.getDormitoryLineConfig(dormId, baseUrl);
        return res.status(200).json({ success: true, data: config, config });
      } catch (err) {
        next(err);
      }
    }
  );

  protectedRouter.put(
    ['/dormitories/:dormId/line-oa', '/dormitories/:dormId/line-oa/config'],
    ...mutationGuard('line_oa:manage'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dormId = getDormitoryId(req);
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const updated = await lineOaService.updateDormitoryLineConfig(dormId, req.body, baseUrl);
        return res.status(200).json({ success: true, data: updated, config: updated });
      } catch (err) {
        next(err);
      }
    }
  );

  protectedRouter.post(
    ['/dormitories/:dormId/line-oa/webhook/endpoint', '/dormitories/:dormId/line-oa/rotate-webhook'],
    ...mutationGuard('line_oa:manage'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dormId = getDormitoryId(req);
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const updated = req.path.includes('rotate')
          ? await lineOaService.rotateWebhookKey(dormId, baseUrl)
          : await lineOaService.setWebhookEndpoint(dormId, baseUrl);
        return res.status(200).json({ success: true, data: updated, config: updated });
      } catch (err) {
        next(err);
      }
    }
  );

  protectedRouter.post(
    '/dormitories/:dormId/line-oa/webhook/test',
    ...mutationGuard('line_oa:manage'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dormId = getDormitoryId(req);
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const updated = await lineOaService.testWebhookEndpoint(dormId, baseUrl);
        return res.status(200).json({ success: true, data: updated, config: updated });
      } catch (err) {
        next(err);
      }
    }
  );

  protectedRouter.delete(
    '/dormitories/:dormId/line-oa/disconnect',
    ...mutationGuard('line_oa:manage'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dormId = getDormitoryId(req);
        const disconnected = await lineOaService.disconnectLineConfig(dormId);
        return res.status(200).json({ success: true, data: disconnected, config: disconnected });
      } catch (err) {
        next(err);
      }
    }
  );

  return { publicRouter, protectedRouter };
}
