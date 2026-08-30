/**
 * @license Apache-2.0
 * OWNER R3.8f — Group Payment Approval Forensics & Domain Error Integration Tests
 *
 * Covers:
 * 1. GROUP_ALLOCATION_RECONCILIATION_FAILED:
 *    - Returns 400 with safe actionable Thai message: 'ยอดคงเหลือของบิลมีการเปลี่ยนแปลงหลังส่งสลิป กรุณาตรวจสอบรายการใหม่ก่อนอนุมัติ'
 * 2. Successful deterministic combined-group approval:
 *    - Bill 1 (July, outstanding ฿4,000) reaches PAID with non-null paidAt
 *    - Bill 2 (August, outstanding ฿5,000) reaches PARTIALLY_PAID (paid ฿2,500, outstanding ฿2,500)
 *    - Exactly ONE single Combined Receipt created (฿6,500)
 *    - Group and all child payments reach APPROVED status
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { getEnv, resetCachedEnv } from '../../config/env.js';
import { getPrismaClient } from '../../db/prisma.js';
import { AuthenticationService } from '../../services/auth.service.js';
import { PrismaUserRepository } from '../../db/repositories/user.repository.js';
import { PrismaSessionRepository } from '../../db/repositories/session.repository.js';
import { PrismaMembershipRepository } from '../../db/repositories/membership.repository.js';
import { PrismaRoleRepository } from '../../db/repositories/role.repository.js';
import { SensitiveFieldService } from '../../services/sensitive-field.service.js';
import { subscriptionEntitlementService } from '../../services/subscription-entitlement.service.js';
import { SignatureStorageService } from '../../services/signature-storage.service.js';
import { subscriptionIntentService } from '../../services/subscription-intent.service.js';

const prisma = getPrismaClient();

describe('OWNER R3.8f: Group Payment Approval Forensics & Direct-Consumer Integration', () => {
  let app: any;
  let authService: AuthenticationService;
  const testRunId = `r38f_grp_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

  let dormId: string;
  let bldId: string;
  let ownerUserId: string;
  let ownerSessionToken: string;
  let ownerCsrfToken: string;

  let tenantRecordId: string;
  let cycleJulyId: string;
  let cycleAugId: string;

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
      mockAuditService,
      sensitiveService
    );

    app = createApp({
      authService,
      sensitiveFieldService: sensitiveService,
      subscriptionEntitlementService,
      signatureStorageService: new SignatureStorageService(),
      subscriptionIntentService,
    });

    // 1. Ensure Subscriptions & Dormitory
    await subscriptionEntitlementService.ensureSeeded();
    const freePlan = await prisma.subscriptionPlan.findFirst({ where: { code: 'FREE' } });

    const dorm = await prisma.dormitory.create({
      data: {
        name: `Dorm R38f ${testRunId}`,
        status: 'active',
      },
    });
    dormId = dorm.id;

    await prisma.dormitorySubscription.create({
      data: {
        dormitoryId: dormId,
        planId: freePlan!.id,
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 365 * 86400000),
      },
    });

    // Roles & Owner User
    const ownerRole = (await prisma.role.findFirst({ where: { code: 'owner' } })) ||
      (await prisma.role.create({ data: { code: 'owner', name: 'Owner', permissions: [] } }));
    const tenantRole = (await prisma.role.findFirst({ where: { code: 'tenant' } })) ||
      (await prisma.role.create({ data: { code: 'tenant', name: 'Tenant', permissions: [] } }));

    const ownerUser = await prisma.user.create({
      data: {
        email: `owner_${testRunId}@test.com`,
        emailNormalized: `owner_${testRunId}@test.com`,
        googleSubject: `google_owner_${testRunId}`,
        name: 'Owner User R38f',
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

    // Building
    const bld = await prisma.building.create({
      data: {
        dormitoryId: dormId,
        name: 'Building A',
      },
    });
    bldId = bld.id;

    const tenantUser = await prisma.user.create({
      data: {
        email: `tenant_${testRunId}@test.com`,
        emailNormalized: `tenant_${testRunId}@test.com`,
        googleSubject: `google_tenant_${testRunId}`,
        name: 'Tenant Room 302',
      },
    });

    await prisma.dormitoryMember.create({
      data: {
        userId: tenantUser.id,
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
        firstName: 'ทดสอบ',
        lastName: 'ผู้เช่า',
        displayName: 'ทดสอบ ผู้เช่า',
        linkedUserId: tenantUser.id,
        status: 'active',
      },
    });
    tenantRecordId = tenant.id;

    // Billing Cycles
    const cycleJuly = await prisma.billingCycle.create({
      data: {
        dormitoryId: dormId,
        cycleCode: `2026-07-${testRunId}`,
        name: 'July 2026',
        periodStart: new Date('2026-07-01T00:00:00.000Z'),
        periodEnd: new Date('2026-07-31T00:00:00.000Z'),
        billingDate: new Date('2026-07-25T00:00:00.000Z'),
        dueDate: new Date('2026-08-05T00:00:00.000Z'),
        status: 'published',
      },
    });
    cycleJulyId = cycleJuly.id;

    const cycleAug = await prisma.billingCycle.create({
      data: {
        dormitoryId: dormId,
        cycleCode: `2026-08-${testRunId}`,
        name: 'August 2026',
        periodStart: new Date('2026-08-01T00:00:00.000Z'),
        periodEnd: new Date('2026-08-31T00:00:00.000Z'),
        billingDate: new Date('2026-08-25T00:00:00.000Z'),
        dueDate: new Date('2026-09-05T00:00:00.000Z'),
        status: 'published',
      },
    });
    cycleAugId = cycleAug.id;
  });

  it('CASE 1: Re-computed allocation mismatch returns 400 GROUP_ALLOCATION_RECONCILIATION_FAILED with safe Thai message', async () => {
    const room = await prisma.room.create({
      data: {
        dormitoryId: dormId,
        buildingId: bldId,
        roomNumber: `302A-${testRunId}`,
        normalizedRoomNumber: `302A-${testRunId}`,
        floor: 3,
        status: 'occupied',
        monthlyRent: 5000,
        monthlyDeposit: 5000,
        termDeposit: 5000,
        dailyDeposit: 500,
      },
    });

    const contract = await prisma.contract.create({
      data: {
        dormitoryId: dormId,
        roomId: room.id,
        tenantId: tenantRecordId,
        contractNumber: `CTR-302A-${testRunId}`,
        startDate: new Date('2026-07-01'),
        endDate: new Date('2027-06-30'),
        rentAmount: 5000.0,
        depositAmount: 5000.0,
        status: 'active',
      },
    });

    const billJuly = await prisma.bill.create({
      data: {
        dormitory: { connect: { id: dormId } },
        room: { connect: { id: room.id } },
        tenant: { connect: { id: tenantRecordId } },
        contract: { connect: { id: contract.id } },
        billingCycle: { connect: { id: cycleJulyId } },
        billNumber: `INV-JULY-MISMATCH-${testRunId}`,
        billKind: 'MONTHLY_UTILITY',
        status: 'UNPAID',
        billingDate: new Date('2026-07-25'),
        dueDate: new Date('2026-08-05'),
        subtotal: '6100.00',
        totalAmount: '6100.00',
        paidAmount: '0.00',
        outstandingAmount: '6100.00',
      },
    });
    await prisma.billItem.create({
      data: {
        dormitoryId: dormId,
        billId: billJuly.id,
        type: 'rent',
        description: 'ค่าเช่า ก.ค.',
        amount: '6100.00',
        unitPrice: '6100.00',
        quantity: 1,
      },
    });

    const billAug = await prisma.bill.create({
      data: {
        dormitory: { connect: { id: dormId } },
        room: { connect: { id: room.id } },
        tenant: { connect: { id: tenantRecordId } },
        contract: { connect: { id: contract.id } },
        billingCycle: { connect: { id: cycleAugId } },
        billNumber: `INV-AUG-MISMATCH-${testRunId}`,
        billKind: 'MONTHLY_UTILITY',
        status: 'UNPAID',
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-05'),
        subtotal: '5000.00',
        totalAmount: '5000.00',
        paidAmount: '0.00',
        outstandingAmount: '5000.00',
      },
    });
    await prisma.billItem.create({
      data: {
        dormitoryId: dormId,
        billId: billAug.id,
        type: 'rent',
        description: 'ค่าเช่า ส.ค.',
        amount: '5000.00',
        unitPrice: '5000.00',
        quantity: 1,
      },
    });

    // Create PaymentGroup with 6,500 total, but with child payments of 4,000 / 2,500 (mismatching canonical 6,100 / 400)
    const paymentGroup = await prisma.combinedPaymentGroup.create({
      data: {
        dormitoryId: dormId,
        tenantId: tenantRecordId,
        totalAmount: 6500.0,
        method: 'BANK_TRANSFER',
        status: 'UNDER_REVIEW',
        paymentDate: new Date('2026-08-28T14:30:00Z'),
      },
    });

    await prisma.combinedPaymentGroupBillTarget.create({
      data: { dormitoryId: dormId, paymentGroupId: paymentGroup.id, billId: billJuly.id, targetOrder: 1 },
    });
    await prisma.combinedPaymentGroupBillTarget.create({
      data: { dormitoryId: dormId, paymentGroupId: paymentGroup.id, billId: billAug.id, targetOrder: 2 },
    });

    await prisma.payment.create({
      data: {
        dormitoryId: dormId,
        billId: billJuly.id,
        tenantId: tenantRecordId,
        amount: 4000.0,
        method: 'BANK_TRANSFER',
        status: 'UNDER_REVIEW',
        paymentGroupId: paymentGroup.id,
        paymentDate: new Date('2026-08-28T14:30:00Z'),
      },
    });
    await prisma.payment.create({
      data: {
        dormitoryId: dormId,
        billId: billAug.id,
        tenantId: tenantRecordId,
        amount: 2500.0,
        method: 'BANK_TRANSFER',
        status: 'UNDER_REVIEW',
        paymentGroupId: paymentGroup.id,
        paymentDate: new Date('2026-08-28T14:30:00Z'),
      },
    });

    // Attempt approve via HTTP
    const res = await request(app)
      .post(`/api/v1/payments/combined-groups/${paymentGroup.id}/approve`)
      .set('Cookie', [`horplus_session=${ownerSessionToken}`, `horplus_csrf=${ownerCsrfToken}`])
      .set('x-csrf-token', ownerCsrfToken)
      .set('x-dormitory-id', dormId)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('GROUP_ALLOCATION_RECONCILIATION_FAILED');
    expect(res.body.error.message).toBe('ยอดคงเหลือของบิลมีการเปลี่ยนแปลงหลังส่งสลิป กรุณาตรวจสอบรายการใหม่ก่อนอนุมัติ');
  });

  it('CASE 2: Deterministic Clean Combined Approval — Builds canonical prior payment graph, verifies zero legacyUnallocatedPaidAmount, settles bills cleanly and creates exactly 1 combined receipt', async () => {
    const room = await prisma.room.create({
      data: {
        dormitoryId: dormId,
        buildingId: bldId,
        roomNumber: `302B-${testRunId}`,
        normalizedRoomNumber: `302B-${testRunId}`,
        floor: 3,
        status: 'occupied',
        monthlyRent: 5000,
        monthlyDeposit: 5000,
        termDeposit: 5000,
        dailyDeposit: 500,
      },
    });

    const contract = await prisma.contract.create({
      data: {
        dormitoryId: dormId,
        roomId: room.id,
        tenantId: tenantRecordId,
        contractNumber: `CTR-302B-${testRunId}`,
        startDate: new Date('2026-07-01'),
        endDate: new Date('2027-06-30'),
        rentAmount: 5000.0,
        depositAmount: 5000.0,
        status: 'active',
      },
    });

    // 1. Initial July bill (total ฿6,100, unpaid)
    const billJuly = await prisma.bill.create({
      data: {
        dormitory: { connect: { id: dormId } },
        room: { connect: { id: room.id } },
        tenant: { connect: { id: tenantRecordId } },
        contract: { connect: { id: contract.id } },
        billingCycle: { connect: { id: cycleJulyId } },
        billNumber: `INV-JULY-CLEAN-${testRunId}`,
        billKind: 'MONTHLY_UTILITY',
        status: 'UNPAID',
        billingDate: new Date('2026-07-25'),
        dueDate: new Date('2026-08-05'),
        subtotal: '6100.00',
        totalAmount: '6100.00',
        paidAmount: '0.00',
        outstandingAmount: '6100.00',
      },
    });
    const itemJuly = await prisma.billItem.create({
      data: {
        dormitoryId: dormId,
        billId: billJuly.id,
        type: 'rent',
        description: 'ค่าเช่า ก.ค.',
        amount: '6100.00',
        unitPrice: '6100.00',
        quantity: 1,
      },
    });

    // 2. Canonical Prior Cash Event: ฿2,100 partial payment with full audit actor identity
    const priorPaymentDate = new Date('2026-08-10T10:00:00Z');
    const priorGroup = await prisma.combinedPaymentGroup.create({
      data: {
        dormitoryId: dormId,
        tenantId: tenantRecordId,
        totalAmount: 2100.0,
        method: 'CASH',
        status: 'APPROVED',
        paymentDate: priorPaymentDate,
        recordedByUserId: ownerUserId,
        notes: 'ชำระเงินสดบางส่วนที่เคาน์เตอร์',
      },
    });

    await prisma.combinedPaymentGroupBillTarget.create({
      data: {
        dormitoryId: dormId,
        paymentGroupId: priorGroup.id,
        billId: billJuly.id,
        targetOrder: 1,
      },
    });

    const priorPayment = await prisma.payment.create({
      data: {
        dormitoryId: dormId,
        billId: billJuly.id,
        tenantId: tenantRecordId,
        paymentGroupId: priorGroup.id,
        method: 'CASH',
        amount: 2100.0,
        status: 'APPROVED',
        paymentDate: priorPaymentDate,
        reviewedByUserId: ownerUserId,
        reviewedAt: priorPaymentDate,
      },
    });

    const priorPaymentStatusHist = await prisma.paymentStatusHistory.create({
      data: {
        dormitoryId: dormId,
        paymentId: priorPayment.id,
        fromStatus: null,
        toStatus: 'APPROVED',
        changedByUserId: ownerUserId,
        effectiveAt: priorPaymentDate,
      },
    });

    await prisma.paymentAllocation.create({
      data: {
        dormitoryId: dormId,
        paymentGroupId: priorGroup.id,
        paymentId: priorPayment.id,
        billId: billJuly.id,
        billItemId: itemJuly.id,
        allocatedAmount: 2100.0,
        allocationOrder: 1,
      },
    });

    const priorBillStatusHist = await prisma.billStatusHistory.create({
      data: {
        dormitoryId: dormId,
        billId: billJuly.id,
        fromStatus: 'UNPAID',
        toStatus: 'PARTIALLY_PAID',
        changedByUserId: ownerUserId,
        effectiveAt: priorPaymentDate,
      },
    });

    const priorReceipt = await prisma.receipt.create({
      data: {
        dormitoryId: dormId,
        billId: billJuly.id,
        paymentId: priorPayment.id,
        paymentGroupId: priorGroup.id,
        receiptNumber: `RCP-PRIOR-2100-${testRunId}`,
        snapshotData: {
          receiptNumber: `RCP-PRIOR-2100-${testRunId}`,
          billNumber: billJuly.billNumber,
          roomNumber: room.roomNumber,
          tenantName: 'ผู้เช่าทดสอบ',
          dormitoryName: `Dorm R38f ${testRunId}`,
          total: '2100.00',
          totalAmount: 2100.0,
          paymentMethod: 'CASH',
          paymentDate: priorPaymentDate.toISOString(),
          receiverName: 'Owner User R38f',
          items: [{ description: 'ค่าเช่า ก.ค. — ชำระบางส่วน', amount: 2100.0 }],
        },
        issuedByUserId: ownerUserId,
        issuedAt: priorPaymentDate,
        isVoided: false,
      },
    });

    await prisma.bill.update({
      where: { id: billJuly.id },
      data: {
        paidAmount: '2100.00',
        outstandingAmount: '4000.00',
        status: 'PARTIALLY_PAID',
      },
    });

    // 3. Pre-Approval Financial Graph & Audit Actor Assertions
    expect(priorGroup.recordedByUserId).toBe(ownerUserId);
    expect(priorPayment.reviewedByUserId).toBe(ownerUserId);
    expect(priorPayment.reviewedAt?.toISOString()).toBe(priorPaymentDate.toISOString());
    expect(priorPaymentStatusHist.changedByUserId).toBe(ownerUserId);
    expect(priorBillStatusHist.changedByUserId).toBe(ownerUserId);
    expect(priorReceipt.issuedByUserId).toBe(ownerUserId);
    expect((priorReceipt.snapshotData as any)?.receiverName).toBe('Owner User R38f');

    const preJulyBill = await prisma.bill.findUnique({
      where: { id: billJuly.id },
      include: { allocations: true, Receipt: true, Payment: true },
    });
    expect(Number(preJulyBill?.totalAmount)).toBe(6100.0);
    expect(Number(preJulyBill?.paidAmount)).toBe(2100.0);
    expect(Number(preJulyBill?.outstandingAmount)).toBe(4000.0);
    expect(preJulyBill?.status).toBe('PARTIALLY_PAID');

    const preAllocationsSum = preJulyBill?.allocations.reduce((s, a) => s + Number(a.allocatedAmount), 0) || 0;
    expect(preAllocationsSum).toBe(2100.0);
    const legacyUnallocatedPaidAmount = Math.max(Number(preJulyBill?.paidAmount) - preAllocationsSum, 0);
    expect(legacyUnallocatedPaidAmount).toBe(0.0); // Strict non-legacy proof
    expect(preJulyBill?.Receipt.length).toBe(1);
    expect(preJulyBill?.Receipt[0].receiptNumber).toBe(priorReceipt.receiptNumber);

    // 4. August bill (total ฿5,000, outstanding ฿5,000, unpaid)
    const billAug = await prisma.bill.create({
      data: {
        dormitory: { connect: { id: dormId } },
        room: { connect: { id: room.id } },
        tenant: { connect: { id: tenantRecordId } },
        contract: { connect: { id: contract.id } },
        billingCycle: { connect: { id: cycleAugId } },
        billNumber: `INV-AUG-CLEAN-${testRunId}`,
        billKind: 'MONTHLY_UTILITY',
        status: 'UNPAID',
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-05'),
        subtotal: '5000.00',
        totalAmount: '5000.00',
        paidAmount: '0.00',
        outstandingAmount: '5000.00',
      },
    });
    const itemAug = await prisma.billItem.create({
      data: {
        dormitoryId: dormId,
        billId: billAug.id,
        type: 'rent',
        description: 'ค่าเช่า ส.ค.',
        amount: '5000.00',
        unitPrice: '5000.00',
        quantity: 1,
      },
    });

    // 5. Combined payment group ฿6,500: allocates ฿4,000 to July (closes it) and ฿2,500 to August (partial)
    const paymentGroup = await prisma.combinedPaymentGroup.create({
      data: {
        dormitoryId: dormId,
        tenantId: tenantRecordId,
        totalAmount: 6500.0,
        method: 'BANK_TRANSFER',
        status: 'UNDER_REVIEW',
        paymentDate: new Date('2026-08-28T14:30:00Z'),
      },
    });

    await prisma.combinedPaymentGroupBillTarget.create({
      data: { dormitoryId: dormId, paymentGroupId: paymentGroup.id, billId: billJuly.id, targetOrder: 1 },
    });
    await prisma.combinedPaymentGroupBillTarget.create({
      data: { dormitoryId: dormId, paymentGroupId: paymentGroup.id, billId: billAug.id, targetOrder: 2 },
    });

    const payJuly = await prisma.payment.create({
      data: {
        dormitoryId: dormId,
        billId: billJuly.id,
        tenantId: tenantRecordId,
        amount: 4000.0,
        method: 'BANK_TRANSFER',
        status: 'UNDER_REVIEW',
        paymentGroupId: paymentGroup.id,
        paymentDate: new Date('2026-08-28T14:30:00Z'),
      },
    });
    const payAug = await prisma.payment.create({
      data: {
        dormitoryId: dormId,
        billId: billAug.id,
        tenantId: tenantRecordId,
        amount: 2500.0,
        method: 'BANK_TRANSFER',
        status: 'UNDER_REVIEW',
        paymentGroupId: paymentGroup.id,
        paymentDate: new Date('2026-08-28T14:30:00Z'),
      },
    });

    // 6. Approve via HTTP
    const res = await request(app)
      .post(`/api/v1/payments/combined-groups/${paymentGroup.id}/approve`)
      .set('Cookie', [`horplus_session=${ownerSessionToken}`, `horplus_csrf=${ownerCsrfToken}`])
      .set('x-csrf-token', ownerCsrfToken)
      .set('x-dormitory-id', dormId)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.group.status).toBe('APPROVED');

    // 7. Post-Approval Financial Graph Assertions
    const updatedGroup = await prisma.combinedPaymentGroup.findUnique({
      where: { id: paymentGroup.id },
      include: { receipts: true, payments: true },
    });
    expect(updatedGroup?.status).toBe('APPROVED');
    expect(updatedGroup?.receipts.length).toBe(1); // Exactly 1 new combined receipt for this group
    expect(updatedGroup?.receipts[0].paymentGroupId).toBe(paymentGroup.id);
    const receiptSnapshot = updatedGroup?.receipts[0].snapshotData as any;
    expect(Number(receiptSnapshot?.total || receiptSnapshot?.totalAmount)).toBe(6500.0);
    expect(receiptSnapshot?.items.length).toBeGreaterThanOrEqual(2);

    // Verify Child Payments reach APPROVED
    for (const p of updatedGroup!.payments) {
      expect(p.status).toBe('APPROVED');
    }

    // Verify July Bill (PAID, paidAt set, outstanding = 0, total allocations = 6100)
    const updatedJuly = await prisma.bill.findUnique({
      where: { id: billJuly.id },
      include: { allocations: true, Receipt: true, Payment: true },
    });
    expect(updatedJuly?.status).toBe('PAID');
    expect(Number(updatedJuly?.paidAmount)).toBe(6100.0);
    expect(Number(updatedJuly?.outstandingAmount)).toBe(0.0);
    expect(updatedJuly?.paidAt).not.toBeNull();
    const postJulyAllocationsSum = updatedJuly?.allocations.reduce((s, a) => s + Number(a.allocatedAmount), 0) || 0;
    expect(postJulyAllocationsSum).toBe(6100.0); // 2100 prior + 4000 group = 6100 (0 orphan/phantom paidAmount)
    expect(Number(updatedJuly?.paidAmount) - postJulyAllocationsSum).toBe(0.0);

    // Verify August Bill (PARTIAL, paid = 2500, outstanding = 2500, total allocations = 2500)
    const updatedAug = await prisma.bill.findUnique({
      where: { id: billAug.id },
      include: { allocations: true },
    });
    expect(updatedAug?.status).toBe('PARTIALLY_PAID');
    expect(Number(updatedAug?.paidAmount)).toBe(2500.0);
    expect(Number(updatedAug?.outstandingAmount)).toBe(2500.0);
    const postAugAllocationsSum = updatedAug?.allocations.reduce((s, a) => s + Number(a.allocatedAmount), 0) || 0;
    expect(postAugAllocationsSum).toBe(2500.0);
    expect(Number(updatedAug?.paidAmount) - postAugAllocationsSum).toBe(0.0);

    // Total Monetary Evidence: 2100 (prior) + 6500 (group) = 8600.00
    const totalApprovedPaymentsSum = [priorPayment.amount, payJuly.amount, payAug.amount].reduce((s, a) => s + Number(a), 0);
    expect(totalApprovedPaymentsSum).toBe(8600.0);
  });
});
