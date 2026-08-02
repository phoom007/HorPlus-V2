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
    const csrfToken = (req.headers['x-csrf-token'] as string) || req.cookies?.[getCsrfCookieName()];
    const sessionId = req.auth?.sessionId;
    console.log('verifyCsrfToken Debug:', { csrfToken, sessionId, auth: req.auth });
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
    const draft = await onboardingService.saveDraft(userId, parsed.data.currentStep, parsed.data.payload);

    res.json({
      data: {
        currentStep: draft.currentStep,
        payload: draft.payload,
        version: draft.version,
        updatedAt: draft.updatedAt,
      },
    });
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

    const result = await promoService.validatePromo(parsed.data.code);
    res.json({
      data: {
        valid: result.valid,
        code: result.code,
        standardTrialDays: result.standardTrialDays,
        bonusTrialDays: result.bonusTrialDays,
        totalTrialDays: result.totalTrialDays,
        message: result.message,
      },
    });
  });

  // POST /api/v1/onboarding/complete
  router.post('/complete', requireSession, async (req: Request, res: Response) => {
    if (!verifyCsrfToken(req, res)) return;

    const idempotencyKey = (req.headers['x-idempotency-key'] as string) || req.body?.idempotencyKey;
    const requestId = (req.headers['x-request-id'] as string) || 'req-unknown';

    if (!idempotencyKey || !idempotencyKey.trim()) {
      return res.status(400).json({
        error: {
          code: 'IDEMPOTENCY_KEY_REQUIRED',
          message: 'กรุณาระบุ X-Idempotency-Key สำหรับการยืนยันข้อมูลหอพัก',
          fieldErrors: null,
          requestId,
          timestamp: new Date().toISOString(),
        },
      });
    }

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
        requestId,
        dormitory: parsed.data.dormitory,
        billing: parsed.data.billing,
        buildings: parsed.data.buildings,
        rooms: parsed.data.rooms,
        planCode: parsed.data.planCode,
        promoCode: parsed.data.promoCode,
      });

      res.status(200).json({ data: result });
    } catch (err: any) {
      const statusCode = err.status || 500;
      res.status(statusCode).json({
        error: {
          code: err.code || 'DORMITORY_PROVISIONING_FAILED',
          message: err.message || 'เกิดข้อผิดพลาดขณะสร้างหอพัก กรุณาลองใหม่อีกครั้ง',
          fieldErrors: null,
          requestId,
          timestamp: new Date().toISOString(),
        },
      });
    }
  });

  return router;
}
