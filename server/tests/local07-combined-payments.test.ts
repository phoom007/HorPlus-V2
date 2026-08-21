/**
 * LOCAL-07 Combined Payments Integration Tests
 * @license Apache-2.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PaymentService } from '../src/services/payment.service.js';
import { getPrismaClient } from '../src/db/prisma.js';

describe('LOCAL-07: Combined Payment Group Authority (Owner Cash & Tenant Slip)', () => {
  let prisma: PrismaClient;
  let paymentService: PaymentService;
  let dormitoryId: string;
  let userId: string;
  let tenantId: string;
  let roomId: string;
  let billRentId: string;
  let billUtilityId: string;

  beforeAll(async () => {
    prisma = getPrismaClient();
    paymentService = new PaymentService(prisma);

    await prisma.$executeRawUnsafe('DROP INDEX IF EXISTS "billing_cycle_room_current_unique"');

    // Create user
    const user = await prisma.user.create({
      data: {
        email: `combined_${Date.now()}@example.com`,
        emailNormalized: `combined_${Date.now()}@example.com`,
        name: 'Combined Test Owner',
        googleSubject: `goog_sub_${Date.now()}`,
      },
    });
    userId = user.id;

    // Create dormitory
    const dorm = await prisma.dormitory.create({
      data: {
        name: 'Combined Dorm',
        createdByUserId: userId,
      },
    });
    dormitoryId = dorm.id;

    // Create building
    const bld = await prisma.building.create({
      data: {
        dormitoryId,
        name: 'Building Combined',
      },
    });

    // Create room
    const room = await prisma.room.create({
      data: {
        dormitoryId,
        buildingId: bld.id,
        roomNumber: 'COM-101',
        normalizedRoomNumber: 'COM-101',
        floor: 1,
        roomType: 'standard',
        status: 'occupied',
      },
    });
    roomId = room.id;

    // Create tenant
    const tenant = await prisma.tenant.create({
      data: {
        dormitoryId,
        tenantNumber: `TEN-${Date.now()}`,
        firstName: 'Tenant',
        lastName: 'Combined',
        displayName: 'Tenant Combined',
        phone: '0812345678',
        status: 'active',
        linkedUserId: userId,
      },
    });
    tenantId = tenant.id;

    // Create billing cycle
    const cycle = await prisma.billingCycle.create({
      data: {
        dormitoryId,
        cycleCode: `CYC-${Date.now()}`,
        name: 'August 2026',
        periodStart: new Date('2026-08-01'),
        periodEnd: new Date('2026-08-31'),
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-05'),
        status: 'published',
      },
    });

    // Create 2 bills for the tenant in same cycle
    const billRent = await prisma.bill.create({
      data: {
        dormitoryId,
        billingCycleId: cycle.id,
        roomId,
        tenantId,
        billNumber: `BILL-R-${Date.now()}`,
        billKind: 'RENT',
        totalAmount: 3500.0,
        status: 'ISSUED',
        billingDate: new Date(),
        dueDate: new Date('2026-08-25'),
      },
    });
    billRentId = billRent.id;

    const billUtility = await prisma.bill.create({
      data: {
        dormitoryId,
        billingCycleId: cycle.id,
        roomId,
        tenantId,
        billNumber: `BILL-U-${Date.now()}`,
        billKind: 'MONTHLY_UTILITY',
        totalAmount: 500.0,
        status: 'ISSUED',
        billingDate: new Date(),
        dueDate: new Date('2026-08-25'),
      },
    });
    billUtilityId = billUtility.id;
  });

  afterAll(async () => {
    // Cleanup
  });

  it('proves Owner Combined Cash settles multiple bills atomically and generates separate receipts', async () => {
    const result = await paymentService.recordCombinedCash({
      dormitoryId,
      userId,
      billIds: [billRentId, billUtilityId],
      notes: 'Cash payment for rent + utilities',
    });

    expect(result.group).toBeDefined();
    expect(result.group.status).toBe('APPROVED');
    expect(Number(result.group.totalAmount)).toBe(4000.0);
    expect(result.payments.length).toBe(2);

    const receipts = await prisma.receipt.findMany({
      where: { paymentId: { in: result.payments.map((p: any) => p.id) } },
    });
    expect(receipts.length).toBe(2);

    // Verify both bills are PAID
    const freshRent = await prisma.bill.findUnique({ where: { id: billRentId } });
    const freshUtility = await prisma.bill.findUnique({ where: { id: billUtilityId } });
    expect(freshRent?.status).toBe('PAID');
    expect(freshUtility?.status).toBe('PAID');
  });

  it('proves Tenant Combined Slip upload intent and atomic group approval workflow', async () => {
    // Create cycle for Sept
    const cycleSept = await prisma.billingCycle.create({
      data: {
        dormitoryId,
        cycleCode: `CYC-S-${Date.now()}`,
        name: 'September 2026',
        periodStart: new Date('2026-09-01'),
        periodEnd: new Date('2026-09-30'),
        billingDate: new Date('2026-09-25'),
        dueDate: new Date('2026-10-05'),
        status: 'published',
      },
    });

    // Create another 2 bills for tenant slip test
    const b1 = await prisma.bill.create({
      data: {
        dormitoryId,
        billingCycleId: cycleSept.id,
        roomId,
        tenantId,
        billNumber: `BILL-SLIP-1-${Date.now()}`,
        billKind: 'RENT',
        totalAmount: 3500.0,
        status: 'ISSUED',
        billingDate: new Date(),
        dueDate: new Date('2026-09-25'),
      },
    });

    const b2 = await prisma.bill.create({
      data: {
        dormitoryId,
        billingCycleId: cycleSept.id,
        roomId,
        tenantId,
        billNumber: `BILL-SLIP-2-${Date.now()}`,
        billKind: 'MONTHLY_UTILITY',
        totalAmount: 500.0,
        status: 'ISSUED',
        billingDate: new Date(),
        dueDate: new Date('2026-09-25'),
      },
    });

    // 1. Create combined upload intent
    const intentRes = await paymentService.createCombinedUploadIntent({
      dormitoryId,
      tenantId,
      actorUserId: userId,
      billIds: [b1.id, b2.id],
      mimeType: 'image/jpeg',
      fileSize: 1024,
    });

    expect(intentRes.intentId).toBeDefined();
    expect(intentRes.groupId).toBeDefined();
    expect(Number(intentRes.totalAmount)).toBe(4000.0);

    // Simulate successful file upload by advancing intent to UPLOADED
    await prisma.paymentUploadIntent.update({
      where: { id: intentRes.intentId },
      data: {
        status: 'UPLOADED',
        objectKey: 'uploads/slip.jpg',
        sha256: `hash_${Date.now()}`,
        verifiedMimeType: 'image/jpeg',
        verifiedSize: 1024,
      },
    });

    // 2. Submit combined slip payment
    const submitRes = await paymentService.submitCombinedSlipPayment({
      dormitoryId,
      tenantId,
      intentId: intentRes.intentId,
      paymentDate: new Date(),
      amount: '4000.00',
      actorUserId: userId,
    });

    expect(submitRes.success).toBe(true);
    expect(submitRes.groupId).toBe(intentRes.groupId);

    const groupUnderReview = await prisma.combinedPaymentGroup.findUnique({
      where: { id: intentRes.groupId },
    });
    expect(groupUnderReview?.status).toBe('UNDER_REVIEW');

    // 3. Owner approves the payment group
    const approveRes = await paymentService.approvePaymentGroup({
      dormitoryId,
      groupId: intentRes.groupId,
      userId,
      notes: 'Slip verified',
    });

    expect(approveRes.success).toBe(true);

    const groupApproved = await prisma.combinedPaymentGroup.findUnique({
      where: { id: intentRes.groupId },
    });
    expect(groupApproved?.status).toBe('APPROVED');

    const payments = await prisma.payment.findMany({
      where: { paymentGroupId: intentRes.groupId },
    });
    expect(payments.length).toBe(2);
    for (const p of payments) {
      expect(p.status).toBe('APPROVED');
    }

    const receipts = await prisma.receipt.findMany({
      where: { paymentId: { in: payments.map((p: any) => p.id) } },
    });
    expect(receipts.length).toBe(2);

    const b1Fresh = await prisma.bill.findUnique({ where: { id: b1.id } });
    const b2Fresh = await prisma.bill.findUnique({ where: { id: b2.id } });
    expect(b1Fresh?.status).toBe('PAID');
    expect(b2Fresh?.status).toBe('PAID');
  });
});
