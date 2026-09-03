import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { getPrismaClient } from '../../db/prisma.js';
import { DormitoryProvisioningService } from '../../services/dormitory-provisioning.service.js';
import { subscriptionIntentService } from '../../services/subscription-intent.service.js';
import { SensitiveFieldService } from '../../services/sensitive-field.service.js';
import { createOnboardingRouter } from '../../routes/onboarding.routes.js';
import { cookieParserMiddleware } from '../../middleware/cookie-parser.middleware.js';
import { SignatureStorageService } from '../../services/signature-storage.service.js';
import { PNG } from 'pngjs';
import crypto from 'crypto';

describe('Round 2.4J.1: Real Registration Production-Boundary Proof', () => {
  const prisma = getPrismaClient();
  const sensitiveFieldService = new SensitiveFieldService('12345678901234567890123456789012');
  const provisioningService = new DormitoryProvisioningService(prisma, sensitiveFieldService);

  const createTestUserAndApp = async () => {
    const userId = crypto.randomUUID();
    const testEmail = `owner.24j1.${Date.now()}.${Math.random().toString(36).slice(2, 6)}@example.com`;
    await prisma.user.create({
      data: {
        id: userId,
        email: testEmail,
        emailNormalized: testEmail.toLowerCase(),
        name: 'เจ้าของหอพัก 24J1 ทดสอบ',
        googleSubject: `google-sub-${Date.now()}-${Math.random()}`,
      },
    });

    const app = express();
    app.use(express.json());
    app.use(cookieParserMiddleware);

    const mockAuthService = {
      validateSession: async () => ({
        user: { id: userId, name: 'เจ้าของหอพัก 24J1 ทดสอบ' },
        session: { id: `session-${userId}`, userId, tokenVersion: 0 },
        rawSessionId: `session-${userId}`,
        memberships: [],
      }),
      verifyCsrf: () => true,
    };
    const mockOnboardingService = {
      getStatus: async () => ({}),
      getDraft: async () => null,
      saveDraft: async () => {},
      deleteDraft: async () => {},
    };
    const mockPromoService = {
      validatePromo: async () => ({ valid: true }),
    };

    const onboardingRouter = createOnboardingRouter(
      mockAuthService as any,
      mockOnboardingService as any,
      mockPromoService as any,
      provisioningService
    );

    app.use('/api/v1/onboarding', onboardingRouter);

    return { userId, app };
  };

  const uploadSignatureForDorm = async (dormId: string, userId: string) => {
    const pngObj = new PNG({ width: 16, height: 16 });
    for (let i = 0; i < pngObj.data.length; i += 4) {
      pngObj.data[i] = 0;
      pngObj.data[i + 1] = 0;
      pngObj.data[i + 2] = 0;
      pngObj.data[i + 3] = 255;
    }
    const validPngBuffer = PNG.sync.write(pngObj);
    const signatureService = new SignatureStorageService(prisma);
    await signatureService.saveSignature({
      dormitoryId: dormId,
      userId,
      buffer: validPngBuffer,
    });
  };

  // =========================================================================
  // Case A: Valid registration WITH cropped uploaded logo
  // =========================================================================
  it('Case A: Valid registration WITH cropped uploaded logo persists logoObjectKey and creates dormitory graph', async () => {
    const { userId, app } = await createTestUserAndApp();

    const prep = await provisioningService.prepareProvisionalDormitory(userId, {
      name: 'หอพัก 24J1 มีโลโก้',
    });
    const provDormId = prep.provisionalDormitoryId;

    // Simulate logo upload on provisional dormitory
    const fakeLogoKey = `dormitories/${provDormId}/logos/logo-512x512-test.png`;
    await prisma.dormitory.update({
      where: { id: provDormId },
      data: { logoObjectKey: fakeLogoKey },
    });

    await uploadSignatureForDorm(provDormId, userId);
    const quote = await subscriptionIntentService.createIntentQuote(userId, { isFreePlan: true }, undefined, provDormId);

    const finalizePayload = {
      provisionalDormitoryId: provDormId,
      packageIntentId: quote.intentId,
      planCode: 'FREE',
      dormitory: {
        name: 'หอพัก 24J1 มีโลโก้ สมบูรณ์',
        type: 'apartment',
        genderPolicy: 'รวม',
        addressLine1: '99/1 ถนนสุขุมวิท',
        province: 'กรุงเทพมหานคร',
        phone: '0812345678',
        logoUrl: `/uploads/${fakeLogoKey}`,
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
        commonFee: '0.00',
        commonFeeMode: 'none',
        internetFee: '0.00',
        internetFeeMode: 'none',
        parkingRate: '0.00',
        parkingFeeMode: 'none',
        gracePeriodDays: 0,
        advanceRentMonths: 1,
        lateFeeType: 'fixed',
        lateFeeValue: '50.00',
        rentBillingType: 'monthly',
      },
      payment: {
        cashAccepted: true,
        bankCode: 'กสิกรไทย (KBank)',
        bankAccountName: 'เจ้าของหอพัก 24J1 ทดสอบ',
        bankAccountNumber: '0982345678',
      },
      buildings: [
        {
          id: 'bld-1',
          name: 'อาคาร A',
          floorsCount: 1,
          roomsPerFloor: 2,
          monthlyRent: 4000,
          depositAmount: 4000,
          monthlyDeposit: 4000,
          termDeposit: 4000,
          dailyDeposit: 500,
          maxInstallmentMonths: 1,
          maximumOccupants: 2,
        },
      ],
      rooms: [
        {
          buildingId: 'bld-1',
          roomNumber: '101',
          floor: 1,
          monthlyRent: 4000,
          depositAmount: 4000,
          maximumOccupants: 2,
          status: 'vacant',
        },
        {
          buildingId: 'bld-1',
          roomNumber: '102',
          floor: 1,
          monthlyRent: 4000,
          depositAmount: 4000,
          maximumOccupants: 2,
          status: 'vacant',
        },
      ],
      rules: 'ห้ามสูบบุหรี่',
      defaultTerms: 'ห้ามสูบบุหรี่',
      petPolicy: { allowed: 'no' },
    };

    const res = await request(app)
      .post('/api/v1/onboarding/finalize')
      .set('Cookie', 'horplus_session=session-token; horplus_csrf=valid-csrf')
      .set('x-csrf-token', 'valid-csrf')
      .send(finalizePayload);

    if (res.status !== 200) console.error('Case A Error:', JSON.stringify(res.body, null, 2));
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.dormitoryId).toBe(provDormId);

    // Verify Dormitory exists
    const dorm = await prisma.dormitory.findUnique({
      where: { id: provDormId },
      include: { buildings: { include: { rooms: true } }, members: true },
    });
    expect(dorm).not.toBeNull();
    expect(dorm?.name).toBe('หอพัก 24J1 มีโลโก้ สมบูรณ์');
    expect(dorm?.logoObjectKey).toBe(fakeLogoKey); // Logo remains linked to finalized dormitory!

    // Verify Building exists
    expect(dorm?.buildings).toHaveLength(1);
    expect(dorm?.buildings[0].name).toBe('อาคาร A');

    // Verify Rooms exist
    expect(dorm?.buildings[0].rooms).toHaveLength(2);
    const roomNumbers = dorm?.buildings[0].rooms.map((r: any) => r.roomNumber).sort();
    expect(roomNumbers).toEqual(['101', '102']);

    // Verify Owner Membership exists
    const ownerMember = await prisma.dormitoryMember.findFirst({
      where: { dormitoryId: provDormId, userId },
      include: { role: true },
    });
    expect(ownerMember).toBeDefined();
    expect(ownerMember?.role?.code).toBe('OWNER');
    expect(ownerMember?.status).toBe('active');
  });

  // =========================================================================
  // Case B: Valid registration WITHOUT logo
  // =========================================================================
  it('Case B: Valid registration WITHOUT logo succeeds with logoObjectKey null', async () => {
    const { userId, app } = await createTestUserAndApp();

    const prep = await provisioningService.prepareProvisionalDormitory(userId, {
      name: 'หอพัก 24J1 ไม่มีโลโก้',
    });
    const provDormId = prep.provisionalDormitoryId;

    await uploadSignatureForDorm(provDormId, userId);
    const quote = await subscriptionIntentService.createIntentQuote(userId, { isFreePlan: true }, undefined, provDormId);

    const finalizePayload = {
      provisionalDormitoryId: provDormId,
      packageIntentId: quote.intentId,
      planCode: 'FREE',
      dormitory: {
        name: 'หอพัก 24J1 ไม่มีโลโก้',
        type: 'apartment',
        genderPolicy: 'รวม',
        addressLine1: '100 ถนนพระราม 9',
        province: 'กรุงเทพมหานคร',
        phone: '0898765432',
        logoUrl: null,
        estimatedBuildingCount: 1,
        estimatedRoomCount: 1,
      },
      billing: {
        billingDay: 25,
        dueDay: 5,
        waterBillingType: 'fixed_monthly',
        waterRate: '150.00',
        electricityBillingType: 'per_unit',
        electricityRate: '8.00',
        commonFee: '0.00',
        commonFeeMode: 'none',
        internetFee: '0.00',
        internetFeeMode: 'none',
        parkingRate: '0.00',
        parkingFeeMode: 'none',
        gracePeriodDays: 0,
        advanceRentMonths: 1,
        lateFeeType: 'none',
        lateFeeValue: '0.00',
        rentBillingType: 'monthly',
      },
      payment: {
        cashAccepted: true,
      },
      buildings: [
        {
          id: 'bld-1',
          name: 'อาคารเดี่ยว',
          floorsCount: 1,
          roomsPerFloor: 1,
          monthlyRent: 3500,
          depositAmount: 3500,
          monthlyDeposit: 3500,
          termDeposit: 3500,
          dailyDeposit: 500,
          maxInstallmentMonths: 1,
          maximumOccupants: 1,
        },
      ],
      rooms: [
        {
          buildingId: 'bld-1',
          roomNumber: '101',
          floor: 1,
          monthlyRent: 3500,
          depositAmount: 3500,
          maximumOccupants: 1,
          status: 'vacant',
        },
      ],
      rules: '',
      defaultTerms: '',
      petPolicy: { allowed: 'no' },
    };

    const res = await request(app)
      .post('/api/v1/onboarding/finalize')
      .set('Cookie', 'horplus_session=session-token; horplus_csrf=valid-csrf')
      .set('x-csrf-token', 'valid-csrf')
      .send(finalizePayload);

    if (res.status !== 200) console.error('Case B Error:', JSON.stringify(res.body, null, 2));
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.dormitoryId).toBe(provDormId);

    const dorm = await prisma.dormitory.findUnique({
      where: { id: provDormId },
    });
    expect(dorm?.logoObjectKey).toBeNull();
  });

  // =========================================================================
  // Case C: Invalid field fails with HTTP 400 + fieldErrors
  // =========================================================================
  it('Case C: Invalid field returns HTTP 400 with VALIDATION_ERROR and fieldErrors array', async () => {
    const { userId, app } = await createTestUserAndApp();

    const prep = await provisioningService.prepareProvisionalDormitory(userId, {
      name: 'หอพักทดสอบ Invalid Field',
    });
    const provDormId = prep.provisionalDormitoryId;

    const finalizePayload = {
      provisionalDormitoryId: provDormId,
      packageIntentId: crypto.randomUUID(),
      planCode: 'FREE',
      dormitory: {
        name: '', // Empty name violates min(1)
        type: 'apartment',
        genderPolicy: 'รวม',
        addressLine1: '123 ถนนทดสอบ',
      },
      billing: {
        dueDay: 35, // Invalid due day (> 31)
        billingDay: 25,
        waterBillingType: 'per_unit',
        waterRate: '18.00',
        electricityBillingType: 'per_unit',
        electricityRate: '7.00',
        lateFeeType: 'invalid_type', // Invalid enum
      },
      payment: {},
      buildings: [],
      rooms: [],
    };

    const res = await request(app)
      .post('/api/v1/onboarding/finalize')
      .set('Cookie', 'horplus_session=session-token; horplus_csrf=valid-csrf')
      .set('x-csrf-token', 'valid-csrf')
      .send(finalizePayload);

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toBe('ข้อมูลการสร้างหอพักไม่ถูกต้อง กรุณาตรวจสอบข้อมูลอีกครั้ง');
    expect(Array.isArray(res.body.error.fieldErrors)).toBe(true);
    expect(res.body.error.fieldErrors.length).toBeGreaterThan(0);
  });

  // =========================================================================
  // Case D: Malformed money string fails validation fail-closed
  // =========================================================================
  it('Case D: Malformed money string ("abc", "-100") fails validation fail-closed with 400', async () => {
    const { userId, app } = await createTestUserAndApp();

    const prep = await provisioningService.prepareProvisionalDormitory(userId, {
      name: 'หอพักทดสอบ Malformed Money',
    });
    const provDormId = prep.provisionalDormitoryId;

    const finalizePayload = {
      provisionalDormitoryId: provDormId,
      packageIntentId: crypto.randomUUID(),
      planCode: 'FREE',
      dormitory: {
        name: 'หอพักทดสอบ Malformed Money',
        type: 'apartment',
        genderPolicy: 'รวม',
        addressLine1: '123 ถนนสุขุมวิท',
      },
      billing: {
        dueDay: 5,
        billingDay: 25,
        waterBillingType: 'per_unit',
        waterRate: 'abc', // Malformed non-numeric money
        electricityBillingType: 'per_unit',
        electricityRate: '-100', // Negative money
        rentBillingType: 'monthly',
      },
      payment: { cashAccepted: true },
      buildings: [],
      rooms: [],
    };

    const res = await request(app)
      .post('/api/v1/onboarding/finalize')
      .set('Cookie', 'horplus_session=session-token; horplus_csrf=valid-csrf')
      .set('x-csrf-token', 'valid-csrf')
      .send(finalizePayload);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.fieldErrors.some((fe: any) => fe.field.includes('waterRate'))).toBe(true);
  });
});
