import { getPrismaClient } from '../db/prisma.js';

export interface CreateRegistrationDto {
  dormitoryId: string;
  requestedRoomId: string;
  firstName: string;
  lastName: string;
  phone: string;
  note?: string;
}

export interface ApproveRegistrationDto {
  startDate: string;
  endDate: string;
  durationMonths: number;
  rentAmount: string | number;
  depositAmount: string | number;
  advancePaymentAmount: string | number;
  terms?: string | null;
}

export class TenantRegistrationService {
  public async createRequest(dormitoryId: string, payload: CreateRegistrationDto) {
    const prisma = getPrismaClient();

    let requestedRoomId: string = payload.requestedRoomId;
    if (payload.requestedRoomId) {
      const room = await prisma.room.findFirst({
        where: {
          dormitoryId,
          deletedAt: null,
          OR: [
            { id: payload.requestedRoomId },
            { roomNumber: payload.requestedRoomId },
            { normalizedRoomNumber: payload.requestedRoomId.toUpperCase() },
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

      if (room.status === 'occupied') {
        const err = new Error('ROOM_ALREADY_OCCUPIED');
        (err as any).statusCode = 409;
        (err as any).code = 'ROOM_ALREADY_OCCUPIED';
        (err as any).message = 'ห้องพักนี้มีผู้เช่าอยู่แล้ว';
        throw err;
      }

      requestedRoomId = room.id;
    }

    // 3. Create TenantRegistrationRequest
    return prisma.tenantRegistrationRequest.create({
      data: {
        dormitoryId,
        requestedRoomId,
        firstName: payload.firstName.trim(),
        lastName: payload.lastName.trim(),
        phone: payload.phone.trim(),
        note: payload.note ? payload.note.trim() : null,
        status: 'pending_owner_approval',
        submittedAt: new Date(),
      },
    });
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

    if (room.status === 'occupied') {
      const err = new Error('ROOM_ALREADY_OCCUPIED');
      (err as any).statusCode = 409;
      (err as any).code = 'ROOM_ALREADY_OCCUPIED';
      (err as any).message = 'ห้องพักนี้มีผู้เช่าอยู่แล้ว';
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
    // INVARIANT: Approval must always produce complete tenancy state.
    // Validate required contract fields BEFORE any mutations.
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
    return prisma.$transaction(async (tx) => {
      // 1. Re-verify request status inside transaction to guarantee idempotency and guard race conditions
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
        if (room.status === 'occupied') {
          const err = new Error('ROOM_ALREADY_OCCUPIED');
          (err as any).statusCode = 409;
          (err as any).code = 'ROOM_ALREADY_OCCUPIED';
          (err as any).message = 'ห้องพักนี้มีผู้เช่าอยู่แล้วไม่สามารถอนุมัติได้';
          throw err;
        }

        const activeOccupancy = await tx.occupancy.findFirst({
          where: { dormitoryId, roomId: req.requestedRoomId, status: 'ACTIVE' },
        });
        if (activeOccupancy) {
          const err = new Error('ROOM_ALREADY_OCCUPIED');
          (err as any).statusCode = 409;
          (err as any).code = 'ROOM_ALREADY_OCCUPIED';
          (err as any).message = 'ห้องพักนี้มีผู้เช่าอยู่แล้วไม่สามารถอนุมัติได้';
          throw err;
        }
      }

      // INVARIANT: Registration must have a room assigned before approval
      if (!req.requestedRoomId) {
        const err = new Error('MISSING_ROOM_ASSIGNMENT');
        (err as any).statusCode = 400;
        (err as any).code = 'MISSING_ROOM_ASSIGNMENT';
        (err as any).message = 'คำขอลงทะเบียนนี้ยังไม่ได้ระบุห้องพัก กรุณาระบุห้องพักก่อนอนุมัติ';
        throw err;
      }

      // 3. Create Tenant
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

      // 4. Create Contract (ALWAYS — approval invariant)
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
          createdByUserId: actorUserId,
          activatedAt: new Date(),
        },
      });
      const contractId = contract.id;

      // 5. Establish Authoritative Occupancy & Transition Room to Occupied (ALWAYS — approval invariant)
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
        occupancy,
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
