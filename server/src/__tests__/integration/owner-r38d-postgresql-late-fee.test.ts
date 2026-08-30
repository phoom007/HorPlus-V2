/**
 * @license Apache-2.0
 * OWNER R3.8d — Real PostgreSQL Late-Fee Reconciler & Allocation Link Preservation Integration Tests
 *
 * Tests:
 * 1. TEST A: Manual UNVERIFIED partial payment does NOT freeze late fee accrual past due date.
 * 2. TEST B: Cash partial payment freezes late fee accrual as of trusted cash payment date.
 * 3. TEST C: Future trusted verification adapter freezes late fees at verifiedTransferAt.
 * 4. TEST D: Principal BillItem and PaymentAllocation.billItemId relational links survive late fee reconciliation.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getPrismaClient } from '../../db/prisma.js';
import { lateFeeReconciliationService } from '../../services/late-fee-reconciliation.service.js';
import { paymentService } from '../../services/payment.service.js';
import { Decimal } from 'decimal.js';

const prisma = getPrismaClient();

describe('OWNER R3.8d: Real PostgreSQL Late-Fee Reconciler & Allocation Integrity Tests', () => {
  const testRunId = `r38d_lf_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  let dormId: string;
  let bldId: string;
  let userId: string;
  let tenantId: string;
  let cycleId: string;

  async function createRoom(num: string) {
    const room = await prisma.room.create({
      data: {
        dormitoryId: dormId,
        buildingId: bldId,
        roomNumber: `R38D-${num}-${testRunId}`,
        normalizedRoomNumber: `${num}-${testRunId}`,
        floor: 1,
        status: 'occupied',
        monthlyRent: 4000,
        monthlyDeposit: 4000,
        termDeposit: 4000,
        dailyDeposit: 500,
      },
    });

    await prisma.contract.create({
      data: {
        dormitoryId: dormId,
        roomId: room.id,
        tenantId: tenantId,
        contractNumber: `CTR-${num}-${testRunId}`,
        startDate: new Date('2026-07-01'),
        endDate: new Date('2027-06-30'),
        rentAmount: 4000.0,
        depositAmount: 4000.0,
        status: 'active',
      },
    });

    return room;
  }

  beforeAll(async () => {
    const dorm = await prisma.dormitory.create({
      data: { name: `R3.8d LateFee Test Dorm ${testRunId}` },
    });
    dormId = dorm.id;

    let building = await prisma.building.findFirst({ where: { dormitoryId: dormId } });
    if (!building) {
      building = await prisma.building.create({
        data: {
          dormitoryId: dormId,
          name: 'อาคาร LateFee',
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
          name: 'เจ้าของหอพัก R3.8d',
          phone: '0812345678',
        },
      });
    }
    userId = user.id;

    const tenant = await prisma.tenant.create({
      data: {
        dormitoryId: dormId,
        tenantNumber: `TNT-${testRunId}`,
        firstName: 'นิรันดร์',
        lastName: 'สุขใจ',
        displayName: 'นิรันดร์ สุขใจ',
        status: 'active',
      },
    });
    tenantId = tenant.id;

    const cycle = await prisma.billingCycle.create({
      data: {
        dormitoryId: dormId,
        cycleCode: `2026-08-${testRunId}`,
        name: 'รอบ ส.ค. 2569 (LateFee Test)',
        periodStart: new Date('2026-08-01'),
        periodEnd: new Date('2026-08-31'),
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-08-05'), // Due on Aug 5 (Grace period Aug 6, 7; chargeable from Aug 8)
        status: 'active',
      },
    });
    cycleId = cycle.id;

    // Create BillingRateSnapshot with daily late fee of ฿50/day
    await prisma.billingRateSnapshot.create({
      data: {
        dormitoryId: dormId,
        billingCycleId: cycleId,
        waterBillingType: 'fixed',
        waterRate: 0.0,
        electricityBillingType: 'fixed',
        electricityRate: 0.0,
        commonFee: 0.0,
        commonFeeMode: 'room',
        internetFee: 0.0,
        internetFeeMode: 'room',
        parkingFee: 0.0,
        parkingFeeMode: 'room',
        lateFeeType: 'daily',
        lateFeeValue: 50.0, // ฿50 per chargeable overdue day
        gracePeriodDays: 2,
        source: 'TEMPLATE_DEFAULT',
      },
    });
  });

  // TEST A: Manual UNVERIFIED Partial Payment Continues Accrual Past Due Date
  it('TEST A: Manual UNVERIFIED partial payment continues late fee accrual past due date', async () => {
    const room = await createRoom('101');
    const bill = await prisma.bill.create({
      data: {
        dormitoryId: dormId,
        roomId: room.id,
        tenantId,
        billingCycleId: cycleId,
        billNumber: `INV-TA-${testRunId}`,
        billKind: 'MONTHLY_UTILITY',
        status: 'UNPAID',
        billingDate: new Date('2026-07-25'),
        dueDate: new Date('2026-08-05'),
        subtotal: '4000.00',
        totalAmount: '4000.00',
        paidAmount: '0.00',
        outstandingAmount: '4000.00',
        items: {
          create: [{ dormitoryId: dormId, type: 'rent', description: 'ค่าเช่าห้อง 101', amount: '4000.00' }],
        },
      },
    });

    // Tenant submits manual unverified partial slip of ฿1,500 with claimed transfer on Aug 4
    const intent = await prisma.paymentUploadIntent.create({
      data: {
        dormitoryId: dormId,
        billId: bill.id,
        tenantId,
        authenticatedUserId: userId,
        status: 'UPLOADED',
        expectedMimeType: 'image/jpeg',
        expectedSize: 10240,
        objectKey: `slips/${testRunId}-ta.jpg`,
        sha256: `sha256-ta-${testRunId}`,
        verifiedMimeType: 'image/jpeg',
        verifiedSize: 10240,
        expiresAt: new Date(Date.now() + 3600000),
      },
    });

    const payment = await prisma.payment.create({
      data: {
        dormitoryId: dormId,
        billId: bill.id,
        tenantId,
        method: 'BANK_TRANSFER',
        amount: '1500.00',
        status: 'UNDER_REVIEW',
        paymentDate: new Date('2026-08-04T14:30:00Z'),
        evidenceUrl: intent.objectKey,
        fileHash: intent.sha256,
      },
    });

    await prisma.paymentEvidenceVerification.create({
      data: {
        dormitoryId: dormId,
        paymentId: payment.id,
        provider: 'NONE',
        status: 'UNVERIFIED',
        claimedTransferAt: new Date('2026-08-04T14:30:00Z'),
        verifiedTransferAt: null,
      },
    });

    // Owner approves partial payment on Aug 8
    await paymentService.approvePayment({
      dormitoryId: dormId,
      paymentId: payment.id,
      userId,
    });

    // Verify Bill is PARTIALLY_PAID (Paid ฿1,500, Outstanding ฿2,500)
    const billAfterPay = await prisma.bill.findUnique({ where: { id: bill.id } });
    expect(billAfterPay?.status).toBe('PARTIALLY_PAID');
    expect(new Decimal(billAfterPay?.paidAmount?.toString() || '0').toString()).toBe('1500');

    // Run real LateFeeReconciliationService as of Aug 10 (2 chargeable days: Aug 8, Aug 9 -> ฿100 late fee)
    const refDateAug10 = new Date('2026-08-10T12:00:00.000Z');
    const reconAug10 = await lateFeeReconciliationService.reconcileOverdueBills(refDateAug10, dormId);
    expect(reconAug10.changed).toBeGreaterThanOrEqual(1);

    const billReconAug10 = await prisma.bill.findUnique({
      where: { id: bill.id },
      include: { items: true },
    });
    // Total should now be ฿4,000 + ฿150 (3 chargeable days * 50) = ฿4,150, outstanding = ฿2,650
    expect(new Decimal(billReconAug10?.totalAmount?.toString() || '0').toString()).toBe('4150');
    expect(new Decimal(billReconAug10?.outstandingAmount?.toString() || '0').toString()).toBe('2650');

    // Run real reconciler at later date Aug 15 (8 chargeable days * 50 = ฿400 late fee)
    const refDateAug15 = new Date('2026-08-15T12:00:00.000Z');
    await lateFeeReconciliationService.reconcileOverdueBills(refDateAug15, dormId);

    const billReconAug15 = await prisma.bill.findUnique({
      where: { id: bill.id },
      include: { items: true },
    });
    // Total should now be ฿4,000 + ฿400 = ฿4,400, outstanding = ฿2,900
    expect(new Decimal(billReconAug15?.totalAmount?.toString() || '0').toString()).toBe('4400');
    expect(new Decimal(billReconAug15?.outstandingAmount?.toString() || '0').toString()).toBe('2900');
  });

  // TEST B: Cash Partial Payment Freezes Late Fee Accrual
  it('TEST B: Cash partial payment freezes late fee accrual as of trusted cash payment date', async () => {
    const room = await createRoom('102');
    const bill = await prisma.bill.create({
      data: {
        dormitoryId: dormId,
        roomId: room.id,
        tenantId,
        billingCycleId: cycleId,
        billNumber: `INV-TB-${testRunId}`,
        billKind: 'MONTHLY_UTILITY',
        status: 'UNPAID',
        billingDate: new Date('2026-07-25'),
        dueDate: new Date('2026-08-05'),
        subtotal: '4000.00',
        totalAmount: '4000.00',
        paidAmount: '0.00',
        outstandingAmount: '4000.00',
        items: {
          create: [{ dormitoryId: dormId, type: 'rent', description: 'ค่าเช่าห้อง 102', amount: '4000.00' }],
        },
      },
    });

    // Record Cash partial payment of ฿2,000 at server time Aug 10 (2 chargeable days accrued = ฿100)
    await prisma.$transaction(async (tx) => {
      await paymentService.recordCash({
        dormitoryId: dormId,
        billId: bill.id,
        amount: '2000.00',
        userId,
      });
      // Override cash paymentDate to Aug 10 for deterministic test timing
      const pay = await tx.payment.findFirst({ where: { billId: bill.id } });
      if (pay) {
        await tx.payment.update({
          where: { id: pay.id },
          data: { paymentDate: new Date('2026-08-10T14:30:00Z') },
        });
      }
    });

    // Run reconciler as of Aug 15
    const refDateAug15 = new Date('2026-08-15T12:00:00.000Z');
    await lateFeeReconciliationService.reconcileOverdueBills(refDateAug15, dormId);

    const billRecon = await prisma.bill.findUnique({
      where: { id: bill.id },
      include: { items: true },
    });

    // Late fee must be capped as of trusted cash date Aug 10 (3 chargeable days -> ฿150)
    // NOT calculated through Aug 15 (which would be ฿400)
    expect(new Decimal(billRecon?.totalAmount?.toString() || '0').toString()).toBe('4150');
    expect(new Decimal(billRecon?.outstandingAmount?.toString() || '0').toString()).toBe('2150');
  });

  // TEST C: Future Trusted Verification Adapter Seam
  it('TEST C: Future trusted verification adapter freezes late fees at verifiedTransferAt', async () => {
    const room = await createRoom('103');
    const bill = await prisma.bill.create({
      data: {
        dormitoryId: dormId,
        roomId: room.id,
        tenantId,
        billingCycleId: cycleId,
        billNumber: `INV-TC-${testRunId}`,
        billKind: 'MONTHLY_UTILITY',
        status: 'UNPAID',
        billingDate: new Date('2026-07-25'),
        dueDate: new Date('2026-08-05'),
        subtotal: '4000.00',
        totalAmount: '4000.00',
        paidAmount: '0.00',
        outstandingAmount: '4000.00',
        items: {
          create: [{ dormitoryId: dormId, type: 'rent', description: 'ค่าเช่าห้อง 103', amount: '4000.00' }],
        },
      },
    });

    // Create approved payment with trusted verification record at Aug 9 (1 chargeable day = ฿50)
    const pay = await prisma.payment.create({
      data: {
        dormitoryId: dormId,
        billId: bill.id,
        tenantId,
        method: 'BANK_TRANSFER',
        amount: '2000.00',
        status: 'APPROVED',
        paymentDate: new Date('2026-08-12T10:00:00Z'),
      },
    });

    await prisma.paymentEvidenceVerification.create({
      data: {
        dormitoryId: dormId,
        paymentId: pay.id,
        provider: 'SLIPOK',
        status: 'VERIFIED',
        claimedTransferAt: new Date('2026-08-09T10:00:00Z'),
        verifiedTransferAt: new Date('2026-08-09T10:00:00Z'), // Trusted bank transfer time
        verifiedAmount: '2000.00',
      },
    });

    await prisma.bill.update({
      where: { id: bill.id },
      data: {
        status: 'PARTIALLY_PAID',
        paidAmount: '2000.00',
        outstandingAmount: '2000.00',
      },
    });

    // Run reconciler as of Aug 20
    const refDateAug20 = new Date('2026-08-20T12:00:00.000Z');
    await lateFeeReconciliationService.reconcileOverdueBills(refDateAug20, dormId);

    const billRecon = await prisma.bill.findUnique({
      where: { id: bill.id },
      include: { items: true },
    });

    // Late fee must be capped at trusted verifiedTransferAt (Aug 9 -> 2 chargeable days -> ฿100)
    expect(new Decimal(billRecon?.totalAmount?.toString() || '0').toString()).toBe('4100');
    expect(new Decimal(billRecon?.outstandingAmount?.toString() || '0').toString()).toBe('2100');
  });

  // TEST D: Principal BillItem and PaymentAllocation.billItemId Relational Links Survive Late-Fee Reconciliation
  it('TEST D: Principal BillItem and PaymentAllocation.billItemId links survive surgical late-fee reconciliation', async () => {
    const room = await createRoom('104');
    const bill = await prisma.bill.create({
      data: {
        dormitoryId: dormId,
        roomId: room.id,
        tenantId,
        billingCycleId: cycleId,
        billNumber: `INV-TD-${testRunId}`,
        billKind: 'MONTHLY_UTILITY',
        status: 'UNPAID',
        billingDate: new Date('2026-07-25'),
        dueDate: new Date('2026-08-05'),
        subtotal: '4500.00',
        totalAmount: '4500.00',
        paidAmount: '0.00',
        outstandingAmount: '4500.00',
      },
    });

    const rentItem = await prisma.billItem.create({
      data: {
        dormitoryId: dormId,
        billId: bill.id,
        type: 'rent',
        description: 'ค่าเช่าห้อง 104',
        amount: '3500.00',
        unitPrice: '3500.00',
        quantity: 1,
      },
    });

    const waterItem = await prisma.billItem.create({
      data: {
        dormitoryId: dormId,
        billId: bill.id,
        type: 'water',
        description: 'ค่าน้ำประปา',
        amount: '400.00',
        unitPrice: '400.00',
        quantity: 1,
      },
    });

    const elecItem = await prisma.billItem.create({
      data: {
        dormitoryId: dormId,
        billId: bill.id,
        type: 'electric',
        description: 'ค่าไฟฟ้า',
        amount: '600.00',
        unitPrice: '600.00',
        quantity: 1,
      },
    });

    // Create partial cash payment of ฿2,000 allocated to rentItem
    const payment = await prisma.payment.create({
      data: {
        dormitoryId: dormId,
        billId: bill.id,
        tenantId,
        method: 'CASH',
        amount: '2000.00',
        status: 'APPROVED',
        paymentDate: new Date('2026-08-04T10:00:00Z'), // Paid before due date
      },
    });

    const allocation = await prisma.paymentAllocation.create({
      data: {
        dormitoryId: dormId,
        paymentId: payment.id,
        billId: bill.id,
        billItemId: rentItem.id, // Explicit relational link to principal RENT item
        allocatedAmount: '2000.00',
        allocationOrder: 1,
      },
    });

    await prisma.bill.update({
      where: { id: bill.id },
      data: {
        status: 'PARTIALLY_PAID',
        paidAmount: '2000.00',
        outstandingAmount: '2500.00',
      },
    });

    // Run surgical late-fee reconciliation as of Aug 15
    const refDateAug15 = new Date('2026-08-15T12:00:00.000Z');
    await lateFeeReconciliationService.reconcileOverdueBills(refDateAug15, dormId);

    // Verify all original BillItems are PRESERVED with identical IDs
    const postRent = await prisma.billItem.findUnique({ where: { id: rentItem.id } });
    const postWater = await prisma.billItem.findUnique({ where: { id: waterItem.id } });
    const postElec = await prisma.billItem.findUnique({ where: { id: elecItem.id } });

    expect(postRent).not.toBeNull();
    expect(postRent?.id).toBe(rentItem.id);
    expect(postWater?.id).toBe(waterItem.id);
    expect(postElec?.id).toBe(elecItem.id);

    // CRITICAL INVARIANT: Verify PaymentAllocation.billItemId STILL equals rentItem.id (NOT SET TO NULL)
    const postAlloc = await prisma.paymentAllocation.findUnique({ where: { id: allocation.id } });
    expect(postAlloc?.billItemId).toBe(rentItem.id);
  });
});
