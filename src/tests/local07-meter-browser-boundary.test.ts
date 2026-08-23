/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * LOCAL-07 Batch 01 — Browser/HTTP Boundary & Pull-Previous Unit Test Suite
 */

import { describe, it, expect, vi } from 'vitest';
import {
  serializeMeterWorkspaceDirtyRow,
  serializeMeterWorkspaceDirtyRows,
  formatCanonicalDecimalString,
} from '../utils/meter-serializer';
import { ApiMeterAdapter, ApiBillingAdapter } from '../data/adapters/api';

describe('LOCAL-07 Batch 01 — Browser/HTTP Boundary & Pull Previous Suite', () => {
  describe('1. Canonical Frontend Meter Workspace Serializer', () => {
    it('serializes browser numeric inputs into canonical integer and decimal strings', () => {
      const rawDirtyUIState = {
        roomId: 'room-101',
        waterPrev: 100,
        waterCurr: 110,
        elecPrev: 500,
        elecCurr: 550,
        peopleCount: 2,
        overdueAmount: 150, // UI alias
        otherFees: [
          { description: 'ค่าทำความสะอาด', amount: 500 },
          { description: 'ค่ากุญแจ', amount: '100.50' },
        ],
        isReplaced: false,
        expectedVersion: 1,
      };

      const serialized = serializeMeterWorkspaceDirtyRow(rawDirtyUIState);

      expect(serialized).toEqual({
        roomId: 'room-101',
        waterPrev: '100',
        waterCurr: '110',
        elecPrev: '500',
        elecCurr: '550',
        peopleCount: 2,
        manualOutstandingAmount: '150',
        otherFees: [
          { description: 'ค่าทำความสะอาด', amount: '500' },
          { description: 'ค่ากุญแจ', amount: '100.50' },
        ],
        isReplaced: false,
        expectedVersion: 1,
      });
    });

    it('strictly preserves field omission without fabricating "0" for missing fields', () => {
      const sparseDirtyRow = {
        roomId: 'room-102',
        waterCurr: 120,
      };

      const serialized = serializeMeterWorkspaceDirtyRow(sparseDirtyRow);

      expect(serialized).toEqual({
        roomId: 'room-102',
        waterCurr: '120',
      });
      expect(serialized.waterPrev).toBeUndefined();
      expect(serialized.elecCurr).toBeUndefined();
      expect(serialized.elecPrev).toBeUndefined();
      expect(serialized.peopleCount).toBeUndefined();
      expect(serialized.manualOutstandingAmount).toBeUndefined();
      expect(serialized.otherFees).toBeUndefined();
    });

    it('formatCanonicalDecimalString handles null/undefined as omission and formats valid decimals', () => {
      expect(formatCanonicalDecimalString(undefined)).toBeUndefined();
      expect(formatCanonicalDecimalString(null)).toBeUndefined();
      expect(formatCanonicalDecimalString(0)).toBe('0');
      expect(formatCanonicalDecimalString('150.00')).toBe('150.00');
      expect(formatCanonicalDecimalString(250.75)).toBe('250.75');
    });

    it('formatCanonicalDecimalString rejects invalid inputs (fail-closed)', () => {
      expect(() => formatCanonicalDecimalString('')).toThrow();
      expect(() => formatCanonicalDecimalString('   ')).toThrow();
      expect(() => formatCanonicalDecimalString(NaN)).toThrow();
      expect(() => formatCanonicalDecimalString(Infinity)).toThrow();
      expect(() => formatCanonicalDecimalString(-1)).toThrow();
      expect(() => formatCanonicalDecimalString('1e3')).toThrow();
      expect(() => formatCanonicalDecimalString(10.505)).toThrow();
      expect(() => formatCanonicalDecimalString('invalid-str')).toThrow();
    });

    it('fail-closed: does not silently convert invalid/empty fee amounts into "0.00"', () => {
      expect(() =>
        serializeMeterWorkspaceDirtyRow({
          roomId: 'room-103',
          otherFees: [{ description: 'ค่าบริการ', amount: '' as any }],
        })
      ).toThrow();

      expect(() =>
        serializeMeterWorkspaceDirtyRow({
          roomId: 'room-103',
          otherFees: [{ description: 'ค่าบริการ', amount: -50 }],
        })
      ).toThrow();

      expect(() =>
        serializeMeterWorkspaceDirtyRow({
          roomId: 'room-103',
          otherFees: [{ description: 'ค่าบริการ', amount: '10.555' }],
        })
      ).toThrow();
    });

    it('rejects non-integer or negative peopleCount and expectedVersion', () => {
      expect(() =>
        serializeMeterWorkspaceDirtyRow({
          roomId: 'room-104',
          peopleCount: 1.5,
        })
      ).toThrow();

      expect(() =>
        serializeMeterWorkspaceDirtyRow({
          roomId: 'room-104',
          peopleCount: -1,
        })
      ).toThrow();

      expect(() =>
        serializeMeterWorkspaceDirtyRow({
          roomId: 'room-104',
          expectedVersion: 2.3,
        })
      ).toThrow();

      expect(() =>
        serializeMeterWorkspaceDirtyRow({
          roomId: 'room-104',
          expectedVersion: -1,
        })
      ).toThrow();
    });

    it('serializeMeterWorkspaceDirtyRows converts multiple rows properly', () => {
      const rows = [
        { roomId: 'r1', waterCurr: 10 },
        { roomId: 'r2', elecCurr: 20 },
      ];
      const serialized = serializeMeterWorkspaceDirtyRows(rows);
      expect(serialized).toHaveLength(2);
      expect(serialized[0]).toEqual({ roomId: 'r1', waterCurr: '10' });
      expect(serialized[1]).toEqual({ roomId: 'r2', elecCurr: '20' });
    });
  });

  describe('2. Pull Previous O(1) Network / Scale Invariant', () => {
    it('pullPreviousWorkspace executes exactly 1 GET read call and 0 mutations across all rooms', async () => {
      const meterAdapter = new ApiMeterAdapter();
      const httpModule = await import('../data/httpClient');
      const httpRequestSpy = vi.spyOn(httpModule, 'httpRequest').mockResolvedValue({
        success: true,
        data: {
          hasPreviousCycle: true,
          previousCycleId: 'cycle-prev',
          rooms: Array.from({ length: 150 }, (_, i) => ({
            roomId: `room-${i + 1}`,
            previousWaterCurrentReading: '100.00',
            previousElectricityCurrentReading: '500.00',
            previousCyclePeopleCount: 1,
            currentHouseholdPeopleCount: 1,
          })),
        },
      } as any);

      const result = await meterAdapter.pullPreviousWorkspace('cycle-current');

      expect(httpRequestSpy).toHaveBeenCalledTimes(1);
      expect(httpRequestSpy).toHaveBeenCalledWith('GET', '/meters/workspace/pull-previous?billingCycleId=cycle-current');
      expect(result.success).toBe(true);
      expect((result.data as any).rooms).toHaveLength(150);

      httpRequestSpy.mockRestore();
    });

    it('saveBulkWorkspace executes exactly 1 bulk POST mutation with serialized rows', async () => {
      const meterAdapter = new ApiMeterAdapter();
      const httpModule = await import('../data/httpClient');
      const httpRequestSpy = vi.spyOn(httpModule, 'httpRequest').mockResolvedValue({
        success: true,
        savedCount: 2,
      } as any);

      const result = await meterAdapter.saveBulkWorkspace('cycle-current', [
        { roomId: 'r1', waterCurr: 100, manualOutstandingAmount: 50 },
        { roomId: 'r2', waterCurr: 200, manualOutstandingAmount: 0 },
      ]);

      expect(httpRequestSpy).toHaveBeenCalledTimes(1);
      expect(httpRequestSpy).toHaveBeenCalledWith('POST', '/meters/workspace/bulk', {
        billingCycleId: 'cycle-current',
        rows: [
          { roomId: 'r1', waterCurr: '100', manualOutstandingAmount: '50' },
          { roomId: 'r2', waterCurr: '200', manualOutstandingAmount: '0' },
        ],
      });
      expect(result.success).toBe(true);

      httpRequestSpy.mockRestore();
    });

    it('generateBulkBills executes exactly 1 bulk POST mutation with serialized dirtyRows', async () => {
      const billingAdapter = new ApiBillingAdapter();
      const httpModule = await import('../data/httpClient');
      const httpRequestSpy = vi.spyOn(httpModule, 'httpRequest').mockResolvedValue({
        success: true,
        data: { generatedCount: 1 },
      } as any);

      const result = await billingAdapter.generateBulkBills('cycle-current', ['r1'], [
        { roomId: 'r1', waterCurr: 100, manualOutstandingAmount: 150 },
      ]);

      expect(httpRequestSpy).toHaveBeenCalledTimes(1);
      expect(httpRequestSpy).toHaveBeenCalledWith(
        'POST',
        '/bills/generate/bulk',
        {
          billingCycleId: 'cycle-current',
          roomIds: ['r1'],
          dirtyRows: [{ roomId: 'r1', waterCurr: '100', manualOutstandingAmount: '150' }],
        },
        expect.anything()
      );
      expect(result.success).toBe(true);

      httpRequestSpy.mockRestore();
    });
  });

  describe('3. Concise Household Toast Formatting Invariants', () => {
    function computePullPreviousToast(
      rooms: Array<{
        roomNumber: string;
        previousCyclePeopleCount: number | null;
        currentHouseholdPeopleCount: number;
      }>
    ): string {
      const peopleChanges: Array<{ roomNumber: string; prev: number; curr: number }> = [];

      for (const r of rooms) {
        if (r.previousCyclePeopleCount !== null && r.previousCyclePeopleCount !== undefined) {
          if (r.previousCyclePeopleCount !== r.currentHouseholdPeopleCount) {
            peopleChanges.push({
              roomNumber: r.roomNumber,
              prev: r.previousCyclePeopleCount,
              curr: r.currentHouseholdPeopleCount,
            });
          }
        }
      }

      if (peopleChanges.length === 0) {
        return 'ดึงข้อมูลก่อนหน้าเรียบร้อย';
      }
      if (peopleChanges.length === 1) {
        const c = peopleChanges[0];
        return `${c.roomNumber}: ผู้พัก ${c.prev} → ${c.curr} คน`;
      }
      return `ดึงข้อมูลแล้ว • ผู้พักเปลี่ยน ${peopleChanges.length} ห้อง (ใช้จำนวนปัจจุบัน)`;
    }

    it('formats toast with zero changes', () => {
      expect(
        computePullPreviousToast([
          { roomNumber: 'A101', previousCyclePeopleCount: 1, currentHouseholdPeopleCount: 1 },
        ])
      ).toBe('ดึงข้อมูลก่อนหน้าเรียบร้อย');
    });

    it('formats concise toast with single room change (previous 1 -> current 2)', () => {
      expect(
        computePullPreviousToast([
          { roomNumber: 'A103', previousCyclePeopleCount: 1, currentHouseholdPeopleCount: 2 },
        ])
      ).toBe('A103: ผู้พัก 1 → 2 คน');
    });

    it('does not invent delta when previousCyclePeopleCount is null/unavailable', () => {
      expect(
        computePullPreviousToast([
          { roomNumber: 'A104', previousCyclePeopleCount: null, currentHouseholdPeopleCount: 2 },
        ])
      ).toBe('ดึงข้อมูลก่อนหน้าเรียบร้อย');
    });

    it('formats bounded concise toast with multiple room changes without 150 newlines', () => {
      const multiChanges = Array.from({ length: 12 }, (_, i) => ({
        roomNumber: `A${100 + i}`,
        previousCyclePeopleCount: 1,
        currentHouseholdPeopleCount: 2,
      }));
      expect(computePullPreviousToast(multiChanges)).toBe(
        'ดึงข้อมูลแล้ว • ผู้พักเปลี่ยน 12 ห้อง (ใช้จำนวนปัจจุบัน)'
      );
    });
  });

  describe('4. Button Visibility & Per-Room Utility-Aware Completion Invariant', () => {
    function computeShowPullButton(params: {
      isFirstCycle: boolean;
      previousCycleExists: boolean;
      isSelectedCycleAuthorityReady: boolean;
      isMeterWorkspaceReady: boolean;
      isRateSnapshotReady: boolean;
      isPullCompleted: boolean;
    }): boolean {
      return Boolean(
        params.isSelectedCycleAuthorityReady &&
        params.isFirstCycle === false &&
        params.previousCycleExists &&
        params.isMeterWorkspaceReady &&
        params.isRateSnapshotReady &&
        !params.isPullCompleted
      );
    }

    it('1. global water exists + global electric exists but on different rooms -> NOT completed', async () => {
      const { computeHasPersistedBaseline } = await import('../pages/owner/meters');
      const persisted = computeHasPersistedBaseline({
        isRateSnapshotReady: true,
        isMeterWorkspaceReady: true,
        isWaterUnit: true,
        isElecUnit: true,
        rooms: [{ id: 'r-101' }, { id: 'r-102' }],
        serverReadings: [
          { roomId: 'r-101', meterType: 'water', previousReading: '110.00' },
          { roomId: 'r-102', meterType: 'electricity', previousReading: '460.00' },
        ],
      });
      expect(persisted).toBe(false);
    });

    it('2. one room missing water -> NOT completed', async () => {
      const { computeHasPersistedBaseline } = await import('../pages/owner/meters');
      const persisted = computeHasPersistedBaseline({
        isRateSnapshotReady: true,
        isMeterWorkspaceReady: true,
        isWaterUnit: true,
        isElecUnit: true,
        rooms: [{ id: 'r-101' }, { id: 'r-102' }],
        serverReadings: [
          { roomId: 'r-101', meterType: 'water', previousReading: '110.00' },
          { roomId: 'r-101', meterType: 'electricity', previousReading: '560.00' },
          { roomId: 'r-102', meterType: 'electricity', previousReading: '460.00' },
        ],
      });
      expect(persisted).toBe(false);
    });

    it('3. one room missing electricity -> NOT completed', async () => {
      const { computeHasPersistedBaseline } = await import('../pages/owner/meters');
      const persisted = computeHasPersistedBaseline({
        isRateSnapshotReady: true,
        isMeterWorkspaceReady: true,
        isWaterUnit: true,
        isElecUnit: true,
        rooms: [{ id: 'r-101' }, { id: 'r-102' }],
        serverReadings: [
          { roomId: 'r-101', meterType: 'water', previousReading: '110.00' },
          { roomId: 'r-101', meterType: 'electricity', previousReading: '560.00' },
          { roomId: 'r-102', meterType: 'water', previousReading: '90.00' },
        ],
      });
      expect(persisted).toBe(false);
    });

    it('4. all required baselines on all applicable rooms -> completed', async () => {
      const { computeHasPersistedBaseline } = await import('../pages/owner/meters');
      const persisted = computeHasPersistedBaseline({
        isRateSnapshotReady: true,
        isMeterWorkspaceReady: true,
        isWaterUnit: true,
        isElecUnit: true,
        rooms: [{ id: 'r-101' }, { id: 'r-102' }],
        serverReadings: [
          { roomId: 'r-101', meterType: 'water', previousReading: '110.00' },
          { roomId: 'r-101', meterType: 'electricity', previousReading: '560.00' },
          { roomId: 'r-102', meterType: 'water', previousReading: '90.00' },
          { roomId: 'r-102', meterType: 'electricity', previousReading: '460.00' },
        ],
      });
      expect(persisted).toBe(true);
    });

    it('5. strict validity rules for isResolvedBaseline (0..99999 integer and Postgres Decimal .00)', async () => {
      const { isResolvedBaseline } = await import('../pages/owner/meters');

      // Valid representations
      expect(isResolvedBaseline(0)).toBe(true);
      expect(isResolvedBaseline('0')).toBe(true);
      expect(isResolvedBaseline('0.00')).toBe(true);
      expect(isResolvedBaseline(560)).toBe(true);
      expect(isResolvedBaseline('560')).toBe(true);
      expect(isResolvedBaseline('560.00')).toBe(true);
      expect(isResolvedBaseline(99999)).toBe(true);
      expect(isResolvedBaseline('99999')).toBe(true);
      expect(isResolvedBaseline('99999.00')).toBe(true);

      // Invalid representations
      expect(isResolvedBaseline(12.7)).toBe(false);
      expect(isResolvedBaseline('12.7')).toBe(false);
      expect(isResolvedBaseline('12.70')).toBe(false);
      expect(isResolvedBaseline('12.01')).toBe(false);
      expect(isResolvedBaseline(-1)).toBe(false);
      expect(isResolvedBaseline('-1')).toBe(false);
      expect(isResolvedBaseline(100000)).toBe(false);
      expect(isResolvedBaseline('100000')).toBe(false);
      expect(isResolvedBaseline('100000.00')).toBe(false);
      expect(isResolvedBaseline('abc')).toBe(false);
      expect(isResolvedBaseline(Infinity)).toBe(false);
      expect(isResolvedBaseline('Infinity')).toBe(false);
      expect(isResolvedBaseline(NaN)).toBe(false);
      expect(isResolvedBaseline('NaN')).toBe(false);
      expect(isResolvedBaseline(null)).toBe(false);
      expect(isResolvedBaseline(undefined)).toBe(false);
      expect(isResolvedBaseline('')).toBe(false);
      expect(isResolvedBaseline('   ')).toBe(false);
    });

    it('5b. malformed baseline (e.g. 12.7) prevents full cycle baseline completion', async () => {
      const { computeHasPersistedBaseline } = await import('../pages/owner/meters');
      const persisted = computeHasPersistedBaseline({
        isRateSnapshotReady: true,
        isMeterWorkspaceReady: true,
        isWaterUnit: true,
        isElecUnit: true,
        rooms: [{ id: 'r-101' }],
        serverReadings: [
          { roomId: 'r-101', meterType: 'water', previousReading: '110.00' },
          { roomId: 'r-101', meterType: 'electricity', previousReading: '12.7' }, // Invalid!
        ],
      });
      expect(persisted).toBe(false);
    });

    it('6. fixed water + per_unit electric -> only per_unit electricity requirement', async () => {
      const { computeHasPersistedBaseline } = await import('../pages/owner/meters');
      const missingElec = computeHasPersistedBaseline({
        isRateSnapshotReady: true,
        isMeterWorkspaceReady: true,
        isWaterUnit: false,
        isElecUnit: true,
        rooms: [{ id: 'r-101' }],
        serverReadings: [{ roomId: 'r-101', meterType: 'water', previousReading: '110.00' }],
      });
      expect(missingElec).toBe(false);

      const hasElec = computeHasPersistedBaseline({
        isRateSnapshotReady: true,
        isMeterWorkspaceReady: true,
        isWaterUnit: false,
        isElecUnit: true,
        rooms: [{ id: 'r-101' }],
        serverReadings: [{ roomId: 'r-101', meterType: 'electricity', previousReading: '560.00' }],
      });
      expect(hasElec).toBe(true);
    });

    it('7. non-meter modes (per_person water + fixed electric) do not require meter baseline', async () => {
      const { computeHasPersistedBaseline } = await import('../pages/owner/meters');
      const nonMeter = computeHasPersistedBaseline({
        isRateSnapshotReady: true,
        isMeterWorkspaceReady: true,
        isWaterUnit: false,
        isElecUnit: false,
        rooms: [{ id: 'r-101' }],
        serverReadings: [],
      });
      expect(nonMeter).toBe(true);
    });

    it('8. manual direct baseline save and Pencil override count resolved', async () => {
      const { computeHasPersistedBaseline } = await import('../pages/owner/meters');
      // Direct entry: owner typed 0 for electric and saved -> persisted on server
      const directSave = computeHasPersistedBaseline({
        isRateSnapshotReady: true,
        isMeterWorkspaceReady: true,
        isWaterUnit: true,
        isElecUnit: true,
        rooms: [{ id: 'r-101' }],
        serverReadings: [
          { roomId: 'r-101', meterType: 'water', previousReading: '120.00' },
          { roomId: 'r-101', meterType: 'electricity', previousReading: '0' },
        ],
      });
      expect(directSave).toBe(true);
    });

    it('hides pull button on first cycle', () => {
      expect(
        computeShowPullButton({
          isFirstCycle: true,
          previousCycleExists: false,
          isSelectedCycleAuthorityReady: true,
          isMeterWorkspaceReady: true,
          isRateSnapshotReady: true,
          isPullCompleted: false,
        })
      ).toBe(false);
    });

    it('shows pull button on non-first cycle when prior cycle exists and baseline is not yet completed', () => {
      expect(
        computeShowPullButton({
          isFirstCycle: false,
          previousCycleExists: true,
          isSelectedCycleAuthorityReady: true,
          isMeterWorkspaceReady: true,
          isRateSnapshotReady: true,
          isPullCompleted: false,
        })
      ).toBe(true);
    });

    it('hides pull button when pull has been completed (either in session or persisted baseline)', () => {
      expect(
        computeShowPullButton({
          isFirstCycle: false,
          previousCycleExists: true,
          isSelectedCycleAuthorityReady: true,
          isMeterWorkspaceReady: true,
          isRateSnapshotReady: true,
          isPullCompleted: true,
        })
      ).toBe(false);
    });

    it('hides pull button when no previous cycle exists', () => {
      expect(
        computeShowPullButton({
          isFirstCycle: false,
          previousCycleExists: false,
          isSelectedCycleAuthorityReady: true,
          isMeterWorkspaceReady: true,
          isRateSnapshotReady: true,
          isPullCompleted: false,
        })
      ).toBe(false);
    });
  });

  describe('5. Detail Component Money Formatting & Trigger Rules', () => {
    it('formats whole-baht with compact .- and preserves satang', async () => {
      const { formatComponentDetailAmount } = await import('../pages/owner/meters');
      expect(formatComponentDetailAmount('650.00')).toBe('650.-');
      expect(formatComponentDetailAmount('4800.00')).toBe('4,800.-');
      expect(formatComponentDetailAmount('1200.00')).toBe('1,200.-');
      expect(formatComponentDetailAmount('650.50')).toBe('650.50');
      expect(formatComponentDetailAmount('0.00')).toBe('0.-');
    });

    it('computes trigger labels correctly (0 -> amount only, 1 -> ดูรายละเอียด, N>=2 -> ดูรายละเอียด +N)', () => {
      function getDetailTriggerLabel(count: number): string | null {
        if (count <= 0) return null;
        if (count === 1) return 'ดูรายละเอียด';
        return `ดูรายละเอียด +${count}`;
      }

      expect(getDetailTriggerLabel(0)).toBeNull();
      expect(getDetailTriggerLabel(1)).toBe('ดูรายละเอียด');
      expect(getDetailTriggerLabel(2)).toBe('ดูรายละเอียด +2');
      expect(getDetailTriggerLabel(3)).toBe('ดูรายละเอียด +3');
      expect(getDetailTriggerLabel(5)).toBe('ดูรายละเอียด +5');
    });
  });
});
