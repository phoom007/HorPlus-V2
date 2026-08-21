/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Exact satang integer arithmetic for dividing term rent into installments.
 * The remainder satangs are absorbed by the final installment to ensure:
 * sum(installments) === exact term rent.
 */

export interface InstallmentScheduleItem {
  installmentNo: number;
  amount: number;
  amountSatang: number;
  formattedAmount: string;
}

export function calculateInstallmentSchedule(
  totalRent: number | string | null | undefined,
  installmentCount: number | string | null | undefined
): InstallmentScheduleItem[] {
  const count = Math.max(1, Math.floor(Number(installmentCount) || 1));
  const numRent = Number(totalRent) || 0;
  const totalSatang = Math.round(numRent * 100);

  if (totalSatang <= 0 || count <= 1) {
    const val = totalSatang / 100;
    return [
      {
        installmentNo: 1,
        amount: val,
        amountSatang: totalSatang,
        formattedAmount: val.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      },
    ];
  }

  const baseSatang = Math.floor(totalSatang / count);
  const remainderSatang = totalSatang - (baseSatang * count);

  const schedule: InstallmentScheduleItem[] = [];
  for (let i = 1; i <= count; i++) {
    const isLast = i === count;
    const satang = isLast ? baseSatang + remainderSatang : baseSatang;
    const amount = satang / 100;
    schedule.push({
      installmentNo: i,
      amount,
      amountSatang: satang,
      formattedAmount: amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    });
  }

  return schedule;
}
