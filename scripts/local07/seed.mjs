/**
 * HorPlus LOCAL-07 — Deterministic Dataset Seeder
 *
 * Provisions 2 complete UAT Dormitories:
 * 1. Fresh Owner ("หอพัก HorPlus UAT Fresh Owner")
 *    - EXERCISES REAL ONBOARDING:
 *      Pre-creates User identity -> Calls prepareProvisionalDormitory ->
 *      Saves Owner Signature via SignatureStorageService ->
 *      Simulates deferred LINE OA test boundary ->
 *      Finalizes via DormitoryProvisioningService.completeOwnerOnboarding
 *      with Free tier + HORPLUS promo redemption.
 *
 * 2. Comprehensive Owner ("หอพัก HorPlus UAT Comprehensive Manor")
 *    - 18 rooms across 2 buildings (Building A standard, Building B override rates)
 *    - 11 occupied rooms with active contracts and tenant profiles
 *    - July 2026 billing cycle with meter readings, paid bills, verified payments & receipts
 *    - 4 unpaid bills with overdue tracking
 *    - Move-out settlement pending refund (Room 204)
 *    - Contract renewal pending (Room 201) & scheduled renewal (Room 202)
 *    - Staff access grants (Manager Pranee & Tech Surachai)
 *
 * @license Apache-2.0
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { PrismaClient } = require('../../server/node_modules/@prisma/client/index.js');
const { PNG } = require('../../server/node_modules/pngjs/lib/png.js');

import { assertSafeDatabaseTarget } from './db-safety-guard.mjs';
import { FRESH_DORM, COMP_DORM, REGISTRATION_OWNER } from './constants.mjs';
import { resetLocal07Data } from './reset.mjs';
import { DormitoryProvisioningService } from '../../server/src/services/dormitory-provisioning.service.ts';
import { SignatureStorageService } from '../../server/src/services/signature-storage.service.ts';
import { SensitiveFieldService } from '../../server/src/services/sensitive-field.service.ts';
import { syncSubscriptionCatalog } from '../../server/src/scripts/subscription-catalog-sync.ts';
import { subscriptionIntentService } from '../../server/src/services/subscription-intent.service.ts';
import { BillingCycleService } from '../../server/src/services/billing-cycle.service.ts';
import { PrismaBillingCycleRepository } from '../../server/src/db/repositories/billing-cycle.repository.ts';
import { backfillRoomOperationalStatusBaseline } from '../../server/src/services/room-operational-baseline.service.ts';
import { localStorageProvider } from '../../server/src/services/local-storage.service.ts';
import { generateSyntheticSlipPng } from '../../server/src/utils/synthetic-slip.util.ts';
import { calculateCanonicalMonthlyUtility } from '../../server/src/utils/monthly-utility-calculator.util.ts';

const targetInfo = assertSafeDatabaseTarget();

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL || process.env.DATABASE_URL,
    },
  },
});

function createDeterministicSignatureBuffer() {
  const png = new PNG({ width: 60, height: 25 });
  for (let y = 0; y < 25; y++) {
    for (let x = 0; x < 60; x++) {
      const idx = (60 * y + x) << 2;
      // Draw a clean diagonal stroke
      if ((x >= 10 && x <= 50 && y >= 10 && y <= 14) || (x === y + 15)) {
        png.data[idx] = 0;       // R
        png.data[idx + 1] = 0;   // G
        png.data[idx + 2] = 0;   // B
        png.data[idx + 3] = 255; // Alpha
      } else {
        png.data[idx] = 255;
        png.data[idx + 1] = 255;
        png.data[idx + 2] = 255;
        png.data[idx + 3] = 0;   // Transparent
      }
    }
  }
  return PNG.sync.write(png);
}

export async function seedLocal07Data() {
  console.log('================================================================================');
  console.log('  HORPLUS LOCAL-07 — DETERMINISTIC DATASET SEEDER');
  console.log('================================================================================');
  console.log(`Target: ${targetInfo.host}:${targetInfo.port}/${targetInfo.database}\n`);

  // Fail-closed validation for FIELD_ENCRYPTION_KEY
  const fieldKey = process.env.FIELD_ENCRYPTION_KEY;
  if (!fieldKey || !fieldKey.trim()) {
    throw new Error('CRITICAL SECURITY ERROR: FIELD_ENCRYPTION_KEY is missing from environment! Cannot proceed with local seeding.');
  }

  // 1. Idempotent Reset of existing UAT data
  await resetLocal07Data();

  // 2. Synchronize Canonical Subscription Catalog (Plans, Packages, Promos)
  console.log('\n--- 0. Synchronizing Canonical Subscription Catalog ---');
  await syncSubscriptionCatalog(prisma);

  // 3. Seed Pre-Onboarding Manual Review Identity (Registration Owner)
  console.log('\n--- 1. Seeding Pre-Onboarding Manual Review Persona (Registration Owner) ---');
  await prisma.user.create({
    data: {
      id: REGISTRATION_OWNER.id,
      googleSubject: REGISTRATION_OWNER.googleSubject,
      email: REGISTRATION_OWNER.email,
      emailNormalized: REGISTRATION_OWNER.email.toLowerCase().trim(),
      name: REGISTRATION_OWNER.name,
      status: 'active',
    },
  });
  console.log(`✅ Registration Owner created: "${REGISTRATION_OWNER.name}" (0 memberships, ready for manual onboarding wizard)`);

  console.log('\n--- 2. Executing Real Onboarding Workflow for Fresh Owner ---');

  // A. Create ONLY the minimum prerequisite authenticated Owner identity
  const freshOwnerUser = await prisma.user.create({
    data: {
      id: FRESH_DORM.owner.id,
      googleSubject: 'mock_owner_uat_fresh',
      email: FRESH_DORM.owner.email,
      emailNormalized: FRESH_DORM.owner.email.toLowerCase().trim(),
      name: FRESH_DORM.owner.name,
      status: 'active',
    },
  });

  const sensitiveFieldService = new SensitiveFieldService(fieldKey);
  const provisioningService = new DormitoryProvisioningService(prisma, sensitiveFieldService);
  const signatureStorageService = new SignatureStorageService(prisma);

  // B. Step 1: Prepare provisional dormitory
  const prov = await provisioningService.prepareProvisionalDormitory(freshOwnerUser.id, {
    name: FRESH_DORM.name,
    addressLine1: FRESH_DORM.addressLine1,
    province: FRESH_DORM.province,
  });

  // C. Step 4: Submit deterministic signature through real signature storage service
  const sigBuffer = createDeterministicSignatureBuffer();
  await signatureStorageService.saveSignature({
    dormitoryId: prov.provisionalDormitoryId,
    userId: freshOwnerUser.id,
    buffer: sigBuffer,
  });

  // D. Step 5: Simulate external LINE OA test boundary for deferred LINE integration
  await prisma.dormitoryLineConfig.update({
    where: { dormitoryId: prov.provisionalDormitoryId },
    data: {
      accessTokenVerifiedAt: new Date(),
      webhookEndpointSetAt: new Date(),
      webhookTestSucceededAt: new Date(),
      webhookActive: true,
      isConnected: true,
    },
  });

  // E. Step 7: Create Authoritative Quote & Finalize Onboarding with TRIAL + HORPLUS promo
  const freshQuote = await subscriptionIntentService.createIntentQuote(
    freshOwnerUser.id,
    { promoCode: 'HORPLUS' },
    undefined,
    prov.provisionalDormitoryId
  );

  const onboardingResult = await provisioningService.completeOwnerOnboarding({
    userId: freshOwnerUser.id,
    idempotencyKey: 'idemp-fresh-owner-onboarding-001',
    provisionalDormitoryId: prov.provisionalDormitoryId,
    packageIntentId: freshQuote.intentId,
    dormitory: {
      name: FRESH_DORM.name,
      type: 'apartment',
      genderPolicy: 'mixed',
      addressLine1: FRESH_DORM.addressLine1,
      addressLine2: null,
      subdistrict: FRESH_DORM.subdistrict,
      district: FRESH_DORM.district,
      province: FRESH_DORM.province,
      postalCode: FRESH_DORM.postalCode,
      phone: FRESH_DORM.phone,
      email: FRESH_DORM.email,
      estimatedBuildingCount: 1,
      estimatedRoomCount: 4,
    },
    billing: {
      billingDay: FRESH_DORM.billing.billingDay,
      dueDay: FRESH_DORM.billing.dueDay,
      waterBillingType: 'per_unit',
      waterRate: String(FRESH_DORM.billing.waterRate),
      electricityBillingType: 'per_unit',
      electricityRate: String(FRESH_DORM.billing.electricityRate),
      commonFee: String(FRESH_DORM.billing.commonFee),
      commonFeeMode: 'fixed',
      internetFee: String(FRESH_DORM.billing.internetFee),
      internetFeeMode: 'fixed',
      parkingRate: String(FRESH_DORM.billing.parkingRate),
      parkingFeeMode: 'fixed',
      gracePeriodDays: 2,
      advanceRentMonths: 1,
      lateFeeType: 'none',
      lateFeeValue: '0.00',
      rentBillingType: 'monthly',
    },
    payment: {
      cashAccepted: true,
      promptPayType: FRESH_DORM.payment.promptPayType,
      promptPayValue: FRESH_DORM.payment.promptPayValue,
      bankCode: FRESH_DORM.payment.bankCode,
      bankAccountName: FRESH_DORM.payment.bankAccountName,
      bankAccountNumber: FRESH_DORM.payment.bankAccountNumber,
    },
    buildings: [
      {
        id: FRESH_DORM.building.id,
        name: FRESH_DORM.building.name,
        code: FRESH_DORM.building.code,
        floorsCount: FRESH_DORM.building.floorsCount,
        roomsPerFloor: FRESH_DORM.building.roomsPerFloor,
        monthlyRent: FRESH_DORM.building.monthlyRent,
        depositAmount: FRESH_DORM.building.depositAmount,
        termRent: FRESH_DORM.building.termRent,
        dailyRent: FRESH_DORM.building.dailyRent,
        termMonths: FRESH_DORM.building.termMonths,
        maxInstallmentMonths: FRESH_DORM.building.maxTermRentInstallments,
        maximumOccupants: FRESH_DORM.building.maximumOccupants,
      },
    ],
    rooms: FRESH_DORM.rooms.map((r) => ({
      ...r,
      buildingId: FRESH_DORM.building.id,
      status: 'VACANT',
    })),
    planCode: 'PAID',
    promoCode: 'HORPLUS',
    defaultTerms: `1. ห้ามสูบบุหรี่ภายในห้องพักและพื้นที่ส่วนกลาง
2. ห้ามส่งเสียงดังรบกวนผู้อื่นหลังเวลา 22:00 น.
3. ชำระค่าเช่าและค่าน้ำไฟตรงตามกำหนดเวลา ภายในวันที่ 5 ของทุกเดือน
4. ห้ามนำบุคคลภายนอกมาพักค้างคืนโดยไม่แจ้งเจ้าหน้าที่
5. รักษาความสะอาดและดูแลรักษาทรัพย์สินของหอพักอย่างเคร่งครัด`,
    petPolicy: {
      allowed: 'none',
      allowedTypes: [],
    },
  });

  const freshDormId = onboardingResult.dormitory.id;

  // Ensure rolling billing cycles for fresh dorm (August 2026 start month + 2 future rolling cycles)
  const freshBillingCycleService = new BillingCycleService(new PrismaBillingCycleRepository(prisma));
  await freshBillingCycleService.ensureRollingBillingCycles(freshDormId, FRESH_DORM.owner.id);

  console.log(`✅ Fresh Owner provisioned via REAL ONBOARDING: "${FRESH_DORM.name}"`);
  console.log(`   Dormitory ID: ${freshDormId}`);
  console.log(`   Rooms Created: 4 vacant rooms (101, 102, 201, 202)`);
  console.log(`   Subscription:  TRIAL (${onboardingResult.subscription?.benefitType || 'HORPLUS Promo'} active)`);
  console.log(`   Rolling Cycles: 3 cycles ensured (2026-08 Onboarding start, 2026-09 draft, 2026-10 draft)`);

  // ==========================================================================
  // SCENARIO 2: COMPREHENSIVE OWNER
  // ==========================================================================
  console.log('\n--- 2. Seeding Comprehensive Owner Scenario ---');

  // Users
  const compOwner = await prisma.user.create({
    data: {
      id: COMP_DORM.owner.id,
      googleSubject: 'mock_owner_uat_comp',
      email: COMP_DORM.owner.email,
      emailNormalized: COMP_DORM.owner.email.toLowerCase().trim(),
      name: COMP_DORM.owner.name,
      status: 'active',
    },
  });

  const compManager = await prisma.user.create({
    data: {
      id: COMP_DORM.manager.id,
      googleSubject: 'mock_manager_uat',
      email: COMP_DORM.manager.email,
      emailNormalized: COMP_DORM.manager.email.toLowerCase().trim(),
      name: COMP_DORM.manager.name,
      status: 'active',
    },
  });

  const compTech = await prisma.user.create({
    data: {
      id: COMP_DORM.tech.id,
      googleSubject: 'mock_tech_uat',
      email: COMP_DORM.tech.email,
      emailNormalized: COMP_DORM.tech.email.toLowerCase().trim(),
      name: COMP_DORM.tech.name,
      status: 'active',
    },
  });

  const tenantSomchaiUser = await prisma.user.create({
    data: {
      id: COMP_DORM.tenantSomchai.id,
      googleSubject: 'mock_tenant_somchai',
      email: COMP_DORM.tenantSomchai.email,
      emailNormalized: COMP_DORM.tenantSomchai.email.toLowerCase().trim(),
      name: COMP_DORM.tenantSomchai.name,
      status: 'active',
    },
  });

  // Dormitory
  const compDorm = await prisma.dormitory.create({
    data: {
      id: COMP_DORM.id,
      name: COMP_DORM.name,
      addressLine1: COMP_DORM.addressLine1,
      subdistrict: COMP_DORM.subdistrict,
      district: COMP_DORM.district,
      province: COMP_DORM.province,
      postalCode: COMP_DORM.postalCode,
      phone: COMP_DORM.phone,
      email: COMP_DORM.email,
      status: 'active',
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      createdByUserId: compOwner.id,
    },
  });

  // Roles
  const ownerRole = await prisma.role.create({
    data: {
      dormitoryId: compDorm.id,
      code: 'OWNER',
      name: 'เจ้าของหอพัก',
      isSystem: true,
      permissions: { all: true },
    },
  });

  const managerRole = await prisma.role.create({
    data: {
      dormitoryId: compDorm.id,
      code: 'MANAGER',
      name: 'ผู้จัดการหอพัก',
      isSystem: true,
      permissions: {
        rooms: ['view', 'manage'],
        billing: ['view', 'manage'],
        reports: ['view'],
        payments: ['view', 'manage'],
      },
    },
  });

  const staffRole = await prisma.role.create({
    data: {
      dormitoryId: compDorm.id,
      code: 'STAFF',
      name: 'พนักงานทั่วไป',
      isSystem: true,
      permissions: {
        rooms: ['view'],
        tenants: ['view'],
        maintenance: ['view', 'update'],
        meters: ['view', 'record'],
      },
    },
  });

  const tenantRole = await prisma.role.create({
    data: {
      dormitoryId: compDorm.id,
      code: 'TENANT',
      name: 'ผู้เช่า',
      isSystem: true,
      permissions: [],
    },
  });

  // Members
  await prisma.dormitoryMember.createMany({
    data: [
      { dormitoryId: compDorm.id, userId: compOwner.id, roleId: ownerRole.id, status: 'active' },
      { dormitoryId: compDorm.id, userId: compManager.id, roleId: managerRole.id, status: 'active' },
      { dormitoryId: compDorm.id, userId: compTech.id, roleId: staffRole.id, status: 'active' },
      { dormitoryId: compDorm.id, userId: tenantSomchaiUser.id, roleId: tenantRole.id, status: 'active' },
    ],
  });

  // Billing Settings
  const encPromptPay = sensitiveFieldService.encrypt(COMP_DORM.payment.promptPayValue).ciphertext;
  const encBankAccount = sensitiveFieldService.encrypt(COMP_DORM.payment.bankAccountNumber).ciphertext;

  await prisma.dormitoryBillingSettings.create({
    data: {
      dormitoryId: compDorm.id,
      billingDay: COMP_DORM.billing.billingDay,
      dueDay: COMP_DORM.billing.dueDay,
      waterBillingType: 'per_unit',
      waterRate: COMP_DORM.billing.waterRate,
      electricityBillingType: 'per_unit',
      electricityRate: COMP_DORM.billing.electricityRate,
      commonFee: COMP_DORM.billing.commonFee,
      commonFeeMode: 'fixed',
      internetFee: COMP_DORM.billing.internetFee,
      internetFeeMode: 'fixed',
      parkingRate: COMP_DORM.billing.parkingRate,
      parkingFeeMode: 'fixed',
      gracePeriodDays: 2,
      lateFeeType: COMP_DORM.billing.lateFeeType || 'fixed',
      lateFeeValue: COMP_DORM.billing.lateFeeValue || '100.00',
      cashAccepted: true,
      promptPayType: COMP_DORM.payment.promptPayType,
      promptPayValueEncrypted: encPromptPay,
      bankCode: COMP_DORM.payment.bankCode,
      bankAccountName: COMP_DORM.payment.bankAccountName,
      bankAccountNumberEncrypted: encBankAccount,
    },
  });

  // Property Defaults
  await prisma.dormitoryPropertyDefaults.create({
    data: {
      dormitoryId: compDorm.id,
      defaultMonthlyRent: 4500.0,
      defaultDeposit: 4500.0,
      defaultParkingFee: 300.0,
      defaultMaxOccupants: 2,
      defaultRoomType: 'standard',
      defaultTerms: `1. ห้ามสูบบุหรี่ภายในห้องพักและพื้นที่ส่วนกลาง
2. ห้ามส่งเสียงดังรบกวนผู้อื่นหลังเวลา 22:00 น.
3. ชำระค่าเช่าและค่าน้ำไฟตรงตามกำหนดเวลา ภายในวันที่ 5 ของทุกเดือน
4. ห้ามนำบุคคลภายนอกมาพักค้างคืนโดยไม่แจ้งเจ้าหน้าที่
5. รักษาความสะอาดและดูแลรักษาทรัพย์สินของหอพักอย่างเคร่งครัด`,
      petPolicy: {
        allowed: 'conditional',
        allowedTypes: ['cat', 'small_pet'],
      },
    },
  });

  // Subscription (Canonical PAID PRO Plan from catalog)
  const paidPlan = await prisma.subscriptionPlan.findUnique({ where: { code: 'PAID' } });
  if (!paidPlan) {
    throw new Error('CRITICAL ERROR: Canonical PAID subscription plan is missing in database after catalog synchronization!');
  }

  await prisma.dormitorySubscription.create({
    data: {
      dormitoryId: compDorm.id,
      planId: paidPlan.id,
      status: 'ACTIVE',
      startedAt: new Date('2026-01-01'),
      expiresAt: new Date('2027-01-01'),
    },
  });

  // Buildings
  const bldA = await prisma.building.create({
    data: {
      dormitoryId: compDorm.id,
      name: COMP_DORM.buildings[0].name,
      code: 'BLD-A',
      floorCount: 3,
      roomsPerFloor: 6,
      hasElevator: true,
      monthlyRent: 4500,
      depositAmount: 4500,
      termRent: 18000,
      dailyRent: 500,
      termMonths: 4,
      maxTermRentInstallments: 2,
    },
  });

  const bldB = await prisma.building.create({
    data: {
      dormitoryId: compDorm.id,
      name: COMP_DORM.buildings[1].name,
      code: 'BLD-B',
      floorCount: 2,
      roomsPerFloor: 1,
      hasElevator: false,
      monthlyRent: 5500,
      depositAmount: 5500,
      termRent: 22000,
      dailyRent: 600,
      termMonths: 4,
      maxTermRentInstallments: 2,
      waterRate: 20.0,
      electricityRate: 8.0,
    },
  });

  // 18 Rooms
  const roomData = [
    // Floor 1 (Building A)
    { roomNumber: '101', floor: 1, rent: 4500, termRent: 18000, dailyRent: 500, status: 'occupied', bldId: bldA.id },
    { roomNumber: '102', floor: 1, rent: 4500, termRent: 17500, dailyRent: 450, status: 'occupied', bldId: bldA.id },
    { roomNumber: '103', floor: 1, rent: 4500, termRent: 18000, dailyRent: 500, status: 'occupied', bldId: bldA.id },
    { roomNumber: '104', floor: 1, rent: 4500, termRent: 18000, dailyRent: 500, status: 'occupied', bldId: bldA.id },
    { roomNumber: '105', floor: 1, rent: 4500, termRent: 18000, dailyRent: 500, status: 'vacant', bldId: bldA.id },
    { roomNumber: '106', floor: 1, rent: 4500, termRent: 18000, dailyRent: 500, status: 'vacant', bldId: bldA.id },
    // Floor 2 (Building A)
    { roomNumber: '201', floor: 2, rent: 4800, termRent: 19200, dailyRent: 550, status: 'occupied', bldId: bldA.id },
    { roomNumber: '202', floor: 2, rent: 4800, termRent: 19200, dailyRent: 550, status: 'occupied', bldId: bldA.id },
    { roomNumber: '203', floor: 2, rent: 4800, termRent: 19200, dailyRent: 550, status: 'occupied', bldId: bldA.id },
    { roomNumber: '204', floor: 2, rent: 4800, termRent: 19200, dailyRent: 550, status: 'vacant', bldId: bldA.id }, // Moved out 2026-07-31, settlement pending
    { roomNumber: '205', floor: 2, rent: 4800, termRent: 19200, dailyRent: 550, status: 'vacant', bldId: bldA.id },
    { roomNumber: '206', floor: 2, rent: 4800, termRent: 19200, dailyRent: 550, status: 'maintenance', bldId: bldA.id },
    // Floor 3 (Building A)
    { roomNumber: '301', floor: 3, rent: 5000, termRent: 20000, dailyRent: 600, status: 'occupied', bldId: bldA.id },
    { roomNumber: '302', floor: 3, rent: 5000, termRent: 20000, dailyRent: 600, status: 'occupied', bldId: bldA.id },
    { roomNumber: '303', floor: 3, rent: 5000, termRent: 20000, dailyRent: 600, status: 'occupied', bldId: bldA.id },
    { roomNumber: '304', floor: 3, rent: 5000, termRent: 20000, dailyRent: 600, status: 'vacant', bldId: bldA.id },
    // Building B
    { roomNumber: 'B101', floor: 1, rent: 5500, termRent: 22000, dailyRent: 600, status: 'occupied', bldId: bldB.id },
    { roomNumber: 'B102', floor: 2, rent: 5500, termRent: 22000, dailyRent: 600, status: 'vacant', bldId: bldB.id },
  ];

  const createdRooms = {};
  for (const r of roomData) {
    const deposit = r.deposit !== undefined ? r.deposit : r.rent;
    const room = await prisma.room.create({
      data: {
        dormitoryId: compDorm.id,
        buildingId: r.bldId,
        roomNumber: r.roomNumber,
        normalizedRoomNumber: r.roomNumber.toLowerCase().trim(),
        floor: r.floor,
        roomType: 'standard',
        monthlyRent: r.rent,
        depositAmount: deposit,
        termDeposit: deposit,
        monthlyDeposit: deposit,
        dailyDeposit: deposit,
        termRent: r.termRent,
        dailyRent: r.dailyRent,
        status: r.status,
      },
    });
    createdRooms[r.roomNumber] = room;
  }

  // Tenants & Contracts
  const tenantConfigs = [
    {
      num: '101',
      name: 'นายสมชาย ใจดี',
      first: 'สมชาย',
      last: 'ใจดี',
      phone: '0812345678',
      rent: 4500,
      deposit: 4500,
      userId: tenantSomchaiUser.id,
      coOccupants: [{ name: 'นางสมหญิง ใจดี', relation: 'คู่สมรส' }],
    },
    {
      num: '102',
      name: 'นายสมศักดิ์ รักสงบ',
      first: 'สมศักดิ์',
      last: 'รักสงบ',
      phone: '0823456789',
      rent: 4500,
      deposit: 4500,
    },
    {
      num: '103',
      name: 'นางสาวอนงค์ งามยิ่ง',
      first: 'อนงค์',
      last: 'งามยิ่ง',
      phone: '0834567890',
      rent: 4500,
      deposit: 4500,
    },
    {
      num: '104',
      name: 'นายวิชัย มั่งมี',
      first: 'วิชัย',
      last: 'มั่งมี',
      phone: '0845678901',
      rent: 4500,
      deposit: 4500,
      coOccupants: [
        { name: 'นายพรชัย มั่งมี', relation: 'น้องชาย' },
        { name: 'นายกิตติ มั่งมี', relation: 'เพื่อนร่วมห้อง' },
        { name: 'นายเอก มั่งมี', relation: 'เพื่อนร่วมห้อง' },
      ],
    },
    {
      num: '201',
      name: 'นางสาวมานี มีตา',
      first: 'มานี',
      last: 'มีตา',
      phone: '0856789012',
      rent: 4800,
      deposit: 4800,
      renewalPending: true,
    },
    {
      num: '202',
      name: 'นายปิติ สบายดี',
      first: 'ปิติ',
      last: 'สบายดี',
      phone: '0867890123',
      rent: 4800,
      deposit: 4800,
      scheduledRenewal: true,
    },
    {
      num: '203',
      name: 'นางสาวชูใจ ใจอารี',
      first: 'ชูใจ',
      last: 'ใจอารี',
      phone: '0878901234',
      rent: 4800,
      deposit: 4800,
    },
    {
      num: '204',
      name: 'นายวีระ กล้าหาญ',
      first: 'วีระ',
      last: 'กล้าหาญ',
      phone: '0889012345',
      rent: 4800,
      deposit: 4800,
      isMovedOut: true,
      startDate: '2026-06-01',
      endDate: '2026-08-01',
      createdAt: '2026-07-15T08:30:00.000Z',
    },
    {
      num: '301',
      name: 'นายดนัย ดียิ่ง',
      first: 'ดนัย',
      last: 'ดียิ่ง',
      phone: '0890123456',
      rent: 5000,
      deposit: 5000,
    },
    {
      num: '302',
      name: 'นายนิรันดร์ สุขใจ',
      first: 'นิรันดร์',
      last: 'สุขใจ',
      phone: '0801234567',
      rent: 5000,
      deposit: 5000,
    },
    {
      num: '303',
      name: 'นายประเสริฐ เกิดผล',
      first: 'ประเสริฐ',
      last: 'เกิดผล',
      phone: '0811112222',
      rent: 5000,
      deposit: 5000,
    },
    {
      num: 'B101',
      name: 'นางสาวมาลัย หอมหวล',
      first: 'มาลัย',
      last: 'หอมหวล',
      phone: '0822223333',
      rent: 5500,
      deposit: 5500,
    },
  ];

  let tCount = 1;
  const createdTenants = {};
  const createdContracts = {};
  for (const tc of tenantConfigs) {
    const tCode = `TNT-${String(tCount).padStart(3, '0')}`;
    const room = createdRooms[tc.num];

    const tenantCreatedAt = tc.createdAt ? new Date(tc.createdAt) : (tc.isMovedOut ? new Date('2025-08-01T08:00:00.000Z') : new Date('2026-01-01T08:00:00.000Z'));
    const contractCreatedAt = tc.createdAt ? new Date(tc.createdAt) : (tc.isMovedOut ? new Date('2025-08-01T08:00:00.000Z') : new Date('2026-01-01T08:00:00.000Z'));
    const contractStartDate = tc.startDate ? new Date(tc.startDate) : (tc.isMovedOut ? new Date('2025-08-01') : new Date('2026-01-01'));
    const contractEndDate = tc.endDate ? new Date(tc.endDate) : (tc.isMovedOut ? new Date('2026-07-31') : new Date('2026-12-31'));

    const tenant = await prisma.tenant.create({
      data: {
        dormitoryId: compDorm.id,
        tenantNumber: tCode,
        firstName: tc.first,
        lastName: tc.last,
        displayName: tc.name,
        phone: tc.phone,
        nationalIdMasked: '1-1004-XXXXX-XX-X',
        status: tc.isMovedOut ? 'inactive' : 'active',
        linkedUserId: tc.userId || null,
        createdAt: tenantCreatedAt,
      },
    });
    createdTenants[tc.num] = tenant;

    // Contract
    const contract = await prisma.contract.create({
      data: {
        dormitoryId: compDorm.id,
        roomId: room.id,
        tenantId: tenant.id,
        contractNumber: `CTR-2026-${tc.num}`,
        startDate: contractStartDate,
        endDate: contractEndDate,
        rentAmount: tc.rent,
        depositAmount: tc.deposit,
        status: tc.isMovedOut ? 'ended' : 'active',
        createdAt: contractCreatedAt,
      },
    });
    createdContracts[tc.num] = contract;

    // Occupancy
    await prisma.occupancy.create({
      data: {
        dormitoryId: compDorm.id,
        roomId: room.id,
        tenantId: tenant.id,
        startedAt: tc.isMovedOut ? new Date('2025-08-01') : new Date('2026-01-01'),
        endedAt: tc.isMovedOut ? new Date('2026-07-31') : null,
        status: tc.isMovedOut ? 'ENDED' : 'ACTIVE',
      },
    });

    // Co-occupants
    if (tc.coOccupants) {
      for (const co of tc.coOccupants) {
        await prisma.tenantCoOccupant.create({
          data: {
            dormitoryId: compDorm.id,
            tenantId: tenant.id,
            contractId: contract.id,
            name: co.name,
            relationship: co.relation,
            status: 'active',
          },
        });
      }
    }

    // Renewal pending (Room 201)
    if (tc.renewalPending) {
      await prisma.tenantRenewalRequest.create({
        data: {
          dormitoryId: compDorm.id,
          contractId: contract.id,
          tenantId: tenant.id,
          roomId: room.id,
          requestedDurationMonths: 6,
          requestedStartDate: new Date('2027-01-01'),
          requestedEndDate: new Date('2027-06-30'),
          status: 'PENDING_OWNER_APPROVAL',
        },
      });
    }

    // Scheduled Renewal (Room 202)
    if (tc.scheduledRenewal) {
      await prisma.contract.create({
        data: {
          dormitoryId: compDorm.id,
          roomId: room.id,
          tenantId: tenant.id,
          contractNumber: `CTR-2027-202-EXT`,
          startDate: new Date('2027-01-01'),
          endDate: new Date('2027-12-31'),
          rentAmount: tc.rent,
          depositAmount: tc.deposit,
          status: 'active',
        },
      });
    }

    // Move-out Settlement (Room 204)
    if (tc.isMovedOut) {
      await prisma.contractSettlement.create({
        data: {
          dormitoryId: compDorm.id,
          contractId: contract.id,
          tenantId: tenant.id,
          roomId: room.id,
          depositAmount: 4800.0,
          unpaidBillAmount: 0.0,
          damageChargeTotal: 1500.0,
          netSettlement: 3300.0,
          settlementDirection: 'REFUND',
          settlementStatus: 'PENDING_REFUND',
        },
      });
    }

    tCount++;
  }

  // Seed a Term Provisional Rental Term (Room 105) with historical July createdAt
  const tenantPimpa = await prisma.tenant.create({
    data: {
      dormitoryId: compDorm.id,
      tenantNumber: 'TNT-013',
      firstName: 'พิมพา',
      lastName: 'สดใส',
      displayName: 'นางสาวพิมพา สดใส',
      phone: '0898887766',
      nationalIdMasked: '1-1004-XXXXX-88-8',
      status: 'active',
      createdAt: new Date('2026-07-01T09:00:00.000Z'),
    },
  });

  await prisma.provisionalRentalTerm.create({
    data: {
      dormitoryId: compDorm.id,
      roomId: createdRooms['105'].id,
      tenantId: tenantPimpa.id,
      rentalType: 'TERM',
      unitRentAmount: 4500,
      totalRentAmount: 18000,
      termInstallmentCount: 2,
      startDate: new Date('2026-07-01T00:00:00.000Z'),
      endDate: new Date('2026-10-31T00:00:00.000Z'),
      status: 'ACTIVE',
      createdAt: new Date('2026-07-01T09:00:00.000Z'),
    },
  });

  // Billing Cycles: July (2026-07 First Cycle), August (2026-08 Current), September (2026-09 Rolling)
  const compBillingCycleService = new BillingCycleService(new PrismaBillingCycleRepository(prisma));

  const cycleJulyRes = await compBillingCycleService.createBillingCycle(compDorm.id, {
    cycleCode: '2026-07',
    name: 'รอบบิล กรกฎาคม 2569',
    periodStart: '2026-07-01',
    periodEnd: '2026-07-31',
    billingDate: '2026-07-25',
    dueDate: '2026-08-05',
  }, COMP_DORM.owner.id);
  const cycleJuly = cycleJulyRes.cycle;

  // Persist authoritative status-history evidence for Room 206 (maintenance since July 2026)
  await prisma.roomOperationalStatusChange.upsert({
    where: {
      dormitory_room_effective_cycle_unique: {
        dormitoryId: compDorm.id,
        roomId: createdRooms['206'].id,
        effectiveBillingCycleId: cycleJuly.id,
      },
    },
    update: {
      status: 'maintenance',
    },
    create: {
      dormitoryId: compDorm.id,
      roomId: createdRooms['206'].id,
      effectiveBillingCycleId: cycleJuly.id,
      status: 'maintenance',
      version: 1,
    },
  });

  const cycleAugRes = await compBillingCycleService.createBillingCycle(compDorm.id, {
    cycleCode: '2026-08',
    name: 'รอบบิล สิงหาคม 2569',
    periodStart: '2026-08-01',
    periodEnd: '2026-08-31',
    billingDate: '2026-08-25',
    dueDate: '2026-09-05',
  }, COMP_DORM.owner.id);
  const cycleAug = cycleAugRes.cycle;

  const cycleSeptRes = await compBillingCycleService.createBillingCycle(compDorm.id, {
    cycleCode: '2026-09',
    name: 'รอบบิล กันยายน 2569',
    periodStart: '2026-09-01',
    periodEnd: '2026-09-30',
    billingDate: '2026-09-25',
    dueDate: '2026-10-05',
  }, COMP_DORM.owner.id);
  const cycleSept = cycleSeptRes.cycle;

  const cycleOctRes = await compBillingCycleService.createBillingCycle(compDorm.id, {
    cycleCode: '2026-10',
    name: 'รอบบิล ตุลาคม 2569',
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    billingDate: '2026-10-25',
    dueDate: '2026-11-05',
  }, COMP_DORM.owner.id);
  const cycleOct = cycleOctRes.cycle;

  // --- Seed Realistic Daily Stays & Future Reservation Scenarios ---
  // 1. Room 106: Active & Unpaid Daily Stay in August 2026
  const tenantDaily106 = await prisma.tenant.create({
    data: {
      dormitoryId: compDorm.id,
      tenantNumber: 'TNT-D-106',
      firstName: 'เอกชัย',
      lastName: 'รายวันสิงหา',
      displayName: 'เอกชัย รายวันสิงหา',
      phone: '088-777-1111',
      status: 'active',
    },
  });

  // Deterministic Bangkok Reference Time for Active August Daily Fixtures
  // Anchor to August 2026 cycle so active daily stays are deterministically situated in August
  const now = new Date('2026-08-28T12:00:00.000+07:00');
  console.log(`\n📅 Seed-time Reference Instant (Bangkok): ${now.toISOString()}`);

  const checkIn106 = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
  const checkOut106 = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const start106 = new Date(Date.UTC(checkIn106.getUTCFullYear(), checkIn106.getUTCMonth(), checkIn106.getUTCDate()));
  const end106 = new Date(Date.UTC(checkOut106.getUTCFullYear(), checkOut106.getUTCMonth(), checkOut106.getUTCDate()));

  const dailyStay106 = await prisma.dailyStay.create({
    data: {
      dormitoryId: compDorm.id,
      roomId: createdRooms['106'].id,
      tenantId: tenantDaily106.id,
      requestSource: 'OWNER',
      applicantFullName: 'เอกชัย รายวันสิงหา',
      applicantPhone: '088-777-1111',
      startDate: start106,
      endDate: end106,
      checkInAt: checkIn106,
      checkOutAt: checkOut106,
      inclusiveDayCount: 6,
      dailyRateAmount: 500.0,
      totalRentAmount: 3000.0,
      depositAmount: 500.0,
      depositDeclaredStatus: 'UNPAID',
      status: 'ACTIVE',
      approvedAt: checkIn106,
      approvedByUserId: COMP_DORM.owner.id,
    },
  });

  const dailyInvoice106 = await prisma.dailyStayInvoice.create({
    data: {
      dormitoryId: compDorm.id,
      dailyStayId: dailyStay106.id,
      invoiceNumber: 'DINV-202608-001',
      totalRentAmount: 3000.0,
      depositAmount: 500.0,
      totalAgreedAmount: 3500.0,
      outstandingAmount: 3500.0,
      status: 'ISSUED',
    },
  });

  await prisma.dailyStayInvoiceItem.createMany({
    data: [
      {
        invoiceId: dailyInvoice106.id,
        itemType: 'DAILY_RENT',
        description: 'ค่าเช่าห้องพักรายวัน 6 คืน',
        amount: 3000.0,
        status: 'OUTSTANDING',
      },
      {
        invoiceId: dailyInvoice106.id,
        itemType: 'DEPOSIT',
        description: 'เงินประกันห้องพักรายวัน',
        amount: 500.0,
        status: 'OUTSTANDING',
      },
    ],
  });

  // 2. Room 205: Checked-out & Unpaid Daily Tail in July 2026 (checked out 2026-07-28, rent unpaid)
  const tenantDaily205 = await prisma.tenant.create({
    data: {
      dormitoryId: compDorm.id,
      tenantNumber: 'TNT-D-205',
      firstName: 'วรพจน์',
      lastName: 'ติดค้างรายวัน',
      displayName: 'วรพจน์ ติดค้างรายวัน',
      phone: '088-777-2222',
      status: 'checked_out',
    },
  });

  const dailyStay205 = await prisma.dailyStay.create({
    data: {
      dormitoryId: compDorm.id,
      roomId: createdRooms['205'].id,
      tenantId: tenantDaily205.id,
      requestSource: 'OWNER',
      applicantFullName: 'วรพจน์ ติดค้างรายวัน',
      applicantPhone: '088-777-2222',
      startDate: new Date('2026-07-25T00:00:00.000Z'),
      endDate: new Date('2026-07-28T00:00:00.000Z'),
      checkInAt: new Date('2026-07-25T14:00:00.000+07:00'),
      checkOutAt: new Date('2026-07-29T00:00:00.000+07:00'),
      actualCheckedOutAt: new Date('2026-07-28T11:00:00.000+07:00'),
      checkedOutByUserId: COMP_DORM.owner.id,
      inclusiveDayCount: 4,
      dailyRateAmount: 550.0,
      totalRentAmount: 2200.0,
      depositAmount: 500.0,
      depositDeclaredStatus: 'UNPAID',
      status: 'CHECKED_OUT',
      approvedAt: new Date('2026-07-25T14:00:00.000+07:00'),
      approvedByUserId: COMP_DORM.owner.id,
    },
  });

  const dailyInvoice205 = await prisma.dailyStayInvoice.create({
    data: {
      dormitoryId: compDorm.id,
      dailyStayId: dailyStay205.id,
      invoiceNumber: 'DINV-202607-001',
      totalRentAmount: 2200.0,
      depositAmount: 500.0,
      totalAgreedAmount: 2700.0,
      outstandingAmount: 2200.0,
      status: 'ISSUED',
    },
  });

  await prisma.dailyStayInvoiceItem.createMany({
    data: [
      {
        invoiceId: dailyInvoice205.id,
        itemType: 'DAILY_RENT',
        description: 'ค่าเช่าห้องพักรายวัน 4 คืน (ค้างชำระ)',
        amount: 2200.0,
        status: 'OUTSTANDING',
      },
      {
        invoiceId: dailyInvoice205.id,
        itemType: 'DEPOSIT',
        description: 'เงินประกันห้องพักรายวัน',
        amount: 500.0,
        status: 'DECLARED_PAID',
        paidAt: new Date('2026-07-25T14:00:00.000+07:00'),
      },
    ],
  });

  // 3. Room B102: Historical Paid Daily Stay in July 2026 (checked out 2026-07-20, fully paid)
  const tenantDailyB102 = await prisma.tenant.create({
    data: {
      dormitoryId: compDorm.id,
      tenantNumber: 'TNT-D-B102',
      firstName: 'ชาตรี',
      lastName: 'จ่ายครบรายวัน',
      displayName: 'ชาตรี จ่ายครบรายวัน',
      phone: '088-777-3333',
      status: 'checked_out',
    },
  });

  const dailyStayB102 = await prisma.dailyStay.create({
    data: {
      dormitoryId: compDorm.id,
      roomId: createdRooms['B102'].id,
      tenantId: tenantDailyB102.id,
      requestSource: 'OWNER',
      applicantFullName: 'ชาตรี จ่ายครบรายวัน',
      applicantPhone: '088-777-3333',
      startDate: new Date('2026-07-15T00:00:00.000Z'),
      endDate: new Date('2026-07-20T00:00:00.000Z'),
      checkInAt: new Date('2026-07-15T14:00:00.000+07:00'),
      checkOutAt: new Date('2026-07-21T00:00:00.000+07:00'),
      actualCheckedOutAt: new Date('2026-07-20T10:00:00.000+07:00'),
      checkedOutByUserId: COMP_DORM.owner.id,
      inclusiveDayCount: 6,
      dailyRateAmount: 600.0,
      totalRentAmount: 3600.0,
      depositAmount: 600.0,
      depositDeclaredStatus: 'PAID',
      status: 'COMPLETED',
      approvedAt: new Date('2026-07-15T14:00:00.000+07:00'),
      approvedByUserId: COMP_DORM.owner.id,
    },
  });

  const dailyInvoiceB102 = await prisma.dailyStayInvoice.create({
    data: {
      dormitoryId: compDorm.id,
      dailyStayId: dailyStayB102.id,
      invoiceNumber: 'DINV-202607-002',
      totalRentAmount: 3600.0,
      depositAmount: 600.0,
      totalAgreedAmount: 4200.0,
      outstandingAmount: 0.0,
      status: 'SETTLED',
    },
  });

  await prisma.dailyStayInvoiceItem.createMany({
    data: [
      {
        invoiceId: dailyInvoiceB102.id,
        itemType: 'DAILY_RENT',
        description: 'ค่าเช่าห้องพักรายวัน 6 คืน (ชำระแล้ว)',
        amount: 3600.0,
        status: 'SETTLED',
        paidAt: new Date('2026-07-15T14:30:00.000+07:00'),
      },
      {
        invoiceId: dailyInvoiceB102.id,
        itemType: 'DEPOSIT',
        description: 'เงินประกันห้องพักรายวัน (ชำระแล้ว)',
        amount: 600.0,
        status: 'SETTLED',
        paidAt: new Date('2026-07-15T14:30:00.000+07:00'),
      },
    ],
  });

  // 4. Room 206: Active & Paid Daily Stay in August 2026 (checked in Aug 20, checkout Aug 26, rent and deposit paid)
  const tenantDaily206 = await prisma.tenant.create({
    data: {
      dormitoryId: compDorm.id,
      tenantNumber: 'TNT-D-206',
      firstName: 'กิตติศักดิ์',
      lastName: 'จ่ายครบรายวันสิงหา',
      displayName: 'กิตติศักดิ์ จ่ายครบรายวันสิงหา',
      phone: '088-777-5555',
      status: 'active',
    },
  });

  const checkIn206 = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
  const checkOut206 = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000);
  const start206 = new Date(Date.UTC(checkIn206.getUTCFullYear(), checkIn206.getUTCMonth(), checkIn206.getUTCDate()));
  const end206 = new Date(Date.UTC(checkOut206.getUTCFullYear(), checkOut206.getUTCMonth(), checkOut206.getUTCDate()));

  const dailyStay206 = await prisma.dailyStay.create({
    data: {
      dormitoryId: compDorm.id,
      roomId: createdRooms['206'].id,
      tenantId: tenantDaily206.id,
      requestSource: 'OWNER',
      applicantFullName: 'กิตติศักดิ์ จ่ายครบรายวันสิงหา',
      applicantPhone: '088-777-5555',
      startDate: start206,
      endDate: end206,
      checkInAt: checkIn206,
      checkOutAt: checkOut206,
      inclusiveDayCount: 7,
      dailyRateAmount: 550.0,
      totalRentAmount: 3850.0,
      depositAmount: 500.0,
      depositDeclaredStatus: 'PAID',
      status: 'ACTIVE',
      approvedAt: checkIn206,
      approvedByUserId: COMP_DORM.owner.id,
    },
  });

  const dailyInvoice206 = await prisma.dailyStayInvoice.create({
    data: {
      dormitoryId: compDorm.id,
      dailyStayId: dailyStay206.id,
      invoiceNumber: 'DINV-202608-002',
      totalRentAmount: 3850.0,
      depositAmount: 500.0,
      totalAgreedAmount: 4350.0,
      outstandingAmount: 0.0,
      status: 'SETTLED',
    },
  });

  await prisma.dailyStayInvoiceItem.createMany({
    data: [
      {
        invoiceId: dailyInvoice206.id,
        itemType: 'DAILY_RENT',
        description: 'ค่าเช่าห้องพักรายวัน 7 คืน (ชำระแล้ว)',
        amount: 3850.0,
        status: 'SETTLED',
        paidAt: new Date('2026-08-20T14:30:00.000+07:00'),
      },
      {
        invoiceId: dailyInvoice206.id,
        itemType: 'DEPOSIT',
        description: 'เงินประกันห้องพักรายวัน (ชำระแล้ว)',
        amount: 500.0,
        status: 'SETTLED',
        paidAt: new Date('2026-08-20T14:30:00.000+07:00'),
      },
    ],
  });

  // 5. Future Reservation on Room 205 starting Sept 15 (leaving Aug and Sept 1–14 as bookable gaps)
  const tenantResv205 = await prisma.tenant.create({
    data: {
      dormitoryId: compDorm.id,
      tenantNumber: 'TNT-RESV-205',
      firstName: 'มนัส',
      lastName: 'จองล่วงหน้า',
      displayName: 'มนัส จองล่วงหน้า',
      phone: '088-777-4444',
      status: 'active',
    },
  });

  await prisma.provisionalRentalTerm.create({
    data: {
      dormitoryId: compDorm.id,
      roomId: createdRooms['205'].id,
      tenantId: tenantResv205.id,
      rentalType: 'MONTHLY',
      startDate: new Date('2026-09-15T00:00:00.000Z'),
      endDate: new Date('2027-01-14T00:00:00.000Z'),
      durationMonths: 4,
      unitRentAmount: 4800.0,
      totalRentAmount: 19200.0,
      status: 'RESERVED',
      createdByUserId: COMP_DORM.owner.id,
    },
  });

  // Meter Readings for July 2026
  const meterFacts = [
    { roomNum: '101', prevWater: 100, curWater: 110, prevElec: 500, curElec: 560 }, // W: 10, E: 60
    { roomNum: '102', prevWater: 80, curWater: 90, prevElec: 400, curElec: 460 },   // W: 10, E: 60
    { roomNum: '103', prevWater: 60, curWater: 68, prevElec: 320, curElec: 368 },   // W: 8, E: 48
    { roomNum: '104', prevWater: 120, curWater: 138, prevElec: 600, curElec: 720 }, // W: 18, E: 120
    { roomNum: '201', prevWater: 70, curWater: 82, prevElec: 350, curElec: 420 },   // W: 12, E: 70
    { roomNum: '202', prevWater: 90, curWater: 100, prevElec: 450, curElec: 515 },  // W: 10, E: 65
    { roomNum: '203', prevWater: 85, curWater: 97, prevElec: 410, curElec: 485 },   // W: 12, E: 75
    { roomNum: '301', prevWater: 110, curWater: 124, prevElec: 520, curElec: 600 }, // W: 14, E: 80
    { roomNum: '302', prevWater: 95, curWater: 110, prevElec: 480, curElec: 570 },  // W: 15, E: 90
    { roomNum: '303', prevWater: 50, curWater: 62, prevElec: 300, curElec: 385 },   // W: 12, E: 85
    { roomNum: 'B101', prevWater: 40, curWater: 55, prevElec: 200, curElec: 300 },  // W: 15, E: 100
  ];

  const augMeterMap = {
    '101': { prevWater: 110, curWater: 121, prevElec: 560, curElec: 620, parking: 1 }, // W: 11, E: 60, P: 1
    '102': { prevWater: 90, curWater: 100, prevElec: 460, curElec: 515, parking: 0 },  // W: 10, E: 55, P: 0
    '103': { prevWater: 68, curWater: 76, prevElec: 368, curElec: 420, parking: 1 },   // W: 8, E: 52, P: 1
    '104': { prevWater: 138, curWater: 138, prevElec: 720, curElec: 720, parking: 0 }, // Legacy combined fixture
    '201': { prevWater: 82, curWater: 94, prevElec: 420, curElec: 490, parking: 0 },   // W: 12, E: 70, P: 0
    '202': { prevWater: 100, curWater: 105, prevElec: 515, curElec: 645, parking: 0 }, // W: 5, E: 130, P: 0
    '203': { prevWater: 97, curWater: 107, prevElec: 485, curElec: 555, parking: 0 },  // W: 10, E: 70, P: 0
    '301': { prevWater: 124, curWater: 138, prevElec: 600, curElec: 680, parking: 1 }, // W: 14, E: 80, P: 1
    '302': { prevWater: 110, curWater: 125, prevElec: 570, curElec: 660, parking: 0 }, // W: 15, E: 90, P: 0
    '303': { prevWater: 62, curWater: 74, prevElec: 385, curElec: 470, parking: 0 },   // W: 12, E: 85, P: 0
    'B101': { prevWater: 55, curWater: 70, prevElec: 300, curElec: 400, parking: 1 },  // W: 15, E: 100, P: 1
  };

  for (const mf of meterFacts) {
    const room = createdRooms[mf.roomNum];

    // Meter Devices
    const waterDevice = await prisma.meterDevice.create({
      data: {
        dormitoryId: compDorm.id,
        roomId: room.id,
        type: 'water',
        meterNumber: `WM-${mf.roomNum}`,
        initialReading: mf.prevWater,
        currentReading: augMeterMap[mf.roomNum]?.curWater ?? mf.curWater,
      },
    });

    const elecDevice = await prisma.meterDevice.create({
      data: {
        dormitoryId: compDorm.id,
        roomId: room.id,
        type: 'electricity',
        meterNumber: `EM-${mf.roomNum}`,
        initialReading: mf.prevElec,
        currentReading: augMeterMap[mf.roomNum]?.curElec ?? mf.curElec,
      },
    });

    // July 2026 Water Reading
    await prisma.meterReading.create({
      data: {
        dormitoryId: compDorm.id,
        roomId: room.id,
        meterDeviceId: waterDevice.id,
        billingCycleId: cycleJuly.id,
        meterType: 'water',
        previousReading: mf.prevWater,
        currentReading: mf.curWater,
        usageUnits: mf.curWater - mf.prevWater,
        readAt: new Date('2026-07-24'),
      },
    });

    // July 2026 Electric Reading
    await prisma.meterReading.create({
      data: {
        dormitoryId: compDorm.id,
        roomId: room.id,
        meterDeviceId: elecDevice.id,
        billingCycleId: cycleJuly.id,
        meterType: 'electricity',
        previousReading: mf.prevElec,
        currentReading: mf.curElec,
        usageUnits: mf.curElec - mf.prevElec,
        readAt: new Date('2026-07-24'),
      },
    });

    // August 2026 Meter Readings
    const augM = augMeterMap[mf.roomNum];
    if (augM) {
      await prisma.meterReading.create({
        data: {
          dormitoryId: compDorm.id,
          roomId: room.id,
          meterDeviceId: waterDevice.id,
          billingCycleId: cycleAug.id,
          meterType: 'water',
          previousReading: augM.prevWater,
          currentReading: augM.curWater,
          usageUnits: augM.curWater - augM.prevWater,
          readAt: new Date('2026-08-24'),
        },
      });

      await prisma.meterReading.create({
        data: {
          dormitoryId: compDorm.id,
          roomId: room.id,
          meterDeviceId: elecDevice.id,
          billingCycleId: cycleAug.id,
          meterType: 'electricity',
          previousReading: augM.prevElec,
          currentReading: augM.curElec,
          usageUnits: augM.curElec - augM.prevElec,
          readAt: new Date('2026-08-24'),
        },
      });
    }
  }

  // July 2026 Bills
  const billFacts = [
    { roomNum: '101', rent: 4500, wUnits: 10, wRate: 18, eUnits: 60, eRate: 7, common: 200, internet: 150, parking: 0, surcharge: 0, paid: true, rcpNum: 'RCP-202607-001' },
    { roomNum: '102', rent: 4500, wUnits: 10, wRate: 18, eUnits: 60, eRate: 7, common: 200, internet: 150, parking: 0, surcharge: 0, paid: false },
    { roomNum: '103', rent: 4500, wUnits: 8, wRate: 18, eUnits: 48, eRate: 7, common: 200, internet: 0, parking: 300, surcharge: 0, paid: true, rcpNum: 'RCP-202607-002' },
    { roomNum: '104', rent: 4500, wUnits: 18, wRate: 18, eUnits: 120, eRate: 7, common: 200, internet: 0, parking: 0, surcharge: 0, paid: false },
    { roomNum: '201', rent: 4800, wUnits: 12, wRate: 18, eUnits: 70, eRate: 7, common: 200, internet: 150, parking: 0, surcharge: 0, paid: true, rcpNum: 'RCP-202607-003' },
    { roomNum: '202', rent: 4800, wUnits: 10, wRate: 18, eUnits: 65, eRate: 7, common: 200, internet: 0, parking: 0, surcharge: 0, paid: true, rcpNum: 'RCP-202607-004' },
    { roomNum: '203', rent: 4800, wUnits: 12, wRate: 18, eUnits: 75, eRate: 7, common: 200, internet: 150, parking: 0, surcharge: 0, paid: false },
    { roomNum: '301', rent: 5000, wUnits: 14, wRate: 18, eUnits: 80, eRate: 7, common: 200, internet: 0, parking: 300, surcharge: 0, paid: true, rcpNum: 'RCP-202607-005' },
    { roomNum: '302', rent: 5000, wUnits: 15, wRate: 18, eUnits: 90, eRate: 7, common: 200, internet: 0, parking: 0, surcharge: 0, paid: false },
    { roomNum: '303', rent: 5000, wUnits: 12, wRate: 18, eUnits: 85, eRate: 7, common: 200, internet: 150, parking: 0, surcharge: 0, paid: true, rcpNum: 'RCP-202607-006' },
    { roomNum: 'B101', rent: 5500, wUnits: 15, wRate: 20, eUnits: 100, eRate: 8, common: 200, internet: 0, parking: 300, surcharge: 0, paid: true, rcpNum: 'RCP-202607-007' },
  ];

  let bCount = 1;
  for (const bf of billFacts) {
    const room = createdRooms[bf.roomNum];
    const tenant = createdTenants[bf.roomNum];
    const billNumber = `INV-202607-${String(bCount).padStart(3, '0')}`;

    const waterTotal = bf.wUnits * bf.wRate;
    const elecTotal = bf.eUnits * bf.eRate;
    const subtotal = bf.rent + waterTotal + elecTotal + bf.common + bf.internet + bf.parking + bf.surcharge;

    const bill = await prisma.bill.create({
      data: {
        dormitoryId: compDorm.id,
        billingCycleId: cycleJuly.id,
        roomId: room.id,
        tenantId: tenant.id,
        contractId: createdContracts[bf.roomNum]?.id || null,
        billNumber,
        billKind: 'LEGACY_COMBINED',
        billingDate: new Date('2026-07-25'),
        dueDate: new Date('2026-08-05'),
        subtotal,
        totalAmount: subtotal,
        paidAmount: bf.paid ? subtotal : (bf.partial ? bf.paidAmt : 0.0),
        outstandingAmount: bf.paid ? 0.0 : (bf.partial ? (subtotal - bf.paidAmt) : subtotal),
        status: bf.paid ? 'paid' : (bf.partial ? 'partial' : 'unpaid'),
      },
    });

    // Bill Items with explicit units
    const items = [
      { type: 'rent', description: `ค่าเช่าห้องพัก ${bf.roomNum}`, quantity: 1, unit: 'month', unitPrice: bf.rent, amount: bf.rent },
      { type: 'water', description: `ค่าน้ำ (${bf.wUnits} หน่วย @ ฿${bf.wRate})`, quantity: bf.wUnits, unit: 'unit', unitPrice: bf.wRate, amount: waterTotal },
      { type: 'electric', description: `ค่าไฟฟ้า (${bf.eUnits} หน่วย @ ฿${bf.eRate})`, quantity: bf.eUnits, unit: 'unit', unitPrice: bf.eRate, amount: elecTotal },
      { type: 'common', description: 'ค่าส่วนกลาง', quantity: 1, unit: 'room', unitPrice: bf.common, amount: bf.common },
    ];

    if (bf.internet > 0) {
      items.push({ type: 'internet', description: 'ค่าอินเทอร์เน็ต', quantity: 1, unit: 'room', unitPrice: bf.internet, amount: bf.internet });
    }
    if (bf.parking > 0) {
      items.push({ type: 'parking', description: 'ค่าที่จอดรถยนต์', quantity: 1, unit: 'room', unitPrice: bf.parking, amount: bf.parking });
    }

    for (const it of items) {
      await prisma.billItem.create({
        data: {
          dormitoryId: compDorm.id,
          billId: bill.id,
          type: it.type,
          description: it.description,
          quantity: it.quantity,
          unit: it.unit,
          unitPrice: it.unitPrice,
          amount: it.amount,
        },
      });
    }

    // Paid Bill -> Verified Payment & Receipt
    if (bf.paid) {
      const payment = await prisma.payment.create({
        data: {
          dormitoryId: compDorm.id,
          billId: bill.id,
          tenantId: tenant.id,
          amount: subtotal,
          method: 'promptpay',
          status: 'verified',
          paymentDate: new Date('2026-07-28T14:30:00Z'),
        },
      });

      await prisma.receipt.create({
        data: {
          dormitoryId: compDorm.id,
          billId: bill.id,
          paymentId: payment.id,
          receiptNumber: bf.rcpNum,
          snapshotData: {
            billNumber: bill.billNumber,
            roomNumber: bf.roomNum,
            tenantName: tenant.displayName,
            totalAmount: subtotal,
            items: items,
          },
          issuedAt: new Date('2026-07-28T14:35:00Z'),
          isVoided: false,
        },
      });
    }

    bCount++;
  }

  // Seed Room 101 Start-Cycle Deposit Bill in July 2026 (Paid via canonical evidence)
  const bill101Dep = await prisma.bill.create({
    data: {
      dormitoryId: compDorm.id,
      billingCycleId: cycleJuly.id,
      roomId: createdRooms['101'].id,
      tenantId: createdTenants['101'].id,
      contractId: createdContracts['101']?.id || null,
      billNumber: 'INV-202607-101-D',
      billKind: 'DEPOSIT',
      billingDate: new Date('2026-07-01'),
      dueDate: new Date('2026-07-10'),
      subtotal: 4500.0,
      totalAmount: 4500.0,
      paidAmount: 4500.0,
      outstandingAmount: 0.0,
      status: 'paid',
      paidAt: new Date('2026-07-05T14:30:00Z'),
    },
  });
  await prisma.billItem.create({
    data: {
      dormitoryId: compDorm.id,
      billId: bill101Dep.id,
      type: 'deposit',
      description: 'เงินประกันสัญญาเช่า 101',
      quantity: 1,
      unit: 'room',
      unitPrice: 4500,
      amount: 4500,
    },
  });
  const pay101Dep = await prisma.payment.create({
    data: {
      dormitoryId: compDorm.id,
      billId: bill101Dep.id,
      tenantId: createdTenants['101'].id,
      amount: 4500.0,
      method: 'promptpay',
      status: 'APPROVED',
      paymentDate: new Date('2026-07-05T14:30:00Z'),
      reviewedByUserId: COMP_DORM.owner.id,
      reviewedAt: new Date('2026-07-05T14:30:00Z'),
    },
  });
  await prisma.paymentStatusHistory.create({
    data: {
      dormitoryId: compDorm.id,
      paymentId: pay101Dep.id,
      fromStatus: null,
      toStatus: 'APPROVED',
      changedByUserId: COMP_DORM.owner.id,
      createdAt: new Date('2026-07-05T14:30:00Z'),
    },
  });
  await prisma.billStatusHistory.create({
    data: {
      dormitoryId: compDorm.id,
      billId: bill101Dep.id,
      fromStatus: 'unpaid',
      toStatus: 'PAID',
      changedByUserId: COMP_DORM.owner.id,
      createdAt: new Date('2026-07-05T14:30:00Z'),
    },
  });
  await prisma.receipt.create({
    data: {
      dormitoryId: compDorm.id,
      billId: bill101Dep.id,
      paymentId: pay101Dep.id,
      receiptNumber: 'RCP-202607-101-D',
      snapshotData: {
        billNumber: bill101Dep.billNumber,
        roomNumber: '101',
        tenantName: createdTenants['101'].displayName,
        totalAmount: 4500.0,
        items: [{ type: 'deposit', description: 'เงินประกันสัญญาเช่า 101', unit: 'room', quantity: 1, unitPrice: 4500, amount: 4500 }],
      },
      issuedAt: new Date('2026-07-05T14:35:00Z'),
      isVoided: false,
    },
  });

  // Seed Room 102 July Deposit Bill (Unpaid - deterministic รอชำระ fixture)
  const bill102Dep = await prisma.bill.create({
    data: {
      dormitoryId: compDorm.id,
      billingCycleId: cycleJuly.id,
      roomId: createdRooms['102'].id,
      tenantId: createdTenants['102'].id,
      contractId: createdContracts['102']?.id || null,
      billNumber: 'INV-202607-102-D',
      billKind: 'DEPOSIT',
      billingDate: new Date('2026-07-01'),
      dueDate: new Date('2026-07-10'),
      subtotal: 4500.0,
      totalAmount: 4500.0,
      paidAmount: 0.0,
      outstandingAmount: 4500.0,
      status: 'unpaid',
    },
  });
  await prisma.billItem.create({
    data: {
      dormitoryId: compDorm.id,
      billId: bill102Dep.id,
      type: 'deposit',
      description: 'เงินประกันสัญญาเช่า 102',
      quantity: 1,
      unit: 'room',
      unitPrice: 4500,
      amount: 4500,
    },
  });

  // Seed Room 103 July Deposit Bill (Unpaid)
  const bill103Dep = await prisma.bill.create({
    data: {
      dormitoryId: compDorm.id,
      billingCycleId: cycleJuly.id,
      roomId: createdRooms['103'].id,
      tenantId: createdTenants['103'].id,
      contractId: createdContracts['103']?.id || null,
      billNumber: 'INV-202607-103-D',
      billKind: 'DEPOSIT',
      billingDate: new Date('2026-07-01'),
      dueDate: new Date('2026-07-10'),
      subtotal: 4500.0,
      totalAmount: 4500.0,
      paidAmount: 0.0,
      outstandingAmount: 4500.0,
      status: 'unpaid',
    },
  });
  await prisma.billItem.create({
    data: {
      dormitoryId: compDorm.id,
      billId: bill103Dep.id,
      type: 'deposit',
      description: 'เงินประกันสัญญาเช่า 103',
      quantity: 1,
      unit: 'room',
      unitPrice: 4500,
      amount: 4500,
    },
  });

  // Seed Room 201 July Deposit Bill (Unpaid)
  const bill201Dep = await prisma.bill.create({
    data: {
      dormitoryId: compDorm.id,
      billingCycleId: cycleJuly.id,
      roomId: createdRooms['201'].id,
      tenantId: createdTenants['201'].id,
      contractId: createdContracts['201']?.id || null,
      billNumber: 'INV-202607-201-D',
      billKind: 'DEPOSIT',
      billingDate: new Date('2026-07-01'),
      dueDate: new Date('2026-07-10'),
      subtotal: 4800.0,
      totalAmount: 4800.0,
      paidAmount: 0.0,
      outstandingAmount: 4800.0,
      status: 'unpaid',
    },
  });
  await prisma.billItem.create({
    data: {
      dormitoryId: compDorm.id,
      billId: bill201Dep.id,
      type: 'deposit',
      description: 'เงินประกันสัญญาเช่า 201',
      quantity: 1,
      unit: 'room',
      unitPrice: 4800,
      amount: 4800,
    },
  });

  // Seed Room 203 July Deposit Bill (Unpaid)
  const bill203Dep = await prisma.bill.create({
    data: {
      dormitoryId: compDorm.id,
      billingCycleId: cycleJuly.id,
      roomId: createdRooms['203'].id,
      tenantId: createdTenants['203'].id,
      contractId: createdContracts['203']?.id || null,
      billNumber: 'INV-202607-203-D',
      billKind: 'DEPOSIT',
      billingDate: new Date('2026-07-01'),
      dueDate: new Date('2026-07-10'),
      subtotal: 4800.0,
      totalAmount: 4800.0,
      paidAmount: 0.0,
      outstandingAmount: 4800.0,
      status: 'unpaid',
    },
  });
  await prisma.billItem.create({
    data: {
      dormitoryId: compDorm.id,
      billId: bill203Dep.id,
      type: 'deposit',
      description: 'เงินประกันสัญญาเช่า 203',
      quantity: 1,
      unit: 'room',
      unitPrice: 4800,
      amount: 4800,
    },
  });

  // Seed Room 101 July 2026 Snapshot with 1 person (Section 7: People-Count difference fixture; current household = 2)
  await prisma.roomBillingCycleSnapshot.upsert({
    where: {
      dormitory_billing_cycle_room_unique: {
        dormitoryId: compDorm.id,
        billingCycleId: cycleJuly.id,
        roomId: createdRooms['101'].id,
      },
    },
    create: {
      dormitoryId: compDorm.id,
      billingCycleId: cycleJuly.id,
      roomId: createdRooms['101'].id,
      peopleCount: 1,
      source: 'HOUSEHOLD_SYNC',
    },
    update: {
      peopleCount: 1,
      source: 'HOUSEHOLD_SYNC',
    },
  });

  // August 2026 Authoritative Snapshot & Canonical Monthly Utility Generation
  const augSnapshot = await prisma.billingRateSnapshot.findUniqueOrThrow({
    where: { billingCycleId: cycleAug.id },
  });

  async function seedCanonicalMonthlyUtility({
    roomNum,
    billNumber,
    waterReading,
    electricReading,
    peopleCount = 1,
    parkingQuantity = 0,
    otherFees = [],
    dueDate = new Date('2026-09-05'),
    asOfDate = new Date('2026-08-25'),
    status = 'unpaid',
    paidAmount = 0,
    paidAt = null,
  }) {
    const room = createdRooms[roomNum];
    const tenant = createdTenants[roomNum];
    const contract = createdContracts[roomNum];

    // Building B rate override
    const effectiveSnapshot = room.buildingId === bldB.id
      ? { ...augSnapshot, waterRate: '20.00', electricityRate: '8.00' }
      : augSnapshot;

    const calcResult = calculateCanonicalMonthlyUtility({
      rateSnapshot: effectiveSnapshot,
      waterReading,
      electricReading,
      peopleCount,
      parkingQuantity,
      otherFees,
      dueDate,
      asOfDate,
    });

    const subtotal = Number(calcResult.monthlyUtilityTotal);
    const totalAmount = subtotal;
    const outstandingAmount = Math.max(0, totalAmount - paidAmount);

    const bill = await prisma.bill.create({
      data: {
        dormitoryId: compDorm.id,
        billingCycleId: cycleAug.id,
        roomId: room.id,
        tenantId: tenant.id,
        contractId: contract?.id || null,
        billNumber,
        billKind: 'MONTHLY_UTILITY',
        billingDate: new Date('2026-08-25'),
        dueDate,
        subtotal,
        totalAmount,
        paidAmount,
        outstandingAmount,
        status,
        paidAt,
      },
    });

    for (const it of calcResult.items) {
      await prisma.billItem.create({
        data: {
          dormitoryId: compDorm.id,
          billId: bill.id,
          type: it.type,
          description: it.description,
          quantity: Number(it.quantity),
          unit: it.unit,
          unitPrice: Number(it.unitPrice),
          amount: Number(it.amount),
        },
      });
    }

    return { bill, calcResult, subtotal, items: calcResult.items };
  }

  // Room 101 August Utility: ฿1,268.00 (unpaid)
  const res101 = await seedCanonicalMonthlyUtility({
    roomNum: '101',
    billNumber: 'INV-202608-101',
    waterReading: { previousReading: 110, currentReading: 121 },
    electricReading: { previousReading: 560, currentReading: 620 },
    parkingQuantity: 1,
  });
  const bill101Aug = res101.bill;

  // Room 102 August Utility: ฿915.00 (unpaid) -> will have Pending Review Slip #2
  const res102 = await seedCanonicalMonthlyUtility({
    roomNum: '102',
    billNumber: 'INV-202608-102-U',
    waterReading: { previousReading: 90, currentReading: 100 },
    electricReading: { previousReading: 460, currentReading: 515 },
    parkingQuantity: 0,
  });
  const bill102Aug = res102.bill;

  // Room 103 August Utility: ฿1,158.00 (unpaid) -> will have Rejected Slip #1 (transfer ฿1,000 mismatch)
  const res103 = await seedCanonicalMonthlyUtility({
    roomNum: '103',
    billNumber: 'INV-202608-103-U',
    waterReading: { previousReading: 68, currentReading: 76 },
    electricReading: { previousReading: 368, currentReading: 420 },
    parkingQuantity: 1,
  });
  const bill103Aug = res103.bill;

  // Room 203 August Rent PARTIAL (total ฿4,800, paid ฿2,000, outstanding ฿2,800)
  const bill203Rent = await prisma.bill.create({
    data: {
      dormitoryId: compDorm.id,
      billingCycleId: cycleAug.id,
      roomId: createdRooms['203'].id,
      tenantId: createdTenants['203'].id,
      contractId: createdContracts['203']?.id || null,
      billNumber: 'INV-202608-203-R',
      billKind: 'RENT',
      billingDate: new Date('2026-08-25'),
      dueDate: new Date('2026-09-05'),
      subtotal: 4800.0,
      totalAmount: 4800.0,
      paidAmount: 2000.0,
      outstandingAmount: 2800.0,
      status: 'partial',
    },
  });
  await prisma.billItem.create({
    data: {
      dormitoryId: compDorm.id,
      billId: bill203Rent.id,
      type: 'rent',
      description: 'ค่าเช่าห้องพัก 203 (ชำระบางส่วน)',
      quantity: 1,
      unit: 'month',
      unitPrice: 4800,
      amount: 4800,
    },
  });

  // Room 201 Rent
  const bill201Rent = await prisma.bill.create({
    data: {
      dormitoryId: compDorm.id,
      billingCycleId: cycleAug.id,
      roomId: createdRooms['201'].id,
      tenantId: createdTenants['201'].id,
      contractId: createdContracts['201']?.id || null,
      billNumber: 'INV-202608-201-R',
      billKind: 'RENT',
      billingDate: new Date('2026-08-25'),
      dueDate: new Date('2026-09-05'),
      subtotal: 4800.0,
      totalAmount: 4800.0,
      paidAmount: 0.0,
      outstandingAmount: 4800.0,
      status: 'unpaid',
    },
  });
  await prisma.billItem.create({
    data: {
      dormitoryId: compDorm.id,
      billId: bill201Rent.id,
      type: 'rent',
      description: 'ค่าเช่าห้องพัก 201',
      quantity: 1,
      unit: 'month',
      unitPrice: 4800,
      amount: 4800,
    },
  });

  // Explicit Legacy Combined Partial: Room 104 in August 2026 (kept explicitly for legacy compatibility testing)
  const bill104Combined = await prisma.bill.create({
    data: {
      dormitoryId: compDorm.id,
      billingCycleId: cycleAug.id,
      roomId: createdRooms['104'].id,
      tenantId: createdTenants['104'].id,
      contractId: createdContracts['104']?.id || null,
      billNumber: 'INV-202608-104-COMBINED',
      billKind: 'LEGACY_COMBINED',
      billingDate: new Date('2026-08-25'),
      dueDate: new Date('2026-09-05'),
      subtotal: 10600.0,
      totalAmount: 10600.0,
      paidAmount: 3000.0,
      outstandingAmount: 7600.0,
      status: 'partial',
    },
  });
  await prisma.billItem.createMany({
    data: [
      { dormitoryId: compDorm.id, billId: bill104Combined.id, type: 'rent', description: 'ค่าเช่าห้องพัก 104', quantity: 1, unit: 'month', unitPrice: 4800, amount: 4800 },
      { dormitoryId: compDorm.id, billId: bill104Combined.id, type: 'deposit', description: 'เงินประกันห้องพัก 104', quantity: 1, unit: 'room', unitPrice: 4800, amount: 4800 },
      { dormitoryId: compDorm.id, billId: bill104Combined.id, type: 'electric', description: 'ค่าไฟฟ้าส่วนกลาง 104', quantity: 1, unit: 'unit', unitPrice: 1000, amount: 1000 },
    ],
  });

  // Room 202 Rent + Deposit + Monthly Utility
  const bill202Rent = await prisma.bill.create({
    data: {
      dormitoryId: compDorm.id,
      billingCycleId: cycleAug.id,
      roomId: createdRooms['202'].id,
      tenantId: createdTenants['202'].id,
      contractId: createdContracts['202']?.id || null,
      billNumber: 'INV-202608-202-R',
      billKind: 'RENT',
      billingDate: new Date('2026-08-25'),
      dueDate: new Date('2026-09-05'),
      subtotal: 4800.0,
      totalAmount: 4800.0,
      paidAmount: 0.0,
      outstandingAmount: 4800.0,
      status: 'unpaid',
    },
  });
  await prisma.billItem.create({
    data: {
      dormitoryId: compDorm.id,
      billId: bill202Rent.id,
      type: 'rent',
      description: 'ค่าเช่าห้องพัก 202',
      quantity: 1,
      unit: 'month',
      unitPrice: 4800,
      amount: 4800,
    },
  });

  const bill202Dep = await prisma.bill.create({
    data: {
      dormitoryId: compDorm.id,
      billingCycleId: cycleAug.id,
      roomId: createdRooms['202'].id,
      tenantId: createdTenants['202'].id,
      contractId: createdContracts['202']?.id || null,
      billNumber: 'INV-202608-202-D',
      billKind: 'DEPOSIT',
      billingDate: new Date('2026-08-25'),
      dueDate: new Date('2026-09-05'),
      subtotal: 4800.0,
      totalAmount: 4800.0,
      paidAmount: 4800.0,
      outstandingAmount: 0.0,
      status: 'paid',
      paidAt: new Date('2026-08-25T10:00:00Z'),
    },
  });
  await prisma.billItem.create({
    data: {
      dormitoryId: compDorm.id,
      billId: bill202Dep.id,
      type: 'deposit',
      description: 'เงินประกันสัญญาเช่า 202',
      quantity: 1,
      unit: 'room',
      unitPrice: 4800,
      amount: 4800,
    },
  });
  const pay202Dep = await prisma.payment.create({
    data: {
      dormitoryId: compDorm.id,
      billId: bill202Dep.id,
      tenantId: createdTenants['202'].id,
      amount: 4800.0,
      method: 'promptpay',
      status: 'APPROVED',
      paymentDate: new Date('2026-08-25T10:00:00Z'),
    },
  });
  await prisma.paymentStatusHistory.create({
    data: {
      dormitoryId: compDorm.id,
      paymentId: pay202Dep.id,
      fromStatus: null,
      toStatus: 'APPROVED',
      changedByUserId: COMP_DORM.owner.id,
      createdAt: new Date('2026-08-25T10:00:00Z'),
    },
  });
  await prisma.billStatusHistory.create({
    data: {
      dormitoryId: compDorm.id,
      billId: bill202Dep.id,
      fromStatus: 'unpaid',
      toStatus: 'PAID',
      changedByUserId: COMP_DORM.owner.id,
      createdAt: new Date('2026-08-25T10:00:00Z'),
    },
  });
  await prisma.receipt.create({
    data: {
      dormitoryId: compDorm.id,
      billId: bill202Dep.id,
      paymentId: pay202Dep.id,
      receiptNumber: 'RCP-202608-202-D',
      snapshotData: {
        billNumber: bill202Dep.billNumber,
        roomNumber: '202',
        tenantName: createdTenants['202'].displayName,
        totalAmount: 4800.0,
        items: [{ type: 'deposit', description: 'เงินประกันสัญญาเช่า 202', unit: 'room', quantity: 1, unitPrice: 4800, amount: 4800 }],
      },
      issuedAt: new Date('2026-08-25T10:05:00Z'),
      isVoided: false,
    },
  });

  // Room 202 August Utility: ฿1,350.00 (unpaid) -> will have Rejected Slip #2 (duplicate)
  const res202 = await seedCanonicalMonthlyUtility({
    roomNum: '202',
    billNumber: 'INV-202608-202-U',
    waterReading: { previousReading: 100, currentReading: 105 },
    electricReading: { previousReading: 515, currentReading: 645 },
    parkingQuantity: 0,
  });
  const bill202Util = res202.bill;

  // Room 201 August Utility: ฿1,056.00 (unpaid)
  const res201 = await seedCanonicalMonthlyUtility({
    roomNum: '201',
    billNumber: 'INV-202608-201-U',
    waterReading: { previousReading: 82, currentReading: 94 },
    electricReading: { previousReading: 420, currentReading: 490 },
    parkingQuantity: 0,
  });

  // Room 203 August Utility: ฿1,020.00 (unpaid)
  const res203 = await seedCanonicalMonthlyUtility({
    roomNum: '203',
    billNumber: 'INV-202608-203-U',
    waterReading: { previousReading: 97, currentReading: 107 },
    electricReading: { previousReading: 485, currentReading: 555 },
    parkingQuantity: 0,
  });

  // Room 301 August Utility: ฿1,462.00 (unpaid)
  const res301 = await seedCanonicalMonthlyUtility({
    roomNum: '301',
    billNumber: 'INV-202608-301-U',
    waterReading: { previousReading: 124, currentReading: 138 },
    electricReading: { previousReading: 600, currentReading: 680 },
    parkingQuantity: 1,
  });
  const bill301Aug = res301.bill;

  // Room 302 August Utility: ฿1,250.00 (unpaid)
  const res302 = await seedCanonicalMonthlyUtility({
    roomNum: '302',
    billNumber: 'INV-202608-302-U',
    waterReading: { previousReading: 110, currentReading: 125 },
    electricReading: { previousReading: 570, currentReading: 660 },
    parkingQuantity: 0,
  });

  // Room 303 August Utility: ฿1,161.00 (unpaid)
  const res303 = await seedCanonicalMonthlyUtility({
    roomNum: '303',
    billNumber: 'INV-202608-303-U',
    waterReading: { previousReading: 62, currentReading: 74 },
    electricReading: { previousReading: 385, currentReading: 470 },
    parkingQuantity: 0,
  });
  const bill303Aug = res303.bill;

  // Room B101 August Utility: ฿1,750.00 (PAID with Receipt)
  const resB101 = await seedCanonicalMonthlyUtility({
    roomNum: 'B101',
    billNumber: 'INV-202608-B101-U',
    waterReading: { previousReading: 55, currentReading: 70 },
    electricReading: { previousReading: 300, currentReading: 400 },
    parkingQuantity: 1,
    status: 'paid',
    paidAmount: 1750.0,
    paidAt: new Date('2026-08-26T11:00:00Z'),
  });
  const billB101Aug = resB101.bill;

  const payB101Aug = await prisma.payment.create({
    data: {
      dormitoryId: compDorm.id,
      billId: billB101Aug.id,
      tenantId: createdTenants['B101'].id,
      amount: 1750.0,
      method: 'promptpay',
      status: 'APPROVED',
      paymentDate: new Date('2026-08-26T11:00:00Z'),
    },
  });
  await prisma.paymentStatusHistory.create({
    data: {
      dormitoryId: compDorm.id,
      paymentId: payB101Aug.id,
      fromStatus: null,
      toStatus: 'APPROVED',
      changedByUserId: COMP_DORM.owner.id,
      createdAt: new Date('2026-08-26T11:00:00Z'),
    },
  });
  await prisma.receipt.create({
    data: {
      dormitoryId: compDorm.id,
      billId: billB101Aug.id,
      paymentId: payB101Aug.id,
      receiptNumber: 'RCP-202608-B101-U',
      snapshotData: {
        billNumber: billB101Aug.billNumber,
        roomNumber: 'B101',
        tenantName: createdTenants['B101'].displayName,
        totalAmount: 1750.0,
        items: resB101.items,
      },
      issuedAt: new Date('2026-08-26T11:05:00Z'),
      isVoided: false,
    },
  });

  // Room 302 August Rent Bill
  const bill302Aug = await prisma.bill.create({
    data: {
      dormitoryId: compDorm.id,
      billingCycleId: cycleAug.id,
      roomId: createdRooms['302'].id,
      tenantId: createdTenants['302'].id,
      contractId: createdContracts['302']?.id || null,
      billNumber: 'INV-202608-302-R',
      billKind: 'RENT',
      billingDate: new Date('2026-08-25'),
      dueDate: new Date('2026-09-05'),
      subtotal: 5000.0,
      totalAmount: 5000.0,
      paidAmount: 0.0,
      outstandingAmount: 5000.0,
      status: 'unpaid',
    },
  });
  await prisma.billItem.create({
    data: {
      dormitoryId: compDorm.id,
      billId: bill302Aug.id,
      type: 'rent',
      description: 'ค่าเช่าห้องพัก 302 (ส.ค. 2569)',
      quantity: 1,
      unit: 'month',
      unitPrice: 5000,
      amount: 5000,
    },
  });

  // Find July bill for Room 302
  const bill302July = await prisma.bill.findFirst({
    where: {
      dormitoryId: compDorm.id,
      roomId: createdRooms['302'].id,
      billingCycleId: cycleJuly.id,
    },
  });

  if (bill302July) {
    // Canonical Prior Cash Event: ฿2,100 paid against July Bill (Total ฿6,100)
    // yielding: paidAmount = ฿2,100, outstandingAmount = ฿4,000, legacyUnallocatedPaidAmount = 0.00
    const priorPaymentDate = new Date('2026-08-10T10:00:00Z');

    const priorGroup = await prisma.combinedPaymentGroup.create({
      data: {
        dormitoryId: compDorm.id,
        tenantId: createdTenants['302'].id,
        totalAmount: 2100.0,
        method: 'CASH',
        status: 'APPROVED',
        paymentDate: priorPaymentDate,
        recordedByUserId: COMP_DORM.owner.id,
        notes: 'ชำระเงินสดบางส่วนที่เคาน์เตอร์ (ก.ค. 2569)',
      },
    });

    await prisma.combinedPaymentGroupBillTarget.create({
      data: {
        dormitoryId: compDorm.id,
        paymentGroupId: priorGroup.id,
        billId: bill302July.id,
        targetOrder: 1,
      },
    });

    const priorPayment = await prisma.payment.create({
      data: {
        dormitoryId: compDorm.id,
        billId: bill302July.id,
        tenantId: createdTenants['302'].id,
        paymentGroupId: priorGroup.id,
        method: 'CASH',
        amount: 2100.0,
        status: 'APPROVED',
        paymentDate: priorPaymentDate,
        reviewedByUserId: COMP_DORM.owner.id,
        reviewedAt: priorPaymentDate,
      },
    });

    await prisma.paymentStatusHistory.create({
      data: {
        dormitoryId: compDorm.id,
        paymentId: priorPayment.id,
        fromStatus: null,
        toStatus: 'APPROVED',
        changedByUserId: COMP_DORM.owner.id,
        effectiveAt: priorPaymentDate,
      },
    });

    const julyItems = await prisma.billItem.findMany({
      where: { billId: bill302July.id },
      orderBy: { id: 'asc' },
    });
    const rentItem = julyItems.find(it => it.type === 'rent') || julyItems[0];

    await prisma.paymentAllocation.create({
      data: {
        dormitoryId: compDorm.id,
        paymentGroupId: priorGroup.id,
        paymentId: priorPayment.id,
        billId: bill302July.id,
        billItemId: rentItem ? rentItem.id : null,
        allocatedAmount: 2100.0,
        allocationOrder: 1,
      },
    });

    await prisma.billStatusHistory.create({
      data: {
        dormitoryId: compDorm.id,
        billId: bill302July.id,
        fromStatus: 'UNPAID',
        toStatus: 'PARTIALLY_PAID',
        changedByUserId: COMP_DORM.owner.id,
        effectiveAt: priorPaymentDate,
      },
    });

    await prisma.receipt.create({
      data: {
        dormitoryId: compDorm.id,
        billId: bill302July.id,
        paymentId: priorPayment.id,
        paymentGroupId: priorGroup.id,
        receiptNumber: 'RCP-202607-302-P1',
        snapshotData: {
          receiptNumber: 'RCP-202607-302-P1',
          billNumber: bill302July.billNumber,
          roomNumber: '302',
          tenantName: createdTenants['302'].displayName,
          dormitoryName: compDorm.name,
          totalAmount: 2100.0,
          total: '2100.00',
          paymentMethod: 'CASH',
          paymentDate: priorPaymentDate.toISOString(),
          receiverName: COMP_DORM.owner.name,
          items: [
            { description: 'ค่าเช่าห้องพัก 302 (ก.ค. 2569) — ชำระบางส่วน', unit: 'month', quantity: 1, unitPrice: 2100, amount: 2100.0 },
          ],
        },
        issuedByUserId: COMP_DORM.owner.id,
        issuedAt: priorPaymentDate,
        isVoided: false,
      },
    });

    await prisma.bill.update({
      where: { id: bill302July.id },
      data: {
        paidAmount: 2100.0,
        outstandingAmount: 4000.0,
        status: 'PARTIALLY_PAID',
      },
    });
    bill302July.outstandingAmount = 4000.0;
    bill302July.paidAmount = 2100.0;
    bill302July.status = 'PARTIALLY_PAID';

    // 1. Pending Slip #1 (รอตรวจสลิป #1): Room 302 Combined Slip (6,500 total, UNDER_REVIEW)
    const uatSlipGroup = await prisma.combinedPaymentGroup.create({
      data: {
        dormitoryId: compDorm.id,
        tenantId: createdTenants['302'].id,
        totalAmount: 6500.0,
        method: 'BANK_TRANSFER',
        status: 'UNDER_REVIEW',
        paymentDate: new Date('2026-08-28T14:30:00Z'),
        notes: 'LOCAL UAT TEST SLIP — NOT REAL (โอนชำระ ก.ค. + ส.ค.)',
      },
    });

    // GroupBillTargets
    await prisma.combinedPaymentGroupBillTarget.create({
      data: {
        dormitoryId: compDorm.id,
        paymentGroupId: uatSlipGroup.id,
        billId: bill302July.id,
        targetOrder: 1,
      },
    });
    await prisma.combinedPaymentGroupBillTarget.create({
      data: {
        dormitoryId: compDorm.id,
        paymentGroupId: uatSlipGroup.id,
        billId: bill302Aug.id,
        targetOrder: 2,
      },
    });

    // Child Payments (SUM == 6,500)
    const julyAlloc = Math.min(4000, Number(bill302July.outstandingAmount || bill302July.totalAmount));
    const augAlloc = 6500 - julyAlloc;

    const slip302Key = 'fixtures/slips/local-uat-test-slip-room302.png';
    const synthetic302Png = await generateSyntheticSlipPng({
      roomNumber: 'ROOM 302',
      amount: 6500,
      claimedDate: '2026-08-28 14:30',
      status: 'UNVERIFIED',
      title: 'LOCAL UAT TEST SLIP',
      subtitle: 'NOT REAL (ก.ค. + ส.ค.)',
    });
    await localStorageProvider.saveFile(slip302Key, synthetic302Png);

    await prisma.payment.create({
      data: {
        dormitoryId: compDorm.id,
        billId: bill302July.id,
        tenantId: createdTenants['302'].id,
        paymentGroupId: uatSlipGroup.id,
        method: 'BANK_TRANSFER',
        amount: julyAlloc,
        status: 'UNDER_REVIEW',
        paymentDate: new Date('2026-08-28T14:30:00Z'),
        evidenceUrl: slip302Key,
        fileHash: 'local-uat-fake-hash-room302-july',
      },
    });

    await prisma.payment.create({
      data: {
        dormitoryId: compDorm.id,
        billId: bill302Aug.id,
        tenantId: createdTenants['302'].id,
        paymentGroupId: uatSlipGroup.id,
        method: 'BANK_TRANSFER',
        amount: augAlloc,
        status: 'UNDER_REVIEW',
        paymentDate: new Date('2026-08-28T14:30:00Z'),
        evidenceUrl: slip302Key,
        fileHash: 'local-uat-fake-hash-room302-aug',
      },
    });

    await prisma.paymentEvidenceVerification.create({
      data: {
        dormitoryId: compDorm.id,
        paymentGroupId: uatSlipGroup.id,
        provider: 'NONE',
        status: 'UNVERIFIED',
        claimedTransferAt: new Date('2026-08-28T14:30:00Z'),
        verifiedTransferAt: null,
        verifiedAmount: null,
        providerReference: null,
      },
    });
  }

  // 2. Pending Slip #2 (รอตรวจสลิป #2): Room 102 Single Bill Slip (UNDER_REVIEW)
  const slip102Key = 'fixtures/slips/local-uat-test-slip-room102.png';
  const synthetic102Png = await generateSyntheticSlipPng({
    roomNumber: 'ROOM 102',
    amount: res102.subtotal,
    claimedDate: '2026-08-28 15:00',
    status: 'UNVERIFIED',
    title: 'LOCAL UAT TEST SLIP',
    subtitle: 'ROOM 102 UTILITY',
  });
  await localStorageProvider.saveFile(slip102Key, synthetic102Png);

  const pay102Aug = await prisma.payment.create({
    data: {
      dormitoryId: compDorm.id,
      billId: bill102Aug.id,
      tenantId: createdTenants['102'].id,
      method: 'BANK_TRANSFER',
      amount: res102.subtotal,
      status: 'UNDER_REVIEW',
      paymentDate: new Date('2026-08-28T15:00:00Z'),
      evidenceUrl: slip102Key,
      fileHash: 'local-uat-fake-hash-room102-aug',
    },
  });
  await prisma.paymentEvidenceVerification.create({
    data: {
      dormitoryId: compDorm.id,
      paymentId: pay102Aug.id,
      provider: 'NONE',
      status: 'UNVERIFIED',
      claimedTransferAt: new Date('2026-08-28T15:00:00Z'),
      verifiedTransferAt: null,
      verifiedAmount: null,
    },
  });

  // 3. Rejected Slip #1 (สลิปผิดพลาด #1): Room 103 August Utility (Bill ฿1,158, transferred ฿1,000)
  const slip103Key = 'fixtures/slips/local-uat-test-slip-room103.png';
  const synthetic103Png = await generateSyntheticSlipPng({
    roomNumber: 'ROOM 103',
    amount: 1000,
    claimedDate: '2026-08-27 11:00',
    status: 'REJECTED',
    title: 'LOCAL UAT TEST SLIP',
    subtitle: `AMOUNT MISMATCH (1000 vs ${res103.subtotal})`,
  });
  await localStorageProvider.saveFile(slip103Key, synthetic103Png);

  const pay103Aug = await prisma.payment.create({
    data: {
      dormitoryId: compDorm.id,
      billId: bill103Aug.id,
      tenantId: createdTenants['103'].id,
      method: 'BANK_TRANSFER',
      amount: 1000.0,
      status: 'REJECTED',
      rejectedReason: 'ยอดเงินโอนไม่ตรงกับยอดแจ้งหนี้',
      paymentDate: new Date('2026-08-27T11:00:00Z'),
      reviewedAt: new Date('2026-08-27T12:00:00Z'),
      reviewedByUserId: COMP_DORM.owner.id,
      evidenceUrl: slip103Key,
      fileHash: 'local-uat-fake-hash-room103-aug',
    },
  });
  await prisma.paymentStatusHistory.create({
    data: {
      dormitoryId: compDorm.id,
      paymentId: pay103Aug.id,
      fromStatus: 'UNDER_REVIEW',
      toStatus: 'REJECTED',
      reason: 'ยอดเงินโอนไม่ตรงกับยอดแจ้งหนี้',
      changedByUserId: COMP_DORM.owner.id,
      effectiveAt: new Date('2026-08-27T12:00:00Z'),
    },
  });
  await prisma.paymentEvidenceVerification.create({
    data: {
      dormitoryId: compDorm.id,
      paymentId: pay103Aug.id,
      provider: 'NONE',
      status: 'REJECTED',
      claimedTransferAt: new Date('2026-08-27T11:00:00Z'),
    },
  });

  // 4. Rejected Slip #2 (สลิปผิดพลาด #2): Room 202 August Utility (Bill ฿1,350, Duplicate / Unmatched transaction)
  const slip202Key = 'fixtures/slips/local-uat-test-slip-room202.png';
  const synthetic202Png = await generateSyntheticSlipPng({
    roomNumber: 'ROOM 202',
    amount: res202.subtotal,
    claimedDate: '2026-08-27 16:00',
    status: 'REJECTED',
    title: 'LOCAL UAT TEST SLIP',
    subtitle: 'DUPLICATE / UNFOUND TX',
  });
  await localStorageProvider.saveFile(slip202Key, synthetic202Png);

  const pay202UtilRejected = await prisma.payment.create({
    data: {
      dormitoryId: compDorm.id,
      billId: bill202Util.id,
      tenantId: createdTenants['202'].id,
      method: 'BANK_TRANSFER',
      amount: res202.subtotal,
      status: 'REJECTED',
      rejectedReason: 'สลิปซ้ำ / ไม่พบยอดเงินเข้าบัญชี',
      paymentDate: new Date('2026-08-27T16:00:00Z'),
      reviewedAt: new Date('2026-08-27T17:00:00Z'),
      reviewedByUserId: COMP_DORM.owner.id,
      evidenceUrl: slip202Key,
      fileHash: 'local-uat-fake-hash-room202-aug-rejected',
    },
  });
  await prisma.paymentStatusHistory.create({
    data: {
      dormitoryId: compDorm.id,
      paymentId: pay202UtilRejected.id,
      fromStatus: 'UNDER_REVIEW',
      toStatus: 'REJECTED',
      reason: 'สลิปซ้ำ / ไม่พบยอดเงินเข้าบัญชี',
      changedByUserId: COMP_DORM.owner.id,
      effectiveAt: new Date('2026-08-27T17:00:00Z'),
    },
  });
  await prisma.paymentEvidenceVerification.create({
    data: {
      dormitoryId: compDorm.id,
      paymentId: pay202UtilRejected.id,
      provider: 'NONE',
      status: 'REJECTED',
      claimedTransferAt: new Date('2026-08-27T16:00:00Z'),
    },
  });

  // Seed sample Tenant Registration Request (Pending) with acceptance snapshot & signature
  const room102 = await prisma.room.findFirst({
    where: { dormitoryId: compDorm.id, roomNumber: '102' },
  });

  if (room102) {
    const signatureStorage = new SignatureStorageService();
    const tenantSigResult = await signatureStorage.saveTenantSignature({
      dormitoryId: compDorm.id,
      buffer: sigBuffer,
    });

    const canonicalSnapshot = {
      defaultTerms: `1. ห้ามสูบบุหรี่ภายในห้องพักและพื้นที่ส่วนกลาง
2. ห้ามส่งเสียงดังรบกวนผู้อื่นหลังเวลา 22:00 น.
3. ชำระค่าเช่าและค่าน้ำไฟตรงตามกำหนดเวลา ภายในวันที่ 5 ของทุกเดือน
4. ห้ามนำบุคคลภายนอกมาพักค้างคืนโดยไม่แจ้งเจ้าหน้าที่
5. รักษาความสะอาดและดูแลรักษาทรัพย์สินของหอพักอย่างเคร่งครัด`,
      dormitoryId: compDorm.id,
      dormitoryName: compDorm.name,
      petPolicy: {
        allowed: 'conditional',
        allowedTypes: ['cat', 'small_pet'],
      },
      policyVersion: 1,
    };
    const crypto = await import('crypto');
    const snapshotJson = JSON.stringify(canonicalSnapshot);
    const snapshotSha256 = crypto.createHash('sha256').update(snapshotJson).digest('hex');

    await prisma.tenantRegistrationRequest.create({
      data: {
        dormitoryId: compDorm.id,
        requestedRoomId: room102.id,
        firstName: 'กิตติศักดิ์',
        lastName: 'มงคลดี',
        phone: '089-112-3344',
        note: 'ประสงค์เข้าพักช่วงต้นเดือนหน้า เลี้ยงแมว 1 ตัว',
        status: 'pending',
        acceptanceSnapshot: canonicalSnapshot,
        acceptanceSnapshotSha256: snapshotSha256,
        acceptedAt: new Date('2026-08-01T10:00:00Z'),
        tenantSignatureObjectKey: tenantSigResult.objectKey,
        tenantSignatureSha256: tenantSigResult.sha256,
        tenantSignatureMimeType: tenantSigResult.mimeType,
        tenantSignatureByteSize: tenantSigResult.byteSize,
      },
    });
  }

  await backfillRoomOperationalStatusBaseline(undefined, prisma);
  console.log(`✅ Comprehensive Owner provisioned: "${compDorm.name}" (18 rooms, 11 occupied, July 2026 billing cycle seeded with paid & unpaid bills, payments, receipts, and 1 pending tenant registration request)`);
  console.log('\n================================================================================');
  console.log('🎉 LOCAL-07 DATASET SEEDING COMPLETE & FULLY POPULATED');
  console.log('================================================================================\n');

  await prisma.$disconnect();
}

if (process.argv[1] === new URL(import.meta.url).pathname || process.argv[1]?.endsWith('seed.mjs')) {
  seedLocal07Data().catch((err) => {
    console.error(`\n❌ [LOCAL-07 SEED FAILED] ${err.message}\n`, err);
    process.exit(1);
  });
}
