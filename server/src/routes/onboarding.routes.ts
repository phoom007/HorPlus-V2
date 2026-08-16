import { Router, Request, Response } from 'express';
import { AuthenticationService } from '../services/auth.service.js';
import { OnboardingService } from '../services/onboarding.service.js';
import { PromoService } from '../services/promo.service.js';
import { DormitoryProvisioningService } from '../services/dormitory-provisioning.service.js';
import { createRequireSessionMiddleware } from '../middleware/require-session.js';
import {
  CompleteOnboardingInputSchema,
  OnboardingDraftInputSchema,
  ValidatePromoInputSchema,
} from '../types/onboarding-validation.js';

export function createOnboardingRouter(
  authService: AuthenticationService,
  onboardingService: OnboardingService,
  promoService: PromoService,
  provisioningService: DormitoryProvisioningService
): Router {
  const router = Router();
  const requireSession = createRequireSessionMiddleware(authService);

  // Helper for CSRF check
  const verifyCsrfToken = (req: Request, res: Response): boolean => {
    const csrfHeader = req.headers['x-csrf-token'] as string | undefined;
    const csrfCookie = req.cookies?.[getCsrfCookieName()];
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

  function getCsrfCookieName(): string {
    return 'horplus_csrf';
  }

  // GET /api/v1/onboarding/status
  router.get('/status', requireSession, async (req: Request, res: Response) => {
    const userId = req.auth!.userId;
    const status = await onboardingService.getStatus(userId);
    res.json({ data: status });
  });

  // GET /api/v1/onboarding/draft
  router.get('/draft', requireSession, async (req: Request, res: Response) => {
    const userId = req.auth!.userId;
    const draft = await onboardingService.getDraft(userId);
    res.json({
      data: draft
        ? {
            currentStep: draft.currentStep,
            provisionalDormitoryId: draft.provisionalDormitoryId,
            signatureSaved: Boolean(draft.signatureSaved),
            payload: draft.payload,
            version: draft.version,
            updatedAt: draft.updatedAt,
          }
        : null,
    });
  });

  // PUT /api/v1/onboarding/draft
  router.put('/draft', requireSession, async (req: Request, res: Response) => {
    if (!verifyCsrfToken(req, res)) return;

    const parsed = OnboardingDraftInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'ข้อมูลการบันทึก Draft ไม่ถูกต้อง',
          fieldErrors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
          requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
          timestamp: new Date().toISOString(),
        },
      });
    }

    const userId = req.auth!.userId;
    await onboardingService.saveDraft(userId, parsed.data.currentStep, parsed.data.payload, req.body.provisionalDormitoryId);
    const draft = await onboardingService.getDraft(userId);

    res.json({
      data: draft
        ? {
            currentStep: draft.currentStep,
            provisionalDormitoryId: draft.provisionalDormitoryId,
            signatureSaved: Boolean(draft.signatureSaved),
            payload: draft.payload,
            version: draft.version,
            updatedAt: draft.updatedAt,
          }
        : null,
    });
  });

  // POST /api/v1/onboarding/prepare (Amendment A2: Prepare setup_pending dormitory before Step 4 signature)
  router.post('/prepare', requireSession, async (req: Request, res: Response) => {
    if (!verifyCsrfToken(req, res)) return;

    try {
      const userId = req.auth!.userId;
      const result = await provisioningService.prepareProvisionalDormitory(userId, req.body || {});
      res.json({ data: result });
    } catch (err: any) {
      const statusCode = err.status || 500;
      res.status(statusCode).json({
        error: {
          code: err.code || 'PROVISIONAL_DORM_PREPARE_FAILED',
          message: err.message || 'ไม่สามารถเตรียมข้อมูลหอพักชั่วคราวได้',
          fieldErrors: null,
          requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
          timestamp: new Date().toISOString(),
        },
      });
    }
  });

  // DELETE /api/v1/onboarding/draft
  router.delete('/draft', requireSession, async (req: Request, res: Response) => {
    if (!verifyCsrfToken(req, res)) return;

    const userId = req.auth!.userId;
    await onboardingService.deleteDraft(userId);

    res.json({ data: { success: true, message: 'ลบข้อมูลร่างสำเร็จ' } });
  });

  // POST /api/v1/onboarding/promo/validate
  router.post('/promo/validate', requireSession, async (req: Request, res: Response) => {
    if (!verifyCsrfToken(req, res)) return;

    const parsed = ValidatePromoInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'กรุณาระบุรหัสโปรโมชัน',
          fieldErrors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
          requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
          timestamp: new Date().toISOString(),
        },
      });
    }

    const userId = req.auth?.userId;
    const result = await promoService.validatePromo(parsed.data.code, userId);
    res.json({
      data: {
        valid: result.valid,
        eligible: result.eligible,
        code: result.code,
        benefitType: result.benefitType,
        benefitUnit: result.benefitUnit,
        benefitValue: result.benefitValue,
        trialMonths: result.trialMonths,
        promoBonusMonths: result.promoBonusMonths,
        totalTrialMonths: result.totalTrialMonths,
        message: result.message,
      },
    });
  });

  // POST /api/v1/onboarding/complete & /api/v1/onboarding/finalize
  const handleFinalize = async (req: Request, res: Response) => {
    if (!verifyCsrfToken(req, res)) return;

    const idempotencyKey = (req.headers['x-idempotency-key'] as string) || req.body?.idempotencyKey || `finalize-${Date.now()}`;
    const requestId = (req.headers['x-request-id'] as string) || 'req-unknown';

    const parsed = CompleteOnboardingInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'ข้อมูลการสร้างหอพักไม่ถูกต้อง กรุณาตรวจสอบข้อมูลอีกครั้ง',
          fieldErrors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
          requestId,
          timestamp: new Date().toISOString(),
        },
      });
    }

    try {
      const userId = req.auth!.userId;
      const result = await provisioningService.completeOwnerOnboarding({
        userId,
        idempotencyKey,
        provisionalDormitoryId: req.body.provisionalDormitoryId,
        requestId,
        dormitory: parsed.data.dormitory,
        billing: parsed.data.billing,
        payment: parsed.data.payment,
        buildings: parsed.data.buildings,
        rooms: parsed.data.rooms ? parsed.data.rooms.map((r) => ({ ...r, maximumOccupants: r.maximumOccupants ?? undefined })) : undefined,
        planCode: parsed.data.planCode,
        packageId: parsed.data.packageId || req.body.packageId,
        packageIntentId: parsed.data.packageIntentId || req.body.packageIntentId,
        promoCode: parsed.data.promoCode,
        referralCode: parsed.data.referralCode || req.body.referralCode,
        coinApplied: parsed.data.coinApplied !== undefined ? parsed.data.coinApplied : req.body.coinApplied,
        rules: parsed.data.rules,
        defaultTerms: parsed.data.defaultTerms,
        petPolicy: parsed.data.petPolicy,
        ownerSignatureUrl: parsed.data.ownerSignatureUrl || req.body?.ownerSignatureUrl || req.body?.signatureBase64,
      });

      res.status(200).json({ data: result });
    } catch (err: any) {
      const statusCode = err.statusCode || err.status || 500;
      const errorCode = err.errorCode || err.code || 'DORMITORY_PROVISIONING_FAILED';
      res.status(statusCode).json({
        error: {
          code: errorCode,
          message: err.message || 'เกิดข้อผิดพลาดขณะสร้างหอพัก กรุณาลองใหม่อีกครั้ง',
          fieldErrors: err.fieldErrors || null,
          requestId,
          timestamp: new Date().toISOString(),
        },
      });
    }
  };

  router.post('/complete', requireSession, handleFinalize);
  router.post('/finalize', requireSession, handleFinalize);

  return router;
}
