/**
 * @license Apache-2.0
 * Tenant Claim Service (LOCAL-07 Batch 02)
 * Manages privacy-masked candidate discovery with time/status-aware Decision 2A priority:
 * Priority 1: Current ACTIVE Tenant
 * Priority 2: Nearest Future RESERVED Tenant
 * Priority 3: Fail-Closed on Ambiguity
 * Historical Ignored (ENDED/CANCELLED/CHECKED_OUT)
 */

import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../db/prisma.js';
import { AuditService } from './audit.service.js';
import {
  normalizeThaiPhone,
  calculateNameSimilarity,
  maskThaiCandidateName,
  maskPhone,
} from '../utils/thai-identity.util.js';

export interface ClaimCandidateResult {
  hasCandidate: boolean;
  roomId?: string;
  roomNumber?: string;
  maskedName?: string;
  maskedPhone?: string | null;
}

export interface ClaimTenantDto {
  dormitoryId: string;
  roomId?: string;
  roomNumber?: string;
  claimInput: string; // phone or full name
  allowAdditionalRoom?: boolean;
}

interface EvaluatedTenantCandidate {
  tenant: any;
  isActive: boolean;
  isReserved: boolean;
  earliestReservedDate: Date | null;
}

export class TenantClaimService {
  constructor(
    private prisma: PrismaClient = getPrismaClient(),
    private auditService?: AuditService
  ) {}

