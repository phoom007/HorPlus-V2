/**
 * Calendar Month Arithmetic Utilities (Task-009 — Tested Month-End Edge Cases)
 * @license Apache-2.0
 */

/**
 * Add N calendar months to a given date.
 * Handles month-end clamping (e.g. Jan 31 + 1m -> Feb 28/29, Mar 31 + 1m -> Apr 30).
 */
export function addCalendarMonths(startDate: Date, months: number): Date {
  const result = new Date(startDate.getTime());
  const targetMonth = result.getMonth() + months;
  const originalDate = result.getDate();

  result.setMonth(targetMonth);

  // If overflow occurred (e.g. Jan 31 -> Feb 28/29), clamp to last day of target month
  if (result.getDate() !== originalDate) {
    result.setDate(0);
  }

  return result;
}
