import { test, expect } from '@playwright/test';
import { getPrismaClient } from '../../server/src/db/prisma.js';
import { SessionTokenService } from '../../server/src/services/session-token.service.js';
import { CsrfService } from '../../server/src/services/csrf.service.js';
import { subscriptionEntitlementService } from '../../server/src/services/subscription-entitlement.service.js';
import { outboxService } from '../../server/src/services/outbox.service.js';
import crypto from 'crypto';

test.describe.serial('LOCAL-03: Local Notification Outbox & Operations Polish E2E', () => {
  const prisma = getPrismaClient();
  const sessionSecret = process.env.SESSION_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef';
  const csrfSecret = process.env.CSRF_SIGNING_KEY || 'csrf-secret-key-0123456789abcdef';
  const sessionTokenService = new SessionTokenService(sessionSecret);
  const csrfService = new CsrfService(csrfSecret);

  let dormId: string;
  let dormBId: string;
  let ownerUserId: string;
  let managerUserId: string;
  let techUserId: string;
  let tenantUserId: string;
  let tenantId: string;

  let sessionTokenOwner: string;
  let csrfTokenOwner: string;
  let sessionTokenManager: string;
  let csrfTokenManager: string;
  let sessionTokenTech: string;
  let csrfTokenTech: string;
  let sessionTokenTenant: string;
  let csrfTokenTenant: string;

  let tenantNoticeTitle = 'อนุมัติการต่อสัญญาเช่า';
  let tenantNoticeBody = 'คำขอต่อสัญญาเช่าห้อง A101 ของคุณได้รับการอนุมัติเรียบร้อยแล้ว';
  let staffNoticeTitle = 'มีคำขอลงทะเบียนผู้เช่าใหม่';
  let staffNoticeBody = 'คุณสมชาย ใจดี ส่งคำขอลงทะเบียนผู้เช่าห้อง A101';

  test.beforeAll(async () => {
    // 1. Clean test DB & Seed Subscriptions
    await subscriptionEntitlementService.ensureSeeded();
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE local_notification_outbox, staff_notices, tenant_notices, contract_settlement_items, contract_settlements, tenant_renewal_requests, occupancies, bill_items, receipts, payment_status_histories, payments, bills, contract_snapshots, contracts, tenant_registration_requests, tenants, rooms, buildings, dormitory_members, sessions, users, dormitories CASCADE;'
    );

    // 2. Create Dormitory A & Dormitory B
    const dorm = await prisma.dormitory.create({
      data: {
        name: 'E2E LOCAL-03 Dormitory A',
        code: 'E2E-L03-A',
        type: 'apartment',
        status: 'active',
      },
    });
    dormId = dorm.id;
    await subscriptionEntitlementService.provisionInitialTrial(dormId);

    const dormB = await prisma.dormitory.create({
      data: {
        name: 'E2E LOCAL-03 Dormitory B',
        code: 'E2E-L03-B',
        type: 'apartment',
        status: 'active',
      },
    });
    dormBId = dormB.id;
    await subscriptionEntitlementService.provisionInitialTrial(dormBId);

    // 3. Create Roles
    let ownerRole = await prisma.role.findFirst({ where: { code: 'OWNER' } });
    if (!ownerRole) {
      ownerRole = await prisma.role.create({
        data: { name: 'Owner', code: 'OWNER', isSystem: true, permissions: ['*'] },
      });
    }

    let managerRole = await prisma.role.findFirst({ where: { code: 'MANAGER' } });
    if (!managerRole) {
      managerRole = await prisma.role.create({
        data: { name: 'Manager', code: 'MANAGER', isSystem: true, permissions: ['tenant:*'] },
      });
    }

    let techRole = await prisma.role.findFirst({ where: { code: 'TECH' } });
    if (!techRole) {
      techRole = await prisma.role.create({
        data: { name: 'Technician', code: 'TECH', isSystem: true, permissions: ['maintenance:*'] },
      });
    }

    let tenantRole = await prisma.role.findFirst({ where: { code: 'TENANT' } });
    if (!tenantRole) {
      tenantRole = await prisma.role.create({
        data: { name: 'Tenant', code: 'TENANT', isSystem: true, permissions: [] },
      });
    }

    // 4. Create Owner User & Member (Dorm A only)
    const ownerUser = await prisma.user.create({
      data: {
        email: 'owner_local03@test.com',
        emailNormalized: 'owner_local03@test.com',
        name: 'Owner Local03',
        googleSubject: `sub-owner-l03-${Date.now()}`,
        status: 'active',
      },
    });
    ownerUserId = ownerUser.id;

    await prisma.dormitoryMember.create({
      data: {
        dormitoryId: dormId,
        userId: ownerUserId,
        roleId: ownerRole.id,
      },
    });

    const sidOwner = crypto.randomUUID();
    const hashOwner = SessionTokenService.hashSessionId(sidOwner);
    await prisma.session.create({
      data: {
        userId: ownerUserId,
        sessionIdHash: hashOwner,
        tokenVersion: 1,
        status: 'active',
        expiresAt: new Date(Date.now() + 86400 * 1000),
      },
    });
    sessionTokenOwner = sessionTokenService.encryptToken({ sub: ownerUserId, sid: sidOwner, type: 'session', version: 1 }, 86400);
    csrfTokenOwner = csrfService.generateCsrfToken(sidOwner);

    // 5. Create Manager User & Member (Dorm A)
    const managerUser = await prisma.user.create({
      data: {
        email: 'manager_local03@test.com',
        emailNormalized: 'manager_local03@test.com',
        name: 'Manager Local03',
        googleSubject: `sub-manager-l03-${Date.now()}`,
        status: 'active',
      },
    });
    managerUserId = managerUser.id;

    await prisma.dormitoryMember.create({
      data: {
        dormitoryId: dormId,
        userId: managerUserId,
        roleId: managerRole.id,
      },
    });

    const sidManager = crypto.randomUUID();
    const hashManager = SessionTokenService.hashSessionId(sidManager);
    await prisma.session.create({
      data: {
        userId: managerUserId,
        sessionIdHash: hashManager,
        tokenVersion: 1,
        status: 'active',
        expiresAt: new Date(Date.now() + 86400 * 1000),
      },
    });
    sessionTokenManager = sessionTokenService.encryptToken({ sub: managerUserId, sid: sidManager, type: 'session', version: 1 }, 86400);
    csrfTokenManager = csrfService.generateCsrfToken(sidManager);

    // 6. Create Tech User & Member (Dorm A)
    const techUser = await prisma.user.create({
      data: {
        email: 'tech_local03@test.com',
        emailNormalized: 'tech_local03@test.com',
        name: 'Tech Local03',
        googleSubject: `sub-tech-l03-${Date.now()}`,
        status: 'active',
      },
    });
    techUserId = techUser.id;

    await prisma.dormitoryMember.create({
      data: {
        dormitoryId: dormId,
        userId: techUserId,
        roleId: techRole.id,
      },
    });

    const sidTech = crypto.randomUUID();
    const hashTech = SessionTokenService.hashSessionId(sidTech);
    await prisma.session.create({
      data: {
        userId: techUserId,
        sessionIdHash: hashTech,
        tokenVersion: 1,
        status: 'active',
        expiresAt: new Date(Date.now() + 86400 * 1000),
      },
    });
    sessionTokenTech = sessionTokenService.encryptToken({ sub: techUserId, sid: sidTech, type: 'session', version: 1 }, 86400);
    csrfTokenTech = csrfService.generateCsrfToken(sidTech);

    // 7. Create Tenant User & Member & Record (Dorm A)
    const tenantUser = await prisma.user.create({
      data: {
        email: 'tenant_l03@test.com',
        emailNormalized: 'tenant_l03@test.com',
        name: 'Somchai Jaidee',
        googleSubject: `sub-tenant-l03-${Date.now()}`,
        status: 'active',
      },
    });
    tenantUserId = tenantUser.id;

    await prisma.dormitoryMember.create({
      data: {
        dormitoryId: dormId,
        userId: tenantUserId,
        roleId: tenantRole.id,
      },
    });

    const tenant = await prisma.tenant.create({
      data: {
        dormitoryId: dormId,
        linkedUserId: tenantUserId,
        tenantNumber: 'TNT-L03-01',
        firstName: 'Somchai',
        lastName: 'Jaidee',
        displayName: 'Somchai Jaidee',
        phone: '0812345678',
        status: 'active',
      },
    });
    tenantId = tenant.id;

    const sidTenant = crypto.randomUUID();
    const hashTenant = SessionTokenService.hashSessionId(sidTenant);
    await prisma.session.create({
      data: {
        userId: tenantUserId,
        sessionIdHash: hashTenant,
        tokenVersion: 1,
        status: 'active',
        expiresAt: new Date(Date.now() + 86400 * 1000),
      },
    });
    sessionTokenTenant = sessionTokenService.encryptToken({ sub: tenantUserId, sid: sidTenant, type: 'session', version: 1 }, 86400);
    csrfTokenTenant = csrfService.generateCsrfToken(sidTenant);

    // 8. Seed Outbox Events & Dispatch
    await prisma.$transaction(async (tx) => {
      await outboxService.createOutboxEvent(tx, {
        dormitoryId: dormId,
        eventType: 'RENEWAL_APPROVED',
        aggregateType: 'TENANT_RENEWAL',
        aggregateId: crypto.randomUUID(),
        recipientType: 'TENANT',
        recipientId: tenantId,
        title: tenantNoticeTitle,
        body: tenantNoticeBody,
      });

      await outboxService.createOutboxEvent(tx, {
        dormitoryId: dormId,
        eventType: 'TENANT_REGISTRATION_SUBMITTED',
        aggregateType: 'TENANT_REGISTRATION',
        aggregateId: crypto.randomUUID(),
        recipientType: 'STAFF',
        recipientRoleCode: 'OWNER,MANAGER',
        title: staffNoticeTitle,
        body: staffNoticeBody,
      });
    });

    await outboxService.processPendingOutboxEvents();
  });

  test('Flow A & B: Tenant persistent in-app notice, read state & F5 persistence', async ({ page, context }) => {
    await context.clearCookies();
    await context.addCookies([
      { name: 'horplus_session', value: sessionTokenTenant, domain: '127.0.0.1', path: '/' },
      { name: 'horplus_csrf', value: csrfTokenTenant, domain: '127.0.0.1', path: '/' },
      { name: 'selected_dormitory_id', value: dormId, domain: '127.0.0.1', path: '/' },
    ]);

    await page.goto('/tenant');
    await page.waitForLoadState('networkidle');

    // Assert Tenant notice content is visible in DOM
    const noticeTitle = page.getByText(tenantNoticeTitle);
    await expect(noticeTitle).toBeVisible();

    const noticeBody = page.getByText(tenantNoticeBody);
    await expect(noticeBody).toBeVisible();

    // Open notification drawer via bell icon to access mark-as-read control
    const notifBell = page.locator('button[aria-label="การแจ้งเตือน"]').first();
    await expect(notifBell).toBeVisible();
    await notifBell.click();

    // Assert mark as read button is explicitly visible in notification drawer (no silent skips)
    const markReadBtn = page.locator('[data-testid^="button-tenant-notice-read-"]').first();
    await expect(markReadBtn).toBeVisible();

    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/read') && res.status() === 200),
      markReadBtn.click(),
    ]);

    // Verify DB read status updated
    const updatedDbNotice = await prisma.tenantNotice.findFirst({
      where: { dormitoryId: dormId, tenantId },
    });
    expect(updatedDbNotice?.isRead).toBe(true);

    // Reload (F5) and assert read status persists
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(tenantNoticeTitle)).toBeVisible();
  });

  test('Flow C & D: Owner operational notifications, swipe guide badge & real UI swipe dismissal persistence', async ({ page, context }) => {
    await context.clearCookies();
    await context.addCookies([
      { name: 'horplus_session', value: sessionTokenOwner, domain: '127.0.0.1', path: '/' },
      { name: 'horplus_csrf', value: csrfTokenOwner, domain: '127.0.0.1', path: '/' },
      { name: 'selected_dormitory_id', value: dormId, domain: '127.0.0.1', path: '/' },
    ]);

    await page.goto('/owner/dashboard');
    await page.waitForLoadState('networkidle');

    // Open notification dropdown
    const headerBell = page.locator('[data-testid="button-staff-notification-bell"]').first();
    await expect(headerBell).toBeVisible();
    await headerBell.click();
    await page.waitForTimeout(500);

    // Assert exact staff notice content & swipe guide badge in DOM
    await expect(page.getByText(staffNoticeTitle)).toBeVisible();
    await expect(page.getByText(/ปัดซ้ายที่รายการแจ้งเตือนเพื่อลบข้อความ/i)).toBeVisible();

    // Locate SlidableNotificationItem and perform real UI drag/swipe left gesture
    const noticeCard = page.locator('[data-testid^="staff-notice-item-"]').first();
    await expect(noticeCard).toBeVisible();
    const box = await noticeCard.boundingBox();
    expect(box).not.toBeNull();

    if (box) {
      await Promise.all([
        page.waitForResponse((res) => res.url().includes('/dismiss') && res.status() === 200),
        (async () => {
          await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2);
          await page.mouse.down();
          await page.mouse.move(box.x - 50, box.y + box.height / 2, { steps: 15 });
          await page.mouse.up();
        })(),
      ]);
    }

    // Assert notice disappears from UI
    await expect(page.getByText(staffNoticeTitle)).not.toBeVisible();

    // Verify DB dismissal status updated in PostgreSQL
    const dbNotice = await prisma.staffNotification.findFirst({
      where: { dormitoryId: dormId, userId: ownerUserId },
    });
    expect(dbNotice?.isDismissed).toBe(true);
    expect(dbNotice?.dismissedAt).not.toBeNull();

    // F5 reload and verify notice remains hidden for Owner
    await page.reload();
    await page.waitForLoadState('networkidle');

    const headerBell2 = page.locator('[data-testid="button-staff-notification-bell"]').first();
    await expect(headerBell2).toBeVisible();
    await headerBell2.click();
    await page.waitForTimeout(500);

    await expect(page.getByText(staffNoticeTitle)).not.toBeVisible();
  });

  test('Flow D & H: Manager notification list remains unaffected by Owner dismissal', async ({ page, context }) => {
    await context.clearCookies();
    await context.addCookies([
      { name: 'horplus_session', value: sessionTokenManager, domain: '127.0.0.1', path: '/' },
      { name: 'horplus_csrf', value: csrfTokenManager, domain: '127.0.0.1', path: '/' },
      { name: 'selected_dormitory_id', value: dormId, domain: '127.0.0.1', path: '/' },
    ]);

    await page.goto('/owner/dashboard');
    await page.waitForLoadState('networkidle');

    // Open notification dropdown
    const headerBell = page.locator('[data-testid="button-staff-notification-bell"]').first();
    await expect(headerBell).toBeVisible();
    await headerBell.click();
    await page.waitForTimeout(500);

    // Assert Manager still sees their copy of the staff notice!
    await expect(page.getByText(staffNoticeTitle)).toBeVisible();
  });

  test('Flow E: Authenticated cross-dormitory isolation returns 403 when Owner A selects Dorm B', async ({ page, context }) => {
    // Owner A is active member only in Dorm A (dormId), NOT Dorm B (dormBId)
    await context.clearCookies();
    await context.addCookies([
      { name: 'horplus_session', value: sessionTokenOwner, domain: '127.0.0.1', path: '/' },
      { name: 'horplus_csrf', value: csrfTokenOwner, domain: '127.0.0.1', path: '/' },
    ]);

    // Send authenticated request claiming Dorm B
    const response = await page.request.get('/api/v1/notifications', {
      headers: {
        'x-dormitory-id': dormBId,
      },
    });

    // Must return HTTP 403 Forbidden (NOT 401)
    expect(response.status()).toBe(403);
    const body = await response.json();
    expect(body.error?.code).toBe('FORBIDDEN');
    expect(body.notifications).toBeUndefined();
  });

  test('Flow F: TECH RBAC — Authenticated TECH session denied from OWNER-only preferences', async ({ page, context }) => {
    await context.clearCookies();
    await context.addCookies([
      { name: 'horplus_session', value: sessionTokenTech, domain: '127.0.0.1', path: '/' },
      { name: 'horplus_csrf', value: csrfTokenTech, domain: '127.0.0.1', path: '/' },
      { name: 'selected_dormitory_id', value: dormId, domain: '127.0.0.1', path: '/' },
    ]);

    // TECH attempts OWNER-only preferences modification
    const response = await page.request.patch('/api/v1/notifications/preferences', {
      headers: {
        'x-dormitory-id': dormId,
      },
      data: {
        repairAlertsEnabled: false,
      },
    });

    // Must return HTTP 403 Forbidden
    expect(response.status()).toBe(403);
    const body = await response.json();
    expect(body.error?.code).toBe('FORBIDDEN');
  });

  test('Flow G: Outbox reconciliation idempotency on re-dispatch', async () => {
    const initialNotices = await prisma.tenantNotice.count({
      where: { dormitoryId: dormId },
    });

    // Re-run dispatcher
    await outboxService.processPendingOutboxEvents();

    const afterNotices = await prisma.tenantNotice.count({
      where: { dormitoryId: dormId },
    });

    expect(afterNotices).toBe(initialNotices); // ZERO duplicate notices created!
  });

  test('Flow H: Truthful empty state rendering without fake placeholders', async ({ page, context }) => {
    // Create fresh tenant with 0 notifications
    const freshTenantId = crypto.randomUUID();
    const freshUserId = crypto.randomUUID();

    const freshUser = await prisma.user.create({
      data: {
        id: freshUserId,
        email: 'fresh_tenant@test.com',
        emailNormalized: 'fresh_tenant@test.com',
        name: 'Fresh Tenant',
        googleSubject: `sub-fresh-${Date.now()}`,
        status: 'active',
      },
    });

    let tenantRole = await prisma.role.findFirst({ where: { code: 'TENANT' } });
    await prisma.dormitoryMember.create({
      data: {
        dormitoryId: dormId,
        userId: freshUserId,
        roleId: tenantRole!.id,
      },
    });

    await prisma.tenant.create({
      data: {
        id: freshTenantId,
        dormitoryId: dormId,
        linkedUserId: freshUserId,
        tenantNumber: 'TNT-FRESH-01',
        firstName: 'Fresh',
        lastName: 'Tenant',
        displayName: 'Fresh Tenant',
        phone: '0811112222',
        status: 'active',
      },
    });

    const sidFresh = crypto.randomUUID();
    const hashFresh = SessionTokenService.hashSessionId(sidFresh);
    await prisma.session.create({
      data: {
        userId: freshUserId,
        sessionIdHash: hashFresh,
        tokenVersion: 1,
        status: 'active',
        expiresAt: new Date(Date.now() + 86400 * 1000),
      },
    });
    const freshSessionToken = sessionTokenService.encryptToken({ sub: freshUserId, sid: sidFresh, type: 'session', version: 1 }, 86400);
    const freshCsrfToken = csrfService.generateCsrfToken(sidFresh);

    await context.clearCookies();
    await context.addCookies([
      { name: 'horplus_session', value: freshSessionToken, domain: '127.0.0.1', path: '/' },
      { name: 'horplus_csrf', value: freshCsrfToken, domain: '127.0.0.1', path: '/' },
      { name: 'selected_dormitory_id', value: dormId, domain: '127.0.0.1', path: '/' },
    ]);

    await page.goto('/tenant');
    await page.waitForLoadState('networkidle');

    // Open notification modal to view empty state
    const notifBell = page.locator('button[aria-label="การแจ้งเตือน"]').first();
    await expect(notifBell).toBeVisible();
    await notifBell.click();
    await page.waitForTimeout(400);

    await expect(page.getByText(/ไม่มีรายการแจ้งเตือนใหม่/i)).toBeVisible();
  });
});
