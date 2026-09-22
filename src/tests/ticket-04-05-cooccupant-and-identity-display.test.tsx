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
import { toCoOccupantApiDTO, toTenantApiDTO } from '../../server/src/mappers/tenant-api.mapper';

vi.mock('../utils/imageUtils', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    convertImageToWebP: vi.fn(async () => 'data:image/webp;base64,mockwebp'),
  };
});

describe('Ticket 04 & 05: Co-Occupant Headcount, History Status, LINE Display Name and Identity Presentation', () => {
  const mockDormitoryId = 'dorm-co-test';
  let queryClient: QueryClient;

  const sampleDormitory: Dormitory = {
    id: mockDormitoryId,
    name: 'TheRiCH Apartment',
    address: '123 สุขุมวิท',
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
      roomNumber: 'A-101',
      floor: 1,
      monthlyRent: 4000,
      termRent: 17500,
      termDurationMonths: 4,
      status: 'occupied',
      currentTenantId: 'tenant-1',
      images: [],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    } as any,
  ];

  const sampleContracts: Contract[] = [
    {
      id: 'contract-101',
      contractNumber: 'CTR-001',
      roomId: 'room-101',
      tenantId: 'tenant-1',
      status: 'active',
      startDate: '2026-09-01',
      endDate: '2027-01-01',
      durationMonths: 4,
      rentBillingType: 'term',
      rentAmount: 17500,
      depositAmount: 2500,
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
    } as any,
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
    cleanup();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    vi.spyOn(httpClient, 'httpRequest').mockImplementation(async () => ({}));
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

  it('1. Backend mappers: toCoOccupantApiDTO assigns action: added and valid timestamp, and toTenantApiDTO preserves lineFriend', () => {
    const rawCo = {
      id: 'co-1',
      tenantId: 't-1',
      name: 'ทดสอบ ผู้พักร่วม',
      phone: '0865989895',
      status: 'active',
      createdAt: new Date('2026-09-01T10:00:00Z'),
    };
    const mappedCo = toCoOccupantApiDTO(rawCo);
    expect(mappedCo).toBeTruthy();
    expect(mappedCo?.action).toBe('added');
    expect(mappedCo?.timestamp).toEqual(rawCo.createdAt);

    const rawTenant = {
      id: 't-1',
      tenantNumber: 'TNT-001',
      firstName: 'ภพสดนพนน',
      name: 'ภพสดนพนน',
      phone: '0865989895',
      status: 'active',
      lineFriendId: 'lf-uuid-1',
      lineFriend: { id: 'lf-uuid-1', displayName: 'Phoom', pictureUrl: null },
    };
    const mappedTenant = toTenantApiDTO(rawTenant);
    expect(mappedTenant).toBeTruthy();
    expect(mappedTenant?.lineFriend?.displayName).toBe('Phoom');
    expect(mappedTenant?.lineDisplayName).toBe('Phoom');
  });

  it('2. Co-Occupants Tab: renders headcount summary "ผู้เช่า 1 คน, ผู้พักร่วม 2 คน (รวมเป็น 3 คน)" and removes duplicate LINE badge from tab', () => {
    const tenant: Tenant = {
      id: 'tenant-1',
      name: 'ภพสดนพนน',
      phone: '0865989895',
      email: 'phoom@example.com',
      citizenId: '1234567890123',
      coOccupants: [
        { id: 'co-1', name: 'ผู้พักร่วมคนที่หนึ่ง', phone: '0811111111', relationship: 'แฟน' },
        { id: 'co-2', name: 'ผู้พักร่วมคนที่สอง', phone: '0822222222', relationship: 'เพื่อน' },
      ],
      coOccupantHistory: [
        {
          id: 'coh-1',
          name: 'ผู้พักร่วมคนที่หนึ่ง',
          phone: '0811111111',
          action: 'added',
          timestamp: '2026-09-01T10:00:00Z',
        },
        {
          id: 'coh-2',
          name: 'ผู้พักร่วมคนที่สอง',
          phone: '0822222222',
          action: 'added',
          timestamp: '2026-09-01T10:00:00Z',
        },
      ],
      emergencyContact: { name: 'ฉุกเฉิน', relationship: 'มารดา', phone: '0833333333' },
      vehicle: { type: 'none' },
      pet: { hasPet: false },
      rentalHistory: ['room-101'],
      status: 'active',
      roomId: 'room-101',
      lineFriendId: 'lf-1',
      lineFriend: { id: 'lf-1', displayName: 'Phoom' },
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
    };

    renderOwnerTenants([tenant], tenant.id);

    // Switch to Co-occupants tab (ผู้พักร่วม)
    const coTab = screen.getByRole('button', { name: /ผู้พักร่วม/i });
    fireEvent.click(coTab);

    // Verify Headcount Badge
    expect(screen.getByText('ผู้เช่า 1 คน, ผู้พักร่วม 2 คน (รวมเป็น 3 คน)')).toBeTruthy();

    // Verify duplicate LINE badge is NOT rendered in history/co-occupants tab
    expect(screen.queryByTestId('history-badge-bound-line')).toBeNull();

    // Verify Header STILL has the LINE display name
    const headerLineBadge = screen.getByTestId('header-badge-bound-line');
    expect(headerLineBadge.textContent).toContain('Phoom');

    // Verify Co-Occupant History shows "เพิ่มเข้าพัก", NOT "ลบออก / ย้ายออก"
    const addedBadges = screen.getAllByText('เพิ่มเข้าพัก');
    expect(addedBadges.length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('ลบออก / ย้ายออก')).toBeNull();
  });

  it('3. Pets and ID Card: Displays normalized pet items (สุนัข, แมว) and verified identity document status', () => {
    const tenant: Tenant = {
      id: 'tenant-1',
      name: 'ภพสดนพนน',
      phone: '0865989895',
      email: 'phoom@example.com',
      citizenId: '1234567890123',
      coOccupants: [],
      emergencyContact: { name: 'ฉุกเฉิน', relationship: 'มารดา', phone: '0833333333' },
      vehicle: { type: 'none' },
      pet: { hasPet: false },
      rentalHistory: ['room-101'],
      status: 'active',
      roomId: 'room-101',
      hasIdentityDocument: true,
      idCardObjectKey: 'identities/id-card-1.webp',
      petInfo: {
        hasPet: true,
        pets: [
          { type: 'dog', name: 'บัดดี้' },
          { type: 'cat', name: 'ไมโล' },
        ],
      },
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
    } as any;

    renderOwnerTenants([tenant], tenant.id);

    // Pets section should display "2 ตัว" and "สุนัข / บัดดี้" and "แมว / ไมโล" (both desktop and mobile view)
    expect(screen.getAllByText('2 ตัว').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('สุนัข').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('บัดดี้').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('แมว').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('ไมโล').length).toBeGreaterThanOrEqual(1);

    // Identity Document section should show "อัปโหลดแล้ว" and "ตรวจสอบและผ่านการรับรองแล้ว"
    expect(screen.getByText('อัปโหลดแล้ว')).toBeTruthy();
    expect(screen.getByText(/ตรวจสอบและผ่านการรับรองแล้ว/)).toBeTruthy();
  });
});
