export const BANGKOK_TIMEZONE = 'Asia/Bangkok';
export const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * Returns YYYY-MM-DD date string in Asia/Bangkok timezone (+07:00).
 */
export function toBangkokDateString(instant: Date | string = new Date()): string {
  const d = typeof instant === 'string' ? new Date(instant) : instant;
  const bangkokLocal = new Date(d.getTime() + BANGKOK_OFFSET_MS);
  const year = bangkokLocal.getUTCFullYear();
  const month = String(bangkokLocal.getUTCMonth() + 1).padStart(2, '0');
  const day = String(bangkokLocal.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Returns current business date string in Asia/Bangkok timezone (YYYY-MM-DD).
 */
export function currentBusinessDateInBangkok(instant: Date | string = new Date()): string {
  return toBangkokDateString(instant);
}

/**
 * Evaluates whether target business date (YYYY-MM-DD or Date/string) has been reached in Asia/Bangkok timezone at the given instant.
 */
export function isBusinessDateReached(targetDateInput: Date | string, instant: Date | string = new Date()): boolean {
  const targetDateStr = typeof targetDateInput === 'string' && targetDateInput.length === 10
    ? targetDateInput
    : toBangkokDateString(targetDateInput);
  const currentDateStr = toBangkokDateString(instant);
  return currentDateStr >= targetDateStr;
}

/**
 * Converts a Bangkok date string (YYYY-MM-DD) into its exact starting UTC Date (00:00:00.000 Asia/Bangkok = 17:00:00.000 UTC previous day).
 */
export function getBangkokStartOfDayUtc(dateStr: string): Date {
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10) - 1;
  const day = parseInt(dayStr, 10);
  const localUtcMs = Date.UTC(year, month, day, 0, 0, 0, 0);
  return new Date(localUtcMs - BANGKOK_OFFSET_MS);
}

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
  const localTime = new Date(sourceDate.getTime() + BANGKOK_OFFSET_MS);

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

  return new Date(targetLocalUtc - BANGKOK_OFFSET_MS);
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
