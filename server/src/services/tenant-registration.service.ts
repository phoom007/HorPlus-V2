import { acquireRoomAvailabilityLock } from '../utils/occupancy-interval.util.js';
import { createDepositBillForAgreementInTx } from '../utils/deposit-billing.util.js';
import { getPrismaClient } from '../db/prisma.js';
import { logger } from '../config/logger.js';
import { AppError } from '../types/index.js';
import { Prisma } from '@prisma/client';
import { outboxService } from './outbox.service.js';
import { SignatureStorageService } from './signature-storage.service.js';
import { subscriptionEntitlementService } from './subscription-entitlement.service.js';
import { generateNextTenantNumber } from './tenant-number.service.js';
import { tenantRegistrationInviteService } from './tenant-registration-invite.service.js';
import {
  normalizeFullName,
  normalizeThaiPhone,
  calculateNameSimilarity,
  maskFullName,
} from '../utils/thai-identity.util.js';
import crypto from 'crypto';

export interface CreateRegistrationDto {
  dormitoryId?: string;
  inviteToken?: string;
  requestedRoomId: string;
  firstName: string;
  lastName: string;
  phone: string;
  note?: string;
  agreedTerms: true;
  signatureBase64: string;
  expectedPolicyVersion: number;
  rentalPlan?: 'monthly' | 'term' | 'daily';
  proposedRent?: number | string;
  proposedDeposit?: number | string;
  durationMonths?: number;
  startDate?: string;
  citizenId?: string;
  birthDate?: string;
  address?: string;
  idCardImageUrl?: string;
  emergencyContact?: { name: string; relationship: string; phone: string };
  coOccupants?: Array<{ name: string; phone?: string; citizenId?: string }>;
  vehicle?: { type: string; licensePlate: string; brand?: string };
  pet?: { hasPet: boolean; type?: string; name?: string; count?: number };
}

// Actor-scoped 5-minute lockout rate limiter store (Room is NOT locked)
interface FailedAttemptRecord {
  count: number;
  lockedUntil?: number;
  firstAttemptAt: number;
}
const claimActorAttempts = new Map<string, FailedAttemptRecord>();

export function canonicalJsonStringify(obj: any): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalJsonStringify).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => `${JSON.stringify(k)}:${canonicalJsonStringify(obj[k])}`).join(',') + '}';
}

export function computeSnapshotSha256(snapshot: any): string {
  const canonicalJson = canonicalJsonStringify(snapshot);
  return crypto.createHash('sha256').update(canonicalJson, 'utf8').digest('hex');
}

export interface ApproveRegistrationDto {
  startDate: string;
  endDate: string;
  durationMonths: number;
  rentAmount: string | number;
  depositAmount: string | number;
  advancePaymentAmount: string | number;
  terms?: string | null;
  confirmReplacement?: boolean;
  requireTenantConfirmation?: boolean;
  legacyDirectApproval?: boolean;
}

export class TenantRegistrationService {
  public async getPublicDormitoryPolicy(dormitoryId: string) {
    const prisma = getPrismaClient();
    const dorm = await prisma.dormitory.findUnique({
      where: { id: dormitoryId },
      select: { id: true, name: true },
    });
    if (!dorm) {
      throw new AppError('ไม่พบข้อมูลหอพัก', 404, 'DORMITORY_NOT_FOUND');
    }

    const defaults = await prisma.dormitoryPropertyDefaults.findUnique({
      where: { dormitoryId },
    });

    return {
      dormitoryId,
      dormitoryName: dorm.name,
      defaultTerms: defaults?.defaultTerms || '',
      petPolicy: defaults?.petPolicy || { allowed: 'none', allowedTypes: [] },
      version: defaults?.version || 1,
    };
  }

  public async createRequest(dormitoryId: string, payload: CreateRegistrationDto) {
    const prisma = getPrismaClient();

    // 1. Mandatory server boundary validation
    if (payload.agreedTerms !== true) {
      throw new AppError('กรุณายอมรับกฎระเบียบและเงื่อนไขของหอพักก่อนส่งคำขอลงทะเบียน', 400, 'TERMS_NOT_ACCEPTED');
    }
    if (!payload.signatureBase64 || typeof payload.signatureBase64 !== 'string' || !payload.signatureBase64.trim()) {
      throw new AppError('กรุณาเซ็นชื่อก่อนส่งคำขอลงทะเบียน', 400, 'SIGNATURE_REQUIRED');
    }
    if (typeof payload.expectedPolicyVersion !== 'number' || payload.expectedPolicyVersion < 1 || !Number.isInteger(payload.expectedPolicyVersion)) {
      throw new AppError('กรุณาระบุเวอร์ชันของกฎระเบียบที่ถูกต้อง', 400, 'INVALID_POLICY_VERSION');
    }
    if (!payload.requestedRoomId || !payload.firstName?.trim() || !payload.lastName?.trim() || !payload.phone?.trim()) {
      throw new AppError('กรุณากรอกข้อมูลที่จำเป็น (*) ให้ครบถ้วน', 400, 'VALIDATION_ERROR');
    }

    // 2. Validate and store tenant signature binary first
    let savedObjectKey: string | null = null;
    let sigMeta: { objectKey: string; sha256: string; mimeType: string; byteSize: number };

    try {
      const base64Clean = payload.signatureBase64.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Clean, 'base64');
      const sigStorage = new SignatureStorageService(prisma);
      const savedSig = await sigStorage.saveTenantSignature({
        dormitoryId,
        buffer,
      });
      savedObjectKey = savedSig.objectKey;
      sigMeta = savedSig;
    } catch (sigErr: any) {
      if (sigErr instanceof AppError) throw sigErr;
      throw new AppError('ลายเซ็นไม่ถูกต้องหรือไม่สามารถประมวลผลได้', 400, 'INVALID_SIGNATURE_DATA');
    }

