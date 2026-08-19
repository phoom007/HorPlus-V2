// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * LOCAL-07 Batch 02 — Frontend Boundary & Quick Add UI Test Suite
 * Proofs covering Meter Quick Add button fail-closed cycle matrix, Route alignment, End Date persistence, and Authority defaults.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { QuickAddTenantModal } from '../components/QuickAddTenantModal';
import { OwnerMeters } from '../pages/owner/meters';
import * as httpClient from '../data/httpClient';
import { Room, Building, QuickAddRoomContext } from '../types';
import { queryKeys } from '../lib/queryClient';
import { calculateMeterRowPreview } from '../utils/meterBillingCalculator';
import { meterDraftStore } from '../lib/meterDraftStore';

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

const renderWithClient = (ui: React.ReactElement) => {
  const client = createTestQueryClient();
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

describe('LOCAL-07 Batch 02 — Frontend Quick Add & Claim Boundary Suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    meterDraftStore.clearDormitoryDrafts('dorm-001-uuid');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const mockRoom: Room = {
    id: 'room-101-uuid',
    buildingId: 'bld-001-uuid',
    roomNumber: '101',
    floor: 1,
    status: 'vacant',
    monthlyRent: 4500,
    dailyRent: 350,
    depositAmount: 0, // Configured 0 deposit
    maxOccupants: 2,
    initialWaterMeter: 0,
    initialElectricMeter: 0,
    images: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };

  const mockBuilding: Building = {
    id: 'bld-001-uuid',
    name: 'Building A',
    floorsCount: 4,
    maxTermRentInstallments: 3,
    termMonths: 4,
    dailyRent: 400,
    depositAmount: 500,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };

  const mockContext: QuickAddRoomContext = {
    roomId: 'room-101-uuid',
    dormitoryId: 'dorm-001-uuid',
    roomNumber: '101',
    buildingId: 'bld-001-uuid',
    effective: {
      monthlyRent: 4500,
      termRent: 18000,
      dailyRent: 350,
      depositAmount: 0,
    },
    building: {
      id: 'bld-001-uuid',
      name: 'Building A',
      termMonths: 4,
      maxTermRentInstallments: 3,
    },
  };

  // ==========================================
  // Section 10: Operational-Cycle Test Matrix
  // ==========================================
  describe('Operational-Cycle Fail-Closed Matrix', () => {
    it('Matrix A: authority loaded + current cycle -> Quick Add visible and fetches real context on click', async () => {
      const httpSpy = vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url) => {
        if (url === '/billing-cycles') {
          return {
            data: [{ id: 'cycle-2026-08', cycleCode: '2026-08', status: 'open', isCurrent: true }],
            operationalCycleCode: '2026-08',
            operationalBillingCycleId: 'cycle-2026-08',
          };
        }
        if (url.includes('/quick-add-context')) {
          return {
            data: mockContext,
          };
        }
        return { success: true, data: [] };
      });

      renderWithClient(
        <OwnerMeters
          rooms={[mockRoom]}
          buildings={[mockBuilding]}
          dormitoryId="dorm-001-uuid"
          bills={[]}
          tenants={[]}
          contracts={[]}
          onSaveBills={vi.fn()}
          onSelectTenant={vi.fn()}
          onAddLog={vi.fn()}
          onNavigate={vi.fn()}
          selectedBillingCycleId="cycle-2026-08"
          selectedCycleCode="2026-08"
          selectedCycle="2026-08"
        />
      );

      await waitFor(() => {
        const quickAddBtn = screen.queryByText('เพิ่มผู้เช่า');
        expect(quickAddBtn).not.toBeNull();
      });

      // Click Quick Add button -> triggers real endpoint fetch
      const quickAddBtn = screen.getByText('เพิ่มผู้เช่า');
      fireEvent.click(quickAddBtn);

      await waitFor(() => {
        expect(httpSpy).toHaveBeenCalledWith(
          'GET',
          `/api/v1/properties/rooms/${mockRoom.id}/quick-add-context`,
          undefined,
          expect.anything()
        );
      });
    });

    it('Matrix B: authority loaded + historical cycle -> Quick Add hidden', async () => {
      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url) => {
        if (url === '/billing-cycles') {
          return {
            data: [{ id: 'cycle-2026-08', cycleCode: '2026-08', status: 'open', isCurrent: true }],
            operationalCycleCode: '2026-08',
          };
        }
        return { success: true, data: [] };
      });

      renderWithClient(
        <OwnerMeters
          rooms={[mockRoom]}
          buildings={[mockBuilding]}
          dormitoryId="dorm-001-uuid"
          bills={[]}
          tenants={[]}
          contracts={[]}
          onSaveBills={vi.fn()}
          onSelectTenant={vi.fn()}
          onAddLog={vi.fn()}
          onNavigate={vi.fn()}
          selectedBillingCycleId="cycle-2025-12"
          selectedCycleCode="2025-12"
          selectedCycle="2025-12"
        />
      );

      await waitFor(() => {
        const quickAddBtn = screen.queryByText('เพิ่มผู้เช่า');
        expect(quickAddBtn).toBeNull();
        expect(screen.getByText('ไม่มีข้อมูล')).toBeDefined();
      });
    });

    it('Matrix C: authority loading / unconfirmed -> Quick Add hidden', async () => {
      // Mock delayed response
      vi.spyOn(httpClient, 'httpRequest').mockImplementation(() => new Promise(() => {}));

      renderWithClient(
        <OwnerMeters
          rooms={[mockRoom]}
          buildings={[mockBuilding]}
          dormitoryId="dorm-001-uuid"
          bills={[]}
          tenants={[]}
          contracts={[]}
          onSaveBills={vi.fn()}
          onSelectTenant={vi.fn()}
          onAddLog={vi.fn()}
          onNavigate={vi.fn()}
          selectedBillingCycleId="cycle-2026-08"
          selectedCycleCode="2026-08"
          selectedCycle="2026-08"
        />
      );

      // On initial render before authority loads, Quick Add must NOT be displayed
      const quickAddBtn = screen.queryByText('เพิ่มผู้เช่า');
      expect(quickAddBtn).toBeNull();
    });

    it('Matrix D: /billing-cycles request fails -> Quick Add hidden (fail-closed)', async () => {
      vi.spyOn(httpClient, 'httpRequest').mockRejectedValue(new Error('Network error'));

      renderWithClient(
        <OwnerMeters
          rooms={[mockRoom]}
          buildings={[mockBuilding]}
          dormitoryId="dorm-001-uuid"
          bills={[]}
          tenants={[]}
          contracts={[]}
          onSaveBills={vi.fn()}
          onSelectTenant={vi.fn()}
          onAddLog={vi.fn()}
          onNavigate={vi.fn()}
          selectedBillingCycleId="cycle-2026-08"
          selectedCycleCode="2026-08"
          selectedCycle="2026-08"
        />
      );

      await waitFor(() => {
        const quickAddBtn = screen.queryByText('เพิ่มผู้เช่า');
        expect(quickAddBtn).toBeNull();
      });
    });
  });

  // ==========================================
  // Canonical Route Alignment & Truthful Button Copy
  // ==========================================
  describe('Canonical Route Alignment & Truthful Button Copy', () => {
    it('Proof D: MONTHLY quick add submits to canonical POST /api/v1/meters/provisional-terms with "ยืนยันเพิ่มผู้เช่า"', async () => {
      const httpSpy = vi.spyOn(httpClient, 'httpRequest').mockResolvedValue({ success: true, data: { id: 'term-1' } });
      const onSuccess = vi.fn();
      const onClose = vi.fn();

      render(
        <QuickAddTenantModal
          isOpen={true}
          onClose={onClose}
          context={mockContext}
          onSuccess={onSuccess}
        />
      );

      const nameInput = screen.getByPlaceholderText('เช่น นายสมชาย ใจดี');
      fireEvent.change(nameInput, { target: { value: 'สมชาย ใจดี' } });

      const submitBtn = screen.getByText('ยืนยันเพิ่มผู้เช่า');
      fireEvent.submit(submitBtn.closest('form')!);

      await waitFor(() => {
        expect(httpSpy).toHaveBeenCalledTimes(1);
        const [method, url, payload] = httpSpy.mock.calls[0];
        expect(method).toBe('POST');
        expect(url).toBe('/api/v1/meters/provisional-terms');
        expect(payload.rentalType).toBe('MONTHLY');
        expect(payload.fullName).toBe('สมชาย ใจดี');
        expect(payload.roomId).toBe(mockContext.roomId);
        expect(payload.unitRentAmount).toBe('4500.00'); // Authoritative effective rate
        expect(onSuccess).toHaveBeenCalled();
      });
    });

    it('Proof E: TERM quick add submits to canonical POST /api/v1/meters/provisional-terms with installment count', async () => {
      const httpSpy = vi.spyOn(httpClient, 'httpRequest').mockResolvedValue({ success: true, data: { id: 'term-2' } });

      render(
        <QuickAddTenantModal
          isOpen={true}
          onClose={vi.fn()}
          context={mockContext}
          onSuccess={vi.fn()}
        />
      );

      // Switch to TERM tab
      fireEvent.click(screen.getByText('รายเทอม (Term)'));

      // Fill Full Name
      fireEvent.change(screen.getByPlaceholderText('เช่น นายสมชาย ใจดี'), { target: { value: 'สมหญิง รักเรียน' } });

      // Submit
      const submitBtn = screen.getByText('ยืนยันเพิ่มผู้เช่า');
      fireEvent.submit(submitBtn.closest('form')!);

      await waitFor(() => {
        expect(httpSpy).toHaveBeenCalledTimes(1);
        const [method, url, payload] = httpSpy.mock.calls[0];
        expect(method).toBe('POST');
        expect(url).toBe('/api/v1/meters/provisional-terms');
        expect(payload.rentalType).toBe('TERM');
        expect(payload.fullName).toBe('สมหญิง รักเรียน');
        expect(payload.termInstallmentCount).toBe(1);
      });
    });

    it('Proof F: DAILY quick add submits to POST /api/v1/daily-stays/owner-quick-add', async () => {
      const httpSpy = vi.spyOn(httpClient, 'httpRequest').mockResolvedValue({ success: true, data: { id: 'daily-1' } });

      render(
        <QuickAddTenantModal
          isOpen={true}
          onClose={vi.fn()}
          context={mockContext}
          onSuccess={vi.fn()}
        />
      );

      // Switch to DAILY tab
      fireEvent.click(screen.getByText('รายวัน (Daily)'));

      // Fill Full Name
      fireEvent.change(screen.getByPlaceholderText('เช่น นายสมชาย ใจดี'), { target: { value: 'นักท่องเที่ยว ใจดี' } });

      // Submit
      const submitBtn = screen.getByText('ยืนยันเพิ่มผู้เช่า');
      fireEvent.submit(submitBtn.closest('form')!);

      await waitFor(() => {
        expect(httpSpy).toHaveBeenCalledTimes(1);
        const [method, url, payload] = httpSpy.mock.calls[0];
        expect(method).toBe('POST');
        expect(url).toBe('/api/v1/daily-stays/owner-quick-add');
        expect(payload.dormitoryId).toBe('dorm-001-uuid');
        expect(payload.roomId).toBe(mockContext.roomId);
        expect(payload.fullName).toBe('นักท่องเที่ยว ใจดี');
        expect(payload.dailyRateAmount).toBe('350.00');
        expect(payload.depositAmount).toBe('0.00');
      });
    });
  });

  // ==========================================
  // Financial Integrity & Building Authority Invariants
  // ==========================================
  describe('Financial Integrity & Building Authority Invariants', () => {
    it('Proof G: edited MONTHLY endDate is explicitly passed in payload', async () => {
      const httpSpy = vi.spyOn(httpClient, 'httpRequest').mockResolvedValue({ success: true, data: { id: 'term-g' } });

      render(
        <QuickAddTenantModal
          isOpen={true}
          onClose={vi.fn()}
          context={mockContext}
          onSuccess={vi.fn()}
        />
      );

      fireEvent.change(screen.getByPlaceholderText('เช่น นายสมชาย ใจดี'), { target: { value: 'ผู้เช่า แก้ไขวัน' } });

      const dateInputs = screen.getAllByDisplayValue(/2026-\d{2}-\d{2}/);
      if (dateInputs.length > 1) {
        fireEvent.change(dateInputs[1], { target: { value: '2026-12-31' } });
      }

      const submitBtn = screen.getByText('ยืนยันเพิ่มผู้เช่า');
      fireEvent.submit(submitBtn.closest('form')!);

      await waitFor(() => {
        expect(httpSpy).toHaveBeenCalledTimes(1);
        const payload = httpSpy.mock.calls[0][2];
        expect(payload.endDate).toBe('2026-12-31');
      });
    });

    it('Proof H: room deposit 0 is strictly preserved and not overwritten by Building deposit', () => {
      render(
        <QuickAddTenantModal
          isOpen={true}
          onClose={vi.fn()}
          context={mockContext} // context.effective.depositAmount is 0
          onSuccess={vi.fn()}
        />
      );

      fireEvent.click(screen.getByText('รายวัน (Daily)'));

      const depositInputs = screen.getAllByRole('spinbutton');
      const depositInput = depositInputs.find((input: any) => input.value === '0');
      expect(depositInput).toBeDefined();
    });

    it('Proof I: no fake 500 daily rate when room and building have no dailyRent configured', () => {
      const emptyContext: QuickAddRoomContext = {
        roomId: 'room-empty',
        dormitoryId: 'dorm-001-uuid',
        roomNumber: '102',
        buildingId: 'bld-001-uuid',
        effective: {
          monthlyRent: 0,
          termRent: null,
          dailyRent: null,
          depositAmount: 0,
        },
        building: null,
      };

      render(
        <QuickAddTenantModal
          isOpen={true}
          onClose={vi.fn()}
          context={emptyContext}
          onSuccess={vi.fn()}
        />
      );

      fireEvent.click(screen.getByText('รายวัน (Daily)'));

      const spinInputs = screen.getAllByRole('spinbutton');
      const has500 = spinInputs.some((input: any) => input.value === '500');
      expect(has500).toBe(false);
    });

    it('Proof J: TERM max installments options follow Building authority (1..maxTermRentInstallments)', () => {
      render(
        <QuickAddTenantModal
          isOpen={true}
          onClose={vi.fn()}
          context={mockContext} // mockContext.building.maxTermRentInstallments = 3
          onSuccess={vi.fn()}
        />
      );

      fireEvent.click(screen.getByText('รายเทอม (Term)'));

      const select = screen.getByRole('combobox');
      expect(select.children.length).toBe(3); // Options: 1, 2, 3
    });

    it('Proof K: TERM fails closed when Building termMonths is unconfigured (no fake 6 months default)', () => {
      const noTermBldContext: QuickAddRoomContext = {
        roomId: 'room-noterm',
        dormitoryId: 'dorm-001-uuid',
        roomNumber: '103',
        buildingId: 'bld-no-term',
        effective: {
          monthlyRent: 4000,
          termRent: null,
          dailyRent: null,
          depositAmount: 0,
        },
        building: {
          id: 'bld-no-term',
          name: 'Building No Term',
          // termMonths undefined
        },
      };

      render(
        <QuickAddTenantModal
          isOpen={true}
          onClose={vi.fn()}
          context={noTermBldContext}
          onSuccess={vi.fn()}
        />
      );

      fireEvent.click(screen.getByText('รายเทอม (Term)'));

      // Invariant: Shows clear warning banner and disables submit
      expect(screen.getByText(/ไม่พบข้อมูลระยะเวลาสัญญาแบบเทอมของอาคาร/)).toBeDefined();
      const submitBtn = screen.getByText('ยืนยันเพิ่มผู้เช่า');
      expect(submitBtn.closest('button')?.disabled).toBe(true);
    });

    it('Proof L: TERM null termRent does not derive from monthly rent and requires Owner input before submit', async () => {
      const nullTermContext: QuickAddRoomContext = {
        roomId: 'room-nullterm',
        dormitoryId: 'dorm-001-uuid',
        roomNumber: '104',
        buildingId: 'bld-001-uuid',
        effective: {
          monthlyRent: 5000,
          termRent: null, // Unconfigured
          dailyRent: null,
          depositAmount: 0,
        },
        building: {
          id: 'bld-001-uuid',
          name: 'Building A',
          termMonths: 4,
          maxTermRentInstallments: 2,
        },
      };

      render(
        <QuickAddTenantModal
          isOpen={true}
          onClose={vi.fn()}
          context={nullTermContext}
          onSuccess={vi.fn()}
        />
      );

      fireEvent.click(screen.getByText('รายเทอม (Term)'));

      // Invariant: Does not auto-derive 5000 * 4 = 20000. Shows empty placeholder.
      const termRentInput = screen.getByPlaceholderText('ระบุค่าเช่ารายเทอม') as HTMLInputElement;
      expect(termRentInput.value).toBe('');

      // Submit is disabled
      const submitBtn = screen.getByText('ยืนยันเพิ่มผู้เช่า');
      expect(submitBtn.closest('button')?.disabled).toBe(true);

      // Fill Full Name
      fireEvent.change(screen.getByPlaceholderText('เช่น นายสมชาย ใจดี'), { target: { value: 'สมศักดิ์ เทอมตรง' } });
      expect(submitBtn.closest('button')?.disabled).toBe(true);

      // Once Owner explicitly enters agreed term rent, submit becomes enabled
      fireEvent.change(termRentInput, { target: { value: '19000' } });
      expect(submitBtn.closest('button')?.disabled).toBe(false);
    });
  });

  // ==========================================
  // Real Tenant Entry Surface Navigation Tests
  // ==========================================
  describe('Real Tenant Entry Surface Navigation Proofs', () => {
    it('Authenticated pre-link user can open Daily Request modal with roomNumber and request-context endpoint', async () => {
      const httpSpy = vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url) => {
        if (url.includes('public-policy')) {
          return {
            dormitoryId: 'dorm-001-uuid',
            dormitoryName: 'HorPlus Dormitory',
            defaultTerms: '',
            petPolicy: { allowed: 'none', allowedTypes: [] },
            version: 1,
          };
        }
        if (url.includes('/daily-stays/request-context')) {
          return {
            data: {
              roomId: 'room-101-uuid',
              roomNumber: 'A101',
              dailyRateAmount: '350.00',
              depositDefaultAmount: '0.00',
            },
          };
        }
        return { success: true, data: [] };
      });

      // Mock session endpoint
      vi.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
        if (String(url).includes('/auth/session')) {
          return {
            ok: true,
            json: async () => ({ data: { user: { id: 'user-prelink-1', name: 'Prelink User' } } }),
          } as any;
        }
        return { ok: true, json: async () => ({}) } as any;
      });

      const { TenantRegisterPage } = await import('../pages/tenant/TenantRegisterPage');

      render(<TenantRegisterPage />);

      const dailyBtn = await screen.findByTestId('tenant-daily-request-btn');
      fireEvent.click(dailyBtn);

      const modalHeader = await screen.findByText(/ขอเข้าพักรายวันห้อง/);
      expect(modalHeader).toBeDefined();

      await waitFor(() => {
        expect(httpSpy).toHaveBeenCalledWith(
          'GET',
          expect.stringContaining('/api/v1/daily-stays/request-context'),
          undefined,
          expect.anything()
        );
      });

      const submitBtn = await screen.findByTestId('tenant-daily-submit-btn');
      expect(submitBtn).toBeDefined();
    });

    it('Tenant Daily Request Modal fails closed and disables submit button when context fetch fails', async () => {
      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url) => {
        if (url.includes('public-policy')) {
          return {
            dormitoryId: 'dorm-001-uuid',
            dormitoryName: 'HorPlus Dormitory',
            defaultTerms: '',
            petPolicy: { allowed: 'none', allowedTypes: [] },
            version: 1,
          };
        }
        if (url.includes('/daily-stays/request-context')) {
          throw new Error('ไม่พบข้อมูลห้องพักที่ระบุ');
        }
        return { success: true, data: [] };
      });

      vi.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
        if (String(url).includes('/auth/session')) {
          return {
            ok: true,
            json: async () => ({ data: { user: { id: 'user-prelink-1', name: 'Prelink User' } } }),
          } as any;
        }
        return { ok: true, json: async () => ({}) } as any;
      });

      const { TenantRegisterPage } = await import('../pages/tenant/TenantRegisterPage');

      render(<TenantRegisterPage />);

      const dailyBtn = await screen.findByTestId('tenant-daily-request-btn');
      fireEvent.click(dailyBtn);

      await waitFor(() => {
        expect(screen.getByText(/ไม่สามารถโหลดข้อมูลห้องพักหรืออัตราค่าเช่าได้/)).toBeDefined();
      });

      const submitBtn = screen.getByTestId('tenant-daily-submit-btn');
      expect((submitBtn as HTMLButtonElement).disabled).toBe(true);
    });

    it('Authenticated pre-link user can open Self-Claim modal with roomNumber parameter', async () => {
      const httpSpy = vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url) => {
        if (url.includes('public-policy')) {
          return {
            dormitoryId: 'dorm-001-uuid',
            dormitoryName: 'HorPlus Dormitory',
            defaultTerms: '',
            petPolicy: { allowed: 'none', allowedTypes: [] },
            version: 1,
          };
        }
        if (url.includes('candidate')) {
          return {
            data: { hasCandidate: true, roomNumber: 'A101', maskedName: 'สม***', maskedPhone: '081-***-1234' },
          };
        }
        return { success: true, data: [] };
      });

      vi.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
        if (String(url).includes('/auth/session')) {
          return {
            ok: true,
            json: async () => ({ data: { user: { id: 'user-prelink-1', name: 'Prelink User' } } }),
          } as any;
        }
        return { ok: true, json: async () => ({}) } as any;
      });

      const { TenantRegisterPage } = await import('../pages/tenant/TenantRegisterPage');

      render(<TenantRegisterPage />);

      const claimBtn = await screen.findByTestId('tenant-self-claim-btn');
      fireEvent.click(claimBtn);

      const claimHeader = await screen.findByText(/ยืนยันสิทธิ์ผู้เช่าห้อง/);
      expect(claimHeader).toBeDefined();

      await waitFor(() => {
        expect(httpSpy).toHaveBeenCalledWith(
          'GET',
          expect.stringContaining('/api/v1/tenant-claims/candidate?dormitoryId=dorm-001-uuid&roomNumber=A101')
        );
      });
    });

    it('Owner Quick Add: unconfigured dailyRent (null) disables submit until Owner inputs agreed rate', async () => {
      const nullDailyContext: QuickAddRoomContext = {
        ...mockContext,
        effective: {
          ...mockContext.effective,
          dailyRent: null as any,
        },
      };

      render(
        <QuickAddTenantModal
          isOpen={true}
          onClose={() => {}}
          context={nullDailyContext}
          onSuccess={() => {}}
        />
      );

      // Switch to DAILY tab
      const dailyTab = screen.getByRole('button', { name: /รายวัน/ });
      fireEvent.click(dailyTab);

      // Name input
      const nameInput = screen.getByPlaceholderText('เช่น นายสมชาย ใจดี');
      fireEvent.change(nameInput, { target: { value: 'นายทดสอบ รายวัน' } });

      // Daily rate input should have empty value with placeholder
      const dailyInput = screen.getByPlaceholderText('ยังไม่ได้กำหนดค่าเช่ารายวัน');
      expect((dailyInput as HTMLInputElement).value).toBe('');

      // Warning text should be visible
      expect(screen.getByText(/ยังไม่ได้กำหนดค่าเช่ารายวัน กรุณาระบุราคาที่ตกลงกัน/)).toBeDefined();

      // Submit button must be disabled
      const submitBtn = screen.getByRole('button', { name: /ยืนยันเพิ่มผู้เช่า/ });
      expect((submitBtn as HTMLButtonElement).disabled).toBe(true);

      // Owner enters agreed daily rate 450
      fireEvent.change(dailyInput, { target: { value: '450' } });

      // Submit button becomes enabled
      expect((submitBtn as HTMLButtonElement).disabled).toBe(false);
    });

    it('Owner Quick Add: configured 0.00 dailyRent is strictly preserved as valid money', async () => {
      const zeroDailyContext: QuickAddRoomContext = {
        ...mockContext,
        effective: {
          ...mockContext.effective,
          dailyRent: 0,
        },
      };

      render(
        <QuickAddTenantModal
          isOpen={true}
          onClose={() => {}}
          context={zeroDailyContext}
          onSuccess={() => {}}
        />
      );

      // Switch to DAILY tab
      const dailyTab = screen.getByRole('button', { name: /รายวัน/ });
      fireEvent.click(dailyTab);

      // Name input
      const nameInput = screen.getByPlaceholderText('เช่น นายสมชาย ใจดี');
      fireEvent.change(nameInput, { target: { value: 'นายพักฟรี ศูนย์บาท' } });

      // Daily rate input should have '0'
      const dailyInput = screen.getByPlaceholderText('ยังไม่ได้กำหนดค่าเช่ารายวัน');
      expect((dailyInput as HTMLInputElement).value).toBe('0');

      // Submit button is enabled
      const submitBtn = screen.getByRole('button', { name: /ยืนยันเพิ่มผู้เช่า/ });
      expect((submitBtn as HTMLButtonElement).disabled).toBe(false);
    });
  });

  // ==========================================
  // Section 11: Controlled Other Fee & Decimal Meter Workspace
  // ==========================================
  describe('Controlled Other Fee & Decimal Meter Workspace Authority', () => {
    it('Controlled Other Fee input accepts numeric decimal strings and resets state on success', async () => {
      const httpSpy = vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url, data) => {
        if (url === '/billing-cycles') {
          return {
            data: [{ id: 'cycle-2026-08', cycleCode: '2026-08', status: 'open', isCurrent: true }],
            operationalCycleCode: '2026-08',
            firstBillingCycleId: 'cycle-2026-08',
          };
        }
        if (url.includes('/meters/workspace/preview-context')) {
          return {
            success: true,
            data: {
              rateSnapshot: {
                waterBillingType: 'per_unit',
                waterRate: '18.00',
                electricityBillingType: 'per_unit',
                electricityRate: '8.00',
              },
              rooms: [{ roomId: 'room-101-uuid', roomNumber: '101', rentAmount: '4500.00', billingSource: 'CONTRACT' }],
            },
          };
        }
        if (url === '/api/v1/meters/workspace/bulk') {
          return {
            success: true,
            savedCount: 1,
            savedRows: [{ roomId: 'room-101-uuid', version: 2, peopleCount: 1, manualOutstandingAmount: '0.00', otherFees: [{ description: 'คีย์การ์ด', amount: '50.50' }] }],
          };
        }
        return { success: true, data: [] };
      });

      renderWithClient(
        <OwnerMeters
          rooms={[mockRoom]}
          buildings={[mockBuilding]}
          dormitoryId="dorm-001-uuid"
          bills={[]}
          tenants={[]}
          contracts={[]}
          onSaveBills={() => {}}
          onSelectTenant={() => {}}
          onAddLog={() => {}}
          selectedBillingCycleId="cycle-2026-08"
          selectedCycleCode="2026-08"
        />
      );

      // Wait for table to render
      await waitFor(() => {
        expect(screen.getByText('101')).toBeDefined();
      });

      // Find the other fee inputs
      const descInput = screen.getByPlaceholderText('ชื่อรายการ') as HTMLInputElement;
      const amtInput = screen.getByPlaceholderText('บาท') as HTMLInputElement;

      // Type into controlled inputs
      fireEvent.change(descInput, { target: { value: 'คีย์การ์ด' } });
      expect(descInput.value).toBe('คีย์การ์ด');

      // Test sanitizer: reject letters and excess dots
      fireEvent.change(amtInput, { target: { value: 'abc50.50.9' } });
      expect(amtInput.value).toBe('50.50');

      // Click add other fee button
      const addFeeBtn = screen.getByTitle('เพิ่มรายการและบันทึกทันที');
      fireEvent.click(addFeeBtn);

      await waitFor(() => {
        expect(httpSpy).toHaveBeenCalledWith(
          'POST',
          '/api/v1/meters/workspace/bulk',
          expect.objectContaining({
            billingCycleId: 'cycle-2026-08',
            rows: [expect.objectContaining({ roomId: 'room-101-uuid', otherFees: [{ description: 'คีย์การ์ด', amount: '50.50' }] })],
          }),
          expect.any(Object)
        );
      });

      // Assert inputs are reset on success
      await waitFor(() => {
        expect(descInput.value).toBe('');
        expect(amtInput.value).toBe('');
      });
    });

    it('Quick Fill template generation fails closed with toast when household-counts fails', async () => {
      const httpSpy = vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url) => {
        if (url === '/billing-cycles') {
          return {
            data: [{ id: 'cycle-2026-08', cycleCode: '2026-08', status: 'open', isCurrent: true }],
            operationalCycleCode: '2026-08',
          };
        }
        if (url.includes('/meters/workspace/household-counts')) {
          throw new Error('Network error');
        }
        return { success: true, data: [] };
      });

      renderWithClient(
        <OwnerMeters
          rooms={[mockRoom]}
          buildings={[mockBuilding]}
          dormitoryId="dorm-001-uuid"
          bills={[]}
          tenants={[]}
          contracts={[]}
          onSaveBills={() => {}}
          onSelectTenant={() => {}}
          onAddLog={() => {}}
          selectedBillingCycleId="cycle-2026-08"
          selectedCycleCode="2026-08"
        />
      );

      // Wait for table to render
      await waitFor(() => {
        expect(screen.getByText('101')).toBeDefined();
      });

      // Open Quick Fill modal
      const quickFillBtn = screen.getAllByRole('button', { name: /กรอกแบบรวดเร็ว/ })[0];
      fireEvent.click(quickFillBtn);

      await waitFor(() => {
        expect(screen.getByText('กรอกข้อมูลด่วน (Quick Fill)')).toBeDefined();
      });

      // Click "ใช้แม่แบบ"
      const useTemplateBtn = screen.getByRole('button', { name: /ใช้แม่แบบ/ });
      fireEvent.click(useTemplateBtn);

      // Verify fail-closed error toast and template text area remains empty
      await waitFor(() => {
        expect(screen.getByText('ไม่สามารถดึงจำนวนคนปัจจุบันได้ กรุณาลองอีกครั้ง')).toBeDefined();
      });

      const textarea = screen.getByPlaceholderText('วางข้อมูลหลายห้องที่นี่ . . .') as HTMLTextAreaElement;
      expect(textarea.value).toBe('');
    });

    it('CASE A: Immediate Other Fee persistence establishes clean baseline without global Save button', async () => {
      let currentSnapshots: any[] = [];
      const httpSpy = vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url, data) => {
        if (url === '/billing-cycles') {
          return {
            data: [{ id: 'cycle-2026-08', cycleCode: '2026-08', status: 'open', isCurrent: true }],
            operationalCycleCode: '2026-08',
            firstBillingCycleId: 'cycle-2026-08',
          };
        }
        if (url.includes('/meters/workspace/preview-context')) {
          return {
            success: true,
            data: {
              rateSnapshot: {
                waterBillingType: 'per_unit',
                waterRate: '18.00',
                electricityBillingType: 'per_unit',
                electricityRate: '8.00',
              },
              rooms: [{ roomId: 'room-101-uuid', roomNumber: '101', rentAmount: '4500.00', billingSource: 'CONTRACT' }],
            },
          };
        }
        if (url.includes('/meters/cycle-people-count')) {
          return {
            success: true,
            data: currentSnapshots,
          };
        }
        if (url === '/api/v1/meters/workspace/bulk') {
          const rowData = (data as any)?.rows?.[0];
          currentSnapshots = [{
            roomId: 'room-101-uuid',
            version: 2,
            peopleCount: 1,
            manualOutstandingAmount: '0.00',
            otherFees: rowData?.otherFees || [{ description: 'คีย์การ์ด', amount: '50.50' }],
          }];
          return {
            success: true,
            savedCount: 1,
            savedRows: [{ roomId: 'room-101-uuid', version: 2, peopleCount: 1, manualOutstandingAmount: '0.00', otherFees: rowData?.otherFees || [{ description: 'คีย์การ์ด', amount: '50.50' }] }],
          };
        }
        return { success: true, data: [] };
      });

      renderWithClient(
        <OwnerMeters
          rooms={[mockRoom]}
          buildings={[mockBuilding]}
          dormitoryId="dorm-001-uuid"
          bills={[]}
          tenants={[]}
          contracts={[]}
          onSaveBills={() => {}}
          onSelectTenant={() => {}}
          onAddLog={() => {}}
          selectedBillingCycleId="cycle-2026-08"
          selectedCycleCode="2026-08"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('101')).toBeDefined();
      });

      // Add an other fee
      const descInput = screen.getByPlaceholderText('ชื่อรายการ') as HTMLInputElement;
      const amtInput = screen.getByPlaceholderText('บาท') as HTMLInputElement;

      fireEvent.change(descInput, { target: { value: 'คีย์การ์ด' } });
      fireEvent.change(amtInput, { target: { value: '50.50' } });

      const addFeeBtn = screen.getByTitle('เพิ่มรายการและบันทึกทันที');
      fireEvent.click(addFeeBtn);

      // Verify fee added, inputs cleared, and global Save button disappears once mutation resolves
      await waitFor(() => {
        expect(screen.getByText('คีย์การ์ด')).toBeDefined();
        expect(descInput.value).toBe('');
        expect(amtInput.value).toBe('');
        expect(screen.queryByRole('button', { name: /บันทึกข้อมูล/ })).toBeNull();
      });
    });

    it('CASE B: Unrelated unsaved meter edit remains dirty after Other Fee is persisted', async () => {
      let currentSnapshots: any[] = [];
      const httpSpy = vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url, data) => {
        if (url === '/billing-cycles') {
          return {
            data: [{ id: 'cycle-2026-08', cycleCode: '2026-08', status: 'open', isCurrent: true }],
            operationalCycleCode: '2026-08',
            firstBillingCycleId: 'cycle-2026-08',
          };
        }
        if (url.includes('/meters/workspace/preview-context')) {
          return {
            success: true,
            data: {
              rateSnapshot: {
                waterBillingType: 'per_unit',
                waterRate: '18.00',
                electricityBillingType: 'per_unit',
                electricityRate: '8.00',
              },
              rooms: [{ roomId: 'room-101-uuid', roomNumber: '101', rentAmount: '4500.00', billingSource: 'CONTRACT' }],
            },
          };
        }
        if (url.includes('/meters/cycle-people-count')) {
          return {
            success: true,
            data: currentSnapshots,
          };
        }
        if (url === '/api/v1/meters/workspace/bulk') {
          const rowData = (data as any)?.rows?.[0];
          currentSnapshots = [{
            roomId: 'room-101-uuid',
            version: 2,
            peopleCount: 1,
            manualOutstandingAmount: '0.00',
            otherFees: rowData?.otherFees || [{ description: 'คีย์การ์ด', amount: '50.50' }],
          }];
          return {
            success: true,
            savedCount: 1,
            savedRows: [{ roomId: 'room-101-uuid', version: 2, peopleCount: 1, manualOutstandingAmount: '0.00', otherFees: rowData?.otherFees || [{ description: 'คีย์การ์ด', amount: '50.50' }] }],
          };
        }
        return { success: true, data: [] };
      });

      renderWithClient(
        <OwnerMeters
          rooms={[mockRoom]}
          buildings={[mockBuilding]}
          dormitoryId="dorm-001-uuid"
          bills={[]}
          tenants={[]}
          contracts={[]}
          onSaveBills={() => {}}
          onSelectTenant={() => {}}
          onAddLog={() => {}}
          selectedBillingCycleId="cycle-2026-08"
          selectedCycleCode="2026-08"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('101')).toBeDefined();
      });

      // 1. Make an unrelated unsaved meter edit (waterCurr)
      const waterCurrInput = document.querySelector('input[data-col="waterCurr"]') as HTMLInputElement;
      expect(waterCurrInput).toBeDefined();
      fireEvent.change(waterCurrInput, { target: { value: '10.5' } });

      // Global Save button is now visible
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /บันทึกข้อมูล/ })).toBeDefined();
      });

      // 2. Add Other Fee immediately
      const descInput = screen.getByPlaceholderText('ชื่อรายการ') as HTMLInputElement;
      const amtInput = screen.getByPlaceholderText('บาท') as HTMLInputElement;
      fireEvent.change(descInput, { target: { value: 'คีย์การ์ด' } });
      fireEvent.change(amtInput, { target: { value: '50.50' } });

      const addFeeBtn = screen.getByTitle('เพิ่มรายการและบันทึกทันที');
      fireEvent.click(addFeeBtn);

      await waitFor(() => {
        expect(screen.getByText('คีย์การ์ด')).toBeDefined();
      });

      // Global Save button REMAINS visible solely because waterCurr is still unsaved/dirty
      expect(screen.getByRole('button', { name: /บันทึกข้อมูล/ })).toBeDefined();
    });

    it('CASE C: Removing persisted Other Fee establishes clean baseline without global Save button', async () => {
      let currentSnapshots: any[] = [
        {
          roomId: 'room-101-uuid',
          version: 1,
          peopleCount: 1,
          manualOutstandingAmount: '0.00',
          otherFees: [{ description: 'ค่าที่จอดรถพิเศษ', amount: '100.00' }],
        },
      ];

      const httpSpy = vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url, data) => {
        if (url === '/billing-cycles') {
          return {
            data: [{ id: 'cycle-2026-08', cycleCode: '2026-08', status: 'open', isCurrent: true }],
            operationalCycleCode: '2026-08',
            firstBillingCycleId: 'cycle-2026-08',
          };
        }
        if (url.includes('/meters/workspace/preview-context')) {
          return {
            success: true,
            data: {
              rateSnapshot: {
                waterBillingType: 'per_unit',
                waterRate: '18.00',
                electricityBillingType: 'per_unit',
                electricityRate: '8.00',
              },
              rooms: [{ roomId: 'room-101-uuid', roomNumber: '101', rentAmount: '4500.00', billingSource: 'CONTRACT' }],
            },
          };
        }
        if (url.includes('/meters/cycle-people-count')) {
          return {
            success: true,
            data: currentSnapshots,
          };
        }
        if (url === '/api/v1/meters/workspace/bulk') {
          const rowData = (data as any)?.rows?.[0];
          currentSnapshots = [{
            roomId: 'room-101-uuid',
            version: 2,
            peopleCount: 1,
            manualOutstandingAmount: '0.00',
            otherFees: rowData?.otherFees || [],
          }];
          return {
            success: true,
            savedCount: 1,
            savedRows: [{ roomId: 'room-101-uuid', version: 2, peopleCount: 1, manualOutstandingAmount: '0.00', otherFees: rowData?.otherFees || [] }],
          };
        }
        return { success: true, data: [] };
      });

      renderWithClient(
        <OwnerMeters
          rooms={[mockRoom]}
          buildings={[mockBuilding]}
          dormitoryId="dorm-001-uuid"
          bills={[]}
          tenants={[]}
          contracts={[]}
          onSaveBills={() => {}}
          onSelectTenant={() => {}}
          onAddLog={() => {}}
          selectedBillingCycleId="cycle-2026-08"
          selectedCycleCode="2026-08"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('ค่าที่จอดรถพิเศษ')).toBeDefined();
      });

      // Click remove Other Fee
      const removeBtn = screen.getByTitle('ลบและบันทึกทันที');
      fireEvent.click(removeBtn);

      // Verify fee is removed
      await waitFor(() => {
        expect(screen.queryByText('ค่าที่จอดรถพิเศษ')).toBeNull();
      });

      // Global Save button must NOT appear
      expect(screen.queryByRole('button', { name: /บันทึกข้อมูล/ })).toBeNull();
    });
  });

  it('Meter Cached Remount: renders room rows on first paint without empty-room flash and requires no fresh fetch', async () => {
    const client = createTestQueryClient();

    // Pre-seed cached data in QueryClient
    client.setQueryData(queryKeys.meterWorkspace('dorm-001-uuid', 'cycle-2026-08'), {
      serverReadings: [{ roomId: 'room-101-uuid', meterType: 'water', previousReading: '100.00', currentReading: '105.00' }],
      cyclePeopleRes: { success: true, data: [{ roomId: 'room-101-uuid', peopleCount: 2, version: 1, manualOutstandingAmount: '0.00', otherFees: [] }] },
      cyclesRes: {
        data: [{ id: 'cycle-2026-08', cycleCode: '2026-08', status: 'open', isCurrent: true }],
        firstBillingCycleId: 'cycle-2026-08',
        operationalCycleCode: '2026-08',
      },
    });

    const httpSpy = vi.spyOn(httpClient, 'httpRequest');

    // Mount OwnerMeters with the seeded QueryClient
    const { unmount } = render(
      <QueryClientProvider client={client}>
        <OwnerMeters
          rooms={[mockRoom]}
          buildings={[mockBuilding]}
          dormitoryId="dorm-001-uuid"
          bills={[]}
          tenants={[]}
          contracts={[]}
          onSaveBills={() => {}}
          onSelectTenant={() => {}}
          onAddLog={() => {}}
          selectedBillingCycleId="cycle-2026-08"
          selectedCycleCode="2026-08"
        />
      </QueryClientProvider>
    );

    // Verify room row 101 is immediately present on synchronous first paint
    expect(screen.getByText('101')).toBeDefined();
    expect(screen.queryByText('ไม่พบข้อมูลห้องพักพักอาศัยที่ต้องการ')).toBeNull();

    // Simulate tab switch: unmount Meter
    unmount();

    // Remount Meter with the SAME QueryClient
    render(
      <QueryClientProvider client={client}>
        <OwnerMeters
          rooms={[mockRoom]}
          buildings={[mockBuilding]}
          dormitoryId="dorm-001-uuid"
          bills={[]}
          tenants={[]}
          contracts={[]}
          onSaveBills={() => {}}
          onSelectTenant={() => {}}
          onAddLog={() => {}}
          selectedBillingCycleId="cycle-2026-08"
          selectedCycleCode="2026-08"
        />
      </QueryClientProvider>
    );

    // On first synchronous paint of remount, room 101 is immediately present
    expect(screen.getByText('101')).toBeDefined();
    expect(screen.queryByText('ไม่พบข้อมูลห้องพักพักอาศัยที่ต้องการ')).toBeNull();

    // Verify no fresh network calls were made for meter workspace
    expect(httpSpy).not.toHaveBeenCalledWith('GET', '/billing-cycles', expect.anything(), expect.anything());
  });
});

// ==========================================
// Section 12: Production Client Fractional Calculator Direct Proof
// ==========================================
describe('Production Client Fractional Calculator Direct Proof', () => {
  it('verifies exact 2-decimal fractional calculations on client calculator without floating drift', () => {
    const preview = calculateMeterRowPreview(
      { roomId: 'room-101-uuid', rentAmount: '3500.00', billingSource: 'CONTRACT' },
      {
        waterBillingType: 'per_unit',
        waterRate: '18.00',
        electricityBillingType: 'per_unit',
        electricityRate: '8.00',
      },
      {
        waterPrev: '100.25',
        waterCurr: '105.75',
        elecPrev: '500.10',
        elecCurr: '501.35',
        peopleCount: 1,
        overdueAmount: '0.00',
        otherFees: [],
      }
    );

    expect(preview.rentAmount).toBe('3500.00');
    expect(preview.waterUsage).toBe('5.50');
    expect(preview.waterAmount).toBe('99.00');
    expect(preview.elecUsage).toBe('1.25');
    expect(preview.elecAmount).toBe('10.00');
    expect(preview.totalAmount).toBe('3609.00');
    expect(preview.formattedTotal).toBe('3,609.00');
  });
});
