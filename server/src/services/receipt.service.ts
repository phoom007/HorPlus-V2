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
    const receipt = await prisma.receipt.findFirst({
      where: {
        dormitoryId,
        billId,
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
    const receipt = await prisma.receipt.findFirst({
      where: {
        dormitoryId,
        dailyStayInvoiceId,
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
