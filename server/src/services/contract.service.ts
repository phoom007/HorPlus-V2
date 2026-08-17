import { IContractRepository, ContractEntity, ContractFilterQuery, CreateContractData } from '../db/repositories/contract.repository.js';
import { IRoomRepository } from '../db/repositories/room.repository.js';
import { ITenantRepository } from '../db/repositories/tenant.repository.js';
import { AuditService } from './audit.service.js';
import { DocumentPdfService } from './document-pdf.service.js';
import { getPrismaClient } from '../db/prisma.js';

export class ContractService {
  constructor(
    private contractRepo: IContractRepository,
    private roomRepo: IRoomRepository,
    private tenantRepo: ITenantRepository,
    private auditService?: AuditService
  ) {}

  public async getContracts(dormitoryId: string, filter?: ContractFilterQuery) {
    return this.contractRepo.findAll(dormitoryId, filter);
  }

  public async getContractById(id: string, dormitoryId: string) {
    const c = await this.contractRepo.findById(id, dormitoryId);
    if (!c) {
      const err = new Error('ไม่พบข้อมูลสัญญาที่ระบุ');
      (err as any).code = 'CONTRACT_NOT_FOUND';
      (err as any).statusCode = 404;
      throw err;
    }
    return c;
  }

  public async createContract(dormitoryId: string, data: CreateContractData, actorUserId?: string) {
    const startDate = new Date(data.startDate);
    const endDate = new Date(data.endDate);

    if (startDate >= endDate) {
      const err = new Error('วันเริ่มต้นสัญญาต้องมาก่อนวันสิ้นสุดสัญญา');
      (err as any).code = 'INVALID_CONTRACT_DATES';
      (err as any).statusCode = 400;
      throw err;
    }

    // 1. Verify Room exists in same dormitory
    const room = await this.roomRepo.findById(data.roomId, dormitoryId);
    if (!room) {
      const err = new Error('ไม่อนุญาตให้สร้างสัญญากับห้องพักต่างหอพักหรือห้องที่ไม่พบ');
      (err as any).code = 'CROSS_DORMITORY_RELATION_DENIED';
      (err as any).statusCode = 403;
      throw err;
    }

    // 2. Verify Tenant exists in same dormitory
    const tenant = await this.tenantRepo.findById(data.tenantId, dormitoryId);
    if (!tenant) {
      const err = new Error('ไม่อนุญาตให้สร้างสัญญากับผู้เช่าต่างหอพักหรือผู้เช่าที่ไม่พบ');
      (err as any).code = 'CROSS_DORMITORY_RELATION_DENIED';
      (err as any).statusCode = 403;
      throw err;
    }

    // Idempotency: exact duplicate check using Prisma transaction and row-level lock
    const prisma = getPrismaClient();
    
    // Check if this is an in-memory mock or real DB to apply transactions appropriately
    // If it's Prisma, we can safely use $transaction
    if (this.contractRepo.constructor.name === 'PrismaContractRepository') {
      const contract = await prisma.$transaction(async (tx) => {
        // Ensure atomicity: Lock the room for new contract creation
        // This prevents race conditions where two requests might pass validation
        // and create overlapping contracts.
        await tx.$executeRaw`SELECT id FROM rooms WHERE id = ${data.roomId}::uuid FOR UPDATE`;
        
        // Look for exact duplicate
        const duplicate = await tx.contract.findFirst({
          where: {
            dormitoryId,
            roomId: data.roomId,
            tenantId: data.tenantId,
            startDate,
            endDate,
            rentAmount: data.rentAmount,
            status: data.status || 'draft'
          }
        });
        
        if (duplicate) {
          return {
            ...duplicate,
            rentAmount: duplicate.rentAmount ? duplicate.rentAmount.toString() : '0.00',
            depositAmount: duplicate.depositAmount ? duplicate.depositAmount.toString() : '0.00',
            advancePaymentAmount: duplicate.advancePaymentAmount ? duplicate.advancePaymentAmount.toString() : '0.00',
            _isIdempotent: true
          };
        }

        // Overlap Check
        const overlapping = await tx.contract.findMany({
          where: {
            dormitoryId,
            roomId: data.roomId,
            deletedAt: null,
            status: { in: ['active', 'expiring_soon', 'pending_signature', 'waiting_extension', 'checking_out'] },
            startDate: { lt: endDate },
            endDate: { gt: startDate },
          }
        });

        if (overlapping.length > 0) {
          const err = new Error('ช่วงเวลาสัญญาซ้อนทับกับสัญญาเดิมของห้องพักนี้');
          (err as any).code = 'CONTRACT_OVERLAP';
          (err as any).statusCode = 409;
          throw err;
        }

        // Create the contract using the transaction client
        const contractNumber = data.contractNumber || `CTR${Date.now().toString().slice(-6)}`;
        const created = await tx.contract.create({
          data: {
            id: data.id,
            dormitoryId,
            contractNumber,
            roomId: data.roomId,
            tenantId: data.tenantId,
            status: data.status || 'draft',
            startDate,
            endDate,
            durationMonths: data.durationMonths || 1,
            rentBillingType: data.rentBillingType || 'monthly',
            rentAmount: data.rentAmount,
            depositAmount: data.depositAmount || '0.00',
            advancePaymentAmount: data.advancePaymentAmount || '0.00',
            terms: data.terms || null,
            createdByUserId: actorUserId,
          },
        });
        
        return {
          ...created,
          rentAmount: created.rentAmount ? created.rentAmount.toString() : '0.00',
          depositAmount: created.depositAmount ? created.depositAmount.toString() : '0.00',
          advancePaymentAmount: created.advancePaymentAmount ? created.advancePaymentAmount.toString() : '0.00'
        };
      });
      
      // Log audit
      if (this.auditService && actorUserId) {
        await this.auditService.log({
          userId: actorUserId,
          action: 'CONTRACT_CREATED',
          source: 'contract',
          reason: `Created contract ${contract.contractNumber}`,
          ipMetadata: { dormitoryId, contractId: contract.id, roomId: data.roomId, tenantId: data.tenantId },
        });
      }
      return contract;
    }

    // Fallback for non-Prisma (in-memory) testing
    const overlapping = await this.contractRepo.findOverlappingContractsForRoom(
      dormitoryId,
      data.roomId,
      startDate,
      endDate
    );

    if (overlapping.length > 0) {
      const err = new Error('ช่วงเวลาสัญญาซ้อนทับกับสัญญาเดิมของห้องพักนี้');
      (err as any).code = 'CONTRACT_OVERLAP';
      (err as any).statusCode = 409;
      throw err;
    }

    const contract = await this.contractRepo.create(dormitoryId, {
      ...data,
      startDate,
      endDate,
      createdByUserId: actorUserId,
    });

    if (this.auditService && actorUserId) {
      await this.auditService.log({
        userId: actorUserId,
        action: 'CONTRACT_CREATED',
        source: 'contract',
        reason: `Created contract ${contract.contractNumber}`,
        ipMetadata: { dormitoryId, contractId: contract.id, roomId: data.roomId, tenantId: data.tenantId },
      });
    }

    return contract;
  }

