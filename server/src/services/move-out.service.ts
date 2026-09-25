import { Prisma } from '@prisma/client';
import { getPrismaClient } from '../db/prisma.js';
import { logger } from '../config/logger.js';
import { auditService } from './audit.service.js';
import { LineOaService } from './line-oa.service.js';
import { LineRichMenuService } from './line-richmenu.service.js';
import { decryptText } from '../utils/crypto-encryption.js';

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
   * Per OQ-6: No minimum notice days required; tenant can cancel and re-submit until Owner confirms.
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

    const moveOutDate = new Date(intendedMoveOutDate);
    if (isNaN(moveOutDate.getTime())) {
      const err: any = new Error('INVALID_DATE: วันที่ประสงค์จะย้ายออกไม่ถูกต้อง');
      err.code = 'INVALID_DATE';
      err.status = 400;
      throw err;
    }

    // 2. Check for existing open move-out request
    const existingOpen = await prisma.tenantMoveOutRequest.findFirst({
      where: {
        occupancyId: occupancy.id,
        status: { in: ['SCHEDULED', 'PENDING_OWNER_CONFIRMATION'] }
      }
    });

    let request;
    if (existingOpen) {
      request = await prisma.tenantMoveOutRequest.update({
        where: { id: existingOpen.id },
        data: {
          intendedMoveOutDate: moveOutDate,
          refundBankName: refundBankName?.trim() ?? existingOpen.refundBankName,
          refundAccountNumber: refundAccountNumber?.trim() ?? existingOpen.refundAccountNumber,
          refundAccountName: refundAccountName?.trim() ?? existingOpen.refundAccountName,
          reason: reason?.trim() ?? existingOpen.reason,
        },
      });
    } else {
      // Persist TenantMoveOutRequest in PostgreSQL (OQ-6: no 30-day minimum notice restriction)
      request = await prisma.tenantMoveOutRequest.create({
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
    }

    // Also mark contract status as checking_out so Owner contract/tenant cards show move-out notice badge
    if (occupancy.contractId) {
      await prisma.contract.updateMany({
        where: { id: occupancy.contractId, dormitoryId, status: { in: ['active', 'expiring_soon'] } },
        data: { status: 'checking_out' },
      });
    } else {
      await prisma.contract.updateMany({
        where: { dormitoryId, tenantId, roomId, status: { in: ['active', 'expiring_soon'] }, deletedAt: null },
        data: { status: 'checking_out' },
      });
    }

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

    // Check Role Authorization: Owner or Manager only (AC C3-3: Staff gets 403 Forbidden)
    if (actorRole !== 'OWNER' && actorRole !== 'MANAGER') {
      const err: any = new Error('FORBIDDEN: เฉพาะเจ้าของหอพักหรือผู้จัดการเท่านั้นที่สามารถยืนยันสิ้นสุดการเช่าได้');
      err.code = 'FORBIDDEN';
      err.status = 403;
      throw err;
    }

    const safeReviewedByUserId =
      reviewedByUserId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reviewedByUserId)
        ? reviewedByUserId
        : null;

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

    let tenantLineUserIdToNotify: string | null = null;
    let finalSettlementSummaryText = '';
    let finalReceiptRecord: any = null;
    let finalSettlementRecord: any = null;

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

      const actualDate = parsedActualEndDate;

      // Capture tenant's current LINE binding before unbinding so we can send Final Receipt & unlink Rich Menu (OQ-8, C3-6)
      const existingTenant = await tx.tenant.findUnique({
        where: { id: reqRecord.tenantId },
        include: { lineFriend: true },
      });
      const originalLineFriendId = existingTenant?.lineFriendId || null;
      const originalLinkedUserId = existingTenant?.linkedUserId || null;
      const rawFriend: any = existingTenant?.lineFriend;
      tenantLineUserIdToNotify =
        rawFriend?.lineUserId ||
        (rawFriend?.lineUserIdEncrypted ? decryptText(rawFriend.lineUserIdEncrypted) : null) ||
        null;

      // 2. Locate contract to close
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

      // 3. OQ-7: Void any unpaid DEPOSIT bills (`paidAmount = 0`) upon move-out
      const unpaidDepositBills = await tx.bill.findMany({
        where: {
          dormitoryId,
          OR: [
            ...(contractToClose ? [{ contractId: contractToClose.id }] : []),
            { tenantId: reqRecord.tenantId, roomId: reqRecord.roomId },
          ],
          billKind: 'DEPOSIT',
          status: { in: ['unpaid', 'overdue', 'DRAFT', 'ISSUED'] },
        },
      });

      const voidedDepositBillIds: string[] = [];
      for (const depBill of unpaidDepositBills) {
        const paidSoFar = new Prisma.Decimal(depBill.paidAmount || 0);
        if (paidSoFar.lte(0)) {
          await tx.bill.update({
            where: { id: depBill.id },
            data: {
              status: 'void',
            },
          });
          voidedDepositBillIds.push(depBill.id);
        }
      }

      // 4. OQ-7 & AC C3-4: Calculate Final Settlement, deduct unpaid non-deposit bills from paid deposit, mark covered bills paid, and issue Final Settlement Receipt
      const paidDepositBills = await tx.bill.findMany({
        where: {
          dormitoryId,
          OR: [
            ...(contractToClose ? [{ contractId: contractToClose.id }] : []),
            { tenantId: reqRecord.tenantId, roomId: reqRecord.roomId },
          ],
          billKind: 'DEPOSIT',
          status: { not: 'void' },
        },
      });

      let paidDepositTotal = new Prisma.Decimal(0);
      for (const dbill of paidDepositBills) {
        const p = dbill.paidAmount && !new Prisma.Decimal(dbill.paidAmount).isZero()
          ? new Prisma.Decimal(dbill.paidAmount)
          : (dbill.status === 'paid' ? new Prisma.Decimal(dbill.totalAmount || 0) : new Prisma.Decimal(0));
        paidDepositTotal = paidDepositTotal.add(p);
      }

      const unpaidNormalBills = await tx.bill.findMany({
        where: {
          dormitoryId,
          OR: [
            ...(contractToClose ? [{ contractId: contractToClose.id }] : []),
            { tenantId: reqRecord.tenantId, roomId: reqRecord.roomId },
          ],
          billKind: { not: 'DEPOSIT' },
          status: { in: ['unpaid', 'overdue', 'partially_paid', 'PARTIALLY_PAID'] },
        },
        orderBy: { dueDate: 'asc' },
      });

      let unpaidBillTotal = new Prisma.Decimal(0);
      const deductedBillIds: string[] = [];
      let remainingDepositPool = new Prisma.Decimal(paidDepositTotal);

      for (const ub of unpaidNormalBills) {
        const total = new Prisma.Decimal(ub.totalAmount || 0);
        const paid = new Prisma.Decimal(ub.paidAmount || 0);
        const outstanding = total.sub(paid);
        if (outstanding.gt(0)) {
          unpaidBillTotal = unpaidBillTotal.add(outstanding);
          // OQ-7: Automatically deduct from paid deposit and close covered bills as paid
          if (remainingDepositPool.gte(outstanding)) {
            remainingDepositPool = remainingDepositPool.sub(outstanding);
            await tx.bill.update({
              where: { id: ub.id },
              data: {
                status: 'paid',
                paidAmount: total,
                paidAt: new Date(),
              },
            });
            deductedBillIds.push(ub.id);
          } else if (remainingDepositPool.gt(0)) {
            const newPaid = paid.add(remainingDepositPool);
            remainingDepositPool = new Prisma.Decimal(0);
            await tx.bill.update({
              where: { id: ub.id },
              data: {
                status: 'paid',
                paidAmount: total,
                paidAt: new Date(),
              },
            });
            deductedBillIds.push(ub.id);
          } else {
            // Even when settled via Final Settlement payment, close bill as settled at move-out
            await tx.bill.update({
              where: { id: ub.id },
              data: {
                status: 'paid',
                paidAmount: total,
                paidAt: new Date(),
              },
            });
            deductedBillIds.push(ub.id);
          }
        }
      }

      if (contractToClose) {
        let settlement = await tx.contractSettlement.findFirst({
          where: { dormitoryId, contractId: contractToClose.id },
          include: { items: { where: { isDeleted: false } } },
        });

        const damageTotal = settlement
          ? settlement.items.reduce((sum, item) => sum.add(new Prisma.Decimal(item.amount || 0)), new Prisma.Decimal(0))
          : new Prisma.Decimal(0);

        const netSettlement = paidDepositTotal.sub(unpaidBillTotal).sub(damageTotal);
        const direction = netSettlement.gt(0) ? 'REFUND' : (netSettlement.lt(0) ? 'PAYMENT_DUE' : 'ZERO');
        const finalStatus = netSettlement.gt(0) ? 'REFUNDED' : (netSettlement.lt(0) ? 'PAYMENT_RECEIVED' : 'CLOSED_ZERO');

        if (!settlement) {
          settlement = await tx.contractSettlement.create({
            data: {
              dormitoryId,
              tenantId: reqRecord.tenantId,
              contractId: contractToClose.id,
              roomId: reqRecord.roomId,
              depositAmount: paidDepositTotal,
              unpaidBillAmount: unpaidBillTotal,
              damageChargeTotal: damageTotal,
              netSettlement,
              settlementDirection: direction,
              settlementStatus: finalStatus,
              confirmedAt: new Date(),
              confirmedByUserId: safeReviewedByUserId,
            },
            include: { items: { where: { isDeleted: false } } },
          });
        } else {
          settlement = await tx.contractSettlement.update({
            where: { id: settlement.id },
            data: {
              depositAmount: paidDepositTotal,
              unpaidBillAmount: unpaidBillTotal,
              damageChargeTotal: damageTotal,
              netSettlement,
              settlementDirection: direction,
              settlementStatus: finalStatus,
              confirmedAt: new Date(),
              confirmedByUserId: safeReviewedByUserId,
            },
            include: { items: { where: { isDeleted: false } } },
          });
        }
        finalSettlementRecord = settlement;

        // Issue Final Settlement Receipt (REQ §8:151 & OQ-8)
        const settlementScopeKey = `SETTLEMENT:${settlement.id}`;
        let existingReceipt = await tx.receipt.findFirst({
          where: { dormitoryId, settlementScopeKey },
        });
        if (!existingReceipt) {
          const receiptNumber = `RC-FINAL-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;
          existingReceipt = await tx.receipt.create({
            data: {
              dormitoryId,
              receiptKind: 'FINAL_SETTLEMENT',
              settlementScopeKey,
              roomId: reqRecord.roomId,
              receiptNumber,
              snapshotData: {
                receiptNumber,
                receiptKind: 'FINAL_SETTLEMENT',
                settlementId: settlement.id,
                contractId: contractToClose.id,
                tenantId: reqRecord.tenantId,
                tenantName: existingTenant ? `${existingTenant.firstName} ${existingTenant.lastName || ''}`.trim() : 'ผู้เช่า',
                roomId: reqRecord.roomId,
                depositAmount: Number(paidDepositTotal),
                unpaidBillAmount: Number(unpaidBillTotal),
                damageChargeTotal: Number(damageTotal),
                netSettlement: Number(netSettlement),
                settlementDirection: direction,
                settlementStatus: finalStatus,
                deductedBillIds,
                voidedDepositBillIds,
                issuedAt: new Date().toISOString(),
              },
              issuedAt: new Date(),
              issuedByUserId: safeReviewedByUserId,
            },
          });
        }
        finalReceiptRecord = existingReceipt;

        const netNum = Number(netSettlement);
        const netLabel = netNum > 0
          ? `ยอดเงินคืนผู้เช่าสุทธิ: ${netNum.toLocaleString('th-TH')} บาท`
          : (netNum < 0 ? `ยอดชำระเพิ่มสุทธิ: ${Math.abs(netNum).toLocaleString('th-TH')} บาท` : 'ยอดสุทธิ: 0 บาท (ครบถ้วน)');
        finalSettlementSummaryText = `เลขที่ใบเสร็จสุดท้าย: ${existingReceipt.receiptNumber} | เงินมัดจำที่ชำระแล้ว: ${Number(paidDepositTotal).toLocaleString('th-TH')} บาท | หักบิลค้างชำระ: ${Number(unpaidBillTotal).toLocaleString('th-TH')} บาท | รายการปรับปรุง/ค่าเสียหาย: ${Number(damageTotal).toLocaleString('th-TH')} บาท | ${netLabel}`;
      }

      // 5. Transition Occupancy to ENDED
      const updatedOccupancy = await tx.occupancy.update({
        where: { id: occupancy.id },
        data: {
          status: 'ENDED',
          endedAt: actualDate,
          endedByUserId: safeReviewedByUserId,
          endedReason: reqRecord.reason || 'ย้ายออกตามคำขอผู้เช่า'
        }
      });

      // 6. Transition Room to vacant
      const room = await tx.room.update({
        where: { id: reqRecord.roomId },
        data: {
          status: 'vacant',
          currentTenantId: null,
          currentContractId: null
        },
        select: { id: true, roomNumber: true }
      });

      // 7. Transition active contract to checked_out
      if (contractToClose && ['active', 'expiring_soon', 'checking_out'].includes(contractToClose.status)) {
        await tx.contract.update({
          where: { id: contractToClose.id },
          data: {
            status: 'checked_out',
            terminatedAt: new Date(),
            terminationEffectiveDate: actualDate,
            terminationReason: reqRecord.reason || 'ย้ายออกตามคำขอผู้เช่า',
            updatedByUserId: safeReviewedByUserId,
          },
        });
      }

      // 8. Update tenant status to former, unbind LINE & linkedUserId, revoke grants & sessions (AC C3-5, C3-7, C3-9)
      const otherActiveOccupancies = await tx.occupancy.count({
        where: {
          dormitoryId,
          tenantId: reqRecord.tenantId,
          id: { not: occupancy.id },
          status: 'ACTIVE',
        },
      });
      if (otherActiveOccupancies === 0) {
        await tx.tenant.update({
          where: { id: reqRecord.tenantId },
          data: {
            status: 'former',
            linkedUserId: null,
            lineFriendId: null,
          },
        });

        // Archive approved registration requests for this completed tenancy so future re-registration in the same room works cleanly (GA-NOTE-1 / AC C3-9)
        await tx.tenantRegistrationRequest.updateMany({
          where: {
            dormitoryId,
            OR: [
              { approvedTenantId: reqRecord.tenantId },
              ...(originalLineFriendId ? [{ lineFollowerId: originalLineFriendId, status: 'approved' }] : []),
            ],
          },
          data: {
            status: 'moved_out',
          },
        });

        // Revoke active TENANT DormitoryAccessGrant and active Sessions for this tenant (REQUIREMENTS-LOCK §8:154, ADR-003, AC C3-5, C3-7)
        const grantIdsToRevoke: string[] = [];
        if (originalLineFriendId) {
          await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${reqRecord.dormitoryId}, true);`;
          const matchingGrants = await tx.dormitoryAccessGrant.findMany({
            where: {
              dormitoryId: reqRecord.dormitoryId,
              lineFriendId: originalLineFriendId,
              roleCode: 'TENANT',
              status: 'ACTIVE',
            },
            select: { id: true },
          });
          for (const g of matchingGrants) {
            grantIdsToRevoke.push(g.id);
          }

          if (grantIdsToRevoke.length > 0) {
            await tx.dormitoryAccessGrant.updateMany({
              where: { id: { in: grantIdsToRevoke } },
              data: {
                status: 'REVOKED',
                revokedAt: new Date(),
                revokedByPrincipal: reviewedByUserId,
              },
            });
          }
          logger.info(`[MoveOutService] Revoked TENANT grants for tenant ${reqRecord.tenantId} (friend ${originalLineFriendId}): count=${grantIdsToRevoke.length}`);
        }

        // Revoke open sessions belonging to this tenant so open tabs/sessions immediately become invalid (AC C3-5)
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const sessionOrConditions: any[] = [];
        if (grantIdsToRevoke.length > 0) {
          sessionOrConditions.push({ accessGrantId: { in: grantIdsToRevoke.filter((id) => uuidRegex.test(id)) } });
        }
        if (originalLinkedUserId && uuidRegex.test(originalLinkedUserId)) {
          sessionOrConditions.push({ userId: originalLinkedUserId });
        }

        if (sessionOrConditions.length > 0) {
          await tx.session.updateMany({
            where: {
              status: 'active',
              OR: sessionOrConditions,
            },
            data: {
              status: 'revoked',
              revokedAt: new Date(),
              revokedReason: 'TENANT_MOVED_OUT',
            },
          });
        }
      }

      // 9. In-app notice for tenant record
      await tx.tenantNotice.create({
        data: {
          dormitoryId,
          tenantId: reqRecord.tenantId,
          title: 'การสิ้นสุดการเช่าพักอาศัยและใบเสร็จสุดท้าย',
          message: `การสิ้นสุดการเช่าห้อง ${room?.roomNumber || ''} มีผลเมื่อวันที่ ${actualEndedAt.slice(0, 10)} ${finalSettlementSummaryText}`.trim(),
          type: 'MOVE_OUT_COMPLETED',
        },
      });

      // 10. Update Move-Out Request to COMPLETED
      const updatedRequest = await tx.tenantMoveOutRequest.update({
        where: { id: reqRecord.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          completedByUserId: safeReviewedByUserId,
          actualEndedAt: actualDate
        }
      });

      if (contractToClose) {
        await auditService.recordMutation({
          dormitoryId,
          actorUserId: safeReviewedByUserId || reviewedByUserId,
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
        actorUserId: safeReviewedByUserId || reviewedByUserId,
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

      return {
        request: updatedRequest,
        occupancy: updatedOccupancy,
        settlement: finalSettlementRecord,
        finalReceipt: finalReceiptRecord,
        voidedDepositBillIds,
        deductedBillIds,
      };
    });

    // Post-transaction LINE Notification (OQ-8) & Rich Menu Unlink (AC C3-6)
    if (tenantLineUserIdToNotify) {
      try {
        const oaSvc: any = new (LineOaService as any)(prisma);
        if (typeof oaSvc?.pushOutcomeNotification === 'function') {
          await oaSvc.pushOutcomeNotification({
            dormitoryId,
            recipientLineUserId: tenantLineUserIdToNotify,
            eventKey: 'move_out_completed_final_receipt',
            title: 'ยืนยันการย้ายออกและสรุปใบเสร็จสุดท้าย',
            message: finalSettlementSummaryText || `การย้ายออกของท่านได้รับการยืนยันเรียบร้อยแล้ว`,
          });
        }
      } catch (lineErr) {
        logger.warn({ err: lineErr, dormitoryId, requestId: reqRecord.id }, 'Failed to push final settlement receipt notification to LINE');
      }

      try {
        const richMenuService = new LineRichMenuService(prisma);
        await richMenuService.unlinkActiveTenantRichMenu(dormitoryId, tenantLineUserIdToNotify);
      } catch (rmErr) {
        logger.warn({ err: rmErr, dormitoryId, requestId: reqRecord.id }, 'Failed to unlink Active Tenant Rich Menu upon move-out');
      }
    }

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
   * Tenant Cancels Scheduled Move-Out Request (Before Owner Confirmation — OQ-6, AC C3-1, AC C3-2)
   */
  async cancelMoveOutRequest(requestId: string, tenantId: string) {
    const prisma = getPrismaClient();
    const reqRecord = await prisma.tenantMoveOutRequest.findUnique({
      where: { id: requestId }
    });

    if (!reqRecord) {
      const err: any = new Error('MOVE_OUT_REQUEST_NOT_FOUND: ไม่พบคำขอแจ้งย้ายออก');
      err.code = 'MOVE_OUT_REQUEST_NOT_FOUND';
      err.status = 404;
      throw err;
    }

    if (reqRecord.tenantId !== tenantId) {
      const err: any = new Error('FORBIDDEN: คุณไม่มีสิทธิ์ยกเลิกคำขอแจ้งย้ายออกของผู้เช่ารายอื่น');
      err.code = 'FORBIDDEN';
      err.status = 403;
      throw err;
    }

    if (reqRecord.status === 'COMPLETED') {
      const err: any = new Error('CANNOT_CANCEL_COMPLETED: เจ้าของหอพักยืนยันการย้ายออกแล้ว ไม่สามารถยกเลิกได้');
      err.code = 'CANNOT_CANCEL_COMPLETED';
      err.status = 400;
      throw err;
    }

    const updated = await prisma.tenantMoveOutRequest.update({
      where: { id: requestId },
      data: { status: 'CANCELLED' }
    });

    // Revert checking_out contract status back to active so tenant can submit a fresh request cleanly
    await prisma.contract.updateMany({
      where: {
        dormitoryId: reqRecord.dormitoryId,
        tenantId: reqRecord.tenantId,
        roomId: reqRecord.roomId,
        status: 'checking_out',
        deletedAt: null,
      },
      data: { status: 'active' },
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
