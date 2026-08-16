/**
 * Referral System Service (LOCAL-07 Master)
 * Invariants:
 * - 6 numeric digits (100000..999999, no leading zero)
 * - Maximum 10 qualifying invited Google Accounts per inviter (atomic capacity)
 * - Immutable account-level binding once validated
 * - Invitee gets 10 provisional Coin, settled upon first-dorm onboarding completion
 * - Inviter gets 10 permanent Coin upon invitee first-dorm completion
 * @license Apache-2.0
 */

import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../db/prisma.js';
import { AppError } from '../types/index.js';
import { coinWalletService } from './coin-wallet.service.js';

export class ReferralService {
  private prisma: PrismaClient;

  constructor(prisma?: PrismaClient) {
    this.prisma = prisma || getPrismaClient();
  }

  /**
   * Generate crypto-secure 6-digit numeric referral code in range [100000, 999999]
   */
  private generateSixDigitCode(): string {
    const min = 100000;
    const max = 999999;
    const range = max - min + 1;
    const randInt = crypto.randomInt(0, range);
    return String(min + randInt);
  }

  /**
   * Get or create referral code for a Google Account
   */
  async getOrCreateUserReferralCode(userId: string, txClient?: any) {
    const db = txClient || this.prisma;

    let referralCode = await db.userReferralCode.findUnique({
      where: { userId },
    });

    if (!referralCode) {
      let created = false;
      let attempts = 0;
      while (!created && attempts < 10) {
        attempts++;
        const code = this.generateSixDigitCode();
        try {
          referralCode = await db.userReferralCode.create({
            data: {
              userId,
              code,
              maxUsage: 10,
              usageCount: 0,
            },
          });
          created = true;
        } catch (err: any) {
          if (err.code === 'P2002' || err.message?.includes('unique')) {
            // Collision retry
            continue;
          }
          throw err;
        }
      }

      if (!referralCode) {
        throw new AppError('ไม่สามารถสร้างรหัสคำเชิญได้ กรุณาลองใหม่อีกครั้ง', 500, 'REFERRAL_CODE_GEN_FAILED');
      }
    }

    // Authoritative calculation of active usage count (PENDING + QUALIFIED)
    const activeCount = await db.referralAttribution.count({
      where: {
        inviterUserId: userId,
        status: { in: ['PENDING', 'QUALIFIED'] },
      },
    });

    return {
      code: referralCode.code,
      maxUsage: referralCode.maxUsage,
      usageCount: activeCount,
      shareUrl: `https://horplus.com/owner/register?ref=${referralCode.code}`,
    };
  }

