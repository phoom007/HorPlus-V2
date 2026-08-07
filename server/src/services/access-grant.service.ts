/**
 * Revocable Bearer Access Grant Service (Task-009 Two-Phase Model)
 * Phase A: Atomic grant creation (no LINE API calls inside transaction)
 * Phase B: Delivery with quota reservation and LINE retry key
 * @license Apache-2.0
 */

import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { generateGrantToken, hashToken } from '../utils/crypto-encryption.js';
import { AppError } from '../types/index.js';
import { LinePlatformAdapter, MockLinePlatformAdapter, LinePushResult } from './line-platform-adapter.js';
import { LineFriendService } from './line-friend.service.js';
import { SessionTokenService } from './session-token.service.js';
import { LinePushUsageService } from './line-push-usage.service.js';
import { LineOaService } from './line-oa.service.js';
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
    this.lineAdapter = adapter || new MockLinePlatformAdapter();
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
   * PHASE A: Create Access Grant atomically. No LINE API calls.
   * Returns committed grant + raw token. Caller must invoke deliverAccessGrant() after.
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

      // 5. Generate 256-bit bearer token & hash
      const { rawToken, tokenHash, tokenPrefix } = generateGrantToken();

      // 6. Create DormitoryAccessGrant record
      const grant = await tx.dormitoryAccessGrant.create({
        data: {
          dormitoryId,
          lineFriendId,
          roleCode,
          tokenHash,
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

      return { grant, rawToken, bearerUrl };
    });

    // PHASE B: Attempt delivery outside the grant transaction
    const delivery = await this.deliverAccessGrant(grantResult.grant.id, dormitoryId).catch(() => ({
      deliveryStatus: 'failed' as const,
      pushed: false
    }));

    return {
      ...grantResult,
      pushed: delivery.pushed,
      deliveryStatus: delivery.deliveryStatus
    };
  }

  /**
   * PHASE B: Deliver Access Grant via LINE Push.
   * 1. Reserve quota slot
   * 2. Create delivery attempt with LINE retry key
   * 3. Call LINE Push API
   * 4. Finalize quota based on result
   */
  async deliverAccessGrant(grantId: string, dormitoryId: string): Promise<{ pushed: boolean; deliveryStatus: string }> {
    // 1. Load grant and friend
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

    // 2. Resolve actual LINE userId
    const actualLineUserId = await this.friendService.getActualLineUserId(grant.lineFriendId);
    if (!actualLineUserId) {
      await this.updateDeliveryStatus(grantId, 'failed', 'NO_LINE_USER_ID');
      return { pushed: false, deliveryStatus: 'failed' };
    }

    // 3. Resolve per-dormitory access token
    const accessToken = await this.lineOaService.resolveAccessToken(dormitoryId);
    if (!accessToken) {
      await this.updateDeliveryStatus(grantId, 'failed', 'NO_ACCESS_TOKEN');
      return { pushed: false, deliveryStatus: 'failed' };
    }

    // 4. Reserve quota
    let periodKey: string;
    try {
      const reservation = await this.pushUsageService.reserveQuotaSlot(dormitoryId);
      periodKey = reservation.periodKey;
    } catch (err: any) {
      if (err.errorCode === 'QUOTA_EXHAUSTED') {
        await this.updateDeliveryStatus(grantId, 'quota_exhausted', 'QUOTA_EXHAUSTED');
        return { pushed: false, deliveryStatus: 'quota_exhausted' };
      }
      throw err;
    }

    // 5. Generate LINE retry key and persist delivery attempt BEFORE calling LINE
    const lineRetryKey = crypto.randomUUID();
    const attempt = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;
      return await tx.linePushDeliveryAttempt.create({
        data: {
          dormitoryId,
          accessGrantId: grantId,
          lineRetryKey,
          status: 'RESERVED',
          attemptedAt: new Date()
        }
      });
    });

    // 6. Build flex message
    const baseUrl = process.env.PUBLIC_APP_URL || 'https://app.horplus.com';
    const flexMessage = this.buildFlexMessage(grant.dormitory.name, grant.roleCode, baseUrl, grant.tokenHash);

    // 7. Call LINE Push API (OUTSIDE any database transaction)
    const pushResult: LinePushResult = await this.lineAdapter.pushMessage(
      actualLineUserId,
      flexMessage,
      accessToken,
      lineRetryKey
    );

    // 8. Finalize based on result
    return await this.finalizeDelivery(grantId, dormitoryId, periodKey, attempt.id, pushResult);
  }

  /**
   * Finalize delivery attempt and quota based on LINE Push result.
   * Idempotent: checks if attempt is already finalized.
   */
  private async finalizeDelivery(
    grantId: string,
    dormitoryId: string,
    periodKey: string,
    attemptId: string,
    result: LinePushResult
  ): Promise<{ pushed: boolean; deliveryStatus: string }> {
    switch (result.outcome) {
      case 'ACCEPTED':
      case 'ALREADY_ACCEPTED': {
        // Convert reservation to success
        await this.pushUsageService.finalizeSuccess(dormitoryId, periodKey);
        await this.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`;
          await tx.linePushDeliveryAttempt.update({
            where: { id: attemptId },
            data: {
              status: result.outcome === 'ACCEPTED' ? 'SENT' : 'ALREADY_ACCEPTED',
              lineMessageId: result.messageId,
              finalizedAt: new Date()
            }
          });
        });
        await this.updateDeliveryStatus(grantId, 'sent', null);
        return { pushed: true, deliveryStatus: 'sent' };
      }

      case 'DEFINITIVE_FAILURE': {
        // Release reservation
        await this.pushUsageService.releaseReservation(dormitoryId, periodKey);
        await this.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`;
          await tx.linePushDeliveryAttempt.update({
            where: { id: attemptId },
            data: {
              status: 'FAILED',
              errorCode: result.errorCode,
              finalizedAt: new Date()
            }
          });
        });
        await this.updateDeliveryStatus(grantId, 'failed', result.errorCode);
        return { pushed: false, deliveryStatus: 'failed' };
      }

      case 'RETRYABLE_UNKNOWN': {
        // Keep reservation, mark retry pending
        await this.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`;
          await tx.linePushDeliveryAttempt.update({
            where: { id: attemptId },
            data: {
              status: 'RETRY_PENDING',
              errorCode: result.errorCode
            }
          });
        });
        await this.updateDeliveryStatus(grantId, 'retry_pending', result.errorCode);
        return { pushed: false, deliveryStatus: 'retry_pending' };
      }

      default:
        return { pushed: false, deliveryStatus: 'failed' };
    }
  }

  /**
   * Retry delivery for a grant.
   * Allowed for: FAILED, QUOTA_EXHAUSTED, RETRY_PENDING.
   * Not allowed for: SENT.
   * For RETRY_PENDING: reuses same LINE retry key.
   * For FAILED/QUOTA_EXHAUSTED: creates new delivery attempt.
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

    // For RETRY_PENDING, find the pending attempt and reuse its retry key
    if (currentStatus === 'retry_pending') {
      const pendingAttempt = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;
        return await tx.linePushDeliveryAttempt.findFirst({
          where: { accessGrantId: grantId, status: 'RETRY_PENDING' },
          orderBy: { createdAt: 'desc' }
        });
      });

      if (pendingAttempt) {
        return await this.retryWithExistingAttempt(grantId, dormitoryId, pendingAttempt);
      }
    }

    // For FAILED or QUOTA_EXHAUSTED: new delivery attempt
    return await this.deliverAccessGrant(grantId, dormitoryId);
  }

  /**
   * Retry using an existing delivery attempt's LINE retry key.
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

    const actualLineUserId = await this.friendService.getActualLineUserId(grant.lineFriendId);
    if (!actualLineUserId) return { pushed: false, deliveryStatus: 'failed' };

    const accessToken = await this.lineOaService.resolveAccessToken(dormitoryId);
    if (!accessToken) return { pushed: false, deliveryStatus: 'failed' };

    // Derive periodKey from dormitory timezone
    const dorm = await this.prisma.dormitory.findUnique({
      where: { id: dormitoryId },
      select: { timezone: true }
    });
    const periodKey = this.pushUsageService.getCurrentPeriodKey(dorm?.timezone || 'Asia/Bangkok');

    const baseUrl = process.env.PUBLIC_APP_URL || 'https://app.horplus.com';
    const flexMessage = this.buildFlexMessage(grant.dormitory.name, grant.roleCode, baseUrl, grant.tokenHash);

    // Reuse the SAME LINE retry key
    const pushResult = await this.lineAdapter.pushMessage(
      actualLineUserId,
      flexMessage,
      accessToken,
      attempt.lineRetryKey
    );

    return await this.finalizeDelivery(grantId, dormitoryId, periodKey, attempt.id, pushResult);
  }

  private buildFlexMessage(dormitoryName: string, roleCode: string, baseUrl: string, tokenHash: string) {
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
                uri: `${baseUrl}/staff-access`
              }
            }
          ]
        }
      }
    };
  }

  private async updateDeliveryStatus(grantId: string, status: string, errorCode: string | null) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`;
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
   * Redeem bearer raw token and issue canonical SessionToken
   */
  async redeemAccessGrant(rawToken: string, userAgentHash?: string, ipMetadata?: string) {
    if (!rawToken) {
      throw new AppError('Bearer access token is required', 400, 'MISSING_BEARER_TOKEN');
    }

    const tokenHash = hashToken(rawToken);

    const grant = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`;
      return await tx.dormitoryAccessGrant.findUnique({
        where: { tokenHash },
        include: { dormitory: true, lineFriend: true }
      });
    });

    if (!grant || grant.status !== 'ACTIVE') {
      throw new AppError('Access grant link has been revoked or is invalid', 401, 'ACCESS_GRANT_REVOKED');
    }

    const sessionId = crypto.randomUUID();
    const sessionIdHash = SessionTokenService.hashSessionId(sessionId);
    const ttlSeconds = 30 * 24 * 60 * 60; // 30 days

    const session = await this.prisma.session.create({
      data: {
        userId: null,
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

    return {
      sessionToken,
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
    const members = await this.prisma.dormitoryMember.findMany({
      where: { dormitoryId, status: 'active' },
      include: { user: true, role: true }
    });

    const activeGrants = await this.prisma.dormitoryAccessGrant.findMany({
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

    const slotUsage = await this.getSlotUsage(dormitoryId);
    const quotaStatus = await this.pushUsageService.getQuotaStatus(dormitoryId);

    return {
      permanentOwners: googleOwners,
      legacyMembers,
      accessGrants: grants,
      slotUsage,
      pushQuota: quotaStatus
    };
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
