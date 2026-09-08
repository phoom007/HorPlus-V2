import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPrismaClient } from '../db/prisma.js';
import {
  isVehicleApplicableAsOfDate,
  resolveCycleAwareVehicleCount,
} from '../utils/vehicle-billing.util.js';
import { ContractRenewalService } from '../services/contract-renewal.service.js';
import { MeterService } from '../services/meter.service.js';
import { BillingService } from '../services/billing.service.js';
import { TenantService } from '../services/tenant.service.js';
import { SensitiveFieldService } from '../services/sensitive-field.service.js';
import { toTenantDetailsApiDTO } from '../mappers/tenant-api.mapper.js';
import { PrismaContractRepository } from '../db/repositories/contract.repository.js';
import { PrismaMeterRepository } from '../db/repositories/meter.repository.js';
import { PrismaBillingCycleRepository } from '../db/repositories/billing-cycle.repository.js';
import { PrismaRoomRepository } from '../db/repositories/room.repository.js';
import { PrismaTenantRepository } from '../db/repositories/tenant.repository.js';

describe('Tenant Phase 3 Step 3C.5B.6F: Renewal Authority, Meter & Cycle-Aware Parking Billing', () => {
  const prisma = getPrismaClient();
  const renewalService = new ContractRenewalService();
  const contractRepo = new PrismaContractRepository(prisma);
  const meterRepo = new PrismaMeterRepository(prisma);
  const cycleRepo = new PrismaBillingCycleRepository(prisma);
  const roomRepo = new PrismaRoomRepository(prisma);
  const tenantRepo = new PrismaTenantRepository(prisma);
  const meterService = new MeterService(meterRepo, cycleRepo, roomRepo);
  const billingService = new BillingService(undefined, cycleRepo, meterRepo, contractRepo, roomRepo, tenantRepo);
  const sensitiveFieldService = new SensitiveFieldService('test-secret-key-32-chars-long!!');
  const tenantService = new TenantService(tenantRepo, contractRepo, sensitiveFieldService, undefined, prisma);
  tenantService.setBillingService(billingService);

  const testSuffix = Date.now().toString().slice(-6);
  let dormId: string;
  let roomId: string;
  let tenantId: string;
  let cycleId: string;
  let dynamicBillId: string;

  const createdContractIds: string[] = [];
  const createdVehicleIds: string[] = [];
  const createdCycleIds: string[] = [];
  const createdBillIds: string[] = [];

  beforeAll(async () => {
    // 1. Fetch or create a test dormitory context
    const existingDorm = await prisma.dormitory.findFirst({
      include: { rooms: true },
    });
    if (existingDorm && existingDorm.rooms.length > 0) {
      dormId = existingDorm.id;
      roomId = existingDorm.rooms[0].id;
      await prisma.occupancy.deleteMany({ where: { roomId } });
    } else {
      const dorm = await prisma.dormitory.create({
        data: {
          name: `Test Dorm 3C6F ${testSuffix}`,
          address: '123 Test Rd',
        },
      });
      dormId = dorm.id;
      const room = await prisma.room.create({
        data: {
          dormitoryId: dormId,
          roomNumber: `R-${testSuffix}`,
          status: 'vacant',
          monthlyRent: 4000,
          monthlyDeposit: 4000,
        },
      });
      roomId = room.id;
    }

    // 2. Create isolated test tenant
    const tnt = await prisma.tenant.create({
      data: {
        dormitoryId: dormId,
        tenantNumber: `TNT-6F-${testSuffix}`,
        firstName: 'ทดสอบ',
        lastName: 'ต่อสัญญา',
        displayName: 'นายทดสอบ ต่อสัญญา',
        phone: `089${testSuffix}`,
        status: 'active',
      },
    });
    tenantId = tnt.id;

    // 3. Create a test billing cycle
    const cycle = await prisma.billingCycle.create({
      data: {
        dormitoryId: dormId,
        cycleCode: `2026-10-${testSuffix}`,
        name: `รอบบิล ตุลาคม 2569-${testSuffix}`,
        periodStart: new Date('2026-10-01T00:00:00.000Z'),
        periodEnd: new Date('2026-10-31T23:59:59.999Z'),
        billingDate: new Date('2026-10-25T00:00:00.000Z'),
        dueDate: new Date('2026-11-05T00:00:00.000Z'),
        status: 'reading',
      },
    });
    cycleId = cycle.id;
    createdCycleIds.push(cycleId);
  });

  afterAll(async () => {
    // Clean up created entities safely
    if (createdContractIds.length > 0) {
      await prisma.tenantRenewalRequest.deleteMany({
        where: {
          OR: [
            { createdContractId: { in: createdContractIds } },
            { contractId: { in: createdContractIds } },
          ],
        },
      });
      await prisma.contractSnapshot.deleteMany({
        where: { contractId: { in: createdContractIds } },
      });
      await prisma.contract.deleteMany({
        where: { id: { in: createdContractIds } },
      });
    }
    if (createdVehicleIds.length > 0) {
      await prisma.tenantVehicle.deleteMany({
        where: { id: { in: createdVehicleIds } },
      });
    }
    if (createdBillIds.length > 0) {
      await prisma.payment.deleteMany({ where: { billId: { in: createdBillIds } } });
      await prisma.billItem.deleteMany({ where: { billId: { in: createdBillIds } } });
      await prisma.bill.deleteMany({ where: { id: { in: createdBillIds } } });
    }
    if (createdCycleIds.length > 0) {
      await prisma.billingRateSnapshot.deleteMany({
        where: { billingCycleId: { in: createdCycleIds } },
      });
      await prisma.billingCycle.deleteMany({
        where: { id: { in: createdCycleIds } },
      });
    }
    if (tenantId) {
      await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
    }
  });

  describe('Section 1: Vehicle Temporal Billing Utility Rules', () => {
    it('accurately distinguishes vehicles created on/before vs after explicit asOf business date', () => {
      const asOfOct31 = '2026-10-31';

      // Vehicle created Oct 15 -> applicable
      expect(
        isVehicleApplicableAsOfDate({
          vehicle: {
            type: 'car',
            createdAt: '2026-10-15T10:00:00.000Z',
            deletedAt: null,
          },
          asOfBusinessDate: asOfOct31,
        })
      ).toBe(true);

      // Vehicle created Nov 1 -> NOT applicable for October cycle
      expect(
        isVehicleApplicableAsOfDate({
          vehicle: {
            type: 'car',
            createdAt: '2026-11-01T08:00:00.000Z',
            deletedAt: null,
          },
          asOfBusinessDate: asOfOct31,
        })
      ).toBe(false);
    });

    it('correctly bills vehicles deleted AFTER the cycle end, but excludes vehicles deleted on or before', () => {
      const asOfOct31 = '2026-10-31';

      // Active during October, soft-deleted on Nov 5 -> SHOULD be billed for October
      expect(
        isVehicleApplicableAsOfDate({
          vehicle: {
            type: 'motorcycle',
            createdAt: '2026-08-01T00:00:00.000Z',
            deletedAt: '2026-11-05T12:00:00.000Z',
          },
          asOfBusinessDate: asOfOct31,
        })
      ).toBe(true);

      // Soft-deleted on Oct 20 (on or before Oct 31) -> NOT billed
      expect(
        isVehicleApplicableAsOfDate({
          vehicle: {
            type: 'motorcycle',
            createdAt: '2026-08-01T00:00:00.000Z',
            deletedAt: '2026-10-20T12:00:00.000Z',
          },
          asOfBusinessDate: asOfOct31,
        })
      ).toBe(false);
    });

    it('ignores empty, none, or invalid vehicle types', () => {
      const asOfOct31 = '2026-10-31';
      expect(
        isVehicleApplicableAsOfDate({
          vehicle: { type: 'none', createdAt: '2026-08-01T00:00:00.000Z', deletedAt: null },
          asOfBusinessDate: asOfOct31,
        })
      ).toBe(false);

      expect(
        isVehicleApplicableAsOfDate({
          vehicle: { type: 'ไม่มี', createdAt: '2026-08-01T00:00:00.000Z', deletedAt: null },
          asOfBusinessDate: asOfOct31,
        })
      ).toBe(false);
    });

    it('resolveCycleAwareVehicleCount accurately counts multiple vehicles with mixed temporal states', () => {
      const vehicles = [
        { type: 'car', createdAt: '2026-07-01T00:00:00.000Z', deletedAt: null }, // Valid (1)
        { type: 'motorcycle', createdAt: '2026-09-01T00:00:00.000Z', deletedAt: '2026-11-02T00:00:00.000Z' }, // Valid for Oct (2)
        { type: 'motorcycle', createdAt: '2026-09-01T00:00:00.000Z', deletedAt: '2026-10-10T00:00:00.000Z' }, // Deleted in Oct -> Excluded
        { type: 'car', createdAt: '2026-11-01T00:00:00.000Z', deletedAt: null }, // Created after Oct -> Excluded
        { type: 'none', createdAt: '2026-07-01T00:00:00.000Z', deletedAt: null }, // Type none -> Excluded
      ];

      const count = resolveCycleAwareVehicleCount({
        vehicles,
        asOfBusinessDate: '2026-10-31',
      });
      expect(count).toBe(2);
    });
  });

  describe('Section 2: Contract Renewal Chain & Obsolete Predecessor Protection', () => {
    let contractAId: string;
    let contractBId: string;

    beforeAll(async () => {
      // Contract A (Predecessor)
      const cA = await prisma.contract.create({
        data: {
          dormitoryId: dormId,
          roomId: roomId,
          tenantId: tenantId,
          contractNumber: `CTR-A-${testSuffix}`,
          startDate: new Date('2026-07-01T00:00:00.000Z'),
          endDate: new Date('2026-10-31T00:00:00.000Z'),
          durationMonths: 4,
          rentBillingType: 'term',
          rentAmount: 16000,
          depositAmount: 4000,
          status: 'active',
          terms: 'Terms A: ข้อกำหนดสัญญาเดิมฉบับแรก',
        },
      });
      contractAId = cA.id;
      createdContractIds.push(contractAId);

      // Contract B (Renewal Successor linked to A)
      const cB = await prisma.contract.create({
        data: {
          dormitoryId: dormId,
          roomId: roomId,
          tenantId: tenantId,
          previousContractId: contractAId,
          contractNumber: `CTR-B-${testSuffix}`,
          startDate: new Date('2026-11-01T00:00:00.000Z'),
          endDate: new Date('2027-02-28T00:00:00.000Z'),
          durationMonths: 4,
          rentBillingType: 'term',
          rentAmount: 18000,
          depositAmount: 4000,
          status: 'approved_scheduled',
          terms: 'Terms B: ข้อกำหนดสัญญาฉบับที่สอง (ต่ออายุ)',
        },
      });
      contractBId = cB.id;
      createdContractIds.push(contractBId);
    });

    it('getRenewalEligibility fails closed with OBSOLETE_PREDECESSOR_RENEWAL_DENIED when checking predecessor Contract A', async () => {
      const eligibility = await renewalService.getRenewalEligibility(dormId, tenantId, contractAId);
      expect(eligibility.eligible).toBe(false);
      expect(eligibility.reasonCode).toBe('OBSOLETE_PREDECESSOR_RENEWAL_DENIED');
      expect(eligibility.successorContract?.id).toBe(contractBId);
    });

    it('submitRenewalRequest rejects submission on Contract A with OBSOLETE_PREDECESSOR_RENEWAL_DENIED', async () => {
      await expect(
        renewalService.submitRenewalRequest({
          dormitoryId: dormId,
          tenantId,
          contractId: contractAId,
          requestedStartDate: '2026-11-01',
          requestedDurationMonths: 4,
        })
      ).rejects.toThrow('สัญญาเช่านี้ถูกต่ออายุไปแล้ว ไม่สามารถต่ออายุซ้ำจากสัญญาเดิมได้');
    });

    it('Contract B (the newest agreement in chain) is eligible for next renewal', async () => {
      const eligibility = await renewalService.getRenewalEligibility(dormId, tenantId, contractBId);
      expect(eligibility.eligible).toBe(true);
      expect(eligibility.reasonCode).toBe('ELIGIBLE');
    });

    it('Server-authoritative terms: approveRenewalRequest reads DormitoryPropertyDefaults.defaultTerms and ignores client terms', async () => {
      // Set dormitory property defaults to Terms C
      const termsC = 'Terms C: ข้อกำหนดใหม่ล่าสุดจาก DormitoryPropertyDefaults ณ เวลาอนุมัติ';
      await prisma.dormitoryPropertyDefaults.upsert({
        where: { dormitoryId: dormId },
        update: { defaultTerms: termsC },
        create: {
          dormitoryId: dormId,
          defaultTerms: termsC,
        },
      });

      // Submit renewal from Contract B
      const submitRes = await renewalService.submitRenewalRequest({
        dormitoryId: dormId,
        tenantId,
        contractId: contractBId,
        requestedStartDate: '2027-03-01',
        requestedDurationMonths: 4,
      });

      // Owner approves with crafted client terms that try to override settings
      const approveRes = await renewalService.approveRenewalRequest({
        dormitoryId: dormId,
        requestId: submitRes.id,
        actorUserId: '00000000-0000-0000-0000-000000000001',
        actorRole: 'OWNER',
        terms: 'CLIENT_ATTEMPTED_OVERRIDE_TERMS', // Must be ignored!
      });

      const newContractId = approveRes.contract.id;
      createdContractIds.push(newContractId);

      const savedContract = await prisma.contract.findUnique({
        where: { id: newContractId },
      });

      // Assert server authority: terms equals Terms C, NOT client input
      expect(savedContract?.terms).toBe(termsC);
      expect(savedContract?.terms).not.toContain('CLIENT_ATTEMPTED_OVERRIDE_TERMS');

      // Assert historical predecessor terms remain IMMUTABLE
      const historicalA = await prisma.contract.findUnique({ where: { id: contractAId } });
      const historicalB = await prisma.contract.findUnique({ where: { id: contractBId } });
      expect(historicalA?.terms).toBe('Terms A: ข้อกำหนดสัญญาเดิมฉบับแรก');
      expect(historicalB?.terms).toBe('Terms B: ข้อกำหนดสัญญาฉบับที่สอง (ต่ออายุ)');
    });
  });

  describe('Section 3: Physical-Active Semantics vs Billing-Cycle-Eligible Contracts', () => {
    it('findActiveContractsForRoom strictly preserves physical-active semantics (only status active)', async () => {
      const activeContracts = await contractRepo.findActiveContractsForRoom(dormId, roomId);
      for (const c of activeContracts) {
        expect(c.status).toBe('active');
        expect(c.status).not.toBe('approved_scheduled');
      }
    });

    it('findCycleEligibleContractsForRoom includes approved_scheduled contracts for cycle eligibility', async () => {
      const eligibleContracts = await contractRepo.findCycleEligibleContractsForRoom(dormId, roomId);
      const scheduledContract = eligibleContracts.find((c) => c.status === 'approved_scheduled');
      expect(scheduledContract).toBeDefined();
    });

    it('resolveActiveAgreementBillingSource resolves approved_scheduled contract overlapping the target cycle', async () => {
      const result = await billingService.resolveActiveAgreementBillingSource(dormId, roomId, {
        periodStart: '2026-11-01',
        periodEnd: '2026-11-30',
      });
      expect(result.contract).toBeDefined();
      expect(result.contract.status).toBe('approved_scheduled');
      expect(result.contract.contractNumber).toContain('CTR-B');
    });
  });

  describe('Section 4: Exact Terms A -> B -> C Forensic Test', () => {
    it('proves Contract A (TERMS_A) -> approve renewal (TERMS_B) -> Contract B (TERMS_B) with A still TERMS_A -> Settings updated to TERMS_C -> A, B, C distinct and client fake terms ignored', async () => {
      // 1. Create unique Contract A with TERMS_A
      const termsA = `TERMS_A_${Date.now()}`;
      const contractA = await prisma.contract.create({
        data: {
          dormitoryId: dormId,
          roomId,
          tenantId,
          contractNumber: `CTR-4A-${Date.now().toString().slice(-6)}`,
          startDate: new Date('2026-01-01T00:00:00.000Z'),
          endDate: new Date('2026-06-30T00:00:00.000Z'),
          durationMonths: 6,
          rentBillingType: 'monthly',
          rentAmount: 5000,
          depositAmount: 5000,
          status: 'active',
          terms: termsA,
        },
      });
      createdContractIds.push(contractA.id);

      // 2. Set Settings (DormitoryPropertyDefaults) to TERMS_B
      const termsB = `TERMS_B_${Date.now()}`;
      await prisma.dormitoryPropertyDefaults.upsert({
        where: { dormitoryId: dormId },
        update: { defaultTerms: termsB },
        create: { dormitoryId: dormId, defaultTerms: termsB },
      });

      // 3. Submit renewal from Contract A
      const req = await renewalService.submitRenewalRequest({
        dormitoryId: dormId,
        tenantId,
        contractId: contractA.id,
        requestedStartDate: '2026-07-01',
        requestedDurationMonths: 6,
      });

      // 4. Owner approves renewal with crafted client payload trying to override terms
      const approveRes = await renewalService.approveRenewalRequest({
        dormitoryId: dormId,
        requestId: req.id,
        actorUserId: '00000000-0000-0000-0000-000000000001',
        actorRole: 'OWNER',
        terms: 'CLIENT_FAKE_TERMS', // Must be ignored by server!
      });
      const contractB = approveRes.contract;
      createdContractIds.push(contractB.id);

      // Verify Contract B received TERMS_B from server Settings, NOT CLIENT_FAKE_TERMS
      expect(contractB.terms).toBe(termsB);
      expect(contractB.terms).not.toContain('CLIENT_FAKE_TERMS');

      // Verify Contract A still has TERMS_A
      const readA = await prisma.contract.findUnique({ where: { id: contractA.id } });
      expect(readA?.terms).toBe(termsA);

      // 5. Update Settings to TERMS_C
      const termsC = `TERMS_C_${Date.now()}`;
      await prisma.dormitoryPropertyDefaults.update({
        where: { dormitoryId: dormId },
        data: { defaultTerms: termsC },
      });

      // 6. Re-read all three: A has TERMS_A, B has TERMS_B, Settings has TERMS_C
      const reReadA = await prisma.contract.findUnique({ where: { id: contractA.id } });
      const reReadB = await prisma.contract.findUnique({ where: { id: contractB.id } });
      const reReadDefaults = await prisma.dormitoryPropertyDefaults.findUnique({ where: { dormitoryId: dormId } });

      expect(reReadA?.terms).toBe(termsA);
      expect(reReadB?.terms).toBe(termsB);
      expect(reReadDefaults?.defaultTerms).toBe(termsC);
    });
  });

  describe('Section 5: Meter Contract Boundary Live Proof', () => {
    it('selects old contract for Dec 2026 and renewed scheduled contract for Jan 2027, preserving physical-active isolation', async () => {
      const bndSuffix = Date.now().toString().slice(-5);
      const existingRoom = await prisma.room.findUnique({ where: { id: roomId } });
      // Isolated test room for boundary proof
      const roomBnd = await prisma.room.create({
        data: {
          dormitoryId: dormId,
          buildingId: existingRoom!.buildingId,
          roomNumber: `RB-${bndSuffix}`,
          normalizedRoomNumber: `RB-${bndSuffix}`,
          status: 'vacant',
          monthlyRent: 4500,
          monthlyDeposit: 4500,
          termDeposit: 4500,
          dailyDeposit: 0,
        },
      });

      // Old contract ends 2026-12-31
      const oldContract = await prisma.contract.create({
        data: {
          dormitoryId: dormId,
          roomId: roomBnd.id,
          tenantId,
          contractNumber: `CTR-DEC-${bndSuffix}`,
          startDate: new Date('2026-07-01T00:00:00.000Z'),
          endDate: new Date('2026-12-31T23:59:59.999Z'),
          durationMonths: 6,
          rentBillingType: 'monthly',
          rentAmount: 4500,
          depositAmount: 4500,
          status: 'active',
          terms: 'December active terms',
        },
      });
      createdContractIds.push(oldContract.id);

      // Renewed contract starts 2027-01-01 (approved_scheduled)
      const renewedContract = await prisma.contract.create({
        data: {
          dormitoryId: dormId,
          roomId: roomBnd.id,
          tenantId,
          previousContractId: oldContract.id,
          contractNumber: `CTR-JAN-${bndSuffix}`,
          startDate: new Date('2027-01-01T00:00:00.000Z'),
          endDate: new Date('2027-06-30T23:59:59.999Z'),
          durationMonths: 6,
          rentBillingType: 'monthly',
          rentAmount: 4500,
          depositAmount: 4500,
          status: 'approved_scheduled',
          terms: 'January scheduled terms',
        },
      });
      createdContractIds.push(renewedContract.id);

      // Dec 2026 cycle selects old contract
      const decSource = await billingService.resolveActiveAgreementBillingSource(dormId, roomBnd.id, {
        periodStart: '2026-12-01',
        periodEnd: '2026-12-31',
      });
      expect(decSource.contract?.id).toBe(oldContract.id);
      expect(decSource.contract?.status).toBe('active');

      // Jan 2027 cycle selects renewed scheduled contract
      const janSource = await billingService.resolveActiveAgreementBillingSource(dormId, roomBnd.id, {
        periodStart: '2027-01-01',
        periodEnd: '2027-01-31',
      });
      expect(janSource.contract?.id).toBe(renewedContract.id);
      expect(janSource.contract?.status).toBe('approved_scheduled');

      // findActiveContractsForRoom strictly preserves physical-active semantics
      // Before Jan 1, renewedContract (approved_scheduled) is NOT returned by findActiveContractsForRoom
      const physicalActive = await contractRepo.findActiveContractsForRoom(dormId, roomBnd.id);
      expect(physicalActive.some(c => c.id === renewedContract.id)).toBe(false);
    });
  });

  describe('Section 6: Parking Full Authority Proof', () => {
    it('proves per_vehicle temporal lifecycle, soft-deletion handling, tenant isolation and settings immunity', async () => {
      const otherTenant = await prisma.tenant.create({
        data: {
          dormitoryId: dormId,
          tenantNumber: `TNT-OTHER-${Date.now().toString().slice(-5)}`,
          firstName: 'ผู้เช่าอื่น',
          lastName: 'คนละห้อง',
          displayName: 'ผู้เช่าอื่น คนละห้อง',
          phone: `081${Date.now().toString().slice(-6)}`,
          status: 'active',
        },
      });

      // Vehicle A (Tenant, created 2026-06-15)
      const vA = await prisma.tenantVehicle.create({
        data: {
          dormitoryId: dormId,
          tenantId,
          type: 'car',
          licensePlate: '1กข1111',
          createdAt: new Date('2026-06-15T00:00:00.000Z'),
        },
      });
      createdVehicleIds.push(vA.id);

      // Vehicle B (Tenant, created 2026-07-10, soft-deleted 2026-08-10)
      const vB = await prisma.tenantVehicle.create({
        data: {
          dormitoryId: dormId,
          tenantId,
          type: 'motorcycle',
          licensePlate: '2กข2222',
          createdAt: new Date('2026-07-10T00:00:00.000Z'),
          deletedAt: new Date('2026-08-10T12:00:00.000Z'),
        },
      });
      createdVehicleIds.push(vB.id);

      // Vehicle C (Tenant, type none -> should be excluded)
      const vC = await prisma.tenantVehicle.create({
        data: {
          dormitoryId: dormId,
          tenantId,
          type: 'none',
          licensePlate: '-',
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
        },
      });
      createdVehicleIds.push(vC.id);

      // Vehicle D (Tenant, created 2026-08-05 -> after July 31 asOf date)
      const vD = await prisma.tenantVehicle.create({
        data: {
          dormitoryId: dormId,
          tenantId,
          type: 'car',
          licensePlate: '4กข4444',
          createdAt: new Date('2026-08-05T00:00:00.000Z'),
        },
      });
      createdVehicleIds.push(vD.id);

      // Vehicle Other (Other tenant -> must be excluded)
      const vOther = await prisma.tenantVehicle.create({
        data: {
          dormitoryId: dormId,
          tenantId: otherTenant.id,
          type: 'car',
          licensePlate: '9กข9999',
          createdAt: new Date('2026-06-01T00:00:00.000Z'),
        },
      });
      createdVehicleIds.push(vOther.id);

      // Fetch all vehicles for tenantId
      const tenantVehicles = await prisma.tenantVehicle.findMany({
        where: { dormitoryId: dormId, tenantId },
      });

      // 1. July Evaluation (asOf = 2026-07-31):
      // Vehicle A (active), Vehicle B (deleted on Aug 10, after July 31 -> included)
      // Vehicle C (type none -> excluded)
      // Vehicle D (created Aug 5 -> excluded)
      // vOther belongs to different tenant (excluded)
      const julyCount = resolveCycleAwareVehicleCount({
        vehicles: tenantVehicles,
        asOfBusinessDate: '2026-07-31',
      });
      expect(julyCount).toBe(2);

      // 2. August Evaluation (asOf = 2026-08-31):
      // Vehicle A (active -> included)
      // Vehicle B (deleted Aug 10, on or before Aug 31 -> excluded)
      // Vehicle C (type none -> excluded)
      // Vehicle D (created Aug 5, before Aug 31 -> included)
      const augCount = resolveCycleAwareVehicleCount({
        vehicles: tenantVehicles,
        asOfBusinessDate: '2026-08-31',
      });
      expect(augCount).toBe(2); // A + D = 2

      // If we query only A and B:
      const abVehicles = [vA, vB];
      const julyAbCount = resolveCycleAwareVehicleCount({
        vehicles: abVehicles,
        asOfBusinessDate: '2026-07-31',
      });
      const laterAbCount = resolveCycleAwareVehicleCount({
        vehicles: abVehicles,
        asOfBusinessDate: '2026-08-31',
      });
      expect(julyAbCount).toBe(2);
      expect(laterAbCount).toBe(1);

      // Cleanup other tenant
      await prisma.tenantVehicle.deleteMany({ where: { tenantId: otherTenant.id } });
      await prisma.tenant.delete({ where: { id: otherTenant.id } });
    });
  });

  describe('Section 7: Dynamic Unpaid Bill Parking Recalculation (TenantService Mutations)', () => {
    let v1Id: string;
    let v2Id: string;

    it('creates initial unpaid bill with 2 active vehicles (parking = 600)', async () => {
      // 0. Clean any leftover vehicles from previous test sections
      await prisma.tenantVehicle.deleteMany({ where: { tenantId } });

      // 1. Ensure BillingRateSnapshot exists for cycleId
      const existingSnap = await prisma.billingRateSnapshot.findFirst({
        where: { billingCycleId: cycleId },
      });
      if (!existingSnap) {
        await prisma.billingRateSnapshot.create({
          data: {
            dormitoryId: dormId,
            billingCycleId: cycleId,
            waterBillingType: 'fixed',
            waterRate: 100,
            electricityBillingType: 'fixed',
            electricityRate: 200,
            commonFee: 0,
            commonFeeMode: 'fixed',
            internetFee: 0,
            internetFeeMode: 'fixed',
            parkingFee: 300,
            parkingFeeMode: 'per_vehicle',
            lateFeeType: 'none',
            lateFeeValue: 0,
            source: 'TEMPLATE_DEFAULT',
          },
        });
      }

      // 2. Add 2 initial vehicles via tenantService
      const v1 = await tenantService.addVehicle(dormId, tenantId, {
        type: 'car',
        licensePlate: '1กก1111',
      });
      v1Id = v1.id;
      createdVehicleIds.push(v1.id);

      const v2 = await tenantService.addVehicle(dormId, tenantId, {
        type: 'motorcycle',
        licensePlate: '2กข2222',
      });
      v2Id = v2.id;
      createdVehicleIds.push(v2.id);

      // 3. Create open unpaid monthly utility bill
      const bill = await prisma.bill.create({
        data: {
          dormitoryId: dormId,
          roomId,
          tenantId,
          billingCycleId: cycleId,
          billNumber: `INV-DYN-${Date.now().toString().slice(-6)}`,
          billKind: 'MONTHLY_UTILITY',
          status: 'ISSUED',
          subtotal: 4600,
          totalAmount: 4600,
          paidAmount: 0,
          outstandingAmount: 4600,
          billingDate: new Date('2026-10-25T00:00:00.000Z'),
          dueDate: new Date('2026-11-05T00:00:00.000Z'),
        },
      });
      dynamicBillId = bill.id;
      createdBillIds.push(bill.id);

      await prisma.billItem.createMany({
        data: [
          {
            dormitoryId: dormId,
            billId: bill.id,
            type: 'rent',
            description: 'ค่าเช่าห้องพัก',
            quantity: 1,
            unitPrice: 4000,
            amount: 4000,
          },
          {
            dormitoryId: dormId,
            billId: bill.id,
            type: 'parking',
            code: 'PARKING',
            description: 'ค่าที่จอดรถ (2 คัน)',
            quantity: 2,
            unitPrice: 300,
            amount: 600,
          },
        ],
      });

      const initialBill = await prisma.bill.findUnique({
        where: { id: dynamicBillId },
        include: { items: true },
      });
      expect(Number(initialBill?.totalAmount)).toBe(4600);
      expect(Number(initialBill?.paidAmount)).toBe(0);
    });

    it('tenant removes 1 vehicle -> unpaid bill dynamically updates parking to 300 and total to 4300', async () => {
      await tenantService.deleteVehicle(dormId, tenantId, v1Id);

      const updatedBill = await prisma.bill.findUnique({
        where: { id: dynamicBillId },
        include: { items: true },
      });

      expect(Number(updatedBill?.totalAmount)).toBe(4300);
      expect(Number(updatedBill?.subtotal)).toBe(4300);
      expect(Number(updatedBill?.outstandingAmount)).toBe(4300);

      const parkingItems = updatedBill?.items.filter(i => i.type === 'parking' || i.code === 'PARKING');
      expect(parkingItems?.length).toBe(1);
      expect(Number(parkingItems![0].quantity)).toBe(1);
      expect(Number(parkingItems![0].unitPrice)).toBe(300);
      expect(Number(parkingItems![0].amount)).toBe(300);
    });

    it('tenant removes last vehicle -> unpaid bill dynamically removes parking item and total becomes 4000', async () => {
      await tenantService.deleteVehicle(dormId, tenantId, v2Id);

      const updatedBill = await prisma.bill.findUnique({
        where: { id: dynamicBillId },
        include: { items: true },
      });

      expect(Number(updatedBill?.totalAmount)).toBe(4000);
      expect(Number(updatedBill?.subtotal)).toBe(4000);
      expect(Number(updatedBill?.outstandingAmount)).toBe(4000);

      const parkingItems = updatedBill?.items.filter(i => i.type === 'parking' || i.code === 'PARKING');
      expect(parkingItems?.length).toBe(0);
    });

    it('tenant adds vehicle back -> unpaid bill parking dynamically restored to 300 and total 4300', async () => {
      const v3 = await tenantService.addVehicle(dormId, tenantId, {
        type: 'car',
        licensePlate: '3กค3333',
      });
      createdVehicleIds.push(v3.id);

      const updatedBill = await prisma.bill.findUnique({
        where: { id: dynamicBillId },
        include: { items: true },
      });

      expect(Number(updatedBill?.totalAmount)).toBe(4300);
      expect(Number(updatedBill?.subtotal)).toBe(4300);

      const parkingItems = updatedBill?.items.filter(i => i.type === 'parking' || i.code === 'PARKING');
      expect(parkingItems?.length).toBe(1);
      expect(Number(parkingItems![0].quantity)).toBe(1);
      expect(Number(parkingItems![0].amount)).toBe(300);
    });

    it('is strictly idempotent and never creates duplicate parking bill items on multiple updates', async () => {
      const currentVehicles = await prisma.tenantVehicle.findMany({
        where: { tenantId, deletedAt: null },
      });
      if (currentVehicles.length > 0) {
        await tenantService.updateVehicle(dormId, tenantId, currentVehicles[0].id, {
          licensePlate: '3กค3333-MODIFIED',
        });
      }

      const updatedBill = await prisma.bill.findUnique({
        where: { id: dynamicBillId },
        include: { items: true },
      });

      const parkingItems = updatedBill?.items.filter(i => i.type === 'parking' || i.code === 'PARKING');
      expect(parkingItems?.length).toBe(1);
    });
  });

  describe('Section 8: Rate Snapshot Authority vs Settings Immunity', () => {
    it('uses BillingRateSnapshot rate (300) even if current DormitoryBillingSettings changes to 500', async () => {
      // 1. Update settings to parkingRate: 500
      await prisma.dormitoryBillingSettings.upsert({
        where: { dormitoryId: dormId },
        create: {
          dormitoryId: dormId,
          dueDay: 5,
          parkingRate: 500,
          parkingFeeMode: 'per_vehicle',
        },
        update: {
          parkingRate: 500,
          parkingFeeMode: 'per_vehicle',
        },
      });

      // 2. Tenant adds a 2nd vehicle (total active = 2)
      const v4 = await tenantService.addVehicle(dormId, tenantId, {
        type: 'motorcycle',
        licensePlate: '4กด4444',
      });
      createdVehicleIds.push(v4.id);

      // 3. Unpaid bill parking amount must be 2 * 300 = 600 (from snapshot), NOT 2 * 500 = 1000
      const openBills = await prisma.bill.findMany({
        where: { tenantId, dormitoryId: dormId, billKind: 'MONTHLY_UTILITY', paidAmount: 0 },
        include: { items: true },
      });
      const targetBill = openBills.find(b => b.id === dynamicBillId) || openBills[0];
      expect(targetBill).toBeDefined();

      const parkingItem = targetBill.items.find(i => i.type === 'parking' || i.code === 'PARKING');
      expect(parkingItem).toBeDefined();
      expect(Number(parkingItem?.quantity)).toBe(2);
      expect(Number(parkingItem?.unitPrice)).toBe(300);
      expect(Number(parkingItem?.amount)).toBe(600);
      expect(Number(targetBill.totalAmount)).toBe(4600); // 4000 rent + 600 parking
    });
  });

  describe('Section 9: Strict Payment Freeze Boundary', () => {
    it('freezes bill when financial evidence exists (payment under review) even if paidAmount is 0', async () => {
      const bill = await prisma.bill.findUnique({
        where: { id: dynamicBillId },
      });
      expect(bill).toBeDefined();

      // Add a Payment record with status UNDER_REVIEW
      const payment = await prisma.payment.create({
        data: {
          dormitoryId: dormId,
          billId: bill!.id,
          tenantId,
          amount: 4600,
          method: 'PROMPTPAY',
          status: 'UNDER_REVIEW',
          paymentDate: new Date(),
        },
      });

      // Now tenant modifies vehicle
      const extraV = await tenantService.addVehicle(dormId, tenantId, {
        type: 'car',
        licensePlate: '5กฮ5555',
      });
      createdVehicleIds.push(extraV.id);

      // Bill must remain FROZEN (parking still 600 for 2, total still 4600)
      const frozenBill = await prisma.bill.findUnique({
        where: { id: bill!.id },
        include: { items: true },
      });

      const parkingItem = frozenBill?.items.find(i => i.type === 'parking' || i.code === 'PARKING');
      expect(Number(parkingItem?.quantity)).toBe(2);
      expect(Number(parkingItem?.amount)).toBe(600);
      expect(Number(frozenBill?.totalAmount)).toBe(4600);

      // Cleanup payment
      await prisma.payment.delete({ where: { id: payment.id } });
    });

    it('freezes bill when partially paid (paidAmount > 0)', async () => {
      await prisma.bill.update({
        where: { id: dynamicBillId },
        data: {
          paidAmount: 1000,
          outstandingAmount: 3600,
          status: 'PARTIALLY_PAID',
        },
      });

      // Tenant deletes a vehicle
      const vehicles = await prisma.tenantVehicle.findMany({
        where: { tenantId, deletedAt: null },
      });
      if (vehicles.length > 0) {
        await tenantService.deleteVehicle(dormId, tenantId, vehicles[0].id);
      }

      // Bill remains strictly FROZEN
      const recheckedBill = await prisma.bill.findUnique({
        where: { id: dynamicBillId },
        include: { items: true },
      });
      expect(Number(recheckedBill?.totalAmount)).toBe(4600);
      expect(Number(recheckedBill?.paidAmount)).toBe(1000);
      const parkingItem = recheckedBill?.items.find(i => i.type === 'parking' || i.code === 'PARKING');
      expect(Number(parkingItem?.amount)).toBe(600);
    });

    it('freezes bill when fully paid (paidAmount >= totalAmount)', async () => {
      await prisma.bill.update({
        where: { id: dynamicBillId },
        data: {
          paidAmount: 4600,
          outstandingAmount: 0,
          status: 'PAID',
        },
      });

      // Tenant adds another vehicle
      const v6 = await tenantService.addVehicle(dormId, tenantId, {
        type: 'car',
        licensePlate: '6กข6666',
      });
      createdVehicleIds.push(v6.id);

      // Bill remains strictly FROZEN
      const recheckedBill = await prisma.bill.findUnique({
        where: { id: dynamicBillId },
        include: { items: true },
      });
      expect(Number(recheckedBill?.totalAmount)).toBe(4600);
      expect(Number(recheckedBill?.paidAmount)).toBe(4600);
      const parkingItem = recheckedBill?.items.find(i => i.type === 'parking' || i.code === 'PARKING');
      expect(Number(parkingItem?.amount)).toBe(600);
    });
  });

  describe('Section 10: Room 105 Historical Terms Snapshot Authority', () => {
    it('verifies provisional rental term preserves frozen registration terms snapshot and ignores settings defaults', async () => {
      const HISTORICAL_TERMS = '1. ข้อกำหนดสัญญาเช่าตามระยะเวลาประวัติศาสตร์ (Term 4 เดือน: ก.ค. - ต.ค. 2569)\n2. ชำระค่าเช่าตามรอบเทอมที่กำหนดล่วงหน้า\n3. ห้ามส่งเสียงดังหลังเวลา 22:00 น.';
      const SETTINGS_DEFAULT_TERMS = 'ข้อกำหนดมาตรฐานปัจจุบันของหอพัก (แก้ไขใหม่ล่าสุด 2570)';

      // 0. Create dedicated room for historical isolation
      const sampleRoom = await prisma.room.findUnique({ where: { id: roomId } });
      const histRoom = await prisma.room.create({
        data: {
          dormitoryId: dormId,
          buildingId: sampleRoom!.buildingId,
          floor: 1,
          roomNumber: `RH-${testSuffix}`,
          normalizedRoomNumber: `RH-${testSuffix}`,
          status: 'occupied',
          monthlyRent: 4500,
          monthlyDeposit: 4500,
          termRent: 18000,
          termDeposit: 4500,
          dailyRent: 500,
          dailyDeposit: 500,
        },
      });

      // 1. Create registration request with historical acceptance snapshot
      const regId = '10500002-0000-4000-8000-' + testSuffix.padStart(12, '0');
      const regRequest = await prisma.tenantRegistrationRequest.create({
        data: {
          id: regId,
          dormitoryId: dormId,
          requestedRoomId: histRoom.id,
          firstName: 'พิมพา',
          lastName: 'ประวัติศาสตร์',
          phone: `087${testSuffix}`,
          status: 'approved',
          acceptanceSnapshot: {
            terms: HISTORICAL_TERMS,
            rentalType: 'TERM',
            rentalPlan: 'term',
            proposedRent: 18000,
            proposedDeposit: 4500,
            startDate: '2026-07-01',
            endDate: '2026-10-31',
            durationMonths: 4,
          },
        },
      });

      // 2. Create tenant & occupancy linked to this registration
      const histTenant = await prisma.tenant.create({
        data: {
          dormitoryId: dormId,
          tenantNumber: `TNT-HIST-${testSuffix}`,
          firstName: 'พิมพา',
          lastName: 'ประวัติศาสตร์',
          displayName: 'นางสาวพิมพา ประวัติศาสตร์',
          phone: `087${testSuffix}`,
          status: 'active',
        },
      });

      const occ = await prisma.occupancy.create({
        data: {
          dormitoryId: dormId,
          roomId: histRoom.id,
          tenantId: histTenant.id,
          registrationId: regRequest.id,
          status: 'ACTIVE',
          startedAt: new Date('2026-07-01T00:00:00.000Z'),
        },
      });

      const provTerm = await prisma.provisionalRentalTerm.create({
        data: {
          dormitoryId: dormId,
          roomId: histRoom.id,
          tenantId: histTenant.id,
          occupancyId: occ.id,
          status: 'ACTIVE',
          rentalType: 'TERM',
          startDate: new Date('2026-07-01T00:00:00.000Z'),
          endDate: new Date('2026-10-31T23:59:59.999Z'),
          unitRentAmount: 18000,
          totalRentAmount: 18000,
          depositAmount: 4500,
          durationMonths: 4,
        },
      });

      // 3. Query tenant details via tenantService
      const details = await tenantService.getTenantDetails(histTenant.id, dormId);
      expect(details).toBeDefined();
      expect(details.provisionalRentalTerms?.length).toBeGreaterThan(0);

      const safeDetails = toTenantDetailsApiDTO(details);
      expect(safeDetails?.provisionalRentalTerms?.[0].terms).toBe(HISTORICAL_TERMS);
      expect(safeDetails?.provisionalRentalTerms?.[0].terms).not.toBe(SETTINGS_DEFAULT_TERMS);

      // Clean up historical test records
      await prisma.provisionalRentalTerm.delete({ where: { id: provTerm.id } });
      await prisma.occupancy.delete({ where: { id: occ.id } });
      await prisma.tenant.delete({ where: { id: histTenant.id } });
      await prisma.tenantRegistrationRequest.delete({ where: { id: regRequest.id } });
      await prisma.room.delete({ where: { id: histRoom.id } });
    });
  });
});
