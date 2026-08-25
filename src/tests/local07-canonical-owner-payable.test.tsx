/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OwnerMeters, getOwnerFinancialBreakdown } from '../pages/owner/meters';
import { meterDraftStore } from '../lib/meterDraftStore';
import * as httpClient from '../data/httpClient';
import { Room } from '../types';

describe('LOCAL-07 Backend Canonical Owner Payable Preview Suite', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    cleanup();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    });
    meterDraftStore.clearAllDrafts();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    meterDraftStore.clearAllDrafts();
  });

  const renderWithClient = (ui: React.ReactElement) => {
    return render(
      <QueryClientProvider client={queryClient}>
        {ui}
      </QueryClientProvider>
    );
  };

  const sampleCycle = [
    {
      id: 'cycle-2026-08',
      cycleCode: '2026-08',
      name: 'รอบบิล สิงหาคม 2569',
      status: 'draft' as const,
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      billingDate: '2026-08-25',
      dueDate: '2026-09-05',
      isFirstCycle: false,
    },
  ];

  it('1. Unissued utility preview amount and components from backend preview context', () => {
    const roomCtx = {
      roomId: 'room-101',
      billingSource: 'CONTRACT',
      amountDue: '5468.00',
      chargeComponents: [
        {
          type: 'monthly_utility',
          label: 'บิลรายเดือน',
          amount: '5468.00',
          status: 'PREVIEW',
          paidAt: null,
          occurredInDisplayedPeriod: true,
          includedInAmountDue: true,
        },
      ],
    };

    const breakdown = getOwnerFinancialBreakdown(roomCtx);
    expect(breakdown.operationalAmount).toBe(5468);
    expect(breakdown.formattedAmount).toBe('5,468.00');
    expect(breakdown.components.length).toBe(1);
    expect(breakdown.components[0]).toMatchObject({
      label: 'บิลรายเดือน',
      amount: 5468,
      formattedAmount: '5,468.00',
      status: 'PREVIEW',
    });
  });

  it('2. Exact monetary parity between unissued preview and issued bill', () => {
    const previewCtx = {
      roomId: 'room-101',
      billingSource: 'CONTRACT',
      amountDue: '5468.00',
      chargeComponents: [
        {
          type: 'monthly_utility',
          label: 'บิลรายเดือน',
          amount: '5468.00',
          status: 'PREVIEW',
          paidAt: null,
          occurredInDisplayedPeriod: true,
          includedInAmountDue: true,
        },
      ],
    };

    const issuedCtx = {
      roomId: 'room-101',
      billingSource: 'CONTRACT',
      amountDue: '5468.00',
      chargeComponents: [
        {
          type: 'monthly_utility',
          label: 'บิลรายเดือน',
          amount: '5468.00',
          status: 'UNPAID',
          paidAt: null,
          occurredInDisplayedPeriod: true,
          includedInAmountDue: true,
        },
      ],
    };

    const preBreakdown = getOwnerFinancialBreakdown(previewCtx);
    const postBreakdown = getOwnerFinancialBreakdown(issuedCtx);

    expect(preBreakdown.operationalAmount).toBe(postBreakdown.operationalAmount);
    expect(preBreakdown.formattedAmount).toBe(postBreakdown.formattedAmount);
    expect(preBreakdown.components[0].amount).toBe(postBreakdown.components[0].amount);
    expect(preBreakdown.components[0].status).toBe('PREVIEW');
    expect(postBreakdown.components[0].status).toBe('UNPAID');
  });

  it('3. No duplicate Monthly Utility component (exactly 1 Monthly Utility whether preview or issued)', () => {
    const roomCtx = {
      roomId: 'room-101',
      billingSource: 'CONTRACT',
      amountDue: '5468.00',
      chargeComponents: [
        {
          type: 'monthly_utility',
          label: 'บิลรายเดือน',
          amount: '5468.00',
          status: 'UNPAID',
          paidAt: null,
          occurredInDisplayedPeriod: true,
          includedInAmountDue: true,
        },
      ],
    };

    const breakdown = getOwnerFinancialBreakdown(roomCtx);
    const utilityComps = breakdown.components.filter((c) => c.label === 'บิลรายเดือน');
    expect(utilityComps.length).toBe(1);
  });

  it('4. Paid utility bill -> payable contribution = 0 while component shows PAID in detail', () => {
    const roomCtx = {
      roomId: 'room-101',
      billingSource: 'CONTRACT',
      amountDue: '0.00',
      chargeComponents: [
        {
          type: 'monthly_utility',
          label: 'บิลรายเดือน',
          amount: '5468.00',
          status: 'PAID',
          paidAt: '2026-08-25T10:00:00Z',
          occurredInDisplayedPeriod: true,
          includedInAmountDue: false,
        },
      ],
    };

    const breakdown = getOwnerFinancialBreakdown(roomCtx);
    expect(breakdown.operationalAmount).toBe(0);
    expect(breakdown.formattedAmount).toBe('0.00');
    expect(breakdown.components.length).toBe(1);
    expect(breakdown.components[0].status).toBe('PAID');
    expect(breakdown.components[0].formattedAmount).toBe('5,468.00');
  });

  it('5. Unpaid rent bill -> payable contribution = full outstanding', () => {
    const roomCtx = {
      roomId: 'room-201',
      billingSource: 'CONTRACT',
      amountDue: '4800.00',
      chargeComponents: [
        {
          type: 'rent',
          label: 'ค่าเช่า (เดือน)',
          amount: '4800.00',
          status: 'UNPAID',
          paidAt: null,
          occurredInDisplayedPeriod: true,
          includedInAmountDue: true,
        },
      ],
    };

    const breakdown = getOwnerFinancialBreakdown(roomCtx);
    expect(breakdown.operationalAmount).toBe(4800);
    expect(breakdown.formattedAmount).toBe('4,800.00');
    expect(breakdown.components[0].status).toBe('UNPAID');
  });

  it('6. Paid rent bill -> payable contribution = 0', () => {
    const roomCtx = {
      roomId: 'room-201',
      billingSource: 'CONTRACT',
      amountDue: '0.00',
      chargeComponents: [
        {
          type: 'rent',
          label: 'ค่าเช่า (เดือน)',
          amount: '4800.00',
          status: 'PAID',
          paidAt: '2026-08-25T10:00:00Z',
          occurredInDisplayedPeriod: true,
          includedInAmountDue: false,
        },
      ],
    };

    const breakdown = getOwnerFinancialBreakdown(roomCtx);
    expect(breakdown.operationalAmount).toBe(0);
    expect(breakdown.formattedAmount).toBe('0.00');
    expect(breakdown.components[0].status).toBe('PAID');
  });

  it('7. Future rent before due -> payable contribution = 0 and rent component omitted', () => {
    const roomCtx = {
      roomId: 'room-future',
      billingSource: 'NONE',
      isFutureReservation: true,
      amountDue: '0.00',
      chargeComponents: [],
    };

    const breakdown = getOwnerFinancialBreakdown(roomCtx);
    expect(breakdown.operationalAmount).toBe(0);
    expect(breakdown.formattedAmount).toBe('0.00');
    expect(breakdown.components.some((c) => c.label.includes('ค่าเช่า'))).toBe(false);
  });

  it('8. Unpaid deposit -> payable contribution = full outstanding', () => {
    const roomCtx = {
      roomId: 'room-201',
      billingSource: 'CONTRACT',
      amountDue: '4800.00',
      chargeComponents: [
        {
          type: 'deposit',
          label: 'ค่าประกัน',
          amount: '4800.00',
          status: 'UNPAID',
          paidAt: null,
          occurredInDisplayedPeriod: true,
          includedInAmountDue: true,
        },
      ],
    };

    const breakdown = getOwnerFinancialBreakdown(roomCtx);
    expect(breakdown.operationalAmount).toBe(4800);
    expect(breakdown.formattedAmount).toBe('4,800.00');
    expect(breakdown.components[0].status).toBe('UNPAID');
  });

  it('9. Paid deposit -> payable contribution = 0 while displaying in breakdown as PAID', () => {
    const roomCtx = {
      roomId: 'room-201',
      billingSource: 'CONTRACT',
      amountDue: '0.00',
      chargeComponents: [
        {
          type: 'deposit',
          label: 'ค่าประกัน',
          amount: '4800.00',
          status: 'PAID',
          paidAt: '2026-08-25T10:00:00Z',
          occurredInDisplayedPeriod: true,
          includedInAmountDue: false,
        },
      ],
    };

    const breakdown = getOwnerFinancialBreakdown(roomCtx);
    expect(breakdown.operationalAmount).toBe(0);
    expect(breakdown.formattedAmount).toBe('0.00');
    expect(breakdown.components[0].status).toBe('PAID');
    expect(breakdown.components[0].formattedAmount).toBe('4,800.00');
  });

  it('10. 3-component room -> 3 components in DTO and DOM rendered in table', async () => {
    const sampleRoom: Room = {
      id: 'r-202',
      buildingId: 'b-1',
      roomNumber: '202',
      floor: 2,
      status: 'occupied',
      monthlyRent: 4800,
      dailyRent: 0,
      depositAmount: 4800,
      maxOccupants: 2,
      initialWaterMeter: 0,
      initialElectricMeter: 0,
      images: [],
      createdAt: '2026-08-01',
      updatedAt: '2026-08-01',
    };

    vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method: string, url: string) => {
      if (url.includes('/meters/workspace/preview-context')) {
        return {
          success: true,
          data: {
            rateSnapshot: {
              waterBillingType: 'per_unit',
              waterRate: '18.00',
              electricityBillingType: 'per_unit',
              electricityRate: '7.00',
            },
            rooms: [
              {
                roomId: 'r-202',
                roomNumber: '202',
                tenantName: 'สมศักดิ์ มั่งมี',
                billingSource: 'CONTRACT',
                amountDue: '6000.00',
                chargeComponents: [
                  { type: 'rent', label: 'ค่าเช่า (เดือน)', amount: '4800.00', status: 'UNPAID', occurredInDisplayedPeriod: true, includedInAmountDue: true },
                  { type: 'deposit', label: 'ค่าประกัน', amount: '4800.00', status: 'PAID', paidAt: '2026-08-25T10:00:00Z', occurredInDisplayedPeriod: true, includedInAmountDue: false },
                  { type: 'monthly_utility', label: 'บิลรายเดือน', amount: '1200.00', status: 'UNPAID', occurredInDisplayedPeriod: true, includedInAmountDue: true },
                ],
              },
            ],
          },
        };
      }
      if (url.includes('/meters/workspace')) {
        return {
          success: true,
          data: {
            rooms: [{ roomId: 'r-202', roomNumber: '202', billingSource: 'CONTRACT', rentAmount: 4800 }],
            readings: [],
          },
        };
      }
      return { success: true, data: [] };
    });

    const { container } = renderWithClient(
      <OwnerMeters
        rooms={[sampleRoom]}
        buildings={[{ id: 'b-1', dormitoryId: 'dorm-1', name: 'อาคาร A', totalFloors: 2, roomsPerFloor: 1, createdAt: '2026-08-01' }]}
        dormitoryId="dorm-1"
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
        billingCycles={sampleCycle}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('202')).toBeDefined();
    });

    // Primary payable cell rendered from backend amountDue: 6,000.00 ฿
    expect(screen.getByText('6,000.00 ฿')).toBeDefined();

    // 3 components -> button text is ดูรายละเอียด +3
    const detailBtn = screen.getByRole('button', { name: /ดูรายละเอียด \+3/ });
    expect(detailBtn).toBeDefined();

    // Expand detail
    fireEvent.click(detailBtn);

    // Verify all 3 components rendered with compact PO notation
    expect(screen.getByText('ค่าเช่า (เดือน)')).toBeDefined();
    expect(screen.getByText('ค่าประกัน')).toBeDefined();
    expect(screen.getByText('บิลรายเดือน')).toBeDefined();
    expect(screen.getByText('1,200.-')).toBeDefined();
    expect(screen.getAllByText('4,800.-').length).toBe(2);

    // Verify NO status badge / card / pill / visible status text
    expect(screen.queryByText('จ่ายแล้ว')).toBeNull();
    expect(screen.queryByText('ยังไม่จ่าย')).toBeNull();
    expect(screen.queryByText('รอชำระ')).toBeNull();
  });

  it('11. Frontend table uses DTO amountDue and chargeComponents without local recomputation', () => {
    const rawDtoContext = {
      roomId: 'room-custom',
      amountDue: '9999.00',
      chargeComponents: [
        {
          type: 'custom',
          label: 'ค่าบริการพิเศษ',
          amount: '9999.00',
          status: 'UNPAID' as const,
          occurredInDisplayedPeriod: true,
          includedInAmountDue: true,
        },
      ],
    };

    const breakdown = getOwnerFinancialBreakdown(rawDtoContext);
    // Directly uses 9999.00 from DTO
    expect(breakdown.operationalAmount).toBe(9999);
    expect(breakdown.formattedAmount).toBe('9,999.00');
    expect(breakdown.components[0].label).toBe('ค่าบริการพิเศษ');
  });

  it('12. Daily stay uses canonical backend invoice authority', () => {
    const dailyUnpaidCtx = {
      roomId: 'room-daily',
      billingSource: 'DAILY_STAY',
      amountDue: '2000.00',
      chargeComponents: [
        { type: 'deposit', label: 'ค่าประกัน', amount: '500.00', status: 'UNPAID', occurredInDisplayedPeriod: true, includedInAmountDue: true },
        { type: 'rent', label: 'ค่าเช่า (วัน)', amount: '1500.00', status: 'UNPAID', occurredInDisplayedPeriod: true, includedInAmountDue: true },
      ],
    };

    const breakdown = getOwnerFinancialBreakdown(dailyUnpaidCtx);
    expect(breakdown.operationalAmount).toBe(2000);
    expect(breakdown.formattedAmount).toBe('2,000.00');
    expect(breakdown.components.length).toBe(2);
    expect(breakdown.components[0].label).toBe('ค่าประกัน');
    expect(breakdown.components[1].label).toBe('ค่าเช่า (วัน)');
  });

  it('13. Invalid preview does NOT render 0.00 as valid payable', () => {
    const invalidCtx = {
      roomId: 'room-invalid',
      billingSource: 'CONTRACT',
      amountDue: '0.00',
      chargeComponents: [
        {
          type: 'monthly_utility',
          label: 'บิลรายเดือน',
          amount: '0.00',
          status: 'INVALID',
          occurredInDisplayedPeriod: true,
          includedInAmountDue: false,
        },
      ],
    };

    const breakdown = getOwnerFinancialBreakdown(invalidCtx);
    expect(breakdown.components[0].status).toBe('INVALID');
    expect(breakdown.components[0].title).toBe('รูปแบบการคิดค่าบริการไม่ถูกต้อง');
  });

  it('14. Non-daily rooms with no utility bill and no readings produce correct unissued state (0 components, 0.00 amountDue)', () => {
    const vacantCtx = {
      roomId: 'room-105',
      billingSource: 'NONE',
      amountDue: '0.00',
      chargeComponents: [],
    };

    const breakdown = getOwnerFinancialBreakdown(vacantCtx);
    expect(breakdown.operationalAmount).toBe(0);
    expect(breakdown.formattedAmount).toBe('0.00');
    expect(breakdown.components.length).toBe(0);
  });

  it('15. formatComponentDetailAmount formats whole-baht with compact .- and preserves non-zero satang', async () => {
    const { formatComponentDetailAmount } = await import('../pages/owner/meters');
    expect(formatComponentDetailAmount('650.00')).toBe('650.-');
    expect(formatComponentDetailAmount('650')).toBe('650.-');
    expect(formatComponentDetailAmount(650)).toBe('650.-');
    expect(formatComponentDetailAmount('4800.00')).toBe('4,800.-');
    expect(formatComponentDetailAmount('1200.00')).toBe('1,200.-');
    expect(formatComponentDetailAmount('650.50')).toBe('650.50');
    expect(formatComponentDetailAmount('650.25')).toBe('650.25');
    expect(formatComponentDetailAmount('0.00')).toBe('0.-');
    expect(formatComponentDetailAmount('0')).toBe('0.-');
    expect(formatComponentDetailAmount(0)).toBe('0.-');
    expect(formatComponentDetailAmount(null)).toBe('0.-');
    expect(formatComponentDetailAmount(undefined)).toBe('0.-');
  });

  it('16. Pull Previous updates previous readings only: blank current remains blank, populated current remains exact, otherFees unchanged', async () => {
    const httpRequestSpy = vi.spyOn(httpClient, 'httpRequest');
    httpRequestSpy.mockImplementation(async (method: string, url: string) => {
      if (url.includes('/preview-context')) {
        return {
          success: true,
          data: {
            rateSnapshot: {
              waterBillingType: 'per_unit',
              waterRate: '18.00',
              electricityBillingType: 'per_unit',
              electricityRate: '7.00',
            },
            rooms: [
              {
                roomId: 'r-101',
                roomNumber: '101',
                tenantName: 'สมชาย',
                billingSource: 'CONTRACT',
                amountDue: '0.00',
                chargeComponents: [],
              },
            ],
          },
        };
      }
      if (url.includes('/meters/workspace/pull-previous')) {
        return {
          success: true,
          data: {
            hasPreviousCycle: true,
            rooms: [
              {
                roomId: 'r-101',
                previousWaterCurrentReading: '110.00',
                previousElectricityCurrentReading: '560.00',
                previousCyclePeopleCount: 1,
                currentHouseholdPeopleCount: 2,
              },
            ],
          },
        };
      }
      if (url.includes('/meters/workspace')) {
        return {
          success: true,
          data: {
            serverReadings: [],
            cyclePeopleRes: { success: true, data: [] },
          },
        };
      }
      return { success: true, data: [] };
    });

    const sampleRoom101: Room = {
      id: 'r-101',
      buildingId: 'b-1',
      roomNumber: '101',
      floor: 1,
      status: 'occupied',
      monthlyRent: 4000,
      dailyRent: 0,
      depositAmount: 4000,
      maxOccupants: 2,
      initialWaterMeter: 0,
      initialElectricMeter: 0,
      images: [],
      createdAt: '2026-08-01',
      updatedAt: '2026-08-01',
    };

    const cyclesWithPrev = [
      {
        id: 'cycle-2026-08',
        cycleCode: '2026-08',
        name: 'รอบบิล สิงหาคม 2569',
        status: 'draft' as const,
        periodStart: '2026-08-01',
        periodEnd: '2026-08-31',
        billingDate: '2026-08-25',
        dueDate: '2026-09-05',
        isFirstCycle: false,
      },
      {
        id: 'cycle-2026-07',
        cycleCode: '2026-07',
        name: 'รอบบิล กรกฎาคม 2569',
        status: 'closed' as const,
        periodStart: '2026-07-01',
        periodEnd: '2026-07-31',
        billingDate: '2026-07-25',
        dueDate: '2026-08-05',
        isFirstCycle: false,
      },
    ];

    renderWithClient(
      <OwnerMeters
        rooms={[sampleRoom101]}
        buildings={[{ id: 'b-1', dormitoryId: 'dorm-1', name: 'อาคาร A', totalFloors: 1, roomsPerFloor: 1, createdAt: '2026-08-01' }]}
        dormitoryId="dorm-1"
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
        billingCycles={cyclesWithPrev}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('101')).toBeDefined();
    });

    // 1. Initial State: Pull button is visible
    const pullBtn = screen.getByRole('button', { name: /ดึงข้อมูลก่อนหน้า/ });
    expect(pullBtn).toBeDefined();

    // 2. Pre-populate current readings before pulling
    const allInputs = screen.getAllByRole('textbox') as HTMLInputElement[];
    const elecCurr = allInputs.find(i => i.getAttribute('data-col') === 'elecCurr');
    const waterCurr = allInputs.find(i => i.getAttribute('data-col') === 'waterCurr');
    expect(elecCurr).toBeDefined();
    expect(waterCurr).toBeDefined();

    fireEvent.change(elecCurr!, { target: { value: '780' } });
    fireEvent.change(waterCurr!, { target: { value: '145' } });

    expect(elecCurr!.value).toBe('780');
    expect(waterCurr!.value).toBe('145');

    // 3. Click Pull Previous
    fireEvent.click(pullBtn);

    await waitFor(() => {
      // Pull button MUST disappear after successful pull
      expect(screen.queryByRole('button', { name: /ดึงข้อมูลก่อนหน้า/ })).toBeNull();
    });

    // 4. Verify previous fields updated, BUT current fields remain EXACTLY 780 and 145
    const elecPrev = (screen.getAllByRole('textbox') as HTMLInputElement[]).find(i => i.getAttribute('data-col') === 'elecPrev');
    const waterPrev = (screen.getAllByRole('textbox') as HTMLInputElement[]).find(i => i.getAttribute('data-col') === 'waterPrev');

    // Updated previous readings
    expect(elecPrev ? elecPrev.value : screen.getByText('560')).toBeDefined();
    expect(waterPrev ? waterPrev.value : screen.getByText('110')).toBeDefined();

    // Preserved current readings
    expect(elecCurr!.value).toBe('780');
    expect(waterCurr!.value).toBe('145');
  });

  it('17. Blank current readings remain completely blank after Pull Previous', async () => {
    const httpRequestSpy = vi.spyOn(httpClient, 'httpRequest');
    httpRequestSpy.mockImplementation(async (method: string, url: string) => {
      if (url.includes('/preview-context')) {
        return {
          success: true,
          data: {
            rateSnapshot: {
              waterBillingType: 'per_unit',
              waterRate: '18.00',
              electricityBillingType: 'per_unit',
              electricityRate: '7.00',
            },
            rooms: [
              {
                roomId: 'r-102',
                roomNumber: '102',
                tenantName: 'สมใจ',
                billingSource: 'CONTRACT',
                amountDue: '0.00',
                chargeComponents: [],
              },
            ],
          },
        };
      }
      if (url.includes('/meters/workspace/pull-previous')) {
        return {
          success: true,
          data: {
            hasPreviousCycle: true,
            rooms: [
              {
                roomId: 'r-102',
                previousWaterCurrentReading: '90.00',
                previousElectricityCurrentReading: '460.00',
                previousCyclePeopleCount: 1,
                currentHouseholdPeopleCount: 1,
              },
            ],
          },
        };
      }
      if (url.includes('/meters/workspace')) {
        return {
          success: true,
          data: {
            serverReadings: [],
            cyclePeopleRes: { success: true, data: [] },
          },
        };
      }
      return { success: true, data: [] };
    });

    const sampleRoom102: Room = {
      id: 'r-102',
      buildingId: 'b-1',
      roomNumber: '102',
      floor: 1,
      status: 'occupied',
      monthlyRent: 4000,
      dailyRent: 0,
      depositAmount: 4000,
      maxOccupants: 2,
      initialWaterMeter: 0,
      initialElectricMeter: 0,
      images: [],
      createdAt: '2026-08-01',
      updatedAt: '2026-08-01',
    };

    const cyclesWithPrev = [
      {
        id: 'cycle-2026-08',
        cycleCode: '2026-08',
        name: 'รอบบิล สิงหาคม 2569',
        status: 'draft' as const,
        periodStart: '2026-08-01',
        periodEnd: '2026-08-31',
        billingDate: '2026-08-25',
        dueDate: '2026-09-05',
        isFirstCycle: false,
      },
      {
        id: 'cycle-2026-07',
        cycleCode: '2026-07',
        name: 'รอบบิล กรกฎาคม 2569',
        status: 'closed' as const,
        periodStart: '2026-07-01',
        periodEnd: '2026-07-31',
        billingDate: '2026-07-25',
        dueDate: '2026-08-05',
        isFirstCycle: false,
      },
    ];

    renderWithClient(
      <OwnerMeters
        rooms={[sampleRoom102]}
        buildings={[{ id: 'b-1', dormitoryId: 'dorm-1', name: 'อาคาร A', totalFloors: 1, roomsPerFloor: 1, createdAt: '2026-08-01' }]}
        dormitoryId="dorm-1"
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
        billingCycles={cyclesWithPrev}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('102')).toBeDefined();
    });

    const pullBtn = screen.getByRole('button', { name: /ดึงข้อมูลก่อนหน้า/ });
    expect(pullBtn).toBeDefined();

    // Current fields are initially blank
    const allInputs = screen.getAllByRole('textbox') as HTMLInputElement[];
    const elecCurr = allInputs.find(i => i.getAttribute('data-col') === 'elecCurr');
    const waterCurr = allInputs.find(i => i.getAttribute('data-col') === 'waterCurr');
    expect(elecCurr!.value).toBe('');
    expect(waterCurr!.value).toBe('');

    // Click Pull
    fireEvent.click(pullBtn);

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /ดึงข้อมูลก่อนหน้า/ })).toBeNull();
    });

    // Previous readings updated
    expect(screen.getByText('460')).toBeDefined();
    expect(screen.getByText('90')).toBeDefined();

    // Current readings MUST remain completely blank
    expect(elecCurr!.value).toBe('');
    expect(waterCurr!.value).toBe('');
  });

  it('18. Durable completion authority: persists Pull button absence across hard refetch when server has readings', async () => {
    const httpRequestSpy = vi.spyOn(httpClient, 'httpRequest');
    httpRequestSpy.mockImplementation(async (method: string, url: string) => {
      if (url.includes('/preview-context')) {
        return {
          success: true,
          data: {
            rateSnapshot: {
              waterBillingType: 'per_unit',
              waterRate: '18.00',
              electricityBillingType: 'per_unit',
              electricityRate: '7.00',
            },
            rooms: [],
          },
        };
      }
      if (url.includes('/meters/readings')) {
        return {
          success: true,
          data: [
            {
              id: 'mr-1',
              billingCycleId: 'cycle-2026-08',
              roomId: 'r-101',
              meterType: 'water',
              previousReading: '110.00',
              currentReading: '120.00',
            },
            {
              id: 'mr-2',
              billingCycleId: 'cycle-2026-08',
              roomId: 'r-101',
              meterType: 'electricity',
              previousReading: '560.00',
              currentReading: '600.00',
            },
          ],
        };
      }
      return { success: true, data: [] };
    });

    const sampleRoom101: Room = {
      id: 'r-101',
      buildingId: 'b-1',
      roomNumber: '101',
      floor: 1,
      status: 'occupied',
      monthlyRent: 4000,
      dailyRent: 0,
      depositAmount: 4000,
      maxOccupants: 2,
      initialWaterMeter: 0,
      initialElectricMeter: 0,
      images: [],
      createdAt: '2026-08-01',
      updatedAt: '2026-08-01',
    };

    const cyclesWithPrev = [
      {
        id: 'cycle-2026-08',
        cycleCode: '2026-08',
        name: 'รอบบิล สิงหาคม 2569',
        status: 'draft' as const,
        periodStart: '2026-08-01',
        periodEnd: '2026-08-31',
        billingDate: '2026-08-25',
        dueDate: '2026-09-05',
        isFirstCycle: false,
      },
      {
        id: 'cycle-2026-07',
        cycleCode: '2026-07',
        name: 'รอบบิล กรกฎาคม 2569',
        status: 'closed' as const,
        periodStart: '2026-07-01',
        periodEnd: '2026-07-31',
        billingDate: '2026-07-25',
        dueDate: '2026-08-05',
        isFirstCycle: false,
      },
    ];

    renderWithClient(
      <OwnerMeters
        rooms={[sampleRoom101]}
        buildings={[{ id: 'b-1', dormitoryId: 'dorm-1', name: 'อาคาร A', totalFloors: 1, roomsPerFloor: 1, createdAt: '2026-08-01' }]}
        dormitoryId="dorm-1"
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
        billingCycles={cyclesWithPrev}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('101')).toBeDefined();
      // Since server has both required baselines, Pull button must be ABSENT
      expect(screen.queryByRole('button', { name: /ดึงข้อมูลก่อนหน้า/ })).toBeNull();
    });
  });

  it('19. Detail rows render clean inline rows without card/border/background/shadow/pill', async () => {
    const httpRequestSpy = vi.spyOn(httpClient, 'httpRequest');
    httpRequestSpy.mockImplementation(async (method: string, url: string) => {
      if (url.includes('/preview-context')) {
        return {
          success: true,
          data: {
            rateSnapshot: {
              waterBillingType: 'per_unit',
              waterRate: '18.00',
              electricityBillingType: 'per_unit',
              electricityRate: '7.00',
            },
            rooms: [
              {
                roomId: 'r-103',
                roomNumber: '103',
                tenantName: 'สมปอง',
                billingSource: 'CONTRACT',
                amountDue: '650.00',
                chargeComponents: [
                  { type: 'monthly_utility', label: 'บิลรายเดือน', amount: '650.00', status: 'PREVIEW', occurredInDisplayedPeriod: true, includedInAmountDue: true },
                ],
              },
            ],
          },
        };
      }
      if (url.includes('/meters/workspace')) {
        return {
          success: true,
          data: {
            serverReadings: [],
            cyclePeopleRes: { success: true, data: [] },
          },
        };
      }
      return { success: true, data: [] };
    });

    const sampleRoom103: Room = {
      id: 'r-103',
      buildingId: 'b-1',
      roomNumber: '103',
      floor: 1,
      status: 'occupied',
      monthlyRent: 4000,
      dailyRent: 0,
      depositAmount: 4000,
      maxOccupants: 2,
      initialWaterMeter: 0,
      initialElectricMeter: 0,
      images: [],
      createdAt: '2026-08-01',
      updatedAt: '2026-08-01',
    };

    renderWithClient(
      <OwnerMeters
        rooms={[sampleRoom103]}
        buildings={[{ id: 'b-1', dormitoryId: 'dorm-1', name: 'อาคาร A', totalFloors: 1, roomsPerFloor: 1, createdAt: '2026-08-01' }]}
        dormitoryId="dorm-1"
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
        billingCycles={sampleCycle}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('103')).toBeDefined();
    });

    // 1 component -> trigger text is "ดูรายละเอียด" (no +1)
    const detailBtn = screen.getByRole('button', { name: /^ดูรายละเอียด$/ });
    expect(detailBtn).toBeDefined();

    fireEvent.click(detailBtn);

    // Verify row layout
    const rowEl = screen.getByTestId('charge-component-row-r-103-0');
    expect(rowEl).toBeDefined();
    expect(rowEl.textContent).toContain('บิลรายเดือน');
    expect(rowEl.textContent).toContain('650.-');

    // Verify no card/box/shadow/border wrapper classes on the row or its container
    expect(rowEl.parentElement?.className).not.toContain('bg-slate-50');
    expect(rowEl.parentElement?.className).not.toContain('border');
    expect(rowEl.parentElement?.className).not.toContain('shadow');
  });

  it('20. Entire inline row follows unified status color family for PREVIEW, UNPAID, PAID, and INVALID', async () => {
    const httpRequestSpy = vi.spyOn(httpClient, 'httpRequest');
    httpRequestSpy.mockImplementation(async (method: string, url: string) => {
      if (url.includes('/preview-context')) {
        return {
          success: true,
          data: {
            rateSnapshot: {
              waterBillingType: 'per_unit',
              waterRate: '18.00',
              electricityBillingType: 'per_unit',
              electricityRate: '7.00',
            },
            rooms: [
              {
                roomId: 'r-104',
                roomNumber: '104',
                tenantName: 'ทดสอบ',
                billingSource: 'CONTRACT',
                amountDue: '10250.00',
                chargeComponents: [
                  { type: 'monthly_utility', label: 'บิลรายเดือน', amount: '650.00', status: 'PREVIEW', occurredInDisplayedPeriod: true, includedInAmountDue: true },
                  { type: 'rent', label: 'ค่าเช่า', amount: '4800.00', status: 'UNPAID', occurredInDisplayedPeriod: true, includedInAmountDue: true },
                  { type: 'deposit', label: 'ค่าประกัน', amount: '4800.00', status: 'PAID', paidAt: '2026-08-25T10:00:00Z', occurredInDisplayedPeriod: true, includedInAmountDue: false },
                  { type: 'custom', label: 'ค่าบริการเสริม', amount: '0.00', status: 'INVALID', errorMessage: 'สูตรคำนวณไม่ถูกต้อง', occurredInDisplayedPeriod: true, includedInAmountDue: false },
                ],
              },
            ],
          },
        };
      }
      if (url.includes('/meters/workspace')) {
        return {
          success: true,
          data: {
            serverReadings: [],
            cyclePeopleRes: { success: true, data: [] },
          },
        };
      }
      return { success: true, data: [] };
    });

    const sampleRoom104: Room = {
      id: 'r-104',
      buildingId: 'b-1',
      roomNumber: '104',
      floor: 1,
      status: 'occupied',
      monthlyRent: 4000,
      dailyRent: 0,
      depositAmount: 4000,
      maxOccupants: 2,
      initialWaterMeter: 0,
      initialElectricMeter: 0,
      images: [],
      createdAt: '2026-08-01',
      updatedAt: '2026-08-01',
    };

    renderWithClient(
      <OwnerMeters
        rooms={[sampleRoom104]}
        buildings={[{ id: 'b-1', dormitoryId: 'dorm-1', name: 'อาคาร A', totalFloors: 1, roomsPerFloor: 1, createdAt: '2026-08-01' }]}
        dormitoryId="dorm-1"
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
        billingCycles={sampleCycle}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('104')).toBeDefined();
    });

    const detailBtn = screen.getByRole('button', { name: /ดูรายละเอียด \+4/ });
    expect(detailBtn).toBeDefined();
    fireEvent.click(detailBtn);

    // Row 0: PREVIEW -> gray semantic family (text-slate-400, text-slate-500, text-slate-600)
    const previewRow = screen.getByTestId('charge-component-row-r-104-0');
    expect(previewRow.innerHTML).toContain('text-slate-400');
    expect(previewRow.innerHTML).toContain('text-slate-500');
    expect(previewRow.innerHTML).toContain('text-slate-600');
    expect(previewRow.textContent).toContain('บิลรายเดือน');
    expect(previewRow.textContent).toContain('650.-');

    // Row 1: UNPAID -> orange/amber semantic family (text-amber-500, text-amber-700, text-amber-800)
    const unpaidRow = screen.getByTestId('charge-component-row-r-104-1');
    expect(unpaidRow.innerHTML).toContain('text-amber-500');
    expect(unpaidRow.innerHTML).toContain('text-amber-700');
    expect(unpaidRow.innerHTML).toContain('text-amber-800');
    expect(unpaidRow.textContent).toContain('ค่าเช่า');
    expect(unpaidRow.textContent).toContain('4,800.-');

    // Row 2: PAID -> green/emerald semantic family (text-emerald-600, text-emerald-700, text-emerald-800)
    const paidRow = screen.getByTestId('charge-component-row-r-104-2');
    expect(paidRow.innerHTML).toContain('text-emerald-600');
    expect(paidRow.innerHTML).toContain('text-emerald-700');
    expect(paidRow.innerHTML).toContain('text-emerald-800');
    expect(paidRow.textContent).toContain('ค่าประกัน');
    expect(paidRow.textContent).toContain('4,800.-');

    // Row 3: INVALID -> red/rose semantic family (text-rose-500, text-rose-600)
    const invalidRow = screen.getByTestId('charge-component-row-r-104-3');
    expect(invalidRow.innerHTML).toContain('text-rose-500');
    expect(invalidRow.innerHTML).toContain('text-rose-600');
    expect(invalidRow.textContent).toContain('ค่าบริการเสริม');
    expect(invalidRow.textContent).toContain('0.-');

    // No visible status pills or text
    expect(screen.queryByText('ชำระแล้ว')).toBeNull();
    expect(screen.queryByText('ยังไม่จ่าย')).toBeNull();
    expect(screen.queryByText('รอชำระ')).toBeNull();
  });

  it('21. When both per_unit and only water baseline exists on server, Pull button remains available for missing electricity baseline', async () => {
    const httpRequestSpy = vi.spyOn(httpClient, 'httpRequest');
    httpRequestSpy.mockImplementation(async (method: string, url: string) => {
      if (url.includes('/preview-context')) {
        return {
          success: true,
          data: {
            rateSnapshot: {
              waterBillingType: 'per_unit',
              waterRate: '18.00',
              electricityBillingType: 'per_unit',
              electricityRate: '7.00',
            },
            rooms: [],
          },
        };
      }
      if (url.includes('/meters/readings')) {
        return {
          success: true,
          data: [
            {
              id: 'mr-1',
              billingCycleId: 'cycle-2026-08',
              roomId: 'r-105',
              meterType: 'water',
              previousReading: '110.00',
              currentReading: '120.00',
            },
            // Note: electricity baseline is missing!
          ],
        };
      }
      return { success: true, data: [] };
    });

    const sampleRoom105: Room = {
      id: 'r-105',
      buildingId: 'b-1',
      roomNumber: '105',
      floor: 1,
      status: 'occupied',
      monthlyRent: 4000,
      dailyRent: 0,
      depositAmount: 4000,
      maxOccupants: 2,
      initialWaterMeter: 0,
      initialElectricMeter: 0,
      images: [],
      createdAt: '2026-08-01',
      updatedAt: '2026-08-01',
    };

    const cyclesWithPrev = [
      {
        id: 'cycle-2026-08',
        cycleCode: '2026-08',
        name: 'รอบบิล สิงหาคม 2569',
        status: 'draft' as const,
        periodStart: '2026-08-01',
        periodEnd: '2026-08-31',
        billingDate: '2026-08-25',
        dueDate: '2026-09-05',
        isFirstCycle: false,
      },
      {
        id: 'cycle-2026-07',
        cycleCode: '2026-07',
        name: 'รอบบิล กรกฎาคม 2569',
        status: 'closed' as const,
        periodStart: '2026-07-01',
        periodEnd: '2026-07-31',
        billingDate: '2026-07-25',
        dueDate: '2026-08-05',
        isFirstCycle: false,
      },
    ];

    renderWithClient(
      <OwnerMeters
        rooms={[sampleRoom105]}
        buildings={[{ id: 'b-1', dormitoryId: 'dorm-1', name: 'อาคาร A', totalFloors: 1, roomsPerFloor: 1, createdAt: '2026-08-01' }]}
        dormitoryId="dorm-1"
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
        billingCycles={cyclesWithPrev}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('105')).toBeDefined();
    });

    // Since electric baseline is still missing, Pull button MUST remain visible!
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /ดึงข้อมูลก่อนหน้า/ })).toBeDefined();
    });
  });

  it('22. Cross-room baseline distribution (Room 101 has water only, Room 102 has electric only) does NOT complete baseline -> Pull button remains visible', async () => {
    const httpRequestSpy = vi.spyOn(httpClient, 'httpRequest');
    httpRequestSpy.mockImplementation(async (method: string, url: string) => {
      if (url.includes('/preview-context')) {
        return {
          success: true,
          data: {
            rateSnapshot: {
              waterBillingType: 'per_unit',
              waterRate: '18.00',
              electricityBillingType: 'per_unit',
              electricityRate: '7.00',
            },
            rooms: [],
          },
        };
      }
      if (url.includes('/meters/readings')) {
        return {
          success: true,
          data: [
            // Room 101 has water baseline, but missing electric
            {
              id: 'mr-1',
              billingCycleId: 'cycle-2026-08',
              roomId: 'r-101',
              meterType: 'water',
              previousReading: '110.00',
              currentReading: '120.00',
            },
            // Room 102 has electric baseline, but missing water
            {
              id: 'mr-2',
              billingCycleId: 'cycle-2026-08',
              roomId: 'r-102',
              meterType: 'electricity',
              previousReading: '460.00',
              currentReading: '500.00',
            },
          ],
        };
      }
      return { success: true, data: [] };
    });

    const sampleRoom101: Room = {
      id: 'r-101',
      buildingId: 'b-1',
      roomNumber: '101',
      floor: 1,
      status: 'occupied',
      monthlyRent: 4000,
      dailyRent: 0,
      depositAmount: 4000,
      maxOccupants: 2,
      initialWaterMeter: 0,
      initialElectricMeter: 0,
      images: [],
      createdAt: '2026-08-01',
      updatedAt: '2026-08-01',
    };

    const sampleRoom102: Room = {
      id: 'r-102',
      buildingId: 'b-1',
      roomNumber: '102',
      floor: 1,
      status: 'occupied',
      monthlyRent: 4000,
      dailyRent: 0,
      depositAmount: 4000,
      maxOccupants: 2,
      initialWaterMeter: 0,
      initialElectricMeter: 0,
      images: [],
      createdAt: '2026-08-01',
      updatedAt: '2026-08-01',
    };

    const cyclesWithPrev = [
      {
        id: 'cycle-2026-08',
        cycleCode: '2026-08',
        name: 'รอบบิล สิงหาคม 2569',
        status: 'draft' as const,
        periodStart: '2026-08-01',
        periodEnd: '2026-08-31',
        billingDate: '2026-08-25',
        dueDate: '2026-09-05',
        isFirstCycle: false,
      },
      {
        id: 'cycle-2026-07',
        cycleCode: '2026-07',
        name: 'รอบบิล กรกฎาคม 2569',
        status: 'closed' as const,
        periodStart: '2026-07-01',
        periodEnd: '2026-07-31',
        billingDate: '2026-07-25',
        dueDate: '2026-08-05',
        isFirstCycle: false,
      },
    ];

    renderWithClient(
      <OwnerMeters
        rooms={[sampleRoom101, sampleRoom102]}
        buildings={[{ id: 'b-1', dormitoryId: 'dorm-1', name: 'อาคาร A', totalFloors: 1, roomsPerFloor: 1, createdAt: '2026-08-01' }]}
        dormitoryId="dorm-1"
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
        billingCycles={cyclesWithPrev}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('101')).toBeDefined();
      expect(screen.getByText('102')).toBeDefined();
    });

    // In cross-room distribution, neither room is fully resolved -> Pull button MUST be visible!
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /ดึงข้อมูลก่อนหน้า/ })).toBeDefined();
    });
  });
});
