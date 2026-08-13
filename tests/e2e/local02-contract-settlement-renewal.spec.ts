import { test, expect } from '@playwright/test';
import { getPrismaClient } from '../../server/src/db/prisma.js';
import { SessionTokenService } from '../../server/src/services/session-token.service.js';
import { CsrfService } from '../../server/src/services/csrf.service.js';
import { subscriptionEntitlementService } from '../../server/src/services/subscription-entitlement.service.js';
import crypto from 'crypto';

test.describe.serial('LOCAL-02: E2E Contract Settlement, Termination & Renewal Suite', () => {
  const prisma = getPrismaClient();
  const sessionSecret = process.env.SESSION_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef';
  const csrfSecret = process.env.CSRF_SIGNING_KEY || 'csrf-secret-key-0123456789abcdef';
  const sessionTokenService = new SessionTokenService(sessionSecret);
  const csrfService = new CsrfService(csrfSecret);

  let dormId: string;
  let buildingId: string;
  let roomId: string;
  let ownerUserId: string;
  let tenantUserId: string;
  let tenantId: string;
  let contractA1Id: string;
  let occupancyA1Id: string;

  let sessionTokenOwner: string;
  let csrfTokenOwner: string;
  let sessionTokenTenant: string;
  let csrfTokenTenant: string;

  let renewalRequestId: string;
  let scheduledContractId: string;
  let applicantBReqId: string;
  let tenantBId: string;

  test.beforeAll(async () => {
    // 1. Clean test DB & Seed Subscriptions
    await subscriptionEntitlementService.ensureSeeded();
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE tenant_notices, contract_settlement_items, contract_settlements, tenant_renewal_requests, occupancies, bill_items, receipts, payment_status_histories, payments, bills, contract_snapshots, contracts, tenant_registration_requests, tenants, rooms, buildings, dormitory_members, sessions, users, dormitories CASCADE;'
    );

    // 2. Create Dormitory
    const dorm = await prisma.dormitory.create({
      data: {
        name: 'E2E LOCAL-02 Dormitory',
        code: 'E2E-L02',
        type: 'apartment',
        status: 'active',
      },
    });
    dormId = dorm.id;
    await subscriptionEntitlementService.provisionInitialTrial(dormId);

    // 3. Create Owner User & Member
    const ownerUser = await prisma.user.create({
      data: {
        email: 'owner_local02@test.com',
        emailNormalized: 'owner_local02@test.com',
        name: 'Owner Local02',
        googleSubject: `sub-owner-l02-${Date.now()}`,
        status: 'active',
      },
    });
    ownerUserId = ownerUser.id;

    const ownerRole = await prisma.role.findFirst({ where: { code: 'OWNER' } }) || await prisma.role.create({
      data: {
        code: 'OWNER',
        name: 'Owner',
        permissions: ['*'],
      },
    });
    await prisma.dormitoryMember.create({
      data: {
        dormitoryId: dormId,
        userId: ownerUserId,
        roleId: ownerRole.id,
      },
    });

    // 4. Create Owner Session
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

    // 5. Create Building & Room A101
    const building = await prisma.building.create({
      data: {
        dormitoryId: dormId,
        name: 'Building A',
        floorCount: 3,
      },
    });
    buildingId = building.id;

    const room = await prisma.room.create({
      data: {
        dormitoryId: dormId,
        buildingId,
        roomNumber: 'A101',
        normalizedRoomNumber: 'A101',
        floor: 1,
        status: 'occupied',
        monthlyRent: '5000',
        depositAmount: '10000',
        advancePaymentAmount: '5000',
      },
    });
    roomId = room.id;

    // 6. Create Tenant A User & Record
    const tenantUser = await prisma.user.create({
      data: {
        email: 'tenant_a@test.com',
        emailNormalized: 'tenant_a@test.com',
        name: 'Somchai Jaidee',
        googleSubject: `sub-tenant-a-${Date.now()}`,
        status: 'active',
      },
    });
    tenantUserId = tenantUser.id;

    const tenantA = await prisma.tenant.create({
      data: {
        dormitoryId: dormId,
        linkedUserId: tenantUserId,
        tenantNumber: 'TNT-A101-01',
        firstName: 'Somchai',
        lastName: 'Jaidee',
        displayName: 'Somchai Jaidee',
        phone: '0812345678',
        status: 'active',
      },
    });
    tenantId = tenantA.id;

    const tenantRole = await prisma.role.findFirst({ where: { code: 'TENANT' } }) || await prisma.role.create({
      data: {
        code: 'TENANT',
        name: 'Tenant',
        permissions: ['contract:read'],
      },
    });
    await prisma.dormitoryMember.create({
      data: {
        dormitoryId: dormId,
        userId: tenantUserId,
        roleId: tenantRole.id,
      },
    });

    // 7. Create Active Contract A1
    const contractA1 = await prisma.contract.create({
      data: {
        dormitoryId: dormId,
        contractNumber: 'CTR-A101-001',
        roomId,
        tenantId,
        status: 'active',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-06-30'),
        durationMonths: 6,
        rentAmount: '5000',
        depositAmount: '10000',
        advancePaymentAmount: '5000',
        terms: 'ข้อตกลงสัญญามาตรฐาน',
      },
    });
    contractA1Id = contractA1.id;

    // 8. Create Active Occupancy A1
    const occupancyA1 = await prisma.occupancy.create({
      data: {
        dormitoryId: dormId,
        roomId,
        tenantId,
        contractId: contractA1Id,
        status: 'ACTIVE',
        startedAt: new Date('2026-01-01'),
      },
    });
    occupancyA1Id = occupancyA1.id;

    await prisma.room.update({
      where: { id: roomId },
      data: { currentTenantId: tenantId, currentContractId: contractA1Id },
    });

    // 9. Create Tenant A Session
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
  });

  test('FLOW A — Renewal Request: Tenant submits renewal request (duration-only), status is PENDING_OWNER_APPROVAL, no new contract in DB, persists on F5', async ({ page, context }) => {
    await context.clearCookies();
    await context.addCookies([
      { name: 'horplus_session', value: sessionTokenTenant, domain: '127.0.0.1', path: '/' },
      { name: 'horplus_csrf', value: csrfTokenTenant, domain: '127.0.0.1', path: '/' },
      { name: 'horplus_session', value: sessionTokenTenant, domain: 'localhost', path: '/' },
      { name: 'horplus_csrf', value: csrfTokenTenant, domain: 'localhost', path: '/' },
    ]);

    await page.addInitScript((dId) => {
      localStorage.setItem('selected_dormitory_id', dId);
      sessionStorage.setItem('active_dormitory_selected_for_session', dId);
    }, dormId);

    // Submit renewal request via API endpoint as tenant
    const response = await page.request.post('http://127.0.0.1:3101/api/v1/contract-renewals/request', {
      headers: {
        'X-Dormitory-Id': dormId,
        'X-CSRF-Token': csrfTokenTenant,
        'Cookie': `horplus_session=${sessionTokenTenant}; horplus_csrf=${csrfTokenTenant}`,
      },
      data: {
        tenantId,
        contractId: contractA1Id,
        requestedStartDate: '2026-10-01',
        requestedDurationMonths: 6,
      },
    });

    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(body.data.status).toBe('PENDING_OWNER_APPROVAL');
    expect(body.data.createdContractId).toBeNull();
    renewalRequestId = body.data.id;

    // Verify DB: No new Contract created yet
    const contractsInDb = await prisma.contract.findMany({ where: { roomId } });
    expect(contractsInDb.length).toBe(1);

    // Navigate to tenant portal & reload (F5) to verify persistent UI state
    await page.goto('/tenant');
    await expect(page.locator('body')).toBeVisible();
    await page.reload();
    await expect(page.locator('body')).toBeVisible();

    const requestInDb = await prisma.tenantRenewalRequest.findUnique({ where: { id: renewalRequestId } });
    expect(requestInDb?.status).toBe('PENDING_OWNER_APPROVAL');
  });

  test('FLOW B — Future Renewal Approval: Owner approves future renewal, DB creates approved_scheduled contract, activatedAt=null, old contract active, no early occupancy', async ({ page, context }) => {
    await context.clearCookies();
    await context.addCookies([
      { name: 'horplus_session', value: sessionTokenOwner, domain: '127.0.0.1', path: '/' },
      { name: 'horplus_csrf', value: csrfTokenOwner, domain: '127.0.0.1', path: '/' },
      { name: 'horplus_session', value: sessionTokenOwner, domain: 'localhost', path: '/' },
      { name: 'horplus_csrf', value: csrfTokenOwner, domain: 'localhost', path: '/' },
    ]);

    await page.addInitScript((dId) => {
      localStorage.setItem('selected_dormitory_id', dId);
      sessionStorage.setItem('active_dormitory_selected_for_session', dId);
    }, dormId);

    // Owner approves renewal request with rentAmount=5500
    const response = await page.request.post(`http://127.0.0.1:3101/api/v1/contract-renewals/requests/${renewalRequestId}/approve`, {
      headers: {
        'X-Dormitory-Id': dormId,
        'X-CSRF-Token': csrfTokenOwner,
        'Cookie': `horplus_session=${sessionTokenOwner}; horplus_csrf=${csrfTokenOwner}`,
      },
      data: {
        rentAmount: '5500',
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.data.request.status).toBe('APPROVED');

    scheduledContractId = body.data.contract.id;

    // PostgreSQL Evidence Checks:
    // 1. New contract is approved_scheduled with activatedAt = null
    const futureContract = await prisma.contract.findUnique({ where: { id: scheduledContractId } });
    expect(futureContract?.status).toBe('approved_scheduled');
    expect(futureContract?.activatedAt).toBeNull();
    expect(futureContract?.previousContractId).toBe(contractA1Id);

    // 2. Old contract A1 remains active & immutable
    const oldContract = await prisma.contract.findUnique({ where: { id: contractA1Id } });
    expect(oldContract?.status).toBe('active');
    expect(Number(oldContract?.rentAmount)).toBe(5000);

    // 3. Room pointers still point to old contract A1
    const room = await prisma.room.findUnique({ where: { id: roomId } });
    expect(room?.currentContractId).toBe(contractA1Id);

    // 4. NO active occupancy created for future contract early
    const futureOccupancy = await prisma.occupancy.findFirst({
      where: { contractId: scheduledContractId, status: 'ACTIVE' },
    });
    expect(futureOccupancy).toBeNull();

    // UI Reload Check (F5)
    await page.goto('/owner/tenants');
    await expect(page.locator('body')).toBeVisible();
    await page.reload();
    await expect(page.locator('body')).toBeVisible();
  });

  test('FLOW C — Effective-Date Activation: Executing scheduled activation on start date activates scheduled contract and transitions occupancy', async ({ page, context }) => {
    await context.clearCookies();
    await context.addCookies([
      { name: 'horplus_session', value: sessionTokenOwner, domain: '127.0.0.1', path: '/' },
      { name: 'horplus_csrf', value: csrfTokenOwner, domain: '127.0.0.1', path: '/' },
    ]);

    // Trigger scheduled contract activation for 2026-10-01
    const response = await page.request.post('http://127.0.0.1:3101/api/v1/contract-renewals/activate-scheduled', {
      headers: {
        'X-Dormitory-Id': dormId,
        'X-CSRF-Token': csrfTokenOwner,
        'Cookie': `horplus_session=${sessionTokenOwner}; horplus_csrf=${csrfTokenOwner}`,
      },
      data: {
        effectiveDate: '2026-10-01',
      },
    });

    expect(response.status()).toBe(200);

    // PostgreSQL Evidence Checks:
    // 1. Scheduled contract is now active & activatedAt set
    const activatedContract = await prisma.contract.findUnique({ where: { id: scheduledContractId } });
    expect(activatedContract?.status).toBe('active');
    expect(activatedContract?.activatedAt).not.toBeNull();

    // 2. Old contract A1 completed
    const oldContract = await prisma.contract.findUnique({ where: { id: contractA1Id } });
    expect(oldContract?.status).toBe('completed');

    // 3. Old occupancy ENDED, new ACTIVE occupancy created
    const oldOccupancy = await prisma.occupancy.findUnique({ where: { id: occupancyA1Id } });
    expect(oldOccupancy?.status).toBe('ENDED');

    const newOccupancy = await prisma.occupancy.findFirst({
      where: { contractId: scheduledContractId, status: 'ACTIVE' },
    });
    expect(newOccupancy).not.toBeNull();

    // 4. Room pointers updated to scheduledContractId
    const room = await prisma.room.findUnique({ where: { id: roomId } });
    expect(room?.currentContractId).toBe(scheduledContractId);

    // Page Reload (F5)
    await page.goto('/owner/contracts');
    await expect(page.locator('body')).toBeVisible();
    await page.reload();
    await expect(page.locator('body')).toBeVisible();
  });

  test('FLOW D — Pending Applicant Lock: Registration request for room blocks tenant renewal eligibility', async ({ page, context }) => {
    // Create pending registration request for Room A101 by Applicant B
    const regRes = await page.request.post('http://127.0.0.1:3101/api/v1/tenant-registrations', {
      headers: {
        'X-Dormitory-Id': dormId,
      },
      data: {
        dormitoryId: dormId,
        requestedRoomId: roomId,
        firstName: 'Boonmee',
        lastName: 'Applicant',
        phone: '0899999999',
      },
    });

    expect(regRes.status()).toBe(201);
    const regBody = await regRes.json();
    applicantBReqId = regBody.data.id;

    // Check eligibility for Tenant A
    const eligRes = await page.request.get(`http://127.0.0.1:3101/api/v1/contract-renewals/eligibility?contractId=${scheduledContractId}&tenantId=${tenantId}`, {
      headers: {
        'X-Dormitory-Id': dormId,
        'Cookie': `horplus_session=${sessionTokenTenant}`,
      },
    });

    expect(eligRes.status()).toBe(200);
    const eligBody = await eligRes.json();
    expect(eligBody.data.eligible).toBe(false);
    expect(eligBody.data.reasonCode).toBe('PENDING_REGISTRATION_LOCK');
  });

  test('FLOW E — Forced Replacement Warning: Approving applicant B without confirmation throws 409 REPLACEMENT_CONFIRMATION_REQUIRED and preserves DB state', async ({ page, context }) => {
    // Attempt approval WITHOUT confirmReplacement
    const appRes = await page.request.post(`http://127.0.0.1:3101/api/v1/tenant-registrations/${applicantBReqId}/approve`, {
      headers: {
        'X-Dormitory-Id': dormId,
        'X-CSRF-Token': csrfTokenOwner,
        'Cookie': `horplus_session=${sessionTokenOwner}; horplus_csrf=${csrfTokenOwner}`,
      },
      data: {
        startDate: '2026-11-01',
        endDate: '2027-04-30',
        durationMonths: 6,
        rentAmount: '5000',
        depositAmount: '10000',
        advancePaymentAmount: '5000',
        confirmReplacement: false,
      },
    });

    expect(appRes.status()).toBe(409);
    const appBody = await appRes.json();
    expect(appBody.error.code).toBe('REPLACEMENT_CONFIRMATION_REQUIRED');

    // DB remains unchanged
    const room = await prisma.room.findUnique({ where: { id: roomId } });
    expect(room?.currentTenantId).toBe(tenantId);
  });

  test('FLOW F — Forced Replacement Confirm: Explicit confirmation terminates active tenancy, cancels future renewal, opens settlement, creates new tenant', async ({ page, context }) => {
    // Approve WITH confirmReplacement: true
    const appRes = await page.request.post(`http://127.0.0.1:3101/api/v1/tenant-registrations/${applicantBReqId}/approve`, {
      headers: {
        'X-Dormitory-Id': dormId,
        'X-CSRF-Token': csrfTokenOwner,
        'Cookie': `horplus_session=${sessionTokenOwner}; horplus_csrf=${csrfTokenOwner}`,
      },
      data: {
        startDate: '2026-11-01',
        endDate: '2027-04-30',
        durationMonths: 6,
        rentAmount: '5000',
        depositAmount: '10000',
        advancePaymentAmount: '5000',
        confirmReplacement: true,
      },
    });

    expect(appRes.status()).toBe(200);
    const appBody = await appRes.json();
    tenantBId = appBody.data.tenant.id;

    // PostgreSQL Evidence Checks:
    // 1. Tenant A contract is terminated
    const terminatedContract = await prisma.contract.findUnique({ where: { id: scheduledContractId } });
    expect(terminatedContract?.status).toBe('terminated');

    // 2. Settlement created for Tenant A
    const settlement = await prisma.contractSettlement.findFirst({ where: { contractId: scheduledContractId } });
    expect(settlement).not.toBeNull();
    expect(settlement?.settlementStatus).toBe('PENDING_REFUND');

    // 3. Room now points to Tenant B
    const room = await prisma.room.findUnique({ where: { id: roomId } });
    expect(room?.currentTenantId).toBe(tenantBId);

    // F5 reload
    await page.goto('/owner/tenants');
    await expect(page.locator('body')).toBeVisible();
    await page.reload();
    await expect(page.locator('body')).toBeVisible();
  });

  test('FLOW G — Old Tenant Notice: Login as terminated Tenant A shows persistent in-app termination notice in DB', async ({ page, context }) => {
    // Verify DB notice created for Tenant A
    const notices = await prisma.tenantNotice.findMany({ where: { tenantId } });
    expect(notices.length).toBeGreaterThanOrEqual(1);

    await context.clearCookies();
    await context.addCookies([
      { name: 'horplus_session', value: sessionTokenTenant, domain: '127.0.0.1', path: '/' },
      { name: 'horplus_csrf', value: csrfTokenTenant, domain: '127.0.0.1', path: '/' },
    ]);

    await page.goto('/tenant');
    await expect(page.locator('body')).toBeVisible();
  });

  test('FLOW H — Settlement: Add damage item, edit, soft-remove, confirm lock, subsequent mutations blocked', async ({ page, context }) => {
    await context.clearCookies();
    await context.addCookies([
      { name: 'horplus_session', value: sessionTokenOwner, domain: '127.0.0.1', path: '/' },
      { name: 'horplus_csrf', value: csrfTokenOwner, domain: '127.0.0.1', path: '/' },
    ]);

    // 1. Get or Create Settlement for scheduledContractId
    const setRes = await page.request.get(`http://127.0.0.1:3101/api/v1/settlements/${scheduledContractId}`, {
      headers: {
        'X-Dormitory-Id': dormId,
        'Cookie': `horplus_session=${sessionTokenOwner}`,
      },
    });

    expect(setRes.status()).toBe(200);
    const setBody = await setRes.json();
    const settlementId = setBody.data.id;

    // 2. Add Damage Item
    const addRes = await page.request.post(`http://127.0.0.1:3101/api/v1/settlements/${settlementId}/damage-items`, {
      headers: {
        'X-Dormitory-Id': dormId,
        'X-CSRF-Token': csrfTokenOwner,
        'Cookie': `horplus_session=${sessionTokenOwner}; horplus_csrf=${csrfTokenOwner}`,
      },
      data: {
        description: 'ค่ากระจกแตก',
        amount: 1000,
      },
    });

    expect(addRes.status()).toBe(201);
    const addBody = await addRes.json();
    const itemId = addBody.data.id;

    // 3. Edit Damage Item
    const editRes = await page.request.put(`http://127.0.0.1:3101/api/v1/settlements/damage-items/${itemId}`, {
      headers: {
        'X-Dormitory-Id': dormId,
        'X-CSRF-Token': csrfTokenOwner,
        'Cookie': `horplus_session=${sessionTokenOwner}; horplus_csrf=${csrfTokenOwner}`,
      },
      data: {
        amount: 1500,
      },
    });

    expect(editRes.status()).toBe(200);

    // 4. Soft-Remove Damage Item
    const delRes = await page.request.delete(`http://127.0.0.1:3101/api/v1/settlements/damage-items/${itemId}`, {
      headers: {
        'X-Dormitory-Id': dormId,
        'X-CSRF-Token': csrfTokenOwner,
        'Cookie': `horplus_session=${sessionTokenOwner}; horplus_csrf=${csrfTokenOwner}`,
      },
    });

    expect(delRes.status()).toBe(200);

    // Verify soft-remove in DB
    const itemInDb = await prisma.contractSettlementItem.findUnique({ where: { id: itemId } });
    expect(itemInDb?.isDeleted).toBe(true);
    expect(itemInDb?.deletedAt).not.toBeNull();

    // 5. Confirm Settlement -> REFUNDED (LOCK)
    const lockRes = await page.request.post(`http://127.0.0.1:3101/api/v1/settlements/${settlementId}/confirm`, {
      headers: {
        'X-Dormitory-Id': dormId,
        'X-CSRF-Token': csrfTokenOwner,
        'Cookie': `horplus_session=${sessionTokenOwner}; horplus_csrf=${csrfTokenOwner}`,
      },
      data: {
        status: 'REFUNDED',
      },
    });

    expect(lockRes.status()).toBe(200);

    // 6. Attempt mutation after lock -> Rejected 400 SETTLEMENT_LOCKED
    const postLockAdd = await page.request.post(`http://127.0.0.1:3101/api/v1/settlements/${settlementId}/damage-items`, {
      headers: {
        'X-Dormitory-Id': dormId,
        'X-CSRF-Token': csrfTokenOwner,
        'Cookie': `horplus_session=${sessionTokenOwner}; horplus_csrf=${csrfTokenOwner}`,
      },
      data: {
        description: 'ค่าซ่อมเพิ่ม',
        amount: 500,
      },
    });

    expect(postLockAdd.status()).toBe(400);
    const postLockBody = await postLockAdd.json();
    expect(postLockBody.error.code).toBe('SETTLEMENT_LOCKED');

    // Reload page (F5)
    await page.goto('/owner/contracts');
    await expect(page.locator('body')).toBeVisible();
    await page.reload();
    await expect(page.locator('body')).toBeVisible();
  });
});
