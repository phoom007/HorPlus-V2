import { getPrismaClient } from '../db/prisma.js';
import { AppError } from '../types/index.js';

export interface EffectiveValueResult<T> {
  value: T;
  source: 'DORMITORY' | 'BUILDING' | 'ROOM';
  sourceVersion: number;
}

export interface EffectiveRoomDefaults {
  dormitoryId: string;
  buildingId: string;
  roomId: string;
  exactRoomNumber: string;
  monthlyRent: EffectiveValueResult<number>;
  termRent: EffectiveValueResult<number | null>;
  dailyRent: EffectiveValueResult<number | null>;
  depositAmount: EffectiveValueResult<number>;
  advancePaymentAmount: EffectiveValueResult<number>;
  parkingFee: EffectiveValueResult<number>;
  waterRate: EffectiveValueResult<number>;
  electricityRate: EffectiveValueResult<number>;
  commonFee: EffectiveValueResult<number>;
  internetFee: EffectiveValueResult<number>;
  waterBillingType: EffectiveValueResult<string>;
  electricityBillingType: EffectiveValueResult<string>;
  rentBillingType: EffectiveValueResult<string>;
  maximumOccupants: EffectiveValueResult<number>;
  roomType: EffectiveValueResult<string>;
  defaultTerms: EffectiveValueResult<string | null>;
  sourceVersions: {
    dormitoryBillingVersion: number;
    dormitoryPropertyVersion: number;
    buildingVersion: number;
    roomVersion: number;
  };
  resolvedAt: string;
}

