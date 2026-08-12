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
  let roomIdA2: string;
  let sessionTokenA: string;
  let csrfTokenA: string;

  let dormIdB: string;
  let ownerIdB: string;
  let sessionTokenB: string;
  let csrfTokenB: string;

  let reqIdApplicantA: string;
  let reqIdApplicantB: string;

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

    const roomA2 = await prisma.room.create({
      data: {
        dormitoryId: dormA.id,
        buildingId: buildingA.id,
        roomNumber: 'A102',
        normalizedRoomNumber: 'A102',
        floor: 1,
        status: 'vacant',
        monthlyRent: '4800',
      },
    });
    roomIdA2 = roomA2.id;

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

  test('Flow A — Multiple Applicants Same Room Submission & Persistence', async ({ page }) => {
    test.setTimeout(60000);

    await page.addInitScript((dId) => {
      localStorage.setItem('selected_dormitory_id', dId);
    }, dormIdA);

    // 1. Applicant A submits for Room A101
    await page.goto('/tenant/register');
    await page.waitForLoadState('networkidle');

    const roomSelect = page.locator('select');
    const roomInput = page.locator('input[placeholder*="ระบุรหัสห้องพัก"]');
    if (await roomSelect.isVisible()) {
      await roomSelect.selectOption(roomIdA);
    } else if (await roomInput.isVisible()) {
      await roomInput.fill(roomIdA);
    }

    await page.fill('input[placeholder="สมชาย"]', 'ApplicantA');
    await page.fill('input[placeholder="ใจดี"]', 'FirstSub');
    await page.fill('input[placeholder="0812345678"]', '0811110001');

    const submitBtn1 = page.locator('button[type="submit"]');
    await expect(submitBtn1).toBeEnabled({ timeout: 30000 });
    await submitBtn1.click();
    await page.waitForSelector('text=ส่งคำขอลงทะเบียนเรียบร้อยแล้ว');

    const persistedA = await prisma.tenantRegistrationRequest.findFirst({
      where: { dormitoryId: dormIdA, phone: '0811110001' },
    });
    expect(persistedA).not.toBeNull();
    expect(persistedA?.status).toBe('pending_owner_approval');
    reqIdApplicantA = persistedA!.id;

    // 2. Applicant B ALSO submits for same Room A101 (Multiple pending applicants allowed)
    await page.goto('/tenant/register');
    await page.waitForLoadState('networkidle');

    if (await roomSelect.isVisible()) {
      await roomSelect.selectOption(roomIdA);
    } else if (await roomInput.isVisible()) {
      await roomInput.fill(roomIdA);
    }

    await page.fill('input[placeholder="สมชาย"]', 'ApplicantB');
    await page.fill('input[placeholder="ใจดี"]', 'SecondSub');
    await page.fill('input[placeholder="0812345678"]', '0811110002');

    const submitBtn2 = page.locator('button[type="submit"]');
    await expect(submitBtn2).toBeEnabled({ timeout: 30000 });
    await submitBtn2.click();
    await page.waitForSelector('text=ส่งคำขอลงทะเบียนเรียบร้อยแล้ว');

    const persistedB = await prisma.tenantRegistrationRequest.findFirst({
      where: { dormitoryId: dormIdA, phone: '0811110002' },
    });
    expect(persistedB).not.toBeNull();
    expect(persistedB?.status).toBe('pending_owner_approval');
    reqIdApplicantB = persistedB!.id;

    // Verify both pending requests exist for Room A101
    const pendingCount = await prisma.tenantRegistrationRequest.count({
      where: { dormitoryId: dormIdA, requestedRoomId: roomIdA, status: 'pending_owner_approval' },
    });
    expect(pendingCount).toBe(2);
  });

  test('Flow B — Owner Selects & Approves Applicant B (Leaves Applicant A Pending)', async ({ page, context }) => {
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
    await page.waitForSelector('text=รายการคำขอลงทะเบียนสมัครเช่าห้องพัก');

    // Approve Applicant B
    const cardB = page.locator('div').filter({ hasText: 'ApplicantB SecondSub' }).first();
    await cardB.locator('button:has-text("อนุมัติและทำสัญญา")').click();
    await page.waitForSelector('text=กำหนดข้อตกลงสัญญาและอนุมัติผู้เช่า');
    await page.click('button:has-text("ยืนยันการอนุมัติ")');

    // Verify DB: B approved, Room A101 occupied by B, Occupancy ACTIVE created
    const updatedReqB = await prisma.tenantRegistrationRequest.findUnique({
      where: { id: reqIdApplicantB },
    });
    expect(updatedReqB?.status).toBe('approved');
    expect(updatedReqB?.approvedTenantId).not.toBeNull();

    const roomA = await prisma.room.findUnique({ where: { id: roomIdA } });
    expect(roomA?.status).toBe('occupied');
    expect(roomA?.currentTenantId).toBe(updatedReqB!.approvedTenantId!);

    const occupancyB = await prisma.occupancy.findFirst({
      where: {
        dormitoryId: dormIdA,
        roomId: roomIdA,
        tenantId: updatedReqB!.approvedTenantId!,
        status: 'ACTIVE',
      },
    });
    expect(occupancyB).not.toBeNull();

    // Verify Applicant A remains pending in PostgreSQL (NOT auto-rejected)
    const reqA = await prisma.tenantRegistrationRequest.findUnique({
      where: { id: reqIdApplicantA },
    });
    expect(reqA?.status).toBe('pending_owner_approval');
  });

  test('Flow C — Occupied Room Approval Block (409 Conflict)', async () => {
    const apiContext = await playwrightRequest.newContext({ baseURL: 'http://127.0.0.1:3000' });

    // Attempt approving Applicant A into occupied Room A101 -> Backend must refuse with 409
    const approveRes = await apiContext.post(`/api/v1/tenant-registrations/${reqIdApplicantA}/approve`, {
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

    // Applicant A remains pending
    const reqA = await prisma.tenantRegistrationRequest.findUnique({ where: { id: reqIdApplicantA } });
    expect(reqA?.status).toBe('pending_owner_approval');
  });

  test('Flow D — Room Reassignment & Subsequent Approval', async () => {
    const apiContext = await playwrightRequest.newContext({ baseURL: 'http://127.0.0.1:3000' });

    // Reassign Applicant A from Room A101 -> Room A102
    const reassignRes = await apiContext.patch(`/api/v1/tenant-registrations/${reqIdApplicantA}`, {
      headers: {
        'x-dormitory-id': dormIdA,
        'x-csrf-token': csrfTokenA,
        Cookie: `horplus_session=${sessionTokenA}; horplus_csrf=${csrfTokenA}`,
      },
      data: {
        requestedRoomId: roomIdA2,
      },
    });
    expect(reassignRes.status()).toBe(200);

    // Verify change persisted in PostgreSQL
    const reqAAfterReassign = await prisma.tenantRegistrationRequest.findUnique({ where: { id: reqIdApplicantA } });
    expect(reqAAfterReassign?.requestedRoomId).toBe(roomIdA2);

    // Approve Applicant A for Room A102
    const approveA = await apiContext.post(`/api/v1/tenant-registrations/${reqIdApplicantA}/approve`, {
      headers: {
        'x-dormitory-id': dormIdA,
        'x-csrf-token': csrfTokenA,
        Cookie: `horplus_session=${sessionTokenA}; horplus_csrf=${csrfTokenA}`,
      },
      data: {
        createContract: true,
        startDate: '2026-09-01',
        endDate: '2027-08-31',
        durationMonths: 12,
        rentAmount: 4800,
        depositAmount: 4800,
        advancePaymentAmount: 4800,
      },
    });
    expect(approveA.status()).toBe(200);

    const approvedA = await prisma.tenantRegistrationRequest.findUnique({ where: { id: reqIdApplicantA } });
    expect(approvedA?.status).toBe('approved');
    expect(approvedA?.approvedRoomId).toBe(roomIdA2);
  });

  test('Flow E — Co-Occupant Ownership Binding Security Verification', async () => {
    // Create Tenant A and Tenant B in same Dorm A
    const tenantA = await prisma.tenant.create({
      data: {
        dormitoryId: dormIdA,
        tenantNumber: `TNT-BIND-A-${Date.now()}`,
        firstName: 'TenantAlpha',
        lastName: 'DormA',
        displayName: 'TenantAlpha DormA',
        phone: '0891111111',
        status: 'active',
      },
    });

    const tenantB = await prisma.tenant.create({
      data: {
        dormitoryId: dormIdA,
        tenantNumber: `TNT-BIND-B-${Date.now()}`,
        firstName: 'TenantBeta',
        lastName: 'DormA',
        displayName: 'TenantBeta DormA',
        phone: '0892222222',
        status: 'active',
      },
    });

    const coB = await prisma.tenantCoOccupant.create({
      data: {
        dormitoryId: dormIdA,
        tenantId: tenantB.id,
        name: 'CoOccupant B1',
        status: 'active',
      },
    });

    const apiContext = await playwrightRequest.newContext({ baseURL: 'http://127.0.0.1:3000' });

    // Tenant A route attempting to mutate Tenant B's co-occupant -> Must fail (404)
    const attackUpdate = await apiContext.put(`/api/v1/tenants/${tenantA.id}/co-occupants/${coB.id}`, {
      headers: {
        'x-dormitory-id': dormIdA,
        'x-csrf-token': csrfTokenA,
        Cookie: `horplus_session=${sessionTokenA}; horplus_csrf=${csrfTokenA}`,
      },
      data: { name: 'Hacked CoOccupant B1' },
    });
    expect(attackUpdate.status()).toBe(404);

    const attackDelete = await apiContext.delete(`/api/v1/tenants/${tenantA.id}/co-occupants/${coB.id}`, {
      headers: {
        'x-dormitory-id': dormIdA,
        'x-csrf-token': csrfTokenA,
        Cookie: `horplus_session=${sessionTokenA}; horplus_csrf=${csrfTokenA}`,
      },
    });
    expect(attackDelete.status()).toBe(404);
  });

  test('Flow F — Inactive Tenant Co-Occupant Mutation Verification', async () => {
    // Create inactive tenant without active contract or active occupancy
    const inactiveTenant = await prisma.tenant.create({
      data: {
        dormitoryId: dormIdA,
        tenantNumber: `TNT-INACTIVE-${Date.now()}`,
        firstName: 'InactiveTenant',
        lastName: 'DormA',
        displayName: 'InactiveTenant DormA',
        phone: '0893333333',
        status: 'archived',
      },
    });

    const apiContext = await playwrightRequest.newContext({ baseURL: 'http://127.0.0.1:3000' });

    const mutateRes = await apiContext.post(`/api/v1/tenants/${inactiveTenant.id}/co-occupants`, {
      headers: {
        'x-dormitory-id': dormIdA,
        'x-csrf-token': csrfTokenA,
        Cookie: `horplus_session=${sessionTokenA}; horplus_csrf=${csrfTokenA}`,
      },
      data: { name: 'New CoOccupant For Inactive' },
    });

    expect(mutateRes.status()).toBe(403);
    const body = await mutateRes.json();
    expect(body.error.code).toBe('NO_ACTIVE_TENANCY');
  });
});
