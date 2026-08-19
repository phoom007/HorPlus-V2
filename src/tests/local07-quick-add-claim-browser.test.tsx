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
import { QuickAddTenantModal } from '../components/QuickAddTenantModal';
import { OwnerMeters } from '../pages/owner/meters';
import * as httpClient from '../data/httpClient';
import { Room, Building, QuickAddRoomContext } from '../types';

describe('LOCAL-07 Batch 02 — Frontend Quick Add & Claim Boundary Suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
    monthlyRent: 4500,
    dailyRent: 350,
    depositAmount: 0,
    building: {
      id: 'bld-001-uuid',
      name: 'Building A',
      termMonths: 4,
      maxTermRentInstallments: 3,
      monthlyRent: 4500,
      dailyRent: 400,
      depositAmount: 500,
    },
  };

  // ==========================================
  // Section 10: Operational-Cycle Test Matrix
  // ==========================================
  describe('Operational-Cycle Fail-Closed Matrix', () => {
    it('Matrix A: authority loaded + current cycle -> Quick Add visible', async () => {
      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url) => {
        if (url === '/billing-cycles') {
          return {
            data: [{ id: 'cycle-2026-08', cycleCode: '2026-08', status: 'open', isCurrent: true }],
            operationalCycleCode: '2026-08',
            operationalBillingCycleId: 'cycle-2026-08',
          };
        }
        return { success: true, data: [] };
      });

      render(
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

      render(
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

      render(
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

      render(
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
          context={mockContext} // context.depositAmount is 0, building.depositAmount is 500
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
        dailyRent: undefined,
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
  });
});
