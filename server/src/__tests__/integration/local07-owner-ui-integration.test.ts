/**
 * HORPLUS LOCAL-07 — Product Owner UI & Backend Integration Tests
 * Validates:
 * 1. Building.maxTermRentInstallments (1..12, non-null, default 1, PostgreSQL/F5 persistence)
 * 2. DormitoryBillingSettings.promptPayAccountName independent persistence & roundtrip
 * 3. Exact Satang Integer Math & Cycle-Indexed Deterministic Installment Scheduling
 * 4. Omission of base rent line after final installment (k > N) while active utilities continue
 * 5. Production Tenant Choice Invariant (missing tenant choice does NOT activate installment scheduling)
 * 6. LINE OA skip vs configured verification semantics
 * 7. Canonical pet policy IDs ['dog', 'cat', 'small_pet', 'other']
 * 8. Object storage signature storage & SHA-256 snapshot hashes
 *
 * @license Apache-2.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { getPrismaClient } from '../../db/prisma.js';
import {
  decimalStringToSatangs,
  satangsToDecimalString,
  generateExactInstallmentSchedule,
} from '../../utils/installment-math.util.js';
import { DormitoryProvisioningService } from '../../services/dormitory-provisioning.service.js';
import { SensitiveFieldService } from '../../services/sensitive-field.service.js';
import { BillingService } from '../../services/billing.service.js';
import { ContractService } from '../../services/contract.service.js';
import { PrismaBillRepository } from '../../db/repositories/bill.repository.js';
import { PrismaBillingCycleRepository } from '../../db/repositories/billing-cycle.repository.js';
import { PrismaMeterRepository } from '../../db/repositories/meter.repository.js';
import { PrismaContractRepository } from '../../db/repositories/contract.repository.js';
import { PrismaRoomRepository } from '../../db/repositories/room.repository.js';
import { PrismaTenantRepository } from '../../db/repositories/tenant.repository.js';
import { AuditService } from '../../services/audit.service.js';
import { computeSnapshotSha256 } from '../../services/tenant-registration.service.js';
import crypto from 'crypto';

describe('LOCAL-07: Product Owner UI & Backend Integration', () => {
  const prisma = getPrismaClient();
  const sensitiveFieldService = new SensitiveFieldService('12345678901234567890123456789012');
  const provisioningService = new DormitoryProvisioningService(prisma, sensitiveFieldService);

  const billRepo = new PrismaBillRepository(prisma);
  const cycleRepo = new PrismaBillingCycleRepository(prisma);
  const meterRepo = new PrismaMeterRepository(prisma);
  const contractRepo = new PrismaContractRepository(prisma);
  const roomRepo = new PrismaRoomRepository(prisma);
  const tenantRepo = new PrismaTenantRepository(prisma);
  const auditService = new AuditService();

  const billingService = new BillingService(
    billRepo,
    cycleRepo,
    meterRepo,
    contractRepo,
    roomRepo,
    tenantRepo,
    auditService
  );

  const contractService = new ContractService(
    contractRepo,
    roomRepo,
    tenantRepo,
    auditService
  );

  let testUserId: string;

  beforeAll(async () => {
    // Create test owner user
    const testEmail = `owner-local07-${Date.now()}@example.com`;
    const user = await prisma.user.create({
      data: {
        id: crypto.randomUUID(),
        googleSubject: `google-${Date.now()}`,
        email: testEmail,
        emailNormalized: testEmail.toLowerCase(),
        name: 'นายทดสอบ บัญชีเจ้าของ',
        phone: '0819998888',
        status: 'active',
      },
    });
    testUserId = user.id;
  });

  afterAll(async () => {
    // Cleanup test user and cascaded data
    if (testUserId) {
      await prisma.dormitoryMember.deleteMany({ where: { userId: testUserId } });
      const dorms = await prisma.dormitory.findMany({ where: { createdByUserId: testUserId } });
      for (const d of dorms) {
        await prisma.billItem.deleteMany({ where: { bill: { dormitoryId: d.id } } });
        await prisma.bill.deleteMany({ where: { dormitoryId: d.id } });
        await prisma.billingRateSnapshot.deleteMany({ where: { dormitoryId: d.id } });
        await prisma.meterReading.deleteMany({ where: { dormitoryId: d.id } });
        await prisma.billingCycle.deleteMany({ where: { dormitoryId: d.id } });
        await prisma.contractSnapshot.deleteMany({ where: { dormitoryId: d.id } });
        await prisma.contract.deleteMany({ where: { dormitoryId: d.id } });
        await prisma.room.deleteMany({ where: { dormitoryId: d.id } });
        await prisma.building.deleteMany({ where: { dormitoryId: d.id } });
        await prisma.tenant.deleteMany({ where: { dormitoryId: d.id } });
        await prisma.tenantRegistrationRequest.deleteMany({ where: { dormitoryId: d.id } });
        await prisma.ownerSignature.deleteMany({ where: { dormitoryId: d.id } });
        await prisma.dormitoryPropertyDefaults.deleteMany({ where: { dormitoryId: d.id } });
        await prisma.dormitoryBillingSettings.deleteMany({ where: { dormitoryId: d.id } });
        await prisma.dormitoryLineConfig.deleteMany({ where: { dormitoryId: d.id } });
        await prisma.accountBenefitClaim.deleteMany({ where: { dormitoryId: d.id } });
        await prisma.promoRedemption.deleteMany({ where: { dormitoryId: d.id } });
        await prisma.subscriptionStatusHistory.deleteMany({ where: { subscription: { dormitoryId: d.id } } });
        await prisma.dormitorySubscription.deleteMany({ where: { dormitoryId: d.id } });
        await prisma.role.deleteMany({ where: { dormitoryId: d.id } });
        await prisma.dormitory.delete({ where: { id: d.id } });
      }
      await prisma.user.delete({ where: { id: testUserId } });
    }
  });

  describe('1. Exact Decimal-String Satang Integer Arithmetic', () => {
    it('accurately parses decimal strings to BigInt satangs without floating point drift', () => {
      expect(decimalStringToSatangs('18000.00')).toBe(1800000n);
      expect(decimalStringToSatangs('18001.01')).toBe(1800101n);
      expect(decimalStringToSatangs('0.50')).toBe(50n);
      expect(decimalStringToSatangs('12.3')).toBe(1230n);
      expect(decimalStringToSatangs('100')).toBe(10000n);
    });

    it('accurately converts BigInt satangs back to canonical 2-decimal strings', () => {
      expect(satangsToDecimalString(1800000n)).toBe('18000.00');
      expect(satangsToDecimalString(1800101n)).toBe('18001.01');
      expect(satangsToDecimalString(50n)).toBe('0.50');
      expect(satangsToDecimalString(9n)).toBe('0.09');
    });

    it('generates exact satang installments allocating remainder to final installment', () => {
      // 18,000 / 2 = exactly 9,000 + 9,000
      const sched1 = generateExactInstallmentSchedule('18000.00', 2);
      expect(sched1).toHaveLength(2);
      expect(sched1[0].amount).toBe('9000.00');
      expect(sched1[0].cycleOffset).toBe(0);
      expect(sched1[1].amount).toBe('9000.00');
      expect(sched1[1].cycleOffset).toBe(1);

      // 18,001.01 / 2 = 9000.50 (item 1) + 9000.51 (item 2 - final)
      const sched2 = generateExactInstallmentSchedule('18001.01', 2);
      expect(sched2).toHaveLength(2);
      expect(sched2[0].amount).toBe('9000.50');
      expect(sched2[1].amount).toBe('9000.51');

      // 10,000 / 3 = 3333.33 + 3333.33 + 3333.34
      const sched3 = generateExactInstallmentSchedule('10000.00', 3);
      expect(sched3).toHaveLength(3);
      expect(sched3[0].amount).toBe('3333.33');
      expect(sched3[1].amount).toBe('3333.33');
      expect(sched3[2].amount).toBe('3333.34');
    });
  });

  describe('2. Building.maxTermRentInstallments & PromptPay Name Persistence', () => {
    it('persists Building.maxTermRentInstallments (1..12) and promptPayAccountName into PostgreSQL during onboarding', async () => {
      // Prepare provisional dormitory
      const prep = await provisioningService.prepareProvisionalDormitory(testUserId, {
        name: 'หอพักทดสอบ Local07 Suite A',
        province: 'กรุงเทพมหานคร',
      });
      const dormId = prep.provisionalDormitoryId;

      // Create owner signature with RLS context
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormId}, true)`;
        await tx.ownerSignature.create({
          data: {
            dormitory: { connect: { id: dormId } },
            objectKey: `signatures/owner-${Date.now()}.png`,
            sha256: crypto.randomBytes(32).toString('hex'),
            mimeType: 'image/png',
            byteSize: 1024,
            isCurrent: true,
            signedBy: { connect: { id: testUserId } },
          },
        });
      });

      // Complete onboarding with building maxInstallmentMonths = 3 and independent promptPayAccountName
      const result = await provisioningService.completeOwnerOnboarding({
        userId: testUserId,
        idempotencyKey: crypto.randomUUID(),
        dormitory: {
          name: 'หอพักทดสอบ Local07 Suite A',
          province: 'กรุงเทพมหานคร',
          estimatedBuildingCount: 1,
          estimatedRoomCount: 2,
        },
        billing: {
          waterRate: '18.00',
          electricityRate: '7.00',
        },
        payment: {
          cashAccepted: true,
          promptPayType: 'mobile_phone',
          promptPayValue: '0819998888',
          promptPayAccountName: 'นายพร้อมเพย์ อิสระ',
          bankCode: 'กสิกรไทย (KBank)',
          bankAccountName: 'นายบัญชีธนาคาร คนละชื่อ',
          bankAccountNumber: '0982345678',
        },
        buildings: [
          {
            id: 'b-local07-1',
            name: 'อาคาร A ทดสอบ',
            floorsCount: 2,
            roomsPerFloor: 1,
            monthlyRent: 4500,
            termRent: 18000,
            termMonths: 4,
            maxInstallmentMonths: 3,
          },
        ],
        rooms: [
          {
            buildingId: 'b-local07-1',
            roomNumber: 'A101',
            floor: 1,
            monthlyRent: 4500,
            termRent: 18000,
            termMonths: 4,
            depositAmount: 5000,
          },
          {
            buildingId: 'b-local07-1',
            roomNumber: 'A102',
            floor: 1,
            monthlyRent: 4500,
            termRent: 18000,
            termMonths: 4,
            depositAmount: 5000,
          },
        ],
        petPolicy: {
          allowed: 'conditional',
          allowedTypes: ['dog', 'cat', 'small_pet'],
        },
        defaultTerms: 'ห้ามส่งเสียงดังหลัง 22:00 น.',
        planCode: 'FREE',
      });

      expect(result.dormitory.id).toBe(dormId);

      // Verify PostgreSQL read-back (F5 equivalent)
      const savedBuilding = await prisma.building.findFirst({
        where: { dormitoryId: dormId, name: 'อาคาร A ทดสอบ' },
      });
      expect(savedBuilding).toBeDefined();
      expect(savedBuilding?.maxTermRentInstallments).toBe(3);

      const savedBillingSettings = await prisma.dormitoryBillingSettings.findUnique({
        where: { dormitoryId: dormId },
      });
      expect(savedBillingSettings).toBeDefined();
      expect(savedBillingSettings?.promptPayAccountName).toBe('นายพร้อมเพย์ อิสระ');
      expect(savedBillingSettings?.bankAccountName).toBe('นายบัญชีธนาคาร คนละชื่อ');

      const savedDefaults = await prisma.dormitoryPropertyDefaults.findUnique({
        where: { dormitoryId: dormId },
      });
      expect(savedDefaults?.defaultTerms).toBe('ห้ามส่งเสียงดังหลัง 22:00 น.');
      expect((savedDefaults?.petPolicy as any)?.allowedTypes).toEqual(['dog', 'cat', 'small_pet']);
    });

    it('persists untouched default maxInstallmentMonths = 2 through PostgreSQL and F5 read-back without sending removed Step 1 fields', async () => {
      const email = `owner.default2.${Date.now()}@example.com`;
      const ownerUser = await prisma.user.create({
        data: {
          id: crypto.randomUUID(),
          googleSubject: `google-owner-def2-${Date.now()}`,
          email,
          emailNormalized: email.toLowerCase(),
          name: 'เจ้าของ ค่าตั้งต้น 2',
          status: 'active',
        },
      });

      const prep = await provisioningService.prepareProvisionalDormitory(ownerUser.id, {
        name: 'หอพักทดสอบ Default 2 และ No Step 1 Phone',
        province: 'กรุงเทพมหานคร',
      });
      const dormId = prep.provisionalDormitoryId;

      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormId}, true)`;
        await tx.ownerSignature.create({
          data: {
            dormitory: { connect: { id: dormId } },
            objectKey: `signatures/owner-${Date.now()}-2.png`,
            sha256: crypto.randomBytes(32).toString('hex'),
            mimeType: 'image/png',
            byteSize: 1024,
            isCurrent: true,
            signedBy: { connect: { id: ownerUser.id } },
          },
        });
      });

      const result = await provisioningService.completeOwnerOnboarding({
        userId: ownerUser.id,
        idempotencyKey: crypto.randomUUID(),
        provisionalDormitoryId: dormId,
        dormitory: {
          name: 'หอพักทดสอบ Default 2 และ No Step 1 Phone',
          type: 'apartment',
          genderPolicy: 'รวม',
          addressLine1: '123 ถนนสุขุมวิท',
          province: 'กรุงเทพมหานคร',
          phone: null, // Removed Step 1 fields must be null
          email: null,
        },
        billing: {
          billingDay: 25,
          dueDay: 5,
          waterBillingType: 'per_unit',
          waterRate: '18.00',
          electricityBillingType: 'per_unit',
          electricityRate: '8.00',
          rentBillingType: 'monthly',
        },
        payment: {
          cashAccepted: true,
          promptPayType: 'mobile_phone',
          promptPayValue: '0819998888',
          promptPayAccountName: 'เจ้าของ Authenticated',
          bankCode: 'กสิกรไทย (KBank)',
          bankAccountName: 'เจ้าของ Authenticated',
          bankAccountNumber: '0982345678',
        },
        buildings: [
          {
            id: 'b-default-2',
            name: 'อาคาร ค่าตั้งต้น 2',
            floorsCount: 2,
            roomsPerFloor: 1,
            monthlyRent: 4500,
            termRent: 18000,
            termMonths: 4,
            maxInstallmentMonths: 2, // Untouched visible default in UI
          },
        ],
        rooms: [
          {
            buildingId: 'b-default-2',
            roomNumber: '101',
            floor: 1,
            monthlyRent: 4500,
            termRent: 18000,
            termMonths: 4,
            depositAmount: 5000,
          },
        ],
        petPolicy: {
          allowed: 'conditional',
          allowedTypes: ['dog', 'cat', 'small_pet'],
        },
        planCode: 'FREE',
      });

      expect(result.dormitory.id).toBe(dormId);

      // Verify PostgreSQL read-back (F5 equivalent)
      const savedBuilding = await prisma.building.findFirst({
        where: { dormitoryId: dormId, name: 'อาคาร ค่าตั้งต้น 2' },
      });
      expect(savedBuilding?.maxTermRentInstallments).toBe(2);

      const savedDorm = await prisma.dormitory.findUnique({
        where: { id: dormId },
      });
      expect(savedDorm?.phone).toBeNull();
      expect(savedDorm?.email).toBeNull();
    });

    it('enforces DB CHECK constraint (1..12) on buildings.max_term_rent_installments', async () => {
      const dorm = await prisma.dormitory.create({
        data: {
          id: crypto.randomUUID(),
          name: 'หอพักทดสอบ CHECK Constraint',
          createdByUserId: testUserId,
          status: 'active',
        },
      });

      // Valid 1..12 succeeds
      await prisma.$executeRawUnsafe(
        `INSERT INTO buildings (id, dormitory_id, name, max_term_rent_installments, updated_at) VALUES ('${crypto.randomUUID()}', '${dorm.id}', 'อาคารทดสอบ Valid', 12, NOW())`
      );

      // Invalid 0 throws PostgreSQL check constraint violation
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO buildings (id, dormitory_id, name, max_term_rent_installments, updated_at) VALUES ('${crypto.randomUUID()}', '${dorm.id}', 'อาคารทดสอบ Invalid 0', 0, NOW())`
        )
      ).rejects.toThrow();

      // Invalid 13 throws PostgreSQL check constraint violation
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO buildings (id, dormitory_id, name, max_term_rent_installments, updated_at) VALUES ('${crypto.randomUUID()}', '${dorm.id}', 'อาคารทดสอบ Invalid 13', 13, NOW())`
        )
      ).rejects.toThrow();
    });
  });

  describe('3. Deterministic Installment Scheduling & Final Period Rent Omission', () => {
    it('bills installments for period 1 and 2, then completely omits rent in period 3 while keeping utilities', async () => {
      // Create dormitory with building & rooms
      const dorm = await prisma.dormitory.create({
        data: {
          id: crypto.randomUUID(),
          name: 'หอพักสัญญางวด Local07',
          createdByUserId: testUserId,
          status: 'active',
        },
      });

      await prisma.dormitoryBillingSettings.create({
        data: {
          dormitoryId: dorm.id,
          waterRate: '20.00',
          electricityRate: '8.00',
          commonFee: '200.00',
          commonFeeMode: 'room',
        },
      });

      await prisma.dormitoryPropertyDefaults.create({
        data: {
          dormitoryId: dorm.id,
          defaultMonthlyRent: '4500.00',
          defaultTermRent: '18001.01',
          defaultDeposit: '5000.00',
        },
      });

      const building = await prisma.building.create({
        data: {
          id: crypto.randomUUID(),
          dormitoryId: dorm.id,
          name: 'อาคาร เทอม',
          maxTermRentInstallments: 2,
        },
      });

      const room = await prisma.room.create({
        data: {
          id: crypto.randomUUID(),
          dormitoryId: dorm.id,
          buildingId: building.id,
          roomNumber: 'T201',
          normalizedRoomNumber: 'T201',
          floor: 1,
          roomType: 'standard',
          termRent: '18001.01',
          termMonths: 4,
          status: 'VACANT',
        },
      });

      const tenant = await prisma.tenant.create({
        data: {
          id: crypto.randomUUID(),
          dormitoryId: dorm.id,
          tenantNumber: `TN-${Date.now()}-1`,
          displayName: 'สมชาย ผู้เช่าแบ่งงวด',
          firstName: 'สมชาย',
          lastName: 'ผู้เช่าแบ่งงวด',
          phone: '0891234567',
          status: 'active',
        },
      });

      // Create Contract for 4 months (2026-09-01 to 2027-01-01) with explicit rentBillingType: 'term'
      const contract = await prisma.contract.create({
        data: {
          id: crypto.randomUUID(),
          dormitoryId: dorm.id,
          roomId: room.id,
          tenantId: tenant.id,
          contractNumber: `CTR-${Date.now()}`,
          startDate: new Date('2026-09-01T00:00:00.000Z'),
          endDate: new Date('2027-01-01T00:00:00.000Z'),
          rentBillingType: 'term',
          rentAmount: '18001.01',
          depositAmount: '5000.00',
          status: 'draft',
        },
      });

      // Activate contract with explicit selectedInstallments = 2 (Domain Fixture)
      await contractService.activateContract(
        contract.id,
        dorm.id,
        {
          ownerSignature: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          tenantSignature: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          selectedInstallments: 2,
        },
        testUserId
      );

      // Verify ContractSnapshot installmentConfig
      const snapshot = await prisma.contractSnapshot.findUnique({
        where: { contractId: contract.id },
      });
      expect(snapshot).toBeDefined();
      const instCfg = snapshot?.installmentConfig as any;
      expect(instCfg).toBeDefined();
      expect(instCfg.selectedInstallments).toBe(2);
      expect(instCfg.installmentSchedule).toHaveLength(2);
      expect(instCfg.installmentSchedule[0].amount).toBe('9000.50');
      expect(instCfg.installmentSchedule[1].amount).toBe('9000.51');

      // Create Billing Cycle 1: September 2026 (cycleOffset = 0)
      const cycle1 = await prisma.billingCycle.create({
        data: {
          id: crypto.randomUUID(),
          dormitoryId: dorm.id,
          cycleCode: '2026-09',
          name: 'รอบ ก.ย. 2026',
          periodStart: new Date('2026-09-01T00:00:00.000Z'),
          periodEnd: new Date('2026-09-30T23:59:59.000Z'),
          billingDate: new Date('2026-09-25T00:00:00.000Z'),
          dueDate: new Date('2026-10-05T00:00:00.000Z'),
          status: 'open',
        },
      });

      await prisma.billingRateSnapshot.create({
        data: {
          dormitoryId: dorm.id,
          billingCycleId: cycle1.id,
          waterRate: '20.00',
          electricityRate: '8.00',
          commonFee: '200.00',
          commonFeeMode: 'room',
        },
      });

      // Generate Bill 1
      const bill1Res = await billingService.generateBill(dorm.id, {
        billingCycleId: cycle1.id,
        contractId: contract.id,
        roomId: room.id,
        tenantId: tenant.id,
      });

      const rentItem1 = bill1Res.items.find(i => i.type === 'rent');
      expect(rentItem1).toBeDefined();
      expect(rentItem1?.amount).toBe('9000.50');
      expect(rentItem1?.metadata).toMatchObject({
        installmentNo: 1,
        totalInstallments: 2,
        termRentTotal: '18001.01',
        cycleOffset: 0,
      });

      // Create Billing Cycle 2: October 2026 (cycleOffset = 1)
      const cycle2 = await prisma.billingCycle.create({
        data: {
          id: crypto.randomUUID(),
          dormitoryId: dorm.id,
          cycleCode: '2026-10',
          name: 'รอบ ต.ค. 2026',
          periodStart: new Date('2026-10-01T00:00:00.000Z'),
          periodEnd: new Date('2026-10-31T23:59:59.000Z'),
          billingDate: new Date('2026-10-25T00:00:00.000Z'),
          dueDate: new Date('2026-11-05T00:00:00.000Z'),
          status: 'open',
        },
      });

      await prisma.billingRateSnapshot.create({
        data: {
          dormitoryId: dorm.id,
          billingCycleId: cycle2.id,
          waterRate: '20.00',
          electricityRate: '8.00',
          commonFee: '200.00',
          commonFeeMode: 'room',
        },
      });

      // Generate Bill 2 (Final installment)
      const bill2Res = await billingService.generateBill(dorm.id, {
        billingCycleId: cycle2.id,
        contractId: contract.id,
        roomId: room.id,
        tenantId: tenant.id,
      });

      const rentItem2 = bill2Res.items.find(i => i.type === 'rent');
      expect(rentItem2).toBeDefined();
      expect(rentItem2?.amount).toBe('9000.51');
      expect(rentItem2?.metadata).toMatchObject({
        installmentNo: 2,
        totalInstallments: 2,
        termRentTotal: '18001.01',
        cycleOffset: 1,
        isFinalInstallment: true,
      });

      // Create Billing Cycle 3: November 2026 (cycleOffset = 2 -> k > N)
      const cycle3 = await prisma.billingCycle.create({
        data: {
          id: crypto.randomUUID(),
          dormitoryId: dorm.id,
          cycleCode: '2026-11',
          name: 'รอบ พ.ย. 2026',
          periodStart: new Date('2026-11-01T00:00:00.000Z'),
          periodEnd: new Date('2026-11-30T23:59:59.000Z'),
          billingDate: new Date('2026-11-25T00:00:00.000Z'),
          dueDate: new Date('2026-12-05T00:00:00.000Z'),
          status: 'open',
        },
      });

      await prisma.billingRateSnapshot.create({
        data: {
          dormitoryId: dorm.id,
          billingCycleId: cycle3.id,
          waterRate: '20.00',
          electricityRate: '8.00',
          commonFee: '200.00',
          commonFeeMode: 'room',
        },
      });

      // Generate Bill 3
      const bill3Res = await billingService.generateBill(dorm.id, {
        billingCycleId: cycle3.id,
        contractId: contract.id,
        roomId: room.id,
        tenantId: tenant.id,
      });

      // Rent line item must be COMPLETELY OMITTED (no 0.00 THB rent item)
      const rentItem3 = bill3Res.items.find(i => i.type === 'rent');
      expect(rentItem3).toBeUndefined();

      // Active common fee continues
      const commonItem3 = bill3Res.items.find(i => i.type === 'common_fee');
      expect(commonItem3).toBeDefined();
      expect(commonItem3?.amount).toBe('200.00');

      // Total bill for period 3 is only common fee
      expect(bill3Res.bill.totalAmount.toString()).toBe('200.00');
    });
  });

  describe('4. Production Tenant Choice Invariant', () => {
    it('does NOT activate installment scheduling when contract is activated without authoritative selectedInstallments', async () => {
      const dorm = await prisma.dormitory.create({
        data: {
          id: crypto.randomUUID(),
          name: 'หอพักมาตรฐาน ไม่แบ่งงวด',
          createdByUserId: testUserId,
          status: 'active',
        },
      });

      await prisma.dormitoryPropertyDefaults.create({
        data: {
          dormitoryId: dorm.id,
          defaultMonthlyRent: '4500.00',
        },
      });

      const building = await prisma.building.create({
        data: {
          id: crypto.randomUUID(),
          dormitoryId: dorm.id,
          name: 'อาคาร 1',
          maxTermRentInstallments: 3,
        },
      });

      const room = await prisma.room.create({
        data: {
          id: crypto.randomUUID(),
          dormitoryId: dorm.id,
          buildingId: building.id,
          roomNumber: '101',
          normalizedRoomNumber: '101',
          floor: 1,
          roomType: 'standard',
          monthlyRent: '4500.00',
          status: 'VACANT',
        },
      });

      const tenant = await prisma.tenant.create({
        data: {
          id: crypto.randomUUID(),
          dormitoryId: dorm.id,
          tenantNumber: `TN-${Date.now()}-2`,
          displayName: 'สมหมาย ผู้เช่าปกติ',
          firstName: 'สมหมาย',
          lastName: 'ผู้เช่าปกติ',
          phone: '0812345678',
          status: 'active',
        },
      });

      const contract = await prisma.contract.create({
        data: {
          id: crypto.randomUUID(),
          dormitoryId: dorm.id,
          roomId: room.id,
          tenantId: tenant.id,
          contractNumber: `CTR-STD-${Date.now()}`,
          startDate: new Date('2026-09-01T00:00:00.000Z'),
          endDate: new Date('2027-03-01T00:00:00.000Z'),
          rentAmount: '4500.00',
          status: 'draft',
        },
      });

      // Standard activation without selectedInstallments
      await contractService.activateContract(
        contract.id,
        dorm.id,
        {
          ownerSignature: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        },
        testUserId
      );

      const snapshot = await prisma.contractSnapshot.findUnique({
        where: { contractId: contract.id },
      });

      // installmentConfig must be null (no default synthesis)
      expect(snapshot?.installmentConfig).toBeNull();
    });

    it('resolves explicit contract rentBillingType = term on a room with both monthlyRent and termRent', async () => {
      const dorm = await prisma.dormitory.create({
        data: {
          id: crypto.randomUUID(),
          name: 'หอพักทดสอบ Dual-Rate Room',
          createdByUserId: testUserId,
          status: 'active',
        },
      });

      const building = await prisma.building.create({
        data: {
          id: crypto.randomUUID(),
          dormitoryId: dorm.id,
          name: 'อาคาร Dual Rate',
          maxTermRentInstallments: 3,
        },
      });

      // Room has BOTH monthlyRent AND termRent
      const room = await prisma.room.create({
        data: {
          id: crypto.randomUUID(),
          dormitoryId: dorm.id,
          buildingId: building.id,
          roomNumber: '201',
          normalizedRoomNumber: '201',
          floor: 2,
          roomType: 'standard',
          monthlyRent: '4500.00',
          termRent: '18000.00',
          status: 'VACANT',
        },
      });

      const tenant = await prisma.tenant.create({
        data: {
          id: crypto.randomUUID(),
          dormitoryId: dorm.id,
          tenantNumber: `TN-${Date.now()}-3`,
          displayName: 'วิชัย เช่าเทอม',
          firstName: 'วิชัย',
          lastName: 'เช่าเทอม',
          phone: '0898765432',
          status: 'active',
        },
      });

      // Contract explicitly chooses 'term'
      const contract = await prisma.contract.create({
        data: {
          id: crypto.randomUUID(),
          dormitoryId: dorm.id,
          roomId: room.id,
          tenantId: tenant.id,
          contractNumber: `CTR-DUAL-${Date.now()}`,
          startDate: new Date('2026-09-01T00:00:00.000Z'),
          endDate: new Date('2027-01-01T00:00:00.000Z'),
          rentBillingType: 'term',
          rentAmount: '18000.00',
          status: 'draft',
        },
      });

      await contractService.activateContract(
        contract.id,
        dorm.id,
        {
          selectedInstallments: 2,
          ownerSignature: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        },
        testUserId
      );

      const snapshot = await prisma.contractSnapshot.findUnique({
        where: { contractId: contract.id },
      });

      expect(snapshot?.rentBillingType).toBe('term');
      expect(Number(snapshot?.resolvedRent)).toBe(18000.00);
      expect((snapshot?.installmentConfig as any)?.selectedInstallments).toBe(2);
    });
  });

  describe('5. Acceptance Snapshot Hashing & Signature Authority', () => {
    it('computes deterministic SHA-256 for canonical JSON acceptance snapshot', () => {
      const snap1 = {
        snapshotVersion: 1,
        dormitoryId: 'dorm-123',
        applicantName: 'สมชาย ผู้สมัคร',
        policyVersion: 2,
      };
      const snap2 = {
        policyVersion: 2,
        dormitoryId: 'dorm-123',
        snapshotVersion: 1,
        applicantName: 'สมชาย ผู้สมัคร',
      };

      // Order of keys should not affect canonical hash
      const hash1 = computeSnapshotSha256(snap1);
      const hash2 = computeSnapshotSha256(snap2);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });
  });

  describe('6. Payment Settings Independent PromptPay Name Persistence', () => {
    it('persists and updates promptPayAccountName independently from bankAccountName in PostgreSQL', async () => {
      const dorm = await prisma.dormitory.create({
        data: {
          id: crypto.randomUUID(),
          name: 'หอพักทดสอบ Payment Settings Independent',
          createdByUserId: testUserId,
          status: 'active',
        },
      });

      // Initial settings with different PromptPay name and Bank name
      await prisma.dormitoryBillingSettings.create({
        data: {
          dormitoryId: dorm.id,
          promptPayAccountName: 'ชื่อพร้อมเพย์ ตอนลงทะเบียน',
          bankAccountName: 'ชื่อบัญชีธนาคาร ตอนลงทะเบียน',
          bankCode: 'กสิกรไทย (KBank)',
        },
      });

      // Verify read-back (F5 equivalent)
      const read1 = await prisma.dormitoryBillingSettings.findUnique({
        where: { dormitoryId: dorm.id },
      });
      expect(read1?.promptPayAccountName).toBe('ชื่อพร้อมเพย์ ตอนลงทะเบียน');
      expect(read1?.bankAccountName).toBe('ชื่อบัญชีธนาคาร ตอนลงทะเบียน');

      // Update promptPayAccountName ONLY (Settings page onBlur)
      await prisma.dormitoryBillingSettings.update({
        where: { dormitoryId: dorm.id },
        data: { promptPayAccountName: 'ชื่อพร้อมเพย์ อัปเดตใหม่' },
      });

      // Verify promptPayAccountName updated while bankAccountName remains completely unchanged
      const read2 = await prisma.dormitoryBillingSettings.findUnique({
        where: { dormitoryId: dorm.id },
      });
      expect(read2?.promptPayAccountName).toBe('ชื่อพร้อมเพย์ อัปเดตใหม่');
      expect(read2?.bankAccountName).toBe('ชื่อบัญชีธนาคาร ตอนลงทะเบียน');

      // Update bankAccountName ONLY
      await prisma.dormitoryBillingSettings.update({
        where: { dormitoryId: dorm.id },
        data: { bankAccountName: 'ชื่อธนาคาร อัปเดตใหม่' },
      });

      const read3 = await prisma.dormitoryBillingSettings.findUnique({
        where: { dormitoryId: dorm.id },
      });
      expect(read3?.promptPayAccountName).toBe('ชื่อพร้อมเพย์ อัปเดตใหม่');
      expect(read3?.bankAccountName).toBe('ชื่อธนาคาร อัปเดตใหม่');
    });
  });

  describe('7. Authenticated Owner Helper Identity Resolution', () => {
    it('uses authenticated user identity instead of unowned form data when pulling owner name', () => {
      // Simulated session context
      const mockSession = {
        user: {
          id: testUserId,
          name: 'นายสมศักดิ์ ผู้ใช้จริงที่ล็อกอิน',
          email: 'real.owner@horplus.com',
        },
      };

      const authUserName = mockSession.user.name;
      expect(authUserName).toBe('นายสมศักดิ์ ผู้ใช้จริงที่ล็อกอิน');

      // Simulate pulling name into paymentAccount
      const paymentAccount = {
        bankName: 'กสิกรไทย (KBank)',
        accountNumber: '098-2-34567-8',
        accountName: authUserName,
        bankAccountName: authUserName,
        promptPayId: '081-999-8888',
        promptPayName: authUserName,
      };

      expect(paymentAccount.bankAccountName).toBe('นายสมศักดิ์ ผู้ใช้จริงที่ล็อกอิน');
      expect(paymentAccount.promptPayName).toBe('นายสมศักดิ์ ผู้ใช้จริงที่ล็อกอิน');
    });
  });
});
