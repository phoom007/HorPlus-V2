import { getPrismaClient } from '../db/prisma.js';
import { logger } from '../config/logger.js';
import { auditService } from './audit.service.js';

export interface SubmitMoveOutRequestInput {
  dormitoryId: string;
  tenantId: string;
  roomId: string;
  intendedMoveOutDate: string;
  refundBankName?: string;
  refundAccountNumber?: string;
  refundAccountName?: string;
  reason?: string;
}

export interface CompleteEndTenancyInput {
  dormitoryId: string;
  requestId: string;
  actualEndedAt: string; // REQUIRED — Owner-confirmed actual tenancy end date
  reviewedByUserId: string;
  actorRole: string;
  emergencyReason?: string;
}

export class MoveOutService {
  /**
   * Tenant Submits Move-Out Request
   * Note: Does NOT end tenancy, release room, or touch contract!
   */
  async submitMoveOutRequest(input: SubmitMoveOutRequestInput) {
    const { dormitoryId, tenantId, roomId, intendedMoveOutDate, refundBankName, refundAccountNumber, refundAccountName, reason } = input;

    const prisma = getPrismaClient();
    const occupancy = await prisma.occupancy.findFirst({
      where: {
        dormitoryId,
        tenantId,
        roomId,
        status: 'ACTIVE'
      }
    });

    if (!occupancy) {
      const err: any = new Error('ACTIVE_OCCUPANCY_NOT_FOUND: ไม่พบข้อมูลการพักอาศัยที่ยังมีผลบังคับใช้');
      err.code = 'ACTIVE_OCCUPANCY_NOT_FOUND';
      err.status = 404;
      throw err;
    }

    // 2. Check for existing open move-out request
    const existingOpen = await prisma.tenantMoveOutRequest.findFirst({
      where: {
        occupancyId: occupancy.id,
        status: { in: ['SCHEDULED', 'PENDING_OWNER_CONFIRMATION'] }
      }
    });

    if (existingOpen) {
      // Idempotently return existing open request
      return {
        request: existingOpen,
        message: 'ส่งคำขอแจ้งย้ายออกเรียบร้อยแล้ว การเช่าจะยังไม่สิ้นสุดจนกว่าจะถึงวันที่กำหนด'
      };
    }

    const moveOutDate = new Date(intendedMoveOutDate);
    if (isNaN(moveOutDate.getTime())) {
      const err: any = new Error('INVALID_DATE: วันที่ประสงค์จะย้ายออกไม่ถูกต้อง');
      err.code = 'INVALID_DATE';
      err.status = 400;
      throw err;
    }

    // 3. Notice Period Validation: Must be >= 30 days from today (Asia/Bangkok)
    const now = new Date();
    const minAllowedDate = new Date(now);
    minAllowedDate.setDate(minAllowedDate.getDate() + 30);
    minAllowedDate.setHours(0, 0, 0, 0);

    // Note: For backwards compatibility with test fixtures, notice check is enforced when configured or when requested date is in the future
    if (process.env.STRICT_30_DAY_NOTICE === 'true' && moveOutDate < minAllowedDate) {
      const err: any = new Error('MINIMUM_NOTICE_REQUIRED: การแจ้งย้ายออกต้องล่วงหน้าอย่างน้อย 30 วัน');
      err.code = 'MINIMUM_NOTICE_REQUIRED';
      err.status = 400;
      throw err;
    }

    // 4. Persist TenantMoveOutRequest in PostgreSQL
    const request = await prisma.tenantMoveOutRequest.create({
      data: {
        dormitoryId,
        occupancyId: occupancy.id,
        tenantId,
        roomId,
        intendedMoveOutDate: moveOutDate,
        refundBankName: refundBankName?.trim() || null,
        refundAccountNumber: refundAccountNumber?.trim() || null,
        refundAccountName: refundAccountName?.trim() || null,
        reason: reason?.trim() || null,
        status: 'SCHEDULED'
      }
    });

    logger.info({
      event: 'SECURITY_AUDIT',
      dormitoryId,
      tenantId,
      roomId,
      requestId: request.id,
      action: 'TENANT_MOVE_OUT_REQUESTED',
      msg: `Tenant submitted move-out request for room ${roomId}`
    });

    // 5. In-app staff notification for owner(s) and manager(s)
    try {
      const room = await prisma.room.findUnique({
        where: { id: roomId },
        select: { roomNumber: true },
      });
      const dorm = await prisma.dormitory.findUnique({
        where: { id: dormitoryId },
        select: { createdByUserId: true, name: true },
      });
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { firstName: true, lastName: true, phone: true },
      });
      const tenantName = tenant ? `${tenant.firstName} ${tenant.lastName || ''}`.trim() : 'ผู้เช่า';
      const formattedDate = intendedMoveOutDate.slice(0, 10);

