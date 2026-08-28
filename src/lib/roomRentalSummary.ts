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

export interface AgreementDepositDisplay {
  isOccupied: boolean;
  amount?: number;
  unavailableText?: string;
}

/**
 * Resolves current tenant agreement deposit display for Grid and List modes:
 * - Vacant: isOccupied: false, no current agreement amount.
 * - Occupied + valid summary deposit: amount = activeRentalSummary.depositAmount (including 0).
 * - Occupied + missing summary/deposit: unavailableText = 'ไม่พบข้อมูลค่าประกันปัจจุบัน' (no guessed deposit).
 */
export function getCurrentAgreementDepositDisplay(room: Room): AgreementDepositDisplay {
  const isOccupied = room.status === 'occupied' || !!room.currentTenantId;
  if (!isOccupied) {
    return {
      isOccupied: false,
    };
  }

  const deposit = room.activeRentalSummary?.depositAmount;
  if (deposit !== null && deposit !== undefined && Number.isFinite(Number(deposit))) {
    return {
      isOccupied: true,
      amount: Number(deposit),
    };
  }

  return {
    isOccupied: true,
    unavailableText: 'ไม่พบข้อมูลค่าประกันปัจจุบัน',
  };
}

/**
 * Formats room location using registered building name and room floor.
 * E.g., "อาคาร B • ชั้น 1" or "อาคารชาญวิทย์ (A) • ชั้น 2".
 */
export function formatRoomLocation(buildingName?: string | null, floor?: number | string | null): string {
  const bld = buildingName?.trim() || 'ไม่ระบุอาคาร';
  const fl = floor !== undefined && floor !== null ? `ชั้น ${floor}` : 'ไม่ระบุชั้น';
  return `${bld} • ${fl}`;
}

export interface RoomCycleOccupancy {
  tenantId: string | null;
  tenantName?: string | null;
  agreementType: 'MONTHLY' | 'TERM' | 'DAILY' | null;
  rentAmount: number;
  depositAmount?: number | null;
  source: 'CONTRACT' | 'PROVISIONAL_TERM' | 'PROVISIONAL_MONTHLY' | 'DAILY_STAY' | 'NONE';
}

export interface RoomCyclePresentation {
  roomId: string;
  billingCycleId?: string;
  state: 'ACTIVE_AGREEMENT' | 'RESERVED_IN_CYCLE' | 'DAILY_FINANCIAL_TAIL' | 'NO_AGREEMENT_IN_CYCLE' | 'MAINTENANCE_IN_CYCLE' | 'UNAVAILABLE';
  effectiveOperationalStatus: 'vacant' | 'occupied' | 'maintenance' | 'UNKNOWN' | null;
  isCurrentMaintenance: boolean;
  occupancy: RoomCycleOccupancy | null;
  currentCatalogRates: RateItem[];
}

/**
 * Single presentation authority for Cycle-Scoped Room Presentation (Grid, List, Floor):
 * Strictly projects backend Meter preview room context without re-evaluating or guessing date/pricing logic on frontend.
 */
