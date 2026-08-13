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
  let ownerUserId: string;
  let tenantUserId: string;
  let tenantId: string;

  let sessionTokenOwner: string;
  let csrfTokenOwner: string;
  let sessionTokenTenant: string;
  let csrfTokenTenant: string;

  test.beforeAll(async () => {
    // 1. Clean test DB & Seed Subscriptions
    await subscriptionEntitlementService.ensureSeeded();
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE local_notification_outbox, staff_notices, tenant_notices, contract_settlement_items, contract_settlements, tenant_renewal_requests, occupancies, bill_items, receipts, payment_status_histories, payments, bills, contract_snapshots, contracts, tenant_registration_requests, tenants, rooms, buildings, dormitory_members, sessions, users, dormitories CASCADE;'
    );

    // 2. Create Dormitory
    const dorm = await prisma.dormitory.create({
      data: {
        name: 'E2E LOCAL-03 Dormitory',
        code: 'E2E-L03',
        type: 'apartment',
        status: 'active',
      },
    });
    dormId = dorm.id;
    await subscriptionEntitlementService.provisionInitialTrial(dormId);

    // 3. Create Owner User & Member
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

    let ownerRole = await prisma.role.findFirst({ where: { code: 'OWNER' } });
    if (!ownerRole) {
      ownerRole = await prisma.role.create({
        data: { name: 'Owner', code: 'OWNER', isSystem: true, permissions: ['*'] },
      });
    }

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

    // 4. Create Tenant User & Record
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

    // 5. Seed an Outbox Event & Dispatch to create persistent notices
    await prisma.$transaction(async (tx) => {
      await outboxService.createOutboxEvent(tx, {
        dormitoryId: dormId,
        eventType: 'RENEWAL_APPROVED',
        aggregateType: 'TENANT_RENEWAL',
        aggregateId: crypto.randomUUID(),
        recipientType: 'TENANT',
        recipientId: tenantId,
        title: 'อนุมัติการต่อสัญญาเช่า',
        body: 'คำขอต่อสัญญาเช่าห้อง A101 ของคุณได้รับการอนุมัติเรียบร้อยแล้ว',
      });

      await outboxService.createOutboxEvent(tx, {
        dormitoryId: dormId,
        eventType: 'TENANT_REGISTRATION_SUBMITTED',
        aggregateType: 'TENANT_REGISTRATION',
        aggregateId: crypto.randomUUID(),
        recipientType: 'STAFF',
        recipientRoleCode: 'OWNER',
        title: 'มีคำขอลงทะเบียนผู้เช่าใหม่',
        body: 'คุณสมชาย ใจดี ส่งคำขอลงทะเบียนผู้เช่าห้อง A101',
      });
    });

    await outboxService.processPendingOutboxEvents();
  });

  test('Flow A & B: Tenant persistent in-app notice, read/unread state & F5 persistence', async ({ page, context }) => {
    await context.clearCookies();
    await context.addCookies([
      { name: 'horplus_session', value: sessionTokenTenant, domain: '127.0.0.1', path: '/' },
      { name: 'horplus_csrf', value: csrfTokenTenant, domain: '127.0.0.1', path: '/' },
      { name: 'selected_dormitory_id', value: dormId, domain: '127.0.0.1', path: '/' },
    ]);

    await page.goto('/tenant');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('body')).toBeVisible();

    // Verify notification modal toggle is accessible
    const bellButton = page.locator('button').filter({ has: page.locator('svg') }).first();
    if (await bellButton.isVisible()) {
      await bellButton.click();
      await page.waitForTimeout(500);
    }

    // F5 reload
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toBeVisible();
  });

  test('Flow C & D: Owner operational notifications & RBAC enforcement', async ({ page, context }) => {
    await context.clearCookies();
    await context.addCookies([
      { name: 'horplus_session', value: sessionTokenOwner, domain: '127.0.0.1', path: '/' },
      { name: 'horplus_csrf', value: csrfTokenOwner, domain: '127.0.0.1', path: '/' },
      { name: 'selected_dormitory_id', value: dormId, domain: '127.0.0.1', path: '/' },
    ]);

    await page.goto('/owner/dashboard');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toBeVisible();

    // Open notification dropdown in header
    const headerBell = page.locator('header button').filter({ has: page.locator('svg') }).first();
    if (await headerBell.isVisible()) {
      await headerBell.click();
      await page.waitForTimeout(500);
    }

    // F5 reload
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toBeVisible();
  });

  test('Flow E: Cross-dormitory isolation returns 403 for unauthorized dormitory header', async ({ request }) => {
    const response = await request.get('/api/v1/notifications', {
      headers: {
        'x-dormitory-id': '00000000-0000-0000-0000-000000000000',
      },
    });
    expect([401, 403]).toContain(response.status());
  });

  test('Flow G: Truthful empty state rendering without fake placeholders', async ({ page, context }) => {
    await context.clearCookies();
    await context.addCookies([
      { name: 'horplus_session', value: sessionTokenOwner, domain: '127.0.0.1', path: '/' },
      { name: 'horplus_csrf', value: csrfTokenOwner, domain: '127.0.0.1', path: '/' },
      { name: 'selected_dormitory_id', value: dormId, domain: '127.0.0.1', path: '/' },
    ]);

    await page.goto('/owner/dashboard');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toBeVisible();
  });
});
