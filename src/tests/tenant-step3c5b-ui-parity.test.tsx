/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * @vitest-environment happy-dom
 *
 * TENANT PHASE 3 STEP 3C.5B UI PARITY TEST SUITE
 * Acceptance Gap Closure:
 * 1. Owner-Facing Rental Labels — Thai Only (no English parentheticals like (Monthly), (Fixed-Term), (Daily Stay))
 * 2. Global Daily Contract Tab Suppression (Active, Ended/Former, Pending Daily has NO Contract tab)
 * 3. Pending Monthly & Term Provisional Lease Presentation (shows Provisional Lease view under 'สัญญาเช่า' tab)
 * 4. Approval Modal Quick Add Parity (Thai-only badge, Room numbers only, Buddhist Era date inputs,
 *    read-only calculated end date/rent, deposit declaration toggle, ID document upload)
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
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

vi.mock('../data/adapters/api', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    approveTenantRegistrationRequest: vi.fn(async () => ({ success: true, data: { tenantId: 'tnt-approved-1' } })),
    rejectTenantRegistrationRequest: vi.fn(async () => ({ success: true })),
  };
});

describe('Tenant Phase 3 Step 3C.5B: Thai-Only Labels, Contract Tab Rules & Approval Parity', () => {
  const mockDormitoryId = 'dorm-uat-3c5b';
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
      currentTenantId: 'tnt-monthly-101',
      price: 5000,
      monthlyRent: 5000,
      deposit: 10000,
      floor: 1,
      type: 'standard',
    },
    {
      id: 'room-105',
      dormitoryId: mockDormitoryId,
      roomNumber: '105',
      status: 'occupied',
      currentTenantId: 'tnt-term-105',
      price: 22000,
      termRent: 22000,
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
      price: 550,
      dailyRent: 550,
      deposit: 500,
      floor: 1,
      type: 'standard',
    },
    {
      id: 'room-205',
      dormitoryId: mockDormitoryId,
      roomNumber: '205',
      status: 'vacant',
      price: 550,
      dailyRent: 550,
      deposit: 500,
      floor: 2,
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
  ];

  // 1. Active Monthly Tenant
  const activeMonthlyTenant: Tenant = {
    id: 'tnt-monthly-101',
    name: 'ธีรเดช เดือนเด่น',
    phone: '0811112233',
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
    id: 'ct-monthly-101',
    contractNumber: 'CT-202601-101',
    tenantId: 'tnt-monthly-101',
    roomId: 'room-101',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    durationMonths: 12,
    rentAmount: 5000,
    depositAmount: 10000,
    rentBillingType: 'monthly',
    status: 'active',
    tenantSignature: 'sig-tnt-101.png',
    ownerSignature: 'sig-owner.png',
    terms: 'สัญญาเช่าห้องพักรายเดือนมาตรฐาน',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  // 2. Active Term Tenant
  const activeTermTenant: Tenant = {
    id: 'tnt-term-105',
    name: 'พิมพา เทอมดี',
    phone: '0822223344',
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
    id: 'ct-term-105',
    contractNumber: 'CT-202606-105',
    tenantId: 'tnt-term-105',
    roomId: 'room-105',
    startDate: '2026-06-01',
    endDate: '2026-10-31',
    durationMonths: 5,
    rentAmount: 22000,
    depositAmount: 5000,
    rentBillingType: 'term',
    status: 'active',
    tenantSignature: 'sig-tnt-105.png',
    ownerSignature: 'sig-owner.png',
    terms: 'สัญญาเช่าห้องพักรายเทอม',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  };

  // 3. Active Daily Tenant
  const activeDailyTenant: Tenant = {
    id: 'tnt-daily-106',
    name: 'เอกชัย วันสบาย',
    phone: '0833334455',
    status: 'active',
    roomId: 'room-106',
    rentalType: 'DAILY',
    rentalPlan: 'daily',
    requestedStartDate: '2026-08-20',
    requestedEndDate: '2026-08-25',
    requestedDays: 5,
    requestedDailyRate: 550,
    requestedRent: 2750,
    requestedDeposit: 500,
    coOccupants: [],
    vehicles: [],
    pets: [],
    rentalHistory: ['106'],
    createdAt: '2026-08-20',
    updatedAt: '2026-08-20',
  };

  // 4. Ended / Former Daily Tenant (Ended stay)
  const endedDailyTenant: Tenant = {
    id: 'tnt-daily-ended',
    name: 'ชาตรี จ่ายครบรายวัน',
    phone: '0844445566',
    status: 'inactive',
    roomId: null,
    rentalType: 'DAILY',
    rentalPlan: 'daily',
    coOccupants: [],
    vehicles: [],
    pets: [],
    rentalHistory: ['106'],
    createdAt: '2026-07-01',
    updatedAt: '2026-07-05',
  };

  // 5. Pending Monthly Applicant
  const pendingMonthlyApplicant: Tenant = {
    id: 'tnt-pending-monthly',
    name: 'สุดาภรณ์ สมัครรายเดือน',
    phone: '0855556677',
    status: 'pending',
    requestedRoomId: 'room-304',
    rentalType: 'MONTHLY',
    rentalPlan: 'monthly',
    requestedStartDate: '2026-09-01',
    requestedEndDate: '2027-08-31',
    requestedDurationMonths: 12,
    requestedRent: 5000,
    requestedDeposit: 10000,
    registrationRequestId: 'reg-req-monthly-001',
    coOccupants: [],
    vehicles: [],
    pets: [],
    createdAt: '2026-08-25',
    updatedAt: '2026-08-25',
  };

  // 6. Pending Term Applicant
  const pendingTermApplicant: Tenant = {
    id: 'tnt-pending-term',
    name: 'ณัฐพล สมัครรายเทอม',
    phone: '0866667788',
    status: 'pending',
    requestedRoomId: 'room-304',
    rentalType: 'TERM',
    rentalPlan: 'term',
    requestedStartDate: '2026-11-01',
    requestedEndDate: '2027-02-28',
    requestedDurationMonths: 4,
    requestedRent: 22000,
    requestedDeposit: 5000,
    registrationRequestId: 'reg-req-term-001',
    coOccupants: [],
    vehicles: [],
    pets: [],
    createdAt: '2026-08-25',
    updatedAt: '2026-08-25',
  };

  // 7. Pending Daily Applicant
  const pendingDailyApplicant: Tenant = {
    id: 'tnt-pending-daily',
    name: 'สมคิด สมัครรายวัน',
    phone: '0877778899',
    status: 'pending',
    requestedRoomId: 'room-205',
    rentalType: 'DAILY',
    rentalPlan: 'daily',
    requestedStartDate: '2026-09-10',
    requestedEndDate: '2026-09-15',
    requestedDays: 5,
    requestedDailyRate: 550,
    requestedRent: 2750,
    requestedDeposit: 500,
    registrationRequestId: 'reg-req-daily-001',
    coOccupants: [],
    vehicles: [],
    pets: [],
    createdAt: '2026-08-25',
    updatedAt: '2026-08-25',
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
      if (method === 'GET' && url?.includes('/tenants/tnt-monthly-101')) {
        return {
          tenant: activeMonthlyTenant,
          contracts: [monthlyContract],
          dailyStays: [],
        };
      }
      if (method === 'GET' && url?.includes('/tenants/tnt-term-105')) {
        return {
          tenant: activeTermTenant,
          contracts: [termContract],
          dailyStays: [],
        };
      }
      if (method === 'GET' && url?.includes('/tenants/tnt-daily-106')) {
        return {
          tenant: activeDailyTenant,
          contracts: [],
          dailyStays: [
            {
              id: 'ds-106',
              startDate: '2026-08-20',
              endDate: '2026-08-25',
              inclusiveDayCount: 5,
              dailyRateAmount: 550,
              totalRentAmount: 2750,
              status: 'ACTIVE',
            },
          ],
        };
      }
      if (method === 'GET' && url?.includes('/tenants/tnt-daily-ended')) {
        return {
          tenant: endedDailyTenant,
          contracts: [],
          dailyStays: [
            {
              id: 'ds-ended',
              startDate: '2026-07-01',
              endDate: '2026-07-05',
              inclusiveDayCount: 4,
              dailyRateAmount: 550,
              totalRentAmount: 2200,
              status: 'CHECKED_OUT',
            },
          ],
        };
      }
      if (method === 'GET' && url?.includes('/tenants/tnt-pending-monthly')) {
        return {
          tenant: pendingMonthlyApplicant,
          contracts: [],
          dailyStays: [],
        };
      }
      if (method === 'GET' && url?.includes('/tenants/tnt-pending-term')) {
        return {
          tenant: pendingTermApplicant,
          contracts: [],
          dailyStays: [],
        };
      }
      if (method === 'GET' && url?.includes('/tenants/tnt-pending-daily')) {
        return {
          tenant: pendingDailyApplicant,
          contracts: [],
          dailyStays: [],
        };
      }
      return {};
    });
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
  });

  describe('1. Owner-Facing Rental Labels — Thai Only (No English parentheticals)', () => {
    it('1.1 Renders Thai-only badges and headings without (Monthly), (Fixed-Term), (Daily Stay)', async () => {
      const allTenants = [
        activeMonthlyTenant,
        activeTermTenant,
        activeDailyTenant,
      ];

      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            dormitory={sampleDormitory}
            tenants={allTenants}
            rooms={sampleRooms}
            contracts={[monthlyContract, termContract]}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onSaveContracts={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      // Verify no English parentheticals in the whole rendered container
      const bodyText = document.body.textContent || '';
      expect(bodyText).not.toContain('(Monthly)');
      expect(bodyText).not.toContain('(Monthly Lease)');
      expect(bodyText).not.toContain('(Fixed-Term)');
      expect(bodyText).not.toContain('(Term Lease)');
      expect(bodyText).not.toContain('(Daily)');
      expect(bodyText).not.toContain('(Daily Stay)');

      // Verify Thai-only badges exist
      expect(screen.getAllByText('รายเดือน').length).toBeGreaterThan(0);
      expect(screen.getAllByText('รายเทอม').length).toBeGreaterThan(0);
      expect(screen.getAllByText('รายวัน').length).toBeGreaterThan(0);
    });

    it('1.2 Renders concise Thai-only pending applicant duration summary', async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            dormitory={sampleDormitory}
            tenants={[pendingMonthlyApplicant, pendingTermApplicant, pendingDailyApplicant]}
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
      fireEvent.click(screen.getByRole('button', { name: /รอตรวจสอบ/i }));

      // Monthly concise format: 12 เดือน • (01/09/2569 - 31/08/2570) • ค่าเช่า ฿ 5,000/เดือน
      expect(screen.getByText(/12 เดือน/i)).toBeDefined();
      expect(screen.getByText(/2569 - 31\/08\/2570/i)).toBeDefined();

      // Term concise format: 4 เดือน • (01/11/2569 - 28/02/2570) • ค่าเช่า ฿ 22,000/เทอม
      expect(screen.getByText(/4 เดือน/i)).toBeDefined();
      expect(screen.getByText(/2569 - 28\/02\/2570/i)).toBeDefined();

      // Daily concise format: 5 วัน • (10/09/2569 - 15/09/2569) • ค่าเช่า ฿ 550/วัน
      expect(screen.getByText(/5 วัน/i)).toBeDefined();
      expect(screen.getByText(/10\/09\/2569 - 15\/09\/2569/i)).toBeDefined();
    });
  });

  describe('2. Global Daily Contract Tab Suppression', () => {
    it('2.1 Active Daily tenant has NO Contract tab (has Stay tab)', async () => {
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

      fireEvent.click(screen.getByText('เอกชัย วันสบาย'));

      // Check tab buttons: must NOT contain 'สัญญาเช่า'
      const contractTabs = screen.queryAllByRole('button', { name: /สัญญาเช่า/i });
      expect(contractTabs.length).toBe(0);

      // Must contain 'ข้อมูลการเข้าพักรายวัน'
      expect(screen.getByText('ข้อมูลการเข้าพักรายวัน')).toBeDefined();
    });

    it('2.2 Ended/Former Daily tenant has NO Contract tab', async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            dormitory={sampleDormitory}
            tenants={[endedDailyTenant]}
            rooms={sampleRooms}
            contracts={[]}
            initialTenantId={endedDailyTenant.id}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onSaveContracts={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      // Check tab buttons: must NOT contain 'สัญญาเช่า'
      const contractTabs = screen.queryAllByRole('button', { name: /สัญญาเช่า/i });
      expect(contractTabs.length).toBe(0);

      // Must contain 'ข้อมูลการเข้าพักรายวัน'
      expect(screen.getByText('ข้อมูลการเข้าพักรายวัน')).toBeDefined();
    });

    it('2.3 Pending Daily applicant has NO Contract tab', async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            dormitory={sampleDormitory}
            tenants={[pendingDailyApplicant]}
            rooms={sampleRooms}
            contracts={[]}
            initialTenantId={pendingDailyApplicant.id}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onSaveContracts={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      // Must NOT contain 'สัญญาเช่า'
      const contractTabs = screen.queryAllByRole('button', { name: /สัญญาเช่า/i });
      expect(contractTabs.length).toBe(0);
    });
  });

  describe('3. Pending Monthly & Term Provisional Lease Presentation', () => {
    it('3.1 Pending Monthly applicant shows Contract tab with Provisional Lease details', async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            dormitory={sampleDormitory}
            tenants={[pendingMonthlyApplicant]}
            rooms={sampleRooms}
            contracts={[]}
            initialTenantId={pendingMonthlyApplicant.id}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onSaveContracts={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      // Contract tab MUST exist for Pending Monthly
      const contractTab = screen.getByRole('button', { name: /สัญญาเช่า/i });
      expect(contractTab).toBeDefined();
      fireEvent.click(contractTab);

      // Verify Provisional Lease presentation
      expect(screen.getByText(/สัญญาเช่า \(คำขอลงทะเบียน\)/i)).toBeDefined();
      expect(screen.queryByText(/สัญญาเช่าเบื้องต้น/i)).toBeNull();
      expect(screen.getByText(/สัญญาเช่ารายเดือน/i)).toBeDefined();
      expect(screen.getAllByText(/12 เดือน/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/฿ 5,000 \/เดือน/i)).toBeDefined();
      expect(screen.getByText(/฿ 10,000/i)).toBeDefined();
    });

    it('3.2 Pending Term applicant shows Contract tab with Provisional Lease details', async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            dormitory={sampleDormitory}
            tenants={[pendingTermApplicant]}
            rooms={sampleRooms}
            contracts={[]}
            initialTenantId={pendingTermApplicant.id}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onSaveContracts={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      // Contract tab MUST exist for Pending Term
      const contractTab = screen.getByRole('button', { name: /สัญญาเช่า/i });
      expect(contractTab).toBeDefined();
      fireEvent.click(contractTab);

      // Verify Provisional Term Lease presentation
      expect(screen.getByText(/สัญญาเช่า \(คำขอลงทะเบียน\)/i)).toBeDefined();
      expect(screen.queryByText(/สัญญาเช่าเบื้องต้น/i)).toBeNull();
      expect(screen.getByText(/สัญญาเช่ารายเทอม/i)).toBeDefined();
      expect(screen.getAllByText(/4 เดือน/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/฿ 22,000 \/เทอม/i)).toBeDefined();
    });
  });

  describe('4. Approval Modal Quick Add Parity', () => {
    it('4.1 Opens Approval Modal with Thai-only badge, room numbers only, BE dates, and deposit toggle', async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            dormitory={sampleDormitory}
            tenants={[pendingMonthlyApplicant]}
            rooms={sampleRooms}
            contracts={[]}
            initialTenantId={pendingMonthlyApplicant.id}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onSaveContracts={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      // Click 'อนุมัติคำขอ' button in header
      const approveBtn = screen.getByRole('button', { name: /อนุมัติคำขอ/i });
      fireEvent.click(approveBtn);

      // Modal Title
      expect(screen.getByRole('heading', { name: /ยืนยันอนุมัติและรับผู้เช่าเข้าพัก/i })).toBeDefined();

      // Thai-only badge in Header card
      const modalHeader = screen.getByRole('heading', { name: /ยืนยันอนุมัติและรับผู้เช่าเข้าพัก/i }).closest('div');
      expect(modalHeader).toBeDefined();
      expect(screen.getAllByText('รายเดือน').length).toBeGreaterThan(0);
      expect(document.body.textContent).not.toContain('(Monthly)');

      // Room options: Room numbers only
      const roomSelect = screen.getByLabelText(/เลือกห้องพักที่ต้องการจัดสรร/i) as HTMLSelectElement;
      expect(roomSelect).toBeDefined();
      const optionTexts = Array.from(roomSelect.options).map((o) => o.text);
      // Verify options are room numbers only (e.g. "304", "101"), not "ห้อง 304 (ชั้น 3 - standard)"
      expect(optionTexts).toContain('304');
      expect(optionTexts).toContain('205');
      for (const text of optionTexts) {
        if (text && !text.includes('เลือก')) {
          expect(text).not.toMatch(/ห้อง\s+\d+/i);
          expect(text).not.toContain('ชั้น');
        }
      }

      // Read-only calculated end date exists
      expect(screen.getByText(/วันที่สิ้นสุดสัญญา/i)).toBeDefined();

      // Read-only calculated total rent exists
      expect(screen.getByText(/ค่าเช่ารวมทั้งหมด/i)).toBeDefined();

      // Deposit declaration toggle exists: 'ยังไม่ชำระ' and 'ชำระแล้ว'
      expect(screen.getByRole('button', { name: /ยังไม่ชำระ/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /ชำระแล้ว/i })).toBeDefined();

      // ID document upload section exists with 5MB limit
      expect(screen.getByText(/รูปเอกสารสำเนาบัตรประชาชน/i)).toBeDefined();
      expect(screen.getByText(/ขนาดไม่เกิน 5 MB/i)).toBeDefined();
    });
  });

  describe('5. Printed Contract Real Signatures & Page-Bounded CSS', () => {
    it('5.1 Renders real signatures and does NOT contain dotted character lines', async () => {
      // Mock window.open to return null so it opens the in-page Print Preview Modal
      vi.spyOn(window, 'open').mockReturnValue(null as any);

      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            dormitory={sampleDormitory}
            tenants={[activeMonthlyTenant]}
            rooms={sampleRooms}
            contracts={[monthlyContract]}
            initialTenantId={activeMonthlyTenant.id}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onSaveContracts={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      // Switch to Contract tab
      const contractTab = screen.getByRole('button', { name: /สัญญาเช่า/i });
      fireEvent.click(contractTab);

      // Click to open contract print preview
      const printBtn = screen.getByRole('button', { name: /พิมพ์สัญญา/i });
      fireEvent.click(printBtn);

      // Verify print preview modal title
      expect(screen.getByText(`พิมพ์สัญญาเช่าเลขที่ ${monthlyContract.contractNumber}`)).toBeDefined();

      // Verify absence of dotted character lines
      const printModalText = document.body.textContent || '';
      expect(printModalText).not.toContain('....................................................');
      expect(printModalText).not.toContain('.....................');

      // Verify signature image renders
      const tenantSigImg = screen.getByAltText('ลายเซ็นผู้เช่า');
      expect(tenantSigImg).toBeDefined();
      expect(tenantSigImg.getAttribute('src')).toContain('/contracts/ct-monthly-101/tenant-signature');

      const ownerSigImg = screen.getByAltText('ลายเซ็นผู้ให้เช่า');
      expect(ownerSigImg).toBeDefined();
      expect(ownerSigImg.getAttribute('src')).toContain('/contracts/ct-monthly-101/owner-signature');
    });

    it('5.2 Renders clean blank space for unsigned contract without dotted lines or (ยังไม่ได้ลงนาม)', async () => {
      vi.spyOn(window, 'open').mockReturnValue(null as any);

      const unsignedContract: Contract = {
        ...monthlyContract,
        id: 'ct-unsigned-001',
        contractNumber: 'CT-2026-UNSIGNED',
        tenantSignature: undefined,
        ownerSignature: undefined,
      };

      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            dormitory={sampleDormitory}
            tenants={[activeMonthlyTenant]}
            rooms={sampleRooms}
            contracts={[unsignedContract]}
            initialTenantId={activeMonthlyTenant.id}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onSaveContracts={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      const contractTab = screen.getByRole('button', { name: /สัญญาเช่า/i });
      fireEvent.click(contractTab);

      const printBtn = screen.getByRole('button', { name: /พิมพ์สัญญา/i });
      fireEvent.click(printBtn);

      const printModalText = document.body.textContent || '';
      expect(printModalText).not.toContain('....................................................');
      expect(printModalText).not.toContain('(ยังไม่ได้ลงนาม)');
      expect(screen.queryByAltText('ลายเซ็นผู้เช่า')).toBeNull();
    });
  });

  describe('6. Inline ID Document Immediate Preview in Approval Modal', () => {
    it('6.1 Renders inline preview immediately without intermediate "เปิดดู" button', async () => {
      const applicantWithIdDoc: Tenant = {
        ...pendingMonthlyApplicant,
        id: 'tnt-pending-with-id',
        acceptanceSnapshot: {
          idCardDocument: {
            storageKey: 'uat-pending-id-cards/preeya-id.webp',
            originalFilename: 'preeya-citizen-card.webp',
            mimeType: 'image/webp',
            byteSize: 104200,
          },
        } as any,
      };

      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            dormitory={sampleDormitory}
            tenants={[applicantWithIdDoc]}
            rooms={sampleRooms}
            contracts={[]}
            initialTenantId={applicantWithIdDoc.id}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onSaveContracts={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      // Open Approval Modal
      const approveBtn = screen.getByRole('button', { name: /อนุมัติคำขอ/i });
      fireEvent.click(approveBtn);

      // Inline preview container exists immediately
      const inlineDocContainer = screen.getByTestId('inline-id-document-container');
      expect(inlineDocContainer).toBeDefined();
      expect(screen.getByText(/preeya-citizen-card\.webp/i)).toBeDefined();
      expect(screen.getByText(/รูปภาพ • 102 KB/i)).toBeDefined();

      // No intermediate "เปิดดู" button is rendered in the ID document section
      const idSection = inlineDocContainer.parentElement;
      expect(idSection?.textContent).not.toContain('เปิดดูภาพ');
    });
  });

  describe('7. Active Resident Mix and Term Rental Presentation', () => {
    it('7.1 Displays active Monthly, Term, and Daily residents simultaneously in พักอาศัย', async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            dormitory={sampleDormitory}
            tenants={[activeMonthlyTenant, activeTermTenant, activeDailyTenant]}
            rooms={sampleRooms}
            contracts={[monthlyContract, termContract]}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onSaveContracts={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      // Switch to Active Residents tab ('พักอาศัย')
      const activeTabBtn = screen.getByRole('button', { name: /พักอาศัย/i });
      fireEvent.click(activeTabBtn);

      // All three tenants are visible in the list
      expect(screen.getByText('ธีรเดช เดือนเด่น')).toBeDefined();
      expect(screen.getByText('พิมพา เทอมดี')).toBeDefined();
      expect(screen.getByText('เอกชัย วันสบาย')).toBeDefined();
    });

    it('7.2 Renders type-aware rent label /เทอม for active Term contract', async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            dormitory={sampleDormitory}
            tenants={[activeTermTenant]}
            rooms={sampleRooms}
            contracts={[termContract]}
            initialTenantId={activeTermTenant.id}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onSaveContracts={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      // Switch to Contract tab
      const contractTab = screen.getByRole('button', { name: /สัญญาเช่า/i });
      fireEvent.click(contractTab);

      // Verify rent label is /เทอม
      expect(screen.getByText(/\/เทอม/i)).toBeDefined();
    });

    it('7.3 Renders current active Term agreement as สัญญา/ข้อตกลงปัจจุบัน and subsequent contract as สัญญาถัดไป', async () => {
      const futureTermContract: Contract = {
        id: 'contract-term-future',
        tenantId: activeTermTenant.id,
        roomId: 'room-105',
        roomNumber: '105',
        contractNumber: 'CTR-2026-105-TERM',
        startDate: '2026-11-01',
        endDate: '2027-02-28',
        durationMonths: 4,
        rentBillingType: 'term',
        rentAmount: 18000,
        depositAmount: 4500,
        status: 'active',
        createdAt: '2026-07-01T09:00:00.000Z',
      };

      const termTenantWithAgreement: Tenant = {
        ...activeTermTenant,
        rentalType: 'TERM',
        rentalPlan: 'term',
        requestedStartDate: '2026-07-01',
        requestedEndDate: '2026-10-31',
        requestedDurationMonths: 4,
        requestedRent: 18000,
        requestedDeposit: 4500,
      };

      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            dormitory={sampleDormitory}
            tenants={[termTenantWithAgreement]}
            rooms={sampleRooms}
            contracts={[futureTermContract]}
            initialTenantId={termTenantWithAgreement.id}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onSaveContracts={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      // Switch to Contract tab
      const contractTab = screen.getByRole('button', { name: /สัญญาเช่า/i });
      fireEvent.click(contractTab);

      // Both current agreement badge and future agreement badge must be present
      expect(screen.getByText('สัญญา/ข้อตกลงปัจจุบัน')).toBeDefined();
      expect(screen.getByText('สัญญาถัดไป')).toBeDefined();
      expect(screen.getByText(/CTR-2026-105-TERM/)).toBeDefined();
    });
  });

  describe('8. Daily Stay Temporal Classification vs Selected Billing Cycle (Step 3C.5B.4)', () => {
    it('8.1 Daily stay ended earlier in September is inactive (เลิกเช่าแล้ว) and excluded from พักอาศัย even when September is selected', async () => {
      vi.setSystemTime(new Date('2026-09-08T12:00:00Z'));
      const activeDailyTenant: Tenant = {
        id: 'tnt-daily-active',
        name: 'นายสมเกียรติ วันสบายกันยา',
        phone: '0887779999',
        status: 'active',
        roomId: 'room-106',
        rentalType: 'DAILY',
        rentalPlan: 'daily',
        requestedStartDate: '2026-09-05',
        requestedEndDate: '2026-09-10',
        requestedDays: 5,
        requestedDailyRate: 500,
        coOccupants: [],
        vehicles: [],
        pets: [],
        rentalHistory: ['106'],
        createdAt: '2026-09-05',
        updatedAt: '2026-09-05',
      };

      const endedDailyTenant: Tenant = {
        id: 'tnt-daily-ended-sep',
        name: 'นายอดิศร กันยาย้ายออก',
        phone: '0887778888',
        status: 'checked_out',
        roomId: 'room-106',
        rentalType: 'DAILY',
        rentalPlan: 'daily',
        requestedStartDate: '2026-09-01',
        requestedEndDate: '2026-09-04',
        requestedDays: 3,
        requestedDailyRate: 500,
        coOccupants: [],
        vehicles: [],
        pets: [],
        rentalHistory: ['106'],
        createdAt: '2026-09-01',
        updatedAt: '2026-09-04',
      };

      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            dormitory={sampleDormitory}
            tenants={[activeDailyTenant, endedDailyTenant]}
            rooms={sampleRooms}
            contracts={[]}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onSaveContracts={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      // In พักอาศัย tab:
      // Active daily tenant MUST be displayed
      expect(screen.getByText('นายสมเกียรติ วันสบายกันยา')).toBeDefined();
      // Ended daily tenant MUST NOT be displayed in พักอาศัย (even though stay was in September)
      expect(screen.queryByText('นายอดิศร กันยาย้ายออก')).toBeNull();

      // Switch to เลิกเช่าแล้ว tab
      const inactiveTab = screen.getByRole('button', { name: /เลิกเช่าแล้ว/i });
      fireEvent.click(inactiveTab);

      // Ended daily tenant MUST be displayed in เลิกเช่าแล้ว
      expect(screen.getByText('นายอดิศร กันยาย้ายออก')).toBeDefined();
      // Active daily tenant MUST NOT be displayed in เลิกเช่าแล้ว
      expect(screen.queryByText('นายสมเกียรติ วันสบายกันยา')).toBeNull();
      vi.useRealTimers();
    });
  });

  describe('9. Approve and Revision Toast Feedback & Auto-Dismiss (Step 3C.5B.6A)', () => {
    it('9.1 Confirming approval displays exact toast "อนุมัติคำขอเรียบร้อยแล้ว" and auto-dismisses after 3000ms', async () => {
      vi.useFakeTimers();
      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            dormitory={sampleDormitory}
            tenants={[pendingMonthlyApplicant]}
            rooms={sampleRooms}
            contracts={[]}
            initialTenantId={pendingMonthlyApplicant.id}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onSaveContracts={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      // Open approve modal
      const approveBtn = screen.getByRole('button', { name: /อนุมัติคำขอ/i });
      fireEvent.click(approveBtn);

      // Select room
      const roomSelect = screen.getByLabelText(/เลือกห้องพักที่ต้องการจัดสรร/i);
      fireEvent.change(roomSelect, { target: { value: 'room-205' } });

      // Click confirm button
      const confirmApproveBtn = screen.getByRole('button', { name: /ยืนยันอนุมัติและรับผู้เช่าเข้าพัก/i });
      await act(async () => {
        fireEvent.click(confirmApproveBtn);
      });

      // Assert toast is visible with exact Thai text and data-testid, and has white-fade style
      const toast = screen.getByTestId('tenant-action-toast');
      expect(toast).toBeDefined();
      expect(toast.textContent).toContain('อนุมัติคำขอเรียบร้อยแล้ว');
      expect(toast.className).toContain('bg-white');

      // Advance timers past fade into full removal (3500ms)
      act(() => {
        vi.advanceTimersByTime(3500);
      });

      // Assert toast is removed from DOM
      expect(screen.queryByTestId('tenant-action-toast')).toBeNull();
      vi.useRealTimers();
    });

    it('9.2 Requesting revision displays exact toast "ส่งคำขอให้ผู้เช่าแก้ไขแล้ว" and auto-dismisses after 3500ms', async () => {
      vi.useFakeTimers();
      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            dormitory={sampleDormitory}
            tenants={[pendingMonthlyApplicant]}
            rooms={sampleRooms}
            contracts={[]}
            initialTenantId={pendingMonthlyApplicant.id}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onSaveContracts={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      // Open reject/revision modal
      const rejectBtn = screen.getByRole('button', { name: /ปฏิเสธคำขอ/i });
      fireEvent.click(rejectBtn);

      // Click confirm reject button
      const confirmRejectBtn = screen.getByRole('button', { name: /ยืนยันปฏิเสธ/i });
      await act(async () => {
        fireEvent.click(confirmRejectBtn);
      });

      // Assert toast is visible with exact Thai text and data-testid
      const toast = screen.getByTestId('tenant-action-toast');
      expect(toast).toBeDefined();
      expect(toast.textContent).toContain('ส่งคำขอให้ผู้เช่าแก้ไขแล้ว');
      expect(toast.className).toContain('bg-white');

      // Advance timers by 3500ms
      act(() => {
        vi.advanceTimersByTime(3500);
      });

      // Assert toast is removed from DOM
      expect(screen.queryByTestId('tenant-action-toast')).toBeNull();
      vi.useRealTimers();
    });
  });
});

