import { getPrismaClient } from '../db/prisma.js';

export interface ApproveRegistrationDto {
  createContract?: boolean;
  startDate?: string;
  endDate?: string;
  durationMonths?: number;
  rentAmount?: string | number;
  depositAmount?: string | number;
  advancePaymentAmount?: string | number;
  terms?: string;
}

export class TenantRegistrationService {
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

  public async approveRequest(
    id: string,
    dormitoryId: string,
    payload: ApproveRegistrationDto = {},
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
    return prisma.$transaction(async (tx) => {
      // Validate requestedRoomId belongs to same dormitory
      if (req.requestedRoomId) {
        const room = await tx.room.findFirst({ where: { id: req.requestedRoomId, dormitoryId } });
        if (!room) {
          const err = new Error('ROOM_DORM_MISMATCH');
          (err as any).statusCode = 400;
          (err as any).code = 'ROOM_DORM_MISMATCH';
          (err as any).message = 'ห้องพักที่ระบุไม่อยู่ในหอพักนี้';
          throw err;
        }
      }

      // Concurrency-safe tenant number generation
      const tenantCount = await tx.tenant.count({ where: { dormitoryId } });
      const tenantNumber = `TNT-${Date.now()}-${(tenantCount + 1).toString().padStart(4, '0')}`;
      const displayName = `${req.firstName} ${req.lastName}`.trim();

      const tenant = await tx.tenant.create({
        data: {
          dormitoryId,
          tenantNumber,
          firstName: req.firstName,
          lastName: req.lastName,
          displayName,
          phone: req.phone,
          status: 'active',
        },
      });

      let contractId: string | null = null;
      if (payload.createContract) {
        // Require explicit mandatory contract terms (no invented defaults)
        if (
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
          (err as any).message = 'กรุณาระบุข้อกำหนดสัญญาที่จำเป็นให้ครบถ้วน';
          throw err;
        }

        const contractCount = await tx.contract.count({ where: { dormitoryId } });
        const contractNumber = `CTR-${Date.now()}-${(contractCount + 1).toString().padStart(4, '0')}`;

        const contract = await tx.contract.create({
          data: {
            dormitoryId,
            contractNumber,
            roomId: req.requestedRoomId,
            tenantId: tenant.id,
            status: 'draft',
            startDate: new Date(payload.startDate),
            endDate: new Date(payload.endDate),
            durationMonths: payload.durationMonths,
            rentAmount: String(payload.rentAmount),
            depositAmount: String(payload.depositAmount),
            advancePaymentAmount: String(payload.advancePaymentAmount),
            terms: payload.terms || null,
            createdByUserId: actorUserId,
          },
        });
        contractId = contract.id;
      }

      const updatedReq = await tx.tenantRegistrationRequest.update({
        where: { id },
        data: {
          status: 'approved',
          reviewedAt: new Date(),
          reviewedByUserId: actorUserId,
          approvedTenantId: tenant.id,
          approvedRoomId: req.requestedRoomId,
          approvedContractId: contractId,
        },
      });

      return {
        request: updatedReq,
        tenant,
        contractId,
      };
    });
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
