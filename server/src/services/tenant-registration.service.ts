import { acquireRoomAvailabilityLock } from '../utils/occupancy-interval.util.js';
import { createDepositBillForAgreementInTx, createImmediateRentBillForAgreementInTx } from '../utils/deposit-billing.util.js';
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
  maskThaiCandidateName,
} from '../utils/thai-identity.util.js';
import { processAndSecureTenantDocument } from './image-security.service.js';
import { LocalStorageProvider } from './local-storage.service.js';
import { DocumentPdfService } from './document-pdf.service.js';
import crypto from 'crypto';
import { getEnv } from '../config/env.js';
import { auditService } from './audit.service.js';

export interface ClaimVerificationTokenPayload {
  dormitoryId: string;
  roomId: string;
  tenantId: string;
  exp: number;
}

export function generateClaimVerificationToken(payload: {
  dormitoryId: string;
  roomId: string;
  tenantId: string;
}): string {
  const env = getEnv();
  const secret = env.SESSION_ENCRYPTION_KEY || 'claim-verification-secret';
  const data: ClaimVerificationTokenPayload = {
    ...payload,
    exp: Date.now() + 30 * 60 * 1000, // 30 minutes validity
  };
  const jsonStr = JSON.stringify(data);
  const b64Data = Buffer.from(jsonStr, 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(b64Data).digest('base64url');
  return `${b64Data}.${signature}`;
}

export function verifyClaimVerificationToken(token: string): ClaimVerificationTokenPayload {
  if (!token || typeof token !== 'string' || !token.trim()) {
    throw new AppError('ไม่พบรหัสยืนยันการรับสิทธิ์ กรุณายืนยันตัวตนใหม่อีกครั้ง', 400, 'CLAIM_VERIFICATION_REQUIRED');
  }
  const parts = token.trim().split('.');
  if (parts.length !== 2) {
    throw new AppError('รหัสยืนยันการรับสิทธิ์ไม่ถูกต้อง', 400, 'CLAIM_VERIFICATION_INVALID');
  }
  const [b64Data, signature] = parts;
  const env = getEnv();
  const secret = env.SESSION_ENCRYPTION_KEY || 'claim-verification-secret';
  const expectedSig = crypto.createHmac('sha256', secret).update(b64Data).digest('base64url');

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    throw new AppError('รหัสยืนยันการรับสิทธิ์ไม่ถูกต้องหรือถูกแก้ไข', 403, 'CLAIM_VERIFICATION_INVALID');
  }

  let payload: ClaimVerificationTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(b64Data, 'base64url').toString('utf8'));
  } catch {
    throw new AppError('รูปแบบรหัสยืนยันการรับสิทธิ์ไม่ถูกต้อง', 400, 'CLAIM_VERIFICATION_INVALID');
  }

  if (!payload.exp || Date.now() > payload.exp) {
    throw new AppError('รหัสยืนยันการรับสิทธิ์หมดอายุแล้ว กรุณายืนยันตัวตนใหม่อีกครั้ง', 400, 'CLAIM_VERIFICATION_EXPIRED');
  }

  return payload;
}

export interface CreateRegistrationDto {
  dormitoryId?: string;
  inviteToken?: string;
  lineFollowerId?: string;
  lineDisplayName?: string;
  requestedRoomId: string;
  prefix?: string;
  customPrefix?: string;
  firstName: string;
  lastName: string;
  phone: string;
  email?: string | null;
  note?: string;
  agreedTerms: true;
  signatureBase64: string;
  expectedPolicyVersion: number;
  rentalPlan?: 'monthly' | 'term' | 'daily';
  proposedRent?: number | string;
  proposedDeposit?: number | string;
  durationMonths?: number;
  startDate?: string;
  endDate?: string;
  dailyRateAmount?: string | number;
  depositAmount?: string | number;
  citizenId?: string;
  birthDate?: string;
  address?: string;
  idCardImageUrl?: string;
  emergencyContact?: { name: string; relationship: string; phone: string };
  coOccupants?: Array<{ name: string; phone?: string; citizenId?: string }>;
  vehicle?: { type: string; licensePlate: string; brand?: string };
  vehicles?: any[];
  pet?: { hasPet: boolean; type?: string; name?: string; count?: number };
  pets?: any[];
  depositSlipImageUrl?: string;
  depositDeclaredStatus?: string;
  isInstallmentRequested?: boolean;
  selectedInstallmentPlan?: string | null;
  installments?: any[];
  terms?: string | null;
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
  roomId?: string;
  rentalType?: string;
  rentalPlan?: string;
  totalDays?: number;
  dailyRate?: number | string;
  startDate: string;
  endDate?: string;
  durationMonths?: number;
  rentAmount?: string | number;
  depositAmount?: string | number;
  advancePaymentAmount?: string | number;
  terms?: string | null;
  confirmReplacement?: boolean;
  requireTenantConfirmation?: boolean;
  legacyDirectApproval?: boolean;
}

export class TenantRegistrationService {
  private async storeInlineIdentityDocument(dormitoryId: string, dataUrl?: string) {
    if (!dataUrl?.startsWith('data:')) return undefined;
    const match = /^data:image\/[\w.+-]+;base64,([\s\S]+)$/.exec(dataUrl);
    if (!match) throw new AppError('เอกสารรูปภาพไม่ถูกต้อง', 400, 'INVALID_IMAGE_DATA');
    const secured = await processAndSecureTenantDocument(Buffer.from(match[1], 'base64'));
    const objectKey = `registrations/${dormitoryId}/identity-documents/${crypto.randomUUID()}${secured.extension}`;
    await new LocalStorageProvider().saveFile(objectKey, secured.buffer);
    return { objectKey, sha256: secured.sha256, mimeType: secured.mimeType,
      byteSize: secured.byteSize, uploadedAt: new Date().toISOString() };
  }

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

    const billingSettings = await prisma.dormitoryBillingSettings.findUnique({
      where: { dormitoryId },
      select: {
        bankAccountName: true,
        promptPayAccountName: true,
        dueDay: true,
      },
    });

    const building = await prisma.building.findFirst({
      where: { dormitoryId, deletedAt: null },
      select: { termMonths: true },
    });
    const termMonths = building?.termMonths || 6;

    // S6-1: Never expose owner signature or private credentials on public policy endpoint
    const ownerSignature: string | null = null;

