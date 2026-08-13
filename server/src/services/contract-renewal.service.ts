import { getPrismaClient } from '../db/prisma.js';
import { logger } from '../config/logger.js';
import { AppError } from '../types/index.js';

export interface SubmitRenewalRequestInput {
  dormitoryId: string;
  tenantId: string;
  contractId: string;
  requestedStartDate: string;
  requestedDurationMonths: number;
  actorUserId?: string;
}

export interface ApproveRenewalInput {
  dormitoryId: string;
  requestId: string;
  rentAmount?: string | number;
  depositAmount?: string | number;
  advancePaymentAmount?: string | number;
  terms?: string;
  actorUserId: string;
  actorRole: string;
}

export class ContractRenewalService {
  /**
   * Authoritative calculation of renewal eligibility.
   * Rules:
   * 1. Contract & Tenant must belong to the dormitory.
   * 2. Cannot renew if room has any valid `pending_owner_approval` registration request (Rule 6).
   * 3. Cannot renew if room is assigned/occupied by another tenant (Rule 5).
   * 4. Cannot renew if a pending renewal request or future contract already exists (Rule 4).
   * 5. Supported for active contract OR former tenant after contract expiry (Gap Renewal, Rule 2).
   */
  public async getRenewalEligibility(dormitoryId: string, tenantId: string, contractId: string) {
    const prisma = getPrismaClient();

    const contract = await prisma.contract.findFirst({
      where: { id: contractId, dormitoryId, tenantId, deletedAt: null },
      include: { room: true, tenant: true },
    });

    if (!contract) {
      return {
        eligible: false,
        reasonCode: 'CONTRACT_NOT_FOUND',
        message: 'ไม่พบข้อมูลสัญญาเช่าที่ระบุ',
      };
    }

    const roomId = contract.roomId;

    // Rule 6: Check for any pending registration applications for this room
    const pendingRegistration = await prisma.tenantRegistrationRequest.findFirst({
      where: {
        dormitoryId,
        requestedRoomId: roomId,
        status: 'pending_owner_approval',
      },
    });

    if (pendingRegistration) {
      return {
        eligible: false,
        reasonCode: 'PENDING_REGISTRATION_LOCK',
        message: 'มีคำขอเช่าห้องนี้รอการอนุมัติ จึงยังไม่สามารถต่อสัญญาได้',
      };
    }

    // Rule 5: Check if room is currently occupied by a DIFFERENT active tenant
    const currentOccupancy = await prisma.occupancy.findFirst({
      where: {
        dormitoryId,
        roomId,
        status: 'ACTIVE',
      },
    });

    if (currentOccupancy && currentOccupancy.tenantId !== tenantId) {
      return {
        eligible: false,
        reasonCode: 'ROOM_OCCUPIED_BY_ANOTHER_TENANT',
        message: 'ห้องพักนี้ถูกครอบครองโดยผู้เช่ารายอื่นแล้ว สิทธิ์การต่อสัญญาสิ้นสุดลง',
      };
    }

    // Rule 4: Check if a future contract or pending renewal request already exists for this room/tenancy
    const pendingRenewalRequest = await prisma.tenantRenewalRequest.findFirst({
      where: {
        dormitoryId,
        contractId,
        status: 'PENDING_OWNER_APPROVAL',
      },
    });

    if (pendingRenewalRequest) {
      return {
        eligible: false,
        reasonCode: 'RENEWAL_REQUEST_ALREADY_PENDING',
        message: 'มีคำขอต่อสัญญาห้องนี้รอการอนุมัติอยู่แล้ว',
        pendingRequest: pendingRenewalRequest,
      };
    }

    const existingFutureContract = await prisma.contract.findFirst({
      where: {
        dormitoryId,
        roomId,
        previousContractId: contractId,
        status: { in: ['draft', 'active', 'pending_signature', 'waiting_extension'] },
      },
    });

    if (existingFutureContract) {
      return {
        eligible: false,
        reasonCode: 'FUTURE_CONTRACT_EXISTS',
        message: 'มีการสร้างสัญญาในรอบถัดไปสำหรับห้องพักนี้แล้ว',
        futureContract: existingFutureContract,
      };
    }

    return {
      eligible: true,
      reasonCode: 'ELIGIBLE',
      message: 'สามารถส่งคำขอต่อสัญญาได้',
      contract,
    };
  }

