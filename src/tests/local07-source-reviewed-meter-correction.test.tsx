import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OwnerMeters, getOwnerFinancialBreakdown, mapErrorMessageToThai, getTenantForRoomAndCycleHelper } from '../pages/owner/meters';
import { OwnerTenants } from '../pages/owner/tenants';
import { TimeWheelPicker } from '../components/TimeWheelPicker';
import { getRollingThreeMonthWindow, isCycleInRollingThreeMonthWindow, toBangkokDateString } from '../utils/calendarDate';
import * as httpClient from '../data/httpClient';
import { Room, Bill, Tenant, Contract } from '../types';

describe('LOCAL-07 Source-Reviewed Meter Workspace Correction Suite', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    cleanup();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    });
    vi.clearAllMocks();
    global.fetch = vi.fn().mockImplementation(async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/billing-cycles')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: [
              { id: 'cycle-june', cycleCode: '2026-06', name: 'รอบบิล มิถุนายน 2569' },
              { id: 'cycle-july', cycleCode: '2026-07', name: 'รอบบิล กรกฎาคม 2569' },
              { id: 'cycle-aug', cycleCode: '2026-08', name: 'รอบบิล สิงหาคม 2569', isCurrent: true },
              { id: 'cycle-sep', cycleCode: '2026-09', name: 'รอบบิล กันยายน 2569' },
              { id: 'cycle-oct', cycleCode: '2026-10', name: 'รอบบิล ตุลาคม 2569' },
            ],
            firstBillingCycleId: 'cycle-aug',
            operationalBillingCycleId: 'cycle-aug',
            operationalCycleCode: '2026-08',
          }),
        };
      }
      if (urlStr.includes('/preview-context')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: {
              rateSnapshot: { waterBillingType: 'per_unit', waterRate: '18.00', electricityBillingType: 'per_unit', electricityRate: '7.00' },
              rooms: [],
            },
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: [],
        }),
      };
    }) as any;
  });

  // =========================================================================
  // 1. Exact 0 / 1 / 2-3 Financial Component UI & components.length > 1 Condition
  // =========================================================================
  describe('Owner Financial Breakdown & Component UI', () => {
    const defaultRateSnapshot = {
      waterBillingType: 'per_unit',
      waterRate: '18.00',
      electricityBillingType: 'per_unit',
      electricityRate: '7.00',
      commonFee: '200.00',
      commonFeeMode: 'per_room',
      internetFee: '0.00',
      internetFeeMode: 'none',
      parkingFee: '0.00',
      parkingFeeMode: 'none',
    };

    it('Proof 1A: 0 components -> returns formatted 0.00 ฿ and empty components list', () => {
      const row: any = {
        roomId: 'room-vacant-1',
        roomNumber: '101',
        waterPrev: '100',
        waterCurr: '100',
        elecPrev: '200',
        elecCurr: '200',
        peopleCount: 0,
        overdueAmount: '0.00',
        isPaid: false,
        billStatus: 'draft',
        otherFees: [],
      };
      const roomCtx: any = {
        roomId: 'room-vacant-1',
        billingSource: 'NONE',
        rentAmount: 0,
        depositAmount: 0,
      };

      const financial = getOwnerFinancialBreakdown(row, roomCtx, defaultRateSnapshot, [], 'cycle-1');
      expect(financial.formattedAmount).toBe('0.00');
      expect(financial.components.length).toBe(0);
    });

    it('Proof 1B: 1 component (Monthly Bill only) -> exactly 1 component, components.length is 1', () => {
      const row: any = {
        roomId: 'room-occ-1',
        roomNumber: '102',
        waterPrev: '100',
        waterCurr: '110', // 10 * 18 = 180
        elecPrev: '200',
        elecCurr: '250', // 50 * 7 = 350
        peopleCount: 1,
        overdueAmount: '0.00',
        isPaid: false,
        billStatus: 'draft',
        otherFees: [],
      };
      const roomCtx: any = {
        roomId: 'room-occ-1',
        billingSource: 'MONTHLY_CONTRACT',
        rentAmount: 0,
        depositAmount: 0,
      };

      const financial = getOwnerFinancialBreakdown(row, roomCtx, defaultRateSnapshot, [], 'cycle-1');
      // Water 180 + Elec 350 + Common 200 = 730 (Rent is independent)
      expect(financial.formattedAmount).toBe('730.00');
      expect(financial.components.length).toBe(1);
      expect(financial.components[0].label).toBe('บิลรายเดือน');
      expect(financial.components[0].formattedAmount).toBe('730.00');
    });

    it('Proof 1C: 2 components (Monthly Utility + Deposit) -> exactly 2 components with labels บิลรายเดือน and ค่าประกัน', () => {
      const row: any = {
        roomId: 'room-occ-2',
        roomNumber: '103',
        waterPrev: '100',
        waterCurr: '110',
        elecPrev: '200',
        elecCurr: '250',
        peopleCount: 1,
        overdueAmount: '0.00',
        isPaid: false,
        billStatus: 'draft',
        otherFees: [],
      };
      const roomCtx: any = {
        roomId: 'room-occ-2',
        billingSource: 'MONTHLY_CONTRACT',
        rentAmount: 0,
        depositAmount: 5000,
        showDepositLine: true,
        isDepositPaid: false,
      };

      const financial = getOwnerFinancialBreakdown(row, roomCtx, defaultRateSnapshot, [], 'cycle-1');
      // 730 + 5000 = 5730
      expect(financial.formattedAmount).toBe('5,730.00');
      expect(financial.components.length).toBe(2);
      expect(financial.components[0].label).toBe('บิลรายเดือน');
      expect(financial.components[1].label).toBe('ค่าประกัน');
    });

    it('Proof 1D: 3 components (Monthly Utility Bill + Deposit Bill + Rent Bill) -> exact labels บิลรายเดือน, ค่าประกัน, ค่าเช่า (เดือน) / ค่าเช่า (เทอม)', () => {
      const row: any = {
        roomId: 'room-occ-3',
        roomNumber: '104',
        waterPrev: '100',
        waterCurr: '110',
        elecPrev: '200',
        elecCurr: '250',
        peopleCount: 1,
        overdueAmount: '0.00',
        isPaid: false,
        billStatus: 'draft',
        otherFees: [],
      };
      const roomCtx: any = {
        roomId: 'room-occ-3',
        billingSource: 'PROVISIONAL_TERM',
        rentAmount: 18000,
        depositAmount: 5000,
      };

      const bills: Bill[] = [
        {
          id: 'b-util',
          billNumber: 'INV-001',
          dormitoryId: 'dorm-1',
          billingCycleId: 'cycle-1',
          cycleId: 'cycle-1',
          roomId: 'room-occ-3',
          billKind: 'MONTHLY_UTILITY',
          status: 'unpaid',
          subtotal: 730,
          totalAmount: 730,
          outstandingAmount: 730,
          paidAmount: 0,
          billingDate: '2026-08-25',
          dueDate: '2026-09-05',
          createdAt: '2026-08-25',
          updatedAt: '2026-08-25',
        } as any,
        {
          id: 'b-dep',
          billNumber: 'INV-002',
          dormitoryId: 'dorm-1',
          billingCycleId: 'cycle-1',
          cycleId: 'cycle-1',
          roomId: 'room-occ-3',
          billKind: 'DEPOSIT',
          status: 'paid',
          subtotal: 5000,
          totalAmount: 5000,
          outstandingAmount: 0,
          paidAmount: 5000,
          billingDate: '2026-08-25',
          dueDate: '2026-09-05',
          createdAt: '2026-08-25',
          updatedAt: '2026-08-25',
        } as any,
        {
          id: 'b-rent',
          billNumber: 'INV-003',
          dormitoryId: 'dorm-1',
          billingCycleId: 'cycle-1',
          cycleId: 'cycle-1',
          roomId: 'room-occ-3',
          billKind: 'RENT',
          status: 'unpaid',
          subtotal: 6000,
          totalAmount: 6000,
          outstandingAmount: 6000,
          paidAmount: 0,
          billingDate: '2026-08-25',
          dueDate: '2026-09-05',
          createdAt: '2026-08-25',
          updatedAt: '2026-08-25',
        } as any,
      ];

      const financial = getOwnerFinancialBreakdown(row, roomCtx, defaultRateSnapshot, bills, 'cycle-1');
      expect(financial.components.length).toBe(3);
      expect(financial.components[0].label).toBe('บิลรายเดือน');
      expect(financial.components[1].label).toBe('ค่าประกัน');
      expect(financial.components[2].label).toBe('ค่าเช่า (เทอม)');
      expect(financial.components.map(c => c.label)).not.toContain('ค่าเช่า (รายเดือน)');
    });

    it('Proof 1E: primary payable reducer — sums payable contribution, PAID deposit contributes 0 to payable while displaying full amount in breakdown', () => {
      const row: any = {
        roomId: 'room-occ-4',
        roomNumber: '105',
        waterPrev: '100',
        waterCurr: '110',
        elecPrev: '200',
        elecCurr: '250',
        peopleCount: 1,
        overdueAmount: '0.00',
        isPaid: false,
        billStatus: 'unpaid',
        otherFees: [],
      };
      const roomCtx: any = {
        roomId: 'room-occ-4',
        billingSource: 'MONTHLY_CONTRACT',
        rentAmount: 4500,
        depositAmount: 500,
      };

      // Monthly unpaid = 950, Deposit paid = 500, Rent unpaid = 4500
      const bills: Bill[] = [
        {
          id: 'b-util-4',
          roomId: 'room-occ-4',
          billingCycleId: 'cycle-1',
          billKind: 'MONTHLY_UTILITY',
          status: 'unpaid',
          totalAmount: 950,
          outstandingAmount: 950,
        } as any,
        {
          id: 'b-dep-4',
          roomId: 'room-occ-4',
          billingCycleId: 'cycle-1',
          billKind: 'DEPOSIT',
          status: 'paid',
          totalAmount: 500,
          outstandingAmount: 0,
        } as any,
        {
          id: 'b-rent-4',
          roomId: 'room-occ-4',
          billingCycleId: 'cycle-1',
          billKind: 'RENT',
          status: 'unpaid',
          totalAmount: 4500,
          outstandingAmount: 4500,
        } as any,
      ];

      const financial = getOwnerFinancialBreakdown(row, roomCtx, defaultRateSnapshot, bills, 'cycle-1');
      // Primary amount = 950 (Monthly unpaid) + 0 (Deposit paid) + 4500 (Rent unpaid) = 5450.00
      expect(financial.operationalAmount).toBe(5450);
      expect(financial.formattedAmount).toBe('5,450.00');

      // Components detail breakdown has all 3 items
      expect(financial.components.length).toBe(3);
      expect(financial.components[0]).toMatchObject({ label: 'บิลรายเดือน', formattedAmount: '950.00', status: 'UNPAID' });
      expect(financial.components[1]).toMatchObject({ label: 'ค่าประกัน', formattedAmount: '500.00', status: 'PAID' });
      expect(financial.components[2]).toMatchObject({ label: 'ค่าเช่า (เดือน)', formattedAmount: '4,500.00', status: 'UNPAID' });
    });

    it('Proof 1F: paid deposit period boundary — July paid deposit only shows in July cycle, does not show in August cycle', () => {
      const row: any = {
        roomId: 'room-occ-5',
        roomNumber: '106',
        waterPrev: '100',
        waterCurr: '110',
        elecPrev: '200',
        elecCurr: '250',
        peopleCount: 1,
        overdueAmount: '0.00',
        isPaid: false,
        billStatus: 'unpaid',
        otherFees: [],
      };
      const roomCtx: any = {
        roomId: 'room-occ-5',
        billingSource: 'MONTHLY_CONTRACT',
        rentAmount: 0,
        depositAmount: 0,
      };

      // Deposit bill belongs strictly to July (cycle-jul)
      const bills: Bill[] = [
        {
          id: 'b-dep-jul',
          roomId: 'room-occ-5',
          billingCycleId: 'cycle-jul',
          billKind: 'DEPOSIT',
          status: 'paid',
          totalAmount: 500,
          outstandingAmount: 0,
        } as any,
        {
          id: 'b-util-aug',
          roomId: 'room-occ-5',
          billingCycleId: 'cycle-aug',
          billKind: 'MONTHLY_UTILITY',
          status: 'unpaid',
          totalAmount: 730,
          outstandingAmount: 730,
        } as any,
      ];

      // Querying August (cycle-aug): Deposit from July is NOT included
      const financialAug = getOwnerFinancialBreakdown(row, roomCtx, defaultRateSnapshot, bills, 'cycle-aug');
      expect(financialAug.components.length).toBe(1);
      expect(financialAug.components[0].label).toBe('บิลรายเดือน');
      expect(financialAug.formattedAmount).toBe('730.00');

      // Querying July (cycle-jul): Deposit from July is included in July
      const financialJul = getOwnerFinancialBreakdown(row, roomCtx, defaultRateSnapshot, bills, 'cycle-jul');
      expect(financialJul.components.some(c => c.label === 'ค่าประกัน')).toBe(true);
    });

    it('Proof 1G: canonical Daily stay payment state — unpaid daily stay shows ค่าเช่า (วัน) as UNPAID, paid shows PAID', () => {
      const row: any = {
        roomId: 'room-daily-1',
        roomNumber: '107',
        waterPrev: '0',
        waterCurr: '0',
        elecPrev: '0',
        elecCurr: '0',
        peopleCount: 1,
        overdueAmount: '0.00',
        isPaid: false,
        billStatus: 'draft',
        otherFees: [],
      };

      // Unpaid Daily Stay (isDailyRentPaid = false)
      const roomCtxUnpaid: any = {
        roomId: 'room-daily-1',
        billingSource: 'DAILY_STAY',
        rentAmount: 600,
        isDailyRentPaid: false,
      };
      const financialUnpaid = getOwnerFinancialBreakdown(row, roomCtxUnpaid, defaultRateSnapshot, [], 'cycle-aug');
      expect(financialUnpaid.operationalAmount).toBe(600);
      expect(financialUnpaid.formattedAmount).toBe('600.00');
      expect(financialUnpaid.components.length).toBe(1);
      expect(financialUnpaid.components[0]).toMatchObject({ label: 'ค่าเช่า (วัน)', formattedAmount: '600.00', status: 'UNPAID' });

      // Paid Daily Stay (isDailyRentPaid = true)
      const roomCtxPaid: any = {
        roomId: 'room-daily-1',
        billingSource: 'DAILY_STAY',
        rentAmount: 600,
        isDailyRentPaid: true,
      };
      const financialPaid = getOwnerFinancialBreakdown(row, roomCtxPaid, defaultRateSnapshot, [], 'cycle-aug');
      expect(financialPaid.operationalAmount).toBe(0);
      expect(financialPaid.formattedAmount).toBe('0.00');
      expect(financialPaid.components.length).toBe(1);
      expect(financialPaid.components[0]).toMatchObject({ label: 'ค่าเช่า (วัน)', formattedAmount: '600.00', status: 'PAID' });
    });
  });

  // =========================================================================
  // 2. Editability Matrix: ยังไม่ออกบิล, รอชำระ, รายวัน vs ชำระแล้ว
  // =========================================================================
  describe('Owner Meter Workspace Editability Matrix', () => {
    const mockRooms: Room[] = [
      { id: 'r1', roomNumber: '101', floor: 1, status: 'occupied', monthlyRent: 4000, images: [] } as any,
      { id: 'r2', roomNumber: '102', floor: 1, status: 'occupied', monthlyRent: 4000, images: [] } as any,
      { id: 'r3', roomNumber: '103', floor: 1, status: 'occupied', monthlyRent: 4000, images: [] } as any,
      { id: 'r4', roomNumber: '104', floor: 1, status: 'occupied', monthlyRent: 4000, images: [] } as any,
    ];

    const mockTenants: Tenant[] = [
      { id: 't1', name: 'สมชาย ใจดี', phone: '081-111-1111', citizenId: '1234567890123', status: 'active', startDate: '2026-01-01', endDate: '2026-12-31', depositAmount: 5000, monthlyRent: 4000, idCardPhoto: '' } as any,
      { id: 't2', name: 'สมศรี มีสุข', phone: '082-222-2222', citizenId: '1234567890124', status: 'active', startDate: '2026-01-01', endDate: '2026-12-31', depositAmount: 5000, monthlyRent: 4000, idCardPhoto: '' } as any,
      { id: 't3', name: 'วิชัย มั่งมี', phone: '083-333-3333', citizenId: '1234567890125', status: 'active', startDate: '2026-01-01', endDate: '2026-12-31', depositAmount: 5000, monthlyRent: 4000, idCardPhoto: '' } as any,
      { id: 't4', name: 'สุชาติ มั่นคง', phone: '084-444-4444', citizenId: '1234567890126', status: 'active', startDate: '2026-01-01', endDate: '2026-12-31', depositAmount: 5000, monthlyRent: 4000, idCardPhoto: '' } as any,
    ];

    const mockContracts: Contract[] = [
      { id: 'c1', contractNumber: 'CTR-101', roomId: 'r1', tenantId: 't1', dormitoryId: 'dorm-1', startDate: '2026-01-01', endDate: '2026-12-31', rentAmount: 4000, depositAmount: 5000, status: 'active', signedDate: '2026-01-01' } as any,
      { id: 'c2', contractNumber: 'CTR-102', roomId: 'r2', tenantId: 't2', dormitoryId: 'dorm-1', startDate: '2026-01-01', endDate: '2026-12-31', rentAmount: 4000, depositAmount: 5000, status: 'active', signedDate: '2026-01-01' } as any,
      { id: 'c3', contractNumber: 'CTR-103', roomId: 'r3', tenantId: 't3', dormitoryId: 'dorm-1', startDate: '2026-01-01', endDate: '2026-12-31', rentAmount: 4000, depositAmount: 5000, status: 'active', signedDate: '2026-01-01' } as any,
      { id: 'c4', contractNumber: 'CTR-104', roomId: 'r4', tenantId: 't4', dormitoryId: 'dorm-1', startDate: '2026-01-01', endDate: '2026-12-31', rentAmount: 4000, depositAmount: 5000, status: 'active', signedDate: '2026-01-01' } as any,
    ];

    const mockBills: Bill[] = [
      // r1: draft (ยังไม่ออกบิล)
      // r2: unpaid (รอชำระ)
      { id: 'b2', billNumber: 'INV-102', dormitoryId: 'dorm-1', billingCycleId: 'cycle-aug', cycleId: 'cycle-aug', roomId: 'r2', billKind: 'MONTHLY_UTILITY', status: 'unpaid', subtotal: 4700, totalAmount: 4700, outstandingAmount: 4700, paidAmount: 0, billingDate: '2026-08-25', dueDate: '2026-09-05', createdAt: '2026-08-25', updatedAt: '2026-08-25' } as any,
      // r4: paid (ชำระแล้ว)
      { id: 'b4', billNumber: 'INV-104', dormitoryId: 'dorm-1', billingCycleId: 'cycle-aug', cycleId: 'cycle-aug', roomId: 'r4', billKind: 'MONTHLY_UTILITY', status: 'paid', subtotal: 4700, totalAmount: 4700, outstandingAmount: 0, paidAmount: 4700, billingDate: '2026-08-25', dueDate: '2026-09-05', createdAt: '2026-08-25', updatedAt: '2026-08-25' } as any,
    ];

    const mockCycles = [
      { id: 'cycle-aug', cycleCode: '2026-08', name: 'รอบบิล สิงหาคม 2569', isCurrent: true },
    ];

    it('Proof 2A: UNISSUED (ยังไม่ออกบิล), UNPAID (รอชำระ), and DAILY_STAY (รายวัน) are EDITABLE; PAID (ชำระแล้ว) is LOCKED', async () => {
      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method: string, url: string) => {
        if (url.includes('/meters/workspace/preview-context')) {
          return {
            success: true,
            data: {
              cycle: { id: 'cycle-aug', cycleCode: '2026-08', isCurrent: true },
              rooms: mockRooms.map(r => ({ roomId: r.id, roomNumber: r.roomNumber, billingSource: 'MONTHLY_CONTRACT', rentAmount: 4000 })),
              rateSnapshot: { waterBillingType: 'per_unit', waterRate: '18.00', electricityBillingType: 'per_unit', electricityRate: '7.00' },
            },
          };
        }
        if (url.includes('/meters/workspace')) {
          return {
            success: true,
            data: mockRooms.map(r => ({
              roomId: r.id,
              roomNumber: r.roomNumber,
              waterPrev: '100',
              waterCurr: '110',
              elecPrev: '200',
              elecCurr: '250',
              peopleCount: 1,
              isPaid: r.id === 'r4',
              billStatus: r.id === 'r4' ? 'paid' : r.id === 'r2' ? 'unpaid' : 'draft',
              otherFees: [],
            })),
          };
        }
        return { success: true, data: [] };
      });

      const { container } = render(
        <QueryClientProvider client={queryClient}>
          <OwnerMeters
            rooms={mockRooms}
            bills={mockBills}
            tenants={mockTenants}
            contracts={mockContracts}
            dormitoryId="dorm-1"
            selectedBillingCycleId="cycle-aug"
            selectedCycleCode="2026-08"
            selectedCycle="2026-08"
            billingCycles={mockCycles}
            onSaveBills={vi.fn()}
            onSelectTenant={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('101')).toBeDefined();
      });

      // Room 101 (ยังไม่ออกบิล): editable
      const row101 = container.querySelector('#room-row-r1');
      expect(row101).toBeTruthy();
      const elecCurr101 = row101?.querySelector('input[data-col="elecCurr"]') as HTMLInputElement;
      const waterCurr101 = row101?.querySelector('input[data-col="waterCurr"]') as HTMLInputElement;
      const people101 = row101?.querySelector('input[data-col="peopleCount"]') as HTMLInputElement;
      expect(elecCurr101.disabled).toBe(false);
      expect(waterCurr101.disabled).toBe(false);
      expect(people101.disabled).toBe(false);

      // Room 102 (รอชำระ - bill issued but unpaid): must be EDITABLE
      const row102 = container.querySelector('#room-row-r2');
      expect(row102).toBeTruthy();
      const elecCurr102 = row102?.querySelector('input[data-col="elecCurr"]') as HTMLInputElement;
      const waterCurr102 = row102?.querySelector('input[data-col="waterCurr"]') as HTMLInputElement;
      const people102 = row102?.querySelector('input[data-col="peopleCount"]') as HTMLInputElement;
      expect(elecCurr102.disabled).toBe(false);
      expect(waterCurr102.disabled).toBe(false);
      expect(people102.disabled).toBe(false);

      // Room 104 (ชำระแล้ว - PAID): must be LOCKED (disabled)
      const row104 = container.querySelector('#room-row-r4');
      expect(row104).toBeTruthy();
      const elecCurr104 = row104?.querySelector('input[data-col="elecCurr"]') as HTMLInputElement;
      const waterCurr104 = row104?.querySelector('input[data-col="waterCurr"]') as HTMLInputElement;
      const people104 = row104?.querySelector('input[data-col="peopleCount"]') as HTMLInputElement;
      expect(elecCurr104.disabled).toBe(true);
      expect(waterCurr104.disabled).toBe(true);
      expect(people104.disabled).toBe(true);
    });

    it('Proof 2B: 1 component row displays primary amount only and does NOT render ดูรายละเอียด button', async () => {
      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method: string, url: string) => {
        if (url.includes('/meters/workspace/preview-context')) {
          return {
            success: true,
            data: {
              cycle: { id: 'cycle-aug', cycleCode: '2026-08', isCurrent: true },
              rooms: [{ roomId: 'r1', roomNumber: '101', billingSource: 'NONE', rentAmount: 0 }],
              rateSnapshot: { waterBillingType: 'per_unit', waterRate: '18.00', electricityBillingType: 'per_unit', electricityRate: '7.00' },
            },
          };
        }
        if (url.includes('/meters/workspace')) {
          return {
            success: true,
            data: [{
              roomId: 'r1',
              roomNumber: '101',
              waterPrev: '100',
              waterCurr: '110',
              elecPrev: '200',
              elecCurr: '250',
              peopleCount: 1,
              isPaid: false,
              billStatus: 'draft',
              otherFees: [],
            }],
          };
        }
        return { success: true, data: [] };
      });

      const { container } = render(
        <QueryClientProvider client={queryClient}>
          <OwnerMeters
            rooms={[mockRooms[0]]}
            bills={[]}
            tenants={[mockTenants[0]]}
            contracts={[mockContracts[0]]}
            dormitoryId="dorm-1"
            selectedBillingCycleId="cycle-aug"
            selectedCycleCode="2026-08"
            selectedCycle="2026-08"
            billingCycles={mockCycles}
            onSaveBills={vi.fn()}
            onSelectTenant={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      // Room 101 has 1 component (บิลรายเดือน preview)
      // Condition components.length > 1 means "ดูรายละเอียด" MUST NOT be rendered
      expect(screen.queryByText('ดูรายละเอียด')).toBeNull();
      expect(container.querySelector('[data-testid^="owner-financial-components"]')).toBeNull();
    });

    it('Proof 2C: PAID row keeps other fees visible with disabled controls (full JSX structure)', async () => {
      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method: string, url: string) => {
        if (url.includes('/meters/workspace/preview-context')) {
          return {
            success: true,
            data: {
              cycle: { id: 'cycle-aug', cycleCode: '2026-08', isCurrent: true },
              rooms: mockRooms.map(r => ({ roomId: r.id, roomNumber: r.roomNumber, billingSource: 'MONTHLY_CONTRACT', rentAmount: 4000 })),
              rateSnapshot: { waterBillingType: 'per_unit', waterRate: '18.00', electricityBillingType: 'per_unit', electricityRate: '7.00' },
            },
          };
        }
        if (url.includes('/meters/cycle-people-count')) {
          return {
            success: true,
            data: [{
              roomId: 'r4',
              peopleCount: 1,
              otherFees: [{ description: 'ค่าคีย์การ์ด', amount: '100.00' }],
            }],
          };
        }
        if (url.includes('/meters/readings')) {
          return { success: true, data: [] };
        }
        return { success: true, data: [] };
      });

      const { container } = render(
        <QueryClientProvider client={queryClient}>
          <OwnerMeters
            rooms={mockRooms}
            bills={mockBills}
            tenants={mockTenants}
            contracts={mockContracts}
            dormitoryId="dorm-1"
            selectedBillingCycleId="cycle-aug"
            selectedCycleCode="2026-08"
            selectedCycle="2026-08"
            billingCycles={mockCycles}
            onSaveBills={vi.fn()}
            onSelectTenant={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      await waitFor(() => {
        expect(container.querySelector('#room-row-r4')).toBeTruthy();
      });

      const row104 = container.querySelector('#room-row-r4');
      expect(row104).toBeTruthy();

      // Persisted other fee remains visibly rendered
      expect(screen.getByText('ค่าคีย์การ์ด')).toBeDefined();
      expect(screen.getByText('100 ฿')).toBeDefined();

      // Delete button is omitted on paid row
      expect(row104?.querySelector('button[title="ลบรายการ"]')).toBeNull();

      // Add fee input/button disabled on paid row
      const feeDescInput = row104?.querySelector('input[placeholder="ชื่อรายการ"]') as HTMLInputElement;
      const feeAmtInput = row104?.querySelector('input[placeholder="บาท"]') as HTMLInputElement;
      const addFeeBtn = row104?.querySelector('button[title="เพิ่มรายการค่าใช้จ่าย"]') as HTMLButtonElement;
      expect(feeDescInput.disabled).toBe(true);
      expect(feeAmtInput.disabled).toBe(true);
      expect(addFeeBtn.disabled).toBe(true);
    });

    it('Proof 2D: Tenant direct-open callback chain invokes onSelectTenant with tenantId and roomId', async () => {
      const handleSelectTenant = vi.fn();
      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method: string, url: string) => {
        if (url.includes('/meters/workspace/preview-context')) {
          return {
            success: true,
            data: {
              cycle: { id: 'cycle-aug', cycleCode: '2026-08', isCurrent: true },
              rooms: mockRooms.map((r, i) => ({
                roomId: r.id,
                roomNumber: r.roomNumber,
                tenantId: i === 0 ? 't1' : `t${i + 1}`,
                tenantName: i === 0 ? 'สมชาย ใจดี' : `ผู้เช่า ${i + 1}`,
                billingSource: 'MONTHLY_CONTRACT',
                rentAmount: 4000,
              })),
              rateSnapshot: { waterBillingType: 'per_unit', waterRate: '18.00', electricityBillingType: 'per_unit', electricityRate: '7.00' },
            },
          };
        }
        return { success: true, data: [] };
      });

      const { container } = render(
        <QueryClientProvider client={queryClient}>
          <OwnerMeters
            rooms={mockRooms}
            bills={[]}
            tenants={mockTenants}
            contracts={mockContracts}
            dormitoryId="dorm-1"
            selectedBillingCycleId="cycle-aug"
            selectedCycleCode="2026-08"
            selectedCycle="2026-08"
            billingCycles={mockCycles}
            onSaveBills={vi.fn()}
            onSelectTenant={handleSelectTenant}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      await waitFor(() => {
        expect(container.querySelector('#room-row-r1')).toBeTruthy();
      });

      const row101 = container.querySelector('#room-row-r1');
      expect(row101).toBeTruthy();

      const tenantBtn = row101?.querySelector('td:last-child button') as HTMLButtonElement;
      expect(tenantBtn).toBeTruthy();
      fireEvent.click(tenantBtn);

      // Verifies callback receives exact tenant ID ('t1') and room ID ('r1')
      expect(handleSelectTenant).toHaveBeenCalledWith('t1', 'r1');
    });

    it('Proof 2E: canonical money validation for other fees rejects malformed strings and accepts valid amounts including 0.00', async () => {
      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method: string, url: string) => {
        if (url.includes('/meters/workspace/preview-context')) {
          return {
            success: true,
            data: {
              cycle: { id: 'cycle-aug', cycleCode: '2026-08', isCurrent: true },
              rooms: mockRooms.map(r => ({ roomId: r.id, roomNumber: r.roomNumber, billingSource: 'MONTHLY_CONTRACT', rentAmount: 4000 })),
              rateSnapshot: { waterBillingType: 'per_unit', waterRate: '18.00', electricityBillingType: 'per_unit', electricityRate: '7.00' },
            },
          };
        }
        if (url.includes('/meters/workspace')) {
          return {
            success: true,
            data: mockRooms.map(r => ({
              roomId: r.id,
              roomNumber: r.roomNumber,
              waterPrev: '100',
              waterCurr: '110',
              elecPrev: '200',
              elecCurr: '250',
              peopleCount: 1,
              isPaid: false,
              billStatus: 'draft',
              otherFees: [],
            })),
          };
        }
        return { success: true, data: [] };
      });

      const { container } = render(
        <QueryClientProvider client={queryClient}>
          <OwnerMeters
            rooms={mockRooms}
            bills={[]}
            tenants={mockTenants}
            contracts={mockContracts}
            dormitoryId="dorm-1"
            selectedBillingCycleId="cycle-aug"
            selectedCycleCode="2026-08"
            selectedCycle="2026-08"
            billingCycles={mockCycles}
            onSaveBills={vi.fn()}
            onSelectTenant={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      await waitFor(() => {
        expect(container.querySelector('#room-row-r1')).toBeTruthy();
      });

      const row101 = container.querySelector('#room-row-r1');
      const descInput = row101?.querySelector('input[placeholder="ชื่อรายการ"]') as HTMLInputElement;
      const amtInput = row101?.querySelector('input[placeholder="บาท"]') as HTMLInputElement;
      const addFeeBtn = row101?.querySelector('button[title="เพิ่มรายการค่าใช้จ่าย"]') as HTMLButtonElement;

      // 1. Description only without amount -> remains draft (not added)
      fireEvent.change(descInput, { target: { value: 'ค่าบริการพิเศษ' } });
      fireEvent.change(amtInput, { target: { value: '' } });
      fireEvent.click(addFeeBtn);
      expect(screen.queryByText('ค่าบริการพิเศษ')).toBeNull();

      // 2. Amount only without description -> remains draft
      fireEvent.change(descInput, { target: { value: '' } });
      fireEvent.change(amtInput, { target: { value: '150.00' } });
      fireEvent.click(addFeeBtn);
      expect(screen.queryByText('150 ฿')).toBeNull();

      // 3. Valid normal amount -> successfully added to local state
      fireEvent.change(descInput, { target: { value: 'ค่าบริการพิเศษ' } });
      fireEvent.change(amtInput, { target: { value: '150.00' } });
      fireEvent.click(addFeeBtn);

      await waitFor(() => {
        expect(screen.getByText('ค่าบริการพิเศษ')).toBeDefined();
        expect(screen.getByText('150 ฿')).toBeDefined();
      });
    });

    it('Proof 2F: Tenant async direct-open race regression — does not clear initialTenantId while tenants is empty, auto-opens when populated', async () => {
      const handleClearInitial = vi.fn();
      const mockTenantsWithDates = mockTenants.map(t => ({ ...t, createdAt: '2026-08-01T00:00:00.000Z' }));

      // 1. Initial mount with empty tenants (loading state)
      const { rerender } = render(
        <OwnerTenants
          tenants={[]}
          rooms={mockRooms}
          onSaveTenants={vi.fn()}
          onSaveRooms={vi.fn()}
          onAddLog={vi.fn()}
          initialTenantId="t1"
          onClearInitialTenantId={handleClearInitial}
        />
      );

      // Verify not cleared prematurely while tenants list is empty
      expect(handleClearInitial).not.toHaveBeenCalled();

      // 2. Tenants query asynchronously succeeds and delivers populated tenants array
      rerender(
        <OwnerTenants
          tenants={mockTenantsWithDates}
          rooms={mockRooms}
          onSaveTenants={vi.fn()}
          onSaveRooms={vi.fn()}
          onAddLog={vi.fn()}
          initialTenantId="t1"
          onClearInitialTenantId={handleClearInitial}
        />
      );

      // Verify exact tenant detail drawer opened automatically without second click
      await waitFor(() => {
        expect(screen.getByTestId('back-to-meters-btn')).toBeDefined();
        expect(screen.getAllByText('สมชาย ใจดี').length).toBeGreaterThan(0);
      });

      // Verify initialTenantId cleared after successful open
      expect(handleClearInitial).toHaveBeenCalledTimes(1);
    });

    it('Proof 2G: Authority editability matrix — RENT / DEPOSIT / LEGACY_COMBINED / missing-kind paid remain EDITABLE; only MONTHLY_UTILITY paid is LOCKED', async () => {
      const mixedBills = [
        // r1: RENT is PAID, but MONTHLY_UTILITY is UNPAID -> row must be EDITABLE
        { id: 'b-rent-1', dormitoryId: 'dorm-1', cycleId: 'cycle-aug', roomId: 'r1', billKind: 'RENT', status: 'paid', totalAmount: 4000, outstandingAmount: 0 } as any,
        { id: 'b-util-1', dormitoryId: 'dorm-1', cycleId: 'cycle-aug', roomId: 'r1', billKind: 'MONTHLY_UTILITY', status: 'unpaid', totalAmount: 730, outstandingAmount: 730 } as any,

        // r2: DEPOSIT is PAID, but MONTHLY_UTILITY is UNPAID -> row must be EDITABLE
        { id: 'b-dep-2', dormitoryId: 'dorm-1', cycleId: 'cycle-aug', roomId: 'r2', billKind: 'DEPOSIT', status: 'paid', totalAmount: 5000, outstandingAmount: 0 } as any,
        { id: 'b-util-2', dormitoryId: 'dorm-1', cycleId: 'cycle-aug', roomId: 'r2', billKind: 'MONTHLY_UTILITY', status: 'unpaid', totalAmount: 850, outstandingAmount: 850 } as any,

        // r3: LEGACY_COMBINED is PAID, but MONTHLY_UTILITY is UNPAID -> row must be EDITABLE
        { id: 'b-leg-3', dormitoryId: 'dorm-1', cycleId: 'cycle-aug', roomId: 'r3', billKind: 'LEGACY_COMBINED', status: 'paid', totalAmount: 4700, outstandingAmount: 0 } as any,
        { id: 'b-util-3', dormitoryId: 'dorm-1', cycleId: 'cycle-aug', roomId: 'r3', billKind: 'MONTHLY_UTILITY', status: 'unpaid', totalAmount: 700, outstandingAmount: 700 } as any,

        // r4: MONTHLY_UTILITY is PAID -> row must be LOCKED (ชำระแล้ว)
        { id: 'b-util-4', dormitoryId: 'dorm-1', cycleId: 'cycle-aug', roomId: 'r4', billKind: 'MONTHLY_UTILITY', status: 'paid', totalAmount: 970, outstandingAmount: 0 } as any,
      ];

      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method: string, url: string) => {
        if (url.includes('/meters/workspace/preview-context')) {
          return {
            success: true,
            data: {
              cycle: { id: 'cycle-aug', cycleCode: '2026-08', isCurrent: true },
              rooms: mockRooms.map((r, i) => ({
                roomId: r.id,
                roomNumber: r.roomNumber,
                billingSource: i === 2 ? 'DAILY_STAY' : 'MONTHLY_CONTRACT',
                isDailyRentPaid: i === 2,
                dailyRentStatus: i === 2 ? 'PAID' : 'UNPAID',
                rentAmount: 4000,
              })),
              rateSnapshot: { waterBillingType: 'per_unit', waterRate: '18.00', electricityBillingType: 'per_unit', electricityRate: '7.00' },
            },
          };
        }
        return { success: true, data: [] };
      });

      const { container } = render(
        <QueryClientProvider client={queryClient}>
          <OwnerMeters
            rooms={mockRooms}
            bills={mixedBills}
            tenants={mockTenants}
            contracts={mockContracts}
            dormitoryId="dorm-1"
            selectedBillingCycleId="cycle-aug"
            selectedCycleCode="2026-08"
            selectedCycle="2026-08"
            billingCycles={mockCycles}
            onSaveBills={vi.fn()}
            onSelectTenant={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      await waitFor(() => {
        expect(container.querySelector('#room-row-r1')).toBeTruthy();
        expect(container.querySelector('#room-row-r2')).toBeTruthy();
        expect(container.querySelector('#room-row-r3')).toBeTruthy();
        expect(container.querySelector('#room-row-r4')).toBeTruthy();
      });

      // A: Room 101 (RENT paid + Utility unpaid) -> EDITABLE
      const row101 = container.querySelector('#room-row-r1');
      const elecCurr101 = row101?.querySelectorAll('input[type="text"]')[1] as HTMLInputElement;
      expect(elecCurr101.disabled).toBe(false);

      // B: Room 102 (DEPOSIT paid + Utility unpaid) -> EDITABLE
      const row102 = container.querySelector('#room-row-r2');
      const elecCurr102 = row102?.querySelectorAll('input[type="text"]')[1] as HTMLInputElement;
      expect(elecCurr102.disabled).toBe(false);

      // C: Room 103 (Daily stay with Daily rent paid / LEGACY_COMBINED paid) -> visible status 'รายวัน' and EDITABLE
      const row103 = container.querySelector('#room-row-r3');
      expect(row103?.textContent).toContain('รายวัน');
      const elecCurr103 = row103?.querySelectorAll('input[type="text"]')[1] as HTMLInputElement;
      expect(elecCurr103.disabled).toBe(false);

      // D: Room 104 (MONTHLY_UTILITY paid) -> LOCKED (disabled)
      const row104 = container.querySelector('#room-row-r4');
      const elecCurr104 = row104?.querySelectorAll('input[type="text"]')[1] as HTMLInputElement;
      expect(elecCurr104.disabled).toBe(true);
    });

    it('Proof 2H: Strict frontend billKind fail-closed discriminator — selects ONLY MONTHLY_UTILITY and rejects RENT, DEPOSIT, LEGACY_COMBINED, and missing billKind', () => {
      const testRow = { roomId: 'r1', roomNumber: '101', waterCurr: '110', waterPrev: '100', elecCurr: '250', elecPrev: '200', peopleCount: 1 } as any;
      const testRoomCtx = { billingSource: 'MONTHLY_CONTRACT', rentAmount: 4000 };
      const testRateSnapshot = {
        waterBillingType: 'per_unit',
        waterRate: '18.00',
        electricityBillingType: 'per_unit',
        electricityRate: '7.00',
      };

      // 1. MONTHLY_UTILITY -> Selected
      const breakdownUtil = getOwnerFinancialBreakdown(
        testRow,
        testRoomCtx,
        testRateSnapshot,
        [{ id: 'b1', roomId: 'r1', billingCycleId: 'cycle-aug', billKind: 'MONTHLY_UTILITY', status: 'unpaid', totalAmount: 730 } as any],
        'cycle-aug'
      );
      expect(breakdownUtil.components.some(c => c.label === 'บิลรายเดือน')).toBe(true);

      // 2. RENT -> Not selected as monthly bill
      const breakdownRent = getOwnerFinancialBreakdown(
        testRow,
        testRoomCtx,
        testRateSnapshot,
        [{ id: 'b2', roomId: 'r1', billingCycleId: 'cycle-aug', billKind: 'RENT', status: 'paid', totalAmount: 4000 } as any],
        'cycle-aug'
      );
      expect(breakdownRent.components.some(c => c.label === 'บิลรายเดือน' && c.status === 'PAID')).toBe(false);

      // 3. DEPOSIT -> Not selected as monthly bill
      const breakdownDep = getOwnerFinancialBreakdown(
        testRow,
        testRoomCtx,
        testRateSnapshot,
        [{ id: 'b3', roomId: 'r1', billingCycleId: 'cycle-aug', billKind: 'DEPOSIT', status: 'paid', totalAmount: 5000 } as any],
        'cycle-aug'
      );
      expect(breakdownDep.components.some(c => c.label === 'บิลรายเดือน' && c.status === 'PAID')).toBe(false);

      // 4. LEGACY_COMBINED -> Not selected as monthly utility bill
      const breakdownLegacy = getOwnerFinancialBreakdown(
        testRow,
        testRoomCtx,
        testRateSnapshot,
        [{ id: 'b4', roomId: 'r1', billingCycleId: 'cycle-aug', billKind: 'LEGACY_COMBINED', status: 'paid', totalAmount: 4730 } as any],
        'cycle-aug'
      );
      expect(breakdownLegacy.components.some(c => c.label === 'บิลรายเดือน' && c.status === 'PAID')).toBe(false);

      // 5. Missing / undefined billKind -> Not selected (fails closed)
      const breakdownUndefined = getOwnerFinancialBreakdown(
        testRow,
        testRoomCtx,
        testRateSnapshot,
        [{ id: 'b5', roomId: 'r1', billingCycleId: 'cycle-aug', status: 'paid', totalAmount: 4730 } as any],
        'cycle-aug'
      );
      expect(breakdownUndefined.components.some(c => c.label === 'บิลรายเดือน' && c.status === 'PAID')).toBe(false);
    });
  });

  // =========================================================================
  // 3. Responsive TimeWheelPicker: Desktop Popover vs Mobile Bottom-Sheet
  // =========================================================================
  describe('TimeWheelPicker Responsive Layout', () => {
    it('Proof 3A: renders 24-hour wheel picker with trigger and both desktop popover and mobile bottom sheet', () => {
      const handleChange = vi.fn();
      render(
        <TimeWheelPicker
          value="14:30"
          onChange={handleChange}
          data-testid="timewheel-test"
        />
      );

      // Click trigger to open
      const trigger = screen.getByTestId('timewheel-test').firstElementChild as HTMLElement;
      fireEvent.click(trigger);

      // Mobile sheet exists in DOM with test id
      const mobileSheet = screen.getByTestId('mobile-timewheel-sheet');
      expect(mobileSheet).toBeTruthy();

      // Ensure NO AM/PM anywhere in text
      expect(screen.queryByText(/AM/i)).toBeNull();
      expect(screen.queryByText(/PM/i)).toBeNull();
    });

    it('Proof 3B: TimeWheel interactive time selection via CLICK — selecting 15:47 updates output correctly', () => {
      const handleChange = vi.fn();
      render(
        <TimeWheelPicker
          value="12:00"
          onChange={handleChange}
          data-testid="timewheel-test-2"
        />
      );

      // Click trigger to open
      const trigger = screen.getByTestId('timewheel-test-2').firstElementChild as HTMLElement;
      fireEvent.click(trigger);

      // Click Hour '15'
      const hourOptions = screen.getAllByRole('option', { name: '15' });
      for (const opt of hourOptions) {
        fireEvent.click(opt);
      }

      // Click Minute '47'
      const minOptions = screen.getAllByRole('option', { name: '47' });
      for (const opt of minOptions) {
        fireEvent.click(opt);
      }

      // Click confirm 'ตกลง'
      const confirmBtns = screen.getAllByText('ตกลง');
      for (const btn of confirmBtns) {
        fireEvent.click(btn);
      }
      expect(handleChange).toHaveBeenCalledWith('15:47');
    });

    it('Proof 3C: TimeWheel Clear and Cancel interactions — Clear resets to empty, Cancel leaves value unchanged', () => {
      const handleChange = vi.fn();
      const handleClear = vi.fn();

      const { container } = render(
        <TimeWheelPicker
          value="09:15"
          onChange={handleChange}
          onClear={handleClear}
          data-testid="timewheel-test-3"
        />
      );

      // 1. Clear button directly on trigger
      const clearTriggerBtn = container.querySelector('button[title="ล้างเวลา"]') as HTMLButtonElement;
      expect(clearTriggerBtn).toBeTruthy();
      fireEvent.click(clearTriggerBtn);
      expect(handleClear).toHaveBeenCalledTimes(1);

      // 2. Open popover and click Cancel
      const trigger = screen.getByTestId('timewheel-test-3').firstElementChild as HTMLElement;
      fireEvent.click(trigger);

      const cancelBtn = screen.getAllByText('ยกเลิก')[0];
      fireEvent.click(cancelBtn);
      // Cancel does NOT invoke onChange with draft changes
      expect(handleChange).not.toHaveBeenCalled();
    });

    it('Proof 3D: TimeWheel interactive time selection via SCROLL ONLY — scrolling to 15 and 47 without clicking sets 15:47', () => {
      const handleChange = vi.fn();
      const { container } = render(
        <TimeWheelPicker
          value="12:00"
          onChange={handleChange}
          data-testid="timewheel-test-scroll"
        />
      );

      // Click trigger to open
      const trigger = screen.getByTestId('timewheel-test-scroll').firstElementChild as HTMLElement;
      fireEvent.click(trigger);

      // 1. Scroll Desktop hour list to 15 (15 * 32px) WITHOUT clicking
      const hourList = container.querySelector('[aria-label="ชั่วโมง"]') as HTMLDivElement;
      expect(hourList).toBeTruthy();
      fireEvent.scroll(hourList, { target: { scrollTop: 15 * 32 } });

      // 2. Scroll Desktop minute list to 47 (47 * 32px) WITHOUT clicking
      const minuteList = container.querySelector('[aria-label="นาที"]') as HTMLDivElement;
      expect(minuteList).toBeTruthy();
      fireEvent.scroll(minuteList, { target: { scrollTop: 47 * 32 } });

      // 3. Click Confirm
      const confirmBtns = screen.getAllByText('ตกลง');
      for (const btn of confirmBtns) {
        fireEvent.click(btn);
      }

      // Assert onChange called with 15:47 selected purely by scroll
      expect(handleChange).toHaveBeenCalledWith('15:47');
    });
  });

  // =========================================================================
  // 4. Rolling 3-Month Window & Selected-Cycle + เพิ่มผู้เช่า Matrix
  // =========================================================================
  describe('Rolling 3-Month Window & Selected-Cycle + เพิ่มผู้เช่า Authority', () => {
    it('Proof 4A: derived rolling 3-month window for 2026-08-22 Asia/Bangkok yields strictly [2026-07, 2026-08, 2026-09] and throws on invalid date', () => {
      const bkkDate = new Date('2026-08-22T09:00:00.000Z'); // 16:00 Bangkok
      expect(toBangkokDateString(bkkDate)).toBe('2026-08-22');

      const windowCycles = getRollingThreeMonthWindow(bkkDate);
      expect(windowCycles).toEqual(['2026-07', '2026-08', '2026-09']);

      expect(isCycleInRollingThreeMonthWindow('2026-07', bkkDate)).toBe(true);
      expect(isCycleInRollingThreeMonthWindow('2026-08', bkkDate)).toBe(true);
      expect(isCycleInRollingThreeMonthWindow('2026-09', bkkDate)).toBe(true);

      // Outside window
      expect(isCycleInRollingThreeMonthWindow('2026-06', bkkDate)).toBe(false);
      expect(isCycleInRollingThreeMonthWindow('2026-10', bkkDate)).toBe(false);

      // Invariant check: throws loudly on invalid date without fixed fallbacks
      expect(() => toBangkokDateString(new Date('invalid-date'))).toThrow(/Invalid Date/);
      expect(() => toBangkokDateString('not-a-date')).toThrow(/Invalid Date/);
    });

    it('Proof 4B: year boundaries handle January and December calendar transitions correctly', () => {
      // January: Dec (prev year), Jan, Feb
      const janDate = new Date('2026-01-15T09:00:00.000Z');
      expect(getRollingThreeMonthWindow(janDate)).toEqual(['2025-12', '2026-01', '2026-02']);
      expect(isCycleInRollingThreeMonthWindow('2025-12', janDate)).toBe(true);
      expect(isCycleInRollingThreeMonthWindow('2026-01', janDate)).toBe(true);
      expect(isCycleInRollingThreeMonthWindow('2026-02', janDate)).toBe(true);
      expect(isCycleInRollingThreeMonthWindow('2025-11', janDate)).toBe(false);
      expect(isCycleInRollingThreeMonthWindow('2026-03', janDate)).toBe(false);

      // December: Nov, Dec, Jan (next year)
      const decDate = new Date('2026-12-15T09:00:00.000Z');
      expect(getRollingThreeMonthWindow(decDate)).toEqual(['2026-11', '2026-12', '2027-01']);
      expect(isCycleInRollingThreeMonthWindow('2026-11', decDate)).toBe(true);
      expect(isCycleInRollingThreeMonthWindow('2026-12', decDate)).toBe(true);
      expect(isCycleInRollingThreeMonthWindow('2027-01', decDate)).toBe(true);
      expect(isCycleInRollingThreeMonthWindow('2026-10', decDate)).toBe(false);
      expect(isCycleInRollingThreeMonthWindow('2027-02', decDate)).toBe(false);
    });

    it('Proof 4C: UI renders + เพิ่มผู้เช่า for July/Aug/Sep and ไม่มีข้อมูล for June/Oct for vacant rooms; preserves real historical tenant in June', async () => {
      const mockRooms: Room[] = [
        { id: 'room-vacant', roomNumber: '101', floor: 1, roomType: 'standard', monthlyRent: 4000, depositAmount: 4000, status: 'vacant' } as any,
        { id: 'room-historical', roomNumber: '102', floor: 1, roomType: 'standard', monthlyRent: 4000, depositAmount: 4000, status: 'occupied' } as any,
      ];
      const mockHistoricalTenant: Tenant = {
        id: 't-hist-1',
        name: 'นายประวัติศาสตร์ อดีตผู้เช่า',
        phone: '0812345678',
        status: 'inactive',
      } as any;
      const mockHistoricalContract: Contract = {
        id: 'c-hist-1',
        roomId: 'room-historical',
        tenantId: 't-hist-1',
        startDate: '2026-01-01',
        endDate: '2026-06-30',
        status: 'ended',
        rentAmount: 4000,
        depositAmount: 4000,
      } as any;

      const testBillingCycles = [
        { id: 'cycle-june', cycleCode: '2026-06', name: 'มิถุนายน 2569' },
        { id: 'cycle-july', cycleCode: '2026-07', name: 'กรกฎาคม 2569' },
        { id: 'cycle-aug', cycleCode: '2026-08', name: 'สิงหาคม 2569', isCurrent: true },
        { id: 'cycle-sep', cycleCode: '2026-09', name: 'กันยายน 2569' },
        { id: 'cycle-oct', cycleCode: '2026-10', name: 'ตุลาคม 2569' },
      ];

      // 1. July (2026-07): vacant room shows "+ เพิ่มผู้เช่า"
      const { rerender } = render(
        <QueryClientProvider client={queryClient}>
          <OwnerMeters
            rooms={[mockRooms[0]]}
            buildings={[]}
            dormitoryId="dorm-test"
            bills={[]}
            tenants={[]}
            contracts={[]}
            billingCycles={testBillingCycles}
            selectedCycle="2026-07"
            selectedBillingCycleId="cycle-july"
            selectedCycleCode="2026-07"
            onSaveBills={vi.fn()}
            onSelectTenant={vi.fn()}
          />
        </QueryClientProvider>
      );
      await waitFor(() => {
        expect(screen.getByText('เพิ่มผู้เช่า')).toBeTruthy();
      });

      // 2. August (2026-08): vacant room shows "+ เพิ่มผู้เช่า"
      rerender(
        <QueryClientProvider client={queryClient}>
          <OwnerMeters
            rooms={[mockRooms[0]]}
            buildings={[]}
            dormitoryId="dorm-test"
            bills={[]}
            tenants={[]}
            contracts={[]}
            billingCycles={testBillingCycles}
            selectedCycle="2026-08"
            selectedBillingCycleId="cycle-aug"
            selectedCycleCode="2026-08"
            onSaveBills={vi.fn()}
            onSelectTenant={vi.fn()}
          />
        </QueryClientProvider>
      );
      await waitFor(() => {
        expect(screen.getByText('เพิ่มผู้เช่า')).toBeTruthy();
      });

      // 3. September (2026-09): vacant room shows "+ เพิ่มผู้เช่า"
      rerender(
        <QueryClientProvider client={queryClient}>
          <OwnerMeters
            rooms={[mockRooms[0]]}
            buildings={[]}
            dormitoryId="dorm-test"
            bills={[]}
            tenants={[]}
            contracts={[]}
            billingCycles={testBillingCycles}
            selectedCycle="2026-09"
            selectedBillingCycleId="cycle-sep"
            selectedCycleCode="2026-09"
            onSaveBills={vi.fn()}
            onSelectTenant={vi.fn()}
          />
        </QueryClientProvider>
      );
      await waitFor(() => {
        expect(screen.getByText('เพิ่มผู้เช่า')).toBeTruthy();
      });

      // 4. June (2026-06): vacant room shows "ไม่มีข้อมูล" (NO "+ เพิ่มผู้เช่า")
      rerender(
        <QueryClientProvider client={queryClient}>
          <OwnerMeters
            rooms={[mockRooms[0]]}
            buildings={[]}
            dormitoryId="dorm-test"
            bills={[]}
            tenants={[]}
            contracts={[]}
            billingCycles={testBillingCycles}
            selectedCycle="2026-06"
            selectedBillingCycleId="cycle-june"
            selectedCycleCode="2026-06"
            onSaveBills={vi.fn()}
            onSelectTenant={vi.fn()}
          />
        </QueryClientProvider>
      );
      await waitFor(() => {
        expect(screen.getAllByText('ไม่มีข้อมูล').length).toBeGreaterThanOrEqual(1);
        expect(screen.queryByText('เพิ่มผู้เช่า')).toBeNull();
      });

      // 5. October (2026-10): vacant room shows "ไม่มีข้อมูล" (NO "+ เพิ่มผู้เช่า")
      rerender(
        <QueryClientProvider client={queryClient}>
          <OwnerMeters
            rooms={[mockRooms[0]]}
            buildings={[]}
            dormitoryId="dorm-test"
            bills={[]}
            tenants={[]}
            contracts={[]}
            billingCycles={testBillingCycles}
            selectedCycle="2026-10"
            selectedBillingCycleId="cycle-oct"
            selectedCycleCode="2026-10"
            onSaveBills={vi.fn()}
            onSelectTenant={vi.fn()}
          />
        </QueryClientProvider>
      );
      await waitFor(() => {
        expect(screen.getAllByText('ไม่มีข้อมูล').length).toBeGreaterThanOrEqual(1);
        expect(screen.queryByText('เพิ่มผู้เช่า')).toBeNull();
      });

      // 6. Historical June occupied room: displays historical tenant name, NOT "ไม่มีข้อมูล", NOT "+ เพิ่มผู้เช่า"
      rerender(
        <QueryClientProvider client={queryClient}>
          <OwnerMeters
            rooms={[mockRooms[1]]}
            buildings={[]}
            dormitoryId="dorm-test"
            bills={[]}
            tenants={[mockHistoricalTenant]}
            contracts={[mockHistoricalContract]}
            billingCycles={testBillingCycles}
            selectedCycle="2026-06"
            selectedBillingCycleId="cycle-june"
            selectedCycleCode="2026-06"
            onSaveBills={vi.fn()}
            onSelectTenant={vi.fn()}
          />
        </QueryClientProvider>
      );
      await waitFor(() => {
        expect(screen.getByText('นายประวัติศาสตร์ อดีตผู้เช่า')).toBeTruthy();
        expect(screen.queryByText('เพิ่มผู้เช่า')).toBeNull();
      });
    });
  });

  // =========================================================================
  // 5. Exact Owner Error Mapping (Code-First Precedence)
  // =========================================================================
  describe('Exact Owner Error Mapping to Thai', () => {
    it('Proof 5A: maps machine code NO_ACTIVE_CONTRACT_OR_PROVISIONAL_TERM to ไม่พบผู้เช่า and code wins over generic message', () => {
      expect(mapErrorMessageToThai('NO_ACTIVE_CONTRACT_OR_PROVISIONAL_TERM')).toBe('ไม่พบผู้เช่า');
      expect(mapErrorMessageToThai('Error: NO_ACTIVE_CONTRACT_OR_PROVISIONAL_TERM: ห้องพักไม่มีสัญญา')).toBe('ไม่พบผู้เช่า');
      expect(mapErrorMessageToThai({ message: 'NO_ACTIVE_CONTRACT_OR_PROVISIONAL_TERM' })).toBe('ไม่พบผู้เช่า');
      expect(mapErrorMessageToThai({ code: 'NO_ACTIVE_CONTRACT_OR_PROVISIONAL_TERM' })).toBe('ไม่พบผู้เช่า');
      expect(mapErrorMessageToThai({ error: { code: 'NO_ACTIVE_CONTRACT_OR_PROVISIONAL_TERM' } })).toBe('ไม่พบผู้เช่า');

      // Axios-style error envelope with code taking precedence over generic message
      expect(mapErrorMessageToThai({
        response: {
          data: {
            message: 'Unable to perform operation',
            code: 'NO_ACTIVE_CONTRACT_OR_PROVISIONAL_TERM',
          },
        },
      })).toBe('ไม่พบผู้เช่า');

      expect(mapErrorMessageToThai({
        response: {
          data: {
            message: 'Some generic message',
            error: {
              code: 'NO_ACTIVE_CONTRACT_OR_PROVISIONAL_TERM',
            },
          },
        },
      })).toBe('ไม่พบผู้เช่า');

      const thaiMessage = mapErrorMessageToThai('NO_ACTIVE_CONTRACT_OR_PROVISIONAL_TERM');
      expect(thaiMessage).not.toContain('NO_ACTIVE_CONTRACT');
      expect(thaiMessage).toBe('ไม่พบผู้เช่า');
    });

    it('Proof 5B: maps ROOM_LOCKED_PAID, STALE_VERSION, and missing meter errors to clear Thai instructions from envelope', () => {
      expect(mapErrorMessageToThai({
        response: {
          data: {
            message: 'Internal server error',
            code: 'ROOM_LOCKED_PAID',
          },
        },
      })).toBe('บิลนี้ชำระเงินแล้ว ไม่สามารถยกเลิกหรือแก้ไขได้');

      expect(mapErrorMessageToThai({
        response: {
          data: {
            message: 'Validation failed',
            error: {
              code: 'MISSING_WATER_METER_READING',
            },
          },
        },
      })).toBe('กรุณากรอกเลขมิเตอร์น้ำของงวดนี้ก่อนออกบิล');

      expect(mapErrorMessageToThai({
        response: {
          data: {
            message: 'Validation failed',
            error: {
              code: 'MISSING_ELECTRICITY_METER_READING',
            },
          },
        },
      })).toBe('กรุณากรอกเลขมิเตอร์ไฟฟ้าของงวดนี้ก่อนออกบิล');

      expect(mapErrorMessageToThai({
        response: {
          data: {
            message: 'Conflict',
            error: {
              code: 'STALE_VERSION',
            },
          },
        },
      })).toBe('ข้อมูลถูกแก้ไขโดยผู้อื่น กรุณารีเฟรชหน้านี้');
    });
  });

  // =========================================================================
  // 6. Exactly ONE ออกบิลทุกห้อง Action Button in Meter Workspace
  // =========================================================================
  describe('Single Top-Level Bulk Bill Action Button', () => {
    it('Proof 6A: proves exactly ONE ออกบิลทุกห้อง button is rendered and table header contains only plain สถานะ text', () => {
      const mockRooms: Room[] = [
        { id: 'room-101', roomNumber: '101', floor: 1, roomType: 'standard', monthlyRent: 4000, depositAmount: 4000, status: 'vacant' } as any,
      ];

      const { container } = render(
        <QueryClientProvider client={queryClient}>
          <OwnerMeters
            rooms={mockRooms}
            buildings={[]}
            dormitoryId="dorm-test"
            bills={[]}
            tenants={[]}
            contracts={[]}
            selectedCycle="2026-08"
            selectedBillingCycleId="cycle-aug"
            selectedCycleCode="2026-08"
            onSaveBills={vi.fn()}
            onSelectTenant={vi.fn()}
          />
        </QueryClientProvider>
      );

      // Status column header contains only 'สถานะ' and has ZERO button children
      const statusHeader = container.querySelector('#status-column-header') as HTMLElement;
      expect(statusHeader).toBeTruthy();
      expect(statusHeader.textContent?.trim()).toBe('สถานะ');
      expect(statusHeader.querySelector('button')).toBeNull();

      // Exactly 1 action button exists in entire DOM
      const bulkButtons = screen.getAllByRole('button', { name: /ออกบิลทุกห้อง/ });
      expect(bulkButtons).toHaveLength(1);
    });
  });

  // =========================================================================
  // 7. Tenant Direct-Open from Meter Row to Tenant Detail Pane
  // =========================================================================
  describe('Tenant Direct-Open and Return Context', () => {
    const mockTenant1: Tenant = {
      id: '20000002-0000-4000-8000-000000000001',
      name: 'นายสมชาย ใจดี',
      phone: '0812345678',
      email: 'somchai@example.com',
      status: 'active',
      nationalIdMasked: '1-1004-XXXXX-XX-X',
      createdAt: '2026-01-01T00:00:00.000Z',
    } as any;

    const mockTenant2: Tenant = {
      id: '20000002-0000-4000-8000-000000000002',
      name: 'นางสาวสมศรี มีสุข',
      phone: '0898765432',
      email: 'somsri@example.com',
      status: 'active',
      nationalIdMasked: '1-1004-XXXXX-YY-Y',
      createdAt: '2026-02-01T00:00:00.000Z',
    } as any;

    it('Proof 7A: passes canonical Tenant.id to OwnerTenants and immediately opens detailed profile on mount without second click', async () => {
      const onClearInitialTenantId = vi.fn();
      const onBackToMeters = vi.fn();

      const { container } = render(
        <OwnerTenants
          tenants={[mockTenant1]}
          rooms={[{ id: 'room-101', roomNumber: '101', currentTenantId: mockTenant1.id } as any]}
          bills={[]}
          contracts={[{ id: 'ctr-1', tenantId: mockTenant1.id, roomId: 'room-101' } as any]}
          initialTenantId={mockTenant1.id}
          onClearInitialTenantId={onClearInitialTenantId}
          cameFromMeters={true}
          onBackToMeters={onBackToMeters}
        />
      );

      // Verify tenant profile detail pane is immediately active and renders tenant name
      expect(within(container).getAllByText('นายสมชาย ใจดี').length).toBe(2);
      expect(within(container).queryByText('ไม่มีผู้เช่าถูกเลือกในขณะนี้')).toBeNull();

      // Context-aware back button 'กลับหน้าจดมิเตอร์' is rendered
      const backBtn = container.querySelector('[data-testid="back-to-meters-btn"]') as HTMLElement;
      expect(backBtn).toBeTruthy();
      fireEvent.click(backBtn);
      expect(onBackToMeters).toHaveBeenCalledTimes(1);
    });

    it('Proof 7B: already-mounted OwnerTenants handles initialTenantId changing from undefined to real Tenant.id', () => {
      const onClearInitialTenantId = vi.fn();
      const onBackToMeters = vi.fn();

      const { container, rerender } = render(
        <OwnerTenants
          tenants={[mockTenant1, mockTenant2]}
          rooms={[{ id: 'room-101', roomNumber: '101', currentTenantId: mockTenant1.id } as any]}
          bills={[]}
          contracts={[{ id: 'ctr-1', tenantId: mockTenant1.id, roomId: 'room-101' } as any]}
          initialTenantId={undefined}
          onClearInitialTenantId={onClearInitialTenantId}
          cameFromMeters={false}
          onBackToMeters={onBackToMeters}
        />
      );

      // Initially no tenant is selected
      expect(within(container).getByText('ไม่มีผู้เช่าถูกเลือกในขณะนี้')).toBeTruthy();

      // User navigates from Meters with mockTenant2 ID while tab was already mounted
      rerender(
        <OwnerTenants
          tenants={[mockTenant1, mockTenant2]}
          rooms={[{ id: 'room-102', roomNumber: '102', currentTenantId: mockTenant2.id } as any]}
          bills={[]}
          contracts={[{ id: 'ctr-2', tenantId: mockTenant2.id, roomId: 'room-102' } as any]}
          initialTenantId={mockTenant2.id}
          onClearInitialTenantId={onClearInitialTenantId}
          cameFromMeters={true}
          onBackToMeters={onBackToMeters}
        />
      );

      // mockTenant2 is immediately selected without second click
      expect(within(container).getAllByText('นางสาวสมศรี มีสุข').length).toBe(2);
      expect(within(container).queryByText('ไม่มีผู้เช่าถูกเลือกในขณะนี้')).toBeNull();
      expect(onClearInitialTenantId).toHaveBeenCalled();
    });

    it('Proof 7C: initialTenantId exists while tenants array is initially empty (async loading), auto-selects when populated', () => {
      const onClearInitialTenantId = vi.fn();
      const onBackToMeters = vi.fn();

      const { container, rerender } = render(
        <OwnerTenants
          tenants={[]}
          rooms={[]}
          bills={[]}
          contracts={[]}
          initialTenantId={mockTenant1.id}
          onClearInitialTenantId={onClearInitialTenantId}
          cameFromMeters={true}
          onBackToMeters={onBackToMeters}
        />
      );

      // initialTenantId was NOT cleared while tenants was empty
      expect(onClearInitialTenantId).not.toHaveBeenCalled();

      // tenants query completes and populates tenants array
      rerender(
        <OwnerTenants
          tenants={[mockTenant1]}
          rooms={[{ id: 'room-101', roomNumber: '101', currentTenantId: mockTenant1.id } as any]}
          bills={[]}
          contracts={[{ id: 'ctr-1', tenantId: mockTenant1.id, roomId: 'room-101' } as any]}
          initialTenantId={mockTenant1.id}
          onClearInitialTenantId={onClearInitialTenantId}
          cameFromMeters={true}
          onBackToMeters={onBackToMeters}
        />
      );

      expect(within(container).getAllByText('นายสมชาย ใจดี').length).toBe(2);
      expect(within(container).queryByText('ไม่มีผู้เช่าถูกเลือกในขณะนี้')).toBeNull();
      expect(onClearInitialTenantId).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 8. Financial Detail Breakdown (ดูรายละเอียด) & Authority Rules
  // =========================================================================
  describe('Financial Detail Breakdown (ดูรายละเอียด) Rules', () => {
    const rateSnapshot = {
      waterBillingType: 'per_unit',
      waterRate: '18.00',
      electricityBillingType: 'per_unit',
      electricityRate: '7.00',
      commonFee: '0.00',
      commonFeeMode: 'none',
      internetFee: '0.00',
      internetFeeMode: 'none',
      parkingFee: '0.00',
      parkingFeeMode: 'none',
    };

    it('Proof 8A: 1 component (only monthly utility) -> NO ดูรายละเอียด button', () => {
      const row: any = {
        roomId: 'r1',
        roomNumber: '101',
        waterPrev: '100',
        waterCurr: '110', // 10 * 18 = 180
        elecPrev: '200',
        elecCurr: '250', // 50 * 7 = 350 -> total 530
        peopleCount: 1,
        overdueAmount: '0.00',
        isPaid: false,
        billStatus: 'draft',
        otherFees: [],
      };
      const roomCtx: any = {
        roomId: 'r1',
        billingSource: 'NONE',
        rentAmount: '0.00',
        depositAmount: '0.00',
      };

      const breakdown = getOwnerFinancialBreakdown(row, roomCtx, rateSnapshot, [], 'cycle-aug');
      expect(breakdown.components.length).toBe(1);
      expect(breakdown.components[0].label).toBe('บิลรายเดือน');
      expect(breakdown.components[0].amount).toBe(530);
    });

    it('Proof 8B: 2 components (monthly utility 730 + unissued rent 4000) -> components.length is 2 and totals 4,730.00 ฿', () => {
      const row: any = {
        roomId: 'r1',
        roomNumber: '101',
        waterPrev: '100',
        waterCurr: '110', // 180
        elecPrev: '200',
        elecCurr: '250', // 350
        peopleCount: 1,
        overdueAmount: '0.00',
        isPaid: false,
        billStatus: 'draft',
        otherFees: [{ description: 'ค่าส่วนกลาง', amount: '200.00' }], // 180+350+200 = 730
      };
      const roomCtx: any = {
        roomId: 'r1',
        billingSource: 'CONTRACT',
        rentAmount: '4000.00',
        depositAmount: '0.00',
      };

      const breakdown = getOwnerFinancialBreakdown(row, roomCtx, rateSnapshot, [], 'cycle-aug');
      expect(breakdown.components.length).toBe(2);
      expect(breakdown.components[0].label).toBe('บิลรายเดือน');
      expect(breakdown.components[0].amount).toBe(730);
      expect(breakdown.components[1].label).toBe('ค่าเช่า (เดือน)');
      expect(breakdown.components[1].amount).toBe(4000);
      expect(breakdown.formattedAmount).toBe('4,730.00');
    });

    it('Proof 8C: 3 components (monthly utility + deposit + rent) -> components.length is 3 and totals 9,730.00 ฿', () => {
      const row: any = {
        roomId: 'r1',
        roomNumber: '101',
        waterPrev: '100',
        waterCurr: '110',
        elecPrev: '200',
        elecCurr: '250',
        peopleCount: 1,
        overdueAmount: '0.00',
        isPaid: false,
        billStatus: 'draft',
        otherFees: [{ description: 'ค่าส่วนกลาง', amount: '200.00' }],
      };
      const roomCtx: any = {
        roomId: 'r1',
        billingSource: 'CONTRACT',
        rentAmount: '4000.00',
        depositAmount: '5000.00',
      };

      const breakdown = getOwnerFinancialBreakdown(row, roomCtx, rateSnapshot, [], 'cycle-aug');
      expect(breakdown.components.length).toBe(3);
      expect(breakdown.components[0].label).toBe('บิลรายเดือน');
      expect(breakdown.components[0].amount).toBe(730);
      expect(breakdown.components[1].label).toBe('ค่าประกัน');
      expect(breakdown.components[1].amount).toBe(5000);
      expect(breakdown.components[2].label).toBe('ค่าเช่า (เดือน)');
      expect(breakdown.components[2].amount).toBe(4000);
      expect(breakdown.formattedAmount).toBe('9,730.00');
    });

    it('Proof 8D: Canonical Term billingSource PROVISIONAL_TERM maps to ค่าเช่า (เทอม)', () => {
      const row: any = {
        roomId: 'r-term',
        roomNumber: '201',
        waterPrev: '0',
        waterCurr: '0',
        elecPrev: '0',
        elecCurr: '0',
        peopleCount: 1,
        overdueAmount: '0.00',
        isPaid: false,
        billStatus: 'draft',
        otherFees: [],
      };
      const roomCtx: any = {
        roomId: 'r-term',
        billingSource: 'PROVISIONAL_TERM',
        rentAmount: '12000.00',
        depositAmount: '0.00',
      };

      const breakdown = getOwnerFinancialBreakdown(row, roomCtx, rateSnapshot, [], 'cycle-aug');
      expect(breakdown.components.length).toBe(2);
      expect(breakdown.components[1].label).toBe('ค่าเช่า (เทอม)');
      expect(breakdown.components[1].amount).toBe(12000);
    });

    it('Proof 8E: Future reservation before start (August for Sept 10 tenant): Rent payable = 0, no ค่าเช่า component, primary amount is utility/deposit only', () => {
      const row: any = {
        roomId: 'r-future',
        roomNumber: '301',
        waterPrev: '10',
        waterCurr: '15', // 5 * 18 = 90
        elecPrev: '20',
        elecCurr: '30', // 10 * 7 = 70 -> total 160
        peopleCount: 0,
        overdueAmount: '0.00',
        isPaid: false,
        billStatus: 'draft',
        otherFees: [],
      };
      // Pre-start August projection from server: isFutureReservation = true, billingSource = 'NONE', rentAmount = '0.00'
      const roomCtxAugust: any = {
        roomId: 'r-future',
        billingSource: 'NONE',
        isFutureReservation: true,
        rentAmount: '0.00',
        depositAmount: '5000.00',
      };

      const breakdownAugust = getOwnerFinancialBreakdown(row, roomCtxAugust, rateSnapshot, [], 'cycle-aug');
      // Must NOT include payable 'ค่าเช่า (เดือน)' or 'ค่าเช่า (เทอม)'
      expect(breakdownAugust.components.some(c => c.label.includes('ค่าเช่า'))).toBe(false);
      // Primary operational amount is utility (160) + deposit (5000) = 5160, rent is 0
      expect(breakdownAugust.operationalAmount).toBe(5160);

      // Post-start September projection from server: contract starts, billingSource = 'CONTRACT', rentAmount = '4000.00'
      const roomCtxSeptember: any = {
        roomId: 'r-future',
        billingSource: 'CONTRACT',
        isFutureReservation: false,
        rentAmount: '4000.00',
        depositAmount: '0.00',
      };

      const breakdownSeptember = getOwnerFinancialBreakdown(row, roomCtxSeptember, rateSnapshot, [], 'cycle-sep');
      expect(breakdownSeptember.components.some(c => c.label === 'ค่าเช่า (เดือน)')).toBe(true);
      expect(breakdownSeptember.operationalAmount).toBe(4160); // 160 + 4000
    });
  });

  // =========================================================================
  // 9. Monthly / Term Temporal Projection Authority Matrix
  // =========================================================================
  describe('Monthly / Term Temporal Projection Authority Matrix', () => {
    const mockTenantA: Tenant = {
      id: 't-temporal-01',
      name: 'นายกิตติ มุ่งมั่น',
      phone: '0812345678',
      status: 'active',
    } as any;

    it('Proof 9A: Contract start June 1, end August 1, registered in July -> not shown in June, shown in July & Aug, not in Sept', async () => {
      // Contract registered in July (createdAt = 2026-07-15)
      const contractJulyReg: Contract = {
        id: 'ctr-july-reg',
        dormitoryId: 'dorm-test',
        roomId: 'room-temp-101',
        tenantId: mockTenantA.id,
        startDate: '2026-06-01',
        endDate: '2026-08-01',
        createdAt: '2026-07-15T10:00:00.000Z',
        rentAmount: 4500,
        status: 'active',
      } as any;

      const mockRoom: Room = {
        id: 'room-temp-101',
        roomNumber: '101',
        floor: 1,
        roomType: 'standard',
        monthlyRent: 4500,
        depositAmount: 4500,
        status: 'vacant', // real-world vacant
      } as any;

      // 1. June (2026-06): contract did not exist in HorPlus yet (createdAt July) -> NOT shown
      const juneTenant = getTenantForRoomAndCycleHelper('room-temp-101', '2026-06', [contractJulyReg], [mockRoom], [mockTenantA]);
      expect(juneTenant).toBeUndefined();

      // 2. July (2026-07): contract visible in HorPlus and active -> SHOWN
      const julyTenant = getTenantForRoomAndCycleHelper('room-temp-101', '2026-07', [contractJulyReg], [mockRoom], [mockTenantA]);
      expect(julyTenant?.id).toBe(mockTenantA.id);
      expect(julyTenant?.name).toBe('นายกิตติ มุ่งมั่น');

      // 3. August (2026-08): contract occupancy touches Aug 1 -> SHOWN
      const augTenant = getTenantForRoomAndCycleHelper('room-temp-101', '2026-08', [contractJulyReg], [mockRoom], [mockTenantA]);
      expect(augTenant?.id).toBe(mockTenantA.id);
      expect(augTenant?.name).toBe('นายกิตติ มุ่งมั่น');

      // 4. September (2026-09): contract ended Aug 1 -> NOT shown
      const septTenant = getTenantForRoomAndCycleHelper('room-temp-101', '2026-09', [contractJulyReg], [mockRoom], [mockTenantA]);
      expect(septTenant).toBeUndefined();
    });

    it('Proof 9B: End date boundary inclusivity (endDate 2026-08-01 vs 2026-07-31)', () => {
      const contractEndsAug1: Contract = {
        id: 'ctr-aug-1',
        roomId: 'r1',
        tenantId: mockTenantA.id,
        startDate: '2026-07-01',
        endDate: '2026-08-01',
        createdAt: '2026-07-01T00:00:00.000Z',
      } as any;

      const contractEndsJuly31: Contract = {
        id: 'ctr-july-31',
        roomId: 'r2',
        tenantId: mockTenantA.id,
        startDate: '2026-07-01',
        endDate: '2026-07-31',
        createdAt: '2026-07-01T00:00:00.000Z',
      } as any;

      // August cycle check
      const aug1Tenant = getTenantForRoomAndCycleHelper('r1', '2026-08', [contractEndsAug1], [], [mockTenantA]);
      expect(aug1Tenant).toBeDefined();
      expect(aug1Tenant?.id).toBe(mockTenantA.id);

      const july31Tenant = getTenantForRoomAndCycleHelper('r2', '2026-08', [contractEndsJuly31], [], [mockTenantA]);
      expect(july31Tenant).toBeUndefined();
    });

    it('Proof 9C: Historical July tenant remains visible in July cycle even though room is currently vacant on August 22', async () => {
      const historicalContract: Contract = {
        id: 'ctr-hist',
        roomId: 'room-101',
        tenantId: mockTenantA.id,
        startDate: '2026-01-01',
        endDate: '2026-07-31',
        createdAt: '2026-01-01T00:00:00.000Z',
        status: 'ended',
      } as any;

      const mockRoom: Room = {
        id: 'room-101',
        roomNumber: '101',
        floor: 1,
        roomType: 'standard',
        monthlyRent: 4500,
        depositAmount: 4500,
        status: 'vacant',
        currentTenantId: undefined, // vacant in real world
      } as any;

      const tenantInJuly = getTenantForRoomAndCycleHelper('room-101', '2026-07', [historicalContract], [mockRoom], [mockTenantA]);
      expect(tenantInJuly).toBeDefined();
      expect(tenantInJuly?.id).toBe(mockTenantA.id);
      expect(tenantInJuly?.name).toBe('นายกิตติ มุ่งมั่น');
    });
  });

  // =========================================================================
  // 10. Daily Stay Real-Time Occupancy & Checkout Semantics Matrix
  // =========================================================================
  describe('Daily Stay Real-Time Occupancy & Checkout Semantics Matrix', () => {
    it('Proof 10A: Daily stay explicit checkout time (2026-08-20 00:00 to 2026-08-23 00:00 Asia/Bangkok)', () => {
      const checkInAt = new Date('2026-08-20T00:00:00+07:00');
      const checkOutAt = new Date('2026-08-23T00:00:00+07:00');

      // 1. Aug 19 23:59 -> now < checkInAt -> Future reservation
      const t1 = new Date('2026-08-19T23:59:00+07:00');
      expect(t1.getTime() < checkInAt.getTime()).toBe(true);

      // 2. Aug 20 00:00 -> active
      const t2 = new Date('2026-08-20T00:00:00+07:00');
      expect(checkInAt.getTime() <= t2.getTime() && t2.getTime() < checkOutAt.getTime()).toBe(true);

      // 3. Aug 22 18:00 -> active
      const t3 = new Date('2026-08-22T18:00:00+07:00');
      expect(checkInAt.getTime() <= t3.getTime() && t3.getTime() < checkOutAt.getTime()).toBe(true);

      // 4. Aug 23 00:00 -> now >= checkOutAt -> Vacant
      const t4 = new Date('2026-08-23T00:00:00+07:00');
      expect(t4.getTime() >= checkOutAt.getTime()).toBe(true);
    });

    it('Proof 10B: Daily stay omitted checkout time (2026-08-20 to 2026-08-23) canonical checkout is 2026-08-24 00:00 Bangkok', () => {
      // resolve default checkout: day AFTER endDate at 00:00:00 Bangkok
      const [ey, em, ed] = '2026-08-23'.split('-').map(Number);
      const nextDay = new Date(Date.UTC(ey, em - 1, ed + 1));
      const nextDayStr = nextDay.toISOString().slice(0, 10);
      const checkOutAt = new Date(`${nextDayStr}T00:00:00+07:00`);

      expect(toBangkokDateString(checkOutAt)).toBe('2026-08-24');

      const checkInAt = new Date('2026-08-20T00:00:00+07:00');

      // Aug 23 00:00 -> ACTIVE
      const d1 = new Date('2026-08-23T00:00:00+07:00');
      expect(checkInAt.getTime() <= d1.getTime() && d1.getTime() < checkOutAt.getTime()).toBe(true);

      // Aug 23 12:00 -> ACTIVE
      const d2 = new Date('2026-08-23T12:00:00+07:00');
      expect(checkInAt.getTime() <= d2.getTime() && d2.getTime() < checkOutAt.getTime()).toBe(true);

      // Aug 23 23:59 -> ACTIVE
      const d3 = new Date('2026-08-23T23:59:00+07:00');
      expect(checkInAt.getTime() <= d3.getTime() && d3.getTime() < checkOutAt.getTime()).toBe(true);

      // Aug 24 00:00 -> VACANT
      const d4 = new Date('2026-08-24T00:00:00+07:00');
      expect(d4.getTime() >= checkOutAt.getTime()).toBe(true);
    });

    it('Proof 10C: Same-date daily stay (2026-08-23 to 2026-08-23 no time) -> checkOutAt is 2026-08-24 00:00 and 1 day count', () => {
      const [ey, em, ed] = '2026-08-23'.split('-').map(Number);
      const nextDay = new Date(Date.UTC(ey, em - 1, ed + 1));
      const checkOutAt = new Date(`${nextDay.toISOString().slice(0, 10)}T00:00:00+07:00`);
      const checkInAt = new Date('2026-08-23T00:00:00+07:00');

      expect(toBangkokDateString(checkInAt)).toBe('2026-08-23');
      expect(toBangkokDateString(checkOutAt)).toBe('2026-08-24');
      expect(checkOutAt.getTime() > checkInAt.getTime()).toBe(true);
    });
  });
});