  /**
   * Evaluates and selects exactly ONE authoritative candidate according to Decision 2A:
   * Priority 1: Current ACTIVE Tenant (if exactly 1 active)
   * Priority 2: Nearest Future RESERVED Tenant (if 0 active, 1 strictly earliest reserved)
   * Priority 3: Fail-Closed on Ambiguity (multiple active, tied nearest reserved -> returns null)
   * Historical Ignored: ENDED/CANCELLED/CHECKED_OUT tenants are excluded.
   */
  public async selectAuthoritativeCandidate(
    dormitoryId: string,
    roomId: string,
    prismaClient: any = this.prisma,
    effectiveDate?: string | Date
  ): Promise<any | null> {
    const unlinkedTenants = await prismaClient.tenant.findMany({
      where: {
        dormitoryId,
        status: 'active',
        linkedUserId: null,
        lineFriendId: null,
        deletedAt: null,
        OR: [
          {
            occupancies: {
              some: {
                roomId,
                status: { in: ['ACTIVE', 'RESERVED'] },
              },
            },
          },
          {
            provisionalRentalTerms: {
              some: {
                roomId,
                status: { in: ['ACTIVE', 'RESERVED'] },
                deletedAt: null,
              },
            },
          },
          {
            dailyStays: {
              some: {
                roomId,
                status: { in: ['ACTIVE', 'RESERVED'] },
                deletedAt: null,
              },
            },
          },
        ],
      },
      include: {
        occupancies: {
          where: { roomId, status: { in: ['ACTIVE', 'RESERVED'] } },
        },
        provisionalRentalTerms: {
          where: { roomId, status: { in: ['ACTIVE', 'RESERVED'] }, deletedAt: null },
        },
        dailyStays: {
          where: { roomId, status: { in: ['ACTIVE', 'RESERVED'] }, deletedAt: null },
        },
      },
    });

    if (unlinkedTenants.length === 0) {
      return null;
    }

    const nowThreshold = effectiveDate
      ? (typeof effectiveDate === 'string' ? new Date(effectiveDate) : effectiveDate)
      : new Date();

    // Evaluate each tenant's active/reserved status on this room
    const evaluated: EvaluatedTenantCandidate[] = unlinkedTenants.map((t: any) => {
      const activeOcc = t.occupancies.some((o: any) => o.status === 'ACTIVE');
      const activeProv = t.provisionalRentalTerms.some((p: any) => p.status === 'ACTIVE');
      const activeDaily = t.dailyStays.some((d: any) => d.status === 'ACTIVE');
      const isActive = activeOcc || activeProv || activeDaily;

      const reservedOccs = t.occupancies.filter((o: any) => o.status === 'RESERVED');
      const reservedProvs = t.provisionalRentalTerms.filter((p: any) => p.status === 'RESERVED');
      const reservedDailies = t.dailyStays.filter((d: any) => d.status === 'RESERVED');

      // Filter reserved dates to strictly future dates (relative to effectiveDate threshold)
      const reservedDates: Date[] = [];
      reservedOccs.forEach((o: any) => {
        if (o.startedAt) {
          const d = new Date(o.startedAt);
          if (d.getTime() > nowThreshold.getTime()) reservedDates.push(d);
        }
      });
      reservedProvs.forEach((p: any) => {
        if (p.startDate) {
          const d = new Date(p.startDate);
          if (d.getTime() > nowThreshold.getTime()) reservedDates.push(d);
        }
      });
      reservedDailies.forEach((daily: any) => {
        if (daily.startDate) {
          const dt = new Date(daily.startDate);
          if (dt.getTime() > nowThreshold.getTime()) reservedDates.push(dt);
        }
      });

      const isReserved = reservedDates.length > 0;
      let earliestReservedDate: Date | null = null;
      if (reservedDates.length > 0) {
        earliestReservedDate = new Date(Math.min(...reservedDates.map((d) => d.getTime())));
      }

      return {
        tenant: t,
        isActive,
        isReserved,
        earliestReservedDate,
      };
    });

    // Decision 2A Priority 1: Check for ACTIVE candidates
    const activeCandidates = evaluated.filter((e) => e.isActive);
    if (activeCandidates.length === 1) {
      return activeCandidates[0].tenant;
    }
    if (activeCandidates.length > 1) {
      // Priority 3: Ambiguity fail closed
      if (this.auditService) {
        await this.auditService.logSecurityEvent({
          action: 'tenant.claim.ambiguity_detected',
          dormitoryId,
          details: { roomId, reason: 'multiple_active_unlinked_candidates', count: activeCandidates.length },
        });
      }
      return null;
    }

    // Decision 2A Priority 2: Check for nearest future RESERVED candidates (when 0 active)
    const reservedCandidates = evaluated.filter((e) => e.isReserved && e.earliestReservedDate !== null);
    if (reservedCandidates.length === 0) {
      return null;
    }

    if (reservedCandidates.length === 1) {
      return reservedCandidates[0].tenant;
    }

    // Sort by earliest reserved start date
    reservedCandidates.sort((a, b) => a.earliestReservedDate!.getTime() - b.earliestReservedDate!.getTime());

    const first = reservedCandidates[0];
    const second = reservedCandidates[1];

    // Strictly earliest nearest start date
    if (first.earliestReservedDate!.getTime() < second.earliestReservedDate!.getTime()) {
      return first.tenant;
    }

    // Equal nearest start date -> Priority 3: Ambiguity fail closed
    if (this.auditService) {
      await this.auditService.logSecurityEvent({
        action: 'tenant.claim.ambiguity_detected',
        dormitoryId,
        details: { roomId, reason: 'equal_nearest_reserved_dates', tieDate: first.earliestReservedDate },
      });
    }
    return null;
  }

  /**
   * Pre-link candidate discovery:
   * Returns privacy-masked tenant candidate for a room in a dormitory
   */
  public async getCandidateForRoom(
    dormitoryId: string,
    roomRef: string | { roomId?: string; roomNumber?: string },
    effectiveDate?: string | Date
  ): Promise<ClaimCandidateResult> {
    const roomWhere: any = {
      dormitoryId,
      deletedAt: null,
      status: { not: 'archived' },
    };
    if (typeof roomRef === 'string') {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(roomRef);
      if (isUuid) {
        roomWhere.id = roomRef;
      } else {
        return { hasCandidate: false };
      }
    } else {
      if (roomRef.roomNumber) roomWhere.roomNumber = roomRef.roomNumber;
      if (roomRef.roomId) {
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(roomRef.roomId);
        if (isUuid) {
          roomWhere.id = roomRef.roomId;
        } else if (!roomRef.roomNumber) {
          return { hasCandidate: false };
        }
      }
    }

    const room = await this.prisma.room.findFirst({
      where: roomWhere,
    });

    if (!room) {
      return { hasCandidate: false };
    }

    const tenant = await this.selectAuthoritativeCandidate(dormitoryId, room.id, this.prisma, effectiveDate);

    if (!tenant) {
      return { hasCandidate: false };
    }

    const rawName = tenant.displayName || tenant.firstName;
    return {
      hasCandidate: true,
      roomId: room.id,
      roomNumber: room.roomNumber,
      maskedName: maskThaiCandidateName(rawName),
    };
  }

