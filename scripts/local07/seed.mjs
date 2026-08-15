/**
 * HorPlus LOCAL-07 — Deterministic Dataset Seeder
 * 
 * Seeds ONE comprehensive, deterministic UAT dataset:
 * 1. Fresh Owner scenario via authentic onboarding persistence
 * 2. Comprehensive Owner scenario (18 rooms, 2 buildings, 11 occupied rooms, all billing/accounting states, staff, maintenance, announcements)
 * 
 * @license Apache-2.0
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { PrismaClient } = require('../../server/node_modules/@prisma/client/index.js');
import { assertSafeDatabaseTarget } from './db-safety-guard.mjs';
import { resetLocal07Data } from './reset.mjs';
import { FRESH_DORM, COMP_DORM } from './constants.mjs';
import crypto from 'crypto';

const targetInfo = assertSafeDatabaseTarget();

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL || process.env.DATABASE_URL,
    },
  },
});

function createDummySignaturePng() {
  return Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2d400000000049454e44ae426082', 'hex');
}

export async function seedLocal07Data() {
  console.log('================================================================================');
  console.log('  HORPLUS LOCAL-07 — DETERMINISTIC DATASET SEEDER');
  console.log('================================================================================');
  console.log(`Target: ${targetInfo.host}:${targetInfo.port}/${targetInfo.database}\n`);

  // Step 1: Clean existing LOCAL-07 fixtures
  await resetLocal07Data();

  console.log('\n--- 1. Seeding Fresh Owner Scenario (Onboarding Persistence) ---');
  
  // Create Fresh Owner User
  const freshOwnerUser = await prisma.user.create({
    data: {
      id: FRESH_DORM.owner.id,
      googleSubject: FRESH_DORM.owner.googleSubject,
      name: FRESH_DORM.owner.name,
      email: FRESH_DORM.owner.email,
      emailNormalized: FRESH_DORM.owner.email.toLowerCase(),
      phone: FRESH_DORM.owner.phone,
      status: 'active',
    },
  });

  // Provision Fresh Owner Dormitory
  const freshDorm = await prisma.dormitory.create({
    data: {
      id: FRESH_DORM.id,
      name: FRESH_DORM.name,
      type: FRESH_DORM.type,
      genderPolicy: FRESH_DORM.genderPolicy,
      addressLine1: FRESH_DORM.addressLine1,
      subdistrict: FRESH_DORM.subdistrict,
      district: FRESH_DORM.district,
      province: FRESH_DORM.province,
      postalCode: FRESH_DORM.postalCode,
      phone: FRESH_DORM.phone,
      email: FRESH_DORM.email,
      estimatedBuildingCount: FRESH_DORM.estimatedBuildingCount,
      estimatedRoomCount: FRESH_DORM.estimatedRoomCount,
      status: 'active',
      createdByUserId: freshOwnerUser.id,
    },
  });

  // Create Owner Role & Membership for Fresh Owner
  const freshOwnerRole = await prisma.role.create({
    data: {
      dormitoryId: freshDorm.id,
      code: 'OWNER',
      name: 'เจ้าของหอพัก',
      isSystem: true,
      permissions: {
        dashboard: { view: true, export: true },
        rooms: { view: true, create: true, edit: true, delete: true },
        tenants: { view: true, create: true, edit: true, delete: true },
        contracts: { view: true, create: true, edit: true, delete: true },
        meters: { view: true, create: true, edit: true },
        billing: { view: true, create: true, edit: true, delete: true },
        payments: { view: true, approve: true, reject: true },
        settings: { view: true, manageSettings: true, manageUsers: true },
      },
    },
  });

  await prisma.dormitoryMember.create({
    data: {
      dormitoryId: freshDorm.id,
      userId: freshOwnerUser.id,
      roleId: freshOwnerRole.id,
      status: 'active',
    },
  });

  // Fresh Owner Billing Settings
  await prisma.dormitoryBillingSettings.create({
    data: {
      dormitoryId: freshDorm.id,
      billingDay: FRESH_DORM.billing.billingDay,
      dueDay: FRESH_DORM.billing.dueDay,
      waterBillingType: FRESH_DORM.billing.waterBillingType,
      waterRate: FRESH_DORM.billing.waterRate,
      electricityBillingType: FRESH_DORM.billing.electricityBillingType,
      electricityRate: FRESH_DORM.billing.electricityRate,
      commonFee: FRESH_DORM.billing.commonFee,
      internetFee: FRESH_DORM.billing.internetFee,
      parkingRate: FRESH_DORM.billing.parkingRate,
      gracePeriodDays: FRESH_DORM.billing.gracePeriodDays,
      advanceRentMonths: FRESH_DORM.billing.advanceRentMonths,
      lateFeeType: FRESH_DORM.billing.lateFeeType,
      lateFeeValue: FRESH_DORM.billing.lateFeeValue,
      rentBillingType: FRESH_DORM.billing.rentBillingType,
      cashAccepted: FRESH_DORM.payment.cashAccepted,
      promptPayType: FRESH_DORM.payment.promptPayType,
      promptPayValue: FRESH_DORM.payment.promptPayValue,
      bankCode: FRESH_DORM.payment.bankCode,
      bankAccountName: FRESH_DORM.payment.bankAccountName,
      bankAccountNumber: FRESH_DORM.payment.bankAccountNumber,
    },
  });

  // Fresh Owner Property Defaults
  await prisma.dormitoryPropertyDefaults.create({
    data: {
      dormitoryId: freshDorm.id,
      defaultMonthlyRent: FRESH_DORM.building.monthlyRent,
      defaultDeposit: FRESH_DORM.building.depositAmount,
      defaultMaxOccupants: FRESH_DORM.building.maximumOccupants,
    },
  });

  // Fresh Owner Subscription (Free with HORPLUS trial extension: 60 days)
  const now = new Date();
  const trialEnd = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
  const freeSubPlan = await prisma.subscriptionPlan.findFirst({ where: { code: 'FREE' } });
  if (freeSubPlan) {
    await prisma.dormitorySubscription.create({
      data: {
        dormitoryId: freshDorm.id,
        planId: freeSubPlan.id,
        status: 'TRIAL',
        startedAt: now,
        expiresAt: trialEnd,
        trialStartedAt: now,
        trialExpiresAt: trialEnd,
        promoExtendedAt: now,
      },
    });
  }

  // Fresh Owner Building & Rooms
  const freshBuilding = await prisma.building.create({
    data: {
      id: FRESH_DORM.building.id,
      dormitoryId: freshDorm.id,
      name: FRESH_DORM.building.name,
      code: FRESH_DORM.building.code,
      floorCount: FRESH_DORM.building.floorsCount,
      roomsPerFloor: FRESH_DORM.building.roomsPerFloor,
      monthlyRent: FRESH_DORM.building.monthlyRent,
      depositAmount: FRESH_DORM.building.depositAmount,
      maximumOccupants: FRESH_DORM.building.maximumOccupants,
    },
  });

  for (const r of FRESH_DORM.rooms) {
    await prisma.room.create({
      data: {
        id: r.id,
        dormitoryId: freshDorm.id,
        buildingId: freshBuilding.id,
        roomNumber: r.roomNumber,
        normalizedRoomNumber: r.roomNumber.toLowerCase().trim(),
        roomType: 'standard',
        floor: r.floor,
        monthlyRent: r.monthlyRent,
        depositAmount: r.depositAmount,
        status: r.status,
      },
    });
  }

  // Fresh Owner Signature
  const sigBytes = createDummySignaturePng();
  const sigHash = crypto.createHash('sha256').update(sigBytes).digest('hex');
  await prisma.ownerSignature.create({
    data: {
      dormitoryId: freshDorm.id,
      signedByUserId: freshOwnerUser.id,
      objectKey: `signatures/${freshDorm.id}/signature-v1.png`,
      sha256: sigHash,
      byteSize: sigBytes.length,
      version: 1,
      isCurrent: true,
    },
  });

  console.log(`✅ Fresh Owner provisioned: "${freshDorm.name}" (4 vacant rooms, Free trial + HORPLUS promo, complete onboarding facts)`);

  console.log('\n--- 2. Seeding Comprehensive Owner Scenario ---');

  // Create Users: Comp Owner, Manager, Tech, Tenant Somchai
  const compOwnerUser = await prisma.user.create({
    data: {
      id: COMP_DORM.owner.id,
      googleSubject: COMP_DORM.owner.googleSubject,
      name: COMP_DORM.owner.name,
      email: COMP_DORM.owner.email,
      emailNormalized: COMP_DORM.owner.email.toLowerCase(),
      phone: COMP_DORM.owner.phone,
      status: 'active',
    },
  });

  const managerUser = await prisma.user.create({
    data: {
      id: COMP_DORM.manager.id,
      googleSubject: COMP_DORM.manager.googleSubject,
      name: COMP_DORM.manager.name,
      email: COMP_DORM.manager.email,
      emailNormalized: COMP_DORM.manager.email.toLowerCase(),
      phone: COMP_DORM.manager.phone,
      status: 'active',
    },
  });

  const techUser = await prisma.user.create({
    data: {
      id: COMP_DORM.tech.id,
      googleSubject: COMP_DORM.tech.googleSubject,
      name: COMP_DORM.tech.name,
      email: COMP_DORM.tech.email,
      emailNormalized: COMP_DORM.tech.email.toLowerCase(),
      phone: COMP_DORM.tech.phone,
      status: 'active',
    },
  });

  const tenantSomchaiUser = await prisma.user.create({
    data: {
      id: COMP_DORM.tenantSomchai.id,
      googleSubject: COMP_DORM.tenantSomchai.googleSubject,
      name: COMP_DORM.tenantSomchai.name,
      email: COMP_DORM.tenantSomchai.email,
      emailNormalized: COMP_DORM.tenantSomchai.email.toLowerCase(),
      phone: COMP_DORM.tenantSomchai.phone,
      status: 'active',
    },
  });

  // Provision Comp Dormitory
  const compDorm = await prisma.dormitory.create({
    data: {
      id: COMP_DORM.id,
      name: COMP_DORM.name,
      type: COMP_DORM.type,
      genderPolicy: COMP_DORM.genderPolicy,
      addressLine1: COMP_DORM.addressLine1,
      subdistrict: COMP_DORM.subdistrict,
      district: COMP_DORM.district,
      province: COMP_DORM.province,
      postalCode: COMP_DORM.postalCode,
      phone: COMP_DORM.phone,
      email: COMP_DORM.email,
      estimatedBuildingCount: COMP_DORM.estimatedBuildingCount,
      estimatedRoomCount: COMP_DORM.estimatedRoomCount,
      status: 'active',
      createdByUserId: compOwnerUser.id,
    },
  });

  // Roles for Comp Dorm
  const compOwnerRole = await prisma.role.create({
    data: {
      dormitoryId: compDorm.id,
      code: 'OWNER',
      name: 'เจ้าของหอพัก',
      isSystem: true,
      permissions: {
        dashboard: { view: true, export: true },
        rooms: { view: true, create: true, edit: true, delete: true },
        tenants: { view: true, create: true, edit: true, delete: true },
        contracts: { view: true, create: true, edit: true, delete: true },
        meters: { view: true, create: true, edit: true },
        billing: { view: true, create: true, edit: true, delete: true },
        payments: { view: true, approve: true, reject: true },
        settings: { view: true, manageSettings: true, manageUsers: true },
      },
    },
  });

  const compManagerRole = await prisma.role.create({
    data: {
      dormitoryId: compDorm.id,
      code: 'MANAGER',
      name: 'ผู้จัดการหอพัก',
      isSystem: true,
      permissions: {
        dashboard: { view: true, export: true },
        rooms: { view: true, create: true, edit: true },
        tenants: { view: true, create: true, edit: true },
        contracts: { view: true, create: true, edit: true },
        meters: { view: true, create: true, edit: true },
        billing: { view: true, create: true, edit: true },
        payments: { view: true, approve: true, reject: true },
        maintenance: { view: true, create: true, edit: true },
        announcements: { view: true, create: true, edit: true },
        reports: { view: true, export: true },
      },
    },
  });

  const compTechRole = await prisma.role.create({
    data: {
      dormitoryId: compDorm.id,
      code: 'TECH',
      name: 'ช่างประจำหอพัก',
      isSystem: true,
      permissions: {
        dashboard: { view: true },
        rooms: { view: true },
        meters: { view: true, create: true, edit: true },
        maintenance: { view: true, create: true, edit: true },
      },
    },
  });

  const compTenantRole = await prisma.role.create({
    data: {
      dormitoryId: compDorm.id,
      code: 'TENANT',
      name: 'ผู้เช่า',
      isSystem: true,
      permissions: {
        portal: { view: true },
      },
    },
  });

  // Memberships
  await prisma.dormitoryMember.createMany({
    data: [
      { dormitoryId: compDorm.id, userId: compOwnerUser.id, roleId: compOwnerRole.id, status: 'active' },
      { dormitoryId: compDorm.id, userId: managerUser.id, roleId: compManagerRole.id, status: 'active' },
      { dormitoryId: compDorm.id, userId: techUser.id, roleId: compTechRole.id, status: 'active' },
      { dormitoryId: compDorm.id, userId: tenantSomchaiUser.id, roleId: compTenantRole.id, status: 'active' },
    ],
  });

  // Billing Settings
  await prisma.dormitoryBillingSettings.create({
    data: {
      dormitoryId: compDorm.id,
      billingDay: COMP_DORM.billing.billingDay,
      dueDay: COMP_DORM.billing.dueDay,
      waterBillingType: COMP_DORM.billing.waterBillingType,
      waterRate: COMP_DORM.billing.waterRate,
      electricityBillingType: COMP_DORM.billing.electricityBillingType,
      electricityRate: COMP_DORM.billing.electricityRate,
      commonFee: COMP_DORM.billing.commonFee,
      internetFee: COMP_DORM.billing.internetFee,
      parkingRate: COMP_DORM.billing.parkingRate,
      gracePeriodDays: COMP_DORM.billing.gracePeriodDays,
      advanceRentMonths: COMP_DORM.billing.advanceRentMonths,
      lateFeeType: COMP_DORM.billing.lateFeeType,
      lateFeeValue: COMP_DORM.billing.lateFeeValue,
      rentBillingType: COMP_DORM.billing.rentBillingType,
      cashAccepted: COMP_DORM.payment.cashAccepted,
      promptPayType: COMP_DORM.payment.promptPayType,
      promptPayValue: COMP_DORM.payment.promptPayValue,
      bankCode: COMP_DORM.payment.bankCode,
      bankAccountName: COMP_DORM.payment.bankAccountName,
      bankAccountNumber: COMP_DORM.payment.bankAccountNumber,
    },
  });

  // Property Defaults
  await prisma.dormitoryPropertyDefaults.create({
    data: {
      dormitoryId: compDorm.id,
      defaultMonthlyRent: 4500,
      defaultDeposit: 4500,
      defaultMaxOccupants: 2,
    },
  });

  // Subscription (PAID/PRO Active)
  const oneYearLater = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
  const paidSubPlan = await prisma.subscriptionPlan.findFirst({ where: { type: 'PAID' } }) 
    || await prisma.subscriptionPlan.findFirst({ where: { code: 'PAID' } })
    || freeSubPlan;

  if (paidSubPlan) {
    await prisma.dormitorySubscription.create({
      data: {
        dormitoryId: compDorm.id,
        planId: paidSubPlan.id,
        status: 'ACTIVE',
        startedAt: now,
        expiresAt: oneYearLater,
      },
    });
  }

  // Buildings
  const bldA = await prisma.building.create({
    data: {
      id: COMP_DORM.buildings[0].id,
      dormitoryId: compDorm.id,
      name: COMP_DORM.buildings[0].name,
      code: COMP_DORM.buildings[0].code,
      floorCount: COMP_DORM.buildings[0].floorsCount,
      roomsPerFloor: COMP_DORM.buildings[0].roomsPerFloor,
      monthlyRent: COMP_DORM.buildings[0].monthlyRent,
      depositAmount: COMP_DORM.buildings[0].depositAmount,
      maximumOccupants: COMP_DORM.buildings[0].maximumOccupants,
    },
  });

  const bldB = await prisma.building.create({
    data: {
      id: COMP_DORM.buildings[1].id,
      dormitoryId: compDorm.id,
      name: COMP_DORM.buildings[1].name,
      code: COMP_DORM.buildings[1].code,
      floorCount: COMP_DORM.buildings[1].floorsCount,
      roomsPerFloor: COMP_DORM.buildings[1].roomsPerFloor,
      monthlyRent: COMP_DORM.buildings[1].monthlyRent,
      depositAmount: COMP_DORM.buildings[1].depositAmount,
      maximumOccupants: COMP_DORM.buildings[1].maximumOccupants,
      waterRate: COMP_DORM.buildings[1].waterRateOverride,
      electricityRate: COMP_DORM.buildings[1].electricityRateOverride,
    },
  });

  // 18 Comprehensive Rooms
  const roomData = [
    // Floor 1 (Building A)
    { roomNumber: '101', floor: 1, rent: 4500, status: 'occupied', bldId: bldA.id },
    { roomNumber: '102', floor: 1, rent: 4500, status: 'occupied', bldId: bldA.id },
    { roomNumber: '103', floor: 1, rent: 4500, status: 'occupied', bldId: bldA.id },
    { roomNumber: '104', floor: 1, rent: 4500, status: 'occupied', bldId: bldA.id },
    { roomNumber: '105', floor: 1, rent: 4500, status: 'vacant', bldId: bldA.id },
    { roomNumber: '106', floor: 1, rent: 4500, status: 'vacant', bldId: bldA.id },
    // Floor 2 (Building A)
    { roomNumber: '201', floor: 2, rent: 4800, status: 'occupied', bldId: bldA.id },
    { roomNumber: '202', floor: 2, rent: 4800, status: 'occupied', bldId: bldA.id },
    { roomNumber: '203', floor: 2, rent: 4800, status: 'occupied', bldId: bldA.id },
    { roomNumber: '204', floor: 2, rent: 4800, status: 'vacant', bldId: bldA.id }, // Moved out 2026-07-31, settlement pending
    { roomNumber: '205', floor: 2, rent: 4800, status: 'vacant', bldId: bldA.id },
    { roomNumber: '206', floor: 2, rent: 4800, status: 'maintenance', bldId: bldA.id },
    // Floor 3 (Building A)
    { roomNumber: '301', floor: 3, rent: 5000, status: 'occupied', bldId: bldA.id },
    { roomNumber: '302', floor: 3, rent: 5000, status: 'occupied', bldId: bldA.id },
    { roomNumber: '303', floor: 3, rent: 5000, status: 'occupied', bldId: bldA.id },
    { roomNumber: '304', floor: 3, rent: 5000, status: 'reserved', bldId: bldA.id },
    // Building B
    { roomNumber: 'B101', floor: 1, rent: 5500, status: 'occupied', bldId: bldB.id },
    { roomNumber: 'B102', floor: 1, rent: 5500, status: 'vacant', bldId: bldB.id },
  ];

  const createdRooms = {};
  for (const rd of roomData) {
    const room = await prisma.room.create({
      data: {
        dormitoryId: compDorm.id,
        buildingId: rd.bldId,
        roomNumber: rd.roomNumber,
        normalizedRoomNumber: rd.roomNumber.toLowerCase().trim(),
        roomType: 'standard',
        floor: rd.floor,
        monthlyRent: rd.rent,
        depositAmount: rd.rent,
        status: rd.status,
      },
    });
    createdRooms[rd.roomNumber] = room;
  }

  // Tenants Definitions
  const tenantConfigs = [
    { key: 't101', tNum: 'TNT-001', name: 'นายสมชาย ใจดี', fName: 'สมชาย', lName: 'ใจดี', phone: '0811112222', natMask: '1-1001-XXXXX-11-1', roomNum: '101', linkedUserId: tenantSomchaiUser.id, coOccupants: [{ name: 'นางสมหญิง ใจดี', relation: 'คู่สมรส' }] },
    { key: 't102', tNum: 'TNT-002', name: 'นายสมศักดิ์ รักสงบ', fName: 'สมศักดิ์', lName: 'รักสงบ', phone: '0812223333', natMask: '1-1002-XXXXX-22-2', roomNum: '102' },
    { key: 't103', tNum: 'TNT-003', name: 'นางสาวอนงค์ งามยิ่ง', fName: 'อนงค์', lName: 'งามยิ่ง', phone: '0813334444', natMask: '1-1003-XXXXX-33-3', roomNum: '103' },
    { key: 't104', tNum: 'TNT-004', name: 'นายวิชัย มั่งมี', fName: 'วิชัย', lName: 'มั่งมี', phone: '0814445555', natMask: '1-1004-XXXXX-44-4', roomNum: '104', coOccupants: [{ name: 'นางวันดี มั่งมี', relation: 'คู่สมรส' }, { name: 'เด็กชายวิน มั่งมี', relation: 'บุตร' }, { name: 'เด็กหญิงวิภา มั่งมี', relation: 'บุตร' }] },
    { key: 't201', tNum: 'TNT-005', name: 'นางสาวมานี มีตา', fName: 'มานี', lName: 'มีตา', phone: '0815556666', natMask: '1-1005-XXXXX-55-5', roomNum: '201' },
    { key: 't202', tNum: 'TNT-006', name: 'นายปิติ สบายดี', fName: 'ปิติ', lName: 'สบายดี', phone: '0816667777', natMask: '1-1006-XXXXX-66-6', roomNum: '202' },
    { key: 't203', tNum: 'TNT-007', name: 'นางสาวชูใจ ใจอารี', fName: 'ชูใจ', lName: 'ใจอารี', phone: '0817778888', natMask: '1-1007-XXXXX-77-7', roomNum: '203' },
    { key: 't204', tNum: 'TNT-008', name: 'นายวีระ กล้าหาญ', fName: 'วีระ', lName: 'กล้าหาญ', phone: '0818889999', natMask: '1-1008-XXXXX-88-8', roomNum: '204' },
    { key: 't301', tNum: 'TNT-009', name: 'นายดนัย ดียิ่ง', fName: 'ดนัย', lName: 'ดียิ่ง', phone: '0810001111', natMask: '1-1009-XXXXX-99-9', roomNum: '301' },
    { key: 't302', tNum: 'TNT-010', name: 'นายนิรันดร์ สุขใจ', fName: 'นิรันดร์', lName: 'สุขใจ', phone: '0811234567', natMask: '1-1010-XXXXX-00-0', roomNum: '302' },
    { key: 't303', tNum: 'TNT-011', name: 'นายประเสริฐ เกิดผล', fName: 'ประเสริฐ', lName: 'เกิดผล', phone: '0812348901', natMask: '1-1011-XXXXX-11-1', roomNum: '303' },
    { key: 'tB101', tNum: 'TNT-012', name: 'นางสาวมาลัย หอมหวล', fName: 'มาลัย', lName: 'หอมหวล', phone: '0813456789', natMask: '1-1012-XXXXX-22-2', roomNum: 'B101' },
  ];

  const createdTenants = {};
  const createdContracts = {};

  for (const tc of tenantConfigs) {
    const room = createdRooms[tc.roomNum];
    const tenant = await prisma.tenant.create({
      data: {
        dormitoryId: compDorm.id,
        tenantNumber: tc.tNum,
        firstName: tc.fName,
        lastName: tc.lName,
        displayName: tc.name,
        phone: tc.phone,
        nationalIdMasked: tc.natMask,
        linkedUserId: tc.linkedUserId || null,
        status: 'active',
      },
    });
    createdTenants[tc.key] = tenant;

    // Contract
    const contract = await prisma.contract.create({
      data: {
        dormitoryId: compDorm.id,
        tenantId: tenant.id,
        roomId: room.id,
        contractNumber: `CTR-2026-${tc.roomNum}`,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        durationMonths: 12,
        rentAmount: room.monthlyRent,
        depositAmount: room.depositAmount,
        status: tc.roomNum === '204' ? 'terminated' : 'active',
      },
    });
    createdContracts[tc.key] = contract;

    // Occupancy
    await prisma.occupancy.create({
      data: {
        dormitoryId: compDorm.id,
        tenantId: tenant.id,
        roomId: room.id,
        contractId: contract.id,
        startedAt: new Date('2026-01-01'),
        endedAt: tc.roomNum === '204' ? new Date('2026-07-31') : null,
        status: tc.roomNum === '204' ? 'ENDED' : 'ACTIVE',
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
  }

  // Renewal Requests
  // 1. Manee (201) pending renewal
  await prisma.tenantRenewalRequest.create({
    data: {
      dormitoryId: compDorm.id,
      tenantId: createdTenants['t201'].id,
      contractId: createdContracts['t201'].id,
      roomId: createdRooms['201'].id,
      requestedDurationMonths: 6,
      requestedStartDate: new Date('2027-01-01'),
      requestedEndDate: new Date('2027-06-30'),
      status: 'PENDING_OWNER_APPROVAL',
    },
  });

  // 2. Piti (202) approved renewal -> scheduled contract
  const futureContract = await prisma.contract.create({
    data: {
      dormitoryId: compDorm.id,
      tenantId: createdTenants['t202'].id,
      roomId: createdRooms['202'].id,
      contractNumber: 'CTR-2027-202-EXT',
      startDate: new Date('2027-01-01'),
      endDate: new Date('2027-12-31'),
      durationMonths: 12,
      rentAmount: 4800,
      depositAmount: 4800,
      status: 'scheduled',
    },
  });

  await prisma.tenantRenewalRequest.create({
    data: {
      dormitoryId: compDorm.id,
      tenantId: createdTenants['t202'].id,
      contractId: createdContracts['t202'].id,
      roomId: createdRooms['202'].id,
      requestedDurationMonths: 12,
      requestedStartDate: new Date('2027-01-01'),
      requestedEndDate: new Date('2027-12-31'),
      status: 'APPROVED',
      reviewedAt: new Date(),
      reviewedByUserId: compOwnerUser.id,
      createdContractId: futureContract.id,
    },
  });

  // Move-out / Settlement: Room 204 (Veera)
  const settlementVeera = await prisma.contractSettlement.create({
    data: {
      dormitoryId: compDorm.id,
      tenantId: createdTenants['t204'].id,
      contractId: createdContracts['t204'].id,
      roomId: createdRooms['204'].id,
      depositAmount: 4800,
      unpaidBillAmount: 0,
      damageChargeTotal: 1500,
      netSettlement: 3300,
      settlementDirection: 'REFUND',
      settlementStatus: 'PENDING_REFUND',
    },
  });

  await prisma.contractSettlementItem.create({
    data: {
      settlementId: settlementVeera.id,
      description: 'ค่าทาสีผนังห้องและลบรอยคราบ',
      amount: 1500,
    },
  });

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

  // Bills & Line Items for July 2026 (11 Bills)
  const billFacts = [
    { tKey: 't101', roomNum: '101', rent: 4500, waterUnits: 10, waterRate: 18, elecUnits: 60, elecRate: 7, common: 200, internet: 150, parking: 0, surcharges: 0, status: 'paid', rcpNum: 'RCP-202607-001' },
    { tKey: 't102', roomNum: '102', rent: 4500, waterUnits: 10, waterRate: 18, elecUnits: 60, elecRate: 7, common: 200, internet: 150, parking: 0, surcharges: 0, status: 'unpaid' },
    { tKey: 't103', roomNum: '103', rent: 4500, waterUnits: 8, waterRate: 18, elecUnits: 48, elecRate: 7, common: 200, internet: 0, parking: 300, surcharges: 0, status: 'paid', rcpNum: 'RCP-202607-002' },
    { tKey: 't104', roomNum: '104', rent: 4500, waterUnits: 18, waterRate: 18, elecUnits: 120, elecRate: 7, common: 200, internet: 0, parking: 0, surcharges: 600, status: 'unpaid' }, // 3 co-occupants
    { tKey: 't201', roomNum: '201', rent: 4800, waterUnits: 12, waterRate: 18, elecUnits: 70, elecRate: 7, common: 200, internet: 150, parking: 0, surcharges: 0, status: 'paid', rcpNum: 'RCP-202607-003' },
    { tKey: 't202', roomNum: '202', rent: 4800, waterUnits: 10, waterRate: 18, elecUnits: 65, elecRate: 7, common: 200, internet: 0, parking: 0, surcharges: 0, status: 'paid', rcpNum: 'RCP-202607-004' },
    { tKey: 't203', roomNum: '203', rent: 4800, waterUnits: 12, waterRate: 18, elecUnits: 75, elecRate: 7, common: 200, internet: 150, parking: 0, surcharges: 0, status: 'unpaid' },
    { tKey: 't301', roomNum: '301', rent: 5000, waterUnits: 14, waterRate: 18, elecUnits: 80, elecRate: 7, common: 200, internet: 0, parking: 300, surcharges: 0, status: 'paid', rcpNum: 'RCP-202607-005' },
    { tKey: 't302', roomNum: '302', rent: 5000, waterUnits: 15, waterRate: 18, elecUnits: 90, elecRate: 7, common: 200, internet: 0, parking: 0, surcharges: 0, status: 'unpaid' },
    { tKey: 't303', roomNum: '303', rent: 5000, waterUnits: 12, waterRate: 18, elecUnits: 85, elecRate: 7, common: 200, internet: 150, parking: 0, surcharges: 0, status: 'paid', rcpNum: 'RCP-202607-006' },
    { tKey: 'tB101', roomNum: 'B101', rent: 5500, waterUnits: 15, waterRate: 20, elecUnits: 100, elecRate: 8, common: 200, internet: 0, parking: 300, surcharges: 0, status: 'paid', rcpNum: 'RCP-202607-007' },
  ];

  let rcpSeq = 1;
  for (const bf of billFacts) {
    const room = createdRooms[bf.roomNum];
    const tenant = createdTenants[bf.tKey];
    const contract = createdContracts[bf.tKey];

    const waterTotal = bf.waterUnits * bf.waterRate;
    const elecTotal = bf.elecUnits * bf.elecRate;
    const totalAmount = bf.rent + waterTotal + elecTotal + bf.common + bf.internet + bf.parking + bf.surcharges;
    const isPaid = bf.status === 'paid';

    const bill = await prisma.bill.create({
      data: {
        dormitoryId: compDorm.id,
        billingCycleId: cycleJuly.id,
        tenantId: tenant.id,
        roomId: room.id,
        contractId: contract.id,
        billNumber: `BILL-202607-${bf.roomNum}`,
        billingDate: new Date('2026-07-25'),
        dueDate: new Date('2026-08-05'),
        subtotal: totalAmount,
        totalAmount,
        paidAmount: isPaid ? totalAmount : 0,
        outstandingAmount: isPaid ? 0 : totalAmount,
        status: bf.status,
        paidAt: isPaid ? new Date('2026-07-28') : null,
      },
    });

    // Bill Items
    await prisma.billItem.createMany({
      data: [
        { dormitoryId: compDorm.id, billId: bill.id, type: 'rent', description: 'ค่าเช่าห้องพัก', quantity: 1, unitPrice: bf.rent, amount: bf.rent },
        { dormitoryId: compDorm.id, billId: bill.id, type: 'water', description: `ค่าน้ำประปา (${bf.waterUnits} หน่วย @ ฿${bf.waterRate})`, quantity: bf.waterUnits, unitPrice: bf.waterRate, amount: waterTotal },
        { dormitoryId: compDorm.id, billId: bill.id, type: 'electric', description: `ค่าไฟฟ้า (${bf.elecUnits} หน่วย @ ฿${bf.elecRate})`, quantity: bf.elecUnits, unitPrice: bf.elecRate, amount: elecTotal },
        { dormitoryId: compDorm.id, billId: bill.id, type: 'common', description: 'ค่าส่วนกลาง', quantity: 1, unitPrice: bf.common, amount: bf.common },
        ...(bf.internet > 0 ? [{ dormitoryId: compDorm.id, billId: bill.id, type: 'internet', description: 'ค่าอินเทอร์เน็ต', quantity: 1, unitPrice: bf.internet, amount: bf.internet }] : []),
        ...(bf.parking > 0 ? [{ dormitoryId: compDorm.id, billId: bill.id, type: 'parking', description: 'ค่าที่จอดรถ', quantity: 1, unitPrice: bf.parking, amount: bf.parking }] : []),
        ...(bf.surcharges > 0 ? [{ dormitoryId: compDorm.id, billId: bill.id, type: 'other', description: 'ค่าผู้พักอาศัยร่วมเกินโควต้า', quantity: 1, unitPrice: bf.surcharges, amount: bf.surcharges }] : []),
      ],
    });

    // If paid -> Payment & Receipt
    if (isPaid) {
      const payment = await prisma.payment.create({
        data: {
          dormitoryId: compDorm.id,
          billId: bill.id,
          tenantId: tenant.id,
          amount: totalAmount,
          method: 'promptpay',
          status: 'verified',
          paymentDate: new Date('2026-07-28'),
          reviewedAt: new Date('2026-07-28'),
          reviewedByUserId: compOwnerUser.id,
        },
      });

      await prisma.receipt.create({
        data: {
          dormitoryId: compDorm.id,
          billId: bill.id,
          paymentId: payment.id,
          receiptNumber: bf.rcpNum || `RCP-202607-${String(rcpSeq++).padStart(3, '0')}`,
          snapshotData: {
            dormitoryName: compDorm.name,
            tenantName: tenant.displayName,
            roomNumber: room.roomNumber,
            totalAmount,
            issuedDate: '2026-07-28',
          },
          issuedAt: new Date('2026-07-28'),
          isVoided: false,
        },
      });
    }
  }

  console.log(`✅ Comprehensive Owner provisioned: "${compDorm.name}" (18 rooms, 11 occupied, July 2026 billing cycle seeded with paid & unpaid bills, payments, receipts)`);

  console.log('\n================================================================================');
  console.log('🎉 LOCAL-07 DATASET SEEDING COMPLETE & FULLY POPULATED');
  console.log('================================================================================\n');

  await prisma.$disconnect();
}

if (process.argv[1] === new URL(import.meta.url).pathname || process.argv[1]?.endsWith('seed.mjs')) {
  seedLocal07Data().catch((err) => {
    console.error(`❌ [LOCAL-07 SEED FAILED] ${err.message}`);
    process.exit(1);
  });
}
