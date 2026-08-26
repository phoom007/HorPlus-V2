/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { OwnerMeterListCard } from '../components/meters/OwnerMeterListCard';
import { OwnerMeters, resolveOwnerMeterDisplayStatus } from '../pages/owner/meters';
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

    it('STAT3: MU unpaid -> renders รอชำระ', () => {
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

    it('STAT4: MU paid + RENT unpaid -> renders รอชำระ (S1 preserved, toggle locked)', () => {
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

    it('STAT5: All paid -> renders ชำระแล้ว', () => {
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
  });

  // =========================================================================
  // PART B: TABLE TESTS (TAB1–TAB4)
  // =========================================================================
  describe('PART B: Table Tests (TAB1–TAB4)', () => {
    it('TAB1–TAB4: Modern split renders separate Rent & MU rows without synthetic combined label', async () => {
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
            waterPrev: '10',
            waterCurr: '20',
            elecPrev: '100',
            elecCurr: '200',
            isReplaced: false,
            peopleCount: 1,
            overdueAmount: '0.00',
            isPaid: false,
            billStatus: 'draft',
            otherFees: [],
          } as any}
          idx={0}
          roomCtx={{
            roomId: 'room-102',
            roomNumber: '102',
            billingSource: 'CONTRACT',
            rentAmount: '4500.00',
            amountDue: '5380.00',
            chargeComponents: [
              { type: 'rent', label: 'ค่าเช่า (เดือน)', amount: '4500.00', status: 'PREVIEW' },
              {
                type: 'monthly_utility',
                label: 'บิลรายเดือน',
                amount: '880.00',
                status: 'PREVIEW',
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
      expect(screen.queryByText(/บิลรายเดือน/i)).toBeNull();
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
      const lateFeeInput = screen.getByTestId('input-late-fee') as HTMLInputElement;
      expect(lateFeeInput.disabled).toBe(true);
      expect(lateFeeInput.value).toBe('0.00');

      // SET8: daily -> amount editable
      fireEvent.change(selectLateFee, { target: { value: 'daily' } });
      expect(lateFeeInput.disabled).toBe(false);
      fireEvent.change(lateFeeInput, { target: { value: '50.00' } });
      expect(lateFeeInput.value).toBe('50.00');

      // SET9: fixed -> amount editable
      fireEvent.change(selectLateFee, { target: { value: 'fixed' } });
      expect(lateFeeInput.disabled).toBe(false);
      fireEvent.change(lateFeeInput, { target: { value: '100.00' } });
      expect(lateFeeInput.value).toBe('100.00');

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
  // PART E: SHARED RESOLVER DIRECT MATRIX TESTS (RES1–RES9)
  // =========================================================================
  describe('PART E: Shared Resolver Direct Matrix Tests (RES1–RES9)', () => {
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
      });
    });

    it('RES3: MU unpaid -> statusKey UNPAID, รอชำระ, warning tone', () => {
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
      });
    });

    it('RES4: MU paid + Rent unpaid -> statusKey UNPAID, รอชำระ, warning tone, isMonthlyUtilityPaid true', () => {
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
      });
    });

    it('RES5: all paid -> statusKey PAID, ชำระแล้ว, success tone, isOverallPaid true', () => {
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
      });
    });

    it('RES6: Daily Overdue -> statusKey DAILY_OVERDUE, รายวัน, danger tone', () => {
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
      });
    });

    it('RES7: Daily Paid -> statusKey DAILY_PAID, รายวัน, success tone', () => {
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
      });
    });

    it('RES8: Daily Unpaid -> statusKey DAILY_UNPAID, รายวัน, neutral tone', () => {
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
      });
    });

    it('RES9: INVALID component -> statusKey INVALID, ไม่ถูกต้อง, danger tone', () => {
      const res = resolveOwnerMeterDisplayStatus({
        billingSource: 'CONTRACT',
        monthlyUtilityBillStatus: 'issued',
        overallFinancialStatus: 'unpaid',
        chargeComponents: [{ status: 'INVALID' }],
      });
      expect(res).toEqual({
        statusKey: 'INVALID',
        label: 'ไม่ถูกต้อง',
        tone: 'danger',
        isDaily: false,
        isMonthlyUtilityIssued: true,
        isMonthlyUtilityPaid: false,
        isOverallPaid: false,
      });
    });
  });
});
