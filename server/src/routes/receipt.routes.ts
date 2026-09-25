import { Router, Request, Response } from 'express';
import { receiptService } from '../services/receipt.service.js';
import { AuthenticationService } from '../services/auth.service.js';
import { getPrismaClient } from '../db/prisma.js';
import { renderReceiptHtml } from '../utils/receipt-html.util.js';
import { findAuthoritativeActiveTenant } from '../utils/tenant-resolution.util.js';
import { AppError } from '../types/index.js';

const prisma = getPrismaClient();

export function createReceiptRouter(authService: AuthenticationService) {
  const router = Router();
  const requireAuth = authService.requireAuth();

  // Helper to ensure tenant authorization
  const ensureTenant = async (req: Request, res: Response, dormitoryId: string) => {
    const auth = (req as any).auth;
    const membership = auth?.memberships?.find((m: any) => 
      m.dormitoryId === dormitoryId && (
        m.role === 'tenant' || m.roleCode?.toLowerCase() === 'tenant' || m.roleId === 'role-tenant'
      )
    );
    if (!membership) return null;
    const tenant = await findAuthoritativeActiveTenant({
      dormitoryId,
      auth,
      client: prisma,
    });
    return tenant;
  };

  // Helper to ensure owner/manager authorization
  const ensureOwnerOrManager = (req: Request, res: Response, dormitoryId: string) => {
    const auth = (req as any).auth;
    return auth?.memberships?.find((m: any) => 
      m.dormitoryId === dormitoryId && (
        m.role === 'owner' || m.role === 'manager' ||
        m.roleCode?.toLowerCase() === 'owner' || m.roleCode?.toLowerCase() === 'manager' ||
        m.roleId === 'role-owner' || m.roleId === 'role-manager'
      )
    );
  };

  const isTenantAuthorizedForBill = (bill: any, tenantId: string, tenantContractIds: string[]) => {
    if (!bill) return false;
    if (bill.tenantId === tenantId) return true;
    if (!bill.tenantId && bill.contractId && tenantContractIds.includes(bill.contractId)) return true;
    return false;
  };

  const isTenantAuthorizedForReceipt = async (receiptRecord: any, tenantId: string) => {
    const tenantContracts = await prisma.contract.findMany({
      where: { tenantId, dormitoryId: receiptRecord.dormitoryId },
      select: { id: true },
    });
    const tenantContractIds = tenantContracts.map((c: any) => c.id);

    if (receiptRecord.billId) {
      const bill = await prisma.bill.findUnique({ where: { id: receiptRecord.billId } });
      if (isTenantAuthorizedForBill(bill, tenantId, tenantContractIds)) {
        return true;
      }
    }
    if (receiptRecord.paymentGroupId) {
      const targets = await prisma.combinedPaymentGroupBillTarget.findMany({
        where: { paymentGroupId: receiptRecord.paymentGroupId },
        include: { bill: true },
      });
      if (targets.some((t: any) => isTenantAuthorizedForBill(t.bill, tenantId, tenantContractIds))) {
        return true;
      }
    }
    if (receiptRecord.dailyStayInvoiceId) {
      const dinv = await prisma.dailyStayInvoice.findUnique({
        where: { id: receiptRecord.dailyStayInvoiceId },
        include: { dailyStay: true },
      });
      if (dinv?.dailyStay?.tenantId === tenantId) {
        return true;
      }
    }
    if (receiptRecord.paymentId) {
      const p = await prisma.payment.findUnique({
        where: { id: receiptRecord.paymentId },
      });
      if (p?.tenantId === tenantId) {
        return true;
      }
    }
    return false;
  };

  router.get('/:receiptId', requireAuth, async (req, res) => {
    try {
      const receiptId = req.params.receiptId;
      const receiptRecord = await prisma.receipt.findUnique({ where: { id: receiptId } });
      
      if (!receiptRecord) return res.status(404).json({ error: 'Receipt not found' });
      
      const dormitoryId = receiptRecord.dormitoryId;

      // Check authorization
      const isOwner = ensureOwnerOrManager(req, res, dormitoryId);
      let authorized = false;
      
      if (isOwner) {
        authorized = true;
      } else {
        const tenant = await ensureTenant(req, res, dormitoryId);
        if (tenant) {
          authorized = await isTenantAuthorizedForReceipt(receiptRecord, tenant.id);
        }
      }

      if (!authorized) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const receipt = await receiptService.getReceipt(dormitoryId, receiptId);
      res.json(receipt);
    } catch (err: any) {
      res.status(err.statusCode || 404).json({
        error: {
          code: err.errorCode || 'RECEIPT_NOT_FOUND',
          message: err instanceof AppError ? err.message : 'ไม่พบข้อมูลใบเสร็จรับเงิน',
        },
      });
    }
  });

  const handleReceiptHtml = async (req: Request, res: Response) => {
    try {
      const receiptId = req.params.receiptId;
      const receiptRecord = await prisma.receipt.findUnique({ where: { id: receiptId } });
      
      if (!receiptRecord) return res.status(404).send('Receipt not found');
      
      const dormitoryId = receiptRecord.dormitoryId;
      const isOwner = ensureOwnerOrManager(req, res, dormitoryId);
      let authorized = false;
      
      if (isOwner) {
        authorized = true;
      } else {
        const tenant = await ensureTenant(req, res, dormitoryId);
        if (tenant) {
          authorized = await isTenantAuthorizedForReceipt(receiptRecord, tenant.id);
        }
      }

      if (!authorized) {
        return res.status(403).send('Forbidden');
      }

      // Amendment 6: Resolve whether a CURRENT dormitory logo exists at render/open time
      let hasCurrentLogo = false;
      if (receiptRecord.dormitoryId) {
        const dorm = await prisma.dormitory.findUnique({
          where: { id: receiptRecord.dormitoryId },
          select: { logoObjectKey: true },
        });
        hasCurrentLogo = Boolean(dorm?.logoObjectKey);
      }

      const html = renderReceiptHtml(receiptRecord, { hasCurrentLogo });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (err: any) {
      res.status(err.statusCode || 500).send('เกิดข้อผิดพลาดในการแสดงใบเสร็จรับเงิน');
    }
  };

  router.get('/:receiptId/html', requireAuth, handleReceiptHtml);
  router.get('/:receiptId/print', requireAuth, handleReceiptHtml);

  router.get('/final/bill/:billId', requireAuth, async (req: Request, res: Response) => {
    try {
      const { billId } = req.params;
      const bill = await prisma.bill.findUnique({ where: { id: billId } });
      if (!bill) return res.status(404).json({ error: 'Bill not found' });
      
      const isOwner = ensureOwnerOrManager(req, res, bill.dormitoryId);
      if (!isOwner) {
        const tenant = await ensureTenant(req, res, bill.dormitoryId);
        if (!tenant) {
          return res.status(403).json({ error: 'Forbidden' });
        }
        const tenantContracts = await prisma.contract.findMany({
          where: { tenantId: tenant.id, dormitoryId: bill.dormitoryId },
          select: { id: true },
        });
        const tenantContractIds = tenantContracts.map((c: any) => c.id);
        if (!isTenantAuthorizedForBill(bill, tenant.id, tenantContractIds)) {
          return res.status(403).json({ error: 'Forbidden' });
        }
      }

      const userId = (req as any).user?.id || (req as any).auth?.userId;
      const receipt = await receiptService.getFinalReceiptForBill(bill.dormitoryId, billId, userId);
      if (!receipt) return res.status(404).json({ error: 'Final receipt not found' });
      
      res.json(receipt);
    } catch (err: any) {
      res.status(err.statusCode || 500).json({
        error: {
          code: err.errorCode || 'RECEIPT_NOT_FOUND',
          message: err instanceof AppError ? err.message : 'เกิดข้อผิดพลาดในการดึงข้อมูลใบเสร็จรับเงิน',
        },
      });
    }
  });

  router.get('/final/daily-invoice/:invoiceId', requireAuth, async (req: Request, res: Response) => {
    try {
      const { invoiceId } = req.params;
      const invoice = await prisma.dailyStayInvoice.findUnique({
        where: { id: invoiceId },
        include: { dailyStay: true },
      });
      if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
      
      const isOwner = ensureOwnerOrManager(req, res, invoice.dormitoryId);
      if (!isOwner) {
        const tenant = await ensureTenant(req, res, invoice.dormitoryId);
        if (!tenant || (invoice.dailyStay?.tenantId !== tenant.id)) {
          return res.status(403).json({ error: 'Forbidden' });
        }
      }

      const userId = (req as any).user?.id || (req as any).auth?.userId;
      const receipt = await receiptService.getFinalReceiptForDailyInvoice(invoice.dormitoryId, invoiceId, userId);
      if (!receipt) return res.status(404).json({ error: 'Final receipt not found' });
      
      res.json(receipt);
    } catch (err: any) {
      res.status(err.statusCode || 500).json({
        error: {
          code: err.errorCode || 'RECEIPT_NOT_FOUND',
          message: err instanceof AppError ? err.message : 'เกิดข้อผิดพลาดในการดึงข้อมูลใบเสร็จรับเงิน',
        },
      });
    }
  });

  return router;
}
