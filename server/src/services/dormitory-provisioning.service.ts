/**
 * Dormitory Provisioning & Onboarding Finalization Service (Task-009 — 6-Step Master Flow)
 * @license Apache-2.0
 */

import nodeCrypto from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '../types/index.js';
import { SensitiveFieldService } from './sensitive-field.service.js';
import { subscriptionEntitlementService } from './subscription-entitlement.service.js';
import { addCalendarMonths } from '../utils/calendar-math.js';
import { normalizeRoomIdentifier } from '../utils/normalization.js';
import { decryptText, generateOpaqueWebhookKey } from '../utils/crypto-encryption.js';
import { IIdempotencyRepository, InMemoryIdempotencyRepository } from '../db/repositories/idempotency.repository.js';
import { getPublicWebhookOrigin } from './line-oa.service.js';
import { promoService } from './promo.service.js';
import { referralService } from './referral.service.js';
import { coinWalletService } from './coin-wallet.service.js';
import { subscriptionIntentService } from './subscription-intent.service.js';
import { normalizeUtilityBillingMode } from '../utils/billing-mode-normalizer.util.js';
import { LATE_FEE_GRACE_DAYS } from '../utils/monthly-utility-calculator.util.js';
import { CanonicalTierRecord, validateCanonicalUtilityTiers } from '../utils/utility-tier-validator.util.js';

export interface CompleteOwnerOnboardingParams {
  userId: string;
  idempotencyKey: string;
  provisionalDormitoryId?: string;
  dormitory: {
    name: string;
    type?: string | null;
    genderPolicy?: string | null;
    addressLine1?: string | null;
    addressLine2?: string | null;
    subdistrict?: string | null;
    district?: string | null;
    province?: string | null;
    postalCode?: string | null;
    phone?: string | null;
    email?: string | null;
    estimatedBuildingCount?: number;
    estimatedRoomCount?: number;
  };
  billing?: {
    billingDay?: number | null;
    dueDay?: number;
    waterBillingType?: string;
    waterRate?: string;
    waterTierRates?: CanonicalTierRecord[] | null;
    electricityBillingType?: string;
    electricityRate?: string;
    electricityTierRates?: CanonicalTierRecord[] | null;
    commonFee?: string;
    commonFeeMode?: string | null;
    internetFee?: string;
    internetFeeMode?: string | null;
    parkingRate?: string | null;
    parkingFeeMode?: string | null;
    gracePeriodDays?: number | null;
    advanceRentMonths?: number | null;
    lateFeeType?: string;
    lateFeeValue?: string;
    rentBillingType?: string;
  };
  payment?: {
    cashAccepted?: boolean;
    promptPayType?: string | null;
    promptPayValue?: string | null;
    promptPayAccountName?: string | null;
    bankCode?: string | null;
    bankAccountName?: string | null;
    bankAccountNumber?: string | null;
  };
  buildings?: {
    id: string;
    name: string;
    code?: string | null;
    floorsCount: number;
    roomsPerFloor?: number | null;
    roomPrefix?: string | null;
    hasElevator?: boolean | null;
    numberingPattern?: string | null;
    formatPattern?: string | null;
    description?: string | null;
    monthlyRent?: number | null;
    dailyRent?: number | null;
    termRent?: number | null;
    termMonths?: number | null;
    maxInstallmentMonths?: number | null;
    depositAmount?: number | null;
    securityDeposit?: number | null;
    termDeposit?: number | null;
    monthlyDeposit?: number | null;
    dailyDeposit?: number | null;
    maximumOccupants?: number | null;
  }[];
  rooms?: {
    buildingId?: string;
    roomNumber: string;
    floor: number;
    monthlyRent: number;
    dailyRent?: number | null;
    termRent?: number | null;
    termMonths?: number | null;
    depositAmount?: number | null;
    securityDeposit?: number | null;
    termDeposit?: number | null;
    monthlyDeposit?: number | null;
    dailyDeposit?: number | null;
    depositInheritsBuildingDefault?: boolean | null;
    parkingFee?: number;
    maximumOccupants?: number;
    initialWaterReading?: number;
    initialElectricityReading?: number;
    status?: string;
  }[];

  planCode?: string;
  packageId?: string;
  packageIntentId?: string;
  promoCode?: string;
  referralCode?: string;
  coinApplied?: number;
  requestId?: string;
  rules?: string;
  defaultTerms?: string;
  petPolicy?: {
    allowed: string;
    allowedTypes?: string[];
  };
  ownerSignatureUrl?: string;
}

export class DormitoryProvisioningService {
  private prisma: PrismaClient;
  private sensitiveFieldService: SensitiveFieldService;
  private idempotencyRepo: IIdempotencyRepository;

  constructor(
    prismaOrRepo: any,
    sensitiveFieldServiceOrRepo?: any,
    ...rest: any[]
  ) {
    this.idempotencyRepo = new InMemoryIdempotencyRepository();
    if (prismaOrRepo && typeof prismaOrRepo.$transaction === 'function') {
      this.prisma = prismaOrRepo;
      this.sensitiveFieldService =
        sensitiveFieldServiceOrRepo instanceof SensitiveFieldService
          ? sensitiveFieldServiceOrRepo
          : new SensitiveFieldService();
    } else {
      const lastArg = rest[rest.length - 1];
      this.prisma = lastArg && typeof lastArg.$transaction === 'function' ? lastArg : (prismaOrRepo as PrismaClient);
      this.sensitiveFieldService =
        sensitiveFieldServiceOrRepo instanceof SensitiveFieldService
          ? sensitiveFieldServiceOrRepo
          : new SensitiveFieldService();

      const candidateIdemp = rest[6];
      if (candidateIdemp && typeof candidateIdemp.find === 'function') {
        this.idempotencyRepo = candidateIdemp;
      }
    }
  }