  public async activateContract(
    id: string,
    dormitoryId: string,
    payload: { ownerSignature?: string | null; tenantSignature?: string | null; selectedInstallments?: number | null },
    actorUserId?: string
  ) {
    const contract = await this.getContractById(id, dormitoryId);

    // Idempotency check: if already active, check if snapshot exists, return existing
    if (contract.status === 'active') {
      const prisma = getPrismaClient();
      const existingSnapshot = await prisma.contractSnapshot.findUnique({ where: { contractId: id } });
      return {
        ...contract,
        snapshot: existingSnapshot,
      };
    }

    if (!['draft', 'pending_signature', 'approved', 'approved_scheduled'].includes(contract.status)) {
      const err = new Error(`ไม่สามารถเปิดใช้งานสัญญาที่อยู่ในสถานะ ${contract.status} ได้`);
      (err as any).code = 'INVALID_CONTRACT_STATUS_TRANSITION';
      (err as any).statusCode = 400;
      throw err;
    }

    const prisma = getPrismaClient();

    // Import defaultsService dynamically to avoid circular dependencies
    const { defaultsService } = await import('./defaults.service.js');

    // Check if we can use transactions
    if (this.contractRepo.constructor.name === 'PrismaContractRepository') {
      const updated = await prisma.$transaction(async (tx: any) => {
        // 1. Lock the room and fetch room data
        await tx.$executeRaw`SELECT id FROM rooms WHERE id = ${contract.roomId}::uuid FOR UPDATE`;
        const room = await tx.room.findFirst({ where: { id: contract.roomId } });
        if (!room) {
          throw new Error('ไม่พบห้องพักที่ระบุในสัญญา');
        }

        // 2. Double check status inside transaction
        const currentContract = await tx.contract.findFirst({
          where: { id },
          include: { snapshot: true },
        });
        if (currentContract?.status === 'active') {
          return currentContract;
        }

        // 3. Recheck interval availability
        const { BLOCKING_CONTRACT_STATUSES } = await import('./blocking-contract-policy.js');
        const ignoreContractIds = [id, contract.previousContractId].filter((x): x is string => !!x);
        const overlapping = await tx.contract.findMany({
          where: {
            dormitoryId,
            roomId: contract.roomId,
            id: { notIn: ignoreContractIds },
            deletedAt: null,
            status: { in: [...BLOCKING_CONTRACT_STATUSES] },
            startDate: { lt: contract.endDate },
            endDate: { gt: contract.startDate },
          },
        });
        if (overlapping.length > 0) {
          const err = new Error('ช่วงเวลาสัญญาซ้อนทับกับสัญญาเดิมที่เปิดใช้งานอยู่');
          (err as any).code = 'CONTRACT_OVERLAP';
          (err as any).statusCode = 409;
          throw err;
        }

        // 4. Resolve effective Room defaults
        const resolvedDefaults = await defaultsService.resolveEffectiveRoomDefaults(
          dormitoryId,
          room.buildingId,
          contract.roomId,
          tx
        );

        const now = new Date();

        let safeActorUserId: string | null = null;
        if (actorUserId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actorUserId)) {
          const actorUser = await tx.user.findUnique({ where: { id: actorUserId } });
          if (actorUser) {
            safeActorUserId = actorUserId;
          }
        }

        // 4.1 Calculate term-rent installment schedule if explicitly configured (Fixtures/DTOs)
        let installmentConfig: any = null;
        const requestedInstallments = payload.selectedInstallments || (contract as any).selectedInstallments;
        const resolvedRentType = contract.rentBillingType || resolvedDefaults.rentBillingType?.value || 'monthly';
        const isTermRent = resolvedRentType === 'term';

        if (isTermRent && requestedInstallments && typeof requestedInstallments === 'number' && requestedInstallments >= 1) {
          const building = await tx.building.findUnique({ where: { id: room.buildingId } });
          const maxInst = building?.maxTermRentInstallments || 1;
          const selectedInst = requestedInstallments;

          if (selectedInst > maxInst) {
            const err = new Error(`จำนวนงวดที่เลือก (${selectedInst}) เกินกว่าจำนวนงวดสูงสุดของอาคาร (${maxInst})`);
            (err as any).code = 'INSTALLMENT_EXCEEDS_BUILDING_MAX';
            (err as any).statusCode = 400;
            throw err;
          }

          const { generateExactInstallmentSchedule } = await import('../utils/installment-math.util.js');
          const termRentStr = String(contract.rentAmount || (isTermRent && room.termRent ? room.termRent : resolvedDefaults.monthlyRent.value));
          const schedule = generateExactInstallmentSchedule(termRentStr, selectedInst);

          installmentConfig = {
            maxInstallments: maxInst,
            selectedInstallments: selectedInst,
            termRentTotal: termRentStr,
            installmentSchedule: schedule,
          };
        }

        // 5. Create ContractSnapshot atomically
        const snapshot = await tx.contractSnapshot.create({
          data: {
            dormitoryId,
            contractId: id,
            buildingId: room.buildingId,
            roomId: contract.roomId,
            tenantId: contract.tenantId,
            exactRoomNumber: room.roomNumber,
            resolvedRent: contract.rentAmount || (resolvedRentType === 'term' && room.termRent ? room.termRent : resolvedDefaults.monthlyRent.value),
            resolvedDeposit: contract.depositAmount || resolvedDefaults.depositAmount.value,
            resolvedAdvancePayment: contract.advancePaymentAmount || resolvedDefaults.advancePaymentAmount.value,
            resolvedWaterRate: resolvedDefaults.waterRate.value,
            resolvedElectricityRate: resolvedDefaults.electricityRate.value,
            resolvedCommonFee: resolvedDefaults.commonFee.value,
            resolvedInternetFee: resolvedDefaults.internetFee.value,
            resolvedParkingFee: resolvedDefaults.parkingFee.value,
            waterBillingType: resolvedDefaults.waterBillingType.value,
            electricityBillingType: resolvedDefaults.electricityBillingType.value,
            rentBillingType: resolvedRentType,
            installmentConfig: installmentConfig || null,
            sourceVersions: resolvedDefaults.sourceVersions,
            snapshotData: resolvedDefaults as any,
            lockedAt: now,
            lockedByUserId: safeActorUserId,
          },
        });

        // 6. Update Contract to active
        const updatedContract = await tx.contract.update({
          where: { id },
          data: {
            status: 'active',
            ownerSignature: payload.ownerSignature || contract.ownerSignature,
            tenantSignature: payload.tenantSignature || contract.tenantSignature,
            signedByOwnerAt: payload.ownerSignature ? now : contract.signedByOwnerAt,
            signedByTenantAt: payload.tenantSignature ? now : contract.signedByTenantAt,
            activatedAt: now,
            updatedByUserId: safeActorUserId,
            version: { increment: 1 },
          },
        });

        // 6.5. If this is a renewed contract, complete prior contract & end prior active occupancy
        if (contract.previousContractId) {
          await tx.contract.update({
            where: { id: contract.previousContractId },
            data: { status: 'completed' },
          });
          await tx.occupancy.updateMany({
            where: { contractId: contract.previousContractId, status: 'ACTIVE' },
            data: { status: 'ENDED', endedAt: now, endedReason: 'ต่ออายุสัญญาฉบับใหม่' },
          });
        }

        // 7. Sync Room status & pointers
        await tx.room.update({
          where: { id: contract.roomId },
          data: {
            status: 'occupied',
            currentTenantId: contract.tenantId,
            currentContractId: contract.id,
          },
        });

        // 8. Sync Tenant status
        await tx.tenant.update({
          where: { id: contract.tenantId },
          data: {
            status: 'active',
          },
        });

        // 8.5. Create ACTIVE Occupancy linked to room + tenant + contract
        const ignoreOccupancyContractIds = [id, contract.previousContractId].filter((x): x is string => !!x);
        const existingActiveOccupancy = await tx.occupancy.findFirst({
          where: {
            dormitoryId,
            roomId: contract.roomId,
            status: 'ACTIVE',
            tenantId: { not: contract.tenantId },
            contractId: { notIn: ignoreOccupancyContractIds },
          },
        });
        if (existingActiveOccupancy) {
          const err = new Error('มีผู้เข้าพักอยู่ในห้องพักนี้แล้ว');
          (err as any).code = 'ROOM_ALREADY_OCCUPIED';
          (err as any).statusCode = 409;
          throw err;
        }

        let occupancy = await tx.occupancy.findFirst({
          where: {
            dormitoryId,
            contractId: id,
            status: 'ACTIVE',
          },
        });
        if (!occupancy) {
          occupancy = await tx.occupancy.create({
            data: {
              dormitoryId,
              roomId: contract.roomId,
              tenantId: contract.tenantId,
              contractId: id,
              startedAt: contract.startDate || now,
              status: 'ACTIVE',
            },
          });
        }

        // 9. Create ContractStatusHistory
        await tx.contractStatusHistory.create({
          data: {
            dormitoryId,
            contractId: id,
            fromStatus: contract.status,
            toStatus: 'active',
            reason: 'Contract activated & immutable snapshot locked',
            changedByUserId: safeActorUserId,
            effectiveAt: now,
          },
        });

        // 10. Create persistent AuditLog entry
        await tx.auditLog.create({
          data: {
            dormitoryId,
            actorUserId: safeActorUserId,
            entityType: 'CONTRACT',
            entityId: id,
            action: 'CONTRACT_ACTIVATED',
            beforeValues: { status: contract.status },
            afterValues: { status: 'active', snapshotId: snapshot.id },
            reason: `Activated contract ${updatedContract.contractNumber} and locked pricing snapshot`,
            versionBefore: contract.version,
            versionAfter: updatedContract.version,
          },
        });

        return {
          ...updatedContract,
          rentAmount: updatedContract.rentAmount ? updatedContract.rentAmount.toString() : '0.00',
          depositAmount: updatedContract.depositAmount ? updatedContract.depositAmount.toString() : '0.00',
          advancePaymentAmount: updatedContract.advancePaymentAmount ? updatedContract.advancePaymentAmount.toString() : '0.00',
          snapshot,
        };
      });

      return updated;
    }

