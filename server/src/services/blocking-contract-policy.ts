/**
 * Authoritative Policy for Blocking Contract Statuses and Interval Overlaps
 * Used across AvailabilityService, Contract creation, activation, and extension checks.
 */

export const BLOCKING_CONTRACT_STATUSES = [
  'active',
  'approved',
  'expiring_soon',
  'waiting_extension',
  'checking_out',
] as const;

export type BlockingContractStatus = typeof BLOCKING_CONTRACT_STATUSES[number];

/**
 * Standard interval overlap calculation (half-open interval):
 * Returns true if existingStart < requestedEnd AND existingEnd > requestedStart
 */
export function isIntervalOverlapping(
  existingStart: Date | string,
  existingEnd: Date | string,
  requestedStart: Date | string,
  requestedEnd: Date | string
): boolean {
  const eStart = new Date(existingStart).getTime();
  const eEnd = new Date(existingEnd).getTime();
  const rStart = new Date(requestedStart).getTime();
  const rEnd = new Date(requestedEnd).getTime();

  if (isNaN(eStart) || isNaN(eEnd) || isNaN(rStart) || isNaN(rEnd)) {
    return false;
  }

  return eStart < rEnd && eEnd > rStart;
}
