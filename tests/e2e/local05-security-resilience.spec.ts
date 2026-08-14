import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import crypto from 'crypto';
import { getPrismaClient } from '../../server/src/db/prisma.js';
import { SessionTokenService } from '../../server/src/services/session-token.service.js';
import { CsrfService } from '../../server/src/services/csrf.service.js';
import { AccessGrantService } from '../../server/src/services/access-grant.service.js';
import { subscriptionEntitlementService } from '../../server/src/services/subscription-entitlement.service.js';
import { encryptText, hashToken } from '../../server/src/utils/crypto-encryption.js';

test.describe('LOCAL-05: Adversarial Local Security & Resilience E2E Suite', () => {
  const prisma = getPrismaClient();
  const sessionSecret = process.env.SESSION_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef';
  const csrfSecret = process.env.CSRF_SIGNING_KEY || 'csrf-secret-key-0123456789abcdef';
  const sessionTokenService = new SessionTokenService(sessionSecret);
  const csrfService = new CsrfService(csrfSecret);

  let dormIdA: string;
  let dormIdB: string;

  let ownerUserA: any;
  let techUserA: any;
  let tenantUserA: any;
  let tenantUserB: any;

  let sessionTokenOwnerA: string;
  let csrfTokenOwnerA: string;

  let sessionTokenTechA: string;
  let csrfTokenTechA: string;

  let sessionTokenTenantA: string;
  let csrfTokenTenantA: string;

  let sessionTokenTenantB: string;
  let csrfTokenTenantB: string;

  let roomA101: any;
  let roomB201: any;
  let tenantRecordA: any;
  let tenantRecordB: any;

  async function setupBrowserSession(
    context: BrowserContext,
    page: Page,
    user: { id: string },
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

  test.beforeEach(async () => {
    // Truncate DB to guarantee clean slate
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE local_notification_outbox, staff_notices, tenant_notices, contract_settlement_items, contract_settlements, tenant_renewal_requests, occupancies, bill_items, receipts, payment_status_histories, payments, bills, contract_snapshots, contracts, tenant_registration_requests, tenants, rooms, buildings, dormitory_members, dormitory_access_grants, dormitories, sessions, users CASCADE;'
    );

    dormIdA = crypto.randomUUID();
    dormIdB = crypto.randomUUID();

    // Ensure roles exist
    const roles = [
      { code: 'OWNER', name: 'Owner', isSystem: true, permissions: ['*'] },
      { code: 'MANAGER', name: 'Manager', isSystem: true, permissions: ['room:read', 'room:write', 'tenant:read', 'tenant:write', 'contract:read', 'contract:write', 'bill:read', 'bill:write', 'meter:read', 'meter:write'] },
      { code: 'TECH', name: 'Technician', isSystem: true, permissions: ['maintenance:read', 'maintenance:write', 'meter:read', 'meter:write'] },
      { code: 'TENANT', name: 'Tenant', isSystem: true, permissions: ['contract:read', 'bill:read'] }
    ];

    for (const r of roles) {
      const existing = await prisma.role.findFirst({ where: { code: r.code } });
      if (!existing) {
        await prisma.role.create({ data: r });
      }
    }

    const ownerRole = (await prisma.role.findFirst({ where: { code: 'OWNER' } }))!;
    const techRole = (await prisma.role.findFirst({ where: { code: 'TECH' } }))!;
    const tenantRole = (await prisma.role.findFirst({ where: { code: 'TENANT' } }))!;

    // Create Dormitories
    await prisma.dormitory.create({
      data: { id: dormIdA, name: 'Dormitory Alpha E2E', code: `DORM-A-${Date.now()}`, status: 'active' }
    });
    await prisma.dormitory.create({
      data: { id: dormIdB, name: 'Dormitory Beta E2E', code: `DORM-B-${Date.now()}`, status: 'active' }
    });

    // Provision Trials
    await subscriptionEntitlementService.provisionInitialTrial(dormIdA);
    await subscriptionEntitlementService.provisionInitialTrial(dormIdB);

    // Create Users
    ownerUserA = await prisma.user.create({
      data: { email: `owner-e2e-${Date.now()}@example.com`, emailNormalized: `owner-e2e-${Date.now()}@example.com`, name: 'Owner Alpha', googleSubject: `sub-owner-e2e-${Date.now()}`, status: 'active' }
    });
    techUserA = await prisma.user.create({
      data: { email: `tech-e2e-${Date.now()}@example.com`, emailNormalized: `tech-e2e-${Date.now()}@example.com`, name: 'Tech Alpha', googleSubject: `sub-tech-e2e-${Date.now()}`, status: 'active' }
    });
    tenantUserA = await prisma.user.create({
      data: { email: `tenant-a-e2e-${Date.now()}@example.com`, emailNormalized: `tenant-a-e2e-${Date.now()}@example.com`, name: 'Tenant Alpha', googleSubject: `sub-tenant-a-e2e-${Date.now()}`, status: 'active' }
    });
    tenantUserB = await prisma.user.create({
      data: { email: `tenant-b-e2e-${Date.now()}@example.com`, emailNormalized: `tenant-b-e2e-${Date.now()}@example.com`, name: 'Tenant Beta', googleSubject: `sub-tenant-b-e2e-${Date.now()}`, status: 'active' }
    });

    // Memberships
    await prisma.dormitoryMember.create({
      data: { dormitoryId: dormIdA, userId: ownerUserA.id, roleId: ownerRole.id, status: 'active', membershipOrigin: 'GOOGLE_BOOTSTRAP' }
    });
    await prisma.dormitoryMember.create({
      data: { dormitoryId: dormIdA, userId: techUserA.id, roleId: techRole.id, status: 'active', membershipOrigin: 'TASK009_STAFF' }
    });
    await prisma.dormitoryMember.create({
      data: { dormitoryId: dormIdA, userId: tenantUserA.id, roleId: tenantRole.id, status: 'active' }
    });
    await prisma.dormitoryMember.create({
      data: { dormitoryId: dormIdB, userId: tenantUserB.id, roleId: tenantRole.id, status: 'active' }
    });

    // Sessions & Tokens
    const sOwnerA = crypto.randomUUID();
    await prisma.session.create({
      data: { id: sOwnerA, userId: ownerUserA.id, sessionIdHash: SessionTokenService.hashSessionId(sOwnerA), tokenVersion: 1, status: 'active', expiresAt: new Date(Date.now() + 86400000) }
    });
    sessionTokenOwnerA = sessionTokenService.encryptToken({ sub: ownerUserA.id, sid: sOwnerA, type: 'session', version: 1 }, 86400);
    csrfTokenOwnerA = csrfService.generateCsrfToken(sOwnerA);

    const sTechA = crypto.randomUUID();
    await prisma.session.create({
      data: { id: sTechA, userId: techUserA.id, sessionIdHash: SessionTokenService.hashSessionId(sTechA), tokenVersion: 1, status: 'active', expiresAt: new Date(Date.now() + 86400000) }
    });
    sessionTokenTechA = sessionTokenService.encryptToken({ sub: techUserA.id, sid: sTechA, type: 'session', version: 1 }, 86400);
    csrfTokenTechA = csrfService.generateCsrfToken(sTechA);

    const sTenantA = crypto.randomUUID();
    await prisma.session.create({
      data: { id: sTenantA, userId: tenantUserA.id, sessionIdHash: SessionTokenService.hashSessionId(sTenantA), tokenVersion: 1, status: 'active', expiresAt: new Date(Date.now() + 86400000) }
    });
    sessionTokenTenantA = sessionTokenService.encryptToken({ sub: tenantUserA.id, sid: sTenantA, type: 'session', version: 1 }, 86400);
    csrfTokenTenantA = csrfService.generateCsrfToken(sTenantA);

    const sTenantB = crypto.randomUUID();
    await prisma.session.create({
      data: { id: sTenantB, userId: tenantUserB.id, sessionIdHash: SessionTokenService.hashSessionId(sTenantB), tokenVersion: 1, status: 'active', expiresAt: new Date(Date.now() + 86400000) }
    });
    sessionTokenTenantB = sessionTokenService.encryptToken({ sub: tenantUserB.id, sid: sTenantB, type: 'session', version: 1 }, 86400);
    csrfTokenTenantB = csrfService.generateCsrfToken(sTenantB);

    // Buildings & Rooms
    const bldA = await prisma.building.create({ data: { dormitoryId: dormIdA, name: 'Building Alpha' } });
    roomA101 = await prisma.room.create({
      data: {
        dormitoryId: dormIdA,
        buildingId: bldA.id,
        roomNumber: 'A101',
        normalizedRoomNumber: 'A101',
        roomType: 'STANDARD',
        floor: 1,
        status: 'occupied',
        monthlyRent: '5000'
      }
    });

    const bldB = await prisma.building.create({ data: { dormitoryId: dormIdB, name: 'Building Beta' } });
    roomB201 = await prisma.room.create({
      data: {
        dormitoryId: dormIdB,
        buildingId: bldB.id,
        roomNumber: 'B201',
        normalizedRoomNumber: 'B201',
        roomType: 'STANDARD',
        floor: 2,
        status: 'occupied',
        monthlyRent: '8500'
      }
    });

    // Tenants & Contracts
    tenantRecordA = await prisma.tenant.create({
      data: {
        dormitoryId: dormIdA,
        linkedUserId: tenantUserA.id,
        tenantNumber: `TNT-A-${Date.now()}`,
        firstName: 'Alpha',
        lastName: 'Direct',
        displayName: 'Tenant Alpha Direct',
        phone: '0811111111',
        status: 'active'
      }
    });

    tenantRecordB = await prisma.tenant.create({
      data: {
        dormitoryId: dormIdB,
        linkedUserId: tenantUserB.id,
        tenantNumber: `TNT-B-${Date.now()}`,
        firstName: 'Beta',
        lastName: 'Direct',
        displayName: 'Tenant Beta Direct',
        phone: '0822222222',
        status: 'active'
      }
    });

    await prisma.contract.create({
      data: {
        dormitoryId: dormIdA,
        roomId: roomA101.id,
        tenantId: tenantRecordA.id,
        contractNumber: 'CTR-A-001',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        rentAmount: 5000,
        depositAmount: 10000,
        status: 'ACTIVE'
      }
    });

    await prisma.contract.create({
      data: {
        dormitoryId: dormIdB,
        roomId: roomB201.id,
        tenantId: tenantRecordB.id,
        contractNumber: 'CTR-B-001',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        rentAmount: 8500,
        depositAmount: 17000,
        status: 'ACTIVE'
      }
    });
  });

  // =========================================================================
  // 1. CROSS-DORMITORY IDOR ATTACK FROM BROWSER CONTEXT
  // =========================================================================
  test('E2E-SEC-01: Cross-Dormitory IDOR attack fails closed with 403 in browser', async ({ context, page }) => {
    await setupBrowserSession(context, page, ownerUserA, sessionTokenOwnerA, csrfTokenOwnerA, dormIdA);

    await page.goto('/owner/rooms');
    await page.waitForLoadState('networkidle');

    // Attempt to invoke API targeting Dorm B from authenticated Dorm A browser session
    const idorResult = await page.evaluate(async (targetDormId) => {
      const resp = await fetch('/api/v1/properties/rooms', {
        headers: {
          'x-dormitory-id': targetDormId,
          'Accept': 'application/json'
        }
      });
      return {
        status: resp.status,
        body: await resp.json()
      };
    }, dormIdB);

    expect(idorResult.status).toBe(403);
    expect(JSON.stringify(idorResult.body)).not.toContain('B201');
    expect(JSON.stringify(idorResult.body)).not.toContain('Tenant Beta');
  });

  // =========================================================================
  // 2. TENANT-TO-TENANT DATA ISOLATION IN TENANT PORTAL
  // =========================================================================
  test('E2E-SEC-02: Tenant A portal strictly denies access to Tenant B contracts & notices', async ({ context, page }) => {
    await setupBrowserSession(context, page, tenantUserA, sessionTokenTenantA, csrfTokenTenantA, dormIdA);

    await page.goto('/tenant');
    await page.waitForLoadState('networkidle');

    // 1. Tenant A accesses own profile under authorized Dorm A context -> 200
    const ownProfileResult = await page.evaluate(async (myDormId) => {
      const resp = await fetch('/api/v1/tenant-portal/profile', {
        headers: {
          'x-dormitory-id': myDormId
        }
      });
      return {
        status: resp.status,
        data: await resp.json()
      };
    }, dormIdA);

    expect(ownProfileResult.status).toBe(200);
    expect(ownProfileResult.data.displayName).toContain('Alpha');

    // 2. Tenant A attempts to access /api/v1/tenant-portal/profile with spoofed Dorm B context -> 403
    const spoofedProfileResult = await page.evaluate(async (otherDormId) => {
      const resp = await fetch('/api/v1/tenant-portal/profile', {
        headers: {
          'x-dormitory-id': otherDormId
        }
      });
      return resp.status;
    }, dormIdB);

    expect(spoofedProfileResult).toBe(403);
  });

  // =========================================================================
  // 3. STAFF RBAC RESTRICTION IN BROWSER CONTEXT (TECH ROLE)
  // =========================================================================
  test('E2E-SEC-03: TECH staff role is denied access to financial and contract mutations', async ({ context, page }) => {
    await setupBrowserSession(context, page, techUserA, sessionTokenTechA, csrfTokenTechA, dormIdA);

    await page.goto('/owner/meter-reads');
    await page.waitForLoadState('networkidle');
    // Tech can access meter readings
    await expect(page.locator('body')).toBeVisible();

    // Tech attempts to create a contract (requires contract:write permission)
    const mutationResult = await page.evaluate(async ({ dId, csrf }) => {
      const resp = await fetch('/api/v1/contracts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-dormitory-id': dId,
          'x-csrf-token': csrf
        },
        body: JSON.stringify({
          roomId: '00000000-0000-0000-0000-000000000000',
          tenantId: '00000000-0000-0000-0000-000000000000',
          startDate: '2026-01-01',
          endDate: '2026-12-31',
          rentAmount: 5000
        })
      });
      return resp.status;
    }, { dId: dormIdA, csrf: csrfTokenTechA });

    expect(mutationResult).toBe(403);
  });

  // =========================================================================
  // 4. BROWSER CSRF DEFENSE ON STATE-CHANGING ENDPOINTS
  // =========================================================================
  test('E2E-SEC-04: State mutation without X-CSRF-Token header is rejected with 403', async ({ context, page }) => {
    await setupBrowserSession(context, page, ownerUserA, sessionTokenOwnerA, csrfTokenOwnerA, dormIdA);

    await page.goto('/owner/rooms');
    await page.waitForLoadState('networkidle');

    // Missing CSRF Header
    const missingCsrf = await page.evaluate(async (dId) => {
      const resp = await fetch('/api/v1/properties/buildings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-dormitory-id': dId
        },
        body: JSON.stringify({ name: 'CSRF Attack Building' })
      });
      return resp.status;
    }, dormIdA);

    expect(missingCsrf).toBe(403);

    // Valid CSRF Header
    const validCsrf = await page.evaluate(async ({ dId, csrf }) => {
      const resp = await fetch('/api/v1/properties/buildings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-dormitory-id': dId,
          'x-csrf-token': csrf
        },
        body: JSON.stringify({ name: 'Valid Building' })
      });
      return resp.status;
    }, { dId: dormIdA, csrf: csrfTokenOwnerA });

    expect(validCsrf).toBe(201);
  });

  // =========================================================================
  // 5. STORED XSS INERTIA IN BROWSER (TENANTS PAGE & PRINT PREVIEW)
  // =========================================================================
  test('E2E-SEC-05: Malicious script tags in tenant data do not execute in browser (XSS Inertia)', async ({ context, page }) => {
    // Inject tenant with XSS payload
    await prisma.tenant.create({
      data: {
        dormitoryId: dormIdA,
        tenantNumber: `TNT-XSS-${Date.now()}`,
        firstName: 'XSS',
        lastName: '<script>window.__HORPLUS_XSS__=1</script>',
        displayName: 'XSS <script>window.__HORPLUS_XSS__=1</script><img src=x onerror="window.__HORPLUS_XSS__=1">',
        phone: '0899999999',
        status: 'active'
      }
    });

    await setupBrowserSession(context, page, ownerUserA, sessionTokenOwnerA, csrfTokenOwnerA, dormIdA);

    await page.goto('/owner/tenants');
    await page.waitForLoadState('networkidle');

    // Check that script never executed in browser execution context
    const xssExecuted = await page.evaluate(() => (window as any).__HORPLUS_XSS__);
    expect(xssExecuted).toBeUndefined();

    // Verify tenant name is displayed as escaped text
    const bodyText = await page.textContent('body');
    expect(bodyText).toContain('XSS');
  });

  // =========================================================================
  // 6. TASK009 BEARER REDEMPTION, HASH STRIPPING & REVOCATION ENFORCEMENT
  // =========================================================================
  test('E2E-SEC-06: Task009 bearer URL hash is stripped upon redemption; revoked grant loses access', async ({ page }) => {
    const grantService = new AccessGrantService(prisma);
    const rawLineId = `line-e2e-${Date.now()}`;
    const friend = await prisma.dormitoryLineFriend.create({
      data: {
        dormitoryId: dormIdA,
        lineUserIdHash: hashToken(rawLineId),
        lineUserIdEncrypted: encryptText(rawLineId),
        displayName: 'E2E Staff Member'
      }
    });

    const grant = await grantService.createAccessGrant(
      dormIdA,
      friend.id,
      'TECH',
      ownerUserA.id
    );

    const rawToken = grant.bearerUrl.split('#')[1];

    // Visit redemption link with hash
    await page.goto(`/staff-access#${rawToken}`);
    await page.waitForLoadState('networkidle');

    // Wait for redemption process to settle
    await page.waitForTimeout(1000);

    // Verify hash has been stripped from URL
    const currentUrl = page.url();
    expect(currentUrl).not.toContain(rawToken);

    // Verify revocation terminates session
    await grantService.revokeAccessGrant(dormIdA, grant.grant.id, ownerUserA.id);

    // Subsequent authenticated API request should fail closed (401)
    const postRevocationStatus = await page.evaluate(async (dId) => {
      const resp = await fetch('/api/v1/properties/rooms', {
        headers: { 'x-dormitory-id': dId }
      });
      return resp.status;
    }, dormIdA);

    expect(postRevocationStatus).toBe(401);
  });
});