  /**
   * Amendment A2: Prepare or retrieve provisional setup_pending dormitory before Step 4.
   * Creates ZERO OwnerSignature rows.
   */
  async prepareProvisionalDormitory(userId: string, data: { name?: string; addressLine1?: string; province?: string }, txClient?: any) {
    const runInTx = async (tx: any) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('user_provisional_prepare:' || ${userId}))`;

      const existingDormCount = await tx.dormitory.count({
        where: {
          createdByUserId: userId,
          status: { in: ['active', 'setup_pending'] },
        },
      });

      const draft = await tx.onboardingDraft.findUnique({
        where: { userId },
      });

      if (draft && draft.provisionalDormitoryId && !draft.finalizedAt) {
        const provDorm = await tx.dormitory.findUnique({
          where: { id: draft.provisionalDormitoryId },
          include: { lineConfig: true },
        });

        if (provDorm && provDorm.status === 'setup_pending') {
          if (data.name) {
            await tx.dormitory.update({
              where: { id: provDorm.id },
              data: {
                name: data.name,
                addressLine1: data.addressLine1 || provDorm.addressLine1,
                province: data.province || provDorm.province,
              },
            });
          }

          const appOrigin = getPublicWebhookOrigin();
          let webhookUrl: string | null = null;
          if (provDorm.lineConfig?.webhookKeyEncrypted) {
            try {
              const rawKey = decryptText(provDorm.lineConfig.webhookKeyEncrypted);
              webhookUrl = `${appOrigin}/api/v1/line/webhook/${rawKey}`;
            } catch {
              webhookUrl = null;
            }
          }

          return {
            provisionalDormitoryId: provDorm.id,
            webhookUrl,
          };
        }
      }

      const existingProvDorm = await tx.dormitory.findFirst({
        where: {
          createdByUserId: userId,
          status: 'setup_pending',
        },
        include: { lineConfig: true },
        orderBy: { createdAt: 'desc' },
      });

      if (existingProvDorm) {
        if (data.name) {
          await tx.dormitory.update({
            where: { id: existingProvDorm.id },
            data: {
              name: data.name,
              addressLine1: data.addressLine1 || existingProvDorm.addressLine1,
              province: data.province || existingProvDorm.province,
            },
          });
        }

        await tx.onboardingDraft.upsert({
          where: { userId },
          create: {
            userId,
            provisionalDormitoryId: existingProvDorm.id,
            currentStep: 'PAYMENT_SIGNATURE',
            payload: {},
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
          update: {
            provisionalDormitoryId: existingProvDorm.id,
            finalizedAt: null,
            updatedAt: new Date(),
          },
        });

        const appOrigin = getPublicWebhookOrigin();
        let webhookUrl: string | null = null;
        if (existingProvDorm.lineConfig?.webhookKeyEncrypted) {
          try {
            const rawKey = decryptText(existingProvDorm.lineConfig.webhookKeyEncrypted);
            webhookUrl = `${appOrigin}/api/v1/line/webhook/${rawKey}`;
          } catch {
            webhookUrl = null;
          }
        }

        return {
          provisionalDormitoryId: existingProvDorm.id,
          webhookUrl,
        };
      }

      if (existingDormCount >= 10) {
        throw new AppError('DORMITORY_LIMIT_EXCEEDED: คุณมีหอพักสูงสุดตามโควต้า 10 แห่งแล้ว', 403, 'DORMITORY_LIMIT_EXCEEDED');
      }

      const dormName = data.name || 'หอพักใหม่ (กำลังลงทะเบียน)';
      const opaqueKey = generateOpaqueWebhookKey();

      const dorm = await tx.dormitory.create({
        data: {
          name: dormName,
          status: 'setup_pending',
          createdByUserId: userId,
          addressLine1: data.addressLine1 || null,
          province: data.province || null,
        },
      });

      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dorm.id}, true)`;

      let ownerRole = await tx.role.findFirst({
        where: { dormitoryId: dorm.id, code: 'OWNER' },
      });
      if (!ownerRole) {
        ownerRole = await tx.role.create({
          data: {
            dormitoryId: dorm.id,
            code: 'OWNER',
            name: 'เจ้าของหอพัก',
            isSystem: true,
            permissions: { rooms: ['view', 'manage'], billing: ['view', 'manage'] },
          },
        });
      }

      await tx.dormitoryMember.create({
        data: {
          dormitoryId: dorm.id,
          userId,
          roleId: ownerRole.id,
          status: 'active',
        },
      });

      await tx.dormitoryPropertyDefaults.create({
        data: {
          dormitoryId: dorm.id,
        },
      });

      await tx.dormitoryLineConfig.create({
        data: {
          dormitoryId: dorm.id,
          webhookKeyHash: opaqueKey.keyHash,
          webhookKeyEncrypted: opaqueKey.keyEncrypted,
          isConnected: false,
        },
      });

      // NOTE: ZERO OwnerSignature rows created during provisional preparation!

      await tx.onboardingDraft.upsert({
        where: { userId },
        create: {
          userId,
          provisionalDormitoryId: dorm.id,
          currentStep: 'PAYMENT_SIGNATURE',
          payload: {},
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
        update: {
          provisionalDormitoryId: dorm.id,
          finalizedAt: null,
          updatedAt: new Date(),
        },
      });

      const appOrigin = getPublicWebhookOrigin();
      const webhookUrl = `${appOrigin}/api/v1/line/webhook/${opaqueKey.rawKey}`;

      return {
        provisionalDormitoryId: dorm.id,
        webhookUrl,
      };
    };

