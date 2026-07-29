import { Router, Request, Response } from 'express';
import { prisma } from '../db/prisma.js';
import { requireTenantLineSession } from '../middleware/unified-actor.middleware.js';
import { roomBillingStateService } from '../services/room-billing-state.service.js';
import { PaymentService } from '../services/payment.service.js';
import { InMemoryPaymentRepository } from '../db/repositories/payment.repository.js';
import { InMemoryBillRepository } from '../db/repositories/bill.repository.js';
import { InMemoryPaymentEvidenceStorage } from '../services/storage-provider.service.js';
import { MockSlipVerificationProvider } from '../services/slip-verifier.service.js';
import { ReceiptGenerationService } from '../services/receipt.service.js';
import { InMemoryReceiptRepository } from '../db/repositories/receipt.repository.js';
import { AuditService } from '../services/audit.service.js';
import { MaintenanceService } from '../services/maintenance.service.ts';
import { AnnouncementService } from '../services/announcement.service.ts';

export function createTenantPortalRouter(): Router {
  const router = Router();

  const auditService = new AuditService();
  const paymentRepo = new InMemoryPaymentRepository();
  const billRepo = new InMemoryBillRepository();
  const receiptRepo = new InMemoryReceiptRepository();
  const storageProvider = new InMemoryPaymentEvidenceStorage();
  const verificationProvider = new MockSlipVerificationProvider();
  const receiptService = new ReceiptGenerationService(receiptRepo, auditService);

  const paymentService = new PaymentService(
    paymentRepo,
    billRepo,
    storageProvider,
    verificationProvider,
    receiptService,
    auditService
  );

  const maintenanceService = new MaintenanceService();
  const announcementService = new AnnouncementService();

  router.use(requireTenantLineSession());

  // 1. Tenant Profile & Room Members
  router.get('/profile', async (req: Request, res: Response) => {
    try {
      const actor = req.actor!;
      const tenant = await prisma.tenant.findUnique({
        where: { id: actor.tenantId! }
      });

      if (!tenant) {
        return res.status(404).json({
          error: {
            code: 'TENANT_NOT_FOUND',
            message: 'ไม่พบข้อมูลผู้เช่า',
            requestId: req.requestId
          }
        });
      }

      const room = actor.roomId ? await prisma.room.findUnique({ where: { id: actor.roomId } }) : null;
      const dorm = await prisma.dormitory.findUnique({ where: { id: actor.dormitoryId } });
      const contract = actor.contractId ? await prisma.contract.findUnique({ where: { id: actor.contractId } }) : null;

      // Room members under same contract/room
      const tenantBindings = await prisma.tenantLineBinding.findMany({
        where: {
          dormitoryId: actor.dormitoryId,
          roomId: actor.roomId || undefined,
          status: 'active'
        },
        include: { identity: true }
      });

      const roomMembers = tenantBindings.map((tb) => ({
        displayName: tb.identity?.displayName || 'สมาชิกในห้อง',
        pictureUrl: tb.identity?.pictureUrl || null,
        memberType: tb.tenantId === actor.tenantId ? 'ผู้เช่าหลัก' : 'ผู้พักร่วม'
      }));

      // Mask sensitive phone
      const phone = tenant.phone ? `${tenant.phone.slice(0, 3)}***${tenant.phone.slice(-4)}` : null;

      return res.json({
        success: true,
        data: {
          id: tenant.id,
          displayName: actor.displayName || `${tenant.firstName} ${tenant.lastName}`,
          pictureUrl: actor.pictureUrl || null,
          firstName: tenant.firstName,
          lastName: tenant.lastName,
          maskedPhone: phone,
          roomNumber: room?.number || 'ไม่ระบุ',
          dormitoryName: dorm?.name || 'หอพัก',
          status: tenant.status,
          startDate: contract?.startDate ? contract.startDate.toISOString() : null,
          endDate: contract?.endDate ? contract.endDate.toISOString() : null,
          roomMembers
        }
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
      const actor = req.actor!;
      if (!actor.contractId) {
        return res.status(404).json({
          error: { code: 'TENANT_CONTRACT_NOT_FOUND', message: 'ไม่พบข้อมูลสัญญาเช่า', requestId: req.requestId }
        });
      }

      const contract = await prisma.contract.findUnique({
        where: { id: actor.contractId }
      });

      if (!contract || contract.dormitoryId !== actor.dormitoryId) {
        return res.status(404).json({
          error: { code: 'TENANT_CONTRACT_NOT_FOUND', message: 'ไม่พบข้อมูลสัญญาเช่า', requestId: req.requestId }
        });
      }

      const room = await prisma.room.findUnique({ where: { id: contract.roomId } });

      return res.json({
        success: true,
        data: {
          id: contract.id,
          contractNumber: contract.contractNumber,
          status: contract.status,
          startDate: contract.startDate.toISOString(),
          endDate: contract.endDate.toISOString(),
          roomNumber: room?.number || 'ไม่ระบุ',
          rentBillingType: contract.rentBillingType,
          rentAmount: contract.rentAmount.toString(),
          depositAmount: contract.depositAmount.toString(),
          advancePaymentAmount: contract.advancePaymentAmount.toString(),
          coOccupantsCount: contract.coOccupantCount
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
      const actor = req.actor!;
      const bills = await prisma.bill.findMany({
        where: {
          dormitoryId: actor.dormitoryId,
          OR: [
            { roomId: actor.roomId || undefined },
            { tenantId: actor.tenantId || undefined },
            { contractId: actor.contractId || undefined }
          ],
          status: { not: 'cancelled' }
        },
        orderBy: { createdAt: 'desc' }
      });

      const formatted = bills.map((b) => ({
        id: b.id,
        billNumber: b.billNumber,
        billingCycleId: b.billingCycleId,
        billingDate: b.billingDate.toISOString(),
        dueDate: b.dueDate ? b.dueDate.toISOString() : null,
        status: b.status,
        totalAmount: b.totalAmount.toString(),
        paidAmount: b.paidAmount.toString(),
        outstandingAmount: b.outstandingAmount.toString()
      }));

      return res.json({ success: true, data: formatted });
    } catch (err: any) {
      return res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId }
      });
    }
  });

  // 4. Tenant Bill Detail
  router.get('/bills/:billId', async (req: Request, res: Response) => {
    try {
      const actor = req.actor!;
      const bill = await prisma.bill.findUnique({
        where: { id: req.params.billId },
        include: { items: true }
      });

      if (!bill || bill.dormitoryId !== actor.dormitoryId || (bill.roomId !== actor.roomId && bill.tenantId !== actor.tenantId)) {
        return res.status(404).json({
          error: { code: 'TENANT_BILL_NOT_FOUND', message: 'ไม่พบรายการบิลนี้', requestId: req.requestId }
        });
      }

      const room = bill.roomId ? await prisma.room.findUnique({ where: { id: bill.roomId } }) : null;

      return res.json({
        success: true,
        data: {
          id: bill.id,
          billNumber: bill.billNumber,
          billingDate: bill.billingDate.toISOString(),
          dueDate: bill.dueDate ? bill.dueDate.toISOString() : null,
          status: bill.status,
          totalAmount: bill.totalAmount.toString(),
          paidAmount: bill.paidAmount.toString(),
          outstandingAmount: bill.outstandingAmount.toString(),
          roomNumber: room?.number || 'ไม่ระบุ',
          items: bill.items.map((it) => ({
            id: it.id,
            itemType: it.itemType,
            description: it.description,
            amount: it.amount.toString(),
            quantity: it.quantity
          }))
        }
      });
    } catch (err: any) {
      return res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId }
      });
    }
  });

  // 5. Tenant Dashboard Summary
  router.get('/dashboard', async (req: Request, res: Response) => {
    try {
      const actor = req.actor!;

      const billingState = actor.roomId
        ? await roomBillingStateService.getRoomBillingState(actor.dormitoryId, actor.roomId)
        : { state: 'no_bill' as const, outstandingAmount: '0.00', statusText: 'ไม่มีรายการค้างชำระ' };

      const contract = actor.contractId ? await prisma.contract.findUnique({ where: { id: actor.contractId } }) : null;
      const room = actor.roomId ? await prisma.room.findUnique({ where: { id: actor.roomId } }) : null;

      // Latest receipt
      const latestReceipt = await prisma.receipt.findFirst({
        where: {
          dormitoryId: actor.dormitoryId,
          OR: [{ roomId: actor.roomId || undefined }, { tenantId: actor.tenantId || undefined }]
        },
        orderBy: { issuedAt: 'desc' }
      });

      return res.json({
        success: true,
        data: {
          roomNumber: room?.number || 'ไม่ระบุ',
          contractStatus: contract?.status || 'active',
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

  // 6. Tenant Payment Options
  router.get('/bills/:billId/payment-options', async (req: Request, res: Response) => {
    try {
      const actor = req.actor!;
      const bill = await prisma.bill.findUnique({ where: { id: req.params.billId } });

      if (!bill || bill.dormitoryId !== actor.dormitoryId || (bill.roomId !== actor.roomId && bill.tenantId !== actor.tenantId)) {
        return res.status(404).json({
          error: { code: 'TENANT_BILL_NOT_FOUND', message: 'ไม่พบรายการบิลนี้', requestId: req.requestId }
        });
      }

      return res.json({
        success: true,
        data: {
          cashAccepted: true,
          bankName: 'ธนาคารกสิกรไทย',
          bankAccountName: 'หอพักสุขสบาย (บัญชีชำระเงิน)',
          bankAccountNumberMasked: 'xxx-x-x1234-x',
          promptPayMasked: '081-xxx-5678',
          outstandingAmount: bill.outstandingAmount.toString(),
          currency: 'THB',
          evidenceRequired: true
        }
      });
    } catch (err: any) {
      return res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId }
      });
    }
  });

  // 7. Tenant Upload Intent
  router.post('/payment-evidence/upload-intents', async (req: Request, res: Response) => {
    try {
      const actor = req.actor!;
      const { fileName, fileSize, fileType, billId } = req.body;

      if (!billId) {
        return res.status(400).json({
          error: { code: 'INVALID_INPUT', message: 'กรุณาระบุ billId', requestId: req.requestId }
        });
      }

      const bill = await prisma.bill.findUnique({ where: { id: billId } });
      if (!bill || bill.dormitoryId !== actor.dormitoryId || (bill.roomId !== actor.roomId && bill.tenantId !== actor.tenantId)) {
        return res.status(404).json({
          error: { code: 'TENANT_BILL_NOT_FOUND', message: 'ไม่พบรายการบิลนี้', requestId: req.requestId }
        });
      }

      const uploadIntentId = `upl_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const storagePath = `payments/${actor.dormitoryId}/${billId}/${uploadIntentId}_${fileName || 'slip.jpg'}`;

      return res.json({
        success: true,
        data: {
          uploadIntentId,
          storagePath,
          uploadUrl: `/api/v1/tenant/payment-evidence/mock-upload?path=${encodeURIComponent(storagePath)}`,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString()
        }
      });
    } catch (err: any) {
      return res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId }
      });
    }
  });

  // 8. Tenant Confirm Evidence
  router.post('/payment-evidence/confirm', async (req: Request, res: Response) => {
    try {
      const actor = req.actor!;
      const { uploadIntentId, storagePath } = req.body;

      if (!uploadIntentId || !storagePath) {
        return res.status(400).json({
          error: { code: 'INVALID_INPUT', message: 'ข้อมูลการยืนยันหลักฐานไม่ครบถ้วน', requestId: req.requestId }
        });
      }

      const evidence = await prisma.paymentEvidence.create({
        data: {
          dormitoryId: actor.dormitoryId,
          storageBucket: 'horplus-payment-evidence',
          storagePath,
          fileName: storagePath.split('/').pop() || 'slip.jpg',
          fileSizeBytes: 102400,
          mimeType: 'image/jpeg',
          checksumSha256: `sha256_${Date.now()}`
        }
      });

      return res.json({
        success: true,
        data: {
          evidenceId: evidence.id,
          storagePath: evidence.storagePath
        }
      });
    } catch (err: any) {
      return res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId }
      });
    }
  });

  // 9. Tenant Payment Submission
  router.post('/bills/:billId/payments', async (req: Request, res: Response) => {
    try {
      const actor = req.actor!;
      const { billId } = req.params;
      const { evidenceId, paidAt, transactionReference } = req.body;

      const bill = await prisma.bill.findUnique({ where: { id: billId } });
      if (!bill || bill.dormitoryId !== actor.dormitoryId || (bill.roomId !== actor.roomId && bill.tenantId !== actor.tenantId)) {
        return res.status(404).json({
          error: { code: 'TENANT_BILL_NOT_FOUND', message: 'ไม่พบรายการบิลนี้', requestId: req.requestId }
        });
      }

      if (bill.status === 'paid' || parseFloat(bill.outstandingAmount.toString()) <= 0) {
        return res.status(400).json({
          error: { code: 'BILL_ALREADY_PAID', message: 'บิลนี้ชำระเงินเรียบร้อยแล้ว', requestId: req.requestId }
        });
      }

      if (!evidenceId) {
        return res.status(400).json({
          error: { code: 'PAYMENT_EVIDENCE_REQUIRED', message: 'กรุณาแนบหลักฐานการชำระเงิน', requestId: req.requestId }
        });
      }

      const result = await paymentService.submitPayment(actor.dormitoryId, {
        billId,
        method: 'bank_transfer',
        channel: 'tenant_portal',
        amount: bill.outstandingAmount.toString(),
        evidenceId,
        transactionReference,
        submittedByTenantId: actor.tenantId,
        paidAt: paidAt ? new Date(paidAt) : new Date()
      }, req.requestId);

      // NO AUTOMATIC LINE NOTIFICATION IS SENT HERE per TASK 016 rule.

      return res.status(201).json({
        success: true,
        data: {
          paymentId: result.payment.id,
          paymentNumber: result.payment.paymentNumber,
          status: result.payment.status,
          amount: result.payment.amount,
          message: 'ส่งหลักฐานการชำระเงินสำเร็จแล้ว รอผู้ดูแลหอพักตรวจสอบ'
        }
      });
    } catch (err: any) {
      return res.status(400).json({
        error: { code: err.message?.startsWith('RESOURCE_') ? 'RESOURCE_NOT_FOUND' : 'INVALID_PAYMENT', message: err.message, requestId: req.requestId }
      });
    }
  });

  // 10. Tenant Payments History
  router.get('/payments', async (req: Request, res: Response) => {
    try {
      const actor = req.actor!;
      const payments = await prisma.payment.findMany({
        where: {
          dormitoryId: actor.dormitoryId,
          OR: [
            { contractId: actor.contractId || undefined },
            { submittedByTenantId: actor.tenantId || undefined }
          ]
        },
        orderBy: { createdAt: 'desc' }
      });

      const formatted = payments.map((p) => ({
        id: p.id,
        paymentNumber: p.paymentNumber,
        billId: p.billId,
        method: p.method,
        status: p.status,
        amount: p.amount.toString(),
        paidAt: p.paidAt ? p.paidAt.toISOString() : null,
        createdAt: p.createdAt.toISOString()
      }));

      return res.json({ success: true, data: formatted });
    } catch (err: any) {
      return res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId }
      });
    }
  });

  // 11. Tenant Payment Detail
  router.get('/payments/:paymentId', async (req: Request, res: Response) => {
    try {
      const actor = req.actor!;
      const payment = await prisma.payment.findUnique({
        where: { id: req.params.paymentId }
      });

      if (!payment || payment.dormitoryId !== actor.dormitoryId) {
        return res.status(404).json({
          error: { code: 'TENANT_PAYMENT_NOT_FOUND', message: 'ไม่พบรายการชำระเงินนี้', requestId: req.requestId }
        });
      }

      const review = await prisma.paymentReview.findFirst({
        where: { paymentId: payment.id, status: 'rejected' },
        orderBy: { reviewedAt: 'desc' }
      });

      return res.json({
        success: true,
        data: {
          id: payment.id,
          paymentNumber: payment.paymentNumber,
          billId: payment.billId,
          status: payment.status,
          amount: payment.amount.toString(),
          method: payment.method,
          paidAt: payment.paidAt ? payment.paidAt.toISOString() : null,
          rejectReason: review?.note || null
        }
      });
    } catch (err: any) {
      return res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId }
      });
    }
  });

  // 12. Tenant Receipts List
  router.get('/receipts', async (req: Request, res: Response) => {
    try {
      const actor = req.actor!;
      const receipts = await prisma.receipt.findMany({
        where: {
          dormitoryId: actor.dormitoryId,
          OR: [{ roomId: actor.roomId || undefined }, { tenantId: actor.tenantId || undefined }]
        },
        orderBy: { issuedAt: 'desc' }
      });

      const formatted = receipts.map((r) => ({
        id: r.id,
        receiptNumber: r.receiptNumber,
        issuedAt: r.issuedAt.toISOString(),
        totalAmount: r.totalAmount.toString(),
        paymentMethod: r.paymentMethod
      }));

      return res.json({ success: true, data: formatted });
    } catch (err: any) {
      return res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId }
      });
    }
  });

  // 13. Tenant Receipt Detail
  router.get('/receipts/:receiptId', async (req: Request, res: Response) => {
    try {
      const actor = req.actor!;
      const receipt = await prisma.receipt.findUnique({
        where: { id: req.params.receiptId },
        include: { items: true }
      });

      if (!receipt || receipt.dormitoryId !== actor.dormitoryId || (receipt.roomId !== actor.roomId && receipt.tenantId !== actor.tenantId)) {
        return res.status(404).json({
          error: { code: 'TENANT_RECEIPT_NOT_FOUND', message: 'ไม่พบใบเสร็จนี้', requestId: req.requestId }
        });
      }

      return res.json({
        success: true,
        data: {
          id: receipt.id,
          receiptNumber: receipt.receiptNumber,
          issuedAt: receipt.issuedAt.toISOString(),
          totalAmount: receipt.totalAmount.toString(),
          paymentMethod: receipt.paymentMethod,
          payerName: receipt.payerName,
          items: receipt.items.map((it) => ({
            id: it.id,
            description: it.description,
            amount: it.amount.toString()
          }))
        }
      });
    } catch (err: any) {
      return res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId }
      });
    }
  });

  // 14. Tenant Receipt Print Data
  router.get('/receipts/:receiptId/print-data', async (req: Request, res: Response) => {
    try {
      const actor = req.actor!;
      const receipt = await prisma.receipt.findUnique({
        where: { id: req.params.receiptId },
        include: { items: true }
      });

      if (!receipt || receipt.dormitoryId !== actor.dormitoryId || (receipt.roomId !== actor.roomId && receipt.tenantId !== actor.tenantId)) {
        return res.status(404).json({
          error: { code: 'TENANT_RECEIPT_NOT_FOUND', message: 'ไม่พบใบเสร็จนี้', requestId: req.requestId }
        });
      }

      const dorm = await prisma.dormitory.findUnique({ where: { id: receipt.dormitoryId } });
      const room = receipt.roomId ? await prisma.room.findUnique({ where: { id: receipt.roomId } }) : null;

      return res.json({
        success: true,
        data: {
          receiptNumber: receipt.receiptNumber,
          dormitoryName: dorm?.name || 'หอพัก',
          dormitoryAddress: dorm?.address || '',
          roomNumber: room?.number || 'ไม่ระบุ',
          payerName: receipt.payerName,
          issuedAt: receipt.issuedAt.toISOString(),
          totalAmount: receipt.totalAmount.toString(),
          paymentMethod: receipt.paymentMethod,
          items: receipt.items.map((it) => ({
            description: it.description,
            amount: it.amount.toString()
          }))
        }
      });
    } catch (err: any) {
      return res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId }
      });
    }
  });

  // 15. Tenant Maintenance Routes
  router.get('/maintenance', async (req: Request, res: Response) => {
    try {
      const actor = req.actor!;
      const requests = await maintenanceService.getTenantRequests(actor.dormitoryId, actor.tenantId!);
      return res.json({ success: true, data: requests });
    } catch (err: any) {
      return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId } });
    }
  });

  router.post('/maintenance', async (req: Request, res: Response) => {
    try {
      const actor = req.actor!;
      const { category, title, description, priority, preferredDate, preferredTimeRange } = req.body;

      if (!category || !title || !description) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Category, title, and description are required', requestId: req.requestId } });
      }

      if (!actor.roomId) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Room context missing for tenant', requestId: req.requestId } });
      }

      const request = await maintenanceService.createRequestByTenant({
        dormitoryId: actor.dormitoryId,
        tenantId: actor.tenantId!,
        contractId: actor.contractId || undefined,
        roomId: actor.roomId,
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
      const actor = req.actor!;
      const detail = await maintenanceService.getTenantRequestById(actor.dormitoryId, actor.tenantId!, req.params.requestId);

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
      const actor = req.actor!;
      const { message } = req.body;

      if (!message) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Message is required', requestId: req.requestId } });
      }

      const tenant = await prisma.tenant.findUnique({ where: { id: actor.tenantId! } });
      const senderName = tenant ? `${tenant.firstName} ${tenant.lastName}`.trim() : 'ผู้เช่า';

      const comment = await maintenanceService.addComment(actor.dormitoryId, req.params.requestId, {
        senderType: 'tenant',
        senderTenantId: actor.tenantId!,
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
      const actor = req.actor!;
      const { reason } = req.body;

      const cancelled = await maintenanceService.cancelByTenant(actor.dormitoryId, actor.tenantId!, req.params.requestId, reason);
      return res.json({ success: true, data: cancelled });
    } catch (err: any) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: err.message, requestId: req.requestId } });
    }
  });

  // 16. Tenant Announcement Routes
  router.get('/announcements', async (req: Request, res: Response) => {
    try {
      const actor = req.actor!;
      const list = await announcementService.getTenantAnnouncements(actor.dormitoryId, actor.tenantId!);
      return res.json({ success: true, data: list });
    } catch (err: any) {
      return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId } });
    }
  });

  router.get('/announcements/:id', async (req: Request, res: Response) => {
    try {
      const actor = req.actor!;
      const announcement = await announcementService.getTenantAnnouncementById(actor.dormitoryId, actor.tenantId!, req.params.id);

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
      const actor = req.actor!;
      const result = await announcementService.markAsReadByTenant(actor.dormitoryId, req.params.id, actor.tenantId!);
      return res.json({ success: true, data: result });
    } catch (err: any) {
      return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId } });
    }
  });

  router.post('/announcements/read-all', async (req: Request, res: Response) => {
    try {
      const actor = req.actor!;
      const count = await announcementService.markAllAsReadByTenant(actor.dormitoryId, actor.tenantId!);
      return res.json({ success: true, data: { markedCount: count } });
    } catch (err: any) {
      return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId } });
    }
  });

  return router;
}
