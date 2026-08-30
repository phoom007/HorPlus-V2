/**
 * @license Apache-2.0
 * Canonical Progressive Tiered Utility Calculator Authority
 *
 * Exact Decimal / Satang Monetary Authority:
 * 1. ZERO JavaScript floating-point arithmetic. All financial products and totals calculated using exact Prisma.Decimal.
 * 2. Progressive / Marginal Tiered Accumulation: each tier only charges usage within its (lowerExclusive, upperInclusive] interval.
 * 3. Fractional Units Supported: meter usage preserves exact fractional decimals without integer rounding.
 * 4. Product Owner Rounding Policy 1A: Each tier product (billedUnits × rate) is rounded to 2 decimal places FIRST (ROUND_HALF_UP, e.g. 0.005 -> 0.01), then sum already-rounded tier amounts.
 * 5. Fail-Closed Validation: Invalid tiers, negative usage, or malformed inputs throw structured errors.
 */

import { Prisma } from '@prisma/client';
import {
  validateCanonicalUtilityTiers,
  CanonicalTierRecord,
} from './utility-tier-validator.util.js';
import {
  toDecimal,
  formatDecimal,
} from './decimal-math.util.js';

export interface CanonicalTierBreakdown {
  lowerExclusive: string;
  upperInclusive: string | null;
  billedUnits: string;
  rate: string;
  amount: string;
}

export interface ProgressiveTierCalculationInput {
  usageUnits: string | number | Prisma.Decimal;
  tiers: CanonicalTierRecord[];
}

export interface ProgressiveTierCalculationResult {
  usageUnits: string;
  totalAmount: string;
  tierBreakdown: CanonicalTierBreakdown[];
}

/**
 * Validates and sanitizes a raw usage input to an exact non-negative Prisma.Decimal.
 * Throws structured errors for negative usage, NaN, Infinity, scientific notation, or non-numeric values.
 */
export function validateCanonicalUsageUnits(rawUsage: unknown): Prisma.Decimal {
  if (rawUsage === null || rawUsage === undefined || rawUsage === '') {
    const err = new Error('INVALID_USAGE: Usage units must not be empty');
    (err as any).statusCode = 400;
    (err as any).code = 'INVALID_USAGE';
    throw err;
  }

  let str: string;
  if (typeof rawUsage === 'number') {
    if (isNaN(rawUsage) || !isFinite(rawUsage)) {
      const err = new Error('INVALID_USAGE: Usage units must be a finite number');
      (err as any).statusCode = 400;
      (err as any).code = 'INVALID_USAGE';
      throw err;
    }
    str = rawUsage.toString();
  } else if (rawUsage instanceof Prisma.Decimal) {
    if (rawUsage.isNaN() || !rawUsage.isFinite()) {
      const err = new Error('INVALID_USAGE: Usage units must be a finite decimal');
      (err as any).statusCode = 400;
      (err as any).code = 'INVALID_USAGE';
      throw err;
    }
    str = rawUsage.toString();
  } else if (typeof rawUsage === 'string') {
    str = rawUsage.trim();
  } else {
    const err = new Error('INVALID_USAGE: Usage units must be a string, number, or Decimal');
    (err as any).statusCode = 400;
    (err as any).code = 'INVALID_USAGE';
    throw err;
  }

  // Strict regex: non-negative integer or decimal with up to 2 decimal places.
  // Rejects scientific notation ("1e2", "1E-1"), negative values ("-5"), NaN, etc.
  if (!/^\d+(\.\d{1,2})?$/.test(str)) {
    const err = new Error(`INVALID_USAGE: '${str}' is not a valid non-negative decimal with up to 2 decimal places`);
    (err as any).statusCode = 400;
    (err as any).code = 'INVALID_USAGE';
    throw err;
  }

  const dec = new Prisma.Decimal(str);
  if (dec.isNegative()) {
    const err = new Error('INVALID_USAGE: Usage units cannot be negative');
    (err as any).statusCode = 400;
    (err as any).code = 'INVALID_USAGE';
    throw err;
  }
  if (!dec.isInteger()) {
    const err = new Error(`INVALID_USAGE: Usage units '${str}' must be a whole integer unit`);
    (err as any).statusCode = 400;
    (err as any).code = 'INVALID_USAGE';
    throw err;
  }

  return dec;
}

/**
 * Calculates progressive tiered utility charges across canonical tier brackets.
 *
 * Locked Invariants:
 * 1. Marginal accumulation: (0, T1] @ R1, (T1, T2] @ R2, ..., (Tn, ∞) @ Rn
 * 2. Per-tier 2DP rounding (Policy 1A): tierAmount = ROUND_2DP(billedUnits × rate)
 * 3. Total amount = sum(tierAmount_i)
 * 4. Breakdown contains only active tiers where billedUnits > 0
 */
export function calculateProgressiveTieredCharge(
  input: ProgressiveTierCalculationInput
): ProgressiveTierCalculationResult {
  const usageDec = validateCanonicalUsageUnits(input.usageUnits);
  const validatedTiers = validateCanonicalUtilityTiers(input.tiers);

  let remainingUsage = usageDec;
  let lowerBoundDec = new Prisma.Decimal('0.00');
  let totalAmountDec = new Prisma.Decimal('0.00');
  const tierBreakdown: CanonicalTierBreakdown[] = [];

  for (let i = 0; i < validatedTiers.length; i++) {
    if (remainingUsage.isZero()) {
      break;
    }

    const tier = validatedTiers[i];
    let billedUnitsDec: Prisma.Decimal;
    let upperInclusiveStr: string | null = null;

    if (tier.upTo !== null) {
      const upperBoundDec = new Prisma.Decimal(tier.upTo);
      upperInclusiveStr = formatDecimal(upperBoundDec);
      const tierCapacity = upperBoundDec.sub(lowerBoundDec);

      if (remainingUsage.lessThan(tierCapacity)) {
        billedUnitsDec = remainingUsage;
      } else {
        billedUnitsDec = tierCapacity;
      }
    } else {
      // Final unlimited tier
      upperInclusiveStr = null;
      billedUnitsDec = remainingUsage;
    }

    if (billedUnitsDec.isPositive()) {
      const rateDec = new Prisma.Decimal(tier.rate);
      const rawProduct = billedUnitsDec.mul(rateDec);
      // Product Owner 1A: round each tier product to 2 DP first (ROUND_HALF_UP: 0.005 -> 0.01)
      const tierAmountStr = rawProduct.toFixed(2, Prisma.Decimal.ROUND_HALF_UP);
      const tierAmountDec = new Prisma.Decimal(tierAmountStr);

      totalAmountDec = totalAmountDec.add(tierAmountDec);

      tierBreakdown.push({
        lowerExclusive: formatDecimal(lowerBoundDec),
        upperInclusive: upperInclusiveStr,
        billedUnits: formatDecimal(billedUnitsDec),
        rate: formatDecimal(rateDec),
        amount: tierAmountStr,
      });

      remainingUsage = remainingUsage.sub(billedUnitsDec);
    }

    if (tier.upTo !== null) {
      lowerBoundDec = new Prisma.Decimal(tier.upTo);
    }
  }

  return {
    usageUnits: formatDecimal(usageDec),
    totalAmount: formatDecimal(totalAmountDec),
    tierBreakdown,
  };
}
