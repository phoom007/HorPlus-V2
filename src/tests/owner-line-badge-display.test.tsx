/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * @vitest-environment happy-dom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as httpClient from '../data/httpClient';
import { OwnerTenants } from '../pages/owner/tenants';
import { Tenant, Room, Contract, Dormitory } from '../types';
import { PrismaTenantRepository } from '../../server/src/db/repositories/tenant.repository';

vi.mock('../utils/imageUtils', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    convertImageToWebP: vi.fn(async () => 'data:image/webp;base64,mockwebp'),
  };
});

vi.mock('../data/adapters/api', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    approveTenantRegistrationRequest: vi.fn(async () => ({ success: true })),
    rejectTenantRegistrationRequest: vi.fn(async () => ({ success: true })),
  };
});

describe('Ticket 03: Owner-Side LINE Linkage Status Badge Across All Menus and History', () => {
  const mockDormitoryId = 'dorm-badge-test';
  let queryClient: QueryClient;

  const sampleDormitory: Dormitory = {
    id: mockDormitoryId,
    name: 'หอพักทดสอบ',
    address: '123 ถนนสุขุมวิท กรุงเทพฯ',
    phone: '0812345678',
    billStyle: 'combined',
    billingDay: 25,
    dueDay: 5,
    lateFeeDaily: 100,
    waterUnitRate: 18,
    electricUnitRate: 8,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  } as any;

  const sampleRooms: Room[] = [
    {
      id: 'room-101',
      roomNumber: '101',
      floor: 1,
      monthlyRent: 5000,
      depositAmount: 10000,
      maxOccupants: 2,
      initialWaterMeter: 0,
      initialElectricMeter: 0,
      status: 'occupied',
      currentTenantId: 'tenant-bound-1',
      images: [],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'room-102',
      roomNumber: '102',
      floor: 1,
      monthlyRent: 5000,
      depositAmount: 10000,
      maxOccupants: 2,
      initialWaterMeter: 0,
      initialElectricMeter: 0,
      status: 'occupied',
      currentTenantId: 'tenant-unbound-1',
      images: [],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ];

  const sampleContracts: Contract[] = [
    {
      id: 'contract-101',
      contractNumber: 'CNT-101',
      roomId: 'room-101',
      tenantId: 'tenant-bound-1',
      status: 'active',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      durationMonths: 12,
      rentAmount: 5000,
      depositAmount: 10000,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'contract-102',
      contractNumber: 'CNT-102',
      roomId: 'room-102',
      tenantId: 'tenant-unbound-1',
      status: 'active',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      durationMonths: 12,
      rentAmount: 5000,
      depositAmount: 10000,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
    cleanup();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    });

    vi.spyOn(httpClient, 'httpRequest').mockImplementation(async () => {
      return {};
    });
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
  });

  const renderOwnerTenants = (tenants: Tenant[], initialTenantId?: string) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <OwnerTenants
          dormitoryId={mockDormitoryId}
          dormitory={sampleDormitory}
          tenants={tenants}
          rooms={sampleRooms}
          contracts={sampleContracts}
          bills={[]}
          initialTenantId={initialTenantId}
          onSaveTenants={vi.fn()}
          onSaveRooms={vi.fn()}
          onSaveContracts={vi.fn()}
          onSaveBills={vi.fn()}
          onAddLog={vi.fn()}
        />
      </QueryClientProvider>
    );
  };

  it('renders green LINE badge with display name on tenant card when LINE is linked via lineFriend', () => {
    const boundTenant: Tenant = {
      id: 'tenant-bound-1',
      name: 'สมชาย สายลม',
      phone: '0811111111',
      email: 'somchai@example.com',
      citizenId: '1234567890123',
      coOccupants: [],
      emergencyContact: { name: 'สมศรี', relationship: 'มารดา', phone: '0822222222' },
      vehicle: { type: 'none' },
      pet: { hasPet: false },
      rentalHistory: ['room-101'],
      status: 'active',
      roomId: 'room-101',
      lineFriendId: 'lf-uuid-1',
      lineFriend: { id: 'lf-uuid-1', displayName: 'Phoom' },
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    renderOwnerTenants([boundTenant]);

    const boundBadge = screen.getByTestId('badge-bound-line');
    expect(boundBadge).toBeTruthy();
    expect(boundBadge.textContent).toContain('Phoom');
  });

  it('renders green LINE badge with display name when tenant has lineDisplayName', () => {
    const boundTenant: Tenant = {
      id: 'tenant-bound-2',
      name: 'วิชัย ใจดี',
      phone: '0833333333',
      email: 'wichai@example.com',
      citizenId: '1234567890124',
      coOccupants: [],
      emergencyContact: { name: 'วิภา', relationship: 'พี่สาว', phone: '0844444444' },
      vehicle: { type: 'none' },
      pet: { hasPet: false },
      rentalHistory: ['room-101'],
      status: 'active',
      roomId: 'room-101',
      lineFriendId: 'lf-uuid-2',
      lineDisplayName: 'Phoom LINE',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    renderOwnerTenants([boundTenant]);

    const boundBadge = screen.getByTestId('badge-bound-line');
    expect(boundBadge).toBeTruthy();
    expect(boundBadge.textContent).toContain('Phoom LINE');
  });

  it('renders gray "ยังไม่ผูก LINE" badge on tenant card when LINE is not linked', () => {
    const unboundTenant: Tenant = {
      id: 'tenant-unbound-1',
      name: 'สมหญิง รักสงบ',
      phone: '0855555555',
      email: 'somying@example.com',
      citizenId: '1234567890125',
      coOccupants: [],
      emergencyContact: { name: 'สมพร', relationship: 'บิดา', phone: '0866666666' },
      vehicle: { type: 'none' },
      pet: { hasPet: false },
      rentalHistory: ['room-102'],
      status: 'active',
      roomId: 'room-102',
      lineFriendId: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    renderOwnerTenants([unboundTenant]);

    const unboundBadge = screen.getByTestId('badge-unbound-line');
    expect(unboundBadge).toBeTruthy();
    expect(unboundBadge.textContent).toContain('ยังไม่ผูก LINE');
  });

  it('renders green LINE badge with display name in Detail Modal Header when tenant is selected', () => {
    const boundTenant: Tenant = {
      id: 'tenant-bound-1',
      name: 'สมชาย สายลม',
      phone: '0811111111',
      email: 'somchai@example.com',
      citizenId: '1234567890123',
      coOccupants: [],
      emergencyContact: { name: 'สมศรี', relationship: 'มารดา', phone: '0822222222' },
      vehicle: { type: 'none' },
      pet: { hasPet: false },
      rentalHistory: ['room-101'],
      status: 'active',
      roomId: 'room-101',
      lineFriendId: 'lf-uuid-1',
      lineFriend: { id: 'lf-uuid-1', displayName: 'Phoom' },
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    renderOwnerTenants([boundTenant], boundTenant.id);

    const headerBoundBadge = screen.getByTestId('header-badge-bound-line');
    expect(headerBoundBadge).toBeTruthy();
    expect(headerBoundBadge.textContent).toContain('Phoom');
  });

  it('renders "ยังไม่ผูก LINE" in Detail Modal Header when selected tenant is not linked', () => {
    const unboundTenant: Tenant = {
      id: 'tenant-unbound-1',
      name: 'สมหญิง รักสงบ',
      phone: '0855555555',
      email: 'somying@example.com',
      citizenId: '1234567890125',
      coOccupants: [],
      emergencyContact: { name: 'สมพร', relationship: 'บิดา', phone: '0866666666' },
      vehicle: { type: 'none' },
      pet: { hasPet: false },
      rentalHistory: ['room-102'],
      status: 'active',
      roomId: 'room-102',
      lineFriendId: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    renderOwnerTenants([unboundTenant], unboundTenant.id);

    const headerUnboundBadge = screen.getByTestId('header-badge-unbound-line');
    expect(headerUnboundBadge).toBeTruthy();
    expect(headerUnboundBadge.textContent).toContain('ยังไม่ผูก LINE');
  });

  it('renders LINE badge for inactive / former tenant in history list and detail modal header', () => {
    const formerTenant: Tenant = {
      id: 'tenant-former-1',
      name: 'อดีต ผู้เช่า',
      phone: '0877777777',
      email: 'former@example.com',
      citizenId: '1234567890126',
      coOccupants: [],
      emergencyContact: { name: 'มารดา', relationship: 'มารดา', phone: '0888888888' },
      vehicle: { type: 'none' },
      pet: { hasPet: false },
      rentalHistory: ['room-101'],
      status: 'inactive',
      lineFriendId: 'lf-uuid-former',
      lineFriend: { id: 'lf-uuid-former', displayName: 'Phoom Former' },
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    renderOwnerTenants([formerTenant]);

    // Switch to "เลิกเช่าแล้ว" (inactive) tab
    const inactiveTabButton = screen.getByRole('button', { name: /เลิกเช่าแล้ว/i });
    fireEvent.click(inactiveTabButton);

    // Card should show bound badge with LINE name
    const cardBadge = screen.getByTestId('badge-bound-line');
    expect(cardBadge).toBeTruthy();
    expect(cardBadge.textContent).toContain('Phoom Former');

    // Click former tenant card to open detail modal
    fireEvent.click(screen.getByText('อดีต ผู้เช่า'));

    // Modal header should also show bound badge with LINE name
    const headerBadge = screen.getByTestId('header-badge-bound-line');
    expect(headerBadge).toBeTruthy();
    expect(headerBadge.textContent).toContain('Phoom Former');
  });
});

describe('TenantRepository: lineFriend and lineDisplayName mapping', () => {
  it('findById includes lineFriend and returns lineFriendId, lineFriend, and lineDisplayName', async () => {
    const mockPrisma: any = {
      tenant: {
        findFirst: vi.fn().mockResolvedValue({
          id: 't-1',
          dormitoryId: 'dorm-1',
          tenantNumber: 'T001',
          firstName: 'สมชาย',
          lastName: 'สายลม',
          displayName: 'สมชาย สายลม',
          phone: '0811111111',
          status: 'active',
          lineFriendId: 'lf-1',
          lineFriend: {
            id: 'lf-1',
            displayName: 'Phoom',
            pictureUrl: 'https://example.com/pic.jpg',
          },
          coOccupants: [],
          vehicles: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      },
      provisionalRentalTerm: { findFirst: vi.fn().mockResolvedValue(null) },
      dailyStay: { findFirst: vi.fn().mockResolvedValue(null) },
      contract: { findFirst: vi.fn().mockResolvedValue(null) },
    };

    const repo = new PrismaTenantRepository(mockPrisma);
    const result = await repo.findById('t-1', 'dorm-1');

    expect(mockPrisma.tenant.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          lineFriend: { select: { id: true, displayName: true, pictureUrl: true } },
        }),
      })
    );

    expect(result).toBeTruthy();
    expect(result?.lineFriendId).toBe('lf-1');
    expect(result?.lineFriend).toEqual({
      id: 'lf-1',
      displayName: 'Phoom',
      pictureUrl: 'https://example.com/pic.jpg',
    });
    expect(result?.lineDisplayName).toBe('Phoom');
  });

  it('findAll includes lineFriend and maps lineFriend and lineDisplayName', async () => {
    const mockPrisma: any = {
      tenant: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 't-1',
            dormitoryId: 'dorm-1',
            tenantNumber: 'T001',
            firstName: 'สมชาย',
            lastName: 'สายลม',
            displayName: 'สมชาย สายลม',
            phone: '0811111111',
            status: 'active',
            lineFriendId: 'lf-1',
            lineFriend: {
              id: 'lf-1',
              displayName: 'Phoom',
              pictureUrl: null,
            },
            coOccupants: [],
            vehicles: [],
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]),
        count: vi.fn().mockResolvedValue(1),
      },
      tenantRegistrationRequest: { findMany: vi.fn().mockResolvedValue([]) },
      provisionalRentalTerm: { findMany: vi.fn().mockResolvedValue([]) },
      dailyStay: { findMany: vi.fn().mockResolvedValue([]) },
      contract: { findMany: vi.fn().mockResolvedValue([]) },
    };

    const repo = new PrismaTenantRepository(mockPrisma);
    const { items, total } = await repo.findAll('dorm-1');

    expect(mockPrisma.tenant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          lineFriend: { select: { id: true, displayName: true, pictureUrl: true } },
        }),
      })
    );

    expect(total).toBe(1);
    expect(items[0].lineFriendId).toBe('lf-1');
    expect(items[0].lineFriend?.displayName).toBe('Phoom');
    expect(items[0].lineDisplayName).toBe('Phoom');
  });
});
