/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { PaymentEvidence } from '../../types';
import { getStored, setStored, addAuditLog, addNotification, getBills, saveBills } from '../../data/mockData';
import { billingRepository } from './billingRepository';
import { receiptRepository } from './receiptRepository';

const PAYMENTS_KEY = 'payment_evidences';

export const paymentRepository = {
  getAll: (): PaymentEvidence[] => {
    return getStored<PaymentEvidence[]>(PAYMENTS_KEY, []);
  },

  getByBillId: (billId: string): PaymentEvidence | undefined => {
    return paymentRepository.getAll().find(p => p.billId === billId);
  },

  submitSlip: (
    billId: string,
    slipImage: string,
    senderName: string,
    amount: number,
    transferDateTime: string,
    memo?: string
  ): { success: boolean; payment?: PaymentEvidence; message?: string } => {
    const bill = billingRepository.getById(billId);
    if (!bill) {
      return { success: false, message: 'ไม่พบใบแจ้งหนี้' };
    }

    const payments = paymentRepository.getAll();
    const existingIdx = payments.findIndex(p => p.billId === billId);

    const newPayment: PaymentEvidence = {
      id: existingIdx >= 0 ? payments[existingIdx].id : `pay-${Date.now()}`,
      billId,
      slipImage,
      senderName,
      amount,
      transferDateTime,
      memo,
      status: 'pending',
      createdAt: new Date().toISOString()
    };

    if (existingIdx >= 0) {
      payments[existingIdx] = newPayment;
    } else {
      payments.unshift(newPayment);
    }

    setStored(PAYMENTS_KEY, payments);

    // Update Bill state to 'checking'
    billingRepository.updateBillStatus(billId, 'checking', 'tenant-user', {
      slipImage,
      paymentMethod: 'promptpay'
    });

    addAuditLog(bill.tenantId, 'ส่งสลิปชำระเงิน', `ผู้เช่าส่งสลิปชำระเงินสำหรับบิล ${bill.billNumber} ยอดเงิน ${amount.toLocaleString()} บาท`, 'PaymentEvidence', newPayment.id);

    addNotification('user-owner', 'แจ้งเตือนชำระเงินใหม่', `มีสลิปชำระเงินใหม่สำหรับบิล ${bill.billNumber} ยอด ${amount.toLocaleString()} บาท รอการตรวจสอบ`, 'slip_pending', billId);

    return { success: true, payment: newPayment };
  },

  approvePayment: (
    billId: string,
    actorUserId = 'user-owner'
  ): { success: boolean; receiptNumber?: string; message?: string } => {
    const bill = billingRepository.getById(billId);
    if (!bill) {
      return { success: false, message: 'ไม่พบใบแจ้งหนี้' };
    }

    const payments = paymentRepository.getAll();
    const payment = payments.find(p => p.billId === billId);

    if (payment) {
      payment.status = 'approved';
      payment.verifiedAt = new Date().toISOString();
      payment.verifiedBy = actorUserId;
      setStored(PAYMENTS_KEY, payments);
    }

    const nowIso = new Date().toISOString();
    billingRepository.updateBillStatus(billId, 'paid', actorUserId, { paidAt: nowIso });

    // Generate receipt
    const receiptResult = receiptRepository.generateReceipt(billId, payment?.id || `pay-${Date.now()}`, bill.paymentMethod || 'promptpay', bill.totalAmount, actorUserId);

    addAuditLog(actorUserId, 'อนุมัติสลิปชำระเงิน', `อนุมัติการชำระเงินบิล ${bill.billNumber} เรียบร้อยแล้ว`, 'PaymentEvidence', payment?.id || billId);

    addNotification(
      bill.tenantId,
      `ชำระเงินสำเร็จ (บิล ${bill.billNumber})`,
      `การชำระเงินสำหรับบิล ${bill.billNumber} ได้รับการอนุมัติแล้ว ออกใบเสร็จรับเงินเลขที่ ${receiptResult.receipt?.receiptNumber || ''} เรียบร้อยแล้ว`,
      'slip_approved',
      billId
    );

    return { success: true, receiptNumber: receiptResult.receipt?.receiptNumber };
  },

  rejectPayment: (
    billId: string,
    reason: string,
    actorUserId = 'user-owner'
  ): { success: boolean; message?: string } => {
    if (!reason || !reason.trim()) {
      return { success: false, message: 'กรุณาระบุเหตุผลในการปฏิเสธการชำระเงิน' };
    }

    const bill = billingRepository.getById(billId);
    if (!bill) {
      return { success: false, message: 'ไม่พบใบแจ้งหนี้' };
    }

    const payments = paymentRepository.getAll();
    const payment = payments.find(p => p.billId === billId);

    if (payment) {
      payment.status = 'rejected';
      payment.rejectReason = reason;
      payment.verifiedAt = new Date().toISOString();
      payment.verifiedBy = actorUserId;
      setStored(PAYMENTS_KEY, payments);
    }

    billingRepository.updateBillStatus(billId, 'rejected', actorUserId, { rejectReason: reason });

    addAuditLog(actorUserId, 'ปฏิเสธสลิปชำระเงิน', `ปฏิเสธสลิปบิล ${bill.billNumber} เหตุผล: ${reason}`, 'PaymentEvidence', payment?.id || billId);

    addNotification(
      bill.tenantId,
      `สลิปชำระเงินถูกปฏิเสธ (บิล ${bill.billNumber})`,
      `สลิปชำระเงินสำหรับบิล ${bill.billNumber} ถูกปฏิเสธเนื่องจาก: ${reason} กรุณาแนบสลิปใหม่`,
      'slip_rejected',
      billId
    );

    return { success: true };
  }
};
