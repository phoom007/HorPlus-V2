/**
 * @license Apache-2.0
 * Occupancy Physical Interval & Bangkok Half-Open Boundary Authority
 *
 * Provides authoritative functions for:
 * 1. Converting date-only inclusive end-dates (Contract / ProvisionalRentalTerm)
 *    into exclusive physical boundaries: [start 00:00 Bangkok, (end + 1) 00:00 Bangkok).
 * 2. Resolving exact Daily Stay timestamps: [checkInAt, effectiveCheckOutAt).
 * 3. Pure half-open interval arithmetic [start, end) without sub-day or boundary leakage.
 */

import {
  BANGKOK_OFFSET_MS,
  normalizeBangkokDate,
  toBangkokDateString,
} from './calendar-date.util.js';
import { resolveDailyTimestampsAndPricing } from '../services/daily-stay.service.js';

/**
 * Returns UTC Date for the start of the given Bangkok date (00:00:00.000 Asia/Bangkok).
 */
export function getBangkokStartOfDay(dateInput: Date | string): Date {
  const dateStr = normalizeBangkokDate(dateInput);
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10) - 1;
  const day = parseInt(dayStr, 10);
  const localUtcMs = Date.UTC(year, month, day, 0, 0, 0, 0);
  return new Date(localUtcMs - BANGKOK_OFFSET_MS);
}

/**
 * Converts an inclusive date-only end date (e.g. Contract endDate 2026-09-14)
 * into its exclusive physical boundary (+1 calendar day in Bangkok timezone, 00:00:00.000 Asia/Bangkok = 2026-09-15 00:00:00.000+07:00).
 */
export function getBangkokExclusiveEndOfInclusiveDate(dateInput: Date | string): Date {
  const dateStr = normalizeBangkokDate(dateInput);
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10) - 1;
  const day = parseInt(dayStr, 10);
  // Add 1 calendar day to represent the exclusive upper bound of the inclusive day
  const nextDayUtcMs = Date.UTC(year, month, day + 1, 0, 0, 0, 0);
  return new Date(nextDayUtcMs - BANGKOK_OFFSET_MS);
}

export interface PhysicalInterval {
  start: Date;
  end: Date;
}

/**
 * Returns the physical half-open interval [start, end) for a Monthly / Long-Term Contract.
 * - start: startDate 00:00:00 Bangkok
 * - end: (endDate + 1 day) 00:00:00 Bangkok (or infinite future if open-ended)
 */
export function getContractPhysicalInterval(contract: {
  startDate: Date | string;
  endDate?: Date | string | null;
  status?: string | null;
  terminatedAt?: Date | string | null;
  terminationEffectiveDate?: Date | string | null;
}): PhysicalInterval {
  const start = getBangkokStartOfDay(contract.startDate);

  if (contract.status === 'terminated' || contract.status === 'TERMINATED') {
    if (contract.terminationEffectiveDate) {
      return {
        start,
        end: getBangkokExclusiveEndOfInclusiveDate(contract.terminationEffectiveDate),
      };
    } else if (contract.terminatedAt) {
      return {
        start,
        end: new Date(contract.terminatedAt),
      };
    }
  }

  const end = contract.endDate
    ? getBangkokExclusiveEndOfInclusiveDate(contract.endDate)
    : new Date(8640000000000000); // Open-ended contract
  return { start, end };
}

/**
 * Returns the physical half-open interval [start, end) for a Provisional Rental Term (Monthly or Term).
 * - start: startDate 00:00:00 Bangkok
 * - end: (endDate + 1 day) 00:00:00 Bangkok
 */
export function getProvisionalTermPhysicalInterval(term: {
  startDate: Date | string;
  endDate?: Date | string | null;
}): PhysicalInterval {
  const start = getBangkokStartOfDay(term.startDate);
  const end = term.endDate
    ? getBangkokExclusiveEndOfInclusiveDate(term.endDate)
    : new Date(8640000000000000);
  return { start, end };
}

/**
 * Returns the exact physical half-open interval [checkInAt, effectiveCheckOutAt) for a Daily Stay.
 * Authority:
 * - start: stay.checkInAt ?? (stay.startDate 00:00:00 Bangkok)
 * - end: stay.actualCheckedOutAt ?? stay.checkOutAt ?? (resolveDailyTimestampsAndPricing(stay.startDate, stay.endDate).checkOutAt)
 */
export function getDailyStayPhysicalInterval(stay: {
  startDate?: Date | string;
  endDate?: Date | string;
  checkInAt?: Date | string | null;
  checkOutAt?: Date | string | null;
  actualCheckedOutAt?: Date | string | null;
}): PhysicalInterval {
  const start = stay.checkInAt
    ? new Date(stay.checkInAt)
    : getBangkokStartOfDay(stay.startDate!);

  let end: Date;
  if (stay.actualCheckedOutAt) {
    end = new Date(stay.actualCheckedOutAt);
  } else if (stay.checkOutAt) {
    end = new Date(stay.checkOutAt);
  } else if (stay.startDate && stay.endDate) {
    end = resolveDailyTimestampsAndPricing(
      toBangkokDateString(stay.startDate),
      toBangkokDateString(stay.endDate)
    ).checkOutAt;
  } else if (stay.endDate) {
    end = getBangkokExclusiveEndOfInclusiveDate(stay.endDate);
  } else {
    end = new Date(start.getTime() + 24 * 3600 * 1000);
  }

  return { start, end };
}

