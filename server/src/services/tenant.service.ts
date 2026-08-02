import { ITenantRepository, TenantEntity, TenantFilterQuery, CreateTenantData } from '../db/repositories/tenant.repository.js';
import { IContractRepository } from '../db/repositories/contract.repository.js';
import { SensitiveFieldService } from './sensitive-field.service.js';
import { AuditService } from './audit.service.js';

export class TenantService {
  constructor(
    private tenantRepo: ITenantRepository,
    private contractRepo: IContractRepository,
    private sensitiveFieldService: SensitiveFieldService,
    private auditService?: AuditService
  ) {}

  public async getTenants(dormitoryId: string, filter?: TenantFilterQuery) {
    const result = await this.tenantRepo.findAll(dormitoryId, filter);
    return result;
  }

  public async getTenantById(id: string, dormitoryId: string) {
    const t = await this.tenantRepo.findById(id, dormitoryId);
    if (!t) {
      const err = new Error('ไม่พบข้อมูลผู้เช่าที่ระบุ');
      (err as any).code = 'TENANT_NOT_FOUND';
      (err as any).statusCode = 404;
      throw err;
    }
    return t;
  }

  public async getTenantDetails(id: string, dormitoryId: string) {
    const tenant = await this.getTenantById(id, dormitoryId);
    const coOccupants = await this.tenantRepo.findCoOccupants(id, dormitoryId);
    const emergencyContacts = await this.tenantRepo.findEmergencyContacts(id, dormitoryId);
    const vehicles = await this.tenantRepo.findVehicles(id, dormitoryId);
    const contracts = await this.contractRepo.findAll(dormitoryId, { tenantId: id, pageSize: 100 });

    return {
      tenant,
      coOccupants,
      emergencyContacts,
      vehicles,
      contracts: contracts.items,
    };
  }

  public async createTenant(dormitoryId: string, data: CreateTenantData & { nationalId?: string }, actorUserId?: string) {
    const tenant = await this.tenantRepo.create(dormitoryId, data);

    // Handle National ID encryption/masking
    if (data.nationalId && data.nationalId.trim().length > 0) {
      const { ciphertext } = this.sensitiveFieldService.encrypt(data.nationalId.trim());
      const masked = this.sensitiveFieldService.maskNationalId(data.nationalId.trim());
      await this.tenantRepo.update(tenant.id, dormitoryId, {
        nationalIdEncrypted: ciphertext,
        nationalIdMasked: masked,
      });
      tenant.nationalIdEncrypted = ciphertext;
      tenant.nationalIdMasked = masked;
    }

    if (this.auditService && actorUserId) {
      await this.auditService.log({
        userId: actorUserId,
        action: 'TENANT_CREATED',
        source: 'tenant',
        reason: `Created tenant ${tenant.displayName}`,
        ipMetadata: { dormitoryId, tenantId: tenant.id },
      });
    }

    return tenant;
  }

  public async updateTenant(
    id: string,
    dormitoryId: string,
    data: Partial<CreateTenantData> & { nationalId?: string; version?: number },
    actorUserId?: string
  ) {
    const tenant = await this.getTenantById(id, dormitoryId);

    const updatePayload: Partial<TenantEntity> = {};

    if (data.firstName !== undefined) updatePayload.firstName = data.firstName;
    if (data.lastName !== undefined) updatePayload.lastName = data.lastName;
    if (data.displayName !== undefined) {
      updatePayload.displayName = data.displayName;
    } else if (data.firstName || data.lastName) {
      const fn = data.firstName || tenant.firstName;
      const ln = data.lastName !== undefined ? data.lastName : tenant.lastName;
      updatePayload.displayName = `${fn} ${ln || ''}`.trim();
    }

    if (data.phone !== undefined) updatePayload.phone = data.phone;
    if (data.email !== undefined) updatePayload.email = data.email;
    if (data.dateOfBirth !== undefined) updatePayload.dateOfBirth = data.dateOfBirth ? new Date(data.dateOfBirth) : null;
    if (data.gender !== undefined) updatePayload.gender = data.gender;
    if (data.address !== undefined) updatePayload.address = data.address;
    if (data.photoUrl !== undefined) updatePayload.photoUrl = data.photoUrl;
    if (data.petInfo !== undefined) updatePayload.petInfo = data.petInfo;
    if (data.notes !== undefined) updatePayload.notes = data.notes;

    if (data.nationalId !== undefined && data.nationalId !== null) {
      if (data.nationalId.trim().length > 0) {
        updatePayload.nationalIdEncrypted = this.sensitiveFieldService.encrypt(data.nationalId.trim()).ciphertext;
        updatePayload.nationalIdMasked = this.sensitiveFieldService.maskNationalId(data.nationalId.trim());
      } else {
        updatePayload.nationalIdEncrypted = null;
        updatePayload.nationalIdMasked = null;
      }
    }

    const updated = await this.tenantRepo.update(id, dormitoryId, updatePayload, data.version);

    if (this.auditService && actorUserId && updated) {
      await this.auditService.log({
        userId: actorUserId,
        action: 'TENANT_UPDATED',
        source: 'tenant',
        reason: `Updated tenant ${updated.displayName}`,
        ipMetadata: { dormitoryId, tenantId: id },
      });
    }

    return updated;
  }

  public async archiveTenant(id: string, dormitoryId: string, actorUserId?: string) {
    await this.getTenantById(id, dormitoryId);

    // Check if tenant has active/blocking contracts
    const activeContracts = await this.contractRepo.findAll(dormitoryId, { tenantId: id, pageSize: 100 });
    const hasActive = activeContracts.items.some((c) =>
      ['active', 'expiring_soon', 'pending_signature', 'waiting_extension', 'checking_out'].includes(c.status)
    );

    if (hasActive) {
      const err = new Error('ไม่สามารถเก็บหรือลบข้อมูลผู้เช่าที่มีสัญญาเปิดใช้งานอยู่ได้');
      (err as any).code = 'TENANT_HAS_ACTIVE_CONTRACT';
      (err as any).statusCode = 409;
      throw err;
    }

    const archived = await this.tenantRepo.archive(id, dormitoryId);

    if (this.auditService && actorUserId && archived) {
      await this.auditService.log({
        userId: actorUserId,
        action: 'TENANT_ARCHIVED',
        source: 'tenant',
        reason: `Archived tenant ${archived.displayName}`,
        ipMetadata: { dormitoryId, tenantId: id },
      });
    }

    return archived;
  }

  // Child Entities Management
  public async addCoOccupant(dormitoryId: string, tenantId: string, data: any) {
    await this.getTenantById(tenantId, dormitoryId);
    return this.tenantRepo.createCoOccupant(dormitoryId, tenantId, data);
  }

  public async addEmergencyContact(dormitoryId: string, tenantId: string, data: any) {
    await this.getTenantById(tenantId, dormitoryId);
    return this.tenantRepo.createEmergencyContact(dormitoryId, tenantId, data);
  }

  public async addVehicle(dormitoryId: string, tenantId: string, data: any) {
    await this.getTenantById(tenantId, dormitoryId);
    return this.tenantRepo.createVehicle(dormitoryId, tenantId, data);
  }
}
