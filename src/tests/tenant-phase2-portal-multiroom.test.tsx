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
      if (urlStr.includes('/tenant-registrations')) {
        return createJsonResponse({ success: true, data: { id: 'reg-new-001' } }) as any;
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

  it('TenantAddRoomModal displays room dropdown and unmasked profile snippet when open', async () => {
    render(
      <MemoryRouter initialEntries={['/tenant']}>
        <TenantWorkspace tenant={mockTenant} onLogout={() => {}} initialAddRoomModalOpen={true} />
      </MemoryRouter>
    );

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
        <TenantWorkspace tenant={mockTenant} onLogout={() => {}} initialAddRoomModalOpen={true} />
      </MemoryRouter>
    );

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

  it('Round 24 AC-R24-01 & AC-R24-03: submitting vacant room request posts to /api/v1/tenant-registrations with auto-filled profile and rent', async () => {
    let capturedUrl = '';
    let capturedBody: any = null;

    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (url: any, options: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/tenant-registrations')) {
        capturedUrl = urlStr;
        if (options?.body) {
          try {
            capturedBody = JSON.parse(options.body);
          } catch (_e) {}
        }
        return createJsonResponse({ success: true, data: { id: 'reg-new-001' } }) as any;
      }
      return (originalFetch as any)(url, options);
    });

    render(
      <MemoryRouter initialEntries={['/tenant']}>
        <TenantWorkspace tenant={mockTenant} onLogout={() => {}} initialAddRoomModalOpen={true} />
      </MemoryRouter>
    );

    // Select room 305
    const select = await screen.findByRole('combobox');
    fireEvent.change(select, { target: { value: 'rm-305' } });

    // Click proceed
    const proceedBtn = screen.getByText('ตรวจสอบและดำเนินการต่อ');
    await act(async () => {
      fireEvent.click(proceedBtn);
    });

    // Check Step 2 appears
    expect(await screen.findByText('ตรวจสอบ')).toBeDefined();

    // Agree to terms checkbox
    const termsCheckbox = screen.getByRole('checkbox');
    fireEvent.click(termsCheckbox);

    // Click submit request
    const submitBtn = screen.getByText('ส่งคำขอเช่าห้องพัก');
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    // Verify submission endpoint and payload
    expect(capturedUrl).toContain('/tenant-registrations');
    expect(capturedUrl).not.toContain('/tenant-registrations/request');
    expect(capturedBody).toBeDefined();
    expect(capturedBody.requestedRoomId).toBe('rm-305');
    expect(capturedBody.firstName).toBe('ชาญวิทย์');
    expect(capturedBody.lastName).toBe('สุขสบาย');
    expect(capturedBody.phone).toBe('081-111-1111');
    expect(capturedBody.citizenId).toBe('1234567890123');
    expect(capturedBody.proposedRent).toBe(4500);
    expect(capturedBody.rentalPlan).toBe('monthly');
    expect(capturedBody.agreedTerms).toBe(true);
    expect(capturedBody.signatureBase64).toBeDefined();
  });

  it('Round 24 AC-R24-02: when room has pre-linked candidate matching phone or name, instant claim succeeds immediately', async () => {
    let claimAttempted = false;
    let claimInputSent = '';

    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (url: any, options: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/v1/tenant-claims/claim')) {
        claimAttempted = true;
        if (options?.body) {
          try {
            const body = JSON.parse(options.body);
            claimInputSent = body.claimInput;
          } catch (_e) {}
        }
        return createJsonResponse({ success: true, data: { success: true, id: 'tenant-claim-123' } }) as any;
      }
      return (originalFetch as any)(url, options);
    });

    render(
      <MemoryRouter initialEntries={['/tenant']}>
        <TenantWorkspace tenant={mockTenant} onLogout={() => {}} initialAddRoomModalOpen={true} />
      </MemoryRouter>
    );

    // Select room 305
    const select = await screen.findByRole('combobox');
    fireEvent.change(select, { target: { value: 'rm-305' } });

    // Click proceed
    const proceedBtn = screen.getByText('ตรวจสอบและดำเนินการต่อ');
    await act(async () => {
      fireEvent.click(proceedBtn);
    });

    // Verify claim was attempted with tenant's phone
    expect(claimAttempted).toBe(true);
    expect(claimInputSent).toBe('081-111-1111');

    // Since claim succeeded, it should NOT transition to Step 2 ("ตรวจสอบ")
    expect(screen.queryByText('ตรวจสอบ')).toBeNull();
  });

  it('Round 25 AC-R25-01: submitting vacant room request uses room policyVersion (version: 8) from available-rooms API', async () => {
    let capturedBody: any = null;

    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (url: any, options: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/v1/tenant-portal/available-rooms')) {
        return createJsonResponse({
          success: true,
          policyVersion: 8,
          data: [
            {
              id: 'rm-305',
              roomNumber: '305',
              floor: 3,
              monthlyRent: 4500,
              buildingName: 'ชาญวิทย์',
              policyVersion: 8,
            },
          ],
        }) as any;
      }
      if (urlStr.includes('/tenant-registrations')) {
        if (options?.body) {
          try {
            capturedBody = JSON.parse(options.body);
          } catch (_e) {}
        }
        return createJsonResponse({ success: true, data: { id: 'reg-v8-001' } }) as any;
      }
      return (originalFetch as any)(url, options);
    });

    render(
      <MemoryRouter initialEntries={['/tenant']}>
        <TenantWorkspace tenant={mockTenant} onLogout={() => {}} initialAddRoomModalOpen={true} />
      </MemoryRouter>
    );

    // Select room 305
    const select = await screen.findByRole('combobox');
    fireEvent.change(select, { target: { value: 'rm-305' } });

    // Click proceed
    const proceedBtn = screen.getByText('ตรวจสอบและดำเนินการต่อ');
    await act(async () => {
      fireEvent.click(proceedBtn);
    });

    // Check Step 2 appears
    expect(await screen.findByText('ตรวจสอบ')).toBeDefined();

    // Agree to terms checkbox
    const termsCheckbox = screen.getByRole('checkbox');
    fireEvent.click(termsCheckbox);

    // Click submit request
    const submitBtn = screen.getByText('ส่งคำขอเช่าห้องพัก');
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    // Verify expectedPolicyVersion is dynamically set to 8
    expect(capturedBody).toBeDefined();
    expect(capturedBody.expectedPolicyVersion).toBe(8);
  });

  it('Round 25 AC-R25-02 & AC-R25-03: self-healing retry on 409 POLICY_VERSION_MISMATCH fetches fresh version and succeeds', async () => {
    let callCount = 0;
    let retriedPayload: any = null;

    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (url: any, options: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/tenant-registrations/public-policy')) {
        return createJsonResponse({
          data: {
            version: 8,
            dormitoryId: 'dorm-001',
          },
        }) as any;
      }
      if (urlStr.includes('/tenant-registrations')) {
        callCount++;
        if (callCount === 1) {
          // Simulate 409 policy mismatch on first call
          return createJsonResponse(
            {
              error: {
                code: 'POLICY_VERSION_MISMATCH',
                message: 'กฎระเบียบหรือเงื่อนไขของหอพักมีการเปลี่ยนแปลง กรุณาตรวจสอบและยอมรับเงื่อนไขใหม่อีกครั้ง',
              },
            },
            false,
            409
          ) as any;
        }
        // Second call (retry) should succeed with fresh version 8
        if (options?.body) {
          try {
            retriedPayload = JSON.parse(options.body);
          } catch (_e) {}
        }
        return createJsonResponse({ success: true, data: { id: 'reg-retry-002' } }) as any;
      }
      return (originalFetch as any)(url, options);
    });

    render(
      <MemoryRouter initialEntries={['/tenant']}>
        <TenantWorkspace tenant={mockTenant} onLogout={() => {}} initialAddRoomModalOpen={true} />
      </MemoryRouter>
    );

    // Select room 305
    const select = await screen.findByRole('combobox');
    fireEvent.change(select, { target: { value: 'rm-305' } });

    // Click proceed
    const proceedBtn = screen.getByText('ตรวจสอบและดำเนินการต่อ');
    await act(async () => {
      fireEvent.click(proceedBtn);
    });

    // Check Step 2 appears
    expect(await screen.findByText('ตรวจสอบ')).toBeDefined();

    // Agree to terms checkbox
    const termsCheckbox = screen.getByRole('checkbox');
    fireEvent.click(termsCheckbox);

    // Click submit request
    const submitBtn = screen.getByText('ส่งคำขอเช่าห้องพัก');
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    // Verify self-healing retried and succeeded with version 8
    expect(callCount).toBe(2);
    expect(retriedPayload).toBeDefined();
    expect(retriedPayload.expectedPolicyVersion).toBe(8);
  });

  // =========================================================================
  // Round 26: Full-Page Add Room View Navigation & Existing Profile Auto-fill
  // =========================================================================
  it('Round 26 AC-R26-01 & AC-R26-04: clicking "+ เช่าห้องพักเพิ่ม" navigates to TenantRegisterView room picker and back arrow returns to dashboard', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (url: any, options: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/tenant-portal/rooms')) {
        return createJsonResponse(mockRoomsResponse) as any;
      }
      if (urlStr.includes('/tenant-portal/profile')) {
        return createJsonResponse(mockProfileResponse) as any;
      }
      if (urlStr.includes('/tenant-portal/utilities')) {
        return createJsonResponse(mockUtilitiesResponse) as any;
      }
      if (urlStr.includes('/tenant-registrations/public-rooms') || urlStr.includes('/tenant-portal/available-rooms')) {
        return createJsonResponse(mockVacantRoomsResponse) as any;
      }
      if (urlStr.includes('/tenant-registrations/public-policy')) {
        return createJsonResponse({
          success: true,
          data: {
            version: 8,
            dormitoryId: 'dorm-001',
          },
        }) as any;
      }
      return (originalFetch as any)(url, options);
    });

    render(
      <MemoryRouter initialEntries={['/tenant']}>
        <TenantWorkspace tenant={mockTenant} onLogout={() => {}} />
      </MemoryRouter>
    );

    // 1. Open room switcher modal
    const roomBadge = await screen.findByText(/ห้อง 303 • ชาญวิทย์/);
    fireEvent.click(roomBadge);

    // 2. Click "+ เช่าห้องพักเพิ่ม" in room switcher
    const addRoomBtn = await screen.findByText('เช่าห้องพักเพิ่ม');
    await act(async () => {
      fireEvent.click(addRoomBtn);
    });

    // 3. Verify it navigated to full-page TenantRegisterView in room_picker mode
    expect(await screen.findByText('เลือกห้องพัก')).toBeDefined();
    expect(screen.getByTestId('room-search-input')).toBeDefined();

    // 4. Verify back button '<' returns to tenant dashboard
    const backBtn = screen.getByTestId('btn-room-picker-back');
    await act(async () => {
      fireEvent.click(backBtn);
    });

    // 5. Dashboard is restored
    expect(await screen.findByText(/ห้อง 303 • ชาญวิทย์/)).toBeDefined();
  });

  it('Round 26 AC-R26-02: selecting vacant room auto-fills existing tenant profile data 100%', async () => {
    const richTenant: any = {
      ...mockTenant,
      name: 'นาย ชาญวิทย์ สุขสบาย',
      phone: '081-111-1111',
      citizenId: '1234567890123',
      birthDate: '1995-05-20',
      address: '99/123 หมู่ 5 ถ.สุขุมวิท พระโขนง กทม.',
      email: 'chanwit.rich@example.com',
      emergencyContact: {
        name: 'สมศรี สุขสบาย',
        phone: '089-999-9999',
        relationship: 'ผู้ปกครอง',
      },
      vehicles: [
        { id: 'v-1', type: 'car', brand: 'Toyota', licensePlate: 'กข 1234' },
      ],
      pets: [
        { id: 'p-1', type: 'cat', name: 'มังคุด', count: 1 },
      ],
      idCardPhotoUrl: 'data:image/png;base64,mock-id-card-data',
    };

    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (url: any, options: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/tenant-portal/rooms')) {
        return createJsonResponse(mockRoomsResponse) as any;
      }
      if (urlStr.includes('/tenant-portal/profile')) {
        return createJsonResponse(mockProfileResponse) as any;
      }
      if (urlStr.includes('/tenant-portal/utilities')) {
        return createJsonResponse(mockUtilitiesResponse) as any;
      }
      if (urlStr.includes('/tenant-registrations/public-rooms') || urlStr.includes('/tenant-portal/available-rooms')) {
        return createJsonResponse({
          success: true,
          data: [
            {
              id: 'rm-305',
              roomNumber: '305',
              floor: 3,
              monthlyRent: 4500,
              buildingName: 'ชาญวิทย์',
              selectable: true,
              isVacant: true,
              status: 'vacant',
            },
          ],
        }) as any;
      }
      if (urlStr.includes('/tenant-registrations/public-policy')) {
        return createJsonResponse({
          success: true,
          data: {
            version: 8,
            dormitoryId: 'dorm-001',
          },
        }) as any;
      }
      return (originalFetch as any)(url, options);
    });

    render(
      <MemoryRouter initialEntries={['/tenant']}>
        <TenantWorkspace tenant={richTenant} onLogout={() => {}} />
      </MemoryRouter>
    );

    // 1. Open room switcher modal
    const roomBadge = await screen.findByText(/ห้อง 303 • ชาญวิทย์/);
    fireEvent.click(roomBadge);

    // 2. Click "+ เช่าห้องพักเพิ่ม"
    const addRoomBtn = await screen.findByText('เช่าห้องพักเพิ่ม');
    await act(async () => {
      fireEvent.click(addRoomBtn);
    });

    // 3. Room 305 is displayed as vacant room card
    const roomCard = await screen.findByTestId('room-card-305');
    await act(async () => {
      fireEvent.click(roomCard);
    });

    // 4. Plan bottom sheet appears -> click monthly plan
    const monthlyPlanBtn = await screen.findByTestId('plan-select-monthly');
    await act(async () => {
      fireEvent.click(monthlyPlanBtn);
    });

    // 5. Navigate to Step 2 (ข้อมูลผู้เช่า) to verify auto-filled profile fields
    const step2Btn = screen.getByTestId('step-indicator-2');
    await act(async () => {
      fireEvent.click(step2Btn);
    });

    // 6. Verify name, prefix, phone, citizenId, birthDate, address, email are 100% auto-filled
    const fullNameInput = (await screen.findByTestId('tenant-fullname-input')) as HTMLInputElement;
    const phoneInput = screen.getByTestId('tenant-phone-input') as HTMLInputElement;
    const citizenIdInput = screen.getByTestId('tenant-citizen-id-input') as HTMLInputElement;
    const birthDateInput = screen.getByTestId('tenant-birthdate-input') as HTMLInputElement;
    const addressInput = screen.getByTestId('tenant-address-input') as HTMLTextAreaElement;

    expect(fullNameInput.value).toBe('ชาญวิทย์ สุขสบาย');
    expect(phoneInput.value).toBe('081-111-1111');
    expect(citizenIdInput.value).toBe('1-2345-67890-12-3');
    expect(birthDateInput.value).toBe('20/05/2538');
    expect(addressInput.value).toBe('99/123 หมู่ 5 ถ.สุขุมวิท พระโขนง กทม.');
  });
});


