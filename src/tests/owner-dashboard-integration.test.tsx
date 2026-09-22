// @vitest-environment happy-dom
/**
 * @license Apache-2.0
 * Specification: SPEC-ODI-01
 * Owner Dashboard End-to-End Integration & Operational Workflow Test Suite
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OwnerDashboard } from '../pages/owner/dashboard';
import { OwnerTenants } from '../pages/owner/tenants';
import {
  calculateAuthoritativeUnpaidFinancials,
  aggregateTenantRequests
} from '../services/dashboard.service';
import { Room, Bill, Contract, Tenant, User } from '../types';

function mockJsonResponse(data: any, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}

describe('Owner Dashboard End-to-End Integration & Operational Workflow (SPEC-ODI-01)', () => {
  let queryClient: QueryClient;
  let mockStorage: Record<string, string> = {};

  const mockUser: User = {
    id: 'usr-owner-01',
    name: 'Somchai Horplus',
    email: 'somchai@horplus.local',
    roleId: 'owner',
    roleCode: 'owner',
    roleName: 'เจ้าของหอพัก',
    dormitoryId: 'dorm-main-001',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const sampleRooms: Room[] = [
    {
      id: 'room-101',
      roomNumber: '101',
      floor: 1,
      derivedFloor: 1,
      status: 'occupied',
      roomType: 'Standard',
      monthlyRent: 3500,
      depositAmount: 5000,
      currentTenantId: 'tenant-01',
      buildingId: 'bld-01',
      buildingName: 'อาคาร A',
      version: 1,
      maxOccupants: 2,
      initialWaterMeter: 100,
      initialElectricMeter: 200,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'room-102',
      roomNumber: '102',
      floor: 1,
      derivedFloor: 1,
      status: 'vacant',
      roomType: 'Deluxe',
      monthlyRent: 4200,
      depositAmount: 6000,
      buildingId: 'bld-01',
      buildingName: 'อาคาร A',
      version: 1,
      maxOccupants: 2,
      initialWaterMeter: 50,
      initialElectricMeter: 120,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'room-201',
      roomNumber: '201',
      floor: 2,
      derivedFloor: 2,
      status: 'occupied',
      roomType: 'Standard',
      monthlyRent: 3500,
      depositAmount: 5000,
      currentTenantId: 'tenant-02',
      buildingId: 'bld-01',
      buildingName: 'อาคาร A',
      version: 1,
      maxOccupants: 2,
      initialWaterMeter: 150,
      initialElectricMeter: 300,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  const sampleBills: Bill[] = [
    {
      id: 'bill-01',
      roomId: 'room-101',
      month: '2026-09',
      cycleId: '2026-09',
      totalAmount: 3500,
      paidAmount: 3500,
      outstandingAmount: 0,
      status: 'paid',
      rentAmount: 3500,
      waterAmount: 0,
      electricAmount: 0,
      dueDate: '2026-09-05',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'bill-02',
      roomId: 'room-201',
      month: '2026-09',
      cycleId: '2026-09',
      totalAmount: 4200,
      paidAmount: 0,
      outstandingAmount: 4200,
      status: 'overdue',
      rentAmount: 3500,
      waterAmount: 200,
      electricAmount: 500,
      dueDate: '2026-09-05',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  const sampleTenants: Tenant[] = [
    {
      id: 'tenant-01',
      name: 'ประสิทธิ์ สุขใจ',
      phone: '0812345678',
      email: 'prasit@example.com',
      citizenId: '1100000000001',
      roomId: 'room-101',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'tenant-02',
      name: 'วันเพ็ญ เดือนเด่น',
      phone: '0898765432',
      email: 'wanpen@example.com',
      citizenId: '1100000000002',
      roomId: 'room-201',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  const sampleContracts: Contract[] = [
    {
      id: 'contract-01',
      contractNumber: 'CTR-101-2026',
      roomId: 'room-101',
      tenantId: 'tenant-01',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      monthlyRent: 3500,
      depositAmount: 5000,
      status: 'active',
      rentType: 'monthly',
      paymentDueDay: 5,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'contract-02',
      contractNumber: 'CTR-201-2026',
      roomId: 'room-201',
      tenantId: 'tenant-02',
      startDate: '2025-10-01',
      endDate: '2026-09-30',
      monthlyRent: 3500,
      depositAmount: 5000,
      status: 'active',
      rentType: 'monthly',
      paymentDueDay: 5,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 0 },
      },
    });

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
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const renderDashboard = (props: Partial<React.ComponentProps<typeof OwnerDashboard>> = {}) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <OwnerDashboard
          dormitoryId="dorm-main-001"
          rooms={sampleRooms}
          bills={sampleBills}
          maintenance={[]}
          contracts={sampleContracts}
          tenants={sampleTenants}
          activeUser={mockUser}
          selectedCycle="2026-09"
          onNavigate={vi.fn()}
          {...props}
        />
      </QueryClientProvider>
    );
  };

  describe('1. Authoritative Tenant Requests & Empty State', () => {
    it('renders clean empty state with zero mock items when no requests are pending', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/tenant-registrations')) {
          return mockJsonResponse([]);
        }
        if (urlStr.includes('/tenant-move-out-requests')) {
          return mockJsonResponse([]);
        }
        if (urlStr.includes('/contract-renewals/requests')) {
          return mockJsonResponse([]);
        }
        if (urlStr.includes('/subscription')) {
          return mockJsonResponse({
            plan: { code: 'PRO' },
            expiresAt: new Date(Date.now() + 15 * 86400000).toISOString(),
          });
        }
        return mockJsonResponse([]);
      });

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByTestId('empty-tenant-requests')).toBeDefined();
        expect(screen.getByTestId('empty-tenant-requests').textContent).toContain('ไม่มีคำขอที่รอดำเนินการ');
      });

      // Must NOT contain any mock requests or items
      expect(screen.queryByTestId('tenant-request-item')).toBeNull();
      expect(screen.queryByTestId('pending-requests-badge')).toBeNull();
    });

    it('aggregates and renders real backend requests (registration, move-out, renewal)', async () => {
      const mockRegistrations = [
        {
          id: 'reg-101',
          requestedRoomId: 'room-102',
          roomNumber: '102',
          tenantName: 'สมศักดิ์ มั่นคง',
          phone: '0811112222',
          proposedRent: 4200,
          proposedDeposit: 6000,
          startDate: '2026-10-01',
          status: 'pending',
          createdAt: new Date().toISOString(),
        },
      ];

      const mockMoveOuts = [
        {
          id: 'mo-201',
          roomId: 'room-201',
          roomNumber: '201',
          contractId: 'contract-02',
          tenantId: 'tenant-02',
          tenantName: 'วันเพ็ญ เดือนเด่น',
          intendedMoveOutDate: '2026-09-30',
          refundBank: 'KBANK',
          refundAccount: '123-4-56789-0',
          status: 'pending',
          reason: 'ย้ายที่ทำงาน',
          createdAt: new Date().toISOString(),
        },
      ];

      const mockRenewals = [
        {
          id: 'ren-301',
          contractId: 'contract-01',
          tenantId: 'tenant-01',
          tenantName: 'ประสิทธิ์ สุขใจ',
          roomNumber: '101',
          requestedDurationMonths: 12,
          requestedStartDate: '2027-01-01',
          status: 'pending',
          createdAt: new Date().toISOString(),
        },
      ];

      global.fetch = vi.fn().mockImplementation(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/tenant-registrations')) {
          return mockJsonResponse(mockRegistrations);
        }
        if (urlStr.includes('/tenant-move-out-requests')) {
          return mockJsonResponse(mockMoveOuts);
        }
        if (urlStr.includes('/contract-renewals/requests')) {
          return mockJsonResponse(mockRenewals);
        }
        if (urlStr.includes('/subscription')) {
          return mockJsonResponse({
            plan: { code: 'PRO' },
            expiresAt: new Date(Date.now() + 10 * 86400000).toISOString(),
          });
        }
        return mockJsonResponse([]);
      });

      renderDashboard();

      await waitFor(() => {
        const badge = screen.getByTestId('pending-requests-badge');
        expect(badge.textContent).toBe('3 รายการ');
      });

      // Verify all 3 requests are rendered
      const items = screen.getAllByTestId('tenant-request-item');
      expect(items.length).toBe(3);

      expect(screen.getByText('ขอลงทะเบียน')).toBeDefined();
      expect(screen.getByText('แจ้งเลิกเช่า')).toBeDefined();
      expect(screen.getByText('ขอต่อสัญญา')).toBeDefined();
      expect(screen.getByText('สมศักดิ์ มั่นคง')).toBeDefined();
      expect(screen.getAllByText('วันเพ็ญ เดือนเด่น').length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('2. Request Approval & Rejection Mutations', () => {
    it('approves registration request and sends mutation to backend', async () => {
      const mockRegistrations = [
        {
          id: 'reg-007',
          requestedRoomId: 'room-102',
          roomNumber: '102',
          tenantName: 'กิตติศักดิ์ เจริญพร',
          phone: '0899998888',
          proposedRent: 4200,
          proposedDeposit: 6000,
          startDate: '2026-10-01',
          status: 'pending',
          createdAt: new Date().toISOString(),
        },
      ];

      const fetchMock = vi.fn().mockImplementation(async (url: any, options: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/tenant-registrations/reg-007/approve')) {
          return mockJsonResponse({ message: 'Approved' });
        }
        if (urlStr.includes('/tenant-registrations')) {
          return mockJsonResponse(mockRegistrations);
        }
        return mockJsonResponse([]);
      });
      global.fetch = fetchMock;

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByTestId('inspect-registration-btn')).toBeDefined();
        expect(screen.queryByTestId('approve-registration-btn')).toBeNull();
        expect(screen.queryByTestId('reject-registration-btn')).toBeNull();
      });

      // Click "ตรวจสอบ" to open approval modal
      fireEvent.click(screen.getByTestId('inspect-registration-btn'));

      // In approval modal, click confirm approve
      await waitFor(() => {
        expect(screen.getByTestId('modal-approval-confirm-btn')).toBeDefined();
      });
      fireEvent.click(screen.getByTestId('modal-approval-confirm-btn'));

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/tenant-registrations/reg-007/approve'),
          expect.objectContaining({ method: 'POST' })
        );
      });
    });

    it('rejects registration request via inspect button and reject sheet', async () => {
      const mockRegistrations = [
        {
          id: 'reg-008',
          requestedRoomId: 'room-102',
          roomNumber: '102',
          tenantName: 'อนุชา สบายดี',
          phone: '0855554444',
          status: 'pending',
          createdAt: new Date().toISOString(),
        },
      ];

      const fetchMock = vi.fn().mockImplementation(async (url: any, options: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/tenant-registrations/reg-008/reject')) {
          return mockJsonResponse({ message: 'Rejected' });
        }
        if (urlStr.includes('/tenant-registrations')) {
          return mockJsonResponse(mockRegistrations);
        }
        return mockJsonResponse([]);
      });
      global.fetch = fetchMock;

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByTestId('inspect-registration-btn')).toBeDefined();
      });

      // Click "ตรวจสอบ" to open approval modal
      fireEvent.click(screen.getByTestId('inspect-registration-btn'));

      // In approval modal, click [ปฏิเสธคำขอ]
      await waitFor(() => {
        expect(screen.getByTestId('modal-approval-reject-btn')).toBeDefined();
      });
      fireEvent.click(screen.getByTestId('modal-approval-reject-btn'));

      // In reject sheet, select 'อื่นๆ' and enter custom reason
      await waitFor(() => {
        expect(screen.getByTestId('reject-reason-select')).toBeDefined();
      });
      const select = screen.getByTestId('reject-reason-select');
      fireEvent.change(select, { target: { value: 'อื่นๆ' } });

      const customInput = screen.getByTestId('reject-custom-reason-input');
      fireEvent.change(customInput, { target: { value: 'เอกสารประจำตัวไม่ชัดเจน' } });

      fireEvent.click(screen.getByTestId('reject-sheet-confirm-btn'));

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/tenant-registrations/reg-008/reject'),
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('เอกสารประจำตัวไม่ชัดเจน'),
          })
        );
      });
    });

    it('executes move-out termination mutation from dialog', async () => {
      const mockMoveOuts = [
        {
          id: 'mo-999',
          roomId: 'room-201',
          roomNumber: '201',
          contractId: 'contract-02',
          tenantId: 'tenant-02',
          tenantName: 'วันเพ็ญ เดือนเด่น',
          intendedMoveOutDate: '2026-09-30',
          deposit: 5000,
          status: 'pending',
          createdAt: new Date().toISOString(),
        },
      ];

      const fetchMock = vi.fn().mockImplementation(async (url: any, options: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/emergency-terminate')) {
          return mockJsonResponse({ message: 'Terminated' });
        }
        if (urlStr.includes('/tenant-move-out-requests')) {
          return mockJsonResponse(mockMoveOuts);
        }
        return mockJsonResponse([]);
      });
      global.fetch = fetchMock;

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByTestId('terminate-move-out-btn')).toBeDefined();
      });

      fireEvent.click(screen.getByTestId('terminate-move-out-btn'));

      // Modal appears
      expect(screen.getByTestId('terminate-date-input')).toBeDefined();
      fireEvent.click(screen.getByTestId('confirm-terminate-btn'));

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('emergency-terminate'),
          expect.objectContaining({ method: 'POST' })
        );
      });
    });
  });

  describe('3. Strict Financial Parity & Zero Phantom Estimations', () => {
    it('calculates overdue total strictly based on bills with zero arbitrary +500 estimation', () => {
      // Room 101: bill paid (0 overdue)
      // Room 201: bill overdue (4,200 THB overdue)
      // Room 102: occupied without bill issued yet -> must contribute 0.00 THB!
      const unissuedRoom: Room = {
        ...sampleRooms[1],
        status: 'occupied',
        monthlyRent: 4000,
      };
      const roomsWithUnissued = [sampleRooms[0], unissuedRoom, sampleRooms[2]];

      const result = calculateAuthoritativeUnpaidFinancials(sampleBills, roomsWithUnissued, '2026-09');

      // Exactly 4,200 THB (zero +500 THB utility drift)
      expect(result.totalUnpaidAmount).toBe(4200);
      expect(result.unpaidRoomsCount).toBe(1);
    });

    it('renders exact financial overdue sum on dashboard UI matching payments workspace', async () => {
      global.fetch = vi.fn().mockImplementation(async () => {
        return mockJsonResponse([]);
      });

      renderDashboard();

      // Overdue bill is 4,200.00
      expect(screen.getByText(/4,200\.00/)).toBeDefined();
      expect(screen.getByText(/รอชำระ 1 ห้อง/)).toBeDefined();
    });
  });

  describe('4. Subscription Lifespan & Direct Navigation', () => {
    it('displays exact remaining days and navigates directly to /owner/subscription on badge click', async () => {
      const navigateMock = vi.fn();
      const expiresAt = new Date(Date.now() + 14 * 86400000).toISOString();

      global.fetch = vi.fn().mockImplementation(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/subscription/current') || urlStr.includes('/subscriptions/current') || urlStr.includes('/subscription/entitlements')) {
          return mockJsonResponse({
            plan: { code: 'PRO', name: 'Professional' },
            expiresAt,
            remainingDays: 14,
          });
        }
        return mockJsonResponse([]);
      });

      renderDashboard({ onNavigate: navigateMock });

      await waitFor(() => {
        const badge = screen.getByTestId('subscription-remaining-badge');
        expect(badge.textContent).toContain('14 วัน');
      });

      // Clicking badge must directly navigate to subscription workspace
      fireEvent.click(screen.getByTestId('subscription-remaining-badge'));
      expect(navigateMock).toHaveBeenCalledWith('subscription');
    });

    it('displays FREE (ถาวร) when subscription plan is free or has no expiration', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/subscription/current') || urlStr.includes('/subscriptions/current') || urlStr.includes('/subscription/entitlements')) {
          return mockJsonResponse({
            plan: { code: 'FREE', name: 'Free Tier' },
            expiresAt: null,
          });
        }
        return mockJsonResponse([]);
      });

      renderDashboard();

      await waitFor(() => {
        const badge = screen.getByTestId('subscription-remaining-badge');
        expect(badge.textContent).toContain('FREE (ถาวร)');
      });
    });
  });

  describe('5. Role-Aware Presentation for Staff (Maids / Techs)', () => {
    it('renders staff operational banner and completely masks financial revenue figures', async () => {
      global.fetch = vi.fn().mockImplementation(async () => {
        return mockJsonResponse([]);
      });

      renderDashboard({ userRole: 'staff' });

      // Operational banner must be rendered
      expect(screen.getByTestId('staff-operational-banner')).toBeDefined();
      expect(screen.getByText(/โหมดเจ้าหน้าที่ปฏิบัติการ/)).toBeDefined();

      // Financial figures and detail button must NOT be in the document
      expect(screen.queryByText(/4,200\.00/)).toBeNull();
      expect(screen.queryByTestId('dashboard-payment-detail-btn')).toBeNull();

      // Tenant requests section must be completely hidden from the DOM for staff
      expect(screen.queryByTestId('tenant-requests-section')).toBeNull();

      // Restricted menus must be completely hidden from the DOM for staff
      const disallowed = ['payments', 'rooms', 'tenants', 'announcements', 'reports', 'users', 'subscription', 'settings'];
      disallowed.forEach((id) => {
        expect(screen.queryByTestId(`dashboard-menu-${id}`)).toBeNull();
      });

      // Operational tools must be active
      const metersBtn = screen.getByTestId('dashboard-menu-meters') as HTMLButtonElement;
      expect(metersBtn.disabled).toBe(false);

      const maintBtn = screen.getByTestId('dashboard-menu-maintenance') as HTMLButtonElement;
      expect(maintBtn.disabled).toBe(false);
    });
  });

  describe('6. Room Quick Edit Persistence', () => {
    it('opens room edit modal and dispatches PUT mutation to backend', async () => {
      const fetchMock = vi.fn().mockImplementation(async (url: any, options: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/properties/rooms/room-101')) {
          return mockJsonResponse({ id: 'room-101' });
        }
        return mockJsonResponse([]);
      });
      global.fetch = fetchMock;

      renderDashboard();

      const editBtn = screen.getByTestId('edit-room-101-btn');
      fireEvent.click(editBtn);

      // Modal opens
      const rentInput = screen.getByTestId('edit-room-rent-input');
      const saveBtn = screen.getByTestId('btn-save-room');
      // Initially unmodified -> disabled
      expect((saveBtn as HTMLButtonElement).disabled).toBe(true);

      fireEvent.change(rentInput, { target: { value: '3800' } });
      // Modified -> enabled
      expect((saveBtn as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/properties/rooms/room-101'),
          expect.objectContaining({
            method: 'PUT',
            body: expect.stringContaining('"monthlyRent":"3800"'),
          })
        );
      });
    });
  });

  describe('7. User Feedback & UI Refinement Suite (Items 1-7)', () => {
    it('Item 1 & Item 4: renders "ต่ออายุ" menu item and displays red dot when isTrialEligible', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/subscriptions/current')) {
          return mockJsonResponse({
            plan: { code: 'PRO', name: 'HorPlus Pro' },
            isTrialEligible: true,
            trialStartedAt: null,
            expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
          });
        }
        return mockJsonResponse([]);
      });

      const onNavMock = vi.fn();
      renderDashboard({ onNavigate: onNavMock });

      await waitFor(() => {
        const subMenuBtn = screen.getByTestId('dashboard-menu-subscription');
        expect(subMenuBtn).toBeDefined();
        expect(subMenuBtn.textContent).toContain('ต่ออายุ');

        // Verify trial badge (red dot) is rendered inside subscription button
        const redDot = subMenuBtn.querySelector('.bg-rose-500');
        expect(redDot).not.toBeNull();

        // Clicking subscription menu navigates to 'subscription'
        fireEvent.click(subMenuBtn);
        expect(onNavMock).toHaveBeenCalledWith('subscription');
      });
    });

    it('Item 3: displays red dot on "ผู้เช่า" menu item when pending tenant requests exist', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/tenant-registrations')) {
          return mockJsonResponse([
            {
              id: 'reg-01',
              tenantName: 'สุรชัย มีสุข',
              roomNumber: '105',
              monthlyRent: 3500,
              deposit: 5000,
              status: 'PENDING',
              createdAt: new Date().toISOString(),
            },
          ]);
        }
        return mockJsonResponse([]);
      });

      renderDashboard();

      await waitFor(() => {
        const tenantsMenuBtn = screen.getByTestId('dashboard-menu-tenants');
        expect(tenantsMenuBtn).toBeDefined();
        const redDot = tenantsMenuBtn.querySelector('.bg-rose-500');
        expect(redDot).not.toBeNull();
      });
    });

    it('Item 5: displays grayscale LINE icon when workflow step 3 has not been reached', async () => {
      global.fetch = vi.fn().mockImplementation(async () => mockJsonResponse([]));

      // With unissued bills, step is 0 (จดมิเตอร์)
      renderDashboard({ bills: [] });

      const lineLogo = screen.getByTestId('line-official-logo');
      expect(lineLogo).toBeDefined();
      expect(lineLogo.getAttribute('class')).toContain('grayscale');
    });

    it('Item 6: renders "คำขอจากผู้เช่า" above "เมนูหลัก" in the layout order', async () => {
      global.fetch = vi.fn().mockImplementation(async () => mockJsonResponse([]));

      const { container } = renderDashboard();

      const tenantRequestsEl = screen.getByTestId('tenant-requests-section');
      const mainMenuHeading = screen.getByRole('heading', { name: 'เมนูหลัก' });

      // In the DOM hierarchy, tenantRequestsEl should appear before mainMenuHeading
      const position = tenantRequestsEl.compareDocumentPosition(mainMenuHeading);
      expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('Item 7: renders floor correctly without [Data Integrity Error] and handles room clicks based on occupancy', async () => {
      global.fetch = vi.fn().mockImplementation(async () => mockJsonResponse([]));

      // Test with room having floor: 1 and derivedFloor: undefined
      const testRooms: Room[] = [
        {
          id: 'room-301',
          roomNumber: '301',
          floor: 3,
          derivedFloor: undefined,
          status: 'occupied',
          monthlyRent: 3500,
          depositAmount: 5000,
          currentTenantId: 'tenant-01',
        } as any,
        {
          id: 'room-302',
          roomNumber: '302',
          floor: 3,
          derivedFloor: undefined,
          status: 'vacant',
          monthlyRent: 3500,
          depositAmount: 5000,
        } as any,
      ];

      const onNavMock = vi.fn();
      renderDashboard({
        rooms: testRooms,
        onNavigate: onNavMock,
      });

      // Verify no "[Data Integrity Error]" exists
      expect(screen.queryByText(/Data Integrity Error/)).toBeNull();

      // Floor 3 is rendered with building prefix
      const floor301 = screen.getByTestId('room-floor-301');
      expect(floor301.textContent).toBe('อาคารหลัก • ชั้น 3');

      // Room 101 from sampleRooms has buildingName 'อาคาร A' -> 'อาคาร A • ชั้น 1'
      // Test explicit building name without 'อาคาร' prefix like 'ชาญวิทย์'
      cleanup();
      renderDashboard({
        rooms: [
          {
            id: 'room-chanwit-1',
            roomNumber: '101',
            floor: 1,
            status: 'vacant',
            buildingName: 'ชาญวิทย์',
          } as any,
        ],
      });
      const floorChanwit = screen.getByTestId('room-floor-101');
      expect(floorChanwit.textContent).toBe('อาคารชาญวิทย์ • ชั้น 1');
    });
  });

  describe('8. User Refinements Suite (ODI-03)', () => {
    it('Item 3: reorders Workflow Stepper to be directly above Room Status Grid', async () => {
      global.fetch = vi.fn().mockImplementation(async () => mockJsonResponse([]));
      renderDashboard();

      const tenantRequestsEl = screen.getByTestId('tenant-requests-section');
      const mainMenuHeading = screen.getByRole('heading', { name: 'เมนูหลัก' });
      const stepperEl = screen.getByTestId('cycle-stepper-section');
      const totalRoomsCountEl = screen.getByTestId('total-rooms-count');

      // Order: tenantRequests -> mainMenuHeading -> stepperEl -> totalRoomsCountEl
      expect(tenantRequestsEl.compareDocumentPosition(mainMenuHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(mainMenuHeading.compareDocumentPosition(stepperEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(stepperEl.compareDocumentPosition(totalRoomsCountEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('Item 1: opens 100% parity room edit modal matching rooms.tsx with dirty checking and archive capability', async () => {
      const fetchMock = vi.fn().mockImplementation(async (url: any, opts: any) => {
        if (opts?.method === 'PUT') {
          return mockJsonResponse({ success: true });
        }
        return mockJsonResponse([]);
      });
      global.fetch = fetchMock;

      renderDashboard();

      const editBtn = screen.getByTestId('edit-room-101-btn');
      fireEvent.click(editBtn);

      // Parity Header
      expect(screen.getByText(/แก้ไขห้องพัก 101/)).toBeDefined();

      // Parity Fields present
      expect(screen.getByTestId('edit-room-number-input')).toBeDefined();
      expect(screen.getByTestId('edit-room-max-occupants-input')).toBeDefined();
      expect(screen.getByTestId('edit-room-term-rent-input')).toBeDefined();
      expect(screen.getByTestId('edit-room-rent-input')).toBeDefined();
      expect(screen.getByTestId('edit-room-daily-rent-input')).toBeDefined();
      expect(screen.getByTestId('edit-room-term-deposit-input')).toBeDefined();
      expect(screen.getByTestId('edit-room-deposit-input')).toBeDefined();
      expect(screen.getByTestId('edit-room-daily-deposit-input')).toBeDefined();
      expect(screen.getByTestId('edit-room-status-vacant-btn')).toBeDefined();
      expect(screen.getByTestId('edit-room-status-maintenance-btn')).toBeDefined();
      expect(screen.getByTestId('btn-delete-room')).toBeDefined();

      // Parity: Floor and Initial Meters are removed
      expect(screen.queryByTestId('edit-room-floor-input')).toBeNull();
      expect(screen.queryByTestId('edit-room-water-meter-input')).toBeNull();
      expect(screen.queryByTestId('edit-room-electric-meter-input')).toBeNull();

      // Mobile pull handle bar is present
      expect(screen.getByTestId('modal-pull-handle')).toBeDefined();

      // Save button is initially disabled (unmodified)
      const saveBtn = screen.getByTestId('btn-save-room');
      expect((saveBtn as HTMLButtonElement).disabled).toBe(true);

      // Modify values
      fireEvent.change(screen.getByTestId('edit-room-rent-input'), { target: { value: '4200' } });
      fireEvent.change(screen.getByTestId('edit-room-term-rent-input'), { target: { value: '16000' } });

      // Save button is now enabled
      expect((saveBtn as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/properties/rooms/room-101'),
          expect.objectContaining({
            method: 'PUT',
            body: expect.stringMatching(/"monthlyRent":\s*"?4200"?/),
          })
        );
      });
    });

    it('Mobile Room Edit Modal: supports smooth drag-down to dismiss', async () => {
      global.fetch = vi.fn().mockImplementation(async () => mockJsonResponse([]));
      renderDashboard();
      const editBtn = screen.getByTestId('edit-room-102-btn');
      fireEvent.click(editBtn);

      expect(screen.getByText(/แก้ไขห้องพัก 102/)).toBeDefined();
      const pullHandle = screen.getByTestId('modal-pull-handle');
      expect(pullHandle).toBeDefined();

      // Drag less than 80px -> does not dismiss
      fireEvent.touchStart(pullHandle, { touches: [{ clientY: 100 }] });
      fireEvent.touchMove(pullHandle, { touches: [{ clientY: 150 }] });
      fireEvent.touchEnd(pullHandle);
      expect(screen.getByText(/แก้ไขห้องพัก 102/)).toBeDefined();

      // Drag greater than 80px -> dismisses smoothly
      fireEvent.touchStart(pullHandle, { touches: [{ clientY: 100 }] });
      fireEvent.touchMove(pullHandle, { touches: [{ clientY: 220 }] });
      fireEvent.touchEnd(pullHandle);
      expect(screen.queryByText(/แก้ไขห้องพัก 102/)).toBeNull();
    });

    it('Item 2: renders back button to home/dashboard when returnContext has source dashboard or home', async () => {
      const mockReturnContextHome = {
        source: 'home' as const,
        tenantId: 'tenant-01',
        roomId: 'room-301',
        roomNumber: '301',
      };
      const mockOnReturn = vi.fn();

      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <OwnerTenants
            dormitoryId="dorm-test"
            tenants={[{ id: 'tenant-01', name: 'สมชาย ผู้เช่า', status: 'active', roomId: 'room-301' } as any]}
            rooms={[{ id: 'room-301', roomNumber: '301', status: 'occupied', currentTenantId: 'tenant-01' } as any]}
            contracts={[]}
            bills={[]}
            returnContext={mockReturnContextHome}
            onReturnToSource={mockOnReturn}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      // Back button appears with correct text
      const backBtn = screen.getByTestId('back-to-dashboard-btn');
      expect(backBtn).toBeDefined();
      expect(backBtn.textContent).toContain('กลับไปยังหน้าหลัก');

      // Clicking calls onReturnToSource immediately without delay
      fireEvent.click(backBtn);
      expect(mockOnReturn).toHaveBeenCalledWith(mockReturnContextHome);
    });

    it('Item 3: role-based visibility in Main Menu (Staff: 2, Manager: 8, Owner: 10 items)', async () => {
      global.fetch = vi.fn().mockImplementation(async () => mockJsonResponse([]));

      // Test Staff: Only 2 items (meters, maintenance)
      const { unmount: unmountStaff } = renderDashboard({ userRole: 'staff' });
      expect(screen.getByTestId('dashboard-menu-meters')).toBeDefined();
      expect(screen.getByTestId('dashboard-menu-maintenance')).toBeDefined();
      const staffDisallowed = ['payments', 'rooms', 'tenants', 'announcements', 'reports', 'users', 'subscription', 'settings'];
      staffDisallowed.forEach((id) => {
        expect(screen.queryByTestId(`dashboard-menu-${id}`)).toBeNull();
      });
      unmountStaff();

      // Test Manager: 8 items (payments, meters, rooms, tenants, maintenance, announcements, reports, subscription)
      const { unmount: unmountManager } = renderDashboard({ userRole: 'manager' });
      const managerAllowed = ['payments', 'meters', 'rooms', 'tenants', 'maintenance', 'announcements', 'reports', 'subscription'];
      managerAllowed.forEach((id) => {
        expect(screen.getByTestId(`dashboard-menu-${id}`)).toBeDefined();
      });
      expect(screen.queryByTestId('dashboard-menu-users')).toBeNull();
      expect(screen.queryByTestId('dashboard-menu-settings')).toBeNull();
      unmountManager();

      // Test Owner: All 10 items
      const { unmount: unmountOwner } = renderDashboard({ userRole: 'owner' });
      const allMenus = ['payments', 'meters', 'rooms', 'tenants', 'maintenance', 'announcements', 'reports', 'users', 'subscription', 'settings'];
      allMenus.forEach((id) => {
        expect(screen.getByTestId(`dashboard-menu-${id}`)).toBeDefined();
      });
      unmountOwner();
    });

    it('Item 4: handles room archiving with ConfirmDialog and mutation', async () => {
      const fetchMock = vi.fn().mockImplementation(async (url: any, opts: any) => {
        if (opts?.method === 'DELETE' || (opts?.method === 'PATCH' && String(url).includes('/archive'))) {
          return mockJsonResponse({ success: true });
        }
        return mockJsonResponse([]);
      });
      global.fetch = fetchMock;

      renderDashboard();

      // Open room 102 (vacant room)
      const editBtn = screen.getByTestId('edit-room-102-btn');
      fireEvent.click(editBtn);

      // Click archive button
      const archiveBtn = screen.getByTestId('btn-delete-room');
      fireEvent.click(archiveBtn);

      // Confirm dialog appears
      await waitFor(() => {
        expect(screen.getByText(/ยืนยันการจัดเก็บห้องพัก 102/)).toBeDefined();
      });

      // Confirm archive
      const allArchiveButtons = screen.getAllByRole('button', { name: 'จัดเก็บห้องพัก' });
      const confirmBtn = allArchiveButtons[allArchiveButtons.length - 1];
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/properties/rooms/room-102'),
          expect.objectContaining({
            method: 'DELETE',
          })
        );
      });
    });
  });
});
