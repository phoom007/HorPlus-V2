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
      gracePeriodDays: 3,
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
      name: 'อาคารชาญวิทย์ (A)',
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
      name: 'อาคารสมบูรณ์ (B)',
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
    { roomNumber: '304', floor: 3, rent: 5000, termRent: 20000, dailyRent: 600, status: 'reserved', bldId: bldA.id },
    // Building B
    { roomNumber: 'B101', floor: 1, rent: 5500, termRent: 22000, dailyRent: 600, status: 'occupied', bldId: bldB.id },
    { roomNumber: 'B102', floor: 2, rent: 5500, termRent: 22000, dailyRent: 600, status: 'vacant', bldId: bldB.id },
  ];

  const createdRooms = {};
  for (const r of roomData) {
    const room = await prisma.room.create({
      data: {
        dormitoryId: compDorm.id,
        buildingId: r.bldId,
        roomNumber: r.roomNumber,
        normalizedRoomNumber: r.roomNumber.toLowerCase().trim(),
        floor: r.floor,
        roomType: 'standard',
        monthlyRent: r.rent,
        depositAmount: r.rent,
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
  for (const tc of tenantConfigs) {
    const tCode = `TNT-${String(tCount).padStart(3, '0')}`;
    const room = createdRooms[tc.num];

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
        startDate: tc.isMovedOut ? new Date('2025-08-01') : new Date('2026-01-01'),
        endDate: tc.isMovedOut ? new Date('2026-07-31') : new Date('2026-12-31'),
        rentAmount: tc.rent,
        depositAmount: tc.deposit,
        status: tc.isMovedOut ? 'ended' : 'active',
      },
    });

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

  // Billing Cycles: June (Closed) and July (Active Current Cycle)
  await prisma.billingCycle.create({
    data: {
      dormitoryId: compDorm.id,
      cycleCode: '2026-06',
      name: 'รอบบิล มิถุนายน 2569',
      periodStart: new Date('2026-06-01'),
      periodEnd: new Date('2026-06-30'),
      billingDate: new Date('2026-06-25'),
      dueDate: new Date('2026-07-05'),
      status: 'closed',
    },
  });

  const cycleJuly = await prisma.billingCycle.create({
    data: {
      dormitoryId: compDorm.id,
      cycleCode: '2026-07',
      name: 'รอบบิล กรกฎาคม 2569',
      periodStart: new Date('2026-07-01'),
      periodEnd: new Date('2026-07-31'),
      billingDate: new Date('2026-07-25'),
      dueDate: new Date('2026-08-05'),
      status: 'open',
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
        currentReading: mf.curWater,
      },
    });

    const elecDevice = await prisma.meterDevice.create({
      data: {
        dormitoryId: compDorm.id,
        roomId: room.id,
        type: 'electric',
        meterNumber: `EM-${mf.roomNum}`,
        initialReading: mf.prevElec,
        currentReading: mf.curElec,
      },
    });

    // Water Reading
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

    // Electric Reading
    await prisma.meterReading.create({
      data: {
        dormitoryId: compDorm.id,
        roomId: room.id,
        meterDeviceId: elecDevice.id,
        billingCycleId: cycleJuly.id,
        meterType: 'electric',
        previousReading: mf.prevElec,
        currentReading: mf.curElec,
        usageUnits: mf.curElec - mf.prevElec,
        readAt: new Date('2026-07-24'),
      },
    });
  }

  // July 2026 Bills
  const billFacts = [
    { roomNum: '101', rent: 4500, wUnits: 10, wRate: 18, eUnits: 60, eRate: 7, common: 200, internet: 150, parking: 0, surcharge: 0, paid: true, rcpNum: 'RCP-202607-001' },
    { roomNum: '102', rent: 4500, wUnits: 10, wRate: 18, eUnits: 60, eRate: 7, common: 200, internet: 150, parking: 0, surcharge: 0, paid: false },
    { roomNum: '103', rent: 4500, wUnits: 8, wRate: 18, eUnits: 48, eRate: 7, common: 200, internet: 0, parking: 300, surcharge: 0, paid: true, rcpNum: 'RCP-202607-002' },
    { roomNum: '104', rent: 4500, wUnits: 18, wRate: 18, eUnits: 120, eRate: 7, common: 200, internet: 0, parking: 0, surcharge: 600, paid: false },
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
        billNumber,
        billingDate: new Date('2026-07-25'),
        dueDate: new Date('2026-08-05'),
        subtotal,
        totalAmount: subtotal,
        paidAmount: bf.paid ? subtotal : 0.0,
        outstandingAmount: bf.paid ? 0.0 : subtotal,
        status: bf.paid ? 'paid' : 'unpaid',
      },
    });

    // Bill Items
    const items = [
      { type: 'rent', description: `ค่าเช่าห้องพัก ${bf.roomNum}`, quantity: 1, unitPrice: bf.rent, amount: bf.rent },
      { type: 'water', description: `ค่าน้ำประปา (${bf.wUnits} หน่วย @ ฿${bf.wRate})`, quantity: bf.wUnits, unitPrice: bf.wRate, amount: waterTotal },
      { type: 'electric', description: `ค่าไฟฟ้า (${bf.eUnits} หน่วย @ ฿${bf.eRate})`, quantity: bf.eUnits, unitPrice: bf.eRate, amount: elecTotal },
      { type: 'common', description: 'ค่าส่วนกลาง', quantity: 1, unitPrice: bf.common, amount: bf.common },
    ];

    if (bf.internet > 0) {
      items.push({ type: 'internet', description: 'ค่าบริการอินเทอร์เน็ตความเร็วสูง', quantity: 1, unitPrice: bf.internet, amount: bf.internet });
    }
    if (bf.parking > 0) {
      items.push({ type: 'parking', description: 'ค่าที่จอดรถยนต์', quantity: 1, unitPrice: bf.parking, amount: bf.parking });
    }
    if (bf.surcharge > 0) {
      items.push({ type: 'co_occupant_surcharge', description: 'ค่าบริการผู้พักอาศัยร่วมเกินกำหนด (3 ท่าน)', quantity: 3, unitPrice: 200, amount: bf.surcharge });
    }

    for (const it of items) {
      await prisma.billItem.create({
        data: {
          dormitoryId: compDorm.id,
          billId: bill.id,
          type: it.type,
          description: it.description,
          quantity: it.quantity,
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
