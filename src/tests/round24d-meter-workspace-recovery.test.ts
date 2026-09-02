/**
 * @license Apache-2.0
 * Round 2.4D Meter Workspace Blank-Screen Runtime Recovery Tests
 */

import { describe, it, expect } from 'vitest';
import { buildRowsFromWorkspace } from '../pages/owner/meters';
import type { Room, Bill, Building, Contract, Tenant } from '../types';

describe('Round 2.4D Meter Workspace buildRowsFromWorkspace Recovery', () => {
  const buildingCId = 'bld-c-12345';
  const mockBuildings: Building[] = [
    {
      id: buildingCId,
      code: 'C',
      name: 'อาคาร C',
      floorsCount: 4,
      createdAt: '2026-09-01',
      updatedAt: '2026-09-02',
    },
  ];

  const mockRooms: Room[] = [
    {
      id: 'room-101-uuid',
      dormitoryId: 'dorm-1',
      roomNumber: '101',
      floor: 1,
      buildingId: buildingCId,
      status: 'occupied',
      monthlyRent: 4500,
    } as unknown as Room,
  ];

  const mockWorkspaceData = {
    serverReadings: [
      { roomId: 'room-101-uuid', meterType: 'water', previousReading: 100, currentReading: 120 },
      { roomId: 'room-101-uuid', meterType: 'electricity', previousReading: 500, currentReading: 580 },
    ],
    cyclePeopleRes: {
      success: true,
      data: [{ roomId: 'room-101-uuid', peopleCount: 2, manualOutstandingAmount: '0.00', version: 1 }],
    },
  };

  it('1. calling buildRowsFromWorkspace DOES NOT THROW and populates exact Building C identity', () => {
    expect(() => {
      buildRowsFromWorkspace({
        workspaceData: mockWorkspaceData,
        rooms: mockRooms,
        bills: [],
        contracts: [],
        tenants: [],
        buildings: mockBuildings,
        selectedBillingCycleId: 'cycle-2026-09-uuid',
        selectedCycleCode: '2026-09',
        currentDormId: 'dorm-1',
      });
    }).not.toThrow();

    const result = buildRowsFromWorkspace({
      workspaceData: mockWorkspaceData,
      rooms: mockRooms,
      bills: [],
      contracts: [],
      tenants: [],
      buildings: mockBuildings,
      selectedBillingCycleId: 'cycle-2026-09-uuid',
      selectedCycleCode: '2026-09',
      currentDormId: 'dorm-1',
    });

    expect(result.rows.length).toBe(1);
    const row = result.rows[0];

    // Building identity assertions
    expect(row.buildingId).toBe(buildingCId);
    expect(row.buildingCode).toBe('C');
    expect(row.buildingName).toBe('อาคาร C');
    expect(row.roomNumber).toBe('101');

    // Financial status fields exist and are defined
    expect(row.billStatus).toBeDefined();
    expect(row.monthlyUtilityBillStatus).toBe('draft');
    expect(row.isMonthlyUtilityPaid).toBe(false);
    expect(row.isPaid).toBe(false);
  });

  it('2. restores canonical PAID monthly utility context and isPaid behavior', () => {
    const paidWorkspaceData = {
      serverReadings: [],
      cyclePeopleRes: { success: true, data: [] },
      previewContext: {
        rooms: [
          {
            roomId: 'room-101-uuid',
            overallFinancialStatus: 'paid',
            monthlyUtilityBillStatus: 'paid',
            isMonthlyUtilityPaid: true,
            isPaid: true,
          },
        ],
      },
    };

    const mockBills: Bill[] = [
      {
        id: 'bill-paid-01',
        billNumber: 'INV-001',
        cycleId: '2026-09',
        billingCycleId: 'cycle-2026-09-uuid',
        billKind: 'MONTHLY_UTILITY',
        roomId: 'room-101-uuid',
        tenantId: 'tenant-01',
        status: 'paid',
        totalAmount: 500,
        items: [],
        dueDate: '2026-09-05',
        createdAt: '2026-09-01',
        updatedAt: '2026-09-02',
      } as unknown as Bill,
    ];

    const result = buildRowsFromWorkspace({
      workspaceData: paidWorkspaceData,
      rooms: mockRooms,
      bills: mockBills,
      contracts: [],
      tenants: [],
      buildings: mockBuildings,
      selectedBillingCycleId: 'cycle-2026-09-uuid',
      selectedCycleCode: '2026-09',
      currentDormId: 'dorm-1',
    });

    const row = result.rows[0];
    expect(row.billStatus).toBe('paid');
    expect(row.overallFinancialStatus).toBe('paid');
    expect(row.monthlyUtilityBillStatus).toBe('paid');
    expect(row.isMonthlyUtilityPaid).toBe(true);
    expect(row.isPaid).toBe(true);
  });

  it('3. does not throw even if buildings parameter is completely omitted', () => {
    expect(() => {
      buildRowsFromWorkspace({
        workspaceData: mockWorkspaceData,
        rooms: mockRooms,
        bills: [],
        contracts: [],
        tenants: [],
        // buildings omitted intentionally
        selectedBillingCycleId: 'cycle-2026-09-uuid',
        selectedCycleCode: '2026-09',
        currentDormId: 'dorm-1',
      });
    }).not.toThrow();
  });
});
