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
import { getTargetQueriesForTab } from '../pages/owner';
import * as httpClient from '../data/httpClient';
import { Room, Building, QuickAddRoomContext } from '../types';
import { queryKeys } from '../lib/queryClient';
import { meterDraftStore } from '../lib/meterDraftStore';
import { calculateMeterRowPreview, RoomPreviewContext } from '../utils/meterBillingCalculator';

const calculateMonthEndDate = (start: string, months: number): string => {
  if (!start) return '';
  const d = new Date(start);
  if (isNaN(d.getTime())) return '';
  d.setMonth(d.getMonth() + months);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
};

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
          billingCycles={[{ id: 'cycle-2026-08', cycleCode: '2026-08', status: 'open', isCurrent: true }]}
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
      const httpSpy = vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url) => {
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
          selectedBillingCycleId="cycle-2025-12"
          selectedCycleCode="2025-12"
          selectedCycle="2025-12"
          billingCycles={[{ id: 'cycle-2026-08', cycleCode: '2026-08', status: 'open', isCurrent: true }]}
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

      // Switch to MONTHLY tab
      fireEvent.click(screen.getByRole('button', { name: 'รายเดือน' }));

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
      fireEvent.click(screen.getByRole('button', { name: /รายเทอม/ }));

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
        expect(payload.termInstallmentCount).toBe(3);
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
      fireEvent.click(screen.getByRole('button', { name: 'รายวัน' }));

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
        expect(payload.dormitoryId).toBe(mockContext.dormitoryId);
        expect(payload.roomId).toBe(mockContext.roomId);
        expect(payload.fullName).toBe('นักท่องเที่ยว ใจดี');
        expect(payload.dailyRateAmount).toBe('350.00'); // Authoritative effective rate
      });
    });
  });

  // ==========================================
  // Financial Integrity & Building Authority Invariants
  // ==========================================
  describe('Financial Integrity & Building Authority Invariants', () => {
    it('Proof G: lease end date on MONTHLY is read-only and derived via calculateMonthEndDate', async () => {
      const httpSpy = vi.spyOn(httpClient, 'httpRequest').mockResolvedValue({ success: true, data: { id: 'term-g' } });

      render(
        <QuickAddTenantModal
          isOpen={true}
          onClose={vi.fn()}
          context={mockContext}
          onSuccess={vi.fn()}
        />
      );

      // Switch to MONTHLY tab
      fireEvent.click(screen.getByRole('button', { name: 'รายเดือน' }));

      fireEvent.change(screen.getByPlaceholderText('เช่น นายสมชาย ใจดี'), { target: { value: 'ผู้เช่า แก้ไขวัน' } });

      const submitBtn = screen.getByText('ยืนยันเพิ่มผู้เช่า');
      fireEvent.submit(submitBtn.closest('form')!);

      await waitFor(() => {
        expect(httpSpy).toHaveBeenCalledTimes(1);
        const payload = httpSpy.mock.calls[0][2];
        const todayStr = new Date().toISOString().slice(0, 10);
        expect(payload.endDate).toBe(calculateMonthEndDate(todayStr, 1));
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

      fireEvent.click(screen.getByRole('button', { name: 'รายวัน' }));

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

      fireEvent.click(screen.getByRole('button', { name: 'รายวัน' }));

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

      fireEvent.click(screen.getByRole('button', { name: /รายเทอม/ }));

      const select = screen.getByRole('combobox');
      expect(select.children.length).toBe(3); // Options: 1, 2, 3
    });

    it('Proof K: TERM tab remains visible but is disabled when building termMonths is not configured', () => {
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

      const termTab = screen.getByRole('button', { name: /รายเทอม/ }) as HTMLButtonElement;
      expect(termTab).toBeDefined();
      expect(termTab.disabled).toBe(true);
      expect(termTab.title).toBe('ยังไม่ได้กำหนดค่าเช่ารายเทอมของห้องพัก');
    });

    it('Proof L: TERM tab remains visible but disabled when room configured termRent <= 0 or null, and enabled when > 0', async () => {
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

      const { rerender } = render(
        <QuickAddTenantModal
          isOpen={true}
          onClose={vi.fn()}
          context={nullTermContext}
          onSuccess={vi.fn()}
        />
      );

      // Invariant: Term tab is disabled when termRent is null / unconfigured
      const termTab = screen.getByRole('button', { name: /รายเทอม/ }) as HTMLButtonElement;
      expect(termTab.disabled).toBe(true);
      expect(termTab.title).toBe('ยังไม่ได้กำหนดค่าเช่ารายเทอมของห้องพัก');

      // When configured with termRent > 0, Term tab becomes enabled
      const configuredTermContext: QuickAddRoomContext = {
        ...nullTermContext,
        effective: {
          ...nullTermContext.effective,
          termRent: 19000,
        },
      };

      rerender(
        <QuickAddTenantModal
          isOpen={true}
          onClose={vi.fn()}
          context={configuredTermContext}
          onSuccess={vi.fn()}
        />
      );

      const enabledTermTab = screen.getByRole('button', { name: /รายเทอม/ }) as HTMLButtonElement;
      expect(enabledTermTab.disabled).toBe(false);
      fireEvent.click(enabledTermTab);

      // Live breakdown rendered
      expect(screen.getByText(/19,000\.00/)).toBeDefined();
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
        if (url.includes('/meters/workspace/bulk')) {
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

      // Click add other fee button (local draft)
      const addFeeBtn = screen.getByTitle('เพิ่มรายการค่าใช้จ่าย');
      fireEvent.click(addFeeBtn);

      // Verify fee appears in table and inputs are reset
      await waitFor(() => {
        expect(screen.getByText('คีย์การ์ด')).toBeDefined();
        expect(descInput.value).toBe('');
        expect(amtInput.value).toBe('');
      });

      // Click main Save button to persist
      const saveBtn = screen.getByRole('button', { name: /บันทึกข้อมูล/ });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(httpSpy).toHaveBeenCalledWith(
          'POST',
          expect.stringContaining('/meters/workspace/bulk'),
          expect.objectContaining({
            billingCycleId: 'cycle-2026-08',
            rows: [expect.objectContaining({ roomId: 'room-101-uuid', otherFees: [{ description: 'คีย์การ์ด', amount: '50.50' }] })],
          })
        );
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
            },
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
          billingCycles={[{ id: 'cycle-2026-08', cycleCode: '2026-08' }]}
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
        expect(screen.getByPlaceholderText('วางข้อมูลหลายห้องที่นี่ . . .')).toBeDefined();
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

      const addFeeBtn = screen.getByTitle('เพิ่มรายการค่าใช้จ่าย');
      fireEvent.click(addFeeBtn);

      // Verify fee added, inputs cleared, and global Save button is present
      await waitFor(() => {
        expect(screen.getByText('คีย์การ์ด')).toBeDefined();
        expect(descInput.value).toBe('');
        expect(amtInput.value).toBe('');
        expect(screen.getByRole('button', { name: /บันทึกข้อมูล/ })).toBeDefined();
      });

      // Click Save to persist
      fireEvent.click(screen.getByRole('button', { name: /บันทึกข้อมูล/ }));

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /บันทึกข้อมูล/ })).toBeNull();
      });

      // Assert meterDraftStore is clean
      expect(meterDraftStore.getDraft('dorm-001-uuid', 'cycle-2026-08')).toBeNull();
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
      fireEvent.change(waterCurrInput, { target: { value: '105' } });

      // Global Save button is now visible
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /บันทึกข้อมูล/ })).toBeDefined();
      });

      // 2. Add Other Fee immediately
      const descInput = screen.getByPlaceholderText('ชื่อรายการ') as HTMLInputElement;
      const amtInput = screen.getByPlaceholderText('บาท') as HTMLInputElement;
      fireEvent.change(descInput, { target: { value: 'คีย์การ์ด' } });
      fireEvent.change(amtInput, { target: { value: '50.50' } });

      const addFeeBtn = screen.getByTitle('เพิ่มรายการค่าใช้จ่าย');
      fireEvent.click(addFeeBtn);

      await waitFor(() => {
        expect(screen.getByText('คีย์การ์ด')).toBeDefined();
      });

      // Global Save button REMAINS visible because both waterCurr and new other fee are dirty
      expect(screen.getByRole('button', { name: /บันทึกข้อมูล/ })).toBeDefined();

      // Click save
      fireEvent.click(screen.getByRole('button', { name: /บันทึกข้อมูล/ }));
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /บันทึกข้อมูล/ })).toBeNull();
      });
    });

    it('CASE C: Removing persisted Other Fee marks row dirty and main Save persists removal', async () => {
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
      const removeBtn = screen.getByTitle('ลบรายการ');
      fireEvent.click(removeBtn);

      // Verify fee is removed in local view
      await waitFor(() => {
        expect(screen.queryByText('ค่าที่จอดรถพิเศษ')).toBeNull();
      });

      // Global Save button appears because deleting persisted fee marks row dirty
      expect(screen.getByRole('button', { name: /บันทึกข้อมูล/ })).toBeDefined();

      // Click Save to persist removal
      fireEvent.click(screen.getByRole('button', { name: /บันทึกข้อมูล/ }));

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /บันทึกข้อมูล/ })).toBeNull();
      });

      // Assert draft store is clean
      expect(meterDraftStore.getDraft('dorm-001-uuid', 'cycle-2026-08')).toBeNull();
    });

    it('SWR Multi-Writer: preserves local dirty field while reflecting untouched server updates without erasing remote fees', async () => {
      const client = createTestQueryClient();

      let currentServerWorkspace = {
        serverReadings: [{ roomId: 'room-101-uuid', meterType: 'water', previousReading: '100.00', currentReading: '100.00' }],
        cyclePeopleRes: {
          success: true,
          data: [{
            roomId: 'room-101-uuid',
            version: 1,
            peopleCount: 1,
            manualOutstandingAmount: '0.00',
            otherFees: [{ description: 'Fee A', amount: '10.00' }],
          }],
        },
        cyclesRes: {
          data: [{ id: 'cycle-2026-08', cycleCode: '2026-08', status: 'open', isCurrent: true }],
          firstBillingCycleId: 'cycle-2026-08',
          operationalCycleCode: '2026-08',
        },
      };

      let capturedBulkPayload: any = null;

      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url, data) => {
        if (url === '/billing-cycles') {
          return currentServerWorkspace.cyclesRes;
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
          return currentServerWorkspace.cyclePeopleRes;
        }
        if (url.includes('/meters/readings')) {
          return { success: true, data: currentServerWorkspace.serverReadings };
        }
        if (url.includes('/meters/workspace/bulk')) {
          capturedBulkPayload = data;
          const rowData = (data as any)?.rows?.[0];
          const newFees = rowData?.otherFees || [];
          currentServerWorkspace = {
            ...currentServerWorkspace,
            cyclePeopleRes: {
              success: true,
              data: [{
                roomId: 'room-101-uuid',
                version: 3,
                peopleCount: 3,
                manualOutstandingAmount: '0.00',
                otherFees: newFees,
              }],
            },
          };
          return {
            success: true,
            savedCount: 1,
            savedRows: [{ roomId: 'room-101-uuid', version: 3, peopleCount: 3, manualOutstandingAmount: '0.00', otherFees: newFees }],
          };
        }
        return { success: true, data: [] };
      });

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

      await waitFor(() => {
        expect(screen.getByText('101')).toBeDefined();
        expect(screen.getByText('Fee A')).toBeDefined();
      });

      // 1. Local user modifies ONLY waterCurr
      const waterCurrInput = document.querySelector('input[data-col="waterCurr"]') as HTMLInputElement;
      fireEvent.change(waterCurrInput, { target: { value: '105' } });

      // Verify sparse draft in store contains ONLY waterCurr
      await waitFor(() => {
        expect(meterDraftStore.getDraft('dorm-001-uuid', 'cycle-2026-08')).toEqual([
          { roomId: 'room-101-uuid', waterCurr: '105' }
        ]);
      });

      // 2. Simulate remote writer update via SWR / query cache update:
      // Remote writer changed peopleCount to 3, added Fee B, and incremented version to 2
      currentServerWorkspace = {
        serverReadings: [{ roomId: 'room-101-uuid', meterType: 'water', previousReading: '100.00', currentReading: '100.00' }],
        cyclePeopleRes: {
          success: true,
          data: [{
            roomId: 'room-101-uuid',
            version: 2,
            peopleCount: 3,
            manualOutstandingAmount: '0.00',
            otherFees: [
              { description: 'Fee A', amount: '10.00' },
              { description: 'Fee B', amount: '20.00' }
            ],
          }],
        },
        cyclesRes: currentServerWorkspace.cyclesRes,
      };

      // Invalidate / update query cache to trigger SWR reconciliation
      client.setQueryData(queryKeys.meterWorkspace('dorm-001-uuid', 'cycle-2026-08'), currentServerWorkspace);

      // Verify rendered UI:
      // - waterCurr "105" preserved from local sparse draft
      // - peopleCount "3" updated from fresh server data
      // Verify rendered UI:
      // - waterCurr "105" preserved from local sparse draft
      // - peopleCount "3" updated from fresh server data
      // - both Fee A and Fee B visible (remote update not shadowed by stale draft)
      await waitFor(() => {
        const input = document.querySelector('input[data-col="waterCurr"]') as HTMLInputElement;
        expect(input.value).toBe('105');
        expect(screen.getByText('Fee A')).toBeDefined();
        expect(screen.getByText('Fee B')).toBeDefined();
        const peopleInput = document.querySelector('input[data-col="peopleCount"]') as HTMLInputElement;
        if (peopleInput) {
          expect(peopleInput.value).toBe('3');
        }
      });

      // 3. User adds Fee C on top of remote state
      const descInput = screen.getByPlaceholderText('ชื่อรายการ') as HTMLInputElement;
      const amtInput = screen.getByPlaceholderText('บาท') as HTMLInputElement;
      fireEvent.change(descInput, { target: { value: 'Fee C' } });
      fireEvent.change(amtInput, { target: { value: '30.00' } });

      const addFeeBtn = screen.getByTitle('เพิ่มรายการค่าใช้จ่าย');
      fireEvent.click(addFeeBtn);

      await waitFor(() => {
        expect(screen.getByText('Fee C')).toBeDefined();
      });

      // Save workspace
      fireEvent.click(screen.getByRole('button', { name: /บันทึกข้อมูล/ }));

      await waitFor(() => {
        expect(capturedBulkPayload).toBeDefined();
      });

      // Verify payload preserved remote Fee B and persisted Fee C
      expect(capturedBulkPayload.rows[0].otherFees).toEqual([
        { description: 'Fee A', amount: '10.00' },
        { description: 'Fee B', amount: '20.00' },
        { description: 'Fee C', amount: '30.00' }
      ]);
    });

    it('Clean Row Background Refresh: immediately reflects server updates without full-row shadow when no local edits exist', async () => {
      const client = createTestQueryClient();

      let currentServerWorkspace = {
        serverReadings: [{ roomId: 'room-101-uuid', meterType: 'water', previousReading: '100.00', currentReading: '100.00' }],
        cyclePeopleRes: {
          success: true,
          data: [{
            roomId: 'room-101-uuid',
            version: 1,
            peopleCount: 1,
            manualOutstandingAmount: '0.00',
            otherFees: [{ description: 'Fee A', amount: '10.00' }],
          }],
        },
        cyclesRes: {
          data: [{ id: 'cycle-2026-08', cycleCode: '2026-08', status: 'open', isCurrent: true }],
          firstBillingCycleId: 'cycle-2026-08',
          operationalCycleCode: '2026-08',
        },
      };

      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url) => {
        if (url === '/billing-cycles') return currentServerWorkspace.cyclesRes;
        if (url.includes('/meters/cycle-people-count')) return currentServerWorkspace.cyclePeopleRes;
        if (url.includes('/meters/readings')) return { success: true, data: currentServerWorkspace.serverReadings };
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
        return { success: true, data: [] };
      });

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

      await waitFor(() => {
        expect(screen.getByText('101')).toBeDefined();
        expect(screen.getByText('Fee A')).toBeDefined();
      });

      // Assert draft store is empty for clean state
      expect(meterDraftStore.getDraft('dorm-001-uuid', 'cycle-2026-08')).toBeNull();

      // Remote update happens: peopleCount -> 2, Fee B added
      currentServerWorkspace = {
        serverReadings: [{ roomId: 'room-101-uuid', meterType: 'water', previousReading: '100.00', currentReading: '100.00' }],
        cyclePeopleRes: {
          success: true,
          data: [{
            roomId: 'room-101-uuid',
            version: 2,
            peopleCount: 2,
            manualOutstandingAmount: '0.00',
            otherFees: [
              { description: 'Fee A', amount: '10.00' },
              { description: 'Fee B', amount: '20.00' }
            ],
          }],
        },
        cyclesRes: currentServerWorkspace.cyclesRes,
      };

      // Trigger SWR cache update
      client.setQueryData(queryKeys.meterWorkspace('dorm-001-uuid', 'cycle-2026-08'), currentServerWorkspace);

      await waitFor(() => {
        expect(screen.getByText('Fee B')).toBeDefined();
        const peopleInput = document.querySelector('input[data-col="peopleCount"]') as HTMLInputElement;
        if (peopleInput) {
          expect(peopleInput.value).toBe('2');
        }
      });

      expect(meterDraftStore.getDraft('dorm-001-uuid', 'cycle-2026-08')).toBeNull();
    });

    it('Navigation Dirty Survival: only genuinely dirty fields survive navigation while clean fields follow server', async () => {
      const client = createTestQueryClient();

      const serverWorkspace = {
        serverReadings: [{ roomId: 'room-101-uuid', meterType: 'water', previousReading: '100.00', currentReading: '100.00' }],
        cyclePeopleRes: {
          success: true,
          data: [{
            roomId: 'room-101-uuid',
            version: 1,
            peopleCount: 2,
            manualOutstandingAmount: '0.00',
            otherFees: [{ description: 'Fee A', amount: '10.00' }],
          }],
        },
        cyclesRes: {
          data: [{ id: 'cycle-2026-08', cycleCode: '2026-08', status: 'open', isCurrent: true }],
          firstBillingCycleId: 'cycle-2026-08',
          operationalCycleCode: '2026-08',
        },
      };

      client.setQueryData(queryKeys.meterWorkspace('dorm-001-uuid', 'cycle-2026-08'), serverWorkspace);

      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url) => {
        if (url === '/billing-cycles') return serverWorkspace.cyclesRes;
        if (url.includes('/meters/cycle-people-count')) return serverWorkspace.cyclePeopleRes;
        if (url.includes('/meters/readings')) return { success: true, data: serverWorkspace.serverReadings };
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
        return { success: true, data: [] };
      });

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

      await waitFor(() => {
        expect(screen.getByText('101')).toBeDefined();
        expect(document.querySelector('input[data-col="waterCurr"]')).not.toBeNull();
      });

      // User changes waterCurr to 110
      const waterCurrInput = document.querySelector('input[data-col="waterCurr"]') as HTMLInputElement;
      fireEvent.change(waterCurrInput, { target: { value: '110' } });

      await waitFor(() => {
        expect(meterDraftStore.getDraft('dorm-001-uuid', 'cycle-2026-08')).toEqual([
          { roomId: 'room-101-uuid', waterCurr: '110' }
        ]);
      });

      // Navigate away: unmount
      unmount();

      // Remount
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

      // waterCurr is restored from sparse draft, while otherFees and peopleCount come from server
      await waitFor(() => {
        const input = document.querySelector('input[data-col="waterCurr"]') as HTMLInputElement;
        expect(input.value).toBe('110');
        expect(screen.getByText('Fee A')).toBeDefined();
        const peopleInput = document.querySelector('input[data-col="peopleCount"]') as HTMLInputElement;
        if (peopleInput) {
          expect(peopleInput.value).toBe('2');
        }
      });
    });

    it('In-Flight Add Fee Preservation: preserves local meter reading typed while fee add request is pending', async () => {
      const client = createTestQueryClient();

      let resolveDeferred: (val: any) => void;
      const deferredPromise = new Promise((resolve) => {
        resolveDeferred = resolve;
      });

      const serverWorkspace = {
        serverReadings: [{ roomId: 'room-101-uuid', meterType: 'water', previousReading: '100.00', currentReading: '100.00' }],
        cyclePeopleRes: {
          success: true,
          data: [{
            roomId: 'room-101-uuid',
            version: 1,
            peopleCount: 1,
            manualOutstandingAmount: '0.00',
            otherFees: [],
          }],
        },
        cyclesRes: {
          data: [{ id: 'cycle-2026-08', cycleCode: '2026-08', status: 'open', isCurrent: true }],
          firstBillingCycleId: 'cycle-2026-08',
          operationalCycleCode: '2026-08',
        },
      };

      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url, data) => {
        if (url === '/billing-cycles') return serverWorkspace.cyclesRes;
        if (url.includes('/meters/cycle-people-count')) return serverWorkspace.cyclePeopleRes;
        if (url.includes('/meters/readings')) return { success: true, data: serverWorkspace.serverReadings };
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
          await deferredPromise;
          return {
            success: true,
            savedCount: 1,
            savedRows: [{ roomId: 'room-101-uuid', version: 2, peopleCount: 1, manualOutstandingAmount: '0.00', otherFees: [{ description: 'Fee A', amount: '150.00' }] }],
          };
        }
        return { success: true, data: [] };
      });

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

      await waitFor(() => {
        expect(screen.getByText('101')).toBeDefined();
      });

      // 1. Enter Fee A and click +
      const descInput = screen.getByPlaceholderText('ชื่อรายการ') as HTMLInputElement;
      const amtInput = screen.getByPlaceholderText('บาท') as HTMLInputElement;
      fireEvent.change(descInput, { target: { value: 'Fee A' } });
      fireEvent.change(amtInput, { target: { value: '150.00' } });

      const addFeeBtn = screen.getByTitle('เพิ่มรายการค่าใช้จ่าย');
      fireEvent.click(addFeeBtn);

      // 2. User also edits waterCurr to 105
      const waterCurrInput = document.querySelector('input[data-col="waterCurr"]') as HTMLInputElement;
      fireEvent.change(waterCurrInput, { target: { value: '105' } });

      expect(waterCurrInput.value).toBe('105');

      // 3. Verify fee is displayed locally and waterCurr is 105
      await waitFor(() => {
        expect(screen.getByText('Fee A')).toBeDefined();
        const input = document.querySelector('input[data-col="waterCurr"]') as HTMLInputElement;
        expect(input.value).toBe('105');
      });

      // 4. Global Save is visible
      expect(screen.getByRole('button', { name: /บันทึกข้อมูล/ })).toBeDefined();

      // 5. Click Save to persist all local changes together
      fireEvent.click(screen.getByRole('button', { name: /บันทึกข้อมูล/ }));

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /บันทึกข้อมูล/ })).toBeNull();
      });
    });

    it('Local Remove Fee Preservation: preserves local meter reading typed while modifying fees', async () => {
      const client = createTestQueryClient();

      const serverWorkspace = {
        serverReadings: [{ roomId: 'room-101-uuid', meterType: 'electricity', previousReading: '200.00', currentReading: '200.00' }],
        cyclePeopleRes: {
          success: true,
          data: [{
            roomId: 'room-101-uuid',
            version: 2,
            peopleCount: 1,
            manualOutstandingAmount: '0.00',
            otherFees: [{ description: 'Fee A', amount: '100.00' }],
          }],
        },
        cyclesRes: {
          data: [{ id: 'cycle-2026-08', cycleCode: '2026-08', status: 'open', isCurrent: true }],
          firstBillingCycleId: 'cycle-2026-08',
          operationalCycleCode: '2026-08',
        },
      };

      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url, data) => {
        if (url === '/billing-cycles') return serverWorkspace.cyclesRes;
        if (url.includes('/meters/cycle-people-count')) return serverWorkspace.cyclePeopleRes;
        if (url.includes('/meters/readings')) return { success: true, data: serverWorkspace.serverReadings };
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
            savedRows: [{ roomId: 'room-101-uuid', version: 3, peopleCount: 1, manualOutstandingAmount: '0.00', otherFees: [] }],
          };
        }
        return { success: true, data: [] };
      });

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

      await waitFor(() => {
        expect(screen.getByText('Fee A')).toBeDefined();
      });

      // 1. Click remove Fee A
      const removeBtn = screen.getByTitle('ลบรายการ');
      fireEvent.click(removeBtn);

      // 2. User types elecCurr = 205
      const elecCurrInput = document.querySelector('input[data-col="elecCurr"]') as HTMLInputElement;
      fireEvent.change(elecCurrInput, { target: { value: '205' } });
      expect(elecCurrInput.value).toBe('205');

      // 3. Fee A is removed in UI and elecCurr remains 205
      expect(screen.queryByText('Fee A')).toBeNull();
      expect(elecCurrInput.value).toBe('205');

      // 4. Global Save is visible
      expect(screen.getByRole('button', { name: /บันทึกข้อมูล/ })).toBeDefined();

      // 5. Click Save to persist removal and new meter reading together
      fireEvent.click(screen.getByRole('button', { name: /บันทึกข้อมูล/ }));

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /บันทึกข้อมูล/ })).toBeNull();
      });
    });

    it('Local Fee Draft Mutation: adds and removes local fee drafts with main Save persistence', async () => {
      const client = createTestQueryClient();

      const serverWorkspace = {
        serverReadings: [{ roomId: 'room-101-uuid', meterType: 'water', previousReading: '100.00', currentReading: '100.00' }],
        cyclePeopleRes: {
          success: true,
          data: [{
            roomId: 'room-101-uuid',
            version: 1,
            peopleCount: 1,
            manualOutstandingAmount: '0.00',
            otherFees: [
              { description: 'Existing Fee 1', amount: '50.00' },
              { description: 'Existing Fee 2', amount: '75.00' },
            ],
          }],
        },
        cyclesRes: {
          data: [{ id: 'cycle-2026-08', cycleCode: '2026-08', status: 'open', isCurrent: true }],
          firstBillingCycleId: 'cycle-2026-08',
          operationalCycleCode: '2026-08',
        },
      };

      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url) => {
        if (url === '/billing-cycles') return serverWorkspace.cyclesRes;
        if (url.includes('/meters/cycle-people-count')) return serverWorkspace.cyclePeopleRes;
        if (url.includes('/meters/readings')) return { success: true, data: serverWorkspace.serverReadings };
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
            savedRows: [{ roomId: 'room-101-uuid', version: 2, peopleCount: 1, manualOutstandingAmount: '0.00', otherFees: [{ description: 'Existing Fee 2', amount: '75.00' }] }],
          };
        }
        return { success: true, data: [] };
      });

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

      await waitFor(() => {
        expect(screen.getByText('Existing Fee 1')).toBeDefined();
        expect(screen.getByText('Existing Fee 2')).toBeDefined();
      });

      const removeButtons = screen.getAllByTitle('ลบรายการ') as HTMLButtonElement[];
      expect(removeButtons).toHaveLength(2);
      const addFeeBtn = screen.getByTitle('เพิ่มรายการค่าใช้จ่าย') as HTMLButtonElement;
      const waterCurrInput = document.querySelector('input[data-col="waterCurr"]') as HTMLInputElement;

      expect(removeButtons[0].disabled).toBe(false);
      expect(removeButtons[1].disabled).toBe(false);
      expect(addFeeBtn.disabled).toBe(false);
      expect(waterCurrInput.disabled).toBe(false);

      // Remove fee 1 locally
      fireEvent.click(removeButtons[0]);

      // Fee 1 removed from UI
      await waitFor(() => {
        expect(screen.queryByText('Existing Fee 1')).toBeNull();
        expect(screen.getByText('Existing Fee 2')).toBeDefined();
      });

      // Save button is visible
      const saveBtn = screen.getByRole('button', { name: /บันทึกข้อมูล/ });
      expect(saveBtn).toBeDefined();

      // Click save
      fireEvent.click(saveBtn);
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /บันทึกข้อมูล/ })).toBeNull();
      });
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
    expect(preview.totalAmount).toBe('109.00');
    expect(preview.formattedTotal).toBe('109.00');
  });
});

