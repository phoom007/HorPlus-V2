import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPrismaClient } from '../../db/prisma.js';
import { ReceiptService } from '../../services/receipt.service.js';
import { DailyStayService } from '../../services/daily-stay.service.js';

describe('Owner Round 2.4I.1 / A1: Final Receipt Authority & Daily Stay Invoice Receipt Relation', () => {
  const prisma = getPrismaClient();
  const receiptService = new ReceiptService();
  const dailyStayService = new DailyStayService(prisma);

  let dormitoryId: string;
  let ownerUserId: string;
  let roomId: string;
  let dailyStayId: string;
  let dailyStayInvoiceId: string;
  let billId: string;

  beforeAll(async () => {
    // 1. Create Owner User
    const ownerEmail = `owner-24i1-${Date.now()}@example.com`;
    const ownerUser = await prisma.user.create({
      data: {
        googleSubject: `sub-owner-24i1-${Date.now()}`,
        email: ownerEmail,
        emailNormalized: ownerEmail.toLowerCase(),
        name: 'เจ้าของหอพัก 2.4I.1',
      },
    });
    ownerUserId = ownerUser.id;

    // 2. Create Dormitory
    const dorm = await prisma.dormitory.create({
      data: {
        name: `หอพักทดสอบ 2.4I.1 ${Date.now()}`,
        status: 'active',
      },
    });
    dormitoryId = dorm.id;

    // 3. Create Building & Room
    const bld = await prisma.building.create({
      data: {
        dormitoryId,
        name: 'อาคาร A',
        code: 'A',
      },
    });

    const room = await prisma.room.create({
      data: {
        dormitoryId,
        buildingId: bld.id,
        roomNumber: '104',
        normalizedRoomNumber: '104',
        floor: 1,
        roomType: 'standard',
        status: 'occupied',
        monthlyRent: 4500.0,
        termRent: 22500.0,
        termMonths: 5,
        dailyRent: 800.0,
        depositAmount: 500.0,
        monthlyDeposit: 500.0,
        termDeposit: 500.0,
        dailyDeposit: 300.0,
      },
    });
    roomId = room.id;

    // 4. Create Daily Stay & Daily Stay Invoice via Service
    const dailyStayResult = await dailyStayService.ownerQuickAddDailyStay(
      dormitoryId,
      {
        roomId,
        fullName: 'คุณทดสอบ รายวัน',
        phone: '081-999-8888',
        startDate: '2026-09-01',
        endDate: '2026-09-04',
        dailyRateAmount: 800.0,
        depositAmount: 300.0,
        depositDeclaredStatus: 'PAID',
      },
      ownerUserId
    );
    dailyStayId = dailyStayResult.id;
    dailyStayInvoiceId = dailyStayResult.invoice.id;
  });

  afterAll(async () => {
    await prisma.receipt.deleteMany({ where: { dormitoryId } });
    await prisma.dailyStayInvoiceItem.deleteMany({ where: { invoice: { dormitoryId } } });
    await prisma.dailyStayInvoice.deleteMany({ where: { dormitoryId } });
    await prisma.dailyStay.deleteMany({ where: { dormitoryId } });
    await prisma.room.deleteMany({ where: { dormitoryId } });
    await prisma.building.deleteMany({ where: { dormitoryId } });
    await prisma.dormitory.deleteMany({ where: { id: dormitoryId } });
    await prisma.user.deleteMany({ where: { id: ownerUserId } });
  });

  it('1. Receipt model persists dailyStayInvoiceId and links to DailyStayInvoice', async () => {
    const receipt = await prisma.receipt.create({
      data: {
        dormitoryId,
        dailyStayInvoiceId,
        receiptNumber: `RC-202609-104-${Date.now().toString().slice(-4)}`,
        snapshotData: {
          receiptNumber: `RC-202609-104-0001`,
          roomNumber: '104',
          tenantName: 'คุณทดสอบ รายวัน',
          total: '2700.00',
          paymentMethod: 'CASH',
          items: [
            { description: 'ค่าเช่าห้องพักรายวัน (3 วัน)', amount: 2400 },
            { description: 'เงินประกันห้องพัก', amount: 300 },
          ],
        },
      },
      include: {
        dailyStayInvoice: {
          include: {
            dailyStay: true,
          },
        },
      },
    });

    expect(receipt).toBeDefined();
    expect(receipt.dailyStayInvoiceId).toBe(dailyStayInvoiceId);
    expect(receipt.dailyStayInvoice?.dailyStay?.applicantFullName).toBe('คุณทดสอบ รายวัน');
  });

  it('2. ReceiptService.getReceipt resolves receipt with dailyStayInvoice relation', async () => {
    const rcpt = await prisma.receipt.findFirst({
      where: { dailyStayInvoiceId },
    });
    expect(rcpt).not.toBeNull();

    const result = await receiptService.getReceipt(dormitoryId, rcpt!.id);
    expect(result).toBeDefined();
    expect(result.dailyStayInvoice).toBeDefined();
    expect(result.dailyStayInvoice?.id).toBe(dailyStayInvoiceId);
  });

  it('3. Invariant: 1 Daily Stay Invoice resolves to exactly 1 Final Receipt', async () => {
    const count = await prisma.receipt.count({
      where: {
        dormitoryId,
        dailyStayInvoiceId,
        isVoided: false,
      },
    });
    expect(count).toBe(1);
  });
});
