/**
 * Exact Decimal-String Satang Integer Calculation for Term-Rent Installments
 * Strictly eliminates Number(...), floating-point math, and .toFixed()
 * @license Apache-2.0
 */

export interface InstallmentScheduleItem {
  installmentNo: number;
  cycleOffset: number;
  amount: string;
  description: string;
}

export interface InstallmentConfig {
  maxInstallments: number;
  selectedInstallments: number;
  termRentTotal: string;
  installmentSchedule: InstallmentScheduleItem[];
}

/**
 * Parses a decimal string (e.g. "18000.00" or "18001.01") into BigInt satangs (minor units)
 */
export function decimalStringToSatangs(decimalStr: string): bigint {
  const clean = decimalStr.trim();
  const parts = clean.split('.');
  const bahtStr = parts[0] || '0';
  const satangStr = (parts[1] || '00').padEnd(2, '0').slice(0, 2);
  const isNegative = bahtStr.startsWith('-');
  const absBahtStr = isNegative ? bahtStr.slice(1) : bahtStr;
  const absSatangs = BigInt(absBahtStr) * 100n + BigInt(satangStr);
  return isNegative ? -absSatangs : absSatangs;
}

/**
 * Formats BigInt satangs (minor units) back into a canonical 2-decimal string (e.g. 900000n -> "9000.00")
 */
export function satangsToDecimalString(satangs: bigint): string {
  const isNegative = satangs < 0n;
  const abs = isNegative ? -satangs : satangs;
  const baht = abs / 100n;
  const sat = abs % 100n;
  const prefix = isNegative ? '-' : '';
  return `${prefix}${baht.toString()}.${sat.toString().padStart(2, '0')}`;
}

/**
 * Calculates exact satang integer installment schedule with deterministic remainder on final installment
 */
export function generateExactInstallmentSchedule(
  termRentStr: string,
  selectedInstallments: number
): InstallmentScheduleItem[] {
  if (selectedInstallments <= 0) {
    throw new Error('selectedInstallments must be at least 1');
  }

  const totalSatangs = decimalStringToSatangs(termRentStr);
  if (totalSatangs <= 0n) {
    throw new Error('termRent must be greater than zero');
  }

  const nBig = BigInt(selectedInstallments);
  const baseSatangs = totalSatangs / nBig;
  const remainderSatangs = totalSatangs % nBig;

  const schedule: InstallmentScheduleItem[] = [];
  let sumCheck = 0n;

  for (let i = 1; i <= selectedInstallments; i++) {
    const itemSatangs = i === selectedInstallments ? baseSatangs + remainderSatangs : baseSatangs;
    sumCheck += itemSatangs;
    const amount = satangsToDecimalString(itemSatangs);
    schedule.push({
      installmentNo: i,
      cycleOffset: i - 1,
      amount,
      description: `ค่าเช่าห้องพัก (งวดที่ ${i}/${selectedInstallments})`,
    });
  }

  // Exact Sum Invariant check
  if (sumCheck !== totalSatangs) {
    throw new Error(`INTERNAL_ERROR: Installment sum ${sumCheck} does not match total ${totalSatangs}`);
  }

  return schedule;
}
