/**
 * Revocable Bearer Access Grant Service (Task-009 Checkpoint 1C)
 * Phase A: Atomic grant creation with raw token encryption
 * Phase B: Delivery with atomic quota reservation & LinePushDeliveryAttempt
 * Bearer redemption via narrow SECURITY DEFINER token resolver & CSRF token issuance.
 * @license Apache-2.0
 */

import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { generateGrantToken, hashToken, encryptText, decryptText } from '../utils/crypto-encryption.js';
import { AppError } from '../types/index.js';
import { LinePlatformAdapter, MockLinePlatformAdapter, LinePushResult } from './line-platform-adapter.js';
import { LineFriendService } from './line-friend.service.js';
import { SessionTokenService } from './session-token.service.js';
import { LinePushUsageService } from './line-push-usage.service.js';
import { LineOaService } from './line-oa.service.js';
import { createLinePlatformAdapter } from './line-adapter-factory.js';
import { getEnv } from '../config/env.js';

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function parseActorUserId(principal: string): string | null {
  if (!principal) return null;
  const cleaned = principal.startsWith('usr_') ? principal.replace('usr_', '') : principal;
  return UUID_REGEX.test(cleaned) ? cleaned : null;
}

export class AccessGrantService {
  private lineAdapter: LinePlatformAdapter;
  private friendService: LineFriendService;
  private sessionTokenService: SessionTokenService;
  private pushUsageService: LinePushUsageService;
  private lineOaService: LineOaService;

  constructor(private prisma: PrismaClient, adapter?: LinePlatformAdapter) {
    if (!adapter) {
      if (process.env.NODE_ENV === 'test') {
        this.lineAdapter = new MockLinePlatformAdapter();
      } else {
        this.lineAdapter = createLinePlatformAdapter();
      }
    } else {
      this.lineAdapter = adapter;
    }
    this.friendService = new LineFriendService(prisma);
    const env = getEnv();
    this.sessionTokenService = new SessionTokenService(env.SESSION_ENCRYPTION_KEY);
    this.pushUsageService = new LinePushUsageService(prisma);
    this.lineOaService = new LineOaService(prisma, this.lineAdapter);
  }

  /**
   * Get total slot usage for a dormitory
   */
  async getSlotUsage(dormitoryId: string, tx?: any) {
    const db = tx || this.prisma;

    const googleOwnersCount = await db.dormitoryMember.count({
      where: {
        dormitoryId,
        membershipOrigin: 'GOOGLE_BOOTSTRAP',
        role: { code: 'OWNER' },
        status: 'active'
      }
    });

    const activeGrantsCount = await db.dormitoryAccessGrant.count({
      where: { dormitoryId, status: 'ACTIVE' }
    });

    return {
      googleOwnersCount,
      activeGrantsCount,
      totalUsedSlots: googleOwnersCount + activeGrantsCount,
      maxSlots: 10
    };
  }

