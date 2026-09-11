/**
 * @license Apache-2.0
 * OWNER R3.8b — Allocation Engine & Financial Ledger Unit Tests
 */

import { describe, it, expect } from 'vitest';
import { Decimal } from 'decimal.js';
import {
  computeCanonicalAllocationPlan,
  getItemPriority,
  EligibleBill,
} from '../../server/src/utils/allocation.util.js';
import { calculateChargeableOverdueDays } from '../../server/src/utils/monthly-utility-calculator.util.js';

describe('OWNER R3.8b: Financial Allocation Engine Unit Tests', () => {
  const dormitoryId = 'd0000000-0000-0000-0000-000000000001';
  const roomId101 = 'r0000000-0000-0000-0000-000000000101';
  const roomId102 = 'r0000000-0000-0000-0000-000000000102';
  const tenantId = 't0000000-0000-0000-0000-000000000001';

  it('1. Correctly determines item priority hierarchy (RENT -> WATER -> ELECTRIC -> COMMON -> INTERNET -> PARKING -> OTHER -> LATE FEE)', () => {
    expect(getItemPriority('rent')).toBeLessThan(getItemPriority('water'));
    expect(getItemPriority('water')).toBeLessThan(getItemPriority('electric'));
    expect(getItemPriority('electric')).toBeLessThan(getItemPriority('common_fee'));
    expect(getItemPriority('common_fee')).toBeLessThan(getItemPriority('internet'));
    expect(getItemPriority('internet')).toBeLessThan(getItemPriority('parking'));
    expect(getItemPriority('parking')).toBeLessThan(getItemPriority('other'));
    expect(getItemPriority('other')).toBeLessThan(getItemPriority('late_fee'));
  });

  it('2. Fails closed with PAYMENT_EXCEEDS_ELIGIBLE_OUTSTANDING if amount exceeds total outstanding', () => {
    const bills: EligibleBill[] = [
      {
        id: 'bill-1',
        dormitoryId,
        roomId: roomId101,
        tenantId,
        billNumber: 'INV-202607-101',
        billKind: 'MONTHLY_UTILITY',
        status: 'UNPAID',
        billingDate: '2026-07-25',
        totalAmount: '4500.00',
        paidAmount: '0.00',
        outstandingAmount: '4500.00',
      },
    ];

    expect(() =>
      computeCanonicalAllocationPlan({
        submitAmount: '5000.00',
        targetRoomId: roomId101,
        targetTenantId: tenantId,
        eligibleBills: bills,
      })
    ).toThrowError('ยอดในสลิปเกินกว่ายอดที่ต้องชำระจริง กรุณาติดต่อเจ้าของหอพัก');
  });

  it('3. Fails closed if attempting to allocate to a different room (Cross-room protection)', () => {
    const bills: EligibleBill[] = [
      {
        id: 'bill-102',
        dormitoryId,
        roomId: roomId102,
        tenantId,
        billNumber: 'INV-202607-102',
        billKind: 'MONTHLY_UTILITY',
        status: 'UNPAID',
        billingDate: '2026-07-25',
        totalAmount: '4500.00',
        paidAmount: '0.00',
        outstandingAmount: '4500.00',
      },
    ];

    expect(() =>
      computeCanonicalAllocationPlan({
        submitAmount: '4500.00',
        targetRoomId: roomId101,
        targetTenantId: tenantId,
        eligibleBills: bills,
      })
    ).toThrowError('ไม่พบบิลที่มียอดค้างชำระสำหรับห้องและผู้เช่าที่ระบุ');
  });

  it('4. Allocates across multiple bills: Oldest Monthly Bill FIRST, then Deposit Bill LAST', () => {
    const julyBill: EligibleBill = {
      id: 'bill-july',
      dormitoryId,
      roomId: roomId101,
      tenantId,
      billNumber: 'INV-202607-101',
      billKind: 'MONTHLY_UTILITY',
      status: 'UNPAID',
      billingDate: '2026-07-25',
      billingCycle: { id: 'cycle-july', cycleCode: '2026-07', periodStart: '2026-07-01' },
      totalAmount: '4000.00',
      paidAmount: '0.00',
      outstandingAmount: '4000.00',
    };

    const augBill: EligibleBill = {
      id: 'bill-aug',
      dormitoryId,
      roomId: roomId101,
      tenantId,
      billNumber: 'INV-202608-101',
      billKind: 'MONTHLY_UTILITY',
      status: 'UNPAID',
      billingDate: '2026-08-25',
      billingCycle: { id: 'cycle-aug', cycleCode: '2026-08', periodStart: '2026-08-01' },
      totalAmount: '5000.00',
      paidAmount: '0.00',
      outstandingAmount: '5000.00',
    };

    const depositBill: EligibleBill = {
      id: 'bill-deposit',
      dormitoryId,
      roomId: roomId101,
      tenantId,
      billNumber: 'DEP-2026-101',
      billKind: 'DEPOSIT',
      status: 'UNPAID',
      billingDate: '2026-07-01',
      totalAmount: '9000.00',
      paidAmount: '0.00',
      outstandingAmount: '9000.00',
    };

    // Tenant pays ฿7,000 via 1 transfer:
    // Should allocate:
    // 1. July Bill: ฿4,000 (Fully PAID)
    // 2. August Bill: ฿2,000 (PARTIALLY_PAID, remaining ฿3,000)
    // 3. Deposit Bill: ฿1,000 (PARTIALLY_PAID, remaining ฿8,000)
    // Total = ฿7,000
    const plan = computeCanonicalAllocationPlan({
      submitAmount: '7000.00',
      targetRoomId: roomId101,
      targetTenantId: tenantId,
      eligibleBills: [depositBill, augBill, julyBill], // Passed in random order
    });

    expect(plan.totalAllocated.toString()).toBe('7000');
    expect(plan.affectedBills).toHaveLength(2); // July (4000) + Aug (3000) = 7000 exhausts funds before deposit

    const affJuly = plan.affectedBills.find((b) => b.id === 'bill-july')!;
    expect(affJuly.allocatedAmount.toString()).toBe('4000');
    expect(affJuly.newStatus).toBe('PAID');
    expect(affJuly.newOutstandingAmount.toString()).toBe('0');

    const affAug = plan.affectedBills.find((b) => b.id === 'bill-aug')!;
    expect(affAug.allocatedAmount.toString()).toBe('3000');
    expect(affAug.newStatus).toBe('PARTIALLY_PAID');
    expect(affAug.newOutstandingAmount.toString()).toBe('2000');
  });

  it('5. Allocates to Deposit Bill only after all monthly bills are completely satisfied', () => {
    const julyBill: EligibleBill = {
      id: 'bill-july',
      dormitoryId,
      roomId: roomId101,
      tenantId,
      billNumber: 'INV-202607-101',
      billKind: 'MONTHLY_UTILITY',
      status: 'UNPAID',
      billingDate: '2026-07-25',
      billingCycle: { id: 'cycle-july', cycleCode: '2026-07', periodStart: '2026-07-01' },
      totalAmount: '4000.00',
      paidAmount: '0.00',
      outstandingAmount: '4000.00',
    };

    const augBill: EligibleBill = {
      id: 'bill-aug',
      dormitoryId,
      roomId: roomId101,
      tenantId,
      billNumber: 'INV-202608-101',
      billKind: 'MONTHLY_UTILITY',
      status: 'UNPAID',
      billingDate: '2026-08-25',
      billingCycle: { id: 'cycle-aug', cycleCode: '2026-08', periodStart: '2026-08-01' },
      totalAmount: '5000.00',
      paidAmount: '0.00',
      outstandingAmount: '5000.00',
    };

    const depositBill: EligibleBill = {
      id: 'bill-deposit',
      dormitoryId,
      roomId: roomId101,
      tenantId,
      billNumber: 'DEP-2026-101',
      billKind: 'DEPOSIT',
      status: 'UNPAID',
      billingDate: '2026-07-01',
      totalAmount: '9000.00',
      paidAmount: '0.00',
      outstandingAmount: '9000.00',
    };

    // Pay ฿11,000:
    // July = ฿4,000 (PAID)
    // August = ฿5,000 (PAID)
    // Deposit = ฿2,000 (PARTIALLY_PAID, remaining ฿7,000)
    const plan = computeCanonicalAllocationPlan({
      submitAmount: '11000.00',
      targetRoomId: roomId101,
      targetTenantId: tenantId,
      eligibleBills: [depositBill, augBill, julyBill],
    });

    expect(plan.totalAllocated.toString()).toBe('11000');
    expect(plan.affectedBills).toHaveLength(3);

    const affJuly = plan.affectedBills.find((b) => b.id === 'bill-july')!;
    expect(affJuly.newStatus).toBe('PAID');

    const affAug = plan.affectedBills.find((b) => b.id === 'bill-aug')!;
    expect(affAug.newStatus).toBe('PAID');

    const affDep = plan.affectedBills.find((b) => b.id === 'bill-deposit')!;
    expect(affDep.allocatedAmount.toString()).toBe('2000');
    expect(affDep.newStatus).toBe('PARTIALLY_PAID');
    expect(affDep.newOutstandingAmount.toString()).toBe('7000');
  });

  it('6. Allocates inside a monthly bill strictly: RENT -> WATER -> ELECTRIC -> LATE FEE LAST', () => {
    const bill: EligibleBill = {
      id: 'bill-items',
      dormitoryId,
      roomId: roomId101,
      tenantId,
      billNumber: 'INV-ITEMS-101',
      billKind: 'MONTHLY_UTILITY',
      status: 'UNPAID',
      billingDate: '2026-08-25',
      totalAmount: '5000.00',
      paidAmount: '0.00',
      outstandingAmount: '5000.00',
      items: [
        { id: 'item-late', type: 'late_fee', description: 'ค่าปรับล่าช้า', amount: '500.00' },
        { id: 'item-elec', type: 'electricity', description: 'ค่าไฟฟ้า', amount: '800.00' },
        { id: 'item-rent', type: 'rent', description: 'ค่าเช่าห้อง', amount: '3500.00' },
        { id: 'item-water', type: 'water', description: 'ค่าน้ำประปา', amount: '200.00' },
      ],
    };

    // Pay ฿4,000 partial:
    // 1. Rent (฿3,500) -> fully allocated (฿3,500)
    // 2. Water (฿200) -> fully allocated (฿200)
    // 3. Electric (฿800) -> partially allocated (฿300, remaining ฿500)
    // 4. Late fee (฿500) -> ฿0 allocated (remaining ฿500)
    const plan = computeCanonicalAllocationPlan({
      submitAmount: '4000.00',
      targetRoomId: roomId101,
      targetTenantId: tenantId,
      eligibleBills: [bill],
    });

    const allocRent = plan.allocations.find((a) => a.billItemId === 'item-rent')!;
    expect(allocRent.allocatedAmount.toString()).toBe('3500');

    const allocWater = plan.allocations.find((a) => a.billItemId === 'item-water')!;
    expect(allocWater.allocatedAmount.toString()).toBe('200');

    const allocElec = plan.allocations.find((a) => a.billItemId === 'item-elec')!;
    expect(allocElec.allocatedAmount.toString()).toBe('300');

    const allocLate = plan.allocations.find((a) => a.billItemId === 'item-late');
    expect(allocLate).toBeUndefined(); // Late fee received 0
  });

  it('7. Late-Fee Fairness: Chargeable days calculate accurately with silent grace', () => {
    // Due Date = 2026-08-05
    // 2026-08-05: 0 days
    expect(calculateChargeableOverdueDays('2026-08-05', '2026-08-05')).toBe(0);
    // 2026-08-06: Grace day 1 -> 0 days
    expect(calculateChargeableOverdueDays('2026-08-05', '2026-08-06')).toBe(0);
    // 2026-08-07: Grace day 2 -> 0 days
    expect(calculateChargeableOverdueDays('2026-08-05', '2026-08-07')).toBe(0);
    // 2026-08-08: 1 chargeable day
    expect(calculateChargeableOverdueDays('2026-08-05', '2026-08-08')).toBe(1);
    // 2026-08-10: 3 chargeable days
    expect(calculateChargeableOverdueDays('2026-08-05', '2026-08-10')).toBe(3);
  });
});
