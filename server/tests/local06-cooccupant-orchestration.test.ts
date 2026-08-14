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

  it('5. should allow owner meter peopleCount correction without altering named co-occupants list', async () => {
    // Create unpaid bill for 1 person (5380)
    const bill = await prisma.bill.create({
      data: {
        id: billId3,
        dormitoryId: dormId,
        billingCycleId: cycleId,
        roomId,
        tenantId,
        contractId,
        billNumber: 'INV-202609-003',
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

    // Owner corrects meter count to 3
    const correctResult = await billingOrchestrationService.correctMeterCyclePeopleCount(
      dormId,
      cycleId,
      roomId,
      3,
      ownerUserId
    );

    expect(correctResult.peopleCount).toBe(3);
    expect(correctResult.prevPeopleCount).toBe(1);
    expect(correctResult.recalculation.recalculated).toBe(true);
    expect(Number(correctResult.recalculation.newTotalAmount)).toBe(5980); // 5000 + 300 (water) + 600 (common) + 80 (elec)

    // Verify snapshot in DB has source 'meter_correction'
    const snapshot = await prisma.roomBillingCycleSnapshot.findUnique({
      where: {
        dormitory_billing_cycle_room_unique: {
          dormitoryId: dormId,
          billingCycleId: cycleId,
          roomId,
        },
      },
    });
    expect(snapshot?.peopleCount).toBe(3);
    expect(snapshot?.source).toBe('METER_CORRECTION');

    // Verify named co-occupants list was NOT created/invented
    const coOccupants = await prisma.tenantCoOccupant.findMany({
      where: { dormitoryId: dormId, tenantId, deletedAt: null },
    });
    expect(coOccupants.length).toBe(0);

    // Verify Tenant notification in outbox
    const tenantOutbox = await prisma.localNotificationOutbox.findMany({
      where: { dormitoryId: dormId, recipientType: 'TENANT' },
    });
    expect(tenantOutbox.length).toBeGreaterThanOrEqual(1);

    // Process outbox and check in-app tenant notice created
    await outboxService.processPendingOutboxEvents();
    const tenantNotices = await prisma.tenantNotice.findMany({
      where: { dormitoryId: dormId, tenantId },
    });
    expect(tenantNotices.length).toBeGreaterThanOrEqual(1);
    expect(tenantNotices.some((n) => n.title.includes('ปรับปรุงจำนวนคน') || n.title.includes('คำนวณใหม่'))).toBe(true);
  });
});
