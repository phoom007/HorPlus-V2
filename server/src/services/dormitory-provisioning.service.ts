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
import { decryptText } from '../utils/crypto-encryption.js';
import { IIdempotencyRepository, InMemoryIdempotencyRepository } from '../db/repositories/idempotency.repository.js';

export interface CompleteOwnerOnboardingParams {
  userId: string;
  idempotencyKey: string;
  provisionalDormitoryId?: string;
  dormitory: {
    name: string;
    type?: string | null;
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
    internetFee?: string;
    lateFeeType?: string;
    lateFeeValue?: string;
    rentBillingType?: string;
  };
  payment?: {
    cashAccepted?: boolean;
    promptPayType?: string | null;
    promptPayValue?: string | null;
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
    numberingPattern?: string | null;
    description?: string | null;
  }[];
  rooms?: {
    buildingId?: string;
    roomNumber: string;
    floor: number;
    monthlyRent: number;
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
          : new SensitiveFieldService(process.env.FIELD_ENCRYPTION_KEY || 'default_32_byte_secret_key_123456');
    } else {
      const lastArg = rest[rest.length - 1];
      this.prisma = lastArg && typeof lastArg.$transaction === 'function' ? lastArg : (prismaOrRepo as PrismaClient);
      this.sensitiveFieldService = new SensitiveFieldService(process.env.FIELD_ENCRYPTION_KEY || 'default_32_byte_secret_key_123456');

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

          const appOrigin = process.env.PUBLIC_APP_ORIGIN || process.env.APPLICATION_URL || 'http://127.0.0.1:3001';
          let webhookUrl: string | null = null;
          if (provDorm.lineConfig?.webhookKeyEncrypted) {
            try {
              const rawKey = decryptText(provDorm.lineConfig.webhookKeyEncrypted);
              webhookUrl = `${appOrigin.replace(/\/$/, '')}/api/v1/line/webhook/${rawKey}`;
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

      if (existingDormCount >= 10) {
        throw new AppError('DORMITORY_LIMIT_EXCEEDED: คุณมีหอพักสูงสุดตามโควต้า 10 แห่งแล้ว', 403, 'DORMITORY_LIMIT_EXCEEDED');
      }

      const dormName = data.name || 'หอพักใหม่ (กำลังลงทะเบียน)';
      const webhookKey = nodeCrypto.randomBytes(32).toString('hex');
      const webhookKeyHash = nodeCrypto.createHash('sha256').update(webhookKey).digest('hex');
      const encryptedWebhookKey = this.sensitiveFieldService.encrypt(webhookKey);

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
          webhookKeyHash,
          webhookKeyEncrypted: encryptedWebhookKey.ciphertext,
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

      const appOrigin = process.env.PUBLIC_APP_ORIGIN || process.env.APPLICATION_URL || 'http://127.0.0.1:3001';
      const webhookUrl = `${appOrigin.replace(/\/$/, '')}/api/v1/line/webhook/${webhookKey}`;

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
        const prov = await this.prepareProvisionalDormitory(userId, { name: dormitory.name }, tx);
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
      const currentSig = await tx.ownerSignature.findFirst({
        where: { dormitoryId: dormId, isCurrent: true },
      });

      if (!currentSig) {
        throw new AppError('กรุณาบันทึกลายเซ็นเจ้าของหอพักในขั้นตอนที่ 4 ก่อนยืนยันสร้างหอพัก', 400, 'OWNER_SIGNATURE_REQUIRED');
      }

      // 3. Validate LINE OA Readiness (Step 5 Requirement)
      const lineConfig = await tx.dormitoryLineConfig.findUnique({
        where: { dormitoryId: dormId },
      });

      const isLineReady = Boolean(
        lineConfig &&
        lineConfig.accessTokenVerifiedAt &&
        lineConfig.webhookEndpointSetAt &&
        lineConfig.webhookTestSucceededAt &&
        lineConfig.webhookActive
      );

      if (!isLineReady) {
        throw new AppError(
          'LINE OA ยังไม่พร้อมใช้งาน กรุณาตั้งค่า LINE OA ให้ครบทุกขั้นตอนก่อนยืนยันสร้างหอพัก',
          400,
          'LINE_ONBOARDING_NOT_READY'
        );
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
        const waterRateStr = (billing.waterRate !== undefined && billing.waterRate !== null && billing.waterRate !== '') ? String(billing.waterRate) : '18.00';
        const electricityRateStr = (billing.electricityRate !== undefined && billing.electricityRate !== null && billing.electricityRate !== '') ? String(billing.electricityRate) : '7.00';
        const commonFeeStr = (billing.commonFee !== undefined && billing.commonFee !== null && billing.commonFee !== '') ? String(billing.commonFee) : '0.00';
        const internetFeeStr = (billing.internetFee !== undefined && billing.internetFee !== null && billing.internetFee !== '') ? String(billing.internetFee) : '0.00';
        const lateFeeValueStr = (billing.lateFeeValue !== undefined && billing.lateFeeValue !== null && billing.lateFeeValue !== '') ? String(billing.lateFeeValue) : '50.00';

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
            internetFee: internetFeeStr,
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
            internetFee: internetFeeStr,
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
            bankCode: payment.bankCode || null,
            bankAccountName: payment.bankAccountName || null,
            bankAccountNumber: payment.bankAccountNumber ? this.sensitiveFieldService.maskBankAccount(payment.bankAccountNumber) : null,
            bankAccountNumberEncrypted: encBankAccount,
          },
        });
      }

