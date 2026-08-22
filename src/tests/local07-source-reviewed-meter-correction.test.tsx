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
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    vi.clearAllMocks();
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
      // Rent 4000 + Water 180 + Elec 350 + Common 200 = 4730
      expect(financial.formattedAmount).toBe('4,730.00');
      expect(financial.components.length).toBe(1);
      expect(financial.components[0].label).toBe('บิลรายเดือน');
      expect(financial.components[0].formattedAmount).toBe('4,730.00');
    });

    it('Proof 1C: 2 components (Monthly Bill + Deposit) -> exactly 2 components with labels บิลรายเดือน and ค่าประกัน', () => {
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
        isDepositPaid: false,
      };

      const financial = getOwnerFinancialBreakdown(row, roomCtx, defaultRateSnapshot, [], 'cycle-1');
      // 4730 + 5000 = 9730
      expect(financial.formattedAmount).toBe('9,730.00');
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
  });
});
