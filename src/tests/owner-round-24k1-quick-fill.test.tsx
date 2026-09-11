// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OwnerMeters } from '../pages/owner/meters';
import { queryKeys } from '../lib/queryClient';

describe('Round 2.4K.1: Multi-Direction Fill, B1 Rejection & Excel Mechanics', () => {
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

  const openSpreadsheet = async () => {
    const dormId = 'dorm-test-24k1';
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

    const quickFillBtn = await screen.findByRole('button', { name: /กรอกแบบรวดเร็ว/ });
    await waitFor(() => expect(quickFillBtn.hasAttribute('disabled')).toBe(false));
    fireEvent.click(quickFillBtn);

    const excelToggleBtn = await screen.findByTitle('สลับไปยังโหมดตาราง Excel');
    fireEvent.click(excelToggleBtn);

    await waitFor(() => {
      expect(screen.getByText('โหมดตาราง สามารถคัดลอก/วาง (Paste) จาก Excel ได้')).toBeDefined();
    });

    const rows = container.querySelectorAll<HTMLTableRowElement>('tr[data-row-index]');
    expect(rows.length).toBe(3);

    // Mock bounding rects for rows and header th elements
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

    const scrollContainer = container.querySelector('.overflow-x-auto.overflow-y-auto') as HTMLElement;
    const ths = scrollContainer.querySelectorAll<HTMLTableCellElement>('thead th');
    ths.forEach((th, idx) => {
      vi.spyOn(th, 'getBoundingClientRect').mockReturnValue({
        top: 60,
        bottom: 100,
        left: idx * 70,
        right: (idx + 1) * 70,
        width: 70,
        height: 40,
        x: idx * 70,
        y: 60,
        toJSON: () => {},
      });
    });

    return { container, rows };
  };

  // =========================================================================
  // Section 4: Normal Rectangular Selection Runtime
  // =========================================================================
  describe('Area 1: Normal Rectangular Drag Selection Runtime', () => {
    it('same-column rectangular drag: pointerDown -> pointerEnter -> selection remains active after pointerUp', async () => {
      const { rows } = await openSpreadsheet();
      // Cell on row 0, elecCurr (col index 3)
      const cell0_3 = rows[0].querySelectorAll('td')[3];
      const cell1_3 = rows[1].querySelectorAll('td')[3];

      // Pointer down on cell 0, 3
      fireEvent.pointerDown(cell0_3);

      // Pointer enters cell 1, 3
      fireEvent.pointerEnter(cell1_3);

      // Global pointer up
      fireEvent.pointerUp(window);

      // Assert both cells remain selected after pointer up
      expect(cell0_3.className).toContain('bg-indigo-50/70');
      expect(cell1_3.className).toContain('bg-indigo-50/70');
    });

    it('multi-column rectangular drag: pointerDown -> pointerEnter on diagonal cell -> selection spans rectangle across columns', async () => {
      const { rows } = await openSpreadsheet();
      // Cell on row 0, elecCurr (col index 3)
      const cell0_3 = rows[0].querySelectorAll('td')[3];
      // Cell on row 1, waterCurr (col index 5)
      const cell1_5 = rows[1].querySelectorAll('td')[5];

      // Drag across both rows and columns (row 0..1, col 3..5)
      fireEvent.pointerDown(cell0_3);
      fireEvent.pointerEnter(cell1_5);
      fireEvent.pointerUp(window);

      // All 6 cells in the rectangle (rows 0..1, cols 3..5) should have selection styling
      for (let r = 0; r <= 1; r++) {
        for (let c = 3; c <= 5; c++) {
          const td = rows[r].querySelectorAll('td')[c];
          expect(td.className).toContain('bg-indigo-50/70');
        }
      }
    });
  });

  // =========================================================================
  // Section 5: Multi-Direction Fill & B1 True Rejection
  // =========================================================================
  describe('Area 2: Multi-Direction Fill & B1 Canonical Rejection', () => {
    it('A. Horizontal fill: drags elecPrev (500) to elecCurr on row 0', async () => {
      const { rows, container } = await openSpreadsheet();
      const row0ElecPrev = rows[0].querySelectorAll('td')[2].querySelector('input')!;
      fireEvent.change(row0ElecPrev, { target: { value: '500' } });
      fireEvent.focus(row0ElecPrev);

      const handle = rows[0].querySelectorAll('td')[2].querySelector('[data-testid="drag-fill-handle"]')!;
      expect(handle).toBeDefined();

      const scrollContainer = container.querySelector('.overflow-x-auto.overflow-y-auto') as HTMLElement;

      // Pointer down on handle
      fireEvent.pointerDown(handle);

      // Move horizontally to col 3 (elecCurr) on row 0: clientX = 240 (inside col 3, [210..280]), clientY = 110 (row 0)
      fireEvent.pointerMove(scrollContainer, { clientX: 240, clientY: 110 });

      // Pointer up commits the fill
      fireEvent.pointerUp(handle);

      // row 0 elecCurr should now be '500'
      const row0ElecCurr = rows[0].querySelectorAll('td')[3].querySelector('input')!;
      expect(row0ElecCurr.value).toBe('500');
    });

    it('B. Vertical fill: drags elecCurr downward across row 0 -> row 2', async () => {
      const { rows, container } = await openSpreadsheet();
      const row0ElecCurr = rows[0].querySelectorAll('td')[3].querySelector('input')!;
      fireEvent.change(row0ElecCurr, { target: { value: '650' } });
      fireEvent.focus(row0ElecCurr);

      const handle = rows[0].querySelectorAll('td')[3].querySelector('[data-testid="drag-fill-handle"]')!;
      const scrollContainer = container.querySelector('.overflow-x-auto.overflow-y-auto') as HTMLElement;

      fireEvent.pointerDown(handle);
      // Move vertically to row 2: clientY = 190 (row 2, [180..220]), clientX = 240 (col 3)
      fireEvent.pointerMove(scrollContainer, { clientX: 240, clientY: 190 });
      fireEvent.pointerUp(handle);

      expect(rows[1].querySelectorAll('td')[3].querySelector('input')!.value).toBe('650');
      expect(rows[2].querySelectorAll('td')[3].querySelector('input')!.value).toBe('650');
    });

    it('C. Diagonal rectangular fill: drags elecCurr diagonally across (rows 0..1, cols 3..4)', async () => {
      const { rows, container } = await openSpreadsheet();
      const row0ElecCurr = rows[0].querySelectorAll('td')[3].querySelector('input')!;
      fireEvent.change(row0ElecCurr, { target: { value: '720' } });
      fireEvent.focus(row0ElecCurr);

      const handle = rows[0].querySelectorAll('td')[3].querySelector('[data-testid="drag-fill-handle"]')!;
      const scrollContainer = container.querySelector('.overflow-x-auto.overflow-y-auto') as HTMLElement;

      fireEvent.pointerDown(handle);
      // Move diagonally to row 1 (clientY = 150) and col 4 (waterPrev, clientX = 300)
      fireEvent.pointerMove(scrollContainer, { clientX: 300, clientY: 150 });
      fireEvent.pointerUp(handle);

      // elecCurr (col 3) and waterPrev (col 4) across rows 0..1 are updated
      expect(rows[0].querySelectorAll('td')[3].querySelector('input')!.value).toBe('720');
      expect(rows[0].querySelectorAll('td')[4].querySelector('input')!.value).toBe('720');
      expect(rows[1].querySelectorAll('td')[3].querySelector('input')!.value).toBe('720');
      expect(rows[1].querySelectorAll('td')[4].querySelector('input')!.value).toBe('720');
    });

    it('D & F. Cross-column B1 rejection & visual error feedback: source meter 500 across peopleCount rejects silently and highlights red', async () => {
      const { rows, container } = await openSpreadsheet();
      // row 0 elecCurr has 500
      const row0ElecCurr = rows[0].querySelectorAll('td')[3].querySelector('input')!;
      fireEvent.change(row0ElecCurr, { target: { value: '500' } });
      fireEvent.focus(row0ElecCurr);

      // Initial peopleCount on row 0 is 1
      const row0PeopleInput = rows[0].querySelectorAll('td')[6].querySelector('input')!;
      expect(row0PeopleInput.value).toBe('1');

      const handle = rows[0].querySelectorAll('td')[3].querySelector('[data-testid="drag-fill-handle"]')!;
      const scrollContainer = container.querySelector('.overflow-x-auto.overflow-y-auto') as HTMLElement;

      fireEvent.pointerDown(handle);
      // Move horizontally across to col 6 (peopleCount, clientX = 450)
      fireEvent.pointerMove(scrollContainer, { clientX: 450, clientY: 110 });
      fireEvent.pointerUp(handle);

      // peopleCount must NOT be clamped to 9 or coerced: must remain 1!
      expect(row0PeopleInput.value).toBe('1');

      // Visual rejected state appears on peopleCount cell
      const peopleCell = rows[0].querySelectorAll('td')[6];
      expect(peopleCell.className).toContain('ring-rose-500');
      expect(peopleCell.className).toContain('bg-rose-50');
    });

    it('E. Building and Room remain strictly immutable after fill', async () => {
      const { rows, container } = await openSpreadsheet();
      const row0ElecCurr = rows[0].querySelectorAll('td')[3].querySelector('input')!;
      fireEvent.change(row0ElecCurr, { target: { value: '999' } });
      fireEvent.focus(row0ElecCurr);

      const handle = rows[0].querySelectorAll('td')[3].querySelector('[data-testid="drag-fill-handle"]')!;
      const scrollContainer = container.querySelector('.overflow-x-auto.overflow-y-auto') as HTMLElement;

      fireEvent.pointerDown(handle);
      // Attempt to drag all the way to col 0 (Building) and row 2
      fireEvent.pointerMove(scrollContainer, { clientX: 30, clientY: 190 });
      fireEvent.pointerUp(handle);

      // Building and Room cells must remain exactly as originally rendered
      expect(rows[0].querySelectorAll('td')[0].textContent?.trim()).toBe('A');
      expect(rows[0].querySelectorAll('td')[1].textContent?.trim()).toBe('101');
      expect(rows[1].querySelectorAll('td')[0].textContent?.trim()).toBe('A');
      expect(rows[1].querySelectorAll('td')[1].textContent?.trim()).toBe('102');
      expect(rows[2].querySelectorAll('td')[0].textContent?.trim()).toBe('A');
      expect(rows[2].querySelectorAll('td')[1].textContent?.trim()).toBe('103');
    });

    it('G. Ctrl+C copies TSV representation of selected range to clipboard', async () => {
      const { rows } = await openSpreadsheet();
      const writeTextSpy = vi.fn();
      Object.assign(navigator, {
        clipboard: { writeText: writeTextSpy },
      });

      // Select range row 0..1, col 2..3
      fireEvent.pointerDown(rows[0].querySelectorAll('td')[2]);
      fireEvent.pointerEnter(rows[1].querySelectorAll('td')[3]);
      fireEvent.pointerUp(window);

      // Press Ctrl+C
      fireEvent.keyDown(window, { key: 'c', ctrlKey: true });

      expect(writeTextSpy).toHaveBeenCalledTimes(1);
      const copiedStr = writeTextSpy.mock.calls[0][0];
      expect(typeof copiedStr).toBe('string');
      // Contains tab-separated values across lines
      expect(copiedStr).toContain('\t');
    });

    it('H. Delete / Backspace clears editable cells in selection without altering Building or Room', async () => {
      const { rows } = await openSpreadsheet();
      const row0ElecInput = rows[0].querySelectorAll('td')[3].querySelector('input')!;
      fireEvent.change(row0ElecInput, { target: { value: '888' } });
      expect(row0ElecInput.value).toBe('888');

      // Select row 0 across all columns (col 0 to 6)
      fireEvent.pointerDown(rows[0].querySelectorAll('td')[0]);
      fireEvent.pointerEnter(rows[0].querySelectorAll('td')[6]);
      fireEvent.pointerUp(window);

      // Blur any active input so Delete key fires on table
      (document.activeElement as HTMLElement)?.blur?.();

      // Press Delete key
      fireEvent.keyDown(window, { key: 'Delete' });

      // Editable cells cleared
      expect(row0ElecInput.value).toBe('');

      // Building and Room strictly unchanged
      expect(rows[0].querySelectorAll('td')[0].textContent?.trim()).toBe('A');
      expect(rows[0].querySelectorAll('td')[1].textContent?.trim()).toBe('101');
    });

    it('I. External Excel Mode-B paste: matches by building and room, enforces B1 validation', async () => {
      const { rows, container } = await openSpreadsheet();
      const gridContainer = container.querySelector('.flex.flex-col.gap-2.h-\\[340px\\]') as HTMLElement;

      // Ensure no cell is active
      fireEvent.keyDown(window, { key: 'Escape' });

      // External Mode-B TSV: Building \t Room \t elecPrev \t elecCurr \t waterPrev \t waterCurr \t peopleCount
      const pasteText = 'A\t102\t0120\t0580\t0050\t0090\t3';
      fireEvent.paste(gridContainer, {
        clipboardData: {
          getData: (format: string) => (format === 'text' ? pasteText : ''),
        },
      });

      // Row 1 (Room 102) updated with B1-normalized values
      const row1Cells = rows[1].querySelectorAll('td');
      expect(row1Cells[2].querySelector('input')!.value).toBe('120');
      expect(row1Cells[3].querySelector('input')!.value).toBe('580');
      expect(row1Cells[4].querySelector('input')!.value).toBe('50');
      expect(row1Cells[5].querySelector('input')!.value).toBe('90');
      expect(row1Cells[6].querySelector('input')!.value).toBe('3');

      // Building and Room unchanged
      expect(row1Cells[0].textContent?.trim()).toBe('A');
      expect(row1Cells[1].textContent?.trim()).toBe('102');
    });
  });
});
