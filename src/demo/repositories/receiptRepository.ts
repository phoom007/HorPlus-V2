/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Receipt } from '../../types';
import { getStored, setStored, addAuditLog, getBills } from '../../data/mockData';

const RECEIPTS_KEY = 'receipts';

export const receiptRepository = {
  getAll: (): Receipt[] => {
    return getStored<Receipt[]>(RECEIPTS_KEY, []);
  },

  getById: (id: string): Receipt | undefined => {
    return receiptRepository.getAll().find(r => r.id === id);
  },

  getByBillId: (billId: string): Receipt | undefined => {
    return receiptRepository.getAll().find(r => r.billId === billId);
  },

  generateReceipt: (
    billId: string,
    paymentId: string,
    paymentMethod: 'promptpay' | 'cash',
    totalAmount: number,
    actorUserId = 'user-owner'
  ): { success: boolean; receipt?: Receipt; message?: string } => {
    // Idempotency check: Return existing if generated
    const existing = receiptRepository.getByBillId(billId);
    if (existing) {
      return { success: true, receipt: existing };
    }

    const receipts = receiptRepository.getAll();
    const bill = getBills().find(b => b.id === billId);
    const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const num = String(receipts.length + 1).padStart(4, '0');

    const newReceipt: Receipt = {
      id: `rcpt-${Date.now()}`,
      receiptNumber: `RCPT-${dateStr}-${num}`,
      billId,
      paymentId,
      paymentMethod,
      totalAmount,
      paidAt: new Date().toISOString(),
      receiverName: actorUserId === 'user-finance' ? 'ฝ่ายการเงิน' : 'เจ้าของระบบ HorPlus',
      createdAt: new Date().toISOString()
    };

    receipts.unshift(newReceipt);
    setStored(RECEIPTS_KEY, receipts);

    addAuditLog(actorUserId, 'ออกใบเสร็จรับเงิน', `ออกใบเสร็จเลขที่ ${newReceipt.receiptNumber} สำหรับบิล ${bill?.billNumber || billId}`, 'Receipt', newReceipt.id);

    return { success: true, receipt: newReceipt };
  }
};
