/**
 * @license Apache-2.0
 * Canonical Central Utility Tier Validator & Contract
 *
 * Enforces strict fail-closed validation and decimal normalization for progressive tiered utility rates.
 * Rules:
 * 1. 1 <= tiers.length <= 10
 * 2. Intermediate tiers (index < length - 1) MUST have finite, positive, strictly ascending upTo boundaries.
 * 3. Final tier (index === length - 1) MUST have upTo: null (unlimited).
 * 4. All rates must be non-negative decimals (rate >= 0.00). Rate of 0.00 is explicitly valid.
 * 5. Rejects scientific notation ("1e2", "5e-1"), leading '+', untrimmed strings, >2 decimal places, NaN, Infinity, negative values, malformed structures, gaps, and duplicates.
 */

import { toDecimal, formatDecimal, compareDecimals } from './decimal-math.util.js';
import type { CanonicalUtilityBillingMode } from './billing-mode-normalizer.util.js';

export interface CanonicalTierRecord {
  upTo: string | null; // Exact 2-decimal upper boundary (e.g. "10.00") or null for unlimited
  rate: string;        // Exact 2-decimal rate per unit (e.g. "18.00")
}

export interface CanonicalTierBreakdown {
  lowerExclusive: string;
  upperInclusive: string | null;
  billedUnits: string;
  rate: string;
  amount: string;
}

export interface CanonicalTieredBillItemMetadata {
  mode: 'tiered';
  usageUnits: string;
  tierBreakdown: CanonicalTierBreakdown[];
}

export interface ValidateTierModeOptions {
  mode: CanonicalUtilityBillingMode;
  tiers: unknown;
  utilityName?: string;
}

const STRICT_DECIMAL_SYNTAX = /^\d{1,10}(\.\d{1,2})?$/;

function parseAndValidateStrictDecimal(val: unknown, fieldDesc: string): string {
  if (val === undefined || val === null || val === '') {
    const err = new Error(`INVALID_TIER_CONFIGURATION: ${fieldDesc} is required and cannot be empty`);
    (err as any).statusCode = 400;
    (err as any).code = 'INVALID_TIER_CONFIGURATION';
    throw err;
  }

  let strVal: string;
  if (typeof val === 'string') {
    if (!STRICT_DECIMAL_SYNTAX.test(val)) {
      const err = new Error(`INVALID_TIER_CONFIGURATION: ${fieldDesc} '${val}' must be a valid non-negative decimal string with up to 2 decimal places (no scientific notation, signs, or excessive precision)`);
      (err as any).statusCode = 400;
      (err as any).code = 'INVALID_TIER_CONFIGURATION';
      throw err;
    }
    strVal = val;
  } else if (typeof val === 'number') {
    if (!Number.isFinite(val) || Number.isNaN(val) || val < 0) {
      const err = new Error(`INVALID_TIER_CONFIGURATION: ${fieldDesc} '${val}' must be a finite non-negative number`);
      (err as any).statusCode = 400;
      (err as any).code = 'INVALID_TIER_CONFIGURATION';
      throw err;
    }
    const fixedStr = val.toFixed(2);
    if (Number(fixedStr) !== val && Math.abs(Number(fixedStr) - val) > 1e-9) {
      const err = new Error(`INVALID_TIER_CONFIGURATION: ${fieldDesc} '${val}' cannot have more than 2 decimal places`);
      (err as any).statusCode = 400;
      (err as any).code = 'INVALID_TIER_CONFIGURATION';
      throw err;
    }
    strVal = fixedStr;
  } else {
    const err = new Error(`INVALID_TIER_CONFIGURATION: ${fieldDesc} must be a decimal string or number`);
    (err as any).statusCode = 400;
    (err as any).code = 'INVALID_TIER_CONFIGURATION';
    throw err;
  }

  const dec = toDecimal(strVal);
  if (compareDecimals(dec, toDecimal('0.00')) < 0) {
    const err = new Error(`INVALID_TIER_CONFIGURATION: ${fieldDesc} cannot be negative`);
    (err as any).statusCode = 400;
    (err as any).code = 'INVALID_TIER_CONFIGURATION';
    throw err;
  }

  return formatDecimal(dec);
}

