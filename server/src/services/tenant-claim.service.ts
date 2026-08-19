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
  maskFullName,
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
    prismaClient: any = this.prisma
  ): Promise<any | null> {
    const unlinkedTenants = await prismaClient.tenant.findMany({
      where: {
        dormitoryId,
        status: 'active',
        linkedUserId: null,
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

    // Evaluate each tenant's active/reserved status on this room
    const evaluated: EvaluatedTenantCandidate[] = unlinkedTenants.map((t: any) => {
      const activeOcc = t.occupancies.some((o: any) => o.status === 'ACTIVE');
      const activeProv = t.provisionalRentalTerms.some((p: any) => p.status === 'ACTIVE');
      const activeDaily = t.dailyStays.some((d: any) => d.status === 'ACTIVE');
      const isActive = activeOcc || activeProv || activeDaily;

      const reservedOccs = t.occupancies.filter((o: any) => o.status === 'RESERVED');
      const reservedProvs = t.provisionalRentalTerms.filter((p: any) => p.status === 'RESERVED');
      const reservedDailies = t.dailyStays.filter((d: any) => d.status === 'RESERVED');
      const isReserved = reservedOccs.length > 0 || reservedProvs.length > 0 || reservedDailies.length > 0;

      const reservedDates: Date[] = [];
      reservedOccs.forEach((o: any) => { if (o.startedAt) reservedDates.push(new Date(o.startedAt)); });
      reservedProvs.forEach((p: any) => { if (p.startDate) reservedDates.push(new Date(p.startDate)); });
      reservedDailies.forEach((d: any) => { if (d.startDate) reservedDates.push(new Date(d.startDate)); });

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
    roomRef: string | { roomId?: string; roomNumber?: string }
  ): Promise<ClaimCandidateResult> {
    const roomWhere: any = {
      dormitoryId,
      deletedAt: null,
      status: { not: 'archived' },
    };
    if (typeof roomRef === 'string') {
      roomWhere.id = roomRef;
    } else {
      if (roomRef.roomNumber) roomWhere.roomNumber = roomRef.roomNumber;
      if (roomRef.roomId) roomWhere.id = roomRef.roomId;
    }

    const room = await this.prisma.room.findFirst({
      where: roomWhere,
    });

    if (!room) {
      return { hasCandidate: false };
    }

    const tenant = await this.selectAuthoritativeCandidate(dormitoryId, room.id, this.prisma);

    if (!tenant) {
      return { hasCandidate: false };
    }

    const rawName = tenant.displayName || tenant.firstName;
    return {
      hasCandidate: true,
      roomId: room.id,
      roomNumber: room.roomNumber,
      maskedName: maskFullName(rawName),
      maskedPhone: maskPhone(tenant.phone),
    };
  }

  /**
   * Executes Tenant Self-Claim:
   * In 1 atomic transaction:
   * 1. Room advisory lock
   * 2. Select authoritative candidate under Decision 2A
   * 3. Match against claimInput (exact phone or Thai name similarity >= 0.90)
   * 4. Update Tenant.linkedUserId = userId
   * 5. Ensure DormitoryMember TENANT membership
   * 6. Audit log event
   */
  public async claimTenant(
    data: ClaimTenantDto,
    userId: string,
    ipAddress?: string
  ) {
    const { dormitoryId, roomId, roomNumber, claimInput } = data;

    const trimmedInput = claimInput?.trim();
    if (!trimmedInput) {
      const err = new Error('กรุณาระบุชื่อ-นามสกุล หรือ เบอร์โทรศัพท์สำหรับยืนยันสิทธิ์');
      (err as any).statusCode = 400;
      (err as any).code = 'VALIDATION_ERROR';
      throw err;
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Verify room exists and belongs to dormitory
      const roomWhere: any = {
        dormitoryId,
        deletedAt: null,
        status: { not: 'archived' },
      };
      if (roomNumber) roomWhere.roomNumber = roomNumber;
      if (roomId) roomWhere.id = roomId;

      const room = await tx.room.findFirst({
        where: roomWhere,
      });

      if (!room) {
        const err = new Error('ไม่พบข้อมูลผู้เช่าที่ตรงกับข้อมูลที่ระบุ');
        (err as any).statusCode = 404;
        (err as any).code = 'CLAIM_MATCH_FAILED';
        throw err;
      }

      // 2. Room lock to protect against concurrency
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${dormitoryId + ':' + room.id}))`;

      // 3. Find authoritative candidate using Decision 2A Priority
      const candidate = await this.selectAuthoritativeCandidate(dormitoryId, room.id, tx);

      if (!candidate) {
        const err = new Error('ไม่พบข้อมูลผู้เช่าที่ตรงกับข้อมูลที่ระบุ');
        (err as any).statusCode = 404;
        (err as any).code = 'CLAIM_MATCH_FAILED';
        throw err;
      }

      // 4. Test match
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

      // 5. Re-check under lock that tenant.linkedUserId is still null
      const freshTenant = await tx.tenant.findUnique({
        where: { id: candidate.id },
      });

      if (!freshTenant || freshTenant.linkedUserId !== null) {
        const err = new Error('ไม่พบข้อมูลผู้เช่าที่ตรงกับข้อมูลที่ระบุ');
        (err as any).statusCode = 400;
        (err as any).code = 'CLAIM_MATCH_FAILED';
        throw err;
      }

      // 6. Link User to Tenant
      const updatedTenant = await tx.tenant.update({
        where: { id: candidate.id },
        data: {
          linkedUserId: userId,
        },
      });

      // 7. Ensure TENANT DormitoryMember
      let tenantRole = await tx.role.findFirst({
        where: {
          OR: [
            { dormitoryId, code: 'TENANT' },
            { dormitoryId: null, code: 'TENANT' },
            { code: 'TENANT' },
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

      await tx.dormitoryMember.upsert({
        where: {
          user_dormitory_unique: {
            userId,
            dormitoryId,
          },
        },
        create: {
          userId,
          dormitoryId,
          roleId: tenantRole.id,
          status: 'active',
          membershipOrigin: 'MANUAL_GRANT',
          acceptedAt: new Date(),
        },
        update: {
          status: 'active',
        },
      });

      // 8. Audit event
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
      };
    });
  }
}

export const tenantClaimService = new TenantClaimService();
