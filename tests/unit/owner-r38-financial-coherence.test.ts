/**
 * Unit & Integration Test Suite for R3.8:
 * - Cash outstanding amount settlement & accumulation
 * - Accurate Receipt generation for partial payments
 * - HTTP Client Domain Code preservation
 * - Safe Thai error message mapping for domain errors
 * 
 * @license Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { recordCashPaymentInTx, generateReceiptInTx } from '../../server/src/utils/payment-transaction.util.js';
import { mapErrorMessageToThai } from '../../src/pages/owner/meters.js';

describe('R3.8 Cash Settlement Authority & Partial Bill Invariants', () => {
  const dormitoryId = '20000001-0000-4000-8000-000000000002';
  const userId = '10000001-0000-4000-8000-000000000001';

  it('1. Partial bill settlement succeeds when submitAmount === bill.outstandingAmount', async () => {
    const mockBill = {
      id: 'bill-104-combined',
      billNumber: 'INV-202608-104-COMBINED',
      dormitoryId,
      tenantId: 'tenant-104',
      status: 'partial',
      totalAmount: '10600.00',
      paidAmount: '3000.00',
      outstandingAmount: '7600.00',
      items: [
        { description: 'ค่าเช่าห้องพัก', amount: '4800.00' },
        { description: 'เงินประกันสัญญาเช่า', amount: '4800.00' },
        { description: 'ค่าน้ำ-ค่าไฟ', amount: '1000.00' },
      ],
      Payment: [],
    };

    let updatedBillData = null;
    let createdPaymentData = null;
    let createdReceiptData = null;

    const mockTx = {
      bill: {
        findUnique: vi.fn().mockResolvedValue(mockBill),
        update: vi.fn().mockImplementation(({ data }) => {
          updatedBillData = data;
          return { ...mockBill, ...data };
        }),
      },
      payment: {
        create: vi.fn().mockImplementation(({ data }) => {
          createdPaymentData = data;
          return { id: 'payment-104', ...data };
        }),
        findUnique: vi.fn().mockImplementation(({ where }) => {
          return { id: where.id, ...createdPaymentData };
        }),
      },
      paymentStatusHistory: {
        create: vi.fn().mockResolvedValue({ id: 'psh-1' }),
      },
      billStatusHistory: {
        create: vi.fn().mockResolvedValue({ id: 'bsh-1' }),
      },
      receiptSequence: {
        upsert: vi.fn().mockResolvedValue({ lastValue: 42 }),
      },
      receipt: {
        create: vi.fn().mockImplementation(({ data }) => {
          createdReceiptData = data;
          return { id: 'receipt-104', ...data };
        }),
      },
    };

    const payment = await recordCashPaymentInTx(mockTx, {
      dormitoryId,
      billId: mockBill.id,
      amount: '7600.00',
      userId,
    });

    expect(payment).toBeDefined();
    expect(Number(createdPaymentData.amount)).toBe(7600);
    expect(createdPaymentData.status).toBe('APPROVED');

    expect(updatedBillData.status).toBe('PAID');
    expect(Number(updatedBillData.paidAmount)).toBe(10600);
    expect(Number(updatedBillData.outstandingAmount)).toBe(0);

    expect(createdReceiptData.snapshotData.total).toBe('7600.00');
    expect(createdReceiptData.snapshotData.items[0].description).toContain('ชำระยอดคงเหลือบิล INV-202608-104-COMBINED');
    expect(createdReceiptData.snapshotData.items[0].amount).toBe('7600.00');
  });

  it('2. Cash settlement fails with UNSUPPORTED_AMOUNT when amount !== outstandingAmount', async () => {
    const mockBill = {
      id: 'bill-104-combined',
      dormitoryId,
      tenantId: 'tenant-104',
      status: 'partial',
      totalAmount: '10600.00',
      paidAmount: '3000.00',
      outstandingAmount: '7600.00',
      items: [],
      Payment: [],
    };

    const mockTx = {
      bill: {
        findUnique: vi.fn().mockResolvedValue(mockBill),
      },
    };

    await expect(
      recordCashPaymentInTx(mockTx, {
        dormitoryId,
        billId: mockBill.id,
        amount: '10600.00',
        userId,
      })
    ).rejects.toThrow('UNSUPPORTED_AMOUNT');

    await expect(
      recordCashPaymentInTx(mockTx, {
        dormitoryId,
        billId: mockBill.id,
        amount: '5000.00',
        userId,
      })
    ).rejects.toThrow('UNSUPPORTED_AMOUNT');
  });

  it('3. Cash settlement fails with ALREADY_PAID when bill is already paid', async () => {
    const mockBill = {
      id: 'bill-paid',
      dormitoryId,
      status: 'PAID',
      totalAmount: '4500.00',
      paidAmount: '4500.00',
      outstandingAmount: '0.00',
      items: [],
      Payment: [],
    };

    const mockTx = {
      bill: {
        findUnique: vi.fn().mockResolvedValue(mockBill),
      },
    };

    await expect(
      recordCashPaymentInTx(mockTx, {
        dormitoryId,
        billId: mockBill.id,
        amount: '4500.00',
        userId,
      })
    ).rejects.toThrow('ALREADY_PAID');
  });

  it('4. Cash settlement fails with PAYMENT_IN_PROGRESS when active review payment exists', async () => {
    const mockBill = {
      id: 'bill-pending',
      dormitoryId,
      status: 'unpaid',
      totalAmount: '4500.00',
      paidAmount: '0.00',
      outstandingAmount: '4500.00',
      items: [],
      Payment: [{ id: 'p-active', status: 'UNDER_REVIEW' }],
    };

    const mockTx = {
      bill: {
        findUnique: vi.fn().mockResolvedValue(mockBill),
      },
    };

    await expect(
      recordCashPaymentInTx(mockTx, {
        dormitoryId,
        billId: mockBill.id,
        amount: '4500.00',
        userId,
      })
    ).rejects.toThrow('PAYMENT_IN_PROGRESS');
  });
});

describe('R3.8 Domain Error Code Preservation & Thai Translation', () => {
  it('1. mapErrorMessageToThai accurately translates CANNOT_CLEAR_METER_READING_FOR_ISSUED_BILL', () => {
    const fromCode = mapErrorMessageToThai({ error: { code: 'CANNOT_CLEAR_METER_READING_FOR_ISSUED_BILL' } });
    expect(fromCode).toBe('ห้องนี้มีบิลที่ออกแล้ว หากต้องการล้างเลขมิเตอร์ปัจจุบัน กรุณายกเลิกบิลก่อน');

    const fromMessage = mapErrorMessageToThai('CANNOT_CLEAR_METER_READING_FOR_ISSUED_BILL');
    expect(fromMessage).toBe('ห้องนี้มีบิลที่ออกแล้ว หากต้องการล้างเลขมิเตอร์ปัจจุบัน กรุณายกเลิกบิลก่อน');
  });

  it('2. mapErrorMessageToThai accurately translates ROOM_LOCKED_PAID', () => {
    const fromCode = mapErrorMessageToThai({ error: { code: 'ROOM_LOCKED_PAID' } });
    expect(fromCode).toBe('บิลนี้ชำระเงินแล้ว ไม่สามารถยกเลิกหรือแก้ไขได้');
  });

  it('3. mapErrorMessageToThai preserves custom Thai error message from backend envelope', () => {
    const customThai = 'ยอดเงินที่ชำระไม่ตรงกับยอดคงเหลือของบิล';
    const result = mapErrorMessageToThai({ error: { code: 'UNSUPPORTED_AMOUNT', message: customThai } });
    expect(result).toBe(customThai);
  });
});
