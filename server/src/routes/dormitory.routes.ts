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
  PaymentSettingsInputSchema,
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

  // GET /api/v1/dormitories/:dormitoryId/billing-settings (PS-001 Public Billing DTO Isolation)
  router.get('/:dormitoryId/billing-settings', requireSession, requireDormitory, requireBillingView, async (req: Request, res: Response) => {
    const dormitoryId = req.params.dormitoryId;
    let settings: any = await billingRepo.findByDormitoryId(dormitoryId);
    if (!settings) {
      const prisma = getPrismaClient();
      if (prisma?.dormitoryBillingSettings) {
        settings = await prisma.dormitoryBillingSettings.findUnique({ where: { dormitoryId } });
      }
    }

    if (!settings) {
      return res.json({ data: null });
    }

    // PS-001: Explicit public billing DTO (excludes promptPayValueEncrypted and payment account details)
    const publicBillingDTO = {
      id: settings.id,
      dormitoryId: settings.dormitoryId,
      billingDay: settings.billingDay,
      dueDay: settings.dueDay,
      waterBillingType: settings.waterBillingType,
      waterRate: String(settings.waterRate),
      electricityBillingType: settings.electricityBillingType,
      electricityRate: String(settings.electricityRate),
      commonFee: String(settings.commonFee),
      internetFee: String(settings.internetFee),
      lateFeeType: settings.lateFeeType,
      lateFeeValue: String(settings.lateFeeValue),
      rentBillingType: settings.rentBillingType,
      createdAt: settings.createdAt,
      updatedAt: settings.updatedAt,
    };

    res.json({ data: publicBillingDTO });
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

  // GET /api/v1/dormitories/:dormitoryId/payment-settings (PS-002, PS-003, PS-008)
  router.get('/:dormitoryId/payment-settings', requireSession, requireDormitory, requirePaymentView, async (req: Request, res: Response) => {
    const dormitoryId = req.params.dormitoryId;
    let settings: any = await billingRepo.findByDormitoryId(dormitoryId);
    if (!settings) {
      const prisma = getPrismaClient();
      if (prisma?.dormitoryBillingSettings) {
        settings = await prisma.dormitoryBillingSettings.findUnique({ where: { dormitoryId } });
      }
    }

    if (!settings) {
      return res.json({ data: null });
    }

    let decryptedPromptPay: string | null = null;
    if (settings.promptPayValueEncrypted) {
      try {
        decryptedPromptPay = sensitiveFieldService.decrypt(settings.promptPayValueEncrypted);
      } catch (err: any) {
        console.error('Payment settings decrypt error for promptPay:', err.message);
        return res.status(500).json({
          error: {
            code: 'PAYMENT_CONFIG_DECRYPTION_FAILED',
            message: 'ไม่สามารถถอดรหัสข้อมูลพร้อมเพย์ได้',
            fieldErrors: null,
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }
    } else if (settings.promptPayValue) {
      decryptedPromptPay = settings.promptPayValue;
    }

    let decryptedBankAccount: string | null = null;
    if (settings.bankAccountNumberEncrypted) {
      try {
        decryptedBankAccount = sensitiveFieldService.decrypt(settings.bankAccountNumberEncrypted);
      } catch (err: any) {
        console.error('Payment settings decrypt error for bankAccount:', err.message);
        return res.status(500).json({
          error: {
            code: 'PAYMENT_CONFIG_DECRYPTION_FAILED',
            message: 'ไม่สามารถถอดรหัสข้อมูลบัญชีธนาคารได้',
            fieldErrors: null,
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }
    } else if (settings.bankAccountNumber && !settings.bankAccountNumber.includes('X')) {
      decryptedBankAccount = settings.bankAccountNumber;
    }

    const publicPaymentDTO = {
      id: settings.id,
      dormitoryId: settings.dormitoryId,
      cashAccepted: settings.cashAccepted ?? true,
      promptPayType: settings.promptPayType ?? null,
      promptPayValue: decryptedPromptPay,
      maskedPromptPayValue: settings.promptPayType ? sensitiveFieldService.maskPromptPay(settings.promptPayType, decryptedPromptPay || undefined) : null,
      hasPromptPay: Boolean(settings.promptPayType && (settings.promptPayValueEncrypted || decryptedPromptPay)),
      bankCode: settings.bankCode ?? null,
      bankAccountName: settings.bankAccountName ?? null,
      bankAccountNumber: decryptedBankAccount || (settings.bankAccountNumber ?? null),
      maskedBankAccountNumber: decryptedBankAccount ? sensitiveFieldService.maskBankAccount(decryptedBankAccount) : (settings.bankAccountNumber ?? null),
      createdAt: settings.createdAt,
      updatedAt: settings.updatedAt,
    };

    res.json({ data: publicPaymentDTO });
  });

  // PATCH /api/v1/dormitories/:dormitoryId/payment-settings (PS-007 Owner Lifecycle Update)
  router.patch('/:dormitoryId/payment-settings', requireSession, requireDormitory, requirePaymentUpdate, requireDormitoryWriteEntitlement, async (req: Request, res: Response) => {
    if (!verifyCsrfToken(req, res)) return;

    const parsed = PaymentSettingsInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'ข้อมูลการตั้งค่าการชำระเงินไม่ถูกต้อง',
          fieldErrors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
          requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
          timestamp: new Date().toISOString(),
        },
      });
    }

    const dormitoryId = req.params.dormitoryId;
    const prisma = getPrismaClient();
    const promptPayRaw = parsed.data.promptPayValue ? parsed.data.promptPayValue.replace(/\D/g, '') : null;
    const encryptedPromptPay = promptPayRaw ? sensitiveFieldService.encrypt(promptPayRaw).ciphertext : null;

    const bankAccRaw = parsed.data.bankAccountNumber ? parsed.data.bankAccountNumber.trim() : null;
    const encryptedBankAcc = bankAccRaw ? sensitiveFieldService.encrypt(bankAccRaw).ciphertext : null;

    const updateData: any = {
      cashAccepted: parsed.data.cashAccepted ?? true,
      promptPayType: parsed.data.promptPayType ?? null,
      promptPayValue: null, // Always keep plaintext PromptPay null in DB
      promptPayValueEncrypted: encryptedPromptPay,
      bankCode: parsed.data.bankCode ?? null,
      bankAccountName: parsed.data.bankAccountName ?? null,
      bankAccountNumber: bankAccRaw ? sensitiveFieldService.maskBankAccount(bankAccRaw) : null,
      bankAccountNumberEncrypted: encryptedBankAcc,
    };

    let updated: any;
    if (prisma?.dormitoryBillingSettings) {
      updated = await prisma.dormitoryBillingSettings.upsert({
        where: { dormitoryId },
        update: updateData,
        create: { dormitoryId, ...updateData },
      });
    } else {
      updated = await billingRepo.update(dormitoryId, updateData);
    }

    const publicPaymentDTO = {
      id: updated.id,
      dormitoryId: updated.dormitoryId,
      cashAccepted: updated.cashAccepted ?? true,
      promptPayType: updated.promptPayType ?? null,
      promptPayValue: promptPayRaw,
      maskedPromptPayValue: updated.promptPayType ? sensitiveFieldService.maskPromptPay(updated.promptPayType, promptPayRaw || undefined) : null,
      hasPromptPay: Boolean(updated.promptPayType && promptPayRaw),
      bankCode: updated.bankCode ?? null,
      bankAccountName: updated.bankAccountName ?? null,
      bankAccountNumber: bankAccRaw,
      maskedBankAccountNumber: bankAccRaw ? sensitiveFieldService.maskBankAccount(bankAccRaw) : null,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };

    res.json({ data: publicPaymentDTO });
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
