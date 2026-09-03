/**
 * @license Apache-2.0
 * OWNER ROUND 2.4K.4: Receiver Snapshot Authority & Same-Cycle Consolidation Test Suite
 */

import { describe, it, expect, vi } from 'vitest';
import { Decimal } from 'decimal.js';
import {
  generateFinalSettlementReceiptForBillInTx,
  generateFinalSettlementReceiptForDailyInvoiceInTx,
} from '../utils/payment-transaction.util.js';
import {
  renderReceiptHtml,
  formatThaiBillingCycle,
} from '../utils/receipt-html.util.js';

describe('Owner Round 2.4K.4 — Receiver Snapshot Authority (Sections 6 & 28)', () => {
  const baseDormitoryId = '11111111-1111-1111-1111-111111111111';
  const validBillId = '22222222-2222-2222-2222-222222222222';
  const validRoomId = '33333333-3333-3333-3333-333333333333';
  const validCycleId = '44444444-4444-4444-4444-444444444444';

  function createMockTx(billingSettings: { bankAccountName: string | null; promptPayAccountName: string | null } | null) {
    let createdReceipt: any = null;

    const mockTx = {
      dormitoryBillingSettings: {
        findUnique: vi.fn().mockResolvedValue(billingSettings),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({ id: 'user-owner-001', name: 'Owner User' }),
      },
      receiptSequence: {
        upsert: vi.fn().mockResolvedValue({ lastValue: 10 }),
      },
      receipt: {
        findFirst: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockImplementation(({ data }) => {
          createdReceipt = data;
          return Promise.resolve({ id: 'rc-mock-01', ...data });
        }),
      },
      bill: {
        findUnique: vi.fn().mockResolvedValue({
          id: validBillId,
          dormitoryId: baseDormitoryId,
          roomId: validRoomId,
          billingCycleId: validCycleId,
          status: 'PAID',
          cancelledAt: null,
        }),
        findMany: vi.fn().mockResolvedValue([
          {
            id: validBillId,
            dormitoryId: baseDormitoryId,
            tenantId: '66666666-6666-6666-6666-666666666666',
            billNumber: 'INV-202608-01',
            totalAmount: new Decimal(4500),
            paidAmount: new Decimal(4500),
            outstandingAmount: new Decimal(0),
            status: 'PAID',
            cancelledAt: null,
            room: { roomNumber: '101', normalizedRoomNumber: '101' },
            tenant: { displayName: 'สมชาย ผู้เช่า' },
            dormitory: { name: 'สุขสบาย อพาร์ทเมนท์' },
            billingCycle: { cycleCode: '2026-08' },
            items: [
              { type: 'rent', description: 'ค่าเช่าห้อง', amount: new Decimal(4500), quantity: new Decimal(1), unit: 'month' },
            ],
            Payment: [
              { id: 'pay-01', amount: new Decimal(4500), method: 'CASH', status: 'APPROVED', reviewedAt: new Date() },
            ],
          },
        ]),
      },
    };

    return { mockTx, getCreatedReceipt: () => createdReceipt };
  }

  it('A. bankAccountName exists -> receiverName uses bankAccountName over promptPayAccountName', async () => {
    const { mockTx, getCreatedReceipt } = createMockTx({
      bankAccountName: 'บริษัท เอ บี ซี จำกัด',
      promptPayAccountName: 'นาย ก',
    });

    await generateFinalSettlementReceiptForBillInTx(
      mockTx as any,
      {
        billId: validBillId,
        dormitoryId: baseDormitoryId,
        userId: 'user-owner-001',
      }
    );

    const receipt = getCreatedReceipt();
    expect(receipt).toBeDefined();
    expect(receipt.snapshotData.receiverName).toBe('บริษัท เอ บี ซี จำกัด');
    expect(receipt.issuedByUserId).toBe('user-owner-001');

    const html = renderReceiptHtml(receipt);
    expect(html).toContain('<p><strong>ผู้รับเงิน:</strong> บริษัท เอ บี ซี จำกัด</p>');
    expect(html).not.toContain('ผู้รับเงิน / หอพัก');
    expect(html).not.toContain('นาย ก');
    expect(html).not.toContain('Owner User');
  });

  it('B. bankAccountName is missing/blank -> receiverName falls back to promptPayAccountName', async () => {
    const { mockTx, getCreatedReceipt } = createMockTx({
      bankAccountName: '   ',
      promptPayAccountName: 'นาย ก',
    });

    await generateFinalSettlementReceiptForBillInTx(
      mockTx as any,
      {
        billId: validBillId,
        dormitoryId: baseDormitoryId,
        userId: 'user-owner-001',
      }
    );

    const receipt = getCreatedReceipt();
    expect(receipt.snapshotData.receiverName).toBe('นาย ก');

    const html = renderReceiptHtml(receipt);
    expect(html).toContain('<p><strong>ผู้รับเงิน:</strong> นาย ก</p>');
  });

  it('C. both bankAccountName and promptPayAccountName are missing -> receiverName is null and displays ....................', async () => {
    const { mockTx, getCreatedReceipt } = createMockTx({
      bankAccountName: null,
      promptPayAccountName: '',
    });

    await generateFinalSettlementReceiptForBillInTx(
      mockTx as any,
      {
        billId: validBillId,
        dormitoryId: baseDormitoryId,
        userId: 'user-owner-001',
      }
    );

    const receipt = getCreatedReceipt();
    expect(receipt.snapshotData.receiverName).toBeNull();

    const html = renderReceiptHtml(receipt);
    expect(html).toContain('<p><strong>ผู้รับเงิน:</strong> ....................</p>');
    expect(html).not.toContain('สุขสบาย อพาร์ทเมนท์</p>'); // receiver line does NOT fallback to dormitoryName!
  });

  it('D. Immutable snapshot: Changing billing settings later does NOT change existing receipt snapshot', async () => {
    const { mockTx, getCreatedReceipt } = createMockTx({
      bankAccountName: 'ชื่อเดิมตอนออกใบเสร็จ',
      promptPayAccountName: null,
    });

    await generateFinalSettlementReceiptForBillInTx(
      mockTx as any,
      {
        billId: validBillId,
        dormitoryId: baseDormitoryId,
        userId: 'user-owner-001',
      }
    );

    const receipt = getCreatedReceipt();
    expect(receipt.snapshotData.receiverName).toBe('ชื่อเดิมตอนออกใบเสร็จ');

    // Simulate settings updated in database later
    mockTx.dormitoryBillingSettings.findUnique.mockResolvedValue({
      bankAccountName: 'ชื่อใหม่หลังแก้ไข',
      promptPayAccountName: null,
    });

    // Re-rendering existing receipt html uses immutable snapshotData
    const html = renderReceiptHtml(receipt);
    expect(html).toContain('ชื่อเดิมตอนออกใบเสร็จ');
    expect(html).not.toContain('ชื่อใหม่หลังแก้ไข');
  });

  it('E. User recording cash has name "Owner User" -> receiverName is bank account name, NOT "Owner User"', async () => {
    const { mockTx, getCreatedReceipt } = createMockTx({
      bankAccountName: 'ABC Account',
      promptPayAccountName: null,
    });

    await generateFinalSettlementReceiptForBillInTx(
      mockTx as any,
      {
        billId: validBillId,
        dormitoryId: baseDormitoryId,
        userId: 'user-owner-001',
      }
    );

    const receipt = getCreatedReceipt();
    expect(receipt.snapshotData.receiverName).toBe('ABC Account');
    expect(receipt.snapshotData.receiverName).not.toBe('Owner User');
    expect(receipt.issuedByUserId).toBe('user-owner-001'); // Audit trail intact
  });

  it('F. Daily Final Receipt applies identical receiver resolution', async () => {
    let createdReceipt: any = null;
    const validInvoiceId = '55555555-5555-5555-5555-555555555555';
    const mockDailyTx = {
      dormitoryBillingSettings: {
        findUnique: vi.fn().mockResolvedValue({
          bankAccountName: 'เจ้าของหอพักรายวัน',
          promptPayAccountName: 'พร้อมเพย์สำรอง',
        }),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({ id: 'user-002', name: 'Cashier Staff' }),
      },
      receiptSequence: {
        upsert: vi.fn().mockResolvedValue({ lastValue: 5 }),
      },
      receipt: {
        findFirst: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockImplementation(({ data }) => {
          createdReceipt = data;
          return Promise.resolve({ id: 'rc-daily-01', ...data });
        }),
      },
      dailyStayInvoice: {
        findUnique: vi.fn().mockResolvedValue({
          id: validInvoiceId,
          dormitoryId: baseDormitoryId,
          invoiceNumber: 'DINV-202609-001',
          totalAgreedAmount: new Decimal(1200),
          outstandingAmount: new Decimal(0),
          status: 'PAID',
          issuedAt: new Date(),
          dailyStay: {
            room: { roomNumber: '105', normalizedRoomNumber: '105' },
            dormitory: { id: baseDormitoryId, name: 'หอพักรายวัน HorPlus' },
            applicantFullName: 'ผู้พักรายวัน ใจดี',
          },
          items: [
            { id: 'item-daily-01', itemType: 'DAILY_RENT', description: 'ค่าเช่ารายวัน', amount: new Decimal(1200), quantity: new Decimal(1), status: 'SETTLED' },
          ],
          payments: [
            { id: 'dpay-01', amount: new Decimal(1200), method: 'CASH', status: 'SETTLED', recordedAt: new Date() },
          ],
        }),
      },
      payment: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'dpay-01',
            amount: new Decimal(1200),
            method: 'CASH',
            status: 'APPROVED',
            createdAt: new Date(),
          },
        ]),
      },
      paymentAllocation: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'alloc-01',
            billId: null,
            billItemId: null,
            dailyStayInvoiceId: validInvoiceId,
            dailyStayInvoiceItemId: 'item-daily-01',
            paymentId: 'dpay-01',
            allocatedAmount: new Decimal(1200),
            payment: {
              id: 'dpay-01',
              method: 'CASH',
              status: 'APPROVED',
            },
          },
        ]),
      },
    };

    await generateFinalSettlementReceiptForDailyInvoiceInTx(
      mockDailyTx as any,
      {
        dailyStayInvoiceId: validInvoiceId,
        dormitoryId: baseDormitoryId,
        userId: 'user-002',
      }
    );

    expect(createdReceipt).toBeDefined();
    expect(createdReceipt.snapshotData.receiverName).toBe('เจ้าของหอพักรายวัน');
    expect(createdReceipt.issuedByUserId).toBe('user-002');
  });
});

