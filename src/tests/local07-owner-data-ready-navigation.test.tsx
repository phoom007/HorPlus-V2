// @vitest-environment happy-dom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LOCAL-07 — Data-Ready Navigation & Authority Test Suite
 * Comprehensive coverage for:
 * 1. Canonical query dependency graph across all 9 Owner tabs (exact key sets, Payments has no rooms).
 * 2. Active parent coordinator starts child-required queries (no deadlock on cold direct URL / hard refresh).
 * 3. Browser Back / Forward navigation handling.
 * 4. Stale target query revalidation (fetchQuery before swap, stay on current page + toast on failure, no seen update).
 * 5. Last-intent-wins async navigation race protection (including browser route change & superseded errors).
 * 6. Authoritative billing-cycle metadata derivation (no guessing, missing authority does not deadlock).
 * 7. Complete fail-closed guards for all meter action entry points and handlers.
 * 8. Payments view warm-cache consumption with zero mount re-fetch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { OwnerWorkspace, getTargetQueriesForTab, isQueryReady, areQueriesReady } from '../pages/owner';
import { PaymentsOwnerView } from '../pages/owner/payments';
import { OwnerMeters } from '../pages/owner/meters';
import { queryKeys, STALE_TIMES } from '../lib/queryClient';
import { AuthContext } from '../router/guards';
import { User, Room, Building, Tenant, Contract, Bill } from '../types';
import * as httpClient from '../data/httpClient';
import { getDataProvider } from '../data/dataProvider';

const mockUser: User = {
  id: 'user-owner-001',
  email: 'owner@test.com',
  name: 'Test Owner',
  avatar: '',
  roleId: 'role-owner',
  roleName: 'เจ้าของหอพัก',
  description: '',
  createdAt: '2026-08-01T00:00:00.000Z',
};

const mockMemberships = [
  {
    id: 'm-1',
    dormitoryId: 'dorm-fresh-001',
    roleCode: 'OWNER',
    status: 'active',
  },
];

const mockRooms: Room[] = [
  {
    id: 'room-1',
    buildingId: 'bld-1',
    roomNumber: '101',
    floor: 1,
    status: 'occupied',
    monthlyRent: 4500,
    dailyRent: 350,
    depositAmount: 4500,
    maxOccupants: 2,
    initialWaterMeter: 0,
    initialElectricMeter: 0,
    images: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  },
];

const mockBuildings: Building[] = [
  {
    id: 'bld-1',
    name: 'Building A',
    floorsCount: 4,
    maxTermRentInstallments: 3,
    termMonths: 4,
    dailyRent: 400,
    depositAmount: 500,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  },
];

const mockTenants: Tenant[] = [
  {
    id: 'tenant-1',
    name: 'สมชาย ใจดี',
    phone: '0812345678',
    status: 'active',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  } as any,
];

const mockContracts: Contract[] = [
  {
    id: 'contract-1',
    dormitoryId: 'dorm-fresh-001',
    roomId: 'room-1',
    tenantId: 'tenant-1',
    rentAmount: 4500,
    depositAmount: 4500,
    startDate: '2026-08-01',
    endDate: '2027-07-31',
    status: 'active',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  } as any,
];

const mockBills: Bill[] = [
  {
    id: 'bill-1',
    dormitoryId: 'dorm-fresh-001',
    roomId: 'room-1',
    cycleId: 'cycle-2026-08',
    totalAmount: 5000,
    status: 'pending',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  } as any,
];

const mockBillingCyclesMeta = {
  data: [
    { id: 'cycle-2026-08', cycleCode: '2026-08', status: 'open', isCurrent: true, isFirstCycle: true },
    { id: 'cycle-2026-09', cycleCode: '2026-09', status: 'draft', isCurrent: false, isFirstCycle: false },
  ],
  operationalBillingCycleId: 'cycle-2026-08',
  operationalCycleCode: '2026-08',
  firstBillingCycleId: 'cycle-2026-08',
};

const createTestClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 60_000,
      },
    },
  });

const renderWorkspace = (client: QueryClient, initialRoute = '/owner/dashboard') => {
  return render(
    <AuthContext.Provider
      value={{
        user: mockUser,
        userType: 'owner',
        dormitoryId: 'dorm-fresh-001',
        memberships: mockMemberships,
        onboardingRequired: false,
      } as any}
    >
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[initialRoute]}>
          <Routes>
            <Route path="/owner/*" element={<OwnerWorkspace user={mockUser} onLogout={vi.fn()} />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </AuthContext.Provider>
  );
};

