import { describe, it, expect, beforeEach } from 'vitest';
import { getPrismaClient } from '../src/db/prisma.js';
import { contractRenewalService } from '../src/services/contract-renewal.service.js';
import { settlementService } from '../src/services/settlement.service.js';
import { tenantRegistrationService } from '../src/services/tenant-registration.service.js';
import { subscriptionEntitlementService } from '../src/services/subscription-entitlement.service.js';
import { PNG } from 'pngjs';
import { Prisma } from '@prisma/client';

function createDummySignature(): string {
  const pngObj = new PNG({ width: 10, height: 10 });
  for (let i = 0; i < 100; i++) {
    const idx = i * 4;
    pngObj.data[idx] = 100;
    pngObj.data[idx + 1] = 100;
    pngObj.data[idx + 2] = 200;
    pngObj.data[idx + 3] = 255;
  }
  return `data:image/png;base64,${PNG.sync.write(pngObj).toString('base64')}`;
}

describe('LOCAL-02: Contract Settlement, Termination & Renewal Suite', () => {
  const prisma = getPrismaClient();

  const mockOwnerUserId = '11111111-1111-1111-1111-111111111111';
  const mockTechUserId = '22222222-2222-2222-2222-222222222222';

  let testDormitoryId: string;
  let testBuildingId: string;
  let testRoomA101Id: string;
  let testTenantAId: string;
  let testContractAId: string;
  let testOccupancyAId: string;

  beforeEach(async () => {
    const tablesToClean = [
      'payment_upload_intents',
      'payment_status_histories',
      'receipts',
      'receipt_sequences',
      'payments',
      'combined_payment_groups',
      'bill_items',
      'bill_status_histories',
      'bills',
      'contract_settlement_items',
      'contract_settlements',
      'tenant_renewal_requests',
      'tenant_move_out_requests',
      'contract_snapshots',
      'contract_status_histories',
      'contracts',
      'occupancies',
      'tenant_vehicles',
      'tenant_emergency_contacts',
      'tenant_co_occupants',
      'tenant_registration_requests',
      'tenants',
      'meter_replacements',
      'meter_readings',
      'meter_devices',
      'room_next_cycle_corrections',
      'room_billing_cycle_snapshots',
      'rooms',
      'buildings',
      'billing_rate_snapshots',
      'billing_cycles',
      'local_notification_outbox',
      'staff_notices',
      'tenant_notices',
      'dormitory_access_grants',
      'dormitory_line_friends',
      'dormitory_line_configs',
      'line_webhook_event_receipts',
      'line_push_delivery_attempts',
      'line_push_usage',
      'owner_signatures',
      'promo_redemptions',
      'account_benefit_claims',
      'subscription_status_histories',
      'dormitory_subscriptions',
      'subscription_package_intents',
      'dormitory_billing_settings',
      'dormitory_property_defaults',
      'dormitory_members',
      'onboarding_drafts',
      'audit_logs',
      'dormitories',
      'sessions',
      'users'
    ];
    for (const tbl of tablesToClean) {
      await prisma.$executeRawUnsafe(`DELETE FROM "${tbl}";`);
    }

    // 1. Create Test Dormitory
    const dorm = await prisma.dormitory.create({
      data: {
        name: 'HorPlus Test Dormitory LOCAL-02',
        code: 'HPLUS-L02',
        type: 'apartment',
        status: 'active',
      },
    });
    testDormitoryId = dorm.id;
    await subscriptionEntitlementService.provisionInitialTrial(testDormitoryId);
    await prisma.dormitoryPropertyDefaults.upsert({
      where: { dormitoryId: testDormitoryId },
      create: { dormitoryId: testDormitoryId, version: 1, defaultTerms: 'Default Terms', petPolicy: { allowed: 'none', allowedTypes: [] } },
      update: {},
    });

    // 2. Create Test Building & Room A101
    const building = await prisma.building.create({
      data: {
        dormitoryId: testDormitoryId,
        name: 'Building A',
        floorCount: 3,
      },
    });
    testBuildingId = building.id;

    const roomA101 = await prisma.room.create({
      data: {
        dormitoryId: testDormitoryId,
        buildingId: testBuildingId,
        roomNumber: 'A101',
        normalizedRoomNumber: 'A101',
        roomType: 'STANDARD',
        floor: 1,
        status: 'occupied',
        monthlyRent: new Prisma.Decimal(5000),
        depositAmount: new Prisma.Decimal(10000),
        advancePaymentAmount: new Prisma.Decimal(5000),
      },
    });
    testRoomA101Id = roomA101.id;

    // 3. Create Tenant A
    const tenantA = await prisma.tenant.create({
      data: {
        dormitoryId: testDormitoryId,
        tenantNumber: 'TNT-A101-01',
        firstName: 'Somchai',
        lastName: 'Jaidee',
        displayName: 'Somchai Jaidee',
        phone: '0812345678',
        status: 'active',
      },
    });
    testTenantAId = tenantA.id;

    // 4. Create Active Contract A
    const contractA = await prisma.contract.create({
      data: {
        dormitoryId: testDormitoryId,
        contractNumber: 'CTR-A101-001',
        roomId: testRoomA101Id,
        tenantId: testTenantAId,
        status: 'active',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-06-30'),
        durationMonths: 6,
        rentAmount: new Prisma.Decimal(5000),
        depositAmount: new Prisma.Decimal(10000),
        advancePaymentAmount: new Prisma.Decimal(5000),
        terms: 'ข้อตกลงสัญญามาตรฐาน',
      },
    });
    testContractAId = contractA.id;

    // 5. Create Active Occupancy A
    const occupancyA = await prisma.occupancy.create({
      data: {
        dormitoryId: testDormitoryId,
        roomId: testRoomA101Id,
        tenantId: testTenantAId,
        contractId: testContractAId,
        status: 'ACTIVE',
        startedAt: new Date('2026-01-01'),
      },
    });
    testOccupancyAId = occupancyA.id;

    // Link Room to current contract/tenant
    await prisma.room.update({
      where: { id: testRoomA101Id },
      data: {
        currentTenantId: testTenantAId,
        currentContractId: testContractAId,
      },
    });
  });

  // Assertion 1 & 2: Tenant Renewal Request (Duration controls only, money derived & immutable)
  it('1. Tenant submits renewal request specifying duration; client financial inputs are rejected/derived from prior contract', async () => {
    // Attempt financial tampering (Rule 20)
    await expect(
      contractRenewalService.submitRenewalRequest({
        dormitoryId: testDormitoryId,
        tenantId: testTenantAId,
        contractId: testContractAId,
        requestedStartDate: '2026-07-01',
        requestedDurationMonths: 6,
        rentAmount: 1, // Tampered field
      } as any)
    ).rejects.toThrow();

    // Valid submission (duration only)
    const request = await contractRenewalService.submitRenewalRequest({
      dormitoryId: testDormitoryId,
      tenantId: testTenantAId,
      contractId: testContractAId,
      requestedStartDate: '2026-07-01',
      requestedDurationMonths: 6,
    });

    expect(request.status).toBe('PENDING_OWNER_APPROVAL');
    expect(request.requestedDurationMonths).toBe(6);
    expect(request.createdContractId).toBeNull(); // Does NOT create contract early!
  });

  // Assertion 3 & 4: Renewal request does NOT create contract early; Owner approval creates new linked immutable contract
  it('2. Renewal request remains PENDING_OWNER_APPROVAL until Owner approves, creating linked contract with previousContractId', async () => {
    const req = await contractRenewalService.submitRenewalRequest({
      dormitoryId: testDormitoryId,
      tenantId: testTenantAId,
      contractId: testContractAId,
      requestedStartDate: '2026-07-01',
      requestedDurationMonths: 6,
    });

    // Check old contract unchanged before approval
    const oldContractBefore = await prisma.contract.findUnique({ where: { id: testContractAId } });
    expect(oldContractBefore?.endDate.toISOString().split('T')[0]).toBe('2026-06-30');

    // Owner approves with optional adjusted rent (5500)
    const approved = await contractRenewalService.approveRenewalRequest({
      dormitoryId: testDormitoryId,
      requestId: req.id,
      rentAmount: '5500.00',
      actorUserId: mockOwnerUserId,
      actorRole: 'OWNER',
    });

    expect(approved.request.status).toBe('APPROVED');
    expect(approved.contract.previousContractId).toBe(testContractAId);
    expect(Number(approved.contract.rentAmount)).toBe(5500);

    // Old contract agreed dates & terms MUST remain IMMUTABLE!
    const oldContractAfter = await prisma.contract.findUnique({ where: { id: testContractAId } });
    expect(oldContractAfter?.endDate.toISOString().split('T')[0]).toBe('2026-06-30');
    expect(Number(oldContractAfter?.rentAmount)).toBe(5000);
  });

  // Assertion 5: Former tenant gap renewal after contract expiry
  it('3. Former tenant can submit renewal request after contract expiry + gap if room remains free', async () => {
    // Set old contract & occupancy to expired/ended
    await prisma.contract.update({
      where: { id: testContractAId },
      data: { status: 'expired' },
    });
    await prisma.occupancy.update({
      where: { id: testOccupancyAId },
      data: { status: 'ENDED', endedAt: new Date('2026-06-30') },
    });
    await prisma.room.update({
      where: { id: testRoomA101Id },
      data: { status: 'vacant', currentTenantId: null, currentContractId: null },
    });

    // Eligibility check
    const eligibility = await contractRenewalService.getRenewalEligibility(testDormitoryId, testTenantAId, testContractAId);
    expect(eligibility.eligible).toBe(true);

    // Submit renewal after 2 months gap
    const req = await contractRenewalService.submitRenewalRequest({
      dormitoryId: testDormitoryId,
      tenantId: testTenantAId,
      contractId: testContractAId,
      requestedStartDate: '2026-09-01',
      requestedDurationMonths: 6,
    });

    expect(req.status).toBe('PENDING_OWNER_APPROVAL');
  });

  // Assertion 6: Pending registration application blocks renewal request
  it('4. Any pending registration request for the room blocks renewal eligibility', async () => {
    // Create pending registration for Room A101 by Applicant B
    await prisma.tenantRegistrationRequest.create({
      data: {
        dormitoryId: testDormitoryId,
        requestedRoomId: testRoomA101Id,
        firstName: 'Somsri',
        lastName: 'Dee',
        phone: '0899999999',
        status: 'pending_owner_approval',
      },
    });

    const eligibility = await contractRenewalService.getRenewalEligibility(testDormitoryId, testTenantAId, testContractAId);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reasonCode).toBe('PENDING_REGISTRATION_LOCK');

    await expect(
      contractRenewalService.submitRenewalRequest({
        dormitoryId: testDormitoryId,
        tenantId: testTenantAId,
        contractId: testContractAId,
        requestedStartDate: '2026-07-01',
        requestedDurationMonths: 6,
      })
    ).rejects.toThrow();
  });

  // Assertion 7 & 8: Immediate Owner-Forced Replacement Termination
  it('5. Approving new applicant requires confirmation, terminates active tenancy immediately without rent proration, opens settlement, and notifies old tenant', async () => {
    // FIRST create pending renewal request for Tenant A (while room is still free of registration applications)
    const renewalA = await contractRenewalService.submitRenewalRequest({
      dormitoryId: testDormitoryId,
      tenantId: testTenantAId,
      contractId: testContractAId,
      requestedStartDate: '2026-07-01',
      requestedDurationMonths: 6,
    });

    // THEN create pending registration for Applicant B
    const regB = await prisma.tenantRegistrationRequest.create({
      data: {
        dormitoryId: testDormitoryId,
        requestedRoomId: testRoomA101Id,
        firstName: 'Applicant',
        lastName: 'B',
        phone: '0888888888',
        status: 'pending_owner_approval',
      },
    });

    // Approval WITHOUT confirmReplacement fails with 409 REPLACEMENT_CONFIRMATION_REQUIRED
    await expect(
      tenantRegistrationService.approveRequest(regB.id, testDormitoryId, {
        startDate: '2026-07-01',
        endDate: '2026-12-31',
        durationMonths: 6,
        rentAmount: '5000',
        depositAmount: '10000',
        advancePaymentAmount: '5000',
        confirmReplacement: false,
      })
    ).rejects.toThrow();

    // Approval WITH confirmReplacement: true executes atomic replacement
    const approved = await tenantRegistrationService.approveRequest(
      regB.id,
      testDormitoryId,
      {
        startDate: '2026-07-01',
        endDate: '2026-12-31',
        durationMonths: 6,
        rentAmount: '5000',
        depositAmount: '10000',
        advancePaymentAmount: '5000',
        confirmReplacement: true,
      },
      mockOwnerUserId
    );

    expect(approved.tenant.firstName).toBe('Applicant');

    // Verify Tenant A old contract terminated & original dates unchanged
    const oldContract = await prisma.contract.findUnique({ where: { id: testContractAId } });
    expect(oldContract?.status).toBe('terminated');
    expect(oldContract?.endDate.toISOString().split('T')[0]).toBe('2026-06-30'); // Original agreed date unchanged!

    // Verify Tenant A old occupancy closed
    const oldOccupancy = await prisma.occupancy.findUnique({ where: { id: testOccupancyAId } });
    expect(oldOccupancy?.status).toBe('ENDED');

    // Verify Tenant A pending renewal request CANCELLED
    const updatedRenewalA = await prisma.tenantRenewalRequest.findUnique({ where: { id: renewalA.id } });
    expect(updatedRenewalA?.status).toBe('CANCELLED');

    // Verify Settlement opened for Tenant A (Net = Deposit 10,000 - Unpaid 0 = 10,000 -> PENDING_REFUND)
    const settlementA = await settlementService.getOrCreateSettlement(testDormitoryId, testContractAId);
    expect(settlementA.netSettlement.toString()).toBe('10000');
    expect(settlementA.settlementStatus).toBe('PENDING_REFUND');

    // Verify persistent in-app notice created for Tenant A
    const notices = await prisma.tenantNotice.findMany({
      where: { dormitoryId: testDormitoryId, tenantId: testTenantAId },
    });
    expect(notices.length).toBe(1);
    expect(notices[0].type).toBe('FORCED_TERMINATION');
    expect(notices[0].message).toContain('สัญญาเช่าห้อง A101 ของคุณถูกยุติโดยผู้ดูแลหอพัก');
  });

  // Assertion 10 & 18 & 19: Damage item soft-remove and settlement lock
  it('6. Damage items support mandatory description/amount, optional evidence, soft-remove, and settlement lock after confirmation', async () => {
    const settlement = await settlementService.getOrCreateSettlement(testDormitoryId, testContractAId);

    // Add damage item without evidence
    const item1 = await settlementService.addDamageItem({
      dormitoryId: testDormitoryId,
      settlementId: settlement.id,
      description: 'ลูกบิดประตูชำรุด',
      amount: 500,
      actorUserId: mockOwnerUserId,
      actorRole: 'OWNER',
    });
    expect(item1.description).toBe('ลูกบิดประตูชำรุด');
    expect(item1.evidenceUrl).toBeNull();

    // Add damage item with optional evidence
    const item2 = await settlementService.addDamageItem({
      dormitoryId: testDormitoryId,
      settlementId: settlement.id,
      description: 'กระจกแตก',
      amount: 1500,
      evidenceUrl: 'https://example.com/broken-glass.jpg',
      actorUserId: mockOwnerUserId,
      actorRole: 'OWNER',
    });
    expect(item2.evidenceUrl).toBe('https://example.com/broken-glass.jpg');

    // Check recalculated net settlement: 10,000 deposit - 2,000 damage = 8,000 -> PENDING_REFUND
    const updatedSettlement = await settlementService.getOrCreateSettlement(testDormitoryId, testContractAId);
    expect(updatedSettlement.damageChargeTotal.toString()).toBe('2000');
    expect(updatedSettlement.netSettlement.toString()).toBe('8000');

    // Soft-remove item1 (HARD DELETE IS FORBIDDEN)
    await settlementService.softRemoveDamageItem(testDormitoryId, item1.id, mockOwnerUserId, 'OWNER');
    const item1Db = await prisma.contractSettlementItem.findUnique({ where: { id: item1.id } });
    expect(item1Db?.isDeleted).toBe(true);
    expect(item1Db?.deletedAt).not.toBeNull();

    // Recalculated net: 10,000 - 1,500 = 8,500
    const recalculateDb = await settlementService.getOrCreateSettlement(testDormitoryId, testContractAId);
    expect(recalculateDb.netSettlement.toString()).toBe('8500');

    // Confirm settlement status -> REFUNDED (LOCKS settlement!)
    await settlementService.confirmSettlementStatus(testDormitoryId, settlement.id, 'REFUNDED', mockOwnerUserId, 'OWNER');

    // Attempting to add damage item after lock MUST fail with SETTLEMENT_LOCKED
    await expect(
      settlementService.addDamageItem({
        dormitoryId: testDormitoryId,
        settlementId: settlement.id,
        description: 'ค่าทำความสะอาดเพิ่ม',
        amount: 300,
        actorUserId: mockOwnerUserId,
        actorRole: 'OWNER',
      })
    ).rejects.toThrow();
  });

  // Assertion 20: Role RBAC (TECH role cannot approve renewals or mutate settlements)
  it('7. TECH role is forbidden from approving renewals or mutating settlements', async () => {
    const req = await contractRenewalService.submitRenewalRequest({
      dormitoryId: testDormitoryId,
      tenantId: testTenantAId,
      contractId: testContractAId,
      requestedStartDate: '2026-07-01',
      requestedDurationMonths: 6,
    });

    // TECH role approval attempt MUST be rejected
    await expect(
      contractRenewalService.approveRenewalRequest({
        dormitoryId: testDormitoryId,
        requestId: req.id,
        actorUserId: mockTechUserId,
        actorRole: 'TECH',
      })
    ).rejects.toThrow();

    const settlement = await settlementService.getOrCreateSettlement(testDormitoryId, testContractAId);

    // TECH role damage item add attempt MUST be rejected
    await expect(
      settlementService.addDamageItem({
        dormitoryId: testDormitoryId,
        settlementId: settlement.id,
        description: 'ค่าทำความสะอาด',
        amount: 300,
        actorUserId: mockTechUserId,
        actorRole: 'TECH',
      })
    ).rejects.toThrow();
  });

  // Assertion 18 & 19: Real Concurrency — Competing applicant approvals produce exactly ONE winner
  it('8. Real Concurrency: Competing applicant approvals for the same room produce exactly ONE winner under PostgreSQL transaction lock', async () => {
    const reg1 = await prisma.tenantRegistrationRequest.create({
      data: {
        dormitoryId: testDormitoryId,
        requestedRoomId: testRoomA101Id,
        firstName: 'Competitor',
        lastName: 'One',
        phone: '0811111111',
        status: 'pending_owner_approval',
      },
    });

    const reg2 = await prisma.tenantRegistrationRequest.create({
      data: {
        dormitoryId: testDormitoryId,
        requestedRoomId: testRoomA101Id,
        firstName: 'Competitor',
        lastName: 'Two',
        phone: '0822222222',
        status: 'pending_owner_approval',
      },
    });

    // Make room vacant first to test competing initial claims
    await prisma.occupancy.update({ where: { id: testOccupancyAId }, data: { status: 'ENDED' } });
    await prisma.room.update({ where: { id: testRoomA101Id }, data: { status: 'vacant', currentTenantId: null, currentContractId: null } });

    const payload = {
      startDate: '2026-07-01',
      endDate: '2026-12-31',
      durationMonths: 6,
      rentAmount: '5000',
      depositAmount: '10000',
      advancePaymentAmount: '5000',
      confirmReplacement: false,
    };

    const results = await Promise.allSettled([
      tenantRegistrationService.approveRequest(reg1.id, testDormitoryId, payload, mockOwnerUserId),
      tenantRegistrationService.approveRequest(reg2.id, testDormitoryId, payload, mockOwnerUserId),
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    // Verify room has exactly ONE active contract & occupancy
    const activeOccupancies = await prisma.occupancy.findMany({
      where: { roomId: testRoomA101Id, status: 'ACTIVE' },
    });
    expect(activeOccupancies.length).toBe(1);

    const roomDb = await prisma.room.findUnique({ where: { id: testRoomA101Id } });
    expect(roomDb?.status).toBe('occupied');
    expect(roomDb?.currentTenantId).not.toBeNull();
  });

  // Assertion 17: Real Concurrency — Concurrent renewal approval vs applicant approval produces exactly ONE winner
  it('9. Real Concurrency: Concurrent renewal approval vs replacement applicant approval produces exactly ONE winner', async () => {
    const renewalA = await contractRenewalService.submitRenewalRequest({
      dormitoryId: testDormitoryId,
      tenantId: testTenantAId,
      contractId: testContractAId,
      requestedStartDate: '2026-07-01',
      requestedDurationMonths: 6,
    });

    const regB = await prisma.tenantRegistrationRequest.create({
      data: {
        dormitoryId: testDormitoryId,
        requestedRoomId: testRoomA101Id,
        firstName: 'Applicant',
        lastName: 'B',
        phone: '0833333333',
        status: 'pending_owner_approval',
      },
    });

    const results = await Promise.allSettled([
      contractRenewalService.approveRenewalRequest({
        dormitoryId: testDormitoryId,
        requestId: renewalA.id,
        rentAmount: '5000',
        actorUserId: mockOwnerUserId,
        actorRole: 'OWNER',
      }),
      tenantRegistrationService.approveRequest(
        regB.id,
        testDormitoryId,
        {
          startDate: '2026-07-01',
          endDate: '2026-12-31',
          durationMonths: 6,
          rentAmount: '5000',
          depositAmount: '10000',
          advancePaymentAmount: '5000',
          confirmReplacement: true,
        },
        mockOwnerUserId
      ),
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    // Exactly one active contract exists for Room A101
    const activeContracts = await prisma.contract.findMany({
      where: { roomId: testRoomA101Id, status: 'active' },
    });
    expect(activeContracts.length).toBe(1);
  });

  // Assertion 15: Atomic Rollback Proof
  it('10. Atomic Rollback: Simulated midpoint error during forced replacement rolls back ALL database mutations', async () => {
    const regB = await prisma.tenantRegistrationRequest.create({
      data: {
        dormitoryId: testDormitoryId,
        requestedRoomId: testRoomA101Id,
        firstName: 'Rollback',
        lastName: 'Applicant',
        phone: '0844444444',
        status: 'pending_owner_approval',
      },
    });

    // Artificially sabotage requestedRoomId in DB to an invalid non-existent room ID to trigger FK violation inside transaction
    await prisma.tenantRegistrationRequest.update({
      where: { id: regB.id },
      data: { requestedRoomId: '00000000-0000-0000-0000-000000000000' },
    });

    await expect(
      tenantRegistrationService.approveRequest(
        regB.id,
        testDormitoryId,
        {
          startDate: '2026-07-01',
          endDate: '2026-12-31',
          durationMonths: 6,
          rentAmount: '5000',
          depositAmount: '10000',
          advancePaymentAmount: '5000',
          confirmReplacement: true,
        },
        mockOwnerUserId
      )
    ).rejects.toThrow();

    // Verify Tenant A remains active with active occupancy intact
    const tenantA = await prisma.tenant.findUnique({ where: { id: testTenantAId } });
    expect(tenantA?.status).toBe('active');

    const occupancyA = await prisma.occupancy.findUnique({ where: { id: testOccupancyAId } });
    expect(occupancyA?.status).toBe('ACTIVE');

    const contractA = await prisma.contract.findUnique({ where: { id: testContractAId } });
    expect(contractA?.status).toBe('active');
  });

  // Assertion 14: Decimal Settlement Formula & Direction Proofs
  it('11. Decimal Settlement Formula: Calculates Net = Deposit - Unpaid - Damage, setting correct direction and status', async () => {
    // Case 1: Deposit 10,000 - Damage 500 = Net 9,500 (REFUND / PENDING_REFUND)
    const settlement1 = await settlementService.getOrCreateSettlement(testDormitoryId, testContractAId);
    await settlementService.addDamageItem({
      dormitoryId: testDormitoryId,
      settlementId: settlement1.id,
      description: 'ค่าซ่อมผนัง',
      amount: 500,
      actorUserId: mockOwnerUserId,
      actorRole: 'OWNER',
    });
    const s1Recalc = await settlementService.getOrCreateSettlement(testDormitoryId, testContractAId);
    expect(Number(s1Recalc.netSettlement)).toBe(9500);
    expect(s1Recalc.settlementDirection).toBe('REFUND');
    expect(s1Recalc.settlementStatus).toBe('PENDING_REFUND');

    // Case 2: Deposit 10,000 - Damage 10,000 = Net 0 (ZERO / CLOSED_ZERO)
    await prisma.contractSettlementItem.deleteMany({ where: { settlementId: settlement1.id } });
    await settlementService.addDamageItem({
      dormitoryId: testDormitoryId,
      settlementId: settlement1.id,
      description: 'ค่าทำความสะอาดหนัก',
      amount: 10000,
      actorUserId: mockOwnerUserId,
      actorRole: 'OWNER',
    });
    const s2Recalc = await settlementService.getOrCreateSettlement(testDormitoryId, testContractAId);
    expect(Number(s2Recalc.netSettlement)).toBe(0);
    expect(s2Recalc.settlementDirection).toBe('ZERO');
    expect(s2Recalc.settlementStatus).toBe('CLOSED_ZERO');

    // Case 3: Deposit 10,000 - Damage 11,000 = Net -1,000 (PAYMENT_DUE / PENDING_PAYMENT)
    await prisma.contractSettlementItem.deleteMany({ where: { settlementId: settlement1.id } });
    await settlementService.addDamageItem({
      dormitoryId: testDormitoryId,
      settlementId: settlement1.id,
      description: 'ค่ากระจกแตกและผนังชำรุด',
      amount: 11000,
      actorUserId: mockOwnerUserId,
      actorRole: 'OWNER',
    });
    const s3Recalc = await settlementService.getOrCreateSettlement(testDormitoryId, testContractAId);
    expect(Number(s3Recalc.netSettlement)).toBe(-1000);
    expect(s3Recalc.settlementDirection).toBe('PAYMENT_DUE');
    expect(s3Recalc.settlementStatus).toBe('PENDING_PAYMENT');
  });

  // Test 12: Future Renewal Approval creates scheduled contract (approved_scheduled), preserves current active contract & room pointers until start date
  it('12. Future Renewal Approval: Creates approved_scheduled contract with activatedAt=null and does NOT establish active occupancy before start date', async () => {
    // Tenant A submits renewal request for future date (2026-10-01)
    const req = await contractRenewalService.submitRenewalRequest({
      dormitoryId: testDormitoryId,
      tenantId: testTenantAId,
      contractId: testContractAId,
      requestedStartDate: '2026-10-01',
      requestedDurationMonths: 6,
    });

    const approvalResult = await contractRenewalService.approveRenewalRequest({
      dormitoryId: testDormitoryId,
      requestId: req.id,
      actorUserId: mockOwnerUserId,
      actorRole: 'OWNER',
    });

    expect(approvalResult.request.status).toBe('APPROVED');
    const futureContract = approvalResult.contract;
    expect(futureContract?.status).toBe('approved_scheduled');
    expect(futureContract?.activatedAt).toBeNull();
    expect(futureContract?.previousContractId).toBe(testContractAId);

    // Verify room status and pointers remain current contract A (NOT future contract)
    const room = await prisma.room.findUnique({ where: { id: testRoomA101Id } });
    expect(room?.currentContractId).toBe(testContractAId);
    expect(room?.currentTenantId).toBe(testTenantAId);

    // Verify NO active occupancy exists for future contract
    const futureOccupancy = await prisma.occupancy.findFirst({
      where: { contractId: futureContract?.id, status: 'ACTIVE' },
    });
    expect(futureOccupancy).toBeNull();

    // Verify current contract A remains active
    const currentContract = await prisma.contract.findUnique({ where: { id: testContractAId } });
    expect(currentContract?.status).toBe('active');
  });

  // Test 13: Scheduled activation on effective start date
  it('13. Effective Date Activation: activateScheduledContracts transitions scheduled contract to active and creates ACTIVE occupancy', async () => {
    // Setup approved scheduled contract
    const req = await contractRenewalService.submitRenewalRequest({
      dormitoryId: testDormitoryId,
      tenantId: testTenantAId,
      contractId: testContractAId,
      requestedStartDate: '2026-10-01',
      requestedDurationMonths: 6,
    });
    const { contract: futureContract } = await contractRenewalService.approveRenewalRequest({
      dormitoryId: testDormitoryId,
      requestId: req.id,
      actorUserId: mockOwnerUserId,
      actorRole: 'OWNER',
    });

    // Advance clock/evaluate on 2026-10-01
    const res = await contractRenewalService.activateScheduledContracts(testDormitoryId, '2026-10-01', mockOwnerUserId);
    expect(res.activatedCount).toBeGreaterThanOrEqual(1);

    const activatedContract = await prisma.contract.findUnique({ where: { id: futureContract!.id } });
    expect(activatedContract?.status).toBe('active');
    expect(activatedContract?.activatedAt).not.toBeNull();

    const activeOccupancy = await prisma.occupancy.findFirst({
      where: { contractId: futureContract!.id, status: 'ACTIVE' },
    });
    expect(activeOccupancy).not.toBeNull();

    const room = await prisma.room.findUnique({ where: { id: testRoomA101Id } });
    expect(room?.currentContractId).toBe(futureContract!.id);
  });

  // Test 14: Owner overrides approved future renewal with explicit warning check
  it('14. Future Renewal Override: Owner approval of Applicant B requires confirmation, cancels future renewal, and creates persistent notice', async () => {
    // Setup approved scheduled contract for Tenant A
    const rnwReq = await contractRenewalService.submitRenewalRequest({
      dormitoryId: testDormitoryId,
      tenantId: testTenantAId,
      contractId: testContractAId,
      requestedStartDate: '2026-10-01',
      requestedDurationMonths: 6,
    });
    const { contract: futureContract } = await contractRenewalService.approveRenewalRequest({
      dormitoryId: testDormitoryId,
      requestId: rnwReq.id,
      actorUserId: mockOwnerUserId,
      actorRole: 'OWNER',
    });

    // Applicant B submits registration
    const appB = await tenantRegistrationService.createRequest(testDormitoryId, {
      dormitoryId: testDormitoryId,
      requestedRoomId: testRoomA101Id,
      firstName: 'Boonmee',
      lastName: 'Rakdee',
      phone: '0899999999',
      agreedTerms: true,
      signatureBase64: createDummySignature(),
      expectedPolicyVersion: 1,
    });

    // Unconfirmed approval throws 409 REPLACEMENT_CONFIRMATION_REQUIRED
    await expect(
      tenantRegistrationService.approveRequest(appB.id, testDormitoryId, {
        startDate: '2026-10-01',
        endDate: '2027-03-31',
        durationMonths: 6,
        rentAmount: '5000',
        depositAmount: '10000',
        advancePaymentAmount: '5000',
        confirmReplacement: false,
      })
    ).rejects.toThrow('REPLACEMENT_CONFIRMATION_REQUIRED');

    // Confirmed approval executes replacement & future renewal override atomically
    const bResult = await tenantRegistrationService.approveRequest(appB.id, testDormitoryId, {
      startDate: '2026-10-01',
      endDate: '2027-03-31',
      durationMonths: 6,
      rentAmount: '5000',
      depositAmount: '10000',
      advancePaymentAmount: '5000',
      confirmReplacement: true,
    });

    expect(bResult.request.status).toBe('approved');

    // Future contract A2 is cancelled
    const cancelledContract = await prisma.contract.findUnique({ where: { id: futureContract!.id } });
    expect(cancelledContract?.status).toBe('cancelled');

    // Tenant A renewal request is CANCELLED
    const cancelledReq = await prisma.tenantRenewalRequest.findUnique({ where: { id: rnwReq.id } });
    expect(cancelledReq?.status).toBe('CANCELLED');

    // Persistent notice created for Tenant A
    const notice = await prisma.tenantNotice.findFirst({
      where: { tenantId: testTenantAId, title: 'แจ้งยกเลิกสัญญาต่ออายุในอนาคต' },
    });
    expect(notice).not.toBeNull();

    // Room points to B
    const room = await prisma.room.findUnique({ where: { id: testRoomA101Id } });
    expect(room?.currentTenantId).toBe(bResult.tenant.id);
  });

  // Test 15: Cancelled future renewal never auto-activates
  it('15. Cancelled Future Activation Guard: Cancelled scheduled renewal cannot be activated on effective date', async () => {
    // Setup and override scheduled renewal
    const rnwReq = await contractRenewalService.submitRenewalRequest({
      dormitoryId: testDormitoryId,
      tenantId: testTenantAId,
      contractId: testContractAId,
      requestedStartDate: '2026-10-01',
      requestedDurationMonths: 6,
    });
    const { contract: futureContract } = await contractRenewalService.approveRenewalRequest({
      dormitoryId: testDormitoryId,
      requestId: rnwReq.id,
      actorUserId: mockOwnerUserId,
      actorRole: 'OWNER',
    });

    const appB = await tenantRegistrationService.createRequest(testDormitoryId, {
      dormitoryId: testDormitoryId,
      requestedRoomId: testRoomA101Id,
      firstName: 'Boonmee',
      lastName: 'Rakdee',
      phone: '0899999999',
      agreedTerms: true,
      signatureBase64: createDummySignature(),
      expectedPolicyVersion: 1,
    });

    await tenantRegistrationService.approveRequest(appB.id, testDormitoryId, {
      startDate: '2026-10-01',
      endDate: '2027-03-31',
      durationMonths: 6,
      rentAmount: '5000',
      depositAmount: '10000',
      advancePaymentAmount: '5000',
      confirmReplacement: true,
    });

    // Attempt to run scheduled activation for 2026-10-01
    await contractRenewalService.activateScheduledContracts(testDormitoryId, new Date('2026-10-01'));

    // Future contract A2 remains cancelled, not activated
    const cancelledContract = await prisma.contract.findUnique({ where: { id: futureContract!.id } });
    expect(cancelledContract?.status).toBe('cancelled');
    expect(cancelledContract?.activatedAt).toBeNull();
  });

  // Test 16: Active + Future Contract Replacement
  it('16. Active + Future Contract Replacement: Approving B when A has active A1 AND scheduled A2 terminates A1 and cancels A2 atomically', async () => {
    // Setup active A1 AND scheduled A2
    const rnwReq = await contractRenewalService.submitRenewalRequest({
      dormitoryId: testDormitoryId,
      tenantId: testTenantAId,
      contractId: testContractAId,
      requestedStartDate: '2026-10-01',
      requestedDurationMonths: 6,
    });
    const { contract: futureContractA2 } = await contractRenewalService.approveRenewalRequest({
      dormitoryId: testDormitoryId,
      requestId: rnwReq.id,
      actorUserId: mockOwnerUserId,
      actorRole: 'OWNER',
    });

    const appB = await tenantRegistrationService.createRequest(testDormitoryId, {
      dormitoryId: testDormitoryId,
      requestedRoomId: testRoomA101Id,
      firstName: 'Chai',
      lastName: 'Dee',
      phone: '0811111111',
      agreedTerms: true,
      signatureBase64: createDummySignature(),
      expectedPolicyVersion: 1,
    });

    const bResult = await tenantRegistrationService.approveRequest(appB.id, testDormitoryId, {
      startDate: '2026-08-15',
      endDate: '2027-02-15',
      durationMonths: 6,
      rentAmount: '5000',
      depositAmount: '10000',
      advancePaymentAmount: '5000',
      confirmReplacement: true,
    });

    // A1 active contract terminated
    const terminatedA1 = await prisma.contract.findUnique({ where: { id: testContractAId } });
    expect(terminatedA1?.status).toBe('terminated');

    // A1 active occupancy ENDED
    const endedOccupancyA = await prisma.occupancy.findUnique({ where: { id: testOccupancyAId } });
    expect(endedOccupancyA?.status).toBe('ENDED');

    // A2 scheduled contract cancelled
    const cancelledA2 = await prisma.contract.findUnique({ where: { id: futureContractA2!.id } });
    expect(cancelledA2?.status).toBe('cancelled');

    // Settlement opened for A1
    const settlementA1 = await prisma.contractSettlement.findFirst({ where: { contractId: testContractAId } });
    expect(settlementA1).not.toBeNull();

    // Exactly one active room occupant (B)
    const activeOccupancies = await prisma.occupancy.findMany({ where: { roomId: testRoomA101Id, status: 'ACTIVE' } });
    expect(activeOccupancies.length).toBe(1);
    expect(activeOccupancies[0].tenantId).toBe(bResult.tenant.id);
  });

  // Test 17: Explicit Asia/Bangkok Date Boundary & Activation Proof
  it('17. Bangkok Date Boundary: 16:59:59.999Z is NOT active, 17:00:00.000Z is ELIGIBLE, repeated activation is idempotent', async () => {
    // Create a scheduled renewal contract for start date 2026-09-01
    const scheduledCtr = await prisma.contract.create({
      data: {
        dormitoryId: testDormitoryId,
        contractNumber: 'CTR-BKK-001',
        roomId: testRoomA101Id,
        tenantId: testTenantAId,
        status: 'approved_scheduled',
        startDate: new Date('2026-09-01T00:00:00.000Z'),
        endDate: new Date('2027-03-01T00:00:00.000Z'),
        durationMonths: 6,
        rentAmount: '5000',
        depositAmount: '10000',
        advancePaymentAmount: '5000',
        previousContractId: testContractAId,
        activatedAt: null,
      },
    });

    // Instant 1: 2026-08-31T16:59:59.999Z (= 2026-08-31 23:59:59.999 in Bangkok) -> NOT ACTIVE
    const beforeBangkokMidnight = new Date('2026-08-31T16:59:59.999Z');
    const res1 = await contractRenewalService.activateScheduledContracts(testDormitoryId, beforeBangkokMidnight);
    expect(res1.activatedCount).toBe(0);

    const check1 = await prisma.contract.findUnique({ where: { id: scheduledCtr.id } });
    expect(check1?.status).toBe('approved_scheduled');
    expect(check1?.activatedAt).toBeNull();

    // Instant 2: 2026-08-31T17:00:00.000Z (= 2026-09-01 00:00:00.000 in Bangkok) -> ELIGIBLE TO ACTIVATE
    const atBangkokMidnight = new Date('2026-08-31T17:00:00.000Z');
    const res2 = await contractRenewalService.activateScheduledContracts(testDormitoryId, atBangkokMidnight);
    expect(res2.activatedCount).toBe(1);

    const check2 = await prisma.contract.findUnique({ where: { id: scheduledCtr.id } });
    expect(check2?.status).toBe('active');
    expect(check2?.activatedAt).not.toBeNull();

    // Test repeated activation on later same Bangkok date (2026-09-01T10:00:00Z) -> Idempotent, 0 new activations
    const laterSameDay = new Date('2026-09-01T10:00:00.000Z');
    const res3 = await contractRenewalService.activateScheduledContracts(testDormitoryId, laterSameDay);
    expect(res3.activatedCount).toBe(0);

    // Test next Bangkok day (2026-09-02) -> Idempotent, 0 new activations
    const nextDay = new Date('2026-09-02T00:00:00.000Z');
    const res4 = await contractRenewalService.activateScheduledContracts(testDormitoryId, nextDay);
    expect(res4.activatedCount).toBe(0);
  });
});
