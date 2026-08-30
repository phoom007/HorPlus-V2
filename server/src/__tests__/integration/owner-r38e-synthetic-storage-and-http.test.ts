/**
 * @license Apache-2.0
 * OWNER R3.8e — Synthetic Storage & Direct-Consumer HTTP Integration Tests
 *
 * Covers:
 * Section J: Room 302 synthetic evidence storage proof (objectKey, dimensions, fileExists, getFile)
 * Section H: Production HTTP route direct consumers:
 *   - Combined group reject (Group + children REJECTED, Bill unchanged, no Receipt)
 *   - Entitlement-denied combined-slip mutation (403 SUBSCRIPTION_READ_ONLY)
 *   - Group approval idempotency
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
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
import { localStorageProvider } from '../../services/local-storage.service.js';
import { generateSyntheticSlipPng } from '../../utils/synthetic-slip.util.js';

const prisma = getPrismaClient();

describe('OWNER R3.8e: Synthetic Storage & Direct-Consumer HTTP Integration Tests', () => {
  let app: any;
  let authService: AuthenticationService;
  const testRunId = `r38e_http_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

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

    // 1. Seed Subscriptions & create active Dormitory
    await subscriptionEntitlementService.ensureSeeded();
    const freePlan = await prisma.subscriptionPlan.findFirst({ where: { code: 'FREE' } });

    const dorm = await prisma.dormitory.create({
      data: {
        name: `R3.8e Storage/HTTP Test Dorm ${testRunId}`,
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

    // 2. Roles & Users
    const ownerRole = (await prisma.role.findFirst({ where: { code: 'owner' } })) ||
      (await prisma.role.create({ data: { code: 'owner', name: 'Owner', permissions: [] } }));
    const tenantRole = (await prisma.role.findFirst({ where: { code: 'tenant' } })) ||
      (await prisma.role.create({ data: { code: 'tenant', name: 'Tenant', permissions: [] } }));

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

    // 3. Building & Billing Cycles
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

  // =========================================================================
  // SECTION J: SYNTHETIC EVIDENCE STORAGE PROOF
  // =========================================================================

  it('SECTION J: Room 302 synthetic evidence file generation, storage provider verification, and dimensions', async () => {
    const objectKey = 'fixtures/slips/local-uat-test-slip-room302.png';
    const syntheticBuffer = await generateSyntheticSlipPng({
      roomNumber: 'ROOM 302',
      amount: 6500,
      claimedDate: '2026-08-28 14:30',
      status: 'UNVERIFIED',
      title: 'LOCAL UAT TEST SLIP',
      subtitle: 'NOT REAL',
    });

    // Save via canonical localStorageProvider
    await localStorageProvider.saveFile(objectKey, syntheticBuffer);

    // Assert fileExists
    const exists = await localStorageProvider.fileExists(objectKey);
    expect(exists).toBe(true);

    // Retrieve via getFile
    const retrievedBuffer = await localStorageProvider.getFile(objectKey);
    expect(retrievedBuffer.length).toBeGreaterThan(1000);

    // Assert sharp metadata dimensions: width >= 400, height >= 200
    const meta = await sharp(retrievedBuffer).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBeGreaterThanOrEqual(400);
    expect(meta.height).toBeGreaterThanOrEqual(200);
  });

  // =========================================================================
  // SECTION H: HTTP DIRECT-CONSUMER TESTS
  // =========================================================================

  it('SECTION H.1: Combined group reject via POST /api/v1/payments/combined-groups/:id/reject atomically marks group & children REJECTED without mutating Bills or creating Receipts', async () => {
    const { billJuly, billAug } = await createTestBills('h1_reject');

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

    const slipBuffer = await generateSyntheticSlipPng({ roomNumber: `ROOM H1 ${testRunId}_${Math.random()}` });
    await request(app)
      .post(`/api/v1/payments/slip/upload/${intentId}`)
      .set('Cookie', [`horplus_session=${tenantSessionToken}`, `horplus_csrf=${tenantCsrfToken}`])
      .set('x-csrf-token', tenantCsrfToken)
      .set('x-dormitory-id', dormId)
      .attach('file', slipBuffer, 'slip.png');

    await request(app)
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

    // 2. Reject Group via HTTP
    const rejectRes = await request(app)
      .post(`/api/v1/payments/combined-groups/${groupId}/reject`)
      .set('Cookie', [`horplus_session=${ownerSessionToken}`, `horplus_csrf=${ownerCsrfToken}`])
      .set('x-csrf-token', ownerCsrfToken)
      .set('x-dormitory-id', dormId)
      .send({ reason: 'สลิปไม่ชัดเจน' });

    expect(rejectRes.status).toBe(200);

    // 3. Verify Database: Group is REJECTED, Child Payments REJECTED
    const groupDb = await prisma.combinedPaymentGroup.findUnique({
      where: { id: groupId },
      include: { payments: true, receipts: true },
    });
    expect(groupDb?.status).toBe('REJECTED');
    expect(groupDb?.payments.length).toBe(2);
    for (const p of groupDb!.payments) {
      expect(p.status).toBe('REJECTED');
    }
    expect(groupDb?.receipts.length).toBe(0);

    // 4. Verify Bills: still UNPAID, outstanding untouched
    const billJulyDb = await prisma.bill.findUnique({ where: { id: billJuly.id } });
    const billAugDb = await prisma.bill.findUnique({ where: { id: billAug.id } });
    expect(billJulyDb?.status).toBe('UNPAID');
    expect(billJulyDb?.outstandingAmount.toString()).toBe('4000');
    expect(billAugDb?.status).toBe('UNPAID');
    expect(billAugDb?.outstandingAmount.toString()).toBe('5000');

    // No receipts created in system
    const receiptCount = await prisma.receipt.count({ where: { paymentGroupId: groupId } });
    expect(receiptCount).toBe(0);
  });

  it('SECTION H.2: Entitlement-denied combined-slip mutation on READ_ONLY dormitory returns 403', async () => {
    // Create separate read-only dormitory (expired subscription)
    const expiredDorm = await prisma.dormitory.create({
      data: { name: `Expired Dorm ${testRunId}`, status: 'active' },
    });
    const freePlan = await prisma.subscriptionPlan.findFirst({ where: { code: 'FREE' } });

    await prisma.dormitorySubscription.create({
      data: {
        dormitoryId: expiredDorm.id,
        planId: freePlan!.id,
        status: 'EXPIRED',
        expiresAt: new Date('2020-01-01'),
      },
    });

    const tenantRole = await prisma.role.findFirst({ where: { code: 'tenant' } });
    await prisma.dormitoryMember.create({
      data: {
        userId: tenantUserId,
        dormitoryId: expiredDorm.id,
        roleId: tenantRole!.id,
        status: 'active',
        membershipOrigin: 'MANUAL_INVITE',
      },
    });

    const res = await request(app)
      .post('/api/v1/payments/combined-slip-intent')
      .set('Cookie', [`horplus_session=${tenantSessionToken}`, `horplus_csrf=${tenantCsrfToken}`])
      .set('x-csrf-token', tenantCsrfToken)
      .set('x-dormitory-id', expiredDorm.id)
      .send({
        dormitoryId: expiredDorm.id,
        billIds: ['00000000-0000-0000-0000-000000000001'],
        mimeType: 'image/png',
        fileSize: 10240,
      });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SUBSCRIPTION_READ_ONLY');
  });

  it('SECTION H.3: Combined group approval idempotency with x-idempotency-key header', async () => {
    const { billJuly, billAug } = await createTestBills('h3_idem');

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
    const { intentId, groupId } = intentRes.body;

    const slipBuffer = await generateSyntheticSlipPng({ roomNumber: `ROOM H3 ${testRunId}_${Math.random()}` });
    await request(app)
      .post(`/api/v1/payments/slip/upload/${intentId}`)
      .set('Cookie', [`horplus_session=${tenantSessionToken}`, `horplus_csrf=${tenantCsrfToken}`])
      .set('x-csrf-token', tenantCsrfToken)
      .set('x-dormitory-id', dormId)
      .attach('file', slipBuffer, 'slip.png');

    await request(app)
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

    const idemKey = `idem-approve-h3-${testRunId}`;

    // First approval request
    const firstRes = await request(app)
      .post(`/api/v1/payments/combined-groups/${groupId}/approve`)
      .set('Cookie', [`horplus_session=${ownerSessionToken}`, `horplus_csrf=${ownerCsrfToken}`])
      .set('x-csrf-token', ownerCsrfToken)
      .set('x-dormitory-id', dormId)
      .set('x-idempotency-key', idemKey)
      .send({});

    expect(firstRes.status).toBe(200);
    expect(firstRes.body.group.status).toBe('APPROVED');

    // Duplicate replay request with same idempotency key
    const replayRes = await request(app)
      .post(`/api/v1/payments/combined-groups/${groupId}/approve`)
      .set('Cookie', [`horplus_session=${ownerSessionToken}`, `horplus_csrf=${ownerCsrfToken}`])
      .set('x-csrf-token', ownerCsrfToken)
      .set('x-dormitory-id', dormId)
      .set('x-idempotency-key', idemKey)
      .send({});

    expect(replayRes.status).toBe(200);

    // Verify still exactly 1 receipt created
    const receipts = await prisma.receipt.findMany({ where: { paymentGroupId: groupId } });
    expect(receipts.length).toBe(1);
  });
});
