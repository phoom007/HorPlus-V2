/**
 * @license Apache-2.0
 * Canonical Central Utility Billing Mode Normalizer
 *
 * Normalizes legacy & casing variants into strict canonical modes:
 * - 'per_unit'   <= 'per_unit', 'unit', 'PER_UNIT', 'per-unit'
 * - 'per_person' <= 'per_person', 'person', 'PER_PERSON', 'per-person'
 * - 'fixed'      <= 'fixed', 'room', 'per_room', 'FIXED', 'ROOM', 'per-room'
 *
 * Unknown / unsupported values FAIL CLOSED by throwing INVALID_BILLING_MODE error.
 */

export type CanonicalUtilityBillingMode = 'per_unit' | 'per_person' | 'fixed';

export function normalizeUtilityBillingMode(raw: unknown): CanonicalUtilityBillingMode {
  if (raw === null || raw === undefined || typeof raw !== 'string') {
    const err = new Error('INVALID_BILLING_MODE: Billing mode cannot be empty or non-string');
    (err as any).statusCode = 400;
    (err as any).code = 'INVALID_BILLING_MODE';
    throw err;
  }

  const cleaned = raw.trim().toLowerCase().replace(/[-\s]/g, '_');
  switch (cleaned) {
    case 'per_unit':
    case 'unit':
      return 'per_unit';
    case 'per_person':
    case 'person':
      return 'per_person';
    case 'fixed':
    case 'room':
    case 'per_room':
      return 'fixed';
    default: {
      const err = new Error(`INVALID_BILLING_MODE: Unsupported utility billing mode '${raw}'`);
      (err as any).statusCode = 400;
      (err as any).code = 'INVALID_BILLING_MODE';
      throw err;
    }
  }
}

export function safeNormalizeUtilityBillingMode(
  raw: unknown,
  fallback?: CanonicalUtilityBillingMode
): CanonicalUtilityBillingMode | null {
  if (raw === null || raw === undefined || typeof raw !== 'string' || raw.trim() === '') {
    return fallback ?? null;
  }
  return normalizeUtilityBillingMode(raw);
}
