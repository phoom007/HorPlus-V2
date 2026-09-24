/**
 * LINE OA Administration & Webhook Routes (Task-009 Checkpoint 1E)
 * Public: webhook ingestion (opaque key + signature verification)
 * Protected: OA config management (OWNER-only)
 * @license Apache-2.0
 */

import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { LineOaService, getPublicWebhookOrigin, validatePublicWebhookOrigin, setActiveAppOrigin } from '../services/line-oa.service.js';
import { AuthenticationService } from '../services/auth.service.js';
import { LinePlatformAdapter } from '../services/line-platform-adapter.js';
import { ILineChannelTokenProvider } from '../services/line-channel-token-provider.js';
import { requireDormitoryPermission } from '../middleware/permission.js';
import { requireDormitoryWriteEntitlement } from '../middleware/entitlement.js';
import { resolveAuthoritativeDormitoryContext } from '../middleware/dormitory-context.js';
import { createCsrfMiddleware } from '../middleware/csrf.js';
import { createLineWebhookRateLimiter } from '../middleware/rate-limiter.js';

export function resolveWebhookBaseUrl(req: Request): string {
  const host = req.get('x-forwarded-host') || req.get('host');
  if (host && (host.includes('.trycloudflare.com') || host.includes('ngrok') || (!host.includes('localhost') && !host.includes('127.0.0.1')))) {
    let proto = req.get('x-forwarded-proto') === 'https' || req.protocol === 'https' ? 'https' : 'http';
    if (host.includes('.trycloudflare.com') || host.includes('ngrok')) {
      proto = 'https';
    }
    const candidate = `${proto}://${host}`;
    const validated = validatePublicWebhookOrigin(candidate);
    if (validated.isConfigured && validated.origin) {
      return validated.origin;
    }
  }
  return getPublicWebhookOrigin();
}

export function createLineOaRoutes(
  prisma: PrismaClient,
  authService: AuthenticationService,
  lineAdapter?: LinePlatformAdapter,
  tokenProvider?: ILineChannelTokenProvider
) {
  if (!authService) {
    throw new Error('AuthenticationService is required for protected LINE OA routes construction');
  }

  const publicRouter = Router();
  const protectedRouter = Router();
  const lineOaService = new LineOaService(prisma, lineAdapter, tokenProvider);

  const requireSession = authService.requireAuth();
  const csrfMiddleware = createCsrfMiddleware(authService);
  const webhookRateLimiter = createLineWebhookRateLimiter();

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

  const requireOwnerOrManagerRole = (req: Request, res: Response, next: NextFunction) => {
    const context = (req as any).dormitoryContext || (req.auth as any);
    const roleCode = (context?.roleCode || context?.role || context?.memberships?.[0]?.roleCode || '').toUpperCase();
    if (roleCode !== 'OWNER' && roleCode !== 'MANAGER') {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'การจัดการ LINE OA อนุญาตเฉพาะเจ้าของหรือผู้จัดการหอพักเท่านั้น (OWNER or MANAGER role required)',
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

  const authGuard = (permission: string) => [
    requireSession,
    resolveDormContext,
    requireDormitoryPermission(permission),
    verifyDormitoryMatch,
    requireOwnerOrManagerRole,
  ];

  const mutationGuard = (permission: string) => [
    requireSession,
    resolveDormContext,
    requireDormitoryPermission(permission),
    requireDormitoryWriteEntitlement,
    csrfMiddleware,
    verifyDormitoryMatch,
    requireOwnerOrManagerRole,
  ];

  // ==========================================================================
  // PUBLIC WEBHOOK (no session required — opaque key + HMAC signature)
  // ==========================================================================

  publicRouter.post(
    '/line/webhook/:opaqueWebhookKey',
    webhookRateLimiter,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const opaqueKey = req.params.opaqueWebhookKey;
        const signatureHeader = req.headers['x-line-signature'] as string;

        const bodyBuffer = Buffer.isBuffer(req.body)
          ? req.body
          : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}));

        const detectedOrigin = resolveWebhookBaseUrl(req);

        const result = await lineOaService.processWebhookEvent(
          opaqueKey, bodyBuffer, signatureHeader, detectedOrigin
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
        const dormId = await getDormitoryId(req);
        const baseUrl = resolveWebhookBaseUrl(req);
        setActiveAppOrigin(baseUrl);
        const forceRefresh = req.query.refresh === 'true' || req.query.force === 'true';
        const config = await lineOaService.getDormitoryLineConfig(dormId, baseUrl, { forceRefresh });
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
        const dormId = await getDormitoryId(req);
        const baseUrl = resolveWebhookBaseUrl(req);
        const updated = await lineOaService.updateDormitoryLineConfig(
          dormId,
          { channelId: req.body.channelId, channelSecret: req.body.channelSecret },
          baseUrl
        );
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
        const dormId = await getDormitoryId(req);
        const baseUrl = resolveWebhookBaseUrl(req);
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
    ['/dormitories/:dormId/line-oa/webhook/test', '/dormitories/:dormId/line-oa/test-webhook'],
    ...mutationGuard('line_oa:manage'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dormId = await getDormitoryId(req);
        const baseUrl = resolveWebhookBaseUrl(req);
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
        const dormId = await getDormitoryId(req);
        const baseUrl = resolveWebhookBaseUrl(req);
        const disconnected = await lineOaService.disconnectLineConfig(dormId, baseUrl);
        return res.status(200).json({ success: true, data: disconnected, config: disconnected });
      } catch (err) {
        next(err);
      }
    }
  );

  protectedRouter.patch(
    ['/dormitories/:dormId/line-oa/preferences', '/dormitories/:dormId/line-oa/config/preferences'],
    ...mutationGuard('line_oa:manage'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dormId = await getDormitoryId(req);
        const baseUrl = resolveWebhookBaseUrl(req);
        const updated = await lineOaService.updatePreferences(dormId, {
          notifyRepairRequest: req.body.notifyRepairRequest,
          notifyRepairCompleted: req.body.notifyRepairCompleted,
          notifyPaymentReceived: req.body.notifyPaymentReceived,
          notifyTenantRegister: req.body.notifyTenantRegister,
          notifyTenantApproved: req.body.notifyTenantApproved,
        }, baseUrl);
        return res.status(200).json({ success: true, data: updated, preferences: updated });
      } catch (err) {
        next(err);
      }
    }
  );

  protectedRouter.post(
    ['/dormitories/:dormId/line-oa/rich-menu/sync', '/dormitories/:dormId/line-oa/config/rich-menu/sync'],
    ...mutationGuard('line_oa:manage'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dormId = await getDormitoryId(req);
        const baseUrl = resolveWebhookBaseUrl(req);
        setActiveAppOrigin(baseUrl);
        const force = Boolean(req.body?.force || req.query?.force === 'true');
        const result = await lineOaService.syncRichMenus(dormId, baseUrl, force);
        return res.status(200).json({ success: true, data: result });
      } catch (err) {
        next(err);
      }
    }
  );

  return { publicRouter, protectedRouter };
}
