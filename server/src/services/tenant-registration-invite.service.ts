/**
 * Tenant Registration Invite Service (Task LOCAL-07 — Secure LINE Follow Invite Authority)
 * @license Apache-2.0
 */

import crypto from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../db/prisma.js';
import { AppError } from '../types/index.js';
import { hashToken } from '../utils/crypto-encryption.js';
import { LineReplyDeliveryResult } from './line-platform-adapter.js';

export const TENANT_REGISTRATION_INVITE_TTL_DAYS = 7;
export const TENANT_REGISTRATION_INVITE_TTL_MS = TENANT_REGISTRATION_INVITE_TTL_DAYS * 24 * 60 * 60 * 1000;

export interface ResolvedInviteContext {
  id: string;
  dormitoryId: string;
  dormitoryName: string;
  lineFriendId: string;
  intentId?: string | null;
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
   * Finds or creates a durable active TenantRegistrationIntent for the verified LINE friend.
   */
  async getOrCreateActiveIntent(
    dormitoryId: string,
    lineFriendId: string,
    purpose = 'TENANT_REGISTRATION',
    tx?: Prisma.TransactionClient
  ): Promise<{ id: string; dormitoryId: string; lineFriendId: string; purpose: string; status: string }> {
    const client = tx || this.prisma;

    let intent = await client.tenantRegistrationIntent.findFirst({
      where: {
        dormitoryId,
        lineFriendId,
        purpose,
        status: 'ACTIVE',
      },
    });

    if (!intent) {
      intent = await client.tenantRegistrationIntent.create({
        data: {
          dormitoryId,
          lineFriendId,
          purpose,
          status: 'ACTIVE',
        },
      });
    }

    return intent;
  }

  /**
   * Generates a 256-bit cryptographically secure raw token, hashes it,
   * and persists an active 7-day tenant registration invite attached to the durable Intent.
   * Never logs or persists the raw token.
   */
  async createInvite(
    dormitoryId: string,
    lineFriendId: string,
    intentIdOrTx?: string | Prisma.TransactionClient,
    maybeTx?: Prisma.TransactionClient
  ): Promise<{
    id: string;
    dormitoryId: string;
    lineFriendId: string;
    intentId: string;
    rawToken: string;
    tokenHash: string;
    expiresAt: Date;
  }> {
    let intentId: string | undefined;
    let tx: Prisma.TransactionClient | undefined;

    if (typeof intentIdOrTx === 'string') {
      intentId = intentIdOrTx;
      tx = maybeTx;
    } else {
      tx = intentIdOrTx;
    }

    const client = tx || this.prisma;

    if (!intentId) {
      const intent = await this.getOrCreateActiveIntent(dormitoryId, lineFriendId, 'TENANT_REGISTRATION', client);
      intentId = intent.id;
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + TENANT_REGISTRATION_INVITE_TTL_MS);

    const invite = await client.tenantRegistrationInvite.create({
      data: {
        dormitoryId,
        lineFriendId,
        intentId,
        tokenHash,
        purpose: 'TENANT_REGISTRATION',
        deliveryStatus: 'PENDING',
        expiresAt,
      },
    });

    return {
      id: invite.id,
      dormitoryId: invite.dormitoryId,
      lineFriendId: invite.lineFriendId,
      intentId: invite.intentId!,
      rawToken,
      tokenHash,
      expiresAt: invite.expiresAt,
    };
  }