  /**
   * Validate and atomically bind referral code to an invitee Google Account
   */
  async validateAndBindReferral(inviteeUserId: string, rawCode: string, dormitoryId?: string, txClient?: any) {
    const code = (rawCode || '').trim();

    if (!/^[1-9]\d{5}$/.test(code)) {
      throw new AppError('รหัสคำเชิญต้องเป็นตัวเลข 6 หลัก (100000 - 999999)', 400, 'INVALID_REFERRAL_CODE_FORMAT');
    }

    const runInTx = async (tx: any) => {
      // 1. Find referral code record
      const refRecord = await tx.userReferralCode.findUnique({
        where: { code },
        include: { user: true },
      });

      if (!refRecord) {
        throw new AppError('ไม่พบรหัสคำเชิญนี้ในระบบ หรือรหัสไม่ถูกต้อง', 404, 'REFERRAL_CODE_NOT_FOUND');
      }

      // 2. Anti-Self Referral Check
      if (refRecord.userId === inviteeUserId) {
        throw new AppError('ไม่สามารถใช้รหัสคำเชิญของตนเองได้', 400, 'SELF_REFERRAL_PROHIBITED');
      }

      // 3. Check existing binding for this invitee
      const existingAttribution = await tx.referralAttribution.findUnique({
        where: { inviteeUserId },
      });

      if (existingAttribution) {
        if (existingAttribution.referralCodeSnapshot !== code) {
          // Attempted replacement of immutable binding
          throw new AppError(
            'ไม่สามารถเปลี่ยนรหัสคำเชิญได้ เนื่องจากบัญชีนี้ถูกผูกกับรหัสคำเชิญอื่นแล้ว',
            400,
            'REFERRAL_BINDING_IMMUTABLE'
          );
        }

        if (existingAttribution.status === 'PENDING' || existingAttribution.status === 'QUALIFIED') {
          // Idempotent re-validation of active/qualified binding
          return {
            valid: true,
            referralCode: code,
            provisionalCoin: existingAttribution.provisionalCoinGranted,
            status: existingAttribution.status,
            message: 'รหัสคำเชิญถูกต้อง (ผูกกับบัญชีนี้แล้ว)',
          };
        }

        // Status is VOIDED: attempt to re-reserve pending capacity for the same bound inviter
        await tx.$executeRaw`SELECT * FROM "user_referral_codes" WHERE "id" = ${refRecord.id}::uuid FOR UPDATE`;

        const activeReservationsCount = await tx.referralAttribution.count({
          where: {
            inviterUserId: refRecord.userId,
            status: { in: ['PENDING', 'QUALIFIED'] },
          },
        });

        if (activeReservationsCount >= refRecord.maxUsage) {
          throw new AppError('รหัสคำเชิญครบจำนวนสิทธิ์แล้ว', 400, 'REFERRAL_LIMIT_REACHED');
        }

        const attribution = await tx.referralAttribution.update({
          where: { id: existingAttribution.id },
          data: {
            status: 'PENDING',
            dormitoryId: dormitoryId || null,
            updatedAt: new Date(),
          },
        });

        await tx.userReferralCode.update({
          where: { id: refRecord.id },
          data: { usageCount: activeReservationsCount + 1 },
        });

        return {
          valid: true,
          referralCode: code,
          provisionalCoin: attribution.provisionalCoinGranted,
          status: 'PENDING',
          message: 'รหัสคำเชิญถูกต้อง คุณได้รับสิทธิ์ Coin 10 บาทสำหรับการสมัครครั้งแรก',
        };
      }

      // 4. Lock inviter's referral record and verify atomic capacity (< 10)
      await tx.$executeRaw`SELECT * FROM "user_referral_codes" WHERE "id" = ${refRecord.id}::uuid FOR UPDATE`;

      const activeReservationsCount = await tx.referralAttribution.count({
        where: {
          inviterUserId: refRecord.userId,
          status: { in: ['PENDING', 'QUALIFIED'] },
        },
      });

      if (activeReservationsCount >= refRecord.maxUsage) {
        throw new AppError('รหัสคำเชิญครบจำนวนสิทธิ์แล้ว', 400, 'REFERRAL_LIMIT_REACHED');
      }

      // 5. Create immutable ReferralAttribution record with provisional 10 Coin benefit
      const attribution = await tx.referralAttribution.create({
        data: {
          inviteeUserId,
          inviterUserId: refRecord.userId,
          referralCodeId: refRecord.id,
          referralCodeSnapshot: code,
          status: 'PENDING',
          provisionalCoinGranted: 10,
          dormitoryId: dormitoryId || null,
        },
      });

      // Update denormalized usageCount cache
      await tx.userReferralCode.update({
        where: { id: refRecord.id },
        data: { usageCount: activeReservationsCount + 1 },
      });

      return {
        valid: true,
        referralCode: code,
        provisionalCoin: 10,
        status: attribution.status,
        message: 'รหัสคำเชิญถูกต้อง คุณได้รับสิทธิ์ Coin 10 บาทสำหรับการสมัครครั้งแรก',
      };
    };

    if (txClient) {
      return await runInTx(txClient);
    }
    return await this.prisma.$transaction(runInTx);
  }

