/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * @vitest-environment happy-dom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TenantWorkspace } from '../pages/tenant';
import { Tenant } from '../types';

describe('Tenant Portal Phase 2: Smart Single-Tab Add Room & Multi-Room Workflow', () => {
  const mockTenant: Tenant = {
    id: 'tenant-001',
    name: 'ชาญวิทย์ สุขสบาย',
    phone: '081-111-1111',
    email: 'chanwit@example.com',
    citizenId: '1234567890123',
    dormitoryId: 'dorm-001',
    roomId: 'rm-303',
    roomNumber: '303',
    buildingName: 'ชาญวิทย์',
    status: 'active',
  } as any;

  const mockRoomsResponse = {
    rooms: [
      {
        tenantId: 'tenant-001',
        roomId: 'rm-303',
        roomNumber: '303',
        buildingName: 'ชาญวิทย์',
        isCurrent: true,
      },
      {
        tenantId: 'tenant-002',
        roomId: 'rm-304',
        roomNumber: '304',
        buildingName: 'ชาญวิทย์',
        isCurrent: false,
      },
    ],
  };

  const mockProfileResponse = {
    id: 'tenant-001',
    firstName: 'ชาญวิทย์',
    lastName: 'สุขสบาย',
    phone: '081-111-1111',
    email: 'chanwit@example.com',
    citizenId: '1234567890123',
    roomNumber: '303',
    buildingName: 'ชาญวิทย์',
    dormitory: {
      id: 'dorm-001',
      name: 'หอพักสุขสบาย (สุขุมวิท 71)',
    },
  };

  const mockUtilitiesResponse = {
    latestWater: {
      id: 'water-1',
      previousReading: 100,
      currentReading: 112,
      usageUnits: 12,
      unitPrice: 18,
      readAt: new Date().toISOString(),
    },
    latestElectric: {
      id: 'elec-1',
      previousReading: 500,
      currentReading: 595,
      usageUnits: 95,
      unitPrice: 8,
      readAt: new Date().toISOString(),
    },
    readings: [],
  };

  const mockVacantRoomsResponse = {
    success: true,
    data: [
      {
        id: 'rm-305',
        roomNumber: '305',
        floor: 3,
        monthlyRent: 4500,
        buildingName: 'ชาญวิทย์',
      },
    ],
  };

  const createJsonResponse = (data: any, ok = true, status = 200) => ({
    ok,
    status,
    headers: {
      get: (header: string) => {
        if (header.toLowerCase() === 'content-type') return 'application/json';
        return null;
      },
    },
    json: async () => data,
    text: async () => JSON.stringify(data),
  });

  beforeEach(() => {
    sessionStorage.clear();
    global.fetch = vi.fn(async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/v1/tenant-portal/rooms')) {
        return createJsonResponse(mockRoomsResponse) as any;
      }
      if (urlStr.includes('/api/v1/tenant-portal/profile')) {
        return createJsonResponse(mockProfileResponse) as any;
      }
      if (urlStr.includes('/api/v1/tenant-portal/utilities')) {
        return createJsonResponse({ data: mockUtilitiesResponse }) as any;
      }
      if (urlStr.includes('/api/v1/tenant-portal/available-rooms')) {
        return createJsonResponse(mockVacantRoomsResponse) as any;
      }
      if (urlStr.includes('/api/v1/tenant-portal/bills')) {
        return createJsonResponse([]) as any;
      }
      if (urlStr.includes('/api/v1/tenant-portal/maintenance')) {
        return createJsonResponse([]) as any;
      }
      if (urlStr.includes('/api/v1/tenant-portal/contract')) {
        return createJsonResponse({ activeContract: null }) as any;
      }
      if (urlStr.includes('/api/v1/tenant-portal/announcements')) {
        return createJsonResponse([]) as any;
      }
      if (urlStr.includes('/api/v1/tenant-portal/dormitory-info')) {
        return createJsonResponse({ id: 'dorm-001', name: 'หอพักสุขสบาย (สุขุมวิท 71)' }) as any;
      }
      if (urlStr.includes('/api/v1/tenant-claims/claim')) {
        // Default fail to test transition to request approval
        return createJsonResponse({ error: { message: 'CLAIM_MATCH_FAILED' } }, false, 404) as any;
      }
      if (urlStr.includes('/api/v1/tenant-registrations/request')) {
        return createJsonResponse({ success: true }) as any;
      }
      return createJsonResponse({}) as any;
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders header badge with room and building name formatted as "ห้อง 303 • ชาญวิทย์"', async () => {
    render(
      <MemoryRouter initialEntries={['/tenant']}>
        <TenantWorkspace tenant={mockTenant} onLogout={() => {}} />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/ห้อง 303 • ชาญวิทย์/)).toBeDefined();
    });
  });

  it('clicking room badge opens Room Switcher modal with rooms list and "เช่าห้องพักเพิ่ม" button', async () => {
    render(
      <MemoryRouter initialEntries={['/tenant']}>
        <TenantWorkspace tenant={mockTenant} onLogout={() => {}} />
      </MemoryRouter>
    );

    const roomBadge = await screen.findByText(/ห้อง 303 • ชาญวิทย์/);
    fireEvent.click(roomBadge);

    const title = await screen.findByText('เลือกห้องพัก');
    expect(title).toBeDefined();
    expect(screen.getByText('เช่าห้องพักเพิ่ม')).toBeDefined();
  });

  it('clicking "เช่าห้องพักเพิ่ม" opens smart single-flow modal with room dropdown and unmasked profile snippet', async () => {
    render(
      <MemoryRouter initialEntries={['/tenant']}>
        <TenantWorkspace tenant={mockTenant} onLogout={() => {}} />
      </MemoryRouter>
    );

    const roomBadge = await screen.findByText(/ห้อง 303 • ชาญวิทย์/);
    fireEvent.click(roomBadge);

    const addRoomBtn = await screen.findByText('เช่าห้องพักเพิ่ม');
    fireEvent.click(addRoomBtn);

    // Modal should show smart single-flow title
    const modalTitle = await screen.findByText('เช่าห้องพักเพิ่ม');
    expect(modalTitle).toBeDefined();

    // Check Step 1: Select room dropdown & unmasked profile
    expect(await screen.findByText('เลือกห้องว่างที่ต้องการเช่า *')).toBeDefined();
    expect(screen.getByText('คุณชาญวิทย์ สุขสบาย')).toBeDefined();
    expect(screen.getByText('081-111-1111')).toBeDefined();
    expect(screen.getByText('ตรวจสอบและดำเนินการต่อ')).toBeDefined();
  });

  it('Smart Case B: when room has no pre-added data, clicking proceed transitions to "ตรวจสอบ" screen for owner approval', async () => {
    render(
      <MemoryRouter initialEntries={['/tenant']}>
        <TenantWorkspace tenant={mockTenant} onLogout={() => {}} />
      </MemoryRouter>
    );

    const roomBadge = await screen.findByText(/ห้อง 303 • ชาญวิทย์/);
    fireEvent.click(roomBadge);

    const addRoomBtn = await screen.findByText('เช่าห้องพักเพิ่ม');
    fireEvent.click(addRoomBtn);

    // Select room 305
    const select = await screen.findByRole('combobox');
    fireEvent.change(select, { target: { value: 'rm-305' } });

    // Click "ตรวจสอบและดำเนินการต่อ"
    const proceedBtn = screen.getByText('ตรวจสอบและดำเนินการต่อ');
    await act(async () => {
      fireEvent.click(proceedBtn);
    });

    // Should transition to Case B: "ตรวจสอบ"
    expect(await screen.findByText('ตรวจสอบ')).toBeDefined();
    expect(screen.getByText(/ห้องนี้ยังไม่มีข้อมูลล่วงหน้าจากเจ้าของหอพัก/)).toBeDefined();
    expect(screen.getByText(/ห้อง 305 • ชาญวิทย์/)).toBeDefined();
    expect(screen.getByText('1234567890123')).toBeDefined();
    expect(screen.getByText('ส่งคำขอเช่าห้องพัก')).toBeDefined();
  });

  it('renders all 6 primary action tiles on the tenant dashboard', async () => {
    render(
      <MemoryRouter initialEntries={['/tenant']}>
        <TenantWorkspace tenant={mockTenant} onLogout={() => {}} />
      </MemoryRouter>
    );

    // Verify 6 tiles exist
    expect(await screen.findByText('ใบแจ้งหนี้')).toBeDefined();
    expect(screen.getByText('ชำระค่าเช่า')).toBeDefined();
    expect(screen.getByText('แจ้งซ่อมบำรุง')).toBeDefined();
    expect(screen.getByText('ค่าน้ำ / ค่าไฟ')).toBeDefined();
    expect(screen.getByText('เอกสารสัญญา')).toBeDefined();
    expect(screen.getByText('ประวัติการชำระ')).toBeDefined();
  });

  it('clicking "ค่าน้ำ / ค่าไฟ" tile opens utilities subview showing electricity and water meter stats', async () => {
    render(
      <MemoryRouter initialEntries={['/tenant']}>
        <TenantWorkspace tenant={mockTenant} onLogout={() => {}} />
      </MemoryRouter>
    );

    const utilitiesTile = await screen.findByText('ค่าน้ำ / ค่าไฟ');
    fireEvent.click(utilitiesTile);

    expect(await screen.findByText(/ค่าน้ำประปา/)).toBeDefined();
    expect(screen.getByText(/ค่าไฟฟ้า/)).toBeDefined();
    expect(screen.getByText(/อัตราหน่วยละ 18 บาท/)).toBeDefined();
    expect(screen.getByText(/อัตราหน่วยละ 8 บาท/)).toBeDefined();
  });
});
