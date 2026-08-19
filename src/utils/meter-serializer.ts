/**
 * Canonical Frontend Meter Workspace Serializer
 * 
 * Prepares dirty meter workspace rows for HTTP payloads matching strict backend schemas:
 * - waterPrev, waterCurr, elecPrev, elecCurr -> canonical decimal strings (e.g. "100.00" or "100")
 * - manualOutstandingAmount -> canonical decimal strings (e.g. "150.00")
 * - otherFees[].amount -> canonical decimal strings (e.g. "500.00")
 * - peopleCount -> integer (when present)
 * - isReplaced -> boolean (when present)
 * - expectedVersion -> integer (when present)
 * 
 * Preserves dirty-field semantics:
 * Only fields that are actually defined/present in the dirty row are emitted.
 * Missing fields are NOT filled with "0" or default values.
 * 
 * @license Apache-2.0
 */

export function formatCanonicalDecimalString(val: unknown): string | undefined {
  if (val === undefined || val === null) return undefined;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return undefined;
    return trimmed;
  }
  if (typeof val === 'number') {
    if (isNaN(val) || !isFinite(val)) return undefined;
    return String(val);
  }
  return String(val);
}

export interface RawMeterDirtyRowInput {
  roomId: string;
  waterPrev?: number | string | null;
  waterCurr?: number | string | null;
  elecPrev?: number | string | null;
  elecCurr?: number | string | null;
  peopleCount?: number | null;
  manualOutstandingAmount?: number | string | null;
  overdueAmount?: number | string | null; // UI alias
  otherFees?: Array<{ description: string; amount: number | string }>;
  isReplaced?: boolean;
  expectedVersion?: number;
}

export function serializeMeterWorkspaceDirtyRow(
  row: RawMeterDirtyRowInput
): Record<string, any> {
  const result: Record<string, any> = {
    roomId: row.roomId,
  };

  const waterPrevStr = formatCanonicalDecimalString(row.waterPrev);
  if (waterPrevStr !== undefined) {
    result.waterPrev = waterPrevStr;
  }

  const waterCurrStr = formatCanonicalDecimalString(row.waterCurr);
  if (waterCurrStr !== undefined) {
    result.waterCurr = waterCurrStr;
  }

  const elecPrevStr = formatCanonicalDecimalString(row.elecPrev);
  if (elecPrevStr !== undefined) {
    result.elecPrev = elecPrevStr;
  }

  const elecCurrStr = formatCanonicalDecimalString(row.elecCurr);
  if (elecCurrStr !== undefined) {
    result.elecCurr = elecCurrStr;
  }

  if (row.peopleCount !== undefined && row.peopleCount !== null) {
    result.peopleCount = Math.floor(Number(row.peopleCount));
  }

  const manualAmount =
    row.manualOutstandingAmount !== undefined
      ? row.manualOutstandingAmount
      : row.overdueAmount;
  const manualAmountStr = formatCanonicalDecimalString(manualAmount);
  if (manualAmountStr !== undefined) {
    result.manualOutstandingAmount = manualAmountStr;
  }

  if (row.otherFees && Array.isArray(row.otherFees)) {
    result.otherFees = row.otherFees.map((f) => ({
      description: String(f.description || '').trim(),
      amount: formatCanonicalDecimalString(f.amount) || '0.00',
    }));
  }

  if (row.isReplaced !== undefined && row.isReplaced !== null) {
    result.isReplaced = Boolean(row.isReplaced);
  }

  if (row.expectedVersion !== undefined && row.expectedVersion !== null) {
    result.expectedVersion = Math.floor(Number(row.expectedVersion));
  }

  return result;
}

export function serializeMeterWorkspaceDirtyRows(
  rows: RawMeterDirtyRowInput[]
): Array<Record<string, any>> {
  return rows.map(serializeMeterWorkspaceDirtyRow);
}
