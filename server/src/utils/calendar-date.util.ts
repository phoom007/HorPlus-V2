export const BANGKOK_TIMEZONE = 'Asia/Bangkok';

/**
 * Adds a specified number of calendar months to a date using Asia/Bangkok business date semantics,
 * clamping to the last valid day of the target month if the source day exceeds it.
 * Returns a UTC Date instance for PostgreSQL persistence.
 */
export function addCalendarMonthsClamped(
  sourceDate: Date,
  numberOfMonths: number,
  timeZone: string = BANGKOK_TIMEZONE
): Date {
  // Asia/Bangkok is UTC+7 (+07:00, no DST)
  const bangkokOffsetMs = 7 * 60 * 60 * 1000;
  const localTime = new Date(sourceDate.getTime() + bangkokOffsetMs);

  const year = localTime.getUTCFullYear();
  const month = localTime.getUTCMonth(); // 0-indexed (0 = Jan, 1 = Feb, etc.)
  const day = localTime.getUTCDate();
  const hours = localTime.getUTCHours();
  const minutes = localTime.getUTCMinutes();
  const seconds = localTime.getUTCSeconds();
  const milliseconds = localTime.getUTCMilliseconds();

  // Calculate target year and month
  const totalMonths = month + numberOfMonths;
  const targetYear = year + Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;

  // Determine maximum valid days in target month (last day of targetMonth)
  const maxDaysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();

  // Clamp target day
  const targetDay = Math.min(day, maxDaysInTargetMonth);

  // Construct target local UTC milliseconds and subtract Bangkok offset to return UTC Date
  const targetLocalUtc = Date.UTC(
    targetYear,
    targetMonth,
    targetDay,
    hours,
    minutes,
    seconds,
    milliseconds
  );

  return new Date(targetLocalUtc - bangkokOffsetMs);
}

/**
 * Calculates initial trial end date (exactly 1 calendar month from trialStartedAt).
 */
export function calculateInitialTrialEnd(trialStartedAt: Date): Date {
  return addCalendarMonthsClamped(trialStartedAt, 1);
}

/**
 * Calculates maximum trial end date (exactly 3 calendar months from original trialStartedAt).
 */
export function calculateMaximumTrialEnd(trialStartedAt: Date): Date {
  return addCalendarMonthsClamped(trialStartedAt, 3);
}
