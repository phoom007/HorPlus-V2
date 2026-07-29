import { IContractRepository, ContractEntity, ContractFilterQuery, CreateContractData } from '../db/repositories/contract.repository.js';
import { IRoomRepository } from '../db/repositories/room.repository.js';
import { ITenantRepository } from '../db/repositories/tenant.repository.js';
import { AuditService } from './audit.service.js';

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

    // 3. Overlap Check (Half-open interval [startDate, endDate))
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
        metadata: { dormitoryId, contractId: contract.id, roomId: data.roomId, tenantId: data.tenantId },
      });
    }

    return contract;
  }

  public async activateContract(
    id: string,
    dormitoryId: string,
    payload: { ownerSignature?: string | null; tenantSignature?: string | null },
    actorUserId?: string
  ) {
    const contract = await this.getContractById(id, dormitoryId);

    if (!['draft', 'pending_signature'].includes(contract.status)) {
      const err = new Error(`ไม่สามารถเปิดใช้งานสัญญาที่อยู่ในสถานะ ${contract.status} ได้`);
      (err as any).code = 'INVALID_CONTRACT_STATUS_TRANSITION';
      (err as any).statusCode = 400;
      throw err;
    }

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
        metadata: { dormitoryId, contractId: id, roomId: contract.roomId, tenantId: contract.tenantId },
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

    if (!['active', 'expiring_soon', 'waiting_extension'].includes(contract.status)) {
      const err = new Error(`ไม่สามารถต่อสัญญาที่อยู่ในสถานะ ${contract.status} ได้`);
      (err as any).code = 'INVALID_CONTRACT_STATUS_TRANSITION';
      (err as any).statusCode = 400;
      throw err;
    }

    const newEndDate = new Date(payload.newEndDate);
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
        metadata: { dormitoryId, contractId: id, newEndDate: payload.newEndDate },
      });
    }

    return updated;
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
        metadata: { dormitoryId, contractId: id, reason: payload.terminationReason },
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
        metadata: { dormitoryId, contractId: id },
      });
    }

    return deleted;
  }
}
