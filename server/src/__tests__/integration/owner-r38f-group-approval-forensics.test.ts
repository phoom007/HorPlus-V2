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

  it('CASE 2: Deterministic Clean Combined Approval — Bills update cleanly and creates exactly 1 combined receipt', async () => {
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

    // July bill with total ฿6,100, previously paid ฿2,100, outstanding ฿4,000
    const billJuly = await prisma.bill.create({
      data: {
        dormitory: { connect: { id: dormId } },
        room: { connect: { id: room.id } },
        tenant: { connect: { id: tenantRecordId } },
        contract: { connect: { id: contract.id } },
        billingCycle: { connect: { id: cycleJulyId } },
        billNumber: `INV-JULY-CLEAN-${testRunId}`,
        billKind: 'MONTHLY_UTILITY',
        status: 'PARTIALLY_PAID',
        billingDate: new Date('2026-07-25'),
        dueDate: new Date('2026-08-05'),
        subtotal: '6100.00',
        totalAmount: '6100.00',
        paidAmount: '2100.00',
        outstandingAmount: '4000.00',
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

    // August bill with total ฿5,000, outstanding ฿5,000
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

    // Combined payment group ฿6,500: allocates ฿4,000 to July (closes it) and ฿2,500 to August (partial)
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

    // Approve via HTTP
    const res = await request(app)
      .post(`/api/v1/payments/combined-groups/${paymentGroup.id}/approve`)
      .set('Cookie', [`horplus_session=${ownerSessionToken}`, `horplus_csrf=${ownerCsrfToken}`])
      .set('x-csrf-token', ownerCsrfToken)
      .set('x-dormitory-id', dormId)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.group.status).toBe('APPROVED');

    // Verify Group Status & Receipt
    const updatedGroup = await prisma.combinedPaymentGroup.findUnique({
      where: { id: paymentGroup.id },
      include: { receipts: true, payments: true },
    });
    expect(updatedGroup?.status).toBe('APPROVED');
    expect(updatedGroup?.receipts.length).toBe(1);
    expect(updatedGroup?.receipts[0].paymentGroupId).toBe(paymentGroup.id);
    const receiptSnapshot = updatedGroup?.receipts[0].snapshotData as any;
    expect(Number(receiptSnapshot?.total || receiptSnapshot?.totalAmount)).toBe(6500.0);
    expect(receiptSnapshot?.items.length).toBeGreaterThanOrEqual(2);

    // Verify Child Payments reach APPROVED
    for (const p of updatedGroup!.payments) {
      expect(p.status).toBe('APPROVED');
    }

    // Verify July Bill (PAID, paidAt set, outstanding = 0)
    const updatedJuly = await prisma.bill.findUnique({ where: { id: billJuly.id } });
    expect(updatedJuly?.status).toBe('PAID');
    expect(Number(updatedJuly?.paidAmount)).toBe(6100.0);
    expect(Number(updatedJuly?.outstandingAmount)).toBe(0.0);
    expect(updatedJuly?.paidAt).not.toBeNull();

    // Verify August Bill (PARTIAL, paid = 2500, outstanding = 2500)
    const updatedAug = await prisma.bill.findUnique({ where: { id: billAug.id } });
    expect(updatedAug?.status).toBe('PARTIALLY_PAID');
    expect(Number(updatedAug?.paidAmount)).toBe(2500.0);
    expect(Number(updatedAug?.outstandingAmount)).toBe(2500.0);
  });
});
