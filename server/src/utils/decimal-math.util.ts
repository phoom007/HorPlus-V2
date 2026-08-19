import { Prisma } from '@prisma/client';

/**
 * Exact Decimal financial math utilities using Prisma.Decimal to eliminate floating point rounding errors.
 */

export function toDecimal(val: string | number | Prisma.Decimal | null | undefined): Prisma.Decimal {
  if (val === null || val === undefined || val === '') return new Prisma.Decimal('0.00');
  if (val instanceof Prisma.Decimal) return val;
  return new Prisma.Decimal(String(val));
}

export function addDecimals(...vals: Array<string | number | Prisma.Decimal | null | undefined>): Prisma.Decimal {
  return vals.reduce<Prisma.Decimal>((acc, cur) => acc.add(toDecimal(cur)), new Prisma.Decimal('0.00'));
}

export function subDecimals(a: string | number | Prisma.Decimal, b: string | number | Prisma.Decimal): Prisma.Decimal {
  return toDecimal(a).sub(toDecimal(b));
}

export function mulDecimals(a: string | number | Prisma.Decimal, b: string | number | Prisma.Decimal): Prisma.Decimal {
  return toDecimal(a).mul(toDecimal(b));
}

export function divDecimals(a: string | number | Prisma.Decimal, b: string | number | Prisma.Decimal): Prisma.Decimal {
  return toDecimal(a).div(toDecimal(b));
}

export function formatDecimal(val: string | number | Prisma.Decimal | null | undefined): string {
  return toDecimal(val).toFixed(2);
}

export function compareDecimals(a: string | number | Prisma.Decimal, b: string | number | Prisma.Decimal): number {
  return toDecimal(a).comparedTo(toDecimal(b));
}

export function isZeroDecimal(val: string | number | Prisma.Decimal | null | undefined): boolean {
  return toDecimal(val).isZero();
}