export class DefaultsService {
  /**
   * Resolves effective property and billing defaults for a specific Room
   * Hierarchy: DormitoryDefaults -> Building overrides -> Room overrides
   */
  public async resolveEffectiveRoomDefaults(
    dormitoryId: string,
    buildingId: string,
    roomId: string,
    txClient?: any
  ): Promise<EffectiveRoomDefaults> {
    const prisma = txClient || getPrismaClient();

    // 1. Fetch Dormitory Billing Settings & Property Defaults
    const billingSettings = await prisma.dormitoryBillingSettings.findUnique({
      where: { dormitoryId },
    });
    const propertyDefaults = await prisma.dormitoryPropertyDefaults.findUnique({
      where: { dormitoryId },
    });

    // 2. Fetch Building
    const building = await prisma.building.findFirst({
      where: { id: buildingId, dormitoryId },
    });
    if (!building) {
      throw new AppError('ไม่พบข้อมูลอาคารที่ระบุ', 404, 'BUILDING_NOT_FOUND');
    }

    // 3. Fetch Room
    const room = await prisma.room.findFirst({
      where: { id: roomId, dormitoryId, buildingId },
    });
    if (!room) {
      throw new AppError('ไม่พบข้อมูลห้องพักที่ระบุ', 404, 'ROOM_NOT_FOUND');
    }

    const dormBillVer = billingSettings?.version || 1;
    const dormPropVer = propertyDefaults?.version || 1;
    const bldVer = building.version || 1;
    const rmVer = room.version || 1;

    // Helper resolver: room value (if !== null/undefined) -> building value (if !== null/undefined) -> dorm value
    const resolveField = <T>(
      roomVal: any,
      buildingVal: any,
      dormVal: T,
      dormVer: number,
      parseFn: (v: any) => T = (v) => Number(v) as any
    ): EffectiveValueResult<T> => {
      if (roomVal !== null && roomVal !== undefined) {
        return { value: parseFn(roomVal), source: 'ROOM', sourceVersion: rmVer };
      }
      if (buildingVal !== null && buildingVal !== undefined) {
        return { value: parseFn(buildingVal), source: 'BUILDING', sourceVersion: bldVer };
      }
      return { value: parseFn(dormVal), source: 'DORMITORY', sourceVersion: dormVer };
    };

    return {
      dormitoryId,
      buildingId,
      roomId,
      exactRoomNumber: room.roomNumber,
      monthlyRent: resolveField(
        room.monthlyRent,
        building.monthlyRent,
        propertyDefaults?.defaultMonthlyRent || 0,
        dormPropVer
      ),
      termRent: resolveField(
        room.termRent,
        building.termRent,
        propertyDefaults?.defaultTermRent || null,
        dormPropVer,
        (v) => (v !== null && v !== undefined ? Number(v) : null)
      ),
      dailyRent: resolveField(
        room.dailyRent,
        building.dailyRent,
        propertyDefaults?.defaultDailyRent || null,
        dormPropVer,
        (v) => (v !== null && v !== undefined ? Number(v) : null)
      ),
      depositAmount: resolveField(
        room.depositAmount,
        building.depositAmount,
        propertyDefaults?.defaultDeposit || 0,
        dormPropVer
      ),
      advancePaymentAmount: resolveField(
        room.advancePaymentAmount,
        building.advancePaymentAmount,
        propertyDefaults?.defaultAdvancePayment || 0,
        dormPropVer
      ),
      parkingFee: resolveField(
        room.parkingFee,
        building.parkingFee,
        propertyDefaults?.defaultParkingFee || 0,
        dormPropVer
      ),
      waterRate: resolveField(
        room.waterRate,
        building.waterRate,
        billingSettings?.waterRate || 0,
        dormBillVer
      ),
      electricityRate: resolveField(
        room.electricityRate,
        building.electricityRate,
        billingSettings?.electricityRate || 0,
        dormBillVer
      ),
      commonFee: resolveField(
        room.commonFee,
        building.commonFee,
        billingSettings?.commonFee || 0,
        dormBillVer
      ),
      internetFee: resolveField(
        room.internetFee,
        building.internetFee,
        billingSettings?.internetFee || 0,
        dormBillVer
      ),
      waterBillingType: resolveField(
        room.waterBillingType,
        building.waterBillingType,
        billingSettings?.waterBillingType || 'per_unit',
        dormBillVer,
        (v) => String(v)
      ),
      electricityBillingType: resolveField(
        room.electricityBillingType,
        building.electricityBillingType,
        billingSettings?.electricityBillingType || 'per_unit',
        dormBillVer,
        (v) => String(v)
      ),
      rentBillingType: resolveField(
        room.rentBillingType,
        building.rentBillingType,
        billingSettings?.rentBillingType || 'monthly',
        dormBillVer,
        (v) => String(v)
      ),
      maximumOccupants: resolveField(
        room.maximumOccupants,
        building.maximumOccupants,
        propertyDefaults?.defaultMaxOccupants || 2,
        dormPropVer,
        (v) => Number(v)
      ),
      roomType: resolveField(
        room.roomType,
        building.roomType,
        propertyDefaults?.defaultRoomType || 'standard',
        dormPropVer,
        (v) => String(v)
      ),
      defaultTerms: resolveField(
        null,
        null,
        propertyDefaults?.defaultTerms || null,
        dormPropVer,
        (v) => (v ? String(v) : null)
      ),
      sourceVersions: {
        dormitoryBillingVersion: dormBillVer,
        dormitoryPropertyVersion: dormPropVer,
        buildingVersion: bldVer,
        roomVersion: rmVer,
      },
      resolvedAt: new Date().toISOString(),
    };
  }

