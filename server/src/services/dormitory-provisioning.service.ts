import { IDormitoryRepository } from '../db/repositories/dormitory.repository.js';
import { IBillingSettingsRepository } from '../db/repositories/billing-settings.repository.js';
import { IPlanRepository } from '../db/repositories/plan.repository.js';
import { ISubscriptionRepository } from '../db/repositories/subscription.repository.js';
import { IPromoRepository } from '../db/repositories/promo.repository.js';
import { IMembershipRepository } from '../db/repositories/membership.repository.js';
import { IRoleRepository } from '../db/repositories/role.repository.js';
import { IOnboardingDraftRepository } from '../db/repositories/onboarding-draft.repository.js';
import { IIdempotencyRepository, InMemoryIdempotencyRepository } from '../db/repositories/idempotency.repository.js';
import { IBuildingRepository } from '../db/repositories/building.repository.js';
import { IRoomRepository } from '../db/repositories/room.repository.js';
import { SensitiveFieldService } from './sensitive-field.service.js';
import { PromoService } from './promo.service.js';
import { TrialSubscriptionService } from './trial-subscription.service.js';
import { subscriptionEntitlementService } from './subscription-entitlement.service.js';
import { AuditService } from './audit.service.js';
import { withUserProvisioningTransaction } from '../db/transaction-rls.js';
import { parseRoomIdentifier } from '../utils/normalization.js';
import crypto from 'crypto';

export interface CompleteOwnerOnboardingParams {
  userId: string;
  idempotencyKey: string;
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
    id: string; // The temp ID from frontend
    name: string;
    code?: string | null;
    floorsCount: number;
    roomsPerFloor?: number | null;
    numberingPattern?: string | null;
    description?: string | null;
  }[];
  rooms?: {
    buildingId?: string; // Links to temp ID
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
  promoCode?: string;
  requestId?: string;
}

export class DormitoryProvisioningService {
  private dormitoryRepo: IDormitoryRepository;
  private billingRepo: IBillingSettingsRepository;
  private planRepo: IPlanRepository;
  private subRepo: ISubscriptionRepository;
  private promoRepo: IPromoRepository;
  private membershipRepo: IMembershipRepository;
  private roleRepo: IRoleRepository;
  private draftRepo: IOnboardingDraftRepository;
  private idempotencyRepo: IIdempotencyRepository;
  private buildingRepo: IBuildingRepository;
  private roomRepo: IRoomRepository;
  private sensitiveFieldService: SensitiveFieldService;
  private promoService: PromoService;
  private auditService: AuditService;
  private dbInstance: any;

  constructor(
    dormitoryRepo: IDormitoryRepository,
    billingRepo: IBillingSettingsRepository,
    planRepo: IPlanRepository,
    subRepo: ISubscriptionRepository,
    promoRepo: IPromoRepository,
    membershipRepo: IMembershipRepository,
    roleRepo: IRoleRepository,
    draftRepo: IOnboardingDraftRepository,
    idempotencyRepo: IIdempotencyRepository,
    buildingRepo: IBuildingRepository,
    roomRepo: IRoomRepository,
    sensitiveFieldService: SensitiveFieldService,
    promoService: PromoService,
    auditService: AuditService,
    dbInstance?: any
  ) {
    this.dormitoryRepo = dormitoryRepo;
    this.billingRepo = billingRepo;
    this.planRepo = planRepo;
    this.subRepo = subRepo;
    this.promoRepo = promoRepo;
    this.membershipRepo = membershipRepo;
    this.roleRepo = roleRepo;
    this.draftRepo = draftRepo;
    this.idempotencyRepo = idempotencyRepo;
    this.buildingRepo = buildingRepo;
    this.roomRepo = roomRepo;
    this.sensitiveFieldService = sensitiveFieldService;
    this.promoService = promoService;
    this.auditService = auditService;
    this.dbInstance = dbInstance;
  }