  /**
   * Release pending referral capacity reservation when onboarding draft is discarded or expires
   */
  async releasePendingReferralReservation(inviteeUserId: string, txClient?: any) {
    const runInTx = async (tx: any) => {
      const attribution = await tx.referralAttribution.findUnique({
        where: { inviteeUserId },
      });

      if (!attribution || attribution.status !== 'PENDING') {
        return { released: false, status: attribution?.status || 'NO_ATTRIBUTION' };
      }

      // 1. Transition attribution to VOIDED
      await tx.referralAttribution.update({
        where: { id: attribution.id },
        data: {
          status: 'VOIDED',
          updatedAt: new Date(),
        },
      });

      // 2. Recalculate inviter active usageCount
      const activeReservationsCount = await tx.referralAttribution.count({
        where: {
          inviterUserId: attribution.inviterUserId,
          status: { in: ['PENDING', 'QUALIFIED'] },
        },
      });

      await tx.userReferralCode.update({
        where: { id: attribution.referralCodeId },
        data: { usageCount: activeReservationsCount },
      });

      return { released: true, status: 'VOIDED' };
    };

    if (txClient) {
      return await runInTx(txClient);
    }
    return await this.prisma.$transaction(runInTx);
  }

  /**
   * Settle referral reward upon successful first-dormitory onboarding completion
   */
  async settleReferralOnboarding(
    inviteeUserId: string,
    dormitoryId: string,
    coinConsumedInCheckout = 0,
    txClient?: any
  ) {
    const runInTx = async (tx: any) => {
      const attribution = await tx.referralAttribution.findUnique({
        where: { inviteeUserId },
      });

      if (!attribution) {
        return { settled: false, reason: 'NO_ATTRIBUTION' };
      }

      if (attribution.status === 'QUALIFIED') {
        return { settled: true, reason: 'ALREADY_QUALIFIED' };
      }

      // 1. Transition attribution to QUALIFIED
      await tx.referralAttribution.update({
        where: { id: attribution.id },
        data: {
          status: 'QUALIFIED',
          dormitoryId,
          qualifiedAt: new Date(),
        },
      });

      // 2. Credit Inviter with 10 permanent Coin immediately upon invitee first-dorm completion
      const inviterIdempotencyKey = `referral_reward:inviter:${attribution.id}`;
      await coinWalletService.creditWallet(
        attribution.inviterUserId,
        10,
        'REFERRAL_INVITER_CREDIT',
        'DORMITORY',
        dormitoryId,
        `รางวัลแนะนำเพื่อนสำเร็จ (${attribution.referralCodeSnapshot})`,
        inviterIdempotencyKey,
        tx
      );

      // 3. Settle invitee provisional Coin: credit remaining unused Coin to permanent wallet
      const unusedCoin = Math.max(0, attribution.provisionalCoinGranted - coinConsumedInCheckout);
      if (unusedCoin > 0) {
        const inviteeIdempotencyKey = `referral_reward:invitee:${attribution.id}`;
        await coinWalletService.creditWallet(
          inviteeUserId,
          unusedCoin,
          'REFERRAL_INVITEE_CREDIT',
          'DORMITORY',
          dormitoryId,
          `สิทธิ์ Coin จากรหัสคำเชิญ ${attribution.referralCodeSnapshot}`,
          inviteeIdempotencyKey,
          tx
        );
      }

      return {
        settled: true,
        inviterCoinGranted: 10,
        inviteePermanentCoinGranted: unusedCoin,
      };
    };

    if (txClient) {
      return await runInTx(txClient);
    }
    return await this.prisma.$transaction(runInTx);
  }

  /**
   * Get referral attribution for an invitee
   */
  async getAttributionForUser(inviteeUserId: string, txClient?: any) {
    const db = txClient || this.prisma;
    return await db.referralAttribution.findUnique({
      where: { inviteeUserId },
      include: {
        referralCode: true,
        inviter: {
          select: { id: true, name: true },
        },
      },
    });
  }
  async settleReferralOnDormitoryCreated(
    inviteeUserId: string,
    dormitoryId: string,
    coinConsumedInCheckout = 0,
    txClient?: any
  ) {
    return this.settleReferralOnboarding(inviteeUserId, dormitoryId, coinConsumedInCheckout, txClient);
  }
}

export const referralService = new ReferralService();