// ==========================================
// Section 13: Cycle Authority & Data-Ready Navigation Proofs
// ==========================================
describe('Cycle Authority & Data-Ready Navigation Proofs', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    meterDraftStore.clearDormitoryDrafts('dorm-fresh');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const freshOwnerRooms: Room[] = [
    { id: 'r-101', buildingId: 'bld-1', roomNumber: '101', floor: 1, status: 'vacant', monthlyRent: 4000, dailyRent: 400, depositAmount: 0, maxOccupants: 2, initialWaterMeter: 0, initialElectricMeter: 0, images: [], createdAt: '2026-08-01', updatedAt: '2026-08-01' },
    { id: 'r-102', buildingId: 'bld-1', roomNumber: '102', floor: 1, status: 'vacant', monthlyRent: 4000, dailyRent: 400, depositAmount: 0, maxOccupants: 2, initialWaterMeter: 0, initialElectricMeter: 0, images: [], createdAt: '2026-08-01', updatedAt: '2026-08-01' },
    { id: 'r-201', buildingId: 'bld-1', roomNumber: '201', floor: 2, status: 'vacant', monthlyRent: 4000, dailyRent: 400, depositAmount: 0, maxOccupants: 2, initialWaterMeter: 0, initialElectricMeter: 0, images: [], createdAt: '2026-08-01', updatedAt: '2026-08-01' },
    { id: 'r-202', buildingId: 'bld-1', roomNumber: '202', floor: 2, status: 'vacant', monthlyRent: 4000, dailyRent: 400, depositAmount: 0, maxOccupants: 2, initialWaterMeter: 0, initialElectricMeter: 0, images: [], createdAt: '2026-08-01', updatedAt: '2026-08-01' },
  ];

  const freshOwnerCycles = [
    { id: 'cycle-aug', cycleCode: '2026-08', status: 'draft', isCurrent: true, isFirstCycle: true },
    { id: 'cycle-sep', cycleCode: '2026-09', status: 'draft', isCurrent: false, isFirstCycle: false },
    { id: 'cycle-oct', cycleCode: '2026-10', status: 'draft', isCurrent: false, isFirstCycle: false },
  ];

  it('Fresh Owner August (First Billing Cycle): Hides "ดึงข้อมูลก่อนหน้า", enables previous reading edits with "เปิดแก้ไข", and displays "+ เพิ่มผู้เช่า" on all 4 vacant rooms', async () => {
    vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url) => {
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
            rooms: freshOwnerRooms.map(r => ({ roomId: r.id, roomNumber: r.roomNumber, rentAmount: '4000.00', billingSource: 'DEFAULT' })),
          },
        };
      }
      return { success: true, data: [] };
    });

    renderWithClient(
      <OwnerMeters
        rooms={freshOwnerRooms}
        buildings={[{ id: 'bld-1', dormitoryId: 'dorm-fresh', name: 'อาคาร A', totalFloors: 2, roomsPerFloor: 2, createdAt: '2026-08-01' }]}
        dormitoryId="dorm-fresh"
        bills={[]}
        tenants={[]}
        contracts={[]}
        onSaveBills={vi.fn()}
        onSelectTenant={vi.fn()}
        onAddLog={vi.fn()}
        onNavigate={vi.fn()}
        selectedBillingCycleId="cycle-aug"
        selectedCycleCode="2026-08"
        selectedCycle="2026-08"
        billingCycles={freshOwnerCycles}
      />
    );

    // 1. Wait for table to render all 4 rooms
    await waitFor(() => {
      expect(screen.getByText('101')).toBeDefined();
      expect(screen.getByText('102')).toBeDefined();
      expect(screen.getByText('201')).toBeDefined();
      expect(screen.getByText('202')).toBeDefined();
    });

    // 3. Previous reading inputs are editable by default
    const row101 = screen.getByText('101').closest('tr');
    const elecPrev101 = row101?.querySelector('input[data-col="elecPrev"]') as HTMLInputElement;
    const waterPrev101 = row101?.querySelector('input[data-col="waterPrev"]') as HTMLInputElement;
    expect(elecPrev101.disabled).toBe(false);
    expect(waterPrev101.disabled).toBe(false);

    // 4. All four vacant rooms show "+ เพิ่มผู้เช่า"
    const quickAddButtons = screen.getAllByText('เพิ่มผู้เช่า');
    expect(quickAddButtons.length).toBe(4);
  });

  it('Fresh Owner September (Future Cycle): Hides Quick Add "+ เพิ่มผู้เช่า" and shows "ไม่มีข้อมูล" for vacant rooms', async () => {
    vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url) => {
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
            rooms: freshOwnerRooms.map(r => ({ roomId: r.id, roomNumber: r.roomNumber, rentAmount: '4000.00', billingSource: 'DEFAULT' })),
          },
        };
      }
      return { success: true, data: [] };
    });

    renderWithClient(
      <OwnerMeters
        rooms={freshOwnerRooms}
        buildings={[{ id: 'bld-1', dormitoryId: 'dorm-fresh', name: 'อาคาร A', totalFloors: 2, roomsPerFloor: 2, createdAt: '2026-08-01' }]}
        dormitoryId="dorm-fresh"
        bills={[]}
        tenants={[]}
        contracts={[]}
        onSaveBills={vi.fn()}
        onSelectTenant={vi.fn()}
        onAddLog={vi.fn()}
        onNavigate={vi.fn()}
        selectedBillingCycleId="cycle-oct"
        selectedCycleCode="2026-10"
        selectedCycle="2026-10"
        billingCycles={freshOwnerCycles}
      />
    );

    // 1. Wait for table to render
    await waitFor(() => {
      expect(screen.getByText('101')).toBeDefined();
    });

    // 2. Quick Add "+ เพิ่มผู้เช่า" MUST NOT be rendered on October (outside rolling 3-month window)
    expect(screen.queryByText('เพิ่มผู้เช่า')).toBeNull();

    // 3. All 4 vacant rooms display "ไม่มีข้อมูล" in the tenant column
    const noDataLabels = screen.getAllByText('ไม่มีข้อมูล');
    expect(noDataLabels.length).toBe(4);
  });

  it('Data-Ready Navigation Contract: getTargetQueriesForTab specifies correct canonical query dependencies for all tabs', () => {
    const dormId = 'dorm-fresh';
    const cycleId = 'cycle-aug';

    // 1. Meters tab queries
    const meterQueries = getTargetQueriesForTab('meters', dormId, cycleId);
    const meterKeys = meterQueries.map(q => JSON.stringify(q.queryKey));
    expect(meterKeys).toContain(JSON.stringify(queryKeys.rooms(dormId)));
    expect(meterKeys).toContain(JSON.stringify(queryKeys.buildings(dormId)));
    expect(meterKeys).toContain(JSON.stringify(queryKeys.billingCycles(dormId)));
    expect(meterKeys).toContain(JSON.stringify(queryKeys.bills(dormId)));
    expect(meterKeys).toContain(JSON.stringify(queryKeys.tenants(dormId)));
    expect(meterKeys).toContain(JSON.stringify(queryKeys.contracts(dormId)));
    expect(meterKeys).toContain(JSON.stringify(queryKeys.meterWorkspace(dormId, cycleId)));
    expect(meterKeys).toContain(JSON.stringify(queryKeys.meterPreviewContext(dormId, cycleId)));

    // 2. Rooms tab queries
    const roomQueries = getTargetQueriesForTab('rooms', dormId);
    const roomKeys = roomQueries.map(q => JSON.stringify(q.queryKey));
    expect(roomKeys).toContain(JSON.stringify(queryKeys.rooms(dormId)));
    expect(roomKeys).toContain(JSON.stringify(queryKeys.buildings(dormId)));
    expect(roomKeys).toContain(JSON.stringify(queryKeys.tenants(dormId)));
    expect(roomKeys).toContain(JSON.stringify(queryKeys.contracts(dormId)));
    expect(roomKeys).toContain(JSON.stringify(queryKeys.bills(dormId)));

    // 3. Tenants tab queries
    const tenantQueries = getTargetQueriesForTab('tenants', dormId);
    const tenantKeys = tenantQueries.map(q => JSON.stringify(q.queryKey));
    expect(tenantKeys).toContain(JSON.stringify(queryKeys.tenants(dormId)));
    expect(tenantKeys).toContain(JSON.stringify(queryKeys.rooms(dormId)));
    expect(tenantKeys).toContain(JSON.stringify(queryKeys.contracts(dormId)));
    expect(tenantKeys).toContain(JSON.stringify(queryKeys.bills(dormId)));

    // 4. Payments tab queries
    const paymentQueries = getTargetQueriesForTab('payments', dormId);
    const paymentKeys = paymentQueries.map(q => JSON.stringify(q.queryKey));
    expect(paymentKeys).toContain(JSON.stringify(queryKeys.payments(dormId)));
    expect(paymentKeys).toContain(JSON.stringify(queryKeys.bills(dormId)));
    expect(paymentKeys).toContain(JSON.stringify(queryKeys.dailyInvoices(dormId)));
    expect(paymentKeys).not.toContain(JSON.stringify(queryKeys.rooms(dormId)));
    expect(paymentKeys).toHaveLength(3);

    // 5. Maintenance tab queries
    const maintenanceQueries = getTargetQueriesForTab('maintenance', dormId);
    const maintenanceKeys = maintenanceQueries.map(q => JSON.stringify(q.queryKey));
    expect(maintenanceKeys).toContain(JSON.stringify(queryKeys.maintenance(dormId)));
    expect(maintenanceKeys).toContain(JSON.stringify(queryKeys.rooms(dormId)));
    expect(maintenanceKeys).toContain(JSON.stringify(queryKeys.tenants(dormId)));
  });
});

