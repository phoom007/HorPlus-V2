import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { mockResolveAuthoritativeTenantContext, mockTx, mockPrisma } = vi.hoisted(() => {
  const mockResolveAuthoritativeTenantContext = vi.fn();

  const mockTx: any = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    contract: {
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    tenantRegistrationRequest: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    tenantRenewalRequest: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    dormitoryPropertyDefaults: {
      findUnique: vi.fn(),
    },
    room: {
      update: vi.fn(),
    },
    occupancy: {
      updateMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    bill: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  };

  const mockPrisma: any = {
    $transaction: vi.fn(async (cb: any) => cb(mockTx)),
    contract: {
      findFirst: vi.fn(),
    },
    tenantRegistrationRequest: {
      findFirst: vi.fn(),
    },
    occupancy: {
      findFirst: vi.fn(),
    },
    tenantRenewalRequest: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    room: {
      findUnique: vi.fn(),
    },
    dormitory: {
      findUnique: vi.fn(),
    },
    tenant: {
      findUnique: vi.fn(),
    },
    dormitoryMember: {
      findMany: vi.fn(),
    },
  };

  return { mockResolveAuthoritativeTenantContext, mockTx, mockPrisma };
});

vi.mock('../../db/prisma.js', () => ({
  getPrismaClient: () => mockPrisma,
}));

vi.mock('../../utils/tenant-resolution.util.js', () => ({
  resolveAuthoritativeTenantContext: (...args: any[]) => mockResolveAuthoritativeTenantContext(...args),
  getTenantIdsForPortalContext: (ctx: any) => (ctx?.tenant?.id ? [ctx.tenant.id] : []),
}));

vi.mock('../../middleware/require-session.js', () => ({
  requireSession: (req: any, _res: any, next: any) => next(),
  createRequireSessionMiddleware: () => (req: any, _res: any, next: any) => next(),
}));

vi.mock('../../middleware/permission.js', () => ({
  requireDormitoryPermission: (perm: string) => (req: any, res: any, next: any) => {
    const role = (req.auth?.role || '').toUpperCase();
    if (role === 'TENANT') {
      return res.status(403).json({
        error: { code: 'FORBIDDEN', message: `Permission ${perm} denied for TENANT` },
      });
    }
    next();
  },
}));

vi.mock('../../services/outbox.service.js', () => ({
  outboxService: {
    createOutboxEvent: vi.fn(),
    processPendingOutboxEvents: vi.fn(),
  },
}));

import { createContractRenewalRouter } from '../../routes/contract-renewal.routes.js';
import { contractRenewalService } from '../../services/contract-renewal.service.js';
import { createDepositBillForAgreementInTx } from '../../utils/deposit-billing.util.js';

describe('Card C2 — Tenant Contract Renewal (C2-1 to C2-6)', () => {
  const DORM_ID = '20000001-0000-4000-8000-000000000002';
  const TENANT_TC_ID = '33333333-3333-4333-8333-333333333333';
  const TENANT_TA_ID = '11111111-1111-4111-8111-111111111111';
  const CONTRACT_TC_ID = '44444444-4444-4444-8444-444444444444';
  const ROOM_TC_ID = '55555555-5555-4555-8555-555555555555';
  const REQ_TC_ID = '66666666-6666-4666-8666-666666666666';
  const mockAuthService: any = {
    verifyCsrf: vi.fn().mockReturnValue(true),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthService.verifyCsrf.mockReturnValue(true);
    mockPrisma.tenantRegistrationRequest.findFirst.mockResolvedValue(null);
    mockPrisma.occupancy.findFirst.mockResolvedValue({
      id: 'occ-1',
      dormitoryId: DORM_ID,
      roomId: ROOM_TC_ID,
      tenantId: TENANT_TC_ID,
      status: 'ACTIVE',
    });
    mockPrisma.dormitoryMember.findMany.mockResolvedValue([]);
  });

  it('C2-1: Tenant TC gets 200 on GET /eligibility and submits renewal with requestedStartDate = endDate + 1 day (OQ-3)', async () => {
    mockResolveAuthoritativeTenantContext.mockResolvedValue({
      tenant: { id: TENANT_TC_ID },
      dormitoryId: DORM_ID,
    });
    mockPrisma.contract.findFirst.mockImplementation(async ({ where }: any) => {
      if (where?.id === CONTRACT_TC_ID) {
        return {
          id: CONTRACT_TC_ID,
          dormitoryId: DORM_ID,
          tenantId: TENANT_TC_ID,
          roomId: ROOM_TC_ID,
          status: 'active',
          endDate: new Date('2026-12-31T00:00:00.000Z'),
          rentAmount: '4500',
          depositAmount: '9000',
        };
      }
      return null;
    });
    mockPrisma.tenantRenewalRequest.findFirst.mockResolvedValue(null);
    mockPrisma.tenantRenewalRequest.create.mockImplementation(async ({ data }: any) => ({
      id: REQ_TC_ID,
      ...data,
    }));

    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.auth = { userId: 'ag_user_tc', sessionId: 'sess-tc', role: 'TENANT', memberships: [] };
      next();
    });
    app.use('/api/v1/contract-renewals', createContractRenewalRouter(mockAuthService));

    const eligRes = await request(app).get(
      `/api/v1/contract-renewals/eligibility?contractId=${CONTRACT_TC_ID}&tenantId=${TENANT_TC_ID}`
    );
    expect(eligRes.status).toBe(200);
    expect(eligRes.body.data.eligible).toBe(true);

    const submitRes = await request(app)
      .post('/api/v1/contract-renewals/request')
      .set('x-csrf-token', 'valid-csrf')
      .send({
        contractId: CONTRACT_TC_ID,
        requestedStartDate: '2026-12-31',
        requestedDurationMonths: 6,
      });

    expect(submitRes.status).toBe(201);
    expect(new Date(submitRes.body.data.requestedStartDate).toISOString().slice(0, 10)).toBe('2027-01-01');
  });

  it('C2-2: Owner approval inherits digital signatures (OQ-18), closes predecessor contract, enforces 1 ACTIVE occupancy, and skips 2nd deposit bill (PO-10)', async () => {
    mockTx.tenantRenewalRequest.findUnique.mockResolvedValue({
      id: REQ_TC_ID,
      dormitoryId: DORM_ID,
      tenantId: TENANT_TC_ID,
      roomId: ROOM_TC_ID,
      contractId: CONTRACT_TC_ID,
      status: 'PENDING_OWNER_APPROVAL',
      requestedStartDate: new Date('2027-01-01T00:00:00.000Z'),
      requestedEndDate: new Date('2027-07-01T00:00:00.000Z'),
      requestedDurationMonths: 6,
      contract: {
        id: CONTRACT_TC_ID,
        dormitoryId: DORM_ID,
        roomId: ROOM_TC_ID,
        tenantId: TENANT_TC_ID,
        rentAmount: '4500',
        depositAmount: '9000',
        advancePaymentAmount: '0',
        rentBillingType: 'monthly',
        tenantSignature: 'data:image/png;base64,TENANT_SIG_BASE64',
        ownerSignature: 'data:image/png;base64,OWNER_SIG_BASE64',
        signedByTenantAt: new Date('2026-07-01T00:00:00.000Z'),
      },
      room: { roomNumber: '103' },
    });
    mockTx.contract.findFirst.mockResolvedValue(null);
    mockTx.dormitoryPropertyDefaults.findUnique.mockResolvedValue({ defaultTerms: 'กฎระเบียบมาตรฐาน' });
    mockTx.contract.update.mockResolvedValue({ id: CONTRACT_TC_ID, status: 'expired' });
    mockTx.contract.create.mockImplementation(async ({ data }: any) => ({
      id: '77777777-7777-4777-8777-777777777777',
      ...data,
    }));
    mockTx.tenantRenewalRequest.update.mockImplementation(async ({ data }: any) => ({
      id: REQ_TC_ID,
      tenantId: TENANT_TC_ID,
      roomId: ROOM_TC_ID,
      ...data,
    }));
    mockTx.occupancy.findFirst.mockResolvedValue(null);

    const approved = await contractRenewalService.approveRenewalRequest({
      dormitoryId: DORM_ID,
      requestId: REQ_TC_ID,
      actorUserId: '88888888-8888-4888-8888-888888888888',
      actorRole: 'OWNER',
    });

    expect(mockTx.contract.update).toHaveBeenCalledWith({
      where: { id: CONTRACT_TC_ID },
      data: { status: 'expired' },
    });
    expect(approved.contract.status).toBe('active');
    expect(approved.contract.tenantSignature).toBe('data:image/png;base64,TENANT_SIG_BASE64');
    expect(approved.contract.ownerSignature).toBe('data:image/png;base64,OWNER_SIG_BASE64');
    expect(mockTx.occupancy.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'ENDED' }),
      })
    );
    expect(mockTx.occupancy.create).toHaveBeenCalledTimes(1);

    // PO-10: Verify createDepositBillForAgreementInTx does not create a second DEPOSIT bill for the same tenant
    mockTx.bill.findFirst
      .mockResolvedValueOnce(null) // no deposit bill for newContractId yet
      .mockResolvedValueOnce({ id: 'existing-deposit-bill-1', billKind: 'DEPOSIT', tenantId: TENANT_TC_ID }); // existing tenant deposit bill

    const depBill = await createDepositBillForAgreementInTx(mockTx, {
      dormitoryId: DORM_ID,
      roomId: ROOM_TC_ID,
      tenantId: TENANT_TC_ID,
      contractId: approved.contract.id,
      startDate: new Date('2027-01-01T00:00:00.000Z'),
      depositAmount: 9000,
    });
    expect(depBill?.id).toBe('existing-deposit-bill-1');
    expect(mockTx.bill.create).not.toHaveBeenCalled();
  });

  it('C2-3 & C2-4: Reject returns latestRejectedRequest with reason for immediate re-apply (OQ-25); Tenant cancels own pending request', async () => {
    mockResolveAuthoritativeTenantContext.mockResolvedValue({
      tenant: { id: TENANT_TC_ID },
      dormitoryId: DORM_ID,
    });
    mockPrisma.contract.findFirst.mockImplementation(async ({ where }: any) => {
      if (where?.id === CONTRACT_TC_ID) {
        return {
          id: CONTRACT_TC_ID,
          dormitoryId: DORM_ID,
          tenantId: TENANT_TC_ID,
          roomId: ROOM_TC_ID,
          status: 'active',
          endDate: new Date('2026-12-31T00:00:00.000Z'),
        };
      }
      return null;
    });
    mockPrisma.tenantRenewalRequest.findFirst
      .mockResolvedValueOnce(null) // no pending request
      .mockResolvedValueOnce({
        id: REQ_TC_ID,
        status: 'REJECTED',
        rejectionReason: 'ขอปรับปรุงห้องพักหลังหมดสัญญาเดิม',
      });

    const elig = await contractRenewalService.getRenewalEligibility(DORM_ID, TENANT_TC_ID, CONTRACT_TC_ID);
    expect(elig.eligible).toBe(true);
    expect(elig.latestRejectedRequest?.rejectionReason).toBe('ขอปรับปรุงห้องพักหลังหมดสัญญาเดิม');

    // C2-4: Tenant cancels own pending request
    mockPrisma.tenantRenewalRequest.findUnique.mockResolvedValueOnce({
      id: REQ_TC_ID,
      dormitoryId: DORM_ID,
      tenantId: TENANT_TC_ID,
      status: 'PENDING_OWNER_APPROVAL',
    });
    mockPrisma.tenantRenewalRequest.update.mockResolvedValueOnce({
      id: REQ_TC_ID,
      status: 'CANCELLED',
    });

    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.auth = { userId: 'ag_user_tc', sessionId: 'sess-tc', role: 'TENANT', memberships: [] };
      next();
    });
    app.use('/api/v1/contract-renewals', createContractRenewalRouter(mockAuthService));

    const cancelRes = await request(app)
      .post(`/api/v1/contract-renewals/requests/${REQ_TC_ID}/cancel`)
      .set('x-csrf-token', 'valid-csrf')
      .send({ tenantId: TENANT_TC_ID });
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.data.status).toBe('CANCELLED');
  });

  it('C2-5 & C2-6: Tenant TA gets 403 FORBIDDEN when targeting TC tenantId/contractId or calling GET /requests', async () => {
    mockResolveAuthoritativeTenantContext.mockResolvedValue({
      tenant: { id: TENANT_TA_ID },
      dormitoryId: DORM_ID,
    });

    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.auth = { userId: 'ag_user_ta', sessionId: 'sess-ta', role: 'TENANT', memberships: [] };
      next();
    });
    app.use('/api/v1/contract-renewals', createContractRenewalRouter(mockAuthService));

    // C2-5a: TA tries to submit renewal request with TC's tenantId
    const submitCrossRes = await request(app)
      .post('/api/v1/contract-renewals/request')
      .set('x-csrf-token', 'valid-csrf')
      .send({
        tenantId: TENANT_TC_ID,
        contractId: CONTRACT_TC_ID,
        requestedStartDate: '2027-01-01',
        requestedDurationMonths: 6,
      });
    expect(submitCrossRes.status).toBe(403);
    expect(mockPrisma.tenantRenewalRequest.create).not.toHaveBeenCalled();

    // C2-5b: TA tries to cancel TC's pending request
    const cancelCrossRes = await request(app)
      .post(`/api/v1/contract-renewals/requests/${REQ_TC_ID}/cancel`)
      .set('x-csrf-token', 'valid-csrf')
      .send({ tenantId: TENANT_TC_ID });
    expect(cancelCrossRes.status).toBe(403);

    // C2-6: TA calls GET /api/v1/contract-renewals/requests -> 403 Forbidden
    const listRes = await request(app).get('/api/v1/contract-renewals/requests');
    expect(listRes.status).toBe(403);
  });
});
