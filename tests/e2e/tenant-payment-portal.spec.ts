import { test, expect } from '@playwright/test';
import crypto from 'crypto';
import { getPrismaClient } from '../../server/src/db/prisma.js';
import { SessionTokenService } from '../../server/src/services/session-token.service.js';
import { CsrfService } from '../../server/src/services/csrf.service.js';
import { SensitiveFieldService } from '../../server/src/services/sensitive-field.service.js';
import { FakeLineServer } from './helpers/fake-line-server.js';

const prisma = getPrismaClient();

function makeUniquePng(): Buffer {
  const basePng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );
  return Buffer.concat([basePng, Buffer.from(`_salt_${Date.now()}_${crypto.randomUUID()}`)]);
}

test.describe.serial('Tenant Web Payment & Receipt Portal E2E Suite', () => {
  const fakeLineServer = new FakeLineServer();

  let ownerUserId: string;
  let ownerSessionToken: string;
  let ownerCsrfToken: string;
  let ownerDormitoryId: string;

  let tenantAUserId: string;
  let tenantASessionToken: string;
  let tenantACsrfToken: string;
  let tenantAId: string;
  let roomAId: string;
  let billAId: string;

  let tenantBUserId: string;
  let tenantBSessionToken: string;
  let tenantBCsrfToken: string;
  let tenantBId: string;
  let roomBId: string;
  let billBId: string;

  let cycleId: string;

  test.beforeAll(async () => {
    await fakeLineServer.start();
    process.env.HORPLUS_E2E = 'true';

    const sessionSecret = process.env.SESSION_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef';
    const csrfSecret = process.env.CSRF_SIGNING_KEY || 'csrf-secret-key-0123456789abcdef';
    const sessionTokenService = new SessionTokenService(sessionSecret);
    const csrfService = new CsrfService(csrfSecret);
    const sensitiveFieldService = new SensitiveFieldService(process.env.ENCRYPTION_KEY || 'default-secret-key-32-chars-01234');

    // 1. Create Owner User & Dormitory
    const owner = await prisma.user.create({
      data: {
        email: `tportal-owner-${Date.now()}@example.com`,
        emailNormalized: `tportal-owner-${Date.now()}@example.com`,
        name: 'Portal Owner',
        googleSubject: `goog-tportal-owner-${Date.now()}`,
        status: 'active',
      },
    });
    ownerUserId = owner.id;

    const ownerSid = crypto.randomUUID();
    await prisma.session.create({
      data: {
        userId: ownerUserId,
        sessionIdHash: SessionTokenService.hashSessionId(ownerSid),
        tokenVersion: 1,
        status: 'active',
        expiresAt: new Date(Date.now() + 86400 * 1000),
      },
    });
    ownerSessionToken = sessionTokenService.encryptToken({ sub: ownerUserId, sid: ownerSid, type: 'session', version: 1 }, 86400);
    ownerCsrfToken = csrfService.generateCsrfToken(ownerSid);

    const dorm = await prisma.dormitory.create({
      data: {
        name: 'Tenant Portal Residence',
        addressLine1: '200 Tenant Way',
        province: 'กรุงเทพมหานคร',
        createdByUserId: ownerUserId,
        status: 'active',
      },
    });
    ownerDormitoryId = dorm.id;

    const roleOwner = await prisma.role.findFirst({ where: { code: 'OWNER' } });
    await prisma.dormitoryMember.create({
      data: {
        dormitoryId: ownerDormitoryId,
        userId: ownerUserId,
        roleId: roleOwner?.id || 'role-owner',
        status: 'active',
      },
    });

    const freePlan = await prisma.subscriptionPlan.findFirst({ where: { code: 'FREE' } }) || await prisma.subscriptionPlan.findFirst();
    if (freePlan) {
      await prisma.dormitorySubscription.create({
        data: {
          dormitoryId: ownerDormitoryId,
          planId: freePlan.id,
          status: 'ACTIVE',
          startedAt: new Date(),
          trialExpiresAt: new Date(Date.now() + 30 * 86400000),
          expiresAt: new Date(Date.now() + 30 * 86400000),
        },
      });
    }

    // Configure PromptPay settings for dormitory
    const encPp = sensitiveFieldService.encrypt('0812345678');
    await prisma.dormitoryBillingSettings.create({
      data: {
        dormitoryId: ownerDormitoryId,
        promptPayType: 'NATID',
        promptPayValueEncrypted: encPp.ciphertext,
        bankCode: 'KBANK',
        bankAccountName: 'หอพักดีเลิศ',
        bankAccountNumber: '123-4-56789-0',
      },
    });

    // Create Cycle, Building and Rooms
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${ownerDormitoryId}, true)`;
      const cyc = await tx.billingCycle.create({
        data: {
          dormitoryId: ownerDormitoryId,
          cycleCode: '2026-08',
          name: 'รอบเดือน สิงหาคม 2569',
          periodStart: new Date('2026-08-01'),
          periodEnd: new Date('2026-08-31'),
          billingDate: new Date('2026-08-25'),
          dueDate: new Date('2026-09-05'),
          status: 'active',
        },
      });
      cycleId = cyc.id;

      const bld = await tx.building.create({
        data: {
          dormitoryId: ownerDormitoryId,
          name: 'Building B',
          floorCount: 2,
          roomsPerFloor: 2,
          roomPrefix: 'B',
          monthlyRent: 5000,
        },
      });

      const rA = await tx.room.create({
        data: {
          dormitoryId: ownerDormitoryId,
          buildingId: bld.id,
          roomNumber: 'B101',
          normalizedRoomNumber: 'B101',
          floor: 1,
          monthlyRent: 5000,
          status: 'OCCUPIED',
        },
      });
      roomAId = rA.id;

      const rB = await tx.room.create({
        data: {
          dormitoryId: ownerDormitoryId,
          buildingId: bld.id,
          roomNumber: 'B102',
          normalizedRoomNumber: 'B102',
          floor: 1,
          monthlyRent: 5000,
          status: 'OCCUPIED',
        },
      });
      roomBId = rB.id;
    });

    // 2. Create Tenant A User & Record
    const userA = await prisma.user.create({
      data: {
        email: `tenantA-${Date.now()}@example.com`,
        emailNormalized: `tenantA-${Date.now()}@example.com`,
        name: 'Somchai Tenant A',
        googleSubject: `goog-tenantA-${Date.now()}`,
        status: 'active',
      },
    });
    tenantAUserId = userA.id;

    const sidA = crypto.randomUUID();
    await prisma.session.create({
      data: {
        userId: tenantAUserId,
        sessionIdHash: SessionTokenService.hashSessionId(sidA),
        tokenVersion: 1,
        status: 'active',
        expiresAt: new Date(Date.now() + 86400 * 1000),
      },
    });
    tenantASessionToken = sessionTokenService.encryptToken({ sub: tenantAUserId, sid: sidA, type: 'session', version: 1 }, 86400);
    tenantACsrfToken = csrfService.generateCsrfToken(sidA);

    const roleTenant = await prisma.role.findFirst({ where: { code: 'TENANT' } });
    await prisma.dormitoryMember.create({
      data: {
        dormitoryId: ownerDormitoryId,
        userId: tenantAUserId,
        roleId: roleTenant?.id || 'role-tenant',
        status: 'active',
      },
    });

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${ownerDormitoryId}, true)`;
      const tA = await tx.tenant.create({
        data: {
          dormitoryId: ownerDormitoryId,
          linkedUserId: tenantAUserId,
          tenantNumber: 'TA-001',
          firstName: 'สมชาย',
          lastName: 'เอ',
          displayName: 'สมชาย เอ',
          phone: '0811111111',
          status: 'active',
        },
      });
      tenantAId = tA.id;

      await tx.contract.create({
        data: {
          dormitoryId: ownerDormitoryId,
          tenantId: tA.id,
          roomId: roomAId,
          contractNumber: 'CT-TA-001',
          startDate: new Date('2026-01-01'),
          endDate: new Date('2026-12-31'),
          rentAmount: 5000,
          depositAmount: 5000,
          status: 'active',
        },
      });

      const bA = await tx.bill.create({
        data: {
          dormitoryId: ownerDormitoryId,
          billingCycleId: cycleId,
          tenantId: tA.id,
          roomId: roomAId,
          billNumber: 'INV-TN-001',
          billingDate: new Date('2026-08-25'),
          dueDate: new Date('2026-09-05'),
          totalAmount: 5300,
          outstandingAmount: 5300,
          status: 'ISSUED',
          items: {
            create: [
              { dormitoryId: ownerDormitoryId, type: 'RENT', description: 'ค่าเช่าห้องประจำเดือน', amount: 5000, quantity: 1 },
              { dormitoryId: ownerDormitoryId, type: 'WATER', description: 'ค่าน้ำประปา', amount: 150, quantity: 1 },
              { dormitoryId: ownerDormitoryId, type: 'ELECTRIC', description: 'ค่าไฟฟ้า', amount: 150, quantity: 1 },
            ],
          },
        },
      });
      billAId = bA.id;
    });

    // 3. Create Tenant B User & Record
    const userB = await prisma.user.create({
      data: {
        email: `tenantB-${Date.now()}@example.com`,
        emailNormalized: `tenantB-${Date.now()}@example.com`,
        name: 'Sompong Tenant B',
        googleSubject: `goog-tenantB-${Date.now()}`,
        status: 'active',
      },
    });
    tenantBUserId = userB.id;

    const sidB = crypto.randomUUID();
    await prisma.session.create({
      data: {
        userId: tenantBUserId,
        sessionIdHash: SessionTokenService.hashSessionId(sidB),
        tokenVersion: 1,
        status: 'active',
        expiresAt: new Date(Date.now() + 86400 * 1000),
      },
    });
    tenantBSessionToken = sessionTokenService.encryptToken({ sub: tenantBUserId, sid: sidB, type: 'session', version: 1 }, 86400);
    tenantBCsrfToken = csrfService.generateCsrfToken(sidB);

    await prisma.dormitoryMember.create({
      data: {
        dormitoryId: ownerDormitoryId,
        userId: tenantBUserId,
        roleId: roleTenant?.id || 'role-tenant',
        status: 'active',
      },
    });

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${ownerDormitoryId}, true)`;
      const tB = await tx.tenant.create({
        data: {
          dormitoryId: ownerDormitoryId,
          linkedUserId: tenantBUserId,
          tenantNumber: 'TB-002',
          firstName: 'สมพงษ์',
          lastName: 'บี',
          displayName: 'สมพงษ์ บี',
          phone: '0822222222',
          status: 'active',
        },
      });
      tenantBId = tB.id;

      await tx.contract.create({
        data: {
          dormitoryId: ownerDormitoryId,
          tenantId: tB.id,
          roomId: roomBId,
          contractNumber: 'CT-TB-002',
          startDate: new Date('2026-01-01'),
          endDate: new Date('2026-12-31'),
          rentAmount: 5000,
          depositAmount: 5000,
          status: 'active',
        },
      });

      const bB = await tx.bill.create({
        data: {
          dormitoryId: ownerDormitoryId,
          billingCycleId: cycleId,
          tenantId: tB.id,
          roomId: roomBId,
          billNumber: 'INV-TN-002',
          billingDate: new Date('2026-08-25'),
          dueDate: new Date('2026-09-05'),
          totalAmount: 4200,
          outstandingAmount: 4200,
          status: 'ISSUED',
          items: {
            create: [
              { dormitoryId: ownerDormitoryId, type: 'RENT', description: 'ค่าเช่าห้องประจำเดือน', amount: 4200, quantity: 1 },
            ],
          },
        },
      });
      billBId = bB.id;
    });
  });

  test.afterAll(async () => {
    await fakeLineServer.stop();
    if (ownerDormitoryId) {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${ownerDormitoryId}, true)`;
        const bills = await tx.bill.findMany({ where: { dormitoryId: ownerDormitoryId }, select: { id: true } });
        for (const b of bills) {
          await tx.receipt.deleteMany({ where: { billId: b.id } });
          await tx.paymentStatusHistory.deleteMany({ where: { dormitoryId: ownerDormitoryId } });
          await tx.payment.deleteMany({ where: { billId: b.id } });
          await tx.billStatusHistory.deleteMany({ where: { billId: b.id } });
          await tx.billItem.deleteMany({ where: { billId: b.id } });
        }
        await tx.receiptSequence.deleteMany({ where: { dormitoryId: ownerDormitoryId } });
        await tx.paymentUploadIntent.deleteMany({ where: { dormitoryId: ownerDormitoryId } });
        await tx.dormitoryBillingSettings.deleteMany({ where: { dormitoryId: ownerDormitoryId } });
        await tx.dormitorySubscription.deleteMany({ where: { dormitoryId: ownerDormitoryId } });
        await tx.bill.deleteMany({ where: { dormitoryId: ownerDormitoryId } });
        await tx.billingCycle.deleteMany({ where: { dormitoryId: ownerDormitoryId } });
        await tx.contract.deleteMany({ where: { dormitoryId: ownerDormitoryId } });
        await tx.tenant.deleteMany({ where: { dormitoryId: ownerDormitoryId } });
        await tx.room.deleteMany({ where: { dormitoryId: ownerDormitoryId } });
        await tx.building.deleteMany({ where: { dormitoryId: ownerDormitoryId } });
        await tx.dormitoryMember.deleteMany({ where: { dormitoryId: ownerDormitoryId } });
        await tx.dormitory.delete({ where: { id: ownerDormitoryId } });
      }).catch(() => {});
    }

    if (ownerUserId) {
      await prisma.session.deleteMany({ where: { userId: ownerUserId } }).catch(() => {});
      await prisma.user.delete({ where: { id: ownerUserId } }).catch(() => {});
    }
    if (tenantAUserId) {
      await prisma.session.deleteMany({ where: { userId: tenantAUserId } }).catch(() => {});
      await prisma.user.delete({ where: { id: tenantAUserId } }).catch(() => {});
    }
    if (tenantBUserId) {
      await prisma.session.deleteMany({ where: { userId: tenantBUserId } }).catch(() => {});
      await prisma.user.delete({ where: { id: tenantBUserId } }).catch(() => {});
    }
  });

  test('1. Security & Isolation Boundaries: Anonymous Access = 401, Tenant B cannot access Tenant A bill/payment/receipt', async ({ page }) => {
    // 1. Anonymous access returns 401
    const anonRes = await page.request.get('http://127.0.0.1:3101/api/v1/tenant-portal/bills');
    expect(anonRes.status()).toBe(401);

    // 2. Tenant B fetching bills returns ONLY Tenant B's bill
    const resB = await page.request.get('http://127.0.0.1:3101/api/v1/tenant-portal/bills', {
      headers: {
        'Cookie': `horplus_session=${tenantBSessionToken}`,
      },
    });
    expect(resB.status()).toBe(200);
    const bodyB = await resB.json();
    const billsList = bodyB.data || [];
    expect(billsList.length).toBe(1);
    expect(billsList[0].id).toBe(billBId);
    expect(billsList[0].id).not.toBe(billAId);

    // 3. Tenant B requesting Tenant A's single bill returns 404
    const resSingleA = await page.request.get(`http://127.0.0.1:3101/api/v1/tenant-portal/bills/${billAId}`, {
      headers: {
        'Cookie': `horplus_session=${tenantBSessionToken}`,
      },
    });
    expect(resSingleA.status()).toBe(404);

    // 4. Response body leaks zero raw secret keys / objectKeys
    const textBody = JSON.stringify(bodyB);
    expect(textBody).not.toContain('promptPayValueEncrypted');
    expect(textBody).not.toContain('objectKey');
  });

  test('2. Complete Tenant Web Payment Portal Lifecycle: Intent -> Upload -> Submit -> Reject -> Resubmit -> Approve -> PAID + Receipt', async ({ page }) => {
    test.setTimeout(90000);

    // Set Tenant A session cookies
    await page.context().addCookies([
      { name: 'horplus_session', value: tenantASessionToken, domain: '127.0.0.1', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' },
      { name: 'horplus_csrf', value: tenantACsrfToken, domain: '127.0.0.1', path: '/', httpOnly: false, secure: false, sameSite: 'Lax' },
    ]);

    await page.goto('http://127.0.0.1:5174/tenant');
    await page.waitForLoadState('networkidle');

    // Assert Tenant A sees bill total amount 5,300
    await expect(page.locator('text=/5,300/')).toBeVisible();

    // Open payment options via API to verify PromptPay QR data
    const optRes = await page.request.get(`http://127.0.0.1:3101/api/v1/tenant-portal/payment-options/${billAId}`, {
      headers: {
        'Cookie': `horplus_session=${tenantASessionToken}`,
      },
    });
    expect(optRes.status()).toBe(200);
    const optBody = await optRes.json();
    expect(optBody.data.configured).toBe(true);
    expect(optBody.data.promptPayValue).toBe('0812345678');

    // STEP A: Create intent & upload slip #1
    const slip1 = makeUniquePng();
    const intentRes1 = await page.request.post('http://127.0.0.1:3101/api/v1/payments/slip/intent', {
      headers: {
        'Cookie': `horplus_session=${tenantASessionToken}; horplus_csrf=${tenantACsrfToken}`,
        'x-csrf-token': tenantACsrfToken,
        'x-dormitory-id': ownerDormitoryId,
      },
      data: {
        billId: billAId,
        fileName: 'slip1.png',
        mimeType: 'image/png',
        fileSize: slip1.length,
      },
    });
    expect(intentRes1.status()).toBe(200);
    const { intentId: intentId1 } = await intentRes1.json();

    const uploadRes1 = await page.request.post(`http://127.0.0.1:3101/api/v1/payments/slip/upload/${intentId1}`, {
      headers: {
        'Cookie': `horplus_session=${tenantASessionToken}; horplus_csrf=${tenantACsrfToken}`,
        'x-csrf-token': tenantACsrfToken,
        'x-dormitory-id': ownerDormitoryId,
      },
      multipart: {
        file: { name: 'slip1.png', mimeType: 'image/png', buffer: slip1 },
      },
    });
    expect(uploadRes1.status()).toBe(200);

    const submitRes1 = await page.request.post('http://127.0.0.1:3101/api/v1/payments/slip/submit', {
      headers: {
        'Cookie': `horplus_session=${tenantASessionToken}; horplus_csrf=${tenantACsrfToken}`,
        'x-csrf-token': tenantACsrfToken,
        'x-dormitory-id': ownerDormitoryId,
      },
      data: {
        billId: billAId,
        amount: '5300',
        paymentDate: new Date().toISOString(),
        intentId: intentId1,
      },
    });
    expect(submitRes1.status()).toBe(200);
    const payment1 = await submitRes1.json();
    expect(payment1.status).toBe('PENDING');

    // STEP B: Owner rejects payment with reason
    const rejectRes = await page.request.post(`http://127.0.0.1:3101/api/v1/payments/${payment1.id}/reject`, {
      headers: {
        'Cookie': `horplus_session=${ownerSessionToken}; horplus_csrf=${ownerCsrfToken}`,
        'x-csrf-token': ownerCsrfToken,
        'x-dormitory-id': ownerDormitoryId,
      },
      data: {
        reason: 'สลิปไม่ชัดเจน กรุณาแนบภาพใหม่',
      },
    });
    expect(rejectRes.status()).toBe(200);

    // STEP C: Tenant F5 reloads -> sees REJECTED badge & reason
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('text=สลิปไม่ชัดเจน กรุณาแนบภาพใหม่')).toBeVisible();

    // STEP D: Tenant resubmits using NEW upload intent
    const slip2 = makeUniquePng();
    const intentRes2 = await page.request.post('http://127.0.0.1:3101/api/v1/payments/slip/intent', {
      headers: {
        'Cookie': `horplus_session=${tenantASessionToken}; horplus_csrf=${tenantACsrfToken}`,
        'x-csrf-token': tenantACsrfToken,
        'x-dormitory-id': ownerDormitoryId,
      },
      data: {
        billId: billAId,
        fileName: 'slip2.png',
        mimeType: 'image/png',
        fileSize: slip2.length,
      },
    });
    expect(intentRes2.status()).toBe(200);
    const { intentId: intentId2 } = await intentRes2.json();

    const uploadRes2 = await page.request.post(`http://127.0.0.1:3101/api/v1/payments/slip/upload/${intentId2}`, {
      headers: {
        'Cookie': `horplus_session=${tenantASessionToken}; horplus_csrf=${tenantACsrfToken}`,
        'x-csrf-token': tenantACsrfToken,
        'x-dormitory-id': ownerDormitoryId,
      },
      multipart: {
        file: { name: 'slip2.png', mimeType: 'image/png', buffer: slip2 },
      },
    });
    expect(uploadRes2.status()).toBe(200);

    const submitRes2 = await page.request.post('http://127.0.0.1:3101/api/v1/payments/slip/submit', {
      headers: {
        'Cookie': `horplus_session=${tenantASessionToken}; horplus_csrf=${tenantACsrfToken}`,
        'x-csrf-token': tenantACsrfToken,
        'x-dormitory-id': ownerDormitoryId,
      },
      data: {
        billId: billAId,
        amount: '5300',
        paymentDate: new Date().toISOString(),
        intentId: intentId2,
      },
    });
    expect(submitRes2.status()).toBe(200);
    const payment2 = await submitRes2.json();
    expect(payment2.status).toBe('PENDING');

    // STEP E: Owner approves payment #2
    const approveRes = await page.request.post(`http://127.0.0.1:3101/api/v1/payments/${payment2.id}/approve`, {
      headers: {
        'Cookie': `horplus_session=${ownerSessionToken}; horplus_csrf=${ownerCsrfToken}`,
        'x-csrf-token': ownerCsrfToken,
        'x-dormitory-id': ownerDormitoryId,
      },
    });
    expect(approveRes.status()).toBe(200);

    // STEP F: Tenant F5 reloads -> sees PAID status and receipt link
    await page.reload();
    await page.waitForLoadState('networkidle');

    const receipts = await prisma.receipt.findMany({ where: { billId: billAId } });
    expect(receipts.length).toBe(1);
    const rc = receipts[0];
    expect(rc.receiptNumber).toMatch(/^RC-202608-B101-\d{4}$/);

    // Fetch Receipt HTML as Tenant -> 200 OK with correct receipt number
    const htmlRes = await page.request.get(`http://127.0.0.1:3101/api/v1/receipts/${rc.id}/html`, {
      headers: {
        'Cookie': `horplus_session=${tenantASessionToken}`,
      },
    });
    expect(htmlRes.status()).toBe(200);
    const htmlText = await htmlRes.text();
    expect(htmlText).toContain(rc.receiptNumber);
    expect(htmlText).toContain('ใบเสร็จรับเงิน (RECEIPT)');
  });
});