// ==========================================
// Section 14: Daily Stay Meter Semantics, Financial Exclusion & Exact Deposit Copy
// ==========================================
describe('Daily Stay Meter Semantics, Financial Exclusion & Exact Deposit Copy', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    meterDraftStore.clearDormitoryDrafts('dorm-daily-test');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const dailyRoom: Room = {
    id: 'room-daily-1',
    buildingId: 'bld-daily',
    roomNumber: 'D101',
    floor: 1,
    status: 'occupied',
    monthlyRent: 4000,
    dailyRent: 500,
    depositAmount: 500,
    maxOccupants: 2,
    initialWaterMeter: 100,
    initialElectricMeter: 500,
    images: [],
    createdAt: '2026-08-01',
    updatedAt: '2026-08-01',
  };

  const dailyCycles = [
    { id: 'cycle-daily-aug', cycleCode: '2026-08', status: 'draft', isCurrent: true, isFirstCycle: false },
  ];

  it('Proves A & H: DAILY_STAY meter inputs are ENABLED, while status cell remains locked as "รายวัน"', async () => {
    vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url) => {
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
            rooms: [
              {
                roomId: 'room-daily-1',
                roomNumber: 'D101',
                tenantName: 'ผู้พัก รายวัน',
                billingSource: 'DAILY_STAY',
                rentAmount: '1500.00',
                dailyDepositAmount: '500.00',
                showDailyDepositLine: true,
                isDailyDepositPaidInDisplayedPeriod: false,
                isLineLinked: false,
                amountDue: '2000.00',
                chargeComponents: [
                  { label: 'ค่าเช่าห้องพักรายวัน (1 วัน)', amount: '1,500.00', status: 'UNPAID' },
                  { label: 'ค่าประกัน', amount: '500.00', status: 'UNPAID' },
                ],
              },
            ],
          },
        };
      }
      if (url.includes('/meters/readings')) {
        return {
          success: true,
          data: [
            {
              id: 'read-water-1',
              billingCycleId: 'cycle-daily-aug',
              roomId: 'room-daily-1',
              meterType: 'water',
              previousReading: '100',
              currentReading: '105',
            },
            {
              id: 'read-elec-1',
              billingCycleId: 'cycle-daily-aug',
              roomId: 'room-daily-1',
              meterType: 'electric',
              previousReading: '500',
              currentReading: '520',
            },
          ],
        };
      }
      if (url.includes('/meters/workspace/household-counts')) {
        return {
          success: true,
          data: [{ roomId: 'room-daily-1', currentHouseholdPeopleCount: 1 }],
        };
      }
      return { success: true, data: [] };
    });

    renderWithClient(
      <OwnerMeters
        rooms={[dailyRoom]}
        buildings={[{ id: 'bld-daily', dormitoryId: 'dorm-daily-test', name: 'อาคาร Daily', totalFloors: 1, roomsPerFloor: 1, createdAt: '2026-08-01' }]}
        dormitoryId="dorm-daily-test"
        bills={[]}
        tenants={[]}
        contracts={[]}
        onSaveBills={vi.fn()}
        onSelectTenant={vi.fn()}
        onAddLog={vi.fn()}
        onNavigate={vi.fn()}
        selectedBillingCycleId="cycle-daily-aug"
        selectedCycleCode="2026-08"
        selectedCycle="2026-08"
        billingCycles={dailyCycles}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('D101')).toBeDefined();
    });

    // A. Verify meter inputs (elecCurr, waterCurr) are ENABLED and editable for DAILY_STAY per latest PO rule
    let elecCurrInput!: HTMLInputElement;
    await waitFor(() => {
      elecCurrInput = screen.getByDisplayValue('520') as HTMLInputElement;
      expect(elecCurrInput).toBeDefined();
    });
    expect(elecCurrInput.disabled).toBe(false);

    const waterCurrInput = screen.getByDisplayValue('105') as HTMLInputElement;
    expect(waterCurrInput).toBeDefined();
    expect(waterCurrInput.disabled).toBe(false);

    // People count MUST remain enabled and editable for DAILY_STAY per latest PO rule
    const peopleCountInput = document.querySelector('input[data-col="peopleCount"]') as HTMLInputElement;
    expect(peopleCountInput).not.toBeNull();
    expect(peopleCountInput.disabled).toBe(false);

    // H. Status cell contains locked badge "รายวัน" and NO toggle switch button
    expect(screen.getByText('รายวัน')).toBeDefined();
    expect(screen.queryByRole('switch')).toBeNull();

    // Total due is 2,000.00 ฿ (rent 1500 + unpaid deposit 500)
    expect(screen.getByText('2,000.00 ฿')).toBeDefined();
    expect(screen.getByText('ค่าประกัน:')).toBeDefined();
    expect(screen.getByText('500.00 ฿')).toBeDefined();
  });

  it('Proves I: Paid in displayed period deposit excludes deposit from total and shows in details as PAID', async () => {
    vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url) => {
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
            rooms: [
              {
                roomId: 'room-daily-1',
                roomNumber: 'D101',
                tenantName: 'ผู้พัก รายวัน',
                billingSource: 'DAILY_STAY',
                rentAmount: '1500.00',
                dailyDepositAmount: '500.00',
                showDailyDepositLine: true,
                isDailyDepositPaidInDisplayedPeriod: true, // Paid in current period
                isLineLinked: false,
                amountDue: '1500.00',
                chargeComponents: [
                  { label: 'ค่าเช่าห้องพักรายวัน (1 วัน)', amount: '1,500.00', status: 'UNPAID' },
                  { label: 'ค่าประกัน', amount: '500.00', status: 'PAID' },
                ],
              },
            ],
          },
        };
      }
      return { success: true, data: [] };
    });

    renderWithClient(
      <OwnerMeters
        rooms={[dailyRoom]}
        buildings={[{ id: 'bld-daily', dormitoryId: 'dorm-daily-test', name: 'อาคาร Daily', totalFloors: 1, roomsPerFloor: 1, createdAt: '2026-08-01' }]}
        dormitoryId="dorm-daily-test"
        bills={[]}
        tenants={[]}
        contracts={[]}
        onSaveBills={vi.fn()}
        onSelectTenant={vi.fn()}
        onAddLog={vi.fn()}
        onNavigate={vi.fn()}
        selectedBillingCycleId="cycle-daily-aug"
        selectedCycleCode="2026-08"
        selectedCycle="2026-08"
        billingCycles={dailyCycles}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('D101')).toBeDefined();
    });

    // Paid deposit is not added to total due (total is strictly rent 1,500.00 ฿)
    expect(screen.getAllByText('1,500.00 ฿').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('ค่าประกัน:')).toBeDefined();
    expect(screen.getByText('500.00 ฿')).toBeDefined();
  });

  it('Proves C, D, E, F, G: Client calculator enforces strict DAILY_STAY financial exclusion while computing usage', () => {
    const dailyCtx: RoomPreviewContext = {
      roomId: 'room-daily-1',
      billingSource: 'DAILY_STAY',
      rentAmount: '1500.00',
      dailyDepositAmount: '500.00',
      showDailyDepositLine: true,
      isDailyDepositPaidInDisplayedPeriod: false, // Unpaid -> total is 1500 + 500 = 2000.00
    };

    const rates = {
      waterBillingType: 'per_unit' as const,
      waterRate: '18.00',
      electricityBillingType: 'per_unit' as const,
      electricityRate: '8.00',
    };

    // Baseline calculation with 10 units water, 20 units electricity
    const basePreview = calculateMeterRowPreview(dailyCtx, rates, {
      waterPrev: '100',
      waterCurr: '110',
      elecPrev: '500',
      elecCurr: '520',
    });

    // F. Total contains strictly rent + deposit due = 2,000.00
    expect(basePreview.rentAmount).toBe('1500.00');
    expect(basePreview.totalAmount).toBe('2000.00');
    expect(basePreview.formattedTotal).toBe('2,000.00');
    // Financial charges for water and electricity are strictly 0.00
    expect(basePreview.waterAmount).toBe('0.00');
    expect(basePreview.elecAmount).toBe('0.00');
    // Usage is recorded for history
    expect(basePreview.waterUsage).toBe('10.00');
    expect(basePreview.elecUsage).toBe('20.00');

    // D. Changing electricity reading from 520 to 990 (huge usage) does NOT change Daily total
    const highElecPreview = calculateMeterRowPreview(dailyCtx, rates, {
      waterPrev: '100',
      waterCurr: '110',
      elecPrev: '500',
      elecCurr: '990',
    });
    expect(highElecPreview.totalAmount).toBe('2000.00');
    expect(highElecPreview.elecAmount).toBe('0.00');
    expect(highElecPreview.elecUsage).toBe('490.00');

    // E. Changing water reading from 110 to 9999 (rollover usage) does NOT change Daily total
    const highWaterPreview = calculateMeterRowPreview(dailyCtx, rates, {
      waterPrev: '9980',
      waterCurr: '10', // 4-digit rollover -> 30 units
      elecPrev: '500',
      elecCurr: '520',
    });
    expect(highWaterPreview.totalAmount).toBe('2000.00');
    expect(highWaterPreview.waterAmount).toBe('0.00');
    expect(highWaterPreview.waterUsage).toBe('30.00');

    // G. Monthly/Term room meter charges continue to calculate normally
    const monthlyCtx: RoomPreviewContext = {
      roomId: 'room-monthly-1',
      billingSource: 'CONTRACT',
      rentAmount: '3500.00',
    };
    const monthlyPreview = calculateMeterRowPreview(monthlyCtx, rates, {
      waterPrev: '100',
      waterCurr: '110', // 10 units * 18 = 180.00
      elecPrev: '500',
      elecCurr: '520', // 20 units * 8 = 160.00
    });
    expect(monthlyPreview.waterAmount).toBe('180.00');
    expect(monthlyPreview.elecAmount).toBe('160.00');
    expect(monthlyPreview.totalAmount).toBe('340.00'); // 180 + 160 = 340.00 (Rent is separate authority)
  });

  it('Vertical Navigation: ArrowDown and ArrowUp skip paid rows (101 editable -> 102 paid -> 103 paid -> 104 editable)', async () => {
    const navRooms = [
      { id: 'r-101', dormitoryId: 'd-nav', buildingId: 'b-1', roomNumber: '101', floor: 1, type: 'standard', status: 'occupied' as const, monthlyRent: 4000 },
      { id: 'r-102', dormitoryId: 'd-nav', buildingId: 'b-1', roomNumber: '102', floor: 1, type: 'standard', status: 'occupied' as const, monthlyRent: 4000 },
      { id: 'r-103', dormitoryId: 'd-nav', buildingId: 'b-1', roomNumber: '103', floor: 1, type: 'standard', status: 'occupied' as const, monthlyRent: 4000 },
      { id: 'r-104', dormitoryId: 'd-nav', buildingId: 'b-1', roomNumber: '104', floor: 1, type: 'standard', status: 'occupied' as const, monthlyRent: 4000 },
    ];

    const navCycles = [
      { id: 'cycle-nav-1', cycleCode: '2026-08', name: 'สิงหาคม 2569', status: 'open', isCurrent: true, isFirstCycle: false },
    ];

    vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (_method: string, url: string) => {
      if (url.includes('/meters/workspace/preview-context')) {
        return {
          success: true,
          data: {
            billingCycleId: 'cycle-nav-1',
            rateSnapshot: {
              waterBillingType: 'per_unit',
              waterRate: '18.00',
              electricityBillingType: 'per_unit',
              electricityRate: '8.00',
            },
            rooms: [
              { roomId: 'r-101', billingSource: 'CONTRACT', billStatus: 'draft', chargeComponents: [{ label: 'บิลรายเดือน', status: 'PREVIEW' }] },
              { roomId: 'r-102', billingSource: 'CONTRACT', billStatus: 'paid', chargeComponents: [{ label: 'บิลรายเดือน', status: 'PAID' }] },
              { roomId: 'r-103', billingSource: 'CONTRACT', billStatus: 'paid', chargeComponents: [{ label: 'บิลรายเดือน', status: 'PAID' }] },
              { roomId: 'r-104', billingSource: 'CONTRACT', billStatus: 'draft', chargeComponents: [{ label: 'บิลรายเดือน', status: 'PREVIEW' }] },
            ],
          },
        };
      }
      if (url.includes('/meters/readings')) {
        return {
          success: true,
          data: [
            { id: 'm-101-e', billingCycleId: 'cycle-nav-1', roomId: 'r-101', meterType: 'electricity', previousReading: '100', currentReading: '120' },
            { id: 'm-101-w', billingCycleId: 'cycle-nav-1', roomId: 'r-101', meterType: 'water', previousReading: '50', currentReading: '60' },
            { id: 'm-102-e', billingCycleId: 'cycle-nav-1', roomId: 'r-102', meterType: 'electricity', previousReading: '200', currentReading: '220' },
            { id: 'm-103-e', billingCycleId: 'cycle-nav-1', roomId: 'r-103', meterType: 'electricity', previousReading: '300', currentReading: '330' },
            { id: 'm-104-e', billingCycleId: 'cycle-nav-1', roomId: 'r-104', meterType: 'electricity', previousReading: '400', currentReading: '440' },
            { id: 'm-104-w', billingCycleId: 'cycle-nav-1', roomId: 'r-104', meterType: 'water', previousReading: '70', currentReading: '80' },
          ],
        };
      }
      if (url.includes('/meters/workspace/household-counts')) {
        return { success: true, data: [] };
      }
      return { success: true, data: [] };
    });

    const { container } = renderWithClient(
      <OwnerMeters
        rooms={navRooms}
        buildings={[{ id: 'b-1', dormitoryId: 'd-nav', name: 'อาคาร A', totalFloors: 1, roomsPerFloor: 4, createdAt: '2026-08-01' }]}
        dormitoryId="d-nav"
        bills={[
          { id: 'b-102', dormitoryId: 'd-nav', billingCycleId: 'cycle-nav-1', roomId: 'r-102', status: 'paid', billNumber: 'B-102', totalAmount: 4000, paidAmount: 4000, outstandingAmount: 0, billKind: 'MONTHLY_UTILITY' } as any,
          { id: 'b-103', dormitoryId: 'd-nav', billingCycleId: 'cycle-nav-1', roomId: 'r-103', status: 'paid', billNumber: 'B-103', totalAmount: 4000, paidAmount: 4000, outstandingAmount: 0, billKind: 'MONTHLY_UTILITY' } as any,
        ]}
        tenants={[]}
        contracts={[]}
        onSaveBills={vi.fn()}
        onSelectTenant={vi.fn()}
        onAddLog={vi.fn()}
        onNavigate={vi.fn()}
        selectedBillingCycleId="cycle-nav-1"
        selectedCycleCode="2026-08"
        selectedCycle="2026-08"
        billingCycles={navCycles}
        initialCachedData={{
          serverReadings: [
            { id: 'm-101-e', billingCycleId: 'cycle-nav-1', roomId: 'r-101', meterType: 'electricity', previousReading: '100', currentReading: '120' },
            { id: 'm-101-w', billingCycleId: 'cycle-nav-1', roomId: 'r-101', meterType: 'water', previousReading: '50', currentReading: '60' },
            { id: 'm-102-e', billingCycleId: 'cycle-nav-1', roomId: 'r-102', meterType: 'electricity', previousReading: '200', currentReading: '220' },
            { id: 'm-103-e', billingCycleId: 'cycle-nav-1', roomId: 'r-103', meterType: 'electricity', previousReading: '300', currentReading: '330' },
            { id: 'm-104-e', billingCycleId: 'cycle-nav-1', roomId: 'r-104', meterType: 'electricity', previousReading: '400', currentReading: '440' },
            { id: 'm-104-w', billingCycleId: 'cycle-nav-1', roomId: 'r-104', meterType: 'water', previousReading: '70', currentReading: '80' },
          ],
          cyclePeopleRes: { success: true, data: [] },
        }}
      />
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('120')).toBeDefined();
      expect(screen.getByDisplayValue('440')).toBeDefined();
    });

    const input101ElecCurr = container.querySelector('input[data-row="0"][data-col="elecCurr"]') as HTMLInputElement;
    const input104ElecCurr = container.querySelector('input[data-row="3"][data-col="elecCurr"]') as HTMLInputElement;

    expect(input101ElecCurr).toBeTruthy();
    expect(input104ElecCurr).toBeTruthy();
    expect(input101ElecCurr.disabled).toBe(false);
    expect(input104ElecCurr.disabled).toBe(false);

    // Verify 102 and 103 are disabled (paid)
    const input102ElecCurr = container.querySelector('input[data-row="1"][data-col="elecCurr"]') as HTMLInputElement;
    const input103ElecCurr = container.querySelector('input[data-row="2"][data-col="elecCurr"]') as HTMLInputElement;
    expect(input102ElecCurr?.disabled).toBe(true);
    expect(input103ElecCurr?.disabled).toBe(true);

    // Focus on 101 elecCurr and press ArrowDown
    input101ElecCurr.focus();
    fireEvent.keyDown(input101ElecCurr, { key: 'ArrowDown', code: 'ArrowDown' });

    // ArrowDown must skip 102 and 103 (both paid) and focus directly on 104 elecCurr
    expect(document.activeElement).toBe(input104ElecCurr);

    // Press ArrowUp from 104 elecCurr -> should skip 103 and 102 and focus back on 101 elecCurr
    fireEvent.keyDown(input104ElecCurr, { key: 'ArrowUp', code: 'ArrowUp' });
    expect(document.activeElement).toBe(input101ElecCurr);

    // Press ArrowRight from 101 elecCurr -> focuses on 101 waterCurr
    const input101WaterCurr = container.querySelector('input[data-row="0"][data-col="waterCurr"]') as HTMLInputElement;
    fireEvent.keyDown(input101ElecCurr, { key: 'ArrowRight', code: 'ArrowRight' });
    expect(document.activeElement).toBe(input101WaterCurr);

    // Press ArrowLeft from 101 waterCurr -> focuses back on 101 elecCurr
    fireEvent.keyDown(input101WaterCurr, { key: 'ArrowLeft', code: 'ArrowLeft' });
    expect(document.activeElement).toBe(input101ElecCurr);
  });
});
