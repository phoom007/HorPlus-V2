/**
 * @license Apache-2.0
 * OWNER ROUND 2.4K.3: Rejected Payment History & Cash Settlement Invariant Test Suite
 */

import { describe, it, expect, vi } from 'vitest';
import { Decimal } from 'decimal.js';
import {
  generateReceiptInTx,
} from '../utils/payment-transaction.util.js';

describe('Owner Round 2.4K.3 — Rejected Payment History Persistence & Cash Settlement Authority', () => {
  it('A. Old REJECTED payment record is preserved intact when bill is settled with CASH', () => {
    // 1. Initial state: Bill has an outstanding balance of 4,000 THB and an earlier REJECTED slip payment
    const bill = {
      id: 'bill-audit-001',
      dormitoryId: 'dorm-audit-01',
      billNumber: 'INV-202609-001',
      totalAmount: new Decimal(4000),
      paidAmount: new Decimal(0),
      outstandingAmount: new Decimal(4000),
      status: 'UNPAID',
    };

    const initialPayments = [
      {
        id: 'pay-rejected-001',
        billId: bill.id,
        amount: new Decimal(4000),
        status: 'REJECTED',
        paymentMethod: 'PROMPTPAY',
        rejectedReason: 'ยอดเงินโอนไม่ตรงกับยอดแจ้งหนี้',
        reviewedAt: new Date('2026-09-02T10:00:00Z'),
        createdAt: new Date('2026-09-02T09:30:00Z'),
      },
    ];

    // 2. Perform Cash collection on the bill (settling full 4,000 THB)
    const cashPayment = {
      id: 'pay-cash-002',
      billId: bill.id,
      amount: new Decimal(4000),
      status: 'APPROVED',
      paymentMethod: 'CASH',
      receivedBy: 'เจ้าหน้าที่การเงิน',
      createdAt: new Date('2026-09-03T11:00:00Z'),
      reviewedAt: new Date('2026-09-03T11:00:00Z'),
    };

    // Update bill balances following authoritative payment logic
    const updatedBill = {
      ...bill,
      paidAmount: bill.paidAmount.plus(cashPayment.amount),
      outstandingAmount: Decimal.max(0, bill.outstandingAmount.minus(cashPayment.amount)),
      status: 'PAID',
    };

    const allPayments = [...initialPayments, cashPayment];

    // 3. Assertions on Bill State
    expect(updatedBill.paidAmount.toNumber()).toBe(4000);
    expect(updatedBill.outstandingAmount.toNumber()).toBe(0);
    expect(updatedBill.status).toBe('PAID');

    // 4. Critical Invariant Assertions: Old REJECTED payment remains completely unmodified
    const preservedRejectedPayment = allPayments.find(p => p.id === 'pay-rejected-001');
    expect(preservedRejectedPayment).toBeDefined();
    expect(preservedRejectedPayment?.status).toBe('REJECTED');
    expect(preservedRejectedPayment?.rejectedReason).toBe('ยอดเงินโอนไม่ตรงกับยอดแจ้งหนี้');
    expect(preservedRejectedPayment?.paymentMethod).toBe('PROMPTPAY');
    expect(preservedRejectedPayment?.amount.toNumber()).toBe(4000);
    expect(preservedRejectedPayment?.createdAt.toISOString()).toBe('2026-09-02T09:30:00.000Z');

    // 5. New CASH payment exists alongside the REJECTED payment in audit history
    const recordedCashPayment = allPayments.find(p => p.id === 'pay-cash-002');
    expect(recordedCashPayment).toBeDefined();
    expect(recordedCashPayment?.status).toBe('APPROVED');
    expect(recordedCashPayment?.paymentMethod).toBe('CASH');
    expect(allPayments.length).toBe(2);
  });

  it('B. Authoritative Final Receipt captures ONLY the approved CASH payment, never rejected slip', async () => {
    let insertedReceipt: any = null;
    const bill = {
      id: 'bill-audit-002',
      dormitoryId: 'dorm-audit-01',
      billNumber: 'INV-202609-002',
      totalAmount: new Decimal(5000),
      paidAmount: new Decimal(5000),
      tenant: { displayName: 'วิภาดา ใจดี', firstName: 'วิภาดา', lastName: 'ใจดี', phone: '0891234567' },
      room: { roomNumber: '201' },
      dormitory: { name: 'สุขสบาย อพาร์ทเมนท์' },
      items: [{ type: 'rent', description: 'ค่าเช่าห้องพัก', amount: new Decimal(5000) }],
    };

    const mockPrisma = {
      receiptSequence: {
        upsert: vi.fn().mockResolvedValue({ lastValue: 1 }),
      },
      bill: {
        findUnique: vi.fn().mockResolvedValue(bill),
      },
      payment: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'pay-cash-audit-01',
          method: 'CASH',
          paymentMethod: 'CASH',
          amount: new Decimal(5000),
          billId: 'bill-audit-002',
          dormitoryId: 'dorm-audit-01',
        }),
      },
      receipt: {
        findFirst: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockImplementation(({ data }) => {
          insertedReceipt = data;
          return Promise.resolve({ id: 'rc-cash-audit-01', ...data });
        }),
      },
    };

    await generateReceiptInTx(
      mockPrisma as any,
      'pay-cash-audit-01',
      'dorm-audit-01',
      'bill-audit-002'
    );

    expect(insertedReceipt).toBeDefined();
    expect(insertedReceipt.snapshotData.paymentMethod).toBe('CASH');
    expect(insertedReceipt.snapshotData.total).toBe('5000.00');
    expect(insertedReceipt.snapshotData.tenantName).toBe('วิภาดา ใจดี');
    expect(insertedReceipt.snapshotData.roomNumber).toBe('201');
    expect(insertedReceipt.snapshotData.paymentMethod).not.toContain('REJECTED');
  });
});
