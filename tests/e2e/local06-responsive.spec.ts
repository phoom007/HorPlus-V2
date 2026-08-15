/**
 * HorPlus LOCAL-06 — Responsive Viewports Acceptance Test Suite
 * Validates Desktop (1440x900), Tablet (1024x768), and Mobile (390x844) viewports.
 * Asserts:
 * - No horizontal document overflow
 * - Primary navigation remains reachable
 * - Primary page content renders cleanly
 * - Critical action controls and notification bells are accessible
 * @license Apache-2.0
 */

import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import crypto from 'crypto';
import { getPrismaClient } from '../../server/src/db/prisma.js';
import { SessionTokenService } from '../../server/src/services/session-token.service.js';
import { CsrfService } from '../../server/src/services/csrf.service.js';
import { subscriptionEntitlementService } from '../../server/src/services/subscription-entitlement.service.js';

const VIEWPORTS = [
  { name: 'Desktop (1440x900)', width: 1440, height: 900, tag: 'desktop' },
  { name: 'Tablet (1024x768)', width: 1024, height: 768, tag: 'tablet' },
  { name: 'Mobile (390x844)', width: 390, height: 844, tag: 'mobile' },
];

test.describe('LOCAL-06 Responsive Viewports Acceptance Suite', () => {
  const prisma = getPrismaClient();
  const sessionSecret = process.env.SESSION_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef';
  const csrfSecret = process.env.CSRF_SIGNING_KEY || 'csrf-secret-key-0123456789abcdef';
  const sessionTokenService = new SessionTokenService(sessionSecret);
  const csrfService = new CsrfService(csrfSecret);

  let dormId: string;
  let ownerUser: any;
  let tenantUser: any;
  let tenantRecord: any;

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

  test.beforeAll(async () => {
    await subscriptionEntitlementService.ensureSeeded();
    const timestamp = Date.now();

    // 1. Provision Dormitory
    const dorm = await prisma.dormitory.create({
      data: {
        name: `HorPlus Responsive Dorm ${timestamp}`,
        code: `RESP-${timestamp}`,
        type: 'apartment',
        status: 'active',
        addressLine1: '456 Sukhumvit Road',
        province: 'Bangkok',
        postalCode: '10110',
        phone: '029876543',
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
        googleSubject: `owner-resp-${timestamp}`,
        email: `owner-resp-${timestamp}@example.com`,
        emailNormalized: `owner-resp-${timestamp}@example.com`,
        name: 'Responsive Owner',
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
        name: 'Tower A',
        floorCount: 2,
      },
    });

    const room = await prisma.room.create({
      data: {
        dormitoryId: dormId,
        buildingId: building.id,
        roomNumber: 'A101',
        normalizedRoomNumber: 'A101',
        floor: 1,
        monthlyRent: 5000,
        depositAmount: 10000,
        roomType: 'standard',
        status: 'occupied',
      },
    });

    // 5. Tenant User
    tenantUser = await prisma.user.create({
      data: {
        googleSubject: `tenant-resp-${timestamp}`,
        email: `tenant-resp-${timestamp}@example.com`,
        emailNormalized: `tenant-resp-${timestamp}@example.com`,
        name: 'Responsive Tenant',
        status: 'active',
      },
    });

    tenantRecord = await prisma.tenant.create({
      data: {
        dormitoryId: dormId,
        linkedUserId: tenantUser.id,
        tenantNumber: 'TNT-A101',
        firstName: 'Somying',
        lastName: 'Raksadee',
        displayName: 'Somying Raksadee',
        phone: '0811112233',
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
        contractNumber: 'CTR-RESP-101',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        durationMonths: 12,
        rentAmount: 5000,
        depositAmount: 10000,
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

    // 6. Billing Cycle & Unpaid Bill
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

    await prisma.bill.create({
      data: {
        dormitoryId: dormId,
        billingCycleId: cycle.id,
        roomId: room.id,
        tenantId: tenantRecord.id,
        billNumber: 'INV-RESP-001',
        status: 'unpaid',
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-05'),
        subtotal: 5200,
        totalAmount: 5200,
        paidAmount: 0,
        outstandingAmount: 5200,
      },
    });
  });

  // Helper to assert no horizontal document overflow
  async function assertNoHorizontalOverflow(page: Page) {
    const hasOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth + 2;
    });
    expect(hasOverflow).toBeFalsy();
  }

  for (const vp of VIEWPORTS) {
    test.describe(`Viewport: ${vp.name}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } });

      test(`Public Portal routes render without overflow [${vp.tag}]`, async ({ page }) => {
        const publicRoutes = ['/', '/features', '/pricing', '/how-it-works', '/help', '/terms', '/privacy', '/auth/owner', '/tenant/register'];

        for (const route of publicRoutes) {
          await page.goto(route);
          await page.waitForLoadState('domcontentloaded');
          await expect(page.locator('body')).toBeVisible();
          await assertNoHorizontalOverflow(page);
        }
      });

      test(`Owner Workspace shell & all primary tabs render without overflow [${vp.tag}]`, async ({ page, context }) => {
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
          await expect(page.locator('#owner-main-content')).toBeVisible({ timeout: 10000 });
          await assertNoHorizontalOverflow(page);

          // Notification bell is accessible
          const bell = page.locator('[data-testid="button-staff-notification-bell"]').filter({ visible: true });
          await expect(bell).toBeVisible();
        }
      });

      test(`Tenant Portal shell & subviews render without overflow [${vp.tag}]`, async ({ page, context }) => {
        await setupSession(context, page, sessionTokenTenant, csrfTokenTenant, dormId);

        await page.goto('/tenant');
        await page.waitForLoadState('domcontentloaded');
        await expect(page.locator('body')).toBeVisible();
        await assertNoHorizontalOverflow(page);

        // Verify notification bell is visible and clickable on home view
        const bellBtn = page.locator('button[aria-label="การแจ้งเตือน"]').first();
        await expect(bellBtn).toBeVisible();
        await bellBtn.click();
        await page.waitForTimeout(300);
        await expect(page.getByText('ศูนย์การแจ้งเตือน')).toBeVisible();
        await page.getByRole('button', { name: 'ปิด' }).click();

        // Verify navigation tabs exist and switch without overflow
        const navTabs = ['announcements', 'payments_tab', 'profile', 'home'];
        for (const tabId of navTabs) {
          const tabBtn = page.locator(`button[data-testid="nav-tab-${tabId}"]`);
          await expect(tabBtn).toBeVisible();
          await tabBtn.click();
          await page.waitForTimeout(200);
          await assertNoHorizontalOverflow(page);
        }
      });
    });
  }
});
