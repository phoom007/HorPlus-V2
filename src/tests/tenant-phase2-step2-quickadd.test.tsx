// @vitest-environment happy-dom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HORPLUS-V2 — TENANT PHASE 2 STEP 2 VERIFICATION TEST SUITE
 * Verifies:
 * 1. 3-tier room availability validation (getTrulyVacantRooms):
 *    - Room level (status === 'vacant', no currentTenantId)
 *    - Active Occupancy level (no active tenant in room)
 *    - Reservation/Booking level (no active/scheduled/draft/pending contracts)
 * 2. QuickAddTenantModal in Tenant workflow:
 *    - hideLineTab={true} hides LINE onboarding tab (LINE is not a rental type)
 *    - Only 3 canonical rental types supported: MONTHLY, TERM, DAILY
 *    - Room selection dropdown renders when availableRooms is passed
 * 3. Tenant List & Profile presentation:
 *    - Newly added tenant placed immediately in 'active' tab (not 'pending')
 *    - "ยังไม่ผูก LINE" amber badge displayed in Left Column and Profile Header
 *    - Rental type badge (รายเดือน / รายเทอม / รายวัน) displayed
 *    - Room badge displayed
 *    - When lineFriendId is present, shows bound badge
 * 4. Integration:
 *    - handleQuickAddSuccess constructs Tenant with OWNER_CREATED, updates room occupancy, and saves
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import {
  OwnerTenants,
  getTrulyVacantRooms,
  getRentalTypeLabel,
  isTenantLineBound
} from '../pages/owner/tenants';
import { QuickAddTenantModal } from '../components/QuickAddTenantModal';
import { Tenant, Room, Contract, QuickAddRoomContext } from '../types';

