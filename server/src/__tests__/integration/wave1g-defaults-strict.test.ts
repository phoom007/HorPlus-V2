import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  UpdateDormitoryDefaultsRequestSchema,
  DefaultPropagationPreviewSchema,
  DefaultPropagationApplySchema,
  AllowedBuildingOverrideChangesSchema,
} from '../../schemas/property-tenant-contract.schemas.js';
import { defaultsService } from '../../services/defaults.service.js';
import { BLOCKING_CONTRACT_STATUSES } from '../../services/blocking-contract-policy.js';
import { getPrismaClient } from '../../db/prisma.js';

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

    it('rejects legacy flat propagation payload for preview', () => {
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

  describe('3. Unified Blocking Contract Policy Coverage', () => {
    it('contains all 5 required protected statuses in BLOCKING_CONTRACT_STATUSES', () => {
      const expectedStatuses = ['active', 'approved', 'expiring_soon', 'waiting_extension', 'checking_out'];
      expect(BLOCKING_CONTRACT_STATUSES).toEqual(expect.arrayContaining(expectedStatuses));
      expect(BLOCKING_CONTRACT_STATUSES.length).toBe(5);
    });
  });

  describe('4. Real PostgreSQL Defaults & Concurrency Tests', () => {
    const prisma = getPrismaClient();
    let testDormId: string;
    let testUserId: string;

    beforeAll(async () => {
      testUserId = crypto.randomUUID();
      testDormId = crypto.randomUUID();

      const email = `wave1g-test-${Date.now()}@example.com`;
      await prisma.user.create({
        data: {
          id: testUserId,
          email,
          emailNormalized: email.toLowerCase(),
          name: 'Wave1G Test User',
          googleSubject: `sub-${Date.now()}`,
        },
      });

      await prisma.dormitory.create({
        data: {
          id: testDormId,
          name: 'Wave1G Concurrency Dorm',
          code: `DM-${Date.now()}`,
          createdByUserId: testUserId,
        },
      });

      await prisma.dormitoryPropertyDefaults.create({
        data: {
          dormitoryId: testDormId,
          defaultMonthlyRent: 4000,
          defaultDeposit: 8000,
          version: 1,
        },
      });

      await prisma.dormitoryBillingSettings.create({
        data: {
          dormitoryId: testDormId,
          waterRate: 18,
          electricityRate: 7,
          version: 1,
        },
      });

      const bld = await prisma.building.create({
        data: {
          id: crypto.randomUUID(),
          dormitoryId: testDormId,
          name: 'Building PG 1',
          version: 1,
        },
      });

      await prisma.room.create({
        data: {
          dormitoryId: testDormId,
          buildingId: bld.id,
          roomNumber: '101',
          normalizedRoomNumber: '101',
          floor: 1,
          roomType: 'standard',
          status: 'vacant',
          rentCycle: 'monthly',
          version: 1,
        },
      });
    });

    it('performs real PostgreSQL combined Property + Billing update with independent version increments', async () => {
      const res = await defaultsService.updateDormitoryDefaults(
        testDormId,
        {
          property: { changes: { defaultMonthlyRent: 4500 }, expectedVersion: 1 },
          billing: { changes: { waterRate: 20 }, expectedVersion: 1 },
        },
        testUserId
      );

      expect(res.property.version).toBe(2);
      expect(res.billing.version).toBe(2);
      expect(res.property.defaultMonthlyRent.toString()).toBe('4500');
      expect(res.billing.waterRate.toString()).toBe('20');
    });

    it('rolls back entire transaction on PostgreSQL when stale property version is supplied', async () => {
      await expect(
        defaultsService.updateDormitoryDefaults(
          testDormId,
          {
            property: { changes: { defaultMonthlyRent: 5000 }, expectedVersion: 1 }, // Stale version (current is 2)
            billing: { changes: { waterRate: 25 }, expectedVersion: 2 }, // Fresh version
          },
          testUserId
        )
      ).rejects.toThrow('ข้อมูลถูกแก้ไขโดยผู้อื่น กรุณาโหลดข้อมูลใหม่');

      // Verify billing waterRate was NOT mutated to 25
      const bill = await prisma.dormitoryBillingSettings.findUnique({ where: { dormitoryId: testDormId } });
      expect(bill?.waterRate.toString()).toBe('20');
      expect(bill?.version).toBe(2);
    });

    it('proves concurrent applyDefaultPropagation idempotency replay under advisory lock', async () => {
      const idempotencyKey = `idem-conc-${Date.now()}`;
      const payload = {
        scope: 'DORMITORY',
        changes: {
          property: { defaultMonthlyRent: 4800 },
          billing: { waterRate: 22 },
        },
        expectedVersions: {
          property: 2,
          billing: 2,
        },
        idempotencyKey,
      };

      const [res1, res2] = await Promise.all([
        defaultsService.applyDefaultPropagation(testDormId, payload, testUserId),
        defaultsService.applyDefaultPropagation(testDormId, payload, testUserId),
      ]);

      expect(res1).toEqual(res2);

      // Verify only 1 AuditLog was created for this key
      const auditCount = await prisma.auditLog.count({
        where: { dormitoryId: testDormId, idempotencyKey },
      });
      expect(auditCount).toBe(1);

      // Verify only 1 IdempotencyKey record was created
      const keyCount = await prisma.idempotencyKey.count({
        where: { userId: testUserId, idempotencyKey },
      });
      expect(keyCount).toBe(1);
    });

    it('rejects concurrent idempotency replay with different request hash (HTTP 409 IDEMPOTENCY_MISMATCH)', async () => {
      const idempotencyKey = `idem-mismatch-${Date.now()}`;
      const originalPayload = {
        scope: 'DORMITORY',
        changes: {
          property: { defaultMonthlyRent: 4900 },
        },
        expectedVersions: {
          property: 3,
        },
        idempotencyKey,
      };

      await defaultsService.applyDefaultPropagation(testDormId, originalPayload, testUserId);

      const modifiedPayload = {
        ...originalPayload,
        changes: {
          property: { defaultMonthlyRent: 9999 },
        },
      };

      await expect(
        defaultsService.applyDefaultPropagation(testDormId, modifiedPayload, testUserId)
      ).rejects.toThrow('Idempotency key ซ้ำแต่ข้อมูลไม่ตรงกับรายการเดิม');
    });

    it('proves valuesEquivalent handles numbers, numeric strings, and Decimals canonically', async () => {
      const { valuesEquivalent } = await import('../../services/defaults.service.js');
      expect(valuesEquivalent(9400, '9400')).toBe(true);
      expect(valuesEquivalent('9400.00', '9400')).toBe(true);
      expect(valuesEquivalent(new Prisma.Decimal(9400), '9400.00')).toBe(true);
      expect(valuesEquivalent(9200, 9400)).toBe(false);
      expect(valuesEquivalent(null, null)).toBe(true);
      expect(valuesEquivalent(null, 9400)).toBe(false);
    });

    it('proves no-op propagation returns noOp: true without version increment or AuditLog', async () => {
      const propBefore = await prisma.dormitoryPropertyDefaults.findUnique({ where: { dormitoryId: testDormId } });
      const currentVer = propBefore?.version || 3;
      const currentRent = Number(propBefore?.defaultMonthlyRent || 4900);

      const noOpRes = await defaultsService.applyDefaultPropagation(
        testDormId,
        {
          scope: 'DORMITORY',
          changes: {
            property: { defaultMonthlyRent: currentRent },
          },
          expectedVersions: { property: currentVer, billing: 2 },
          idempotencyKey: `noop-test-${Date.now()}`,
        },
        testUserId
      );

      expect(noOpRes.noOp).toBe(true);
      expect(noOpRes.appliedRoomCount).toBe(0);
      expect(noOpRes.appliedFieldChangeCount).toBe(0);
      expect(noOpRes.auditLogId).toBeNull();

      const propAfter = await prisma.dormitoryPropertyDefaults.findUnique({ where: { dormitoryId: testDormId } });
      expect(propAfter?.version).toBe(currentVer);
    });
  });
});