  /**
   * Executes Tenant Self-Claim:
   * In 1 atomic transaction:
   * 1. Room advisory lock
   * 2. Select authoritative candidate under Decision 2A
   * 3. Match against claimInput (exact phone or Thai name similarity >= 0.90)
   * 4. Verify existing DormitoryMember membership:
   *    - If no membership: create membership with target/global TENANT role
   *    - If existing membership is TENANT: ensure active
   *    - If existing membership is non-TENANT (OWNER/MANAGER/STAFF): fail closed with CLAIM_MEMBERSHIP_CONFLICT
   * 5. Update Tenant.linkedUserId = userId
   * 6. Audit log event
   */
  public async claimTenant(
    data: ClaimTenantDto,
    userId: string,
    ipAddress?: string,
    effectiveDate?: string | Date
  ) {
    const { dormitoryId, roomId, roomNumber, claimInput } = data;

    const trimmedInput = claimInput?.trim();
    if (!trimmedInput || trimmedInput.length < 2) {
      const err = new Error('กรุณากรอกชื่อ-นามสกุล หรือเบอร์โทรศัพท์อย่างน้อย 2 ตัวอักษร');
      (err as any).statusCode = 400;
      (err as any).code = 'VALIDATION_ERROR';
      throw err;
    }

    const isAccessGrant = userId.startsWith('ag_user_') || userId.startsWith('ag_');
    const grantId = isAccessGrant ? userId.replace(/^ag_user_|^ag_/, '') : null;
    const isUuid = (val?: string | null): val is string =>
      !!val && /^[0-9a-fA-F-]{36}$/.test(val);

    const claimResult = await this.prisma.$transaction(async (tx) => {
      // 0. Set transaction RLS context for target dormitory
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;

      // 1. Resolve Access Grant lineFriendId if synthetic userId
      let grantLineFriendId: string | null = null;
      if (isAccessGrant && grantId && isUuid(grantId)) {
        const grant = await tx.dormitoryAccessGrant.findUnique({
          where: { id: grantId },
          select: { lineFriendId: true },
        });
        grantLineFriendId = grant?.lineFriendId || null;
      }

      // 1. User+Dormitory claim advisory lock (Order 1: serializes claims by the same user in this dormitory)
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'tenant_claim_user:' + userId + ':' + dormitoryId}))`;

      // 2. Verify room exists and belongs to dormitory
      const roomWhere: any = {
        dormitoryId,
        deletedAt: null,
        status: { not: 'archived' },
      };
      if (roomNumber) roomWhere.roomNumber = roomNumber;
      if (roomId) {
        if (isUuid(roomId)) {
          roomWhere.id = roomId;
        } else if (!roomNumber) {
          const err = new Error('ไม่พบข้อมูลผู้เช่าที่ตรงกับข้อมูลที่ระบุ');
          (err as any).statusCode = 404;
          (err as any).code = 'CLAIM_MATCH_FAILED';
          throw err;
        }
      }

      const room = await tx.room.findFirst({
        where: roomWhere,
      });

      if (!room) {
        const err = new Error('ไม่พบข้อมูลผู้เช่าที่ตรงกับข้อมูลที่ระบุ');
        (err as any).statusCode = 404;
        (err as any).code = 'CLAIM_MATCH_FAILED';
        throw err;
      }

      // 3. Room authority lock (Order 2: protects against concurrent claims in the same room)
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${dormitoryId + ':' + room.id}))`;

