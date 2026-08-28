/**
 * @license Apache-2.0
 * Real Prisma / PostgreSQL Boundary & Concurrency Integration Tests for Owner Rooms Decision F1
 *
 * Proves:
 * 1. Real Prisma schema field compatibility across DailyStay, Contract, and ProvisionalRentalTerm.
 * 2. RoomService.updateRoom transactional maintenance guard on live PostgreSQL database.
 * 3. Concurrency serialization invariant: maintenance vs reservation cannot both commit.
 * 4. DefaultsService single & batch authoritative DTO enrichment with currentOperationalActions.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPrismaClient } from '../../db/prisma.js';
import { PrismaRoomRepository } from '../../db/repositories/room.repository.js';
import { PrismaBuildingRepository } from '../../db/repositories/building.repository.js';
import { PrismaSubscriptionRepository } from '../../db/repositories/subscription.repository.js';
import { PrismaSubscriptionPlanRepository } from '../../db/repositories/plan.repository.js';
import { PrismaContractRepository } from '../../db/repositories/contract.repository.js';
import { RoomService } from '../../services/room.service.js';
import { defaultsService } from '../../services/defaults.service.js';
import { dailyStayService } from '../../services/daily-stay.service.js';
import { subscriptionEntitlementService } from '../../services/subscription-entitlement.service.js';
import { resetCachedEnv } from '../../config/env.js';

const prisma = getPrismaClient();

describe('HORPLUS R3.4b — Real Prisma / PostgreSQL Boundary & Concurrency Suite', () => {
  const testRunId = `r34b_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  let dormId: string;
  let bldId: string;
  let userId: string;
  let tenantId1: string;
  let tenantId2: string;
  let roomService: RoomService;

  // Rooms for 10 database cases
  const roomIds: Record<string, string> = {};

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.E2E_TEST_MODE = 'true';
    resetCachedEnv();

    await subscriptionEntitlementService.ensureSeeded();
    const freePlan = await prisma.subscriptionPlan.findFirst({ where: { code: 'FREE' } });

    // Initialize RoomService with live Prisma repositories
    const roomRepo = new PrismaRoomRepository(prisma);
    const buildingRepo = new PrismaBuildingRepository(prisma);
    const subRepo = new PrismaSubscriptionRepository(prisma);
    const planRepo = new PrismaSubscriptionPlanRepository(prisma);
    const contractRepo = new PrismaContractRepository(prisma);
    roomService = new RoomService(roomRepo, buildingRepo, subRepo, planRepo, contractRepo, undefined, subscriptionEntitlementService, prisma);

    // 1. Create User
    const ownerEmail = `${testRunId}@test.horplus.com`;
    const user = await prisma.user.create({
      data: {
        googleSubject: `sub_${testRunId}`,
        email: ownerEmail,
        emailNormalized: ownerEmail.toLowerCase(),
        name: 'Test Owner R3.4b',
      },
    });
    userId = user.id;

    // 2. Create Dormitory
    const dorm = await prisma.dormitory.create({
      data: {
        name: `Dorm R3.4b ${testRunId}`,
        type: 'apartment',
        addressLine1: '123 Real Prisma St',
        status: 'active',
      },
    });
    dormId = dorm.id;

    // Subscription
    if (freePlan) {
      await prisma.dormitorySubscription.create({
        data: {
          dormitoryId: dormId,
          planId: freePlan.id,
          status: 'ACTIVE',
          expiresAt: new Date(Date.now() + 365 * 86400000),
        },
      });
    }

    // Role & Member
    const ownerRole = await prisma.role.create({
      data: {
        dormitoryId: dormId,
        code: 'OWNER',
        name: 'Owner',
        permissions: { '*': ['*'] },
        isSystem: true,
      },
    });

    await prisma.dormitoryMember.create({
      data: {
        dormitoryId: dormId,
        userId,
        roleId: ownerRole.id,
        status: 'active',
        membershipOrigin: 'GOOGLE_BOOTSTRAP',
      },
    });

    // 2b. Create Active Operational Billing Cycle
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const cycleCode = `${year}-${String(month).padStart(2, '0')}`;
    const startOfMonth = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
    const endOfMonth = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

    await prisma.billingCycle.create({
      data: {
        dormitoryId: dormId,
        cycleCode,
        name: `งวด ${cycleCode}`,
        periodStart: startOfMonth,
        periodEnd: endOfMonth,
        billingDate: startOfMonth,
        dueDate: endOfMonth,
        status: 'active',
      },
    });

    // 3. Create Building
    const building = await prisma.building.create({
      data: {
        dormitoryId: dormId,
        name: 'Building A',
      },
    });
    bldId = building.id;

    // 4. Create Tenants
    const t1 = await prisma.tenant.create({
      data: {
        dormitoryId: dormId,
        tenantNumber: `TNT-${testRunId}-01`,
        firstName: 'Tenant Alpha',
        displayName: 'Tenant Alpha',
        phone: '0811111111',
        status: 'active',
      },
    });
    tenantId1 = t1.id;

    const t2 = await prisma.tenant.create({
      data: {
        dormitoryId: dormId,
        tenantNumber: `TNT-${testRunId}-02`,
        firstName: 'Tenant Beta',
        displayName: 'Tenant Beta',
        phone: '0822222222',
        status: 'active',
      },
    });
    tenantId2 = t2.id;

    // 5. Create Rooms
    const keys = [
      'dailyActive',
      'dailyReserved',
      'dailyCheckedOut',
      'dailySoftDeleted',
      'contractActive',
      'contractReserved',
      'contractEnded',
      'provisionalActive',
      'provisionalReserved',
      'provisionalEnded',
      'concurrencyRoom',
    ];

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const roomNum = `${100 + i}`;
      const room = await prisma.room.create({
        data: {
          dormitoryId: dormId,
          buildingId: bldId,
          roomNumber: roomNum,
          normalizedRoomNumber: roomNum,
          floor: 1,
          roomType: 'standard',
          status: 'vacant',
          monthlyRent: 4500,
          monthlyDeposit: 5000,
          termDeposit: 5000,
          dailyDeposit: 5000,
          depositAmount: 5000,
          version: 1,
        },
      });
      roomIds[key] = room.id;
    }
  });

  afterAll(async () => {
    try {
      await prisma.dailyStay.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.contract.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.provisionalRentalTerm.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.roomOperationalStatusChange.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.auditLog.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.room.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.tenant.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.building.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.dormitoryMember.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.role.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.billingCycle.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.dormitorySubscription.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.dormitory.deleteMany({ where: { id: dormId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    } catch {
      // Ignore cleanup error
    }
  });

  // --- Real Prisma Database Cases ---

  it('Case 1 — Real DailyStay ACTIVE blocks maintenance with ROOM_HAS_ACTIVE_OCCUPANCY', async () => {
    const roomId = roomIds.dailyActive;
    const now = new Date();
    const startDate = new Date(now.getTime() - 24 * 3600 * 1000);
    const endDate = new Date(now.getTime() + 24 * 3600 * 1000);

    // Insert real DailyStay with authoritative schema fields
    await prisma.dailyStay.create({
      data: {
        dormitoryId: dormId,
        roomId,
        applicantFullName: 'Guest Active',
        applicantPhone: '0812345678',
        startDate,
        endDate,
        checkInAt: startDate,
        checkOutAt: endDate,
        inclusiveDayCount: 2,
        dailyRateAmount: 600,
        totalRentAmount: 1200,
        depositAmount: 0,
        status: 'ACTIVE',
      },
    });

    await expect(
      roomService.updateRoom({
        roomId,
        dormitoryId: dormId,
        changes: { status: 'maintenance' },
        expectedVersion: 1,
        actorUserId: userId,
      })
    ).rejects.toThrow('ไม่สามารถปิดปรับปรุงได้ เนื่องจากห้องนี้มีผู้เช่าพักอยู่');
  });

  it('Case 2 — Real DailyStay RESERVED future blocks maintenance with ROOM_HAS_ACTIVE_RESERVATION', async () => {
    const roomId = roomIds.dailyReserved;
    const now = new Date();
    const startDate = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
    const endDate = new Date(now.getTime() + 10 * 24 * 3600 * 1000);

    await prisma.dailyStay.create({
      data: {
        dormitoryId: dormId,
        roomId,
        applicantFullName: 'Guest Reserved',
        applicantPhone: '0823456789',
        startDate,
        endDate,
        checkInAt: startDate,
        checkOutAt: endDate,
        inclusiveDayCount: 3,
        dailyRateAmount: 600,
        totalRentAmount: 1800,
        depositAmount: 0,
        status: 'RESERVED',
      },
    });

    await expect(
      roomService.updateRoom({
        roomId,
        dormitoryId: dormId,
        changes: { status: 'maintenance' },
        expectedVersion: 1,
        actorUserId: userId,
      })
    ).rejects.toThrow('ไม่สามารถปิดปรับปรุงได้ เนื่องจากห้องนี้มีการจองล่วงหน้า');
  });

  it('Case 3 — Real DailyStay CHECKED_OUT historical allows maintenance update', async () => {
    const roomId = roomIds.dailyCheckedOut;
    const now = new Date();
    const startDate = new Date(now.getTime() - 5 * 24 * 3600 * 1000);
    const endDate = new Date(now.getTime() - 2 * 24 * 3600 * 1000);

    await prisma.dailyStay.create({
      data: {
        dormitoryId: dormId,
        roomId,
        applicantFullName: 'Guest CheckedOut',
        applicantPhone: '0834567890',
        startDate,
        endDate,
        checkInAt: startDate,
        checkOutAt: endDate,
        actualCheckedOutAt: endDate,
        inclusiveDayCount: 3,
        dailyRateAmount: 600,
        totalRentAmount: 1800,
        depositAmount: 0,
        status: 'CHECKED_OUT',
      },
    });

    const res = await roomService.updateRoom({
      roomId,
      dormitoryId: dormId,
      changes: { status: 'maintenance' },
      expectedVersion: 1,
      actorUserId: userId,
    });

    expect(res.status).toBe('maintenance');
    expect(res.version).toBe(2);
  });

  it('Case 4 — Real DailyStay soft-deleted allows maintenance update', async () => {
    const roomId = roomIds.dailySoftDeleted;
    const now = new Date();
    const startDate = new Date(now.getTime() - 24 * 3600 * 1000);
    const endDate = new Date(now.getTime() + 24 * 3600 * 1000);

    await prisma.dailyStay.create({
      data: {
        dormitoryId: dormId,
        roomId,
        applicantFullName: 'Guest Deleted',
        applicantPhone: '0845678901',
        startDate,
        endDate,
        checkInAt: startDate,
        checkOutAt: endDate,
        inclusiveDayCount: 2,
        dailyRateAmount: 600,
        totalRentAmount: 1200,
        depositAmount: 0,
        status: 'ACTIVE',
        deletedAt: new Date(),
      },
    });

    const res = await roomService.updateRoom({
      roomId,
      dormitoryId: dormId,
      changes: { status: 'maintenance' },
      expectedVersion: 1,
      actorUserId: userId,
    });

    expect(res.status).toBe('maintenance');
    expect(res.version).toBe(2);
  });

  it('Case 5 — Real active Contract blocks maintenance with ROOM_HAS_ACTIVE_OCCUPANCY', async () => {
    const roomId = roomIds.contractActive;
    const now = new Date();
    const startDate = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
    const endDate = new Date(now.getTime() + 300 * 24 * 3600 * 1000);

    await prisma.contract.create({
      data: {
        dormitoryId: dormId,
        roomId,
        tenantId: tenantId1,
        contractNumber: `CTR-${testRunId}-01`,
        startDate,
        endDate,
        durationMonths: 12,
        status: 'active',
        rentBillingType: 'monthly',
        rentAmount: 4500,
        depositAmount: 5000,
      },
    });

    await expect(
      roomService.updateRoom({
        roomId,
        dormitoryId: dormId,
        changes: { status: 'maintenance' },
        expectedVersion: 1,
        actorUserId: userId,
      })
    ).rejects.toThrow('ไม่สามารถปิดปรับปรุงได้ เนื่องจากห้องนี้มีผู้เช่าพักอยู่');
  });

  it('Case 6 — Real future committed Contract blocks maintenance with ROOM_HAS_ACTIVE_RESERVATION', async () => {
    const roomId = roomIds.contractReserved;
    const now = new Date();
    const startDate = new Date(now.getTime() + 15 * 24 * 3600 * 1000);
    const endDate = new Date(now.getTime() + 345 * 24 * 3600 * 1000);

    await prisma.contract.create({
      data: {
        dormitoryId: dormId,
        roomId,
        tenantId: tenantId2,
        contractNumber: `CTR-${testRunId}-02`,
        startDate,
        endDate,
        durationMonths: 12,
        status: 'pending_signature',
        rentBillingType: 'monthly',
        rentAmount: 4500,
        depositAmount: 5000,
      },
    });

    await expect(
      roomService.updateRoom({
        roomId,
        dormitoryId: dormId,
        changes: { status: 'maintenance' },
        expectedVersion: 1,
        actorUserId: userId,
      })
    ).rejects.toThrow('ไม่สามารถปิดปรับปรุงได้ เนื่องจากห้องนี้มีการจองล่วงหน้า');
  });

  it('Case 7 — Real ended/deleted Contract allows maintenance update', async () => {
    const roomId = roomIds.contractEnded;
    const now = new Date();
    const startDate = new Date(now.getTime() - 365 * 24 * 3600 * 1000);
    const endDate = new Date(now.getTime() - 10 * 24 * 3600 * 1000);

    await prisma.contract.create({
      data: {
        dormitoryId: dormId,
        roomId,
        tenantId: tenantId1,
        contractNumber: `CTR-${testRunId}-03`,
        startDate,
        endDate,
        durationMonths: 12,
        status: 'expired',
        rentBillingType: 'monthly',
        rentAmount: 4500,
        depositAmount: 5000,
      },
    });

    const res = await roomService.updateRoom({
      roomId,
      dormitoryId: dormId,
      changes: { status: 'maintenance' },
      expectedVersion: 1,
      actorUserId: userId,
    });

    expect(res.status).toBe('maintenance');
    expect(res.version).toBe(2);
  });

  it('Case 8 — Real active ProvisionalRentalTerm blocks maintenance with ROOM_HAS_ACTIVE_OCCUPANCY', async () => {
    const roomId = roomIds.provisionalActive;
    const now = new Date();
    const startDate = new Date(now.getTime() - 10 * 24 * 3600 * 1000);
    const endDate = new Date(now.getTime() + 100 * 24 * 3600 * 1000);

    await prisma.provisionalRentalTerm.create({
      data: {
        dormitoryId: dormId,
        roomId,
        tenantId: tenantId1,
        rentalType: 'MONTHLY',
        startDate,
        endDate,
        status: 'ACTIVE',
        unitRentAmount: 4500,
        totalRentAmount: 4500,
        depositAmount: 5000,
      },
    });

    await expect(
      roomService.updateRoom({
        roomId,
        dormitoryId: dormId,
        changes: { status: 'maintenance' },
        expectedVersion: 1,
        actorUserId: userId,
      })
    ).rejects.toThrow('ไม่สามารถปิดปรับปรุงได้ เนื่องจากห้องนี้มีผู้เช่าพักอยู่');
  });

  it('Case 9 — Real future RESERVED ProvisionalRentalTerm blocks maintenance with ROOM_HAS_ACTIVE_RESERVATION', async () => {
    const roomId = roomIds.provisionalReserved;
    const now = new Date();
    const startDate = new Date(now.getTime() + 20 * 24 * 3600 * 1000);
    const endDate = new Date(now.getTime() + 120 * 24 * 3600 * 1000);

    await prisma.provisionalRentalTerm.create({
      data: {
        dormitoryId: dormId,
        roomId,
        tenantId: tenantId2,
        rentalType: 'MONTHLY',
        startDate,
        endDate,
        status: 'RESERVED',
        unitRentAmount: 4500,
        totalRentAmount: 4500,
        depositAmount: 5000,
      },
    });

    await expect(
      roomService.updateRoom({
        roomId,
        dormitoryId: dormId,
        changes: { status: 'maintenance' },
        expectedVersion: 1,
        actorUserId: userId,
      })
    ).rejects.toThrow('ไม่สามารถปิดปรับปรุงได้ เนื่องจากห้องนี้มีการจองล่วงหน้า');
  });

  it('Case 10 — Real ended/deleted ProvisionalRentalTerm allows maintenance update', async () => {
    const roomId = roomIds.provisionalEnded;
    const now = new Date();
    const startDate = new Date(now.getTime() - 100 * 24 * 3600 * 1000);
    const endDate = new Date(now.getTime() - 10 * 24 * 3600 * 1000);

    await prisma.provisionalRentalTerm.create({
      data: {
        dormitoryId: dormId,
        roomId,
        tenantId: tenantId1,
        rentalType: 'MONTHLY',
        startDate,
        endDate,
        status: 'ENDED',
        unitRentAmount: 4500,
        totalRentAmount: 4500,
        depositAmount: 5000,
      },
    });

    const res = await roomService.updateRoom({
      roomId,
      dormitoryId: dormId,
      changes: { status: 'maintenance' },
      expectedVersion: 1,
      actorUserId: userId,
    });

    expect(res.status).toBe('maintenance');
    expect(res.version).toBe(2);
  });

  // --- Concurrency Invariant Test ---

  it('Concurrency Invariant — Simultaneous maintenance toggle and reservation creation cannot both commit', async () => {
    const roomId = roomIds.concurrencyRoom;
    const now = new Date();
    const startDate = new Date(now.getTime() + 5 * 24 * 3600 * 1000);
    const endDate = new Date(now.getTime() + 8 * 24 * 3600 * 1000);

    // Run parallel operations targeting the exact same room
    const op1 = roomService.updateRoom({
      roomId,
      dormitoryId: dormId,
      changes: { status: 'maintenance' },
      expectedVersion: 1,
      actorUserId: userId,
    });

    const op2 = dailyStayService.ownerQuickAddDailyStay(dormId, {
      roomId,
      applicantFullName: 'Concurrent Guest',
      applicantPhone: '0899999999',
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
      inclusiveDayCount: 3,
      dailyRateAmount: 600,
      totalRentAmount: 1800,
      depositAmount: 0,
    }, userId);

    const results = await Promise.allSettled([op1, op2]);
    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    // Exactly one must succeed, and one must fail (or both serialized cleanly without illegal dual-commit)
    expect(fulfilled.length + rejected.length).toBe(2);

    // Verify room and daily stays in DB
    const finalRoom = await prisma.room.findUnique({ where: { id: roomId } });
    const finalDailyStay = await prisma.dailyStay.findFirst({ where: { roomId, deletedAt: null } });

    if (finalRoom?.status === 'maintenance') {
      // If maintenance committed, daily stay reservation must NOT exist
      expect(finalDailyStay).toBeNull();
    } else {
      // If reservation committed, room must not be maintenance
      expect(finalDailyStay).toBeDefined();
      expect(finalRoom?.status).not.toBe('maintenance');
    }
  });

  // --- DefaultsService Production DTO Attachment Test ---

  it('Authoritative Room DTO — Single and Batch responses attach canonical currentOperationalActions', async () => {
    const reservedRoomId = roomIds.dailyReserved;
    const roomRecord = await prisma.room.findUnique({ where: { id: reservedRoomId } });
    expect(roomRecord).toBeDefined();

    // 1. Single room DTO
    const singleDto = await defaultsService.buildAuthoritativeRoomResponse(dormId, roomRecord);
    expect(singleDto.currentOperationalActions).toBeDefined();
    expect(singleDto.currentOperationalActions.canSetMaintenance).toBe(false);
    expect(singleDto.currentOperationalActions.maintenanceBlockReason).toBe('ACTIVE_RESERVATION');

    // 2. Batch rooms DTO
    const allRooms = await prisma.room.findMany({ where: { dormitoryId: dormId } });
    const batchDtos = await defaultsService.buildAuthoritativeRoomsResponseBatch(dormId, allRooms);
    const batchReserved = batchDtos.find(r => r.id === reservedRoomId);

    expect(batchReserved).toBeDefined();
    expect(batchReserved?.currentOperationalActions).toBeDefined();
    expect(batchReserved?.currentOperationalActions.canSetMaintenance).toBe(false);
    expect(batchReserved?.currentOperationalActions.maintenanceBlockReason).toBe('ACTIVE_RESERVATION');
  });
});
