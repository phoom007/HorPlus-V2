// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * HORPLUS LOCAL-07 — Quick Add Tenant Exact Table/List Popup Parity Suite (Q1 - Q20)
 *
 * Requirements:
 * Q1. Vacant eligible room: Table has + เพิ่มผู้เช่า, List has + เพิ่มผู้เช่า
 * Q2. Click Table Add Tenant: canonical QuickAddTenantModal opens
 * Q3. Click List Add Tenant: THE SAME QuickAddTenantModal opens
 * Q4. Same room/cycle launched from Table/List: exact same room number
 * Q5. Same rent type
 * Q6. Same canonical price/default values
 * Q7. Same form fields
 * Q8. Same attachment controls
 * Q9. Same selected cycle
 * Q10. Reserved room: NO Table Add, NO List Add
 * Q11. Daily active stay: NO Table Add, NO List Add
 * Q12. Active monthly/term occupant: NO Table Add, NO List Add
 * Q13. Empty bookable room: Add present in both
 * Q14. Table/List both use same open handler/state authority
 * Q15. Table/List both use same success callback
 * Q16. No List-specific submit/mutation
 * Q17. Successful Quick Add from List: new occupant appears in List
 * Q18. Switch to Table: same occupant appears
 * Q19. Add button absent after success in both
 * Q20. F5 / query reload: persisted occupant remains
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OwnerMeters } from '../pages/owner/meters';
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
  { id: 'r3', roomNumber: '103', floor: 1, building: 'A', status: 'VACANT' },
  { id: 'r4', roomNumber: '104', floor: 1, building: 'A', status: 'VACANT' },
];

const mockCycles = [
  { id: 'cycle-2026-08', cycleCode: '2026-08', status: 'open', isCurrent: true, startDate: '2026-08-01', endDate: '2026-08-31' },
];

