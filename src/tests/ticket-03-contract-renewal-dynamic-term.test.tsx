/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * @vitest-environment happy-dom
 *
 * TICKET 03 TEST SUITE: Contract Renewal Dynamic Term Calculation and Summary Parity
 *
 * Requirements:
 * 1. Owner & Tenant renewal allows toggling between "รายเทอม" (Term) and "รายเดือน" (Monthly).
 * 2. For Term:
 *    - effectiveTermMonths calculated from building/room/dormitory (e.g. termMonths = 5).
 *    - Dropdown shows 1 to 6 months; only the month matching effectiveTermMonths shows "${effectiveTermMonths} เดือน (1 เทอม)".
 *    - Default selected duration is effectiveTermMonths.
 *    - Rate displays /เทอม (or บาท/เทอม).
 * 3. For Monthly:
 *    - Dropdown shows 1 to 12 months; month 12 shows "12 เดือน (1 ปี)".
 *    - Default selected duration is 1 month.
 *    - Rate displays /เดือน (or บาท/เดือน).
 * 4. Real-time compact total calculation summary:
 *    - Monthly: "ยอดรวมค่าเช่า: ฿12,000 (3 เดือน × ฿4,000)"
 *    - Term: shows proportional calculation.
 * 5. On submit in handleExecuteRenewContract:
 *    - Saves rentBillingType: 'term' | 'monthly'
 *    - Saves durationMonths: renewContractMonths and updates endDate accordingly.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OwnerTenants } from '../pages/owner/tenants';
import { TenantContractView } from '../pages/tenant/views/TenantContractView';
import { Tenant, Room, Contract, Dormitory } from '../types';

vi.mock('../utils/imageUtils', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    convertImageToWebP: vi.fn(async () => 'data:image/webp;base64,mockwebp'),
  };
});

