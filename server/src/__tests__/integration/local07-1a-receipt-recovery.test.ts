import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { getPrismaClient } from '../../db/prisma.js';
import { ReceiptService } from '../../services/receipt.service.js';
import { createReceiptRouter } from '../../routes/receipt.routes.js';
import { renderReceiptHtml } from '../../utils/receipt-html.util.js';

describe('Local07 1A Final Settlement Receipt Recovery & Permanence Proof', () => {
  const prisma = getPrismaClient();
  const receiptService = new ReceiptService();

  let compDorm: any;
  let b101Bill: any;
  let r202Bill: any;
  let r206DailyInvoice: any;
  let unsettledBill: any;
  let app: express.Express;

  beforeAll(async () => {
    // 1. Locate Comprehensive Dormitory
    compDorm = await prisma.dormitory.findFirst({
      where: { name: { contains: 'Comprehensive' } },
    });
    if (!compDorm) {
      throw new Error('Comprehensive Dormitory fixture not found. Ensure sandbox is seeded.');
    }

    const ownerUserId = compDorm.createdByUserId;

    // 2. Identify target canonical records
    // A: Room B101 monthly/utility paid bill
    b101Bill = await prisma.bill.findFirst({
      where: {
        dormitoryId: compDorm.id,
        room: { roomNumber: 'B101' },
        status: 'paid',
      },
      include: { room: true },
    });

    // B: Room 202 paid deposit bill
    r202Bill = await prisma.bill.findFirst({
      where: {
        dormitoryId: compDorm.id,
        room: { roomNumber: '202' },
        status: 'paid',
      },
      include: { room: true },
    });

    // C: Room 206 Daily settled invoice
    r206DailyInvoice = await prisma.dailyStayInvoice.findFirst({
      where: {
        dormitoryId: compDorm.id,
        dailyStay: { room: { roomNumber: '206' } },
        status: { in: ['PAID', 'SETTLED'] },
      },
      include: { dailyStay: { include: { room: true } } },
    });

    // D: Unsettled bill (e.g. Room 201 unpaid bill)
    unsettledBill = await prisma.bill.findFirst({
      where: {
        dormitoryId: compDorm.id,
        room: { roomNumber: '201' },
        status: { not: 'paid' },
      },
    });

    // 3. Build authenticated Express test app
    app = express();
    app.use(express.json());

    // Mock auth middleware for Comprehensive Owner
    app.use((req, _res, next) => {
      (req as any).auth = {
        userId: ownerUserId,
        memberships: [{ dormitoryId: compDorm.id, role: 'owner' }],
      };
      (req as any).user = {
        id: ownerUserId,
        role: 'owner',
      };
      next();
    });

    const mockAuthService = {
      requireAuth: () => (req: any, _res: any, next: any) => {
        req.auth = {
          userId: ownerUserId,
          memberships: [{ dormitoryId: compDorm.id, role: 'owner' }],
        };
        req.user = { id: ownerUserId, role: 'owner' };
        next();
      },
      validateSession: async () => ({
        user: { id: ownerUserId, role: 'owner' },
        session: { id: 'test-session', userId: ownerUserId },
        memberships: [{ dormitoryId: compDorm.id, role: 'owner' }],
      }),
      verifyCsrf: () => true,
    };

    const mockDormRepo = {
      findById: async () => compDorm,
      isOwner: async () => true,
      isManager: async () => false,
      findMember: async () => ({ role: 'owner' }),
    };

    app.use('/api/v1/receipts', createReceiptRouter(mockAuthService as any, receiptService, mockDormRepo as any));
  });

  describe('1. Room B101 Monthly Paid Scope', () => {
    it('generates or recovers FINAL_SETTLEMENT receipt, is idempotent, and print route succeeds', async () => {
      expect(b101Bill).toBeDefined();

      // Call 1: HTTP route
      const res1 = await request(app).get(`/api/v1/receipts/final/bill/${b101Bill.id}`);
      expect(res1.status).toBe(200);
      expect(res1.body).toBeDefined();
      const rcpt1 = res1.body;

      expect(rcpt1.receiptKind).toBe('FINAL_SETTLEMENT');
      expect(rcpt1.isVoided).toBe(false);
      expect(rcpt1.dormitoryId).toBe(compDorm.id);

      // Call 2: Second call returns exact same Receipt ID (idempotency)
      const res2 = await request(app).get(`/api/v1/receipts/final/bill/${b101Bill.id}`);
      expect(res2.status).toBe(200);
      expect(res2.body.id).toBe(rcpt1.id);
      expect(res2.body.receiptNumber).toBe(rcpt1.receiptNumber);

      // Print route succeeds with HTML
      const printRes = await request(app).get(`/api/v1/receipts/${rcpt1.id}/print`);
      expect(printRes.status).toBe(200);
      expect(printRes.headers['content-type']).toContain('text/html');
      expect(printRes.text).toContain(rcpt1.receiptNumber);
    });
  });

  describe('2. Room 202 Paid Deposit Scope', () => {
    it('generates or recovers FINAL_SETTLEMENT receipt, is idempotent, and print route succeeds', async () => {
      expect(r202Bill).toBeDefined();

      // Call 1: Direct service call
      const rcpt1 = await receiptService.getFinalReceiptForBill(compDorm.id, r202Bill.id, compDorm.createdByUserId);
      expect(rcpt1).toBeDefined();
      expect(rcpt1?.receiptKind).toBe('FINAL_SETTLEMENT');
      expect(rcpt1?.isVoided).toBe(false);

      // Call 2: Exact same Receipt ID
      const rcpt2 = await receiptService.getFinalReceiptForBill(compDorm.id, r202Bill.id, compDorm.createdByUserId);
      expect(rcpt2?.id).toBe(rcpt1?.id);
      expect(rcpt2?.receiptNumber).toBe(rcpt1?.receiptNumber);

      // HTTP route verification
      const res = await request(app).get(`/api/v1/receipts/final/bill/${r202Bill.id}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(rcpt1?.id);

      // Print route succeeds
      const printRes = await request(app).get(`/api/v1/receipts/${rcpt1?.id}/print`);
      expect(printRes.status).toBe(200);
      expect(printRes.headers['content-type']).toContain('text/html');
    });
  });

  describe('3. Room 206 Daily Settled Scope', () => {
    it('accepts canonical SETTLED status, generates or recovers FINAL_SETTLEMENT receipt, is idempotent, and print route succeeds', async () => {
      expect(r206DailyInvoice).toBeDefined();
      expect(['PAID', 'SETTLED']).toContain(r206DailyInvoice.status);
      expect(Number(r206DailyInvoice.outstandingAmount)).toBe(0);

      // Call 1: HTTP route
      const res1 = await request(app).get(`/api/v1/receipts/final/daily-invoice/${r206DailyInvoice.id}`);
      expect(res1.status).toBe(200);
      const rcpt1 = res1.body;

      expect(rcpt1.receiptKind).toBe('FINAL_SETTLEMENT');
      expect(rcpt1.isVoided).toBe(false);
      expect(rcpt1.dormitoryId).toBe(compDorm.id);

      // Call 2: Idempotent - same receipt ID
      const res2 = await request(app).get(`/api/v1/receipts/final/daily-invoice/${r206DailyInvoice.id}`);
      expect(res2.status).toBe(200);
      expect(res2.body.id).toBe(rcpt1.id);
      expect(res2.body.receiptNumber).toBe(rcpt1.receiptNumber);

      // Print route succeeds
      const printRes = await request(app).get(`/api/v1/receipts/${rcpt1.id}/print`);
      expect(printRes.status).toBe(200);
      expect(printRes.headers['content-type']).toContain('text/html');
    });
  });

  describe('4. Fail-Closed Room-Cycle Settlement Invariant', () => {
    it('does NOT generate a Final Receipt for unsettled records', async () => {
      if (unsettledBill) {
        const rcpt = await receiptService.getFinalReceiptForBill(compDorm.id, unsettledBill.id, compDorm.createdByUserId);
        expect(rcpt).toBeNull();

        const res = await request(app).get(`/api/v1/receipts/final/bill/${unsettledBill.id}`);
        expect(res.status).toBe(404);
      }
    });
  });
});
