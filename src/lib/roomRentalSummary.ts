/**
 * @license Apache-2.0
 * Room Rental Summary Presentation Helper
 *
 * Central presentation logic for Rent & Deposit presentation in Grid and List modes.
 * Cycles:
 * - MONTHLY: รายเดือน
 * - TERM: รายเทอม
 * - DAILY: รายวัน
 */

import { Room } from '../types';

export interface RateItem {
  cycle: 'monthly' | 'term' | 'daily';
  label: string;
  amount: number;
  isPrimary: boolean;
  isAgreementRate: boolean;
}

export function getDepositForCycle(room: Room, cycle: 'monthly' | 'term' | 'daily'): number {
  if (cycle === 'term') {
    return room.termDeposit ?? room.depositAmount ?? 0;
  }
  if (cycle === 'daily') {
    return room.dailyDeposit ?? room.depositAmount ?? 0;
  }
  return room.monthlyDeposit ?? room.depositAmount ?? 0;
}

/**
 * Returns rent rates configured for the room catalog.
 */
export function getCatalogRates(room: Room): RateItem[] {
  const primaryCycle = (room.rentCycle || 'monthly') as 'monthly' | 'term' | 'daily';
  const items: RateItem[] = [];

  // Monthly
  if (room.monthlyRent !== undefined && room.monthlyRent !== null) {
    items.push({
      cycle: 'monthly',
      label: 'รายเดือน',
      amount: Number(room.monthlyRent),
      isPrimary: primaryCycle === 'monthly',
      isAgreementRate: false,
    });
  }

  // Term
  if (room.termRent !== undefined && room.termRent !== null && Number(room.termRent) > 0) {
    items.push({
      cycle: 'term',
      label: 'รายเทอม',
      amount: Number(room.termRent),
      isPrimary: primaryCycle === 'term',
      isAgreementRate: false,
    });
  }

  // Daily
  if (room.dailyRent !== undefined && room.dailyRent !== null && Number(room.dailyRent) > 0) {
    items.push({
      cycle: 'daily',
      label: 'รายวัน',
      amount: Number(room.dailyRent),
      isPrimary: primaryCycle === 'daily',
      isAgreementRate: false,
    });
  }

  // Sort so primary cycle is first
  items.sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0));
  return items;
}

/**
 * Resolves rent rates for Grid Mode:
 * - Occupied + active agreement: Show ONLY the active agreement rate.
 * - Occupied + missing agreement: FAIL CLOSED (no guessed catalog price).
 * - Vacant: Show all configured catalog rates.
 */
export function getGridRentRates(room: Room): { isOccupied: boolean; rates: RateItem[]; unavailableText?: string } {
  const isOccupied = room.status === 'occupied' || !!room.currentTenantId;

  if (isOccupied && room.activeRentalSummary) {
    const summary = room.activeRentalSummary;
    const cycle = summary.type === 'TERM' ? 'term' : (summary.type === 'DAILY' ? 'daily' : 'monthly');
    const label = cycle === 'term' ? 'รายเทอม' : (cycle === 'daily' ? 'รายวัน' : 'รายเดือน');
    return {
      isOccupied: true,
      rates: [
        {
          cycle,
          label,
          amount: summary.rentAmount,
          isPrimary: true,
          isAgreementRate: true,
        },
      ],
    };
  }

  if (isOccupied) {
    return {
      isOccupied: true,
      rates: [],
      unavailableText: 'ไม่พบข้อมูลอัตราค่าเช่าปัจจุบัน',
    };
  }

  // Vacant / Maintenance / Reserved: show all catalog rates
  return {
    isOccupied: false,
    rates: getCatalogRates(room),
  };
}

/**
 * Resolves rent rates for List Mode:
 * - Occupied + active agreement: Active agreement rate is rendered first + bold.
 * - Occupied + missing agreement: Neutral unavailable state + secondary catalog rates.
 * - Vacant: Primary catalog rate first + bold.
 */
export function getListRentRates(room: Room): { primaryRate?: RateItem; secondaryRates: RateItem[]; unavailableText?: string } {
  const catalog = getCatalogRates(room);
  const isOccupied = room.status === 'occupied' || !!room.currentTenantId;

  if (isOccupied && room.activeRentalSummary) {
    const summary = room.activeRentalSummary;
    const cycle = summary.type === 'TERM' ? 'term' : (summary.type === 'DAILY' ? 'daily' : 'monthly');
    const label = cycle === 'term' ? 'รายเทอม' : (cycle === 'daily' ? 'รายวัน' : 'รายเดือน');
    const activeRate: RateItem = {
      cycle,
      label,
      amount: summary.rentAmount,
      isPrimary: true,
      isAgreementRate: true,
    };

    const secondary = catalog.filter((r) => r.cycle !== cycle);
    return {
      primaryRate: activeRate,
      secondaryRates: secondary,
    };
  }

  if (isOccupied) {
    return {
      secondaryRates: catalog,
      unavailableText: 'ไม่พบข้อมูลอัตราค่าเช่าปัจจุบัน',
    };
  }

  if (catalog.length === 0) {
    const defaultPrimary: RateItem = {
      cycle: 'monthly',
      label: 'รายเดือน',
      amount: 0,
      isPrimary: true,
      isAgreementRate: false,
    };
    return { primaryRate: defaultPrimary, secondaryRates: [] };
  }

  const [primaryRate, ...secondaryRates] = catalog;
  return { primaryRate, secondaryRates };
}
