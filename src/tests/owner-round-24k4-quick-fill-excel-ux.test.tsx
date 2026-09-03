// @vitest-environment jsdom
/**
 * @license Apache-2.0
 * OWNER ROUND 2.4K.4: Quick Fill Excel UX, Option B People Count Semantics & Performance Test Suite
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OwnerMeters } from '../pages/owner/meters';
import { queryKeys } from '../lib/queryClient';
import { serializeMeterWorkspaceDirtyRow } from '../utils/meter-serializer';

describe('Owner Round 2.4K.4 — Quick Fill Excel Range Delete & Option B Semantics (Section 31)', () => {
  let queryClient: QueryClient;

  const mockRooms = [
    {
      id: 'r-101',
      roomNumber: '101',
      buildingId: 'b-1',
      buildingName: 'อาคาร A',
      buildingCode: 'A',
      floor: 1,
      status: 'occupied',
      monthlyRent: 3500,
    },
    {
      id: 'r-102',
      roomNumber: '102',
      buildingId: 'b-1',
      buildingName: 'อาคาร A',
      buildingCode: 'A',
      floor: 1,
      status: 'occupied',
      monthlyRent: 3500,
    },
  ];

  const mockBuildings = [{ id: 'b-1', name: 'อาคาร A' }];

  const mockBillingCycles = [
    {
      id: 'cycle-aug-2026',
      cycleCode: '2026-08',
      name: 'สิงหาคม 2569',
      status: 'open',
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
    },
  ];

  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();

    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
      },
    });

    global.fetch = vi.fn().mockImplementation(async (url: string | URL) => {
      const urlStr = url.toString();
      if (urlStr.includes('/billing-cycles')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({
            success: true,
            data: mockBillingCycles,
            firstBillingCycleId: 'cycle-aug-2026',
            operationalBillingCycleId: 'cycle-aug-2026',
            operationalCycleCode: '2026-08',
          }),
          text: async () => JSON.stringify({ success: true, data: mockBillingCycles }),
        };
      }
      if (urlStr.includes('/preview-context')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({
            success: true,
            data: {
              rateSnapshot: {
                waterBillingType: 'per_unit',
                waterRate: '18.00',
                electricityBillingType: 'per_unit',
                electricityRate: '8.00',
                commonFee: '0.00',
                commonFeeMode: 'free',
              },
              rooms: mockRooms.map((r) => ({
                roomId: r.id,
                amountDue: '0.00',
                chargeComponents: [],
              })),
            },
          }),
          text: async () => JSON.stringify({ success: true }),
        };
      }
      if (urlStr.includes('/meters/readings') || urlStr.includes('/meter-readings/workspace')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({
            success: true,
            data: {
              serverReadings: [
                { id: 'm1', billingCycleId: 'cycle-aug-2026', roomId: 'r-101', meterType: 'water', previousReading: '100', currentReading: '110' },
                { id: 'm2', billingCycleId: 'cycle-aug-2026', roomId: 'r-101', meterType: 'electricity', previousReading: '500', currentReading: '550' },
                { id: 'm3', billingCycleId: 'cycle-aug-2026', roomId: 'r-102', meterType: 'water', previousReading: '200', currentReading: '220' },
                { id: 'm4', billingCycleId: 'cycle-aug-2026', roomId: 'r-102', meterType: 'electricity', previousReading: '600', currentReading: '660' },
              ],
            },
          }),
          text: async () => JSON.stringify({ success: true }),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ success: true, data: [] }),
        text: async () => JSON.stringify({ success: true, data: [] }),
      };
    });
  });

  afterEach(() => {
    cleanup();
  });

  // =========================================================================
  // 1. SERIALIZER FAIL CLOSED ON BLANK PEOPLE COUNT (Option B)
  // =========================================================================
  it('A. Serializer fails closed with clear Thai error if peopleCount is blank string', () => {
    // Valid peopleCount: positive integer
    const valid = serializeMeterWorkspaceDirtyRow({
      roomId: 'r-101',
      peopleCount: 2,
    });
    expect(valid.peopleCount).toBe(2);

    // Valid peopleCount: zero
    const validZero = serializeMeterWorkspaceDirtyRow({
      roomId: 'r-101',
      peopleCount: 0,
    });
    expect(validZero.peopleCount).toBe(0);

    // Option B: Blank string MUST fail closed and NOT coerce to 0
    expect(() => {
      serializeMeterWorkspaceDirtyRow({
        roomId: 'r-101',
        peopleCount: '',
      });
    }).toThrow('กรุณาระบุจำนวนผู้พักอาศัยก่อนบันทึก');

    // Whitespace string also fails closed
    expect(() => {
      serializeMeterWorkspaceDirtyRow({
        roomId: 'r-101',
        peopleCount: '   ',
      });
    }).toThrow('กรุณาระบุจำนวนผู้พักอาศัยก่อนบันทึก');
  });

  const setupSpreadsheetMode = async () => {
    const dormId = 'dorm-test-01';
    const cycleId = 'cycle-aug-2026';

    queryClient.setQueryData(queryKeys.meterPreviewContext(dormId, cycleId), {
      rateSnapshot: {
        waterBillingType: 'per_unit',
        waterRate: '18.00',
        electricityBillingType: 'per_unit',
        electricityRate: '8.00',
        commonFee: '0.00',
        commonFeeMode: 'free',
      },
      rooms: mockRooms.map((r) => ({
        roomId: r.id,
        amountDue: '0.00',
        chargeComponents: [],
        isPaid: false,
        billStatus: 'draft',
        overallFinancialStatus: 'draft',
      })),
    });

    queryClient.setQueryData(queryKeys.meterWorkspace(dormId, cycleId), {
      serverReadings: [
        { id: 'm1', billingCycleId: cycleId, roomId: 'r-101', meterType: 'water', previousReading: '100', currentReading: '110' },
        { id: 'm2', billingCycleId: cycleId, roomId: 'r-101', meterType: 'electricity', previousReading: '500', currentReading: '550' },
        { id: 'm3', billingCycleId: cycleId, roomId: 'r-102', meterType: 'water', previousReading: '200', currentReading: '220' },
        { id: 'm4', billingCycleId: cycleId, roomId: 'r-102', meterType: 'electricity', previousReading: '600', currentReading: '660' },
      ],
    });

    render(
      <QueryClientProvider client={queryClient}>
        <OwnerMeters
          dormitoryId={dormId}
          dormitoryName="หอพัก สุขใจ"
          rooms={mockRooms as any}
          buildings={mockBuildings as any}
          billingCycles={mockBillingCycles as any}
          currentCycle={mockBillingCycles[0] as any}
          selectedBillingCycleId={cycleId}
          selectedCycleCode="2026-08"
        />
      </QueryClientProvider>
    );

    // Open Quick Fill modal
    const quickFillBtn = await screen.findByRole('button', { name: /กรอกแบบรวดเร็ว/ });
    await waitFor(() => expect(quickFillBtn.hasAttribute('disabled')).toBe(false));
    fireEvent.click(quickFillBtn);

    // Switch to Excel spreadsheet mode
    const excelToggleBtn = await screen.findByTitle('สลับไปยังโหมดตาราง Excel');
    fireEvent.click(excelToggleBtn);

    await waitFor(() => {
      expect(screen.getByText('โหมดตาราง สามารถคัดลอก/วาง (Paste) จาก Excel ได้')).toBeDefined();
    });
  };

  // =========================================================================
  // 2. RANGE DELETE CLEARS CELLS TO BLANK, EVEN WITH INPUT FOCUSED
  // =========================================================================
  it('B. Range delete clears all editable cells in selected range to blank string, including peopleCount (NOT 0)', async () => {
    await setupSpreadsheetMode();

    // Select range: pointerDown on (row 0, elecCurr) -> pointerEnter on (row 1, peopleCount)
    const startCell = document.querySelector('td[data-cell-row="0"][data-cell-col="elecCurr"]') as HTMLElement;
    const endCell = document.querySelector('td[data-cell-row="1"][data-cell-col="peopleCount"]') as HTMLElement;
    expect(startCell).toBeDefined();
    expect(endCell).toBeDefined();

    fireEvent.pointerDown(startCell);
    fireEvent.pointerEnter(endCell);

    // Focus an input inside the table to simulate user having active focus on an input tag
    const innerInput = startCell.querySelector('input');
    if (innerInput) {
      innerInput.focus();
    }

    // Press Delete key
    fireEvent.keyDown(window, { key: 'Delete', code: 'Delete' });

    // Assert: editable cells in range are cleared to blank
    const r0ElecInput = document.querySelector('td[data-cell-row="0"][data-cell-col="elecCurr"] input') as HTMLInputElement;
    const r1PeopleInput = document.querySelector('td[data-cell-row="1"][data-cell-col="peopleCount"] input') as HTMLInputElement;

    expect(r0ElecInput.value).toBe('');
    // MANDATORY OPTION B INVARIANT: peopleCount is blank '', NOT 0!
    expect(r1PeopleInput.value).toBe('');
  });

  // =========================================================================
  // 3. OPTION B: SAVE / ISSUE BILL FAILS CLOSED ON BLANK PEOPLE COUNT
  // =========================================================================
  it('C. When peopleCount is blank in spreadsheet, Save Meter button blocks and shows validation error', async () => {
    await setupSpreadsheetMode();

    // Set peopleCount of room 101 to blank
    const peopleInput = document.querySelector('td[data-cell-row="0"][data-cell-col="peopleCount"] input') as HTMLInputElement;
    fireEvent.change(peopleInput, { target: { value: '' } });

    // Click Save button in modal
    const saveBtn = screen.getByRole('button', { name: /บันทึกข้อมูล/i });
    fireEvent.click(saveBtn);

    // Assert Thai fail-closed validation message appears
    await waitFor(() => {
      expect(screen.getByText(/กรุณาระบุจำนวนผู้พักอาศัยห้อง 101 ก่อนบันทึก/i)).toBeDefined();
    });
  });
});
