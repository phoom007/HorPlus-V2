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

describe('OWNER R3.9-D.1.3: Settings Context Isolation & Stale Response Guard Suite', () => {
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

  describe('3. Multi-Dormitory and Multi-Cycle Context Isolation', () => {
    const DORM_A = 'dorm-aaa-111';
    const DORM_B = 'dorm-bbb-222';
    const mockCycleAug = { id: 'cycle-2026-08', cycleCode: '2026-08', status: 'active' };
    const mockCycleJul = { id: 'cycle-2026-07', cycleCode: '2026-07', status: 'active' };

    class MultiContextServerSimulator {
      public dorms: Record<string, { billing: any; property: any }> = {
        [DORM_A]: {
          billing: {
            version: 1,
            waterBillingType: 'per_unit',
            waterRate: '18.00',
            waterTierRates: [
              { upTo: '10.00', rate: '3.40' },
              { upTo: '20.00', rate: '4.25' },
              { upTo: null, rate: '5.00' },
            ],
            electricityBillingType: 'per_unit',
            electricityTierRates: null,
          },
          property: { version: 1 },
        },
        [DORM_B]: {
          billing: {
            version: 1,
            waterBillingType: 'per_unit',
            waterRate: '20.00',
            waterTierRates: null,
            electricityBillingType: 'per_unit',
            electricityTierRates: null,
          },
          property: { version: 1 },
        },
      };

      public snapshots: Record<string, any> = {
        [`${DORM_A}_2026-08`]: {
          version: 1,
          waterBillingType: 'per_unit',
          waterTierRates: null,
        },
        [`${DORM_B}_2026-08`]: {
          version: 1,
          waterBillingType: 'per_unit',
          waterTierRates: null,
        },
        [`${DORM_A}_2026-07`]: {
          version: 1,
          waterBillingType: 'per_unit',
          waterTierRates: null,
        },
      };

      public updateDefaultsCalls: any[] = [];
      public snapshotPutCalls: any[] = [];

      setupMocks() {
        global.fetch = vi.fn().mockImplementation((url: string, opts: any) => {
          const urlStr = String(url);
          const dormIdHeader = opts?.headers?.['x-dormitory-id'] || localStorage.getItem('selected_dormitory_id') || DORM_A;

          if (urlStr.includes('/api/v1/billing-cycles') && !urlStr.includes('rate-snapshot')) {
            return Promise.resolve({
              ok: true,
              json: async () => ({ data: [mockCycleAug, mockCycleJul] }),
            });
          }

          if (urlStr.includes('rate-snapshot')) {
            const isJul = urlStr.includes('2026-07');
            const cycleCode = isJul ? '2026-07' : '2026-08';
            const snapKey = `${dormIdHeader}_${cycleCode}`;

            if (opts?.method === 'PUT') {
              this.snapshotPutCalls.push({ key: snapKey, body: JSON.parse(opts.body) });
              const body = JSON.parse(opts.body);
              this.snapshots[snapKey] = {
                ...this.snapshots[snapKey],
                ...body,
                version: (this.snapshots[snapKey]?.version || 1) + 1,
              };
              return Promise.resolve({
                ok: true,
                json: async () => ({
                  data: {
                    rateSnapshot: this.snapshots[snapKey],
                  },
                }),
              });
            }

            return Promise.resolve({
              ok: true,
              json: async () => ({
                data: {
                  cycle: cycleCode === '2026-07' ? mockCycleJul : mockCycleAug,
                  rateSnapshot: this.snapshots[snapKey] || { version: 1, waterBillingType: 'per_unit', waterTierRates: null },
                  isLocked: false,
                  lockReason: null,
                },
              }),
            });
          }

          return Promise.resolve({ ok: true, json: async () => ({ data: {} }) });
        });

        vi.spyOn(ApiPropertyAdapter.prototype, 'getDormitoryDefaults').mockImplementation(async () => {
          const currentDormId = localStorage.getItem('selected_dormitory_id') || DORM_A;
          const dormData = this.dorms[currentDormId] || this.dorms[DORM_A];
          return {
            success: true,
            data: JSON.parse(JSON.stringify(dormData)),
          } as any;
        });

        vi.spyOn(ApiPropertyAdapter.prototype, 'updateDormitoryDefaults').mockImplementation(async (payload: any) => {
          const currentDormId = localStorage.getItem('selected_dormitory_id') || DORM_A;
          this.updateDefaultsCalls.push({ dormId: currentDormId, payload });
          if (payload.billing?.changes && this.dorms[currentDormId]) {
            this.dorms[currentDormId].billing = {
              ...this.dorms[currentDormId].billing,
              ...payload.billing.changes,
              version: this.dorms[currentDormId].billing.version + 1,
            };
          }
          return {
            success: true,
            data: {
              billing: this.dorms[currentDormId].billing,
              property: { version: 1 },
            },
          } as any;
        });
      }
    }

    it('Section 9 & 30: Cross-Dorm Isolation — Dorm A tiers (3.40/4.25/5.00) do NOT leak into Dorm B (null tiers)', async () => {
      const server = new MultiContextServerSimulator();
      server.setupMocks();

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
      expect((screen.getByTestId('input-tier-rate-water-1') as HTMLInputElement).value).toBe('4.25');
      expect((screen.getByTestId('input-tier-rate-water-2') as HTMLInputElement).value).toBe('5.00');

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
      expect((screen.getByTestId('input-tier-rate-water-1') as HTMLInputElement).value).toBe('20.00');
      expect((screen.getByTestId('input-tier-rate-water-2') as HTMLInputElement).value).toBe('22.00');
    });

    it('Section 10 & 30: Out-of-Order Dormitory Resolution — Dorm B resolves first, stale Dorm A resolves last -> Dorm B wins', async () => {
      const server = new MultiContextServerSimulator();
      server.setupMocks();

      let resolveDormAPromise: any;
      const dormADelayPromise = new Promise((res) => {
        resolveDormAPromise = res;
      });

      vi.spyOn(ApiPropertyAdapter.prototype, 'getDormitoryDefaults').mockImplementation(async () => {
        const currentDormId = localStorage.getItem('selected_dormitory_id');
        if (currentDormId === DORM_A) {
          await dormADelayPromise;
          return { success: true, data: JSON.parse(JSON.stringify(server.dorms[DORM_A])) } as any;
        }
        return { success: true, data: JSON.parse(JSON.stringify(server.dorms[DORM_B])) } as any;
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
        expect(screen.getByTestId('select-water-billing-mode')).toBeDefined();
      });

      resolveDormAPromise();

      fireEvent.change(screen.getByTestId('select-water-billing-mode'), { target: { value: 'tiered' } });
      expect((screen.getByTestId('input-tier-rate-water-0') as HTMLInputElement).value).toBe('18.00');
    });

    it('Section 11 & 30: Out-of-Order Cycle Resolution — August resolves first, stale July resolves last -> August wins', async () => {
      const server = new MultiContextServerSimulator();
      server.snapshots[`${DORM_A}_2026-07`] = {
        version: 1,
        waterBillingType: 'tiered',
        waterTierRates: [{ upTo: null, rate: '99.00' }],
      };
      server.snapshots[`${DORM_A}_2026-08`] = {
        version: 1,
        waterBillingType: 'tiered',
        waterTierRates: [{ upTo: null, rate: '35.00' }],
      };
      server.setupMocks();

      let resolveJulPromise: any;
      const julDelayPromise = new Promise((res) => {
        resolveJulPromise = res;
      });

      global.fetch = vi.fn().mockImplementation((url: string, opts: any) => {
        const urlStr = String(url);
        if (urlStr.includes('rate-snapshot')) {
          if (urlStr.includes('2026-07')) {
            return julDelayPromise.then(() => ({
              ok: true,
              json: async () => ({
                data: {
                  cycle: mockCycleJul,
                  rateSnapshot: server.snapshots[`${DORM_A}_2026-07`],
                },
              }),
            }));
          }
          return Promise.resolve({
            ok: true,
            json: async () => ({
              data: {
                cycle: mockCycleAug,
                rateSnapshot: server.snapshots[`${DORM_A}_2026-08`],
              },
            }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({ data: [mockCycleAug, mockCycleJul] }) });
      });

      localStorage.setItem('selected_dormitory_id', DORM_A);
      const { rerender } = render(
        <OwnerSettings
          onAddLog={vi.fn()}
          onRefreshData={vi.fn()}
          selectedCycle="2026-07"
          availableCycles={[mockCycleAug, mockCycleJul]}
        />
      );

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

      resolveJulPromise();

      expect((screen.getByTestId('input-tier-rate-water-0') as HTMLInputElement).value).toBe('35.00');
    });

    it('Section 26 & 30: Save-Before-Load Guard — Tier save is blocked if context authority is still loading', async () => {
      const server = new MultiContextServerSimulator();
      server.setupMocks();

      let resolveDormBPromise: any;
      const dormBDelayPromise = new Promise((res) => {
        resolveDormBPromise = res;
      });

      vi.spyOn(ApiPropertyAdapter.prototype, 'getDormitoryDefaults').mockImplementation(async () => {
        const currentDormId = localStorage.getItem('selected_dormitory_id');
        if (currentDormId === DORM_B) {
          await dormBDelayPromise;
          return { success: true, data: JSON.parse(JSON.stringify(server.dorms[DORM_B])) } as any;
        }
        return { success: true, data: JSON.parse(JSON.stringify(server.dorms[DORM_A])) } as any;
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

      localStorage.setItem('selected_dormitory_id', DORM_B);
      rerender(
        <OwnerSettings
          onAddLog={vi.fn()}
          onRefreshData={vi.fn()}
          selectedCycle="2026-08"
          availableCycles={[mockCycleAug]}
        />
      );

      fireEvent.change(screen.getByTestId('select-water-billing-mode'), { target: { value: 'tiered' } });
      const saveBtn = screen.getByTestId('btn-save-tiers-water');
      fireEvent.click(saveBtn);

      expect(server.updateDefaultsCalls.filter((c) => c.dormId === DORM_B).length).toBe(0);

      resolveDormBPromise();
    });
  });

  describe('4. Same-Context Hydration Races & Version Sync', () => {
    const DORM_ID = 'dorm-race-1';
    const mockCycle = { id: 'cycle-2026-08', cycleCode: '2026-08', status: 'active' };

    it('Same Context Race A: Defaults resolves first, Snapshot resolves second -> Snapshot wins active mode', async () => {
      localStorage.setItem('selected_dormitory_id', DORM_ID);

      let resolveSnap: any;
      const snapPromise = new Promise((res) => { resolveSnap = res; });

      global.fetch = vi.fn().mockImplementation((url: string) => {
        const urlStr = String(url);
        if (urlStr.includes('rate-snapshot')) {
          return snapPromise.then(() => ({
            ok: true,
            json: async () => ({
              data: {
                cycle: mockCycle,
                rateSnapshot: {
                  version: 1,
                  waterBillingType: 'tiered',
                  waterTierRates: [
                    { upTo: '10.00', rate: '3.40' },
                    { upTo: '20.00', rate: '4.25' },
                    { upTo: null, rate: '5.00' },
                  ],
                },
              },
            }),
          }));
        }
        return Promise.resolve({ ok: true, json: async () => ({ data: [mockCycle] }) });
      });

      vi.spyOn(ApiPropertyAdapter.prototype, 'getDormitoryDefaults').mockResolvedValue({
        success: true,
        data: {
          property: { version: 1 },
          billing: { version: 1, waterBillingType: 'per_unit', waterTierRates: WATER_TIER_PRESET },
        },
      } as any);

      render(
        <OwnerSettings
          onAddLog={vi.fn()}
          onRefreshData={vi.fn()}
          selectedCycle="2026-08"
          availableCycles={[mockCycle]}
        />
      );

      resolveSnap();

      await waitFor(() => {
        const select = screen.getByTestId('select-water-billing-mode') as HTMLSelectElement;
        expect(select.value).toBe('tiered');
      });

      expect((screen.getByTestId('input-tier-rate-water-0') as HTMLInputElement).value).toBe('3.40');
    });

    it('Same Context Race B: Snapshot resolves first, Defaults resolves second -> Snapshot wins active mode', async () => {
      localStorage.setItem('selected_dormitory_id', DORM_ID);

      let resolveDefaults: any;
      const defaultsPromise = new Promise((res) => { resolveDefaults = res; });

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
                  waterTierRates: [
                    { upTo: '10.00', rate: '3.40' },
                    { upTo: '20.00', rate: '4.25' },
                    { upTo: null, rate: '5.00' },
                  ],
                },
              },
            }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({ data: [mockCycle] }) });
      });

      vi.spyOn(ApiPropertyAdapter.prototype, 'getDormitoryDefaults').mockImplementation(async () => {
        await defaultsPromise;
        return {
          success: true,
          data: {
            property: { version: 1 },
            billing: { version: 1, waterBillingType: 'per_unit', waterTierRates: WATER_TIER_PRESET },
          },
        } as any;
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
        const select = screen.getByTestId('select-water-billing-mode') as HTMLSelectElement;
        expect(select.value).toBe('tiered');
      });

      resolveDefaults();

      await waitFor(() => {
        const select = screen.getByTestId('select-water-billing-mode') as HTMLSelectElement;
        expect(select.value).toBe('tiered');
      });

      expect((screen.getByTestId('input-tier-rate-water-0') as HTMLInputElement).value).toBe('3.40');
    });

    it('Sequential Save: Water save increments version from 1->2, then Electricity save uses expectedVersion: 2', async () => {
      localStorage.setItem('selected_dormitory_id', DORM_ID);

      const defaultsPayloads: any[] = [];
      let billingVer = 1;

      global.fetch = vi.fn().mockImplementation((url: string, opts: any) => {
        const urlStr = String(url);
        if (urlStr.includes('rate-snapshot')) {
          if (opts?.method === 'PUT') {
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
        data: { property: { version: 1 }, billing: { version: 1, waterBillingType: 'tiered', electricityBillingType: 'tiered' } },
      } as any);

      vi.spyOn(ApiPropertyAdapter.prototype, 'updateDormitoryDefaults').mockImplementation(async (p: any) => {
        defaultsPayloads.push(p);
        billingVer++;
        return {
          success: true,
          data: { billing: { version: billingVer, ...p.billing.changes } },
        } as any;
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
        expect(screen.getByTestId('btn-save-tiers-water')).toBeDefined();
        expect(screen.getByTestId('btn-save-tiers-electricity')).toBeDefined();
      });

      // 1. Save Water
      fireEvent.click(screen.getByTestId('btn-save-tiers-water'));

      await waitFor(() => {
        expect(defaultsPayloads[0].billing.expectedVersion).toBe(1);
      });

      // 2. Save Electricity
      fireEvent.click(screen.getByTestId('btn-save-tiers-electricity'));

      await waitFor(() => {
        expect(defaultsPayloads.length).toBe(2);
        expect(defaultsPayloads[1].billing.expectedVersion).toBe(2);
      });
    });
  });

  describe('5. User-Visible Failure and Error Banners', () => {
    const DORM_ID = 'dorm-err-1';
    const mockCycle = { id: 'cycle-2026-08', cycleCode: '2026-08', status: 'active' };

    it('Section 14, 16 & 30: Snapshot non-409 failure renders user-visible error banner and does NOT emit success log', async () => {
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

    it('Section 14, 17 & 30: Durable defaults failure renders user-visible error banner and blocks snapshot PUT', async () => {
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

    it('Section 20 & 30: Retry success clears error banner', async () => {
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
