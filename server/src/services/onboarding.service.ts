/**
 * Onboarding Service (Task-009 — Single OnboardingDraft Source of Truth & State Machine)
 * @license Apache-2.0
 */

import { PrismaClient } from '@prisma/client';
import { AppError } from '../types/index.js';

export interface OnboardingStatusResult {
  onboardingRequired: boolean;
  hasDraft: boolean;
  currentStep: string | null;
  provisionalDormitoryId: string | null;
  ownedDormitoryCount: number;
  freeDormitoryAvailable: boolean;
}

export class OnboardingService {
  constructor(private prisma: PrismaClient) {}

  public async getStatus(userId: string): Promise<OnboardingStatusResult> {
    const memberships = await this.prisma.dormitoryMember.findMany({
      where: { userId, status: 'active' },
      include: { dormitory: true },
    });

    const activeDormMemberships = memberships.filter(
      (m) => m.dormitory && m.dormitory.status === 'active'
    );

    const draft = await this.prisma.onboardingDraft.findUnique({
      where: { userId },
    });

    // Count all owned dormitories (active + setup_pending) for quota evaluation
    const ownedDormitories = await this.prisma.dormitory.findMany({
      where: {
        createdByUserId: userId,
        status: { in: ['active', 'setup_pending'] },
      },
    });

    // Check if user already owns an active FREE plan dormitory
    const freeSubs = await this.prisma.dormitorySubscription.findMany({
      where: {
        dormitoryId: { in: activeDormMemberships.map((m) => m.dormitoryId) },
        plan: { code: 'FREE' },
      },
    });

    const freeDormitoryAvailable = freeSubs.length === 0;
    // Onboarding is required if no active dormitories exist or draft is unfinalized
    const onboardingRequired = activeDormMemberships.length === 0 || (!!draft && !draft.finalizedAt);

    return {
      onboardingRequired,
      hasDraft: !!draft && !draft.finalizedAt,
      currentStep: draft && !draft.finalizedAt ? draft.currentStep : null,
      provisionalDormitoryId: draft && !draft.finalizedAt ? draft.provisionalDormitoryId : null,
      ownedDormitoryCount: ownedDormitories.length,
      freeDormitoryAvailable,
    };
  }

  public async getDraft(userId: string) {
    const draft = await this.prisma.onboardingDraft.findUnique({
      where: { userId },
    });
    if (!draft || draft.finalizedAt) return null;
    return draft;
  }

  public async saveDraft(userId: string, currentStep: string, payload: any, provisionalDormitoryId?: string) {
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days expiry

    return await this.prisma.onboardingDraft.upsert({
      where: { userId },
      create: {
        userId,
        currentStep: currentStep || 'dormitory',
        payload: payload || {},
        provisionalDormitoryId: provisionalDormitoryId || null,
        expiresAt,
      },
      update: {
        currentStep: currentStep || 'dormitory',
        payload: payload || {},
        ...(provisionalDormitoryId ? { provisionalDormitoryId } : {}),
        expiresAt,
        updatedAt: new Date(),
      },
    });
  }

  public async deleteDraft(userId: string): Promise<void> {
    await this.prisma.onboardingDraft.deleteMany({
      where: { userId },
    });
  }
}
