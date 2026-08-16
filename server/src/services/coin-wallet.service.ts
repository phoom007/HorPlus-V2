/**
 * Coin Wallet & Append-Only Ledger Service (LOCAL-07 Master)
 * Invariant: 1 Coin = 1 THB, integer units only.
 * @license Apache-2.0
 */

import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../db/prisma.js';
import { AppError } from '../types/index.js';

export type CoinLedgerEntryType =
  | 'REFERRAL_INVITEE_CREDIT'
  | 'REFERRAL_INVITER_CREDIT'
  | 'SUBSCRIPTION_DEBIT'
  | 'REVERSAL'
  | 'ADMIN_ADJUSTMENT';

export class CoinWalletService {
  private prisma: PrismaClient;

  constructor(prisma?: PrismaClient) {
    this.prisma = prisma || getPrismaClient();
  }

  /**
   * Get or create user coin wallet and return integer balance
   */
  async getOrCreateWallet(userId: string, txClient?: any) {
    const db = txClient || this.prisma;
    let wallet = await db.coinWallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      wallet = await db.coinWallet.create({
        data: {
          userId,
          balance: 0,
          version: 1,
        },
      });
    }

    return wallet;
  }

  /**
   * Authoritative integer balance lookup
   */
  async getBalance(userId: string, txClient?: any): Promise<number> {
    const wallet = await this.getOrCreateWallet(userId, txClient);
    return wallet.balance;
  }

  /**
   * Credit integer Coin to user wallet with append-only ledger entry
   */
  async creditWallet(
    userId: string,
    amount: number,
    entryType: CoinLedgerEntryType,
    referenceType?: string,
    referenceId?: string,
    description?: string,
    idempotencyKey?: string,
    txClient?: any
  ) {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new AppError('จำนวน Coin ต้องเป็นจำนวนเต็มบวกเท่านั้น', 400, 'INVALID_COIN_AMOUNT');
    }

    const runInTx = async (tx: any) => {
      // Idempotency check if key provided
      if (idempotencyKey) {
        const existing = await tx.coinLedgerEntry.findUnique({
          where: { idempotencyKey },
        });
        if (existing) {
          const currentWallet = await tx.coinWallet.findUnique({ where: { userId } });
          return { wallet: currentWallet, ledgerEntry: existing, duplicate: true };
        }
      }

      await this.getOrCreateWallet(userId, tx);

      // Lock wallet row for update
      await tx.$executeRaw`SELECT * FROM "coin_wallets" WHERE "user_id" = ${userId}::uuid FOR UPDATE`;

      const wallet = await tx.coinWallet.findUniqueOrThrow({
        where: { userId },
      });

      const newBalance = wallet.balance + amount;

      const ledgerEntry = await tx.coinLedgerEntry.create({
        data: {
          walletId: wallet.id,
          userId,
          entryType,
          amount,
          balanceAfter: newBalance,
          referenceType: referenceType || null,
          referenceId: referenceId || null,
          description: description || null,
          idempotencyKey: idempotencyKey || null,
        },
      });

      const updatedWallet = await tx.coinWallet.update({
        where: { id: wallet.id },
        data: {
          balance: newBalance,
          version: { increment: 1 },
        },
      });

      return { wallet: updatedWallet, ledgerEntry, duplicate: false };
    };

    if (txClient) {
      return await runInTx(txClient);
    }
    return await this.prisma.$transaction(runInTx);
  }

  /**
   * Debit integer Coin from user wallet with append-only ledger entry
   */
  async debitWallet(
    userId: string,
    amount: number,
    entryType: CoinLedgerEntryType = 'SUBSCRIPTION_DEBIT',
    referenceType?: string,
    referenceId?: string,
    description?: string,
    idempotencyKey?: string,
    txClient?: any
  ) {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new AppError('จำนวน Coin ต้องเป็นจำนวนเต็มบวกเท่านั้น', 400, 'INVALID_COIN_AMOUNT');
    }

    const runInTx = async (tx: any) => {
      if (idempotencyKey) {
        const existing = await tx.coinLedgerEntry.findUnique({
          where: { idempotencyKey },
        });
        if (existing) {
          const currentWallet = await tx.coinWallet.findUnique({ where: { userId } });
          return { wallet: currentWallet, ledgerEntry: existing, duplicate: true };
        }
      }

      await this.getOrCreateWallet(userId, tx);

      // Lock wallet row for update
      await tx.$executeRaw`SELECT * FROM "coin_wallets" WHERE "user_id" = ${userId}::uuid FOR UPDATE`;

      const wallet = await tx.coinWallet.findUniqueOrThrow({
        where: { userId },
      });

      if (wallet.balance < amount) {
        throw new AppError(
          `ยอดเงิน Coin ไม่เพียงพอ (คงเหลือ ${wallet.balance} Coin, ต้องการ ${amount} Coin)`,
          400,
          'INSUFFICIENT_COIN_BALANCE'
        );
      }

      const newBalance = wallet.balance - amount;

      const ledgerEntry = await tx.coinLedgerEntry.create({
        data: {
          walletId: wallet.id,
          userId,
          entryType,
          amount: -amount,
          balanceAfter: newBalance,
          referenceType: referenceType || null,
          referenceId: referenceId || null,
          description: description || null,
          idempotencyKey: idempotencyKey || null,
        },
      });

      const updatedWallet = await tx.coinWallet.update({
        where: { id: wallet.id },
        data: {
          balance: newBalance,
          version: { increment: 1 },
        },
      });

      return { wallet: updatedWallet, ledgerEntry, duplicate: false };
    };

    if (txClient) {
      return await runInTx(txClient);
    }
    return await this.prisma.$transaction(runInTx);
  }

  /**
   * Get ledger history for user
   */
  async getLedgerEntries(userId: string, limit: number = 50, txClient?: any) {
    const db = txClient || this.prisma;
    return await db.coinLedgerEntry.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async creditCoins(userId: string, amount: number, description?: string, txClient?: any) {
    return this.creditWallet(userId, amount, 'ADMIN_ADJUSTMENT', undefined, undefined, description, undefined, txClient);
  }

  async spendCoins(userId: string, amount: number, description?: string, txClient?: any) {
    return this.debitWallet(userId, amount, 'SUBSCRIPTION_DEBIT', undefined, undefined, description, undefined, txClient);
  }
}

export const coinWalletService = new CoinWalletService();
