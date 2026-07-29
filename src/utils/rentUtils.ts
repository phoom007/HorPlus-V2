/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Room, Contract } from '../types';

/**
 * Calculates room rent amount and description for a given billing cycle.
 * Handles 'monthly' vs 'term' (รายเทอม) accurately:
 * - Monthly: Returns monthlyRent and "ค่าเช่ารายเดือน"
 * - Term (รายเทอม):
 *   Determines if cycle is the start month of a term period (e.g. every 4 months from contract startDate).
 *   - Term Start Cycle: Returns termRent and "ค่าเช่ารายเทอม (4 เดือน)"
 *   - Subsequent Cycle within Term: Returns 0 and "ค่าเช่ารายเทอม (ชำระแล้วงวดต้นเทอม)"
 */
export function calculateRoomRentForCycle(
  room: Partial<Room> | undefined | null,
  cycleId: string, // "YYYY-MM" e.g., "2026-07"
  contract?: Partial<Contract> | null
): { amount: number; description: string; isTermStart: boolean } {
  if (!room) {
    return { amount: 0, description: 'ค่าเช่ารายเดือน', isTermStart: false };
  }

  if (room.rentCycle !== 'term') {
    return {
      amount: room.monthlyRent || 0,
      description: 'ค่าเช่ารายเดือน',
      isTermStart: false,
    };
  }

  const termRent = room.termRent || (room.monthlyRent ? room.monthlyRent * 4 : 18000);
  const termLengthMonths = 4; // Standard term length

  // Determine reference start date (from contract or default to 2026-03)
  let startYear = 2026;
  let startMonth = 3;

  if (contract?.startDate) {
    const parts = contract.startDate.split('-');
    if (parts.length >= 2) {
      const y = parseInt(parts[0]);
      const m = parseInt(parts[1]);
      if (!isNaN(y) && !isNaN(m)) {
        startYear = y;
        startMonth = m;
      }
    }
  }

  const [cycleYearStr, cycleMonthStr] = (cycleId || '2026-07').split('-');
  const cycleYear = parseInt(cycleYearStr) || 2026;
  const cycleMonth = parseInt(cycleMonthStr) || 7;

  // Month difference relative to contract start
  const monthDiff = (cycleYear - startYear) * 12 + (cycleMonth - startMonth);

  // Modulo 4 to check if this cycle is term renewal/start month
  const modulo = ((monthDiff % termLengthMonths) + termLengthMonths) % termLengthMonths;
  const isTermStart = modulo === 0;

  if (isTermStart) {
    return {
      amount: termRent,
      description: `ค่าเช่ารายเทอม (${termLengthMonths} เดือน)`,
      isTermStart: true,
    };
  } else {
    return {
      amount: 0,
      description: 'ค่าเช่ารายเทอม (ชำระแล้วงวดต้นเทอม)',
      isTermStart: false,
    };
  }
}
