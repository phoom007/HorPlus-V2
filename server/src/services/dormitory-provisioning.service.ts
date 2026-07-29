import { IDormitoryRepository } from '../db/repositories/dormitory.repository.js';
import { IBillingSettingsRepository } from '../db/repositories/billing-settings.repository.js';
import { IPaymentSettingsRepository } from '../db/repositories/payment-settings.repository.js';
import { IPlanRepository } from '../db/repositories/plan.repository.js';
import { ISubscriptionRepository } from '../db/repositories/subscription.repository.js';
import { IPromoRepository } from '../db/repositories/promo.repository.js';
import { IMembershipRepository } from '../db/repositories/membership.repository.js';
import { IRoleRepository } from '../db/repositories/role.repository.js';
import { IOnboardingDraftRepository } from '../db/repositories/onboarding-draft.repository.js';
import { IIdempotencyRepository, InMemoryIdempotencyRepository } from '../db/repositories/idempotency.repository.js';
import { SensitiveFieldService } from './sensitive-field.service.ts';
import { PromoService } from './promo.service.js';
import { TrialSubscriptionService } from './trial-subscription.service.js';
import { AuditService } from './audit.service.js';
import { withUserProvisioningTransaction } from '../db/transaction-rls.js';

export interface CompleteOwnerOnboardingParams {
  userId: string;
  idempotencyKey: string;
  dormitory: {
    name: string;
    type?: string;
    addressLine1?: string;
    addressLine2?: string;
    subdistrict?: string;
    district?: string;
    province?: string;
    postalCode?: string;
    phone?: string;
    email?: string;
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
    promptPayType?: string;
    promptPayValue?: string;
    bankCode?: string;
    bankAccountName?: string;
    bankAccountNumber?: string;
  };
  planCode: string;
  promoCode?: string;
  requestId?: string;
}

export class DormitoryProvisioningService {
  private dormitoryRepo: IDormitoryRepository;
  private billingRepo: IBillingSettingsRepository;
  private paymentRepo: IPaymentSettingsRepository;
  private planRepo: IPlanRepository;
  private subRepo: ISubscriptionRepository;
  private promoRepo: IPromoRepository;
  private membershipRepo: IMembershipRepository;
  private roleRepo: IRoleRepository;
  private draftRepo: IOnboardingDraftRepository;
  private idempotencyRepo: IIdempotencyRepository;
  private sensitiveFieldService: SensitiveFieldService;
  private promoService: PromoService;
  private auditService: AuditService;
  private dbInstance: any;

  constructor(
    dormitoryRepo: IDormitoryRepository,
    billingRepo: IBillingSettingsRepository,
    paymentRepo: IPaymentSettingsRepository,
    planRepo: IPlanRepository,
    subRepo: ISubscriptionRepository,
    promoRepo: IPromoRepository,
    membershipRepo: IMembershipRepository,
    roleRepo: IRoleRepository,
    draftRepo: IOnboardingDraftRepository,
    idempotencyRepo: IIdempotencyRepository,
    sensitiveFieldService: SensitiveFieldService,
    promoService: PromoService,
    auditService: AuditService,
    dbInstance?: any
  ) {
    this.dormitoryRepo = dormitoryRepo;
    this.billingRepo = billingRepo;
    this.paymentRepo = paymentRepo;
    this.planRepo = planRepo;
    this.subRepo = subRepo;
    this.promoRepo = promoRepo;
    this.membershipRepo = membershipRepo;
    this.roleRepo = roleRepo;
    this.draftRepo = draftRepo;
    this.idempotencyRepo = idempotencyRepo;
    this.sensitiveFieldService = sensitiveFieldService;
    this.promoService = promoService;
    this.auditService = auditService;
    this.dbInstance = dbInstance;
  }

