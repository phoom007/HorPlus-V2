import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { Express } from 'express';
import request from '../../server/node_modules/supertest/index.js';
import { TenantService } from '../../server/src/services/tenant.service.js';
import { InMemoryTenantRepository, PrismaTenantRepository } from '../../server/src/db/repositories/tenant.repository.js';
import { InMemoryContractRepository } from '../../server/src/db/repositories/contract.repository.js';
import { SensitiveFieldService } from '../../server/src/services/sensitive-field.service.js';
import { parseAndNormalizeName, isMaskedNationalId } from '../../server/src/utils/thai-identity.util.js';
import { processAndSecureTenantIdCardImage } from '../../server/src/services/image-security.service.js';
import { localStorageProvider } from '../../server/src/services/local-storage.service.js';
import { createTenantRouter } from '../../server/src/routes/tenant.routes.js';
import {
  toTenantApiDTO,
  toCoOccupantApiDTO,
  toTenantDetailsApiDTO,
  toEmergencyContactApiDTO,
  toVehicleApiDTO,
} from '../../server/src/mappers/tenant-api.mapper.js';
import { setPrismaClient } from '../../server/src/db/prisma.js';
import { subscriptionEntitlementService } from '../../server/src/services/subscription-entitlement.service.js';
import { ApiTenantAdapter } from '../data/adapters/api';
import { DemoTenantAdapter } from '../data/adapters/demo';
import { TenantDataSource } from '../data/contracts';
import * as httpClient from '../data/httpClient';

if (typeof localStorage === 'undefined') {
  let store: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, val: string) => { store[key] = String(val); },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
}

/**
 * Pure recursive assertion helper to guarantee that a forbidden sensitive key
 * (such as 'nationalIdEncrypted' or 'idCardObjectKey') does not appear ANYWHERE
 * in a response object tree.
 */
function assertForbiddenKeyAbsent(target: any, forbiddenKey: string, currentPath = '$'): void {
  if (target === null || target === undefined) return;
  if (Array.isArray(target)) {
    target.forEach((item, index) => {
      assertForbiddenKeyAbsent(item, forbiddenKey, `${currentPath}[${index}]`);
    });
    return;
  }
  if (typeof target === 'object') {
    for (const key of Object.keys(target)) {
      if (key === forbiddenKey) {
        throw new Error(`Forbidden key "${forbiddenKey}" found at path "${currentPath}.${key}"`);
      }
      assertForbiddenKeyAbsent(target[key], forbiddenKey, `${currentPath}.${key}`);
    }
  }
}

