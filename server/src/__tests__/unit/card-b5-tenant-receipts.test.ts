import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { renderReceiptHtml } from '../../utils/receipt-html.util.js';

const mockPrisma = vi.hoisted(() => ({
  receipt: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  bill: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  contract: {
    findMany: vi.fn(),
  },
  combinedPaymentGroupBillTarget: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
  dailyStayInvoice: {
    findUnique: vi.fn(),
  },
  payment: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  dormitory: {
    findUnique: vi.fn(),
  },
  tenant: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  dormitoryAccessGrant: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
  },
  occupancy: {
    findFirst: vi.fn(),
  },
  room: {
    findUnique: vi.fn(),
  },
  $transaction: vi.fn((cb: any) => cb(mockPrisma)),
}));

vi.mock('../../db/prisma.js', () => ({
  getPrismaClient: () => mockPrisma,
  prisma: mockPrisma,
}));

import { createReceiptRouter } from '../../routes/receipt.routes.js';

describe('Card B5 — Complete Tenant Receipts (Single, Combined, Cash, Cross-Tenant 403, Mobile PDF)', () => {
  const DORM_ID = '20000001-0000-4000-8000-000000000002';
  const TENANT_TC_ID = 'tenant-tc-0001';
  const TENANT_TB_ID = 'tenant-tb-0002';
  const CONTRACT_TC_ID = 'contract-tc-0001';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('AC B5-1 & B5-4: Combined Receipt HTML & Mobile Responsive PDF Layout', () => {
    it('renders 1 combined receipt covering 2 bills with itemized billGroups, mobile viewport meta tag, and PDF print button', () => {
      const combinedReceiptRecord = {
        id: 'rcpt-combined-001',
        dormitoryId: DORM_ID,
        receiptNumber: 'RC-202609-201-9001',
        paymentGroupId: 'group-001',
        billId: null,
        issuedAt: new Date('2026-09-25T10:00:00Z'),
        isVoided: false,
        snapshotData: {
          isCombined: true,
          dormitoryName: 'หอพัก HorPlus UAT Comprehensive Manor',
          receiverName: 'หอพัก HorPlus UAT Comprehensive Manor',
          dormitoryAddress: '123 ถนนสุขุมวิท กรุงเทพฯ',
          dormitoryPhone: '0812345678',
          tenantName: 'สมศรี มั่งมี (TC)',
          roomNumber: '201',
          paymentMethod: 'BANK_TRANSFER',
          invoiceNo: 'INV-202609-201-R, INV-202609-201-U',
          subtotal: 5350,
          vatAmount: 0,
          total: 5350,
          billGroups: [
            {
              billId: 'bill-tc-rent',
              billNumber: 'INV-202609-201-R',
              roomNumber: '201',
              allocatedAmount: 4500,
              subtotal: 4500,
              items: [
                { description: 'ค่าเช่าห้องพัก (กันยายน 2569)', amount: 4500, quantity: 1, unitPrice: 4500 },
              ],
            },
            {
              billId: 'bill-tc-util',
              billNumber: 'INV-202609-201-U',
              roomNumber: '201',
              allocatedAmount: 850,
              subtotal: 850,
              items: [
                { description: 'ค่าน้ำประปา (10 หน่วย)', amount: 200, quantity: 10, unitPrice: 20 },
                { description: 'ค่าไฟฟ้า (100 หน่วย)', amount: 650, quantity: 100, unitPrice: 6.5 },
              ],
            },
          ],
        },
      };

      const html = renderReceiptHtml(combinedReceiptRecord, { hasCurrentLogo: false });

      // AC B5-1: Single receipt number covering both bills and itemized details
      expect(html).toContain('RC-202609-201-9001');
      expect(html).toContain('INV-202609-201-R');
      expect(html).toContain('INV-202609-201-U');
      expect(html).toContain('ค่าเช่าห้องพัก (กันยายน 2569)');
      expect(html).toContain('ค่าน้ำ (10 หน่วย)');
      expect(html).toContain('ค่าไฟฟ้า (100 หน่วย)');
      expect(html).toContain('5,350.00');

      // AC B5-4: Mobile viewport & responsive layout without horizontal overflow + PDF button
      expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1.0">');
      expect(html).toContain('@media (max-width: 640px)');
      expect(html).toContain('min-width: 0 !important; width: 100% !important;');
      expect(html).toContain('พิมพ์ / บันทึกเป็น PDF');
    });
  });

  describe('AC B5-2: Cash Receipt Rendering', () => {
    it('renders cash receipt clearly showing ช่องทางชำระเงิน: เงินสด for TC', () => {
      const cashReceiptRecord = {
        id: 'rcpt-cash-002',
        dormitoryId: DORM_ID,
        receiptNumber: 'RC-202609-201-9002',
        billId: 'bill-tc-cash',
        issuedAt: new Date('2026-09-25T11:00:00Z'),
        isVoided: false,
        snapshotData: {
          isCombined: false,
          dormitoryName: 'หอพัก HorPlus UAT Comprehensive Manor',
          receiverName: 'หอพัก HorPlus UAT Comprehensive Manor',
          tenantName: 'สมศรี มั่งมี (TC)',
          roomNumber: '201',
          billNumber: 'INV-202609-201-C',
          paymentMethod: 'CASH',
          subtotal: 4500,
          vatAmount: 0,
          total: 4500,
          items: [
            { description: 'ค่าเช่าห้องพักชำระเงินสด', amount: 4500, quantity: 1, unitPrice: 4500 },
          ],
        },
      };

      const html = renderReceiptHtml(cashReceiptRecord, { hasCurrentLogo: false });
      expect(html).toContain('RC-202609-201-9002');
      expect(html).toContain('เงินสด');
      expect(html).toContain('ค่าเช่าห้องพักชำระเงินสด');
      expect(html).toContain('พิมพ์ / บันทึกเป็น PDF');
    });
  });

  describe('AC B5-3: Cross-Tenant Receipt Authorization (TC = 200, TB = 403 Forbidden)', () => {
    const buildApp = (activeTenantId: string) => {
      const fakeAuthService: any = {
        requireAuth: () => (req: any, _res: any, next: any) => {
          req.auth = {
            userId: activeTenantId === TENANT_TC_ID
              ? '10000001-0000-4000-8000-000000000001'
              : '10000001-0000-4000-8000-000000000002',
            memberships: [
              { dormitoryId: DORM_ID, role: 'tenant', roleCode: 'TENANT', status: 'ACTIVE' },
            ],
          };
          next();
        },
      };
      const app = express();
      app.use('/api/v1/receipts', createReceiptRouter(fakeAuthService));
      return app;
    };

    it('denies TB (403 Forbidden) when accessing TC single or combined receipt by ID or HTML or final bill', async () => {
      // Mock tenant resolution to return TB
      mockPrisma.tenant.findFirst.mockResolvedValue({
        id: TENANT_TB_ID,
        dormitoryId: DORM_ID,
        status: 'active',
      });
      mockPrisma.contract.findMany.mockResolvedValue([{ id: 'contract-tb-9999' }]);

      // 1. Combined receipt owned by TC
      mockPrisma.receipt.findUnique.mockResolvedValue({
        id: 'rcpt-combined-tc',
        dormitoryId: DORM_ID,
        receiptNumber: 'RC-202609-201-9001',
        billId: null,
        paymentGroupId: 'group-tc-001',
        isVoided: false,
        snapshotData: {},
      });
      mockPrisma.combinedPaymentGroupBillTarget.findMany.mockResolvedValue([
        {
          paymentGroupId: 'group-tc-001',
          billId: 'bill-tc-1',
          bill: { id: 'bill-tc-1', dormitoryId: DORM_ID, tenantId: TENANT_TC_ID, contractId: CONTRACT_TC_ID },
        },
      ]);

      const appAsTB = buildApp(TENANT_TB_ID);

      const resJson = await request(appAsTB).get('/api/v1/receipts/rcpt-combined-tc');
      expect(resJson.status).toBe(403);

      const resHtml = await request(appAsTB).get('/api/v1/receipts/rcpt-combined-tc/html');
      expect(resHtml.status).toBe(403);

      // 2. Final bill receipt endpoint called by TB for TC's bill
      mockPrisma.bill.findUnique.mockResolvedValue({
        id: 'bill-tc-1',
        dormitoryId: DORM_ID,
        tenantId: TENANT_TC_ID,
        contractId: CONTRACT_TC_ID,
      });
      const resFinal = await request(appAsTB).get('/api/v1/receipts/final/bill/bill-tc-1');
      expect(resFinal.status).toBe(403);
    });

    it('allows TC (200 OK) to open their own combined receipt HTML', async () => {
      mockPrisma.tenant.findFirst.mockResolvedValue({
        id: TENANT_TC_ID,
        dormitoryId: DORM_ID,
        status: 'active',
      });
      mockPrisma.contract.findMany.mockResolvedValue([{ id: CONTRACT_TC_ID }]);
      mockPrisma.dormitory.findUnique.mockResolvedValue({ id: DORM_ID, logoObjectKey: null });

      mockPrisma.receipt.findUnique.mockResolvedValue({
        id: 'rcpt-combined-tc',
        dormitoryId: DORM_ID,
        receiptNumber: 'RC-202609-201-9001',
        billId: null,
        paymentGroupId: 'group-tc-001',
        issuedAt: new Date('2026-09-25T10:00:00Z'),
        isVoided: false,
        snapshotData: {
          isCombined: true,
          receiverName: 'หอพัก HorPlus',
          tenantName: 'สมศรี (TC)',
          roomNumber: '201',
          paymentMethod: 'BANK_TRANSFER',
          total: 5350,
          billGroups: [
            {
              billNumber: 'INV-1',
              allocatedAmount: 4500,
              items: [{ description: 'ค่าเช่า', amount: 4500 }],
            },
            {
              billNumber: 'INV-2',
              allocatedAmount: 850,
              items: [{ description: 'ค่าน้ำไฟ', amount: 850 }],
            },
          ],
        },
      });
      mockPrisma.combinedPaymentGroupBillTarget.findMany.mockResolvedValue([
        {
          paymentGroupId: 'group-tc-001',
          billId: 'bill-tc-1',
          bill: { id: 'bill-tc-1', dormitoryId: DORM_ID, tenantId: null, contractId: CONTRACT_TC_ID },
        },
      ]);

      const appAsTC = buildApp(TENANT_TC_ID);
      const resHtml = await request(appAsTC).get('/api/v1/receipts/rcpt-combined-tc/html');
      expect(resHtml.status).toBe(200);
      expect(resHtml.text).toContain('RC-202609-201-9001');
      expect(resHtml.text).toContain('พิมพ์ / บันทึกเป็น PDF');
    });
  });
});
