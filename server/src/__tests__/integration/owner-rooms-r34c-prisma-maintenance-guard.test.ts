/**
 * @license Apache-2.0
 * Real Prisma / PostgreSQL Boundary & Concurrency Integration Tests for Owner Rooms Decision F1 (R3.4c)
 *
 * Proves:
 * 1. Real Prisma schema field compatibility across DailyStay, Contract, and ProvisionalRentalTerm.
 * 2. RoomService.updateRoom transactional maintenance guard on live PostgreSQL database.
 * 3. Unified shared room-availability advisory lock across RoomService, Contract, Provisional, and DailyStay.
 * 4. Concurrency serialization invariants:
 *    - Maintenance vs Daily Stay Quick Add (correct DTO)
 *    - Maintenance vs Contract Creation / Activation
 *    - Maintenance vs Provisional Term Creation
 * 5. Committed status semantics (PENDING_APPROVAL does not block, RESERVED does block).
 * 6. Terminated contract physical interval semantics (future terminationEffectiveDate blocks).
 * 7. DefaultsService single & batch authoritative DTO enrichment with currentOperationalActions.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPrismaClient } from '../../db/prisma.js';
import { PrismaRoomRepository } from '../../db/repositories/room.repository.js';
import { PrismaBuildingRepository } from '../../db/repositories/building.repository.js';
import { PrismaSubscriptionRepository } from '../../db/repositories/subscription.repository.js';
import { PrismaSubscriptionPlanRepository } from '../../db/repositories/plan.repository.js';
import { PrismaContractRepository } from '../../db/repositories/contract.repository.js';
import { PrismaTenantRepository } from '../../db/repositories/tenant.repository.js';
import { RoomService } from '../../services/room.service.js';
import { ContractService } from '../../services/contract.service.js';
import { defaultsService } from '../../services/defaults.service.js';
import { dailyStayService } from '../../services/daily-stay.service.js';
import { provisionalRentalTermService } from '../../services/provisional-rental-term.service.js';
import { subscriptionEntitlementService } from '../../services/subscription-entitlement.service.js';
import { resetCachedEnv } from '../../config/env.js';

const prisma = getPrismaClient();

describe('HORPLUS R3.4c — Real Prisma / PostgreSQL Boundary & Concurrency Suite', () => {
  const testRunId = `r34c_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  let dormId: string;
  let bldId: string;
  let userId: string;
  let tenantId1: string;
  let tenantId2: string;
  let roomService: RoomService;
  let contractService: ContractService;

  // Rooms for test cases
  const roomIds: Record<string, string> = {};

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.E2E_TEST_MODE = 'true';
    resetCachedEnv();

    await subscriptionEntitlementService.ensureSeeded();
    const paidPlan = await prisma.subscriptionPlan.findFirst({ where: { code: 'PAID' } }) || await prisma.subscriptionPlan.findFirst();

    // Initialize Services with live Prisma repositories
    const roomRepo = new PrismaRoomRepository(prisma);
    const buildingRepo = new PrismaBuildingRepository(prisma);
    const subRepo = new PrismaSubscriptionRepository(prisma);
    const planRepo = new PrismaSubscriptionPlanRepository(prisma);
    const contractRepo = new PrismaContractRepository(prisma);
    const tenantRepo = new PrismaTenantRepository(prisma);

    roomService = new RoomService(roomRepo, buildingRepo, subRepo, planRepo, contractRepo, undefined, subscriptionEntitlementService, prisma);
    contractService = new ContractService(contractRepo, roomRepo, tenantRepo);

    // 1. Create User
    const ownerEmail = `${testRunId}@test.horplus.com`;
    const user = await prisma.user.create({
      data: {
        googleSubject: `sub_${testRunId}`,
        email: ownerEmail,
        emailNormalized: ownerEmail.toLowerCase(),
        name: 'Test Owner R3.4c',
      },
    });
    userId = user.id;

    // 2. Create Dormitory
    const dorm = await prisma.dormitory.create({
      data: {
        name: `Dorm R3.4c ${testRunId}`,
        type: 'apartment',
        addressLine1: '123 Real Prisma St',
        status: 'active',
      },
    });
    dormId = dorm.id;

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

    // Subscription (PAID plan for unlimited room entitlement in integration tests)
    if (paidPlan) {
      await prisma.dormitorySubscription.create({
        data: {
          dormitoryId: dormId,
          planId: paidPlan.id,
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
      'dailyPendingApproval',
      'dailyCheckedOut',
      'dailySoftDeleted',
      'contractActive',
      'contractReserved',
      'contractDraft',
      'contractTerminatedFuture',
      'contractTerminatedPast',
      'contractEnded',
      'provisionalActive',
      'provisionalReserved',
      'provisionalEnded',
      'concurrencyDailyRoom',
      'concurrencyContractRoom',
      'concurrencyProvisionalRoom',
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
          dailyRent: 600,
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

  it('Case 3 — Real DailyStay PENDING_APPROVAL does NOT block maintenance (uncommitted request)', async () => {
    const roomId = roomIds.dailyPendingApproval;
    const now = new Date();
    const startDate = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
    const endDate = new Date(now.getTime() + 10 * 24 * 3600 * 1000);

    await prisma.dailyStay.create({
      data: {
        dormitoryId: dormId,
        roomId,
        applicantFullName: 'Guest Pending',
        applicantPhone: '0823456789',
        startDate,
        endDate,
        checkInAt: startDate,
        checkOutAt: endDate,
        inclusiveDayCount: 3,
        dailyRateAmount: 600,
        totalRentAmount: 1800,
        depositAmount: 0,
        status: 'PENDING_APPROVAL',
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

  it('Case 4 — Real DailyStay CHECKED_OUT historical allows maintenance update', async () => {
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

  it('Case 5 — Real DailyStay soft-deleted allows maintenance update', async () => {
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

  it('Case 6 — Real active Contract blocks maintenance with ROOM_HAS_ACTIVE_OCCUPANCY', async () => {
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

  it('Case 7 — Real future committed Contract blocks maintenance with ROOM_HAS_ACTIVE_RESERVATION', async () => {
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

  it('Case 8 — Real draft Contract does NOT block maintenance', async () => {
    const roomId = roomIds.contractDraft;
    const now = new Date();
    const startDate = new Date(now.getTime() + 15 * 24 * 3600 * 1000);
    const endDate = new Date(now.getTime() + 345 * 24 * 3600 * 1000);

    await prisma.contract.create({
      data: {
        dormitoryId: dormId,
        roomId,
        tenantId: tenantId1,
        contractNumber: `CTR-${testRunId}-04`,
        startDate,
        endDate,
        durationMonths: 12,
        status: 'draft',
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

  it('Case 9 — Real terminated Contract with future terminationEffectiveDate blocks maintenance', async () => {
    const roomId = roomIds.contractTerminatedFuture;
    const now = new Date();
    const startDate = new Date(now.getTime() - 60 * 24 * 3600 * 1000);
    const origEndDate = new Date(now.getTime() + 300 * 24 * 3600 * 1000);
    const futureTerminationEffective = new Date(now.getTime() + 5 * 24 * 3600 * 1000);

    await prisma.contract.create({
      data: {
        dormitoryId: dormId,
        roomId,
        tenantId: tenantId1,
        contractNumber: `CTR-${testRunId}-05`,
        startDate,
        endDate: origEndDate,
        durationMonths: 12,
        status: 'terminated',
        terminatedAt: new Date(now.getTime() - 2 * 24 * 3600 * 1000),
        terminationEffectiveDate: futureTerminationEffective,
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

  it('Case 10 — Real terminated Contract with past terminationEffectiveDate allows maintenance', async () => {
    const roomId = roomIds.contractTerminatedPast;
    const now = new Date();
    const startDate = new Date(now.getTime() - 120 * 24 * 3600 * 1000);
    const origEndDate = new Date(now.getTime() + 240 * 24 * 3600 * 1000);
    const pastTerminationEffective = new Date(now.getTime() - 5 * 24 * 3600 * 1000);

    await prisma.contract.create({
      data: {
        dormitoryId: dormId,
        roomId,
        tenantId: tenantId2,
        contractNumber: `CTR-${testRunId}-06`,
        startDate,
        endDate: origEndDate,
        durationMonths: 12,
        status: 'terminated',
        terminatedAt: new Date(now.getTime() - 10 * 24 * 3600 * 1000),
        terminationEffectiveDate: pastTerminationEffective,
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

  it('Case 11 — Real ended/expired Contract allows maintenance update', async () => {
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

  it('Case 12 — Real active ProvisionalRentalTerm blocks maintenance with ROOM_HAS_ACTIVE_OCCUPANCY', async () => {
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

  it('Case 13 — Real future RESERVED ProvisionalRentalTerm blocks maintenance with ROOM_HAS_ACTIVE_RESERVATION', async () => {
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

  it('Case 14 — Real ended/deleted ProvisionalRentalTerm allows maintenance update', async () => {
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

  // --- Concurrency Invariant Tests ---

  it('Case 15 — Daily Concurrency Invariant: Maintenance toggle vs Quick Add Daily Stay with valid production DTO', async () => {
    const roomId = roomIds.concurrencyDailyRoom;
    const now = new Date();
    const startDateStr = new Date(now.getTime() + 5 * 24 * 3600 * 1000).toISOString().split('T')[0];
    const endDateStr = new Date(now.getTime() + 8 * 24 * 3600 * 1000).toISOString().split('T')[0];

    // Production OwnerQuickAddDailyStayDto (fullName, phone, startDate, endDate, dailyRateAmount, depositAmount)
    const validDailyDto = {
      roomId,
      fullName: 'Concurrent Guest Daily',
      phone: '0899999999',
      startDate: startDateStr,
      endDate: endDateStr,
      dailyRateAmount: 600,
      depositAmount: 0,
    };

    // Parallel execution targeting the exact same room
    const op1 = roomService.updateRoom({
      roomId,
      dormitoryId: dormId,
      changes: { status: 'maintenance' },
      expectedVersion: 1,
      actorUserId: userId,
    });

    const op2 = dailyStayService.ownerQuickAddDailyStay(dormId, validDailyDto, userId);

    const results = await Promise.allSettled([op1, op2]);
    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    // Exactly one must succeed, exactly one must fail
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    // Assert rejected reason is an availability/F1 conflict (NOT validation error)
    const failureReason: any = (rejected[0] as PromiseRejectedResult).reason;
    const errorCode = failureReason?.code || failureReason?.errorCode || failureReason?.message;
    expect([
      'ROOM_UNDER_MAINTENANCE',
      'ROOM_OCCUPIED_OR_HAS_ACTIVE_AGREEMENT',
      'ROOM_HAS_ACTIVE_RESERVATION',
      'ROOM_HAS_ACTIVE_OCCUPANCY',
    ]).toContain(errorCode);

    // Assert DB invariant: NOT (Room.status === maintenance AND committed stay exists)
    const finalRoom = await prisma.room.findUnique({ where: { id: roomId } });
    const finalDailyStay = await prisma.dailyStay.findFirst({
      where: { roomId, status: { in: ['ACTIVE', 'RESERVED'] }, deletedAt: null },
    });

    if (finalRoom?.status === 'maintenance') {
      expect(finalDailyStay).toBeNull();
    } else {
      expect(finalDailyStay).toBeDefined();
      expect(finalRoom?.status).not.toBe('maintenance');
    }
  });

  it('Case 16 — Contract Concurrency Invariant: Maintenance toggle vs Contract Creation', async () => {
    const roomId = roomIds.concurrencyContractRoom;
    const now = new Date();
    const startDate = new Date(now.getTime() + 10 * 24 * 3600 * 1000);
    const endDate = new Date(now.getTime() + 375 * 24 * 3600 * 1000);

    const validContractDto = {
      roomId,
      tenantId: tenantId1,
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
      durationMonths: 12,
      rentBillingType: 'monthly' as const,
      rentAmount: '4500.00',
      depositAmount: '5000.00',
      status: 'pending_signature',
    };

    // Parallel execution
    const op1 = roomService.updateRoom({
      roomId,
      dormitoryId: dormId,
      changes: { status: 'maintenance' },
      expectedVersion: 1,
      actorUserId: userId,
    });

    const op2 = contractService.createContract(dormId, validContractDto, userId);

    const results = await Promise.allSettled([op1, op2]);
    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const failureReason: any = (rejected[0] as PromiseRejectedResult).reason;
    const errorCode = failureReason?.code || failureReason?.errorCode;
    expect([
      'ROOM_UNDER_MAINTENANCE',
      'CONTRACT_OVERLAP',
      'ROOM_OCCUPIED_OR_HAS_ACTIVE_AGREEMENT',
      'ROOM_HAS_ACTIVE_RESERVATION',
      'ROOM_HAS_ACTIVE_OCCUPANCY',
    ]).toContain(errorCode);

    const finalRoom = await prisma.room.findUnique({ where: { id: roomId } });
    const finalContract = await prisma.contract.findFirst({
      where: { roomId, status: { notIn: ['draft', 'cancelled', 'void', 'rejected'] }, deletedAt: null },
    });

    if (finalRoom?.status === 'maintenance') {
      expect(finalContract).toBeNull();
    } else {
      expect(finalContract).toBeDefined();
      expect(finalRoom?.status).not.toBe('maintenance');
    }
  });

  it('Case 17 — Provisional Concurrency Invariant: Maintenance toggle vs Provisional Term Creation', async () => {
    const roomId = roomIds.concurrencyProvisionalRoom;
    const now = new Date();
    const startDateStr = new Date(now.getTime() + 15 * 24 * 3600 * 1000).toISOString().split('T')[0];
    const endDateStr = new Date(now.getTime() + 105 * 24 * 3600 * 1000).toISOString().split('T')[0];

    const validProvisionalDto = {
      roomId,
      fullName: 'Concurrent Provisional Guest',
      phone: '0833333333',
      rentalType: 'MONTHLY' as const,
      startDate: startDateStr,
      durationMonths: 3,
      unitRentAmount: 4500,
      totalRentAmount: 13500,
      depositAmount: 5000,
    };

    // Parallel execution
    const op1 = roomService.updateRoom({
      roomId,
      dormitoryId: dormId,
      changes: { status: 'maintenance' },
      expectedVersion: 1,
      actorUserId: userId,
    });

    const op2 = provisionalRentalTermService.createProvisionalTenantAndTerm(dormId, validProvisionalDto, userId);

    const results = await Promise.allSettled([op1, op2]);
    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const failureReason: any = (rejected[0] as PromiseRejectedResult).reason;
    const errorCode = failureReason?.code || failureReason?.errorCode || failureReason?.message;
    expect([
      'ROOM_UNDER_MAINTENANCE',
      'ROOM_OCCUPIED_OR_HAS_ACTIVE_AGREEMENT',
      'ROOM_HAS_ACTIVE_RESERVATION',
      'ROOM_HAS_ACTIVE_OCCUPANCY',
    ]).toContain(errorCode);

    const finalRoom = await prisma.room.findUnique({ where: { id: roomId } });
    const finalProvisional = await prisma.provisionalRentalTerm.findFirst({
      where: { roomId, status: { in: ['ACTIVE', 'RESERVED'] }, deletedAt: null },
    });

    if (finalRoom?.status === 'maintenance') {
      expect(finalProvisional).toBeNull();
    } else {
      expect(finalProvisional).toBeDefined();
      expect(finalRoom?.status).not.toBe('maintenance');
    }
  });

  // --- DefaultsService Production DTO Attachment Test ---

  it('Case 18 — Authoritative Room DTO: Single and Batch responses attach canonical currentOperationalActions', async () => {
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
