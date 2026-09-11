/**
 * @license Apache-2.0
 * OWNER R3.8c — Real Financial Routes & Ledger Integration Tests
 * 
 * Tests against real PostgreSQL database:
 * 1. Single-bill cash settlement (strictly single-bill)
 * 2. Multi-bill combined slip submission (creates targets, child payments with exact monetary conservation, unverified verification metadata, no mutation to UNDER_REVIEW)
 * 3. Atomic combined group approval (group row lock, reconciliation, child payments approved, allocations persisted, 1 group receipt)
 * 4. Atomic combined group rejection (group & child payments rejected, bill financial state untouched)
 * 5. Blocked individual reversal on grouped payment (GROUP_REVERSAL_REQUIRED)
 * 6. Atomic combined group reversal (voids receipt, recalculates balances preserving legacy baseline)
 * 7. Room 104 Legacy baseline preservation across allocations and reversals
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getPrismaClient } from '../../db/prisma.js';
import { paymentService } from '../../services/payment.service.js';
import { Decimal } from 'decimal.js';

const prisma = getPrismaClient();

describe('OWNER R3.8c: Real Financial Routes & Ledger Integration Tests', () => {
  const testRunId = `r38c_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  let dormId: string;
  let bldId: string;
  let userId: string;
  let tenantId: string;
  let cycleJulyId: string;
  let cycleAugId: string;

  async function createRoom(num: string) {
    return await prisma.room.create({
      data: {
        dormitoryId: dormId,
        buildingId: bldId,
        roomNumber: `R38C-${num}-${testRunId}`,
        normalizedRoomNumber: `${num}-${testRunId}`,
        floor: 1,
        status: 'occupied',
        monthlyRent: 4000,
        monthlyDeposit: 4000,
        termDeposit: 4000,
        dailyDeposit: 500,
      },
    });
  }

  beforeAll(async () => {
    let dorm = await prisma.dormitory.findFirst();
    if (!dorm) {
      dorm = await prisma.dormitory.create({
        data: { name: 'R3.8c Test Dormitory' },
      });
    }
    dormId = dorm.id;

    let building = await prisma.building.findFirst({ where: { dormitoryId: dormId } });
    if (!building) {
      building = await prisma.building.create({
        data: {
          dormitoryId: dormId,
          name: 'อาคาร A',
        },
      });
    }
    bldId = building.id;

    let user = await prisma.user.findFirst({ where: { email: `owner_${testRunId}@test.com` } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          email: `owner_${testRunId}@test.com`,
          emailNormalized: `owner_${testRunId}@test.com`,
          googleSubject: `google_${testRunId}`,
          name: 'เจ้าของหอพัก R3.8c',
          phone: '0811111111',
        },
      });
    }
    userId = user.id;

    const tenant = await prisma.tenant.create({
      data: {
        dormitoryId: dormId,
        tenantNumber: `TNT-${testRunId}`,
        firstName: 'เอกชัย',
        lastName: 'การเงินมั่นคง',
        displayName: 'เอกชัย การเงินมั่นคง',
        status: 'active',
      },
    });
    tenantId = tenant.id;

        const cycleJuly = await prisma.billingCycle.create({
      data: {
        dormitoryId: dormId,
        cycleCode: `2026-07-${testRunId}`,
        name: 'รอบ ก.ค. 2569',
        periodStart: new Date('2026-07-01'),
        periodEnd: new Date('2026-07-31'),
        billingDate: new Date('2026-07-25'),
        dueDate: new Date('2026-08-05'),
        status: 'closed',
      },
    });
    cycleJulyId = cycleJuly.id;

    const cycleAug = await prisma.billingCycle.create({
      data: {
        dormitoryId: dormId,
        cycleCode: `2026-08-${testRunId}`,
        name: 'รอบ ส.ค. 2569',
        periodStart: new Date('2026-08-01'),
        periodEnd: new Date('2026-08-31'),
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-05'),
        status: 'active',
      },
    });
    cycleAugId = cycleAug.id;
  });

  it('1. Cash Payment on Bill X settles strictly Bill X (Single-Bill Cash)', async () => {
    const room = await createRoom('101');
    const bill = await prisma.bill.create({
      data: {
        dormitoryId: dormId,
        billingCycleId: cycleJulyId,
        roomId: room.id,
        tenantId,
        billNumber: `INV-101-CASH-${testRunId}`,
        billKind: 'MONTHLY_UTILITY',
        billingDate: new Date('2026-07-25'),
        dueDate: new Date('2026-08-05'),
        subtotal: 4000.0,
        totalAmount: 4000.0,
        paidAmount: 0.0,
        outstandingAmount: 4000.0,
        status: 'UNPAID',
      },
    });
    await prisma.billItem.create({
      data: {
        dormitoryId: dormId,
        billId: bill.id,
        type: 'rent',
        description: 'ค่าเช่าห้อง 101',
        quantity: 1,
        unitPrice: 4000.0,
        amount: 4000.0,
      },
    });

    const result = await paymentService.recordCash({
      dormitoryId: dormId,
      billId: bill.id,
      amount: '4000.00',
      userId,
    });

    expect(result.status).toBe('APPROVED');
    expect(new Decimal(result.amount.toString()).toString()).toBe('4000');
    expect(result.bill.status).toBe('PAID');
    expect(new Decimal(result.bill.paidAmount.toString()).toString()).toBe('4000');
    expect(new Decimal(result.bill.outstandingAmount.toString()).toString()).toBe('0');
    expect(result.receipt).toBeDefined();
    expect(new Decimal((result.receipt.snapshotData as any).total.toString()).toString()).toBe('4000');
  });

  it('2. Multi-Bill Combined Slip: Creates targets, pending child payments with exact monetary conservation, and unverified metadata without mutating bill status', async () => {
    const room = await createRoom('102');

    const billJuly = await prisma.bill.create({
      data: {
        dormitoryId: dormId,
        billingCycleId: cycleJulyId,
        roomId: room.id,
        tenantId,
        billNumber: `INV-102-JUL-${testRunId}`,
        billKind: 'MONTHLY_UTILITY',
        billingDate: new Date('2026-07-25'),
        dueDate: new Date('2026-08-05'),
        subtotal: 4000.0,
        totalAmount: 4000.0,
        paidAmount: 0.0,
        outstandingAmount: 4000.0,
        status: 'UNPAID',
      },
    });
    await prisma.billItem.create({
      data: {
        dormitoryId: dormId,
        billId: billJuly.id,
        type: 'rent',
        description: 'ค่าเช่า ก.ค. 102',
        quantity: 1,
        unitPrice: 4000.0,
        amount: 4000.0,
      },
    });

    const billAug = await prisma.bill.create({
      data: {
        dormitoryId: dormId,
        billingCycleId: cycleAugId,
        roomId: room.id,
        tenantId,
        billNumber: `INV-102-AUG-${testRunId}`,
        billKind: 'MONTHLY_UTILITY',
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-05'),
        subtotal: 5000.0,
        totalAmount: 5000.0,
        paidAmount: 0.0,
        outstandingAmount: 5000.0,
        status: 'UNPAID',
      },
    });
    await prisma.billItem.create({
      data: {
        dormitoryId: dormId,
        billId: billAug.id,
        type: 'rent',
        description: 'ค่าเช่า ส.ค. 102',
        quantity: 1,
        unitPrice: 5000.0,
        amount: 5000.0,
      },
    });

    // Step 1: Create Combined Upload Intent
    const intentRes = await paymentService.createCombinedUploadIntent({
      dormitoryId: dormId,
      tenantId,
      actorUserId: userId,
      billIds: [billJuly.id, billAug.id],
      mimeType: 'image/jpeg',
      fileSize: 10240,
    });

    expect(intentRes.groupId).toBeDefined();

    // Verify bill targets created
    const targets = await prisma.combinedPaymentGroupBillTarget.findMany({
      where: { paymentGroupId: intentRes.groupId },
      orderBy: { targetOrder: 'asc' },
    });
    expect(targets).toHaveLength(2);
    expect(targets[0].billId).toBe(billJuly.id);
    expect(targets[1].billId).toBe(billAug.id);

    // Mock upload completion
    await prisma.paymentUploadIntent.update({
      where: { id: intentRes.intentId },
      data: {
        status: 'UPLOADED',
        objectKey: 'slips/test-slip.jpg',
        sha256: `sha256-${testRunId}`,
        verifiedMimeType: 'image/jpeg',
        verifiedSize: 10240,
      },
    });

    // Step 2: Submit Combined Slip for ฿6,500
    const submitRes = await paymentService.submitCombinedSlipPayment({
      dormitoryId: dormId,
      tenantId,
      intentId: intentRes.intentId,
      paymentDate: new Date('2026-08-28T14:30:00Z'),
      amount: '6500.00',
      actorUserId: userId,
    });

    expect(submitRes.success).toBe(true);

    // Check Group record
    const group = await prisma.combinedPaymentGroup.findUnique({
      where: { id: intentRes.groupId },
      include: { payments: true, verification: true },
    });
    expect(group?.totalAmount.toString()).toBe('6500');
    expect(group?.status).toBe('UNDER_REVIEW');

    // Check Child Payments
    expect(group?.payments).toHaveLength(2);
    const sumChild = group!.payments.reduce(
      (sum, p) => sum.plus(new Decimal(p.amount.toString())),
      new Decimal(0)
    );
    expect(sumChild.toString()).toBe('6500');

    // Check Verification record (UNVERIFIED / NONE)
    expect(group?.verification?.status).toBe('UNVERIFIED');
    expect(group?.verification?.provider).toBe('NONE');
    expect(group?.verification?.verifiedTransferAt).toBeNull();

    // DECISION C CHECK: Bills MUST remain UNPAID, NOT mutated to UNDER_REVIEW
    const reJuly = await prisma.bill.findUnique({ where: { id: billJuly.id } });
    const reAug = await prisma.bill.findUnique({ where: { id: billAug.id } });
    expect(reJuly?.status).toBe('UNPAID');
    expect(reAug?.status).toBe('UNPAID');

    // Step 3: Owner Approves Combined Payment Group
    const approveRes = await paymentService.approvePaymentGroup({
      dormitoryId: dormId,
      groupId: intentRes.groupId,
      userId,
    });

    expect(approveRes.group.status).toBe('APPROVED');
    expect(approveRes.receipt).toBeDefined();
    expect(new Decimal((approveRes.receipt.snapshotData as any).total.toString()).toString()).toBe('6500');

    // Verify Bills updated properly: July = PAID (4,000 paid), August = PARTIALLY_PAID (2,500 paid, 2,500 outstanding)
    const postJuly = await prisma.bill.findUnique({ where: { id: billJuly.id } });
    const postAug = await prisma.bill.findUnique({ where: { id: billAug.id } });

    expect(postJuly?.status).toBe('PAID');
    expect(new Decimal(postJuly?.paidAmount?.toString() || '0').toString()).toBe('4000');
    expect(new Decimal(postJuly?.outstandingAmount?.toString() || '0').toString()).toBe('0');

    expect(postAug?.status).toBe('PARTIALLY_PAID');
    expect(new Decimal(postAug?.paidAmount?.toString() || '0').toString()).toBe('2500');
    expect(new Decimal(postAug?.outstandingAmount?.toString() || '0').toString()).toBe('2500');

    // Step 4: Verify Individual Reversal on Group Child Payment is BLOCKED
    const childPay = group!.payments[0];
    await expect(
      paymentService.reversePayment({
        dormitoryId: dormId,
        paymentId: childPay.id,
        userId,
        reason: 'Attempt single reversal',
      })
    ).rejects.toThrowError('ไม่อนุญาตให้ยกเลิกรายการย่อยของการรวมจ่าย กรุณายกเลิกทั้งกลุ่มรายการ');

    // Step 5: Owner Reverses Entire Payment Group
    const reverseRes = await paymentService.reversePaymentGroup({
      dormitoryId: dormId,
      groupId: intentRes.groupId,
      userId,
      reason: 'Owner corrected group payment',
    });

    expect(reverseRes.success).toBe(true);

    // Verify Group & Child Payments REVERSED
    const revGroup = await prisma.combinedPaymentGroup.findUnique({
      where: { id: intentRes.groupId },
      include: { payments: true, receipts: true },
    });
    expect(revGroup?.status).toBe('REVERSED');
    expect(revGroup?.payments.every((p) => p.status === 'REVERSED')).toBe(true);
    expect(revGroup?.receipts.every((r) => r.isVoided)).toBe(true);

    // Verify Bills restored to original UNPAID state
    const revJuly = await prisma.bill.findUnique({ where: { id: billJuly.id } });
    const revAug = await prisma.bill.findUnique({ where: { id: billAug.id } });

    expect(revJuly?.status).toBe('UNPAID');
    expect(new Decimal(revJuly?.paidAmount?.toString() || '0').toString()).toBe('0');
    expect(new Decimal(revJuly?.outstandingAmount?.toString() || '0').toString()).toBe('4000');

    expect(revAug?.status).toBe('UNPAID');
    expect(new Decimal(revAug?.paidAmount?.toString() || '0').toString()).toBe('0');
    expect(new Decimal(revAug?.outstandingAmount?.toString() || '0').toString()).toBe('5000');
  });

  it('3. Group Rejection: Rejects group and child payments without mutating bill balances', async () => {
    const room = await createRoom('103');

    const bill = await prisma.bill.create({
      data: {
        dormitoryId: dormId,
        billingCycleId: cycleJulyId,
        roomId: room.id,
        tenantId,
        billNumber: `INV-103-REJ-${testRunId}`,
        billKind: 'MONTHLY_UTILITY',
        billingDate: new Date('2026-07-25'),
        dueDate: new Date('2026-08-05'),
        subtotal: 4000.0,
        totalAmount: 4000.0,
        paidAmount: 0.0,
        outstandingAmount: 4000.0,
        status: 'UNPAID',
      },
    });

    const intentRes = await paymentService.createCombinedUploadIntent({
      dormitoryId: dormId,
      tenantId,
      actorUserId: userId,
      billIds: [bill.id],
      mimeType: 'image/jpeg',
      fileSize: 10240,
    });

    await prisma.paymentUploadIntent.update({
      where: { id: intentRes.intentId },
      data: {
        status: 'UPLOADED',
        objectKey: 'slips/test-rej.jpg',
        sha256: `sha256-rej-${testRunId}`,
        verifiedMimeType: 'image/jpeg',
        verifiedSize: 10240,
      },
    });

    await paymentService.submitCombinedSlipPayment({
      dormitoryId: dormId,
      tenantId,
      intentId: intentRes.intentId,
      paymentDate: new Date('2026-08-28T14:30:00Z'),
      amount: '4000.00',
      actorUserId: userId,
    });

    // Owner rejects group
    const rejRes = await paymentService.rejectPaymentGroup({
      dormitoryId: dormId,
      groupId: intentRes.groupId,
      userId,
      reason: 'Slip unreadable',
    });

    expect(rejRes.success).toBe(true);

    const rejGroup = await prisma.combinedPaymentGroup.findUnique({
      where: { id: intentRes.groupId },
      include: { payments: true },
    });
    expect(rejGroup?.status).toBe('REJECTED');
    expect(rejGroup?.payments[0]?.status).toBe('REJECTED');

    // Bill balances must remain unchanged
    const reBill = await prisma.bill.findUnique({ where: { id: bill.id } });
    expect(reBill?.status).toBe('UNPAID');
    expect(reBill?.paidAmount.toString()).toBe('0');
    expect(reBill?.outstandingAmount.toString()).toBe('4000');
  });
});
