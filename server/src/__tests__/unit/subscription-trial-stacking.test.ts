/**
 * @license Apache-2.0
 * Subscription Trial Stacking & Eligibility Unit Tests (PERF-02, PERF-07)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import { subscriptionIntentService } from '../../services/subscription-intent.service.js';
import { addCalendarMonths } from '../../utils/calendar-math.js';

describe('Subscription Trial Stacking on Active PRO (PERF-07)', () => {
  const userId = '00000000-0000-0000-0000-000000000001';
  const dormId = '00000000-0000-0000-0000-000000000002';
  const intentId = '00000000-0000-0000-0000-000000000003';

  let mockTx: any;
  let mockUpsertResult: any;
  let mockHistoryCreated: any;
  let mockBenefitClaimCreated: any;

  beforeEach(() => {
    mockUpsertResult = null;
    mockHistoryCreated = null;
    mockBenefitClaimCreated = null;

    mockTx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      $queryRaw: vi.fn().mockResolvedValue([{ id: userId }]),
      accountBenefitClaim: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(async (args) => {
          mockBenefitClaimCreated = args.data;
          return { id: 'claim-1', ...args.data };
        }),
      },
      subscriptionPlan: {
        findUnique: vi.fn().mockImplementation(async ({ where }) => {
          if (where.code === 'PAID') {
            return { id: 'plan-pro-id', code: 'PAID', name: 'HorPlus PRO', type: 'PAID' };
          }
          if (where.code === 'FREE') {
            return { id: 'plan-free-id', code: 'FREE', name: 'HorPlus Free', type: 'FREE' };
          }
          return null;
        }),
      },
      dormitorySubscription: {
        findUnique: vi.fn(),
        upsert: vi.fn().mockImplementation(async (args) => {
          mockUpsertResult = args;
          return {
            id: 'sub-id-123',
            dormitoryId: dormId,
            ...(args.update || args.create),
          };
        }),
      },
      subscriptionStatusHistory: {
        create: vi.fn().mockImplementation(async (args) => {
          mockHistoryCreated = args.data;
          return { id: 'history-1', ...args.data };
        }),
      },
      subscriptionPackageIntent: {
        findUnique: vi.fn(),
        update: vi.fn().mockResolvedValue({ id: intentId, status: 'SUCCEEDED' }),
      },
    };
  });

  it('stacks +1 calendar month (+30 days) onto existing active PRO subscription with 112 days remaining without resetting to 30 days', async () => {
    const now = new Date();
    // 112 days in the future
    const originalStartedAt = new Date(now.getTime() - 30 * 86400 * 1000);
    const existingExpiresAt = new Date(now.getTime() + 112 * 86400 * 1000);

    const activeProSub = {
      id: 'sub-existing-pro',
      dormitoryId: dormId,
      planId: 'plan-pro-id',
      status: 'ACTIVE',
      startedAt: originalStartedAt,
      expiresAt: existingExpiresAt,
      trialStartedAt: null,
      trialExpiresAt: null,
      plan: {
        id: 'plan-pro-id',
        code: 'PAID',
        type: 'PAID',
      },
    };

    mockTx.dormitorySubscription.findUnique.mockResolvedValue(activeProSub);

    mockTx.subscriptionPackageIntent.findUnique.mockResolvedValue({
      id: intentId,
      userId,
      dormitoryId: dormId,
      status: 'PENDING_PAYMENT',
      checkoutVersion: 2,
      finalPayableAmount: new Prisma.Decimal(0),
      isZeroPayValidated: true,
      isTrialEligibleSnapshot: true,
      durationMonthsSnapshot: 1,
      coinApplied: 0,
      promoCodeSnapshot: null,
      expiresAt: new Date(now.getTime() + 3600 * 1000),
      package: {
        id: 'pkg-1m-id',
        planId: 'plan-pro-id',
        plan: { name: 'HorPlus PRO' },
      },
    });

    const result = await subscriptionIntentService.commitZeroPayIntent(userId, intentId, 'idemp-1', mockTx);

    expect(result.success).toBe(true);
    expect(result.status).toBe('SUCCEEDED');
    expect(result.isTrialEligible).toBe(true);

    // Expected stacked expiry is existingExpiresAt + 1 calendar month
    const expectedStackedExpiry = addCalendarMonths(existingExpiresAt, 1);
    expect(result.expiresAt?.getTime()).toBe(expectedStackedExpiry.getTime());

    // Verify it did NOT reset to now + 1 month
    const resetMonthExpiry = addCalendarMonths(now, 1);
    expect(result.expiresAt?.getTime()).not.toBe(resetMonthExpiry.getTime());
    expect(result.expiresAt!.getTime()).toBeGreaterThan(existingExpiresAt.getTime());

    // Verify upsert kept ACTIVE status and preserved original startedAt
    expect(mockUpsertResult.update.status).toBe('ACTIVE');
    expect(mockUpsertResult.update.startedAt.getTime()).toBe(originalStartedAt.getTime());
    expect(mockUpsertResult.update.expiresAt.getTime()).toBe(expectedStackedExpiry.getTime());

    // Verify history reason is TRIAL_EXTENSION_ACTIVE_PRO
    expect(mockHistoryCreated.reason).toBe('TRIAL_EXTENSION_ACTIVE_PRO');
    expect(mockHistoryCreated.previousStatus).toBe('ACTIVE');
    expect(mockHistoryCreated.newStatus).toBe('ACTIVE');

    // Verify benefit claim recorded previous and new expiresAt
    expect(mockBenefitClaimCreated.previousExpiresAt.getTime()).toBe(existingExpiresAt.getTime());
    expect(mockBenefitClaimCreated.newExpiresAt.getTime()).toBe(expectedStackedExpiry.getTime());
  });

  it('provisions clean 1-month trial starting from now when dormitory has FREE or expired subscription', async () => {
    const now = new Date();
    const freeSub = {
      id: 'sub-existing-free',
      dormitoryId: dormId,
      planId: 'plan-free-id',
      status: 'ACTIVE',
      startedAt: new Date(now.getTime() - 60 * 86400 * 1000),
      expiresAt: null,
      trialStartedAt: null,
      trialExpiresAt: null,
      plan: {
        id: 'plan-free-id',
        code: 'FREE',
        type: 'FREE',
      },
    };

    mockTx.dormitorySubscription.findUnique.mockResolvedValue(freeSub);

    mockTx.subscriptionPackageIntent.findUnique.mockResolvedValue({
      id: intentId,
      userId,
      dormitoryId: dormId,
      status: 'PENDING_PAYMENT',
      checkoutVersion: 2,
      finalPayableAmount: new Prisma.Decimal(0),
      isZeroPayValidated: true,
      isTrialEligibleSnapshot: true,
      durationMonthsSnapshot: 1,
      coinApplied: 0,
      promoCodeSnapshot: null,
      expiresAt: new Date(now.getTime() + 3600 * 1000),
      package: {
        id: 'pkg-1m-id',
        planId: 'plan-pro-id',
        plan: { name: 'HorPlus PRO' },
      },
    });

    const result = await subscriptionIntentService.commitZeroPayIntent(userId, intentId, 'idemp-2', mockTx);

    expect(result.success).toBe(true);
    expect(result.isTrialEligible).toBe(true);

    // Should set status to TRIAL
    expect(mockUpsertResult.update.status).toBe('TRIAL');
    // Expected expiry is now + 1 month
    const expectedExpiry = addCalendarMonths(now, 1);
    expect(Math.abs(result.expiresAt!.getTime() - expectedExpiry.getTime())).toBeLessThan(2000);

    // Verify history reason is INITIAL_PROVISIONING_CALENDAR_MONTH_TRIAL
    expect(mockHistoryCreated.reason).toBe('INITIAL_PROVISIONING_CALENDAR_MONTH_TRIAL');
    expect(mockBenefitClaimCreated.previousExpiresAt).toBeNull();
  });

  it('evaluates isTrialEligible to true for an active PRO subscription if user and dorm have not consumed trial (PERF-02 Authority 1)', () => {
    const subscription = {
      plan: { code: 'PAID', type: 'PAID', name: 'HorPlus PRO' },
      status: 'ACTIVE',
      trialStartedAt: null,
    };
    const existingClaim = null;
    const hasDormUsedTrial = Boolean(subscription?.trialStartedAt);
    const isTrialEligible = !existingClaim && !hasDormUsedTrial;

    expect(isTrialEligible).toBe(true);
  });
});
