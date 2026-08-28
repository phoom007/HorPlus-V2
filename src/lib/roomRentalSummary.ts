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
 * Normalizes and formats building display name according to Product Owner display authority:
 * 1. Explicit non-empty Building.name (normalized to prevent duplicate "อาคาร" prefix)
 * 2. Otherwise Building.code / roomPrefix ("อาคาร {code}")
 * 3. Otherwise safe generic fallback ("ไม่ระบุอาคาร")
 */
export function formatBuildingDisplayName(
  building?: { name?: string | null; code?: string | null; roomPrefix?: string | null } | string | null
): string {
  if (!building) return 'ไม่ระบุอาคาร';
  const name = (typeof building === 'string' ? building : building.name)?.trim();
  const code = (typeof building === 'object' ? (building.code || building.roomPrefix) : undefined)?.trim();

  if (name) {
    if (/^(อาคาร|ตึก|building)\s*/i.test(name)) {
      return name;
    }
    return `อาคาร${name}`;
  }

  if (code) {
    if (/^(อาคาร|ตึก|building)\s*/i.test(code)) {
      return code;
    }
    return `อาคาร ${code}`;
  }

  return 'ไม่ระบุอาคาร';
}

/**
 * Formats room location using registered building name/code and room floor.
 * E.g., "อาคารสมบูรณ์ • ชั้น 1" or "อาคาร B • ชั้น 2".
 */
export function formatRoomLocation(
  building?: { name?: string | null; code?: string | null; roomPrefix?: string | null } | string | null,
  floor?: number | string | null
): string {
  const bld = formatBuildingDisplayName(building);
  const fl = floor !== undefined && floor !== null ? `ชั้น ${floor}` : 'ไม่ระบุชั้น';
  return `${bld} • ${fl}`;
}

export interface PaymentStatusBadgeConfig {
  text: string;
  className: string;
  dotColor: string;
}

export function getPaymentStatusBadge(
  status?: 'PAID' | 'UNPAID' | 'PARTIAL' | 'NOT_ISSUED' | 'UNKNOWN' | null
): PaymentStatusBadgeConfig {
  switch (status) {
    case 'PAID':
      return {
        text: 'จ่ายแล้ว',
        className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        dotColor: 'bg-emerald-500',
      };
    case 'UNPAID':
      return {
        text: 'รอชำระ',
        className: 'bg-amber-50 text-amber-700 border-amber-200',
        dotColor: 'bg-amber-500',
      };
    case 'PARTIAL':
      return {
        text: 'ชำระบางส่วน',
        className: 'bg-amber-50 text-amber-700 border-amber-200',
        dotColor: 'bg-amber-500',
      };
    case 'NOT_ISSUED':
      return {
        text: 'ยังไม่ออกบิล',
        className: 'bg-sky-50 text-sky-700 border-sky-200',
        dotColor: 'bg-sky-500',
      };
    case 'UNKNOWN':
    default:
      return {
        text: 'ไม่พบข้อมูลการชำระ',
        className: 'bg-slate-50 text-slate-600 border-slate-200',
        dotColor: 'bg-slate-400',
      };
  }
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
  reservationCheckInDate?: string | null;
  agreementRentPaymentStatus?: 'PAID' | 'UNPAID' | 'PARTIAL' | 'NOT_ISSUED' | 'UNKNOWN';
  agreementDepositPaymentStatus?: 'PAID' | 'UNPAID' | 'PARTIAL' | 'NOT_ISSUED' | 'UNKNOWN';
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
      reservationCheckInDate: null,
      agreementRentPaymentStatus: 'UNKNOWN',
      agreementDepositPaymentStatus: 'UNKNOWN',
    };
  }

  const reservationCheckInDate = meterPreviewRoom.checkInDate ?? null;
  const agreementRentPaymentStatus = meterPreviewRoom.agreementRentPaymentStatus ?? 'UNKNOWN';
  const agreementDepositPaymentStatus = meterPreviewRoom.agreementDepositPaymentStatus ?? 'UNKNOWN';
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
      reservationCheckInDate,
      agreementRentPaymentStatus,
      agreementDepositPaymentStatus,
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

    const validBillingSources = ['CONTRACT', 'PROVISIONAL_MONTHLY', 'PROVISIONAL_TERM', 'DAILY_STAY'];
    const rawSource = meterPreviewRoom.billingSource;
    if (!rawSource || !validBillingSources.includes(rawSource)) {
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
    const source = rawSource;

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
      reservationCheckInDate,
      agreementRentPaymentStatus,
      agreementDepositPaymentStatus,
    };
  }

  if (rawState === 'RESERVED_IN_CYCLE') {
    // Strict DTO (Part J): Require explicit finite rentAmount, do not fabricate zero
    if (meterPreviewRoom.rentAmount === undefined || meterPreviewRoom.rentAmount === null || meterPreviewRoom.rentAmount === '') {
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
        rentAmount,
        depositAmount: null,
        source: 'NONE',
      },
      currentCatalogRates,
      reservationCheckInDate,
      agreementRentPaymentStatus,
      agreementDepositPaymentStatus,
    };
  }

  if (rawState === 'DAILY_FINANCIAL_TAIL') {
    const agreementType = meterPreviewRoom.agreementType;
    const billingSource = meterPreviewRoom.billingSource;
    // Strict DTO (Part K): Require authoritative DAILY_STAY source only (no NONE fallback/fabrication)
    if (agreementType !== 'DAILY' || billingSource !== 'DAILY_STAY') {
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
      reservationCheckInDate,
      agreementRentPaymentStatus,
      agreementDepositPaymentStatus,
    };
  }

  // NO_AGREEMENT_IN_CYCLE: Consult effective operational status
  if (meterPreviewRoom.effectiveRoomOperationalStatus === 'UNKNOWN') {
    return {
      roomId: room.id,
      billingCycleId,
      state: 'UNAVAILABLE',
      effectiveOperationalStatus: 'UNKNOWN',
      isCurrentMaintenance,
      occupancy: null,
      currentCatalogRates,
      reservationCheckInDate,
      agreementRentPaymentStatus,
      agreementDepositPaymentStatus,
    };
  }

  if (meterPreviewRoom.effectiveRoomOperationalStatus === 'maintenance') {
    return {
      roomId: room.id,
      billingCycleId,
      state: 'MAINTENANCE_IN_CYCLE',
      effectiveOperationalStatus: 'maintenance',
      isCurrentMaintenance,
      occupancy: null,
      currentCatalogRates,
      reservationCheckInDate,
      agreementRentPaymentStatus,
      agreementDepositPaymentStatus,
    };
  }

  return {
    roomId: room.id,
    billingCycleId,
    state: 'NO_AGREEMENT_IN_CYCLE',
    effectiveOperationalStatus: 'vacant',
    isCurrentMaintenance,
    occupancy: null,
    currentCatalogRates,
  };
}

/**
 * Orders rate items for compact B1 presentation: TERM -> MONTHLY -> DAILY.
 * This is strictly a presentation-ordering helper and preserves all original rate values.
 */
export function getPresentationOrderedRates(rates: RateItem[]): RateItem[] {
  const orderMap: Record<string, number> = { term: 1, monthly: 2, daily: 3 };
  return [...rates].sort((a, b) => (orderMap[a.cycle] || 99) - (orderMap[b.cycle] || 99));
}
