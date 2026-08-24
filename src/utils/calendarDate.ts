export const BANGKOK_TIMEZONE = 'Asia/Bangkok';

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
 * Returns current business month code in Asia/Bangkok timezone (YYYY-MM).
 */
export function currentBusinessMonthInBangkok(instant: Date | string = new Date()): string {
  return toBangkokDateString(instant).slice(0, 7);
}

/**
 * Formats a year and 1-indexed month into a YYYY-MM code string.
 */
function formatYearMonth(year: number, month: number): string {
  const mStr = String(month).padStart(2, '0');
  return `${year}-${mStr}`;
}

/**
 * Calculates the rolling 3-month window { previousMonth, currentMonth, nextMonth }
 * based on business date in Asia/Bangkok timezone.
 * Handles calendar year boundaries properly (e.g. Jan has Dec prev year, Dec has Jan next year).
 */
export function getRollingThreeMonthWindow(referenceDate: Date | string = new Date()): string[] {
  const bkkDateStr = toBangkokDateString(referenceDate);
  const [yearStr, monthStr] = bkkDateStr.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10); // 1-indexed (1..12)

  // Previous month
  let prevYear = year;
  let prevMonth = month - 1;
  if (prevMonth < 1) {
    prevMonth = 12;
    prevYear -= 1;
  }

  // Current month
  const currYear = year;
  const currMonth = month;

  // Next month
  let nextYear = year;
  let nextMonth = month + 1;
  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear += 1;
  }

  return [
    formatYearMonth(prevYear, prevMonth),
    formatYearMonth(currYear, currMonth),
    formatYearMonth(nextYear, nextMonth),
  ];
}

/**
 * Determines whether the given cycle code (YYYY-MM) falls within the rolling 3-month window
 * { previousMonth, currentMonth, nextMonth } of the current business date in Asia/Bangkok.
 */
export function isCycleInRollingThreeMonthWindow(
  cycleCode: string | undefined | null,
  referenceDate: Date | string = new Date()
): boolean {
  if (!cycleCode || typeof cycleCode !== 'string') return false;
  const windowCodes = getRollingThreeMonthWindow(referenceDate);
  return windowCodes.includes(cycleCode.trim());
}

/**
 * Formats a Gregorian date (Date instance or YYYY-MM-DD string) into Thai Buddhist short date format "(DD/MM/YY)".
 * Example: "2026-08-25" -> "(25/08/69)"
 */
export function formatShortThaiBuddhistDate(input?: Date | string | null): string {
  if (!input) return '-';
  try {
    const bkkStr = normalizeBangkokDate(input);
    const [yearStr, monthStr, dayStr] = bkkStr.split('-');
    const beYear = parseInt(yearStr, 10) + 543;
    const shortBeYear = String(beYear).slice(-2);
    return `(${dayStr}/${monthStr}/${shortBeYear})`;
  } catch {
    return '-';
  }
}

