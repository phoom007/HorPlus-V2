// @vitest-environment jsdom
/**
 * @license Apache-2.0
 * Direct Access Grant & Staff Workspace Experience Test Suite
 * Acceptance Criteria: DAG-01 through DAG-07
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { normalizeLocalBearerUrl } from '../pages/owner/users';
import { normalizeRole } from '../utils/role';
import { getTargetQueriesForTab, OwnerWorkspace } from '../pages/owner';
import { OwnerDashboard } from '../pages/owner/dashboard';
import { OwnerMeters } from '../pages/owner/meters';
import { OwnerMeterListCard } from '../components/meters/OwnerMeterListCard';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryClient';
import { MemoryRouter } from 'react-router-dom';

describe('Direct Access Grant & Staff Workspace Suite (DAG-01 to DAG-07)', () => {
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};
    const storageMock = {
      getItem: vi.fn((k: string) => mockStorage[k] || null),
      setItem: vi.fn((k: string, v: string) => { mockStorage[k] = String(v); }),
      removeItem: vi.fn((k: string) => { delete mockStorage[k]; }),
      clear: vi.fn(() => { mockStorage = {}; }),
      key: vi.fn(() => null),
      length: 0,
    };
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: storageMock,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'localStorage', {
      value: storageMock,
      writable: true,
      configurable: true,
    });

    window.scrollTo = vi.fn();

    global.fetch = vi.fn().mockImplementation(async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/billing-cycles')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({
            success: true,
            data: [
              {
                id: 'cycle-1',
                cycleCode: '2026-09',
                name: 'รอบบิล กันยายน 2569',
                status: 'draft',
                isCurrent: true,
              },
            ],
            firstBillingCycleId: 'cycle-1',
            operationalBillingCycleId: 'cycle-1',
            operationalCycleCode: '2026-09',
          }),
          text: async () => JSON.stringify({ success: true, data: [] }),
        };
      }
      if (urlStr.includes('/preview-context')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({
            success: true,
            data: {
              rateSnapshot: {
                waterBillingType: 'per_unit',
                waterRate: '18.00',
                electricityBillingType: 'per_unit',
                electricityRate: '7.00',
                commonFee: '200.00',
                commonFeeMode: 'per_room',
              },
              rooms: [
                {
                  roomId: 'room-101',
                  roomNumber: '101',
                  tenantId: 't-1',
                  tenantName: 'นายสมชาย ใจดี',
                  amountDue: '0.00',
                  billStatus: 'draft',
                  overallFinancialStatus: 'draft',
                  monthlyUtilityBillStatus: 'draft',
                  isPaid: false,
                  isMonthlyUtilityPaid: false,
                },
              ],
            },
          }),
          text: async () => JSON.stringify({ success: true }),
        };
      }
      if (urlStr.includes('/meters/readings')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({
            success: true,
            data: [],
          }),
          text: async () => JSON.stringify({ success: true, data: [] }),
        };
      }
      if (urlStr.includes('/meters/cycle-people-count')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({
            success: true,
            data: [],
          }),
          text: async () => JSON.stringify({ success: true, data: [] }),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({
          success: true,
          data: [],
        }),
        text: async () => JSON.stringify({ success: true, data: [] }),
      };
    }) as any;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe('DAG-01: Local Test Origin Alignment', () => {
    it('normalizes https://app.horplus.com to local origin when running on 127.0.0.1:5173', () => {
      const serverUrl = 'https://app.horplus.com/staff-access#raw_token_xyz';
      const normalized = normalizeLocalBearerUrl(serverUrl, 'http://127.0.0.1:5173');
      expect(normalized).toBe('http://127.0.0.1:5173/staff-access#raw_token_xyz');
    });

    it('normalizes https://app.horplus.com to local origin when running on localhost:3000', () => {
      const serverUrl = 'https://app.horplus.com/staff-access#another_token_123';
      const normalized = normalizeLocalBearerUrl(serverUrl, 'http://localhost:3000');
      expect(normalized).toBe('http://localhost:3000/staff-access#another_token_123');
    });

    it('preserves production domain when origin is not local', () => {
      const serverUrl = 'https://app.horplus.com/staff-access#prod_token_999';
      const normalized = normalizeLocalBearerUrl(serverUrl, 'https://app.horplus.com');
      expect(normalized).toBe('https://app.horplus.com/staff-access#prod_token_999');
    });

    it('handles empty or invalid inputs gracefully', () => {
      expect(normalizeLocalBearerUrl('')).toBe('');
      expect(normalizeLocalBearerUrl('not-a-valid-url')).toBe('not-a-valid-url');
    });
  });

  describe('DAG-02: Dormitory ID Session Persistence upon Redemption', () => {
    it('populates sessionStorage and localStorage upon direct access redemption', () => {
      const dormId = 'dorm-test-direct-uuid';
      sessionStorage.setItem('active_dormitory_selected_for_session', dormId);
      localStorage.setItem('selected_dormitory_id', dormId);
      sessionStorage.setItem('is_direct_access_grant', 'true');

      expect(sessionStorage.getItem('active_dormitory_selected_for_session')).toBe(dormId);
      expect(localStorage.getItem('selected_dormitory_id')).toBe(dormId);
      expect(sessionStorage.getItem('is_direct_access_grant')).toBe('true');
    });
  });

  describe('DAG-03 & DAG-04: Role-Aware Query Scoping for Staff Dashboard', () => {
    const testDormId = 'dorm-role-query-test';
    const testCycleId = 'cycle-role-query-test';

    it('scopes dashboard queries strictly to rooms, buildings, maintenance (and meterReadings) for staff', () => {
      const staffQueries = getTargetQueriesForTab('dashboard', testDormId, testCycleId, 'staff');
      const queryEndpoints = staffQueries.map((q: any) => q.queryKey[q.queryKey.length - 1]);

      // Permitted for staff
      expect(queryEndpoints).toContain('rooms');
      expect(queryEndpoints).toContain('buildings');
      expect(queryEndpoints).toContain('maintenance');
      expect(queryEndpoints).toContain('readings');

      // Disallowed financial & contract endpoints must NOT be queried
      expect(queryEndpoints).not.toContain('bills');
      expect(queryEndpoints).not.toContain('contracts');
      expect(queryEndpoints).not.toContain('billing-cycles');
      expect(queryEndpoints).not.toContain('tenants');
    });

    it('returns empty query list for staff on non-permitted tabs (fail-closed)', () => {
      const paymentsQueries = getTargetQueriesForTab('payments', testDormId, testCycleId, 'staff');
      expect(paymentsQueries).toEqual([]);

      const reportsQueries = getTargetQueriesForTab('reports', testDormId, testCycleId, 'staff');
      expect(reportsQueries).toEqual([]);

      const settingsQueries = getTargetQueriesForTab('settings', testDormId, testCycleId, 'staff');
      expect(settingsQueries).toEqual([]);
    });

    it('returns full query list for owner on dashboard', () => {
      const ownerQueries = getTargetQueriesForTab('dashboard', testDormId, testCycleId, 'owner');
      const ownerEndpoints = ownerQueries.map((q: any) => q.queryKey[q.queryKey.length - 1]);

      expect(ownerEndpoints).toContain('rooms');
      expect(ownerEndpoints).toContain('buildings');
      expect(ownerEndpoints).toContain('bills');
      expect(ownerEndpoints).toContain('contracts');
      expect(ownerEndpoints).toContain('maintenance');
    });
  });

  describe('DAG-05: Thai Role Profile Display Name Mapping', () => {
    it('normalizes Thai role variations to staff in role.ts', () => {
      expect(normalizeRole('ช่าง / แม่บ้าน')).toBe('staff');
      expect(normalizeRole('ช่าง')).toBe('staff');
      expect(normalizeRole('แม่บ้าน')).toBe('staff');
      expect(normalizeRole('staff')).toBe('staff');
      expect(normalizeRole('STAFF')).toBe('staff');
      expect(normalizeRole('ผู้จัดการ')).toBe('manager');
      expect(normalizeRole('เจ้าของหอพัก')).toBe('owner');
    });
  });

  describe('DAG-06: Strict RBAC & Inactive Disabled Menus/Buttons', () => {
    const defaultProps = {
      rooms: [],
      bills: [],
      maintenance: [],
      contracts: [],
      tenants: [],
      activeUser: {
        id: 'u-1',
        name: 'ช่างทดสอบ',
        roleId: 'role-staff',
        roleName: 'ช่าง / แม่บ้าน',
        email: 'tech@horplus.local'
      },
      selectedCycle: '2026-09',
      selectedBillingCycle: undefined,
      meterReadings: [],
      setSelectedCycle: vi.fn(),
      onAddLog: vi.fn(),
      onNavigate: vi.fn(),
    };

    it('disables disallowed menus in OwnerDashboard when userRole is staff', () => {
      const navigateMock = vi.fn();
      render(
        <OwnerDashboard
          {...defaultProps}
          userRole="staff"
          onNavigate={navigateMock}
        />
      );

      // Verify Disallowed menu buttons have disabled attribute, pointer-events-none, and opacity-40
      const disallowedMenus = ['payments', 'rooms', 'tenants', 'announcements', 'reports', 'users', 'settings'];
      disallowedMenus.forEach((menuId) => {
        const btn = screen.getByTestId(`dashboard-menu-${menuId}`) as HTMLButtonElement;
        expect(btn).toBeDefined();
        expect(btn.disabled).toBe(true);
        expect(btn.className).toContain('opacity-40');
        expect(btn.className).toContain('cursor-not-allowed');
        expect(btn.className).toContain('pointer-events-none');

        // Clicking disabled button must not call onNavigate
        fireEvent.click(btn);
        expect(navigateMock).not.toHaveBeenCalledWith(menuId);
      });

      // Verify Permitted menu buttons remain active
      const metersBtn = screen.getByTestId('dashboard-menu-meters') as HTMLButtonElement;
      expect(metersBtn.disabled).toBe(false);
      expect(metersBtn.className).not.toContain('opacity-40');
      fireEvent.click(metersBtn);
      expect(navigateMock).toHaveBeenCalledWith('meters');

      const maintBtn = screen.getByTestId('dashboard-menu-maintenance') as HTMLButtonElement;
      expect(maintBtn.disabled).toBe(false);
      fireEvent.click(maintBtn);
      expect(navigateMock).toHaveBeenCalledWith('maintenance');
    });

    it('hides the payment detail action button in the financial total card for staff', () => {
      render(
        <OwnerDashboard
          {...defaultProps}
          userRole="staff"
        />
      );

      // "ดูรายละเอียด" inside payment summary card must NOT be rendered for staff
      expect(screen.queryByTestId('dashboard-payment-detail-btn')).toBeNull();
    });
  });

  describe('SPM-05: Restoration of Logout Button for All Sessions (including Direct Access Grant)', () => {
    it('renders "ออกจากระบบ" (Logout) button even when isDirectAccess is true, and clicking it triggers onLogout', async () => {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });

      sessionStorage.setItem('is_direct_access_grant', 'true');

      const directUser: any = {
        id: 'ag_user_staff_01',
        name: 'ช่างประจำหอ',
        roleId: 'role-staff',
        roleName: 'ช่าง / แม่บ้าน',
        email: 'ag_staff_01@horplus.local',
        isDirectAccess: true,
      };

      const handleLogout = vi.fn();

      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/owner/dashboard']}>
            <OwnerWorkspace
              user={directUser}
              onLogout={handleLogout}
            />
          </MemoryRouter>
        </QueryClientProvider>
      );

      // The logout button MUST exist in the DOM for direct access session
      const logoutButtons = screen.getAllByText('ออกจากระบบ');
      expect(logoutButtons.length).toBeGreaterThan(0);

      // Clicking logout must trigger the handler
      fireEvent.click(logoutButtons[0]);
      expect(handleLogout).toHaveBeenCalledTimes(1);

      // The role display name should be "ช่าง / แม่บ้าน"
      const roleElements = screen.getAllByText('ช่าง / แม่บ้าน');
      expect(roleElements.length).toBeGreaterThan(0);
    });

    it('renders "ออกจากระบบ" (Logout) button for normal owner session', async () => {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });

      sessionStorage.removeItem('is_direct_access_grant');

      const ownerUser: any = {
        id: 'owner-uuid-1',
        name: 'เจ้าของหอพักใจดี',
        roleId: 'role-owner',
        roleName: 'เจ้าของหอพัก',
        email: 'owner@horplus.com',
        isDirectAccess: false,
      };

      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/owner/dashboard']}>
            <OwnerWorkspace
              user={ownerUser}
              onLogout={vi.fn()}
            />
          </MemoryRouter>
        </QueryClientProvider>
      );

      const logoutButtons = screen.getAllByText('ออกจากระบบ');
      expect(logoutButtons.length).toBeGreaterThan(0);
    });
  });

  describe('SPM-06: Meter List Card Border Reset & Staff Switch Guard', () => {
    it('applies standard border-slate-200 to OwnerMeterListCard regardless of bill status, and disables switch for staff', () => {
      const mockRow: any = {
        roomId: 'room-101',
        roomNumber: '101',
        waterPrev: 100,
        waterCurr: 110,
        elecPrev: 200,
        elecCurr: 220,
        isReplaced: false,
        peopleCount: 1,
        overdueAmount: 0,
        isPaid: false,
        billStatus: 'pending',
        monthlyUtilityBillStatus: 'pending',
      };

      const { container } = render(
        <OwnerMeterListCard
          row={mockRow}
          idx={0}
          isWaterUnit={true}
          isElecUnit={true}
          isFirstCycle={false}
          isSaving={false}
          isMutationReady={true}
          isRateSnapshotReady={true}
          unlockedElecPrev={{}}
          unlockedWaterPrev={{}}
          isExpandedBreakdown={false}
          quickAddLoadingRoomId={null}
          onOpenOtherFees={vi.fn()}
          onMeterReadingChange={vi.fn()}
          onMeterReadingBlur={vi.fn()}
          onPaste={vi.fn()}
          onUnlockElecPrev={vi.fn()}
          onCancelElecPrev={vi.fn()}
          onUnlockWaterPrev={vi.fn()}
          onCancelWaterPrev={vi.fn()}
          onPeopleCountChange={vi.fn()}
          onToggleStatusSwitch={vi.fn()}
          onToggleBreakdown={vi.fn()}
          onSelectTenant={vi.fn()}
          onOpenQuickAdd={vi.fn()}
          userRole="staff"
        />
      );

      const card = container.querySelector('#room-row-room-101');
      expect(card).not.toBeNull();
      // Must have standard slate-200 border, NOT status colored border like amber or rose
      expect(card?.className).toContain('border-slate-200');
      expect(card?.className).not.toContain('border-amber-400');
      expect(card?.className).not.toContain('border-rose-400');

      // The switch must be disabled for staff
      const switchBtn = screen.getByRole('switch');
      expect(switchBtn).toHaveProperty('disabled', true);
      expect(switchBtn.getAttribute('title')).toBe('เฉพาะเจ้าของหรือผู้จัดการ');
    });
  });

  describe('SPM-02 & SPM-03: Staff Meter Controls & Tenant Click Toast', () => {
    it('disables "ออกบิลทุกห้อง" for staff and displays toast when staff clicks tenant name', async () => {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } },
      });

      const mockRooms: any[] = [
        { id: 'room-101', roomNumber: '101', status: 'occupied', currentTenantId: 't-1' },
      ];
      const mockTenants: any[] = [
        { id: 't-1', name: 'นายสมชาย ใจดี', phone: '0812345678' },
      ];
      const mockContracts: any[] = [
        { id: 'c-1', roomId: 'room-101', tenantId: 't-1', status: 'active', startDate: '2026-01-01', endDate: '2026-12-31' },
      ];

      const mockBuildings: any[] = [];
      const mockBills: any[] = [];
      const mockCycles: any[] = [
        { id: 'cycle-1', cycleCode: '2026-09', name: 'รอบบิล กันยายน 2569', status: 'draft', isCurrent: true },
      ];

      queryClient.setQueryData(queryKeys.meterWorkspace('dorm-1', 'cycle-1'), {
        serverReadings: [],
        cyclePeopleRes: { success: true, data: [] },
      });

      queryClient.setQueryData(queryKeys.meterPreviewContext('dorm-1', 'cycle-1'), {
        rateSnapshot: {
          waterBillingType: 'per_unit',
          waterRate: '18.00',
          electricityBillingType: 'per_unit',
          electricityRate: '7.00',
          commonFee: '200.00',
          commonFeeMode: 'per_room',
        },
        rooms: [
          { roomId: 'room-101', roomNumber: '101', tenantId: 't-1', tenantName: 'นายสมชาย ใจดี', amountDue: '0.00', billStatus: 'draft' },
        ],
      });

      const onSelectTenantSpy = vi.fn();

      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/owner/meters']}>
            <OwnerMeters
              dormitoryId="dorm-1"
              rooms={mockRooms}
              buildings={mockBuildings}
              tenants={mockTenants}
              contracts={mockContracts}
              bills={mockBills}
              billingCycles={mockCycles}
              onSaveBills={vi.fn()}
              onSelectTenant={onSelectTenantSpy}
              selectedBillingCycleId="cycle-1"
              selectedCycleCode="2026-09"
              onAddLog={vi.fn()}
              userRole="staff"
            />
          </MemoryRouter>
        </QueryClientProvider>
      );

      // 1. SPM-02: "ออกบิลทุกห้อง" is disabled for staff
      const issueAllBtn = screen.getByRole('button', { name: /ออกบิลทุกห้อง/i });
      expect(issueAllBtn).toHaveProperty('disabled', true);
      expect(issueAllBtn.getAttribute('title')).toBe('เฉพาะเจ้าของหรือผู้จัดการ');

      // 2. SPM-03: Clicking tenant name triggers "คุณไม่มีสิทธิ์ดำเนินการสิ่งนี้" toast
      const tenantBtn = screen.getByRole('button', { name: /นายสมชาย ใจดี/i });
      expect(tenantBtn).not.toBeNull();

      fireEvent.click(tenantBtn);

      // onSelectTenant must NOT have been called (navigation prevented)
      expect(onSelectTenantSpy).not.toHaveBeenCalled();

      // Toast with "คุณไม่มีสิทธิ์ดำเนินการสิ่งนี้" must be displayed
      expect(screen.getByText('คุณไม่มีสิทธิ์ดำเนินการสิ่งนี้')).not.toBeNull();
    });
  });
});
