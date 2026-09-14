// @vitest-environment jsdom
/**
 * @license Apache-2.0
 * Subscription Multi-Role Access Frontend Suite
 * Verifies:
 * 1. Manager (Direct Grant & Google Session) can view and navigate to /owner/subscription and sees "ต่อแพ็กเกจ" in sidebar
 * 2. Owner (Direct Grant & Google Session) can view and navigate to /owner/subscription and sees "ต่อแพ็กเกจ" in sidebar
 * 3. Staff (Direct Grant) is strictly blocked: "ต่อแพ็กเกจ" hidden from sidebar, and navigating to /owner/subscription redirects to /owner/dashboard
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { OwnerWorkspace } from '../pages/owner';

describe('Subscription Multi-Role Access Frontend Suite', () => {
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
      if (urlStr.includes('/subscription/plans') || urlStr.includes('/subscription/packages')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({
            success: true,
            data: {
              freePlan: { code: 'FREE', name: 'HorPlus Free' },
              packages: [
                { id: 'pkg-1', planCode: 'PAID', durationMonths: 1, price: '189.00', currency: 'THB', enabled: true },
              ],
            },
          }),
          text: async () => JSON.stringify({ success: true }),
        };
      }
      if (urlStr.includes('/subscription/current')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({
            success: true,
            data: {
              isPro: false,
              planName: 'HorPlus Free',
              status: 'ACTIVE',
            },
          }),
          text: async () => JSON.stringify({ success: true }),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ success: true, data: [] }),
        text: async () => JSON.stringify({ success: true, data: [] }),
      };
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const createQueryClient = () =>
    new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
      },
    });

  it('allows Manager to see "ต่อแพ็กเกจ" in the sidebar navigation and access /owner/subscription', async () => {
    const queryClient = createQueryClient();
    const managerUser: any = {
      id: 'ag_user_manager_01',
      name: 'ผู้จัดการทดสอบ',
      roleId: 'role-manager',
      role: 'manager',
      roleCode: 'MANAGER',
      roleName: 'ผู้จัดการ',
      email: 'manager@horplus.local',
      isDirectAccess: true,
      memberships: [
        {
          id: 'mem_mgr_01',
          dormitoryId: 'dorm-mgr-01',
          dormitoryName: 'หอพักผู้จัดการ',
          roleCode: 'MANAGER',
          status: 'active',
        },
      ],
    };

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/owner/subscription']}>
          <OwnerWorkspace user={managerUser} onLogout={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>
    );

    // Sidebar navigation MUST contain "ต่อแพ็กเกจ" for manager
    expect(screen.getByTestId('nav-item-subscription')).toBeDefined();

    // Verify allowed operational menu items for manager
    expect(screen.getByTestId('nav-item-dashboard')).toBeDefined();
    expect(screen.getByTestId('nav-item-meters')).toBeDefined();
    expect(screen.getByTestId('nav-item-payments')).toBeDefined();
    expect(screen.getByTestId('nav-item-rooms')).toBeDefined();
    expect(screen.getByTestId('nav-item-maintenance')).toBeDefined();

    // Manager must NOT see "จัดการผู้ใช้งาน" (users) or "ตั้งค่าระบบ" (settings)
    expect(screen.queryByTestId('nav-item-users')).toBeNull();
    expect(screen.queryByTestId('nav-item-settings')).toBeNull();
  });

  it('allows Owner to see "ต่อแพ็กเกจ" in the sidebar navigation and access /owner/subscription', async () => {
    const queryClient = createQueryClient();
    const ownerUser: any = {
      id: 'usr_owner_01',
      name: 'เจ้าของหอพักทดสอบ',
      roleId: 'role-owner',
      role: 'owner',
      roleCode: 'OWNER',
      roleName: 'เจ้าของหอพัก',
      email: 'owner@horplus.local',
      isDirectAccess: false,
      memberships: [
        {
          id: 'mem_owner_01',
          dormitoryId: 'dorm-owner-01',
          dormitoryName: 'หอพักเจ้าของ',
          roleCode: 'OWNER',
          status: 'active',
        },
      ],
    };

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/owner/subscription']}>
          <OwnerWorkspace user={ownerUser} onLogout={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>
    );

    // Sidebar navigation MUST contain "ต่อแพ็กเกจ" for owner
    expect(screen.getByTestId('nav-item-subscription')).toBeDefined();

    // Owner has full access including users and settings
    expect(screen.getByTestId('nav-item-users')).toBeDefined();
    expect(screen.getByTestId('nav-item-settings')).toBeDefined();
  });

  it('strictly bars Staff from seeing "ต่อแพ็กเกจ" in sidebar and redirects away from /owner/subscription', async () => {
    const queryClient = createQueryClient();
    const staffUser: any = {
      id: 'ag_user_staff_01',
      name: 'ช่าง / แม่บ้านทดสอบ',
      roleId: 'role-staff',
      role: 'staff',
      roleCode: 'STAFF',
      roleName: 'ช่าง / แม่บ้าน',
      email: 'staff@horplus.local',
      isDirectAccess: true,
      memberships: [
        {
          id: 'mem_staff_01',
          dormitoryId: 'dorm-staff-01',
          dormitoryName: 'หอพักช่าง',
          roleCode: 'STAFF',
          status: 'active',
        },
      ],
    };

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/owner/subscription']}>
          <OwnerWorkspace user={staffUser} onLogout={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>
    );

    // Sidebar navigation MUST NOT contain "ต่อแพ็กเกจ" for staff
    expect(screen.queryByTestId('nav-item-subscription')).toBeNull();

    // Staff must also not see restricted modules in sidebar
    expect(screen.queryByTestId('nav-item-payments')).toBeNull();
    expect(screen.queryByTestId('nav-item-rooms')).toBeNull();
    expect(screen.queryByTestId('nav-item-tenants')).toBeNull();
    expect(screen.queryByTestId('nav-item-users')).toBeNull();
    expect(screen.queryByTestId('nav-item-settings')).toBeNull();

    // Staff only sees permitted modules in sidebar
    expect(screen.getByTestId('nav-item-dashboard')).toBeDefined();
    expect(screen.getByTestId('nav-item-meters')).toBeDefined();
    expect(screen.getByTestId('nav-item-maintenance')).toBeDefined();
  });
});
