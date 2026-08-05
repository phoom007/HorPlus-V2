import { Router, Request, Response } from 'express';
import { getPrismaClient } from '../db/prisma.js';
// LINE/LIFF authentication is removed. Tenant portal is temporarily unavailable.
import { roomBillingStateService } from '../services/room-billing-state.service.js';
import { InMemoryBillRepository } from '../db/repositories/bill.repository.js';
import { AuditService } from '../services/audit.service.js';
import { MaintenanceService } from '../services/maintenance.service.js';
import { AnnouncementService } from '../services/announcement.service.js';
import { DocumentPdfService } from '../services/document-pdf.service.js';

import { AuthenticationService } from '../services/auth.service.js';

export function createTenantPortalRouter(authService?: AuthenticationService): Router {
  const router = Router();
  const prisma = getPrismaClient();

  const auditService = new AuditService();
  const billRepo = new InMemoryBillRepository();

  const maintenanceService = new MaintenanceService();
  const announcementService = new AnnouncementService();

  if (authService) {
    router.use(authService.requireAuth());
  }

  // 1. Tenant Profile & Room Members
  router.get('/profile', async (req: Request, res: Response) => {
    try {
      if (!req.auth?.userId) {
         return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Not logged in' } });
      }

      // Check tenant membership
      const tenantMembership = await prisma.dormitoryMember.findFirst({
        where: { userId: req.auth.userId, role: { code: 'TENANT' } }
      });

      if (!tenantMembership) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not a tenant' } });
      }

      const tenant = await prisma.tenant.findFirst({
         where: { linkedUserId: req.auth.userId, dormitoryId: tenantMembership.dormitoryId }
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

      const contract = await prisma.contract.findFirst({
        where: { tenantId: tenant.id, status: 'active' }
      });

      const room = contract && contract.roomId ? await prisma.room.findUnique({ where: { id: contract.roomId } }) : null;
      const dorm = await prisma.dormitory.findUnique({ where: { id: tenantMembership.dormitoryId } });

      // Room members under same contract/room
      const tenantBindings: any[] = [];

      const roomMembers = tenantBindings.map((tb) => ({
        displayName: tb.identity?.displayName || 'สมาชิกในห้อง',
        pictureUrl: tb.identity?.pictureUrl || null,
        memberType: tb.tenantId === tenant.id ? 'ผู้เช่าหลัก' : 'ผู้พักร่วม'
      }));

      // Mask sensitive phone
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
          logoUrl: dorm.logoUrl
        } : null,
        room: room ? {
          id: room.id,
          roomNumber: room.roomNumber,
          roomType: room.roomType,
          buildingId: room.buildingId
        } : null,
        roomMembers,
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
          roomNumber: room?.roomNumber || 'ไม่ระบุ',
          rentBillingType: contract.rentBillingType,
          rentAmount: contract.rentAmount.toString(),
          depositAmount: contract.depositAmount.toString(),
          advancePaymentAmount: contract.advancePaymentAmount.toString(),
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
      if (!req.auth?.userId) {
         return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Not logged in' } });
      }

      const tenantMembership = await prisma.dormitoryMember.findFirst({
        where: { userId: req.auth.userId, role: { code: 'TENANT' } }
      });

      if (!tenantMembership) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not a tenant' } });
      }

      const tenant = await prisma.tenant.findFirst({
         where: { linkedUserId: req.auth.userId, dormitoryId: tenantMembership.dormitoryId }
      });

      if (!tenant) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tenant not found' } });
      }

      const contract = await prisma.contract.findFirst({
        where: { tenantId: tenant.id, status: 'active' }
      });

      const bills = await prisma.bill.findMany({
        where: {
          dormitoryId: tenantMembership.dormitoryId,
          OR: [
            { roomId: contract?.roomId || undefined },
            { tenantId: tenant.id },
            { contractId: contract?.id || undefined }
          ],
          status: { not: 'cancelled' }
        },
        orderBy: { createdAt: 'desc' },
        include: {
          items: true
        }
      });

      const formatted = bills.map((b) => ({
        id: b.id,
        tenantId: b.tenantId,
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
        items: b.items.map(item => ({
          id: item.id,
          type: item.itemType,
          description: item.description,
          amount: item.amount.toString(),
          meterStart: item.meterStart,
          meterEnd: item.meterEnd,
          unitUsed: item.unitUsed,
          unitPrice: item.unitPrice ? item.unitPrice.toString() : null
        }))
      }));

      console.log('DEBUG TENANT BILLS:', JSON.stringify(formatted, null, 2));
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
          roomNumber: room?.roomNumber || 'ไม่ระบุ',
          items: bill.items.map((it: any) => ({
            id: it.id,
            itemType: it.type || it.itemType || 'other',
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
      const latestReceipt: any = null;

      return res.json({
        success: true,
        data: {
          roomNumber: room?.roomNumber || 'ไม่ระบุ',
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

  // 7. Tenant Upload Intent

  // 8. Tenant Confirm Evidence

  // 9. Tenant Payment Submission

  // 10. Tenant Payments History

  // 11. Tenant Payment Detail

  // 12. Tenant Receipts List

  // 13. Tenant Receipt Detail

  // 14. Tenant Receipt Print Data

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

  // Tenant Contract PDF Download
  router.get('/contract/pdf', async (req: Request, res: Response) => {
    try {
      const actor = req.actor!;
      if (!actor.contractId) {
        return res.status(404).json({
          error: { code: 'TENANT_CONTRACT_NOT_FOUND', message: 'ไม่พบสัญญาเช่าของคุณ', requestId: req.requestId }
        });
      }

      const contract = await prisma.contract.findUnique({
        where: { id: actor.contractId }
      });

      if (!contract || contract.dormitoryId !== actor.dormitoryId) {
        return res.status(404).json({
          error: { code: 'TENANT_CONTRACT_NOT_FOUND', message: 'ไม่พบสัญญาเช่านี้', requestId: req.requestId }
        });
      }

      const dorm = await prisma.dormitory.findUnique({ where: { id: contract.dormitoryId } });
      const room = await prisma.room.findUnique({ where: { id: contract.roomId } });
      const tenant = await prisma.tenant.findUnique({ where: { id: contract.tenantId } });

      const pdfService = new DocumentPdfService();
      const pdfBuffer = await pdfService.generateContractPdf({
        contractNumber: contract.contractNumber,
        dormitoryName: dorm?.name || 'หอพัก',
        dormitoryAddress: dorm?.addressLine1 || undefined,
        dormitoryPhone: dorm?.phone || undefined,
        ownerName: dorm?.name || 'เจ้าของหอพัก',
        tenantName: tenant?.displayName || 'ผู้เช่า',
        tenantPhone: tenant?.phone,
        roomNumber: room?.roomNumber || '101',
        rentBillingType: contract.rentBillingType === 'term' ? 'term' : 'monthly',
        startDate: contract.startDate.toISOString().split('T')[0],
        endDate: contract.endDate.toISOString().split('T')[0],
        rentAmount: contract.rentAmount.toString(),
        depositAmount: contract.depositAmount.toString(),
        waterRate: '18.00',
        electricityRate: '7.00',
        commonFee: '0.00',
        billingDay: 25,
        dueDay: 5,
        terms: contract.terms || undefined
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="Contract-${contract.contractNumber}.pdf"`);
      return res.send(pdfBuffer);
    } catch (err: any) {
      return res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: err.message, requestId: req.requestId }
      });
    }
  });

  // Tenant Receipt PDF Download

  return router;
}
