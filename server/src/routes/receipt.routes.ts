import { Router, Request, Response, NextFunction } from 'express';
import { AuthenticationService } from '../services/auth.service.js';
import { ReceiptGenerationService } from '../services/receipt.service.js';
import { extractDormitoryContext } from '../middleware/dormitory-context.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { ReceiptFilterSchema } from '../schemas/payment-receipt.schemas.js';

export function createReceiptRouter(
  authService: AuthenticationService,
  receiptService: ReceiptGenerationService
): Router {
  const router = Router();

  router.use(authService.requireAuth());
  router.use(extractDormitoryContext());

  // GET /api/v1/receipts
  router.get(
    '/',
    requirePermission('receipts.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dormitoryId = req.dormitoryId!;
        const query = ReceiptFilterSchema.parse(req.query);
        const result = await receiptService.listReceipts(dormitoryId, query);
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

  // Legacy helper GET /api/v1/receipts/bill/:billId
  router.get(
    '/bill/:billId',
    requirePermission('receipts.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dormitoryId = req.dormitoryId!;
        const { billId } = req.params;
        const details = await receiptService.getReceiptByBillId(dormitoryId, billId);
        if (!details) {
          return res.status(404).json({ success: false, message: 'Receipt not found for bill' });
        }
        res.status(200).json({ success: true, data: details.receipt });
      } catch (err) {
        next(err);
      }
    }
  );

  // Legacy helper GET /api/v1/receipts/tenant/:tenantId
  router.get(
    '/tenant/:tenantId',
    requirePermission('receipts.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dormitoryId = req.dormitoryId!;
        const { tenantId } = req.params;
        const result = await receiptService.listReceipts(dormitoryId, { tenantId });
        res.status(200).json({ success: true, data: result.items });
      } catch (err) {
        next(err);
      }
    }
  );

  // GET /api/v1/receipts/:receiptId
  router.get(
    '/:receiptId',
    requirePermission('receipts.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dormitoryId = req.dormitoryId!;
        const { receiptId } = req.params;
        const details = await receiptService.getReceiptDetails(dormitoryId, receiptId);
        if (!details) {
          return res.status(404).json({ success: false, message: 'Receipt not found' });
        }
        res.status(200).json({ success: true, data: details });
      } catch (err) {
        next(err);
      }
    }
  );

  // GET /api/v1/receipts/:receiptId/print-data
  router.get(
    '/:receiptId/print-data',
    requirePermission('receipts.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dormitoryId = req.dormitoryId!;
        const { receiptId } = req.params;
        const details = await receiptService.getReceiptDetails(dormitoryId, receiptId);
        if (!details) {
          return res.status(404).json({ success: false, message: 'Receipt not found' });
        }

        const printData = {
          receiptNumber: details.receipt.receiptNumber,
          dormitoryName: details.receipt.dormitoryNameSnapshot,
          dormitoryAddress: details.receipt.dormitoryAddressSnapshot,
          dormitoryPhone: details.receipt.dormitoryPhoneSnapshot,
          tenantName: details.receipt.tenantNameSnapshot,
          roomNumber: details.receipt.roomNumberSnapshot,
          billNumber: details.receipt.billNumberSnapshot,
          paidAt: details.receipt.paidAt,
          issuedAt: details.receipt.issuedAt,
          paymentMethod: details.receipt.paymentMethod,
          subtotal: details.receipt.subtotal,
          discountAmount: details.receipt.discountAmount,
          fineAmount: details.receipt.fineAmount,
          totalAmount: details.receipt.totalAmount,
          currency: details.receipt.currency,
          items: details.items.map((i) => ({
            description: i.description,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            amount: i.amount,
          })),
        };

        res.status(200).json({ success: true, data: printData });
      } catch (err) {
        next(err);
      }
    }
  );

  // POST /api/v1/receipts/:receiptId/void
  router.post(
    '/:receiptId/void',
    requirePermission('receipts.view'),
    async (_req: Request, res: Response) => {
      res.status(501).json({
        success: false,
        code: 'RECEIPT_VOID_NOT_IMPLEMENTED',
        message: 'การยกเลิก/คืนเงินสำหรับใบเสร็จยังไม่เปิดใช้งานในระบบ',
      });
    }
  );

  return router;
}
