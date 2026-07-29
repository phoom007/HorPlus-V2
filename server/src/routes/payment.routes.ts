import { Router, Request, Response, NextFunction } from 'express';
import { AuthenticationService } from '../services/auth.service.js';
import { PaymentService } from '../services/payment.service.js';
import { extractDormitoryContext } from '../middleware/dormitory-context.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { enforceIdempotency } from '../middleware/idempotency.middleware.js';
import {
  CreateManualPaymentSchema,
  ApprovePaymentSchema,
  RejectPaymentSchema,
  PaymentFilterSchema,
} from '../schemas/payment-receipt.schemas.js';

export function createPaymentRouter(
  authService: AuthenticationService,
  paymentService: PaymentService
): Router {
  const router = Router();

  router.use(authService.requireAuth());
  router.use(extractDormitoryContext());

  // GET /api/v1/payments/summary
  router.get(
    '/summary',
    requirePermission('payment_reports.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dormitoryId = req.dormitoryId!;
        const cycleId = req.query.cycleId as string | undefined;
        const summary = await paymentService.getSummary(dormitoryId, cycleId);
        res.status(200).json({ success: true, data: summary });
      } catch (err) {
        next(err);
      }
    }
  );

  // Legacy helper GET /api/v1/payments/slips
  router.get(
    '/slips',
    requirePermission('payments.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dormitoryId = req.dormitoryId!;
        const result = await paymentService.listPayments(dormitoryId, { method: 'bank_transfer' });
        res.status(200).json({ success: true, data: result.items });
      } catch (err) {
        next(err);
      }
    }
  );

  // Legacy helper GET /api/v1/payments/slips/bill/:billId
  router.get(
    '/slips/bill/:billId',
    requirePermission('payments.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dormitoryId = req.dormitoryId!;
        const { billId } = req.params;
        const result = await paymentService.listPayments(dormitoryId, { billId });
        const payment = result.items[0];
        if (!payment) {
          return res.status(404).json({ success: false, message: 'Slip/Payment not found for bill' });
        }
        res.status(200).json({ success: true, data: payment });
      } catch (err) {
        next(err);
      }
    }
  );

  // Legacy helper POST /api/v1/payments/slips/bill/:billId
  router.post(
    '/slips/bill/:billId',
    requirePermission('payments.submit'),
    enforceIdempotency('payment_slip_submit'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dormitoryId = req.dormitoryId!;
        const { billId } = req.params;
        const { amount, transferDateTime, memo, senderName } = req.body;
        const result = await paymentService.submitPayment(
          dormitoryId,
          {
            billId,
            method: 'bank_transfer',
            channel: 'owner_manual',
            amount: amount ? String(amount) : '0.00',
            paidAt: transferDateTime ? new Date(transferDateTime) : new Date(),
            submittedByUserId: req.user?.id,
            note: memo || (senderName ? `Sender: ${senderName}` : undefined),
          },
          req.requestId
        );
        res.status(201).json({ success: true, data: result.payment });
      } catch (err) {
        next(err);
      }
    }
  );

  // POST /api/v1/payments/manual
  router.post(
    '/manual',
    requirePermission('payments.submit'),
    enforceIdempotency('payment_manual_submit'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dormitoryId = req.dormitoryId!;
        const validated = CreateManualPaymentSchema.parse(req.body);
        const result = await paymentService.submitPayment(
          dormitoryId,
          {
            billId: validated.billId,
            method: validated.method,
            channel: 'owner_manual',
            amount: validated.amount,
            paidAt: validated.paidAt ? new Date(validated.paidAt) : new Date(),
            submittedByUserId: req.user?.id,
            receivedByUserId: validated.receivedByUserId || req.user?.id,
            evidenceId: validated.evidenceId,
            transactionReference: validated.transactionReference,
            note: validated.note,
            approveImmediately: validated.approveImmediately,
          },
          req.requestId
        );
        res.status(201).json({ success: true, data: result });
      } catch (err) {
        next(err);
      }
    }
  );

  // GET /api/v1/payments
  router.get(
    '/',
    requirePermission('payments.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dormitoryId = req.dormitoryId!;
        const query = PaymentFilterSchema.parse(req.query);
        const result = await paymentService.listPayments(dormitoryId, query);
        res.status(200).json({
          success: true,
          data: result.items,
          pagination: {
            page: query.page,
            pageSize: query.pageSize,
            total: result.total,
          },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // GET /api/v1/payments/:paymentId
  router.get(
    '/:paymentId',
    requirePermission('payments.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dormitoryId = req.dormitoryId!;
        const { paymentId } = req.params;
        const details = await paymentService.getPaymentDetails(dormitoryId, paymentId);
        if (!details) {
          return res.status(404).json({ success: false, message: 'Payment not found' });
        }
        res.status(200).json({ success: true, data: details });
      } catch (err) {
        next(err);
      }
    }
  );

  // Legacy helper POST /api/v1/payments/approve/bill/:billId
  router.post(
    '/approve/bill/:billId',
    requirePermission('payments.approve'),
    enforceIdempotency('payment_approve_bill'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dormitoryId = req.dormitoryId!;
        const { billId } = req.params;
        const payments = await paymentService.listPayments(dormitoryId, { billId });
        const targetPayment = payments.items.find((p) => p.status === 'checking' || p.status === 'submitted') || payments.items[0];
        
        if (!targetPayment) {
          return res.status(404).json({ success: false, message: 'No payment record found for bill' });
        }

        const result = await paymentService.approvePayment(
          dormitoryId,
          {
            paymentId: targetPayment.id,
            actorUserId: req.user?.id,
          },
          req.requestId
        );

        res.status(200).json({ success: true, data: result.receipt });
      } catch (err) {
        next(err);
      }
    }
  );

  // POST /api/v1/payments/:paymentId/approve
  router.post(
    '/:paymentId/approve',
    requirePermission('payments.approve'),
    enforceIdempotency('payment_approve'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dormitoryId = req.dormitoryId!;
        const { paymentId } = req.params;
        const validated = ApprovePaymentSchema.parse(req.body);
        const result = await paymentService.approvePayment(
          dormitoryId,
          {
            paymentId,
            actorUserId: req.user?.id,
            version: validated.version,
            note: validated.note,
          },
          req.requestId
        );
        res.status(200).json({ success: true, data: result });
      } catch (err) {
        next(err);
      }
    }
  );

  // Legacy helper POST /api/v1/payments/reject/bill/:billId
  router.post(
    '/reject/bill/:billId',
    requirePermission('payments.reject'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dormitoryId = req.dormitoryId!;
        const { billId } = req.params;
        const { reason } = req.body;
        const payments = await paymentService.listPayments(dormitoryId, { billId });
        const targetPayment = payments.items.find((p) => p.status === 'checking' || p.status === 'submitted') || payments.items[0];

        if (!targetPayment) {
          return res.status(404).json({ success: false, message: 'No payment record found for bill' });
        }

        const result = await paymentService.rejectPayment(
          dormitoryId,
          {
            paymentId: targetPayment.id,
            actorUserId: req.user?.id,
            reason: reason || 'Rejected by owner/finance',
          },
          req.requestId
        );

        res.status(200).json({ success: true, data: result.payment });
      } catch (err) {
        next(err);
      }
    }
  );

  // POST /api/v1/payments/:paymentId/reject
  router.post(
    '/:paymentId/reject',
    requirePermission('payments.reject'),
    enforceIdempotency('payment_reject'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dormitoryId = req.dormitoryId!;
        const { paymentId } = req.params;
        const validated = RejectPaymentSchema.parse(req.body);
        const result = await paymentService.rejectPayment(
          dormitoryId,
          {
            paymentId,
            actorUserId: req.user?.id,
            reason: validated.reason,
            version: validated.version,
          },
          req.requestId
        );
        res.status(200).json({ success: true, data: result });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
