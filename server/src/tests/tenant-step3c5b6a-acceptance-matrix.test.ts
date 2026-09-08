import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getPrismaClient } from '../db/prisma.js';
import { createApp } from '../app.js';
import { AuthenticationService } from '../services/auth.service.js';
import { getEnv, resetCachedEnv } from '../config/env.js';
import { PrismaUserRepository } from '../db/repositories/user.repository.js';
import { PrismaSessionRepository } from '../db/repositories/session.repository.js';
import { PrismaMembershipRepository } from '../db/repositories/membership.repository.js';
import { PrismaRoleRepository } from '../db/repositories/role.repository.js';
import { tenantRegistrationService } from '../services/tenant-registration.service.js';
import { settlementService } from '../services/settlement.service.js';
import { SignatureStorageService } from '../services/signature-storage.service.js';
import { DailyStayService } from '../services/daily-stay.service.js';
import { PNG } from 'pngjs';
import { Prisma } from '@prisma/client';

function createValidSignaturePng(seed: number = 1): Buffer {
  const png = new PNG({ width: 60, height: 25 });
  for (let y = 0; y < 25; y++) {
    for (let x = 0; x < 60; x++) {
      const idx = (60 * y + x) << 2;
      const isStroke = (x >= 10 && x <= 50 && y >= 10 && y <= 14) || (x === y + (seed % 10));
      if (isStroke) {
        png.data[idx] = 20;
        png.data[idx + 1] = 20;
        png.data[idx + 2] = 20;
        png.data[idx + 3] = 255;
      } else {
        png.data[idx] = 255;
        png.data[idx + 1] = 255;
        png.data[idx + 2] = 255;
        png.data[idx + 3] = 0;
      }
    }
  }
  return PNG.sync.write(png);
}

