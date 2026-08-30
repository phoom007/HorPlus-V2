import { Router, Request, Response } from 'express';
import { getPrismaClient } from '../db/prisma.js';
import { AuthenticationService } from '../services/auth.service.js';
import { IDormitoryRepository } from '../db/repositories/dormitory.repository.js';
import { IBillingSettingsRepository } from '../db/repositories/billing-settings.repository.js';
import { ISubscriptionRepository } from '../db/repositories/subscription.repository.js';
import { IPlanRepository } from '../db/repositories/plan.repository.js';
import { SensitiveFieldService } from '../services/sensitive-field.service.js';
import { SignatureStorageService } from '../services/signature-storage.service.js';
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
import { validateCanonicalUtilityTiers } from '../utils/utility-tier-validator.util.js';
import { normalizeUtilityBillingMode } from '../utils/billing-mode-normalizer.util.js';

import multer from 'multer';
const upload = multer({ limits: { fileSize: 5 * 1024 * 1024 } });

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
    const csrfHeader = req.headers['x-csrf-token'] as string | undefined;
    const csrfCookie = req.cookies?.['horplus_csrf'];
    const sessionId = req.auth?.sessionId;

    if (!csrfHeader || !sessionId || !authService.verifyCsrf(csrfHeader, sessionId) || (csrfCookie && csrfCookie !== csrfHeader)) {
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
    let settings: any = null;
    try {
      settings = await billingRepo.findByDormitoryId(dormitoryId);
    } catch (err: any) {
      console.error('GET billing settings internal error:', err);
      return res.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'เกิดข้อผิดพลาดภายในระบบ',
          fieldErrors: null,
          requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
          timestamp: new Date().toISOString(),
        },
      });
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
      waterTierRates: settings.waterTierRates ?? null,
      electricityBillingType: settings.electricityBillingType,
      electricityRate: String(settings.electricityRate),
      electricityTierRates: settings.electricityTierRates ?? null,
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

    let current: any = null;
    try {
      current = await billingRepo.findByDormitoryId(dormitoryId);
      if (!current) {
        current = await billingRepo.create({ dormitoryId });
      }
    } catch (err: any) {
      console.error('PATCH billing settings initialization error:', err);
      return res.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'เกิดข้อผิดพลาดภายในระบบ',
          fieldErrors: null,
          requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
          timestamp: new Date().toISOString(),
        },
      });
    }

    try {
      const effectiveWaterBillingType = normalizeUtilityBillingMode(
        parsed.data.waterBillingType !== undefined ? parsed.data.waterBillingType : current.waterBillingType
      );
      const effectiveElectricityBillingType = normalizeUtilityBillingMode(
        parsed.data.electricityBillingType !== undefined ? parsed.data.electricityBillingType : current.electricityBillingType
      );

      let effectiveWaterTierRates: any = undefined;
      if (effectiveWaterBillingType === 'tiered') {
        const candidate = parsed.data.waterTierRates !== undefined ? parsed.data.waterTierRates : current.waterTierRates;
        if (!candidate || (Array.isArray(candidate) && candidate.length === 0)) {
          const err = new Error("INVALID_TIER_CONFIGURATION: Water billing mode is 'tiered' but no tier configuration was provided");
          (err as any).statusCode = 400;
          (err as any).code = 'INVALID_TIER_CONFIGURATION';
          throw err;
        }
        effectiveWaterTierRates = validateCanonicalUtilityTiers(candidate);
      } else {
        // Preserve inactive saved tiers unless client explicitly updated them
        if (parsed.data.waterTierRates !== undefined) {
          effectiveWaterTierRates = parsed.data.waterTierRates ? validateCanonicalUtilityTiers(parsed.data.waterTierRates) : null;
        } else {
          effectiveWaterTierRates = current.waterTierRates ?? null;
        }
      }

      let effectiveElectricityTierRates: any = undefined;
      if (effectiveElectricityBillingType === 'tiered') {
        const candidate = parsed.data.electricityTierRates !== undefined ? parsed.data.electricityTierRates : current.electricityTierRates;
        if (!candidate || (Array.isArray(candidate) && candidate.length === 0)) {
          const err = new Error("INVALID_TIER_CONFIGURATION: Electricity billing mode is 'tiered' but no tier configuration was provided");
          (err as any).statusCode = 400;
          (err as any).code = 'INVALID_TIER_CONFIGURATION';
          throw err;
        }
        effectiveElectricityTierRates = validateCanonicalUtilityTiers(candidate);
      } else {
        // Preserve inactive saved tiers unless client explicitly updated them
        if (parsed.data.electricityTierRates !== undefined) {
          effectiveElectricityTierRates = parsed.data.electricityTierRates ? validateCanonicalUtilityTiers(parsed.data.electricityTierRates) : null;
        } else {
          effectiveElectricityTierRates = current.electricityTierRates ?? null;
        }
      }

      const updatePayload: any = {
        ...parsed.data,
        waterBillingType: effectiveWaterBillingType,
        waterTierRates: effectiveWaterTierRates,
        electricityBillingType: effectiveElectricityBillingType,
        electricityTierRates: effectiveElectricityTierRates,
      };

      const updated = await billingRepo.update(dormitoryId, updatePayload as any);
      if (!updated) {
        return res.status(404).json({
          error: {
            code: 'DORMITORY_BILLING_SETTINGS_NOT_FOUND',
            message: 'ไม่พบการตั้งค่าการเรียกเก็บเงินของหอพัก',
            fieldErrors: null,
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }

      res.json({ data: updated });
    } catch (err: any) {
      if (
        err.code === 'INVALID_TIER_CONFIGURATION' ||
        err.code === 'INVALID_BILLING_MODE' ||
        err.message?.startsWith('INVALID_TIER_CONFIGURATION') ||
        err.message?.startsWith('INVALID_BILLING_MODE')
      ) {
        return res.status(400).json({
          error: {
            code: err.code || 'INVALID_TIER_CONFIGURATION',
            message: err.message,
            fieldErrors: null,
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }

      console.error('PATCH billing settings internal error:', err);
      return res.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'เกิดข้อผิดพลาดภายในระบบ',
          fieldErrors: null,
          requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
          timestamp: new Date().toISOString(),
        },
      });
    }
  });

  // GET /api/v1/dormitories/:dormitoryId/payment-settings (PS-002, PS-003, PS-008)
  router.get('/:dormitoryId/payment-settings', requireSession, requireDormitory, requirePaymentView, async (req: Request, res: Response) => {
    const dormitoryId = req.params.dormitoryId;
    let settings: any = null;
    try {
      settings = await billingRepo.findByDormitoryId(dormitoryId);
    } catch (err: any) {
      console.error('GET payment settings internal error:', err);
      return res.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'เกิดข้อผิดพลาดภายในระบบ',
          fieldErrors: null,
          requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
          timestamp: new Date().toISOString(),
        },
      });
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
      promptPayAccountName: settings.promptPayAccountName ?? null,
      maskedPromptPayValue: settings.promptPayType && decryptedPromptPay ? sensitiveFieldService.maskPromptPay(settings.promptPayType, decryptedPromptPay) : null,
      hasPromptPay: Boolean(settings.promptPayType && (settings.promptPayValueEncrypted || decryptedPromptPay)),
      bankCode: settings.bankCode ?? null,
      bankAccountName: settings.bankAccountName ?? null,
      maskedBankAccountNumber: decryptedBankAccount ? sensitiveFieldService.maskBankAccount(decryptedBankAccount) : (settings.bankAccountNumber ?? null),
      hasBankAccount: Boolean(settings.bankCode && (settings.bankAccountNumberEncrypted || decryptedBankAccount)),
      version: settings.version ?? 1,
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

    let currentSettings: any = null;
    try {
      currentSettings = await billingRepo.findByDormitoryId(dormitoryId);
    } catch (err: any) {
      console.error('PATCH payment settings findByDormitoryId error:', err.message);
      return res.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'เกิดข้อผิดพลาดภายในระบบ',
          fieldErrors: null,
          requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
          timestamp: new Date().toISOString(),
        },
      });
    }

    if (!currentSettings) {
      return res.status(404).json({
        error: {
          code: 'DORMITORY_BILLING_SETTINGS_NOT_FOUND',
          message: 'ไม่พบการตั้งค่าการเรียกเก็บเงินของหอพัก',
          fieldErrors: null,
          requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
          timestamp: new Date().toISOString(),
        },
      });
    }

    let finalPromptPayEnc: string | null = currentSettings?.promptPayValueEncrypted ?? null;
    let finalPromptPayType: string | null = parsed.data.promptPayType !== undefined ? (parsed.data.promptPayType ?? null) : (currentSettings?.promptPayType ?? null);
    let decryptedPromptPay: string | null = null;

    if (parsed.data.promptPayValue !== undefined) {
      const pVal = parsed.data.promptPayValue;
      if (pVal === null || pVal.trim() === '') {
        finalPromptPayEnc = null;
        finalPromptPayType = null;
      } else if (!pVal.includes('X')) {
        const clean = pVal.replace(/\D/g, '');
        if (clean) {
          finalPromptPayEnc = sensitiveFieldService.encrypt(clean).ciphertext;
          decryptedPromptPay = clean;
        }
      } else if (currentSettings?.promptPayValueEncrypted) {
        try {
          decryptedPromptPay = sensitiveFieldService.decrypt(currentSettings.promptPayValueEncrypted);
        } catch (err: any) {
          console.error('PATCH payment settings decrypt error for promptPay:', err.message);
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
      }
    } else if (currentSettings?.promptPayValueEncrypted) {
      try {
        decryptedPromptPay = sensitiveFieldService.decrypt(currentSettings.promptPayValueEncrypted);
      } catch (err: any) {
        console.error('PATCH payment settings decrypt error for promptPay:', err.message);
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
    }

    let finalBankAccEnc: string | null = currentSettings?.bankAccountNumberEncrypted ?? null;
    let decryptedBankAcc: string | null = null;

    if (parsed.data.bankAccountNumber !== undefined) {
      const bVal = parsed.data.bankAccountNumber;
      if (bVal === null || bVal.trim() === '') {
        finalBankAccEnc = null;
      } else if (!bVal.includes('X')) {
        const clean = bVal.trim();
        if (clean) {
          finalBankAccEnc = sensitiveFieldService.encrypt(clean).ciphertext;
          decryptedBankAcc = clean;
        }
      } else if (currentSettings?.bankAccountNumberEncrypted) {
        try {
          decryptedBankAcc = sensitiveFieldService.decrypt(currentSettings.bankAccountNumberEncrypted);
        } catch (err: any) {
          console.error('PATCH payment settings decrypt error for bankAccount:', err.message);
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
      }
    } else if (currentSettings?.bankAccountNumberEncrypted) {
      try {
        decryptedBankAcc = sensitiveFieldService.decrypt(currentSettings.bankAccountNumberEncrypted);
      } catch (err: any) {
        console.error('PATCH payment settings decrypt error for bankAccount:', err.message);
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
    }

    const updateData: any = {
      cashAccepted: parsed.data.cashAccepted ?? currentSettings?.cashAccepted ?? true,
      promptPayType: finalPromptPayType,
      promptPayValue: null, // Always keep plaintext PromptPay null in DB
      promptPayValueEncrypted: finalPromptPayEnc,
      promptPayAccountName: parsed.data.promptPayAccountName !== undefined ? (parsed.data.promptPayAccountName ?? null) : (currentSettings?.promptPayAccountName ?? null),
      bankCode: parsed.data.bankCode !== undefined ? (parsed.data.bankCode ?? null) : (currentSettings?.bankCode ?? null),
      bankAccountName: parsed.data.bankAccountName !== undefined ? (parsed.data.bankAccountName ?? null) : (currentSettings?.bankAccountName ?? null),
      bankAccountNumber: decryptedBankAcc ? sensitiveFieldService.maskBankAccount(decryptedBankAcc) : null,
      bankAccountNumberEncrypted: finalBankAccEnc,
    };

    let updated: any;
    try {
      updated = await billingRepo.update(dormitoryId, updateData);
    } catch (err: any) {
      console.error('PATCH payment settings update error:', err.message);
      return res.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'เกิดข้อผิดพลาดภายในระบบ',
          fieldErrors: null,
          requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
          timestamp: new Date().toISOString(),
        },
      });
    }

    if (!updated) {
      return res.status(404).json({
        error: {
          code: 'DORMITORY_BILLING_SETTINGS_NOT_FOUND',
          message: 'ไม่พบการตั้งค่าการเรียกเก็บเงินของหอพัก',
          fieldErrors: null,
          requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
          timestamp: new Date().toISOString(),
        },
      });
    }

    if (!decryptedPromptPay && updated.promptPayValueEncrypted) {
      try {
        decryptedPromptPay = sensitiveFieldService.decrypt(updated.promptPayValueEncrypted);
      } catch (err: any) {
        console.error('PATCH payment settings post-update decrypt error for promptPay:', err.message);
        return res.status(500).json({
          error: {
            code: 'PAYMENT_CONFIG_DECRYPTION_FAILED',
            message: 'ไม่สามารถถอดรหัสข้อมูลพร้อมเพย์หลังการบันทึกได้',
            fieldErrors: null,
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }
    }
    if (!decryptedBankAcc && updated.bankAccountNumberEncrypted) {
      try {
        decryptedBankAcc = sensitiveFieldService.decrypt(updated.bankAccountNumberEncrypted);
      } catch (err: any) {
        console.error('PATCH payment settings post-update decrypt error for bankAccount:', err.message);
        return res.status(500).json({
          error: {
            code: 'PAYMENT_CONFIG_DECRYPTION_FAILED',
            message: 'ไม่สามารถถอดรหัสข้อมูลบัญชีธนาคารหลังการบันทึกได้',
            fieldErrors: null,
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }
    }

    const publicPaymentDTO = {
      id: updated.id,
      dormitoryId: updated.dormitoryId,
      cashAccepted: updated.cashAccepted ?? true,
      promptPayType: updated.promptPayType ?? null,
      promptPayAccountName: updated.promptPayAccountName ?? null,
      maskedPromptPayValue: updated.promptPayType && decryptedPromptPay ? sensitiveFieldService.maskPromptPay(updated.promptPayType, decryptedPromptPay) : null,
      hasPromptPay: Boolean(updated.promptPayType && (updated.promptPayValueEncrypted || decryptedPromptPay)),
      bankCode: updated.bankCode ?? null,
      bankAccountName: updated.bankAccountName ?? null,
      maskedBankAccountNumber: decryptedBankAcc ? sensitiveFieldService.maskBankAccount(decryptedBankAcc) : null,
      hasBankAccount: Boolean(updated.bankCode && (updated.bankAccountNumberEncrypted || decryptedBankAcc)),
      version: updated.version ?? 1,
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

  // POST /api/v1/dormitories/:dormitoryId/signature (Task-009 Signature Persistence - supports both singular and plural)
  const handlePostSignature = async (req: Request, res: Response) => {
    if (!verifyCsrfToken(req, res)) return;

    try {
      const dormitoryId = req.params.dormitoryId;
      const userId = req.auth!.userId;
      let buffer: Buffer;

      if (req.body?.signatureBase64) {
        const base64Str = req.body.signatureBase64.replace(/^data:image\/\w+;base64,/, '');
        buffer = Buffer.from(base64Str, 'base64');
      } else if (req.file?.buffer) {
        buffer = req.file.buffer;
      } else if (Buffer.isBuffer(req.body)) {
        buffer = req.body;
      } else {
        return res.status(400).json({
          error: {
            code: 'INVALID_SIGNATURE_PAYLOAD',
            message: 'กรุณาระบุ signatureBase64 สำหรับบันทึกลายเซ็น',
            fieldErrors: null,
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const prisma = getPrismaClient();
      const signatureService = new SignatureStorageService(prisma);
      const result = await signatureService.saveSignature({ dormitoryId, userId, buffer });

      res.status(201).json({ data: result });
    } catch (err: any) {
      console.error('[HANDLE_POST_SIGNATURE ERROR]', {
        message: err.message,
        code: err.errorCode || err.code,
        statusCode: err.statusCode || err.status,
      });
      const statusCode = err.statusCode || err.status || 500;
      res.status(statusCode).json({
        error: {
          code: err.errorCode || err.code || 'SIGNATURE_UPLOAD_FAILED',
          message: err.message || 'เกิดข้อผิดพลาดขณะบันทึกลายเซ็น',
          fieldErrors: null,
          requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
          timestamp: new Date().toISOString(),
        },
      });
    }
  };

  router.post('/:dormitoryId/signature', requireSession, requireDormitory, requireDormitoryUpdate, requireDormitoryWriteEntitlement, upload.single('file'), handlePostSignature);
  router.post('/:dormitoryId/signatures', requireSession, requireDormitory, requireDormitoryUpdate, requireDormitoryWriteEntitlement, upload.single('file'), handlePostSignature);

  // GET /api/v1/dormitories/:dormitoryId/signature (Task-009 Signature Stream/Download)
  const handleGetSignature = async (req: Request, res: Response) => {
    try {
      const dormitoryId = req.params.dormitoryId;
      const prisma = getPrismaClient();
      const signatureService = new SignatureStorageService(prisma);
      const latestRecord = await signatureService.getLatestSignatureRecord(dormitoryId);

      if (!latestRecord) {
        return res.status(404).json({
          error: {
            code: 'SIGNATURE_NOT_FOUND',
            message: 'ไม่พบลายเซ็นสำหรับหอพักนี้',
            fieldErrors: null,
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const stream = await signatureService.getSignatureStream(latestRecord.objectKey);
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'private, no-cache');
      stream.pipe(res);
    } catch (err: any) {
      const statusCode = err.status || 500;
      res.status(statusCode).json({
        error: {
          code: err.code || 'SIGNATURE_STREAM_FAILED',
          message: err.message || 'เกิดข้อผิดพลาดขณะเรียกลายเซ็น',
          fieldErrors: null,
          requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
          timestamp: new Date().toISOString(),
        },
      });
    }
  };

  router.get('/:dormitoryId/signature', requireSession, requireDormitory, requireDormitoryView, handleGetSignature);
  router.get('/:dormitoryId/signatures', requireSession, requireDormitory, requireDormitoryView, handleGetSignature);

  return router;
}