  /**
   * Preview propagation of Dormitory/Building default changes to candidate rooms
   */
  public async previewDefaultPropagation(
    dormitoryId: string,
    scope: 'DORMITORY' | 'BUILDING',
    scopeId?: string,
    proposedChanges: Record<string, any> = {},
    txClient?: any
  ) {
    const prisma = txClient || getPrismaClient();

    let rooms: any[] = [];
    if (scope === 'BUILDING' && scopeId) {
      rooms = await prisma.room.findMany({
        where: { dormitoryId, buildingId: scopeId },
        include: { contracts: { where: { status: { in: ['active', 'approved'] } } } },
      });
    } else {
      rooms = await prisma.room.findMany({
        where: { dormitoryId },
        include: { contracts: { where: { status: { in: ['active', 'approved'] } } } },
      });
    }

    const totalCandidateRooms = rooms.length;
    let eligibleCount = 0;
    let skippedOverrideCount = 0;
    let skippedProtectedContractCount = 0;
    let skippedArchivedCount = 0;

    const fieldEffects: Array<{
      field: string;
      oldEffectiveValue: any;
      newEffectiveValue: any;
      sourceBefore: string;
      sourceAfter: string;
    }> = [];

    for (const room of rooms) {
      if (room.status === 'archived' || room.deletedAt) {
        skippedArchivedCount++;
        continue;
      }

      if (room.contracts && room.contracts.length > 0) {
        skippedProtectedContractCount++;
        continue;
      }

      // Check if room has explicit overrides on key financial fields
      const hasOverride =
        room.monthlyRent !== null ||
        room.depositAmount !== null ||
        room.waterRate !== null ||
        room.electricityRate !== null;

      if (hasOverride) {
        skippedOverrideCount++;
      } else {
        eligibleCount++;
      }
    }

    // Calculate per-field proposed changes if proposedChanges supplied
    for (const [key, value] of Object.entries(proposedChanges)) {
      fieldEffects.push({
        field: key,
        oldEffectiveValue: null,
        newEffectiveValue: value,
        sourceBefore: scope,
        sourceAfter: scope,
      });
    }

    return {
      scope,
      scopeId: scopeId || null,
      totalCandidateRooms,
      eligibleRooms: eligibleCount,
      skippedOverrideRooms: skippedOverrideCount,
      skippedProtectedContractRooms: skippedProtectedContractCount,
      skippedArchivedRooms: skippedArchivedCount,
      proposedChanges,
      fieldEffects,
    };
  }

