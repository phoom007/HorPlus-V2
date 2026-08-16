/**
 * Dormitory Provisioning & Onboarding Finalization Service (Task-009 — 6-Step Master Flow)
 * @license Apache-2.0
 */

import nodeCrypto from 'crypto';
import { PrismaClient } from '@prisma/client';
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
    billingDay?: number;
    dueDay?: number;
    waterBillingType?: string;
    waterRate?: string;
    electricityBillingType?: string;
    electricityRate?: string;
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
    depositAmount: number;
    parkingFee?: number;
    maximumOccupants?: number;
    initialWaterReading?: number;
    initialElectricityReading?: number;
    status?: string;
  }[];

  planCode: string;
  packageId?: string;
  promoCode?: string;
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

      await tx.dormitoryBillingSettings.create({
        data: {
          dormitoryId: dorm.id,
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

      // 2. Validate Signature Saved (Step 4 Requirement)
      let currentSig = await tx.ownerSignature.findFirst({
        where: { dormitoryId: dormId, isCurrent: true },
      });

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
        throw new AppError('กรุณาบันทึกลายเซ็นเจ้าของหอพักในขั้นตอนที่ 4 ก่อนยืนยันสร้างหอพัก', 400, 'OWNER_SIGNATURE_REQUIRED');
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

      // 4. Resolve Subscription Plan & Package (Authoritative Package Logic)
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

      if (plan.type === 'FREE' || plan.code === 'FREE') {
        const existingActiveDorm = await tx.dormitoryMember.findFirst({
          where: {
            userId,
            status: 'active',
            dormitoryId: { not: dormId },
            dormitory: { status: 'active' },
          },
        });

        if (existingActiveDorm) {
          throw new AppError('FREE_DORMITORY_LIMIT_REACHED: บัญชีของคุณมีหอพักแบบ Free/Trial แล้ว ไม่สามารถสร้างหอพัก Free เพิ่มเติมได้', 409, 'FREE_DORMITORY_LIMIT_REACHED');
        }
      }

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
          estimatedBuildingCount: dormitory.estimatedBuildingCount || 1,
          estimatedRoomCount: dormitory.estimatedRoomCount || 10,
          status: 'active',
          updatedAt: now,
        },
      });

      // Save Billing Settings with Nullish Coalescing (Zero-value fidelity preserved)
      if (billing) {
        const waterRateStr = (billing.waterRate !== undefined && billing.waterRate !== null && billing.waterRate !== '') ? String(billing.waterRate) : '0.00';
        const electricityRateStr = (billing.electricityRate !== undefined && billing.electricityRate !== null && billing.electricityRate !== '') ? String(billing.electricityRate) : '0.00';
        const commonFeeStr = (billing.commonFee !== undefined && billing.commonFee !== null && billing.commonFee !== '') ? String(billing.commonFee) : '0.00';
        const internetFeeStr = (billing.internetFee !== undefined && billing.internetFee !== null && billing.internetFee !== '') ? String(billing.internetFee) : '0.00';
        const parkingRateStr = (billing.parkingRate !== undefined && billing.parkingRate !== null && billing.parkingRate !== '') ? String(billing.parkingRate) : '0.00';
        const lateFeeValueStr = (billing.lateFeeValue !== undefined && billing.lateFeeValue !== null && billing.lateFeeValue !== '') ? String(billing.lateFeeValue) : '50.00';

        const gracePeriodDaysNum = (billing.gracePeriodDays !== undefined && billing.gracePeriodDays !== null) ? Number(billing.gracePeriodDays) : 0;
        const advanceRentMonthsNum = (billing.advanceRentMonths !== undefined && billing.advanceRentMonths !== null) ? Number(billing.advanceRentMonths) : 1;

        await tx.dormitoryBillingSettings.upsert({
          where: { dormitoryId: dormId },
          create: {
            dormitoryId: dormId,
            billingDay: Number(billing.billingDay) || 25,
            dueDay: Number(billing.dueDay) || 5,
            waterBillingType: billing.waterBillingType || 'per_unit',
            waterRate: waterRateStr,
            electricityBillingType: billing.electricityBillingType || 'per_unit',
            electricityRate: electricityRateStr,
            commonFee: commonFeeStr,
            commonFeeMode: billing.commonFeeMode || 'none',
            internetFee: internetFeeStr,
            internetFeeMode: billing.internetFeeMode || 'none',
            parkingRate: parkingRateStr,
            parkingFeeMode: billing.parkingFeeMode || 'none',
            gracePeriodDays: gracePeriodDaysNum,
            advanceRentMonths: advanceRentMonthsNum,
            lateFeeType: billing.lateFeeType || 'fixed',
            lateFeeValue: lateFeeValueStr,
            rentBillingType: billing.rentBillingType || 'monthly',
          },
          update: {
            billingDay: Number(billing.billingDay) || 25,
            dueDay: Number(billing.dueDay) || 5,
            waterBillingType: billing.waterBillingType || 'per_unit',
            waterRate: waterRateStr,
            electricityBillingType: billing.electricityBillingType || 'per_unit',
            electricityRate: electricityRateStr,
            commonFee: commonFeeStr,
            commonFeeMode: billing.commonFeeMode || 'none',
            internetFee: internetFeeStr,
            internetFeeMode: billing.internetFeeMode || 'none',
            parkingRate: parkingRateStr,
            parkingFeeMode: billing.parkingFeeMode || 'none',
            gracePeriodDays: gracePeriodDaysNum,
            advanceRentMonths: advanceRentMonthsNum,
            lateFeeType: billing.lateFeeType || 'fixed',
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

      // Save Dormitory Property Defaults (Step 5 Rules & Pet Policy)
      const resolvedTerms = params.defaultTerms || (typeof params.rules === 'string' ? params.rules : null);
      const resolvedPetPolicy = params.petPolicy || { allowed: 'none', allowedTypes: [] };
      await tx.dormitoryPropertyDefaults.upsert({
        where: { dormitoryId: dormId },
        create: {
          dormitoryId: dormId,
          defaultTerms: resolvedTerms,
          petPolicy: resolvedPetPolicy,
        },
        update: {
          defaultTerms: resolvedTerms !== null ? resolvedTerms : undefined,
          petPolicy: resolvedPetPolicy,
          updatedAt: now,
        },
      });

      // Save Buildings and Rooms if provided (idempotent upsert)
      if (buildings && buildings.length > 0) {
        for (const b of buildings) {
          const bMonthlyStr = (b.monthlyRent !== undefined && b.monthlyRent !== null) ? String(b.monthlyRent) : null;
          const bDailyStr = (b.dailyRent !== undefined && b.dailyRent !== null) ? String(b.dailyRent) : null;
          const bTermStr = (b.termRent !== undefined && b.termRent !== null) ? String(b.termRent) : null;
          const bTermMonths = b.termMonths ?? 6;
          const bMaxInstallments = (b.maxInstallmentMonths !== undefined && b.maxInstallmentMonths !== null)
            ? Math.max(1, Math.min(12, Number(b.maxInstallmentMonths)))
            : 1;
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
              code: b.code || null,
              floorCount: b.floorsCount || 1,
              roomsPerFloor: b.roomsPerFloor || null,
              roomPrefix: b.roomPrefix || null,
              hasElevator: b.hasElevator ?? false,
              numberingPattern: bNumPattern,
              description: b.description || null,
              monthlyRent: bMonthlyStr,
              dailyRent: bDailyStr,
              termRent: bTermStr,
              termMonths: bTermMonths,
              maxTermRentInstallments: bMaxInstallments,
              maximumOccupants: bMaxOcc,
            },
            update: {
              code: b.code || null,
              floorCount: b.floorsCount || 1,
              roomsPerFloor: b.roomsPerFloor || null,
              roomPrefix: b.roomPrefix || null,
              hasElevator: b.hasElevator ?? false,
              numberingPattern: bNumPattern,
              description: b.description || null,
              monthlyRent: bMonthlyStr,
              dailyRent: bDailyStr,
              termRent: bTermStr,
              termMonths: bTermMonths,
              maxTermRentInstallments: bMaxInstallments,
              maximumOccupants: bMaxOcc,
            },
          });

          const matchingRooms = (rooms || []).filter((r) => r.buildingId === b.id);
          for (const r of matchingRooms) {
            const normalizedRoomNumber = normalizeRoomIdentifier(r.roomNumber);
            const rMonthlyStr = (r.monthlyRent !== undefined && r.monthlyRent !== null) ? String(r.monthlyRent) : (bMonthlyStr || '0');
            const rDailyStr = (r.dailyRent !== undefined && r.dailyRent !== null) ? String(r.dailyRent) : bDailyStr;
            const rTermStr = (r.termRent !== undefined && r.termRent !== null) ? String(r.termRent) : bTermStr;
            const rTermMonths = r.termMonths ?? bTermMonths;
            const rDepositStr = (r.depositAmount !== undefined && r.depositAmount !== null) ? String(r.depositAmount) : '0';
            const rMaxOcc = r.maximumOccupants ?? bMaxOcc;

            await tx.room.upsert({
              where: {
                dormitoryId_normalizedRoomNumber: {
                  dormitoryId: dormId,
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
                depositAmount: rDepositStr,
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
                depositAmount: rDepositStr,
                maximumOccupants: rMaxOcc,
                status: r.status || 'VACANT',
              },
            });
          }
        }
      }

      // 5. Account-Level Initial Trial Claim & Data-Driven Promo Grant with Transaction Advisory Lock (TRIAL-01, PROMO-01)
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('user_benefit:' || ${userId} || ':INITIAL_TRIAL_V1'))`;

      const existingTrialClaim = await tx.accountBenefitClaim.findUnique({
        where: { user_benefit_unique: { userId, benefitKey: 'INITIAL_TRIAL_V1' } },
      });

      const isTrialEligible = !existingTrialClaim;
      let trialGrantedMonths = isTrialEligible ? 1 : 0;
      let initialTrialExpiresAt = isTrialEligible ? addCalendarMonths(now, 1) : now;

      // Canonical Promo Code evaluation (PromoService)
      let finalExpiresAt = initialTrialExpiresAt;
      let promoApplied = false;
      let canonicalPromo: any = null;

      if (promoCode && promoCode.trim()) {
        const promoRes = await promoService.validatePromo(promoCode, userId, dormId, tx);
        if (promoRes.valid && promoRes.eligible) {
          canonicalPromo = promoRes.promoCodeEntity;
          const bonusMonths = canonicalPromo.benefitValue || 2;
          finalExpiresAt = addCalendarMonths(initialTrialExpiresAt, bonusMonths);
          promoApplied = true;
        }
      }

      // Mandatory Guard 1: Real HorPlus PRO entitlement during trial, otherwise FREE
      const proPlan = await tx.subscriptionPlan.findUnique({ where: { code: 'PAID' } });
      const freePlan = await tx.subscriptionPlan.findUnique({ where: { code: 'FREE' } });

      const isZeroPayBenefit = isTrialEligible || promoApplied;
      const effectivePlan = isZeroPayBenefit ? (proPlan || plan) : (freePlan || plan);
      const subStatus = isZeroPayBenefit ? 'TRIAL' : 'ACTIVE';
      const subExpiresAt = isZeroPayBenefit ? finalExpiresAt : addCalendarMonths(now, 1200);

      const sub = await tx.dormitorySubscription.upsert({
        where: { dormitoryId: dormId },
        create: {
          dormitoryId: dormId,
          planId: effectivePlan.id,
          status: subStatus,
          startedAt: now,
          expiresAt: subExpiresAt,
          trialStartedAt: isZeroPayBenefit ? now : null,
          trialExpiresAt: isTrialEligible ? initialTrialExpiresAt : null,
          promoExtendedAt: promoApplied ? now : null,
        },
        update: {
          planId: effectivePlan.id,
          status: subStatus,
          startedAt: now,
          expiresAt: subExpiresAt,
          trialStartedAt: isZeroPayBenefit ? now : null,
          trialExpiresAt: isTrialEligible ? initialTrialExpiresAt : null,
          promoExtendedAt: promoApplied ? now : null,
          updatedAt: now,
        },
      });

      if (isTrialEligible) {
        await tx.subscriptionStatusHistory.create({
          data: {
            subscriptionId: sub.id,
            dormitoryId: dormId,
            previousPlanId: null,
            newPlanId: effectivePlan.id,
            previousStatus: null,
            newStatus: 'TRIAL',
            reason: 'INITIAL_PRO_TRIAL_ONBOARDING',
            actorId: userId,
          },
        });

        await tx.accountBenefitClaim.create({
          data: {
            userId,
            benefitKey: 'INITIAL_TRIAL_V1',
            dormitoryId: dormId,
            subscriptionId: sub.id,
            grantedMonths: 1,
            previousExpiresAt: null,
            newExpiresAt: initialTrialExpiresAt,
          },
        });
      }

      if (promoApplied && canonicalPromo) {
        await tx.promoRedemption.create({
          data: {
            promoCodeId: canonicalPromo.id,
            dormitoryId: dormId,
            subscriptionId: sub.id,
            redeemedBy: userId,
            previousExpiresAt: initialTrialExpiresAt,
            newExpiresAt: finalExpiresAt,
          },
        });

        await tx.promoCode.update({
          where: { id: canonicalPromo.id },
          data: {
            currentRedemptionsCount: { increment: 1 },
          },
        });
      }

      // Settle Referral on first dormitory creation
      await referralService.settleReferralOnboarding(userId, dormId, 0, tx);

      if (selectedPackage) {
        await tx.subscriptionPackageIntent.create({
          data: {
            dormitoryId: dormId,
            userId,
            packageId: selectedPackage.id,
            status: 'PENDING_PAYMENT',
            durationMonthsSnapshot: selectedPackage.durationMonths,
            priceSnapshot: selectedPackage.price,
            referencePriceSnapshot: selectedPackage.referencePrice,
            finalPayableAmount: selectedPackage.price,
            checkoutVersion: 2,
            isZeroPayValidated: false,
            currencySnapshot: selectedPackage.currency,
            catalogVersion: selectedPackage.catalogVersion || 2,
            expiresAt: addCalendarMonths(now, 1),
          },
        });
      }

      await tx.onboardingDraft.updateMany({
        where: { userId },
        data: {
          finalizedAt: now,
          currentStep: 'COMPLETED',
          updatedAt: now,
        },
      });

        const promoBonusMonths = (promoApplied && canonicalPromo && typeof canonicalPromo.benefitValue === 'number') ? canonicalPromo.benefitValue : 0;

        return {
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
            planCode: effectivePlan.code,
            status: subStatus,
            trialExpiresAt: isZeroPayBenefit ? finalExpiresAt.toISOString() : null,
          },
          promo: {
            applied: promoApplied,
            promoBonusMonths,
            trialMonths: trialGrantedMonths,
            totalTrialMonths: trialGrantedMonths + promoBonusMonths,
          },
          planCode: effectivePlan.code,
          subscriptionStatus: subStatus,
          trialExpiresAt: isZeroPayBenefit ? finalExpiresAt.toISOString() : null,
          promoApplied,
          totalTrialMonths: trialGrantedMonths + promoBonusMonths,
          packageIntentId: selectedPackage ? (await tx.subscriptionPackageIntent.findFirst({ where: { dormitoryId: dormId, userId } }))?.id : null,
        };
    });

    if (lockRecord && lockRecord.id) {
      await this.idempotencyRepo.complete(lockRecord.id, 200, result);
    }

    return result;
  }
}
