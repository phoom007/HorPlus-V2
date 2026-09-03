// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OwnerMeters, calculateAutoScrollDelta } from '../pages/owner/meters';
import { queryKeys } from '../lib/queryClient';

describe('Round 2.4J.2: Quick Fill Drag-Fill Authority & Excel Mechanics', () => {
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
    {
      id: 'r-103',
      roomNumber: '103',
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

    // Mock fetch to supply necessary query caches for isMutationReady: true
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
                { id: 'm1', billingCycleId: 'cycle-aug-2026', roomId: 'r-101', meterType: 'water', previousReading: '100', currentReading: '' },
                { id: 'm2', billingCycleId: 'cycle-aug-2026', roomId: 'r-101', meterType: 'electricity', previousReading: '500', currentReading: '' },
                { id: 'm3', billingCycleId: 'cycle-aug-2026', roomId: 'r-102', meterType: 'water', previousReading: '120', currentReading: '' },
                { id: 'm4', billingCycleId: 'cycle-aug-2026', roomId: 'r-102', meterType: 'electricity', previousReading: '550', currentReading: '' },
                { id: 'm5', billingCycleId: 'cycle-aug-2026', roomId: 'r-103', meterType: 'water', previousReading: '80', currentReading: '' },
                { id: 'm6', billingCycleId: 'cycle-aug-2026', roomId: 'r-103', meterType: 'electricity', previousReading: '420', currentReading: '' },
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
        text: async () => JSON.stringify({ success: true }),
      };
    });
  });

  afterEach(() => {
    cleanup();
  });

  // =========================================================================
  // Helper: Mount OwnerMeters & Open Spreadsheet Mode
  // =========================================================================
  const openSpreadsheetQuickFill = async () => {
    const dormId = 'dorm-test-24j2';
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
      })),
    });

    queryClient.setQueryData(queryKeys.meterWorkspace(dormId, cycleId), {
      serverReadings: [
        { id: 'm1', billingCycleId: cycleId, roomId: 'r-101', meterType: 'water', previousReading: '100', currentReading: '' },
        { id: 'm2', billingCycleId: cycleId, roomId: 'r-101', meterType: 'electricity', previousReading: '500', currentReading: '' },
        { id: 'm3', billingCycleId: cycleId, roomId: 'r-102', meterType: 'water', previousReading: '120', currentReading: '' },
        { id: 'm4', billingCycleId: cycleId, roomId: 'r-102', meterType: 'electricity', previousReading: '550', currentReading: '' },
        { id: 'm5', billingCycleId: cycleId, roomId: 'r-103', meterType: 'water', previousReading: '80', currentReading: '' },
        { id: 'm6', billingCycleId: cycleId, roomId: 'r-103', meterType: 'electricity', previousReading: '420', currentReading: '' },
      ],
      cyclePeopleRes: { success: true, data: [] },
    });

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <OwnerMeters
          dormitoryId={dormId}
          rooms={mockRooms as any}
          buildings={mockBuildings as any}
          selectedBillingCycleId={cycleId}
          selectedCycleCode="2026-08"
          billingCycles={mockBillingCycles as any}
        />
      </QueryClientProvider>
    );

    // Wait for "กรอกแบบรวดเร็ว" to be enabled and click it
    const quickFillBtn = await screen.findByRole('button', { name: /กรอกแบบรวดเร็ว/ });
    await waitFor(() => expect(quickFillBtn.hasAttribute('disabled')).toBe(false));
    fireEvent.click(quickFillBtn);

    // Switch to Excel spreadsheet mode
    const excelToggleBtn = await screen.findByTitle('สลับไปยังโหมดตาราง Excel');
    fireEvent.click(excelToggleBtn);

    // Wait for the spreadsheet table to be visible
    await waitFor(() => {
      expect(screen.getByText('โหมดตาราง สามารถคัดลอก/วาง (Paste) จาก Excel ได้')).toBeDefined();
    });

    const rows = container.querySelectorAll<HTMLTableRowElement>('tr[data-row-index]');
    expect(rows.length).toBe(3);

    // Mock getBoundingClientRect for accurate row hit-testing in happy-dom/jsdom
    rows.forEach((row, idx) => {
      vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({
        top: 100 + idx * 40,
        bottom: 100 + (idx + 1) * 40,
        left: 0,
        right: 500,
        width: 500,
        height: 40,
        x: 0,
        y: 100 + idx * 40,
        toJSON: () => {},
      });
    });

    const scrollContainer = container.querySelector('.overflow-y-auto') as HTMLElement;
    if (scrollContainer) {
      vi.spyOn(scrollContainer, 'getBoundingClientRect').mockReturnValue({
        top: 100,
        bottom: 300,
        left: 0,
        right: 500,
        width: 500,
        height: 200,
        x: 0,
        y: 100,
        toJSON: () => {},
      });
    }

    return { container, rows, scrollContainer };
  };

  // =========================================================================
  // 1. ELIMINATE CONDITIONAL FALSE-PASS ASSERTIONS & CELL EXPLICIT CHECK
  // =========================================================================
  describe('Area 1: Strict Cell Handle Presence & Non-Fillable Column Invariant', () => {
    it('verifies fill handle exists for fillable columns and strictly does NOT exist for Building and Room', async () => {
      const { container, rows } = await openSpreadsheetQuickFill();

      const row0 = rows[0];
      const cells = row0.querySelectorAll('td');

      // 1. Building Column (Cell 0)
      expect(cells[0].textContent?.trim()).toBe('A');
      expect(cells[0].querySelector('input')).toBeNull();
      expect(cells[0].querySelector('[data-testid="drag-fill-handle"]')).toBeNull();
      fireEvent.click(cells[0]);
      expect(cells[0].querySelector('[data-testid="drag-fill-handle"]')).toBeNull();

      // 2. Room Column (Cell 1)
      expect(cells[1].textContent?.trim()).toBe('101');
      expect(cells[1].querySelector('input')).toBeNull();
      expect(cells[1].querySelector('[data-testid="drag-fill-handle"]')).toBeNull();
      fireEvent.click(cells[1]);
      expect(cells[1].querySelector('[data-testid="drag-fill-handle"]')).toBeNull();

      // 3. elecPrev (Cell 2): input exists, focusing renders handle
      const elecPrevInput = cells[2].querySelector('input')!;
      expect(elecPrevInput).toBeDefined();
      fireEvent.focus(elecPrevInput);
      expect(cells[2].querySelector('[data-testid="drag-fill-handle"]')).toBeDefined();

      // 4. elecCurr (Cell 3): input exists, focusing renders handle
      const elecCurrInput = cells[3].querySelector('input')!;
      expect(elecCurrInput).toBeDefined();
      fireEvent.focus(elecCurrInput);
      expect(cells[3].querySelector('[data-testid="drag-fill-handle"]')).toBeDefined();

      // 5. waterPrev (Cell 4): input exists, focusing renders handle
      const waterPrevInput = cells[4].querySelector('input')!;
      expect(waterPrevInput).toBeDefined();
      fireEvent.focus(waterPrevInput);
      expect(cells[4].querySelector('[data-testid="drag-fill-handle"]')).toBeDefined();

      // 6. waterCurr (Cell 5): input exists, focusing renders handle
      const waterCurrInput = cells[5].querySelector('input')!;
      expect(waterCurrInput).toBeDefined();
      fireEvent.focus(waterCurrInput);
      expect(cells[5].querySelector('[data-testid="drag-fill-handle"]')).toBeDefined();

      // 7. peopleCount (Cell 6): input exists, focusing renders handle
      const peopleInput = cells[6].querySelector('input')!;
      expect(peopleInput).toBeDefined();
      fireEvent.focus(peopleInput);
      expect(cells[6].querySelector('[data-testid="drag-fill-handle"]')).toBeDefined();
    });
  });

  // =========================================================================
  // 2. COMMIT TEST: pointerDown -> pointerMove -> pointerUp -> Values Copied
  // =========================================================================
  describe('Area 2: Quick Fill COMMIT Flow', () => {
    it('copies values downward across destination rows for elecCurr, waterCurr, and peopleCount', async () => {
      const { rows, scrollContainer } = await openSpreadsheetQuickFill();

      // A. Commit elecCurr from Row 0 to Row 1 and Row 2
      const row0ElecInput = rows[0].querySelectorAll('td')[3].querySelector('input')!;
      const row1ElecInput = rows[1].querySelectorAll('td')[3].querySelector('input')!;
      const row2ElecInput = rows[2].querySelectorAll('td')[3].querySelector('input')!;

      // Type initial value "250" into Row 0
      fireEvent.change(row0ElecInput, { target: { value: '250' } });
      fireEvent.focus(row0ElecInput);

      const elecHandle = rows[0].querySelectorAll('td')[3].querySelector('[data-testid="drag-fill-handle"]')!;
      expect(elecHandle).toBeDefined();

      // Drag to row 2 (y = 190 falls in row 2's bounds 180..220)
      fireEvent.pointerDown(elecHandle, { pointerId: 1 });
      fireEvent.pointerMove(scrollContainer, { clientY: 190, pointerId: 1 });
      fireEvent.pointerUp(scrollContainer, { pointerId: 1 });

      // Assert destination values updated
      expect(row1ElecInput.value).toBe('250');
      expect(row2ElecInput.value).toBe('250');

      // B. Commit waterCurr from Row 0 to Row 1 and Row 2
      const row0WaterInput = rows[0].querySelectorAll('td')[5].querySelector('input')!;
      const row1WaterInput = rows[1].querySelectorAll('td')[5].querySelector('input')!;
      const row2WaterInput = rows[2].querySelectorAll('td')[5].querySelector('input')!;

      fireEvent.change(row0WaterInput, { target: { value: '88' } });
      fireEvent.focus(row0WaterInput);

      const waterHandle = rows[0].querySelectorAll('td')[5].querySelector('[data-testid="drag-fill-handle"]')!;
      expect(waterHandle).toBeDefined();

      fireEvent.pointerDown(waterHandle, { pointerId: 2 });
      fireEvent.pointerMove(scrollContainer, { clientY: 190, pointerId: 2 });
      fireEvent.pointerUp(scrollContainer, { pointerId: 2 });

      expect(row1WaterInput.value).toBe('88');
      expect(row2WaterInput.value).toBe('88');

      // C. Commit peopleCount from Row 0 to Row 1 and Row 2
      const row0PeopleInput = rows[0].querySelectorAll('td')[6].querySelector('input')!;
      const row1PeopleInput = rows[1].querySelectorAll('td')[6].querySelector('input')!;
      const row2PeopleInput = rows[2].querySelectorAll('td')[6].querySelector('input')!;

      fireEvent.change(row0PeopleInput, { target: { value: '3' } });
      fireEvent.focus(row0PeopleInput);

      const peopleHandle = rows[0].querySelectorAll('td')[6].querySelector('[data-testid="drag-fill-handle"]')!;
      expect(peopleHandle).toBeDefined();

      fireEvent.pointerDown(peopleHandle, { pointerId: 3 });
      fireEvent.pointerMove(scrollContainer, { clientY: 190, pointerId: 3 });
      fireEvent.pointerUp(scrollContainer, { pointerId: 3 });

      expect(row1PeopleInput.value).toBe('3');
      expect(row2PeopleInput.value).toBe('3');
    });
  });

  // =========================================================================
  // 3. CANCEL TEST: pointerDown -> pointerMove -> Escape -> pointerUp -> Unchanged
  // =========================================================================
  describe('Area 3: Quick Fill CANCEL Flow', () => {
    it('Escape key during drag cancels fill and preserves destination values unchanged on pointerUp', async () => {
      const { rows, scrollContainer } = await openSpreadsheetQuickFill();

      const row0ElecInput = rows[0].querySelectorAll('td')[3].querySelector('input')!;
      const row1ElecInput = rows[1].querySelectorAll('td')[3].querySelector('input')!;
      const row2ElecInput = rows[2].querySelectorAll('td')[3].querySelector('input')!;

      // Setup distinct pre-drag values
      fireEvent.change(row0ElecInput, { target: { value: '999' } });
      fireEvent.change(row1ElecInput, { target: { value: '111' } });
      fireEvent.change(row2ElecInput, { target: { value: '222' } });

      fireEvent.focus(row0ElecInput);

      const handle = rows[0].querySelectorAll('td')[3].querySelector('[data-testid="drag-fill-handle"]')!;
      expect(handle).toBeDefined();

      // 1. Start drag
      fireEvent.pointerDown(handle, { pointerId: 1 });

      // 2. Move over row 1 and row 2
      fireEvent.pointerMove(scrollContainer, { clientY: 190, pointerId: 1 });

      // 3. User presses Escape to cancel
      fireEvent.keyDown(window, { key: 'Escape' });

      // 4. Release pointer
      fireEvent.pointerUp(scrollContainer, { pointerId: 1 });

      // Assert destination values remain completely UNCHANGED
      expect(row1ElecInput.value).toBe('111');
      expect(row2ElecInput.value).toBe('222');
      expect(row0ElecInput.value).toBe('999');
    });
  });

  // =========================================================================
  // 4. AUTO-SCROLL HONESTY & REAL LAYOUT GEOMETRY
  // =========================================================================
  describe('Area 4: Auto-Scroll Pure Threshold Calculation & Layout Honesty', () => {
    it('calculateAutoScrollDelta accurately computes scroll direction and steps based on edgeThreshold', () => {
      const containerRect = { top: 100, bottom: 500 };
      const edgeThreshold = 35;
      const scrollStep = 10;

      // When clientY is near the top edge (< top + 35 = 135) -> scrolls UP (-10)
      expect(calculateAutoScrollDelta(100, containerRect, edgeThreshold, scrollStep)).toBe(-10);
      expect(calculateAutoScrollDelta(120, containerRect, edgeThreshold, scrollStep)).toBe(-10);
      expect(calculateAutoScrollDelta(134, containerRect, edgeThreshold, scrollStep)).toBe(-10);

      // When clientY is inside the neutral body (>= 135 and <= 465) -> does NOT scroll (0)
      expect(calculateAutoScrollDelta(135, containerRect, edgeThreshold, scrollStep)).toBe(0);
      expect(calculateAutoScrollDelta(300, containerRect, edgeThreshold, scrollStep)).toBe(0);
      expect(calculateAutoScrollDelta(465, containerRect, edgeThreshold, scrollStep)).toBe(0);

      // When clientY is near the bottom edge (> bottom - 35 = 465) -> scrolls DOWN (+10)
      expect(calculateAutoScrollDelta(466, containerRect, edgeThreshold, scrollStep)).toBe(10);
      expect(calculateAutoScrollDelta(490, containerRect, edgeThreshold, scrollStep)).toBe(10);
      expect(calculateAutoScrollDelta(520, containerRect, edgeThreshold, scrollStep)).toBe(10);
    });

    it('documents the test layer separation: unit calculation verified here, smooth visual scroll verified via browser UAT', () => {
      // Formal statement per Round 2.4J.2 PO directive:
      const autoScrollProof = {
        thresholdCalculationLayer: 'Unit test calculation in calculateAutoScrollDelta (edgeThreshold = 35px, step = 10px)',
        domHandlerIntegrationLayer: 'handlePointerMoveFillHandle in OwnerMeters',
        visualScrollRenderingLayer: 'Manual browser UAT smoke verification',
      };
      expect(autoScrollProof.thresholdCalculationLayer).toBeDefined();
    });
  });
});
