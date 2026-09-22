/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * @vitest-environment happy-dom
 *
 * TENANT PHASE 3 STEP 3C.5A TEST SUITE
 * Acceptance Gap Closure:
 * 1. Rental-Type-Aware Renewal (Monthly vs Term vs Daily)
 * 2. Term duration data authority (not hardcoded to 4 months)
 * 3. C2-9 Room selector visible option labels (room number only) + external helper badge
 * 4. Daily stay restrictions (No Contract tab, No Contract Renewal button, Has Daily Stay extension)
 * 5. Printed lease canonical data & signature streaming
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as httpClient from '../data/httpClient';
import { OwnerTenants } from '../pages/owner/tenants';
import { Tenant, Room, Contract, Dormitory } from '../types';

vi.mock('../utils/imageUtils', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    convertImageToWebP: vi.fn(async () => 'data:image/webp;base64,mockwebp'),
  };
});

describe('Tenant Phase 3 Step 3C.5A: Type-Aware Renewal, C2-9 Room Labels & Term Authority', () => {
  const mockDormitoryId = 'dorm-uat-3c5';
  let queryClient: QueryClient;

  const sampleDormitory: Dormitory = {
    id: mockDormitoryId,
    name: 'หอพักสุขสบาย (สุขุมวิท 71)',
    address: '123/45 ซอยสุขุมวิท 71 แขวงพระโขนงเหนือ เขตวัฒนา กรุงเทพฯ 10110',
    ownerName: 'สมบูรณ์ สุขสว่าง',
    roomsCount: 20,
    occupiedRooms: 15,
    floorsCount: 4,
    bankAccountName: 'สมบูรณ์ สุขสว่าง',
    bankAccountNumber: '123-4-56789-0',
    bankCode: 'KBANK',
    promptpayNumber: '0812345678',
    waterRate: 18,
    electricityRate: 8,
    commonFee: 200,
    dueDay: 5,
  } as any;

  const sampleRooms: Room[] = [
    {
      id: 'room-101',
      dormitoryId: mockDormitoryId,
      roomNumber: '101',
      status: 'occupied',
      currentTenantId: 'tnt-monthly-001',
      price: 4500,
      monthlyRent: 4500,
      deposit: 9000,
      floor: 1,
      type: 'standard',
    },
    {
      id: 'room-105',
      dormitoryId: mockDormitoryId,
      roomNumber: '105',
      status: 'occupied',
      currentTenantId: 'tnt-term-013',
      price: 18000,
      termRent: 18000,
      deposit: 5000,
      floor: 1,
      type: 'standard',
    },
    {
      id: 'room-106',
      dormitoryId: mockDormitoryId,
      roomNumber: '106',
      status: 'occupied',
      currentTenantId: 'tnt-daily-106',
      price: 500,
      dailyRent: 500,
      deposit: 500,
      floor: 1,
      type: 'standard',
    },
    {
      id: 'room-304',
      dormitoryId: mockDormitoryId,
      roomNumber: '304',
      status: 'vacant',
      price: 5000,
      monthlyRent: 5000,
      termRent: 22000,
      deposit: 10000,
      floor: 3,
      type: 'standard',
    },
    {
      id: 'room-305',
      dormitoryId: mockDormitoryId,
      roomNumber: '305',
      status: 'vacant',
      price: 5200,
      monthlyRent: 5200,
      deposit: 10400,
      floor: 3,
      type: 'deluxe',
    },
  ];

  // Active Monthly Tenant
  const activeMonthlyTenant: Tenant = {
    id: 'tnt-monthly-001',
    name: 'นายสมชาย ใจดี',
    phone: '0812345678',
    status: 'active',
    roomId: 'room-101',
    rentalType: 'MONTHLY',
    rentalPlan: 'monthly',
    coOccupants: [],
    vehicles: [],
    pets: [],
    rentalHistory: ['101'],
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  };

  const monthlyContract: Contract = {
    id: 'ct-monthly-001',
    contractNumber: 'CT-202601-101',
    tenantId: 'tnt-monthly-001',
    roomId: 'room-101',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    durationMonths: 12,
    rentAmount: 4500,
    depositAmount: 9000,
    rentBillingType: 'monthly',
    status: 'active',
    tenantSignature: 'sig-tenant-001.png',
    ownerSignature: 'sig-owner-001.png',
    signedByTenantAt: '2026-01-01T08:00:00.000Z',
    signedByOwnerAt: '2026-01-01T09:00:00.000Z',
    terms: 'สัญญาเช่าห้องพักรายเดือนมาตรฐาน',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  // Active Term Tenant with 5 months duration (data-driven, not hardcoded 4)
  const activeTermTenant: Tenant = {
    id: 'tnt-term-013',
    name: 'นางสาวพิมพา สดใส',
    phone: '0897654321',
    status: 'active',
    roomId: 'room-105',
    rentalType: 'TERM',
    rentalPlan: 'term',
    coOccupants: [],
    vehicles: [],
    pets: [],
    rentalHistory: ['105'],
    createdAt: '2026-06-01',
    updatedAt: '2026-06-01',
  };

  const termContract: Contract = {
    id: 'ct-term-013',
    contractNumber: 'CT-202606-105',
    tenantId: 'tnt-term-013',
    roomId: 'room-105',
    startDate: '2026-06-01',
    endDate: '2026-10-31',
    durationMonths: 5,
    rentAmount: 22500,
    depositAmount: 5000,
    rentBillingType: 'term',
    status: 'active',
    tenantSignature: 'sig-tenant-013.png',
    ownerSignature: 'sig-owner-001.png',
    terms: 'สัญญาเช่าห้องพักรายเทอม 5 เดือนพิเศษ',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  };

  // Active Daily Tenant
  const activeDailyTenant: Tenant = {
    id: 'tnt-daily-106',
    name: 'เอกชัย รายวันสิงหา',
    phone: '0865551234',
    status: 'active',
    roomId: 'room-106',
    rentalType: 'DAILY',
    rentalPlan: 'daily',
    requestedStartDate: '2026-08-26',
    requestedEndDate: '2026-08-31',
    requestedDays: 6,
    requestedDailyRate: 500,
    requestedRent: 3000,
    requestedDeposit: 500,
    coOccupants: [],
    vehicles: [],
    pets: [],
    rentalHistory: ['106'],
    createdAt: '2026-08-26',
    updatedAt: '2026-08-26',
  };

  // Pending Term Applicant requesting Room 304 with 6 months duration
  const pendingTermApplicant: Tenant = {
    id: 'tnt-pending-term',
    name: 'วิภาดา นักศึกษาเทอมยาว',
    phone: '0834445566',
    status: 'pending',
    requestedRoomId: 'room-304',
    rentalType: 'TERM',
    rentalPlan: 'term',
    requestedStartDate: '2026-11-01',
    requestedEndDate: '2027-04-30',
    requestedDurationMonths: 6,
    requestedRent: 27000,
    requestedDeposit: 6000,
    registrationRequestId: 'reg-req-term-001',
    coOccupants: [],
    vehicles: [],
    pets: [],
    createdAt: '2026-10-15',
    updatedAt: '2026-10-15',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    });

    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('selected_dormitory_id', mockDormitoryId);
    }

    vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url) => {
      if (method === 'GET' && url?.includes('/payment-settings')) {
        return {
          data: {
            bankAccountName: 'สมบูรณ์ สุขสว่าง',
            promptPayAccountName: 'สมบูรณ์ สุขสว่าง',
          }
        };
      }
      if (method === 'GET' && url?.includes('/tenants/')) {
        return {
          tenant: activeMonthlyTenant,
          emergencyContacts: [],
          coOccupants: [],
          coOccupantHistory: [],
          vehicles: [],
          contracts: [monthlyContract],
          occupancies: [],
          dailyStays: [],
          bills: [],
          settlements: [],
        };
      }
      return {};
    });
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
  });

  it('1. Monthly Tenant Renewal opens Monthly renewal workflow with Monthly semantics', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <OwnerTenants
          dormitoryId={mockDormitoryId}
          dormitory={sampleDormitory}
          tenants={[activeMonthlyTenant]}
          rooms={sampleRooms}
          contracts={[monthlyContract]}
          onSaveTenants={vi.fn()}
          onSaveRooms={vi.fn()}
          onSaveContracts={vi.fn()}
          onAddLog={vi.fn()}
        />
      </QueryClientProvider>
    );

    // Select Monthly tenant
    fireEvent.click(screen.getByText('นายสมชาย ใจดี'));

    // Switch to Contract tab
    const contractTab = screen.getByRole('button', { name: /สัญญาเช่า/i });
    fireEvent.click(contractTab);

    // Click 'ต่ออายุสัญญา' button
    const renewBtn = screen.getAllByRole('button', { name: /ต่ออายุสัญญา/i })[0];
    fireEvent.click(renewBtn);

    // Verify Monthly Renewal Modal Title and Semantics
    expect(screen.getByText(/ต่ออายุสัญญาเช่า \(รายเดือน\)/i)).toBeDefined();
    expect(screen.getByText(/สัญญาเช่ารายเดือน/i)).toBeDefined();
    expect(screen.getByText(/ระยะเวลาสัญญา \(เดือน\) \*/i)).toBeDefined();
    expect(screen.getByText(/อัตราค่าเช่า \(บาท\/เดือน\) \*/i)).toBeDefined();

    // Verify next start date is derived based on previous contract end date (2026-12-31 -> 2027-01-01 / 01/01/2570 BE)
    const startDateInput = screen.getByDisplayValue('01/01/2570');
    expect(startDateInput).toBeDefined();

    // Verify previous rent is preserved (4500)
    const rentInput = screen.getByDisplayValue('4500');
    expect(rentInput).toBeDefined();
  });

  it('2. Term Tenant Renewal opens Term renewal workflow with data-driven duration', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <OwnerTenants
          dormitoryId={mockDormitoryId}
          dormitory={sampleDormitory}
          tenants={[activeTermTenant]}
          rooms={sampleRooms}
          contracts={[termContract]}
          onSaveTenants={vi.fn()}
          onSaveRooms={vi.fn()}
          onSaveContracts={vi.fn()}
          onAddLog={vi.fn()}
        />
      </QueryClientProvider>
    );

    // Select Term tenant
    fireEvent.click(screen.getByText('นางสาวพิมพา สดใส'));

    // Switch to Contract tab
    const contractTab = screen.getByRole('button', { name: /สัญญาเช่า/i });
    fireEvent.click(contractTab);

    // Click 'ต่ออายุสัญญา'
    const renewBtn = screen.getAllByRole('button', { name: /ต่ออายุสัญญา/i })[0];
    fireEvent.click(renewBtn);

    // Verify Term Renewal Modal Title and Semantics
    expect(screen.getByText(/ต่ออายุสัญญาเช่า \(รายเทอม\)/i)).toBeDefined();
    expect(screen.getAllByText(/สัญญาเช่ารายเทอม/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/ระยะเวลาตามเทอม \(เดือน\) \*/i)).toBeDefined();
    expect(screen.getByText(/อัตราค่าเช่า \(บาท\/เทอม\) \*/i)).toBeDefined();

    // Verify duration is preserved from contract (5 months, NOT hardcoded 4)
    const durationInput = screen.getByDisplayValue(/5 เดือน/);
    expect(durationInput).toBeDefined();

    // Verify term rent is preserved (22500)
    const rentInput = screen.getByDisplayValue('22500');
    expect(rentInput).toBeDefined();
  });

  it('3. Daily Tenant has NO Contract tab and NO Contract Renewal button; has Daily Stay extension', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <OwnerTenants
          dormitoryId={mockDormitoryId}
          dormitory={sampleDormitory}
          tenants={[activeDailyTenant]}
          rooms={sampleRooms}
          contracts={[]}
          onSaveTenants={vi.fn()}
          onSaveRooms={vi.fn()}
          onSaveContracts={vi.fn()}
          onAddLog={vi.fn()}
        />
      </QueryClientProvider>
    );

    // Select Daily tenant
    fireEvent.click(screen.getByText('เอกชัย รายวันสิงหา'));

    // Defect 4: Contract tab MUST NOT be present for Daily tenants
    expect(screen.queryByRole('button', { name: /^สัญญาเช่า$/i })).toBeNull();

    // Defect 8: Contract renewal button MUST NOT be present
    expect(screen.queryByRole('button', { name: /ต่ออายุสัญญา/i })).toBeNull();

    // Daily Stay extension button MUST be present
    expect(screen.getAllByRole('button', { name: /ขยายวันเข้าพัก/i })[0]).toBeDefined();
  });

  it('4. C2-9 Room Label Rule: Dropdown option text is ROOM NUMBER ONLY and requested badge is outside', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <OwnerTenants
          dormitoryId={mockDormitoryId}
          dormitory={sampleDormitory}
          tenants={[pendingTermApplicant]}
          rooms={sampleRooms}
          contracts={[]}
          onSaveTenants={vi.fn()}
          onSaveRooms={vi.fn()}
          onSaveContracts={vi.fn()}
          onAddLog={vi.fn()}
        />
      </QueryClientProvider>
    );

    // Switch to Pending Review tab
    const pendingTab = screen.getByRole('button', { name: /รอตรวจสอบ/i });
    fireEvent.click(pendingTab);

    // Click on pending applicant
    fireEvent.click(screen.getByText('วิภาดา นักศึกษาเทอมยาว'));

    // Click Approve button to open approval modal
    const approveBtn = screen.getByRole('button', { name: /อนุมัติคำขอ/i });
    fireEvent.click(approveBtn);

    // Locate the room select dropdown
    const selectEl = screen.getByDisplayValue('304') as HTMLSelectElement;
    expect(selectEl).toBeDefined();

    // C2-9 Strict Assertion: options must NOT contain "(ห้องที่ผู้เช่าขอ)"
    const options = Array.from(selectEl.options);
    const room304Option = options.find(o => o.value === 'room-304');
    expect(room304Option).toBeDefined();
    expect(room304Option?.text.trim()).toBe('304');
    expect(room304Option?.text).not.toContain('(ห้องที่ผู้เช่าขอ)');

    // Verify external requested room indicator badge rendered outside the dropdown
    expect(screen.getByText('ห้องที่ผู้เช่าขอ:')).toBeDefined();
    expect(screen.getAllByText(/ห้อง 304/i).length).toBeGreaterThanOrEqual(1);
  });

  it('5. Term Requested Duration in Approval Modal is data-driven (6 months from applicant, not hardcoded 4)', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <OwnerTenants
          dormitoryId={mockDormitoryId}
          dormitory={sampleDormitory}
          tenants={[pendingTermApplicant]}
          rooms={sampleRooms}
          contracts={[]}
          onSaveTenants={vi.fn()}
          onSaveRooms={vi.fn()}
          onSaveContracts={vi.fn()}
          onAddLog={vi.fn()}
        />
      </QueryClientProvider>
    );

    // Switch to Pending Review tab
    const pendingTab = screen.getByRole('button', { name: /รอตรวจสอบ/i });
    fireEvent.click(pendingTab);

    // Select applicant
    fireEvent.click(screen.getByText('วิภาดา นักศึกษาเทอมยาว'));

    // Open approve modal
    const approveBtn = screen.getByRole('button', { name: /อนุมัติคำขอ/i });
    fireEvent.click(approveBtn);

    // Term duration field must populate with 6 months from requestedDurationMonths
    const durationInput = screen.getByDisplayValue('6');
    expect(durationInput).toBeDefined();

    // Term rent must populate with 27000 from requestedRent
    const rentInput = screen.getByDisplayValue('27000');
    expect(rentInput).toBeDefined();
  });

  it('6. Printed lease incorporates canonical dormitory, lessor/owner, tenant, and contract data', async () => {
    let capturedHtml = '';
    const mockDocument = {
      write: vi.fn((html: string) => {
        capturedHtml += html;
      }),
      close: vi.fn(),
    };
    vi.spyOn(window, 'open').mockReturnValue({
      document: mockDocument,
    } as any);

    render(
      <QueryClientProvider client={queryClient}>
        <OwnerTenants
          dormitoryId={mockDormitoryId}
          dormitory={sampleDormitory}
          tenants={[activeMonthlyTenant]}
          rooms={sampleRooms}
          contracts={[monthlyContract]}
          onSaveTenants={vi.fn()}
          onSaveRooms={vi.fn()}
          onSaveContracts={vi.fn()}
          onAddLog={vi.fn()}
        />
      </QueryClientProvider>
    );

    // Select Monthly tenant
    fireEvent.click(screen.getByText('นายสมชาย ใจดี'));

    // Switch to Contract tab
    const contractTab = screen.getByRole('button', { name: /สัญญาเช่า/i });
    fireEvent.click(contractTab);

    // Allow paymentSettings async fetch to resolve
    await new Promise(resolve => setTimeout(resolve, 50));

    // Click 'พิมพ์สัญญา' button
    const printBtn = screen.getByRole('button', { name: /พิมพ์สัญญา/i });
    fireEvent.click(printBtn);

    expect(window.open).toHaveBeenCalled();
    expect(capturedHtml).toContain('หอพักสุขสบาย (สุขุมวิท 71)');
    expect(capturedHtml).toContain('สมบูรณ์ สุขสว่าง');
    expect(capturedHtml).toContain('นายสมชาย ใจดี');
    expect(capturedHtml).toContain('101');
    expect(capturedHtml).toContain('4,500');
    expect(capturedHtml).toContain('12');
  });
});
