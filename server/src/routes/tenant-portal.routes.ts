import { Router, Request, Response } from 'express';
import { getPrismaClient } from '../db/prisma.js';
import { roomBillingStateService } from '../services/room-billing-state.service.js';
import { AuditService } from '../services/audit.service.js';
import { MaintenanceService } from '../services/maintenance.service.js';
import { AnnouncementService } from '../services/announcement.service.js';
import { DocumentPdfService } from '../services/document-pdf.service.js';
import { AuthenticationService } from '../services/auth.service.js';
import { SensitiveFieldService } from '../services/sensitive-field.service.js';
import { generatePromptPayPayload, maskPromptPayDisplay, generatePromptPayQrSvg } from '../services/promptpay-payload.service.js';

type TenantContextResult = {
  error?: undefined;
  tenant: any;
  dormitoryId: string;
  contract?: any;
  roomId?: string;
} | {
  error: { code: string; message: string; statusCode: number };
  tenant?: undefined;
  dormitoryId?: undefined;
  contract?: undefined;
  roomId?: undefined;
};

async function resolveTenantContext(req: Request): Promise<TenantContextResult> {
  const prisma = getPrismaClient();
  const userId = req.auth?.userId;
  if (!userId) {
    return { error: { code: 'UNAUTHORIZED', message: 'Not logged in', statusCode: 401 } };
  }

  const activeMemberships = await prisma.dormitoryMember.findMany({
    where: { userId, status: 'active' },
    include: { role: true }
  });

  const allMemberships = activeMemberships.length > 0 ? activeMemberships : await prisma.dormitoryMember.findMany({
    where: { userId },
    include: { role: true }
  });

  const membership = allMemberships.find(m => 
    !m.role || (m.role.code || '').toUpperCase() === 'TENANT'
  );

  if (!membership) {
    return { error: { code: 'FORBIDDEN', message: 'Not a tenant', statusCode: 403 } };
  }

  const tenant = await prisma.tenant.findFirst({
    where: { linkedUserId: userId, dormitoryId: membership.dormitoryId }
  });

  if (!tenant) {
    return { error: { code: 'FORBIDDEN', message: 'Tenant record not found', statusCode: 403 } };
  }

  const contract = await prisma.contract.findFirst({
    where: { tenantId: tenant.id, status: 'active' }
  });

  return {
    tenant,
    dormitoryId: membership.dormitoryId,
    contract: contract || null,
    roomId: contract?.roomId || undefined
  };
}

async function getTenantBillWhere(prisma: any, ctx: { dormitoryId: string; tenant: { id: string } }) {
  const contracts = await prisma.contract.findMany({
    where: { tenantId: ctx.tenant.id, dormitoryId: ctx.dormitoryId },
    select: { id: true }
  });
  const contractIds = contracts.map((c: any) => c.id);

  return {
    dormitoryId: ctx.dormitoryId,
    status: { not: 'cancelled' },
    OR: [
      { tenantId: ctx.tenant.id },
      ...(contractIds.length > 0 ? [{ contractId: { in: contractIds } }] : [])
    ]
  };
}

async function checkBillOwnership(prisma: any, billId: string, ctx: { dormitoryId: string; tenant: { id: string } }) {
  const bill = await prisma.bill.findUnique({
    where: { id: billId },
    include: {
      items: true,
      Payment: {
        include: { receipt: true },
        orderBy: { createdAt: 'desc' }
      }
    }
  });

  if (!bill || bill.dormitoryId !== ctx.dormitoryId || bill.status === 'cancelled') {
    return null;
  }

  const contracts = await prisma.contract.findMany({
    where: { tenantId: ctx.tenant.id, dormitoryId: ctx.dormitoryId },
    select: { id: true }
  });
  const contractIds = contracts.map((c: any) => c.id);

  const isOwned = bill.tenantId === ctx.tenant.id || (bill.contractId && contractIds.includes(bill.contractId));
  if (!isOwned) return null;

  return bill;
}

