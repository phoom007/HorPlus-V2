/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OwnerTenants } from '../pages/owner/tenants';
import { Tenant, Room, Contract, Dormitory } from '../types';
import * as apiModule from '../data/adapters/api';
import * as httpClient from '../data/httpClient';

vi.mock('../utils/imageUtils', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    convertImageToWebP: vi.fn(async (file: File) => file),
  };
});

vi.mock('../data/adapters/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/adapters/api')>();
  return {
    ...actual,
    approveTenantRegistrationRequest: vi.fn(),
    rejectTenantRegistrationRequest: vi.fn(),
    terminateContract: vi.fn(),
  };
});

describe('Owner > Tenant Menu: Phase 1 Real Tenant Lifecycle Workflow', () => {
  let queryClient: QueryClient;

  const mockDormitoryId = 'dorm-lifecycle-001';
  const sampleDormitory: Dormitory = {
    id: mockDormitoryId,
    name: 'หอพักทดสอบวงจรผู้เช่า',
    address: '123 ถนนสุขุมวิท',
    totalRooms: 10,
    occupiedRooms: 1,
  } as any;

  const initialRooms: Room[] = [
    {
      id: 'room-101',
      roomNumber: '101',
      floor: 1,
      price: 5000,
      monthlyRent: 5000,
      deposit: 10000,
      monthlyDeposit: 10000,
      status: 'vacant',
      dormitoryId: mockDormitoryId,
    } as any,
    {
      id: 'room-102',
      roomNumber: '102',
      floor: 1,
      price: 5500,
      monthlyRent: 5500,
      deposit: 11000,
      monthlyDeposit: 11000,
      status: 'occupied',
      currentTenantId: 'tnt-resident-1',
      dormitoryId: mockDormitoryId,
    } as any,
  ];

  const pendingTenantRequest: Tenant = {
    id: 'req-register-101',
    name: 'นายสมศักดิ์ ขอย้ายเข้า',
    phone: '0891234567',
    status: 'pending',
    requestedRoomId: 'room-101',
    rentalType: 'MONTHLY',
    rentalPlan: 'monthly',
    requestedRent: 5000,
    requestedDeposit: 10000,
    requestedStartDate: '2026-09-01',
    requestedEndDate: '2027-08-31',
    requestedDurationMonths: 12,
    coOccupants: [],
    vehicles: [],
    pets: [],
    rentalHistory: [],
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  };

  const activeTenant: Tenant = {
    id: 'tnt-resident-1',
    name: 'นางสาววิไล พักอาศัย',
    phone: '0819876543',
    status: 'active',
    roomId: 'room-102',
    rentalType: 'MONTHLY',
    rentalPlan: 'monthly',
    requestedRent: 5500,
    requestedDeposit: 11000,
    requestedStartDate: '2026-08-01',
    requestedEndDate: '2027-07-31',
    requestedDurationMonths: 12,
    coOccupants: [],
    vehicles: [],
    pets: [],
    rentalHistory: ['102'],
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  };

  const activeContract: Contract = {
    id: 'ct-resident-1',
    contractNumber: 'CT-202608-102',
    roomId: 'room-102',
    tenantId: 'tnt-resident-1',
    status: 'active',
    startDate: '2026-08-01',
    endDate: '2027-07-31',
    durationMonths: 12,
    rentBillingType: 'monthly',
    rentAmount: 5500,
    depositAmount: 11000,
    depositStatus: 'paid',
    depositType: 'refundable',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    });

    vi.spyOn(httpClient, 'httpRequest').mockImplementation(async () => {
      return { paymentSettings: {} };
    });
  });

  afterEach(() => {
    cleanup();
  });

  describe('1. Approve Flow (ID Synchronization & State Transition)', () => {
    it('1.1 Approving a tenant from รอตรวจสอบ moves them to พักอาศัย using real tenant UUID returned by backend', async () => {
      const realTenantUuid = '11111111-2222-3333-4444-555555555555';
      const realContractUuid = '66666666-7777-8888-9999-000000000000';

      vi.mocked(apiModule.approveTenantRegistrationRequest).mockResolvedValue({
        success: true,
        data: {
          tenantId: realTenantUuid,
          contractId: realContractUuid,
          occupancyId: 'occ-12345',
          roomId: 'room-101',
          tenant: {
            id: realTenantUuid,
            name: 'นายสมศักดิ์ ขอย้ายเข้า',
          },
        },
      });

      let savedTenants: Tenant[] = [];
      let savedRooms: Room[] = [];
      let savedContracts: Contract[] = [];

      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            dormitory={sampleDormitory}
            tenants={[pendingTenantRequest, activeTenant]}
            rooms={initialRooms}
            contracts={[activeContract]}
            initialTenantId={pendingTenantRequest.id}
            onSaveTenants={(t) => { savedTenants = t; }}
            onSaveRooms={(r) => { savedRooms = r; }}
            onSaveContracts={(c) => { savedContracts = c; }}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      // Open approve modal
      const approveBtn = screen.getByRole('button', { name: /อนุมัติคำขอ/i });
      fireEvent.click(approveBtn);

      // Select room 101
      const roomSelect = screen.getByLabelText(/เลือกห้องพักที่ต้องการจัดสรร/i);
      fireEvent.change(roomSelect, { target: { value: 'room-101' } });

      // Click confirm button
      const confirmApproveBtn = screen.getByRole('button', { name: /ยืนยันอนุมัติและรับผู้เช่าเข้าพัก/i });
      await act(async () => {
        fireEvent.click(confirmApproveBtn);
      });

      // 1. Toast displays approval confirmation
      expect(screen.getByTestId('tenant-action-toast').textContent).toContain('อนุมัติคำขอเรียบร้อยแล้ว');

      // 2. Pending request ID must be removed and replaced with real tenant UUID
      expect(savedTenants.some(t => t.id === pendingTenantRequest.id)).toBe(false);
      const approvedTenant = savedTenants.find(t => t.id === realTenantUuid);
      expect(approvedTenant).toBeDefined();
      expect(approvedTenant?.status).toBe('active');

      // 3. Room 101 currentTenantId bound to real tenant UUID
      const room101 = savedRooms.find(r => r.id === 'room-101');
      expect(room101?.status).toBe('occupied');
      expect(room101?.currentTenantId).toBe(realTenantUuid);

      // 4. Contract tenantId bound to real tenant UUID
      const newContract = savedContracts.find(c => c.tenantId === realTenantUuid);
      expect(newContract).toBeDefined();
      expect(newContract?.roomId).toBe('room-101');
      expect(newContract?.status).toBe('active');
    });
  });

  describe('2. Reject Flow (Removal from All Categories)', () => {
    it('2.1 Rejecting a tenant request removes it completely from รอตรวจสอบ, พักอาศัย, and เลิกเช่าแล้ว', async () => {
      vi.mocked(apiModule.rejectTenantRegistrationRequest).mockResolvedValue({
        success: true,
        data: { status: 'rejected' },
      });

      let savedTenants: Tenant[] = [];

      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            dormitory={sampleDormitory}
            tenants={[pendingTenantRequest, activeTenant]}
            rooms={initialRooms}
            contracts={[activeContract]}
            initialTenantId={pendingTenantRequest.id}
            onSaveTenants={(t) => { savedTenants = t; }}
            onSaveRooms={vi.fn()}
            onSaveContracts={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      // Open reject modal
      const rejectBtn = screen.getByRole('button', { name: /ปฏิเสธคำขอ/i });
      fireEvent.click(rejectBtn);

      // Confirm reject
      const confirmRejectBtn = screen.getByRole('button', { name: /ยืนยันปฏิเสธ/i });
      await act(async () => {
        fireEvent.click(confirmRejectBtn);
      });

      // Assert API called
      expect(apiModule.rejectTenantRegistrationRequest).toHaveBeenCalledWith(
        pendingTenantRequest.id,
        expect.any(String)
      );

      // Assert the rejected request is removed from saved tenants list
      expect(savedTenants.some(t => t.id === pendingTenantRequest.id)).toBe(false);
    });
  });

  describe('3. Termination Architecture Preparation', () => {
    it('3.1 Terminating an active tenant updates state to inactive, vacates room, sets contract to terminated', async () => {
      vi.mocked(apiModule.terminateContract).mockResolvedValue({
        success: true,
        data: { id: 'ct-resident-1', status: 'terminated' },
      });

      let savedTenants: Tenant[] = [];
      let savedRooms: Room[] = [];
      let savedContracts: Contract[] = [];

      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            dormitory={sampleDormitory}
            tenants={[activeTenant]}
            rooms={initialRooms}
            contracts={[activeContract]}
            initialTenantId={activeTenant.id}
            onSaveTenants={(t) => { savedTenants = t; }}
            onSaveRooms={(r) => { savedRooms = r; }}
            onSaveContracts={(c) => { savedContracts = c; }}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      // Open terminate modal
      const terminateBtn = screen.getByRole('button', { name: /^เลิกเช่า$/i });
      fireEvent.click(terminateBtn);

      // Confirm terminate
      const confirmTerminateBtn = screen.getByRole('button', { name: /ยืนยันการเลิกเช่าคืนห้องพัก/i });
      await act(async () => {
        fireEvent.click(confirmTerminateBtn);
      });

      // Wait for the 1200ms animation timeout in handleConfirmTerminate
      await act(async () => {
        await new Promise((r) => setTimeout(r, 1500));
      });

      // Assert tenant marked inactive
      expect(savedTenants.find(t => t.id === activeTenant.id)?.status).toBe('inactive');

      // Assert room vacated
      const room102 = savedRooms.find(r => r.id === 'room-102');
      expect(room102?.status).toBe('vacant');
      expect(room102?.currentTenantId).toBeUndefined();

      // Assert contract terminated
      const terminatedContract = savedContracts.find(c => c.id === 'ct-resident-1');
      expect(terminatedContract?.status).toBe('terminated');
    });
  });
});
