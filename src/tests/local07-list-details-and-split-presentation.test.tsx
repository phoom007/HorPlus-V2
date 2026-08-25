/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { OwnerMeterListCard } from '../components/meters/OwnerMeterListCard';
import { OwnerMeters } from '../pages/owner/meters';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { meterDraftStore } from '../lib/meterDraftStore';
import * as httpClient from '../data/httpClient';

describe('LOCAL-07 — List Details & Split Presentation Authority Suite', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
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

  const defaultListCardProps = {
    row: {
      roomId: 'room-101',
      roomNumber: '101',
      floor: 1,
      waterPrev: '100',
      waterCurr: '110',
      elecPrev: '500',
      elecCurr: '600',
      isReplaced: false,
      peopleCount: 1,
      overdueAmount: '0.00',
      isPaid: false,
      billStatus: 'unpaid' as const,
      otherFees: [{ description: 'ค่าทำความสะอาด', amount: '50.00' }],
    },
    idx: 0,
    roomCtx: {
      roomId: 'room-101',
      roomNumber: '101',
      tenantName: 'Somchai Jaidee',
      tenantId: 'tenant-1',
      billingSource: 'CONTRACT',
      rentAmount: '4500.00',
      rentDescription: 'ค่าเช่าห้องพัก',
      isLineLinked: true,
      isFutureReservation: false,
      amountDue: '5580.00',
      billStatus: 'unpaid',
      isPaid: false,
      chargeComponents: [
        { type: 'rent', label: 'ค่าเช่า (เดือน)', amount: '4500.00', status: 'UNPAID' as const },
        {
          type: 'monthly_utility',
          label: 'บิลรายเดือน',
          amount: '1080.00',
          status: 'UNPAID' as const,
          lineItems: [
            { type: 'water', description: 'ค่าน้ำ (10 หน่วย)', amount: '180.00', quantity: '10', unitPrice: '18' },
            { type: 'electricity', description: 'ค่าไฟฟ้า (100 หน่วย)', amount: '700.00', quantity: '100', unitPrice: '7' },
            { type: 'common_fee', description: 'ค่าส่วนกลาง', amount: '200.00', quantity: '1', unitPrice: '200' },
            { type: 'internet', description: 'ค่าอินเทอร์เน็ต', amount: '150.00', quantity: '1', unitPrice: '150' },
            { type: 'parking', description: 'ค่าที่จอดรถ', amount: '300.00', quantity: '1', unitPrice: '300' },
            { type: 'other_fee', description: 'ค่าทำความสะอาด', amount: '50.00', quantity: '1', unitPrice: '50' },
          ],
        },
      ],
    } as any,
    isWaterUnit: true,
    isElecUnit: true,
    isFirstCycle: false,
    selectedCycleCode: '2026-08',
    selectedCycle: '2026-08',
    selectedBillingCycleId: 'cycle-1',
    isSaving: false,
    unlockedElecPrev: {},
    unlockedWaterPrev: {},
    flashingCells: {},
    isExpandedBreakdown: false,
    onOpenOtherFees: vi.fn(),
    onMeterReadingChange: vi.fn(),
    onMeterReadingBlur: vi.fn(),
    onPaste: vi.fn(),
    onUnlockElecPrev: vi.fn(),
    onCancelElecPrev: vi.fn(),
    onUnlockWaterPrev: vi.fn(),
    onCancelWaterPrev: vi.fn(),
    onPeopleCountChange: vi.fn(),
    onToggleStatusSwitch: vi.fn(),
    onToggleBreakdown: vi.fn(),
    onSelectTenant: vi.fn(),
  };

  it('LF1–LF6: List Mode Zone E excludes rent, water, electricity, and custom fees, and shows correct trigger count', () => {
    const { container, rerender } = render(<OwnerMeterListCard {...defaultListCardProps} />);

    // Custom Other Fees chip shows count (1)
    expect(screen.getByText(/ค่าใช้จ่ายอื่นๆ \(1\)/i)).toBeDefined();

    // Trigger button shows ดูรายละเอียด +3 (Common fee, Internet, Parking)
    const triggerBtn = screen.getByRole('button', { name: /ดูรายละเอียด \+3/i });
    expect(triggerBtn.textContent).toContain('+3');

    // Rerender with isExpandedBreakdown = true
    rerender(
      <OwnerMeterListCard
        {...defaultListCardProps}
        isExpandedBreakdown={true}
      />
    );

    // Verify Zone E contents: common fee, internet, parking are rendered
    expect(screen.getByText('ค่าส่วนกลาง')).toBeDefined();
    expect(screen.getByText('200.-')).toBeDefined();
    expect(screen.getByText('ค่าอินเทอร์เน็ต')).toBeDefined();
    expect(screen.getByText('150.-')).toBeDefined();
    expect(screen.getByText('ค่าที่จอดรถ')).toBeDefined();
    expect(screen.getByText('300.-')).toBeDefined();

    // Verify that inside the expanded breakdown (Zone E), there is NO duplicate water, electricity, rent, or custom fee
    const expandedSection = container.querySelector('.border-dashed');
    expect(expandedSection).not.toBeNull();
    const expandedText = expandedSection!.textContent || '';
    expect(expandedText).not.toContain('ค่าน้ำ');
    expect(expandedText).not.toContain('ค่าไฟฟ้า');
    expect(expandedText).not.toContain('ค่าทำความสะอาด');
    expect(expandedText).not.toContain('ค่าเช่า');
  });

  it('TS1–TS5: Table Mode renders split charge components without synthetic combined label', async () => {
    const sampleRoom = {
      id: 'room-202',
      dormitoryId: 'dorm-1',
      buildingId: 'bldg-1',
      roomNumber: '202',
      floor: 2,
      status: 'occupied' as const,
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

    const mockBills = [
      {
        id: 'bill-rent-202',
        dormitoryId: 'dorm-1',
        roomId: 'room-202',
        billKind: 'RENT',
        status: 'unpaid',
        totalAmount: '4800.00',
        outstandingAmount: '4800.00',
        cycleId: 'cycle-2026-08',
      },
      {
        id: 'bill-mu-202',
        dormitoryId: 'dorm-1',
        roomId: 'room-202',
        billKind: 'MONTHLY_UTILITY',
        status: 'unpaid',
        totalAmount: '1650.00',
        outstandingAmount: '1650.00',
        cycleId: 'cycle-2026-08',
      },
    ];

    const sampleCycle = [
      {
        id: 'cycle-2026-08',
        dormitoryId: 'dorm-1',
        cycleCode: '2026-08',
        name: 'รอบบิล สิงหาคม 2569',
        isCurrent: true,
        status: 'draft' as const,
        periodStart: '2026-08-01',
        periodEnd: '2026-08-31',
        billingDate: '2026-08-25',
        dueDate: '2026-09-05',
        isFirstCycle: false,
      },
    ];

    vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (_method: string, url: string) => {
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
                roomId: 'room-202',
                roomNumber: '202',
                tenantName: 'สมศักดิ์ มั่งมี',
                billingSource: 'CONTRACT',
                amountDue: '6450.00',
                chargeComponents: [
                  { type: 'rent', label: 'ค่าเช่า (เดือน)', amount: '4800.00', status: 'UNPAID', occurredInDisplayedPeriod: true, includedInAmountDue: true },
                  { type: 'monthly_utility', label: 'บิลรายเดือน', amount: '1650.00', status: 'UNPAID', occurredInDisplayedPeriod: true, includedInAmountDue: true },
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
            rooms: [{ roomId: 'room-202', roomNumber: '202', billingSource: 'CONTRACT', rentAmount: 4800 }],
            readings: [],
          },
        };
      }
      return { success: true, data: [] };
    });

    render(
      <QueryClientProvider client={queryClient}>
        <OwnerMeters
          rooms={[sampleRoom] as any}
          buildings={[{ id: 'bldg-1', dormitoryId: 'dorm-1', name: 'อาคาร A', totalFloors: 2, roomsPerFloor: 1, createdAt: '2026-08-01' } as any]}
          dormitoryId="dorm-1"
          bills={mockBills as any}
          tenants={[]}
          contracts={[]}
          selectedCycle="2026-08"
          selectedCycleCode="2026-08"
          selectedBillingCycleId="cycle-2026-08"
          billingCycles={sampleCycle}
          onSaveBills={vi.fn()}
          onSelectTenant={vi.fn()}
          onAddLog={vi.fn()}
          onNavigate={vi.fn()}
        />
      </QueryClientProvider>
    );

    // Wait for Room 202 row to mount
    await waitFor(() => {
      expect(screen.getByText('202')).toBeDefined();
    });

    // Click "ดูรายละเอียด" in Table Mode
    const detailBtn = screen.getByRole('button', { name: /ดูรายละเอียด/i });
    fireEvent.click(detailBtn);

    // Verify independent charge components
    expect(screen.getByText(/ค่าเช่า \(เดือน\)/i)).toBeDefined();
    expect(screen.getByText('4,800.-')).toBeDefined();
    expect(screen.getByText('บิลรายเดือน')).toBeDefined();
    expect(screen.getByText('1,650.-')).toBeDefined();

    // Verify NO synthetic combined label
    expect(screen.queryByText(/รวมค่าเช่า/i)).toBeNull();
  });
});
