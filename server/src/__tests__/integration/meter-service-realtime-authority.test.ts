import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getPrismaClient } from '../../db/prisma.js';
import { MeterService } from '../../services/meter.service.js';
import { PrismaMeterRepository } from '../../db/repositories/meter.repository.js';
import { PrismaBillingCycleRepository } from '../../db/repositories/billing-cycle.repository.js';
import { PrismaRoomRepository } from '../../db/repositories/room.repository.js';
import { PrismaBillRepository } from '../../db/repositories/bill.repository.js';

describe('MeterService: Product Owner Decision A Real-Time Authority Regression Tests', () => {
  const prisma = getPrismaClient();
  const meterRepo = new PrismaMeterRepository(prisma);
  const cycleRepo = new PrismaBillingCycleRepository(prisma);
  const roomRepo = new PrismaRoomRepository(prisma);
  const billRepo = new PrismaBillRepository(prisma);
  const meterService = new MeterService(meterRepo, cycleRepo, roomRepo, billRepo);

  const testUserId = crypto.randomUUID();
  const dormId = crypto.randomUUID();
  let bldId: string;
  let roomAId: string;
  let roomBId: string;
  let roomCId: string;
  let roomDId: string;
  let histCycleId: string;
  let futureCycleId: string;
  let currentCycleId: string;

  beforeAll(async () => {
    // 1. Create owner user
    const testEmail = `owner.rt.${Date.now()}@example.com`;
    await prisma.user.create({
      data: {
        id: testUserId,
        email: testEmail,
        emailNormalized: testEmail.toLowerCase(),
        name: 'Realtime Authority Owner',
        googleSubject: `sub-${Date.now()}`,
      },
    });

    // 2. Create dormitory
    await prisma.dormitory.create({
      data: {
        id: dormId,
        name: 'Realtime Authority Dormitory',
        createdByUserId: testUserId,
        billingSettings: {
          create: {
            billingDay: 25,
            dueDay: 15,
            waterBillingType: 'unit',
            waterRate: '18.00',
            electricityBillingType: 'unit',
            electricityRate: '8.00',
          },
        },
      },
    });

    // 3. Create building & rooms
    const bld = await prisma.building.create({
      data: {
        dormitoryId: dormId,
        name: 'Building RT',
        floorCount: 1,
      },
    });
    bldId = bld.id;

    const rA = await prisma.room.create({
      data: {
        dormitoryId: dormId,
        buildingId: bldId,
        roomNumber: 'RT-101',
        normalizedRoomNumber: 'RT-101',
        floor: 1,
        status: 'vacant',
        termDeposit: 0,
        monthlyDeposit: 0,
        dailyDeposit: 0,
      },
    });
    roomAId = rA.id;

    const rB = await prisma.room.create({
      data: {
        dormitoryId: dormId,
        buildingId: bldId,
        roomNumber: 'RT-102',
        normalizedRoomNumber: 'RT-102',
        floor: 1,
        status: 'vacant',
        termDeposit: 0,
        monthlyDeposit: 0,
        dailyDeposit: 0,
      },
    });
    roomBId = rB.id;

    const rC = await prisma.room.create({
      data: {
        dormitoryId: dormId,
        buildingId: bldId,
        roomNumber: 'RT-103',
        normalizedRoomNumber: 'RT-103',
        floor: 1,
        status: 'vacant',
        termDeposit: 0,
        monthlyDeposit: 0,
        dailyDeposit: 0,
      },
    });
    roomCId = rC.id;

    const rD = await prisma.room.create({
      data: {
        dormitoryId: dormId,
        buildingId: bldId,
        roomNumber: 'RT-104',
        normalizedRoomNumber: 'RT-104',
        floor: 1,
        status: 'vacant',
        termDeposit: 0,
        monthlyDeposit: 0,
        dailyDeposit: 0,
      },
    });
    roomDId = rD.id;

    // 4. Create Cycles
    const defaultSnapshotData = {
      dormitoryId: dormId,
      waterBillingType: 'unit',
      waterRate: '18.00',
      electricityBillingType: 'unit',
      electricityRate: '8.00',
      commonFee: '0.00',
      commonFeeMode: 'room',
      internetFee: '0.00',
      internetFeeMode: 'free',
      parkingFee: '0.00',
      parkingFeeMode: 'free',
      lateFeeType: 'none',
      lateFeeValue: '0.00',
      gracePeriodDays: 2,
      source: 'TEMPLATE_DEFAULT',
    };

    // Historical: 2025-01
    const histStart = new Date('2025-01-01T00:00:00.000+07:00');
    const histEnd = new Date('2025-01-31T23:59:59.000+07:00');
    const histCycle = await prisma.billingCycle.create({
      data: {
        dormitoryId: dormId,
        cycleCode: '2025-01',
        name: 'มกราคม 2025',
        periodStart: histStart,
        periodEnd: histEnd,
        billingDate: new Date('2025-01-25T00:00:00.000+07:00'),
        dueDate: new Date('2025-02-05T00:00:00.000+07:00'),
        status: 'closed',
        rateSnapshot: {
          create: { ...defaultSnapshotData },
        },
      },
    });
    histCycleId = histCycle.id;

    // Future: 2028-05
    const futStart = new Date('2028-05-01T00:00:00.000+07:00');
    const futEnd = new Date('2028-05-31T23:59:59.000+07:00');
    const futCycle = await prisma.billingCycle.create({
      data: {
        dormitoryId: dormId,
        cycleCode: '2028-05',
        name: 'พฤษภาคม 2028',
        periodStart: futStart,
        periodEnd: futEnd,
        billingDate: new Date('2028-05-25T00:00:00.000+07:00'),
        dueDate: new Date('2028-06-05T00:00:00.000+07:00'),
        status: 'draft',
        rateSnapshot: {
          create: { ...defaultSnapshotData },
        },
      },
    });
    futureCycleId = futCycle.id;

    // Current cycle covering real now
    const now = new Date();
    const currYear = now.getFullYear();
    const currMonth = now.getMonth() + 1;
    const currMonthStr = currMonth < 10 ? `0${currMonth}` : `${currMonth}`;
    const currCycleCode = `${currYear}-${currMonthStr}`;

    const existingCurrent = await prisma.billingCycle.findFirst({
      where: { dormitoryId: dormId, cycleCode: currCycleCode },
    });
    if (existingCurrent) {
      currentCycleId = existingCurrent.id;
    } else {
      const curStart = new Date(Date.UTC(currYear, currMonth - 1, 1));
      const curEnd = new Date(Date.UTC(currYear, currMonth, 0, 16, 59, 59));
      const curCycle = await prisma.billingCycle.create({
        data: {
          dormitoryId: dormId,
          cycleCode: currCycleCode,
          name: `${currCycleCode}`,
          periodStart: curStart,
          periodEnd: curEnd,
          billingDate: new Date(Date.UTC(currYear, currMonth - 1, 25)),
          dueDate: new Date(Date.UTC(currYear, currMonth, 5)),
          status: 'open',
          rateSnapshot: {
            create: { ...defaultSnapshotData },
          },
        },
      });
      currentCycleId = curCycle.id;
    }

    // 5. Seed Daily Stays
    // Room A: Historical settled stay in 2025-01
    const checkInA = new Date('2025-01-10T14:00:00+07:00');
    const checkOutA = new Date('2025-01-15T12:00:00+07:00');
    const dStayA = await prisma.dailyStay.create({
      data: {
        dormitoryId: dormId,
        roomId: roomAId,
        requestSource: 'OWNER',
        applicantFullName: 'คุณประวัติศาสตร์ ชำระแล้ว',
        applicantPhone: '081-111-1111',
        startDate: checkInA,
        endDate: checkOutA,
        checkInAt: checkInA,
        checkOutAt: checkOutA,
        actualCheckedOutAt: checkOutA,
        inclusiveDayCount: 5,
        dailyRateAmount: 500,
        totalRentAmount: 2500,
        depositAmount: 500,
        depositDeclaredStatus: 'PAID',
        status: 'COMPLETED',
      },
    });
    const invA = await prisma.dailyStayInvoice.create({
      data: {
        dormitoryId: dormId,
        dailyStayId: dStayA.id,
        invoiceNumber: `DINV-${Date.now()}-A`,
        totalRentAmount: 2500,
        depositAmount: 500,
        totalAgreedAmount: 3000,
        outstandingAmount: 0,
        status: 'SETTLED',
      },
    });
    await prisma.dailyStayInvoiceItem.createMany({
      data: [
        { invoiceId: invA.id, itemType: 'DAILY_RENT', amount: 2500, status: 'SETTLED', description: 'Rent A' },
        { invoiceId: invA.id, itemType: 'DEPOSIT', amount: 500, status: 'SETTLED', description: 'Deposit A' },
      ],
    });

    // Room B: Historical unpaid completed stay in 2025-01
    const checkInB = new Date('2025-01-20T14:00:00+07:00');
    const checkOutB = new Date('2025-01-25T12:00:00+07:00');
    const dStayB = await prisma.dailyStay.create({
      data: {
        dormitoryId: dormId,
        roomId: roomBId,
        requestSource: 'OWNER',
        applicantFullName: 'คุณประวัติศาสตร์ ค้างชำระ',
        applicantPhone: '082-222-2222',
        startDate: checkInB,
        endDate: checkOutB,
        checkInAt: checkInB,
        checkOutAt: checkOutB,
        actualCheckedOutAt: checkOutB,
        inclusiveDayCount: 5,
        dailyRateAmount: 500,
        totalRentAmount: 2500,
        depositAmount: 500,
        depositDeclaredStatus: 'UNPAID',
        status: 'COMPLETED',
      },
    });
    const invB = await prisma.dailyStayInvoice.create({
      data: {
        dormitoryId: dormId,
        dailyStayId: dStayB.id,
        invoiceNumber: `DINV-${Date.now()}-B`,
        totalRentAmount: 2500,
        depositAmount: 500,
        totalAgreedAmount: 3000,
        outstandingAmount: 3000,
        status: 'ISSUED',
      },
    });
    await prisma.dailyStayInvoiceItem.createMany({
      data: [
        { invoiceId: invB.id, itemType: 'DAILY_RENT', amount: 2500, status: 'OUTSTANDING', description: 'Rent B' },
        { invoiceId: invB.id, itemType: 'DEPOSIT', amount: 500, status: 'OUTSTANDING', description: 'Deposit B' },
      ],
    });

    // Room C: Future stay in 2028-05
    const checkInC = new Date('2028-05-10T14:00:00+07:00');
    const checkOutC = new Date('2028-05-15T12:00:00+07:00');
    await prisma.dailyStay.create({
      data: {
        dormitoryId: dormId,
        roomId: roomCId,
        requestSource: 'OWNER',
        applicantFullName: 'คุณอนาคต จองล่วงหน้า',
        applicantPhone: '083-333-3333',
        startDate: checkInC,
        endDate: checkOutC,
        checkInAt: checkInC,
        checkOutAt: checkOutC,
        inclusiveDayCount: 5,
        dailyRateAmount: 600,
        totalRentAmount: 3000,
        depositAmount: 500,
        depositDeclaredStatus: 'PAID',
        status: 'RESERVED',
      },
    });

    // Room D: Currently active stay (checkIn = yesterday, checkOut = in 2 days)
    const checkInD = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const checkOutD = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    await prisma.dailyStay.create({
      data: {
        dormitoryId: dormId,
        roomId: roomDId,
        requestSource: 'OWNER',
        applicantFullName: 'คุณปัจจุบัน พักอยู่จริง',
        applicantPhone: '084-444-4444',
        startDate: checkInD,
        endDate: checkOutD,
        checkInAt: checkInD,
        checkOutAt: checkOutD,
        inclusiveDayCount: 3,
        dailyRateAmount: 500,
        totalRentAmount: 1500,
        depositAmount: 500,
        depositDeclaredStatus: 'PAID',
        status: 'ACTIVE',
      },
    });
  });

  afterAll(async () => {
    await prisma.dailyStayInvoiceItem.deleteMany({
      where: { invoice: { dormitoryId: dormId } },
    });
    await prisma.dailyStayInvoice.deleteMany({
      where: { dormitoryId: dormId },
    });
    await prisma.dailyStay.deleteMany({
      where: { dormitoryId: dormId },
    });
    await prisma.room.deleteMany({
      where: { dormitoryId: dormId },
    });
    await prisma.building.deleteMany({
      where: { dormitoryId: dormId },
    });
    await prisma.billingRateSnapshot.deleteMany({
      where: { dormitoryId: dormId },
    });
    await prisma.billingCycle.deleteMany({
      where: { dormitoryId: dormId },
    });
    await prisma.dormitoryBillingSettings.deleteMany({
      where: { dormitoryId: dormId },
    });
    await prisma.dormitory.deleteMany({
      where: { id: dormId },
    });
    await prisma.user.deleteMany({
      where: { id: testUserId },
    });
  });

  it('Test A: Historical cycle: stay belongs to cycle history, isDailyActive = false, persisted PAID/SETTLED remains paid', async () => {
    const preview = await meterService.getMeterBillingPreviewContext(dormId, histCycleId);
    const rA = preview.rooms.find((r) => r.roomId === roomAId);

    expect(rA).toBeDefined();
    expect(rA?.billingSource).toBe('DAILY_STAY');
    expect(rA?.tenantName).toBe('คุณประวัติศาสตร์ ชำระแล้ว');
    // Real time check: today is after checkout in 2025
    expect(rA?.isDailyActive).toBe(false);
    expect(rA?.isDailyRentPaid).toBe(true);
    expect(rA?.isDailyOverdue).toBe(false);
    expect(rA?.agreementRentPaymentStatus).toBe('PAID');
    expect(rA?.agreementDepositPaymentStatus).toBe('PAID');
  });

  it('Test B: Historical unpaid completed stay: historical stay remains visible, overdue/unpaid derived from real dates/status, no fake active state', async () => {
    const preview = await meterService.getMeterBillingPreviewContext(dormId, histCycleId);
    const rB = preview.rooms.find((r) => r.roomId === roomBId);

    expect(rB).toBeDefined();
    expect(rB?.billingSource).toBe('DAILY_STAY');
    expect(rB?.tenantName).toBe('คุณประวัติศาสตร์ ค้างชำระ');
    // Real time check: today is after checkout in 2025, and unpaid -> overdue = true, active = false
    expect(rB?.isDailyActive).toBe(false);
    expect(rB?.isDailyUnpaid).toBe(true);
    expect(rB?.isDailyOverdue).toBe(true);
    expect(rB?.agreementRentPaymentStatus).toBe('UNPAID');
    expect(rB?.agreementDepositPaymentStatus).toBe('UNPAID');
  });

  it('Test C: Future cycle: stay is scheduled in future -> not currently active', async () => {
    const preview = await meterService.getMeterBillingPreviewContext(dormId, futureCycleId);
    const rC = preview.rooms.find((r) => r.roomId === roomCId);

    expect(rC).toBeDefined();
    // In future cycle, stay is in future -> real now is before check-in -> isDailyActive must be false
    expect(rC?.isDailyActive).toBe(false);
  });

  it('Test D: Current stay: actual now is between check-in and checkout -> active', async () => {
    const preview = await meterService.getMeterBillingPreviewContext(dormId, currentCycleId);
    const rD = preview.rooms.find((r) => r.roomId === roomDId);

    expect(rD).toBeDefined();
    expect(rD?.billingSource).toBe('DAILY_STAY');
    expect(rD?.tenantName).toBe('คุณปัจจุบัน พักอยู่จริง');
    // Real now is between checkIn and checkOut -> isDailyActive must be true!
    expect(rD?.isDailyActive).toBe(true);
    expect(rD?.isDailyOverdue).toBe(false);
  });

  it('Test E: Assert no code path in server/src uses cycleEnd - 2 days or evalNow as production "now"', () => {
    const serverSrcDir = path.resolve(__dirname, '../../');
    const meterServiceCode = fs.readFileSync(path.join(serverSrcDir, 'services/meter.service.ts'), 'utf-8');

    expect(meterServiceCode).not.toContain('evalNow');
    expect(meterServiceCode).not.toContain('cycleEnd - 2 days');
    expect(meterServiceCode).not.toContain('cycleEnd.getTime() - 2 * 24 * 60 * 60 * 1000');
  });
});
