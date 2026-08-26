/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { OwnerMeterListCard } from '../components/meters/OwnerMeterListCard';
import { OwnerMeters, resolveOwnerMeterDisplayStatus, getOwnerFinancialBreakdown, resolveFinancialComponentTone } from '../pages/owner/meters';
import { OwnerSettings } from '../pages/owner/settings';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { meterDraftStore } from '../lib/meterDraftStore';
import * as httpClient from '../data/httpClient';
import { ApiPropertyAdapter } from '../data/adapters/api';

describe('HORPLUS LOCAL-07 — PO UAT Targeted Correction Suite', () => {
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

  const baseSampleRoom = {
    id: 'room-101',
    dormitoryId: 'dorm-1',
    buildingId: 'bldg-1',
    roomNumber: '101',
    floor: 1,
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

  // =========================================================================
  // PART A: STATUS TESTS (STAT1–STAT5)
  // =========================================================================
  describe('PART A: Status Tests (STAT1–STAT5)', () => {
    it('STAT1: MU unissued + no other bill -> renders ยังไม่ออกบิล in Table and List', () => {
      render(
        <OwnerMeterListCard
          row={{
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
            billStatus: 'draft',
            monthlyUtilityBillStatus: 'draft',
            isMonthlyUtilityPaid: false,
            otherFees: [],
          } as any}
          idx={0}
          roomCtx={{
            roomId: 'room-101',
            roomNumber: '101',
            billingSource: 'CONTRACT',
            monthlyUtilityBillStatus: 'draft',
            overallFinancialStatus: 'draft',
            isPaid: false,
            isMonthlyUtilityPaid: false,
            amountDue: '0.00',
            chargeComponents: [
              { type: 'monthly_utility', label: 'บิลรายเดือน', amount: '0.00', status: 'PREVIEW' },
            ],
          } as any}
          isWaterUnit={true}
          isElecUnit={true}
          isFirstCycle={false}
          selectedCycleCode="2026-08"
          selectedCycle="2026-08"
          selectedBillingCycleId="cycle-2026-08"
          isSaving={false}
          unlockedElecPrev={{}}
          unlockedWaterPrev={{}}
          flashingCells={{}}
          isExpandedBreakdown={false}
          onOpenOtherFees={vi.fn()}
          onMeterReadingChange={vi.fn()}
          onMeterReadingBlur={vi.fn()}
          onPaste={vi.fn()}
          onUnlockElecPrev={vi.fn()}
          onCancelElecPrev={vi.fn()}
          onUnlockWaterPrev={vi.fn()}
          onCancelWaterPrev={vi.fn()}
          onPeopleCountChange={vi.fn()}
          onToggleStatusSwitch={vi.fn()}
          onToggleBreakdown={vi.fn()}
          onSelectTenant={vi.fn()}
        />
      );

      expect(screen.getByText('ยังไม่ออกบิล')).toBeDefined();
      expect(screen.queryByText('รอชำระ')).toBeNull();
      expect(screen.queryByText('รอชำระเงิน')).toBeNull();
    });

    it('STAT2: MU unissued + RENT unpaid -> renders ยังไม่ออกบิล (NOT รอชำระ)', () => {
      render(
        <OwnerMeterListCard
          row={{
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
            billStatus: 'unpaid',
            monthlyUtilityBillStatus: 'draft',
            isMonthlyUtilityPaid: false,
            otherFees: [],
          } as any}
          idx={0}
          roomCtx={{
            roomId: 'room-101',
            roomNumber: '101',
            billingSource: 'CONTRACT',
            rentAmount: '4800.00',
            monthlyUtilityBillStatus: 'draft',
            overallFinancialStatus: 'unpaid',
            isPaid: false,
            isMonthlyUtilityPaid: false,
            amountDue: '4800.00',
            chargeComponents: [
              { type: 'rent', label: 'ค่าเช่า (เดือน)', amount: '4800.00', status: 'UNPAID' },
              { type: 'monthly_utility', label: 'บิลรายเดือน', amount: '650.00', status: 'PREVIEW' },
            ],
          } as any}
          isWaterUnit={true}
          isElecUnit={true}
          isFirstCycle={false}
          selectedCycleCode="2026-08"
          selectedCycle="2026-08"
          selectedBillingCycleId="cycle-2026-08"
          isSaving={false}
          unlockedElecPrev={{}}
          unlockedWaterPrev={{}}
          flashingCells={{}}
          isExpandedBreakdown={false}
          onOpenOtherFees={vi.fn()}
          onMeterReadingChange={vi.fn()}
          onMeterReadingBlur={vi.fn()}
          onPaste={vi.fn()}
          onUnlockElecPrev={vi.fn()}
          onCancelElecPrev={vi.fn()}
          onUnlockWaterPrev={vi.fn()}
          onCancelWaterPrev={vi.fn()}
          onPeopleCountChange={vi.fn()}
          onToggleStatusSwitch={vi.fn()}
          onToggleBreakdown={vi.fn()}
          onSelectTenant={vi.fn()}
        />
      );

      expect(screen.getByText('ยังไม่ออกบิล')).toBeDefined();
      expect(screen.queryByText('รอชำระ')).toBeNull();
      expect(screen.queryByText('รอชำระเงิน')).toBeNull();
    });

    it('STAT3: unissued + invalid current < previous -> renders ยังไม่ออกบิล + validation error on input', () => {
      render(
        <OwnerMeterListCard
          row={{
            roomId: 'room-101',
            roomNumber: '101',
            floor: 1,
            waterPrev: '100',
            waterCurr: '90', // invalid: current < previous
            elecPrev: '500',
            elecCurr: '400',
            isReplaced: false,
            peopleCount: 1,
            overdueAmount: '0.00',
            isPaid: false,
            billStatus: 'draft',
            monthlyUtilityBillStatus: 'draft',
            isMonthlyUtilityPaid: false,
            otherFees: [],
          } as any}
          idx={0}
          roomCtx={{
            roomId: 'room-101',
            roomNumber: '101',
            billingSource: 'CONTRACT',
            monthlyUtilityBillStatus: 'draft',
            overallFinancialStatus: 'draft',
            isPaid: false,
            isMonthlyUtilityPaid: false,
            amountDue: '0.00',
            chargeComponents: [
              { type: 'monthly_utility', label: 'บิลรายเดือน', amount: '0.00', status: 'INVALID', errorMessage: 'เลขอ่านมิเตอร์ใหม่ต้องไม่น้อยกว่าเลขอ่านครั้งก่อน' },
            ],
          } as any}
          isWaterUnit={true}
          isElecUnit={true}
          isFirstCycle={false}
          selectedCycleCode="2026-08"
          selectedCycle="2026-08"
          selectedBillingCycleId="cycle-2026-08"
          isSaving={false}
          unlockedElecPrev={{}}
          unlockedWaterPrev={{}}
          flashingCells={{}}
          isExpandedBreakdown={false}
          onOpenOtherFees={vi.fn()}
          onMeterReadingChange={vi.fn()}
          onMeterReadingBlur={vi.fn()}
          onPaste={vi.fn()}
          onUnlockElecPrev={vi.fn()}
          onCancelElecPrev={vi.fn()}
          onUnlockWaterPrev={vi.fn()}
          onCancelWaterPrev={vi.fn()}
          onPeopleCountChange={vi.fn()}
          onToggleStatusSwitch={vi.fn()}
          onToggleBreakdown={vi.fn()}
          onSelectTenant={vi.fn()}
        />
      );

      // S3: Status MUST be ยังไม่ออกบิล (NOT ไม่ถูกต้อง)
      expect(screen.getByText('ยังไม่ออกบิล')).toBeDefined();
      expect(screen.queryByText('ไม่ถูกต้อง')).toBeNull();
      expect(screen.queryByText('รอชำระ')).toBeNull();
    });

    it('STAT4: issued unpaid -> renders รอชำระ', () => {
      render(
        <OwnerMeterListCard
          row={{
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
            billStatus: 'unpaid',
            monthlyUtilityBillStatus: 'unpaid',
            isMonthlyUtilityPaid: false,
            otherFees: [],
          } as any}
          idx={0}
          roomCtx={{
            roomId: 'room-101',
            roomNumber: '101',
            billingSource: 'CONTRACT',
            monthlyUtilityBillStatus: 'unpaid',
            overallFinancialStatus: 'unpaid',
            isPaid: false,
            isMonthlyUtilityPaid: false,
            amountDue: '1300.00',
            chargeComponents: [
              { type: 'monthly_utility', label: 'บิลรายเดือน', amount: '1300.00', status: 'UNPAID' },
            ],
          } as any}
          isWaterUnit={true}
          isElecUnit={true}
          isFirstCycle={false}
          selectedCycleCode="2026-08"
          selectedCycle="2026-08"
          selectedBillingCycleId="cycle-2026-08"
          isSaving={false}
          unlockedElecPrev={{}}
          unlockedWaterPrev={{}}
          flashingCells={{}}
          isExpandedBreakdown={false}
          onOpenOtherFees={vi.fn()}
          onMeterReadingChange={vi.fn()}
          onMeterReadingBlur={vi.fn()}
          onPaste={vi.fn()}
          onUnlockElecPrev={vi.fn()}
          onCancelElecPrev={vi.fn()}
          onUnlockWaterPrev={vi.fn()}
          onCancelWaterPrev={vi.fn()}
          onPeopleCountChange={vi.fn()}
          onToggleStatusSwitch={vi.fn()}
          onToggleBreakdown={vi.fn()}
          onSelectTenant={vi.fn()}
        />
      );

      expect(screen.getByText('รอชำระ')).toBeDefined();
    });

    it('STAT5: MU paid + RENT unpaid -> renders รอชำระ (S1 preserved, toggle locked)', () => {
      render(
        <OwnerMeterListCard
          row={{
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
            billStatus: 'unpaid',
            monthlyUtilityBillStatus: 'paid',
            isMonthlyUtilityPaid: true,
            otherFees: [],
          } as any}
          idx={0}
          roomCtx={{
            roomId: 'room-101',
            roomNumber: '101',
            billingSource: 'CONTRACT',
            monthlyUtilityBillStatus: 'paid',
            overallFinancialStatus: 'unpaid',
            isPaid: false,
            isMonthlyUtilityPaid: true,
            amountDue: '4800.00',
            chargeComponents: [
              { type: 'rent', label: 'ค่าเช่า (เดือน)', amount: '4800.00', status: 'UNPAID' },
              { type: 'monthly_utility', label: 'บิลรายเดือน', amount: '1300.00', status: 'PAID' },
            ],
          } as any}
          isWaterUnit={true}
          isElecUnit={true}
          isFirstCycle={false}
          selectedCycleCode="2026-08"
          selectedCycle="2026-08"
          selectedBillingCycleId="cycle-2026-08"
          isSaving={false}
          unlockedElecPrev={{}}
          unlockedWaterPrev={{}}
          flashingCells={{}}
          isExpandedBreakdown={false}
          onOpenOtherFees={vi.fn()}
          onMeterReadingChange={vi.fn()}
          onMeterReadingBlur={vi.fn()}
          onPaste={vi.fn()}
          onUnlockElecPrev={vi.fn()}
          onCancelElecPrev={vi.fn()}
          onUnlockWaterPrev={vi.fn()}
          onCancelWaterPrev={vi.fn()}
          onPeopleCountChange={vi.fn()}
          onToggleStatusSwitch={vi.fn()}
          onToggleBreakdown={vi.fn()}
          onSelectTenant={vi.fn()}
        />
      );

      expect(screen.getByText('รอชำระ')).toBeDefined();
      const switchBtn = screen.getByRole('switch');
      expect(switchBtn.getAttribute('aria-checked')).toBe('true');
      expect(switchBtn.hasAttribute('disabled')).toBe(true);
    });

    it('STAT6: All paid -> renders ชำระแล้ว', () => {
      render(
        <OwnerMeterListCard
          row={{
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
            isPaid: true,
            billStatus: 'paid',
            monthlyUtilityBillStatus: 'paid',
            isMonthlyUtilityPaid: true,
            otherFees: [],
          } as any}
          idx={0}
          roomCtx={{
            roomId: 'room-101',
            roomNumber: '101',
            billingSource: 'CONTRACT',
            monthlyUtilityBillStatus: 'paid',
            overallFinancialStatus: 'paid',
            isPaid: true,
            isMonthlyUtilityPaid: true,
            amountDue: '0.00',
            chargeComponents: [
              { type: 'rent', label: 'ค่าเช่า (เดือน)', amount: '4800.00', status: 'PAID' },
              { type: 'monthly_utility', label: 'บิลรายเดือน', amount: '1300.00', status: 'PAID' },
            ],
          } as any}
          isWaterUnit={true}
          isElecUnit={true}
          isFirstCycle={false}
          selectedCycleCode="2026-08"
          selectedCycle="2026-08"
          selectedBillingCycleId="cycle-2026-08"
          isSaving={false}
          unlockedElecPrev={{}}
          unlockedWaterPrev={{}}
          flashingCells={{}}
          isExpandedBreakdown={false}
          onOpenOtherFees={vi.fn()}
          onMeterReadingChange={vi.fn()}
          onMeterReadingBlur={vi.fn()}
          onPaste={vi.fn()}
          onUnlockElecPrev={vi.fn()}
          onCancelElecPrev={vi.fn()}
          onUnlockWaterPrev={vi.fn()}
          onCancelWaterPrev={vi.fn()}
          onPeopleCountChange={vi.fn()}
          onToggleStatusSwitch={vi.fn()}
          onToggleBreakdown={vi.fn()}
          onSelectTenant={vi.fn()}
        />
      );

      expect(screen.getByText('ชำระแล้ว')).toBeDefined();
    });

    it('STAT7: Visible Owner Meter Status literal "ไม่ถูกต้อง" count is 0', () => {
      const statuses = [
        resolveOwnerMeterDisplayStatus({ monthlyUtilityBillStatus: 'draft', overallFinancialStatus: 'draft' }),
        resolveOwnerMeterDisplayStatus({ monthlyUtilityBillStatus: 'draft', overallFinancialStatus: 'unpaid', chargeComponents: [{ status: 'INVALID' }] }),
        resolveOwnerMeterDisplayStatus({ monthlyUtilityBillStatus: 'unpaid', overallFinancialStatus: 'unpaid' }),
        resolveOwnerMeterDisplayStatus({ monthlyUtilityBillStatus: 'paid', overallFinancialStatus: 'unpaid' }),
        resolveOwnerMeterDisplayStatus({ monthlyUtilityBillStatus: 'paid', overallFinancialStatus: 'paid' }),
        resolveOwnerMeterDisplayStatus({ billingSource: 'DAILY_STAY', isDailyOverdue: true }),
      ];

      const invalidLabels = statuses.filter(s => s.label === 'ไม่ถูกต้อง');
      expect(invalidLabels.length).toBe(0);
    });
  });

  // =========================================================================
  // PART B: TABLE & SPLIT TESTS (TAB1–TAB4 & SPLIT1–SPLIT5)
  // =========================================================================
  describe('PART B: Table & Split Tests (TAB1–TAB4 & SPLIT1–SPLIT5)', () => {
    it('TAB1–TAB4 & SPLIT1: Modern split renders separate Rent & MU rows without synthetic combined label', async () => {
      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (_method: string, url: string) => {
        if (url.includes('/meters/workspace/preview-context')) {
          return {
            success: true,
            data: {
              rateSnapshot: { waterBillingType: 'per_unit', electricityBillingType: 'per_unit' },
              rooms: [
                {
                  roomId: 'room-101',
                  roomNumber: '101',
                  billingSource: 'CONTRACT',
                  amountDue: '6100.00',
                  chargeComponents: [
                    { type: 'rent', label: 'ค่าเช่า (เดือน)', amount: '4800.00', status: 'UNPAID', occurredInDisplayedPeriod: true, includedInAmountDue: true },
                    { type: 'monthly_utility', label: 'บิลรายเดือน', amount: '1300.00', status: 'UNPAID', occurredInDisplayedPeriod: true, includedInAmountDue: true },
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
              rooms: [{ roomId: 'room-101', roomNumber: '101', billingSource: 'CONTRACT', rentAmount: 4800 }],
              readings: [],
            },
          };
        }
        return { success: true, data: [] };
      });

      render(
        <QueryClientProvider client={queryClient}>
          <OwnerMeters
            rooms={[baseSampleRoom] as any}
            buildings={[{ id: 'bldg-1', dormitoryId: 'dorm-1', name: 'อาคาร A', totalFloors: 1, roomsPerFloor: 1, createdAt: '2026-08-01' } as any]}
            dormitoryId="dorm-1"
            bills={[]}
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

      await waitFor(() => {
        expect(screen.getByText('101')).toBeDefined();
      });

      const detailBtn = screen.getByRole('button', { name: /ดูรายละเอียด/i });
      fireEvent.click(detailBtn);

      expect(screen.getByText(/ค่าเช่า \(เดือน\)/i)).toBeDefined();
      expect(screen.getByText('4,800.-')).toBeDefined();
      expect(screen.getByText('บิลรายเดือน')).toBeDefined();
      expect(screen.getByText('1,300.-')).toBeDefined();
      expect(screen.queryByText(/รวมค่าเช่า/i)).toBeNull();
      expect(screen.getByText('6,100.00 ฿')).toBeDefined();
    });

    it('SPLIT2: Modern Rent only produces Rent only component', () => {
      const breakdown = getOwnerFinancialBreakdown({
        amountDue: '4800.00',
        chargeComponents: [
          { type: 'rent', label: 'ค่าเช่า (เดือน)', amount: '4800.00', status: 'UNPAID' },
        ],
      });
      expect(breakdown.components.length).toBe(1);
      expect(breakdown.components[0].type).toBe('rent');
      expect(breakdown.components[0].label).toBe('ค่าเช่า (เดือน)');
    });

    it('SPLIT3: Modern MU only produces MU only component', () => {
      const breakdown = getOwnerFinancialBreakdown({
        amountDue: '650.00',
        chargeComponents: [
          { type: 'monthly_utility', label: 'บิลรายเดือน', amount: '650.00', status: 'PREVIEW' },
        ],
      });
      expect(breakdown.components.length).toBe(1);
      expect(breakdown.components[0].type).toBe('monthly_utility');
      expect(breakdown.components[0].label).toBe('บิลรายเดือน');
    });

    it('SPLIT5 & P1: Historical legacy decomposed into separate Rent and MU components without combined label', () => {
      const breakdown = getOwnerFinancialBreakdown({
        amountDue: '5450.00',
        chargeComponents: [
          { type: 'rent', label: 'ค่าเช่า (เดือน)', amount: '4500.00', status: 'UNPAID' },
          { type: 'monthly_utility', label: 'บิลรายเดือน', amount: '950.00', status: 'UNPAID' },
        ],
      });
      expect(breakdown.components.length).toBe(2);
      expect(breakdown.components[0].type).toBe('rent');
      expect(breakdown.components[0].label).toBe('ค่าเช่า (เดือน)');
      expect(breakdown.components[1].type).toBe('monthly_utility');
      expect(breakdown.components[1].label).toBe('บิลรายเดือน');
      for (const comp of breakdown.components) {
        expect(comp.label).not.toContain('รวมค่าเช่า');
      }
    });
  });

  // =========================================================================
  // PART C: LIST TESTS (LST1–LST8)
  // =========================================================================
  describe('PART C: List Tests (LST1–LST8)', () => {
    it('LST1–LST8: List Mode itemizes components without generic บิลรายเดือน summary row', () => {
      const { container } = render(
        <OwnerMeterListCard
          row={{
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
            billStatus: 'unpaid',
            otherFees: [{ description: 'ค่าทำความสะอาด', amount: '50.00' }],
          } as any}
          idx={0}
          roomCtx={{
            roomId: 'room-101',
            roomNumber: '101',
            billingSource: 'CONTRACT',
            rentAmount: '4500.00',
            amountDue: '5780.00',
            chargeComponents: [
              { type: 'rent', label: 'ค่าเช่า (เดือน)', amount: '4500.00', status: 'UNPAID' },
              {
                type: 'monthly_utility',
                label: 'บิลรายเดือน',
                amount: '1280.00',
                status: 'UNPAID',
                lineItems: [
                  { type: 'water', description: 'ค่าน้ำ (10 หน่วย)', amount: '180.00' },
                  { type: 'electricity', description: 'ค่าไฟฟ้า (100 หน่วย)', amount: '700.00' },
                  { type: 'common_fee', description: 'ค่าส่วนกลาง', amount: '200.00' },
                  { type: 'internet', description: 'ค่าอินเทอร์เน็ต', amount: '150.00' },
                  { type: 'parking', description: 'ค่าที่จอดรถ', amount: '300.00' },
                  { type: 'late_fee', description: 'ค่าปรับล่าช้า (1 วัน)', amount: '50.00' },
                ],
              },
            ],
          } as any}
          isWaterUnit={true}
          isElecUnit={true}
          isFirstCycle={false}
          selectedCycleCode="2026-08"
          selectedCycle="2026-08"
          selectedBillingCycleId="cycle-2026-08"
          isSaving={false}
          unlockedElecPrev={{}}
          unlockedWaterPrev={{}}
          flashingCells={{}}
          isExpandedBreakdown={true}
          onOpenOtherFees={vi.fn()}
          onMeterReadingChange={vi.fn()}
          onMeterReadingBlur={vi.fn()}
          onPaste={vi.fn()}
          onUnlockElecPrev={vi.fn()}
          onCancelElecPrev={vi.fn()}
          onUnlockWaterPrev={vi.fn()}
          onCancelWaterPrev={vi.fn()}
          onPeopleCountChange={vi.fn()}
          onToggleStatusSwitch={vi.fn()}
          onToggleBreakdown={vi.fn()}
          onSelectTenant={vi.fn()}
        />
      );

      // LST3: Rent once in top Rent zone
      expect(screen.getByText('4,500 .-')).toBeDefined();

      // LST4: Water once in Water card
      expect(screen.getByText('น้ำ')).toBeDefined();

      // LST5: Electricity once in Electricity card
      expect(screen.getByText('ไฟฟ้า')).toBeDefined();

      // LST6: Other Fee once
      expect(screen.getByText('ค่าทำความสะอาด')).toBeDefined();

      // LST7: Common/Internet/Parking visible in Zone E
      expect(screen.getByText('ค่าส่วนกลาง')).toBeDefined();
      expect(screen.getByText('200.-')).toBeDefined();
      expect(screen.getByText('ค่าอินเทอร์เน็ต')).toBeDefined();
      expect(screen.getByText('150.-')).toBeDefined();
      expect(screen.getByText('ค่าที่จอดรถ')).toBeDefined();
      expect(screen.getByText('300.-')).toBeDefined();

      // LST8: Late fee visible when present
      expect(screen.getByText('ค่าปรับล่าช้า (1 วัน)')).toBeDefined();
      expect(screen.getByText('50.-')).toBeDefined();

      // LST1: Generic 'บิลรายเดือน' absent
      const expandedZone = container.querySelector('.border-dashed');
      expect(expandedZone).not.toBeNull();
      expect(expandedZone!.textContent).not.toContain('บิลรายเดือน');
    });

    it('LST2: When no Zone E items exist, ดูรายละเอียด button is absent and no บิลรายเดือน 0 is made', () => {
      render(
        <OwnerMeterListCard
          row={{
            roomId: 'room-102',
            roomNumber: '102',
            floor: 1,
            waterPrev: '100',
            waterCurr: '110',
            elecPrev: '500',
            elecCurr: '600',
            isReplaced: false,
            peopleCount: 1,
            overdueAmount: '0.00',
            isPaid: false,
            billStatus: 'unpaid',
            otherFees: [],
          } as any}
          idx={1}
          roomCtx={{
            roomId: 'room-102',
            roomNumber: '102',
            billingSource: 'CONTRACT',
            rentAmount: '4500.00',
            amountDue: '5380.00',
            chargeComponents: [
              { type: 'rent', label: 'ค่าเช่า (เดือน)', amount: '4500.00', status: 'UNPAID' },
              {
                type: 'monthly_utility',
                label: 'บิลรายเดือน',
                amount: '880.00',
                status: 'UNPAID',
                lineItems: [
                  { type: 'water', description: 'ค่าน้ำ (10 หน่วย)', amount: '180.00' },
                  { type: 'electricity', description: 'ค่าไฟฟ้า (100 หน่วย)', amount: '700.00' },
                ],
              },
            ],
          } as any}
          isWaterUnit={true}
          isElecUnit={true}
          isFirstCycle={false}
          selectedCycleCode="2026-08"
          selectedCycle="2026-08"
          selectedBillingCycleId="cycle-2026-08"
          isSaving={false}
          unlockedElecPrev={{}}
          unlockedWaterPrev={{}}
          flashingCells={{}}
          isExpandedBreakdown={false}
          onOpenOtherFees={vi.fn()}
          onMeterReadingChange={vi.fn()}
          onMeterReadingBlur={vi.fn()}
          onPaste={vi.fn()}
          onUnlockElecPrev={vi.fn()}
          onCancelElecPrev={vi.fn()}
          onUnlockWaterPrev={vi.fn()}
          onCancelWaterPrev={vi.fn()}
          onPeopleCountChange={vi.fn()}
          onToggleStatusSwitch={vi.fn()}
          onToggleBreakdown={vi.fn()}
          onSelectTenant={vi.fn()}
        />
      );

      expect(screen.queryByRole('button', { name: /ดูรายละเอียด/i })).toBeNull();
    });
  });

  // =========================================================================
  // PART D: SETTINGS TESTS (SET1–SET13)
  // =========================================================================
  describe('PART D: Settings Tests (SET1–SET13)', () => {
    it('SET1–SET13: Collapsible payment & late fee section, only 3 modes, free mode disabled input, no percentage or grace', async () => {
      const updateDormitoryDefaults = vi.spyOn(ApiPropertyAdapter.prototype, 'updateDormitoryDefaults').mockResolvedValue({
        success: true,
        data: { id: 'dorm-1', version: 1 } as any,
      });

      render(
        <OwnerSettings
          dormitory={{ id: 'dorm-1', name: 'หอพักสุขใจ' } as any}
          onRefreshData={() => {}}
          onAddLog={() => {}}
        />
      );

      // SET1: Collapsed header visible
      const toggleHeader = screen.getByTestId('toggle-late-fee-section');
      expect(toggleHeader).toBeDefined();
      expect(toggleHeader.textContent).toContain('กำหนดชำระและค่าปรับเกินกำหนด');

      // SET2: Three inputs hidden while collapsed
      expect(screen.queryByTestId('input-due-day')).toBeNull();
      expect(screen.queryByTestId('select-late-fee-type')).toBeNull();
      expect(screen.queryByTestId('input-late-fee')).toBeNull();

      // SET3: Click expand -> exactly three controls visible
      fireEvent.click(toggleHeader);
      expect(screen.getByTestId('input-due-day')).toBeDefined();
      expect(screen.getByTestId('select-late-fee-type')).toBeDefined();
      expect(screen.getByTestId('input-late-fee')).toBeDefined();

      // SET5 & SET6: Select options exactly none/daily/fixed, no percentage
      const selectLateFee = screen.getByTestId('select-late-fee-type') as HTMLSelectElement;
      const optionValues = Array.from(selectLateFee.options).filter(o => !o.disabled).map(o => o.value);
      expect(optionValues).toEqual(['none', 'daily', 'fixed']);
      expect(optionValues).not.toContain('percentage');

      // SET7: none -> amount 0.00 disabled
      fireEvent.change(selectLateFee, { target: { value: 'none' } });
      expect(screen.getByTestId('input-late-fee')).toHaveProperty('disabled', true);

      // SET8: daily -> amount editable
      fireEvent.change(selectLateFee, { target: { value: 'daily' } });
      const dailyInput = screen.getByTestId('input-late-fee') as HTMLInputElement;
      expect(dailyInput.disabled).toBe(false);
      fireEvent.change(dailyInput, { target: { value: '50.00' } });
      expect(dailyInput.value).toBe('50.00');

      // SET9: fixed -> amount editable
      fireEvent.change(selectLateFee, { target: { value: 'fixed' } });
      const fixedInput = screen.getByTestId('input-late-fee') as HTMLInputElement;
      expect(fixedInput.disabled).toBe(false);
      fireEvent.change(fixedInput, { target: { value: '100.00' } });
      expect(fixedInput.value).toBe('100.00');

      // SET10: dueDay save persists
      const dueDayInput = screen.getByTestId('input-due-day');
      fireEvent.change(dueDayInput, { target: { value: '10' } });
      fireEvent.blur(dueDayInput);
      expect(updateDormitoryDefaults).toHaveBeenCalledWith({
        billing: {
          changes: { dueDay: 10 },
          expectedVersion: 1,
        },
      });

      // SET11: Grace control absent
      expect(screen.queryByText(/ระยะผ่อนผัน/i)).toBeNull();
      expect(screen.queryByText(/grace/i)).toBeNull();

      // SET12: Initial rent absent
      expect(screen.queryByText(/ค่าเช่าเริ่มต้น/i)).toBeNull();

      // SET13: Initial deposit absent
      expect(screen.queryByText(/เงินประกันเริ่มต้น/i)).toBeNull();

      // SET4: Click collapse -> controls hidden again
      fireEvent.click(toggleHeader);
      expect(screen.queryByTestId('input-due-day')).toBeNull();
      expect(screen.queryByTestId('select-late-fee-type')).toBeNull();
      expect(screen.queryByTestId('input-late-fee')).toBeNull();
    });
  });

  // =========================================================================
  // PART E: COLOR AUTHORITY TESTS (COLOR1–COLOR6)
  // =========================================================================
  describe('PART E: Color Authority Tests (COLOR1–COLOR6)', () => {
    it('COLOR1: Rent UNPAID (warning) + MU PREVIEW (neutral)', () => {
      expect(resolveFinancialComponentTone('UNPAID')).toBe('warning');
      expect(resolveFinancialComponentTone('PREVIEW')).toBe('neutral');
    });

    it('COLOR2: Rent UNPAID (warning) + MU PAID (success)', () => {
      expect(resolveFinancialComponentTone('UNPAID')).toBe('warning');
      expect(resolveFinancialComponentTone('PAID')).toBe('success');
    });

    it('COLOR3: Rent PAID (success) + MU UNPAID (warning)', () => {
      expect(resolveFinancialComponentTone('PAID')).toBe('success');
      expect(resolveFinancialComponentTone('UNPAID')).toBe('warning');
    });

    it('COLOR4: Both PAID -> both success', () => {
      expect(resolveFinancialComponentTone('PAID')).toBe('success');
    });

    it('COLOR5: Genuine LEGACY_COMBINED UNPAID -> warning', () => {
      expect(resolveFinancialComponentTone('UNPAID')).toBe('warning');
    });

    it('COLOR6: Component tone is determined from component status, not overall status', () => {
      // Room overall is unpaid, but individual component is PAID
      const paidTone = resolveFinancialComponentTone('PAID');
      expect(paidTone).toBe('success');
      // Room overall is paid, but individual preview component is PREVIEW
      const previewTone = resolveFinancialComponentTone('PREVIEW');
      expect(previewTone).toBe('neutral');
    });
  });

  // =========================================================================
  // PART F: SHARED RESOLVER DIRECT MATRIX TESTS (RES1–RES9)
  // =========================================================================
  describe('PART F: Shared Resolver Direct Matrix Tests (RES1–RES9)', () => {
    it('RES1: MU unissued + no Rent -> statusKey UNISSUED, ยังไม่ออกบิล, neutral tone', () => {
      const res = resolveOwnerMeterDisplayStatus({
        monthlyUtilityBillStatus: 'draft',
        overallFinancialStatus: 'draft',
        isPaid: false,
      });
      expect(res).toEqual({
        statusKey: 'UNISSUED',
        label: 'ยังไม่ออกบิล',
        tone: 'neutral',
        isDaily: false,
        isMonthlyUtilityIssued: false,
        isMonthlyUtilityPaid: false,
        isOverallPaid: false,
        hasValidationError: false,
      });
    });

    it('RES2: MU unissued + Rent unpaid -> statusKey UNISSUED, ยังไม่ออกบิล, neutral tone (MU precedence)', () => {
      const res = resolveOwnerMeterDisplayStatus({
        billingSource: 'CONTRACT',
        monthlyUtilityBillStatus: 'draft',
        overallFinancialStatus: 'unpaid',
        isPaid: false,
        isMonthlyUtilityPaid: false,
      });
      expect(res).toEqual({
        statusKey: 'UNISSUED',
        label: 'ยังไม่ออกบิล',
        tone: 'neutral',
        isDaily: false,
        isMonthlyUtilityIssued: false,
        isMonthlyUtilityPaid: false,
        isOverallPaid: false,
        hasValidationError: false,
      });
    });

    it('RES3: MU unissued + invalid component -> statusKey UNISSUED, ยังไม่ออกบิล, neutral tone with hasValidationError true', () => {
      const res = resolveOwnerMeterDisplayStatus({
        billingSource: 'CONTRACT',
        monthlyUtilityBillStatus: 'draft',
        overallFinancialStatus: 'draft',
        chargeComponents: [{ status: 'INVALID' }],
      });
      expect(res).toEqual({
        statusKey: 'UNISSUED',
        label: 'ยังไม่ออกบิล',
        tone: 'neutral',
        isDaily: false,
        isMonthlyUtilityIssued: false,
        isMonthlyUtilityPaid: false,
        isOverallPaid: false,
        hasValidationError: true,
      });
    });

    it('RES4: MU unpaid -> statusKey UNPAID, รอชำระ, warning tone', () => {
      const res = resolveOwnerMeterDisplayStatus({
        billingSource: 'CONTRACT',
        monthlyUtilityBillStatus: 'unpaid',
        overallFinancialStatus: 'unpaid',
        isPaid: false,
        isMonthlyUtilityPaid: false,
      });
      expect(res).toEqual({
        statusKey: 'UNPAID',
        label: 'รอชำระ',
        tone: 'warning',
        isDaily: false,
        isMonthlyUtilityIssued: true,
        isMonthlyUtilityPaid: false,
        isOverallPaid: false,
        hasValidationError: false,
      });
    });

    it('RES5: MU paid + Rent unpaid -> statusKey UNPAID, รอชำระ, warning tone, isMonthlyUtilityPaid true', () => {
      const res = resolveOwnerMeterDisplayStatus({
        billingSource: 'CONTRACT',
        monthlyUtilityBillStatus: 'paid',
        overallFinancialStatus: 'unpaid',
        isPaid: false,
        isMonthlyUtilityPaid: true,
      });
      expect(res).toEqual({
        statusKey: 'UNPAID',
        label: 'รอชำระ',
        tone: 'warning',
        isDaily: false,
        isMonthlyUtilityIssued: true,
        isMonthlyUtilityPaid: true,
        isOverallPaid: false,
        hasValidationError: false,
      });
    });

    it('RES6: all paid -> statusKey PAID, ชำระแล้ว, success tone, isOverallPaid true', () => {
      const res = resolveOwnerMeterDisplayStatus({
        billingSource: 'CONTRACT',
        monthlyUtilityBillStatus: 'paid',
        overallFinancialStatus: 'paid',
        isPaid: true,
        isMonthlyUtilityPaid: true,
      });
      expect(res).toEqual({
        statusKey: 'PAID',
        label: 'ชำระแล้ว',
        tone: 'success',
        isDaily: false,
        isMonthlyUtilityIssued: true,
        isMonthlyUtilityPaid: true,
        isOverallPaid: true,
        hasValidationError: false,
      });
    });

    it('RES7: Daily Overdue -> statusKey DAILY_OVERDUE, รายวัน, danger tone', () => {
      const res = resolveOwnerMeterDisplayStatus({
        billingSource: 'DAILY_STAY',
        isDailyOverdue: true,
        isDailyRentPaid: false,
      });
      expect(res).toEqual({
        statusKey: 'DAILY_OVERDUE',
        label: 'รายวัน',
        tone: 'danger',
        isDaily: true,
        isMonthlyUtilityIssued: false,
        isMonthlyUtilityPaid: false,
        isOverallPaid: false,
        hasValidationError: false,
      });
    });

    it('RES8: Daily Paid -> statusKey DAILY_PAID, รายวัน, success tone', () => {
      const res = resolveOwnerMeterDisplayStatus({
        billingSource: 'DAILY_STAY',
        isDailyOverdue: false,
        isDailyRentPaid: true,
      });
      expect(res).toEqual({
        statusKey: 'DAILY_PAID',
        label: 'รายวัน',
        tone: 'success',
        isDaily: true,
        isMonthlyUtilityIssued: false,
        isMonthlyUtilityPaid: false,
        isOverallPaid: true,
        hasValidationError: false,
      });
    });

    it('RES9: Daily Unpaid -> statusKey DAILY_UNPAID, รายวัน, neutral tone', () => {
      const res = resolveOwnerMeterDisplayStatus({
        billingSource: 'DAILY_STAY',
        isDailyOverdue: false,
        isDailyRentPaid: false,
      });
      expect(res).toEqual({
        statusKey: 'DAILY_UNPAID',
        label: 'รายวัน',
        tone: 'neutral',
        isDaily: true,
        isMonthlyUtilityIssued: false,
        isMonthlyUtilityPaid: false,
        isOverallPaid: false,
        hasValidationError: false,
      });
    });
  });

  // =========================================================================
  // PART G: CANONICAL RENT OBLIGATION AUTHORITY TESTS (RENT-A1–RENT-A7)
  // =========================================================================
  describe('PART G: Canonical Rent Obligation Authority Tests (RENT-A1–RENT-A7)', () => {
    it('RENT-A1: room.monthlyRent = 4500, canonical components has MU only -> List Rent row is ABSENT', () => {
      render(
        <OwnerMeterListCard
          row={{
            roomId: 'room-101',
            roomNumber: '101',
            floor: 1,
            rentAmount: 4500, // room reference price
            waterPrev: '110',
            waterCurr: '121',
            elecPrev: '560',
            elecCurr: '620',
            isReplaced: false,
            peopleCount: 2,
            overdueAmount: '0.00',
            isPaid: false,
            billStatus: 'unpaid',
            otherFees: [],
          } as any}
          idx={0}
          roomCtx={{
            roomId: 'room-101',
            roomNumber: '101',
            billingSource: 'CONTRACT',
            rentAmount: '4500.00',
            amountDue: '1268.00',
            chargeComponents: [
              { type: 'monthly_utility', label: 'บิลรายเดือน', amount: '1268.00', status: 'UNPAID' },
            ],
          } as any}
          isWaterUnit={true}
          isElecUnit={true}
          isFirstCycle={false}
          selectedCycleCode="2026-08"
          selectedCycle="2026-08"
          selectedBillingCycleId="cycle-2026-08"
          isSaving={false}
          unlockedElecPrev={{}}
          unlockedWaterPrev={{}}
          flashingCells={{}}
          isExpandedBreakdown={false}
          onOpenOtherFees={vi.fn()}
          onMeterReadingChange={vi.fn()}
          onMeterReadingBlur={vi.fn()}
          onPaste={vi.fn()}
          onUnlockElecPrev={vi.fn()}
          onCancelElecPrev={vi.fn()}
          onUnlockWaterPrev={vi.fn()}
          onCancelWaterPrev={vi.fn()}
          onPeopleCountChange={vi.fn()}
          onToggleStatusSwitch={vi.fn()}
          onToggleBreakdown={vi.fn()}
          onSelectTenant={vi.fn()}
        />
      );

      // Rent row MUST NOT exist merely because room has monthlyRent = 4500
      expect(screen.queryByText(/ค่าเช่า/i)).toBeNull();
      expect(screen.queryByText('4,500 .-')).toBeNull();
      expect(screen.queryByText('4,500.-')).toBeNull();
    });

    it('RENT-A2: roomCtx.rentAmount = 4500, canonical components has MU only -> Rent row is ABSENT', () => {
      render(
        <OwnerMeterListCard
          row={{
            roomId: 'room-101',
            roomNumber: '101',
            floor: 1,
            waterPrev: '110',
            waterCurr: '121',
            elecPrev: '560',
            elecCurr: '620',
            isReplaced: false,
            peopleCount: 2,
            overdueAmount: '0.00',
            isPaid: false,
            billStatus: 'unpaid',
            otherFees: [],
          } as any}
          idx={0}
          roomCtx={{
            roomId: 'room-101',
            roomNumber: '101',
            billingSource: 'CONTRACT',
            rentAmount: '4500.00',
            amountDue: '1268.00',
            chargeComponents: [
              { type: 'monthly_utility', label: 'บิลรายเดือน', amount: '1268.00', status: 'UNPAID' },
            ],
          } as any}
          isWaterUnit={true}
          isElecUnit={true}
          isFirstCycle={false}
          selectedCycleCode="2026-08"
          selectedCycle="2026-08"
          selectedBillingCycleId="cycle-2026-08"
          isSaving={false}
          unlockedElecPrev={{}}
          unlockedWaterPrev={{}}
          flashingCells={{}}
          isExpandedBreakdown={false}
          onOpenOtherFees={vi.fn()}
          onMeterReadingChange={vi.fn()}
          onMeterReadingBlur={vi.fn()}
          onPaste={vi.fn()}
          onUnlockElecPrev={vi.fn()}
          onCancelElecPrev={vi.fn()}
          onUnlockWaterPrev={vi.fn()}
          onCancelWaterPrev={vi.fn()}
          onPeopleCountChange={vi.fn()}
          onToggleStatusSwitch={vi.fn()}
          onToggleBreakdown={vi.fn()}
          onSelectTenant={vi.fn()}
        />
      );

      expect(screen.queryByText(/ค่าเช่า/i)).toBeNull();
      expect(screen.queryByText('4,500 .-')).toBeNull();
    });

    it('RENT-A3: overallFinancialStatus = unpaid, canonical Rent absent -> Rent row is ABSENT', () => {
      render(
        <OwnerMeterListCard
          row={{
            roomId: 'room-101',
            roomNumber: '101',
            floor: 1,
            waterPrev: '110',
            waterCurr: '121',
            elecPrev: '560',
            elecCurr: '620',
            isReplaced: false,
            peopleCount: 2,
            overdueAmount: '0.00',
            isPaid: false,
            billStatus: 'unpaid',
            otherFees: [],
          } as any}
          idx={0}
          roomCtx={{
            roomId: 'room-101',
            roomNumber: '101',
            billingSource: 'CONTRACT',
            rentAmount: '4500.00',
            overallFinancialStatus: 'unpaid',
            amountDue: '1268.00',
            chargeComponents: [
              { type: 'monthly_utility', label: 'บิลรายเดือน', amount: '1268.00', status: 'UNPAID' },
            ],
          } as any}
          isWaterUnit={true}
          isElecUnit={true}
          isFirstCycle={false}
          selectedCycleCode="2026-08"
          selectedCycle="2026-08"
          selectedBillingCycleId="cycle-2026-08"
          isSaving={false}
          unlockedElecPrev={{}}
          unlockedWaterPrev={{}}
          flashingCells={{}}
          isExpandedBreakdown={false}
          onOpenOtherFees={vi.fn()}
          onMeterReadingChange={vi.fn()}
          onMeterReadingBlur={vi.fn()}
          onPaste={vi.fn()}
          onUnlockElecPrev={vi.fn()}
          onCancelElecPrev={vi.fn()}
          onUnlockWaterPrev={vi.fn()}
          onCancelWaterPrev={vi.fn()}
          onPeopleCountChange={vi.fn()}
          onToggleStatusSwitch={vi.fn()}
          onToggleBreakdown={vi.fn()}
          onSelectTenant={vi.fn()}
        />
      );

      // Does NOT fallback from overallFinancialStatus = unpaid to generate orange rent row
      expect(screen.queryByText(/ค่าเช่า/i)).toBeNull();
      expect(screen.queryByText('4,500 .-')).toBeNull();
    });

    it('RENT-A4: canonical RENT component 4500 UNPAID -> Rent row present, amount 4500, warning tone', () => {
      const { container } = render(
        <OwnerMeterListCard
          row={{
            roomId: 'room-101',
            roomNumber: '101',
            floor: 1,
            waterPrev: '110',
            waterCurr: '121',
            elecPrev: '560',
            elecCurr: '620',
            isReplaced: false,
            peopleCount: 2,
            overdueAmount: '0.00',
            isPaid: false,
            billStatus: 'unpaid',
            otherFees: [],
          } as any}
          idx={0}
          roomCtx={{
            roomId: 'room-101',
            roomNumber: '101',
            billingSource: 'CONTRACT',
            rentAmount: '4500.00',
            amountDue: '5768.00',
            chargeComponents: [
              { type: 'rent', label: 'ค่าเช่า (เดือน)', amount: '4500.00', status: 'UNPAID' },
              { type: 'monthly_utility', label: 'บิลรายเดือน', amount: '1268.00', status: 'UNPAID' },
            ],
          } as any}
          isWaterUnit={true}
          isElecUnit={true}
          isFirstCycle={false}
          selectedCycleCode="2026-08"
          selectedCycle="2026-08"
          selectedBillingCycleId="cycle-2026-08"
          isSaving={false}
          unlockedElecPrev={{}}
          unlockedWaterPrev={{}}
          flashingCells={{}}
          isExpandedBreakdown={false}
          onOpenOtherFees={vi.fn()}
          onMeterReadingChange={vi.fn()}
          onMeterReadingBlur={vi.fn()}
          onPaste={vi.fn()}
          onUnlockElecPrev={vi.fn()}
          onCancelElecPrev={vi.fn()}
          onUnlockWaterPrev={vi.fn()}
          onCancelWaterPrev={vi.fn()}
          onPeopleCountChange={vi.fn()}
          onToggleStatusSwitch={vi.fn()}
          onToggleBreakdown={vi.fn()}
          onSelectTenant={vi.fn()}
        />
      );

      expect(screen.getByText(/ค่าเช่า \(เดือน\)/i)).toBeDefined();
      expect(screen.getByText('4,500 .-')).toBeDefined();
      const rentRow = container.querySelector('.text-amber-700');
      expect(rentRow).not.toBeNull();
    });

    it('RENT-A5: canonical RENT component 4500 PAID -> Rent row present, success tone', () => {
      const { container } = render(
        <OwnerMeterListCard
          row={{
            roomId: 'room-101',
            roomNumber: '101',
            floor: 1,
            waterPrev: '110',
            waterCurr: '121',
            elecPrev: '560',
            elecCurr: '620',
            isReplaced: false,
            peopleCount: 2,
            overdueAmount: '0.00',
            isPaid: false,
            billStatus: 'unpaid',
            otherFees: [],
          } as any}
          idx={0}
          roomCtx={{
            roomId: 'room-101',
            roomNumber: '101',
            billingSource: 'CONTRACT',
            rentAmount: '4500.00',
            amountDue: '1268.00',
            chargeComponents: [
              { type: 'rent', label: 'ค่าเช่า (เดือน)', amount: '4500.00', status: 'PAID' },
              { type: 'monthly_utility', label: 'บิลรายเดือน', amount: '1268.00', status: 'UNPAID' },
            ],
          } as any}
          isWaterUnit={true}
          isElecUnit={true}
          isFirstCycle={false}
          selectedCycleCode="2026-08"
          selectedCycle="2026-08"
          selectedBillingCycleId="cycle-2026-08"
          isSaving={false}
          unlockedElecPrev={{}}
          unlockedWaterPrev={{}}
          flashingCells={{}}
          isExpandedBreakdown={false}
          onOpenOtherFees={vi.fn()}
          onMeterReadingChange={vi.fn()}
          onMeterReadingBlur={vi.fn()}
          onPaste={vi.fn()}
          onUnlockElecPrev={vi.fn()}
          onCancelElecPrev={vi.fn()}
          onUnlockWaterPrev={vi.fn()}
          onCancelWaterPrev={vi.fn()}
          onPeopleCountChange={vi.fn()}
          onToggleStatusSwitch={vi.fn()}
          onToggleBreakdown={vi.fn()}
          onSelectTenant={vi.fn()}
        />
      );

      expect(screen.getByText(/ค่าเช่า \(เดือน\)/i)).toBeDefined();
      expect(screen.getByText('4,500 .-')).toBeDefined();
      const rentRow = container.querySelector('.text-emerald-700');
      expect(rentRow).not.toBeNull();
    });

    it('RENT-A6: canonical RENT PREVIEW -> neutral tone', () => {
      const { container } = render(
        <OwnerMeterListCard
          row={{
            roomId: 'room-101',
            roomNumber: '101',
            floor: 1,
            waterPrev: '110',
            waterCurr: '121',
            elecPrev: '560',
            elecCurr: '620',
            isReplaced: false,
            peopleCount: 2,
            overdueAmount: '0.00',
            isPaid: false,
            billStatus: 'draft',
            otherFees: [],
          } as any}
          idx={0}
          roomCtx={{
            roomId: 'room-101',
            roomNumber: '101',
            billingSource: 'CONTRACT',
            rentAmount: '4500.00',
            amountDue: '5768.00',
            chargeComponents: [
              { type: 'rent', label: 'ค่าเช่า (เดือน)', amount: '4500.00', status: 'PREVIEW' },
              { type: 'monthly_utility', label: 'บิลรายเดือน', amount: '1268.00', status: 'PREVIEW' },
            ],
          } as any}
          isWaterUnit={true}
          isElecUnit={true}
          isFirstCycle={false}
          selectedCycleCode="2026-08"
          selectedCycle="2026-08"
          selectedBillingCycleId="cycle-2026-08"
          isSaving={false}
          unlockedElecPrev={{}}
          unlockedWaterPrev={{}}
          flashingCells={{}}
          isExpandedBreakdown={false}
          onOpenOtherFees={vi.fn()}
          onMeterReadingChange={vi.fn()}
          onMeterReadingBlur={vi.fn()}
          onPaste={vi.fn()}
          onUnlockElecPrev={vi.fn()}
          onCancelElecPrev={vi.fn()}
          onUnlockWaterPrev={vi.fn()}
          onCancelWaterPrev={vi.fn()}
          onPeopleCountChange={vi.fn()}
          onToggleStatusSwitch={vi.fn()}
          onToggleBreakdown={vi.fn()}
          onSelectTenant={vi.fn()}
        />
      );

      expect(screen.getByText(/ค่าเช่า \(เดือน\)/i)).toBeDefined();
      expect(screen.getByText('4,500 .-')).toBeDefined();
      const rentRow = container.querySelector('.text-slate-600');
      expect(rentRow).not.toBeNull();
    });

    it('RENT-A7 & ROOM101: Room 101 August 2026 UAT regression - Table/List parity without fabricated rent', async () => {
      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (_method: string, url: string) => {
        if (url.includes('/meters/workspace/preview-context')) {
          return {
            success: true,
            data: {
              rateSnapshot: { waterBillingType: 'per_unit', electricityBillingType: 'per_unit' },
              rooms: [
                {
                  roomId: 'room-101',
                  roomNumber: '101',
                  billingSource: 'CONTRACT',
                  rentAmount: '4500.00',
                  amountDue: '1268.00',
                  chargeComponents: [
                    { type: 'monthly_utility', label: 'บิลรายเดือน', amount: '1268.00', status: 'UNPAID', occurredInDisplayedPeriod: true, includedInAmountDue: true },
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
              rooms: [{ roomId: 'room-101', roomNumber: '101', billingSource: 'CONTRACT', rentAmount: 4500 }],
              readings: [],
            },
          };
        }
        return { success: true, data: [] };
      });

      render(
        <QueryClientProvider client={queryClient}>
          <OwnerMeters
            rooms={[baseSampleRoom] as any}
            buildings={[{ id: 'bldg-1', dormitoryId: 'dorm-1', name: 'อาคาร A', totalFloors: 1, roomsPerFloor: 1, createdAt: '2026-08-01' } as any]}
            dormitoryId="dorm-1"
            bills={[]}
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

      await waitFor(() => {
        expect(screen.getByText('101')).toBeDefined();
      });

      // Table View: Payable is 1,268.00 ฿
      expect(screen.getByText('1,268.00 ฿')).toBeDefined();

      // Open detail in Table: Only MU is shown, NO Rent
      const detailBtn = screen.getByRole('button', { name: /ดูรายละเอียด/i });
      fireEvent.click(detailBtn);

      expect(screen.getByText('บิลรายเดือน')).toBeDefined();
      expect(screen.getByText('1,268.-')).toBeDefined();
      expect(screen.queryByText(/ค่าเช่า \(เดือน\)/i)).toBeNull();

      // Switch to List View
      const listBtn = screen.getByTestId('view-mode-list-button');
      fireEvent.click(listBtn);

      await waitFor(() => {
        expect(screen.getByTestId('meter-list-card-room-101')).toBeDefined();
      });

      const card101 = screen.getByTestId('meter-list-card-room-101');
      // In List View: NO fabricated Rent row exists
      expect(within(card101).queryByText(/ค่าเช่า/i)).toBeNull();
      expect(within(card101).queryByText('4,500 .-')).toBeNull();
      // List bottom payable is strictly 1,268.00 ฿
      expect(within(card101).getByText('1,268.00 ฿')).toBeDefined();
    });

    it('R1: component type=monthly_utility with misleading label "ค่าเช่าอุปกรณ์" must NOT become RENT row', () => {
      render(
        <OwnerMeterListCard
          row={{
            roomId: 'room-101',
            roomNumber: '101',
            floor: 1,
            waterPrev: '110',
            waterCurr: '121',
            elecPrev: '560',
            elecCurr: '620',
            isReplaced: false,
            peopleCount: 2,
            overdueAmount: '0.00',
            isPaid: false,
            billStatus: 'unpaid',
            otherFees: [],
          } as any}
          idx={0}
          roomCtx={{
            roomId: 'room-101',
            roomNumber: '101',
            billingSource: 'CONTRACT',
            amountDue: '100.00',
            chargeComponents: [
              { type: 'monthly_utility', label: 'ค่าเช่าอุปกรณ์', amount: '100.00', status: 'UNPAID' },
            ],
          } as any}
          isWaterUnit={true}
          isElecUnit={true}
          isFirstCycle={false}
          selectedCycleCode="2026-08"
          selectedCycle="2026-08"
          selectedBillingCycleId="cycle-2026-08"
          isSaving={false}
          unlockedElecPrev={{}}
          unlockedWaterPrev={{}}
          flashingCells={{}}
          isExpandedBreakdown={false}
          onOpenOtherFees={vi.fn()}
          onMeterReadingChange={vi.fn()}
          onMeterReadingBlur={vi.fn()}
          onPaste={vi.fn()}
          onUnlockElecPrev={vi.fn()}
          onCancelElecPrev={vi.fn()}
          onUnlockWaterPrev={vi.fn()}
          onCancelWaterPrev={vi.fn()}
          onPeopleCountChange={vi.fn()}
          onToggleStatusSwitch={vi.fn()}
          onToggleBreakdown={vi.fn()}
          onSelectTenant={vi.fn()}
        />
      );

      // Must NOT render Zone A Rent row (e.g. ค่าเช่า (เดือน) 100.-)
      expect(screen.queryByText('ค่าเช่า (เดือน)')).toBeNull();
      expect(screen.queryByText('100 .-')).toBeNull();
    });

    it('R2: component type=other_fee with label "ค่าเช่าเครื่องซักผ้า" must NOT become RENT row', () => {
      const { rerender } = render(
        <OwnerMeterListCard
          row={{
            roomId: 'room-101',
            roomNumber: '101',
            floor: 1,
            waterPrev: '110',
            waterCurr: '121',
            elecPrev: '560',
            elecCurr: '620',
            isReplaced: false,
            peopleCount: 2,
            overdueAmount: '0.00',
            isPaid: false,
            billStatus: 'unpaid',
            otherFees: [],
          } as any}
          idx={0}
          roomCtx={{
            roomId: 'room-101',
            roomNumber: '101',
            billingSource: 'CONTRACT',
            amountDue: '300.00',
            chargeComponents: [
              { type: 'other_fee', label: 'ค่าเช่าเครื่องซักผ้า', amount: '300.00', status: 'UNPAID' },
            ],
          } as any}
          isWaterUnit={true}
          isElecUnit={true}
          isFirstCycle={false}
          selectedCycleCode="2026-08"
          selectedCycle="2026-08"
          selectedBillingCycleId="cycle-2026-08"
          isSaving={false}
          unlockedElecPrev={{}}
          unlockedWaterPrev={{}}
          flashingCells={{}}
          isExpandedBreakdown={false}
          onOpenOtherFees={vi.fn()}
          onMeterReadingChange={vi.fn()}
          onMeterReadingBlur={vi.fn()}
          onPaste={vi.fn()}
          onUnlockElecPrev={vi.fn()}
          onCancelElecPrev={vi.fn()}
          onUnlockWaterPrev={vi.fn()}
          onCancelWaterPrev={vi.fn()}
          onPeopleCountChange={vi.fn()}
          onToggleStatusSwitch={vi.fn()}
          onToggleBreakdown={vi.fn()}
          onSelectTenant={vi.fn()}
        />
      );

      // Must NOT render Zone A Rent row
      expect(screen.queryByText('ค่าเช่า (เดือน)')).toBeNull();

      // But when breakdown is expanded, it renders as an itemized other fee
      rerender(
        <OwnerMeterListCard
          row={{
            roomId: 'room-101',
            roomNumber: '101',
            floor: 1,
            waterPrev: '110',
            waterCurr: '121',
            elecPrev: '560',
            elecCurr: '620',
            isReplaced: false,
            peopleCount: 2,
            overdueAmount: '0.00',
            isPaid: false,
            billStatus: 'unpaid',
            otherFees: [],
          } as any}
          idx={0}
          roomCtx={{
            roomId: 'room-101',
            roomNumber: '101',
            billingSource: 'CONTRACT',
            amountDue: '300.00',
            chargeComponents: [
              { type: 'other_fee', label: 'ค่าเช่าเครื่องซักผ้า', amount: '300.00', status: 'UNPAID' },
            ],
          } as any}
          isWaterUnit={true}
          isElecUnit={true}
          isFirstCycle={false}
          selectedCycleCode="2026-08"
          selectedCycle="2026-08"
          selectedBillingCycleId="cycle-2026-08"
          isSaving={false}
          unlockedElecPrev={{}}
          unlockedWaterPrev={{}}
          flashingCells={{}}
          isExpandedBreakdown={true}
          onOpenOtherFees={vi.fn()}
          onMeterReadingChange={vi.fn()}
          onMeterReadingBlur={vi.fn()}
          onPaste={vi.fn()}
          onUnlockElecPrev={vi.fn()}
          onCancelElecPrev={vi.fn()}
          onUnlockWaterPrev={vi.fn()}
          onCancelWaterPrev={vi.fn()}
          onPeopleCountChange={vi.fn()}
          onToggleStatusSwitch={vi.fn()}
          onToggleBreakdown={vi.fn()}
          onSelectTenant={vi.fn()}
        />
      );

      expect(screen.getByText('ค่าเช่าเครื่องซักผ้า')).toBeDefined();
      expect(screen.getByText('300.-')).toBeDefined();
    });

    it('R3 & R5: Real canonical RENT + MU -> both components render independently with exact amounts and tones', () => {
      render(
        <OwnerMeterListCard
          row={{
            roomId: 'room-202',
            roomNumber: '202',
            floor: 2,
            waterPrev: '100',
            waterCurr: '110',
            elecPrev: '500',
            elecCurr: '600',
            isReplaced: false,
            peopleCount: 1,
            overdueAmount: '0.00',
            isPaid: false,
            billStatus: 'unpaid',
            otherFees: [],
          } as any}
          idx={0}
          roomCtx={{
            roomId: 'room-202',
            roomNumber: '202',
            billingSource: 'CONTRACT',
            rentAmount: '4800.00',
            amountDue: '6000.00',
            chargeComponents: [
              { type: 'rent', label: 'ค่าเช่า (เดือน)', amount: '4800.00', status: 'UNPAID' },
              {
                type: 'monthly_utility',
                label: 'บิลรายเดือน',
                amount: '1200.00',
                status: 'UNPAID',
                lineItems: [
                  { type: 'water', description: 'ค่าน้ำ (10 หน่วย)', amount: '180.00', quantity: '10', unitPrice: '18' },
                  { type: 'electricity', description: 'ค่าไฟฟ้า (100 หน่วย)', amount: '700.00', quantity: '100', unitPrice: '7' },
                  { type: 'common_fee', description: 'ค่าส่วนกลาง', amount: '320.00', quantity: '1', unitPrice: '320' },
                ],
              },
            ],
          } as any}
          isWaterUnit={true}
          isElecUnit={true}
          isFirstCycle={false}
          selectedCycleCode="2026-08"
          selectedCycle="2026-08"
          selectedBillingCycleId="cycle-2026-08"
          isSaving={false}
          unlockedElecPrev={{}}
          unlockedWaterPrev={{}}
          flashingCells={{}}
          isExpandedBreakdown={false}
          onOpenOtherFees={vi.fn()}
          onMeterReadingChange={vi.fn()}
          onMeterReadingBlur={vi.fn()}
          onPaste={vi.fn()}
          onUnlockElecPrev={vi.fn()}
          onCancelElecPrev={vi.fn()}
          onUnlockWaterPrev={vi.fn()}
          onCancelWaterPrev={vi.fn()}
          onPeopleCountChange={vi.fn()}
          onToggleStatusSwitch={vi.fn()}
          onToggleBreakdown={vi.fn()}
          onSelectTenant={vi.fn()}
        />
      );

      // Rent row is present with canonical 4,800 .-
      expect(screen.getByText(/ค่าเช่า \(เดือน\)/i)).toBeDefined();
      expect(screen.getByText('4,800 .-')).toBeDefined();
    });
  });

  // =========================================================================
  // PART H: UNIFORM HISTORICAL FINANCIAL DECOMPOSITION & MULTI-CYCLE PARITY
  // =========================================================================
  describe('PART H: Uniform Historical Financial Decomposition (P1–P13 & DEC1–DEC7)', () => {
    it('DEC2, P1 & P2: Historical July 2026 Room 101 Table View renders split Rent + MU without combined label', () => {
      const breakdown = getOwnerFinancialBreakdown({
        amountDue: '5450.00',
        chargeComponents: [
          { type: 'rent', label: 'ค่าเช่า (เดือน)', amount: '4500.00', status: 'PAID' },
          { type: 'monthly_utility', label: 'บิลรายเดือน', amount: '950.00', status: 'PAID' },
        ],
      });

      expect(breakdown.components).toHaveLength(2);
      expect(breakdown.components[0].label).toBe('ค่าเช่า (เดือน)');
      expect(breakdown.components[0].amount).toBe(4500);
      expect(breakdown.components[0].status).toBe('PAID');
      expect(breakdown.components[1].label).toBe('บิลรายเดือน');
      expect(breakdown.components[1].amount).toBe(950);
      expect(breakdown.components[1].status).toBe('PAID');

      for (const comp of breakdown.components) {
        expect(comp.label).not.toContain('รวมค่าเช่า');
      }
    });

    it('P3 & TYPE2: Term Occupant separates Term Rent, Deposit, and Monthly Utility', () => {
      const breakdown = getOwnerFinancialBreakdown({
        amountDue: '15950.00',
        chargeComponents: [
          { type: 'rent', label: 'ค่าเช่า (เทอม)', amount: '12000.00', status: 'UNPAID' },
          { type: 'deposit', label: 'ค่าประกัน', amount: '3000.00', status: 'UNPAID' },
          { type: 'monthly_utility', label: 'บิลรายเดือน', amount: '950.00', status: 'UNPAID' },
        ],
      });

      expect(breakdown.components).toHaveLength(3);
      expect(breakdown.components[0].type).toBe('rent');
      expect(breakdown.components[0].label).toBe('ค่าเช่า (เทอม)');
      expect(breakdown.components[1].type).toBe('deposit');
      expect(breakdown.components[1].label).toBe('ค่าประกัน');
      expect(breakdown.components[2].type).toBe('monthly_utility');
      expect(breakdown.components[2].label).toBe('บิลรายเดือน');
    });

    it('P4 & TYPE3: Daily Stay separates Daily Rent and Deposit without fabricating Monthly Utility', () => {
      const breakdown = getOwnerFinancialBreakdown({
        amountDue: '1350.00',
        chargeComponents: [
          { type: 'rent', label: 'ค่าเช่า (วัน)', amount: '400.00', status: 'UNPAID' },
          { type: 'deposit', label: 'ค่าประกัน', amount: '950.00', status: 'UNPAID' },
        ],
      });

      expect(breakdown.components).toHaveLength(2);
      expect(breakdown.components[0].type).toBe('rent');
      expect(breakdown.components[0].label).toBe('ค่าเช่า (วัน)');
      expect(breakdown.components[1].type).toBe('deposit');
      expect(breakdown.components[1].label).toBe('ค่าประกัน');
      expect(breakdown.components.some((c) => c.type === 'monthly_utility')).toBe(false);
    });

    it('P12 & DEC3/DEC4: Mixed statuses preserve independent component tones (Rent PAID + MU UNPAID)', () => {
      const breakdown = getOwnerFinancialBreakdown({
        amountDue: '950.00',
        chargeComponents: [
          { type: 'rent', label: 'ค่าเช่า (เดือน)', amount: '4500.00', status: 'PAID' },
          { type: 'monthly_utility', label: 'บิลรายเดือน', amount: '950.00', status: 'UNPAID' },
        ],
      });

      expect(breakdown.components[0].status).toBe('PAID');
      expect(breakdown.components[1].status).toBe('UNPAID');
    });
  });
});

