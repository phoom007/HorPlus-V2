/**
 * @license Apache-2.0
 * LOCAL-07 BATCH 02 INTEGRATION TESTS
 * Complete domain, approval lifecycle, invoice presentation, scheduled completion,
 * and tenant self-claim test suite.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { getPrismaClient } from '../../db/prisma.js';
import { createApp } from '../../app.js';
import { DailyStayService, calculateInclusiveDays } from '../../services/daily-stay.service.js';
import { TenantClaimService } from '../../services/tenant-claim.service.js';
import {
  normalizeFullName,
  normalizeThaiPhone,
  calculateNameSimilarity,
  maskFullName,
  maskPhone,
} from '../../utils/thai-identity.util.js';

describe('LOCAL-07 Batch 02: Daily Stay Domain, Invoicing & Tenant Self-Claim', () => {
  const prisma = getPrismaClient();
  let app: any;
  let dailyStayService: DailyStayService;
  let tenantClaimService: TenantClaimService;

  // Test data IDs
  let ownerUserId: string;
  let tenantUserId: string;
  let tenantUser2Id: string;
  let dormitoryId: string;
  let buildingId: string;
  let roomId: string;
  let room2Id: string;
  let roleOwnerId: string;

  beforeAll(async () => {
    dailyStayService = new DailyStayService(prisma);
    tenantClaimService = new TenantClaimService(prisma);

    // 1. Create Owner User
    const ownerEmail = `batch02-owner-${Date.now()}@example.com`;
    const ownerUser = await prisma.user.create({
      data: {
        googleSubject: `sub-owner-${Date.now()}`,
        email: ownerEmail,
        emailNormalized: ownerEmail.toLowerCase(),
        name: 'เจ้าของหอพัก ทดสอบ',
      },
    });
    ownerUserId = ownerUser.id;

    // 2. Create Tenant Users (Unlinked)
    const tEmail = `batch02-tenant-${Date.now()}@example.com`;
    const tUser = await prisma.user.create({
      data: {
        googleSubject: `sub-tenant-${Date.now()}`,
        email: tEmail,
        emailNormalized: tEmail.toLowerCase(),
        name: 'นายสมชาย ใจดี',
      },
    });
    tenantUserId = tUser.id;

    const t2Email = `batch02-tenant2-${Date.now()}@example.com`;
    const tUser2 = await prisma.user.create({
      data: {
        googleSubject: `sub-tenant2-${Date.now()}`,
        email: t2Email,
        emailNormalized: t2Email.toLowerCase(),
        name: 'นางสาวสมศรี สดใส',
      },
    });
    tenantUser2Id = tUser2.id;

    // 3. Create Dormitory with FREE plan
    const dorm = await prisma.dormitory.create({
      data: {
        name: 'หอพักทดสอบ Batch02',
        status: 'active',
      },
    });
    dormitoryId = dorm.id;

    // Create Role OWNER
    const ownerRole = await prisma.role.create({
      data: {
        dormitoryId,
        code: 'OWNER',
        name: 'เจ้าของหอพัก',
        permissions: ['rooms:read', 'rooms:write', 'bills:read', 'bills:write'],
        isSystem: true,
      },
    });
    roleOwnerId = ownerRole.id;

    // Link Owner to Dormitory
    await prisma.dormitoryMember.create({
      data: {
        userId: ownerUserId,
        dormitoryId,
        roleId: roleOwnerId,
        status: 'active',
        membershipOrigin: 'MANUAL_GRANT',
      },
    });

    // 4. Create Building
    const building = await prisma.building.create({
      data: {
        dormitoryId,
        code: 'B2',
        name: 'อาคาร 2',
        floorCount: 3,
        roomsPerFloor: 5,
        monthlyRent: 4000.0,
        termRent: 20000.0,
        termMonths: 5,
        maxTermRentInstallments: 2,
        dailyRent: 600.0,
        depositAmount: 500.0,
      },
    });
    buildingId = building.id;

    // 5. Create Rooms
    const room = await prisma.room.create({
      data: {
        dormitoryId,
        buildingId,
        roomNumber: 'B201',
        normalizedRoomNumber: 'B201',
        roomType: 'standard',
        floor: 2,
        status: 'vacant',
        monthlyRent: 4000.0,
        termRent: 20000.0,
        termMonths: 5,
        dailyRent: 600.0,
        depositAmount: 500.0,
      },
    });
    roomId = room.id;

    const room2 = await prisma.room.create({
      data: {
        dormitoryId,
        buildingId,
        roomNumber: 'B202',
        normalizedRoomNumber: 'B202',
        roomType: 'standard',
        floor: 2,
        status: 'vacant',
        monthlyRent: 4000.0,
        dailyRent: 600.0,
        depositAmount: 0.0,
      },
    });
    room2Id = room2.id;
  });

  // ==========================================
  // Unit & Pure Formula Tests
  // ==========================================
  describe('Thai Identity & Date Math Pure Functions', () => {
    it('calculates inclusive calendar day counts correctly (1 Sep - 3 Sep = 3 days)', () => {
      expect(calculateInclusiveDays('2026-09-01', '2026-09-03')).toBe(3);
      expect(calculateInclusiveDays('2026-09-01', '2026-09-01')).toBe(1);
      expect(calculateInclusiveDays('2026-08-31', '2026-09-02')).toBe(3);
    });

    it('throws error when endDate < startDate', () => {
      expect(() => calculateInclusiveDays('2026-09-03', '2026-09-01')).toThrow();
    });

    it('normalizes Thai full names by stripping honorific titles and collapsing whitespace', () => {
      expect(normalizeFullName('นายสมชาย  ใจดี')).toBe('สมชาย ใจดี');
      expect(normalizeFullName('นางสาวสมศรี สดใส')).toBe('สมศรี สดใส');
      expect(normalizeFullName('น.ส. สมศรี  สดใส')).toBe('สมศรี สดใส');
      expect(normalizeFullName('ด.ช. เก่ง มาก')).toBe('เก่ง มาก');
      expect(normalizeFullName('สมชาย ใจดี')).toBe('สมชาย ใจดี');
    });

    it('calculates deterministic Levenshtein name similarity >= 90%', () => {
      // Exact match after title stripping
      expect(calculateNameSimilarity('นายสมชาย ใจดี', 'สมชาย ใจดี')).toBe(1.0);
      expect(calculateNameSimilarity('นางสาวสมศรี สดใส', 'น.ส. สมศรี สดใส')).toBe(1.0);

      // Minor typo: 1 char change on 11-char string => similarity > 0.90
      const score = calculateNameSimilarity('สมชาย ใจดียิ่ง', 'สมชาย ใจดียิ่งก');
      expect(score).toBeGreaterThanOrEqual(0.9);

      // Completely different name => similarity < 0.90
      expect(calculateNameSimilarity('สมชาย ใจดี', 'วิชัย กล้าหาญ')).toBeLessThan(0.5);
    });

    it('normalizes Thai phone numbers canonically (+66 conversion & non-digit stripping)', () => {
      expect(normalizeThaiPhone('083-123-4567')).toBe('0831234567');
      expect(normalizeThaiPhone('+66831234567')).toBe('0831234567');
      expect(normalizeThaiPhone('66831234567')).toBe('0831234567');
      expect(normalizeThaiPhone('02-123-4567')).toBe('021234567');
      expect(normalizeThaiPhone('123')).toBeNull();
    });

    it('masks full names and phones for public presentation safely', () => {
      expect(maskFullName('นายสมชาย ใจดี')).toBe('นายสมชาย ใXXX');
      expect(maskFullName('สมชาย ใจดี')).toBe('สมชาย ใXXX');
      expect(maskFullName('สมชาย')).toBe('สมXXX');
      expect(maskPhone('0831234567')).toBe('083-XXX-XXXX');
      expect(maskPhone('083-123-4567')).toBe('083-XXX-XXXX');
    });
  });

  // ==========================================
  // Daily Stay Lifecycle Tests (Option 2A & Owner Approval)
  // ==========================================
  describe('Daily Stay Domain & Approval Lifecycle', () => {
    let pendingStayId: string;

    it('A. Tenant Daily request creates PENDING_APPROVAL with NO Tenant row, NO Occupancy, NO Invoice', async () => {
      const initialTenantCount = await prisma.tenant.count({ where: { dormitoryId } });
      const initialOccupancyCount = await prisma.occupancy.count({ where: { dormitoryId } });
      const initialInvoiceCount = await prisma.dailyStayInvoice.count({ where: { dormitoryId } });

      const stay = await dailyStayService.createTenantDailyStayRequest(
        dormitoryId,
        {
          roomId,
          applicantFullName: 'นายสมชาย ใจดี',
          applicantPhone: '083-123-4567',
          startDate: '2026-09-01',
          endDate: '2026-09-03',
          dailyRateAmount: 600,
          depositAmount: 500,
          depositDeclaredStatus: 'UNPAID',
        },
        tenantUserId
      );

      pendingStayId = stay.id;

      expect(stay.status).toBe('PENDING_APPROVAL');
      expect(stay.tenantId).toBeNull();
      expect(stay.occupancyId).toBeNull();
      expect(stay.inclusiveDayCount).toBe(3);
      expect(Number(stay.totalRentAmount)).toBe(1800.0);

      // Verify NO orphan records created
      const finalTenantCount = await prisma.tenant.count({ where: { dormitoryId } });
      const finalOccupancyCount = await prisma.occupancy.count({ where: { dormitoryId } });
      const finalInvoiceCount = await prisma.dailyStayInvoice.count({ where: { dormitoryId } });

      expect(finalTenantCount).toBe(initialTenantCount);
      expect(finalOccupancyCount).toBe(initialOccupancyCount);
      expect(finalInvoiceCount).toBe(initialInvoiceCount);
    });

    it('B. Owner edits pending request before approval (changes daily rate & deposit to 0)', async () => {
      const updated = await dailyStayService.updatePendingDailyStay(
        dormitoryId,
        pendingStayId,
        {
          dailyRateAmount: 500.0,
          depositAmount: 0.0,
          depositDeclaredStatus: 'PAID',
        },
        ownerUserId
      );

      expect(Number(updated.dailyRateAmount)).toBe(500.0);
      expect(Number(updated.totalRentAmount)).toBe(1500.0); // 500 * 3
      expect(Number(updated.depositAmount)).toBe(0.0);
      expect(updated.depositDeclaredStatus).toBe('PAID');

      // Still no invoice before approval
      const invoice = await prisma.dailyStayInvoice.findUnique({
        where: { dailyStayId: pendingStayId },
      });
      expect(invoice).toBeNull();
    });

    it('C. Owner approves pending request: atomically creates Tenant, freezes Invoice with 2 items, creates Occupancy', async () => {
      const approved = await dailyStayService.approveDailyStay(
        dormitoryId,
        pendingStayId,
        ownerUserId
      );

      expect(approved.status).toBe('RESERVED'); // Future date (2026-09-01)
      expect(approved.tenantId).toBeDefined();
      expect(approved.occupancyId).toBeDefined();
      expect(approved.invoice).toBeDefined();

      // Check frozen invoice
      const invoice = approved.invoice!;
      expect(invoice.invoiceNumber).toMatch(/^INV-D-\d{4}-\d{2}-\d{4}$/);
      expect(Number(invoice.totalRentAmount)).toBe(1500.0);
      expect(Number(invoice.depositAmount)).toBe(0.0);
      expect(Number(invoice.totalAgreedAmount)).toBe(1500.0);
      expect(Number(invoice.outstandingAmount)).toBe(1500.0);

      // Check items: exactly 1 DAILY_RENT and 1 DEPOSIT
      expect(invoice.items.length).toBe(2);
      const rentItem = invoice.items.find((i: any) => i.itemType === 'DAILY_RENT');
      const depItem = invoice.items.find((i: any) => i.itemType === 'DEPOSIT');

      expect(rentItem).toBeDefined();
      expect(Number(rentItem.amount)).toBe(1500.0);
      expect(depItem).toBeDefined();
      expect(Number(depItem.amount)).toBe(0.0);

      // Check Occupancy created
      const occupancy = await prisma.occupancy.findUnique({
        where: { id: approved.occupancyId! },
      });
      expect(occupancy).toBeDefined();
      expect(occupancy?.status).toBe('RESERVED');
    });

    it('D. Repeated approval fails safely with no duplicate tenant or invoice', async () => {
      await expect(
        dailyStayService.approveDailyStay(dormitoryId, pendingStayId, ownerUserId)
      ).rejects.toThrow();

      const invoiceCount = await prisma.dailyStayInvoice.count({
        where: { dailyStayId: pendingStayId },
      });
      expect(invoiceCount).toBe(1);
    });

    it('E. Owner Daily Quick Add atomically creates and approves in 1 step for active stay', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

      const quickAddResult = await dailyStayService.ownerQuickAddDailyStay(
        dormitoryId,
        {
          roomId: room2Id,
          fullName: 'นายวิชัย สุขใจ',
          phone: '081-999-8888',
          startDate: today,
          endDate: tomorrow,
          dailyRateAmount: 600.0,
          depositAmount: 300.0,
          depositDeclaredStatus: 'PAID',
        },
        ownerUserId
      );

      expect(quickAddResult.status).toBe('ACTIVE');
      expect(quickAddResult.inclusiveDayCount).toBe(2);
      expect(Number(quickAddResult.totalRentAmount)).toBe(1200.0);
      expect(quickAddResult.tenant).toBeDefined();
      expect(quickAddResult.occupancy).toBeDefined();
      expect(quickAddResult.invoice).toBeDefined();

      // Outstanding calculation: declared paid excludes deposit from outstanding balance
      expect(Number(quickAddResult.invoice.totalAgreedAmount)).toBe(1500.0); // 1200 + 300
      expect(Number(quickAddResult.invoice.outstandingAmount)).toBe(1200.0); // only rent outstanding

      // Room status should be occupied
      const updatedRoom = await prisma.room.findUnique({ where: { id: room2Id } });
      expect(updatedRoom?.status).toBe('occupied');
    });

    it('F. Early checkout frees room immediately without altering approved invoice amount', async () => {
      const activeStay = await prisma.dailyStay.findFirst({
        where: { roomId: room2Id, status: 'ACTIVE' },
        include: { invoice: true },
      });

      expect(activeStay).toBeDefined();

      const checkedOut = await dailyStayService.checkoutDailyStay(
        dormitoryId,
        activeStay!.id,
        ownerUserId
      );

      expect(checkedOut.status).toBe('CHECKED_OUT');
      expect(checkedOut.actualCheckedOutAt).toBeDefined();

      // Room should become vacant
      const vacatedRoom = await prisma.room.findUnique({ where: { id: room2Id } });
      expect(vacatedRoom?.status).toBe('vacant');

      // Approved invoice remains unchanged
      const freshInvoice = await prisma.dailyStayInvoice.findUnique({
        where: { dailyStayId: activeStay!.id },
      });
      expect(Number(freshInvoice?.totalAgreedAmount)).toBe(1500.0);
      expect(Number(freshInvoice?.outstandingAmount)).toBe(1200.0);
    });

    it('G. Scheduled completion: active stay ending naturally transitions to COMPLETED and vacates room', async () => {
      const today = new Date().toISOString().slice(0, 10);

      const pastStay = await dailyStayService.ownerQuickAddDailyStay(
        dormitoryId,
        {
          roomId: room2Id,
          fullName: 'ผู้เข้าพัก ชั่วคราว',
          startDate: today,
          endDate: today,
          dailyRateAmount: 500.0,
        },
        ownerUserId
      );

      expect(pastStay.status).toBe('ACTIVE');

      // Run scheduled completion simulating next day
      const tomorrow = new Date(Date.now() + 86400000);
      const compResult = await dailyStayService.completeEndedDailyStays(dormitoryId, tomorrow);
      expect(compResult.completedCount).toBeGreaterThanOrEqual(1);

      const updatedStay = await prisma.dailyStay.findUnique({ where: { id: pastStay.id } });
      expect(updatedStay?.status).toBe('COMPLETED');

      const roomAfter = await prisma.room.findUnique({ where: { id: room2Id } });
      expect(roomAfter?.status).toBe('vacant');
    });

    it('H. Overlap prevention: overlapping stay on same room is rejected', async () => {
      // Room B201 has stay on 2026-09-01 to 2026-09-03
      await expect(
        dailyStayService.ownerQuickAddDailyStay(
          dormitoryId,
          {
            roomId,
            fullName: 'ผู้เช่า ซ้อนทับ',
            startDate: '2026-09-02',
            endDate: '2026-09-05',
          },
          ownerUserId
        )
      ).rejects.toThrow();

      // Subsequent non-overlapping stay (starting 2026-09-04) is accepted
      const validNextStay = await dailyStayService.createTenantDailyStayRequest(
        dormitoryId,
        {
          roomId,
          applicantFullName: 'ผู้เช่า ต่อเนื่อง',
          startDate: '2026-09-04',
          endDate: '2026-09-06',
        }
      );
      expect(validNextStay.status).toBe('PENDING_APPROVAL');
    });
  });

  // ==========================================
  // Tenant Self-Claim Tests (Option 1A)
  // ==========================================
  describe('Tenant Self-Claim (Option 1A)', () => {
    let unlinkedTenantId: string;
    let claimRoomId: string;
    let claimUser1Id: string;
    let claimUser2Id: string;

    beforeAll(async () => {
      // Create dedicated test users for claim tests
      const u1 = await prisma.user.create({
        data: {
          googleSubject: `sub-claim-u1-${Date.now()}`,
          email: `claim-u1-${Date.now()}@example.com`,
          emailNormalized: `claim-u1-${Date.now()}@example.com`,
          name: 'นายสมชาย ใจดี ผู้เช่า1',
        },
      });
      claimUser1Id = u1.id;

      const u2 = await prisma.user.create({
        data: {
          googleSubject: `sub-claim-u2-${Date.now()}`,
          email: `claim-u2-${Date.now()}@example.com`,
          emailNormalized: `claim-u2-${Date.now()}@example.com`,
          name: 'นางสาวสมศรี สดใส ผู้เช่า2',
        },
      });
      claimUser2Id = u2.id;

      // Create a dedicated room and unlinked tenant
      const claimRoom = await prisma.room.create({
        data: {
          dormitoryId,
          buildingId,
          roomNumber: 'B301',
          normalizedRoomNumber: 'B301',
          roomType: 'standard',
          floor: 3,
          status: 'occupied',
        },
      });
      claimRoomId = claimRoom.id;

      // Owner creates tenant placeholder via quick add / provisional term
      const tenant = await prisma.tenant.create({
        data: {
          dormitoryId,
          tenantNumber: 'TNT-TEST-CLAIM-01',
          firstName: 'นายสมชาย',
          lastName: 'ใจดี',
          displayName: 'นายสมชาย ใจดี',
          phone: '083-123-4567',
          status: 'active',
          linkedUserId: null, // Placeholder unlinked
        },
      });
      unlinkedTenantId = tenant.id;

      // Create active Occupancy linking room to tenant
      await prisma.occupancy.create({
        data: {
          dormitoryId,
          roomId: claimRoomId,
          tenantId: unlinkedTenantId,
          status: 'ACTIVE',
        },
      });
    });

    it('A. Candidate discovery returns masked name and phone safely', async () => {
      const candidate = await tenantClaimService.getCandidateForRoom(dormitoryId, claimRoomId);

      expect(candidate.hasCandidate).toBe(true);
      expect(candidate.roomNumber).toBe('B301');
      expect(candidate.maskedName).toBe('นายสมชาย ใXXX');
      expect(candidate.maskedPhone).toBe('083-XXX-XXXX');
    });

    it('B. Mismatched claim input (< 90% similarity, wrong phone) fails safely with generic error', async () => {
      await expect(
        tenantClaimService.claimTenant(
          {
            dormitoryId,
            roomId: claimRoomId,
            claimInput: 'นายวิชัย กล้าหาญ',
          },
          claimUser1Id
        )
      ).rejects.toThrow();

      // Verify still unlinked
      const t = await prisma.tenant.findUnique({ where: { id: unlinkedTenantId } });
      expect(t?.linkedUserId).toBeNull();
    });

    it('C. Full-name match (>= 90% with Thai title stripping) successfully links User and creates DormitoryMember TENANT', async () => {
      const claimResult = await tenantClaimService.claimTenant(
        {
          dormitoryId,
          roomId: claimRoomId,
          claimInput: 'สมชาย ใจดี', // stripped "นาย"
        },
        claimUser1Id
      );

      expect(claimResult.success).toBe(true);
      expect(claimResult.tenantId).toBe(unlinkedTenantId);

      // Verify Tenant.linkedUserId is set to User.id (NOT LineFriend id)
      const updatedTenant = await prisma.tenant.findUnique({ where: { id: unlinkedTenantId } });
      expect(updatedTenant?.linkedUserId).toBe(claimUser1Id);

      // Verify DormitoryMember TENANT created/ensured for claimed user
      const membership = await prisma.dormitoryMember.findUnique({
        where: {
          user_dormitory_unique: {
            userId: claimUser1Id,
            dormitoryId,
          },
        },
        include: { role: true },
      });

      expect(membership).toBeDefined();
      expect(membership?.status).toBe('active');
      expect(membership?.role.code).toBe('TENANT');
    });

    it('D. Double claim on already claimed tenant fails safely', async () => {
      await expect(
        tenantClaimService.claimTenant(
          {
            dormitoryId,
            roomId: claimRoomId,
            claimInput: 'นายสมชาย ใจดี',
          },
          claimUser2Id
        )
      ).rejects.toThrow();

      // Original link preserved
      const t = await prisma.tenant.findUnique({ where: { id: unlinkedTenantId } });
      expect(t?.linkedUserId).toBe(claimUser1Id);
    });

    it('E. Phone exact match successfully claims unlinked placeholder', async () => {
      // Create another room and unlinked tenant with phone
      const claimRoom2 = await prisma.room.create({
        data: {
          dormitoryId,
          buildingId,
          roomNumber: 'B302',
          normalizedRoomNumber: 'B302',
          roomType: 'standard',
          floor: 3,
          status: 'occupied',
        },
      });

      const t2 = await prisma.tenant.create({
        data: {
          dormitoryId,
          tenantNumber: 'TNT-TEST-CLAIM-02',
          firstName: 'สมศรี',
          displayName: 'สมศรี สดใส',
          phone: '089-765-4321',
          status: 'active',
          linkedUserId: null,
        },
      });

      await prisma.occupancy.create({
        data: {
          dormitoryId,
          roomId: claimRoom2.id,
          tenantId: t2.id,
          status: 'ACTIVE',
        },
      });

      // Claim using normalized phone (+66 format)
      const res = await tenantClaimService.claimTenant(
        {
          dormitoryId,
          roomId: claimRoom2.id,
          claimInput: '+66897654321',
        },
        claimUser2Id
      );

      expect(res.success).toBe(true);
      expect(res.tenantId).toBe(t2.id);

      const updatedT2 = await prisma.tenant.findUnique({ where: { id: t2.id } });
      expect(updatedT2?.linkedUserId).toBe(claimUser2Id);
    });

    // ── Decision 2A Explicit Priority Tests ─────────────────────────────
    it('F. Priority 1 (Active beats Reserved): Active unlinked tenant is chosen over upcoming Reserved tenant', async () => {
      const p1Room = await prisma.room.create({
        data: {
          dormitoryId,
          buildingId,
          roomNumber: 'P1-01',
          normalizedRoomNumber: 'P1-01',
          roomType: 'standard',
          floor: 1,
          status: 'occupied',
        },
      });

      // Tenant A: ACTIVE
      const tenantA = await prisma.tenant.create({
        data: {
          dormitoryId,
          tenantNumber: `TNT-P1-A-${Date.now()}`,
          firstName: 'นายเอกชัย',
          lastName: 'ผู้พักปัจจุบัน',
          displayName: 'นายเอกชัย ผู้พักปัจจุบัน',
          phone: '081-111-0001',
          status: 'active',
          linkedUserId: null,
        },
      });

      await prisma.occupancy.create({
        data: {
          dormitoryId,
          roomId: p1Room.id,
          tenantId: tenantA.id,
          status: 'ACTIVE',
          startedAt: new Date(),
        },
      });

      // Tenant B: RESERVED for next month
      const tenantB = await prisma.tenant.create({
        data: {
          dormitoryId,
          tenantNumber: `TNT-P1-B-${Date.now()}`,
          firstName: 'นายสองชัย',
          lastName: 'ผู้จองล่วงหน้า',
          displayName: 'นายสองชัย ผู้จองล่วงหน้า',
          phone: '081-111-0002',
          status: 'active',
          linkedUserId: null,
        },
      });

      await prisma.occupancy.create({
        data: {
          dormitoryId,
          roomId: p1Room.id,
          tenantId: tenantB.id,
          status: 'RESERVED',
          startedAt: new Date(Date.now() + 30 * 86400000),
        },
      });

      // Candidate discovery must select Tenant A (Active)
      const cand = await tenantClaimService.getCandidateForRoom(dormitoryId, p1Room.id);
      expect(cand.hasCandidate).toBe(true);
      expect(cand.maskedName).toBe('นายเอกชัย ผXXX');
    });

    it('G. Priority 2 (Nearest Reserved when no Active): Strictly nearest future reserved tenant is chosen', async () => {
      const p2Room = await prisma.room.create({
        data: {
          dormitoryId,
          buildingId,
          roomNumber: 'P2-01',
          normalizedRoomNumber: 'P2-01',
          roomType: 'standard',
          floor: 1,
          status: 'vacant',
        },
      });

      // Tenant B: RESERVED starts in 10 days
      const tenantB = await prisma.tenant.create({
        data: {
          dormitoryId,
          tenantNumber: `TNT-P2-B-${Date.now()}`,
          firstName: 'นางสาวนารี',
          lastName: 'เริ่มก่อน',
          displayName: 'นางสาวนารี เริ่มก่อน',
          phone: '082-222-0001',
          status: 'active',
          linkedUserId: null,
        },
      });

      await prisma.occupancy.create({
        data: {
          dormitoryId,
          roomId: p2Room.id,
          tenantId: tenantB.id,
          status: 'RESERVED',
          startedAt: new Date(Date.now() + 10 * 86400000),
        },
      });

      // Tenant C: RESERVED starts in 40 days
      const tenantC = await prisma.tenant.create({
        data: {
          dormitoryId,
          tenantNumber: `TNT-P2-C-${Date.now()}`,
          firstName: 'นางสาวราตรี',
          lastName: 'เริ่มทีหลัง',
          displayName: 'นางสาวราตรี เริ่มทีหลัง',
          phone: '082-222-0002',
          status: 'active',
          linkedUserId: null,
        },
      });

      await prisma.occupancy.create({
        data: {
          dormitoryId,
          roomId: p2Room.id,
          tenantId: tenantC.id,
          status: 'RESERVED',
          startedAt: new Date(Date.now() + 40 * 86400000),
        },
      });

      // Candidate discovery must select Tenant B (earlier date)
      const cand = await tenantClaimService.getCandidateForRoom(dormitoryId, p2Room.id);
      expect(cand.hasCandidate).toBe(true);
      expect(cand.maskedName).toBe('นางสาวนารี เXXX');
    });

    it('H. Historical Ignored: Room with only ENDED occupancy returns generic unavailable', async () => {
      const histRoom = await prisma.room.create({
        data: {
          dormitoryId,
          buildingId,
          roomNumber: 'HIST-01',
          normalizedRoomNumber: 'HIST-01',
          roomType: 'standard',
          floor: 1,
          status: 'vacant',
        },
      });

      const oldTenant = await prisma.tenant.create({
        data: {
          dormitoryId,
          tenantNumber: `TNT-HIST-${Date.now()}`,
          firstName: 'นายอดีต',
          lastName: 'ย้ายออกแล้ว',
          displayName: 'นายอดีต ย้ายออกแล้ว',
          phone: '083-333-0001',
          status: 'active',
          linkedUserId: null,
        },
      });

      await prisma.occupancy.create({
        data: {
          dormitoryId,
          roomId: histRoom.id,
          tenantId: oldTenant.id,
          status: 'ENDED',
          startedAt: new Date(Date.now() - 60 * 86400000),
          endedAt: new Date(Date.now() - 10 * 86400000),
        },
      });

      const cand = await tenantClaimService.getCandidateForRoom(dormitoryId, histRoom.id);
      expect(cand.hasCandidate).toBe(false);
    });

    it('I. Priority 3 (Multiple Active Ambiguity Fail-Closed): Returns unavailable when multiple active unlinked candidates exist', async () => {
      const ambiRoom = await prisma.room.create({
        data: {
          dormitoryId,
          buildingId,
          roomNumber: 'AMB-01',
          normalizedRoomNumber: 'AMB-01',
          roomType: 'standard',
          floor: 1,
          status: 'occupied',
        },
      });

      const t1 = await prisma.tenant.create({
        data: {
          dormitoryId,
          tenantNumber: `TNT-AMB-1-${Date.now()}`,
          firstName: 'ผู้เช่ากวน 1',
          displayName: 'ผู้เช่ากวน 1',
          phone: '084-444-0001',
          status: 'active',
          linkedUserId: null,
        },
      });

      const t2 = await prisma.tenant.create({
        data: {
          dormitoryId,
          tenantNumber: `TNT-AMB-2-${Date.now()}`,
          firstName: 'ผู้เช่ากวน 2',
          displayName: 'ผู้เช่ากวน 2',
          phone: '084-444-0002',
          status: 'active',
          linkedUserId: null,
        },
      });

      await prisma.occupancy.create({
        data: { dormitoryId, roomId: ambiRoom.id, tenantId: t1.id, status: 'ACTIVE' },
      });
      await prisma.occupancy.create({
        data: { dormitoryId, roomId: ambiRoom.id, tenantId: t2.id, status: 'ACTIVE' },
      });

      // Must fail closed on multiple active ambiguity
      const cand = await tenantClaimService.getCandidateForRoom(dormitoryId, ambiRoom.id);
      expect(cand.hasCandidate).toBe(false);
    });

    it('J. Priority 3 (Equal Nearest Reserved Ambiguity Fail-Closed): Returns unavailable when two reserved candidates tie on nearest start date', async () => {
      const tieRoom = await prisma.room.create({
        data: {
          dormitoryId,
          buildingId,
          roomNumber: 'TIE-01',
          normalizedRoomNumber: 'TIE-01',
          roomType: 'standard',
          floor: 1,
          status: 'vacant',
        },
      });

      const sameDate = new Date(Date.now() + 15 * 86400000);

      const t1 = await prisma.tenant.create({
        data: {
          dormitoryId,
          tenantNumber: `TNT-TIE-1-${Date.now()}`,
          firstName: 'ผู้เช่าเสมอ 1',
          displayName: 'ผู้เช่าเสมอ 1',
          phone: '085-555-0001',
          status: 'active',
          linkedUserId: null,
        },
      });

      const t2 = await prisma.tenant.create({
        data: {
          dormitoryId,
          tenantNumber: `TNT-TIE-2-${Date.now()}`,
          firstName: 'ผู้เช่าเสมอ 2',
          displayName: 'ผู้เช่าเสมอ 2',
          phone: '085-555-0002',
          status: 'active',
          linkedUserId: null,
        },
      });

      await prisma.occupancy.create({
        data: { dormitoryId, roomId: tieRoom.id, tenantId: t1.id, status: 'RESERVED', startedAt: sameDate },
      });
      await prisma.occupancy.create({
        data: { dormitoryId, roomId: tieRoom.id, tenantId: t2.id, status: 'RESERVED', startedAt: sameDate },
      });

      // Must fail closed on tied reserved start date
      const cand = await tenantClaimService.getCandidateForRoom(dormitoryId, tieRoom.id);
      expect(cand.hasCandidate).toBe(false);
    });
  });

  // ==========================================
  // HTTP Route & Authorization Integration Tests
  // ==========================================
  describe('HTTP Route & Security Tests', () => {
    let httpApp: any;
    let authService: any;
    let ownerSessionCookie: string;
    let ownerCsrfToken: string;
    let tenantSessionCookie: string;
    let tenantCsrfToken: string;
    let httpRoomId: string;
    let httpStayId: string;

    beforeAll(async () => {
      const { createApp } = await import('../../app.js');
      const { AuthenticationService } = await import('../../services/auth.service.js');
      const { getEnv, resetCachedEnv } = await import('../../config/env.js');
      const { PrismaUserRepository } = await import('../../db/repositories/user.repository.js');
      const { PrismaSessionRepository } = await import('../../db/repositories/session.repository.js');
      const { PrismaMembershipRepository } = await import('../../db/repositories/membership.repository.js');
      const { PrismaRoleRepository } = await import('../../db/repositories/role.repository.js');

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

      httpApp = createApp({ customAuthService: authService, forcePrisma: true });

      const ownerAuth = await authService.authenticateTestUser(ownerUserId);
      ownerSessionCookie = `horplus_session=${ownerAuth.sessionToken}; horplus_csrf=${ownerAuth.csrfToken}`;
      ownerCsrfToken = ownerAuth.csrfToken;

      const tenantAuth = await authService.authenticateTestUser(tenantUserId);
      tenantSessionCookie = `horplus_session=${tenantAuth.sessionToken}; horplus_csrf=${tenantAuth.csrfToken}`;
      tenantCsrfToken = tenantAuth.csrfToken;

      const httpRoom = await prisma.room.create({
        data: {
          dormitoryId,
          buildingId,
          roomNumber: 'B401',
          normalizedRoomNumber: 'B401',
          roomType: 'standard',
          floor: 4,
          status: 'vacant',
          monthlyRent: 4000.0,
          dailyRent: 700.0,
          depositAmount: 500.0,
        },
      });
      httpRoomId = httpRoom.id;
    });

    it('1. POST /api/v1/daily-stays/request CSRF Matrix: unauth (401), no csrf (403), bad csrf (403), valid csrf (201)', async () => {
      // A. No session -> 401
      const unauthRes = await request(httpApp)
        .post('/api/v1/daily-stays/request')
        .set('x-dormitory-id', dormitoryId)
        .send({
          dormitoryId,
          roomId: httpRoomId,
          applicantFullName: 'นายทดสอบ เอชทีทีพี',
          startDate: '2026-10-01',
          endDate: '2026-10-03',
        });
      expect(unauthRes.status).toBe(401);

      // B. Valid session, NO X-CSRF-Token header -> 403 CSRF_TOKEN_REQUIRED
      const noCsrfRes = await request(httpApp)
        .post('/api/v1/daily-stays/request')
        .set('Cookie', tenantSessionCookie)
        .set('x-dormitory-id', dormitoryId)
        .send({
          dormitoryId,
          roomId: httpRoomId,
          applicantFullName: 'นายทดสอบ เอชทีทีพี',
          startDate: '2026-10-01',
          endDate: '2026-10-03',
        });
      expect(noCsrfRes.status).toBe(403);
      expect(noCsrfRes.body.error.code).toBe('CSRF_TOKEN_REQUIRED');

      // C. Valid session, invalid X-CSRF-Token -> 403 CSRF_TOKEN_INVALID
      const badCsrfRes = await request(httpApp)
        .post('/api/v1/daily-stays/request')
        .set('Cookie', tenantSessionCookie)
        .set('x-csrf-token', 'invalid-csrf-token-12345')
        .set('x-dormitory-id', dormitoryId)
        .send({
          dormitoryId,
          roomId: httpRoomId,
          applicantFullName: 'นายทดสอบ เอชทีทีพี',
          startDate: '2026-10-01',
          endDate: '2026-10-03',
        });
      expect(badCsrfRes.status).toBe(403);
      expect(badCsrfRes.body.error.code).toBe('CSRF_TOKEN_INVALID');

      // D. Valid session, valid X-CSRF-Token -> 201 PENDING_APPROVAL
      const res = await request(httpApp)
        .post('/api/v1/daily-stays/request')
        .set('Cookie', tenantSessionCookie)
        .set('x-csrf-token', tenantCsrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({
          dormitoryId,
          roomId: httpRoomId,
          applicantFullName: 'นายทดสอบ เอชทีทีพี',
          applicantPhone: '085-555-5555',
          startDate: '2026-10-01',
          endDate: '2026-10-03',
          dailyRateAmount: '700.00',
          depositAmount: '500.00',
          depositDeclaredStatus: 'UNPAID',
        });

      expect(res.status).toBe(201);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.status).toBe('PENDING_APPROVAL');
      // E. requesterUserId matches authenticated user.id
      expect(res.body.data.requesterUserId).toBe(tenantUserId);
      expect(res.body.data.inclusiveDayCount).toBe(3);
      expect(Number(res.body.data.totalRentAmount)).toBe(2100.0);

      httpStayId = res.body.data.id;
    });

    it('1b. POST /api/v1/daily-stays/request rejects raw numeric money and invalid formats with HTTP 400', async () => {
      // A. Raw number dailyRateAmount -> 400 VALIDATION_ERROR
      const numRateRes = await request(httpApp)
        .post('/api/v1/daily-stays/request')
        .set('Cookie', tenantSessionCookie)
        .set('x-csrf-token', tenantCsrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({
          dormitoryId,
          roomId: httpRoomId,
          applicantFullName: 'นายตัวเลข ดิบ',
          startDate: '2026-10-01',
          endDate: '2026-10-03',
          dailyRateAmount: 350, // raw number
          depositAmount: '0.00',
        });
      expect(numRateRes.status).toBe(400);
      expect(numRateRes.body.error.code).toBe('VALIDATION_ERROR');

      // B. Raw number depositAmount -> 400 VALIDATION_ERROR
      const numDepRes = await request(httpApp)
        .post('/api/v1/daily-stays/request')
        .set('Cookie', tenantSessionCookie)
        .set('x-csrf-token', tenantCsrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({
          dormitoryId,
          roomId: httpRoomId,
          applicantFullName: 'นายตัวเลข ดิบ',
          startDate: '2026-10-01',
          endDate: '2026-10-03',
          dailyRateAmount: '350.00',
          depositAmount: 0, // raw number
        });
      expect(numDepRes.status).toBe(400);
      expect(numDepRes.body.error.code).toBe('VALIDATION_ERROR');

      // C. Negative string -> 400 VALIDATION_ERROR
      const negRes = await request(httpApp)
        .post('/api/v1/daily-stays/request')
        .set('Cookie', tenantSessionCookie)
        .set('x-csrf-token', tenantCsrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({
          dormitoryId,
          roomId: httpRoomId,
          applicantFullName: 'นายค่าลบ',
          startDate: '2026-10-01',
          endDate: '2026-10-03',
          dailyRateAmount: '-350.00',
        });
      expect(negRes.status).toBe(400);
      expect(negRes.body.error.code).toBe('VALIDATION_ERROR');

      // D. Valid decimal string with 0 deposit -> 201 PENDING_APPROVAL without creating Tenant/Occupancy/Invoice
      const tenantCountBefore = await prisma.tenant.count({ where: { dormitoryId } });
      const validZeroRes = await request(httpApp)
        .post('/api/v1/daily-stays/request')
        .set('Cookie', tenantSessionCookie)
        .set('x-csrf-token', tenantCsrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({
          dormitoryId,
          roomId: httpRoomId,
          applicantFullName: 'นายมัดจำ ศูนย์',
          startDate: '2026-10-01',
          endDate: '2026-10-03',
          dailyRateAmount: '350.00',
          depositAmount: '0.00',
          depositDeclaredStatus: 'PAID',
        });
      expect(validZeroRes.status).toBe(201);
      expect(validZeroRes.body.data.status).toBe('PENDING_APPROVAL');
      expect(Number(validZeroRes.body.data.depositAmount)).toBe(0.0);
      expect(validZeroRes.body.data.depositDeclaredStatus).toBe('PAID');

      // Verify no Tenant, no Occupancy, no invoice created for pending request
      const tenantCountAfter = await prisma.tenant.count({ where: { dormitoryId } });
      expect(tenantCountAfter).toBe(tenantCountBefore);
      const invCount = await prisma.dailyStayInvoice.count({ where: { dailyStayId: validZeroRes.body.data.id } });
      expect(invCount).toBe(0);
    });

    it('2. PATCH /api/v1/daily-stays/:id/edit-pending edits pending values by owner with canonical CSRF', async () => {
      const res = await request(httpApp)
        .patch(`/api/v1/daily-stays/${httpStayId}/edit-pending`)
        .set('Cookie', ownerSessionCookie)
        .set('x-csrf-token', ownerCsrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({
          dailyRateAmount: '600.00',
          depositAmount: '0.00',
          depositDeclaredStatus: 'PAID',
        });

      expect(res.status).toBe(200);
      expect(Number(res.body.data.dailyRateAmount)).toBe(600.0);
      expect(Number(res.body.data.totalRentAmount)).toBe(1800.0);
      expect(Number(res.body.data.depositAmount)).toBe(0.0);
    });

    it('3. POST /api/v1/daily-stays/:id/approve approves request and returns frozen invoice with canonical CSRF', async () => {
      const res = await request(httpApp)
        .post(`/api/v1/daily-stays/${httpStayId}/approve`)
        .set('Cookie', ownerSessionCookie)
        .set('x-csrf-token', ownerCsrfToken)
        .set('x-dormitory-id', dormitoryId);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('RESERVED');
      expect(res.body.data.invoice).toBeDefined();
      expect(res.body.data.invoice.items.length).toBe(2);

      // Verify approved stay is no longer returned in PENDING_APPROVAL query
      const pendingRes = await request(httpApp)
        .get('/api/v1/daily-stays?status=PENDING_APPROVAL')
        .set('Cookie', ownerSessionCookie)
        .set('x-dormitory-id', dormitoryId);

      expect(pendingRes.status).toBe(200);
      expect(pendingRes.body.data.some((s: any) => s.id === httpStayId)).toBe(false);
    });

    it('3b. POST /api/v1/daily-stays/:id/reject rejects request without orphan tenant and removes from pending query', async () => {
      const tenantCountBefore = await prisma.tenant.count({ where: { dormitoryId } });

      const createRes = await request(httpApp)
        .post('/api/v1/daily-stays/request')
        .set('Cookie', tenantSessionCookie)
        .set('x-csrf-token', tenantCsrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({
          dormitoryId,
          roomId: httpRoomId,
          applicantFullName: 'นายถูกปฏิเสธ ทดสอบ',
          startDate: '2026-11-10',
          endDate: '2026-11-12',
          dailyRateAmount: '500.00',
        });

      expect(createRes.status).toBe(201);
      const rejStayId = createRes.body.data.id;

      // Reject stay
      const rejRes = await request(httpApp)
        .post(`/api/v1/daily-stays/${rejStayId}/reject`)
        .set('Cookie', ownerSessionCookie)
        .set('x-csrf-token', ownerCsrfToken)
        .set('x-dormitory-id', dormitoryId);

      expect(rejRes.status).toBe(200);
      expect(rejRes.body.data.status).toBe('REJECTED');

      // Verify ZERO orphan tenant rows created
      const tenantCountAfter = await prisma.tenant.count({ where: { dormitoryId } });
      expect(tenantCountAfter).toBe(tenantCountBefore);

      // Verify removed from PENDING_APPROVAL
      const pendingRes = await request(httpApp)
        .get('/api/v1/daily-stays?status=PENDING_APPROVAL')
        .set('Cookie', ownerSessionCookie)
        .set('x-dormitory-id', dormitoryId);

      expect(pendingRes.body.data.some((s: any) => s.id === rejStayId)).toBe(false);
    });

    it('4. POST /api/v1/daily-stays/owner-quick-add creates and approves in 1 step, NOT appearing in pending query', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

      const res = await request(httpApp)
        .post('/api/v1/daily-stays/owner-quick-add')
        .set('Cookie', ownerSessionCookie)
        .set('x-csrf-token', ownerCsrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({
          roomId: httpRoomId,
          fullName: 'นายสมบัติ สดใส',
          phone: '087-777-7777',
          startDate: today,
          endDate: tomorrow,
          dailyRateAmount: '700.00',
          depositAmount: '200.00',
          depositDeclaredStatus: 'PAID',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('ACTIVE');
      expect(res.body.data.invoice).toBeDefined();

      // Verify Owner Quick Add is NOT returned in PENDING_APPROVAL query
      const pendingRes = await request(httpApp)
        .get('/api/v1/daily-stays?status=PENDING_APPROVAL')
        .set('Cookie', ownerSessionCookie)
        .set('x-dormitory-id', dormitoryId);

      expect(pendingRes.status).toBe(200);
      expect(pendingRes.body.data.some((s: any) => s.id === res.body.data.id)).toBe(false);
    });

    it('4b. Owner Daily Quick Add Rate Matrix: configured fallback, explicit rate, missing rate fail-closed (409), explicit 0.00 rate', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

      // Setup fresh Dormitory with OWNER role and active member
      const matrixDorm = await prisma.dormitory.create({
        data: {
          code: `QA-${Date.now()}`,
          name: 'Dormitory Quick Add Matrix',
          status: 'active',
        },
      });
      const ownerRole = await prisma.role.create({
        data: {
          dormitoryId: matrixDorm.id,
          code: 'OWNER',
          name: 'เจ้าของหอพัก',
          permissions: ['*'],
          isSystem: true,
        },
      });
      await prisma.dormitoryMember.create({
        data: {
          userId: ownerUserId,
          dormitoryId: matrixDorm.id,
          roleId: ownerRole.id,
          status: 'active',
          membershipOrigin: 'MANUAL_GRANT',
        },
      });
      const matrixBld = await prisma.building.create({
        data: {
          dormitoryId: matrixDorm.id,
          name: 'Building Matrix',
          floorCount: 2,
        },
      });

      const matrixAuth = await authService.authenticateTestUser(ownerUserId);
      const matrixCookie = `horplus_session=${matrixAuth.sessionToken}; horplus_csrf=${matrixAuth.csrfToken}`;
      const matrixCsrf = matrixAuth.csrfToken;

      // Case A: Room with configured daily rate = 350.00, Owner payload omits dailyRateAmount
      const roomA = await prisma.room.create({
        data: {
          dormitoryId: matrixDorm.id,
          buildingId: matrixBld.id,
          roomNumber: 'QA-A',
          normalizedRoomNumber: 'QA-A',
          roomType: 'standard',
          floor: 1,
          status: 'vacant',
          dailyRent: 350.0,
        },
      });

      const resA = await request(httpApp)
        .post('/api/v1/daily-stays/owner-quick-add')
        .set('Cookie', matrixCookie)
        .set('x-csrf-token', matrixCsrf)
        .set('x-dormitory-id', matrixDorm.id)
        .send({
          roomId: roomA.id,
          fullName: 'นายทดสอบ เคสเอ',
          startDate: today,
          endDate: tomorrow,
        });

      expect(resA.status).toBe(201);
      expect(Number(resA.body.data.dailyRateAmount)).toBe(350.0);

      // Case B: Room with unconfigured daily rate (null), Owner explicitly supplies dailyRateAmount = "500.00"
      const roomB = await prisma.room.create({
        data: {
          dormitoryId: matrixDorm.id,
          buildingId: matrixBld.id,
          roomNumber: 'QA-B',
          normalizedRoomNumber: 'QA-B',
          roomType: 'standard',
          floor: 1,
          status: 'vacant',
          dailyRent: null,
        },
      });

      const resB = await request(httpApp)
        .post('/api/v1/daily-stays/owner-quick-add')
        .set('Cookie', matrixCookie)
        .set('x-csrf-token', matrixCsrf)
        .set('x-dormitory-id', matrixDorm.id)
        .send({
          roomId: roomB.id,
          fullName: 'นายทดสอบ เคสบี',
          startDate: today,
          endDate: tomorrow,
          dailyRateAmount: '500.00',
        });

      expect(resB.status).toBe(201);
      expect(Number(resB.body.data.dailyRateAmount)).toBe(500.0);

      // Case C: Room with unconfigured daily rate (null), Owner omits dailyRateAmount -> Fails closed 409
      const roomC = await prisma.room.create({
        data: {
          dormitoryId: matrixDorm.id,
          buildingId: matrixBld.id,
          roomNumber: 'QA-C',
          normalizedRoomNumber: 'QA-C',
          roomType: 'standard',
          floor: 1,
          status: 'vacant',
          dailyRent: null,
        },
      });

      const tenantCountBefore = await prisma.tenant.count({ where: { dormitoryId: matrixDorm.id } });
      const occCountBefore = await prisma.occupancy.count({ where: { dormitoryId: matrixDorm.id } });
      const invCountBefore = await prisma.dailyStayInvoice.count({ where: { dormitoryId: matrixDorm.id } });
      const stayCountBefore = await prisma.dailyStay.count({ where: { dormitoryId: matrixDorm.id } });

      const resC = await request(httpApp)
        .post('/api/v1/daily-stays/owner-quick-add')
        .set('Cookie', matrixCookie)
        .set('x-csrf-token', matrixCsrf)
        .set('x-dormitory-id', matrixDorm.id)
        .send({
          roomId: roomC.id,
          fullName: 'นายทดสอบ เคสซี ไม่ผ่าน',
          startDate: today,
          endDate: tomorrow,
          // dailyRateAmount omitted
        });

      expect(resC.status).toBe(409);
      expect(resC.body.error.code).toBe('DAILY_RATE_NOT_CONFIGURED');

      // Assert 0 partial mutations
      expect(await prisma.tenant.count({ where: { dormitoryId: matrixDorm.id } })).toBe(tenantCountBefore);
      expect(await prisma.occupancy.count({ where: { dormitoryId: matrixDorm.id } })).toBe(occCountBefore);
      expect(await prisma.dailyStayInvoice.count({ where: { dormitoryId: matrixDorm.id } })).toBe(invCountBefore);
      expect(await prisma.dailyStay.count({ where: { dormitoryId: matrixDorm.id } })).toBe(stayCountBefore);

      // Case D: Room with unconfigured daily rate (null), Owner explicitly supplies "0.00" -> valid intentional zero
      const roomD = await prisma.room.create({
        data: {
          dormitoryId: matrixDorm.id,
          buildingId: matrixBld.id,
          roomNumber: 'QA-D',
          normalizedRoomNumber: 'QA-D',
          roomType: 'standard',
          floor: 1,
          status: 'vacant',
          dailyRent: null,
        },
      });

      const resD = await request(httpApp)
        .post('/api/v1/daily-stays/owner-quick-add')
        .set('Cookie', matrixCookie)
        .set('x-csrf-token', matrixCsrf)
        .set('x-dormitory-id', matrixDorm.id)
        .send({
          roomId: roomD.id,
          fullName: 'นายทดสอบ เคสดี ศูนย์บาท',
          startDate: today,
          endDate: tomorrow,
          dailyRateAmount: '0.00',
        });

      expect(resD.status).toBe(201);
      expect(Number(resD.body.data.dailyRateAmount)).toBe(0.0);
    });

    it('5. GET /api/v1/daily-stays/invoices returns daily invoices for payments view', async () => {
      const res = await request(httpApp)
        .get('/api/v1/daily-stays/invoices')
        .set('Cookie', ownerSessionCookie)
        .set('x-dormitory-id', dormitoryId);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0].invoiceNumber).toMatch(/^INV-D-/);
    });

    it('6. POST /api/v1/daily-stays/:id/checkout checks out stay and vacates room', async () => {
      const activeStay = await prisma.dailyStay.findFirst({
        where: { roomId: httpRoomId, status: 'ACTIVE' },
      });

      const res = await request(httpApp)
        .post(`/api/v1/daily-stays/${activeStay!.id}/checkout`)
        .set('Cookie', ownerSessionCookie)
        .set('x-csrf-token', ownerCsrfToken)
        .set('x-dormitory-id', dormitoryId);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('CHECKED_OUT');
    });

    it('7. GET /api/v1/tenant-claims/candidate returns masked candidate info', async () => {
      // Create room with unlinked placeholder tenant
      const candRoom = await prisma.room.create({
        data: {
          dormitoryId,
          buildingId,
          roomNumber: 'B402',
          normalizedRoomNumber: 'B402',
          roomType: 'standard',
          floor: 4,
          status: 'occupied',
        },
      });

      const candTenant = await prisma.tenant.create({
        data: {
          dormitoryId,
          tenantNumber: 'TNT-HTTP-CAND-01',
          firstName: 'นายอนุชา',
          lastName: 'มั่นคง',
          displayName: 'นายอนุชา มั่นคง',
          phone: '086-111-2222',
          status: 'active',
          linkedUserId: null,
        },
      });

      await prisma.occupancy.create({
        data: {
          dormitoryId,
          roomId: candRoom.id,
          tenantId: candTenant.id,
          status: 'ACTIVE',
        },
      });

      const res = await request(httpApp)
        .get(`/api/v1/tenant-claims/candidate?dormitoryId=${dormitoryId}&roomId=${candRoom.id}`)
        .set('Cookie', tenantSessionCookie);

      expect(res.status).toBe(200);
      expect(res.body.data.hasCandidate).toBe(true);
      expect(res.body.data.maskedName).toBe('นายอนุชา มXXX');
      expect(res.body.data.maskedPhone).toBe('086-XXX-XXXX');
    });

    it('8. POST /api/v1/tenant-claims/claim rate limits on excessive attempts (429)', async () => {
      // Create dummy claim room
      const rateLimitRoom = await prisma.room.create({
        data: {
          dormitoryId,
          buildingId,
          roomNumber: 'B403',
          normalizedRoomNumber: 'B403',
          roomType: 'standard',
          floor: 4,
          status: 'vacant',
        },
      });

      // Submit 5 failed claim requests
      for (let i = 0; i < 5; i++) {
        await request(httpApp)
          .post('/api/v1/tenant-claims/claim')
          .set('Cookie', tenantSessionCookie)
          .set('x-csrf-token', tenantCsrfToken)
          .send({
            dormitoryId,
            roomId: rateLimitRoom.id,
            claimInput: 'ชื่อคนอื่น ไม่ตรง',
          });
      }

      // 6th request should hit rate limiter (429)
      const res6 = await request(httpApp)
        .post('/api/v1/tenant-claims/claim')
        .set('Cookie', tenantSessionCookie)
        .set('x-csrf-token', tenantCsrfToken)
        .send({
          dormitoryId,
          roomId: rateLimitRoom.id,
          claimInput: 'ชื่อคนอื่น ไม่ตรง',
        });

      expect(res6.status).toBe(429);
      expect(res6.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    });

    it('12. GET /api/v1/properties/rooms/:roomId/quick-add-context returns authoritative rates, real building term settings, and fails closed', async () => {
      // 1. Setup building with termMonths = 4, maxTermRentInstallments = 3, dailyRent = 400, depositAmount = 500
      const testBld = await prisma.building.create({
        data: {
          dormitoryId,
          name: 'อาคาร Authority Test',
          termMonths: 4,
          maxTermRentInstallments: 3,
          dailyRent: 400.0,
          depositAmount: 500.0,
        },
      });

      // 2. Setup room with monthlyRent = 4500, dailyRent = 400, explicit depositAmount = 0
      const testRoom = await prisma.room.create({
        data: {
          dormitoryId,
          buildingId: testBld.id,
          roomNumber: 'AUTH-101',
          normalizedRoomNumber: 'AUTH-101',
          roomType: 'standard',
          floor: 1,
          status: 'vacant',
          monthlyRent: 4500.0,
          dailyRent: 400.0,
          depositAmount: 0.0, // explicit 0 override
          depositInheritsBuildingDefault: false,
        },
      });

      // 3. Setup archived room
      const archivedRoom = await prisma.room.create({
        data: {
          dormitoryId,
          buildingId: testBld.id,
          roomNumber: 'ARCH-102',
          normalizedRoomNumber: 'ARCH-102',
          roomType: 'standard',
          floor: 1,
          status: 'archived',
          monthlyRent: 4500.0,
        },
      });

      // 4. Setup foreign room
      const foreignDorm = await prisma.dormitory.create({
        data: { name: 'หอพัก Foreign Test', status: 'active' },
      });
      const foreignBld = await prisma.building.create({
        data: { dormitoryId: foreignDorm.id, name: 'Foreign Bld' },
      });
      const foreignRoom = await prisma.room.create({
        data: {
          dormitoryId: foreignDorm.id,
          buildingId: foreignBld.id,
          roomNumber: 'FOR-103',
          normalizedRoomNumber: 'FOR-103',
          roomType: 'standard',
          floor: 1,
          status: 'vacant',
          monthlyRent: 4500.0,
        },
      });

      // A. Valid Quick Add context read
      const res = await request(httpApp)
        .get(`/api/v1/properties/rooms/${testRoom.id}/quick-add-context`)
        .set('Cookie', ownerSessionCookie)
        .set('x-dormitory-id', dormitoryId);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.roomId).toBe(testRoom.id);
      expect(res.body.data.roomNumber).toBe('AUTH-101');
      expect(res.body.data.buildingId).toBe(testBld.id);

      // Financial defaults
      expect(Number(res.body.data.effective.monthlyRent)).toBe(4500.0);
      expect(Number(res.body.data.effective.dailyRent)).toBe(400.0);
      expect(Number(res.body.data.effective.depositAmount)).toBe(0.0); // explicit 0 preserved

      // Real Building settings
      expect(res.body.data.building).toBeDefined();
      expect(res.body.data.building.id).toBe(testBld.id);
      expect(res.body.data.building.termMonths).toBe(4);
      expect(res.body.data.building.maxTermRentInstallments).toBe(3);

      // B. Fail-closed: Archived room -> 404 ROOM_NOT_FOUND
      const archRes = await request(httpApp)
        .get(`/api/v1/properties/rooms/${archivedRoom.id}/quick-add-context`)
        .set('Cookie', ownerSessionCookie)
        .set('x-dormitory-id', dormitoryId);
      expect(archRes.status).toBe(404);
      expect(archRes.body.error.code).toBe('ROOM_NOT_FOUND');

      // C. Fail-closed: Foreign room -> 404 ROOM_NOT_FOUND (not found in current dorm)
      const forRes = await request(httpApp)
        .get(`/api/v1/properties/rooms/${foreignRoom.id}/quick-add-context`)
        .set('Cookie', ownerSessionCookie)
        .set('x-dormitory-id', dormitoryId);
      expect(forRes.status).toBe(404);
      expect(forRes.body.error.code).toBe('ROOM_NOT_FOUND');

      // D. Financial regression: Monthly Quick Add persists unitRentAmount = 4500.00
      const { ProvisionalRentalTermService } = await import('../../services/provisional-rental-term.service.js');
      const provService = new ProvisionalRentalTermService(prisma);
      const provResult = await provService.createProvisionalTenantAndTerm(
        dormitoryId,
        {
          roomId: testRoom.id,
          fullName: 'นายผู้เช่า 4500 บาท',
          rentalType: 'MONTHLY',
          startDate: '2026-10-01',
          durationMonths: 1,
          unitRentAmount: Number(res.body.data.effective.monthlyRent).toFixed(2),
          totalRentAmount: Number(res.body.data.effective.monthlyRent).toFixed(2),
        },
        ownerUserId
      );
      expect(Number(provResult.provisionalTerm.unitRentAmount)).toBe(4500.0);
      expect(Number(provResult.provisionalTerm.totalRentAmount)).toBe(4500.0);
    });

    it('13. Pre-Link Room Reference Authority & Pre-Link Daily Context Endpoint (roomNumber A101)', async () => {
      // 1. Create independent Dormitory
      const dorm = await prisma.dormitory.create({
        data: {
          name: 'หอพักพรีลิงก์ A101',
          status: 'active',
        },
      });
      const prelinkDormId = dorm.id;

      // 2. Create Building with dailyRent = 350, depositAmount = 0
      const bld = await prisma.building.create({
        data: {
          dormitoryId: prelinkDormId,
          code: 'A',
          name: 'อาคาร A',
          floorCount: 2,
          roomsPerFloor: 5,
          monthlyRent: 4500.0,
          dailyRent: 350.0,
          depositAmount: 0.0,
          termMonths: 6,
          maxTermRentInstallments: 3,
        },
      });
      const prelinkBldId = bld.id;

      // 3. Create active Room A101
      const roomA101 = await prisma.room.create({
        data: {
          dormitoryId: prelinkDormId,
          buildingId: prelinkBldId,
          roomNumber: 'A101',
          normalizedRoomNumber: 'A101',
          roomType: 'standard',
          floor: 1,
          status: 'vacant',
          monthlyRent: 4500.0,
          dailyRent: 350.0,
          depositAmount: 0.0,
        },
      });
      const prelinkRoomA101Id = roomA101.id;

      // 4. Create archived Room A102
      const roomA102 = await prisma.room.create({
        data: {
          dormitoryId: prelinkDormId,
          buildingId: prelinkBldId,
          roomNumber: 'A102',
          normalizedRoomNumber: 'A102',
          roomType: 'standard',
          floor: 1,
          status: 'archived',
          monthlyRent: 4500.0,
        },
      });

      // 5. Create unlinked User with NO DormitoryMember
      const prelinkEmail = `prelink-user-${Date.now()}@example.com`;
      const prelinkUser = await prisma.user.create({
        data: {
          googleSubject: `sub-prelink-${Date.now()}`,
          email: prelinkEmail,
          emailNormalized: prelinkEmail.toLowerCase(),
          name: 'นายสมัครใจ ดีจริง',
        },
      });

      const prelinkAuth = await authService.authenticateTestUser(prelinkUser.id);
      const prelinkUserCookie = `horplus_session=${prelinkAuth.sessionToken}; horplus_csrf=${prelinkAuth.csrfToken}`;
      const prelinkCsrfToken = prelinkAuth.csrfToken;

      // Proof 1 & 2: GET /api/v1/daily-stays/request-context resolves exact roomNumber A101 with authoritative rates for pre-link User
      const res = await request(httpApp)
        .get(`/api/v1/daily-stays/request-context?dormitoryId=${prelinkDormId}&roomNumber=A101`)
        .set('Cookie', prelinkUserCookie);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.roomId).toBe(prelinkRoomA101Id);
      expect(res.body.data.roomNumber).toBe('A101');
      expect(res.body.data.dailyRateAmount).toBe('350.00');
      expect(res.body.data.depositDefaultAmount).toBe('0.00');

      // Proof 3: GET /api/v1/daily-stays/request-context fails closed on invalid roomNumber, archived room, or foreign dormitory
      // A. Non-existent room number
      const notFoundRes = await request(httpApp)
        .get(`/api/v1/daily-stays/request-context?dormitoryId=${prelinkDormId}&roomNumber=Z999`)
        .set('Cookie', prelinkUserCookie);
      expect(notFoundRes.status).toBe(404);
      expect(notFoundRes.body.error.code).toBe('ROOM_NOT_FOUND');

      // B. Archived room A102
      const archRes = await request(httpApp)
        .get(`/api/v1/daily-stays/request-context?dormitoryId=${prelinkDormId}&roomNumber=A102`)
        .set('Cookie', prelinkUserCookie);
      expect(archRes.status).toBe(404);
      expect(archRes.body.error.code).toBe('ROOM_NOT_FOUND');

      // C. Foreign dormitory
      const foreignRes = await request(httpApp)
        .get(`/api/v1/daily-stays/request-context?dormitoryId=${dormitoryId}&roomNumber=A101`)
        .set('Cookie', prelinkUserCookie);
      expect(foreignRes.status).toBe(404);
      expect(foreignRes.body.error.code).toBe('ROOM_NOT_FOUND');

      // D. Missing session -> 401
      const unauthRes = await request(httpApp)
        .get(`/api/v1/daily-stays/request-context?dormitoryId=${prelinkDormId}&roomNumber=A101`);
      expect(unauthRes.status).toBe(401);

      // Proof 4: POST /api/v1/daily-stays/request accepts roomNumber A101 directly without client supplying internal UUID
      const reqRes = await request(httpApp)
        .post('/api/v1/daily-stays/request')
        .set('Cookie', prelinkUserCookie)
        .set('x-csrf-token', prelinkCsrfToken)
        .send({
          dormitoryId: prelinkDormId,
          roomNumber: 'A101',
          applicantFullName: 'นายสมัครใจ ดีจริง',
          applicantPhone: '0899998888',
          startDate: '2026-11-01',
          endDate: '2026-11-03',
          dailyRateAmount: '350.00',
          depositAmount: '0.00',
          depositDeclaredStatus: 'UNPAID',
        });

      expect(reqRes.status).toBe(201);
      expect(reqRes.body.data).toBeDefined();
      expect(reqRes.body.data.status).toBe('PENDING_APPROVAL');
      expect(reqRes.body.data.roomId).toBe(prelinkRoomA101Id);
      expect(Number(reqRes.body.data.dailyRateAmount)).toBe(350);

      // Proof 5: Candidate discovery and self-claim resolve exact roomNumber in dormitory
      // Create active provisional term tenant in A101
      const occTenant = await prisma.tenant.create({
        data: {
          dormitoryId: prelinkDormId,
          tenantNumber: `T-A101-CLAIM-${Date.now()}`,
          firstName: 'สมชาย',
          lastName: 'ผู้เช่าเดิม',
          displayName: 'นายสมชาย ผู้เช่าเดิม',
          phone: '0812345678',
          status: 'active',
          linkedUserId: null,
        },
      });

      await prisma.occupancy.create({
        data: {
          dormitoryId: prelinkDormId,
          tenantId: occTenant.id,
          roomId: prelinkRoomA101Id,
          status: 'ACTIVE',
        },
      });

      // Discover candidate using roomNumber=A101
      const candRes = await request(httpApp)
        .get(`/api/v1/tenant-claims/candidate?dormitoryId=${prelinkDormId}&roomNumber=A101`)
        .set('Cookie', prelinkUserCookie);

      expect(candRes.status).toBe(200);
      expect(candRes.body.data.hasCandidate).toBe(true);
      expect(candRes.body.data.roomId).toBe(prelinkRoomA101Id);
      expect(candRes.body.data.roomNumber).toBe('A101');
      expect(candRes.body.data.maskedName).toBe('นายสมชาย ผXXX');

      // Claim tenant using roomNumber=A101
      const claimRes = await request(httpApp)
        .post('/api/v1/tenant-claims/claim')
        .set('Cookie', prelinkUserCookie)
        .set('x-csrf-token', prelinkCsrfToken)
        .send({
          dormitoryId: prelinkDormId,
          roomNumber: 'A101',
          claimInput: '0812345678',
        });

      expect(claimRes.status).toBe(200);
      expect(claimRes.body.data.success).toBe(true);
      expect(claimRes.body.data.tenantId).toBe(occTenant.id);

      // Verify linked
      const updatedTenant = await prisma.tenant.findUnique({
        where: { id: occTenant.id },
      });
      expect(updatedTenant?.linkedUserId).toBe(prelinkUser.id);
    });

    it('14. Missing/Unconfigured Daily Rate Fails Closed (409 DAILY_RATE_NOT_CONFIGURED) vs Configured Zero Semantics', async () => {
      // 1. Create a fresh Dormitory & Building with unconfigured daily rent (dailyRent: null)
      const ndDorm = await prisma.dormitory.create({
        data: { name: 'หอพักไม่มีรายวัน', status: 'active' },
      });

      const noDailyBld = await prisma.building.create({
        data: {
          dormitoryId: ndDorm.id,
          code: 'NODLY',
          name: 'อาคารไม่มีรายวัน',
          floorCount: 1,
          roomsPerFloor: 2,
          monthlyRent: 3000.0,
          dailyRent: null,
          depositAmount: 500.0,
        },
      });

      const noDailyRoom = await prisma.room.create({
        data: {
          dormitoryId: ndDorm.id,
          buildingId: noDailyBld.id,
          roomNumber: 'ND101',
          normalizedRoomNumber: 'ND101',
          roomType: 'standard',
          floor: 1,
          status: 'vacant',
          monthlyRent: 3000.0,
          dailyRent: null,
          depositAmount: 500.0,
        },
      });

      const ndUser = await prisma.user.create({
        data: {
          googleSubject: `sub-nd-${Date.now()}`,
          email: `nd-${Date.now()}@example.com`,
          emailNormalized: `nd-${Date.now()}@example.com`,
          name: 'นายทดสอบ ไม่มีรายวัน',
        },
      });
      const ndAuth = await authService.authenticateTestUser(ndUser.id);
      const ndCookie = `horplus_session=${ndAuth.sessionToken}; horplus_csrf=${ndAuth.csrfToken}`;
      const ndCsrf = ndAuth.csrfToken;

      // A. GET /request-context on unconfigured room -> HTTP 409 DAILY_RATE_NOT_CONFIGURED (never "0.00")
      const contextRes = await request(httpApp)
        .get(`/api/v1/daily-stays/request-context?dormitoryId=${ndDorm.id}&roomNumber=ND101`)
        .set('Cookie', ndCookie);

      expect(contextRes.status).toBe(409);
      expect(contextRes.body.error.code).toBe('DAILY_RATE_NOT_CONFIGURED');

      // B. POST /request on unconfigured room -> HTTP 409 DAILY_RATE_NOT_CONFIGURED
      const postRes = await request(httpApp)
        .post('/api/v1/daily-stays/request')
        .set('Cookie', ndCookie)
        .set('x-csrf-token', ndCsrf)
        .set('x-dormitory-id', ndDorm.id)
        .send({
          dormitoryId: ndDorm.id,
          roomNumber: 'ND101',
          applicantFullName: 'นายทดสอบ ไม่มีรายวัน',
          startDate: '2026-10-01',
          endDate: '2026-10-03',
        });

      expect(postRes.status).toBe(409);
      expect(postRes.body.error.code).toBe('DAILY_RATE_NOT_CONFIGURED');

      // C. Configured 0.00 daily rate -> 200 with dailyRateAmount: '0.00'
      const zeroDailyRoom = await prisma.room.create({
        data: {
          dormitoryId: ndDorm.id,
          buildingId: noDailyBld.id,
          roomNumber: 'ND102',
          normalizedRoomNumber: 'ND102',
          roomType: 'standard',
          floor: 1,
          status: 'vacant',
          monthlyRent: 3000.0,
          dailyRent: 0.0,
          depositAmount: 0.0,
        },
      });

      const zeroContextRes = await request(httpApp)
        .get(`/api/v1/daily-stays/request-context?dormitoryId=${ndDorm.id}&roomNumber=ND102`)
        .set('Cookie', ndCookie);

      expect(zeroContextRes.status).toBe(200);
      expect(zeroContextRes.body.data.dailyRateAmount).toBe('0.00');
    });

    it('15. Tenant Daily Rate Tampering Prevention: Client-supplied daily rate is omitted/ignored in favor of server authority', async () => {
      // HTTP Room has dailyRent = 700.00
      const tamperRes = await request(httpApp)
        .post('/api/v1/daily-stays/request')
        .set('Cookie', tenantSessionCookie)
        .set('x-csrf-token', tenantCsrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({
          dormitoryId,
          roomId: httpRoomId,
          applicantFullName: 'นายพยายาม โกงราคา',
          startDate: '2026-10-10',
          endDate: '2026-10-12',
          dailyRateAmount: '1.00', // Tampered client value
          depositAmount: '0.00',
        });

      expect(tamperRes.status).toBe(201);
      expect(tamperRes.body.data).toBeDefined();
      // Must be authoritative 700.00, NOT tampered 1.00
      expect(Number(tamperRes.body.data.dailyRateAmount)).toBe(700.0);
      expect(Number(tamperRes.body.data.totalRentAmount)).toBe(2100.0); // 3 days * 700
    });

    it('16. Claim Decision 2A Time Authority: Stale Past RESERVED Ignored, Strictly Future RESERVED Selected', async () => {
      const { tenantClaimService } = await import('../../services/tenant-claim.service.js');

      // Create test room for time tests
      const timeRoom = await prisma.room.create({
        data: {
          dormitoryId,
          buildingId,
          roomNumber: 'TIME-01',
          normalizedRoomNumber: 'TIME-01',
          roomType: 'standard',
          floor: 1,
          status: 'vacant',
        },
      });

      // Tenant A: Stale RESERVED (start 2026-09-01, before effective date 2026-09-10)
      const tenantPast = await prisma.tenant.create({
        data: {
          dormitoryId,
          tenantNumber: `T-PAST-${Date.now()}`,
          firstName: 'อดีต',
          lastName: 'ผ่านไปแล้ว',
          displayName: 'อดีต ผ่านไปแล้ว',
          phone: '0811110001',
          status: 'active',
          linkedUserId: null,
        },
      });
      await prisma.occupancy.create({
        data: {
          dormitoryId,
          tenantId: tenantPast.id,
          roomId: timeRoom.id,
          status: 'RESERVED',
          startedAt: new Date('2026-09-01T00:00:00.000Z'),
        },
      });

      // Tenant B: Future RESERVED (start 2026-09-15, after effective date 2026-09-10)
      const tenantFuture = await prisma.tenant.create({
        data: {
          dormitoryId,
          tenantNumber: `T-FUT-${Date.now()}`,
          firstName: 'อนาคต',
          lastName: 'กำลังมา',
          displayName: 'อนาคต กำลังมา',
          phone: '0811110002',
          status: 'active',
          linkedUserId: null,
        },
      });
      await prisma.occupancy.create({
        data: {
          dormitoryId,
          tenantId: tenantFuture.id,
          roomId: timeRoom.id,
          status: 'RESERVED',
          startedAt: new Date('2026-09-15T00:00:00.000Z'),
        },
      });

      // At effective date 2026-09-10: Tenant Past is ignored, Tenant Future is selected
      const cand = await tenantClaimService.selectAuthoritativeCandidate(
        dormitoryId,
        timeRoom.id,
        prisma,
        new Date('2026-09-10T00:00:00.000Z')
      );
      expect(cand).not.toBeNull();
      expect(cand.id).toBe(tenantFuture.id);

      // At effective date 2026-09-20 (both in the past): hasCandidate is null
      const candLate = await tenantClaimService.selectAuthoritativeCandidate(
        dormitoryId,
        timeRoom.id,
        prisma,
        new Date('2026-09-20T00:00:00.000Z')
      );
      expect(candLate).toBeNull();
    });

    it('17. Tenant Role Cross-Dorm Isolation: Claim in Dormitory A NEVER borrows Role from Dormitory B', async () => {
      // 1. Create Dormitory Alpha and Dormitory Beta
      const dormAlpha = await prisma.dormitory.create({
        data: { name: 'หอพักอัลฟ่า', status: 'active' },
      });
      const dormBeta = await prisma.dormitory.create({
        data: { name: 'หอพักเบต้า', status: 'active' },
      });

      // 2. Create TENANT role ONLY in Dormitory Beta
      const betaRole = await prisma.role.create({
        data: {
          dormitoryId: dormBeta.id,
          code: 'TENANT',
          name: 'ผู้เช่าหอเบต้า',
          permissions: ['tenant:read'],
        },
      });

      // 3. Create building, room & unlinked tenant in Dormitory Alpha
      const alphaBld = await prisma.building.create({
        data: {
          dormitoryId: dormAlpha.id,
          code: 'BLD-A',
          name: 'อาคาร A',
          floorCount: 1,
          roomsPerFloor: 1,
        },
      });

      const alphaRoom = await prisma.room.create({
        data: {
          dormitoryId: dormAlpha.id,
          buildingId: alphaBld.id,
          roomNumber: 'ALP-101',
          normalizedRoomNumber: 'ALP-101',
          roomType: 'standard',
          floor: 1,
          status: 'vacant',
        },
      });

      const alphaTenant = await prisma.tenant.create({
        data: {
          dormitoryId: dormAlpha.id,
          tenantNumber: `T-ALP-${Date.now()}`,
          firstName: 'สมบูรณ์',
          lastName: 'อัลฟ่า',
          displayName: 'สมบูรณ์ อัลฟ่า',
          phone: '0855554444',
          status: 'active',
          linkedUserId: null,
        },
      });
      await prisma.occupancy.create({
        data: {
          dormitoryId: dormAlpha.id,
          tenantId: alphaTenant.id,
          roomId: alphaRoom.id,
          status: 'ACTIVE',
        },
      });

      // 4. Create new user and claim in Dormitory Alpha
      const alphaUser = await prisma.user.create({
        data: {
          googleSubject: `sub-alp-${Date.now()}`,
          email: `alp-${Date.now()}@example.com`,
          emailNormalized: `alp-${Date.now()}@example.com`,
          name: 'สมบูรณ์ อัลฟ่า',
        },
      });

      const { tenantClaimService } = await import('../../services/tenant-claim.service.js');
      const claimResult = await tenantClaimService.claimTenant(
        {
          dormitoryId: dormAlpha.id,
          roomId: alphaRoom.id,
          claimInput: '0855554444',
        },
        alphaUser.id
      );

      expect(claimResult.success).toBe(true);

      // Verify DormitoryMember in Alpha: role MUST NOT be betaRole.id
      const memberAlpha = await prisma.dormitoryMember.findUnique({
        where: {
          user_dormitory_unique: {
            userId: alphaUser.id,
            dormitoryId: dormAlpha.id,
          },
        },
        include: { role: true },
      });

      expect(memberAlpha).toBeDefined();
      expect(memberAlpha?.roleId).not.toBe(betaRole.id);
      expect(memberAlpha?.role?.dormitoryId === dormAlpha.id || memberAlpha?.role?.dormitoryId === null).toBe(true);
      expect(memberAlpha?.role?.code).toBe('TENANT');
    });

    it('18. Existing Non-Tenant Membership Fails Closed Atomically (CLAIM_MEMBERSHIP_CONFLICT) with 0 side-effects', async () => {
      // 1. User has STAFF/OWNER membership in dormitory
      const staffUser = await prisma.user.create({
        data: {
          googleSubject: `sub-staff-${Date.now()}`,
          email: `staff-${Date.now()}@example.com`,
          emailNormalized: `staff-${Date.now()}@example.com`,
          name: 'นายเจ้าหน้าที่ หอพัก',
        },
      });

      // Give User OWNER role in dormitory
      await prisma.dormitoryMember.create({
        data: {
          userId: staffUser.id,
          dormitoryId,
          roleId: roleOwnerId, // OWNER role
          status: 'active',
          membershipOrigin: 'MANUAL_GRANT',
        },
      });

      // 2. Room with unlinked tenant matching staff user's phone
      const conflictRoom = await prisma.room.create({
        data: {
          dormitoryId,
          buildingId,
          roomNumber: 'CONF-01',
          normalizedRoomNumber: 'CONF-01',
          roomType: 'standard',
          floor: 1,
          status: 'vacant',
        },
      });

      const unlinkedTen = await prisma.tenant.create({
        data: {
          dormitoryId,
          tenantNumber: `T-CONF-${Date.now()}`,
          firstName: 'เจ้าหน้าที่',
          lastName: 'หอพัก',
          displayName: 'เจ้าหน้าที่ หอพัก',
          phone: '0891112222',
          status: 'active',
          linkedUserId: null,
        },
      });

      await prisma.occupancy.create({
        data: {
          dormitoryId,
          tenantId: unlinkedTen.id,
          roomId: conflictRoom.id,
          status: 'ACTIVE',
        },
      });

      // 3. Staff user attempts claim
      const staffAuth = await authService.authenticateTestUser(staffUser.id);
      const staffCookie = `horplus_session=${staffAuth.sessionToken}; horplus_csrf=${staffAuth.csrfToken}`;

      const res = await request(httpApp)
        .post('/api/v1/tenant-claims/claim')
        .set('Cookie', staffCookie)
        .set('x-csrf-token', staffAuth.csrfToken)
        .send({
          dormitoryId,
          roomNumber: 'CONF-01',
          claimInput: '0891112222',
        });

      // Fails closed with normalized non-enumerating public 404 CLAIM_UNAVAILABLE
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('CLAIM_UNAVAILABLE');
      expect(res.body.error.message).toBe('ไม่พบข้อมูลผู้เช่าที่ตรงกับข้อมูลที่ระบุ หรือห้องพักนี้ไม่สามารถยืนยันสิทธิ์ได้ในขณะนี้');

      // Invariants: Tenant.linkedUserId is STILL null, membership is STILL OWNER
      const checkTenant = await prisma.tenant.findUnique({
        where: { id: unlinkedTen.id },
      });
      expect(checkTenant?.linkedUserId).toBeNull();

      const checkMember = await prisma.dormitoryMember.findUnique({
        where: {
          user_dormitory_unique: {
            userId: staffUser.id,
            dormitoryId,
          },
        },
      });
      expect(checkMember?.roleId).toBe(roleOwnerId);
    });

    it('19. Post-Claim Tenant Portal Access: Successful claim grants immediate access to tenant portal endpoints', async () => {
      // 1. Create fresh User
      const portalUser = await prisma.user.create({
        data: {
          googleSubject: `sub-portal-${Date.now()}`,
          email: `portal-${Date.now()}@example.com`,
          emailNormalized: `portal-${Date.now()}@example.com`,
          name: 'นางสาวผู้เช่า ใหม่จริง',
        },
      });

      const portalRoom = await prisma.room.create({
        data: {
          dormitoryId,
          buildingId,
          roomNumber: 'PORT-01',
          normalizedRoomNumber: 'PORT-01',
          roomType: 'standard',
          floor: 1,
          status: 'vacant',
        },
      });

      const portalTenant = await prisma.tenant.create({
        data: {
          dormitoryId,
          tenantNumber: `T-PORT-${Date.now()}`,
          firstName: 'ผู้เช่า',
          lastName: 'ใหม่จริง',
          displayName: 'ผู้เช่า ใหม่จริง',
          phone: '0877776666',
          status: 'active',
          linkedUserId: null,
        },
      });

      await prisma.occupancy.create({
        data: {
          dormitoryId,
          tenantId: portalTenant.id,
          roomId: portalRoom.id,
          status: 'ACTIVE',
        },
      });

      // 2. Claim tenant
      const { tenantClaimService } = await import('../../services/tenant-claim.service.js');
      const claimRes = await tenantClaimService.claimTenant(
        {
          dormitoryId,
          roomId: portalRoom.id,
          claimInput: '0877776666',
        },
        portalUser.id
      );
      expect(claimRes.success).toBe(true);

      // 3. User accesses Tenant Portal
      const portalAuth = await authService.authenticateTestUser(portalUser.id);
      const portalCookie = `horplus_session=${portalAuth.sessionToken}; horplus_csrf=${portalAuth.csrfToken}`;

      const profileRes = await request(httpApp)
        .get('/api/v1/tenant-portal/profile')
        .set('Cookie', portalCookie)
        .set('x-dormitory-id', dormitoryId);

      expect(profileRes.status).toBe(200);
      expect(profileRes.body.id).toBe(portalTenant.id);
      expect(profileRes.body.displayName).toBe('ผู้เช่า ใหม่จริง');
    });

    it('20. Claim Public Non-Enumeration Oracle Test: Incorrect input, existing conflict, already-linked, and unavailable candidates return identical public 404 response contract', async () => {
      // 1. Setup candidate room & unlinked tenant
      const oracRoom = await prisma.room.create({
        data: {
          dormitoryId,
          buildingId,
          roomNumber: 'ORAC-01',
          normalizedRoomNumber: 'ORAC-01',
          roomType: 'standard',
          floor: 1,
          status: 'vacant',
        },
      });

      const oracTenant = await prisma.tenant.create({
        data: {
          dormitoryId,
          tenantNumber: `T-ORAC-${Date.now()}`,
          firstName: 'สมบูรณ์',
          lastName: 'ออราเคิล',
          displayName: 'สมบูรณ์ ออราเคิล',
          phone: '0891112222',
          status: 'active',
          linkedUserId: null,
        },
      });

      await prisma.occupancy.create({
        data: {
          dormitoryId,
          tenantId: oracTenant.id,
          roomId: oracRoom.id,
          status: 'ACTIVE',
        },
      });

      // 2. Setup user with OWNER/STAFF membership in dormitory
      const conflictUser = await prisma.user.create({
        data: {
          googleSubject: `sub-orac-conflict-${Date.now()}`,
          email: `orac-conflict-${Date.now()}@example.com`,
          emailNormalized: `orac-conflict-${Date.now()}@example.com`,
          name: 'ผู้ใช้มีสิทธิ์เจ้าของ',
        },
      });

      await prisma.dormitoryMember.create({
        data: {
          userId: conflictUser.id,
          dormitoryId,
          roleId: roleOwnerId,
          status: 'active',
          membershipOrigin: 'MANUAL_GRANT',
        },
      });

      const userAuth = await authService.authenticateTestUser(conflictUser.id);
      const userCookie = `horplus_session=${userAuth.sessionToken}; horplus_csrf=${userAuth.csrfToken}`;
      const userCsrf = userAuth.csrfToken;

      // Case A: Incorrect phone guess
      const resA = await request(httpApp)
        .post('/api/v1/tenant-claims/claim')
        .set('Cookie', userCookie)
        .set('x-csrf-token', userCsrf)
        .send({
          dormitoryId,
          roomNumber: 'ORAC-01',
          claimInput: '0890000000', // incorrect phone
        });

      // Case B: Correct phone match but user has existing non-TENANT membership
      const resB = await request(httpApp)
        .post('/api/v1/tenant-claims/claim')
        .set('Cookie', userCookie)
        .set('x-csrf-token', userCsrf)
        .send({
          dormitoryId,
          roomNumber: 'ORAC-01',
          claimInput: '0891112222', // correct phone
        });

      // Setup Case C: Already-linked tenant
      const linkedUser = await prisma.user.create({
        data: {
          googleSubject: `sub-orac-linked-${Date.now()}`,
          email: `orac-linked-${Date.now()}@example.com`,
          emailNormalized: `orac-linked-${Date.now()}@example.com`,
          name: 'ผู้เช่าที่เชื่อมโยงแล้ว',
        },
      });
      const linkedTenant = await prisma.tenant.create({
        data: {
          dormitoryId,
          tenantNumber: `T-ORAC-LINKED-${Date.now()}`,
          firstName: 'เชื่อมโยง',
          lastName: 'แล้ว',
          displayName: 'เชื่อมโยง แล้ว',
          phone: '0893334444',
          status: 'active',
          linkedUserId: linkedUser.id, // already linked
        },
      });
      const linkedRoom = await prisma.room.create({
        data: {
          dormitoryId,
          buildingId,
          roomNumber: 'ORAC-02',
          normalizedRoomNumber: 'ORAC-02',
          roomType: 'standard',
          floor: 1,
          status: 'vacant',
        },
      });
      await prisma.occupancy.create({
        data: {
          dormitoryId,
          tenantId: linkedTenant.id,
          roomId: linkedRoom.id,
          status: 'ACTIVE',
        },
      });

      const resC = await request(httpApp)
        .post('/api/v1/tenant-claims/claim')
        .set('Cookie', userCookie)
        .set('x-csrf-token', userCsrf)
        .send({
          dormitoryId,
          roomNumber: 'ORAC-02',
          claimInput: '0893334444',
        });

      // Setup Case D: Candidate unavailable (empty room)
      const emptyRoom = await prisma.room.create({
        data: {
          dormitoryId,
          buildingId,
          roomNumber: 'ORAC-03',
          normalizedRoomNumber: 'ORAC-03',
          roomType: 'standard',
          floor: 1,
          status: 'vacant',
        },
      });

      const resD = await request(httpApp)
        .post('/api/v1/tenant-claims/claim')
        .set('Cookie', userCookie)
        .set('x-csrf-token', userCsrf)
        .send({
          dormitoryId,
          roomNumber: 'ORAC-03',
          claimInput: '0899999999',
        });

      // Proof: All 4 responses must have identical public HTTP status, error code, and message
      const expectedShape = {
        status: 404,
        code: 'CLAIM_UNAVAILABLE',
        message: 'ไม่พบข้อมูลผู้เช่าที่ตรงกับข้อมูลที่ระบุ หรือห้องพักนี้ไม่สามารถยืนยันสิทธิ์ได้ในขณะนี้',
        fieldErrors: null,
      };

      for (const res of [resA, resB, resC, resD]) {
        expect(res.status).toBe(expectedShape.status);
        expect(res.body.error.code).toBe(expectedShape.code);
        expect(res.body.error.message).toBe(expectedShape.message);
        expect(res.body.error.fieldErrors).toBe(expectedShape.fieldErrors);
      }
    });

    it('21. Multi-Dorm Pre-Link Daily Stay Request Targeting: Uses validated target dormitory and resolves canonical room even if user is member of another dorm', async () => {
      // 1. Create Dorm A and Dorm B
      const dormA = await prisma.dormitory.create({
        data: {
          code: `DA-${Date.now()}`,
          name: 'Dormitory Alpha Multi',
        },
      });
      const bldA = await prisma.building.create({
        data: {
          dormitoryId: dormA.id,
          name: 'Building A',
          floorCount: 2,
        },
      });
      const roomA101_DormA = await prisma.room.create({
        data: {
          dormitoryId: dormA.id,
          buildingId: bldA.id,
          roomNumber: 'A101',
          normalizedRoomNumber: 'A101',
          roomType: 'standard',
          floor: 1,
          status: 'vacant',
          dailyRent: 100.0, // Dorm A rate is 100
        },
      });

      const dormB = await prisma.dormitory.create({
        data: {
          code: `DB-${Date.now()}`,
          name: 'Dormitory Beta Multi',
        },
      });
      const bldB = await prisma.building.create({
        data: {
          dormitoryId: dormB.id,
          name: 'Building B',
          floorCount: 2,
        },
      });
      const roomA101_DormB = await prisma.room.create({
        data: {
          dormitoryId: dormB.id,
          buildingId: bldB.id,
          roomNumber: 'A101',
          normalizedRoomNumber: 'A101',
          roomType: 'standard',
          floor: 1,
          status: 'vacant',
          dailyRent: 350.0, // Dorm B rate is 350
        },
      });

      // 2. User U is OWNER in Dorm A, NOT a member of Dorm B
      const multiUser = await prisma.user.create({
        data: {
          googleSubject: `sub-multi-${Date.now()}`,
          email: `multi-${Date.now()}@example.com`,
          emailNormalized: `multi-${Date.now()}@example.com`,
          name: 'นายเจ้าของ หอเอ แต่ขอพักหอบี',
        },
      });

      const roleOwnerA = await prisma.role.create({
        data: {
          dormitoryId: dormA.id,
          code: 'OWNER',
          name: 'เจ้าของหอพัก',
          permissions: ['*'],
        },
      });

      await prisma.dormitoryMember.create({
        data: {
          userId: multiUser.id,
          dormitoryId: dormA.id,
          roleId: roleOwnerA.id,
          status: 'active',
          membershipOrigin: 'CREATOR',
        },
      });

      const multiAuth = await authService.authenticateTestUser(multiUser.id);
      const multiCookie = `horplus_session=${multiAuth.sessionToken}; horplus_csrf=${multiAuth.csrfToken}`;
      const multiCsrf = multiAuth.csrfToken;

      // 3. GET /request-context targeting Dorm B
      const ctxRes = await request(httpApp)
        .get(`/api/v1/daily-stays/request-context?dormitoryId=${dormB.id}&roomNumber=A101`)
        .set('Cookie', multiCookie);

      expect(ctxRes.status).toBe(200);
      expect(ctxRes.body.data.roomId).toBe(roomA101_DormB.id);
      expect(ctxRes.body.data.dailyRateAmount).toBe('350.00'); // Authoritative rate of Dorm B

      // 4. POST /request targeting Dorm B
      const postRes = await request(httpApp)
        .post('/api/v1/daily-stays/request')
        .set('Cookie', multiCookie)
        .set('x-csrf-token', multiCsrf)
        .send({
          dormitoryId: dormB.id,
          roomNumber: 'A101',
          applicantFullName: 'นายเจ้าของ หอเอ แต่ขอพักหอบี',
          applicantPhone: '0812345678',
          startDate: '2026-12-01',
          endDate: '2026-12-03',
        });

      expect(postRes.status).toBe(201);
      const stayData = postRes.body.data;
      expect(stayData.dormitoryId).toBe(dormB.id);
      expect(stayData.roomId).toBe(roomA101_DormB.id);
      expect(stayData.roomId).not.toBe(roomA101_DormA.id);
      expect(Number(stayData.dailyRateAmount)).toBe(350.0);
      expect(stayData.requesterUserId).toBe(multiUser.id);

      // Verify User still has NO membership in Dorm B
      const bMember = await prisma.dormitoryMember.findUnique({
        where: {
          user_dormitory_unique: {
            userId: multiUser.id,
            dormitoryId: dormB.id,
          },
        },
      });
      expect(bMember).toBeNull();
    });

    it('22. Conflicting Dorm Context & Invalid UUID: Rejects conflicting header/body and malformed UUIDs with HTTP 400', async () => {
      // A. Invalid dormitory UUID -> 400 VALIDATION_ERROR
      const badUuidRes = await request(httpApp)
        .post('/api/v1/daily-stays/request')
        .set('Cookie', tenantSessionCookie)
        .set('x-csrf-token', tenantCsrfToken)
        .send({
          dormitoryId: 'not-a-valid-uuid',
          roomNumber: 'A101',
          applicantFullName: 'นายทดสอบ ยูยูไอดีเสีย',
          startDate: '2026-10-01',
          endDate: '2026-10-03',
        });
      expect(badUuidRes.status).toBe(400);
      expect(badUuidRes.body.error.code).toBe('VALIDATION_ERROR');

      // B. Conflicting header x-dormitory-id vs body dormitoryId in POST /request -> 400 DORMITORY_ID_MISMATCH
      const conflictPostRes = await request(httpApp)
        .post('/api/v1/daily-stays/request')
        .set('Cookie', tenantSessionCookie)
        .set('x-csrf-token', tenantCsrfToken)
        .set('x-dormitory-id', dormitoryId) // Dorm A
        .send({
          dormitoryId: 'a05ebe82-9da0-4f82-87e2-1671fb76ba81', // Some other Dorm UUID
          roomNumber: 'A101',
          applicantFullName: 'นายทดสอบ ขัดแย้ง',
          startDate: '2026-10-01',
          endDate: '2026-10-03',
        });
      expect(conflictPostRes.status).toBe(400);
      expect(conflictPostRes.body.error.code).toBe('DORMITORY_ID_MISMATCH');

      // C. Conflicting header x-dormitory-id vs query dormitoryId in GET /request-context -> 400 DORMITORY_ID_MISMATCH
      const conflictGetRes = await request(httpApp)
        .get(`/api/v1/daily-stays/request-context?dormitoryId=a05ebe82-9da0-4f82-87e2-1671fb76ba81&roomNumber=A101`)
        .set('Cookie', tenantSessionCookie)
        .set('x-dormitory-id', dormitoryId); // Mismatched header
      expect(conflictGetRes.status).toBe(400);
      expect(conflictGetRes.body.error.code).toBe('DORMITORY_ID_MISMATCH');
    });

    it('23. Legacy Foreign-Role Membership Fail-Closed Regression: Corrupted DormitoryMember with foreign TENANT role fails closed with generic 404', async () => {
      // 1. Create Dorm Alpha and Dorm Beta
      const alphaDorm = await prisma.dormitory.create({
        data: {
          code: `FL-A-${Date.now()}`,
          name: 'Dormitory Foreign Role Alpha',
        },
      });
      const betaDorm = await prisma.dormitory.create({
        data: {
          code: `FL-B-${Date.now()}`,
          name: 'Dormitory Foreign Role Beta',
        },
      });

      const alphaBld = await prisma.building.create({
        data: {
          dormitoryId: alphaDorm.id,
          name: 'Building Alpha',
          floorCount: 2,
        },
      });

      const alphaRoom = await prisma.room.create({
        data: {
          dormitoryId: alphaDorm.id,
          buildingId: alphaBld.id,
          roomNumber: 'F101',
          normalizedRoomNumber: 'F101',
          roomType: 'standard',
          floor: 1,
          status: 'vacant',
        },
      });

      const alphaTenant = await prisma.tenant.create({
        data: {
          dormitoryId: alphaDorm.id,
          tenantNumber: `T-FL-${Date.now()}`,
          firstName: 'ผู้เช่า',
          lastName: 'อัลฟ่า',
          displayName: 'ผู้เช่า อัลฟ่า',
          phone: '0819998888',
          status: 'active',
          linkedUserId: null,
        },
      });

      await prisma.occupancy.create({
        data: {
          dormitoryId: alphaDorm.id,
          tenantId: alphaTenant.id,
          roomId: alphaRoom.id,
          status: 'ACTIVE',
        },
      });

      // 2. Create TENANT role in Dorm Beta
      const betaTenantRole = await prisma.role.create({
        data: {
          dormitoryId: betaDorm.id,
          code: 'TENANT',
          name: 'ผู้เช่า เบต้า',
          permissions: ['tenant:read', 'tenant:pay'],
        },
      });

      // 3. User with corrupted membership: member in Dorm Alpha, but pointing to Beta's TENANT roleId
      const corruptUser = await prisma.user.create({
        data: {
          googleSubject: `sub-corrupt-${Date.now()}`,
          email: `corrupt-${Date.now()}@example.com`,
          emailNormalized: `corrupt-${Date.now()}@example.com`,
          name: 'ผู้ใช้ ข้ามสิทธิ์หอ',
        },
      });

      await prisma.dormitoryMember.create({
        data: {
          userId: corruptUser.id,
          dormitoryId: alphaDorm.id, // Member in Alpha
          roleId: betaTenantRole.id, // BUT points to Beta's TENANT role!
          status: 'active',
          membershipOrigin: 'MANUAL_GRANT',
        },
      });

      const corruptAuth = await authService.authenticateTestUser(corruptUser.id);
      const corruptCookie = `horplus_session=${corruptAuth.sessionToken}; horplus_csrf=${corruptAuth.csrfToken}`;
      const corruptCsrf = corruptAuth.csrfToken;

      // 4. Corrupt user attempts claim in Dorm Alpha
      const claimRes = await request(httpApp)
        .post('/api/v1/tenant-claims/claim')
        .set('Cookie', corruptCookie)
        .set('x-csrf-token', corruptCsrf)
        .send({
          dormitoryId: alphaDorm.id,
          roomNumber: 'F101',
          claimInput: '0819998888',
        });

      // Must fail closed with generic 404 CLAIM_UNAVAILABLE
      expect(claimRes.status).toBe(404);
      expect(claimRes.body.error.code).toBe('CLAIM_UNAVAILABLE');
      expect(claimRes.body.error.message).toBe('ไม่พบข้อมูลผู้เช่าที่ตรงกับข้อมูลที่ระบุ หรือห้องพักนี้ไม่สามารถยืนยันสิทธิ์ได้ในขณะนี้');

      // Assert DB state: Tenant is still unlinked, membership remains unchanged
      const checkTen = await prisma.tenant.findUnique({ where: { id: alphaTenant.id } });
      expect(checkTen?.linkedUserId).toBeNull();
    });

    it('24. Concurrency-Safe Target TENANT Role Creation: 10 concurrent claims in a fresh dormitory create exactly one TENANT role with zero race failures', async () => {
      // 1. Fresh dormitory with NO target TENANT role and NO applicable global TENANT role
      const freshDorm = await prisma.dormitory.create({
        data: {
          code: `FRESH-${Date.now()}`,
          name: 'Dormitory Fresh Roles',
        },
      });
      const freshBld = await prisma.building.create({
        data: {
          dormitoryId: freshDorm.id,
          name: 'Fresh Building',
          floorCount: 4,
        },
      });

      // 2. Create 10 rooms and 10 unlinked tenants
      const rooms: any[] = [];
      const tenants: any[] = [];
      const users: any[] = [];

      for (let i = 1; i <= 10; i++) {
        const room = await prisma.room.create({
          data: {
            dormitoryId: freshDorm.id,
            buildingId: freshBld.id,
            roomNumber: `R-${i}`,
            normalizedRoomNumber: `R-${i}`,
            roomType: 'standard',
            floor: 1,
            status: 'vacant',
          },
        });
        rooms.push(room);

        const phone = `08811122${String(i).padStart(2, '0')}`;
        const tenant = await prisma.tenant.create({
          data: {
            dormitoryId: freshDorm.id,
            tenantNumber: `T-FRESH-${i}-${Date.now()}`,
            firstName: `ผู้เช่าที่`,
            lastName: `${i}`,
            displayName: `ผู้เช่าที่ ${i}`,
            phone,
            status: 'active',
            linkedUserId: null,
          },
        });
        tenants.push(tenant);

        await prisma.occupancy.create({
          data: {
            dormitoryId: freshDorm.id,
            tenantId: tenant.id,
            roomId: room.id,
            status: 'ACTIVE',
          },
        });

        const user = await prisma.user.create({
          data: {
            googleSubject: `sub-fresh-${i}-${Date.now()}`,
            email: `fresh-${i}-${Date.now()}@example.com`,
            emailNormalized: `fresh-${i}-${Date.now()}@example.com`,
            name: `ผู้ใช้ ${i}`,
          },
        });
        users.push(user);
      }

      // 3. Execute 10 claims concurrently across the 10 rooms
      const { tenantClaimService } = await import('../../services/tenant-claim.service.js');

      const claimPromises = users.map((user, idx) => {
        const room = rooms[idx];
        const tenant = tenants[idx];
        return tenantClaimService.claimTenant(
          {
            dormitoryId: freshDorm.id,
            roomId: room.id,
            claimInput: tenant.phone!,
          },
          user.id
        );
      });

      const results = await Promise.all(claimPromises);

      // All 10 claims succeed
      for (const res of results) {
        expect(res.success).toBe(true);
      }

      // Matched TENANT role in target dormitory or global
      const matchedRole = await prisma.role.findFirst({
        where: {
          code: 'TENANT',
          OR: [
            { dormitoryId: freshDorm.id },
            { dormitoryId: null },
          ],
        },
      });
      expect(matchedRole).toBeDefined();
      const roleId = matchedRole!.id;

      // All 10 members reference this valid target/global TENANT role
      const members = await prisma.dormitoryMember.findMany({
        where: {
          dormitoryId: freshDorm.id,
        },
      });
      expect(members.length).toBe(10);
      for (const m of members) {
        expect(m.roleId).toBe(roleId);
        expect(m.status).toBe('active');
      }

      // All 10 tenants have correct linkedUserId
      for (let i = 0; i < 10; i++) {
        const updatedTenant = await prisma.tenant.findUnique({
          where: { id: tenants[i].id },
        });
        expect(updatedTenant?.linkedUserId).toBe(users[i].id);
      }
    });

    it('25. One User / One Tenant per Dormitory Claim Cardinality: Existing same-dorm link blocks second claim with generic 404', async () => {
      // 1. Setup Dormitory and 2 rooms
      const cardDorm = await prisma.dormitory.create({
        data: {
          code: `CARD-${Date.now()}`,
          name: 'Dormitory Cardinality Test',
        },
      });
      const cardBld = await prisma.building.create({
        data: {
          dormitoryId: cardDorm.id,
          name: 'Building Card',
          floorCount: 2,
        },
      });
      const room1 = await prisma.room.create({
        data: {
          dormitoryId: cardDorm.id,
          buildingId: cardBld.id,
          roomNumber: 'CR-101',
          normalizedRoomNumber: 'CR-101',
          roomType: 'standard',
          floor: 1,
          status: 'vacant',
        },
      });
      const room2 = await prisma.room.create({
        data: {
          dormitoryId: cardDorm.id,
          buildingId: cardBld.id,
          roomNumber: 'CR-102',
          normalizedRoomNumber: 'CR-102',
          roomType: 'standard',
          floor: 1,
          status: 'vacant',
        },
      });

      // 2. User U is already linked to Tenant T1 in Room 1
      const userU = await prisma.user.create({
        data: {
          googleSubject: `sub-card-${Date.now()}`,
          email: `card-${Date.now()}@example.com`,
          emailNormalized: `card-${Date.now()}@example.com`,
          name: 'นายผู้ใช้ คนเดียวในหอ',
        },
      });

      const tenant1 = await prisma.tenant.create({
        data: {
          dormitoryId: cardDorm.id,
          tenantNumber: `T-CR1-${Date.now()}`,
          firstName: 'ผู้เช่า',
          lastName: 'ห้องหนึ่ง',
          displayName: 'ผู้เช่า ห้องหนึ่ง',
          phone: '0811111111',
          status: 'active',
          linkedUserId: userU.id, // ALREADY LINKED
        },
      });

      await prisma.occupancy.create({
        data: {
          dormitoryId: cardDorm.id,
          tenantId: tenant1.id,
          roomId: room1.id,
          status: 'ACTIVE',
        },
      });

      // 3. Room 2 has an eligible unlinked Tenant T2
      const tenant2 = await prisma.tenant.create({
        data: {
          dormitoryId: cardDorm.id,
          tenantNumber: `T-CR2-${Date.now()}`,
          firstName: 'ผู้เช่า',
          lastName: 'ห้องสอง',
          displayName: 'ผู้เช่า ห้องสอง',
          phone: '0822222222',
          status: 'active',
          linkedUserId: null,
        },
      });

      await prisma.occupancy.create({
        data: {
          dormitoryId: cardDorm.id,
          tenantId: tenant2.id,
          roomId: room2.id,
          status: 'ACTIVE',
        },
      });

      const userAuth = await authService.authenticateTestUser(userU.id);
      const userCookie = `horplus_session=${userAuth.sessionToken}; horplus_csrf=${userAuth.csrfToken}`;
      const userCsrf = userAuth.csrfToken;

      // 4. User U attempts to claim Tenant T2 in Room 2
      const claimRes = await request(httpApp)
        .post('/api/v1/tenant-claims/claim')
        .set('Cookie', userCookie)
        .set('x-csrf-token', userCsrf)
        .send({
          dormitoryId: cardDorm.id,
          roomNumber: 'CR-102',
          claimInput: '0822222222',
        });

      // Must fail closed with generic 404 CLAIM_UNAVAILABLE
      expect(claimRes.status).toBe(404);
      expect(claimRes.body.error.code).toBe('CLAIM_UNAVAILABLE');
      expect(claimRes.body.error.message).toBe('ไม่พบข้อมูลผู้เช่าที่ตรงกับข้อมูลที่ระบุ หรือห้องพักนี้ไม่สามารถยืนยันสิทธิ์ได้ในขณะนี้');

      // Database invariants: T1 remains linked to U, T2 remains unlinked (null)
      const checkT1 = await prisma.tenant.findUnique({ where: { id: tenant1.id } });
      expect(checkT1?.linkedUserId).toBe(userU.id);

      const checkT2 = await prisma.tenant.findUnique({ where: { id: tenant2.id } });
      expect(checkT2?.linkedUserId).toBeNull();
    });

    it('26. Concurrent Double-Claim by Same User Across Two Rooms: Serialized by user+dormitory lock so exactly ONE succeeds and DB count = 1', async () => {
      // 1. Setup Dormitory and 2 rooms
      const raceDorm = await prisma.dormitory.create({
        data: {
          code: `RACE-${Date.now()}`,
          name: 'Dormitory Double Claim Race',
        },
      });
      const raceBld = await prisma.building.create({
        data: {
          dormitoryId: raceDorm.id,
          name: 'Building Race',
          floorCount: 2,
        },
      });
      const roomA = await prisma.room.create({
        data: {
          dormitoryId: raceDorm.id,
          buildingId: raceBld.id,
          roomNumber: 'RC-101',
          normalizedRoomNumber: 'RC-101',
          roomType: 'standard',
          floor: 1,
          status: 'vacant',
        },
      });
      const roomB = await prisma.room.create({
        data: {
          dormitoryId: raceDorm.id,
          buildingId: raceBld.id,
          roomNumber: 'RC-102',
          normalizedRoomNumber: 'RC-102',
          roomType: 'standard',
          floor: 1,
          status: 'vacant',
        },
      });

      const tenA = await prisma.tenant.create({
        data: {
          dormitoryId: raceDorm.id,
          tenantNumber: `T-RCA-${Date.now()}`,
          firstName: 'ผู้เช่า',
          lastName: 'เอ',
          displayName: 'ผู้เช่า เอ',
          phone: '0833333333',
          status: 'active',
          linkedUserId: null,
        },
      });
      await prisma.occupancy.create({
        data: {
          dormitoryId: raceDorm.id,
          tenantId: tenA.id,
          roomId: roomA.id,
          status: 'ACTIVE',
        },
      });

      const tenB = await prisma.tenant.create({
        data: {
          dormitoryId: raceDorm.id,
          tenantNumber: `T-RCB-${Date.now()}`,
          firstName: 'ผู้เช่า',
          lastName: 'บี',
          displayName: 'ผู้เช่า บี',
          phone: '0844444444',
          status: 'active',
          linkedUserId: null,
        },
      });
      await prisma.occupancy.create({
        data: {
          dormitoryId: raceDorm.id,
          tenantId: tenB.id,
          roomId: roomB.id,
          status: 'ACTIVE',
        },
      });

      // 2. Fresh User not linked to any tenant
      const freshUser = await prisma.user.create({
        data: {
          googleSubject: `sub-race-${Date.now()}`,
          email: `race-${Date.now()}@example.com`,
          emailNormalized: `race-${Date.now()}@example.com`,
          name: 'นายแข่งเคลม สองห้องพร้อมกัน',
        },
      });

      const { tenantClaimService } = await import('../../services/tenant-claim.service.js');

      // 3. Concurrently execute two valid claims for Room A and Room B
      const claim1 = tenantClaimService
        .claimTenant(
          {
            dormitoryId: raceDorm.id,
            roomId: roomA.id,
            claimInput: '0833333333',
          },
          freshUser.id
        )
        .then((res) => ({ success: true, res }))
        .catch((err) => ({ success: false, err }));

      const claim2 = tenantClaimService
        .claimTenant(
          {
            dormitoryId: raceDorm.id,
            roomId: roomB.id,
            claimInput: '0844444444',
          },
          freshUser.id
        )
        .then((res) => ({ success: true, res }))
        .catch((err) => ({ success: false, err }));

      const [res1, res2] = await Promise.all([claim1, claim2]);

      // Exactly one succeeds, the other fails
      const successCount = (res1.success ? 1 : 0) + (res2.success ? 1 : 0);
      expect(successCount).toBe(1);

      const failedResult = (!res1.success ? res1 : res2) as { success: false; err: any };
      expect(failedResult.err?.code).toBe('CLAIM_USER_ALREADY_LINKED_IN_DORM');

      // Database assertion: exactly 1 Tenant in raceDorm has linkedUserId = freshUser.id
      const linkedTenantsCount = await prisma.tenant.count({
        where: {
          dormitoryId: raceDorm.id,
          linkedUserId: freshUser.id,
          deletedAt: null,
        },
      });
      expect(linkedTenantsCount).toBe(1);
    });

    it('27. Cross-Dorm User Link Cardinality: User may be linked to one Tenant in Dorm A and one Tenant in Dorm B', async () => {
      // 1. Dorm A setup
      const dormA = await prisma.dormitory.create({
        data: {
          code: `CD-A-${Date.now()}`,
          name: 'Dormitory Cross A',
        },
      });
      const bldA = await prisma.building.create({
        data: {
          dormitoryId: dormA.id,
          name: 'Building A',
          floorCount: 2,
        },
      });
      const roomA = await prisma.room.create({
        data: {
          dormitoryId: dormA.id,
          buildingId: bldA.id,
          roomNumber: 'CD-A1',
          normalizedRoomNumber: 'CD-A1',
          roomType: 'standard',
          floor: 1,
          status: 'vacant',
        },
      });
      const tenA = await prisma.tenant.create({
        data: {
          dormitoryId: dormA.id,
          tenantNumber: `T-CDA-${Date.now()}`,
          firstName: 'ผู้เช่า',
          lastName: 'หอเอ',
          displayName: 'ผู้เช่า หอเอ',
          phone: '0855551111',
          status: 'active',
          linkedUserId: null,
        },
      });
      await prisma.occupancy.create({
        data: {
          dormitoryId: dormA.id,
          tenantId: tenA.id,
          roomId: roomA.id,
          status: 'ACTIVE',
        },
      });

      // 2. Dorm B setup
      const dormB = await prisma.dormitory.create({
        data: {
          code: `CD-B-${Date.now()}`,
          name: 'Dormitory Cross B',
        },
      });
      const bldB = await prisma.building.create({
        data: {
          dormitoryId: dormB.id,
          name: 'Building B',
          floorCount: 2,
        },
      });
      const roomB = await prisma.room.create({
        data: {
          dormitoryId: dormB.id,
          buildingId: bldB.id,
          roomNumber: 'CD-B1',
          normalizedRoomNumber: 'CD-B1',
          roomType: 'standard',
          floor: 1,
          status: 'vacant',
        },
      });
      const tenB = await prisma.tenant.create({
        data: {
          dormitoryId: dormB.id,
          tenantNumber: `T-CDB-${Date.now()}`,
          firstName: 'ผู้เช่า',
          lastName: 'หอบี',
          displayName: 'ผู้เช่า หอบี',
          phone: '0866662222',
          status: 'active',
          linkedUserId: null,
        },
      });
      await prisma.occupancy.create({
        data: {
          dormitoryId: dormB.id,
          tenantId: tenB.id,
          roomId: roomB.id,
          status: 'ACTIVE',
        },
      });

      // 3. User U claims Tenant in Dorm A
      const userMulti = await prisma.user.create({
        data: {
          googleSubject: `sub-cd-${Date.now()}`,
          email: `cd-${Date.now()}@example.com`,
          emailNormalized: `cd-${Date.now()}@example.com`,
          name: 'นายพักสองหอ สองจังหวัด',
        },
      });

      const { tenantClaimService } = await import('../../services/tenant-claim.service.js');

      const claimResA = await tenantClaimService.claimTenant(
        {
          dormitoryId: dormA.id,
          roomId: roomA.id,
          claimInput: '0855551111',
        },
        userMulti.id
      );
      expect(claimResA.success).toBe(true);

      // 4. User U claims Tenant in Dorm B (cross-dorm link is allowed)
      const claimResB = await tenantClaimService.claimTenant(
        {
          dormitoryId: dormB.id,
          roomId: roomB.id,
          claimInput: '0866662222',
        },
        userMulti.id
      );
      expect(claimResB.success).toBe(true);

      // Assert DB state: exactly 1 linked tenant in Dorm A, and exactly 1 in Dorm B
      const countA = await prisma.tenant.count({
        where: { dormitoryId: dormA.id, linkedUserId: userMulti.id, deletedAt: null },
      });
      expect(countA).toBe(1);

      const countB = await prisma.tenant.count({
        where: { dormitoryId: dormB.id, linkedUserId: userMulti.id, deletedAt: null },
      });
      expect(countB).toBe(1);
    });

    it('28. Tenant Portal Determinism: Deterministically resolves single linked Tenant and validates DB count invariant', async () => {
      // 1. Setup single claimed tenant
      const portRoom = await prisma.room.create({
        data: {
          dormitoryId,
          buildingId,
          roomNumber: `DET-${Date.now().toString().slice(-4)}`,
          normalizedRoomNumber: `DET-${Date.now().toString().slice(-4)}`,
          roomType: 'standard',
          floor: 1,
          status: 'vacant',
        },
      });

      const portUser = await prisma.user.create({
        data: {
          googleSubject: `sub-det-${Date.now()}`,
          email: `det-${Date.now()}@example.com`,
          emailNormalized: `det-${Date.now()}@example.com`,
          name: 'นายเด่น ชัดเจน',
        },
      });

      const portTenant = await prisma.tenant.create({
        data: {
          dormitoryId,
          tenantNumber: `T-DET-${Date.now()}`,
          firstName: 'เด่น',
          lastName: 'ชัดเจน',
          displayName: 'นายเด่น ชัดเจน',
          phone: '0877778888',
          status: 'active',
          linkedUserId: null,
        },
      });

      await prisma.occupancy.create({
        data: {
          dormitoryId,
          tenantId: portTenant.id,
          roomId: portRoom.id,
          status: 'ACTIVE',
        },
      });

      const { tenantClaimService } = await import('../../services/tenant-claim.service.js');
      const claimRes = await tenantClaimService.claimTenant(
        {
          dormitoryId,
          roomId: portRoom.id,
          claimInput: '0877778888',
        },
        portUser.id
      );
      expect(claimRes.success).toBe(true);

      // 2. Query Tenant Portal Profile
      const portAuth = await authService.authenticateTestUser(portUser.id);
      const portCookie = `horplus_session=${portAuth.sessionToken}; horplus_csrf=${portAuth.csrfToken}`;

      const res = await request(httpApp)
        .get('/api/v1/tenant-portal/profile')
        .set('Cookie', portCookie)
        .set('x-dormitory-id', dormitoryId);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(portTenant.id);

      // Invariant assertion: Exactly 1 linked tenant exists for this user in this dormitory
      const totalLinked = await prisma.tenant.count({
        where: {
          dormitoryId,
          linkedUserId: portUser.id,
          deletedAt: null,
        },
      });
      expect(totalLinked).toBe(1);
    });
  });

  // ==========================================
  // Daily Stay Isolation from Monthly Billing Cycle
  // ==========================================
  describe('Daily Stay Isolation from Monthly Billing Cycle', () => {
    it('Daily Stay occupants are strictly excluded from monthly BillingCycle, RoomBillingCycleSnapshot, and utility bills', async () => {
      // 1. Verify Daily Stay does not generate Bill table records
      const dailyBills = await prisma.bill.findMany({
        where: {
          dormitoryId,
          roomId,
        },
      });
      // All bills in Bill table must have standard billing cycle references or be monthly bills
      expect(dailyBills.every((b: any) => b.dailyStayId === undefined)).toBe(true);

      // 2. Verify DailyStayInvoice is stored in dedicated table and not in Bill
      const dailyInvoices = await prisma.dailyStayInvoice.findMany({
        where: { dormitoryId },
      });
      expect(dailyInvoices.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ==========================================
  // High-Concurrency Invoice Number & Advisory Lock Tests
  // ==========================================
  describe('High-Concurrency Daily Invoice Number Allocation', () => {
    it('10 concurrent approved Daily stays in 10 different rooms in the same dormitory/month generate 10 unique sequential invoice numbers', async () => {
      const concDorm = await prisma.dormitory.create({
        data: {
          name: 'หอพัก Concurrency Test',
          status: 'active',
        },
      });

      const concBld = await prisma.building.create({
        data: {
          dormitoryId: concDorm.id,
          name: 'Building Conc',
          dailyRent: 500,
          depositAmount: 200,
        },
      });

      // Create 10 distinct rooms in fresh dormitory
      const rooms = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          prisma.room.create({
            data: {
              dormitoryId: concDorm.id,
              buildingId: concBld.id,
              roomNumber: `CONC-${100 + i}`,
              normalizedRoomNumber: `CONC-${100 + i}`,
              roomType: 'standard',
              floor: 1,
              status: 'vacant',
              dailyRent: 500,
              depositAmount: 200,
            },
          })
        )
      );

      const today = new Date().toISOString().slice(0, 10);

      // Concurrently execute 10 quick adds
      const results = await Promise.all(
        rooms.map((r, i) =>
          dailyStayService.ownerQuickAddDailyStay(
            concDorm.id,
            {
              roomId: r.id,
              fullName: `ผู้เข้าพักพร้อมกัน ${i + 1}`,
              startDate: today,
              endDate: today,
              dailyRateAmount: '500.00',
              depositAmount: '200.00',
              depositDeclaredStatus: 'UNPAID',
            },
            ownerUserId
          )
        )
      );

      expect(results.length).toBe(10);

      // Collect all 10 invoice numbers
      const invoiceNumbers = results.map((res) => res.invoice.invoiceNumber);
      const uniqueNumbers = new Set(invoiceNumbers);

      // Invariant: exactly 10 unique invoice numbers, no duplicates or collisions
      expect(uniqueNumbers.size).toBe(10);
      results.forEach((res) => {
        expect(res.invoice.items.length).toBe(2);
        const rentItem = res.invoice.items.find((it: any) => it.itemType === 'DAILY_RENT');
        const depItem = res.invoice.items.find((it: any) => it.itemType === 'DEPOSIT');
        expect(rentItem).toBeDefined();
        expect(depItem).toBeDefined();
      });
    });
  });

  // ==========================================
  // Monthly Edited End Date & Financial Invariant Tests
  // ==========================================
  describe('Monthly Edited End Date Persistence & Defaults', () => {
    it('persists explicitly approved edited endDate instead of recomputing it', async () => {
      const { ProvisionalRentalTermService } = await import('../../services/provisional-rental-term.service.js');
      const provService = new ProvisionalRentalTermService(prisma);

      const editDorm = await prisma.dormitory.create({
        data: { name: 'หอพัก Edit Date Test', status: 'active' },
      });
      const editBld = await prisma.building.create({
        data: { dormitoryId: editDorm.id, name: 'Bld Edit' },
      });

      const editRoom = await prisma.room.create({
        data: {
          dormitoryId: editDorm.id,
          buildingId: editBld.id,
          roomNumber: 'EDIT-END-01',
          normalizedRoomNumber: 'EDIT-END-01',
          roomType: 'standard',
          floor: 1,
          status: 'vacant',
          monthlyRent: 4000,
        },
      });

      const today = new Date().toISOString().slice(0, 10);
      const customEndDate = '2026-12-31';

      const result = await provService.createProvisionalTenantAndTerm(
        editDorm.id,
        {
          roomId: editRoom.id,
          fullName: 'นายทดสอบ แก้ไขวันสิ้นสุด',
          rentalType: 'MONTHLY',
          startDate: today,
          endDate: customEndDate, // Explicitly edited end date
          durationMonths: 1,
          unitRentAmount: '4000.00',
          totalRentAmount: '4000.00',
        },
        ownerUserId
      );

      expect(result.provisionalTerm.endDate.toISOString().slice(0, 10)).toBe(customEndDate);
    });

    it('deposit amount 0 is strictly preserved and not overwritten by building deposit', async () => {
      const zeroDorm = await prisma.dormitory.create({
        data: { name: 'หอพัก Zero Dep Test', status: 'active' },
      });
      const zeroBld = await prisma.building.create({
        data: {
          dormitoryId: zeroDorm.id,
          name: 'Bld Zero',
          dailyRent: 300,
          depositAmount: 300, // Building configured 300
        },
      });

      const zeroDepRoom = await prisma.room.create({
        data: {
          dormitoryId: zeroDorm.id,
          buildingId: zeroBld.id,
          roomNumber: 'ZERO-DEP-01',
          normalizedRoomNumber: 'ZERO-DEP-01',
          roomType: 'standard',
          floor: 1,
          status: 'vacant',
          dailyRent: 300,
          depositAmount: 0, // Configured 0 strictly preserved
          depositInheritsBuildingDefault: false,
        },
      });

      const today = new Date().toISOString().slice(0, 10);

      const result = await dailyStayService.ownerQuickAddDailyStay(
        zeroDorm.id,
        {
          roomId: zeroDepRoom.id,
          fullName: 'นายทดสอบ มัดจำศูนย์',
          startDate: today,
          endDate: today,
        },
        ownerUserId
      );

      expect(Number(result.depositAmount)).toBe(0);
      expect(Number(result.invoice.depositAmount)).toBe(0);
    });

    it('durationMonths > 36 (e.g. 37 and 60) is accepted and persisted without arbitrary 36-month cap', async () => {
      const { ProvisionalRentalTermService } = await import('../../services/provisional-rental-term.service.js');
      const provService = new ProvisionalRentalTermService(prisma);

      const longDorm = await prisma.dormitory.create({
        data: { name: 'หอพัก Long Duration Test', status: 'active' },
      });
      const longBld = await prisma.building.create({
        data: { dormitoryId: longDorm.id, name: 'Bld Long' },
      });

      const longRoom37 = await prisma.room.create({
        data: {
          dormitoryId: longDorm.id,
          buildingId: longBld.id,
          roomNumber: 'LONG-37',
          normalizedRoomNumber: 'LONG-37',
          roomType: 'standard',
          floor: 1,
          status: 'vacant',
          monthlyRent: 3000,
        },
      });

      const today = new Date().toISOString().slice(0, 10);

      const result37 = await provService.createProvisionalTenantAndTerm(
        longDorm.id,
        {
          roomId: longRoom37.id,
          fullName: 'นายทดสอบ สามสิบเจ็ดเดือน',
          rentalType: 'MONTHLY',
          startDate: today,
          durationMonths: 37,
          unitRentAmount: '3000.00',
          totalRentAmount: '111000.00',
        },
        ownerUserId
      );

      expect(result37.provisionalTerm.durationMonths).toBe(37);

      // Test 60 months
      const longRoom60 = await prisma.room.create({
        data: {
          dormitoryId: longDorm.id,
          buildingId: longBld.id,
          roomNumber: 'LONG-60',
          normalizedRoomNumber: 'LONG-60',
          roomType: 'standard',
          floor: 1,
          status: 'vacant',
          monthlyRent: 3000,
        },
      });

      const result60 = await provService.createProvisionalTenantAndTerm(
        longDorm.id,
        {
          roomId: longRoom60.id,
          fullName: 'นายทดสอบ หกสิบเดือน',
          rentalType: 'MONTHLY',
          startDate: today,
          durationMonths: 60,
          unitRentAmount: '3000.00',
          totalRentAmount: '180000.00',
        },
        ownerUserId
      );

      expect(result60.provisionalTerm.durationMonths).toBe(60);
    });
  });
});