      // 4. One User / One Tenant per Dormitory Cardinality Check (Locked Product Decision)
      let existingLinkedTenant = null;
      if (isAccessGrant) {
        if (grantLineFriendId) {
          existingLinkedTenant = await tx.tenant.findFirst({
            where: {
              dormitoryId,
              lineFriendId: grantLineFriendId,
              deletedAt: null,
            },
          });
        }
      } else if (isUuid(userId)) {
        existingLinkedTenant = await tx.tenant.findFirst({
          where: {
            dormitoryId,
            linkedUserId: userId,
            deletedAt: null,
          },
        });
      }

      if (existingLinkedTenant && !data.allowAdditionalRoom) {
        if (this.auditService) {
          await this.auditService.logSecurityEvent({
            action: 'tenant.claim.user_already_linked',
            dormitoryId,
            userId,
            details: {
              existingTenantId: existingLinkedTenant.id,
              attemptedRoomId: room.id,
            },
          });
        }
        const err = new Error('ไม่พบข้อมูลผู้เช่าที่ตรงกับข้อมูลที่ระบุ');
        (err as any).statusCode = 404;
        (err as any).code = 'CLAIM_USER_ALREADY_LINKED_IN_DORM';
        throw err;
      }

      // 5. Find authoritative candidate using Decision 2A Priority
      const candidate = await this.selectAuthoritativeCandidate(dormitoryId, room.id, tx, effectiveDate);

      if (!candidate) {
        const err = new Error('ไม่พบข้อมูลผู้เช่าที่ตรงกับข้อมูลที่ระบุ');
        (err as any).statusCode = 404;
        (err as any).code = 'CLAIM_MATCH_FAILED';
        throw err;
      }

      if (existingLinkedTenant && candidate.id === existingLinkedTenant.id) {
        const err = new Error('คุณได้เชื่อมต่อห้องพักนี้ไว้แล้ว');
        (err as any).statusCode = 400;
        (err as any).code = 'CLAIM_ALREADY_LINKED';
        throw err;
      }

      // 6. Test match
      let isMatched = false;
      const inputPhone = normalizeThaiPhone(trimmedInput);

      // A. Phone exact match
      if (inputPhone && candidate.phone) {
        const storedPhone = normalizeThaiPhone(candidate.phone);
        if (storedPhone && storedPhone === inputPhone) {
          isMatched = true;
        }
      }

      // B. Full-name similarity >= 90%
      if (!isMatched) {
        const rawStoredName = candidate.displayName || candidate.firstName;
        const similarity = calculateNameSimilarity(rawStoredName, trimmedInput);
        if (similarity >= 0.90) {
          isMatched = true;
        }
      }

      if (!isMatched) {
        const err = new Error('ไม่พบข้อมูลผู้เช่าที่ตรงกับข้อมูลที่ระบุ');
        (err as any).statusCode = 404;
        (err as any).code = 'CLAIM_MATCH_FAILED';
        throw err;
      }

      // 7. Re-check under lock that candidate tenant.linkedUserId and lineFriendId are still null
      const freshTenant = await tx.tenant.findUnique({
        where: { id: candidate.id },
      });

      if (!freshTenant || freshTenant.linkedUserId !== null || freshTenant.lineFriendId !== null) {
        const err = new Error('ไม่พบข้อมูลผู้เช่าที่ตรงกับข้อมูลที่ระบุ');
        (err as any).statusCode = 400;
        (err as any).code = 'CLAIM_ALREADY_LINKED';
        throw err;
      }