  /**
   * PHASE A: Create Access Grant atomically. No LINE API calls inside transaction.
   * Stores encrypted raw token for Copy Link and Retry delivery.
   */
  async createAccessGrant(
    dormitoryId: string,
    lineFriendId: string,
    roleCode: 'OWNER' | 'MANAGER' | 'TECH',
    createdByPrincipal: string
  ) {
    if (!['OWNER', 'MANAGER', 'TECH'].includes(roleCode)) {
      throw new AppError('Role must be OWNER, MANAGER, or TECH', 400, 'INVALID_ROLE_CODE');
    }

    const grantResult = await this.prisma.$transaction(async (tx) => {
      // 0. Set RLS context for Dormitory
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;

      // 1. Acquire transaction advisory lock for Dormitory
      const lockId = Math.abs(this.hashStringToInteger(dormitoryId));
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockId})`;

      // 2. Calculate slot usage
      const usage = await this.getSlotUsage(dormitoryId, tx);
      if (usage.totalUsedSlots >= usage.maxSlots) {
        throw new AppError('Cannot create access grant. Account slot limit (10) reached.', 409, 'STAFF_LIMIT_EXCEEDED');
      }

      // 3. Verify LINE friend exists
      const friend = await tx.dormitoryLineFriend.findFirst({
        where: { id: lineFriendId, dormitoryId }
      });
      if (!friend) {
        throw new AppError('Target LINE friend not found in dormitory directory', 444, 'LINE_FRIEND_NOT_FOUND');
      }

      // 4. Enforce single ACTIVE grant per LINE friend in dormitory
      const existingActive = await tx.dormitoryAccessGrant.findFirst({
        where: { dormitoryId, lineFriendId, status: 'ACTIVE' }
      });
      if (existingActive) {
        throw new AppError('Target LINE friend already has an active access grant in this dormitory', 409, 'ACTIVE_GRANT_EXISTS');
      }

      // 5. Generate bearer token, hash, and AES encrypted bearer secret
      const { rawToken, tokenHash, tokenPrefix } = generateGrantToken();
      const tokenEncrypted = encryptText(rawToken);

      // 6. Create DormitoryAccessGrant record
      const grant = await tx.dormitoryAccessGrant.create({
        data: {
          dormitoryId,
          lineFriendId,
          roleCode,
          tokenHash,
          tokenEncrypted,
          tokenPrefix,
          status: 'ACTIVE',
          version: 1,
          createdByPrincipal,
          lastDeliveryStatus: null
        },
        include: {
          lineFriend: true,
          dormitory: true
        }
      });

      // 7. Record AuditLog
      const actorUserId = parseActorUserId(createdByPrincipal);
      await tx.auditLog.create({
        data: {
          dormitoryId,
          actorUserId,
          action: 'ACCESS_GRANT_CREATED',
          entityType: 'DormitoryAccessGrant',
          entityId: grant.id,
          afterValues: {
            grantId: grant.id,
            roleCode,
            tokenPrefix,
            friendDisplayName: friend.displayName
          }
        }
      });

      const baseUrl = process.env.PUBLIC_APP_URL || 'https://app.horplus.com';
      const bearerUrl = `${baseUrl}/staff-access#${rawToken}`;

      return { grant, bearerUrl, _transientRawToken: rawToken };
    });

    // PHASE B: Attempt delivery outside the grant transaction
    const delivery = await this.deliverAccessGrant(grantResult.grant.id, dormitoryId, grantResult._transientRawToken).catch((err) => {
      console.error('DELIVERY ERROR:', err);
      return {
        deliveryStatus: 'failed' as const,
        pushed: false
      };
    });

    return {
      grant: grantResult.grant,
      bearerUrl: grantResult.bearerUrl,
      pushed: delivery.pushed,
      deliveryStatus: delivery.deliveryStatus
    };
  }

  /**
   * Get recoverable Owner-authorized bearer Copy Link URL
   */
  async getGrantCopyLink(dormitoryId: string, grantId: string): Promise<{ url: string; grantId: string }> {
    const grant = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;
      return await tx.dormitoryAccessGrant.findFirst({
        where: { id: grantId, dormitoryId, status: 'ACTIVE' }
      });
    });

    if (!grant || !grant.tokenEncrypted) {
      throw new AppError('Active access grant not found', 404, 'ACCESS_GRANT_NOT_FOUND');
    }

    const rawToken = decryptText(grant.tokenEncrypted);
    const baseUrl = process.env.PUBLIC_APP_URL || 'https://app.horplus.com';
    return {
      url: `${baseUrl}/staff-access#${rawToken}`,
      grantId
    };
  }

  /**
   * PHASE B: Deliver Access Grant via LINE Push.
   * Atomic quota reservation + LinePushDeliveryAttempt creation in one transaction.
   */
  async deliverAccessGrant(
    grantId: string,
    dormitoryId: string,
    rawTokenOverride?: string
  ): Promise<{ pushed: boolean; deliveryStatus: string }> {
    // 1. Load grant under RLS context
    const grant = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;
      return await tx.dormitoryAccessGrant.findFirst({
        where: { id: grantId, dormitoryId, status: 'ACTIVE' },
        include: { lineFriend: true, dormitory: true }
      });
    });

    if (!grant) {
      return { pushed: false, deliveryStatus: 'failed' };
    }

    // 2. Recover raw token
    let rawToken = rawTokenOverride;
    if (!rawToken && grant.tokenEncrypted) {
      try {
        rawToken = decryptText(grant.tokenEncrypted);
      } catch {
        rawToken = undefined;
      }
    }

    if (!rawToken) {
      await this.updateDeliveryStatus(grantId, 'failed', 'NO_RAW_TOKEN', dormitoryId);
      return { pushed: false, deliveryStatus: 'failed' };
    }

    // 3. Resolve actual LINE userId
    const actualLineUserId = await this.friendService.getActualLineUserId(dormitoryId, grant.lineFriendId);
    if (!actualLineUserId) {
      await this.updateDeliveryStatus(grantId, 'failed', 'NO_LINE_USER_ID', dormitoryId);
      return { pushed: false, deliveryStatus: 'failed' };
    }

    // 4. Resolve per-dormitory access token
    const accessToken = await this.lineOaService.resolveAccessToken(dormitoryId);
    if (!accessToken) {
      await this.updateDeliveryStatus(grantId, 'failed', 'NO_ACCESS_TOKEN', dormitoryId);
      return { pushed: false, deliveryStatus: 'failed' };
    }

    // 5. Reserve quota & create attempt in ONE atomic transaction
    let attemptRes: { attemptId: string; lineRetryKey: string; periodKey: string };
    try {
      attemptRes = await this.pushUsageService.reserveQuotaAndCreateAttempt(dormitoryId, grantId);
    } catch (err: any) {
      if (err.errorCode === 'QUOTA_EXHAUSTED') {
        await this.updateDeliveryStatus(grantId, 'quota_exhausted', 'QUOTA_EXHAUSTED', dormitoryId);
        return { pushed: false, deliveryStatus: 'quota_exhausted' };
      }
      throw err;
    }

    // 6. Build flex message with exact bearer URL fragment #<rawToken>
    const baseUrl = process.env.PUBLIC_APP_URL || 'https://app.horplus.com';
    const flexMessage = this.buildFlexMessage(grant.dormitory.name, grant.roleCode, baseUrl, rawToken);

    // 7. Call LINE Push API (OUTSIDE any database transaction)
    const pushResult: LinePushResult = await this.lineAdapter.pushMessage(
      actualLineUserId,
      flexMessage,
      accessToken,
      attemptRes.lineRetryKey
    );

    // 8. Finalize delivery attempt atomically & idempotently
    return await this.pushUsageService.finalizeDeliveryAttempt(attemptRes.attemptId, dormitoryId, grantId, pushResult);
  }

  /**
   * Retry delivery for a grant.
   * Reuses existing attempt for RETRY_PENDING if within 24h.
   * If > 24h, marks attempt EXPIRED and returns retry_window_expired.
   */
  async retryDelivery(grantId: string, dormitoryId: string): Promise<{ pushed: boolean; deliveryStatus: string }> {
    const grant = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;
      return await tx.dormitoryAccessGrant.findFirst({
        where: { id: grantId, dormitoryId, status: 'ACTIVE' }
      });
    });

    if (!grant) {
      throw new AppError('Active access grant not found', 404, 'ACCESS_GRANT_NOT_FOUND');
    }

    const currentStatus = grant.lastDeliveryStatus;
    if (currentStatus === 'sent') {
      throw new AppError('Grant has already been delivered successfully', 400, 'ALREADY_DELIVERED');
    }

    // For RETRY_PENDING, check if attempt is within 24h lifetime
    if (currentStatus === 'retry_pending') {
      const pendingAttempt = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;
        return await tx.linePushDeliveryAttempt.findFirst({
          where: { accessGrantId: grantId, status: 'RETRY_PENDING' },
          orderBy: { createdAt: 'desc' }
        });
      });

      if (pendingAttempt) {
        const now = new Date();
        const isExpired = pendingAttempt.retryKeyExpiresAt
          ? now > pendingAttempt.retryKeyExpiresAt
          : (now.getTime() - pendingAttempt.createdAt.getTime()) > 24 * 60 * 60 * 1000;

        if (isExpired) {
          await this.pushUsageService.markAttemptExpired(pendingAttempt.id, dormitoryId, grantId, pendingAttempt.periodKey);
          return { pushed: false, deliveryStatus: 'retry_window_expired' };
        }

        return await this.retryWithExistingAttempt(grantId, dormitoryId, pendingAttempt);
      }
    }

    // For FAILED, QUOTA_EXHAUSTED, or RETRY_WINDOW_EXPIRED: create new delivery attempt
    return await this.deliverAccessGrant(grantId, dormitoryId);
  }

  /**
   * Retry using an existing delivery attempt's LINE retry key within 24h.
   */
  private async retryWithExistingAttempt(
    grantId: string,
    dormitoryId: string,
    attempt: any
  ): Promise<{ pushed: boolean; deliveryStatus: string }> {
    const grant = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;
      return await tx.dormitoryAccessGrant.findFirst({
        where: { id: grantId, dormitoryId, status: 'ACTIVE' },
        include: { lineFriend: true, dormitory: true }
      });
    });

    if (!grant) return { pushed: false, deliveryStatus: 'failed' };

    const rawToken = grant.tokenEncrypted ? decryptText(grant.tokenEncrypted) : null;
    if (!rawToken) return { pushed: false, deliveryStatus: 'failed' };

    const actualLineUserId = await this.friendService.getActualLineUserId(dormitoryId, grant.lineFriendId);
    if (!actualLineUserId) return { pushed: false, deliveryStatus: 'failed' };

    const accessToken = await this.lineOaService.resolveAccessToken(dormitoryId);
    if (!accessToken) return { pushed: false, deliveryStatus: 'failed' };

    const baseUrl = process.env.PUBLIC_APP_URL || 'https://app.horplus.com';
    const flexMessage = this.buildFlexMessage(grant.dormitory.name, grant.roleCode, baseUrl, rawToken);

    // Reuse the SAME LINE retry key
    const pushResult = await this.lineAdapter.pushMessage(
      actualLineUserId,
      flexMessage,
      accessToken,
      attempt.lineRetryKey
    );

    return await this.pushUsageService.finalizeDeliveryAttempt(attempt.id, dormitoryId, grantId, pushResult);
  }

  private buildFlexMessage(dormitoryName: string, roleCode: string, baseUrl: string, rawToken: string) {
    return {
      type: 'flex',
      altText: `คุณได้รับสิทธิ์เข้าใช้งาน ${dormitoryName}`,
      contents: {
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: 'HorPlus Access Grant', weight: 'bold', size: 'xs', color: '#10B981' },
            { type: 'text', text: dormitoryName, weight: 'bold', size: 'xl', margin: 'md' },
            { type: 'text', text: `สิทธิ์: ${roleCode}`, size: 'sm', color: '#6B7280', margin: 'sm' },
            {
              type: 'button',
              style: 'primary',
              color: '#2563EB',
              margin: 'lg',
              action: {
                type: 'uri',
                label: 'เปิด HorPlus',
                uri: `${baseUrl}/staff-access#${rawToken}`
              }
            }
          ]
        }
      }
    };
  }

  private async updateDeliveryStatus(grantId: string, status: string, errorCode: string | null, dormitoryId: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;
      await tx.dormitoryAccessGrant.update({
        where: { id: grantId },
        data: {
          lastDeliveryStatus: status,
          lastDeliveryAttemptAt: new Date(),
          lastDeliverySuccessAt: status === 'sent' ? new Date() : undefined,
          lastDeliveryErrorCode: errorCode
        }
      });
    });
  }

  /**
   * Redeem bearer raw token via narrow SECURITY DEFINER resolver & issue SessionToken + CSRF
   */
  async redeemAccessGrant(rawToken: string, userAgentHash?: string, ipMetadata?: string) {
    if (!rawToken) {
      throw new AppError('Bearer access token is required', 400, 'MISSING_BEARER_TOKEN');
    }

    const tokenHash = hashToken(rawToken);

    // 1. Narrow SECURITY DEFINER lookup (returns grant_id and dormitory_id ONLY)
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT grant_id, dormitory_id FROM public.resolve_access_grant_token(${tokenHash})
    `;

    if (!rows || rows.length === 0) {
      throw new AppError('Access grant link has been revoked or is invalid', 401, 'ACCESS_GRANT_REVOKED');
    }

    const { grant_id: grantId, dormitory_id: dormitoryId } = rows[0];

    // 2. Read full grant under normal RLS context
    const grant = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;
      return await tx.dormitoryAccessGrant.findFirst({
        where: { id: grantId, status: 'ACTIVE' },
        include: { dormitory: true, lineFriend: true }
      });
    });

    if (!grant || grant.status !== 'ACTIVE') {
      throw new AppError('Access grant link has been revoked or is invalid', 401, 'ACCESS_GRANT_REVOKED');
    }

    // 3. Create Session with dormitoryId set
    const sessionId = crypto.randomUUID();
    const sessionIdHash = SessionTokenService.hashSessionId(sessionId);
    const ttlSeconds = 30 * 24 * 60 * 60; // 30 days

    const session = await this.prisma.session.create({
      data: {
        userId: undefined,
        principalType: 'ACCESS_GRANT',
        accessGrantId: grant.id,
        sessionIdHash,
        tokenVersion: grant.version,
        status: 'active',
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
        userAgentHash,
        ipMetadata
      }
    });

    const sessionToken = this.sessionTokenService.encryptToken(
      { sub: `ag_${grant.id}`, sid: sessionId, type: 'session', version: grant.version },
      ttlSeconds
    );

    // 4. Generate CSRF token for the session
    const csrfToken = SessionTokenService.hashSessionId(`csrf_${sessionId}`);

    return {
      sessionToken,
      csrfToken,
      grant: {
        id: grant.id,
        dormitoryId: grant.dormitoryId,
        dormitoryName: grant.dormitory.name,
        roleCode: grant.roleCode,
        friendDisplayName: grant.lineFriend.displayName,
        pictureUrl: grant.lineFriend.pictureUrl
      }
    };
  }

  /**
   * Change Role of an active Access Grant
   */
  async changeGrantRole(
    dormitoryId: string,
    grantId: string,
    newRoleCode: 'OWNER' | 'MANAGER' | 'TECH',
    updatedByPrincipal: string
  ) {
    if (!['OWNER', 'MANAGER', 'TECH'].includes(newRoleCode)) {
      throw new AppError('Role must be OWNER, MANAGER, or TECH', 400, 'INVALID_ROLE_CODE');
    }

    return await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;
      const grant = await tx.dormitoryAccessGrant.findFirst({
        where: { id: grantId, dormitoryId }
      });

      if (!grant || grant.status !== 'ACTIVE') {
        throw new AppError('Active access grant not found', 404, 'ACCESS_GRANT_NOT_FOUND');
      }

      const updated = await tx.dormitoryAccessGrant.update({
        where: { id: grantId },
        data: {
          roleCode: newRoleCode,
          version: grant.version + 1,
          lastRoleChangedAt: new Date()
        }
      });

      const actorUserId = parseActorUserId(updatedByPrincipal);
      await tx.auditLog.create({
        data: {
          dormitoryId,
          actorUserId,
          action: 'ACCESS_GRANT_ROLE_CHANGED',
          entityType: 'DormitoryAccessGrant',
          entityId: grantId,
          beforeValues: { roleCode: grant.roleCode },
          afterValues: { roleCode: newRoleCode, version: updated.version }
        }
      });

      return updated;
    });
  }

  /**
   * Revoke an Access Grant immediately
   */
  async revokeAccessGrant(dormitoryId: string, grantId: string, revokedByPrincipal: string) {
    return await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;
      const grant = await tx.dormitoryAccessGrant.findFirst({
        where: { id: grantId, dormitoryId }
      });

      if (!grant || grant.status !== 'ACTIVE') {
        throw new AppError('Active access grant not found', 404, 'ACCESS_GRANT_NOT_FOUND');
      }

      const revokedGrant = await tx.dormitoryAccessGrant.update({
        where: { id: grantId },
        data: {
          status: 'REVOKED',
          revokedAt: new Date(),
          revokedByPrincipal
        }
      });

      await tx.session.updateMany({
        where: { accessGrantId: grantId, status: 'active' },
        data: {
          status: 'revoked',
          revokedAt: new Date(),
          revokedReason: 'ACCESS_GRANT_REVOKED'
        }
      });

      const actorUserId = parseActorUserId(revokedByPrincipal);
      await tx.auditLog.create({
        data: {
          dormitoryId,
          actorUserId,
          action: 'ACCESS_GRANT_REVOKED',
          entityType: 'DormitoryAccessGrant',
          entityId: grantId,
          beforeValues: { status: 'ACTIVE' },
          afterValues: { status: 'REVOKED' }
        }
      });

      return revokedGrant;
    });
  }

  /**
   * List all staff members and access grants for a dormitory
   */
  async listDormitoryStaff(dormitoryId: string) {
    return await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;

      const members = await tx.dormitoryMember.findMany({
        where: { dormitoryId, status: 'active' },
        include: { user: true, role: true }
      });

      const activeGrants = await tx.dormitoryAccessGrant.findMany({
        where: { dormitoryId, status: 'ACTIVE' },
        include: { lineFriend: true },
        orderBy: { createdAt: 'desc' }
      });

      const googleOwners = members
        .filter((m) => m.membershipOrigin === 'GOOGLE_BOOTSTRAP' && m.role.code === 'OWNER')
        .map((m) => ({
          id: m.id,
          type: 'PERMANENT_GOOGLE_OWNER',
          displayName: m.user.name || m.user.email || 'Owner',
          email: m.user.email,
          roleCode: m.role.code,
          roleName: m.role.name,
          membershipOrigin: m.membershipOrigin,
          label: 'เจ้าของหลัก',
          isPermanent: true,
          canRevoke: false,
          canChangeRole: false
        }));

      const legacyMembers = members
        .filter((m) => m.membershipOrigin !== 'GOOGLE_BOOTSTRAP' || m.role.code !== 'OWNER')
        .map((m) => ({
          id: m.id,
          type: 'LEGACY_MEMBER',
          displayName: m.user.name || m.user.email || 'Staff Member',
          email: m.user.email,
          roleCode: m.role.code,
          roleName: m.role.name,
          membershipOrigin: m.membershipOrigin,
          label: m.role.name || 'พนักงาน',
          isPermanent: false,
          canRevoke: true,
          canChangeRole: true
        }));

      const grants = activeGrants.map((g) => ({
        id: g.id,
        type: 'ACCESS_GRANT',
        lineFriendId: g.lineFriendId,
        displayName: g.lineFriend.displayName,
        pictureUrl: g.lineFriend.pictureUrl,
        roleCode: g.roleCode,
        status: g.status,
        version: g.version,
        tokenPrefix: g.tokenPrefix,
        createdAt: g.createdAt,
        lastDeliveryStatus: g.lastDeliveryStatus,
        isPermanent: false,
        canRevoke: true,
        canChangeRole: true
      }));

      const slotUsage = await this.getSlotUsage(dormitoryId, tx);
      const quotaStatus = await this.pushUsageService.getQuotaStatus(dormitoryId);

      return {
        permanentOwners: googleOwners,
        legacyMembers,
        accessGrants: grants,
        slotUsage,
        pushQuota: quotaStatus
      };
    });
  }

  private hashStringToInteger(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return hash;
  }
}
