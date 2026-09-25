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
  private prismaClient?: any;

  constructor(prismaClient?: any) {
    this.prismaClient = prismaClient;
  }

  private getPrisma() {
    return this.prismaClient || getPrismaClient();
  }

  async getRoomBillingState(dormitoryId: string, roomId: string): Promise<RoomBillingStateSummary> {
    const prisma = this.getPrisma();
    const activeBills = await prisma.bill.findMany({
      where: {
        dormitoryId,
        roomId,
        status: { not: 'cancelled' }
      },
      include: { Payment: true },
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
    const hasUnderReviewPayment = (latestBill.Payment || []).some(
      (p: any) => p.status === 'UNDER_REVIEW' || p.status === 'checking'
    );

    if (latestBill.status === 'checking' || hasUnderReviewPayment) {
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
    const prisma = this.getPrisma();
    const contracts = await prisma.contract.findMany({
      where: { tenantId, dormitoryId },
      select: { id: true }
    });
    const contractIds = contracts.map((c: any) => c.id);

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
        billingCycle: true,
        Payment: {
          select: { id: true, status: true, rejectedReason: true, createdAt: true },
          orderBy: { createdAt: 'desc' }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const { isBillVisibleToTenant } = await import('../utils/tenant-visibility.util.js');
    const visibleBills = activeBills.filter((b: any) => isBillVisibleToTenant(b, asOfDate));

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
    visibleBills.sort((a: any, b: any) => {
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

    const hasUnderReviewPayment = (latestBill.Payment || []).some(
      (p: any) => p.status === 'UNDER_REVIEW' || p.status === 'checking'
    );

    if (latestBill.status === 'checking' || hasUnderReviewPayment) {
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
