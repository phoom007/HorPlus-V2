import { describe, it, expect, beforeEach } from 'vitest';
import { getPrismaClient } from '../src/db/prisma.js';
import { billingOrchestrationService } from '../src/services/billing-orchestration.service.js';
import { outboxService } from '../src/services/outbox.service.js';

describe('LOCAL-06 — Co-Occupant / People-Count / Auto-Bill Recalculation & Outbox Orchestration', () => {
  const prisma = getPrismaClient();

  const dormId = 'a0000000-0000-4000-8000-000000000001';
  const tenantUserId = 'a0000000-0000-4000-8000-000000000002';
  const ownerUserId = 'a0000000-0000-4000-8000-000000000003';
  const roomId = 'a0000000-0000-4000-8000-000000000004';
  const tenantId = 'a0000000-0000-4000-8000-000000000005';
  const contractId = 'a0000000-0000-4000-8000-000000000006';
  const cycleId = 'a0000000-0000-4000-8000-000000000007';
  const billId1 = 'a0000000-0000-4000-8000-000000000011';
  const billId2 = 'a0000000-0000-4000-8000-000000000012';
  const billId3 = 'a0000000-0000-4000-8000-000000000013';
  const billIdPaid = 'a0000000-0000-4000-8000-000000000014';

  const buildingId = 'a0000000-0000-4000-8000-000000000008';

  beforeEach(async () => {
    // Clean up test data
    await prisma.billItem.deleteMany({ where: { dormitoryId: dormId } });
    await prisma.bill.deleteMany({ where: { dormitoryId: dormId } });
    await prisma.roomBillingCycleSnapshot.deleteMany({ where: { dormitoryId: dormId } });
    await prisma.roomNextCycleCorrection.deleteMany({ where: { dormitoryId: dormId } });
    await prisma.tenantCoOccupant.deleteMany({ where: { dormitoryId: dormId } });
    await prisma.tenantNotice.deleteMany({ where: { dormitoryId: dormId } });
    await prisma.staffNotification.deleteMany({ where: { dormitoryId: dormId } });
    await prisma.localNotificationOutbox.deleteMany({ where: { dormitoryId: dormId } });
    await prisma.meterReading.deleteMany({ where: { dormitoryId: dormId } });
    await prisma.contract.deleteMany({ where: { dormitoryId: dormId } });
    await prisma.room.deleteMany({ where: { dormitoryId: dormId } });
    await prisma.building.deleteMany({ where: { dormitoryId: dormId } });
    await prisma.tenant.deleteMany({ where: { dormitoryId: dormId } });
    await prisma.billingRateSnapshot.deleteMany({ where: { dormitoryId: dormId } });
    await prisma.billingCycle.deleteMany({ where: { dormitoryId: dormId } });
    await prisma.dormitoryMember.deleteMany({ where: { dormitoryId: dormId } });
    await prisma.user.deleteMany({ where: { id: { in: [tenantUserId, ownerUserId] } } });
    await prisma.dormitory.deleteMany({ where: { id: dormId } });

    // Seed test dormitory & users
    await prisma.dormitory.create({
      data: {
        id: dormId,
        name: 'HorPlus Local06 Dorm',
        code: 'HP-L06',
        addressLine1: '99 Phahonyothin Rd',
        status: 'active',
      },
    });

    await prisma.building.create({
      data: {
        id: buildingId,
        dormitoryId: dormId,
        name: 'Building A',
      },
    });

    await prisma.user.createMany({
      data: [
        { id: tenantUserId, email: 'tenant.l06@example.com', emailNormalized: 'tenant.l06@example.com', name: 'สมศักดิ์ ผู้เช่าหลัก', googleSubject: 'google-sub-tenant-001' },
        { id: ownerUserId, email: 'owner.l06@example.com', emailNormalized: 'owner.l06@example.com', name: 'เจ้าของ หอพัก', googleSubject: 'google-sub-owner-001' },
      ],
    });

    const ownerRole = await prisma.role.create({
      data: {
        id: 'a0000000-0000-4000-8000-000000000009',
        dormitoryId: dormId,
        code: 'OWNER',
        name: 'Owner',
        permissions: {},
        isSystem: true,
      },
    });

    await prisma.dormitoryMember.create({
      data: {
        dormitoryId: dormId,
        userId: ownerUserId,
        roleId: ownerRole.id,
        status: 'active',
      },
    });

    await prisma.tenant.create({
      data: {
        id: tenantId,
        dormitoryId: dormId,
        linkedUserId: tenantUserId,
        tenantNumber: 'TNT-L06-001',
        displayName: 'สมศักดิ์ ผู้เช่าหลัก',
        firstName: 'สมศักดิ์',
        lastName: 'ผู้เช่าหลัก',
        phone: '0812345678',
        status: 'active',
      },
    });

    await prisma.room.create({
      data: {
        id: roomId,
        dormitoryId: dormId,
        buildingId,
        roomNumber: 'A102',
        normalizedRoomNumber: 'a102',
        floor: 1,
        status: 'occupied',
        roomType: 'standard',
        monthlyRent: 5000,
        currentTenantId: tenantId,
      },
    });

    await prisma.contract.create({
      data: {
        id: contractId,
        dormitoryId: dormId,
        contractNumber: 'CTR-L06-001',
        roomId,
        tenantId,
        startDate: new Date('2026-09-01'),
        endDate: new Date('2027-08-31'),
        rentAmount: 5000,
        depositAmount: 10000,
        advancePaymentAmount: 5000,
        status: 'active',
      },
    });

    await prisma.billingCycle.create({
      data: {
        id: cycleId,
        dormitoryId: dormId,
        cycleCode: '2026-09',
        name: 'กันยายน 2569',
        periodStart: new Date('2026-09-01'),
        periodEnd: new Date('2026-09-30'),
        billingDate: new Date('2026-09-25'),
        dueDate: new Date('2026-10-05'),
        status: 'published',
      },
    });

    await prisma.billingRateSnapshot.create({
      data: {
        dormitoryId: dormId,
        billingCycleId: cycleId,
        waterRate: 100,
        waterBillingType: 'person',
        electricityRate: 8,
        electricityBillingType: 'unit',
        commonFee: 200,
        commonFeeMode: 'person',
        internetFee: 0,
        internetFeeMode: 'room',
        parkingFee: 0,
        parkingFeeMode: 'free',
        lateFeeType: 'none',
        lateFeeValue: '0.00',
      },
    });
  });

  it('1. should resolve cycle people count correctly with no snapshot, default to household truth (1)', async () => {
    const count = await billingOrchestrationService.resolveCyclePeopleCount(dormId, cycleId, roomId, tenantId);
    expect(count).toBe(1);
  });

  it('2. should add co-occupant, sync cycle snapshot, recalculate unpaid bill and write to outbox', async () => {
    // Create initial unpaid bill for 1 person: Rent=5000, Water(1 person)=100, CommonFee(1 person)=200, Elec(10 units*8)=80 -> Total = 5380
    const bill = await prisma.bill.create({
      data: {
        id: billId1,
        dormitoryId: dormId,
        billingCycleId: cycleId,
        roomId,
        tenantId,
        contractId,
        billNumber: 'INV-202609-001',
        status: 'unpaid',
        billingDate: new Date('2026-09-25'),
        dueDate: new Date('2026-10-05'),
        subtotal: 5380,
        discountAmount: 0,
        fineAmount: 0,
        totalAmount: 5380,
        paidAmount: 0,
        outstandingAmount: 5380,
      },
    });

    await prisma.billItem.createMany({
      data: [
        {
          dormitoryId: dormId,
          billId: bill.id,
          type: 'rent',
          description: 'ค่าเช่าห้องพัก',
          quantity: 1,
          unit: 'month',
          unitPrice: 5000,
          amount: 5000,
          displayOrder: 0,
        },
        {
          dormitoryId: dormId,
          billId: bill.id,
          type: 'water',
          description: 'ค่าน้ำประปา (1 คน)',
          quantity: 1,
          unit: 'person',
          unitPrice: 100,
          amount: 100,
          metadata: { mode: 'person', peopleCount: 1 },
          displayOrder: 1,
        },
        {
          dormitoryId: dormId,
          billId: bill.id,
          type: 'common_fee',
          description: 'ค่าส่วนกลาง (1 คน)',
          quantity: 1,
          unit: 'person',
          unitPrice: 200,
          amount: 200,
          metadata: { mode: 'person', peopleCount: 1 },
          displayOrder: 2,
        },
        {
          dormitoryId: dormId,
          billId: bill.id,
          type: 'electricity',
          description: 'ค่าไฟฟ้า (10.00 หน่วย)',
          quantity: 10,
          unit: 'unit',
          unitPrice: 8,
          amount: 80,
          displayOrder: 3,
        },
      ],
    });

    // Tenant adds co-occupant "สมใจ ร่วมพัก"
    const addResult = await billingOrchestrationService.addTenantCoOccupant(
      dormId,
      tenantId,
      { name: 'สมใจ ร่วมพัก', phone: '0899999999', relationship: 'เพื่อน' },
      { userId: tenantUserId, isTenant: true }
    );

    expect(addResult.peopleCount).toBe(2);
    expect(addResult.prevPeopleCount).toBe(1);
    expect(addResult.recalculation.recalculated).toBe(true);
    expect(Number(addResult.recalculation.newTotalAmount)).toBe(5680); // 5000 + 200 (water) + 400 (common) + 80 (elec)

    // Check RoomBillingCycleSnapshot in DB
    const snapshot = await prisma.roomBillingCycleSnapshot.findUnique({
      where: {
        dormitory_billing_cycle_room_unique: {
          dormitoryId: dormId,
          billingCycleId: cycleId,
          roomId,
        },
      },
    });
    expect(snapshot).not.toBeNull();
    expect(snapshot?.peopleCount).toBe(2);
    expect(snapshot?.source).toBe('HOUSEHOLD_SYNC');

    // Check Bill in DB
    const updatedBill = await prisma.bill.findUnique({ where: { id: bill.id } });
    expect(Number(updatedBill?.totalAmount)).toBe(5680);
    expect(Number(updatedBill?.outstandingAmount)).toBe(5680);

    // Check BillItems in DB
    const updatedItems = await prisma.billItem.findMany({
      where: { billId: bill.id },
      orderBy: { displayOrder: 'asc' },
    });
    const waterItem = updatedItems.find((i) => i.type === 'water');
    expect(waterItem?.unit).toBe('person');
    expect(Number(waterItem?.quantity)).toBe(2);
    expect(Number(waterItem?.amount)).toBe(200);
    expect(waterItem?.description).toBe('ค่าน้ำประปา (2 คน)');

    const commonItem = updatedItems.find((i) => i.type === 'common_fee');
    expect(commonItem?.unit).toBe('person');
    expect(Number(commonItem?.quantity)).toBe(2);
    expect(Number(commonItem?.amount)).toBe(400);

    const elecItem = updatedItems.find((i) => i.type === 'electricity');
    expect(Number(elecItem?.quantity)).toBe(10); // electricity unchanged
    expect(Number(elecItem?.amount)).toBe(80);

    // Check Outbox events
    const outboxEvents = await prisma.localNotificationOutbox.findMany({
      where: { dormitoryId: dormId },
      orderBy: { createdAt: 'asc' },
    });

    const staffNotifs = await prisma.staffNotification.findMany({ where: { dormitoryId: dormId } });
    const staffEvent = outboxEvents.find((e) => e.recipientType === 'STAFF');
    expect(staffEvent).toBeDefined();
    expect(staffEvent?.eventType).toBe('CO_OCCUPANT_ADDED');
    expect(staffNotifs.length).toBeGreaterThanOrEqual(1);
    expect(staffNotifs[0].title).toContain('เพิ่มผู้พักร่วม');
  });

  it('3. should handle tenant remove co-occupant and recalculate unpaid bill back to 1 person', async () => {
    // First create co-occupant
    const co = await prisma.tenantCoOccupant.create({
      data: {
        dormitoryId: dormId,
        tenantId,
        name: 'สมใจ ร่วมพัก',
        phone: '0899999999',
      },
    });

    // Create cycle snapshot with 2 people
    await prisma.roomBillingCycleSnapshot.create({
      data: {
        dormitoryId: dormId,
        billingCycleId: cycleId,
        roomId,
        peopleCount: 2,
        source: 'tenant_co_occupant',
      },
    });

    // Create unpaid bill for 2 people (5680)
    const bill = await prisma.bill.create({
      data: {
        id: billId2,
        dormitoryId: dormId,
        billingCycleId: cycleId,
        roomId,
        tenantId,
        contractId,
        billNumber: 'INV-202609-002',
        status: 'unpaid',
        billingDate: new Date('2026-09-25'),
        dueDate: new Date('2026-10-05'),
        subtotal: 5680,
        discountAmount: 0,
        fineAmount: 0,
        totalAmount: 5680,
        paidAmount: 0,
        outstandingAmount: 5680,
      },
    });

    await prisma.billItem.createMany({
      data: [
        {
          dormitoryId: dormId,
          billId: bill.id,
          type: 'rent',
          description: 'ค่าเช่าห้องพัก',
          quantity: 1,
          unit: 'month',
          unitPrice: 5000,
          amount: 5000,
          displayOrder: 0,
        },
        {
          dormitoryId: dormId,
          billId: bill.id,
          type: 'water',
          description: 'ค่าน้ำประปา (2 คน)',
          quantity: 2,
          unit: 'person',
          unitPrice: 100,
          amount: 200,
          metadata: { mode: 'person', peopleCount: 2 },
          displayOrder: 1,
        },
        {
          dormitoryId: dormId,
          billId: bill.id,
          type: 'common_fee',
          description: 'ค่าส่วนกลาง (2 คน)',
          quantity: 2,
          unit: 'person',
          unitPrice: 200,
          amount: 400,
          metadata: { mode: 'person', peopleCount: 2 },
          displayOrder: 2,
        },
        {
          dormitoryId: dormId,
          billId: bill.id,
          type: 'electricity',
          description: 'ค่าไฟฟ้า (10.00 หน่วย)',
          quantity: 10,
          unit: 'unit',
          unitPrice: 8,
          amount: 80,
          displayOrder: 3,
        },
      ],
    });

    // Tenant removes co-occupant
    const removeResult = await billingOrchestrationService.removeTenantCoOccupant(
      dormId,
      tenantId,
      co.id,
      { userId: tenantUserId, isTenant: true }
    );

    expect(removeResult.peopleCount).toBe(1);
    expect(removeResult.prevPeopleCount).toBe(2);
    expect(removeResult.recalculation.recalculated).toBe(true);
    expect(Number(removeResult.recalculation.newTotalAmount)).toBe(5380);

    // Verify soft-deleted
    const coInDb = await prisma.tenantCoOccupant.findUnique({ where: { id: co.id } });
    expect(coInDb?.deletedAt).not.toBeNull();

    // Verify bill in DB
    const updatedBill = await prisma.bill.findUnique({ where: { id: bill.id } });
    expect(Number(updatedBill?.totalAmount)).toBe(5380);
    expect(Number(updatedBill?.outstandingAmount)).toBe(5380);
  });

  it('4. should keep paid bills immutable when tenant modifies co-occupants', async () => {
    // Create paid bill for 1 person (5380)
    const bill = await prisma.bill.create({
      data: {
        id: billIdPaid,
        dormitoryId: dormId,
        billingCycleId: cycleId,
        roomId,
        tenantId,
        contractId,
        billNumber: 'INV-202609-PAID',
        status: 'paid',
        billingDate: new Date('2026-09-25'),
        dueDate: new Date('2026-10-05'),
        subtotal: 5380,
        discountAmount: 0,
        fineAmount: 0,
        totalAmount: 5380,
        paidAmount: 5380,
        outstandingAmount: 0,
      },
    });

    // Create cycle snapshot for 1 person
    await prisma.roomBillingCycleSnapshot.create({
      data: {
        dormitoryId: dormId,
        billingCycleId: cycleId,
        roomId,
        peopleCount: 1,
        source: 'tenant_co_occupant',
      },
    });

    // Tenant adds co-occupant
    const addResult = await billingOrchestrationService.addTenantCoOccupant(
      dormId,
      tenantId,
      { name: 'สมใจ ร่วมพัก', phone: '0899999999' },
      { userId: tenantUserId, isTenant: true }
    );

    expect(addResult.peopleCount).toBe(2);
    expect(addResult.recalculation.recalculated).toBe(false);
    expect(addResult.recalculation.reason).toBe('PAID_OR_LOCKED');

    // Paid bill remains unchanged
    const billInDb = await prisma.bill.findUnique({ where: { id: bill.id } });
    expect(billInDb?.status).toBe('paid');
    expect(Number(billInDb?.totalAmount)).toBe(5380);
    expect(Number(billInDb?.paidAmount)).toBe(5380);

    // Current cycle snapshot remains untouched
    const snapshotInDb = await prisma.roomBillingCycleSnapshot.findUnique({
      where: {
        dormitory_billing_cycle_room_unique: {
          dormitoryId: dormId,
          billingCycleId: cycleId,
          roomId,
        },
      },
    });
    expect(snapshotInDb?.peopleCount).toBe(1);
  });

  it('5. Paid August cycle: Owner meter correction preserves August snapshot & seeds September cycle', async () => {
    const augCycleId = 'a0000000-0000-4000-8000-000000000051';

    // 1. Create August cycle (period: 2026-08-01 to 2026-08-31)
    await prisma.billingCycle.create({
      data: {
        id: augCycleId,
        dormitoryId: dormId,
        cycleCode: '2026-08-PAID-TEST',
        name: 'สิงหาคม 2569 ชำระแล้ว',
        periodStart: new Date('2026-08-01'),
        periodEnd: new Date('2026-08-31'),
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-05'),
        status: 'published',
      },
    });

    await prisma.billingRateSnapshot.create({
      data: {
        dormitoryId: dormId,
        billingCycleId: augCycleId,
        waterRate: 100,
        waterBillingType: 'person',
        electricityRate: 8,
        electricityBillingType: 'unit',
        commonFee: 200,
        commonFeeMode: 'person',
        internetFee: 0,
        internetFeeMode: 'room',
        parkingFee: 0,
        parkingFeeMode: 'free',
        lateFeeType: 'none',
        lateFeeValue: '0.00',
      },
    });

    // August snapshot: 1 person
    await prisma.roomBillingCycleSnapshot.create({
      data: {
        dormitoryId: dormId,
        billingCycleId: augCycleId,
        roomId,
        peopleCount: 1,
        source: 'HOUSEHOLD_SYNC',
      },
    });

    // August bill: PAID
    const augBill = await prisma.bill.create({
      data: {
        id: 'a0000000-0000-4000-8000-000000000053',
        dormitoryId: dormId,
        billingCycleId: augCycleId,
        roomId,
        tenantId,
        contractId,
        billNumber: 'INV-202608-PAID-IMMUTABLE',
        status: 'paid',
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-05'),
        subtotal: 5380,
        totalAmount: 5380,
        paidAmount: 5380,
        outstandingAmount: 0,
      },
    });

    await prisma.billItem.createMany({
      data: [
        {
          dormitoryId: dormId,
          billId: augBill.id,
          type: 'rent',
          description: 'ค่าเช่าห้องพัก',
          quantity: 1,
          unit: 'month',
          unitPrice: 5000,
          amount: 5000,
          displayOrder: 0,
        },
        {
          dormitoryId: dormId,
          billId: augBill.id,
          type: 'water',
          description: 'ค่าน้ำประปา (1 คน)',
          quantity: 1,
          unit: 'person',
          unitPrice: 100,
          amount: 100,
          metadata: { mode: 'person', peopleCount: 1 },
          displayOrder: 1,
        },
      ],
    });

    // 2. Owner corrects meter count on August cycle: 1 -> 2
    const correctResult = await billingOrchestrationService.correctMeterCyclePeopleCount(
      dormId,
      augCycleId,
      roomId,
      2,
      ownerUserId
    );

    expect(correctResult.appliedToCurrentCycle).toBe(false);
    expect(correctResult.appliesToNextCycle).toBe(true);
    expect(correctResult.reason).toBe('PAID_OR_LOCKED');
    expect(correctResult.peopleCount).toBe(1);

    // August snapshot MUST remain 1
    const augSnapshot = await prisma.roomBillingCycleSnapshot.findUnique({
      where: {
        dormitory_billing_cycle_room_unique: {
          dormitoryId: dormId,
          billingCycleId: augCycleId,
          roomId,
        },
      },
    });
    expect(augSnapshot?.peopleCount).toBe(1);

    // August bill MUST remain completely unchanged
    const checkAugBill = await prisma.bill.findUnique({
      where: { id: augBill.id },
      include: { items: true },
    });
    expect(checkAugBill?.status).toBe('paid');
    expect(Number(checkAugBill?.totalAmount)).toBe(5380);
    const augWaterItem = checkAugBill?.items.find((i) => i.type === 'water');
    expect(Number(augWaterItem?.quantity)).toBe(1);
    expect(Number(augWaterItem?.amount)).toBe(100);

    // September next-cycle (cycleId from beforeEach) snapshot resolves / seeds to 2
    const sepPeopleCount = await billingOrchestrationService.resolveCyclePeopleCount(
      dormId,
      cycleId,
      roomId,
      tenantId
    );
    expect(sepPeopleCount).toBe(2);

    const sepSnapshot = await prisma.roomBillingCycleSnapshot.findUnique({
      where: {
        dormitory_billing_cycle_room_unique: {
          dormitoryId: dormId,
          billingCycleId: cycleId,
          roomId,
        },
      },
    });
    expect(sepSnapshot?.peopleCount).toBe(2);
  });

  it('6. Rate snapshot fidelity: changing DormitoryBillingSettings does not affect old cycle bill recalculation', async () => {
    // 1. Create billing settings
    await prisma.dormitoryBillingSettings.upsert({
      where: { dormitoryId: dormId },
      create: {
        dormitoryId: dormId,
        dueDay: 5,
        waterBillingType: 'person',
        waterRate: 100,
        electricityBillingType: 'unit',
        electricityRate: 8,
        commonFee: 200,
        commonFeeMode: 'person',
        internetFee: 50,
        internetFeeMode: 'room',
        parkingRate: 100,
        parkingFeeMode: 'room',
        lateFeeType: 'daily',
        lateFeeValue: 50,
      },
      update: {
        waterBillingType: 'person',
        waterRate: 100,
        electricityBillingType: 'unit',
        electricityRate: 8,
        commonFee: 200,
        commonFeeMode: 'person',
      },
    });

    // 2. Cycle already has snapshot with waterRate=100, commonFee=200
    const bill = await prisma.bill.create({
      data: {
        id: 'a0000000-0000-4000-8000-000000000021',
        dormitoryId: dormId,
        billingCycleId: cycleId,
        roomId,
        tenantId,
        contractId,
        billNumber: 'INV-202609-FIDELITY',
        status: 'unpaid',
        billingDate: new Date('2026-09-25'),
        dueDate: new Date('2026-10-05'),
        subtotal: 5380,
        discountAmount: 0,
        fineAmount: 0,
        totalAmount: 5380,
        paidAmount: 0,
        outstandingAmount: 5380,
      },
    });

    await prisma.billItem.createMany({
      data: [
        {
          dormitoryId: dormId,
          billId: bill.id,
          type: 'rent',
          description: 'ค่าเช่าห้องพัก',
          quantity: 1,
          unit: 'month',
          unitPrice: 5000,
          amount: 5000,
          displayOrder: 0,
        },
        {
          dormitoryId: dormId,
          billId: bill.id,
          type: 'water',
          description: 'ค่าน้ำประปา (1 คน)',
          quantity: 1,
          unit: 'person',
          unitPrice: 100,
          amount: 100,
          metadata: { mode: 'person', peopleCount: 1 },
          displayOrder: 1,
        },
        {
          dormitoryId: dormId,
          billId: bill.id,
          type: 'common_fee',
          description: 'ค่าส่วนกลาง (1 คน)',
          quantity: 1,
          unit: 'person',
          unitPrice: 200,
          amount: 200,
          metadata: { mode: 'person', peopleCount: 1 },
          displayOrder: 2,
        },
        {
          dormitoryId: dormId,
          billId: bill.id,
          type: 'electricity',
          description: 'ค่าไฟฟ้า (10.00 หน่วย)',
          quantity: 10,
          unit: 'unit',
          unitPrice: 8,
          amount: 80,
          displayOrder: 3,
        },
      ],
    });

    // 3. Mutate live settings drastically (e.g. waterRate -> 999, commonFee -> 999)
    await prisma.dormitoryBillingSettings.update({
      where: { dormitoryId: dormId },
      data: {
        waterRate: 999,
        commonFee: 999,
      },
    });

    // 4. Recalculate bill for old cycle
    const result = await prisma.$transaction(async (tx) => {
      return await billingOrchestrationService.recalculateUnpaidBill(
        dormId,
        cycleId,
        roomId,
        2,
        1,
        tx
      );
    });

    expect(result.recalculated).toBe(true);
    // Uses old rate (100 * 2 = 200 for water, 200 * 2 = 400 for common fee) -> total = 5680, NOT 999 rates
    expect(Number(result.newTotalAmount)).toBe(5680);
  });

  it('7. Paid August bill -> September next cycle seeding proof', async () => {
    const augCycleId = 'a0000000-0000-4000-8000-000000000031';
    const sepCycleId = 'a0000000-0000-4000-8000-000000000032';

    // 1. Create August cycle (period: 2026-08-01 to 2026-08-31)
    await prisma.billingCycle.create({
      data: {
        id: augCycleId,
        dormitoryId: dormId,
        cycleCode: '2026-08',
        name: 'สิงหาคม 2569',
        periodStart: new Date('2026-08-01'),
        periodEnd: new Date('2026-08-31'),
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-05'),
        status: 'published',
      },
    });

    await prisma.billingRateSnapshot.create({
      data: {
        dormitoryId: dormId,
        billingCycleId: augCycleId,
        waterRate: 100,
        waterBillingType: 'person',
        electricityRate: 8,
        electricityBillingType: 'unit',
        commonFee: 200,
        commonFeeMode: 'person',
        internetFee: 0,
        internetFeeMode: 'room',
        parkingFee: 0,
        parkingFeeMode: 'free',
        lateFeeType: 'none',
        lateFeeValue: '0.00',
      },
    });

    // August snapshot: 1 person
    await prisma.roomBillingCycleSnapshot.create({
      data: {
        dormitoryId: dormId,
        billingCycleId: augCycleId,
        roomId,
        peopleCount: 1,
        source: 'HOUSEHOLD_SYNC',
      },
    });

    // August bill: paid
    const augBill = await prisma.bill.create({
      data: {
        id: 'a0000000-0000-4000-8000-000000000033',
        dormitoryId: dormId,
        billingCycleId: augCycleId,
        roomId,
        tenantId,
        contractId,
        billNumber: 'INV-202608-PAID',
        status: 'paid',
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-05'),
        subtotal: 5380,
        totalAmount: 5380,
        paidAmount: 5380,
        outstandingAmount: 0,
      },
    });

    // 2. Create September cycle (period: 2026-09-01 to 2026-09-30)
    await prisma.billingCycle.create({
      data: {
        id: sepCycleId,
        dormitoryId: dormId,
        cycleCode: '2026-09-NEXT',
        name: 'กันยายน 2569 งวดถัดไป',
        periodStart: new Date('2026-09-01'),
        periodEnd: new Date('2026-09-30'),
        billingDate: new Date('2026-09-25'),
        dueDate: new Date('2026-10-05'),
        status: 'draft',
      },
    });

    await prisma.billingRateSnapshot.create({
      data: {
        dormitoryId: dormId,
        billingCycleId: sepCycleId,
        waterRate: 100,
        waterBillingType: 'person',
        electricityRate: 8,
        electricityBillingType: 'unit',
        commonFee: 200,
        commonFeeMode: 'person',
        internetFee: 0,
        internetFeeMode: 'room',
        parkingFee: 0,
        parkingFeeMode: 'free',
        lateFeeType: 'none',
        lateFeeValue: '0.00',
      },
    });

    // 3. Tenant adds co-occupant (household truth = 2)
    const addResult = await billingOrchestrationService.addTenantCoOccupant(
      dormId,
      tenantId,
      { name: 'มานะ สุขใจ' },
      { userId: tenantUserId, isTenant: true }
    );
    expect(addResult.peopleCount).toBe(2);

    // August bill is paid -> August snapshot remains 1, August bill remains immutable
    const augSnapshot = await prisma.roomBillingCycleSnapshot.findUnique({
      where: {
        dormitory_billing_cycle_room_unique: {
          dormitoryId: dormId,
          billingCycleId: augCycleId,
          roomId,
        },
      },
    });
    expect(augSnapshot?.peopleCount).toBe(1);

    const checkAugBill = await prisma.bill.findUnique({ where: { id: augBill.id } });
    expect(Number(checkAugBill?.totalAmount)).toBe(5380);

    // 4. September next cycle resolves/seeds snapshot from household truth (2)
    const sepPeopleCount = await billingOrchestrationService.resolveCyclePeopleCount(
      dormId,
      sepCycleId,
      roomId,
      tenantId
    );
    expect(sepPeopleCount).toBe(2);

    const sepSnapshot = await prisma.roomBillingCycleSnapshot.findUnique({
      where: {
        dormitory_billing_cycle_room_unique: {
          dormitoryId: dormId,
          billingCycleId: sepCycleId,
          roomId,
        },
      },
    });
    expect(sepSnapshot?.peopleCount).toBe(2);
  });

  it('8. Reissue regression: old cancelled bill is ignored, only current unpaid bill recalculates', async () => {
    // 1. Create old cancelled bill
    const cancelledBill = await prisma.bill.create({
      data: {
        id: 'a0000000-0000-4000-8000-000000000041',
        dormitoryId: dormId,
        billingCycleId: cycleId,
        roomId,
        tenantId,
        contractId,
        billNumber: 'INV-202609-CANCELLED',
        status: 'cancelled',
        cancelledAt: new Date('2026-09-20'),
        cancellationReason: 'Reissued due to meter correction',
        billingDate: new Date('2026-09-15'),
        dueDate: new Date('2026-09-25'),
        subtotal: 1000,
        totalAmount: 1000,
        paidAmount: 0,
        outstandingAmount: 0,
        createdAt: new Date('2026-09-15'),
      },
    });

    // 2. Create current active unpaid bill
    const currentUnpaidBill = await prisma.bill.create({
      data: {
        id: 'a0000000-0000-4000-8000-000000000042',
        dormitoryId: dormId,
        billingCycleId: cycleId,
        roomId,
        tenantId,
        contractId,
        billNumber: 'INV-202609-ACTIVE',
        status: 'unpaid',
        billingDate: new Date('2026-09-25'),
        dueDate: new Date('2026-10-05'),
        subtotal: 5380,
        totalAmount: 5380,
        paidAmount: 0,
        outstandingAmount: 5380,
        createdAt: new Date('2026-09-25'),
      },
    });

    await prisma.billItem.createMany({
      data: [
        {
          dormitoryId: dormId,
          billId: currentUnpaidBill.id,
          type: 'rent',
          description: 'ค่าเช่าห้องพัก',
          quantity: 1,
          unit: 'month',
          unitPrice: 5000,
          amount: 5000,
          displayOrder: 0,
        },
        {
          dormitoryId: dormId,
          billId: currentUnpaidBill.id,
          type: 'water',
          description: 'ค่าน้ำประปา (1 คน)',
          quantity: 1,
          unit: 'person',
          unitPrice: 100,
          amount: 100,
          metadata: { mode: 'person', peopleCount: 1 },
          displayOrder: 1,
        },
        {
          dormitoryId: dormId,
          billId: currentUnpaidBill.id,
          type: 'common_fee',
          description: 'ค่าส่วนกลาง (1 คน)',
          quantity: 1,
          unit: 'person',
          unitPrice: 200,
          amount: 200,
          metadata: { mode: 'person', peopleCount: 1 },
          displayOrder: 2,
        },
      ],
    });

    // 3. Recalculate unpaid bill for 2 people
    const res = await prisma.$transaction(async (tx) => {
      return await billingOrchestrationService.recalculateUnpaidBill(
        dormId,
        cycleId,
        roomId,
        2,
        1,
        tx
      );
    });

    expect(res.recalculated).toBe(true);
    expect(res.billId).toBe(currentUnpaidBill.id);
    expect(Number(res.newTotalAmount)).toBe(5600); // 5000 + 200 + 400

    // Verify cancelled bill was untouched
    const checkCancelled = await prisma.bill.findUnique({ where: { id: cancelledBill.id } });
    expect(checkCancelled?.status).toBe('cancelled');
    expect(Number(checkCancelled?.totalAmount)).toBe(1000);
  });

  it('9. Real orchestration rollback proof: failure inside service transaction leaves state completely clean', async () => {
    // Initial unpaid bill & snapshot
    const rollbackBill = await prisma.bill.create({
      data: {
        id: 'a0000000-0000-4000-8000-000000000061',
        dormitoryId: dormId,
        billingCycleId: cycleId,
        roomId,
        tenantId,
        contractId,
        billNumber: 'INV-202609-ROLLBACK',
        status: 'unpaid',
        billingDate: new Date('2026-09-25'),
        dueDate: new Date('2026-10-05'),
        subtotal: 5380,
        totalAmount: 5380,
        paidAmount: 0,
        outstandingAmount: 5380,
      },
    });

    await prisma.billItem.createMany({
      data: [
        {
          dormitoryId: dormId,
          billId: rollbackBill.id,
          type: 'rent',
          description: 'ค่าเช่าห้องพัก',
          quantity: 1,
          unit: 'month',
          unitPrice: 5000,
          amount: 5000,
          displayOrder: 0,
        },
        {
          dormitoryId: dormId,
          billId: rollbackBill.id,
          type: 'water',
          description: 'ค่าน้ำประปา (1 คน)',
          quantity: 1,
          unit: 'person',
          unitPrice: 100,
          amount: 100,
          metadata: { mode: 'person', peopleCount: 1 },
          displayOrder: 1,
        },
      ],
    });

    const initialCoCount = await prisma.tenantCoOccupant.count({ where: { dormitoryId: dormId } });
    const initialOutboxCount = await prisma.localNotificationOutbox.count({ where: { dormitoryId: dormId } });

    // A. Injected failure during addTenantCoOccupant
    const serviceOutbox = (billingOrchestrationService as any).outboxService;
    const originalCreateOutbox = serviceOutbox.createOutboxEvent.bind(serviceOutbox);
    let injectedError = false;

    // Inject outbox failure inside transaction
    serviceOutbox.createOutboxEvent = async () => {
      throw new Error('SIMULATED_ORCHESTRATION_FAILURE');
    };

    try {
      await billingOrchestrationService.addTenantCoOccupant(
        dormId,
        tenantId,
        { name: 'คนที่จะ Rollback' },
        { userId: tenantUserId, isTenant: true }
      );
    } catch (err: any) {
      injectedError = true;
      expect(err.message).toBe('SIMULATED_ORCHESTRATION_FAILURE');
    } finally {
      serviceOutbox.createOutboxEvent = originalCreateOutbox;
    }

    expect(injectedError).toBe(true);

    // Verify atomic rollback
    const coCountAfter = await prisma.tenantCoOccupant.count({ where: { dormitoryId: dormId } });
    expect(coCountAfter).toBe(initialCoCount);

    const billAfter = await prisma.bill.findUnique({ where: { id: rollbackBill.id } });
    expect(Number(billAfter?.totalAmount)).toBe(5380);

    const outboxAfter = await prisma.localNotificationOutbox.count({ where: { dormitoryId: dormId } });
    expect(outboxAfter).toBe(initialOutboxCount);

    // B. Retry without failure succeeds cleanly
    const retryResult = await billingOrchestrationService.addTenantCoOccupant(
      dormId,
      tenantId,
      { name: 'คนที่จะ Rollback' },
      { userId: tenantUserId, isTenant: true }
    );
    expect(retryResult.peopleCount).toBe(2);

    const coCountFinal = await prisma.tenantCoOccupant.count({ where: { dormitoryId: dormId, deletedAt: null } });
    expect(coCountFinal).toBe(initialCoCount + 1);

    // C. Injected failure during removeTenantCoOccupant
    serviceOutbox.createOutboxEvent = async () => {
      throw new Error('SIMULATED_REMOVE_ORCHESTRATION_FAILURE');
    };

    let removeError = false;
    try {
      await billingOrchestrationService.removeTenantCoOccupant(
        dormId,
        tenantId,
        retryResult.coOccupant.id,
        { userId: tenantUserId, isTenant: true }
      );
    } catch (err: any) {
      removeError = true;
      expect(err.message).toBe('SIMULATED_REMOVE_ORCHESTRATION_FAILURE');
    } finally {
      serviceOutbox.createOutboxEvent = originalCreateOutbox;
    }

    expect(removeError).toBe(true);

    // Verify remove rollback: co-occupant deletedAt is STILL NULL
    const checkCo = await prisma.tenantCoOccupant.findUnique({ where: { id: retryResult.coOccupant.id } });
    expect(checkCo?.deletedAt).toBeNull();
    expect(checkCo?.status).toBe('active');
  });

  it('10. True PostgreSQL Concurrency: overlapping mutations serialize cleanly without lost updates', async () => {
    // Initial snapshot & unpaid bill
    const concBill = await prisma.bill.create({
      data: {
        id: 'a0000000-0000-4000-8000-000000000071',
        dormitoryId: dormId,
        billingCycleId: cycleId,
        roomId,
        tenantId,
        contractId,
        billNumber: 'INV-202609-CONC-TRUE',
        status: 'unpaid',
        billingDate: new Date('2026-09-25'),
        dueDate: new Date('2026-10-05'),
        subtotal: 5380,
        totalAmount: 5380,
        paidAmount: 0,
        outstandingAmount: 5380,
      },
    });

    await prisma.billItem.createMany({
      data: [
        {
          dormitoryId: dormId,
          billId: concBill.id,
          type: 'rent',
          description: 'ค่าเช่าห้องพัก',
          quantity: 1,
          unit: 'month',
          unitPrice: 5000,
          amount: 5000,
          displayOrder: 0,
        },
        {
          dormitoryId: dormId,
          billId: concBill.id,
          type: 'water',
          description: 'ค่าน้ำประปา (1 คน)',
          quantity: 1,
          unit: 'person',
          unitPrice: 100,
          amount: 100,
          metadata: { mode: 'person', peopleCount: 1 },
          displayOrder: 1,
        },
      ],
    });

    // Trigger 2 overlapping concurrent mutations
    const results = await Promise.allSettled([
      billingOrchestrationService.addTenantCoOccupant(
        dormId,
        tenantId,
        { name: 'ผู้พักร่วมพร้อมกัน คนที่ 1' },
        { userId: tenantUserId, isTenant: true }
      ),
      billingOrchestrationService.addTenantCoOccupant(
        dormId,
        tenantId,
        { name: 'ผู้พักร่วมพร้อมกัน คนที่ 2' },
        { userId: tenantUserId, isTenant: true }
      ),
    ]);

    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('fulfilled');

    // Final household state: exactly 2 active co-occupant rows added
    const coList = await prisma.tenantCoOccupant.findMany({
      where: { dormitoryId: dormId, tenantId, deletedAt: null, name: { contains: 'ผู้พักร่วมพร้อมกัน' } },
    });
    expect(coList.length).toBe(2);

    // Final snapshot: exactly 3 people (1 primary + 2 co-occupants)
    const snapshotInDb = await prisma.roomBillingCycleSnapshot.findUnique({
      where: {
        dormitory_billing_cycle_room_unique: {
          dormitoryId: dormId,
          billingCycleId: cycleId,
          roomId,
        },
      },
    });
    expect(snapshotInDb?.peopleCount).toBe(3);

    // Final authoritative bill: correctly recalculated for 3 people (5000 rent + 300 water = 5300)
    const billInDb = await prisma.bill.findUnique({
      where: { id: concBill.id },
      include: { items: true },
    });
    expect(Number(billInDb?.totalAmount)).toBe(5300);

    const waterItem = billInDb?.items.find((i) => i.type === 'water');
    expect(Number(waterItem?.quantity)).toBe(3);
    expect(Number(waterItem?.amount)).toBe(300);
  });

  it('11. Security: CSRF requirement and cross-tenant deletion isolation (IDOR protection)', async () => {
    const { createApp } = await import('../src/app.js');
    const { getEnv } = await import('../src/config/env.js');
    const { SessionTokenService } = await import('../src/services/session-token.service.js');
    const { CsrfService } = await import('../src/services/csrf.service.js');
    const supertest = (await import('supertest')).default;
    const app = createApp({ forcePrisma: true });

    const env = getEnv();
    const sessionTokenService = new SessionTokenService(env.SESSION_ENCRYPTION_KEY);
    const csrfService = new CsrfService(env.CSRF_SIGNING_KEY);

    const rawSessionId = '00000000-0000-4000-8000-000000000099';
    const sessionIdHash = SessionTokenService.hashSessionId(rawSessionId);

    // Create session for tenantUserId
    await prisma.session.create({
      data: {
        id: 'a0000000-0000-4000-8000-000000000098',
        userId: tenantUserId,
        sessionIdHash,
        tokenVersion: 1,
        status: 'active',
        expiresAt: new Date(Date.now() + 86400000),
      },
    });

    // Create tenant role and membership for tenantUserId
    const tenantRole = await prisma.role.create({
      data: {
        id: 'a0000000-0000-4000-8000-000000000097',
        dormitoryId: dormId,
        code: 'TENANT',
        name: 'Tenant',
        permissions: {},
        isSystem: true,
      },
    });

    await prisma.dormitoryMember.create({
      data: {
        dormitoryId: dormId,
        userId: tenantUserId,
        roleId: tenantRole.id,
        status: 'active',
      },
    });

    const sessionCookieVal = sessionTokenService.encryptToken({
      sub: tenantUserId,
      sid: rawSessionId,
      type: 'session',
      version: 1,
    }, 86400);
    const validCsrfToken = csrfService.generateCsrfToken(rawSessionId);

    // 1. Authenticated session without CSRF token -> 403 CSRF_TOKEN_REQUIRED
    const resNoCsrf = await supertest(app)
      .post('/api/v1/tenant-portal/co-occupants')
      .set('Cookie', [`horplus_session=${sessionCookieVal}`])
      .send({ name: 'คนใหม่' });
    expect(resNoCsrf.status).toBe(403);
    expect(resNoCsrf.body.error?.code).toBe('CSRF_TOKEN_REQUIRED');

    // 2. Authenticated session with invalid CSRF token -> 403 CSRF_TOKEN_INVALID
    const resBadCsrf = await supertest(app)
      .post('/api/v1/tenant-portal/co-occupants')
      .set('Cookie', [`horplus_session=${sessionCookieVal}`])
      .set('X-CSRF-Token', 'invalid-token-12345')
      .send({ name: 'คนใหม่' });
    expect(resBadCsrf.status).toBe(403);
    expect(resBadCsrf.body.error?.code).toBe('CSRF_TOKEN_INVALID');

    // 3. Authenticated session with valid CSRF token -> 201 Success
    const resValidCsrf = await supertest(app)
      .post('/api/v1/tenant-portal/co-occupants')
      .set('Cookie', [`horplus_session=${sessionCookieVal}`])
      .set('X-CSRF-Token', validCsrfToken)
      .send({ name: 'คนใหม่ที่ถูกต้อง' });
    expect(resValidCsrf.status).toBe(201);
    expect(resValidCsrf.body.success).toBe(true);
    expect(resValidCsrf.body.data.name).toBe('คนใหม่ที่ถูกต้อง');

    // 4. Create another tenant and co-occupant under different tenant
    const otherTenant = await prisma.tenant.create({
      data: {
        id: 'a0000000-0000-4000-8000-000000000099',
        dormitoryId: dormId,
        tenantNumber: 'TNT-L06-OTHER',
        displayName: 'ผู้เช่าห้องอื่น',
        firstName: 'ผู้เช่า',
        lastName: 'ห้องอื่น',
        phone: '0899990000',
        status: 'active',
      },
    });

    const otherCo = await prisma.tenantCoOccupant.create({
      data: {
        dormitoryId: dormId,
        tenantId: otherTenant.id,
        name: 'ผู้พักร่วมของห้องอื่น',
      },
    });

    // Attempting to delete other tenant's co-occupant via tenant portal API -> 404 CO_OCCUPANT_NOT_FOUND (IDOR protection)
    const resDeleteOther = await supertest(app)
      .delete(`/api/v1/tenant-portal/co-occupants/${otherCo.id}`)
      .set('Cookie', [`horplus_session=${sessionCookieVal}`])
      .set('X-CSRF-Token', validCsrfToken);
    expect(resDeleteOther.status).toBe(404);
    expect(resDeleteOther.body.error?.code).toBe('CO_OCCUPANT_NOT_FOUND');

    // Verify other tenant's co-occupant was NOT deleted in DB
    const checkOtherCo = await prisma.tenantCoOccupant.findUnique({ where: { id: otherCo.id } });
    expect(checkOtherCo?.deletedAt).toBeNull();
  }, 15000);

  it('12. Complete Per-Person Recalculation: all 5 per-person modes together (water, electricity, common_fee, internet, parking) scale exactly on add (1->2) and revert on remove (2->1)', async () => {
    // 1. Initial snapshot = 1
    await prisma.roomBillingCycleSnapshot.create({
      data: {
        dormitoryId: dormId,
        billingCycleId: cycleId,
        roomId,
        peopleCount: 1,
        source: 'HOUSEHOLD_SYNC',
      },
    });

    // 2. Bill with 1 fixed rent (5000) and 5 per-person items:
    // water (100), electricity (200), common_fee (150), internet (300), parking (500)
    // Initial Total = 5000 + 100 + 200 + 150 + 300 + 500 = 6250
    const bill = await prisma.bill.create({
      data: {
        id: 'a0000000-0000-4000-8000-000000000555',
        dormitoryId: dormId,
        billingCycleId: cycleId,
        roomId,
        tenantId,
        contractId,
        billNumber: 'INV-202609-ALL-5-MODES',
        status: 'unpaid',
        billingDate: new Date('2026-09-25'),
        dueDate: new Date('2026-10-05'),
        subtotal: 6250,
        totalAmount: 6250,
        paidAmount: 0,
        outstandingAmount: 6250,
      },
    });

    await prisma.billItem.createMany({
      data: [
        {
          dormitoryId: dormId,
          billId: bill.id,
          type: 'rent',
          description: 'ค่าเช่าห้องพัก',
          quantity: 1,
          unit: 'month',
          unitPrice: 5000,
          amount: 5000,
          displayOrder: 0,
        },
        {
          dormitoryId: dormId,
          billId: bill.id,
          type: 'water',
          description: 'ค่าน้ำประปา (1 คน)',
          quantity: 1,
          unit: 'person',
          unitPrice: 100,
          amount: 100,
          metadata: { mode: 'person', peopleCount: 1 },
          displayOrder: 1,
        },
        {
          dormitoryId: dormId,
          billId: bill.id,
          type: 'electricity',
          description: 'ค่าไฟฟ้า (1 คน)',
          quantity: 1,
          unit: 'person',
          unitPrice: 200,
          amount: 200,
          metadata: { mode: 'person', peopleCount: 1 },
          displayOrder: 2,
        },
        {
          dormitoryId: dormId,
          billId: bill.id,
          type: 'common_fee',
          description: 'ค่าส่วนกลาง (1 คน)',
          quantity: 1,
          unit: 'person',
          unitPrice: 150,
          amount: 150,
          metadata: { mode: 'person', peopleCount: 1 },
          displayOrder: 3,
        },
        {
          dormitoryId: dormId,
          billId: bill.id,
          type: 'internet',
          description: 'ค่าบริการอินเทอร์เน็ต (1 คน)',
          quantity: 1,
          unit: 'person',
          unitPrice: 300,
          amount: 300,
          metadata: { mode: 'person', peopleCount: 1 },
          displayOrder: 4,
        },
        {
          dormitoryId: dormId,
          billId: bill.id,
          type: 'parking',
          description: 'ค่าที่จอดรถ (1 คน)',
          quantity: 1,
          unit: 'person',
          unitPrice: 500,
          amount: 500,
          metadata: { mode: 'person', peopleCount: 1 },
          displayOrder: 5,
        },
      ],
    });

    // 3. Tenant adds co-occupant: 1 -> 2
    const addResult = await billingOrchestrationService.addTenantCoOccupant(
      dormId,
      tenantId,
      { name: 'ผู้พักร่วมคนที่ 1' },
      { userId: tenantUserId, isTenant: true }
    );
    expect(addResult.peopleCount).toBe(2);
    expect(addResult.recalculation.recalculated).toBe(true);

    // Expected New Total = 5000 + 200(water) + 400(elec) + 300(common) + 600(internet) + 1000(parking) = 7500
    expect(Number(addResult.recalculation.newTotalAmount)).toBe(7500);

    const billAfterAdd = await prisma.bill.findUnique({
      where: { id: bill.id },
      include: { items: { orderBy: { displayOrder: 'asc' } } },
    });
    expect(Number(billAfterAdd?.subtotal)).toBe(7500);
    expect(Number(billAfterAdd?.totalAmount)).toBe(7500);
    expect(Number(billAfterAdd?.outstandingAmount)).toBe(7500);

    // Verify each line item
    const rentItem = billAfterAdd?.items.find((i) => i.type === 'rent');
    expect(Number(rentItem?.quantity)).toBe(1);
    expect(Number(rentItem?.amount)).toBe(5000);

    const waterItem = billAfterAdd?.items.find((i) => i.type === 'water');
    expect(Number(waterItem?.quantity)).toBe(2);
    expect(Number(waterItem?.amount)).toBe(200);
    expect(waterItem?.description).toBe('ค่าน้ำประปา (2 คน)');

    const elecItem = billAfterAdd?.items.find((i) => i.type === 'electricity');
    expect(Number(elecItem?.quantity)).toBe(2);
    expect(Number(elecItem?.amount)).toBe(400);
    expect(elecItem?.description).toBe('ค่าไฟฟ้า (2 คน)');

    const commonItem = billAfterAdd?.items.find((i) => i.type === 'common_fee');
    expect(Number(commonItem?.quantity)).toBe(2);
    expect(Number(commonItem?.amount)).toBe(300);
    expect(commonItem?.description).toBe('ค่าส่วนกลาง (2 คน)');

    const internetItem = billAfterAdd?.items.find((i) => i.type === 'internet');
    expect(Number(internetItem?.quantity)).toBe(2);
    expect(Number(internetItem?.amount)).toBe(600);
    expect(internetItem?.description).toBe('ค่าบริการอินเทอร์เน็ต (2 คน)');

    const parkingItem = billAfterAdd?.items.find((i) => i.type === 'parking');
    expect(Number(parkingItem?.quantity)).toBe(2);
    expect(Number(parkingItem?.amount)).toBe(1000);
    expect(parkingItem?.description).toBe('ค่าที่จอดรถ (2 คน)');

    // 4. Tenant removes co-occupant: 2 -> 1
    const removeResult = await billingOrchestrationService.removeTenantCoOccupant(
      dormId,
      tenantId,
      addResult.coOccupant.id,
      { userId: tenantUserId, isTenant: true }
    );
    expect(removeResult.peopleCount).toBe(1);
    expect(removeResult.recalculation.recalculated).toBe(true);
    expect(Number(removeResult.recalculation.newTotalAmount)).toBe(6250);

    const billAfterRemove = await prisma.bill.findUnique({
      where: { id: bill.id },
      include: { items: { orderBy: { displayOrder: 'asc' } } },
    });
    expect(Number(billAfterRemove?.totalAmount)).toBe(6250);
    expect(Number(billAfterRemove?.items.find((i) => i.type === 'water')?.amount)).toBe(100);
    expect(Number(billAfterRemove?.items.find((i) => i.type === 'electricity')?.amount)).toBe(200);
    expect(Number(billAfterRemove?.items.find((i) => i.type === 'common_fee')?.amount)).toBe(150);
    expect(Number(billAfterRemove?.items.find((i) => i.type === 'internet')?.amount)).toBe(300);
    expect(Number(billAfterRemove?.items.find((i) => i.type === 'parking')?.amount)).toBe(500);
  });

  it('13. Paid August cycle without existing next cycle: Owner meter correction persists pending intent and seeds September cycle when created', async () => {
    const augCycleId = 'a0000000-0000-4000-8000-000000000881';
    const sepCycleId = 'a0000000-0000-4000-8000-000000000882';
    const octCycleId = 'a0000000-0000-4000-8000-000000000883';

    // Delete default cycleId so NO future cycle exists initially for this test
    await prisma.billItem.deleteMany({ where: { bill: { billingCycleId: cycleId } } });
    await prisma.bill.deleteMany({ where: { billingCycleId: cycleId } });
    await prisma.roomBillingCycleSnapshot.deleteMany({ where: { billingCycleId: cycleId } });
    await prisma.billingRateSnapshot.deleteMany({ where: { billingCycleId: cycleId } });
    await prisma.billingCycle.deleteMany({ where: { id: cycleId } });

    // 1. Create August cycle only (NO September cycle exists yet)
    await prisma.billingCycle.create({
      data: {
        id: augCycleId,
        dormitoryId: dormId,
        cycleCode: '2026-08-PAID-NO-NEXT',
        name: 'สิงหาคม 2569 ชำระแล้ว',
        periodStart: new Date('2026-08-01'),
        periodEnd: new Date('2026-08-31'),
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-05'),
        status: 'published',
      },
    });

    await prisma.billingRateSnapshot.create({
      data: {
        dormitoryId: dormId,
        billingCycleId: augCycleId,
        waterRate: 100,
        waterBillingType: 'person',
        electricityRate: 8,
        electricityBillingType: 'unit',
        commonFee: 200,
        commonFeeMode: 'person',
        internetFee: 0,
        internetFeeMode: 'room',
        parkingFee: 0,
        parkingFeeMode: 'free',
        lateFeeType: 'none',
        lateFeeValue: '0.00',
      },
    });

    // August snapshot: 1 person
    await prisma.roomBillingCycleSnapshot.create({
      data: {
        dormitoryId: dormId,
        billingCycleId: augCycleId,
        roomId,
        peopleCount: 1,
        source: 'HOUSEHOLD_SYNC',
      },
    });

    // August bill: PAID
    const augBill = await prisma.bill.create({
      data: {
        id: 'a0000000-0000-4000-8000-000000000884',
        dormitoryId: dormId,
        billingCycleId: augCycleId,
        roomId,
        tenantId,
        contractId,
        billNumber: 'INV-202608-PAID-NO-NEXT',
        status: 'paid',
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-05'),
        subtotal: 5300,
        totalAmount: 5300,
        paidAmount: 5300,
        outstandingAmount: 0,
      },
    });

    // 2. Owner corrects meter count on August cycle: 1 -> 2
    // (Note: September cycle does NOT exist yet in DB)
    const correctResult = await billingOrchestrationService.correctMeterCyclePeopleCount(
      dormId,
      augCycleId,
      roomId,
      2,
      ownerUserId
    );

    expect(correctResult.appliedToCurrentCycle).toBe(false);
    expect(correctResult.appliesToNextCycle).toBe(true);
    expect(correctResult.reason).toBe('PAID_OR_LOCKED');
    expect(correctResult.peopleCount).toBe(1);

    // August snapshot MUST remain 1
    const augSnapshot = await prisma.roomBillingCycleSnapshot.findUnique({
      where: {
        dormitory_billing_cycle_room_unique: {
          dormitoryId: dormId,
          billingCycleId: augCycleId,
          roomId,
        },
      },
    });
    expect(augSnapshot?.peopleCount).toBe(1);

    // August bill MUST remain paid and 5300
    const checkAugBill = await prisma.bill.findUnique({ where: { id: augBill.id } });
    expect(checkAugBill?.status).toBe('paid');
    expect(Number(checkAugBill?.totalAmount)).toBe(5300);

    // Persistent pending-next-cycle correction record exists with peopleCount = 2, source/effective boundary, and consumedAt = null
    const pendingCorrection = await prisma.roomNextCycleCorrection.findUnique({
      where: {
        dormitory_room_next_cycle_correction_unique: {
          dormitoryId: dormId,
          roomId,
        },
      },
    });
    expect(pendingCorrection).not.toBeNull();
    expect(pendingCorrection?.peopleCount).toBe(2);
    expect(pendingCorrection?.sourceBillingCycleId).toBe(augCycleId);
    expect(pendingCorrection?.effectiveAfterPeriodStart).not.toBeNull();
    expect(pendingCorrection?.consumedAt).toBeNull();

    // 3. Regression Test A: Resolve a July historical cycle with no snapshot
    const julyCycleId = 'a0000000-0000-4000-8000-000000000885';
    await prisma.billingCycle.create({
      data: {
        id: julyCycleId,
        dormitoryId: dormId,
        cycleCode: '2026-07-JULY',
        name: 'กรกฎาคม 2569',
        periodStart: new Date('2026-07-01'),
        periodEnd: new Date('2026-07-31'),
        billingDate: new Date('2026-07-25'),
        dueDate: new Date('2026-08-05'),
        status: 'completed',
      },
    });

    const julyPeopleCount = await billingOrchestrationService.resolveCyclePeopleCount(
      dormId,
      julyCycleId,
      roomId,
      tenantId
    );
    expect(julyPeopleCount).toBe(1); // Historical July uses normal/household truth (1)

    // Pending correction MUST remain unconsumed after July resolution
    const unconsumedAfterJuly = await prisma.roomNextCycleCorrection.findUnique({
      where: {
        dormitory_room_next_cycle_correction_unique: {
          dormitoryId: dormId,
          roomId,
        },
      },
    });
    expect(unconsumedAfterJuly?.consumedAt).toBeNull();

    // 4. Regression Test B: Resolve August source cycle again if snapshot were missing
    await prisma.roomBillingCycleSnapshot.deleteMany({
      where: {
        dormitoryId: dormId,
        billingCycleId: augCycleId,
        roomId,
      },
    });

    const augReResolveCount = await billingOrchestrationService.resolveCyclePeopleCount(
      dormId,
      augCycleId,
      roomId,
      tenantId
    );
    expect(augReResolveCount).toBe(1); // August source cycle must NOT consume future correction into itself

    // Pending correction MUST still remain unconsumed
    const unconsumedAfterAug = await prisma.roomNextCycleCorrection.findUnique({
      where: {
        dormitory_room_next_cycle_correction_unique: {
          dormitoryId: dormId,
          roomId,
        },
      },
    });
    expect(unconsumedAfterAug?.consumedAt).toBeNull();

    // 5. Mandatory Regression Test: Create BOTH September and October, and resolve October FIRST
    await prisma.billingCycle.createMany({
      data: [
        {
          id: sepCycleId,
          dormitoryId: dormId,
          cycleCode: '2026-09-LATER',
          name: 'กันยายน 2569 สร้างทีหลัง',
          periodStart: new Date('2026-09-01'),
          periodEnd: new Date('2026-09-30'),
          billingDate: new Date('2026-09-25'),
          dueDate: new Date('2026-10-05'),
          status: 'draft',
        },
        {
          id: octCycleId,
          dormitoryId: dormId,
          cycleCode: '2026-10-OCT',
          name: 'ตุลาคม 2569',
          periodStart: new Date('2026-10-01'),
          periodEnd: new Date('2026-10-31'),
          billingDate: new Date('2026-10-25'),
          dueDate: new Date('2026-11-05'),
          status: 'draft',
        },
      ],
    });

    // 5.1 Resolve October FIRST (do NOT resolve September first)
    const octPeopleCountFirst = await billingOrchestrationService.resolveCyclePeopleCount(
      dormId,
      octCycleId,
      roomId,
      tenantId
    );
    // October is NOT the immediate next cycle (September is earlier), so October does NOT consume correction
    expect(octPeopleCountFirst).toBe(1);

    const octSnapshotFirst = await prisma.roomBillingCycleSnapshot.findUnique({
      where: {
        dormitory_billing_cycle_room_unique: {
          dormitoryId: dormId,
          billingCycleId: octCycleId,
          roomId,
        },
      },
    });
    expect(octSnapshotFirst?.peopleCount).toBe(1);
    expect(octSnapshotFirst?.source).toBe('HOUSEHOLD_SYNC');

    // Pending correction MUST remain unconsumed after October resolution
    const unconsumedAfterOct = await prisma.roomNextCycleCorrection.findUnique({
      where: {
        dormitory_room_next_cycle_correction_unique: {
          dormitoryId: dormId,
          roomId,
        },
      },
    });
    expect(unconsumedAfterOct?.consumedAt).toBeNull();

    // 5.2 Then resolve September (the immediate next cycle)
    const sepPeopleCount = await billingOrchestrationService.resolveCyclePeopleCount(
      dormId,
      sepCycleId,
      roomId,
      tenantId
    );
    expect(sepPeopleCount).toBe(2);

    const sepSnapshot = await prisma.roomBillingCycleSnapshot.findUnique({
      where: {
        dormitory_billing_cycle_room_unique: {
          dormitoryId: dormId,
          billingCycleId: sepCycleId,
          roomId,
        },
      },
    });
    expect(sepSnapshot?.peopleCount).toBe(2);
    expect(sepSnapshot?.source).toBe('METER_CORRECTION');

    // Verify pending correction is now consumed (consumedAt is set)
    const consumedCorrection = await prisma.roomNextCycleCorrection.findUnique({
      where: {
        dormitory_room_next_cycle_correction_unique: {
          dormitoryId: dormId,
          roomId,
        },
      },
    });
    expect(consumedCorrection?.consumedAt).not.toBeNull();

    // 5.3 Subsequent November cycle created later should resolve to household truth (1) without leaking consumed correction
    const novCycleId = 'a0000000-0000-4000-8000-000000000886';
    await prisma.billingCycle.create({
      data: {
        id: novCycleId,
        dormitoryId: dormId,
        cycleCode: '2026-11-NOV',
        name: 'พฤศจิกายน 2569',
        periodStart: new Date('2026-11-01'),
        periodEnd: new Date('2026-11-30'),
        billingDate: new Date('2026-11-25'),
        dueDate: new Date('2026-12-05'),
        status: 'draft',
      },
    });

    const novPeopleCount = await billingOrchestrationService.resolveCyclePeopleCount(
      dormId,
      novCycleId,
      roomId,
      tenantId
    );
    expect(novPeopleCount).toBe(1); // Household truth is 1, consumed correction does not leak
  });
});
