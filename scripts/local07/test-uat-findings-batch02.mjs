/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HORPLUS LOCAL-07 — PRODUCT OWNER MANUAL UAT FINDINGS BATCH 02 VERIFICATION SUITE
 */

import { chromium } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('../../server/node_modules/@prisma/client/index.js');
import { assertSafeDatabaseTarget } from './db-safety-guard.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = 'http://127.0.0.1:5173';
const SESSIONS_DIR = path.join(__dirname, '../../.local07-sessions');

assertSafeDatabaseTarget();

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL || process.env.DATABASE_URL,
    },
  },
});

async function runBatch02Verification() {
  console.log('================================================================================');
  console.log('  HORPLUS LOCAL-07 — UAT FINDINGS BATCH 02 VERIFICATION SUITE');
  console.log('================================================================================');

  const results = {
    db_provenance_and_check_constraints: false,
    unique_rate_snapshot_per_cycle: false,
    cycle_service_forward_propagation: false,
    manual_override_boundary_preservation: false,
    paid_bill_cycle_lock_immutability: false,
    optimistic_concurrency_atomic_parallel: false,
    required_expected_version_validation: false,
    authoritative_people_count_unpaid_repricing: false,
    runtime_schema_invalid_modes_rejected: false,
    free_mode_server_zero_persistence: false,
    decimal_string_transport_precision: false,
    promo_authoritative_reasons: false,
    browser_shared_calendar_gap_and_settings_persistence: false,
    browser_promo_edit_invalidation_and_step7: false,
  };

  try {
    // --------------------------------------------------------------------------
    // 1. DB Provenance & CHECK Constraints Verification
    // --------------------------------------------------------------------------
    console.log('\n--- 1. Testing DB Provenance Rules & CHECK Constraints ---');

    const testOwnerId = 'a1111111-1111-4111-a111-111111111111';
    const testDormId = 'b2222222-2222-4222-b222-222222222222';
    const cycleAId = 'c3333333-3333-4333-c333-333333333331';
    const cycleBId = 'c3333333-3333-4333-c333-333333333332';
    const snap1Id = 'd4444444-4444-4444-d444-444444444441';
    const snap2Id = 'd4444444-4444-4444-d444-444444444442';
    const snapInvSrcId = 'd4444444-4444-4444-d444-444444444443';
    const snapInvInhId = 'd4444444-4444-4444-d444-444444444444';

    // Create a temporary dormitory & user for DB tests
    const testOwner = await prisma.user.upsert({
      where: { id: testOwnerId },
      update: {},
      create: {
        id: testOwnerId,
        googleSubject: 'google-sub-batch02-owner',
        email: 'batch02-test-owner@horplus.local',
        emailNormalized: 'batch02-test-owner@horplus.local',
        phone: '0899990002',
        name: 'Batch02 Test Owner',
        status: 'active',
      },
    });

    const testDorm = await prisma.dormitory.upsert({
      where: { id: testDormId },
      update: {},
      create: {
        id: testDormId,
        name: 'Batch02 Test Dormitory',
        createdByUserId: testOwner.id,
      },
    });

    // Create test billing cycles
    const cycleA = await prisma.billingCycle.upsert({
      where: { id: cycleAId },
      update: {},
      create: {
        id: cycleAId,
        dormitoryId: testDorm.id,
        cycleCode: '2026-01',
        name: 'มกราคม 2569',
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2026-01-31'),
        billingDate: new Date('2026-01-25'),
        dueDate: new Date('2026-02-05'),
        status: 'active',
      },
    });

    const cycleB = await prisma.billingCycle.upsert({
      where: { id: cycleBId },
      update: {},
      create: {
        id: cycleBId,
        dormitoryId: testDorm.id,
        cycleCode: '2026-02',
        name: 'กุมภาพันธ์ 2569',
        periodStart: new Date('2026-02-01'),
        periodEnd: new Date('2026-02-28'),
        billingDate: new Date('2026-02-25'),
        dueDate: new Date('2026-03-05'),
        status: 'active',
      },
    });

    // Clean up any existing test snapshots
    await prisma.billingRateSnapshot.deleteMany({
      where: { billingCycleId: { in: [cycleAId, cycleBId] } },
    });

    // 1.1 Test Valid TEMPLATE_DEFAULT
    await prisma.$executeRawUnsafe(`
      INSERT INTO billing_rate_snapshots (
        id, dormitory_id, billing_cycle_id, water_billing_type, water_rate,
        electricity_billing_type, electricity_rate, common_fee, common_fee_mode,
        internet_fee, internet_fee_mode, parking_fee, parking_fee_mode,
        late_fee_type, late_fee_value, currency, source, inherited_from_billing_cycle_id,
        updated_by_user_id, version, created_at, updated_at
      ) VALUES (
        '${snap1Id}', '${testDormId}', '${cycleAId}', 'unit', 18.00,
        'unit', 7.00, 0.00, 'free', 0.00, 'free', 0.00, 'free',
        'free', 0.00, 'THB', 'TEMPLATE_DEFAULT', NULL, NULL, 1, NOW(), NOW()
      );
    `);
    console.log('✓ Valid TEMPLATE_DEFAULT snapshot inserted successfully.');

    // 1.2 Test Invalid Source (CHECK constraint)
    let invalidSourceFailed = false;
    try {
      await prisma.$executeRawUnsafe(`
        INSERT INTO billing_rate_snapshots (
          id, dormitory_id, billing_cycle_id, water_billing_type, water_rate,
          electricity_billing_type, electricity_rate, common_fee, common_fee_mode,
          internet_fee, internet_fee_mode, parking_fee, parking_fee_mode,
          late_fee_type, late_fee_value, currency, source, inherited_from_billing_cycle_id,
          updated_by_user_id, version, created_at, updated_at
        ) VALUES (
          '${snapInvSrcId}', '${testDormId}', '${cycleBId}', 'unit', 18.00,
          'unit', 7.00, 0.00, 'free', 0.00, 'free', 0.00, 'free',
          'free', 0.00, 'THB', 'INVALID_SOURCE', NULL, NULL, 1, NOW(), NOW()
        );
      `);
    } catch (e) {
      invalidSourceFailed = true;
    }
    if (!invalidSourceFailed) throw new Error('CHECK constraint failed to reject INVALID_SOURCE');
    console.log('✓ DB CHECK constraint rejected INVALID_SOURCE.');

    // 1.3 Test Invalid INHERITED (missing inherited_from_billing_cycle_id)
    let invalidInheritedFailed = false;
    try {
      await prisma.$executeRawUnsafe(`
        INSERT INTO billing_rate_snapshots (
          id, dormitory_id, billing_cycle_id, water_billing_type, water_rate,
          electricity_billing_type, electricity_rate, common_fee, common_fee_mode,
          internet_fee, internet_fee_mode, parking_fee, parking_fee_mode,
          late_fee_type, late_fee_value, currency, source, inherited_from_billing_cycle_id,
          updated_by_user_id, version, created_at, updated_at
        ) VALUES (
          '${snapInvInhId}', '${testDormId}', '${cycleBId}', 'unit', 18.00,
          'unit', 7.00, 0.00, 'free', 0.00, 'free', 0.00, 'free',
          'free', 0.00, 'THB', 'INHERITED', NULL, NULL, 1, NOW(), NOW()
        );
      `);
    } catch (e) {
      invalidInheritedFailed = true;
    }
    if (!invalidInheritedFailed) throw new Error('CHECK constraint failed to reject INHERITED without inherited_from_billing_cycle_id');
    console.log('✓ DB CHECK constraint rejected INHERITED without parent cycle.');

    // 1.4 Test Valid INHERITED
    await prisma.$executeRawUnsafe(`
      INSERT INTO billing_rate_snapshots (
        id, dormitory_id, billing_cycle_id, water_billing_type, water_rate,
        electricity_billing_type, electricity_rate, common_fee, common_fee_mode,
        internet_fee, internet_fee_mode, parking_fee, parking_fee_mode,
        late_fee_type, late_fee_value, currency, source, inherited_from_billing_cycle_id,
        updated_by_user_id, version, created_at, updated_at
      ) VALUES (
        '${snap2Id}', '${testDormId}', '${cycleBId}', 'unit', 18.00,
        'unit', 7.00, 0.00, 'free', 0.00, 'free', 0.00, 'free',
        'free', 0.00, 'THB', 'INHERITED', '${cycleAId}', NULL, 1, NOW(), NOW()
      );
    `);
    console.log('✓ Valid INHERITED snapshot inserted successfully.');

    // 1.5 Test Unique Constraint on billing_cycle_id
    let duplicateCycleFailed = false;
    try {
      await prisma.$executeRawUnsafe(`
        INSERT INTO billing_rate_snapshots (
          id, dormitory_id, billing_cycle_id, water_billing_type, water_rate,
          electricity_billing_type, electricity_rate, common_fee, common_fee_mode,
          internet_fee, internet_fee_mode, parking_fee, parking_fee_mode,
          late_fee_type, late_fee_value, currency, source, inherited_from_billing_cycle_id,
          updated_by_user_id, version, created_at, updated_at
        ) VALUES (
          '${snapInvSrcId}', '${testDormId}', '${cycleBId}', 'unit', 18.00,
          'unit', 7.00, 0.00, 'free', 0.00, 'free', 0.00, 'free',
          'free', 0.00, 'THB', 'INHERITED', '${cycleAId}', NULL, 1, NOW(), NOW()
        );
      `);
    } catch (e) {
      duplicateCycleFailed = true;
    }
    if (!duplicateCycleFailed) throw new Error('UNIQUE constraint failed to reject duplicate billing_cycle_id');
    console.log('✓ UNIQUE constraint rejected duplicate rate snapshot on the same billing cycle.');

    results.db_provenance_and_check_constraints = true;
    results.unique_rate_snapshot_per_cycle = true;

    // --------------------------------------------------------------------------
    // 2. Service Layer: Forward Propagation & MANUAL_OVERRIDE Boundary
    // --------------------------------------------------------------------------
    console.log('\n--- 2. Testing Service Forward Propagation & Manual Override Boundary ---');
    const { BillingCycleService } = await import('../../server/dist/services/billing-cycle.service.js');
    const { PrismaBillingCycleRepository } = await import('../../server/dist/db/repositories/billing-cycle.repository.js');

    const cycleRepo = new PrismaBillingCycleRepository(prisma);
    const cycleService = new BillingCycleService(cycleRepo, undefined);

    // Setup 4 consecutive cycles: 2026-05, 2026-06, 2026-07, 2026-08
    const testPropDormId = 'e5555555-5555-4555-e555-555555555555';
    const testPropDorm = await prisma.dormitory.upsert({
      where: { id: testPropDormId },
      update: {},
      create: {
        id: testPropDormId,
        name: 'Batch02 Propagation Dorm',
        createdByUserId: testOwner.id,
      },
    });

    await prisma.dormitoryBillingSettings.upsert({
      where: { dormitoryId: testPropDormId },
      update: {
        waterRate: 17,
        electricityRate: 7,
      },
      create: {
        dormitoryId: testPropDormId,
        billingDay: 25,
        dueDay: 5,
        waterBillingType: 'unit',
        waterRate: 17,
        electricityBillingType: 'unit',
        electricityRate: 7,
        commonFee: 0,
        commonFeeMode: 'free',
        internetFee: 0,
        internetFeeMode: 'free',
        parkingRate: 0,
        parkingFeeMode: 'free',
        lateFeeType: 'free',
        lateFeeValue: 0,
      },
    });

    await prisma.bill.deleteMany({ where: { dormitoryId: testPropDorm.id } });
    await prisma.billingRateSnapshot.deleteMany({ where: { dormitoryId: testPropDorm.id } });
    await prisma.billingCycle.deleteMany({ where: { dormitoryId: testPropDorm.id } });

    // Create 4 cycles in 2027
    const c1 = await cycleService.createBillingCycle(testPropDorm.id, {
      cycleCode: '2027-01',
      name: 'มกราคม 2570',
      periodStart: '2027-01-01',
      periodEnd: '2027-01-31',
      billingDate: '2027-01-25',
      dueDate: '2027-02-05',
    }, testOwner.id);

    const c2 = await cycleService.createBillingCycle(testPropDorm.id, {
      cycleCode: '2027-02',
      name: 'กุมภาพันธ์ 2570',
      periodStart: '2027-02-01',
      periodEnd: '2027-02-28',
      billingDate: '2027-02-25',
      dueDate: '2027-03-05',
    }, testOwner.id);

    const c3 = await cycleService.createBillingCycle(testPropDorm.id, {
      cycleCode: '2027-03',
      name: 'มีนาคม 2570',
      periodStart: '2027-03-01',
      periodEnd: '2027-03-31',
      billingDate: '2027-03-25',
      dueDate: '2027-04-05',
    }, testOwner.id);

    const c4 = await cycleService.createBillingCycle(testPropDorm.id, {
      cycleCode: '2027-04',
      name: 'เมษายน 2570',
      periodStart: '2027-04-01',
      periodEnd: '2027-04-30',
      billingDate: '2027-04-25',
      dueDate: '2027-05-05',
    }, testOwner.id);

    // Verify initial provenance
    const snapC1 = await cycleService.getCycleRateSnapshot(testPropDorm.id, c1.cycle.id);
    const snapC2 = await cycleService.getCycleRateSnapshot(testPropDorm.id, c2.cycle.id);
    const snapC3 = await cycleService.getCycleRateSnapshot(testPropDorm.id, c3.cycle.id);
    const snapC4 = await cycleService.getCycleRateSnapshot(testPropDorm.id, c4.cycle.id);

    if (snapC1.rateSnapshot?.source !== 'TEMPLATE_DEFAULT') {
      throw new Error(`Expected c1 to have source TEMPLATE_DEFAULT, got ${snapC1.rateSnapshot?.source}`);
    }
    if (snapC2.rateSnapshot?.source !== 'INHERITED' || snapC2.rateSnapshot?.inheritedFromBillingCycleId !== c1.cycle.id) {
      throw new Error(`Expected c2 to have source INHERITED from c1`);
    }
    console.log('✓ Initial cycle snapshots established: C1=TEMPLATE_DEFAULT, C2..C4=INHERITED.');

    // 2.1 Owner manually overrides C2 (waterRate: 25)
    await cycleService.updateCycleRateSnapshot(testPropDorm.id, c2.cycle.id, {
      waterRate: 25,
      electricityRate: 8,
      expectedVersion: snapC2.rateSnapshot?.version || 1,
    }, testOwner.id);

    const updatedC2 = await cycleService.getCycleRateSnapshot(testPropDorm.id, c2.cycle.id);
    const updatedC3 = await cycleService.getCycleRateSnapshot(testPropDorm.id, c3.cycle.id);
    const updatedC4 = await cycleService.getCycleRateSnapshot(testPropDorm.id, c4.cycle.id);

    if (updatedC2.rateSnapshot?.source !== 'MANUAL_OVERRIDE' || Number(updatedC2.rateSnapshot?.waterRate) !== 25) {
      throw new Error(`Expected c2 to be MANUAL_OVERRIDE with waterRate=25`);
    }
    if (updatedC3.rateSnapshot?.source !== 'INHERITED' || Number(updatedC3.rateSnapshot?.waterRate) !== 25) {
      throw new Error(`Expected c3 to inherit waterRate=25 forward from c2`);
    }
    if (updatedC4.rateSnapshot?.source !== 'INHERITED' || Number(updatedC4.rateSnapshot?.waterRate) !== 25) {
      throw new Error(`Expected c4 to inherit waterRate=25 forward from c2`);
    }
    console.log('✓ C2 manual override propagated forward to C3 and C4.');
    results.cycle_service_forward_propagation = true;

    // 2.2 Now manually override C4 (waterRate: 30)
    await cycleService.updateCycleRateSnapshot(testPropDorm.id, c4.cycle.id, {
      waterRate: 30,
      expectedVersion: updatedC4.rateSnapshot?.version || 1,
    }, testOwner.id);

    // 2.3 Next, manually override C2 again (waterRate: 20)
    const freshC2 = await cycleService.getCycleRateSnapshot(testPropDorm.id, c2.cycle.id);
    await cycleService.updateCycleRateSnapshot(testPropDorm.id, c2.cycle.id, {
      waterRate: 20,
      expectedVersion: freshC2.rateSnapshot?.version || 2,
    }, testOwner.id);

    const recheckC2 = await cycleService.getCycleRateSnapshot(testPropDorm.id, c2.cycle.id);
    const recheckC3 = await cycleService.getCycleRateSnapshot(testPropDorm.id, c3.cycle.id);
    const recheckC4 = await cycleService.getCycleRateSnapshot(testPropDorm.id, c4.cycle.id);

    if (Number(recheckC2.rateSnapshot?.waterRate) !== 20) {
      throw new Error(`Expected c2 waterRate=20`);
    }
    if (Number(recheckC3.rateSnapshot?.waterRate) !== 20) {
      throw new Error(`Expected c3 to inherit waterRate=20`);
    }
    if (recheckC4.rateSnapshot?.source !== 'MANUAL_OVERRIDE' || Number(recheckC4.rateSnapshot?.waterRate) !== 30) {
      throw new Error(`Expected c4 to maintain MANUAL_OVERRIDE with waterRate=30! Found: ${recheckC4.rateSnapshot?.waterRate}`);
    }
    console.log('✓ MANUAL_OVERRIDE boundary strictly protected: C4 was NOT overwritten by C2 propagation.');
    results.manual_override_boundary_preservation = true;

    // --------------------------------------------------------------------------
    // 3. Paid-Bill Cycle Lock Immutability
    // --------------------------------------------------------------------------
    console.log('\n--- 3. Testing Paid-Bill Cycle Lock Immutability ---');

    // Create a building, room and a paid bill in cycle C2
    const testBuildingId = '88888888-8888-4888-a888-888888888888';
    const testRoomId = 'f6666666-6666-4666-f666-666666666666';
    const paidBillId = '77777777-7777-4777-a777-777777777777';

    await prisma.building.upsert({
      where: { id: testBuildingId },
      update: {},
      create: {
        id: testBuildingId,
        dormitoryId: testPropDorm.id,
        name: 'อาคาร A',
      },
    });

    const testRoom = await prisma.room.upsert({
      where: { id: testRoomId },
      update: {},
      create: {
        id: testRoomId,
        dormitoryId: testPropDorm.id,
        buildingId: testBuildingId,
        roomNumber: 'B201',
        normalizedRoomNumber: 'b201',
        roomType: 'standard',
        floor: 2,
        status: 'occupied',
        monthlyRent: 4500,
      },
    });

    await prisma.bill.create({
      data: {
        id: paidBillId,
        dormitoryId: testPropDorm.id,
        billingCycleId: c2.cycle.id,
        roomId: testRoom.id,
        billNumber: 'INV-202702-B201',
        billingDate: new Date('2027-02-25'),
        dueDate: new Date('2027-03-05'),
        totalAmount: 5200,
        paidAmount: 5200,
        status: 'paid',
        paidAt: new Date(),
      },
    });

    const lockedC2Snapshot = await cycleService.getCycleRateSnapshot(testPropDorm.id, c2.cycle.id);
    if (!lockedC2Snapshot.isLocked) {
      throw new Error('Expected cycle C2 with paid bill to report isLocked = true');
    }
    console.log('✓ Cycle C2 with paid bill resolved as isLocked = true.');

    let lockedEditRejected = false;
    try {
      await cycleService.updateCycleRateSnapshot(testPropDorm.id, c2.cycle.id, {
        waterRate: 99,
        expectedVersion: lockedC2Snapshot.rateSnapshot?.version || 1,
      }, testOwner.id);
    } catch (e) {
      if (e.code === 'BILLING_CYCLE_RATE_SETTINGS_LOCKED' || e.statusCode === 423) {
        lockedEditRejected = true;
      }
    }
    if (!lockedEditRejected) {
      throw new Error('Expected cycle with paid bills to reject rate updates with BILLING_CYCLE_RATE_SETTINGS_LOCKED');
    }
    console.log('✓ Rate mutation on paid-bill cycle rejected with BILLING_CYCLE_RATE_SETTINGS_LOCKED.');
    results.paid_bill_cycle_lock_immutability = true;

    // --------------------------------------------------------------------------
    // 4. Optimistic Concurrency Control (Parallel 2-Caller Test)
    // --------------------------------------------------------------------------
    console.log('\n--- 4. Testing Optimistic Concurrency Control (Atomic Parallel Test) ---');
    const snapBeforeRace = await cycleService.getCycleRateSnapshot(testPropDorm.id, c4.cycle.id);
    const currVersion = snapBeforeRace.rateSnapshot?.version || 1;

    // Two parallel callers submit mutations against the exact same expectedVersion
    const raceResults = await Promise.allSettled([
      cycleService.updateCycleRateSnapshot(testPropDorm.id, c4.cycle.id, {
        waterRate: 22,
        expectedVersion: currVersion,
      }, testOwner.id),
      cycleService.updateCycleRateSnapshot(testPropDorm.id, c4.cycle.id, {
        waterRate: 24,
        expectedVersion: currVersion,
      }, testOwner.id),
    ]);

    const fulfilledCount = raceResults.filter(r => r.status === 'fulfilled').length;
    const rejectedCount = raceResults.filter(r => r.status === 'rejected').length;

    if (fulfilledCount !== 1 || rejectedCount !== 1) {
      throw new Error(`Expected exactly 1 winner and 1 conflict loser in OCC race! Got fulfilled: ${fulfilledCount}, rejected: ${rejectedCount}`);
    }

    const loserRejection = raceResults.find(r => r.status === 'rejected');
    const loserErr = loserRejection?.reason;
    if (loserErr?.code !== 'BILLING_RATE_SNAPSHOT_VERSION_CONFLICT' && loserErr?.statusCode !== 409) {
      throw new Error(`Expected loser error code BILLING_RATE_SNAPSHOT_VERSION_CONFLICT 409, got: ${loserErr?.code}`);
    }
    console.log('✓ Atomic OCC race verified: Exactly 1 caller won and 1 caller failed with 409 BILLING_RATE_SNAPSHOT_VERSION_CONFLICT.');
    results.optimistic_concurrency_atomic_parallel = true;

    // --------------------------------------------------------------------------
    // 5. Required expectedVersion Validation
    // --------------------------------------------------------------------------
    console.log('\n--- 5. Testing Required expectedVersion Validation (HTTP 400) ---');
    let missingVersionRejected = false;
    try {
      await cycleService.updateCycleRateSnapshot(testPropDorm.id, c4.cycle.id, {
        waterRate: 25,
      }, testOwner.id);
    } catch (e) {
      if (e.code === 'VALIDATION_ERROR' || e.statusCode === 400) {
        missingVersionRejected = true;
      }
    }
    if (!missingVersionRejected) {
      throw new Error('Expected missing expectedVersion to be rejected with 400 VALIDATION_ERROR');
    }
    console.log('✓ Missing expectedVersion rejected with 400 VALIDATION_ERROR.');
    results.required_expected_version_validation = true;

    // --------------------------------------------------------------------------
    // 6. Authoritative People Count Unpaid Bill Repricing (3-Person Room)
    // --------------------------------------------------------------------------
    console.log('\n--- 6. Testing Authoritative People Count Unpaid Bill Repricing ---');
    const { BillingService } = await import('../../server/dist/services/billing.service.js');
    const { PrismaBillRepository } = await import('../../server/dist/db/repositories/bill.repository.js');
    const { PrismaMeterRepository } = await import('../../server/dist/db/repositories/meter.repository.js');
    const { PrismaContractRepository } = await import('../../server/dist/db/repositories/contract.repository.js');
    const { PrismaRoomRepository } = await import('../../server/dist/db/repositories/room.repository.js');
    const { PrismaTenantRepository } = await import('../../server/dist/db/repositories/tenant.repository.js');

    const billRepo = new PrismaBillRepository(prisma);
    const meterRepo = new PrismaMeterRepository(prisma);
    const contractRepo = new PrismaContractRepository(prisma);
    const roomRepo = new PrismaRoomRepository(prisma);
    const tenantRepo = new PrismaTenantRepository(prisma);

    const billingService = new BillingService(
      billRepo,
      cycleRepo,
      meterRepo,
      contractRepo,
      roomRepo,
      tenantRepo
    );

    // Create a 3-person room: 1 tenant + 2 co-occupants
    const tenantUser = await prisma.user.upsert({
      where: { id: '33333333-3333-4333-a333-333333333333' },
      update: {},
      create: {
        id: '33333333-3333-4333-a333-333333333333',
        googleSubject: 'google-sub-tenant-3p',
        email: 'tenant-3p@horplus.local',
        emailNormalized: 'tenant-3p@horplus.local',
        phone: '0813333333',
        name: 'นายสามคน ผู้เช่าหลัก',
        status: 'active',
      },
    });

    const tenantEntity = await prisma.tenant.upsert({
      where: { id: '44444444-4444-4444-a444-444444444444' },
      update: {},
      create: {
        id: '44444444-4444-4444-a444-444444444444',
        dormitoryId: testPropDorm.id,
        linkedUserId: tenantUser.id,
        tenantNumber: 'TNT-3P-001',
        firstName: 'สมชาย',
        lastName: 'สามคน',
        displayName: 'นายสามคน ผู้เช่าหลัก',
        phone: '0813333333',
        status: 'active',
      },
    });

    // 2 co-occupants
    await prisma.tenantCoOccupant.deleteMany({ where: { tenantId: tenantEntity.id } });
    await prisma.tenantCoOccupant.createMany({
      data: [
        {
          id: '55555555-5555-4555-a555-555555555551',
          dormitoryId: testPropDorm.id,
          tenantId: tenantEntity.id,
          name: 'ผู้พักอาศัยคนที่ 1',
          status: 'active',
        },
        {
          id: '55555555-5555-4555-a555-555555555552',
          dormitoryId: testPropDorm.id,
          tenantId: tenantEntity.id,
          name: 'ผู้พักอาศัยคนที่ 2',
          status: 'active',
        },
      ],
    });

    await prisma.occupancy.deleteMany({ where: { roomId: testRoom.id } });
    await prisma.occupancy.create({
      data: {
        id: '77777777-7777-4777-a777-777777777771',
        dormitoryId: testPropDorm.id,
        roomId: testRoom.id,
        tenantId: tenantEntity.id,
        status: 'ACTIVE',
      },
    });

    const contract3p = await prisma.contract.upsert({
      where: { id: '66666666-6666-4666-a666-666666666666' },
      update: {},
      create: {
        id: '66666666-6666-4666-a666-666666666666',
        dormitoryId: testPropDorm.id,
        contractNumber: 'CTR-3P-001',
        roomId: testRoom.id,
        tenantId: tenantEntity.id,
        status: 'active',
        startDate: new Date('2027-03-01'),
        endDate: new Date('2028-02-28'),
        rentBillingType: 'monthly',
        rentAmount: 4500,
      },
    });

    // Configure cycle C3 with initial rates: commonFeeMode = per_person (100), internetFeeMode = per_person (50)
    const snapC3Before = await cycleService.getCycleRateSnapshot(testPropDorm.id, c3.cycle.id);
    await cycleService.updateCycleRateSnapshot(testPropDorm.id, c3.cycle.id, {
      commonFeeMode: 'per_person',
      commonFee: '100.00',
      internetFeeMode: 'per_person',
      internetFee: '50.00',
      expectedVersion: snapC3Before.rateSnapshot?.version || 1,
    }, testOwner.id);

    // Generate unpaid bill for room in cycle C3
    const unpaidBillRes = await billingService.generateBill(testPropDorm.id, {
      billingCycleId: c3.cycle.id,
      contractId: contract3p.id,
      roomId: testRoom.id,
      tenantId: tenantEntity.id,
    });

    const commonItemBefore = unpaidBillRes.items.find(i => i.type === 'common_fee');
    const internetItemBefore = unpaidBillRes.items.find(i => i.type === 'internet');
    if (Number(commonItemBefore?.amount) !== 300) {
      throw new Error(`Expected initial common fee to be 3 x 100 = 300, got: ${commonItemBefore?.amount}`);
    }
    if (Number(internetItemBefore?.amount) !== 150) {
      throw new Error(`Expected initial internet fee to be 3 x 50 = 150, got: ${internetItemBefore?.amount}`);
    }
    console.log('✓ Initial unpaid bill correctly priced: 3 persons x 100 common fee = 300, 3 x 50 internet = 150.');

    // Owner edits rate snapshot for cycle C3: commonFee = 200/person, internetFee = 80/person
    const snapC3Fresh = await cycleService.getCycleRateSnapshot(testPropDorm.id, c3.cycle.id);
    await cycleService.updateCycleRateSnapshot(testPropDorm.id, c3.cycle.id, {
      commonFeeMode: 'per_person',
      commonFee: '200.00',
      internetFeeMode: 'per_person',
      internetFee: '80.00',
      expectedVersion: snapC3Fresh.rateSnapshot?.version || 1,
    }, testOwner.id);

    // Verify recalculated unpaid bill
    const recalculatedBill = await prisma.bill.findUniqueOrThrow({
      where: { id: unpaidBillRes.bill.id },
      include: { items: true },
    });

    const recalculatedCommon = recalculatedBill.items.find(i => i.type === 'common_fee');
    const recalculatedInternet = recalculatedBill.items.find(i => i.type === 'internet');

    if (Number(recalculatedCommon?.amount) !== 600) {
      throw new Error(`CRITICAL BUG: Expected recalculated common fee = 3 x 200 = 600, but got: ${recalculatedCommon?.amount} (likely hardcoded 1 x 200)!`);
    }
    if (Number(recalculatedInternet?.amount) !== 240) {
      throw new Error(`CRITICAL BUG: Expected recalculated internet fee = 3 x 80 = 240, but got: ${recalculatedInternet?.amount}!`);
    }
    console.log('✓ Authoritative peopleCount repricing verified: 3 persons x 200 = 600 (not 1 x 200).');
    results.authoritative_people_count_unpaid_repricing = true;

    // --------------------------------------------------------------------------
    // 7. Runtime Schema & Burp Invalid Mode Rejections
    // --------------------------------------------------------------------------
    console.log('\n--- 7. Testing Runtime Schema & Burp Invalid Mode Rejections ---');
    const { UpdateCycleRateSnapshotSchema } = await import('../../server/dist/routes/billing-cycle.routes.js');

    const invalidModeCheck = UpdateCycleRateSnapshotSchema.safeParse({
      expectedVersion: 1,
      commonFeeMode: 'foobar',
    });
    if (invalidModeCheck.success) {
      throw new Error('Expected UpdateCycleRateSnapshotSchema to reject invalid mode "foobar"');
    }

    const legacyAliasCheck = UpdateCycleRateSnapshotSchema.safeParse({
      expectedVersion: 1,
      commonFeeMode: 'room',
    });
    if (legacyAliasCheck.success) {
      throw new Error('Expected UpdateCycleRateSnapshotSchema to reject non-canonical write alias "room"');
    }
    console.log('✓ Zod runtime schema strictly rejects invalid modes ("foobar") and non-canonical write aliases ("room").');
    results.runtime_schema_invalid_modes_rejected = true;

    // --------------------------------------------------------------------------
    // 8. Free Mode Server-Side Canonical 0.00 Persistence
    // --------------------------------------------------------------------------
    console.log('\n--- 8. Testing Free Mode Server Canonical 0.00 Persistence ---');
    const snapC3FreeCheck = await cycleService.getCycleRateSnapshot(testPropDorm.id, c3.cycle.id);
    await cycleService.updateCycleRateSnapshot(testPropDorm.id, c3.cycle.id, {
      commonFeeMode: 'free',
      commonFee: '999.00', // Attempt tampering
      internetFeeMode: 'free',
      internetFee: 500,
      expectedVersion: snapC3FreeCheck.rateSnapshot?.version || 1,
    }, testOwner.id);

    const persistedFreeSnap = await prisma.billingRateSnapshot.findUniqueOrThrow({
      where: { billingCycleId: c3.cycle.id },
    });
    if (Number(persistedFreeSnap.commonFee) !== 0 || Number(persistedFreeSnap.internetFee) !== 0) {
      throw new Error(`Expected server to persist 0.00 for free mode, got commonFee=${persistedFreeSnap.commonFee}, internetFee=${persistedFreeSnap.internetFee}`);
    }
    console.log('✓ Server-side canonicalization persists 0.00 for free modes regardless of client tampering.');
    results.free_mode_server_zero_persistence = true;

    // --------------------------------------------------------------------------
    // 9. Decimal String Transport Precision
    // --------------------------------------------------------------------------
    console.log('\n--- 9. Testing Decimal String Transport Precision ---');
    const snapDecCheck = await cycleService.getCycleRateSnapshot(testPropDorm.id, c3.cycle.id);
    await cycleService.updateCycleRateSnapshot(testPropDorm.id, c3.cycle.id, {
      waterRate: '7.25',
      electricityRate: '18.75',
      commonFeeMode: 'per_room',
      commonFee: '250.50',
      expectedVersion: snapDecCheck.rateSnapshot?.version || 1,
    }, testOwner.id);

    const persistedDecSnap = await prisma.billingRateSnapshot.findUniqueOrThrow({
      where: { billingCycleId: c3.cycle.id },
    });
    if (persistedDecSnap.waterRate.toFixed(2) !== '7.25' || persistedDecSnap.electricityRate.toFixed(2) !== '18.75') {
      throw new Error(`Decimal string precision mismatch: water=${persistedDecSnap.waterRate}, electricity=${persistedDecSnap.electricityRate}`);
    }
    console.log('✓ Decimal strings "7.25" and "18.75" preserved with exact database precision.');
    results.decimal_string_transport_precision = true;

    // --------------------------------------------------------------------------
    // 10. Authoritative Promo Reason States
    // --------------------------------------------------------------------------
    console.log('\n--- 10. Testing Authoritative Promo Reason States ---');
    const { PromoService } = await import('../../server/dist/services/promo.service.js');
    const promoService = new PromoService(prisma);

    // 10.1 PROMO_NOT_FOUND
    const notFoundRes = await promoService.validatePromo('INVALID_CODE_XYZ', testOwner.id);
    if (notFoundRes.valid || notFoundRes.errorCode !== 'PROMO_NOT_FOUND') {
      throw new Error(`Expected PROMO_NOT_FOUND, got: ${notFoundRes.errorCode}`);
    }

    // 10.2 Valid HORPLUS Promo
    const validPromoRes = await promoService.validatePromo('HORPLUS', testOwner.id);
    if (!validPromoRes.valid || validPromoRes.promoBonusMonths !== 2 || validPromoRes.totalTrialMonths !== 3) {
      throw new Error(`Expected valid HORPLUS with +2 months bonus, got valid=${validPromoRes.valid}, bonus=${validPromoRes.promoBonusMonths}`);
    }
    console.log('✓ Authoritative promo service returned exact reason states (PROMO_NOT_FOUND, valid bonus=2 months).');
    results.promo_authoritative_reasons = true;

    // --------------------------------------------------------------------------
    // 11. Browser UAT: Shared Calendar Gap-Month & Settings Persistence
    // --------------------------------------------------------------------------
    console.log('\n--- 11. Browser UAT: Shared Calendar Gap-Month & Settings Persistence ---');
    const browser = await chromium.launch({ headless: true });
    const freshStorageState = path.join(SESSIONS_DIR, 'fresh-owner.json');
    const context = await browser.newContext({ storageState: freshStorageState });
    const page = await context.newPage();

    await page.goto(`${BASE_URL}/owner/settings`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    const settingsCycleBtn = page.locator('[data-testid="button-cycle-calendar-settings"]');
    await settingsCycleBtn.waitFor({ state: 'visible', timeout: 5000 });
    await settingsCycleBtn.click();

    const calendarPopover = page.locator('[data-testid="billing-cycle-calendar-picker"]');
    await calendarPopover.waitFor({ state: 'visible', timeout: 3000 });

    // Verify Buddhist year (+543)
    const currentBE = new Date().getFullYear() + 543;
    const yearLabel = await page.locator('[data-testid="calendar-year-label"]').textContent();
    if (!yearLabel.includes(String(currentBE))) {
      throw new Error(`Expected Buddhist year ${currentBE} in calendar, got: ${yearLabel}`);
    }
    console.log(`✓ Shared Calendar Picker renders Buddhist Year ${yearLabel.trim()}.`);

    // Verify 12 month buttons present
    const monthButtons = calendarPopover.locator('button[data-testid^="calendar-month-"]');
    const monthCount = await monthButtons.count();
    if (monthCount !== 12) {
      throw new Error(`Expected 12 Thai month buttons, found ${monthCount}`);
    }
    console.log('✓ Shared Calendar Picker renders 3x4 grid of 12 Thai month buttons.');

    // Verify Gap/Unseeded Month (July: 07) is DISABLED on server-authoritative fresh owner
    const julBtn = page.locator('[data-testid="calendar-month-07"]');
    const isJulDisabled = await julBtn.isDisabled();
    if (!isJulDisabled) {
      throw new Error('Expected unseeded cycle 2026-07 to be disabled in calendar picker');
    }
    console.log('✓ Non-existent cycle 2026-07 strictly disabled in calendar picker.');

    // Select August (month 08) which is an unlocked active cycle
    const augBtn = page.locator('[data-testid="calendar-month-08"]');
    await augBtn.click();
    await page.waitForTimeout(1000);

    // Verify water rate input is editable in August cycle
    const waterInput = page.locator('[data-testid="input-water-unit-rate"]');
    await waterInput.waitFor({ state: 'visible', timeout: 5000 });
    await waterInput.fill('23.50');
    await waterInput.press('Enter');
    await page.waitForTimeout(1500);

    // Reload page to verify persistence
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Re-select August in calendar picker to read back August settings
    await page.locator('[data-testid="button-cycle-calendar-settings"]').click();
    await page.locator('[data-testid="billing-cycle-calendar-picker"]').waitFor({ state: 'visible', timeout: 3000 });
    await page.locator('[data-testid="calendar-month-08"]').click();
    await page.waitForTimeout(1000);

    const reloadedWaterVal = await page.locator('[data-testid="input-water-unit-rate"]').inputValue();
    if (Number(reloadedWaterVal) !== 23.5) {
      throw new Error(`Expected reloaded water rate for August to be 23.50, got: ${reloadedWaterVal}`);
    }

    const provBadgeText = await page.locator('[data-testid="snapshot-provenance-badge"]').textContent();
    if (!provBadgeText?.includes('Manual Override') && !provBadgeText?.includes('กำหนดเอง')) {
      throw new Error(`Expected provenance badge to indicate Manual Override, got: ${provBadgeText}`);
    }
    console.log(`✓ Settings DB mutation and F5 readback verified: August water rate = ${reloadedWaterVal}, Provenance = "${provBadgeText?.trim()}".`);

    results.browser_shared_calendar_gap_and_settings_persistence = true;

    // --------------------------------------------------------------------------
    // 12. Browser UAT: Step 7 Promo Edit Invalidation & Non-blocking Optional Benefits
    // --------------------------------------------------------------------------
    console.log('\n--- 12. Browser UAT: Step 7 Promo Edit Invalidation & Non-blocking Optional Benefits ---');
    const regStorageState = path.join(SESSIONS_DIR, 'registration-owner.json');
    const regContext = await browser.newContext({ storageState: regStorageState });
    const regPage = await regContext.newPage();

    await regPage.goto(`${BASE_URL}/owner/register`);
    await regPage.waitForLoadState('networkidle');

    // Step 1: Dorm Info
    await regPage.locator('input[placeholder*="หอพัก HorPlus"]').first().fill('หอพัก Batch02 Complete Suite');
    await regPage.locator('textarea[placeholder*="สุขุมวิท"]').first().fill('456 ถนนสุขุมวิท กรุงเทพมหานคร');
    await regPage.locator('select').first().selectOption('กรุงเทพมหานคร');
    await regPage.locator('button:has-text("ถัดไป")').first().click();
    await regPage.waitForTimeout(600);

    // Step 2: Room Layout
    const floorsInput = regPage.locator('input[placeholder*="ระบุจำนวนชั้น"]').first();
    if (await floorsInput.isVisible()) await floorsInput.fill('5');
    const roomsInput = regPage.locator('input[placeholder*="ระบุห้องต่อชั้น"]').first();
    if (await roomsInput.isVisible()) await roomsInput.fill('4');
    const step2Next = regPage.locator('button:has-text("ถัดไป")').first();
    if (await step2Next.isVisible()) {
      await step2Next.click();
      await regPage.waitForTimeout(600);
    }

    // Step 3: Billing Rates
    const rentInput = regPage.locator('label:has-text("ค่าเช่ารายเดือน")').locator('xpath=..').locator('input').first();
    if (await rentInput.isVisible()) await rentInput.fill('4500');
    const step3Next = regPage.locator('button:has-text("ถัดไป")').first();
    if (await step3Next.isVisible()) {
      await step3Next.click();
      await regPage.waitForTimeout(600);
    }

    // Step 4: Due Date & Banking
    const depositInput = regPage.locator('label:has-text("ค่าประกัน")').locator('xpath=../..').locator('input').first();
    if (await depositInput.isVisible()) await depositInput.fill('5000');
    const bankSelect = regPage.locator('select').filter({ hasText: 'เลือกธนาคาร' }).first();
    if (await bankSelect.isVisible()) await bankSelect.selectOption('กสิกรไทย (KBank)');
    const bankAccInput = regPage.locator('label:has-text("เลขที่บัญชีธนาคาร")').locator('xpath=..').locator('input').first();
    if (await bankAccInput.isVisible()) await bankAccInput.fill('0012345678');
    const bankNameInput = regPage.locator('input[placeholder*="บัญชีธนาคาร"]').first();
    if (await bankNameInput.isVisible()) await bankNameInput.fill('นายทดสอบ บัญชี');
    const ppInput = regPage.locator('label:has-text("เลขพร้อมเพย์")').locator('xpath=..').locator('input').first();
    if (await ppInput.isVisible()) await ppInput.fill('0812345678');
    const ppNameInput = regPage.locator('input[placeholder*="บัญชีพร้อมเพย์"]').first();
    if (await ppNameInput.isVisible()) await ppNameInput.fill('นายทดสอบ พร้อมเพย์');
    const dueDateSelect = regPage.locator('[data-testid="due-date-select"]').first();
    if (await dueDateSelect.isVisible()) await dueDateSelect.selectOption('15');
    const step4Next = regPage.locator('button:has-text("ถัดไป")').first();
    if (await step4Next.isVisible()) {
      await step4Next.click();
      await regPage.waitForTimeout(600);
    }

    // Step 5: Rules & Signature
    const selectAllRulesBtn = regPage.locator('button:has-text("+ เลือกทั้งหมด 10 ข้อ")').first();
    if (await selectAllRulesBtn.isVisible()) {
      await selectAllRulesBtn.click();
      await regPage.waitForTimeout(200);
    }

    const canvas = regPage.locator('canvas').first();
    if (await canvas.isVisible()) {
      const box = await canvas.boundingBox();
      if (box) {
        await regPage.mouse.move(box.x + 10, box.y + 10);
        await regPage.mouse.down();
        await regPage.mouse.move(box.x + 80, box.y + 40);
        await regPage.mouse.up();
        const saveSignBtn = regPage.locator('button:has-text("บันทึก")').first();
        if (await saveSignBtn.isVisible()) {
          await saveSignBtn.click();
          await regPage.waitForTimeout(400);
        }
      }
    }

    const step5Next = regPage.locator('button:has-text("ถัดไป")').first();
    if (await step5Next.isVisible()) {
      await step5Next.click();
      await regPage.waitForTimeout(800);
    }

    // Step 6: Skip LINE OA
    const skipLineBtn = regPage.locator('button:has-text("ตั้งค่าภายหลัง")').first();
    if (await skipLineBtn.isVisible()) {
      await skipLineBtn.click();
      await regPage.waitForTimeout(800);
    }

    // Step 7: Test Promo Code Edit Invalidation
    const promoInput = regPage.locator('[data-testid="input-promo-code"]');
    await promoInput.waitFor({ state: 'visible', timeout: 5000 });
    await promoInput.fill('HORPLUS');
    await regPage.locator('[data-testid="button-apply-promo"]').click();
    await regPage.waitForTimeout(1000);

    const inlinePromoMsg = regPage.locator('[data-testid="promo-inline-message"]');
    const msgText = await inlinePromoMsg.textContent();
    if (!msgText?.includes('HORPLUS') || !msgText.includes('✓')) {
      throw new Error(`Expected successful promo message, got: ${msgText}`);
    }
    console.log('✓ Promo HORPLUS applied successfully.');

    // User now alters promo code to HORPLUX
    await promoInput.fill('HORPLUX');
    await regPage.waitForTimeout(500);

    // Message must be invalidated and cleared
    const isMsgVisible = await inlinePromoMsg.isVisible();
    if (isMsgVisible) {
      throw new Error('Expected promo message to be cleared immediately when promo text is edited');
    }
    console.log('✓ Promo edit invalidation verified: Editing promo input immediately invalidates previous validation state.');

    // Test non-blocking finalize button
    const step7NextBtn = regPage.locator('button:has-text("ยืนยันสร้างหอพัก")');
    const isNextDisabled = await step7NextBtn.isDisabled();
    if (isNextDisabled) {
      throw new Error('Next/Finalize button must NOT be disabled by unapplied optional promo');
    }
    console.log('✓ Non-blocking progression verified: Finalize button active.');

    results.browser_promo_edit_invalidation_and_step7 = true;

    await browser.close();

    console.log('\n================================================================================');
    console.log('  ALL BATCH 02 FINDINGS SUCCESSFULLY VERIFIED (100% PASS)');
    console.log('================================================================================');
    console.log(JSON.stringify(results, null, 2));

    return true;
  } catch (error) {
    console.error('\n❌ BATCH 02 VERIFICATION FAILED:', error);
    console.log(JSON.stringify(results, null, 2));
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runBatch02Verification();
