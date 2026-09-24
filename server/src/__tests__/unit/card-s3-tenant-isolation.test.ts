/**
 * Card S3: Tenant Data Isolation & Boundary Enforcement Unit Tests
 * @license Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createTenantPortalRouter } from '../../routes/tenant-portal.routes.js';

describe('Card S3: Tenant Data Isolation & Scoping', () => {
  const DORM_A = '11111111-0000-4000-8000-000000000001';
  const DORM_B = '22222222-0000-4000-8000-000000000002';
  const TENANT_A = 'aaaaaaaa-1111-4000-8000-000000000001';
  const TENANT_B = 'bbbbbbbb-2222-4000-8000-000000000002';
  const GRANT_A = 'cccccccc-3333-4000-8000-000000000003';
  const FRIEND_A = 'dddddddd-4444-4000-8000-000000000004';
  const ROOM_101 = 'eeeeeeee-5555-4000-8000-000000000005';
  const CONTRACT_A = 'ffffffff-6666-4000-8000-000000000006';

  const createMockAuth = () => ({
    userId: `ag_user_${GRANT_A}`,
    dormitoryId: DORM_A,
    session: { accessGrantId: GRANT_A },
    memberships: [
      {
        dormitoryId: DORM_A,
        role: 'TENANT',
        roleCode: 'TENANT',
        status: 'ACTIVE',
      },
    ],
  });

  it('AC S3-2: checkBillOwnership rejects bills belonging to another tenant (TB)', async () => {
    const app = express();
    app.use(express.json());

    const mockAuthService: any = {
      requireAuth: () => (req: any, _res: any, next: any) => {
        req.auth = createMockAuth();
        next();
      },
      verifyCsrfToken: () => true,
    };

    const { getPrismaClient } = await import('../../db/prisma.js');
    const prisma = getPrismaClient();

    vi.spyOn(prisma.dormitoryAccessGrant, 'findUnique').mockResolvedValue({
      id: GRANT_A,
      dormitoryId: DORM_A,
      lineFriendId: FRIEND_A,
      roleCode: 'TENANT',
      status: 'ACTIVE',
      lineFriend: {
        id: FRIEND_A,
        dormitoryId: DORM_A,
        displayName: 'Somchai (LINE)',
        friendStatus: 'added',
      },
    } as any);

    vi.spyOn(prisma.tenant, 'findFirst').mockResolvedValue({
      id: TENANT_A,
      dormitoryId: DORM_A,
      lineFriendId: FRIEND_A,
      status: 'active',
      firstName: 'สมชาย',
      lastName: 'ใจดี',
      displayName: 'สมชาย ใจดี',
      deletedAt: null,
    } as any);

    vi.spyOn(prisma.tenant, 'findMany').mockResolvedValue([{
      id: TENANT_A,
      dormitoryId: DORM_A,
      lineFriendId: FRIEND_A,
      status: 'active',
      firstName: 'สมชาย',
      lastName: 'ใจดี',
      displayName: 'สมชาย ใจดี',
      deletedAt: null,
    }] as any);

    vi.spyOn(prisma.contract, 'findMany').mockResolvedValue([{
      id: CONTRACT_A,
      tenantId: TENANT_A,
      roomId: ROOM_101,
      dormitoryId: DORM_A,
      status: 'active',
      startDate: new Date('2026-09-01'),
      endDate: new Date('2027-08-31'),
    }] as any);

    // Bill belonging to TB
    vi.spyOn(prisma.bill, 'findUnique').mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000099',
      dormitoryId: DORM_A,
      tenantId: TENANT_B, // Owned by TB
      contractId: '00000000-0000-4000-8000-000000000088',
      roomId: ROOM_101,
      billKind: 'MONTHLY_UTILITY',
      billingDate: new Date('2026-09-15'),
      totalAmount: 1500,
      outstandingAmount: 1500,
      paidAmount: 0,
      status: 'ISSUED',
      items: [],
      Payment: [],
    } as any);

    app.use('/api/v1/tenant-portal', createTenantPortalRouter(mockAuthService));

    const res = await request(app).get('/api/v1/tenant-portal/bills/00000000-0000-4000-8000-000000000099');
    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBe('TENANT_BILL_NOT_FOUND');
    expect(res.body.error?.message).toContain('ไม่พบรายการบิลนี้');
  });

  it('AC S3-3: QR endpoint rejects requests when ?amount= exceeds outstanding amount', async () => {
    const app = express();
    app.use(express.json());

    const mockAuthService: any = {
      requireAuth: () => (req: any, _res: any, next: any) => {
        req.auth = createMockAuth();
        next();
      },
      verifyCsrfToken: () => true,
    };

    const { getPrismaClient } = await import('../../db/prisma.js');
    const prisma = getPrismaClient();

    vi.spyOn(prisma.dormitoryAccessGrant, 'findUnique').mockResolvedValue({
      id: GRANT_A,
      dormitoryId: DORM_A,
      lineFriendId: FRIEND_A,
      roleCode: 'TENANT',
      status: 'ACTIVE',
      lineFriend: { id: FRIEND_A, dormitoryId: DORM_A, displayName: 'Somchai (LINE)', friendStatus: 'added' },
    } as any);

    vi.spyOn(prisma.tenant, 'findFirst').mockResolvedValue({
      id: TENANT_A,
      dormitoryId: DORM_A,
      lineFriendId: FRIEND_A,
      status: 'active',
      firstName: 'สมชาย',
      lastName: 'ใจดี',
      displayName: 'สมชาย ใจดี',
      deletedAt: null,
    } as any);

    vi.spyOn(prisma.tenant, 'findMany').mockResolvedValue([{
      id: TENANT_A,
      dormitoryId: DORM_A,
      lineFriendId: FRIEND_A,
      status: 'active',
      firstName: 'สมชาย',
      lastName: 'ใจดี',
      displayName: 'สมชาย ใจดี',
      deletedAt: null,
    }] as any);

    vi.spyOn(prisma.contract, 'findMany').mockResolvedValue([{
      id: CONTRACT_A,
      tenantId: TENANT_A,
      roomId: ROOM_101,
      dormitoryId: DORM_A,
      status: 'active',
      startDate: new Date('2026-09-01'),
      endDate: new Date('2027-08-31'),
    }] as any);

    // TA's bill with outstanding balance of 3500 THB
    vi.spyOn(prisma.bill, 'findUnique').mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000101',
      dormitoryId: DORM_A,
      tenantId: TENANT_A,
      contractId: CONTRACT_A,
      roomId: ROOM_101,
      billKind: 'RENT',
      billingDate: new Date('2026-09-01'),
      totalAmount: 3500,
      outstandingAmount: 3500,
      paidAmount: 0,
      status: 'ISSUED',
      items: [],
      Payment: [],
    } as any);

    app.use('/api/v1/tenant-portal', createTenantPortalRouter(mockAuthService));

    // Requesting 5000 THB when outstanding is 3500 THB
    const res = await request(app).get('/api/v1/tenant-portal/payment-options/00000000-0000-4000-8000-000000000101/qr?amount=5000');
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('AMOUNT_EXCEEDS_OUTSTANDING');
    expect(res.body.error?.message).toContain('เกินยอดค้างชำระ');
  });

  it('AC S3-3: QR endpoint rejects multi-bill requests if ANY bill belongs to another tenant', async () => {
    const app = express();
    app.use(express.json());

    const mockAuthService: any = {
      requireAuth: () => (req: any, _res: any, next: any) => {
        req.auth = createMockAuth();
        next();
      },
      verifyCsrfToken: () => true,
    };

    const { getPrismaClient } = await import('../../db/prisma.js');
    const prisma = getPrismaClient();

    vi.spyOn(prisma.dormitoryAccessGrant, 'findUnique').mockResolvedValue({
      id: GRANT_A,
      dormitoryId: DORM_A,
      lineFriendId: FRIEND_A,
      roleCode: 'TENANT',
      status: 'ACTIVE',
      lineFriend: { id: FRIEND_A, dormitoryId: DORM_A, displayName: 'Somchai (LINE)', friendStatus: 'added' },
    } as any);

    vi.spyOn(prisma.tenant, 'findFirst').mockResolvedValue({
      id: TENANT_A,
      dormitoryId: DORM_A,
      lineFriendId: FRIEND_A,
      status: 'active',
      firstName: 'สมชาย',
      lastName: 'ใจดี',
      displayName: 'สมชาย ใจดี',
      deletedAt: null,
    } as any);

    vi.spyOn(prisma.tenant, 'findMany').mockResolvedValue([{
      id: TENANT_A,
      dormitoryId: DORM_A,
      lineFriendId: FRIEND_A,
      status: 'active',
      firstName: 'สมชาย',
      lastName: 'ใจดี',
      displayName: 'สมชาย ใจดี',
      deletedAt: null,
    }] as any);

    vi.spyOn(prisma.contract, 'findMany').mockResolvedValue([{
      id: CONTRACT_A,
      tenantId: TENANT_A,
      roomId: ROOM_101,
      dormitoryId: DORM_A,
      status: 'active',
      startDate: new Date('2026-09-01'),
      endDate: new Date('2027-08-31'),
    }] as any);

    const bill1 = '00000000-0000-4000-8000-000000000001';
    const bill2 = '00000000-0000-4000-8000-000000000002';

    // Mock findUnique: bill-1 is TA's, bill-2 is TB's
    vi.spyOn(prisma.bill, 'findUnique').mockImplementation((({ where }: any) => {
      if (where.id === bill1) {
        return Promise.resolve({
          id: bill1,
          dormitoryId: DORM_A,
          tenantId: TENANT_A,
          contractId: CONTRACT_A,
          totalAmount: 1000,
          outstandingAmount: 1000,
          status: 'ISSUED',
          items: [],
          Payment: [],
        });
      }
      return Promise.resolve({
        id: bill2,
        dormitoryId: DORM_A,
        tenantId: TENANT_B, // TB's bill
        contractId: '00000000-0000-4000-8000-000000000088',
        totalAmount: 2000,
        outstandingAmount: 2000,
        status: 'ISSUED',
        items: [],
        Payment: [],
      });
    }) as any);

    app.use('/api/v1/tenant-portal', createTenantPortalRouter(mockAuthService));

    const res = await request(app).get(`/api/v1/tenant-portal/payment-options/${bill1},${bill2}/qr`);
    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBe('TENANT_BILL_NOT_FOUND');
  });

  it('AC S3-4: GET /rooms enforces ctx.dormitoryId scoping strictly', async () => {
    const app = express();
    app.use(express.json());

    const mockAuthService: any = {
      requireAuth: () => (req: any, _res: any, next: any) => {
        req.auth = createMockAuth();
        next();
      },
      verifyCsrfToken: () => true,
    };

    const { getPrismaClient } = await import('../../db/prisma.js');
    const prisma = getPrismaClient();

    vi.spyOn(prisma.dormitoryAccessGrant, 'findUnique').mockResolvedValue({
      id: GRANT_A,
      dormitoryId: DORM_A,
      lineFriendId: FRIEND_A,
      roleCode: 'TENANT',
      status: 'ACTIVE',
      lineFriend: { id: FRIEND_A, dormitoryId: DORM_A, displayName: 'Somchai (LINE)', friendStatus: 'added' },
    } as any);

    vi.spyOn(prisma.tenant, 'findFirst').mockResolvedValue({
      id: TENANT_A,
      dormitoryId: DORM_A,
      lineFriendId: FRIEND_A,
      status: 'active',
      firstName: 'สมชาย',
      lastName: 'ใจดี',
      displayName: 'สมชาย ใจดี',
      deletedAt: null,
    } as any);

    const tenantFindManySpy = vi.spyOn(prisma.tenant, 'findMany').mockResolvedValue([{
      id: TENANT_A,
      dormitoryId: DORM_A,
      contracts: [{
        id: CONTRACT_A,
        status: 'active',
        contractNumber: 'CT-101',
        rentAmount: 3500,
        room: {
          id: ROOM_101,
          roomNumber: '101',
          floor: 1,
          buildingId: 'bld-1',
          building: { name: 'อาคาร A', termMonths: 12 },
        }
      }],
      occupancies: [],
      dailyStays: [],
      dormitory: { name: 'หอพัก A' },
    }] as any);

    app.use('/api/v1/tenant-portal', createTenantPortalRouter(mockAuthService));

    const res = await request(app).get('/api/v1/tenant-portal/rooms');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.rooms).toHaveLength(1);
    expect(res.body.rooms[0].roomNumber).toBe('101');
    expect(res.body.rooms[0].dormitoryId).toBe(DORM_A);

    // Verify prisma.tenant.findMany was called with dormitoryId = DORM_A
    expect(tenantFindManySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          dormitoryId: DORM_A,
        })
      })
    );
  });

  it('AC S3-6: Query bounds (take: 50) is applied to bills, payments, and receipts', async () => {
    const app = express();
    app.use(express.json());

    const mockAuthService: any = {
      requireAuth: () => (req: any, _res: any, next: any) => {
        req.auth = createMockAuth();
        next();
      },
      verifyCsrfToken: () => true,
    };

    const { getPrismaClient } = await import('../../db/prisma.js');
    const prisma = getPrismaClient();

    vi.spyOn(prisma.dormitoryAccessGrant, 'findUnique').mockResolvedValue({
      id: GRANT_A,
      dormitoryId: DORM_A,
      lineFriendId: FRIEND_A,
      roleCode: 'TENANT',
      status: 'ACTIVE',
      lineFriend: { id: FRIEND_A, dormitoryId: DORM_A, displayName: 'Somchai (LINE)', friendStatus: 'added' },
    } as any);

    vi.spyOn(prisma.tenant, 'findFirst').mockResolvedValue({
      id: TENANT_A,
      dormitoryId: DORM_A,
      lineFriendId: FRIEND_A,
      status: 'active',
      firstName: 'สมชาย',
      lastName: 'ใจดี',
      displayName: 'สมชาย ใจดี',
      deletedAt: null,
    } as any);

    vi.spyOn(prisma.tenant, 'findMany').mockResolvedValue([{
      id: TENANT_A,
      dormitoryId: DORM_A,
      lineFriendId: FRIEND_A,
      status: 'active',
      firstName: 'สมชาย',
      lastName: 'ใจดี',
      displayName: 'สมชาย ใจดี',
      deletedAt: null,
    }] as any);

    vi.spyOn(prisma.contract, 'findMany').mockResolvedValue([{
      id: CONTRACT_A,
      tenantId: TENANT_A,
      roomId: ROOM_101,
      dormitoryId: DORM_A,
      status: 'active',
      startDate: new Date('2026-09-01'),
      endDate: new Date('2027-08-31'),
    }] as any);

    const billFindManySpy = vi.spyOn(prisma.bill, 'findMany').mockResolvedValue([]);
    const paymentFindManySpy = vi.spyOn(prisma.payment, 'findMany').mockResolvedValue([]);
    const receiptFindManySpy = vi.spyOn(prisma.receipt, 'findMany').mockResolvedValue([]);

    app.use('/api/v1/tenant-portal', createTenantPortalRouter(mockAuthService));

    await request(app).get('/api/v1/tenant-portal/bills');
    expect(billFindManySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 50,
      })
    );

    await request(app).get('/api/v1/tenant-portal/payments');
    expect(paymentFindManySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 50,
      })
    );

    await request(app).get('/api/v1/tenant-portal/receipts');
    expect(receiptFindManySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 50,
      })
    );
  });
});
