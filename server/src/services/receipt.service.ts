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
}

export const receiptService = new ReceiptService();