  public async completeOwnerOnboarding(params: CompleteOwnerOnboardingParams): Promise<any> {
    const { userId, idempotencyKey, requestId, planCode, promoCode, dormitory, billing, payment } = params;

    if (!idempotencyKey || !idempotencyKey.trim()) {
      const err: any = new Error('IDEMPOTENCY_KEY_REQUIRED: กรุณาระบุ X-Idempotency-Key สำหรับการสร้างหอพัก');
      err.code = 'IDEMPOTENCY_KEY_REQUIRED';
      err.status = 400;
      throw err;
    }

    const payloadHash = InMemoryIdempotencyRepository.hashPayload({
      dormitory,
      billing,
      payment,
      planCode,
      promoCode,
    });

    const operation = 'complete_owner_onboarding';
    const existingKey = await this.idempotencyRepo.find(userId, operation, idempotencyKey);

    if (existingKey) {
      if (existingKey.status === 'completed') {
        if (existingKey.requestHash === payloadHash) {
          // Replay response
          return existingKey.responseBody;
        } else {
          const err: any = new Error('IDEMPOTENCY_KEY_REUSED: Idempotency Key ถูกใช้งานแล้วกับข้อมูลที่แตกต่างกัน');
          err.code = 'IDEMPOTENCY_KEY_REUSED';
          err.status = 409;
          throw err;
        }
      } else if (existingKey.status === 'processing') {
        const err: any = new Error('IDEMPOTENCY_REQUEST_IN_PROGRESS: มีคำขอที่กำลังประมวลผลอยู่ด้วย Idempotency Key นี้');
        err.code = 'IDEMPOTENCY_REQUEST_IN_PROGRESS';
        err.status = 409;
        throw err;
      }
    }

    const lock = await this.idempotencyRepo.lock(userId, operation, idempotencyKey, payloadHash);

    try {
      // 1. Validate Plan
      const plan = await this.planRepo.findByCode(planCode);
      if (!plan || !plan.isActive) {
        const err: any = new Error('PLAN_NOT_FOUND: แพ็กเกจที่เลือกไม่ถูกต้องหรือปิดใช้งานอยู่');
        err.code = 'PLAN_NOT_FOUND';
        err.status = 400;
        throw err;
      }

      // 2. Validate Estimated Room Count vs Plan Limit
      const estimatedRoomCount = dormitory.estimatedRoomCount || 10;
      if (plan.roomLimit !== null && estimatedRoomCount > plan.roomLimit) {
        const err: any = new Error(`ROOM_ESTIMATE_EXCEEDS_PLAN: จำนวนห้องโดยประมาณ (${estimatedRoomCount}) เกินขีดจำกัดของแพ็กเกจ ${plan.name} (${plan.roomLimit} ห้อง)`);
        err.code = 'ROOM_ESTIMATE_EXCEEDS_PLAN';
        err.status = 400;
        throw err;
      }

      // 3. Validate Free Plan Ownership Limit (Max 1 FREE dormitory per user)
      if (plan.code === 'FREE') {
        const userMemberships = await this.membershipRepo.findByUserId(userId);
        const ownerMemberships = userMemberships.filter((m) => m.roleCode === 'OWNER' && m.status === 'active');

        for (const mem of ownerMemberships) {
          const existingDorm = await this.dormitoryRepo.findById(mem.dormitoryId);
          if (existingDorm && existingDorm.createdByUserId === userId && existingDorm.status === 'active') {
            const existingSub = await this.subRepo.findByDormitoryId(existingDorm.id);
            if (existingSub) {
              const existingPlan = await this.planRepo.findById(existingSub.planId);
              if (existingPlan && existingPlan.code === 'FREE') {
                const err: any = new Error('FREE_DORMITORY_LIMIT_REACHED: คุณมีหอพักที่ใช้งาน Free Plan อยู่แล้ว 1 แห่ง ไม่สามารถสร้างหอพัก Free Plan เพิ่มเติมได้');
                err.code = 'FREE_DORMITORY_LIMIT_REACHED';
                err.status = 409;
                throw err;
              }
            }
          }
        }
      }

      // 4. Validate Promo Code if provided
      let promoResult = await this.promoService.validatePromo(promoCode);
      if (promoCode && promoCode.trim() && !promoResult.valid) {
        const err: any = new Error(`PROMO_CODE_INVALID: ${promoResult.message || 'รหัสโปรโมชันไม่สามารถใช้งานได้'}`);
        err.code = 'PROMO_CODE_INVALID';
        err.status = 400;
        throw err;
      }

      // 5. Execute Provisioning in User Transaction
      const result = await withUserProvisioningTransaction(this.dbInstance || {}, userId, async () => {
        // Create Dormitory
        const createdDorm = await this.dormitoryRepo.create({
          name: dormitory.name,
          type: dormitory.type || 'apartment',
          addressLine1: dormitory.addressLine1,
          addressLine2: dormitory.addressLine2,
          subdistrict: dormitory.subdistrict,
          district: dormitory.district,
          province: dormitory.province,
          postalCode: dormitory.postalCode,
          phone: dormitory.phone,
          email: dormitory.email,
          estimatedBuildingCount: dormitory.estimatedBuildingCount || 1,
          estimatedRoomCount: estimatedRoomCount,
          createdByUserId: userId,
          status: 'active',
        });

        // Create Billing Settings
        const createdBilling = await this.billingRepo.create({
          dormitoryId: createdDorm.id,
          billingDay: billing?.billingDay ?? 25,
          dueDay: billing?.dueDay ?? 5,
          waterBillingType: billing?.waterBillingType || 'per_unit',
          waterRate: billing?.waterRate || '18.00',
          electricityBillingType: billing?.electricityBillingType || 'per_unit',
          electricityRate: billing?.electricityRate || '7.00',
          commonFee: billing?.commonFee || '0.00',
          internetFee: billing?.internetFee || '0.00',
          lateFeeType: billing?.lateFeeType || 'fixed',
          lateFeeValue: billing?.lateFeeValue || '50.00',
          rentBillingType: billing?.rentBillingType || 'monthly',
        });

        // Sensitive Payment Details Encrypt & Mask
        let promptPayEncrypted: string | null = null;
        let promptPayMasked: string | null = null;
        if (payment?.promptPayValue) {
          const enc = this.sensitiveFieldService.encrypt(payment.promptPayValue);
          promptPayEncrypted = enc.ciphertext;
          promptPayMasked = this.sensitiveFieldService.maskPromptPay(payment.promptPayType, payment.promptPayValue);
        }

        let bankAccountEncrypted: string | null = null;
        let bankAccountMasked: string | null = null;
        if (payment?.bankAccountNumber) {
          const enc = this.sensitiveFieldService.encrypt(payment.bankAccountNumber);
          bankAccountEncrypted = enc.ciphertext;
          bankAccountMasked = this.sensitiveFieldService.maskBankAccount(payment.bankAccountNumber);
        }

        const createdPayment = await this.paymentRepo.create({
          dormitoryId: createdDorm.id,
          cashAccepted: payment?.cashAccepted ?? true,
          promptPayType: payment?.promptPayType || null,
          promptPayValueEncrypted: promptPayEncrypted,
          promptPayValueMasked: promptPayMasked,
          bankCode: payment?.bankCode || null,
          bankAccountName: payment?.bankAccountName || null,
          bankAccountNumberEncrypted: bankAccountEncrypted,
          bankAccountNumberMasked: bankAccountMasked,
          encryptionKeyVersion: 1,
        });

        // System OWNER Role lookup or creation
        let ownerRole = await this.roleRepo.findByDormitoryAndCode(createdDorm.id, 'OWNER');
        if (!ownerRole) {
          ownerRole = await this.roleRepo.createSystemRole(createdDorm.id, 'OWNER', 'เจ้าของหอพัก', { '*': ['*'] });
        }

        // Create OWNER Membership
        const createdMembership = await this.membershipRepo.addMembership({
          userId,
          dormitoryId: createdDorm.id,
          dormitoryName: createdDorm.name,
          roleId: ownerRole.id,
          roleCode: 'OWNER',
          status: 'active',
        });

        // Calculate Trial Subscription
        const bonusDays = promoResult.valid ? promoResult.bonusTrialDays : 0;
        const trialCalc = TrialSubscriptionService.calculateTrialDates(bonusDays);

        const createdSub = await this.subRepo.create({
          dormitoryId: createdDorm.id,
          planId: plan.id,
          status: 'trialing',
          billingInterval: 'monthly',
          trialStartedAt: trialCalc.trialStartedAt,
          trialEndsAt: trialCalc.trialEndsAt,
          currentPeriodStartedAt: trialCalc.trialStartedAt,
          currentPeriodEndsAt: trialCalc.trialEndsAt,
        });

        // Record Promo Redemption if applied
        let promoRedemption = null;
        if (promoResult.valid && promoResult.promoCodeEntity) {
          promoRedemption = await this.promoRepo.createRedemption({
            promoCodeId: promoResult.promoCodeEntity.id,
            dormitoryId: createdDorm.id,
            userId,
            subscriptionId: createdSub.id,
            bonusDays: promoResult.bonusTrialDays,
          });
        }

        // Delete Onboarding Draft
        await this.draftRepo.deleteByUserId(userId);

        // Audit Log
        this.auditService.logSecurityEvent({
          requestId,
          userId,
          dormitoryId: createdDorm.id,
          action: 'DORMITORY_PROVISIONED',
          reason: `Owner onboarding completed. Created dormitory ${createdDorm.name} with plan ${plan.code} and trial ending ${trialCalc.trialEndsAt.toISOString()}`,
          severity: 'info',
        });

        return {
          dormitory: {
            id: createdDorm.id,
            name: createdDorm.name,
            type: createdDorm.type,
            estimatedBuildingCount: createdDorm.estimatedBuildingCount,
            estimatedRoomCount: createdDorm.estimatedRoomCount,
            status: createdDorm.status,
            createdAt: createdDorm.createdAt,
          },
          membership: {
            id: createdMembership.id,
            dormitoryId: createdMembership.dormitoryId,
            roleCode: 'OWNER',
            status: createdMembership.status,
          },
          subscription: {
            id: createdSub.id,
            planCode: plan.code,
            planName: plan.name,
            status: createdSub.status,
            trialStartedAt: createdSub.trialStartedAt,
            trialEndsAt: createdSub.trialEndsAt,
            roomLimit: plan.roomLimit,
            messageQuotaMonthly: plan.messageQuotaMonthly,
          },
          promo: {
            applied: promoResult.valid,
            code: promoResult.valid ? promoResult.code : null,
            bonusDays: promoResult.valid ? promoResult.bonusTrialDays : 0,
            totalTrialDays: trialCalc.totalTrialDays,
          },
          onboardingRequired: false,
        };
      });

      // Complete Idempotency Record
      await this.idempotencyRepo.complete(lock.id, 200, result, 'Dormitory', result.dormitory.id);

      return result;
    } catch (err: any) {
      await this.idempotencyRepo.fail(lock.id, err.status || 500, { message: err.message, code: err.code });
      throw err;
    }
  }
}
