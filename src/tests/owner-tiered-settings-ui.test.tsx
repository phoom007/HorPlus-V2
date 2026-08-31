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

describe('OWNER R3.9-D.1: Tiered Rate Editor & Settings UI Suite', () => {
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
    it('A. Normalizes "tiered" to "tiered" for water', () => {
      expect(toCanonicalMode('tiered', 'water')).toBe('tiered');
      expect(toCanonicalMode('TIERED', 'water')).toBe('tiered');
    });

    it('B. Normalizes "tiered" to "tiered" for electricity', () => {
      expect(toCanonicalMode('tiered', 'electricity')).toBe('tiered');
      expect(toCanonicalMode('TIERED', 'electricity')).toBe('tiered');
    });

    it('Preserves legacy water and electricity modes (per_unit, per_person, fixed)', () => {
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

    it('Preserves common, internet, parking, and late fee modes', () => {
      expect(toCanonicalMode('free', 'common')).toBe('free');
      expect(toCanonicalMode('room', 'common')).toBe('per_room');
      expect(toCanonicalMode('person', 'common')).toBe('per_person');

      expect(toCanonicalMode('free', 'internet')).toBe('free');
      expect(toCanonicalMode('room', 'internet')).toBe('per_room');

      expect(toCanonicalMode('vehicle', 'parking')).toBe('per_vehicle');
      expect(toCanonicalMode('free', 'parking')).toBe('free');

      expect(toCanonicalMode('none', 'late')).toBe('none');
      expect(toCanonicalMode('daily', 'late')).toBe('daily');
      expect(toCanonicalMode('fixed', 'late')).toBe('fixed');
      expect(toCanonicalMode('percentage', 'late')).toBe('percentage');
    });
  });

  describe('2. TieredRateEditor Component Isolated Behavior', () => {
    it('F. Accepts and renders 1 Tier', () => {
      const tiers: CanonicalTierRecord[] = [{ upTo: null, rate: '20.00' }];
      render(<TieredRateEditor utilityType="water" tiers={tiers} onChange={vi.fn()} />);

      expect(screen.getByTestId('tier-row-water-0')).toBeDefined();
      expect(screen.getByTestId('tier-from-water-0').textContent).toBe('1');
      expect(screen.getByTestId('tier-upto-water-0').textContent).toBe('ไม่จำกัด');
      expect((screen.getByTestId('input-tier-rate-water-0') as HTMLInputElement).value).toBe('20.00');

      // Cannot delete single tier
      expect(screen.queryByTestId('btn-remove-tier-water-0')).toBeNull();
    });

    it('G. Accepts and renders up to 5 Tiers with integer contiguous boundaries', () => {
      const fiveTiers: CanonicalTierRecord[] = [
        { upTo: '10', rate: '15.00' },
        { upTo: '20', rate: '18.00' },
        { upTo: '30', rate: '20.00' },
        { upTo: '40', rate: '22.00' },
        { upTo: null, rate: '25.00' },
      ];
      render(<TieredRateEditor utilityType="water" tiers={fiveTiers} onChange={vi.fn()} />);

      expect(screen.getByTestId('tier-from-water-0').textContent).toBe('1');
      expect(screen.getByTestId('tier-from-water-1').textContent).toBe('11');
      expect(screen.getByTestId('tier-from-water-2').textContent).toBe('21');
      expect(screen.getByTestId('tier-from-water-3').textContent).toBe('31');
      expect(screen.getByTestId('tier-from-water-4').textContent).toBe('41');
      expect(screen.getByTestId('tier-upto-water-4').textContent).toBe('ไม่จำกัด');
    });

    it('H. 6th Tier cannot be added through UI & NO "สูงสุด 5 ขั้น" text is shown', () => {
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

      // Add tier button is not rendered / disabled at 5 tiers
      expect(screen.queryByTestId('btn-add-tier-water')).toBeNull();

      // Section 8 Mandate: Absolutely NO user-facing explanatory copy "สูงสุด 5 ขั้น"
      expect(container.textContent).not.toContain('สูงสุด 5 ขั้น');
      expect(container.textContent).not.toContain('สูงสุด 5');
    });

    it('I. Fractional boundary is flagged with an error upon input', () => {
      const tiers: CanonicalTierRecord[] = [
        { upTo: '10', rate: '18.00' },
        { upTo: null, rate: '22.00' },
      ];
      const onChange = vi.fn();
      render(<TieredRateEditor utilityType="water" tiers={tiers} onChange={onChange} />);

      const inputUpTo = screen.getByTestId('input-tier-upto-water-0') as HTMLInputElement;
      fireEvent.change(inputUpTo, { target: { value: '10.5' } });

      expect(screen.getByText(/หน่วยสูงสุดต้องเป็นจำนวนเต็มบวกเท่านั้น/)).toBeDefined();
    });

    it('J. Final Tier is strictly unlimited with upTo null', () => {
      const tiers: CanonicalTierRecord[] = [
        { upTo: '10', rate: '18.00' },
        { upTo: '20', rate: '20.00' },
        { upTo: null, rate: '22.00' },
      ];
      render(<TieredRateEditor utilityType="water" tiers={tiers} onChange={vi.fn()} />);

      const lastTierBadge = screen.getByTestId('tier-upto-water-2');
      expect(lastTierBadge.textContent).toBe('ไม่จำกัด');
      expect(screen.queryByTestId('input-tier-upto-water-2')).toBeNull();
    });

    it('L. Saved zero tier rate remains 0.00', () => {
      const tiers: CanonicalTierRecord[] = [
        { upTo: '10', rate: '0.00' },
        { upTo: null, rate: '0.00' },
      ];
      render(<TieredRateEditor utilityType="water" tiers={tiers} onChange={vi.fn()} />);

      const rate0 = screen.getByTestId('input-tier-rate-water-0') as HTMLInputElement;
      const rate1 = screen.getByTestId('input-tier-rate-water-1') as HTMLInputElement;
      expect(rate0.value).toBe('0.00');
      expect(rate1.value).toBe('0.00');
    });

    it('Reset button restores sample preset into draft without auto-saving', () => {
      const customTiers: CanonicalTierRecord[] = [
        { upTo: '5', rate: '10.00' },
        { upTo: null, rate: '12.00' },
      ];
      const onChange = vi.fn();
      render(<TieredRateEditor utilityType="water" tiers={customTiers} onChange={onChange} />);

      const resetBtn = screen.getByTestId('btn-reset-preset-water');
      fireEvent.click(resetBtn);

      expect(onChange).toHaveBeenCalledWith(WATER_TIER_PRESET);
    });
  });

  describe('3. Owner Settings Full Integration & Round-Trip', () => {
    const DORM_ID = 'dorm-test-123';
    const mockCycle = { id: 'cycle-1', cycleCode: '2026-08', status: 'active' };

    const setupMocks = (initialSnapshot: any, initialDefaults?: any) => {
      localStorage.setItem('selected_dormitory_id', DORM_ID);

      // Mock fetch
      global.fetch = vi.fn().mockImplementation((url: string, opts: any) => {
        const urlStr = String(url);

        if (urlStr.includes('/api/v1/billing-cycles') && !urlStr.includes('rate-snapshot')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ data: [mockCycle] }),
          });
        }

        if (urlStr.includes('rate-snapshot')) {
          if (opts?.method === 'PUT') {
            const body = JSON.parse(opts.body);
            return Promise.resolve({
              ok: true,
              json: async () => ({
                data: {
                  rateSnapshot: {
                    ...initialSnapshot,
                    ...body,
                    version: (body.expectedVersion || 1) + 1,
                  },
                },
              }),
            });
          }

          return Promise.resolve({
            ok: true,
            json: async () => ({
              data: {
                cycle: mockCycle,
                rateSnapshot: initialSnapshot,
                isLocked: false,
                lockReason: null,
              },
            }),
          });
        }

        return Promise.resolve({
          ok: true,
          json: async () => ({ data: {} }),
        });
      });

      // Mock DataProvider.properties.getDormitoryDefaults
      vi.spyOn(ApiPropertyAdapter.prototype, 'getDormitoryDefaults').mockResolvedValue({
        success: true,
        data: initialDefaults || {
          property: { version: 1, defaultMonthlyRent: 3000 },
          billing: {
            version: 1,
            waterRate: '18.00',
            waterBillingType: initialSnapshot?.waterBillingType || 'per_unit',
            waterTierRates: initialSnapshot?.waterTierRates || null,
            electricityRate: '8.00',
            electricityBillingType: initialSnapshot?.electricityBillingType || 'per_unit',
            electricityTierRates: initialSnapshot?.electricityTierRates || null,
          },
        },
      } as any);

      vi.spyOn(ApiPropertyAdapter.prototype, 'updateDormitoryDefaults').mockResolvedValue({
        success: true,
        data: {},
      } as any);
    };

    it('C. Water and Electricity mode switches operate completely independently', async () => {
      setupMocks({
        version: 1,
        waterBillingType: 'per_unit',
        waterRate: '18.00',
        electricityBillingType: 'per_unit',
        electricityRate: '8.00',
      });

      render(
        <OwnerSettings
          onAddLog={vi.fn()}
          onRefreshData={vi.fn()}
          selectedCycle="2026-08"
          availableCycles={[mockCycle]}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('select-water-billing-mode')).toBeDefined();
      });

      const waterSelect = screen.getByTestId('select-water-billing-mode') as HTMLSelectElement;
      const electricSelect = screen.getByTestId('select-electric-billing-mode') as HTMLSelectElement;

      // Switch Water to tiered
      fireEvent.change(waterSelect, { target: { value: 'tiered' } });
      expect(waterSelect.value).toBe('tiered');
      expect(electricSelect.value).toBe('per_unit');

      // Water Tiered editor is visible, Electricity Tiered editor is NOT
      expect(screen.getByTestId('tiered-rate-editor-water')).toBeDefined();
      expect(screen.queryByTestId('tiered-rate-editor-electricity')).toBeNull();
    });

    it('D. Loads persisted Water Tiered and renders tiers correctly', async () => {
      const persistedTiers: CanonicalTierRecord[] = [
        { upTo: '10.00', rate: '3.40' },
        { upTo: '20.00', rate: '4.25' },
        { upTo: null, rate: '5.00' },
      ];

      setupMocks({
        version: 1,
        waterBillingType: 'tiered',
        waterTierRates: persistedTiers,
        electricityBillingType: 'per_unit',
        electricityRate: '7.00',
      });

      render(
        <OwnerSettings
          onAddLog={vi.fn()}
          onRefreshData={vi.fn()}
          selectedCycle="2026-08"
          availableCycles={[mockCycle]}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('tiered-rate-editor-water')).toBeDefined();
      });

      expect((screen.getByTestId('input-tier-rate-water-0') as HTMLInputElement).value).toBe('3.40');
      expect((screen.getByTestId('input-tier-rate-water-1') as HTMLInputElement).value).toBe('4.25');
      expect((screen.getByTestId('input-tier-rate-water-2') as HTMLInputElement).value).toBe('5.00');
    });

    it('E. Loads persisted Electricity Tiered and renders tiers correctly', async () => {
      const persistedElectricTiers: CanonicalTierRecord[] = [
        { upTo: '50.00', rate: '7.00' },
        { upTo: '150.00', rate: '8.00' },
        { upTo: null, rate: '9.00' },
      ];

      setupMocks({
        version: 1,
        waterBillingType: 'per_unit',
        waterRate: '18.00',
        electricityBillingType: 'tiered',
        electricityTierRates: persistedElectricTiers,
      });

      render(
        <OwnerSettings
          onAddLog={vi.fn()}
          onRefreshData={vi.fn()}
          selectedCycle="2026-08"
          availableCycles={[mockCycle]}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('tiered-rate-editor-electricity')).toBeDefined();
      });

      expect((screen.getByTestId('input-tier-rate-electricity-0') as HTMLInputElement).value).toBe('7.00');
      expect((screen.getByTestId('input-tier-rate-electricity-1') as HTMLInputElement).value).toBe('8.00');
      expect((screen.getByTestId('input-tier-rate-electricity-2') as HTMLInputElement).value).toBe('9.00');
    });

    it('K & Section 31: Full Water Tiered Save, Switch to per_unit, and Switch Back Retention', async () => {
      const initialTiers: CanonicalTierRecord[] = [
        { upTo: '10.00', rate: '3.40' },
        { upTo: '20.00', rate: '4.25' },
        { upTo: null, rate: '5.00' },
      ];

      setupMocks({
        version: 1,
        waterBillingType: 'tiered',
        waterTierRates: initialTiers,
        electricityBillingType: 'per_unit',
        electricityRate: '7.00',
      });

      render(
        <OwnerSettings
          onAddLog={vi.fn()}
          onRefreshData={vi.fn()}
          selectedCycle="2026-08"
          availableCycles={[mockCycle]}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('tiered-rate-editor-water')).toBeDefined();
      });

      // 1. Explicitly save updated tiers (3.40 / 4.25 / 5.00)
      const saveTiersBtn = screen.getByTestId('btn-save-tiers-water');
      fireEvent.click(saveTiersBtn);

      await waitFor(() => {
        const lastFetchCall = (global.fetch as any).mock.calls.find((call: any) =>
          String(call[0]).includes('rate-snapshot') && call[1]?.method === 'PUT'
        );
        expect(lastFetchCall).toBeDefined();
        const payload = JSON.parse(lastFetchCall[1].body);
        expect(payload.waterBillingType).toBe('tiered');
        expect(payload.waterTierRates).toEqual(initialTiers);
      });

      // 2. Switch Water away to per_unit
      const waterSelect = screen.getByTestId('select-water-billing-mode') as HTMLSelectElement;
      fireEvent.change(waterSelect, { target: { value: 'per_unit' } });
      expect(waterSelect.value).toBe('per_unit');
      expect(screen.queryByTestId('tiered-rate-editor-water')).toBeNull();

      // Verify active snapshot payload for non-tiered cycle sends waterTierRates: null
      await waitFor(() => {
        const putCalls = (global.fetch as any).mock.calls.filter((call: any) =>
          String(call[0]).includes('rate-snapshot') && call[1]?.method === 'PUT'
        );
        const latestPut = putCalls[putCalls.length - 1];
        const payload = JSON.parse(latestPut[1].body);
        expect(payload.waterBillingType).toBe('per_unit');
        expect(payload.waterTierRates).toBeNull();
      });

      // 3. Switch Water back to tiered -> Previous tier values restored in draft
      fireEvent.change(waterSelect, { target: { value: 'tiered' } });
      expect(waterSelect.value).toBe('tiered');
      expect(screen.getByTestId('tiered-rate-editor-water')).toBeDefined();

      expect((screen.getByTestId('input-tier-rate-water-0') as HTMLInputElement).value).toBe('3.40');
      expect((screen.getByTestId('input-tier-rate-water-1') as HTMLInputElement).value).toBe('4.25');
      expect((screen.getByTestId('input-tier-rate-water-2') as HTMLInputElement).value).toBe('5.00');
    });

    it('Section 32: Independent Electricity Tiered Persistence & Round-Trip', async () => {
      const initialElectricTiers: CanonicalTierRecord[] = [
        { upTo: '50.00', rate: '7.00' },
        { upTo: '150.00', rate: '8.00' },
        { upTo: null, rate: '9.00' },
      ];

      setupMocks({
        version: 1,
        waterBillingType: 'per_unit',
        waterRate: '18.00',
        electricityBillingType: 'tiered',
        electricityTierRates: initialElectricTiers,
      });

      render(
        <OwnerSettings
          onAddLog={vi.fn()}
          onRefreshData={vi.fn()}
          selectedCycle="2026-08"
          availableCycles={[mockCycle]}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('tiered-rate-editor-electricity')).toBeDefined();
      });

      const saveTiersBtn = screen.getByTestId('btn-save-tiers-electricity');
      fireEvent.click(saveTiersBtn);

      await waitFor(() => {
        const lastFetchCall = (global.fetch as any).mock.calls.find((call: any) =>
          String(call[0]).includes('rate-snapshot') && call[1]?.method === 'PUT'
        );
        expect(lastFetchCall).toBeDefined();
        const payload = JSON.parse(lastFetchCall[1].body);
        expect(payload.electricityBillingType).toBe('tiered');
        expect(payload.electricityTierRates).toEqual(initialElectricTiers);
      });
    });

    it('Locked Cycle renders Tiered editor inputs and controls as disabled', async () => {
      localStorage.setItem('selected_dormitory_id', DORM_ID);
      global.fetch = vi.fn().mockImplementation((url: string) => {
        const urlStr = String(url);
        if (urlStr.includes('rate-snapshot')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              data: {
                cycle: mockCycle,
                rateSnapshot: {
                  version: 1,
                  waterBillingType: 'tiered',
                  waterTierRates: WATER_TIER_PRESET,
                  electricityBillingType: 'per_unit',
                },
                isLocked: true,
                lockReason: 'Cycle locked for testing',
              },
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: [mockCycle] }),
        });
      });

      render(
        <OwnerSettings
          onAddLog={vi.fn()}
          onRefreshData={vi.fn()}
          selectedCycle="2026-08"
          availableCycles={[mockCycle]}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('cycle-locked-banner')).toBeDefined();
        expect(screen.getByTestId('tiered-rate-editor-water')).toBeDefined();
      });

      const rateInput = screen.getByTestId('input-tier-rate-water-0') as HTMLInputElement;
      expect(rateInput.disabled).toBe(true);

      const resetBtn = screen.getByTestId('btn-reset-preset-water') as HTMLButtonElement;
      expect(resetBtn.disabled).toBe(true);
    });
  });
});