/**
 * Checks whether two half-open intervals [a.start, a.end) and [b.start, b.end) overlap.
 * In half-open interval algebra, overlap occurs if and only if:
 * a.start < b.end && b.start < a.end
 * Note: if a.end === b.start, they touch at the exact boundary but do NOT overlap.
 */
export function doHalfOpenIntervalsOverlap(
  a: { start: Date | number; end: Date | number },
  b: { start: Date | number; end: Date | number }
): boolean {
  const aStart = typeof a.start === 'number' ? a.start : a.start.getTime();
  const aEnd = typeof a.end === 'number' ? a.end : a.end.getTime();
  const bStart = typeof b.start === 'number' ? b.start : b.start.getTime();
  const bEnd = typeof b.end === 'number' ? b.end : b.end.getTime();

  return aStart < bEnd && bStart < aEnd;
}

/**
 * Merges overlapping or touching half-open intervals into a minimal list of disjoint intervals.
 */
export function mergeHalfOpenIntervals(
  intervals: Array<{ start: Date | number; end: Date | number }>
): Array<{ start: number; end: number }> {
  if (intervals.length === 0) return [];

  const normalized = intervals
    .map((iv) => ({
      start: typeof iv.start === 'number' ? iv.start : iv.start.getTime(),
      end: typeof iv.end === 'number' ? iv.end : iv.end.getTime(),
    }))
    .filter((iv) => iv.start < iv.end)
    .sort((a, b) => a.start - b.start);

  if (normalized.length === 0) return [];

  const merged: Array<{ start: number; end: number }> = [normalized[0]];

  for (let i = 1; i < normalized.length; i++) {
    const current = normalized[i];
    const prev = merged[merged.length - 1];

    if (current.start <= prev.end) {
      if (current.end > prev.end) {
        prev.end = current.end;
      }
    } else {
      merged.push({ ...current });
    }
  }

  return merged;
}

/**
 * Determines whether a room has any unblocked / bookable gap within a billing cycle period [cycleStart, cycleEndExclusive).
 *
 * Rules:
 * 1. Clamps blocking intervals to the cycle window [cycleStart, cycleEndExclusive).
 * 2. Merges overlapping/contiguous intervals.
 * 3. hasBookableGap = false if and only if the merged interval completely covers [cycleStart, cycleEndExclusive) with 0 gaps.
 * 4. Otherwise, hasBookableGap = true.
 */
export function hasBookableGapInCycle(
  cycleStart: Date | number,
  cycleEndExclusive: Date | number,
  blockingIntervals: Array<{ start: Date | number; end: Date | number }>
): boolean {
  const cStart = typeof cycleStart === 'number' ? cycleStart : cycleStart.getTime();
  const cEnd = typeof cycleEndExclusive === 'number' ? cycleEndExclusive : cycleEndExclusive.getTime();

  if (cStart >= cEnd) return false;

  // 1. Clamp each blocking interval to the cycle window
  const clamped: Array<{ start: number; end: number }> = [];
  for (const iv of blockingIntervals) {
    const ivStart = typeof iv.start === 'number' ? iv.start : iv.start.getTime();
    const ivEnd = typeof iv.end === 'number' ? iv.end : iv.end.getTime();

    const start = Math.max(cStart, ivStart);
    const end = Math.min(cEnd, ivEnd);
    if (start < end) {
      clamped.push({ start, end });
    }
  }

  // 2. Merge clamped intervals
  const merged = mergeHalfOpenIntervals(clamped);

  // 3. Complete coverage check
  if (merged.length === 1) {
    if (merged[0].start <= cStart && merged[0].end >= cEnd) {
      return false; // Completely covered with 0 gap
    }
  }

  return true; // Gap exists before, after, or between intervals
}

export interface RoomMaintenanceEligibility {
  canSetMaintenance: boolean;
  maintenanceBlockReason: 'ACTIVE_OCCUPANCY' | 'ACTIVE_RESERVATION' | null;
  message?: string;
  blockingRecord?: {
    kind: 'CONTRACT' | 'PROVISIONAL_TERM' | 'DAILY_STAY';
    id: string;
    interval: PhysicalInterval;
  };
}

/**
 * Authoritatively evaluates whether a room can be changed to 'maintenance' status.
 *
 * Rules (Product Decision F1):
 * 1. Physical Occupancy NOW: start <= now < end on valid non-deleted record -> ROOM_HAS_ACTIVE_OCCUPANCY
 * 2. Committed Future Reservation: start > now on valid non-deleted record -> ROOM_HAS_ACTIVE_RESERVATION
 * 3. Historical ended records (end <= now) or cancelled / void / rejected / soft-deleted records NEVER block.
 */
