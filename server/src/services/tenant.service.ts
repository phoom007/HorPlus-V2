import { ITenantRepository, TenantEntity, TenantFilterQuery, CreateTenantData } from '../db/repositories/tenant.repository.js';
import { IContractRepository } from '../db/repositories/contract.repository.js';
import { SensitiveFieldService } from './sensitive-field.service.js';
import { AuditService } from './audit.service.js';
import { getPrismaClient } from '../db/prisma.js';
import { parseAndNormalizeName, isMaskedNationalId } from '../utils/thai-identity.util.js';
import { processAndSecureTenantIdCardImage } from './image-security.service.js';
import { localStorageProvider } from './local-storage.service.js';

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
    const coOccupantHistory = await this.tenantRepo.findCoOccupantHistory(id, dormitoryId);
    const emergencyContacts = await this.tenantRepo.findEmergencyContacts(id, dormitoryId);
    const vehicles = await this.tenantRepo.findVehicles(id, dormitoryId);
    const contractsResult = await this.contractRepo.findAll(dormitoryId, { tenantId: id, pageSize: 100 });

    let occupancies: any[] = [];
    let dailyStays: any[] = [];
    let bills: any[] = [];
    let settlements: any[] = [];
    let contracts = contractsResult.items;

    try {
      const isUuid = (str?: string | null) => !!str && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
      const prisma = getPrismaClient();
      if (prisma && isUuid(id) && isUuid(dormitoryId)) {
        if (prisma.contract) {
          const detailedContracts = await prisma.contract.findMany({
            where: { tenantId: id, dormitoryId, deletedAt: null },
            include: { room: true },
            orderBy: { createdAt: 'desc' },
          });
          if (detailedContracts && detailedContracts.length > 0) {
            contracts = detailedContracts as any;
          }
        }
        if (prisma.occupancy) {
          occupancies = await prisma.occupancy.findMany({
            where: { tenantId: id, dormitoryId },
            include: { room: true, contract: true },
            orderBy: { startedAt: 'desc' },
          });
        }
        if (prisma.dailyStay) {
          dailyStays = await prisma.dailyStay.findMany({
            where: { tenantId: id, dormitoryId, deletedAt: null },
            include: {
              room: true,
              invoice: {
                include: { items: true, receipts: true, payments: true },
              },
            },
            orderBy: { startDate: 'desc' },
          });
        }
        if (prisma.bill) {
          bills = await prisma.bill.findMany({
            where: { tenantId: id, dormitoryId },
            include: {
              room: true,
              items: true,
              Payment: true,
              Receipt: true,
            },
            orderBy: { createdAt: 'desc' },
          });
        }
        if (prisma.contractSettlement) {
          settlements = await prisma.contractSettlement.findMany({
            where: { tenantId: id, dormitoryId },
            include: {
              items: { where: { isDeleted: false } },
              room: true,
              contract: true,
            },
            orderBy: { createdAt: 'desc' },
          });
        }
      }
    } catch {
      // Graceful fallback for mock or uninitialized environments
    }

    return {
      tenant,
      coOccupants,
      coOccupantHistory,
      emergencyContacts,
      vehicles,
      contracts,
      occupancies,
      dailyStays,
      bills,
      settlements,
    };
  }

  public async createTenant(dormitoryId: string, data: CreateTenantData & { nationalId?: string }, actorUserId?: string) {
    let parsedNames: { displayName: string; firstName: string; lastName: string | null } | undefined;
    if (data.displayName || (data as any).name) {
      parsedNames = parseAndNormalizeName(data.displayName || (data as any).name);
    } else if (data.firstName) {
      parsedNames = parseAndNormalizeName(`${data.firstName} ${data.lastName || ''}`);
    }

    const createPayload: CreateTenantData = {
      ...data,
      displayName: parsedNames?.displayName || data.displayName || `${data.firstName || ''} ${data.lastName || ''}`.trim(),
      firstName: parsedNames?.firstName || data.firstName || '',
      lastName: parsedNames?.lastName !== undefined ? (parsedNames.lastName ?? '') : (data.lastName || ''),
    };

    const tenant = await this.tenantRepo.create(dormitoryId, createPayload);

    // Handle National ID encryption/masking
    if (data.nationalId && data.nationalId.trim().length > 0) {
      const raw = data.nationalId.replace(/\D/g, '');
      if (raw.length === 13) {
        const { ciphertext } = this.sensitiveFieldService.encrypt(raw);
        const masked = this.sensitiveFieldService.maskNationalId(raw);
        await this.tenantRepo.update(tenant.id, dormitoryId, {
          nationalIdEncrypted: ciphertext,
          nationalIdMasked: masked,
        });
        tenant.nationalIdEncrypted = ciphertext;
        tenant.nationalIdMasked = masked;
      }
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

    if (data.displayName !== undefined || (data as any).name !== undefined) {
      const rawName = data.displayName !== undefined ? data.displayName : (data as any).name;
      const parsed = parseAndNormalizeName(rawName);
      updatePayload.displayName = parsed.displayName;
      updatePayload.firstName = parsed.firstName;
      updatePayload.lastName = parsed.lastName;
    } else if (data.firstName !== undefined || data.lastName !== undefined) {
      const fn = data.firstName !== undefined ? data.firstName : tenant.firstName;
      const ln = data.lastName !== undefined ? data.lastName : tenant.lastName;
      const parsed = parseAndNormalizeName(`${fn} ${ln}`.trim());
      updatePayload.displayName = parsed.displayName;
      updatePayload.firstName = parsed.firstName;
      updatePayload.lastName = parsed.lastName;
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
      const trimmed = data.nationalId.trim();
      if (trimmed === '') {
        updatePayload.nationalIdEncrypted = null;
        updatePayload.nationalIdMasked = null;
      } else if (isMaskedNationalId(trimmed) || trimmed === tenant.nationalIdMasked) {
        // Masked value submitted from UI/form without edits - DO NOT overwrite!
      } else {
        const rawDigits = trimmed.replace(/\D/g, '');
        if (rawDigits.length === 13) {
          updatePayload.nationalIdEncrypted = this.sensitiveFieldService.encrypt(rawDigits).ciphertext;
          updatePayload.nationalIdMasked = this.sensitiveFieldService.maskNationalId(rawDigits);
        }
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

  public async verifyActiveTenancy(dormitoryId: string, tenantId: string) {
    const isUuid = (str: string) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

    // 1. Check active contracts using contractRepo (supports both in-memory and prisma adapters)
    try {
      const contractsRes = await this.contractRepo.findAll(dormitoryId, { tenantId, pageSize: 100 });
      const hasActiveContract = contractsRes.items.some((c) =>
        ['active', 'expiring_soon', 'pending_signature', 'waiting_extension', 'checking_out'].includes(c.status)
      );
      if (hasActiveContract) {
        return;
      }
    } catch {}

    // 2. Check active occupancy using Prisma if UUID format is valid
    if (isUuid(dormitoryId) && isUuid(tenantId)) {
      try {
        const prisma = getPrismaClient();
        const activeOccupancy = await prisma.occupancy.findFirst({
          where: {
            dormitoryId,
            tenantId,
            status: 'ACTIVE',
          },
        });
        if (activeOccupancy) {
          return;
        }
      } catch {}
    }

    const err = new Error('ผู้เช่าไม่มีสัญญาหรือสถานะการพักอาศัยที่เปิดใช้งานอยู่');
    (err as any).code = 'NO_ACTIVE_TENANCY';
    (err as any).statusCode = 403;
    throw err;
  }

  // Child Entities Management
  public async addCoOccupant(dormitoryId: string, tenantId: string, data: any, actorUserId?: string) {
    const tenant = await this.getTenantById(tenantId, dormitoryId);
    await this.verifyActiveTenancy(dormitoryId, tenantId);
    const co = await this.tenantRepo.createCoOccupant(dormitoryId, tenantId, data);
    if (this.auditService && actorUserId) {
      await this.auditService.log({
        userId: actorUserId,
        action: 'TENANT_CO_OCCUPANT_ADDED',
        source: 'tenant',
        reason: `Added co-occupant ${data.name} to tenant ${tenant.displayName}`,
        ipMetadata: { dormitoryId, tenantId, coOccupantId: co.id },
      });
    }
    return co;
  }

  public async updateCoOccupant(
    dormitoryId: string,
    tenantId: string,
    coOccupantId: string,
    data: any,
    actorUserId?: string
  ) {
    const tenant = await this.getTenantById(tenantId, dormitoryId);
    await this.verifyActiveTenancy(dormitoryId, tenantId);
    const updated = await this.tenantRepo.updateCoOccupant(coOccupantId, dormitoryId, tenantId, data);
    if (!updated) {
      const err = new Error('ไม่พบข้อมูลผู้พักร่วมที่ระบุ');
      (err as any).code = 'CO_OCCUPANT_NOT_FOUND';
      (err as any).statusCode = 404;
      throw err;
    }
    if (this.auditService && actorUserId) {
      await this.auditService.log({
        userId: actorUserId,
        action: 'TENANT_CO_OCCUPANT_UPDATED',
        source: 'tenant',
        reason: `Updated co-occupant ${updated.name} for tenant ${tenant.displayName}`,
        ipMetadata: { dormitoryId, tenantId, coOccupantId },
      });
    }
    return updated;
  }

  public async removeCoOccupant(dormitoryId: string, tenantId: string, coOccupantId: string, actorUserId?: string) {
    const tenant = await this.getTenantById(tenantId, dormitoryId);
    await this.verifyActiveTenancy(dormitoryId, tenantId);
    const success = await this.tenantRepo.deleteCoOccupant(coOccupantId, dormitoryId, tenantId);
    if (!success) {
      const err = new Error('ไม่พบข้อมูลผู้พักร่วมที่ระบุ');
      (err as any).code = 'CO_OCCUPANT_NOT_FOUND';
      (err as any).statusCode = 404;
      throw err;
    }
    if (this.auditService && actorUserId) {
      await this.auditService.log({
        userId: actorUserId,
        action: 'TENANT_CO_OCCUPANT_REMOVED',
        source: 'tenant',
        reason: `Removed co-occupant from tenant ${tenant.displayName}`,
        ipMetadata: { dormitoryId, tenantId, coOccupantId },
      });
    }
    return { success: true };
  }

  public async addEmergencyContact(dormitoryId: string, tenantId: string, data: any) {
    await this.getTenantById(tenantId, dormitoryId);
    return this.tenantRepo.createEmergencyContact(dormitoryId, tenantId, data);
  }

  public async updateEmergencyContact(dormitoryId: string, tenantId: string, contactId: string, data: any) {
    await this.getTenantById(tenantId, dormitoryId);
    const updated = await this.tenantRepo.updateEmergencyContact(contactId, dormitoryId, data, tenantId);
    if (!updated) {
      const err = new Error('ไม่พบข้อมูลผู้ติดต่อฉุกเฉินที่ระบุ');
      (err as any).code = 'EMERGENCY_CONTACT_NOT_FOUND';
      (err as any).statusCode = 404;
      throw err;
    }
    return updated;
  }

  public async deleteEmergencyContact(dormitoryId: string, tenantId: string, contactId: string) {
    await this.getTenantById(tenantId, dormitoryId);
    const success = await this.tenantRepo.deleteEmergencyContact(contactId, dormitoryId, tenantId);
    if (!success) {
      const err = new Error('ไม่พบข้อมูลผู้ติดต่อฉุกเฉินที่ระบุ');
      (err as any).code = 'EMERGENCY_CONTACT_NOT_FOUND';
      (err as any).statusCode = 404;
      throw err;
    }
    return { success: true };
  }

  public async addVehicle(dormitoryId: string, tenantId: string, data: any) {
    await this.getTenantById(tenantId, dormitoryId);
    return this.tenantRepo.createVehicle(dormitoryId, tenantId, data);
  }

  public async updateVehicle(dormitoryId: string, tenantId: string, vehicleId: string, data: any) {
    await this.getTenantById(tenantId, dormitoryId);
    const updated = await this.tenantRepo.updateVehicle(vehicleId, dormitoryId, data, tenantId);
    if (!updated) {
      const err = new Error('ไม่พบข้อมูลยานพาหนะที่ระบุ');
      (err as any).code = 'VEHICLE_NOT_FOUND';
      (err as any).statusCode = 404;
      throw err;
    }
    return updated;
  }

  public async deleteVehicle(dormitoryId: string, tenantId: string, vehicleId: string) {
    await this.getTenantById(tenantId, dormitoryId);
    const success = await this.tenantRepo.deleteVehicle(vehicleId, dormitoryId, tenantId);
    if (!success) {
      const err = new Error('ไม่พบข้อมูลยานพาหนะที่ระบุ');
      (err as any).code = 'VEHICLE_NOT_FOUND';
      (err as any).statusCode = 404;
      throw err;
    }
    return { success: true };
  }

  public async updateTenantIdentityDocument(
    dormitoryId: string,
    tenantId: string,
    rawBuffer: Buffer,
    actorUserId?: string
  ) {
    const tenant = await this.getTenantById(tenantId, dormitoryId);

    // Process image through sharp pipeline
    const secured = await processAndSecureTenantIdCardImage(rawBuffer);

    // Generate safe object key
    const objectKey = `tenants/${dormitoryId}/${tenantId}/id-card-${Date.now()}.webp`;

    // Save to local storage
    await localStorageProvider.saveFile(objectKey, secured.buffer);

    const uploadedAt = new Date();
    await this.tenantRepo.update(tenantId, dormitoryId, {
      idCardObjectKey: objectKey,
      idCardSha256: secured.sha256,
      idCardMimeType: secured.mimeType,
      idCardByteSize: secured.byteSize,
      idCardUploadedAt: uploadedAt,
      idCardUploadedByUserId: actorUserId || null,
    });

    if (this.auditService && actorUserId) {
      await this.auditService.log({
        userId: actorUserId,
        action: 'TENANT_ID_CARD_UPLOADED',
        source: 'tenant',
        reason: `Uploaded ID card document for tenant ${tenant.displayName}`,
        ipMetadata: { dormitoryId, tenantId, sha256: secured.sha256 },
      });
    }

    return {
      tenantId,
      idCardUploadedAt: uploadedAt.toISOString(),
      idCardSha256: secured.sha256,
      idCardMimeType: secured.mimeType,
      idCardByteSize: secured.byteSize,
    };
  }
}