export function validateCanonicalUtilityTiers(input: unknown): CanonicalTierRecord[] {
  if (!Array.isArray(input)) {
    const err = new Error('INVALID_TIER_CONFIGURATION: Tier configuration must be an array');
    (err as any).statusCode = 400;
    (err as any).code = 'INVALID_TIER_CONFIGURATION';
    throw err;
  }

  if (input.length < 1) {
    const err = new Error('INVALID_TIER_CONFIGURATION: Tier configuration must contain at least 1 tier');
    (err as any).statusCode = 400;
    (err as any).code = 'INVALID_TIER_CONFIGURATION';
    throw err;
  }

  if (input.length > 10) {
    const err = new Error('INVALID_TIER_CONFIGURATION: Tier configuration exceeds maximum limit of 10 tiers');
    (err as any).statusCode = 400;
    (err as any).code = 'INVALID_TIER_CONFIGURATION';
    throw err;
  }

  const normalizedTiers: CanonicalTierRecord[] = [];
  let prevUpToDec: any = null;

  for (let i = 0; i < input.length; i++) {
    const rawTier = input[i];
    if (!rawTier || typeof rawTier !== 'object') {
      const err = new Error(`INVALID_TIER_CONFIGURATION: Tier at index ${i} must be an object`);
      (err as any).statusCode = 400;
      (err as any).code = 'INVALID_TIER_CONFIGURATION';
      throw err;
    }

    const isLast = i === input.length - 1;

    // Strict rate validation
    const normalizedRate = parseAndValidateStrictDecimal(rawTier.rate, `Tier at index ${i} rate`);

    // Strict upTo validation
    const rawUpTo = rawTier.upTo;

    if (isLast) {
      const isNullish = rawUpTo === null || rawUpTo === undefined || rawUpTo === '' || rawUpTo === 'null';
      if (!isNullish) {
        const err = new Error(`INVALID_TIER_CONFIGURATION: Final tier must be unlimited (upTo: null), received '${rawUpTo}'`);
        (err as any).statusCode = 400;
        (err as any).code = 'INVALID_TIER_CONFIGURATION';
        throw err;
      }
      normalizedTiers.push({ upTo: null, rate: normalizedRate });
    } else {
      if (rawUpTo === null || rawUpTo === undefined || rawUpTo === '' || rawUpTo === 'null') {
        const err = new Error(`INVALID_TIER_CONFIGURATION: Non-final tier at index ${i} cannot be unlimited (upTo cannot be null)`);
        (err as any).statusCode = 400;
        (err as any).code = 'INVALID_TIER_CONFIGURATION';
        throw err;
      }

      const normalizedUpTo = parseAndValidateStrictDecimal(rawUpTo, `Tier at index ${i} upTo boundary`);
      const upToDec = toDecimal(normalizedUpTo);

      if (!upToDec.isInteger()) {
        const err = new Error(`INVALID_TIER_CONFIGURATION: Tier at index ${i} upTo boundary '${rawUpTo}' must represent a whole positive integer unit threshold (fractional boundaries are not permitted)`);
        (err as any).statusCode = 400;
        (err as any).code = 'INVALID_TIER_CONFIGURATION';
        throw err;
      }

      if (compareDecimals(upToDec, toDecimal('0.00')) <= 0) {
        const err = new Error(`INVALID_TIER_CONFIGURATION: Tier at index ${i} upTo boundary must be strictly greater than 0`);
        (err as any).statusCode = 400;
        (err as any).code = 'INVALID_TIER_CONFIGURATION';
        throw err;
      }

      if (prevUpToDec && compareDecimals(upToDec, prevUpToDec) <= 0) {
        const err = new Error(`INVALID_TIER_CONFIGURATION: Tier boundaries must be strictly ascending (index ${i}: ${formatDecimal(upToDec)} <= previous: ${formatDecimal(prevUpToDec)})`);
        (err as any).statusCode = 400;
        (err as any).code = 'INVALID_TIER_CONFIGURATION';
        throw err;
      }

      prevUpToDec = upToDec;
      normalizedTiers.push({ upTo: normalizedUpTo, rate: normalizedRate });
    }
  }

  return normalizedTiers;
}

/**
 * Shared authority for validating utility tier configurations in context of a billing mode.
 * - When mode === 'tiered': tiers MUST be present and valid. Returns CanonicalTierRecord[].
 * - When mode !== 'tiered': returns null (active calculation does not use tiers).
 */
export function validateUtilityTierModeConfiguration(options: ValidateTierModeOptions): CanonicalTierRecord[] | null {
  const { mode, tiers, utilityName = 'Utility' } = options;
  if (mode === 'tiered') {
    if (tiers === null || tiers === undefined || (Array.isArray(tiers) && tiers.length === 0)) {
      const err = new Error(`INVALID_TIER_CONFIGURATION: ${utilityName} billing mode is 'tiered' but no tier configuration was provided`);
      (err as any).statusCode = 400;
      (err as any).code = 'INVALID_TIER_CONFIGURATION';
      throw err;
    }
    return validateCanonicalUtilityTiers(tiers);
  }
  return null;
}
