export interface TrialCalculationResult {
  trialStartedAt: Date;
  trialEndsAt: Date;
  standardTrialDays: number;
  bonusTrialDays: number;
  totalTrialDays: number;
}

export class TrialSubscriptionService {
  public static calculateTrialDates(bonusDays = 0, baseDate: Date = new Date()): TrialCalculationResult {
    const standardTrialDays = 30;
    const bonusTrialDays = Math.max(0, bonusDays);
    const totalTrialDays = standardTrialDays + bonusTrialDays;

    const trialStartedAt = new Date(baseDate.getTime());
    const trialEndsAt = new Date(baseDate.getTime() + totalTrialDays * 24 * 60 * 60 * 1000);

    return {
      trialStartedAt,
      trialEndsAt,
      standardTrialDays,
      bonusTrialDays,
      totalTrialDays,
    };
  }
}