      // 8. Check existing DormitoryMember membership (Only for real UUID users, skip for Access Grant synthetic users)
      if (!isAccessGrant && isUuid(userId)) {
        // Look up target or global TENANT role (Strictly no cross-dorm role leakage, concurrency-safe)
        let tenantRole = await tx.role.findFirst({
          where: {
            code: 'TENANT',
            OR: [
              { dormitoryId },
              { dormitoryId: null },
            ],
          },
        });

        if (!tenantRole) {
          // Dormitory-level advisory lock to serialize concurrent role creation
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'role_create:' + dormitoryId}))`;
          tenantRole = await tx.role.findFirst({
            where: {
              code: 'TENANT',
              OR: [
                { dormitoryId },
                { dormitoryId: null },
              ],
            },
          });

          if (!tenantRole) {
            tenantRole = await tx.role.create({
              data: {
                dormitoryId,
                code: 'TENANT',
                name: 'ผู้เช่า',
                permissions: ['tenant:read', 'tenant:pay'],
                isSystem: true,
              },
            });
          }
        }

        const existingMember = await tx.dormitoryMember.findUnique({
          where: {
            user_dormitory_unique: {
              userId,
              dormitoryId,
            },
          },
          include: { role: true },
        });

        if (existingMember) {
          // Existing membership is valid ONLY if role is TENANT and belongs to target dormitory or is global
          const isTargetOrGlobalTenant =
            existingMember.role?.code === 'TENANT' &&
            (existingMember.role?.dormitoryId === dormitoryId || existingMember.role?.dormitoryId === null);

          if (!isTargetOrGlobalTenant) {
            if (this.auditService) {
              await this.auditService.logSecurityEvent({
                action: 'tenant.claim.membership_conflict',
                dormitoryId,
                userId,
                details: {
                  reason:
                    existingMember.role?.code !== 'TENANT'
                      ? 'existing_non_tenant_membership'
                      : 'existing_foreign_tenant_role',
                  existingRoleId: existingMember.roleId,
                  existingRoleCode: existingMember.role?.code,
                  existingRoleDormitoryId: existingMember.role?.dormitoryId,
                  roomId: room.id,
                },
              });
            }
            const err = new Error('ไม่พบข้อมูลผู้เช่าที่ตรงกับข้อมูลที่ระบุ');
            (err as any).statusCode = 404;
            (err as any).code = 'CLAIM_MEMBERSHIP_CONFLICT';
            throw err;
          }

          if (existingMember.status !== 'active') {
            await tx.dormitoryMember.update({
              where: { id: existingMember.id },
              data: { status: 'active' },
            });
          }
        } else {
          await tx.dormitoryMember.create({
            data: {
              userId,
              dormitoryId,
              roleId: tenantRole.id,
              status: 'active',
              membershipOrigin: 'MANUAL_GRANT',
              acceptedAt: new Date(),
            },
          });
        }
      }

      // 9. Link User / LINE Friend to Tenant (ONLY after membership is verified/created)
      const tenantUpdateData: { linkedUserId?: string; lineFriendId?: string } = {};
      if (isUuid(userId)) {
        tenantUpdateData.linkedUserId = userId;
      }
      if (grantLineFriendId) {
        tenantUpdateData.lineFriendId = grantLineFriendId;
      }

      const updatedTenant = await tx.tenant.update({
        where: { id: candidate.id },
        data: tenantUpdateData,
      });

      // 9. Audit event
      if (this.auditService) {
        await this.auditService.logSecurityEvent({
          action: 'tenant.claim',
          dormitoryId,
          userId,
          details: {
            tenantId: updatedTenant.id,
            tenantNumber: updatedTenant.tenantNumber,
            roomId: room.id,
            ip: ipAddress || null,
          },
        });
      }

      return {
        success: true,
        tenantId: updatedTenant.id,
        tenantNumber: updatedTenant.tenantNumber,
        targetLineFriendId: grantLineFriendId || updatedTenant.lineFriendId,
      };
    });

    if ((claimResult as any)?.targetLineFriendId) {
      try {
        const lineFriend = await this.prisma.dormitoryLineFriend.findUnique({
          where: { id: (claimResult as any).targetLineFriendId },
        });
        if (lineFriend && lineFriend.lineUserIdEncrypted) {
          const { decryptText } = await import('../utils/crypto-encryption.js');
          const lineUserId = decryptText(lineFriend.lineUserIdEncrypted);
          const { LineRichMenuService } = await import('./line-richmenu.service.js');
          const richMenuService = new LineRichMenuService(this.prisma);
          await richMenuService.linkActiveTenantRichMenu(dormitoryId, lineUserId);
        }
      } catch (rmErr: any) {
        // Non-blocking rich menu link
      }
    }

    return claimResult;
  }
}

export const tenantClaimService = new TenantClaimService();
