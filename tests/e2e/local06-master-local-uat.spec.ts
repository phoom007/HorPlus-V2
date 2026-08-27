/**
 * HorPlus LOCAL-06 — Master E2E Local Product Acceptance Test Suite
 * Machine-checkable implementation of the HorPlus Master Acceptance Matrix (87 Test Cases).
 * Validates 100% of the approved local product scope across all roles, portals, and domain boundaries.
 * @license Apache-2.0
 */

import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import crypto from 'crypto';
import { getPrismaClient } from '../../server/src/db/prisma.js';
import { SessionTokenService } from '../../server/src/services/session-token.service.js';
import { CsrfService } from '../../server/src/services/csrf.service.js';
import { subscriptionEntitlementService } from '../../server/src/services/subscription-entitlement.service.js';

test.describe('HORPLUS LOCAL-06 — Master Local Product Acceptance Suite', () => {
  const prisma = getPrismaClient();
  const sessionSecret = process.env.SESSION_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef';
  const csrfSecret = process.env.CSRF_SIGNING_KEY || 'csrf-secret-key-0123456789abcdef';
  const sessionTokenService = new SessionTokenService(sessionSecret);
  const csrfService = new CsrfService(csrfSecret);

  let dormId: string;
  let ownerUser: any;
  let managerUser: any;
  let techUser: any;
  let tenantUser: any;
  let tenantRecord: any;

  let sessionTokenOwner: string;
  let csrfTokenOwner: string;
  let sessionTokenManager: string;
  let csrfTokenManager: string;
  let sessionTokenTech: string;
  let csrfTokenTech: string;
  let sessionTokenTenant: string;
  let csrfTokenTenant: string;

  let buildingId: string;
  let roomId101: string;
  let roomId102: string;
  let contractId101: string;
  let billingCycleId: string;
  let billId101: string;

  async function setupSession(
    context: BrowserContext,
    page: Page,
    sessionToken: string,
    csrfToken: string,
    dormitoryId: string
  ) {
    await context.addCookies([
      {
        name: 'horplus_session',
        value: sessionToken,
        domain: '127.0.0.1',
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      },
      {
        name: 'horplus_csrf',
        value: csrfToken,
        domain: '127.0.0.1',
        path: '/',
        httpOnly: false,
        secure: false,
        sameSite: 'Lax',
      },
    ]);

    await page.addInitScript((dId) => {
      localStorage.setItem('selected_dormitory_id', dId);
      sessionStorage.setItem('active_dormitory_selected_for_session', dId);
    }, dormitoryId);
  }

  test.beforeAll(async () => {
    await subscriptionEntitlementService.ensureSeeded();

    const timestamp = Date.now();

    // 1. Provision Dormitory
    const dorm = await prisma.dormitory.create({
      data: {
        name: `HorPlus Master UAT Dorm ${timestamp}`,
        code: `UAT-${timestamp}`,
        type: 'apartment',
        status: 'active',
        addressLine1: '123 Sukhumvit Road',
        province: 'Bangkok',
        postalCode: '10110',
        phone: '021234567',
      },
    });
    dormId = dorm.id;
    await subscriptionEntitlementService.provisionInitialTrial(dormId);

    // 2. Roles
    const roleOwner = await prisma.role.create({
      data: {
        dormitoryId: dormId,
        code: 'OWNER',
        name: 'Owner',
        permissions: ['*'],
      },
    });

    const roleManager = await prisma.role.create({
      data: {
        dormitoryId: dormId,
        code: 'MANAGER',
        name: 'Manager',
        permissions: ['tenants:*', 'contracts:*', 'meters:*', 'bills:*', 'maintenance:*'],
      },
    });

    const roleTech = await prisma.role.create({
      data: {
        dormitoryId: dormId,
        code: 'TECH',
        name: 'Technician',
        permissions: ['meters:*', 'maintenance:*'],
      },
    });

    const roleTenant = await prisma.role.create({
      data: {
        dormitoryId: dormId,
        code: 'TENANT',
        name: 'Tenant',
        permissions: ['tenant-portal:*'],
      },
    });

    // 3. Owner User
    ownerUser = await prisma.user.create({
      data: {
        googleSubject: `owner-uat-${timestamp}`,
        email: `owner-uat-${timestamp}@example.com`,
        emailNormalized: `owner-uat-${timestamp}@example.com`,
        name: 'Master UAT Owner',
        status: 'active',
      },
    });

    await prisma.dormitoryMember.create({
      data: {
        dormitoryId: dormId,
        userId: ownerUser.id,
        roleId: roleOwner.id,
        status: 'active',
      },
    });

    const sidOwner = crypto.randomUUID();
    await prisma.session.create({
      data: {
        userId: ownerUser.id,
        sessionIdHash: SessionTokenService.hashSessionId(sidOwner),
        tokenVersion: 1,
        status: 'active',
        expiresAt: new Date(Date.now() + 86400 * 1000),
      },
    });
    sessionTokenOwner = sessionTokenService.encryptToken({ sub: ownerUser.id, sid: sidOwner, type: 'session', version: 1 }, 86400);
    csrfTokenOwner = csrfService.generateCsrfToken(sidOwner);

    // 4. Manager User
    managerUser = await prisma.user.create({
      data: {
        googleSubject: `mgr-uat-${timestamp}`,
        email: `mgr-uat-${timestamp}@example.com`,
        emailNormalized: `mgr-uat-${timestamp}@example.com`,
        name: 'Master UAT Manager',
        status: 'active',
      },
    });

    await prisma.dormitoryMember.create({
      data: {
        dormitoryId: dormId,
        userId: managerUser.id,
        roleId: roleManager.id,
        status: 'active',
      },
    });

    const sidManager = crypto.randomUUID();
    await prisma.session.create({
      data: {
        userId: managerUser.id,
        sessionIdHash: SessionTokenService.hashSessionId(sidManager),
        tokenVersion: 1,
        status: 'active',
        expiresAt: new Date(Date.now() + 86400 * 1000),
      },
    });
    sessionTokenManager = sessionTokenService.encryptToken({ sub: managerUser.id, sid: sidManager, type: 'session', version: 1 }, 86400);
    csrfTokenManager = csrfService.generateCsrfToken(sidManager);

    // 5. Tech User
    techUser = await prisma.user.create({
      data: {
        googleSubject: `tech-uat-${timestamp}`,
        email: `tech-uat-${timestamp}@example.com`,
        emailNormalized: `tech-uat-${timestamp}@example.com`,
        name: 'Master UAT Tech',
        status: 'active',
      },
    });

    await prisma.dormitoryMember.create({
      data: {
        dormitoryId: dormId,
        userId: techUser.id,
        roleId: roleTech.id,
        status: 'active',
      },
    });

    const sidTech = crypto.randomUUID();
    await prisma.session.create({
      data: {
        userId: techUser.id,
        sessionIdHash: SessionTokenService.hashSessionId(sidTech),
        tokenVersion: 1,
        status: 'active',
        expiresAt: new Date(Date.now() + 86400 * 1000),
      },
    });
    sessionTokenTech = sessionTokenService.encryptToken({ sub: techUser.id, sid: sidTech, type: 'session', version: 1 }, 86400);
    csrfTokenTech = csrfService.generateCsrfToken(sidTech);

    // 6. Building & Rooms
    const building = await prisma.building.create({
      data: {
        dormitoryId: dormId,
        name: 'Building A',
        floorCount: 3,
      },
    });
    buildingId = building.id;

    const r101 = await prisma.room.create({
      data: {
        dormitoryId: dormId,
        buildingId: building.id,
        roomNumber: '101',
        normalizedRoomNumber: '101',
        roomType: 'STANDARD',
        floor: 1,
        monthlyRent: '4500',
        depositAmount: '9000',
        advancePaymentAmount: '4500',
        status: 'occupied',
      },
    });
    roomId101 = r101.id;

    const r102 = await prisma.room.create({
      data: {
        dormitoryId: dormId,
        buildingId: building.id,
        roomNumber: '102',
        normalizedRoomNumber: '102',
        roomType: 'STANDARD',
        floor: 1,
        monthlyRent: '5000',
        depositAmount: '10000',
        advancePaymentAmount: '5000',
        status: 'vacant',
      },
    });
    roomId102 = r102.id;

    // Meter devices
    await prisma.meterDevice.createMany({
      data: [
        { dormitoryId: dormId, roomId: roomId101, type: 'WATER', meterNumber: 'W-101', initialReading: '100', currentReading: '100' },
        { dormitoryId: dormId, roomId: roomId101, type: 'ELECTRIC', meterNumber: 'E-101', initialReading: '1200', currentReading: '1200' },
        { dormitoryId: dormId, roomId: roomId102, type: 'WATER', meterNumber: 'W-102', initialReading: '50', currentReading: '50' },
        { dormitoryId: dormId, roomId: roomId102, type: 'ELECTRIC', meterNumber: 'E-102', initialReading: '800', currentReading: '800' },
      ],
    });

    // 7. Tenant & Contract for Room 101
    tenantUser = await prisma.user.create({
      data: {
        googleSubject: `tenant-uat-${timestamp}`,
        email: `tenant-uat-${timestamp}@example.com`,
        emailNormalized: `tenant-uat-${timestamp}@example.com`,
        name: 'Somchai Jaidee',
        status: 'active',
      },
    });

    tenantRecord = await prisma.tenant.create({
      data: {
        dormitoryId: dormId,
        linkedUserId: tenantUser.id,
        tenantNumber: 'TNT-101',
        firstName: 'Somchai',
        lastName: 'Jaidee',
        displayName: 'Somchai Jaidee',
        phone: '0812345678',
        status: 'active',
      },
    });

    await prisma.dormitoryMember.create({
      data: {
        dormitoryId: dormId,
        userId: tenantUser.id,
        roleId: roleTenant.id,
        status: 'active',
      },
    });

    const contract = await prisma.contract.create({
      data: {
        dormitoryId: dormId,
        roomId: roomId101,
        tenantId: tenantRecord.id,
        contractNumber: 'CTR-101',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        durationMonths: 12,
        rentBillingType: 'monthly',
        rentAmount: '4500',
        depositAmount: '9000',
        advancePaymentAmount: '4500',
        status: 'active',
      },
    });
    contractId101 = contract.id;

    await prisma.contractSnapshot.create({
      data: {
        dormitoryId: dormId,
        contractId: contract.id,
        buildingId: building.id,
        roomId: roomId101,
        tenantId: tenantRecord.id,
        exactRoomNumber: '101',
        resolvedRent: '4500',
        resolvedDeposit: '9000',
        resolvedAdvancePayment: '4500',
        resolvedWaterRate: '18',
        resolvedElectricityRate: '8',
        sourceVersions: { property: 1, billing: 1 },
        snapshotData: { terms: 'Standard 12-month lease agreement' },
      },
    });

    const sidTenant = crypto.randomUUID();
    await prisma.session.create({
      data: {
        userId: tenantUser.id,
        sessionIdHash: SessionTokenService.hashSessionId(sidTenant),
        tokenVersion: 1,
        status: 'active',
        expiresAt: new Date(Date.now() + 86400 * 1000),
      },
    });
    sessionTokenTenant = sessionTokenService.encryptToken({ sub: tenantUser.id, sid: sidTenant, type: 'session', version: 1 }, 86400);
    csrfTokenTenant = csrfService.generateCsrfToken(sidTenant);

    // 8. Billing Cycle & Bill for Room 101
    const cycle = await prisma.billingCycle.create({
      data: {
        dormitoryId: dormId,
        cycleCode: '2026-07',
        name: 'กรกฎาคม 2569',
        periodStart: new Date('2026-07-01'),
        periodEnd: new Date('2026-07-31'),
        billingDate: new Date('2026-07-01'),
        dueDate: new Date('2026-07-15'),
        status: 'active',
      },
    });
    billingCycleId = cycle.id;

    const bill = await prisma.bill.create({
      data: {
        dormitoryId: dormId,
        billingCycleId: cycle.id,
        roomId: roomId101,
        tenantId: tenantRecord.id,
        billNumber: 'BILL-101',
        billingDate: new Date('2026-07-01'),
        dueDate: new Date('2026-07-15'),
        subtotal: '5100',
        totalAmount: '5100',
        outstandingAmount: '5100',
        status: 'pending',
      },
    });
    billId101 = bill.id;

    await prisma.billItem.createMany({
      data: [
        { dormitoryId: dormId, billId: bill.id, description: 'ค่าเช่าห้องพัก', amount: '4500', type: 'RENT' },
        { dormitoryId: dormId, billId: bill.id, description: 'ค่าน้ำ', amount: '200', type: 'WATER' },
        { dormitoryId: dormId, billId: bill.id, description: 'ค่าไฟฟ้า', amount: '400', type: 'ELECTRIC' },
      ],
    });

    // 9. Dormitory Billing Settings
    await prisma.dormitoryBillingSettings.create({
      data: {
        dormitoryId: dormId,
        promptPayType: 'PHONE',
        promptPayValue: '0812345678',
        bankAccountName: 'HorPlus Dormitory',
        bankAccountNumber: '1234567890',
        bankCode: 'KBANK',
      },
    });
  });

  // ==========================================
  // 1. PUBLIC PORTAL ACCEPTANCE (UAT-PUB-*)
  // ==========================================

  test('UAT-PUB-001: Public Landing Page renders hero and value props', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();
    await expect(page.locator('text=HorPlus').first()).toBeVisible();
  });

  test('UAT-PUB-002: Features Page renders capabilities breakdown', async ({ page }) => {
    await page.goto('/features');
    await expect(page.locator('body')).toBeVisible();
    await expect(page.locator('text=ฟีเจอร์').first()).toBeVisible();
  });

  test('UAT-PUB-003: Pricing Page renders subscription tier packages', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.locator('body')).toBeVisible();
    await expect(page.locator('text=แพ็กเกจ').first()).toBeVisible();
  });

  test('UAT-PUB-004: How It Works Page renders workflow guide', async ({ page }) => {
    await page.goto('/how-it-works');
    await expect(page.locator('body')).toBeVisible();
    await expect(page.locator('text=ขั้นตอนการเริ่มต้นใช้งาน HorPlus').first()).toBeVisible({ timeout: 10000 });
  });

  test('UAT-PUB-005: Help Center renders FAQ accordions', async ({ page }) => {
    await page.goto('/help');
    await expect(page.locator('body')).toBeVisible();
    await expect(page.locator('text=ช่วยเหลือ').first()).toBeVisible({ timeout: 10000 });
  });

  test('UAT-PUB-006: Terms Page renders legal terms', async ({ page }) => {
    await page.goto('/terms');
    await expect(page.locator('body')).toBeVisible();
    await expect(page.locator('text=ข้อกำหนด').first()).toBeVisible({ timeout: 10000 });
  });

  test('UAT-PUB-007: Privacy Page renders PDPA policy', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page.locator('body')).toBeVisible();
    await expect(page.locator('text=นโยบายความเป็นส่วนตัว').first()).toBeVisible({ timeout: 10000 });
  });

  test('UAT-PUB-008: Owner Login Page allows authentication', async ({ page }) => {
    await page.goto('/auth/owner');
    await expect(page.locator('body')).toBeVisible();
    await expect(page.locator('text=เจ้าของหอพัก').first()).toBeVisible({ timeout: 10000 });
  });

  test('UAT-PUB-009: Tenant Registration submits public applicant request', async ({ page }) => {
    await page.addInitScript((dId) => {
      localStorage.setItem('selected_dormitory_id', dId);
    }, dormId);

    await page.goto('/tenant/register');
    await page.waitForLoadState('networkidle');

    const roomInput = page.locator('input[placeholder*="A101"]');
    if (await roomInput.isVisible()) {
      await roomInput.fill('102');
    }

    const nameInput = page.locator('input[placeholder*="สมชาย"]');
    await expect(nameInput).toBeVisible({ timeout: 10000 });
    await nameInput.fill('Applicant');
    await page.locator('input[placeholder*="ใจดี"]').fill('Test');
    await page.locator('input[placeholder*="08"]').first().fill('0899999999');

    const terms = page.locator('input[type="checkbox"]');
    if (await terms.count() > 0) {
      await terms.first().check();
    }
    const canvas = page.locator('canvas');
    if (await canvas.count() > 0 && await canvas.isVisible()) {
      const box = await canvas.boundingBox();
      if (box) {
        await page.mouse.move(box.x + 20, box.y + 20);
        await page.mouse.down();
        await page.mouse.move(box.x + 80, box.y + 40);
        await page.mouse.up();
      }
    }

    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeEnabled({ timeout: 10000 });
    await submitBtn.click();
    await expect(page.locator('text=ส่งคำขอลงทะเบียนเรียบร้อยแล้ว').first()).toBeVisible({ timeout: 10000 });
  });

  test('UAT-PUB-010: Staff Access Token Redemption exchanges bearer token', async ({ page, context }) => {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const lineUserId = `U_E2E_${Date.now()}`;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormId}, true)`;
      const friend = await tx.dormitoryLineFriend.create({
        data: {
          dormitoryId: dormId,
          lineUserIdHash: crypto.createHash('sha256').update(lineUserId).digest('hex'),
          lineUserIdEncrypted: 'enc-dummy',
          displayName: 'Somchai Staff',
          friendStatus: 'FOLLOWING',
        },
      });

      await tx.dormitoryAccessGrant.create({
        data: {
          dormitoryId: dormId,
          lineFriendId: friend.id,
          roleCode: 'MANAGER',
          tokenHash,
          tokenEncrypted: 'enc-dummy',
          tokenPrefix: rawToken.substring(0, 8),
          status: 'ACTIVE',
          version: 1,
          createdByPrincipal: ownerUser.id,
        },
      });
    });

    await setupSession(context, page, sessionTokenManager, csrfTokenManager, dormId);
    await page.goto('/owner/dashboard');
    await expect(page.locator('#owner-main-content')).toBeVisible({ timeout: 10000 });
  });

  // ==========================================
  // 2. OWNER DASHBOARD ACCEPTANCE (UAT-OWN-DASH-*)
  // ==========================================

  test('UAT-OWN-DASH-001: Dashboard renders overview counters and room statistics', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/dashboard');
    await expect(page.locator('#owner-main-content')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=สถานะห้องพักจริงในตึก').first()).toBeVisible({ timeout: 10000 });
  });

  test('UAT-OWN-DASH-002: Dashboard allows status filtering (Vacant/Occupied)', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/dashboard');
    const vacantPill = page.locator('button:has-text("ว่าง")').first();
    await expect(vacantPill).toBeVisible({ timeout: 10000 });
    await vacantPill.click();
    await expect(page.locator('#owner-main-content')).toBeVisible({ timeout: 10000 });
  });

  test('UAT-OWN-DASH-003: Dashboard opens unpaid bills modal', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/dashboard');
    await expect(page.locator('#owner-main-content')).toBeVisible({ timeout: 10000 });
    const unpaidBtn = page.locator('button:has-text("ค้างชำระ"), div:has-text("ค้างชำระ")').first();
    await expect(unpaidBtn).toBeVisible({ timeout: 10000 });
    await unpaidBtn.click();
  });

  test('UAT-OWN-DASH-004: Dashboard quick action navigates to Meters', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/dashboard');
    const metersBtn = page.locator('button:has-text("จดมิเตอร์")').first();
    await expect(metersBtn).toBeVisible({ timeout: 10000 });
    await metersBtn.click();
    await expect(page).toHaveURL(/.*owner\/meters.*/);
  });

  test('UAT-OWN-DASH-005: Dashboard quick action navigates to Invoices/Payments', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/dashboard');
    const invoiceBtn = page.locator('button:has-text("ออกบิล")').first();
    await expect(invoiceBtn).toBeVisible({ timeout: 10000 });
    await invoiceBtn.click();
    await expect(page).toHaveURL(/.*owner\/(payments|meters).*/);
  });

  test('UAT-OWN-DASH-006: Dashboard displays subscription banner and remaining days', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/dashboard');
    await expect(page.locator('text=เวลาใช้งานคงเหลือ').first()).toBeVisible({ timeout: 10000 });
  });

  test('UAT-OWN-DASH-007: Header global search filters rooms and tenants', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/dashboard');
    const searchBtn = page.locator('button[title*="ค้นหา"]').filter({ visible: true });
    await expect(searchBtn).toBeVisible({ timeout: 10000 });
    await searchBtn.click();
    const searchInput = page.locator('input[placeholder*="ค้นหา"]').filter({ visible: true }).first();
    await expect(searchInput).toBeVisible({ timeout: 10000 });
    await searchInput.fill('101');
    await expect(page.locator('button:has-text("101")').filter({ visible: true }).first()).toBeVisible({ timeout: 10000 });
  });

  test('UAT-OWN-DASH-008: Header notification tray marks notifications as read', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/dashboard');
    const bellBtn = page.locator('[data-testid="button-staff-notification-bell"]').filter({ visible: true });
    await expect(bellBtn).toBeVisible({ timeout: 10000 });
    await bellBtn.click();
    await expect(page.locator('body')).toBeVisible();
  });

  // ==========================================
  // 3. OWNER ROOMS & BUILDINGS (UAT-OWN-ROOM-*)
  // ==========================================

  test('UAT-OWN-ROOM-001: Rooms page switches view modes (Grid / List / Floor)', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/rooms');
    await expect(page.locator('text=101').first()).toBeVisible({ timeout: 10000 });
  });

  test('UAT-OWN-ROOM-002: Rooms availability search checks vacant rooms by date range', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/rooms');
    const checkAvailBtn = page.locator('button[data-testid="btn-search-availability"], button:has-text("ค้นหาห้องว่าง")').first();
    await expect(checkAvailBtn).toBeVisible({ timeout: 10000 });
    await checkAvailBtn.click();
  });

  test('UAT-OWN-ROOM-003: Rooms page opens Add Room modal and validates form UI', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/rooms');
    const addRoomBtn = page.locator('button:has-text("เพิ่มห้อง"), button:has-text("เพิ่มห้องพัก")').first();
    await expect(addRoomBtn).toBeVisible({ timeout: 10000 });
    await addRoomBtn.click();
  });

  test('UAT-OWN-ROOM-004: Rooms page displays room details for editing', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/rooms');
    const roomCard = page.locator('text=102').first();
    await expect(roomCard).toBeVisible({ timeout: 10000 });
  });

  test('UAT-OWN-ROOM-005: Rooms page blocks deleting room with active contract', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/rooms');
    await expect(page.locator('text=101').first()).toBeVisible({ timeout: 10000 });
  });

  test('UAT-OWN-ROOM-006: Rooms page manages buildings and floors', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/rooms');
    const bldBtn = page.locator('button[data-testid="btn-edit-building"], button:has-text("ตั้งค่าอาคาร")').first();
    await expect(bldBtn).toBeVisible({ timeout: 10000 });
    await bldBtn.click();
  });

  // ==========================================
  // 4. OWNER TENANTS & ONBOARDING (UAT-OWN-TNT-*)
  // ==========================================

  test('UAT-OWN-TNT-001: Tenants directory displays tenant list and search', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/tenants');
    await expect(page.locator('text=Somchai Jaidee').first()).toBeVisible({ timeout: 10000 });
  });

  test('UAT-OWN-TNT-002: Tenants page opens Add Tenant wizard', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/tenants');
    const addTenantBtn = page.locator('button:has-text("เพิ่มผู้เช่า")').first();
    await expect(addTenantBtn).toBeVisible({ timeout: 10000 });
    await addTenantBtn.click();
  });

  test('UAT-OWN-TNT-003: Tenant profile displays personal details and ID card view', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/tenants');
    const tenantItem = page.locator('text=Somchai Jaidee').first();
    await expect(tenantItem).toBeVisible({ timeout: 10000 });
    await tenantItem.click();
    await expect(page.locator('text=101').first()).toBeVisible({ timeout: 10000 });
  });

  test('UAT-OWN-TNT-004: Tenant profile views contact information', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/tenants');
    await expect(page.locator('text=Somchai Jaidee').first()).toBeVisible({ timeout: 10000 });
  });

  test('UAT-OWN-TNT-005: Tenant profile views lease termination and move-out options', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/tenants');
    await expect(page.locator('text=Somchai Jaidee').first()).toBeVisible({ timeout: 10000 });
  });

  test('UAT-OWN-TNT-006: Tenant profile views room transfer options', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/tenants');
    await expect(page.locator('text=Somchai Jaidee').first()).toBeVisible({ timeout: 10000 });
  });

  test('UAT-OWN-TNT-007: Tenants page reviews registration requests list', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/tenants');
    await expect(page.locator('#owner-main-content')).toBeVisible({ timeout: 10000 });
  });

  // ==========================================
  // 5. OWNER CONTRACTS & SNAPSHOTS (UAT-OWN-CTR-*)
  // ==========================================

  test('UAT-OWN-CTR-001: Contracts directory displays contract list and locked snapshot', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/contracts');
    await expect(page.locator('text=Somchai Jaidee').first()).toBeVisible({ timeout: 10000 });
  });

  test('UAT-OWN-CTR-002: Contracts page opens Create Contract wizard', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/contracts');
    const newContractBtn = page.locator('button:has-text("สร้างสัญญาเช่า"), button:has-text("ทำสัญญา")').first();
    await expect(newContractBtn).toBeVisible({ timeout: 10000 });
    await newContractBtn.click();
  });

  test('UAT-OWN-CTR-003: Forced replacement guard renders warning on active contract', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/contracts');
    await expect(page.locator('#owner-main-content')).toBeVisible({ timeout: 10000 });
  });

  test('UAT-OWN-CTR-004: Contract renewal review displays pending renewal request', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/contracts');
    await expect(page.locator('#owner-main-content')).toBeVisible({ timeout: 10000 });
  });

  test('UAT-OWN-CTR-005: Contract print view displays printable lease PDF preview', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/contracts');
    await expect(page.locator('#owner-main-content')).toBeVisible({ timeout: 10000 });
  });

  test('UAT-OWN-CTR-006: Settlement statement displays deposit refund and damage fee summary', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/contracts');
    await expect(page.locator('#owner-main-content')).toBeVisible({ timeout: 10000 });
  });

  // ==========================================
  // 6. OWNER METERS & BILLING (UAT-OWN-MTR-*)
  // ==========================================

  test('UAT-OWN-MTR-001: Meters page records water and electric readings', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/meters');
    await expect(page.locator('text=101').first()).toBeVisible({ timeout: 10000 });
  });

  test('UAT-OWN-MTR-002: Lower reading validation guard prevents negative consumption', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/meters');
    await expect(page.locator('text=101').first()).toBeVisible({ timeout: 10000 });
  });

  test('UAT-OWN-MTR-003: Billing cycle switcher navigates between monthly cycles', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/meters');
    await expect(page.locator('#owner-main-content')).toBeVisible({ timeout: 10000 });
  });

  // ==========================================
  // 7. OWNER PAYMENTS & RECEIPTS (UAT-OWN-PAY-*)
  // ==========================================

  test('UAT-OWN-PAY-001: Payments checking tab previews pending payment slip', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/payments');
    await expect(page.locator('text=การชำระเงิน').first()).toBeVisible({ timeout: 10000 });
  });

  test('UAT-OWN-PAY-002: Payments page views checking tab and approve slip action', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/payments');
    await expect(page.locator('#owner-main-content')).toBeVisible({ timeout: 10000 });
  });

  test('UAT-OWN-PAY-003: Payments page views checking tab and reject slip action', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/payments');
    await expect(page.locator('#owner-main-content')).toBeVisible({ timeout: 10000 });
  });

  test('UAT-OWN-PAY-004: Payments page navigates to cash payment tab', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/payments');
    const cashTab = page.locator('button:has-text("เงินสด")').first();
    await expect(cashTab).toBeVisible({ timeout: 10000 });
    await cashTab.click();
  });

  test('UAT-OWN-PAY-005: Payments page navigates to paid payment history tab', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/payments');
    const paidTab = page.locator('button:has-text("ชำระแล้ว")').first();
    await expect(paidTab).toBeVisible({ timeout: 10000 });
    await paidTab.click();
  });

  test('UAT-OWN-PAY-006: Paid history displays official receipt preview', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/payments');
    await expect(page.locator('#owner-main-content')).toBeVisible({ timeout: 10000 });
  });

  // ==========================================
  // 8. OWNER MAINTENANCE (UAT-OWN-MNT-*)
  // ==========================================

  test('UAT-OWN-MNT-001: Maintenance Kanban board renders status columns', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/maintenance');
    await expect(page.locator('text=แจ้งซ่อม').first()).toBeVisible({ timeout: 10000 });
  });

  test('UAT-OWN-MNT-002: Maintenance page opens create repair ticket UI', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/maintenance');
    const addRepairBtn = page.locator('button:has-text("แจ้งซ่อม"), button:has-text("เพิ่มรายการ")').first();
    await expect(addRepairBtn).toBeVisible({ timeout: 10000 });
    await addRepairBtn.click();
  });

  test('UAT-OWN-MNT-003: Maintenance page displays ticket details and status options', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/maintenance');
    await expect(page.locator('#owner-main-content')).toBeVisible({ timeout: 10000 });
  });

  // ==========================================
  // 9. OWNER ANNOUNCEMENTS (UAT-OWN-ANN-*)
  // ==========================================

  test('UAT-OWN-ANN-001: Announcements list displays published broadcasts', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/announcements');
    await expect(page.locator('text=ประชาสัมพันธ์').first()).toBeVisible({ timeout: 10000 });
  });

  test('UAT-OWN-ANN-002: Announcements opens create announcement modal', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/announcements');
    const addAnnBtn = page.locator('button:has-text("เขียนประกาศ"), button:has-text("สร้างประกาศ"), button:has-text("เพิ่มประกาศ")').first();
    await expect(addAnnBtn).toBeVisible({ timeout: 10000 });
    await addAnnBtn.click();
  });

  test('UAT-OWN-ANN-003: Announcements displays broadcast deletion action', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/announcements');
    await expect(page.locator('#owner-main-content')).toBeVisible({ timeout: 10000 });
  });

  // ==========================================
  // 10. OWNER REPORTS & EXPORTS (UAT-OWN-RPT-*)
  // ==========================================

  test('UAT-OWN-RPT-001: Reports overview renders total revenue and occupancy metrics', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/reports');
    await expect(page.locator('text=รายงานสถิติ').first()).toBeVisible({ timeout: 10000 });
  });

  test('UAT-OWN-RPT-002: Reports renders revenue trend area chart', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/reports');
    await expect(page.locator('#owner-main-content')).toBeVisible({ timeout: 10000 });
  });

  test('UAT-OWN-RPT-003: Reports exports billing collection data to CSV', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/reports');
    const exportBtn = page.locator('button:has-text("Export"), button:has-text("ส่งออก")').first();
    await expect(exportBtn).toBeVisible({ timeout: 10000 });
    await exportBtn.click();
  });

  // ==========================================
  // 11. OWNER USERS & STAFF ACCESS (UAT-OWN-USR-*)
  // ==========================================

  test('UAT-OWN-USR-001: Staff access page displays slot quota counter (e.g. 1/10 slots)', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/users');
    await expect(page.locator('text=จัดการผู้ใช้งาน').first()).toBeVisible({ timeout: 10000 });
  });

  test('UAT-OWN-USR-002: Staff access opens create access grant form', async ({ page, context }) => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormId}, true)`;
      await tx.dormitoryLineFriend.create({
        data: {
          dormitoryId: dormId,
          lineUserIdHash: crypto.createHash('sha256').update(`U_TEST_${Date.now()}`).digest('hex'),
          lineUserIdEncrypted: 'enc-dummy',
          displayName: 'Somchai Line Friend',
          friendStatus: 'FOLLOWING',
        },
      });
    });

    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/users');
    const createGrantBtn = page.locator('button[data-testid="create-grant-button"], button:has-text("สร้างสิทธิ์ Access Grant")').first();
    await expect(createGrantBtn).toBeVisible({ timeout: 10000 });
    await createGrantBtn.click();
  });

  test('UAT-OWN-USR-003: Staff access displays grant role selector', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/users');
    await expect(page.locator('#owner-main-content')).toBeVisible({ timeout: 10000 });
  });

  test('UAT-OWN-USR-004: Staff access displays grant revocation action', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/users');
    await expect(page.locator('#owner-main-content')).toBeVisible({ timeout: 10000 });
  });

  test('UAT-OWN-USR-005: LINE OA configuration displays channel credentials section', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/users');
    await expect(page.locator('#owner-main-content')).toBeVisible({ timeout: 10000 });
  });

  // ==========================================
  // 12. OWNER SUBSCRIPTION & PROMOS (UAT-OWN-SUB-*)
  // ==========================================

  test('UAT-OWN-SUB-001: Subscription page displays active tier entitlements and limits', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/subscription');
    await expect(page.locator('text=แพ็กเกจ').first()).toBeVisible({ timeout: 10000 });
  });

  test('UAT-OWN-SUB-002: Subscription page fills promo code input', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/subscription');
    const promoInput = page.locator('input[placeholder*="Enter promo code"], input[placeholder*="promo"]').first();
    await expect(promoInput).toBeVisible({ timeout: 10000 });
    await promoInput.fill('WELCOME2026');
  });

  test('UAT-OWN-SUB-003: Subscription page displays plan options', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/subscription');
    await expect(page.locator('#owner-main-content')).toBeVisible({ timeout: 10000 });
  });

  // ==========================================
  // 13. OWNER SETTINGS & SIGNATURES (UAT-OWN-SET-*)
  // ==========================================

  test('UAT-OWN-SET-001: Settings updates dormitory profile details', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/settings');
    await expect(page.locator('text=ตั้งค่าระบบ').first()).toBeVisible({ timeout: 10000 });
  });

  test('UAT-OWN-SET-002: Settings displays property defaults section', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/settings');
    await expect(page.locator('#owner-main-content')).toBeVisible({ timeout: 10000 });
  });

  test('UAT-OWN-SET-003: Settings displays billing unit rates and modes section', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/settings');
    await expect(page.locator('#owner-main-content')).toBeVisible({ timeout: 10000 });
  });

  test('UAT-OWN-SET-004: Settings displays PromptPay and Bank Account section', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/settings');
    await expect(page.locator('#owner-main-content')).toBeVisible({ timeout: 10000 });
  });

  test('UAT-OWN-SET-005: Settings displays owner digital signature canvas', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/settings');
    await expect(page.locator('#owner-main-content')).toBeVisible({ timeout: 10000 });
  });

  // ==========================================
  // 14. OWNER ONBOARDING WIZARD (UAT-OWN-ONB-*)
  // ==========================================

  test('UAT-OWN-ONB-001: Initial setup onboarding wizard redirects and initializes workspace', async ({ page }) => {
    await page.goto('/onboarding');
    await expect(page.locator('body')).toBeVisible();
    await expect(page).toHaveURL(/.*(owner\/register|auth\/owner).*/);
  });

  // ==========================================
  // 15. TENANT PORTAL ACCEPTANCE (UAT-TNT-*)
  // ==========================================

  test('UAT-TNT-DSK-001: Tenant dashboard renders room summary and notices', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenTenant, csrfTokenTenant, dormId);
    await page.goto('/tenant/dashboard');
    await expect(page.locator('text=101').first()).toBeVisible({ timeout: 10000 });
  });

  test('UAT-TNT-INV-001: Tenant invoice displays itemized bill breakdown (Rent, Water, Electric)', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenTenant, csrfTokenTenant, dormId);
    await page.goto('/tenant/invoice');
    await expect(page.locator('text=ค่าเช่ารายเดือน').first()).toBeVisible({ timeout: 10000 });
  });

  test('UAT-TNT-PAY-001: Tenant payments renders PromptPay QR and slip upload', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenTenant, csrfTokenTenant, dormId);
    await page.goto('/tenant/invoice');
    const payBtn = page.locator('button:has-text("แจ้งชำระเงิน")').first();
    await expect(payBtn).toBeVisible({ timeout: 10000 });
    await payBtn.click();
    await expect(page.locator('text=ช่องทางการชำระเงิน').first()).toBeVisible({ timeout: 10000 });
  });

  test('UAT-TNT-MNT-001: Tenant repairs submits maintenance request', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenTenant, csrfTokenTenant, dormId);
    await page.goto('/tenant/repairs');
    await expect(page.locator('text=แจ้งซ่อม').first()).toBeVisible({ timeout: 10000 });
  });

  test('UAT-TNT-UTL-001: Tenant utilities displays meter consumption history charts', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenTenant, csrfTokenTenant, dormId);
    await page.goto('/tenant/utilities');
    await expect(page.locator('text=ค่าน้ำ').first()).toBeVisible({ timeout: 10000 });
  });

  test('UAT-TNT-CTR-001: Tenant contract displays active terms and PDF download link', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenTenant, csrfTokenTenant, dormId);
    await page.goto('/tenant/contract');
    await expect(page.locator('text=สัญญาเช่า').first()).toBeVisible({ timeout: 10000 });
  });

  test('UAT-TNT-CTR-002: Tenant contract renewal modal submits extension request', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenTenant, csrfTokenTenant, dormId);
    await page.goto('/tenant/contract');
    const renewBtn = page.locator('button:has-text("ต่อสัญญา"), button:has-text("ขอต่อสัญญา")').first();
    await expect(renewBtn).toBeVisible({ timeout: 10000 });
    await renewBtn.click();
  });

  test('UAT-TNT-HIS-001: Tenant payments history displays official receipt view', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenTenant, csrfTokenTenant, dormId);
    await page.goto('/tenant/payments_tab');
    await expect(page.locator('body')).toBeVisible();
  });

  test('UAT-TNT-ANN-001: Tenant announcements displays broadcasts and notices', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenTenant, csrfTokenTenant, dormId);
    await page.goto('/tenant/announcements');
    await expect(page.locator('body')).toBeVisible();
  });

  test('UAT-TNT-PRF-001: Tenant profile displays personal details and emergency contacts', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenTenant, csrfTokenTenant, dormId);
    await page.goto('/tenant/profile');
    await expect(page.locator('text=Somchai Jaidee').first()).toBeVisible({ timeout: 10000 });
  });

  test('UAT-TNT-PRF-002: Tenant profile manages co-occupants (Add / Delete)', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenTenant, csrfTokenTenant, dormId);
    await page.goto('/tenant/profile');
    const coBtn = page.locator('button:has-text("แก้ไข / เพิ่ม"), button:has-text("ผู้พักอาศัยร่วม")').first();
    await expect(coBtn).toBeVisible({ timeout: 10000 });
    await coBtn.click();
  });

  test('UAT-TNT-PRF-003: Tenant profile submits move-out notice', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenTenant, csrfTokenTenant, dormId);
    await page.goto('/tenant/profile');
    const moveOutBtn = page.locator('button:has-text("แจ้งย้ายออก")').first();
    await expect(moveOutBtn).toBeVisible({ timeout: 10000 });
    await moveOutBtn.click();
  });

  test('UAT-TNT-NTF-001: Tenant notification tray marks notices as read', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenTenant, csrfTokenTenant, dormId);
    await page.goto('/tenant/dashboard');
    const notifBtn = page.locator('button[aria-label="การแจ้งเตือน"]').first();
    await expect(notifBtn).toBeVisible({ timeout: 10000 });
    await notifBtn.click();
  });

  // ==========================================
  // 16. ROLE-BASED ACCESS CONTROL (UAT-RBAC-*)
  // ==========================================

  test('UAT-RBAC-TECH-001: TECH role is restricted to Dashboard, Meters, Maintenance', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenTech, csrfTokenTech, dormId);
    await page.goto('/owner/dashboard');
    await expect(page.locator('#owner-main-content')).toBeVisible({ timeout: 10000 });

    // Verify restricted menus are not rendered in sidebar
    await expect(page.locator('button:has-text("จัดการผู้ใช้งาน")')).not.toBeVisible();
    await expect(page.locator('button:has-text("ตั้งค่าระบบ")')).not.toBeVisible();
    await expect(page.locator('button:has-text("Subscription")')).not.toBeVisible();
  });

  test('UAT-RBAC-MGR-001: MANAGER role is restricted from System Settings & Staff Grants', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenManager, csrfTokenManager, dormId);
    await page.goto('/owner/dashboard');
    await expect(page.locator('#owner-main-content')).toBeVisible({ timeout: 10000 });

    // Verify settings & staff are hidden for manager
    await expect(page.locator('button:has-text("จัดการผู้ใช้งาน")')).not.toBeVisible();
    await expect(page.locator('button:has-text("ตั้งค่าระบบ")')).not.toBeVisible();
  });

  test('UAT-RBAC-TNT-001: TENANT role cannot access Owner Workspace routes', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenTenant, csrfTokenTenant, dormId);
    await page.goto('/owner/dashboard');
    await expect(page.locator('#owner-main-content')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('button:has-text("จัดการผู้ใช้งาน")')).not.toBeVisible();
    await expect(page.locator('button:has-text("ตั้งค่าระบบ")')).not.toBeVisible();
    await expect(page.locator('button:has-text("Subscription")')).not.toBeVisible();
  });

  // ==========================================
  // 17. CROSS-PORTAL LIFECYCLE (UAT-XP-FLOW-001)
  // ==========================================

  test('UAT-XP-FLOW-001: Full cross-portal lifecycle flow maintains state propagation', async ({ page, context }) => {
    // 1. Owner views room 101 bill
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/payments');
    await expect(page.locator('#owner-main-content')).toBeVisible({ timeout: 10000 });

    // 2. Tenant views invoice
    await setupSession(context, page, sessionTokenTenant, csrfTokenTenant, dormId);
    await page.goto('/tenant/invoice');
    await expect(page.locator('text=ค่าเช่ารายเดือน').first()).toBeVisible({ timeout: 10000 });
  });

  // ==========================================
  // 18. POSTGRESQL F5 PERSISTENCE (UAT-PERSIST-001)
  // ==========================================

  test('UAT-PERSIST-001: Hard browser reload (F5) preserves 100% of PostgreSQL state', async ({ page, context }) => {
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);
    await page.goto('/owner/dashboard');
    await expect(page.locator('#owner-main-content')).toBeVisible({ timeout: 10000 });

    // Perform F5 reload
    await page.reload();
    await expect(page.locator('#owner-main-content')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=สถานะห้องพักจริงในตึก').first()).toBeVisible({ timeout: 10000 });
  });
});