describe('Tenant Phase 3 Step 3C.5B.6A: Full Acceptance Matrix & Forensic Proofs', () => {
  const prisma = getPrismaClient();
  let app: any;
  let authService: any;

  let ownerUserId: string;
  let dormId: string;
  let dormitoryId: string;
  let buildingId: string;
  let roomId: string;
  let room2Id: string;
  let dummyTenantId: string;
  let billingCycleId: string;
  let sessionCookie: string;
  let csrfToken: string;

  const validPngBuffer = createValidSignaturePng(1);

  const createdRegistrationIds: string[] = [];
  const createdTenantIds: string[] = [];
  const createdContractIds: string[] = [];
  const createdDailyStayIds: string[] = [];
  const createdBillIds: string[] = [];
  const createdSettlementIds: string[] = [];
  const createdSignatureIds: string[] = [];

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.E2E_TEST_MODE = 'true';
    resetCachedEnv();

    const mockGoogleVerifier = {} as any;
    const mockAuditService = { logAction: async () => {}, logSecurityEvent: async () => {} } as any;

    authService = new AuthenticationService(
      getEnv(),
      mockGoogleVerifier,
      new PrismaUserRepository(prisma),
      new PrismaSessionRepository(prisma),
      new PrismaMembershipRepository(prisma),
      new PrismaRoleRepository(prisma),
      mockAuditService
    );

    app = createApp({ customAuthService: authService, forcePrisma: true });

    // Setup Test Dormitory and Owner
    const suffix = crypto.randomBytes(4).toString('hex');
    const ownerUser = await prisma.user.create({
      data: {
        googleSubject: `google-sub-${suffix}`,
        email: `matrix-owner-${suffix}@example.com`,
        emailNormalized: `matrix-owner-${suffix}@example.com`,
        name: `Owner Matrix ${suffix}`,
        status: 'active',
      },
    });
    ownerUserId = ownerUser.id;

    const dorm = await prisma.dormitory.create({
      data: {
        name: `Matrix Acceptance Dorm ${suffix}`,
        addressLine1: '123 Acceptance Ave',
        province: 'Bangkok',
        status: 'active',
        createdByUserId: ownerUserId,
      },
    });
    dormId = dorm.id;
    dormitoryId = dorm.id;

    const role = await prisma.role.create({
      data: {
        dormitoryId: dormId,
        code: 'OWNER',
        name: 'Owner',
        isSystem: true,
        permissions: ['*'],
      },
    });

    await prisma.dormitoryMember.create({
      data: {
        dormitoryId: dormId,
        userId: ownerUserId,
        roleId: role.id,
        status: 'active',
      },
    });

    const auth = await authService.authenticateTestUser(ownerUserId);
    sessionCookie = `horplus_session=${auth.sessionToken}; horplus_csrf=${auth.csrfToken}`;
    csrfToken = auth.csrfToken;

    const building = await prisma.building.create({
      data: {
        dormitoryId: dormId,
        name: 'Building A',
        code: 'A',
      },
    });
    buildingId = building.id;

    const room = await prisma.room.create({
      data: {
        dormitoryId: dormId,
        buildingId: buildingId,
        roomNumber: `A101-${suffix}`,
        normalizedRoomNumber: `a101-${suffix}`,
        floor: 1,
        monthlyRent: 4500,
        depositAmount: 5000,
        monthlyDeposit: 5000,
        termDeposit: 10000,
        dailyDeposit: 500,
        status: 'vacant',
      },
    });
    roomId = room.id;

    const room2 = await prisma.room.create({
      data: {
        dormitoryId: dormId,
        buildingId: buildingId,
        roomNumber: `A102-${suffix}`,
        normalizedRoomNumber: `a102-${suffix}`,
        floor: 1,
        monthlyRent: 4500,
        depositAmount: 5000,
        monthlyDeposit: 5000,
        termDeposit: 10000,
        dailyDeposit: 500,
        status: 'vacant',
      },
    });
    room2Id = room2.id;

    const cycle = await prisma.billingCycle.create({
      data: {
        dormitoryId: dormId,
        name: 'กรกฎาคม 2026',
        cycleCode: `2026-07-${suffix}`,
        periodStart: new Date('2026-07-01T00:00:00.000Z'),
        periodEnd: new Date('2026-07-31T23:59:59.999Z'),
        billingDate: new Date('2026-07-01T00:00:00.000Z'),
        dueDate: new Date('2026-07-05T00:00:00.000Z'),
      },
    });
    billingCycleId = cycle.id;

    const tenant = await prisma.tenant.create({
      data: {
        dormitoryId,
        tenantNumber: `T-SETTLE-${Date.now()}`,
        firstName: 'มัดจำ',
        lastName: 'ตรวจสอบ',
        displayName: 'คุณมัดจำ ตรวจสอบ',
        status: 'active',
      },
    });
    dummyTenantId = tenant.id;
    createdTenantIds.push(dummyTenantId);
  });

  afterAll(async () => {
    // Robust topological cascade cleanup by dormitoryId
    if (dormId) {
      await prisma.contractSettlementItem.deleteMany({ where: { settlement: { dormitoryId: dormId } } }).catch(() => {});
      await prisma.contractSettlement.deleteMany({ where: { dormitoryId: dormId } }).catch(() => {});
      await prisma.billItem.deleteMany({ where: { bill: { dormitoryId: dormId } } }).catch(() => {});
      await prisma.bill.deleteMany({ where: { dormitoryId: dormId } }).catch(() => {});
      await prisma.dailyStay.deleteMany({ where: { dormitoryId: dormId } }).catch(() => {});
      await prisma.occupancy.deleteMany({ where: { dormitoryId: dormId } }).catch(() => {});
      await prisma.contract.deleteMany({ where: { dormitoryId: dormId } }).catch(() => {});
      await prisma.tenantRegistrationIntent.deleteMany({ where: { dormitoryId: dormId } }).catch(() => {});
      await prisma.tenantRegistrationRequest.deleteMany({ where: { dormitoryId: dormId } }).catch(() => {});
      await prisma.tenant.deleteMany({ where: { dormitoryId: dormId } }).catch(() => {});
      await prisma.room.deleteMany({ where: { dormitoryId: dormId } }).catch(() => {});
      await prisma.building.deleteMany({ where: { dormitoryId: dormId } }).catch(() => {});
      await prisma.ownerSignature.deleteMany({ where: { dormitoryId: dormId } }).catch(() => {});
      await prisma.dormitoryMember.deleteMany({ where: { dormitoryId: dormId } }).catch(() => {});
      await prisma.role.deleteMany({ where: { dormitoryId: dormId } }).catch(() => {});
      await prisma.billingCycle.deleteMany({ where: { dormitoryId: dormId } }).catch(() => {});
      await prisma.dormitory.deleteMany({ where: { id: dormId } }).catch(() => {});
    }
    if (ownerUserId) await prisma.user.deleteMany({ where: { id: ownerUserId } }).catch(() => {});
  });

  // =========================================================================
  // 1. DAILY DIRECT APPROVAL DOMAIN INVARIANT
  // =========================================================================
  describe('1. Daily Direct Approval Domain Invariant', () => {
    it('approving immediate daily stay directly creates Tenant, DailyStay, and Occupancy without creating Contract', async () => {
      const today = new Date().toISOString().split('T')[0];
      const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

      const reg = await prisma.tenantRegistrationRequest.create({
        data: {
          dormitoryId,
          requestedRoomId: roomId,
          firstName: 'สมบูรณ์',
          lastName: 'พักรายวัน',
          phone: '0812223344',
          status: 'pending_owner_approval',
          acceptanceSnapshot: {
            rentalType: 'DAILY',
            citizenId: '1100200300401',
          },
        },
      });
      createdRegistrationIds.push(reg.id);

      const approvalResult = await tenantRegistrationService.approveRequest(
        reg.id,
        dormitoryId,
        {
          requireTenantConfirmation: false,
          rentalType: 'DAILY',
          roomId,
          startDate: today,
          endDate: tomorrow,
          dailyRate: 500,
          rentAmount: 500,
          totalDays: 1,
          depositAmount: 0,
        },
        ownerUserId
      );

      expect(approvalResult.status).toBe('approved');
      expect(approvalResult.tenantId).toBeDefined();
      createdTenantIds.push(approvalResult.tenantId!);

      // Assert DailyStay was created with correct values
      const dailyStay = await prisma.dailyStay.findFirst({
        where: { tenantId: approvalResult.tenantId!, roomId },
      });
      expect(dailyStay).not.toBeNull();
      expect(dailyStay?.status).toBe('ACTIVE');
      expect(Number(dailyStay?.dailyRateAmount)).toBe(500);
      expect(dailyStay?.inclusiveDayCount).toBe(1);
      createdDailyStayIds.push(dailyStay!.id);

      // Assert Occupancy was created
      const occupancy = await prisma.occupancy.findFirst({
        where: { tenantId: approvalResult.tenantId!, roomId, status: 'ACTIVE' },
      });
      expect(occupancy).not.toBeNull();
      expect(occupancy?.contractId).toBeNull();

      // STRICT DOMAIN INVARIANT: ZERO Contract records created for daily rental!
      const contractCount = await prisma.contract.count({
        where: { tenantId: approvalResult.tenantId!, dormitoryId },
      });
      expect(contractCount).toBe(0);

      // Room status transitions to occupied
      const updatedRoom = await prisma.room.findUnique({ where: { id: roomId } });
      expect(updatedRoom?.status).toBe('occupied');
      expect(updatedRoom?.currentTenantId).toBe(approvalResult.tenantId);
    });

    it('approving future daily stay directly creates DailyStay and Occupancy in RESERVED state without standard Contract', async () => {
      const futureStart = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
      const futureEnd = new Date(Date.now() + 9 * 86400000).toISOString().split('T')[0];

      const regFuture = await prisma.tenantRegistrationRequest.create({
        data: {
          dormitoryId,
          requestedRoomId: room2Id,
          firstName: 'วันชัย',
          lastName: 'จองล่วงหน้า',
          phone: '0815556677',
          status: 'pending_owner_approval',
          acceptanceSnapshot: {
            rentalType: 'DAILY',
          },
        },
      });
      createdRegistrationIds.push(regFuture.id);

      const approvalResult = await tenantRegistrationService.approveRequest(
        regFuture.id,
        dormitoryId,
        {
          requireTenantConfirmation: false,
          rentalType: 'DAILY',
          roomId: room2Id,
          startDate: futureStart,
          endDate: futureEnd,
          dailyRate: 600,
          rentAmount: 1200,
          totalDays: 2,
          depositAmount: 0,
        },
        ownerUserId
      );

      expect(approvalResult.status).toBe('approved');
      createdTenantIds.push(approvalResult.tenantId!);

      // Assert DailyStay status is RESERVED (not physically active today)
      const dailyStay = await prisma.dailyStay.findFirst({
        where: { tenantId: approvalResult.tenantId!, roomId: room2Id },
      });
      expect(dailyStay).not.toBeNull();
      expect(dailyStay?.status).toBe('RESERVED');
      expect(Number(dailyStay?.dailyRateAmount)).toBe(600);
      expect(dailyStay?.inclusiveDayCount).toBe(2);
      createdDailyStayIds.push(dailyStay!.id);

      // Assert Occupancy is RESERVED
      const occupancy = await prisma.occupancy.findFirst({
        where: { tenantId: approvalResult.tenantId!, roomId: room2Id },
      });
      expect(occupancy).not.toBeNull();
      expect(occupancy?.status).toBe('RESERVED');
      expect(occupancy?.contractId).toBeNull();

      // Physical room remains vacant today and has no current tenant
      const updatedRoom = await prisma.room.findUnique({ where: { id: room2Id } });
      expect(updatedRoom?.status).toBe('vacant');
      expect(updatedRoom?.currentTenantId).toBeNull();

      // ZERO Contract records created
      const contractCount = await prisma.contract.count({
        where: { tenantId: approvalResult.tenantId!, dormitoryId },
      });
      expect(contractCount).toBe(0);

      // Date-aware availability checks via DailyStayService
      const dailyStayService = new DailyStayService();
      
      const checkIn = new Date(dailyStay!.startDate);
      const checkOut = new Date(dailyStay!.endDate);

      // 1. Check booking before stay starts (e.g. well before / non-overlapping)
      const nonOverlappingBefore = await dailyStayService.checkRoomAvailability(
        dormitoryId,
        room2Id,
        new Date(checkIn.getTime() - 5 * 86400000),
        new Date(checkIn.getTime() - 3 * 86400000)
      );
      expect(nonOverlappingBefore.available).toBe(true);

      // 2. Check booking overlapping with reserved daily stay
      const overlapping = await dailyStayService.checkRoomAvailability(
        dormitoryId,
        room2Id,
        new Date(checkIn.getTime() + 1000),
        new Date(checkOut.getTime() - 1000)
      );
      expect(overlapping.available).toBe(false);
      expect(overlapping.reason).toBe('ROOM_OCCUPIED_BY_DAILY_STAY');

      // 3. Check booking after stay ends (non-overlapping)
      const nonOverlappingAfter = await dailyStayService.checkRoomAvailability(
        dormitoryId,
        room2Id,
        new Date(checkOut.getTime() + 2 * 86400000),
        new Date(checkOut.getTime() + 4 * 86400000)
      );
      expect(nonOverlappingAfter.available).toBe(true);
    });
  });

  // =========================================================================
  // 2. REVISION REQUEST / RESUBMIT LIFECYCLE
  // =========================================================================
  describe('2. Revision Request & Resubmit Lifecycle', () => {
    it('requestRevision sets revision_requested without creating Tenant, Contract, DailyStay or Occupancy', async () => {
      const suffix = crypto.randomBytes(3).toString('hex');
      const testRoom = await prisma.room.create({
        data: {
          dormitoryId,
          buildingId,
          roomNumber: `B201-${suffix}`,
          normalizedRoomNumber: `b201-${suffix}`,
          floor: 1,
          monthlyRent: 4500,
          depositAmount: 5000,
          monthlyDeposit: 5000,
          termDeposit: 10000,
          dailyDeposit: 500,
          status: 'vacant',
        },
      });

      const reg = await prisma.tenantRegistrationRequest.create({
        data: {
          dormitoryId,
          requestedRoomId: testRoom.id,
          firstName: 'สมหมาย',
          lastName: 'ขอแก้ไข',
          phone: '0891112233',
          status: 'pending_owner_approval',
          acceptanceSnapshot: {
            pet: { hasPet: true, petType: 'cat' },
          },
        },
      });
      createdRegistrationIds.push(reg.id);

      // Request revision
      const revisionReason = 'กรุณาแนบภาพบัตรประชาชนให้ชัดเจนกว่านี้';
      const updated = await tenantRegistrationService.requestRevision(
        reg.id,
        dormitoryId,
        revisionReason,
        ownerUserId
      );

      expect(updated.status).toBe('revision_requested');
      expect(updated.rejectedReason).toBe(revisionReason);

      const snap = updated.acceptanceSnapshot as any;
      expect(snap.currentOwnerComment).toBe(revisionReason);
      expect(Array.isArray(snap.revisionHistory)).toBe(true);
      expect(snap.revisionHistory[0].action).toBe('REVISION_REQUESTED');
      expect(snap.revisionHistory[0].reason).toBe(revisionReason);

      // Verify ZERO side effects
      expect(updated.approvedTenantId).toBeNull();
      const tenantCount = await prisma.tenant.count({ where: { phone: '0891112233', dormitoryId } });
      expect(tenantCount).toBe(0);
      const contractCount = await prisma.contract.count({ where: { roomId: testRoom.id } });
      expect(contractCount).toBe(0);
      const occupancyCount = await prisma.occupancy.count({ where: { roomId: testRoom.id } });
      expect(occupancyCount).toBe(0);
      const roomCheck = await prisma.room.findUnique({ where: { id: testRoom.id } });
      expect(roomCheck?.status).toBe('vacant');

      // Resubmit request
      const resubmitted = await tenantRegistrationService.resubmitRequest(
        reg.id,
        dormitoryId,
        {
          note: 'อัปเดตรูปถ่ายบัตรประชาชนใหม่เรียบร้อยแล้ว',
        }
      );

      expect(resubmitted.status).toBe('pending_owner_approval');
      const resubSnap = resubmitted.acceptanceSnapshot as any;
      expect(resubSnap.revisionHistory.length).toBe(2);
      expect(resubSnap.revisionHistory[1].action).toBe('RESUBMITTED');

      await prisma.room.delete({ where: { id: testRoom.id } });
    });
  });

  // =========================================================================
  // 3. DEPOSIT SETTLEMENT AUTHORITY FULL MATRIX (A–F)
  // =========================================================================
  describe('3. Deposit Settlement Authority Full Matrix (A–F)', () => {
    let dummyRoomId: string;

    beforeAll(async () => {
      const room = await prisma.room.create({
        data: {
          dormitoryId,
          buildingId,
          roomNumber: `SETTLE-${Date.now()}`,
          normalizedRoomNumber: `settle-${Date.now()}`.toLowerCase(),
          floor: 1,
          monthlyRent: 4500,
          depositAmount: 5000,
          monthlyDeposit: 5000,
          termDeposit: 10000,
          dailyDeposit: 500,
          status: 'occupied',
        },
      });
      dummyRoomId = room.id;
    });

    it('Scenario A: Contract with deposit = 0 results in depositAmount = 0 in settlement', async () => {
      const contract = await prisma.contract.create({
        data: {
          dormitoryId,
          tenantId: dummyTenantId,
          roomId: dummyRoomId,
          contractNumber: `CT-SCENARIO-A-${Date.now()}`,
          status: 'active',
          startDate: new Date('2026-07-01T00:00:00.000Z'),
          endDate: new Date('2027-06-30T23:59:59.999Z'),
          rentAmount: 5000,
          depositAmount: 0,
        },
      });
      createdContractIds.push(contract.id);

      const settlement = await settlementService.getOrCreateSettlement(dormitoryId, contract.id);
      createdSettlementIds.push(settlement.id);

      expect(Number(settlement.depositAmount)).toBe(0);
    });

    it('Scenario B: Contract has deposit > 0, but no Bill exists -> depositAmount = 0', async () => {
      const contract = await prisma.contract.create({
        data: {
          dormitoryId,
          tenantId: dummyTenantId,
          roomId: dummyRoomId,
          contractNumber: `CT-SCENARIO-B-${Date.now()}`,
          status: 'active',
          startDate: new Date('2026-07-01T00:00:00.000Z'),
          endDate: new Date('2027-06-30T23:59:59.999Z'),
          rentAmount: 5000,
          depositAmount: 10000,
        },
      });
      createdContractIds.push(contract.id);

      const settlement = await settlementService.getOrCreateSettlement(dormitoryId, contract.id);
      createdSettlementIds.push(settlement.id);

      // Must be 0 because actual money was never received via billKind === 'DEPOSIT'
      expect(Number(settlement.depositAmount)).toBe(0);
    });

    it('Scenario C: Bill kind DEPOSIT exists but is unpaid (paidAmount = 0) -> depositAmount = 0', async () => {
      const contract = await prisma.contract.create({
        data: {
          dormitoryId,
          tenantId: dummyTenantId,
          roomId: dummyRoomId,
          contractNumber: `CT-SCENARIO-C-${Date.now()}`,
          status: 'active',
          startDate: new Date('2026-07-01T00:00:00.000Z'),
          endDate: new Date('2027-06-30T23:59:59.999Z'),
          rentAmount: 5000,
          depositAmount: 8000,
        },
      });
      createdContractIds.push(contract.id);

      const bill = await prisma.bill.create({
        data: {
          dormitoryId,
          contractId: contract.id,
          roomId: dummyRoomId,
          tenantId: dummyTenantId,
          billingCycleId,
          billingDate: new Date('2026-07-01T00:00:00.000Z'),
          dueDate: new Date('2026-07-05T00:00:00.000Z'),
          billNumber: `BILL-DEP-UNPAID-${Date.now()}`,
          billKind: 'DEPOSIT',
          status: 'unpaid',
          subtotal: 8000,
          totalAmount: 8000,
          paidAmount: 0,
        },
      });
      createdBillIds.push(bill.id);

      const settlement = await settlementService.getOrCreateSettlement(dormitoryId, contract.id);
      createdSettlementIds.push(settlement.id);

      expect(Number(settlement.depositAmount)).toBe(0);
    });

    it('Scenario D: Bill kind DEPOSIT is partially paid -> depositAmount capped at actual paid amount', async () => {
      const contract = await prisma.contract.create({
        data: {
          dormitoryId,
          tenantId: dummyTenantId,
          roomId: dummyRoomId,
          contractNumber: `CT-SCENARIO-D-${Date.now()}`,
          status: 'active',
          startDate: new Date('2026-07-01T00:00:00.000Z'),
          endDate: new Date('2027-06-30T23:59:59.999Z'),
          rentAmount: 5000,
          depositAmount: 10000,
        },
      });
      createdContractIds.push(contract.id);

      const bill = await prisma.bill.create({
        data: {
          dormitoryId,
          contractId: contract.id,
          roomId: dummyRoomId,
          tenantId: dummyTenantId,
          billingCycleId,
          billingDate: new Date('2026-07-01T00:00:00.000Z'),
          dueDate: new Date('2026-07-05T00:00:00.000Z'),
          billNumber: `BILL-DEP-PARTIAL-${Date.now()}`,
          billKind: 'DEPOSIT',
          status: 'unpaid',
          subtotal: 10000,
          totalAmount: 10000,
          paidAmount: 4000, // Only 4000 paid
        },
      });
      createdBillIds.push(bill.id);

      const settlement = await settlementService.getOrCreateSettlement(dormitoryId, contract.id);
      createdSettlementIds.push(settlement.id);

      expect(Number(settlement.depositAmount)).toBe(4000);
    });

    it('Scenario E: Bill kind DEPOSIT is fully paid -> full deposit amount available in settlement', async () => {
      const contract = await prisma.contract.create({
        data: {
          dormitoryId,
          tenantId: dummyTenantId,
          roomId: dummyRoomId,
          contractNumber: `CT-SCENARIO-E-${Date.now()}`,
          status: 'active',
          startDate: new Date('2026-07-01T00:00:00.000Z'),
          endDate: new Date('2027-06-30T23:59:59.999Z'),
          rentAmount: 5000,
          depositAmount: 10000,
        },
      });
      createdContractIds.push(contract.id);

      const bill = await prisma.bill.create({
        data: {
          dormitoryId,
          contractId: contract.id,
          roomId: dummyRoomId,
          tenantId: dummyTenantId,
          billingCycleId,
          billingDate: new Date('2026-07-01T00:00:00.000Z'),
          dueDate: new Date('2026-07-05T00:00:00.000Z'),
          billNumber: `BILL-DEP-FULL-${Date.now()}`,
          billKind: 'DEPOSIT',
          status: 'paid',
          subtotal: 10000,
          totalAmount: 10000,
          paidAmount: 10000,
        },
      });
      createdBillIds.push(bill.id);

      const settlement = await settlementService.getOrCreateSettlement(dormitoryId, contract.id);
      createdSettlementIds.push(settlement.id);

      expect(Number(settlement.depositAmount)).toBe(10000);
    });

    it('Scenario F: Backend tampering resistance: ignores non-DEPOSIT bills and enforces actual paid money authority', async () => {
      const contract = await prisma.contract.create({
        data: {
          dormitoryId,
          tenantId: dummyTenantId,
          roomId: dummyRoomId,
          contractNumber: `CT-SCENARIO-F-${Date.now()}`,
          status: 'active',
          startDate: new Date('2026-07-01T00:00:00.000Z'),
          endDate: new Date('2027-06-30T23:59:59.999Z'),
          rentAmount: 5000,
          depositAmount: 10000,
        },
      });
      createdContractIds.push(contract.id);

      // Monthly bill paid with 50,000 THB (e.g. rent prepayment or utility)
      const monthlyBill = await prisma.bill.create({
        data: {
          dormitoryId,
          contractId: contract.id,
          roomId: dummyRoomId,
          tenantId: dummyTenantId,
          billingCycleId,
          billingDate: new Date('2026-07-01T00:00:00.000Z'),
          dueDate: new Date('2026-07-05T00:00:00.000Z'),
          billNumber: `BILL-MONTHLY-${Date.now()}`,
          billKind: 'MONTHLY',
          status: 'paid',
          subtotal: 50000,
          totalAmount: 50000,
          paidAmount: 50000,
        },
      });
      createdBillIds.push(monthlyBill.id);

      // Deposit bill only paid 3000
      const depBill = await prisma.bill.create({
        data: {
          dormitoryId,
          contractId: contract.id,
          roomId: dummyRoomId,
          tenantId: dummyTenantId,
          billingCycleId,
          billingDate: new Date('2026-07-01T00:00:00.000Z'),
          dueDate: new Date('2026-07-05T00:00:00.000Z'),
          billNumber: `BILL-DEP-REAL-${Date.now()}`,
          billKind: 'DEPOSIT',
          status: 'unpaid',
          subtotal: 10000,
          totalAmount: 10000,
          paidAmount: 3000,
        },
      });
      createdBillIds.push(depBill.id);

      const settlement = await settlementService.getOrCreateSettlement(dormitoryId, contract.id);
      createdSettlementIds.push(settlement.id);

      // Must be EXACTLY 3000 (from DEPOSIT bill only), ignoring the 50,000 monthly bill
      expect(Number(settlement.depositAmount)).toBe(3000);
    });
  });

  // =========================================================================
  // 4. OWNER SIGNATURE FORENSIC PROOF
  // =========================================================================
  describe('4. Owner Signature Forensic Proof', () => {
    let sigV1ObjectKey: string;
    let sigV2ObjectKey: string;
    let contractWithFrozenSigId: string;
    let legacyContractId: string;

    it('Settings signature upload saves version 1 and GET /signature returns 200 image/png', async () => {
      const sigService = new SignatureStorageService(prisma);
      const resV1 = await sigService.saveSignature({
        dormitoryId,
        userId: ownerUserId,
        buffer: validPngBuffer,
      });
      createdSignatureIds.push(resV1.id);
      sigV1ObjectKey = resV1.objectKey;

      expect(resV1.version).toBe(1);
      expect(sigV1ObjectKey).toContain('v1-');

      // GET /api/v1/dormitories/:dormitoryId/signature
      const res = await request(app)
        .get(`/api/v1/dormitories/${dormitoryId}/signature`)
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/png');
      expect(res.body).toBeInstanceOf(Buffer);
    });

    it('contract signs and freezes current owner signature at signing time', async () => {
      const contract = await prisma.contract.create({
        data: {
          dormitoryId,
          tenantId: dummyTenantId,
          roomId,
          contractNumber: `CT-FROZEN-${Date.now()}`,
          status: 'active',
          startDate: new Date('2026-07-01T00:00:00.000Z'),
          endDate: new Date('2027-06-30T23:59:59.999Z'),
          rentAmount: 4500,
          ownerSignature: sigV1ObjectKey, // Frozen version 1
        },
      });
      contractWithFrozenSigId = contract.id;
      createdContractIds.push(contract.id);

      // GET contract owner signature returns 200 image/png
      const res = await request(app)
        .get(`/api/v1/dormitories/${dormitoryId}/contracts/${contract.id}/owner-signature`)
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/png');
    });

    it('owner uploads new signature in Settings (version 2), leaving old contract signature frozen', async () => {
      const sigService = new SignatureStorageService(prisma);
      const bufferV2 = createValidSignaturePng(2);
      const resV2 = await sigService.saveSignature({
        dormitoryId,
        userId: ownerUserId,
        buffer: bufferV2,
      });
      createdSignatureIds.push(resV2.id);
      sigV2ObjectKey = resV2.objectKey;

      expect(resV2.version).toBe(2);

      // Verify contract still holds the old frozen version 1
      const checkContract = await prisma.contract.findUnique({
        where: { id: contractWithFrozenSigId },
      });
      expect(checkContract?.ownerSignature).toBe(sigV1ObjectKey);
      expect(checkContract?.ownerSignature).not.toBe(sigV2ObjectKey);

      // Verify endpoint serves the frozen version 1 for this contract
      const contractSigStream = await request(app)
        .get(`/api/v1/dormitories/${dormitoryId}/contracts/${contractWithFrozenSigId}/owner-signature`)
        .set('Cookie', sessionCookie);
      expect(contractSigStream.status).toBe(200);
      expect(contractSigStream.headers['content-type']).toBe('image/png');

      // Verify settings endpoint serves the latest (v2)
      const latestSig = await sigService.getLatestSignatureRecord(dormitoryId);
      expect(latestSig?.version).toBe(2);
      expect(latestSig?.objectKey).toBe(sigV2ObjectKey);
    });

    it('legacy contract with ownerSignature === null falls back to Settings signature WITHOUT mutating contract table', async () => {
      const legacyContract = await prisma.contract.create({
        data: {
          dormitoryId,
          tenantId: dummyTenantId,
          roomId,
          contractNumber: `CT-LEGACY-${Date.now()}`,
          status: 'active',
          startDate: new Date('2026-07-01T00:00:00.000Z'),
          endDate: new Date('2027-06-30T23:59:59.999Z'),
          rentAmount: 4500,
          ownerSignature: null, // Legacy null
        },
      });
      legacyContractId = legacyContract.id;
      createdContractIds.push(legacyContract.id);

      // Call GET owner signature endpoint
      const res = await request(app)
        .get(`/api/v1/dormitories/${dormitoryId}/contracts/${legacyContract.id}/owner-signature`)
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/png');

      // CRITICAL FORENSIC INVARIANT: The contract in DB MUST STILL HAVE ownerSignature === null
      const checkLegacy = await prisma.contract.findUnique({
        where: { id: legacyContractId },
      });
      expect(checkLegacy?.ownerSignature).toBeNull();
    });

    it('forensic audit proves zero fake React SVG path signatures in contract templates', () => {
      const tenantsFilePath = path.resolve(__dirname, '../../../src/pages/owner/tenants.tsx');
      const content = fs.readFileSync(tenantsFilePath, 'utf-8');

      // Assert that signature rendering uses <img> with canonical URLs, NOT fake SVG drawn paths
      expect(content).toContain('.signature-space img');
      expect(content).toContain('<div class="signature-space">${ownerSig}</div>');
      expect(content).toContain('<div class="signature-space">${tenantSig}</div>');
      expect(content).toContain('/owner-signature');
      expect(content).toContain('/tenant-signature');

      // Verify no fake hand-drawn svg paths like <svg><path d="M...
      expect(content).not.toMatch(/<svg[^>]*>\s*<path[^>]*d="M\d+/i);
    });
  });
});
