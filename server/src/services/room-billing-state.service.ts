import { prisma } from '../db/prisma.js';

export type RoomBillingState = 'no_bill' | 'pending_payment' | 'checking_payment' | 'paid' | 'overdue';

export interface RoomBillingStateSummary {
  state: RoomBillingState;
  currentBillId?: string;
  billNumber?: string;
  outstandingAmount: string;
  totalAmount?: string;
  dueDate?: Date;
  statusText: string;
}

export class RoomBillingStateService {
  async getRoomBillingState(dormitoryId: string, roomId: string): Promise<RoomBillingStateSummary> {
    const activeBills = await prisma.bill.findMany({
      where: {
        dormitoryId,
        roomId,
        status: { not: 'cancelled' }
      },
      orderBy: { createdAt: 'desc' }
    });

    if (activeBills.length === 0) {
      return {
        state: 'no_bill',
        outstandingAmount: '0.00',
        statusText: 'ไม่มีรายการค้างชำระ'
      };
    }

    const latestBill = activeBills[0];

    // Check if there are any payments pending verification (checking) for this room/bill
    const checkingPayment = await prisma.payment.findFirst({
      where: {
        dormitoryId,
        billId: latestBill.id,
        status: 'checking'
      }
    });

    if (latestBill.status === 'checking' || checkingPayment) {
      return {
        state: 'checking_payment',
        currentBillId: latestBill.id,
        billNumber: latestBill.billNumber,
        outstandingAmount: latestBill.outstandingAmount.toString(),
        totalAmount: latestBill.totalAmount.toString(),
        dueDate: latestBill.dueDate,
        statusText: 'กำลังตรวจสอบการชำระเงิน'
      };
    }

    if (latestBill.status === 'paid' || parseFloat(latestBill.outstandingAmount.toString()) <= 0) {
      return {
        state: 'paid',
        currentBillId: latestBill.id,
        billNumber: latestBill.billNumber,
        outstandingAmount: '0.00',
        totalAmount: latestBill.totalAmount.toString(),
        dueDate: latestBill.dueDate,
        statusText: 'ชำระแล้ว'
      };
    }

    const now = new Date();
    const isOverdue = latestBill.status === 'overdue' || (latestBill.dueDate && latestBill.dueDate < now);

    if (isOverdue) {
      return {
        state: 'overdue',
        currentBillId: latestBill.id,
        billNumber: latestBill.billNumber,
        outstandingAmount: latestBill.outstandingAmount.toString(),
        totalAmount: latestBill.totalAmount.toString(),
        dueDate: latestBill.dueDate,
        statusText: 'เกินกำหนดชำระ'
      };
    }

    return {
      state: 'pending_payment',
      currentBillId: latestBill.id,
      billNumber: latestBill.billNumber,
      outstandingAmount: latestBill.outstandingAmount.toString(),
      totalAmount: latestBill.totalAmount.toString(),
      dueDate: latestBill.dueDate,
      statusText: 'รอชำระเงิน'
    };
  }
}

export const roomBillingStateService = new RoomBillingStateService();
