import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TenantService } from '../../server/src/services/tenant.service.js';
import { InMemoryTenantRepository, PrismaTenantRepository } from '../../server/src/db/repositories/tenant.repository.js';
import { InMemoryContractRepository } from '../../server/src/db/repositories/contract.repository.js';
import { SensitiveFieldService } from '../../server/src/services/sensitive-field.service.js';
import { ApiTenantAdapter, fetchTenantProfile } from '../data/adapters/api';
import { DemoTenantAdapter } from '../data/adapters/demo';
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

describe('TENANT PHASE 3 STEP 2: Backend API & Adapter Alignment', () => {
  const dormId = '00000000-0000-0000-0000-000000000001';

  describe('1. TenantService.getTenantDetails authoritative domain sources', () => {
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

    it('returns tenant profile composite with all authoritative domain arrays', async () => {
      const tenant = await tenantService.createTenant(dormId, {
        firstName: 'Somchai',
        lastName: 'Dee',
        phone: '0812345678',
        email: 'somchai@example.com',
        address: '123 Sukhumvit Rd, Bangkok',
        gender: 'male',
        notes: 'VIP Tenant',
        petInfo: [{ type: 'cat', name: 'Milo' }],
      });

      // Add emergency contact and vehicle
      await tenantRepo.createEmergencyContact(dormId, tenant.id, {
        name: 'Somsri Dee',
        relationship: 'Mother',
        phone: '0899999999',
      });
      await tenantRepo.createVehicle(dormId, tenant.id, {
        type: 'car',
        licensePlate: 'กข 1234',
        brand: 'Honda',
      });

      const details = await tenantService.getTenantDetails(tenant.id, dormId);

      // Verify all authoritative root keys exist
      expect(details).toHaveProperty('tenant');
      expect(details).toHaveProperty('coOccupants');
      expect(details).toHaveProperty('emergencyContacts');
      expect(details).toHaveProperty('vehicles');
      expect(details).toHaveProperty('contracts');
      expect(details).toHaveProperty('occupancies');
      expect(details).toHaveProperty('dailyStays');
      expect(details).toHaveProperty('bills');
      expect(details).toHaveProperty('settlements');

      // Verify tenant identity and profile fields
      expect(details.tenant.id).toBe(tenant.id);
      expect(details.tenant.firstName).toBe('Somchai');
      expect(details.tenant.address).toBe('123 Sukhumvit Rd, Bangkok');
      expect(details.tenant.notes).toBe('VIP Tenant');
      expect(details.emergencyContacts.length).toBe(1);
      expect(details.vehicles.length).toBe(1);
      expect(Array.isArray(details.occupancies)).toBe(true);
      expect(Array.isArray(details.dailyStays)).toBe(true);
      expect(Array.isArray(details.bills)).toBe(true);
      expect(Array.isArray(details.settlements)).toBe(true);
    });

    it('gracefully handles mock / uninitialized database returning empty arrays for extended sources', async () => {
      const tenant = await tenantService.createTenant(dormId, {
        firstName: 'NoPrisma',
        phone: '0800000000',
      });

      const details = await tenantService.getTenantDetails(tenant.id, dormId);
      expect(details.occupancies).toEqual([]);
      expect(details.dailyStays).toEqual([]);
      expect(details.bills).toEqual([]);
      expect(details.settlements).toEqual([]);
    });
  });

  describe('2. PrismaTenantRepository update field persistence & mapping', () => {
    it('persists address, gender, dateOfBirth, photoUrl, petInfo, and notes on update', async () => {
      const targetTenantId = '11111111-1111-1111-1111-111111111111';
      const mockUpdatedTenant = {
        id: targetTenantId,
        dormitoryId: dormId,
        linkedUserId: null,
        tenantNumber: 'T000123',
        firstName: 'Anan',
        lastName: 'Suk',
        displayName: 'Anan Suk',
        phone: '0811111111',
        email: 'anan@test.com',
        nationalIdEncrypted: 'enc-123',
        nationalIdMasked: '1-XXXX-XXXXX-12-3',
        dateOfBirth: new Date('1995-05-15'),
        gender: 'male',
        address: '456 Phahonyothin Rd',
        photoUrl: 'https://example.com/avatar.jpg',
        petInfo: [{ type: 'dog', name: 'Lucky' }],
        notes: 'Quiet resident',
        status: 'active',
        version: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
        coOccupants: [],
        vehicles: [],
      };

      let capturedUpdateData: any = null;
      const mockPrisma: any = {
        tenant: {
          findFirst: vi.fn().mockResolvedValue({ ...mockUpdatedTenant, version: 1 }),
          update: vi.fn().mockImplementation(({ data }: any) => {
            capturedUpdateData = data;
            return Promise.resolve(mockUpdatedTenant);
          }),
        },
      };

      const repo = new PrismaTenantRepository(mockPrisma);
      const updated = await repo.update(targetTenantId, dormId, {
        address: '456 Phahonyothin Rd',
        gender: 'male',
        notes: 'Quiet resident',
        photoUrl: 'https://example.com/avatar.jpg',
        petInfo: [{ type: 'dog', name: 'Lucky' }],
      });

      // Verify repository passed all profile fields to prisma.tenant.update
      expect(capturedUpdateData.address).toBe('456 Phahonyothin Rd');
      expect(capturedUpdateData.gender).toBe('male');
      expect(capturedUpdateData.notes).toBe('Quiet resident');
      expect(capturedUpdateData.photoUrl).toBe('https://example.com/avatar.jpg');
      expect(capturedUpdateData.petInfo).toEqual([{ type: 'dog', name: 'Lucky' }]);

      // Verify mapTenantToEntity returned all fields
      expect(updated).not.toBeNull();
      expect(updated?.address).toBe('456 Phahonyothin Rd');
      expect(updated?.photoUrl).toBe('https://example.com/avatar.jpg');
      expect(updated?.petInfo).toEqual([{ type: 'dog', name: 'Lucky' }]);
      expect(updated?.notes).toBe('Quiet resident');
    });
  });

  describe('3. ApiTenantAdapter & fetchTenantProfile frontend alignment', () => {
    it('ApiTenantAdapter.getTenantProfile unwraps and structures composite profile payload', async () => {
      const mockApiResponse = {
        data: {
          tenant: {
            id: 't-api-1',
            name: 'Wichai Meesook',
            phone: '0855555555',
            email: 'wichai@example.com',
            citizenId: '1234567890123',
            status: 'active',
          },
          coOccupants: [{ id: 'co-1', name: 'Manee Meesook', relationship: 'Daughter' }],
          emergencyContacts: [{ id: 'ec-1', name: 'Mana Meesook', relationship: 'Brother', phone: '0866666666' }],
          vehicles: [{ id: 'v-1', type: 'motorcycle', licensePlate: '1กข 9999' }],
          contracts: [{ id: 'c-1', contractNumber: 'CTR-001', status: 'active', rentAmount: '4500.00' }],
          occupancies: [{ id: 'occ-1', roomId: 'r-101', status: 'ACTIVE', startedAt: '2026-01-01T00:00:00Z' }],
          dailyStays: [],
          bills: [{ id: 'b-1', billNumber: 'B-202609-01', totalAmount: '4500.00', status: 'unpaid' }],
          settlements: [],
        },
      };

      vi.spyOn(httpClient, 'httpRequest').mockResolvedValue(mockApiResponse);

      const adapter = new ApiTenantAdapter();
      const res = await adapter.getTenantProfile('t-api-1');

      expect(res.success).toBe(true);
      expect(res.data?.tenant.name).toBe('Wichai Meesook');
      expect(res.data?.coOccupants.length).toBe(1);
      expect(res.data?.contracts.length).toBe(1);
      expect(res.data?.occupancies.length).toBe(1);
      expect(res.data?.bills.length).toBe(1);
      expect(res.data?.dailyStays).toEqual([]);
      expect(res.data?.settlements).toEqual([]);

      // Test standalone fetchTenantProfile function
      const standaloneRes = await fetchTenantProfile('t-api-1');
      expect(standaloneRes.success).toBe(true);
      expect(standaloneRes.data?.tenant.id).toBe('t-api-1');
    });

    it('ApiTenantAdapter.getTenantProfile does not create synthetic numeric index IDs (1, 2, 3) for petInfo without IDs', async () => {
      const mockApiResponse = {
        data: {
          tenant: {
            id: 't-api-pet-no-id',
            name: 'No Id Pets',
            petInfo: [
              { type: 'cat', name: 'Mimi' },
              { type: 'dog', name: 'Lucky' },
            ],
          },
        },
      };

      vi.spyOn(httpClient, 'httpRequest').mockResolvedValue(mockApiResponse);

      const adapter = new ApiTenantAdapter();
      const res = await adapter.getTenantProfile('t-api-pet-no-id');

      expect(res.success).toBe(true);
      const pets = res.data?.tenant.pets;
      expect(pets).toBeDefined();
      expect(pets?.length).toBe(2);
      expect(pets?.[0].id).toBeUndefined();
      expect(pets?.[1].id).toBeUndefined();
      expect(pets?.[0].id).not.toBe('1');
      expect(pets?.[1].id).not.toBe('2');
    });

    it('ApiTenantAdapter.getById unwraps tenant from composite response', async () => {
      const mockApiResponse = {
        data: {
          tenant: {
            id: 't-api-2',
            name: 'Kanda Jai',
            phone: '0877777777',
            status: 'active',
          },
          coOccupants: [],
        },
      };

      vi.spyOn(httpClient, 'httpRequest').mockResolvedValue(mockApiResponse);

      const adapter = new ApiTenantAdapter();
      const tenant = await adapter.getById('t-api-2');

      expect(tenant).not.toBeNull();
      expect(tenant?.id).toBe('t-api-2');
      expect(tenant?.name).toBe('Kanda Jai');
    });
  });

  describe('4. DemoTenantAdapter.getTenantProfile in-memory fallback', () => {
    it('constructs TenantProfileDetails from demo repositories', async () => {
      const adapter = new DemoTenantAdapter();
      const tenants = await adapter.getAll();
      expect(tenants.length).toBeGreaterThan(0);

      const targetTenant = tenants[0];
      const res = await adapter.getTenantProfile(targetTenant.id);

      expect(res.success).toBe(true);
      expect(res.data?.tenant.id).toBe(targetTenant.id);
      expect(Array.isArray(res.data?.contracts)).toBe(true);
      expect(Array.isArray(res.data?.bills)).toBe(true);
      expect(Array.isArray(res.data?.coOccupants)).toBe(true);
      expect(Array.isArray(res.data?.emergencyContacts)).toBe(true);
      expect(Array.isArray(res.data?.vehicles)).toBe(true);
      expect(Array.isArray(res.data?.occupancies)).toBe(true);
      expect(Array.isArray(res.data?.dailyStays)).toBe(true);
      expect(Array.isArray(res.data?.settlements)).toBe(true);
    });

    it('returns RESOURCE_NOT_FOUND error if tenant does not exist in demo mode', async () => {
      const adapter = new DemoTenantAdapter();
      const res = await adapter.getTenantProfile('non-existent-tenant-9999');

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('RESOURCE_NOT_FOUND');
    });
  });
});
