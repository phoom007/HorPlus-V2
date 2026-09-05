import { AppError } from '../types/index.js';
import { ITenantRepository, TenantEntity, TenantFilterQuery, CreateTenantData } from '../db/repositories/tenant.repository.js';
import { IContractRepository } from '../db/repositories/contract.repository.js';
import { SensitiveFieldService } from './sensitive-field.service.js';
import { AuditService } from './audit.service.js';
import { parseAndNormalizeName, isMaskedNationalId } from '../utils/thai-identity.util.js';
import { processAndSecureTenantIdCardImage } from './image-security.service.js';
import { localStorageProvider } from './local-storage.service.js';
import { logger } from '../config/logger.js';

export interface TenantAggregateDataSource {
  $transaction?<T>(fn: (tx: any) => Promise<T>): Promise<T>;
  dormitoryPropertyDefaults?: {
    findUnique(args: any): Promise<any | null>;
  };
  tenant?: {
    findFirst(args: any): Promise<any | null>;
    update(args: any): Promise<any>;
  };
  tenantEmergencyContact?: {
    findFirst(args: any): Promise<any | null>;
    findMany(args: any): Promise<any[]>;
    create(args: any): Promise<any>;
    update(args: any): Promise<any>;
    delete?(args: any): Promise<any>;
  };
  tenantVehicle?: {
    findFirst(args: any): Promise<any | null>;
    findMany(args: any): Promise<any[]>;
    create(args: any): Promise<any>;
    update(args: any): Promise<any>;
  };
  contract: {
    findMany(args: any): Promise<any[]>;
  };
  occupancy: {
    findMany(args: any): Promise<any[]>;
    findFirst(args: any): Promise<any | null>;
  };
  dailyStay: {
    findMany(args: any): Promise<any[]>;
  };
  bill: {
    findMany(args: any): Promise<any[]>;
  };
  contractSettlement: {
    findMany(args: any): Promise<any[]>;
  };
}

export function normalizePetTypeKey(pet: { type?: string | null; customType?: string | null }): string {
  if (!pet) return '';
  const rawType = (pet.type || '').trim().toLowerCase();
  const rawCustom = (pet.customType || '').trim().toLowerCase();

  // Canonical standard mappings (Thai & English)
  if (rawType === 'dog' || rawType === 'สุนัข' || rawType === 'หมา') return 'dog';
  if (rawType === 'cat' || rawType === 'แมว') return 'cat';
  if (rawType === 'bird' || rawType === 'นก') return 'bird';
  if (rawType === 'fish' || rawType === 'ปลา') return 'fish';
  if (rawType === 'rabbit' || rawType === 'กระต่าย') return 'rabbit';
  if (rawType === 'hamster' || rawType === 'หนู' || rawType === 'หนูแฮมสเตอร์') return 'hamster';

  // Explicit other / custom types
  if (rawType === 'other' || rawType === 'others' || rawType === 'อื่นๆ') {
    if (rawCustom) {
      if (rawCustom === 'dog' || rawCustom === 'สุนัข' || rawCustom === 'หมา') return 'dog';
      if (rawCustom === 'cat' || rawCustom === 'แมว') return 'cat';
      if (rawCustom === 'bird' || rawCustom === 'นก') return 'bird';
      if (rawCustom === 'fish' || rawCustom === 'ปลา') return 'fish';
      if (rawCustom === 'rabbit' || rawCustom === 'กระต่าย') return 'rabbit';
      if (rawCustom === 'hamster' || rawCustom === 'หนู' || rawCustom === 'หนูแฮมสเตอร์') return 'hamster';
      return `other:${rawCustom}`;
    }
    return 'other';
  }

  // Legacy direct custom type (e.g. { type: "งู" } or { type: "snake" })
  if (rawType) {
    return `other:${rawType}`;
  }

  // If type was empty but customType provided
  if (rawCustom) {
    return `other:${rawCustom}`;
  }

  return '';
}

export function expandAllowedPetPolicyTypes(allowedTypes: string[]): {
  allowedCanonicals: Set<string>;
  allowedRawTerms: Set<string>;
} {
  const allowedCanonicals = new Set<string>();
  const allowedRawTerms = new Set<string>();

  for (const raw of allowedTypes) {
    const t = (raw || '').trim().toLowerCase();
    if (!t) continue;
    allowedRawTerms.add(t);

    if (t === 'small_pet' || t === 'small-pet' || t === 'small_pets') {
      for (const sp of ['bird', 'fish', 'rabbit', 'hamster']) {
        allowedCanonicals.add(sp);
        allowedRawTerms.add(sp);
      }
      for (const th of ['นก', 'ปลา', 'กระต่าย', 'หนู', 'หนูแฮมสเตอร์']) {
        allowedRawTerms.add(th);
      }
      continue;
    }

    const canon = normalizePetTypeKey({ type: t });
    if (canon) allowedCanonicals.add(canon);
  }

  return { allowedCanonicals, allowedRawTerms };
}

