import { PrismaClient } from '@prisma/client';

import {
  generateFinalSettlementReceiptForBillInTx,
  generateFinalSettlementReceiptForDailyInvoiceInTx,
} from '../utils/payment-transaction.util.js';

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

  async getFinalReceiptForBill(dormitoryId: string, billId: string, userId?: string) {
    const bill = await prisma.bill.findFirst({
      where: { id: billId, dormitoryId },
      select: { id: true, roomId: true, billingCycleId: true },
    });
    if (!bill || !bill.roomId || !bill.billingCycleId) {
      return null;
    }

    const settlementScopeKey = `ROOM_CYCLE:${bill.roomId}:${bill.billingCycleId}`;
    let receipt = await prisma.receipt.findFirst({
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
    if (receipt) {
      return receipt;
    }

    // VOID/reissue preservation: If final receipts exist in this scope and are all voided, do not auto-recover on read
    const anyExisting = await prisma.receipt.findFirst({
      where: {
        dormitoryId,
        settlementScopeKey,
        receiptKind: 'FINAL_SETTLEMENT',
      },
    });
    if (anyExisting) {
      return null;
    }

    // Policy 1A: Lazy on-demand recovery for fully-settled scope without existing final receipt
    try {
      await prisma.$transaction(async (tx) => {
        await generateFinalSettlementReceiptForBillInTx(tx, {
          dormitoryId,
          billId,
          userId,
        });
      });
    } catch (err: any) {
      console.warn('[LAZY_RECEIPT_RECOVERY_BILL_WARN]', err?.message);
    }

    receipt = await prisma.receipt.findFirst({
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

  async getFinalReceiptForDailyInvoice(dormitoryId: string, dailyStayInvoiceId: string, userId?: string) {
    const settlementScopeKey = `DAILY_INVOICE:${dailyStayInvoiceId}`;
    let receipt = await prisma.receipt.findFirst({
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
    if (receipt) {
      return receipt;
    }

    // VOID/reissue preservation: If final receipts exist in this scope and are all voided, do not auto-recover on read
    const anyExisting = await prisma.receipt.findFirst({
      where: {
        dormitoryId,
        settlementScopeKey,
        receiptKind: 'FINAL_SETTLEMENT',
      },
    });
    if (anyExisting) {
      return null;
    }

    // Policy 1A: Lazy on-demand recovery for fully-settled daily invoice without existing final receipt
    try {
      await prisma.$transaction(async (tx) => {
        await generateFinalSettlementReceiptForDailyInvoiceInTx(tx, {
          dormitoryId,
          dailyStayInvoiceId,
          userId,
        });
      });
    } catch (err: any) {
      console.warn('[LAZY_RECEIPT_RECOVERY_DAILY_WARN]', err?.message);
    }

    receipt = await prisma.receipt.findFirst({
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
