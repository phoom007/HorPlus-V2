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
 * Fail-Closed Invariant:
 * Invalid/empty/negative/scientific numbers are rejected with validation errors;
 * fee amounts are NEVER silently converted into "0.00".
 * 
 * @license Apache-2.0
 */

const CANONICAL_DECIMAL_REGEX = /^\d+(\.\d{1,2})?$/;

export function formatCanonicalDecimalString(val: unknown, fieldName: string = 'จำนวน'): string | undefined {
  if (val === undefined || val === null) return undefined;

  if (typeof val === 'number') {
    if (isNaN(val) || !isFinite(val) || val < 0) {
      throw new Error(`ฟิลด์ ${fieldName} ไม่ถูกต้อง: ต้องเป็นตัวเลขจำนวนบวก`);
    }
    const str = String(val);
    if (str.includes('e') || str.includes('E')) {
      throw new Error(`ฟิลด์ ${fieldName} ไม่ถูกต้อง: ห้ามใช้สัญกรณ์วิทยาศาสตร์`);
    }
    if (!CANONICAL_DECIMAL_REGEX.test(str)) {
      throw new Error(`ฟิลด์ ${fieldName} ไม่ถูกต้อง: ต้องเป็นตัวเลขทศนิยมไม่เกิน 2 ตำแหน่ง (${str})`);
    }
    return str;
  }

  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) {
      throw new Error(`ฟิลด์ ${fieldName} ไม่สามารถเป็นค่าว่างได้`);
    }
    if (!CANONICAL_DECIMAL_REGEX.test(trimmed)) {
      throw new Error(`ฟิลด์ ${fieldName} ไม่ถูกต้อง: ต้องเป็นตัวเลขทศนิยมไม่เกิน 2 ตำแหน่ง (${trimmed})`);
    }
    return trimmed;
  }

  throw new Error(`ฟิลด์ ${fieldName} ต้องเป็นตัวเลขหรือข้อความตัวเลข`);
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

  if (row.waterPrev !== undefined) {
    if (row.waterPrev === null || (typeof row.waterPrev === 'string' && row.waterPrev.trim() === '')) {
      result.waterPrev = null;
    } else {
      const waterPrevStr = formatCanonicalDecimalString(row.waterPrev, 'เลขอ่านค่าน้ำเดิม');
      if (waterPrevStr !== undefined) {
        result.waterPrev = waterPrevStr;
      }
    }
  }

  if (row.waterCurr !== undefined) {
    if (row.waterCurr === null || (typeof row.waterCurr === 'string' && row.waterCurr.trim() === '')) {
      result.waterCurr = null;
    } else {
      const waterCurrStr = formatCanonicalDecimalString(row.waterCurr, 'เลขอ่านค่าน้ำใหม่');
      if (waterCurrStr !== undefined) {
        result.waterCurr = waterCurrStr;
      }
    }
  }

  if (row.elecPrev !== undefined) {
    if (row.elecPrev === null || (typeof row.elecPrev === 'string' && row.elecPrev.trim() === '')) {
      result.elecPrev = null;
    } else {
      const elecPrevStr = formatCanonicalDecimalString(row.elecPrev, 'เลขอ่านค่าไฟเดิม');
      if (elecPrevStr !== undefined) {
        result.elecPrev = elecPrevStr;
      }
    }
  }

  if (row.elecCurr !== undefined) {
    if (row.elecCurr === null || (typeof row.elecCurr === 'string' && row.elecCurr.trim() === '')) {
      result.elecCurr = null;
    } else {
      const elecCurrStr = formatCanonicalDecimalString(row.elecCurr, 'เลขอ่านค่าไฟใหม่');
      if (elecCurrStr !== undefined) {
        result.elecCurr = elecCurrStr;
      }
    }
  }

  if (row.peopleCount !== undefined && row.peopleCount !== null) {
    const num = Number(row.peopleCount);
    if (isNaN(num) || !Number.isInteger(num) || num < 0) {
      throw new Error('จำนวนผู้พักอาศัยต้องเป็นตัวเลขจำนวนเต็มบวกหรือ 0');
    }
    result.peopleCount = num;
  }

  const manualAmount =
    row.manualOutstandingAmount !== undefined && row.manualOutstandingAmount !== null
      ? row.manualOutstandingAmount
      : row.overdueAmount;
  if (manualAmount !== undefined && manualAmount !== null) {
    const manualAmountStr = formatCanonicalDecimalString(manualAmount, 'ยอดค้างชำระ');
    if (manualAmountStr !== undefined) {
      result.manualOutstandingAmount = manualAmountStr;
    }
  }

  if (row.otherFees !== undefined && row.otherFees !== null) {
    if (!Array.isArray(row.otherFees)) {
      throw new Error('ค่าใช้จ่ายอื่นๆ ต้องเป็นรายการ (array)');
    }
    result.otherFees = row.otherFees.map((f, idx) => {
      const desc = String(f.description || '').trim();
      if (!desc) {
        throw new Error(`รายการค่าใช้จ่ายอื่นๆ ลำดับที่ ${idx + 1} ต้องระบุชื่อรายการ`);
      }
      const amtStr = formatCanonicalDecimalString(f.amount, `ค่าใช้จ่ายอื่นๆ "${desc}"`);
      if (amtStr === undefined) {
        throw new Error(`รายการค่าใช้จ่ายอื่นๆ ลำดับที่ ${idx + 1} ต้องระบุจำนวนเงิน`);
      }
      return {
        description: desc,
        amount: amtStr,
      };
    });
  }

  if (row.isReplaced !== undefined && row.isReplaced !== null) {
    result.isReplaced = Boolean(row.isReplaced);
  }

  if (row.expectedVersion !== undefined && row.expectedVersion !== null) {
    const num = Number(row.expectedVersion);
    if (isNaN(num) || !Number.isInteger(num) || num < 0) {
      throw new Error('expectedVersion ต้องเป็นตัวเลขจำนวนเต็มบวกหรือ 0');
    }
    result.expectedVersion = num;
  }

  return result;
}

export function serializeMeterWorkspaceDirtyRows(
  rows: RawMeterDirtyRowInput[]
): Array<Record<string, any>> {
  return rows.map(serializeMeterWorkspaceDirtyRow);
}
