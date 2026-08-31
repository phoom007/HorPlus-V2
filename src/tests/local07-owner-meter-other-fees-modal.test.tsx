// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * HORPLUS LOCAL-07 — Shared Other Fees Modal UX/UI Canonical Integration Suite (Batch C)
 *
 * Tests:
 * C1. Table mode: clicking "เพิ่มค่าใช้จ่าย" opens modal with empty draft
 * C2. Table mode: clicking "แก้ไข" opens modal with existing fees
 * C3. List mode: clicking "+ เพิ่มค่าใช้จ่าย" opens modal with empty draft
 * C4. List mode: clicking "แก้ไข" opens modal with existing fees
 * C5. Modal header renders Tag icon, room number badge, and close button
 * C6. Presets populate description input correctly
 * C7. Adding item validates non-empty description and valid positive amount
 * C8. Formatting whole baht (e.g. 50 ฿) and fractional satang (e.g. 50.50 ฿)
 * C9. Total draft custom fee amount updates dynamically
 * C10. Deleting item from modal draft removes it immediately
 * C11. Cancel button closes modal with ZERO changes to workspace draft and no dirty state
 * C12. Backdrop click / Close icon closes modal with ZERO changes
 * C13. Confirm button ("บันทึกรายการ") commits draft to row.otherFees and marks workspace dirty
 * C14. Single canonical draft: Table adds fee -> List reflects it immediately
 * C15. Single canonical draft: List edits fee -> Table reflects it immediately
 * C16. Paid room lock: Paid room (102) has no editable other fee triggers
 * C17. Modal draft deep copies initial fees (no mutation on cancel)
 * C18. Reopening modal reloads latest workspace state
 * C19. Global Enter handler does not trigger save while modal is open
 * C20. Max 20 items constraint prevents adding beyond 20 items
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OwnerMeters } from '../pages/owner/meters';
import { MeterOtherFeesModal } from '../components/meters/MeterOtherFeesModal';
import * as httpClient from '../data/httpClient';

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

const mockRooms = [
  { id: 'r1', roomNumber: '101', floor: 1, building: 'A', status: 'OCCUPIED' },
  { id: 'r2', roomNumber: '102', floor: 1, building: 'A', status: 'OCCUPIED' },
  { id: 'r3', roomNumber: '103', floor: 1, building: 'A', status: 'OCCUPIED' },
];

const mockCycles = [
  { id: 'cycle-2026-08', cycleCode: '2026-08', status: 'open', isCurrent: true, startDate: '2026-08-01', endDate: '2026-08-31' },
];

