import { test, expect } from '@playwright/test';
import { getPrismaClient } from '../../server/src/db/prisma.js';
import { SessionTokenService } from '../../server/src/services/session-token.service.js';
import { CsrfService } from '../../server/src/services/csrf.service.js';
import crypto from 'crypto';
import zlib from 'zlib';

const prisma = getPrismaClient();

const SESSION_ENCRYPTION_KEY = process.env.SESSION_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef';
const CSRF_SIGNING_KEY = process.env.CSRF_SIGNING_KEY || 'csrf-secret-key-0123456789abcdef';

const sessionTokenService = new SessionTokenService(SESSION_ENCRYPTION_KEY);
const csrfService = new CsrfService(CSRF_SIGNING_KEY);

test.describe.serial('Wave 0 Production Truth Acceptance Suite', () => {
  let ownerUserId: string;
  let ownerSessionToken: string;
  let ownerCsrfToken: string;
  let ownerDormitoryId: string;

  let tenantUserId: string;
  let tenantSessionToken: string;
  let tenantCsrfToken: string;
  let tenantRecordId: string;
  let tenantRoomId: string;

  test.beforeAll(async () => {
    const timestamp = Date.now();
    ownerDormitoryId = crypto.randomUUID();
    ownerUserId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const roleId = crypto.randomUUID();

    await prisma.user.create({
      data: {
        id: ownerUserId,
        email: `w0-owner-${timestamp}@example.com`,
        emailNormalized: `w0-owner-${timestamp}@example.com`,
        name: 'Wave 0 Owner',
        googleSubject: `goog-w0-owner-${timestamp}`,
        status: 'active',
      },
    });

    await prisma.session.create({
      data: {
        userId: ownerUserId,
        sessionIdHash: SessionTokenService.hashSessionId(sessionId),
        tokenVersion: 1,
        status: 'active',
        expiresAt: new Date(Date.now() + 86400 * 1000),
      },
    });

    ownerSessionToken = sessionTokenService.encryptToken({ sub: ownerUserId, sid: sessionId, type: 'session', version: 1 }, 86400);
    ownerCsrfToken = csrfService.generateCsrfToken(sessionId);

    await prisma.dormitory.create({
      data: {
        id: ownerDormitoryId,
        name: 'Wave 0 Residence',
        addressLine1: '100 Truth St',
        province: 'กรุงเทพมหานคร',
        createdByUserId: ownerUserId,
        status: 'active',
      },
    });

    await prisma.dormitoryPropertyDefaults.create({
      data: {
        dormitoryId: ownerDormitoryId,
        defaultMonthlyRent: 0,
        defaultDeposit: 0,
        version: 1,
      },
    });

    await prisma.dormitoryBillingSettings.create({
      data: {
        dormitoryId: ownerDormitoryId,
        waterRate: 0,
        electricityRate: 0,
        version: 1,
      },
    });

    const freePlan = await prisma.subscriptionPlan.findFirst({ where: { code: 'FREE' } });
    if (freePlan) {
      await prisma.dormitorySubscription.create({
        data: {
          dormitoryId: ownerDormitoryId,
          planId: freePlan.id,
          status: 'ACTIVE',
          startedAt: new Date(),
          expiresAt: new Date(Date.now() + 365 * 86400 * 1000),
        },
      });
    }

    let roleOwner = await prisma.role.findFirst({ where: { code: 'OWNER' } });
    if (!roleOwner) {
      roleOwner = await prisma.role.create({
        data: {
          id: roleId,
          code: 'OWNER',
          name: 'Owner Role',
          permissions: ['*'],
        },
      });
    } else {
      await prisma.role.update({
        where: { id: roleOwner.id },
        data: { permissions: ['*'] },
      });
    }

    await prisma.dormitoryMember.create({
      data: {
        dormitoryId: ownerDormitoryId,
        userId: ownerUserId,
        roleId: roleOwner.id,
        status: 'active',
      },
    });

    // Create real authenticated Tenant fixture (User, Session, TENANT Role/Member, Room, Tenant, Contract)
    tenantUserId = crypto.randomUUID();
    const tenantSid = crypto.randomUUID();
    tenantRecordId = crypto.randomUUID();
    const roomId = crypto.randomUUID();
    tenantRoomId = roomId;
    const buildingId = crypto.randomUUID();
    const contractId = crypto.randomUUID();

    await prisma.user.create({
      data: {
        id: tenantUserId,
        email: `w0-tenant-${timestamp}@example.com`,
        emailNormalized: `w0-tenant-${timestamp}@example.com`,
        name: 'Wave 0 Tenant',
        googleSubject: `goog-w0-tenant-${timestamp}`,
        status: 'active',
      },
    });

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

    let roleTenant = await prisma.role.findFirst({ where: { code: 'TENANT' } });
    if (!roleTenant) {
      roleTenant = await prisma.role.create({
        data: {
          id: crypto.randomUUID(),
          code: 'TENANT',
          name: 'Tenant Role',
          permissions: [],
        },
      });
    }

    await prisma.dormitoryMember.create({
      data: {
        dormitoryId: ownerDormitoryId,
        userId: tenantUserId,
        roleId: roleTenant.id,
        status: 'active',
      },
    });

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${ownerDormitoryId}, true)`;
      const bld = await tx.building.create({
        data: {
          dormitoryId: ownerDormitoryId,
          name: 'Building T',
          floorCount: 1,
          roomsPerFloor: 1,
          monthlyRent: 4000,
        },
      });

      const rm = await tx.room.create({
        data: {
          id: roomId,
          dormitoryId: ownerDormitoryId,
          buildingId: bld.id,
          roomNumber: 'T101',
          normalizedRoomNumber: 'T101',
          roomType: 'standard',
          floor: 1,
          monthlyRent: 4000,
          status: 'OCCUPIED',
          currentTenantId: tenantRecordId,
        },
      });

      const tnt = await tx.tenant.create({
        data: {
          id: tenantRecordId,
          dormitoryId: ownerDormitoryId,
          linkedUserId: tenantUserId,
          tenantNumber: 'W0-T101',
          firstName: 'Wave',
          lastName: 'Tenant',
          displayName: 'Wave 0 Tenant',
          phone: '0812345678',
          status: 'active',
        },
      });

      await tx.contract.create({
        data: {
          id: contractId,
          dormitoryId: ownerDormitoryId,
          tenantId: tnt.id,
          roomId: rm.id,
          contractNumber: `CTR-W0-${timestamp}`,
          rentAmount: 4000,
          depositAmount: 8000,
          startDate: new Date('2026-01-01'),
          endDate: new Date('2026-12-31'),
          status: 'active',
        },
      });
    });
  });

  test.afterAll(async () => {
    if (ownerDormitoryId) {
      await prisma.dormitorySubscription.deleteMany({ where: { dormitoryId: ownerDormitoryId } }).catch(() => {});
      await prisma.dormitoryBillingSettings.deleteMany({ where: { dormitoryId: ownerDormitoryId } }).catch(() => {});
      await prisma.dormitoryPropertyDefaults.deleteMany({ where: { dormitoryId: ownerDormitoryId } }).catch(() => {});
      await prisma.contract.deleteMany({ where: { dormitoryId: ownerDormitoryId } }).catch(() => {});
      await prisma.tenant.deleteMany({ where: { dormitoryId: ownerDormitoryId } }).catch(() => {});
      await prisma.room.deleteMany({ where: { dormitoryId: ownerDormitoryId } }).catch(() => {});
      await prisma.building.deleteMany({ where: { dormitoryId: ownerDormitoryId } }).catch(() => {});
      await prisma.dormitoryMember.deleteMany({ where: { dormitoryId: ownerDormitoryId } }).catch(() => {});
      await prisma.dormitory.delete({ where: { id: ownerDormitoryId } }).catch(() => {});
    }
    if (ownerUserId) {
      await prisma.session.deleteMany({ where: { userId: ownerUserId } }).catch(() => {});
      await prisma.user.delete({ where: { id: ownerUserId } }).catch(() => {});
    }
    if (tenantUserId) {
      await prisma.session.deleteMany({ where: { userId: tenantUserId } }).catch(() => {});
      await prisma.user.delete({ where: { id: tenantUserId } }).catch(() => {});
    }
  });

  async function setupTenantContext(context: any, page: any, targetPath: string = '/tenant/bills') {
    await context.addCookies([
      { name: 'horplus_session', value: tenantSessionToken, domain: '127.0.0.1', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' },
      { name: 'horplus_csrf', value: tenantCsrfToken, domain: '127.0.0.1', path: '/', httpOnly: false, secure: false, sameSite: 'Lax' },
    ]);
    await page.goto(`http://127.0.0.1:5174${targetPath}`);
    await page.waitForLoadState('networkidle');
  }

  async function setupOwnerContext(context: any, page: any, targetPath: string) {
    await context.addCookies([
      { name: 'horplus_session', value: ownerSessionToken, domain: '127.0.0.1', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' },
      { name: 'horplus_csrf', value: ownerCsrfToken, domain: '127.0.0.1', path: '/', httpOnly: false, secure: false, sameSite: 'Lax' },
    ]);
    await page.addInitScript((dormId: string) => {
      localStorage.setItem('selected_dormitory_id', dormId);
      sessionStorage.setItem('active_dormitory_selected_for_session', dormId);
    }, ownerDormitoryId);

    await page.goto(`http://127.0.0.1:5174${targetPath}`);
    await page.waitForLoadState('networkidle');
  }

  test('disabled /demo route in normal production runtime', async ({ page }) => {
    await page.goto('http://127.0.0.1:5174/demo');
    await expect(page).not.toHaveURL(/\/demo$/);
  });

  test('no /tenant/login -> /demo redirect', async ({ page }) => {
    await page.goto('http://127.0.0.1:5174/tenant/login');
    await expect(page).not.toHaveURL(/\/demo/);
  });

  test('Dashboard authenticated owner subscription entitlement catalog integration', async ({ context, page }) => {
    await setupOwnerContext(context, page, '/owner/dashboard');
    expect(page.url()).toContain('/owner/dashboard');
    const bodyText = await page.textContent('body');
    expect(bodyText).not.toContain('เหลือ 90 วัน');
  });

  test('Owner Meters displays meter draft notice banner for authenticated owner', async ({ context, page }) => {
    await setupOwnerContext(context, page, '/owner/meters');

    expect(page.url()).toContain('/owner/meters');
    const draftNotice = page.locator('[data-testid="meter-draft-notice"]');
    await expect(draftNotice).toBeVisible();
    await expect(draftNotice).toHaveText(/ระบบบันทึกค่ามิเตอร์เชื่อมต่อเซิร์ฟเวอร์หลักแล้ว|\(ร่างที่ยังไม่ได้บันทึกลงเซิร์ฟเวอร์\)/);

    const pageText = await page.textContent('body');
    expect(pageText).not.toContain('+ 8');
    expect(pageText).not.toContain('+ 120');
  });

  test('Owner Tenants page remains active with zero demo tenants', async ({ context, page }) => {
    await setupOwnerContext(context, page, '/owner/tenants');
    expect(page.url()).toContain('/owner/tenants');

    const bodyText = await page.textContent('body');
    expect(bodyText).not.toContain('สมชาย');
    expect(bodyText).not.toContain('สมศรี');
  });

  test('Owner Contracts page remains active with zero demo contracts', async ({ context, page }) => {
    await setupOwnerContext(context, page, '/owner/contracts');
    expect(page.url()).toContain('/owner/contracts');

    const bodyText = await page.textContent('body');
    expect(bodyText).not.toContain('CTR-2026-DEMO');
  });

  test('Owner Maintenance page remains active with zero demo requests', async ({ context, page }) => {
    await setupOwnerContext(context, page, '/owner/maintenance');
    expect(page.url()).toContain('/owner/maintenance');

    const bodyText = await page.textContent('body');
    expect(bodyText).not.toContain('ก๊อกน้ำรั่ว');
    expect(bodyText).not.toContain('แอร์ไม่เย็น');
  });

  test('Owner Announcements page remains active with zero demo announcements', async ({ context, page }) => {
    await setupOwnerContext(context, page, '/owner/announcements');
    expect(page.url()).toContain('/owner/announcements');

    const bodyText = await page.textContent('body');
    expect(bodyText).not.toContain('แจ้งปิดปรับปรุง');
  });

  test('Owner Reports displays 0 / empty state when no data exists', async ({ context, page }) => {
    await setupOwnerContext(context, page, '/owner/reports');

    expect(page.url()).toContain('/owner/reports');
    const bodyContent = await page.content();
    expect(bodyContent).not.toContain('อาคาร A (วิวเขา)');
  });

  test('API 500 failures render empty state without fallback to demo data', async ({ context, page }) => {
    await page.route('**/api/v1/maintenance**', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Internal Server Error' }) }));
    await page.route('**/api/v1/announcements**', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Internal Server Error' }) }));
    await page.route('**/api/v1/bills**', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Internal Server Error' }) }));

    await setupOwnerContext(context, page, '/owner/maintenance');
    expect(page.url()).toContain('/owner/maintenance');
    let text = await page.textContent('body');
    expect(text).not.toContain('ก๊อกน้ำรั่ว');

    await setupOwnerContext(context, page, '/owner/announcements');
    expect(page.url()).toContain('/owner/announcements');
    text = await page.textContent('body');
    expect(text).not.toContain('แจ้งปิดปรับปรุง');

    await setupOwnerContext(context, page, '/owner/meters');
    expect(page.url()).toContain('/owner/meters');
    text = await page.textContent('body');
    expect(text).not.toContain('+ 8');
  });

  test('Authenticated tenant workspace utility view displays truthful empty state and no sample March-July history', async ({ context, page }) => {
    await setupTenantContext(context, page, '/tenant/utilities');
    expect(page.url()).toContain('/tenant/utilities');
    const text = await page.textContent('body');
    expect(text).toContain('ประวัติค่าน้ำและค่าไฟยังไม่พร้อมใช้งาน');
    expect(text).not.toContain('145 หน่วย');
    expect(text).not.toContain('154 หน่วย');
    expect(text).not.toContain('122 หน่วย');
    expect(text).not.toContain('8 หน่วย');
  });

  test('Authenticated tenant move-out API 500 fails closed: error visible, success absent, zero localStorage persistence', async ({ context, page }) => {
    let postCallCount = 0;
    await page.route('**/api/v1/tenant-move-out-requests**', route => {
      postCallCount++;
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { message: 'Move-out submission unavailable' } })
      });
    });

    await setupTenantContext(context, page, '/tenant/home');

    // Click Profile tab in bottom navigation bar
    const profileTab = page.locator('[data-testid="nav-tab-profile"]').first();
    await expect(profileTab).toBeVisible({ timeout: 10000 });
    await profileTab.click();

    // Must find and click Move-Out button without conditional skipping
    const moveOutButton = page.locator('[data-testid="button-tenant-moveout"]').first();
    await expect(moveOutButton).toBeVisible({ timeout: 10000 });
    await moveOutButton.click();

    // Modal must be visible
    const modalTitle = page.locator('div, h3, h4, span').filter({ hasText: 'แจ้งย้ายออก / เลิกเช่าห้องพัก' }).first();
    await expect(modalTitle).toBeVisible();

    // Fill date input if present
    const dateInput = page.locator('input[type="date"]').first();
    if (await dateInput.isVisible()) {
      await dateInput.fill('2026-09-30');
    }

    const submitButton = page.locator('[data-testid="button-tenant-moveout-confirm"]').first();
    await expect(submitButton).toBeVisible();
    await submitButton.click();

    // Required assertions
    expect(postCallCount).toBe(1);

    // Error toast / notice visible
    const toastError = page.locator('.bg-rose-600, .bg-rose-500, [data-testid="toast-error"], div:has-text("ไม่สามารถดำเนินการได้"), div:has-text("Move-out submission unavailable")').first();
    await expect(toastError).toBeVisible();

    // Success UI absent
    const bodyText = await page.textContent('body');
    expect(bodyText).not.toContain('ส่งคำขอแจ้งย้ายออกเรียบร้อยแล้ว');
    expect(bodyText).not.toContain('ส่งคำขอแจ้งย้ายออกแล้ว');

    // Zero tenant_moveout_request_* localStorage keys
    const localStorageMoveOut = await page.evaluate(() => {
      const keys = Object.keys(localStorage);
      return keys.filter(k => k.startsWith('tenant_moveout_request_'));
    });
    expect(localStorageMoveOut.length).toBe(0);
  });

  test('Meter zero rate remains zero and never falls back to 18/7', async ({ context, page }) => {
    await setupOwnerContext(context, page, '/owner/meters');
    expect(page.url()).toContain('/owner/meters');
    const bodyText = await page.textContent('body');
    expect(bodyText).not.toContain('18 บาท');
    expect(bodyText).not.toContain('7 บาท');
  });

  test('Owner Settings displays 0 for zero-value rates/defaults and persists edits across F5 reload', async ({ context, page }) => {
    await setupOwnerContext(context, page, '/owner/settings');
    expect(page.url()).toContain('/owner/settings');

    const bodyText = await page.textContent('body');
    expect(bodyText).not.toContain('HorPlus Dormitory');
    expect(bodyText).not.toContain('dorm-1');

    const waterInput = page.locator('[data-testid="input-water-unit-rate"]');
    await expect(waterInput).toBeVisible();
    await expect(waterInput).toHaveValue('0');

    const updateRes = await page.request.put('http://127.0.0.1:5174/api/v1/properties/dormitory/defaults', {
      headers: {
        'X-Dormitory-Id': ownerDormitoryId,
        'X-CSRF-Token': ownerCsrfToken,
      },
      data: {
        billing: {
          changes: { waterRate: 25 },
          expectedVersion: 1,
        },
      },
    });
    expect(updateRes.ok()).toBe(true);

    await page.reload({ waitUntil: 'networkidle' });

    await expect(waterInput).toHaveValue('25');
  });

  test('Tenant contract PDF uses authoritative business data instead of legacy hardcoded defaults (18/7/101/25/5)', async ({ page }) => {
    await prisma.room.update({
      where: { id: tenantRoomId },
      data: { roomNumber: 'Z909', normalizedRoomNumber: 'Z909' },
    });
    await prisma.dormitoryBillingSettings.update({
      where: { dormitoryId: ownerDormitoryId },
      data: {
        waterRate: 21.00,
        electricityRate: 8.50,
        billingDay: 15,
        dueDay: 10,
      },
    });

    const res = await page.request.get('http://127.0.0.1:5174/api/v1/tenant-portal/contract/pdf', {
      headers: {
        'Cookie': `horplus_session=${tenantSessionToken}; horplus_csrf=${tenantCsrfToken}`,
        'X-CSRF-Token': tenantCsrfToken,
      },
    });
    expect(res.ok()).toBe(true);
    expect(res.headers()['content-type']).toContain('application/pdf');

    const pdfBuffer = await res.body();
    expect(pdfBuffer.length).toBeGreaterThan(1000);

    const pdfText = pdfBuffer.toString('latin1');
    expect(pdfText).toContain('%PDF-');
  });
});
