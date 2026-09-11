/**
 * @license Apache-2.0
 * OWNER R3.8b / R3.8c — Real Database & Financial Service Integration Tests
 * Proves:
 * 1. Single Bill Partial Cash Payment (UNPAID -> PARTIALLY_PAID)
 * 2. Multi-Bill Combined Slip: Oldest Monthly Bill FIRST, then next cycle bill, with 1 Receipt for the group
 * 3. Multi-Bill Deposit Priority: Allocates to Deposit only after Monthly Bills are fully satisfied
 * 4. Cross-Room Protection: Combining bills from different rooms fails closed with FORBIDDEN_CROSS_ROOM
 * 5. Overpayment Rejection: Amount greater than total eligible outstanding throws PAYMENT_EXCEEDS_ELIGIBLE_OUTSTANDING
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getPrismaClient } from '../../db/prisma.js';
import { paymentService } from '../../services/payment.service.js';
import { Decimal } from 'decimal.js';

const prisma = getPrismaClient();

describe('OWNER R3.8b: Real Database & Financial Service Integration Tests', () => {
  const testRunId = `r38b_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
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
        roomNumber: `R38B-${num}-${testRunId}`,
        normalizedRoomNumber: `${num}-${testRunId}`,
        floor: 1,
        status: 'occupied',
        monthlyRent: 3500,
        monthlyDeposit: 3500,
        termDeposit: 3500,
        dailyDeposit: 500,
      },
    });
  }

  beforeAll(async () => {
    let dorm = await prisma.dormitory.findFirst();
    if (!dorm) {
      dorm = await prisma.dormitory.create({
        data: { name: 'R3.8b Test Dormitory' },
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
          name: 'เจ้าของหอพัก R3.8b',
          phone: '0811111111',
        },
      });
    }
    userId = user.id;

    const tenant = await prisma.tenant.create({
      data: {
        dormitoryId: dormId,
        tenantNumber: `TNT-${testRunId}`,
        firstName: 'สมบูรณ์',
        lastName: 'การเงินดี',
        displayName: 'สมบูรณ์ การเงินดี',
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

  it('1. Cash Partial Payment: ฿1,000 on ฿4,500 bill transitions bill to PARTIALLY_PAID and generates Receipt', async () => {
    const room = await createRoom('101');
    const bill = await prisma.bill.create({
      data: {
        dormitoryId: dormId,
        roomId: room.id,
        tenantId,
        billingCycleId: cycleJulyId,
        billNumber: `INV-P1-${testRunId}`,
        billKind: 'MONTHLY_UTILITY',
        status: 'UNPAID',
        billingDate: new Date('2026-07-25'),
        dueDate: new Date('2026-08-05'),
        subtotal: '4500.00',
        totalAmount: '4500.00',
        paidAmount: '0.00',
        outstandingAmount: '4500.00',
        items: {
          create: [
            { dormitoryId: dormId, type: 'rent', description: 'ค่าเช่าห้องพัก', amount: '3500.00' },
            { dormitoryId: dormId, type: 'water', description: 'ค่าน้ำประปา', amount: '400.00' },
            { dormitoryId: dormId, type: 'electric', description: 'ค่าไฟฟ้า', amount: '600.00' },
          ],
        },
      },
    });

    const paymentResult = await paymentService.recordCash({
      dormitoryId: dormId,
      billId: bill.id,
      amount: '1000.00',
      userId,
    });

    expect(paymentResult.bill.status).toBe('PARTIALLY_PAID');
    expect(new Decimal(paymentResult.bill.paidAmount).toString()).toBe('1000');
    expect(new Decimal(paymentResult.bill.outstandingAmount).toString()).toBe('3500');

    // Second payment completes settlement
    const secondResult = await paymentService.recordCash({
      dormitoryId: dormId,
      billId: bill.id,
      amount: '3500.00',
      userId,
    });

    expect(secondResult.bill.status).toBe('PAID');
    expect(new Decimal(secondResult.bill.paidAmount).toString()).toBe('4500');
    expect(new Decimal(secondResult.bill.outstandingAmount).toString()).toBe('0');
  });

  it('2. Multi-Bill Combined Slip: Oldest Monthly Bill FIRST, then next cycle bill, with 1 Receipt for the group', async () => {
    const room = await createRoom('201');

    const julyBill = await prisma.bill.create({
      data: {
        dormitoryId: dormId,
        roomId: room.id,
        tenantId,
        billingCycleId: cycleJulyId,
        billNumber: `INV-MB1-${testRunId}`,
        billKind: 'MONTHLY_UTILITY',
        status: 'UNPAID',
        billingDate: new Date('2026-07-25'),
        dueDate: new Date('2026-08-05'),
        subtotal: '4000.00',
        totalAmount: '4000.00',
        paidAmount: '0.00',
        outstandingAmount: '4000.00',
        items: {
          create: [{ dormitoryId: dormId, type: 'rent', description: 'ค่าเช่า ก.ค.', amount: '4000.00' }],
        },
      },
    });

    const augBill = await prisma.bill.create({
      data: {
        dormitoryId: dormId,
        roomId: room.id,
        tenantId,
        billingCycleId: cycleAugId,
        billNumber: `INV-MB2-${testRunId}`,
        billKind: 'MONTHLY_UTILITY',
        status: 'UNPAID',
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-05'),
        subtotal: '5000.00',
        totalAmount: '5000.00',
        paidAmount: '0.00',
        outstandingAmount: '5000.00',
        items: {
          create: [{ dormitoryId: dormId, type: 'rent', description: 'ค่าเช่า ส.ค.', amount: '5000.00' }],
        },
      },
    });

    const intentRes = await paymentService.createCombinedUploadIntent({
      dormitoryId: dormId,
      tenantId,
      actorUserId: userId,
      billIds: [augBill.id, julyBill.id],
      mimeType: 'image/jpeg',
      fileSize: 10240,
    });

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

    await paymentService.submitCombinedSlipPayment({
      dormitoryId: dormId,
      tenantId,
      intentId: intentRes.intentId,
      paymentDate: new Date('2026-08-28T14:30:00Z'),
      amount: '6500.00',
      actorUserId: userId,
    });

    const approveRes = await paymentService.approvePaymentGroup({
      dormitoryId: dormId,
      groupId: intentRes.groupId,
      userId,
    });

    expect(approveRes.group.status).toBe('APPROVED');
    expect(approveRes.receipt).toBeDefined();
    expect((approveRes.receipt.snapshotData as any).total).toBe('6500.00');

    const updatedJuly = await prisma.bill.findUnique({ where: { id: julyBill.id } });
    expect(updatedJuly!.status).toBe('PAID');
    expect(new Decimal(updatedJuly!.paidAmount.toString()).toString()).toBe('4000');
    expect(new Decimal(updatedJuly!.outstandingAmount.toString()).toString()).toBe('0');

    const updatedAug = await prisma.bill.findUnique({ where: { id: augBill.id } });
    expect(updatedAug!.status).toBe('PARTIALLY_PAID');
    expect(new Decimal(updatedAug!.paidAmount.toString()).toString()).toBe('2500');
    expect(new Decimal(updatedAug!.outstandingAmount.toString()).toString()).toBe('2500');
  });

  it('3. Multi-Bill Deposit Priority: Allocates to Deposit only after Monthly Bills are fully satisfied', async () => {
    const room = await createRoom('301');
    const monthlyBill = await prisma.bill.create({
      data: {
        dormitoryId: dormId,
        roomId: room.id,
        tenantId,
        billingCycleId: cycleJulyId,
        billNumber: `INV-MD1-${testRunId}`,
        billKind: 'MONTHLY_UTILITY',
        status: 'UNPAID',
        billingDate: new Date('2026-07-25'),
        dueDate: new Date('2026-08-05'),
        subtotal: '3500.00',
        totalAmount: '3500.00',
        paidAmount: '0.00',
        outstandingAmount: '3500.00',
        items: {
          create: [{ dormitoryId: dormId, type: 'rent', description: 'ค่าเช่า', amount: '3500.00' }],
        },
      },
    });

    const depositBill = await prisma.bill.create({
      data: {
        dormitoryId: dormId,
        roomId: room.id,
        tenantId,
        billingCycleId: cycleJulyId,
        billNumber: `DEP-MD2-${testRunId}`,
        billKind: 'DEPOSIT',
        status: 'UNPAID',
        billingDate: new Date('2026-07-01'),
        dueDate: new Date('2026-07-15'),
        subtotal: '9000.00',
        totalAmount: '9000.00',
        paidAmount: '0.00',
        outstandingAmount: '9000.00',
      },
    });

    const intentRes = await paymentService.createCombinedUploadIntent({
      dormitoryId: dormId,
      tenantId,
      actorUserId: userId,
      billIds: [depositBill.id, monthlyBill.id],
      mimeType: 'image/jpeg',
      fileSize: 10240,
    });

    await prisma.paymentUploadIntent.update({
      where: { id: intentRes.intentId },
      data: {
        status: 'UPLOADED',
        objectKey: 'slips/test-dep.jpg',
        sha256: `sha256-dep-${testRunId}`,
        verifiedMimeType: 'image/jpeg',
        verifiedSize: 10240,
      },
    });

    await paymentService.submitCombinedSlipPayment({
      dormitoryId: dormId,
      tenantId,
      intentId: intentRes.intentId,
      paymentDate: new Date('2026-08-28T14:30:00Z'),
      amount: '5000.00',
      actorUserId: userId,
    });

    await paymentService.approvePaymentGroup({
      dormitoryId: dormId,
      groupId: intentRes.groupId,
      userId,
    });

    const updatedMonthly = await prisma.bill.findUnique({ where: { id: monthlyBill.id } });
    expect(updatedMonthly!.status).toBe('PAID');

    const updatedDeposit = await prisma.bill.findUnique({ where: { id: depositBill.id } });
    expect(updatedDeposit!.status).toBe('PARTIALLY_PAID');
    expect(new Decimal(updatedDeposit!.paidAmount.toString()).toString()).toBe('1500');
    expect(new Decimal(updatedDeposit!.outstandingAmount.toString()).toString()).toBe('7500');
  });

  it('4. Cross-Room Protection: Combining bills from different rooms fails closed with FORBIDDEN_CROSS_ROOM', async () => {
    const room401 = await createRoom('401');
    const room402 = await createRoom('402');

    const billRoom1 = await prisma.bill.create({
      data: {
        dormitoryId: dormId,
        roomId: room401.id,
        tenantId,
        billingCycleId: cycleJulyId,
        billNumber: `INV-CR1-${testRunId}`,
        billKind: 'MONTHLY_UTILITY',
        status: 'UNPAID',
        billingDate: new Date('2026-07-25'),
        dueDate: new Date('2026-08-05'),
        subtotal: '3500.00',
        totalAmount: '3500.00',
        paidAmount: '0.00',
        outstandingAmount: '3500.00',
      },
    });

    const billRoom2 = await prisma.bill.create({
      data: {
        dormitoryId: dormId,
        roomId: room402.id,
        tenantId,
        billingCycleId: cycleJulyId,
        billNumber: `INV-CR2-${testRunId}`,
        billKind: 'MONTHLY_UTILITY',
        status: 'UNPAID',
        billingDate: new Date('2026-07-25'),
        dueDate: new Date('2026-08-05'),
        subtotal: '3500.00',
        totalAmount: '3500.00',
        paidAmount: '0.00',
        outstandingAmount: '3500.00',
      },
    });

    await expect(
      paymentService.createCombinedUploadIntent({
        dormitoryId: dormId,
        tenantId,
        actorUserId: userId,
        billIds: [billRoom1.id, billRoom2.id],
        mimeType: 'image/jpeg',
        fileSize: 10240,
      })
    ).rejects.toThrowError('ไม่อนุญาตให้รวมบิลข้ามห้องพัก');
  });

  it('5. Overpayment Rejection: Amount greater than total eligible outstanding throws PAYMENT_EXCEEDS_ELIGIBLE_OUTSTANDING', async () => {
    const room501 = await createRoom('501');
    const bill = await prisma.bill.create({
      data: {
        dormitoryId: dormId,
        roomId: room501.id,
        tenantId,
        billingCycleId: cycleJulyId,
        billNumber: `INV-OP-${testRunId}`,
        billKind: 'MONTHLY_UTILITY',
        status: 'UNPAID',
        billingDate: new Date('2026-07-25'),
        dueDate: new Date('2026-08-05'),
        subtotal: '3000.00',
        totalAmount: '3000.00',
        paidAmount: '0.00',
        outstandingAmount: '3000.00',
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
        objectKey: 'slips/test-op.jpg',
        sha256: `sha256-op-${testRunId}`,
        verifiedMimeType: 'image/jpeg',
        verifiedSize: 10240,
      },
    });

    await expect(
      paymentService.submitCombinedSlipPayment({
        dormitoryId: dormId,
        tenantId,
        intentId: intentRes.intentId,
        paymentDate: new Date('2026-08-28T14:30:00Z'),
        amount: '5000.00',
        actorUserId: userId,
      })
    ).rejects.toThrowError('ยอดในสลิปเกินกว่ายอดที่ต้องชำระจริง กรุณาติดต่อเจ้าของหอพัก');
  });
});