  /**
   * Updates the delivery outcome of a specific invite attempt following LINE replyMessage.
   * Under C1:
   * - DELIVERED: invite active, deliveryStatus = 'DELIVERED'.
   * - FAILED: invite revoked (explicit rejection proof), deliveryStatus = 'FAILED'.
   * - UNKNOWN: invite remains ACTIVE (transport ambiguity, message may be delivered), deliveryStatus = 'UNKNOWN'.
   */
  async updateDeliveryOutcome(
    inviteId: string,
    outcome: LineReplyDeliveryResult,
    tx?: Prisma.TransactionClient
  ): Promise<void> {
    if (!inviteId) return;
    const client = tx || this.prisma;

    if (outcome.outcome === 'DELIVERED') {
      await client.tenantRegistrationInvite.updateMany({
        where: { id: inviteId },
        data: {
          deliveryStatus: 'DELIVERED',
          deliveryAttemptedAt: new Date(),
          deliveredAt: new Date(),
        },
      });
    } else if (outcome.outcome === 'FAILED') {
      await client.tenantRegistrationInvite.updateMany({
        where: { id: inviteId },
        data: {
          deliveryStatus: 'FAILED',
          deliveryAttemptedAt: new Date(),
          failedAt: new Date(),
          deliveryErrorCode: outcome.errorCode || `HTTP_${outcome.httpStatus}`,
          revokedAt: new Date(), // Explicitly failed delivery can be revoked
        },
      });
    } else if (outcome.outcome === 'UNKNOWN') {
      await client.tenantRegistrationInvite.updateMany({
        where: { id: inviteId },
        data: {
          deliveryStatus: 'UNKNOWN',
          deliveryAttemptedAt: new Date(),
          deliveryErrorCode: outcome.transportErrorCode || 'NETWORK_TIMEOUT',
          // CRITICAL C1 INVARIANT: Do NOT revoke on ambiguous UNKNOWN timeout!
        },
      });
    }
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
          intentId: true,
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
        intentId: invite.intentId,
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
   * Acquires row locks on invite AND intent to guarantee single-use and single-request concurrency protection.
   * Automatically revokes sibling active registration invites under the same intent upon consumption.
   */
  async consumeInviteInTransaction(
    rawToken: string,
    tx: Prisma.TransactionClient
  ): Promise<{
    id: string;
    dormitoryId: string;
    lineFriendId: string;
    intentId?: string | null;
    purpose: string;
  }> {
    if (!rawToken || typeof rawToken !== 'string' || !rawToken.trim()) {
      throw new AppError('ลิงก์ลงทะเบียนไม่ถูกต้องหรือไม่พบในระบบ', 400, 'TENANT_REGISTRATION_INVITE_INVALID');
    }

    const tokenHash = hashToken(rawToken.trim());

    // 0. Peek initial invite record to discover parent intent and validate invite state
    const initialRows = await tx.$queryRaw<Array<{
      id: string;
      dormitory_id: string;
      line_friend_id: string;
      intent_id: string | null;
      consumed_at: Date | null;
      revoked_at: Date | null;
      expires_at: Date;
    }>>`
      SELECT id, dormitory_id, line_friend_id, intent_id, consumed_at, revoked_at, expires_at
      FROM tenant_registration_invites
      WHERE token_hash = ${tokenHash}
    `;

    if (!initialRows || initialRows.length === 0) {
      throw new AppError('ลิงก์ลงทะเบียนไม่ถูกต้องหรือไม่พบในระบบ', 404, 'TENANT_REGISTRATION_INVITE_INVALID');
    }

    const initial = initialRows[0];

    if (initial.revoked_at) {
      throw new AppError('ลิงก์ลงทะเบียนนี้ถูกยกเลิกแล้ว', 410, 'TENANT_REGISTRATION_INVITE_REVOKED');
    }

    if (initial.consumed_at) {
      throw new AppError('ลิงก์ลงทะเบียนนี้ถูกใช้งานไปแล้ว', 410, 'TENANT_REGISTRATION_INVITE_USED');
    }

    if (new Date(initial.expires_at) < new Date()) {
      throw new AppError('ลิงก์ลงทะเบียนนี้หมดอายุแล้ว (อายุการใช้งาน 7 วัน)', 410, 'TENANT_REGISTRATION_INVITE_EXPIRED');
    }

    const { intent_id: parentIntentId } = initial;

    // 1. Lock Intent FIRST (Top-down lock hierarchy: Intent -> Invite prevents DB deadlocks)
    if (parentIntentId) {
      const intentRows = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT id, status
        FROM tenant_registration_intents
        WHERE id = ${parentIntentId}::uuid
        FOR UPDATE
      `;

      if (intentRows && intentRows.length > 0) {
        const intentRecord = intentRows[0];
        if (intentRecord.status === 'SUBMITTED' || intentRecord.status === 'COMPLETED') {
          throw new AppError('คำขอลงทะเบียนสำหรับการเชิญนี้ถูกส่งเรียบร้อยแล้ว', 409, 'TENANT_REGISTRATION_INTENT_ALREADY_SUBMITTED');
        }
      }
    }

    // 2. Lock Invite SECOND
    const rows = await tx.$queryRaw<Array<{
      id: string;
      dormitory_id: string;
      line_friend_id: string;
      intent_id: string | null;
      purpose: string;
      expires_at: Date;
      consumed_at: Date | null;
      revoked_at: Date | null;
    }>>`
      SELECT id, dormitory_id, line_friend_id, intent_id, purpose, expires_at, consumed_at, revoked_at
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

    // Update parent intent to SUBMITTED
    if (record.intent_id) {
      await tx.tenantRegistrationIntent.update({
        where: { id: record.intent_id },
        data: {
          status: 'SUBMITTED',
          submittedAt: new Date(),
        },
      });
    }

    // 1. Consume the winning invite
    await tx.tenantRegistrationInvite.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });

    // 2. Revoke all sibling active invites for this onboarding identity (Part G-24)
    await tx.tenantRegistrationInvite.updateMany({
      where: {
        dormitoryId: record.dormitory_id,
        lineFriendId: record.line_friend_id,
        purpose: record.purpose,
        id: { not: record.id },
        consumedAt: null,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    return {
      id: record.id,
      dormitoryId: record.dormitory_id,
      lineFriendId: record.line_friend_id,
      intentId: record.intent_id,
      purpose: record.purpose,
    };
  }
}

export const tenantRegistrationInviteService = new TenantRegistrationInviteService();

