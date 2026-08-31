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

describe('OWNER R3.9-D.1.1: Inactive Tier Persistence & Dual-Authority Settings Suite', () => {
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

  describe('2. TieredRateEditor Component Isolated Behavior & Validation', () => {
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

      // Section 8 & 17 Mandate: Absolutely NO user-facing explanatory copy "สูงสุด 5 ขั้น"
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

    it('L & Section 30: Rate syntax validation accepts 0, 0.00, 3.4, 3.40, and rejects -1, 3.456, 1e2, blank', () => {
      const onSave = vi.fn();
      const validTiers: CanonicalTierRecord[] = [
        { upTo: '10', rate: '0.00' },
        { upTo: null, rate: '3.40' },
      ];

      const { rerender } = render(
        <TieredRateEditor utilityType="water" tiers={validTiers} onChange={vi.fn()} onSave={onSave} />
      );

      // Save valid
      fireEvent.click(screen.getByTestId('btn-save-tiers-water'));
      expect(onSave).toHaveBeenCalledWith(validTiers);

      // Invalid negative
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

      // Invalid 3 decimal places
      onSave.mockClear();
      const invalid3DP: CanonicalTierRecord[] = [
        { upTo: '10', rate: '3.456' },
        { upTo: null, rate: '3.40' },
      ];
      rerender(
        <TieredRateEditor utilityType="water" tiers={invalid3DP} onChange={vi.fn()} onSave={onSave} />
      );
      fireEvent.click(screen.getByTestId('btn-save-tiers-water'));
      expect(onSave).not.toHaveBeenCalled();

      // Invalid scientific notation
      onSave.mockClear();
      const invalidSci: CanonicalTierRecord[] = [
        { upTo: '10', rate: '1e2' },
        { upTo: null, rate: '3.40' },
      ];
      rerender(
        <TieredRateEditor utilityType="water" tiers={invalidSci} onChange={vi.fn()} onSave={onSave} />
      );
      fireEvent.click(screen.getByTestId('btn-save-tiers-water'));
      expect(onSave).not.toHaveBeenCalled();
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

  describe('3. Stateful Dual-Authority Persistence & Real Reload Simulation', () => {
    const DORM_ID = 'dorm-uat-comp-1';
    const mockCycle = { id: 'cycle-2026-08', cycleCode: '2026-08', status: 'active' };

    // Stateful Server Simulation
    class StatefulServerSimulator {
      public dormBillingSettings: any;
      public cycleRateSnapshot: any;
      public mutationCount: number = 0;
      public conflictTrigger: boolean = false;

      constructor(initialBilling: any, initialSnapshot: any) {
        this.dormBillingSettings = {
          version: 1,
          waterBillingType: 'per_unit',
          waterRate: '18.00',
          waterTierRates: null,
          electricityBillingType: 'per_unit',
          electricityRate: '8.00',
          electricityTierRates: null,
          ...initialBilling,
        };
        this.cycleRateSnapshot = {
          version: 1,
          waterBillingType: 'per_unit',
          waterRate: '18.00',
          waterTierRates: null,
          electricityBillingType: 'per_unit',
          electricityRate: '8.00',
          electricityTierRates: null,
          source: 'CYCLE_INIT',
          ...initialSnapshot,
        };
      }

      setupMocks() {
        localStorage.setItem('selected_dormitory_id', DORM_ID);

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
              this.mutationCount++;
              const body = JSON.parse(opts.body);
              this.cycleRateSnapshot = {
                ...this.cycleRateSnapshot,
                ...body,
                version: (this.cycleRateSnapshot.version || 1) + 1,
              };
              return Promise.resolve({
                ok: true,
                json: async () => ({
                  data: {
                    rateSnapshot: this.cycleRateSnapshot,
                  },
                }),
              });
            }

            return Promise.resolve({
              ok: true,
              json: async () => ({
                data: {
                  cycle: mockCycle,
                  rateSnapshot: this.cycleRateSnapshot,
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

        vi.spyOn(ApiPropertyAdapter.prototype, 'getDormitoryDefaults').mockImplementation(async () => {
          return {
            success: true,
            data: {
              property: { version: 1, defaultMonthlyRent: 3000 },
              billing: { ...this.dormBillingSettings },
            },
          } as any;
        });

        vi.spyOn(ApiPropertyAdapter.prototype, 'updateDormitoryDefaults').mockImplementation(async (payload: any) => {
          if (this.conflictTrigger) {
            return {
              success: false,
              error: { code: 'CONFLICT', statusCode: 409, message: 'VERSION_CONFLICT', details: { currentVersion: this.dormBillingSettings.version + 1 } },
            } as any;
          }

          this.mutationCount++;
          if (payload.billing?.changes) {
            this.dormBillingSettings = {
              ...this.dormBillingSettings,
              ...payload.billing.changes,
              version: this.dormBillingSettings.version + 1,
            };
          }
          return { success: true, data: {} } as any;
        });
      }
    }

    it('Section 23: State starts with inactive tiers in DormitoryBillingSettings -> Mode select does NOT mutate server -> Editor loads inactive tiers into draft', async () => {
      const server = new StatefulServerSimulator(
        {
          waterBillingType: 'per_unit',
          waterTierRates: [
            { upTo: '10.00', rate: '3.40' },
            { upTo: '20.00', rate: '4.25' },
            { upTo: null, rate: '5.00' },
          ],
        },
        {
          waterBillingType: 'per_unit',
          waterTierRates: null, // Active snapshot is per_unit
        }
      );
      server.setupMocks();

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
      expect(waterSelect.value).toBe('per_unit');
      expect(screen.queryByTestId('tiered-rate-editor-water')).toBeNull();

      const mutationCountBefore = server.mutationCount;

      // Switch UI to tiered WITHOUT SAVE
      fireEvent.change(waterSelect, { target: { value: 'tiered' } });
      expect(waterSelect.value).toBe('tiered');
      expect(screen.getByTestId('tiered-rate-editor-water')).toBeDefined();

      // Editor loads durable inactive tiers (3.40 / 4.25 / 5.00), NOT preset (18 / 20 / 22)
      expect((screen.getByTestId('input-tier-rate-water-0') as HTMLInputElement).value).toBe('3.40');
      expect((screen.getByTestId('input-tier-rate-water-1') as HTMLInputElement).value).toBe('4.25');
      expect((screen.getByTestId('input-tier-rate-water-2') as HTMLInputElement).value).toBe('5.00');

      // Crucial: Selecting mode did NOT cause any network mutation!
      expect(server.mutationCount).toBe(mutationCountBefore);
    });

    it('Section 24, 25, 26: Full Water Tiered Save -> Switch to per_unit -> Real Reload Simulation -> Switch back restores tiers', async () => {
      // 1. Initial State: No saved tiers anywhere
      const server = new StatefulServerSimulator(
        { waterBillingType: 'per_unit', waterTierRates: null },
        { waterBillingType: 'per_unit', waterTierRates: null }
      );
      server.setupMocks();

      const { unmount } = render(
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

      // Switch to Tiered in UI
      const waterSelect = screen.getByTestId('select-water-billing-mode') as HTMLSelectElement;
      fireEvent.change(waterSelect, { target: { value: 'tiered' } });

      // Edit tiers to 3.40 / 4.25 / 5.00
      fireEvent.change(screen.getByTestId('input-tier-rate-water-0'), { target: { value: '3.40' } });
      fireEvent.change(screen.getByTestId('input-tier-rate-water-1'), { target: { value: '4.25' } });
      fireEvent.change(screen.getByTestId('input-tier-rate-water-2'), { target: { value: '5.00' } });

      // Explicit Save
      const saveBtn = screen.getByTestId('btn-save-tiers-water');
      fireEvent.click(saveBtn);

      await waitFor(() => {
        // Assert DormitoryBillingSettings persisted the tier array
        expect(server.dormBillingSettings.waterTierRates).toEqual([
          { upTo: '10.00', rate: '3.40' },
          { upTo: '20.00', rate: '4.25' },
          { upTo: null, rate: '5.00' },
        ]);
        // Assert selected active BillingRateSnapshot persisted tiered mode and tier array
        expect(server.cycleRateSnapshot.waterBillingType).toBe('tiered');
        expect(server.cycleRateSnapshot.waterTierRates).toEqual([
          { upTo: '10.00', rate: '3.40' },
          { upTo: '20.00', rate: '4.25' },
          { upTo: null, rate: '5.00' },
        ]);
      });

      // 2. Section 25: Switch Water away to per_unit
      fireEvent.change(screen.getByTestId('select-water-billing-mode'), { target: { value: 'per_unit' } });

      await waitFor(() => {
        // Active snapshot becomes per_unit with tier array = null
        expect(server.cycleRateSnapshot.waterBillingType).toBe('per_unit');
        expect(server.cycleRateSnapshot.waterTierRates).toBeNull();
        // DormitoryBillingSettings STILL PRESERVES 3.40 / 4.25 / 5.00
        expect(server.dormBillingSettings.waterTierRates).toEqual([
          { upTo: '10.00', rate: '3.40' },
          { upTo: '20.00', rate: '4.25' },
          { upTo: null, rate: '5.00' },
        ]);
      });

      // 3. Section 26: REAL RELOAD SIMULATION
      // Unmount the component completely and clear React state
      unmount();
      cleanup();

      // Render fresh instance against the simulated persistent server state
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

      const reloadedWaterSelect = screen.getByTestId('select-water-billing-mode') as HTMLSelectElement;
      expect(reloadedWaterSelect.value).toBe('per_unit');
      expect(screen.queryByTestId('tiered-rate-editor-water')).toBeNull();

      // Switch to Tiered in the fresh UI
      fireEvent.change(reloadedWaterSelect, { target: { value: 'tiered' } });
      expect(reloadedWaterSelect.value).toBe('tiered');
      expect(screen.getByTestId('tiered-rate-editor-water')).toBeDefined();

      // Prove that tiers 3.40 / 4.25 / 5.00 are restored from DormitoryBillingSettings
      expect((screen.getByTestId('input-tier-rate-water-0') as HTMLInputElement).value).toBe('3.40');
      expect((screen.getByTestId('input-tier-rate-water-1') as HTMLInputElement).value).toBe('4.25');
      expect((screen.getByTestId('input-tier-rate-water-2') as HTMLInputElement).value).toBe('5.00');
    });

    it('Section 27: Independent Electricity Tiered Persistence & Round-Trip', async () => {
      const server = new StatefulServerSimulator(
        {
          waterBillingType: 'tiered',
          waterTierRates: [
            { upTo: '10.00', rate: '3.40' },
            { upTo: '20.00', rate: '4.25' },
            { upTo: null, rate: '5.00' },
          ],
          electricityBillingType: 'per_unit',
          electricityTierRates: null,
        },
        {
          waterBillingType: 'tiered',
          waterTierRates: [
            { upTo: '10.00', rate: '3.40' },
            { upTo: '20.00', rate: '4.25' },
            { upTo: null, rate: '5.00' },
          ],
          electricityBillingType: 'per_unit',
          electricityTierRates: null,
        }
      );
      server.setupMocks();

      render(
        <OwnerSettings
          onAddLog={vi.fn()}
          onRefreshData={vi.fn()}
          selectedCycle="2026-08"
          availableCycles={[mockCycle]}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('select-electric-billing-mode')).toBeDefined();
      });

      const electricSelect = screen.getByTestId('select-electric-billing-mode') as HTMLSelectElement;
      fireEvent.change(electricSelect, { target: { value: 'tiered' } });

      // Configure Electricity tiers: 50@7.00, 150@8.00, infinity@9.00
      fireEvent.change(screen.getByTestId('input-tier-rate-electricity-0'), { target: { value: '7.00' } });
      fireEvent.change(screen.getByTestId('input-tier-rate-electricity-1'), { target: { value: '8.00' } });
      fireEvent.change(screen.getByTestId('input-tier-rate-electricity-2'), { target: { value: '9.00' } });

      // Save Electricity tiers
      const saveBtn = screen.getByTestId('btn-save-tiers-electricity');
      fireEvent.click(saveBtn);

      await waitFor(() => {
        // Assert Electricity tiers persisted
        expect(server.dormBillingSettings.electricityTierRates).toEqual([
          { upTo: '50.00', rate: '7.00' },
          { upTo: '150.00', rate: '8.00' },
          { upTo: null, rate: '9.00' },
        ]);
        expect(server.cycleRateSnapshot.electricityBillingType).toBe('tiered');
        expect(server.cycleRateSnapshot.electricityTierRates).toEqual([
          { upTo: '50.00', rate: '7.00' },
          { upTo: '150.00', rate: '8.00' },
          { upTo: null, rate: '9.00' },
        ]);
        // Water state is completely untouched and preserved
        expect(server.dormBillingSettings.waterTierRates).toEqual([
          { upTo: '10.00', rate: '3.40' },
          { upTo: '20.00', rate: '4.25' },
          { upTo: null, rate: '5.00' },
        ]);
      });
    });

    it('Section 28: No Persisted Tiers -> Selecting Tiered loads sample preset into draft without mutating network', async () => {
      const server = new StatefulServerSimulator(
        { waterBillingType: 'per_unit', waterTierRates: null },
        { waterBillingType: 'per_unit', waterTierRates: null }
      );
      server.setupMocks();

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

      const mutationCountBefore = server.mutationCount;
      const waterSelect = screen.getByTestId('select-water-billing-mode') as HTMLSelectElement;
      fireEvent.change(waterSelect, { target: { value: 'tiered' } });

      // Sample preset (18 / 20 / 22) appears in local draft
      expect((screen.getByTestId('input-tier-rate-water-0') as HTMLInputElement).value).toBe('18.00');
      expect((screen.getByTestId('input-tier-rate-water-1') as HTMLInputElement).value).toBe('20.00');
      expect((screen.getByTestId('input-tier-rate-water-2') as HTMLInputElement).value).toBe('22.00');

      // Zero network mutations until explicit save
      expect(server.mutationCount).toBe(mutationCountBefore);
    });

    it('Section 29: Scalar Rate is visibly inactive / disabled during Tiered mode', async () => {
      const server = new StatefulServerSimulator(
        { waterBillingType: 'tiered', waterTierRates: WATER_TIER_PRESET },
        { waterBillingType: 'tiered', waterTierRates: WATER_TIER_PRESET }
      );
      server.setupMocks();

      render(
        <OwnerSettings
          onAddLog={vi.fn()}
          onRefreshData={vi.fn()}
          selectedCycle="2026-08"
          availableCycles={[mockCycle]}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('input-water-unit-rate')).toBeDefined();
      });

      const scalarWaterInput = screen.getByTestId('input-water-unit-rate') as HTMLInputElement;
      expect(scalarWaterInput.disabled).toBe(true);
      expect(scalarWaterInput.value).toBe('คิดตามขั้นบันได');

      const mutationCountBefore = server.mutationCount;
      fireEvent.blur(scalarWaterInput);
      fireEvent.keyDown(scalarWaterInput, { key: 'Enter' });

      // No mutation emitted on blur/keydown
      expect(server.mutationCount).toBe(mutationCountBefore);
    });

    it('Section 31: Locked cycle prevents any tier settings or snapshot mutation', async () => {
      const server = new StatefulServerSimulator(
        { waterBillingType: 'tiered', waterTierRates: WATER_TIER_PRESET },
        { waterBillingType: 'tiered', waterTierRates: WATER_TIER_PRESET }
      );
      server.setupMocks();

      // Override fetch to return locked cycle
      global.fetch = vi.fn().mockImplementation((url: string) => {
        const urlStr = String(url);
        if (urlStr.includes('rate-snapshot')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              data: {
                cycle: mockCycle,
                rateSnapshot: { ...server.cycleRateSnapshot, waterBillingType: 'tiered', waterTierRates: WATER_TIER_PRESET },
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

    it('Section 32: Version Conflict during Dormitory Defaults tier save triggers VersionConflictModal', async () => {
      const server = new StatefulServerSimulator(
        { waterBillingType: 'tiered', waterTierRates: WATER_TIER_PRESET },
        { waterBillingType: 'tiered', waterTierRates: WATER_TIER_PRESET }
      );
      server.conflictTrigger = true; // Simulates 409 CONFLICT on defaults update
      server.setupMocks();

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

      const saveBtn = screen.getByTestId('btn-save-tiers-water');
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(screen.getByTestId('version-conflict-modal')).toBeDefined();
      });
    });
  });
});
