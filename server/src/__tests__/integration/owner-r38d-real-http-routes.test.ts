/**
 * @license Apache-2.0
 * OWNER R3.8d — Production HTTP Route & Error Boundary Integration Tests
 *
 * Tests:
 * 1. Combined slip intent requires CSRF & entitlement -> creates intent & group.
 * 2. Submitting combined slip with x-idempotency-key -> creates under-review group & child payments.
 * 3. Approving group atomically produces exactly 1 group receipt.
 * 4. Reconciliation mismatch (balance changed before approval) -> 400 GROUP_ALLOCATION_RECONCILIATION_FAILED.
 * 5. Duplicate raw slip evidence rejection -> 409 DUPLICATE_PAYMENT_EVIDENCE.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { getEnv, resetCachedEnv } from '../../config/env.js';
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
import { Decimal } from 'decimal.js';

const prisma = getPrismaClient();

describe('OWNER R3.8d: Production HTTP Route & Error Boundary Integration Tests', () => {
  let app: any;
  let authService: AuthenticationService;
  const testRunId = `r38d_http_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

  let dormId: string;
  let bldId: string;
  let ownerUserId: string;
  let ownerSessionToken: string;
  let ownerCsrfToken: string;

  let tenantUserId: string;
  let tenantSessionToken: string;
  let tenantCsrfToken: string;
  let tenantRecordId: string;

  let cycleJulyId: string;
  let cycleAugId: string;

  // Generates valid PNG buffer with unique hash per call
  function generateUniquePng(uniqueTag: string): Buffer {
    const basePng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );
    const tagBuffer = Buffer.from(`_${testRunId}_${uniqueTag}_${Date.now()}_${Math.random()}`);
    return Buffer.concat([basePng, tagBuffer]);
  }

  async function createTestBills(tag: string) {
    const room = await prisma.room.create({
      data: {
        dormitoryId: dormId,
        buildingId: bldId,
        roomNumber: `R-${tag}-${testRunId}`,
        normalizedRoomNumber: `${tag}-${testRunId}`,
        floor: 1,
        status: 'occupied',
        monthlyRent: 4000,
        monthlyDeposit: 4000,
        termDeposit: 4000,
        dailyDeposit: 500,
      },
    });

    await prisma.contract.create({
      data: {
        dormitoryId: dormId,
        roomId: room.id,
        tenantId: tenantRecordId,
        contractNumber: `CTR-${tag}-${testRunId}`,
        startDate: new Date('2026-07-01'),
        endDate: new Date('2027-06-30'),
        rentAmount: 4000.0,
        depositAmount: 4000.0,
        status: 'active',
      },
    });

    const billJuly = await prisma.bill.create({
      data: {
        dormitory: { connect: { id: dormId } },
        room: { connect: { id: room.id } },
        tenant: { connect: { id: tenantRecordId } },
        billingCycle: { connect: { id: cycleJulyId } },
        billNumber: `INV-JULY-${tag}-${testRunId}`,
        billKind: 'MONTHLY_UTILITY',
        status: 'UNPAID',
        billingDate: new Date('2026-07-25'),
        dueDate: new Date('2026-08-05'),
        subtotal: '4000.00',
        totalAmount: '4000.00',
        paidAmount: '0.00',
        outstandingAmount: '4000.00',
      },
    });
    await prisma.billItem.create({
      data: {
        dormitoryId: dormId,
        billId: billJuly.id,
        type: 'rent',
        description: 'ค่าเช่า ก.ค.',
        amount: '4000.00',
        unitPrice: '4000.00',
        quantity: 1,
      },
    });

    const billAug = await prisma.bill.create({
      data: {
        dormitory: { connect: { id: dormId } },
        room: { connect: { id: room.id } },
        tenant: { connect: { id: tenantRecordId } },
        billingCycle: { connect: { id: cycleAugId } },
        billNumber: `INV-AUG-${tag}-${testRunId}`,
        billKind: 'MONTHLY_UTILITY',
        status: 'UNPAID',
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-05'),
        subtotal: '5000.00',
        totalAmount: '5000.00',
        paidAmount: '0.00',
        outstandingAmount: '5000.00',
      },
    });
    await prisma.billItem.create({
      data: {
        dormitoryId: dormId,
        billId: billAug.id,
        type: 'rent',
        description: 'ค่าเช่า ส.ค.',
        amount: '5000.00',
        unitPrice: '5000.00',
        quantity: 1,
      },
    });

    return { room, billJuly, billAug };
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.E2E_TEST_MODE = 'true';
    resetCachedEnv();

    const sensitiveService = new SensitiveFieldService(getEnv().FIELD_ENCRYPTION_KEY, 1);
    const mockGoogleVerifier = {} as any;
    const mockAuditService = { logAction: async () => {} } as any;

    authService = new AuthenticationService(
      getEnv(),
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

    // 1. Seed Subscriptions & create isolated Dormitory with Active Subscription
    await subscriptionEntitlementService.ensureSeeded();
    const freePlan = await prisma.subscriptionPlan.findFirst({ where: { code: 'FREE' } });

    const dorm = await prisma.dormitory.create({
      data: {
        name: `R3.8d HTTP Test Dorm ${testRunId}`,
        status: 'active',
      },
    });
    dormId = dorm.id;

    await prisma.dormitorySubscription.create({
      data: {
        dormitoryId: dormId,
        planId: freePlan!.id,
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 365 * 86400000),
      },
    });

    // 2. Roles
    const ownerRole = (await prisma.role.findFirst({ where: { code: 'owner' } })) ||
      (await prisma.role.create({ data: { code: 'owner', name: 'Owner', permissions: [] } }));
    const tenantRole = (await prisma.role.findFirst({ where: { code: 'tenant' } })) ||
      (await prisma.role.create({ data: { code: 'tenant', name: 'Tenant', permissions: [] } }));

    // 3. Create Owner
    const ownerUser = await prisma.user.create({
      data: {
        email: `owner_${testRunId}@test.com`,
        emailNormalized: `owner_${testRunId}@test.com`,
        googleSubject: `google_owner_${testRunId}`,
        name: 'Owner User',
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

    // 4. Create Tenant User & Tenant Record
    const tenantUser = await prisma.user.create({
      data: {
        email: `tenant_${testRunId}@test.com`,
        emailNormalized: `tenant_${testRunId}@test.com`,
        googleSubject: `google_tenant_${testRunId}`,
        name: 'Tenant User',
      },
    });
    tenantUserId = tenantUser.id;
    await prisma.dormitoryMember.create({
      data: {
        userId: tenantUserId,
        dormitoryId: dormId,
        roleId: tenantRole.id,
        status: 'active',
        membershipOrigin: 'MANUAL_INVITE',
      },
    });

    const tenant = await prisma.tenant.create({
      data: {
        dormitoryId: dormId,
        tenantNumber: `TNT-${testRunId}`,
        firstName: 'ทดสอบ',
        lastName: 'ผู้เช่า',
        displayName: 'ทดสอบ ผู้เช่า',
        linkedUserId: tenantUserId,
        status: 'active',
      },
    });
    tenantRecordId = tenant.id;

    const tenantAuth = await authService.authenticateTestUser(tenantUserId);
    tenantSessionToken = tenantAuth.sessionToken;
    tenantCsrfToken = tenantAuth.csrfToken;

    // 5. Create Building & BillingCycles
    const building = await prisma.building.create({
      data: { dormitoryId: dormId, name: 'อาคาร HTTP Test' },
    });
    bldId = building.id;

    const cycleJuly = await prisma.billingCycle.create({
      data: {
        dormitoryId: dormId,
        cycleCode: `2026-07-${testRunId}`,
        name: 'รอบ ก.ค. 2569',
        periodStart: new Date('2026-07-01'),
        periodEnd: new Date('2026-07-31'),
        billingDate: new Date('2026-07-25'),
        dueDate: new Date('2026-08-05'),
        status: 'active',
      },
    });
    cycleJulyId = cycleJuly.id;

    const cycleAug = await prisma.billingCycle.create({
      data: {
        dormitoryId: dormId,
        cycleCode: `2026-08-${testRunId}`,
        name: 'รอบ ส.ค. 2569',
        periodStart: new Date('2026-08-01'),
        periodEnd: new Date('2026-08-31'),
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-05'),
        status: 'active',
      },
    });
    cycleAugId = cycleAug.id;
  });

  // TEST 1: Combined Slip Intent requires CSRF & entitlement
  it('1. POST /api/v1/payments/combined-slip-intent requires CSRF & Tenant Auth', async () => {
    const { billJuly, billAug } = await createTestBills('t1');

    // Missing CSRF -> 403
    const resNoCsrf = await request(app)
      .post('/api/v1/payments/combined-slip-intent')
      .set('Cookie', [`horplus_session=${tenantSessionToken}`])
      .set('x-dormitory-id', dormId)
      .send({
        dormitoryId: dormId,
        billIds: [billJuly.id, billAug.id],
        mimeType: 'image/png',
        fileSize: 10240,
      });
    expect(resNoCsrf.status).toBe(403);

    // Valid CSRF & Tenant Session -> 200
    const res = await request(app)
      .post('/api/v1/payments/combined-slip-intent')
      .set('Cookie', [`horplus_session=${tenantSessionToken}`, `horplus_csrf=${tenantCsrfToken}`])
      .set('x-csrf-token', tenantCsrfToken)
      .set('x-dormitory-id', dormId)
      .send({
        dormitoryId: dormId,
        billIds: [billJuly.id, billAug.id],
        mimeType: 'image/png',
        fileSize: 10240,
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('intentId');
    expect(res.body).toHaveProperty('groupId');
  });

  // TEST 2: Submit Combined Slip with x-idempotency-key header parity & single receipt approval
  let test2SlipBuffer: Buffer;
  it('2. POST /api/v1/payments/submit-combined-slip accepts x-idempotency-key and creates pending review group', async () => {
    const { billJuly, billAug } = await createTestBills('t2');

    // 1. Create intent
    const intentRes = await request(app)
      .post('/api/v1/payments/combined-slip-intent')
      .set('Cookie', [`horplus_session=${tenantSessionToken}`, `horplus_csrf=${tenantCsrfToken}`])
      .set('x-csrf-token', tenantCsrfToken)
      .set('x-dormitory-id', dormId)
      .send({
        dormitoryId: dormId,
        billIds: [billJuly.id, billAug.id],
        mimeType: 'image/png',
        fileSize: 10240,
      });
    expect(intentRes.status).toBe(200);
    const { intentId, groupId } = intentRes.body;

    // 2. Upload slip via HTTP
    test2SlipBuffer = generateUniquePng('t2');
    const uploadRes = await request(app)
      .post(`/api/v1/payments/slip/upload/${intentId}`)
      .set('Cookie', [`horplus_session=${tenantSessionToken}`, `horplus_csrf=${tenantCsrfToken}`])
      .set('x-csrf-token', tenantCsrfToken)
      .set('x-dormitory-id', dormId)
      .attach('file', test2SlipBuffer, 'slip.png');

    expect(uploadRes.status).toBe(200);

    const submitRes = await request(app)
      .post('/api/v1/payments/submit-combined-slip')
      .set('Cookie', [`horplus_session=${tenantSessionToken}`, `horplus_csrf=${tenantCsrfToken}`])
      .set('x-csrf-token', tenantCsrfToken)
      .set('x-dormitory-id', dormId)
      .set('x-idempotency-key', `idem-submit-${testRunId}`)
      .send({
        dormitoryId: dormId,
        paymentGroupId: groupId,
        intentId,
        amount: '6500.00',
        paymentDate: '2026-08-28T14:30:00.000Z',
      });

    expect(submitRes.status).toBe(200);
    expect(submitRes.body.success).toBe(true);

    // Check that child payments exist and sum to 6500 in UNDER_REVIEW
    const group = await prisma.combinedPaymentGroup.findUnique({
      where: { id: groupId },
      include: { payments: true },
    });
    expect(group?.status).toBe('UNDER_REVIEW');
    expect(group?.payments.length).toBe(2);
    const sumChild = group!.payments.reduce(
      (sum, p) => sum.plus(new Decimal(p.amount.toString())),
      new Decimal(0)
    );
    expect(sumChild.toString()).toBe('6500');

    // 3. Approve Group as Owner -> Exactly ONE group receipt generated
    const approveRes = await request(app)
      .post(`/api/v1/payments/combined-groups/${groupId}/approve`)
      .set('Cookie', [`horplus_session=${ownerSessionToken}`, `horplus_csrf=${ownerCsrfToken}`])
      .set('x-csrf-token', ownerCsrfToken)
      .set('x-dormitory-id', dormId)
      .set('x-idempotency-key', `idem-approve-${testRunId}`)
      .send({});

    expect(approveRes.status).toBe(200);
    expect(approveRes.body.group.status).toBe('APPROVED');

    // Verify exactly ONE Group Receipt exists
    const receipts = await prisma.receipt.findMany({
      where: { paymentGroupId: groupId },
    });
    expect(receipts.length).toBe(1);
    expect(receipts[0].isVoided).toBe(false);
  });

  // TEST 4: Reconciliation Rollback when balance mutated prior to approval
  it('4. POST /api/v1/payments/combined-groups/:id/approve rejects with 400 when bill balance is mutated', async () => {
    const { billJuly, billAug } = await createTestBills('t4');

    const intentRes = await request(app)
      .post('/api/v1/payments/combined-slip-intent')
      .set('Cookie', [`horplus_session=${tenantSessionToken}`, `horplus_csrf=${tenantCsrfToken}`])
      .set('x-csrf-token', tenantCsrfToken)
      .set('x-dormitory-id', dormId)
      .send({
        dormitoryId: dormId,
        billIds: [billJuly.id, billAug.id],
        mimeType: 'image/png',
        fileSize: 10240,
      });
    expect(intentRes.status).toBe(200);
    const { intentId, groupId } = intentRes.body;

    const t4PngBuffer = generateUniquePng('t4');
    const uploadRes = await request(app)
      .post(`/api/v1/payments/slip/upload/${intentId}`)
      .set('Cookie', [`horplus_session=${tenantSessionToken}`, `horplus_csrf=${tenantCsrfToken}`])
      .set('x-csrf-token', tenantCsrfToken)
      .set('x-dormitory-id', dormId)
      .attach('file', t4PngBuffer, 'slip.png');
    expect(uploadRes.status).toBe(200);

    const submitRes = await request(app)
      .post('/api/v1/payments/submit-combined-slip')
      .set('Cookie', [`horplus_session=${tenantSessionToken}`, `horplus_csrf=${tenantCsrfToken}`])
      .set('x-csrf-token', tenantCsrfToken)
      .set('x-dormitory-id', dormId)
      .send({
        dormitoryId: dormId,
        paymentGroupId: groupId,
        intentId,
        amount: '6500.00',
        paymentDate: '2026-08-28T14:30:00.000Z',
      });
    expect(submitRes.status).toBe(200);

    // Mutate billJuly outstanding balance (e.g. cash payment recorded outside)
    await prisma.bill.update({
      where: { id: billJuly.id },
      data: {
        paidAmount: '3000.00',
        outstandingAmount: '1000.00',
      },
    });

    // Owner attempts approval -> MUST FAIL WITH 400 GROUP_ALLOCATION_RECONCILIATION_FAILED
    const failApproveRes = await request(app)
      .post(`/api/v1/payments/combined-groups/${groupId}/approve`)
      .set('Cookie', [`horplus_session=${ownerSessionToken}`, `horplus_csrf=${ownerCsrfToken}`])
      .set('x-csrf-token', ownerCsrfToken)
      .set('x-dormitory-id', dormId)
      .send({});

    expect(failApproveRes.status).toBe(400);
    expect(failApproveRes.body.error.code).toBe('GROUP_ALLOCATION_RECONCILIATION_FAILED');
    expect(failApproveRes.body.error.message).toContain('ยอดคงเหลือของบิลมีการเปลี่ยนแปลงหลังส่งสลิป');

    // Verify group is STILL in UNDER_REVIEW (no partial mutations or corrupted state)
    const untouchedGroup = await prisma.combinedPaymentGroup.findUnique({
      where: { id: groupId },
    });
    expect(untouchedGroup?.status).toBe('UNDER_REVIEW');
  });

  // TEST 5: Duplicate raw evidence rejection
  it('5. Duplicate raw evidence SHA256 returns 409 DUPLICATE_PAYMENT_EVIDENCE', async () => {
    const { billJuly, billAug } = await createTestBills('t5');

    const intentRes = await request(app)
      .post('/api/v1/payments/combined-slip-intent')
      .set('Cookie', [`horplus_session=${tenantSessionToken}`, `horplus_csrf=${tenantCsrfToken}`])
      .set('x-csrf-token', tenantCsrfToken)
      .set('x-dormitory-id', dormId)
      .send({
        dormitoryId: dormId,
        billIds: [billJuly.id, billAug.id],
        mimeType: 'image/png',
        fileSize: 10240,
      });
    expect(intentRes.status).toBe(200);
    const { intentId } = intentRes.body;

    // Upload exact same PNG buffer as TEST 2 (Collision!)
    const dupRes = await request(app)
      .post(`/api/v1/payments/slip/upload/${intentId}`)
      .set('Cookie', [`horplus_session=${tenantSessionToken}`, `horplus_csrf=${tenantCsrfToken}`])
      .set('x-csrf-token', tenantCsrfToken)
      .set('x-dormitory-id', dormId)
      .attach('file', test2SlipBuffer, 'slip.png');

    expect(dupRes.status).toBe(409);
    expect(dupRes.body.error.code).toBe('DUPLICATE_PAYMENT_EVIDENCE');
  });
});
