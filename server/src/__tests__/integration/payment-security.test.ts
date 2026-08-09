/**
 * Payment Security & Idempotency Integration Tests (Task-009 — PS-001 to PS-010)
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
import { DormitoryProvisioningService } from '../../services/dormitory-provisioning.service.js';
import { InMemoryIdempotencyRepository } from '../../db/repositories/idempotency.repository.js';

const prisma = getPrismaClient();
const sensitiveService = new SensitiveFieldService(getEnv().FIELD_ENCRYPTION_KEY, 1);

describe('Payment Security & Idempotency Boundary (PS-001 to PS-010)', () => {
  let app: any;
  let authService: AuthenticationService;
  let ownerUserId: string;
  let ownerSessionToken: string;
  let staffUserId: string;
  let staffSessionToken: string;
  let testDormId: string;
  let csrfToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.E2E_TEST_MODE = 'true';
    resetCachedEnv();
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

    // 1. Seed Owner user
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

    // 2. Seed Staff user (without payment permissions)
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

    // 3. Create Dormitory with OWNER role
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

    // Staff role without payment_settings permissions
    const staffRole = await prisma.role.create({
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
        roleId: staffRole.id,
        status: 'active',
      },
    });

    const ownerAuth = await authService.authenticateTestUser(ownerUserId);
    ownerSessionToken = ownerAuth.sessionToken;
    csrfToken = ownerAuth.csrfToken;

    const staffAuth = await authService.authenticateTestUser(staffUserId);
    staffSessionToken = staffAuth.sessionToken;

    // Seed Billing Settings
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
      expect(data.waterBillingType).toBe('per_unit');
    });
  });

  // =========================================================================
  // PS-002 — SENSITIVE PROMPTPAY AUTHORIZATION
  // =========================================================================
  describe('PS-002 — Sensitive Payment Read Authorization', () => {
    it('Owner with payment_settings:view receives 200 and decrypted values', async () => {
      const res = await request(app)
        .get(`/api/v1/dormitories/${testDormId}/payment-settings`)
        .set('Cookie', [`horplus_session=${ownerSessionToken}`])
        .set('x-dormitory-id', testDormId);

      expect(res.status).toBe(200);
      expect(res.body.data.promptPayType).toBe('national_id');
      expect(res.body.data.promptPayValue).toBe('1100700123456');
      expect(res.body.data.maskedPromptPayValue).toBe('1-1007-XXXXX-45-6');
      expect(res.body.data.bankAccountNumber).toBe('8888888888');
      expect(res.body.data.maskedBankAccountNumber).toBe('XXX-XXX-8888');

      // Structural regression (PS-001 & PS-002)
      expect(res.body.data).not.toHaveProperty('promptPayValueEncrypted');
      expect(JSON.stringify(res.body.data)).not.toContain('promptPayValueEncrypted');
    });

    it('Staff without payment_settings:view is DENIED 403 Forbidden', async () => {
      const res = await request(app)
        .get(`/api/v1/dormitories/${testDormId}/payment-settings`)
        .set('Cookie', [`horplus_session=${staffSessionToken}`])
        .set('x-dormitory-id', testDormId);

      expect(res.status).toBe(403);
    });

    it('Anonymous request is DENIED 401 Unauthorized', async () => {
      const res = await request(app)
        .get(`/api/v1/dormitories/${testDormId}/payment-settings`)
        .set('x-dormitory-id', testDormId);

      expect(res.status).toBe(401);
    });
  });

  // =========================================================================
  // PS-003 — DECRYPTION FAILURE HANDLING
  // =========================================================================
  describe('PS-003 — Safe Decryption Error Handling', () => {
    it('Corrupt ciphertext produces controlled 500 error without leaking keys or raw data', async () => {
      // Seed a dorm with corrupt ciphertext
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

      const payload1 = {
        dormitory: { name: 'Idemp Dorm 1' },
        billing: { billingDay: 25 },
        payment: {
          bankCode: 'กสิกรไทย (KBank)',
          bankAccountNumber: '1111111111',
          promptPayType: 'mobile_phone',
          promptPayValue: '0812345678',
        },
        planCode: 'FREE',
      };

      const payload2ChangedPayment = {
        dormitory: { name: 'Idemp Dorm 1' },
        billing: { billingDay: 25 },
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
  // PS-005 — SERVER-SIDE PROMPTPAY & BANK VALIDATION
  // =========================================================================
  describe('PS-005 — Server-Side Validation Rules', () => {
    it('Rejects mobile_phone with 13 digits', async () => {
      const res = await request(app)
        .patch(`/api/v1/dormitories/${testDormId}/payment-settings`)
        .set('Cookie', [`horplus_session=${ownerSessionToken}`, `horplus_csrf=${csrfToken}`])
        .set('x-dormitory-id', testDormId)
        .set('x-csrf-token', csrfToken)
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
        .set('Cookie', [`horplus_session=${ownerSessionToken}`, `horplus_csrf=${csrfToken}`])
        .set('x-dormitory-id', testDormId)
        .set('x-csrf-token', csrfToken)
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
        .set('Cookie', [`horplus_session=${ownerSessionToken}`, `horplus_csrf=${csrfToken}`])
        .set('x-dormitory-id', testDormId)
        .set('x-csrf-token', csrfToken)
        .send({
          bankAccountNumber: '12345', // Only 5 digits!
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // =========================================================================
  // PS-007 — OWNER SETTINGS UPDATE LIFECYCLE (GET & PATCH)
  // =========================================================================
  describe('PS-007 — Owner Payment Settings Update Lifecycle', () => {
    it('PATCH /payment-settings updates database and returns clean public DTO', async () => {
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
        .set('Cookie', [`horplus_session=${ownerSessionToken}`, `horplus_csrf=${csrfToken}`])
        .set('x-dormitory-id', testDormId)
        .set('x-csrf-token', csrfToken)
        .send(updatePayload);

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.data.bankCode).toBe('ไทยพาณิชย์ (SCB)');
      expect(patchRes.body.data.promptPayType).toBe('mobile_phone');
      expect(patchRes.body.data.promptPayValue).toBe('0899999999');
      expect(patchRes.body.data.maskedPromptPayValue).toBe('089-XXX-9999');

      // Verify Database state
      const dbSettings = await prisma.dormitoryBillingSettings.findUnique({
        where: { dormitoryId: testDormId },
      });

      expect(dbSettings?.promptPayValue).toBeNull(); // PS-006: zero plaintext
      expect(dbSettings?.promptPayValueEncrypted).not.toBeNull();
      expect(dbSettings?.bankAccountNumberEncrypted).not.toBeNull();

      // Readback GET /payment-settings
      const getRes = await request(app)
        .get(`/api/v1/dormitories/${testDormId}/payment-settings`)
        .set('Cookie', [`horplus_session=${ownerSessionToken}`])
        .set('x-dormitory-id', testDormId);

      expect(getRes.status).toBe(200);
      expect(getRes.body.data.bankCode).toBe('ไทยพาณิชย์ (SCB)');
      expect(getRes.body.data.promptPayValue).toBe('0899999999');
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });
});
