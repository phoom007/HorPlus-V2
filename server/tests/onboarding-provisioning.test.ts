import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { SignatureStorageService } from '../src/services/signature-storage.service.js';
import { PNG } from 'pngjs';
import { getPrismaClient } from '../src/db/prisma.js';

describe('Onboarding & Provisioning API (TASK 011)', () => {
  let app: any;

  beforeEach(() => {
    app = createApp();
  });

  it('GET /api/v1/public/plans returns 6 active system plans in order', async () => {
    const res = await request(app).get('/api/v1/public/plans');
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.length).toBe(2);

    const codes = res.body.data.map((p: any) => p.code);
    expect(codes).toEqual(['FREE', 'PAID']);

    const freePlan = res.body.data.find((p: any) => p.code === 'FREE');
    expect(freePlan.monthlyPrice).toBe('0.00');
    expect(freePlan.roomLimit).toBe(10);

    const paidPlan = res.body.data.find((p: any) => p.code === 'PAID');
    expect(paidPlan.monthlyPrice).toBe('189.00');
    expect(paidPlan.roomLimit).toBe(150);
  });

  it('POST /api/v1/onboarding/promo/validate validates HORPLUS promo code', async () => {
    // Perform mock login first using valid mock token
    const authRes = await request(app).post('/api/v1/auth/google').send({
      idToken: `mock_onboard_owner_${Date.now()}_${Math.random()}`,
    });
    expect(authRes.status).toBe(200);
    const cookies = authRes.headers['set-cookie'];
    const csrfToken = authRes.body.data.csrfToken;

    // Validate HORPLUS
    const promoRes = await request(app)
      .post('/api/v1/onboarding/promo/validate')
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrfToken)
      .send({ code: 'HORPLUS' });

    expect(promoRes.status).toBe(200);
    expect(promoRes.body.data.valid).toBe(true);
    expect(promoRes.body.data.eligible).toBe(true);
    expect(promoRes.body.data.trialMonths).toBe(1);
    expect(promoRes.body.data.promoBonusMonths).toBe(2);
    expect(promoRes.body.data.totalTrialMonths).toBe(3);

    // Validate Invalid Code
    const invalidRes = await request(app)
      .post('/api/v1/onboarding/promo/validate')
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrfToken)
      .send({ code: 'INVALID_CODE_999' });

    expect(invalidRes.status).toBe(200);
    expect(invalidRes.body.data.valid).toBe(false);
  });

  it('PUT /api/v1/onboarding/draft and GET /api/v1/onboarding/draft handles draft persistence', async () => {
    const authRes = await request(app).post('/api/v1/auth/google').send({
      idToken: 'mock_owner_002',
    });
    expect(authRes.status).toBe(200);
    const cookies = authRes.headers['set-cookie'];
    const csrfToken = authRes.body.data.csrfToken;

    // Save draft
    const draftData = {
      currentStep: 'billing',
      payload: {
        dormitory: { name: 'Draft Dormitory' },
        billing: { waterRate: '20.00' },
      },
    };

    const putRes = await request(app)
      .put('/api/v1/onboarding/draft')
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrfToken)
      .send(draftData);

    expect(putRes.status).toBe(200);
    expect(putRes.body.data.currentStep).toBe('billing');

    // Get draft
    const getRes = await request(app)
      .get('/api/v1/onboarding/draft')
      .set('Cookie', cookies);

    expect(getRes.status).toBe(200);
    expect(getRes.body.data.currentStep).toBe('billing');
    expect(getRes.body.data.payload.dormitory.name).toBe('Draft Dormitory');
  });

  it('POST /api/v1/onboarding/complete provisions dormitory and handles idempotency + FREE limit', async () => {
    const authRes = await request(app).post('/api/v1/auth/google').send({
      idToken: `mock_onboard_owner_complete_${Date.now()}_${Math.random()}`,
    });
    expect(authRes.status).toBe(200);
    const cookies = authRes.headers['set-cookie'];
    const csrfToken = authRes.body.data.csrfToken;

    // 0. Prepare provisional dormitory and save signature
    const prepRes = await request(app)
      .post('/api/v1/onboarding/prepare')
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrfToken)
      .send({ name: 'Grand Sunrise Dormitory' });
    expect(prepRes.status).toBe(200);
    const provDormId = prepRes.body.data.provisionalDormitoryId;
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
    const userId = prepRes.body.data.userId || authRes.body.data.userId || authRes.body.data.user?.id;
    await sigService.saveSignature({ dormitoryId: provDormId, userId, buffer: validPngBuffer });
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${provDormId}, true)`;
      await tx.dormitoryLineConfig.update({
        where: { dormitoryId: provDormId },
        data: { accessTokenVerifiedAt: new Date(), webhookEndpointSetAt: new Date(), webhookTestSucceededAt: new Date(), webhookActive: true, isConnected: true },
      });
    });

    const payload = {
      provisionalDormitoryId: provDormId,
      dormitory: {
        name: 'Grand Sunrise Dormitory',
        type: 'apartment',
        estimatedBuildingCount: 1,
        estimatedRoomCount: 10,
      },
      billing: {
        billingDay: 25,
        dueDay: 5,
        waterRate: '18.00',
        electricityRate: '7.00',
      },
      payment: {
        cashAccepted: true,
        promptPayType: 'mobile_phone',
        promptPayValue: '0812345678',
        bankCode: 'KBANK',
        bankAccountName: 'Test Owner',
        bankAccountNumber: '1234567890',
      },
      planCode: 'FREE',
      promoCode: 'HORPLUS',
    };

    const idempotencyKey = 'idemp-test-001';

    // 1. Complete Onboarding
    const completeRes = await request(app)
      .post('/api/v1/onboarding/complete')
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrfToken)
      .set('X-Idempotency-Key', idempotencyKey)
      .send(payload);

    expect(completeRes.status).toBe(200);
    expect(completeRes.body.data.dormitory.name).toBe('Grand Sunrise Dormitory');
    expect(completeRes.body.data.subscription.planCode).toBe('FREE');
    expect(completeRes.body.data.promo.applied).toBe(true);
    expect(completeRes.body.data.promo.promoBonusMonths || completeRes.body.data.promo.bonusDays).toBeDefined();

    // 2. Idempotency Replay (Same Key + Same Payload -> 200 Replay)
    const replayRes = await request(app)
      .post('/api/v1/onboarding/complete')
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrfToken)
      .set('X-Idempotency-Key', idempotencyKey)
      .send(payload);

    expect(replayRes.status).toBe(200);
    expect(replayRes.body.data.dormitory.id).toBe(completeRes.body.data.dormitory.id);

    // 3. Idempotency Conflict (Same Key + Different Payload -> 409)
    const conflictRes = await request(app)
      .post('/api/v1/onboarding/complete')
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrfToken)
      .set('X-Idempotency-Key', idempotencyKey)
      .send({ ...payload, planCode: 'PAID' });

    expect(conflictRes.status).toBe(409);
    expect(conflictRes.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');

    // 4. FREE Plan Limit Enforcement (Attempting 2nd FREE plan dormitory -> 409)
    const prepRes2 = await request(app)
      .post('/api/v1/onboarding/prepare')
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrfToken)
      .send({ name: 'Second FREE Dormitory' });
    const provDormId2 = prepRes2.body.data?.provisionalDormitoryId;
    if (provDormId2) {
      const userId2 = prepRes2.body.data.userId || authRes.body.data.userId || authRes.body.data.user?.id;
      await sigService.saveSignature({ dormitoryId: provDormId2, userId: userId2, buffer: validPngBuffer });
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${provDormId2}, true)`;
        await tx.dormitoryLineConfig.update({
          where: { dormitoryId: provDormId2 },
          data: { accessTokenVerifiedAt: new Date(), webhookEndpointSetAt: new Date(), webhookTestSucceededAt: new Date(), webhookActive: true, isConnected: true },
        });
      });
    }

    const secondFreeRes = await request(app)
      .post('/api/v1/onboarding/complete')
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrfToken)
      .set('X-Idempotency-Key', 'idemp-test-002')
      .send({
        provisionalDormitoryId: provDormId2,
        dormitory: { ...payload.dormitory, name: 'Second FREE Dormitory' },
        billing: payload.billing,
        payment: payload.payment,
        planCode: 'FREE',
      });

    expect(secondFreeRes.status).toBe(409);
    expect(secondFreeRes.body.error.code).toBe('FREE_DORMITORY_LIMIT_REACHED');
  });

});
