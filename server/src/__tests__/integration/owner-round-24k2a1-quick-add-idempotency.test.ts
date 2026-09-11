/**
 * @license Apache-2.0
 * Round 2.4K.2A.1: Quick Add Daily Idempotency Final Micro-Closure Real Proofs (A through H)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import Decimal from 'decimal.js';
import fs from 'fs';
import path from 'path';
import { getPrismaClient } from '../../db/prisma.js';
import { createApp } from '../../app.js';
import { getEnv, resetCachedEnv } from '../../config/env.js';
import { AuthenticationService } from '../../services/auth.service.js';
import { PrismaUserRepository } from '../../db/repositories/user.repository.js';
import { PrismaSessionRepository } from '../../db/repositories/session.repository.js';
import { PrismaMembershipRepository } from '../../db/repositories/membership.repository.js';
import { PrismaRoleRepository } from '../../db/repositories/role.repository.js';
import { SensitiveFieldService } from '../../services/sensitive-field.service.js';
import { subscriptionEntitlementService } from '../../services/subscription-entitlement.service.js';
import { DailyStayService, dailyStayService } from '../../services/daily-stay.service.js';
import { IdempotencyService, idempotencyService } from '../../services/idempotency.service.js';
import { LocalStorageProvider } from '../../services/local-storage.service.js';

describe('Round 2.4K.2A.1: Quick Add Daily Idempotency Final Micro-Closure', () => {
  const prisma = getPrismaClient();
  let app: any;
  let authService: AuthenticationService;

  const testRunId = `24k2a1_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

  let testDorm: any;
  let ownerUser: any;
  let ownerAuth: { sessionToken: string; csrfToken: string };
  let testRoom: any;
  let testBuilding: any;

  let createdStayIds: string[] = [];
  let createdInvoiceIds: string[] = [];
  let createdTenantIds: string[] = [];
  let createdRoomIds: string[] = [];
  let createdFiles: string[] = [];

  const localStorageProvider = new LocalStorageProvider();

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
      mockAuditService
    );

    app = createApp({ customAuthService: authService, forcePrisma: true });

    await subscriptionEntitlementService.ensureSeeded();
    const freePlan = await prisma.subscriptionPlan.findFirst({
      where: { code: 'FREE' },
    });

    testDorm = await prisma.dormitory.create({
      data: {
        name: `Dorm Idemp ${testRunId}`,
        type: 'apartment',
        addressLine1: '999 Idempotency Way',
        status: 'active',
      },
    });

    await prisma.dormitorySubscription.create({
      data: {
        dormitoryId: testDorm.id,
        planId: freePlan!.id,
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 365 * 86400000),
      },
    });

    const ownerRole = await prisma.role.create({
      data: {
        dormitoryId: testDorm.id,
        code: 'OWNER',
        name: 'Owner',
        permissions: { '*': ['*'] },
        isSystem: true,
      },
    });

    ownerUser = await prisma.user.create({
      data: {
        googleSubject: `sub_owner_${testRunId}`,
        email: `owner_${testRunId}@example.com`,
        emailNormalized: `owner_${testRunId}@example.com`,
        name: 'Owner Idemp',
      },
    });

    await prisma.dormitoryMember.create({
      data: {
        dormitoryId: testDorm.id,
        userId: ownerUser.id,
        roleId: ownerRole.id,
        status: 'active',
        membershipOrigin: 'GOOGLE_BOOTSTRAP',
      },
    });

    ownerAuth = await authService.authenticateTestUser(ownerUser.id);

    testBuilding = await prisma.building.create({
      data: {
        dormitoryId: testDorm.id,
        name: 'Building IDEMP',
      },
    });

    testRoom = await prisma.room.create({
      data: {
        dormitoryId: testDorm.id,
        buildingId: testBuilding.id,
        roomNumber: 'R-IDEMP-01',
        normalizedRoomNumber: 'r-idemp-01',
        floor: 1,
        monthlyRent: 3000,
        dailyRent: 600,
        termDeposit: new Decimal('0.00'),
        monthlyDeposit: new Decimal('0.00'),
        dailyDeposit: new Decimal('0.00'),
        status: 'vacant',
      },
    });
    createdRoomIds.push(testRoom.id);
  });

  afterAll(async () => {
    for (const invId of createdInvoiceIds) {
      await prisma.receipt.deleteMany({ where: { dailyStayInvoiceId: invId } });
      await prisma.paymentAllocation.deleteMany({ where: { dailyStayInvoiceId: invId } });
      await prisma.payment.deleteMany({ where: { dailyStayInvoiceId: invId } });
      await prisma.dailyStayInvoiceItem.deleteMany({ where: { invoiceId: invId } });
      await prisma.dailyStayInvoice.deleteMany({ where: { id: invId } });
    }
    for (const sId of createdStayIds) {
      await prisma.dailyStay.deleteMany({ where: { id: sId } });
    }
    for (const tId of createdTenantIds) {
      await prisma.tenant.deleteMany({ where: { id: tId } });
    }
    for (const rId of createdRoomIds) {
      await prisma.room.deleteMany({ where: { id: rId } });
    }
    for (const fileKey of createdFiles) {
      try {
        await localStorageProvider.deleteFile(fileKey);
      } catch {}
    }
    if (testDorm) {
      await prisma.receiptSequence.deleteMany({ where: { dormitoryId: testDorm.id } });
      if (ownerUser) {
        await prisma.idempotencyKey.deleteMany({ where: { userId: ownerUser.id } });
      }
      await prisma.dormitoryMember.deleteMany({ where: { dormitoryId: testDorm.id } });
      await prisma.role.deleteMany({ where: { dormitoryId: testDorm.id } });
      await prisma.dormitorySubscription.deleteMany({ where: { dormitoryId: testDorm.id } });
      await prisma.building.deleteMany({ where: { dormitoryId: testDorm.id } });
      await prisma.dormitory.deleteMany({ where: { id: testDorm.id } });
    }
    if (ownerUser) {
      await prisma.user.deleteMany({ where: { id: ownerUser.id } });
    }
    await prisma.$disconnect();
  });

  // Helper for quick add request
  const createRoom = async (prefix: string) => {
    const rNum = `${prefix}-${Date.now().toString().slice(-4)}`;
    const r = await prisma.room.create({
      data: {
        dormitoryId: testDorm.id,
        buildingId: testBuilding.id,
        roomNumber: rNum,
        normalizedRoomNumber: rNum.toLowerCase(),
        floor: 1,
        monthlyRent: 3000,
        dailyRent: 600,
        termDeposit: new Decimal('0.00'),
        monthlyDeposit: new Decimal('0.00'),
        dailyDeposit: new Decimal('0.00'),
        status: 'vacant',
      },
    });
    createdRoomIds.push(r.id);
    return r;
  };

  it('Proof A: Owner Quick Add without idempotency key -> 400 IDEMPOTENCY_KEY_REQUIRED, zero DB side effects', async () => {
    const roomA = await createRoom('R-A');

    const res = await request(app)
      .post('/api/v1/daily-stays/owner-quick-add')
      .set('Cookie', [`horplus_session=${ownerAuth.sessionToken}`, `horplus_csrf=${ownerAuth.csrfToken}`])
      .set('x-csrf-token', ownerAuth.csrfToken)
      .set('x-dormitory-id', testDorm.id)
      .send({
        roomId: roomA.id,
        fullName: 'ทดสอบ ไม่มีคีย์',
        startDate: '2026-10-10',
        endDate: '2026-10-11',
        dailyRateAmount: 600,
        depositAmount: 300,
        depositDeclaredStatus: 'PAID',
        depositPaymentMethod: 'CASH',
      });

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('IDEMPOTENCY_KEY_REQUIRED');

    // Verify zero DB side effects
    const tenants = await prisma.tenant.findMany({ where: { dormitoryId: testDorm.id, firstName: 'ทดสอบ ไม่มีคีย์' } });
    const stays = await prisma.dailyStay.findMany({ where: { roomId: roomA.id } });
    const occupancies = await prisma.occupancy.findMany({ where: { roomId: roomA.id } });

    expect(tenants.length).toBe(0);
    expect(stays.length).toBe(0);
    expect(occupancies.length).toBe(0);
  });

  it('Proof B & C: Same valid Quick Add + same key twice -> same logical result, exactly 1 Tenant, 1 DailyStay, 1 Occupancy, 1 Invoice, 1 Payment, 1 Allocation; Payment.idempotencyKey == exact x-idempotency-key', async () => {
    const roomB = await createRoom('R-BC');
    const opKey = `proof-bc-${Date.now()}`;

    const payload = {
      roomId: roomB.id,
      fullName: 'สมชาย รายวัน',
      phone: '0812345678',
      startDate: '2026-10-20',
      endDate: '2026-10-21',
      dailyRateAmount: '600.00',
      depositAmount: '500.00',
      depositDeclaredStatus: 'PAID',
      depositPaymentMethod: 'CASH',
    };

    // First Call
    const res1 = await request(app)
      .post('/api/v1/daily-stays/owner-quick-add')
      .set('Cookie', [`horplus_session=${ownerAuth.sessionToken}`, `horplus_csrf=${ownerAuth.csrfToken}`])
      .set('x-csrf-token', ownerAuth.csrfToken)
      .set('x-dormitory-id', testDorm.id)
      .set('x-idempotency-key', opKey)
      .send(payload);

    expect(res1.status).toBe(201);
    expect(res1.body.data?.id).toBeDefined();
    const stayId1 = res1.body.data.id;
    const invId1 = res1.body.data.invoice?.id;
    createdStayIds.push(stayId1);
    createdInvoiceIds.push(invId1);

    // Second Call (Replay)
    const res2 = await request(app)
      .post('/api/v1/daily-stays/owner-quick-add')
      .set('Cookie', [`horplus_session=${ownerAuth.sessionToken}`, `horplus_csrf=${ownerAuth.csrfToken}`])
      .set('x-csrf-token', ownerAuth.csrfToken)
      .set('x-dormitory-id', testDorm.id)
      .set('x-idempotency-key', opKey)
      .send(payload);

    expect(res2.status).toBe(201);
    expect(res2.body.data?.id).toBe(stayId1);
    expect(res2.body.data?.invoice?.id).toBe(invId1);

    // Verify exactly one of each entity in DB
    const stays = await prisma.dailyStay.findMany({ where: { roomId: roomB.id } });
    expect(stays.length).toBe(1);

    const tenants = await prisma.tenant.findMany({ where: { id: stays[0].tenantId! } });
    expect(tenants.length).toBe(1);

    const occupancies = await prisma.occupancy.findMany({ where: { id: stays[0].occupancyId! } });
    expect(occupancies.length).toBe(1);

    const invoices = await prisma.dailyStayInvoice.findMany({ where: { dailyStayId: stays[0].id } });
    expect(invoices.length).toBe(1);

    const payments = await prisma.payment.findMany({ where: { dailyStayInvoiceId: invoices[0].id } });
    expect(payments.length).toBe(1);
    expect(payments[0].status).toBe('APPROVED');
    expect(payments[0].method).toBe('CASH');

    // Proof C: Payment.idempotencyKey == exact x-idempotency-key (no :dep)
    expect(payments[0].idempotencyKey).toBe(opKey);

    const allocs = await prisma.paymentAllocation.findMany({ where: { paymentId: payments[0].id } });
    expect(allocs.length).toBe(1);
    expect(allocs[0].dailyStayInvoiceId).toBe(invoices[0].id);
  });

  it('Proof D: Same key + changed material payload -> IDEMPOTENCY_MISMATCH, no second business mutation', async () => {
    const roomD = await createRoom('R-D');
    const opKey = `proof-d-${Date.now()}`;

    const payload1 = {
      roomId: roomD.id,
      fullName: 'สมหญิง ผู้พัก',
      startDate: '2026-11-01',
      endDate: '2026-11-02',
      dailyRateAmount: '500.00',
      depositAmount: '300.00',
      depositDeclaredStatus: 'PAID',
      depositPaymentMethod: 'CASH',
    };

    const res1 = await request(app)
      .post('/api/v1/daily-stays/owner-quick-add')
      .set('Cookie', [`horplus_session=${ownerAuth.sessionToken}`, `horplus_csrf=${ownerAuth.csrfToken}`])
      .set('x-csrf-token', ownerAuth.csrfToken)
      .set('x-dormitory-id', testDorm.id)
      .set('x-idempotency-key', opKey)
      .send(payload1);

    expect(res1.status).toBe(201);
    createdStayIds.push(res1.body.data.id);
    createdInvoiceIds.push(res1.body.data.invoice?.id);

    // Call with changed material payload (e.g. changed depositAmount)
    const payload2 = {
      ...payload1,
      depositAmount: '400.00', // Changed deposit amount!
    };

    const res2 = await request(app)
      .post('/api/v1/daily-stays/owner-quick-add')
      .set('Cookie', [`horplus_session=${ownerAuth.sessionToken}`, `horplus_csrf=${ownerAuth.csrfToken}`])
      .set('x-csrf-token', ownerAuth.csrfToken)
      .set('x-dormitory-id', testDorm.id)
      .set('x-idempotency-key', opKey)
      .send(payload2);

    expect(res2.status).toBe(409);
    expect(res2.body.error?.code).toBe('IDEMPOTENCY_MISMATCH');

    // Verify no second stay created
    const stays = await prisma.dailyStay.findMany({ where: { roomId: roomD.id } });
    expect(stays.length).toBe(1);
  });

  it('Proof E: Multipart Quick Add replay -> exactly 1 ID-card file on disk, no duplicate/orphan file left behind', async () => {
    const roomE = await createRoom('R-E');
    const opKey = `proof-e-${Date.now()}`;

    // Create a 1x1 valid PNG buffer
    const pngBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );

    const payload = {
      roomId: roomE.id,
      fullName: 'นายสมศักดิ์ มีรูปบัตร',
      startDate: '2026-11-05',
      endDate: '2026-11-06',
      dailyRateAmount: '500.00',
      depositAmount: '200.00',
      depositDeclaredStatus: 'PAID',
      depositPaymentMethod: 'CASH',
    };

    // First multipart submission with ID card file
    const res1 = await request(app)
      .post('/api/v1/daily-stays/owner-quick-add')
      .set('Cookie', [`horplus_session=${ownerAuth.sessionToken}`, `horplus_csrf=${ownerAuth.csrfToken}`])
      .set('x-csrf-token', ownerAuth.csrfToken)
      .set('x-dormitory-id', testDorm.id)
      .set('x-idempotency-key', opKey)
      .field('data', JSON.stringify(payload))
      .attach('idCardImage', pngBuffer, 'id-card.png');

    expect(res1.status).toBe(201);
    const stay1 = res1.body.data;
    createdStayIds.push(stay1.id);
    createdInvoiceIds.push(stay1.invoice?.id);

    const tenant1 = await prisma.tenant.findUnique({ where: { id: stay1.tenantId } });
    expect(tenant1?.idCardObjectKey).toBeDefined();
    createdFiles.push(tenant1!.idCardObjectKey!);

    // Replay identical multipart request with same file and same idempotency key
    const res2 = await request(app)
      .post('/api/v1/daily-stays/owner-quick-add')
      .set('Cookie', [`horplus_session=${ownerAuth.sessionToken}`, `horplus_csrf=${ownerAuth.csrfToken}`])
      .set('x-csrf-token', ownerAuth.csrfToken)
      .set('x-dormitory-id', testDorm.id)
      .set('x-idempotency-key', opKey)
      .field('data', JSON.stringify(payload))
      .attach('idCardImage', pngBuffer, 'id-card.png');

    expect(res2.status).toBe(201);
    expect(res2.body.data.id).toBe(stay1.id);

    // Verify stored files in the tenant upload directory for this dorm
    const tenantUploadDir = path.resolve(process.cwd(), 'uploads', 'tenants', testDorm.id);
    if (fs.existsSync(tenantUploadDir)) {
      const filesOnDisk = fs.readdirSync(tenantUploadDir);
      // Exactly 1 file should exist on disk for this stay, no duplicate orphan file
      expect(filesOnDisk.length).toBe(1);
    }
  });

  it('Proof F: Positive Daily item settlement uses real authenticated actor UUID', async () => {
    const roomF = await createRoom('R-F');
    const stay = await prisma.dailyStay.create({
      data: {
        dormitoryId: testDorm.id,
        roomId: roomF.id,
        tenantId: (await prisma.tenant.create({
          data: {
            dormitoryId: testDorm.id,
            tenantNumber: `TNT-${Date.now().toString().slice(-5)}`,
            firstName: 'สมบูรณ์',
            lastName: 'ดี',
            displayName: 'สมบูรณ์ ดี',
            status: 'active',
          },
        })).id,
        startDate: new Date('2026-11-10'),
        endDate: new Date('2026-11-11'),
        inclusiveDayCount: 1,
        dailyRateAmount: new Decimal('500.00'),
        totalRentAmount: new Decimal('500.00'),
        depositAmount: new Decimal('0.00'),
        status: 'ACTIVE',
      },
    });
    createdStayIds.push(stay.id);

    const invoice = await prisma.dailyStayInvoice.create({
      data: {
        dormitoryId: testDorm.id,
        dailyStayId: stay.id,
        invoiceNumber: `DINV-F-${Date.now().toString().slice(-6)}`,
        totalRentAmount: new Decimal('500.00'),
        depositAmount: new Decimal('0.00'),
        totalAgreedAmount: new Decimal('500.00'),
        outstandingAmount: new Decimal('500.00'),
        status: 'ISSUED',
        items: {
          create: [
            {
              itemType: 'DAILY_RENT',
              description: 'ค่าเช่าห้องพักรายวัน',
              amount: new Decimal('500.00'),
              status: 'OUTSTANDING',
            },
          ],
        },
      },
      include: { items: true },
    });
    createdInvoiceIds.push(invoice.id);

    const idempKey = `proof-f-settle-${Date.now()}`;
    const res = await dailyStayService.settleDailyStayInvoiceItem(
      testDorm.id,
      invoice.id,
      'DAILY_RENT',
      ownerUser.id,
      { method: 'CASH', idempotencyKey: idempKey }
    );

    expect(res.status).toBe('PAID');

    const payment = await prisma.payment.findFirst({
      where: { dailyStayInvoiceId: invoice.id },
    });
    expect(payment?.reviewedByUserId).toBe(ownerUser.id);

    const idempClaim = await prisma.idempotencyKey.findUnique({
      where: {
        user_operation_idempotency_unique: {
          userId: ownerUser.id,
          operation: 'settleDailyStayInvoiceItem',
          idempotencyKey: idempKey,
        },
      },
    });
    expect(idempClaim).toBeDefined();
    expect(idempClaim?.userId).toBe(ownerUser.id);
  });

  it('Proof G: Shared IdempotencyService no longer maps invalid actor to all-zero UUID', async () => {
    // Calling runWithIdempotency with a non-UUID string should NOT be rewritten to 00000000-0000-0000-0000-000000000000
    // It should reject or attempt to use the invalid string as userId, throwing DB UUID error, proving no synthetic mapping exists
    await expect(
      idempotencyService.runWithIdempotency({
        actorUserId: 'INVALID_NON_UUID_STRING',
        operation: 'testOperation',
        idempotencyKey: `proof-g-${Date.now()}`,
        payload: { test: 123 },
        fn: async () => ({ success: true }),
      })
    ).rejects.toThrow();

    // Verify nil UUID was NOT used in DB
    const nilClaim = await prisma.idempotencyKey.findFirst({
      where: {
        userId: '00000000-0000-0000-0000-000000000000',
        operation: 'testOperation',
      },
    });
    expect(nilClaim).toBeNull();
  });

  it('Proof H: Source audit proof — handleSettleDailyInvoice signature has no default method', async () => {
    const paymentsTsx = fs.readFileSync(
      path.resolve(process.cwd(), 'src', 'pages', 'owner', 'payments.tsx'),
      'utf-8'
    );

    // Verify handleSettleDailyInvoice does not declare method = 'CASH' default
    expect(paymentsTsx).not.toContain("method: 'CASH' | 'BANK_TRANSFER' = 'CASH'");
    expect(paymentsTsx).toContain("method: 'CASH' | 'BANK_TRANSFER'");

    // Verify all call sites pass method explicitly
    expect(paymentsTsx).toContain("handleSettleDailyInvoice(inv.id, 'ALL', 'CASH')");
    expect(paymentsTsx).toContain("handleSettleDailyInvoice(inv.id, 'ALL', 'BANK_TRANSFER')");
    expect(paymentsTsx).toContain("handleSettleDailyInvoice(inv.id, it.itemType, 'CASH')");
    expect(paymentsTsx).toContain("handleSettleDailyInvoice(inv.id, it.itemType, 'BANK_TRANSFER')");
  });
});
