import { getPrismaClient } from '../db/prisma.js';
import { compareDecimals } from '../utils/decimal-math.util.js';

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
    const prisma = getPrismaClient();
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
    const checkingPayment: any[] = [];

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

    if (latestBill.status === 'paid' || compareDecimals(latestBill.outstandingAmount, '0.00') <= 0) {
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

  async getTenantRoomBillingState(
    dormitoryId: string,
    roomId: string,
    tenantId: string,
    asOfDate: Date = new Date()
  ): Promise<RoomBillingStateSummary> {
    const prisma = getPrismaClient();
    const contracts = await prisma.contract.findMany({
      where: { tenantId, dormitoryId },
      select: { id: true }
    });
    const contractIds = contracts.map((c) => c.id);

    const activeBills = await prisma.bill.findMany({
      where: {
        dormitoryId,
        roomId,
        status: { not: 'cancelled' },
        OR: [
          { tenantId },
          ...(contractIds.length > 0 ? [{ contractId: { in: contractIds } }] : [])
        ]
      },
      include: {
        billingCycle: true
      },
      orderBy: { createdAt: 'desc' }
    });

    const { isBillVisibleToTenant } = await import('../utils/tenant-visibility.util.js');
    const visibleBills = activeBills.filter((b) => isBillVisibleToTenant(b, asOfDate));

    if (visibleBills.length === 0) {
      return {
        state: 'no_bill',
        outstandingAmount: '0.00',
        statusText: 'ไม่มีรายการค้างชำระ'
      };
    }

    // Authoritative current financial obligation ordering:
    // 1. billingCycle.periodStart DESC
    // 2. billingDate DESC
    // 3. createdAt DESC
    visibleBills.sort((a, b) => {
      const aPeriodStart = a.billingCycle?.periodStart ? new Date(a.billingCycle.periodStart).getTime() : 0;
      const bPeriodStart = b.billingCycle?.periodStart ? new Date(b.billingCycle.periodStart).getTime() : 0;
      if (aPeriodStart !== bPeriodStart) {
        return bPeriodStart - aPeriodStart;
      }
      const aBillingDate = a.billingDate ? new Date(a.billingDate).getTime() : 0;
      const bBillingDate = b.billingDate ? new Date(b.billingDate).getTime() : 0;
      if (aBillingDate !== bBillingDate) {
        return bBillingDate - aBillingDate;
      }
      const aCreatedAt = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bCreatedAt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bCreatedAt - aCreatedAt;
    });

    const latestBill = visibleBills[0];

    if (latestBill.status === 'checking') {
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

    if (latestBill.status === 'paid' || compareDecimals(latestBill.outstandingAmount, '0.00') <= 0) {
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

    const isOverdue = latestBill.status === 'overdue' || (latestBill.dueDate && latestBill.dueDate < asOfDate);

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
