import { Router, Request, Response, NextFunction } from 'express';
import { AuthenticationService } from '../services/auth.service.js';
import { PaymentService } from '../services/payment.service.js';
import { extractDormitoryContext } from '../middleware/dormitory-context.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { enforceIdempotency } from '../middleware/idempotency.middleware.js';
import { CreateUploadIntentSchema, ConfirmEvidenceSchema } from '../schemas/payment-receipt.schemas.js';

export function createPaymentEvidenceRouter(
  authService: AuthenticationService,
  paymentService: PaymentService
): Router {
  const router = Router();

  router.use(authService.requireAuth());
  router.use(extractDormitoryContext());

  // POST /api/v1/payment-evidence/upload-intents
  router.post(
    '/upload-intents',
    requirePermission('payments.submit'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dormitoryId = req.dormitoryId!;
        const validated = CreateUploadIntentSchema.parse(req.body);
        const result = await paymentService.createUploadIntent(
          dormitoryId,
          validated,
          req.user?.id,
          req.tenantId
        );
        res.status(201).json({ success: true, data: result });
      } catch (err) {
        next(err);
      }
    }
  );

  // POST /api/v1/payment-evidence/confirm
  router.post(
    '/confirm',
    requirePermission('payments.submit'),
    enforceIdempotency('payment_evidence_confirm'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dormitoryId = req.dormitoryId!;
        const validated = ConfirmEvidenceSchema.parse(req.body);
        const paymentId = req.body.paymentId || validated.uploadIntentId;
        const result = await paymentService.confirmEvidence(
          dormitoryId,
          { ...validated, paymentId },
          req.user?.id
        );
        res.status(200).json({ success: true, data: result });
      } catch (err) {
        next(err);
      }
    }
  );

  // GET /api/v1/payment-evidence/:evidenceId/access
  router.get(
    '/:evidenceId/access',
    requirePermission('payments.view_evidence'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dormitoryId = req.dormitoryId!;
        const { evidenceId } = req.params;
        const result = await paymentService.getEvidenceReadAccess(dormitoryId, evidenceId);
        res.status(200).json({ success: true, data: result });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
