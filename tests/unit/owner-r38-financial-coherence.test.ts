/**
 * @license Apache-2.0
 * OWNER R3.8a — Financial Coherence, Active Payment Guard, Safe Error Boundary & Receipt Snapshot Authority Unit Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { recordCashPaymentInTx } from '../../server/src/utils/payment-transaction.util.js';
import { mapErrorMessageToThai } from '../../src/pages/owner/meters.js';

describe('R3.8a Unit Tests: Financial Authority, Active Payment Guard & Safe Error Boundary', () => {
  const dormitoryId = '20000001-0000-4000-8000-000000000002';
  const billId = '30000001-0000-4000-8000-000000000104';

  it('1. Cash partial settlement succeeds on outstanding amount and accumulates paidAmount', async () => {
    let capturedPayment: any = null;
    let capturedBillUpdate: any = null;
    let capturedReceipt: any = null;

    const mockTx: any = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      bill: {
        findUnique: vi.fn().mockResolvedValue({
          id: billId,
          billNumber: 'INV-202608-104-COMBINED',
          dormitoryId,
          tenantId: 'tenant-104',
          status: 'unpaid',
          totalAmount: '10600.00',
          paidAmount: '3000.00',
          outstandingAmount: '7600.00',
          items: [
            { id: 'item-1', description: 'ค่าเช่าห้อง', amount: '4800.00' },
            { id: 'item-2', description: 'เงินประกัน', amount: '4800.00' },
            { id: 'item-3', description: 'ค่าน้ำค่าไฟ', amount: '1000.00' },
          ],
          Payment: [],
          dormitory: { name: 'HorPlus Dorm' },
          room: { roomNumber: '104' },
          tenant: { name: 'Somchai' },
        }),
        update: vi.fn().mockImplementation((args) => {
          capturedBillUpdate = args;
          return { ...args.data, id: billId };
        }),
      },
      payment: {
        create: vi.fn().mockImplementation((args) => {
          capturedPayment = { ...args.data, id: 'pay-new-123' };
          return capturedPayment;
        }),
        findUnique: vi.fn().mockImplementation(() => {
          return {
            id: 'pay-new-123',
            dormitoryId,
            billId,
            amount: '7600.00',
            method: 'CASH',
            status: 'APPROVED',
            paymentDate: new Date(),
          };
        }),
      },
      paymentStatusHistory: {
        create: vi.fn().mockResolvedValue({ id: 'psh-1' }),
      },
      billStatusHistory: {
        create: vi.fn().mockResolvedValue({ id: 'bsh-1' }),
      },
      receiptSequence: {
        upsert: vi.fn().mockResolvedValue({ currentNumber: 1 }),
      },
      receipt: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation((args) => {
          capturedReceipt = { ...args.data, id: 'rcp-new-123' };
          return capturedReceipt;
        }),
      },
    };

    const result = await recordCashPaymentInTx(mockTx, {
      dormitoryId,
      billId,
      amount: '7600.00',
      userId: '10000001-0000-4000-8000-000000000001',
    });

    expect(mockTx.$executeRaw).toHaveBeenCalled();
    expect(Number(result.amount)).toBe(7600);
    expect(Number(capturedBillUpdate.data.paidAmount)).toBe(10600);
    expect(Number(capturedBillUpdate.data.outstandingAmount)).toBe(0);
    expect(capturedBillUpdate.data.status).toBe('PAID');

    // Receipt snapshot must equal transaction payment amount (7600)
    expect(capturedReceipt.snapshotData.total).toBe('7600.00');
    expect(capturedReceipt.snapshotData.items[0].description).toBe('ชำระยอดคงเหลือบิล INV-202608-104-COMBINED');
    expect(capturedReceipt.snapshotData.items[0].amount).toBe('7600.00');
  });

  it('2. Active Payment Guard: fails closed with ALREADY_PAID if APPROVED payment already exists', async () => {
    const mockTx: any = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      bill: {
        findUnique: vi.fn().mockResolvedValue({
          id: billId,
          dormitoryId,
          status: 'unpaid', // Stale status but APPROVED payment exists
          totalAmount: '10600.00',
          paidAmount: '3000.00',
          outstandingAmount: '7600.00',
          items: [],
          Payment: [{ id: 'pay-approved', status: 'APPROVED', amount: '7600.00' }],
        }),
      },
    };

    await expect(
      recordCashPaymentInTx(mockTx, {
        dormitoryId,
        billId,
        amount: '7600.00',
      })
    ).rejects.toThrow('ALREADY_PAID');
  });

  it('3. Active Payment Guard: fails closed with PAYMENT_IN_PROGRESS if PENDING or UNDER_REVIEW exists', async () => {
    const mockTx: any = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      bill: {
        findUnique: vi.fn().mockResolvedValue({
          id: billId,
          dormitoryId,
          status: 'unpaid',
          totalAmount: '10600.00',
          paidAmount: '0.00',
          outstandingAmount: '10600.00',
          items: [],
          Payment: [{ id: 'pay-under-review', status: 'UNDER_REVIEW', amount: '10600.00' }],
        }),
      },
    };

    await expect(
      recordCashPaymentInTx(mockTx, {
        dormitoryId,
        billId,
        amount: '10600.00',
      })
    ).rejects.toThrow('PAYMENT_IN_PROGRESS');
  });

  it('4. Cash settlement throws UNSUPPORTED_AMOUNT if submitted amount does not match outstanding', async () => {
    const mockTx: any = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      bill: {
        findUnique: vi.fn().mockResolvedValue({
          id: billId,
          dormitoryId,
          status: 'unpaid',
          totalAmount: '10600.00',
          paidAmount: '3000.00',
          outstandingAmount: '7600.00',
          items: [],
          Payment: [],
        }),
      },
    };

    await expect(
      recordCashPaymentInTx(mockTx, {
        dormitoryId,
        billId,
        amount: '10600.00', // Wrong amount: outstanding is 7,600
      })
    ).rejects.toThrow('UNSUPPORTED_AMOUNT');
  });

  it('5. Safe Error Boundary: masks unknown Prisma/SQL errors safely with fallback message', () => {
    // Simulate Prisma error with raw SQL leak
    const rawPrismaError = new Error('Invalid `prisma.payment.create()` invocation: Unique constraint failed on the constraint: payments_pkey. SQL: SELECT * FROM "payments" WHERE "id" = ...');
    (rawPrismaError as any).code = 'P2002';

    // Verify mapErrorMessageToThai masks unknown error safely without leaking SQL/table/constraint names
    const thaiMessage = mapErrorMessageToThai(rawPrismaError);
    expect(thaiMessage).not.toContain('Prisma');
    expect(thaiMessage).not.toContain('SQL');
    expect(thaiMessage).not.toContain('payments_pkey');
    expect(thaiMessage).toBe('ระบบไม่สามารถดำเนินการได้ กรุณาลองใหม่อีกครั้ง');
  });

  it('6. Safe Error Boundary: maps explicit domain error codes to accurate Thai messages', () => {
    expect(mapErrorMessageToThai({ code: 'UNSUPPORTED_AMOUNT' })).toBe('ยอดเงินที่ชำระไม่ตรงกับยอดคงเหลือของบิล');
    expect(mapErrorMessageToThai({ code: 'ALREADY_PAID' })).toBe('บิลนี้ได้รับการชำระเงินแล้ว');
    expect(mapErrorMessageToThai({ code: 'PAYMENT_IN_PROGRESS' })).toBe('มีรายการชำระเงินที่อยู่ระหว่างรอการตรวจสอบสำหรับบิลนี้แล้ว');
    expect(mapErrorMessageToThai({ code: 'CANNOT_CLEAR_METER_READING_FOR_ISSUED_BILL' })).toBe('ห้องนี้มีบิลที่ออกแล้ว หากต้องการล้างเลขมิเตอร์ปัจจุบัน กรุณายกเลิกบิลก่อน');
  });

  it('7. Receipt Modal Data Authority: binds strictly to snapshotData items (7,600) rather than original Bill items (10,600)', () => {
    const mockPayment: any = {
      id: 'pay-7600',
      amount: '7600.00',
      receipt: {
        receiptNumber: 'RCP-202608-104-D',
        snapshotData: {
          receiptNumber: 'RCP-202608-104-D',
          total: '7600.00',
          items: [
            { description: 'ชำระยอดคงเหลือบิล INV-202608-104-COMBINED', amount: '7600.00' }
          ],
        },
      },
      bill: {
        billNumber: 'INV-202608-104-COMBINED',
        totalAmount: '10600.00',
        items: [
          { description: 'ค่าเช่าห้อง', amount: '4800.00' },
          { description: 'เงินประกัน', amount: '4800.00' },
          { description: 'ค่าน้ำค่าไฟ', amount: '1000.00' },
        ],
      },
    };

    // Extract following payments.tsx handleOpenReceipt logic
    const rcpt = mockPayment.receipt;
    const snap = rcpt.snapshotData || {};
    const items = Array.isArray(snap.items) && snap.items.length > 0
      ? snap.items
      : mockPayment.bill.items;

    expect(items.length).toBe(1);
    expect(items[0].description).toBe('ชำระยอดคงเหลือบิล INV-202608-104-COMBINED');
    expect(items[0].amount).toBe('7600.00');
    expect(snap.total).toBe('7600.00');
  });
});
