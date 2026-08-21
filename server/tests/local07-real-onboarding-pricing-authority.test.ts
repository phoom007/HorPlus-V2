import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { SignatureStorageService } from '../src/services/signature-storage.service.js';
import { PNG } from 'pngjs';
import { getPrismaClient } from '../src/db/prisma.js';
import { subscriptionIntentService } from '../src/services/subscription-intent.service.js';
import { calculateInstallmentSchedule as calculateBackendSchedule } from '../src/utils/installment-calculator.util.js';

describe('LOCAL-07: Real Onboarding Pricing & Installment Authority Proof', () => {
  let app: any;

  beforeEach(() => {
    app = createApp();
  });

  it('proves complete real onboarding persists monthly/term/daily/installment pricing, resolves quick-add-context, and enforces room override independence', async () => {
    const authRes = await request(app).post('/api/v1/auth/google').send({
      idToken: `mock_owner_pricing_auth_${Date.now()}_${Math.random()}`,
    });
    expect(authRes.status).toBe(200);
    const cookies = authRes.headers['set-cookie'];
    const csrfToken = authRes.body.data.csrfToken;
    const userId = authRes.body.data.userId || authRes.body.data.user?.id;

    // 1. Prepare provisional dormitory
    const prepRes = await request(app)
      .post('/api/v1/onboarding/prepare')
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrfToken)
      .send({ name: 'หอพักทดสอบ Real Pricing Authority' });
    expect(prepRes.status).toBe(200);
    const provDormId = prepRes.body.data.provisionalDormitoryId;

    // 2. Save mock signature and mock LINE config
    const prisma = getPrismaClient();
    const sigService = new SignatureStorageService(prisma);
    const pngObj = new PNG({ width: 16, height: 16 });
    for (let i = 0; i < pngObj.data.length; i += 4) {
      pngObj.data[i] = 0;
      pngObj.data[i + 1] = 0;
      pngObj.data[i + 2] = 0;
      pngObj.data[i + 3] = 255;
    }
    const validPngBuffer = PNG.sync.write(pngObj);
    await sigService.saveSignature({ dormitoryId: provDormId, userId, buffer: validPngBuffer });

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${provDormId}, true)`;
      await tx.dormitoryLineConfig.update({
        where: { dormitoryId: provDormId },
        data: { accessTokenVerifiedAt: new Date(), webhookEndpointSetAt: new Date(), webhookTestSucceededAt: new Date(), webhookActive: true, isConnected: true },
      });
    });

    // 3. Create Intent Quote
    const quote = await subscriptionIntentService.createIntentQuote(userId, { promoCode: 'HORPLUS' }, undefined, provDormId);

    // 4. Complete Onboarding with Real Distinct Values
    const buildingId = `bld_${Date.now()}`;
    const payload = {
      provisionalDormitoryId: provDormId,
      packageIntentId: quote.intentId,
      dormitory: {
        name: 'หอพักทดสอบ Real Pricing Authority',
        type: 'apartment',
        genderPolicy: 'รวม',
        addressLine1: '123/45 ถนนทดสอบ',
        province: 'กรุงเทพมหานคร',
        estimatedBuildingCount: 1,
        estimatedRoomCount: 2,
      },
      billing: {
        billingDay: 25,
        dueDay: 5,
        waterBillingType: 'per_unit',
        waterRate: '18.00',
        electricityBillingType: 'per_unit',
        electricityRate: '7.00',
        commonFee: '200.00',
        internetFee: '150.00',
        parkingRate: '300.00',
        advanceRentMonths: 1,
      },
      payment: {
        cashAccepted: true,
        promptPayType: 'mobile_phone',
        promptPayValue: '0819997777',
        bankCode: 'KBANK',
        bankAccountName: 'เจ้าของทดสอบ Real',
        bankAccountNumber: '1234567890',
      },
      buildings: [
        {
          id: buildingId,
          name: 'อาคาร A',
          code: 'A',
          floorsCount: 1,
          roomsPerFloor: 2,
          roomPrefix: 'A',
          hasElevator: false,
          monthlyRent: 3500,
          termRent: 12000,
          dailyRent: 550,
          termMonths: 4,
          maxInstallmentMonths: 3, // "แบ่งชำระ = 3 งวด"
          depositAmount: 3500,
          maximumOccupants: 2,
        },
      ],
      rooms: [
        {
          buildingId,
          roomNumber: '101',
          floor: 1,
          monthlyRent: 3500,
          termRent: 12000,
          dailyRent: 550,
          termMonths: 4,
          depositAmount: 3500,
          status: 'vacant',
        },
        {
          buildingId,
          roomNumber: '102',
          floor: 1,
          monthlyRent: 3500,
          termRent: 12000,
          dailyRent: 550,
          termMonths: 4,
          depositAmount: 3500,
          status: 'vacant',
        },
      ],
      planCode: 'PAID',
      promoCode: 'HORPLUS',
    };

    const completeRes = await request(app)
      .post('/api/v1/onboarding/complete')
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrfToken)
      .send(payload);

    expect(completeRes.status).toBe(200);
    const dormId = completeRes.body.data.dormitory.id;

    // 5. Database Direct Proof — Verify Persisted Record Fields
    const dbBuilding = await prisma.building.findFirst({
      where: { dormitoryId: dormId, name: 'อาคาร A' },
    });
    expect(dbBuilding).toBeDefined();
    expect(Number(dbBuilding!.monthlyRent)).toBe(3500);
    expect(Number(dbBuilding!.termRent)).toBe(12000);
    expect(Number(dbBuilding!.dailyRent)).toBe(550);
    expect(dbBuilding!.termMonths).toBe(4);
    expect(dbBuilding!.maxTermRentInstallments).toBe(3);
    expect(Number(dbBuilding!.depositAmount)).toBe(3500);

    const dbRooms = await prisma.room.findMany({
      where: { dormitoryId: dormId },
      orderBy: { roomNumber: 'asc' },
    });
    expect(dbRooms).toHaveLength(2);
    const room101 = dbRooms.find(r => r.roomNumber === '101')!;
    const room102 = dbRooms.find(r => r.roomNumber === '102')!;

    expect(Number(room101.monthlyRent)).toBe(3500);
    expect(Number(room101.termRent)).toBe(12000);
    expect(Number(room101.dailyRent)).toBe(550);
    expect(room101.termMonths).toBe(4);

    // 6. Quick Add Context API Proof for Room 101
    const ctx101Res = await request(app)
      .get(`/api/v1/properties/rooms/${room101.id}/quick-add-context`)
      .set('Cookie', cookies)
      .set('x-dormitory-id', dormId);

    expect(ctx101Res.status).toBe(200);
    const ctx101 = ctx101Res.body.data;
    expect(ctx101.roomId).toBe(room101.id);
    expect(ctx101.effective.monthlyRent).toBe(3500);
    expect(ctx101.effective.termRent).toBe(12000);
    expect(ctx101.effective.dailyRent).toBe(550);
    expect(ctx101.effective.depositAmount).toBe(3500);
    expect(ctx101.building.termMonths).toBe(4);
    expect(ctx101.building.maxTermRentInstallments).toBe(3);

    // 7. Installment Schedule Calculation Proof on 12,000 / 3
    const schedule = calculateBackendSchedule(ctx101.effective.termRent, ctx101.building.maxTermRentInstallments);
    expect(schedule).toHaveLength(3);
    expect(schedule[0].formattedAmount).toBe('4000.00');
    expect(schedule[1].formattedAmount).toBe('4000.00');
    expect(schedule[2].formattedAmount).toBe('4000.00');
    expect(schedule.reduce((acc, curr) => acc + curr.amountSatang, 0)).toBe(1200000);

    // 8. Room Override Independence Proof — Update Room 102 with distinct pricing
    const updateRoomRes = await request(app)
      .put(`/api/v1/properties/rooms/${room102.id}`)
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrfToken)
      .set('x-dormitory-id', dormId)
      .send({
        termRent: '13500.00',
        dailyRent: '650.00',
        expectedVersion: room102.version,
      });

    expect(updateRoomRes.status).toBe(200);

    // 9. Verify Quick Add Context for Room 101 remains 12,000 / 550 while Room 102 reflects 13,500 / 650
    const ctx101Check = await request(app)
      .get(`/api/v1/properties/rooms/${room101.id}/quick-add-context`)
      .set('Cookie', cookies)
      .set('x-dormitory-id', dormId);

    const ctx102Check = await request(app)
      .get(`/api/v1/properties/rooms/${room102.id}/quick-add-context`)
      .set('Cookie', cookies)
      .set('x-dormitory-id', dormId);

    expect(ctx101Check.status).toBe(200);
    expect(ctx102Check.status).toBe(200);

    expect(ctx101Check.body.data.effective.termRent).toBe(12000);
    expect(ctx101Check.body.data.effective.dailyRent).toBe(550);

    expect(ctx102Check.body.data.effective.termRent).toBe(13500);
    expect(ctx102Check.body.data.effective.dailyRent).toBe(650);
    expect(ctx102Check.body.data.sources.termRent).toBe('ROOM');
    expect(ctx102Check.body.data.sources.dailyRent).toBe('ROOM');
  });
});
