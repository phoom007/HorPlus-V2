/**
 * Tenant Registration Invite Service (Task LOCAL-07 — Secure LINE Follow Invite Authority)
 * @license Apache-2.0
 */

import crypto from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../db/prisma.js';
import { AppError } from '../types/index.js';
import { hashToken } from '../utils/crypto-encryption.js';

export const TENANT_REGISTRATION_INVITE_TTL_DAYS = 7;
export const TENANT_REGISTRATION_INVITE_TTL_MS = TENANT_REGISTRATION_INVITE_TTL_DAYS * 24 * 60 * 60 * 1000;

export interface ResolvedInviteContext {
  id: string;
  dormitoryId: string;
  dormitoryName: string;
  lineFriendId: string;
  lineDisplayName: string;
  linePictureUrl?: string | null;
  expiresAt: Date;
  purpose: string;
}

export class TenantRegistrationInviteService {
  private prisma: PrismaClient;

  constructor(prisma?: PrismaClient) {
    this.prisma = prisma || getPrismaClient();
  }

  /**
   * Generates a 256-bit cryptographically secure raw token, hashes it,
   * and persists an active 7-day tenant registration invite.
   * Never logs or persists the raw token.
   */
  async createInvite(
    dormitoryId: string,
    lineFriendId: string,
    tx?: Prisma.TransactionClient
  ): Promise<{
    id: string;
    dormitoryId: string;
    lineFriendId: string;
    rawToken: string;
    tokenHash: string;
    expiresAt: Date;
  }> {
    const client = tx || this.prisma;

    // Revoke any prior unconsumed active invite for same friend & purpose to prevent proliferation
    await client.tenantRegistrationInvite.updateMany({
      where: {
        dormitoryId,
        lineFriendId,
        purpose: 'TENANT_REGISTRATION',
        consumedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: {
        revokedAt: new Date(),
      },
    });

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + TENANT_REGISTRATION_INVITE_TTL_MS);

    const invite = await client.tenantRegistrationInvite.create({
      data: {
        dormitoryId,
        lineFriendId,
        tokenHash,
        purpose: 'TENANT_REGISTRATION',
        expiresAt,
      },
    });

    return {
      id: invite.id,
      dormitoryId: invite.dormitoryId,
      lineFriendId: invite.lineFriendId,
      rawToken,
      tokenHash,
      expiresAt: invite.expiresAt,
    };
  }

