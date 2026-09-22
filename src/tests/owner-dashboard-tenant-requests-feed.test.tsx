/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OwnerDashboard } from '../pages/owner/dashboard';
import { Room, Contract, Tenant, User } from '../types';

describe('OwnerDashboard Tenant Requests Horizontal Feed (Screenshot 2 Parity)', () => {
  let queryClient: QueryClient;

  const mockUser: User = {
    id: 'user-001',
    username: 'owner',
    role: 'owner',
    roleCode: 'OWNER',
    name: 'เจ้าของหอพัก',
  };

  const sampleRooms: Room[] = [
    { id: 'r-101', roomNumber: '101', floor: 1, status: 'occupied', monthlyRent: 3500, depositAmount: 7000, buildingName: 'A' } as any,
    { id: 'r-201', roomNumber: '201', floor: 2, status: 'occupied', monthlyRent: 4000, depositAmount: 8000, buildingName: 'A' } as any,
    { id: 'r-301', roomNumber: '301', floor: 3, status: 'occupied', monthlyRent: 4500, depositAmount: 9000, buildingName: 'A' } as any,
    { id: 'r-401', roomNumber: '401', floor: 4, status: 'vacant', monthlyRent: 5000, depositAmount: 10000, buildingName: 'A' } as any,
  ];

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 0 },
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders all 4 request categories matching Screenshot 2 with badge count and category pills', async () => {
    const mockRegistrations = [
      {
        id: 'reg-401',
        requestedRoomId: 'r-401',
        roomNumber: '401',
        tenantName: 'คุณภัทร สมบูรณ์',
        proposedRent: 5000,
        proposedDeposit: 10000,
        startDate: '2026-10-01',
        status: 'pending',
        createdAt: new Date().toISOString(),
      },
    ];

    const mockMoveOuts = [
      {
        id: 'mo-101',
        roomId: 'r-101',
        roomNumber: '101',
        tenantName: 'คุณสมศักดิ์ มั่นคง',
        intendedMoveOutDate: '2026-09-30',
        deposit: 7000,
        status: 'pending',
        createdAt: new Date().toISOString(),
      },
    ];

    const mockRenewals = [
      {
        id: 'ren-301',
        roomNumber: '301',
        tenantName: 'คุณวันชัย มีสุข',
        requestedDurationMonths: 6,
        status: 'pending',
        createdAt: new Date().toISOString(),
      },
    ];

    const expiredContracts: Contract[] = [
      {
        id: 'c-201',
        roomId: 'r-201',
        tenantId: 't-201',
        roomNumber: '201',
        monthlyRent: 4000,
        depositAmount: 8000,
        startDate: '2025-09-01',
        endDate: '2026-08-31',
        status: 'expired',
      } as any,
    ];

    const sampleTenants: Tenant[] = [
      { id: 't-201', name: 'คุณนภา สดใส', phone: '0812345678', citizenId: '1234567890123' } as any,
    ];

    const mockJsonResponse = (data: any) => ({
      ok: true,
      status: 200,
      json: async () => data,
      text: async () => JSON.stringify(data),
      headers: new Headers({ 'content-type': 'application/json' }),
    });

    global.fetch = vi.fn().mockImplementation(async (url: any) => {
      const u = String(url);
      if (u.includes('/tenant-registrations')) return mockJsonResponse(mockRegistrations);
      if (u.includes('/tenant-move-out-requests')) return mockJsonResponse(mockMoveOuts);
      if (u.includes('/contract-renewals/requests')) return mockJsonResponse(mockRenewals);
      return mockJsonResponse([]);
    });

    render(
      <QueryClientProvider client={queryClient}>
        <OwnerDashboard
          dormitoryId="dorm-001"
          rooms={sampleRooms}
          bills={[]}
          maintenance={[]}
          contracts={expiredContracts}
          tenants={sampleTenants}
          activeUser={mockUser}
          selectedCycle="2026-09"
          onNavigate={vi.fn()}
        />
      </QueryClientProvider>
    );

    await waitFor(() => {
      const badge = screen.getByTestId('pending-requests-badge');
      expect(badge.textContent).toBe('4 รายการ');
    });

    // Check that all 4 cards appear
    const items = screen.getAllByTestId('tenant-request-item');
    expect(items.length).toBe(4);

    // Verify category pills
    expect(screen.getByText('แจ้งเลิกเช่า')).toBeDefined();
    expect(screen.getByText('สัญญาหมดอายุ')).toBeDefined();
    expect(screen.getByText('ขอต่อสัญญา')).toBeDefined();
    expect(screen.getByText('ขอลงทะเบียน')).toBeDefined();

    // Verify room numbers
    expect(screen.getByText(/ห้อง 101 · A/)).toBeDefined();
    expect(screen.getByText(/ห้อง 201 · A/)).toBeDefined();
    expect(screen.getByText(/ห้อง 301 · A/)).toBeDefined();
    expect(screen.getByText(/ห้อง 401 · A/)).toBeDefined();

    // Test category filter tabs: click "แจ้งเลิกเช่า" filter
    const moveOutFilterBtn = screen.getByTitle(/แจ้งเลิกเช่า \(1\)/);
    fireEvent.click(moveOutFilterBtn);

    const filteredItems = screen.getAllByTestId('tenant-request-item');
    expect(filteredItems.length).toBe(1);
    expect(screen.getByText(/ห้อง 101 · A/)).toBeDefined();
    expect(screen.queryByText(/ห้อง 201 · A/)).toBeNull();

    // Reset filter to all
    const allFilterBtn = screen.getByTitle(/ทั้งหมด \(4\)/);
    fireEvent.click(allFilterBtn);
    expect(screen.getAllByTestId('tenant-request-item').length).toBe(4);
  });
});
