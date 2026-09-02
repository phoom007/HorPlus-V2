import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class ReceiptService {
  async getReceipt(dormitoryId: string, receiptId: string) {
    const receipt = await prisma.receipt.findUnique({
      where: { id: receiptId },
      include: {
        payment: {
          include: {
            tenant: true
          }
        },
        bill: {
          include: {
            items: true,
            room: true
          }
        },
        dailyStayInvoice: {
          include: {
            items: true,
            dailyStay: {
              include: {
                room: true,
                tenant: true,
              },
            },
          },
        },
        dormitory: true
      }
    });

    if (!receipt) throw new Error('NOT_FOUND');
    if (receipt.dormitoryId !== dormitoryId) throw new Error('FORBIDDEN');

    return receipt;
  }

  async getFinalReceiptForBill(dormitoryId: string, billId: string) {
    const bill = await prisma.bill.findFirst({
      where: { id: billId, dormitoryId },
      select: { id: true, roomId: true, billingCycleId: true },
    });
    if (!bill || !bill.roomId || !bill.billingCycleId) {
      return null;
    }

    const settlementScopeKey = `ROOM_CYCLE:${bill.roomId}:${bill.billingCycleId}`;
    const receipt = await prisma.receipt.findFirst({
      where: {
        dormitoryId,
        settlementScopeKey,
        receiptKind: 'FINAL_SETTLEMENT',
        isVoided: false,
      },
      include: {
        bill: {
          include: {
            items: true,
            room: true,
          },
        },
        dormitory: true,
      },
    });
    return receipt;
  }

  async getFinalReceiptForDailyInvoice(dormitoryId: string, dailyStayInvoiceId: string) {
    const settlementScopeKey = `DAILY_INVOICE:${dailyStayInvoiceId}`;
    const receipt = await prisma.receipt.findFirst({
      where: {
        dormitoryId,
        settlementScopeKey,
        receiptKind: 'FINAL_SETTLEMENT',
        isVoided: false,
      },
      include: {
        dailyStayInvoice: {
          include: {
            items: true,
            dailyStay: {
              include: {
                room: true,
                tenant: true,
              },
            },
          },
        },
        dormitory: true,
      },
    });
    return receipt;
  }
}

export const receiptService = new ReceiptService();