describe('Owner Round 2.4K.4 — Same Billing Cycle Presentation & Thai Formatting (Sections 9, 10 & 29)', () => {
  it('A. formatThaiBillingCycle converts YYYY-MM to full Thai month and Buddhist Era year', () => {
    expect(formatThaiBillingCycle('2026-01')).toBe('มกราคม 2569');
    expect(formatThaiBillingCycle('2026-08')).toBe('สิงหาคม 2569');
    expect(formatThaiBillingCycle('2026-12')).toBe('ธันวาคม 2569');
  });

  it('B. formatThaiBillingCycle returns raw string safely on non-matching or malformed input', () => {
    expect(formatThaiBillingCycle('INVALID-CYCLE')).toBe('INVALID-CYCLE');
    expect(formatThaiBillingCycle('2026-13')).toBe('2026-13');
    expect(formatThaiBillingCycle('')).toBe('');
    expect(formatThaiBillingCycle(null)).toBe('');
    expect(formatThaiBillingCycle(undefined)).toBe('');
  });

  it('C. Same cycleCode across RENT + DEPOSIT + UTILITY renders inside ONE visual box titled "รอบบิล สิงหาคม 2569"', () => {
    const originalBillGroups = [
      {
        billId: 'bill-rent',
        billNumber: 'INV-202608-RENT',
        cycleCode: '2026-08',
        billKind: 'RENT',
        billTotal: '4000.00',
        paidAmount: '4000.00',
        items: [
          { type: 'rent', description: 'ค่าเช่าห้องพัก', quantity: '1', unitPrice: '4000.00', amount: '4000.00' },
        ],
      },
      {
        billId: 'bill-deposit',
        billNumber: 'INV-202608-DEP',
        cycleCode: '2026-08',
        billKind: 'DEPOSIT',
        billTotal: '5000.00',
        paidAmount: '5000.00',
        items: [
          { type: 'deposit', description: 'เงินประกันสัญญาเช่า', quantity: '1', unitPrice: '5000.00', amount: '5000.00' },
        ],
      },
      {
        billId: 'bill-util',
        billNumber: 'INV-202608-UTIL',
        cycleCode: '2026-08',
        billKind: 'MONTHLY',
        billTotal: '550.00',
        paidAmount: '550.00',
        items: [
          { type: 'water', description: 'ค่าน้ำประปา', quantity: '10', unitPrice: '20.00', amount: '200.00' },
          { type: 'electricity', description: 'ค่าไฟฟ้า', quantity: '50', unitPrice: '7.00', amount: '350.00' },
        ],
      },
    ];

    const receiptRecord = {
      id: 'rc-final-combined-01',
      receiptNumber: 'RC-202608-101-0001',
      issuedAt: new Date('2026-08-31T12:00:00Z'),
      receiptKind: 'FINAL_SETTLEMENT',
      isFinalSettlement: true,
      snapshotData: {
        isCombinedReceipt: true,
        isFinalSettlement: true,
        receiverName: 'บริษัท พลัส พร็อพเพอร์ตี้ จำกัด',
        tenantName: 'สมใจ สุขสบาย',
        roomNumber: '101',
        total: '9550.00',
        paymentMethod: 'CASH',
        billGroups: originalBillGroups,
      },
    };

    const html = renderReceiptHtml(receiptRecord);

    // Assert exactly ONE visual cycle container exists
    const groupBoxOccurrences = html.split('<div class="group-box">').length - 1;
    expect(groupBoxOccurrences).toBe(1);

    // Title contains full Thai month and Buddhist year
    expect(html).toContain('รอบบิล สิงหาคม 2569');

    // All bill numbers present in the header
    expect(html).toContain('INV-202608-RENT');
    expect(html).toContain('INV-202608-DEP');
    expect(html).toContain('INV-202608-UTIL');

    // All items rendered sequentially
    expect(html).toContain('ค่าเช่าห้องพัก');
    expect(html).toContain('เงินประกันสัญญาเช่า');
    expect(html).toContain('ค่าน้ำ');
    expect(html).toContain('ค่าไฟฟ้า');

    // Summed totals in footer: Bill Total = 4000 + 5000 + 550 = 9550.00
    expect(html).toContain('9550.00 ฿');

    // Immutable snapshot remains length 3
    expect(originalBillGroups).toHaveLength(3);
    expect(receiptRecord.snapshotData.billGroups).toHaveLength(3);
  });

  it('D. Different cycle codes render into distinct separate visual containers', () => {
    const receiptRecord = {
      id: 'rc-multi-cycle-01',
      receiptNumber: 'RC-MULTI-0001',
      issuedAt: new Date('2026-09-01T10:00:00Z'),
      receiptKind: 'FINAL_SETTLEMENT',
      isFinalSettlement: true,
      snapshotData: {
        isCombinedReceipt: true,
        isFinalSettlement: true,
        receiverName: 'หอพัก ตัวอย่าง',
        total: '7000.00',
        paymentMethod: 'CASH',
        billGroups: [
          {
            billId: 'bill-july',
            billNumber: 'INV-202607-01',
            cycleCode: '2026-07',
            billTotal: '3500.00',
            paidAmount: '3500.00',
            items: [{ description: 'ค่าเช่า ก.ค.', amount: '3500.00' }],
          },
          {
            billId: 'bill-aug',
            billNumber: 'INV-202608-01',
            cycleCode: '2026-08',
            billTotal: '3500.00',
            paidAmount: '3500.00',
            items: [{ description: 'ค่าเช่า ส.ค.', amount: '3500.00' }],
          },
        ],
      },
    };

    const html = renderReceiptHtml(receiptRecord);
    const groupBoxOccurrences = html.split('<div class="group-box">').length - 1;
    expect(groupBoxOccurrences).toBe(2);

    expect(html).toContain('รอบบิล กรกฎาคม 2569');
    expect(html).toContain('รอบบิล สิงหาคม 2569');
  });
});
