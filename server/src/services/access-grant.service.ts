/**
 * Revocable Bearer Access Grant Service (Task-009 Final Product Model)
 * @license Apache-2.0
 */

import { PrismaClient } from '@prisma/client';
import { generateGrantToken, hashToken } from '../utils/crypto-encryption.js';
import { AppError } from '../types/index.js';
import { LinePlatformAdapter, MockLinePlatformAdapter } from './line-platform-adapter.js';

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function parseActorUserId(principal: string): string | null {
  if (!principal) return null;
  const cleaned = principal.startsWith('usr_') ? principal.replace('usr_', '') : principal;
  return UUID_REGEX.test(cleaned) ? cleaned : null;
}

export class AccessGrantService {
  private lineAdapter: LinePlatformAdapter;

  constructor(private prisma: PrismaClient, adapter?: LinePlatformAdapter) {
    this.lineAdapter = adapter || new MockLinePlatformAdapter();
  }

  /**
   * Get total slot usage for a dormitory
   */
  async getSlotUsage(dormitoryId: string, tx?: any) {
    const db = tx || this.prisma;

    const googleOwnersCount = await db.dormitoryMember.count({
      where: {
        dormitoryId,
        status: 'active'
      }
    });

    const activeGrantsCount = await db.dormitoryAccessGrant.count({
      where: {
        dormitoryId,
        status: 'ACTIVE'
      }
    });

    return {
      googleOwnersCount,
      activeGrantsCount,
      totalUsedSlots: googleOwnersCount + activeGrantsCount,
      maxSlots: 10
    };
  }

  /**
   * Create a new Access Grant with PostgreSQL advisory transaction lock
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

    return await this.prisma.$transaction(async (tx) => {
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
        where: {
          dormitoryId,
          lineFriendId,
          status: 'ACTIVE'
        }
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
          createdByPrincipal
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

      const flexMessage = {
        type: 'flex',
        altText: `คุณได้รับสิทธิ์เข้าใช้งาน ${grant.dormitory.name}`,
        contents: {
          type: 'bubble',
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: 'HorPlus Access Grant', weight: 'bold', size: 'xs', color: '#10B981' },
              { type: 'text', text: grant.dormitory.name, weight: 'bold', size: 'xl', margin: 'md' },
              { type: 'text', text: `สิทธิ์: ${roleCode}`, size: 'sm', color: '#6B7280', margin: 'sm' },
              {
                type: 'button',
                style: 'primary',
                color: '#2563EB',
                margin: 'lg',
                action: {
                  type: 'uri',
                  label: 'เปิด HorPlus',
                  uri: bearerUrl
                }
              }
            ]
          }
        }
      };

      // Server-side push message submission attempt via adapter
      const pushResult = await this.lineAdapter.pushMessage(friend.id, flexMessage).catch(() => ({ success: false }));

      return {
        grant,
        rawToken,
        bearerUrl,
        flexMessage,
        pushed: pushResult.success
      };
    });
  }

  /**
   * Redeem bearer raw token and issue HttpOnly session
   */
  async redeemAccessGrant(rawToken: string, userAgentHash?: string, ipMetadata?: string) {
    if (!rawToken) {
      throw new AppError('Bearer access token is required', 400, 'MISSING_BEARER_TOKEN');
    }

    const tokenHash = hashToken(rawToken);

    const grant = await this.prisma.dormitoryAccessGrant.findUnique({
      where: { tokenHash },
      include: {
        dormitory: true,
        lineFriend: true
      }
    });

    if (!grant || grant.status !== 'ACTIVE') {
      throw new AppError('Access grant link has been revoked or is invalid', 401, 'ACCESS_GRANT_REVOKED');
    }

    // Create session for access grant principal
    const rawSessionId = 'ag_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
    const sessionIdHash = hashToken(rawSessionId);

    const session = await this.prisma.session.create({
      data: {
        userId: null,
        principalType: 'ACCESS_GRANT',
        accessGrantId: grant.id,
        sessionIdHash,
        tokenVersion: grant.version,
        status: 'active',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        userAgentHash,
        ipMetadata
      }
    });

    return {
      rawSessionId,
      session,
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
   * Revoke an Access Grant immediately releasing slot and revoking all active sessions
   */
  async revokeAccessGrant(dormitoryId: string, grantId: string, revokedByPrincipal: string) {
    return await this.prisma.$transaction(async (tx) => {
      const grant = await tx.dormitoryAccessGrant.findFirst({
        where: { id: grantId, dormitoryId }
      });

      if (!grant || grant.status !== 'ACTIVE') {
        throw new AppError('Active access grant not found', 404, 'ACCESS_GRANT_NOT_FOUND');
      }

      // Mark grant REVOKED
      const revokedGrant = await tx.dormitoryAccessGrant.update({
        where: { id: grantId },
        data: {
          status: 'REVOKED',
          revokedAt: new Date(),
          revokedByPrincipal
        }
      });

      // Revoke all sessions created from this grant
      await tx.session.updateMany({
        where: {
          accessGrantId: grantId,
          status: 'active'
        },
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
      include: {
        user: true,
        role: true
      }
    });

    const activeGrants = await this.prisma.dormitoryAccessGrant.findMany({
      where: { dormitoryId, status: 'ACTIVE' },
      include: {
        lineFriend: true
      },
      orderBy: { createdAt: 'desc' }
    });

    const googleOwners = members.map((m) => ({
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
      isPermanent: false,
      canRevoke: true,
      canChangeRole: true
    }));

    const slotUsage = await this.getSlotUsage(dormitoryId);

    return {
      permanentOwners: googleOwners,
      accessGrants: grants,
      slotUsage
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
