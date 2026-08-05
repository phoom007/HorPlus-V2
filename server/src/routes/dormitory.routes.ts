import { Router, Request, Response } from 'express';
import { getPrismaClient } from '../db/prisma.js';
import { AuthenticationService } from '../services/auth.service.js';
import { IDormitoryRepository } from '../db/repositories/dormitory.repository.js';
import { IBillingSettingsRepository } from '../db/repositories/billing-settings.repository.js';
import { ISubscriptionRepository } from '../db/repositories/subscription.repository.js';
import { IPlanRepository } from '../db/repositories/plan.repository.js';
import { SensitiveFieldService } from '../services/sensitive-field.service.js';
import { createRequireSessionMiddleware } from '../middleware/require-session.js';
import { createRequireDormitoryContextMiddleware } from '../middleware/require-dormitory.js';
import { createRequirePermissionMiddleware } from '../middleware/require-permission.js';
import { requireDormitoryWriteEntitlement } from '../middleware/entitlement.js';
import { permissionService } from '../services/permission.service.js';
import {
  UpdateDormitoryInputSchema,
  OnboardingBillingInputSchema,
  OnboardingPaymentInputSchema,
} from '../types/onboarding-validation.js';

export function createDormitoryRouter(
  authService: AuthenticationService,
  dormitoryRepo: IDormitoryRepository,
  billingRepo: IBillingSettingsRepository,
  subRepo: ISubscriptionRepository,
  planRepo: IPlanRepository,
  sensitiveFieldService: SensitiveFieldService,
  membershipRepo: any,
  roleRepo: any
): Router {
  const router = Router();
  const requireSession = createRequireSessionMiddleware(authService);
  const requireDormitory = createRequireDormitoryContextMiddleware(membershipRepo, roleRepo);

  const requireDormitoryView = createRequirePermissionMiddleware(permissionService, 'dormitory', 'view');
  const requireDormitoryUpdate = createRequirePermissionMiddleware(permissionService, 'dormitory', 'update');
  const requireBillingView = createRequirePermissionMiddleware(permissionService, 'billing_settings', 'view');
  const requireBillingUpdate = createRequirePermissionMiddleware(permissionService, 'billing_settings', 'update');
  const requirePaymentView = createRequirePermissionMiddleware(permissionService, 'payment_settings', 'view');
  const requirePaymentUpdate = createRequirePermissionMiddleware(permissionService, 'payment_settings', 'update');
  const requireSubscriptionView = createRequirePermissionMiddleware(permissionService, 'subscription', 'view');

  const verifyCsrfToken = (req: Request, res: Response): boolean => {
    const csrfToken = (req.headers['x-csrf-token'] as string) || req.cookies?.['horplus_csrf'];
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

  // GET /api/v1/dormitories - List current user's active memberships' dormitories
  router.get('/', requireSession, async (req: Request, res: Response) => {
    const userId = req.auth!.userId;
    const userMemberships = await membershipRepo.findByUserId(userId);
    const activeMemberships = userMemberships.filter((m: any) => m.status === 'active');

    const dormList = [];
    const seenDormIds = new Set<string>();

    for (const mem of activeMemberships) {
      const dorm = await dormitoryRepo.findById(mem.dormitoryId);
      if (dorm && dorm.status === 'active') {
        seenDormIds.add(dorm.id);
        dormList.push({
          id: dorm.id,
          name: dorm.name,
          code: dorm.code,
          type: dorm.type,
          roleCode: mem.roleCode || 'OWNER',
          status: dorm.status,
          createdAt: dorm.createdAt,
        });
      }
    }

    // WAVE0_LEGACY_COMPAT: Include dormitories where user is the legacy creator
    try {
      const prisma = getPrismaClient();
      if (prisma?.dormitory) {
        const legacyDorms = await prisma.dormitory.findMany({
          where: {
            createdByUserId: userId,
            status: 'active',
            id: { notIn: Array.from(seenDormIds) }
          },
          select: { id: true, name: true, code: true, type: true, status: true, createdAt: true }
        });
        for (const dorm of legacyDorms) {
          console.warn(`WAVE0_LEGACY_COMPAT: Dormitory ${dorm.id} accessible via createdByUserId fallback for user ${userId}. Membership backfill required.`);
          dormList.push({
            id: dorm.id,
            name: dorm.name,
            code: dorm.code,
            type: dorm.type,
            roleCode: 'OWNER',
            status: dorm.status,
            createdAt: dorm.createdAt,
            _legacyCreatorFallback: true,
          });
        }
      }
    } catch (_legacyErr) {
    }

    res.json({ data: dormList });
  });

  // GET /api/v1/dormitories/:dormitoryId - Detail
  router.get('/:dormitoryId', requireSession, requireDormitory, requireDormitoryView, async (req: Request, res: Response) => {
    const dormitoryId = req.params.dormitoryId;
    const dorm = await dormitoryRepo.findById(dormitoryId);
    if (!dorm) {
      return res.status(404).json({
        error: {
          code: 'RESOURCE_NOT_FOUND',
          message: 'ไม่พบข้อมูลหอพักที่ต้องการ',
          fieldErrors: null,
          requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
          timestamp: new Date().toISOString(),
        },
      });
    }

    res.json({ data: dorm });
  });

  // PATCH /api/v1/dormitories/:dormitoryId - Update
  router.patch('/:dormitoryId', requireSession, requireDormitory, requireDormitoryUpdate, requireDormitoryWriteEntitlement, async (req: Request, res: Response) => {
    if (!verifyCsrfToken(req, res)) return;

    const parsed = UpdateDormitoryInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'ข้อมูลการแก้ไขหอพักไม่ถูกต้อง',
          fieldErrors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
          requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
          timestamp: new Date().toISOString(),
        },
      });
    }

    const dormitoryId = req.params.dormitoryId;
    const updated = await dormitoryRepo.update(dormitoryId, parsed.data);

    res.json({ data: updated });
  });

  // GET /api/v1/dormitories/:dormitoryId/billing-settings
  router.get('/:dormitoryId/billing-settings', requireSession, requireDormitory, requireBillingView, async (req: Request, res: Response) => {
    const dormitoryId = req.params.dormitoryId;
    const settings = await billingRepo.findByDormitoryId(dormitoryId);
    res.json({ data: settings });
  });

  // PATCH /api/v1/dormitories/:dormitoryId/billing-settings
  router.patch('/:dormitoryId/billing-settings', requireSession, requireDormitory, requireBillingUpdate, requireDormitoryWriteEntitlement, async (req: Request, res: Response) => {
    if (!verifyCsrfToken(req, res)) return;

    const parsed = OnboardingBillingInputSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'ข้อมูลการตั้งค่ารอบบิลไม่ถูกต้อง',
          fieldErrors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
          requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
          timestamp: new Date().toISOString(),
        },
      });
    }

    const dormitoryId = req.params.dormitoryId;
    let current = await billingRepo.findByDormitoryId(dormitoryId);
    if (!current) {
      current = await billingRepo.create({ dormitoryId });
    }

    const updated = await billingRepo.update(dormitoryId, parsed.data as any);
    res.json({ data: updated });
  });

  // GET /api/v1/dormitories/:dormitoryId/subscription
  router.get('/:dormitoryId/subscription', requireSession, requireDormitory, requireSubscriptionView, async (req: Request, res: Response) => {
    const dormitoryId = req.params.dormitoryId;
    const sub = await subRepo.findByDormitoryId(dormitoryId);
    if (!sub) {
      return res.status(404).json({
        error: {
          code: 'RESOURCE_NOT_FOUND',
          message: 'ไม่พบข้อมูล Subscription สำหรับหอพักนี้',
          fieldErrors: null,
          requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
          timestamp: new Date().toISOString(),
        },
      });
    }

    const plan = await planRepo.findById(sub.planId);
    res.json({
      data: {
        id: sub.id,
        dormitoryId: sub.dormitoryId,
        status: sub.status,
        billingInterval: sub.billingInterval,
        trialStartedAt: sub.trialStartedAt,
        trialEndsAt: sub.trialEndsAt,
        currentPeriodStartedAt: sub.currentPeriodStartedAt,
        currentPeriodEndsAt: sub.currentPeriodEndsAt,
        plan: plan
          ? {
              id: plan.id,
              code: plan.code,
              name: plan.name,
              monthlyPrice: plan.monthlyPrice,
              currency: plan.currency,
              vatIncluded: plan.vatIncluded,
              roomLimit: plan.roomLimit,
              messageQuotaMonthly: plan.messageQuotaMonthly,
            }
          : null,
      },
    });
  });

  return router;
}
