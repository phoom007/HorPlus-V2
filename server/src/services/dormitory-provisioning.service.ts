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
  lineOA?: {
    skipped?: boolean;
    messagingChannelId?: string | null;
    channelSecret?: string | null;
    channelAccessToken?: string | null;
    lineLoginChannelId?: string | null;
    liffId?: string | null;
    liffEndpointUrl?: string | null;
  } | null;
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
    const { userId, idempotencyKey, requestId, planCode, promoCode, dormitory, billing, buildings, rooms, lineOA } = params;

    if (!idempotencyKey || !idempotencyKey.trim()) {
      const err: any = new Error('IDEMPOTENCY_KEY_REQUIRED: กรุณาระบุ X-Idempotency-Key สำหรับการสร้างหอพัก');
      err.code = 'IDEMPOTENCY_KEY_REQUIRED';
      err.status = 400;
      throw err;
    }

    const payloadHash = InMemoryIdempotencyRepository.hashPayload({
      dormitory,
      billing,
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
              subscriptions: {
                some: {
                  plan: { code: 'FREE' },
                }
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

        // Create Billing Settings
        const billingData = {
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

        // Calculate Trial Subscription using Calendar Month semantics
        const trialCalc = TrialSubscriptionService.calculateTrialDates(promoResult.valid);

        let realPlanId = plan.id;
        if (tx.platformPlan) {
          let dbPlan = await tx.platformPlan.findUnique({ where: { id: plan.id } });
          if (!dbPlan) {
            dbPlan = await tx.platformPlan.findFirst({ where: { code: plan.code } });
          }
          if (!dbPlan) {
            dbPlan = await tx.platformPlan.create({
              data: {
                id: plan.id,
                code: plan.code,
                name: plan.name || (plan.code === 'FREE' ? 'Free Plan' : 'Paid Plan'),
                roomLimit: plan.roomLimit || (plan.code === 'FREE' ? 10 : 150),
                monthlyPrice: plan.monthlyPrice || 0,
              }
            });
          }
          realPlanId = dbPlan.id;
        }

        const subData = {
          dormitoryId: createdDorm.id,
          planId: realPlanId,
          status: plan.code === 'FREE' ? 'active' : 'trialing',
          billingInterval: 'monthly',
          trialStartedAt: trialCalc.trialStartedAt,
          trialEndsAt: trialCalc.trialEndsAt,
          currentPeriodStartedAt: trialCalc.trialStartedAt,
          currentPeriodEndsAt: trialCalc.trialEndsAt,
        };
        const createdSub = tx.dormitory ? await tx.platformSubscription.create({ data: subData }) : await this.subRepo.create(subData as any);

        // Record Promo Redemption if applied
        let promoRedemption = null;
        if (promoResult.valid && promoResult.promoCodeEntity) {
          let realPromoCodeId = promoResult.promoCodeEntity.id;
          if (tx.platformPromoCode) {
            let dbPromo = await tx.platformPromoCode.findFirst({
              where: { codeNormalized: promoResult.promoCodeEntity.codeNormalized }
            });
            if (!dbPromo) {
              dbPromo = await tx.platformPromoCode.create({
                data: {
                  id: promoResult.promoCodeEntity.id,
                  code: promoResult.promoCodeEntity.code,
                  codeNormalized: promoResult.promoCodeEntity.codeNormalized,
                  trialBonusDays: promoResult.bonusTrialDays,
                  status: 'active'
                }
              });
            }
            realPromoCodeId = dbPromo.id;
          }

          const promoData = {
            promoCodeId: realPromoCodeId,
            dormitoryId: createdDorm.id,
            userId,
            subscriptionId: createdSub.id,
            bonusDays: promoResult.bonusTrialDays,
          };
          if (tx.dormitory) {
            promoRedemption = await tx.platformPromoRedemption.create({ data: promoData });
          } else {
            promoRedemption = await this.promoRepo.createRedemption(promoData);
          }
        }

        // Persist LINE OA Integration Mapping with High-Entropy Webhook Public Key
        let createdLineIntegration = null;
        if (lineOA && !lineOA.skipped) {
          const channelIdToSave = lineOA.messagingChannelId || '2006789012';
          const channelSecretToSave = lineOA.channelSecret || '1234567890abcdef1234567890abcdef';
          const channelAccessTokenToSave = lineOA.channelAccessToken || null;
          const rawPublicKey = `wh_${crypto.randomBytes(32).toString('base64url')}`;
          const keyHash = crypto.createHash('sha256').update(rawPublicKey).digest('hex');
          const encryptedSecret = this.sensitiveFieldService.encrypt(channelSecretToSave).ciphertext;
          const encryptedToken = channelAccessTokenToSave ? this.sensitiveFieldService.encrypt(channelAccessTokenToSave).ciphertext : null;

          if (tx.lineOaIntegration) {
            createdLineIntegration = await tx.lineOaIntegration.upsert({
              where: { dormitory_messaging_channel_unique: { dormitoryId: createdDorm.id, messagingChannelId: channelIdToSave } },
              update: {
                channelSecretEncrypted: encryptedSecret,
                lineLoginChannelId: lineOA.lineLoginChannelId || null,
                liffId: lineOA.liffId || null,
                liffEndpointUrl: lineOA.liffEndpointUrl || null,
                status: 'connected',
                connectedAt: new Date(),
                lastConnectionCheckAt: new Date()
              },
              create: {
                dormitoryId: createdDorm.id,
                messagingChannelId: channelIdToSave,
                channelSecretEncrypted: encryptedSecret,
                lineLoginChannelId: lineOA.lineLoginChannelId || null,
                liffId: lineOA.liffId || null,
                liffEndpointUrl: lineOA.liffEndpointUrl || null,
                webhookPublicKey: rawPublicKey,
                webhookKeyHash: keyHash,
                status: 'connected',
                connectedAt: new Date()
              }
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
            totalTrialMonths: trialCalc.trialMonths,
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


