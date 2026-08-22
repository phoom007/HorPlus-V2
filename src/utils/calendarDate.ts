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
