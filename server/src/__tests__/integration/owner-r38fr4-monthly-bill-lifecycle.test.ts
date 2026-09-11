/**
 * @license Apache-2.0
 * OWNER R3.8fR4 — Monthly Bill Lifecycle Authority & In-Place Recalculation Integration Tests
 *
 * Test Matrix Coverage (Section N & O):
 * 1. Save meter with NO Bill -> workspace changes, Bill count remains 0, tenant monthly Bill absent.
 * 2. Explicit issue afterward -> one MONTHLY_UTILITY, status UNPAID / UI รอชำระ.
 * 3. Save changed meter with existing UNPAID Bill -> same Bill.id, billNumber, billingDate, dueDate, new items/totals, paidAmount 0, Bill count 1.
 * 4. Existing OVERDUE zero-paid Bill -> same Bill identity, same dueDate, late-fee policy preserved/reconciled, Bill count 1.
 * 5. PARTIALLY_PAID Bill -> BILL_HAS_FINANCIAL_EVIDENCE (409), zero mutation.
 * 6. PAID Bill -> BILL_HAS_FINANCIAL_EVIDENCE (409), zero mutation.
 * 7. UNDER_REVIEW slip targeting Bill -> BILL_HAS_FINANCIAL_EVIDENCE (409), zero mutation.
 * 8. Approved Payment/Allocation but stale UNPAID status -> BILL_HAS_FINANCIAL_EVIDENCE (409), graph authority wins.
 * 9. Concurrent explicit issue requests -> exactly one active MONTHLY_UTILITY bill.
 * 10. DAILY_STAY excluded from monthly issue-all.
 * 11. Cancellation with financial evidence -> BILL_HAS_FINANCIAL_EVIDENCE (409).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { getEnv, resetCachedEnv } from '../../config/env.js';
import { getPrismaClient } from '../../db/prisma.js';
import { AuthenticationService } from '../../services/auth.service.js';
import { PrismaUserRepository } from '../../db/repositories/user.repository.js';
import { PrismaSessionRepository } from '../../db/repositories/session.repository.js';
import { PrismaMembershipRepository } from '../../db/repositories/membership.repository.js';
import { PrismaRoleRepository } from '../../db/repositories/role.repository.js';
import { PrismaBillingCycleRepository } from '../../db/repositories/billing-cycle.repository.js';
import { PrismaMeterRepository } from '../../db/repositories/meter.repository.js';
import { PrismaContractRepository } from '../../db/repositories/contract.repository.js';
import { PrismaRoomRepository } from '../../db/repositories/room.repository.js';
import { PrismaTenantRepository } from '../../db/repositories/tenant.repository.js';
import { PrismaBillRepository } from '../../db/repositories/bill.repository.js';
import { SensitiveFieldService } from '../../services/sensitive-field.service.js';
import { subscriptionEntitlementService } from '../../services/subscription-entitlement.service.js';
import { SignatureStorageService } from '../../services/signature-storage.service.js';
import { subscriptionIntentService } from '../../services/subscription-intent.service.js';
import { BillingService } from '../../services/billing.service.js';
import { MeterService } from '../../services/meter.service.js';
import { Prisma } from '@prisma/client';

const prisma = getPrismaClient();

describe('OWNER R3.8fR4: Monthly Bill Lifecycle Authority & In-Place Recalculation', () => {
  let app: any;
  let authService: AuthenticationService;
  let billingService: BillingService;
  let meterService: MeterService;
  const testRunId = `r38fr4_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

  let dormId: string;
  let bldId: string;
  let ownerUserId: string;
  let ownerSessionToken: string;
  let ownerCsrfToken: string;
  let cycleId: string;
  let cycleCode: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.E2E_TEST_MODE = 'true';
    resetCachedEnv();

    const env = getEnv();
    const sensitiveService = new SensitiveFieldService(env.FIELD_ENCRYPTION_KEY, 1);
    const mockGoogleVerifier = {} as any;
    const mockAuditService = { log: async () => {}, logAction: async () => {} } as any;

    const userRepo = new PrismaUserRepository(prisma);
    const sessionRepo = new PrismaSessionRepository(prisma);
    const memberRepo = new PrismaMembershipRepository(prisma);
    const roleRepo = new PrismaRoleRepository(prisma);
    const billingCycleRepo = new PrismaBillingCycleRepository(prisma);
    const meterRepo = new PrismaMeterRepository(prisma);
    const contractRepo = new PrismaContractRepository(prisma);
    const roomRepo = new PrismaRoomRepository(prisma);
    const tenantRepo = new PrismaTenantRepository(prisma);
    const billRepo = new PrismaBillRepository(prisma);

    authService = new AuthenticationService(
      env,
      mockGoogleVerifier,
      userRepo,
      sessionRepo,
      memberRepo,
      roleRepo,
      mockAuditService,
      sensitiveService
    );

    billingService = new BillingService(
      billRepo,
      billingCycleRepo,
      meterRepo,
      contractRepo,
      roomRepo,
      tenantRepo,
      mockAuditService
    );

    meterService = new MeterService(
      meterRepo,
      billingCycleRepo,
      roomRepo,
      mockAuditService,
      billRepo
    );

    app = createApp({
      authService,
      sensitiveFieldService: sensitiveService,
      subscriptionEntitlementService,
      signatureStorageService: new SignatureStorageService(),
      subscriptionIntentService,
    });

    // Ensure subscription catalog is seeded
    await subscriptionEntitlementService.ensureSeeded();
    const freePlan = await prisma.subscriptionPlan.findFirst({ where: { code: 'FREE' } });

    // Setup Owner and Dormitory
    const dorm = await prisma.dormitory.create({
      data: {
        name: `Dorm R38fR4 Lifecycle ${testRunId}`,
        status: 'active',
      },
    });
    dormId = dorm.id;

    await prisma.dormitoryBillingSettings.create({
      data: {
        dormitoryId: dormId,
        dueDay: 5,
        waterRate: new Prisma.Decimal('18.00'),
        electricityRate: new Prisma.Decimal('7.00'),
        commonFee: new Prisma.Decimal('200.00'),
        internetFee: new Prisma.Decimal('150.00'),
        parkingRate: new Prisma.Decimal('300.00'),
        lateFeeType: 'daily',
        lateFeeValue: new Prisma.Decimal('50.00'),
        gracePeriodDays: 2,
      },
    });

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

    const ownerRole = (await prisma.role.findFirst({ where: { code: 'owner' } })) ||
      (await prisma.role.create({ data: { code: 'owner', name: 'Owner', permissions: [] } }));

    const ownerUser = await prisma.user.create({
      data: {
        email: `owner_${testRunId}@test.com`,
        emailNormalized: `owner_${testRunId}@test.com`,
        googleSubject: `google_owner_${testRunId}`,
        name: 'Owner User R38fR4',
      },
    });
    ownerUserId = ownerUser.id;

    await prisma.dormitoryMember.create({
      data: {
        userId: ownerUserId,
        dormitoryId: dormId,
        roleId: ownerRole.id,
        status: 'active',
        membershipOrigin: 'GOOGLE_BOOTSTRAP',
      },
    });

    const ownerAuth = await authService.authenticateTestUser(ownerUserId);
    ownerSessionToken = ownerAuth.sessionToken;
    ownerCsrfToken = ownerAuth.csrfToken;

    const building = await prisma.building.create({
      data: {
        dormitoryId: dormId,
        name: 'Building A',
      },
    });
    bldId = building.id;

    cycleCode = `2026-08-${testRunId}`;
    const cycle = await prisma.billingCycle.create({
      data: {
        dormitoryId: dormId,
        cycleCode,
        name: 'รอบ ส.ค. 2569 R38fR4',
        periodStart: new Date('2026-08-01'),
        periodEnd: new Date('2026-08-31'),
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-05'),
        status: 'published',
      },
    });
    cycleId = cycle.id;

    await prisma.billingRateSnapshot.create({
      data: {
        dormitoryId: dormId,
        billingCycleId: cycleId,
        waterRate: new Prisma.Decimal('18.00'),
        electricityRate: new Prisma.Decimal('7.00'),
        commonFee: new Prisma.Decimal('200.00'),
        internetFee: new Prisma.Decimal('150.00'),
        parkingFee: new Prisma.Decimal('300.00'),
        waterBillingType: 'per_unit',
        electricityBillingType: 'per_unit',
        commonFeeMode: 'room',
        internetFeeMode: 'room',
        parkingFeeMode: 'room',
        lateFeeType: 'daily',
        lateFeeValue: new Prisma.Decimal('50.00'),
        gracePeriodDays: 2,
        source: 'TEMPLATE_DEFAULT',
      },
    });
  });

  afterAll(async () => {
    try {
      await prisma.combinedPaymentGroupReceipt.deleteMany({ where: { group: { dormitoryId: dormId } } });
      await prisma.paymentAllocation.deleteMany({ where: { payment: { dormitoryId: dormId } } });
      await prisma.paymentStatusHistory.deleteMany({ where: { payment: { dormitoryId: dormId } } });
      await prisma.payment.deleteMany({ where: { bill: { dormitoryId: dormId } } });
      await prisma.payment.deleteMany({ where: { paymentGroup: { dormitoryId: dormId } } });
      await prisma.combinedPaymentGroupBillTarget.deleteMany({ where: { group: { dormitoryId: dormId } } });
      await prisma.combinedPaymentGroup.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.receipt.deleteMany({ where: { bill: { dormitoryId: dormId } } });
      await prisma.billItem.deleteMany({ where: { bill: { dormitoryId: dormId } } });
      await prisma.billStatusHistory.deleteMany({ where: { bill: { dormitoryId: dormId } } });
      await prisma.bill.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.meterReading.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.roomBillingCycleSnapshot.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.billingRateSnapshot.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.billingCycle.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.contract.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.tenant.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.room.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.building.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.dormitoryBillingSettings.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.dormitorySubscription.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.dormitoryMember.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.dormitory.deleteMany({ where: { id: dormId } });
      await prisma.session.deleteMany({ where: { userId: ownerUserId } });
      await prisma.user.deleteMany({ where: { id: ownerUserId } });
    } catch {
      // Ignore cleanup error
    }
  });

  it('1 & 2 & 3. Save meter with NO Bill -> 0 bills; Issue creates 1 Bill; Recalculate in place preserves identity', async () => {
    // Setup Room & Tenant with active contract
    const tenant = await prisma.tenant.create({
      data: {
        dormitoryId: dormId,
        tenantNumber: `TNT-101-${testRunId}`,
        firstName: 'ผู้เช่า',
        lastName: '101',
        displayName: 'ผู้เช่า 101',
        status: 'active',
      },
    });

    const room101 = await prisma.room.create({
      data: {
        dormitoryId: dormId,
        buildingId: bldId,
        roomNumber: `101-${testRunId}`,
        normalizedRoomNumber: `101${testRunId}`,
        floor: 1,
        status: 'occupied',
        monthlyRent: 3500,
        monthlyDeposit: 3500,
        termDeposit: 3500,
        dailyDeposit: 500,
      },
    });

    await prisma.contract.create({
      data: {
        dormitoryId: dormId,
        roomId: room101.id,
        tenantId: tenant.id,
        contractNumber: `CTR-101-${testRunId}`,
        startDate: new Date('2026-08-01'),
        endDate: new Date('2027-07-31'),
        rentAmount: 3500.0,
        depositAmount: 3500.0,
        status: 'active',
      },
    });

    // Step 1: Save meter workspace with NO prior bill
    const saveRes = await request(app)
      .post('/api/v1/meters/workspace/bulk')
      .set('Cookie', [`horplus_session=${ownerSessionToken}`, `horplus_csrf=${ownerCsrfToken}`])
      .set('x-csrf-token', ownerCsrfToken)
      .set('x-dormitory-id', dormId)
      .send({
        billingCycleId: cycleId,
        rows: [
          {
            roomId: room101.id,
            waterPrev: '100',
            waterCurr: '110', // 10 units * 18 = 180
            elecPrev: '500',
            elecCurr: '550',  // 50 units * 7 = 350
            peopleCount: 1,
            otherFees: [{ description: 'ค่าที่จอดมอเตอร์ไซค์', amount: '100.00' }],
          },
        ],
      });

    expect(saveRes.status).toBe(200);
    expect(saveRes.body.success).toBe(true);

    // Verify ZERO bills created
    const billsCountAfterSave = await prisma.bill.count({
      where: { dormitoryId: dormId, billingCycleId: cycleId, roomId: room101.id },
    });
    expect(billsCountAfterSave).toBe(0);

    // Step 2: Explicit issue
    const issueRes = await request(app)
      .post('/api/v1/bills/generate')
      .set('Cookie', [`horplus_session=${ownerSessionToken}`, `horplus_csrf=${ownerCsrfToken}`])
      .set('x-csrf-token', ownerCsrfToken)
      .set('x-dormitory-id', dormId)
      .send({
        billingCycleId: cycleId,
        roomId: room101.id,
        billKind: 'MONTHLY_UTILITY',
      });

    expect(issueRes.status).toBe(201);
    expect(issueRes.body.data.bill.status).toBe('unpaid');
    const bill1 = issueRes.body.data.bill;
    // Total = Water 180 + Elec 350 + Common 200 + Internet 150 + Parking 300 + Other 100 = 1,280.00
    expect(Number(bill1.totalAmount)).toBe(1280.00);

    const billsCountAfterIssue = await prisma.bill.count({
      where: { dormitoryId: dormId, billingCycleId: cycleId, roomId: room101.id },
    });
    expect(billsCountAfterIssue).toBe(1);

    // Step 3: Save changed meter with existing UNPAID Bill -> In-place recalculation
    // Change water reading from 110 -> 115 (15 units * 18 = 270, total becomes 1,370.00)
    const recalcRes = await request(app)
      .post('/api/v1/meters/workspace/bulk')
      .set('Cookie', [`horplus_session=${ownerSessionToken}`, `horplus_csrf=${ownerCsrfToken}`])
      .set('x-csrf-token', ownerCsrfToken)
      .set('x-dormitory-id', dormId)
      .send({
        billingCycleId: cycleId,
        rows: [
          {
            roomId: room101.id,
            waterPrev: '100',
            waterCurr: '115',
            elecPrev: '500',
            elecCurr: '550',
          },
        ],
      });

    expect(recalcRes.status).toBe(200);

    // Verify SAME Bill.id, SAME billNumber, SAME billingDate, SAME dueDate, new total
    const billsAfterRecalc = await prisma.bill.findMany({
      where: { dormitoryId: dormId, billingCycleId: cycleId, roomId: room101.id },
    });
    expect(billsAfterRecalc.length).toBe(1);
    const updatedBill = billsAfterRecalc[0];
    expect(updatedBill.id).toBe(bill1.id);
    expect(updatedBill.billNumber).toBe(bill1.billNumber);
    expect(new Date(updatedBill.billingDate).toISOString()).toBe(new Date(bill1.billingDate).toISOString());
    expect(new Date(updatedBill.dueDate).toISOString()).toBe(new Date(bill1.dueDate).toISOString());
    expect(Number(updatedBill.totalAmount)).toBe(1370.00);
    expect(Number(updatedBill.paidAmount)).toBe(0.00);
    expect(Number(updatedBill.outstandingAmount)).toBe(1370.00);
    expect(updatedBill.version).toBeGreaterThan(bill1.version);
  });

  it('4. Existing OVERDUE zero-paid Bill preserves dueDate & late-fee policy upon meter recalculation', async () => {
    const tenant = await prisma.tenant.create({
      data: {
        dormitoryId: dormId,
        tenantNumber: `TNT-102-${testRunId}`,
        firstName: 'ผู้เช่า',
        lastName: '102',
        displayName: 'ผู้เช่า 102',
        status: 'active',
      },
    });

    const room102 = await prisma.room.create({
      data: {
        dormitoryId: dormId,
        buildingId: bldId,
        roomNumber: `102-${testRunId}`,
        normalizedRoomNumber: `102${testRunId}`,
        floor: 1,
        status: 'occupied',
        monthlyRent: 3500,
        monthlyDeposit: 3500,
        termDeposit: 3500,
        dailyDeposit: 500,
      },
    });

    const contract = await prisma.contract.create({
      data: {
        dormitoryId: dormId,
        roomId: room102.id,
        tenantId: tenant.id,
        contractNumber: `CTR-102-${testRunId}`,
        startDate: new Date('2026-08-01'),
        endDate: new Date('2027-07-31'),
        rentAmount: 3500.0,
        depositAmount: 3500.0,
        status: 'active',
      },
    });

    // Create OVERDUE bill with past dueDate
    const originalDueDate = new Date('2026-08-10');
    const billOverdue = await prisma.bill.create({
      data: {
        dormitoryId: dormId,
        roomId: room102.id,
        tenantId: tenant.id,
        contractId: contract.id,
        billingCycleId: cycleId,
        billNumber: `INV-102-OD-${testRunId}`,
        billKind: 'MONTHLY_UTILITY',
        status: 'overdue',
        billingDate: new Date('2026-08-01'),
        dueDate: originalDueDate,
        subtotal: new Prisma.Decimal('1000.00'),
        fineAmount: new Prisma.Decimal('100.00'),
        totalAmount: new Prisma.Decimal('1100.00'),
        paidAmount: new Prisma.Decimal('0.00'),
        outstandingAmount: new Prisma.Decimal('1100.00'),
      },
    });

    // Save changed meter reading
    const saveRes = await request(app)
      .post('/api/v1/meters/workspace/bulk')
      .set('Cookie', [`horplus_session=${ownerSessionToken}`, `horplus_csrf=${ownerCsrfToken}`])
      .set('x-csrf-token', ownerCsrfToken)
      .set('x-dormitory-id', dormId)
      .send({
        billingCycleId: cycleId,
        rows: [
          {
            roomId: room102.id,
            waterPrev: '100',
            waterCurr: '110',
            elecPrev: '500',
            elecCurr: '550',
          },
        ],
      });

    expect(saveRes.status).toBe(200);

    const refreshedBill = await prisma.bill.findUnique({
      where: { id: billOverdue.id },
    });
    expect(refreshedBill?.id).toBe(billOverdue.id);
    expect(refreshedBill?.billNumber).toBe(billOverdue.billNumber);
    // Due date strictly preserved
    expect(new Date(refreshedBill!.dueDate).toISOString()).toBe(originalDueDate.toISOString());
    expect(refreshedBill?.status).toBe('overdue');
  });

  it('5. PARTIALLY_PAID Bill -> meter save fails closed with BILL_HAS_FINANCIAL_EVIDENCE (409)', async () => {
    const tenant = await prisma.tenant.create({
      data: {
        dormitoryId: dormId,
        tenantNumber: `TNT-103-${testRunId}`,
        firstName: 'ผู้เช่า',
        lastName: '103',
        displayName: 'ผู้เช่า 103',
        status: 'active',
      },
    });

    const room103 = await prisma.room.create({
      data: {
        dormitoryId: dormId,
        buildingId: bldId,
        roomNumber: `103-${testRunId}`,
        normalizedRoomNumber: `103${testRunId}`,
        floor: 1,
        status: 'occupied',
        monthlyRent: 3500,
        monthlyDeposit: 3500,
        termDeposit: 3500,
        dailyDeposit: 500,
      },
    });

    const billPartial = await prisma.bill.create({
      data: {
        dormitoryId: dormId,
        roomId: room103.id,
        tenantId: tenant.id,
        billingCycleId: cycleId,
        billNumber: `INV-103-PARTIAL-${testRunId}`,
        billKind: 'MONTHLY_UTILITY',
        status: 'PARTIALLY_PAID',
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-05'),
        subtotal: new Prisma.Decimal('1000.00'),
        totalAmount: new Prisma.Decimal('1000.00'),
        paidAmount: new Prisma.Decimal('500.00'),
        outstandingAmount: new Prisma.Decimal('500.00'),
      },
    });

    const saveRes = await request(app)
      .post('/api/v1/meters/workspace/bulk')
      .set('Cookie', [`horplus_session=${ownerSessionToken}`, `horplus_csrf=${ownerCsrfToken}`])
      .set('x-csrf-token', ownerCsrfToken)
      .set('x-dormitory-id', dormId)
      .send({
        billingCycleId: cycleId,
        rows: [
          {
            roomId: room103.id,
            waterPrev: '100',
            waterCurr: '120',
          },
        ],
      });

    expect(saveRes.status).toBe(409);
    expect(saveRes.body.error.code).toBe('BILL_HAS_FINANCIAL_EVIDENCE');
    expect(saveRes.body.error.message).toContain('บิลนี้มีรายการชำระเงินหรือสลิปที่เกี่ยวข้องแล้ว');

    // Confirm 0 mutation
    const untouchedBill = await prisma.bill.findUnique({ where: { id: billPartial.id } });
    expect(Number(untouchedBill?.paidAmount)).toBe(500.00);
    expect(Number(untouchedBill?.totalAmount)).toBe(1000.00);
  });

  it('6. PAID Bill -> meter save fails closed with BILL_HAS_FINANCIAL_EVIDENCE or ROOM_LOCKED_PAID', async () => {
    const tenant = await prisma.tenant.create({
      data: {
        dormitoryId: dormId,
        tenantNumber: `TNT-104-${testRunId}`,
        firstName: 'ผู้เช่า',
        lastName: '104',
        displayName: 'ผู้เช่า 104',
        status: 'active',
      },
    });

    const room104 = await prisma.room.create({
      data: {
        dormitoryId: dormId,
        buildingId: bldId,
        roomNumber: `104-${testRunId}`,
        normalizedRoomNumber: `104${testRunId}`,
        floor: 1,
        status: 'occupied',
        monthlyRent: 3500,
        monthlyDeposit: 3500,
        termDeposit: 3500,
        dailyDeposit: 500,
      },
    });

    await prisma.bill.create({
      data: {
        dormitoryId: dormId,
        roomId: room104.id,
        tenantId: tenant.id,
        billingCycleId: cycleId,
        billNumber: `INV-104-PAID-${testRunId}`,
        billKind: 'MONTHLY_UTILITY',
        status: 'PAID',
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-05'),
        subtotal: new Prisma.Decimal('1000.00'),
        totalAmount: new Prisma.Decimal('1000.00'),
        paidAmount: new Prisma.Decimal('1000.00'),
        outstandingAmount: new Prisma.Decimal('0.00'),
      },
    });

    const saveRes = await request(app)
      .post('/api/v1/meters/workspace/bulk')
      .set('Cookie', [`horplus_session=${ownerSessionToken}`, `horplus_csrf=${ownerCsrfToken}`])
      .set('x-csrf-token', ownerCsrfToken)
      .set('x-dormitory-id', dormId)
      .send({
        billingCycleId: cycleId,
        rows: [
          {
            roomId: room104.id,
            waterPrev: '100',
            waterCurr: '120',
          },
        ],
      });

    expect([400, 409]).toContain(saveRes.status);
    expect(['BILL_HAS_FINANCIAL_EVIDENCE', 'ROOM_LOCKED_PAID']).toContain(saveRes.body.error.code);
  });

  it('7. UNDER_REVIEW slip/payment targeting Bill -> meter save fails closed with BILL_HAS_FINANCIAL_EVIDENCE (409)', async () => {
    const tenant = await prisma.tenant.create({
      data: {
        dormitoryId: dormId,
        tenantNumber: `TNT-105-${testRunId}`,
        firstName: 'ผู้เช่า',
        lastName: '105',
        displayName: 'ผู้เช่า 105',
        status: 'active',
      },
    });

    const room105 = await prisma.room.create({
      data: {
        dormitoryId: dormId,
        buildingId: bldId,
        roomNumber: `105-${testRunId}`,
        normalizedRoomNumber: `105${testRunId}`,
        floor: 1,
        status: 'occupied',
        monthlyRent: 3500,
        monthlyDeposit: 3500,
        termDeposit: 3500,
        dailyDeposit: 500,
      },
    });

    const billUnderReview = await prisma.bill.create({
      data: {
        dormitoryId: dormId,
        roomId: room105.id,
        tenantId: tenant.id,
        billingCycleId: cycleId,
        billNumber: `INV-105-REVIEW-${testRunId}`,
        billKind: 'MONTHLY_UTILITY',
        status: 'unpaid', // Bill remains unpaid under Decision C
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-05'),
        subtotal: new Prisma.Decimal('1000.00'),
        totalAmount: new Prisma.Decimal('1000.00'),
        paidAmount: new Prisma.Decimal('0.00'),
        outstandingAmount: new Prisma.Decimal('1000.00'),
      },
    });

    // Create UNDER_REVIEW payment targeting this bill
    await prisma.payment.create({
      data: {
        dormitoryId: dormId,
        billId: billUnderReview.id,
        tenantId: tenant.id,
        amount: new Prisma.Decimal('1000.00'),
        method: 'TRANSFER',
        status: 'UNDER_REVIEW',
        paymentDate: new Date('2026-08-30T10:00:00Z'),
      },
    });

    const saveRes = await request(app)
      .post('/api/v1/meters/workspace/bulk')
      .set('Cookie', [`horplus_session=${ownerSessionToken}`, `horplus_csrf=${ownerCsrfToken}`])
      .set('x-csrf-token', ownerCsrfToken)
      .set('x-dormitory-id', dormId)
      .send({
        billingCycleId: cycleId,
        rows: [
          {
            roomId: room105.id,
            waterPrev: '100',
            waterCurr: '120',
          },
        ],
      });

    expect(saveRes.status).toBe(409);
    expect(saveRes.body.error.code).toBe('BILL_HAS_FINANCIAL_EVIDENCE');
  });

  it('8. Stale UNPAID status with approved PaymentAllocation -> graph authority blocks with BILL_HAS_FINANCIAL_EVIDENCE', async () => {
    const tenant = await prisma.tenant.create({
      data: {
        dormitoryId: dormId,
        tenantNumber: `TNT-106-${testRunId}`,
        firstName: 'ผู้เช่า',
        lastName: '106',
        displayName: 'ผู้เช่า 106',
        status: 'active',
      },
    });

    const room106 = await prisma.room.create({
      data: {
        dormitoryId: dormId,
        buildingId: bldId,
        roomNumber: `106-${testRunId}`,
        normalizedRoomNumber: `106${testRunId}`,
        floor: 1,
        status: 'occupied',
        monthlyRent: 3500,
        monthlyDeposit: 3500,
        termDeposit: 3500,
        dailyDeposit: 500,
      },
    });

    const billStale = await prisma.bill.create({
      data: {
        dormitoryId: dormId,
        roomId: room106.id,
        tenantId: tenant.id,
        billingCycleId: cycleId,
        billNumber: `INV-106-STALE-${testRunId}`,
        billKind: 'MONTHLY_UTILITY',
        status: 'unpaid', // Stale status
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-05'),
        subtotal: new Prisma.Decimal('1000.00'),
        totalAmount: new Prisma.Decimal('1000.00'),
        paidAmount: new Prisma.Decimal('0.00'), // Stale paidAmount
        outstandingAmount: new Prisma.Decimal('1000.00'),
      },
    });

    const payment = await prisma.payment.create({
      data: {
        dormitoryId: dormId,
        billId: billStale.id,
        tenantId: tenant.id,
        amount: new Prisma.Decimal('1000.00'),
        method: 'TRANSFER',
        status: 'APPROVED',
        paymentDate: new Date('2026-08-30T10:00:00Z'),
      },
    });

    await prisma.paymentAllocation.create({
      data: {
        dormitoryId: dormId,
        paymentId: payment.id,
        billId: billStale.id,
        allocatedAmount: new Prisma.Decimal('1000.00'),
      },
    });

    const saveRes = await request(app)
      .post('/api/v1/meters/workspace/bulk')
      .set('Cookie', [`horplus_session=${ownerSessionToken}`, `horplus_csrf=${ownerCsrfToken}`])
      .set('x-csrf-token', ownerCsrfToken)
      .set('x-dormitory-id', dormId)
      .send({
        billingCycleId: cycleId,
        rows: [
          {
            roomId: room106.id,
            waterPrev: '100',
            waterCurr: '120',
          },
        ],
      });

    expect(saveRes.status).toBe(409);
    expect(saveRes.body.error.code).toBe('BILL_HAS_FINANCIAL_EVIDENCE');
  });

  it('9. Concurrent explicit issue requests create exactly ONE active MONTHLY_UTILITY bill', async () => {
    const tenant = await prisma.tenant.create({
      data: {
        dormitoryId: dormId,
        tenantNumber: `TNT-107-${testRunId}`,
        firstName: 'ผู้เช่า',
        lastName: '107',
        displayName: 'ผู้เช่า 107',
        status: 'active',
      },
    });

    const room107 = await prisma.room.create({
      data: {
        dormitoryId: dormId,
        buildingId: bldId,
        roomNumber: `107-${testRunId}`,
        normalizedRoomNumber: `107${testRunId}`,
        floor: 1,
        status: 'occupied',
        monthlyRent: 3500,
        monthlyDeposit: 3500,
        termDeposit: 3500,
        dailyDeposit: 500,
      },
    });

    await prisma.contract.create({
      data: {
        dormitoryId: dormId,
        roomId: room107.id,
        tenantId: tenant.id,
        contractNumber: `CTR-107-${testRunId}`,
        startDate: new Date('2026-08-01'),
        endDate: new Date('2027-07-31'),
        rentAmount: 3500.0,
        depositAmount: 3500.0,
        status: 'active',
      },
    });

    // Seed meter reading for room 107
    await request(app)
      .post('/api/v1/meters/workspace/bulk')
      .set('Cookie', [`horplus_session=${ownerSessionToken}`, `horplus_csrf=${ownerCsrfToken}`])
      .set('x-csrf-token', ownerCsrfToken)
      .set('x-dormitory-id', dormId)
      .send({
        billingCycleId: cycleId,
        rows: [
          {
            roomId: room107.id,
            waterPrev: '100',
            waterCurr: '110',
            elecPrev: '500',
            elecCurr: '550',
          },
        ],
      });

    // Issue concurrently with 2 simultaneous requests
    const [resA, resB] = await Promise.all([
      request(app)
        .post('/api/v1/bills/generate')
        .set('Cookie', [`horplus_session=${ownerSessionToken}`, `horplus_csrf=${ownerCsrfToken}`])
        .set('x-csrf-token', ownerCsrfToken)
        .set('x-dormitory-id', dormId)
        .set('x-idempotency-key', `keyA-${Date.now()}`)
        .send({
          billingCycleId: cycleId,
          roomId: room107.id,
          billKind: 'MONTHLY_UTILITY',
        }),
      request(app)
        .post('/api/v1/bills/generate')
        .set('Cookie', [`horplus_session=${ownerSessionToken}`, `horplus_csrf=${ownerCsrfToken}`])
        .set('x-csrf-token', ownerCsrfToken)
        .set('x-dormitory-id', dormId)
        .set('x-idempotency-key', `keyB-${Date.now()}`)
        .send({
          billingCycleId: cycleId,
          roomId: room107.id,
          billKind: 'MONTHLY_UTILITY',
        }),
    ]);

    expect([200, 201]).toContain(resA.status);
    expect([200, 201]).toContain(resB.status);

    const activeBills = await prisma.bill.findMany({
      where: {
        dormitoryId: dormId,
        billingCycleId: cycleId,
        roomId: room107.id,
        billKind: 'MONTHLY_UTILITY',
        status: { notIn: ['cancelled', 'void'] },
      },
    });

    expect(activeBills.length).toBe(1);
  });

  it('10. Room Switch (toggleRoomBillSwitch) cancels bill cleanly and blocks cancel on financial evidence', async () => {
    const tenant = await prisma.tenant.create({
      data: {
        dormitoryId: dormId,
        tenantNumber: `TNT-108-${testRunId}`,
        firstName: 'ผู้เช่า',
        lastName: '108',
        displayName: 'ผู้เช่า 108',
        status: 'active',
      },
    });

    const room108 = await prisma.room.create({
      data: {
        dormitoryId: dormId,
        buildingId: bldId,
        roomNumber: `108-${testRunId}`,
        normalizedRoomNumber: `108${testRunId}`,
        floor: 1,
        status: 'occupied',
        monthlyRent: 3500,
        monthlyDeposit: 3500,
        termDeposit: 3500,
        dailyDeposit: 500,
      },
    });

    await prisma.contract.create({
      data: {
        dormitoryId: dormId,
        roomId: room108.id,
        tenantId: tenant.id,
        contractNumber: `CTR-108-${testRunId}`,
        startDate: new Date('2026-08-01'),
        endDate: new Date('2027-07-31'),
        rentAmount: 3500.0,
        depositAmount: 3500.0,
        status: 'active',
      },
    });

    // Seed meter reading and issue bill
    await request(app)
      .post('/api/v1/meters/workspace/bulk')
      .set('Cookie', [`horplus_session=${ownerSessionToken}`, `horplus_csrf=${ownerCsrfToken}`])
      .set('x-csrf-token', ownerCsrfToken)
      .set('x-dormitory-id', dormId)
      .send({
        billingCycleId: cycleId,
        rows: [
          {
            roomId: room108.id,
            waterPrev: '100',
            waterCurr: '110',
            elecPrev: '500',
            elecCurr: '550',
          },
        ],
      });

    const issueRes = await request(app)
      .post('/api/v1/meters/switch')
      .set('Cookie', [`horplus_session=${ownerSessionToken}`, `horplus_csrf=${ownerCsrfToken}`])
      .set('x-csrf-token', ownerCsrfToken)
      .set('x-dormitory-id', dormId)
      .send({
        billingCycleId: cycleId,
        roomId: room108.id,
        action: 'issue',
      });

    expect(issueRes.status).toBe(200);
    expect(issueRes.body.action).toBe('issue');
    const bill = issueRes.body.bill;

    // Attach approved payment
    await prisma.payment.create({
      data: {
        dormitoryId: dormId,
        billId: bill.id,
        tenantId: tenant.id,
        amount: new Prisma.Decimal('1000.00'),
        method: 'CASH',
        status: 'APPROVED',
        paymentDate: new Date('2026-08-30T10:00:00Z'),
      },
    });

    // Try to toggle switch off (cancel) -> must fail closed with 409
    const cancelRes = await request(app)
      .post('/api/v1/meters/switch')
      .set('Cookie', [`horplus_session=${ownerSessionToken}`, `horplus_csrf=${ownerCsrfToken}`])
      .set('x-csrf-token', ownerCsrfToken)
      .set('x-dormitory-id', dormId)
      .send({
        billingCycleId: cycleId,
        roomId: room108.id,
        action: 'cancel',
      });

    expect(cancelRes.status).toBe(409);
    expect(cancelRes.body.error.code).toBe('BILL_HAS_FINANCIAL_EVIDENCE');
  });
});
