/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OwnerTenants } from '../pages/owner/tenants';
import { QuickAddTenantModal } from '../components/QuickAddTenantModal';
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
    citizenId: '1234567890123',
    idCardPhotoMock: 'data:image/png;base64,mockphotodata',
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

  describe('9. Tenant Profile: ID Card Document Print Shows Actual ID Card Text (Issue 1)', () => {
    it('generates printed document containing authoritative tenant citizenId and name without raw string concatenation', async () => {
      let writtenHtml = '';
      const mockPrintWindow = {
        document: {
          write: vi.fn((html: string) => {
            writtenHtml = html;
          }),
          close: vi.fn(),
        },
      };
      const openSpy = vi.spyOn(window, 'open').mockReturnValue(mockPrintWindow as any);

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

      // Open ID card modal
      const idDocItem = screen.getByTitle('คลิกเพื่อเปิดดูภาพสำเนาบัตรประชาชน');
      fireEvent.click(idDocItem);

      // Click print button
      const printBtn = screen.getByRole('button', { name: /พิมพ์เอกสาร/i });
      fireEvent.click(printBtn);

      expect(openSpy).toHaveBeenCalled();
      expect(mockPrintWindow.document.write).toHaveBeenCalled();
      expect(writtenHtml).toContain('เอกสารสำเนาบัตรประจำตัวประชาชนผู้เช่า');
      expect(writtenHtml).toContain('1234567890123');
      expect(writtenHtml).toContain('นายสมชาย ผู้พักอาศัย');
      expect(writtenHtml).toContain('0811112233');

      // Crucial: Must NOT contain raw string concatenation artifacts
      expect(writtenHtml).not.toContain("'+ (selectedTenant.citizenId || '-') +'");
      expect(writtenHtml).not.toContain("'+ (selectedTenant.name || '-') +'");

      openSpy.mockRestore();
    });
  });

  describe('10. QuickAddTenantModal: Hide Installment Table When Installment = 1 (Issue 2)', () => {
    const mockRoom101Context = {
      roomId: 'room-101-uuid',
      dormitoryId: mockDormitoryId,
      roomNumber: '101',
      buildingId: 'bld-a',
      effective: {
        monthlyRent: 3500,
        termRent: 12000,
        dailyRent: 550,
        depositAmount: 3500,
      },
      building: {
        id: 'bld-a',
        name: 'อาคาร A',
        termMonths: 4,
        maxTermRentInstallments: 3,
      },
    };

    it('hides installment table and schedule title when installment count = 1, and shows when > 1', async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <QuickAddTenantModal
            isOpen={true}
            onClose={vi.fn()}
            context={mockRoom101Context as any}
            defaultTab="TERM"
            hideLineTab={true}
            onSuccess={vi.fn()}
          />
        </QueryClientProvider>
      );

      // In QuickAddTenantModal, termInstallmentCount defaults to 1
      // Initially, when installmentCount === 1, table and schedule title MUST be hidden
      expect(screen.queryByText(/ตารางแบ่งชำระรายงวด/)).toBeNull();

      // Normal financial breakdown must remain visible
      expect(screen.getByText('ค่าเช่ารวม:')).toBeDefined();
      expect(screen.getByText('เงินประกัน/มัดจำ:')).toBeDefined();
      expect(screen.getByText('ยอดตามข้อตกลง:')).toBeDefined();
      expect(screen.getByText('ยอดชำระแล้ว:')).toBeDefined();
      expect(screen.getByText('ยอดค้างชำระคงเหลือ:')).toBeDefined();

      // Find the installment count select
      const selects = screen.getAllByRole('combobox');
      const installmentSelect = selects.find(s => (s as HTMLSelectElement).value === '1') as HTMLSelectElement;
      expect(installmentSelect).toBeDefined();

      // Change installment to 2
      fireEvent.change(installmentSelect, { target: { value: '2' } });

      // When installmentCount > 1, table and schedule title MUST be rendered
      expect(screen.getByText(/ตารางแบ่งชำระรายงวด \(2 งวด\):/)).toBeDefined();
      expect(screen.getByText('งวดที่ 1:')).toBeDefined();
      expect(screen.getByText('งวดที่ 2:')).toBeDefined();

      // Change back to 1
      fireEvent.change(installmentSelect, { target: { value: '1' } });

      // Must be hidden again
      expect(screen.queryByText(/ตารางแบ่งชำระรายงวด/)).toBeNull();
    });
  });

  describe('11. White-Fade Toast Feedback on Co-Occupant Actions (Issue 3)', () => {
    it('shows white-fade toast "เพิ่มผู้พักร่วมเรียบร้อยแล้ว" after adding a co-occupant', async () => {
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

      // Switch to Co-occupants / History tab
      const coTabBtn = screen.getByRole('button', { name: /ประวัติผู้พักร่วม|ผู้พักร่วม/i });
      fireEvent.click(coTabBtn);

      // Open add co-occupant modal
      const addCoBtn = screen.getByRole('button', { name: 'บันทึกแจ้งผู้พักร่วม' });
      fireEvent.click(addCoBtn);

      // Fill in required name and phone
      const nameInput = screen.getByPlaceholderText('เช่น สมชาย ใจดี');
      fireEvent.change(nameInput, { target: { value: 'สมจิต ผู้พักร่วม' } });
      const phoneInput = screen.getByPlaceholderText('เช่น 081-234-5678');
      fireEvent.change(phoneInput, { target: { value: '0899998877' } });

      vi.useFakeTimers();

      // Click "บันทึกเพิ่มผู้พักร่วม"
      const submitBtn = screen.getByRole('button', { name: /บันทึกเพิ่มผู้พักร่วม/i });
      fireEvent.click(submitBtn);

      // Toast must appear with canonical white-fade styling and text
      const toast = screen.getByTestId('tenant-action-toast');
      expect(toast).toBeDefined();
      expect(toast.textContent).toContain('เพิ่มผู้พักร่วมเรียบร้อยแล้ว');
      expect(toast.className).toContain('bg-white');
      expect(toast.className).toContain('border-slate-200/90');
      expect(toast.className).toContain('shadow-2xl');

      // Fast-forward timer to dismiss
      act(() => {
        vi.advanceTimersByTime(3600);
      });
      expect(screen.queryByTestId('tenant-action-toast')).toBeNull();

      vi.useRealTimers();
    });

    it('shows white-fade toast "นำผู้พักร่วมออกเรียบร้อยแล้ว" after removing a co-occupant', async () => {
      const tenantWithCo: Tenant = {
        ...activeMonthlyTenant,
        coOccupants: [
          {
            id: 'co-1',
            name: 'สมหญิง ผู้พักร่วมเดิม',
            phone: '0822223344',
            relationship: 'แฟน',
            addedAt: '2026-01-01',
          },
        ],
      };

      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            dormitory={sampleDormitory}
            tenants={[tenantWithCo]}
            rooms={sampleRooms}
            contracts={[activeContract]}
            initialTenantId={tenantWithCo.id}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onSaveContracts={vi.fn()}
            onAddLog={vi.fn()}
            buildings={sampleBuildings}
          />
        </QueryClientProvider>
      );

      // Switch to Co-occupants / History tab
      const coTabBtn = screen.getByRole('button', { name: /ประวัติผู้พักร่วม|ผู้พักร่วม/i });
      fireEvent.click(coTabBtn);

      // Click "นำออก" button
      const removeBtn = screen.getByTitle('นำผู้พักร่วมออกจากห้องพัก');
      fireEvent.click(removeBtn);

      vi.useFakeTimers();

      // Click "ยืนยันการนำออกและบันทึกประวัติ"
      const confirmRemoveBtn = screen.getByRole('button', { name: /ยืนยันการนำออกและบันทึกประวัติ/i });
      fireEvent.click(confirmRemoveBtn);

      // Toast must appear with canonical white-fade styling and text
      const toast = screen.getByTestId('tenant-action-toast');
      expect(toast).toBeDefined();
      expect(toast.textContent).toContain('นำผู้พักร่วมออกเรียบร้อยแล้ว');
      expect(toast.className).toContain('bg-white');
      expect(toast.className).toContain('border-slate-200/90');
      expect(toast.className).toContain('shadow-2xl');

      // Fast-forward timer to dismiss
      act(() => {
        vi.advanceTimersByTime(3600);
      });
      expect(screen.queryByTestId('tenant-action-toast')).toBeNull();

      vi.useRealTimers();
    });

    it('shows white-fade toast "บันทึกการแก้ไขเรียบร้อยแล้ว" after saving tenant edit', async () => {
      const httpSpy = vi.spyOn(httpClient, 'httpRequest').mockResolvedValue({
        success: true,
        data: {
          tenant: {
            ...activeMonthlyTenant,
            name: 'นายสมชาย ผู้พักอาศัย แก้ไขใหม่',
            version: 2,
          },
          emergencyContacts: [
            { id: 'em-1', name: 'สมศรี ผู้ติดต่อ', phone: '0855554433', relationship: 'มารดา', isPrimary: true },
          ],
          vehicles: [],
        },
      });

      const tenantWithEmergency: Tenant = {
        ...activeMonthlyTenant,
        emergencyContact: {
          name: 'สมศรี ผู้ติดต่อ',
          phone: '0855554433',
          relationship: 'มารดา',
        },
      };

      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            dormitory={sampleDormitory}
            tenants={[tenantWithEmergency]}
            rooms={sampleRooms}
            contracts={[activeContract]}
            initialTenantId={tenantWithEmergency.id}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onSaveContracts={vi.fn()}
            onAddLog={vi.fn()}
            buildings={sampleBuildings}
          />
        </QueryClientProvider>
      );

      // Click "แก้ไขข้อมูล"
      const editBtn = screen.getByRole('button', { name: 'แก้ไขข้อมูล' });
      fireEvent.click(editBtn);

      // Change name to trigger dirty state
      const nameInput = screen.getByDisplayValue(tenantWithEmergency.name);
      fireEvent.change(nameInput, { target: { value: 'นายสมชาย ผู้พักอาศัย แก้ไขใหม่' } });

      vi.useFakeTimers();

      // Click "บันทึกการแก้ไข"
      const saveBtn = screen.getByRole('button', { name: 'บันทึกการแก้ไข' });
      await act(async () => {
        fireEvent.click(saveBtn);
      });

      // Toast must appear with canonical white-fade styling and text
      const toast = screen.getByTestId('tenant-action-toast');
      expect(toast).toBeDefined();
      expect(toast.textContent).toContain('บันทึกการแก้ไขเรียบร้อยแล้ว');
      expect(toast.className).toContain('bg-white');
      expect(toast.className).toContain('border-slate-200/90');
      expect(toast.className).toContain('shadow-2xl');

      // Fast-forward timer to dismiss
      act(() => {
        vi.advanceTimersByTime(3600);
      });
      expect(screen.queryByTestId('tenant-action-toast')).toBeNull();

      vi.useRealTimers();
      httpSpy.mockRestore();
    });

    it('shows white-fade toast "เพิ่มผู้เช่าเรียบร้อยแล้ว" after confirming quick-add in OwnerTenants', async () => {
      const httpSpy = vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url) => {
        if (String(url).includes('quick-add-context')) {
          return {
            data: {
              roomId: 'room-103',
              dormitoryId: mockDormitoryId,
              roomNumber: '103',
              effective: {
                monthlyRent: 4500,
                monthlyDeposit: 4500,
                termRent: 18000,
                termDeposit: 4500,
                termMonths: 4,
                dailyRate: 500,
                dailyDeposit: 500,
              },
              building: {
                id: 'bld-a',
                name: 'อาคาร A',
                termMonths: 4,
                maxInstallments: 1,
              },
            },
          };
        }
        if (String(url).includes('provisional-terms')) {
          return {
            success: true,
            tenant: { id: 'tnt-new', name: 'ผู้เช่าใหม่ เทอม', phone: '0898887766' },
          };
        }
        return { success: true };
      });

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

      // Click "จดทะเบียนผู้เช่าและย้ายเข้า"
      const quickAddBtn = screen.getByTitle('จดทะเบียนผู้เช่าและย้ายเข้า');
      await act(async () => {
        fireEvent.click(quickAddBtn);
      });

      // Switch to MONTHLY tab
      const monthlyTab = screen.getByTestId('tab-monthly');
      fireEvent.click(monthlyTab);

      // Enter required tenant name and phone
      const nameInput = screen.getByPlaceholderText(/เช่น นายสมชาย ใจดี/i);
      fireEvent.change(nameInput, { target: { value: 'ผู้เช่าใหม่ รายเดือน' } });
      const phoneInput = screen.getByPlaceholderText(/เช่น 081-234-5678/i);
      fireEvent.change(phoneInput, { target: { value: '0898887766' } });

      vi.useFakeTimers();

      // Submit form
      const submitBtn = screen.getByRole('button', { name: /ยืนยันเพิ่มผู้เช่า/i });
      await act(async () => {
        fireEvent.submit(submitBtn.closest('form')!);
      });

      // Toast must appear with canonical white-fade styling and exact canonical text
      const toast = screen.getByTestId('tenant-action-toast');
      expect(toast).toBeDefined();
      expect(toast.querySelector('span')?.textContent?.trim()).toBe('เพิ่มผู้เช่าเรียบร้อยแล้ว');
      expect(toast.textContent).toContain('เพิ่มผู้เช่าเรียบร้อยแล้ว');
      expect(toast.textContent).not.toContain('รายเดือน');
      expect(toast.textContent).not.toContain('รายเทอม');
      expect(toast.textContent).not.toContain('รายวัน');
      expect(toast.textContent).not.toContain('ผู้เช่าใหม่');
      expect(toast.textContent).not.toContain('103');
      expect(toast.className).toContain('bg-white');
      expect(toast.className).toContain('border-slate-200/90');
      expect(toast.className).toContain('shadow-2xl');

      // Fast-forward timer to dismiss
      act(() => {
        vi.advanceTimersByTime(3600);
      });
      expect(screen.queryByTestId('tenant-action-toast')).toBeNull();

      vi.useRealTimers();
      httpSpy.mockRestore();
    });
  });
});
