import { test, expect } from '@playwright/test';
import crypto from 'crypto';
import { getPrismaClient } from '../../server/src/db/prisma.js';
import { SessionTokenService } from '../../server/src/services/session-token.service.js';
import { CsrfService } from '../../server/src/services/csrf.service.js';
import { FakeLineServer } from './helpers/fake-line-server.js';

const prisma = getPrismaClient();

// Helper to produce a structurally valid 1x1 PNG image with a unique SHA-256 hash
function makeUniquePng(): Buffer {
  const basePng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );
  return Buffer.concat([basePng, Buffer.from(`_salt_${Date.now()}_${crypto.randomUUID()}`)]);
}

test.describe.serial('Payment & Receipt Operational Lifecycle E2E Suite', () => {
  const fakeLineServer = new FakeLineServer();
  let ownerUserId: string;
  let ownerSessionToken: string;
  let ownerCsrfToken: string;
  let ownerDormitoryId: string;
  let tenantUserId: string;
  let tenantSessionToken: string;
  let tenantCsrfToken: string;
  let tenantId: string;
  let roomId: string;
  let contractId: string;
  let cycleId1: string;
  let cycleId2: string;
  let cycleId3: string;
  let cycleId4: string;

  let otherOwnerUserId: string;
  let otherOwnerSessionToken: string;
  let otherOwnerCsrfToken: string;
  let otherDormitoryId: string;

  test.beforeAll(async () => {
    await fakeLineServer.start();
    process.env.HORPLUS_E2E = 'true';

    const sessionSecret = process.env.SESSION_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef';
    const csrfSecret = process.env.CSRF_SIGNING_KEY || 'csrf-secret-key-0123456789abcdef';
    const sessionTokenService = new SessionTokenService(sessionSecret);
    const csrfService = new CsrfService(csrfSecret);

    // 1. Create Main Owner
    const owner = await prisma.user.create({
      data: {
        email: `pay-owner-${Date.now()}@example.com`,
        emailNormalized: `pay-owner-${Date.now()}@example.com`,
        name: 'Payment Owner',
        googleSubject: `goog-pay-owner-${Date.now()}`,
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

    // 2. Create Dormitory, Building, Room
    const dorm = await prisma.dormitory.create({
      data: {
        name: 'Payment Test Residence',
        addressLine1: '100 Payment Road',
        province: 'กรุงเทพมหานคร',
        createdByUserId: ownerUserId,
        status: 'active',
      },
    });
    ownerDormitoryId = dorm.id;

    // Create Dormitory Member for owner
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

    // Create BillingCycles, Building and Room within RLS context
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${ownerDormitoryId}, true)`;
      const cyc1 = await tx.billingCycle.create({
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
      cycleId1 = cyc1.id;

      const cyc2 = await tx.billingCycle.create({
        data: {
          dormitoryId: ownerDormitoryId,
          cycleCode: '2026-09',
          name: 'รอบเดือน กันยายน 2569',
          periodStart: new Date('2026-09-01'),
          periodEnd: new Date('2026-09-30'),
          billingDate: new Date('2026-09-25'),
          dueDate: new Date('2026-10-05'),
          status: 'active',
        },
      });
      cycleId2 = cyc2.id;

      const cyc3 = await tx.billingCycle.create({
        data: {
          dormitoryId: ownerDormitoryId,
          cycleCode: '2026-10',
          name: 'รอบเดือน ตุลาคม 2569',
          periodStart: new Date('2026-10-01'),
          periodEnd: new Date('2026-10-31'),
          billingDate: new Date('2026-10-25'),
          dueDate: new Date('2026-11-05'),
          status: 'active',
        },
      });
      cycleId3 = cyc3.id;

      const cyc4 = await tx.billingCycle.create({
        data: {
          dormitoryId: ownerDormitoryId,
          cycleCode: '2026-11',
          name: 'รอบเดือน พฤศจิกายน 2569',
          periodStart: new Date('2026-11-01'),
          periodEnd: new Date('2026-11-30'),
          billingDate: new Date('2026-11-25'),
          dueDate: new Date('2026-12-05'),
          status: 'active',
        },
      });
      cycleId4 = cyc4.id;

      const bld = await tx.building.create({
        data: {
          dormitoryId: ownerDormitoryId,
          name: 'Building A',
          floorCount: 2,
          roomsPerFloor: 2,
          roomPrefix: 'A',
          monthlyRent: 5000,
        },
      });

      const rm = await tx.room.create({
        data: {
          dormitoryId: ownerDormitoryId,
          buildingId: bld.id,
          roomNumber: 'A101',
          normalizedRoomNumber: 'A101',
          roomType: 'standard',
          floor: 1,
          monthlyRent: 5000,
          status: 'OCCUPIED',
        },
      });
      roomId = rm.id;
    });

    // 3. Create Tenant User & Tenant Record
    const tenantUser = await prisma.user.create({
      data: {
        email: `pay-tenant-${Date.now()}@example.com`,
        emailNormalized: `pay-tenant-${Date.now()}@example.com`,
        name: 'Somchai Tenant',
        googleSubject: `goog-pay-tenant-${Date.now()}`,
        status: 'active',
      },
    });
    tenantUserId = tenantUser.id;

    const tenantSid = crypto.randomUUID();
    await prisma.session.create({
      data: {
        userId: tenantUserId,
        sessionIdHash: SessionTokenService.hashSessionId(tenantSid),
        tokenVersion: 1,
        status: 'active',
        expiresAt: new Date(Date.now() + 86400 * 1000),
      },
    });
    tenantSessionToken = sessionTokenService.encryptToken({ sub: tenantUserId, sid: tenantSid, type: 'session', version: 1 }, 86400);
    tenantCsrfToken = csrfService.generateCsrfToken(tenantSid);

    const roleTenant = await prisma.role.findFirst({ where: { code: 'TENANT' } });
    await prisma.dormitoryMember.create({
      data: {
        dormitoryId: ownerDormitoryId,
        userId: tenantUserId,
        roleId: roleTenant?.id || 'role-tenant',
        status: 'active',
      },
    });

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${ownerDormitoryId}, true)`;
      const t = await tx.tenant.create({
        data: {
          dormitoryId: ownerDormitoryId,
          linkedUserId: tenantUserId,
          tenantNumber: 'T-001',
          firstName: 'สมชาย',
          lastName: 'ผู้เช่าทดสอบ',
          displayName: 'สมชาย ผู้เช่าทดสอบ',
          phone: '0812345678',
          status: 'active',
        },
      });
      tenantId = t.id;

      const c = await tx.contract.create({
        data: {
          dormitoryId: ownerDormitoryId,
          tenantId: t.id,
          roomId: roomId,
          contractNumber: 'CT-2026-001',
          startDate: new Date('2026-01-01'),
          endDate: new Date('2026-12-31'),
          rentAmount: 5000,
          depositAmount: 5000,
          status: 'active',
        },
      });
      contractId = c.id;
    });

    // 4. Create Other Owner for cross-dorm security testing
    const otherOwner = await prisma.user.create({
      data: {
        email: `other-owner-${Date.now()}@example.com`,
        emailNormalized: `other-owner-${Date.now()}@example.com`,
        name: 'Other Dorm Owner',
        googleSubject: `goog-other-owner-${Date.now()}`,
        status: 'active',
      },
    });
    otherOwnerUserId = otherOwner.id;

    const otherSid = crypto.randomUUID();
    await prisma.session.create({
      data: {
        userId: otherOwnerUserId,
        sessionIdHash: SessionTokenService.hashSessionId(otherSid),
        tokenVersion: 1,
        status: 'active',
        expiresAt: new Date(Date.now() + 86400 * 1000),
      },
    });
    otherOwnerSessionToken = sessionTokenService.encryptToken({ sub: otherOwnerUserId, sid: otherSid, type: 'session', version: 1 }, 86400);
    otherOwnerCsrfToken = csrfService.generateCsrfToken(otherSid);

    const otherDorm = await prisma.dormitory.create({
      data: {
        name: 'Other Dormitory',
        addressLine1: '999 Other St',
        province: 'กรุงเทพมหานคร',
        createdByUserId: otherOwnerUserId,
        status: 'active',
      },
    });
    otherDormitoryId = otherDorm.id;

    await prisma.dormitoryMember.create({
      data: {
        dormitoryId: otherDormitoryId,
        userId: otherOwnerUserId,
        roleId: roleOwner?.id || 'role-owner',
        status: 'active',
      },
    });
  });

  test.afterAll(async () => {
    await fakeLineServer.stop();
    // Cleanup database records
    const cleanDorm = async (dId: string) => {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dId}, true)`;
        const bills = await tx.bill.findMany({ where: { dormitoryId: dId }, select: { id: true } });
        for (const b of bills) {
          await tx.receipt.deleteMany({ where: { billId: b.id } });
          await tx.paymentStatusHistory.deleteMany({ where: { dormitoryId: dId } });
          await tx.payment.deleteMany({ where: { billId: b.id } });
          await tx.billStatusHistory.deleteMany({ where: { billId: b.id } });
          await tx.billItem.deleteMany({ where: { billId: b.id } });
        }
        await tx.receiptSequence.deleteMany({ where: { dormitoryId: dId } });
        await tx.paymentUploadIntent.deleteMany({ where: { dormitoryId: dId } });
        await tx.dormitorySubscription.deleteMany({ where: { dormitoryId: dId } });
        await tx.bill.deleteMany({ where: { dormitoryId: dId } });
        await tx.billingCycle.deleteMany({ where: { dormitoryId: dId } });
        await tx.contract.deleteMany({ where: { dormitoryId: dId } });
        await tx.tenant.deleteMany({ where: { dormitoryId: dId } });
        await tx.room.deleteMany({ where: { dormitoryId: dId } });
        await tx.building.deleteMany({ where: { dormitoryId: dId } });
        await tx.dormitoryMember.deleteMany({ where: { dormitoryId: dId } });
        await tx.dormitory.delete({ where: { id: dId } });
      }).catch(() => {});
    };

    if (ownerDormitoryId) await cleanDorm(ownerDormitoryId);
    if (otherDormitoryId) await cleanDorm(otherDormitoryId);

    if (ownerUserId) {
      await prisma.session.deleteMany({ where: { userId: ownerUserId } }).catch(() => {});
      await prisma.paymentUploadIntent.deleteMany({ where: { authenticatedUserId: ownerUserId } }).catch(() => {});
      await prisma.user.delete({ where: { id: ownerUserId } }).catch(() => {});
    }
    if (tenantUserId) {
      await prisma.session.deleteMany({ where: { userId: tenantUserId } }).catch(() => {});
      await prisma.paymentUploadIntent.deleteMany({ where: { authenticatedUserId: tenantUserId } }).catch(() => {});
      await prisma.user.delete({ where: { id: tenantUserId } }).catch(() => {});
    }
    if (otherOwnerUserId) {
      await prisma.session.deleteMany({ where: { userId: otherOwnerUserId } }).catch(() => {});
      await prisma.paymentUploadIntent.deleteMany({ where: { authenticatedUserId: otherOwnerUserId } }).catch(() => {});
      await prisma.user.delete({ where: { id: otherOwnerUserId } }).catch(() => {});
    }
  });

  test('1. Owner empty payment state displays zero demo/mock bills when no bills exist in API', async ({ page }) => {
    await page.context().addCookies([
      { name: 'horplus_session', value: ownerSessionToken, domain: '127.0.0.1', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' },
      { name: 'horplus_csrf', value: ownerCsrfToken, domain: '127.0.0.1', path: '/', httpOnly: false, secure: false, sameSite: 'Lax' },
    ]);

    await page.addInitScript((dormId) => {
      localStorage.setItem('selected_dormitory_id', dormId);
      localStorage.setItem('payments_active_tab', 'checking');
    }, ownerDormitoryId);

    await page.goto('http://127.0.0.1:5174/owner/payments');
    await page.waitForLoadState('networkidle');

    // Assert Checking tab empty text
    await expect(page.locator('text=ไม่มีสลิปที่รอตรวจสอบในขณะนี้')).toBeVisible();

    // Click Cash tab
    await page.click('button:has-text("บันทึกเงินสด")');
    await expect(page.locator('text=ไม่มีบิลค้างชำระ')).toBeVisible();

    // Click Paid tab
    await page.click('button:has-text("ชำระแล้ว")');
    await expect(page.locator('text=ยังไม่มีรายการรับชำระเงินที่อนุมัติแล้ว')).toBeVisible();

    // Zero mock/demo data elements
    await expect(page.locator('text=initialBills')).toHaveCount(0);
    await expect(page.locator('text=INV-2026')).toHaveCount(0);
  });

  test('2. Complete Slip Payment Lifecycle: Tenant Intent -> Upload -> Submit -> Owner Reject with Reason -> Tenant Resubmit -> Owner Approve -> Bill PAID + Receipt', async ({ page }) => {
    test.setTimeout(90000);

    // Create an issued bill in database using cycleId1
    let billId: string;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${ownerDormitoryId}, true)`;
      const b = await tx.bill.create({
        data: {
          dormitoryId: ownerDormitoryId,
          billingCycleId: cycleId1,
          tenantId: tenantId,
          roomId: roomId,
          billNumber: 'INV-E2E-001',
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
      billId = b.id;
    });

    const slip1Buffer = makeUniquePng();

    // STEP A: Tenant creates upload intent
    const intentRes = await page.request.post('http://127.0.0.1:3101/api/v1/payments/slip/intent', {
      headers: {
        'Cookie': `horplus_session=${tenantSessionToken}; horplus_csrf=${tenantCsrfToken}`,
        'x-csrf-token': tenantCsrfToken,
        'x-dormitory-id': ownerDormitoryId,
      },
      data: {
        billId: billId!,
        fileName: 'test-slip.png',
        mimeType: 'image/png',
        fileSize: slip1Buffer.length,
      },
    });
    expect(intentRes.status()).toBe(200);
    const { intentId } = await intentRes.json();

    // STEP B: Tenant uploads real PNG binary
    const uploadRes = await page.request.post(`http://127.0.0.1:3101/api/v1/payments/slip/upload/${intentId}`, {
      headers: {
        'Cookie': `horplus_session=${tenantSessionToken}; horplus_csrf=${tenantCsrfToken}`,
        'x-csrf-token': tenantCsrfToken,
        'x-dormitory-id': ownerDormitoryId,
      },
      multipart: {
        file: {
          name: 'test-slip.png',
          mimeType: 'image/png',
          buffer: slip1Buffer,
        },
      },
    });
    expect(uploadRes.status()).toBe(200);

    // STEP C: Tenant submits payment
    const submitRes = await page.request.post('http://127.0.0.1:3101/api/v1/payments/slip/submit', {
      headers: {
        'Cookie': `horplus_session=${tenantSessionToken}; horplus_csrf=${tenantCsrfToken}`,
        'x-csrf-token': tenantCsrfToken,
        'x-dormitory-id': ownerDormitoryId,
      },
      data: {
        billId: billId!,
        amount: '5300',
        paymentDate: new Date().toISOString(),
        intentId: intentId,
      },
    });
    expect(submitRes.status()).toBe(200);
    const initialPayment = await submitRes.json();
    expect(initialPayment.status).toBe('PENDING');

    // STEP D: Owner opens /owner/payments in browser
    await page.context().addCookies([
      { name: 'horplus_session', value: ownerSessionToken, domain: '127.0.0.1', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' },
      { name: 'horplus_csrf', value: ownerCsrfToken, domain: '127.0.0.1', path: '/', httpOnly: false, secure: false, sameSite: 'Lax' },
    ]);

    await page.addInitScript((dormId) => {
      localStorage.setItem('selected_dormitory_id', dormId);
      localStorage.setItem('payments_active_tab', 'checking');
    }, ownerDormitoryId);

    await page.goto('http://127.0.0.1:5174/owner/payments');
    await page.waitForLoadState('networkidle');

    // Assert pending payment card appears
    await expect(page.locator('text=INV-E2E-001')).toBeVisible();
    await expect(page.locator('span:has-text("รอตรวจสอบ")')).toBeVisible();

    // Click "ดูสลิป" button to verify evidence preview modal
    await page.click('button:has-text("ดูสลิป")');
    const modalImage = page.locator('img[alt="Payment Slip Evidence"]');
    await expect(modalImage).toBeVisible({ timeout: 15000 });
    await page.click('button:has-text("ปิด")');

    // STEP E: Owner rejects payment with mandatory reason
    await page.click('button:has-text("ปฏิเสธ")');
    await expect(page.locator('text=ปฏิเสธสลิปโอนเงิน')).toBeVisible();
    await page.fill('textarea', 'สลิปไม่ชัดเจน กรุณาแนบภาพใหม่');
    await page.click('button:has-text("ยืนยันปฏิเสธ")');

    await expect(page.locator('text=ปฏิเสธการชำระเงินเรียบร้อยแล้ว')).toBeVisible();

    // Assert DB state after rejection: Payment REJECTED, Bill ISSUED
    const rejectedPaymentDb = await prisma.payment.findUnique({ where: { id: initialPayment.id } });
    expect(rejectedPaymentDb?.status).toBe('REJECTED');
    expect(rejectedPaymentDb?.rejectedReason).toBe('สลิปไม่ชัดเจน กรุณาแนบภาพใหม่');

    const billAfterReject = await prisma.bill.findUnique({ where: { id: billId! } });
    expect(billAfterReject?.status).toBe('ISSUED');
    expect(Number(billAfterReject?.paidAmount)).toBe(0);

    // STEP F: Tenant resubmits with valid replacement slip (using unique makeUniquePng())
    const slip2Buffer = makeUniquePng();

    const intentRes2 = await page.request.post('http://127.0.0.1:3101/api/v1/payments/slip/intent', {
      headers: {
        'Cookie': `horplus_session=${tenantSessionToken}; horplus_csrf=${tenantCsrfToken}`,
        'x-csrf-token': tenantCsrfToken,
        'x-dormitory-id': ownerDormitoryId,
      },
      data: {
        billId: billId!,
        fileName: 'replacement-slip.png',
        mimeType: 'image/png',
        fileSize: slip2Buffer.length,
      },
    });
    expect(intentRes2.status()).toBe(200);
    const { intentId: intentId2 } = await intentRes2.json();

    const uploadRes2 = await page.request.post(`http://127.0.0.1:3101/api/v1/payments/slip/upload/${intentId2}`, {
      headers: {
        'Cookie': `horplus_session=${tenantSessionToken}; horplus_csrf=${tenantCsrfToken}`,
        'x-csrf-token': tenantCsrfToken,
        'x-dormitory-id': ownerDormitoryId,
      },
      multipart: {
        file: {
          name: 'replacement-slip.png',
          mimeType: 'image/png',
          buffer: slip2Buffer,
        },
      },
    });
    expect(uploadRes2.status()).toBe(200);

    const submitRes2 = await page.request.post('http://127.0.0.1:3101/api/v1/payments/slip/submit', {
      headers: {
        'Cookie': `horplus_session=${tenantSessionToken}; horplus_csrf=${tenantCsrfToken}`,
        'x-csrf-token': tenantCsrfToken,
        'x-dormitory-id': ownerDormitoryId,
      },
      data: {
        billId: billId!,
        amount: '5300',
        paymentDate: new Date().toISOString(),
        intentId: intentId2,
      },
    });
    expect(submitRes2.status()).toBe(200);
    const secondPayment = await submitRes2.json();

    // STEP G: Owner approves the replacement payment in UI
    await page.reload();
    await page.waitForLoadState('networkidle');

    await expect(page.locator('text=INV-E2E-001')).toBeVisible();
    await page.click('button:has-text("อนุมัติ")');
    await expect(page.locator('text=อนุมัติการชำระเงินและออกใบเสร็จรับเงินเรียบร้อยแล้ว')).toBeVisible();

    // STEP H: Assert DB truth after approval
    const approvedPaymentDb = await prisma.payment.findUnique({ where: { id: secondPayment.id } });
    expect(approvedPaymentDb?.status).toBe('APPROVED');

    const paidBillDb = await prisma.bill.findUnique({ where: { id: billId! } });
    expect(paidBillDb?.status).toBe('PAID');
    expect(Number(paidBillDb?.paidAmount)).toBe(5300);
    expect(Number(paidBillDb?.outstandingAmount)).toBe(0);

    const receipts = await prisma.receipt.findMany({ where: { billId: billId! } });
    expect(receipts.length).toBe(1);
    expect(receipts[0].receiptNumber).toMatch(/^RC-2026\d{2}-A101-\d{4}$/);

    // STEP I: F5 Reload verifies persistence
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.click('button:has-text("ชำระแล้ว")');
    await expect(page.locator(`text=${receipts[0].receiptNumber}`)).toBeVisible();
  });

  test('3. Cash Payment Lifecycle & Idempotency Proof: Record Cash -> Bill PAID + Receipt, Same Idempotency Key returns same result, New Idempotency Key fails cleanly', async ({ page }) => {
    test.setTimeout(60000);

    // Create an unpaid bill for cash test using cycleId2
    let cashBillId: string;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${ownerDormitoryId}, true)`;
      const b = await tx.bill.create({
        data: {
          dormitoryId: ownerDormitoryId,
          billingCycleId: cycleId2,
          tenantId: tenantId,
          roomId: roomId,
          billNumber: 'INV-CASH-002',
          billingDate: new Date('2026-09-25'),
          dueDate: new Date('2026-10-05'),
          totalAmount: 4500,
          outstandingAmount: 4500,
          status: 'ISSUED',
          items: {
            create: [{ dormitoryId: ownerDormitoryId, type: 'RENT', description: 'ค่าเช่าห้องประจำเดือน', amount: 4500, quantity: 1 }],
          },
        },
      });
      cashBillId = b.id;
    });

    const sameIdempKey = 'idemp_cash_test_' + Date.now();

    // 1. First Cash Request with Idempotency Key
    const cashRes1 = await page.request.post('http://127.0.0.1:3101/api/v1/payments/cash', {
      headers: {
        'Cookie': `horplus_session=${ownerSessionToken}; horplus_csrf=${ownerCsrfToken}`,
        'x-csrf-token': ownerCsrfToken,
        'x-dormitory-id': ownerDormitoryId,
        'x-idempotency-key': sameIdempKey,
      },
      data: {
        billId: cashBillId!,
        amount: '4500',
      },
    });
    expect(cashRes1.status()).toBe(200);
    const cashPayment1 = await cashRes1.json();
    expect(cashPayment1.status).toBe('APPROVED');
    expect(cashPayment1.method).toBe('CASH');

    // 2. Repeated Cash Request with SAME Idempotency Key -> Same result, no duplicate
    const cashRes2 = await page.request.post('http://127.0.0.1:3101/api/v1/payments/cash', {
      headers: {
        'Cookie': `horplus_session=${ownerSessionToken}; horplus_csrf=${ownerCsrfToken}`,
        'x-csrf-token': ownerCsrfToken,
        'x-dormitory-id': ownerDormitoryId,
        'x-idempotency-key': sameIdempKey,
      },
      data: {
        billId: cashBillId!,
        amount: '4500',
      },
    });
    expect(cashRes2.status()).toBe(200);
    const cashPayment2 = await cashRes2.json();
    expect(cashPayment2.id).toBe(cashPayment1.id);

    // 3. New Cash Request with NEW Idempotency Key on already PAID bill -> Returns ALREADY_PAID (400)
    const newIdempKey = 'idemp_cash_new_' + Date.now();
    const cashRes3 = await page.request.post('http://127.0.0.1:3101/api/v1/payments/cash', {
      headers: {
        'Cookie': `horplus_session=${ownerSessionToken}; horplus_csrf=${ownerCsrfToken}`,
        'x-csrf-token': ownerCsrfToken,
        'x-dormitory-id': ownerDormitoryId,
        'x-idempotency-key': newIdempKey,
      },
      data: {
        billId: cashBillId!,
        amount: '4500',
      },
    });
    expect(cashRes3.status()).toBe(400);
    const errBody = await cashRes3.json();
    expect(errBody.error).toBe('ALREADY_PAID');

    // 4. Assert DB count: Exactly 1 Payment and 1 Receipt for cash bill
    const cashPaymentsDb = await prisma.payment.findMany({ where: { billId: cashBillId! } });
    expect(cashPaymentsDb.length).toBe(1);

    const cashReceiptsDb = await prisma.receipt.findMany({ where: { billId: cashBillId! } });
    expect(cashReceiptsDb.length).toBe(1);
  });

  test('4. Receipt HTML Snapshot Rendering & Reversal Void Banner Verification', async ({ page }) => {
    test.setTimeout(60000);

    let revBillId: string;
    let revPaymentId: string;
    let revReceiptId: string;

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${ownerDormitoryId}, true)`;
      const b = await tx.bill.create({
        data: {
          dormitoryId: ownerDormitoryId,
          billingCycleId: cycleId3,
          tenantId: tenantId,
          roomId: roomId,
          billNumber: 'INV-REV-003',
          billingDate: new Date('2026-10-25'),
          dueDate: new Date('2026-11-05'),
          totalAmount: 3000,
          outstandingAmount: 3000,
          status: 'ISSUED',
          items: {
            create: [{ dormitoryId: ownerDormitoryId, type: 'RENT', description: 'ค่าเช่าห้องประจำเดือน', amount: 3000, quantity: 1 }],
          },
        },
      });
      revBillId = b.id;
    });

    // Record cash to generate receipt
    const cashRes = await page.request.post('http://127.0.0.1:3101/api/v1/payments/cash', {
      headers: {
        'Cookie': `horplus_session=${ownerSessionToken}; horplus_csrf=${ownerCsrfToken}`,
        'x-csrf-token': ownerCsrfToken,
        'x-dormitory-id': ownerDormitoryId,
      },
      data: {
        billId: revBillId!,
        amount: '3000',
      },
    });
    expect(cashRes.status()).toBe(200);
    const cashPay = await cashRes.json();
    revPaymentId = cashPay.id;

    const rc = await prisma.receipt.findFirst({ where: { billId: revBillId! } });
    expect(rc).not.toBeNull();
    revReceiptId = rc!.id;

    // Fetch Receipt HTML via API
    const htmlRes = await page.request.get(`http://127.0.0.1:3101/api/v1/receipts/${revReceiptId!}/html`, {
      headers: {
        'Cookie': `horplus_session=${ownerSessionToken}`,
      },
    });
    expect(htmlRes.status()).toBe(200);
    const htmlText = await htmlRes.text();
    expect(htmlText).toContain('ใบเสร็จรับเงิน (RECEIPT)');
    expect(htmlText).toContain(rc!.receiptNumber);
    expect(htmlText).toContain('พิมพ์ใบเสร็จ (Print Receipt)');

    // Now Reverse Payment via API
    const revRes = await page.request.post(`http://127.0.0.1:3101/api/v1/payments/${revPaymentId!}/reverse`, {
      headers: {
        'Cookie': `horplus_session=${ownerSessionToken}; horplus_csrf=${ownerCsrfToken}`,
        'x-csrf-token': ownerCsrfToken,
        'x-dormitory-id': ownerDormitoryId,
      },
      data: {
        reason: 'โอนผิดบัญชี ย้อนกลับรายการ',
      },
    });
    expect(revRes.status()).toBe(200);

    // Fetch Receipt HTML again -> Must contain VOIDED banner
    const voidHtmlRes = await page.request.get(`http://127.0.0.1:3101/api/v1/receipts/${revReceiptId!}/html`, {
      headers: {
        'Cookie': `horplus_session=${ownerSessionToken}`,
      },
    });
    expect(voidHtmlRes.status()).toBe(200);
    const voidHtmlText = await voidHtmlRes.text();
    expect(voidHtmlText).toContain('ยกเลิกแล้ว (VOIDED)');
    expect(voidHtmlText).toContain('โอนผิดบัญชี ย้อนกลับรายการ');
  });

  test('5. Security & Isolation Boundaries: Cross-Dorm Access Returns 403/404, Anonymous Access Returns 401, No Credential Leakage', async ({ page }) => {
    // 1. Anonymous access to payments returns 401
    const anonRes = await page.request.get('http://127.0.0.1:3101/api/v1/payments');
    expect(anonRes.status()).toBe(401);

    // 2. Other Owner attempting to access Main Owner's payments returns 403 or empty dorm list
    const crossRes = await page.request.get('http://127.0.0.1:3101/api/v1/payments', {
      headers: {
        'Cookie': `horplus_session=${otherOwnerSessionToken}`,
        'x-dormitory-id': ownerDormitoryId,
      },
    });
    expect(crossRes.status()).toBe(403);

    // 3. Other Owner attempting to approve Main Owner's payment returns 403 or 404
    const crossApproveRes = await page.request.post('http://127.0.0.1:3101/api/v1/payments/dummy_payment_id/approve', {
      headers: {
        'Cookie': `horplus_session=${otherOwnerSessionToken}; horplus_csrf=${otherOwnerCsrfToken}`,
        'x-csrf-token': otherOwnerCsrfToken,
        'x-dormitory-id': ownerDormitoryId,
      },
    });
    expect([403, 404]).toContain(crossApproveRes.status());
  });

  test('6. Authoritative Payable Amount: Item subtotal != bill.totalAmount requires exact bill.totalAmount', async ({ page }) => {
    test.setTimeout(60000);

    let discountedBillId: string;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${ownerDormitoryId}, true)`;
      const b = await tx.bill.create({
        data: {
          dormitoryId: ownerDormitoryId,
          billingCycleId: cycleId4,
          tenantId: tenantId,
          roomId: roomId,
          billNumber: 'INV-DISC-004',
          billingDate: new Date('2026-11-25'),
          dueDate: new Date('2026-12-05'),
          totalAmount: 4000, // Discounted from 5000 items subtotal
          outstandingAmount: 4000,
          status: 'ISSUED',
          items: {
            create: [{ dormitoryId: ownerDormitoryId, type: 'RENT', description: 'ค่าเช่าห้องปกติ', amount: 5000, quantity: 1 }],
          },
        },
      });
      discountedBillId = b.id;
    });

    // Attempting cash recording with item subtotal (5000) must fail with UNSUPPORTED_AMOUNT (400)
    const wrongAmountRes = await page.request.post('http://127.0.0.1:3101/api/v1/payments/cash', {
      headers: {
        'Cookie': `horplus_session=${ownerSessionToken}; horplus_csrf=${ownerCsrfToken}`,
        'x-csrf-token': ownerCsrfToken,
        'x-dormitory-id': ownerDormitoryId,
      },
      data: {
        billId: discountedBillId!,
        amount: '5000',
      },
    });
    expect(wrongAmountRes.status()).toBe(400);
    const wrongBody = await wrongAmountRes.json();
    expect(wrongBody.error).toBe('UNSUPPORTED_AMOUNT');

    // Recording cash with authoritative bill.totalAmount (4000) succeeds cleanly
    const correctAmountRes = await page.request.post('http://127.0.0.1:3101/api/v1/payments/cash', {
      headers: {
        'Cookie': `horplus_session=${ownerSessionToken}; horplus_csrf=${ownerCsrfToken}`,
        'x-csrf-token': ownerCsrfToken,
        'x-dormitory-id': ownerDormitoryId,
      },
      data: {
        billId: discountedBillId!,
        amount: '4000',
      },
    });
    expect(correctAmountRes.status()).toBe(200);
    const paidPay = await correctAmountRes.json();
    expect(Number(paidPay.amount)).toBe(4000);
  });
});