export function classifySubmittedPets(
  existingPetInfo: any,
  submittedPets: Array<{ id?: string | null; type: string; customType?: string | null; name?: string | null }>
): {
  grandfathered: Array<{ id?: string | null; type: string; customType?: string | null; name?: string | null }>;
  newOrChanged: Array<{ id?: string | null; type: string; customType?: string | null; name?: string | null }>;
} {
  const existingList: any[] = Array.isArray(existingPetInfo)
    ? existingPetInfo
    : (existingPetInfo && typeof existingPetInfo === 'object' && existingPetInfo.type ? [existingPetInfo] : []);

  const grandfathered: any[] = [];
  const newOrChanged: any[] = [];

  // 1. Stable ID matching where present
  const existingById = new Map<string, any>();
  const unmatchedExisting: any[] = [];

  for (const ep of existingList) {
    if (ep && typeof ep === 'object' && ep.id && typeof ep.id === 'string' && !ep.id.startsWith('temp-')) {
      existingById.set(ep.id, ep);
    } else if (ep && typeof ep === 'object') {
      unmatchedExisting.push(ep);
    }
  }

  const unmatchedSubmitted: any[] = [];

  for (const sp of submittedPets) {
    if (sp.id && existingById.has(sp.id)) {
      const existing = existingById.get(sp.id)!;
      existingById.delete(sp.id); // consumed
      const spKey = normalizePetTypeKey(sp);
      const exKey = normalizePetTypeKey(existing);
      if (spKey === exKey) {
        grandfathered.push(sp);
      } else {
        newOrChanged.push(sp);
      }
    } else {
      unmatchedSubmitted.push(sp);
    }
  }

  // Any remaining ID-bearing existing pets that weren't matched by ID join unmatched existing
  for (const ep of existingById.values()) {
    unmatchedExisting.push(ep);
  }

  // 2. Deterministic multiset matching by normalized type authority
  const existingPool = new Map<string, number>();
  for (const ep of unmatchedExisting) {
    const key = normalizePetTypeKey(ep);
    if (key) {
      existingPool.set(key, (existingPool.get(key) || 0) + 1);
    }
  }

  for (const sp of unmatchedSubmitted) {
    const key = normalizePetTypeKey(sp);
    const count = existingPool.get(key) || 0;
    if (count > 0) {
      existingPool.set(key, count - 1);
      grandfathered.push(sp);
    } else {
      newOrChanged.push(sp);
    }
  }

  return { grandfathered, newOrChanged };
}

