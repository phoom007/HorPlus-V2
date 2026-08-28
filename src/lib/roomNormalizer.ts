/**
 * @license Apache-2.0
 * Canonical Authoritative Room Transport DTO & Frontend Normalizer
 *
 * Single authoritative projection from backend AuthoritativeRoomDto to UI Room.
 * Enforces strict financial integrity and fail-closed validation on required fields.
 */

import { Room, RoomStatus } from '../types';

export interface AuthoritativeRoomDto {
  id: string;
  dormitoryId: string;
  buildingId: string | null;
  buildingName?: string;
  roomNumber: string;
  normalizedRoomNumber?: string;
  status: RoomStatus;
  floor?: number;
  rentCycle?: 'monthly' | 'term' | 'daily';
  version?: number;

  rawOverrides?: {
    monthlyRent?: string | null;
    termRent?: string | null;
    dailyRent?: string | null;
    termDeposit?: string | null;
    monthlyDeposit?: string | null;
    dailyDeposit?: string | null;
    depositAmount?: string | null;
    maximumOccupants?: number | null;
    parkingFee?: string | null;
    waterRate?: string | null;
    electricityRate?: string | null;
    commonFee?: string | null;
    internetFee?: string | null;
    waterBillingType?: string | null;
    electricityBillingType?: string | null;
    rentBillingType?: string | null;
    roomType?: string | null;
  };

  currentEffectiveValues?: {
    monthlyRent?: number | string | null;
    termRent?: number | string | null;
    dailyRent?: number | string | null;
    termDeposit?: number | string | null;
    monthlyDeposit?: number | string | null;
    dailyDeposit?: number | string | null;
    depositAmount?: number | string | null;
    maximumOccupants?: number | null;
    parkingFee?: number | string | null;
    waterRate?: number | string | null;
    electricityRate?: number | string | null;
    commonFee?: number | string | null;
    internetFee?: number | string | null;
    waterBillingType?: string | null;
    electricityBillingType?: string | null;
    rentBillingType?: string | null;
    roomType?: string | null;
  };

  activeRentalSummary?: {
    type: 'TERM' | 'MONTHLY' | 'DAILY';
    rentAmount: number | string;
    depositAmount?: number | string | null;
    source: string;
    termInstallmentCount?: number | null;
  } | null;

  effectiveValues?: Record<string, any>;
  fieldSources?: Record<string, any>;
  currentFieldSources?: Record<string, any>;

  initialWaterReading?: string | number | null;
  initialElectricityReading?: string | number | null;
  waterMeterNumber?: string | null;
  electricityMeterNumber?: string | null;

  currentTenantId?: string | null;
  currentContractId?: string | null;

  depositStatus?: 'paid' | 'unpaid' | null;

  images?: string[] | null;
  amenities?: string[] | null;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;

  // Legacy flat fields if returned by direct DB queries
  monthlyRent?: number | string | null;
  termRent?: number | string | null;
  dailyRent?: number | string | null;
  depositAmount?: number | string | null;
  maxOccupants?: number | null;
  maximumOccupants?: number | null;
  initialWaterMeter?: number | string | null;
  initialElectricMeter?: number | string | null;
}

/**
 * Strict parser for required finite numbers in authoritative room DTOs.
 * Throws explicit Error if value is null, undefined, empty string, or non-finite number.
 */
export function parseRequiredFiniteNumber(value: unknown, fieldName: string): number {
  if (value === null || value === undefined || value === '') {
    throw new Error(`[ROOM_TRANSPORT_INVALID] Missing required ${fieldName}`);
  }
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`[ROOM_TRANSPORT_INVALID] Invalid ${fieldName}`);
  }
  return num;
}

/**
 * Strict parser for optional finite numbers.
 * Returns undefined for null, undefined, or empty string.
 * Throws Error if a non-empty string or invalid value cannot be parsed to a finite number.
 */
export function parseOptionalFiniteNumber(value: unknown, fieldName: string): number | undefined {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`[ROOM_TRANSPORT_INVALID] Invalid ${fieldName}`);
  }
  return num;
}

/**
 * Permissive parser with default fallback for non-financial metrics (meters) where zero is a legitimate default.
 * If value is a malformed non-empty string, throws transport error to fail closed.
 */
export function parseMeterReading(value: unknown, fieldName: string, fallback: number = 0): number {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`[ROOM_TRANSPORT_INVALID] Invalid ${fieldName}`);
  }
  return num;
}

/**
 * Single authoritative projection function: AuthoritativeRoomDto -> canonical UI Room.
 */
