/**
 * @license Apache-2.0
 * LOCAL-07 POST-BATCH02 PRODUCT OWNER MANUAL UAT CORRECTION TESTS
 *
 * Verifies:
 * 1. Fresh Owner authoritative Room UUID resolution & /properties/rooms/:id/quick-add-context
 * 2. RoomBillingCycleSnapshot Optimistic Concurrency Control (OCC 409 STALE_VERSION)
 * 3. Meter Billing Preview Context endpoint (/meters/workspace/preview-context)
 * 4. Household Counts endpoint (/meters/workspace/household-counts)
 * 5. Complete parity with BillingService across all fee modes
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { getPrismaClient } from '../../db/prisma.js';
import { createApp } from '../../app.js';
import { AuthenticationService } from '../../services/auth.service.js';
import { getEnv, resetCachedEnv } from '../../config/env.js';
import { PrismaUserRepository } from '../../db/repositories/user.repository.js';
import { PrismaSessionRepository } from '../../db/repositories/session.repository.js';
import { PrismaMembershipRepository } from '../../db/repositories/membership.repository.js';
import { PrismaRoleRepository } from '../../db/repositories/role.repository.js';
import { calculateMeterRowPreview } from '../../utils/meter-billing-calculator.util.js';

describe('LOCAL-07 Post-Batch02 UAT Corrections: OCC, Preview Context & Household Counts', () => {
  const prisma = getPrismaClient();
  let app: any;
  let authService: any;
  let ownerSessionCookie: string;
  let ownerCsrfToken: string;

  let ownerUserId: string;
  let dormitoryId: string;
  let buildingId: string;
  let roomId: string;
  let room2Id: string;
  let tenantId: string;
  let billingCycleId: string;

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

    // 1. Create Owner User
    const ownerEmail = `uat-owner-${Date.now()}@example.com`;
    const ownerUser = await prisma.user.create({
      data: {
        googleSubject: `sub-owner-${Date.now()}`,
        email: ownerEmail,
        emailNormalized: ownerEmail.toLowerCase(),
        name: 'เจ้าของหอพัก UAT',
      },
    });
    ownerUserId = ownerUser.id;

    // 2. Create Dormitory & Building
    const dorm = await prisma.dormitory.create({
      data: {
        name: 'หอพัก UAT Test',
        addressLine1: '123/45 ถนนสุขุมวิท',
        status: 'active',
        createdByUserId: ownerUserId,
      },
    });
    dormitoryId = dorm.id;

    // Create Role OWNER
    const ownerRole = await prisma.role.create({
      data: {
        dormitoryId,
        code: 'OWNER',
        name: 'เจ้าของหอพัก',
        permissions: ['rooms:read', 'rooms:write', 'bills:read', 'bills:write', 'meter:read', 'meter:write', 'billing:read', 'billing:write'],
        isSystem: true,
      },
    });

    // Link Owner to Dormitory
    await prisma.dormitoryMember.create({
      data: {
        userId: ownerUserId,
        dormitoryId,
        roleId: ownerRole.id,
        status: 'active',
        membershipOrigin: 'MANUAL_GRANT',
      },
    });

    // Create Dormitory Billing Settings (Required for authoritative dueDay)
    await prisma.dormitoryBillingSettings.create({
      data: {
        dormitoryId,
        dueDay: 5,
      },
    });

    const ownerAuth = await authService.authenticateTestUser(ownerUserId);
    ownerSessionCookie = `horplus_session=${ownerAuth.sessionToken}; horplus_csrf=${ownerAuth.csrfToken}`;
    ownerCsrfToken = ownerAuth.csrfToken;

    const building = await prisma.building.create({
      data: {
        dormitoryId,
        name: 'อาคาร A',
        code: 'A',
        floorCount: 4,
        roomsPerFloor: 2,
      },
    });
    buildingId = building.id;

    // 3. Create Rooms
    const r1 = await prisma.room.create({
      data: {
        dormitoryId,
        buildingId,
        roomNumber: 'A101',
        normalizedRoomNumber: 'a101',
        floor: 1,
        roomType: 'standard',
        monthlyRent: '3500.00',
        waterMeterNumber: 'W-A101',
        electricityMeterNumber: 'E-A101',
        initialWaterReading: '100.00',
        initialElectricityReading: '500.00',
      },
    });
    roomId = r1.id;

    const r2 = await prisma.room.create({
      data: {
        dormitoryId,
        buildingId,
        roomNumber: 'A102',
        normalizedRoomNumber: 'a102',
        floor: 1,
        roomType: 'standard',
        monthlyRent: '4000.00',
        waterMeterNumber: 'W-A102',
        electricityMeterNumber: 'E-A102',
        initialWaterReading: '200.00',
        initialElectricityReading: '1000.00',
      },
    });
    room2Id = r2.id;

    // 4. Create Active Tenant & Contract in Room 1
    const tenant = await prisma.tenant.create({
      data: {
        dormitoryId,
        tenantNumber: 'TN-2026-001',
        displayName: 'นายสมชาย ใจดี',
        firstName: 'สมชาย',
        lastName: 'ใจดี',
        phone: '0812345678',
        status: 'active',
      },
    });
    tenantId = tenant.id;

    // Add co-occupant to Room 1
    await prisma.tenantCoOccupant.create({
      data: {
        dormitoryId,
        tenantId,
        name: 'นางสมหญิง ใจดี',
        relationship: 'ภรรยา',
        status: 'active',
      },
    });

    // 5. Create Billing Cycle & Rate Snapshot
    const cycle = await prisma.billingCycle.create({
      data: {
        dormitoryId,
        name: 'สิงหาคม 2569',
        cycleCode: '2026-08',
        billingDate: new Date('2026-08-01T00:00:00Z'),
        dueDate: new Date('2026-08-05T00:00:00Z'),
        periodStart: new Date('2026-08-01T00:00:00Z'),
        periodEnd: new Date('2026-08-31T23:59:59Z'),
        status: 'OPEN',
      },
    });
    billingCycleId = cycle.id;

    await prisma.billingRateSnapshot.create({
      data: {
        dormitoryId,
        billingCycleId,
        waterBillingType: 'per_unit',
        waterRate: '18.00',
        electricityBillingType: 'per_unit',
        electricityRate: '8.00',
        commonFeeMode: 'per_room',
        commonFee: '150.00',
        internetFeeMode: 'per_room',
        internetFee: '200.00',
        parkingFeeMode: 'per_room',
        parkingFee: '100.00',
        lateFeeType: 'per_day',
        lateFeeValue: '0.00',
        source: 'MANUAL_OVERRIDE',
        updatedByUserId: ownerUserId,
      },
    });

    // Contract for Room 1
    await prisma.contract.create({
      data: {
        dormitoryId,
        roomId,
        tenantId,
        contractNumber: 'CT-2026-001',
        startDate: new Date('2026-01-01T00:00:00Z'),
        endDate: new Date('2026-12-31T23:59:59Z'),
        rentAmount: '3500.00',
        depositAmount: '7000.00',
        status: 'active',
      },
    });
  });

  afterAll(async () => {
    // Cleanup test data in proper dependency order
    try {
      await prisma.billItem.deleteMany({ where: { dormitoryId } });
      await prisma.bill.deleteMany({ where: { dormitoryId } });
      await prisma.roomBillingCycleSnapshot.deleteMany({ where: { dormitoryId } });
      await prisma.contract.deleteMany({ where: { dormitoryId } });
      await prisma.tenantCoOccupant.deleteMany({ where: { dormitoryId } });
      await prisma.tenant.deleteMany({ where: { dormitoryId } });
      await prisma.billingRateSnapshot.deleteMany({ where: { dormitoryId } });
      await prisma.billingCycle.deleteMany({ where: { dormitoryId } });
      await prisma.dormitoryBillingSettings.deleteMany({ where: { dormitoryId } });
      await prisma.room.deleteMany({ where: { dormitoryId } });
      await prisma.building.deleteMany({ where: { dormitoryId } });
      await prisma.dormitoryMember.deleteMany({ where: { dormitoryId } });
      await prisma.role.deleteMany({ where: { dormitoryId } });
      await prisma.dormitory.deleteMany({ where: { id: dormitoryId } });
      await prisma.session.deleteMany({ where: { userId: ownerUserId } });
      await prisma.user.deleteMany({ where: { id: ownerUserId } });
    } catch {}
  });

  describe('1. Authoritative Room UUID & Quick Add Context', () => {
    it('returns authoritative room DTO containing valid UUID from /properties/rooms', async () => {
      const res = await request(app)
        .get('/api/v1/properties/rooms')
        .set('Cookie', ownerSessionCookie)
        .set('x-csrf-token', ownerCsrfToken)
        .set('x-dormitory-id', dormitoryId);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
      expect(Array.isArray(res.body.data)).toBe(true);

      const foundR1 = res.body.data.find((r: any) => r.roomNumber === 'A101');
      expect(foundR1).toBeDefined();
      expect(foundR1.id).toBe(roomId);
      // Invariant: UUID regex matches
      expect(foundR1.id).toMatch(/^[0-9a-fA-F-]{36}$/);

      // Now query quick-add-context using this exact room.id
      const ctxRes = await request(app)
        .get(`/api/v1/properties/rooms/${foundR1.id}/quick-add-context`)
        .set('Cookie', ownerSessionCookie)
        .set('x-csrf-token', ownerCsrfToken)
        .set('x-dormitory-id', dormitoryId);

      expect(ctxRes.status).toBe(200);
      expect(ctxRes.body.data).toBeDefined();
      expect(ctxRes.body.data.roomId).toBe(roomId);
      expect(ctxRes.body.data.roomNumber).toBe('A101');
      expect(Number(ctxRes.body.data.effective.monthlyRent)).toBe(3500);
    });

    it('rejects malformed non-UUID room identifier with 400 INVALID_ID_FORMAT', async () => {
      const res = await request(app)
        .get('/api/v1/properties/rooms/A101/quick-add-context')
        .set('Cookie', ownerSessionCookie)
        .set('x-csrf-token', ownerCsrfToken)
        .set('x-dormitory-id', dormitoryId);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_ID_FORMAT');
    });
  });

  describe('2. RoomBillingCycleSnapshot Optimistic Concurrency Control (OCC)', () => {
    it('creates initial snapshot with version 1 when expectedVersion is 0', async () => {
      const res = await request(app)
        .post('/api/v1/meters/workspace/bulk')
        .set('Cookie', ownerSessionCookie)
        .set('x-csrf-token', ownerCsrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({
          billingCycleId,
          rows: [
            {
              roomId,
              otherFees: [{ description: 'ค่ากุญแจสำรอง', amount: '100.00' }],
              expectedVersion: 0,
            },
          ],
        });

      expect(res.status).toBe(200);

      const snap = await prisma.roomBillingCycleSnapshot.findUnique({
        where: {
          dormitory_billing_cycle_room_unique: {
            dormitoryId,
            billingCycleId,
            roomId,
          },
        },
      });

      expect(snap).toBeDefined();
      expect(snap?.version).toBe(1);
      expect(snap?.otherFees).toEqual([{ description: 'ค่ากุญแจสำรอง', amount: '100.00' }]);
    });

    it('rejects stale version update with HTTP 409 STALE_VERSION', async () => {
      // Current version is 1. Client sends expectedVersion: 0
      const res = await request(app)
        .post('/api/v1/meters/workspace/bulk')
        .set('Cookie', ownerSessionCookie)
        .set('x-csrf-token', ownerCsrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({
          billingCycleId,
          rows: [
            {
              roomId,
              otherFees: [{ description: 'ค่าคีย์การ์ด', amount: '200.00' }],
              expectedVersion: 0,
            },
          ],
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('STALE_VERSION');

      // Verify no overwrite happened
      const snap = await prisma.roomBillingCycleSnapshot.findUnique({
        where: {
          dormitory_billing_cycle_room_unique: {
            dormitoryId,
            billingCycleId,
            roomId,
          },
        },
      });

      expect(snap?.version).toBe(1);
      expect(snap?.otherFees).toEqual([{ description: 'ค่ากุญแจสำรอง', amount: '100.00' }]);
    });

    it('succeeds when expectedVersion matches current version (1) and increments version to 2', async () => {
      const res = await request(app)
        .post('/api/v1/meters/workspace/bulk')
        .set('Cookie', ownerSessionCookie)
        .set('x-csrf-token', ownerCsrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({
          billingCycleId,
          rows: [
            {
              roomId,
              otherFees: [
                { description: 'ค่ากุญแจสำรอง', amount: '100.00' },
                { description: 'ค่าคีย์การ์ด', amount: '200.00' },
              ],
              expectedVersion: 1,
            },
          ],
        });

      expect(res.status).toBe(200);

      const snap = await prisma.roomBillingCycleSnapshot.findUnique({
        where: {
          dormitory_billing_cycle_room_unique: {
            dormitoryId,
            billingCycleId,
            roomId,
          },
        },
      });

      expect(snap?.version).toBe(2);
      expect((snap?.otherFees as any[]).length).toBe(2);
    });

    it('handles true OCC race condition with Promise.all (exactly one 200, one 409 STALE_VERSION)', async () => {
      // Current version of roomId is 2
      const [resA, resB] = await Promise.all([
        request(app)
          .post('/api/v1/meters/workspace/bulk')
          .set('Cookie', ownerSessionCookie)
          .set('x-csrf-token', ownerCsrfToken)
          .set('x-dormitory-id', dormitoryId)
          .send({
            billingCycleId,
            rows: [
              {
                roomId,
                otherFees: [{ description: 'ค่าที่จอดรถเพิ่ม A', amount: '300.00' }],
                expectedVersion: 2,
              },
            ],
          }),
        request(app)
          .post('/api/v1/meters/workspace/bulk')
          .set('Cookie', ownerSessionCookie)
          .set('x-csrf-token', ownerCsrfToken)
          .set('x-dormitory-id', dormitoryId)
          .send({
            billingCycleId,
            rows: [
              {
                roomId,
                otherFees: [{ description: 'ค่าที่จอดรถเพิ่ม B', amount: '400.00' }],
                expectedVersion: 2,
              },
            ],
          }),
      ]);

      const statuses = [resA.status, resB.status].sort();
      expect(statuses).toEqual([200, 409]);

      const failedRes = resA.status === 409 ? resA : resB;
      expect(failedRes.body.error.code).toBe('STALE_VERSION');

      const successRes = resA.status === 200 ? resA : resB;
      expect(successRes.body.savedRows[0].version).toBe(3);

      const snap = await prisma.roomBillingCycleSnapshot.findUnique({
        where: {
          dormitory_billing_cycle_room_unique: {
            dormitoryId,
            billingCycleId,
            roomId,
          },
        },
      });
      expect(snap?.version).toBe(3);
    });

    it('handles concurrent first-snapshot creation (expectedVersion: 0) with Promise.all (exactly one 200, one 409)', async () => {
      const [resA, resB] = await Promise.all([
        request(app)
          .post('/api/v1/meters/workspace/bulk')
          .set('Cookie', ownerSessionCookie)
          .set('x-csrf-token', ownerCsrfToken)
          .set('x-dormitory-id', dormitoryId)
          .send({
            billingCycleId,
            rows: [
              {
                roomId: room2Id,
                otherFees: [{ description: 'ค่ามัดจำกุญแจ A', amount: '150.00' }],
                expectedVersion: 0,
              },
            ],
          }),
        request(app)
          .post('/api/v1/meters/workspace/bulk')
          .set('Cookie', ownerSessionCookie)
          .set('x-csrf-token', ownerCsrfToken)
          .set('x-dormitory-id', dormitoryId)
          .send({
            billingCycleId,
            rows: [
              {
                roomId: room2Id,
                otherFees: [{ description: 'ค่ามัดจำกุญแจ B', amount: '250.00' }],
                expectedVersion: 0,
              },
            ],
          }),
      ]);

      const statuses = [resA.status, resB.status].sort();
      expect(statuses).toEqual([200, 409]);

      const failedRes = resA.status === 409 ? resA : resB;
      expect(failedRes.body.error.code).toBe('STALE_VERSION');

      const snap = await prisma.roomBillingCycleSnapshot.findUnique({
        where: {
          dormitory_billing_cycle_room_unique: {
            dormitoryId,
            billingCycleId,
            roomId: room2Id,
          },
        },
      });
      expect(snap?.version).toBe(1);
    });

    it('handles sequential Other Fee +/+ /× advancing versions 1 -> 2 -> 3 without artificial collisions', async () => {
      // Room 2 currently at version 1.
      // Step 1: Add fee 1 using version 1 -> advances to 2
      const res1 = await request(app)
        .post('/api/v1/meters/workspace/bulk')
        .set('Cookie', ownerSessionCookie)
        .set('x-csrf-token', ownerCsrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({
          billingCycleId,
          rows: [
            {
              roomId: room2Id,
              otherFees: [
                { description: 'ค่ามัดจำกุญแจ', amount: '150.00' },
                { description: 'ค่าสติ๊กเกอร์จอดรถ', amount: '50.00' },
              ],
              expectedVersion: 1,
            },
          ],
        });

      expect(res1.status).toBe(200);
      const v2 = res1.body.savedRows[0].version;
      expect(v2).toBe(2);

      // Step 2: Add fee 2 using returned version 2 -> advances to 3
      const res2 = await request(app)
        .post('/api/v1/meters/workspace/bulk')
        .set('Cookie', ownerSessionCookie)
        .set('x-csrf-token', ownerCsrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({
          billingCycleId,
          rows: [
            {
              roomId: room2Id,
              otherFees: [
                { description: 'ค่ามัดจำกุญแจ', amount: '150.00' },
                { description: 'ค่าสติ๊กเกอร์จอดรถ', amount: '50.00' },
                { description: 'ค่าทำความสะอาด', amount: '300.00' },
              ],
              expectedVersion: v2,
            },
          ],
        });

      expect(res2.status).toBe(200);
      const v3 = res2.body.savedRows[0].version;
      expect(v3).toBe(3);

      // Step 3: Remove fee using returned version 3 -> advances to 4
      const res3 = await request(app)
        .post('/api/v1/meters/workspace/bulk')
        .set('Cookie', ownerSessionCookie)
        .set('x-csrf-token', ownerCsrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({
          billingCycleId,
          rows: [
            {
              roomId: room2Id,
              otherFees: [
                { description: 'ค่ามัดจำกุญแจ', amount: '150.00' },
                { description: 'ค่าสติ๊กเกอร์จอดรถ', amount: '50.00' },
              ],
              expectedVersion: v3,
            },
          ],
        });

      expect(res3.status).toBe(200);
      expect(res3.body.savedRows[0].version).toBe(4);
    });
  });

  describe('3. Meter Billing Preview Context Endpoint & Calculation Parity', () => {
    it('returns complete bounded preview context in one single response', async () => {
      const res = await request(app)
        .get(`/api/v1/meters/workspace/preview-context?billingCycleId=${billingCycleId}`)
        .set('Cookie', ownerSessionCookie)
        .set('x-csrf-token', ownerCsrfToken)
        .set('x-dormitory-id', dormitoryId);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.billingCycleId).toBe(billingCycleId);
      expect(res.body.data.cycleCode).toBe('2026-08');
      expect(res.body.data.rateSnapshot).toBeDefined();
      expect(res.body.data.rooms).toHaveLength(2);

      const r1Ctx = res.body.data.rooms.find((r: any) => r.roomId === roomId);
      expect(r1Ctx).toBeDefined();
      expect(r1Ctx.roomNumber).toBe('A101');
      expect(r1Ctx.tenantId).toBe(tenantId);
      expect(r1Ctx.billingSource).toBe('CONTRACT');
      expect(r1Ctx.rentAmount).toBe('3500.00');
      expect(r1Ctx.snapshotVersion).toBe(3);
      expect(r1Ctx.currentHouseholdPeopleCount).toBe(2); // 1 main tenant + 1 co-occupant
    });

    it('GET /meters/workspace/household-counts returns household counts without per-room fanout', async () => {
      const res = await request(app)
        .get(`/api/v1/meters/workspace/household-counts?billingCycleId=${billingCycleId}`)
        .set('Cookie', ownerSessionCookie)
        .set('x-csrf-token', ownerCsrfToken)
        .set('x-dormitory-id', dormitoryId);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);

      const r1Household = res.body.data.find((h: any) => h.roomId === roomId);
      const r2Household = res.body.data.find((h: any) => h.roomId === room2Id);

      expect(r1Household.currentHouseholdPeopleCount).toBe(2); // Active + 1 co-occupant
      expect(r2Household.currentHouseholdPeopleCount).toBe(0); // Vacant room
    });

    it('verifies exact calculation parity with integer meter readings between calculateMeterRowPreview, BillingService, and persisted Bill', async () => {
      const ctxRes = await request(app)
        .get(`/api/v1/meters/workspace/preview-context?billingCycleId=${billingCycleId}`)
        .set('Cookie', ownerSessionCookie)
        .set('x-csrf-token', ownerCsrfToken)
        .set('x-dormitory-id', dormitoryId);

      expect(ctxRes.status).toBe(200);
      const { rateSnapshot, rooms: previewRooms } = ctxRes.body.data;
      const r1Ctx = previewRooms.find((r: any) => r.roomId === roomId);

      const preview = calculateMeterRowPreview(r1Ctx, rateSnapshot, {
        waterPrev: '100',
        waterCurr: '105',
        elecPrev: '500',
        elecCurr: '502',
        peopleCount: 2,
        overdueAmount: '50.00',
        otherFees: [{ description: 'ค่าขยะ', amount: '40.00' }],
      });

      expect(preview.rentAmount).toBe('3500.00');
      expect(preview.waterUsage).toBe('5.00');
      expect(preview.waterAmount).toBe('90.00');
      expect(preview.elecUsage).toBe('2.00');
      expect(preview.elecAmount).toBe('16.00');
      expect(preview.commonAmount).toBe('150.00');
      expect(preview.internetAmount).toBe('200.00');
      expect(preview.parkingAmount).toBe('100.00');
      expect(preview.overdueAmount).toBe('50.00');
      expect(preview.otherFeesAmount).toBe('40.00');
      // Total: 3500.00 + 90.00 + 16.00 + 150.00 + 200.00 + 100.00 + 50.00 + 40.00 = 4146.00
      expect(preview.totalAmount).toBe('4146.00');
      expect(preview.formattedTotal).toBe('4,146.00');

      // Issue bill via API with these exact integer readings
      const issueRes = await request(app)
        .post('/api/v1/bills/generate/bulk')
        .set('Cookie', ownerSessionCookie)
        .set('x-csrf-token', ownerCsrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({
          billingCycleId,
          dirtyRows: [
            {
              roomId,
              waterPrev: '100',
              waterCurr: '105',
              elecPrev: '500',
              elecCurr: '502',
              peopleCount: 2,
              manualOutstandingAmount: '50.00',
              otherFees: [{ description: 'ค่าขยะ', amount: '40.00' }],
            },
          ],
        });

      expect(issueRes.status).toBe(200);

      // Verify persisted Bill in DB matches exact totals down to the unit
      const dbBill = await prisma.bill.findFirst({
        where: {
          dormitoryId,
          billingCycleId,
          roomId,
        },
        include: {
          items: true,
        },
      });

      expect(dbBill).toBeDefined();
      expect(Number(dbBill?.totalAmount)).toBe(4146);
      expect(Number(dbBill?.items.find((i: any) => i.type === 'rent')?.amount)).toBe(3500);
      expect(Number(dbBill?.items.find((i: any) => i.type === 'water')?.amount)).toBe(90);
      expect(Number(dbBill?.items.find((i: any) => i.type === 'electricity')?.amount)).toBe(16);
      expect(Number(dbBill?.items.find((i: any) => i.type === 'common_fee')?.amount)).toBe(150);
      expect(Number(dbBill?.items.find((i: any) => i.type === 'internet')?.amount)).toBe(200);
      expect(Number(dbBill?.items.find((i: any) => i.type === 'parking')?.amount)).toBe(100);
      expect(Number(dbBill?.items.find((i: any) => i.type === 'manual_outstanding')?.amount)).toBe(50);
      expect(Number(dbBill?.items.find((i: any) => i.type === 'other_fee')?.amount)).toBe(40);
    });

    it('table-driven cross-mode parity vector suite verifies all billing modes without floating drift', () => {
      // 1. Contract Monthly + PER_PERSON utilities
      const v1 = calculateMeterRowPreview(
        { roomId: 'r1', billingSource: 'CONTRACT', rentAmount: '4000.00' },
        {
          waterBillingType: 'per_person',
          waterRate: '100.00',
          electricityBillingType: 'per_person',
          electricityRate: '200.00',
          commonFeeMode: 'per_person',
          commonFee: '50.00',
          internetFeeMode: 'per_person',
          internetFee: '100.00',
          parkingFeeMode: 'per_person',
          parkingFee: '150.00',
        },
        { peopleCount: 3 }
      );
      // 4000 + (3*100) + (3*200) + (3*50) + (3*100) + (3*150) = 4000 + 300 + 600 + 150 + 300 + 450 = 5800.00
      expect(v1.totalAmount).toBe('5800.00');

      // 2. Provisional Monthly + FIXED / PER_ROOM modes
      const v2 = calculateMeterRowPreview(
        { roomId: 'r2', billingSource: 'PROVISIONAL_MONTHLY', rentAmount: '3200.00' },
        {
          waterBillingType: 'fixed',
          waterRate: '150.00',
          electricityBillingType: 'fixed',
          electricityRate: '350.00',
          commonFeeMode: 'per_room',
          commonFee: '100.00',
          internetFeeMode: 'per_room',
          internetFee: '150.00',
          parkingFeeMode: 'per_room',
          parkingFee: '200.00',
        },
        { peopleCount: 1 }
      );
      // 3200 + 150 + 350 + 100 + 150 + 200 = 4150.00
      expect(v2.totalAmount).toBe('4150.00');

      // 3. Provisional TERM Installment + PER_VEHICLE parking + multiple other fees + overdue
      const v3 = calculateMeterRowPreview(
        { roomId: 'r3', billingSource: 'PROVISIONAL_TERM', rentAmount: '12000.00', parkingQuantity: '2' },
        {
          waterBillingType: 'per_unit',
          waterRate: '20.00',
          electricityBillingType: 'per_unit',
          electricityRate: '7.50',
          parkingFeeMode: 'per_vehicle',
          parkingFee: '100.00',
        },
        {
          waterPrev: '200.50',
          waterCurr: '210.75', // usage 10.25 * 20.00 = 205.00
          elecPrev: '1000.20',
          elecCurr: '1050.60', // usage 50.40 * 7.50 = 378.00
          overdueAmount: '150.25',
          otherFees: [
            { description: 'คีย์การ์ด', amount: '100.50' },
            { description: 'ทำความสะอาด', amount: '200.00' },
          ],
        }
      );
      // 12000 + 205.00 + 378.00 + (2*100) + 150.25 + 100.50 + 200.00 = 13233.75
      expect(v3.waterUsage).toBe('10.25');
      expect(v3.waterAmount).toBe('205.00');
      expect(v3.elecUsage).toBe('50.40');
      expect(v3.elecAmount).toBe('378.00');
      expect(v3.parkingAmount).toBe('200.00');
      expect(v3.overdueAmount).toBe('150.25');
      expect(v3.otherFeesAmount).toBe('300.50');
      expect(v3.totalAmount).toBe('13233.75');
      expect(v3.formattedTotal).toBe('13,233.75');
    });
  });

  describe('4. Fresh Owner State & Malformed Value Reproduction Proof', () => {
    it('proves that requesting quick-add-context with undefined/roomNumber produces 400 whereas authoritative UUID produces 200', async () => {
      // 1. Literal 'undefined' string sent when client state is unhydrated
      const undefRes = await request(app)
        .get('/api/v1/properties/rooms/undefined/quick-add-context')
        .set('Cookie', ownerSessionCookie)
        .set('x-csrf-token', ownerCsrfToken)
        .set('x-dormitory-id', dormitoryId);

      expect(undefRes.status).toBe(400);
      expect(undefRes.body.error.code).toBe('INVALID_ID_FORMAT');
      expect(undefRes.body.error.message).toContain('UUID');

      // 2. Room number string 'A101' sent when UI passes room.roomNumber instead of room.id
      const roomNumRes = await request(app)
        .get('/api/v1/properties/rooms/A101/quick-add-context')
        .set('Cookie', ownerSessionCookie)
        .set('x-csrf-token', ownerCsrfToken)
        .set('x-dormitory-id', dormitoryId);

      expect(roomNumRes.status).toBe(400);
      expect(roomNumRes.body.error.code).toBe('INVALID_ID_FORMAT');

      // 3. Authoritative UUID from room row in Meter Workspace
      const validRes = await request(app)
        .get(`/api/v1/properties/rooms/${roomId}/quick-add-context`)
        .set('Cookie', ownerSessionCookie)
        .set('x-csrf-token', ownerCsrfToken)
        .set('x-dormitory-id', dormitoryId);

      expect(validRes.status).toBe(200);
      expect(validRes.body.data).toBeDefined();
      expect(validRes.body.data.roomId).toBe(roomId);
    });
  });
});