    // Fallback for in-memory
    const now = new Date();
    const updated = await this.contractRepo.update(id, dormitoryId, {
      status: 'active',
      ownerSignature: payload.ownerSignature || contract.ownerSignature,
      tenantSignature: payload.tenantSignature || contract.tenantSignature,
      signedByOwnerAt: payload.ownerSignature ? now : contract.signedByOwnerAt,
      signedByTenantAt: payload.tenantSignature ? now : contract.signedByTenantAt,
      activatedAt: now,
      updatedByUserId: actorUserId,
    });

    // Sync Room status & pointers
    await this.roomRepo.update(contract.roomId, dormitoryId, {
      status: 'occupied',
      currentTenantId: contract.tenantId,
      currentContractId: contract.id,
    });

    // Sync Tenant status
    await this.tenantRepo.update(contract.tenantId, dormitoryId, {
      status: 'active',
    });

    // Record Status History
    await this.contractRepo.addStatusHistory(
      dormitoryId,
      id,
      contract.status,
      'active',
      'Contract activated & tenant moved in',
      actorUserId
    );

    if (this.auditService && actorUserId && updated) {
      await this.auditService.log({
        userId: actorUserId,
        action: 'CONTRACT_ACTIVATED',
        source: 'contract',
        reason: `Activated contract ${updated.contractNumber}`,
        ipMetadata: { dormitoryId, contractId: id, roomId: contract.roomId, tenantId: contract.tenantId },
      });
    }

