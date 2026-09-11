/**
 * @license Apache-2.0
 * OWNER R3.8fR3 — LOCAL-07 Mutation CORS & Runtime Authority Integration Tests
 *
 * Requirements:
 * 1. Origin http://127.0.0.1:5173 accepted for preflight & mutation in dev/test.
 * 2. Origin http://localhost:5173 accepted for preflight & mutation in dev/test.
 * 3. Unknown origin http://evil.example rejected (CORS policy blocked, fail-closed).
 * 4. Production explicit CORS origin policy remains fail-closed.
 * 5. Section C Real LOCAL-07 HTTP Mutation Proof using a dedicated resettable test group.
 *    (Room 302 is strictly NOT touched or approved).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { getEnv, resetCachedEnv, validateEnv } from '../../config/env.js';
import { getPrismaClient } from '../../db/prisma.js';
import { AuthenticationService } from '../../services/auth.service.js';
import { PrismaUserRepository } from '../../db/repositories/user.repository.js';
import { PrismaSessionRepository } from '../../db/repositories/session.repository.js';
import { PrismaMembershipRepository } from '../../db/repositories/membership.repository.js';
import { PrismaRoleRepository } from '../../db/repositories/role.repository.js';
import { SensitiveFieldService } from '../../services/sensitive-field.service.js';
import { subscriptionEntitlementService } from '../../services/subscription-entitlement.service.js';
import { SignatureStorageService } from '../../services/signature-storage.service.js';
import { subscriptionIntentService } from '../../services/subscription-intent.service.js';
import { Prisma } from '@prisma/client';

const prisma = getPrismaClient();

describe('OWNER R3.8fR3: CORS Preflight, Mutation & Local-07 Topology Integration', () => {
  let app: any;
  let authService: AuthenticationService;
  const testRunId = `cors_r38fr3_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

  let dormId: string;
  let bldId: string;
  let ownerUserId: string;
  let ownerSessionToken: string;
  let ownerCsrfToken: string;
  let tenantRecordId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.E2E_TEST_MODE = 'true';
    resetCachedEnv();

    const env = getEnv();
    const sensitiveService = new SensitiveFieldService(env.FIELD_ENCRYPTION_KEY, 1);
    const mockGoogleVerifier = {} as any;
    const mockAuditService = { logAction: async () => {} } as any;

    authService = new AuthenticationService(
      env,
      mockGoogleVerifier,
      new PrismaUserRepository(prisma),
      new PrismaSessionRepository(prisma),
      new PrismaMembershipRepository(prisma),
      new PrismaRoleRepository(prisma),
      mockAuditService,
      sensitiveService
    );

    app = createApp({
      authService,
      sensitiveFieldService: sensitiveService,
      subscriptionEntitlementService,
      signatureStorageService: new SignatureStorageService(),
      subscriptionIntentService,
    });

    // Ensure subscription catalog is seeded
    await subscriptionEntitlementService.ensureSeeded();
    const freePlan = await prisma.subscriptionPlan.findFirst({ where: { code: 'FREE' } });

    // Setup Owner and Dormitory
    const dorm = await prisma.dormitory.create({
      data: {
        name: `Dorm CORS R38fR3 ${testRunId}`,
        status: 'active',
      },
    });
    dormId = dorm.id;

    if (freePlan) {
      await prisma.dormitorySubscription.create({
        data: {
          dormitoryId: dormId,
          planId: freePlan.id,
          status: 'ACTIVE',
          expiresAt: new Date(Date.now() + 365 * 86400000),
        },
      });
    }

    const ownerRole = (await prisma.role.findFirst({ where: { code: 'owner' } })) ||
      (await prisma.role.create({ data: { code: 'owner', name: 'Owner', permissions: [] } }));

    const ownerUser = await prisma.user.create({
      data: {
        email: `owner_${testRunId}@test.com`,
        emailNormalized: `owner_${testRunId}@test.com`,
        googleSubject: `google_owner_${testRunId}`,
        name: 'Owner User R38fR3',
      },
    });
    ownerUserId = ownerUser.id;

    await prisma.dormitoryMember.create({
      data: {
        userId: ownerUserId,
        dormitoryId: dormId,
        roleId: ownerRole.id,
        status: 'active',
        membershipOrigin: 'GOOGLE_BOOTSTRAP',
      },
    });

    const ownerAuth = await authService.authenticateTestUser(ownerUserId);
    ownerSessionToken = ownerAuth.sessionToken;
    ownerCsrfToken = ownerAuth.csrfToken;

    const building = await prisma.building.create({
      data: {
        dormitoryId: dormId,
        name: 'Building Loopback',
      },
    });
    bldId = building.id;

    const tenant = await prisma.tenant.create({
      data: {
        dormitoryId: dormId,
        tenantNumber: `TNT-${testRunId}`,
        firstName: 'ทดสอบ',
        lastName: 'CORS',
        displayName: 'ทดสอบ CORS',
        status: 'active',
      },
    });
    tenantRecordId = tenant.id;
  });

  afterAll(async () => {
    // Clean up test data for this run (leaves Room 302 untouched)
    try {
      await prisma.combinedPaymentGroupReceipt.deleteMany({
        where: { group: { dormitoryId: dormId } },
      });
      await prisma.paymentAllocation.deleteMany({
        where: { payment: { dormitoryId: dormId } },
      });
      await prisma.paymentStatusHistory.deleteMany({
        where: { payment: { dormitoryId: dormId } },
      });
      await prisma.payment.deleteMany({
        where: { paymentGroup: { dormitoryId: dormId } },
      });
      await prisma.payment.deleteMany({
        where: { bill: { dormitoryId: dormId } },
      });
      await prisma.combinedPaymentGroupBillTarget.deleteMany({
        where: { group: { dormitoryId: dormId } },
      });
      await prisma.combinedPaymentGroup.deleteMany({
        where: { dormitoryId: dormId },
      });
      await prisma.receipt.deleteMany({
        where: { bill: { dormitoryId: dormId } },
      });
      await prisma.billItem.deleteMany({
        where: { bill: { dormitoryId: dormId } },
      });
      await prisma.billStatusHistory.deleteMany({
        where: { bill: { dormitoryId: dormId } },
      });
      await prisma.bill.deleteMany({
        where: { dormitoryId: dormId },
      });
      await prisma.billingCycle.deleteMany({
        where: { dormitoryId: dormId },
      });
      await prisma.contract.deleteMany({
        where: { dormitoryId: dormId },
      });
      await prisma.tenant.deleteMany({
        where: { dormitoryId: dormId },
      });
      await prisma.room.deleteMany({
        where: { dormitoryId: dormId },
      });
      await prisma.building.deleteMany({
        where: { dormitoryId: dormId },
      });
      await prisma.dormitorySubscription.deleteMany({
        where: { dormitoryId: dormId },
      });
      await prisma.dormitoryMember.deleteMany({
        where: { dormitoryId: dormId },
      });
      await prisma.dormitory.deleteMany({
        where: { id: dormId },
      });
      await prisma.session.deleteMany({
        where: { userId: ownerUserId },
      });
      await prisma.user.deleteMany({
        where: { id: ownerUserId },
      });
    } catch {
      // Ignore cleanup error
    }
  });

  describe('1. CORS Loopback Origin Authority', () => {
    it('accepts preflight OPTIONS from http://127.0.0.1:5173', async () => {
      const res = await request(app)
        .options('/api/v1/payments/combined-groups/00000000-0000-0000-0000-000000000001/approve')
        .set('Origin', 'http://127.0.0.1:5173')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'Content-Type, X-CSRF-Token, X-Dormitory-Id');

      expect([200, 204]).toContain(res.status);
      expect(res.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5173');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('accepts preflight OPTIONS from http://localhost:5173', async () => {
      const res = await request(app)
        .options('/api/v1/payments/combined-groups/00000000-0000-0000-0000-000000000001/approve')
        .set('Origin', 'http://localhost:5173')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'Content-Type, X-CSRF-Token, X-Dormitory-Id');

      expect([200, 204]).toContain(res.status);
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('rejects preflight OPTIONS from unknown origin http://evil.example', async () => {
      const res = await request(app)
        .options('/api/v1/payments/combined-groups/00000000-0000-0000-0000-000000000001/approve')
        .set('Origin', 'http://evil.example')
        .set('Access-Control-Request-Method', 'POST');

      // Express CORS middleware throws error or does not set allow-origin
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('rejects POST request from unknown origin http://evil.example (fails closed)', async () => {
      const res = await request(app)
        .post('/api/v1/payments/combined-groups/00000000-0000-0000-0000-000000000001/approve')
        .set('Origin', 'http://evil.example')
        .set('Cookie', [`horplus_session=${ownerSessionToken}`, `horplus_csrf=${ownerCsrfToken}`])
        .set('X-CSRF-Token', ownerCsrfToken)
        .set('X-Dormitory-Id', dormId);

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('enforces production CORS fail-closed validation on wildcard', () => {
      expect(() => {
        validateEnv({
          NODE_ENV: 'production',
          DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
          REDIS_URL: 'redis://localhost:6379',
          CORS_ORIGINS: '*',
        });
      }).toThrow("Production CORS origins cannot include wildcard '*'");
    });
  });

  describe('2. Real LOCAL-07 HTTP Mutation Proof (Dedicated Test Group)', () => {
    it('executes authenticated POST from origin http://127.0.0.1:5173 through full approval pipeline', async () => {
      // 1. Create dedicated test cycle, room, contract and bill
      const cycle = await prisma.billingCycle.create({
        data: {
          dormitoryId: dormId,
          cycleCode: `2026-07-${testRunId}`,
          name: 'รอบ ก.ค. 2569 Dedicated Test',
          periodStart: new Date('2026-07-01'),
          periodEnd: new Date('2026-07-31'),
          billingDate: new Date('2026-07-25'),
          dueDate: new Date('2026-08-05'),
          status: 'published',
        },
      });

      const testRoom = await prisma.room.create({
        data: {
          dormitoryId: dormId,
          buildingId: bldId,
          roomNumber: `T-CORS-${testRunId}`,
          normalizedRoomNumber: `TCORS${testRunId}`,
          floor: 1,
          status: 'occupied',
          monthlyRent: 3000,
          monthlyDeposit: 3000,
          termDeposit: 3000,
          dailyDeposit: 500,
        },
      });

      const contract = await prisma.contract.create({
        data: {
          dormitoryId: dormId,
          roomId: testRoom.id,
          tenantId: tenantRecordId,
          contractNumber: `CTR-CORS-${testRunId}`,
          startDate: new Date('2026-07-01'),
          endDate: new Date('2027-06-30'),
          rentAmount: 3000.0,
          depositAmount: 3000.0,
          status: 'active',
        },
      });

      const testBill = await prisma.bill.create({
        data: {
          dormitory: { connect: { id: dormId } },
          room: { connect: { id: testRoom.id } },
          tenant: { connect: { id: tenantRecordId } },
          contract: { connect: { id: contract.id } },
          billingCycle: { connect: { id: cycle.id } },
          billNumber: `INV-CORS-${testRunId}`,
          billKind: 'MONTHLY_UTILITY',
          status: 'UNPAID',
          billingDate: new Date('2026-07-25'),
          dueDate: new Date('2026-08-05'),
          subtotal: '3000.00',
          totalAmount: '3000.00',
          paidAmount: '0.00',
          outstandingAmount: '3000.00',
        },
      });

      await prisma.billItem.create({
        data: {
          dormitoryId: dormId,
          billId: testBill.id,
          type: 'rent',
          description: 'Rent July CORS Test',
          amount: '3000.00',
          unitPrice: '3000.00',
          quantity: 1,
        },
      });

      // 2. Create UNDER_REVIEW group with child payment
      const paymentGroup = await prisma.combinedPaymentGroup.create({
        data: {
          dormitoryId: dormId,
          tenantId: tenantRecordId,
          totalAmount: 3000.0,
          method: 'BANK_TRANSFER',
          status: 'UNDER_REVIEW',
          paymentDate: new Date('2026-08-28T14:30:00Z'),
        },
      });

      await prisma.combinedPaymentGroupBillTarget.create({
        data: {
          dormitoryId: dormId,
          paymentGroupId: paymentGroup.id,
          billId: testBill.id,
          targetOrder: 1,
        },
      });

      await prisma.payment.create({
        data: {
          dormitoryId: dormId,
          billId: testBill.id,
          paymentGroupId: paymentGroup.id,
          tenantId: tenantRecordId,
          amount: 3000.0,
          method: 'BANK_TRANSFER',
          status: 'UNDER_REVIEW',
          paymentDate: new Date('2026-08-28T14:30:00Z'),
        },
      });

      // 3. Send preflight OPTIONS from 127.0.0.1:5173
      const preflightRes = await request(app)
        .options(`/api/v1/payments/combined-groups/${paymentGroup.id}/approve`)
        .set('Origin', 'http://127.0.0.1:5173')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'Content-Type, X-CSRF-Token, X-Dormitory-Id');

      expect([200, 204]).toContain(preflightRes.status);
      expect(preflightRes.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5173');

      // 4. Send authenticated POST mutation from 127.0.0.1:5173
      const approveRes = await request(app)
        .post(`/api/v1/payments/combined-groups/${paymentGroup.id}/approve`)
        .set('Origin', 'http://127.0.0.1:5173')
        .set('Cookie', [`horplus_session=${ownerSessionToken}`, `horplus_csrf=${ownerCsrfToken}`])
        .set('X-CSRF-Token', ownerCsrfToken)
        .set('X-Dormitory-Id', dormId)
        .send({});

      expect(approveRes.status).toBe(200);
      expect(approveRes.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5173');
      expect(approveRes.headers['access-control-allow-credentials']).toBe('true');
      expect(approveRes.body.group.status).toBe('APPROVED');

      // 5. Post-Approval Financial Graph Invariants
      const updatedGroup = await prisma.combinedPaymentGroup.findUnique({
        where: { id: paymentGroup.id },
        include: { receipts: true, payments: true },
      });
      expect(updatedGroup?.status).toBe('APPROVED');
      expect(updatedGroup?.receipts.length).toBe(1);
      expect(Number((updatedGroup?.receipts[0]?.snapshotData as any)?.totalAmount || (updatedGroup?.receipts[0]?.snapshotData as any)?.total)).toBe(3000.0);

      // 6. Confirm database invariants for the settled test bill
      const settledBill = await prisma.bill.findUnique({
        where: { id: testBill.id },
      });
      expect(settledBill?.status).toBe('PAID');
      expect(Number(settledBill?.paidAmount)).toBe(3000);
      expect(Number(settledBill?.outstandingAmount)).toBe(0);
      expect(settledBill?.paidAt).not.toBeNull();
    });
  });
});