export class TenantService {
  constructor(
    private tenantRepo: ITenantRepository,
    private contractRepo: IContractRepository,
    private sensitiveFieldService: SensitiveFieldService,
    private auditService?: AuditService,
    private aggregatePrisma?: TenantAggregateDataSource | null
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

    const prisma = this.aggregatePrisma ?? null;

    // In production or when backed by Prisma repository / aggregate dependency, execute authoritative Prisma queries.
    // If a database query fails, FAIL CLOSED — do NOT catch and swallow into empty arrays.
    if (prisma) {
      const detailedContracts = await prisma.contract.findMany({
        where: { tenantId: id, dormitoryId, deletedAt: null },
        include: { room: true },
        orderBy: { createdAt: 'desc' },
      });
      if (detailedContracts && detailedContracts.length > 0) {
        contracts = detailedContracts as any;
      }
      occupancies = await prisma.occupancy.findMany({
        where: { tenantId: id, dormitoryId },
        include: { room: true, contract: true },
        orderBy: { startedAt: 'desc' },
      });
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
    // 1. Check active contracts using contractRepo (supports both in-memory and prisma adapters)
    const contractsRes = await this.contractRepo.findAll(dormitoryId, { tenantId, pageSize: 100 });
    const hasActiveContract = contractsRes.items.some((c) =>
      ['active', 'expiring_soon', 'pending_signature', 'waiting_extension', 'checking_out'].includes(c.status)
    );
    if (hasActiveContract) {
      return;
    }

    // 2. Check active occupancy using Prisma if explicit aggregate dependency is provided
    const prisma = this.aggregatePrisma ?? null;
    if (prisma) {
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
    const oldObjectKey = tenant.idCardObjectKey;

    // Process image through sharp pipeline
    const secured = await processAndSecureTenantIdCardImage(rawBuffer);

    // Generate safe object key
    const objectKey = `tenants/${dormitoryId}/${tenantId}/id-card-${Date.now()}.webp`;

    // Save to local storage
    await localStorageProvider.saveFile(objectKey, secured.buffer);

    const uploadedAt = new Date();
    let updatedTenant: TenantEntity | null = null;
    try {
      updatedTenant = await this.tenantRepo.update(tenantId, dormitoryId, {
        idCardObjectKey: objectKey,
        idCardSha256: secured.sha256,
        idCardMimeType: secured.mimeType,
        idCardByteSize: secured.byteSize,
        idCardUploadedAt: uploadedAt,
        idCardUploadedByUserId: actorUserId || null,
      });
    } catch (repoErr) {
      // Compensation: delete newly written file so no orphan file remains
      try {
        await localStorageProvider.deleteFile(objectKey);
      } catch (cleanupErr) {
        logger.error({ cleanupErr, objectKey }, '[TenantDocument] Compensation cleanup failed after repo update error');
      }
      throw repoErr;
    }

    if (!updatedTenant) {
      // Compensation: delete newly written file so no orphan file remains
      try {
        await localStorageProvider.deleteFile(objectKey);
      } catch (cleanupErr) {
        logger.error({ cleanupErr, objectKey }, '[TenantDocument] Compensation cleanup failed after null repo update');
      }
      const err = new Error('ไม่พบข้อมูลผู้เช่าที่ระบุ');
      (err as any).code = 'TENANT_NOT_FOUND';
      (err as any).statusCode = 404;
      throw err;
    }

    // Success: cleanup superseded old private file (fail-soft)
    if (oldObjectKey && oldObjectKey !== objectKey) {
      try {
        await localStorageProvider.deleteFile(oldObjectKey);
      } catch (cleanupErr) {
        logger.error({ cleanupErr, oldObjectKey }, '[TenantDocument] Superseded old document cleanup failed');
      }
    }

    // Post-commit audit logging (fail-soft)
    if (this.auditService && actorUserId) {
      try {
        await this.auditService.log({
          userId: actorUserId,
          action: 'TENANT_ID_CARD_UPLOADED',
          source: 'tenant',
          reason: `Uploaded ID card document for tenant ${tenant.displayName}`,
          ipMetadata: { dormitoryId, tenantId, sha256: secured.sha256 },
        });
      } catch (auditErr) {
        logger.error({ auditErr, tenantId }, '[TenantDocument] Post-commit audit log failure (fail-soft)');
      }
    }

    return {
      tenantId,
      version: updatedTenant.version,
      idCardUploadedAt: uploadedAt.toISOString(),
      idCardSha256: secured.sha256,
      idCardMimeType: secured.mimeType,
      idCardByteSize: secured.byteSize,
    };
  }

  public async updateTenantProfileAggregate(
    dormitoryId: string,
    tenantId: string,
    data: {
      displayName: string;
      phone: string;
      email?: string | null;
      nationalId?: string | null;
      version: number;
      emergencyContact?: {
        id?: string | null;
        name: string;
        phone: string;
        relationship?: string | null;
        isPrimary?: boolean;
      } | null;
      vehicles?: Array<{
        id?: string | null;
        type: 'car' | 'motorcycle' | 'none' | 'other' | string;
        licensePlate: string;
        brand?: string | null;
        model?: string | null;
        color?: string | null;
        province?: string | null;
      }>;
      pets?: Array<{
        id?: string | null;
        type: string;
        customType?: string | null;
        name?: string | null;
      }>;
    },
    actorUserId?: string
  ) {
    const result = await this.tenantRepo.runInTransaction(async (txRepo) => {
      const tenant = await txRepo.findById(tenantId, dormitoryId);
      if (!tenant) {
        throw new AppError('Tenant not found', 404, 'TENANT_NOT_FOUND');
      }

      // 1. Optimistic concurrency check
      if (tenant.version !== data.version) {
        throw new AppError('ข้อมูลผู้เช่าถูกแก้ไขโดยผู้อื่นแล้ว กรุณารีเฟรชหน้าจอเพื่อรับข้อมูลล่าสุด', 409, 'RESOURCE_VERSION_CONFLICT');
      }

      // 2. Validate child ownership before mutating
      if (data.emergencyContact?.id) {
        const existingContacts = await txRepo.findEmergencyContacts(tenantId, dormitoryId);
        const found = existingContacts.find((c) => c.id === data.emergencyContact!.id);
        if (!found) {
          throw new AppError('ไม่พบข้อมูลผู้ติดต่อฉุกเฉินที่ระบุ หรือไม่มีสิทธิ์เข้าถึง', 403, 'INVALID_CHILD_OWNERSHIP');
        }
      }

      const submittedVehicles = data.vehicles || [];
      if (submittedVehicles.length > 0) {
        const existingVehicles = await txRepo.findVehicles(tenantId, dormitoryId);
        const existingMap = new Map(existingVehicles.map((v) => [v.id, v]));
        for (const sv of submittedVehicles) {
          if (sv.id && !existingMap.has(sv.id)) {
            throw new AppError('ไม่พบข้อมูลยานพาหนะที่ระบุ หรือไม่มีสิทธิ์เข้าถึง', 403, 'INVALID_CHILD_OWNERSHIP');
          }
        }
      }

      // 3. Server-Authoritative Grandfather Pet Policy Validation
      // Canonical existing pet IDs from current Tenant.petInfo
      const canonicalExistingPetIds = new Set<string>();
      if (Array.isArray(tenant.petInfo)) {
        for (const ep of tenant.petInfo) {
          if (ep?.id && typeof ep.id === 'string' && !ep.id.startsWith('temp-')) {
            canonicalExistingPetIds.add(ep.id);
          }
        }
      } else if (tenant.petInfo?.id && typeof tenant.petInfo.id === 'string' && !tenant.petInfo.id.startsWith('temp-')) {
        canonicalExistingPetIds.add(tenant.petInfo.id);
      }

      // Sanitize submitted pets: strip any unknown / untrusted client IDs
      const sanitizedSubmittedPets = (data.pets || []).map((p) => ({
        ...p,
        id: (p.id && canonicalExistingPetIds.has(p.id)) ? p.id : undefined,
      }));

      const { grandfathered, newOrChanged } = classifySubmittedPets(tenant.petInfo, sanitizedSubmittedPets);

      if (newOrChanged.length > 0) {
        let petPolicy: any;
        try {
          petPolicy = await txRepo.getDormitoryPetPolicy(dormitoryId);
        } catch (policyErr) {
          throw new AppError('ไม่สามารถตรวจสอบนโยบายสัตว์เลี้ยงได้', 500, 'PET_POLICY_UNAVAILABLE');
        }

        if (!petPolicy || !petPolicy.allowed || petPolicy.allowed === 'none') {
          throw new AppError('หอพักมีนโยบายไม่อนุญาตให้เลี้ยงสัตว์', 400, 'PET_NOT_ALLOWED');
        }

        if (petPolicy.allowed === 'conditional') {
          const { allowedCanonicals, allowedRawTerms } = expandAllowedPetPolicyTypes(petPolicy.allowedTypes || []);

          for (const p of newOrChanged) {
            const rawType = (p.type || '').trim().toLowerCase();
            const customType = (p.customType || '').trim().toLowerCase();
            const normKey = normalizePetTypeKey(p);

            const isCustomPet = normKey.startsWith('other:') || normKey === 'other' || rawType === 'other' || rawType === 'อื่นๆ';
            const customValue = normKey.startsWith('other:') ? normKey.slice(6) : customType;

            let isAllowed = false;
            if (isCustomPet) {
              if (allowedRawTerms.has('other') || allowedRawTerms.has('อื่นๆ') || allowedCanonicals.has('other')) {
                isAllowed = true;
              } else if (customValue && (allowedRawTerms.has(customValue) || allowedCanonicals.has(`other:${customValue}`) || allowedCanonicals.has(normKey))) {
                isAllowed = true;
              } else if (allowedCanonicals.has(normKey)) {
                isAllowed = true;
              }
            } else {
              if (allowedCanonicals.has(normKey) || allowedRawTerms.has(rawType)) {
                isAllowed = true;
              }
            }

            if (!isAllowed) {
              throw new AppError(`ประเภทสัตว์เลี้ยง "${p.type}" ไม่อยู่ในรายการที่อนุญาต`, 400, 'PET_TYPE_NOT_ALLOWED');
            }
          }
        } else if (petPolicy.allowed !== 'all') {
          throw new AppError('หอพักมีนโยบายไม่อนุญาตให้เลี้ยงสัตว์', 400, 'PET_NOT_ALLOWED');
        }
      }

      // 4a. Update basic profile using canonical name normalization
      const parsedName = parseAndNormalizeName(data.displayName);
      const updatePayload: Partial<TenantEntity> = {
        displayName: parsedName.displayName,
        firstName: parsedName.firstName,
        lastName: parsedName.lastName,
        phone: data.phone.trim(),
        email: data.email !== undefined ? (data.email?.trim() ? data.email.trim() : null) : undefined,
        petInfo: sanitizedSubmittedPets,
      };

      // Canonical National ID handling
      if (data.nationalId !== undefined && data.nationalId !== null) {
        const trimmed = data.nationalId.trim();
        if (trimmed === '') {
          updatePayload.nationalIdEncrypted = null;
          updatePayload.nationalIdMasked = null;
        } else if (isMaskedNationalId(trimmed) || trimmed === tenant.nationalIdMasked) {
          // Preserve existing encrypted/masked values unchanged
        } else {
          const rawDigits = trimmed.replace(/\D/g, '');
          if (rawDigits.length === 13) {
            updatePayload.nationalIdEncrypted = this.sensitiveFieldService.encrypt(rawDigits).ciphertext;
            updatePayload.nationalIdMasked = this.sensitiveFieldService.maskNationalId(rawDigits);
          }
        }
      }

      const updatedTenant = await txRepo.update(tenantId, dormitoryId, updatePayload, data.version);
      if (!updatedTenant) {
        throw new AppError('ข้อมูลผู้เช่าถูกแก้ไขโดยผู้อื่นแล้ว', 409, 'RESOURCE_VERSION_CONFLICT');
      }

      // 4b. Emergency Contact (create or update, never delete from Edit modal)
      let finalEmergency: any = null;
      if (data.emergencyContact && data.emergencyContact.name?.trim() && data.emergencyContact.phone?.trim()) {
        const eData = {
          name: data.emergencyContact.name.trim(),
          phone: data.emergencyContact.phone.trim(),
          relationship: data.emergencyContact.relationship?.trim() || 'ผู้ติดต่อฉุกเฉิน',
          isPrimary: true,
        };
        if (data.emergencyContact.id) {
          finalEmergency = await txRepo.updateEmergencyContact(data.emergencyContact.id, dormitoryId, eData, tenantId);
        } else {
          const existing = await txRepo.findEmergencyContacts(tenantId, dormitoryId);
          if (existing.length > 0) {
            finalEmergency = await txRepo.updateEmergencyContact(existing[0].id, dormitoryId, eData, tenantId);
          } else {
            finalEmergency = await txRepo.createEmergencyContact(dormitoryId, tenantId, eData);
          }
        }
      }

      // 4c. Vehicles Reconciliation (preserve existing IDs, update in place, delete omitted, create new)
      const currentVehicles = await txRepo.findVehicles(tenantId, dormitoryId);
      const submittedIds = new Set(submittedVehicles.filter((v: any) => v.id).map((v: any) => v.id));

      for (const cv of currentVehicles) {
        if (!submittedIds.has(cv.id)) {
          await txRepo.deleteVehicle(cv.id, dormitoryId, tenantId);
        }
      }

      const finalVehicles: any[] = [];
      for (const sv of submittedVehicles) {
        if (sv.type === 'none') continue;
        if (sv.id) {
          const upd = await txRepo.updateVehicle(sv.id, dormitoryId, {
            type: sv.type,
            licensePlate: sv.licensePlate.trim(),
            brand: sv.brand?.trim() || null,
            model: sv.model?.trim() || null,
            color: sv.color?.trim() || null,
            province: sv.province?.trim() || null,
          }, tenantId);
          if (upd) finalVehicles.push(upd);
        } else {
          const crt = await txRepo.createVehicle(dormitoryId, tenantId, {
            type: sv.type,
            licensePlate: sv.licensePlate.trim(),
            brand: sv.brand?.trim() || null,
            model: sv.model?.trim() || null,
            color: sv.color?.trim() || null,
            province: sv.province?.trim() || null,
          });
          finalVehicles.push(crt);
        }
      }

      return {
        tenant: updatedTenant,
        emergencyContacts: finalEmergency ? [finalEmergency] : [],
        vehicles: finalVehicles,
      };
    });

    if (this.auditService && actorUserId && result?.tenant) {
      try {
        await this.auditService.log({
          userId: actorUserId,
          action: 'TENANT_PROFILE_AGGREGATE_UPDATED',
          source: 'tenant',
          reason: `Aggregated profile update for tenant ${result.tenant.displayName}`,
          ipMetadata: { dormitoryId, tenantId },
        });
      } catch (auditErr) {
        logger.error({ auditErr, tenantId }, '[TenantService] Post-commit audit log failure (fail-soft)');
      }
    }

    return {
      tenant: result.tenant,
      emergencyContacts: result.emergencyContacts,
      vehicles: result.vehicles,
    };
  }
}