export function evaluateMaintenanceEligibilityFromRecords(params: {
  contracts?: any[];
  provisionals?: any[];
  dailyStays?: any[];
  now?: Date;
}): RoomMaintenanceEligibility {
  const now = params.now || new Date();
  const contracts = Array.isArray(params.contracts) ? params.contracts : [];
  const provisionals = Array.isArray(params.provisionals) ? params.provisionals : [];
  const dailyStays = Array.isArray(params.dailyStays) ? params.dailyStays : [];

  // --- Step 1: Active Physical Occupancy Check (NOW) ---
  // 1a. Contract active physical occupancy
  for (const c of contracts) {
    if (c.deletedAt) continue;
    const st = (c.status || '').toLowerCase();
    if (['cancelled', 'void', 'rejected', 'draft'].includes(st)) continue;
    const interval = getContractPhysicalInterval(c);
    if (interval.start <= now && now < interval.end) {
      return {
        canSetMaintenance: false,
        maintenanceBlockReason: 'ACTIVE_OCCUPANCY',
        message: 'ไม่สามารถปิดปรับปรุงได้ เนื่องจากห้องนี้มีผู้เช่าพักอยู่',
        blockingRecord: { kind: 'CONTRACT', id: c.id, interval },
      };
    }
  }

  // 1b. Provisional term active physical occupancy
  for (const p of provisionals) {
    if (p.deletedAt) continue;
    const st = (p.status || '').toUpperCase();
    if (['CANCELLED', 'REJECTED', 'ENDED'].includes(st)) continue;
    const interval = getProvisionalTermPhysicalInterval(p);
    if (interval.start <= now && now < interval.end) {
      return {
        canSetMaintenance: false,
        maintenanceBlockReason: 'ACTIVE_OCCUPANCY',
        message: 'ไม่สามารถปิดปรับปรุงได้ เนื่องจากห้องนี้มีผู้เช่าพักอยู่',
        blockingRecord: { kind: 'PROVISIONAL_TERM', id: p.id, interval },
      };
    }
  }

  // 1c. Daily stay active physical occupancy
  for (const d of dailyStays) {
    if (d.deletedAt) continue;
    const st = (d.status || '').toUpperCase();
    if (['CANCELLED', 'REJECTED', 'CHECKED_OUT', 'COMPLETED'].includes(st)) continue;
    if (d.actualCheckedOutAt && new Date(d.actualCheckedOutAt) <= now) continue;
    const interval = getDailyStayPhysicalInterval(d);
    if (interval.start <= now && now < interval.end) {
      return {
        canSetMaintenance: false,
        maintenanceBlockReason: 'ACTIVE_OCCUPANCY',
        message: 'ไม่สามารถปิดปรับปรุงได้ เนื่องจากห้องนี้มีผู้เช่าพักอยู่',
        blockingRecord: { kind: 'DAILY_STAY', id: d.id, interval },
      };
    }
  }

  // --- Step 2: Committed Future Reservation Check (start > now) ---
  // 2a. Future Contract reservation
  for (const c of contracts) {
    if (c.deletedAt) continue;
    const st = (c.status || '').toLowerCase();
    if (['cancelled', 'void', 'rejected', 'terminated', 'draft'].includes(st)) continue;
    const interval = getContractPhysicalInterval(c);
    if (interval.start > now) {
      return {
        canSetMaintenance: false,
        maintenanceBlockReason: 'ACTIVE_RESERVATION',
        message: 'ไม่สามารถปิดปรับปรุงได้ เนื่องจากห้องนี้มีการจองล่วงหน้า',
        blockingRecord: { kind: 'CONTRACT', id: c.id, interval },
      };
    }
  }

  // 2b. Future Provisional reservation
  for (const p of provisionals) {
    if (p.deletedAt) continue;
    const st = (p.status || '').toUpperCase();
    if (['CANCELLED', 'REJECTED', 'ENDED'].includes(st)) continue;
    const interval = getProvisionalTermPhysicalInterval(p);
    if (interval.start > now) {
      return {
        canSetMaintenance: false,
        maintenanceBlockReason: 'ACTIVE_RESERVATION',
        message: 'ไม่สามารถปิดปรับปรุงได้ เนื่องจากห้องนี้มีการจองล่วงหน้า',
        blockingRecord: { kind: 'PROVISIONAL_TERM', id: p.id, interval },
      };
    }
  }

  // 2c. Future Daily stay reservation
  for (const d of dailyStays) {
    if (d.deletedAt) continue;
    const st = (d.status || '').toUpperCase();
    if (['CANCELLED', 'REJECTED', 'CHECKED_OUT', 'COMPLETED'].includes(st)) continue;
    const interval = getDailyStayPhysicalInterval(d);
    if (interval.start > now) {
      return {
        canSetMaintenance: false,
        maintenanceBlockReason: 'ACTIVE_RESERVATION',
        message: 'ไม่สามารถปิดปรับปรุงได้ เนื่องจากห้องนี้มีการจองล่วงหน้า',
        blockingRecord: { kind: 'DAILY_STAY', id: d.id, interval },
      };
    }
  }

  return {
    canSetMaintenance: true,
    maintenanceBlockReason: null,
  };
}
