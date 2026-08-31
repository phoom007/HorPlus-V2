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

describe('OWNER R3.9-D.1.5: Stale Mutation Error Isolation & Loading-Edit Hydration Safety Suite', () => {
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
      expect((screen.getByTestId('input-tier-rate-water-0') as HTMLInputElement).value).toBe('20.00');
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
      expect(onSave).toHaveBeenCalledWith(validTiers);

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

  describe('3. Stale Mutation Error Isolation (409 & 500)', () => {
    const DORM_A = 'dorm-aaa-111';
    const mockCycleAug = { id: 'cycle-aug', cycleCode: '2026-08', status: 'active' };
    const mockCycleJul = { id: 'cycle-jul', cycleCode: '2026-07', status: 'active' };

    it('Section 7 & 22.A: Stale Old-Cycle 409 does NOT open VersionConflictModal in newly selected cycle', async () => {
      localStorage.setItem('selected_dormitory_id', DORM_A);

      let resolveAugPut: any;
      const augPutPromise = new Promise((res) => { resolveAugPut = res; });

      global.fetch = vi.fn().mockImplementation((url: string, opts: any) => {
        const urlStr = String(url);
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
        return Promise.resolve({ ok: true, json: async () => ({ data: [mockCycleAug, mockCycleJul] }) });
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

      // 1. Trigger August scalar save
      fireEvent.change(screen.getByTestId('input-water-unit-rate'), { target: { value: '25.00' } });
      fireEvent.blur(screen.getByTestId('input-water-unit-rate'));

      // 2. Switch context to July while August PUT is in flight
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

      // 3. Resolve August PUT with 409 Conflict
      resolveAugPut();

      // 4. Verify VersionConflictModal is NOT rendered in July context
      expect(screen.queryByTestId('version-conflict-modal')).toBeNull();
      expect((screen.getByTestId('input-water-unit-rate') as HTMLInputElement).value).toBe('15.00');
    });

    it('Section 9 & 22.B: Same-Current-Cycle 409 DOES open VersionConflictModal', async () => {
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

    it('Section 8 & 22.C: Stale Old-Cycle 500 does NOT pollute newly selected cycle save state or show error', async () => {
      localStorage.setItem('selected_dormitory_id', DORM_A);

      let resolveAugPut: any;
      const augPutPromise = new Promise((res) => { resolveAugPut = res; });

      global.fetch = vi.fn().mockImplementation((url: string, opts: any) => {
        const urlStr = String(url);
        if (urlStr.includes('rate-snapshot')) {
          if (opts?.method === 'PUT') {
            return augPutPromise.then(() => ({
              status: 500,
              ok: false,
              json: async () => ({ error: { message: 'Database connection failed' } }),
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
        return Promise.resolve({ ok: true, json: async () => ({ data: [mockCycleAug, mockCycleJul] }) });
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

      // Switch to July
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

      // Release late 500 error
      resolveAugPut();

      expect(screen.queryByTestId('tier-save-error')).toBeNull();
      expect((screen.getByTestId('input-water-unit-rate') as HTMLInputElement).value).toBe('15.00');
    });
  });

  describe('4. Loading-Edit Hydration Safety & Authority Readiness', () => {
    const DORM_A = 'dorm-aaa-111';
    const AUGUST_ID = 'cycle-id-august-888';
    const mockCycleAug = { id: AUGUST_ID, cycleCode: '2026-08', status: 'active' };
    const mockCycleJul = { id: 'cycle-jul', cycleCode: '2026-07', status: 'active' };

    it('Section 14 & 22.D: Scalar edit before authority load does NOT block incoming authoritative snapshot hydration', async () => {
      localStorage.setItem('selected_dormitory_id', DORM_A);

      const putCalls: any[] = [];
      let resolveAugPromise: any;
      const augDelayPromise = new Promise((res) => { resolveAugPromise = res; });

      global.fetch = vi.fn().mockImplementation((url: string, opts: any) => {
        const urlStr = String(url);
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
        return Promise.resolve({ ok: true, json: async () => ({ data: [mockCycleJul, mockCycleAug] }) });
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

      // Switch to August while August snapshot is delayed
      rerender(
        <OwnerSettings
          onAddLog={vi.fn()}
          onRefreshData={vi.fn()}
          selectedCycle="2026-08"
          availableCycles={[mockCycleJul, mockCycleAug]}
        />
      );

      // Attempt speculative edit and blur while loading
      const waterInput = screen.getByTestId('input-water-unit-rate') as HTMLInputElement;
      fireEvent.change(waterInput, { target: { value: '99.00' } });
      fireEvent.blur(waterInput);

      expect(putCalls.length).toBe(0);

      // Resolve August authority (waterRate: 22.00)
      resolveAugPromise();

      await waitFor(() => {
        expect((screen.getByTestId('input-water-unit-rate') as HTMLInputElement).value).toBe('22.00');
      });

      // Confirms typing latch did not block authoritative snapshot hydration (displays 22.00, NOT 99.00)
      expect((screen.getByTestId('input-water-unit-rate') as HTMLInputElement).value).toBe('22.00');
    });

    it('Section 16 & 22.F: Representative Common Fee control is protected during authority load', async () => {
      localStorage.setItem('selected_dormitory_id', DORM_A);

      let resolveAugPromise: any;
      const augDelayPromise = new Promise((res) => { resolveAugPromise = res; });

      global.fetch = vi.fn().mockImplementation((url: string) => {
        const urlStr = String(url);
        if (urlStr.includes('rate-snapshot')) {
          if (urlStr.includes('2026-07')) {
            return Promise.resolve({
              ok: true,
              json: async () => ({
                data: { cycle: mockCycleJul, rateSnapshot: { version: 1, commonFee: '100.00' } },
              }),
            });
          }
          return augDelayPromise.then(() => ({
            ok: true,
            json: async () => ({
              data: { cycle: mockCycleAug, rateSnapshot: { version: 1, commonFee: '250.00' } },
            }),
          }));
        }
        return Promise.resolve({ ok: true, json: async () => ({ data: [mockCycleJul, mockCycleAug] }) });
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
        expect((screen.getByTestId('input-common-fee') as HTMLInputElement).value).toBe('100.00');
      });

      // Switch to August
      rerender(
        <OwnerSettings
          onAddLog={vi.fn()}
          onRefreshData={vi.fn()}
          selectedCycle="2026-08"
          availableCycles={[mockCycleJul, mockCycleAug]}
        />
      );

      // Resolve August
      resolveAugPromise();

      await waitFor(() => {
        expect((screen.getByTestId('input-common-fee') as HTMLInputElement).value).toBe('250.00');
      });
    });
  });

  describe('5. Body-Phase Stale Response Protection & Raw Durable Sync', () => {
    const DORM_A = 'dorm-aaa-111';
    const DORM_B = 'dorm-bbb-222';
    const mockCycleAug = { id: 'cycle-2026-08', cycleCode: '2026-08', status: 'active' };
    const mockCycleJul = { id: 'cycle-2026-07', cycleCode: '2026-07', status: 'active' };

    it('Section 14 & 31: Body-Phase Stale Response Protection — July fetch headers resolve fast but json delayed -> August wins', async () => {
      localStorage.setItem('selected_dormitory_id', DORM_A);

      let resolveJulyJson: any;
      const julyJsonPromise = new Promise((res) => { resolveJulyJson = res; });

      global.fetch = vi.fn().mockImplementation((url: string) => {
        const urlStr = String(url);
        if (urlStr.includes('rate-snapshot')) {
          if (urlStr.includes('2026-07')) {
            return Promise.resolve({
              ok: true,
              json: () => julyJsonPromise.then(() => ({
                data: {
                  cycle: mockCycleJul,
                  rateSnapshot: { version: 1, waterBillingType: 'tiered', waterTierRates: [{ upTo: null, rate: '99.00' }] },
                },
              })),
            });
          }
          return Promise.resolve({
            ok: true,
            json: async () => ({
              data: {
                cycle: mockCycleAug,
                rateSnapshot: { version: 1, waterBillingType: 'tiered', waterTierRates: [{ upTo: null, rate: '35.00' }] },
              },
            }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({ data: [mockCycleAug, mockCycleJul] }) });
      });

      vi.spyOn(ApiPropertyAdapter.prototype, 'getDormitoryDefaults').mockResolvedValue({
        success: true,
        data: { property: { version: 1 }, billing: { version: 1, waterBillingType: 'tiered' } },
      } as any);

      const { rerender } = render(
        <OwnerSettings
          onAddLog={vi.fn()}
          onRefreshData={vi.fn()}
          selectedCycle="2026-07"
          availableCycles={[mockCycleAug, mockCycleJul]}
        />
      );

      // Fast switch to August while July json is pending
      rerender(
        <OwnerSettings
          onAddLog={vi.fn()}
          onRefreshData={vi.fn()}
          selectedCycle="2026-08"
          availableCycles={[mockCycleAug, mockCycleJul]}
        />
      );

      await waitFor(() => {
        expect((screen.getByTestId('input-tier-rate-water-0') as HTMLInputElement).value).toBe('35.00');
      });

      // Release July json LAST
      resolveJulyJson();

      // August remains authoritative (35.00), stale July parsed body is discarded
      expect((screen.getByTestId('input-tier-rate-water-0') as HTMLInputElement).value).toBe('35.00');
    });

    it('Section 19 & 31: Same-Mount Durable Authority Sync — explicitly saved tiers stay active in durable ref across cycle switches', async () => {
      localStorage.setItem('selected_dormitory_id', DORM_A);

      let durableServerTiers: CanonicalTierRecord[] = [
        { upTo: '10.00', rate: '18.00' },
        { upTo: '20.00', rate: '20.00' },
        { upTo: null, rate: '22.00' },
      ];

      global.fetch = vi.fn().mockImplementation((url: string, opts: any) => {
        const urlStr = String(url);
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
        return Promise.resolve({ ok: true, json: async () => ({ data: [mockCycleAug, mockCycleJul] }) });
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

      // 2. Edit and save new custom tiers (3.40 / 4.25 / 5.00)
      fireEvent.change(screen.getByTestId('input-tier-rate-water-0'), { target: { value: '3.40' } });
      fireEvent.change(screen.getByTestId('input-tier-rate-water-1'), { target: { value: '4.25' } });
      fireEvent.change(screen.getByTestId('input-tier-rate-water-2'), { target: { value: '5.00' } });
      fireEvent.click(screen.getByTestId('btn-save-tiers-water'));

      await waitFor(() => {
        expect(durableServerTiers[0].rate).toBe('3.40');
      });

      // 3. Switch to July (active mode is per_unit) WITHOUT browser reload
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

      // 4. Select Tiered in July -> MUST restore 3.40 / 4.25 / 5.00 from synchronized raw durable ref!
      fireEvent.change(screen.getByTestId('select-water-billing-mode'), { target: { value: 'tiered' } });

      expect((screen.getByTestId('input-tier-rate-water-0') as HTMLInputElement).value).toBe('3.40');
      expect((screen.getByTestId('input-tier-rate-water-1') as HTMLInputElement).value).toBe('4.25');
      expect((screen.getByTestId('input-tier-rate-water-2') as HTMLInputElement).value).toBe('5.00');
    });

    it('Section 25 & 31: In-Flight Old-Dorm Durable Save Response does NOT overwrite new-dorm UI', async () => {
      let resolveDormAPut: any;
      const dormAPutPromise = new Promise((res) => { resolveDormAPut = res; });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { rateSnapshot: { version: 1, waterBillingType: 'per_unit' } } }),
      });

      vi.spyOn(ApiPropertyAdapter.prototype, 'getDormitoryDefaults').mockImplementation(async () => {
        const dormId = localStorage.getItem('selected_dormitory_id');
        if (dormId === DORM_B) {
          return { success: true, data: { property: { version: 1 }, billing: { version: 1, waterTierRates: null } } } as any;
        }
        return { success: true, data: { property: { version: 1 }, billing: { version: 1, waterTierRates: WATER_TIER_PRESET } } } as any;
      });

      vi.spyOn(ApiPropertyAdapter.prototype, 'updateDormitoryDefaults').mockImplementation(async () => {
        await dormAPutPromise;
        return {
          success: true,
          data: { billing: { version: 99, waterTierRates: [{ upTo: null, rate: '999.00' }] } },
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

      // Switch to Tiered and save in Dorm A
      fireEvent.change(screen.getByTestId('select-water-billing-mode'), { target: { value: 'tiered' } });
      fireEvent.click(screen.getByTestId('btn-save-tiers-water'));

      // Switch context to Dorm B while Dorm A defaults PUT is in flight
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

      // Release Dorm A defaults PUT response
      resolveDormAPut();

      // Select Tiered in Dorm B -> MUST show default sample preset (18/20/22), NOT Dorm A late response (999.00)
      fireEvent.change(screen.getByTestId('select-water-billing-mode'), { target: { value: 'tiered' } });
      expect((screen.getByTestId('input-tier-rate-water-0') as HTMLInputElement).value).toBe('18.00');
    });
  });

  describe('6. Multi-Dormitory and Multi-Cycle Context Isolation', () => {
    const DORM_A = 'dorm-aaa-111';
    const DORM_B = 'dorm-bbb-222';
    const mockCycleAug = { id: 'cycle-2026-08', cycleCode: '2026-08', status: 'active' };

    it('Cross-Dorm Isolation: Dorm A tiers (3.40/4.25/5.00) do NOT leak into Dorm B (null tiers)', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            cycle: mockCycleAug,
            rateSnapshot: { version: 1, waterBillingType: 'per_unit', waterTierRates: null },
          },
        }),
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
      expect((screen.getByTestId('input-tier-rate-water-0') as HTMLInputElement).value).toBe('18.00');
    });
  });

  describe('7. User-Visible Failure and Error Banners', () => {
    const DORM_ID = 'dorm-err-1';
    const mockCycle = { id: 'cycle-2026-08', cycleCode: '2026-08', status: 'active' };

    it('Snapshot non-409 failure renders user-visible error banner and does NOT emit success log', async () => {
      localStorage.setItem('selected_dormitory_id', DORM_ID);

      global.fetch = vi.fn().mockImplementation((url: string, opts: any) => {
        const urlStr = String(url);
        if (urlStr.includes('rate-snapshot')) {
          if (opts?.method === 'PUT') {
            return Promise.resolve({
              ok: false,
              status: 500,
              json: async () => ({ error: { message: 'Database connection pool exhausted' } }),
            });
          }
          return Promise.resolve({
            ok: true,
            json: async () => ({
              data: {
                cycle: mockCycle,
                rateSnapshot: { version: 1, waterBillingType: 'tiered', waterTierRates: WATER_TIER_PRESET },
              },
            }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({ data: [mockCycle] }) });
      });

      vi.spyOn(ApiPropertyAdapter.prototype, 'getDormitoryDefaults').mockResolvedValue({
        success: true,
        data: { property: { version: 1 }, billing: { version: 1, waterBillingType: 'tiered', waterTierRates: WATER_TIER_PRESET } },
      } as any);

      vi.spyOn(ApiPropertyAdapter.prototype, 'updateDormitoryDefaults').mockResolvedValue({
        success: true,
        data: { billing: { version: 2, waterTierRates: WATER_TIER_PRESET } },
      } as any);

      const logMock = vi.fn();
      render(
        <OwnerSettings
          onAddLog={logMock}
          onRefreshData={vi.fn()}
          selectedCycle="2026-08"
          availableCycles={[mockCycle]}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('btn-save-tiers-water')).toBeDefined();
      });

      fireEvent.click(screen.getByTestId('btn-save-tiers-water'));

      await waitFor(() => {
        expect(screen.getByTestId('tier-save-error')).toBeDefined();
      });

      expect(screen.getByTestId('tier-save-error').textContent).toContain('Database connection pool exhausted');
      expect(logMock).not.toHaveBeenCalled();
    });

    it('Durable defaults non-conflict failure renders user-visible error banner and blocks snapshot PUT', async () => {
      localStorage.setItem('selected_dormitory_id', DORM_ID);

      let snapshotPutCalled = false;
      global.fetch = vi.fn().mockImplementation((url: string, opts: any) => {
        const urlStr = String(url);
        if (urlStr.includes('rate-snapshot')) {
          if (opts?.method === 'PUT') {
            snapshotPutCalled = true;
          }
          return Promise.resolve({
            ok: true,
            json: async () => ({
              data: {
                cycle: mockCycle,
                rateSnapshot: { version: 1, waterBillingType: 'tiered', waterTierRates: WATER_TIER_PRESET },
              },
            }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({ data: [mockCycle] }) });
      });

      vi.spyOn(ApiPropertyAdapter.prototype, 'getDormitoryDefaults').mockResolvedValue({
        success: true,
        data: { property: { version: 1 }, billing: { version: 1, waterBillingType: 'tiered', waterTierRates: WATER_TIER_PRESET } },
      } as any);

      vi.spyOn(ApiPropertyAdapter.prototype, 'updateDormitoryDefaults').mockResolvedValue({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Disk space full on database server' },
      } as any);

      render(
        <OwnerSettings
          onAddLog={vi.fn()}
          onRefreshData={vi.fn()}
          selectedCycle="2026-08"
          availableCycles={[mockCycle]}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('btn-save-tiers-water')).toBeDefined();
      });

      fireEvent.click(screen.getByTestId('btn-save-tiers-water'));

      await waitFor(() => {
        expect(screen.getByTestId('tier-save-error')).toBeDefined();
      });

      expect(screen.getByTestId('tier-save-error').textContent).toContain('Disk space full on database server');
      expect(snapshotPutCalled).toBe(false);
    });

    it('Retry success clears error banner', async () => {
      localStorage.setItem('selected_dormitory_id', DORM_ID);

      let shouldFail = true;
      global.fetch = vi.fn().mockImplementation((url: string, opts: any) => {
        const urlStr = String(url);
        if (urlStr.includes('rate-snapshot')) {
          if (opts?.method === 'PUT') {
            if (shouldFail) {
              return Promise.resolve({
                ok: false,
                status: 500,
                json: async () => ({ error: { message: 'Temporary network failure' } }),
              });
            }
            return Promise.resolve({
              ok: true,
              json: async () => ({ data: { rateSnapshot: { version: 2, waterBillingType: 'tiered', waterTierRates: WATER_TIER_PRESET } } }),
            });
          }
          return Promise.resolve({
            ok: true,
            json: async () => ({
              data: {
                cycle: mockCycle,
                rateSnapshot: { version: 1, waterBillingType: 'tiered', waterTierRates: WATER_TIER_PRESET },
              },
            }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({ data: [mockCycle] }) });
      });

      vi.spyOn(ApiPropertyAdapter.prototype, 'getDormitoryDefaults').mockResolvedValue({
        success: true,
        data: { property: { version: 1 }, billing: { version: 1, waterBillingType: 'tiered', waterTierRates: WATER_TIER_PRESET } },
      } as any);

      vi.spyOn(ApiPropertyAdapter.prototype, 'updateDormitoryDefaults').mockResolvedValue({
        success: true,
        data: { billing: { version: 2, waterTierRates: WATER_TIER_PRESET } },
      } as any);

      render(
        <OwnerSettings
          onAddLog={vi.fn()}
          onRefreshData={vi.fn()}
          selectedCycle="2026-08"
          availableCycles={[mockCycle]}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('btn-save-tiers-water')).toBeDefined();
      });

      // 1. First attempt fails
      fireEvent.click(screen.getByTestId('btn-save-tiers-water'));

      await waitFor(() => {
        expect(screen.getByTestId('tier-save-error')).toBeDefined();
      });

      // 2. Retry succeeds
      shouldFail = false;
      fireEvent.click(screen.getByTestId('btn-save-tiers-water'));

      await waitFor(() => {
        expect(screen.queryByTestId('tier-save-error')).toBeNull();
      });
    });
  });
});
