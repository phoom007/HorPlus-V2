/**
 * HORPLUS LOCAL-07 — Batch 01 Targeted Integration Test Suite
 * Validates:
 * 1. Schema Migration & Integrity Proof (Tenant.phone nullable, snapshot defaults, provisional_rental_terms)
 * 2. First Cycle Authority & arbitrary starting month detection
 * 3. First Cycle custom previous reading persistence
 * 4. Dirty-Field Workspace bulk save semantics & strict otherFees validation
 * 5. People count lifecycle (vacant = 0, future reserved = 0, active = 1+N)
 * 6. Meter reading eligibility & zero usage (current == previous)
 * 7. Status Switch Authority (atomic issue with dirty data, canonical cancellation, paid bill lock)
 * 8. Snapshot manual charges (manualOutstandingAmount, otherFees) included in bill items
 * 9. Provisional Rental Terms (MONTHLY/TERM, future RESERVED vs ACTIVE, overlap prevention, contract priority)
 * 
 * @license Apache-2.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPrismaClient } from '../../db/prisma.js';
import { MeterService } from '../../services/meter.service.js';
import { BillingService } from '../../services/billing.service.js';
import { BillingCycleService } from '../../services/billing-cycle.service.js';
import { billingOrchestrationService } from '../../services/billing-orchestration.service.js';
import { provisionalRentalTermService } from '../../services/provisional-rental-term.service.js';
import { PrismaMeterRepository } from '../../db/repositories/meter.repository.js';
import { PrismaBillingCycleRepository } from '../../db/repositories/billing-cycle.repository.js';
import { PrismaBillRepository } from '../../db/repositories/bill.repository.js';
import { PrismaRoomRepository } from '../../db/repositories/room.repository.js';
import { PrismaContractRepository } from '../../db/repositories/contract.repository.js';
import { PrismaTenantRepository } from '../../db/repositories/tenant.repository.js';
import { PrismaBuildingRepository } from '../../db/repositories/building.repository.js';
import { AuditService } from '../../services/audit.service.js';
import { toDecimal, formatDecimal, addDecimals } from '../../utils/decimal-math.util.js';
import { TenantNumberService } from '../../services/tenant-number.service.js';
import {
  OtherFeeItemSchema,
  SaveMeterWorkspaceRowSchema,
  CreateProvisionalRentalTermSchema,
} from '../../schemas/billing-meter.schemas.js';
import request from 'supertest';
import express from 'express';
import { cookieParserMiddleware } from '../../middleware/cookie-parser.middleware.js';
import { createMeterRouter } from '../../routes/meter.routes.js';
import crypto from 'crypto';

describe('LOCAL-07 Batch 01 — Meter Core & Provisional Rental Terms Test Suite', () => {
  const prisma = getPrismaClient();

  const meterRepo = new PrismaMeterRepository(prisma);
  const billingCycleRepo = new PrismaBillingCycleRepository(prisma);
  const billRepo = new PrismaBillRepository(prisma);
  const roomRepo = new PrismaRoomRepository(prisma);
  const contractRepo = new PrismaContractRepository(prisma);
  const tenantRepo = new PrismaTenantRepository(prisma);
  const buildingRepo = new PrismaBuildingRepository(prisma);
  const auditService = new AuditService();

  const meterService = new MeterService(meterRepo, billingCycleRepo, roomRepo, billRepo, auditService);
  const billingCycleService = new BillingCycleService(billingCycleRepo, auditService);
  const billingService = new BillingService(
    billRepo,
    billingCycleRepo,
    meterRepo,
    contractRepo,
    roomRepo,
    tenantRepo,
    auditService
  );

  let testDormitoryId: string;
  let testBuildingId: string;
  let testRoom1Id: string;
  let testRoom2Id: string;
  let testRoom3Id: string;
  let cycle1Id: string;
  let cycle2Id: string;
  let testApp: express.Express;

  beforeAll(async () => {
    const suffix = crypto.randomBytes(4).toString('hex');
    testDormitoryId = crypto.randomUUID();

    // Create Dormitory
    await prisma.dormitory.create({
      data: {
        id: testDormitoryId,
        name: `Local07 Test Dorm ${suffix}`,
        code: `DORM-${suffix.toUpperCase()}`,
        billingSettings: {
          create: {
            waterBillingType: 'per_unit',
            waterRate: toDecimal('18.00'),
            electricityBillingType: 'per_unit',
            electricityRate: toDecimal('8.00'),
            commonFee: toDecimal('200.00'),
            billingDay: 1,
            dueDay: 5,
          },
        },
      },
    });

    // Create Building
    const building = await prisma.building.create({
      data: {
        dormitoryId: testDormitoryId,
        name: 'Building A',
        termMonths: 4,
        maxTermRentInstallments: 4,
      },
    });
    testBuildingId = building.id;

    // Create 3 Rooms
    const r1 = await prisma.room.create({
      data: {
        dormitoryId: testDormitoryId,
        buildingId: testBuildingId,
        roomNumber: '101',
        normalizedRoomNumber: '101',
        roomType: 'standard',
        floor: 1,
        monthlyRent: toDecimal('4500.00'),
        status: 'vacant',
        initialWaterReading: toDecimal('100.00'),
        initialElectricityReading: toDecimal('500.00'),
      },
    });
    testRoom1Id = r1.id;

    const r2 = await prisma.room.create({
      data: {
        dormitoryId: testDormitoryId,
        buildingId: testBuildingId,
        roomNumber: '102',
        normalizedRoomNumber: '102',
        roomType: 'standard',
        floor: 1,
        monthlyRent: toDecimal('4800.00'),
        status: 'vacant',
        initialWaterReading: toDecimal('150.00'),
        initialElectricityReading: toDecimal('600.00'),
      },
    });
    testRoom2Id = r2.id;

    const r3 = await prisma.room.create({
      data: {
        dormitoryId: testDormitoryId,
        buildingId: testBuildingId,
        roomNumber: '103',
        normalizedRoomNumber: '103',
        roomType: 'standard',
        floor: 1,
        monthlyRent: toDecimal('5000.00'),
        status: 'vacant',
        initialWaterReading: toDecimal('200.00'),
        initialElectricityReading: toDecimal('700.00'),
      },
    });
    testRoom3Id = r3.id;

    // Create Billing Cycles (Cycle 1: 2026-06 earliest, Cycle 2: 2026-07)
    const c1 = await prisma.billingCycle.create({
      data: {
        dormitoryId: testDormitoryId,
        cycleCode: '2026-06',
        name: 'มิถุนายน 2026',
        periodStart: new Date('2026-06-01T00:00:00Z'),
        periodEnd: new Date('2026-06-30T23:59:59Z'),
        billingDate: new Date('2026-06-30T00:00:00Z'),
        dueDate: new Date('2026-07-05T00:00:00Z'),
        status: 'draft',
        rateSnapshot: {
          create: {
            dormitoryId: testDormitoryId,
            waterBillingType: 'per_unit',
            waterRate: toDecimal('18.00'),
            electricityBillingType: 'per_unit',
            electricityRate: toDecimal('8.00'),
            commonFee: toDecimal('200.00'),
            commonFeeMode: 'per_room',
            internetFee: toDecimal('0.00'),
            internetFeeMode: 'flat',
            parkingFee: toDecimal('0.00'),
            parkingFeeMode: 'flat',
            lateFeeType: 'flat',
            lateFeeValue: toDecimal('0.00'),
            source: 'TEMPLATE_DEFAULT',
          },
        },
      },
    });
    cycle1Id = c1.id;

    const c2 = await prisma.billingCycle.create({
      data: {
        dormitoryId: testDormitoryId,
        cycleCode: '2026-07',
        name: 'กรกฎาคม 2026',
        periodStart: new Date('2026-07-01T00:00:00Z'),
        periodEnd: new Date('2026-07-31T23:59:59Z'),
        billingDate: new Date('2026-07-31T00:00:00Z'),
        dueDate: new Date('2026-08-05T00:00:00Z'),
        status: 'draft',
        rateSnapshot: {
          create: {
            dormitoryId: testDormitoryId,
            waterBillingType: 'per_unit',
            waterRate: toDecimal('18.00'),
            electricityBillingType: 'per_unit',
            electricityRate: toDecimal('8.00'),
            commonFee: toDecimal('200.00'),
            commonFeeMode: 'per_room',
            internetFee: toDecimal('0.00'),
            internetFeeMode: 'flat',
            parkingFee: toDecimal('0.00'),
            parkingFeeMode: 'flat',
            lateFeeType: 'flat',
            lateFeeValue: toDecimal('0.00'),
            source: 'TEMPLATE_DEFAULT',
          },
        },
      },
    });
    cycle2Id = c2.id;

    // Setup test Express app for real HTTP route boundary testing
    const mockAuthService: any = {
      verifyCsrf: () => true,
      validateSession: async () => ({
        userId: 'user-owner-1',
        sessionId: 'session-test-123',
        tokenVersion: 1,
        user: { id: 'user-owner-1', email: 'owner@example.com' },
        session: { id: 'session-test-123', userId: 'user-owner-1' },
        memberships: [{ id: 'mem-1', dormitoryId: testDormitoryId, roleCode: 'OWNER', status: 'active', permissions: ['*'] }],
        dormitoryId: testDormitoryId,
        role: 'OWNER',
      }),
    };

    testApp = express();
    testApp.use(express.json());
    testApp.use((req: any, _res: any, next: any) => {
      req.auth = {
        userId: 'user-owner-1',
        sessionId: 'session-test-123',
        tokenVersion: 1,
        user: { id: 'user-owner-1', email: 'owner@example.com' },
        session: { id: 'session-test-123', userId: 'user-owner-1' },
        memberships: [{ id: 'mem-1', dormitoryId: testDormitoryId, roleCode: 'OWNER', status: 'active', permissions: ['*'] }],
        dormitoryId: testDormitoryId,
        role: 'OWNER',
        permissions: ['*'],
      };
      req.dormitoryContext = {
        dormitoryId: testDormitoryId,
        roleCode: 'OWNER',
        permissions: ['*'],
      };
      req.cookies = {
        horplus_session: 'session-cookie-123',
        horplus_csrf: 'csrf-test-token',
      };
      req.headers['x-dormitory-id'] = testDormitoryId;
      req.headers['x-csrf-token'] = 'csrf-test-token';
      next();
    });
    testApp.use('/api/v1/meters', createMeterRouter(mockAuthService, meterService, billingService));
  });

  afterAll(async () => {
    // Cleanup
    await prisma.billItem.deleteMany({ where: { bill: { dormitoryId: testDormitoryId } } });
    await prisma.bill.deleteMany({ where: { dormitoryId: testDormitoryId } });
    await prisma.provisionalRentalTerm.deleteMany({ where: { dormitoryId: testDormitoryId } });
    await prisma.occupancy.deleteMany({ where: { dormitoryId: testDormitoryId } });
    await prisma.meterReading.deleteMany({ where: { dormitoryId: testDormitoryId } });
    await prisma.meterDevice.deleteMany({ where: { dormitoryId: testDormitoryId } });
    await prisma.roomBillingCycleSnapshot.deleteMany({ where: { dormitoryId: testDormitoryId } });
    await prisma.contract.deleteMany({ where: { dormitoryId: testDormitoryId } });
    await prisma.tenant.deleteMany({ where: { dormitoryId: testDormitoryId } });
    await prisma.billingCycle.deleteMany({ where: { dormitoryId: testDormitoryId } });
    await prisma.room.deleteMany({ where: { dormitoryId: testDormitoryId } });
    await prisma.building.deleteMany({ where: { dormitoryId: testDormitoryId } });
    await prisma.dormitoryBillingSettings.deleteMany({ where: { dormitoryId: testDormitoryId } });
    await prisma.dormitory.deleteMany({ where: { id: testDormitoryId } });
  });

  // --------------------------------------------------------------------------
  // TEST 1: Schema Migration & Integrity Proof
  // --------------------------------------------------------------------------
  it('1. Schema integrity: Tenant.phone is nullable & snapshot defaults to peopleCount=0, manualOutstandingAmount=0, otherFees=[]', async () => {
    // 1. Create tenant with phone: null
    const tenantWithNullPhone = await prisma.tenant.create({
      data: {
        dormitoryId: testDormitoryId,
        firstName: 'สมชาย',
        displayName: 'สมชาย ใจดี ไร้เบอร์',
        phone: null,
        tenantNumber: `TNT-PROOF-${Date.now()}`,
      },
    });
    expect(tenantWithNullPhone.phone).toBeNull();

    // 2. Create room billing cycle snapshot with default values
    const snapshot = await prisma.roomBillingCycleSnapshot.create({
      data: {
        dormitoryId: testDormitoryId,
        billingCycleId: cycle1Id,
        roomId: testRoom1Id,
      },
    });
    expect(snapshot.peopleCount).toBe(0);
    expect(formatDecimal(toDecimal(snapshot.manualOutstandingAmount))).toBe('0.00');
    expect(snapshot.otherFees).toEqual([]);

    // Clean up test snapshot
    await prisma.roomBillingCycleSnapshot.delete({ where: { id: snapshot.id } });
  });

  // --------------------------------------------------------------------------
  // TEST 2: First Cycle Authority & Detection
  // --------------------------------------------------------------------------
  it('2. First Cycle Authority: cycle1 (2026-06) is earliest/first, cycle2 (2026-07) is not', async () => {
    const isCycle1First = await billingCycleService.isFirstBillingCycle(testDormitoryId, cycle1Id);
    const isCycle2First = await billingCycleService.isFirstBillingCycle(testDormitoryId, cycle2Id);

    expect(isCycle1First).toBe(true);
    expect(isCycle2First).toBe(false);

    const firstCycle = await billingCycleService.getFirstBillingCycle(testDormitoryId);
    expect(firstCycle?.id).toBe(cycle1Id);
  });

  // --------------------------------------------------------------------------
  // TEST 3: Provisional Rental Terms (MONTHLY vs TERM, RESERVED vs ACTIVE)
  // --------------------------------------------------------------------------
  it('3. Provisional Rental Term: Quick-Add ACTIVE monthly tenant occupies room and calculates rent', async () => {
    const res = await provisionalRentalTermService.createProvisionalTenantAndTerm(
      testDormitoryId,
      {
        roomId: testRoom1Id,
        fullName: 'นายกิตติศักดิ์ พัฒนาไทยแลนด์',
        phone: '0812345678',
        rentalType: 'MONTHLY',
        durationMonths: 6,
        unitRentAmount: '4500.00',
        startDate: '2026-06-01',
      },
      'user-owner-1'
    );

    expect(res.tenant.firstName).toBe('นายกิตติศักดิ์ พัฒนาไทยแลนด์');
    expect(res.tenant.phone).toBe('0812345678');
    expect(res.provisionalTerm.status).toBe('ACTIVE');
    expect(res.provisionalTerm.durationMonths).toBe(6);
    expect(formatDecimal(toDecimal(res.provisionalTerm.unitRentAmount!))).toBe('4500.00');

    // Room status updated to occupied
    const room = await prisma.room.findUnique({ where: { id: testRoom1Id } });
    expect(room?.status).toBe('occupied');

    // Resolves peopleCount = 1 for room 101 in cycle 1
    const peopleCount = await billingOrchestrationService.resolveCyclePeopleCount(
      testDormitoryId,
      cycle1Id,
      testRoom1Id
    );
    expect(peopleCount).toBe(1);
  });

  it('4. Provisional Rental Term: Future start date creates RESERVED term, marks room reserved, excluded from current cycle peopleCount', async () => {
    // Room 102: Start date in future (2026-10-01)
    const res = await provisionalRentalTermService.createProvisionalTenantAndTerm(
      testDormitoryId,
      {
        roomId: testRoom2Id,
        fullName: 'นางสาววิไลพร จองล่วงหน้า',
        rentalType: 'TERM',
        unitRentAmount: '30000.00',
        totalRentAmount: '30000.00',
        termInstallmentCount: 3,
        startDate: '2026-10-01',
      },
      'user-owner-1'
    );

    expect(res.provisionalTerm.status).toBe('RESERVED');
    expect(res.provisionalTerm.termInstallmentCount).toBe(3);
    expect(res.provisionalTerm.durationMonths).toBe(4); // Authoritative Building.termMonths
    expect(formatDecimal(toDecimal(res.provisionalTerm.unitRentAmount!))).toBe('30000.00');

    // Room status is reserved
    const room = await prisma.room.findUnique({ where: { id: testRoom2Id } });
    expect(room?.status).toBe('reserved');

    // In current cycle (2026-06), RESERVED term does NOT participate in people count -> 0
    const peopleCount = await billingOrchestrationService.resolveCyclePeopleCount(
      testDormitoryId,
      cycle1Id,
      testRoom2Id
    );
    expect(peopleCount).toBe(0);
  });

  it('5. Scheduled Activation Lifecycle: activates RESERVED term to ACTIVE on reaching start date', async () => {
    // Run activation for future date 2026-10-01
    const actResult = await provisionalRentalTermService.activateScheduledProvisionalTerms(
      testDormitoryId,
      '2026-10-01',
      'system-job'
    );
    expect(actResult.activatedCount).toBeGreaterThanOrEqual(1);

    const term = await prisma.provisionalRentalTerm.findFirst({
      where: { roomId: testRoom2Id, deletedAt: null },
    });
    expect(term?.status).toBe('ACTIVE');

    const room = await prisma.room.findUnique({ where: { id: testRoom2Id } });
    expect(room?.status).toBe('occupied');
    expect(room?.currentTenantId).toBe(term?.tenantId);

    // Idempotency: re-running activation produces 0 new activations
    const reActResult = await provisionalRentalTermService.activateScheduledProvisionalTerms(
      testDormitoryId,
      '2026-10-01',
      'system-job'
    );
    expect(reActResult.activatedCount).toBe(0);
  });

  it('6. Provisional Overlap Prevention: rejects creating overlapping term on already occupied room', async () => {
    await expect(
      provisionalRentalTermService.createProvisionalTenantAndTerm(
        testDormitoryId,
        {
          roomId: testRoom1Id,
          fullName: 'นายซ้อนทับ ไม่ได้แน่นอน',
          rentalType: 'MONTHLY',
          unitRentAmount: '4500.00',
          startDate: '2026-06-15',
        },
        'user-owner-1'
      )
    ).rejects.toThrow();
  });

  it('7. Canonical Tenant Number Concurrency: 10 concurrent creations in same dormitory produce unique sequential tenant numbers', async () => {
    // Create 10 temporary rooms for concurrency stress test
    const rooms = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        prisma.room.create({
          data: {
            dormitoryId: testDormitoryId,
            buildingId: testBuildingId,
            roomNumber: `CONC-10-${i + 1}`,
            normalizedRoomNumber: `CONC-10-${i + 1}`,
            roomType: 'standard',
            monthlyRent: toDecimal('4000.00'),
            status: 'vacant',
          },
        })
      )
    );

    // Concurrently create 10 tenants in parallel via shared authority
    const results = await Promise.all(
      rooms.map((r, i) =>
        provisionalRentalTermService.createProvisionalTenantAndTerm(
          testDormitoryId,
          {
            roomId: r.id,
            fullName: `ผู้เช่า คู่ขนาน ${i + 1}`,
            rentalType: 'MONTHLY',
            unitRentAmount: '4000.00',
            startDate: '2026-06-01',
          },
          'user-owner-1'
        )
      )
    );

    expect(results).toHaveLength(10);
    const tenantNumbers = results.map((res) => res.tenant.tenantNumber);
    const uniqueSet = new Set(tenantNumbers);

    expect(uniqueSet.size).toBe(10);
    for (const num of tenantNumbers) {
      // Legacy-compatible format: TNT-<timestamp>-<zero-padded-seq>
      expect(num).toMatch(/^TNT-\d+-\d{4,}$/);
    }

    // Assert: allocateNextTenantNumber requires an active transaction client
    await expect(
      TenantNumberService.allocateNextTenantNumber(testDormitoryId, undefined as any)
    ).rejects.toThrow('TENANT_NUMBER_ALLOCATION_REQUIRES_TRANSACTION');

    // Static verification: ensure shared authority is used and no duplicate Date.now numbering algorithms remain
    const fs = await import('fs');
    const path = await import('path');
    const provCode = fs.readFileSync(path.resolve(process.cwd(), 'src/services/provisional-rental-term.service.ts'), 'utf-8');
    const regCode = fs.readFileSync(path.resolve(process.cwd(), 'src/services/tenant-registration.service.ts'), 'utf-8');
    expect(provCode).toContain('generateNextTenantNumber');
    expect(regCode).toContain('generateNextTenantNumber');
    expect(provCode).not.toContain('TNT-${Date.now');
    expect(regCode).not.toContain('TNT-${Date.now');
  });

  it('7b. Sequential Provisional Terms: selects correct overlapping active term and ignores prior/subsequent non-overlapping terms', async () => {
    const seqDorm = await prisma.dormitory.create({
      data: {
        name: 'หอพักทดสอบลำดับสัญญาชั่วคราว',
        addressLine1: '99/99',
        status: 'active',
      },
    });

    const seqBuilding = await prisma.building.create({
      data: {
        dormitoryId: seqDorm.id,
        name: 'ตึกทดสอบ',
        floorCount: 1,
        status: 'active',
      },
    });

    const seqRoom = await prisma.room.create({
      data: {
        dormitoryId: seqDorm.id,
        buildingId: seqBuilding.id,
        roomNumber: 'SEQ-TERM-1',
        normalizedRoomNumber: 'SEQ-TERM-1',
        roomType: 'standard',
        monthlyRent: toDecimal('4000.00'),
        status: 'vacant',
      },
    });

    const tenantA = await prisma.tenant.create({
      data: {
        dormitoryId: seqDorm.id,
        tenantNumber: `TNT-SEQ-A-${Date.now()}`,
        firstName: 'ผู้เช่า งวดแรก',
        displayName: 'ผู้เช่า งวดแรก',
        phone: '0811111111',
        status: 'active',
      },
    });

    const tenantB = await prisma.tenant.create({
      data: {
        dormitoryId: seqDorm.id,
        tenantNumber: `TNT-SEQ-B-${Date.now()}`,
        firstName: 'ผู้เช่า งวดสอง',
        displayName: 'ผู้เช่า งวดสอง',
        phone: '0822222222',
        status: 'active',
      },
    });

    // Term A: Jan - Apr (2026-01-01 to 2026-04-30), Rent = 3500.00
    const termA = await prisma.provisionalRentalTerm.create({
      data: {
        dormitoryId: seqDorm.id,
        roomId: seqRoom.id,
        tenantId: tenantA.id,
        rentalType: 'MONTHLY',
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        endDate: new Date('2026-04-30T23:59:59.000Z'),
        durationMonths: 4,
        unitRentAmount: toDecimal('3500.00'),
        status: 'ACTIVE',
      },
    });

    // Term B: May - Aug (2026-05-01 to 2026-08-31), Rent = 4500.00
    const termB = await prisma.provisionalRentalTerm.create({
      data: {
        dormitoryId: seqDorm.id,
        roomId: seqRoom.id,
        tenantId: tenantB.id,
        rentalType: 'MONTHLY',
        startDate: new Date('2026-05-01T00:00:00.000Z'),
        endDate: new Date('2026-08-31T23:59:59.000Z'),
        durationMonths: 4,
        unitRentAmount: toDecimal('4500.00'),
        status: 'ACTIVE',
      },
    });

    // Create March cycle (overlaps Term A)
    const marchCycle = await prisma.billingCycle.create({
      data: {
        dormitoryId: seqDorm.id,
        cycleCode: '2026-03',
        name: 'รอบ มี.ค. 2026',
        periodStart: new Date('2026-03-01T00:00:00.000Z'),
        periodEnd: new Date('2026-03-31T23:59:59.000Z'),
        billingDate: new Date('2026-03-25T00:00:00.000Z'),
        dueDate: new Date('2026-04-05T00:00:00.000Z'),
        status: 'draft',
      },
    });

    // Create June cycle (overlaps Term B)
    const juneCycle = await prisma.billingCycle.create({
      data: {
        dormitoryId: seqDorm.id,
        cycleCode: '2026-06',
        name: 'รอบ มิ.ย. 2026',
        periodStart: new Date('2026-06-01T00:00:00.000Z'),
        periodEnd: new Date('2026-06-30T23:59:59.000Z'),
        billingDate: new Date('2026-06-25T00:00:00.000Z'),
        dueDate: new Date('2026-07-05T00:00:00.000Z'),
        status: 'draft',
      },
    });

    // Create September cycle (outside both Term A and Term B)
    const septCycle = await prisma.billingCycle.create({
      data: {
        dormitoryId: seqDorm.id,
        cycleCode: '2026-09',
        name: 'รอบ ก.ย. 2026',
        periodStart: new Date('2026-09-01T00:00:00.000Z'),
        periodEnd: new Date('2026-09-30T23:59:59.000Z'),
        billingDate: new Date('2026-09-25T00:00:00.000Z'),
        dueDate: new Date('2026-10-05T00:00:00.000Z'),
        status: 'draft',
      },
    });

    // 1. In June cycle:
    // Billing source must resolve Tenant B
    const resolvedJune = await billingService.resolveProvisionalBillingSource(
      seqDorm.id,
      seqRoom.id,
      juneCycle
    );
    expect(resolvedJune).toBeDefined();
    expect(resolvedJune?.id).toBe(termB.id);
    expect(resolvedJune?.tenantId).toBe(tenantB.id);

    // Orchestration peopleCount must resolve Tenant B (1 occupant)
    const junePeople = await billingOrchestrationService.resolveCyclePeopleCount(
      seqDorm.id,
      juneCycle.id,
      seqRoom.id,
      undefined
    );
    expect(junePeople).toBe(1);

    // 2. In March cycle:
    // Billing source must resolve Tenant A
    const resolvedMarch = await billingService.resolveProvisionalBillingSource(
      seqDorm.id,
      seqRoom.id,
      marchCycle
    );
    expect(resolvedMarch).toBeDefined();
    expect(resolvedMarch?.id).toBe(termA.id);
    expect(resolvedMarch?.tenantId).toBe(tenantA.id);

    // Orchestration peopleCount must resolve Tenant A (1 occupant)
    const marchPeople = await billingOrchestrationService.resolveCyclePeopleCount(
      seqDorm.id,
      marchCycle.id,
      seqRoom.id,
      undefined
    );
    expect(marchPeople).toBe(1);

    // 3. In September cycle (outside both):
    // Billing source must return null
    const resolvedSept = await billingService.resolveProvisionalBillingSource(
      seqDorm.id,
      seqRoom.id,
      septCycle
    );
    expect(resolvedSept).toBeNull();

    // Orchestration peopleCount must resolve 0
    const septPeople = await billingOrchestrationService.resolveCyclePeopleCount(
      seqDorm.id,
      septCycle.id,
      seqRoom.id,
      undefined
    );
    expect(septPeople).toBe(0);
  });

  it('7c. Money Decimal-String Schema Boundary: accepts valid canonical decimal strings and strictly rejects numbers/scientific/NaN/negative', () => {
    // 1. OtherFeeItemSchema
    expect(OtherFeeItemSchema.safeParse({ description: 'ค่าบริการ', amount: '0' }).success).toBe(true);
    expect(OtherFeeItemSchema.safeParse({ description: 'ค่าบริการ', amount: '0.00' }).success).toBe(true);
    expect(OtherFeeItemSchema.safeParse({ description: 'ค่าบริการ', amount: '10.50' }).success).toBe(true);
    expect(OtherFeeItemSchema.safeParse({ description: 'ค่าบริการ', amount: '500.25' }).success).toBe(true);

    // Reject number types
    expect(OtherFeeItemSchema.safeParse({ description: 'ค่าบริการ', amount: 10.5 }).success).toBe(false);
    expect(OtherFeeItemSchema.safeParse({ description: 'ค่าบริการ', amount: 500 }).success).toBe(false);

    // Reject invalid strings
    expect(OtherFeeItemSchema.safeParse({ description: 'ค่าบริการ', amount: '10.505' }).success).toBe(false);
    expect(OtherFeeItemSchema.safeParse({ description: 'ค่าบริการ', amount: '1e3' }).success).toBe(false);
    expect(OtherFeeItemSchema.safeParse({ description: 'ค่าบริการ', amount: '-10.00' }).success).toBe(false);
    expect(OtherFeeItemSchema.safeParse({ description: 'ค่าบริการ', amount: 'NaN' }).success).toBe(false);
    expect(OtherFeeItemSchema.safeParse({ description: 'ค่าบริการ', amount: 'Infinity' }).success).toBe(false);

    // 2. SaveMeterWorkspaceRowSchema
    expect(SaveMeterWorkspaceRowSchema.safeParse({ roomId: 'r1', manualOutstandingAmount: '150.00' }).success).toBe(true);
    expect(SaveMeterWorkspaceRowSchema.safeParse({ roomId: 'r1', manualOutstandingAmount: 150 }).success).toBe(false);
    expect(SaveMeterWorkspaceRowSchema.safeParse({ roomId: 'r1', manualOutstandingAmount: '150.999' }).success).toBe(false);

    // 3. CreateProvisionalRentalTermSchema
    expect(CreateProvisionalRentalTermSchema.safeParse({
      roomId: 'r1',
      fullName: 'นายทดสอบ',
      rentalType: 'MONTHLY',
      startDate: '2026-06-01',
      unitRentAmount: '4500.00',
    }).success).toBe(true);

    expect(CreateProvisionalRentalTermSchema.safeParse({
      roomId: 'r1',
      fullName: 'นายทดสอบ',
      rentalType: 'MONTHLY',
      startDate: '2026-06-01',
      unitRentAmount: 4500,
    }).success).toBe(false);
  });

  it('8. TERM Authority: enforces explicit installment requirement and Building.termMonths duration', async () => {
    const termRoom = await prisma.room.create({
      data: {
        dormitoryId: testDormitoryId,
        buildingId: testBuildingId,
        roomNumber: 'TERM-TEST',
        normalizedRoomNumber: 'TERM-TEST',
        roomType: 'standard',
        monthlyRent: toDecimal('20000.00'),
        status: 'vacant',
      },
    });

    // 1. Missing termInstallmentCount must fail
    await expect(
      provisionalRentalTermService.createProvisionalTenantAndTerm(
        testDormitoryId,
        {
          roomId: termRoom.id,
          fullName: 'นายเทอม ไม่ระบุงวด',
          rentalType: 'TERM',
          unitRentAmount: '20000.00',
          startDate: '2026-06-01',
        } as any,
        'user-owner-1'
      )
    ).rejects.toThrow();

    // 2. Installments exceeding maxTermRentInstallments (4) must fail
    await expect(
      provisionalRentalTermService.createProvisionalTenantAndTerm(
        testDormitoryId,
        {
          roomId: termRoom.id,
          fullName: 'นายเทอม เกินงวด',
          rentalType: 'TERM',
          unitRentAmount: '20000.00',
          termInstallmentCount: 5,
          startDate: '2026-06-01',
        },
        'user-owner-1'
      )
    ).rejects.toThrow();

    // 3. Client durationMonths=12 cannot override Building.termMonths (4)
    const validTerm = await provisionalRentalTermService.createProvisionalTenantAndTerm(
      testDormitoryId,
      {
        roomId: termRoom.id,
        fullName: 'นายเทอม ถูกต้องตามระเบียบ',
        rentalType: 'TERM',
        unitRentAmount: '20000.00',
        termInstallmentCount: 2,
        durationMonths: 12, // Attempted client override
        startDate: '2026-06-01',
      },
      'user-owner-1'
    );
    expect(validTerm.provisionalTerm.durationMonths).toBe(4);
    expect(validTerm.provisionalTerm.termInstallmentCount).toBe(2);
  });

  // --------------------------------------------------------------------------
  // TEST 4: Dirty-Field Bulk Workspace Save & strict otherFees validation
  // --------------------------------------------------------------------------
  it('9. Dirty-field workspace save: persists only entered fields, first cycle custom prev reading, and strict otherFees', async () => {
    const saveRes = await meterService.saveBulkMeterWorkspace(
      testDormitoryId,
      {
        billingCycleId: cycle1Id,
        rows: [
          {
            roomId: testRoom1Id,
            waterPrev: '110.00', // First-cycle edited prev reading
            waterCurr: '130.00',
            elecPrev: '520.00',
            elecCurr: '590.00',
            peopleCount: 2, // 2 people
            manualOutstandingAmount: '150.00',
            otherFees: [
              { description: ' ค่าทำความสะอาดแอร์ ', amount: '500.00' },
              { description: 'ค่ากุญแจสำรอง', amount: '100.00' },
            ],
          },
        ],
      },
      'user-owner-1'
    );

    expect(saveRes.savedCount).toBe(1);

    // Verify snapshot
    const snapshot = await prisma.roomBillingCycleSnapshot.findUnique({
      where: {
        dormitory_billing_cycle_room_unique: {
          dormitoryId: testDormitoryId,
          billingCycleId: cycle1Id,
          roomId: testRoom1Id,
        },
      },
    });

    expect(snapshot?.peopleCount).toBe(2);
    expect(formatDecimal(toDecimal(snapshot?.manualOutstandingAmount))).toBe('150.00');
    expect(snapshot?.otherFees).toEqual([
      { description: 'ค่าทำความสะอาดแอร์', amount: '500.00' },
      { description: 'ค่ากุญแจสำรอง', amount: '100.00' },
    ]);

    // Verify Meter Readings created with correct usage
    const waterReading = await meterRepo.findReadingByCycleRoomAndType(
      testDormitoryId,
      cycle1Id,
      testRoom1Id,
      'water'
    );
    expect(waterReading).toBeDefined();
    expect(waterReading?.previousReading).toBe('110.00');
    expect(waterReading?.currentReading).toBe('130.00');
    expect(waterReading?.usageUnits).toBe('20.00');

    const elecReading = await meterRepo.findReadingByCycleRoomAndType(
      testDormitoryId,
      cycle1Id,
      testRoom1Id,
      'electricity'
    );
    expect(elecReading).toBeDefined();
    expect(elecReading?.previousReading).toBe('520.00');
    expect(elecReading?.currentReading).toBe('590.00');
    expect(elecReading?.usageUnits).toBe('70.00');
  });

  // --------------------------------------------------------------------------
  // TEST 5: Atomic Rollback & Meter Non-Fabrication Tests
  // --------------------------------------------------------------------------
  it('10. Atomic Rollback: OFF -> ON failure (missing reading) rolls back dirty snapshot changes without fabricating readings', async () => {
    // Room 103: has provisional term, but NO current meter readings exist
    await provisionalRentalTermService.createProvisionalTenantAndTerm(
      testDormitoryId,
      {
        roomId: testRoom3Id,
        fullName: 'นายทดสอบ โรลแบ็ก',
        rentalType: 'MONTHLY',
        unitRentAmount: '5000.00',
        startDate: '2026-06-01',
      },
      'user-owner-1'
    );

    // Initial snapshot should have 0 manual outstanding
    const initialSnap = await prisma.roomBillingCycleSnapshot.findUnique({
      where: {
        dormitory_billing_cycle_room_unique: {
          dormitoryId: testDormitoryId,
          billingCycleId: cycle1Id,
          roomId: testRoom3Id,
        },
      },
    });
    expect(initialSnap?.manualOutstandingAmount ?? toDecimal('0.00')).toEqual(toDecimal('0.00'));

    // Attempt OFF -> ON with dirtyRow that only changes non-meter fields
    await expect(
      meterService.toggleRoomBillSwitch(
        testDormitoryId,
        {
          billingCycleId: cycle1Id,
          roomId: testRoom3Id,
          action: 'issue',
          dirtyRow: {
            roomId: testRoom3Id,
            peopleCount: 5,
            manualOutstandingAmount: '999.00',
            otherFees: [{ description: 'ค่าที่จอดพิเศษ', amount: '800.00' }],
          },
        },
        'user-owner-1',
        billingService
      )
    ).rejects.toThrow();

    // Assert: No bill was created
    const bill = await prisma.bill.findFirst({
      where: { dormitoryId: testDormitoryId, billingCycleId: cycle1Id, roomId: testRoom3Id },
    });
    expect(bill).toBeNull();

    // Assert: Dirty snapshot changes were rolled back completely!
    const rolledBackSnap = await prisma.roomBillingCycleSnapshot.findUnique({
      where: {
        dormitory_billing_cycle_room_unique: {
          dormitoryId: testDormitoryId,
          billingCycleId: cycle1Id,
          roomId: testRoom3Id,
        },
      },
    });
    expect(rolledBackSnap?.peopleCount ?? 0).not.toBe(5);
    expect(rolledBackSnap?.manualOutstandingAmount ?? toDecimal('0.00')).toEqual(toDecimal('0.00'));
    expect(rolledBackSnap?.otherFees ?? []).toEqual([]);

    // Assert: No meter readings were fabricated
    const waterRead = await meterRepo.findReadingByCycleRoomAndType(testDormitoryId, cycle1Id, testRoom3Id, 'water');
    const elecRead = await meterRepo.findReadingByCycleRoomAndType(testDormitoryId, cycle1Id, testRoom3Id, 'electricity');
    expect(waterRead).toBeNull();
    expect(elecRead).toBeNull();
  });

  it('11. Regression: zero usage explicitly entered (current == previous) creates reading and passes eligibility', async () => {
    // Save zero usage (water 200 -> 200, elec 700 -> 700)
    await meterService.saveBulkMeterWorkspace(
      testDormitoryId,
      {
        billingCycleId: cycle1Id,
        rows: [
          {
            roomId: testRoom3Id,
            waterPrev: '200.00',
            waterCurr: '200.00',
            elecPrev: '700.00',
            elecCurr: '700.00',
            peopleCount: 1,
          },
        ],
      },
      'user-owner-1'
    );

    const waterReading = await meterRepo.findReadingByCycleRoomAndType(
      testDormitoryId,
      cycle1Id,
      testRoom3Id,
      'water'
    );
    expect(waterReading?.usageUnits).toBe('0.00');

    // Bill generation preview passes with 0.00 meter charges
    const preview = await billingService.generateBillPreview(testDormitoryId, cycle1Id, testRoom3Id);
    expect(preview).toBeDefined();
    const waterItem = preview.items.find((i) => i.type === 'water');
    expect(waterItem?.amount).toBe('0.00');
  });

  // --------------------------------------------------------------------------
  // TEST 6: Status Switch Authority (Atomic Issue, Cancel, Paid Lock)
  // --------------------------------------------------------------------------
  it('12. Status Switch Authority: Toggle OFF -> ON issues bill atomically with snapshot manual charges', async () => {
    const toggleRes = await meterService.toggleRoomBillSwitch(
      testDormitoryId,
      {
        billingCycleId: cycle1Id,
        roomId: testRoom1Id,
        action: 'issue',
      },
      'user-owner-1',
      billingService
    );

    expect(toggleRes.action).toBe('issue');
    expect(toggleRes.bill).toBeDefined();
    expect(toggleRes.bill.status).toBe('unpaid');
    expect(toggleRes.bill.provisionalRentalTermId).toBeDefined();

    // Verify snapshot manual charges are in bill items
    const items = (toggleRes as any).items;
    const manualOut = items?.find((i: any) => i.type === 'manual_outstanding' || i.description === 'ค้างชำระ');
    const airClean = items.find((i: any) => i.description === 'ค่าทำความสะอาดแอร์');
    const keyFee = items.find((i: any) => i.description === 'ค่ากุญแจสำรอง');

    expect(manualOut?.amount).toBe('150.00');
    expect(airClean?.amount).toBe('500.00');
    expect(keyFee?.amount).toBe('100.00');
  });

  it('12b. Transaction Visibility: Single switch with dirty manual charges includes them in bill items and total without prior save', async () => {
    // Create fresh room and tenant
    const freshRoom = await prisma.room.create({
      data: {
        dormitoryId: testDormitoryId,
        buildingId: testBuildingId,
        roomNumber: 'TX-VIS-101',
        normalizedRoomNumber: 'TX-VIS-101',
        roomType: 'standard',
        monthlyRent: toDecimal('4000.00'),
        status: 'vacant',
      },
    });

    await provisionalRentalTermService.createProvisionalTenantAndTerm(
      testDormitoryId,
      {
        roomId: freshRoom.id,
        fullName: 'ผู้เช่า สดใหม่',
        rentalType: 'MONTHLY',
        unitRentAmount: '4000.00',
        startDate: '2026-06-01',
      },
      'user-owner-1'
    );

    // Verify snapshot does NOT exist or has 0 manual charges before toggle
    const preSnap = await prisma.roomBillingCycleSnapshot.findUnique({
      where: {
        dormitory_billing_cycle_room_unique: {
          dormitoryId: testDormitoryId,
          billingCycleId: cycle1Id,
          roomId: freshRoom.id,
        },
      },
    });
    expect(preSnap?.manualOutstandingAmount ?? toDecimal('0.00')).toEqual(toDecimal('0.00'));

    // In ONE toggleRoomBillSwitch command: send dirtyRow with manualOutstandingAmount + otherFees + meter readings
    const toggleRes = await meterService.toggleRoomBillSwitch(
      testDormitoryId,
      {
        billingCycleId: cycle1Id,
        roomId: freshRoom.id,
        action: 'issue',
        dirtyRow: {
          roomId: freshRoom.id,
          waterPrev: '100.00',
          waterCurr: '110.00',
          elecPrev: '500.00',
          elecCurr: '550.00',
          peopleCount: 1,
          manualOutstandingAmount: '150.00',
          otherFees: [
            { description: 'ค่าทำความสะอาด', amount: '500.00' },
          ],
        },
      },
      'user-owner-1',
      billingService
    );

    expect(toggleRes.action).toBe('issue');
    expect(toggleRes.bill).toBeDefined();

    // 1. Snapshot committed with 150.00 and 500.00
    const postSnap = await prisma.roomBillingCycleSnapshot.findUnique({
      where: {
        dormitory_billing_cycle_room_unique: {
          dormitoryId: testDormitoryId,
          billingCycleId: cycle1Id,
          roomId: freshRoom.id,
        },
      },
    });
    expect(formatDecimal(toDecimal(postSnap?.manualOutstandingAmount))).toBe('150.00');
    expect(postSnap?.otherFees).toEqual([
      { description: 'ค่าทำความสะอาด', amount: '500.00' },
    ]);

    // 2. Bill Items must contain both charges
    const billItems = await prisma.billItem.findMany({
      where: { billId: toggleRes.bill.id },
    });
    const manualOut = billItems.find((i) => i.type === 'manual_outstanding');
    const cleanFee = billItems.find((i) => i.type === 'other_fee' && i.description === 'ค่าทำความสะอาด');

    expect(manualOut).toBeDefined();
    expect(formatDecimal(toDecimal(manualOut!.amount.toString()))).toBe('150.00');
    expect(cleanFee).toBeDefined();
    expect(formatDecimal(toDecimal(cleanFee!.amount.toString()))).toBe('500.00');

    // 3. Bill total must include both charges exactly
    let sumDec = toDecimal('0.00');
    for (const item of billItems) {
      sumDec = addDecimals(sumDec, item.amount.toString());
    }
    expect(formatDecimal(sumDec)).toBe(formatDecimal(toDecimal(toggleRes.bill.totalAmount.toString())));
  });

  it('13. Status Switch Authority: Toggle ON -> OFF cancels unpaid bill with OWNER_METER_SWITCH_OFF', async () => {
    const cancelRes = await meterService.toggleRoomBillSwitch(
      testDormitoryId,
      {
        billingCycleId: cycle1Id,
        roomId: testRoom1Id,
        action: 'cancel',
        cancellationReason: 'OWNER_METER_SWITCH_OFF',
      },
      'user-owner-1',
      billingService
    );

    expect(cancelRes.action).toBe('cancel');
    expect(cancelRes.status).toBe('cancelled');

    const bill = await prisma.bill.findFirst({
      where: {
        dormitoryId: testDormitoryId,
        billingCycleId: cycle1Id,
        roomId: testRoom1Id,
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(bill?.status).toBe('cancelled');
    expect(bill?.cancellationReason).toBe('OWNER_METER_SWITCH_OFF');
  });

  it('14. Status Switch Authority: Reissuing after cancel creates a new active bill', async () => {
    const reissueRes = await meterService.toggleRoomBillSwitch(
      testDormitoryId,
      {
        billingCycleId: cycle1Id,
        roomId: testRoom1Id,
        action: 'issue',
      },
      'user-owner-1',
      billingService
    );

    expect(reissueRes.action).toBe('issue');
    expect(reissueRes.bill.status).toBe('unpaid');
  });

  it('15. Status Switch Authority: Paid bill cannot be cancelled via switch (locked ON)', async () => {
    // Mark the bill as paid
    const activeBill = await billRepo.findByCycleAndRoom(testDormitoryId, cycle1Id, testRoom1Id);
    expect(activeBill).toBeDefined();

    await prisma.bill.update({
      where: { id: activeBill!.id },
      data: { status: 'paid' },
    });

    // Try to cancel via switch -> must reject
    await expect(
      meterService.toggleRoomBillSwitch(
        testDormitoryId,
        {
          billingCycleId: cycle1Id,
          roomId: testRoom1Id,
          action: 'cancel',
        },
        'user-owner-1',
        billingService
      )
    ).rejects.toThrow();
  });

  // --------------------------------------------------------------------------
  // TEST 7: Bulk Issue-All One-Command & Partial Success Semantics
  // --------------------------------------------------------------------------
  it('16. Bulk Issue-All: single command with dirtyRows executes per-room transactions with real partial success across multiple rooms', async () => {
    // Room A (testRoom3Id): Has active term + zero-usage readings -> valid dirty readings provided -> should generate bill
    // Room B: Create a separate room with active term BUT no meter readings and no readings provided -> should fail eligibility and be excluded without rolling back Room A
    const roomB = await prisma.room.create({
      data: {
        dormitoryId: testDormitoryId,
        buildingId: testBuildingId,
        roomNumber: 'BULK-FAIL-B',
        normalizedRoomNumber: 'BULK-FAIL-B',
        roomType: 'standard',
        monthlyRent: toDecimal('3000.00'),
        status: 'vacant',
      },
    });

    await provisionalRentalTermService.createProvisionalTenantAndTerm(
      testDormitoryId,
      {
        roomId: roomB.id,
        fullName: 'ผู้เช่า ห้องบี',
        rentalType: 'MONTHLY',
        unitRentAmount: '3000.00',
        startDate: '2026-06-01',
      },
      'user-owner-1'
    );

    // Dispatch ONE bulk command for [testRoom3Id, roomB.id] with dirty rows for both:
    // Room A: full meter readings + manualOutstandingAmount '50.00'
    // Room B: manualOutstandingAmount '999.00' BUT NO meter readings (will fail meter check)
    const bulkRes = await billingService.bulkGenerateBills(
      testDormitoryId,
      cycle1Id,
      [testRoom3Id, roomB.id],
      'user-owner-1',
      [
        {
          roomId: testRoom3Id,
          waterPrev: '200.00',
          waterCurr: '210.00',
          elecPrev: '700.00',
          elecCurr: '750.00',
          peopleCount: 1,
          manualOutstandingAmount: '50.00',
        },
        {
          roomId: roomB.id,
          manualOutstandingAmount: '999.00',
        },
      ]
    );

    // Assert: Generated count = 1 (Room A)
    expect(bulkRes.generatedCount).toBe(1);
    expect(bulkRes.generated.map((g) => g.roomId)).toContain(testRoom3Id);

    // Assert: Room B was excluded/failed due to missing readings
    const excludedOrFailedRoomIds = [
      ...bulkRes.excluded.map((e) => e.roomId),
      ...bulkRes.failed.map((f) => f.roomId),
    ];
    expect(excludedOrFailedRoomIds).toContain(roomB.id);

    // Assert: Room A bill and snapshot were committed successfully
    const snapA = await prisma.roomBillingCycleSnapshot.findUnique({
      where: {
        dormitory_billing_cycle_room_unique: {
          dormitoryId: testDormitoryId,
          billingCycleId: cycle1Id,
          roomId: testRoom3Id,
        },
      },
    });
    expect(formatDecimal(toDecimal(snapA?.manualOutstandingAmount))).toBe('50.00');

    const billA = await prisma.bill.findFirst({
      where: { dormitoryId: testDormitoryId, billingCycleId: cycle1Id, roomId: testRoom3Id, status: 'unpaid' },
    });
    expect(billA).toBeDefined();

    // Verify Room A bill items include manual_outstanding (transaction-visible)
    const billAItems = await prisma.billItem.findMany({
      where: { billId: billA!.id },
    });
    const manualOutItem = billAItems.find((i) => i.type === 'manual_outstanding');
    expect(manualOutItem).toBeDefined();
    expect(formatDecimal(toDecimal(manualOutItem!.amount.toString()))).toBe('50.00');

    // Total must include the 50.00
    expect(toDecimal(billA!.totalAmount.toString()).toNumber()).toBeGreaterThanOrEqual(50.0);

    // Assert: Room B bill was NOT created
    const billB = await prisma.bill.findFirst({
      where: { dormitoryId: testDormitoryId, billingCycleId: cycle1Id, roomId: roomB.id },
    });
    expect(billB).toBeNull();

    // Assert: Room B dirty snapshot was ROLLED BACK (did NOT commit 999.00)
    const snapB = await prisma.roomBillingCycleSnapshot.findUnique({
      where: {
        dormitory_billing_cycle_room_unique: {
          dormitoryId: testDormitoryId,
          billingCycleId: cycle1Id,
          roomId: roomB.id,
        },
      },
    });
    expect(snapB?.manualOutstandingAmount ? formatDecimal(toDecimal(snapB.manualOutstandingAmount)) : '0.00').toBe('0.00');
  });

  // --------------------------------------------------------------------------
  // TEST 8: Pull Previous Authority & Strict Server HTTP Boundary
  // --------------------------------------------------------------------------
  it('17. Pull Previous Authority: pulls authoritative MeterReading records from previous cycle without bill existence and returns previousCyclePeopleCount', async () => {
    // 1. Create a fresh room with no prior bills
    const freshRoom = await prisma.room.create({
      data: {
        dormitoryId: testDormitoryId,
        buildingId: testBuildingId,
        roomNumber: 'PULL-NOBILL-1',
        normalizedRoomNumber: 'PULL-NOBILL-1',
        roomType: 'standard',
        monthlyRent: toDecimal('4500.00'),
        status: 'vacant',
      },
    });

    // Save June readings for freshRoom without creating any bill
    await meterService.saveBulkMeterWorkspace(
      testDormitoryId,
      {
        billingCycleId: cycle1Id,
        rows: [
          {
            roomId: freshRoom.id,
            waterCurr: '1234.00',
            elecCurr: '5678.00',
          },
        ],
      },
      'user-owner-1'
    );

    // Verify readings exist
    const waterRead = await meterRepo.findReadingByCycleRoomAndType(testDormitoryId, cycle1Id, freshRoom.id, 'water');
    const elecRead = await meterRepo.findReadingByCycleRoomAndType(testDormitoryId, cycle1Id, freshRoom.id, 'electricity');
    expect(waterRead?.currentReading).toBe('1234.00');
    expect(elecRead?.currentReading).toBe('5678.00');

    // Verify NO bill was issued for freshRoom in cycle1
    const noBill = await prisma.bill.findFirst({
      where: { dormitoryId: testDormitoryId, billingCycleId: cycle1Id, roomId: freshRoom.id },
    });
    expect(noBill).toBeNull();

    // 2. Call pullPreviousWorkspaceData for cycle2Id (July 2026)
    const pullData = await meterService.pullPreviousWorkspaceData(testDormitoryId, cycle2Id);
    expect(pullData.hasPreviousCycle).toBe(true);
    expect(pullData.previousCycleId).toBe(cycle1Id);

    const freshRoomPull = pullData.rooms.find((r) => r.roomId === freshRoom.id);
    expect(freshRoomPull).toBeDefined();
    expect(freshRoomPull?.previousWaterCurrentReading).toBe('1234.00');
    expect(freshRoomPull?.previousElectricityCurrentReading).toBe('5678.00');
    expect(freshRoomPull?.previousCyclePeopleCount).toBeNull(); // No cycle1 snapshot existed for freshRoom
    expect(freshRoomPull?.currentHouseholdPeopleCount).toBe(0); // Vacant room
  });

  it('18. Real HTTP Route Boundary Proof: verifies real router/Zod rejection of raw numeric JSON money', async () => {
    const httpRoom = await prisma.room.create({
      data: {
        dormitoryId: testDormitoryId,
        buildingId: testBuildingId,
        roomNumber: 'HTTP-ROUTE-1',
        normalizedRoomNumber: 'HTTP-ROUTE-1',
        roomType: 'standard',
        monthlyRent: toDecimal('4500.00'),
        status: 'vacant',
      },
    });

    // 1. Valid canonical decimal payload passes HTTP 200
    const validRes = await request(testApp)
      .post('/api/v1/meters/workspace/bulk')
      .set('x-dormitory-id', testDormitoryId)
      .set('x-csrf-token', 'csrf-test-token')
      .send({
        billingCycleId: cycle1Id,
        rows: [
          {
            roomId: httpRoom.id,
            waterCurr: '100.00',
            manualOutstandingAmount: '150.00',
            otherFees: [
              { description: 'ค่าทำความสะอาด', amount: '500.00' },
            ],
          },
        ],
      });
    expect(validRes.status).toBe(200);
    expect(validRes.body.success).toBe(true);

    // 2. Invalid raw numeric manualOutstandingAmount fails HTTP 400 with VALIDATION_ERROR
    const invalidMoneyRes = await request(testApp)
      .post('/api/v1/meters/workspace/bulk')
      .set('x-dormitory-id', testDormitoryId)
      .set('x-csrf-token', 'csrf-test-token')
      .send({
        billingCycleId: cycle1Id,
        rows: [
          {
            roomId: httpRoom.id,
            manualOutstandingAmount: 150, // raw number -> must be rejected
          },
        ],
      });
    expect(invalidMoneyRes.status).toBe(400);
    expect(invalidMoneyRes.body.error?.code).toBe('VALIDATION_ERROR');

    // 3. Invalid raw numeric otherFee amount fails HTTP 400 with VALIDATION_ERROR
    const invalidFeeRes = await request(testApp)
      .post('/api/v1/meters/workspace/bulk')
      .set('x-dormitory-id', testDormitoryId)
      .set('x-csrf-token', 'csrf-test-token')
      .send({
        billingCycleId: cycle1Id,
        rows: [
          {
            roomId: httpRoom.id,
            otherFees: [
              { description: 'ค่าทำความสะอาด', amount: 500 }, // raw number -> must be rejected
            ],
          },
        ],
      });
    expect(invalidFeeRes.status).toBe(400);
    expect(invalidFeeRes.body.error?.code).toBe('VALIDATION_ERROR');
  });

  it('19. Pull Previous DB-Mutation Proof: strictly read-only, zero DB writes, and zero pending correction consumption', async () => {
    // 1. Create a fresh room with pending correction
    const roomWithCorrection = await prisma.room.create({
      data: {
        dormitoryId: testDormitoryId,
        buildingId: testBuildingId,
        roomNumber: 'PULL-MUT-1',
        normalizedRoomNumber: 'PULL-MUT-1',
        roomType: 'standard',
        monthlyRent: toDecimal('4500.00'),
        status: 'vacant',
      },
    });

    const pendingCorrection = await prisma.roomNextCycleCorrection.create({
      data: {
        dormitoryId: testDormitoryId,
        roomId: roomWithCorrection.id,
        sourceBillingCycleId: cycle1Id,
        peopleCount: 3,
        consumedAt: null,
      },
    });

    // 2. Measure before-call counts of all relevant tables
    const snapshotCountBefore = await prisma.roomBillingCycleSnapshot.count({ where: { dormitoryId: testDormitoryId } });
    const correctionCountBefore = await prisma.roomNextCycleCorrection.count({ where: { dormitoryId: testDormitoryId } });
    const meterReadingCountBefore = await prisma.meterReading.count({ where: { dormitoryId: testDormitoryId } });
    const billCountBefore = await prisma.bill.count({ where: { dormitoryId: testDormitoryId } });
    const provisionalCountBefore = await prisma.provisionalRentalTerm.count({ where: { dormitoryId: testDormitoryId } });
    const occupancyCountBefore = await prisma.occupancy.count({ where: { dormitoryId: testDormitoryId } });

    // 3. Call pullPreviousWorkspaceData
    const pullResult = await meterService.pullPreviousWorkspaceData(testDormitoryId, cycle2Id);
    expect(pullResult.hasPreviousCycle).toBe(true);

    // 4. Measure after-call counts
    const snapshotCountAfter = await prisma.roomBillingCycleSnapshot.count({ where: { dormitoryId: testDormitoryId } });
    const correctionCountAfter = await prisma.roomNextCycleCorrection.count({ where: { dormitoryId: testDormitoryId } });
    const meterReadingCountAfter = await prisma.meterReading.count({ where: { dormitoryId: testDormitoryId } });
    const billCountAfter = await prisma.bill.count({ where: { dormitoryId: testDormitoryId } });
    const provisionalCountAfter = await prisma.provisionalRentalTerm.count({ where: { dormitoryId: testDormitoryId } });
    const occupancyCountAfter = await prisma.occupancy.count({ where: { dormitoryId: testDormitoryId } });

    // Assert: ZERO insertions, ZERO deletions
    expect(snapshotCountAfter).toBe(snapshotCountBefore);
    expect(correctionCountAfter).toBe(correctionCountBefore);
    expect(meterReadingCountAfter).toBe(meterReadingCountBefore);
    expect(billCountAfter).toBe(billCountBefore);
    expect(provisionalCountAfter).toBe(provisionalCountBefore);
    expect(occupancyCountAfter).toBe(occupancyCountBefore);

    // Assert: Pending correction was NOT consumed (consumedAt is strictly null)
    const freshCorrection = await prisma.roomNextCycleCorrection.findUnique({
      where: { id: pendingCorrection.id },
    });
    expect(freshCorrection?.consumedAt).toBeNull();
  });

  it('20. Stale Snapshot Household Authority: returns current household truth (2) when snapshot is stale (1) and leaves snapshot untouched', async () => {
    // 1. Create a room with an active tenant + 1 active co-occupant (household truth = 2)
    const staleRoom = await prisma.room.create({
      data: {
        dormitoryId: testDormitoryId,
        buildingId: testBuildingId,
        roomNumber: 'STALE-SNAP-1',
        normalizedRoomNumber: 'STALE-SNAP-1',
        roomType: 'standard',
        monthlyRent: toDecimal('4500.00'),
        status: 'occupied',
      },
    });

    const tenant = await prisma.tenant.create({
      data: {
        dormitoryId: testDormitoryId,
        tenantNumber: `T-STALE-${Date.now()}`,
        firstName: 'Somchai',
        displayName: 'Somchai S.',
        status: 'active',
      },
    });

    await prisma.tenantCoOccupant.create({
      data: {
        dormitoryId: testDormitoryId,
        tenantId: tenant.id,
        name: 'Co-occupant 1',
        status: 'active',
      },
    });

    const cycle2 = await billingCycleRepo.findById(cycle2Id, testDormitoryId);

    await prisma.contract.create({
      data: {
        dormitoryId: testDormitoryId,
        roomId: staleRoom.id,
        tenantId: tenant.id,
        contractNumber: `CTR-STALE-${Date.now()}`,
        status: 'active',
        startDate: cycle2!.periodStart,
        endDate: cycle2!.periodEnd,
        rentAmount: toDecimal('4500.00'),
      },
    });

    // 2. Insert stale snapshot with peopleCount = 1 for cycle2Id
    await prisma.roomBillingCycleSnapshot.create({
      data: {
        dormitoryId: testDormitoryId,
        billingCycleId: cycle2Id,
        roomId: staleRoom.id,
        peopleCount: 1,
        source: 'MANUAL_STALE',
      },
    });

    // 3. Call pullPreviousWorkspaceData
    const pullData = await meterService.pullPreviousWorkspaceData(testDormitoryId, cycle2Id);
    const staleRoomPull = pullData.rooms.find((r) => r.roomId === staleRoom.id);

    expect(staleRoomPull).toBeDefined();
    // Assert: Returns current household truth (2), NOT the stale snapshot (1)
    expect(staleRoomPull?.currentHouseholdPeopleCount).toBe(2);

    // Assert: Snapshot in DB was NOT rewritten/mutated (still 1)
    const snapInDb = await prisma.roomBillingCycleSnapshot.findUnique({
      where: {
        dormitory_billing_cycle_room_unique: {
          dormitoryId: testDormitoryId,
          billingCycleId: cycle2Id,
          roomId: staleRoom.id,
        },
      },
    });
    expect(snapInDb?.peopleCount).toBe(1);
  });
});