describe('TENANT PHASE 3 STEP 3B: Backend Security, Persistence & Canonical Profile Mutations', () => {
  const dormId = '00000000-0000-0000-0000-000000000001';
  const otherDormId = '00000000-0000-0000-0000-000000000002';

  function createTestTenantApp(
    tenantService: TenantService,
    options?: {
      permissions?: string[];
      roleCode?: string;
    }
  ): Express {
    const app = express();
    app.use(express.json());

    const mockAuthService: any = {
      verifyCsrf: (token: string, sessionId: string) => {
        return token === 'test-csrf-token' && sessionId === 'sess-test';
      },
      validateSession: async () => ({
        userId: 'user-admin-1',
        dormitoryId: dormId,
        sessionId: 'sess-test',
      }),
    };

    app.use((req, _res, next) => {
      (req as any).auth = {
        userId: 'user-admin-1',
        dormitoryId: dormId,
        sessionId: 'sess-test',
      };
      (req as any).dormitoryContext = {
        dormitoryId: dormId,
        roleCode: options?.roleCode ?? 'OPERATOR',
        permissions: options?.permissions ?? ['tenant:read', 'tenant:write', 'tenant:document:read'],
      };
      req.headers['x-dormitory-id'] = dormId;
      next();
    });

    const router = createTenantRouter(mockAuthService, tenantService);
    app.use('/api/v1/tenants', router);
    return app;
  }

  describe('1. Thai Identity & Full-Name Normalization Utility', () => {
    it('accurately identifies masked national IDs versus raw or invalid strings', () => {
      expect(isMaskedNationalId('1-1004-XXXXX-XX-X')).toBe(true);
      expect(isMaskedNationalId('1-1004-xxxxx-xx-x')).toBe(true);
      expect(isMaskedNationalId('11004XXXXXXXX')).toBe(true);
      expect(isMaskedNationalId('X-XXXX-XXXXX-XX-X')).toBe(true);
      expect(isMaskedNationalId('1-1004-00123-45-6')).toBe(false);
      expect(isMaskedNationalId('1100400123456')).toBe(false);
      expect(isMaskedNationalId('')).toBe(false);
      expect(isMaskedNationalId(null)).toBe(false);
      expect(isMaskedNationalId(undefined)).toBe(false);
    });

    it('parses and normalizes Thai names with honorific prefix removal while strictly preserving displayName', () => {
      // Mr. (นาย)
      const res1 = parseAndNormalizeName('นายสมชาย ใจดี');
      expect(res1.displayName).toBe('นายสมชาย ใจดี');
      expect(res1.firstName).toBe('สมชาย');
      expect(res1.lastName).toBe('ใจดี');

      // Miss (นางสาว / น.ส.)
      const res2 = parseAndNormalizeName('นางสาวสมหญิง รักสงบ');
      expect(res2.displayName).toBe('นางสาวสมหญิง รักสงบ');
      expect(res2.firstName).toBe('สมหญิง');
      expect(res2.lastName).toBe('รักสงบ');

      const res3 = parseAndNormalizeName('น.ส. วิภาวรรณ ชื่นใจ');
      expect(res3.displayName).toBe('น.ส. วิภาวรรณ ชื่นใจ');
      expect(res3.firstName).toBe('วิภาวรรณ');
      expect(res3.lastName).toBe('ชื่นใจ');

      // Polite Khun (คุณ) with spaced prefix
      const res4 = parseAndNormalizeName('คุณ อานนท์ มีสุข');
      expect(res4.displayName).toBe('คุณ อานนท์ มีสุข');
      expect(res4.firstName).toBe('อานนท์');
      expect(res4.lastName).toBe('มีสุข');

      // Single word without last name
      const res5 = parseAndNormalizeName('นายสมชาย');
      expect(res5.displayName).toBe('นายสมชาย');
      expect(res5.firstName).toBe('สมชาย');
      expect(res5.lastName).toBeNull();

      // Collapses extra whitespace
      const res6 = parseAndNormalizeName('   นาย    สมศักดิ์     มั่นคง    ');
      expect(res6.displayName).toBe('นาย สมศักดิ์ มั่นคง');
      expect(res6.firstName).toBe('สมศักดิ์');
      expect(res6.lastName).toBe('มั่นคง');

      // Standard English name without prefix
      const res7 = parseAndNormalizeName('John Doe');
      expect(res7.displayName).toBe('John Doe');
      expect(res7.firstName).toBe('John');
      expect(res7.lastName).toBe('Doe');

      // Mr. with period
      const res8 = parseAndNormalizeName('Mr. John Smith');
      expect(res8.displayName).toBe('Mr. John Smith');
      expect(res8.firstName).toBe('John');
      expect(res8.lastName).toBe('Smith');

      // Dr. with multiple token remainder
      const res9 = parseAndNormalizeName('Dr. John Michael Smith');
      expect(res9.displayName).toBe('Dr. John Michael Smith');
      expect(res9.firstName).toBe('John');
      expect(res9.lastName).toBe('Michael Smith');

      // Latin boundary check: "Drew" must NOT be stripped as "Dr"
      const res10 = parseAndNormalizeName('Drew Smith');
      expect(res10.displayName).toBe('Drew Smith');
      expect(res10.firstName).toBe('Drew');
      expect(res10.lastName).toBe('Smith');

      // Latin boundary check: "Mission" must NOT be stripped as "Miss"
      const res11 = parseAndNormalizeName('Mission Impossible');
      expect(res11.displayName).toBe('Mission Impossible');
      expect(res11.firstName).toBe('Mission');
      expect(res11.lastName).toBe('Impossible');

      // Ambiguous 3+ token Thai name preserves all tokens in displayName
      const res12 = parseAndNormalizeName('นายสมบูรณ์ ชัย ศรีสวัสดิ์');
      expect(res12.displayName).toBe('นายสมบูรณ์ ชัย ศรีสวัสดิ์');
      expect(res12.firstName).toBe('สมบูรณ์');
      expect(res12.lastName).toBe('ชัย ศรีสวัสดิ์');
    });
  });

  describe('2. TenantService: Name Normalization & National ID Overwrite Protection', () => {
    let tenantRepo: InMemoryTenantRepository;
    let contractRepo: InMemoryContractRepository;
    let sensitiveService: SensitiveFieldService;
    let tenantService: TenantService;

    beforeEach(() => {
      tenantRepo = new InMemoryTenantRepository();
      contractRepo = new InMemoryContractRepository();
      sensitiveService = new SensitiveFieldService('12345678901234567890123456789012');
      tenantService = new TenantService(tenantRepo, contractRepo, sensitiveService);
    });

    it('applies name normalization during tenant creation', async () => {
      const tenant = await tenantService.createTenant(dormId, {
        displayName: 'นายประสิทธิ์ พรหมดี',
        phone: '0812345678',
        nationalId: '1100400123456',
      });

      expect(tenant.displayName).toBe('นายประสิทธิ์ พรหมดี');
      expect(tenant.firstName).toBe('ประสิทธิ์');
      expect(tenant.lastName).toBe('พรหมดี');
      expect(tenant.nationalIdMasked).toBe('1-1004-XXXXX-45-6');
      expect(tenant.nationalIdEncrypted).toBeDefined();
    });

    it('protects existing nationalIdEncrypted when updating with a masked string', async () => {
      const tenant = await tenantService.createTenant(dormId, {
        displayName: 'นายประสิทธิ์ พรหมดี',
        phone: '0812345678',
        nationalId: '1100400123456',
      });

      const originalCiphertext = tenant.nationalIdEncrypted;
      const originalMasked = tenant.nationalIdMasked;

      // Update phone and send back the masked National ID (as a typical edit form does)
      const updated = await tenantService.updateTenant(tenant.id, dormId, {
        phone: '0899999999',
        nationalId: originalMasked || '1-1004-XXXXX-45-6',
      });

      expect(updated?.phone).toBe('0899999999');
      expect(updated?.nationalIdEncrypted).toBe(originalCiphertext);
      expect(updated?.nationalIdMasked).toBe(originalMasked);
    });

    it('updates nationalIdEncrypted and nationalIdMasked when provided a new 13-digit string', async () => {
      const tenant = await tenantService.createTenant(dormId, {
        displayName: 'สมศรี มีทรัพย์',
        phone: '0812345678',
        nationalId: '1100400123456',
      });

      const originalCiphertext = tenant.nationalIdEncrypted;

      // Update with new 13-digit ID
      const updated = await tenantService.updateTenant(tenant.id, dormId, {
        nationalId: '1200500987654',
      });

      expect(updated?.nationalIdEncrypted).toBeDefined();
      expect(updated?.nationalIdEncrypted).not.toBe(originalCiphertext);
      expect(updated?.nationalIdMasked).toBe('1-2005-XXXXX-65-4');
    });

    it('clears nationalIdEncrypted and nationalIdMasked when provided an empty string', async () => {
      const tenant = await tenantService.createTenant(dormId, {
        displayName: 'สมปอง ยิ้มแย้ม',
        phone: '0812345678',
        nationalId: '1100400123456',
      });

      const updated = await tenantService.updateTenant(tenant.id, dormId, {
        nationalId: '',
      });

      expect(updated?.nationalIdEncrypted).toBeNull();
      expect(updated?.nationalIdMasked).toBeNull();
    });

    it('preserves nationalId when nationalId is omitted in update payload', async () => {
      const tenant = await tenantService.createTenant(dormId, {
        displayName: 'สมบัติ พูนสุข',
        phone: '0812345678',
        nationalId: '1100400123456',
      });

      const originalCiphertext = tenant.nationalIdEncrypted;
      const originalMasked = tenant.nationalIdMasked;

      const updated = await tenantService.updateTenant(tenant.id, dormId, {
        notes: 'Updated note only',
      });

      expect(updated?.notes).toBe('Updated note only');
      expect(updated?.nationalIdEncrypted).toBe(originalCiphertext);
      expect(updated?.nationalIdMasked).toBe(originalMasked);
    });
  });

  describe('3. Emergency Contact Persistence & Tenant Isolation', () => {
    let tenantRepo: InMemoryTenantRepository;
    let contractRepo: InMemoryContractRepository;
    let sensitiveService: SensitiveFieldService;
    let tenantService: TenantService;

    beforeEach(() => {
      tenantRepo = new InMemoryTenantRepository();
      contractRepo = new InMemoryContractRepository();
      sensitiveService = new SensitiveFieldService('12345678901234567890123456789012');
      tenantService = new TenantService(tenantRepo, contractRepo, sensitiveService);
    });

    it('creates, updates, and deletes emergency contacts with strict ownership check', async () => {
      const tenant = await tenantService.createTenant(dormId, {
        displayName: 'ผู้เช่า ก',
        phone: '0811111111',
      });

      // 1. Create
      const contact = await tenantService.addEmergencyContact(dormId, tenant.id, {
        name: 'มารดา ใจดี',
        relationship: 'Mother',
        phone: '0891112233',
        isPrimary: true,
      });

      expect(contact.id).toBeDefined();
      expect(contact.name).toBe('มารดา ใจดี');

      // 2. Update
      const updated = await tenantService.updateEmergencyContact(dormId, tenant.id, contact.id, {
        name: 'มารดา ใจดีมาก',
        phone: '0894445566',
      });

      expect(updated.name).toBe('มารดา ใจดีมาก');
      expect(updated.phone).toBe('0894445566');

      // 3. Isolation: other tenant cannot update
      const otherTenant = await tenantService.createTenant(dormId, {
        displayName: 'ผู้เช่า ข',
        phone: '0822222222',
      });

      await expect(
        tenantService.updateEmergencyContact(dormId, otherTenant.id, contact.id, { name: 'Hack' })
      ).rejects.toThrow('ไม่พบข้อมูลผู้ติดต่อฉุกเฉินที่ระบุ');

      // 4. Delete
      const deleteResult = await tenantService.deleteEmergencyContact(dormId, tenant.id, contact.id);
      expect(deleteResult.success).toBe(true);

      const remaining = await tenantRepo.findEmergencyContacts(tenant.id, dormId);
      expect(remaining.length).toBe(0);
    });
  });

  describe('4. Vehicle Persistence & Soft Delete Authority', () => {
    let tenantRepo: InMemoryTenantRepository;
    let contractRepo: InMemoryContractRepository;
    let sensitiveService: SensitiveFieldService;
    let tenantService: TenantService;

    beforeEach(() => {
      tenantRepo = new InMemoryTenantRepository();
      contractRepo = new InMemoryContractRepository();
      sensitiveService = new SensitiveFieldService('12345678901234567890123456789012');
      tenantService = new TenantService(tenantRepo, contractRepo, sensitiveService);
    });

    it('creates, updates, and soft-deletes vehicles (excluding deleted from findVehicles)', async () => {
      const tenant = await tenantService.createTenant(dormId, {
        displayName: 'ผู้เช่า ค',
        phone: '0833333333',
      });

      // 1. Create
      const vehicle = await tenantService.addVehicle(dormId, tenant.id, {
        type: 'car',
        licensePlate: 'กข 9999',
        brand: 'Toyota',
        model: 'Corolla',
        color: 'White',
        province: 'กรุงเทพมหานคร',
      });

      expect(vehicle.id).toBeDefined();
      expect(vehicle.licensePlate).toBe('กข 9999');

      // 2. Update
      const updated = await tenantService.updateVehicle(dormId, tenant.id, vehicle.id, {
        color: 'Black',
        licensePlate: 'กข 8888',
      });

      expect(updated.color).toBe('Black');
      expect(updated.licensePlate).toBe('กข 8888');

      // 3. Soft Delete
      const delResult = await tenantService.deleteVehicle(dormId, tenant.id, vehicle.id);
      expect(delResult.success).toBe(true);

      // 4. Verify findVehicles excludes soft-deleted records
      const activeVehicles = await tenantRepo.findVehicles(tenant.id, dormId);
      expect(activeVehicles.find((v) => v.id === vehicle.id)).toBeUndefined();
    });
  });

  describe('5. Canonical Co-Occupant History Authority', () => {
    let tenantRepo: InMemoryTenantRepository;
    let contractRepo: InMemoryContractRepository;
    let sensitiveService: SensitiveFieldService;
    let tenantService: TenantService;

    beforeEach(() => {
      tenantRepo = new InMemoryTenantRepository();
      contractRepo = new InMemoryContractRepository();
      sensitiveService = new SensitiveFieldService('12345678901234567890123456789012');
      tenantService = new TenantService(tenantRepo, contractRepo, sensitiveService);
    });

    it('separates active co-occupants from complete co-occupant history with genuine database timestamps', async () => {
      const tenant = await tenantService.createTenant(dormId, {
        displayName: 'ผู้เช่า หลัก',
        phone: '0844444444',
      });

      // Create dummy active contract to satisfy verifyActiveTenancy
      await contractRepo.create(dormId, {
        tenantId: tenant.id,
        roomId: 'room-101',
        status: 'active',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
      } as any);

      // Add two co-occupants
      const co1 = await tenantService.addCoOccupant(dormId, tenant.id, {
        name: 'ผู้พักร่วม หนึ่ง',
        phone: '0811112222',
        relationship: 'Sibling',
      });

      const co2 = await tenantService.addCoOccupant(dormId, tenant.id, {
        name: 'ผู้พักร่วม สอง',
        phone: '0833334444',
        relationship: 'Friend',
      });

      // Remove co-occupant 1
      await tenantService.removeCoOccupant(dormId, tenant.id, co1.id);

      // Details fetch
      const details = await tenantService.getTenantDetails(tenant.id, dormId);

      // Active list has only co2
      expect(details.coOccupants.length).toBe(1);
      expect(details.coOccupants[0].id).toBe(co2.id);

      // History has both co1 and co2
      expect(details.coOccupantHistory.length).toBe(2);

      const histCo1 = details.coOccupantHistory.find((c: any) => c.id === co1.id);
      const histCo2 = details.coOccupantHistory.find((c: any) => c.id === co2.id);

      expect(histCo1).toBeDefined();
      expect(histCo1.status).toBe('removed');
      expect(histCo1.deletedAt).toBeDefined();
      expect(histCo1.createdAt).toBeDefined();

      expect(histCo2).toBeDefined();
      expect(histCo2.status).toBe('active');
      expect(histCo2.deletedAt).toBeNull();
    });
  });

  describe('6. Image Security: ID Card Validation and Sharp Processing', () => {
    it('rejects non-image payloads (e.g. PDF, SVG, HTML) fail-fast', async () => {
      const pdfBuffer = Buffer.from('%PDF-1.4 header attack content');
      await expect(processAndSecureTenantIdCardImage(pdfBuffer)).rejects.toThrow(
        'Unsupported or invalid image format'
      );

      const svgBuffer = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
      await expect(processAndSecureTenantIdCardImage(svgBuffer)).rejects.toThrow(
        'Unsupported or invalid image format'
      );

      const htmlBuffer = Buffer.from('<html><script>evil()</script></html>');
      await expect(processAndSecureTenantIdCardImage(htmlBuffer)).rejects.toThrow(
        'Unsupported or invalid image format'
      );
    });

    it('rejects payloads exceeding 5 MB limit', async () => {
      const oversizedBuffer = Buffer.alloc(5 * 1024 * 1024 + 10);
      await expect(processAndSecureTenantIdCardImage(oversizedBuffer)).rejects.toThrow(
        'Image file size exceeds maximum limit of 5 MB'
      );
    });
  });

  describe('7. Data Adapters: ApiTenantAdapter & DemoTenantAdapter Alignment', () => {
    it('ApiTenantAdapter routes emergency contact and vehicle mutations properly', async () => {
      const httpSpy = vi.spyOn(httpClient, 'httpRequest').mockResolvedValue({ success: true } as any);
      const apiAdapter = new ApiTenantAdapter();

      // Emergency contact update & delete
      await apiAdapter.updateEmergencyContact('t-1', 'ec-1', { name: 'Parent Updated' });
      expect(httpSpy).toHaveBeenCalledWith('PUT', '/tenants/t-1/emergency-contacts/ec-1', { name: 'Parent Updated' });

      await apiAdapter.deleteEmergencyContact('t-1', 'ec-1');
      expect(httpSpy).toHaveBeenCalledWith('DELETE', '/tenants/t-1/emergency-contacts/ec-1');

      // Vehicle update & delete
      await apiAdapter.updateVehicle('t-1', 'veh-1', { brand: 'Mazda' });
      expect(httpSpy).toHaveBeenCalledWith('PUT', '/tenants/t-1/vehicles/veh-1', { brand: 'Mazda' });

      await apiAdapter.deleteVehicle('t-1', 'veh-1');
      expect(httpSpy).toHaveBeenCalledWith('DELETE', '/tenants/t-1/vehicles/veh-1');

      httpSpy.mockRestore();
    });

    it('ApiTenantAdapter maps coOccupantHistory in getTenantProfile', async () => {
      const mockProfileResponse = {
        data: {
          tenant: { id: 't-1', name: 'Somchai' },
          coOccupants: [{ id: 'co-2', name: 'Active' }],
          coOccupantHistory: [
            { id: 'co-1', name: 'Removed', status: 'removed' },
            { id: 'co-2', name: 'Active', status: 'active' },
          ],
          emergencyContacts: [],
          vehicles: [],
          contracts: [],
          occupancies: [],
          dailyStays: [],
          bills: [],
          settlements: [],
        },
      };

      const httpSpy = vi.spyOn(httpClient, 'httpRequest').mockResolvedValue(mockProfileResponse as any);
      const apiAdapter = new ApiTenantAdapter();

      const res = await apiAdapter.getTenantProfile('t-1');
      expect(res.success).toBe(true);
      expect(res.data?.coOccupantHistory?.length).toBe(2);
      expect(res.data?.coOccupants.length).toBe(1);

      httpSpy.mockRestore();
    });

    it('DemoTenantAdapter supports update/delete emergency contacts, vehicles, and coOccupantHistory', async () => {
      const demoAdapter = new DemoTenantAdapter();
      const all = await demoAdapter.getAll();
      const firstTenant = all[0];
      expect(firstTenant).toBeDefined();

      // Update emergency contact
      const ecRes = await demoAdapter.updateEmergencyContact(firstTenant.id, 'ec-1', { name: 'New Contact' });
      expect(ecRes.success).toBe(true);

      // Delete emergency contact
      const delEcRes = await demoAdapter.deleteEmergencyContact(firstTenant.id, 'ec-1');
      expect(delEcRes.success).toBe(true);

      // Add & Update & Delete vehicle
      const addVeh = await demoAdapter.addVehicle(firstTenant.id, {
        type: 'car',
        licensePlate: 'กก 111',
      });
      expect(addVeh.success).toBe(true);

      const updVeh = await demoAdapter.updateVehicle(firstTenant.id, addVeh.data.id, {
        licensePlate: 'กก 222',
      });
      expect(updVeh.success).toBe(true);
      expect(updVeh.data.licensePlate).toBe('กก 222');

      const delVeh = await demoAdapter.deleteVehicle(firstTenant.id, addVeh.data.id);
      expect(delVeh.success).toBe(true);

      // Profile details includes coOccupantHistory
      const profile = await demoAdapter.getTenantProfile(firstTenant.id);
      expect(profile.success).toBe(true);
      expect(profile.data?.coOccupantHistory).toBeDefined();
    });

    it('ApiTenantAdapter.addTenant and updateTenant send displayName without client-side name splitting', async () => {
      const httpSpy = vi.spyOn(httpClient, 'httpRequest').mockResolvedValue({ success: true } as any);
      const apiAdapter = new ApiTenantAdapter();

      await apiAdapter.addTenant({
        name: 'นายสมชาย ใจดี',
        phone: '0812345678',
        dormitoryId: dormId,
        status: 'active',
      } as any);

      expect(httpSpy).toHaveBeenCalledWith(
        'POST',
        '/tenants',
        expect.objectContaining({
          displayName: 'นายสมชาย ใจดี',
        })
      );
      const postPayload = httpSpy.mock.calls[0][2] as any;
      expect(postPayload.firstName).toBeUndefined();
      expect(postPayload.lastName).toBeUndefined();

      await apiAdapter.updateTenant({
        id: 't-1',
        name: 'Dr. John Michael Smith',
        phone: '0812345678',
        dormitoryId: dormId,
        status: 'active',
      } as any);

      expect(httpSpy).toHaveBeenCalledWith(
        'PUT',
        '/tenants/t-1',
        expect.objectContaining({
          displayName: 'Dr. John Michael Smith',
        })
      );
      const putPayload = httpSpy.mock.calls[1][2] as any;
      expect(putPayload.firstName).toBeUndefined();
      expect(putPayload.lastName).toBeUndefined();

      httpSpy.mockRestore();
    });

    it('both ApiTenantAdapter and DemoTenantAdapter satisfy required TenantDataSource contract methods', () => {
      const apiAdapter: TenantDataSource = new ApiTenantAdapter();
      const demoAdapter: TenantDataSource = new DemoTenantAdapter();

      expect(typeof apiAdapter.updateEmergencyContact).toBe('function');
      expect(typeof apiAdapter.deleteEmergencyContact).toBe('function');
      expect(typeof apiAdapter.updateVehicle).toBe('function');
      expect(typeof apiAdapter.deleteVehicle).toBe('function');
      expect(typeof apiAdapter.uploadIdentityDocument).toBe('function');
      expect(typeof apiAdapter.getTenantProfile).toBe('function');

      expect(typeof demoAdapter.updateEmergencyContact).toBe('function');
      expect(typeof demoAdapter.deleteEmergencyContact).toBe('function');
      expect(typeof demoAdapter.updateVehicle).toBe('function');
      expect(typeof demoAdapter.deleteVehicle).toBe('function');
      expect(typeof demoAdapter.uploadIdentityDocument).toBe('function');
      expect(typeof demoAdapter.getTenantProfile).toBe('function');
    });
  });

  describe('8. Safe Tenant DTO & Sensitive Field Leakage Prevention', () => {
    it('uses production DTO mappers to strictly omit sensitive fields and internal keys recursively', () => {
      // Simulate raw database entity containing encrypted ciphertext and internal document metadata
      const rawTenantDetails = {
        tenant: {
          id: 't-sec-1',
          dormitoryId: dormId,
          tenantNumber: 'T001',
          displayName: 'นายความ ปลอดภัย',
          firstName: 'ความ',
          lastName: 'ปลอดภัย',
          nationalIdEncrypted: 'iv:authtag:encrypted1234567890',
          nationalIdMasked: '1-1004-XXXXX-45-6',
          idCardObjectKey: 'tenants/dorm-1/t-sec-1/id-card-1234.webp',
          idCardUploadedByUserId: 'admin-user-secret-id',
          idCardUploadedAt: new Date('2026-09-01T10:00:00Z'),
          idCardMimeType: 'image/webp',
          idCardByteSize: 2048,
          idCardSha256: 'sha256-sample-hash',
          status: 'active',
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          coOccupants: [
            {
              id: 'co-nested-1',
              tenantId: 't-sec-1',
              name: 'ผู้พักร่วม เนสท์',
              nationalIdEncrypted: 'iv:authtag:nestedciphertext',
              nationalIdMasked: '1-1111-XXXXX-11-1',
              status: 'active',
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
        },
        coOccupants: [
          {
            id: 'co-1',
            tenantId: 't-sec-1',
            name: 'ผู้พักร่วม 1',
            nationalIdEncrypted: 'iv:authtag:secretco1',
            nationalIdMasked: '1-2005-XXXXX-12-3',
            status: 'active',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        coOccupantHistory: [
          {
            id: 'co-1',
            tenantId: 't-sec-1',
            name: 'ผู้พักร่วม 1',
            nationalIdEncrypted: 'iv:authtag:secretco1',
            nationalIdMasked: '1-2005-XXXXX-12-3',
            status: 'active',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            id: 'co-2',
            tenantId: 't-sec-1',
            name: 'ผู้พักร่วม 2 เก่า',
            nationalIdEncrypted: 'iv:authtag:secretco2',
            nationalIdMasked: '1-3006-XXXXX-45-6',
            status: 'removed',
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: new Date(),
          },
        ],
        emergencyContacts: [
          {
            id: 'ec-1',
            tenantId: 't-sec-1',
            name: 'ผู้ติดต่อ',
            phone: '0812345678',
            relationship: 'บิดา',
          },
        ],
        vehicles: [
          {
            id: 'veh-1',
            tenantId: 't-sec-1',
            type: 'car',
            licensePlate: 'กข 1234',
          },
        ],
        contracts: [],
        occupancies: [],
        dailyStays: [],
        bills: [],
        settlements: [],
      };

      // Test production mapper directly (NOT a duplicate local implementation)
      const safeResponse = toTenantDetailsApiDTO(rawTenantDetails);
      expect(safeResponse).toBeDefined();

      // Recursive key absence assertions
      assertForbiddenKeyAbsent(safeResponse, 'nationalIdEncrypted');
      assertForbiddenKeyAbsent(safeResponse, 'idCardObjectKey');
      assertForbiddenKeyAbsent(safeResponse, 'idCardUploadedByUserId');

      // Presentation metadata preserved safely
      expect(safeResponse?.tenant?.hasIdentityDocument).toBe(true);
      expect(safeResponse?.tenant?.idCardUploadedAt).toBeDefined();
      expect(safeResponse?.tenant?.idCardMimeType).toBe('image/webp');
      expect(safeResponse?.tenant?.idCardSha256).toBe('sha256-sample-hash');
      expect(safeResponse?.tenant?.nationalIdMasked).toBe('1-1004-XXXXX-45-6');

      // Nested relations sanitized
      expect(safeResponse?.tenant?.coOccupants?.[0]?.nationalIdMasked).toBe('1-1111-XXXXX-11-1');
      expect(safeResponse?.coOccupants?.[0]?.nationalIdMasked).toBe('1-2005-XXXXX-12-3');
      expect(safeResponse?.coOccupantHistory?.[1]?.nationalIdMasked).toBe('1-3006-XXXXX-45-6');

      // Ensure no raw ciphertext leakage across serialized JSON
      const serialized = JSON.stringify(safeResponse);
      expect(serialized).not.toContain('encrypted1234567890');
      expect(serialized).not.toContain('nestedciphertext');
      expect(serialized).not.toContain('secretco1');
      expect(serialized).not.toContain('secretco2');
      expect(serialized).not.toContain('admin-user-secret-id');
      expect(serialized).not.toContain('id-card-1234.webp');
    });

    it('toTenantApiDTO, toCoOccupantApiDTO, toEmergencyContactApiDTO, and toVehicleApiDTO strictly filter fields', () => {
      const rawTenant = {
        id: 't-1',
        dormitoryId: dormId,
        tenantNumber: 'T-01',
        firstName: 'สมชาย',
        lastName: 'ใจดี',
        displayName: 'สมชาย ใจดี',
        nationalIdEncrypted: 'sensitive-enc-1',
        idCardObjectKey: 'path/to/key.webp',
        idCardUploadedByUserId: 'u-1',
      };
      const safeTenant = toTenantApiDTO(rawTenant);
      assertForbiddenKeyAbsent(safeTenant, 'nationalIdEncrypted');
      assertForbiddenKeyAbsent(safeTenant, 'idCardObjectKey');
      assertForbiddenKeyAbsent(safeTenant, 'idCardUploadedByUserId');

      const rawCo = {
        id: 'co-1',
        tenantId: 't-1',
        name: 'Co',
        nationalIdEncrypted: 'sensitive-co-enc',
        nationalIdMasked: '1-2345-XXXXX-67-8',
      };
      const safeCo = toCoOccupantApiDTO(rawCo);
      assertForbiddenKeyAbsent(safeCo, 'nationalIdEncrypted');

      const rawEc = {
        id: 'ec-1',
        tenantId: 't-1',
        name: 'Contact',
        phone: '0812345678',
        relation: 'พี่สาว',
        internalAuditNote: 'do not leak',
      };
      const safeEc = toEmergencyContactApiDTO(rawEc);
      expect((safeEc as any).internalAuditNote).toBeUndefined();

      const rawVeh = {
        id: 'v-1',
        tenantId: 't-1',
        type: 'motorcycle',
        licensePlate: '1กก 1234',
        internalTrackerId: 'gps-999',
      };
      const safeVeh = toVehicleApiDTO(rawVeh);
      expect((safeVeh as any).internalTrackerId).toBeUndefined();
    });
  });

  describe('9. PrismaTenantRepository Query Clauses & Multi-Tenant Isolation', () => {
    it('enforces deletedAt null check and multi-tenant parameters on Prisma repository', async () => {
      const mockPrisma = {
        tenantCoOccupant: {
          findMany: vi.fn().mockResolvedValue([
            { id: 'co-1', name: 'Co 1', createdAt: new Date(), deletedAt: null, status: 'active' },
            { id: 'co-2', name: 'Co 2', createdAt: new Date(), deletedAt: new Date(), status: 'removed' },
          ]),
        },
        tenantEmergencyContact: {
          findFirst: vi.fn().mockResolvedValue({ id: 'ec-1', dormitoryId: dormId, tenantId: 't-1', name: 'Contact' }),
          update: vi.fn().mockResolvedValue({ id: 'ec-1', dormitoryId: dormId, tenantId: 't-1', name: 'Updated Contact' }),
          delete: vi.fn().mockResolvedValue({ id: 'ec-1' }),
        },
        tenantVehicle: {
          findMany: vi.fn().mockResolvedValue([]),
          findFirst: vi.fn().mockResolvedValue({ id: 'v-1', dormitoryId: dormId, tenantId: 't-1', licensePlate: 'กข 1' }),
          update: vi.fn().mockResolvedValue({ id: 'v-1', dormitoryId: dormId, tenantId: 't-1', status: 'inactive' }),
        },
      };

      const prismaRepo = new PrismaTenantRepository(mockPrisma as any);

      // 1. findCoOccupantHistory includes both active and removed
      const history = await prismaRepo.findCoOccupantHistory('t-1', dormId);
      expect(mockPrisma.tenantCoOccupant.findMany).toHaveBeenCalledWith({
        where: { tenantId: 't-1', dormitoryId: dormId },
        orderBy: { createdAt: 'asc' },
      });
      expect(history.length).toBe(2);

      // 2. updateEmergencyContact enforces dormitoryId and tenantId
      await prismaRepo.updateEmergencyContact('ec-1', dormId, { name: 'Updated Contact' }, 't-1');
      expect(mockPrisma.tenantEmergencyContact.findFirst).toHaveBeenCalledWith({
        where: { id: 'ec-1', dormitoryId: dormId, tenantId: 't-1' },
      });

      // 3. deleteEmergencyContact enforces dormitoryId and tenantId
      await prismaRepo.deleteEmergencyContact('ec-1', dormId, 't-1');
      expect(mockPrisma.tenantEmergencyContact.findFirst).toHaveBeenCalledWith({
        where: { id: 'ec-1', dormitoryId: dormId, tenantId: 't-1' },
      });

      // 4. findVehicles enforces deletedAt: null
      await prismaRepo.findVehicles('t-1', dormId);
      expect(mockPrisma.tenantVehicle.findMany).toHaveBeenCalledWith({
        where: { tenantId: 't-1', dormitoryId: dormId, deletedAt: null },
        orderBy: { createdAt: 'asc' },
      });

      // 5. deleteVehicle soft-deletes with status: inactive and deletedAt
      await prismaRepo.deleteVehicle('v-1', dormId, 't-1');
      expect(mockPrisma.tenantVehicle.findFirst).toHaveBeenCalledWith({
        where: { id: 'v-1', dormitoryId: dormId, deletedAt: null, tenantId: 't-1' },
      });
      expect(mockPrisma.tenantVehicle.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'v-1' },
          data: expect.objectContaining({ status: 'inactive', deletedAt: expect.any(Date) }),
        })
      );
    });
  });

  describe('10. Identity Document Upload & Storage Pipeline in TenantService', () => {
    it('persists processed ID document, updates metadata, and returns safe response without path exposure', async () => {
      const tenantRepo = new InMemoryTenantRepository();
      const contractRepo = new InMemoryContractRepository();
      const sensitiveService = new SensitiveFieldService('12345678901234567890123456789012');
      const tenantService = new TenantService(tenantRepo, contractRepo, sensitiveService);

      const tenant = await tenantService.createTenant(dormId, {
        displayName: 'เอกสาร ผู้เช่า',
        phone: '0855555555',
      });

      // Valid 1x1 test PNG buffer
      const samplePng = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      );

      const result = await tenantService.updateTenantIdentityDocument(dormId, tenant.id, samplePng, 'user-admin-1');

      expect(result.tenantId).toBe(tenant.id);
      expect(result.idCardMimeType).toBe('image/webp');
      expect(result.idCardSha256).toBeDefined();
      expect(result.idCardByteSize).toBeGreaterThan(0);
      expect(result.idCardUploadedAt).toBeDefined();

      // Ensure no raw filesystem path is exposed in return data
      expect((result as any).idCardObjectKey).toBeUndefined();
      expect((result as any).localPath).toBeUndefined();
      expect((result as any).filePath).toBeUndefined();

      // Check tenant entity in repository has metadata updated
      const updatedTenant = await tenantRepo.findById(tenant.id, dormId);
      expect(updatedTenant?.idCardObjectKey).toContain(`tenants/${dormId}/${tenant.id}/`);
      expect(updatedTenant?.idCardSha256).toBe(result.idCardSha256);
      expect(updatedTenant?.idCardMimeType).toBe('image/webp');
    });
  });

  describe('11. Real HTTP Route Security & Safe Response Verification', () => {
    let app: Express;
    let tenantRepo: InMemoryTenantRepository;
    let contractRepo: InMemoryContractRepository;
    let sensitiveService: SensitiveFieldService;
    let tenantService: TenantService;

    beforeEach(async () => {
      tenantRepo = new InMemoryTenantRepository();
      contractRepo = new InMemoryContractRepository();
      sensitiveService = new SensitiveFieldService('12345678901234567890123456789012');
      tenantService = new TenantService(tenantRepo, contractRepo, sensitiveService);
      vi.spyOn(subscriptionEntitlementService, 'assertDormitoryWritable').mockResolvedValue(undefined as any);
      app = createTestTenantApp(tenantService);
    });

    it('GET /api/v1/tenants sanitizes list responses against nationalIdEncrypted and idCardObjectKey', async () => {
      const tenant = await tenantService.createTenant(dormId, {
        displayName: 'นายวิชัย สดใส',
        phone: '0811111111',
        nationalId: '1100400123456',
      });
      // Simulate ID card uploaded
      await tenantRepo.update(tenant.id, dormId, {
        idCardObjectKey: `tenants/${dormId}/${tenant.id}/sample.webp`,
      });

      const res = await request(app).get('/api/v1/tenants');
      expect(res.status).toBe(200);
      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.data.length).toBeGreaterThan(0);

      assertForbiddenKeyAbsent(res.body, 'nationalIdEncrypted');
      assertForbiddenKeyAbsent(res.body, 'idCardObjectKey');
      assertForbiddenKeyAbsent(res.body, 'idCardUploadedByUserId');
    });

    it('GET /api/v1/tenants/:id sanitizes profile details against nationalIdEncrypted and idCardObjectKey', async () => {
      const tenant = await tenantService.createTenant(dormId, {
        displayName: 'น.ส. สุภาภรณ์ งามตา',
        phone: '0822222222',
        nationalId: '1200500987654',
      });
      await tenantRepo.update(tenant.id, dormId, {
        idCardObjectKey: `tenants/${dormId}/${tenant.id}/idcard.webp`,
        idCardUploadedByUserId: 'admin-actor-secret',
      });
      await contractRepo.create(dormId, {
        tenantId: tenant.id,
        roomId: '00000000-0000-0000-0000-000000000099',
        contractNumber: 'CNT-001',
        status: 'active',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        monthlyRent: '5000',
        depositAmount: '10000',
      });
      await tenantService.addCoOccupant(dormId, tenant.id, {
        name: 'ผู้พักร่วม สุภาภรณ์',
        phone: '0833333333',
        nationalId: '1300600112233',
      });

      const res = await request(app).get(`/api/v1/tenants/${tenant.id}`);
      expect(res.status).toBe(200);
      expect(res.body.data.tenant).toBeDefined();

      assertForbiddenKeyAbsent(res.body, 'nationalIdEncrypted');
      assertForbiddenKeyAbsent(res.body, 'idCardObjectKey');
      assertForbiddenKeyAbsent(res.body, 'idCardUploadedByUserId');
      expect(res.body.data.tenant.hasIdentityDocument).toBe(true);
    });

    it('POST /api/v1/tenants sanitizes create responses against nationalIdEncrypted', async () => {
      const res = await request(app)
        .post('/api/v1/tenants')
        .set('x-csrf-token', 'test-csrf-token')
        .send({
          displayName: 'นายสมบัติ เจริญสุข',
          phone: '0844444444',
          nationalId: '1400700223344',
        });

      expect(res.status).toBe(201);
      assertForbiddenKeyAbsent(res.body, 'nationalIdEncrypted');
      assertForbiddenKeyAbsent(res.body, 'idCardObjectKey');
    });

    it('PUT /api/v1/tenants/:id sanitizes update responses against nationalIdEncrypted', async () => {
      const tenant = await tenantService.createTenant(dormId, {
        displayName: 'นายอนันต์ มั่นคง',
        phone: '0855555555',
        nationalId: '1500800334455',
      });

      const res = await request(app)
        .put(`/api/v1/tenants/${tenant.id}`)
        .set('x-csrf-token', 'test-csrf-token')
        .send({
          phone: '0899999999',
        });

      expect(res.status).toBe(200);
      assertForbiddenKeyAbsent(res.body, 'nationalIdEncrypted');
      assertForbiddenKeyAbsent(res.body, 'idCardObjectKey');
    });
  });

  describe('12. Identity Document Upload Middleware Ordering & Multipart Limits', () => {
    let tenantRepo: InMemoryTenantRepository;
    let contractRepo: InMemoryContractRepository;
    let sensitiveService: SensitiveFieldService;
    let tenantService: TenantService;
    let tenant: any;
    const samplePng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );

    beforeEach(async () => {
      tenantRepo = new InMemoryTenantRepository();
      contractRepo = new InMemoryContractRepository();
      sensitiveService = new SensitiveFieldService('12345678901234567890123456789012');
      tenantService = new TenantService(tenantRepo, contractRepo, sensitiveService);
      vi.spyOn(subscriptionEntitlementService, 'assertDormitoryWritable').mockResolvedValue(undefined as any);
      tenant = await tenantService.createTenant(dormId, {
        displayName: 'ผู้เช่า เอกสาร อัปโหลด',
        phone: '0866666666',
      });
    });

    it('rejects user without tenant:write BEFORE file processing occurs', async () => {
      const unauthorizedApp = createTestTenantApp(tenantService, {
        permissions: ['tenant:read'], // missing tenant:write
      });

      const res = await request(unauthorizedApp)
        .post(`/api/v1/tenants/${tenant.id}/identity-document`)
        .set('x-csrf-token', 'test-csrf-token')
        .attach('file', samplePng, 'test.png');

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects unexpected field name with canonical error INVALID_FILE_FIELD', async () => {
      const app = createTestTenantApp(tenantService);

      const res = await request(app)
        .post(`/api/v1/tenants/${tenant.id}/identity-document`)
        .set('x-csrf-token', 'test-csrf-token')
        .attach('wrongField', samplePng, 'test.png');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_FILE_FIELD');
    });

    it('rejects multiple files with canonical error INVALID_FILE_FIELD', async () => {
      const app = createTestTenantApp(tenantService);

      const res = await request(app)
        .post(`/api/v1/tenants/${tenant.id}/identity-document`)
        .set('x-csrf-token', 'test-csrf-token')
        .attach('file', samplePng, 'first.png')
        .attach('file', samplePng, 'second.png');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_FILE_FIELD');
    });

    it('rejects file exceeding 5MB limit with canonical error FILE_TOO_LARGE', async () => {
      const app = createTestTenantApp(tenantService);
      const oversizedBuffer = Buffer.alloc(5 * 1024 * 1024 + 1024);

      const res = await request(app)
        .post(`/api/v1/tenants/${tenant.id}/identity-document`)
        .set('x-csrf-token', 'test-csrf-token')
        .attach('file', oversizedBuffer, 'too-large.png');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('FILE_TOO_LARGE');
    });

    it('accepts valid single image, updates metadata, and strictly omits idCardObjectKey from response', async () => {
      const app = createTestTenantApp(tenantService);

      const res = await request(app)
        .post(`/api/v1/tenants/${tenant.id}/identity-document`)
        .set('x-csrf-token', 'test-csrf-token')
        .attach('file', samplePng, 'id-card.png');

      expect(res.status).toBe(200);
      expect(res.body.data.tenantId).toBe(tenant.id);
      expect(res.body.data.hasIdentityDocument).toBe(true);
      expect(res.body.data.idCardMimeType).toBe('image/webp');
      expect(res.body.data.idCardSha256).toBeDefined();

      // Ensure idCardObjectKey is NOT exposed in HTTP response
      assertForbiddenKeyAbsent(res.body, 'idCardObjectKey');
      assertForbiddenKeyAbsent(res.body, 'idCardUploadedByUserId');
    });
  });

  describe('13. Authoritative Database Error Fail-Closed Behavior', () => {
    it('propagates authoritative database errors in getTenantDetails instead of silently returning empty aggregates', async () => {
      const mockPrisma = {
        occupancy: {
          findMany: vi.fn().mockRejectedValue(new Error('Prisma database connection failure')),
        },
      };

      setPrismaClient(mockPrisma as any);

      const tenantRepo = new InMemoryTenantRepository();
      const contractRepo = new InMemoryContractRepository();
      const sensitiveService = new SensitiveFieldService('12345678901234567890123456789012');
      const tenantService = new TenantService(tenantRepo, contractRepo, sensitiveService);

      const tenant = await tenantService.createTenant(dormId, {
        displayName: 'สมศักดิ์ มั่นคง',
        phone: '0812345678',
      });

      // Directly calling tenantService.getTenantDetails must throw the database error
      await expect(tenantService.getTenantDetails(tenant.id, dormId)).rejects.toThrow(
        'Prisma database connection failure'
      );

      // And through the HTTP route, it must return a 500 TENANT_OPERATION_FAILED, NOT 200 with empty arrays
      const app = createTestTenantApp(tenantService);
      const res = await request(app).get(`/api/v1/tenants/${tenant.id}`);

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('TENANT_OPERATION_FAILED');

      setPrismaClient(null);
    });
  });
});
