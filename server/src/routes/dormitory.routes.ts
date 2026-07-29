import { Router, Request, Response } from 'express';
import { AuthenticationService } from '../services/auth.service.js';
import { IDormitoryRepository } from '../db/repositories/dormitory.repository.js';
import { IBillingSettingsRepository } from '../db/repositories/billing-settings.repository.js';
import { IPaymentSettingsRepository } from '../db/repositories/payment-settings.repository.js';
import { ISubscriptionRepository } from '../db/repositories/subscription.repository.js';
import { IPlanRepository } from '../db/repositories/plan.repository.js';
import { SensitiveFieldService } from '../services/sensitive-field.service.js';
import { createRequireSessionMiddleware } from '../middleware/require-session.js';
import { createRequireDormitoryContextMiddleware } from '../middleware/require-dormitory.js';
import { createRequirePermissionMiddleware } from '../middleware/require-permission.js';
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
  paymentRepo: IPaymentSettingsRepository,
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
    for (const mem of activeMemberships) {
      const dorm = await dormitoryRepo.findById(mem.dormitoryId);
      if (dorm && dorm.status === 'active') {
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
  router.patch('/:dormitoryId', requireSession, requireDormitory, requireDormitoryUpdate, async (req: Request, res: Response) => {
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
  router.patch('/:dormitoryId/billing-settings', requireSession, requireDormitory, requireBillingUpdate, async (req: Request, res: Response) => {
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

  // GET /api/v1/dormitories/:dormitoryId/payment-settings
  router.get('/:dormitoryId/payment-settings', requireSession, requireDormitory, requirePaymentView, async (req: Request, res: Response) => {
    const dormitoryId = req.params.dormitoryId;
    const settings = await paymentRepo.findByDormitoryId(dormitoryId);

    if (!settings) {
      return res.json({
        data: {
          dormitoryId,
          cashAccepted: true,
          promptPayType: null,
          promptPayValueMasked: null,
          bankCode: null,
          bankAccountName: null,
          bankAccountNumberMasked: null,
        },
      });
    }

    res.json({
      data: {
        id: settings.id,
        dormitoryId: settings.dormitoryId,
        cashAccepted: settings.cashAccepted,
        promptPayType: settings.promptPayType,
        promptPayValueMasked: settings.promptPayValueMasked,
        bankCode: settings.bankCode,
        bankAccountName: settings.bankAccountName,
        bankAccountNumberMasked: settings.bankAccountNumberMasked,
        updatedAt: settings.updatedAt,
      },
    });
  });

  // PATCH /api/v1/dormitories/:dormitoryId/payment-settings
  router.patch('/:dormitoryId/payment-settings', requireSession, requireDormitory, requirePaymentUpdate, async (req: Request, res: Response) => {
    if (!verifyCsrfToken(req, res)) return;

    const parsed = OnboardingPaymentInputSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'ข้อมูลช่องทางชำระเงินไม่ถูกต้อง',
          fieldErrors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
          requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
          timestamp: new Date().toISOString(),
        },
      });
    }

    const dormitoryId = req.params.dormitoryId;
    let current = await paymentRepo.findByDormitoryId(dormitoryId);

    const updatePayload: any = {};
    if (parsed.data.cashAccepted !== undefined) updatePayload.cashAccepted = parsed.data.cashAccepted;
    if (parsed.data.promptPayType !== undefined) updatePayload.promptPayType = parsed.data.promptPayType;
    if (parsed.data.bankCode !== undefined) updatePayload.bankCode = parsed.data.bankCode;
    if (parsed.data.bankAccountName !== undefined) updatePayload.bankAccountName = parsed.data.bankAccountName;

    if (parsed.data.promptPayValue !== undefined) {
      if (parsed.data.promptPayValue) {
        const enc = sensitiveFieldService.encrypt(parsed.data.promptPayValue);
        updatePayload.promptPayValueEncrypted = enc.ciphertext;
        updatePayload.promptPayValueMasked = sensitiveFieldService.maskPromptPay(
          parsed.data.promptPayType || current?.promptPayType || undefined,
          parsed.data.promptPayValue
        );
      } else {
        updatePayload.promptPayValueEncrypted = null;
        updatePayload.promptPayValueMasked = null;
      }
    }

    if (parsed.data.bankAccountNumber !== undefined) {
      if (parsed.data.bankAccountNumber) {
        const enc = sensitiveFieldService.encrypt(parsed.data.bankAccountNumber);
        updatePayload.bankAccountNumberEncrypted = enc.ciphertext;
        updatePayload.bankAccountNumberMasked = sensitiveFieldService.maskBankAccount(parsed.data.bankAccountNumber);
      } else {
        updatePayload.bankAccountNumberEncrypted = null;
        updatePayload.bankAccountNumberMasked = null;
      }
    }

    if (!current) {
      current = await paymentRepo.create({ dormitoryId, ...updatePayload });
    } else {
      current = await paymentRepo.update(dormitoryId, updatePayload);
    }

    res.json({
      data: {
        id: current?.id,
        dormitoryId,
        cashAccepted: current?.cashAccepted,
        promptPayType: current?.promptPayType,
        promptPayValueMasked: current?.promptPayValueMasked,
        bankCode: current?.bankCode,
        bankAccountName: current?.bankAccountName,
        bankAccountNumberMasked: current?.bankAccountNumberMasked,
        updatedAt: current?.updatedAt,
      },
    });
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
              roomLimit: plan.roomLimit, // null for ENTERPRISE
              messageQuotaMonthly: plan.messageQuotaMonthly,
            }
          : null,
      },
    });
  });

  return router;
}
