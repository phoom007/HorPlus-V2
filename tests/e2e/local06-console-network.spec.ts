/**
 * HorPlus LOCAL-06 — Console & Network Error Audit E2E Suite
 * Validates that all representative routes, views, and core flows execute with:
 * - ZERO uncaught runtime exceptions (pageerror)
 * - ZERO unhandled HTTP 5xx server responses
 * @license Apache-2.0
 */

import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import crypto from 'crypto';
import { getPrismaClient } from '../../server/src/db/prisma.js';
import { SessionTokenService } from '../../server/src/services/session-token.service.js';
import { CsrfService } from '../../server/src/services/csrf.service.js';
import { subscriptionEntitlementService } from '../../server/src/services/subscription-entitlement.service.js';

test.describe('LOCAL-06 Console & Network Cleanliness Audit', () => {
  const prisma = getPrismaClient();
  const sessionSecret = process.env.SESSION_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef';
  const csrfSecret = process.env.CSRF_SIGNING_KEY || 'csrf-secret-key-0123456789abcdef';
  const sessionTokenService = new SessionTokenService(sessionSecret);
  const csrfService = new CsrfService(csrfSecret);

  let dormId: string;
  let ownerUser: any;
  let tenantUser: any;
  let tenantRecord: any;
  let roomId: string;
  let cycleId: string;

  let sessionTokenOwner: string;
  let csrfTokenOwner: string;
  let sessionTokenTenant: string;
  let csrfTokenTenant: string;

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

  function attachCleanlinessGuards(page: Page) {
    const pageErrors: Error[] = [];
    const server5xxErrors: { url: string; status: number }[] = [];

    page.on('pageerror', (err) => {
      pageErrors.push(err);
    });

    page.on('response', (res) => {
      if (res.status() >= 500) {
        server5xxErrors.push({ url: res.url(), status: res.status() });
      }
    });

    return {
      assertClean: () => {
        expect(pageErrors, `Encountered unexpected page errors: ${pageErrors.map(e => e.message).join('; ')}`).toEqual([]);
        expect(server5xxErrors, `Encountered HTTP 5xx responses: ${JSON.stringify(server5xxErrors)}`).toEqual([]);
      },
    };
  }

  test.beforeAll(async () => {
    await subscriptionEntitlementService.ensureSeeded();
    const timestamp = Date.now();

    // 1. Provision Dormitory
    const dorm = await prisma.dormitory.create({
      data: {
        name: `Audit Dorm ${timestamp}`,
        code: `AUDIT-${timestamp}`,
        type: 'apartment',
        status: 'active',
        addressLine1: '789 Rama IV Road',
        province: 'Bangkok',
        postalCode: '10110',
        phone: '023334444',
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
        googleSubject: `owner-audit-${timestamp}`,
        email: `owner-audit-${timestamp}@example.com`,
        emailNormalized: `owner-audit-${timestamp}@example.com`,
        name: 'Audit Owner',
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

    // 4. Building & Room
    const building = await prisma.building.create({
      data: {
        dormitoryId: dormId,
        name: 'Building 1',
        floorCount: 3,
      },
    });

    const room = await prisma.room.create({
      data: {
        dormitoryId: dormId,
        buildingId: building.id,
        roomNumber: 'AUDIT-101',
        normalizedRoomNumber: 'AUDIT-101',
        floor: 1,
        monthlyRent: 4500,
        depositAmount: 9000,
        status: 'occupied',
      },
    });
    roomId = room.id;

    // 5. Tenant User & Record
    tenantUser = await prisma.user.create({
      data: {
        googleSubject: `tenant-audit-${timestamp}`,
        email: `tenant-audit-${timestamp}@example.com`,
        emailNormalized: `tenant-audit-${timestamp}@example.com`,
        name: 'Audit Tenant',
        status: 'active',
      },
    });

    tenantRecord = await prisma.tenant.create({
      data: {
        dormitoryId: dormId,
        linkedUserId: tenantUser.id,
        tenantNumber: 'TNT-AUD-101',
        firstName: 'Somchai',
        lastName: 'Jaidee',
        displayName: 'Somchai Jaidee',
        phone: '0891234567',
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

    await prisma.contract.create({
      data: {
        dormitoryId: dormId,
        roomId: room.id,
        tenantId: tenantRecord.id,
        contractNumber: 'CTR-AUD-101',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        durationMonths: 12,
        rentAmount: 4500,
        depositAmount: 9000,
        status: 'active',
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

    // 6. Billing Cycle & Readings
    const cycle = await prisma.billingCycle.create({
      data: {
        dormitoryId: dormId,
        cycleCode: '2026-08',
        name: 'สิงหาคม 2569',
        periodStart: new Date('2026-08-01'),
        periodEnd: new Date('2026-08-31'),
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-05'),
        status: 'active',
      },
    });
    cycleId = cycle.id;

    await prisma.meterDevice.create({
      data: {
        dormitoryId: dormId,
        roomId: room.id,
        type: 'water',
        meterNumber: `WM-${room.roomNumber}`,
        currentReading: 100,
        status: 'active',
      },
    });

    await prisma.meterDevice.create({
      data: {
        dormitoryId: dormId,
        roomId: room.id,
        type: 'electric',
        meterNumber: `EM-${room.roomNumber}`,
        currentReading: 500,
        status: 'active',
      },
    });
  });

  test('Public routes navigate cleanly with zero console runtime errors or HTTP 5xx', async ({ page }) => {
    const guard = attachCleanlinessGuards(page);

    const publicRoutes = ['/', '/features', '/pricing', '/how-it-works', '/help', '/terms', '/privacy', '/auth/owner', '/tenant/register'];
    for (const route of publicRoutes) {
      await page.goto(route);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(100);
    }

    guard.assertClean();
  });

  test('Owner Workspace navigates all tabs cleanly with zero console runtime errors or HTTP 5xx', async ({ page, context }) => {
    const guard = attachCleanlinessGuards(page);
    await setupSession(context, page, sessionTokenOwner, csrfTokenOwner, dormId);

    const ownerTabs = [
      'dashboard',
      'meters',
      'payments',
      'rooms',
      'tenants',
      'contracts',
      'maintenance',
      'announcements',
      'reports',
      'users',
      'subscription',
      'settings',
    ];

    for (const tab of ownerTabs) {
      await page.goto(`/owner/${tab}`);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(200);
      await expect(page.locator('#owner-main-content')).toBeVisible();
    }

    guard.assertClean();
  });

  test('Tenant Portal subviews & co-occupant management flows execute with zero 5xx or runtime errors', async ({ page, context }) => {
    const guard = attachCleanlinessGuards(page);
    await setupSession(context, page, sessionTokenTenant, csrfTokenTenant, dormId);

    await page.goto('/tenant');
    await page.waitForLoadState('domcontentloaded');

    // Test subviews
    const subViews = ['home', 'announcements', 'payments_tab', 'profile'];
    for (const sub of subViews) {
      const btn = page.locator(`button[data-testid="nav-tab-${sub}"]`);
      await expect(btn).toBeVisible();
      await btn.click();
      await page.waitForTimeout(200);
    }

    // Co-occupant flow
    await page.locator('button[data-testid="nav-tab-profile"]').click();
    const manageCoOccupantsBtn = page.getByRole('button', { name: /แก้ไข \/ เพิ่ม/ });
    if (await manageCoOccupantsBtn.isVisible()) {
      await manageCoOccupantsBtn.click();
      await page.waitForTimeout(200);
      await expect(page.getByText('รายชื่อผู้พักอาศัยร่วม').first()).toBeVisible();
      await page.getByRole('button', { name: 'เสร็จสิ้น' }).first().click();
    }

    guard.assertClean();
  });
});