describe('Ticket 03: Contract Renewal Dynamic Term Calculation and Summary Parity', () => {
  const mockDormitoryId = 'dorm-t03-term5';
  let queryClient: QueryClient;

  // Dormitory configured with termMonths = 5
  const sampleDormitory: Dormitory = {
    id: mockDormitoryId,
    name: 'หอพักมหาวิทยาลัย (เทอม 5 เดือน)',
    address: '99 หมู่ 1 ต.คลองหนึ่ง อ.คลองหลวง จ.ปทุมธานี',
    ownerName: 'สมศักดิ์ สดใส',
    roomsCount: 10,
    occupiedRooms: 2,
    floorsCount: 2,
    termMonths: 5,
    waterRate: 18,
    electricityRate: 8,
  } as any;

  // Room with termRent = 17,500 and monthlyRent = 4,000
  const sampleRoom: Room = {
    id: 'room-501',
    dormitoryId: mockDormitoryId,
    roomNumber: '501',
    status: 'occupied',
    currentTenantId: 'tenant-t03',
    monthlyRent: 4000,
    termRent: 17500,
    deposit: 8000,
    depositAmount: 8000,
    floor: 5,
    maxOccupants: 2,
    initialWaterMeter: 0,
    initialElectricMeter: 0,
    images: [],
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  };

  const sampleTenant: Tenant = {
    id: 'tenant-t03',
    name: 'นายกิตติศักดิ์ นักศึกษา',
    phone: '0819998888',
    status: 'active',
    roomId: 'room-501',
    rentalType: 'TERM',
    rentalPlan: 'term',
    coOccupants: [],
    vehicles: [],
    pets: [],
    rentalHistory: ['room-501'],
    createdAt: '2026-06-01',
    updatedAt: '2026-06-01',
  };

  const sampleContract: Contract = {
    id: 'contract-t03',
    contractNumber: 'CNT-2026-501',
    tenantId: 'tenant-t03',
    roomId: 'room-501',
    startDate: '2026-06-01',
    endDate: '2026-10-31',
    durationMonths: 5,
    rentAmount: 17500,
    depositAmount: 8000,
    rentBillingType: 'term',
    status: 'active',
    tenantSignature: 'sig.png',
    ownerSignature: 'sig-owner.png',
    terms: 'สัญญาเช่าห้อง 501',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  };

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
  });

  describe('Owner Side: Contract Renewal Modal in OwnerTenants', () => {
    it('1. Renders renewal modal for Term plan by default, selects 5 months with "(1 เทอม)", shows /เทอม, switches to Monthly, and verifies dynamic calculation', async () => {
      const onSaveContractsMock = vi.fn();

      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            dormitory={sampleDormitory}
            tenants={[sampleTenant]}
            rooms={[sampleRoom]}
            contracts={[sampleContract]}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onSaveContracts={onSaveContractsMock}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      // 1. Select tenant and switch to Contract tab
      fireEvent.click(screen.getByText('นายกิตติศักดิ์ นักศึกษา'));
      const contractTab = screen.getByRole('button', { name: /สัญญาเช่า/i });
      fireEvent.click(contractTab);

      // 2. Click "ต่ออายุสัญญา" button to open modal
      const renewBtn = screen.getAllByRole('button', { name: /ต่ออายุสัญญา/i })[0];
      fireEvent.click(renewBtn);

      // 3. Modal must have toggle between "รายเทอม" and "รายเดือน"
      const termToggleBtn = screen.getByRole('button', { name: 'รายเทอม' });
      const monthlyToggleBtn = screen.getByRole('button', { name: 'รายเดือน' });
      expect(termToggleBtn).toBeDefined();
      expect(monthlyToggleBtn).toBeDefined();

      // 4. In Term plan:
      // - Rate label should indicate (บาท/เทอม)
      expect(screen.getByText(/อัตราค่าเช่า \(บาท\/เทอม\) \*/i)).toBeDefined();

      // - Duration selector should be a dropdown defaulting to 5 (effectiveTermMonths)
      const durationSelect = screen.getByRole('combobox') as HTMLSelectElement;
      expect(durationSelect).toBeDefined();
      expect(durationSelect.value).toBe('5');

      // - Dropdown options: 1 to 6 months; option 5 contains "(1 เทอม)"
      const termOptions = Array.from(durationSelect.querySelectorAll('option'));
      expect(termOptions.length).toBe(6);
      expect(termOptions.map(o => o.value)).toEqual(['1', '2', '3', '4', '5', '6']);
      const option5 = termOptions.find(o => o.value === '5');
      expect(option5?.textContent).toContain('5 เดือน (1 เทอม)');
      const option4 = termOptions.find(o => o.value === '4');
      expect(option4?.textContent).not.toContain('(1 เทอม)');

      // - Rate input should show 17500
      expect(screen.getByDisplayValue('17500')).toBeDefined();

      // 5. Click Monthly toggle:
      fireEvent.click(monthlyToggleBtn);

      // - Default duration resets to 1 for Monthly
      expect(durationSelect.value).toBe('1');

      // - Options update to 1-12 months; option 12 contains "(1 ปี)"
      const monthlyOptions = Array.from(durationSelect.querySelectorAll('option'));
      expect(monthlyOptions.length).toBe(12);
      expect(monthlyOptions.map(o => o.value)).toEqual([
        '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'
      ]);
      const option12 = monthlyOptions.find(o => o.value === '12');
      expect(option12?.textContent).toContain('12 เดือน (1 ปี)');

      // - Rate changes to /เดือน
      expect(screen.getByText(/อัตราค่าเช่า \(บาท\/เดือน\) \*/i)).toBeDefined();

      // - Rent amount switches to room monthly rent (4000)
      expect(screen.getByDisplayValue('4000')).toBeDefined();

      // - Summary displays calculation for 1 month: ฿4,000 (1 เดือน × ฿4,000)
      expect(screen.getByText(/ยอดรวมค่าเช่า: ฿4,000 \(1 เดือน × ฿4,000\)/i)).toBeDefined();

      // 6. Change duration to 3 months:
      fireEvent.change(durationSelect, { target: { value: '3' } });
      expect(durationSelect.value).toBe('3');

      // - Summary updates dynamically to: ฿12,000 (3 เดือน × ฿4,000)
      expect(screen.getByText(/ยอดรวมค่าเช่า: ฿12,000 \(3 เดือน × ฿4,000\)/i)).toBeDefined();

      // 7. Click confirm renewal button
      const confirmBtn = screen.getByRole('button', { name: /ยืนยันต่อสัญญา/i });
      fireEvent.click(confirmBtn);

      // Verify onSaveContracts called with rentBillingType: 'monthly' and durationMonths: 3
      expect(onSaveContractsMock).toHaveBeenCalledTimes(1);
      const savedContracts = onSaveContractsMock.mock.calls[0][0];
      const renewedContract = savedContracts.find((c: Contract) => c.id.startsWith('ct-renew-'));
      expect(renewedContract).toBeDefined();
      expect(renewedContract.rentBillingType).toBe('monthly');
      expect(renewedContract.durationMonths).toBe(3);
      expect(renewedContract.rentAmount).toBe(4000);
    });
  });

  describe('Tenant Side: TenantContractView Renewal Bottom Sheet', () => {
    it('2. Tenant renewal bottom sheet has plan toggle, dynamic term duration defaults, and live summary', async () => {
      let requestedDuration = 5;
      const setRequestedDuration = vi.fn((d: number) => {
        requestedDuration = d;
      });
      const handleSubmitRenewalMock = vi.fn();

      const { rerender } = render(
        <TenantContractView
          tenantContracts={[sampleContract]}
          tenant={sampleTenant}
          tenantRoom={sampleRoom}
          dormitory={sampleDormitory}
          renewalEligibility={{ isEligible: true }}
          requestedStartDate="2026-11-01"
          setRequestedStartDate={vi.fn()}
          requestedDurationMonths={requestedDuration}
          setRequestedDurationMonths={setRequestedDuration}
          isSubmittingRenewal={false}
          handleSubmitRenewal={handleSubmitRenewalMock}
          onOpenDocModal={vi.fn()}
          handleDownloadDoc={vi.fn()}
          onBack={vi.fn()}
        />
      );

      // 1. Open Renewal bottom sheet
      const openSheetBtn = screen.getByTestId('btn-open-renewal-sheet');
      fireEvent.click(openSheetBtn);

      // 2. Verify toggle between "รายเทอม" and "รายเดือน" exists
      const termToggleBtn = screen.getByRole('button', { name: 'รายเทอม' });
      const monthlyToggleBtn = screen.getByRole('button', { name: 'รายเดือน' });
      expect(termToggleBtn).toBeDefined();
      expect(monthlyToggleBtn).toBeDefined();

      // 3. In Term plan:
      // - Rate label shows /เทอม with room term rent (17,500)
      expect(screen.getByText(/฿17,500 \/เทอม/i)).toBeDefined();

      // - Duration selector options: 1 to 6; option 5 has "(1 เทอม)"
      const durationSelect = document.getElementById('renewalDurationInput') as HTMLSelectElement;
      expect(durationSelect).toBeDefined();
      const termOptions = Array.from(durationSelect.querySelectorAll('option'));
      expect(termOptions.length).toBe(6);
      const option5 = termOptions.find(o => o.value === '5');
      expect(option5?.textContent).toContain('5 เดือน (1 เทอม)');

      // 4. Switch to Monthly plan:
      fireEvent.click(monthlyToggleBtn);
      expect(setRequestedDuration).toHaveBeenCalledWith(1);

      // Re-render with new duration
      rerender(
        <TenantContractView
          tenantContracts={[sampleContract]}
          tenant={sampleTenant}
          tenantRoom={sampleRoom}
          dormitory={sampleDormitory}
          renewalEligibility={{ isEligible: true }}
          requestedStartDate="2026-11-01"
          setRequestedStartDate={vi.fn()}
          requestedDurationMonths={1}
          setRequestedDurationMonths={setRequestedDuration}
          isSubmittingRenewal={false}
          handleSubmitRenewal={handleSubmitRenewalMock}
          onOpenDocModal={vi.fn()}
          handleDownloadDoc={vi.fn()}
          onBack={vi.fn()}
        />
      );

      // - Rate label shows /เดือน with room monthly rent (4,000)
      expect(screen.getByText(/฿4,000 \/เดือน/i)).toBeDefined();

      // - Dropdown shows 1 to 12 months; option 12 has "(1 ปี)"
      const updatedDurationSelect = document.getElementById('renewalDurationInput') as HTMLSelectElement;
      const monthlyOptions = Array.from(updatedDurationSelect.querySelectorAll('option'));
      expect(monthlyOptions.length).toBe(12);
      const option12 = monthlyOptions.find(o => o.value === '12');
      expect(option12?.textContent).toContain('12 เดือน (1 ปี)');

      // - Live summary displays: ยอดรวมค่าเช่า: ฿4,000 (1 เดือน × ฿4,000)
      expect(screen.getByText(/ยอดรวมค่าเช่า: ฿4,000 \(1 เดือน × ฿4,000\)/i)).toBeDefined();
    });
  });
});
