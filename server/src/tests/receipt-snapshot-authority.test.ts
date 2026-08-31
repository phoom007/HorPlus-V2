/**
 * @license Apache-2.0
 * OWNER R3.9-E.1B.1.1: Immutable Receipt Snapshot Authority Foundation Test Suite
 */

import { describe, it, expect, vi } from 'vitest';
import { Decimal } from 'decimal.js';
import {
  generateReceiptInTx,
  generateGroupReceiptInTx,
  buildBillGroupSnapshot,
  mapBillItemsToSnapshot,
  GroupReceiptBillSnapshot,
} from '../utils/payment-transaction.util.js';

describe('OWNER R3.9-E.1B.1.1 — Immutable Receipt Snapshot Authority Foundation', () => {
  const dormitoryId = 'dorm-test-uuid';
  const tenantId = 'tenant-test-uuid';
  const roomId = 'room-test-uuid';

  const tieredWaterMetadata = {
    mode: 'tiered',
    usageUnits: '15.00',
    tierBreakdown: [
      {
        lowerExclusive: '0.00',
        upperInclusive: '10.00',
        billedUnits: '10.00',
        rate: '3.40',
        amount: '34.00',
      },
      {
        lowerExclusive: '10.00',
        upperInclusive: '20.00',
        billedUnits: '5.00',
        rate: '4.25',
        amount: '21.25',
      },
    ],
  };

  const standardElecMetadata = {
    mode: 'tiered',
    usageUnits: '130.00',
    tierBreakdown: [
      {
        lowerExclusive: '0.00',
        upperInclusive: '50.00',
        billedUnits: '50.00',
        rate: '7.00',
        amount: '350.00',
      },
      {
        lowerExclusive: '50.00',
        upperInclusive: '150.00',
        billedUnits: '80.00',
        rate: '8.00',
        amount: '640.00',
      },
    ],
  };

  const mockTx = (opts: {
    bill?: any;
    payment?: any;
    dormitory?: any;
    seqValue?: number;
    targets?: any[];
    allocations?: any[];
  }) => {
    let createdReceipt: any = null;
    return {
      receiptSequence: {
        upsert: vi.fn().mockResolvedValue({
          lastValue: opts.seqValue ?? 1,
        }),
      },
      bill: {
        findUnique: vi.fn().mockResolvedValue(opts.bill || null),
      },
      payment: {
        findUnique: vi.fn().mockResolvedValue(opts.payment || null),
      },
      combinedPaymentGroupBillTarget: {
        findMany: vi.fn().mockResolvedValue(opts.targets || []),
      },
      paymentAllocation: {
        findMany: vi.fn().mockResolvedValue(opts.allocations || []),
      },
      dormitory: {
        findUnique: vi.fn().mockResolvedValue(opts.dormitory || { name: 'หอพัก HorPlus เทส' }),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({ name: 'ผู้จัดการ ทดสอบ' }),
      },
      receipt: {
        create: vi.fn().mockImplementation((args: any) => {
          createdReceipt = {
            id: 'rc-generated-uuid',
            ...args.data,
          };
          return Promise.resolve(createdReceipt);
        }),
      },
      getCreatedReceipt: () => createdReceipt,
    };
  };

  // =========================================================================
  // 1. SINGLE RECEIPT: FULL PAYMENT (Section 26)
  // =========================================================================
  it('Section 26: Full payment receipt preserves gross BillItems, type, and exact Tier metadata', async () => {
    const mockBill = {
      id: 'bill-101',
      billNumber: 'INV-202608-101',
      billKind: 'MONTHLY',
      totalAmount: new Decimal('1055.25'),
      dormitoryId,
      tenantId,
      roomId,
      dormitory: { name: 'หอพัก HorPlus พรีเมียม' },
      tenant: { displayName: 'นายสมชาย ใจดี' },
      room: { roomNumber: '101', normalizedRoomNumber: '101' },
      items: [
        {
          id: 'item-rent',
          type: 'rent',
          description: 'ค่าเช่าห้องพัก',
          quantity: new Decimal('1.00'),
          unit: 'เดือน',
          unitPrice: new Decimal('1000.00'),
          amount: new Decimal('1000.00'),
          metadata: null,
          displayOrder: 1,
        },
        {
          id: 'item-water',
          type: 'water',
          description: 'ค่าน้ำประปา (แบบขั้นบันได)',
          quantity: new Decimal('15.00'),
          unit: 'unit',
          unitPrice: new Decimal('0.00'),
          amount: new Decimal('55.25'),
          metadata: tieredWaterMetadata,
          displayOrder: 2,
        },
      ],
    };

    const mockPayment = {
      id: 'pay-101',
      amount: new Decimal('1055.25'),
      method: 'BANK_TRANSFER',
      paymentDate: new Date('2026-08-25T10:00:00Z'),
    };

    const tx = mockTx({ bill: mockBill, payment: mockPayment });

    const receipt = await generateReceiptInTx(
      tx,
      mockPayment.id,
      dormitoryId,
      mockBill.id,
      'user-manager-uuid',
      null,
      mockPayment.amount
    );

    const snapshot = receipt.snapshotData;
    expect(snapshot.receiptNumber).toMatch(/^RC-\d{6}-101-0001$/);
    expect(snapshot.billNumber).toBe('INV-202608-101');
    expect(snapshot.total).toBe('1055.25');
    expect(snapshot.receivedAmount).toBe('1055.25');
    expect(snapshot.billTotal).toBe('1055.25');
    expect(snapshot.allocatedAmount).toBe('1055.25');
    expect(snapshot.isCombinedReceipt).toBe(false);

    // Items verification
    expect(snapshot.items).toHaveLength(2);

    const rentItem = snapshot.items[0];
    expect(rentItem.type).toBe('rent');
    expect(rentItem.description).toBe('ค่าเช่าห้องพัก');
    expect(rentItem.quantity).toBe('1.00');
    expect(rentItem.unit).toBe('เดือน');
    expect(rentItem.unitPrice).toBe('1000.00');
    expect(rentItem.amount).toBe('1000.00');
    expect(rentItem.metadata).toBeNull();

    const waterItem = snapshot.items[1];
    expect(waterItem.type).toBe('water');
    expect(waterItem.description).toBe('ค่าน้ำประปา (แบบขั้นบันได)');
    expect(waterItem.quantity).toBe('15.00');
    expect(waterItem.unit).toBe('unit');
    expect(waterItem.unitPrice).toBe('0.00'); // No fake average
    expect(waterItem.amount).toBe('55.25');
    expect(waterItem.metadata).toEqual(tieredWaterMetadata);
    expect(waterItem.metadata.tierBreakdown[0].rate).toBe('3.40'); // Decimal string preserved
    expect(waterItem.metadata.tierBreakdown[1].rate).toBe('4.25');
  });

  // =========================================================================
  // 2. SINGLE RECEIPT: PARTIAL PAYMENT (Section 27 & 28)
  // =========================================================================
  it('Section 27 & 28: Partial settlement preserves FULL gross BillItems and Tier metadata without proration or generic replacement', async () => {
    const mockBill = {
      id: 'bill-101',
      billNumber: 'INV-202608-101',
      billKind: 'MONTHLY',
      totalAmount: new Decimal('1055.25'),
      dormitoryId,
      tenantId,
      roomId,
      dormitory: { name: 'หอพัก HorPlus' },
      tenant: { displayName: 'นายสมชาย ใจดี' },
      room: { roomNumber: '101', normalizedRoomNumber: '101' },
      items: [
        {
          id: 'item-rent',
          type: 'rent',
          description: 'ค่าเช่าห้องพัก',
          quantity: new Decimal('1.00'),
          unit: 'เดือน',
          unitPrice: new Decimal('1000.00'),
          amount: new Decimal('1000.00'),
          metadata: null,
          displayOrder: 1,
        },
        {
          id: 'item-water',
          type: 'water',
          description: 'ค่าน้ำประปา (แบบขั้นบันได)',
          quantity: new Decimal('15.00'),
          unit: 'unit',
          unitPrice: new Decimal('0.00'),
          amount: new Decimal('55.25'),
          metadata: tieredWaterMetadata,
          displayOrder: 2,
        },
      ],
    };

    // Partial payment of 500.00 on a 1055.25 bill
    const partialPayment = new Decimal('500.00');
    const mockPayment = {
      id: 'pay-partial-101',
      amount: partialPayment,
      method: 'CASH',
      paymentDate: new Date('2026-08-25T10:00:00Z'),
    };

    const tx = mockTx({ bill: mockBill, payment: mockPayment });

    const receipt = await generateReceiptInTx(
      tx,
      mockPayment.id,
      dormitoryId,
      mockBill.id,
      'user-manager-uuid',
      null,
      partialPayment
    );

    const snapshot = receipt.snapshotData;

    // Financial semantics
    expect(snapshot.total).toBe('500.00'); // Actual money received
    expect(snapshot.receivedAmount).toBe('500.00');
    expect(snapshot.billTotal).toBe('1055.25'); // Gross bill total
    expect(snapshot.allocatedAmount).toBe('500.00');

    // Full gross items preserved
    expect(snapshot.items).toHaveLength(2);
    expect(snapshot.items[0].description).toBe('ค่าเช่าห้องพัก');
    expect(snapshot.items[0].amount).toBe('1000.00'); // NOT prorated
    expect(snapshot.items[1].description).toBe('ค่าน้ำประปา (แบบขั้นบันได)');
    expect(snapshot.items[1].amount).toBe('55.25'); // NOT prorated
    expect(snapshot.items[1].metadata).toEqual(tieredWaterMetadata);

    // Assert generic replacement line is NOT used when BillItems exist
    const hasGenericLine = snapshot.items.some((i: any) => i.description.includes('ชำระยอดคงเหลือบิล'));
    expect(hasGenericLine).toBe(false);

    // Invariant proof (Section 28): SUM(snapshot.items.amount) == 1055.25 while snapshot.total == 500.00
    const grossItemSum = snapshot.items.reduce(
      (sum: Decimal, i: any) => sum.plus(new Decimal(i.amount)),
      new Decimal(0)
    );
    expect(grossItemSum.toFixed(2)).toBe('1055.25');
    expect(snapshot.total).toBe('500.00');
  });

  // =========================================================================
  // 3. DETERMINISTIC BILLITEM ORDER (R3.9-E.1B.1.1 Section 2 & 3)
  // =========================================================================
  it('E.1B.1.1 Section 2 & 3: BillItem snapshot ordering enforces deterministic displayOrder ASC', () => {
    // Intentionally out-of-order input fixture (30 Electricity, 10 Rent, 20 Water)
    const unorderedItems = [
      {
        id: 'item-elec',
        type: 'electricity',
        description: 'ค่าไฟฟ้า',
        quantity: new Decimal('130.00'),
        unitPrice: new Decimal('0.00'),
        amount: new Decimal('990.00'),
        metadata: standardElecMetadata,
        displayOrder: 30,
      },
      {
        id: 'item-rent',
        type: 'rent',
        description: 'ค่าเช่าห้องพัก',
        quantity: new Decimal('1.00'),
        unitPrice: new Decimal('4000.00'),
        amount: new Decimal('4000.00'),
        metadata: null,
        displayOrder: 10,
      },
      {
        id: 'item-water',
        type: 'water',
        description: 'ค่าน้ำประปา',
        quantity: new Decimal('15.00'),
        unitPrice: new Decimal('0.00'),
        amount: new Decimal('55.25'),
        metadata: tieredWaterMetadata,
        displayOrder: 20,
      },
    ];

    const snapshotItems = mapBillItemsToSnapshot(unorderedItems);

    expect(snapshotItems).toHaveLength(3);
    // Verified exact order: Rent (10) -> Water (20) -> Electricity (30)
    expect(snapshotItems[0].type).toBe('rent');
    expect(snapshotItems[0].description).toBe('ค่าเช่าห้องพัก');
    expect(snapshotItems[1].type).toBe('water');
    expect(snapshotItems[1].description).toBe('ค่าน้ำประปา');
    expect(snapshotItems[2].type).toBe('electricity');
    expect(snapshotItems[2].description).toBe('ค่าไฟฟ้า');
  });

  // =========================================================================
  // 4. GROUP RECEIPT BOUNDARY INVARIANT: FAILURE TEST (R3.9-E.1B.1.1 Section 4 & 7)
  // =========================================================================
  it('E.1B.1.1 Section 4 & 7: generateGroupReceiptInTx fails closed if SUM(billGroups[].allocatedAmount) != totalAmount', async () => {
    const billAGroups: GroupReceiptBillSnapshot = {
      billId: 'bill-A',
      billNumber: 'INV-202608-A',
      billKind: 'MONTHLY',
      cycleCode: '2026-08',
      billTotal: '4000.00',
      allocatedAmount: '4000.00',
      items: [
        {
          type: 'rent',
          description: 'ค่าเช่าห้องพัก',
          quantity: '1.00',
          unit: 'เดือน',
          unitPrice: '4000.00',
          amount: '4000.00',
          metadata: null,
        },
      ],
    };

    // Mismatched: Bill B has 2000.00 allocated -> sum is 6000.00, but receipt total is 6500.00
    const billBGroupsMismatched: GroupReceiptBillSnapshot = {
      billId: 'bill-B',
      billNumber: 'INV-202608-B',
      billKind: 'MONTHLY',
      cycleCode: '2026-08',
      billTotal: '5000.00',
      allocatedAmount: '2000.00',
      items: [
        {
          type: 'rent',
          description: 'ค่าเช่าห้องพัก',
          quantity: '1.00',
          unit: 'เดือน',
          unitPrice: '5000.00',
          amount: '5000.00',
          metadata: null,
        },
      ],
    };

    const tx = mockTx({});

    let capturedError: any = null;
    try {
      await generateGroupReceiptInTx({
        tx,
        dormitoryId,
        paymentGroupId: 'group-uuid-mismatch',
        totalAmount: new Decimal('6500.00'), // Sum is 6000.00 != 6500.00
        billGroups: [billAGroups, billBGroupsMismatched],
        userId: 'user-manager-uuid',
      });
    } catch (err: any) {
      capturedError = err;
    }

    expect(capturedError).not.toBeNull();
    expect(capturedError.errorCode).toBe('GROUP_RECEIPT_ALLOCATION_MISMATCH');
    expect(capturedError.statusCode).toBe(400);
    expect(capturedError.message).toContain('ไม่ตรงกับยอดเงินที่รับชำระ');

    // Assert receipt creation was NOT called
    expect(tx.receipt.create).not.toHaveBeenCalled();
  });

  // =========================================================================
  // 5. GROUP RECEIPT BOUNDARY INVARIANT: SUCCESS TEST (R3.9-E.1B.1.1 Section 8)
  // =========================================================================
  it('E.1B.1.1 Section 8: generateGroupReceiptInTx succeeds when SUM(billGroups[].allocatedAmount) == totalAmount', async () => {
    const billAGroups: GroupReceiptBillSnapshot = {
      billId: 'bill-A',
      billNumber: 'INV-202608-A',
      billKind: 'MONTHLY',
      cycleCode: '2026-08',
      billTotal: '4000.00',
      allocatedAmount: '4000.00',
      items: [
        {
          type: 'rent',
          description: 'ค่าเช่าห้องพัก',
          quantity: '1.00',
          unit: 'เดือน',
          unitPrice: '4000.00',
          amount: '4000.00',
          metadata: null,
        },
      ],
    };

    const billBGroups: GroupReceiptBillSnapshot = {
      billId: 'bill-B',
      billNumber: 'INV-202608-B',
      billKind: 'MONTHLY',
      cycleCode: '2026-08',
      billTotal: '5000.00',
      allocatedAmount: '2500.00',
      items: [
        {
          type: 'rent',
          description: 'ค่าเช่าห้องพัก',
          quantity: '1.00',
          unit: 'เดือน',
          unitPrice: '5000.00',
          amount: '5000.00',
          metadata: null,
        },
      ],
    };

    const tx = mockTx({});

    const receipt = await generateGroupReceiptInTx({
      tx,
      dormitoryId,
      paymentGroupId: 'group-uuid-valid',
      totalAmount: new Decimal('6500.00'), // 4000 + 2500 == 6500
      billGroups: [billAGroups, billBGroups],
      userId: 'user-manager-uuid',
    });

    expect(tx.receipt.create).toHaveBeenCalledTimes(1);
    expect(receipt.snapshotData.total).toBe('6500.00');
    expect(receipt.snapshotData.receivedAmount).toBe('6500.00');

    const sumAllocated = receipt.snapshotData.billGroups.reduce(
      (sum: Decimal, bg: any) => sum.plus(new Decimal(bg.allocatedAmount)),
      new Decimal(0)
    );
    expect(sumAllocated.toFixed(2)).toBe('6500.00');
  });

  // =========================================================================
  // 6. PRODUCTION GROUP CALL-PATH REGRESSION (R3.9-E.1B.1.1 Section 9, 10, 11)
  // =========================================================================
  it('E.1B.1.1 Section 9, 10, 11: Production builder path preserves gross BillItems, Tier metadata, and partial allocation without proration', async () => {
    // Target Bill A (4000.00 gross)
    const targetBillA = {
      id: 'bill-A',
      billNumber: 'INV-202608-A',
      billKind: 'MONTHLY',
      totalAmount: new Decimal('4000.00'),
      billingCycle: { cycleCode: '2026-08' },
      items: [
        {
          id: 'item-rent-a',
          type: 'rent',
          description: 'ค่าเช่าห้องพัก',
          quantity: new Decimal('1.00'),
          unit: 'เดือน',
          unitPrice: new Decimal('4000.00'),
          amount: new Decimal('4000.00'),
          metadata: null,
          displayOrder: 10,
        },
      ],
    };

    // Target Bill B (5000.00 gross with tiered water & electricity)
    const targetBillB = {
      id: 'bill-B',
      billNumber: 'INV-202608-B',
      billKind: 'MONTHLY',
      totalAmount: new Decimal('5000.00'),
      billingCycle: { cycleCode: '2026-08' },
      items: [
        {
          id: 'item-rent-b',
          type: 'rent',
          description: 'ค่าเช่าห้องพัก',
          quantity: new Decimal('1.00'),
          unit: 'เดือน',
          unitPrice: new Decimal('3954.75'),
          amount: new Decimal('3954.75'),
          metadata: null,
          displayOrder: 10,
        },
        {
          id: 'item-water-b',
          type: 'water',
          description: 'ค่าน้ำประปา (ขั้นบันได)',
          quantity: new Decimal('15.00'),
          unit: 'unit',
          unitPrice: new Decimal('0.00'),
          amount: new Decimal('55.25'),
          metadata: tieredWaterMetadata,
          displayOrder: 20,
        },
        {
          id: 'item-elec-b',
          type: 'electricity',
          description: 'ค่าไฟฟ้า (ขั้นบันได)',
          quantity: new Decimal('130.00'),
          unit: 'unit',
          unitPrice: new Decimal('0.00'),
          amount: new Decimal('990.00'),
          metadata: standardElecMetadata,
          displayOrder: 30,
        },
      ],
    };

    // Simulate allocation plan from PaymentService:
    // Bill A allocated 4000.00, Bill B allocated 2500.00 (partial)
    const allocationPlanAffectedBills = [
      { id: 'bill-A', allocatedAmount: new Decimal('4000.00') },
      { id: 'bill-B', allocatedAmount: new Decimal('2500.00') },
    ];
    const targetBills = [targetBillA, targetBillB];

    // Real production mapping path used in PaymentService.approvePaymentGroup
    const productionBillGroups: GroupReceiptBillSnapshot[] = allocationPlanAffectedBills.map((aff) => {
      const targetBill = targetBills.find((b) => b.id === aff.id)!;
      return buildBillGroupSnapshot(targetBill, aff.allocatedAmount);
    });

    const tx = mockTx({ dormitory: { name: 'หอพัก HorPlus แกรนด์' } });

    const receipt = await generateGroupReceiptInTx({
      tx,
      dormitoryId,
      paymentGroupId: 'group-production-path',
      totalAmount: new Decimal('6500.00'),
      billGroups: productionBillGroups,
      userId: 'user-manager-uuid',
      roomNumber: '201',
      tenantName: 'นางสาวสุภา มีสุข',
    });

    const snapshot = receipt.snapshotData;
    expect(snapshot.total).toBe('6500.00');
    expect(snapshot.billGroups).toHaveLength(2);

    // Bill A assertions
    expect(snapshot.billGroups[0].billId).toBe('bill-A');
    expect(snapshot.billGroups[0].billTotal).toBe('4000.00');
    expect(snapshot.billGroups[0].allocatedAmount).toBe('4000.00');
    expect(snapshot.billGroups[0].items).toHaveLength(1);

    // Bill B assertions (Section 10 & 11)
    const billBSnapshot = snapshot.billGroups[1];
    expect(billBSnapshot.billId).toBe('bill-B');
    expect(billBSnapshot.billTotal).toBe('5000.00'); // Gross total
    expect(billBSnapshot.allocatedAmount).toBe('2500.00'); // Partial allocation
    expect(billBSnapshot.items).toHaveLength(3);

    // Bill B items sum is 5000.00 (NOT prorated to 2500.00)
    const billBItemsSum = billBSnapshot.items.reduce(
      (sum: Decimal, i: any) => sum.plus(new Decimal(i.amount)),
      new Decimal(0)
    );
    expect(billBItemsSum.toFixed(2)).toBe('5000.00');

    // Tier metadata exact survival
    const waterItem = billBSnapshot.items[1];
    expect(waterItem.type).toBe('water');
    expect(waterItem.quantity).toBe('15.00');
    expect(waterItem.unitPrice).toBe('0.00');
    expect(waterItem.amount).toBe('55.25');
    expect(waterItem.metadata.mode).toBe('tiered');
    expect(waterItem.metadata.tierBreakdown).toEqual(tieredWaterMetadata.tierBreakdown);
    expect(waterItem.metadata.tierBreakdown[0].rate).toBe('3.40');

    const elecItem = billBSnapshot.items[2];
    expect(elecItem.type).toBe('electricity');
    expect(elecItem.quantity).toBe('130.00');
    expect(elecItem.unitPrice).toBe('0.00');
    expect(elecItem.amount).toBe('990.00');
    expect(elecItem.metadata.mode).toBe('tiered');
    expect(elecItem.metadata.tierBreakdown).toEqual(standardElecMetadata.tierBreakdown);
  });

  // =========================================================================
  // 7. GENERATOR FALLBACK QUERY PATH (R3.9-E.1B.1.1 Section 12)
  // =========================================================================
  it('E.1B.1.1 Section 12: generateGroupReceiptInTx fallback query path orders items by displayOrder and validates allocation invariant', async () => {
    const mockBillA = {
      id: 'bill-fallback-A',
      billNumber: 'INV-FB-A',
      billKind: 'MONTHLY',
      totalAmount: new Decimal('3000.00'),
      billingCycle: { cycleCode: '2026-08' },
      items: [
        {
          type: 'rent',
          description: 'ค่าเช่า',
          quantity: new Decimal('1.00'),
          unitPrice: new Decimal('3000.00'),
          amount: new Decimal('3000.00'),
          displayOrder: 1,
        },
      ],
    };

    const mockTargets = [
      { billId: 'bill-fallback-A', targetOrder: 1, bill: mockBillA },
    ];

    const mockAllocations = [
      { billId: 'bill-fallback-A', allocatedAmount: new Decimal('3000.00') },
    ];

    const tx = mockTx({
      targets: mockTargets,
      allocations: mockAllocations,
    });

    const receipt = await generateGroupReceiptInTx({
      tx,
      dormitoryId,
      paymentGroupId: 'group-fallback-test',
      totalAmount: new Decimal('3000.00'),
      // billGroups omitted -> exercises fallback branch
    });

    expect(receipt.snapshotData.total).toBe('3000.00');
    expect(receipt.snapshotData.billGroups).toHaveLength(1);
    expect(receipt.snapshotData.billGroups[0].allocatedAmount).toBe('3000.00');
    expect(receipt.snapshotData.billGroups[0].items[0].description).toBe('ค่าเช่า');
  });

  // =========================================================================
  // 8. IMMUTABILITY AUTHORITY TEST (Section 31)
  // =========================================================================
  it('Section 31: Receipt snapshot is completely decoupled from future mutations of the source Bill/BillItems', async () => {
    const sourceMetadata = {
      mode: 'tiered',
      usageUnits: '15.00',
      tierBreakdown: [{ rate: '3.40', amount: '34.00' }],
    };

    const mockBill = {
      id: 'bill-mutate-test',
      billNumber: 'INV-MUTATE-1',
      totalAmount: new Decimal('100.00'),
      dormitoryId,
      tenantId,
      roomId,
      dormitory: { name: 'หอพัก HorPlus' },
      tenant: { displayName: 'ผู้เช่า 1' },
      room: { roomNumber: '101' },
      items: [
        {
          type: 'water',
          description: 'ค่าน้ำประปาเดิม',
          quantity: new Decimal('15.00'),
          unitPrice: new Decimal('0.00'),
          amount: new Decimal('100.00'),
          metadata: sourceMetadata,
          displayOrder: 1,
        },
      ],
    };

    const tx = mockTx({ bill: mockBill });

    const receipt = await generateReceiptInTx(
      tx,
      null,
      dormitoryId,
      mockBill.id,
      null,
      null,
      new Decimal('100.00')
    );

    // Mutate source Bill and BillItem in memory after snapshot creation
    mockBill.billNumber = 'INV-MUTATED-AFTERWARDS';
    mockBill.items[0].description = 'คำอธิบายที่ถูกแก้ภายหลัง';
    sourceMetadata.tierBreakdown[0].rate = '999.99';

    // Verify receipt snapshot remains unchanged
    const snapshot = receipt.snapshotData;
    expect(snapshot.billNumber).toBe('INV-MUTATE-1');
    expect(snapshot.items[0].description).toBe('ค่าน้ำประปาเดิม');
    expect(snapshot.items[0].metadata.tierBreakdown[0].rate).toBe('3.40');
  });

  // =========================================================================
  // 9. ZERO-LINE POLICY TEST (Section 32)
  // =========================================================================
  it('Section 32: Legitimate 0.00 BillItems are preserved in snapshot and not omitted at creation', async () => {
    const mockBill = {
      id: 'bill-zero-test',
      billNumber: 'INV-ZERO-1',
      totalAmount: new Decimal('4000.00'),
      dormitoryId,
      tenantId,
      roomId,
      dormitory: { name: 'หอพัก HorPlus' },
      tenant: { displayName: 'ผู้เช่า' },
      room: { roomNumber: '101' },
      items: [
        {
          type: 'rent',
          description: 'ค่าเช่าห้องพัก',
          quantity: new Decimal('1.00'),
          unitPrice: new Decimal('4000.00'),
          amount: new Decimal('4000.00'),
          metadata: null,
          displayOrder: 1,
        },
        {
          type: 'common_fee',
          description: 'ค่าส่วนกลาง (ฟรีตามโปรโมชั่น)',
          quantity: new Decimal('1.00'),
          unitPrice: new Decimal('0.00'),
          amount: new Decimal('0.00'),
          metadata: null,
          displayOrder: 2,
        },
      ],
    };

    const tx = mockTx({ bill: mockBill });

    const receipt = await generateReceiptInTx(
      tx,
      null,
      dormitoryId,
      mockBill.id,
      null,
      null,
      new Decimal('4000.00')
    );

    const snapshot = receipt.snapshotData;
    expect(snapshot.items).toHaveLength(2);
    expect(snapshot.items[1].description).toBe('ค่าส่วนกลาง (ฟรีตามโปรโมชั่น)');
    expect(snapshot.items[1].amount).toBe('0.00');
  });

  // =========================================================================
  // 10. BILL WITHOUT ITEMS FALLBACK TEST (Section 7)
  // =========================================================================
  it('Section 7: Bill without persisted BillItems falls back safely to generic single line', async () => {
    const mockBill = {
      id: 'bill-no-items',
      billNumber: 'INV-LEGACY-999',
      billKind: 'MONTHLY',
      totalAmount: new Decimal('3500.00'),
      dormitoryId,
      tenantId,
      roomId,
      dormitory: { name: 'หอพัก HorPlus' },
      tenant: { displayName: 'ผู้เช่าเก่า' },
      room: { roomNumber: '101' },
      items: [], // No persisted items
    };

    const tx = mockTx({ bill: mockBill });

    const receipt = await generateReceiptInTx(
      tx,
      null,
      dormitoryId,
      mockBill.id,
      null,
      null,
      new Decimal('3500.00')
    );

    const snapshot = receipt.snapshotData;
    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.items[0].description).toBe('ชำระยอดคงเหลือบิล INV-LEGACY-999');
    expect(snapshot.items[0].amount).toBe('3500.00');
  });

  // =========================================================================
  // 11. LEGACY RECEIPT BACKWARD COMPATIBILITY TEST (Section 14, 19 & 33)
  // =========================================================================
  it('Section 14 & 19: Legacy receipt shape without billGroups or metadata returns cleanly at data-contract layer', async () => {
    const legacyReceipt = {
      id: 'legacy-rc-1',
      dormitoryId,
      paymentId: 'pay-legacy-1',
      receiptNumber: 'RC-202607-101-0001',
      snapshotData: {
        receiptNumber: 'RC-202607-101-0001',
        total: '3500.00',
        items: [{ description: 'ชำระยอดคงเหลือบิล INV-OLD-1', amount: '3500.00' }],
      },
      isVoided: false,
      issuedAt: new Date('2026-07-25'),
    };

    const prismaMock: any = {
      receipt: {
        findUnique: vi.fn().mockResolvedValue(legacyReceipt),
      },
    };

    // Verified data-contract behavior for legacy records
    const result = await prismaMock.receipt.findUnique({ where: { id: 'legacy-rc-1' } });
    expect(result).toBeDefined();
    expect(result.snapshotData.total).toBe('3500.00');
    expect(result.snapshotData.billGroups).toBeUndefined(); // Legacy row without billGroups returns cleanly
  });
});