    return {
      dormitoryId,
      dormitoryName: dorm.name,
      defaultTerms: defaults?.defaultTerms || '',
      petPolicy: defaults?.petPolicy || { allowed: 'none', allowedTypes: [] },
      version: defaults?.version || 1,
      bankAccountName: billingSettings?.bankAccountName || null,
      promptPayAccountName: billingSettings?.promptPayAccountName || null,
      dueDay: billingSettings?.dueDay || 5,
      ownerSignature,
      termMonths,
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
    payload.lastName = payload.lastName?.trim() || '-';
    if (!payload.requestedRoomId || !payload.firstName?.trim() || !payload.phone?.trim()) {
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

    let savedDocumentKey: string | undefined;
    // 3. Authoritative DB Transaction with FOR UPDATE lock on policy defaults to prevent TOCTOU race
    try {
      const identityDocument = await this.storeInlineIdentityDocument(dormitoryId, payload.idCardImageUrl);
      savedDocumentKey = identityDocument?.objectKey;
      const createdReq = await prisma.$transaction(async (tx) => {
        let targetDormitoryId = dormitoryId;
        let lineFollowerId: string | null = payload.inviteToken ? null : (payload.lineFollowerId || null);

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

        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetDormitoryId)) {
          await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${targetDormitoryId}, true)`;
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

        // Resolve LINE displayName strictly from verified lineFollowerId
        let resolvedLineDisplayName = payload.lineDisplayName?.trim() || null;
        if (lineFollowerId && !resolvedLineDisplayName) {
          const friendRecord = await tx.dormitoryLineFriend.findUnique({
            where: { id: lineFollowerId },
            select: { displayName: true },
          });
          if (friendRecord?.displayName) {
            resolvedLineDisplayName = friendRecord.displayName;
          }
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
          terms: payload.terms || defaultTerms,
          petPolicy,
          policyVersion: currentVersion,
          acceptedAt: acceptedAt.toISOString(),
          prefix: payload.prefix,
          customPrefix: payload.customPrefix,
          applicantName: `${payload.firstName.trim()} ${payload.lastName.trim()}`,
          applicantPhone: payload.phone.trim(),
          lineDisplayName: resolvedLineDisplayName || undefined,
          email: payload.email,
          rentalPlan: payload.rentalPlan || 'monthly',
          proposedRent: payload.proposedRent !== undefined ? payload.proposedRent : undefined,
          proposedDeposit: payload.proposedDeposit !== undefined ? payload.proposedDeposit : undefined,
          durationMonths: payload.durationMonths,
          startDate: payload.startDate,
          endDate: payload.endDate,
          dailyRateAmount: payload.dailyRateAmount,
          depositAmount: payload.depositAmount,
          citizenId: payload.citizenId,
          birthDate: payload.birthDate,
          address: payload.address,
          idCardImageUrl: payload.idCardImageUrl,
          idCardDocument: identityDocument,
          emergencyContact: payload.emergencyContact,
          coOccupants: payload.coOccupants || [],
          vehicle: payload.vehicle,
          vehicles: payload.vehicles || (payload.vehicle ? [payload.vehicle] : []),
          pet: payload.pet,
          pets: payload.pets || (payload.pet ? [payload.pet] : []),
          depositSlipImageUrl: payload.depositSlipImageUrl,
          depositDeclaredStatus: payload.depositDeclaredStatus,
          isInstallmentRequested: payload.isInstallmentRequested,
          selectedInstallmentPlan: payload.selectedInstallmentPlan,
          installments: payload.installments || [],
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

      // 1. In-App Notification for Owner/Staff (Notification Bell)
      try {
        const dorm = await prisma.dormitory.findUnique({
          where: { id: createdReq.dormitoryId },
          select: { name: true, createdByUserId: true },
        });
        const room = await prisma.room.findUnique({
          where: { id: createdReq.requestedRoomId },
          select: { roomNumber: true },
        });
        const applicantName = `${createdReq.firstName} ${createdReq.lastName}`.trim();

        const ownerMembers = await prisma.dormitoryMember.findMany({
          where: {
            dormitoryId: createdReq.dormitoryId,
            status: 'active',
            role: { code: { in: ['OWNER', 'MANAGER'] } },
          },
          select: { userId: true },
        });

        const targetUserIds = new Set<string>();
        if (dorm?.createdByUserId) targetUserIds.add(dorm.createdByUserId);
        for (const m of ownerMembers) {
          if (m.userId) targetUserIds.add(m.userId);
        }

        for (const uid of targetUserIds) {
          await prisma.staffNotification.create({
            data: {
              dormitoryId: createdReq.dormitoryId,
              userId: uid,
              roleCode: 'OWNER',
              category: 'TENANT_REGISTRATION',
              title: `มีคำขอลงทะเบียนผู้เช่าใหม่ (ห้อง ${room?.roomNumber || 'ไม่ระบุ'})`,
              message: `คุณ${applicantName} ได้ส่งคำขอลงทะเบียนเช่าห้อง ${room?.roomNumber || 'ไม่ระบุ'} กรุณาตรวจสอบและดำเนินการ`,
              metadata: {
                registrationId: createdReq.id,
                roomId: createdReq.requestedRoomId,
                roomNumber: room?.roomNumber,
                applicantName,
                phone: createdReq.phone,
              },
            },
          }).catch((err) => {
            logger.warn('Failed to create staff notification for user:', { userId: uid, error: err.message });
          });
        }
      } catch (inAppErr: any) {
        logger.warn('In-app notification for new tenant registration error:', { error: inAppErr.message });
      }

      // 2. Push notification to owner(s) via LINE OA
      try {
        const dormConfig = await prisma.dormitoryLineConfig.findUnique({
          where: { dormitoryId: createdReq.dormitoryId },
        });
        if (dormConfig && dormConfig.notifyTenantRegister !== false) {
          const ownerGrants = await prisma.dormitoryAccessGrant.findMany({
            where: {
              dormitoryId: createdReq.dormitoryId,
              roleCode: { in: ['OWNER', 'MANAGER'] },
              status: 'ACTIVE',
            },
            include: { lineFriend: true },
          });

          const { LineOaService, buildOwnerNewTenantRegistrationFlexMessage, getPublicAppOrigin } = await import('./line-oa.service.js');
          const lineOaService = new LineOaService(prisma);
          const dorm = await prisma.dormitory.findUnique({
            where: { id: createdReq.dormitoryId },
            select: { name: true },
          });
          const room = await prisma.room.findUnique({
            where: { id: createdReq.requestedRoomId },
            select: { roomNumber: true },
          });

          const applicantName = `${createdReq.firstName} ${createdReq.lastName}`.trim();
          const flexMsg = buildOwnerNewTenantRegistrationFlexMessage(
            dorm?.name || 'หอพัก',
            applicantName,
            room?.roomNumber || 'ไม่ระบุ',
            createdReq.phone,
            getPublicAppOrigin()
          );

          const { decryptText } = await import('../utils/crypto-encryption.js');
          for (const og of ownerGrants) {
            const friend = og.lineFriend;
            if (friend && friend.lineUserIdEncrypted) {
              const ownerLineUserId = decryptText(friend.lineUserIdEncrypted);
              await lineOaService.pushOutcomeNotification(createdReq.dormitoryId, ownerLineUserId, flexMsg).catch((err) => {
                logger.warn('Failed to push new tenant registration notification to owner:', { error: err.message });
              });
            }
          }
        }
      } catch (ownerPushErr: any) {
        logger.warn('Owner push notification for new tenant registration error:', { error: ownerPushErr.message });
      }

      return createdReq;
    } catch (txErr: any) {
      if (savedDocumentKey) await new LocalStorageProvider().deleteFile(savedDocumentKey).catch(() => {});
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

  public async listRequests(dormitoryId: string): Promise<any[]> {
    const prisma = getPrismaClient();
    const requests = await prisma.tenantRegistrationRequest.findMany({
      where: { dormitoryId },
      orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
    });

    const dormFriends = await prisma.dormitoryLineFriend.findMany({
      where: { dormitoryId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, displayName: true, pictureUrl: true },
    });
    const friendById = new Map(dormFriends.map((f) => [f.id, f]));
    const latestTenantFriend = dormFriends[0] || null;

    return requests.map((req) => {
      const snap = (req.acceptanceSnapshot as any) || {};
      const matchedFriend = req.lineFollowerId ? friendById.get(req.lineFollowerId) : null;
      const resolvedLineName =
        matchedFriend?.displayName ||
        snap.lineDisplayName ||
        snap.lineName ||
        'ผู้ใช้งาน LINE';
      return {
        ...req,
        lineFollowerId: req.lineFollowerId || matchedFriend?.id || null,
        lineFollower: matchedFriend || null,
        lineDisplayName: resolvedLineName,
        lineName: resolvedLineName,
      };
    });
  }

  public async getRequestById(id: string, dormitoryId: string): Promise<any> {
    const prisma = getPrismaClient();
    let req = await prisma.tenantRegistrationRequest.findFirst({
      where: { id, dormitoryId },
    });
    if (!req) {
      req = await prisma.tenantRegistrationRequest.findFirst({
        where: { dormitoryId, approvedTenantId: id },
      });
    }
    if (!req) {
      const err = new Error('REGISTRATION_REQUEST_NOT_FOUND');
      (err as any).statusCode = 404;
      (err as any).code = 'REGISTRATION_REQUEST_NOT_FOUND';
      throw err;
    }

    let matchedFriend: { id: string; displayName: string; pictureUrl: string | null } | null = null;
    if (req.lineFollowerId) {
      matchedFriend = await prisma.dormitoryLineFriend.findFirst({
        where: { id: req.lineFollowerId },
        select: { id: true, displayName: true, pictureUrl: true },
      });
    }
    if (!matchedFriend) {
      matchedFriend = await prisma.dormitoryLineFriend.findFirst({
        where: { dormitoryId },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, displayName: true, pictureUrl: true },
      });
    }

    const snap = (req.acceptanceSnapshot as any) || {};
    const resolvedLineName =
      matchedFriend?.displayName ||
      snap.lineDisplayName ||
      snap.lineName ||
      'ผู้ใช้งาน LINE';
    return {
      ...req,
      lineFollowerId: req.lineFollowerId || matchedFriend?.id || null,
      lineFollower: matchedFriend || null,
      lineDisplayName: resolvedLineName,
      lineName: resolvedLineName,
    };
  }

  public async getRegistrationContractPdf(
    dormitoryId: string,
    registrationId: string,
    overrides?: {
      roomId?: string;
      startDate?: string;
      endDate?: string;
      rentAmount?: string;
      depositAmount?: string;
    }
  ): Promise<{ buffer: Buffer; filename: string }> {
    const prisma = getPrismaClient();
    const req = await this.getRequestById(registrationId, dormitoryId);
    const snap = (req.acceptanceSnapshot as any) || {};

    const dorm = await prisma.dormitory.findUnique({
      where: { id: dormitoryId },
      include: {
        billingSettings: true,
        propertyDefaults: true,
      },
    });

    const targetRoomId = overrides?.roomId || req.approvedRoomId || req.requestedRoomId || snap.requestedRoomId;
    const room = targetRoomId
      ? await prisma.room.findFirst({
          where: { id: targetRoomId, dormitoryId },
          include: { building: true },
        })
      : null;

    const bs = dorm?.billingSettings;
    const rawBankName = bs?.bankAccountName?.trim() || bs?.promptPayAccountName?.trim() || null;
    const ownerDisplayName = rawBankName
      ? `${rawBankName} (${dorm?.name || 'หอพัก'})`
      : dorm?.name || 'เจ้าของหอพัก';

    let ownerSignatureUrl: string | null = null;
    let tenantSignatureUrl: string | null = null;
    const sigStorage = new SignatureStorageService(prisma);

    try {
      const ownerSigRec = await sigStorage.getLatestSignatureRecord(dormitoryId);
      if (ownerSigRec) {
        const stream = await sigStorage.getSignatureStream(ownerSigRec.objectKey);
        const chunks: Buffer[] = [];
        for await (const chunk of stream) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        ownerSignatureUrl = `data:${ownerSigRec.mimeType || 'image/png'};base64,${Buffer.concat(chunks).toString('base64')}`;
      }
    } catch {}

    if (req.tenantSignatureObjectKey) {
      try {
        const stream = await sigStorage.getSignatureStream(req.tenantSignatureObjectKey);
        const chunks: Buffer[] = [];
        for await (const chunk of stream) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        tenantSignatureUrl = `data:${req.tenantSignatureMimeType || 'image/png'};base64,${Buffer.concat(chunks).toString('base64')}`;
      } catch {}
    }

    const prefix =
      snap.prefix === 'ระบุเอง' || snap.prefix === 'กำหนดเอง'
        ? snap.customPrefix?.trim() || ''
        : snap.prefix?.trim() || '';
    const rawFirst = req.firstName?.trim() || '';
    const rawLast = req.lastName && req.lastName !== '-' ? req.lastName.trim() : '';
    const fullName = `${rawFirst} ${rawLast}`.trim();
    const tenantDisplayName = prefix
      ? fullName.startsWith(prefix)
        ? fullName
        : `${prefix} ${fullName}`.trim()
      : fullName;

    const effectiveRoomNumber = room?.roomNumber || snap.requestedRoomNumber || '101';
    const effectiveStartDate =
      overrides?.startDate ||
      snap.approvedTerms?.startDate ||
      snap.startDate ||
      new Date().toISOString().split('T')[0];
    const effectiveEndDate =
      overrides?.endDate ||
      snap.approvedTerms?.endDate ||
      snap.endDate ||
      effectiveStartDate;
    const effectiveRent = String(
      overrides?.rentAmount ?? snap.approvedTerms?.rentAmount ?? snap.proposedRent ?? room?.monthlyRent ?? '0'
    );
    const effectiveDeposit = String(
      overrides?.depositAmount ?? snap.approvedTerms?.depositAmount ?? snap.proposedDeposit ?? snap.depositAmount ?? room?.monthlyDeposit ?? '0'
    );
    const contractNumber = `CTR-${effectiveRoomNumber}-${effectiveStartDate.slice(0, 7).replace('-', '')}`;

    const coTenants = Array.isArray(snap.coOccupants)
      ? snap.coOccupants.map((c: any) => ({ name: c.name || '-', phone: c.phone || undefined }))
      : [];

    const pdfService = new DocumentPdfService();
    const pdfBuffer = await pdfService.generateContractPdf({
      contractNumber,
      dormitoryName: dorm?.name || 'Dormitory',
      dormitoryAddress: dorm?.addressLine1,
      dormitoryPhone: dorm?.phone,
      ownerName: ownerDisplayName,
      ownerSignatureUrl,
      tenantName: tenantDisplayName || 'ผู้เช่า',
      tenantPhone: req.phone,
      coTenants,
      buildingName: (room as any)?.building?.name || room?.buildingId || null,
      roomNumber: effectiveRoomNumber,
      rentBillingType: snap.rentalPlan === 'term' ? 'term' : 'monthly',
      startDate: effectiveStartDate,
      endDate: effectiveEndDate,
      rentAmount: effectiveRent,
      depositAmount: effectiveDeposit,
      waterRate: bs?.waterRate ? bs.waterRate.toString() : '18.00',
      electricityRate: bs?.electricityRate ? bs.electricityRate.toString() : '7.00',
      commonFee: bs?.commonFee ? bs.commonFee.toString() : '0.00',
      internetFee: (bs as any)?.internetFee ? (bs as any).internetFee.toString() : '0.00',
      billingDay: bs?.billingDay || 25,
      dueDay: bs?.dueDay ? Number(bs.dueDay) : '-',
      lateFeeMode: (bs as any)?.lateFeeMode || 'fixed',
      lateFeeAmount: (bs as any)?.lateFeeAmount ? (bs as any).lateFeeAmount.toString() : '0.00',
      tenantSignature: tenantSignatureUrl,
      terms: snap.terms || dorm?.propertyDefaults?.defaultTerms || null,
      createdAt: req.submittedAt ? req.submittedAt.toISOString().split('T')[0] : undefined,
    });

    return {
      buffer: pdfBuffer,
      filename: `${contractNumber}.pdf`,
    };
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
    const prisma = getPrismaClient();

    // Check request snapshot to determine rental type if not specified in payload
    const existingReq = await prisma.tenantRegistrationRequest.findFirst({
      where: { id, dormitoryId },
      select: { acceptanceSnapshot: true, lineFollowerId: true },
    });
    const reqSnap = (existingReq?.acceptanceSnapshot as any) || {};
    const isDaily = payload?.rentalType?.toUpperCase() === 'DAILY' || reqSnap.rentalType === 'DAILY' || reqSnap.rentalPlan === 'daily';

    if (!payload || !payload.startDate || !payload.endDate || payload.depositAmount === undefined) {
      const err = new Error('MISSING_CONTRACT_TERMS');
      (err as any).statusCode = 400;
      (err as any).code = 'MISSING_CONTRACT_TERMS';
      (err as any).message = 'กรุณาระบุข้อกำหนดสัญญาที่จำเป็นให้ครบถ้วน (วันเริ่ม, วันสิ้นสุด, เงินมัดจำ)';
      throw err;
    }

    if (!isDaily && payload.rentAmount === undefined && (reqSnap.rentAmount === undefined || reqSnap.rentAmount === null) && (reqSnap.proposedRent === undefined || reqSnap.proposedRent === null)) {
      const err = new Error('MISSING_CONTRACT_TERMS');
      (err as any).statusCode = 400;
      (err as any).code = 'MISSING_CONTRACT_TERMS';
      (err as any).message = 'กรุณาระบุค่าเช่า';
      throw err;
    }

    if (!isDaily && payload.durationMonths === undefined) {
      if (reqSnap.durationMonths) {
        payload.durationMonths = Number(reqSnap.durationMonths);
      } else {
        const sDate = new Date(payload.startDate);
        const eDate = new Date(payload.endDate);
        const months = Math.max(1, Math.round((eDate.getTime() - sDate.getTime()) / (30 * 24 * 3600 * 1000)));
        payload.durationMonths = months;
      }
    }

    if (payload.advancePaymentAmount === undefined) {
      payload.advancePaymentAmount = 0;
    }

    const resTx = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;

      // 1. Re-verify request status inside transaction
      let req = await tx.tenantRegistrationRequest.findFirst({
        where: { id, dormitoryId },
      });
      if (!req) {
        req = await tx.tenantRegistrationRequest.findFirst({
          where: { dormitoryId, approvedTenantId: id },
        });
      }

      if (!req) {
        const err = new Error('REGISTRATION_REQUEST_NOT_FOUND');
        (err as any).statusCode = 404;
        (err as any).code = 'REGISTRATION_REQUEST_NOT_FOUND';
        throw err;
      }

      if (req.status !== 'pending_owner_approval' && req.status !== 'pending' && req.status !== 'awaiting_tenant_confirmation') {
        const err = new Error('INVALID_REQUEST_STATUS');
        (err as any).statusCode = 400;
        (err as any).code = 'INVALID_REQUEST_STATUS';
        (err as any).message = 'คำขอนี้ไม่ได้อยู่ในสถานะรออนุมัติ';
        throw err;
      }

      // 2. Acquire shared room advisory availability lock, row lock, and validate maintenance status
      const effectiveRoomId = payload.roomId || req.requestedRoomId;
      let room: any = null;
      if (effectiveRoomId) {
        // 2.1 Shared room advisory availability lock (matching RoomService, Contract, Provisional, Daily)
        await acquireRoomAvailabilityLock(tx, dormitoryId, effectiveRoomId);

        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(effectiveRoomId);
        if (isUuid) {
          try {
            await tx.$executeRaw`SELECT id FROM rooms WHERE id = ${effectiveRoomId}::uuid FOR UPDATE`;
          } catch {}
        }

        room = await tx.room.findFirst({ where: { id: effectiveRoomId, dormitoryId } });
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
          where: { dormitoryId, roomId: effectiveRoomId, status: 'ACTIVE' },
          include: { tenant: true, contract: true },
        });

        const futureContract = await tx.contract.findFirst({
          where: {
            dormitoryId,
            roomId: effectiveRoomId,
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
                roomId: effectiveRoomId,
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
              roomId: effectiveRoomId,
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
                  roomId: effectiveRoomId,
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
              roomId: effectiveRoomId,
              actorUserId,
              action: 'OWNER_FORCED_REPLACEMENT_EXECUTED',
              msg: `Owner terminated active tenancy for tenant ${oldTenantId} to approve replacement applicant ${id}`,
            });
          }
        }
      }

      if (!effectiveRoomId) {
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

      // Two-Phase Registration: Move to awaiting_tenant_confirmation only when terms were modified or explicitly required
      const snapTerms = (req.acceptanceSnapshot as any) || {};
      const termsModified = Boolean(
        (payload.roomId && payload.roomId !== req.requestedRoomId) ||
        (payload.rentAmount !== undefined && snapTerms.proposedRent !== undefined && Number(payload.rentAmount) !== Number(snapTerms.proposedRent)) ||
        (payload.depositAmount !== undefined && snapTerms.proposedDeposit !== undefined && Number(payload.depositAmount) !== Number(snapTerms.proposedDeposit)) ||
        (payload.startDate && snapTerms.startDate && payload.startDate !== snapTerms.startDate) ||
        (payload.durationMonths !== undefined && snapTerms.durationMonths !== undefined && Number(payload.durationMonths) !== Number(snapTerms.durationMonths))
      );

      const shouldRequireConfirmation = payload.requireTenantConfirmation === true || (payload.requireTenantConfirmation !== false && termsModified);

      if (shouldRequireConfirmation) {
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
          where: { id: req.id },
          data: {
            status: 'awaiting_tenant_confirmation',
            reviewedAt: new Date(),
            reviewedByUserId: safeActorId,
            approvedRoomId: effectiveRoomId,
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
      const snap = (req.acceptanceSnapshot as any) || {};
      let prefix = snap.prefix === 'ระบุเอง' || snap.prefix === 'กำหนดเอง'
        ? (snap.customPrefix?.trim() || '')
        : (snap.prefix?.trim() || '');
      const rawFirst = req.firstName?.trim() || '';
      const rawLast = req.lastName && req.lastName !== '-' ? req.lastName.trim() : '';
      const fullName = `${rawFirst} ${rawLast}`.trim();
      const displayName = prefix
        ? (fullName.startsWith(prefix) ? fullName : `${prefix} ${fullName}`.trim())
        : fullName;

      let tenant = null;
      if (req.approvedTenantId) {
        tenant = await tx.tenant.findFirst({
          where: { id: req.approvedTenantId, dormitoryId },
        });
      }
      if (!tenant && req.phone) {
        tenant = await tx.tenant.findFirst({
          where: { dormitoryId, phone: req.phone, status: 'pending' },
        });
      }

      let linkedUserId = tenant?.linkedUserId || null;
      if (linkedUserId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(linkedUserId)) {
        linkedUserId = null;
      }
      const targetFriendId = req.lineFollowerId || tenant?.lineFriendId;

      const emailToSave = (req as any).email || snap.email || undefined;

      if (tenant) {
        tenant = await tx.tenant.update({
          where: { id: tenant.id },
          data: {
            status: 'active',
            firstName: req.firstName,
            lastName: req.lastName,
            displayName,
            phone: req.phone,
            ...(emailToSave ? { email: emailToSave } : {}),
            lineFriendId: targetFriendId || null,
            linkedUserId: linkedUserId || tenant.linkedUserId,
          },
        });
      } else {
        tenant = await tx.tenant.create({
          data: {
            dormitoryId,
            tenantNumber,
            firstName: req.firstName,
            lastName: req.lastName,
            displayName,
            phone: req.phone,
            email: emailToSave || null,
            lineFriendId: targetFriendId || null,
            linkedUserId,
            status: 'active',
          },
        });
      }

      if (req.phone) {
        await tx.tenant.deleteMany({
          where: {
            dormitoryId,
            phone: req.phone,
            status: 'pending',
            id: { not: tenant.id },
          },
        });
      }

      // Sync profile from registration snapshot onto tenant
      const tenantUpdateData: Prisma.TenantUpdateInput = {
        address: snap.address ?? null,
        dateOfBirth: snap.birthDate ? new Date(snap.birthDate) : null,
        notes: req.note ?? null,
      };
      if (emailToSave && !tenant.email) {
        tenantUpdateData.email = emailToSave;
      }
      if (snap.pet || snap.pets) {
        const petsList = Array.isArray(snap.pets) && snap.pets.length > 0
          ? snap.pets
          : (snap.pet?.hasPet && snap.pet?.type ? [snap.pet] : []);
        tenantUpdateData.petInfo = {
          hasPet: petsList.length > 0,
          pets: petsList.map((p: any, idx: number) => ({
            id: p.id || `pet-${Date.now()}-${idx}`,
            type: p.type || '',
            customType: p.customType || '',
            name: p.name || '',
          })),
          type: petsList[0]?.type || snap.pet?.type || '',
          name: petsList[0]?.name || snap.pet?.name || '',
        } as Prisma.InputJsonValue;
      }
      if (snap.citizenId) {
        const cleanId = String(snap.citizenId).replace(/\D/g, '');
        if (cleanId.length === 13) {
          tenantUpdateData.nationalIdMasked = `${cleanId.slice(0, 1)}-${cleanId.slice(1, 5)}-xxxxx-${cleanId.slice(10, 12)}-${cleanId.slice(12)}`;
        }
      }

      // Promote/adopt ID document from pending registration acceptanceSnapshot onto canonical Tenant record
      const snapDoc = snap.idCardDocument || (Array.isArray(snap.attachments) ? snap.attachments.find((a: any) => a.isIdCard || a.name?.includes('บัตรประชาชน') || a.type?.includes('pdf') || a.type?.includes('image')) : null);
      const promotedObjectKey = snapDoc?.objectKey || snap.idCardImageUrl || snap.idCardImage || snap.idCardPhoto || null;
      if (promotedObjectKey && !tenant.idCardObjectKey) {
        tenantUpdateData.idCardObjectKey = promotedObjectKey;
        tenantUpdateData.idCardSha256 = snapDoc?.sha256 || null;
        tenantUpdateData.idCardMimeType = snapDoc?.mimeType || (promotedObjectKey.endsWith('.pdf') ? 'application/pdf' : 'image/webp');
        tenantUpdateData.idCardByteSize = snapDoc?.byteSize ? Number(snapDoc.byteSize) : null;
        tenantUpdateData.idCardUploadedAt = snapDoc?.uploadedAt ? new Date(snapDoc.uploadedAt) : new Date();
        tenantUpdateData.idCardUploadedByUserId = safeActorId;
      }

      if (Object.keys(tenantUpdateData).length > 0) {
        tenant = await tx.tenant.update({
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
      const vehiclesList = Array.isArray(snap.vehicles) && snap.vehicles.length > 0
        ? snap.vehicles
        : (snap.vehicle?.licensePlate ? [snap.vehicle] : []);
      for (const veh of vehiclesList) {
        if (veh.licensePlate) {
          await tx.tenantVehicle.create({
            data: {
              dormitoryId,
              tenantId: tenant.id,
              type: veh.type || 'car',
              brand: veh.brand || null,
              model: veh.model || null,
              color: veh.color || null,
              province: veh.province || null,
              licensePlate: veh.licensePlate,
              status: 'active',
            },
          });
        }
      }

      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const startDateObj = (payload.startDate as any) instanceof Date ? (payload.startDate as any) : new Date(payload.startDate);
      const startYear = startDateObj.getFullYear();
      const startMonth = String(startDateObj.getMonth() + 1).padStart(2, '0');
      const startDay = String(startDateObj.getDate()).padStart(2, '0');
      const startStr = `${startYear}-${startMonth}-${startDay}`;
      const isFutureStartDate = Boolean(startStr && startStr > todayStr);

      const rentalPlan = (payload.rentalType || payload.rentalPlan || snap.rentalType || snap.rentalPlan || 'monthly').toLowerCase();
      const isDaily = rentalPlan === 'daily';
      const isTerm = rentalPlan === 'term';

      let contractId: string | null = null;
      let dailyStayRecord: any = null;

      if (isDaily) {
        // 4. Create DailyStay (NO Contract created for Daily rental)
        dailyStayRecord = await tx.dailyStay.create({
          data: {
            dormitoryId,
            roomId: effectiveRoomId,
            tenantId: tenant.id,
            requestSource: 'TENANT',
            applicantFullName: displayName,
            applicantPhone: req.phone,
            requesterUserId: safeActorId || undefined,
            startDate: new Date(payload.startDate),
            endDate: new Date(payload.endDate || payload.startDate),
            checkInAt: new Date(payload.startDate),
            checkOutAt: new Date(payload.endDate || payload.startDate),
            inclusiveDayCount: payload.totalDays || Math.max(1, Math.round((new Date(payload.endDate || payload.startDate).getTime() - new Date(payload.startDate).getTime()) / (24 * 3600 * 1000))),
            dailyRateAmount: payload.dailyRate ? new Prisma.Decimal(payload.dailyRate) : new Prisma.Decimal(payload.rentAmount || 0),
            totalRentAmount: new Prisma.Decimal(payload.rentAmount || (Number(payload.dailyRate || 0) * Number(payload.totalDays || 1))),
            depositAmount: new Prisma.Decimal(payload.depositAmount || 0),
            depositDeclaredStatus: (payload as any).depositDeclaredStatus || snap.depositDeclaredStatus || 'UNPAID',
            status: isFutureStartDate ? 'RESERVED' : 'ACTIVE',
            approvedAt: new Date(),
            approvedByUserId: safeActorId,
          },
        });

        // 5. Establish Authoritative Occupancy & Transition Room
        const occupancy = await tx.occupancy.create({
          data: {
            dormitoryId,
            roomId: effectiveRoomId,
            tenantId: tenant.id,
            registrationId: id,
            status: isFutureStartDate ? 'RESERVED' : 'ACTIVE',
            startedAt: new Date(payload.startDate),
          },
        });

        if (!isFutureStartDate) {
          await tx.room.update({
            where: { id: effectiveRoomId },
            data: {
              status: 'occupied',
              currentTenantId: tenant.id,
            },
          });
        }
        // When isFutureStartDate is true, physical room remains vacant today (currentTenantId: null)
        // while the reservation is interval-protected via DailyStay (RESERVED) and Occupancy (RESERVED).

        // 6. Update Registration Request status to approved
        const updatedReq = await tx.tenantRegistrationRequest.update({
          where: { id: req.id },
          data: {
            status: 'approved',
            reviewedAt: new Date(),
            reviewedByUserId: safeActorId,
            approvedTenantId: tenant.id,
            approvedRoomId: effectiveRoomId,
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
          tenantId: tenant.id,
          contractId: null,
          occupancyId: occupancy.id,
          roomId: effectiveRoomId,
          dailyStay: dailyStayRecord,
          status: 'approved',
          message: isFutureStartDate ? 'อนุมัติการจองเข้าพักรายวันเรียบร้อยแล้ว' : 'อนุมัติการเข้าพักรายวันเรียบร้อยแล้ว',
        };
      }

      // 4. Create Contract for Monthly or Term
      const contractCount = await tx.contract.count({ where: { dormitoryId } });
      const contractNumber = `CTR-${Date.now()}-${(contractCount + 1).toString().padStart(4, '0')}`;

      // Capture/freeze the current dormitory Owner Signature from Settings at contract signing time
      const latestOwnerSig = await tx.ownerSignature.findFirst({
        where: { dormitoryId, isCurrent: true },
        orderBy: { createdAt: 'desc' },
      });
      const frozenOwnerSignature = latestOwnerSig?.objectKey || null;

      const contract = await tx.contract.create({
        data: {
          dormitoryId,
          contractNumber,
          roomId: effectiveRoomId,
          tenantId: tenant.id,
          status: isFutureStartDate ? 'approved_scheduled' : 'active',
          startDate: new Date(payload.startDate),
          endDate: new Date(payload.endDate || payload.startDate),
          durationMonths: payload.durationMonths || (isTerm ? 4 : 12),
          rentBillingType: isTerm ? 'term' : 'monthly',
          rentAmount: String(payload.rentAmount !== undefined && payload.rentAmount !== null ? payload.rentAmount : (snap.proposedRent ?? 0)),
          depositAmount: String(payload.depositAmount !== undefined && payload.depositAmount !== null ? payload.depositAmount : (snap.proposedDeposit ?? 0)),
          advancePaymentAmount: String(payload.advancePaymentAmount !== undefined && payload.advancePaymentAmount !== null ? payload.advancePaymentAmount : 0),
          terms: payload.terms || (snap.terms as string) || (snap.defaultTerms as string) || null,
          tenantSignature: req.tenantSignatureObjectKey || req.tenantSignatureSha256 || 'SIGNED',
          ownerSignature: frozenOwnerSignature,
          createdByUserId: safeActorId,
          activatedAt: isFutureStartDate ? null : new Date(),
        },
      });
      contractId = contract.id;

      // 5. Establish Authoritative Occupancy B & Transition Room B
      const occupancy = await tx.occupancy.create({
        data: {
          dormitoryId,
          roomId: effectiveRoomId,
          tenantId: tenant.id,
          registrationId: id,
          contractId: contractId,
          status: isFutureStartDate ? 'SCHEDULED' : 'ACTIVE',
          startedAt: new Date(payload.startDate),
        },
      });

      if (!isFutureStartDate) {
        await tx.room.update({
          where: { id: effectiveRoomId },
          data: {
            status: 'occupied',
            currentTenantId: tenant.id,
            currentContractId: contractId,
          },
        });
      } else {
        const currentRoom = await tx.room.findUnique({ where: { id: effectiveRoomId } });
        const roomNorm = (currentRoom?.status || '').trim().toLowerCase();
        if (roomNorm === 'vacant' || roomNorm === 'available') {
          await tx.room.update({
            where: { id: effectiveRoomId },
            data: { status: 'reserved' },
          });
        }
      }

      // 5.5. Create one-time Deposit Bill for approved registration contract
      if (Number(payload.depositAmount) > 0 || Number(payload.rentAmount) > 0) {
        // Ensure billing cycle covering startDate exists for future start dates
        const startD = new Date(payload.startDate);
        const cycleExists = await tx.billingCycle.findFirst({
          where: {
            dormitoryId,
            periodStart: { lte: startD },
            periodEnd: { gte: startD },
          },
        });

        if (!cycleExists) {
          const latestCycle = await tx.billingCycle.findFirst({
            where: { dormitoryId },
            orderBy: { periodEnd: 'desc' },
            include: { rateSnapshot: true },
          });

          if (latestCycle && startD > new Date(latestCycle.periodEnd)) {
            let curEnd = new Date(latestCycle.periodEnd);
            let prevCycle = latestCycle;

            while (curEnd < startD) {
              const nextMonthDate = new Date(curEnd);
              nextMonthDate.setDate(nextMonthDate.getDate() + 1);
              const y = nextMonthDate.getFullYear();
              const m = nextMonthDate.getMonth() + 1;
              const cycleCode = `${y}-${String(m).padStart(2, '0')}`;
              const lastDay = new Date(y, m, 0).getDate();
              const periodStart = new Date(`${y}-${String(m).padStart(2, '0')}-01`);
              const periodEnd = new Date(`${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`);
              const nextM = m === 12 ? 1 : m + 1;
              const nextY = m === 12 ? y + 1 : y;
              const billingDate = new Date(`${y}-${String(m).padStart(2, '0')}-25`);
              const dueDate = new Date(`${nextY}-${String(nextM).padStart(2, '0')}-05`);

              const newCycle = await tx.billingCycle.create({
                data: {
                  dormitoryId,
                  cycleCode,
                  name: cycleCode,
                  periodStart,
                  periodEnd,
                  billingDate,
                  dueDate,
                  status: 'draft',
                  createdByUserId: safeActorId,
                },
              });

              if (prevCycle?.rateSnapshot) {
                const snap = { ...prevCycle.rateSnapshot };
                delete (snap as any).id;
                delete (snap as any).billingCycleId;
                delete (snap as any).createdAt;
                delete (snap as any).updatedAt;
                await tx.billingRateSnapshot.create({
                  data: {
                    ...snap,
                    dormitoryId,
                    billingCycleId: newCycle.id,
                    source: 'INHERITED',
                    inheritedFromBillingCycleId: prevCycle.id,
                  } as any,
                });
              }

              prevCycle = newCycle as any;
              curEnd = periodEnd;
            }
          }
        }

        await createDepositBillForAgreementInTx(tx, {
          dormitoryId,
          roomId: effectiveRoomId,
          tenantId: tenant.id,
          contractId: contractId,
          agreementType: isTerm ? 'TERM' : 'MONTHLY',
          startDate: new Date(payload.startDate),
          depositAmount: payload.depositAmount || 0,
          depositDeclaredStatus: (payload as any).depositDeclaredStatus || 'UNPAID',
          actorUserId: safeActorId,
        });
        await createImmediateRentBillForAgreementInTx(tx, {
          dormitoryId,
          roomId: effectiveRoomId,
          tenantId: tenant.id,
          contractId: contractId,
          agreementType: isTerm ? 'TERM' : 'MONTHLY',
          startDate: new Date(payload.startDate),
          endDate: payload.endDate ? new Date(payload.endDate) : null,
          unitRentAmount: payload.rentAmount || 0,
          totalRentAmount: isTerm
            ? (Number(payload.rentAmount || 0) * Number(payload.durationMonths || 1))
            : (payload.rentAmount || 0),
          termInstallmentCount: isTerm ? Number((payload as any).termInstallmentCount || 1) : 1,
          actorUserId: safeActorId,
        });
      }

      // 6. Update Registration Request status to approved
      const updatedReq = await tx.tenantRegistrationRequest.update({
        where: { id: req.id },
        data: {
          status: 'approved',
          reviewedAt: new Date(),
          reviewedByUserId: safeActorId,
          approvedTenantId: tenant.id,
          approvedRoomId: effectiveRoomId,
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

      await auditService.recordMutation({
        dormitoryId,
        actorUserId: safeActorId,
        action: 'TENANT_REGISTRATION_APPROVED',
        entityType: 'TenantRegistrationRequest',
        entityId: req.id,
        beforeValues: {
          status: req.status,
          requestedRoomId: req.requestedRoomId,
        },
        afterValues: {
          status: 'approved',
          tenantId: tenant.id,
          contractId,
          roomId: effectiveRoomId,
        },
        tx,
      });

      if (contractId) {
        await auditService.recordMutation({
          dormitoryId,
          actorUserId: safeActorId,
          action: 'CONTRACT_CREATED',
          entityType: 'Contract',
          entityId: contractId,
          afterValues: {
            contractId,
            tenantId: tenant.id,
            roomId: effectiveRoomId,
            status: isFutureStartDate ? 'approved_scheduled' : 'active',
            startDate: payload.startDate,
            endDate: payload.endDate,
            rentAmount: payload.rentAmount,
            depositAmount: payload.depositAmount,
          },
          tx,
        });
      }

      return {
        request: updatedReq,
        tenant,
        tenantId: tenant.id,
        contractId,
        occupancyId: occupancy.id,
        roomId: effectiveRoomId,
        occupancy,
        status: 'approved',
      };
    });

    try {
      await outboxService.processPendingOutboxEvents();
    } catch (err: any) {
      logger.error({ event: 'OUTBOX_DISPATCH_AFTER_REGISTRATION_APPROVE_ERROR', error: err.message });
    }

    try {
      const dormConfig = await prisma.dormitoryLineConfig.findUnique({
        where: { dormitoryId },
      });
      if (dormConfig?.notifyTenantApproved !== false) {
        let lineFollowerId = (resTx as any)?.request?.lineFollowerId || (existingReq as any)?.lineFollowerId || (resTx as any)?.tenant?.lineFriendId;
        if (!lineFollowerId && (resTx as any)?.tenant?.id) {
          const tRecord = await prisma.tenant.findUnique({
            where: { id: (resTx as any).tenant.id },
            select: { lineFriendId: true },
          });
          lineFollowerId = tRecord?.lineFriendId || null;
        }

        if (lineFollowerId) {
          const lineFriend = await prisma.dormitoryLineFriend.findUnique({
            where: { id: lineFollowerId },
          });
          if (lineFriend && lineFriend.lineUserIdEncrypted) {
            const { decryptText } = await import('../utils/crypto-encryption.js');
            const lineUserId = decryptText(lineFriend.lineUserIdEncrypted);
            const dorm = await prisma.dormitory.findUnique({ where: { id: dormitoryId }, select: { name: true } });
            const targetRoomId = (resTx as any)?.occupancy?.roomId || (resTx as any)?.contract?.roomId || (resTx as any)?.request?.approvedRoomId;
            const room = targetRoomId
              ? await prisma.room.findUnique({ where: { id: targetRoomId }, select: { roomNumber: true } })
              : null;
            const { LineOaService, buildTenantApprovalOutcomeFlexMessage, getPublicAppOrigin } = await import('./line-oa.service.js');
            const lineOaService = new LineOaService(prisma);
            const flexMsg = buildTenantApprovalOutcomeFlexMessage(
              dorm?.name || 'หอพัก',
              room?.roomNumber || 'ไม่ระบุ',
              true,
              undefined,
              getPublicAppOrigin()
            );
            await lineOaService.pushOutcomeNotification(dormitoryId, lineUserId, flexMsg);

            // R1: Link Active Tenant Rich Menu upon approval
            try {
              const { LineRichMenuService } = await import('./line-richmenu.service.js');
              const richMenuService = new LineRichMenuService(prisma);
              await richMenuService.linkActiveTenantRichMenu(dormitoryId, lineUserId);
            } catch (rmErr: any) {
              logger.warn({ event: 'LINE_ACTIVE_TENANT_RICHMENU_LINK_SKIPPED', error: rmErr.message });
            }
          }
        }
      }
    } catch (pushErr: any) {
      logger.warn({ event: 'LINE_APPROVAL_PUSH_SKIPPED', error: pushErr.message });
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
          email: (req as any).email || snap.email || null,
          lineFriendId: req.lineFollowerId || null,
          status: 'active',
        },
      });

      const tenantUpdateData: Prisma.TenantUpdateInput = {
        address: snap.address ?? null,
        dateOfBirth: snap.birthDate ? new Date(snap.birthDate) : null,
        notes: req.note ?? null,
      };
      if (((req as any).email || snap.email) && !tenant.email) {
        tenantUpdateData.email = (req as any).email || snap.email;
      }
      if (snap.pet || snap.pets) {
        const petsList = Array.isArray(snap.pets) && snap.pets.length > 0
          ? snap.pets
          : (snap.pet?.hasPet && snap.pet?.type ? [snap.pet] : []);
        tenantUpdateData.petInfo = {
          hasPet: petsList.length > 0,
          pets: petsList.map((p: any, idx: number) => ({
            id: p.id || `pet-${Date.now()}-${idx}`,
            type: p.type || '',
            customType: p.customType || '',
            name: p.name || '',
          })),
          type: petsList[0]?.type || snap.pet?.type || '',
          name: petsList[0]?.name || snap.pet?.name || '',
        } as Prisma.InputJsonValue;
      }
      if (snap.citizenId) {
        const cleanId = String(snap.citizenId).replace(/\D/g, '');
        if (cleanId.length === 13) {
          tenantUpdateData.nationalIdMasked = `${cleanId.slice(0, 1)}-${cleanId.slice(1, 5)}-xxxxx-${cleanId.slice(10, 12)}-${cleanId.slice(12)}`;
        }
      }
      // Promote/adopt ID document from pending registration acceptanceSnapshot onto canonical Tenant record
      const snapDoc = snap.idCardDocument || (Array.isArray(snap.attachments) ? snap.attachments.find((a: any) => a.isIdCard || a.name?.includes('บัตรประชาชน') || a.type?.includes('pdf') || a.type?.includes('image')) : null);
      const promotedObjectKey = snapDoc?.objectKey || snap.idCardImageUrl || snap.idCardImage || snap.idCardPhoto || null;
      if (promotedObjectKey && !tenant.idCardObjectKey) {
        tenantUpdateData.idCardObjectKey = promotedObjectKey;
        tenantUpdateData.idCardSha256 = snapDoc?.sha256 || null;
        tenantUpdateData.idCardMimeType = snapDoc?.mimeType || (promotedObjectKey.endsWith('.pdf') ? 'application/pdf' : 'image/webp');
        tenantUpdateData.idCardByteSize = snapDoc?.byteSize ? Number(snapDoc.byteSize) : null;
        tenantUpdateData.idCardUploadedAt = snapDoc?.uploadedAt ? new Date(snapDoc.uploadedAt) : new Date();
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
      const vehiclesList = Array.isArray(snap.vehicles) && snap.vehicles.length > 0
        ? snap.vehicles
        : (snap.vehicle?.licensePlate ? [snap.vehicle] : []);
      for (const veh of vehiclesList) {
        if (veh.licensePlate) {
          await tx.tenantVehicle.create({
            data: {
              dormitoryId,
              tenantId: tenant.id,
              type: veh.type || 'car',
              brand: veh.brand || null,
              model: veh.model || null,
              color: veh.color || null,
              province: veh.province || null,
              licensePlate: veh.licensePlate,
              status: 'active',
            },
          });
        }
      }

      const contractCount = await tx.contract.count({ where: { dormitoryId } });
      const contractNumber = `CTR-${Date.now()}-${(contractCount + 1).toString().padStart(4, '0')}`;

      // Freeze current owner signature
      const latestOwnerSig = await tx.ownerSignature.findFirst({
        where: { dormitoryId, isCurrent: true },
        orderBy: { createdAt: 'desc' },
      });
      const frozenOwnerSignature = latestOwnerSig?.objectKey || null;

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
          ownerSignature: frozenOwnerSignature,
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

      if (Number(approvedTerms.rentAmount) > 0) {
        await createImmediateRentBillForAgreementInTx(tx, {
          dormitoryId,
          roomId,
          tenantId: tenant.id,
          contractId: contract.id,
          agreementType: 'MONTHLY',
          startDate: new Date(approvedTerms.startDate),
          endDate: new Date(approvedTerms.endDate),
          unitRentAmount: approvedTerms.rentAmount,
          totalRentAmount: approvedTerms.rentAmount,
          termInstallmentCount: 1,
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

      await auditService.recordMutation({
        dormitoryId,
        actorUserId: req.reviewedByUserId || null,
        action: 'TENANT_REGISTRATION_CONFIRMED',
        entityType: 'TenantRegistrationRequest',
        entityId: req.id,
        beforeValues: {
          status: req.status,
        },
        afterValues: {
          status: 'approved',
          tenantId: tenant.id,
          contractId: contract.id,
          roomId,
        },
        tx,
      });

      await auditService.recordMutation({
        dormitoryId,
        actorUserId: req.reviewedByUserId || null,
        action: 'CONTRACT_CREATED',
        entityType: 'Contract',
        entityId: contract.id,
        afterValues: {
          contractId: contract.id,
          tenantId: tenant.id,
          roomId,
          status: 'active',
          startDate: approvedTerms.startDate,
          endDate: approvedTerms.endDate,
          rentAmount: approvedTerms.rentAmount,
          depositAmount: approvedTerms.depositAmount,
        },
        tx,
      });

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

  public async requestRevision(
    id: string,
    dormitoryId: string,
    reason?: string,
    actorUserId?: string
  ) {
    return this.rejectRequest(id, dormitoryId, reason, actorUserId);
  }

  public async rejectRequest(
    id: string,
    dormitoryId: string,
    reason?: string,
    actorUserId?: string
  ) {
    const req = await this.getRequestById(id, dormitoryId);
    if (req.status !== 'pending_owner_approval' && req.status !== 'pending') {
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
    const reasonText = reason || 'Owner rejected registration';

    revisionHistory.push({
      action: 'REJECTED',
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

    // Clean up any placeholder tenant linked to this request so it does not linger in pending tab
    if (prisma?.tenant?.deleteMany) {
      if (req.approvedTenantId) {
        await prisma.tenant.deleteMany({
          where: { id: req.approvedTenantId, dormitoryId, status: 'pending' },
        });
      }
      if (req.phone) {
        await prisma.tenant.deleteMany({
          where: { dormitoryId, phone: req.phone, status: 'pending' },
        });
      }
    }

    const safeActorId = actorUserId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actorUserId) ? actorUserId : null;

    const updated = await prisma.tenantRegistrationRequest.update({
      where: { id: req.id },
      data: {
        status: 'rejected',
        rejectedReason: reasonText,
        reviewedAt: new Date(),
        reviewedByUserId: safeActorId,
        acceptanceSnapshot: updatedSnapshot,
      },
    });

    await auditService.recordMutation({
      dormitoryId,
      actorUserId: safeActorId,
      action: 'TENANT_REGISTRATION_REJECTED',
      entityType: 'TenantRegistrationRequest',
      entityId: req.id,
      reason: reasonText,
      beforeValues: {
        status: req.status,
      },
      afterValues: {
        status: 'rejected',
        reason: reasonText,
      },
    });

    try {
      const lineFollowerId = req.lineFollowerId;
      if (lineFollowerId) {
        const lineFriend = await prisma.dormitoryLineFriend.findUnique({
          where: { id: lineFollowerId },
        });
        if (lineFriend && lineFriend.lineUserIdEncrypted) {
          const { decryptText } = await import('../utils/crypto-encryption.js');
          const lineUserId = decryptText(lineFriend.lineUserIdEncrypted);
          const dorm = await prisma.dormitory.findUnique({ where: { id: dormitoryId }, select: { name: true } });
          const room = req.requestedRoomId
            ? await prisma.room.findUnique({ where: { id: req.requestedRoomId }, select: { roomNumber: true } })
            : null;
          const { LineOaService, buildTenantApprovalOutcomeFlexMessage, getPublicAppOrigin } = await import('./line-oa.service.js');
          const lineOaService = new LineOaService(prisma);
          const flexMsg = buildTenantApprovalOutcomeFlexMessage(
            dorm?.name || 'หอพัก',
            room?.roomNumber || 'ไม่ระบุ',
            false,
            reasonText,
            getPublicAppOrigin()
          );
          await lineOaService.pushOutcomeNotification(dormitoryId, lineUserId, flexMsg);
        }
      }
    } catch (pushErr: any) {
      logger.warn({ event: 'LINE_REJECTION_PUSH_SKIPPED', error: pushErr.message });
    }

    return updated;
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
      return this.createRequest(dormitoryId || payload?.dormitoryId, {
        ...payload,
        agreedTerms: payload?.agreedTerms ?? true,
        expectedPolicyVersion: payload?.expectedPolicyVersion ?? 1,
      });
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
      } catch (err) {
        if (err instanceof AppError) throw err;
        throw new AppError('ลายเซ็นไม่ถูกต้องหรือไม่สามารถประมวลผลได้', 400, 'INVALID_SIGNATURE_DATA');
      }
    }

    const identityDocument = await this.storeInlineIdentityDocument(dormitoryId, payload.idCardImageUrl);
    const updatedSnapshot = {
      ...currentSnapshot,
      ...payload,
      ...(identityDocument ? { idCardDocument: identityDocument } : payload.idCardImageUrl === '' ? { idCardDocument: null } : {}),
      applicantName: `${payload.firstName?.trim() || req.firstName} ${payload.lastName !== undefined ? payload.lastName.trim() : req.lastName}`.trim(),
      applicantPhone: payload.phone?.trim() || req.phone,
      revisionHistory,
      currentOwnerComment: null,
      resubmittedAt: new Date().toISOString(),
    };

    const effectiveRoomId = payload.requestedRoomId || req.requestedRoomId;

    const updated = await prisma.tenantRegistrationRequest.update({
      where: { id },
      data: {
        status: 'pending_owner_approval',
        rejectedReason: null,
        requestedRoomId: effectiveRoomId,
        firstName: payload.firstName ? payload.firstName.trim() : req.firstName,
        lastName: payload.lastName !== undefined ? payload.lastName.trim() : req.lastName,
        phone: payload.phone ? payload.phone.trim() : req.phone,
        note: payload.note !== undefined ? payload.note : req.note,
        submittedAt: new Date(),
        acceptanceSnapshot: updatedSnapshot,
        tenantSignatureObjectKey: newSigKey,
        tenantSignatureSha256: newSigSha,
        tenantSignatureMimeType: newSigMime,
        tenantSignatureByteSize: newSigByte,
      },
    }).catch(async err => {
      if (identityDocument) await new LocalStorageProvider().deleteFile(identityDocument.objectKey).catch(() => {});
      if (newSigKey && newSigKey !== req.tenantSignatureObjectKey) await new SignatureStorageService(prisma).deleteSignature(newSigKey).catch(() => {});
      throw err;
    });

    // 1. In-app notification for owner(s) on resubmit
    try {
      const room = await prisma.room.findUnique({
        where: { id: effectiveRoomId },
        select: { roomNumber: true },
      });
      const dorm = await prisma.dormitory.findUnique({
        where: { id: dormitoryId },
        select: { createdByUserId: true, name: true },
      });
      const applicantName = `${updated.firstName} ${updated.lastName || ''}`.trim();

      const ownerMembers = await prisma.dormitoryMember.findMany({
        where: {
          dormitoryId: updated.dormitoryId,
          status: 'active',
          role: { code: { in: ['OWNER', 'MANAGER'] } },
        },
        select: { userId: true },
      });

      const targetUserIds = new Set<string>();
      if (dorm?.createdByUserId) targetUserIds.add(dorm.createdByUserId);
      for (const m of ownerMembers) {
        if (m.userId) targetUserIds.add(m.userId);
      }

      for (const uid of targetUserIds) {
        await prisma.staffNotification.create({
          data: {
            dormitoryId: updated.dormitoryId,
            userId: uid,
            roleCode: 'OWNER',
            category: 'TENANT_REGISTRATION',
            title: `มีคำขอลงทะเบียนผู้เช่าที่แก้ไขใหม่ (ห้อง ${room?.roomNumber || 'ไม่ระบุ'})`,
            message: `คุณ${applicantName} ได้ส่งคำขอลงทะเบียนที่แก้ไขใหม่สำหรับห้อง ${room?.roomNumber || 'ไม่ระบุ'} กรุณาตรวจสอบและดำเนินการ`,
            metadata: {
              registrationId: updated.id,
              roomId: updated.requestedRoomId,
              roomNumber: room?.roomNumber,
              applicantName,
              phone: updated.phone,
              action: 'RESUBMITTED',
            },
          },
        }).catch((err) => {
          logger.warn('Failed to create staff notification for resubmit:', { userId: uid, error: err.message });
        });
      }
    } catch (inAppErr: any) {
      logger.warn('In-app notification for resubmitted tenant registration error:', { error: inAppErr.message });
    }

    // 2. LINE OA Push notification for owner(s) on resubmit
    try {
      const dormConfig = await prisma.dormitoryLineConfig.findUnique({
        where: { dormitoryId: updated.dormitoryId },
      });
      if (dormConfig && dormConfig.notifyTenantRegister !== false) {
        const ownerGrants = await prisma.dormitoryAccessGrant.findMany({
          where: {
            dormitoryId: updated.dormitoryId,
            roleCode: { in: ['OWNER', 'MANAGER'] },
            status: 'ACTIVE',
          },
          include: { lineFriend: true },
        });

        const { LineOaService, buildOwnerNewTenantRegistrationFlexMessage, getPublicAppOrigin } = await import('./line-oa.service.js');
        const lineOaService = new LineOaService(prisma);
        const dorm = await prisma.dormitory.findUnique({
          where: { id: updated.dormitoryId },
          select: { name: true },
        });
        const room = await prisma.room.findUnique({
          where: { id: effectiveRoomId },
          select: { roomNumber: true },
        });

        const applicantName = `${updated.firstName} ${updated.lastName || ''}`.trim();
        const flexMsg = buildOwnerNewTenantRegistrationFlexMessage(
          dorm?.name || 'หอพัก',
          applicantName,
          room?.roomNumber || 'ไม่ระบุ',
          updated.phone,
          getPublicAppOrigin()
        );

        const { decryptText } = await import('../utils/crypto-encryption.js');
        for (const og of ownerGrants) {
          const friend = og.lineFriend;
          if (friend && friend.lineUserIdEncrypted) {
            const ownerLineUserId = decryptText(friend.lineUserIdEncrypted);
            await lineOaService.pushOutcomeNotification(updated.dormitoryId, ownerLineUserId, flexMsg).catch((err) => {
              logger.warn('Failed to push tenant resubmission notification to owner:', { error: err.message });
            });
          }
        }
      }
    } catch (ownerPushErr: any) {
      logger.warn('Owner push notification for resubmitted tenant registration error:', { error: ownerPushErr.message });
    }

    return updated;
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
      include: { building: true },
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

    const scheduledContracts = await prisma.contract.findMany({
      where: {
        dormitoryId,
        status: 'approved_scheduled',
        deletedAt: null,
      },
      select: { roomId: true },
    });
    const scheduledRoomIds = new Set(scheduledContracts.map((c) => c.roomId).filter(Boolean));

    return allRooms.map((r) => {
      const isReservedScheduled = scheduledRoomIds.has(r.id);
      const unlinked = unlinkedByRoomId.get(r.id);
      const isUnboundClaimable = Boolean(unlinked);
      const normStatus = (r.status || '').trim().toLowerCase();
      const hasNoTenantOrContract = !r.currentTenantId && !r.currentContractId;
      const isVacant =
        (normStatus === 'vacant' ||
          normStatus === 'available' ||
          (hasNoTenantOrContract && normStatus !== 'maintenance' && normStatus !== 'reserved')) &&
        !isUnboundClaimable &&
        !isReservedScheduled;

      let selectable = false;
      let selectionType: 'PUBLIC_REGISTER' | 'CLAIM_UNLINKED' | 'LOCKED' = 'LOCKED';
      let badgeLabel = '';

      if (isReservedScheduled) {
        selectable = false;
        selectionType = 'LOCKED';
        badgeLabel = 'ติดจองล่วงหน้า';
      } else if (normStatus === 'maintenance') {
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
      } else if (normStatus === 'occupied') {
        selectable = false;
        selectionType = 'LOCKED';
        badgeLabel = 'มีผู้เช่าแล้ว (ผูก LINE แล้ว)';
      } else if (normStatus === 'reserved') {
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
          maskedName: maskThaiCandidateName(t.displayName || `${t.firstName || ''} ${t.lastName || ''}`.trim()),
          rentalType,
          monthlyRent: prov ? Number(prov.unitRentAmount) : (ct ? Number(ct.rentAmount) : Number(r.monthlyRent)),
          depositAmount: prov ? Number(prov.depositAmount || 0) : (ct ? Number(ct.depositAmount || 0) : Number(r.depositAmount || 0)),
          advancePaymentAmount: ct ? Number(ct.advancePaymentAmount || 0) : 0,
          durationMonths: prov ? prov.durationMonths : (ct ? ct.durationMonths : 12),
        };
      }

      const roomBuilding = (r as any).building;
      const bName = roomBuilding?.name || '';
      const mRent = Number(r.monthlyRent ?? roomBuilding?.monthlyRent ?? 0);
      const tRent = Number(r.termRent ?? roomBuilding?.termRent ?? 0);
      const dRent = Number(r.dailyRent ?? roomBuilding?.dailyRent ?? 0);
      const depAmt = Number(r.depositAmount ?? roomBuilding?.depositAmount ?? 0);
      const mDeposit = Number(r.monthlyDeposit ?? roomBuilding?.monthlyDeposit ?? depAmt);
      const tDeposit = Number(r.termDeposit ?? roomBuilding?.termDeposit ?? depAmt);
      const dDeposit = Number(r.dailyDeposit ?? roomBuilding?.dailyDeposit ?? 0);

      return {
        id: r.id,
        roomNumber: r.roomNumber,
        buildingId: r.buildingId,
        buildingName: bName,
        floor: r.floor,
        monthlyRent: mRent,
        termRent: tRent,
        dailyRent: dRent,
        depositAmount: depAmt,
        monthlyDeposit: mDeposit,
        termDeposit: tDeposit,
        dailyDeposit: dDeposit,
        maxTermRentInstallments: roomBuilding?.maxTermRentInstallments ?? 1,
        building: roomBuilding ? {
          id: roomBuilding.id,
          name: roomBuilding.name,
          maxTermRentInstallments: roomBuilding.maxTermRentInstallments ?? 1,
        } : undefined,
        status: r.status,
        isVacant,
        isReservedScheduled,
        hasScheduledRenewal: isReservedScheduled,
        bookingStatus: isReservedScheduled ? 'RESERVED_SCHEDULED' : null,
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
    if (!trimmedInput || trimmedInput.length < 2) {
      throw new AppError('กรุณากรอกชื่อ-นามสกุล หรือเบอร์โทรศัพท์อย่างน้อย 2 ตัวอักษร', 400, 'CLAIM_INPUT_TOO_SHORT');
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
          ...(room.currentTenantId ? [{ id: room.currentTenantId }] : []),
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

    // 4. Test tolerant match (Phone OR Name OR Both)
    let isMatched = false;
    const inputPhone = normalizeThaiPhone(trimmedInput);
    if (inputPhone && candidateTenant.phone) {
      const storedPhone = normalizeThaiPhone(candidateTenant.phone);
      if (storedPhone && storedPhone === inputPhone) {
        isMatched = true;
      }
    }

    if (!isMatched) {
      const rawStoredName = candidateTenant.displayName || `${candidateTenant.firstName || ''} ${candidateTenant.lastName || ''}`.trim();
      if (rawStoredName) {
        const similarity = calculateNameSimilarity(rawStoredName, trimmedInput);




        if (similarity >= 0.90) {




          isMatched = true;
        }
      }
    }

    if (!isMatched) {
      this.recordFailedClaimAttempt(actorKey);
      throw new AppError('ข้อมูลชื่อ-นามสกุล หรือ เบอร์โทรศัพท์ไม่ตรงกับข้อมูลในระบบ', 404, 'CLAIM_MATCH_FAILED');
    }

    // Match successful! Clear failed attempts
    claimActorAttempts.delete(actorKey);
    const claimVerificationToken = generateClaimVerificationToken({
      dormitoryId,
      roomId: room.id,
      tenantId: candidateTenant.id,
    });

    const activeContract = candidateTenant.contracts[0] || null;
    const activeProvisional = candidateTenant.provisionalRentalTerms?.[0] || null;
    const rentalType = activeProvisional
      ? (activeProvisional.rentalType === 'TERM' ? 'term' : 'monthly')
      : (activeContract
          ? (activeContract.durationMonths <= 1 ? 'daily' : (activeContract.durationMonths <= 4 ? 'term' : 'monthly'))
          : 'monthly');

    return {
      verified: true,
      claimVerificationToken,
      tenantId: candidateTenant.id,
      maskedName: maskThaiCandidateName(candidateTenant.displayName || `${candidateTenant.firstName || ''} ${candidateTenant.lastName || ''}`.trim()),
      displayName: maskThaiCandidateName(candidateTenant.displayName || `${candidateTenant.firstName || ''} ${candidateTenant.lastName || ''}`.trim()),
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
    depositSlipImageUrl?: string;
    depositDeclaredStatus?: string;
    emergencyContact?: { name: string; relationship: string; phone: string };
    coOccupants?: Array<{ name: string; phone?: string; citizenId?: string }>;
    vehicle?: { type: string; licensePlate: string; brand?: string };
    pet?: { hasPet: boolean; type?: string; name?: string; count?: number };
    signatureBase64: string;
    claimVerificationToken?: string;
    actorUserId?: string;
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
      actorUserId,
      claimVerificationToken,
    } = params;

    if (!signatureBase64 || typeof signatureBase64 !== 'string' || !signatureBase64.trim()) {
      throw new AppError('กรุณาลงลายมือชื่อก่อนยืนยันการลงทะเบียน', 400, 'SIGNATURE_REQUIRED');
    }

    // 0. Verify claim verification token proof
    if (!claimVerificationToken || typeof claimVerificationToken !== 'string' || !claimVerificationToken.trim()) {
      throw new AppError('ต้องระบุรหัสยืนยันการรับสิทธิ์ (claimVerificationToken)', 400, 'CLAIM_TOKEN_REQUIRED');
    }
    const verifiedProof = verifyClaimVerificationToken(claimVerificationToken);
    if (
      verifiedProof.tenantId !== tenantId ||
      verifiedProof.roomId !== roomId ||
      verifiedProof.dormitoryId !== dormitoryId
    ) {
      throw new AppError('รหัสยืนยันการรับสิทธิ์ไม่ตรงกับข้อมูลห้องพักหรือผู้เช่า', 403, 'CLAIM_VERIFICATION_MISMATCH');
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
    const claimResult = await prisma.$transaction(async (tx) => {
      const isValidUuid = (val?: string | null): boolean => {
        if (!val || typeof val !== 'string') return false;
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
      };

      let lineFollowerId: string | null = null;
      if (inviteToken) {
        const inviteResult = await tenantRegistrationInviteService.consumeInviteInTransaction(inviteToken, tx);
        lineFollowerId = inviteResult.lineFriendId;
      }
      if (!lineFollowerId && actorUserId && actorUserId.startsWith('ag_user_')) {
        const grantId = actorUserId.replace('ag_user_', '');
        if (isValidUuid(grantId)) {
          const grant = await tx.dormitoryAccessGrant.findUnique({
            where: { id: grantId },
            select: { lineFriendId: true },
          });
          if (grant?.lineFriendId) {
            lineFollowerId = grant.lineFriendId;
          }
        }
      }

      const tenant = await tx.tenant.findFirst({
        where: { id: tenantId, dormitoryId },
        include: {
          occupancies: { where: { roomId, status: 'ACTIVE' } },
          contracts: { where: { roomId, status: 'active', deletedAt: null } },
          provisionalRentalTerms: { where: { roomId, status: { in: ['ACTIVE', 'RESERVED'] }, deletedAt: null } },
        },
      });
      if (!tenant) {
        throw new AppError('ไม่พบข้อมูลผู้เช่า', 404, 'TENANT_NOT_FOUND');
      }

      if (tenant.lineFriendId !== null || tenant.linkedUserId !== null) {
        throw new AppError('ผู้เช่าท่านนี้ได้รับการผูกสิทธิ์บัญชีหรือ LINE เรียบร้อยแล้ว', 409, 'TENANT_ALREADY_CLAIMED');
      }

      const room = await tx.room.findFirst({
        where: { id: roomId, dormitoryId, deletedAt: null },
      });
      if (!room) {
        throw new AppError('ไม่พบข้อมูลห้องพักที่ระบุ', 404, 'ROOM_NOT_FOUND');
      }

      const isRoomAssociated =
        room.currentTenantId === tenant.id ||
        (tenant.occupancies && tenant.occupancies.length > 0) ||
        (tenant.contracts && tenant.contracts.length > 0) ||
        (tenant.provisionalRentalTerms && tenant.provisionalRentalTerms.length > 0);

      if (!isRoomAssociated) {
        throw new AppError('ผู้เช่าไม่ได้อยู่ในห้องพักที่ระบุ', 400, 'ROOM_TENANT_MISMATCH');
      }

      const finalDisplayName = displayName || (firstName ? `${firstName.trim()} ${(lastName || '').trim()}`.trim() : tenant.displayName);
      const updateData: Prisma.TenantUncheckedUpdateInput = {
        lineFriendId: lineFollowerId || tenant.lineFriendId,
        displayName: finalDisplayName,
        firstName: firstName ? firstName.trim() : tenant.firstName,
        lastName: lastName ? lastName.trim() : tenant.lastName,
        phone: phone ? phone.trim() : tenant.phone,
        status: 'active',
        ...(isValidUuid(actorUserId) ? { linkedUserId: actorUserId } : {}),
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

      // If actorUserId provided and is a valid UUID, ensure DormitoryMember exists with TENANT role
      if (actorUserId && isValidUuid(actorUserId)) {
        let tenantRole = await tx.role.findFirst({ where: { code: 'TENANT' } });
        if (!tenantRole) {
          tenantRole = await tx.role.create({
            data: { code: 'TENANT', name: 'ผู้เช่า', permissions: [], isSystem: true },
          });
        }
        const existingMember = await tx.dormitoryMember.findFirst({
          where: { userId: actorUserId, dormitoryId },
        });
        if (!existingMember) {
          await tx.dormitoryMember.create({
            data: {
              userId: actorUserId,
              dormitoryId,
              roleId: tenantRole.id,
              status: 'active',
            },
          });
        }
      }

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
        targetLineFriendId: lineFollowerId || updatedTenant.lineFriendId,
      };
    });

    if ((claimResult as any)?.targetLineFriendId) {
      try {
        const lineFriend = await prisma.dormitoryLineFriend.findUnique({
          where: { id: (claimResult as any).targetLineFriendId },
        });
        if (lineFriend && lineFriend.lineUserIdEncrypted) {
          const { decryptText } = await import('../utils/crypto-encryption.js');
          const lineUserId = decryptText(lineFriend.lineUserIdEncrypted);
          const { LineRichMenuService } = await import('./line-richmenu.service.js');
          const richMenuService = new LineRichMenuService(prisma);
          await richMenuService.linkActiveTenantRichMenu(dormitoryId, lineUserId);
        }
      } catch (rmErr: any) {
        logger.warn({ event: 'LINE_CLAIM_RICHMENU_LINK_SKIPPED', error: rmErr.message });
      }
    }

    return claimResult;
  }

  public async saveRegistrationIdentityDocument(
    dormitoryId: string,
    requestId: string,
    fileBuffer: Buffer,
    actorUserId?: string
  ) {
    const prisma = getPrismaClient();
    const req = await prisma.tenantRegistrationRequest.findFirst({
      where: { id: requestId, dormitoryId },
    });
    if (!req) {
      throw new AppError('ไม่พบคำขอลงทะเบียน', 404, 'REGISTRATION_NOT_FOUND');
    }

    // Process via shared secure pipeline (Sharp raster or pdf-lib binary validation)
    const secured = await processAndSecureTenantDocument(fileBuffer);

    const localStorageProvider = new LocalStorageProvider();
    const objectKey = `registrations/${dormitoryId}/${requestId}/identity-documents/id-card-${Date.now()}${secured.extension}`;

    let saved = false;
    try {
      await localStorageProvider.saveFile(objectKey, secured.buffer);
      saved = true;

      const currentSnapshot = (req.acceptanceSnapshot as any) || {};
      const docMetadata = {
        objectKey,
        sha256: secured.sha256,
        mimeType: secured.mimeType,
        extension: secured.extension,
        byteSize: secured.byteSize,
        pageCount: secured.pageCount,
        uploadedAt: new Date().toISOString(),
        uploadedByUserId: actorUserId || null,
        filename: `id-document${secured.extension}`,
      };

      const updatedSnapshot = {
        ...currentSnapshot,
        idCardDocument: docMetadata,
      };

      await prisma.tenantRegistrationRequest.update({
        where: { id: requestId },
        data: {
          acceptanceSnapshot: updatedSnapshot,
        },
      });

      return {
        requestId,
        hasIdentityDocument: true,
        ...docMetadata,
      };
    } catch (err: any) {
      // Failure compensation: clean up orphan saved file if DB update fails
      if (saved) {
        try {
          await localStorageProvider.deleteFile(objectKey);
        } catch (cleanupErr) {
          logger.warn({ cleanupErr, objectKey }, 'Failed to cleanup orphan registration document on error');
        }
      }
      throw err;
    }
  }

  public async getRegistrationIdentityDocument(dormitoryId: string, requestId: string) {
    const prisma = getPrismaClient();
    const req = await prisma.tenantRegistrationRequest.findFirst({
      where: { id: requestId, dormitoryId },
    });
    if (!req) {
      throw new AppError('ไม่พบคำขอลงทะเบียน', 404, 'REGISTRATION_NOT_FOUND');
    }

    const snap = (req.acceptanceSnapshot as any) || {};
    const snapDoc = snap.idCardDocument || (Array.isArray(snap.attachments) ? snap.attachments.find((a: any) => a.isIdCard || a.name?.includes('บัตรประชาชน') || a.type?.includes('pdf') || a.type?.includes('image')) : null);

    if (!snapDoc || !snapDoc.objectKey) {
      throw new AppError('คำขอนี้ยังไม่ได้แนบเอกสารสำเนาบัตรประชาชน', 404, 'IDENTITY_DOCUMENT_NOT_FOUND');
    }

    const localStorageProvider = new LocalStorageProvider();
    const fileBuffer = await localStorageProvider.getFile(snapDoc.objectKey);
    const isPdf = snapDoc.mimeType === 'application/pdf' || snapDoc.objectKey.endsWith('.pdf');

    return {
      fileBuffer,
      mimeType: isPdf ? 'application/pdf' : (snapDoc.mimeType || 'image/webp'),
      extension: isPdf ? '.pdf' : '.webp',
      filename: snapDoc.filename || `registration-id-document${isPdf ? '.pdf' : '.webp'}`,
    };
  }

  public async reassignRequestRoom(requestId: string, dormitoryId: string, targetRoomId: string, actorUserId?: string) {
    const prisma = getPrismaClient();
    const req = await prisma.tenantRegistrationRequest.findUnique({
      where: { id: requestId },
    });
    if (!req || req.dormitoryId !== dormitoryId) {
      throw new AppError('ไม่พบคำขอลงทะเบียนที่ระบุ', 404, 'REGISTRATION_NOT_FOUND');
    }
    if (req.status !== 'pending_owner_approval') {
      throw new AppError('สามารถเปลี่ยนห้องพักได้เฉพาะคำขอที่รอการอนุมัติเท่านั้น', 400, 'CANNOT_REASSIGN_NON_PENDING_REQUEST');
    }
    const targetRoom = await prisma.room.findUnique({
      where: { id: targetRoomId },
    });
    if (!targetRoom || targetRoom.dormitoryId !== dormitoryId) {
      throw new AppError('ไม่พบห้องพักเป้าหมาย', 404, 'ROOM_NOT_FOUND');
    }

    const currentSnapshot = (req.acceptanceSnapshot as any) || {};
    const updatedSnapshot = {
      ...currentSnapshot,
      roomId: targetRoom.id,
      roomNumber: targetRoom.roomNumber,
      floor: targetRoom.floor,
      monthlyRent: targetRoom.monthlyRent,
    };

    const updated = await prisma.tenantRegistrationRequest.update({
      where: { id: requestId },
      data: {
        requestedRoomId: targetRoom.id,
        acceptanceSnapshot: updatedSnapshot,
      },
    });

    return {
      requestId: updated.id,
      requestedRoomId: updated.requestedRoomId,
      roomNumber: targetRoom.roomNumber,
    };
  }
}

export const tenantRegistrationService = new TenantRegistrationService();