  /**
   * Tenant Submits Renewal Request (Tenant controls duration, NOT financial terms)
   */
  public async submitRenewalRequest(input: SubmitRenewalRequestInput) {
    const { dormitoryId, tenantId, contractId, requestedStartDate, requestedDurationMonths } = input;

    // Security check: Reject client-supplied financial fields (Rule 20)
    if ((input as any).rentAmount !== undefined || (input as any).depositAmount !== undefined) {
      throw new AppError('ผู้เช่าไม่สามารถระบุหรือปรับเปลี่ยนจำนวนเงินในคำขอต่อสัญญาได้', 400, 'FINANCIAL_TERMS_MUTATION_DENIED');
    }

    const prisma = getPrismaClient();

    const eligibility = await this.getRenewalEligibility(dormitoryId, tenantId, contractId);
    if (!eligibility.eligible) {
      throw new AppError(eligibility.message || 'ไม่สามารถส่งคำขอต่อสัญญาได้', 400, eligibility.reasonCode || 'RENEWAL_INELIGIBLE');
    }

    const startDate = new Date(requestedStartDate);
    if (isNaN(startDate.getTime())) {
      throw new AppError('วันเริ่มต้นสัญญาที่ขอไม่ถูกต้อง', 400, 'INVALID_DATE');
    }

    const durationMonths = Math.max(1, Math.floor(requestedDurationMonths || 1));
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + durationMonths);

    // Derives financial terms directly from previous contract — ignores any monetary inputs from client
    const prevContract = eligibility.contract!;

    const request = await prisma.tenantRenewalRequest.create({
      data: {
        dormitoryId,
        tenantId,
        contractId,
        roomId: prevContract.roomId,
        requestedDurationMonths: durationMonths,
        requestedStartDate: startDate,
        requestedEndDate: endDate,
        status: 'PENDING_OWNER_APPROVAL',
      },
    });

    logger.info({
      event: 'SECURITY_AUDIT',
      dormitoryId,
      tenantId,
      contractId,
      requestId: request.id,
      action: 'RENEWAL_REQUEST_SUBMITTED',
      msg: `Tenant submitted renewal request for contract ${contractId}`,
    });