      // Save Buildings and Rooms if provided
      if (buildings && buildings.length > 0) {
        for (const b of buildings) {
          const createdBld = await tx.building.create({
            data: {
              dormitoryId: dormId,
              name: b.name,
              code: b.code || null,
              floorCount: b.floorsCount || 1,
              roomsPerFloor: b.roomsPerFloor || null,
              description: b.description || null,
            },
          });

          const matchingRooms = (rooms || []).filter((r) => r.buildingId === b.id);
          for (const r of matchingRooms) {
            const normalizedRoomNumber = normalizeRoomIdentifier(r.roomNumber);
            await tx.room.create({
              data: {
                dormitoryId: dormId,
                buildingId: createdBld.id,
                roomNumber: r.roomNumber,
                normalizedRoomNumber,
                floor: r.floor || 1,
                roomType: (r as any).roomType || 'standard',
                monthlyRent: String(r.monthlyRent ?? 0),
                depositAmount: String(r.depositAmount ?? 0),
                status: r.status || 'VACANT',
              },
            });
          }
        }
      }

      // 5. Account-Level Initial Trial Claim (+1 CALENDAR MONTH)
      let trialGrantedMonths = 1;
      let initialTrialExpiresAt = addCalendarMonths(now, 1);
      let isAccountTrialClaimed = false;

      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', '', true)`;
      const existingTrialClaim = await tx.accountBenefitClaim.findUnique({
        where: { user_benefit_unique: { userId, benefitKey: 'INITIAL_TRIAL_V1' } },
      });
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormId}, true)`;

      if (existingTrialClaim) {
        isAccountTrialClaimed = true;
        trialGrantedMonths = 0;
        initialTrialExpiresAt = now;
      }

      // Check HORPLUS Promo Code (+2 CALENDAR MONTHS)
      let finalExpiresAt = initialTrialExpiresAt;
      let promoApplied = false;
      let canonicalPromo: any = null;

      if (promoCode && promoCode.trim().toUpperCase() === 'HORPLUS' && trialGrantedMonths > 0) {
        canonicalPromo = await tx.promoCode.findUnique({
          where: { normalizedCode: 'HORPLUS' },
        });

        if (canonicalPromo && canonicalPromo.enabled) {
          const existingRedemption = await tx.promoRedemption.findUnique({
            where: { promo_user_unique: { promoCodeId: canonicalPromo.id, redeemedBy: userId } },
          });

          if (!existingRedemption) {
            finalExpiresAt = addCalendarMonths(initialTrialExpiresAt, 2);
            promoApplied = true;
          }
        }
      }

      await subscriptionEntitlementService.provisionInitialTrial(dormId, tx, now);

      const sub = await tx.dormitorySubscription.upsert({
        where: { dormitoryId: dormId },
        create: {
          dormitoryId: dormId,
          planId: plan.id,
          status: 'TRIAL',
          startedAt: now,
          expiresAt: finalExpiresAt,
          trialStartedAt: now,
          trialExpiresAt: initialTrialExpiresAt,
          promoExtendedAt: promoApplied ? now : null,
        },
        update: {
          planId: plan.id,
          status: 'TRIAL',
          startedAt: now,
          expiresAt: finalExpiresAt,
          trialStartedAt: now,
          trialExpiresAt: initialTrialExpiresAt,
          promoExtendedAt: promoApplied ? now : null,
          updatedAt: now,
        },
      });

      if (!isAccountTrialClaimed) {
        try {
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
        } catch (err: any) {
          console.error('[ACCOUNT BENEFIT CLAIM ERROR]', err);
          trialGrantedMonths = 0;
        }
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
      }

      if (selectedPackage) {
        await tx.subscriptionPackageIntent.create({
          data: {
            dormitoryId: dormId,
            userId,
            packageId: selectedPackage.id,
            status: 'PENDING_PAYMENT',
            durationMonthsSnapshot: selectedPackage.durationMonths,
            priceSnapshot: selectedPackage.price,
            currencySnapshot: selectedPackage.currency,
            catalogVersion: selectedPackage.catalogVersion || 1,
          },
        });
      }

      await tx.onboardingDraft.update({
        where: { userId },
        data: {
          finalizedAt: now,
          currentStep: 'COMPLETED',
          updatedAt: now,
        },
      });

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
          planCode: plan.code,
          status: 'TRIAL',
          trialExpiresAt: finalExpiresAt.toISOString(),
        },
        promo: {
          applied: promoApplied,
          promoBonusMonths: promoApplied ? 2 : 0,
          trialMonths: trialGrantedMonths,
          totalTrialMonths: trialGrantedMonths + (promoApplied ? 2 : 0),
        },
        planCode: plan.code,
        subscriptionStatus: 'TRIAL',
        trialExpiresAt: finalExpiresAt.toISOString(),
        promoApplied,
        totalTrialMonths: trialGrantedMonths + (promoApplied ? 2 : 0),
      };
    });

    if (lockRecord && lockRecord.id) {
      await this.idempotencyRepo.complete(lockRecord.id, 200, result);
    }

    return result;
  }
}
