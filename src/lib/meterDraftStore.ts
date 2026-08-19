/**
 * @license Apache-2.0
 * In-Memory Draft Store for Owner Meter Workspace
 * 
 * Invariants:
 * 1. Draft state is stored purely in React/JS memory (NEVER in localStorage).
 * 2. Strictly keyed by (dormitoryId, billingCycleId).
 * 3. Never leaks data across dormitories.
 * 4. Cleared on logout, dormitory switch, or successful bill issuance/discard.
 */

export interface MeterRowDraft {
  roomId: string;
  roomNumber: string;
  waterPrev: number;
  waterCurr: number;
  elecPrev: number;
  elecCurr: number;
  isReplaced: boolean;
  peopleCount: number;
  overdueAmount: number;
  isPaid: boolean;
  billStatus: 'draft' | 'issued' | 'paid' | 'cancelled' | 'overdue' | 'void';
  editWaterPrev: boolean;
  editElecPrev: boolean;
  otherFees: Array<{ description: string; amount: number }>;
  snapshotVersion?: number;
}

const draftMemoryStore = new Map<string, MeterRowDraft[]>();

function getDraftKey(dormitoryId: string, billingCycleId: string): string {
  return `${dormitoryId}:${billingCycleId}`;
}

export const meterDraftStore = {
  getDraft(dormitoryId: string, billingCycleId: string): MeterRowDraft[] | null {
    if (!dormitoryId || !billingCycleId) return null;
    const key = getDraftKey(dormitoryId, billingCycleId);
    return draftMemoryStore.get(key) || null;
  },

  setDraft(dormitoryId: string, billingCycleId: string, rows: MeterRowDraft[]): void {
    if (!dormitoryId || !billingCycleId) return;
    const key = getDraftKey(dormitoryId, billingCycleId);
    draftMemoryStore.set(key, [...rows]);
  },

  clearDraft(dormitoryId: string, billingCycleId: string): void {
    if (!dormitoryId || !billingCycleId) return;
    const key = getDraftKey(dormitoryId, billingCycleId);
    draftMemoryStore.delete(key);
  },

  clearDormitoryDrafts(dormitoryId: string): void {
    for (const key of draftMemoryStore.keys()) {
      if (key.startsWith(`${dormitoryId}:`)) {
        draftMemoryStore.delete(key);
      }
    }
  },

  clearAllDrafts(): void {
    draftMemoryStore.clear();
  },
};

export function clearMeterDraftStore(dormitoryId?: string): void {
  if (dormitoryId) {
    meterDraftStore.clearDormitoryDrafts(dormitoryId);
  } else {
    meterDraftStore.clearAllDrafts();
  }
}
