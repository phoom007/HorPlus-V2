import { Router, Request, Response } from 'express';
import { receiptService } from '../services/receipt.service.js';
import { AuthenticationService } from '../services/auth.service.js';
import { getPrismaClient } from '../db/prisma.js';
import { renderReceiptHtml } from '../utils/receipt-html.util.js';

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
    const tenant = await prisma.tenant.findFirst({ where: { linkedUserId: auth.userId, dormitoryId } });
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

  router.get('/:receiptId', requireAuth, async (req, res) => {
    try {
      const auth = (req as any).auth;
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
          if (receiptRecord.billId) {
            const bill = await prisma.bill.findUnique({ where: { id: receiptRecord.billId } });
            if (bill) {
              const tenantContracts = await prisma.contract.findMany({ where: { tenantId: tenant.id }, select: { id: true } });
              const tenantContractIds = tenantContracts.map(c => c.id);
              if (bill.tenantId === tenant.id || (bill.contractId && tenantContractIds.includes(bill.contractId))) {
                authorized = true;
              }
            }
          } else if (receiptRecord.paymentGroupId) {
            const targets = await prisma.combinedPaymentGroupBillTarget.findMany({
              where: { paymentGroupId: receiptRecord.paymentGroupId },
              include: { bill: true },
            });
            if (targets.some(t => t.bill.tenantId === tenant.id)) {
              authorized = true;
            }
          } else if (receiptRecord.dailyStayInvoiceId) {
            const dinv = await prisma.dailyStayInvoice.findUnique({
              where: { id: receiptRecord.dailyStayInvoiceId },
              include: { dailyStay: true },
            });
            if (dinv?.dailyStay?.tenantId === tenant.id) {
              authorized = true;
            }
          }
        }
      }

      if (!authorized) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const receipt = await receiptService.getReceipt(dormitoryId, receiptId);
      res.json(receipt);
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  const handleReceiptHtml = async (req: Request, res: Response) => {
    try {
      const auth = (req as any).auth;
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
          if (receiptRecord.billId) {
            const bill = await prisma.bill.findUnique({ where: { id: receiptRecord.billId } });
            if (bill) {
              const tenantContracts = await prisma.contract.findMany({ where: { tenantId: tenant.id }, select: { id: true } });
              const tenantContractIds = tenantContracts.map(c => c.id);
              if (bill.tenantId === tenant.id || (bill.contractId && tenantContractIds.includes(bill.contractId))) {
                authorized = true;
              }
            }
          } else if (receiptRecord.paymentGroupId) {
            const targets = await prisma.combinedPaymentGroupBillTarget.findMany({
              where: { paymentGroupId: receiptRecord.paymentGroupId },
              include: { bill: true },
            });
            if (targets.some(t => t.bill.tenantId === tenant.id)) {
              authorized = true;
            }
          } else if (receiptRecord.dailyStayInvoiceId) {
            const dinv = await prisma.dailyStayInvoice.findUnique({
              where: { id: receiptRecord.dailyStayInvoiceId },
              include: { dailyStay: true },
            });
            if (dinv?.dailyStay?.tenantId === tenant.id) {
              authorized = true;
            }
          }
        }
      }

      if (!authorized) {
        return res.status(403).send('Forbidden');
      }

      const html = renderReceiptHtml(receiptRecord);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (err: any) {
      res.status(400).send(err?.message || 'Error generating receipt HTML');
    }
  };

  router.get('/:receiptId/html', requireAuth, handleReceiptHtml);
  router.get('/:receiptId/print', requireAuth, handleReceiptHtml);

  return router;
}