export function normalizeAuthoritativeRoom(dto: AuthoritativeRoomDto | any): Room {
  if (!dto || typeof dto !== 'object') {
    throw new Error('[normalizeAuthoritativeRoom] Invalid room payload: expected object.');
  }

  const effective = dto.currentEffectiveValues || dto.effectiveValues;

  // Strict required financial values (fail closed if missing or malformed)
  const rawMonthly = effective?.monthlyRent ?? dto.monthlyRent;
  const monthlyRent = parseRequiredFiniteNumber(rawMonthly, 'monthlyRent');

  const rawDeposit = effective?.depositAmount ?? dto.depositAmount;
  const depositAmount = parseRequiredFiniteNumber(rawDeposit ?? 0, 'depositAmount');

  const rawMonthlyDeposit = effective?.monthlyDeposit ?? dto.monthlyDeposit ?? rawDeposit;
  const monthlyDeposit = parseRequiredFiniteNumber(rawMonthlyDeposit ?? 0, 'monthlyDeposit');

  const rawTermDeposit = effective?.termDeposit ?? dto.termDeposit ?? rawDeposit;
  const termDeposit = parseRequiredFiniteNumber(rawTermDeposit ?? 0, 'termDeposit');

  const rawDailyDeposit = effective?.dailyDeposit ?? dto.dailyDeposit ?? rawDeposit;
  const dailyDeposit = parseRequiredFiniteNumber(rawDailyDeposit ?? 0, 'dailyDeposit');

  const rawOccupants = effective?.maximumOccupants ?? dto.maximumOccupants ?? dto.maxOccupants;
  const maxOccupants = parseRequiredFiniteNumber(rawOccupants, 'maximumOccupants');

  // Optional financial values
  const rawTerm = effective?.termRent ?? dto.termRent;
  const termRent = parseOptionalFiniteNumber(rawTerm, 'termRent');

  const rawDaily = effective?.dailyRent ?? dto.dailyRent;
  const dailyRent = parseOptionalFiniteNumber(rawDaily, 'dailyRent');

  // Active rental summary projection
  let activeRentalSummary = null;
  if (dto.activeRentalSummary && typeof dto.activeRentalSummary === 'object') {
    const ars = dto.activeRentalSummary;
    const type = ars.type === 'TERM' || ars.type === 'DAILY' ? ars.type : 'MONTHLY';
    const rentAmount = Number.isFinite(Number(ars.rentAmount)) ? Number(ars.rentAmount) : 0;
    const depositAmountVal = ars.depositAmount !== undefined && ars.depositAmount !== null && Number.isFinite(Number(ars.depositAmount))
      ? Number(ars.depositAmount)
      : null;
    activeRentalSummary = {
      type,
      rentAmount,
      depositAmount: depositAmountVal,
      source: String(ars.source || 'UNKNOWN'),
      termInstallmentCount: typeof ars.termInstallmentCount === 'number' ? ars.termInstallmentCount : null,
    };
  }

  // Meter readings
  const rawWater = dto.initialWaterReading ?? dto.initialWaterMeter;
  const initialWaterMeter = parseMeterReading(rawWater, 'initialWaterReading', 0);

  const rawElectric = dto.initialElectricityReading ?? dto.initialElectricMeter;
  const initialElectricMeter = parseMeterReading(rawElectric, 'initialElectricityReading', 0);

  const rawImages = dto.images;
  const images: string[] = Array.isArray(rawImages) ? rawImages : (typeof rawImages === 'string' ? [rawImages] : []);

  const rawAmenities = dto.amenities;
  const amenities: string[] = Array.isArray(rawAmenities) ? rawAmenities : [];

  const status: RoomStatus = (['vacant', 'occupied', 'reserved', 'maintenance'].includes(dto.status) ? dto.status : 'vacant') as RoomStatus;

  // Financial integrity: Never fabricate deposit payment status from occupancy or tenant presence.
  const depositStatus: 'paid' | 'unpaid' | undefined = (dto.depositStatus === 'paid' || dto.depositStatus === 'unpaid')
    ? dto.depositStatus
    : undefined;

  const floorNum = typeof dto.floor === 'number' ? dto.floor : (dto.floor ? Number(dto.floor) : 1);
  const floor = Number.isFinite(floorNum) ? floorNum : 1;

  return {
    id: String(dto.id || ''),
    buildingId: String(dto.buildingId || ''),
    roomNumber: String(dto.roomNumber || ''),
    floor,
    status,
    currentTenantId: dto.currentTenantId || undefined,
    rentCycle: (dto.rentCycle || 'monthly') as 'monthly' | 'term' | 'daily',
    monthlyRent,
    termRent,
    dailyRent,
    termDeposit,
    monthlyDeposit,
    dailyDeposit,
    depositAmount: monthlyDeposit || depositAmount,
    depositStatus,
    maxOccupants,
    initialWaterMeter,
    initialElectricMeter,
    images,
    amenities,
    version: typeof dto.version === 'number' ? dto.version : 1,
    activeRentalSummary,
    createdAt: dto.createdAt ? String(dto.createdAt) : undefined,
    updatedAt: dto.updatedAt ? String(dto.updatedAt) : undefined,
  };
}

/**
 * Maps an array of authoritative room DTOs to canonical UI Room array.
 */
export function normalizeAuthoritativeRooms(dtos: unknown[]): Room[] {
  if (!Array.isArray(dtos)) return [];
  return dtos.map((dto) => normalizeAuthoritativeRoom(dto));
}
