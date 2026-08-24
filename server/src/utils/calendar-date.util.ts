export const BANGKOK_TIMEZONE = 'Asia/Bangkok';
export const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * Returns YYYY-MM-DD date string in Asia/Bangkok timezone (+07:00).
 * Throws an invariant error if date is invalid or parts cannot be formatted.
 */
export function toBangkokDateString(instant: Date | string = new Date()): string {
  const d = typeof instant === 'string' ? new Date(instant) : instant;
  if (!d || isNaN(d.getTime())) {
    throw new Error(`Invalid Date passed to toBangkokDateString: ${String(instant)}`);
  }

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: BANGKOK_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = formatter.formatToParts(d);
  const year = parts.find(p => p.type === 'year')?.value;
  const month = parts.find(p => p.type === 'month')?.value;
  const day = parts.find(p => p.type === 'day')?.value;

  if (!year || !month || !day) {
    throw new Error('Failed to format date in Asia/Bangkok timezone: missing required date parts');
  }

  return `${year}-${month}-${day}`;
}

/**
 * Canonical date normalizer that converts any date input (date-only string, ISO timestamp string, or Date instance)
 * into a YYYY-MM-DD string in Asia/Bangkok timezone.
 *
 * Rules:
 * 1. Pure date-only string (/^\d{4}-\d{2}-\d{2}$/): Returns as-is ("YYYY-MM-DD") preserving date-only calendar semantics.
 * 2. ISO timestamp / datetime string / Date object: Normalizes through Asia/Bangkok (+07:00) using toBangkokDateString.
 * 3. Invalid or empty value: Throws an invariant error.
 */
export function normalizeBangkokDate(input: Date | string): string {
  if (!input) {
    throw new Error('normalizeBangkokDate: input cannot be null, undefined, or empty');
  }

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const [y, m, d] = trimmed.split('-').map(Number);
      const testDate = new Date(Date.UTC(y, m - 1, d));
      if (
        testDate.getUTCFullYear() === y &&
        testDate.getUTCMonth() === m - 1 &&
        testDate.getUTCDate() === d
      ) {
        return trimmed;
      }
      throw new Error(`Invalid calendar date string: ${trimmed}`);
    }
    // For ISO timestamps (e.g. "2026-06-30T18:30:00.000Z"):
    return toBangkokDateString(new Date(trimmed));
  }

  if (input instanceof Date) {
    return toBangkokDateString(input);
  }

  throw new Error(`Invalid date input type: ${typeof input}`);
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

/**
 * Calculates adjacent cycle code (YYYY-MM) offset by a given number of months.
 */
export function getAdjacentCycleCode(code: string, offsetMonths: number): string {
  if (!code || typeof code !== 'string') return '';
  const match = /^(\d{4})-(\d{2})$/.exec(code);
  if (!match) return code;
  let y = parseInt(match[1], 10);
  let m = parseInt(match[2], 10) + offsetMonths;
  if (isNaN(y) || isNaN(m)) return code;
  while (m > 12) {
    m -= 12;
    y += 1;
  }
  while (m < 1) {
    m += 12;
    y -= 1;
  }
  return `${y}-${String(m).padStart(2, '0')}`;
}
