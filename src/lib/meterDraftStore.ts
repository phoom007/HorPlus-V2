/**
 * @license Apache-2.0
 * In-Memory Sparse Draft Store for Owner Meter Workspace
 * 
 * Invariants:
 * 1. Draft state is stored purely in React/JS memory (NEVER in localStorage).
 * 2. Stores ONLY sparse dirty patches (unsaved deltas relative to server baseline).
 * 3. Never stores clean server copies or server concurrency metadata (snapshotVersion).
 * 4. Other Fees are persisted immediately (+ / ×) and are therefore never stored as drafts.
 * 5. Strictly keyed by (dormitoryId, billingCycleId).
 * 6. Never leaks data across dormitories.
 * 7. Cleared on logout, dormitory switch, or successful bill issuance/save.
 */

export interface MeterRowDraftPatch {
  roomId: string;
  waterPrev?: string;
  waterCurr?: string;
  elecPrev?: string;
  elecCurr?: string;
  peopleCount?: number;
  overdueAmount?: string;
  isReplaced?: boolean;
}

// Deprecated alias for backwards-compatibility during migration
export type MeterRowDraft = MeterRowDraftPatch;

const draftMemoryStore = new Map<string, MeterRowDraftPatch[]>();

function getDraftKey(dormitoryId: string, billingCycleId: string): string {
  return `${dormitoryId}:${billingCycleId}`;
}

export const meterDraftStore = {
  getDraft(dormitoryId: string, billingCycleId: string): MeterRowDraftPatch[] | null {
    if (!dormitoryId || !billingCycleId) return null;
    const key = getDraftKey(dormitoryId, billingCycleId);
    const patches = draftMemoryStore.get(key);
    return (patches && patches.length > 0) ? patches : null;
  },

  setDraft(dormitoryId: string, billingCycleId: string, patches: MeterRowDraftPatch[]): void {
    if (!dormitoryId || !billingCycleId) return;
    const key = getDraftKey(dormitoryId, billingCycleId);
    if (!patches || patches.length === 0) {
      draftMemoryStore.delete(key);
    } else {
      draftMemoryStore.set(key, [...patches]);
    }
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

export function deriveMeterDraftPatches(
  currentRows: Array<{
    roomId: string;
    waterPrev?: string;
    waterCurr?: string;
    elecPrev?: string;
    elecCurr?: string;
    peopleCount?: number;
    overdueAmount?: string;
    isReplaced?: boolean;
  }>,
  originalRows: Array<{
    roomId: string;
    waterPrev?: string;
    waterCurr?: string;
    elecPrev?: string;
    elecCurr?: string;
    peopleCount?: number;
    overdueAmount?: string;
    isReplaced?: boolean;
  }>
): MeterRowDraftPatch[] {
  if (!currentRows || !originalRows) return [];
  const patches: MeterRowDraftPatch[] = [];

  for (const cur of currentRows) {
    const orig = originalRows.find(o => o.roomId === cur.roomId);
    if (!orig) continue;

    const patch: MeterRowDraftPatch = { roomId: cur.roomId };
    let hasDelta = false;

    if (cur.waterCurr !== orig.waterCurr) {
      patch.waterCurr = cur.waterCurr;
      hasDelta = true;
    }
    if (cur.waterPrev !== orig.waterPrev) {
      patch.waterPrev = cur.waterPrev;
      hasDelta = true;
    }
    if (cur.elecCurr !== orig.elecCurr) {
      patch.elecCurr = cur.elecCurr;
      hasDelta = true;
    }
    if (cur.elecPrev !== orig.elecPrev) {
      patch.elecPrev = cur.elecPrev;
      hasDelta = true;
    }
    if (cur.peopleCount !== orig.peopleCount) {
      patch.peopleCount = cur.peopleCount;
      hasDelta = true;
    }
    if (cur.overdueAmount !== orig.overdueAmount) {
      patch.overdueAmount = cur.overdueAmount;
      hasDelta = true;
    }
    if (cur.isReplaced !== orig.isReplaced) {
      patch.isReplaced = cur.isReplaced;
      hasDelta = true;
    }

    if (hasDelta) {
      patches.push(patch);
    }
  }

  return patches;
}

export function clearMeterDraftStore(dormitoryId?: string): void {
  if (dormitoryId) {
    meterDraftStore.clearDormitoryDrafts(dormitoryId);
  } else {
    meterDraftStore.clearAllDrafts();
  }
}
