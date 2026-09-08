/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OwnerTenants } from '../pages/owner/tenants';
import { formatOwnerRoomOptionLabel } from '../utils/room-label.util';
import { resolveLandlordSignerName } from '../utils/landlord-signer.util';
import * as httpClient from '../data/httpClient';
import type { Tenant, Room, Building, Contract, Dormitory } from '../types';

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

describe('Tenant Phase 3 Step 3C.5B.6E: Targeted PO UAT UI Corrections', () => {
  let queryClient: QueryClient;

  const mockDormitoryId = 'dorm-po-corrections';
  const sampleDormitory: Dormitory = {
    id: mockDormitoryId,
    name: 'หอพักทดสอบ PO Corrections',
    address: '123/45 ซอยสุขุมวิท 71 แขวงพระโขนงเหนือ เขตวัฒนา กรุงเทพฯ 10110',
    ownerName: 'สมเกียรติ เจ้าของหอ',
    roomsCount: 10,
    occupiedRooms: 5,
    floorsCount: 4,
    bankAccountName: 'สมเกียรติ บัญชีหอ',
    promptpayNumber: '0812345678',
    waterRate: 18,
    electricityRate: 8,
    commonFee: 200,
    dueDay: 5,
  } as any;

  const sampleBuildings: Building[] = [
    { id: 'bld-a', dormitoryId: mockDormitoryId, name: 'อาคาร A', floors: 4 } as Building,
    { id: 'bld-b', dormitoryId: mockDormitoryId, name: 'อาคาร B', floors: 4 } as Building,
  ];

  const sampleRooms: Room[] = [
    {
      id: 'room-101',
      dormitoryId: mockDormitoryId,
      roomNumber: '101',
      buildingId: 'bld-a',
      buildingName: 'อาคาร A',
      status: 'occupied',
      currentTenantId: 'tnt-active-1',
      price: 4500,
      monthlyRent: 4500,
      depositAmount: 4500,
      floor: 1,
      type: 'standard',
    } as any,
    {
      id: 'room-102',
      dormitoryId: mockDormitoryId,
      roomNumber: '102',
      buildingId: 'bld-b',
      buildingName: 'อาคาร B',
      status: 'vacant',
      price: 4500,
      monthlyRent: 4500,
      depositAmount: 4500,
      floor: 1,
      type: 'standard',
    } as any,
    {
      id: 'room-103',
      dormitoryId: mockDormitoryId,
      roomNumber: '103',
      status: 'vacant',
      price: 4500,
      monthlyRent: 4500,
      depositAmount: 4500,
      floor: 1,
      type: 'standard',
    } as any,
  ];

  const activeMonthlyTenant: Tenant = {
    id: 'tnt-active-1',
    name: 'นายสมชาย ผู้พักอาศัย',
    phone: '0811112233',
    email: '', // empty email to test fallback
    status: 'active',
    roomId: 'room-101',
    rentalType: 'MONTHLY',
    rentalPlan: 'monthly',
    depositPaid: true,
    coOccupants: [],
    vehicles: [],
    pets: [],
    rentalHistory: ['101'],
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  };

  const activeContract: Contract = {
    id: 'ct-active-101',
    contractNumber: 'CT-202601-101',
    tenantId: 'tnt-active-1',
    roomId: 'room-101',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    durationMonths: 12,
    rentAmount: 4500,
    depositAmount: 4500,
    rentBillingType: 'monthly',
    status: 'active',
    tenantSignature: 'sig-tnt-101.png',
    ownerSignature: 'sig-owner.png',
    terms: 'สัญญาเช่าห้องพักรายเดือนมาตรฐาน',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const pendingMonthlyApplicant: Tenant = {
    id: 'tnt-pending-monthly',
    name: 'สุดาภรณ์ สมัครรายเดือน',
    phone: '0855556677',
    email: undefined, // undefined email to test fallback
    status: 'pending',
    requestedRoomId: 'room-102',
    rentalType: 'MONTHLY',
    rentalPlan: 'monthly',
    requestedStartDate: '2026-10-01',
    requestedEndDate: '2027-09-30',
    requestedDurationMonths: 12,
    requestedRent: 4500,
    requestedDeposit: 4500,
    registrationRequestId: 'reg-req-monthly-001',
    coOccupants: [],
    vehicles: [],
    pets: [],
    createdAt: '2026-08-25',
    updatedAt: '2026-08-25',
  };

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    });
    vi.clearAllMocks();

    vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url) => {
      if (url?.includes('/payment-settings')) {
        return {
          bankAccountName: 'สมเกียรติ บัญชีหอ',
          promptPayAccountName: 'สมเกียรติ พร้อมเพย์',
        };
      }
      return { success: true, data: [] };
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('1. Room Label Formatting Utility', () => {
    it('formats room option as "${roomNumber} • ${buildingName}" when building exists', () => {
      const formatted = formatOwnerRoomOptionLabel(sampleRooms[0], sampleBuildings);
      expect(formatted).toBe('101 • อาคาร A');
    });

    it('formats room option as "${roomNumber}" without dangling bullet when building is missing', () => {
      const formatted = formatOwnerRoomOptionLabel(sampleRooms[2], sampleBuildings);
      expect(formatted).toBe('103');
      expect(formatted).not.toContain('•');
    });

    it('resolves buildingName from buildings list if room only has buildingId', () => {
      const roomWithOnlyId = {
        roomNumber: '102',
        buildingId: 'bld-b',
      };
      const formatted = formatOwnerRoomOptionLabel(roomWithOnlyId, sampleBuildings);
      expect(formatted).toBe('102 • อาคาร B');
    });
  });

  describe('2. Landlord Signer Name Utility', () => {
    it('resolves bankAccountName first when present', () => {
      const settings = {
        bankAccountName: 'สมหมาย เจ้าของหอ',
        promptPayAccountName: 'นายสมหมาย พร็อมเพย์',
      };
      expect(resolveLandlordSignerName(settings)).toBe('สมหมาย เจ้าของหอ');
    });

    it('falls back to promptPayAccountName if bankAccountName is blank or missing', () => {
      const settings = {
        bankAccountName: '   ',
        promptPayAccountName: 'นายสมหมาย พร็อมเพย์',
      };
      expect(resolveLandlordSignerName(settings)).toBe('นายสมหมาย พร็อมเพย์');
    });

    it('returns empty string if neither is present (never "-", "(-)", or "ไม่มีข้อมูล")', () => {
      const settings = {
        bankAccountName: '',
        promptPayAccountName: '  ',
      };
      const result = resolveLandlordSignerName(settings);
      expect(result).toBe('');
      expect(result).not.toContain('-');
      expect(result).not.toContain('ไม่มีข้อมูล');
    });
  });

  describe('3. Move-Out Modal Corrections', () => {
    it('does NOT render the top paid-deposit badge (เงินประกันชำระแล้ว: ฿...) in move-out modal', async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            dormitory={sampleDormitory}
            tenants={[activeMonthlyTenant]}
            rooms={sampleRooms}
            contracts={[activeContract]}
            initialTenantId={activeMonthlyTenant.id}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onSaveContracts={vi.fn()}
            onAddLog={vi.fn()}
            buildings={sampleBuildings}
          />
        </QueryClientProvider>
      );

      // Open move-out modal using 'เลิกเช่า' button
      const moveOutBtn = screen.getByRole('button', { name: /^เลิกเช่า$/ });
      act(() => {
        fireEvent.click(moveOutBtn);
      });

      // Confirm modal opened
      expect(screen.getByText(/ทำเรื่องเลิกเช่าคืนห้องพัก/i)).toBeDefined();

      // Top paid-deposit badge MUST NOT exist
      expect(screen.queryByText(/เงินประกันชำระแล้ว:/i)).toBeNull();
    });

    it('does NOT render the refund channel section (ช่องทางการคืนเงิน / พร้อมเพย์ / ธนาคาร / เงินสด)', async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            dormitory={sampleDormitory}
            tenants={[activeMonthlyTenant]}
            rooms={sampleRooms}
            contracts={[activeContract]}
            initialTenantId={activeMonthlyTenant.id}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onSaveContracts={vi.fn()}
            onAddLog={vi.fn()}
            buildings={sampleBuildings}
          />
        </QueryClientProvider>
      );

      const moveOutBtn = screen.getByRole('button', { name: /^เลิกเช่า$/ });
      act(() => {
        fireEvent.click(moveOutBtn);
      });

      // Confirm modal is opened
      expect(screen.getByText(/ทำเรื่องเลิกเช่าคืนห้องพัก/i)).toBeDefined();

      // Refund channel headers and choices MUST NOT exist
      expect(screen.queryByText(/ช่องทางการคืนเงิน/i)).toBeNull();
      expect(screen.queryByText(/พร้อมเพย์/i)).toBeNull();
      expect(screen.queryByText(/โอนผ่านธนาคาร/i)).toBeNull();
      expect(screen.queryByText(/เงินสด/i)).toBeNull();
    });

    it('renders deduction chips without preset prices, and clicking chip adds deduction with empty amount', async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            dormitory={sampleDormitory}
            tenants={[activeMonthlyTenant]}
            rooms={sampleRooms}
            contracts={[activeContract]}
            initialTenantId={activeMonthlyTenant.id}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onSaveContracts={vi.fn()}
            onAddLog={vi.fn()}
            buildings={sampleBuildings}
          />
        </QueryClientProvider>
      );

      const moveOutBtn = screen.getByRole('button', { name: /^เลิกเช่า$/ });
      act(() => {
        fireEvent.click(moveOutBtn);
      });

      // Confirm modal is opened
      expect(screen.getByText(/ทำเรื่องเลิกเช่าคืนห้องพัก/i)).toBeDefined();

      // Chips must NOT display preset amounts like (500) or ฿500
      expect(screen.queryByText(/ค่าทำความสะอาด.*500/i)).toBeNull();

      // Find chip "ค่าทำความสะอาดห้องพัก"
      const chip = screen.getByRole('button', { name: /ค่าทำความสะอาดห้องพัก/i });
      expect(chip).toBeDefined();

      // Click chip to add deduction item
      act(() => {
        fireEvent.click(chip);
      });

      // Deductions table/inputs should now contain item with name "ค่าทำความสะอาดห้องพัก"
      const nameInput = screen.getByDisplayValue('ค่าทำความสะอาดห้องพัก');
      expect(nameInput).toBeDefined();

      // The amount input for this deduction MUST be empty string, NOT 500
      const amountInputs = screen.getAllByPlaceholderText('0');
      const itemAmountInput = amountInputs.find(input => (input as HTMLInputElement).value === '500');
      expect(itemAmountInput).toBeUndefined();
    });

    it('does NOT render the additional-note field (หมายเหตุบันทึกเพิ่มเติม)', async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            dormitory={sampleDormitory}
            tenants={[activeMonthlyTenant]}
            rooms={sampleRooms}
            contracts={[activeContract]}
            initialTenantId={activeMonthlyTenant.id}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onSaveContracts={vi.fn()}
            onAddLog={vi.fn()}
            buildings={sampleBuildings}
          />
        </QueryClientProvider>
      );

      const moveOutBtn = screen.getByRole('button', { name: /^เลิกเช่า$/ });
      act(() => {
        fireEvent.click(moveOutBtn);
      });

      // Confirm modal is opened
      expect(screen.getByText(/ทำเรื่องเลิกเช่าคืนห้องพัก/i)).toBeDefined();

      // Additional note field MUST NOT exist
      expect(screen.queryByText(/หมายเหตุบันทึกเพิ่มเติม/i)).toBeNull();
      expect(screen.queryByPlaceholderText(/ระบุรายละเอียดเพิ่มเติมสำหรับการคืนเงินประกัน/i)).toBeNull();
    });
  });

  describe('4. Missing Contact Email Fallback', () => {
    it('renders "-" when email is empty or null, never "ไม่มีข้อมูล"', async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            dormitory={sampleDormitory}
            tenants={[activeMonthlyTenant]}
            rooms={sampleRooms}
            contracts={[activeContract]}
            initialTenantId={activeMonthlyTenant.id}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onSaveContracts={vi.fn()}
            onAddLog={vi.fn()}
            buildings={sampleBuildings}
          />
        </QueryClientProvider>
      );

      // In the tenant profile header / contact section
      // Email label should be accompanied by "-"
      const emailLabel = screen.getByText('อีเมลติดต่อ');
      const emailContainer = emailLabel.parentElement;
      expect(emailContainer?.textContent).toContain('-');
      expect(emailContainer?.textContent).not.toContain('ไม่มีข้อมูล');
    });
  });

  describe('5. Pending Contract Explanatory Note Removal', () => {
    it('does NOT render the warning/note about issuing real contract upon approval', async () => {
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
            buildings={sampleBuildings}
          />
        </QueryClientProvider>
      );

      // Switch to Contract tab
      const contractTab = screen.getByRole('button', { name: /สัญญาเช่า/i });
      fireEvent.click(contractTab);

      // Note MUST NOT exist
      expect(screen.queryByText(/ระบบจะออกหนังสือสัญญาเช่าจริงและบันทึกข้อมูลอย่างสมบูรณ์เมื่อกด/i)).toBeNull();
    });
  });

  describe('6. Rejection Modal Misleading Sentence Removal', () => {
    it('does NOT render misleading sentence about status changing to เลิกเช่า/ยกเลิก', async () => {
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
            buildings={sampleBuildings}
          />
        </QueryClientProvider>
      );

      // Click reject button
      const rejectBtn = screen.getAllByRole('button', { name: /ปฏิเสธคำขอ/i })[0];
      fireEvent.click(rejectBtn);

      // Misleading text MUST NOT exist
      expect(screen.queryByText(/สถานะของผู้เช่าจะถูกเปลี่ยนเป็น "เลิกเช่า\/ยกเลิก"/i)).toBeNull();
    });
  });

  describe('7. White-Fade Toast Notification', () => {
    it('renders canonical HorPlus white toast with exact text and proper auto-dismiss timing', async () => {
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
            buildings={sampleBuildings}
          />
        </QueryClientProvider>
      );

      // Open approve modal
      const approveBtn = screen.getAllByRole('button', { name: /อนุมัติคำขอ/i })[0];
      fireEvent.click(approveBtn);

      // Select room
      const roomSelect = screen.getByLabelText(/เลือกห้องพักที่ต้องการจัดสรร/i);
      fireEvent.change(roomSelect, { target: { value: 'room-102' } });

      // Confirm approval
      const confirmApproveBtn = screen.getByRole('button', { name: /ยืนยันอนุมัติและรับผู้เช่าเข้าพัก/i });
      await act(async () => {
        fireEvent.click(confirmApproveBtn);
      });

      // Toast must appear with canonical white-fade styling
      const toast = screen.getByTestId('tenant-action-toast');
      expect(toast).toBeDefined();
      expect(toast.textContent).toContain('อนุมัติคำขอเรียบร้อยแล้ว');
      expect(toast.className).toContain('bg-white');
      expect(toast.className).toContain('border-slate-200/90');
      expect(toast.className).toContain('shadow-2xl');

      // Fast forward past fade (2900ms) but before unmount (3500ms)
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      // Toast still in DOM (fading out)
      expect(screen.queryByTestId('tenant-action-toast')).not.toBeNull();

      // Fast forward past unmount (3500ms)
      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(screen.queryByTestId('tenant-action-toast')).toBeNull();

      vi.useRealTimers();
    });
  });

  describe('8. Room Option Formatting in Approval Modal', () => {
    it('renders room options with building name in approval dropdown', async () => {
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
            buildings={sampleBuildings}
          />
        </QueryClientProvider>
      );

      // Open approve modal
      const approveBtn = screen.getAllByRole('button', { name: /อนุมัติคำขอ/i })[0];
      fireEvent.click(approveBtn);

      // Room dropdown should have options with format: `${roomNumber} • ${buildingName}`
      const roomSelect = screen.getByLabelText(/เลือกห้องพักที่ต้องการจัดสรร/i);
      const options = Array.from(roomSelect.querySelectorAll('option'));
      
      const optionTexts = options.map(o => o.textContent);
      expect(optionTexts.some(t => t?.includes('102 • อาคาร B'))).toBe(true);
      expect(optionTexts.some(t => t === '103')).toBe(true);
    });
  });
});