export function resolveRoomCyclePresentation(
  room: Room,
  meterPreviewRoom?: any,
  billingCycleId?: string
): RoomCyclePresentation {
  const currentCatalogRates = getCatalogRates(room);
  const isCurrentMaintenance = room.status === 'maintenance';

  // If no preview room context available:
  // If a billingCycleId was explicitly requested, this is an incomplete/failed response -> UNAVAILABLE.
  // If no billingCycleId was provided (unselected), default cleanly to NO_AGREEMENT_IN_CYCLE (or MAINTENANCE_IN_CYCLE if current is maintenance).
  if (!meterPreviewRoom) {
    return {
      roomId: room.id,
      billingCycleId,
      state: billingCycleId ? 'UNAVAILABLE' : (isCurrentMaintenance ? 'MAINTENANCE_IN_CYCLE' : 'NO_AGREEMENT_IN_CYCLE'),
      effectiveOperationalStatus: isCurrentMaintenance ? 'maintenance' : 'vacant',
      isCurrentMaintenance,
      occupancy: null,
      currentCatalogRates,
    };
  }

  const rawState = meterPreviewRoom.cyclePresentationState;
  const validStates = ['ACTIVE_AGREEMENT', 'RESERVED_IN_CYCLE', 'DAILY_FINANCIAL_TAIL', 'NO_AGREEMENT_IN_CYCLE'];
  const effectiveOperationalStatus = meterPreviewRoom.effectiveRoomOperationalStatus ?? (isCurrentMaintenance ? 'maintenance' : 'UNKNOWN');

  // Strict Fail-Closed: If cyclePresentationState is missing or not a canonical state, FAIL CLOSED
  if (!rawState || !validStates.includes(rawState)) {
    return {
      roomId: room.id,
      billingCycleId,
      state: 'UNAVAILABLE',
      effectiveOperationalStatus,
      isCurrentMaintenance,
      occupancy: null,
      currentCatalogRates,
    };
  }

  if (rawState === 'ACTIVE_AGREEMENT') {
    const agreementType: 'MONTHLY' | 'TERM' | 'DAILY' | undefined = meterPreviewRoom.agreementType;
    // Strict requirement: agreementType must be explicitly supplied by backend
    if (!agreementType || !['MONTHLY', 'TERM', 'DAILY'].includes(agreementType)) {
      return {
        roomId: room.id,
        billingCycleId,
        state: 'UNAVAILABLE',
        effectiveOperationalStatus,
        isCurrentMaintenance,
        occupancy: null,
        currentCatalogRates,
      };
    }

    const rentAmount = Number(meterPreviewRoom.rentAmount);
    if (!Number.isFinite(rentAmount)) {
      return {
        roomId: room.id,
        billingCycleId,
        state: 'UNAVAILABLE',
        effectiveOperationalStatus,
        isCurrentMaintenance,
        occupancy: null,
        currentCatalogRates,
      };
    }

    const rawDep = meterPreviewRoom.agreementDepositAmount;
    const depositAmount = rawDep !== null && rawDep !== undefined && rawDep !== '' && Number.isFinite(Number(rawDep))
      ? Number(rawDep)
      : null;

    const source = (meterPreviewRoom.billingSource as any) || 'CONTRACT';

    return {
      roomId: room.id,
      billingCycleId,
      state: 'ACTIVE_AGREEMENT',
      effectiveOperationalStatus,
      isCurrentMaintenance,
      occupancy: {
        tenantId: meterPreviewRoom.tenantId ?? null,
        tenantName: meterPreviewRoom.tenantName ?? null,
        agreementType,
        rentAmount,
        depositAmount,
        source,
      },
      currentCatalogRates,
    };
  }

  if (rawState === 'RESERVED_IN_CYCLE') {
    return {
      roomId: room.id,
      billingCycleId,
      state: 'RESERVED_IN_CYCLE',
      effectiveOperationalStatus,
      isCurrentMaintenance,
      occupancy: {
        tenantId: meterPreviewRoom.tenantId ?? null,
        tenantName: meterPreviewRoom.tenantName ?? null,
        agreementType: meterPreviewRoom.agreementType || null,
        rentAmount: Number(meterPreviewRoom.rentAmount) || 0,
        depositAmount: null,
        source: 'NONE',
      },
      currentCatalogRates,
    };
  }

  if (rawState === 'DAILY_FINANCIAL_TAIL') {
    const agreementType = meterPreviewRoom.agreementType;
    if (agreementType !== 'DAILY') {
      return {
        roomId: room.id,
        billingCycleId,
        state: 'UNAVAILABLE',
        effectiveOperationalStatus,
        isCurrentMaintenance,
        occupancy: null,
        currentCatalogRates,
      };
    }

    const rentAmount = Number(meterPreviewRoom.rentAmount);
    if (!Number.isFinite(rentAmount)) {
      return {
        roomId: room.id,
        billingCycleId,
        state: 'UNAVAILABLE',
        effectiveOperationalStatus,
        isCurrentMaintenance,
        occupancy: null,
        currentCatalogRates,
      };
    }

    const rawDep = meterPreviewRoom.agreementDepositAmount;
    const depositAmount = rawDep !== null && rawDep !== undefined && rawDep !== '' && Number.isFinite(Number(rawDep))
      ? Number(rawDep)
      : null;

    return {
      roomId: room.id,
      billingCycleId,
      state: 'DAILY_FINANCIAL_TAIL',
      effectiveOperationalStatus,
      isCurrentMaintenance,
      occupancy: {
        tenantId: meterPreviewRoom.tenantId ?? null,
        tenantName: meterPreviewRoom.tenantName ?? null,
        agreementType: 'DAILY',
        rentAmount,
        depositAmount,
        source: 'DAILY_STAY',
      },
      currentCatalogRates,
    };
  }

  // NO_AGREEMENT_IN_CYCLE: Consult effective operational status
  if (meterPreviewRoom.effectiveRoomOperationalStatus === 'maintenance') {
    return {
      roomId: room.id,
      billingCycleId,
      state: 'MAINTENANCE_IN_CYCLE',
      effectiveOperationalStatus: 'maintenance',
      isCurrentMaintenance,
      occupancy: null,
      currentCatalogRates,
    };
  }

  return {
    roomId: room.id,
    billingCycleId,
    state: 'NO_AGREEMENT_IN_CYCLE',
    effectiveOperationalStatus,
    isCurrentMaintenance,
    occupancy: null,
    currentCatalogRates,
  };
}