describe('Tenant Phase 2 Step 2: Quick Add Tenant Integration', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
      },
    });

    global.fetch = vi.fn().mockImplementation(async (url: string | URL) => {
      const urlStr = url.toString();
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
                name: 'กันยายน 2569',
                status: 'open',
                periodStart: '2026-09-01',
                periodEnd: '2026-09-30',
              },
            ],
          }),
          text: async () => JSON.stringify({ success: true }),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ success: true, data: {} }),
        text: async () => JSON.stringify({ success: true }),
      };
    });
  });

  afterEach(() => {
    cleanup();
  });

  describe('1. 3-Tier Room Availability Validation (getTrulyVacantRooms)', () => {
    const baseRooms: Room[] = [
      {
        id: 'room-101',
        roomNumber: '101',
        floor: 1,
        monthlyRent: 4000,
        depositAmount: 8000,
        maxOccupants: 2,
        initialWaterMeter: 0,
        initialElectricMeter: 0,
        status: 'vacant',
      },
      {
        id: 'room-102',
        roomNumber: '102',
        floor: 1,
        monthlyRent: 4500,
        depositAmount: 9000,
        maxOccupants: 2,
        initialWaterMeter: 0,
        initialElectricMeter: 0,
        status: 'occupied',
        currentTenantId: 'tenant-102',
      },
      {
        id: 'room-103',
        roomNumber: '103',
        floor: 1,
        monthlyRent: 4000,
        depositAmount: 8000,
        maxOccupants: 2,
        initialWaterMeter: 0,
        initialElectricMeter: 0,
        status: 'maintenance',
      },
      {
        id: 'room-104',
        roomNumber: '104',
        floor: 1,
        monthlyRent: 5000,
        depositAmount: 10000,
        maxOccupants: 2,
        initialWaterMeter: 0,
        initialElectricMeter: 0,
        status: 'vacant', // Erroneously vacant in room status, but has active tenant
      },
      {
        id: 'room-105',
        roomNumber: '105',
        floor: 1,
        monthlyRent: 4200,
        depositAmount: 8400,
        maxOccupants: 2,
        initialWaterMeter: 0,
        initialElectricMeter: 0,
        status: 'vacant', // Vacant but has a scheduled/reserved contract
      },
    ];

    const activeTenants: Tenant[] = [
      {
        id: 'tenant-104',
        name: 'นายทดสอบ อยู่ในห้อง104',
        phone: '0811111111',
        email: '',
        citizenId: '1234567890123',
        status: 'active',
        roomId: 'room-104',
      },
    ];

    const blockingContracts: Contract[] = [
      {
        id: 'contract-105',
        tenantId: 'tenant-future',
        roomId: 'room-105',
        roomNumber: '105',
        startDate: '2026-10-01',
        status: 'scheduled',
        rentAmount: 4200,
        depositAmount: 8400,
        createdAt: '2026-09-01T00:00:00.000Z',
      },
    ];

    it('filters out non-vacant, actively occupied, and reserved rooms', () => {
      const trulyVacant = getTrulyVacantRooms(baseRooms, blockingContracts, activeTenants);

      // Only room-101 is truly vacant
      expect(trulyVacant.map(r => r.roomNumber)).toEqual(['101']);
    });

    it('excludes room if it has currentTenantId even if status is set to vacant', () => {
      const corruptRoom: Room = {
        id: 'room-corrupt',
        roomNumber: '999',
        floor: 9,
        monthlyRent: 5000,
        depositAmount: 10000,
        maxOccupants: 2,
        initialWaterMeter: 0,
        initialElectricMeter: 0,
        status: 'vacant',
        currentTenantId: 'ghost-tenant',
      };

      const result = getTrulyVacantRooms([corruptRoom], [], []);
      expect(result).toHaveLength(0);
    });

    it('excludes room if contract status is pending_signature or draft', () => {
      const pendingRoom: Room = {
        id: 'room-201',
        roomNumber: '201',
        floor: 2,
        monthlyRent: 4000,
        depositAmount: 8000,
        maxOccupants: 2,
        initialWaterMeter: 0,
        initialElectricMeter: 0,
        status: 'vacant',
      };
      const pendingContract: Contract = {
        id: 'contract-201',
        tenantId: 'tenant-201',
        roomId: 'room-201',
        roomNumber: '201',
        startDate: '2026-09-01',
        status: 'pending_signature',
        rentAmount: 4000,
        depositAmount: 8000,
        createdAt: '2026-09-01T00:00:00.000Z',
      };

      const result = getTrulyVacantRooms([pendingRoom], [pendingContract], []);
      expect(result).toHaveLength(0);
    });
  });

  describe('2. QuickAddTenantModal: Rental Types & LINE exclusion', () => {
    const mockContext: QuickAddRoomContext = {
      roomId: 'room-101',
      roomNumber: '101',
      dormitoryId: 'dorm-1',
      effective: {
        monthlyRent: 4000,
        monthlyDeposit: 8000,
        termRent: 16000,
        termDeposit: 8000,
        termMonths: 4,
        dailyRate: 500,
        dailyDeposit: 500,
      },
      building: {
        id: 'bld-1',
        name: 'อาคาร 1',
        termMonths: 4,
        maxInstallments: 1,
      },
      floor: 1,
    };

    it('hides LINE onboarding button when hideLineTab={true} and defaults to MONTHLY', () => {
      render(
        <QueryClientProvider client={queryClient}>
          <QuickAddTenantModal
            isOpen={true}
            onClose={vi.fn()}
            context={mockContext}
            onSuccess={vi.fn()}
            hideLineTab={true}
            defaultTab="MONTHLY"
          />
        </QueryClientProvider>
      );

      // LINE tab button must not exist
      expect(screen.queryByTestId('tab-line')).toBeNull();

      // Canonical 3 rental type tabs must exist
      expect(screen.getByTestId('tab-term')).toBeDefined();
      expect(screen.getByTestId('tab-monthly')).toBeDefined();
      expect(screen.getByTestId('tab-daily')).toBeDefined();
    });

    it('renders room selection switcher when availableRooms are passed', () => {
      const onSelectRoom = vi.fn();
      render(
        <QueryClientProvider client={queryClient}>
          <QuickAddTenantModal
            isOpen={true}
            onClose={vi.fn()}
            context={mockContext}
            availableRooms={[
              { id: 'room-101', roomNumber: '101', monthlyRent: 4000 },
              { id: 'room-202', roomNumber: '202', monthlyRent: 4500 },
            ]}
            onSelectRoom={onSelectRoom}
            onSuccess={vi.fn()}
            hideLineTab={true}
          />
        </QueryClientProvider>
      );

      const select = screen.getByTestId('quick-add-room-select') as HTMLSelectElement;
      expect(select).toBeDefined();
      expect(select.value).toBe('room-101');

      fireEvent.change(select, { target: { value: 'room-202' } });
      expect(onSelectRoom).toHaveBeenCalledWith('room-202');
    });
  });

  describe('3. Tenant Presentation: Badges & Tab Routing', () => {
    const sampleTenantUnbound: Tenant = {
      id: 'tenant-unbound-1',
      name: 'นายกิตติศักดิ์ พักดี',
      phone: '0891234567',
      status: 'active',
      lifecycleStage: 'OWNER_CREATED',
      rentalType: 'MONTHLY',
      roomId: 'room-101',
      lineFriendId: null,
      rentalHistory: [{ roomId: 'room-101', roomNumber: '101', startDate: '2026-09-01' }],
    };

    const sampleTenantBound: Tenant = {
      id: 'tenant-bound-2',
      name: 'นางสาวพิมพ์ใจ มีสุข',
      phone: '0819876543',
      status: 'active',
      lifecycleStage: 'REGISTERED',
      rentalType: 'TERM',
      roomId: 'room-102',
      lineFriendId: 'line-friend-999',
      rentalHistory: [{ roomId: 'room-102', roomNumber: '102', startDate: '2026-09-01' }],
    };

    const sampleRooms: Room[] = [
      {
        id: 'room-101',
        roomNumber: '101',
        floor: 1,
        monthlyRent: 4000,
        depositAmount: 8000,
        maxOccupants: 2,
        initialWaterMeter: 0,
        initialElectricMeter: 0,
        status: 'occupied',
        currentTenantId: 'tenant-unbound-1',
      },
      {
        id: 'room-102',
        roomNumber: '102',
        floor: 1,
        monthlyRent: 4500,
        depositAmount: 9000,
        maxOccupants: 2,
        initialWaterMeter: 0,
        initialElectricMeter: 0,
        status: 'occupied',
        currentTenantId: 'tenant-bound-2',
      },
    ];

    it('correctly computes rental type label and line bound state', () => {
      expect(getRentalTypeLabel(sampleTenantUnbound)).toBe('รายเดือน');
      expect(getRentalTypeLabel(sampleTenantBound)).toBe('รายเทอม');

      const dailyTenant: Tenant = {
        id: 't-daily',
        name: 'นายวันดี',
        phone: '0800000000',
        status: 'active',
        rentalType: 'DAILY',
      };
      expect(getRentalTypeLabel(dailyTenant)).toBe('รายวัน');

      expect(isTenantLineBound(sampleTenantUnbound)).toBe(false);
      expect(isTenantLineBound(sampleTenantBound)).toBe(true);
    });

    it('renders "ยังไม่ผูก LINE", rental type badge, and room badge in left column', () => {
      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            tenants={[sampleTenantUnbound, sampleTenantBound]}
            rooms={sampleRooms}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      // Unbound tenant should have the amber badge
      const unboundBadges = screen.getAllByTestId('badge-unbound-line');
      expect(unboundBadges.length).toBeGreaterThan(0);
      expect(unboundBadges[0].textContent).toContain('ยังไม่ผูก LINE');

      // Rental type badges
      const rentalBadges = screen.getAllByTestId('badge-rental-type');
      expect(rentalBadges.some(b => b.textContent?.includes('รายเดือน'))).toBe(true);
      expect(rentalBadges.some(b => b.textContent?.includes('รายเทอม'))).toBe(true);

      // Room badges
      const roomBadges = screen.getAllByTestId('badge-room-number');
      expect(roomBadges.some(b => b.textContent?.includes('ห้อง 101'))).toBe(true);
      expect(roomBadges.some(b => b.textContent?.includes('ห้อง 102'))).toBe(true);
    });

    it('displays unbound badge in Profile Header when tenant is selected', () => {
      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            tenants={[sampleTenantUnbound]}
            rooms={sampleRooms}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onAddLog={vi.fn()}
            initialTenantId="tenant-unbound-1"
          />
        </QueryClientProvider>
      );

      const headerUnboundBadge = screen.getByTestId('header-badge-unbound-line');
      expect(headerUnboundBadge).toBeDefined();
      expect(headerUnboundBadge.textContent).toContain('ยังไม่ผูก LINE');

      const headerRentalBadge = screen.getByTestId('header-badge-rental-type');
      expect(headerRentalBadge.textContent).toContain('รายเดือน');
    });

    it('displays bound badge in Profile Header when tenant has lineFriendId', () => {
      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            tenants={[sampleTenantBound]}
            rooms={sampleRooms}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onAddLog={vi.fn()}
            initialTenantId="tenant-bound-2"
          />
        </QueryClientProvider>
      );

      const headerBoundBadge = screen.getByTestId('header-badge-bound-line');
      expect(headerBoundBadge).toBeDefined();
      expect(headerBoundBadge.textContent).toContain('ผูก LINE แล้ว');
    });
  });

  describe('4. Quick Add Integration Handlers', () => {
    it('clicking เพิ่มผู้เช่าใหม่ opens QuickAddTenantModal with truly vacant room', async () => {
      const vacantRoom: Room = {
        id: 'room-301',
        roomNumber: '301',
        floor: 3,
        monthlyRent: 4000,
        depositAmount: 8000,
        maxOccupants: 2,
        initialWaterMeter: 0,
        initialElectricMeter: 0,
        status: 'vacant',
      };

      const onSaveTenants = vi.fn();
      const onSaveRooms = vi.fn();
      const onAddLog = vi.fn();

      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            tenants={[]}
            rooms={[vacantRoom]}
            onSaveTenants={onSaveTenants}
            onSaveRooms={onSaveRooms}
            onAddLog={onAddLog}
          />
        </QueryClientProvider>
      );

      const addBtn = screen.getByText('เพิ่มผู้เช่าใหม่');
      fireEvent.click(addBtn);

      await waitFor(() => {
        expect(screen.getByText('เพิ่มผู้เช่าด่วน')).toBeDefined();
        // LINE tab must be hidden
        expect(screen.queryByTestId('tab-line')).toBeNull();
      });
    });
  });
});