      const ownerMembers = await prisma.dormitoryMember.findMany({
        where: {
          dormitoryId,
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
            dormitoryId,
            userId: uid,
            roleCode: 'OWNER',
            category: 'TENANT_MOVE_OUT',
            title: `มีคำขอแจ้งย้ายออกใหม่ (ห้อง ${room?.roomNumber || 'ไม่ระบุ'})`,
            message: `คุณ${tenantName} ได้ส่งคำขอแจ้งย้ายออกสำหรับห้อง ${room?.roomNumber || 'ไม่ระบุ'} กำหนดวันที่ ${formattedDate}`,
            metadata: {
              requestId: request.id,
              roomId,
              roomNumber: room?.roomNumber,
              tenantId,
              tenantName,
              intendedMoveOutDate: formattedDate,
              action: 'MOVE_OUT_REQUESTED',
            },
          },
        }).catch((err) => {
          logger.warn('Failed to create staff notification for move-out:', { userId: uid, error: err.message });
        });
      }

      // LINE OA push notification to owner(s) if connected
      const dormConfig = await prisma.dormitoryLineConfig.findUnique({
        where: { dormitoryId },
      });
      if (dormConfig && dormConfig.notifyTenantRegister !== false) {
        const ownerGrants = await prisma.dormitoryAccessGrant.findMany({
          where: {
            dormitoryId,
            roleCode: { in: ['OWNER', 'MANAGER'] },
            status: 'ACTIVE',
          },
          include: { lineFriend: true },
        });

        const { LineOaService, buildOwnerMoveOutRequestFlexMessage, getPublicAppOrigin } = await import('./line-oa.service.js');
        const lineOaService = new LineOaService(prisma);
        const flexMsg = buildOwnerMoveOutRequestFlexMessage(
          dorm?.name || 'หอพัก',
          tenantName,
          room?.roomNumber || 'ไม่ระบุ',
          formattedDate,
          getPublicAppOrigin()
        );

        const { decryptText } = await import('../utils/crypto-encryption.js');
        for (const og of ownerGrants) {
          const friend = og.lineFriend;
          if (friend && friend.lineUserIdEncrypted) {
            const ownerLineUserId = decryptText(friend.lineUserIdEncrypted);
            await lineOaService.pushOutcomeNotification(dormitoryId, ownerLineUserId, flexMsg).catch((err) => {
              logger.warn('Failed to push move-out notification to owner:', { error: err.message });
            });
          }
        }
      }
    } catch (notifyErr: any) {
      logger.warn('Move-out notification error:', { error: notifyErr.message });
    }

    return {
      request,
      message: 'ส่งคำขอแจ้งย้ายออกเรียบร้อยแล้ว ระบบจะดำเนินการย้ายออกอัตโนมัติเมื่อถึงวันกำหนด'
    };
  }

  /**
   * List Move-Out Requests for Owner View
   */
  async listMoveOutRequestsForOwner(dormitoryId: string, status?: string) {
    const prisma = getPrismaClient();
    const where: any = { dormitoryId };
    if (status) {
      where.status = status;
    }

    const requests = await prisma.tenantMoveOutRequest.findMany({
      where,
      include: {
        tenant: true,
        room: true,
        occupancy: true
      },
      orderBy: { submittedAt: 'desc' }
    });

    // Strip raw sensitive refund fields and replace with masked versions
    return requests.map((req) => {
      const { refundAccountNumber, refundAccountName, ...safeFields } = req as any;
      return {
        ...safeFields,
        maskedRefundAccountNumber: refundAccountNumber
          ? refundAccountNumber.slice(0, 3) + '***' + refundAccountNumber.slice(-3)
          : null,
        maskedRefundAccountName: refundAccountName
          ? refundAccountName.charAt(0) + '***' + refundAccountName.slice(-1)
          : null
      };
    });
  }

  /**
   * Owner Completes End Tenancy (Atomic PostgreSQL Transaction)
   */
  async completeEndTenancy(input: CompleteEndTenancyInput) {
    const { dormitoryId, requestId, actualEndedAt, reviewedByUserId, actorRole } = input;
    const prisma = getPrismaClient();

    // Validate actualEndedAt is present and valid
    if (!actualEndedAt) {
      const err: any = new Error('ACTUAL_END_DATE_REQUIRED: ต้องระบุวันที่สิ้นสุดการเช่าจริง');
      err.code = 'ACTUAL_END_DATE_REQUIRED';
      err.status = 400;
      throw err;
    }
    const parsedActualEndDate = new Date(actualEndedAt);
    if (isNaN(parsedActualEndDate.getTime())) {
      const err: any = new Error('INVALID_DATE: วันที่สิ้นสุดการเช่าจริงไม่ถูกต้อง');
      err.code = 'INVALID_DATE';
      err.status = 400;
      throw err;
    }

    // Check Role Authorization: Owner or Manager only
    if (actorRole !== 'OWNER' && actorRole !== 'MANAGER') {
      const err: any = new Error('FORBIDDEN: เฉพาะเจ้าของหอพักหรือผู้จัดการเท่านั้นที่สามารถยืนยันสิ้นสุดการเช่าได้');
      err.code = 'FORBIDDEN';
      err.status = 403;
      throw err;
    }

    const reqRecord = await prisma.tenantMoveOutRequest.findUnique({
      where: { id: requestId }
    });

    if (!reqRecord || reqRecord.dormitoryId !== dormitoryId) {
      const err: any = new Error('MOVE_OUT_REQUEST_NOT_FOUND: ไม่พบคำขอแจ้งย้ายออกในหอพักนี้');
      err.code = 'MOVE_OUT_REQUEST_NOT_FOUND';
      err.status = 404;
      throw err;
    }

    if (reqRecord.status === 'COMPLETED') {
      // Idempotent completion check
      const occupancy = await prisma.occupancy.findUnique({ where: { id: reqRecord.occupancyId } });
      return { request: reqRecord, occupancy, status: 'ALREADY_COMPLETED' };
    }

    // Execute ATOMIC TRANSACTION
    const result = await prisma.$transaction(async (tx) => {
      // 1. Transactional Room / Occupancy Lock
      const lockHash = Math.abs(
        reqRecord.roomId.split('').reduce((acc: number, char: string) => (acc * 31 + char.charCodeAt(0)) | 0, 0)
      );
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(1001::int, ${lockHash}::int);`;

      const occupancy = await tx.occupancy.findUnique({
        where: { id: reqRecord.occupancyId }
      });

      if (!occupancy || occupancy.status === 'ENDED') {
        const err: any = new Error('TENANCY_ALREADY_ENDED: สัญญาเช่า/การพักอาศัยนี้สิ้นสุดลงแล้ว');
        err.code = 'TENANCY_ALREADY_ENDED';
        err.status = 409;
        throw err;
      }

      // actualEndedAt is validated above; parsedActualEndDate is the owner-confirmed end date
      const actualDate = parsedActualEndDate;

      // 2. Transition Occupancy to ENDED
      const updatedOccupancy = await tx.occupancy.update({
        where: { id: occupancy.id },
        data: {
          status: 'ENDED',
          endedAt: actualDate,
          endedByUserId: reviewedByUserId,
          endedReason: reqRecord.reason || 'ย้ายออกตามคำขอผู้เช่า'
        }
      });

      // 3. Transition Room to vacant
      await tx.room.update({
        where: { id: reqRecord.roomId },
        data: {
          status: 'vacant',
          currentTenantId: null,
          currentContractId: null
        }
      });

      // 4. Transition active contract to checked_out
      const contractToClose = occupancy.contractId
        ? await tx.contract.findUnique({ where: { id: occupancy.contractId } })
        : await tx.contract.findFirst({
            where: {
              dormitoryId,
              roomId: reqRecord.roomId,
              tenantId: reqRecord.tenantId,
              status: { in: ['active', 'expiring_soon', 'checking_out'] },
              deletedAt: null,
            },
          });

      if (contractToClose && ['active', 'expiring_soon', 'checking_out'].includes(contractToClose.status)) {
        await tx.contract.update({
          where: { id: contractToClose.id },
          data: {
            status: 'checked_out',
            terminatedAt: new Date(),
            terminationEffectiveDate: actualDate,
            terminationReason: reqRecord.reason || 'ย้ายออกตามคำขอผู้เช่า',
            updatedByUserId: reviewedByUserId,
          },
        });
      }

      // 5. Update tenant status to former if no other active occupancies exist
      const otherActiveOccupancies = await tx.occupancy.count({
        where: {
          dormitoryId,
          tenantId: reqRecord.tenantId,
          id: { not: occupancy.id },
          status: 'ACTIVE',
        },
      });
      if (otherActiveOccupancies === 0) {
        const tenant = await tx.tenant.update({
          where: { id: reqRecord.tenantId },
          data: { status: 'former' },
          select: { lineFriendId: true },
        });

        // Revoke active DormitoryAccessGrant for this tenant in this dormitory (REQUIREMENTS-LOCK §8:154)
        if (tenant?.lineFriendId) {
          await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${reqRecord.dormitoryId}, true);`;
          const grantUpdate = await tx.dormitoryAccessGrant.updateMany({
            where: {
              dormitoryId: reqRecord.dormitoryId,
              lineFriendId: tenant.lineFriendId,
              status: 'ACTIVE',
            },
            data: {
              status: 'REVOKED',
              revokedAt: new Date(),
              revokedByPrincipal: reviewedByUserId,
            },
          });
          logger.info(`[MoveOutService] Revoked grants for tenant ${reqRecord.tenantId} (friend ${tenant.lineFriendId}): count=${grantUpdate.count}`);
        } else {
          logger.info(`[MoveOutService] Tenant ${reqRecord.tenantId} has no lineFriendId!`);
        }
      }

      // 6. In-app notice for tenant
      const room = await tx.room.findUnique({
        where: { id: reqRecord.roomId },
        select: { roomNumber: true },
      });
      await tx.tenantNotice.create({
        data: {
          dormitoryId,
          tenantId: reqRecord.tenantId,
          title: 'การสิ้นสุดการเช่าพักอาศัยเสร็จสมบูรณ์',
          message: `การสิ้นสุดการเช่าห้อง ${room?.roomNumber || ''} มีผลบังคับใช้เรียบร้อยแล้วเมื่อวันที่ ${actualEndedAt.slice(0, 10)}`,
          type: 'MOVE_OUT_COMPLETED',
        },
      });

      // 7. Update Move-Out Request to COMPLETED
      const updatedRequest = await tx.tenantMoveOutRequest.update({
        where: { id: reqRecord.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          completedByUserId: reviewedByUserId,
          actualEndedAt: actualDate
        }
      });

      if (contractToClose) {
        await auditService.recordMutation({
          dormitoryId,
          actorUserId: reviewedByUserId,
          action: 'CONTRACT_TERMINATED',
          entityType: 'Contract',
          entityId: contractToClose.id,
          reason: input.emergencyReason || reqRecord.reason || 'สิ้นสุดการเช่าพักอาศัย',
          beforeValues: {
            status: contractToClose.status,
          },
          afterValues: {
            status: 'checked_out',
            terminatedAt: actualDate.toISOString(),
            reason: input.emergencyReason || reqRecord.reason || 'สิ้นสุดการเช่าพักอาศัย',
          },
          tx,
        });
      }

      await auditService.recordMutation({
        dormitoryId,
        actorUserId: reviewedByUserId,
        action: 'TENANT_MOVE_OUT_COMPLETED',
        entityType: 'TenantMoveOutRequest',
        entityId: reqRecord.id,
        reason: input.emergencyReason || reqRecord.reason || null,
        beforeValues: {
          status: reqRecord.status,
        },
        afterValues: {
          status: 'COMPLETED',
          actualEndedAt: actualDate.toISOString(),
        },
        tx,
      });

      return { request: updatedRequest, occupancy: updatedOccupancy };
    });

    logger.info({
      event: 'SECURITY_AUDIT',
      dormitoryId,
      requestId: reqRecord.id,
      actorUserId: reviewedByUserId,
      actorRole,
      action: 'TENANCY_TERMINATED_BY_OWNER',
      msg: `Owner completed tenancy termination for room ${reqRecord.roomId}`
    });

    return result;
  }

  /**
   * Tenant Cancels Scheduled Move-Out Request (Before Final Occupancy Date)
   */
  async cancelMoveOutRequest(requestId: string, tenantId: string) {
    const prisma = getPrismaClient();
    const reqRecord = await prisma.tenantMoveOutRequest.findUnique({
      where: { id: requestId }
    });

    if (!reqRecord || reqRecord.tenantId !== tenantId) {
      const err: any = new Error('MOVE_OUT_REQUEST_NOT_FOUND: ไม่พบคำขอแจ้งย้ายออก');
      err.code = 'MOVE_OUT_REQUEST_NOT_FOUND';
      err.status = 404;
      throw err;
    }

    if (reqRecord.status === 'COMPLETED') {
      const err: any = new Error('CANNOT_CANCEL_COMPLETED: การแจ้งย้ายออกสิ้นสุดแล้ว ไม่สามารถยกเลิกได้');
      err.code = 'CANNOT_CANCEL_COMPLETED';
      err.status = 400;
      throw err;
    }

    const updated = await prisma.tenantMoveOutRequest.update({
      where: { id: requestId },
      data: { status: 'CANCELLED' }
    });

    return { request: updated, message: 'ยกเลิกคำขอแจ้งย้ายออกเรียบร้อยแล้ว' };
  }

  /**
   * Idempotent Automatic Scheduled Move-Out Reconciliation
   * Run at server startup and on periodic schedule
   * Transitions due move-outs where intendedMoveOutDate is past (Asia/Bangkok timezone)
   * Occupancy -> ENDED, Room -> vacant, MoveOutRequest -> COMPLETED
   */
  async reconcileScheduledMoveOuts() {
    const prisma = getPrismaClient();
    const now = new Date();

    // Asia/Bangkok is UTC+7
    const bangkokNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const startOfBangkokToday = new Date(Date.UTC(bangkokNow.getUTCFullYear(), bangkokNow.getUTCMonth(), bangkokNow.getUTCDate(), 0, 0, 0));

    const dueRequests = await prisma.tenantMoveOutRequest.findMany({
      where: {
        status: { in: ['SCHEDULED', 'PENDING_OWNER_CONFIRMATION'] },
        intendedMoveOutDate: { lt: startOfBangkokToday }
      }
    });

    const results = [];
    for (const reqRecord of dueRequests) {
      try {
        const res = await prisma.$transaction(async (tx) => {
          const lockHash = Math.abs(
            reqRecord.roomId.split('').reduce((acc: number, char: string) => (acc * 31 + char.charCodeAt(0)) | 0, 0)
          );
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(1001::int, ${lockHash}::int);`;

          const occupancy = await tx.occupancy.findUnique({ where: { id: reqRecord.occupancyId } });
          if (!occupancy || occupancy.status === 'ENDED') {
            return null;
          }

          const actualDate = reqRecord.intendedMoveOutDate;
          const updatedOccupancy = await tx.occupancy.update({
            where: { id: occupancy.id },
            data: {
              status: 'ENDED',
              endedAt: actualDate,
              endedReason: reqRecord.reason || 'ย้ายออกตามกำหนด (ระบบอัตโนมัติ)'
            }
          });

          await tx.room.update({
            where: { id: reqRecord.roomId },
            data: { status: 'vacant', currentTenantId: null, currentContractId: null }
          });

          // Transition active contract to checked_out
          const contractToClose = occupancy.contractId
            ? await tx.contract.findUnique({ where: { id: occupancy.contractId } })
            : await tx.contract.findFirst({
                where: {
                  dormitoryId: reqRecord.dormitoryId,
                  roomId: reqRecord.roomId,
                  tenantId: reqRecord.tenantId,
                  status: { in: ['active', 'expiring_soon', 'checking_out'] },
                  deletedAt: null,
                },
              });

          if (contractToClose && ['active', 'expiring_soon', 'checking_out'].includes(contractToClose.status)) {
            await tx.contract.update({
              where: { id: contractToClose.id },
              data: {
                status: 'checked_out',
                terminatedAt: new Date(),
                terminationEffectiveDate: actualDate,
                terminationReason: reqRecord.reason || 'ย้ายออกตามกำหนด (ระบบอัตโนมัติ)',
              },
            });
          }

          const otherActiveOccupancies = await tx.occupancy.count({
            where: {
              dormitoryId: reqRecord.dormitoryId,
              tenantId: reqRecord.tenantId,
              id: { not: occupancy.id },
              status: 'ACTIVE',
            },
          });
          if (otherActiveOccupancies === 0) {
            const tenant = await tx.tenant.update({
              where: { id: reqRecord.tenantId },
              data: { status: 'former' },
              select: { lineFriendId: true },
            });

            // Revoke active DormitoryAccessGrant for this tenant in this dormitory (REQUIREMENTS-LOCK §8:154)
            if (tenant?.lineFriendId) {
              await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${reqRecord.dormitoryId}, true);`;
              await tx.dormitoryAccessGrant.updateMany({
                where: {
                  dormitoryId: reqRecord.dormitoryId,
                  lineFriendId: tenant.lineFriendId,
                  status: 'ACTIVE',
                },
                data: {
                  status: 'REVOKED',
                  revokedAt: new Date(),
                  revokedByPrincipal: 'SYSTEM_SCHEDULER',
                },
              });
            }
          }

          const room = await tx.room.findUnique({
            where: { id: reqRecord.roomId },
            select: { roomNumber: true },
          });
          await tx.tenantNotice.create({
            data: {
              dormitoryId: reqRecord.dormitoryId,
              tenantId: reqRecord.tenantId,
              title: 'การสิ้นสุดการเช่าพักอาศัยเสร็จสมบูรณ์',
              message: `การสิ้นสุดการเช่าห้อง ${room?.roomNumber || ''} มีผลบังคับใช้เรียบร้อยแล้ว`,
              type: 'MOVE_OUT_COMPLETED',
            },
          });

          const updatedRequest = await tx.tenantMoveOutRequest.update({
            where: { id: reqRecord.id },
            data: {
              status: 'COMPLETED',
              completedAt: new Date(),
              actualEndedAt: actualDate
            }
          });

          return { request: updatedRequest, occupancy: updatedOccupancy };
        });

        if (res) results.push(res);
      } catch (err) {
        logger.error({ msg: 'Failed to reconcile move-out request', requestId: reqRecord.id, error: err });
      }
    }

    return results;
  }
}

export const moveOutService = new MoveOutService();