    if (txClient) return await runInTx(txClient);
    return await this.prisma.$transaction(runInTx);
  }

  /**
   * Finalize Owner Onboarding (Step 6 -> Completion)
   * Canonical endpoint: POST /api/v1/onboarding/finalize
   */
  public async completeOwnerOnboarding(params: CompleteOwnerOnboardingParams): Promise<any> {
    const { userId, idempotencyKey, requestId, planCode, packageId, promoCode, dormitory, billing, payment, buildings, rooms } = params;

    let lockRecord: any = null;
    if (idempotencyKey && idempotencyKey.trim()) {
      const payloadHash = InMemoryIdempotencyRepository.hashPayload({
        dormitory,
        billing,
        payment,
        planCode,
        packageId,
        promoCode,
        buildings,
        rooms,
      });

      const operation = 'complete_owner_onboarding';
      const existingKey = await this.idempotencyRepo.find(userId, operation, idempotencyKey);

      if (existingKey) {
        if (existingKey.status === 'completed') {
          if (existingKey.requestHash === payloadHash) {
            return existingKey.responseBody;
          } else {
            throw new AppError('IDEMPOTENCY_KEY_REUSED: Idempotency Key ถูกใช้งานแล้วกับข้อมูลที่แตกต่างกัน', 409, 'IDEMPOTENCY_KEY_REUSED');
          }
        } else if (existingKey.status === 'processing') {
          throw new AppError('IDEMPOTENCY_REQUEST_IN_PROGRESS: มีคำขอที่กำลังประมวลผลอยู่ด้วย Idempotency Key นี้', 409, 'IDEMPOTENCY_REQUEST_IN_PROGRESS');
        }
      }

      lockRecord = await this.idempotencyRepo.lock(userId, operation, idempotencyKey, payloadHash);
    }

    if (packageId) {
      const pkg = await this.prisma.subscriptionPackage.findUnique({
        where: { id: packageId },
      });
      if (pkg && !pkg.enabled) {
        throw new AppError('Package is disabled', 400, 'PACKAGE_DISABLED');
      }
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const now = new Date();

      const draft = await tx.onboardingDraft.findUnique({
        where: { userId },
      });

      let rawDormId = params.provisionalDormitoryId;
      if (!rawDormId && draft && draft.provisionalDormitoryId && !draft.finalizedAt) {
        rawDormId = draft.provisionalDormitoryId;
      }

      if (!rawDormId) {
        const prov = await this.prepareProvisionalDormitory(userId, { name: dormitory?.name || 'หอพักของฉัน' }, tx);
        rawDormId = prov.provisionalDormitoryId;
      }
      const dormId: string = rawDormId!;

      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormId}, true)`;

      const provDorm = await tx.dormitory.findUnique({
        where: { id: dormId },
      });

      if (!provDorm || provDorm.createdByUserId !== userId) {
        throw new AppError('ไม่พบข้อมูลหอพักที่กำลังลงทะเบียน หรือท่านไม่มีสิทธิ์จัดการหอพักนี้', 403, 'PROVISIONAL_DORM_DENIED');
      }

      // 2. Validate Signature Saved (Step 5 Requirement - Real object storage path or direct caller legacy fallback)
      let currentSig = await tx.ownerSignature.findFirst({
        where: { dormitoryId: dormId, isCurrent: true },
      });

      // LEGACY_COMPAT_ONLY: Support direct service-level callers/tests providing base64 signature
      if (!currentSig && (params.ownerSignatureUrl || (params as any).signatureBase64)) {
        const sigUrl = params.ownerSignatureUrl || (params as any).signatureBase64;
        const base64Str = sigUrl.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Str, 'base64');
        const sha256 = nodeCrypto.createHash('sha256').update(buffer).digest('hex');
        const objectKey = `dormitories/${dormId}/signatures/v1-${sha256.substring(0, 12)}.png`;

        currentSig = await tx.ownerSignature.create({
          data: {
            dormitoryId: dormId,
            signedByUserId: userId,
            objectKey,
            sha256,
            mimeType: 'image/png',
            byteSize: buffer.length,
            version: 1,
            isCurrent: true,
          },
        });
      }

      if (!currentSig) {
        throw new AppError('กรุณาบันทึกลายเซ็นเจ้าของหอพักในขั้นตอนที่ 5 ก่อนยืนยันสร้างหอพัก', 400, 'OWNER_SIGNATURE_REQUIRED');
      }

      // 3. Validate LINE OA Readiness (Step 5 Requirement) - Only if configured
      const lineConfig = await tx.dormitoryLineConfig.findUnique({
        where: { dormitoryId: dormId },
      });

      const hasConfiguredLine = Boolean(lineConfig && lineConfig.channelId);
      if (hasConfiguredLine) {
        const isLineReady = Boolean(
          lineConfig &&
          lineConfig.channelId &&
          lineConfig.channelSecretEncrypted &&
          lineConfig.accessTokenVerifiedAt
        );

        if (!isLineReady) {
          throw new AppError(
            'LINE OA ยังไม่พร้อมใช้งาน กรุณายืนยันการเชื่อมต่อ LINE OA (Channel ID และ Channel Secret) ก่อนยืนยันสร้างหอพัก',
            400,
            'LINE_ONBOARDING_NOT_READY'
          );
        }
      }

      // 4. Validate Authoritative SubscriptionPackageIntent (Required Step 7 Quote Authority)
      if (!params.packageIntentId) {
        throw new AppError('กรุณาระบุรหัสรายการคำสั่งซื้อแพ็กเกจ (packageIntentId is required)', 400, 'MISSING_PACKAGE_INTENT');
      }

      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormId}, true)`;
      const authoritativeIntent = await tx.subscriptionPackageIntent.findUnique({
        where: { id: params.packageIntentId },
        include: { package: { include: { plan: true } } },
      });

      if (!authoritativeIntent) {
        throw new AppError('ไม่พบข้อมูลรายการคำสั่งซื้อแพ็กเกจ', 404, 'INTENT_NOT_FOUND');
      }

      if (authoritativeIntent.userId !== userId) {
        throw new AppError('ไม่มีสิทธิ์เข้าถึงรายการคำสั่งซื้อแพ็กเกจนี้', 403, 'FORBIDDEN_INTENT_ACCESS');
      }

      // CRITICAL: NEVER rewrite or retarget an intent to another dormitory
      if (authoritativeIntent.dormitoryId !== dormId) {
        throw new AppError('รายการคำสั่งซื้อไม่ตรงกับหอพักที่กำลังดำเนินการ (Intent dormitory mismatch)', 403, 'INTENT_DORMITORY_MISMATCH');
      }

      if (authoritativeIntent.checkoutVersion < 2) {
        throw new AppError('รายการคำสั่งซื้อนี้เป็นเวอร์ชันเดิม ไม่สามารถเปิดใช้งานได้', 400, 'INVALID_CHECKOUT_VERSION');
      }

      // CRITICAL: If authoritativeIntent is already SUCCEEDED, return immutable finalized state with ZERO mutations
      if (authoritativeIntent.status === 'SUCCEEDED') {
        const existingSub = await tx.dormitorySubscription.findUnique({
          where: { dormitoryId: dormId },
          include: { plan: true },
        });

        const activeDormDb = await tx.dormitory.findUnique({
          where: { id: dormId },
        });

        const isTrial = existingSub?.status === 'TRIAL' || authoritativeIntent.isTrialEligibleSnapshot;
        const promoBonus = authoritativeIntent.promoCodeSnapshot ? 2 : (authoritativeIntent.promoBonusMonthsSnapshot || 0);

        const isFreeReplay = authoritativeIntent.durationMonthsSnapshot === 0 && !authoritativeIntent.isTrialEligibleSnapshot;

        return {
          success: true,
          dormitoryId: dormId,
          dormitoryName: activeDormDb?.name || provDorm.name,
          dormitory: {
            id: dormId,
            name: activeDormDb?.name || provDorm.name,
          },
          membership: {
            roleCode: 'OWNER',
          },
          subscription: {
            id: existingSub?.id || '',
            planCode: existingSub?.plan?.code || (isFreeReplay ? 'FREE' : 'PAID'),
            status: existingSub?.status || (isTrial ? 'TRIAL' : 'ACTIVE'),
            trialExpiresAt: existingSub?.trialExpiresAt ? existingSub.trialExpiresAt.toISOString() : (existingSub?.expiresAt ? existingSub.expiresAt.toISOString() : null),
            expiresAt: existingSub?.expiresAt ? existingSub.expiresAt.toISOString() : null,
          },
          promo: {
            applied: promoBonus > 0,
            promoBonusMonths: promoBonus,
            trialMonths: isTrial ? 1 : 0,
            totalTrialMonths: (isTrial ? 1 : 0) + promoBonus,
          },
          planCode: existingSub?.plan?.code || (isFreeReplay ? 'FREE' : 'PAID'),
          subscriptionStatus: existingSub?.status || (isTrial ? 'TRIAL' : 'ACTIVE'),
          trialExpiresAt: existingSub?.trialExpiresAt ? existingSub.trialExpiresAt.toISOString() : (existingSub?.expiresAt ? existingSub.expiresAt.toISOString() : null),
          promoApplied: promoBonus > 0,
          totalTrialMonths: (isTrial ? 1 : 0) + promoBonus,
          packageIntentId: authoritativeIntent.id,
          isReplay: true,
        };
      }

      if (authoritativeIntent.status !== 'PENDING_PAYMENT') {
        throw new AppError('สถานะรายการคำสั่งซื้อไม่ถูกต้อง', 400, 'INVALID_INTENT_STATUS');
      }

      if (authoritativeIntent.expiresAt && authoritativeIntent.expiresAt < now) {
        throw new AppError('รายการคำสั่งซื้อแพ็กเกจหมดอายุแล้ว กรุณาเลือกแพ็กเกจใหม่อีกครั้ง', 400, 'INTENT_EXPIRED');
      }

      if (params.packageId && authoritativeIntent.packageId && params.packageId !== authoritativeIntent.packageId) {
        throw new AppError('แพ็กเกจที่เลือกไม่ตรงกับรายการคำสั่งซื้อที่อนุมัติ', 400, 'PACKAGE_MISMATCH');
      }

      // 5. Resolve Subscription Plan & Package (Authoritative Package Logic)
      let resolvedPlanCode = planCode || 'FREE';
      let selectedPackage: any = null;

      if (packageId) {
        selectedPackage = await tx.subscriptionPackage.findUnique({
          where: { id: packageId },
          include: { plan: true },
        });

        if (!selectedPackage || !selectedPackage.enabled) {
          throw new AppError('Package is disabled or invalid', 400, 'PACKAGE_DISABLED');
        }

        if (selectedPackage.price === null || selectedPackage.price === undefined) {
          throw new AppError('Package price is unpriced or disabled', 400, 'PACKAGE_UNPRICED');
        }

        resolvedPlanCode = selectedPackage.plan?.code || selectedPackage.planCode;
        if (resolvedPlanCode !== 'PAID') {
          throw new AppError('Paid package must belong to PAID plan', 400, 'INVALID_PACKAGE_PLAN');
        }
      }

      const plan = await tx.subscriptionPlan.findUnique({
        where: { code: resolvedPlanCode },
      });

      if (!plan) {
        throw new AppError('แพ็กเกจที่เลือกไม่ถูกต้องหรือเปิดใช้งานไม่ได้', 400, 'PLAN_NOT_FOUND');
      }

      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', '', true)`;

      // Authoritative building & room counts
      const mappedBuildingCount = params.buildings ? params.buildings.length : (dormitory.estimatedBuildingCount || 1);
      const mappedRoomCount = params.rooms ? params.rooms.length : (dormitory.estimatedRoomCount || 0);

      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormId}, true)`;
      const activeDorm = await tx.dormitory.update({
        where: { id: dormId },
        data: {
          name: dormitory.name,
          type: dormitory.type || 'apartment',
          genderPolicy: dormitory.genderPolicy || null,
          addressLine1: dormitory.addressLine1 || null,
          addressLine2: dormitory.addressLine2 || null,
          subdistrict: dormitory.subdistrict || null,
          district: dormitory.district || null,
          province: dormitory.province || null,
          postalCode: dormitory.postalCode || null,
          phone: dormitory.phone || null,
          email: dormitory.email || null,
          estimatedBuildingCount: mappedBuildingCount,
          estimatedRoomCount: mappedRoomCount,
          status: 'active',
          updatedAt: now,
        },
      });

      // Authoritative guarantee: OWNER role & active membership strictly exist for finalized dormitory
      let ownerRole = await tx.role.findFirst({
        where: { dormitoryId: dormId, code: 'OWNER' },
      });
      if (!ownerRole) {
        ownerRole = await tx.role.create({
          data: {
            dormitoryId: dormId,
            code: 'OWNER',
            name: 'เจ้าของหอพัก',
            isSystem: true,
            permissions: { rooms: ['view', 'manage'], billing: ['view', 'manage'] },
          },
        });
      }

      await tx.dormitoryMember.upsert({
        where: {
          user_dormitory_unique: {
            userId,
            dormitoryId: dormId,
          },
        },
        create: {
          dormitoryId: dormId,
          userId,
          roleId: ownerRole.id,
          status: 'active',
          membershipOrigin: 'GOOGLE_BOOTSTRAP',
        },
        update: {
          roleId: ownerRole.id,
          status: 'active',
        },
      });

      // Save Billing Settings with Nullish Coalescing (Zero-value fidelity preserved)
      if (billing) {
        const waterRateStr = (billing.waterRate !== undefined && billing.waterRate !== null && billing.waterRate !== '') ? String(billing.waterRate) : '0.00';
        const electricityRateStr = (billing.electricityRate !== undefined && billing.electricityRate !== null && billing.electricityRate !== '') ? String(billing.electricityRate) : '0.00';
        const commonFeeStr = (billing.commonFee !== undefined && billing.commonFee !== null && billing.commonFee !== '') ? String(billing.commonFee) : '0.00';
        const internetFeeStr = (billing.internetFee !== undefined && billing.internetFee !== null && billing.internetFee !== '') ? String(billing.internetFee) : '0.00';
        const parkingRateStr = (billing.parkingRate !== undefined && billing.parkingRate !== null && billing.parkingRate !== '') ? String(billing.parkingRate) : '0.00';
        const lateFeeValueStr = (billing.lateFeeValue !== undefined && billing.lateFeeValue !== null && billing.lateFeeValue !== '') ? String(billing.lateFeeValue) : '0.00';

        const gracePeriodDaysNum = LATE_FEE_GRACE_DAYS;
        const advanceRentMonthsNum = (billing.advanceRentMonths !== undefined && billing.advanceRentMonths !== null) ? Number(billing.advanceRentMonths) : 1;

        if (billing.dueDay === undefined || billing.dueDay === null || isNaN(Number(billing.dueDay)) || Number(billing.dueDay) < 1 || Number(billing.dueDay) > 28) {
          throw new AppError('DUE_DAY_REQUIRED: Authoritative billing settings must configure valid dueDay (1-28)', 400, 'DUE_DAY_REQUIRED');
        }
        const validatedDueDay = Number(billing.dueDay);

        // LEGACY_COMPAT_ONLY: physical legacy DB column backwards compatibility (isolated in persistence)
        const legacyCompatBillingDay = (billing.billingDay !== undefined && billing.billingDay !== null && !isNaN(Number(billing.billingDay)))
          ? Number(billing.billingDay)
          : validatedDueDay;

        const effectiveWaterBillingType = normalizeUtilityBillingMode(billing.waterBillingType || 'per_person');
        const effectiveElectricityBillingType = normalizeUtilityBillingMode(billing.electricityBillingType || 'per_unit');

        let effectiveWaterTierRates: CanonicalTierRecord[] | null = null;
        if (effectiveWaterBillingType === 'tiered') {
          if (billing.waterTierRates === null || billing.waterTierRates === undefined || (Array.isArray(billing.waterTierRates) && billing.waterTierRates.length === 0)) {
            throw new AppError("INVALID_TIER_CONFIGURATION: Water billing mode is 'tiered' but no tier configuration was provided", 400, 'INVALID_TIER_CONFIGURATION');
          }
          effectiveWaterTierRates = validateCanonicalUtilityTiers(billing.waterTierRates);
        } else {
          if (billing.waterTierRates) {
            effectiveWaterTierRates = validateCanonicalUtilityTiers(billing.waterTierRates);
          } else {
            effectiveWaterTierRates = null;
          }
        }

        let effectiveElectricityTierRates: CanonicalTierRecord[] | null = null;
        if (effectiveElectricityBillingType === 'tiered') {
          if (billing.electricityTierRates === null || billing.electricityTierRates === undefined || (Array.isArray(billing.electricityTierRates) && billing.electricityTierRates.length === 0)) {
            throw new AppError("INVALID_TIER_CONFIGURATION: Electricity billing mode is 'tiered' but no tier configuration was provided", 400, 'INVALID_TIER_CONFIGURATION');
          }
          effectiveElectricityTierRates = validateCanonicalUtilityTiers(billing.electricityTierRates);
        } else {
          if (billing.electricityTierRates) {
            effectiveElectricityTierRates = validateCanonicalUtilityTiers(billing.electricityTierRates);
          } else {
            effectiveElectricityTierRates = null;
          }
        }

        await tx.dormitoryBillingSettings.upsert({
          where: { dormitoryId: dormId },
          create: {
            dormitoryId: dormId,
            billingDay: legacyCompatBillingDay,
            dueDay: validatedDueDay,
            waterBillingType: effectiveWaterBillingType,
            waterRate: waterRateStr,
            waterTierRates: effectiveWaterTierRates === null ? Prisma.DbNull : (effectiveWaterTierRates as any),
            electricityBillingType: effectiveElectricityBillingType,
            electricityRate: electricityRateStr,
            electricityTierRates: effectiveElectricityTierRates === null ? Prisma.DbNull : (effectiveElectricityTierRates as any),
            commonFee: commonFeeStr,
            commonFeeMode: billing.commonFeeMode || 'per_room',
            internetFee: internetFeeStr,
            internetFeeMode: billing.internetFeeMode || 'per_person',
            parkingRate: parkingRateStr,
            parkingFeeMode: billing.parkingFeeMode || 'per_room',
            gracePeriodDays: gracePeriodDaysNum,
            advanceRentMonths: advanceRentMonthsNum,
            lateFeeType: billing.lateFeeType || 'none',
            lateFeeValue: lateFeeValueStr,
            rentBillingType: billing.rentBillingType || 'monthly',
          },
          update: {
            billingDay: legacyCompatBillingDay,
            dueDay: validatedDueDay,
            waterBillingType: effectiveWaterBillingType,
            waterRate: waterRateStr,
            waterTierRates: effectiveWaterTierRates === null ? Prisma.DbNull : (effectiveWaterTierRates as any),
            electricityBillingType: effectiveElectricityBillingType,
            electricityRate: electricityRateStr,
            electricityTierRates: effectiveElectricityTierRates === null ? Prisma.DbNull : (effectiveElectricityTierRates as any),
            commonFee: commonFeeStr,
            commonFeeMode: billing.commonFeeMode || 'per_room',
            internetFee: internetFeeStr,
            internetFeeMode: billing.internetFeeMode || 'per_person',
            parkingRate: parkingRateStr,
            parkingFeeMode: billing.parkingFeeMode || 'per_room',
            gracePeriodDays: gracePeriodDaysNum,
            advanceRentMonths: advanceRentMonthsNum,
            lateFeeType: billing.lateFeeType || 'none',
            lateFeeValue: lateFeeValueStr,
            rentBillingType: billing.rentBillingType || 'monthly',
            updatedAt: now,
          },
        });
      }

      // Save Payment Settings with Encryption
      if (payment) {
        let encPromptPay: string | null = null;
        if (payment.promptPayValue) {
          encPromptPay = this.sensitiveFieldService.encrypt(payment.promptPayValue).ciphertext;
        }

        let encBankAccount: string | null = null;
        if (payment.bankAccountNumber) {
          encBankAccount = this.sensitiveFieldService.encrypt(payment.bankAccountNumber).ciphertext;
        }

        await tx.dormitoryBillingSettings.update({
          where: { dormitoryId: dormId },
          data: {
            cashAccepted: payment.cashAccepted ?? true,
            promptPayType: payment.promptPayType || null,
            promptPayValue: null,
            promptPayValueEncrypted: encPromptPay,
            promptPayAccountName: payment.promptPayAccountName || null,
            bankCode: payment.bankCode || null,
            bankAccountName: payment.bankAccountName || null,
            bankAccountNumber: payment.bankAccountNumber ? this.sensitiveFieldService.maskBankAccount(payment.bankAccountNumber) : null,
            bankAccountNumberEncrypted: encBankAccount,
          },
        });
      }

      // Save Dormitory Property Defaults (Step 5 Rules & Pet Policy, plus defaultDeposit / default rents if provided)
      const resolvedTerms = params.defaultTerms || (typeof params.rules === 'string' ? params.rules : null);
      const resolvedPetPolicy = params.petPolicy || { allowed: 'none', allowedTypes: [] };
      const rawDefaultDeposit = (params as any).defaultDeposit !== undefined ? (params as any).defaultDeposit : (params as any).deposits?.securityDeposit;
      const defaultDepositVal = (rawDefaultDeposit !== undefined && rawDefaultDeposit !== null && rawDefaultDeposit !== '' && !isNaN(Number(rawDefaultDeposit)))
        ? String(rawDefaultDeposit)
        : undefined;

      const rawDefaultMonthly = (params as any).defaultMonthlyRent;
      const defaultMonthlyVal = (rawDefaultMonthly !== undefined && rawDefaultMonthly !== null && rawDefaultMonthly !== '' && !isNaN(Number(rawDefaultMonthly)))
        ? String(rawDefaultMonthly)
        : undefined;

      await tx.dormitoryPropertyDefaults.upsert({
        where: { dormitoryId: dormId },
        create: {
          dormitoryId: dormId,
          defaultTerms: resolvedTerms,
          petPolicy: resolvedPetPolicy,
          ...(defaultDepositVal !== undefined ? { defaultDeposit: defaultDepositVal } : {}),
          ...(defaultMonthlyVal !== undefined ? { defaultMonthlyRent: defaultMonthlyVal } : {}),
        },
        update: {
          defaultTerms: resolvedTerms !== null ? resolvedTerms : undefined,
          petPolicy: resolvedPetPolicy,
          ...(defaultDepositVal !== undefined ? { defaultDeposit: defaultDepositVal } : {}),
          ...(defaultMonthlyVal !== undefined ? { defaultMonthlyRent: defaultMonthlyVal } : {}),
          updatedAt: now,
        },
      });

      // Preflight validation: Reject duplicate normalized room numbers inside the same building in payload
      if (rooms && rooms.length > 0) {
        const seenInPayload = new Map<string, string>();
        for (const r of rooms) {
          const norm = normalizeRoomIdentifier(r.roomNumber);
          if (!norm) continue;
          const key = `${r.buildingId || 'default'}_${norm}`;
          if (seenInPayload.has(key)) {
            throw new AppError(
              `เลขห้อง "${r.roomNumber}" ซ้ำในอาคารเดียวกัน`,
              409,
              'ROOM_NUMBER_ALREADY_EXISTS'
            );
          }
          seenInPayload.set(key, r.roomNumber);
        }
      }

      // Save Buildings and Rooms if provided (idempotent upsert)
      if (buildings && buildings.length > 0) {
        for (const b of buildings) {
          const bMonthlyStr = (b.monthlyRent !== undefined && b.monthlyRent !== null && String(b.monthlyRent) !== '') ? String(b.monthlyRent) : null;
          const bDailyStr = (b.dailyRent !== undefined && b.dailyRent !== null && String(b.dailyRent) !== '') ? String(b.dailyRent) : null;
          const bTermStr = (b.termRent !== undefined && b.termRent !== null && String(b.termRent) !== '') ? String(b.termRent) : null;
          const bTermMonths = b.termMonths ?? 4;
          const bMaxInstallments = (b.maxInstallmentMonths !== undefined && b.maxInstallmentMonths !== null)
            ? Math.max(1, Math.min(12, Number(b.maxInstallmentMonths)))
            : 2;
          const bDepositNum = (b.depositAmount !== undefined && b.depositAmount !== null && String(b.depositAmount) !== '')
            ? b.depositAmount
            : ((b.securityDeposit !== undefined && b.securityDeposit !== null && String(b.securityDeposit) !== '') ? b.securityDeposit : null);
          const bDepositStr = bDepositNum !== null ? String(bDepositNum) : null;
          const bMonthlyDepositStr = (b.monthlyDeposit !== undefined && b.monthlyDeposit !== null && String(b.monthlyDeposit) !== '') ? String(b.monthlyDeposit) : null;
          const bTermDepositStr = (b.termDeposit !== undefined && b.termDeposit !== null && String(b.termDeposit) !== '') ? String(b.termDeposit) : null;
          const bDailyDepositStr = (b.dailyDeposit !== undefined && b.dailyDeposit !== null && String(b.dailyDeposit) !== '') ? String(b.dailyDeposit) : null;
          const bMaxOcc = b.maximumOccupants ?? 2;
          const bNumPattern = b.numberingPattern || b.formatPattern || null;

          const createdBld = await tx.building.upsert({
            where: {
              dormitory_building_name_unique: {
                dormitoryId: dormId,
                name: b.name,
              },
            },
            create: {
              dormitoryId: dormId,
              name: b.name,
              code: b.code ? b.code.trim().toUpperCase() : null,
              floorCount: b.floorsCount || 1,
              roomsPerFloor: b.roomsPerFloor || null,
              roomPrefix: b.roomPrefix ? b.roomPrefix.trim().toUpperCase() : null,
              hasElevator: b.hasElevator ?? false,
              numberingPattern: bNumPattern,
              description: b.description || null,
              monthlyRent: bMonthlyStr,
              dailyRent: bDailyStr,
              termRent: bTermStr,
              termMonths: bTermMonths,
              maxTermRentInstallments: bMaxInstallments,
              depositAmount: bDepositStr,
              monthlyDeposit: bMonthlyDepositStr,
              termDeposit: bTermDepositStr,
              dailyDeposit: bDailyDepositStr,
              maximumOccupants: bMaxOcc,
            },
            update: {
              code: b.code ? b.code.trim().toUpperCase() : null,
              floorCount: b.floorsCount || 1,
              roomsPerFloor: b.roomsPerFloor || null,
              roomPrefix: b.roomPrefix ? b.roomPrefix.trim().toUpperCase() : null,
              hasElevator: b.hasElevator ?? false,
              numberingPattern: bNumPattern,
              description: b.description || null,
              monthlyRent: bMonthlyStr,
              dailyRent: bDailyStr,
              termRent: bTermStr,
              termMonths: bTermMonths,
              maxTermRentInstallments: bMaxInstallments,
              depositAmount: bDepositStr,
              monthlyDeposit: bMonthlyDepositStr,
              termDeposit: bTermDepositStr,
              dailyDeposit: bDailyDepositStr,
              maximumOccupants: bMaxOcc,
            },
          });

          const matchingRooms = (rooms || []).filter((r) => r.buildingId === b.id);
          for (const r of matchingRooms) {
            const normalizedRoomNumber = normalizeRoomIdentifier(r.roomNumber);

            const rMonthlyStr = (r.monthlyRent !== undefined && r.monthlyRent !== null) ? String(r.monthlyRent) : (bMonthlyStr !== null ? bMonthlyStr : null);
            const rDailyStr = (r.dailyRent !== undefined && r.dailyRent !== null) ? String(r.dailyRent) : bDailyStr;
            const rTermStr = (r.termRent !== undefined && r.termRent !== null) ? String(r.termRent) : bTermStr;
            const rTermMonths = r.termMonths ?? bTermMonths;

            const isExplicitRoomDeposit = r.depositAmount !== undefined && r.depositAmount !== null && (bDepositStr === null || String(r.depositAmount) !== bDepositStr) && r.depositInheritsBuildingDefault === false;
            const depositInheritsBuildingDefault = isExplicitRoomDeposit ? false : (r.depositInheritsBuildingDefault !== undefined ? Boolean(r.depositInheritsBuildingDefault) : true);

            const resolveAuthoritativeRoomDeposit = (roomVal: any, buildingVal: string | null, dormDefault: string | undefined, fieldLabel: string): string => {
              if (roomVal !== undefined && roomVal !== null && String(roomVal) !== '') {
                return String(roomVal);
              }
              if (buildingVal !== null) {
                return buildingVal;
              }
              if (dormDefault !== undefined) {
                return dormDefault;
              }
              throw new AppError(
                `เงินประกัน (${fieldLabel}) สำหรับห้อง "${r.roomNumber}" ไม่ได้รับการกำหนดค่า กรุณาระบุเงินประกัน`,
                400,
                'REQUIRED_ROOM_DEPOSIT_MISSING'
              );
            };

            const rMonthlyDeposit = resolveAuthoritativeRoomDeposit((r as any).monthlyDeposit, bMonthlyDepositStr ?? bDepositStr, defaultDepositVal, 'รายเดือน');
            const rTermDeposit = resolveAuthoritativeRoomDeposit((r as any).termDeposit, bTermDepositStr ?? bDepositStr, defaultDepositVal, 'รายเทอม');
            const rDailyDeposit = resolveAuthoritativeRoomDeposit((r as any).dailyDeposit, bDailyDepositStr ?? bDepositStr, defaultDepositVal, 'รายวัน');
            const rDepositStr = !depositInheritsBuildingDefault && r.depositAmount !== undefined && r.depositAmount !== null
              ? String(r.depositAmount)
              : rMonthlyDeposit;

            const rMaxOcc = (r as any).maximumOccupants ?? bMaxOcc;

            await tx.room.upsert({
              where: {
                dormitoryId_buildingId_normalizedRoomNumber: {
                  dormitoryId: dormId,
                  buildingId: createdBld.id,
                  normalizedRoomNumber,
                },
              },
              create: {
                dormitoryId: dormId,
                buildingId: createdBld.id,
                roomNumber: r.roomNumber,
                normalizedRoomNumber,
                floor: r.floor || 1,
                roomType: (r as any).roomType || 'standard',
                monthlyRent: rMonthlyStr,
                dailyRent: rDailyStr,
                termRent: rTermStr,
                termMonths: rTermMonths,
                termDeposit: rTermDeposit,
                monthlyDeposit: rMonthlyDeposit,
                dailyDeposit: rDailyDeposit,
                depositAmount: rDepositStr,
                depositInheritsBuildingDefault,
                maximumOccupants: rMaxOcc,
                status: r.status || 'VACANT',
              },
              update: {
                buildingId: createdBld.id,
                roomNumber: r.roomNumber,
                floor: r.floor || 1,
                roomType: (r as any).roomType || 'standard',
                monthlyRent: rMonthlyStr,
                dailyRent: rDailyStr,
                termRent: rTermStr,
                termMonths: rTermMonths,
                termDeposit: rTermDeposit,
                monthlyDeposit: rMonthlyDeposit,
                dailyDeposit: rDailyDeposit,
                depositAmount: rDepositStr,
                depositInheritsBuildingDefault,
                maximumOccupants: rMaxOcc,
                status: r.status || 'VACANT',
              },
            });
          }
        }
      }

      // Expire superseded pending quote intents for this user/dormitory
      await tx.subscriptionPackageIntent.updateMany({
        where: {
          dormitoryId: dormId,
          userId,
          status: 'PENDING_PAYMENT',
          id: { not: authoritativeIntent.id },
        },
        data: {
          status: 'EXPIRED',
        },
      });

      // Settle Referral on first dormitory creation
      await referralService.settleReferralOnboarding(userId, dormId, 0, tx);

      // 6. Execute Canonical Financial State Transition
      let resultPayload: any;

      if (authoritativeIntent.finalPayableAmount && authoritativeIntent.finalPayableAmount.equals(new Prisma.Decimal(0))) {
        if (authoritativeIntent.isZeroPayValidated !== true) {
          throw new AppError('รายการสั่งซื้อนี้ไม่ผ่านการตรวจสอบความถูกต้องของยอดชำระ 0 บาท', 400, 'ZERO_PAY_UNVALIDATED');
        }

        // Delegate strictly to canonical single commit implementation
        const commitRes = await subscriptionIntentService.commitZeroPayIntent(userId, authoritativeIntent.id, idempotencyKey, tx);

        await tx.onboardingDraft.updateMany({
          where: { userId },
          data: {
            finalizedAt: now,
            currentStep: 'COMPLETED',
            updatedAt: now,
          },
        });

        resultPayload = {
          success: true,
          dormitoryId: dormId,
          dormitoryName: activeDorm.name,
          dormitory: {
            id: dormId,
            name: activeDorm.name,
          },
          membership: {
            roleCode: 'OWNER',
          },
          subscription: {
            id: commitRes.subscriptionId,
            planCode: commitRes.planCode,
            status: commitRes.isTrial ? 'TRIAL' : 'ACTIVE',
            trialExpiresAt: commitRes.isTrial && commitRes.expiresAt ? commitRes.expiresAt.toISOString() : null,
            expiresAt: commitRes.expiresAt ? commitRes.expiresAt.toISOString() : null,
          },
          promo: {
            applied: commitRes.promoBonusMonths > 0,
            promoBonusMonths: commitRes.promoBonusMonths,
            trialMonths: commitRes.isTrialEligible ? 1 : 0,
            totalTrialMonths: (commitRes.isTrialEligible ? 1 : 0) + commitRes.promoBonusMonths,
          },
          planCode: commitRes.planCode,
          subscriptionStatus: commitRes.isTrial ? 'TRIAL' : 'ACTIVE',
          trialExpiresAt: commitRes.isTrial && commitRes.expiresAt ? commitRes.expiresAt.toISOString() : null,
          promoApplied: commitRes.promoBonusMonths > 0,
          totalTrialMonths: (commitRes.isTrialEligible ? 1 : 0) + commitRes.promoBonusMonths,
          packageIntentId: authoritativeIntent.id,
        };
      } else {
        // Paid package pending payment (> 0 THB) -> Setup default free plan baseline; no early PRO entitlement
        const freePlan = (await tx.subscriptionPlan.findUnique({ where: { code: 'FREE' } })) || plan;
        const targetFreePlanId = freePlan?.id || plan.id;
        const sub = await tx.dormitorySubscription.upsert({
          where: { dormitoryId: dormId },
          create: {
            dormitoryId: dormId,
            planId: targetFreePlanId,
            status: 'ACTIVE',
            startedAt: now,
            expiresAt: addCalendarMonths(now, 1200),
          },
          update: {
            planId: targetFreePlanId,
            status: 'ACTIVE',
            startedAt: now,
            expiresAt: addCalendarMonths(now, 1200),
            updatedAt: now,
          },
        });

        await tx.onboardingDraft.updateMany({
          where: { userId },
          data: {
            finalizedAt: now,
            currentStep: 'COMPLETED',
            updatedAt: now,
          },
        });

        resultPayload = {
          success: true,
          dormitoryId: dormId,
          dormitoryName: activeDorm.name,
          dormitory: {
            id: dormId,
            name: activeDorm.name,
          },
          membership: {
            roleCode: 'OWNER',
          },
          subscription: {
            id: sub.id,
            planCode: 'FREE',
            status: 'ACTIVE',
            trialExpiresAt: null,
          },
          promo: {
            applied: false,
            promoBonusMonths: 0,
            trialMonths: 0,
            totalTrialMonths: 0,
          },
          planCode: 'FREE',
          subscriptionStatus: 'ACTIVE',
          trialExpiresAt: null,
          promoApplied: false,
          totalTrialMonths: 0,
          packageIntentId: authoritativeIntent.id,
          isPendingPayment: true,
        };
      }

      return resultPayload;
    });

    if (lockRecord && lockRecord.id) {
      await this.idempotencyRepo.complete(lockRecord.id, 200, result);
    }

    return result;
  }
}
