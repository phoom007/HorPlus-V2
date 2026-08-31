// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import {
  TieredRateEditor,
  WATER_TIER_PRESET,
  ELECTRICITY_TIER_PRESET,
  CanonicalTierRecord,
} from '../components/settings/TieredRateEditor';
import { OwnerSettings, toCanonicalMode } from '../pages/owner/settings';
import { ApiPropertyAdapter } from '../data/adapters/api';

describe('OWNER R3.9-D.1.7: Save-Status Context Isolation & Stale Lifecycle Closure Suite', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  describe('1. Mode Normalization Authority (toCanonicalMode)', () => {
    it('Normalizes "tiered" to "tiered" for water and electricity', () => {
      expect(toCanonicalMode('tiered', 'water')).toBe('tiered');
      expect(toCanonicalMode('TIERED', 'water')).toBe('tiered');
      expect(toCanonicalMode('tiered', 'electricity')).toBe('tiered');
      expect(toCanonicalMode('TIERED', 'electricity')).toBe('tiered');
    });

    it('Preserves legacy water and electricity modes', () => {
      expect(toCanonicalMode('unit', 'water')).toBe('per_unit');
      expect(toCanonicalMode('per_unit', 'water')).toBe('per_unit');
      expect(toCanonicalMode('person', 'water')).toBe('per_person');
      expect(toCanonicalMode('per_person', 'water')).toBe('per_person');
      expect(toCanonicalMode('fixed', 'water')).toBe('fixed');
      expect(toCanonicalMode('flat', 'water')).toBe('fixed');

      expect(toCanonicalMode('unit', 'electricity')).toBe('per_unit');
      expect(toCanonicalMode('per_unit', 'electricity')).toBe('per_unit');
      expect(toCanonicalMode('person', 'electricity')).toBe('per_person');
      expect(toCanonicalMode('per_person', 'electricity')).toBe('per_person');
      expect(toCanonicalMode('fixed', 'electricity')).toBe('fixed');
    });
  });

  describe('2. TieredRateEditor Component Isolated Behavior & Validation', () => {
    it('Accepts and renders 1 Tier', () => {
      const tiers: CanonicalTierRecord[] = [{ upTo: null, rate: '20.00' }];
      render(<TieredRateEditor utilityType="water" tiers={tiers} onChange={vi.fn()} />);

      expect(screen.getByTestId('tier-row-water-0')).toBeDefined();
      expect(screen.getByTestId('tier-from-water-0').textContent).toBe('1');
      expect(screen.getByTestId('tier-upto-water-0').textContent).toBe('ไม่จำกัด');
      expect((screen.getByTestId('input-tier-rate-water-0') as HTMLInputElement).value).toBe('20');
    });

    it('Accepts up to 5 Tiers & NO "สูงสุด 5 ขั้น" text is shown', () => {
      const fiveTiers: CanonicalTierRecord[] = [
        { upTo: '10', rate: '15.00' },
        { upTo: '20', rate: '18.00' },
        { upTo: '30', rate: '20.00' },
        { upTo: '40', rate: '22.00' },
        { upTo: null, rate: '25.00' },
      ];
      const { container } = render(
        <TieredRateEditor utilityType="water" tiers={fiveTiers} onChange={vi.fn()} />
      );

      expect(screen.queryByTestId('btn-add-tier-water')).toBeNull();
      expect(container.textContent).not.toContain('สูงสุด 5 ขั้น');
      expect(container.textContent).not.toContain('สูงสุด 5');
    });

    it('Rate syntax validation accepts valid and rejects invalid decimals', () => {
      const onSave = vi.fn();
      const validTiers: CanonicalTierRecord[] = [
        { upTo: '10', rate: '0.00' },
        { upTo: null, rate: '3.40' },
      ];

      const { rerender } = render(
        <TieredRateEditor utilityType="water" tiers={validTiers} onChange={vi.fn()} onSave={onSave} />
      );

      fireEvent.click(screen.getByTestId('btn-save-tiers-water'));
      expect(onSave).toHaveBeenCalledWith([
        { upTo: '10.00', rate: '0.00' },
        { upTo: null, rate: '3.40' },
      ]);

      onSave.mockClear();
      const invalidNegative: CanonicalTierRecord[] = [
        { upTo: '10', rate: '-1.00' },
        { upTo: null, rate: '3.40' },
      ];
      rerender(
        <TieredRateEditor utilityType="water" tiers={invalidNegative} onChange={vi.fn()} onSave={onSave} />
      );
      fireEvent.click(screen.getByTestId('btn-save-tiers-water'));
      expect(onSave).not.toHaveBeenCalled();
      expect(screen.getByTestId('alert-tier-error-water')).toBeDefined();
    });
  });

  describe('3. Save-Status Context Isolation & Tier Button Proof', () => {
    const DORM_A = 'dorm-aaa-111';
    const mockCycleAug = { id: 'cycle-aug', cycleCode: '2026-08', status: 'active' };
    const mockCycleJul = { id: 'cycle-jul', cycleCode: '2026-07', status: 'active' };

    it('Section 9, 10: Old In-Flight Save does NOT leave new cycle stuck in saving state; Tier Save button remains usable', async () => {
      localStorage.setItem('selected_dormitory_id', DORM_A);

      let resolveAugSnapshotPut: any;
      const augSnapshotPromise = new Promise((res) => { resolveAugSnapshotPut = res; });

      global.fetch = vi.fn().mockImplementation((url: string, opts: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/api/v1/billing-cycles') && !urlStr.includes('rate-snapshot')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ data: [mockCycleAug, mockCycleJul] }),
          });
        }

        if (urlStr.includes('rate-snapshot')) {
          if (opts?.method === 'PUT') {
            return augSnapshotPromise.then(() => ({
              ok: true,
              json: async () => ({ data: { rateSnapshot: { version: 2 } } }),
            }));
          }
          if (urlStr.includes('2026-07')) {
            return Promise.resolve({
              ok: true,
              json: async () => ({
                data: { cycle: mockCycleJul, rateSnapshot: { version: 1, waterBillingType: 'tiered', waterTierRates: WATER_TIER_PRESET } },
              }),
            });
          }
          return Promise.resolve({
            ok: true,
            json: async () => ({
              data: { cycle: mockCycleAug, rateSnapshot: { version: 1, waterBillingType: 'tiered', waterTierRates: WATER_TIER_PRESET } },
            }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({ data: {} }) });
      });

      vi.spyOn(ApiPropertyAdapter.prototype, 'getDormitoryDefaults').mockResolvedValue({
        success: true,
        data: { property: { version: 1 }, billing: { version: 1, waterBillingType: 'tiered', waterTierRates: WATER_TIER_PRESET } },
      } as any);

      vi.spyOn(ApiPropertyAdapter.prototype, 'updateDormitoryDefaults').mockResolvedValue({
        success: true,
        data: { billing: { version: 2, waterTierRates: WATER_TIER_PRESET } },
      } as any);

      // 1. Mount with August
      const { rerender } = render(
        <OwnerSettings
          onAddLog={vi.fn()}
          onRefreshData={vi.fn()}
          selectedCycle="2026-08"
          availableCycles={[mockCycleAug, mockCycleJul]}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('btn-save-tiers-water')).toBeDefined();
      });

      // 2. Click Save Tiers in August -> enters saving state
      fireEvent.click(screen.getByTestId('btn-save-tiers-water'));

      // 3. Switch to July while August snapshot PUT is pending
      rerender(
        <OwnerSettings
          onAddLog={vi.fn()}
          onRefreshData={vi.fn()}
          selectedCycle="2026-07"
          availableCycles={[mockCycleAug, mockCycleJul]}
        />
      );

      // 4. After July authority loads, verify Tier Save button is NOT disabled by stale isSaving=true
      await waitFor(() => {
        const btn = screen.getByTestId('btn-save-tiers-water') as HTMLButtonElement;
        expect(btn.disabled).toBe(false);
        expect(btn.textContent).not.toContain('กำลังบันทึก');
      });

      // 5. Resolve late August response
      resolveAugSnapshotPut();

      // 6. Verify July Tier Save button remains usable and not stuck in saving
      const btn = screen.getByTestId('btn-save-tiers-water') as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });

    it('Section 12, 13: Stale Old Response does NOT reset active in-flight save in new context', async () => {
      localStorage.setItem('selected_dormitory_id', DORM_A);

      let resolveAugPut: any;
      const augPutPromise = new Promise((res) => { resolveAugPut = res; });

      let resolveJulPut: any;
      const julPutPromise = new Promise((res) => { resolveJulPut = res; });

      global.fetch = vi.fn().mockImplementation((url: string, opts: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/api/v1/billing-cycles') && !urlStr.includes('rate-snapshot')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ data: [mockCycleAug, mockCycleJul] }),
          });
        }

        if (urlStr.includes('rate-snapshot')) {
          if (opts?.method === 'PUT') {
            if (urlStr.includes('cycle-aug') || opts.body.includes('25.00')) {
              return augPutPromise.then(() => ({
                ok: true,
                json: async () => ({ data: { rateSnapshot: { version: 10 } } }),
              }));
            }
            if (urlStr.includes('cycle-jul') || opts.body.includes('30.00')) {
              return julPutPromise.then(() => ({
                ok: true,
                json: async () => ({ data: { rateSnapshot: { version: 6 } } }),
              }));
            }
          }
          if (urlStr.includes('2026-07')) {
            return Promise.resolve({
              ok: true,
              json: async () => ({
                data: { cycle: mockCycleJul, rateSnapshot: { version: 5, waterRate: '15.00' } },
              }),
            });
          }
          return Promise.resolve({
            ok: true,
            json: async () => ({
              data: { cycle: mockCycleAug, rateSnapshot: { version: 1, waterRate: '20.00' } },
            }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({ data: {} }) });
      });

      vi.spyOn(ApiPropertyAdapter.prototype, 'getDormitoryDefaults').mockResolvedValue({
        success: true,
        data: { property: { version: 1 }, billing: { version: 1 } },
      } as any);

      // 1. Mount August
      const { rerender } = render(
        <OwnerSettings
          onAddLog={vi.fn()}
          onRefreshData={vi.fn()}
          selectedCycle="2026-08"
          availableCycles={[mockCycleAug, mockCycleJul]}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('input-water-unit-rate')).toBeDefined();
      });

      // 2. Start August save (August PUT in flight)
      fireEvent.change(screen.getByTestId('input-water-unit-rate'), { target: { value: '25.00' } });
      fireEvent.blur(screen.getByTestId('input-water-unit-rate'));

      // 3. Switch to July
      rerender(
        <OwnerSettings
          onAddLog={vi.fn()}
          onRefreshData={vi.fn()}
          selectedCycle="2026-07"
          availableCycles={[mockCycleAug, mockCycleJul]}
        />
      );

      await waitFor(() => {
        expect((screen.getByTestId('input-water-unit-rate') as HTMLInputElement).value).toBe('15.00');
      });

      // 4. Start legitimate July save (July PUT in flight)
      fireEvent.change(screen.getByTestId('input-water-unit-rate'), { target: { value: '30.00' } });
      fireEvent.blur(screen.getByTestId('input-water-unit-rate'));

      // 5. Release stale August PUT response
      resolveAugPut();

      // 6. Release July PUT response success
      resolveJulPut();

      await waitFor(() => {
        expect(screen.queryByTestId('version-conflict-modal')).toBeNull();
      });
    });
  });

  describe('4. Mutation Body-Phase Stale Guard & Stale 409/500 Isolation', () => {
    const DORM_A = 'dorm-aaa-111';
    const mockCycleAug = { id: 'cycle-aug', cycleCode: '2026-08', status: 'active' };
    const mockCycleJul = { id: 'cycle-jul', cycleCode: '2026-07', status: 'active' };

    it('Section 8 & 23.A: Stale Success where fetch resolves before switch but response.json resolves after switch is IGNORED', async () => {
      localStorage.setItem('selected_dormitory_id', DORM_A);

      let resolveAugJson: any;
      const augJsonPromise = new Promise((res) => { resolveAugJson = res; });
      const logMock = vi.fn();

      global.fetch = vi.fn().mockImplementation((url: string, opts: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/api/v1/billing-cycles') && !urlStr.includes('rate-snapshot')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ data: [mockCycleAug, mockCycleJul] }),
          });
        }

        if (urlStr.includes('rate-snapshot')) {
          if (opts?.method === 'PUT') {
            return Promise.resolve({
              ok: true,
              json: () => augJsonPromise.then(() => ({
                data: {
                  rateSnapshot: {
                    version: 99,
                    waterRate: '99.00',
                    waterBillingType: 'per_unit',
                    source: 'MANUAL_OVERRIDE',
                  },
                },
              })),
            });
          }
          if (urlStr.includes('2026-07')) {
            return Promise.resolve({
              ok: true,
              json: async () => ({
                data: { cycle: mockCycleJul, rateSnapshot: { version: 5, waterRate: '15.00' } },
              }),
            });
          }
          return Promise.resolve({
            ok: true,
            json: async () => ({
              data: { cycle: mockCycleAug, rateSnapshot: { version: 1, waterRate: '20.00' } },
            }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({ data: {} }) });
      });

      vi.spyOn(ApiPropertyAdapter.prototype, 'getDormitoryDefaults').mockResolvedValue({
        success: true,
        data: { property: { version: 1 }, billing: { version: 1 } },
      } as any);

      const { rerender } = render(
        <OwnerSettings
          onAddLog={logMock}
          onRefreshData={vi.fn()}
          selectedCycle="2026-08"
          availableCycles={[mockCycleAug, mockCycleJul]}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('input-water-unit-rate')).toBeDefined();
      });

      fireEvent.change(screen.getByTestId('input-water-unit-rate'), { target: { value: '25.00' } });
      fireEvent.blur(screen.getByTestId('input-water-unit-rate'));

      rerender(
        <OwnerSettings
          onAddLog={logMock}
          onRefreshData={vi.fn()}
          selectedCycle="2026-07"
          availableCycles={[mockCycleAug, mockCycleJul]}
        />
      );

      await waitFor(() => {
        expect((screen.getByTestId('input-water-unit-rate') as HTMLInputElement).value).toBe('15.00');
      });

      resolveAugJson();

      expect((screen.getByTestId('input-water-unit-rate') as HTMLInputElement).value).toBe('15.00');
      expect(logMock).not.toHaveBeenCalled();
    });

    it('Section 9 & 23.B: Stale 500 where fetch resolves before switch but error JSON resolves after switch is IGNORED', async () => {
      localStorage.setItem('selected_dormitory_id', DORM_A);

      let resolveAugErrJson: any;
      const augErrJsonPromise = new Promise((res) => { resolveAugErrJson = res; });

      global.fetch = vi.fn().mockImplementation((url: string, opts: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/api/v1/billing-cycles') && !urlStr.includes('rate-snapshot')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ data: [mockCycleAug, mockCycleJul] }),
          });
        }

        if (urlStr.includes('rate-snapshot')) {
          if (opts?.method === 'PUT') {
            return Promise.resolve({
              status: 500,
              ok: false,
              json: () => augErrJsonPromise.then(() => ({ error: { message: 'Database connection failed' } })),
            });
          }
          if (urlStr.includes('2026-07')) {
            return Promise.resolve({
              ok: true,
              json: async () => ({
                data: { cycle: mockCycleJul, rateSnapshot: { version: 5, waterRate: '15.00' } },
              }),
            });
          }
          return Promise.resolve({
            ok: true,
            json: async () => ({
              data: { cycle: mockCycleAug, rateSnapshot: { version: 1, waterRate: '20.00' } },
            }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({ data: {} }) });
      });

      vi.spyOn(ApiPropertyAdapter.prototype, 'getDormitoryDefaults').mockResolvedValue({
        success: true,
        data: { property: { version: 1 }, billing: { version: 1 } },
      } as any);

      const { rerender } = render(
        <OwnerSettings
          onAddLog={vi.fn()}
          onRefreshData={vi.fn()}
          selectedCycle="2026-08"
          availableCycles={[mockCycleAug, mockCycleJul]}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('input-water-unit-rate')).toBeDefined();
      });

      fireEvent.change(screen.getByTestId('input-water-unit-rate'), { target: { value: '25.00' } });
      fireEvent.blur(screen.getByTestId('input-water-unit-rate'));

      rerender(
        <OwnerSettings
          onAddLog={vi.fn()}
          onRefreshData={vi.fn()}
          selectedCycle="2026-07"
          availableCycles={[mockCycleAug, mockCycleJul]}
        />
      );

      await waitFor(() => {
        expect((screen.getByTestId('input-water-unit-rate') as HTMLInputElement).value).toBe('15.00');
      });

      resolveAugErrJson();

      expect(screen.queryByTestId('tier-save-error')).toBeNull();
      expect((screen.getByTestId('input-water-unit-rate') as HTMLInputElement).value).toBe('15.00');
    });

    it('Section 10 & 23.C: Stale Old-Cycle 409 does NOT open VersionConflictModal in newly selected cycle', async () => {
      localStorage.setItem('selected_dormitory_id', DORM_A);

      let resolveAugPut: any;
      const augPutPromise = new Promise((res) => { resolveAugPut = res; });

      global.fetch = vi.fn().mockImplementation((url: string, opts: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/api/v1/billing-cycles') && !urlStr.includes('rate-snapshot')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ data: [mockCycleAug, mockCycleJul] }),
          });
        }

        if (urlStr.includes('rate-snapshot')) {
          if (opts?.method === 'PUT') {
            return augPutPromise.then(() => ({
              status: 409,
              ok: false,
              json: async () => ({ error: { code: 'VERSION_CONFLICT', message: 'Version conflict on August' } }),
            }));
          }
          if (urlStr.includes('2026-07')) {
            return Promise.resolve({
              ok: true,
              json: async () => ({
                data: { cycle: mockCycleJul, rateSnapshot: { version: 5, waterRate: '15.00' } },
              }),
            });
          }
          return Promise.resolve({
            ok: true,
            json: async () => ({
              data: { cycle: mockCycleAug, rateSnapshot: { version: 1, waterRate: '20.00' } },
            }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({ data: {} }) });
      });

      vi.spyOn(ApiPropertyAdapter.prototype, 'getDormitoryDefaults').mockResolvedValue({
        success: true,
        data: { property: { version: 1 }, billing: { version: 1 } },
      } as any);

      const { rerender } = render(
        <OwnerSettings
          onAddLog={vi.fn()}
          onRefreshData={vi.fn()}
          selectedCycle="2026-08"
          availableCycles={[mockCycleAug, mockCycleJul]}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('input-water-unit-rate')).toBeDefined();
      });

      fireEvent.change(screen.getByTestId('input-water-unit-rate'), { target: { value: '25.00' } });
      fireEvent.blur(screen.getByTestId('input-water-unit-rate'));

      rerender(
        <OwnerSettings
          onAddLog={vi.fn()}
          onRefreshData={vi.fn()}
          selectedCycle="2026-07"
          availableCycles={[mockCycleAug, mockCycleJul]}
        />
      );

      await waitFor(() => {
        expect((screen.getByTestId('input-water-unit-rate') as HTMLInputElement).value).toBe('15.00');
      });

      resolveAugPut();

      expect(screen.queryByTestId('version-conflict-modal')).toBeNull();
      expect((screen.getByTestId('input-water-unit-rate') as HTMLInputElement).value).toBe('15.00');
    });

    it('Section 10 & 23.D: Same-Current-Cycle 409 DOES open VersionConflictModal', async () => {
      localStorage.setItem('selected_dormitory_id', DORM_A);

      global.fetch = vi.fn().mockImplementation((url: string, opts: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/api/v1/billing-cycles') && !urlStr.includes('rate-snapshot')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ data: [mockCycleAug] }),
          });
        }

        if (urlStr.includes('rate-snapshot')) {
          if (opts?.method === 'PUT') {
            return Promise.resolve({
              status: 409,
              ok: false,
              json: async () => ({ error: { code: 'VERSION_CONFLICT', message: 'Version conflict' } }),
            });
          }
          return Promise.resolve({
            ok: true,
            json: async () => ({
              data: { cycle: mockCycleAug, rateSnapshot: { version: 1, waterRate: '20.00' } },
            }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({ data: {} }) });
      });

      vi.spyOn(ApiPropertyAdapter.prototype, 'getDormitoryDefaults').mockResolvedValue({
        success: true,
        data: { property: { version: 1 }, billing: { version: 1 } },
      } as any);

      render(
        <OwnerSettings
          onAddLog={vi.fn()}
          onRefreshData={vi.fn()}
          selectedCycle="2026-08"
          availableCycles={[mockCycleAug]}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('input-water-unit-rate')).toBeDefined();
      });

      fireEvent.change(screen.getByTestId('input-water-unit-rate'), { target: { value: '25.00' } });
      fireEvent.blur(screen.getByTestId('input-water-unit-rate'));

      await waitFor(() => {
        expect(screen.getByTestId('version-conflict-modal')).toBeDefined();
      });
    });
  });

  describe('5. Complete Readiness UX (Parking & Late Fee Selectors)', () => {
    const DORM_A = 'dorm-aaa-111';
    const AUGUST_ID = 'cycle-id-august-888';
    const mockCycleAug = { id: AUGUST_ID, cycleCode: '2026-08', status: 'active' };
    const mockCycleJul = { id: 'cycle-jul', cycleCode: '2026-07', status: 'active' };

    it('Parking mode and Late Fee mode selectors are DISABLED during snapshot loading and ENABLED afterward', async () => {
      localStorage.setItem('selected_dormitory_id', DORM_A);

      let resolveAugPromise: any;
      const augDelayPromise = new Promise((res) => { resolveAugPromise = res; });

      global.fetch = vi.fn().mockImplementation((url: string) => {
        const urlStr = String(url);
        if (urlStr.includes('/api/v1/billing-cycles') && !urlStr.includes('rate-snapshot')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ data: [mockCycleJul, mockCycleAug] }),
          });
        }

        if (urlStr.includes('rate-snapshot')) {
          if (urlStr.includes('2026-07')) {
            return Promise.resolve({
              ok: true,
              json: async () => ({
                data: { cycle: mockCycleJul, rateSnapshot: { version: 1, parkingFeeMode: 'per_room', lateFeeType: 'daily' } },
              }),
            });
          }
          return augDelayPromise.then(() => ({
            ok: true,
            json: async () => ({
              data: { cycle: mockCycleAug, rateSnapshot: { version: 1, parkingFeeMode: 'per_vehicle', lateFeeType: 'fixed' } },
            }),
          }));
        }
        return Promise.resolve({ ok: true, json: async () => ({ data: {} }) });
      });

      vi.spyOn(ApiPropertyAdapter.prototype, 'getDormitoryDefaults').mockResolvedValue({
        success: true,
        data: { property: { version: 1 }, billing: { version: 1 } },
      } as any);

      const { rerender } = render(
        <OwnerSettings
          onAddLog={vi.fn()}
          onRefreshData={vi.fn()}
          selectedCycle="2026-07"
          availableCycles={[mockCycleJul, mockCycleAug]}
        />
      );

      await waitFor(() => {
        expect((screen.getByTestId('select-parking-fee-mode') as HTMLSelectElement).disabled).toBe(false);
      });

      fireEvent.click(screen.getByTestId('toggle-late-fee-section'));
      expect((screen.getByTestId('select-late-fee-type') as HTMLSelectElement).disabled).toBe(false);

      rerender(
        <OwnerSettings
          onAddLog={vi.fn()}
          onRefreshData={vi.fn()}
          selectedCycle="2026-08"
          availableCycles={[mockCycleJul, mockCycleAug]}
        />
      );

      expect((screen.getByTestId('select-parking-fee-mode') as HTMLSelectElement).disabled).toBe(true);
      expect((screen.getByTestId('select-late-fee-type') as HTMLSelectElement).disabled).toBe(true);

      resolveAugPromise();

      await waitFor(() => {
        expect((screen.getByTestId('select-parking-fee-mode') as HTMLSelectElement).disabled).toBe(false);
      });

      expect((screen.getByTestId('select-late-fee-type') as HTMLSelectElement).disabled).toBe(false);
      expect((screen.getByTestId('select-parking-fee-mode') as HTMLSelectElement).value).toBe('per_vehicle');
      expect((screen.getByTestId('select-late-fee-type') as HTMLSelectElement).value).toBe('fixed');
    });

    it('Normal post-load Parking mode mutation targets authoritative endpoint and version', async () => {
      localStorage.setItem('selected_dormitory_id', DORM_A);

      const putCalls: any[] = [];
      global.fetch = vi.fn().mockImplementation((url: string, opts: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/api/v1/billing-cycles') && !urlStr.includes('rate-snapshot')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ data: [mockCycleAug] }),
          });
        }

        if (urlStr.includes('rate-snapshot')) {
          if (opts?.method === 'PUT') {
            putCalls.push({ url: urlStr, body: JSON.parse(opts.body) });
            return Promise.resolve({ ok: true, json: async () => ({ data: { rateSnapshot: { version: 4 } } }) });
          }
          return Promise.resolve({
            ok: true,
            json: async () => ({
              data: { cycle: mockCycleAug, rateSnapshot: { version: 3, parkingFeeMode: 'per_room', lateFeeType: 'daily' } },
            }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({ data: {} }) });
      });

      vi.spyOn(ApiPropertyAdapter.prototype, 'getDormitoryDefaults').mockResolvedValue({
        success: true,
        data: { property: { version: 1 }, billing: { version: 1 } },
      } as any);

      render(
        <OwnerSettings
          onAddLog={vi.fn()}
          onRefreshData={vi.fn()}
          selectedCycle="2026-08"
          availableCycles={[mockCycleAug]}
        />
      );

      await waitFor(() => {
        expect((screen.getByTestId('select-parking-fee-mode') as HTMLSelectElement).disabled).toBe(false);
      });

      fireEvent.change(screen.getByTestId('select-parking-fee-mode'), { target: { value: 'per_person' } });

      await waitFor(() => {
        expect(putCalls.length).toBe(1);
      });

      expect(putCalls[0].url).toContain(AUGUST_ID);
      expect(putCalls[0].body.expectedVersion).toBe(3);
      expect(putCalls[0].body.parkingFeeMode).toBe('per_person');
    });
  });

  describe('6. Loading-Edit Hydration Safety & Authority Readiness', () => {
    const DORM_A = 'dorm-aaa-111';
    const AUGUST_ID = 'cycle-id-august-888';
    const mockCycleAug = { id: AUGUST_ID, cycleCode: '2026-08', status: 'active' };
    const mockCycleJul = { id: 'cycle-jul', cycleCode: '2026-07', status: 'active' };

    it('Scalar edit before authority load does NOT block incoming authoritative snapshot hydration', async () => {
      localStorage.setItem('selected_dormitory_id', DORM_A);

      const putCalls: any[] = [];
      let resolveAugPromise: any;
      const augDelayPromise = new Promise((res) => { resolveAugPromise = res; });

      global.fetch = vi.fn().mockImplementation((url: string, opts: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/api/v1/billing-cycles') && !urlStr.includes('rate-snapshot')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ data: [mockCycleJul, mockCycleAug] }),
          });
        }

        if (urlStr.includes('rate-snapshot')) {
          if (opts?.method === 'PUT') {
            putCalls.push(urlStr);
            return Promise.resolve({ ok: true, json: async () => ({ data: { rateSnapshot: { version: 10 } } }) });
          }

          if (urlStr.includes('2026-07')) {
            return Promise.resolve({
              ok: true,
              json: async () => ({
                data: { cycle: mockCycleJul, rateSnapshot: { version: 4, waterRate: '15.00' } },
              }),
            });
          }

          return augDelayPromise.then(() => ({
            ok: true,
            json: async () => ({
              data: { cycle: mockCycleAug, rateSnapshot: { version: 9, waterRate: '22.00' } },
            }),
          }));
        }
        return Promise.resolve({ ok: true, json: async () => ({ data: {} }) });
      });

      vi.spyOn(ApiPropertyAdapter.prototype, 'getDormitoryDefaults').mockResolvedValue({
        success: true,
        data: { property: { version: 1 }, billing: { version: 1, waterBillingType: 'per_unit' } },
      } as any);

      const { rerender } = render(
        <OwnerSettings
          onAddLog={vi.fn()}
          onRefreshData={vi.fn()}
          selectedCycle="2026-07"
          availableCycles={[mockCycleJul, mockCycleAug]}
        />
      );

      await waitFor(() => {
        expect((screen.getByTestId('input-water-unit-rate') as HTMLInputElement).value).toBe('15.00');
      });

      rerender(
        <OwnerSettings
          onAddLog={vi.fn()}
          onRefreshData={vi.fn()}
          selectedCycle="2026-08"
          availableCycles={[mockCycleJul, mockCycleAug]}
        />
      );

      const waterInput = screen.getByTestId('input-water-unit-rate') as HTMLInputElement;
      fireEvent.change(waterInput, { target: { value: '99.00' } });
      fireEvent.blur(waterInput);

      expect(putCalls.length).toBe(0);

      resolveAugPromise();

      await waitFor(() => {
        expect((screen.getByTestId('input-water-unit-rate') as HTMLInputElement).value).toBe('22.00');
      });

      expect((screen.getByTestId('input-water-unit-rate') as HTMLInputElement).value).toBe('22.00');
    });
  });

  describe('7. Same-Mount Durable Authority Sync & Cross-Dorm Isolation', () => {
    const DORM_A = 'dorm-aaa-111';
    const DORM_B = 'dorm-bbb-222';
    const mockCycleAug = { id: 'cycle-2026-08', cycleCode: '2026-08', status: 'active' };
    const mockCycleJul = { id: 'cycle-2026-07', cycleCode: '2026-07', status: 'active' };

    it('Same-Mount Durable Authority Sync — explicitly saved tiers stay active across cycle switches', async () => {
      localStorage.setItem('selected_dormitory_id', DORM_A);

      let durableServerTiers: CanonicalTierRecord[] = [
        { upTo: '10.00', rate: '18.00' },
        { upTo: '20.00', rate: '20.00' },
        { upTo: null, rate: '22.00' },
      ];

      global.fetch = vi.fn().mockImplementation((url: string, opts: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/api/v1/billing-cycles') && !urlStr.includes('rate-snapshot')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ data: [mockCycleAug, mockCycleJul] }),
          });
        }

        if (urlStr.includes('rate-snapshot')) {
          if (opts?.method === 'PUT') {
            return Promise.resolve({
              ok: true,
              json: async () => ({ data: { rateSnapshot: { version: 2, waterBillingType: 'tiered' } } }),
            });
          }
          if (urlStr.includes('2026-07')) {
            return Promise.resolve({
              ok: true,
              json: async () => ({
                data: { cycle: mockCycleJul, rateSnapshot: { version: 1, waterBillingType: 'per_unit', waterTierRates: null } },
              }),
            });
          }
          return Promise.resolve({
            ok: true,
            json: async () => ({
              data: { cycle: mockCycleAug, rateSnapshot: { version: 1, waterBillingType: 'tiered', waterTierRates: durableServerTiers } },
            }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({ data: {} }) });
      });

      vi.spyOn(ApiPropertyAdapter.prototype, 'getDormitoryDefaults').mockResolvedValue({
        success: true,
        data: { property: { version: 1 }, billing: { version: 1, waterTierRates: durableServerTiers } },
      } as any);

      vi.spyOn(ApiPropertyAdapter.prototype, 'updateDormitoryDefaults').mockImplementation(async (payload: any) => {
        if (payload.billing?.changes?.waterTierRates) {
          durableServerTiers = payload.billing.changes.waterTierRates;
        }
        return {
          success: true,
          data: { billing: { version: 2, waterTierRates: durableServerTiers } },
        } as any;
      });

      const { rerender } = render(
        <OwnerSettings
          onAddLog={vi.fn()}
          onRefreshData={vi.fn()}
          selectedCycle="2026-08"
          availableCycles={[mockCycleAug, mockCycleJul]}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('btn-save-tiers-water')).toBeDefined();
      });

      fireEvent.change(screen.getByTestId('input-tier-rate-water-0'), { target: { value: '3.40' } });
      fireEvent.change(screen.getByTestId('input-tier-rate-water-1'), { target: { value: '4.25' } });
      fireEvent.change(screen.getByTestId('input-tier-rate-water-2'), { target: { value: '5.00' } });
      fireEvent.click(screen.getByTestId('btn-save-tiers-water'));

      await waitFor(() => {
        expect(durableServerTiers[0].rate).toBe('3.40');
      });

      rerender(
        <OwnerSettings
          onAddLog={vi.fn()}
          onRefreshData={vi.fn()}
          selectedCycle="2026-07"
          availableCycles={[mockCycleAug, mockCycleJul]}
        />
      );

      await waitFor(() => {
        const select = screen.getByTestId('select-water-billing-mode') as HTMLSelectElement;
        expect(select.value).toBe('per_unit');
      });

      fireEvent.change(screen.getByTestId('select-water-billing-mode'), { target: { value: 'tiered' } });

      expect((screen.getByTestId('input-tier-rate-water-0') as HTMLInputElement).value).toBe('3.40');
      expect((screen.getByTestId('input-tier-rate-water-1') as HTMLInputElement).value).toBe('4.25');
      expect((screen.getByTestId('input-tier-rate-water-2') as HTMLInputElement).value).toBe('5');
    });

    it('Cross-Dorm Isolation: Dorm A tiers do NOT leak into Dorm B', async () => {
      global.fetch = vi.fn().mockImplementation((url: string) => {
        const urlStr = String(url);
        if (urlStr.includes('/api/v1/billing-cycles') && !urlStr.includes('rate-snapshot')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ data: [mockCycleAug] }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              cycle: mockCycleAug,
              rateSnapshot: { version: 1, waterBillingType: 'per_unit', waterTierRates: null },
            },
          }),
        });
      });

      vi.spyOn(ApiPropertyAdapter.prototype, 'getDormitoryDefaults').mockImplementation(async () => {
        const currentDormId = localStorage.getItem('selected_dormitory_id');
        if (currentDormId === DORM_B) {
          return {
            success: true,
            data: { property: { version: 1 }, billing: { version: 1, waterBillingType: 'per_unit', waterTierRates: null } },
          } as any;
        }
        return {
          success: true,
          data: {
            property: { version: 1 },
            billing: {
              version: 1,
              waterBillingType: 'per_unit',
              waterTierRates: [
                { upTo: '10.00', rate: '3.40' },
                { upTo: '20.00', rate: '4.25' },
                { upTo: null, rate: '5.00' },
              ],
            },
          },
        } as any;
      });

      localStorage.setItem('selected_dormitory_id', DORM_A);
      const { rerender } = render(
        <OwnerSettings
          onAddLog={vi.fn()}
          onRefreshData={vi.fn()}
          selectedCycle="2026-08"
          availableCycles={[mockCycleAug]}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('select-water-billing-mode')).toBeDefined();
      });

      fireEvent.change(screen.getByTestId('select-water-billing-mode'), { target: { value: 'tiered' } });
      expect((screen.getByTestId('input-tier-rate-water-0') as HTMLInputElement).value).toBe('3.40');

      localStorage.setItem('selected_dormitory_id', DORM_B);
      rerender(
        <OwnerSettings
          onAddLog={vi.fn()}
          onRefreshData={vi.fn()}
          selectedCycle="2026-08"
          availableCycles={[mockCycleAug]}
        />
      );

      await waitFor(() => {
        const select = screen.getByTestId('select-water-billing-mode') as HTMLSelectElement;
        expect(select.value).toBe('per_unit');
      });

      fireEvent.change(screen.getByTestId('select-water-billing-mode'), { target: { value: 'tiered' } });
      expect((screen.getByTestId('input-tier-rate-water-0') as HTMLInputElement).value).toBe('18');
    });
  });
});
