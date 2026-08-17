import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Prisma } from '@prisma/client';
import { getPrismaClient } from '../src/db/prisma.js';
import { SubscriptionIntentService } from '../src/services/subscription-intent.service.js';

describe('Subscription Trial Split & Multi-Dorm Trial Authority', () => {
  const prisma = getPrismaClient();
  const subscriptionIntentService = new SubscriptionIntentService(prisma);

  let testUserId1: string;
  let testUserId2: string;
  let dormA1: string;
  let dormB1: string;
  let dormA2: string;
  let dormB2: string;

  beforeAll(async () => {
    // Clean up or prepare test users
    const email1 = `trial-split-test-1-${Date.now()}@example.com`;
    const user1 = await prisma.user.create({
      data: {
        email: email1,
        emailNormalized: email1.toLowerCase(),
        name: 'Trial User 1',
        phone: '0811111111',
        googleSubject: `sub_trial_1_${Date.now()}`,
      },
    });
    testUserId1 = user1.id;

    const email2 = `trial-split-test-2-${Date.now()}@example.com`;
    const user2 = await prisma.user.create({
      data: {
        email: email2,
        emailNormalized: email2.toLowerCase(),
        name: 'Trial User 2',
        phone: '0822222222',
        googleSubject: `sub_trial_2_${Date.now()}`,
      },
    });
    testUserId2 = user2.id;

    const d1 = await prisma.dormitory.create({
      data: { name: 'Dorm A1', status: 'setup_pending', createdByUserId: testUserId1 },
    });
    dormA1 = d1.id;

    const d2 = await prisma.dormitory.create({
      data: { name: 'Dorm B1', status: 'setup_pending', createdByUserId: testUserId1 },
    });
    dormB1 = d2.id;

    const d3 = await prisma.dormitory.create({
      data: { name: 'Dorm A2', status: 'setup_pending', createdByUserId: testUserId2 },
    });
    dormA2 = d3.id;

    const d4 = await prisma.dormitory.create({
      data: { name: 'Dorm B2', status: 'setup_pending', createdByUserId: testUserId2 },
    });
    dormB2 = d4.id;
  });

  afterAll(async () => {
    await prisma.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
    await prisma.subscriptionPackageIntent.deleteMany({
      where: { userId: { in: [testUserId1, testUserId2] } },
    });
    await prisma.accountBenefitClaim.deleteMany({
      where: { userId: { in: [testUserId1, testUserId2] } },
    });
    await prisma.dormitory.deleteMany({
      where: { id: { in: [dormA1, dormB1, dormA2, dormB2] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [testUserId1, testUserId2] } },
    });
    await prisma.$disconnect();
  });

  it('proves account with no claim returns accountTrialAvailable=true across 1, 3, and 6 months quotes', async () => {
    const pkg1mo = await prisma.subscriptionPackage.findFirst({ where: { durationMonths: 1 } });
    const pkg3mo = await prisma.subscriptionPackage.findFirst({ where: { durationMonths: 3 } });
    const pkg6mo = await prisma.subscriptionPackage.findFirst({ where: { durationMonths: 6 } });

    // 1-month quote
    const quote1 = await subscriptionIntentService.createIntentQuote(
      testUserId1,
      { packageId: pkg1mo!.id },
      undefined,
      dormA1
    );
    expect(quote1.accountTrialAvailable).toBe(true);
    expect(quote1.isTrialEligible).toBe(true);
    expect(quote1.finalPayableAmount).toBe('0.00');

    // 3-month quote: accountTrialAvailable is STILL true, but isTrialEligible is false
    const quote3 = await subscriptionIntentService.createIntentQuote(
      testUserId1,
      { packageId: pkg3mo!.id },
      undefined,
      dormA1
    );
    expect(quote3.accountTrialAvailable).toBe(true);
    expect(quote3.isTrialEligible).toBe(false);
    expect(quote3.finalPayableAmount).toBe('529.00');

    // 6-month quote: accountTrialAvailable is STILL true, isTrialEligible is false
    const quote6 = await subscriptionIntentService.createIntentQuote(
      testUserId1,
      { packageId: pkg6mo!.id },
      undefined,
      dormA1
    );
    expect(quote6.accountTrialAvailable).toBe(true);
    expect(quote6.isTrialEligible).toBe(false);
    expect(quote6.finalPayableAmount).toBe('999.00');
  });

  it('proves claiming INITIAL_TRIAL_V1 on Dorm A makes Dorm B 1-month quote accountTrialAvailable=false (189.00 THB)', async () => {
    // Record trial claim for User 1
    await prisma.accountBenefitClaim.create({
      data: {
        user: { connect: { id: testUserId1 } },
        dormitory: { connect: { id: dormA1 } },
        benefitKey: 'INITIAL_TRIAL_V1',
        grantedMonths: 1,
        newExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    const pkg1mo = await prisma.subscriptionPackage.findFirst({ where: { durationMonths: 1 } });
    const quoteDormB = await subscriptionIntentService.createIntentQuote(
      testUserId1,
      { packageId: pkg1mo!.id },
      undefined,
      dormB1
    );

    expect(quoteDormB.accountTrialAvailable).toBe(false);
    expect(quoteDormB.isTrialEligible).toBe(false);
    expect(quoteDormB.finalPayableAmount).toBe('189.00');
  });

  it('proves User 2 with first dorm FREE (trial unclaimed) can still use 1-month trial on second dorm', async () => {
    // User 2 creates Dorm A2 with FREE plan
    const freeQuote = await subscriptionIntentService.createIntentQuote(
      testUserId2,
      { isFreePlan: true },
      undefined,
      dormA2
    );
    expect(freeQuote.isFreePlan).toBe(true);
    expect(freeQuote.accountTrialAvailable).toBe(true);

    // User 2 creates Dorm B2 with 1-month PRO -> trial is still available
    const pkg1mo = await prisma.subscriptionPackage.findFirst({ where: { durationMonths: 1 } });
    const quoteDormB2 = await subscriptionIntentService.createIntentQuote(
      testUserId2,
      { packageId: pkg1mo!.id },
      undefined,
      dormB2
    );

    expect(quoteDormB2.accountTrialAvailable).toBe(true);
    expect(quoteDormB2.isTrialEligible).toBe(true);
    expect(quoteDormB2.finalPayableAmount).toBe('0.00');
  });
});