  /**
   * Revokes an existing active invite by ID.
   */
  async revokeInvite(
    inviteId: string,
    tx?: Prisma.TransactionClient
  ): Promise<void> {
    if (!inviteId) return;
    const client = tx || this.prisma;
    await client.tenantRegistrationInvite.updateMany({
      where: { id: inviteId, consumedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Validates a raw invite token without consuming it.
   * Returns safe context for rendering the registration form.
   */
  async resolveInvite(
    rawToken: string,
    tx?: Prisma.TransactionClient
  ): Promise<ResolvedInviteContext> {
    if (!rawToken || typeof rawToken !== 'string' || !rawToken.trim()) {
      throw new AppError('ลิงก์ลงทะเบียนไม่ถูกต้องหรือไม่พบในระบบ', 404, 'TENANT_REGISTRATION_INVITE_INVALID');
    }

    const tokenHash = hashToken(rawToken.trim());

    const execute = async (client: Prisma.TransactionClient | PrismaClient) => {
      const invite = await client.tenantRegistrationInvite.findUnique({
        where: { tokenHash },
        select: {
          id: true,
          dormitoryId: true,
          lineFriendId: true,
          purpose: true,
          expiresAt: true,
          consumedAt: true,
          revokedAt: true,
          dormitory: { select: { id: true, name: true } },
        },
      });

      if (!invite) {
        throw new AppError('ลิงก์ลงทะเบียนไม่ถูกต้องหรือไม่พบในระบบ', 404, 'TENANT_REGISTRATION_INVITE_INVALID');
      }

      if (invite.revokedAt) {
        throw new AppError('ลิงก์ลงทะเบียนนี้ถูกยกเลิกแล้ว', 410, 'TENANT_REGISTRATION_INVITE_REVOKED');
      }

      if (invite.consumedAt) {
        throw new AppError('ลิงก์ลงทะเบียนนี้ถูกใช้งานไปแล้ว', 410, 'TENANT_REGISTRATION_INVITE_USED');
      }

      if (invite.expiresAt < new Date()) {
        throw new AppError('ลิงก์ลงทะเบียนนี้หมดอายุแล้ว (อายุการใช้งาน 7 วัน)', 410, 'TENANT_REGISTRATION_INVITE_EXPIRED');
      }

      await client.$executeRaw`SELECT set_config('app.current_dormitory_id', ${invite.dormitoryId}, true)`;

      const lineFriend = await client.dormitoryLineFriend.findUnique({
        where: { id: invite.lineFriendId },
        select: { displayName: true, pictureUrl: true },
      });

      return {
        id: invite.id,
        dormitoryId: invite.dormitoryId,
        dormitoryName: invite.dormitory.name,
        lineFriendId: invite.lineFriendId,
        lineDisplayName: lineFriend?.displayName || 'ผู้ใช้ LINE',
        linePictureUrl: lineFriend?.pictureUrl || null,
        expiresAt: invite.expiresAt,
        purpose: invite.purpose,
      };
    };

    if (tx) {
      return execute(tx);
    } else {
      return this.prisma.$transaction(async (innerTx) => execute(innerTx));
    }
  }

  /**
   * Atomically verifies and consumes an invite token within an existing transaction.
   * Acquires a row lock (FOR UPDATE) to guarantee single-use concurrency protection.
   */
  async consumeInviteInTransaction(
    rawToken: string,
    tx: Prisma.TransactionClient
  ): Promise<{
    id: string;
    dormitoryId: string;
    lineFriendId: string;
    purpose: string;
  }> {
    if (!rawToken || typeof rawToken !== 'string' || !rawToken.trim()) {
      throw new AppError('ลิงก์ลงทะเบียนไม่ถูกต้องหรือไม่พบในระบบ', 400, 'TENANT_REGISTRATION_INVITE_INVALID');
    }

    const tokenHash = hashToken(rawToken.trim());

    const rows = await tx.$queryRaw<Array<{
      id: string;
      dormitory_id: string;
      line_friend_id: string;
      purpose: string;
      expires_at: Date;
      consumed_at: Date | null;
      revoked_at: Date | null;
    }>>`
      SELECT id, dormitory_id, line_friend_id, purpose, expires_at, consumed_at, revoked_at
      FROM tenant_registration_invites
      WHERE token_hash = ${tokenHash}
      FOR UPDATE
    `;

    if (!rows || rows.length === 0) {
      throw new AppError('ลิงก์ลงทะเบียนไม่ถูกต้องหรือไม่พบในระบบ', 404, 'TENANT_REGISTRATION_INVITE_INVALID');
    }

    const record = rows[0];

    if (record.revoked_at) {
      throw new AppError('ลิงก์ลงทะเบียนนี้ถูกยกเลิกแล้ว', 410, 'TENANT_REGISTRATION_INVITE_REVOKED');
    }

    if (record.consumed_at) {
      throw new AppError('ลิงก์ลงทะเบียนนี้ถูกใช้งานไปแล้ว', 410, 'TENANT_REGISTRATION_INVITE_USED');
    }

    if (new Date(record.expires_at) < new Date()) {
      throw new AppError('ลิงก์ลงทะเบียนนี้หมดอายุแล้ว (อายุการใช้งาน 7 วัน)', 410, 'TENANT_REGISTRATION_INVITE_EXPIRED');
    }

    await tx.tenantRegistrationInvite.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });

    return {
      id: record.id,
      dormitoryId: record.dormitory_id,
      lineFriendId: record.line_friend_id,
      purpose: record.purpose,
    };
  }
}

export const tenantRegistrationInviteService = new TenantRegistrationInviteService();
