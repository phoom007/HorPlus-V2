import { IOnboardingDraftRepository, OnboardingDraftEntity } from '../db/repositories/onboarding-draft.repository.js';
import { IMembershipRepository } from '../db/repositories/membership.repository.js';
import { IDormitoryRepository } from '../db/repositories/dormitory.repository.js';
import { ISubscriptionRepository } from '../db/repositories/subscription.repository.js';
import { IPlanRepository } from '../db/repositories/plan.repository.js';

export interface OnboardingStatusResult {
  onboardingRequired: boolean;
  hasDraft: boolean;
  currentStep: string | null;
  ownedDormitoryCount: number;
  freeDormitoryAvailable: boolean;
}

export class OnboardingService {
  private draftRepo: IOnboardingDraftRepository;
  private membershipRepo: IMembershipRepository;
  private dormitoryRepo: IDormitoryRepository;
  private subscriptionRepo: ISubscriptionRepository;
  private planRepo: IPlanRepository;

  constructor(
    draftRepo: IOnboardingDraftRepository,
    membershipRepo: IMembershipRepository,
    dormitoryRepo: IDormitoryRepository,
    subscriptionRepo: ISubscriptionRepository,
    planRepo: IPlanRepository
  ) {
    this.draftRepo = draftRepo;
    this.membershipRepo = membershipRepo;
    this.dormitoryRepo = dormitoryRepo;
    this.subscriptionRepo = subscriptionRepo;
    this.planRepo = planRepo;
  }

  public async getStatus(userId: string): Promise<OnboardingStatusResult> {
    const memberships = await this.membershipRepo.findByUserId(userId);
    const activeMemberships = memberships.filter((m) => m.status === 'active');
    const ownerMemberships = activeMemberships.filter((m) => m.roleCode === 'OWNER');

    const draft = await this.draftRepo.findByUserId(userId);

    // Count FREE plan dormitories created/owned by user
    let freeOwnedCount = 0;
    for (const mem of ownerMemberships) {
      const dorm = await this.dormitoryRepo.findById(mem.dormitoryId);
      if (dorm && dorm.status === 'active') {
        const sub = await this.subscriptionRepo.findByDormitoryId(dorm.id);
        if (sub) {
          const plan = await this.planRepo.findById(sub.planId);
          if (plan && plan.code === 'FREE') {
            freeOwnedCount++;
          }
        }
      }
    }

    const freeDormitoryAvailable = freeOwnedCount === 0;
    const onboardingRequired = activeMemberships.length === 0;

    return {
      onboardingRequired,
      hasDraft: !!draft,
      currentStep: draft ? draft.currentStep : null,
      ownedDormitoryCount: ownerMemberships.length,
      freeDormitoryAvailable,
    };
  }

  public async getDraft(userId: string): Promise<OnboardingDraftEntity | null> {
    return this.draftRepo.findByUserId(userId);
  }

  public async saveDraft(userId: string, currentStep: string, payload: any): Promise<OnboardingDraftEntity> {
    return this.draftRepo.saveDraft({
      userId,
      currentStep: currentStep || 'dormitory',
      payload: payload || {},
    });
  }

  public async deleteDraft(userId: string): Promise<void> {
    await this.draftRepo.deleteByUserId(userId);
  }
}
