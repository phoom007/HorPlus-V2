import { getPrismaClient } from '../db/prisma.js';
import { logger } from '../config/logger.js';
import { AppError } from '../types/index.js';
import { Prisma } from '@prisma/client';

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
  confirmReplacement?: boolean;
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
        // Note: Multiple pending requests are allowed, but occupied check is handled during approval with replacement warning
      }

      requestedRoomId = room.id;
    }

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
    return prisma.$transaction(async (tx) => {
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

            // c. Create persistent in-app notice for future renewal tenant
            const formattedStart = new Date(futureContract.startDate).toLocaleDateString('th-TH');
            await tx.tenantNotice.create({
              data: {
                dormitoryId,
                tenantId: futureContract.tenantId,
                title: 'แจ้งยกเลิกสัญญาต่ออายุในอนาคต',
                message: `สัญญาต่ออายุห้อง ${room.roomNumber} ที่มีกำหนดเริ่มวันที่ ${formattedStart} ถูกยกเลิกโดยผู้ดูแลหอพัก เนื่องจากห้องได้รับการอนุมัติให้ผู้เช่ารายใหม่`,
                type: 'FORCED_TERMINATION',
              },
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

            // e. Create persistent in-app notice for old tenant
            await tx.tenantNotice.create({
              data: {
                dormitoryId,
                tenantId: oldTenantId,
                title: 'แจ้งยุติสัญญาเช่า',
                message: `สัญญาเช่าห้อง ${room.roomNumber} ของคุณถูกยุติโดยผู้ดูแลหอพัก กรุณาตรวจสอบรายละเอียดสัญญาและยอดย้ายออกในระบบ`,
                type: 'FORCED_TERMINATION',
              },
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
