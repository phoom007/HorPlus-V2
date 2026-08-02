import { calculateInitialTrialEnd, calculateMaximumTrialEnd } from '../utils/calendar-date.util.js';

export interface TrialCalculationResult {
  trialStartedAt: Date;
  trialEndsAt: Date;
  trialMonths: number;
}

export class TrialSubscriptionService {
  /**
   * Calculates trial start and end dates using calendar-month semantics.
   * Initial Trial: 1 calendar month.
   * With HORPLUS / Bonus: Capped at maximum 3 calendar months from original trialStartedAt.
   */
  public static calculateTrialDates(hasBonusPromo = false, baseDate: Date = new Date()): TrialCalculationResult {
    const trialStartedAt = new Date(baseDate.getTime());
    const trialEndsAt = hasBonusPromo
      ? calculateMaximumTrialEnd(trialStartedAt)
      : calculateInitialTrialEnd(trialStartedAt);

    return {
      trialStartedAt,
      trialEndsAt,
      trialMonths: hasBonusPromo ? 3 : 1,
    };
  }
}
