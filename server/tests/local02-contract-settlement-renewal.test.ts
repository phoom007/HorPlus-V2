import { describe, it, expect, beforeEach } from 'vitest';
import { getPrismaClient } from '../src/db/prisma.js';
import { contractRenewalService } from '../src/services/contract-renewal.service.js';
import { settlementService } from '../src/services/settlement.service.js';
import { tenantRegistrationService } from '../src/services/tenant-registration.service.js';
import { Prisma } from '@prisma/client';

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
    // Clean up test database atomically with TRUNCATE CASCADE
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE tenant_notices, contract_settlement_items, contract_settlements, tenant_renewal_requests, occupancies, bill_items, receipts, payment_status_histories, payments, bills, contract_snapshots, contracts, tenant_registration_requests, tenants, rooms, buildings, dormitory_members, dormitories CASCADE;'
    );

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

    const payload = {
      startDate: '2026-07-01',
      endDate: '2026-12-31',
      durationMonths: 6,
      rentAmount: '5000',
      depositAmount: '10000',
      advancePaymentAmount: '5000',
      confirmReplacement: true,
    };

    // Execute concurrent approval requests
    await Promise.allSettled([
      tenantRegistrationService.approveRequest(reg1.id, testDormitoryId, payload, mockOwnerUserId),
      tenantRegistrationService.approveRequest(reg2.id, testDormitoryId, payload, mockOwnerUserId),
    ]);

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
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);

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
});
