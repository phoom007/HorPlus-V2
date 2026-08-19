/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * LOCAL-07 Batch 02 — Frontend Boundary & Quick Add UI Test Suite
 * Proofs A through J covering Meter Quick Add button, Route alignment, End Date persistence, and Authority defaults.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QuickAddTenantModal } from '../components/QuickAddTenantModal';
import { OwnerMeters } from '../pages/owner/meters';
import * as httpClient from '../data/httpClient';
import { Room } from '../types';

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
    dormitoryId: 'dorm-001-uuid',
    buildingId: 'bld-001-uuid',
    roomNumber: '101',
    floor: 1,
    status: 'vacant',
    monthlyRent: 4500,
    dailyRent: 350,
    depositAmount: 0, // Configured 0 deposit
    termMonths: 6,
    termRent: 27000,
    building: {
      id: 'bld-001-uuid',
      dormitoryId: 'dorm-001-uuid',
      name: 'Building A',
      maxTermRentInstallments: 3,
      termMonths: 6,
      dailyRent: 400,
      depositAmount: 500,
    } as any,
  } as Room;

  describe('Proof A & B & C: Meter Row Quick Add Rendering & Room Object Authority', () => {
    it('Proof A: renders "+ เพิ่มผู้เช่า" button when operational cycle matches and room has no active tenant', async () => {
      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url) => {
        if (url === '/billing-cycles') {
          return {
            data: [{ id: 'cycle-2026-08', cycleCode: '2026-08', status: 'draft', isCurrent: true }],
            operationalCycleCode: '2026-08',
            operationalBillingCycleId: 'cycle-2026-08',
          };
        }
        return { success: true, data: [] };
      });

      render(
        <OwnerMeters
          rooms={[mockRoom]}
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

    it('Proof B: hides Quick Add button in historical/non-operational cycles', async () => {
      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url) => {
        if (url === '/billing-cycles') {
          return {
            data: [{ id: 'cycle-2026-08', cycleCode: '2026-08', status: 'open' }],
            operationalCycleCode: '2026-08',
          };
        }
        return { success: true, data: [] };
      });

      render(
        <OwnerMeters
          rooms={[mockRoom]}
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
  });

  describe('Proof D & E & F: Canonical Route Alignment for 3-Type Quick Add', () => {
    it('Proof D: MONTHLY quick add submits to canonical POST /api/v1/meters/provisional-terms', async () => {
      const httpSpy = vi.spyOn(httpClient, 'httpRequest').mockResolvedValue({ success: true, data: { id: 'term-1' } });
      const onSuccess = vi.fn();
      const onClose = vi.fn();

      render(
        <QuickAddTenantModal
          isOpen={true}
          onClose={onClose}
          room={mockRoom}
          dormitoryId="dorm-001-uuid"
          onSuccess={onSuccess}
        />
      );

      const nameInput = screen.getByPlaceholderText('เช่น นายสมชาย ใจดี');
      fireEvent.change(nameInput, { target: { value: 'สมชาย ใจดี' } });

      const submitBtn = screen.getByText('บันทึกและเปิดสัญญาทันที');
      fireEvent.submit(submitBtn.closest('form')!);

      await waitFor(() => {
        expect(httpSpy).toHaveBeenCalledTimes(1);
        const [method, url, payload] = httpSpy.mock.calls[0];
        expect(method).toBe('POST');
        expect(url).toBe('/api/v1/meters/provisional-terms');
        expect(payload.rentalType).toBe('MONTHLY');
        expect(payload.fullName).toBe('สมชาย ใจดี');
        expect(payload.roomId).toBe(mockRoom.id);
        expect(onSuccess).toHaveBeenCalled();
      });
    });

    it('Proof E: TERM quick add submits to canonical POST /api/v1/meters/provisional-terms with installment count', async () => {
      const httpSpy = vi.spyOn(httpClient, 'httpRequest').mockResolvedValue({ success: true, data: { id: 'term-2' } });

      render(
        <QuickAddTenantModal
          isOpen={true}
          onClose={vi.fn()}
          room={mockRoom}
          dormitoryId="dorm-001-uuid"
          onSuccess={vi.fn()}
        />
      );

      // Switch to TERM tab
      fireEvent.click(screen.getByText('รายเทอม'));

      // Fill Full Name
      fireEvent.change(screen.getByPlaceholderText('เช่น นายสมชาย ใจดี'), { target: { value: 'สมหญิง รักเรียน' } });

      // Submit
      const submitBtn = screen.getByText('บันทึกและเปิดสัญญาทันที');
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
          room={mockRoom}
          dormitoryId="dorm-001-uuid"
          onSuccess={vi.fn()}
        />
      );

      // Switch to DAILY tab
      fireEvent.click(screen.getByText('รายวัน'));

      // Fill Full Name
      fireEvent.change(screen.getByPlaceholderText('เช่น นายสมชาย ใจดี'), { target: { value: 'นักท่องเที่ยว ใจดี' } });

      // Submit
      const submitBtn = screen.getByText('บันทึกและเปิดสัญญาทันที');
      fireEvent.submit(submitBtn.closest('form')!);

      await waitFor(() => {
        expect(httpSpy).toHaveBeenCalledTimes(1);
        const [method, url, payload] = httpSpy.mock.calls[0];
        expect(method).toBe('POST');
        expect(url).toBe('/api/v1/daily-stays/owner-quick-add');
        expect(payload.dormitoryId).toBe('dorm-001-uuid');
        expect(payload.roomId).toBe(mockRoom.id);
        expect(payload.fullName).toBe('นักท่องเที่ยว ใจดี');
      });
    });
  });

  describe('Proof G & H & I & J: Financial Integrity & Building Authority Invariants', () => {
    it('Proof G: edited MONTHLY endDate is explicitly passed in payload', async () => {
      const httpSpy = vi.spyOn(httpClient, 'httpRequest').mockResolvedValue({ success: true, data: { id: 'term-g' } });

      render(
        <QuickAddTenantModal
          isOpen={true}
          onClose={vi.fn()}
          room={mockRoom}
          dormitoryId="dorm-001-uuid"
          onSuccess={vi.fn()}
        />
      );

      fireEvent.change(screen.getByPlaceholderText('เช่น นายสมชาย ใจดี'), { target: { value: 'ผู้เช่า แก้ไขวัน' } });

      const dateInputs = screen.getAllByDisplayValue(/2026-\d{2}-\d{2}/);
      if (dateInputs.length > 1) {
        fireEvent.change(dateInputs[1], { target: { value: '2026-12-31' } });
      }

      const submitBtn = screen.getByText('บันทึกและเปิดสัญญาทันที');
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
          room={mockRoom} // room.depositAmount is 0, building.depositAmount is 500
          dormitoryId="dorm-001-uuid"
          onSuccess={vi.fn()}
        />
      );

      fireEvent.click(screen.getByText('รายวัน'));

      const depositInputs = screen.getAllByRole('spinbutton');
      const depositInput = depositInputs.find((input: any) => input.value === '0');
      expect(depositInput).toBeDefined();
    });

    it('Proof I: no fake 500 daily rate when room and building have no dailyRent configured', () => {
      const emptyRoom: Room = {
        id: 'room-empty',
        dormitoryId: 'dorm-001-uuid',
        roomNumber: '102',
        floor: 1,
        status: 'vacant',
        dailyRent: undefined,
        building: {} as any,
      } as Room;

      render(
        <QuickAddTenantModal
          isOpen={true}
          onClose={vi.fn()}
          room={emptyRoom}
          dormitoryId="dorm-001-uuid"
          onSuccess={vi.fn()}
        />
      );

      fireEvent.click(screen.getByText('รายวัน'));

      const spinInputs = screen.getAllByRole('spinbutton');
      const has500 = spinInputs.some((input: any) => input.value === '500');
      expect(has500).toBe(false);
    });

    it('Proof J: TERM max installments options follow Building authority (1..maxTermRentInstallments)', () => {
      render(
        <QuickAddTenantModal
          isOpen={true}
          onClose={vi.fn()}
          room={mockRoom} // mockRoom.building.maxTermRentInstallments = 3
          dormitoryId="dorm-001-uuid"
          onSuccess={vi.fn()}
        />
      );

      fireEvent.click(screen.getByText('รายเทอม'));

      const select = screen.getByRole('combobox');
      expect(select.children.length).toBe(3); // Options: 1, 2, 3
    });
  });
});
