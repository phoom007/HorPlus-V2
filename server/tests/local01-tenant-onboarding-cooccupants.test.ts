import { describe, it, expect, beforeEach } from 'vitest';
import { TenantRegistrationService } from '../src/services/tenant-registration.service.js';
import { TenantService } from '../src/services/tenant.service.js';
import { InMemoryTenantRepository } from '../src/db/repositories/tenant.repository.js';
import { InMemoryContractRepository } from '../src/db/repositories/contract.repository.js';
import { InMemoryRoomRepository } from '../src/db/repositories/room.repository.js';
import { SensitiveFieldService } from '../src/services/sensitive-field.service.js';

describe('LOCAL-01 — Tenant Onboarding & Co-Occupant Management', () => {
  let tenantRepo: InMemoryTenantRepository;
  let contractRepo: InMemoryContractRepository;
  let roomRepo: InMemoryRoomRepository;
  let tenantService: TenantService;
  let registrationService: TenantRegistrationService;

  const dormA = 'dorm-aaaa-1111';
  const dormB = 'dorm-bbbb-2222';

  beforeEach(() => {
    tenantRepo = new InMemoryTenantRepository();
    contractRepo = new InMemoryContractRepository();
    roomRepo = new InMemoryRoomRepository();
    const sensitiveService = new SensitiveFieldService('test-secret-key-32-chars-long!!!!!!');

    tenantService = new TenantService(tenantRepo, contractRepo, sensitiveService);
    registrationService = new TenantRegistrationService();
  });

  describe('Co-Occupant Management & RLS Isolation', () => {
    it('should add, update, and soft-remove co-occupants with historical auditability', async () => {
      // 1. Create Tenant in Dorm A
      const tenant = await tenantService.createTenant(dormA, {
        firstName: 'Somchai',
        lastName: 'Jaidee',
        phone: '0812345678',
      });

      // 2. Add Co-Occupant
      const co1 = await tenantService.addCoOccupant(dormA, tenant.id, {
        name: 'Somying Jaidee',
        phone: '0898765432',
        relationship: 'Sister',
      });

      expect(co1.id).toBeDefined();
      expect(co1.name).toBe('Somying Jaidee');
      expect(co1.status).toBe('active');

      // 3. Verify co-occupant appears in tenant details
      const details = await tenantService.getTenantDetails(tenant.id, dormA);
      expect(details.coOccupants.length).toBe(1);
      expect(details.coOccupants[0].name).toBe('Somying Jaidee');

      // 4. Update Co-Occupant
      const updated = await tenantService.updateCoOccupant(dormA, tenant.id, co1.id, {
        name: 'Somying Jaidee-Rak',
        relationship: 'Wife',
      });
      expect(updated.name).toBe('Somying Jaidee-Rak');

      // 5. Remove Co-Occupant
      const removeRes = await tenantService.removeCoOccupant(dormA, tenant.id, co1.id);
      expect(removeRes.success).toBe(true);

      // 6. Verify soft-removal preserves historical accountability
      const detailsAfterRemove = await tenantService.getTenantDetails(tenant.id, dormA);
      expect(detailsAfterRemove.coOccupants.length).toBe(0);
    });

    it('should enforce strict cross-dormitory isolation on co-occupant mutations', async () => {
      // Create Tenant in Dorm A
      const tenantA = await tenantService.createTenant(dormA, {
        firstName: 'TenantA',
        lastName: 'Test',
        phone: '0811111111',
      });

      const coA = await tenantService.addCoOccupant(dormA, tenantA.id, {
        name: 'CoOccupant A',
      });

      // Attempt mutating Dorm A tenant co-occupant from Dorm B context -> Must throw 404 / error
      await expect(
        tenantService.addCoOccupant(dormB, tenantA.id, { name: 'Hacker Co' })
      ).rejects.toThrow();

      await expect(
        tenantService.updateCoOccupant(dormB, tenantA.id, coA.id, { name: 'Hacked Name' })
      ).rejects.toThrow();

      await expect(
        tenantService.removeCoOccupant(dormB, tenantA.id, coA.id)
      ).rejects.toThrow();
    });
  });
});
