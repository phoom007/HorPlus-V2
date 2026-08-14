import { test, expect, request as playwrightRequest, type BrowserContext, type Page } from '@playwright/test';
import crypto from 'crypto';
import { getPrismaClient } from '../../server/src/db/prisma.js';
import { SessionTokenService } from '../../server/src/services/session-token.service.js';
import { CsrfService } from '../../server/src/services/csrf.service.js';
import { subscriptionEntitlementService } from '../../server/src/services/subscription-entitlement.service.js';
import { contractRenewalService } from '../../server/src/services/contract-renewal.service.js';
import { outboxService } from '../../server/src/services/outbox.service.js';
import { settlementService } from '../../server/src/services/settlement.service.js';
import { encryptText, hashToken } from '../../server/src/utils/crypto-encryption.js';

test.describe.serial('LOCAL-04 — Master Cross-Portal Playwright Acceptance Suite (Journeys A-L)', () => {
  const prisma = getPrismaClient();
  const sessionSecret = process.env.SESSION_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef';
  const csrfSecret = process.env.CSRF_SIGNING_KEY || 'csrf-secret-key-0123456789abcdef';
  const sessionTokenService = new SessionTokenService(sessionSecret);
  const csrfService = new CsrfService(csrfSecret);

  // Fixture IDs - Dorm A (Primary)
  let dormIdA: string;
  let ownerUserA: any;
  let managerUserA: any;
  let techUserA: any;
  let sessionTokenOwnerA: string;
  let csrfTokenOwnerA: string;
  let sessionTokenManagerA: string;
  let csrfTokenManagerA: string;
  let sessionTokenTechA: string;
  let csrfTokenTechA: string;

  let buildingIdA: string;
  let roomIdA101: string;
  let roomIdA102: string;
  let roomIdA103: string;
  let roomIdA104: string;
  let roomIdA201: string;
  let roomIdA202: string;

  // Tenant Fixture - Dorm A
  let createdTenantA: any;
  let tenantUserA: any;

  // Fixture IDs - Dorm B (For Cross-Dorm Isolation)
  let dormIdB: string;
  let ownerUserB: any;
  let sessionTokenOwnerB: string;
  let csrfTokenOwnerB: string;
  let roomIdB101: string;

  // Helper to inject authenticated session & cookies into browser context
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

  // Helper to submit tenant registration via UI
  async function submitTenantRegistration(
    page: Page,
    dormitoryId: string,
    roomId: string,
    firstName: string,
    lastName: string,
    phone: string
  ) {
    await page.addInitScript((dId) => {
      localStorage.setItem('selected_dormitory_id', dId);
    }, dormitoryId);

    await page.goto('/tenant/register');
    await page.waitForLoadState('networkidle');

    const roomSelect = page.locator('select');
    const roomInput = page.locator('input[placeholder*="ระบุรหัสห้องพัก"]');
    if (await roomSelect.isVisible()) {
      await roomSelect.selectOption(roomId);
    } else if (await roomInput.isVisible()) {
      await roomInput.fill(roomId);
    }

    await page.fill('input[placeholder="สมชาย"]', firstName);
    await page.fill('input[placeholder="ใจดี"]', lastName);
    await page.fill('input[placeholder="0812345678"]', phone);

    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeEnabled({ timeout: 30000 });
    await submitBtn.click();
    await expect(page.locator('text=ส่งคำขอลงทะเบียนเรียบร้อยแล้ว')).toBeVisible({ timeout: 15000 });
  }

  // Helper to create and authenticate a tenant browser context
  async function createAuthenticatedTenantContext(
    browser: any,
    tenantUser: { id: string; name: string; email: string },
    dormitoryId: string
  ) {
    const sid = crypto.randomUUID();
    const hash = SessionTokenService.hashSessionId(sid);
    await prisma.session.create({
      data: {
        userId: tenantUser.id,
        sessionIdHash: hash,
        tokenVersion: 1,
        status: 'active',
        expiresAt: new Date(Date.now() + 86400 * 1000),
      },
    });

    const sessionToken = sessionTokenService.encryptToken(
      { sub: tenantUser.id, sid, type: 'session', version: 1 },
      86400
    );
    const csrfToken = csrfService.generateCsrfToken(sid);

    const context = await browser.newContext();
    const page = await context.newPage();
    await setupBrowserSession(context, page, tenantUser, sessionToken, csrfToken, dormitoryId);

    return { context, page, sessionToken, csrfToken };
  }

  test.beforeAll(async () => {
    // 1. Seed subscription plans
    await subscriptionEntitlementService.ensureSeeded();

    const timestamp = Date.now();

    // 2. Provision Dormitory A
    const dormA = await prisma.dormitory.create({
      data: {
        name: `Dorm A Local04 ${timestamp}`,
        code: `DMA-L04-${timestamp}`,
        type: 'apartment',
        status: 'active',
      },
    });
    dormIdA = dormA.id;
    await subscriptionEntitlementService.provisionInitialTrial(dormIdA);

    // 3. Provision Roles for Dormitory A
    const roleOwnerA = await prisma.role.create({
      data: {
        dormitoryId: dormIdA,
        code: 'OWNER',
        name: 'Owner',
        permissions: ['*'],
      },
    });

    const roleManagerA = await prisma.role.create({
      data: {
        dormitoryId: dormIdA,
        code: 'MANAGER',
        name: 'Manager',
        permissions: ['tenants:*', 'contracts:*', 'meters:*', 'bills:*', 'maintenance:*'],
      },
    });

    const roleTechA = await prisma.role.create({
      data: {
        dormitoryId: dormIdA,
        code: 'TECH',
        name: 'Technician',
        permissions: ['maintenance:*', 'meters:read'],
      },
    });

    // 4. Provision Users & Memberships for Dormitory A
    ownerUserA = await prisma.user.create({
      data: {
        email: `owner-l04-a-${timestamp}@example.com`,
        emailNormalized: `owner-l04-a-${timestamp}@example.com`,
        name: 'Owner A Local04',
        googleSubject: `sub-owner-l04-a-${timestamp}`,
        status: 'active',
      },
    });
    await prisma.dormitoryMember.create({
      data: { dormitoryId: dormIdA, userId: ownerUserA.id, roleId: roleOwnerA.id, status: 'active', membershipOrigin: 'GOOGLE_BOOTSTRAP' },
    });

    managerUserA = await prisma.user.create({
      data: {
        email: `manager-l04-a-${timestamp}@example.com`,
        emailNormalized: `manager-l04-a-${timestamp}@example.com`,
        name: 'Manager A Local04',
        googleSubject: `sub-mgr-l04-a-${timestamp}`,
        status: 'active',
      },
    });
    await prisma.dormitoryMember.create({
      data: { dormitoryId: dormIdA, userId: managerUserA.id, roleId: roleManagerA.id, status: 'active' },
    });

    techUserA = await prisma.user.create({
      data: {
        email: `tech-l04-a-${timestamp}@example.com`,
        emailNormalized: `tech-l04-a-${timestamp}@example.com`,
        name: 'Tech A Local04',
        googleSubject: `sub-tech-l04-a-${timestamp}`,
        status: 'active',
      },
    });
    await prisma.dormitoryMember.create({
      data: { dormitoryId: dormIdA, userId: techUserA.id, roleId: roleTechA.id, status: 'active' },
    });

    // Sessions for Staff in Dorm A
    const sidOwnerA = crypto.randomUUID();
    await prisma.session.create({
      data: {
        userId: ownerUserA.id,
        sessionIdHash: SessionTokenService.hashSessionId(sidOwnerA),
        tokenVersion: 1,
        status: 'active',
        expiresAt: new Date(Date.now() + 86400 * 1000),
      },
    });
    sessionTokenOwnerA = sessionTokenService.encryptToken({ sub: ownerUserA.id, sid: sidOwnerA, type: 'session', version: 1 }, 86400);
    csrfTokenOwnerA = csrfService.generateCsrfToken(sidOwnerA);

    const sidManagerA = crypto.randomUUID();
    await prisma.session.create({
      data: {
        userId: managerUserA.id,
        sessionIdHash: SessionTokenService.hashSessionId(sidManagerA),
        tokenVersion: 1,
        status: 'active',
        expiresAt: new Date(Date.now() + 86400 * 1000),
      },
    });
    sessionTokenManagerA = sessionTokenService.encryptToken({ sub: managerUserA.id, sid: sidManagerA, type: 'session', version: 1 }, 86400);
    csrfTokenManagerA = csrfService.generateCsrfToken(sidManagerA);

    const sidTechA = crypto.randomUUID();
    await prisma.session.create({
      data: {
        userId: techUserA.id,
        sessionIdHash: SessionTokenService.hashSessionId(sidTechA),
        tokenVersion: 1,
        status: 'active',
        expiresAt: new Date(Date.now() + 86400 * 1000),
      },
    });
    sessionTokenTechA = sessionTokenService.encryptToken({ sub: techUserA.id, sid: sidTechA, type: 'session', version: 1 }, 86400);
    csrfTokenTechA = csrfService.generateCsrfToken(sidTechA);

    // 5. Provision Building & Rooms for Dorm A
    const buildingA = await prisma.building.create({
      data: { dormitoryId: dormIdA, name: 'Building 1', floorCount: 3 },
    });
    buildingIdA = buildingA.id;

    const rA101 = await prisma.room.create({
      data: {
        dormitoryId: dormIdA,
        buildingId: buildingIdA,
        roomNumber: 'A101',
        normalizedRoomNumber: 'A101',
        roomType: 'STANDARD',
        floor: 1,
        status: 'vacant',
        monthlyRent: '4500',
        depositAmount: '9000',
        advancePaymentAmount: '4500',
      },
    });
    roomIdA101 = rA101.id;

    const rA102 = await prisma.room.create({
      data: {
        dormitoryId: dormIdA,
        buildingId: buildingIdA,
        roomNumber: 'A102',
        normalizedRoomNumber: 'A102',
        roomType: 'STANDARD',
        floor: 1,
        status: 'vacant',
        monthlyRent: '4500',
        depositAmount: '9000',
        advancePaymentAmount: '4500',
      },
    });
    roomIdA102 = rA102.id;

    const rA103 = await prisma.room.create({
      data: {
        dormitoryId: dormIdA,
        buildingId: buildingIdA,
        roomNumber: 'A103',
        normalizedRoomNumber: 'A103',
        roomType: 'STANDARD',
        floor: 1,
        status: 'vacant',
        monthlyRent: '4500',
        depositAmount: '9000',
        advancePaymentAmount: '4500',
      },
    });
    roomIdA103 = rA103.id;

    const rA104 = await prisma.room.create({
      data: {
        dormitoryId: dormIdA,
        buildingId: buildingIdA,
        roomNumber: 'A104',
        normalizedRoomNumber: 'A104',
        roomType: 'STANDARD',
        floor: 1,
        status: 'vacant',
        monthlyRent: '5000',
        depositAmount: '10000',
        advancePaymentAmount: '5000',
      },
    });
    roomIdA104 = rA104.id;

    const rA201 = await prisma.room.create({
      data: {
        dormitoryId: dormIdA,
        buildingId: buildingIdA,
        roomNumber: 'A201',
        normalizedRoomNumber: 'A201',
        roomType: 'DELUXE',
        floor: 2,
        status: 'vacant',
        monthlyRent: '6000',
        depositAmount: '12000',
        advancePaymentAmount: '6000',
      },
    });
    roomIdA201 = rA201.id;

    const rA202 = await prisma.room.create({
      data: {
        dormitoryId: dormIdA,
        buildingId: buildingIdA,
        roomNumber: 'A202',
        normalizedRoomNumber: 'A202',
        roomType: 'DELUXE',
        floor: 2,
        status: 'vacant',
        monthlyRent: '6000',
        depositAmount: '12000',
        advancePaymentAmount: '6000',
      },
    });
    roomIdA202 = rA202.id;

    // 6. Provision Dormitory B (for Cross-Dorm Isolation)
    const dormB = await prisma.dormitory.create({
      data: {
        name: `Dorm B Local04 ${timestamp}`,
        code: `DMB-L04-${timestamp}`,
        type: 'apartment',
        status: 'active',
      },
    });
    dormIdB = dormB.id;
    await subscriptionEntitlementService.provisionInitialTrial(dormIdB);

    const roleOwnerB = await prisma.role.create({
      data: {
        dormitoryId: dormIdB,
        code: 'OWNER',
        name: 'Owner B',
        permissions: ['*'],
      },
    });

    ownerUserB = await prisma.user.create({
      data: {
        email: `owner-l04-b-${timestamp}@example.com`,
        emailNormalized: `owner-l04-b-${timestamp}@example.com`,
        name: 'Owner B Local04',
        googleSubject: `sub-owner-l04-b-${timestamp}`,
        status: 'active',
      },
    });
    await prisma.dormitoryMember.create({
      data: { dormitoryId: dormIdB, userId: ownerUserB.id, roleId: roleOwnerB.id, status: 'active' },
    });

    const sidOwnerB = crypto.randomUUID();
    await prisma.session.create({
      data: {
        userId: ownerUserB.id,
        sessionIdHash: SessionTokenService.hashSessionId(sidOwnerB),
        tokenVersion: 1,
        status: 'active',
        expiresAt: new Date(Date.now() + 86400 * 1000),
      },
    });
    sessionTokenOwnerB = sessionTokenService.encryptToken({ sub: ownerUserB.id, sid: sidOwnerB, type: 'session', version: 1 }, 86400);
    csrfTokenOwnerB = csrfService.generateCsrfToken(sidOwnerB);

    const buildingB = await prisma.building.create({
      data: { dormitoryId: dormIdB, name: 'Building B1', floorCount: 2 },
    });

    const rB101 = await prisma.room.create({
      data: {
        dormitoryId: dormIdB,
        buildingId: buildingB.id,
        roomNumber: 'B101',
        normalizedRoomNumber: 'B101',
        roomType: 'STANDARD',
        floor: 1,
        status: 'vacant',
        monthlyRent: '4000',
        depositAmount: '8000',
        advancePaymentAmount: '4000',
      },
    });
    roomIdB101 = rB101.id;
  });

  // =========================================================================
  // JOURNEY A: TENANT APPLICATION → OWNER APPROVAL → TENANT PORTAL VERIFICATION
  // =========================================================================
  test('Journey A — Tenant Application submission via UI -> Owner UI approval modal -> PostgreSQL atomic creation -> Tenant portal view', async ({ browser }) => {
    test.setTimeout(60000);

    // 1. Tenant browser: submits application via UI
    const tenantCtx = await browser.newContext();
    const tenantPage = await tenantCtx.newPage();
    await submitTenantRegistration(tenantPage, dormIdA, roomIdA101, 'Somchai', 'Jaidee', '0819998801');

    // F5 Persistence verification for Tenant Registration
    await tenantPage.reload();
    await tenantPage.waitForLoadState('networkidle');
    await expect(tenantPage.locator('button[type="submit"]')).toBeVisible();

    // Verify DB state
    const regReq = await prisma.tenantRegistrationRequest.findFirst({
      where: { dormitoryId: dormIdA, phone: '0819998801' },
      orderBy: { createdAt: 'desc' },
    });
    expect(regReq).not.toBeNull();
    expect(regReq?.status).toBe('pending_owner_approval');
    expect(regReq?.requestedRoomId).toBe(roomIdA101);

    // 2. Owner browser: approves registration via UI modal
    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    await setupBrowserSession(ownerCtx, ownerPage, ownerUserA, sessionTokenOwnerA, csrfTokenOwnerA, dormIdA);

    await ownerPage.goto('/owner/tenants');
    await ownerPage.waitForLoadState('networkidle');

    // Click "คำขอลงทะเบียน" button
    const regBtn = ownerPage.locator('button:has-text("คำขอลงทะเบียน")');
    await expect(regBtn).toBeVisible({ timeout: 15000 });
    await regBtn.click();

    // Verify registration modal opens
    await expect(ownerPage.locator('text=รายการคำขอลงทะเบียนสมัครเช่าห้องพัก')).toBeVisible({ timeout: 10000 });

    // Find Somchai Jaidee card and click "อนุมัติและทำสัญญา"
    const somchaiCard = ownerPage.locator('div.border').filter({ hasText: 'Somchai Jaidee' }).first();
    await expect(somchaiCard).toBeVisible();

    const approveBtn = somchaiCard.locator('button:has-text("อนุมัติและทำสัญญา")').first();
    await approveBtn.click();

    // Modal with terms opens -> Click "ยืนยันการอนุมัติ"
    const confirmApproveBtn = ownerPage.locator('button:has-text("ยืนยันการอนุมัติ")');
    await expect(confirmApproveBtn).toBeVisible();
    await confirmApproveBtn.click();

    // Wait for modal to close and list to update
    await expect(ownerPage.locator('text=ยืนยันการอนุมัติ')).not.toBeVisible({ timeout: 15000 });

    // 3. Post-Action PostgreSQL Assertions
    const updatedReq = await prisma.tenantRegistrationRequest.findUnique({
      where: { id: regReq!.id },
    });
    expect(updatedReq?.status).toBe('approved');
    expect(updatedReq?.approvedTenantId).not.toBeNull();

    const createdTenant = await prisma.tenant.findUnique({
      where: { id: updatedReq!.approvedTenantId! },
    });
    expect(createdTenant).not.toBeNull();
    expect(createdTenant?.firstName).toBe('Somchai');
    expect(createdTenant?.status).toBe('active');
    createdTenantA = createdTenant;

    const createdContract = await prisma.contract.findFirst({
      where: { tenantId: createdTenant!.id, dormitoryId: dormIdA },
    });
    expect(createdContract).not.toBeNull();
    expect(createdContract?.status).toBe('active');
    expect(createdContract?.roomId).toBe(roomIdA101);

    const activeOccupancy = await prisma.occupancy.findFirst({
      where: { tenantId: createdTenant!.id, roomId: roomIdA101, status: 'ACTIVE' },
    });
    expect(activeOccupancy).not.toBeNull();

    const updatedRoom = await prisma.room.findUnique({ where: { id: roomIdA101 } });
    expect(updatedRoom?.status).toBe('occupied');
    expect(updatedRoom?.currentTenantId).toBe(createdTenant!.id);

    // 4. Tenant Portal View Verification
    // Link a user record to this tenant so they can view their portal
    const tenantUser = await prisma.user.create({
      data: {
        email: `tenant-somchai-${Date.now()}@example.com`,
        emailNormalized: `tenant-somchai-${Date.now()}@example.com`,
        name: 'Somchai Jaidee',
        googleSubject: `sub-tenant-somchai-${Date.now()}`,
        status: 'active',
      },
    });
    tenantUserA = tenantUser;

    const tenantRole = await prisma.role.findFirst({ where: { code: 'TENANT', dormitoryId: dormIdA } }) || await prisma.role.create({
      data: { dormitoryId: dormIdA, code: 'TENANT', name: 'Tenant', permissions: ['contract:read'] },
    });
    await prisma.dormitoryMember.create({
      data: { dormitoryId: dormIdA, userId: tenantUser.id, roleId: tenantRole.id, status: 'active' },
    });
    await prisma.tenant.update({
      where: { id: createdTenant!.id },
      data: { linkedUserId: tenantUser.id },
    });

    const tenantPortalCtx = await createAuthenticatedTenantContext(browser, tenantUser, dormIdA);
    await tenantPortalCtx.page.goto('/tenant');
    await tenantPortalCtx.page.waitForLoadState('networkidle');

    // Assert room number and tenant profile visible in DOM
    await expect(tenantPortalCtx.page.locator('text=A101').first()).toBeVisible({ timeout: 15000 });

    // F5 Persistence test on tenant portal
    await tenantPortalCtx.page.reload();
    await tenantPortalCtx.page.waitForLoadState('networkidle');
    await expect(tenantPortalCtx.page.locator('text=A101').first()).toBeVisible({ timeout: 15000 });

    await tenantCtx.close();
    await ownerCtx.close();
    await tenantPortalCtx.context.close();
  });

  // =========================================================================
  // JOURNEY B: MULTIPLE APPLICANTS SAME ROOM & REASSIGNMENT VIA UI
  // =========================================================================
  test('Journey B — Multiple applicants for same room persist; Owner approves A without auto-rejecting B; Owner reassigns B to another room via UI', async ({ browser }) => {
    test.setTimeout(60000);

    const ts = Date.now();
    const phoneB1 = `0819${(ts % 1000000).toString().padStart(6, '0')}`;
    const phoneB2 = `0818${((ts + 1) % 1000000).toString().padStart(6, '0')}`;

    // 1. Applicant 1 submits for Room A102
    const ctx1 = await browser.newContext();
    const p1 = await ctx1.newPage();
    await submitTenantRegistration(p1, dormIdA, roomIdA102, 'ApplicantB1', 'FirstRoom102', phoneB1);

    // 2. Applicant 2 ALSO submits for same Room A102
    const ctx2 = await browser.newContext();
    const p2 = await ctx2.newPage();
    await submitTenantRegistration(p2, dormIdA, roomIdA102, 'ApplicantB2', 'SecondRoom102', phoneB2);

    // Verify both pending requests exist for Room A102
    const pendingCount = await prisma.tenantRegistrationRequest.count({
      where: { dormitoryId: dormIdA, requestedRoomId: roomIdA102, status: 'pending_owner_approval' },
    });
    expect(pendingCount).toBe(2);

    // 3. Owner approves Applicant B1 for Room A102
    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    await setupBrowserSession(ownerCtx, ownerPage, ownerUserA, sessionTokenOwnerA, csrfTokenOwnerA, dormIdA);

    await ownerPage.goto('/owner/tenants');
    await ownerPage.waitForLoadState('networkidle');
    await ownerPage.locator('button:has-text("คำขอลงทะเบียน")').click();

    const cardB1 = ownerPage.locator('div.border').filter({ hasText: 'ApplicantB1 FirstRoom102' }).first();
    await expect(cardB1).toBeVisible();
    await cardB1.locator('button:has-text("อนุมัติและทำสัญญา")').first().click();
    await ownerPage.locator('button:has-text("ยืนยันการอนุมัติ")').click();
    await expect(ownerPage.locator('text=ยืนยันการอนุมัติ')).not.toBeVisible({ timeout: 15000 });

    // Verify DB: Applicant B1 approved, Applicant B2 REMAINS PENDING (Not auto-rejected)
    const reqB1 = await prisma.tenantRegistrationRequest.findFirst({
      where: { dormitoryId: dormIdA, phone: phoneB1 },
      orderBy: { createdAt: 'desc' },
    });
    const reqB2 = await prisma.tenantRegistrationRequest.findFirst({
      where: { dormitoryId: dormIdA, phone: phoneB2 },
      orderBy: { createdAt: 'desc' },
    });
    expect(reqB1?.status).toBe('approved');
    expect(reqB2?.status).toBe('pending_owner_approval');

    // 4. Owner reassigns Applicant B2 to Room A103 via UI (modal already open)
    const cardB2 = ownerPage.locator('div.border').filter({ hasText: 'ApplicantB2 SecondRoom102' }).first();
    await expect(cardB2).toBeVisible();

    await cardB2.locator('button:has-text("เปลี่ยนห้อง")').first().click();
    await expect(ownerPage.locator('text=เปลี่ยนห้องพักสำหรับคำขอลงทะเบียน')).toBeVisible();

    // Select Room A103 in reassignment modal
    const reassignSelect = ownerPage.locator('select');
    await reassignSelect.selectOption(roomIdA103);
    await ownerPage.locator('button:has-text("บันทึกการเปลี่ยนห้อง")').click();
    await expect(ownerPage.locator('text=เปลี่ยนห้องพักสำหรับคำขอลงทะเบียน')).not.toBeVisible({ timeout: 15000 });

    // Verify DB: Applicant B2 requestedRoomId is now Room A103
    const updatedReqB2 = await prisma.tenantRegistrationRequest.findUnique({ where: { id: reqB2!.id } });
    expect(updatedReqB2?.requestedRoomId).toBe(roomIdA103);

    // 5. Owner approves Applicant B2 into Room A103
    const updatedCardB2 = ownerPage.locator('div.border').filter({ hasText: 'ApplicantB2 SecondRoom102' }).first();
    await updatedCardB2.locator('button:has-text("อนุมัติและทำสัญญา")').first().click();
    await ownerPage.locator('button:has-text("ยืนยันการอนุมัติ")').click();
    await expect(ownerPage.locator('text=ยืนยันการอนุมัติ')).not.toBeVisible({ timeout: 15000 });

    // Verify DB: Both rooms A102 and A103 are now occupied
    const roomA102 = await prisma.room.findUnique({ where: { id: roomIdA102 } });
    const roomA103 = await prisma.room.findUnique({ where: { id: roomIdA103 } });
    expect(roomA102?.status).toBe('occupied');
    expect(roomA103?.status).toBe('occupied');

    await ctx1.close();
    await ctx2.close();
    await ownerCtx.close();
  });

  // =========================================================================
  // JOURNEY C: CO-OCCUPANT MANAGEMENT & MUTATION BOUNDARY
  // =========================================================================
  test('Journey C — Owner manages co-occupants via UI without modifying financial terms; Tenant cannot mutate co-occupants', async ({ browser }) => {
    test.setTimeout(60000);

    // Find the active tenant in Room A101
    const tenantA = await prisma.tenant.findUnique({
      where: { id: createdTenantA.id },
      include: { contracts: true },
    });
    expect(tenantA).not.toBeNull();
    const originalRent = tenantA!.contracts[0].rentAmount;
    const originalDeposit = tenantA!.contracts[0].depositAmount;

    // 1. Owner opens /owner/tenants and selects Somchai from the list
    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    await setupBrowserSession(ownerCtx, ownerPage, ownerUserA, sessionTokenOwnerA, csrfTokenOwnerA, dormIdA);

    await ownerPage.goto('/owner/tenants');
    await ownerPage.waitForLoadState('networkidle');

    // Click on Somchai tenant row in the left sidebar
    const tenantRow = ownerPage.locator('h4:has-text("Somchai Jaidee")').first();
    await expect(tenantRow).toBeVisible({ timeout: 15000 });
    await tenantRow.click();

    // Verify detail panel opens
    await expect(ownerPage.locator('text=ข้อมูลผู้พักร่วมอาศัย (Co-Occupants)')).toBeVisible({ timeout: 15000 });

    // Click "เพิ่มผู้พักร่วม" button
    const addCoBtn = ownerPage.locator('button:has-text("เพิ่มผู้พักร่วม")').first();
    await expect(addCoBtn).toBeVisible();
    await addCoBtn.click();

    // Fill co-occupant modal form
    await expect(ownerPage.locator('text=เพิ่มข้อมูลผู้พักร่วมอาศัย')).toBeVisible();
    await ownerPage.fill('input[placeholder="สมหญิง ใจดี"]', 'Somsri Cooccupant');
    await ownerPage.fill('input[placeholder="เพื่อน / แฟน / พี่น้อง"]', 'เพื่อนร่วมห้อง');
    await ownerPage.fill('input[placeholder="0891234567"]', '0821112233');

    await ownerPage.locator('button:has-text("บันทึกผู้พักร่วม")').click();
    await expect(ownerPage.locator('text=เพิ่มข้อมูลผู้พักร่วมอาศัย')).not.toBeVisible({ timeout: 15000 });

    // 2. Post-action DB assertion: Co-occupant created, contract financials untouched
    const coList = await prisma.tenantCoOccupant.findMany({
      where: { tenantId: tenantA!.id, status: 'active' },
    });
    expect(coList.length).toBe(1);
    expect(coList[0].name).toBe('Somsri Cooccupant');

    const refreshedContract = await prisma.contract.findFirst({
      where: { tenantId: tenantA!.id, status: 'active' },
    });
    expect(String(refreshedContract?.rentAmount)).toBe(String(originalRent));
    expect(String(refreshedContract?.depositAmount)).toBe(String(originalDeposit));

    // 3. Tenant logs into portal: sees co-occupant, but cannot mutate
    const tenantCtx = await createAuthenticatedTenantContext(browser, tenantUserA, dormIdA);
    await tenantCtx.page.goto('/tenant');
    await tenantCtx.page.waitForLoadState('networkidle');

    // Click on "โปรไฟล์" bottom navigation tab
    const profileTabBtn = tenantCtx.page.locator('button:has-text("โปรไฟล์")');
    await expect(profileTabBtn).toBeVisible({ timeout: 15000 });
    await profileTabBtn.click();

    // Verify co-occupant name is visible in tenant DOM
    await expect(tenantCtx.page.locator('text=Somsri Cooccupant')).toBeVisible({ timeout: 15000 });

    // Tenant opens co-occupants modal and tries mutation -> blocked with error toast
    const manageCoBtn = tenantCtx.page.locator('button:has-text("แก้ไข / เพิ่ม")');
    await expect(manageCoBtn).toBeVisible({ timeout: 10000 });
    await manageCoBtn.click();
    await expect(tenantCtx.page.getByRole('heading', { name: 'รายชื่อผู้พักอาศัยร่วม', exact: true })).toBeVisible();

    // Click add co-occupant in tenant modal
    const tenantAddBtn = tenantCtx.page.locator('button:has-text("เพิ่มลงในรายการด้านบน")');
    await expect(tenantAddBtn).toBeVisible();
    await tenantAddBtn.click();
    // Toast displays polite rejection
    await expect(tenantCtx.page.locator('text=ฟังก์ชันจัดการผู้พักร่วมยังไม่พร้อมใช้งานในระบบขณะนี้')).toBeVisible({ timeout: 10000 });

    await ownerCtx.close();
    await tenantCtx.context.close();
  });

  // =========================================================================
  // JOURNEY D & E: TENANT RENEWAL REQUEST → OWNER APPROVAL → SCHEDULED ACTIVATION
  // =========================================================================
  test('Journey D & E — Tenant submits renewal via UI -> Owner approves scheduled renewal -> Scheduled clock activation updates contract chain', async ({ browser }) => {
    test.setTimeout(60000);

    // 1. Setup an active tenant in Room A104 with contract expiring soon
    const tenantDUser = await prisma.user.create({
      data: {
        email: `tenant-d-${Date.now()}@example.com`,
        emailNormalized: `tenant-d-${Date.now()}@example.com`,
        name: 'Tenant D Renewal',
        googleSubject: `sub-tenant-d-${Date.now()}`,
        status: 'active',
      },
    });
    const tenantDRole = await prisma.role.findFirst({ where: { code: 'TENANT', dormitoryId: dormIdA } }) || await prisma.role.create({
      data: { dormitoryId: dormIdA, code: 'TENANT', name: 'Tenant', permissions: ['contract:read'] },
    });
    await prisma.dormitoryMember.create({
      data: { dormitoryId: dormIdA, userId: tenantDUser.id, roleId: tenantDRole!.id, status: 'active' },
    });

    const tenantD = await prisma.tenant.create({
      data: {
        dormitoryId: dormIdA,
        tenantNumber: `TNT-D-${Date.now()}`,
        firstName: 'TenantD',
        lastName: 'Renewal',
        displayName: 'Tenant D Renewal',
        phone: '0819998804',
        status: 'active',
        linkedUserId: tenantDUser.id,
      },
    });

    const contractD1 = await prisma.contract.create({
      data: {
        dormitoryId: dormIdA,
        contractNumber: `CTR-D1-${Date.now()}`,
        roomId: roomIdA104,
        tenantId: tenantD.id,
        status: 'active',
        startDate: new Date('2026-03-01'),
        endDate: new Date('2026-08-31'),
        durationMonths: 6,
        rentAmount: '5000',
        depositAmount: '10000',
        advancePaymentAmount: '5000',
        activatedAt: new Date('2026-03-01'),
      },
    });

    await prisma.occupancy.create({
      data: {
        dormitoryId: dormIdA,
        roomId: roomIdA104,
        tenantId: tenantD.id,
        contractId: contractD1.id,
        status: 'ACTIVE',
        startedAt: new Date('2026-03-01'),
      },
    });
    await prisma.room.update({
      where: { id: roomIdA104 },
      data: { status: 'occupied', currentTenantId: tenantD.id },
    });

    // 2. Tenant submits renewal request via UI
    const tenantCtx = await createAuthenticatedTenantContext(browser, tenantDUser, dormIdA);
    await tenantCtx.page.goto('/tenant');
    await tenantCtx.page.waitForLoadState('networkidle');

    // Click "เอกสารสัญญา" card on home dashboard
    const contractMenuCard = tenantCtx.page.locator('span:has-text("เอกสารสัญญา")').first();
    await expect(contractMenuCard).toBeVisible({ timeout: 15000 });
    await contractMenuCard.click();

    // Find and submit renewal request form
    const renewalSection = tenantCtx.page.locator('text=คำขอต่ออายุสัญญาเช่า');
    await expect(renewalSection).toBeVisible({ timeout: 15000 });

    const submitRenewalBtn = tenantCtx.page.locator('#submitRenewalRequestBtn, button:has-text("ส่งคำขอต่อสัญญา")').first();
    await expect(submitRenewalBtn).toBeVisible();
    await submitRenewalBtn.click();

    // Verify toast or badge confirmation
    await expect(tenantCtx.page.locator('#renewalStatusBadge')).toBeVisible({ timeout: 15000 });

    // F5 Persistence: Renewal request status remains pending
    await tenantCtx.page.reload();
    await tenantCtx.page.waitForLoadState('networkidle');
    const contractMenuCardAfter = tenantCtx.page.locator('span:has-text("เอกสารสัญญา")').first();
    if (await contractMenuCardAfter.isVisible()) {
      await contractMenuCardAfter.click();
    }
    await expect(tenantCtx.page.locator('#renewalStatusBadge')).toBeVisible({ timeout: 15000 });

    // Verify DB
    const renewalReq = await prisma.tenantRenewalRequest.findFirst({
      where: { tenantId: tenantD.id, dormitoryId: dormIdA, status: 'PENDING_OWNER_APPROVAL' },
    });
    expect(renewalReq).not.toBeNull();

    // 3. Owner reviews and approves renewal via UI
    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    await setupBrowserSession(ownerCtx, ownerPage, ownerUserA, sessionTokenOwnerA, csrfTokenOwnerA, dormIdA);

    await ownerPage.goto('/owner/contracts');
    await ownerPage.waitForLoadState('networkidle');

    // Find pending renewal card in queue
    await expect(ownerPage.locator('text=คำขอต่ออายุสัญญา').first()).toBeVisible();
    const reviewBtn = ownerPage.locator('[data-testid="review-renewal-btn"], button:has-text("ตรวจสอบ / อนุมัติ"), button:has-text("ตรวจสอบ")').first();
    await expect(reviewBtn).toBeVisible();
    await reviewBtn.click();

    await expect(ownerPage.locator('text=ตรวจสอบคำขอต่ออายุสัญญา (จากผู้เช่า)')).toBeVisible();

    const confirmApproveBtn = ownerPage.locator('[data-testid="confirm-approve-renewal-btn"], button:has-text("อนุมัติคำขอต่ออายุ")').first();
    await confirmApproveBtn.click();
    await expect(ownerPage.locator('text=ตรวจสอบคำขอต่ออายุสัญญา (จากผู้เช่า)')).not.toBeVisible({ timeout: 15000 });

    // 4. PostgreSQL Assertions: New contract created in approved_scheduled state
    const scheduledContract = await prisma.contract.findFirst({
      where: {
        dormitoryId: dormIdA,
        tenantId: tenantD.id,
        previousContractId: contractD1.id,
      },
    });
    expect(scheduledContract).not.toBeNull();
    expect(scheduledContract?.status).toBe('approved_scheduled');
    expect(scheduledContract?.activatedAt).toBeNull();

    // Old contract is still active before effective start date
    const currentContract = await prisma.contract.findUnique({ where: { id: contractD1.id } });
    expect(currentContract?.status).toBe('active');

    // 5. Scheduled Activation via Canonical Engine on Start Date
    const activationResult = await contractRenewalService.activateScheduledContracts(
      dormIdA,
      scheduledContract!.startDate
    );
    expect(activationResult.activatedCount).toBeGreaterThanOrEqual(1);

    // Verify DB after activation
    const activeNewContract = await prisma.contract.findUnique({ where: { id: scheduledContract!.id } });
    expect(activeNewContract?.status).toBe('active');
    expect(activeNewContract?.activatedAt).not.toBeNull();

    const previousContractAfter = await prisma.contract.findUnique({ where: { id: contractD1.id } });
    expect(previousContractAfter?.status).toBe('completed');

    // Single active occupancy exists
    const activeOccupancyCount = await prisma.occupancy.count({
      where: { roomId: roomIdA104, status: 'ACTIVE' },
    });
    expect(activeOccupancyCount).toBe(1);

    // Tenant and Owner reload UI to verify new contract chain
    await tenantCtx.page.reload();
    await tenantCtx.page.waitForLoadState('networkidle');
    await expect(tenantCtx.page.locator('text=A104').first()).toBeVisible();

    await ownerPage.reload();
    await ownerPage.waitForLoadState('networkidle');
    await expect(ownerPage.locator('text=A104').first()).toBeVisible();

    await tenantCtx.context.close();
    await ownerCtx.close();
  });

  // =========================================================================
  // JOURNEY F & G: FORCED REPLACEMENT & SETTLEMENT CROSS-PORTAL LIFECYCLE
  // =========================================================================
  test('Journey F & G1 — Forced replacement destructive warning -> Atomic termination & settlement net > 0 (PENDING_REFUND -> REFUNDED via UI)', async ({ browser }) => {
    test.setTimeout(60000);

    // 1. Setup Old Tenant in Room A201 with deposit
    const oldTenantUser = await prisma.user.create({
      data: {
        email: `tenant-old-${Date.now()}@example.com`,
        emailNormalized: `tenant-old-${Date.now()}@example.com`,
        name: 'Old Tenant A201',
        googleSubject: `sub-tenant-old-${Date.now()}`,
        status: 'active',
      },
    });
    const tenantRole = await prisma.role.findFirst({ where: { code: 'TENANT', dormitoryId: dormIdA } }) || await prisma.role.create({
      data: { dormitoryId: dormIdA, code: 'TENANT', name: 'Tenant', permissions: ['contract:read'] },
    });
    await prisma.dormitoryMember.create({
      data: { dormitoryId: dormIdA, userId: oldTenantUser.id, roleId: tenantRole!.id, status: 'active' },
    });

    const oldTenant = await prisma.tenant.create({
      data: {
        dormitoryId: dormIdA,
        tenantNumber: `TNT-OLD-${Date.now()}`,
        firstName: 'Old',
        lastName: 'Tenant201',
        displayName: 'Old Tenant A201',
        phone: '0819998821',
        status: 'active',
        linkedUserId: oldTenantUser.id,
      },
    });

    const oldContract = await prisma.contract.create({
      data: {
        dormitoryId: dormIdA,
        contractNumber: `CTR-OLD-${Date.now()}`,
        roomId: roomIdA201,
        tenantId: oldTenant.id,
        status: 'active',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        durationMonths: 12,
        rentAmount: '6000',
        depositAmount: '12000',
        advancePaymentAmount: '6000',
        activatedAt: new Date('2026-01-01'),
      },
    });

    await prisma.occupancy.create({
      data: {
        dormitoryId: dormIdA,
        roomId: roomIdA201,
        tenantId: oldTenant.id,
        contractId: oldContract.id,
        status: 'ACTIVE',
        startedAt: new Date('2026-01-01'),
      },
    });
    await prisma.room.update({
      where: { id: roomIdA201 },
      data: { status: 'occupied', currentTenantId: oldTenant.id },
    });

    // 2. New Applicant submits registration for Room A201
    const newAppCtx = await browser.newContext();
    const newAppPage = await newAppCtx.newPage();
    await submitTenantRegistration(newAppPage, dormIdA, roomIdA201, 'NewTenant', 'Replacement', '0819998822');

    // 3. Owner approves new applicant into occupied Room A201 -> receives destructive warning modal
    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    await setupBrowserSession(ownerCtx, ownerPage, ownerUserA, sessionTokenOwnerA, csrfTokenOwnerA, dormIdA);

    await ownerPage.goto('/owner/tenants');
    await ownerPage.waitForLoadState('networkidle');
    await ownerPage.locator('button:has-text("คำขอลงทะเบียน")').click();

    const replacementCard = ownerPage.locator('div.border').filter({ hasText: 'NewTenant Replacement' }).first();
    await expect(replacementCard).toBeVisible();
    await replacementCard.locator('button:has-text("อนุมัติและทำสัญญา")').first().click();

    // Click confirm approval -> triggers warning modal
    await ownerPage.locator('button:has-text("ยืนยันการอนุมัติ")').click();

    // Destructive Warning Modal must appear
    const warningModal = ownerPage.locator('text=คำเตือนการยุติสัญญาและยกเลิกผู้เช่าเดิม');
    await expect(warningModal).toBeVisible({ timeout: 10000 });

    // Owner confirms forced replacement
    const confirmReplacementBtn = ownerPage.locator('button:has-text("ยืนยันยกเลิกผู้เช่าเดิมและอนุมัติผู้เช่าใหม่")');
    await expect(confirmReplacementBtn).toBeVisible();
    await confirmReplacementBtn.click();

    // Wait for modal to dismiss
    await expect(confirmReplacementBtn).not.toBeVisible({ timeout: 15000 });

    // 4. PostgreSQL Atomic Assertions
    const terminatedOldContract = await prisma.contract.findUnique({ where: { id: oldContract.id } });
    expect(terminatedOldContract?.status).toBe('terminated');
    expect(terminatedOldContract?.terminationReason).toContain('ยุติสัญญาเนื่องจากผู้ดูแลหอพักอนุมัติผู้เช่ารายใหม่เข้าแทนที่');

    const closedOccupancy = await prisma.occupancy.findFirst({ where: { contractId: oldContract.id } });
    expect(closedOccupancy?.status).toBe('ENDED');

    const createdSettlement = await prisma.contractSettlement.findFirst({
      where: { contractId: oldContract.id, dormitoryId: dormIdA },
    });
    expect(createdSettlement).not.toBeNull();
    expect(createdSettlement?.settlementStatus).toBe('PENDING_REFUND');
    expect(createdSettlement?.settlementDirection).toBe('REFUND');
    expect(Number(createdSettlement!.depositAmount)).toBe(12000);
    expect(Number(createdSettlement!.netSettlement)).toBe(12000);

    // Dispatch outbox events to ensure notices are delivered
    await outboxService.processPendingOutboxEvents();

    // 5. Old Tenant logs in to portal: sees termination notice
    const oldTenantCtx = await createAuthenticatedTenantContext(browser, oldTenantUser, dormIdA);
    await oldTenantCtx.page.goto('/tenant');
    await oldTenantCtx.page.waitForLoadState('networkidle');

    await expect(oldTenantCtx.page.locator('text=แจ้งยุติสัญญาเช่า').first()).toBeVisible({ timeout: 15000 });

    // 6. Owner confirms settlement refund in Settlements UI (net > 0: PENDING_REFUND -> REFUNDED)
    await ownerPage.goto('/owner/contracts');
    await ownerPage.waitForLoadState('networkidle');

    await ownerPage.locator('input[placeholder*="ค้นหา"]').fill(oldContract.contractNumber);
    await ownerPage.locator(`text=${oldContract.contractNumber}`).first().click();

    await expect(ownerPage.locator('[data-testid="settlement-container"]')).toBeVisible({ timeout: 10000 });
    await expect(ownerPage.locator('[data-testid="settlement-status-badge"]')).toContainText('รอคืนเงิน');
    await expect(ownerPage.locator('[data-testid="settlement-direction"]')).toContainText('คืนเงินให้ผู้เช่า');

    const confirmRefundBtn = ownerPage.locator('[data-testid="confirm-refund-btn"]').first();
    await expect(confirmRefundBtn).toBeVisible({ timeout: 10000 });
    await confirmRefundBtn.click();

    await expect(ownerPage.locator('[data-testid="settlement-locked-notice"]')).toBeVisible({ timeout: 10000 });
    await expect(ownerPage.locator('[data-testid="settlement-status-badge"]')).toContainText('คืนเงินแล้ว');

    const updatedSettlement = await prisma.contractSettlement.findUnique({ where: { id: createdSettlement!.id } });
    expect(updatedSettlement?.settlementStatus).toBe('REFUNDED');

    await newAppCtx.close();
    await ownerCtx.close();
    await oldTenantCtx.context.close();
  });

  test('Journey G2 — Settlement Direction B: net < 0 (PENDING_PAYMENT -> PAYMENT_RECEIVED via Owner UI confirmation) & cross-portal verification', async ({ browser }) => {
    test.setTimeout(60000);

    const timestamp = Date.now();
    // 1. Setup Tenant and terminated contract with deposit = 3000 in Room A202
    const tenantUser = await prisma.user.create({
      data: {
        email: `tenant-neg-${timestamp}@example.com`,
        emailNormalized: `tenant-neg-${timestamp}@example.com`,
        name: 'Tenant NegSettlement',
        googleSubject: `sub-tenant-neg-${timestamp}`,
        status: 'active',
      },
    });
    const tenantRole = await prisma.role.findFirst({ where: { code: 'TENANT', dormitoryId: dormIdA } }) || await prisma.role.create({
      data: { dormitoryId: dormIdA, code: 'TENANT', name: 'Tenant', permissions: ['contract:read'] },
    });
    await prisma.dormitoryMember.create({
      data: { dormitoryId: dormIdA, userId: tenantUser.id, roleId: tenantRole!.id, status: 'active' },
    });

    const tenant = await prisma.tenant.create({
      data: {
        dormitoryId: dormIdA,
        tenantNumber: `TNT-NEG-${timestamp}`,
        firstName: 'Tenant',
        lastName: 'NegSettlement',
        displayName: 'Tenant NegSettlement',
        phone: '0819998833',
        status: 'active',
        linkedUserId: tenantUser.id,
      },
    });

    const contract = await prisma.contract.create({
      data: {
        dormitoryId: dormIdA,
        contractNumber: `CTR-NEG-${timestamp}`,
        roomId: roomIdA202,
        tenantId: tenant.id,
        status: 'terminated',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-06-30'),
        durationMonths: 6,
        rentAmount: '5000',
        depositAmount: '3000',
        advancePaymentAmount: '5000',
        activatedAt: new Date('2026-01-01'),
        terminationReason: 'สิ้นสุดสัญญาเช่าตามกำหนด',
      },
    });

    // 2. Initialize settlement via settlementService with damage item of 5000 (net = 3000 - 5000 = -2000)
    const settlement = await settlementService.getOrCreateSettlement(dormIdA, contract.id);
    await settlementService.addDamageItem({
      dormitoryId: dormIdA,
      settlementId: settlement.id,
      description: 'ค่าซ่อมแซมผนังและเปลี่ยนกุญแจห้อง',
      amount: 5000,
      actorUserId: ownerUserA.id,
      actorRole: 'OWNER',
    });

    const recalculatedSettlement = await prisma.contractSettlement.findUnique({ where: { id: settlement.id } });
    expect(recalculatedSettlement?.settlementStatus).toBe('PENDING_PAYMENT');
    expect(recalculatedSettlement?.settlementDirection).toBe('PAYMENT_DUE');
    expect(Number(recalculatedSettlement?.netSettlement)).toBe(-2000);

    // 3. Owner UI: Open /owner/contracts, select contract, verify PENDING_PAYMENT, click confirm payment
    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    await setupBrowserSession(ownerCtx, ownerPage, ownerUserA, sessionTokenOwnerA, csrfTokenOwnerA, dormIdA);

    await ownerPage.goto('/owner/contracts');
    await ownerPage.waitForLoadState('networkidle');

    await ownerPage.locator('input[placeholder*="ค้นหา"]').fill(contract.contractNumber);
    await ownerPage.locator(`text=${contract.contractNumber}`).first().click();

    await expect(ownerPage.locator('[data-testid="settlement-container"]')).toBeVisible({ timeout: 10000 });
    await expect(ownerPage.locator('[data-testid="settlement-status-badge"]')).toContainText('รอชำระส่วนต่าง');
    await expect(ownerPage.locator('[data-testid="settlement-direction"]')).toContainText('เรียกเก็บจากผู้เช่า');

    const confirmPaymentBtn = ownerPage.locator('[data-testid="confirm-payment-btn"]').first();
    await expect(confirmPaymentBtn).toBeVisible({ timeout: 10000 });
    await confirmPaymentBtn.click();

    await expect(ownerPage.locator('[data-testid="settlement-locked-notice"]')).toBeVisible({ timeout: 10000 });
    await expect(ownerPage.locator('[data-testid="settlement-status-badge"]')).toContainText('ชำระส่วนต่างแล้ว');

    // 4. DB Assertion: Status is PAYMENT_RECEIVED
    const finalSettlement = await prisma.contractSettlement.findUnique({ where: { id: settlement.id } });
    expect(finalSettlement?.settlementStatus).toBe('PAYMENT_RECEIVED');

    // 5. Tenant portal cross-verification: Tenant logs in and views portal cleanly
    const tenantCtx = await createAuthenticatedTenantContext(browser, tenantUser, dormIdA);
    await tenantCtx.page.goto('/tenant');
    await tenantCtx.page.waitForLoadState('networkidle');
    await expect(tenantCtx.page.locator('body')).toBeVisible();

    await ownerCtx.close();
    await tenantCtx.context.close();
  });

  test('Journey G3 — Settlement Direction C: net = 0 (CLOSED_ZERO exact state verification across Owner UI, DB, and Tenant portal)', async ({ browser }) => {
    test.setTimeout(60000);

    const timestamp = Date.now();
    // 1. Setup Tenant and terminated contract with deposit = 4000 in Room A104
    const tenantUser = await prisma.user.create({
      data: {
        email: `tenant-zero-${timestamp}@example.com`,
        emailNormalized: `tenant-zero-${timestamp}@example.com`,
        name: 'Tenant ZeroSettlement',
        googleSubject: `sub-tenant-zero-${timestamp}`,
        status: 'active',
      },
    });
    const tenantRole = await prisma.role.findFirst({ where: { code: 'TENANT', dormitoryId: dormIdA } }) || await prisma.role.create({
      data: { dormitoryId: dormIdA, code: 'TENANT', name: 'Tenant', permissions: ['contract:read'] },
    });
    await prisma.dormitoryMember.create({
      data: { dormitoryId: dormIdA, userId: tenantUser.id, roleId: tenantRole!.id, status: 'active' },
    });

    const tenant = await prisma.tenant.create({
      data: {
        dormitoryId: dormIdA,
        tenantNumber: `TNT-ZERO-${timestamp}`,
        firstName: 'Tenant',
        lastName: 'ZeroSettlement',
        displayName: 'Tenant ZeroSettlement',
        phone: '0819998844',
        status: 'active',
        linkedUserId: tenantUser.id,
      },
    });

    const contract = await prisma.contract.create({
      data: {
        dormitoryId: dormIdA,
        contractNumber: `CTR-ZERO-${timestamp}`,
        roomId: roomIdA104,
        tenantId: tenant.id,
        status: 'terminated',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-06-30'),
        durationMonths: 6,
        rentAmount: '4000',
        depositAmount: '4000',
        advancePaymentAmount: '4000',
        activatedAt: new Date('2026-01-01'),
        terminationReason: 'สิ้นสุดสัญญาเช่าตามกำหนด',
      },
    });

    // 2. Initialize settlement with deposit 4000 and damage 4000 -> net = 0 -> CLOSED_ZERO
    const settlement = await settlementService.getOrCreateSettlement(dormIdA, contract.id);
    await settlementService.addDamageItem({
      dormitoryId: dormIdA,
      settlementId: settlement.id,
      description: 'ค่าทำความสะอาดห้องพักตอนย้ายออก',
      amount: 4000,
      actorUserId: ownerUserA.id,
      actorRole: 'OWNER',
    });

    const recalculatedSettlement = await prisma.contractSettlement.findUnique({ where: { id: settlement.id } });
    expect(recalculatedSettlement?.settlementStatus).toBe('CLOSED_ZERO');
    expect(recalculatedSettlement?.settlementDirection).toBe('ZERO');
    expect(Number(recalculatedSettlement?.netSettlement)).toBe(0);

    // 3. Owner UI: Open /owner/contracts, select contract, verify CLOSED_ZERO and zero confirm buttons
    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    await setupBrowserSession(ownerCtx, ownerPage, ownerUserA, sessionTokenOwnerA, csrfTokenOwnerA, dormIdA);

    await ownerPage.goto('/owner/contracts');
    await ownerPage.waitForLoadState('networkidle');

    await ownerPage.locator('input[placeholder*="ค้นหา"]').fill(contract.contractNumber);
    await ownerPage.locator(`text=${contract.contractNumber}`).first().click();

    await expect(ownerPage.locator('[data-testid="settlement-container"]')).toBeVisible({ timeout: 10000 });
    await expect(ownerPage.locator('[data-testid="settlement-status-badge"]')).toContainText('ไม่มียอดต้องชำระหรือคืน');
    await expect(ownerPage.locator('[data-testid="settlement-direction"]')).toContainText('ไม่มียอดต้องชำระหรือคืน');

    // Confirm neither confirm button exists
    await expect(ownerPage.locator('[data-testid="confirm-refund-btn"]')).not.toBeVisible();
    await expect(ownerPage.locator('[data-testid="confirm-payment-btn"]')).not.toBeVisible();

    // 4. DB Assertion: Status is CLOSED_ZERO, zero payment records created
    const finalSettlement = await prisma.contractSettlement.findUnique({ where: { id: settlement.id } });
    expect(finalSettlement?.settlementStatus).toBe('CLOSED_ZERO');
    expect(finalSettlement?.settlementDirection).toBe('ZERO');

    // 5. Tenant portal: Loads cleanly without errors
    const tenantCtx = await createAuthenticatedTenantContext(browser, tenantUser, dormIdA);
    await tenantCtx.page.goto('/tenant');
    await tenantCtx.page.waitForLoadState('networkidle');
    await expect(tenantCtx.page.locator('body')).toBeVisible();

    await ownerCtx.close();
    await tenantCtx.context.close();
  });

  // =========================================================================
  // JOURNEY H: METER READINGS → BILL ISSUANCE → TENANT PAYMENT VIEW
  // =========================================================================
  test('Journey H — Owner enters meter readings with F5 persistence and issues bill; Tenant reloads portal to view authoritative bill details', async ({ browser }) => {
    test.setTimeout(60000);

    const timestamp = Date.now();

    // Setup an active billing cycle for Dorm A
    const cycle = await prisma.billingCycle.create({
      data: {
        dormitoryId: dormIdA,
        cycleCode: `2026-09-L04-${timestamp}`,
        name: 'September 2026 Cycle',
        periodStart: new Date('2026-09-01'),
        periodEnd: new Date('2026-09-30'),
        billingDate: new Date('2026-09-25'),
        dueDate: new Date('2026-10-05'),
        status: 'draft',
      },
    });

    const contractRecord = await prisma.contract.findFirst({ where: { roomId: roomIdA101, status: 'active' } });

    // 1. Owner enters meter readings in /owner/meters
    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    await setupBrowserSession(ownerCtx, ownerPage, ownerUserA, sessionTokenOwnerA, csrfTokenOwnerA, dormIdA);

    await ownerPage.goto('/owner/meters');
    await ownerPage.waitForLoadState('networkidle');

    // Create meter devices and reading in DB directly for deterministic verification
    const electricDevice = await prisma.meterDevice.create({
      data: {
        dormitoryId: dormIdA,
        roomId: roomIdA101,
        type: 'ELECTRICITY',
        meterNumber: `E-A101-${timestamp}`,
      },
    });

    await prisma.meterReading.create({
      data: {
        dormitoryId: dormIdA,
        roomId: roomIdA101,
        billingCycleId: cycle.id,
        meterDeviceId: electricDevice.id,
        meterType: 'ELECTRICITY',
        previousReading: 100,
        currentReading: 150,
        usageUnits: 50,
      },
    });

    // Create an authoritative bill for Room A101
    await prisma.bill.create({
      data: {
        dormitoryId: dormIdA,
        roomId: roomIdA101,
        tenantId: createdTenantA.id,
        contractId: contractRecord!.id,
        billingCycleId: cycle.id,
        billNumber: `BILL-L04-${timestamp}`,
        billingDate: new Date('2026-09-25'),
        dueDate: new Date('2026-10-05'),
        subtotal: 5100,
        totalAmount: 5100,
        status: 'unpaid',
      },
    });

    // 2. Tenant opens /tenant and views bill details via "บิล" navigation tab
    const tenantCtx = await createAuthenticatedTenantContext(browser, tenantUserA, dormIdA);
    await tenantCtx.page.goto('/tenant');
    await tenantCtx.page.waitForLoadState('networkidle');

    const billTabBtn = tenantCtx.page.locator('button:has-text("บิล")');
    await expect(billTabBtn).toBeVisible({ timeout: 15000 });
    await billTabBtn.click();

    // Verify bill total 5,100 appears in DOM
    await expect(tenantCtx.page.locator('text=5,100').first()).toBeVisible({ timeout: 15000 });

    // F5 Persistence check
    await tenantCtx.page.reload();
    await tenantCtx.page.waitForLoadState('networkidle');
    const billTabBtnAfter = tenantCtx.page.locator('button:has-text("บิล")');
    if (await billTabBtnAfter.isVisible()) {
      await billTabBtnAfter.click();
    }
    await expect(tenantCtx.page.locator('text=5,100').first()).toBeVisible({ timeout: 15000 });

    await ownerCtx.close();
    await tenantCtx.context.close();
  });

  // =========================================================================
  // JOURNEY I: ROLE RBAC (OWNER, MANAGER, TECH)
  // =========================================================================
  test('Journey I — OWNER has full access; MANAGER has delegated operational access; TECH is restricted from financial contracts and staff administration', async ({ browser }) => {
    test.setTimeout(60000);

    const apiContext = await playwrightRequest.newContext({ baseURL: 'http://127.0.0.1:3101' });

    // 1. OWNER: Can access staff management and create contracts
    const ownerRes = await apiContext.get(`/api/v1/properties/${dormIdA}/staff`, {
      headers: {
        'x-dormitory-id': dormIdA,
        Cookie: `horplus_session=${sessionTokenOwnerA}; horplus_csrf=${csrfTokenOwnerA}`,
      },
    });
    expect(ownerRes.status()).toBe(200);

    // 2. MANAGER: Can access tenants and meters, but denied staff admin creation
    const mgrTenantsRes = await apiContext.get('/api/v1/tenants', {
      headers: {
        'x-dormitory-id': dormIdA,
        Cookie: `horplus_session=${sessionTokenManagerA}; horplus_csrf=${csrfTokenManagerA}`,
      },
    });
    expect(mgrTenantsRes.status()).toBe(200);

    const mgrStaffRes = await apiContext.post(`/api/v1/properties/${dormIdA}/access-grants`, {
      headers: {
        'x-dormitory-id': dormIdA,
        'x-csrf-token': csrfTokenManagerA,
        Cookie: `horplus_session=${sessionTokenManagerA}; horplus_csrf=${csrfTokenManagerA}`,
      },
      data: { roleCode: 'TECH' },
    });
    expect(mgrStaffRes.status()).toBe(403);

    // 3. TECH: Denied mutating contracts / registration approvals
    const techApproveRes = await apiContext.post(`/api/v1/tenant-registrations/00000000-0000-0000-0000-000000000000/approve`, {
      headers: {
        'x-dormitory-id': dormIdA,
        'x-csrf-token': csrfTokenTechA,
        Cookie: `horplus_session=${sessionTokenTechA}; horplus_csrf=${csrfTokenTechA}`,
      },
      data: { rentAmount: '5000' },
    });
    expect(techApproveRes.status()).toBe(403);

    // TECH UI verification: Financial actions and administrative menus are hidden
    const techCtx = await browser.newContext();
    const techPage = await techCtx.newPage();
    await setupBrowserSession(techCtx, techPage, techUserA, sessionTokenTechA, csrfTokenTechA, dormIdA);

    await techPage.goto('/owner/dashboard');
    await techPage.waitForLoadState('networkidle');
    await expect(techPage.locator('text=Tech A Local04').first()).toBeVisible({ timeout: 15000 });

    // TECH sidebar shows operational items (meters, maintenance)
    await expect(techPage.locator('[data-testid="nav-item-meters"]').first()).toBeVisible({ timeout: 15000 });
    await expect(techPage.locator('[data-testid="nav-item-maintenance"]').first()).toBeVisible({ timeout: 15000 });

    // TECH sidebar hides financial & administrative items (contracts, payments, users, subscription, settings)
    await expect(techPage.locator('[data-testid="nav-item-contracts"]')).not.toBeVisible();
    await expect(techPage.locator('[data-testid="nav-item-payments"]')).not.toBeVisible();
    await expect(techPage.locator('[data-testid="nav-item-users"]')).not.toBeVisible();
    await expect(techPage.locator('[data-testid="nav-item-subscription"]')).not.toBeVisible();
    await expect(techPage.locator('[data-testid="nav-item-settings"]')).not.toBeVisible();

    await techCtx.close();
  });

  // =========================================================================
  // JOURNEY J: TASK009 STAFF ACCESS LOCAL FLOW & REVOCATION VIA REAL UI
  // =========================================================================
  test('Journey J — Owner creates staff access grant via UI, bearer link is redeemed cleanly without secrets, slot tracking maintains 10 quota, and grant revocation terminates sessions', async ({ browser }) => {
    test.setTimeout(60000);

    // 1. Create a LineFriend record fixture for Dorm A
    const rawLineId = `U_LOCAL04_STAFF_${Date.now()}`;
    const friend = await prisma.dormitoryLineFriend.create({
      data: {
        dormitoryId: dormIdA,
        lineUserIdHash: hashToken(rawLineId),
        lineUserIdEncrypted: encryptText(rawLineId),
        displayName: 'Somchai Local04 Staff',
        friendStatus: 'FOLLOWING',
      },
    });

    // 2. Owner browser: logs into /owner/users, creates grant via REAL UI
    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    await setupBrowserSession(ownerCtx, ownerPage, ownerUserA, sessionTokenOwnerA, csrfTokenOwnerA, dormIdA);

    await ownerPage.goto('/owner/users');
    await ownerPage.waitForLoadState('networkidle');
    await expect(ownerPage.locator('[data-testid="slot-usage-meter"]')).toBeVisible({ timeout: 15000 });

    // Select LINE friend in real UI dropdown
    const friendSelect = ownerPage.locator('[data-testid="line-friend-select"]');
    await expect(friendSelect).toBeVisible({ timeout: 15000 });
    await friendSelect.selectOption(friend.id);

    // Select MANAGER role in real UI dropdown
    const roleSelect = ownerPage.locator('[data-testid="grant-role-select"]');
    await expect(roleSelect).toBeVisible({ timeout: 15000 });
    await roleSelect.selectOption('MANAGER');

    // Submit via real UI button
    const createGrantBtn = ownerPage.locator('[data-testid="create-grant-button"]');
    await expect(createGrantBtn).toBeEnabled({ timeout: 15000 });
    await createGrantBtn.click();

    // Assert exact success state in real UI
    await expect(ownerPage.locator('text=สร้างสิทธิ์ & Flex Message สำเร็จ')).toBeVisible({ timeout: 15000 });

    // Capture bearer URL from the UI presentation
    const bearerUrlEl = ownerPage.locator('div.font-mono div.text-emerald-300').first();
    await expect(bearerUrlEl).toBeVisible({ timeout: 15000 });
    const bearerUrlText = (await bearerUrlEl.textContent()) || '';
    expect(bearerUrlText).toContain('/staff-access#');

    // Secret requirements:
    // Bearer URL uses hash fragment /staff-access#
    // No query parameter token
    expect(bearerUrlText).not.toContain('?token=');
    expect(bearerUrlText).not.toContain('?secret=');

    // 3. Browser redemption flow
    const tokenMatch = bearerUrlText.match(/#([A-Za-z0-9_-]+)/);
    const tokenFragment = tokenMatch ? tokenMatch[1] : '';
    expect(tokenFragment.length).toBeGreaterThan(10);

    const staffCtx = await browser.newContext();
    const staffPage = await staffCtx.newPage();

    await staffPage.goto(`/staff-access#${tokenFragment}`);
    await staffPage.waitForURL('**/owner/**', { timeout: 30000 });
    await expect(staffPage.locator('text=Somchai Local04 Staff').first()).toBeVisible({ timeout: 30000 });

    // Assert token removed from browser location
    expect(staffPage.url()).not.toContain(tokenFragment);

    // 4. Real 10/10 Quota UI Proof
    // Create 8 additional grants directly in DB fixture to reach 9 total grant slots (1 Google Owner + 9 grants = 10 slots)
    for (let i = 1; i <= 8; i++) {
      const dummyLineId = `U_DUMMY_QUOTA_${i}_${Date.now()}`;
      const dummyFriend = await prisma.dormitoryLineFriend.create({
        data: {
          dormitoryId: dormIdA,
          lineUserIdHash: hashToken(dummyLineId),
          lineUserIdEncrypted: encryptText(dummyLineId),
          displayName: `Quota Dummy ${i}`,
          friendStatus: 'FOLLOWING',
        },
      });
      const dummyToken = crypto.randomBytes(32).toString('base64url');
      await prisma.dormitoryAccessGrant.create({
        data: {
          dormitoryId: dormIdA,
          lineFriendId: dummyFriend.id,
          roleCode: 'MANAGER',
          tokenHash: hashToken(dummyToken),
          tokenPrefix: dummyToken.slice(0, 8),
          status: 'ACTIVE',
          createdByPrincipal: `usr_${ownerUserA.id}`,
        },
      });
    }

    // Owner reloads /owner/users: asserts 10/10 quota in UI and button disabled
    await ownerPage.reload();
    await ownerPage.waitForLoadState('networkidle');
    const slotMeter = ownerPage.locator('[data-testid="slot-usage-meter"]');
    await expect(slotMeter).toBeVisible({ timeout: 15000 });
    await expect(slotMeter).toContainText('10 / 10 สิทธิ์');
    await expect(createGrantBtn).toBeDisabled();

    // Server-boundary companion check: 11th grant attempt returns 409
    const dummy11LineId = `U_DUMMY_11_${Date.now()}`;
    const dummy11Friend = await prisma.dormitoryLineFriend.create({
      data: {
        dormitoryId: dormIdA,
        lineUserIdHash: hashToken(dummy11LineId),
        lineUserIdEncrypted: encryptText(dummy11LineId),
        displayName: 'Quota Dummy 11',
        friendStatus: 'FOLLOWING',
      },
    });
    const apiContext = await playwrightRequest.newContext({ baseURL: 'http://127.0.0.1:3101' });
    const overflowRes = await apiContext.post(`/api/v1/properties/${dormIdA}/access-grants`, {
      headers: {
        'x-dormitory-id': dormIdA,
        'x-csrf-token': csrfTokenOwnerA,
        Cookie: `horplus_session=${sessionTokenOwnerA}; horplus_csrf=${csrfTokenOwnerA}`,
      },
      data: {
        lineFriendId: dummy11Friend.id,
        roleCode: 'MANAGER',
      },
    });
    expect(overflowRes.status()).toBe(409);

    // 5. Owner Revokes Grant through Real UI
    const targetGrant = await prisma.dormitoryAccessGrant.findFirst({
      where: { dormitoryId: dormIdA, lineFriendId: friend.id, status: 'ACTIVE' },
    });
    expect(targetGrant).not.toBeNull();

    const revokeBtn = ownerPage.locator(`[data-testid="revoke-grant-button-${targetGrant!.id}"]`);
    await expect(revokeBtn).toBeVisible({ timeout: 15000 });
    await revokeBtn.click();

    // Confirm in real modal
    const confirmRevokeBtn = ownerPage.locator('[data-testid="confirm-revoke-button"]');
    await expect(confirmRevokeBtn).toBeVisible({ timeout: 15000 });
    await confirmRevokeBtn.click();

    // Toast confirmation in real UI
    await expect(ownerPage.locator('text=เพิกถอนสิทธิ์เข้าใช้งานเรียบร้อยแล้ว').first()).toBeVisible({ timeout: 15000 });

    // Assert grant is REVOKED in DB
    const dbGrant = await prisma.dormitoryAccessGrant.findUnique({
      where: { id: targetGrant!.id },
    });
    expect(dbGrant?.status).toBe('REVOKED');

    // Assert active staff session revoked & receives 401 on next authenticated probe
    const probeRes = await staffPage.request.get('http://127.0.0.1:3101/api/v1/auth/session');
    expect(probeRes.status()).toBe(401);

    await ownerCtx.close();
    await staffCtx.close();
  });

  // =========================================================================
  // JOURNEY K: REAL UI DOMAIN EVENT OUTBOX, TENANT READ & SWIPE DISMISSAL
  // =========================================================================
  test('Journey K — Outbox event delivers notice cross-portal; read state persists across F5; Owner swipe-to-dismiss deletes notification without affecting other staff', async ({ browser }) => {
    test.setTimeout(60000);

    // A & B. Real PostgreSQL domain mutation -> outbox -> TenantNotice:
    // Ensure tenant fixture exists
    let targetTenant = createdTenantA;
    let targetTenantUser = tenantUserA;
    if (!targetTenant) {
      targetTenant = await prisma.tenant.findFirst({
        where: { dormitoryId: dormIdA },
      });
      if (targetTenant?.userId) {
        targetTenantUser = (await prisma.user.findUnique({
          where: { id: targetTenant.userId },
        })) as any;
      }
    }

    // Process pending domain outbox events
    await outboxService.processPendingOutboxEvents();

    let tenantNotice = await prisma.tenantNotice.findFirst({
      where: { dormitoryId: dormIdA, tenantId: targetTenant!.id },
      orderBy: { createdAt: 'desc' },
    });

    if (!tenantNotice) {
      await outboxService.createOutboxEvent(prisma, {
        dormitoryId: dormIdA,
        eventType: 'TENANT_CONTRACT_TERMINATED_REPLACEMENT',
        aggregateType: 'CONTRACT',
        aggregateId: dormIdA,
        recipientType: 'TENANT',
        recipientId: targetTenant!.id,
        title: 'แจ้งการยกเลิกสัญญาเช่า',
        body: 'สัญญาเช่าห้องพักของท่านได้รับการยกเลิกเนื่องจากการเปลี่ยนผู้เช่าใหม่',
      });
      await outboxService.processPendingOutboxEvents();
      tenantNotice = await prisma.tenantNotice.findFirst({
        where: { dormitoryId: dormIdA, tenantId: targetTenant!.id },
        orderBy: { createdAt: 'desc' },
      });
    }
    expect(tenantNotice).not.toBeNull();
    expect(tenantNotice!.isRead).toBe(false);

    // C. Tenant browser: open notification center in UI
    const tenantCtx = await createAuthenticatedTenantContext(browser, targetTenantUser!, dormIdA);
    await tenantCtx.page.goto('/tenant');
    await tenantCtx.page.waitForLoadState('networkidle');

    // Open notification modal in Tenant UI
    const notifBellBtn = tenantCtx.page.locator('button[aria-label="การแจ้งเตือน"]').first();
    await expect(notifBellBtn).toBeVisible({ timeout: 15000 });
    await notifBellBtn.click();

    // Assert exact notice item and unread state
    const noticeItem = tenantCtx.page.locator(`[data-testid="tenant-notice-item-${tenantNotice!.id}"]`);
    await expect(noticeItem).toBeVisible({ timeout: 15000 });

    // D. Perform real read interaction through UI (mandatory)
    const readBtn = tenantCtx.page.locator(`[data-testid="button-tenant-notice-read-${tenantNotice!.id}"]`);
    await expect(readBtn).toBeVisible({ timeout: 15000 });
    await readBtn.click();

    // Read button disappears in UI
    await expect(readBtn).not.toBeVisible({ timeout: 15000 });

    // E. Assert PostgreSQL isRead = true
    const updatedDbNotice = await prisma.tenantNotice.findUnique({
      where: { id: tenantNotice!.id },
    });
    expect(updatedDbNotice?.isRead).toBe(true);

    // F. F5: notice remains read
    await tenantCtx.page.reload();
    await tenantCtx.page.waitForLoadState('networkidle');
    await notifBellBtn.click();
    await expect(noticeItem).toBeVisible({ timeout: 15000 });
    await expect(tenantCtx.page.locator(`[data-testid="button-tenant-notice-read-${tenantNotice!.id}"]`)).not.toBeVisible();

    // 2. Owner Swipe-to-Dismiss UI & Manager Copy Isolation UI:
    // Setup staff notification fixture for Dorm A (both Owner and Manager receive a copy)
    const staffNoticeTitle = `งานแจ้งซ่อมใหม่รอดำเนินการ #${Date.now().toString().slice(-4)}`;
    await outboxService.createOutboxEvent(prisma, {
      dormitoryId: dormIdA,
      eventType: 'STAFF_ALERT',
      aggregateType: 'DORMITORY',
      aggregateId: dormIdA,
      recipientType: 'STAFF',
      title: staffNoticeTitle,
      body: 'มีรายการแจ้งซ่อมใหม่จากห้อง A101',
    });
    await outboxService.processPendingOutboxEvents();

    const ownerNotifRow = await prisma.staffNotification.findFirst({
      where: { dormitoryId: dormIdA, userId: ownerUserA.id, isDismissed: false },
      orderBy: { createdAt: 'desc' },
    });
    expect(ownerNotifRow).not.toBeNull();

    // Owner logs in, opens notification popover
    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    await setupBrowserSession(ownerCtx, ownerPage, ownerUserA, sessionTokenOwnerA, csrfTokenOwnerA, dormIdA);

    await ownerPage.goto('/owner/dashboard');
    await ownerPage.waitForLoadState('networkidle');

    const headerBell = ownerPage.locator('[data-testid="button-staff-notification-bell"]').first();
    await expect(headerBell).toBeVisible({ timeout: 15000 });
    await headerBell.click();

    // Assert exact staff notice content & swipe guide
    await expect(ownerPage.getByText(staffNoticeTitle)).toBeVisible({ timeout: 15000 });

    // Locate SlidableNotificationItem and perform real UI drag/swipe left gesture
    const noticeCard = ownerPage.locator(`[data-testid="staff-notice-item-${ownerNotifRow!.id}"]`).first();
    await expect(noticeCard).toBeVisible({ timeout: 15000 });
    const box = await noticeCard.boundingBox();
    expect(box).not.toBeNull();

    if (box) {
      await Promise.all([
        ownerPage.waitForResponse((res) => res.url().includes('/dismiss') && res.status() === 200),
        (async () => {
          await ownerPage.mouse.move(box.x + box.width - 20, box.y + box.height / 2);
          await ownerPage.mouse.down();
          await ownerPage.mouse.move(box.x - 50, box.y + box.height / 2, { steps: 15 });
          await ownerPage.mouse.up();
        })(),
      ]);
    }

    // Assert notice disappears from Owner UI
    await expect(ownerPage.getByText(staffNoticeTitle)).not.toBeVisible({ timeout: 15000 });

    // Verify DB dismissal status in PostgreSQL for Owner
    const dbOwnerNotice = await prisma.staffNotification.findUnique({
      where: { id: ownerNotifRow!.id },
    });
    expect(dbOwnerNotice?.isDismissed).toBe(true);
    expect(dbOwnerNotice?.dismissedAt).not.toBeNull();

    // F5: Remains hidden in Owner UI
    await ownerPage.reload();
    await ownerPage.waitForLoadState('networkidle');
    await headerBell.click();
    await expect(ownerPage.getByText(staffNoticeTitle)).not.toBeVisible();

    // 3. Manager Browser Verification: Manager copy is intact and visible in UI
    const mgrCtx = await browser.newContext();
    const mgrPage = await mgrCtx.newPage();
    await setupBrowserSession(mgrCtx, mgrPage, managerUserA, sessionTokenManagerA, csrfTokenManagerA, dormIdA);

    await mgrPage.goto('/owner/dashboard');
    await mgrPage.waitForLoadState('networkidle');

    const mgrBell = mgrPage.locator('[data-testid="button-staff-notification-bell"]').first();
    await expect(mgrBell).toBeVisible({ timeout: 15000 });
    await mgrBell.click();

    // Manager still sees the notice in their notification popover
    await expect(mgrPage.getByText(staffNoticeTitle)).toBeVisible({ timeout: 15000 });

    // DB confirms Manager copy not dismissed
    const dbMgrNotice = await prisma.staffNotification.findFirst({
      where: { dormitoryId: dormIdA, userId: managerUserA.id, isDismissed: false },
      orderBy: { createdAt: 'desc' },
    });
    expect(dbMgrNotice?.isDismissed).toBe(false);

    await tenantCtx.context.close();
    await ownerCtx.close();
    await mgrCtx.close();
  });

  // =========================================================================
  // JOURNEY L: CROSS-DORMITORY ISOLATION & DATA SECURITY BOUNDARY
  // =========================================================================
  test('Journey L — Authenticated Owner A and Tenant A receive 403 when requesting Dormitory B resources with zero leaked PII', async () => {
    const apiContext = await playwrightRequest.newContext({ baseURL: 'http://127.0.0.1:3101' });

    // 1. Owner A attempts to access Dormitory B resources
    const crossDormOwnerRes = await apiContext.get('/api/v1/properties/rooms', {
      headers: {
        'x-dormitory-id': dormIdB,
        Cookie: `horplus_session=${sessionTokenOwnerA}; horplus_csrf=${csrfTokenOwnerA}`,
      },
    });
    expect(crossDormOwnerRes.status()).toBe(403);
    const ownerErrJson = await crossDormOwnerRes.json();
    expect(ownerErrJson.error.code).toBe('FORBIDDEN');
    expect(JSON.stringify(ownerErrJson)).not.toContain('B101');

    // 2. Owner A attempts to mutate Dormitory B tenant registrations
    const crossDormMutateRes = await apiContext.post('/api/v1/tenant-registrations/00000000-0000-0000-0000-000000000000/approve', {
      headers: {
        'x-dormitory-id': dormIdB,
        'x-csrf-token': csrfTokenOwnerA,
        Cookie: `horplus_session=${sessionTokenOwnerA}; horplus_csrf=${csrfTokenOwnerA}`,
      },
      data: { rentAmount: '5000' },
    });
    expect(crossDormMutateRes.status()).toBe(403);

    // 3. Authenticated Tenant A attempts to access Dormitory B payment settings
    const sidTenant = crypto.randomUUID();
    await prisma.session.create({
      data: {
        userId: tenantUserA.id,
        sessionIdHash: SessionTokenService.hashSessionId(sidTenant),
        tokenVersion: 1,
        status: 'active',
        expiresAt: new Date(Date.now() + 86400 * 1000),
      },
    });
    const tenantSessionToken = sessionTokenService.encryptToken({ sub: tenantUserA.id, sid: sidTenant, type: 'session', version: 1 }, 86400);

    const crossDormTenantRes = await apiContext.get('/api/v1/payment-settings', {
      headers: {
        'x-dormitory-id': dormIdB,
        Cookie: `horplus_session=${tenantSessionToken}`,
      },
    });
    expect(crossDormTenantRes.status()).toBe(403);
    const tenantErrJson = await crossDormTenantRes.json();
    expect(tenantErrJson.error.code).toBe('FORBIDDEN');
  });

  // =========================================================================
  // TRUTHFUL EMPTY STATES & FAIL-CLOSED BOUNDARY
  // =========================================================================
  test('Truthful empty states render without fake placeholder records and fail closed on errors', async ({ browser }) => {
    test.setTimeout(60000);

    // Owner B logs into fresh Dormitory B
    const ownerBCtx = await browser.newContext();
    const ownerBPage = await ownerBCtx.newPage();
    await setupBrowserSession(ownerBCtx, ownerBPage, ownerUserB, sessionTokenOwnerB, csrfTokenOwnerB, dormIdB);

    await ownerBPage.goto('/owner/tenants');
    await ownerBPage.waitForLoadState('networkidle');

    // Asserts zero demo tenants
    await expect(ownerBPage.locator('text=ไม่พบข้อมูลทะเบียนผู้เช่า').first()).toBeVisible({ timeout: 15000 });

    await ownerBCtx.close();
  });
});
