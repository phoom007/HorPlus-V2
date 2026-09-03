// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OwnerMeters } from '../pages/owner/meters';
import { queryKeys } from '../lib/queryClient';

describe('Round 2.4K.2: Meter Spreadsheet Domain Authority & Quick Fill Validation (Cases A–G)', () => {
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
    {
      id: 'r-104',
      roomNumber: '104',
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
                { id: 'm3', billingCycleId: 'cycle-aug-2026', roomId: 'r-102', meterType: 'water', previousReading: '99950', currentReading: '' },
                { id: 'm4', billingCycleId: 'cycle-aug-2026', roomId: 'r-102', meterType: 'electricity', previousReading: '9950', currentReading: '' },
                { id: 'm5', billingCycleId: 'cycle-aug-2026', roomId: 'r-103', meterType: 'water', previousReading: '80', currentReading: '80' },
                { id: 'm6', billingCycleId: 'cycle-aug-2026', roomId: 'r-103', meterType: 'electricity', previousReading: '420', currentReading: '420' },
                { id: 'm7', billingCycleId: 'cycle-aug-2026', roomId: 'r-104', meterType: 'water', previousReading: '300', currentReading: '' },
                { id: 'm8', billingCycleId: 'cycle-aug-2026', roomId: 'r-104', meterType: 'electricity', previousReading: '800', currentReading: '' },
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

  const openSpreadsheet = async (customServerReadings?: any[], lockedRoomIds: string[] = []) => {
    const dormId = 'dorm-test-24k2';
    const cycleId = 'cycle-aug-2026';

    const roomPreviewItems = mockRooms.map((r) => ({
      roomId: r.id,
      amountDue: '0.00',
      chargeComponents: [],
      isPaid: lockedRoomIds.includes(r.id),
      billStatus: lockedRoomIds.includes(r.id) ? 'paid' : 'draft',
      overallFinancialStatus: lockedRoomIds.includes(r.id) ? 'paid' : 'draft',
    }));

    queryClient.setQueryData(queryKeys.meterPreviewContext(dormId, cycleId), {
      rateSnapshot: {
        waterBillingType: 'per_unit',
        waterRate: '18.00',
        electricityBillingType: 'per_unit',
        electricityRate: '8.00',
        commonFee: '0.00',
        commonFeeMode: 'free',
      },
      rooms: roomPreviewItems,
    });

    queryClient.setQueryData(queryKeys.meterWorkspace(dormId, cycleId), {
      serverReadings: customServerReadings || [
        { id: 'm1', billingCycleId: cycleId, roomId: 'r-101', meterType: 'water', previousReading: '100', currentReading: '' },
        { id: 'm2', billingCycleId: cycleId, roomId: 'r-101', meterType: 'electricity', previousReading: '500', currentReading: '' },
        { id: 'm3', billingCycleId: cycleId, roomId: 'r-102', meterType: 'water', previousReading: '99950', currentReading: '' },
        { id: 'm4', billingCycleId: cycleId, roomId: 'r-102', meterType: 'electricity', previousReading: '9950', currentReading: '' },
        { id: 'm5', billingCycleId: cycleId, roomId: 'r-103', meterType: 'water', previousReading: '80', currentReading: '80' },
        { id: 'm6', billingCycleId: cycleId, roomId: 'r-103', meterType: 'electricity', previousReading: '420', currentReading: '420' },
        { id: 'm7', billingCycleId: cycleId, roomId: 'r-104', meterType: 'water', previousReading: '300', currentReading: '' },
        { id: 'm8', billingCycleId: cycleId, roomId: 'r-104', meterType: 'electricity', previousReading: '800', currentReading: '' },
      ],
      rooms: roomPreviewItems,
      previewContext: {
        rooms: roomPreviewItems,
      },
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
    expect(rows.length).toBe(4);

    return { container, rows };
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Case A: Normal progressive entry (e.g. prev 500 -> curr 550)
  // ─────────────────────────────────────────────────────────────────────────
  it('Case A: Normal progressive reading is accepted without rejection border', async () => {
    const { rows } = await openSpreadsheet();
    // Row 0, elecCurr (col index 3)
    const elecCurrCell = rows[0].querySelectorAll('td')[3];
    const input = elecCurrCell.querySelector('input')!;

    // Previous reading is 500. Enter 550 (progressive).
    fireEvent.change(input, { target: { value: '550' } });

    expect(input.value).toBe('550');
    expect(elecCurrCell.classList.contains('ring-rose-500')).toBe(false);
    expect(elecCurrCell.classList.contains('bg-rose-50')).toBe(false);
    expect(elecCurrCell.getAttribute('title')).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Case B: Valid 5-digit rollover (prev 99950 -> curr 20)
  // ─────────────────────────────────────────────────────────────────────────
  it('Case B: Valid 5-digit rollover (99950 -> 20) is accepted by canonical rules', async () => {
    const { rows } = await openSpreadsheet();
    // Row 1: room 102 has waterPrev = 99950. Col index 4 is waterPrev, Col index 5 is waterCurr.
    const waterPrevCell = rows[1].querySelectorAll('td')[4];
    expect(waterPrevCell.querySelector('input')!.value).toBe('99950');

    const waterCurrCell = rows[1].querySelectorAll('td')[5];
    const input = waterCurrCell.querySelector('input')!;

    // Enter 20 (valid 5-digit rollover: 99900 < 99950 <= 99999 and 20 < 200)
    fireEvent.change(input, { target: { value: '20' } });

    expect(input.value).toBe('20');
    expect(waterCurrCell.classList.contains('ring-rose-500')).toBe(false);
    expect(waterCurrCell.classList.contains('bg-rose-50')).toBe(false);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Case C: Valid 4-digit rollover (prev 9950 -> curr 20)
  // ─────────────────────────────────────────────────────────────────────────
  it('Case C: Valid 4-digit rollover (9950 -> 20) is accepted by canonical rules', async () => {
    const { rows } = await openSpreadsheet();
    // Row 1: room 102 has elecPrev = 9950. Col index 2 is elecPrev, Col index 3 is elecCurr.
    const elecPrevCell = rows[1].querySelectorAll('td')[2];
    expect(elecPrevCell.querySelector('input')!.value).toBe('9950');

    const elecCurrCell = rows[1].querySelectorAll('td')[3];
    const input = elecCurrCell.querySelector('input')!;

    // Enter 20 (valid 4-digit rollover: 9900 < 9950 <= 9999 and 20 < 200)
    fireEvent.change(input, { target: { value: '20' } });

    expect(input.value).toBe('20');
    expect(elecCurrCell.classList.contains('ring-rose-500')).toBe(false);
    expect(elecCurrCell.classList.contains('bg-rose-50')).toBe(false);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Case D: Invalid lower reading (prev 500 -> curr 400) rejected with red border & Thai msg
  // ─────────────────────────────────────────────────────────────────────────
  it('Case D: Invalid lower reading (500 -> 400) is rejected with red border and clear Thai error message', async () => {
    const { rows } = await openSpreadsheet();
    const elecCurrCell = rows[0].querySelectorAll('td')[3];
    const input = elecCurrCell.querySelector('input')!;

    // Previous is 500. Enter 400 (lower without valid rollover condition).
    fireEvent.change(input, { target: { value: '400' } });

    // Preserves input, does NOT silently coerce
    expect(input.value).toBe('400');
    // Visual feedback: red ring and background
    expect(elecCurrCell.classList.contains('ring-rose-500')).toBe(true);
    expect(elecCurrCell.classList.contains('bg-rose-50')).toBe(true);
    // Canonical Thai message
    const title = elecCurrCell.getAttribute('title');
    expect(title).toContain('ต้องไม่น้อยกว่าค่ามิเตอร์เดิม');
    expect(title).toContain('500');
    expect(title).toContain('400');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Case E: Non-numeric, negative, decimal, and >99999 rejected with red border
  // ─────────────────────────────────────────────────────────────────────────
  it('Case E: Non-numeric, negative, decimal, and >99999 are rejected with red border without silent coercion', async () => {
    const { rows } = await openSpreadsheet();
    const elecCurrCell = rows[0].querySelectorAll('td')[3];
    const input = elecCurrCell.querySelector('input')!;

    // 1. Non-numeric 'abc'
    fireEvent.change(input, { target: { value: 'abc' } });
    expect(input.value).toBe('abc');
    expect(elecCurrCell.classList.contains('ring-rose-500')).toBe(true);
    expect(elecCurrCell.getAttribute('title')).toContain('ค่ามิเตอร์ต้องเป็นตัวเลขจำนวนเต็ม');

    // 2. Negative '-5'
    fireEvent.change(input, { target: { value: '-5' } });
    expect(input.value).toBe('-5');
    expect(elecCurrCell.classList.contains('ring-rose-500')).toBe(true);

    // 3. Decimal '12.5'
    fireEvent.change(input, { target: { value: '12.5' } });
    expect(input.value).toBe('12.5');
    expect(elecCurrCell.classList.contains('ring-rose-500')).toBe(true);

    // 4. Over bound '100000'
    fireEvent.change(input, { target: { value: '100000' } });
    expect(input.value).toBe('100000');
    expect(elecCurrCell.classList.contains('ring-rose-500')).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Case F: Locked/paid rows cannot be mutated by paste or drag fill
  // ─────────────────────────────────────────────────────────────────────────
  it('Case F: Locked/paid rows cannot be mutated by Quick Fill paste and are preserved unchanged', async () => {
    // Room 103 (r-103) is locked/paid
    const { container, rows } = await openSpreadsheet(undefined, ['r-103']);

    // Row 2 is room 103
    const row103 = rows[2];
    const elecCurr103 = row103.querySelectorAll('td')[3];
    const input103 = elecCurr103.querySelector('input')!;
    expect(input103.disabled).toBe(true);
    expect(input103.value).toBe('420');

    // Focus row 0 and paste values across rows 0 to 3:
    // row 0: 600, row 1: 9999, row 2 (locked): 8888, row 3: 900
    const cell0_elecCurr = rows[0].querySelectorAll('td')[3];
    fireEvent.pointerDown(cell0_elecCurr);

    const scrollContainer = container.querySelector('.overflow-x-auto.overflow-y-auto')!;
    fireEvent.paste(scrollContainer, {
      clipboardData: {
        getData: () => '600\n9999\n8888\n900',
      },
    });

    // Row 0 updated to 600
    expect(rows[0].querySelectorAll('td')[3].querySelector('input')!.value).toBe('600');
    // Row 2 (locked) remains 420, UNTOUCHED!
    expect(rows[2].querySelectorAll('td')[3].querySelector('input')!.value).toBe('420');
    // Row 3 updated to 900
    expect(rows[3].querySelectorAll('td')[3].querySelector('input')!.value).toBe('900');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Case G: Pattern fill applies canonical validation row-by-row
  // ─────────────────────────────────────────────────────────────────────────
  it('Case G: Pattern fill / column paste applies canonical validation row-by-row against each row previous reading', async () => {
    const { container, rows } = await openSpreadsheet();
    // Row 0: prev is 500
    // Row 1: prev is 9950
    // Row 3: prev is 800
    // Paste '600\n400\n420\n850' starting at row 0 elecCurr
    const cell0 = rows[0].querySelectorAll('td')[3];
    fireEvent.pointerDown(cell0);

    const scrollContainer = container.querySelector('.overflow-x-auto.overflow-y-auto')!;
    fireEvent.paste(scrollContainer, {
      clipboardData: {
        getData: () => '600\n400\n420\n850',
      },
    });

    // Row 0: prev 500, curr 600 -> VALID
    const cell0_td = rows[0].querySelectorAll('td')[3];
    expect(cell0_td.querySelector('input')!.value).toBe('600');
    expect(cell0_td.classList.contains('ring-rose-500')).toBe(false);

    // Row 1: prev 9950, curr 400 -> INVALID (lower without rollover criteria, 400 >= 200)
    const cell1_td = rows[1].querySelectorAll('td')[3];
    expect(cell1_td.querySelector('input')!.value).toBe('400');
    expect(cell1_td.classList.contains('ring-rose-500')).toBe(true);
    expect(cell1_td.getAttribute('title')).toContain('ต้องไม่น้อยกว่าค่ามิเตอร์เดิม');

    // Row 3: prev 800, curr 850 -> VALID
    const cell3_td = rows[3].querySelectorAll('td')[3];
    expect(cell3_td.querySelector('input')!.value).toBe('850');
    expect(cell3_td.classList.contains('ring-rose-500')).toBe(false);
  });
});
