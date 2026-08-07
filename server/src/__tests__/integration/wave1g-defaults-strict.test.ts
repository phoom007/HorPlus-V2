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
  const prisma = getPrismaClient();
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
      const billBefore = await prisma.dormitoryBillingSettings.findUnique({ where: { dormitoryId: testDormId } });
      const currentPropVer = propBefore?.version || 3;
      const currentBillVer = billBefore?.version || 2;
      const currentRent = Number(propBefore?.defaultMonthlyRent || 4900);

      const noOpRes = await defaultsService.applyDefaultPropagation(
        testDormId,
        {
          scope: 'DORMITORY',
          changes: {
            property: { defaultMonthlyRent: currentRent },
          },
          expectedVersions: { property: currentPropVer, billing: currentBillVer },
          idempotencyKey: `noop-test-${Date.now()}`,
        },
        testUserId
      );

      expect(noOpRes.noOp).toBe(true);
      expect(noOpRes.scopeUpdates.property.updated).toBe(false);
      expect(noOpRes.scopeUpdates.billing.updated).toBe(false);
      expect(noOpRes.appliedRoomCount).toBe(0);
      expect(noOpRes.appliedFieldChangeCount).toBe(0);
      expect(noOpRes.auditLogId).toBeNull();

      const propAfter = await prisma.dormitoryPropertyDefaults.findUnique({ where: { dormitoryId: testDormId } });
      expect(propAfter?.version).toBe(currentPropVer);
    });

    it('proves identical Billing value no-op returns noOp: true without version increment', async () => {
      const billBefore = await prisma.dormitoryBillingSettings.findUnique({ where: { dormitoryId: testDormId } });
      const propBefore = await prisma.dormitoryPropertyDefaults.findUnique({ where: { dormitoryId: testDormId } });
      const currentBillVer = billBefore?.version || 1;
      const currentPropVer = propBefore?.version || 1;
      const currentWaterRate = Number(billBefore?.waterRate || 20);

      const res = await defaultsService.applyDefaultPropagation(
        testDormId,
        {
          scope: 'DORMITORY',
          changes: {
            billing: { waterRate: currentWaterRate },
          },
          expectedVersions: { property: currentPropVer, billing: currentBillVer },
          idempotencyKey: `bill-noop-${Date.now()}`,
        },
        testUserId
      );

      expect(res.noOp).toBe(true);
      expect(res.scopeUpdates.billing.updated).toBe(false);
      expect(res.auditLogId).toBeNull();

      const billAfter = await prisma.dormitoryBillingSettings.findUnique({ where: { dormitoryId: testDormId } });
      expect(billAfter?.version).toBe(currentBillVer);
    });

    it('proves direct updateDormitoryDefaults identical-value returns noOp: true without version increment or AuditLog', async () => {
      const propBefore = await prisma.dormitoryPropertyDefaults.findUnique({ where: { dormitoryId: testDormId } });
      const billBefore = await prisma.dormitoryBillingSettings.findUnique({ where: { dormitoryId: testDormId } });
      const currentPropVer = propBefore?.version || 1;
      const currentBillVer = billBefore?.version || 1;

      const currentRent = Number(propBefore?.defaultMonthlyRent || 4900);
      const currentWater = Number(billBefore?.waterRate || 20);

      const res = await defaultsService.updateDormitoryDefaults(
        testDormId,
        {
          property: { changes: { defaultMonthlyRent: currentRent }, expectedVersion: currentPropVer },
          billing: { changes: { waterRate: currentWater }, expectedVersion: currentBillVer },
        },
        testUserId
      );

      expect(res.noOp).toBe(true);
      expect(res.auditLogId).toBeNull();

      const propAfter = await prisma.dormitoryPropertyDefaults.findUnique({ where: { dormitoryId: testDormId } });
      const billAfter = await prisma.dormitoryBillingSettings.findUnique({ where: { dormitoryId: testDormId } });
      expect(propAfter?.version).toBe(currentPropVer);
      expect(billAfter?.version).toBe(currentBillVer);
    });

    it('proves changed default with ALL rooms explicitly overridden updates default, increments version, writes AuditLog, with zero applied rooms', async () => {
      // Create isolated test dormitory and building
      const dorm = await prisma.dormitory.create({
        data: { name: `Override Dorm ${Date.now()}` },
      });
      const prop = await prisma.dormitoryPropertyDefaults.create({
        data: { dormitoryId: dorm.id, defaultMonthlyRent: new Prisma.Decimal(9400), version: 1 },
      });
      await prisma.dormitoryBillingSettings.create({
        data: { dormitoryId: dorm.id, waterRate: new Prisma.Decimal(20), electricityRate: new Prisma.Decimal(8), version: 1 },
      });
      const bld = await prisma.building.create({
        data: { dormitoryId: dorm.id, name: 'Bld 1', code: `B1-${Date.now()}` },
      });

      // Create 2 rooms with explicit room overrides (monthlyRent = 5000)
      await prisma.room.create({
        data: { dormitoryId: dorm.id, buildingId: bld.id, roomNumber: 'RM-OVR1', normalizedRoomNumber: 'RM-OVR1', roomType: 'standard', monthlyRent: new Prisma.Decimal(5000) },
      });
      await prisma.room.create({
        data: { dormitoryId: dorm.id, buildingId: bld.id, roomNumber: 'RM-OVR2', normalizedRoomNumber: 'RM-OVR2', roomType: 'standard', monthlyRent: new Prisma.Decimal(6000) },
      });

      const applyRes = await defaultsService.applyDefaultPropagation(
        dorm.id,
        {
          scope: 'DORMITORY',
          changes: {
            property: { defaultMonthlyRent: 9500 },
          },
          expectedVersions: { property: 1, billing: 1 },
          idempotencyKey: `ovr-all-${Date.now()}`,
        },
        testUserId
      );

      expect(applyRes.noOp).toBe(false);
      expect(applyRes.scopeUpdates.property.updated).toBe(true);
      expect(applyRes.scopeUpdates.property.oldVersion).toBe(1);
      expect(applyRes.scopeUpdates.property.newVersion).toBe(2);
      expect(applyRes.appliedRoomCount).toBe(0);
      expect(applyRes.appliedFieldChangeCount).toBe(0);
      expect(applyRes.skippedRoomCount).toBe(2);
      expect(applyRes.auditLogId).not.toBeNull();

      const freshProp = await prisma.dormitoryPropertyDefaults.findUnique({ where: { dormitoryId: dorm.id } });
      expect(freshProp?.version).toBe(2);
      expect(Number(freshProp?.defaultMonthlyRent)).toBe(9500);
    });

    it('proves changed default with protected rooms across ALL five blocking contract statuses updates default, increments version, and skips protected rooms', async () => {
      const statuses = BLOCKING_CONTRACT_STATUSES;
      expect(statuses).toEqual(['active', 'approved', 'expiring_soon', 'waiting_extension', 'checking_out']);

      const dorm = await prisma.dormitory.create({
        data: { name: `Status Dorm ${Date.now()}` },
      });
      await prisma.dormitoryPropertyDefaults.create({
        data: { dormitoryId: dorm.id, defaultMonthlyRent: new Prisma.Decimal(9400), version: 1 },
      });
      await prisma.dormitoryBillingSettings.create({
        data: { dormitoryId: dorm.id, waterRate: new Prisma.Decimal(20), electricityRate: new Prisma.Decimal(8), version: 1 },
      });
      const bld = await prisma.building.create({
        data: { dormitoryId: dorm.id, name: 'Bld 1', code: `B2-${Date.now()}` },
      });

      // Create a tenant
      const tenant = await prisma.tenant.create({
        data: { dormitoryId: dorm.id, firstName: 'Test', lastName: 'Tenant', displayName: 'Test Tenant', phone: '0812345678', tenantNumber: `TNT-${Date.now()}` },
      });

      // Create 5 rooms, each with a contract in one of the 5 blocking statuses
      let ver = 1;
      for (let i = 0; i < statuses.length; i++) {
        const st = statuses[i];
        const rm = await prisma.room.create({
          data: { dormitoryId: dorm.id, buildingId: bld.id, roomNumber: `RM-ST-${i}`, normalizedRoomNumber: `RM-ST-${i}`, roomType: 'standard', monthlyRent: null },
        });
        await prisma.contract.create({
          data: {
            dormitoryId: dorm.id,
            roomId: rm.id,
            tenantId: tenant.id,
            contractNumber: `CTR-ST-${i}-${Date.now()}`,
            rentAmount: new Prisma.Decimal(4000),
            depositAmount: new Prisma.Decimal(8000),
            startDate: new Date(),
            endDate: new Date(Date.now() + 30 * 86400000),
            status: st as any,
          },
        });
      }

      const applyRes = await defaultsService.applyDefaultPropagation(
        dorm.id,
        {
          scope: 'DORMITORY',
          changes: {
            property: { defaultMonthlyRent: 9600 },
          },
          expectedVersions: { property: ver, billing: 1 },
          idempotencyKey: `status-all-${Date.now()}`,
        },
        testUserId
      );

      expect(applyRes.noOp).toBe(false);
      expect(applyRes.scopeUpdates.property.updated).toBe(true);
      expect(applyRes.scopeUpdates.property.newVersion).toBe(2);
      expect(applyRes.appliedRoomCount).toBe(0);
      expect(applyRes.skippedRoomCount).toBe(5);
      expect(applyRes.fieldEffects.every((e: any) => e.skipReason === 'PROTECTED_CONTRACT')).toBe(true);

      const freshProp = await prisma.dormitoryPropertyDefaults.findUnique({ where: { dormitoryId: dorm.id } });
      expect(Number(freshProp?.defaultMonthlyRent)).toBe(9600);
      expect(freshProp?.version).toBe(2);
    });

    it('proves mixed Property unchanged + Billing changed updates Billing ONLY, increments Billing version ONLY, and records Billing changes in AuditLog', async () => {
      const dorm = await prisma.dormitory.create({
        data: { name: `Mixed Dorm ${Date.now()}` },
      });
      await prisma.dormitoryPropertyDefaults.create({
        data: { dormitoryId: dorm.id, defaultMonthlyRent: new Prisma.Decimal(9400), version: 1 },
      });
      await prisma.dormitoryBillingSettings.create({
        data: { dormitoryId: dorm.id, waterRate: new Prisma.Decimal(20), electricityRate: new Prisma.Decimal(8), version: 1 },
      });

      const applyRes = await defaultsService.applyDefaultPropagation(
        dorm.id,
        {
          scope: 'DORMITORY',
          changes: {
            property: { defaultMonthlyRent: 9400 }, // unchanged
            billing: { waterRate: 25 }, // changed
          },
          expectedVersions: { property: 1, billing: 1 },
          idempotencyKey: `mixed-${Date.now()}`,
        },
        testUserId
      );

      expect(applyRes.noOp).toBe(false);
      expect(applyRes.scopeUpdates.property.updated).toBe(false);
      expect(applyRes.scopeUpdates.property.newVersion).toBe(1);
      expect(applyRes.scopeUpdates.billing.updated).toBe(true);
      expect(applyRes.scopeUpdates.billing.newVersion).toBe(2);
      expect(applyRes.scopeUpdates.billing.changedFields).toEqual(['waterRate']);

      const propAfter = await prisma.dormitoryPropertyDefaults.findUnique({ where: { dormitoryId: dorm.id } });
      const billAfter = await prisma.dormitoryBillingSettings.findUnique({ where: { dormitoryId: dorm.id } });
      expect(propAfter?.version).toBe(1);
      expect(billAfter?.version).toBe(2);
      expect(Number(billAfter?.waterRate)).toBe(25);

      const audit = await prisma.auditLog.findUnique({ where: { id: applyRes.auditLogId } });
      expect(audit?.beforeValues).not.toHaveProperty('property');
      expect((audit?.beforeValues as any)?.billing).toBeDefined();
    });

    it('proves mixed Billing unchanged + Property changed updates Property ONLY, increments Property version ONLY, and records Property changes in AuditLog', async () => {
      const dorm = await prisma.dormitory.create({
        data: { name: `Mixed Prop Dorm ${Date.now()}` },
      });
      await prisma.dormitoryPropertyDefaults.create({
        data: { dormitoryId: dorm.id, defaultMonthlyRent: new Prisma.Decimal(9400), version: 1 },
      });
      await prisma.dormitoryBillingSettings.create({
        data: { dormitoryId: dorm.id, waterRate: new Prisma.Decimal(20), electricityRate: new Prisma.Decimal(8), version: 1 },
      });

      const applyRes = await defaultsService.applyDefaultPropagation(
        dorm.id,
        {
          scope: 'DORMITORY',
          changes: {
            property: { defaultMonthlyRent: 9800 }, // changed
            billing: { waterRate: 20 }, // unchanged
          },
          expectedVersions: { property: 1, billing: 1 },
          idempotencyKey: `mixed-prop-${Date.now()}`,
        },
        testUserId
      );

      expect(applyRes.noOp).toBe(false);
      expect(applyRes.scopeUpdates.property.updated).toBe(true);
      expect(applyRes.scopeUpdates.property.newVersion).toBe(2);
      expect(applyRes.scopeUpdates.billing.updated).toBe(false);
      expect(applyRes.scopeUpdates.billing.newVersion).toBe(1);

      const propAfter = await prisma.dormitoryPropertyDefaults.findUnique({ where: { dormitoryId: dorm.id } });
      const billAfter = await prisma.dormitoryBillingSettings.findUnique({ where: { dormitoryId: dorm.id } });
      expect(propAfter?.version).toBe(2);
      expect(billAfter?.version).toBe(1);

      const audit = await prisma.auditLog.findUnique({ where: { id: applyRes.auditLogId } });
      expect(audit?.beforeValues).toHaveProperty('property');
      expect((audit?.beforeValues as any)?.billing).toBeUndefined();
    });

    it('proves stale version on an otherwise no-op request throws VERSION_CONFLICT (HTTP 409)', async () => {
      const propBefore = await prisma.dormitoryPropertyDefaults.findUnique({ where: { dormitoryId: testDormId } });
      const currentVer = propBefore?.version || 1;
      const currentRent = Number(propBefore?.defaultMonthlyRent || 4900);
      const staleVer = currentVer + 99;

      await expect(
        defaultsService.applyDefaultPropagation(
          testDormId,
          {
            scope: 'DORMITORY',
            changes: {
              property: { defaultMonthlyRent: currentRent }, // value equals stored value
            },
            expectedVersions: { property: staleVer, billing: 1 },
            idempotencyKey: `stale-noop-${Date.now()}`,
          },
          testUserId
        )
      ).rejects.toThrow('ข้อมูลถูกแก้ไขโดยผู้อื่น กรุณาโหลดข้อมูลใหม่');
    });

    it('proves idempotent replay of changed-default/zero-Room-effect command returns identical response, exactly 1 version increment, 1 AuditLog, and 1 IdempotencyKey', async () => {
      const dorm = await prisma.dormitory.create({
        data: { name: `Idem Zero Room ${Date.now()}` },
      });
      await prisma.dormitoryPropertyDefaults.create({
        data: { dormitoryId: dorm.id, defaultMonthlyRent: new Prisma.Decimal(9400), version: 1 },
      });
      await prisma.dormitoryBillingSettings.create({
        data: { dormitoryId: dorm.id, waterRate: new Prisma.Decimal(20), electricityRate: new Prisma.Decimal(8), version: 1 },
      });

      const idempotencyKey = `idem-zero-rm-${Date.now()}`;
      const payload = {
        scope: 'DORMITORY',
        changes: {
          property: { defaultMonthlyRent: 9900 },
        },
        expectedVersions: { property: 1, billing: 1 },
        idempotencyKey,
      };

      const firstRes = await defaultsService.applyDefaultPropagation(dorm.id, payload, testUserId);
      expect(firstRes.noOp).toBe(false);
      expect(firstRes.scopeUpdates.property.newVersion).toBe(2);

      const replayRes = await defaultsService.applyDefaultPropagation(dorm.id, payload, testUserId);
      expect(replayRes).toEqual(firstRes);

      const propAfter = await prisma.dormitoryPropertyDefaults.findUnique({ where: { dormitoryId: dorm.id } });
      expect(propAfter?.version).toBe(2); // Only 1 version increment

      const auditCount = await prisma.auditLog.count({ where: { dormitoryId: dorm.id, action: 'BULK_DEFAULT_APPLY' } });
      expect(auditCount).toBe(1); // Only 1 AuditLog

      const keyCount = await prisma.idempotencyKey.count({ where: { userId: testUserId, idempotencyKey } });
      expect(keyCount).toBe(1); // Only 1 IdempotencyKey record
    });
  });
});
