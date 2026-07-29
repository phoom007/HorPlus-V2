import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

describe('Onboarding & Provisioning API (TASK 011)', () => {
  let app: any;

  beforeEach(() => {
    app = createApp();
  });

  it('GET /api/v1/public/plans returns 6 active system plans in order', async () => {
    const res = await request(app).get('/api/v1/public/plans');
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.length).toBe(6);

    const codes = res.body.data.map((p: any) => p.code);
    expect(codes).toEqual(['FREE', 'MICRO', 'SMALL', 'MEDIUM', 'LARGE', 'ENTERPRISE']);

    const freePlan = res.body.data.find((p: any) => p.code === 'FREE');
    expect(freePlan.monthlyPrice).toBe('0.00');
    expect(freePlan.roomLimit).toBe(10);

    const enterprisePlan = res.body.data.find((p: any) => p.code === 'ENTERPRISE');
    expect(enterprisePlan.monthlyPrice).toBe('2999.00');
    expect(enterprisePlan.roomLimit).toBeNull();
  });

  it('POST /api/v1/onboarding/promo/validate validates HORPLUS promo code', async () => {
    // Perform mock login first using valid mock token
    const authRes = await request(app).post('/api/v1/auth/google').send({
      idToken: 'mock_owner_001',
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
    expect(promoRes.body.data.bonusTrialDays).toBe(60);
    expect(promoRes.body.data.totalTrialDays).toBe(90);

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
      idToken: 'mock_owner_003',
    });
    expect(authRes.status).toBe(200);
    const cookies = authRes.headers['set-cookie'];
    const csrfToken = authRes.body.data.csrfToken;

    const payload = {
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
    expect(completeRes.body.data.promo.bonusDays).toBe(60);

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
      .send({ ...payload, planCode: 'MICRO' });

    expect(conflictRes.status).toBe(409);
    expect(conflictRes.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');

    // 4. FREE Plan Limit Enforcement (Attempting 2nd FREE plan dormitory -> 409)
    const secondFreeRes = await request(app)
      .post('/api/v1/onboarding/complete')
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrfToken)
      .set('X-Idempotency-Key', 'idemp-test-002')
      .send({
        ...payload,
        dormitory: { ...payload.dormitory, name: 'Second FREE Dormitory' },
      });

    expect(secondFreeRes.status).toBe(409);
    expect(secondFreeRes.body.error.code).toBe('FREE_DORMITORY_LIMIT_REACHED');
  });
});
