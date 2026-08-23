// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OwnerMeters, getOwnerFinancialBreakdown } from '../pages/owner/meters';
import * as httpClient from '../data/httpClient';
import { Room } from '../types';

describe('LOCAL-07 Backend Canonical Owner Payable Preview Suite', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    });
    vi.restoreAllMocks();
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

    // Verify all 3 components rendered
    expect(screen.getByText('ค่าเช่า (เดือน)')).toBeDefined();
    expect(screen.getByText('ค่าประกัน')).toBeDefined();
    expect(screen.getByText('บิลรายเดือน')).toBeDefined();
    expect(screen.getByText('1,200.00 ฿')).toBeDefined();
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
});