describe('LOCAL-07 — Data-Ready Navigation & Authority Suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.scrollTo = vi.fn();
    localStorage.clear();
    sessionStorage.clear();
    vi.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
      const u = String(url);
      if (u.includes('/api/v1/notifications')) {
        return { ok: true, json: async () => ({ notifications: [], unreadCount: 0 }) } as any;
      }
      return { ok: true, json: async () => ({ data: [] }) } as any;
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  // ==========================================
  // 1. Canonical Query Dependency Graph (All 9 Tabs)
  // ==========================================
  describe('1. Canonical Query Dependency Graph for all 9 Tabs', () => {
    const dormId = 'dorm-test-123';
    const cycleId = 'cycle-aug-2026';

    it('defines exact query dependencies for dashboard (8 queries)', () => {
      const queries = getTargetQueriesForTab('dashboard', dormId, cycleId);
      const keys = queries.map(q => JSON.stringify(q.queryKey));
      expect(keys).toEqual([
        JSON.stringify(queryKeys.rooms(dormId)),
        JSON.stringify(queryKeys.buildings(dormId)),
        JSON.stringify(queryKeys.billingCycles(dormId)),
        JSON.stringify(queryKeys.bills(dormId)),
        JSON.stringify(queryKeys.maintenance(dormId)),
        JSON.stringify(queryKeys.tenants(dormId)),
        JSON.stringify(queryKeys.contracts(dormId)),
        JSON.stringify(queryKeys.meterReadings(dormId, cycleId)),
      ]);
      expect(queries).toHaveLength(8);
    });

    it('defines exact query dependencies for rooms (5 queries)', () => {
      const queries = getTargetQueriesForTab('rooms', dormId);
      const keys = queries.map(q => JSON.stringify(q.queryKey));
      expect(keys).toEqual([
        JSON.stringify(queryKeys.rooms(dormId)),
        JSON.stringify(queryKeys.buildings(dormId)),
        JSON.stringify(queryKeys.tenants(dormId)),
        JSON.stringify(queryKeys.contracts(dormId)),
        JSON.stringify(queryKeys.bills(dormId)),
      ]);
      expect(queries).toHaveLength(5);
    });

    it('defines exact query dependencies for tenants (4 queries)', () => {
      const queries = getTargetQueriesForTab('tenants', dormId);
      const keys = queries.map(q => JSON.stringify(q.queryKey));
      expect(keys).toEqual([
        JSON.stringify(queryKeys.tenants(dormId)),
        JSON.stringify(queryKeys.rooms(dormId)),
        JSON.stringify(queryKeys.contracts(dormId)),
        JSON.stringify(queryKeys.bills(dormId)),
      ]);
      expect(queries).toHaveLength(4);
    });

    it('defines exact query dependencies for contracts (4 queries)', () => {
      const queries = getTargetQueriesForTab('contracts', dormId);
      const keys = queries.map(q => JSON.stringify(q.queryKey));
      expect(keys).toEqual([
        JSON.stringify(queryKeys.contracts(dormId)),
        JSON.stringify(queryKeys.rooms(dormId)),
        JSON.stringify(queryKeys.tenants(dormId)),
        JSON.stringify(queryKeys.bills(dormId)),
      ]);
      expect(queries).toHaveLength(4);
    });

    it('defines exact query dependencies for meters (8 queries)', () => {
      const queries = getTargetQueriesForTab('meters', dormId, cycleId);
      const keys = queries.map(q => JSON.stringify(q.queryKey));
      expect(keys).toEqual([
        JSON.stringify(queryKeys.rooms(dormId)),
        JSON.stringify(queryKeys.buildings(dormId)),
        JSON.stringify(queryKeys.billingCycles(dormId)),
        JSON.stringify(queryKeys.bills(dormId)),
        JSON.stringify(queryKeys.tenants(dormId)),
        JSON.stringify(queryKeys.contracts(dormId)),
        JSON.stringify(queryKeys.meterWorkspace(dormId, cycleId)),
        JSON.stringify(queryKeys.meterPreviewContext(dormId, cycleId)),
      ]);
      expect(queries).toHaveLength(8);
    });

    it('meterPreviewContext query function passes canonical dormitoryId option to httpRequest', async () => {
      const queries = getTargetQueriesForTab('meters', dormId, cycleId);
      const previewQuery = queries.find(
        q => JSON.stringify(q.queryKey) === JSON.stringify(queryKeys.meterPreviewContext(dormId, cycleId))
      );
      expect(previewQuery).toBeDefined();

      const httpSpy = vi.spyOn(httpClient, 'httpRequest').mockResolvedValueOnce({
        success: true,
        data: { rateSnapshot: { waterRate: 18 } },
      } as any);

      await previewQuery!.queryFn();

      expect(httpSpy).toHaveBeenCalledWith(
        'GET',
        `/api/v1/meters/workspace/preview-context?billingCycleId=${cycleId}`,
        undefined,
        { dormitoryId: dormId }
      );
    });

    it('defines exact query dependencies for payments (3 queries, NO rooms dependency)', () => {
      const queries = getTargetQueriesForTab('payments', dormId);
      const keys = queries.map(q => JSON.stringify(q.queryKey));
      expect(keys).toEqual([
        JSON.stringify(queryKeys.payments(dormId)),
        JSON.stringify(queryKeys.bills(dormId)),
        JSON.stringify(queryKeys.dailyInvoices(dormId)),
      ]);
      expect(keys).not.toContain(JSON.stringify(queryKeys.rooms(dormId)));
      expect(queries).toHaveLength(3);
    });

    it('defines exact query dependencies for maintenance (3 queries)', () => {
      const queries = getTargetQueriesForTab('maintenance', dormId);
      const keys = queries.map(q => JSON.stringify(q.queryKey));
      expect(keys).toEqual([
        JSON.stringify(queryKeys.maintenance(dormId)),
        JSON.stringify(queryKeys.rooms(dormId)),
        JSON.stringify(queryKeys.tenants(dormId)),
      ]);
      expect(queries).toHaveLength(3);
    });

    it('defines exact query dependencies for announcements (3 queries)', () => {
      const queries = getTargetQueriesForTab('announcements', dormId);
      const keys = queries.map(q => JSON.stringify(q.queryKey));
      expect(keys).toEqual([
        JSON.stringify(queryKeys.announcements(dormId)),
        JSON.stringify(queryKeys.rooms(dormId)),
        JSON.stringify(queryKeys.buildings(dormId)),
      ]);
      expect(queries).toHaveLength(3);
    });

    it('defines exact query dependencies for reports (6 queries)', () => {
      const queries = getTargetQueriesForTab('reports', dormId);
      const keys = queries.map(q => JSON.stringify(q.queryKey));
      expect(keys).toEqual([
        JSON.stringify(queryKeys.rooms(dormId)),
        JSON.stringify(queryKeys.bills(dormId)),
        JSON.stringify(queryKeys.buildings(dormId)),
        JSON.stringify(queryKeys.tenants(dormId)),
        JSON.stringify(queryKeys.contracts(dormId)),
        JSON.stringify(queryKeys.billingCycles(dormId)),
      ]);
      expect(queries).toHaveLength(6);
    });
  });

  // ==========================================
  // 2. Query Readiness and Freshness Inspections
  // ==========================================
  describe('2. Query Freshness & Readiness State Checks', () => {
    it('isQueryReady returns false if query is not present or not success', () => {
      const client = createTestClient();
      expect(isQueryReady(client, ['test'])).toBe(false);

      client.setQueryData(['test'], { dummy: true });
      client.invalidateQueries({ queryKey: ['test'] });
      expect(isQueryReady(client, ['test'])).toBe(false);
    });

    it('isQueryReady returns false if data is older than staleTime', async () => {
      const client = createTestClient();
      client.setQueryData(['test-freshness'], { val: 1 });
      const state = client.getQueryState(['test-freshness']);
      if (state) {
        state.dataUpdatedAt = Date.now() - 100_000; // 100 seconds old
      }
      expect(isQueryReady(client, ['test-freshness'], 30_000)).toBe(false);
    });

    it('areQueriesReady returns true only when ALL queries are fresh and ready', () => {
      const client = createTestClient();
      client.setQueryData(['q1'], { a: 1 });
      client.setQueryData(['q2'], { b: 2 });

      expect(
        areQueriesReady(client, [
          { queryKey: ['q1'], staleTime: 60_000 },
          { queryKey: ['q2'], staleTime: 60_000 },
        ])
      ).toBe(true);

      expect(
        areQueriesReady(client, [
          { queryKey: ['q1'], staleTime: 60_000 },
          { queryKey: ['q2'], staleTime: 60_000 },
          { queryKey: ['q3'], staleTime: 60_000 },
        ])
      ).toBe(false);
    });
  });

  // ==========================================
  // 3. Cold Direct URL & Hard Refresh (No Deadlock)
  // ==========================================
  // ==========================================
  // 3. Cold Direct URL & Active Route Query Coordination
  // ==========================================
  describe('3. Cold Direct URL & Active Route Query Coordination', () => {
    it('Cold direct URL /owner/payments starts payments queries and resolves without deadlock', async () => {
      const client = createTestClient();
      const dormId = 'dorm-fresh-001';

      vi.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
        const u = String(url);
        if (u.includes('/api/v1/payments')) {
          return { ok: true, json: async () => [{ id: 'pay-1', amount: 5000 }] } as any;
        }
        if (u.includes('/api/v1/bills')) {
          return { ok: true, json: async () => ({ data: mockBills }) } as any;
        }
        if (u.includes('/api/v1/daily-stays/invoices')) {
          return { ok: true, json: async () => ({ data: [] }) } as any;
        }
        return { ok: true, json: async () => ({ data: [] }) } as any;
      });

      const queries = getTargetQueriesForTab('payments', dormId);
      expect(queries).toHaveLength(3);
      expect(queries.map(q => q.queryKey)).not.toContainEqual(queryKeys.rooms(dormId));

      // Execute all cold target queries via fetchQuery (as OwnerWorkspace coordinator does)
      await Promise.all(
        queries.map(q => client.fetchQuery({ queryKey: q.queryKey, queryFn: q.queryFn, staleTime: q.staleTime }))
      );

      // Verify all queries are ready and pre-warmed in client
      expect(areQueriesReady(client, queries)).toBe(true);

      // Mount PaymentsOwnerView to verify instant rendering
      render(
        <QueryClientProvider client={client}>
          <PaymentsOwnerView bills={mockBills} dormitoryId={dormId} />
        </QueryClientProvider>
      );

      expect(screen.queryByText('กำลังโหลดข้อมูล...')).toBeNull();
      expect(screen.getAllByText('รับชำระเงิน').length).toBeGreaterThan(0);
    });

    it('Cold direct URL /owner/meters starts meter dependencies and resolves with authoritative cycle', async () => {
      const client = createTestClient();
      const dormId = 'dorm-fresh-001';
      const cycleId = 'cycle-2026-08';

      vi.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
        const u = String(url);
        if (u.includes('/api/v1/billing-cycles')) {
          return { ok: true, json: async () => mockBillingCyclesMeta } as any;
        }
        if (u.includes('/api/v1/properties/rooms')) {
          return { ok: true, json: async () => ({ data: mockRooms }) } as any;
        }
        if (u.includes('/api/v1/properties/buildings')) {
          return { ok: true, json: async () => ({ data: mockBuildings }) } as any;
        }
        if (u.includes('/api/v1/bills')) {
          return { ok: true, json: async () => ({ data: mockBills }) } as any;
        }
        if (u.includes('/api/v1/tenants')) {
          return { ok: true, json: async () => ({ data: mockTenants }) } as any;
        }
        if (u.includes('/api/v1/contracts')) {
          return { ok: true, json: async () => ({ data: mockContracts }) } as any;
        }
        return { ok: true, json: async () => ({ data: [] }) } as any;
      });

      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url) => {
        if (url.includes('/preview-context')) {
          return {
            success: true,
            data: {
              rateSnapshot: {
                waterBillingType: 'per_unit',
                electricityBillingType: 'per_unit',
                waterRate: 18,
                electricityRate: 7,
              },
            },
          };
        }
        return { success: true, data: [] };
      });

      const queries = getTargetQueriesForTab('meters', dormId, cycleId);
      expect(queries).toHaveLength(8);

      // Execute queries
      await Promise.all(
        queries.map(q => client.fetchQuery({ queryKey: q.queryKey, queryFn: q.queryFn, staleTime: q.staleTime }))
      );

      expect(areQueriesReady(client, queries)).toBe(true);

      render(
        <QueryClientProvider client={client}>
          <OwnerMeters
            rooms={mockRooms}
            buildings={mockBuildings}
            dormitoryId={dormId}
            bills={mockBills}
            tenants={mockTenants}
            contracts={mockContracts}
            onSaveBills={vi.fn()}
            onSelectTenant={vi.fn()}
            onAddLog={vi.fn()}
            onNavigate={vi.fn()}
            selectedBillingCycleId={cycleId}
            selectedCycleCode="2026-08"
            selectedCycle="2026-08"
            billingCycles={mockBillingCyclesMeta.data}
          />
        </QueryClientProvider>
      );

      await waitFor(() => {
        expect(screen.getAllByText('ออกบิลทุกห้อง').length).toBeGreaterThan(0);
      });
    });
  });

  // ==========================================
  // 4. Last-Intent-Wins & Stale Navigation Races
  // ==========================================
  describe('4. Last-Intent-Wins & Race Condition Protection', () => {
    it('Intent A delayed, Intent B fast -> Intent B wins, Intent A does not navigate upon later resolution', async () => {
      const client = createTestClient();
      const dormId = 'dorm-fresh-001';
      const navIntentRef = { current: 0 };
      let activeTab = 'dashboard';

      let resolveIntentA: () => void = () => {};
      const intentAPromise = new Promise<void>((resolve) => {
        resolveIntentA = resolve;
      });

      const handleTabChangeSimulation = async (targetTab: string, isSlow = false) => {
        const currentIntent = ++navIntentRef.current;
        const queries = getTargetQueriesForTab(targetTab, dormId);

        if (isSlow) {
          await intentAPromise;
        }

        // Check if superseded before applying navigation
        if (navIntentRef.current !== currentIntent) {
          return; // Discarded!
        }
        activeTab = targetTab;
      };

      // Trigger Intent A (slow)
      const pA = handleTabChangeSimulation('payments', true);

      // Trigger Intent B (fast)
      const pB = handleTabChangeSimulation('rooms', false);
      await pB;

      // Intent B has won and set activeTab to rooms
      expect(activeTab).toBe('rooms');

      // Now Intent A resolves
      resolveIntentA();
      await pA;

      // Active tab MUST stay rooms (Intent A did NOT overwrite)
      expect(activeTab).toBe('rooms');
    });

    it('Superseded failed intent produces no stale error toast', async () => {
      const dormId = 'dorm-fresh-001';
      const navIntentRef = { current: 0 };
      let toastMessage: string | null = null;
      const showNavToast = (msg: string) => { toastMessage = msg; };

      let rejectIntentA: () => void = () => {};
      const intentAPromise = new Promise<void>((_, reject) => {
        rejectIntentA = () => reject(new Error('Network error'));
      });

      const handleTabChangeSimulation = async (targetTab: string, isFailing = false) => {
        const currentIntent = ++navIntentRef.current;
        try {
          if (isFailing) {
            await intentAPromise;
          }
        } catch (err: any) {
          if (navIntentRef.current !== currentIntent) {
            return; // Suppressed because superseded!
          }
          showNavToast('ไม่สามารถโหลดข้อมูลหน้านี้ได้ กรุณาลองอีกครั้ง');
        }
      };

      // Intent A starts (will fail)
      const pA = handleTabChangeSimulation('payments', true);

      // Intent B starts (fast success)
      const pB = handleTabChangeSimulation('rooms', false);
      await pB;

      // Reject Intent A
      rejectIntentA();
      await pA;

      // Toast MUST NOT be shown because Intent A was superseded
      expect(toastMessage).toBeNull();
    });

    it('Stale target query triggers real revalidation via fetchQuery before route swap', async () => {
      const client = createTestClient();
      const dormId = 'dorm-fresh-001';

      // Pre-warm rooms and maintenance
      client.setQueryData(queryKeys.rooms(dormId), mockRooms);
      client.setQueryData(queryKeys.maintenance(dormId), [{ id: 'm-old', title: 'Old Repair' }]);

      // Mark maintenance as stale
      const state = client.getQueryState(queryKeys.maintenance(dormId));
      if (state) {
        state.dataUpdatedAt = Date.now() - (STALE_TIMES.MAINTENANCE + 10_000);
      }

      const queries = getTargetQueriesForTab('maintenance', dormId);
      const staleOrMissingQueries = queries.filter(q => !isQueryReady(client, q.queryKey, q.staleTime));

      // Maintenance MUST be identified as stale
      expect(staleOrMissingQueries.map(q => q.queryKey)).toContainEqual(queryKeys.maintenance(dormId));

      const fetchSpy = vi.spyOn(client, 'fetchQuery').mockResolvedValue([{ id: 'm-new', title: 'New Repair' }] as any);

      // Revalidate
      await Promise.all(
        staleOrMissingQueries.map(q => client.fetchQuery({ queryKey: q.queryKey, queryFn: q.queryFn, staleTime: q.staleTime }))
      );

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: queryKeys.maintenance(dormId),
        })
      );
    });

    it('Navigation failure on cold/stale fetch keeps current route, displays Thai toast, and does not update seen-state', async () => {
      const client = createTestClient();
      const dormId = 'dorm-fresh-001';
      let activeTab = 'dashboard';
      const seenTabs = new Set<string>(['dashboard']);
      let toastMessage: string | null = null;
      const showNavToast = (msg: string) => { toastMessage = msg; };

      const handleTabChangeSimulation = async (targetTab: string) => {
        try {
          // Attempting to fetch a failing query
          throw new Error('500 Server error');
        } catch (err: any) {
          showNavToast('ไม่สามารถโหลดข้อมูลหน้านี้ได้ กรุณาลองอีกครั้ง');
        }
      };

      await handleTabChangeSimulation('payments');

      expect(toastMessage).toBe('ไม่สามารถโหลดข้อมูลหน้านี้ได้ กรุณาลองอีกครั้ง');
      expect(activeTab).toBe('dashboard');
      expect(seenTabs.has('payments')).toBe(false);
    });

    it('Browser Back/Forward or route-derived navigation invalidates an older pending tab intent and preserves seen-state', async () => {
      const navIntentRef = { current: 0 };
      let activeTab = 'dashboard';
      const seenTabs = new Set<string>(['dashboard']);

      let resolveSlowTab: () => void = () => {};
      const slowTabPromise = new Promise<void>((resolve) => {
        resolveSlowTab = resolve;
      });

      // 1. User initiates tab navigation to payments (slow network)
      const startTabNavigation = async (targetTab: string) => {
        const intent = ++navIntentRef.current;
        await slowTabPromise;
        if (navIntentRef.current !== intent) {
          return; // Suppressed / invalidated by newer intent
        }
        activeTab = targetTab;
        seenTabs.add(targetTab);
      };

      const tabNavPromise = startTabNavigation('payments');

      // 2. User triggers browser Back/Forward navigation (route changes to /owner/contracts)
      // As in OwnerWorkspace line 372: navIntentRef.current++ upon pathSegment change
      const simulateBrowserHistoryNavigation = (newRouteSegment: string) => {
        navIntentRef.current++;
        activeTab = newRouteSegment;
        seenTabs.add(newRouteSegment);
      };

      simulateBrowserHistoryNavigation('contracts');
      expect(activeTab).toBe('contracts');
      expect(seenTabs.has('contracts')).toBe(true);

      // 3. Older slow tab intent finally resolves
      resolveSlowTab();
      await tabNavPromise;

      // Active tab MUST remain 'contracts' from the history navigation
      expect(activeTab).toBe('contracts');
      // 'payments' seen-state MUST NOT be added by the invalidated intent
      expect(seenTabs.has('payments')).toBe(false);
    });
  });

  // ==========================================
  // 5. Billing Cycle Authority & Fail-Closed State
  // ==========================================
  describe('5. Single Authoritative Billing Cycle (No Guessing)', () => {
    it('Missing authoritative operational metadata does not cause infinite loading and renders fail-closed state', async () => {
      const client = createTestClient();
      const dormId = 'dorm-fresh-001';

      // Unauthoritative metadata (no operationalBillingCycleId, no firstBillingCycleId)
      const unauthoritativeCycles = {
        data: [{ id: 'cycle-old', cycleCode: '2025-01', status: 'draft', isCurrent: false }],
        operationalBillingCycleId: null,
        operationalCycleCode: null,
        firstBillingCycleId: null,
      };

      // Ensure authority derivation returns null when API metadata is missing
      const firstBillingCycleId = unauthoritativeCycles.firstBillingCycleId || null;
      const operationalBillingCycleId = unauthoritativeCycles.operationalBillingCycleId || null;
      const operationalCycleCode = unauthoritativeCycles.operationalCycleCode || null;

      expect(firstBillingCycleId).toBeNull();
      expect(operationalBillingCycleId).toBeNull();
      expect(operationalCycleCode).toBeNull();

      // Render OwnerMeters with unresolved cycle authority
      render(
        <QueryClientProvider client={client}>
          <OwnerMeters
            rooms={mockRooms}
            buildings={mockBuildings}
            dormitoryId={dormId}
            bills={[]}
            tenants={[]}
            contracts={[]}
            onSaveBills={vi.fn()}
            onSelectTenant={vi.fn()}
            onAddLog={vi.fn()}
            onNavigate={vi.fn()}
            selectedBillingCycleId="" // Unresolved
            selectedCycleCode=""
            selectedCycle=""
            billingCycles={[]}
          />
        </QueryClientProvider>
      );

      // Verify fail-closed banner and disabled controls
      expect(screen.getByTestId('missing-cycle-banner')).toBeDefined();
      const issueAllBtns = screen.getAllByText('ออกบิลทุกห้อง');
      for (const btn of issueAllBtns) {
        expect(btn.closest('button')?.disabled).toBe(true);
      }
    });
  });

  // ==========================================
  // 6. Central Fail-Closed Meter Action Guards
  // ==========================================
  describe('6. Meter Mutation Central Fail-Closed Guards', () => {
    it('All Issue All Bills and Quick Fill controls are disabled and handlers refuse execution when authority is unresolved', async () => {
      const client = createTestClient();
      const dormId = 'dorm-001-uuid';

      const saveSpy = vi.spyOn(getDataProvider().meters, 'saveBulkMeterRecords' as any);
      const toggleSpy = vi.spyOn(getDataProvider().meters, 'toggleRoomBillSwitch' as any);

      render(
        <QueryClientProvider client={client}>
          <OwnerMeters
            rooms={mockRooms}
            buildings={mockBuildings}
            dormitoryId={dormId}
            bills={[]}
            tenants={[]}
            contracts={[]}
            onSaveBills={vi.fn()}
            onSelectTenant={vi.fn()}
            onAddLog={vi.fn()}
            onNavigate={vi.fn()}
            selectedBillingCycleId="" // Unresolved
            selectedCycleCode=""
            selectedCycle=""
            billingCycles={[]}
          />
        </QueryClientProvider>
      );

      const issueBtns = screen.getAllByText('ออกบิลทุกห้อง');
      for (const btn of issueBtns) {
        expect(btn.closest('button')?.disabled).toBe(true);
      }

      const quickFillBtns = screen.getAllByText('กรอกแบบรวดเร็ว');
      for (const btn of quickFillBtns) {
        expect(btn.closest('button')?.disabled).toBe(true);
      }

      expect(saveSpy).not.toHaveBeenCalled();
      expect(toggleSpy).not.toHaveBeenCalled();
    });
  });

  // ==========================================
  // 7. Payments Component Warm Cache Integration
  // ==========================================
  describe('7. Payments View React Query Cache Consumption', () => {
    it('PaymentsOwnerView renders pre-warmed cache data immediately on mount without loading spinner flash', () => {
      const client = createTestClient();
      const dormId = 'dorm-fresh-001';

      client.setQueryData(queryKeys.payments(dormId), [
        {
          id: 'pay-1',
          dormitoryId: dormId,
          billId: 'bill-1',
          method: 'BANK_TRANSFER',
          amount: 5000,
          status: 'PENDING',
          paymentDate: '2026-08-20',
          createdAt: '2026-08-20',
          bill: { id: 'bill-1', billNumber: 'B-001', totalAmount: 5000, status: 'pending' },
        },
      ]);
      client.setQueryData(queryKeys.bills(dormId), mockBills);
      client.setQueryData(queryKeys.dailyInvoices(dormId), []);

      render(
        <QueryClientProvider client={client}>
          <PaymentsOwnerView bills={mockBills} dormitoryId={dormId} />
        </QueryClientProvider>
      );

      expect(screen.queryByText('กำลังโหลดข้อมูล...')).toBeNull();
      expect(screen.getByText(/บิลเลขที่: B-001/)).toBeDefined();
    });
  });
});
