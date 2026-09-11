import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { getPrismaClient } from '../../db/prisma.js';
import { DormitoryProvisioningService } from '../../services/dormitory-provisioning.service.js';
import { subscriptionIntentService } from '../../services/subscription-intent.service.js';
import { SensitiveFieldService } from '../../services/sensitive-field.service.js';
import { createOnboardingRouter } from '../../routes/onboarding.routes.js';
import { cookieParserMiddleware } from '../../middleware/cookie-parser.middleware.js';
import { SignatureStorageService } from '../../services/signature-storage.service.js';
import { PNG } from 'pngjs';
import crypto from 'crypto';
import {
  mapRegistrationFormDataToFinalizePayload,
  getRegistrationInitialFormData,
} from '../../../../src/pages/owner/register.js';
import {
  OnboardingBillingInputSchema,
  OnboardingDormitoryInputSchema,
} from '../../types/onboarding-validation.js';

describe('Round 2.4J.2: Registration Forensic Root Cause & Logo Boundary Integration Tests', () => {
  const prisma = getPrismaClient();
  const sensitiveFieldService = new SensitiveFieldService('12345678901234567890123456789012');
  const provisioningService = new DormitoryProvisioningService(prisma, sensitiveFieldService);

  const createTestUserAndApp = async () => {
    const userId = crypto.randomUUID();
    const testEmail = `owner.24j2.${Date.now()}.${Math.random().toString(36).slice(2, 6)}@example.com`;
    await prisma.user.create({
      data: {
        id: userId,
        email: testEmail,
        emailNormalized: testEmail.toLowerCase(),
        name: 'เจ้าของหอพัก 24J2 Forensics',
        googleSubject: `google-sub-${Date.now()}-${Math.random()}`,
      },
    });

    const app = express();
    app.use(express.json());
    app.use(cookieParserMiddleware);

    const mockAuthService = {
      validateSession: async () => ({
        user: { id: userId, name: 'เจ้าของหอพัก 24J2 Forensics' },
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

  const buildValidFormData = (dormName: string, withLogo: boolean) => {
    const form = getRegistrationInitialFormData();
    form.dormName = dormName;
    form.dormAddress = '123/45 ซอยสุขุมวิท 55';
    form.subdistrict = 'คลองตันเหนือ';
    form.district = 'วัฒนา';
    form.province = 'กรุงเทพมหานคร';
    form.postalCode = '10110';
    form.logoUrl = withLogo ? 'https://images.horplus.com/dormitories/logo-512x512-test.png' : null;
    form.hasLogo = withLogo;

    // Building with 2 floors x 2 rooms = 4 rooms
    form.buildings = [
      {
        id: 'bld-1',
        name: 'อาคาร A',
        totalFloors: 2,
        roomsPerFloor: 2,
        hasElevator: false,
        roomPrefix: 'A',
        formatPattern: 'floor_room',
        mode: 'auto',
        customRooms: [],
        termDeposit: 6000,
        monthlyDeposit: 3000,
        dailyDeposit: 500,
        securityDeposit: 3000,
        rentRates: {
          monthly: 3500,
          term: 14000,
          termMonths: 4,
          maxInstallmentMonths: 2,
          daily: 500,
          maxOccupants: 2,
        },
      },
    ];

    form.utilities = {
      ...form.utilities,
      waterBillingMode: 'unit',
      waterRate: 18,
      electricBillingMode: 'unit',
      electricRate: 8,
    };

    form.deposits = {
      securityDeposit: 3000,
      advanceRentMonths: 1,
      dueDateDay: 5,
      gracePeriodDays: 2,
      lateFeeType: 'fixed_once', // UI Step 4 sets fixed_once
      lateFeeAmount: 50,
    };

    form.paymentAccount = {
      bankName: 'KBANK',
      accountNumber: '123-4-56789-0',
      accountName: 'คุณเจ้าของหอ',
      bankAccountName: 'คุณเจ้าของหอ',
      promptPayId: '0811112222',
      promptPayName: 'คุณเจ้าของหอ',
    };

    return form;
  };

  // =========================================================================
  // Case A: Real frontend mapper WITH logo -> Finalize -> DB verification
  // =========================================================================
  it('Case A: Real frontend mapper WITH logo sends valid payload, finalizes successfully, and persists logoObjectKey', async () => {
    const { userId, app } = await createTestUserAndApp();

    const dormName = 'หอพัก 24J2 มีโลโก้ จริง';
    const prep = await provisioningService.prepareProvisionalDormitory(userId, { name: dormName });
    const provDormId = prep.provisionalDormitoryId;

    // S3 presigned upload simulates logoObjectKey already stored on provisional dormitory
    const s3LogoKey = `dormitories/${provDormId}/logos/logo-512x512-test.png`;
    await prisma.dormitory.update({
      where: { id: provDormId },
      data: { logoObjectKey: s3LogoKey },
    });

    await uploadSignatureForDorm(provDormId, userId);
    const quote = await subscriptionIntentService.createIntentQuote(userId, { isFreePlan: true }, undefined, provDormId);

    const formData = buildValidFormData(dormName, true);

    // Use the REAL frontend mapping authority
    const finalizePayload = mapRegistrationFormDataToFinalizePayload({
      provDormId,
      formData,
      activeIntentId: quote.intentId,
      selectedPlan: 'free',
    });

    // Assert shape sent to POST /api/v1/onboarding/finalize
    expect(finalizePayload.provisionalDormitoryId).toBe(provDormId);
    expect(finalizePayload.packageIntentId).toBe(quote.intentId);
    expect(finalizePayload.dormitory.logoUrl).toBe('https://images.horplus.com/dormitories/logo-512x512-test.png');
    expect(finalizePayload.billing.lateFeeType).toBe('fixed'); // normalized from fixed_once
    expect(finalizePayload.rooms.length).toBe(4);

    const res = await request(app)
      .post('/api/v1/onboarding/finalize')
      .set('Cookie', 'horplus_session=session-token; horplus_csrf=valid-csrf')
      .set('x-csrf-token', 'valid-csrf')
      .send(finalizePayload);

    if (res.status !== 200) {
      console.error('Case A Error:', JSON.stringify(res.body, null, 2));
    }
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.dormitoryId).toBe(provDormId);

    // Verify DB persistence: logoObjectKey preserved
    const savedDorm = await prisma.dormitory.findUnique({
      where: { id: provDormId },
    });
    expect(savedDorm).toBeDefined();
    expect(savedDorm?.logoObjectKey).toBe(s3LogoKey);
  });

  // =========================================================================
  // Case B: Real frontend mapper WITHOUT logo -> Finalize -> DB verification
  // =========================================================================
  it('Case B: Real frontend mapper WITHOUT logo sends valid payload, finalizes successfully, with null logoObjectKey', async () => {
    const { userId, app } = await createTestUserAndApp();

    const dormName = 'หอพัก 24J2 ไม่มีโลโก้';
    const prep = await provisioningService.prepareProvisionalDormitory(userId, { name: dormName });
    const provDormId = prep.provisionalDormitoryId;

    await uploadSignatureForDorm(provDormId, userId);
    const quote = await subscriptionIntentService.createIntentQuote(userId, { isFreePlan: true }, undefined, provDormId);

    const formData = buildValidFormData(dormName, false);

    const finalizePayload = mapRegistrationFormDataToFinalizePayload({
      provDormId,
      formData,
      activeIntentId: quote.intentId,
      selectedPlan: 'free',
    });

    expect(finalizePayload.provisionalDormitoryId).toBe(provDormId);
    expect(finalizePayload.packageIntentId).toBe(quote.intentId);
    expect(finalizePayload.dormitory.logoUrl).toBeNull();
    expect(finalizePayload.billing.lateFeeType).toBe('fixed');

    const res = await request(app)
      .post('/api/v1/onboarding/finalize')
      .set('Cookie', 'horplus_session=session-token; horplus_csrf=valid-csrf')
      .set('x-csrf-token', 'valid-csrf')
      .send(finalizePayload);

    if (res.status !== 200) {
      console.error('Case B Error:', JSON.stringify(res.body, null, 2));
    }
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.dormitoryId).toBe(provDormId);

    const savedDorm = await prisma.dormitory.findUnique({
      where: { id: provDormId },
    });
    expect(savedDorm).toBeDefined();
    expect(savedDorm?.logoObjectKey).toBeNull();
  });

  // =========================================================================
  // Case C: Forensic Root Cause Proof
  // =========================================================================
  describe('Case C: Forensic Root Cause Proof & Boundary Verification', () => {
    it('proves original pre-fix backend schema rejected "fixed_once" and "logoUrl", while current production code accepts and normalizes both', () => {
      // 1. Recreate the EXACT pre-fix schema (prior to commit 22634798225907af9273a973147c611bb00cd838)
      const PreFixOnboardingDormitorySchema = z.object({
        name: z.string().trim().min(1),
        type: z.string().optional().nullable(),
        addressLine1: z.string().optional().nullable(),
      }).strict(); // strictly NO logoUrl field existed

      const PreFixOnboardingBillingSchema = z.object({
        dueDay: z.coerce.number().int().min(1).max(28),
        waterBillingType: z.string(),
        waterRate: z.string().regex(/^\d+(\.\d{1,2})?$/),
        electricityBillingType: z.string(),
        electricityRate: z.string().regex(/^\d+(\.\d{1,2})?$/),
        lateFeeType: z.enum(['fixed', 'per_day', 'percentage', 'none']), // strictly NO 'fixed_once' existed
        lateFeeValue: z.string().regex(/^\d+(\.\d{1,2})?$/),
      }).strict();

      // Proof 1: UI Step 4 sets deposits.lateFeeType = 'fixed_once'
      const form = buildValidFormData('หอพักนิติเวช', true);
      expect(form.deposits.lateFeeType).toBe('fixed_once');

      // Proof 2: Direct pre-fix schema validation on lateFeeType fails with invalid_enum_value
      const preFixBillingResult = PreFixOnboardingBillingSchema.safeParse({
        dueDay: 5,
        waterBillingType: 'unit',
        waterRate: '18.00',
        electricityBillingType: 'unit',
        electricityRate: '8.00',
        lateFeeType: form.deposits.lateFeeType, // 'fixed_once'
        lateFeeValue: '50.00',
      });
      expect(preFixBillingResult.success).toBe(false);
      if (!preFixBillingResult.success) {
        const issue = preFixBillingResult.error.issues.find((i) => i.path.includes('lateFeeType'));
        expect(issue).toBeDefined();
        expect(issue?.code).toBe('invalid_enum_value');
      }

      // Proof 3: Direct pre-fix schema validation on dormitory with logoUrl fails with unrecognized_keys
      const preFixDormResult = PreFixOnboardingDormitorySchema.safeParse({
        name: 'หอพักทดสอบ',
        addressLine1: '123/45 ซอยสุขุมวิท',
        logoUrl: 'https://images.horplus.com/dormitories/logo-123.png',
      });
      expect(preFixDormResult.success).toBe(false);
      if (!preFixDormResult.success) {
        const issue = preFixDormResult.error.issues.find((i) => i.code === 'unrecognized_keys');
        expect(issue).toBeDefined();
      }

      // Proof 4: Under CURRENT production code, mapRegistrationFormDataToFinalizePayload normalizes 'fixed_once' -> 'fixed'
      const mappedPayload = mapRegistrationFormDataToFinalizePayload({
        provDormId: '00000000-0000-0000-0000-000000000000',
        formData: form,
        activeIntentId: '',
        selectedPlan: 'free',
      });
      expect(mappedPayload.billing.lateFeeType).toBe('fixed');
      expect(mappedPayload.dormitory.logoUrl).toBe('https://images.horplus.com/dormitories/logo-512x512-test.png');

      // Proof 5: Current backend schemas accept both without error
      const currentBillingResult = OnboardingBillingInputSchema.safeParse(mappedPayload.billing);
      expect(currentBillingResult.success).toBe(true);

      const currentDormResult = OnboardingDormitoryInputSchema.safeParse(mappedPayload.dormitory);
      expect(currentDormResult.success).toBe(true);
    });

    it('proves OnboardingDormitoryInputSchema accepts logoUrl as string or null, preserving logo boundary integrity', () => {
      // With logo URL
      const withLogoResult = OnboardingDormitoryInputSchema.safeParse({
        name: 'หอพักทดสอบโลโก้',
        addressLine1: '123 ซอยทดสอบ',
        logoUrl: 'https://images.horplus.com/dormitories/logo-123.png',
      });
      expect(withLogoResult.success).toBe(true);

      // Without logo (null)
      const noLogoResult = OnboardingDormitoryInputSchema.safeParse({
        name: 'หอพักทดสอบไม่มีโลโก้',
        addressLine1: '123 ซอยทดสอบ',
        logoUrl: null,
      });
      expect(noLogoResult.success).toBe(true);

      // Strict schema rejects un-modeled properties (e.g. invalid extraneous key)
      const extraneousResult = OnboardingDormitoryInputSchema.safeParse({
        name: 'หอพักทดสอบ',
        addressLine1: '123 ซอยทดสอบ',
        extraneousLegacyField: 'should-fail-under-strict',
      });
      expect(extraneousResult.success).toBe(false);
    });
  });
});
