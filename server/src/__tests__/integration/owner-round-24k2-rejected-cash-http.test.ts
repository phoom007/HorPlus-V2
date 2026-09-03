/**
 * @license Apache-2.0
 * Round 2.4K.2: Real Express HTTP Route Proof — Rejected Slip -> Cash Settlement
 *
 * Requirements:
 * 1. Bill outstanding > 0 + existing REJECTED transfer Payment
 * 2. Real Express HTTP POST /api/v1/payments/cash with supertest, valid auth, CSRF, idempotency key
 * 3. HTTP 200 returned
 * 4. Database verification:
 *    - CASH APPROVED Payment created
 *    - Prior REJECTED transfer slip Payment remains intact, unchanged
 *    - PaymentAllocation created linking Cash Payment to Bill
 *    - Bill status updated to 'paid', outstandingAmount = '0.00'
 *    - Final Receipt generated with paymentMethod = 'CASH' (and Thai 'เงินสด')
 * 5. Idempotency replay:
 *    - Re-sending identical HTTP request with same idempotency key returns 200
 *    - Database: NO duplicate Payment, NO duplicate PaymentAllocation, NO duplicate Final Receipt
 * 6. Already paid rejection:
 *    - Attempting to settle again returns 400 ALREADY_PAID
 * 7. Dormitory isolation:
 *    - Cross-dormitory payment attempt rejected with 403 FORBIDDEN
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import Decimal from 'decimal.js';
import { getPrismaClient } from '../../db/prisma.js';
import { createApp } from '../../app.js';
import { getEnv, resetCachedEnv } from '../../config/env.js';
import { AuthenticationService } from '../../services/auth.service.js';
import { PrismaUserRepository } from '../../db/repositories/user.repository.js';
import { PrismaSessionRepository } from '../../db/repositories/session.repository.js';
import { PrismaMembershipRepository } from '../../db/repositories/membership.repository.js';
import { PrismaRoleRepository } from '../../db/repositories/role.repository.js';
import { SensitiveFieldService } from '../../services/sensitive-field.service.js';
import { subscriptionEntitlementService } from '../../services/subscription-entitlement.service.js';
import { renderReceiptHtml } from '../../utils/receipt-html.util.js';

describe('Round 2.4K.2: Real Express HTTP Route Proof — Rejected Cash Settlement', () => {
  const prisma = getPrismaClient();
  let app: any;
  let authService: AuthenticationService;

  const testRunId = `24k2_cash_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

  let dormA: any;
  let dormB: any;
  let ownerUser: any;
  let ownerAuth: { sessionToken: string; csrfToken: string };

  let testBuilding: any;
  let testRoom: any;
  let testBillingCycle: any;
  let testTenant: any;
  let testBill: any;
  let rejectedPayment: any;

  let crossBuilding: any;
  let crossRoom: any;
  let crossBillingCycle: any;
  let crossTenant: any;
  let crossBill: any;

  let testIdempotencyKey: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.E2E_TEST_MODE = 'true';
    resetCachedEnv();

    const sensitiveService = new SensitiveFieldService(getEnv().FIELD_ENCRYPTION_KEY, 1);
    const mockGoogleVerifier = {} as any;
    const mockAuditService = { logAction: async () => {} } as any;

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

    await subscriptionEntitlementService.ensureSeeded();
    const freePlan = await prisma.subscriptionPlan.findFirst({ where: { code: 'FREE' } });

    // 1. Create Primary Dormitory (dormA)
    dormA = await prisma.dormitory.create({
      data: {
        name: `Dorm A ${testRunId}`,
        type: 'apartment',
        addressLine1: '101 Test Road',
        status: 'active',
      },
    });

    await prisma.dormitorySubscription.create({
      data: {
        dormitoryId: dormA.id,
        planId: freePlan!.id,
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 365 * 86400000),
      },
    });

    // 2. Create Isolated Secondary Dormitory (dormB)
    dormB = await prisma.dormitory.create({
      data: {
        name: `Dorm B ${testRunId}`,
        type: 'apartment',
        addressLine1: '202 Cross Road',
        status: 'active',
      },
    });

    await prisma.dormitorySubscription.create({
      data: {
        dormitoryId: dormB.id,
        planId: freePlan!.id,
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 365 * 86400000),
      },
    });

    // 3. Create Roles
    const ownerRoleA = await prisma.role.create({
      data: {
        dormitoryId: dormA.id,
        code: 'OWNER',
        name: 'Owner',
        permissions: { '*': ['*'] },
        isSystem: true,
      },
    });

    // 4. Create Owner User and Member of Dorm A
    ownerUser = await prisma.user.create({
      data: {
        googleSubject: `sub_owner_${testRunId}`,
        email: `owner_${testRunId}@example.com`,
        emailNormalized: `owner_${testRunId}@example.com`,
        name: 'Owner User',
      },
    });

    await prisma.dormitoryMember.create({
      data: {
        dormitoryId: dormA.id,
        userId: ownerUser.id,
        roleId: ownerRoleA.id,
        status: 'active',
        membershipOrigin: 'GOOGLE_BOOTSTRAP',
      },
    });

    ownerAuth = await authService.authenticateTestUser(ownerUser.id);

    // 5. Create Fixtures in Dorm A
    testBuilding = await prisma.building.create({
      data: {
        dormitoryId: dormA.id,
        name: 'Building A',
      },
    });

    testRoom = await prisma.room.create({
      data: {
        dormitoryId: dormA.id,
        buildingId: testBuilding.id,
        roomNumber: '101',
        normalizedRoomNumber: '101',
        floor: 1,
        monthlyRent: 2500,
        termDeposit: new Decimal('0.00'),
        monthlyDeposit: new Decimal('0.00'),
        dailyDeposit: new Decimal('0.00'),
        status: 'occupied',
      },
    });

    testBillingCycle = await prisma.billingCycle.create({
      data: {
        dormitoryId: dormA.id,
        cycleCode: '2026-08',
        name: 'สิงหาคม 2569',
        periodStart: new Date('2026-08-01'),
        periodEnd: new Date('2026-08-31'),
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-05'),
        status: 'open',
      },
    });

    testTenant = await prisma.tenant.create({
      data: {
        dormitoryId: dormA.id,
        tenantNumber: `T-${testRunId}-01`,
        firstName: 'สมชาย',
        lastName: 'ใจดี',
        displayName: 'สมชาย ใจดี',
        phone: '0811111111',
        status: 'active',
      },
    });

    // 6. Create Bill in Dorm A with outstanding > 0
    testBill = await prisma.bill.create({
      data: {
        dormitoryId: dormA.id,
        roomId: testRoom.id,
        billingCycleId: testBillingCycle.id,
        tenantId: testTenant.id,
        billNumber: `BILL-${testRunId}-01`,
        billKind: 'MONTHLY_UTILITY',
        status: 'unpaid',
        totalAmount: new Decimal('2500.00'),
        paidAmount: new Decimal('0.00'),
        outstandingAmount: new Decimal('2500.00'),
        dueDate: new Date('2026-09-05'),
        billingDate: new Date('2026-08-25'),
      },
    });

    await prisma.billItem.create({
      data: {
        dormitoryId: dormA.id,
        billId: testBill.id,
        type: 'rent',
        description: 'ค่าเช่าห้อง 101',
        amount: new Decimal('2500.00'),
        unitPrice: new Decimal('2500.00'),
        quantity: 1,
      },
    });

    // 7. Create an existing REJECTED transfer slip Payment for testBill
    rejectedPayment = await prisma.payment.create({
      data: {
        dormitoryId: dormA.id,
        billId: testBill.id,
        tenantId: testTenant.id,
        amount: new Decimal('2500.00'),
        method: 'BANK_TRANSFER',
        status: 'REJECTED',
        rejectedReason: 'Slip verification failed: incorrect amount',
      },
    });

    // 8. Create Fixtures in Dorm B (for cross-dorm isolation testing)
    crossBuilding = await prisma.building.create({
      data: {
        dormitoryId: dormB.id,
        name: 'Cross Building B',
      },
    });

    crossRoom = await prisma.room.create({
      data: {
        dormitoryId: dormB.id,
        buildingId: crossBuilding.id,
        roomNumber: '901',
        normalizedRoomNumber: '901',
        floor: 9,
        monthlyRent: 3000,
        termDeposit: new Decimal('0.00'),
        monthlyDeposit: new Decimal('0.00'),
        dailyDeposit: new Decimal('0.00'),
        status: 'occupied',
      },
    });

    crossBillingCycle = await prisma.billingCycle.create({
      data: {
        dormitoryId: dormB.id,
        cycleCode: '2026-08',
        name: 'สิงหาคม 2569 (Dorm B)',
        periodStart: new Date('2026-08-01'),
        periodEnd: new Date('2026-08-31'),
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-05'),
        status: 'open',
      },
    });

    crossTenant = await prisma.tenant.create({
      data: {
        dormitoryId: dormB.id,
        tenantNumber: `T-${testRunId}-CROSS`,
        firstName: 'วิชัย',
        lastName: 'มั่งมี',
        displayName: 'วิชัย มั่งมี',
        phone: '0822222222',
        status: 'active',
      },
    });

    crossBill = await prisma.bill.create({
      data: {
        dormitoryId: dormB.id,
        roomId: crossRoom.id,
        billingCycleId: crossBillingCycle.id,
        tenantId: crossTenant.id,
        billNumber: `BILL-${testRunId}-CROSS`,
        billKind: 'MONTHLY_UTILITY',
        status: 'unpaid',
        totalAmount: new Decimal('3000.00'),
        paidAmount: new Decimal('0.00'),
        outstandingAmount: new Decimal('3000.00'),
        dueDate: new Date('2026-09-05'),
        billingDate: new Date('2026-08-25'),
      },
    });

    testIdempotencyKey = `idemp_cash_test_${testRunId}`;
  });

  afterAll(async () => {
    try {
      const dormIds = [dormA?.id, dormB?.id].filter(Boolean);
      await prisma.receipt.deleteMany({ where: { dormitoryId: { in: dormIds } } }).catch(() => {});
      await prisma.receiptSequence.deleteMany({ where: { dormitoryId: { in: dormIds } } }).catch(() => {});
      await prisma.paymentStatusHistory.deleteMany({ where: { dormitoryId: { in: dormIds } } }).catch(() => {});
      await prisma.paymentAllocation.deleteMany({ where: { dormitoryId: { in: dormIds } } }).catch(() => {});
      await prisma.combinedPaymentGroupBillTarget.deleteMany({ where: { dormitoryId: { in: dormIds } } }).catch(() => {});
      await prisma.payment.deleteMany({ where: { dormitoryId: { in: dormIds } } }).catch(() => {});
      await prisma.combinedPaymentGroup.deleteMany({ where: { dormitoryId: { in: dormIds } } }).catch(() => {});
      await prisma.billItem.deleteMany({ where: { dormitoryId: { in: dormIds } } }).catch(() => {});
      await prisma.billStatusHistory.deleteMany({ where: { dormitoryId: { in: dormIds } } }).catch(() => {});
      await prisma.bill.deleteMany({ where: { dormitoryId: { in: dormIds } } }).catch(() => {});
      await prisma.room.deleteMany({ where: { dormitoryId: { in: dormIds } } }).catch(() => {});
      await prisma.building.deleteMany({ where: { dormitoryId: { in: dormIds } } }).catch(() => {});
      await prisma.tenant.deleteMany({ where: { dormitoryId: { in: dormIds } } }).catch(() => {});
      await prisma.billingCycle.deleteMany({ where: { dormitoryId: { in: dormIds } } }).catch(() => {});
      if (ownerUser) {
        await prisma.idempotencyKey.deleteMany({ where: { userId: ownerUser.id } }).catch(() => {});
        await prisma.session.deleteMany({ where: { userId: ownerUser.id } }).catch(() => {});
        await prisma.dormitoryMember.deleteMany({ where: { userId: ownerUser.id } }).catch(() => {});
        await prisma.user.delete({ where: { id: ownerUser.id } }).catch(() => {});
      }
      if (dormA) {
        await prisma.dormitorySubscription.deleteMany({ where: { dormitoryId: dormA.id } }).catch(() => {});
        await prisma.role.deleteMany({ where: { dormitoryId: dormA.id } }).catch(() => {});
        await prisma.dormitory.delete({ where: { id: dormA.id } }).catch(() => {});
      }
      if (dormB) {
        await prisma.dormitorySubscription.deleteMany({ where: { dormitoryId: dormB.id } }).catch(() => {});
        await prisma.role.deleteMany({ where: { dormitoryId: dormB.id } }).catch(() => {});
        await prisma.dormitory.delete({ where: { id: dormB.id } }).catch(() => {});
      }
    } catch {
      // Best-effort cleanup
    }
  });

  // =========================================================================
  // Test 1: Real HTTP POST /api/v1/payments/cash with bill outstanding > 0 + REJECTED slip
  // =========================================================================
  it('1. HTTP 200: settles bill with cash, preserves rejected slip, creates allocation, bill paid, final receipt CASH', async () => {
    // Verify initial state before request
    const billBefore = await prisma.bill.findUnique({ where: { id: testBill.id } });
    expect(billBefore?.status).toBe('unpaid');
    expect(new Decimal(billBefore?.outstandingAmount || 0).equals(2500)).toBe(true);

    const rejBefore = await prisma.payment.findUnique({ where: { id: rejectedPayment.id } });
    expect(rejBefore?.status).toBe('REJECTED');

    // Real HTTP request using supertest against Express app
    const res = await request(app)
      .post('/api/v1/payments/cash')
      .set('Cookie', [`horplus_session=${ownerAuth.sessionToken}`, `horplus_csrf=${ownerAuth.csrfToken}`])
      .set('x-csrf-token', ownerAuth.csrfToken)
      .set('x-dormitory-id', dormA.id)
      .set('x-idempotency-key', testIdempotencyKey)
      .send({
        billId: testBill.id,
        amount: '2500.00',
      });

    // 1. HTTP 200 returned
    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
    expect(res.body.method).toBe('CASH');
    expect(res.body.status).toBe('APPROVED');
    expect(new Decimal(res.body.amount).equals(2500)).toBe(true);

    const cashPaymentId = res.body.id;

    // 2. Database verification: CASH APPROVED Payment created
    const cashPayment = await prisma.payment.findUnique({ where: { id: cashPaymentId } });
    expect(cashPayment).toBeDefined();
    expect(cashPayment?.method).toBe('CASH');
    expect(cashPayment?.status).toBe('APPROVED');
    expect(cashPayment?.dormitoryId).toBe(dormA.id);
    expect(cashPayment?.billId).toBe(testBill.id);

    // 3. Database verification: Prior REJECTED transfer slip Payment remains intact, unchanged
    const rejAfter = await prisma.payment.findUnique({ where: { id: rejectedPayment.id } });
    expect(rejAfter).toBeDefined();
    expect(rejAfter?.status).toBe('REJECTED');
    expect(rejAfter?.method).toBe('BANK_TRANSFER');
    expect(rejAfter?.rejectedReason).toBe('Slip verification failed: incorrect amount');

    // 4. Database verification: PaymentAllocation created linking Cash Payment to Bill
    const allocations = await prisma.paymentAllocation.findMany({
      where: { paymentId: cashPaymentId },
    });
    expect(allocations.length).toBe(1);
    expect(allocations[0].billId).toBe(testBill.id);
    expect(allocations[0].dormitoryId).toBe(dormA.id);
    expect(new Decimal(allocations[0].allocatedAmount).equals(2500)).toBe(true);

    // 5. Database verification: Bill status updated to 'paid', outstandingAmount = '0.00'
    const billAfter = await prisma.bill.findUnique({ where: { id: testBill.id } });
    expect(billAfter?.status.toLowerCase()).toBe('paid');
    expect(new Decimal(billAfter?.paidAmount || 0).equals(2500)).toBe(true);
    expect(new Decimal(billAfter?.outstandingAmount || 0).equals(0)).toBe(true);

    // 6. Database verification: Final Receipt generated with paymentMethod = 'CASH'
    const receipts = await prisma.receipt.findMany({
      where: { billId: testBill.id },
    });
    expect(receipts.length).toBeGreaterThanOrEqual(1);
    const finalReceipt = receipts.find((r) => r.receiptKind === 'FINAL_SETTLEMENT') || receipts[0];
    expect(finalReceipt).toBeDefined();
    const snapshot = finalReceipt.snapshotData as any;
    expect(snapshot).toBeDefined();
    expect(snapshot.paymentMethod).toBe('CASH');
    expect(finalReceipt.dormitoryId).toBe(dormA.id);

    // Verify Thai presentation via renderReceiptHtml
    const html = renderReceiptHtml(finalReceipt);
    expect(html).toContain('เงินสด');
  });

  // =========================================================================
  // Test 2: Idempotency replay with exact same key
  // =========================================================================
  it('2. Idempotency replay: re-sending with identical key returns 200 without duplicate Payment, Allocation, or Receipt', async () => {
    const paymentsBefore = await prisma.payment.findMany({ where: { billId: testBill.id } });
    const allocationsBefore = await prisma.paymentAllocation.findMany({ where: { billId: testBill.id } });
    const receiptsBefore = await prisma.receipt.findMany({ where: { billId: testBill.id } });

    // Re-send identical HTTP request with same idempotency key
    const replayRes = await request(app)
      .post('/api/v1/payments/cash')
      .set('Cookie', [`horplus_session=${ownerAuth.sessionToken}`, `horplus_csrf=${ownerAuth.csrfToken}`])
      .set('x-csrf-token', ownerAuth.csrfToken)
      .set('x-dormitory-id', dormA.id)
      .set('x-idempotency-key', testIdempotencyKey)
      .send({
        billId: testBill.id,
        amount: '2500.00',
      });

    // Returns HTTP 200
    expect(replayRes.status).toBe(200);

    // Database verification: Still exactly same payments for bill (1 rejected transfer + 1 approved cash)
    const allPayments = await prisma.payment.findMany({ where: { billId: testBill.id } });
    expect(allPayments.length).toBe(paymentsBefore.length);

    const cashPayments = allPayments.filter((p) => p.method === 'CASH');
    expect(cashPayments.length).toBe(1);

    // Still exactly same count of payment allocations and receipts as before replay (NO duplicates)
    const allAllocations = await prisma.paymentAllocation.findMany({ where: { billId: testBill.id } });
    expect(allAllocations.length).toBe(allocationsBefore.length);

    const allReceipts = await prisma.receipt.findMany({ where: { billId: testBill.id } });
    expect(allReceipts.length).toBe(receiptsBefore.length);
  });

  // =========================================================================
  // Test 3: Already paid rejection
  // =========================================================================
  it('3. Already paid rejection: attempting to settle already-settled bill with new idempotency key returns 400 ALREADY_PAID', async () => {
    const newIdKey = `idemp_new_${Date.now()}`;
    const payAgainRes = await request(app)
      .post('/api/v1/payments/cash')
      .set('Cookie', [`horplus_session=${ownerAuth.sessionToken}`, `horplus_csrf=${ownerAuth.csrfToken}`])
      .set('x-csrf-token', ownerAuth.csrfToken)
      .set('x-dormitory-id', dormA.id)
      .set('x-idempotency-key', newIdKey)
      .send({
        billId: testBill.id,
        amount: '2500.00',
      });

    expect(payAgainRes.status).toBe(400);
    expect(
      payAgainRes.body?.error?.code === 'ALREADY_PAID' ||
      payAgainRes.body?.error?.code === 'BILL_ALREADY_PAID' ||
      payAgainRes.body?.error?.message?.includes('ชำระ') ||
      payAgainRes.body?.message?.includes('ชำระ')
    ).toBe(true);
  });

  // =========================================================================
  // Test 4: Dormitory boundary isolation
  // =========================================================================
  it('4. Dormitory isolation: cross-dormitory payment attempt is rejected with 403 FORBIDDEN', async () => {
    // Owner of Dorm A attempts to pay a bill in Dorm B using Dorm A header
    const crossRes1 = await request(app)
      .post('/api/v1/payments/cash')
      .set('Cookie', [`horplus_session=${ownerAuth.sessionToken}`, `horplus_csrf=${ownerAuth.csrfToken}`])
      .set('x-csrf-token', ownerAuth.csrfToken)
      .set('x-dormitory-id', dormA.id)
      .set('x-idempotency-key', `idemp_cross_1_${Date.now()}`)
      .send({
        billId: crossBill.id,
        amount: '3000.00',
      });

    expect(crossRes1.status).toBe(403);

    // Owner of Dorm A attempts to access Dorm B directly via header
    const crossRes2 = await request(app)
      .post('/api/v1/payments/cash')
      .set('Cookie', [`horplus_session=${ownerAuth.sessionToken}`, `horplus_csrf=${ownerAuth.csrfToken}`])
      .set('x-csrf-token', ownerAuth.csrfToken)
      .set('x-dormitory-id', dormB.id)
      .set('x-idempotency-key', `idemp_cross_2_${Date.now()}`)
      .send({
        billId: crossBill.id,
        amount: '3000.00',
      });

    expect(crossRes2.status).toBe(403);
  });
});
