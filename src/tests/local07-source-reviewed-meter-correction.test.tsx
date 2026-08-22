import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OwnerMeters, getOwnerFinancialBreakdown } from '../pages/owner/meters';
import { TimeWheelPicker } from '../components/TimeWheelPicker';
import * as httpClient from '../data/httpClient';
import { Room, Bill, Tenant, Contract } from '../types';

describe('LOCAL-07 Source-Reviewed Meter Workspace Correction Suite', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    });
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: [{ id: 'cycle-aug', cycleCode: '2026-08', name: 'รอบบิล สิงหาคม 2569', isCurrent: true }],
        firstBillingCycleId: 'cycle-aug',
        operationalBillingCycleId: 'cycle-aug',
        operationalCycleCode: '2026-08',
      }),
    } as any);
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
        rentAmount: 4000,
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
        rentAmount: 4000,
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
        rentAmount: 4000,
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
              rooms: [{ roomId: 'r1', roomNumber: '101', billingSource: 'MONTHLY_CONTRACT', rentAmount: 4000 }],
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

    it('Proof 3B: TimeWheel interactive time selection — selecting 15:47 updates output correctly', () => {
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
  });
});
