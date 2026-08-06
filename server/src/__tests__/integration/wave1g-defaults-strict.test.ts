import { describe, it, expect, vi } from 'vitest';
import {
  UpdateDormitoryDefaultsRequestSchema,
  DefaultPropagationPreviewSchema,
  DefaultPropagationApplySchema,
  AllowedBuildingOverrideChangesSchema,
} from '../../schemas/property-tenant-contract.schemas.js';
import { defaultsService } from '../../services/defaults.service.js';

describe('Wave 1G — Strict Defaults, Propagation & Concurrency Integration Tests', () => {
  describe('1. UpdateDormitoryDefaultsRequestSchema Strict Rules', () => {
    it('accepts property-only defaults update', () => {
      const payload = {
        property: {
          changes: { defaultMonthlyRent: 4500, defaultDeposit: 9000 },
          expectedVersion: 1,
        },
      };
      const res = UpdateDormitoryDefaultsRequestSchema.safeParse(payload);
      expect(res.success).toBe(true);
    });

    it('accepts billing-only defaults update', () => {
      const payload = {
        billing: {
          changes: { waterRate: 20, electricityRate: 8 },
          expectedVersion: 2,
        },
      };
      const res = UpdateDormitoryDefaultsRequestSchema.safeParse(payload);
      expect(res.success).toBe(true);
    });

    it('accepts combined property and billing defaults update', () => {
      const payload = {
        property: {
          changes: { defaultMonthlyRent: 5000 },
          expectedVersion: 1,
        },
        billing: {
          changes: { waterRate: 18 },
          expectedVersion: 3,
        },
      };
      const res = UpdateDormitoryDefaultsRequestSchema.safeParse(payload);
      expect(res.success).toBe(true);
    });

    it('rejects unknown fields in property with unrecognized_keys issue', () => {
      const payload = {
        property: {
          changes: { defaultMonthlyRent: 5000, unknownPropertyField: 'hacked' },
          expectedVersion: 1,
        },
      };
      const res = UpdateDormitoryDefaultsRequestSchema.safeParse(payload);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues.some((i) => i.code === 'unrecognized_keys')).toBe(true);
      }
    });

    it('rejects missing expectedVersion', () => {
      const payload = {
        property: {
          changes: { defaultMonthlyRent: 5000 },
        },
      };
      const res = UpdateDormitoryDefaultsRequestSchema.safeParse(payload);
      expect(res.success).toBe(false);
    });

    it('rejects empty payload containing neither property nor billing', () => {
      const payload = {};
      const res = UpdateDormitoryDefaultsRequestSchema.safeParse(payload);
      expect(res.success).toBe(false);
    });
  });

  describe('2. Propagation Preview & Apply Strict Discriminated Unions', () => {
    it('accepts valid Dormitory Preview schema', () => {
      const payload = {
        scope: 'DORMITORY',
        changes: {
          property: { defaultMonthlyRent: 4500 },
          billing: { waterRate: 20 },
        },
      };
      const res = DefaultPropagationPreviewSchema.safeParse(payload);
      expect(res.success).toBe(true);
    });

    it('accepts valid Building Preview schema', () => {
      const payload = {
        scope: 'BUILDING',
        scopeId: 'bld-1',
        changes: { monthlyRent: 4800 },
      };
      const res = DefaultPropagationPreviewSchema.safeParse(payload);
      expect(res.success).toBe(true);
    });

    it('rejects legacy flat propagation payload for preview with HTTP 400 validation error', () => {
      const legacyPayload = {
        scope: 'DORMITORY',
        changes: { defaultMonthlyRent: 4500, waterRate: 20 },
      };
      const res = DefaultPropagationPreviewSchema.safeParse(legacyPayload);
      expect(res.success).toBe(false);
    });

    it('accepts valid Dormitory Apply schema with independent expectedVersions', () => {
      const payload = {
        scope: 'DORMITORY',
        changes: {
          property: { defaultMonthlyRent: 4500 },
          billing: { waterRate: 20 },
        },
        expectedVersions: {
          property: 1,
          billing: 2,
        },
        idempotencyKey: 'idem-test-1',
      };
      const res = DefaultPropagationApplySchema.safeParse(payload);
      expect(res.success).toBe(true);
    });

    it('rejects Dormitory Apply when changes.property is specified but expectedVersions.property is missing', () => {
      const payload = {
        scope: 'DORMITORY',
        changes: {
          property: { defaultMonthlyRent: 4500 },
        },
        expectedVersions: {
          billing: 2,
        },
        idempotencyKey: 'idem-test-2',
      };
      const res = DefaultPropagationApplySchema.safeParse(payload);
      expect(res.success).toBe(false);
    });

    it('rejects Building override when invalid non-whitelisted field is present', () => {
      const invalidBuildingOverride = {
        monthlyRent: 4800,
        unauthorizedField: 'hacked',
      };
      const res = AllowedBuildingOverrideChangesSchema.safeParse(invalidBuildingOverride);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues.some((i) => i.code === 'unrecognized_keys')).toBe(true);
      }
    });
  });

  describe('3. Service Defaults Mutation & Concurrency Rollback', () => {
    it('executes atomic updateDormitoryDefaults and increments versions independently', async () => {
      const mockProp = { dormitoryId: 'dorm-1', version: 1, defaultMonthlyRent: 4000 };
      const mockBill = { dormitoryId: 'dorm-1', version: 2, waterRate: 18 };

      const mockTx = {
        dormitoryPropertyDefaults: {
          findUnique: async () => mockProp,
          updateMany: async ({ where, data }: any) => {
            if (where.version !== 1) return { count: 0 };
            mockProp.version += 1;
            mockProp.defaultMonthlyRent = data.defaultMonthlyRent;
            return { count: 1 };
          },
        },
        dormitoryBillingSettings: {
          findUnique: async () => mockBill,
          updateMany: async ({ where, data }: any) => {
            if (where.version !== 2) return { count: 0 };
            mockBill.version += 1;
            mockBill.waterRate = data.waterRate;
            return { count: 1 };
          },
        },
        auditLog: {
          create: async ({ data }: any) => ({ id: 'audit-101', ...data }),
        },
      };

      const mockPrisma = {
        $transaction: async (cb: any) => cb(mockTx),
        $disconnect: async () => {},
      };

      vi.spyOn(await import('../../db/prisma.js'), 'getPrismaClient').mockReturnValue(mockPrisma as any);

      const result = await defaultsService.updateDormitoryDefaults(
        'dorm-1',
        {
          property: { changes: { defaultMonthlyRent: 5000 }, expectedVersion: 1 },
          billing: { changes: { waterRate: 20 }, expectedVersion: 2 },
        },
        'user-1'
      );

      expect(result.property.version).toBe(2);
      expect(result.billing.version).toBe(3);
      expect(result.auditLogId).toBe('audit-101');
      vi.restoreAllMocks();
    });

    it('throws VERSION_CONFLICT on stale property expectedVersion during updateDormitoryDefaults', async () => {
      const mockProp = { dormitoryId: 'dorm-1', version: 5 };
      const mockBill = { dormitoryId: 'dorm-1', version: 2 };

      const mockTx = {
        dormitoryPropertyDefaults: {
          findUnique: async () => mockProp,
        },
        dormitoryBillingSettings: {
          findUnique: async () => mockBill,
        },
      };

      const mockPrisma = {
        $transaction: async (cb: any) => cb(mockTx),
        $disconnect: async () => {},
      };

      vi.spyOn(await import('../../db/prisma.js'), 'getPrismaClient').mockReturnValue(mockPrisma as any);

      await expect(
        defaultsService.updateDormitoryDefaults(
          'dorm-1',
          {
            property: { changes: { defaultMonthlyRent: 5000 }, expectedVersion: 1 },
          },
          'user-1'
        )
      ).rejects.toThrow('ข้อมูลถูกแก้ไขโดยผู้อื่น กรุณาโหลดข้อมูลใหม่');
      vi.restoreAllMocks();
    });

    it('rolls back entire transaction if AuditLog insertion fails during updateDormitoryDefaults', async () => {
      const mockProp = { dormitoryId: 'dorm-1', version: 1 };
      const mockBill = { dormitoryId: 'dorm-1', version: 1 };

      const mockTx = {
        dormitoryPropertyDefaults: {
          findUnique: async () => mockProp,
          updateMany: async () => ({ count: 1 }),
        },
        dormitoryBillingSettings: {
          findUnique: async () => mockBill,
        },
        auditLog: {
          create: async () => {
            throw new Error('AuditLog database connection failure');
          },
        },
      };

      const mockPrisma = {
        $transaction: async (cb: any) => cb(mockTx),
        $disconnect: async () => {},
      };

      vi.spyOn(await import('../../db/prisma.js'), 'getPrismaClient').mockReturnValue(mockPrisma as any);

      await expect(
        defaultsService.updateDormitoryDefaults(
          'dorm-1',
          {
            property: { changes: { defaultMonthlyRent: 5000 }, expectedVersion: 1 },
          },
          'user-1'
        )
      ).rejects.toThrow('AuditLog database connection failure');
      vi.restoreAllMocks();
    });
  });
});
