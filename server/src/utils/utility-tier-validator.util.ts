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
 * 5. Rejects NaN, Infinity, negative values, malformed structures, gaps, and duplicates.
 */

import { toDecimal, formatDecimal, compareDecimals, isZeroDecimal } from './decimal-math.util.js';

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

    // Validate rate
    const rawRate = rawTier.rate;
    if (
      rawRate === undefined ||
      rawRate === null ||
      rawRate === '' ||
      (typeof rawRate === 'string' && (rawRate.trim() === '' || isNaN(Number(rawRate)))) ||
      (typeof rawRate === 'number' && (!isFinite(rawRate) || isNaN(rawRate)))
    ) {
      const err = new Error(`INVALID_TIER_CONFIGURATION: Tier at index ${i} has invalid rate '${rawRate}'`);
      (err as any).statusCode = 400;
      (err as any).code = 'INVALID_TIER_CONFIGURATION';
      throw err;
    }

    let rateDec;
    try {
      rateDec = toDecimal(rawRate.toString().trim());
    } catch {
      const err = new Error(`INVALID_TIER_CONFIGURATION: Tier at index ${i} has unparseable rate '${rawRate}'`);
      (err as any).statusCode = 400;
      (err as any).code = 'INVALID_TIER_CONFIGURATION';
      throw err;
    }

    if (compareDecimals(rateDec, toDecimal('0.00')) < 0) {
      const err = new Error(`INVALID_TIER_CONFIGURATION: Tier at index ${i} rate cannot be negative`);
      (err as any).statusCode = 400;
      (err as any).code = 'INVALID_TIER_CONFIGURATION';
      throw err;
    }

    const normalizedRate = formatDecimal(rateDec);

    // Validate upTo boundary
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

      if (
        (typeof rawUpTo === 'string' && isNaN(Number(rawUpTo))) ||
        (typeof rawUpTo === 'number' && (!isFinite(rawUpTo) || isNaN(rawUpTo)))
      ) {
        const err = new Error(`INVALID_TIER_CONFIGURATION: Tier at index ${i} has invalid upTo boundary '${rawUpTo}'`);
        (err as any).statusCode = 400;
        (err as any).code = 'INVALID_TIER_CONFIGURATION';
        throw err;
      }

      let upToDec;
      try {
        upToDec = toDecimal(rawUpTo.toString().trim());
      } catch {
        const err = new Error(`INVALID_TIER_CONFIGURATION: Tier at index ${i} has unparseable upTo boundary '${rawUpTo}'`);
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
      normalizedTiers.push({ upTo: formatDecimal(upToDec), rate: normalizedRate });
    }
  }

  return normalizedTiers;
}
