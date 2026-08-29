/**
 * @license Apache-2.0
 * OWNER R3.8a — Real Express Route Integration & Concurrency Proof Tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from '../../server/node_modules/supertest/index.js';
import { createApp } from '../../server/src/app.js';
import { getEnv, resetCachedEnv } from '../../server/src/config/env.js';
import { getPrismaClient } from '../../server/src/db/prisma.js';
import { AuthenticationService } from '../../server/src/services/auth.service.js';
import { PrismaUserRepository } from '../../server/src/db/repositories/user.repository.js';
import { PrismaSessionRepository } from '../../server/src/db/repositories/session.repository.js';
import { PrismaMembershipRepository } from '../../server/src/db/repositories/membership.repository.js';
import { PrismaRoleRepository } from '../../server/src/db/repositories/role.repository.js';
import { subscriptionEntitlementService } from '../../server/src/services/subscription-entitlement.service.js';

const prisma = getPrismaClient();

describe('R3.8a Real Express Route Integration & PostgreSQL Concurrency', () => {
  let app: any;
  let authService: AuthenticationService;
  let ownerUserId: string;
  let ownerSessionToken: string;
  let ownerCsrfToken: string;
  let dormId: string;
  let buildingId: string;
  let cycleId: string;
  let tenantId: string;

  const testBillIds: string[] = [];

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.E2E_TEST_MODE = 'true';
    resetCachedEnv();

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

    // 1. Seed Owner User & Dormitory
    const ownerEmail = `r38a_owner_${Date.now()}@example.com`;
    const ownerUser = await prisma.user.create({
      data: {
        googleSubject: `sub_r38a_${Date.now()}`,
        email: ownerEmail,
        emailNormalized: ownerEmail.toLowerCase(),
        name: 'R3.8a Owner',
      },
    });
    ownerUserId = ownerUser.id;

    const dorm = await prisma.dormitory.create({
      data: {
        name: 'R3.8a Test Dorm',
        type: 'apartment',
        createdByUserId: ownerUserId,
        status: 'active',
        billingSettings: {
          create: {
            billingDay: 25,
            dueDay: 5,
            cashAccepted: true,
          },
        },
      },
    });
    dormId = dorm.id;

    const freePlan = await prisma.subscriptionPlan.findFirst({ where: { code: 'FREE_TRIAL' } })
      || await prisma.subscriptionPlan.findFirst();

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

    const building = await prisma.building.create({
      data: {
        dormitoryId: dormId,
        name: 'Building A',
      },
    });
    buildingId = building.id;

    const ownerRole = await prisma.role.create({
      data: {
        dormitoryId: dormId,
        code: 'OWNER',
        name: 'Owner',
        permissions: {
          '*': ['*'],
        },
        isSystem: true,
      },
    });

    await prisma.dormitoryMember.create({
      data: {
        dormitoryId: dormId,
        userId: ownerUserId,
        roleId: ownerRole.id,
        status: 'active',
        membershipOrigin: 'GOOGLE_BOOTSTRAP',
      },
    });

    const ownerAuth = await authService.authenticateTestUser(ownerUserId);
    ownerSessionToken = ownerAuth.sessionToken;
    ownerCsrfToken = ownerAuth.csrfToken;

    // 2. Seed Billing Cycle & Rate Snapshot
    const cycle = await prisma.billingCycle.create({
      data: {
        dormitoryId: dormId,
        name: 'สิงหาคม 2569',
        cycleCode: '2026-08',
        periodStart: new Date('2026-08-01'),
        periodEnd: new Date('2026-08-31'),
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-05'),
        status: 'open',
      },
    });
    cycleId = cycle.id;

    await prisma.billingRateSnapshot.create({
      data: {
        dormitoryId: dormId,
        billingCycleId: cycleId,
        waterBillingType: 'PER_UNIT',
        waterRate: '18.00',
        electricityBillingType: 'PER_UNIT',
        electricityRate: '8.00',
        commonFee: '0.00',
        commonFeeMode: 'FIXED',
        internetFee: '0.00',
        internetFeeMode: 'FIXED',
        parkingFee: '0.00',
        parkingFeeMode: 'FIXED',
        lateFeeType: 'FIXED',
        lateFeeValue: '0.00',
        currency: 'THB',
        source: 'TEMPLATE_DEFAULT',
      },
    });

    const tenant = await prisma.tenant.create({
      data: {
        dormitoryId: dormId,
        tenantNumber: 'T-104-R38A',
        firstName: 'Somchai',
        lastName: 'R38a',
        displayName: 'Somchai R38a',
        phone: '0812345678',
      },
    });
    tenantId = tenant.id;
  });

  afterAll(async () => {
    try {
      if (testBillIds.length > 0) {
        await prisma.paymentStatusHistory.deleteMany({ where: { payment: { billId: { in: testBillIds } } } });
        await prisma.receipt.deleteMany({ where: { billId: { in: testBillIds } } });
        await prisma.payment.deleteMany({ where: { billId: { in: testBillIds } } });
        await prisma.billItem.deleteMany({ where: { billId: { in: testBillIds } } });
        await prisma.billStatusHistory.deleteMany({ where: { billId: { in: testBillIds } } });
        await prisma.bill.deleteMany({ where: { id: { in: testBillIds } } });
      }
      if (dormId) {
        await prisma.receiptSequence.deleteMany({ where: { dormitoryId: dormId } });
        await prisma.billingRateSnapshot.deleteMany({ where: { dormitoryId: dormId } });
        await prisma.dormitorySubscription.deleteMany({ where: { dormitoryId: dormId } });
        await prisma.meterReading.deleteMany({ where: { dormitoryId: dormId } });
        await prisma.tenant.deleteMany({ where: { dormitoryId: dormId } });
        await prisma.room.deleteMany({ where: { dormitoryId: dormId } });
        await prisma.building.deleteMany({ where: { dormitoryId: dormId } });
        await prisma.billingCycle.deleteMany({ where: { dormitoryId: dormId } });
        await prisma.dormitoryBillingSettings.deleteMany({ where: { dormitoryId: dormId } });
        await prisma.dormitoryMember.deleteMany({ where: { dormitoryId: dormId } });
        await prisma.role.deleteMany({ where: { dormitoryId: dormId } });
        await prisma.session.deleteMany({ where: { userId: ownerUserId } });
        await prisma.dormitory.deleteMany({ where: { id: dormId } });
        await prisma.user.deleteMany({ where: { id: ownerUserId } });
      }
    } catch (err) {
      console.error('Cleanup error in r38a test:', err);
    }
  });

  it('1. Real Route POST /api/v1/payments/cash: successful partial final settlement', async () => {
    const room1 = await prisma.room.create({
      data: {
        dormitoryId: dormId,
        buildingId,
        roomNumber: '101-R38A',
        normalizedRoomNumber: '101-R38A',
        floor: 1,
        status: 'occupied',
        termDeposit: '4800.00',
        monthlyDeposit: '4800.00',
        dailyDeposit: '0.00',
      },
    });

    // Seed Bill with Total: 10,600, Paid: 3,000, Outstanding: 7,600
    const bill = await prisma.bill.create({
      data: {
        dormitoryId: dormId,
        billingCycleId: cycleId,
        roomId: room1.id,
        tenantId,
        billNumber: `INV-R38A-PARTIAL-${Date.now()}`,
        billKind: 'MONTHLY_UTILITY',
        status: 'unpaid',
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-05'),
        subtotal: '10600.00',
        totalAmount: '10600.00',
        paidAmount: '3000.00',
        outstandingAmount: '7600.00',
        items: {
          create: [
            { dormitoryId: dormId, type: 'RENT', description: 'ค่าเช่าห้อง', unitPrice: '4800.00', amount: '4800.00', displayOrder: 1 },
            { dormitoryId: dormId, type: 'DEPOSIT', description: 'เงินประกัน', unitPrice: '4800.00', amount: '4800.00', displayOrder: 2 },
            { dormitoryId: dormId, type: 'UTILITY_MONTHLY', description: 'ค่าน้ำค่าไฟ', unitPrice: '1000.00', amount: '1000.00', displayOrder: 3 },
          ],
        },
      },
    });
    testBillIds.push(bill.id);

    const res = await request(app)
      .post('/api/v1/payments/cash')
      .set('Cookie', `horplus_session=${ownerSessionToken}; horplus_csrf=${ownerCsrfToken}`)
      .set('x-csrf-token', ownerCsrfToken)
      .set('x-dormitory-id', dormId)
      .set('x-idempotency-key', `idemp-${Date.now()}`)
      .send({
        billId: bill.id,
        amount: '7600.00',
      });

    expect(res.status).toBe(200);
    expect(res.body.amount.toString()).toBe('7600');
    expect(res.body.status).toBe('APPROVED');

    // Verify Database state
    const updatedBill = await prisma.bill.findUnique({ where: { id: bill.id } });
    expect(updatedBill?.status).toBe('PAID');
    expect(updatedBill?.paidAmount.toString()).toBe('10600');
    expect(updatedBill?.outstandingAmount.toString()).toBe('0');

    // Verify Receipt
    const receipt = await prisma.receipt.findFirst({ where: { billId: bill.id } });
    expect(receipt).not.toBeNull();
    const snap = receipt?.snapshotData as any;
    expect(snap.total).toBe('7600.00');
    expect(snap.items[0].description).toContain('ชำระยอดคงเหลือบิล');
  });

  it('2. Real Route POST /api/v1/payments/cash: wrong amount returns HTTP 400 UNSUPPORTED_AMOUNT with structured envelope', async () => {
    const room2 = await prisma.room.create({
      data: {
        dormitoryId: dormId,
        buildingId,
        roomNumber: '102-R38A',
        normalizedRoomNumber: '102-R38A',
        floor: 1,
        status: 'occupied',
        termDeposit: '4800.00',
        monthlyDeposit: '4800.00',
        dailyDeposit: '0.00',
      },
    });

    const bill = await prisma.bill.create({
      data: {
        dormitoryId: dormId,
        billingCycleId: cycleId,
        roomId: room2.id,
        tenantId,
        billNumber: `INV-R38A-WRONG-${Date.now()}`,
        billKind: 'MONTHLY_UTILITY',
        status: 'unpaid',
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-05'),
        subtotal: '10600.00',
        totalAmount: '10600.00',
        paidAmount: '3000.00',
        outstandingAmount: '7600.00',
      },
    });
    testBillIds.push(bill.id);

    const res = await request(app)
      .post('/api/v1/payments/cash')
      .set('Cookie', `horplus_session=${ownerSessionToken}; horplus_csrf=${ownerCsrfToken}`)
      .set('x-csrf-token', ownerCsrfToken)
      .set('x-dormitory-id', dormId)
      .set('x-idempotency-key', `idemp-wrong-${Date.now()}`)
      .send({
        billId: bill.id,
        amount: '10600.00', // Submitted full amount when outstanding is 7,600
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('UNSUPPORTED_AMOUNT');
    expect(res.body.error.message).toBe('ยอดเงินที่ชำระไม่ตรงกับยอดคงเหลือของบิล');
    expect(res.body.error.requestId).toBeDefined();
  });

  it('3. Real Route GET /api/v1/payments: returns all 5 BillItems without slicing', async () => {
    const room3 = await prisma.room.create({
      data: {
        dormitoryId: dormId,
        buildingId,
        roomNumber: '103-R38A',
        normalizedRoomNumber: '103-R38A',
        floor: 1,
        status: 'occupied',
        termDeposit: '4800.00',
        monthlyDeposit: '4800.00',
        dailyDeposit: '0.00',
      },
    });

    const bill = await prisma.bill.create({
      data: {
        dormitoryId: dormId,
        billingCycleId: cycleId,
        roomId: room3.id,
        tenantId,
        billNumber: `INV-R38A-5ITEMS-${Date.now()}`,
        billKind: 'MONTHLY_UTILITY',
        status: 'paid',
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-05'),
        subtotal: '5500.00',
        totalAmount: '5500.00',
        paidAmount: '5500.00',
        outstandingAmount: '0.00',
        items: {
          create: [
            { dormitoryId: dormId, type: 'RENT', description: 'ค่าเช่าห้อง', unitPrice: '4000.00', amount: '4000.00', displayOrder: 1 },
            { dormitoryId: dormId, type: 'WATER', description: 'ค่าน้ำ', unitPrice: '200.00', amount: '200.00', displayOrder: 2 },
            { dormitoryId: dormId, type: 'ELECTRIC', description: 'ค่าไฟ', unitPrice: '800.00', amount: '800.00', displayOrder: 3 },
            { dormitoryId: dormId, type: 'OTHER', description: 'ค่าที่จอดรถ', unitPrice: '300.00', amount: '300.00', displayOrder: 4 },
            { dormitoryId: dormId, type: 'OTHER', description: 'ค่าอินเทอร์เน็ต', unitPrice: '200.00', amount: '200.00', displayOrder: 5 },
          ],
        },
        Payment: {
          create: {
            dormitoryId: dormId,
            tenantId,
            method: 'CASH',
            amount: '5500.00',
            status: 'APPROVED',
            paymentDate: new Date(),
          },
        },
      },
      include: {
        Payment: true,
      },
    });
    testBillIds.push(bill.id);

    const res = await request(app)
      .get('/api/v1/payments')
      .set('Cookie', `horplus_session=${ownerSessionToken}; horplus_csrf=${ownerCsrfToken}`)
      .set('x-dormitory-id', dormId);

    expect(res.status).toBe(200);
    const paymentsList = Array.isArray(res.body) ? res.body : res.body.data;
    expect(Array.isArray(paymentsList)).toBe(true);
    const paymentRecord = paymentsList.find((p: any) => p.billId === bill.id);
    expect(paymentRecord).toBeDefined();
    expect(paymentRecord.bill).toBeDefined();
    expect(paymentRecord.bill.items).toBeDefined();
    expect(paymentRecord.bill.items.length).toBe(5);
    expect(paymentRecord.bill.items.map((it: any) => it.description)).toEqual([
      'ค่าเช่าห้อง',
      'ค่าน้ำ',
      'ค่าไฟ',
      'ค่าที่จอดรถ',
      'ค่าอินเทอร์เน็ต',
    ]);
  });

  it('4. Real PostgreSQL Concurrency (Part G): 2 concurrent cash requests with different idempotency keys serialize safely', async () => {
    const room4 = await prisma.room.create({
      data: {
        dormitoryId: dormId,
        buildingId,
        roomNumber: '104-R38A-CONCURRENT',
        normalizedRoomNumber: '104-R38A-CONCURRENT',
        floor: 1,
        status: 'occupied',
        termDeposit: '4800.00',
        monthlyDeposit: '4800.00',
        dailyDeposit: '0.00',
      },
    });

    // Seed Bill (total: 10,600, paid: 3,000, outstanding: 7,600)
    const bill = await prisma.bill.create({
      data: {
        dormitoryId: dormId,
        billingCycleId: cycleId,
        roomId: room4.id,
        tenantId,
        billNumber: `INV-R38A-CONCURRENT-${Date.now()}`,
        billKind: 'MONTHLY_UTILITY',
        status: 'unpaid',
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-05'),
        subtotal: '10600.00',
        totalAmount: '10600.00',
        paidAmount: '3000.00',
        outstandingAmount: '7600.00',
        items: {
          create: [
            { dormitoryId: dormId, type: 'RENT', description: 'ค่าเช่าห้อง', unitPrice: '4800.00', amount: '4800.00', displayOrder: 1 },
            { dormitoryId: dormId, type: 'DEPOSIT', description: 'เงินประกัน', unitPrice: '4800.00', amount: '4800.00', displayOrder: 2 },
            { dormitoryId: dormId, type: 'UTILITY_MONTHLY', description: 'ค่าน้ำค่าไฟ', unitPrice: '1000.00', amount: '1000.00', displayOrder: 3 },
          ],
        },
      },
    });
    testBillIds.push(bill.id);

    // Fire 2 concurrent requests with DIFFERENT idempotency keys
    const reqA = request(app)
      .post('/api/v1/payments/cash')
      .set('Cookie', `horplus_session=${ownerSessionToken}; horplus_csrf=${ownerCsrfToken}`)
      .set('x-csrf-token', ownerCsrfToken)
      .set('x-dormitory-id', dormId)
      .set('x-idempotency-key', `concurrent-key-A-${Date.now()}`)
      .send({ billId: bill.id, amount: '7600.00' });

    const reqB = request(app)
      .post('/api/v1/payments/cash')
      .set('Cookie', `horplus_session=${ownerSessionToken}; horplus_csrf=${ownerCsrfToken}`)
      .set('x-csrf-token', ownerCsrfToken)
      .set('x-dormitory-id', dormId)
      .set('x-idempotency-key', `concurrent-key-B-${Date.now()}`)
      .send({ billId: bill.id, amount: '7600.00' });

    const [resA, resB] = await Promise.all([reqA, reqB]);

    const results = [resA, resB];
    const successCount = results.filter((r) => r.status === 200 || r.status === 201).length;
    const failCount = results.filter((r) => r.status === 400).length;

    expect(successCount).toBe(1);
    expect(failCount).toBe(1);

    const failedRes = results.find((r) => r.status === 400);
    expect(failedRes?.body.error.code).toBe('ALREADY_PAID');

    // Database verification: Exactly 1 new Payment, 1 new Receipt, Bill paidAmount = 10,600, outstanding = 0
    const payments = await prisma.payment.findMany({ where: { billId: bill.id } });
    expect(payments.length).toBe(1);
    expect(payments[0].amount.toString()).toBe('7600');

    const receipts = await prisma.receipt.findMany({ where: { billId: bill.id } });
    expect(receipts.length).toBe(1);

    const finalBill = await prisma.bill.findUnique({ where: { id: bill.id } });
    expect(finalBill?.status).toBe('PAID');
    expect(finalBill?.paidAmount.toString()).toBe('10600');
    expect(finalBill?.outstandingAmount.toString()).toBe('0');
  });

  it('5. Meter Backend Defense (Part C): clean row is NO-OP and does not trigger false CANNOT_CLEAR_METER_READING_FOR_ISSUED_BILL', async () => {
    const room5 = await prisma.room.create({
      data: {
        dormitoryId: dormId,
        buildingId,
        roomNumber: '105-R38A-DEFENSE',
        normalizedRoomNumber: '105-R38A-DEFENSE',
        floor: 1,
        status: 'occupied',
        termDeposit: '4800.00',
        monthlyDeposit: '4800.00',
        dailyDeposit: '0.00',
      },
    });

    // Seed an issued unpaid bill for room
    const issuedBill = await prisma.bill.create({
      data: {
        dormitoryId: dormId,
        billingCycleId: cycleId,
        roomId: room5.id,
        tenantId,
        billNumber: `INV-METER-DEFENSE-${Date.now()}`,
        billKind: 'MONTHLY_UTILITY',
        status: 'unpaid',
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-05'),
        subtotal: '4000.00',
        totalAmount: '4000.00',
        paidAmount: '0.00',
        outstandingAmount: '4000.00',
      },
    });
    testBillIds.push(issuedBill.id);

    // POST bulk with only { roomId } (clean row)
    const resClean = await request(app)
      .post('/api/v1/meters/workspace/bulk')
      .set('Cookie', `horplus_session=${ownerSessionToken}; horplus_csrf=${ownerCsrfToken}`)
      .set('x-csrf-token', ownerCsrfToken)
      .set('x-dormitory-id', dormId)
      .send({
        billingCycleId: cycleId,
        rows: [{ roomId: room5.id }],
      });

    expect(resClean.status).toBe(200);
    expect(resClean.body.success).toBe(true);

    // POST bulk with explicit waterCurr: null (explicit clear on issued bill) -> MUST fail 400
    const resExplicitClear = await request(app)
      .post('/api/v1/meters/workspace/bulk')
      .set('Cookie', `horplus_session=${ownerSessionToken}; horplus_csrf=${ownerCsrfToken}`)
      .set('x-csrf-token', ownerCsrfToken)
      .set('x-dormitory-id', dormId)
      .send({
        billingCycleId: cycleId,
        rows: [{ roomId: room5.id, waterCurr: null }],
      });

    expect(resExplicitClear.status).toBe(400);
    expect(resExplicitClear.body.error?.code || resExplicitClear.body.code).toBe('CANNOT_CLEAR_METER_READING_FOR_ISSUED_BILL');
  });
});