  public async completeOwnerOnboarding(params: CompleteOwnerOnboardingParams): Promise<any> {
    const { userId, idempotencyKey, requestId, planCode, promoCode, dormitory, billing, payment, buildings, rooms } = params;

    await subscriptionEntitlementService.assertDormitoryCreationAllowed(userId);

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
      buildings,
      rooms,
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
      if (!plan) {
        const err: any = new Error('PLAN_NOT_FOUND: แพ็กเกจที่เลือกไม่ถูกต้องหรือปิดใช้งานอยู่');
        err.code = 'PLAN_NOT_FOUND';
        err.status = 400;
        throw err;
      }

      // 2. Validate Estimated Room Count vs Plan Limit
      const estimatedRoomCount = dormitory.estimatedRoomCount || 10;
      const roomLimit = plan.roomLimit ?? 150;
      if (estimatedRoomCount > roomLimit) {
        const err: any = new Error(`ROOM_ESTIMATE_EXCEEDS_PLAN: จำนวนห้องโดยประมาณ (${estimatedRoomCount}) เกินขีดจำกัดของแพ็กเกจ ${plan.name} (${roomLimit} ห้อง)`);
        err.code = 'ROOM_ESTIMATE_EXCEEDS_PLAN';
        err.status = 400;
        throw err;
      }


      const userMemberships = await this.membershipRepo.findByUserId(userId);
      const ownerMemberships = userMemberships.filter((m: any) => m.roleCode === 'OWNER' && m.status === 'active');

      // 3. Validate Free Plan Ownership Limit (Max 1 FREE dormitory per user)
      if (plan.code === 'FREE') {
        if (this.dbInstance?.dormitory) {
          // WAVE0_LEGACY_COMPAT: Count dormitories where user has OWNER membership
          // OR is the legacy creator (createdByUserId). This dual-path ensures
          // pre-backfill dormitories remain visible. Remove this fallback after
          // confirmed Membership backfill for all legitimate Pilot dormitories.
          const freeDormCount = await this.dbInstance.dormitory.count({
            where: {
              OR: [
                { members: { some: { userId, role: { code: 'OWNER' } } } },
                { createdByUserId: userId }
              ],
              status: 'active',
              dormitorySubscription: {
                plan: { code: 'FREE' }
              }
            }
          });
          if (freeDormCount > 0) {
            const err: any = new Error('FREE_DORMITORY_LIMIT_REACHED: คุณมีหอพักที่ใช้งาน Free Plan อยู่แล้ว 1 แห่ง ไม่สามารถสร้างหอพัก Free Plan เพิ่มเติมได้');
            err.code = 'FREE_DORMITORY_LIMIT_REACHED';
            err.status = 409;
            throw err;
          }
        } else {
          for (const mem of ownerMemberships) {
            const existingDorm = await this.dormitoryRepo.findById(mem.dormitoryId);
            if (existingDorm && existingDorm.status === 'active') {
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
      const result = await withUserProvisioningTransaction(this.dbInstance || {}, userId, async (tx: any) => {
        
        // Race-Safe 10-Dormitory Limit Enforcement
        if (typeof tx.$executeRawUnsafe === 'function') {
          // Validate input first
          const lockKey = String(BigInt(`0x${crypto.createHash('md5').update(userId).digest('hex').substring(0, 15)}`) % BigInt(2147483647));
          await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`);
        }

        if (tx.dormitory) {
          // WAVE0_LEGACY_COMPAT: Creator quota counts dormitories where user
          // has OWNER membership OR is the legacy creator. The quota is based on
          // createdByUserId to prevent invited dormitories from counting.
          // Remove this dual-path after confirmed Membership backfill.
          const createdDormitoriesCount = await tx.dormitory.count({
            where: {
              OR: [
                { members: { some: { userId, role: { code: 'OWNER' } } } },
                { createdByUserId: userId }
              ]
            }
          });

          if (createdDormitoriesCount >= 10) {
            const err: any = new Error('GLOBAL_DORMITORY_CREATION_LIMIT_REACHED: คุณสร้างหอพักครบจำนวนสูงสุด 10 แห่งแล้ว');
            err.code = 'GLOBAL_DORMITORY_CREATION_LIMIT_REACHED';
            err.status = 409;
            throw err;
          }
        }

        // Create Dormitory
        const dormData = {
          name: dormitory.name,
          type: dormitory.type || 'apartment',
          addressLine1: dormitory.addressLine1 || undefined,
          addressLine2: dormitory.addressLine2 || undefined,
          subdistrict: dormitory.subdistrict || undefined,
          district: dormitory.district || undefined,
          province: dormitory.province || undefined,
          postalCode: dormitory.postalCode || undefined,
          phone: dormitory.phone || undefined,
          email: dormitory.email || undefined,
          estimatedBuildingCount: dormitory.estimatedBuildingCount || 1,
          estimatedRoomCount: estimatedRoomCount,
          createdByUserId: userId,
          status: 'active',
        };

        let createdDorm;
        if (tx.dormitory) {
          // Transactionally safe durable write
          createdDorm = await tx.dormitory.create({ data: dormData });
          // Also sync to memory repo if it's being used as a mock elsewhere
          if (this.dormitoryRepo.constructor.name === 'InMemoryDormitoryRepository') {
            await this.dormitoryRepo.create({ id: createdDorm.id, ...dormData });
          }
        } else {
          createdDorm = await this.dormitoryRepo.create(dormData);
        }

        // Process Buildings and Rooms
        const buildingIdMap = new Map<string, string>();
        
        if (buildings) {
          for (const b of buildings) {
            const createdBuilding = await this.buildingRepo.create(createdDorm.id, {
              name: b.name,
              code: b.code || null,
              floorCount: b.floorsCount || 1,
              description: b.description || null,
              status: 'active',
              numberingPattern: b.numberingPattern || null
            }, tx);
            buildingIdMap.set(b.id, createdBuilding.id);
          }
        }
        
        if (rooms) {
          for (const r of rooms) {
            const bId = r.buildingId ? buildingIdMap.get(r.buildingId) || null : null;
            if (!bId) {
              const err: any = new Error(`ROOM_VALIDATION_FAILED: ห้อง ${r.roomNumber} จำเป็นต้องระบุอาคาร`);
              err.code = 'ROOM_VALIDATION_FAILED';
              err.status = 400;
              throw err;
            }
            let bConfig = { code: null, numberingPattern: null, floorCount: 1 };
            
            if (r.buildingId) {
              const originalBuilding = buildings?.find(b => b.id === r.buildingId);
              if (originalBuilding) {
                bConfig = { 
                  code: originalBuilding.code as any, 
                  numberingPattern: originalBuilding.numberingPattern as any, 
                  floorCount: originalBuilding.floorsCount 
                };
              }
            }

            const parsed = parseRoomIdentifier(bConfig as any, r.roomNumber);
            if (!parsed.isValid) {
              const err: any = new Error(`ROOM_VALIDATION_FAILED: ห้อง ${r.roomNumber} ไม่ถูกต้องตามรูปแบบของอาคาร: ${parsed.error}`);
              err.code = 'ROOM_VALIDATION_FAILED';
              err.status = 400;
              throw err;
            }
            
            await this.roomRepo.create(createdDorm.id, {
              buildingId: bId,
              roomNumber: parsed.displayValue,
              normalizedRoomNumber: parsed.normalizedValue,
              floor: r.floor || 1,
              monthlyRent: (r.monthlyRent || 0).toString(),
              depositAmount: (r.depositAmount || 0).toString(),
              parkingFee: (r.parkingFee || 0).toString(),
              maximumOccupants: r.maximumOccupants || 2,
              initialWaterReading: (r.initialWaterReading || 0).toString(),
              initialElectricityReading: (r.initialElectricityReading || 0).toString(),
              status: r.status || 'vacant',
              rentCycle: 'monthly',
            }, tx);
          }
        }

        // Create Billing Settings with Encryption-at-Rest for Financial Identifiers (PS-006)
        const promptPayRaw = payment?.promptPayValue ? String(payment.promptPayValue).replace(/\D/g, '') : null;
        const encryptedPromptPay = promptPayRaw ? this.sensitiveFieldService.encrypt(promptPayRaw).ciphertext : null;

        const bankAccRaw = payment?.bankAccountNumber ? String(payment.bankAccountNumber).trim() : null;
        const encryptedBankAcc = bankAccRaw ? this.sensitiveFieldService.encrypt(bankAccRaw).ciphertext : null;

        const billingData = {
          dormitoryId: createdDorm.id,
          billingDay: billing?.billingDay ?? 25,
          dueDay: billing?.dueDay ?? 5,
          waterBillingType: billing?.waterBillingType ?? 'per_unit',
          waterRate: billing?.waterRate ?? '18.00',
          electricityBillingType: billing?.electricityBillingType ?? 'per_unit',
          electricityRate: billing?.electricityRate ?? '7.00',
          commonFee: billing?.commonFee ?? '0.00',
          internetFee: billing?.internetFee ?? '0.00',
          lateFeeType: billing?.lateFeeType ?? 'none',
          lateFeeValue: billing?.lateFeeValue ?? '0.00',
          rentBillingType: billing?.rentBillingType ?? 'monthly',
          cashAccepted: payment?.cashAccepted ?? true,
          promptPayType: payment?.promptPayType ?? null,
          promptPayValue: null, // Zero plaintext storage in DB (PS-006)
          promptPayValueEncrypted: encryptedPromptPay,
          bankCode: payment?.bankCode ?? null,
          bankAccountName: payment?.bankAccountName ?? null,
          bankAccountNumber: bankAccRaw ? this.sensitiveFieldService.maskBankAccount(bankAccRaw) : null,
          bankAccountNumberEncrypted: encryptedBankAcc,
        };
        const createdBilling = tx.dormitory ? await tx.dormitoryBillingSettings.create({ data: billingData }) : await this.billingRepo.create(billingData);


        // System OWNER Role lookup or creation
        let ownerRole;
        if (tx.dormitory) {
          ownerRole = await tx.role.findFirst({ where: { dormitoryId: createdDorm.id, code: 'OWNER' } });
          if (!ownerRole) {
            ownerRole = await tx.role.create({ data: { dormitoryId: createdDorm.id, code: 'OWNER', name: 'เจ้าของหอพัก', permissions: { '*': ['*'] }, isSystem: true } });
          }
        } else {
          ownerRole = await this.roleRepo.findByDormitoryAndCode(createdDorm.id, 'OWNER');
          if (!ownerRole) {
            ownerRole = await this.roleRepo.createSystemRole(createdDorm.id, 'OWNER', 'เจ้าของหอพัก', { '*': ['*'] });
          }
        }

        // Create OWNER Membership
        const membershipData = {
          userId,
          dormitoryId: createdDorm.id,
          dormitoryName: createdDorm.name,
          roleId: ownerRole.id,
          roleCode: 'OWNER',
          status: 'active',
        };
        const createdMembership = tx.dormitory 
          ? await tx.dormitoryMember.create({ data: { userId, dormitoryId: createdDorm.id, roleId: ownerRole.id, status: 'active' } }) 
          : await this.membershipRepo.addMembership(membershipData as any);

        // Provision Authoritative Wave 1F Subscription inside tx
        let createdSub: any = null;
        if (tx.dormitorySubscription) {
          createdSub = await subscriptionEntitlementService.provisionInitialTrial(createdDorm.id, tx);
        } else {
          createdSub = await this.subRepo.create({
            dormitoryId: createdDorm.id,
            planId: plan.id,
            status: 'trialing',
            startedAt: new Date(),
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          } as any);
        }

        // Record Promo Redemption if HORPLUS applied during onboarding
        let promoRedemption: any = null;
        if (promoResult.valid && promoResult.code === 'HORPLUS' && tx.promoRedemption) {
          const promoCodeEntity = await tx.promoCode.findUnique({ where: { code: 'HORPLUS' } });
          if (promoCodeEntity) {
            const extensionMs = 60 * 24 * 60 * 60 * 1000;
            const baseTrialExpiresAt = createdSub.trialExpiresAt || createdSub.expiresAt;
            const newTrialExpiresAt = new Date(baseTrialExpiresAt.getTime() + extensionMs);
            const newExpiresAt = new Date(createdSub.expiresAt.getTime() + extensionMs);

            createdSub = await tx.dormitorySubscription.update({
              where: { id: createdSub.id },
              data: {
                trialExpiresAt: newTrialExpiresAt,
                expiresAt: newExpiresAt,
              },
              include: { plan: true },
            });

            promoRedemption = await tx.promoRedemption.create({
              data: {
                promoCodeId: promoCodeEntity.id,
                dormitoryId: createdDorm.id,
                subscriptionId: createdSub.id,
                redeemedBy: userId,
                previousExpiresAt: baseTrialExpiresAt,
                newExpiresAt,
              },
            });

            await tx.subscriptionStatusHistory.create({
              data: {
                subscriptionId: createdSub.id,
                dormitoryId: createdDorm.id,
                previousPlanId: createdSub.planId,
                newPlanId: createdSub.planId,
                previousStatus: 'TRIAL',
                newStatus: 'TRIAL',
                actorId: userId,
                reason: 'PROMO_HORPLUS_REDEEMED_ONBOARDING',
              },
            });
          }
        }

        // Delete Onboarding Draft
        await this.draftRepo.deleteByUserId(userId);

        // Audit Log
        this.auditService.logSecurityEvent({
          requestId,
          userId,
          dormitoryId: createdDorm.id,
          action: 'DORMITORY_PROVISIONED',
          reason: `Owner onboarding completed. Created dormitory ${createdDorm.name} with plan ${plan.code} and trial ending ${(createdSub.expiresAt || new Date()).toISOString()}`,
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
            trialStartedAt: createdSub.trialStartedAt || createdSub.startedAt,
            trialEndsAt: createdSub.trialExpiresAt || createdSub.expiresAt,
            roomLimit: plan.roomLimit,
            messageQuotaMonthly: plan.messageQuotaMonthly,
          },
          promo: {
            applied: promoResult.valid,
            code: promoResult.valid ? promoResult.code : null,
            bonusDays: promoResult.valid ? 60 : 0,
            totalTrialMonths: promoResult.valid ? 3 : 1,
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