    return updated;
  }

  public async extendContract(
    id: string,
    dormitoryId: string,
    payload: { newEndDate: string; additionalMonths?: number; reason?: string; version?: number },
    actorUserId?: string
  ) {
    const contract = await this.getContractById(id, dormitoryId);

    const newEndDate = new Date(payload.newEndDate);
    if (contract.status === 'active' && new Date(contract.endDate).getTime() === newEndDate.getTime()) {
      return contract;
    }

    if (!['active', 'expiring_soon', 'waiting_extension'].includes(contract.status)) {
      const err = new Error(`ไม่สามารถต่อสัญญาที่อยู่ในสถานะ ${contract.status} ได้`);
      (err as any).code = 'INVALID_CONTRACT_STATUS_TRANSITION';
      (err as any).statusCode = 400;
      throw err;
    }

    if (newEndDate <= new Date(contract.endDate)) {
      const err = new Error('วันสิ้นสุดสัญญาใหม่ต้องมากกว่าวันสิ้นสุดเดิม');
      (err as any).code = 'INVALID_EXTENSION_DATE';
      (err as any).statusCode = 400;
      throw err;
    }

    // Overlap Check for extension period
    const overlapping = await this.contractRepo.findOverlappingContractsForRoom(
      dormitoryId,
      contract.roomId,
      contract.startDate,
      newEndDate,
      id // Exclude self
    );

    if (overlapping.length > 0) {
      const err = new Error('การต่อสัญญาทำให้ช่วงเวลาซ้อนทับกับสัญญาอนาคตของห้องพักนี้');
      (err as any).code = 'CONTRACT_OVERLAP';
      (err as any).statusCode = 409;
      throw err;
    }

    const newDuration = payload.additionalMonths
      ? contract.durationMonths + payload.additionalMonths
      : contract.durationMonths;

    const updated = await this.contractRepo.update(
      id,
      dormitoryId,
      {
        endDate: newEndDate,
        durationMonths: newDuration,
        status: 'active', // Return to active
        updatedByUserId: actorUserId,
      },
      payload.version
    );

    await this.contractRepo.addStatusHistory(
      dormitoryId,
      id,
      contract.status,
      'active',
      payload.reason || `Extended contract to ${payload.newEndDate}`,
      actorUserId
    );

    if (this.auditService && actorUserId && updated) {
      await this.auditService.log({
        userId: actorUserId,
        action: 'CONTRACT_EXTENDED',
        source: 'contract',
        reason: `Extended contract ${updated.contractNumber}`,
        ipMetadata: { dormitoryId, contractId: id, newEndDate: payload.newEndDate },
      });
    }

    return updated;
  }

  public async renewContract(
    id: string,
    dormitoryId: string,
    payload: { startDate: string; endDate: string; rentAmount: string; durationMonths?: number },
    actorUserId?: string
  ) {
    const contract = await this.getContractById(id, dormitoryId);

    if (['draft', 'pending_signature', 'terminated', 'cancelled'].includes(contract.status)) {
      const err = new Error(`ไม่สามารถต่อสัญญาใหม่จากสัญญาที่อยู่ในสถานะ ${contract.status} ได้`);
      (err as any).code = 'INVALID_CONTRACT_STATUS_TRANSITION';
      (err as any).statusCode = 400;
      throw err;
    }

    // Idempotency: exact duplicate check for successor
    const prisma = getPrismaClient();
    if (this.contractRepo.constructor.name === 'PrismaContractRepository') {
      const existingSuccessor = await prisma.contract.findFirst({
        where: {
          dormitoryId,
          roomId: contract.roomId,
          tenantId: contract.tenantId,
          startDate: new Date(payload.startDate),
          endDate: new Date(payload.endDate),
          status: 'draft'
        }
      });
      if (existingSuccessor) {
        return {
          ...existingSuccessor,
          rentAmount: existingSuccessor.rentAmount ? existingSuccessor.rentAmount.toString() : '0.00',
          depositAmount: existingSuccessor.depositAmount ? existingSuccessor.depositAmount.toString() : '0.00',
          advancePaymentAmount: existingSuccessor.advancePaymentAmount ? existingSuccessor.advancePaymentAmount.toString() : '0.00',
          _isIdempotent: true
        };
      }
    }

    // Reuse createContract to apply all business logic and validations
    return this.createContract(dormitoryId, {
      roomId: contract.roomId,
      tenantId: contract.tenantId,
      startDate: new Date(payload.startDate),
      endDate: new Date(payload.endDate),
      durationMonths: payload.durationMonths || 1,
      rentBillingType: contract.rentBillingType,
      rentAmount: payload.rentAmount,
      depositAmount: contract.depositAmount,
      advancePaymentAmount: '0.00',
      status: 'draft',
    }, actorUserId);
  }

  public async terminateContract(
    id: string,
    dormitoryId: string,
    payload: {
      terminationEffectiveDate: string;
      terminationReason: string;
      depositRefundAmount?: string;
      deductionAmount?: string;
      settlementNote?: string;
      nextRoomStatus?: 'vacant' | 'maintenance';
      version?: number;
    },
    actorUserId?: string
  ) {
    const contract = await this.getContractById(id, dormitoryId);

    // Idempotency check: if already terminated, just return it
    if (contract.status === 'terminated') {
      return contract;
    }

    if (!['active', 'expiring_soon', 'waiting_extension', 'checking_out'].includes(contract.status)) {
      const err = new Error(`ไม่สามารถยกเลิกสัญญาที่อยู่ในสถานะ ${contract.status} ได้`);
      (err as any).code = 'INVALID_CONTRACT_STATUS_TRANSITION';
      (err as any).statusCode = 400;
      throw err;
    }

    const now = new Date();
    const effectiveDate = new Date(payload.terminationEffectiveDate);

    const settlementSummary = {
      depositRefundAmount: payload.depositRefundAmount || '0.00',
      deductionAmount: payload.deductionAmount || '0.00',
      settlementNote: payload.settlementNote || '',
      terminatedAt: now.toISOString(),
    };

    const updated = await this.contractRepo.update(
      id,
      dormitoryId,
      {
        status: 'terminated',
        terminatedAt: now,
        terminationEffectiveDate: effectiveDate,
        terminationReason: payload.terminationReason,
        settlementSummary,
        updatedByUserId: actorUserId,
      },
      payload.version
    );

    // Update Room pointers and status
    await this.roomRepo.update(contract.roomId, dormitoryId, {
      status: payload.nextRoomStatus || 'vacant',
      currentTenantId: null,
      currentContractId: null,
    });

    // Check if tenant has other active contracts
    const tenantContracts = await this.contractRepo.findAll(dormitoryId, { tenantId: contract.tenantId });
    const otherActive = tenantContracts.items.some(
      (c) => c.id !== id && ['active', 'expiring_soon', 'checking_out'].includes(c.status)
    );

    if (!otherActive) {
      await this.tenantRepo.update(contract.tenantId, dormitoryId, {
        status: 'former',
      });
    }

    await this.contractRepo.addStatusHistory(
      dormitoryId,
      id,
      contract.status,
      'terminated',
      payload.terminationReason,
      actorUserId
    );

    if (this.auditService && actorUserId && updated) {
      await this.auditService.log({
        userId: actorUserId,
        action: 'CONTRACT_TERMINATED',
        source: 'contract',
        reason: `Terminated contract ${updated.contractNumber}`,
        ipMetadata: { dormitoryId, contractId: id, reason: payload.terminationReason },
      });
    }

    return updated;
  }

  public async deleteDraftContract(id: string, dormitoryId: string, actorUserId?: string) {
    const deleted = await this.contractRepo.deleteDraft(id, dormitoryId);

    if (this.auditService && actorUserId && deleted) {
      await this.auditService.log({
        userId: actorUserId,
        action: 'CONTRACT_DELETED_DRAFT',
        source: 'contract',
        reason: `Deleted draft contract ${id}`,
        ipMetadata: { dormitoryId, contractId: id },
      });
    }

    return deleted;
  }

  public async reconcileExpiredContracts() {
    const { getPrismaClient } = await import('../db/prisma.js');
    const { logger } = await import('../config/logger.js');
    const prisma = getPrismaClient();
    const now = new Date();

    // Asia/Bangkok is UTC+7
    const bangkokNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const startOfBangkokToday = new Date(Date.UTC(bangkokNow.getUTCFullYear(), bangkokNow.getUTCMonth(), bangkokNow.getUTCDate(), 0, 0, 0));

    const dueContracts = await prisma.contract.findMany({
      where: {
        status: { in: ['active', 'expiring_soon'] },
        endDate: { lt: startOfBangkokToday }
      }
    });

    const results = [];
    for (const contractRecord of dueContracts) {
      try {
        const res = await prisma.$transaction(async (tx) => {
          const lockHash = Math.abs(
            contractRecord.roomId.split('').reduce((acc: number, char: string) => (acc * 31 + char.charCodeAt(0)) | 0, 0)
          );
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(1002::int, ${lockHash}::int);`;

          const currentContract = await tx.contract.findUnique({ where: { id: contractRecord.id } });
          if (!currentContract || currentContract.status === 'expired' || currentContract.status === 'terminated') {
            return null;
          }

          // Check if a replacement active contract exists
          const replacementContract = await tx.contract.findFirst({
            where: {
              dormitoryId: contractRecord.dormitoryId,
              roomId: contractRecord.roomId,
              tenantId: contractRecord.tenantId,
              id: { not: contractRecord.id },
              status: 'active',
              startDate: { lte: now }
            }
          });

          // Update contract status
          const updatedContract = await tx.contract.update({
            where: { id: contractRecord.id },
            data: { status: 'expired' }
          });

          if (replacementContract) {
            return { contract: updatedContract, renewed: true };
          }

          // End Occupancy and Vacate Room
          const occupancy = await tx.occupancy.findFirst({
            where: {
              dormitoryId: contractRecord.dormitoryId,
              roomId: contractRecord.roomId,
              tenantId: contractRecord.tenantId,
              status: 'ACTIVE'
            }
          });

          let updatedOccupancy = null;
          if (occupancy) {
            updatedOccupancy = await tx.occupancy.update({
              where: { id: occupancy.id },
              data: {
                status: 'ENDED',
                endedAt: contractRecord.endDate,
                endedReason: 'สัญญาเช่าสิ้นสุด (ระบบอัตโนมัติ)'
              }
            });

            // Cancel any pending/scheduled move-out requests attached to this occupancy
            const activeSchedules = await tx.tenantMoveOutRequest.findMany({
              where: {
                occupancyId: occupancy.id,
                status: { in: ['SCHEDULED', 'PENDING_OWNER_CONFIRMATION'] }
              }
            });
            for (const sched of activeSchedules) {
              await tx.tenantMoveOutRequest.update({
                where: { id: sched.id },
                data: {
                  status: 'CANCELLED',
                  reason: 'Contract expired prior to scheduled move-out date'
                }
              });
            }
          }

          await tx.room.update({
            where: { id: contractRecord.roomId },
            data: { status: 'vacant', currentTenantId: null, currentContractId: null }
          });

          await tx.tenant.update({
            where: { id: contractRecord.tenantId },
            data: { status: 'former' }
          }).catch(() => {});

          return { contract: updatedContract, occupancy: updatedOccupancy, renewed: false };
        });

        if (res) results.push(res);
      } catch (err) {
        logger.error({ msg: 'Failed to reconcile expired contract', contractId: contractRecord.id, error: err });
      }
    }

    return results;
  }

  public async getContractPdf(id: string, dormitoryId: string): Promise<Buffer> {
    const contract = await this.getContractById(id, dormitoryId);
    const room = await this.roomRepo.findById(contract.roomId, dormitoryId);
    const tenant = await this.tenantRepo.findById(contract.tenantId, dormitoryId);
    const prisma = getPrismaClient();

    const dorm = await prisma.dormitory.findUnique({
      where: { id: dormitoryId },
      include: { billingSettings: true }
    });

    const bs = dorm?.billingSettings;

    const pdfService = new DocumentPdfService();
    const pdfBuffer = await pdfService.generateContractPdf({
      contractNumber: contract.contractNumber,
      dormitoryName: dorm?.name || 'Dormitory',
      dormitoryAddress: dorm?.addressLine1,
      dormitoryPhone: dorm?.phone,
      ownerName: dorm?.name || 'Dormitory Owner',
      ownerSignatureUrl: (dorm as any)?.ownerSignatureUrl || null,
      tenantName: (tenant as any)?.displayName || (tenant as any)?.name || 'Tenant',
      tenantPhone: (tenant as any)?.phone,
      buildingName: room?.buildingId || null,
      roomNumber: room?.roomNumber || '101',
      rentBillingType: contract.rentBillingType === 'term' ? 'term' : 'monthly',
      startDate: contract.startDate.toISOString().split('T')[0],
      endDate: contract.endDate.toISOString().split('T')[0],
      rentAmount: contract.rentAmount.toString(),
      depositAmount: contract.depositAmount.toString(),
      waterRate: bs?.waterRate ? bs.waterRate.toString() : '18.00',
      electricityRate: bs?.electricityRate ? bs.electricityRate.toString() : '7.00',
      commonFee: bs?.commonFee ? bs.commonFee.toString() : '0.00',
      internetFee: (bs as any)?.internetFee ? (bs as any).internetFee.toString() : '0.00',
      billingDay: bs?.billingDay || 25,
      dueDay: bs?.dueDay ? Number(bs.dueDay) : '-',
      lateFeeMode: (bs as any)?.lateFeeMode || 'fixed',
      lateFeeAmount: (bs as any)?.lateFeeAmount ? (bs as any).lateFeeAmount.toString() : '0.00',
      tenantSignature: contract.tenantSignature,
      terms: contract.terms,
      createdAt: contract.createdAt ? contract.createdAt.toISOString().split('T')[0] : undefined,
    });

    return pdfBuffer;
  }
}

