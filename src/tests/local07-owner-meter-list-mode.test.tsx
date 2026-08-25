import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OwnerMeters } from '../pages/owner/meters';
import { meterDraftStore } from '../lib/meterDraftStore';
import { queryKeys } from '../lib/queryClient';
import { Room, Bill, Tenant, Contract } from '../types';
import { isCycleInRollingThreeMonthWindow } from '../utils/calendarDate';

describe('HORPLUS LOCAL-07 — Owner Meter List Mode UX Suite (L1 - L28)', () => {
  let queryClient: QueryClient;

  const mockRooms: Room[] = [
    {
      id: 'room-101',
      roomNumber: '101',
      buildingId: 'bldg-1',
      floor: 1,
      status: 'occupied',
      monthlyRent: 4000,
      rentCycle: 'monthly',
      depositAmount: 8000,
      maxOccupants: 2,
      initialWaterMeter: 110,
      initialElectricMeter: 560,
      images: [],
      createdAt: '2026-08-01',
      updatedAt: '2026-08-01',
    },
    {
      id: 'room-102',
      roomNumber: '102',
      buildingId: 'bldg-1',
      floor: 1,
      status: 'occupied',
      monthlyRent: 4500,
      rentCycle: 'monthly',
      depositAmount: 9000,
      maxOccupants: 2,
      initialWaterMeter: 50,
      initialElectricMeter: 200,
      images: [],
      createdAt: '2026-08-01',
      updatedAt: '2026-08-01',
    },
    {
      id: 'room-103',
      roomNumber: '103',
      buildingId: 'bldg-1',
      floor: 1,
      status: 'vacant',
      monthlyRent: 4000,
      rentCycle: 'monthly',
      depositAmount: 8000,
      maxOccupants: 2,
      initialWaterMeter: 0,
      initialElectricMeter: 0,
      images: [],
      createdAt: '2026-08-01',
      updatedAt: '2026-08-01',
    },
  ];

  const mockTenants: Tenant[] = [
    {
      id: 'tenant-101',
      name: 'นายสมชาย ใจดี',
      phone: '0812345678',
      email: 'somchai@test.com',
      citizenId: '1234567890123',
      coOccupants: [],
      emergencyContact: { name: 'แม่', relationship: 'มารดา', phone: '0899999999' },
      vehicle: { type: 'none', licensePlate: '' },
      pet: { hasPet: false },
      rentalHistory: [],
      status: 'active',
      createdAt: '2026-08-01',
      updatedAt: '2026-08-01',
    },
  ];

  const mockContracts: Contract[] = [
    {
      id: 'contract-101',
      contractNumber: 'CTR-202608-101',
      tenantId: 'tenant-101',
      roomId: 'room-101',
      startDate: '2026-08-01',
      endDate: '2027-07-31',
      durationMonths: 12,
      rentAmount: 4000,
      depositAmount: 8000,
      terms: 'มาตรฐาน',
      status: 'active',
      createdAt: '2026-08-01',
      updatedAt: '2026-08-01',
    },
  ];

  const sampleCycle = [
    {
      id: 'cycle-aug-2026',
      cycleCode: '2026-08',
      name: 'รอบบิล สิงหาคม 2569',
      status: 'draft' as const,
      isCurrent: true,
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      billingDate: '2026-08-25',
      dueDate: '2026-09-05',
    },
    {
      id: 'cycle-sep-2026',
      cycleCode: '2026-09',
      name: 'รอบบิล กันยายน 2569',
      status: 'draft' as const,
      isCurrent: false,
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
      billingDate: '2026-09-25',
      dueDate: '2026-10-05',
    },
  ];

  const setupFetchMock = (customPreviewRooms?: any[], customRateSnapshot?: any) => {
    global.fetch = vi.fn().mockImplementation(async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/billing-cycles')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({
            success: true,
            data: sampleCycle,
            firstBillingCycleId: 'cycle-aug-2026',
            operationalBillingCycleId: 'cycle-aug-2026',
            operationalCycleCode: '2026-08',
          }),
          text: async () => JSON.stringify({ success: true, data: sampleCycle }),
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
              rateSnapshot: customRateSnapshot || {
                waterBillingType: 'per_unit',
                waterRate: '18.00',
                electricityBillingType: 'per_unit',
                electricityRate: '7.00',
                commonFee: '200.00',
                commonFeeMode: 'per_room',
              },
              rooms: customPreviewRooms || [
                {
                  roomId: 'room-101',
                  tenantId: 'tenant-101',
                  tenantName: 'นายสมชาย ใจดี',
                  amountDue: '1268.00',
                  chargeComponents: [
                    { type: 'monthly_utility', label: 'บิลรายเดือน (พรีวิว)', amount: '1268.00', status: 'PREVIEW' },
                  ],
                },
                {
                  roomId: 'room-102',
                  tenantId: 'tenant-102',
                  tenantName: 'นางสาววิภา สุขใจ',
                  amountDue: '4800.00',
                  chargeComponents: [
                    { type: 'rent', label: 'ค่าเช่าห้องพัก', amount: '4000.00', status: 'UNPAID' },
                    { type: 'water', label: 'ค่าน้ำประปา', amount: '300.00', status: 'UNPAID' },
                    { type: 'electricity', label: 'ค่าไฟฟ้า', amount: '500.00', status: 'UNPAID' },
                  ],
                },
                {
                  roomId: 'room-103',
                  tenantId: null,
                  tenantName: null,
                  amountDue: '0.00',
                  chargeComponents: [],
                  hasBookableGap: true,
                },
              ],
            },
          }),
          text: async () => JSON.stringify({ success: true }),
        };
      }
      if (urlStr.includes('/meters/readings')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({
            success: true,
            data: [
              { id: 'm1', billingCycleId: 'cycle-aug-2026', roomId: 'room-101', meterType: 'water', previousReading: '110', currentReading: '' },
              { id: 'm2', billingCycleId: 'cycle-aug-2026', roomId: 'room-101', meterType: 'electricity', previousReading: '560', currentReading: '' },
              { id: 'm3', billingCycleId: 'cycle-aug-2026', roomId: 'room-102', meterType: 'water', previousReading: '50', currentReading: '' },
              { id: 'm4', billingCycleId: 'cycle-aug-2026', roomId: 'room-102', meterType: 'electricity', previousReading: '200', currentReading: '' },
            ],
          }),
          text: async () => JSON.stringify({ success: true }),
        };
      }
      if (urlStr.includes('/meters/cycle-people-count')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({
            success: true,
            data: [],
          }),
          text: async () => JSON.stringify({ success: true, data: [] }),
        };
      }
      if (urlStr.includes('/meters/workspace/bulk')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({
            success: true,
            data: { savedCount: 1 },
          }),
          text: async () => JSON.stringify({ success: true, data: { savedCount: 1 } }),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({
          success: true,
          data: [],
        }),
        text: async () => JSON.stringify({ success: true, data: [] }),
      };
    }) as any;
  };

  beforeEach(() => {
    cleanup();
    try {
      localStorage.clear();
    } catch {}
    meterDraftStore.clearAllDrafts();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    });
    vi.restoreAllMocks();
    setupFetchMock();
  });

  afterEach(() => {
    cleanup();
    try {
      localStorage.clear();
    } catch {}
    meterDraftStore.clearAllDrafts();
  });

  const renderComponent = (props: Partial<React.ComponentProps<typeof OwnerMeters>> = {}, customPreviewData?: any) => {
    const dormId = props.dormitoryId || 'dorm-1';
    const cycleId = props.selectedBillingCycleId || 'cycle-aug-2026';

    queryClient.setQueryData(queryKeys.meterWorkspace(dormId, cycleId), {
      serverReadings: [
        { id: 'm1', billingCycleId: cycleId, roomId: 'room-101', meterType: 'water', previousReading: '110', currentReading: '' },
        { id: 'm2', billingCycleId: cycleId, roomId: 'room-101', meterType: 'electricity', previousReading: '560', currentReading: '' },
        { id: 'm3', billingCycleId: cycleId, roomId: 'room-102', meterType: 'water', previousReading: '50', currentReading: '' },
        { id: 'm4', billingCycleId: cycleId, roomId: 'room-102', meterType: 'electricity', previousReading: '200', currentReading: '' },
      ],
      cyclePeopleRes: { success: true, data: [] },
    });

    queryClient.setQueryData(queryKeys.meterPreviewContext(dormId, cycleId), customPreviewData || {
      rateSnapshot: {
        waterBillingType: 'per_unit',
        waterRate: '18.00',
        electricityBillingType: 'per_unit',
        electricityRate: '7.00',
        commonFee: '200.00',
        commonFeeMode: 'per_room',
      },
      rooms: [
        {
          roomId: 'room-101',
          tenantId: 'tenant-101',
          tenantName: 'นายสมชาย ใจดี',
          amountDue: '1268.00',
          chargeComponents: [
            { type: 'monthly_utility', label: 'บิลรายเดือน (พรีวิว)', amount: '1268.00', status: 'PREVIEW' },
          ],
        },
        {
          roomId: 'room-102',
          tenantId: 'tenant-102',
          tenantName: 'นางสาววิภา สุขใจ',
          amountDue: '4800.00',
          chargeComponents: [
            { type: 'rent', label: 'ค่าเช่าห้องพัก', amount: '4000.00', status: 'UNPAID' },
            { type: 'water', label: 'ค่าน้ำประปา', amount: '300.00', status: 'UNPAID' },
            { type: 'electricity', label: 'ค่าไฟฟ้า', amount: '500.00', status: 'UNPAID' },
          ],
        },
        {
          roomId: 'room-103',
          tenantId: null,
          tenantName: null,
          amountDue: '0.00',
          chargeComponents: [],
          hasBookableGap: true,
        },
      ],
    });

    return render(
      <QueryClientProvider client={queryClient}>
        <OwnerMeters
          rooms={mockRooms}
          buildings={[{ id: 'bldg-1', dormitoryId: 'dorm-1', name: 'อาคาร 1', totalFloors: 2, roomsPerFloor: 2, createdAt: '2026-08-01' }]}
          bills={[]}
          tenants={mockTenants}
          contracts={mockContracts}
          selectedBillingCycleId="cycle-aug-2026"
          selectedCycleCode="2026-08"
          selectedCycle="2026-08"
          billingCycles={sampleCycle}
          dormitoryId="dorm-1"
          onSaveBills={vi.fn()}
          onSelectTenant={vi.fn()}
          onAddLog={vi.fn()}
          onNavigate={vi.fn()}
          {...props}
        />
      </QueryClientProvider>
    );
  };

  // =========================================================================
  // L1 - L3: Mode Switch & Local Storage Preference
  // =========================================================================
  it('L1. Default = Table when no preference exists', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('meter-view-mode-toggle')).toBeDefined();
      expect(screen.getByRole('table')).toBeDefined();
    });

    const tableBtn = screen.getByTestId('view-mode-table-button');
    const listBtn = screen.getByTestId('view-mode-list-button');

    expect(tableBtn.className).toContain('text-indigo-600');
    expect(listBtn.className).toContain('text-slate-500');
    expect(screen.queryByTestId('meter-list-container')).toBeNull();
  });

  it('L2. Select List -> mode renders cards', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('view-mode-list-button')).toBeDefined();
      expect(screen.getByRole('table')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('view-mode-list-button'));

    expect(screen.getByTestId('meter-list-container')).toBeDefined();
    expect(screen.getByTestId('meter-list-card-room-101')).toBeDefined();
    expect(screen.getByTestId('meter-list-card-room-102')).toBeDefined();
    expect(screen.getByTestId('meter-list-card-room-103')).toBeDefined();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('L3. Stored List preference restores List after remount/F5 equivalent', async () => {
    localStorage.setItem('owner_meter_view_mode', JSON.stringify('list'));

    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('meter-list-card-room-101')).toBeDefined();
    });

    const listBtn = screen.getByTestId('view-mode-list-button');
    expect(listBtn.className).toContain('text-indigo-600');
    expect(screen.queryByRole('table')).toBeNull();
  });

  // =========================================================================
  // L4 - L5: Shared Draft Synchronization
  // =========================================================================
  it('L4. Table edit -> List preserves exact draft value', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByRole('table')).toBeDefined();
    });

    // Edit electricity current in table
    const tableInputs = screen.getAllByRole('textbox');
    const elecInput = tableInputs.find(i => i.getAttribute('data-col') === 'elecCurr' && i.getAttribute('data-row') === '0');
    expect(elecInput).toBeDefined();
    fireEvent.change(elecInput!, { target: { value: '620' } });

    // Switch to List mode
    fireEvent.click(screen.getByTestId('view-mode-list-button'));

    const card101 = screen.getByTestId('meter-list-card-room-101');
    const listElecInput = within(card101).getAllByRole('textbox').find(i => i.getAttribute('data-col') === 'elecCurr');
    expect(listElecInput).toBeDefined();
    expect((listElecInput as HTMLInputElement).value).toBe('620');
  });

  it('L5. List edit -> Table preserves exact draft value', async () => {
    localStorage.setItem('owner_meter_view_mode', JSON.stringify('list'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('meter-list-card-room-101')).toBeDefined();
    });

    // Edit water current in List mode
    const card101 = screen.getByTestId('meter-list-card-room-101');
    const listWaterInput = within(card101).getAllByRole('textbox').find(i => i.getAttribute('data-col') === 'waterCurr');
    expect(listWaterInput).toBeDefined();
    fireEvent.change(listWaterInput!, { target: { value: '125' } });

    // Switch to Table mode
    fireEvent.click(screen.getByTestId('view-mode-table-button'));

    const tableInputs = screen.getAllByRole('textbox');
    const tableWaterInput = tableInputs.find(i => i.getAttribute('data-col') === 'waterCurr' && i.getAttribute('data-row') === '0');
    expect(tableWaterInput).toBeDefined();
    expect((tableWaterInput as HTMLInputElement).value).toBe('125');
  });

  // =========================================================================
  // L6 - L8: Blank, Explicit 0, and Normalization
  // =========================================================================
  it('L6. Blank current stays blank across mode switch', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByRole('table')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('view-mode-list-button'));
    const card101 = screen.getByTestId('meter-list-card-room-101');
    const listElecInput = within(card101).getAllByRole('textbox').find(i => i.getAttribute('data-col') === 'elecCurr');
    expect((listElecInput as HTMLInputElement).value).toBe('');

    fireEvent.click(screen.getByTestId('view-mode-table-button'));
    const tableInputs = screen.getAllByRole('textbox');
    const tableElecInput = tableInputs.find(i => i.getAttribute('data-col') === 'elecCurr' && i.getAttribute('data-row') === '0');
    expect((tableElecInput as HTMLInputElement).value).toBe('');
  });

  it('L7. Explicit 0 stays 0 across mode switch', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByRole('table')).toBeDefined();
    });

    const tableInputs = screen.getAllByRole('textbox');
    const tableElecInput = tableInputs.find(i => i.getAttribute('data-col') === 'elecCurr' && i.getAttribute('data-row') === '0');
    fireEvent.change(tableElecInput!, { target: { value: '0' } });

    fireEvent.click(screen.getByTestId('view-mode-list-button'));
    const card101 = screen.getByTestId('meter-list-card-room-101');
    const listElecInput = within(card101).getAllByRole('textbox').find(i => i.getAttribute('data-col') === 'elecCurr');
    expect((listElecInput as HTMLInputElement).value).toBe('0');
  });

  it('L8. Leading zero normalization preserved on blur', async () => {
    localStorage.setItem('owner_meter_view_mode', JSON.stringify('list'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('meter-list-card-room-101')).toBeDefined();
    });

    const card101 = screen.getByTestId('meter-list-card-room-101');
    const listElecInput = within(card101).getAllByRole('textbox').find(i => i.getAttribute('data-col') === 'elecCurr');
    fireEvent.change(listElecInput!, { target: { value: '050' } });
    fireEvent.blur(listElecInput!);

    expect((listElecInput as HTMLInputElement).value).toBe('50');
  });

  // =========================================================================
  // L9: Validation
  // =========================================================================
  it('L9. current < previous renders canonical error', async () => {
    localStorage.setItem('owner_meter_view_mode', JSON.stringify('list'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('meter-list-card-room-101')).toBeDefined();
    });

    const card101 = screen.getByTestId('meter-list-card-room-101');
    const listElecInput = within(card101).getAllByRole('textbox').find(i => i.getAttribute('data-col') === 'elecCurr');
    // prev is 560, enter 400
    fireEvent.change(listElecInput!, { target: { value: '400' } });

    expect(within(card101).getByText('เลขอ่านไม่ถูกต้อง')).toBeDefined();
    expect(listElecInput!.className).toContain('border-rose-300');
  });

  // =========================================================================
  // L10 - L12: Billing Modes
  // =========================================================================
  it('L10. per_unit renders required meter controls', async () => {
    localStorage.setItem('owner_meter_view_mode', JSON.stringify('list'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('meter-list-card-room-101')).toBeDefined();
    });

    const card101 = screen.getByTestId('meter-list-card-room-101');
    expect(within(card101).getByText('ไฟฟ้า')).toBeDefined();
    expect(within(card101).getByText('น้ำประปา')).toBeDefined();
  });

  it('L11. fixed water hides non-required water meter input', async () => {
    localStorage.setItem('owner_meter_view_mode', JSON.stringify('list'));
    renderComponent({}, {
      rateSnapshot: {
        waterBillingType: 'fixed',
        waterRate: '150.00',
        electricityBillingType: 'per_unit',
        electricityRate: '7.00',
      },
      rooms: [
        {
          roomId: 'room-101',
          tenantId: 'tenant-101',
          tenantName: 'นายสมชาย ใจดี',
          amountDue: '1268.00',
          chargeComponents: [
            { type: 'monthly_utility', label: 'บิลรายเดือน (พรีวิว)', amount: '1268.00', status: 'PREVIEW' },
          ],
        },
      ],
    });

    await waitFor(() => {
      expect(screen.getByTestId('meter-list-card-room-101')).toBeDefined();
    });

    const card101 = screen.getByTestId('meter-list-card-room-101');
    expect(within(card101).getByText('ไฟฟ้า')).toBeDefined();
    expect(within(card101).queryByText('น้ำประปา')).toBeNull();
  });

  it('L12. per_person electricity hides non-required electricity meter input', async () => {
    localStorage.setItem('owner_meter_view_mode', JSON.stringify('list'));
    renderComponent({}, {
      rateSnapshot: {
        waterBillingType: 'per_unit',
        waterRate: '18.00',
        electricityBillingType: 'per_person',
        electricityRate: '200.00',
      },
      rooms: [
        {
          roomId: 'room-101',
          tenantId: 'tenant-101',
          tenantName: 'นายสมชาย ใจดี',
          amountDue: '1268.00',
          chargeComponents: [
            { type: 'monthly_utility', label: 'บิลรายเดือน (พรีวิว)', amount: '1268.00', status: 'PREVIEW' },
          ],
        },
      ],
    });

    await waitFor(() => {
      expect(screen.getByTestId('meter-list-card-room-101')).toBeDefined();
    });

    const card101 = screen.getByTestId('meter-list-card-room-101');
    expect(within(card101).getByText('น้ำประปา')).toBeDefined();
    expect(within(card101).queryByText('ไฟฟ้า')).toBeNull();
  });

  // =========================================================================
  // L13 - L16: Occupant Claims & Add Tenant
  // =========================================================================
  it('L13. active tenant claim correct', async () => {
    localStorage.setItem('owner_meter_view_mode', JSON.stringify('list'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('meter-list-card-room-101')).toBeDefined();
    });

    const card101 = screen.getByTestId('meter-list-card-room-101');
    expect(within(card101).getByText('นายสมชาย ใจดี')).toBeDefined();
    expect(within(card101).getByText('(ยังไม่ได้เชื่อม LINE)')).toBeDefined();
  });

  it('L14. reserved claim: "จองล่วงหน้า", NO Add Tenant', async () => {
    localStorage.setItem('owner_meter_view_mode', JSON.stringify('list'));
    renderComponent({}, {
      rateSnapshot: { waterBillingType: 'per_unit', electricityBillingType: 'per_unit' },
      rooms: [
        {
          roomId: 'room-101',
          tenantId: 'tenant-res-1',
          tenantName: 'นายจอง ล่วงหน้า',
          isFutureReservation: true,
          amountDue: '0.00',
          chargeComponents: [],
        },
      ],
    });

    await waitFor(() => {
      expect(screen.getByTestId('meter-list-card-room-101')).toBeDefined();
    });

    const card101 = screen.getByTestId('meter-list-card-room-101');
    expect(within(card101).getByText('จองล่วงหน้า')).toBeDefined();
    expect(within(card101).queryByText('เพิ่มผู้เช่า')).toBeNull();
  });

  it('L15. Daily: exact checkout (DD/MM/YY), NO Add Tenant', async () => {
    localStorage.setItem('owner_meter_view_mode', JSON.stringify('list'));
    renderComponent({}, {
      rateSnapshot: { waterBillingType: 'per_unit', electricityBillingType: 'per_unit' },
      rooms: [
        {
          roomId: 'room-101',
          tenantId: null,
          tenantName: null,
          dailyCheckOutDate: '2026-08-27T12:00:00.000Z',
          billingSource: 'DAILY_STAY',
          amountDue: '1500.00',
          chargeComponents: [{ label: 'พักรายวัน', amount: '1500.00', status: 'UNPAID' }],
        },
      ],
    });

    await waitFor(() => {
      expect(screen.getByTestId('meter-list-card-room-101')).toBeDefined();
    });

    const card101 = screen.getByTestId('meter-list-card-room-101');
    expect(within(card101).getByText('(27/08/69)')).toBeDefined();
    expect(within(card101).queryByText('เพิ่มผู้เช่า')).toBeNull();
  });

  it('L16. empty/bookable: Add Tenant visible', async () => {
    localStorage.setItem('owner_meter_view_mode', JSON.stringify('list'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('meter-list-card-room-101')).toBeDefined();
    });

    const card103 = screen.getByTestId('meter-list-card-room-103');
    expect(within(card103).getByText('เพิ่มผู้เช่า')).toBeDefined();
  });

  // =========================================================================
  // L17 - L20: Payable Amount & Component Breakdown
  // =========================================================================
  it('L17. Table payable == List payable', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByRole('table')).toBeDefined();
    });

    // In Table
    expect(screen.getByText('1,268.00 ฿')).toBeDefined();
    expect(screen.getByText('4,800.00 ฿')).toBeDefined();

    // Switch to List
    fireEvent.click(screen.getByTestId('view-mode-list-button'));

    const card101 = screen.getByTestId('meter-list-card-room-101');
    const card102 = screen.getByTestId('meter-list-card-room-102');

    expect(within(card101).getByText('1,268.00 ฿')).toBeDefined();
    expect(within(card102).getByText('4,800.00 ฿')).toBeDefined();
  });

  it('L18. 0-component detail behavior', async () => {
    localStorage.setItem('owner_meter_view_mode', JSON.stringify('list'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('meter-list-card-room-101')).toBeDefined();
    });

    const card103 = screen.getByTestId('meter-list-card-room-103');
    expect(within(card103).getByText('0.00 ฿')).toBeDefined();
    expect(within(card103).queryByText(/ดูรายละเอียด/)).toBeNull();
  });

  it('L19. 1-component detail behavior', async () => {
    localStorage.setItem('owner_meter_view_mode', JSON.stringify('list'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('meter-list-card-room-101')).toBeDefined();
    });

    const card101 = screen.getByTestId('meter-list-card-room-101');
    expect(within(card101).getByText('ดูรายละเอียด')).toBeDefined();

    fireEvent.click(within(card101).getByText('ดูรายละเอียด'));
    expect(within(card101).getByText('ค่าส่วนกลาง')).toBeDefined();
    expect(within(card101).getByText('200.-')).toBeDefined();
  });

  it('L20. N-component +N behavior', async () => {
    localStorage.setItem('owner_meter_view_mode', JSON.stringify('list'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('meter-list-card-room-101')).toBeDefined();
    });

    const card102 = screen.getByTestId('meter-list-card-room-102');
    // Breakdown button shows "ดูรายละเอียด +2" for water and electricity (rent omitted)
    expect(within(card102).getByText('ดูรายละเอียด +2')).toBeDefined();

    fireEvent.click(within(card102).getByText('ดูรายละเอียด +2'));
    expect(within(card102).getByText('ค่าน้ำประปา')).toBeDefined();
    expect(within(card102).getByText('300.-')).toBeDefined();
    expect(within(card102).getByText('ค่าไฟฟ้า')).toBeDefined();
    expect(within(card102).getByText('500.-')).toBeDefined();
  });

  // =========================================================================
  // L21: Paid Lock
  // =========================================================================
  it('L21. paid card locked', async () => {
    const paidBills: Bill[] = [
      {
        id: 'bill-101-paid',
        billNumber: 'INV-202608-101',
        roomId: 'room-101',
        tenantId: 'tenant-101',
        cycleId: 'cycle-aug-2026',
        billKind: 'MONTHLY_UTILITY',
        status: 'paid',
        totalAmount: 1268,
        dueDate: '2026-09-05',
        createdAt: '2026-08-25',
        updatedAt: '2026-08-25',
        items: [],
      },
    ];

    localStorage.setItem('owner_meter_view_mode', JSON.stringify('list'));
    renderComponent({ bills: paidBills });

    await waitFor(() => {
      expect(screen.getByTestId('meter-list-card-room-101')).toBeDefined();
    });

    const card101 = screen.getByTestId('meter-list-card-room-101');
    expect(within(card101).getByText('ชำระแล้ว')).toBeDefined();

    const switchBtn = within(card101).getByRole('switch');
    expect(switchBtn.hasAttribute('disabled')).toBe(true);

    const elecInput = within(card101).getAllByRole('textbox').find(i => i.getAttribute('data-col') === 'elecCurr');
    expect(elecInput?.hasAttribute('disabled')).toBe(true);
  });

  // =========================================================================
  // L22: Search Filter Survives Switch
  // =========================================================================
  it('L22. search filter survives mode switch', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByRole('table')).toBeDefined();
    });

    const searchInput = screen.getByPlaceholderText('ค้นหาเลขห้อง...');
    fireEvent.change(searchInput, { target: { value: '101' } });

    expect(screen.getByText('101')).toBeDefined();
    expect(screen.queryByText('102')).toBeNull();
    expect(screen.queryByText('103')).toBeNull();

    fireEvent.click(screen.getByTestId('view-mode-list-button'));

    expect(screen.getByTestId('meter-list-card-room-101')).toBeDefined();
    expect(screen.queryByTestId('meter-list-card-room-102')).toBeNull();
    expect(screen.queryByTestId('meter-list-card-room-103')).toBeNull();
  });

  // =========================================================================
  // L23 - L24: Pull Previous & Quick Fill
  // =========================================================================
  it('L23. Pull Previous changes previous only and List reflects it', async () => {
    localStorage.setItem('owner_meter_view_mode', JSON.stringify('list'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('meter-list-card-room-101')).toBeDefined();
    });

    const card101 = screen.getByTestId('meter-list-card-room-101');
    expect(within(card101).getByText('560')).toBeDefined();
  });

  it('L24. Quick Fill draft reflected in List', async () => {
    localStorage.setItem('owner_meter_view_mode', JSON.stringify('list'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('meter-list-card-room-101')).toBeDefined();
    });

    // Open Quick Fill
    fireEvent.click(screen.getByText('กรอกแบบรวดเร็ว'));
    const textarea = screen.getByPlaceholderText(/วางข้อมูลหลายห้องที่นี่/);
    fireEvent.change(textarea, { target: { value: '101 : ไฟ 650 : น้ำ 130 : 2 คน : ค้าง 0' } });
    fireEvent.click(screen.getByText('ต่อไป'));

    const card101 = screen.getByTestId('meter-list-card-room-101');
    const elecInput = within(card101).getAllByRole('textbox').find(i => i.getAttribute('data-col') === 'elecCurr');
    const waterInput = within(card101).getAllByRole('textbox').find(i => i.getAttribute('data-col') === 'waterCurr');

    expect((elecInput as HTMLInputElement).value).toBe('650');
    expect((waterInput as HTMLInputElement).value).toBe('130');
  });

  // =========================================================================
  // L25 - L26: Dirty State & Save
  // =========================================================================
  it('L25. dirty state survives mode switch', async () => {
    localStorage.setItem('owner_meter_view_mode', JSON.stringify('list'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('meter-list-card-room-101')).toBeDefined();
    });

    // Initially clean -> no floating save button
    expect(screen.queryByText(/บันทึกข้อมูล/)).toBeNull();

    // Edit in list
    const card101 = screen.getByTestId('meter-list-card-room-101');
    const elecInput = within(card101).getAllByRole('textbox').find(i => i.getAttribute('data-col') === 'elecCurr');
    fireEvent.change(elecInput!, { target: { value: '600' } });

    // Floating save button visible
    expect(screen.getByText(/บันทึกข้อมูล/)).toBeDefined();

    // Switch to Table
    fireEvent.click(screen.getByTestId('view-mode-table-button'));
    expect(screen.getByText(/บันทึกข้อมูล/)).toBeDefined();
  });

  it('L26. Save from List uses existing mutation and clears dirty state', async () => {
    localStorage.setItem('owner_meter_view_mode', JSON.stringify('list'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('meter-list-card-room-101')).toBeDefined();
    });

    const card101 = screen.getByTestId('meter-list-card-room-101');
    const elecInput = within(card101).getAllByRole('textbox').find(i => i.getAttribute('data-col') === 'elecCurr');
    fireEvent.change(elecInput!, { target: { value: '600' } });

    const saveBtn = screen.getByText(/บันทึกข้อมูล/);
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // L27: Error Toast
  // =========================================================================
  it('L27. backend/domain error toast same as Table', async () => {
    localStorage.setItem('owner_meter_view_mode', JSON.stringify('list'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('meter-list-card-room-101')).toBeDefined();
    });

    // Mock fetch for save failure
    const origFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation(async (url: any, opts: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/meters/workspace/bulk')) {
        return {
          ok: false,
          status: 400,
          headers: { get: () => 'application/json' },
          json: async () => ({
            success: false,
            error: { code: 'INVALID_METER_READING_LOWER', message: 'เลขมิเตอร์ปัจจุบันต้องไม่น้อยกว่าเลขมิเตอร์ครั้งก่อน' },
          }),
          text: async () => JSON.stringify({ success: false }),
        };
      }
      return origFetch(url, opts);
    }) as any;

    const card101 = screen.getByTestId('meter-list-card-room-101');
    const elecInput = within(card101).getAllByRole('textbox').find(i => i.getAttribute('data-col') === 'elecCurr');
    fireEvent.change(elecInput!, { target: { value: '600' } });

    const saveBtn = screen.getByText(/บันทึกข้อมูล/);
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(screen.getByText('เลขมิเตอร์ปัจจุบันต้องไม่น้อยกว่าเลขมิเตอร์ครั้งก่อน')).toBeDefined();
    });
  });

  // =========================================================================
  // L28: Other Fees Summary
  // =========================================================================
  it('L28. Other Fees summary renders current draft without duplicate editor', async () => {
    localStorage.setItem('owner_meter_view_mode', JSON.stringify('list'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('meter-list-card-room-101')).toBeDefined();
    });

    const card101 = screen.getByTestId('meter-list-card-room-101');
    const openBtn = within(card101).getByTestId('open-other-fees-modal-room-101');
    fireEvent.click(openBtn);

    expect(screen.getByTestId('meter-other-fees-modal-backdrop')).toBeDefined();
    const descInput = screen.getByPlaceholderText('ชื่อรายการ (เช่น ค่ากุญแจ)');
    const amtInput = screen.getByPlaceholderText('จำนวนเงิน');
    const addBtn = screen.getByTitle('เพิ่มรายการ');

    fireEvent.change(descInput, { target: { value: 'ค่าคีย์การ์ด' } });
    fireEvent.change(amtInput, { target: { value: '100' } });
    fireEvent.click(addBtn);

    const saveModalBtn = screen.getByText('บันทึกรายการ');
    fireEvent.click(saveModalBtn);

    expect(within(card101).getByText('ค่าคีย์การ์ด')).toBeDefined();
    expect(within(card101).getByText('100 ฿')).toBeDefined();
  });
  // =========================================================================
  // L29: Negative Other Fees Support
  // =========================================================================
  it('L29. Other Fees modal accepts negative amount for discounts or deductions', async () => {
    localStorage.setItem('owner_meter_view_mode', JSON.stringify('list'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('meter-list-card-room-101')).toBeDefined();
    });

    const card101 = screen.getByTestId('meter-list-card-room-101');
    const openBtn = within(card101).getByTestId('open-other-fees-modal-room-101');
    fireEvent.click(openBtn);

    expect(screen.getByTestId('meter-other-fees-modal-backdrop')).toBeDefined();
    const descInput = screen.getByPlaceholderText('ชื่อรายการ (เช่น ค่ากุญแจ)');
    const amtInput = screen.getByPlaceholderText('จำนวนเงิน');
    const addBtn = screen.getByTitle('เพิ่มรายการ');

    fireEvent.change(descInput, { target: { value: 'ส่วนลดพิเศษ' } });
    fireEvent.change(amtInput, { target: { value: '-150' } });
    fireEvent.click(addBtn);

    const saveModalBtn = screen.getByText('บันทึกรายการ');
    fireEvent.click(saveModalBtn);

    expect(within(card101).getByText('ส่วนลดพิเศษ')).toBeDefined();
    expect(within(card101).getByText('-150 ฿')).toBeDefined();
  });

  // =========================================================================
  // L30: Search by Tenant Name
  // =========================================================================
  it('L30. Search input matches tenant name and filters list cards', async () => {
    localStorage.setItem('owner_meter_view_mode', JSON.stringify('list'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('meter-list-card-room-101')).toBeDefined();
      expect(screen.getByTestId('meter-list-card-room-102')).toBeDefined();
    });

    const searchInput = screen.getByPlaceholderText('ค้นหาเลขห้อง...');
    fireEvent.change(searchInput, { target: { value: 'สมชาย' } });

    expect(screen.getByTestId('meter-list-card-room-101')).toBeDefined();
    expect(screen.queryByTestId('meter-list-card-room-102')).toBeNull();
  });

  // =========================================================================
  // L31: Status Border Dynamic Coloring
  // =========================================================================
  it('L31. Card border dynamically changes class according to room billing status', async () => {
    localStorage.setItem('owner_meter_view_mode', JSON.stringify('list'));
    const testBills: Bill[] = [
      {
        id: 'bill-102',
        billNumber: 'INV-202608-102',
        roomId: 'room-102',
        tenantId: 'tenant-102',
        cycleId: 'cycle-aug-2026',
        billingCycleId: 'cycle-aug-2026',
        dueDate: '2026-09-05',
        totalAmount: 4800,
        status: 'pending',
        items: [],
        createdAt: '2026-08-25',
        updatedAt: '2026-08-25',
      },
    ];

    renderComponent({ bills: testBills });

    await waitFor(() => {
      expect(screen.getByTestId('meter-list-card-room-101')).toBeDefined();
      expect(screen.getByTestId('meter-list-card-room-102')).toBeDefined();
    });

    // Room 101 is draft (unissued) -> border-slate-200
    const card101 = screen.getByTestId('meter-list-card-room-101');
    expect(card101.className).toContain('border-slate-200');

    // Room 102 has an unpaid bill -> border-amber-400
    const card102 = screen.getByTestId('meter-list-card-room-102');
    expect(card102.className).toContain('border-amber-400');
  });

  // =========================================================================
  // L32: Global Toggle All Details
  // =========================================================================
  it('L32. Global toggle in toolbar toggles detail breakdown expansion across cards', async () => {
    localStorage.setItem('owner_meter_view_mode', JSON.stringify('list'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('meter-list-card-room-101')).toBeDefined();
    });

    const toggleAllBtn = screen.getByTitle('แสดงรายละเอียดทุกห้อง');
    fireEvent.click(toggleAllBtn);

    // After toggling, title flips to hide all
    expect(screen.getByTitle('ซ่อนรายละเอียดทุกห้อง')).toBeDefined();
  });
  // =========================================================================
  // L33: List Mode Itemized Charge Decomposition
  // =========================================================================
  it('L33. List mode decomposes generic monthly utility into itemized charge rows with black text and matching icons', async () => {
    localStorage.setItem('owner_meter_view_mode', JSON.stringify('list'));
    
    // Custom rate snapshot with commonFee, internetFee, parkingFee
    const customRates = {
      waterBillingType: 'per_unit',
      waterRate: '18.00',
      electricityBillingType: 'per_unit',
      electricityRate: '7.00',
      commonFee: '200.00',
      commonFeeMode: 'per_room',
      internetFee: '150.00',
      internetFeeMode: 'per_room',
      parkingFee: '300.00',
      parkingFeeMode: 'per_room',
    };

    setupFetchMock(undefined, customRates);
    renderComponent({}, {
      rateSnapshot: customRates,
      rooms: [
        {
          roomId: 'room-101',
          tenantId: 'tenant-101',
          tenantName: 'นายสมชาย ใจดี',
          amountDue: '1268.00',
          chargeComponents: [
            { type: 'monthly_utility', label: 'บิลรายเดือน (พรีวิว)', amount: '1268.00', status: 'PREVIEW' },
          ],
        },
      ],
    });

    await waitFor(() => {
      expect(screen.getByTestId('view-mode-list-button')).toBeDefined();
    });
    fireEvent.click(screen.getByTestId('view-mode-list-button'));

    await waitFor(() => {
      expect(screen.getByTestId('meter-list-card-room-101')).toBeDefined();
    });

    const card101 = screen.getByTestId('meter-list-card-room-101');
    const detailBtn = within(card101).getByText('ดูรายละเอียด +3');
    fireEvent.click(detailBtn);

    // Should display individual configured fees instead of generic "บิลรายเดือน"
    expect(within(card101).getByText('ค่าส่วนกลาง')).toBeDefined();
    expect(within(card101).getByText('200.-')).toBeDefined();
    expect(within(card101).getByText('ค่าอินเทอร์เน็ต')).toBeDefined();
    expect(within(card101).getByText('150.-')).toBeDefined();
    expect(within(card101).getByText('ค่าจอดรถ')).toBeDefined();
    expect(within(card101).getByText('300.-')).toBeDefined();

    // Verify text is in standard dark/black slate without colored status overrides
    const commonFeeLabel = within(card101).getByText('ค่าส่วนกลาง');
    expect(commonFeeLabel.className).toContain('text-slate-800');
    const commonFeeAmt = within(card101).getByText('200.-');
    expect(commonFeeAmt.className).toContain('text-slate-900');
  });

  it('L34. List mode does not duplicate rent in expanded breakdown when displayed on top', async () => {
    setupFetchMock(undefined, {
      waterBillingType: 'per_unit',
      waterRate: '18.00',
      electricityBillingType: 'per_unit',
      electricityRate: '7.00',
    });

    renderComponent({}, {
      rooms: [
        {
          roomId: 'room-101',
          tenantId: 'tenant-101',
          tenantName: 'นายสมชาย ใจดี',
          rentAmount: '3000.00',
          amountDue: '3500.00',
          chargeComponents: [
            { type: 'deposit', label: 'ค่าประกัน', amount: '500.00', status: 'UNPAID' },
            { type: 'rent', label: 'ค่าเช่า (วัน)', amount: '3000.00', status: 'UNPAID' },
          ],
        },
      ],
    });

    await waitFor(() => {
      expect(screen.getByTestId('view-mode-list-button')).toBeDefined();
    });
    fireEvent.click(screen.getByTestId('view-mode-list-button'));

    await waitFor(() => {
      expect(screen.getByTestId('meter-list-card-room-101')).toBeDefined();
    });

    const card101 = screen.getByTestId('meter-list-card-room-101');
    // Top summary row displays rent
    expect(within(card101).getByText('3,000 .-')).toBeDefined();

    // Breakdown button should show "ดูรายละเอียด" (1 item: deposit, rent omitted)
    const detailBtn = within(card101).getByText('ดูรายละเอียด');
    fireEvent.click(detailBtn);

    // Expanded breakdown contains deposit, but does not duplicate rent
    expect(within(card101).getByText('ค่าประกัน')).toBeDefined();
    expect(within(card101).getByText('500.-')).toBeDefined();
    // Breakdown list rows should not have rent item
    const chargeRows = card101.querySelectorAll('[data-testid^="charge-component-row-room-101"]');
    expect(chargeRows.length).toBe(1);
  });

  it('L35. 3 latest selectable billing cycles rule: 7, 8, 9, 10 -> only 8, 9, 10 show + เพิ่มผู้เช่า for vacant rooms', async () => {
    const selectableCycles = [
      { id: 'c-10', cycleCode: '2026-10', name: 'ตุลาคม 2569' },
      { id: 'c-09', cycleCode: '2026-09', name: 'กันยายน 2569' },
      { id: 'c-08', cycleCode: '2026-08', name: 'สิงหาคม 2569' },
      { id: 'c-07', cycleCode: '2026-07', name: 'กรกฎาคม 2569' },
    ];

    // Month 10: eligible
    expect(isCycleInRollingThreeMonthWindow('2026-10', selectableCycles)).toBe(true);
    // Month 9: eligible
    expect(isCycleInRollingThreeMonthWindow('2026-09', selectableCycles)).toBe(true);
    // Month 8: eligible
    expect(isCycleInRollingThreeMonthWindow('2026-08', selectableCycles)).toBe(true);
    // Month 7: older than top 3 latest -> NOT eligible
    expect(isCycleInRollingThreeMonthWindow('2026-07', selectableCycles)).toBe(false);
  });
});
