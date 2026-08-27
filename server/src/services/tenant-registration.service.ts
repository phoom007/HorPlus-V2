import { getPrismaClient } from '../db/prisma.js';
import { logger } from '../config/logger.js';
import { AppError } from '../types/index.js';
import { Prisma } from '@prisma/client';
import { outboxService } from './outbox.service.js';
import { SignatureStorageService } from './signature-storage.service.js';
import { subscriptionEntitlementService } from './subscription-entitlement.service.js';
import { generateNextTenantNumber } from './tenant-number.service.js';
import { tenantRegistrationInviteService } from './tenant-registration-invite.service.js';
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
}

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

      // 2. Validate requestedRoomId and acquire database-authoritative row lock (FOR UPDATE)
      let room: any = null;
      if (req.requestedRoomId) {
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

      // 3. Create Tenant B
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

      const safeActorId = actorUserId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actorUserId) ? actorUserId : null;

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
          createdByUserId: safeActorId,
          activatedAt: new Date(),
        },
      });
      const contractId = contract.id;

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

    const prisma = getPrismaClient();
    return prisma.tenantRegistrationRequest.update({
      where: { id },
      data: {
        status: 'rejected',
        rejectedReason: reason || 'Owner rejected registration request',
        reviewedAt: new Date(),
        reviewedByUserId: actorUserId,
      },
    });
  }
}

export const tenantRegistrationService = new TenantRegistrationService();
