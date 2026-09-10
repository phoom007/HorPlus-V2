/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { calculateOwnerReports, toSatangs, satangsToString } from '../../utils/report-calculations.js';

describe('calculateOwnerReports — Building Isolation & Math Precision Audit', () => {
  const buildingA = { id: 'bld-a', name: 'อาคาร A', floors: 3 };
  const buildingB = { id: 'bld-b', name: 'อาคาร B', floors: 4 };

  const rooms = [
    // Building A
    { id: 'rm-101', roomNumber: '101', buildingId: 'bld-a', status: 'occupied', price: 4000, depositAmount: 5000 },
    { id: 'rm-102', roomNumber: '102', buildingId: 'bld-a', status: 'vacant', price: 4000, depositAmount: 5000 },
    // Building B
    { id: 'rm-201', roomNumber: '201', buildingId: 'bld-b', status: 'occupied', price: 6000, depositAmount: 8000 },
    { id: 'rm-202', roomNumber: '202', buildingId: 'bld-b', status: 'occupied', price: 6000, depositAmount: 8000 },
    // Unspecified Building
    { id: 'rm-301', roomNumber: '301', buildingId: undefined, status: 'vacant', price: 3500, depositAmount: 4000 },
  ];

  const contracts = [
    // Contract in Building A
    { id: 'ct-101', contractNumber: 'CT-101', roomId: 'rm-101', depositAmount: 5000, rentAmount: 4000, status: 'active' },
    // Contracts in Building B
    { id: 'ct-201', contractNumber: 'CT-201', roomId: 'rm-201', depositAmount: 8000, rentAmount: 6000, status: 'active' },
    { id: 'ct-202', contractNumber: 'CT-202', roomId: 'rm-202', depositAmount: 8000, rentAmount: 6000, status: 'active' },
  ];

  const repairs = [
    // Room 101 (Building A)
    { id: 'rep-1', roomId: 'rm-101', cost: 450, status: 'completed', createdAt: '2026-08-05T10:00:00.000Z' },
    // Room 201 (Building B)
    { id: 'rep-2', roomId: 'rm-201', cost: 1200, status: 'completed', createdAt: '2026-08-12T14:00:00.000Z' },
    // Dorm-wide common area (No room, No building)
    { id: 'rep-3', roomId: undefined, buildingId: undefined, cost: 3000, status: 'completed', createdAt: '2026-08-20T09:00:00.000Z' },
    // Older repair in another month
    { id: 'rep-old', roomId: 'rm-101', cost: 700, status: 'completed', createdAt: '2026-07-15T11:00:00.000Z' },
  ];

  const bills = [
    // Room 101 (Bld A) — Fully Paid
    {
      id: 'bill-101',
      roomId: 'rm-101',
      roomNumber: '101',
      cycleCode: '2026-08',
      status: 'paid',
      rentAmount: 4000,
      waterAmount: 150,
      electricAmount: 500,
      commonFee: 200,
      totalAmount: 4850,
      paidAmount: 4850,
      items: [
        { category: 'rent', amount: 4000 },
        { category: 'water', amount: 150 },
        { category: 'electricity', amount: 500 },
        { category: 'common_fee', amount: 200 },
      ]
    },
    // Room 201 (Bld B) — Pending (Unpaid)
    {
      id: 'bill-201',
      roomId: 'rm-201',
      roomNumber: '201',
      cycleCode: '2026-08',
      status: 'pending',
      rentAmount: 6000,
      waterAmount: 200,
      electricAmount: 800,
      commonFee: 300,
      totalAmount: 7300,
      paidAmount: 0,
      items: [
        { category: 'rent', amount: 6000 },
        { category: 'water', amount: 200 },
        { category: 'electricity', amount: 800 },
        { category: 'common_fee', amount: 300 },
      ]
    },
    // Room 202 (Bld B) — Partially Paid (3,000 paid out of 7,200)
    {
      id: 'bill-202',
      roomId: 'rm-202',
      roomNumber: '202',
      cycleCode: '2026-08',
      status: 'partially_paid',
      rentAmount: 6000,
      waterAmount: 200,
      electricAmount: 700,
      commonFee: 300,
      totalAmount: 7200,
      paidAmount: 3000,
      items: [
        { category: 'rent', amount: 6000 },
        { category: 'water', amount: 200 },
        { category: 'electricity', amount: 700 },
        { category: 'common_fee', amount: 300 },
      ]
    },
    // Overdue Bill from previous cycle (Room 201)
    {
      id: 'bill-201-overdue',
      roomId: 'rm-201',
      roomNumber: '201',
      cycleCode: '2026-07',
      status: 'overdue',
      totalAmount: 7100,
    }
  ];

  it('1. Calculates correct dorm-wide metrics when selectedBuilding === "all"', () => {
    const report = calculateOwnerReports({
      rooms,
      bills,
      contracts,
      repairs,
      buildings: [buildingA, buildingB],
      selectedBuilding: 'all',
      selectedCycleCode: '2026-08',
      selectedYear: '2026',
    });

    // Occupancy
    expect(report.totalRooms).toBe(5);
    expect(report.occupiedCount).toBe(3);
    expect(report.vacantCount).toBe(2);
    expect(report.occupiedPercent).toBe(60); // 3 / 5 * 100

    // Deposits: 5,000 (A) + 8,000 (B) + 8,000 (B) = 21,000
    expect(report.depositTotal).toBe(21000);
    expect(report.exactDepositTotal).toBe('21000.00');

    // Revenue & Billed
    // 4,850 (101) + 7,300 (201) + 7,200 (202) = 19,350
    expect(report.totalBilledThisMonth).toBe(19350);
    expect(report.exactTotalBilledThisMonth).toBe('19350.00');

    // Paid revenue: 4,850 + 3,000 = 7,850
    expect(report.totalRevenueThisMonth).toBe(7850);
    expect(report.exactTotalRevenueThisMonth).toBe('7850.00');

    // Unpaid: 19,350 - 7,850 = 11,500
    expect(report.totalUnpaidThisMonth).toBe(11500);

    // Overdue: 7,100
    expect(report.totalOverdueAmount).toBe(7100);

    // Repairs (all): 450 + 1200 + 3000 = 4,650
    expect(report.totalRepairCostThisMonth).toBe(4650);
    expect(report.repairsCountThisMonth).toBe(3);
    // Net Income: 7,850 - 4,650 = 3,200
    expect(report.netIncomeThisMonth).toBe(3200);

    // Yearly repairs: 4,650 + 700 = 5,350
    expect(report.totalRepairCostYear).toBe(5350);
    expect(report.repairsCountYear).toBe(4);
  });

  it('2. Isolates Building A correctly (contracts, deposits, bills, and repairs must NOT leak from Building B)', () => {
    const reportA = calculateOwnerReports({
      rooms,
      bills,
      contracts,
      repairs,
      buildings: [buildingA, buildingB],
      selectedBuilding: 'bld-a',
      selectedCycleCode: '2026-08',
      selectedYear: '2026',
    });

    // Occupancy (Building A has 2 rooms: 1 occupied, 1 vacant)
    expect(reportA.totalRooms).toBe(2);
    expect(reportA.occupiedCount).toBe(1);
    expect(reportA.vacantCount).toBe(1);
    expect(reportA.occupiedPercent).toBe(50);

    // Deposits: MUST BE ONLY 5,000 (Room 101), NOT 21,000!
    expect(reportA.depositTotal).toBe(5000);
    expect(reportA.exactDepositTotal).toBe('5000.00');

    // Billed & Revenue in Building A: ONLY Room 101 (4,850)
    expect(reportA.totalBilledThisMonth).toBe(4850);
    expect(reportA.totalRevenueThisMonth).toBe(4850);
    expect(reportA.totalUnpaidThisMonth).toBe(0);
    expect(reportA.paidPercent).toBe(100);
    expect(reportA.unpaidPercent).toBe(0);

    // Categories in Building A
    expect(reportA.fixedRentTotal).toBe(4000);
    expect(reportA.waterTotal).toBe(150);
    expect(reportA.electricTotal).toBe(500);
    expect(reportA.commonParkingTotal).toBe(200);

    // Overdue in Building A: 0 (The overdue bill is in Building B)
    expect(reportA.totalOverdueAmount).toBe(0);

    // Repairs: ONLY Room 101 repair (450), dorm-wide repair (3000) and Bld B repair (1200) MUST NOT leak!
    expect(reportA.totalRepairCostThisMonth).toBe(450);
    expect(reportA.repairsCountThisMonth).toBe(1);
    // Net Income for Building A: 4,850 - 450 = 4,400
    expect(reportA.netIncomeThisMonth).toBe(4400);

    // ARPU in Building A: 4,850 / 1 = 4,850
    expect(reportA.arpu).toBe(4850);
  });

  it('3. Isolates Building B correctly (contracts, deposits, bills, and repairs must NOT leak from Building A)', () => {
    const reportB = calculateOwnerReports({
      rooms,
      bills,
      contracts,
      repairs,
      buildings: [buildingA, buildingB],
      selectedBuilding: 'bld-b',
      selectedCycleCode: '2026-08',
      selectedYear: '2026',
    });

    // Occupancy (Building B has 2 rooms: both occupied)
    expect(reportB.totalRooms).toBe(2);
    expect(reportB.occupiedCount).toBe(2);
    expect(reportB.vacantCount).toBe(0);
    expect(reportB.occupiedPercent).toBe(100);

    // Deposits: MUST BE 16,000 (8,000 + 8,000), NOT 21,000!
    expect(reportB.depositTotal).toBe(16000);
    expect(reportB.exactDepositTotal).toBe('16000.00');

    // Billed: 7,300 + 7,200 = 14,500
    expect(reportB.totalBilledThisMonth).toBe(14500);
    // Revenue: Partial payment of 3,000
    expect(reportB.totalRevenueThisMonth).toBe(3000);
    // Unpaid: 14,500 - 3,000 = 11,500
    expect(reportB.totalUnpaidThisMonth).toBe(11500);

    // Overdue in Building B: 7,100
    expect(reportB.totalOverdueAmount).toBe(7100);

    // Repairs: ONLY Room 201 repair (1,200)
    expect(reportB.totalRepairCostThisMonth).toBe(1200);
    expect(reportB.repairsCountThisMonth).toBe(1);
    // Net Income for Building B: 3,000 - 1,200 = 1,800
    expect(reportB.netIncomeThisMonth).toBe(1800);
  });

  it('4. Isolates "unspecified" building correctly', () => {
    const reportUnspecified = calculateOwnerReports({
      rooms,
      bills,
      contracts,
      repairs,
      buildings: [buildingA, buildingB],
      selectedBuilding: 'unspecified',
      selectedCycleCode: '2026-08',
      selectedYear: '2026',
    });

    // Occupancy: Only Room 301
    expect(reportUnspecified.totalRooms).toBe(1);
    expect(reportUnspecified.occupiedCount).toBe(0);
    expect(reportUnspecified.vacantCount).toBe(1);

    // Deposits & Bills: None
    expect(reportUnspecified.depositTotal).toBe(0);
    expect(reportUnspecified.totalBilledThisMonth).toBe(0);
    expect(reportUnspecified.totalRevenueThisMonth).toBe(0);
    expect(reportUnspecified.totalRepairCostThisMonth).toBe(0);
  });

  it('5. Matches bills when bill links by roomNumber instead of roomId', () => {
    const legacyBills = [
      {
        id: 'bill-legacy-1',
        roomId: undefined,
        roomNumber: '101',
        cycleCode: '2026-08',
        status: 'paid',
        totalAmount: 4850,
        paidAmount: 4850,
      }
    ];

    const reportA = calculateOwnerReports({
      rooms,
      bills: legacyBills,
      contracts,
      repairs,
      buildings: [buildingA, buildingB],
      selectedBuilding: 'bld-a',
      selectedCycleCode: '2026-08',
      selectedYear: '2026',
    });

    expect(reportA.totalBilledThisMonth).toBe(4850);
    expect(reportA.totalRevenueThisMonth).toBe(4850);
  });
});
