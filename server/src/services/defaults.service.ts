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
      roomId: string;
      roomNumber: string;
      oldEffectiveValue: any;
      newEffectiveValue: any;
      sourceBefore: string;
      sourceAfter: string;
      eligible: boolean;
      skipReason?: string;
    }> = [];

    for (const room of rooms) {
      if (room.status === 'archived' || room.deletedAt) {
        skippedArchivedCount++;
        continue;
      }

      const hasProtectedContract = room.contracts && room.contracts.length > 0;
      if (hasProtectedContract) {
        skippedProtectedContractCount++;
      }

      // Resolve effective values for current room state
      const effectiveBefore = await this.resolveEffectiveRoomDefaults(
        dormitoryId,
        room.buildingId,
        room.id,
        prisma
      );

      for (const [key, value] of Object.entries(proposedChanges)) {
        // Map property schema field name to room property name if applicable
        const fieldName = key.startsWith('default')
          ? key.replace(/^default/, '').charAt(0).toLowerCase() + key.replace(/^default/, '').slice(1)
          : key;

        const beforeResult = (effectiveBefore as any)[fieldName] || { value: null, source: 'DORMITORY' };
        const oldVal = beforeResult.value;
        const sourceBefore = beforeResult.source;

        // Field-level override check: Has the room set an explicit override for this exact field?
        const isFieldOverriddenAtRoom = (room as any)[fieldName] !== undefined && (room as any)[fieldName] !== null;

        let eligible = true;
        let skipReason: string | undefined = undefined;

        if (hasProtectedContract) {
          eligible = false;
          skipReason = 'PROTECTED_CONTRACT';
        } else if (isFieldOverriddenAtRoom) {
          eligible = false;
          skipReason = 'EXPLICIT_ROOM_OVERRIDE';
        }

        if (eligible) {
          eligibleCount++;
        } else if (skipReason === 'EXPLICIT_ROOM_OVERRIDE') {
          skippedOverrideCount++;
        }

        fieldEffects.push({
          field: key,
          roomId: room.id,
          roomNumber: room.roomNumber,
          oldEffectiveValue: oldVal,
          newEffectiveValue: eligible ? value : oldVal,
          sourceBefore,
          sourceAfter: eligible ? scope : sourceBefore,
          eligible,
          skipReason,
        });
      }
    }

    const eligibleFieldChangeCount = fieldEffects.filter((f) => f.eligible).length;
    const skippedFieldChangeCount = fieldEffects.filter((f) => !f.eligible).length;

    return {
      scope,
      scopeId: scopeId || null,
      candidateRoomCount: totalCandidateRooms,
      eligibleRoomCount: eligibleCount,
      eligibleFieldChangeCount,
      skippedRoomCount: totalCandidateRooms - eligibleCount,
      skippedFieldChangeCount,
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

    const requestHash = canonicalizeJson({ dormitoryId, scope, scopeId, changes, expectedVersion });

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

  /**
   * Builds server-authoritative Room response object including effective values,
   * field sources (DORMITORY, BUILDING, ROOM, CONTRACT_SNAPSHOT), and snapshot locking metadata.
   */
  public async buildAuthoritativeRoomResponse(
    dormitoryId: string,
    room: any,
    txClient?: any
  ) {
    const prisma = txClient || getPrismaClient();

    const building = await prisma.building.findFirst({
      where: { id: room.buildingId, dormitoryId },
    });

    const effective = await this.resolveEffectiveRoomDefaults(
      dormitoryId,
      room.buildingId,
      room.id,
      prisma
    );

    const activeContract = await prisma.contract.findFirst({
      where: {
        roomId: room.id,
        dormitoryId,
        status: { in: ['active', 'approved', 'expiring_soon', 'waiting_extension', 'checking_out'] },
        deletedAt: null,
      },
      include: { snapshot: true },
    });

    const snapshotLocked = !!(activeContract && activeContract.snapshot);
    const activeContractSnapshotId = activeContract?.snapshot?.id || null;

    const rawOverrides = {
      monthlyRent: room.monthlyRent !== null && room.monthlyRent !== undefined ? String(room.monthlyRent) : null,
      termRent: room.termRent !== null && room.termRent !== undefined ? String(room.termRent) : null,
      dailyRent: room.dailyRent !== null && room.dailyRent !== undefined ? String(room.dailyRent) : null,
      depositAmount: room.depositAmount !== null && room.depositAmount !== undefined ? String(room.depositAmount) : null,
      advancePaymentAmount: room.advancePaymentAmount !== null && room.advancePaymentAmount !== undefined ? String(room.advancePaymentAmount) : null,
      parkingFee: room.parkingFee !== null && room.parkingFee !== undefined ? String(room.parkingFee) : null,
      waterRate: room.waterRate !== null && room.waterRate !== undefined ? String(room.waterRate) : null,
      electricityRate: room.electricityRate !== null && room.electricityRate !== undefined ? String(room.electricityRate) : null,
      commonFee: room.commonFee !== null && room.commonFee !== undefined ? String(room.commonFee) : null,
      internetFee: room.internetFee !== null && room.internetFee !== undefined ? String(room.internetFee) : null,
      waterBillingType: room.waterBillingType || null,
      electricityBillingType: room.electricityBillingType || null,
      rentBillingType: room.rentBillingType || null,
      maximumOccupants: room.maximumOccupants || null,
      roomType: room.roomType || null,
    };

    const currentEffectiveValues = {
      monthlyRent: effective.monthlyRent.value,
      termRent: effective.termRent.value,
      dailyRent: effective.dailyRent.value,
      depositAmount: effective.depositAmount.value,
      advancePaymentAmount: effective.advancePaymentAmount.value,
      parkingFee: effective.parkingFee.value,
      waterRate: effective.waterRate.value,
      electricityRate: effective.electricityRate.value,
      commonFee: effective.commonFee.value,
      internetFee: effective.internetFee.value,
      waterBillingType: effective.waterBillingType.value,
      electricityBillingType: effective.electricityBillingType.value,
      rentBillingType: effective.rentBillingType.value,
      maximumOccupants: effective.maximumOccupants.value,
      roomType: effective.roomType.value,
    };

    const currentFieldSources = {
      monthlyRent: effective.monthlyRent.source,
      termRent: effective.termRent.source,
      dailyRent: effective.dailyRent.source,
      depositAmount: effective.depositAmount.source,
      advancePaymentAmount: effective.advancePaymentAmount.source,
      parkingFee: effective.parkingFee.source,
      waterRate: effective.waterRate.source,
      electricityRate: effective.electricityRate.source,
      commonFee: effective.commonFee.source,
      internetFee: effective.internetFee.source,
      waterBillingType: effective.waterBillingType.source,
      electricityBillingType: effective.electricityBillingType.source,
      rentBillingType: effective.rentBillingType.source,
      maximumOccupants: effective.maximumOccupants.source,
      roomType: effective.roomType.source,
    };

    const contractSnapshot = activeContract?.snapshot ? {
      snapshotId: activeContract.snapshot.id,
      contractId: activeContract.id,
      lockedAt: activeContract.snapshot.lockedAt,
      lockedByUserId: activeContract.snapshot.lockedByUserId,
      values: {
        monthlyRent: Number(activeContract.snapshot.resolvedRent),
        depositAmount: Number(activeContract.snapshot.resolvedDeposit),
        advancePaymentAmount: Number(activeContract.snapshot.resolvedAdvancePayment),
        waterRate: Number(activeContract.snapshot.resolvedWaterRate),
        electricityRate: Number(activeContract.snapshot.resolvedElectricityRate),
        commonFee: Number(activeContract.snapshot.resolvedCommonFee),
        internetFee: Number(activeContract.snapshot.resolvedInternetFee),
        parkingFee: Number(activeContract.snapshot.resolvedParkingFee),
        waterBillingType: activeContract.snapshot.waterBillingType,
        electricityBillingType: activeContract.snapshot.electricityBillingType,
        rentBillingType: activeContract.snapshot.rentBillingType,
      },
      sourceVersions: activeContract.snapshot.sourceVersions,
    } : null;

    return {
      id: room.id,
      dormitoryId: room.dormitoryId,
      buildingId: room.buildingId,
      buildingName: building ? building.name : (room.buildingName || 'Building'),
      roomNumber: room.roomNumber,
      normalizedRoomNumber: room.normalizedRoomNumber,
      status: room.status,
      version: room.version,
      rawOverrides,
      currentEffectiveValues,
      effectiveValues: currentEffectiveValues,
      currentFieldSources,
      fieldSources: currentFieldSources,
      currentSourceVersions: effective.sourceVersions,
      sourceVersions: effective.sourceVersions,
      snapshotLocked,
      activeContractSnapshotId,
      contractSnapshot,
      updatedAt: room.updatedAt,
      floor: room.floor,
      rentCycle: room.rentCycle,
      waterMeterNumber: room.waterMeterNumber,
      electricityMeterNumber: room.electricityMeterNumber,
      initialWaterReading: room.initialWaterReading,
      initialElectricityReading: room.initialElectricityReading,
      amenities: room.amenities,
      images: room.images,
      notes: room.notes,
      currentTenantId: room.currentTenantId,
      currentContractId: room.currentContractId,
      createdAt: room.createdAt,
    };
  }

  /**
   * Builds server-authoritative Building response object including effective defaults
   * and field sources.
   */
  public async buildAuthoritativeBuildingResponse(
    dormitoryId: string,
    building: any,
    txClient?: any
  ) {
    const prisma = txClient || getPrismaClient();

    const billingSettings = await prisma.dormitoryBillingSettings.findUnique({
      where: { dormitoryId },
    });
    const propertyDefaults = await prisma.dormitoryPropertyDefaults.findUnique({
      where: { dormitoryId },
    });

    const rawOverrides = {
      monthlyRent: building.monthlyRent !== null && building.monthlyRent !== undefined ? String(building.monthlyRent) : null,
      termRent: building.termRent !== null && building.termRent !== undefined ? String(building.termRent) : null,
      dailyRent: building.dailyRent !== null && building.dailyRent !== undefined ? String(building.dailyRent) : null,
      depositAmount: building.depositAmount !== null && building.depositAmount !== undefined ? String(building.depositAmount) : null,
      advancePaymentAmount: building.advancePaymentAmount !== null && building.advancePaymentAmount !== undefined ? String(building.advancePaymentAmount) : null,
      parkingFee: building.parkingFee !== null && building.parkingFee !== undefined ? String(building.parkingFee) : null,
      waterRate: building.waterRate !== null && building.waterRate !== undefined ? String(building.waterRate) : null,
      electricityRate: building.electricityRate !== null && building.electricityRate !== undefined ? String(building.electricityRate) : null,
      commonFee: building.commonFee !== null && building.commonFee !== undefined ? String(building.commonFee) : null,
      internetFee: building.internetFee !== null && building.internetFee !== undefined ? String(building.internetFee) : null,
      waterBillingType: building.waterBillingType || null,
      electricityBillingType: building.electricityBillingType || null,
      rentBillingType: building.rentBillingType || null,
      maximumOccupants: building.maximumOccupants || null,
      roomType: building.roomType || null,
    };

    const resolveBldField = <T>(bldVal: any, dormVal: any, parseFn: (v: any) => T = (v) => Number(v) as any) => {
      if (bldVal !== null && bldVal !== undefined) {
        return { value: parseFn(bldVal), source: 'BUILDING' as const };
      }
      return { value: parseFn(dormVal), source: 'DORMITORY' as const };
    };

    const monthlyRentRes = resolveBldField(building.monthlyRent, propertyDefaults?.defaultMonthlyRent || 0);
    const termRentRes = resolveBldField(building.termRent, propertyDefaults?.defaultTermRent || null, (v) => (v ? Number(v) : null));
    const dailyRentRes = resolveBldField(building.dailyRent, propertyDefaults?.defaultDailyRent || null, (v) => (v ? Number(v) : null));
    const depositRes = resolveBldField(building.depositAmount, propertyDefaults?.defaultDeposit || 0);
    const advanceRes = resolveBldField(building.advancePaymentAmount, propertyDefaults?.defaultAdvancePayment || 0);
    const parkingRes = resolveBldField(building.parkingFee, propertyDefaults?.defaultParkingFee || 0);
    const waterRateRes = resolveBldField(building.waterRate, billingSettings?.waterRate || 0);
    const elecRateRes = resolveBldField(building.electricityRate, billingSettings?.electricityRate || 0);
    const commonFeeRes = resolveBldField(building.commonFee, billingSettings?.commonFee || 0);
    const internetFeeRes = resolveBldField(building.internetFee, billingSettings?.internetFee || 0);
    const waterBillingTypeRes = resolveBldField(building.waterBillingType, billingSettings?.waterBillingType || 'per_unit', (v) => String(v));
    const elecBillingTypeRes = resolveBldField(building.electricityBillingType, billingSettings?.electricityBillingType || 'per_unit', (v) => String(v));
    const rentBillingTypeRes = resolveBldField(building.rentBillingType, billingSettings?.rentBillingType || 'monthly', (v) => String(v));
    const maxOccupantsRes = resolveBldField(building.maximumOccupants, propertyDefaults?.defaultMaxOccupants || 2, (v) => Number(v));
    const roomTypeRes = resolveBldField(building.roomType, propertyDefaults?.defaultRoomType || 'standard', (v) => String(v));

    const effectiveDefaults = {
      monthlyRent: monthlyRentRes.value,
      termRent: termRentRes.value,
      dailyRent: dailyRentRes.value,
      depositAmount: depositRes.value,
      advancePaymentAmount: advanceRes.value,
      parkingFee: parkingRes.value,
      waterRate: waterRateRes.value,
      electricityRate: elecRateRes.value,
      commonFee: commonFeeRes.value,
      internetFee: internetFeeRes.value,
      waterBillingType: waterBillingTypeRes.value,
      electricityBillingType: elecBillingTypeRes.value,
      rentBillingType: rentBillingTypeRes.value,
      maximumOccupants: maxOccupantsRes.value,
      roomType: roomTypeRes.value,
    };

    const fieldSources = {
      monthlyRent: monthlyRentRes.source,
      termRent: termRentRes.source,
      dailyRent: dailyRentRes.source,
      depositAmount: depositRes.source,
      advancePaymentAmount: advanceRes.source,
      parkingFee: parkingRes.source,
      waterRate: waterRateRes.source,
      electricityRate: elecRateRes.source,
      commonFee: commonFeeRes.source,
      internetFee: internetFeeRes.source,
      waterBillingType: waterBillingTypeRes.source,
      electricityBillingType: elecBillingTypeRes.source,
      rentBillingType: rentBillingTypeRes.source,
      maximumOccupants: maxOccupantsRes.source,
      roomType: roomTypeRes.source,
    };

    return {
      id: building.id,
      dormitoryId: building.dormitoryId,
      name: building.name,
      code: building.code,
      floorCount: building.floorCount,
      roomsPerFloor: building.roomsPerFloor,
      numberingPattern: building.numberingPattern,
      description: building.description,
      status: building.status,
      displayOrder: building.displayOrder,
      version: building.version,
      rawOverrides,
      effectiveDefaults,
      fieldSources,
      updatedAt: building.updatedAt,
      createdAt: building.createdAt,
    };
  }
}

export const defaultsService = new DefaultsService();

