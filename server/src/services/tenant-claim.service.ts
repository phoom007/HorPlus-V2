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
  roomId: string;
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

    const evaluated: EvaluatedTenantCandidate[] = [];

    for (const tenant of unlinkedTenants) {
      let isActive = false;
      let isReserved = false;
      const reservedDates: Date[] = [];

      // Check Occupancies
      for (const occ of tenant.occupancies || []) {
        if (occ.status === 'ACTIVE') {
          isActive = true;
        } else if (occ.status === 'RESERVED') {
          isReserved = true;
          if (occ.startedAt) reservedDates.push(new Date(occ.startedAt));
        }
      }

      // Check Provisional Terms
      for (const term of tenant.provisionalRentalTerms || []) {
        if (term.status === 'ACTIVE') {
          isActive = true;
        } else if (term.status === 'RESERVED') {
          isReserved = true;
          if (term.startDate) reservedDates.push(new Date(term.startDate));
        }
      }

      // Check Daily Stays
      for (const stay of tenant.dailyStays || []) {
        if (stay.status === 'ACTIVE') {
          isActive = true;
        } else if (stay.status === 'RESERVED') {
          isReserved = true;
          if (stay.startDate) reservedDates.push(new Date(stay.startDate));
        }
      }

      if (isActive || isReserved) {
        let earliestReservedDate: Date | null = null;
        if (reservedDates.length > 0) {
          reservedDates.sort((a, b) => a.getTime() - b.getTime());
          earliestReservedDate = reservedDates[0];
        }

        evaluated.push({
          tenant,
          isActive,
          isReserved,
          earliestReservedDate,
        });
      }
    }

    // ── Priority 1: Current ACTIVE Tenant ──────────────────────────────
    const activeCandidates = evaluated.filter((e) => e.isActive);
    if (activeCandidates.length === 1) {
      return activeCandidates[0].tenant;
    }
    if (activeCandidates.length > 1) {
      // Priority 3: Ambiguity across multiple active candidates -> Fail closed
      if (this.auditService) {
        await this.auditService.logSecurityEvent({
          action: 'tenant.claim.ambiguity_detected',
          dormitoryId,
          details: { roomId, reason: 'multiple_active_candidates', count: activeCandidates.length },
        });
      }
      return null;
    }

    // ── Priority 2: Nearest Future RESERVED Tenant ─────────────────────
    const reservedCandidates = evaluated.filter((e) => !e.isActive && e.isReserved && e.earliestReservedDate !== null);
    if (reservedCandidates.length === 0) {
      return null;
    }

    if (reservedCandidates.length === 1) {
      return reservedCandidates[0].tenant;
    }

    // Sort by earliest reserved start date ascending
    reservedCandidates.sort(
      (a, b) => a.earliestReservedDate!.getTime() - b.earliestReservedDate!.getTime()
    );

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
    roomId: string
  ): Promise<ClaimCandidateResult> {
    const room = await this.prisma.room.findFirst({
      where: { id: roomId, dormitoryId, deletedAt: null },
    });

    if (!room) {
      return { hasCandidate: false };
    }

    const tenant = await this.selectAuthoritativeCandidate(dormitoryId, roomId, this.prisma);

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
    const { dormitoryId, roomId, claimInput } = data;

    const trimmedInput = claimInput?.trim();
    if (!trimmedInput) {
      const err = new Error('กรุณาระบุชื่อ-นามสกุล หรือ เบอร์โทรศัพท์สำหรับยืนยันสิทธิ์');
      (err as any).statusCode = 400;
      (err as any).code = 'VALIDATION_ERROR';
      throw err;
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Room lock to protect against concurrency
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${dormitoryId + ':' + roomId}))`;

      // 2. Verify room exists and belongs to dormitory
      const room = await tx.room.findFirst({
        where: { id: roomId, dormitoryId, deletedAt: null },
      });

      if (!room) {
        const err = new Error('ไม่พบข้อมูลผู้เช่าที่ตรงกับข้อมูลที่ระบุ');
        (err as any).statusCode = 404;
        (err as any).code = 'CLAIM_MATCH_FAILED';
        throw err;
      }

      // 3. Find authoritative candidate using Decision 2A Priority
      const candidate = await this.selectAuthoritativeCandidate(dormitoryId, roomId, tx);

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
            roomId,
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
