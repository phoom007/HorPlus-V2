import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPrismaClient } from '../../db/prisma.js';
import { DailyStayService } from '../../services/daily-stay.service.js';

describe('Owner Round 2.4H.1: Service-Level Daily Stay Invoice Classification & Zero-Settlement Invariants', () => {
  const prisma = getPrismaClient();
  let dailyStayService: DailyStayService;

  let ownerUserId: string;
  let dormitoryId: string;
  let buildingId: string;
  let roomAId: string;
  let roomBId: string;
  let roomCId: string;
  let roomDId: string;
  let roomEId: string;
  let roomFId: string;
  let room24H2_AId: string;
  let room24H2_BId: string;
  let room24H2_CId: string;
  let room24H2_DId: string;
  let createRoom: (roomNum: string, dailyRent?: number) => Promise<string>;

  const getBangkokDate = (offsetDays: number = 0) => {
    return new Date(Date.now() + 7 * 3600 * 1000 + offsetDays * 86400000).toISOString().slice(0, 10);
  };

  beforeAll(async () => {
    dailyStayService = new DailyStayService(prisma);

    // 1. Create Owner User
    const ownerEmail = `owner-24h1-${Date.now()}@example.com`;
    const ownerUser = await prisma.user.create({
      data: {
        googleSubject: `sub-owner-24h1-${Date.now()}`,
        email: ownerEmail,
        emailNormalized: ownerEmail.toLowerCase(),
        name: 'เจ้าของหอพัก 24H1',
      },
    });
    ownerUserId = ownerUser.id;

    // 2. Create Dormitory with FREE plan
    const dorm = await prisma.dormitory.create({
      data: {
        name: `หอพักทดสอบ 24H1 ${Date.now()}`,
        status: 'active',
      },
    });
    dormitoryId = dorm.id;

    // 3. Create Role OWNER and Link
    const ownerRole = await prisma.role.create({
      data: {
        dormitoryId,
        code: 'OWNER',
        name: 'เจ้าของหอพัก',
        permissions: ['rooms:read', 'rooms:write', 'bills:read', 'bills:write'],
        isSystem: true,
      },
    });

    await prisma.dormitoryMember.create({
      data: {
        userId: ownerUserId,
        dormitoryId,
        roleId: ownerRole.id,
        status: 'active',
        membershipOrigin: 'MANUAL_GRANT',
      },
    });

    // 4. Create Building
    const building = await prisma.building.create({
      data: {
        dormitoryId,
        code: 'B24H1',
        name: 'อาคาร 24H1',
        floorCount: 2,
        roomsPerFloor: 10,
        monthlyRent: 4000.0,
        dailyRent: 800.0,
        depositAmount: 500.0,
      },
    });
    buildingId = building.id;

    // 5. Room creation helper
    createRoom = async (roomNum: string, dailyRent: number = 800.0) => {
      return (
        await prisma.room.create({
          data: {
            dormitoryId,
            buildingId,
            roomNumber: roomNum,
            normalizedRoomNumber: roomNum.toLowerCase(),
            floor: 1,
            roomType: 'standard',
            status: 'vacant',
            monthlyRent: 4000.0,
            termRent: 20000.0,
            termMonths: 5,
            dailyRent,
            depositAmount: 500.0,
            monthlyDeposit: 0.0,
            termDeposit: 0.0,
            dailyDeposit: 500.0,
          },
        })
      ).id;
    };

    roomAId = await createRoom(`24H1-A-${Date.now() % 10000}`);
    roomBId = await createRoom(`24H1-B-${Date.now() % 10000}`);
    roomCId = await createRoom(`24H1-C-${Date.now() % 10000}`);
    roomDId = await createRoom(`24H1-D-${Date.now() % 10000}`);
    roomEId = await createRoom(`24H1-E-${Date.now() % 10000}`, 800.0);
    roomFId = await createRoom(`24H1-F-${Date.now() % 10000}`, 0.0);

    room24H2_AId = await createRoom(`24H2-A-${Date.now() % 10000}`, 800.0);
    room24H2_BId = await createRoom(`24H2-B-${Date.now() % 10000}`, 0.0);
    room24H2_CId = await createRoom(`24H2-C-${Date.now() % 10000}`, 800.0);
    room24H2_DId = await createRoom(`24H2-D-${Date.now() % 10000}`, 800.0);
  });

  afterAll(async () => {
    // Cleanup records safely
    await prisma.receipt.deleteMany({ where: { dormitoryId } });
    await prisma.receiptSequence.deleteMany({ where: { dormitoryId } });
    await prisma.dailyStayInvoiceItem.deleteMany({ where: { invoice: { dormitoryId } } });
    await prisma.dailyStayInvoice.deleteMany({ where: { dormitoryId } });
    await prisma.dailyStay.deleteMany({ where: { dormitoryId } });
    await prisma.occupancy.deleteMany({ where: { dormitoryId } });
    await prisma.tenant.deleteMany({ where: { dormitoryId } });
    await prisma.room.deleteMany({ where: { dormitoryId } });
    await prisma.building.deleteMany({ where: { dormitoryId } });
    await prisma.dormitoryMember.deleteMany({ where: { dormitoryId } });
    await prisma.role.deleteMany({ where: { dormitoryId } });
    await prisma.dormitory.deleteMany({ where: { id: dormitoryId } });
    await prisma.user.deleteMany({ where: { id: ownerUserId } });
  });

  it('Case A: DAILY_RENT = 800, DEPOSIT = 0, no payment → invoice ISSUED, outstanding=800, NOT PARTIALLY_PAID', async () => {
    const today = getBangkokDate(0);
    const tomorrow = getBangkokDate(1);

    const result = await dailyStayService.ownerQuickAddDailyStay(
      dormitoryId,
      {
        roomId: roomAId,
        fullName: 'นายทดสอบ เคสเอ',
        phone: '081-111-2222',
        startDate: today,
        endDate: tomorrow,
        dailyRateAmount: 800.0,
        depositAmount: 0.0,
        depositDeclaredStatus: 'UNPAID',
      },
      ownerUserId
    );

    expect(result.invoice).toBeDefined();
    expect(result.invoice.status).toBe('ISSUED'); // Strictly ISSUED, NOT PARTIALLY_PAID!
    expect(Number(result.invoice.totalAgreedAmount)).toBe(800.0);
    expect(Number(result.invoice.outstandingAmount)).toBe(800.0);

    const items = await prisma.dailyStayInvoiceItem.findMany({
      where: { invoiceId: result.invoice.id },
      orderBy: { itemType: 'asc' },
    });

    const rentItem = items.find((i) => i.itemType === 'DAILY_RENT');
    const depositItem = items.find((i) => i.itemType === 'DEPOSIT');

    expect(rentItem).toBeDefined();
    expect(rentItem?.status).toBe('OUTSTANDING');
    expect(Number(rentItem?.amount)).toBe(800.0);
    expect(rentItem?.paidAt).toBeNull();

    expect(depositItem).toBeDefined();
    expect(depositItem?.status).toBe('SETTLED');
    expect(Number(depositItem?.amount)).toBe(0.0);
    expect(depositItem?.paidAt).toBeNull(); // No fake paidAt!
  });

  it('Case B: DAILY_RENT = 0, DEPOSIT = 500 unpaid → invoice ISSUED, outstanding=500', async () => {
    const today = getBangkokDate(0);
    const tomorrow = getBangkokDate(1);

    const result = await dailyStayService.ownerQuickAddDailyStay(
      dormitoryId,
      {
        roomId: roomBId,
        fullName: 'นายทดสอบ เคสบี',
        phone: '082-222-3333',
        startDate: today,
        endDate: tomorrow,
        dailyRateAmount: 0.0,
        depositAmount: 500.0,
        depositDeclaredStatus: 'UNPAID',
      },
      ownerUserId
    );

    expect(result.invoice).toBeDefined();
    expect(result.invoice.status).toBe('ISSUED');
    expect(Number(result.invoice.totalAgreedAmount)).toBe(500.0);
    expect(Number(result.invoice.outstandingAmount)).toBe(500.0);

    const items = await prisma.dailyStayInvoiceItem.findMany({
      where: { invoiceId: result.invoice.id },
    });

    const rentItem = items.find((i) => i.itemType === 'DAILY_RENT');
    const depositItem = items.find((i) => i.itemType === 'DEPOSIT');

    expect(rentItem?.status).toBe('SETTLED');
    expect(Number(rentItem?.amount)).toBe(0.0);
    expect(rentItem?.paidAt).toBeNull(); // No fake paidAt!

    expect(depositItem?.status).toBe('OUTSTANDING');
    expect(Number(depositItem?.amount)).toBe(500.0);
    expect(depositItem?.paidAt).toBeNull();
  });

  it('Case C: DAILY_RENT = 800, DEPOSIT = 500 DECLARED_PAID → invoice PARTIALLY_PAID, outstanding=800', async () => {
    const today = getBangkokDate(0);
    const tomorrow = getBangkokDate(1);

    const result = await dailyStayService.ownerQuickAddDailyStay(
      dormitoryId,
      {
        roomId: roomCId,
        fullName: 'นายทดสอบ เคสซี',
        phone: '083-333-4444',
        startDate: today,
        endDate: tomorrow,
        dailyRateAmount: 800.0,
        depositAmount: 500.0,
        depositDeclaredStatus: 'PAID', // Positive deposit genuinely declared paid!
      },
      ownerUserId
    );

    expect(result.invoice).toBeDefined();
    expect(result.invoice.status).toBe('PARTIALLY_PAID');
    expect(Number(result.invoice.totalAgreedAmount)).toBe(1300.0);
    expect(Number(result.invoice.outstandingAmount)).toBe(800.0); // Only rent remaining

    const items = await prisma.dailyStayInvoiceItem.findMany({
      where: { invoiceId: result.invoice.id },
    });

    const rentItem = items.find((i) => i.itemType === 'DAILY_RENT');
    const depositItem = items.find((i) => i.itemType === 'DEPOSIT');

    expect(rentItem?.status).toBe('OUTSTANDING');
    expect(Number(rentItem?.amount)).toBe(800.0);

    expect(depositItem?.status).toBe('DECLARED_PAID');
    expect(Number(depositItem?.amount)).toBe(500.0);
    expect(depositItem?.paidAt).not.toBeNull(); // Genuinely declared paid
  });

  it('Case D: DAILY_RENT = 0, DEPOSIT = 0 → invoice PAID, outstanding=0, no fake Payment/Receipt/paidAt', async () => {
    const today = getBangkokDate(0);
    const tomorrow = getBangkokDate(1);

    const result = await dailyStayService.ownerQuickAddDailyStay(
      dormitoryId,
      {
        roomId: roomDId,
        fullName: 'นายทดสอบ เคสดี',
        phone: '084-444-5555',
        startDate: today,
        endDate: tomorrow,
        dailyRateAmount: 0.0,
        depositAmount: 0.0,
      },
      ownerUserId
    );

    expect(result.invoice).toBeDefined();
    expect(result.invoice.status).toBe('PAID');
    expect(Number(result.invoice.totalAgreedAmount)).toBe(0.0);
    expect(Number(result.invoice.outstandingAmount)).toBe(0.0);

    const items = await prisma.dailyStayInvoiceItem.findMany({
      where: { invoiceId: result.invoice.id },
    });

    const rentItem = items.find((i) => i.itemType === 'DAILY_RENT');
    const depositItem = items.find((i) => i.itemType === 'DEPOSIT');

    expect(rentItem?.status).toBe('SETTLED');
    expect(rentItem?.paidAt).toBeNull(); // No fake paidAt!

    expect(depositItem?.status).toBe('SETTLED');
    expect(depositItem?.paidAt).toBeNull(); // No fake paidAt!

    // Verify zero-obligation bill has no Payment and no Receipt
    const payments = await prisma.payment.findMany({ where: { dormitoryId } });
    expect(payments.length).toBe(0);

    const receipts = await prisma.receipt.findMany({ where: { dormitoryId } });
    expect(receipts.length).toBe(0);
  });

  it('Path 1 Proof: Online Reservation + Approval (startDailyStay) follows exact same classification', async () => {
    const today = getBangkokDate(0);
    const tomorrow = getBangkokDate(1);

    // Reservation with rent 800 and deposit 0
    const stayResA = await dailyStayService.createTenantDailyStayRequest(dormitoryId, {
      roomId: roomEId,
      applicantFullName: 'ผู้พักออนไลน์ อี',
      applicantPhone: '085-555-6666',
      startDate: today,
      endDate: tomorrow,
      depositAmount: 0.0,
    });

    const approvedA = await dailyStayService.approveDailyStay(dormitoryId, stayResA.id, ownerUserId);
    expect(approvedA.invoice).toBeDefined();
    expect(approvedA.invoice.status).toBe('ISSUED'); // Strictly ISSUED, NOT PARTIALLY_PAID
    expect(Number(approvedA.invoice.outstandingAmount)).toBe(800.0);

    // Reservation with rent 0 and deposit 0
    const stayResB = await dailyStayService.createTenantDailyStayRequest(dormitoryId, {
      roomId: roomFId,
      applicantFullName: 'ผู้พักออนไลน์ เอฟ',
      applicantPhone: '086-666-7777',
      startDate: today,
      endDate: tomorrow,
      depositAmount: 0.0,
    });

    const approvedB = await dailyStayService.approveDailyStay(dormitoryId, stayResB.id, ownerUserId);
    expect(approvedB.invoice).toBeDefined();
    expect(approvedB.invoice.status).toBe('PAID');
    expect(Number(approvedB.invoice.outstandingAmount)).toBe(0.0);
  });

  describe('Round 2.4H.2: Zero Daily Items Never Acquire Fake paidAt & Settlement Idempotency', () => {
    it('Case 2.4H.2-A: zero deposit SETTLED/null -> direct settle attempt -> still paidAt null', async () => {
      const today = getBangkokDate(0);
      const tomorrow = getBangkokDate(1);

      const stayRes = await dailyStayService.ownerQuickAddDailyStay(
        dormitoryId,
        {
          roomId: room24H2_AId,
          fullName: 'นายทดสอบ เคส 2.4H.2-A',
          phone: '087-777-8888',
          startDate: today,
          endDate: tomorrow,
          dailyRateAmount: 800.0,
          depositAmount: 0.0,
          depositDeclaredStatus: 'UNPAID',
        },
        ownerUserId
      );

      const invoiceId = stayRes.invoice.id;

      // Attempt to settle zero DEPOSIT directly
      const updatedInvoice = await dailyStayService.settleDailyStayInvoiceItem(
        dormitoryId,
        invoiceId,
        'DEPOSIT',
        ownerUserId
      );

      const items = await prisma.dailyStayInvoiceItem.findMany({
        where: { invoiceId },
      });

      const depositItem = items.find((i) => i.itemType === 'DEPOSIT');
      const rentItem = items.find((i) => i.itemType === 'DAILY_RENT');

      // Invariant: zero deposit MUST remain SETTLED with paidAt = null
      expect(depositItem?.status).toBe('SETTLED');
      expect(Number(depositItem?.amount)).toBe(0.0);
      expect(depositItem?.paidAt).toBeNull();

      // Rent remains outstanding
      expect(rentItem?.status).toBe('OUTSTANDING');
      expect(Number(rentItem?.amount)).toBe(800.0);
      expect(rentItem?.paidAt).toBeNull();

      // Invoice status remains ISSUED with outstanding = 800
      expect(updatedInvoice.status).toBe('ISSUED');
      expect(Number(updatedInvoice.outstandingAmount)).toBe(800.0);
    });

    it('Case 2.4H.2-B: zero rent SETTLED/null -> direct settle attempt -> still paidAt null', async () => {
      const today = getBangkokDate(0);
      const tomorrow = getBangkokDate(1);

      const stayRes = await dailyStayService.ownerQuickAddDailyStay(
        dormitoryId,
        {
          roomId: room24H2_BId,
          fullName: 'นายทดสอบ เคส 2.4H.2-B',
          phone: '088-888-9999',
          startDate: today,
          endDate: tomorrow,
          dailyRateAmount: 0.0,
          depositAmount: 500.0,
          depositDeclaredStatus: 'UNPAID',
        },
        ownerUserId
      );

      const invoiceId = stayRes.invoice.id;

      // Attempt to settle zero DAILY_RENT directly
      const updatedInvoice = await dailyStayService.settleDailyStayInvoiceItem(
        dormitoryId,
        invoiceId,
        'DAILY_RENT',
        ownerUserId
      );

      const items = await prisma.dailyStayInvoiceItem.findMany({
        where: { invoiceId },
      });

      const rentItem = items.find((i) => i.itemType === 'DAILY_RENT');
      const depositItem = items.find((i) => i.itemType === 'DEPOSIT');

      // Invariant: zero rent MUST remain SETTLED with paidAt = null
      expect(rentItem?.status).toBe('SETTLED');
      expect(Number(rentItem?.amount)).toBe(0.0);
      expect(rentItem?.paidAt).toBeNull();

      // Deposit remains outstanding
      expect(depositItem?.status).toBe('OUTSTANDING');
      expect(Number(depositItem?.amount)).toBe(500.0);
      expect(depositItem?.paidAt).toBeNull();

      // Invoice status remains ISSUED with outstanding = 500
      expect(updatedInvoice.status).toBe('ISSUED');
      expect(Number(updatedInvoice.outstandingAmount)).toBe(500.0);
    });

    it('Case 2.4H.2-C: positive rent OUTSTANDING -> settle -> SETTLED + real paidAt', async () => {
      const today = getBangkokDate(0);
      const tomorrow = getBangkokDate(1);

      const stayRes = await dailyStayService.ownerQuickAddDailyStay(
        dormitoryId,
        {
          roomId: room24H2_CId,
          fullName: 'นายทดสอบ เคส 2.4H.2-C',
          phone: '089-999-0000',
          startDate: today,
          endDate: tomorrow,
          dailyRateAmount: 800.0,
          depositAmount: 0.0,
          depositDeclaredStatus: 'UNPAID',
        },
        ownerUserId
      );

      const invoiceId = stayRes.invoice.id;

      // Settle positive DAILY_RENT
      const updatedInvoice = await dailyStayService.settleDailyStayInvoiceItem(
        dormitoryId,
        invoiceId,
        'DAILY_RENT',
        ownerUserId
      );

      const items = await prisma.dailyStayInvoiceItem.findMany({
        where: { invoiceId },
      });

      const rentItem = items.find((i) => i.itemType === 'DAILY_RENT');
      const depositItem = items.find((i) => i.itemType === 'DEPOSIT');

      // Invariant: positive rent becomes SETTLED and acquires real paidAt
      expect(rentItem?.status).toBe('SETTLED');
      expect(Number(rentItem?.amount)).toBe(800.0);
      expect(rentItem?.paidAt).not.toBeNull();
      expect(rentItem?.paidAt instanceof Date).toBe(true);

      // Deposit was 0 -> remains SETTLED with paidAt = null
      expect(depositItem?.status).toBe('SETTLED');
      expect(depositItem?.paidAt).toBeNull();

      // Aggregate invoice becomes PAID with outstanding = 0
      expect(updatedInvoice.status).toBe('PAID');
      expect(Number(updatedInvoice.outstandingAmount)).toBe(0.0);
    });

    it('Case 2.4H.2-D: repeated positive settle does not rewrite first paidAt', async () => {
      const today = getBangkokDate(0);
      const tomorrow = getBangkokDate(1);

      const stayRes = await dailyStayService.ownerQuickAddDailyStay(
        dormitoryId,
        {
          roomId: room24H2_DId,
          fullName: 'นายทดสอบ เคส 2.4H.2-D',
          phone: '080-000-1111',
          startDate: today,
          endDate: tomorrow,
          dailyRateAmount: 800.0,
          depositAmount: 0.0,
          depositDeclaredStatus: 'UNPAID',
        },
        ownerUserId
      );

      const invoiceId = stayRes.invoice.id;

      // First settlement
      await dailyStayService.settleDailyStayInvoiceItem(
        dormitoryId,
        invoiceId,
        'DAILY_RENT',
        ownerUserId
      );

      const itemAfterFirst = await prisma.dailyStayInvoiceItem.findFirst({
        where: { invoiceId, itemType: 'DAILY_RENT' },
      });

      expect(itemAfterFirst?.paidAt).not.toBeNull();
      const firstPaidAtIso = itemAfterFirst!.paidAt!.toISOString();

      // Small delay
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Repeated settlement attempt
      await dailyStayService.settleDailyStayInvoiceItem(
        dormitoryId,
        invoiceId,
        'DAILY_RENT',
        ownerUserId
      );

      const itemAfterSecond = await prisma.dailyStayInvoiceItem.findFirst({
        where: { invoiceId, itemType: 'DAILY_RENT' },
      });

      // Invariant: first paidAt timestamp is preserved, NOT overwritten
      expect(itemAfterSecond?.paidAt?.toISOString()).toBe(firstPaidAtIso);
    });
  });
});