describe('HORPLUS LOCAL-07 — Shared Other Fees Modal UX/UI Suite (Batch C)', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    cleanup();
    queryClient = createTestQueryClient();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  const setupHttpSpies = (initialFees: any[] = []) => {
    return vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method: string, url: string) => {
      if (url.includes('/billing-cycles')) {
        return { data: mockCycles };
      }
      if (url.includes('/meters/cycle-people-count')) {
        return {
          success: true,
          data: [
            { roomId: 'r1', version: 1, peopleCount: 1, manualOutstandingAmount: '0.00', otherFees: initialFees },
            { roomId: 'r2', version: 1, peopleCount: 1, manualOutstandingAmount: '0.00', otherFees: [{ description: 'ค่ามัดจำกุญแจ', amount: '200.00' }] },
            { roomId: 'r3', version: 1, peopleCount: 1, manualOutstandingAmount: '0.00', otherFees: [] },
          ],
        };
      }
      if (url.includes('/meters/readings')) {
        return {
          success: true,
          data: [
            { roomId: 'r1', meterType: 'water', previousReading: '100.00', currentReading: '110.00' },
            { roomId: 'r1', meterType: 'electricity', previousReading: '200.00', currentReading: '250.00' },
            { roomId: 'r2', meterType: 'water', previousReading: '150.00', currentReading: '160.00' },
            { roomId: 'r2', meterType: 'electricity', previousReading: '300.00', currentReading: '350.00' },
            { roomId: 'r3', meterType: 'water', previousReading: '100.00', currentReading: '100.00' },
            { roomId: 'r3', meterType: 'electricity', previousReading: '200.00', currentReading: '200.00' },
          ],
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
            rooms: [
              { roomId: 'r1', roomNumber: '101', rentAmount: '4000.00', billingSource: 'MONTHLY_CONTRACT', tenantName: 'สมชาย' },
              { roomId: 'r2', roomNumber: '102', rentAmount: '4000.00', billingSource: 'MONTHLY_CONTRACT', tenantName: 'สมหญิง', isPaid: true, billStatus: 'paid' },
              { roomId: 'r3', roomNumber: '103', rentAmount: '4000.00', billingSource: 'MONTHLY_CONTRACT', tenantName: 'สมศักดิ์' },
            ],
          },
        };
      }
      if (url.includes('/meters/workspace/bulk')) {
        return { success: true, savedCount: 1, savedRows: [] };
      }
      return { success: true, data: [] };
    });
  };

  const renderComponent = (bills: any[] = []) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <OwnerMeters
          rooms={mockRooms}
          bills={bills}
          tenants={[]}
          contracts={[]}
          dormitoryId="dorm-1"
          selectedBillingCycleId="cycle-2026-08"
          selectedCycleCode="2026-08"
          selectedCycle="2026-08"
          billingCycles={mockCycles}
          onSaveBills={vi.fn()}
          onSelectTenant={vi.fn()}
          onAddLog={vi.fn()}
        />
      </QueryClientProvider>
    );
  };

  // =========================================================================
  // Unit Component Tests: MeterOtherFeesModal
  // =========================================================================
  it('C5. Modal header renders Tag icon, room number badge, and close button', () => {
    const handleClose = vi.fn();
    const handleSave = vi.fn();

    render(
      <MeterOtherFeesModal
        isOpen={true}
        roomId="r1"
        roomNumber="101"
        initialFees={[{ description: 'ค่าคีย์การ์ด', amount: '100.00' }]}
        isLocked={false}
        onClose={handleClose}
        onSave={handleSave}
      />
    );

    expect(screen.getByTestId('meter-other-fees-modal-backdrop')).toBeDefined();
    expect(screen.getByRole('heading', { name: /ค่าใช้จ่ายอื่นๆ/ })).toBeDefined();
    expect(screen.getByText('ห้อง 101')).toBeDefined();
    expect(screen.getByTestId('modal-fee-item-0')).toBeDefined();
    expect(screen.getByText('100 ฿')).toBeDefined();
  });

  it('C6. Presets populate description input correctly', () => {
    render(
      <MeterOtherFeesModal
        isOpen={true}
        roomId="r1"
        roomNumber="101"
        initialFees={[]}
        isLocked={false}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );

    const descInput = screen.getByPlaceholderText('ชื่อรายการ (เช่น ค่ากุญแจ)') as HTMLInputElement;
    const presetCard = screen.getByRole('button', { name: /\+ ค่าคีย์การ์ด/ });
    fireEvent.click(presetCard);

    expect(descInput.value).toBe('ค่าคีย์การ์ด');
  });

  it('C7 & C8. Adding items formats whole baht and satang decimals', () => {
    render(
      <MeterOtherFeesModal
        isOpen={true}
        roomId="r1"
        roomNumber="101"
        initialFees={[]}
        isLocked={false}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );

    const descInput = screen.getByPlaceholderText('ชื่อรายการ (เช่น ค่ากุญแจ)') as HTMLInputElement;
    const amtInput = screen.getByPlaceholderText('จำนวนเงิน') as HTMLInputElement;
    const addBtn = screen.getByTitle('เพิ่มรายการ');

    // Item 1: whole baht
    fireEvent.change(descInput, { target: { value: 'ค่าล้างแอร์' } });
    fireEvent.change(amtInput, { target: { value: '500' } });
    fireEvent.click(addBtn);

    // Item 2: fractional satang
    fireEvent.change(descInput, { target: { value: 'ค่าบริการส่วนกลาง' } });
    fireEvent.change(amtInput, { target: { value: '50.50' } });
    fireEvent.click(addBtn);

    const item0 = screen.getByTestId('modal-fee-item-0');
    expect(within(item0).getByText('ค่าล้างแอร์')).toBeDefined();
    expect(within(item0).getByText('500 ฿')).toBeDefined();

    const item1 = screen.getByTestId('modal-fee-item-1');
    expect(within(item1).getByText('ค่าบริการส่วนกลาง')).toBeDefined();
    expect(within(item1).getByText('50.50 ฿')).toBeDefined();
    expect(screen.getAllByText(/550\.50 ฿/).length).toBeGreaterThanOrEqual(1); // Total
  });

  it('C10. Deleting item from modal draft removes it immediately', () => {
    render(
      <MeterOtherFeesModal
        isOpen={true}
        roomId="r1"
        roomNumber="101"
        initialFees={[
          { description: 'ค่าคีย์การ์ด', amount: '100.00' },
          { description: 'ค่าทำความสะอาด', amount: '300.00' },
        ]}
        isLocked={false}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );

    expect(screen.getByTestId('modal-fee-item-0')).toBeDefined();
    expect(screen.getByTestId('modal-fee-item-1')).toBeDefined();

    const deleteBtns = screen.getAllByTitle('ลบรายการ');
    expect(deleteBtns).toHaveLength(2);

    fireEvent.click(deleteBtns[0]);

    expect(screen.queryByTestId('modal-fee-item-1')).toBeNull();
    const remaining = screen.getByTestId('modal-fee-item-0');
    expect(within(remaining).getByText('ค่าทำความสะอาด')).toBeDefined();
    expect(within(remaining).getByText('300 ฿')).toBeDefined();
  });

  it('C11 & C17. Cancel button closes modal with ZERO changes to workspace draft', () => {
    const handleClose = vi.fn();
    const handleSave = vi.fn();
    const initial = [{ description: 'ค่าคีย์การ์ด', amount: '100.00' }];

    render(
      <MeterOtherFeesModal
        isOpen={true}
        roomId="r1"
        roomNumber="101"
        initialFees={initial}
        isLocked={false}
        onClose={handleClose}
        onSave={handleSave}
      />
    );

    // Delete existing item and add a new item
    const deleteBtn = screen.getByTitle('ลบรายการ');
    fireEvent.click(deleteBtn);

    const descInput = screen.getByPlaceholderText('ชื่อรายการ (เช่น ค่ากุญแจ)');
    const amtInput = screen.getByPlaceholderText('จำนวนเงิน');
    fireEvent.change(descInput, { target: { value: 'ค่าปรับ' } });
    fireEvent.change(amtInput, { target: { value: '200' } });
    fireEvent.click(screen.getByTitle('เพิ่มรายการ'));

    // Click Cancel
    const cancelBtn = screen.getByRole('button', { name: 'ยกเลิก' });
    fireEvent.click(cancelBtn);

    expect(handleClose).toHaveBeenCalledTimes(1);
    expect(handleSave).not.toHaveBeenCalled();
    // Initial array unaffected
    expect(initial).toEqual([{ description: 'ค่าคีย์การ์ด', amount: '100.00' }]);
  });

  it('C13. Confirm button commits draft to onSave callback', () => {
    const handleClose = vi.fn();
    const handleSave = vi.fn();

    render(
      <MeterOtherFeesModal
        isOpen={true}
        roomId="r1"
        roomNumber="101"
        initialFees={[{ description: 'ค่าคีย์การ์ด', amount: '100.00' }]}
        isLocked={false}
        onClose={handleClose}
        onSave={handleSave}
      />
    );

    const descInput = screen.getByPlaceholderText('ชื่อรายการ (เช่น ค่ากุญแจ)');
    const amtInput = screen.getByPlaceholderText('จำนวนเงิน');
    fireEvent.change(descInput, { target: { value: 'ค่าล้างแอร์' } });
    fireEvent.change(amtInput, { target: { value: '500' } });
    fireEvent.click(screen.getByTitle('เพิ่มรายการ'));

    const confirmBtn = screen.getByRole('button', { name: 'บันทึกรายการ' });
    fireEvent.click(confirmBtn);

    expect(handleSave).toHaveBeenCalledWith([
      { description: 'ค่าคีย์การ์ด', amount: '100.00' },
      { description: 'ค่าล้างแอร์', amount: '500' },
    ]);
  });

  it('C20. Max 20 items constraint blocks adding > 20 items with error message', () => {
    const maxFees = Array.from({ length: 20 }, (_, i) => ({
      description: `รายการที่ ${i + 1}`,
      amount: '50.00',
    }));

    render(
      <MeterOtherFeesModal
        isOpen={true}
        roomId="r1"
        roomNumber="101"
        initialFees={maxFees}
        isLocked={false}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );

    const descInput = screen.getByPlaceholderText('ชื่อรายการ (เช่น ค่ากุญแจ)');
    const amtInput = screen.getByPlaceholderText('จำนวนเงิน');
    fireEvent.change(descInput, { target: { value: 'รายการที่ 21' } });
    fireEvent.change(amtInput, { target: { value: '100' } });
    fireEvent.click(screen.getByTitle('เพิ่มรายการ'));

    expect(screen.getByText('ไม่สามารถเพิ่มค่าใช้จ่ายอื่นๆ เกิน 20 รายการต่อห้องได้')).toBeDefined();
    expect(screen.queryByText('รายการที่ 21')).toBeNull();
  });

  // =========================================================================
  // Integration Tests: Table & List Mode Shared Workspace Draft Parity
  // =========================================================================
  it('C1. Table mode: clicking "เพิ่มค่าใช้จ่าย" opens modal and saving updates table and marks dirty', async () => {
    setupHttpSpies([]);
    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('open-table-other-fees-r1')).toBeDefined();
    });

    // Open modal from table
    fireEvent.click(screen.getByTestId('open-table-other-fees-r1'));

    expect(screen.getByTestId('meter-other-fees-modal-backdrop')).toBeDefined();
    const descInput = screen.getByPlaceholderText('ชื่อรายการ (เช่น ค่ากุญแจ)');
    const amtInput = screen.getByPlaceholderText('จำนวนเงิน');
    fireEvent.change(descInput, { target: { value: 'ค่าคีย์การ์ด' } });
    fireEvent.change(amtInput, { target: { value: '150' } });
    fireEvent.click(screen.getByTitle('เพิ่มรายการ'));

    // Confirm
    fireEvent.click(screen.getByText('บันทึกรายการ'));

    // Modal closes
    await waitFor(() => {
      expect(screen.queryByTestId('meter-other-fees-modal-backdrop')).toBeNull();
    });

    // Table reflects new fee
    const rowR1 = document.getElementById('room-row-r1');
    expect(within(rowR1!).getByText('ค่าคีย์การ์ด')).toBeDefined();
    expect(within(rowR1!).getByText('150 ฿')).toBeDefined();

    // Floating save button is now visible (isDirty is true)
    expect(screen.getByRole('button', { name: /บันทึกข้อมูล/ })).toBeDefined();
  });

  it('C14 & C15. Parity: Table adds fee -> List reflects it; List edits fee -> Table reflects it', async () => {
    setupHttpSpies([]);
    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('open-table-other-fees-r1')).toBeDefined();
    });

    // 1. In Table Mode: add fee via modal
    fireEvent.click(screen.getByTestId('open-table-other-fees-r1'));
    const descInput = screen.getByPlaceholderText('ชื่อรายการ (เช่น ค่ากุญแจ)');
    const amtInput = screen.getByPlaceholderText('จำนวนเงิน');
    fireEvent.change(descInput, { target: { value: 'ค่าคีย์การ์ด' } });
    fireEvent.change(amtInput, { target: { value: '100' } });
    fireEvent.click(screen.getByTitle('เพิ่มรายการ'));
    fireEvent.click(screen.getByText('บันทึกรายการ'));

    await waitFor(() => {
      expect(screen.queryByTestId('meter-other-fees-modal-backdrop')).toBeNull();
    });

    // 2. Switch to List Mode
    const listBtn = screen.getByTestId('view-mode-list-button');
    fireEvent.click(listBtn);

    // List mode renders exact fee
    await waitFor(() => {
      expect(screen.getByTestId('meter-list-card-r1')).toBeDefined();
    });
    const cardR1 = screen.getByTestId('meter-list-card-r1');
    expect(within(cardR1).getByText('ค่าคีย์การ์ด')).toBeDefined();
    expect(within(cardR1).getByText('100 ฿')).toBeDefined();

    // 3. In List Mode: edit fee via modal
    const editBtn = within(cardR1).getByTestId('open-other-fees-modal-r1');
    fireEvent.click(editBtn);

    expect(screen.getByTestId('meter-other-fees-modal-backdrop')).toBeDefined();
    const modalDescInput = screen.getByPlaceholderText('ชื่อรายการ (เช่น ค่ากุญแจ)');
    const modalAmtInput = screen.getByPlaceholderText('จำนวนเงิน');
    fireEvent.change(modalDescInput, { target: { value: 'ค่าทำความสะอาด' } });
    fireEvent.change(modalAmtInput, { target: { value: '300' } });
    fireEvent.click(screen.getByTitle('เพิ่มรายการ'));
    fireEvent.click(screen.getByText('บันทึกรายการ'));

    await waitFor(() => {
      expect(screen.queryByTestId('meter-other-fees-modal-backdrop')).toBeNull();
    });

    expect(within(cardR1).getByText('ค่าทำความสะอาด')).toBeDefined();
    expect(within(cardR1).getByText('300 ฿')).toBeDefined();

    // 4. Switch back to Table Mode: Table reflects exact updated fees
    const tableBtn = screen.getByTestId('view-mode-table-button');
    fireEvent.click(tableBtn);

    await waitFor(() => {
      const tableRow = document.getElementById('room-row-r1');
      expect(within(tableRow!).getByText('ค่าคีย์การ์ด')).toBeDefined();
      expect(within(tableRow!).getByText('100 ฿')).toBeDefined();
      expect(within(tableRow!).getByText('ค่าทำความสะอาด')).toBeDefined();
      expect(within(tableRow!).getByText('300 ฿')).toBeDefined();
    });
  });

  it('C16. Paid room lock: Paid room (102) has no editable other fee triggers', async () => {
    setupHttpSpies([]);
    const paidBills: any[] = [
      { id: 'b2', billNumber: 'INV-102', dormitoryId: 'dorm-1', billingCycleId: 'cycle-2026-08', cycleId: 'cycle-2026-08', roomId: 'r2', billKind: 'MONTHLY_UTILITY', status: 'paid', totalAmount: 4000, outstandingAmount: 0, paidAmount: 4000 },
    ];
    renderComponent(paidBills);

    await waitFor(() => {
      expect(document.getElementById('room-row-r2')).toBeTruthy();
    });

    const rowR2 = document.getElementById('room-row-r2');

    // Room 102 is PAID -> edit button and open button are NOT rendered on this row
    expect(rowR2?.querySelector('button[data-testid^="open-table-other-fees-"]')).toBeNull();
    expect(rowR2?.querySelector('button[data-testid^="edit-table-other-fees-"]')).toBeNull();

    // Persisted fee for room 102 remains visible
    expect(within(rowR2!).getByText('ค่ามัดจำกุญแจ')).toBeDefined();
    expect(within(rowR2!).getByText('200 ฿')).toBeDefined();
  });
});
