import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { getPrismaClient } from '../src/db/prisma.js';
import { BuildingService } from '../src/services/building.service.js';
import { RoomService } from '../src/services/room.service.js';
import { PrismaBuildingRepository } from '../src/db/repositories/building.repository.js';
import { PrismaRoomRepository } from '../src/db/repositories/room.repository.js';
import { PrismaSubscriptionRepository } from '../src/db/repositories/subscription.repository.js';
import { PrismaContractRepository } from '../src/db/repositories/contract.repository.js';
import { subscriptionEntitlementService } from '../src/services/subscription-entitlement.service.js';
import { reconcileRoomNormalization } from '../src/scripts/reconcile-room-normalization.js';

describe('Wave 1G — Property Runtime Real PostgreSQL Concurrency, Rollback & Reconciliation Suite', () => {
  const prisma = getPrismaClient();
  const buildingRepo = new PrismaBuildingRepository(prisma);
  const roomRepo = new PrismaRoomRepository(prisma);
  const subRepo = new PrismaSubscriptionRepository(prisma);
  const contractRepo = new PrismaContractRepository(prisma);

  const buildingService = new BuildingService(buildingRepo, roomRepo);
  const roomService = new RoomService(roomRepo, buildingRepo, subRepo, contractRepo);

  const dormId = randomUUID();
  const userId = randomUUID();

  async function createDormitoryWithSubscription(targetDormId: string, name: string) {
    await subscriptionEntitlementService.ensureSeeded();

    await prisma.dormitory.create({
      data: {
        id: targetDormId,
        name,
        code: `RT-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        createdByUserId: userId,
      },
    });

    await subscriptionEntitlementService.provisionInitialTrial(targetDormId);
  }

  beforeAll(async () => {
    await subscriptionEntitlementService.ensureSeeded();

    const email = `runtime_owner_${Date.now()}@example.com`;
    await prisma.user.create({
      data: {
        id: userId,
        email,
        emailNormalized: email.toLowerCase(),
        name: 'Runtime Owner',
        googleSubject: `google_sub_${Date.now()}_${Math.random()}`,
      },
    });

    await createDormitoryWithSubscription(dormId, 'Runtime Test Dormitory');
  });

  describe('1. Atomic Building Concurrency', () => {
    it('executes concurrent updateBuilding with expectedVersion 1 resulting in exactly 1 success and 1 409 conflict', async () => {
      const bld = await buildingService.createBuilding(dormId, {
        name: `Bld Conc ${Date.now()}`,
        code: `BC${Math.floor(Math.random() * 10000)}`,
      }, userId);

      expect(bld.version).toBe(1);

      const results = await Promise.allSettled([
        buildingService.updateBuilding({
          buildingId: bld.id,
          dormitoryId: dormId,
          changes: { description: 'Update A' },
          expectedVersion: 1,
          actorUserId: userId,
        }),
        buildingService.updateBuilding({
          buildingId: bld.id,
          dormitoryId: dormId,
          changes: { description: 'Update B' },
          expectedVersion: 1,
          actorUserId: userId,
        }),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const rejErr = (rejected[0] as PromiseRejectedResult).reason;
      expect(String(rejErr.code || rejErr.statusCode || rejErr.message)).toMatch(/409|VERSION_CONFLICT/);

      const updated = await prisma.building.findUnique({ where: { id: bld.id } });
      expect(updated?.version).toBe(2);
      const auditCount = await prisma.auditLog.count({
        where: { entityId: bld.id },
      });
      expect(auditCount).toBe(2);
    });
  });

  describe('2. Atomic Room Concurrency', () => {
    it('executes concurrent updateRoom with expectedVersion 1 resulting in exactly 1 success and 1 409 conflict', async () => {
      const bld = await buildingService.createBuilding(dormId, { name: `Bld Room Conc ${Date.now()}` }, userId);
      const rm = await roomService.createRoom(dormId, {
        buildingId: bld.id,
        roomNumber: `RC-${Math.floor(Math.random() * 10000)}`,
        monthlyRent: '4000.00',
      }, userId);

      expect(rm.version).toBe(1);

      const results = await Promise.allSettled([
        roomService.updateRoom({
          roomId: rm.id,
          dormitoryId: dormId,
          changes: { monthlyRent: '4500.00' },
          expectedVersion: 1,
          actorUserId: userId,
        }),
        roomService.updateRoom({
          roomId: rm.id,
          dormitoryId: dormId,
          changes: { monthlyRent: '5000.00' },
          expectedVersion: 1,
          actorUserId: userId,
        }),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const rejErr = (rejected[0] as PromiseRejectedResult).reason;
      expect(String(rejErr.code || rejErr.statusCode || rejErr.message)).toMatch(/409|VERSION_CONFLICT/);

      const updated = await prisma.room.findUnique({ where: { id: rm.id } });
      expect(updated?.version).toBe(2);
    });
  });

  describe('3. Production-Service AuditLog Rollback', () => {
    /**
     * Creates a wrapped Prisma transaction client where tx.auditLog.create
     * throws SIMULATED_AUDITLOG_FAILURE, but all other delegates operate
     * against the real Prisma transaction.
     */
    function wrapTxWithFailingAuditLog(realTx: any): any {
      return new Proxy(realTx, {
        get(target, prop) {
          if (prop === 'auditLog') {
            return new Proxy(target.auditLog, {
              get(auditTarget, auditProp) {
                if (auditProp === 'create') {
                  return async () => {
                    throw new Error('SIMULATED_AUDITLOG_FAILURE');
                  };
                }
                return auditTarget[auditProp];
              },
            });
          }
          return target[prop];
        },
      });
    }

    it('rolls back Building mutation when production BuildingService.updateBuilding hits AuditLog failure', async () => {
      const bld = await buildingService.createBuilding(dormId, {
        name: `Bld SvcRollback ${Date.now()}`,
      }, userId);

      const initialVersion = bld.version;
      const initialDesc = bld.description;

      // Count audit logs before the failed attempt
      const auditBefore = await prisma.auditLog.count({
        where: { entityId: bld.id, action: 'BUILDING_UPDATED' },
      });

      // Call the real BuildingService.updateBuilding inside a transaction,
      // passing a wrapped tx client that fails on auditLog.create
      const failedUpdate = prisma.$transaction(async (tx: any) => {
        const wrappedTx = wrapTxWithFailingAuditLog(tx);
        return buildingService.updateBuilding({
          buildingId: bld.id,
          dormitoryId: dormId,
          changes: { description: 'SHOULD_BE_ROLLED_BACK' },
          expectedVersion: initialVersion,
          actorUserId: userId,
        }, wrappedTx);
      });

      await expect(failedUpdate).rejects.toThrow('SIMULATED_AUDITLOG_FAILURE');

      // Assert: Building values unchanged
      const afterBld = await prisma.building.findUnique({ where: { id: bld.id } });
      expect(afterBld?.description).toBe(initialDesc);

      // Assert: Building version unchanged
      expect(afterBld?.version).toBe(initialVersion);

      // Assert: No BUILDING_UPDATED AuditLog committed
      const auditAfter = await prisma.auditLog.count({
        where: { entityId: bld.id, action: 'BUILDING_UPDATED' },
      });
      expect(auditAfter).toBe(auditBefore);
    });

    it('rolls back Room mutation when production RoomService.updateRoom hits AuditLog failure', async () => {
      const bld = await buildingService.createBuilding(dormId, {
        name: `Bld RmSvcRollback ${Date.now()}`,
      }, userId);
      const rm = await roomService.createRoom(dormId, {
        buildingId: bld.id,
        roomNumber: `RSR-${Math.floor(Math.random() * 10000)}`,
        monthlyRent: '3000.00',
      }, userId);

      const initialVersion = rm.version;
      const initialRent = rm.monthlyRent.toString();

      // Count audit logs before the failed attempt
      const auditBefore = await prisma.auditLog.count({
        where: { entityId: rm.id, action: 'ROOM_UPDATED' },
      });

      // Call the real RoomService.updateRoom inside a transaction,
      // passing a wrapped tx client that fails on auditLog.create
      const failedUpdate = prisma.$transaction(async (tx: any) => {
        const wrappedTx = wrapTxWithFailingAuditLog(tx);
        return roomService.updateRoom({
          roomId: rm.id,
          dormitoryId: dormId,
          changes: { monthlyRent: '9999.00' },
          expectedVersion: initialVersion,
          actorUserId: userId,
        }, wrappedTx);
      });

      await expect(failedUpdate).rejects.toThrow('SIMULATED_AUDITLOG_FAILURE');

      // Assert: Room values unchanged
      const afterRm = await prisma.room.findUnique({ where: { id: rm.id } });
      expect(afterRm?.monthlyRent.toString()).toBe(initialRent);

      // Assert: Room version unchanged
      expect(afterRm?.version).toBe(initialVersion);

      // Assert: No ROOM_UPDATED AuditLog committed
      const auditAfter = await prisma.auditLog.count({
        where: { entityId: rm.id, action: 'ROOM_UPDATED' },
      });
      expect(auditAfter).toBe(auditBefore);
    });
  });

  describe('4. Real PostgreSQL Reconciliation', () => {
    it('successfully normalizes non-conflicting rooms on PostgreSQL without deleting or renaming', async () => {
      const recDormId = randomUUID();
      await createDormitoryWithSubscription(recDormId, 'Rec Dorm');

      const bld = await buildingService.createBuilding(recDormId, { name: 'Bld Rec' }, userId);

      const r1 = await roomService.createRoom(recDormId, { buildingId: bld.id, roomNumber: 'A101' }, userId);
      const r2 = await roomService.createRoom(recDormId, { buildingId: bld.id, roomNumber: 'B101' }, userId);
      const r3 = await roomService.createRoom(recDormId, { buildingId: bld.id, roomNumber: ' B   201 ' }, userId);
      const r4 = await roomService.createRoom(recDormId, { buildingId: bld.id, roomNumber: '1/1' }, userId);

      const res = await reconcileRoomNormalization(undefined, recDormId);

      expect(res.success).toBe(true);
      expect(res.conflicts).toHaveLength(0);

      const freshR1 = await prisma.room.findUnique({ where: { id: r1.id } });
      const freshR2 = await prisma.room.findUnique({ where: { id: r2.id } });
      const freshR3 = await prisma.room.findUnique({ where: { id: r3.id } });
      const freshR4 = await prisma.room.findUnique({ where: { id: r4.id } });

      expect(freshR1?.normalizedRoomNumber).toBe('a101');
      expect(freshR2?.normalizedRoomNumber).toBe('b101');
      expect(freshR3?.normalizedRoomNumber).toBe('b 201');
      expect(freshR4?.normalizedRoomNumber).toBe('1/1');

      // Verify room numbers were not changed or erased
      expect(freshR1?.roomNumber).toBe('A101');
      expect(freshR2?.roomNumber).toBe('B101');
      expect(freshR3?.roomNumber).toBe(' B   201 ');
      expect(freshR4?.roomNumber).toBe('1/1');
    });

    it('aborts reconciliation on duplicate normalized room numbers within same Dormitory', async () => {
      const recConfDormId = randomUUID();
      await createDormitoryWithSubscription(recConfDormId, 'Rec Conf Dorm');

      const bld1 = await buildingService.createBuilding(recConfDormId, { name: 'Bld 1' }, userId);
      const bld2 = await buildingService.createBuilding(recConfDormId, { name: 'Bld 2' }, userId);

      // Bypassing normalizer check on insertion to force pre-existing conflict in database
      const r1 = await prisma.room.create({
        data: {
          id: randomUUID(),
          dormitoryId: recConfDormId,
          buildingId: bld1.id,
          roomNumber: 'A101',
          normalizedRoomNumber: 'legacy_a101',
          roomType: 'standard',
          monthlyRent: '0.00',
          depositAmount: '0.00',
          parkingFee: '0.00',
          version: 1,
        },
      });

      const r2 = await prisma.room.create({
        data: {
          id: randomUUID(),
          dormitoryId: recConfDormId,
          buildingId: bld2.id,
          roomNumber: 'a101',
          normalizedRoomNumber: 'legacy_a101_dup',
          roomType: 'standard',
          monthlyRent: '0.00',
          depositAmount: '0.00',
          parkingFee: '0.00',
          version: 1,
        },
      });

      const res = await reconcileRoomNormalization(undefined, recConfDormId);

      expect(res.success).toBe(false);
      expect(res.conflicts.length).toBeGreaterThanOrEqual(2);

      const conflictIds = res.conflicts.map((c) => c.roomId);
      expect(conflictIds).toContain(r1.id);
      expect(conflictIds).toContain(r2.id);

      // Verify no normalized values were updated
      const freshR1 = await prisma.room.findUnique({ where: { id: r1.id } });
      const freshR2 = await prisma.room.findUnique({ where: { id: r2.id } });

      expect(freshR1?.normalizedRoomNumber).toBe('legacy_a101');
      expect(freshR2?.normalizedRoomNumber).toBe('legacy_a101_dup');
    });
  });
});