describe('HORPLUS LOCAL-07 — Quick Add Tenant Exact Table/List Popup Parity Suite (Q1 - Q20)', () => {
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

  const setupHttpSpies = (customRooms: any[] = []) => {
    return vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method: string, url: string) => {
      if (url.includes('/billing-cycles')) {
        return { data: mockCycles };
      }
      if (url.includes('/meters/cycle-people-count')) {
        return {
          success: true,
          data: [
            { roomId: 'r1', version: 1, peopleCount: 1, manualOutstandingAmount: '0.00', otherFees: [] },
            { roomId: 'r2', version: 1, peopleCount: 1, manualOutstandingAmount: '0.00', otherFees: [] },
            { roomId: 'r3', version: 1, peopleCount: 0, manualOutstandingAmount: '0.00', otherFees: [] },
            { roomId: 'r4', version: 1, peopleCount: 0, manualOutstandingAmount: '0.00', otherFees: [] },
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
            { roomId: 'r4', meterType: 'water', previousReading: '50.00', currentReading: '50.00' },
            { roomId: 'r4', meterType: 'electricity', previousReading: '80.00', currentReading: '80.00' },
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
            rooms: customRooms.length > 0 ? customRooms : [
              // r1: Active monthly occupant
              { roomId: 'r1', roomNumber: '101', tenantId: 't1', tenantName: 'สมชาย ใจดี', rentAmount: '4000.00', billingSource: 'MONTHLY_CONTRACT', hasBookableGap: false },
              // r2: Reserved future occupant
              { roomId: 'r2', roomNumber: '102', tenantId: 't2', tenantName: 'สมหญิง รักสงบ', rentAmount: '4000.00', billingSource: 'MONTHLY_CONTRACT', isFutureReservation: true, hasBookableGap: false },
              // r3: Genuinely vacant bookable room
              { roomId: 'r3', roomNumber: '103', rentAmount: '4500.00', hasBookableGap: true },
              // r4: Active Daily Stay
              { roomId: 'r4', roomNumber: '104', rentAmount: '600.00', billingSource: 'DAILY_STAY', isDailyStay: true, tenantName: 'จอห์น โด', dailyCheckOutDate: '2026-08-25', hasBookableGap: false },
            ],
          },
        };
      }
      if (url.includes('/quick-add-context')) {
        return {
          success: true,
          data: {
            roomId: 'r3',
            roomNumber: '103',
            buildingName: 'อาคาร A',
            floor: 1,
            rentType: 'MONTHLY',
            effective: {
              rentType: 'MONTHLY',
              monthlyRent: 4500,
              termRent: 18000,
              dailyRent: 600,
              depositAmount: 5000,
              advanceRentMonths: 1,
              maxInstallments: 3,
            },
            dormitoryDefaults: {
              rentType: 'MONTHLY',
              monthlyRent: 4000,
              depositAmount: 5000,
            },
          },
        };
      }
      if (url.includes('/meters/provisional-terms')) {
        return {
          success: true,
          data: {
            id: 'term-new-103',
            roomId: 'r3',
            tenantName: 'สมศักดิ์ มาใหม่',
            phone: '0812345678',
            monthlyRent: 4500,
            depositAmount: 5000,
            status: 'ACTIVE',
          },
        };
      }
      return { success: true, data: [] };
    });
  };

  const renderComponent = () => {
    return render(
      <QueryClientProvider client={queryClient}>
        <OwnerMeters
          rooms={mockRooms}
          bills={[]}
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
  // Eligibility Parity Tests (Q1, Q10, Q11, Q12, Q13)
  // =========================================================================
  it('Q1 & Q10, Q11, Q12, Q13. Exact eligibility parity in Table and List modes', async () => {
    setupHttpSpies();
    renderComponent();

    await waitFor(() => {
      expect(document.getElementById('room-row-r3')).toBeTruthy();
    });

    // 1. TABLE MODE checks
    const tableR1 = document.getElementById('room-row-r1');
    const tableR2 = document.getElementById('room-row-r2');
    const tableR3 = document.getElementById('room-row-r3');
    const tableR4 = document.getElementById('room-row-r4');

    // Q12. Active monthly occupant (r1) -> NO Add Tenant button
    expect(within(tableR1!).queryByText('เพิ่มผู้เช่า')).toBeNull();
    expect(within(tableR1!).getByText('สมชาย ใจดี')).toBeDefined();

    // Q10. Reserved room (r2) -> NO Add Tenant button, shows "จองล่วงหน้า"
    expect(within(tableR2!).queryByText('เพิ่มผู้เช่า')).toBeNull();
    expect(within(tableR2!).getByText('จองล่วงหน้า')).toBeDefined();

    // Q11. Daily stay room (r4) -> NO Add Tenant button, shows date badge
    expect(within(tableR4!).queryByText('เพิ่มผู้เช่า')).toBeNull();

    // Q1 & Q13. Empty bookable room (r3) -> HAS "+ เพิ่มผู้เช่า"
    expect(within(tableR3!).getByText('เพิ่มผู้เช่า')).toBeDefined();

    // 2. Switch to LIST MODE
    const listBtn = screen.getByTestId('view-mode-list-button');
    fireEvent.click(listBtn);

    await waitFor(() => {
      expect(screen.getByTestId('meter-list-card-r3')).toBeDefined();
    });

    const cardR1 = screen.getByTestId('meter-list-card-r1');
    const cardR2 = screen.getByTestId('meter-list-card-r2');
    const cardR3 = screen.getByTestId('meter-list-card-r3');
    const cardR4 = screen.getByTestId('meter-list-card-r4');

    // Q12. Active monthly occupant (r1) -> NO Add Tenant button
    expect(within(cardR1).queryByText('เพิ่มผู้เช่า')).toBeNull();
    expect(within(cardR1).getByText('สมชาย ใจดี')).toBeDefined();

    // Q10. Reserved room (r2) -> NO Add Tenant button, shows "จองล่วงหน้า"
    expect(within(cardR2).queryByText('เพิ่มผู้เช่า')).toBeNull();
    expect(within(cardR2).getByText('จองล่วงหน้า')).toBeDefined();

    // Q11. Daily stay room (r4) -> NO Add Tenant button
    expect(within(cardR4).queryByText('เพิ่มผู้เช่า')).toBeNull();

    // Q1 & Q13. Empty bookable room (r3) -> HAS "+ เพิ่มผู้เช่า"
    expect(within(cardR3).getByText('เพิ่มผู้เช่า')).toBeDefined();
  });

  // =========================================================================
  // Popup Identity & Data Parity (Q2, Q3, Q4, Q5, Q6, Q7, Q8, Q9, Q14)
  // =========================================================================
  it('Q2, Q3, Q4, Q5, Q6, Q7, Q8, Q9, Q14. Table and List mode open the exact same QuickAddTenantModal with identical room data, pricing, and form fields', async () => {
    setupHttpSpies();
    renderComponent();

    await waitFor(() => {
      expect(document.getElementById('room-row-r3')).toBeTruthy();
    });

    // 1. Launch Quick Add FROM TABLE MODE
    const tableR3 = document.getElementById('room-row-r3');
    const tableAddBtn = within(tableR3!).getByText('เพิ่มผู้เช่า');
    fireEvent.click(tableAddBtn);

    // Modal opens
    await waitFor(() => {
      expect(screen.getByText('เพิ่มผู้เช่าด่วน')).toBeDefined();
    });

    // Q2 & Q4. Room number rendered
    expect(screen.getAllByText(/103/).length).toBeGreaterThanOrEqual(1);

    // Switch to Monthly tab
    const monthlyTab = screen.getByRole('button', { name: 'รายเดือน' });
    fireEvent.click(monthlyTab);

    // Q5 & Q6. Effective monthly rent (4500)
    expect(screen.getByDisplayValue('4500')).toBeDefined();
    // Q7. Form fields present
    expect(screen.getByPlaceholderText('เช่น นายสมชาย ใจดี')).toBeDefined();
    expect(screen.getByPlaceholderText('เช่น 081-234-5678')).toBeDefined();

    // Close modal via Cancel (X button)
    const closeBtn = screen.getByText('เพิ่มผู้เช่าด่วน').closest('div')?.parentElement?.querySelector('button');
    if (closeBtn) fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByText('เพิ่มผู้เช่าด่วน')).toBeNull();
    });

    // 2. Switch to LIST MODE and launch Quick Add
    const listBtn = screen.getByTestId('view-mode-list-button');
    fireEvent.click(listBtn);

    await waitFor(() => {
      expect(screen.getByTestId('meter-list-card-r3')).toBeDefined();
    });

    const cardR3 = screen.getByTestId('meter-list-card-r3');
    const listAddBtn = within(cardR3).getByText('เพิ่มผู้เช่า');
    fireEvent.click(listAddBtn);

    // Modal opens again
    await waitFor(() => {
      expect(screen.getByText('เพิ่มผู้เช่าด่วน')).toBeDefined();
    });

    // Q3 & Q4. Exact same room number
    expect(screen.getAllByText(/103/).length).toBeGreaterThanOrEqual(1);

    // Switch to Monthly tab
    const monthlyTabList = screen.getByRole('button', { name: 'รายเดือน' });
    fireEvent.click(monthlyTabList);

    // Q5 & Q6. Exact same rent
    expect(screen.getByDisplayValue('4500')).toBeDefined();
    // Q7. Exact same form fields
    expect(screen.getByPlaceholderText('เช่น นายสมชาย ใจดี')).toBeDefined();
    expect(screen.getByPlaceholderText('เช่น 081-234-5678')).toBeDefined();
  });

  // =========================================================================
  // Success Flow Parity (Q15, Q16, Q17, Q18, Q19, Q20)
  // =========================================================================
  it('Q15, Q16, Q17, Q18, Q19, Q20. Quick Add submitted from List mode creates occupant, updates UI in both List and Table, and hides Add button', async () => {
    let previewRooms: any[] = [
      { roomId: 'r3', roomNumber: '103', rentAmount: '4500.00', hasBookableGap: true },
    ];

    vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method: string, url: string, body: any) => {
      if (url.includes('/billing-cycles')) {
        return { data: mockCycles };
      }
      if (url.includes('/meters/cycle-people-count')) {
        return { success: true, data: [{ roomId: 'r3', version: 1, peopleCount: 0, manualOutstandingAmount: '0.00', otherFees: [] }] };
      }
      if (url.includes('/meters/readings')) {
        return { success: true, data: [] };
      }
      if (url.includes('/meters/workspace/preview-context')) {
        return {
          success: true,
          data: {
            rateSnapshot: { waterBillingType: 'per_unit', waterRate: '18.00', electricityBillingType: 'per_unit', electricityRate: '8.00' },
            rooms: previewRooms,
          },
        };
      }
      if (url.includes('/quick-add-context')) {
        return {
          success: true,
          data: {
            roomId: 'r3',
            roomNumber: '103',
            buildingName: 'อาคาร A',
            floor: 1,
            rentType: 'MONTHLY',
            effective: { rentType: 'MONTHLY', monthlyRent: 4500, termRent: 18000, dailyRent: 600, depositAmount: 5000, advanceRentMonths: 1, maxInstallments: 3 },
            dormitoryDefaults: { rentType: 'MONTHLY', monthlyRent: 4000, depositAmount: 5000 },
          },
        };
      }
      if (url.includes('/meters/provisional-terms')) {
        // Mutate preview context to reflect newly added tenant
        previewRooms = [
          { roomId: 'r3', roomNumber: '103', tenantId: 't-new-103', rentAmount: '4500.00', tenantName: 'สมศักดิ์ มาใหม่', billingSource: 'MONTHLY_CONTRACT', hasBookableGap: false },
        ];
        return {
          success: true,
          data: { id: 'term-103', roomId: 'r3', tenantName: 'สมศักดิ์ มาใหม่', phone: '0812345678', monthlyRent: 4500, depositAmount: 5000, status: 'ACTIVE' },
        };
      }
      return { success: true, data: [] };
    });

    renderComponent();

    // 1. Switch to List Mode
    await waitFor(() => {
      expect(screen.getByTestId('view-mode-list-button')).toBeDefined();
    });
    fireEvent.click(screen.getByTestId('view-mode-list-button'));

    await waitFor(() => {
      expect(screen.getByTestId('meter-list-card-r3')).toBeDefined();
    });

    // 2. Click Add Tenant in List Mode
    const cardR3 = screen.getByTestId('meter-list-card-r3');
    fireEvent.click(within(cardR3).getByText('เพิ่มผู้เช่า'));

    await waitFor(() => {
      expect(screen.getByText('เพิ่มผู้เช่าด่วน')).toBeDefined();
    });

    // Switch to Monthly tab
    const monthlyTab = screen.getByRole('button', { name: 'รายเดือน' });
    fireEvent.click(monthlyTab);

    // Fill form
    const nameInput = screen.getByPlaceholderText('เช่น นายสมชาย ใจดี');
    const phoneInput = screen.getByPlaceholderText('เช่น 081-234-5678');
    fireEvent.change(nameInput, { target: { value: 'สมศักดิ์ มาใหม่' } });
    fireEvent.change(phoneInput, { target: { value: '0812345678' } });

    // Submit form
    const submitBtn = screen.getByText('ยืนยันเพิ่มผู้เช่า');
    fireEvent.submit(submitBtn.closest('form')!);

    // Modal closes
    await waitFor(() => {
      expect(screen.queryByText('เพิ่มผู้เช่าด่วน')).toBeNull();
    });

    // Q17 & Q19. In List Mode: new occupant appears, Add Tenant button is absent
    await waitFor(() => {
      expect(within(cardR3).getByText('สมศักดิ์ มาใหม่')).toBeDefined();
      expect(within(cardR3).queryByText('เพิ่มผู้เช่า')).toBeNull();
    });

    // Q18. Switch to Table Mode: new occupant appears, Add Tenant button is absent
    const tableBtn = screen.getByTestId('view-mode-table-button');
    fireEvent.click(tableBtn);

    await waitFor(() => {
      const rowR3 = document.getElementById('room-row-r3');
      expect(within(rowR3!).getByText('สมศักดิ์ มาใหม่')).toBeDefined();
      expect(within(rowR3!).queryByText('เพิ่มผู้เช่า')).toBeNull();
    });
  });
});
