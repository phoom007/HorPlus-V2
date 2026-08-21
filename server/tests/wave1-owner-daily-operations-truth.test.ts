import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { getPrismaClient } from '../src/db/prisma.js';
import { MeterService } from '../src/services/meter.service.js';
import { BillingService } from '../src/services/billing.service.js';
import { BillingCycleService } from '../src/services/billing-cycle.service.js';
import { ContractService } from '../src/services/contract.service.js';
import { TenantRegistrationService } from '../src/services/tenant-registration.service.js';

import { PrismaMeterRepository } from '../src/db/repositories/meter.repository.js';
import { PrismaBillingCycleRepository } from '../src/db/repositories/billing-cycle.repository.js';
import { PrismaRoomRepository } from '../src/db/repositories/room.repository.js';
import { PrismaBillRepository } from '../src/db/repositories/bill.repository.js';
import { PrismaContractRepository } from '../src/db/repositories/contract.repository.js';
import { PrismaTenantRepository } from '../src/db/repositories/tenant.repository.js';
import { subscriptionEntitlementService } from '../src/services/subscription-entitlement.service.js';

describe('Wave 1 — Owner Daily Operations Mandatory Acceptance Regressions Suite', () => {
  const prisma = getPrismaClient();

  const meterRepo = new PrismaMeterRepository(prisma);
  const billingCycleRepo = new PrismaBillingCycleRepository(prisma);
  const roomRepo = new PrismaRoomRepository(prisma);
  const billRepo = new PrismaBillRepository(prisma);
  const contractRepo = new PrismaContractRepository(prisma);
  const tenantRepo = new PrismaTenantRepository(prisma);

  const meterService = new MeterService(meterRepo, billingCycleRepo, roomRepo, billRepo);
  const billingService = new BillingService(billRepo, billingCycleRepo, meterRepo, contractRepo, roomRepo, tenantRepo);
  const billingCycleService = new BillingCycleService(billingCycleRepo);
  const contractService = new ContractService(contractRepo);
  const registrationService = new TenantRegistrationService();

  const dormAId = randomUUID();
  const dormBId = randomUUID();
  const userId = randomUUID();

  let buildingAId: string;
  let roomA1Id: string;
  let roomA2Id: string;
  let tenantA1Id: string;
  let tenantA2Id: string;
  let contractA1Id: string;
  let cycleA1Id: string;

  beforeAll(async () => {
    await subscriptionEntitlementService.ensureSeeded();

    const email = `wave1_owner_${Date.now()}@example.com`;
    await prisma.user.create({
      data: {
        id: userId,
        email,
        emailNormalized: email.toLowerCase(),
        name: 'Wave 1 Owner',
        googleSubject: `google_sub_${Date.now()}_${Math.random()}`,
      },
    });

    // Create Dormitory A and B
    await prisma.dormitory.create({
      data: { id: dormAId, name: 'Dormitory A', code: `DMA-${Date.now()}`, createdByUserId: userId },
    });
    await prisma.dormitory.create({
      data: { id: dormBId, name: 'Dormitory B', code: `DMB-${Date.now()}`, createdByUserId: userId },
    });

    await subscriptionEntitlementService.provisionInitialTrial(dormAId);
    await subscriptionEntitlementService.provisionInitialTrial(dormBId);

    await prisma.dormitoryBillingSettings.create({
      data: {
        dormitoryId: dormAId,
        dueDay: 5,
        waterBillingType: 'unit',
        waterRate: '0.00',
        electricityBillingType: 'unit',
        electricityRate: '0.00',
        commonFee: '0.00',
        commonFeeMode: 'room',
        internetFee: '0.00',
        internetFeeMode: 'room',
        parkingRate: '0.00',
        parkingFeeMode: 'room',
        lateFeeType: 'none',
        lateFeeValue: '0.00',
      },
    });
    await prisma.dormitoryBillingSettings.create({
      data: {
        dormitoryId: dormBId,
        dueDay: 5,
        waterBillingType: 'unit',
        waterRate: '0.00',
        electricityBillingType: 'unit',
        electricityRate: '0.00',
        commonFee: '0.00',
        commonFeeMode: 'room',
        internetFee: '0.00',
        internetFeeMode: 'room',
        parkingRate: '0.00',
        parkingFeeMode: 'room',
        lateFeeType: 'none',
        lateFeeValue: '0.00',
      },
    });

    // Create Building in Dorm A
    const bld = await prisma.building.create({
      data: { dormitoryId: dormAId, name: 'Building A', code: 'BLD-A' },
    });
    buildingAId = bld.id;

    // Create Rooms A1 & A2
    const rm1 = await prisma.room.create({
      data: {
        dormitoryId: dormAId,
        buildingId: buildingAId,
        roomNumber: '101',
        normalizedRoomNumber: '101',
        roomType: 'standard',
        status: 'vacant',
        initialWaterReading: '100.00',
        initialElectricityReading: '500.00',
      },
    });
    roomA1Id = rm1.id;

    const rm2 = await prisma.room.create({
      data: {
        dormitoryId: dormAId,
        buildingId: buildingAId,
        roomNumber: '102',
        normalizedRoomNumber: '102',
        roomType: 'standard',
        status: 'vacant',
        initialWaterReading: '0.00',
        initialElectricityReading: '0.00',
      },
    });
    roomA2Id = rm2.id;

    // Create Tenant A1 & Tenant A2
    const t1 = await prisma.tenant.create({
      data: {
        dormitoryId: dormAId,
        tenantNumber: 'TNT-001',
        firstName: 'Somchai',
        lastName: 'Jaidee',
        displayName: 'Somchai Jaidee',
        phone: '0812345678',
      },
    });
    tenantA1Id = t1.id;

    const t2 = await prisma.tenant.create({
      data: {
        dormitoryId: dormAId,
        tenantNumber: 'TNT-002',
        firstName: 'Somsri',
        lastName: 'Rukdee',
        displayName: 'Somsri Rukdee',
        phone: '0898765432',
      },
    });
    tenantA2Id = t2.id;

    // Create Draft Contract for Room A1 with Tenant A1
    const ctr1 = await prisma.contract.create({
      data: {
        dormitoryId: dormAId,
        contractNumber: 'CTR-001',
        roomId: roomA1Id,
        tenantId: tenantA1Id,
        status: 'draft',
        startDate: new Date('2026-08-01'),
        endDate: new Date('2027-07-31'),
        rentAmount: '5000.00',
        depositAmount: '10000.00',
      },
    });
    contractA1Id = ctr1.id;

    // Create Billing Cycle A1 with zero rates
    const cycleRes = await billingCycleService.createBillingCycle(dormAId, {
      cycleCode: '2026-08',
      name: 'สิงหาคม 2569',
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      billingDate: '2026-08-25',
      dueDate: '2026-09-05',
      rateSnapshot: {
        waterRate: '0.00',
        electricityRate: '0.00',
        commonFee: '0.00',
        internetFee: '0.00',
      },
    });
    cycleA1Id = cycleRes.cycle.id;
  });

  describe('1. Meter Readings Regressions', () => {
    it('1.1 Tampered client previousReading cannot reduce usage', async () => {
      // First submission: current = 120.00 (authPrev = 100.00, usage = 20.00)
      await meterService.submitBulkReadings(dormAId, {
        billingCycleId: cycleA1Id,
        readings: [
          {
            roomId: roomA1Id,
            meterType: 'water',
            previousReading: '100.00',
            currentReading: '120.00',
          },
        ],
      });

      // Fetch reading and verify previousReading stored is 100.00 and usage is 20.00
      const readings = await meterService.getMeterReadings(dormAId, { billingCycleId: cycleA1Id, roomId: roomA1Id });
      const waterReading = readings.items.find((r) => r.meterType === 'water');
      expect(waterReading?.previousReading).toBe('100.00');
      expect(waterReading?.usageUnits).toBe('20.00');

      // Next, tamper client previousReading to 0 and submit current = 150
      await meterService.submitBulkReadings(dormAId, {
        billingCycleId: cycleA1Id,
        readings: [
          {
            roomId: roomA1Id,
            meterType: 'water',
            previousReading: '0', // TAMPERED BY CLIENT
            currentReading: '150',
          },
        ],
      });

      // Server must derive authoritative previousReading = 100.00 (from room initial or previous cycle) -> usage = 50.00
      const updatedReadings = await meterService.getMeterReadings(dormAId, { billingCycleId: cycleA1Id, roomId: roomA1Id });
      const updatedWater = updatedReadings.items.find((r) => r.meterType === 'water');
      expect(Number(updatedWater?.previousReading)).toBe(100);
      expect(Number(updatedWater?.usageUnits)).toBe(50);
    });

    it('1.2 Stale MeterReading version produces controlled conflict (409 STALE_VERSION)', async () => {
      const readings = await meterService.getMeterReadings(dormAId, { billingCycleId: cycleA1Id, roomId: roomA1Id });
      const waterReading = readings.items.find((r) => r.meterType === 'water')!;

      await expect(
        meterService.updateMeterReading(waterReading.id, dormAId, '160', 'stale test', 999)
      ).rejects.toThrow(/STALE_VERSION|RESOURCE_VERSION_CONFLICT|ข้อมูลถูกแก้ไข/);
    });
  });

  describe('2. Billing Zero/Truth & Idempotency Regressions', () => {
    it('2.1 Legitimate zero rates remain zero without applying 18/7 fallbacks', async () => {
      // Activate contract A1 first
      await contractService.activateContract(contractA1Id, dormAId, {});

      const preview = await billingService.generateBillPreview(dormAId, cycleA1Id, roomA1Id);
      expect(preview.waterRate).toBe('0.00');
      expect(preview.electricityRate).toBe('0.00');
      expect(preview.waterAmount).toBe('0.00');
      expect(preview.electricityAmount).toBe('0.00');
      expect(preview.rentAmount).toBe('5000.00');
      expect(preview.totalAmount).toBe('5000.00');
    });

    it('2.2 Bill request cannot mix Room A with Contract/Tenant of Room B', async () => {
      await expect(
        billingService.generateBill(dormAId, {
          billingCycleId: cycleA1Id,
          roomId: roomA1Id,
          contractId: randomUUID(), // Mismatched contract ID
          tenantId: tenantA1Id,
        })
      ).rejects.toThrow(/CONTRACT_ROOM_MISMATCH|สัญญาที่ระบุ/);
    });

    it('2.3 Incomplete room excluded explicitly during bulk bill generation', async () => {
      // Room A2 has no active contract
      const bulkResult = await billingService.bulkGenerateBills(dormAId, cycleA1Id, [roomA1Id, roomA2Id]);
      expect(bulkResult.excluded.some((e) => e.roomId === roomA2Id)).toBe(true);
    });
  });

  describe('3. Contract Activation & Occupancy Invariant Regressions', () => {
    it('3.1 Contract activation creates exactly one ACTIVE Occupancy record', async () => {
      const activeContract = await contractRepo.findById(contractA1Id, dormAId);
      expect(activeContract?.status).toBe('active');

      const occupancies = await prisma.occupancy.findMany({
        where: { dormitoryId: dormAId, contractId: contractA1Id, status: 'ACTIVE' },
      });
      expect(occupancies.length).toBe(1);
      expect(occupancies[0].roomId).toBe(roomA1Id);
      expect(occupancies[0].tenantId).toBe(tenantA1Id);
    });

    it('3.2 Repeated contract activation produces no duplicate Occupancy', async () => {
      await contractService.activateContract(contractA1Id, dormAId, {});

      const occupancies = await prisma.occupancy.findMany({
        where: { dormitoryId: dormAId, contractId: contractA1Id, status: 'ACTIVE' },
      });
      expect(occupancies.length).toBe(1);
    });

    it('3.3 Activation fails with 409 when room has another active occupancy', async () => {
      // Create another draft contract for Room A1 with Tenant A2
      const ctr2 = await prisma.contract.create({
        data: {
          dormitoryId: dormAId,
          contractNumber: 'CTR-002',
          roomId: roomA1Id,
          tenantId: tenantA2Id,
          status: 'draft',
          startDate: new Date('2026-08-01'),
          endDate: new Date('2027-07-31'),
          rentAmount: '5000.00',
        },
      });

      await expect(
        contractService.activateContract(ctr2.id, dormAId, {})
      ).rejects.toThrow(/ROOM_ALREADY_OCCUPIED|CONTRACT_OVERLAP|ช่วงเวลาสัญญาซ้อนทับ/);
    });
  });

  describe('4. Tenant Registration Request Lifecycle Regressions', () => {
    it('4.1 Registration approval always creates complete tenancy state (Tenant + Contract + Occupancy + Room=occupied)', async () => {
      const req = await prisma.tenantRegistrationRequest.create({
        data: {
          dormitoryId: dormAId,
          requestedRoomId: roomA2Id,
          firstName: 'Anan',
          lastName: 'Sukjai',
          phone: '0834567890',
          status: 'pending_owner_approval',
        },
      });

      const res = await registrationService.approveRequest(req.id, dormAId, {
        startDate: '2026-09-01',
        endDate: '2027-08-31',
        durationMonths: 12,
        rentAmount: '5000',
        depositAmount: '5000',
        advancePaymentAmount: '5000',
      });
      expect(res.request.status).toBe('approved');
      expect(res.tenant).toBeDefined();
      expect(res.contractId).toBeDefined();
      expect(res.occupancy).toBeDefined();
      expect(res.occupancy.status).toBe('ACTIVE');

      // Verify Occupancy was created for Room A2
      const occs = await prisma.occupancy.findMany({
        where: { dormitoryId: dormAId, roomId: roomA2Id, status: 'ACTIVE' },
      });
      expect(occs.length).toBe(1);

      // Verify Room is now occupied
      const room = await prisma.room.findUnique({ where: { id: roomA2Id } });
      expect(room!.status).toBe('occupied');
    });
  });

  describe('5. Concurrency & Cross-Dormitory Isolation Regressions', () => {
    it('5.1 Concurrent cycle creation creates exactly one BillingCycle and rate snapshot', async () => {
      const cycleCode = '2026-09';
      const p1 = billingCycleService.createBillingCycle(dormAId, {
        cycleCode,
        name: 'กันยายน 2569',
        periodStart: '2026-09-01',
        periodEnd: '2026-09-30',
        billingDate: '2026-09-25',
        dueDate: '2026-10-05',
      });
      const p2 = billingCycleService.createBillingCycle(dormAId, {
        cycleCode,
        name: 'กันยายน 2569',
        periodStart: '2026-09-01',
        periodEnd: '2026-09-30',
        billingDate: '2026-09-25',
        dueDate: '2026-10-05',
      });

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1.cycle.id).toBe(r2.cycle.id);

      const dbCycles = await prisma.billingCycle.findMany({
        where: { dormitoryId: dormAId, cycleCode },
      });
      expect(dbCycles.length).toBe(1);
    });

    it('5.2 Dorm A Owner cannot read or write Dorm B Wave-1 entity', async () => {
      // Create cycle in Dorm B
      const cycleB = await billingCycleService.createBillingCycle(dormBId, {
        cycleCode: '2026-08',
        name: 'สิงหาคม 2569 B',
        periodStart: '2026-08-01',
        periodEnd: '2026-08-31',
        billingDate: '2026-08-25',
        dueDate: '2026-09-05',
      });

      // Attempting to fetch Dorm B's cycle using Dorm A context must fail
      await expect(
        billingCycleService.getBillingCycleById(cycleB.cycle.id, dormAId)
      ).rejects.toThrow(/BILLING_CYCLE_NOT_FOUND/);
    });
  });
});