export function createTenantPortalRouter(authService?: AuthenticationService): Router {
  const router = Router();
  const prisma = getPrismaClient();

  const auditService = new AuditService();
  const maintenanceService = new MaintenanceService();
  const announcementService = new AnnouncementService();
  const sensitiveFieldService = new SensitiveFieldService(process.env.ENCRYPTION_KEY || 'default-secret-key-32-chars-01234');

  if (authService) {
    router.use(authService.requireAuth());
  }

  // 1. Tenant Profile & Room Members
  router.get('/profile', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message, requestId: req.requestId } });
      }

      const tenant = ctx.tenant;
      const contract = ctx.contract;
      const room = ctx.roomId ? await prisma.room.findUnique({ where: { id: ctx.roomId } }) : null;
      const dorm = await prisma.dormitory.findUnique({ where: { id: ctx.dormitoryId } });

      const phone = tenant.phone ? `${tenant.phone.slice(0, 3)}***${tenant.phone.slice(-4)}` : null;

      res.json({
        id: tenant.id,
        tenantNumber: tenant.tenantNumber,
        firstName: tenant.firstName,
        lastName: tenant.lastName,
        displayName: tenant.displayName,
        phone,
        email: tenant.email,
        status: tenant.status,
        pictureUrl: tenant.photoUrl || null,
        nationalIdMasked: tenant.nationalIdMasked || null,
        dormitory: dorm ? {
          id: dorm.id,
          name: dorm.name,
          logoUrl: (dorm as any).logoUrl || null
        } : null,
        room: room ? {
          id: room.id,
          roomNumber: room.roomNumber,
          roomType: room.roomType,
          buildingId: room.buildingId
        } : null,
        roomMembers: [],
        activeContract: contract ? {
          id: contract.id,
          contractNumber: contract.contractNumber,
          status: contract.status,
          startDate: contract.startDate.toISOString(),
          endDate: contract.endDate.toISOString(),
          roomNumber: room?.roomNumber || 'ไม่ระบุ',
          rentBillingType: contract.rentBillingType,
          rentAmount: contract.rentAmount.toString(),
          depositAmount: contract.depositAmount.toString(),
          advancePaymentAmount: contract.advancePaymentAmount.toString(),
          coOccupantsCount: 0
        } : null
      });
    } catch (err: any) {
      return res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId }
      });
    }
  });

  // 2. Tenant Contract
  router.get('/contract', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message, requestId: req.requestId } });
      }

      if (!ctx.contract) {
        return res.status(404).json({
          error: { code: 'TENANT_CONTRACT_NOT_FOUND', message: 'ไม่พบข้อมูลสัญญาเช่า', requestId: req.requestId }
        });
      }

      const room = ctx.roomId ? await prisma.room.findUnique({ where: { id: ctx.roomId } }) : null;

      return res.json({
        success: true,
        data: {
          id: ctx.contract.id,
          contractNumber: ctx.contract.contractNumber,
          status: ctx.contract.status,
          startDate: ctx.contract.startDate.toISOString(),
          endDate: ctx.contract.endDate.toISOString(),
          roomNumber: room?.roomNumber || 'ไม่ระบุ',
          rentBillingType: ctx.contract.rentBillingType,
          rentAmount: ctx.contract.rentAmount.toString(),
          depositAmount: ctx.contract.depositAmount.toString(),
          advancePaymentAmount: ctx.contract.advancePaymentAmount.toString(),
          coOccupantsCount: 0
        }
      });
    } catch (err: any) {
      return res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId }
      });
    }
  });

  // 3. Tenant Bills List
  router.get('/bills', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message, requestId: req.requestId } });
      }

      const billWhere = await getTenantBillWhere(prisma, ctx);
      const bills = await prisma.bill.findMany({
        where: billWhere,
        orderBy: { createdAt: 'desc' },
        include: {
          items: true,
          Payment: {
            include: { receipt: true },
            orderBy: { createdAt: 'desc' }
          }
        }
      });

      const formatted = bills.map((b) => {
        const mappedPayments = (b.Payment || []).map((p) => ({
          id: p.id,
          method: p.method,
          amount: p.amount.toString(),
          status: p.status,
          paymentDate: p.paymentDate.toISOString(),
          rejectedReason: p.rejectedReason || null,
          reversalReason: p.reversalReason || null,
          reviewedAt: p.reviewedAt ? p.reviewedAt.toISOString() : null,
          createdAt: p.createdAt.toISOString(),
          receipt: p.receipt ? {
            id: p.receipt.id,
            receiptNumber: p.receipt.receiptNumber,
            isVoided: p.receipt.isVoided
          } : null
        }));

        return {
          id: b.id,
          tenantId: b.tenantId || ctx.tenant.id,
          billNumber: b.billNumber,
          billingCycleId: b.billingCycleId,
          cycleId: b.billingCycleId,
          billingDate: b.billingDate.toISOString(),
          dueDate: b.dueDate ? b.dueDate.toISOString() : null,
          createdAt: b.createdAt.toISOString(),
          status: b.status,
          totalAmount: b.totalAmount.toString(),
          paidAmount: b.paidAmount.toString(),
          outstandingAmount: b.outstandingAmount.toString(),
          items: b.items.map((item: any) => ({
            id: item.id,
            type: item.itemType || item.type,
            description: item.description,
            amount: item.amount.toString(),
            meterStart: item.meterStart,
            meterEnd: item.meterEnd,
            unitUsed: item.unitUsed,
            unitPrice: item.unitPrice ? item.unitPrice.toString() : null
          })),
          payments: mappedPayments,
          Payment: mappedPayments
        };
      });

      return res.status(200).json({ data: formatted });
    } catch (err: any) {
      return res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId }
      });
    }
  });

  // 4. Tenant Bill Detail
  router.get('/bills/:billId', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message, requestId: req.requestId } });
      }

      const bill = await checkBillOwnership(prisma, req.params.billId, ctx);
      if (!bill) {
        return res.status(404).json({
          error: { code: 'TENANT_BILL_NOT_FOUND', message: 'ไม่พบรายการบิลนี้', requestId: req.requestId }
        });
      }

      const room = bill.roomId ? await prisma.room.findUnique({ where: { id: bill.roomId } }) : null;

      const mappedPayments = (bill.Payment || []).map((p: any) => ({
        id: p.id,
        method: p.method,
        amount: p.amount.toString(),
        status: p.status,
        paymentDate: p.paymentDate.toISOString(),
        rejectedReason: p.rejectedReason || null,
        reversalReason: p.reversalReason || null,
        reviewedAt: p.reviewedAt ? p.reviewedAt.toISOString() : null,
        createdAt: p.createdAt.toISOString(),
        receipt: p.receipt ? {
          id: p.receipt.id,
          receiptNumber: p.receipt.receiptNumber,
          isVoided: p.receipt.isVoided
        } : null
      }));

      return res.json({
        success: true,
        data: {
          id: bill.id,
          tenantId: bill.tenantId,
          billNumber: bill.billNumber,
          billingDate: bill.billingDate.toISOString(),
          dueDate: bill.dueDate ? bill.dueDate.toISOString() : null,
          status: bill.status,
          totalAmount: bill.totalAmount.toString(),
          paidAmount: bill.paidAmount.toString(),
          outstandingAmount: bill.outstandingAmount.toString(),
          roomNumber: room?.roomNumber || 'ไม่ระบุ',
          items: bill.items.map((it: any) => ({
            id: it.id,
            itemType: it.type || it.itemType || 'other',
            description: it.description,
            amount: it.amount.toString(),
            quantity: it.quantity
          })),
          payments: mappedPayments,
          Payment: mappedPayments
        }
      });
    } catch (err: any) {
      return res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId }
      });
    }
  });

  // 5. Tenant Payment Options (Safe DTO without raw PromptPay identifier)
  router.get('/payment-options/:billId/qr', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message, requestId: req.requestId } });
      }

      const bill = await checkBillOwnership(prisma, req.params.billId, ctx);
      if (!bill) {
        return res.status(404).json({ error: { code: 'TENANT_BILL_NOT_FOUND', message: 'ไม่พบรายการบิลนี้', requestId: req.requestId } });
      }

      const settings = await prisma.dormitoryBillingSettings.findUnique({
        where: { dormitoryId: ctx.dormitoryId }
      });

      if (!settings || !settings.promptPayValueEncrypted) {
        return res.status(404).json({ error: { code: 'PROMPTPAY_NOT_CONFIGURED', message: 'ไม่ได้ตั้งค่า PromptPay', requestId: req.requestId } });
      }

      let rawPromptPay: string;
      try {
        rawPromptPay = sensitiveFieldService.decrypt(settings.promptPayValueEncrypted);
      } catch (err) {
        console.error('[TenantPortal] PromptPay decryption failed for QR endpoint:', err);
        return res.status(500).json({ error: { code: 'PAYMENT_METHOD_CONFIGURATION_ERROR', message: 'เกิดข้อผิดพลาดในการอ่านข้อมูล PromptPay', requestId: req.requestId } });
      }

      const svg = await generatePromptPayQrSvg(rawPromptPay, bill.totalAmount.toString());
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
      return res.status(200).send(svg);
    } catch (err: any) {
      return res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId }
      });
    }
  });

  router.get('/payment-options/:billId?', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message, requestId: req.requestId } });
      }

      let targetAmount = '0.00';
      let targetBillId = '';

      if (req.params.billId) {
        const bill = await checkBillOwnership(prisma, req.params.billId, ctx);
        if (!bill) {
          return res.status(404).json({ error: { code: 'TENANT_BILL_NOT_FOUND', message: 'ไม่พบรายการบิลนี้', requestId: req.requestId } });
        }
        targetAmount = bill.totalAmount.toString();
        targetBillId = bill.id;
      } else {
        const billWhere = await getTenantBillWhere(prisma, ctx);
        const bill = await prisma.bill.findFirst({
          where: {
            ...billWhere,
            status: { in: ['ISSUED', 'ISSUED_OVERDUE', 'REJECTED', 'issued', 'pending', 'overdue', 'rejected'] }
          },
          orderBy: { createdAt: 'desc' }
        });
        if (bill) {
          targetAmount = bill.totalAmount.toString();
          targetBillId = bill.id;
        }
      }

      const settings = await prisma.dormitoryBillingSettings.findUnique({
        where: { dormitoryId: ctx.dormitoryId }
      });

      if (!settings) {
        return res.json({
          success: true,
          data: {
            promptPayConfigured: false,
            bankTransferConfigured: false,
            configured: false,
            targetAmount,
            paymentMethod: 'PROMPTPAY',
            qrUrl: null
          }
        });
      }

      let rawPromptPay: string | null = null;
      let decryptionError = false;

      if (settings.promptPayValueEncrypted) {
        try {
          rawPromptPay = sensitiveFieldService.decrypt(settings.promptPayValueEncrypted);
        } catch (err) {
          console.error('[TenantPortal] PromptPay decryption failed:', err);
          decryptionError = true;
        }
      }

      const promptPayConfigured = Boolean(rawPromptPay && !decryptionError);
      const bankTransferConfigured = Boolean(settings.bankAccountNumber);
      const isConfigured = promptPayConfigured || bankTransferConfigured;

      return res.json({
        success: true,
        data: {
          configured: isConfigured,
          promptPayConfigured,
          bankTransferConfigured,
          ...(decryptionError ? { errorCode: 'PAYMENT_METHOD_CONFIGURATION_ERROR' } : {}),
          targetAmount,
          paymentMethod: 'PROMPTPAY',
          promptPayType: settings.promptPayType || 'NATID',
          promptPayDisplay: promptPayConfigured ? maskPromptPayDisplay(rawPromptPay!, settings.promptPayType) : null,
          qrUrl: (promptPayConfigured && targetBillId) ? `/api/v1/tenant-portal/payment-options/${targetBillId}/qr` : null,
          bankCode: settings.bankCode || null,
          bankAccountName: settings.bankAccountName || null,
          bankAccountNumber: settings.bankAccountNumber || null
        }
      });
    } catch (err: any) {
      return res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId }
      });
    }
  });

  // 6. Tenant Payment History List
  router.get('/payments', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message, requestId: req.requestId } });
      }

      const billWhere = await getTenantBillWhere(prisma, ctx);
      const payments = await prisma.payment.findMany({
        where: {
          dormitoryId: ctx.dormitoryId,
          OR: [
            { tenantId: ctx.tenant.id },
            { bill: billWhere }
          ]
        },
        orderBy: { createdAt: 'desc' },
        include: {
          bill: { select: { id: true, billNumber: true, totalAmount: true } },
          receipt: { select: { id: true, receiptNumber: true, isVoided: true, voidReason: true } }
        }
      });

      const formatted = payments.map((p) => ({
        id: p.id,
        billId: p.billId,
        billNumber: p.bill?.billNumber || 'ไม่ระบุ',
        method: p.method,
        amount: p.amount.toString(),
        status: p.status,
        paymentDate: p.paymentDate.toISOString(),
        rejectedReason: p.rejectedReason || null,
        reversalReason: p.reversalReason || null,
        reviewedAt: p.reviewedAt ? p.reviewedAt.toISOString() : null,
        createdAt: p.createdAt.toISOString(),
        receipt: p.receipt ? {
          id: p.receipt.id,
          receiptNumber: p.receipt.receiptNumber,
          isVoided: p.receipt.isVoided,
          voidReason: p.receipt.voidReason || null
        } : null
      }));

      return res.json({ success: true, data: formatted });
    } catch (err: any) {
      return res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId }
      });
    }
  });

  // 7. Tenant Receipts List
  router.get('/receipts', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message, requestId: req.requestId } });
      }

      const billWhere = await getTenantBillWhere(prisma, ctx);
      const receipts = await prisma.receipt.findMany({
        where: {
          dormitoryId: ctx.dormitoryId,
          bill: billWhere
        },
        orderBy: { createdAt: 'desc' },
        include: {
          bill: { select: { id: true, billNumber: true, totalAmount: true } }
        }
      });

      const formatted = receipts.map((r) => ({
        id: r.id,
        receiptNumber: r.receiptNumber,
        billId: r.billId,
        billNumber: r.bill?.billNumber || 'ไม่ระบุ',
        totalAmount: r.bill?.totalAmount ? r.bill.totalAmount.toString() : '0.00',
        isVoided: r.isVoided,
        voidedAt: r.voidedAt ? r.voidedAt.toISOString() : null,
        voidReason: r.voidReason || null,
        createdAt: r.createdAt.toISOString()
      }));

      return res.json({ success: true, data: formatted });
    } catch (err: any) {
      return res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId }
      });
    }
  });

  // 8. Tenant Dashboard Summary
  router.get('/dashboard', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message, requestId: req.requestId } });
      }

      const billingState = ctx.roomId
        ? await roomBillingStateService.getRoomBillingState(ctx.dormitoryId, ctx.roomId)
        : { state: 'no_bill' as const, outstandingAmount: '0.00', statusText: 'ไม่มีรายการค้างชำระ' };

      const room = ctx.roomId ? await prisma.room.findUnique({ where: { id: ctx.roomId } }) : null;

      const billWhere = await getTenantBillWhere(prisma, ctx);
      const latestReceipt = await prisma.receipt.findFirst({
        where: {
          dormitoryId: ctx.dormitoryId,
          bill: billWhere
        },
        orderBy: { createdAt: 'desc' }
      });

      return res.json({
        success: true,
        data: {
          roomNumber: room?.roomNumber || 'ไม่ระบุ',
          contractStatus: ctx.contract?.status || 'active',
          billingState: billingState.state,
          currentBillId: billingState.currentBillId || null,
          billNumber: billingState.billNumber || null,
          outstandingAmount: billingState.outstandingAmount,
          statusText: billingState.statusText,
          dueDate: billingState.dueDate ? billingState.dueDate.toISOString() : null,
          latestReceiptNumber: latestReceipt?.receiptNumber || null
        }
      });
    } catch (err: any) {
      return res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId }
      });
    }
  });

  // 9. Tenant Maintenance Routes
  router.get('/maintenance', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message, requestId: req.requestId } });
      }

      const requests = await maintenanceService.getTenantRequests(ctx.dormitoryId, ctx.tenant.id);
      return res.json({ success: true, data: requests });
    } catch (err: any) {
      return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId } });
    }
  });

  router.post('/maintenance', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message, requestId: req.requestId } });
      }

      const { category, title, description, priority, preferredDate, preferredTimeRange } = req.body;

      if (!category || !title || !description) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Category, title, and description are required', requestId: req.requestId } });
      }

      if (!ctx.roomId) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Room context missing for tenant', requestId: req.requestId } });
      }

      const request = await maintenanceService.createRequestByTenant({
        dormitoryId: ctx.dormitoryId,
        tenantId: ctx.tenant.id,
        contractId: ctx.contract?.id || undefined,
        roomId: ctx.roomId,
        category,
        title,
        description,
        priority,
        preferredDate,
        preferredTimeRange
      });

      return res.status(201).json({ success: true, data: request });
    } catch (err: any) {
      return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId } });
    }
  });

  router.get('/maintenance/:requestId', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message, requestId: req.requestId } });
      }

      const detail = await maintenanceService.getTenantRequestById(ctx.dormitoryId, ctx.tenant.id, req.params.requestId);

      if (!detail) {
        return res.status(404).json({ error: { code: 'RESOURCE_NOT_FOUND', message: 'ไม่พบรายการแจ้งซ่อมนี้', requestId: req.requestId } });
      }

      return res.json({ success: true, data: detail });
    } catch (err: any) {
      return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId } });
    }
  });

  router.post('/maintenance/:requestId/comments', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message, requestId: req.requestId } });
      }

      const { message } = req.body;
      if (!message) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Message is required', requestId: req.requestId } });
      }

      const senderName = `${ctx.tenant.firstName} ${ctx.tenant.lastName}`.trim() || 'ผู้เช่า';

      const comment = await maintenanceService.addComment(ctx.dormitoryId, req.params.requestId, {
        senderType: 'tenant',
        senderTenantId: ctx.tenant.id,
        senderName,
        message,
        visibility: 'tenant_visible'
      });

      return res.status(201).json({ success: true, data: comment });
    } catch (err: any) {
      return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId } });
    }
  });

  router.post('/maintenance/:requestId/cancel', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message, requestId: req.requestId } });
      }

      const { reason } = req.body;
      const cancelled = await maintenanceService.cancelByTenant(ctx.dormitoryId, ctx.tenant.id, req.params.requestId, reason);
      return res.json({ success: true, data: cancelled });
    } catch (err: any) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: err.message, requestId: req.requestId } });
    }
  });

  // 10. Tenant Announcement Routes
  router.get('/announcements', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message, requestId: req.requestId } });
      }

      const list = await announcementService.getTenantAnnouncements(ctx.dormitoryId, ctx.tenant.id);
      return res.json({ success: true, data: list });
    } catch (err: any) {
      return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId } });
    }
  });

  router.get('/announcements/:id', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message, requestId: req.requestId } });
      }

      const announcement = await announcementService.getTenantAnnouncementById(ctx.dormitoryId, ctx.tenant.id, req.params.id);

      if (!announcement) {
        return res.status(404).json({ error: { code: 'RESOURCE_NOT_FOUND', message: 'ไม่พบประกาศนี้', requestId: req.requestId } });
      }

      return res.json({ success: true, data: announcement });
    } catch (err: any) {
      return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId } });
    }
  });

  router.post('/announcements/:id/read', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message, requestId: req.requestId } });
      }

      const result = await announcementService.markAsReadByTenant(ctx.dormitoryId, req.params.id, ctx.tenant.id);
      return res.json({ success: true, data: result });
    } catch (err: any) {
      return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId } });
    }
  });

  router.post('/announcements/read-all', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message, requestId: req.requestId } });
      }

      const count = await announcementService.markAllAsReadByTenant(ctx.dormitoryId, ctx.tenant.id);
      return res.json({ success: true, data: { markedCount: count } });
    } catch (err: any) {
      return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId } });
    }
  });

  // Tenant Contract PDF Download
  router.get('/contract/pdf', async (req: Request, res: Response) => {
    try {
      const ctx = await resolveTenantContext(req);
      if (ctx.error) {
        return res.status(ctx.error.statusCode).json({ error: { code: ctx.error.code, message: ctx.error.message, requestId: req.requestId } });
      }

      if (!ctx.contract) {
        return res.status(404).json({
          error: { code: 'TENANT_CONTRACT_NOT_FOUND', message: 'ไม่พบสัญญาเช่าของคุณ', requestId: req.requestId }
        });
      }

      const dorm = await prisma.dormitory.findUnique({ where: { id: ctx.dormitoryId } });
      const room = ctx.roomId ? await prisma.room.findUnique({ where: { id: ctx.roomId }, include: { building: true } }) : null;
      const snapshot = await prisma.contractSnapshot.findFirst({
        where: { contractId: ctx.contract.id, dormitoryId: ctx.dormitoryId },
      });
      const billSettings = await prisma.dormitoryBillingSettings.findUnique({ where: { dormitoryId: ctx.dormitoryId } });

      const resolvedRoomNumber = snapshot?.exactRoomNumber || room?.roomNumber || 'ไม่ระบุ';
      const buildingName = room?.building?.name || undefined;

      const waterVal = snapshot?.resolvedWaterRate !== undefined
        ? snapshot.resolvedWaterRate
        : billSettings?.waterRate !== undefined
          ? billSettings.waterRate
          : null;
      const waterRateStr = waterVal !== null ? Number(waterVal).toFixed(2) : 'ไม่ระบุ';

      const elecVal = snapshot?.resolvedElectricityRate !== undefined
        ? snapshot.resolvedElectricityRate
        : billSettings?.electricityRate !== undefined
          ? billSettings.electricityRate
          : null;
      const electricityRateStr = elecVal !== null ? Number(elecVal).toFixed(2) : 'ไม่ระบุ';

      const commonVal = snapshot?.resolvedCommonFee !== undefined && snapshot?.resolvedCommonFee !== null
        ? snapshot.resolvedCommonFee
        : billSettings?.commonFee !== undefined && billSettings?.commonFee !== null
          ? billSettings.commonFee
          : 0;
      const commonFeeStr = Number(commonVal).toFixed(2);

      const billingDayVal = billSettings?.billingDay !== undefined ? billSettings.billingDay : 1;
      const dueDayVal = billSettings?.dueDay !== undefined ? billSettings.dueDay : 1;

      const pdfService = new DocumentPdfService();
      const pdfBuffer = await pdfService.generateContractPdf({
        contractNumber: ctx.contract.contractNumber,
        dormitoryName: dorm?.name || 'หอพัก',
        dormitoryAddress: dorm?.addressLine1 || undefined,
        dormitoryPhone: dorm?.phone || undefined,
        ownerName: dorm?.name || 'เจ้าของหอพัก',
        tenantName: ctx.tenant.displayName || `${ctx.tenant.firstName} ${ctx.tenant.lastName}`.trim(),
        tenantPhone: ctx.tenant.phone,
        buildingName,
        roomNumber: resolvedRoomNumber,
        rentBillingType: ctx.contract.rentBillingType === 'term' ? 'term' : 'monthly',
        startDate: ctx.contract.startDate.toISOString().split('T')[0],
        endDate: ctx.contract.endDate.toISOString().split('T')[0],
        rentAmount: Number(ctx.contract.rentAmount).toFixed(2),
        depositAmount: Number(ctx.contract.depositAmount).toFixed(2),
        waterRate: waterRateStr,
        electricityRate: electricityRateStr,
        commonFee: commonFeeStr,
        billingDay: billingDayVal,
        dueDay: dueDayVal,
        terms: ctx.contract.terms || undefined,
        createdAt: ctx.contract.createdAt ? ctx.contract.createdAt.toISOString().split('T')[0] : undefined,
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="Contract-${ctx.contract.contractNumber}.pdf"`);
      return res.send(pdfBuffer);
    } catch (err: any) {
      return res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId }
      });
    }
  });

  return router;
}
