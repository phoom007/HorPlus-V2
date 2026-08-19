/**
 * HorPlus LOCAL-07 — Persistent Golden Menu UAT Dataset Seeder
 * 
 * Provisions and ensures the 24-room Persistent Golden Menu UAT environment:
 * - 2 Buildings (Building A, Building B)
 * - 4 Floors per building, 3 Rooms per floor
 * - 24 Rooms total (A101-A403, B101-B403)
 * - Active HorPlus PRO / PAID subscription
 * - Realistic menu review dataset (Occupied, Vacant, Reserved, Maintenance,
 *   Active Tenants, Co-occupants, Move-out, Renewal, Pending applicant,
 *   Paid bills, Unpaid bills, Overdue bills, Meter readings)
 * - Idempotent: If Golden Dorm exists and has 24 rooms, leaves user data intact!
 * 
 * @license Apache-2.0
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { PrismaClient } = require('../../server/node_modules/@prisma/client/index.js');
import { assertSafeDatabaseTarget } from './db-safety-guard.mjs';
import { GOLDEN_DORM } from './constants.mjs';
import { syncSubscriptionCatalog } from '../../server/src/scripts/subscription-catalog-sync.ts';
import { SensitiveFieldService } from '../../server/src/services/sensitive-field.service.ts';
import { createGoldenOwnerSession } from './login-helper.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const MANIFEST_PATH = path.join(ROOT_DIR, 'docs/uat/local07-golden-menu-manifest.json');

const targetInfo = assertSafeDatabaseTarget();

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL || process.env.DATABASE_URL,
    },
  },
});

export async function ensureGoldenDormData() {
  console.log('================================================================================');
  console.log('  HORPLUS LOCAL-07 — PERSISTENT GOLDEN MENU UAT ENSURE');
  console.log('================================================================================');
  console.log(`Target: ${targetInfo.host}:${targetInfo.port}/${targetInfo.database}\n`);

  // 1. Idempotency Check: Verify if Golden Dorm already exists with 24 rooms and full dataset
  const existingDorm = await prisma.dormitory.findUnique({
    where: { id: GOLDEN_DORM.id },
    include: {
      buildings: true,
      rooms: true,
      dormitorySubscription: true,
    },
  });

  const billingCycleCount = existingDorm ? await prisma.billingCycle.count({ where: { dormitoryId: GOLDEN_DORM.id } }) : 0;
  const billCount = existingDorm ? await prisma.bill.count({ where: { dormitoryId: GOLDEN_DORM.id } }) : 0;

  if (existingDorm && existingDorm.rooms.length === 24 && billingCycleCount > 0 && billCount === 16) {
    console.log(`✅ [IDEMPOTENT] Golden Dormitory "${existingDorm.name}" already exists with ${existingDorm.rooms.length} rooms and full billing dataset.`);
    console.log(`   Leaving existing Product Owner manual test mutations intact.`);
    
    // Ensure session state file is present
    await createGoldenOwnerSession();
    await generateGoldenManifest();
    await prisma.$disconnect();
    return;
  }

  if (existingDorm && (existingDorm.rooms.length !== 24 || billingCycleCount === 0 || billCount !== 16)) {
    console.log(`⚠️ Existing Golden Dormitory is incomplete (rooms: ${existingDorm.rooms.length}, billing cycles: ${billingCycleCount}, bills: ${billCount}). Re-provisioning Golden fixture...`);
    await prisma.$transaction(async (tx) => {
      await tx.receipt.deleteMany({ where: { dormitoryId: GOLDEN_DORM.id } });
      await tx.payment.deleteMany({ where: { dormitoryId: GOLDEN_DORM.id } });
      await tx.billItem.deleteMany({ where: { bill: { dormitoryId: GOLDEN_DORM.id } } });
      await tx.bill.deleteMany({ where: { dormitoryId: GOLDEN_DORM.id } });
      await tx.meterReading.deleteMany({ where: { dormitoryId: GOLDEN_DORM.id } });
      await tx.meterDevice.deleteMany({ where: { dormitoryId: GOLDEN_DORM.id } });
      await tx.billingCycle.deleteMany({ where: { dormitoryId: GOLDEN_DORM.id } });
      await tx.tenantMoveOutRequest.deleteMany({ where: { dormitoryId: GOLDEN_DORM.id } });
      await tx.tenantRegistrationRequest.deleteMany({ where: { dormitoryId: GOLDEN_DORM.id } });
      await tx.tenantRenewalRequest.deleteMany({ where: { dormitoryId: GOLDEN_DORM.id } });
      await tx.tenantCoOccupant.deleteMany({ where: { dormitoryId: GOLDEN_DORM.id } });
      await tx.occupancy.deleteMany({ where: { dormitoryId: GOLDEN_DORM.id } });
      await tx.contract.deleteMany({ where: { dormitoryId: GOLDEN_DORM.id } });
      await tx.tenant.deleteMany({ where: { dormitoryId: GOLDEN_DORM.id } });
      await tx.room.deleteMany({ where: { dormitoryId: GOLDEN_DORM.id } });
      await tx.building.deleteMany({ where: { dormitoryId: GOLDEN_DORM.id } });
      await tx.dormitoryMember.deleteMany({ where: { dormitoryId: GOLDEN_DORM.id } });
      await tx.role.deleteMany({ where: { dormitoryId: GOLDEN_DORM.id } });
      await tx.dormitoryBillingSettings.deleteMany({ where: { dormitoryId: GOLDEN_DORM.id } });
      await tx.dormitoryPropertyDefaults.deleteMany({ where: { dormitoryId: GOLDEN_DORM.id } });
      await tx.dormitorySubscription.deleteMany({ where: { dormitoryId: GOLDEN_DORM.id } });
      await tx.dormitory.deleteMany({ where: { id: GOLDEN_DORM.id } });
    });
  }

  // 2. Synchronize Subscription Catalog
  console.log('--- 1. Synchronizing Canonical Subscription Catalog ---');
  await syncSubscriptionCatalog(prisma);

  const paidPlan = await prisma.subscriptionPlan.findUnique({ where: { code: 'PAID' } });
  if (!paidPlan) {
    throw new Error('CRITICAL ERROR: Canonical PAID subscription plan is missing in database!');
  }

  // 3. Upsert Golden Owner User
  console.log('--- 2. Upserting Golden Owner Identity ---');
  const goldenOwner = await prisma.user.upsert({
    where: { id: GOLDEN_DORM.owner.id },
    update: {
      name: GOLDEN_DORM.owner.name,
      email: GOLDEN_DORM.owner.email,
      emailNormalized: GOLDEN_DORM.owner.email.toLowerCase().trim(),
      status: 'active',
    },
    create: {
      id: GOLDEN_DORM.owner.id,
      googleSubject: GOLDEN_DORM.owner.googleSubject,
      email: GOLDEN_DORM.owner.email,
      emailNormalized: GOLDEN_DORM.owner.email.toLowerCase().trim(),
      name: GOLDEN_DORM.owner.name,
      status: 'active',
    },
  });

  // 4. Create/Upsert Golden Dormitory
  console.log('--- 3. Provisioning Golden Dormitory ---');
  const dorm = await prisma.dormitory.upsert({
    where: { id: GOLDEN_DORM.id },
    update: {
      name: GOLDEN_DORM.name,
      addressLine1: GOLDEN_DORM.addressLine1,
      subdistrict: GOLDEN_DORM.subdistrict,
      district: GOLDEN_DORM.district,
      province: GOLDEN_DORM.province,
      postalCode: GOLDEN_DORM.postalCode,
      phone: GOLDEN_DORM.phone,
      email: GOLDEN_DORM.email,
      status: 'active',
    },
    create: {
      id: GOLDEN_DORM.id,
      name: GOLDEN_DORM.name,
      addressLine1: GOLDEN_DORM.addressLine1,
      subdistrict: GOLDEN_DORM.subdistrict,
      district: GOLDEN_DORM.district,
      province: GOLDEN_DORM.province,
      postalCode: GOLDEN_DORM.postalCode,
      phone: GOLDEN_DORM.phone,
      email: GOLDEN_DORM.email,
      status: 'active',
      createdByUserId: goldenOwner.id,
    },
  });

  // 5. Roles & Membership
  const ownerRole = await prisma.role.upsert({
    where: { dormitory_role_code_unique: { dormitoryId: dorm.id, code: 'OWNER' } },
    update: {},
    create: {
      dormitoryId: dorm.id,
      code: 'OWNER',
      name: 'เจ้าของหอพัก',
      isSystem: true,
      permissions: { all: true },
    },
  });

  await prisma.dormitoryMember.upsert({
    where: { user_dormitory_unique: { userId: goldenOwner.id, dormitoryId: dorm.id } },
    update: { roleId: ownerRole.id, status: 'active' },
    create: {
      dormitoryId: dorm.id,
      userId: goldenOwner.id,
      roleId: ownerRole.id,
      status: 'active',
    },
  });

  // 6. Billing Settings & Defaults
  const sensitiveService = new SensitiveFieldService(process.env.FIELD_ENCRYPTION_KEY);
  const encPromptPay = sensitiveService.encrypt(GOLDEN_DORM.payment.promptPayValue).ciphertext;
  const encBankAccount = sensitiveService.encrypt(GOLDEN_DORM.payment.bankAccountNumber).ciphertext;

  await prisma.dormitoryBillingSettings.upsert({
    where: { dormitoryId: dorm.id },
    update: {},
    create: {
      dormitoryId: dorm.id,
      billingDay: GOLDEN_DORM.billing.billingDay,
      dueDay: GOLDEN_DORM.billing.dueDay,
      waterBillingType: 'per_unit',
      waterRate: GOLDEN_DORM.billing.waterRate,
      electricityBillingType: 'per_unit',
      electricityRate: GOLDEN_DORM.billing.electricityRate,
      commonFee: GOLDEN_DORM.billing.commonFee,
      commonFeeMode: 'fixed',
      internetFee: GOLDEN_DORM.billing.internetFee,
      internetFeeMode: 'fixed',
      parkingRate: GOLDEN_DORM.billing.parkingRate,
      parkingFeeMode: 'fixed',
      cashAccepted: true,
      promptPayType: GOLDEN_DORM.payment.promptPayType,
      promptPayValueEncrypted: encPromptPay,
      bankCode: GOLDEN_DORM.payment.bankCode,
      bankAccountName: GOLDEN_DORM.payment.bankAccountName,
      bankAccountNumberEncrypted: encBankAccount,
    },
  });

  await prisma.dormitoryPropertyDefaults.upsert({
    where: { dormitoryId: dorm.id },
    update: {},
    create: {
      dormitoryId: dorm.id,
      defaultMonthlyRent: 4500.0,
      defaultDeposit: 4500.0,
      defaultParkingFee: 300.0,
      defaultMaxOccupants: 2,
      defaultRoomType: 'standard',
      defaultTerms: `1. ห้ามส่งเสียงดังรบกวนผู้อื่นหลังเวลา 22:00 น.
2. ชำระค่าเช่าและค่าน้ำไฟตรงตามกำหนดเวลา ภายในวันที่ 5 ของทุกเดือน
3. รักษาความสะอาดและดูแลรักษาทรัพย์สินของหอพักอย่างเคร่งครัด`,
    },
  });

  // 7. Active HorPlus PRO / PAID Subscription
  await prisma.dormitorySubscription.upsert({
    where: { dormitoryId: dorm.id },
    update: {
      planId: paidPlan.id,
      status: 'ACTIVE',
      startedAt: new Date('2026-01-01'),
      expiresAt: new Date('2027-01-01'),
    },
    create: {
      dormitoryId: dorm.id,
      planId: paidPlan.id,
      status: 'ACTIVE',
      startedAt: new Date('2026-01-01'),
      expiresAt: new Date('2027-01-01'),
    },
  });

  // 8. Provision 2 Buildings (Building A & Building B)
  console.log('--- 4. Provisioning 2 Buildings & 24 Rooms ---');
  const bldAConfig = GOLDEN_DORM.buildings[0];
  const bldBConfig = GOLDEN_DORM.buildings[1];

  const bldA = await prisma.building.upsert({
    where: { id: bldAConfig.id },
    update: {},
    create: {
      id: bldAConfig.id,
      dormitoryId: dorm.id,
      name: bldAConfig.name,
      code: bldAConfig.code,
      roomPrefix: bldAConfig.roomPrefix,
      floorCount: bldAConfig.floorsCount,
      roomsPerFloor: bldAConfig.roomsPerFloor,
      hasElevator: true,
      monthlyRent: bldAConfig.monthlyRent,
      depositAmount: bldAConfig.depositAmount,
    },
  });

  const bldB = await prisma.building.upsert({
    where: { id: bldBConfig.id },
    update: {},
    create: {
      id: bldBConfig.id,
      dormitoryId: dorm.id,
      name: bldBConfig.name,
      code: bldBConfig.code,
      roomPrefix: bldBConfig.roomPrefix,
      floorCount: bldBConfig.floorsCount,
      roomsPerFloor: bldBConfig.roomsPerFloor,
      hasElevator: false,
      monthlyRent: bldBConfig.monthlyRent,
      depositAmount: bldBConfig.depositAmount,
    },
  });

  // 9. Provision 24 Rooms
  const roomDefinitions = [
    // Building A (12 rooms)
    { roomNumber: 'A101', floor: 1, rent: 4500, status: 'occupied', bldId: bldA.id },
    { roomNumber: 'A102', floor: 1, rent: 4500, status: 'occupied', bldId: bldA.id },
    { roomNumber: 'A103', floor: 1, rent: 4500, status: 'occupied', bldId: bldA.id },
    { roomNumber: 'A201', floor: 2, rent: 4500, status: 'occupied', bldId: bldA.id },
    { roomNumber: 'A202', floor: 2, rent: 4500, status: 'occupied', bldId: bldA.id },
    { roomNumber: 'A203', floor: 2, rent: 4500, status: 'occupied', bldId: bldA.id },
    { roomNumber: 'A301', floor: 3, rent: 4500, status: 'occupied', bldId: bldA.id },
    { roomNumber: 'A302', floor: 3, rent: 4500, status: 'occupied', bldId: bldA.id },
    { roomNumber: 'A303', floor: 3, rent: 4500, status: 'reserved', bldId: bldA.id },
    { roomNumber: 'A401', floor: 4, rent: 4500, status: 'vacant', bldId: bldA.id },
    { roomNumber: 'A402', floor: 4, rent: 4500, status: 'vacant', bldId: bldA.id },
    { roomNumber: 'A403', floor: 4, rent: 4500, status: 'maintenance', bldId: bldA.id },
    // Building B (12 rooms)
    { roomNumber: 'B101', floor: 1, rent: 5000, status: 'occupied', bldId: bldB.id },
    { roomNumber: 'B102', floor: 1, rent: 5000, status: 'occupied', bldId: bldB.id },
    { roomNumber: 'B103', floor: 1, rent: 5000, status: 'occupied', bldId: bldB.id },
    { roomNumber: 'B201', floor: 2, rent: 5000, status: 'occupied', bldId: bldB.id },
    { roomNumber: 'B202', floor: 2, rent: 5000, status: 'occupied', bldId: bldB.id },
    { roomNumber: 'B203', floor: 2, rent: 5000, status: 'occupied', bldId: bldB.id },
    { roomNumber: 'B301', floor: 3, rent: 5000, status: 'occupied', bldId: bldB.id },
    { roomNumber: 'B302', floor: 3, rent: 5000, status: 'occupied', bldId: bldB.id },
    { roomNumber: 'B303', floor: 3, rent: 5000, status: 'vacant', bldId: bldB.id },
    { roomNumber: 'B401', floor: 4, rent: 5000, status: 'vacant', bldId: bldB.id },
    { roomNumber: 'B402', floor: 4, rent: 5000, status: 'vacant', bldId: bldB.id },
    { roomNumber: 'B403', floor: 4, rent: 5000, status: 'vacant', bldId: bldB.id },
  ];

  const createdRooms = {};
  for (const rd of roomDefinitions) {
    const norm = rd.roomNumber.toLowerCase().trim();
    const room = await prisma.room.upsert({
      where: {
        dormitoryId_normalizedRoomNumber: {
          dormitoryId: dorm.id,
          normalizedRoomNumber: norm,
        },
      },
      update: {
        status: rd.status,
        monthlyRent: rd.rent,
        depositAmount: rd.rent,
      },
      create: {
        dormitoryId: dorm.id,
        buildingId: rd.bldId,
        roomNumber: rd.roomNumber,
        normalizedRoomNumber: rd.roomNumber.toLowerCase().trim(),
        floor: rd.floor,
        roomType: 'standard',
        monthlyRent: rd.rent,
        depositAmount: rd.rent,
        status: rd.status,
      },
    });
    createdRooms[rd.roomNumber] = room;
  }

  // 10. Provision Realistic Tenants, Contracts & Scenarios
  console.log('--- 5. Provisioning Realistic Tenants & Scenario Mappings ---');
  const tenantConfigs = [
    { num: 'A101', name: 'นายกิตติศักดิ์ มั่งมี', first: 'กิตติศักดิ์', last: 'มั่งมี', phone: '0811010001', rent: 4500, deposit: 4500, unpaidBill: true },
    { num: 'A102', name: 'นางสาวมณีวรรณ สดใส', first: 'มณีวรรณ', last: 'สดใส', phone: '0811010002', rent: 4500, deposit: 4500, paidBill: true },
    { num: 'A103', name: 'นายสมศักดิ์ รักสงบ', first: 'สมศักดิ์', last: 'รักสงบ', phone: '0811010003', rent: 4500, deposit: 4500, paidBill: true, coOccupants: [{ name: 'นายสมชาย รักสงบ', relation: 'พี่น้อง' }] },
    { num: 'A201', name: 'นายธนพล รุ่งเรือง', first: 'ธนพล', last: 'รุ่งเรือง', phone: '0811010004', rent: 4500, deposit: 4500, overdueBill: true },
    { num: 'A202', name: 'นางสาวปิยะดา สวยงาม', first: 'ปิยะดา', last: 'สวยงาม', phone: '0811010005', rent: 4500, deposit: 4500, paidBill: true },
    { num: 'A203', name: 'นายวรวิทย์ สิทธิโชค', first: 'วรวิทย์', last: 'สิทธิโชค', phone: '0811010006', rent: 4500, deposit: 4500, paidBill: true, renewalPending: true },
    { num: 'A301', name: 'นางสาวนภาพร เพ็ญแข', first: 'นภาพร', last: 'เพ็ญแข', phone: '0811010007', rent: 4500, deposit: 4500, paidBill: true, moveOutPending: true },
    { num: 'A302', name: 'นายชวลิต เด่นดวง', first: 'ชวลิต', last: 'เด่นดวง', phone: '0811010008', rent: 4500, deposit: 4500, paidBill: true },
    { num: 'B101', name: 'นายธีรเดช เก่งกล้า', first: 'ธีรเดช', last: 'เก่งกล้า', phone: '0812010001', rent: 5000, deposit: 5000, paidBill: true },
    { num: 'B102', name: 'นางสาววรรณภา แสนสุข', first: 'วรรณภา', last: 'แสนสุข', phone: '0812010002', rent: 5000, deposit: 5000, unpaidBill: true },
    { num: 'B103', name: 'นายศิริชัย เลิศล้ำ', first: 'ศิริชัย', last: 'เลิศล้ำ', phone: '0812010003', rent: 5000, deposit: 5000, paidBill: true },
    { num: 'B201', name: 'นางสาวสิริกร มงคล', first: 'สิริกร', last: 'มงคล', phone: '0812010004', rent: 5000, deposit: 5000, paidBill: true },
    { num: 'B202', name: 'นายอัครพล ยิ่งเจริญ', first: 'อัครพล', last: 'ยิ่งเจริญ', phone: '0812010005', rent: 5000, deposit: 5000, paidBill: true },
    { num: 'B203', name: 'นางสาวจันทิมา แสงจันทร์', first: 'จันทิมา', last: 'แสงจันทร์', phone: '0812010006', rent: 5000, deposit: 5000, unpaidBill: true },
    { num: 'B301', name: 'นายพงศธร เด่นงาม', first: 'พงศธร', last: 'เด่นงาม', phone: '0812010007', rent: 5000, deposit: 5000, paidBill: true },
    { num: 'B302', name: 'นางสาวลลิตา มีสุข', first: 'ลลิตา', last: 'มีสุข', phone: '0812010008', rent: 5000, deposit: 5000, paidBill: true },
  ];

  let tCount = 1;
  const createdContracts = {};
  for (const tc of tenantConfigs) {
    const tCode = `GTNT-${String(tCount).padStart(3, '0')}`;
    const room = createdRooms[tc.num];

    const tenant = await prisma.tenant.create({
      data: {
        dormitoryId: dorm.id,
        tenantNumber: tCode,
        firstName: tc.first,
        lastName: tc.last,
        displayName: tc.name,
        phone: tc.phone,
        nationalIdMasked: '1-1004-XXXXX-XX-X',
        status: 'active',
      },
    });

    const contract = await prisma.contract.create({
      data: {
        dormitoryId: dorm.id,
        roomId: room.id,
        tenantId: tenant.id,
        contractNumber: `GCTR-2026-${tc.num}`,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        rentAmount: tc.rent,
        depositAmount: tc.deposit,
        status: 'active',
      },
    });
    createdContracts[tc.num] = { contract, tenant, room };

    const occupancy = await prisma.occupancy.create({
      data: {
        dormitoryId: dorm.id,
        roomId: room.id,
        tenantId: tenant.id,
        startedAt: new Date('2026-01-01'),
        status: 'ACTIVE',
      },
    });

    if (tc.coOccupants) {
      for (const co of tc.coOccupants) {
        await prisma.tenantCoOccupant.create({
          data: {
            dormitoryId: dorm.id,
            tenantId: tenant.id,
            contractId: contract.id,
            name: co.name,
            relationship: co.relation,
            status: 'active',
          },
        });
      }
    }

    if (tc.renewalPending) {
      await prisma.tenantRenewalRequest.create({
        data: {
          dormitoryId: dorm.id,
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

    if (tc.moveOutPending) {
      await prisma.tenantMoveOutRequest.create({
        data: {
          dormitoryId: dorm.id,
          occupancyId: occupancy.id,
          tenantId: tenant.id,
          roomId: room.id,
          intendedMoveOutDate: new Date('2026-08-31'),
          reason: 'ย้ายที่ทำงาน',
          status: 'SCHEDULED',
        },
      });
    }

    tCount++;
  }

  // Pending Registration Request on Vacant Room A401
  await prisma.tenantRegistrationRequest.create({
    data: {
      dormitoryId: dorm.id,
      requestedRoomId: createdRooms['A401'].id,
      firstName: 'อนิรุธ',
      lastName: 'สมานฉันท์',
      phone: '0899990001',
      note: 'ขอเข้าพัก 1 ก.ย. 2569',
      status: 'pending_owner_approval',
    },
  });

  // 11. Provision Billing Cycles (2026-07 Operational Closed, 2026-08 Current Draft)
  console.log('--- 6. Provisioning Billing Cycles, Meters & Bills ---');
  const cycleJuly = await prisma.billingCycle.create({
    data: {
      dormitoryId: dorm.id,
      cycleCode: '2026-07',
      name: 'รอบบิล กรกฎาคม 2569',
      periodStart: new Date('2026-07-01'),
      periodEnd: new Date('2026-07-31'),
      billingDate: new Date('2026-07-25'),
      dueDate: new Date('2026-08-05'),
      status: 'open',
    },
  });

  // Meter Readings & Bills for Occupied Rooms
  let billSeq = 1;
  for (const tc of tenantConfigs) {
    const { contract, tenant, room } = createdContracts[tc.num];
    const prevWater = 100;
    const curWater = 112; // 12 units * 18 = 216
    const prevElec = 500;
    const curElec = 580;  // 80 units * 7 = 560
    const waterAmt = 12 * 18;
    const elecAmt = 80 * 7;
    const commonAmt = 200;
    const totalAmt = tc.rent + waterAmt + elecAmt + commonAmt;

    // Meter Devices & Readings
    const wDev = await prisma.meterDevice.create({
      data: {
        dormitoryId: dorm.id,
        roomId: room.id,
        type: 'water',
        meterNumber: `WM-${tc.num}`,
        initialReading: prevWater,
      },
    });

    const eDev = await prisma.meterDevice.create({
      data: {
        dormitoryId: dorm.id,
        roomId: room.id,
        type: 'electricity',
        meterNumber: `EM-${tc.num}`,
        initialReading: prevElec,
      },
    });

    await prisma.meterReading.create({
      data: {
        dormitoryId: dorm.id,
        billingCycleId: cycleJuly.id,
        roomId: room.id,
        meterDeviceId: wDev.id,
        meterType: 'water',
        previousReading: prevWater,
        currentReading: curWater,
        usageUnits: 12,
        readAt: new Date('2026-07-25'),
        status: 'confirmed',
      },
    });

    await prisma.meterReading.create({
      data: {
        dormitoryId: dorm.id,
        billingCycleId: cycleJuly.id,
        roomId: room.id,
        meterDeviceId: eDev.id,
        meterType: 'electricity',
        previousReading: prevElec,
        currentReading: curElec,
        usageUnits: 80,
        readAt: new Date('2026-07-25'),
        status: 'confirmed',
      },
    });

    // Bill Status Determination
    let billStatus = 'PAID';
    if (tc.unpaidBill) billStatus = 'SENT';
    if (tc.overdueBill) billStatus = 'OVERDUE';
    const isPaid = billStatus === 'PAID';

    const bill = await prisma.bill.create({
      data: {
        dormitoryId: dorm.id,
        contractId: contract.id,
        billingCycleId: cycleJuly.id,
        roomId: room.id,
        tenantId: tenant.id,
        billNumber: `GBILL-2026-07-${String(billSeq).padStart(3, '0')}`,
        billingDate: new Date('2026-07-25'),
        dueDate: new Date('2026-08-05'),
        subtotal: totalAmt,
        totalAmount: totalAmt,
        paidAmount: isPaid ? totalAmt : 0,
        outstandingAmount: isPaid ? 0 : totalAmt,
        status: billStatus,
        paidAt: isPaid ? new Date('2026-07-28') : null,
      },
    });

    await prisma.billItem.createMany({
      data: [
        { dormitoryId: dorm.id, billId: bill.id, type: 'RENT', description: 'ค่าเช่าห้องพัก', amount: tc.rent, quantity: 1, unitPrice: tc.rent, displayOrder: 1 },
        { dormitoryId: dorm.id, billId: bill.id, type: 'WATER', description: 'ค่าน้ำประปา (12 หน่วย)', amount: waterAmt, quantity: 12, unitPrice: 18.0, displayOrder: 2 },
        { dormitoryId: dorm.id, billId: bill.id, type: 'ELECTRICITY', description: 'ค่าไฟฟ้า (80 หน่วย)', amount: elecAmt, quantity: 80, unitPrice: 7.0, displayOrder: 3 },
        { dormitoryId: dorm.id, billId: bill.id, type: 'COMMON_FEE', description: 'ค่าส่วนกลาง', amount: commonAmt, quantity: 1, unitPrice: commonAmt, displayOrder: 4 },
      ],
    });

    if (isPaid) {
      const pmt = await prisma.payment.create({
        data: {
          dormitoryId: dorm.id,
          billId: bill.id,
          tenantId: tenant.id,
          method: 'PROMPTPAY',
          amount: totalAmt,
          status: 'VERIFIED',
          paymentDate: new Date('2026-07-28'),
        },
      });

      await prisma.receipt.create({
        data: {
          dormitoryId: dorm.id,
          paymentId: pmt.id,
          billId: bill.id,
          receiptNumber: `GREC-2026-07-${String(billSeq).padStart(3, '0')}`,
          snapshotData: {
            billNumber: bill.billNumber,
            totalAmount: totalAmt,
            paymentMethod: 'PROMPTPAY',
            roomNumber: tc.num,
            tenantName: tc.name,
          },
          issuedAt: new Date('2026-07-28'),
        },
      });
    }

    billSeq++;
  }

  // 12. Create Session & Manifest
  console.log('--- 7. Generating Authenticated Session & Scenario Manifest ---');
  await createGoldenOwnerSession();
  await generateGoldenManifest();

  console.log('\n================================================================================');
  console.log('  ✅ GOLDEN DORMITORY PROVISIONED SUCCESSFULLY');
  console.log('  Dormitory:  หอพัก HorPlus Golden Manor (24 Rooms, 2 Buildings)');
  console.log('  Owner:      owner.golden@horplus-golden.local');
  console.log('  Subscription: HorPlus PRO / PAID (Active)');
  console.log('  Session:    .local07-sessions/golden-owner.json');
  console.log('  Manifest:   docs/uat/local07-golden-menu-manifest.json');
  console.log('================================================================================\n');

  await prisma.$disconnect();
}

export async function generateGoldenManifest() {
  const dorm = await prisma.dormitory.findUnique({
    where: { id: GOLDEN_DORM.id },
    include: {
      buildings: { include: { rooms: true } },
      dormitorySubscription: true,
      billingSettings: true,
    },
  });

  if (!dorm) return;

  const manifest = {
    metadata: {
      title: 'HorPlus Persistent Golden Menu UAT Manifest',
      createdAt: '2026-08-19',
      purpose: 'Stable 24-room reference dormitory for Product Owner iterative Owner/Tenant menu UAT',
      protection: 'Persistent across normal uat:refresh; immune from deletion',
    },
    dormitory: {
      id: dorm.id,
      name: dorm.name,
      address: `${dorm.addressLine1}, ${dorm.subdistrict}, ${dorm.district}, ${dorm.province} ${dorm.postalCode}`,
      phone: dorm.phone,
      email: dorm.email,
      owner: {
        id: GOLDEN_DORM.owner.id,
        name: GOLDEN_DORM.owner.name,
        email: GOLDEN_DORM.owner.email,
        phone: GOLDEN_DORM.owner.phone,
      },
      subscription: {
        tier: 'PRO',
        planCode: 'PAID',
        status: 'ACTIVE',
        effectiveLimit: 150,
      },
      integrations: {
        lineOA: 'not_configured',
        slipOK: 'not_configured',
      },
    },
    buildings: dorm.buildings.map((b) => ({
      id: b.id,
      name: b.name,
      code: b.code,
      floorCount: b.floorCount,
      roomsPerFloor: b.roomsPerFloor,
      roomCount: b.rooms.length,
      rooms: b.rooms.map((r) => r.roomNumber).sort(),
    })),
    roomSummary: {
      totalRooms: 24,
      occupied: 16,
      vacant: 6,
      reserved: 1,
      maintenance: 1,
    },
    scenarioMapping: [
      { room: 'A101', building: 'A', status: 'occupied', tenant: 'นายกิตติศักดิ์ มั่งมี', billing: 'SENT (unpaid)', meters: 'recorded' },
      { room: 'A102', building: 'A', status: 'occupied', tenant: 'นางสาวมณีวรรณ สดใส', billing: 'PAID (receipt issued)', meters: 'recorded' },
      { room: 'A103', building: 'A', status: 'occupied', tenant: 'นายสมศักดิ์ รักสงบ', coOccupants: ['นายสมชาย รักสงบ'], billing: 'PAID', meters: 'recorded' },
      { room: 'A201', building: 'A', status: 'occupied', tenant: 'นายธนพล รุ่งเรือง', billing: 'OVERDUE (unpaid)', meters: 'recorded' },
      { room: 'A202', building: 'A', status: 'occupied', tenant: 'นางสาวปิยะดา สวยงาม', billing: 'PAID', meters: 'recorded' },
      { room: 'A203', building: 'A', status: 'occupied', tenant: 'นายวรวิทย์ สิทธิโชค', renewal: 'PENDING_OWNER_APPROVAL', billing: 'PAID', meters: 'recorded' },
      { room: 'A301', building: 'A', status: 'occupied', tenant: 'นางสาวนภาพร เพ็ญแข', moveOut: 'pending_move_out', billing: 'PAID', meters: 'recorded' },
      { room: 'A302', building: 'A', status: 'occupied', tenant: 'นายชวลิต เด่นดวง', billing: 'PAID', meters: 'recorded' },
      { room: 'A303', building: 'A', status: 'reserved', scenario: 'จองห้องพักล่วงหน้า (นายอานนท์ ใจบุญ)' },
      { room: 'A401', building: 'A', status: 'vacant', applicant: 'pending registration request (นายอนิรุธ สมานฉันท์)' },
      { room: 'A402', building: 'A', status: 'vacant', scenario: 'พร้อมให้เช่า' },
      { room: 'A403', building: 'A', status: 'maintenance', scenario: 'ห้องพักอยู่ระหว่างทาสีและปรับปรุง' },
      { room: 'B101', building: 'B', status: 'occupied', tenant: 'นายธีรเดช เก่งกล้า', billing: 'PAID', meters: 'recorded' },
      { room: 'B102', building: 'B', status: 'occupied', tenant: 'นางสาววรรณภา แสนสุข', billing: 'SENT (unpaid)', meters: 'recorded' },
      { room: 'B103', building: 'B', status: 'occupied', tenant: 'นายศิริชัย เลิศล้ำ', billing: 'PAID', meters: 'recorded' },
      { room: 'B201', building: 'B', status: 'occupied', tenant: 'นางสาวสิริกร มงคล', billing: 'PAID', meters: 'recorded' },
      { room: 'B202', building: 'B', status: 'occupied', tenant: 'นายอัครพล ยิ่งเจริญ', billing: 'PAID', meters: 'recorded' },
      { room: 'B203', building: 'B', status: 'occupied', tenant: 'นางสาวจันทิมา แสงจันทร์', billing: 'SENT (unpaid)', meters: 'recorded' },
      { room: 'B301', building: 'B', status: 'occupied', tenant: 'นายพงศธร เด่นงาม', billing: 'PAID', meters: 'recorded' },
      { room: 'B302', building: 'B', status: 'occupied', tenant: 'นางสาวลลิตา มีสุข', billing: 'PAID', meters: 'recorded' },
      { room: 'B303', building: 'B', status: 'vacant', scenario: 'พร้อมให้เช่า' },
      { room: 'B401', building: 'B', status: 'vacant', scenario: 'พร้อมให้เช่า' },
      { room: 'B402', building: 'B', status: 'vacant', scenario: 'พร้อมให้เช่า' },
      { room: 'B403', building: 'B', status: 'vacant', scenario: 'พร้อมให้เช่า' },
    ],
  };

  const dir = path.dirname(MANIFEST_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');
}

if (process.argv[1] === new URL(import.meta.url).pathname || process.argv[1]?.endsWith('golden-ensure.mjs')) {
  ensureGoldenDormData().catch((err) => {
    console.error(`❌ [GOLDEN ENSURE FAILED] ${err.message}`);
    process.exit(1);
  });
}
