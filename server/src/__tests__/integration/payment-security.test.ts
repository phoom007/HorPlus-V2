/**
 * Payment Security & Idempotency Integration Tests (Task-009 — PS-001 to PS-010)
 * FINAL-002, FINAL-003, FINAL-010, FINAL-011
 * @license Apache-2.0
 */

import crypto from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { getEnv, resetCachedEnv } from '../../config/env.js';
import { getPrismaClient } from '../../db/prisma.js';
import { AuthenticationService } from '../../services/auth.service.js';
import { PrismaUserRepository } from '../../db/repositories/user.repository.js';
import { PrismaSessionRepository } from '../../db/repositories/session.repository.js';
import { PrismaMembershipRepository } from '../../db/repositories/membership.repository.js';
import { PrismaRoleRepository } from '../../db/repositories/role.repository.js';
import { SensitiveFieldService } from '../../services/sensitive-field.service.js';
import { subscriptionEntitlementService } from '../../services/subscription-entitlement.service.js';
import { SignatureStorageService } from '../../services/signature-storage.service.js';
import { subscriptionIntentService } from '../../services/subscription-intent.service.js';
import { PNG } from 'pngjs';

const prisma = getPrismaClient();
let sensitiveService: SensitiveFieldService;

describe('Payment Security & Idempotency Boundary (PS-001 to PS-010)', () => {
  let app: any;
  let authService: AuthenticationService;
  let ownerUserId: string;
  let ownerSessionToken: string;
  let ownerCsrfToken: string;
  let staffUserId: string;
  let staffSessionToken: string;
  let staffCsrfToken: string;
  let testDormId: string;

  // Cross-dorm isolation
  let crossDormId: string;
  let crossOwnerUserId: string;
  let crossOwnerSessionToken: string;
  let crossOwnerCsrfToken: string;

  // MANAGER role (default permissions, no payment_settings)
  let managerUserId: string;
  let managerSessionToken: string;
  let managerCsrfToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.E2E_TEST_MODE = 'true';
    resetCachedEnv();
    sensitiveService = new SensitiveFieldService(getEnv().FIELD_ENCRYPTION_KEY, 1);
    const mockGoogleVerifier = {} as any;
    const mockAuditService = { logAction: async () => {} } as any;

    authService = new AuthenticationService(
      getEnv(),
      mockGoogleVerifier,
      new PrismaUserRepository(prisma),
      new PrismaSessionRepository(prisma),
      new PrismaMembershipRepository(prisma),
      new PrismaRoleRepository(prisma),
      mockAuditService
    );

    app = createApp({ customAuthService: authService, forcePrisma: true });

    // Seed Subscription Plan
    await subscriptionEntitlementService.ensureSeeded();
    const freePlan = await prisma.subscriptionPlan.findFirst({ where: { code: 'FREE' } });

    // ── Primary test dormitory ──────────────────────────────────────────
    const ownerEmail = `payment_owner_${Date.now()}@example.com`;
    const ownerUser = await prisma.user.create({
      data: {
        googleSubject: `sub_owner_${Date.now()}`,
        email: ownerEmail,
        emailNormalized: ownerEmail.toLowerCase(),
        name: 'Payment Owner',
      },
    });
    ownerUserId = ownerUser.id;

    const staffEmail = `payment_staff_${Date.now()}@example.com`;
    const staffUser = await prisma.user.create({
      data: {
        googleSubject: `sub_staff_${Date.now()}`,
        email: staffEmail,
        emailNormalized: staffEmail.toLowerCase(),
        name: 'Payment Staff',
      },
    });
    staffUserId = staffUser.id;

    const managerEmail = `payment_mgr_${Date.now()}@example.com`;
    const managerUser = await prisma.user.create({
      data: {
        googleSubject: `sub_mgr_${Date.now()}`,
        email: managerEmail,
        emailNormalized: managerEmail.toLowerCase(),
        name: 'Payment Manager',
      },
    });
    managerUserId = managerUser.id;

    const dorm = await prisma.dormitory.create({
      data: {
        name: 'Payment Test Dorm',
        type: 'apartment',
        addressLine1: '123 Payment St',
        status: 'active',
      },
    });
    testDormId = dorm.id;

    await prisma.dormitorySubscription.create({
      data: {
        dormitoryId: testDormId,
        planId: freePlan!.id,
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 365 * 86400000),
      },
    });

    const ownerRole = await prisma.role.create({
      data: {
        dormitoryId: testDormId,
        code: 'OWNER',
        name: 'Owner',
        permissions: { '*': ['*'] },
        isSystem: true,
      },
    });

    await prisma.dormitoryMember.create({
      data: {
        dormitoryId: testDormId,
        userId: ownerUserId,
        roleId: ownerRole.id,
        status: 'active',
        membershipOrigin: 'GOOGLE_BOOTSTRAP',
      },
    });

    // TECH role (no payment_settings permissions)
    const techRole = await prisma.role.create({
      data: {
        dormitoryId: testDormId,
        code: 'TECH',
        name: 'Technician',
        permissions: { maintenance: ['view', 'update'] },
        isSystem: false,
      },
    });

    await prisma.dormitoryMember.create({
      data: {
        dormitoryId: testDormId,
        userId: staffUserId,
        roleId: techRole.id,
        status: 'active',
      },
    });

    // MANAGER role (default permissions — no payment_settings access)
    const mgrRole = await prisma.role.create({
      data: {
        dormitoryId: testDormId,
        code: 'MANAGER',
        name: 'Manager',
        permissions: { dormitory: ['view'], billing_settings: ['view'] },
        isSystem: false,
      },
    });

    await prisma.dormitoryMember.create({
      data: {
        dormitoryId: testDormId,
        userId: managerUserId,
        roleId: mgrRole.id,
        status: 'active',
      },
    });

    // Auth tokens
    const ownerAuth = await authService.authenticateTestUser(ownerUserId);
    ownerSessionToken = ownerAuth.sessionToken;
    ownerCsrfToken = ownerAuth.csrfToken;

    const staffAuth = await authService.authenticateTestUser(staffUserId);
    staffSessionToken = staffAuth.sessionToken;
    staffCsrfToken = staffAuth.csrfToken;

    const mgrAuth = await authService.authenticateTestUser(managerUserId);
    managerSessionToken = mgrAuth.sessionToken;
    managerCsrfToken = mgrAuth.csrfToken;

    // Seed Billing Settings with encrypted payment data
    const promptPayEnc = sensitiveService.encrypt('1100700123456').ciphertext;
    const bankAccEnc = sensitiveService.encrypt('8888888888').ciphertext;

    await prisma.dormitoryBillingSettings.create({
      data: {
        dormitoryId: testDormId,
        billingDay: 25,
        dueDay: 5,
        cashAccepted: true,
        promptPayType: 'national_id',
        promptPayValue: null, // PS-006: zero plaintext storage
        promptPayValueEncrypted: promptPayEnc,
        bankCode: 'กสิกรไทย (KBank)',
        bankAccountName: 'Payment Owner Account',
        bankAccountNumber: 'XXX-XXX-8888',
        bankAccountNumberEncrypted: bankAccEnc,
      },
    });

    // ── Cross-dorm isolation setup ──────────────────────────────────────
    const crossEmail = `cross_owner_${Date.now()}@example.com`;
    const crossUser = await prisma.user.create({
      data: {
        googleSubject: `sub_cross_${Date.now()}`,
        email: crossEmail,
        emailNormalized: crossEmail.toLowerCase(),
        name: 'Cross Dorm Owner',
      },
    });
    crossOwnerUserId = crossUser.id;

    const crossDorm = await prisma.dormitory.create({
      data: {
        name: 'Cross Dorm',
        type: 'apartment',
        addressLine1: '999 Cross St',
        status: 'active',
      },
    });
    crossDormId = crossDorm.id;

    await prisma.dormitorySubscription.create({
      data: {
        dormitoryId: crossDormId,
        planId: freePlan!.id,
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 365 * 86400000),
      },
    });

    const crossRole = await prisma.role.create({
      data: {
        dormitoryId: crossDormId,
        code: 'OWNER',
        name: 'Owner',
        permissions: { '*': ['*'] },
        isSystem: true,
      },
    });

    await prisma.dormitoryMember.create({
      data: {
        dormitoryId: crossDormId,
        userId: crossOwnerUserId,
        roleId: crossRole.id,
        status: 'active',
        membershipOrigin: 'GOOGLE_BOOTSTRAP',
      },
    });

    const crossAuth = await authService.authenticateTestUser(crossOwnerUserId);
    crossOwnerSessionToken = crossAuth.sessionToken;
    crossOwnerCsrfToken = crossAuth.csrfToken;

    await prisma.dormitoryBillingSettings.create({
      data: {
        dormitoryId: crossDormId,
        billingDay: 1,
        dueDay: 10,
        cashAccepted: true,
        promptPayType: 'mobile_phone',
        promptPayValue: null,
        promptPayValueEncrypted: sensitiveService.encrypt('0811111111').ciphertext,
        bankCode: 'กรุงเทพ (Bangkok)',
        bankAccountName: 'Cross Account',
        bankAccountNumber: 'XXX-XXX-1111',
        bankAccountNumberEncrypted: sensitiveService.encrypt('1111111111').ciphertext,
      },
    });
  });

  // =========================================================================
  // PS-001 — PUBLIC BILLING DTO ISOLATION
  // =========================================================================
  describe('PS-001 — Public Billing DTO Isolation', () => {
    it('GET /billing-settings NEVER returns promptPayValueEncrypted or payment account fields', async () => {
      const res = await request(app)
        .get(`/api/v1/dormitories/${testDormId}/billing-settings`)
        .set('Cookie', [`horplus_session=${ownerSessionToken}`])
        .set('x-dormitory-id', testDormId);

      expect(res.status).toBe(200);
      const data = res.body.data;
      expect(data).toBeDefined();

      // Structural regression assertions (PS-001)
      expect(data).not.toHaveProperty('promptPayValueEncrypted');
      expect(data).not.toHaveProperty('bankAccountNumberEncrypted');
      expect(data).not.toHaveProperty('promptPayValue');
      expect(data).not.toHaveProperty('bankAccountNumber');
      expect(JSON.stringify(data)).not.toContain('promptPayValueEncrypted');
      expect(JSON.stringify(data)).not.toContain('bankAccountNumberEncrypted');

      // Verifies public billing cycle parameters exist
      expect(data.billingDay).toBe(25);
      expect(data.dueDay).toBe(5);
    });
  });

  // =========================================================================
  // PS-002 — MASKED-BY-DEFAULT GET PAYMENT SETTINGS (FINAL-002)
  // =========================================================================
  describe('PS-002 — Masked-by-Default GET Payment Settings', () => {
    it('Owner receives 200 with masked DTO — NO raw promptPayValue or bankAccountNumber', async () => {
      const res = await request(app)
        .get(`/api/v1/dormitories/${testDormId}/payment-settings`)
        .set('Cookie', [`horplus_session=${ownerSessionToken}`])
        .set('x-dormitory-id', testDormId);

      expect(res.status).toBe(200);
      const data = res.body.data;
      expect(data.promptPayType).toBe('national_id');

      // FINAL-002: Masked values ONLY
      expect(data.maskedPromptPayValue).toMatch(/X/);
      expect(data.maskedBankAccountNumber).toMatch(/X/);
      expect(data.hasPromptPay).toBe(true);
      expect(data.hasBankAccount).toBe(true);

      // NEVER return raw values
      expect(data).not.toHaveProperty('promptPayValue');
      expect(data).not.toHaveProperty('bankAccountNumber');
      expect(data).not.toHaveProperty('promptPayValueEncrypted');
      expect(data).not.toHaveProperty('bankAccountNumberEncrypted');
      expect(JSON.stringify(data)).not.toContain('promptPayValueEncrypted');
      expect(JSON.stringify(data)).not.toContain('bankAccountNumberEncrypted');
    });
  });

  // =========================================================================
  // FINAL-010 — AUTHORIZATION MATRIX
  // =========================================================================
  describe('FINAL-010 — Authorization Matrix', () => {
    it('OWNER can GET payment-settings (200)', async () => {
      const res = await request(app)
        .get(`/api/v1/dormitories/${testDormId}/payment-settings`)
        .set('Cookie', [`horplus_session=${ownerSessionToken}`])
        .set('x-dormitory-id', testDormId);

      expect(res.status).toBe(200);
    });

    it('OWNER can PATCH payment-settings (200)', async () => {
      const res = await request(app)
        .patch(`/api/v1/dormitories/${testDormId}/payment-settings`)
        .set('Cookie', [`horplus_session=${ownerSessionToken}`, `horplus_csrf=${ownerCsrfToken}`])
        .set('x-dormitory-id', testDormId)
        .set('x-csrf-token', ownerCsrfToken)
        .send({ cashAccepted: true });

      expect(res.status).toBe(200);
    });

    it('MANAGER default role is DENIED GET payment-settings (403)', async () => {
      const res = await request(app)
        .get(`/api/v1/dormitories/${testDormId}/payment-settings`)
        .set('Cookie', [`horplus_session=${managerSessionToken}`])
        .set('x-dormitory-id', testDormId);

      expect(res.status).toBe(403);
    });

    it('MANAGER default role is DENIED PATCH payment-settings (403)', async () => {
      const res = await request(app)
        .patch(`/api/v1/dormitories/${testDormId}/payment-settings`)
        .set('Cookie', [`horplus_session=${managerSessionToken}`, `horplus_csrf=${managerCsrfToken}`])
        .set('x-dormitory-id', testDormId)
        .set('x-csrf-token', managerCsrfToken)
        .send({ cashAccepted: false });

      expect(res.status).toBe(403);
    });

    it('TECH role is DENIED GET payment-settings (403)', async () => {
      const res = await request(app)
        .get(`/api/v1/dormitories/${testDormId}/payment-settings`)
        .set('Cookie', [`horplus_session=${staffSessionToken}`])
        .set('x-dormitory-id', testDormId);

      expect(res.status).toBe(403);
    });

    it('TECH role is DENIED PATCH payment-settings (403)', async () => {
      const res = await request(app)
        .patch(`/api/v1/dormitories/${testDormId}/payment-settings`)
        .set('Cookie', [`horplus_session=${staffSessionToken}`, `horplus_csrf=${staffCsrfToken}`])
        .set('x-dormitory-id', testDormId)
        .set('x-csrf-token', staffCsrfToken)
        .send({ cashAccepted: false });

      expect(res.status).toBe(403);
    });

    it('Anonymous request is DENIED GET payment-settings (401)', async () => {
      const res = await request(app)
        .get(`/api/v1/dormitories/${testDormId}/payment-settings`)
        .set('x-dormitory-id', testDormId);

      expect(res.status).toBe(401);
    });

    it('Anonymous request is DENIED PATCH payment-settings (401)', async () => {
      const res = await request(app)
        .patch(`/api/v1/dormitories/${testDormId}/payment-settings`)
        .set('x-dormitory-id', testDormId)
        .send({ cashAccepted: false });

      expect(res.status).toBe(401);
    });

    it('Cross-dorm owner is DENIED GET on another dorm (403)', async () => {
      const res = await request(app)
        .get(`/api/v1/dormitories/${testDormId}/payment-settings`)
        .set('Cookie', [`horplus_session=${crossOwnerSessionToken}`])
        .set('x-dormitory-id', testDormId);

      expect(res.status).toBe(403);
    });

    it('Cross-dorm owner is DENIED PATCH on another dorm (403)', async () => {
      const res = await request(app)
        .patch(`/api/v1/dormitories/${testDormId}/payment-settings`)
        .set('Cookie', [`horplus_session=${crossOwnerSessionToken}`, `horplus_csrf=${crossOwnerCsrfToken}`])
        .set('x-dormitory-id', testDormId)
        .set('x-csrf-token', crossOwnerCsrfToken)
        .send({ cashAccepted: false });

      expect(res.status).toBe(403);
    });
  });

  // =========================================================================
  // PS-003 — DECRYPTION FAILURE HANDLING
  // =========================================================================
  describe('PS-003 — Safe Decryption Error Handling', () => {
    it('Corrupt ciphertext produces controlled 500 error without leaking keys or raw data', async () => {
      const corruptDorm = await prisma.dormitory.create({
        data: { name: 'Corrupt Dorm', status: 'active' },
      });

      const corruptRole = await prisma.role.create({
        data: {
          dormitoryId: corruptDorm.id,
          code: 'OWNER',
          name: 'Owner',
          permissions: { '*': ['*'] },
        },
      });

      await prisma.dormitoryMember.create({
        data: {
          dormitoryId: corruptDorm.id,
          userId: ownerUserId,
          roleId: corruptRole.id,
          status: 'active',
        },
      });

      await prisma.dormitoryBillingSettings.create({
        data: {
          dormitoryId: corruptDorm.id,
          dueDay: 5,
          promptPayType: 'national_id',
          promptPayValueEncrypted: 'corrupt_invalid_ciphertext_format',
        },
      });

      const res = await request(app)
        .get(`/api/v1/dormitories/${corruptDorm.id}/payment-settings`)
        .set('Cookie', [`horplus_session=${ownerSessionToken}`])
        .set('x-dormitory-id', corruptDorm.id);

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('PAYMENT_CONFIG_DECRYPTION_FAILED');
      expect(JSON.stringify(res.body)).not.toContain('corrupt_invalid_ciphertext_format');
    });
  });

  // =========================================================================
  // PS-004 — IDEMPOTENCY HASHING WITH PAYMENT
  // =========================================================================
  describe('PS-004 — Payment Participation in Idempotency Hash', () => {
    it('Different payment details with exact same idempotency key produces 409 IDEMPOTENCY_KEY_REUSED', async () => {
      const idempUser = await prisma.user.create({
        data: {
          googleSubject: `sub_idemp_${Date.now()}`,
          email: `idemp_${Date.now()}@example.com`,
          emailNormalized: `idemp_${Date.now()}@example.com`,
          name: 'Idemp User',
        },
      });

      const idempAuth = await authService.authenticateTestUser(idempUser.id);
      const idKey = `idemp_pay_test_${Date.now()}`;

      const prepRes = await request(app)
        .post('/api/v1/onboarding/prepare')
        .set('Cookie', [`horplus_session=${idempAuth.sessionToken}`, `horplus_csrf=${idempAuth.csrfToken}`])
        .set('x-csrf-token', idempAuth.csrfToken)
        .send({ name: 'Idemp Dorm 1' });
      const provDormId = prepRes.body.data.provisionalDormitoryId;
      const pngObj = new PNG({ width: 16, height: 16 });
      for (let i = 0; i < pngObj.data.length; i += 4) {
        pngObj.data[i] = 0;
        pngObj.data[i + 1] = 0;
        pngObj.data[i + 2] = 0;
        pngObj.data[i + 3] = 255;
      }
      const validPngBuffer = PNG.sync.write(pngObj);
      const sigService = new SignatureStorageService(prisma);
      await sigService.saveSignature({ dormitoryId: provDormId, userId: idempUser.id, buffer: validPngBuffer });
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${provDormId}, true)`;
        await tx.dormitoryLineConfig.upsert({
          where: { dormitoryId: provDormId },
          create: { dormitoryId: provDormId, webhookKeyHash: `dummy_hash_${provDormId}`, accessTokenVerifiedAt: new Date(), webhookEndpointSetAt: new Date(), webhookTestSucceededAt: new Date(), webhookActive: true, isConnected: true },
          update: { accessTokenVerifiedAt: new Date(), webhookEndpointSetAt: new Date(), webhookTestSucceededAt: new Date(), webhookActive: true, isConnected: true },
        });
      });

      const quote1 = await subscriptionIntentService.createIntentQuote(idempUser.id, { isFreePlan: true }, undefined, provDormId);

      const payload1 = {
        provisionalDormitoryId: provDormId,
        packageIntentId: quote1.intentId,
        dormitory: { name: 'Idemp Dorm 1' },
        billing: { billingDay: 25, dueDay: 5 },
        payment: {
          bankCode: 'กสิกรไทย (KBank)',
          bankAccountNumber: '1111111111',
          promptPayType: 'mobile_phone',
          promptPayValue: '0812345678',
        },
        planCode: 'FREE',
      };

      const payload2ChangedPayment = {
        provisionalDormitoryId: provDormId,
        packageIntentId: quote1.intentId,
        dormitory: { name: 'Idemp Dorm 1' },
        billing: { billingDay: 25, dueDay: 5 },
        payment: {
          bankCode: 'กรุงเทพ (Bangkok)', // Changed payment!
          bankAccountNumber: '9999999999',
          promptPayType: 'mobile_phone',
          promptPayValue: '0819999999',
        },
        planCode: 'FREE',
      };

      // First call -> 200 OK
      const res1 = await request(app)
        .post('/api/v1/onboarding/complete')
        .set('Cookie', [`horplus_session=${idempAuth.sessionToken}`, `horplus_csrf=${idempAuth.csrfToken}`])
        .set('X-Idempotency-Key', idKey)
        .set('x-csrf-token', idempAuth.csrfToken)
        .send(payload1);

      expect(res1.status).toBe(200);

      // Second call with changed payment details & SAME key -> 409 IDEMPOTENCY_KEY_REUSED
      const res2 = await request(app)
        .post('/api/v1/onboarding/complete')
        .set('Cookie', [`horplus_session=${idempAuth.sessionToken}`, `horplus_csrf=${idempAuth.csrfToken}`])
        .set('X-Idempotency-Key', idKey)
        .set('x-csrf-token', idempAuth.csrfToken)
        .send(payload2ChangedPayment);

      expect(res2.status).toBe(409);
      expect(res2.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });
  });

  // =========================================================================
  // FINAL-011 — IDEMPOTENCY TEST COMPLETENESS
  // =========================================================================
  describe('FINAL-011 — Idempotency Test Completeness', () => {
    it('Exact replay of identical payload returns same dormitoryId (idempotent)', async () => {
      const replayUser = await prisma.user.create({
        data: {
          googleSubject: `sub_replay_${Date.now()}`,
          email: `replay_${Date.now()}@example.com`,
          emailNormalized: `replay_${Date.now()}@example.com`,
          name: 'Replay User',
        },
      });

      const replayAuth = await authService.authenticateTestUser(replayUser.id);
      const replayKey = `replay_${Date.now()}`;

      const prepRes = await request(app)
        .post('/api/v1/onboarding/prepare')
        .set('Cookie', [`horplus_session=${replayAuth.sessionToken}`, `horplus_csrf=${replayAuth.csrfToken}`])
        .set('x-csrf-token', replayAuth.csrfToken)
        .send({ name: 'Replay Dorm' });
      const provDormId = prepRes.body.data.provisionalDormitoryId;
      const pngObj = new PNG({ width: 16, height: 16 });
      for (let i = 0; i < pngObj.data.length; i += 4) {
        pngObj.data[i] = 0;
        pngObj.data[i + 1] = 0;
        pngObj.data[i + 2] = 0;
        pngObj.data[i + 3] = 255;
      }
      const validPngBuffer = PNG.sync.write(pngObj);
      const sigService = new SignatureStorageService(prisma);
      await sigService.saveSignature({ dormitoryId: provDormId, userId: replayUser.id, buffer: validPngBuffer });
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${provDormId}, true)`;
        await tx.dormitoryLineConfig.upsert({
          where: { dormitoryId: provDormId },
          create: { dormitoryId: provDormId, webhookKeyHash: `dummy_hash_${provDormId}`, accessTokenVerifiedAt: new Date(), webhookEndpointSetAt: new Date(), webhookTestSucceededAt: new Date(), webhookActive: true, isConnected: true },
          update: { accessTokenVerifiedAt: new Date(), webhookEndpointSetAt: new Date(), webhookTestSucceededAt: new Date(), webhookActive: true, isConnected: true },
        });
      });

      const quoteReplay = await subscriptionIntentService.createIntentQuote(replayUser.id, { isFreePlan: true }, undefined, provDormId);

      const payload = {
        provisionalDormitoryId: provDormId,
        packageIntentId: quoteReplay.intentId,
        dormitory: { name: 'Replay Dorm' },
        billing: { billingDay: 1, dueDay: 5 },
        payment: {
          bankCode: 'กสิกรไทย (KBank)',
          bankAccountNumber: '5555555555',
          promptPayType: 'mobile_phone',
          promptPayValue: '0855555555',
        },
        planCode: 'FREE',
      };

      const res1 = await request(app)
        .post('/api/v1/onboarding/complete')
        .set('Cookie', [`horplus_session=${replayAuth.sessionToken}`, `horplus_csrf=${replayAuth.csrfToken}`])
        .set('X-Idempotency-Key', replayKey)
        .set('x-csrf-token', replayAuth.csrfToken)
        .send(payload);

      expect(res1.status).toBe(200);
      const dormId1 = res1.body.data.dormitoryId;

      // Exact same payload & key -> 200 with same dormitoryId
      const res2 = await request(app)
        .post('/api/v1/onboarding/complete')
        .set('Cookie', [`horplus_session=${replayAuth.sessionToken}`, `horplus_csrf=${replayAuth.csrfToken}`])
        .set('X-Idempotency-Key', replayKey)
        .set('x-csrf-token', replayAuth.csrfToken)
        .send(payload);

      expect(res2.status).toBe(200);
      expect(res2.body.data.dormitoryId).toBe(dormId1);
    });

    it('409 on PromptPay change with same idempotency key — zero side-effect mutations', async () => {
      const mutUser = await prisma.user.create({
        data: {
          googleSubject: `sub_mut_pp_${Date.now()}`,
          email: `mut_pp_${Date.now()}@example.com`,
          emailNormalized: `mut_pp_${Date.now()}@example.com`,
          name: 'Mut PP User',
        },
      });

      const mutAuth = await authService.authenticateTestUser(mutUser.id);
      const mutKey = `mut_pp_${Date.now()}`;

      const prepRes = await request(app)
        .post('/api/v1/onboarding/prepare')
        .set('Cookie', [`horplus_session=${mutAuth.sessionToken}`, `horplus_csrf=${mutAuth.csrfToken}`])
        .set('x-csrf-token', mutAuth.csrfToken)
        .send({ name: 'MutPP Dorm' });
      const provDormId = prepRes.body.data.provisionalDormitoryId;
      const pngObj = new PNG({ width: 16, height: 16 });
      for (let i = 0; i < pngObj.data.length; i += 4) {
        pngObj.data[i] = 0;
        pngObj.data[i + 1] = 0;
        pngObj.data[i + 2] = 0;
        pngObj.data[i + 3] = 255;
      }
      const validPngBuffer = PNG.sync.write(pngObj);
      const sigService = new SignatureStorageService(prisma);
      await sigService.saveSignature({ dormitoryId: provDormId, userId: mutUser.id, buffer: validPngBuffer });
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${provDormId}, true)`;
        await tx.dormitoryLineConfig.upsert({
          where: { dormitoryId: provDormId },
          create: { dormitoryId: provDormId, webhookKeyHash: `dummy_hash_${provDormId}`, accessTokenVerifiedAt: new Date(), webhookEndpointSetAt: new Date(), webhookTestSucceededAt: new Date(), webhookActive: true, isConnected: true },
          update: { accessTokenVerifiedAt: new Date(), webhookEndpointSetAt: new Date(), webhookTestSucceededAt: new Date(), webhookActive: true, isConnected: true },
        });
      });

      const quoteMutPP = await subscriptionIntentService.createIntentQuote(mutUser.id, { isFreePlan: true }, undefined, provDormId);

      const origPayload = {
        provisionalDormitoryId: provDormId,
        packageIntentId: quoteMutPP.intentId,
        dormitory: { name: 'MutPP Dorm' },
        billing: { billingDay: 10, dueDay: 5 },
        payment: {
          bankCode: 'กรุงไทย (Krungthai)',
          bankAccountNumber: '7777777777',
          promptPayType: 'mobile_phone',
          promptPayValue: '0877777777',
        },
        planCode: 'FREE',
      };

      const res1 = await request(app)
        .post('/api/v1/onboarding/complete')
        .set('Cookie', [`horplus_session=${mutAuth.sessionToken}`, `horplus_csrf=${mutAuth.csrfToken}`])
        .set('X-Idempotency-Key', mutKey)
        .set('x-csrf-token', mutAuth.csrfToken)
        .send(origPayload);

      expect(res1.status).toBe(200);
      const dormId = res1.body.data.dormitoryId;

      // Count dormitories before mutation attempt
      const dormCountBefore = await prisma.dormitory.count({ where: { name: 'MutPP Dorm' } });

      // Changed PromptPay value
      const changedPayload = {
        ...origPayload,
        payment: {
          ...origPayload.payment,
          promptPayValue: '0899999999', // CHANGED!
        },
      };

      const res2 = await request(app)
        .post('/api/v1/onboarding/complete')
        .set('Cookie', [`horplus_session=${mutAuth.sessionToken}`, `horplus_csrf=${mutAuth.csrfToken}`])
        .set('X-Idempotency-Key', mutKey)
        .set('x-csrf-token', mutAuth.csrfToken)
        .send(changedPayload);

      expect(res2.status).toBe(409);
      expect(res2.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');

      // Assert zero side-effect mutations
      const dormCountAfter = await prisma.dormitory.count({ where: { name: 'MutPP Dorm' } });
      expect(dormCountAfter).toBe(dormCountBefore);
    });

    it('409 on bank change with same idempotency key — zero side-effect mutations', async () => {
      const mutUser = await prisma.user.create({
        data: {
          googleSubject: `sub_mut_bank_${Date.now()}`,
          email: `mut_bank_${Date.now()}@example.com`,
          emailNormalized: `mut_bank_${Date.now()}@example.com`,
          name: 'Mut Bank User',
        },
      });

      const mutAuth = await authService.authenticateTestUser(mutUser.id);
      const mutKey = `mut_bank_${Date.now()}`;

      const prepRes = await request(app)
        .post('/api/v1/onboarding/prepare')
        .set('Cookie', [`horplus_session=${mutAuth.sessionToken}`, `horplus_csrf=${mutAuth.csrfToken}`])
        .set('x-csrf-token', mutAuth.csrfToken)
        .send({ name: 'MutBank Dorm' });
      const provDormId = prepRes.body.data.provisionalDormitoryId;
      const pngObj = new PNG({ width: 16, height: 16 });
      for (let i = 0; i < pngObj.data.length; i += 4) {
        pngObj.data[i] = 0;
        pngObj.data[i + 1] = 0;
        pngObj.data[i + 2] = 0;
        pngObj.data[i + 3] = 255;
      }
      const validPngBuffer = PNG.sync.write(pngObj);
      const sigService = new SignatureStorageService(prisma);
      await sigService.saveSignature({ dormitoryId: provDormId, userId: mutUser.id, buffer: validPngBuffer });
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${provDormId}, true)`;
        await tx.dormitoryLineConfig.upsert({
          where: { dormitoryId: provDormId },
          create: { dormitoryId: provDormId, webhookKeyHash: `dummy_hash_${provDormId}`, accessTokenVerifiedAt: new Date(), webhookEndpointSetAt: new Date(), webhookTestSucceededAt: new Date(), webhookActive: true, isConnected: true },
          update: { accessTokenVerifiedAt: new Date(), webhookEndpointSetAt: new Date(), webhookTestSucceededAt: new Date(), webhookActive: true, isConnected: true },
        });
      });

      const quoteMutBank = await subscriptionIntentService.createIntentQuote(mutUser.id, { isFreePlan: true }, undefined, provDormId);

      const origPayload = {
        provisionalDormitoryId: provDormId,
        packageIntentId: quoteMutBank.intentId,
        dormitory: { name: 'MutBank Dorm' },
        billing: { billingDay: 15, dueDay: 5 },
        payment: {
          bankCode: 'ไทยพาณิชย์ (SCB)',
          bankAccountNumber: '4444444444',
          promptPayType: 'national_id',
          promptPayValue: '1234567890123',
        },
        planCode: 'FREE',
      };

      const res1 = await request(app)
        .post('/api/v1/onboarding/complete')
        .set('Cookie', [`horplus_session=${mutAuth.sessionToken}`, `horplus_csrf=${mutAuth.csrfToken}`])
        .set('X-Idempotency-Key', mutKey)
        .set('x-csrf-token', mutAuth.csrfToken)
        .send(origPayload);

      expect(res1.status).toBe(200);
      const dormId = res1.body.data.dormitoryId;

      const dormCountBefore = await prisma.dormitory.count({ where: { name: 'MutBank Dorm' } });

      // Changed bank code
      const changedPayload = {
        ...origPayload,
        payment: {
          ...origPayload.payment,
          bankCode: 'กรุงเทพ (Bangkok)', // CHANGED!
          bankAccountNumber: '6666666666', // CHANGED!
        },
      };

      const res2 = await request(app)
        .post('/api/v1/onboarding/complete')
        .set('Cookie', [`horplus_session=${mutAuth.sessionToken}`, `horplus_csrf=${mutAuth.csrfToken}`])
        .set('X-Idempotency-Key', mutKey)
        .set('x-csrf-token', mutAuth.csrfToken)
        .send(changedPayload);

      expect(res2.status).toBe(409);
      expect(res2.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');

      // Assert zero side-effect mutations
      const dormCountAfter = await prisma.dormitory.count({ where: { name: 'MutBank Dorm' } });
      expect(dormCountAfter).toBe(dormCountBefore);
    });
  });

  // =========================================================================
  // PS-005 — SERVER-SIDE PROMPTPAY & BANK VALIDATION
  // =========================================================================
  describe('PS-005 — Server-Side Validation Rules', () => {
    it('Rejects mobile_phone with 13 digits', async () => {
      const res = await request(app)
        .patch(`/api/v1/dormitories/${testDormId}/payment-settings`)
        .set('Cookie', [`horplus_session=${ownerSessionToken}`, `horplus_csrf=${ownerCsrfToken}`])
        .set('x-dormitory-id', testDormId)
        .set('x-csrf-token', ownerCsrfToken)
        .send({
          promptPayType: 'mobile_phone',
          promptPayValue: '1100700123456', // 13 digits!
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('Rejects national_id with 10 digits', async () => {
      const res = await request(app)
        .patch(`/api/v1/dormitories/${testDormId}/payment-settings`)
        .set('Cookie', [`horplus_session=${ownerSessionToken}`, `horplus_csrf=${ownerCsrfToken}`])
        .set('x-dormitory-id', testDormId)
        .set('x-csrf-token', ownerCsrfToken)
        .send({
          promptPayType: 'national_id',
          promptPayValue: '0812345678', // 10 digits!
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('Rejects bank account number shorter than 8 digits', async () => {
      const res = await request(app)
        .patch(`/api/v1/dormitories/${testDormId}/payment-settings`)
        .set('Cookie', [`horplus_session=${ownerSessionToken}`, `horplus_csrf=${ownerCsrfToken}`])
        .set('x-dormitory-id', testDormId)
        .set('x-csrf-token', ownerCsrfToken)
        .send({
          bankAccountNumber: '12345', // Only 5 digits!
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // =========================================================================
  // PS-007 — OWNER SETTINGS UPDATE LIFECYCLE (FINAL-003: PATCH returns masked DTO)
  // =========================================================================
  describe('PS-007 — Owner Payment Settings Update Lifecycle', () => {
    it('PATCH /payment-settings updates database and returns masked-only public DTO (FINAL-003)', async () => {
      const updatePayload = {
        cashAccepted: true,
        bankCode: 'ไทยพาณิชย์ (SCB)',
        bankAccountName: 'Updated Account Owner',
        bankAccountNumber: '9999999999',
        promptPayType: 'mobile_phone',
        promptPayValue: '0899999999',
      };

      const patchRes = await request(app)
        .patch(`/api/v1/dormitories/${testDormId}/payment-settings`)
        .set('Cookie', [`horplus_session=${ownerSessionToken}`, `horplus_csrf=${ownerCsrfToken}`])
        .set('x-dormitory-id', testDormId)
        .set('x-csrf-token', ownerCsrfToken)
        .send(updatePayload);

      expect(patchRes.status).toBe(200);
      const patchData = patchRes.body.data;

      // FINAL-003: PATCH response is masked-only DTO (same shape as GET)
      expect(patchData.bankCode).toBe('ไทยพาณิชย์ (SCB)');
      expect(patchData.promptPayType).toBe('mobile_phone');
      expect(patchData.maskedPromptPayValue).toMatch(/089-XXX-9999/);
      expect(patchData.maskedBankAccountNumber).toMatch(/X/);
      expect(patchData.hasPromptPay).toBe(true);
      expect(patchData.hasBankAccount).toBe(true);
      expect(patchData.bankAccountName).toBe('Updated Account Owner');

      // NEVER return raw values in PATCH response
      expect(patchData).not.toHaveProperty('promptPayValue');
      expect(patchData).not.toHaveProperty('bankAccountNumber');
      expect(patchData).not.toHaveProperty('promptPayValueEncrypted');
      expect(patchData).not.toHaveProperty('bankAccountNumberEncrypted');

      // Verify Database state
      const dbSettings = await prisma.dormitoryBillingSettings.findUnique({
        where: { dormitoryId: testDormId },
      });

      expect(dbSettings?.promptPayValue).toBeNull(); // PS-006: zero plaintext
      expect(dbSettings?.promptPayValueEncrypted).not.toBeNull();
      expect(dbSettings?.bankAccountNumberEncrypted).not.toBeNull();

      // Readback GET /payment-settings — also masked-only
      const getRes = await request(app)
        .get(`/api/v1/dormitories/${testDormId}/payment-settings`)
        .set('Cookie', [`horplus_session=${ownerSessionToken}`])
        .set('x-dormitory-id', testDormId);

      expect(getRes.status).toBe(200);
      const getData = getRes.body.data;
      expect(getData.bankCode).toBe('ไทยพาณิชย์ (SCB)');
      expect(getData.maskedPromptPayValue).toMatch(/089-XXX-9999/);
      expect(getData).not.toHaveProperty('promptPayValue');
      expect(getData).not.toHaveProperty('bankAccountNumber');
    });

    it('PATCH omitting masked payment fields preserves existing encrypted values', async () => {
      // Get DB ciphertext before PATCH
      const dbBefore = await prisma.dormitoryBillingSettings.findUnique({
        where: { dormitoryId: testDormId },
      });
      const encBefore = dbBefore?.promptPayValueEncrypted;

      // PATCH omitting promptPay fields (only sending bankAccountName) — must preserve existing ciphertext
      const patchRes = await request(app)
        .patch(`/api/v1/dormitories/${testDormId}/payment-settings`)
        .set('Cookie', [`horplus_session=${ownerSessionToken}`, `horplus_csrf=${ownerCsrfToken}`])
        .set('x-dormitory-id', testDormId)
        .set('x-csrf-token', ownerCsrfToken)
        .send({
          bankAccountName: 'Preserved Test',
        });

      expect(patchRes.status).toBe(200);

      // Verify ciphertext was NOT re-encrypted (preserved)
      const dbAfter = await prisma.dormitoryBillingSettings.findUnique({
        where: { dormitoryId: testDormId },
      });
      expect(dbAfter?.promptPayValueEncrypted).toBe(encBefore);
      expect(dbAfter?.bankAccountName).toBe('Preserved Test');
    });

    it('OR-002 / Amendment 1 — PATCH with masked value containing X returns 400 VALIDATION_ERROR', async () => {
      const patchRes = await request(app)
        .patch(`/api/v1/dormitories/${testDormId}/payment-settings`)
        .set('Cookie', [`horplus_session=${ownerSessionToken}`, `horplus_csrf=${ownerCsrfToken}`])
        .set('x-dormitory-id', testDormId)
        .set('x-csrf-token', ownerCsrfToken)
        .send({
          promptPayValue: '089-XXX-9999',
        });

      expect(patchRes.status).toBe(400);
      expect(patchRes.body.error.code).toBe('VALIDATION_ERROR');
      expect(patchRes.body.error.fieldErrors[0].message).toContain('ไม่สามารถส่งค่าที่ซ่อน (X)');
    });

    it('OR-003 — National-ID type preservation: PATCH bankCode only preserves national_id type and ciphertext', async () => {
      const nationalIdDormId = crypto.randomUUID();
      const natUserId = crypto.randomUUID();
      const natRoleId = crypto.randomUUID();

      await prisma.dormitory.create({
        data: {
          id: nationalIdDormId,
          name: 'National ID Test Dorm',
          code: `NAT-${Date.now().toString().slice(-4)}`,
          status: 'active',
        },
      });

      const userRes = await prisma.user.create({
        data: {
          id: natUserId,
          googleSubject: `gsub_nat_${Date.now()}`,
          email: `nat_owner_${Date.now()}@example.com`,
          emailNormalized: `nat_owner_${Date.now()}@example.com`,
          name: 'Nat Owner',
        },
      });

      await prisma.role.create({
        data: {
          id: natRoleId,
          dormitoryId: nationalIdDormId,
          code: 'OWNER',
          name: 'Owner',
          permissions: { '*': ['*'] },
          isSystem: true,
        },
      });

      await prisma.dormitoryMember.create({
        data: {
          dormitoryId: nationalIdDormId,
          userId: natUserId,
          roleId: natRoleId,
          status: 'active',
          membershipOrigin: 'GOOGLE_BOOTSTRAP',
        },
      });

      const freePlan = await prisma.subscriptionPlan.findFirst({ where: { code: 'FREE' } });
      await prisma.dormitorySubscription.create({
        data: {
          dormitoryId: nationalIdDormId,
          planId: freePlan!.id,
          status: 'ACTIVE',
          expiresAt: new Date(Date.now() + 365 * 86400000),
        },
      });

      const natAuth = await authService.authenticateTestUser(natUserId);
      const natSessionToken = natAuth.sessionToken;
      const natCsrfToken = natAuth.csrfToken;

      const encryptedNatId = sensitiveService.encrypt('1100700123456').ciphertext;

      await prisma.dormitoryBillingSettings.create({
        data: {
          dormitoryId: nationalIdDormId,
          dueDay: 5,
          promptPayType: 'national_id',
          promptPayValueEncrypted: encryptedNatId,
          bankCode: 'กรุงไทย (Krungthai)',
        },
      });

      // Send PATCH containing ONLY bankCode (no promptPayValue, no promptPayType)
      const patchRes = await request(app)
        .patch(`/api/v1/dormitories/${nationalIdDormId}/payment-settings`)
        .set('Cookie', [`horplus_session=${natSessionToken}`, `horplus_csrf=${natCsrfToken}`])
        .set('x-dormitory-id', nationalIdDormId)
        .set('x-csrf-token', natCsrfToken)
        .send({
          bankCode: 'กสิกรไทย (KBank)',
        });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.data.bankCode).toBe('กสิกรไทย (KBank)');
      expect(patchRes.body.data.promptPayType).toBe('national_id');

      // Verify DB after PATCH
      const dbSettings = await prisma.dormitoryBillingSettings.findUnique({
        where: { dormitoryId: nationalIdDormId },
      });
      expect(dbSettings?.promptPayType).toBe('national_id');
      expect(dbSettings?.promptPayValueEncrypted).toBe(encryptedNatId);
      expect(dbSettings?.bankCode).toBe('กสิกรไทย (KBank)');
    });

    it('OR-004 — Fail-closed PATCH decryption: returns 500 PAYMENT_CONFIG_DECRYPTION_FAILED without DB mutation', async () => {
      const corruptDormId = crypto.randomUUID();
      const corruptUserId = crypto.randomUUID();
      const corruptRoleId = crypto.randomUUID();

      await prisma.dormitory.create({
        data: {
          id: corruptDormId,
          name: 'Corrupt Ciphertext Test Dorm',
          code: `CRP-${Date.now().toString().slice(-4)}`,
          status: 'active',
        },
      });

      await prisma.user.create({
        data: {
          id: corruptUserId,
          googleSubject: `gsub_crp_${Date.now()}`,
          email: `crp_owner_${Date.now()}@example.com`,
          emailNormalized: `crp_owner_${Date.now()}@example.com`,
          name: 'Corrupt Owner',
        },
      });

      await prisma.role.create({
        data: {
          id: corruptRoleId,
          dormitoryId: corruptDormId,
          code: 'OWNER',
          name: 'Owner',
          permissions: { '*': ['*'] },
          isSystem: true,
        },
      });

      await prisma.dormitoryMember.create({
        data: {
          dormitoryId: corruptDormId,
          userId: corruptUserId,
          roleId: corruptRoleId,
          status: 'active',
          membershipOrigin: 'GOOGLE_BOOTSTRAP',
        },
      });

      const freePlan = await prisma.subscriptionPlan.findFirst({ where: { code: 'FREE' } });
      await prisma.dormitorySubscription.create({
        data: {
          dormitoryId: corruptDormId,
          planId: freePlan!.id,
          status: 'ACTIVE',
          expiresAt: new Date(Date.now() + 365 * 86400000),
        },
      });

      const corruptAuth = await authService.authenticateTestUser(corruptUserId);
      const corruptSessionToken = corruptAuth.sessionToken;
      const corruptCsrfToken = corruptAuth.csrfToken;

      // Seed corrupt ciphertext directly in DB
      await prisma.dormitoryBillingSettings.create({
        data: {
          dormitoryId: corruptDormId,
          dueDay: 5,
          promptPayType: 'mobile_phone',
          promptPayValueEncrypted: 'corrupt.ciphertext.invalidtag',
          bankCode: 'กรุงเทพ (Bangkok)',
        },
      });

      // Attempt PATCH of unrelated field (bankCode)
      const patchRes = await request(app)
        .patch(`/api/v1/dormitories/${corruptDormId}/payment-settings`)
        .set('Cookie', [`horplus_session=${corruptSessionToken}`, `horplus_csrf=${corruptCsrfToken}`])
        .set('x-dormitory-id', corruptDormId)
        .set('x-csrf-token', corruptCsrfToken)
        .send({
          bankCode: 'ไทยพาณิชย์ (SCB)',
        });

      expect(patchRes.status).toBe(500);
      expect(patchRes.body.error.code).toBe('PAYMENT_CONFIG_DECRYPTION_FAILED');

      // Assert DB settings remain untouched (bankCode NOT updated to SCB)
      const dbSettings = await prisma.dormitoryBillingSettings.findUnique({
        where: { dormitoryId: corruptDormId },
      });
      expect(dbSettings?.bankCode).toBe('กรุงเทพ (Bangkok)');
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });
});
