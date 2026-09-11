import { toBangkokDateString } from './calendar-date.util.js';

export interface VehicleTemporalParams {
  vehicle: {
    type?: string | null;
    createdAt: Date | string;
    deletedAt?: Date | string | null;
    status?: string | null;
  };
  asOfBusinessDate: Date | string;
}

/**
 * Evaluates whether a vehicle was active and billable as of an explicit business date.
 * Rules:
 * 1. Must be an actual vehicle (non-empty, not 'none' or 'ไม่มี').
 * 2. Must be created on or before the asOf business date.
 * 3. If soft-deleted, it was only active strictly before/up to its deletion date.
 */
export function isVehicleApplicableAsOfDate(params: VehicleTemporalParams): boolean {
  const { vehicle, asOfBusinessDate } = params;
  const vType = (vehicle.type || '').trim().toLowerCase();
  if (!vType || vType === 'none' || vType === 'ไม่มี' || vType === 'null') {
    return false;
  }

  const asOfStr = toBangkokDateString(asOfBusinessDate);
  const createdStr = toBangkokDateString(vehicle.createdAt);

  // Must have been created on or before the evaluation date
  if (createdStr > asOfStr) {
    return false;
  }

  // If soft-deleted, check if deletion occurred on or before asOfDate
  if (vehicle.deletedAt) {
    const deletedStr = toBangkokDateString(vehicle.deletedAt);
    if (deletedStr <= asOfStr) {
      return false;
    }
  }

  return true;
}

/**
 * Reconstructs cycle-aware billable vehicle quantity for a list of vehicles against an explicit asOf business date.
 */
export function resolveCycleAwareVehicleCount(params: {
  vehicles: Array<{
    type?: string | null;
    createdAt: Date | string;
    deletedAt?: Date | string | null;
    status?: string | null;
  }>;
  asOfBusinessDate: Date | string;
}): number {
  const { vehicles, asOfBusinessDate } = params;
  let count = 0;
  for (const v of vehicles) {
    if (isVehicleApplicableAsOfDate({ vehicle: v, asOfBusinessDate })) {
      count++;
    }
  }
  return count;
}
/**
 * Evaluates whether a vehicle is currently authoritative and active.
 * Excludes:
 * 1. Soft-deleted vehicles (deletedAt != null)
 * 2. Inactive vehicles (status === 'inactive' or 'deleted')
 * 3. Empty or 'none' / 'ไม่มี' vehicle types
 */
export function isCurrentActiveVehicle(vehicle: {
  type?: string | null;
  deletedAt?: Date | string | null;
  status?: string | null;
}): boolean {
  if (vehicle.deletedAt) {
    return false;
  }
  const st = (vehicle.status || '').trim().toLowerCase();
  if (st === 'inactive' || st === 'deleted') {
    return false;
  }
  const vType = (vehicle.type || '').trim().toLowerCase();
  if (!vType || vType === 'none' || vType === 'ไม่มี' || vType === 'null') {
    return false;
  }
  return true;
}

/**
 * Resolves current active vehicle count for a tenant.
 */
export function resolveCurrentActiveVehicleCount(
  vehicles: Array<{
    type?: string | null;
    deletedAt?: Date | string | null;
    status?: string | null;
  }>
): number {
  if (!Array.isArray(vehicles) || vehicles.length === 0) return 0;
  return vehicles.filter(isCurrentActiveVehicle).length;
}