    return request;
  }

  /**
   * Owner/Manager Approves Renewal Request (Creates new linked contract)
   */
  public async approveRenewalRequest(input: ApproveRenewalInput) {
    const { dormitoryId, requestId, rentAmount, depositAmount, advancePaymentAmount, terms, actorUserId, actorRole } = input;

    if (actorRole !== 'OWNER' && actorRole !== 'MANAGER') {
      throw new AppError('เฉพาะเจ้าของหอพักหรือผู้จัดการเท่านั้นที่สามารถอนุมัติคำขอต่อสัญญาได้', 403, 'FORBIDDEN');
    }

    const prisma = getPrismaClient();

    const result = await prisma.$transaction(async (tx) => {
      const reqRecord = await tx.tenantRenewalRequest.findUnique({
        where: { id: requestId },
        include: { contract: true, room: true },
      });

      if (!reqRecord || reqRecord.dormitoryId !== dormitoryId) {
        throw new AppError('ไม่พบคำขอต่อสัญญาที่ระบุ', 404, 'RENEWAL_REQUEST_NOT_FOUND');
      }

      if (reqRecord.status === 'APPROVED' && reqRecord.createdContractId) {
        const existing = await tx.contract.findUnique({ where: { id: reqRecord.createdContractId } });
        return { request: reqRecord, contract: existing, status: 'ALREADY_APPROVED' };
      }

      if (reqRecord.status !== 'PENDING_OWNER_APPROVAL') {
        throw new AppError('คำขอต่อสัญญานี้ไม่ได้อยู่ในสถานะรออนุมัติ', 400, 'INVALID_RENEWAL_STATUS');
      }

      // Lock room to prevent race conditions
      const lockHash = Math.abs(
        reqRecord.roomId.split('').reduce((acc: number, char: string) => (acc * 31 + char.charCodeAt(0)) | 0, 0)
      );
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(1002::int, ${lockHash}::int);`;

      // Verify no pending registration request locks the room
      const pendingReg = await tx.tenantRegistrationRequest.findFirst({
        where: {
          dormitoryId,
          requestedRoomId: reqRecord.roomId,
          status: 'pending_owner_approval',
        },
      });

      if (pendingReg) {
        throw new AppError('มีคำขอเช่าห้องนี้รอการอนุมัติอยู่ ไม่อนุญาตให้อนุมัติการต่อสัญญา', 409, 'PENDING_REGISTRATION_LOCK');
      }

      const prevContract = reqRecord.contract;

      // Final financial values: Owner override or derived from prior contract
      const finalRent = rentAmount !== undefined ? String(rentAmount) : String(prevContract.rentAmount);
      const finalDeposit = depositAmount !== undefined ? String(depositAmount) : String(prevContract.depositAmount);
      const finalAdvance = advancePaymentAmount !== undefined ? String(advancePaymentAmount) : String(prevContract.advancePaymentAmount);
      const finalTerms = terms !== undefined ? terms : prevContract.terms;

      const contractNumber = `CTR-RNW-${Date.now().toString().slice(-6)}`;

      const safeActorId = actorUserId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actorUserId) ? actorUserId : null;

      // Create NEW linked Contract (Old contract remains IMMUTABLE!)
      const newContract = await tx.contract.create({
        data: {
          dormitoryId,
          contractNumber,
          roomId: reqRecord.roomId,
          tenantId: reqRecord.tenantId,
          status: 'active',
          startDate: reqRecord.requestedStartDate,
          endDate: reqRecord.requestedEndDate,
          durationMonths: reqRecord.requestedDurationMonths,
          rentBillingType: prevContract.rentBillingType || 'monthly',
          rentAmount: finalRent,
          depositAmount: finalDeposit,
          advancePaymentAmount: finalAdvance,
          terms: finalTerms,
          previousContractId: prevContract.id,
          createdByUserId: safeActorId,
          activatedAt: new Date(),
        },
      });

      // Update TenantRenewalRequest
      const updatedRequest = await tx.tenantRenewalRequest.update({
        where: { id: reqRecord.id },
        data: {
          status: 'APPROVED',
          reviewedAt: new Date(),
          reviewedByUserId: safeActorId,
          createdContractId: newContract.id,
        },
      });

      // Update Room currentContractId & currentTenantId
      await tx.room.update({
        where: { id: reqRecord.roomId },
        data: {
          status: 'occupied',
          currentTenantId: reqRecord.tenantId,
          currentContractId: newContract.id,
        },
      });

      return { request: updatedRequest, contract: newContract };
    });

    logger.info({
      event: 'SECURITY_AUDIT',
      dormitoryId,
      requestId,
      actorUserId,
      actorRole,
      createdContractId: result.contract?.id,
      action: 'RENEWAL_REQUEST_APPROVED',
      msg: `Owner approved renewal request ${requestId}`,
    });

    return result;
  }

  /**
   * Owner/Manager Rejects Renewal Request
   */
  public async rejectRenewalRequest(dormitoryId: string, requestId: string, reason: string | undefined, actorUserId: string, actorRole: string) {
    if (actorRole !== 'OWNER' && actorRole !== 'MANAGER') {
      throw new AppError('เฉพาะเจ้าของหอพักหรือผู้จัดการเท่านั้นที่สามารถปฏิเสธคำขอต่อสัญญาได้', 403, 'FORBIDDEN');
    }

    const prisma = getPrismaClient();
    const reqRecord = await prisma.tenantRenewalRequest.findUnique({ where: { id: requestId } });

    if (!reqRecord || reqRecord.dormitoryId !== dormitoryId) {
      throw new AppError('ไม่พบคำขอต่อสัญญาที่ระบุ', 404, 'RENEWAL_REQUEST_NOT_FOUND');
    }

    const safeActorId = actorUserId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actorUserId) ? actorUserId : null;

    const updated = await prisma.tenantRenewalRequest.update({
      where: { id: requestId },
      data: {
        status: 'REJECTED',
        rejectionReason: reason?.trim() || null,
        reviewedAt: new Date(),
        reviewedByUserId: safeActorId,
      },
    });

    return updated;
  }

  /**
   * List Renewal Requests for Dormitory
   */
  public async listRenewalRequests(dormitoryId: string, status?: string) {
    const prisma = getPrismaClient();
    const where: any = { dormitoryId };
    if (status) {
      where.status = status;
    }

    return prisma.tenantRenewalRequest.findMany({
      where,
      include: {
        tenant: true,
        contract: true,
        room: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}

export const contractRenewalService = new ContractRenewalService();