    // 3. Authoritative DB Transaction with FOR UPDATE lock on policy defaults to prevent TOCTOU race
    try {
      return await prisma.$transaction(async (tx) => {
        let targetDormitoryId = dormitoryId;
        let lineFollowerId: string | null = null;

        if (payload.inviteToken) {
          const inviteResult = await tenantRegistrationInviteService.consumeInviteInTransaction(payload.inviteToken, tx);
          if (targetDormitoryId && targetDormitoryId !== inviteResult.dormitoryId) {
            throw new AppError('Dormitory mismatch with invite token', 400, 'DORMITORY_MISMATCH');
          }
          targetDormitoryId = inviteResult.dormitoryId;
          lineFollowerId = inviteResult.lineFriendId;
        }

        if (!targetDormitoryId) {
          throw new AppError('ไม่พบข้อมูลหอพัก', 400, 'DORMITORY_REQUIRED');
        }

        // Lock property defaults row
        const defaultsRaw = await tx.$queryRaw<Array<{
          id: string;
          dormitory_id: string;
          default_terms: string | null;
          pet_policy: any;
          version: number;
        }>>`
          SELECT id, dormitory_id, default_terms, pet_policy, version
          FROM dormitory_property_defaults
          WHERE dormitory_id = ${targetDormitoryId}::uuid
          FOR UPDATE
        `;

        const defaults = defaultsRaw && defaultsRaw.length > 0 ? defaultsRaw[0] : null;
        const currentVersion = defaults?.version ?? 1;

        // Concurrency Check: Policy Version Mismatch
        if (currentVersion !== payload.expectedPolicyVersion) {
          throw new AppError(
            'กฎระเบียบหรือเงื่อนไขของหอพักมีการเปลี่ยนแปลง กรุณาตรวจสอบและยอมรับเงื่อนไขใหม่อีกครั้ง',
            409,
            'POLICY_VERSION_MISMATCH'
          );
        }

        // Fetch Dormitory Info
        const dorm = await tx.dormitory.findUnique({
          where: { id: targetDormitoryId },
          select: { id: true, name: true },
        });
        if (!dorm) {
          throw new AppError('ไม่พบข้อมูลหอพัก', 404, 'DORMITORY_NOT_FOUND');
        }

        // Resolve requested room
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.requestedRoomId);
        const room = await tx.room.findFirst({
          where: {
            dormitoryId: targetDormitoryId,
            deletedAt: null,
            OR: isUuid
              ? [{ id: payload.requestedRoomId }]
              : [
                  { roomNumber: payload.requestedRoomId },
                  { normalizedRoomNumber: payload.requestedRoomId.toUpperCase() },
                ],
          },
        });
        if (!room) {
          throw new AppError('ไม่พบห้องพักที่ระบุในหอพักนี้', 404, 'ROOM_NOT_FOUND');
        }

        // Build Canonical Acceptance Snapshot & Compute SHA-256
        const acceptedAt = new Date();
        const defaultTerms = defaults?.default_terms ?? '';
        const petPolicy = defaults?.pet_policy ?? { allowed: 'none', allowedTypes: [] };

        const acceptanceSnapshot = {
          snapshotVersion: 1,
          dormitoryId: targetDormitoryId,
          dormitoryName: dorm.name,
          requestedRoomId: room.id,
          requestedRoomNumber: room.roomNumber,
          defaultTerms,
          petPolicy,
          policyVersion: currentVersion,
          acceptedAt: acceptedAt.toISOString(),
          applicantName: `${payload.firstName.trim()} ${payload.lastName.trim()}`,
          applicantPhone: payload.phone.trim(),
          rentalPlan: payload.rentalPlan || 'monthly',
          proposedRent: payload.proposedRent !== undefined ? payload.proposedRent : undefined,
          proposedDeposit: payload.proposedDeposit !== undefined ? payload.proposedDeposit : undefined,
          durationMonths: payload.durationMonths,
          startDate: payload.startDate,
          citizenId: payload.citizenId,
          birthDate: payload.birthDate,
          address: payload.address,
          idCardImageUrl: payload.idCardImageUrl,
          emergencyContact: payload.emergencyContact,
          coOccupants: payload.coOccupants || [],
          vehicle: payload.vehicle,
          pet: payload.pet,
          revisionHistory: [],
        };
        const acceptanceSnapshotSha256 = computeSnapshotSha256(acceptanceSnapshot);

        return tx.tenantRegistrationRequest.create({
          data: {
            dormitoryId: targetDormitoryId,
            lineFollowerId,
            requestedRoomId: room.id,
            firstName: payload.firstName.trim(),
            lastName: payload.lastName.trim(),
            phone: payload.phone.trim(),
            note: payload.note ? payload.note.trim() : null,
            status: 'pending_owner_approval',
            submittedAt: acceptedAt,
            acceptedAt,
            acceptanceSnapshot,
            acceptanceSnapshotSha256,
            tenantSignatureObjectKey: sigMeta.objectKey,
            tenantSignatureSha256: sigMeta.sha256,
            tenantSignatureMimeType: sigMeta.mimeType,
            tenantSignatureByteSize: sigMeta.byteSize,
          },
        });
      });
    } catch (txErr: any) {
      // Clean up orphan signature binary if request creation or TOCTOU lock failed
      if (savedObjectKey) {
        try {
          const sigStorage = new SignatureStorageService(prisma);
          await sigStorage.deleteSignature(savedObjectKey);
        } catch (cleanupErr) {
          logger.warn('Failed to clean up orphan tenant signature:', { objectKey: savedObjectKey, error: cleanupErr });
        }
      }
      throw txErr;
    }
  }

  public async getReplacementWarningDetails(dormitoryId: string, registrationId: string) {
    const prisma = getPrismaClient();
    const req = await prisma.tenantRegistrationRequest.findFirst({
      where: { id: registrationId, dormitoryId },
    });

    if (!req || !req.requestedRoomId) {
      return { requiresReplacementWarning: false };
    }

    const activeOccupancy = await prisma.occupancy.findFirst({
      where: {
        dormitoryId,
        roomId: req.requestedRoomId,
        status: 'ACTIVE',
      },
      include: { tenant: true, contract: true, room: true },
    });

    const futureContract = await prisma.contract.findFirst({
      where: {
        dormitoryId,
        roomId: req.requestedRoomId,
        deletedAt: null,
        status: 'approved_scheduled',
      },
      include: { tenant: true, room: true },
    });

    if (!activeOccupancy && !futureContract) {
      return { requiresReplacementWarning: false };
    }

    const room = activeOccupancy?.room || futureContract?.room;

    return {
      requiresReplacementWarning: true,
      hasActiveOccupancy: !!activeOccupancy,
      hasFutureRenewal: !!futureContract,
      currentOccupancy: activeOccupancy || null,
      currentTenant: activeOccupancy?.tenant || null,
      currentContract: activeOccupancy?.contract || null,
      futureContract: futureContract || null,
      futureTenant: futureContract?.tenant || null,
      futureStartDate: futureContract?.startDate || null,
      room,
    };
  }

  public async hasPendingRegistrationForRoom(dormitoryId: string, roomId: string): Promise<boolean> {
    const prisma = getPrismaClient();
    const count = await prisma.tenantRegistrationRequest.count({
      where: {
        dormitoryId,
        requestedRoomId: roomId,
        status: 'pending_owner_approval',
      },
    });
    return count > 0;
  }

  public async listRequests(dormitoryId: string) {
    const prisma = getPrismaClient();
    return prisma.tenantRegistrationRequest.findMany({
      where: { dormitoryId },
      orderBy: { createdAt: 'desc' },
    });
  }

  public async getRequestById(id: string, dormitoryId: string) {
    const prisma = getPrismaClient();
    const req = await prisma.tenantRegistrationRequest.findFirst({
      where: { id, dormitoryId },
    });
    if (!req) {
      const err = new Error('REGISTRATION_REQUEST_NOT_FOUND');
      (err as any).statusCode = 404;
      (err as any).code = 'REGISTRATION_REQUEST_NOT_FOUND';
      throw err;
    }
    return req;
  }

  public async updateRequestRoom(
    id: string,
    dormitoryId: string,
    requestedRoomId: string,
    actorUserId?: string
  ) {
    const req = await this.getRequestById(id, dormitoryId);
    if (req.status !== 'pending_owner_approval') {
      const err = new Error('INVALID_REQUEST_STATUS');
      (err as any).statusCode = 400;
      (err as any).code = 'INVALID_REQUEST_STATUS';
      (err as any).message = 'คำขอนี้ไม่ได้อยู่ในสถานะรออนุมัติ';
      throw err;
    }

    const prisma = getPrismaClient();
    const room = await prisma.room.findFirst({
      where: {
        dormitoryId,
        deletedAt: null,
        OR: [
          { id: requestedRoomId },
          { roomNumber: requestedRoomId },
          { normalizedRoomNumber: requestedRoomId.toUpperCase() },
        ],
      },
    });

    if (!room) {
      const err = new Error('ROOM_NOT_FOUND');
      (err as any).statusCode = 404;
      (err as any).code = 'ROOM_NOT_FOUND';
      (err as any).message = 'ไม่พบห้องพักที่ระบุในหอพักนี้';
      throw err;
    }

    const updated = await prisma.tenantRegistrationRequest.update({
      where: { id },
      data: {
        requestedRoomId: room.id,
      },
    });

    return updated;
  }

  public async approveRequest(
    id: string,
    dormitoryId: string,
    payload: ApproveRegistrationDto,
    actorUserId?: string
  ) {
    if (
      !payload ||
      !payload.startDate ||
      !payload.endDate ||
      payload.durationMonths === undefined ||
      payload.rentAmount === undefined ||
      payload.depositAmount === undefined ||
      payload.advancePaymentAmount === undefined
    ) {
      const err = new Error('MISSING_CONTRACT_TERMS');
      (err as any).statusCode = 400;
      (err as any).code = 'MISSING_CONTRACT_TERMS';
      (err as any).message = 'กรุณาระบุข้อกำหนดสัญญาที่จำเป็นให้ครบถ้วน (วันเริ่ม, วันสิ้นสุด, ระยะเวลา, ค่าเช่า, เงินมัดจำ, ค่าล่วงหน้า)';
      throw err;
    }

    const prisma = getPrismaClient();
    const resTx = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;

      // 1. Re-verify request status inside transaction
      const req = await tx.tenantRegistrationRequest.findFirst({
        where: { id, dormitoryId },
      });

      if (!req) {
        const err = new Error('REGISTRATION_REQUEST_NOT_FOUND');
        (err as any).statusCode = 404;
        (err as any).code = 'REGISTRATION_REQUEST_NOT_FOUND';
        throw err;
      }

      if (req.status !== 'pending_owner_approval') {
        const err = new Error('INVALID_REQUEST_STATUS');
        (err as any).statusCode = 400;
        (err as any).code = 'INVALID_REQUEST_STATUS';
        (err as any).message = 'คำขอนี้ไม่ได้อยู่ในสถานะรออนุมัติ';
        throw err;
      }

      // 2. Acquire shared room advisory availability lock, row lock, and validate maintenance status
      let room: any = null;
      if (req.requestedRoomId) {
        // 2.1 Shared room advisory availability lock (matching RoomService, Contract, Provisional, Daily)
        await acquireRoomAvailabilityLock(tx, dormitoryId, req.requestedRoomId);

        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.requestedRoomId);
        if (isUuid) {
          try {
            await tx.$executeRaw`SELECT id FROM rooms WHERE id = ${req.requestedRoomId}::uuid FOR UPDATE`;
          } catch {}
        }

        room = await tx.room.findFirst({ where: { id: req.requestedRoomId, dormitoryId } });
        if (!room) {
          const err = new Error('ROOM_DORM_MISMATCH');
          (err as any).statusCode = 400;
          (err as any).code = 'ROOM_DORM_MISMATCH';
          (err as any).message = 'ห้องพักที่ระบุไม่อยู่ในหอพักนี้';
          throw err;
        }

        // 2.2 Maintenance must strictly block approval with zero side effects
        if (room.status === 'maintenance') {
          const err = new Error('ไม่สามารถอนุมัติผู้เช่าได้ เนื่องจากห้องนี้อยู่ระหว่างปิดปรับปรุง');
          (err as any).code = 'ROOM_UNDER_MAINTENANCE';
          (err as any).statusCode = 409;
          (err as any).message = 'ไม่สามารถอนุมัติผู้เช่าได้ เนื่องจากห้องนี้อยู่ระหว่างปิดปรับปรุง';
          throw err;
        }

        // Check room operational entitlement limit (FREE tier first-10 active rooms)
        await subscriptionEntitlementService.assertRoomOperationalEntitlement(dormitoryId, room.id, new Date(), tx);

        // Check if room currently has an active tenancy OR an approved future renewal contract
        const activeOccupancy = await tx.occupancy.findFirst({
          where: { dormitoryId, roomId: req.requestedRoomId, status: 'ACTIVE' },
          include: { tenant: true, contract: true },
        });

        const futureContract = await tx.contract.findFirst({
          where: {
            dormitoryId,
            roomId: req.requestedRoomId,
            deletedAt: null,
            status: 'approved_scheduled',
          },
          include: { tenant: true },
        });

        if (activeOccupancy || futureContract) {
          // If Owner did NOT explicitly confirm replacement, require confirmation warning first!
          if (!payload.confirmReplacement) {
            let msg = `ห้อง ${room.roomNumber} มีผู้เช่าปัจจุบันอยู่ (${activeOccupancy?.tenant.displayName}) การอนุมัติผู้สมัครรายใหม่นี้จะยุติสัญญาของผู้เช่าปัจจุบันทันที`;
            if (futureContract) {
              msg = `ห้องนี้มีสัญญาต่ออายุในอนาคตที่ได้รับอนุมัติแล้ว\n\nการอนุมัติผู้สมัครรายใหม่นี้จะยกเลิกสิทธิ์การต่อสัญญา\nในอนาคตของผู้เช่าเดิม และผู้สมัครรายใหม่จะได้รับสิทธิ์ในห้องนี้แทน\n\nกรุณาตรวจสอบข้อมูลก่อนยืนยัน`;
            }

            const err = new Error(`REPLACEMENT_CONFIRMATION_REQUIRED: ${msg}`);
            (err as any).statusCode = 409;
            (err as any).code = 'REPLACEMENT_CONFIRMATION_REQUIRED';
            (err as any).message = `REPLACEMENT_CONFIRMATION_REQUIRED: ${msg}`;
            (err as any).activeTenantName = activeOccupancy?.tenant.displayName || null;
            (err as any).activeRoomNumber = room.roomNumber;
            (err as any).hasFutureRenewal = !!futureContract;
            (err as any).futureTenantName = futureContract?.tenant.displayName || null;
            (err as any).futureStartDate = futureContract?.startDate ? new Date(futureContract.startDate).toLocaleDateString('th-TH') : null;
            throw err;
          }

          const safeActorId = actorUserId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actorUserId) ? actorUserId : null;

          // A. ATOMIC FUTURE RENEWAL OVERRIDE CANCELLATION
          if (futureContract) {
            // a. Cancel/invalidate scheduled contract (preserve audit details)
            await tx.contract.update({
              where: { id: futureContract.id },
              data: {
                status: 'cancelled',
                terminatedAt: new Date(),
                terminationReason: 'ยกเลิกเนื่องจากผู้ดูแลหอพักอนุมัติผู้เช่ารายใหม่เข้าแทนที่',
              },
            });

            // b. Invalidate related renewal request(s)
            await tx.tenantRenewalRequest.updateMany({
              where: {
                dormitoryId,
                roomId: req.requestedRoomId,
                tenantId: futureContract.tenantId,
                status: { in: ['PENDING_OWNER_APPROVAL', 'APPROVED'] },
              },
              data: {
                status: 'CANCELLED',
                rejectionReason: 'ยกเลิกโดยผู้ดูแลหอพักเนื่องจากอนุมัติผู้เช่ารายใหม่เข้าแทนที่',
                reviewedAt: new Date(),
                reviewedByUserId: safeActorId,
              },
            });

            // c. Create persistent in-app notice for future renewal tenant via Outbox
            const formattedStart = new Date(futureContract.startDate).toLocaleDateString('th-TH');
            await outboxService.createOutboxEvent(tx, {
              dormitoryId,
              eventType: 'FORCED_TERMINATION',
              aggregateType: 'TENANT_RENEWAL',
              aggregateId: futureContract.id,
              recipientType: 'TENANT',
              recipientId: futureContract.tenantId,
              title: 'แจ้งยกเลิกสัญญาต่ออายุในอนาคต',
              body: `สัญญาต่ออายุห้อง ${room.roomNumber} ที่มีกำหนดเริ่มวันที่ ${formattedStart} ถูกยกเลิกโดยผู้ดูแลหอพัก เนื่องจากห้องได้รับการอนุมัติให้ผู้เช่ารายใหม่`,
            });

            logger.info({
              event: 'SECURITY_AUDIT',
              dormitoryId,
              futureTenantId: futureContract.tenantId,
              roomId: req.requestedRoomId,
              actorUserId,
              action: 'FUTURE_RENEWAL_OVERRIDDEN',
              msg: `Owner cancelled scheduled future contract ${futureContract.id} to approve replacement applicant ${id}`,
            });
          }

          // B. ATOMIC OWNER-FORCED REPLACEMENT TERMINATION FOR ACTIVE OCCUPANCY
          if (activeOccupancy) {
            const oldTenantId = activeOccupancy.tenantId;
            const oldContractId = activeOccupancy.contractId;

            // a. Terminate old contract (Original agreed dates on contract remain IMMUTABLE! NO rent proration!)
            if (oldContractId) {
              await tx.contract.update({
                where: { id: oldContractId },
                data: {
                  status: 'terminated',
                  terminatedAt: new Date(),
                  terminationEffectiveDate: new Date(),
                  terminationReason: 'ยุติสัญญาเนื่องจากผู้ดูแลหอพักอนุมัติผู้เช่ารายใหม่เข้าแทนที่',
                },
              });
            }

            // b. Close old occupancy
            await tx.occupancy.update({
              where: { id: activeOccupancy.id },
              data: {
                status: 'ENDED',
                endedAt: new Date(),
                endedByUserId: safeActorId,
                endedReason: 'ย้ายออกจากการอนุมัติผู้เช่าใหม่แทนที่ (Owner Replacement)',
              },
            });

            // c. Invalidate/cancel any pending renewal requests for old tenant
            await tx.tenantRenewalRequest.updateMany({
              where: {
                dormitoryId,
                tenantId: oldTenantId,
                status: 'PENDING_OWNER_APPROVAL',
              },
              data: {
                status: 'CANCELLED',
                rejectionReason: 'ยกเลิกเนื่องจากผู้ดูแลหอพักอนุมัติผู้เช่ารายใหม่เข้าแทนที่',
                reviewedAt: new Date(),
                reviewedByUserId: safeActorId,
              },
            });

            // d. Initiate/open Settlement for old tenant
            if (oldContractId) {
              const unpaidBills = await tx.bill.findMany({
                where: {
                  dormitoryId,
                  contractId: oldContractId,
                  status: { in: ['unpaid', 'overdue'] },
                },
              });

              const unpaidTotal = unpaidBills.reduce(
                (sum, b) => sum.add(new Prisma.Decimal(b.totalAmount || 0)),
                new Prisma.Decimal(0)
              );

              const oldContract = activeOccupancy.contract;
              const deposit = new Prisma.Decimal(oldContract?.depositAmount || 0);
              const net = deposit.sub(unpaidTotal);

              let direction = 'ZERO';
              let status = 'CLOSED_ZERO';
              if (net.gt(0)) {
                direction = 'REFUND';
                status = 'PENDING_REFUND';
              } else if (net.lt(0)) {
                direction = 'PAYMENT_DUE';
                status = 'PENDING_PAYMENT';
              }

              await tx.contractSettlement.upsert({
                where: {
                  dormitory_contract_settlement_unique: {
                    dormitoryId,
                    contractId: oldContractId,
                  },
                },
                create: {
                  dormitoryId,
                  tenantId: oldTenantId,
                  contractId: oldContractId,
                  roomId: req.requestedRoomId,
                  depositAmount: deposit,
                  unpaidBillAmount: unpaidTotal,
                  damageChargeTotal: new Prisma.Decimal(0),
                  netSettlement: net,
                  settlementDirection: direction,
                  settlementStatus: status,
                },
                update: {
                  depositAmount: deposit,
                  unpaidBillAmount: unpaidTotal,
                  netSettlement: net,
                  settlementDirection: direction,
                  settlementStatus: status,
                },
              });
            }

            // e. Create persistent in-app notice for old tenant via Outbox
            await outboxService.createOutboxEvent(tx, {
              dormitoryId,
              eventType: 'FORCED_TERMINATION',
              aggregateType: 'CONTRACT',
              aggregateId: oldContractId || id,
              recipientType: 'TENANT',
              recipientId: oldTenantId,
              title: 'แจ้งยุติสัญญาเช่า',
              body: `สัญญาเช่าห้อง ${room.roomNumber} ของคุณถูกยุติโดยผู้ดูแลหอพัก กรุณาตรวจสอบรายละเอียดสัญญาและยอดย้ายออกในระบบ`,
            });

            logger.info({
              event: 'SECURITY_AUDIT',
              dormitoryId,
              oldTenantId,
              roomId: req.requestedRoomId,
              actorUserId,
              action: 'OWNER_FORCED_REPLACEMENT_EXECUTED',
              msg: `Owner terminated active tenancy for tenant ${oldTenantId} to approve replacement applicant ${id}`,
            });
          }
        }
      }

      if (!req.requestedRoomId) {
        const err = new Error('MISSING_ROOM_ASSIGNMENT');
        (err as any).statusCode = 400;
        (err as any).code = 'MISSING_ROOM_ASSIGNMENT';
        (err as any).message = 'คำขอลงทะเบียนนี้ยังไม่ได้ระบุห้องพัก กรุณาระบุห้องพักก่อนอนุมัติ';
        throw err;
      }

      // 3. Verify LINE identity belongs to this dormitory (Defense-in-depth)
      if (req.lineFollowerId) {
        const lineFriend = await tx.dormitoryLineFriend.findFirst({
          where: { id: req.lineFollowerId, dormitoryId },
        });
        if (!lineFriend) {
          throw new AppError('LINE identity does not belong to this dormitory', 400, 'CROSS_DORM_IDENTITY_MISMATCH');
        }
      }

      const safeActorId = actorUserId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actorUserId) ? actorUserId : null;

      // Two-Phase Registration (Rule 1 & Q1=A): Move to awaiting_tenant_confirmation without creating Tenant/Contract/Occupancy
      if (payload.requireTenantConfirmation === true) {
        const approvedTerms = {
          startDate: payload.startDate,
          endDate: payload.endDate,
          durationMonths: payload.durationMonths,
          rentAmount: String(payload.rentAmount),
          depositAmount: String(payload.depositAmount),
          advancePaymentAmount: String(payload.advancePaymentAmount),
          terms: payload.terms || null,
          approvedAt: new Date().toISOString(),
          approvedByUserId: safeActorId,
        };

        const currentSnapshot = (req.acceptanceSnapshot as any) || {};
        const updatedSnapshot = {
          ...currentSnapshot,
          approvedTerms,
        };

        const updatedReq = await tx.tenantRegistrationRequest.update({
          where: { id },
          data: {
            status: 'awaiting_tenant_confirmation',
            reviewedAt: new Date(),
            reviewedByUserId: safeActorId,
            approvedRoomId: req.requestedRoomId,
            acceptanceSnapshot: updatedSnapshot,
          },
        });

        return {
          request: updatedReq,
          status: 'awaiting_tenant_confirmation',
          message: 'เจ้าของหอพักอนุมัติเงื่อนไขแล้ว รอผู้เช่าตรวจสอบและลงนามสัญญา',
        };
      }

      const tenantNumber = await generateNextTenantNumber(dormitoryId, tx);
      const displayName = `${req.firstName} ${req.lastName}`.trim();

      const tenant = await tx.tenant.create({
        data: {
          dormitoryId,
          tenantNumber,
          firstName: req.firstName,
          lastName: req.lastName,
          displayName,
          phone: req.phone,
          lineFriendId: req.lineFollowerId || null,
          status: 'active',
        },
      });

      // 4. Create Contract B
      const contractCount = await tx.contract.count({ where: { dormitoryId } });
      const contractNumber = `CTR-${Date.now()}-${(contractCount + 1).toString().padStart(4, '0')}`;

      const contract = await tx.contract.create({
        data: {
          dormitoryId,
          contractNumber,
          roomId: req.requestedRoomId,
          tenantId: tenant.id,
          status: 'active',
          startDate: new Date(payload.startDate),
          endDate: new Date(payload.endDate),
          durationMonths: payload.durationMonths,
          rentAmount: String(payload.rentAmount),
          depositAmount: String(payload.depositAmount),
          advancePaymentAmount: String(payload.advancePaymentAmount),
          terms: payload.terms || null,
          tenantSignature: req.tenantSignatureObjectKey || req.tenantSignatureSha256 || 'SIGNED',
          createdByUserId: safeActorId,
          activatedAt: new Date(),
        },
      });
      const contractId = contract.id;

      // Sync profile from registration snapshot onto tenant
      const snap = (req.acceptanceSnapshot as any) || {};
      const tenantUpdateData: Prisma.TenantUpdateInput = {};
      if (snap.pet) {
        tenantUpdateData.petInfo = snap.pet as Prisma.InputJsonValue;
      }
      if (snap.citizenId) {
        const cleanId = String(snap.citizenId).replace(/\D/g, '');
        if (cleanId.length === 13) {
          tenantUpdateData.nationalIdMasked = `${cleanId.slice(0, 1)}-${cleanId.slice(1, 5)}-xxxxx-${cleanId.slice(10, 12)}-${cleanId.slice(12)}`;
        }
      }
      if (Object.keys(tenantUpdateData).length > 0) {
        await tx.tenant.update({
          where: { id: tenant.id },
          data: tenantUpdateData,
        });
      }
      if (snap.emergencyContact?.name) {
        await tx.tenantEmergencyContact.create({
          data: {
            dormitoryId,
            tenantId: tenant.id,
            name: snap.emergencyContact.name,
            phone: snap.emergencyContact.phone || req.phone,
            relationship: snap.emergencyContact.relationship || 'ผู้ติดต่อฉุกเฉิน',
            isPrimary: true,
          },
        });
      }
      if (Array.isArray(snap.coOccupants)) {
        for (const co of snap.coOccupants) {
          if (co.name) {
            await tx.tenantCoOccupant.create({
              data: {
                dormitoryId,
                tenantId: tenant.id,
                name: co.name,
                phone: co.phone || null,
                relationship: co.relationship || 'ผู้พักร่วม',
                status: 'active',
              },
            });
          }
        }
      }
      if (snap.vehicle?.licensePlate) {
        await tx.tenantVehicle.create({
          data: {
            dormitoryId,
            tenantId: tenant.id,
            type: snap.vehicle.type || 'car',
            brand: snap.vehicle.brand || null,
            licensePlate: snap.vehicle.licensePlate,
            status: 'active',
          },
        });
      }

      // 5. Establish Authoritative Occupancy B & Transition Room B to Occupied
      const occupancy = await tx.occupancy.create({
        data: {
          dormitoryId,
          roomId: req.requestedRoomId,
          tenantId: tenant.id,
          registrationId: id,
          status: 'ACTIVE',
          startedAt: new Date(payload.startDate),
        },
      });

      await tx.room.update({
        where: { id: req.requestedRoomId },
        data: {
          status: 'occupied',
          currentTenantId: tenant.id,
          currentContractId: contractId,
        },
      });

      // 5.5. Create one-time Deposit Bill for approved registration contract
      if (Number(payload.depositAmount) > 0) {
        await createDepositBillForAgreementInTx(tx, {
          dormitoryId,
          roomId: req.requestedRoomId,
          tenantId: tenant.id,
          contractId: contractId,
          agreementType: 'MONTHLY',
          startDate: new Date(payload.startDate),
          depositAmount: payload.depositAmount,
          depositDeclaredStatus: (payload as any).depositDeclaredStatus || 'UNPAID',
          actorUserId: safeActorId,
        });
      }

      // 6. Update Registration Request status to approved
      const updatedReq = await tx.tenantRegistrationRequest.update({
        where: { id },
        data: {
          status: 'approved',
          reviewedAt: new Date(),
          reviewedByUserId: safeActorId,
          approvedTenantId: tenant.id,
          approvedRoomId: req.requestedRoomId,
          approvedContractId: contractId,
        },
      });

      // 7. Mark TenantRegistrationIntent as COMPLETED if exists
      if (req.lineFollowerId) {
        await tx.tenantRegistrationIntent.updateMany({
          where: {
            dormitoryId,
            lineFriendId: req.lineFollowerId,
            purpose: 'TENANT_REGISTRATION',
            status: { in: ['ACTIVE', 'SUBMITTED'] },
          },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
          },
        });
      }

      return {
        request: updatedReq,
        tenant,
        contractId,
        occupancy,
      };
    });

    try {
      await outboxService.processPendingOutboxEvents();
    } catch (err: any) {
      logger.error({ event: 'OUTBOX_DISPATCH_AFTER_REGISTRATION_APPROVE_ERROR', error: err.message });
    }

    return resTx;
  }

  public async confirmApprovedRegistration(
    id: string,
    dormitoryId: string,
    payload: { signatureBase64: string }
  ) {
    if (!payload.signatureBase64 || typeof payload.signatureBase64 !== 'string' || !payload.signatureBase64.trim()) {
      throw new AppError('กรุณาลงลายมือชื่อก่อนยืนยันสัญญา', 400, 'SIGNATURE_REQUIRED');
    }

    const prisma = getPrismaClient();

    let sigMeta: { objectKey: string; sha256: string; mimeType: string; byteSize: number };
    try {
      const base64Clean = payload.signatureBase64.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Clean, 'base64');
      const sigStorage = new SignatureStorageService(prisma);
      sigMeta = await sigStorage.saveTenantSignature({
        dormitoryId,
        buffer,
      });
    } catch (sigErr: any) {
      if (sigErr instanceof AppError) throw sigErr;
      throw new AppError('ลายเซ็นไม่ถูกต้องหรือไม่สามารถประมวลผลได้', 400, 'INVALID_SIGNATURE_DATA');
    }

    const resTx = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;

      const req = await tx.tenantRegistrationRequest.findFirst({
        where: { id, dormitoryId },
      });

      if (!req) {
        throw new AppError('ไม่พบคำขอลงทะเบียน', 404, 'REGISTRATION_REQUEST_NOT_FOUND');
      }

      if (req.status !== 'awaiting_tenant_confirmation') {
        throw new AppError('คำขอนี้ไม่ได้อยู่ในสถานะรอการยืนยันสัญญาจากผู้เช่า', 400, 'INVALID_REQUEST_STATUS');
      }

      const snap = (req.acceptanceSnapshot as any) || {};
      const approvedTerms = snap.approvedTerms || {
        startDate: snap.startDate || new Date().toISOString().slice(0, 10),
        endDate: snap.endDate || new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().slice(0, 10),
        durationMonths: snap.durationMonths || 12,
        rentAmount: snap.proposedRent || '0',
        depositAmount: snap.proposedDeposit || '0',
        advancePaymentAmount: snap.proposedRent || '0',
        terms: snap.terms || null,
      };

      const roomId = req.approvedRoomId || req.requestedRoomId;
      if (!roomId) {
        throw new AppError('ไม่พบข้อมูลห้องพักที่ได้รับอนุมัติ', 400, 'MISSING_ROOM_ASSIGNMENT');
      }

      await acquireRoomAvailabilityLock(tx, dormitoryId, roomId);

      const tenantNumber = await generateNextTenantNumber(dormitoryId, tx);
      const displayName = `${req.firstName} ${req.lastName}`.trim();

      const tenant = await tx.tenant.create({
        data: {
          dormitoryId,
          tenantNumber,
          firstName: req.firstName,
          lastName: req.lastName,
          displayName,
          phone: req.phone,
          lineFriendId: req.lineFollowerId || null,
          status: 'active',
        },
      });

      const tenantUpdateData: Prisma.TenantUpdateInput = {};
      if (snap.pet) {
        tenantUpdateData.petInfo = snap.pet as Prisma.InputJsonValue;
      }
      if (snap.citizenId) {
        const cleanId = String(snap.citizenId).replace(/\D/g, '');
        if (cleanId.length === 13) {
          tenantUpdateData.nationalIdMasked = `${cleanId.slice(0, 1)}-${cleanId.slice(1, 5)}-xxxxx-${cleanId.slice(10, 12)}-${cleanId.slice(12)}`;
        }
      }
      if (Object.keys(tenantUpdateData).length > 0) {
        await tx.tenant.update({
          where: { id: tenant.id },
          data: tenantUpdateData,
        });
      }

      if (snap.emergencyContact?.name) {
        await tx.tenantEmergencyContact.create({
          data: {
            dormitoryId,
            tenantId: tenant.id,
            name: snap.emergencyContact.name,
            phone: snap.emergencyContact.phone || req.phone,
            relationship: snap.emergencyContact.relationship || 'ผู้ติดต่อฉุกเฉิน',
            isPrimary: true,
          },
        });
      }
      if (Array.isArray(snap.coOccupants)) {
        for (const co of snap.coOccupants) {
          if (co.name) {
            await tx.tenantCoOccupant.create({
              data: {
                dormitoryId,
                tenantId: tenant.id,
                name: co.name,
                phone: co.phone || null,
                relationship: co.relationship || 'ผู้พักร่วม',
                status: 'active',
              },
            });
          }
        }
      }
      if (snap.vehicle?.licensePlate) {
        await tx.tenantVehicle.create({
          data: {
            dormitoryId,
            tenantId: tenant.id,
            type: snap.vehicle.type || 'car',
            brand: snap.vehicle.brand || null,
            licensePlate: snap.vehicle.licensePlate,
            status: 'active',
          },
        });
      }

      const contractCount = await tx.contract.count({ where: { dormitoryId } });
      const contractNumber = `CTR-${Date.now()}-${(contractCount + 1).toString().padStart(4, '0')}`;

      const contract = await tx.contract.create({
        data: {
          dormitoryId,
          contractNumber,
          roomId,
          tenantId: tenant.id,
          status: 'active',
          startDate: new Date(approvedTerms.startDate),
          endDate: new Date(approvedTerms.endDate),
          durationMonths: Number(approvedTerms.durationMonths),
          rentAmount: String(approvedTerms.rentAmount),
          depositAmount: String(approvedTerms.depositAmount),
          advancePaymentAmount: String(approvedTerms.advancePaymentAmount || '0'),
          terms: approvedTerms.terms || null,
          tenantSignature: sigMeta.objectKey,
          createdByUserId: req.reviewedByUserId || null,
          activatedAt: new Date(),
        },
      });

      const occupancy = await tx.occupancy.create({
        data: {
          dormitoryId,
          roomId,
          tenantId: tenant.id,
          contractId: contract.id,
          registrationId: id,
          status: 'ACTIVE',
          startedAt: new Date(approvedTerms.startDate),
        },
      });

      await tx.room.update({
        where: { id: roomId },
        data: {
          status: 'occupied',
          currentTenantId: tenant.id,
          currentContractId: contract.id,
        },
      });

      if (Number(approvedTerms.depositAmount) > 0) {
        await createDepositBillForAgreementInTx(tx, {
          dormitoryId,
          roomId,
          tenantId: tenant.id,
          contractId: contract.id,
          agreementType: 'MONTHLY',
          startDate: new Date(approvedTerms.startDate),
          depositAmount: approvedTerms.depositAmount,
          depositDeclaredStatus: 'UNPAID',
          actorUserId: req.reviewedByUserId || undefined,
        });
      }

      const updatedReq = await tx.tenantRegistrationRequest.update({
        where: { id },
        data: {
          status: 'approved',
          approvedTenantId: tenant.id,
          approvedContractId: contract.id,
          tenantSignatureObjectKey: sigMeta.objectKey,
          tenantSignatureSha256: sigMeta.sha256,
          tenantSignatureMimeType: sigMeta.mimeType,
          tenantSignatureByteSize: sigMeta.byteSize,
        },
      });

      if (req.lineFollowerId) {
        await tx.tenantRegistrationIntent.updateMany({
          where: {
            dormitoryId,
            lineFriendId: req.lineFollowerId,
            purpose: 'TENANT_REGISTRATION',
            status: { in: ['ACTIVE', 'SUBMITTED'] },
          },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
          },
        });
      }

      return {
        success: true,
        request: updatedReq,
        tenant,
        contractId: contract.id,
        occupancy,
        lifecycleStage: 'REGISTERED',
        message: 'ยืนยันสัญญาและเปิดใช้งานห้องพักเรียบร้อยแล้ว',
      };
    });

    try {
      await outboxService.processPendingOutboxEvents();
    } catch (err: any) {
      logger.error({ event: 'OUTBOX_DISPATCH_AFTER_CONFIRM_SIGNATURE_ERROR', error: err.message });
    }

    return resTx;
  }

  public async rejectRequest(
    id: string,
    dormitoryId: string,
    reason?: string,
    actorUserId?: string
  ) {
    const req = await this.getRequestById(id, dormitoryId);
    if (req.status !== 'pending_owner_approval') {
      const err = new Error('INVALID_REQUEST_STATUS');
      (err as any).statusCode = 400;
      (err as any).code = 'INVALID_REQUEST_STATUS';
      (err as any).message = 'คำขอนี้ไม่ได้อยู่ในสถานะรออนุมัติ';
      throw err;
    }

    const currentSnapshot = (req.acceptanceSnapshot as any) || {};
    const revisionHistory = Array.isArray(currentSnapshot.revisionHistory)
      ? [...currentSnapshot.revisionHistory]
      : [];
    const reasonText = reason || 'Owner requested revision';

    revisionHistory.push({
      action: 'REVISION_REQUESTED',
      reason: reasonText,
      reviewedAt: new Date().toISOString(),
      reviewedByUserId: actorUserId || null,
    });

    const updatedSnapshot = {
      ...currentSnapshot,
      revisionHistory,
      currentOwnerComment: reasonText,
    };

    const prisma = getPrismaClient();
    return prisma.tenantRegistrationRequest.update({
      where: { id },
      data: {
        status: 'revision_requested', // Option B non-terminal status
        rejectedReason: reasonText,
        reviewedAt: new Date(),
        reviewedByUserId: actorUserId,
        acceptanceSnapshot: updatedSnapshot,
      },
    });
  }

  public async resubmitRequest(
    id: string,
    dormitoryId: string,
    payload: any
  ) {
    const prisma = getPrismaClient();
    const req = await prisma.tenantRegistrationRequest.findFirst({
      where: { id, dormitoryId },
    });
    if (!req) {
      throw new AppError('ไม่พบคำขอลงทะเบียน', 404, 'REGISTRATION_REQUEST_NOT_FOUND');
    }
    if (req.status !== 'revision_requested' && req.status !== 'pending_owner_approval' && req.status !== 'rejected') {
      throw new AppError('คำขอนี้ไม่สามารถแก้ไขและส่งซ้ำได้ในขณะนี้', 400, 'INVALID_REQUEST_STATUS');
    }

    const currentSnapshot = (req.acceptanceSnapshot as any) || {};
    const revisionHistory = Array.isArray(currentSnapshot.revisionHistory)
      ? [...currentSnapshot.revisionHistory]
      : [];

    revisionHistory.push({
      action: 'RESUBMITTED',
      resubmittedAt: new Date().toISOString(),
      previousComment: req.rejectedReason,
    });

    let newSigKey = req.tenantSignatureObjectKey;
    let newSigSha = req.tenantSignatureSha256;
    let newSigMime = req.tenantSignatureMimeType;
    let newSigByte = req.tenantSignatureByteSize;

    if (payload.signatureBase64) {
      try {
        const base64Clean = payload.signatureBase64.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Clean, 'base64');
        const sigStorage = new SignatureStorageService(prisma);
        const savedSig = await sigStorage.saveTenantSignature({
          dormitoryId,
          buffer,
        });
        newSigKey = savedSig.objectKey;
        newSigSha = savedSig.sha256;
        newSigMime = savedSig.mimeType;
        newSigByte = savedSig.byteSize;
      } catch {}
    }

    const updatedSnapshot = {
      ...currentSnapshot,
      ...payload,
      revisionHistory,
      currentOwnerComment: null,
      resubmittedAt: new Date().toISOString(),
    };

    return prisma.tenantRegistrationRequest.update({
      where: { id },
      data: {
        status: 'pending_owner_approval',
        rejectedReason: null,
        firstName: payload.firstName ? payload.firstName.trim() : req.firstName,
        lastName: payload.lastName ? payload.lastName.trim() : req.lastName,
        phone: payload.phone ? payload.phone.trim() : req.phone,
        note: payload.note !== undefined ? payload.note : req.note,
        submittedAt: new Date(),
        acceptanceSnapshot: updatedSnapshot,
        tenantSignatureObjectKey: newSigKey,
        tenantSignatureSha256: newSigSha,
        tenantSignatureMimeType: newSigMime,
        tenantSignatureByteSize: newSigByte,
      },
    });
  }

  public async getPublicRooms(dormitoryId: string) {
    const prisma = getPrismaClient();
    const dorm = await prisma.dormitory.findUnique({
      where: { id: dormitoryId },
      select: { id: true, name: true },
    });
    if (!dorm) {
      throw new AppError('ไม่พบข้อมูลหอพัก', 404, 'DORMITORY_NOT_FOUND');
    }

    const allRooms = await prisma.room.findMany({
      where: { dormitoryId, deletedAt: null },
      orderBy: { roomNumber: 'asc' },
    });

    const unlinkedTenants = await prisma.tenant.findMany({
      where: {
        dormitoryId,
        status: 'active',
        lineFriendId: null,
        linkedUserId: null,
        deletedAt: null,
      },
      include: {
        occupancies: {
          where: { status: 'ACTIVE' },
          include: { contract: true },
        },
        contracts: {
          where: { status: 'active', deletedAt: null },
        },
        provisionalRentalTerms: {
          where: { status: { in: ['ACTIVE', 'RESERVED'] }, deletedAt: null },
        },
      },
    });

    const unlinkedByRoomId = new Map<string, any>();
    for (const t of unlinkedTenants) {
      for (const occ of t.occupancies) {
        if (occ.roomId) {
          unlinkedByRoomId.set(occ.roomId, {
            tenant: t,
            occupancy: occ,
            contract: occ.contract || t.contracts.find((c: any) => c.roomId === occ.roomId),
            provisional: t.provisionalRentalTerms?.find((p: any) => p.roomId === occ.roomId),
          });
        }
      }
      for (const prov of (t.provisionalRentalTerms || [])) {
        if (prov.roomId && !unlinkedByRoomId.has(prov.roomId)) {
          unlinkedByRoomId.set(prov.roomId, { tenant: t, provisional: prov });
        }
      }
      for (const ct of t.contracts) {
        if (ct.roomId && !unlinkedByRoomId.has(ct.roomId)) {
          unlinkedByRoomId.set(ct.roomId, { tenant: t, contract: ct });
        }
      }
    }

    return allRooms.map((r) => {
      const unlinked = unlinkedByRoomId.get(r.id);
      const isUnboundClaimable = Boolean(unlinked);
      const isVacant = r.status === 'vacant' && !isUnboundClaimable;

      let selectable = false;
      let selectionType: 'PUBLIC_REGISTER' | 'CLAIM_UNLINKED' | 'LOCKED' = 'LOCKED';
      let badgeLabel = '';

      if (r.status === 'maintenance') {
        selectable = false;
        selectionType = 'LOCKED';
        badgeLabel = 'ปิดปรับปรุง';
      } else if (isVacant) {
        selectable = true;
        selectionType = 'PUBLIC_REGISTER';
        badgeLabel = 'ห้องว่าง';
      } else if (isUnboundClaimable) {
        selectable = true;
        selectionType = 'CLAIM_UNLINKED';
        badgeLabel = 'ยังไม่ผูก LINE (ยืนยันสิทธิ์)';
      } else if (r.status === 'occupied') {
        selectable = false;
        selectionType = 'LOCKED';
        badgeLabel = 'มีผู้เช่าแล้ว (ผูก LINE แล้ว)';
      } else if (r.status === 'reserved') {
        selectable = false;
        selectionType = 'LOCKED';
        badgeLabel = 'จองแล้ว (ผูก LINE แล้ว)';
      } else {
        selectable = false;
        selectionType = 'LOCKED';
        badgeLabel = r.status;
      }

      let claimCandidate = null;
      if (unlinked) {
        const ct = unlinked.contract;
        const prov = unlinked.provisional;
        const t = unlinked.tenant;
        const rentalType = prov
          ? (prov.rentalType === 'TERM' ? 'term' : 'monthly')
          : (ct
              ? (ct.durationMonths <= 1 ? 'daily' : (ct.durationMonths <= 4 ? 'term' : 'monthly'))
              : 'monthly');

        claimCandidate = {
          maskedName: maskFullName(t.displayName || t.firstName),
          rentalType,
          monthlyRent: prov ? Number(prov.unitRentAmount) : (ct ? Number(ct.rentAmount) : Number(r.monthlyRent)),
          depositAmount: prov ? Number(prov.depositAmount || 0) : (ct ? Number(ct.depositAmount || 0) : Number(r.depositAmount || 0)),
          advancePaymentAmount: ct ? Number(ct.advancePaymentAmount || 0) : 0,
          durationMonths: prov ? prov.durationMonths : (ct ? ct.durationMonths : 12),
        };
      }

      return {
        id: r.id,
        roomNumber: r.roomNumber,
        floor: r.floor,
        monthlyRent: Number(r.monthlyRent),
        depositAmount: Number(r.depositAmount),
        status: r.status,
        isVacant,
        isUnboundClaimable,
        selectable,
        selectionType,
        badgeLabel,
        claimCandidate,
      };
    });
  }

  public async verifyTenantClaim(params: {
    dormitoryId: string;
    roomId: string;
    claimInput: string;
    actorId?: string;
  }) {
    const { dormitoryId, roomId, claimInput, actorId = 'anonymous' } = params;
    const trimmedInput = (claimInput || '').trim();
    if (!trimmedInput) {
      throw new AppError('กรุณากรอกชื่อ-นามสกุล หรือ เบอร์โทรศัพท์', 400, 'CLAIM_INPUT_REQUIRED');
    }

    // 1. Anti-bruteforce: Claim-scoped 5-minute lockout (Does NOT lock the room globally)
    const actorKey = `claim:${actorId}:${roomId}:${dormitoryId}`;
    const now = Date.now();
    let record = claimActorAttempts.get(actorKey);
    if (record) {
      if (record.lockedUntil && now < record.lockedUntil) {
        const remainingMinutes = Math.ceil((record.lockedUntil - now) / 60000);
        throw new AppError(
          `คุณได้พยายามยืนยันสิทธิ์เกิน 5 ครั้ง กรุณารอ ${remainingMinutes} นาทีแล้วลองใหม่อีกครั้ง`,
          429,
          'RATE_LIMIT_EXCEEDED'
        );
      }
      if (record.lockedUntil && now >= record.lockedUntil) {
        claimActorAttempts.delete(actorKey);
        record = undefined;
      }
    }

    const prisma = getPrismaClient();

    // 2. Look up target room
    const room = await prisma.room.findFirst({
      where: { id: roomId, dormitoryId, deletedAt: null },
    });
    if (!room) {
      throw new AppError('ไม่พบข้อมูลห้องพักที่ระบุ', 404, 'ROOM_NOT_FOUND');
    }

    // 3. Find active unlinked tenant on this room
    const candidateTenant = await prisma.tenant.findFirst({
      where: {
        dormitoryId,
        status: 'active',
        lineFriendId: null,
        linkedUserId: null,
        deletedAt: null,
        OR: [
          { occupancies: { some: { roomId, status: 'ACTIVE' } } },
          { contracts: { some: { roomId, status: 'active', deletedAt: null } } },
          { provisionalRentalTerms: { some: { roomId, status: { in: ['ACTIVE', 'RESERVED'] }, deletedAt: null } } },
        ],
      },
      include: {
        contracts: { where: { roomId, status: 'active', deletedAt: null } },
        provisionalRentalTerms: { where: { roomId, status: { in: ['ACTIVE', 'RESERVED'] }, deletedAt: null } },
        emergencyContacts: { take: 1 },
        vehicles: { where: { status: 'active' } },
        coOccupants: { where: { status: 'active' } },
      },
    });

    if (!candidateTenant) {
      this.recordFailedClaimAttempt(actorKey);
      throw new AppError('ไม่พบข้อมูลผู้เช่าที่รอการยืนยันสิทธิ์ในห้องพักนี้', 404, 'CLAIM_UNAVAILABLE');
    }

    // 4. Test tolerant match
    let isMatched = false;
    const inputPhone = normalizeThaiPhone(trimmedInput);
    if (inputPhone && candidateTenant.phone) {
      const storedPhone = normalizeThaiPhone(candidateTenant.phone);
      if (storedPhone && storedPhone === inputPhone) {
        isMatched = true;
      }
    }

    if (!isMatched) {
      const rawStoredName = candidateTenant.displayName || `${candidateTenant.firstName} ${candidateTenant.lastName || ''}`.trim();
      const similarity = calculateNameSimilarity(rawStoredName, trimmedInput);
      if (similarity >= 0.90) {
        isMatched = true;
      }
    }

    if (!isMatched) {
      this.recordFailedClaimAttempt(actorKey);
      throw new AppError('ข้อมูลชื่อ-นามสกุล หรือ เบอร์โทรศัพท์ไม่ตรงกับข้อมูลในระบบ', 404, 'CLAIM_MATCH_FAILED');
    }

    // Match successful! Clear failed attempts
    claimActorAttempts.delete(actorKey);

    const activeContract = candidateTenant.contracts[0] || null;
    const activeProvisional = candidateTenant.provisionalRentalTerms?.[0] || null;
    const rentalType = activeProvisional
      ? (activeProvisional.rentalType === 'TERM' ? 'term' : 'monthly')
      : (activeContract
          ? (activeContract.durationMonths <= 1 ? 'daily' : (activeContract.durationMonths <= 4 ? 'term' : 'monthly'))
          : 'monthly');

    return {
      verified: true,
      tenantId: candidateTenant.id,
      displayName: candidateTenant.displayName,
      firstName: candidateTenant.firstName,
      lastName: candidateTenant.lastName,
      phone: candidateTenant.phone,
      citizenId: candidateTenant.nationalIdMasked || null,
      room: {
        id: room.id,
        roomNumber: room.roomNumber,
        floor: room.floor,
      },
      lockedFinancials: {
        monthlyRent: activeProvisional
          ? Number(activeProvisional.unitRentAmount)
          : (activeContract ? Number(activeContract.rentAmount) : Number(room.monthlyRent)),
        depositAmount: activeProvisional
          ? Number(activeProvisional.depositAmount || 0)
          : (activeContract ? Number(activeContract.depositAmount) : Number(room.depositAmount)),
        advancePaymentAmount: activeContract ? Number(activeContract.advancePaymentAmount) : 0,
        durationMonths: activeProvisional
          ? activeProvisional.durationMonths
          : (activeContract ? activeContract.durationMonths : 12),
        rentalType,
        depositStatus: 'paid',
        terms: activeContract
          ? (activeContract.terms || '')
          : (activeProvisional
              ? (activeProvisional.rentalType === 'TERM' ? 'สัญญาเช่าแบบเทอม' : 'สัญญาเช่ารายเดือน')
              : ''),
      },
      emergencyContact: candidateTenant.emergencyContacts[0] || null,
      vehicles: candidateTenant.vehicles || [],
      coOccupants: candidateTenant.coOccupants || [],
      pet: candidateTenant.petInfo || null,
    };
  }

  private recordFailedClaimAttempt(actorKey: string) {
    const now = Date.now();
    let record = claimActorAttempts.get(actorKey);
    if (!record || (now - record.firstAttemptAt > 5 * 60 * 1000)) {
      record = { count: 1, firstAttemptAt: now };
    } else {
      record.count += 1;
    }
    if (record.count >= 5) {
      record.lockedUntil = now + 5 * 60 * 1000; // 5-minute lockout
    }
    claimActorAttempts.set(actorKey, record);
  }

  public async completeTenantClaim(params: {
    dormitoryId: string;
    roomId: string;
    tenantId: string;
    inviteToken?: string;
    firstName?: string;
    lastName?: string;
    displayName?: string;
    phone?: string;
    citizenId?: string;
    birthDate?: string;
    address?: string;
    idCardImageUrl?: string;
    emergencyContact?: { name: string; relationship: string; phone: string };
    coOccupants?: Array<{ name: string; phone?: string; citizenId?: string }>;
    vehicle?: { type: string; licensePlate: string; brand?: string };
    pet?: { hasPet: boolean; type?: string; name?: string; count?: number };
    signatureBase64: string;
  }) {
    const {
      dormitoryId,
      roomId,
      tenantId,
      inviteToken,
      firstName,
      lastName,
      displayName,
      phone,
      citizenId,
      emergencyContact,
      coOccupants,
      vehicle,
      pet,
      signatureBase64,
    } = params;

    if (!signatureBase64 || typeof signatureBase64 !== 'string' || !signatureBase64.trim()) {
      throw new AppError('กรุณาลงลายมือชื่อก่อนยืนยันการลงทะเบียน', 400, 'SIGNATURE_REQUIRED');
    }

    const prisma = getPrismaClient();

    // 1. Validate & Store signature
    let sigMeta: { objectKey: string; sha256: string; mimeType: string; byteSize: number };
    try {
      const base64Clean = signatureBase64.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Clean, 'base64');
      const sigStorage = new SignatureStorageService(prisma);
      sigMeta = await sigStorage.saveTenantSignature({
        dormitoryId,
        buffer,
      });
    } catch (sigErr: any) {
      if (sigErr instanceof AppError) throw sigErr;
      throw new AppError('ลายเซ็นไม่ถูกต้องหรือไม่สามารถประมวลผลได้', 400, 'INVALID_SIGNATURE_DATA');
    }

    // 2. Transaction: complete claim directly to REGISTERED (Bypasses Owner Approval)
    return await prisma.$transaction(async (tx) => {
      let lineFollowerId: string | null = null;
      if (inviteToken) {
        const inviteResult = await tenantRegistrationInviteService.consumeInviteInTransaction(inviteToken, tx);
        lineFollowerId = inviteResult.lineFriendId;
      }

      const tenant = await tx.tenant.findFirst({
        where: { id: tenantId, dormitoryId },
      });
      if (!tenant) {
        throw new AppError('ไม่พบข้อมูลผู้เช่า', 404, 'TENANT_NOT_FOUND');
      }

      const finalDisplayName = displayName || (firstName ? `${firstName.trim()} ${(lastName || '').trim()}`.trim() : tenant.displayName);
      const updateData: Prisma.TenantUncheckedUpdateInput = {
        lineFriendId: lineFollowerId || tenant.lineFriendId,
        displayName: finalDisplayName,
        firstName: firstName ? firstName.trim() : tenant.firstName,
        lastName: lastName ? lastName.trim() : tenant.lastName,
        phone: phone ? phone.trim() : tenant.phone,
        status: 'active',
      };
      if (pet) {
        updateData.petInfo = pet as Prisma.InputJsonValue;
      }
      if (citizenId) {
        const cleanId = String(citizenId).replace(/\D/g, '');
        if (cleanId.length === 13) {
          updateData.nationalIdMasked = `${cleanId.slice(0, 1)}-${cleanId.slice(1, 5)}-xxxxx-${cleanId.slice(10, 12)}-${cleanId.slice(12)}`;
        }
      }
      const updatedTenant = await tx.tenant.update({
        where: { id: tenantId },
        data: updateData,
      });

      // Emergency contact
      if (emergencyContact?.name) {
        await tx.tenantEmergencyContact.deleteMany({ where: { tenantId } });
        await tx.tenantEmergencyContact.create({
          data: {
            dormitoryId,
            tenantId,
            name: emergencyContact.name,
            phone: emergencyContact.phone || updatedTenant.phone || '',
            relationship: emergencyContact.relationship || 'ผู้ติดต่อฉุกเฉิน',
            isPrimary: true,
          },
        });
      }

      // Co-occupants
      if (Array.isArray(coOccupants) && coOccupants.length > 0) {
        await tx.tenantCoOccupant.deleteMany({ where: { tenantId } });
        for (const co of coOccupants) {
          if (co.name) {
            await tx.tenantCoOccupant.create({
              data: {
                dormitoryId,
                tenantId,
                name: co.name,
                phone: co.phone || null,
                relationship: 'ผู้พักร่วม',
                status: 'active',
              },
            });
          }
        }
      }

      // Vehicle
      if (vehicle?.licensePlate) {
        await tx.tenantVehicle.deleteMany({ where: { tenantId } });
        await tx.tenantVehicle.create({
          data: {
            dormitoryId,
            tenantId,
            type: vehicle.type || 'car',
            brand: vehicle.brand || null,
            licensePlate: vehicle.licensePlate,
            status: 'active',
          },
        });
      }

      // Attach signature to active contract or convert ProvisionalRentalTerm -> Contract (Rule 9)
      let effectiveContractId: string | null = null;

      const existingContract = await tx.contract.findFirst({
        where: { tenantId, roomId, status: 'active', deletedAt: null },
      });

      if (existingContract) {
        effectiveContractId = existingContract.id;
        await tx.contract.update({
          where: { id: existingContract.id },
          data: {
            tenantSignature: sigMeta.objectKey,
          },
        });
      } else {
        // Safe conversion of ProvisionalRentalTerm -> Contract (Rule 9)
        const provisional = await tx.provisionalRentalTerm.findFirst({
          where: {
            dormitoryId,
            roomId,
            tenantId,
            status: { in: ['ACTIVE', 'RESERVED'] },
            deletedAt: null,
          },
        });

        if (provisional) {
          const contractCount = await tx.contract.count({ where: { dormitoryId } });
          const contractNumber = `CTR-${Date.now()}-${(contractCount + 1).toString().padStart(4, '0')}`;

          // Create Contract strictly with owner-created financials from ProvisionalRentalTerm
          const newContract = await tx.contract.create({
            data: {
              dormitoryId,
              contractNumber,
              roomId,
              tenantId,
              status: 'active',
              startDate: provisional.startDate,
              endDate: provisional.endDate,
              durationMonths: provisional.durationMonths,
              rentAmount: String(provisional.unitRentAmount),
              depositAmount: String(provisional.depositAmount || 0),
              advancePaymentAmount: '0',
              terms: provisional.rentalType === 'TERM' ? 'สัญญาเช่าแบบเทอม' : 'สัญญาเช่ารายเดือน',
              tenantSignature: sigMeta.objectKey,
              createdByUserId: provisional.createdByUserId || null,
              activatedAt: new Date(),
            },
          });
          effectiveContractId = newContract.id;

          // Update ProvisionalRentalTerm: convertedContractId and status = CONVERTED
          await tx.provisionalRentalTerm.update({
            where: { id: provisional.id },
            data: {
              convertedContractId: newContract.id,
              status: 'CONVERTED',
            },
          });

          // Link existing Occupancy to the new Contract
          const occupancy = await tx.occupancy.findFirst({
            where: { dormitoryId, roomId, tenantId, status: 'ACTIVE' },
          });
          if (occupancy) {
            await tx.occupancy.update({
              where: { id: occupancy.id },
              data: { contractId: newContract.id },
            });
          }

          // Link any existing Bills under this provisional term that don't have contractId yet
          await tx.bill.updateMany({
            where: {
              dormitoryId,
              roomId,
              tenantId,
              provisionalRentalTermId: provisional.id,
              contractId: null,
            },
            data: {
              contractId: newContract.id,
            },
          });
        }
      }

      // Ensure room occupied
      await tx.room.update({
        where: { id: roomId },
        data: {
          status: 'occupied',
          currentTenantId: tenantId,
          currentContractId: effectiveContractId,
        },
      });

      // Complete intent if line follower
      if (lineFollowerId) {
        await tx.tenantRegistrationIntent.updateMany({
          where: {
            dormitoryId,
            lineFriendId: lineFollowerId,
            purpose: 'TENANT_REGISTRATION',
            status: { in: ['ACTIVE', 'SUBMITTED'] },
          },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
          },
        });
      }

      return {
        success: true,
        tenant: updatedTenant,
        contractId: effectiveContractId,
        lifecycleStage: 'REGISTERED',
        message: 'ยืนยันสิทธิ์ผู้เช่าและบันทึกสัญญาเรียบร้อยแล้ว',
      };
    });
  }
}

export const tenantRegistrationService = new TenantRegistrationService();
