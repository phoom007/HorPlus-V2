/**
 * @license Apache-2.0
 * OWNER R3.8e — Real PostgreSQL Locked-State Revalidation & paidAt Authority Integration Tests
 *
 * Covers:
 * Section A & E: Fail-closed locked-state revalidation after row lock in LateFeeReconciliationService
 * Section B & F: Canonical full settlement paidAt authority across Cash, Single Slip, and Grouped Slip
 * Section I: Cash server timestamp runtime authority proof
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getPrismaClient } from '../../db/prisma.js';
import { LateFeeReconciliationService } from '../../services/late-fee-reconciliation.service.js';
import { PaymentService } from '../../services/payment.service.js';
import { recordCashPaymentInTx } from '../../utils/payment-transaction.util.js';
import { Decimal } from 'decimal.js';

const prisma = getPrismaClient();

describe('OWNER R3.8e: PostgreSQL Locked-State Revalidation & paidAt Authority', () => {
  let lateFeeService: LateFeeReconciliationService;
  let paymentService: PaymentService;
  const testRunId = `r38e_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

  let dormId: string;
  let ownerUserId: string;
  let tenantUserId: string;
  let tenantRecordId: string;
  let bldId: string;
  let roomId: string;
  let rateSnapshotId: string;
  let cycleJulyId: string;

  beforeAll(async () => {
    lateFeeService = new LateFeeReconciliationService(prisma);
    paymentService = new PaymentService(prisma);

    // 1. Create Dormitory
    const dorm = await prisma.dormitory.create({
      data: {
        name: `R3.8e Test Dorm ${testRunId}`,
        status: 'active',
      },
    });
    dormId = dorm.id;

    // 2. Roles & Users
    const ownerRole = (await prisma.role.findFirst({ where: { code: 'owner' } })) ||
      (await prisma.role.create({ data: { code: 'owner', name: 'Owner', permissions: [] } }));
    const tenantRole = (await prisma.role.findFirst({ where: { code: 'tenant' } })) ||
      (await prisma.role.create({ data: { code: 'tenant', name: 'Tenant', permissions: [] } }));

    const ownerUser = await prisma.user.create({
      data: {
        email: `owner_${testRunId}@test.com`,
        emailNormalized: `owner_${testRunId}@test.com`,
        googleSubject: `google_owner_${testRunId}`,
        name: 'Owner User',
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

    const tenantUser = await prisma.user.create({
      data: {
        email: `tenant_${testRunId}@test.com`,
        emailNormalized: `tenant_${testRunId}@test.com`,
        googleSubject: `google_tenant_${testRunId}`,
        name: 'Tenant User',
      },
    });
    tenantUserId = tenantUser.id;
    await prisma.dormitoryMember.create({
      data: {
        userId: tenantUserId,
        dormitoryId: dormId,
        roleId: tenantRole.id,
        status: 'active',
        membershipOrigin: 'MANUAL_INVITE',
      },
    });

    const tenant = await prisma.tenant.create({
      data: {
        dormitoryId: dormId,
        tenantNumber: `TNT-${testRunId}`,
        firstName: 'สมชาย',
        lastName: 'ทดสอบ',
        displayName: 'สมชาย ทดสอบ',
        linkedUserId: tenantUserId,
        status: 'active',
      },
    });
    tenantRecordId = tenant.id;

    // 3. Building, Room, Contract
    const building = await prisma.building.create({
      data: { dormitoryId: dormId, name: 'อาคาร A' },
    });
    bldId = building.id;

    const room = await prisma.room.create({
      data: {
        dormitoryId: dormId,
        buildingId: building.id,
        roomNumber: `R38E-${testRunId}`,
        normalizedRoomNumber: `R38E-${testRunId}`,
        floor: 1,
        status: 'occupied',
        monthlyRent: 4000,
        monthlyDeposit: 4000,
        termDeposit: 4000,
        dailyDeposit: 500,
      },
    });
    roomId = room.id;

    await prisma.contract.create({
      data: {
        dormitoryId: dormId,
        roomId: room.id,
        tenantId: tenantRecordId,
        contractNumber: `CTR-${testRunId}`,
        startDate: new Date('2026-07-01'),
        endDate: new Date('2027-06-30'),
        rentAmount: 4000.0,
        depositAmount: 4000.0,
        status: 'active',
      },
    });

    // 4. Billing Cycle & BillingRateSnapshot (daily ฿50, 2 grace days, due Aug 5)
    const cycleJuly = await prisma.billingCycle.create({
      data: {
        dormitoryId: dormId,
        cycleCode: `2026-07-${testRunId}`,
        name: 'รอบ ก.ค. 2569',
        periodStart: new Date('2026-07-01'),
        periodEnd: new Date('2026-07-31'),
        billingDate: new Date('2026-07-25'),
        dueDate: new Date('2026-08-05'),
        status: 'active',
      },
    });
    cycleJulyId = cycleJuly.id;

    const rateSnapshot = await prisma.billingRateSnapshot.create({
      data: {
        dormitoryId: dormId,
        billingCycleId: cycleJulyId,
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
        lateFeeValue: 50.0,
        gracePeriodDays: 2,
        source: 'TEMPLATE_DEFAULT',
      },
    });
    rateSnapshotId = rateSnapshot.id;
  });

  // Helper to create fresh bill with room/contract
  async function createBill(tag: string, overrides: Partial<any> = {}) {
    const roomSub = await prisma.room.create({
      data: {
        dormitoryId: dormId,
        buildingId: bldId,
        roomNumber: `RM-${tag}-${testRunId}`,
        normalizedRoomNumber: `RM-${tag}-${testRunId}`,
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
        roomId: roomSub.id,
        tenantId: tenantRecordId,
        contractNumber: `CTR-${tag}-${testRunId}`,
        startDate: new Date('2026-07-01'),
        endDate: new Date('2027-06-30'),
        rentAmount: 4000.0,
        depositAmount: 4000.0,
        status: 'active',
      },
    });

    const bill = await prisma.bill.create({
      data: {
        dormitoryId: dormId,
        roomId: roomSub.id,
        tenantId: tenantRecordId,
        billingCycleId: cycleJulyId,
        billNumber: `INV-${tag}-${testRunId}`,
        billKind: 'MONTHLY_UTILITY',
        status: 'UNPAID',
        billingDate: new Date('2026-07-25'),
        dueDate: new Date('2026-08-05'),
        subtotal: '4000.00',
        totalAmount: '4000.00',
        paidAmount: '0.00',
        outstandingAmount: '4000.00',
        ...overrides,
      },
    });

    await prisma.billItem.create({
      data: {
        dormitoryId: dormId,
        billId: bill.id,
        type: 'rent',
        description: 'ค่าเช่า ก.ค.',
        amount: '4000.00',
        unitPrice: '4000.00',
        quantity: 1,
      },
    });

    return { bill, room: roomSub };
  }

  // =========================================================================
  // SECTION E: LOCKED-STATE REVALIDATION RACE PROOFS
  // =========================================================================

  it('SECTION E.1: Reconciler skips bill if status mutated to CANCELLED before lock execution', async () => {
    const { bill } = await createBill('e1_cancel');

    // Simulate concurrent mutation changing Bill to CANCELLED
    await prisma.bill.update({
      where: { id: bill.id },
      data: { status: 'CANCELLED' },
    });

    // Run reconciliation as of Aug 10
    const result = await lateFeeService.reconcileSingleBillInTx(
      bill.id,
      dormId,
      new Date('2026-08-10T12:00:00.000Z')
    );

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('STATUS_NO_LONGER_LATE_FEE_ELIGIBLE');

    // Assert no late fee item created and total is untouched
    const reloaded = await prisma.bill.findUnique({
      where: { id: bill.id },
      include: { items: true },
    });
    expect(reloaded?.status).toBe('CANCELLED');
    expect(reloaded?.totalAmount.toString()).toBe('4000');
    expect(reloaded?.items.filter((i) => i.type === 'late_fee').length).toBe(0);
  });

  it('SECTION E.2: Reconciler skips bill if outstanding balance is 0 or negative', async () => {
    const { bill } = await createBill('e2_zero_out', {
      outstandingAmount: '0.00',
      paidAmount: '4000.00',
    });

    const result = await lateFeeService.reconcileSingleBillInTx(
      bill.id,
      dormId,
      new Date('2026-08-10T12:00:00.000Z')
    );

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('NO_OUTSTANDING_BALANCE');
  });

  it('SECTION E.3: Reconciler skips bill if dueDate is no longer overdue', async () => {
    const { bill } = await createBill('e3_due_date', {
      dueDate: new Date('2026-08-20T00:00:00.000Z'),
    });

    const result = await lateFeeService.reconcileSingleBillInTx(
      bill.id,
      dormId,
      new Date('2026-08-10T12:00:00.000Z')
    );

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('DUE_DATE_NO_LONGER_OVERDUE');
  });

  it('SECTION E.4: PARTIALLY_PAID bill remains eligible for locked-state late fee reconciliation', async () => {
    const { bill } = await createBill('e4_partial', {
      status: 'PARTIALLY_PAID',
      paidAmount: '1000.00',
      outstandingAmount: '3000.00',
    });

    const result = await lateFeeService.reconcileSingleBillInTx(
      bill.id,
      dormId,
      new Date('2026-08-10T12:00:00.000Z') // 3 chargeable days @ 50 = ฿150
    );

    expect(result.status).toBe('changed');
    expect(result.newTotal).toBe('4150.00');

    const reloaded = await prisma.bill.findUnique({
      where: { id: bill.id },
      include: { items: true },
    });
    expect(reloaded?.status).toBe('PARTIALLY_PAID');
    expect(reloaded?.outstandingAmount.toString()).toBe('3150');
  });

  // =========================================================================
  // SECTION F: paidAt CANONICAL AUTHORITY TEST MATRIX
  // =========================================================================

  it('TEST F.1: Cash partial payment preserves paidAt as null on PARTIALLY_PAID', async () => {
    const { bill } = await createBill('f1_cash_part');
    expect(bill.paidAt).toBeNull();

    await prisma.$transaction(async (tx) => {
      await recordCashPaymentInTx(tx, {
        dormitoryId: dormId,
        billId: bill.id,
        amount: 1000.0,
        actorUserId: ownerUserId,
      });
    });

    const reloaded = await prisma.bill.findUnique({ where: { id: bill.id } });
    expect(reloaded?.status).toBe('PARTIALLY_PAID');
    expect(reloaded?.paidAt).toBeNull();
    expect(reloaded?.paidAmount.toString()).toBe('1000');
  });

  it('TEST F.2: Cash final payment sets paidAt to current server transaction timestamp', async () => {
    const { bill } = await createBill('f2_cash_final');

    const before = new Date(Date.now() - 1000);
    await prisma.$transaction(async (tx) => {
      await recordCashPaymentInTx(tx, {
        dormitoryId: dormId,
        billId: bill.id,
        amount: 4000.0,
        actorUserId: ownerUserId,
      });
    });
    const after = new Date(Date.now() + 1000);

    const reloaded = await prisma.bill.findUnique({ where: { id: bill.id } });
    expect(reloaded?.status).toBe('PAID');
    expect(reloaded?.paidAt).not.toBeNull();
    expect(reloaded!.paidAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(reloaded!.paidAt!.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it('TEST F.3: Legacy stale paidAt on PARTIALLY_PAID bill is replaced with NOW on final settlement', async () => {
    const staleDate = new Date('2026-06-01T10:00:00.000Z');
    const { bill } = await createBill('f3_stale_paidat', {
      status: 'PARTIALLY_PAID',
      paidAmount: '1000.00',
      outstandingAmount: '3000.00',
      paidAt: staleDate, // Stale legacy date
    });

    const before = new Date(Date.now() - 1000);
    await prisma.$transaction(async (tx) => {
      await recordCashPaymentInTx(tx, {
        dormitoryId: dormId,
        billId: bill.id,
        amount: 3000.0,
        actorUserId: ownerUserId,
      });
    });
    const after = new Date(Date.now() + 1000);

    const reloaded = await prisma.bill.findUnique({ where: { id: bill.id } });
    expect(reloaded?.status).toBe('PAID');
    expect(reloaded?.paidAt).not.toBeNull();
    expect(reloaded!.paidAt!.getTime()).not.toBe(staleDate.getTime());
    expect(reloaded!.paidAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(reloaded!.paidAt!.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it('TEST F.4: Manual unverified final payment sets Bill.paidAt to server approval time (NOT claimedTransferAt)', async () => {
    const { bill } = await createBill('f4_slip_single');
    const claimedDate = new Date('2026-07-28T14:30:00.000Z');

    // Create pending single slip payment
    const payment = await prisma.payment.create({
      data: {
        dormitoryId: dormId,
        billId: bill.id,
        tenantId: tenantRecordId,
        amount: 4000.0,
        method: 'BANK_TRANSFER',
        status: 'UNDER_REVIEW',
        paymentDate: claimedDate, // Untrusted claimed date
      },
    });

    await prisma.paymentEvidenceVerification.create({
      data: {
        dormitoryId: dormId,
        paymentId: payment.id,
        provider: 'NONE',
        status: 'UNVERIFIED',
        claimedTransferAt: claimedDate,
        verifiedTransferAt: null,
      },
    });

    const beforeApproval = new Date(Date.now() - 1000);
    await paymentService.approvePayment({
      dormitoryId: dormId,
      paymentId: payment.id,
      userId: ownerUserId,
    });
    const afterApproval = new Date(Date.now() + 1000);

    const reloaded = await prisma.bill.findUnique({ where: { id: bill.id } });
    expect(reloaded?.status).toBe('PAID');
    expect(reloaded?.paidAt).not.toBeNull();
    // Must be current approval time, strictly NOT the claimed date
    expect(reloaded!.paidAt!.getTime()).not.toBe(claimedDate.getTime());
    expect(reloaded!.paidAt!.getTime()).toBeGreaterThanOrEqual(beforeApproval.getTime());
    expect(reloaded!.paidAt!.getTime()).toBeLessThanOrEqual(afterApproval.getTime());
  });

  it('TEST F.5: Group approval full settlement sets Bill.paidAt to group approval server time', async () => {
    const { bill: billA, room: roomShared } = await createBill('f5_grp_a');

    const cycleAug = await prisma.billingCycle.create({
      data: {
        dormitoryId: dormId,
        cycleCode: `2026-08-f5-${testRunId}`,
        name: 'รอบ ส.ค. 2569 (F5)',
        periodStart: new Date('2026-08-01'),
        periodEnd: new Date('2026-08-31'),
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-05'),
        status: 'active',
      },
    });

    const billB = await prisma.bill.create({
      data: {
        dormitoryId: dormId,
        roomId: roomShared.id,
        tenantId: tenantRecordId,
        billingCycleId: cycleAug.id,
        billNumber: `INV-f5_grp_b-${testRunId}`,
        billKind: 'MONTHLY_UTILITY',
        status: 'UNPAID',
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-05'),
        subtotal: '4000.00',
        totalAmount: '4000.00',
        paidAmount: '0.00',
        outstandingAmount: '4000.00',
      },
    });
    await prisma.billItem.create({
      data: {
        dormitoryId: dormId,
        billId: billB.id,
        type: 'rent',
        description: 'ค่าเช่า ส.ค.',
        amount: '4000.00',
        unitPrice: '4000.00',
        quantity: 1,
      },
    });

    const group = await prisma.combinedPaymentGroup.create({
      data: {
        dormitoryId: dormId,
        tenantId: tenantRecordId,
        totalAmount: 8000.0,
        method: 'BANK_TRANSFER',
        status: 'UNDER_REVIEW',
        paymentDate: new Date('2026-08-28T14:30:00.000Z'),
      },
    });

    await prisma.combinedPaymentGroupBillTarget.createMany({
      data: [
        { dormitoryId: dormId, paymentGroupId: group.id, billId: billA.id, targetOrder: 1 },
        { dormitoryId: dormId, paymentGroupId: group.id, billId: billB.id, targetOrder: 2 },
      ],
    });

    await prisma.payment.createMany({
      data: [
        {
          dormitoryId: dormId,
          billId: billA.id,
          tenantId: tenantRecordId,
          paymentGroupId: group.id,
          method: 'BANK_TRANSFER',
          amount: 4000.0,
          status: 'UNDER_REVIEW',
          paymentDate: new Date('2026-08-28T14:30:00.000Z'),
        },
        {
          dormitoryId: dormId,
          billId: billB.id,
          tenantId: tenantRecordId,
          paymentGroupId: group.id,
          method: 'BANK_TRANSFER',
          amount: 4000.0,
          status: 'UNDER_REVIEW',
          paymentDate: new Date('2026-08-28T14:30:00.000Z'),
        },
      ],
    });

    await prisma.paymentEvidenceVerification.create({
      data: {
        dormitoryId: dormId,
        paymentGroupId: group.id,
        provider: 'NONE',
        status: 'UNVERIFIED',
        claimedTransferAt: new Date('2026-08-28T14:30:00.000Z'),
        verifiedTransferAt: null,
      },
    });

    const beforeApproval = new Date(Date.now() - 1000);
    await paymentService.approvePaymentGroup({
      dormitoryId: dormId,
      groupId: group.id,
      userId: ownerUserId,
    });
    const afterApproval = new Date(Date.now() + 1000);

    const reloadedA = await prisma.bill.findUnique({ where: { id: billA.id } });
    const reloadedB = await prisma.bill.findUnique({ where: { id: billB.id } });

    expect(reloadedA?.status).toBe('PAID');
    expect(reloadedB?.status).toBe('PAID');
    expect(reloadedA!.paidAt!.getTime()).toBeGreaterThanOrEqual(beforeApproval.getTime());
    expect(reloadedA!.paidAt!.getTime()).toBeLessThanOrEqual(afterApproval.getTime());
    expect(reloadedB!.paidAt!.getTime()).toBeGreaterThanOrEqual(beforeApproval.getTime());
    expect(reloadedB!.paidAt!.getTime()).toBeLessThanOrEqual(afterApproval.getTime());
  });

  // =========================================================================
  // SECTION I: CASH SERVER TIMESTAMP RUNTIME PROOF
  // =========================================================================

  it('SECTION I: Cash payment paymentDate is strictly server transaction timestamp (no client timestamp accepted)', async () => {
    const { bill } = await createBill('sec_i_cash');

    const before = new Date(Date.now() - 1000);
    const result = await prisma.$transaction(async (tx) => {
      return await recordCashPaymentInTx(tx, {
        dormitoryId: dormId,
        billId: bill.id,
        amount: 2000.0,
        actorUserId: ownerUserId,
      });
    });
    const after = new Date(Date.now() + 1000);

    const paymentId = result.id || result.payment?.id;
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
    });

    expect(payment?.method).toBe('CASH');
    expect(payment?.paymentDate).toBeDefined();
    expect(payment!.paymentDate.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(payment!.paymentDate.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});