  /**
   * Bulk apply defaults propagation with advisory lock and idempotency key
   */
  public async applyDefaultPropagation(
    dormitoryId: string,
    scope: 'DORMITORY' | 'BUILDING',
    scopeId: string | undefined,
    changes: Record<string, any>,
    expectedVersion: number | undefined,
    idempotencyKey: string,
    actorUserId: string
  ) {
    const prisma = getPrismaClient();

    // Canonical JSON stringification for key matching
    const canonicalizeJson = (obj: any): string => {
      if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
      if (Array.isArray(obj)) return '[' + obj.map(canonicalizeJson).join(',') + ']';
      const keys = Object.keys(obj).sort();
      return '{' + keys.map((k) => `${JSON.stringify(k)}:${canonicalizeJson(obj[k])}`).join(',') + '}';
    };

    const requestHash = canonicalizeJson({ dormitoryId, scope, scopeId, changes });

    // 1. Idempotency Check using IdempotencyKey model
    const existingKey = await prisma.idempotencyKey.findFirst({
      where: {
        userId: actorUserId,
        operation: 'BULK_DEFAULT_APPLY',
        idempotencyKey,
      },
    });

    if (existingKey) {
      if (existingKey.requestHash !== requestHash) {
        throw new AppError(
          'Idempotency key ซ้ำแต่ข้อมูลไม่ตรงกับรายการเดิม',
          409,
          'IDEMPOTENCY_MISMATCH'
        );
      }
      return existingKey.responseBody;
    }

    // 2. Transaction with PostgreSQL Advisory Lock
    const result = await prisma.$transaction(async (tx: any) => {
      // Lock dormitory using PostgreSQL advisory lock
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${dormitoryId}))`;

      // Verify scope version and apply updates
      if (scope === 'DORMITORY') {
        const currentDefaults = await tx.dormitoryPropertyDefaults.findUnique({
          where: { dormitoryId },
        });

        if (expectedVersion !== undefined && currentDefaults && currentDefaults.version !== expectedVersion) {
          const err: any = new AppError('ข้อมูลถูกแก้ไขโดยผู้อื่น กรุณาโหลดข้อมูลใหม่', 409, 'VERSION_CONFLICT');
          err.currentVersion = currentDefaults.version;
          throw err;
        }

        if (currentDefaults) {
          const updateRes = await tx.dormitoryPropertyDefaults.updateMany({
            where: { dormitoryId, version: expectedVersion ?? currentDefaults.version },
            data: { ...changes, version: { increment: 1 } },
          });

          if (updateRes.count === 0) {
            const safeCurrent = await tx.dormitoryPropertyDefaults.findUnique({ where: { dormitoryId } });
            const err: any = new AppError('ข้อมูลถูกแก้ไขโดยผู้อื่น กรุณาโหลดข้อมูลใหม่', 409, 'VERSION_CONFLICT');
            err.currentVersion = safeCurrent?.version || 1;
            throw err;
          }
        } else {
          await tx.dormitoryPropertyDefaults.create({
            data: { dormitoryId, ...changes, version: 1 },
          });
        }
      } else if (scope === 'BUILDING' && scopeId) {
        const currentBld = await tx.building.findFirst({
          where: { id: scopeId, dormitoryId },
        });

        if (!currentBld) {
          throw new AppError('ไม่พบข้อมูลอาคารที่ระบุ', 404, 'BUILDING_NOT_FOUND');
        }

        if (expectedVersion !== undefined && currentBld.version !== expectedVersion) {
          const err: any = new AppError('ข้อมูลอาคารถูกแก้ไขโดยผู้อื่น กรุณาโหลดข้อมูลใหม่', 409, 'VERSION_CONFLICT');
          err.currentVersion = currentBld.version;
          throw err;
        }

        const updateRes = await tx.building.updateMany({
          where: { id: scopeId, dormitoryId, version: expectedVersion ?? currentBld.version },
          data: { ...changes, version: { increment: 1 } },
        });

        if (updateRes.count === 0) {
          const safeCurrent = await tx.building.findFirst({ where: { id: scopeId, dormitoryId } });
          const err: any = new AppError('ข้อมูลอาคารถูกแก้ไขโดยผู้อื่น กรุณาโหลดข้อมูลใหม่', 409, 'VERSION_CONFLICT');
          err.currentVersion = safeCurrent?.version || 1;
          throw err;
        }
      }

      const preview = await this.previewDefaultPropagation(dormitoryId, scope, scopeId, changes, tx);

      // Audit log entry for bulk apply
      const auditLog = await tx.auditLog.create({
        data: {
          dormitoryId,
          actorUserId,
          entityType: scope === 'BUILDING' ? 'BUILDING' : 'PROPERTY_DEFAULTS',
          entityId: scopeId || dormitoryId,
          action: 'BULK_DEFAULT_APPLY',
          beforeValues: null,
          afterValues: changes,
          reason: `Applied bulk default propagation to ${scope}`,
          idempotencyKey,
        },
      });

      const responsePayload = {
        success: true,
        scope,
        scopeId: scopeId || null,
        appliedRooms: preview.eligibleRooms,
        skippedOverrideRooms: preview.skippedOverrideRooms,
        skippedProtectedContractRooms: preview.skippedProtectedContractRooms,
        skippedArchivedRooms: preview.skippedArchivedRooms,
        fieldEffects: preview.fieldEffects,
        auditLogId: auditLog.id,
        appliedAt: new Date().toISOString(),
      };

      // Record Idempotency Key
      await tx.idempotencyKey.create({
        data: {
          userId: actorUserId,
          operation: 'BULK_DEFAULT_APPLY',
          idempotencyKey,
          requestHash,
          status: 'completed',
          responseStatus: 200,
          responseBody: responsePayload,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h expiration
        },
      });

      return responsePayload;
    });

    return result;
  }
}

export const defaultsService = new DefaultsService();

