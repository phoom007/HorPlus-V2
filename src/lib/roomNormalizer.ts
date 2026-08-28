/**
 * @license Apache-2.0
 * Canonical Authoritative Room Transport DTO & Frontend Normalizer
 * 
 * Single authoritative projection from backend AuthoritativeRoomDto to UI Room.
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

  effectiveValues?: Record<string, any>;
  fieldSources?: Record<string, any>;
  currentFieldSources?: Record<string, any>;

  initialWaterReading?: string | number | null;
  initialElectricityReading?: string | number | null;
  waterMeterNumber?: string | null;
  electricityMeterNumber?: string | null;

  currentTenantId?: string | null;
  currentContractId?: string | null;

  depositStatus?: 'paid' | 'unpaid';

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
 * Safe numeric parser that guarantees Number.isNaN(result) === false.
 */
export function parseSafeNumeric(val: unknown, fallback: number = 0): number {
  if (val === null || val === undefined || val === '') return fallback;
  const num = typeof val === 'number' ? val : Number(val);
  return Number.isFinite(num) ? num : fallback;
}

/**
 * Safe optional numeric parser. Returns undefined for null/undefined/empty string.
 */
export function parseOptionalSafeNumeric(val: unknown): number | undefined {
  if (val === null || val === undefined || val === '') return undefined;
  const num = typeof val === 'number' ? val : Number(val);
  return Number.isFinite(num) ? num : undefined;
}

/**
 * Single authoritative projection function: AuthoritativeRoomDto -> canonical UI Room.
 */
export function normalizeAuthoritativeRoom(dto: AuthoritativeRoomDto | any): Room {
  if (!dto || typeof dto !== 'object') {
    throw new Error('[normalizeAuthoritativeRoom] Invalid room payload: expected object.');
  }

  const effective = dto.currentEffectiveValues || dto.effectiveValues;

  const monthlyRent = parseSafeNumeric(effective?.monthlyRent ?? dto.monthlyRent, 0);
  const termRent = parseOptionalSafeNumeric(effective?.termRent ?? dto.termRent);
  const dailyRent = parseOptionalSafeNumeric(effective?.dailyRent ?? dto.dailyRent);
  const depositAmount = parseSafeNumeric(effective?.depositAmount ?? dto.depositAmount, 0);
  const maxOccupants = parseSafeNumeric(effective?.maximumOccupants ?? dto.maximumOccupants ?? dto.maxOccupants, 2);

  const initialWaterMeter = parseSafeNumeric(dto.initialWaterReading ?? dto.initialWaterMeter, 0);
  const initialElectricMeter = parseSafeNumeric(dto.initialElectricityReading ?? dto.initialElectricMeter, 0);

  const rawImages = dto.images;
  const images: string[] = Array.isArray(rawImages) ? rawImages : (typeof rawImages === 'string' ? [rawImages] : []);

  const rawAmenities = dto.amenities;
  const amenities: string[] = Array.isArray(rawAmenities) ? rawAmenities : [];

  const status: RoomStatus = (['vacant', 'occupied', 'reserved', 'maintenance'].includes(dto.status) ? dto.status : 'vacant') as RoomStatus;

  return {
    id: String(dto.id || ''),
    buildingId: String(dto.buildingId || ''),
    roomNumber: String(dto.roomNumber || ''),
    floor: parseSafeNumeric(dto.floor, 1),
    status,
    currentTenantId: dto.currentTenantId || undefined,
    rentCycle: (dto.rentCycle || 'monthly') as 'monthly' | 'term' | 'daily',
    monthlyRent,
    termRent,
    dailyRent,
    depositAmount,
    depositStatus: dto.depositStatus || (status === 'vacant' || !dto.currentTenantId ? 'unpaid' : 'paid'),
    maxOccupants,
    initialWaterMeter,
    initialElectricMeter,
    images,
    amenities,
    version: typeof dto.version === 'number' ? dto.version : 1,
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
