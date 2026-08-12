import { test, expect, request as playwrightRequest } from '@playwright/test';
import crypto from 'crypto';
import { getPrismaClient } from '../../server/src/db/prisma.js';
import { SessionTokenService } from '../../server/src/services/session-token.service.js';
import { CsrfService } from '../../server/src/services/csrf.service.js';
import { subscriptionEntitlementService } from '../../server/src/services/subscription-entitlement.service.js';

test.describe.serial('LOCAL-01 — Tenant Onboarding & Co-Occupant Management E2E Acceptance Suite', () => {
  const prisma = getPrismaClient();

  let dormIdA: string;
  let ownerIdA: string;
  let roomIdA: string;
  let sessionTokenA: string;
  let csrfTokenA: string;

  let dormIdB: string;
  let ownerIdB: string;
  let sessionTokenB: string;
  let csrfTokenB: string;

  let submittedReqIdA: string;

  test.beforeAll(async () => {
    await subscriptionEntitlementService.ensureSeeded();

    const sessionSecret = process.env.SESSION_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef';
    const csrfSecret = process.env.CSRF_SIGNING_KEY || 'csrf-secret-key-0123456789abcdef';
    const sessionTokenService = new SessionTokenService(sessionSecret);
    const csrfService = new CsrfService(csrfSecret);

    // 1. Provision Owner A & Dormitory A in PostgreSQL
    const emailA = `local01-owner-a-${Date.now()}@example.com`;
    const ownerA = await prisma.user.create({
      data: {
        email: emailA,
        emailNormalized: emailA.toLowerCase(),
        name: 'Owner A Local01',
        googleSubject: `sub-owner-a-${Date.now()}`,
        status: 'active',
      },
    });
    ownerIdA = ownerA.id;

    const dormA = await prisma.dormitory.create({
      data: {
        name: `Dorm A Local01 ${Date.now()}`,
        code: `DMA-L01-${Date.now()}`,
        createdByUserId: ownerA.id,
        status: 'active',
      },
    });
    dormIdA = dormA.id;

    const roleA = await prisma.role.create({
      data: {
        dormitoryId: dormA.id,
        code: 'OWNER',
        name: 'Owner',
        permissions: ['*'],
      },
    });

    await prisma.dormitoryMember.create({
      data: {
        userId: ownerA.id,
        dormitoryId: dormA.id,
        roleId: roleA.id,
        status: 'active',
      },
    });

    const buildingA = await prisma.building.create({
      data: {
        dormitoryId: dormA.id,
        name: 'Building A',
        floorCount: 2,
      },
    });

    const roomA = await prisma.room.create({
      data: {
        dormitoryId: dormA.id,
        buildingId: buildingA.id,
        roomNumber: 'A101',
        normalizedRoomNumber: 'A101',
        floor: 1,
        status: 'vacant',
        monthlyRent: '4500',
      },
    });
    roomIdA = roomA.id;

    // Create session & CSRF for Owner A
    const sidA = crypto.randomUUID();
    const hashA = SessionTokenService.hashSessionId(sidA);
    await prisma.session.create({
      data: {
        userId: ownerA.id,
        sessionIdHash: hashA,
        tokenVersion: 1,
        status: 'active',
        expiresAt: new Date(Date.now() + 86400 * 1000),
      },
    });

    sessionTokenA = sessionTokenService.encryptToken(
      { sub: ownerA.id, sid: sidA, type: 'session', version: 1 },
      86400
    );
    csrfTokenA = csrfService.generateCsrfToken(sidA);

    // 2. Provision Owner B & Dormitory B in PostgreSQL
    const emailB = `local01-owner-b-${Date.now()}@example.com`;
    const ownerB = await prisma.user.create({
      data: {
        email: emailB,
        emailNormalized: emailB.toLowerCase(),
        name: 'Owner B Local01',
        googleSubject: `sub-owner-b-${Date.now()}`,
        status: 'active',
      },
    });
    ownerIdB = ownerB.id;

    const dormB = await prisma.dormitory.create({
      data: {
        name: `Dorm B Local01 ${Date.now()}`,
        code: `DMB-L01-${Date.now()}`,
        createdByUserId: ownerB.id,
        status: 'active',
      },
    });
    dormIdB = dormB.id;

    const roleB = await prisma.role.create({
      data: {
        dormitoryId: dormB.id,
        code: 'OWNER',
        name: 'Owner',
        permissions: ['*'],
      },
    });

    await prisma.dormitoryMember.create({
      data: {
        userId: ownerB.id,
        dormitoryId: dormB.id,
        roleId: roleB.id,
        status: 'active',
      },
    });

    const sidB = crypto.randomUUID();
    const hashB = SessionTokenService.hashSessionId(sidB);
    await prisma.session.create({
      data: {
        userId: ownerB.id,
        sessionIdHash: hashB,
        tokenVersion: 1,
        status: 'active',
        expiresAt: new Date(Date.now() + 86400 * 1000),
      },
    });

    sessionTokenB = sessionTokenService.encryptToken(
      { sub: ownerB.id, sid: sidB, type: 'session', version: 1 },
      86400
    );
    csrfTokenB = csrfService.generateCsrfToken(sidB);

    // Sync entitlements
    await subscriptionEntitlementService.provisionInitialTrial(dormA.id);
    await subscriptionEntitlementService.provisionInitialTrial(dormB.id);
  });

  test('Flow A — Tenant Local Registration Submission & Persistence', async ({ page }) => {
    test.setTimeout(60000);

    await page.context().addInitScript((dId) => {
      localStorage.setItem('selected_dormitory_id', dId);
    }, dormIdA);

    await page.goto('/tenant/register');
    await page.waitForLoadState('networkidle');

    // Fill form
    await page.fill('input[placeholder="สมชาย"]', 'Somchai');
    await page.fill('input[placeholder="ใจดี"]', 'RegistrationTest');
    await page.fill('input[placeholder="0812345678"]', '0819998888');

    // Submit
    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeEnabled({ timeout: 30000 });
    await submitBtn.click();
    await page.waitForSelector('text=ส่งคำขอลงทะเบียนเรียบร้อยแล้ว');

    // Query PostgreSQL to verify persistent registration request
    const persisted = await prisma.tenantRegistrationRequest.findFirst({
      where: {
        dormitoryId: dormIdA,
        phone: '0819998888',
      },
    });

    expect(persisted).not.toBeNull();
    expect(persisted?.status).toBe('pending_owner_approval');
    expect(persisted?.firstName).toBe('Somchai');
    submittedReqIdA = persisted!.id;

    // Reload (F5) and verify server truth
    await page.reload();
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('/tenant/register');
  });

  test('Flow B — Owner Registration Approval & Rejection Workflow', async ({ page, context }) => {
    // Set Owner A cookies
    await context.addCookies([
      { name: 'horplus_session', value: sessionTokenA, domain: '127.0.0.1', path: '/' },
      { name: 'horplus_csrf', value: csrfTokenA, domain: '127.0.0.1', path: '/' },
    ]);

    await page.goto('/owner/tenants');
    await page.evaluate((dId) => {
      localStorage.setItem('selected_dormitory_id', dId);
    }, dormIdA);

    await page.goto('/owner/tenants');
    await page.waitForLoadState('networkidle');

    // Open Registration Requests modal
    await page.click('button:has-text("คำขอลงทะเบียน")');
    await page.waitForSelector('text=รายการคำขอลงทะเบียนจองห้องพัก');

    // Approve the pending request
    await page.click('button:has-text("อนุมัติและทำสัญญา")');
    await page.waitForSelector('text=กำหนดข้อตกลงสัญญาและอนุมัติผู้เช่า');
    await page.click('button:has-text("ยืนยันการอนุมัติ")');

    // Verify DB update
    const updatedReq = await prisma.tenantRegistrationRequest.findUnique({
      where: { id: submittedReqIdA },
    });
    expect(updatedReq?.status).toBe('approved');
    expect(updatedReq?.approvedTenantId).not.toBeNull();

    // Verify Tenant & Contract created in PostgreSQL
    const createdTenant = await prisma.tenant.findUnique({
      where: { id: updatedReq!.approvedTenantId! },
    });
    expect(createdTenant).not.toBeNull();
    expect(createdTenant?.firstName).toBe('Somchai');

    // Now test Rejection with Thai reason
    // Submit second registration request directly via API
    const apiContext = await playwrightRequest.newContext({ baseURL: 'http://127.0.0.1:3000' });
    const createRes = await apiContext.post('/api/v1/tenant-registrations', {
      headers: { 'x-dormitory-id': dormIdA },
      data: {
        requestedRoomId: roomIdA,
        firstName: 'RejectedApplicant',
        lastName: 'ThaiReasonTest',
        phone: '0897776666',
        note: 'Testing rejection',
      },
    });
    expect(createRes.status()).toBe(201);
    const reqToReject = (await createRes.json()).data;

    // Owner rejects request with Thai reason
    const rejectRes = await apiContext.post(`/api/v1/tenant-registrations/${reqToReject.id}/reject`, {
      headers: {
        'x-dormitory-id': dormIdA,
        'x-csrf-token': csrfTokenA,
        Cookie: `horplus_session=${sessionTokenA}; horplus_csrf=${csrfTokenA}`,
      },
      data: {
        reason: 'ห้องพักไม่ว่างสำหรับผู้เช่าท่านนี้',
      },
    });
    expect(rejectRes.status()).toBe(200);

    const rejectedInDb = await prisma.tenantRegistrationRequest.findUnique({
      where: { id: reqToReject.id },
    });
    expect(rejectedInDb?.status).toBe('rejected');
    expect(rejectedInDb?.rejectedReason).toBe('ห้องพักไม่ว่างสำหรับผู้เช่าท่านนี้');
  });

  test('Flow C — Approval Conflict on Occupied Room (409 Conflict)', async () => {
    // Mark room A as occupied
    await prisma.room.update({
      where: { id: roomIdA },
      data: { status: 'occupied' },
    });

    // Create pending request for room A
    const pendingReq = await prisma.tenantRegistrationRequest.create({
      data: {
        dormitoryId: dormIdA,
        requestedRoomId: roomIdA,
        firstName: 'ConflictTest',
        lastName: 'Applicant',
        phone: '0823334444',
        status: 'pending_owner_approval',
      },
    });

    // Attempt approving occupied room -> Expect 409 Conflict
    const apiContext = await playwrightRequest.newContext({ baseURL: 'http://127.0.0.1:3000' });
    const approveRes = await apiContext.post(`/api/v1/tenant-registrations/${pendingReq.id}/approve`, {
      headers: {
        'x-dormitory-id': dormIdA,
        'x-csrf-token': csrfTokenA,
        Cookie: `horplus_session=${sessionTokenA}; horplus_csrf=${csrfTokenA}`,
      },
      data: {
        createContract: false,
      },
    });

    expect(approveRes.status()).toBe(409);
    const body = await approveRes.json();
    expect(body.error.code).toBe('ROOM_ALREADY_OCCUPIED');
  });

  test('Flow D — Co-Occupants Management (Add & Remove)', async () => {
    // Re-set room status to vacant for testing
    await prisma.room.update({
      where: { id: roomIdA },
      data: { status: 'vacant' },
    });

    // Create active tenant
    const tenant = await prisma.tenant.create({
      data: {
        dormitoryId: dormIdA,
        tenantNumber: `TNT-E2E-${Date.now()}`,
        firstName: 'CoOccupantOwnerTest',
        lastName: 'MainTenant',
        displayName: 'CoOccupantOwnerTest MainTenant',
        phone: '0855554444',
        status: 'active',
      },
    });

    // Add Co-Occupant via API
    const apiContext = await playwrightRequest.newContext({ baseURL: 'http://127.0.0.1:3000' });
    const addCoRes = await apiContext.post(`/api/v1/tenants/${tenant.id}/co-occupants`, {
      headers: {
        'x-dormitory-id': dormIdA,
        'x-csrf-token': csrfTokenA,
        Cookie: `horplus_session=${sessionTokenA}; horplus_csrf=${csrfTokenA}`,
      },
      data: {
        name: 'Somหญิง CoOccupant',
        phone: '0891112222',
        relationship: 'Sister',
      },
    });

    expect(addCoRes.status()).toBe(201);
    const coData = (await addCoRes.json()).data;
    expect(coData.id).toBeDefined();

    // Verify DB
    const coInDb = await prisma.tenantCoOccupant.findFirst({
      where: { id: coData.id, dormitoryId: dormIdA },
    });
    expect(coInDb?.name).toBe('Somหญิง CoOccupant');
    expect(coInDb?.status).toBe('active');

    // Soft-remove co-occupant
    const removeCoRes = await apiContext.delete(`/api/v1/tenants/${tenant.id}/co-occupants/${coData.id}`, {
      headers: {
        'x-dormitory-id': dormIdA,
        'x-csrf-token': csrfTokenA,
        Cookie: `horplus_session=${sessionTokenA}; horplus_csrf=${csrfTokenA}`,
      },
    });

    expect(removeCoRes.status()).toBe(200);

    // Verify historical audit preservation (status: 'removed', deletedAt is set)
    const removedInDb = await prisma.tenantCoOccupant.findFirst({
      where: { id: coData.id, dormitoryId: dormIdA },
    });
    expect(removedInDb?.status).toBe('removed');
    expect(removedInDb?.deletedAt).not.toBeNull();
  });

  test('Flow E — Cross-Dormitory Isolation Security Verification', async () => {
    // Create tenant in Dorm A
    const tenantA = await prisma.tenant.create({
      data: {
        dormitoryId: dormIdA,
        tenantNumber: `TNT-ISOLATION-${Date.now()}`,
        firstName: 'IsolatedTenant',
        lastName: 'DormA',
        displayName: 'IsolatedTenant DormA',
        phone: '0877778888',
        status: 'active',
      },
    });

    const coA = await prisma.tenantCoOccupant.create({
      data: {
        dormitoryId: dormIdA,
        tenantId: tenantA.id,
        name: 'CoOccupant DormA',
        status: 'active',
      },
    });

    // Owner B attempts mutating Dorm A's co-occupant using Dorm B header & session -> Must fail (404/403)
    const apiContext = await playwrightRequest.newContext({ baseURL: 'http://127.0.0.1:3000' });
    const crossMutateRes = await apiContext.delete(`/api/v1/tenants/${tenantA.id}/co-occupants/${coA.id}`, {
      headers: {
        'x-dormitory-id': dormIdB,
        'x-csrf-token': csrfTokenB,
        Cookie: `horplus_session=${sessionTokenB}; horplus_csrf=${csrfTokenB}`,
      },
    });

    expect([403, 404]).toContain(crossMutateRes.status());
  });
});
