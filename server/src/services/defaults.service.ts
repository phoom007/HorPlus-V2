import crypto from 'crypto';
import { getPrismaClient } from '../db/prisma.js';
import { AppError } from '../types/index.js';
import { BLOCKING_CONTRACT_STATUSES } from './blocking-contract-policy.js';
import { normalizeUtilityBillingMode } from '../utils/billing-mode-normalizer.util.js';
import {
  getContractPhysicalInterval,
  getProvisionalTermPhysicalInterval,
  getDailyStayPhysicalInterval,
  PhysicalInterval,
} from '../utils/occupancy-interval.util.js';

export function valuesEquivalent(val1: any, val2: any): boolean {
  if (val1 === val2) return true;
  if (val1 === null || val1 === undefined || val2 === null || val2 === undefined) {
    return val1 === val2;
  }
  if (typeof val1 === 'object' && typeof val2 === 'object') {
    if (typeof val1.toNumber === 'function' && typeof val2.toNumber === 'function') {
      return Math.abs(val1.toNumber() - val2.toNumber()) < 0.000001;
    }
    return JSON.stringify(val1) === JSON.stringify(val2);
  }
  const str1 = typeof val1 === 'object' && val1 !== null && typeof val1.toString === 'function' ? val1.toString() : String(val1);
  const str2 = typeof val2 === 'object' && val2 !== null && typeof val2.toString === 'function' ? val2.toString() : String(val2);
  if (str1 === str2) return true;

  const n1 = Number(str1);
  const n2 = Number(str2);
  if (!isNaN(n1) && !isNaN(n2)) {
    return Math.abs(n1 - n2) < 0.000001;
  }
  return str1.trim() === str2.trim();
}

export function pickChangedFields(
  currentRecord: Record<string, any> | null | undefined,
  proposedChanges: Record<string, any> | null | undefined
): { changedFields: string[]; changedValues: Record<string, any> } {
  const changedFields: string[] = [];
  const changedValues: Record<string, any> = {};

  if (!currentRecord || !proposedChanges) {
    return { changedFields, changedValues };
  }

  for (const [key, newValue] of Object.entries(proposedChanges)) {
    if (newValue === undefined) continue;
    const oldValue = (currentRecord as any)[key];
    if (!valuesEquivalent(oldValue, newValue)) {
      changedFields.push(key);
      changedValues[key] = newValue;
    }
  }

  return { changedFields, changedValues };
}

export interface EffectiveValueResult<T> {
  value: T;
  source: 'DORMITORY' | 'BUILDING' | 'ROOM';
  sourceVersion: number;
}


export function isNowInsidePhysicalInterval(interval: PhysicalInterval, now: Date): boolean {
  const t = now.getTime();
  return interval.start.getTime() <= t && t < interval.end.getTime();
}

export function resolveCurrentActiveRentalSummary(
  roomId: string,
  contracts: any[],
  provisionals: any[],
  dailyStays: any[],
  now: Date = new Date()
): { activeRentalSummary: ActiveRentalSummary | null; activeContract: any | null } {
  // 1. Physically active Contracts
  const activeContracts = (contracts || []).filter((c: any) => {
    if (c.roomId !== roomId) return false;
    if (!['active', 'approved', 'expiring_soon', 'waiting_extension', 'checking_out'].includes(c.status)) return false;
    const interval = getContractPhysicalInterval(c);
    return isNowInsidePhysicalInterval(interval, now);
  });

  // 2. Physically active Provisional terms (status === 'ACTIVE' only)
  const activeProvisionals = (provisionals || []).filter((p: any) => {
    if (p.roomId !== roomId || p.status !== 'ACTIVE') return false;
    const interval = getProvisionalTermPhysicalInterval(p);
    return isNowInsidePhysicalInterval(interval, now);
  });

  // 3. Physically active Daily stays (status === 'ACTIVE' or 'CHECKED_IN' only)
  const activeDailyStays = (dailyStays || []).filter((d: any) => {
    if (d.roomId !== roomId) return false;
    if (d.status !== 'ACTIVE' && d.status !== 'CHECKED_IN') return false;
    const interval = getDailyStayPhysicalInterval(d);
    return isNowInsidePhysicalInterval(interval, now);
  });

  const totalActive = activeContracts.length + activeProvisionals.length + activeDailyStays.length;

  if (totalActive > 1) {
    console.warn(`[SECURITY_DATA_CONFLICT] Multiple active agreements (${totalActive}) detected for room ${roomId}`);
    return { activeRentalSummary: null, activeContract: null };
  }

  if (activeContracts.length === 1) {
    const c = activeContracts[0];
    const billingType = c.snapshot?.rentBillingType || c.rentBillingType || 'monthly';
    const type: 'TERM' | 'MONTHLY' | 'DAILY' = billingType === 'term' ? 'TERM' : (billingType === 'daily' ? 'DAILY' : 'MONTHLY');
    const rentAmount = Number(c.snapshot?.resolvedRent ?? c.rentAmount ?? 0);
    const depositAmount = c.snapshot?.resolvedDeposit !== undefined && c.snapshot?.resolvedDeposit !== null
      ? Number(c.snapshot.resolvedDeposit)
      : (c.depositAmount ? Number(c.depositAmount) : null);
    return {
      activeRentalSummary: {
        type,
        rentAmount,
        depositAmount,
        source: c.snapshot ? 'CONTRACT_SNAPSHOT' : 'CONTRACT',
      },
      activeContract: c,
    };
  }

  if (activeProvisionals.length === 1) {
    const p = activeProvisionals[0];
    const type: 'TERM' | 'MONTHLY' = p.rentalType === 'TERM' ? 'TERM' : 'MONTHLY';
    const rentAmount = Number(type === 'TERM' ? (p.totalRentAmount || p.unitRentAmount) : p.unitRentAmount);
    const depositAmount = p.depositAmount ? Number(p.depositAmount) : null;
    return {
      activeRentalSummary: {
        type,
        rentAmount,
        depositAmount,
        source: 'PROVISIONAL_TERM',
        termInstallmentCount: p.termInstallmentCount || null,
      },
      activeContract: null,
    };
  }

  if (activeDailyStays.length === 1) {
    const d = activeDailyStays[0];
    return {
      activeRentalSummary: {
        type: 'DAILY',
        rentAmount: Number(d.dailyRateAmount),
        depositAmount: d.depositAmount ? Number(d.depositAmount) : null,
        source: 'DAILY_STAY',
      },
      activeContract: null,
    };
  }

  return { activeRentalSummary: null, activeContract: null };
}

export interface ActiveRentalSummary {
  type: 'TERM' | 'MONTHLY' | 'DAILY';
  rentAmount: number;
  depositAmount?: number | null;
  source: 'CONTRACT_SNAPSHOT' | 'CONTRACT' | 'PROVISIONAL_TERM' | 'DAILY_STAY';
  termInstallmentCount?: number | null;
}

export interface EffectiveRoomDefaults {
  dormitoryId: string;
  buildingId: string;
  roomId: string;
  exactRoomNumber: string;
  monthlyRent: EffectiveValueResult<number>;
  termRent: EffectiveValueResult<number | null>;
  dailyRent: EffectiveValueResult<number | null>;
  termDeposit: EffectiveValueResult<number>;
  monthlyDeposit: EffectiveValueResult<number>;
  dailyDeposit: EffectiveValueResult<number>;
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
  billingDay: EffectiveValueResult<number | null>;
  dueDay: EffectiveValueResult<number | null>;
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
      termDeposit: {
        value: (room as any).termDeposit !== null && (room as any).termDeposit !== undefined
          ? Number((room as any).termDeposit)
          : Number(propertyDefaults?.defaultDeposit || 0),
        source: (room as any).termDeposit !== null && (room as any).termDeposit !== undefined ? ('ROOM' as const) : ('DORMITORY' as const),
        sourceVersion: (room as any).termDeposit !== null && (room as any).termDeposit !== undefined ? rmVer : dormPropVer,
      },
      monthlyDeposit: {
        value: (room as any).monthlyDeposit !== null && (room as any).monthlyDeposit !== undefined
          ? Number((room as any).monthlyDeposit)
          : Number(propertyDefaults?.defaultDeposit || 0),
        source: (room as any).monthlyDeposit !== null && (room as any).monthlyDeposit !== undefined ? ('ROOM' as const) : ('DORMITORY' as const),
        sourceVersion: (room as any).monthlyDeposit !== null && (room as any).monthlyDeposit !== undefined ? rmVer : dormPropVer,
      },
      dailyDeposit: {
        value: (room as any).dailyDeposit !== null && (room as any).dailyDeposit !== undefined
          ? Number((room as any).dailyDeposit)
          : Number(propertyDefaults?.defaultDeposit || 0),
        source: (room as any).dailyDeposit !== null && (room as any).dailyDeposit !== undefined ? ('ROOM' as const) : ('DORMITORY' as const),
        sourceVersion: (room as any).dailyDeposit !== null && (room as any).dailyDeposit !== undefined ? rmVer : dormPropVer,
      },
      depositAmount: {
        value: (room as any).monthlyDeposit !== null && (room as any).monthlyDeposit !== undefined
          ? Number((room as any).monthlyDeposit)
          : ((room as any).depositInheritsBuildingDefault === false && room.depositAmount !== null && room.depositAmount !== undefined
              ? Number(room.depositAmount)
              : Number(building?.depositAmount ?? propertyDefaults?.defaultDeposit ?? 0)),
        source: 'ROOM' as const,
        sourceVersion: rmVer,
      },
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
        (v) => normalizeUtilityBillingMode(v)
      ),
      electricityBillingType: resolveField(
        room.electricityBillingType,
        building.electricityBillingType,
        billingSettings?.electricityBillingType || 'per_unit',
        dormBillVer,
        (v) => normalizeUtilityBillingMode(v)
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
      billingDay: resolveField(
        null,
        null,
        billingSettings?.billingDay !== undefined && billingSettings?.billingDay !== null ? billingSettings.billingDay : null,
        dormBillVer,
        (v) => (v !== null && v !== undefined ? Number(v) : null)
      ),
      dueDay: resolveField(
        null,
        null,
        billingSettings?.dueDay !== undefined && billingSettings?.dueDay !== null ? billingSettings.dueDay : null,
        dormBillVer,
        (v) => (v !== null && v !== undefined ? Number(v) : null)
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
    payload: {
      scope: 'DORMITORY' | 'BUILDING';
      scopeId?: string;
      changes: {
        property?: Record<string, any>;
        billing?: Record<string, any>;
        [key: string]: any;
      };
    },
    txClient?: any
  ) {
    const prisma = txClient || getPrismaClient();
    const scope = payload.scope;
    const scopeId = payload.scopeId;

    let expectedVersions: { property?: number; billing?: number } | undefined = undefined;
    let expectedVersion: number | undefined = undefined;

    let proposedChanges: Record<string, any> = {};

    if (scope === 'DORMITORY') {
      const dormProp = await prisma.dormitoryPropertyDefaults.findUnique({ where: { dormitoryId } });
      const dormBill = await prisma.dormitoryBillingSettings.findUnique({ where: { dormitoryId } });

      expectedVersions = {
        property: dormProp?.version || 1,
        billing: dormBill?.version || 1,
      };

      if (payload.changes.property) {
        Object.assign(proposedChanges, payload.changes.property);
      }
      if (payload.changes.billing) {
        Object.assign(proposedChanges, payload.changes.billing);
      }
    } else if (scope === 'BUILDING' && scopeId) {
      const bld = await prisma.building.findFirst({ where: { id: scopeId, dormitoryId } });
      if (!bld) {
        throw new AppError('ไม่พบข้อมูลอาคารที่ระบุ', 404, 'BUILDING_NOT_FOUND');
      }
      expectedVersion = bld.version;
      proposedChanges = payload.changes || {};
    }

    let rooms: any[] = [];
    const roomWhere = scope === 'BUILDING' && scopeId
      ? { dormitoryId, buildingId: scopeId }
      : { dormitoryId };

    rooms = await prisma.room.findMany({
      where: roomWhere,
      include: {
        contracts: {
          where: {
            status: { in: BLOCKING_CONTRACT_STATUSES as any },
          },
        },
      },
    });

    const eligibleRoomIds = new Set<string>();
    const skippedRoomIds = new Set<string>();

    let eligibleFieldChangeCount = 0;
    let skippedFieldChangeCount = 0;

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
      const isArchived = room.status === 'archived' || !!room.deletedAt;
      const hasProtectedContract = room.contracts && room.contracts.length > 0;

      const effectiveBefore = await this.resolveEffectiveRoomDefaults(
        dormitoryId,
        room.buildingId,
        room.id,
        prisma
      );

      for (const [key, value] of Object.entries(proposedChanges)) {
        const fieldName = key.startsWith('default')
          ? key.replace(/^default/, '').charAt(0).toLowerCase() + key.replace(/^default/, '').slice(1)
          : key;

        const beforeResult = (effectiveBefore as any)[fieldName] || { value: null, source: 'DORMITORY' };
        const oldVal = beforeResult.value;
        const sourceBefore = beforeResult.source;

        const isCycleDeposit = fieldName === 'depositAmount' || fieldName === 'defaultDeposit' || fieldName === 'termDeposit' || fieldName === 'monthlyDeposit' || fieldName === 'dailyDeposit';
        const isFieldOverriddenAtRoom = (room as any)[fieldName] !== undefined && (room as any)[fieldName] !== null;

        let eligible = true;
        let skipReason: string | undefined = undefined;

        if (isArchived) {
          eligible = false;
          skipReason = 'ROOM_ARCHIVED';
        } else if (hasProtectedContract) {
          eligible = false;
          skipReason = 'PROTECTED_CONTRACT';
        } else if (isCycleDeposit) {
          eligible = false;
          skipReason = 'ROOM_OWNED_CYCLE_DEPOSIT';
        } else if (isFieldOverriddenAtRoom) {
          eligible = false;
          skipReason = 'EXPLICIT_ROOM_OVERRIDE';
        } else if (valuesEquivalent(oldVal, value)) {
          eligible = false;
          skipReason = 'NO_EFFECTIVE_CHANGE';
        }

        if (eligible) {
          eligibleFieldChangeCount++;
          eligibleRoomIds.add(room.id);
        } else {
          skippedFieldChangeCount++;
        }

        const sourceAfter = eligible ? scope : sourceBefore;

        fieldEffects.push({
          field: key,
          roomId: room.id,
          roomNumber: room.roomNumber,
          oldEffectiveValue: oldVal,
          newEffectiveValue: eligible ? value : oldVal,
          sourceBefore,
          sourceAfter,
          eligible,
          skipReason,
        });
      }
    }

    let propDiff = { changedFields: [] as string[], changedValues: {} as Record<string, any> };
    let billDiff = { changedFields: [] as string[], changedValues: {} as Record<string, any> };
    let bldDiff = { changedFields: [] as string[], changedValues: {} as Record<string, any> };

    const dormProp = scope === 'DORMITORY' ? await prisma.dormitoryPropertyDefaults.findUnique({ where: { dormitoryId } }) : null;
    const dormBill = scope === 'DORMITORY' ? await prisma.dormitoryBillingSettings.findUnique({ where: { dormitoryId } }) : null;
    const currentBld = scope === 'BUILDING' && scopeId ? await prisma.building.findFirst({ where: { id: scopeId, dormitoryId } }) : null;

    if (scope === 'DORMITORY') {
      if (payload.changes.property) {
        propDiff = pickChangedFields(dormProp, payload.changes.property);
      }
      if (payload.changes.billing) {
        billDiff = pickChangedFields(dormBill, payload.changes.billing);
      }
    } else if (scope === 'BUILDING' && currentBld) {
      bldDiff = pickChangedFields(currentBld, payload.changes);
    }

    const isScopeNoOp = scope === 'DORMITORY'
      ? (propDiff.changedFields.length === 0 && billDiff.changedFields.length === 0)
      : (bldDiff.changedFields.length === 0);

    const scopeUpdates = {
      property: {
        updated: propDiff.changedFields.length > 0,
        changedFields: propDiff.changedFields,
        oldVersion: dormProp?.version,
        newVersion: propDiff.changedFields.length > 0 ? (dormProp?.version || 1) + 1 : dormProp?.version,
      },
      billing: {
        updated: billDiff.changedFields.length > 0,
        changedFields: billDiff.changedFields,
        oldVersion: dormBill?.version,
        newVersion: billDiff.changedFields.length > 0 ? (dormBill?.version || 1) + 1 : dormBill?.version,
      },
      building: {
        updated: scope === 'BUILDING' && bldDiff.changedFields.length > 0,
        changedFields: scope === 'BUILDING' ? bldDiff.changedFields : [],
        oldVersion: currentBld?.version,
        newVersion: scope === 'BUILDING' && bldDiff.changedFields.length > 0 ? (currentBld?.version || 1) + 1 : currentBld?.version,
      },
    };

    for (const room of rooms) {
      if (eligibleRoomIds.has(room.id)) {
        continue;
      }
      skippedRoomIds.add(room.id);
    }

    const candidateRoomCount = rooms.length;
    const eligibleRoomCount = eligibleRoomIds.size;
    const skippedRoomCount = skippedRoomIds.size;

    return {
      scope,
      scopeId: scopeId || null,
      noOp: isScopeNoOp,
      scopeUpdates,
      expectedVersions: scope === 'DORMITORY' ? expectedVersions : undefined,
      expectedVersion: scope === 'BUILDING' ? expectedVersion : undefined,
      candidateRoomCount,
      eligibleRoomCount,
      eligibleFieldChangeCount,
      skippedRoomCount,
      skippedFieldChangeCount,

      // Backwards-compatibility aliases:
      totalCandidateRooms: candidateRoomCount,
      eligibleRooms: eligibleRoomCount,
      proposedChanges,
      fieldEffects,
    };
  }

  /**
   * Directly update Dormitory defaults (Property and/or Billing) with optimistic concurrency & transactional audit log
   */
  public async updateDormitoryDefaults(
    dormitoryId: string,
    payload: {
      property?: { changes: Record<string, any>; expectedVersion: number };
      billing?: { changes: Record<string, any>; expectedVersion: number };
    },
    actorUserId: string,
    requestId?: string
  ) {
    const prisma = getPrismaClient();

    return await prisma.$transaction(async (tx: any) => {
      const currentProp = await tx.dormitoryPropertyDefaults.findUnique({ where: { dormitoryId } });
      const currentBill = await tx.dormitoryBillingSettings.findUnique({ where: { dormitoryId } });

      if (payload.property && !currentProp) {
        throw new AppError('ไม่พบข้อมูลการตั้งค่าเริ่มต้นของหอพัก', 404, 'DORMITORY_NOT_FOUND');
      }
      if (payload.billing && !currentBill) {
        throw new AppError('ไม่พบข้อมูลการคิดเงินของหอพัก', 404, 'DORMITORY_NOT_FOUND');
      }

      // Validate versions before any mutation
      if (payload.property && currentProp) {
        if (currentProp.version !== payload.property.expectedVersion) {
          const err: any = new AppError('ข้อมูลถูกแก้ไขโดยผู้อื่น กรุณาโหลดข้อมูลใหม่', 409, 'VERSION_CONFLICT');
          err.currentVersion = currentProp.version;
          throw err;
        }
      }
      if (payload.billing && currentBill) {
        if (currentBill.version !== payload.billing.expectedVersion) {
          const err: any = new AppError('ข้อมูลการคิดเงินถูกแก้ไขโดยผู้อื่น กรุณาโหลดข้อมูลใหม่', 409, 'VERSION_CONFLICT');
          err.currentVersion = currentBill.version;
          throw err;
        }
      }

      const propDiff = pickChangedFields(currentProp, payload.property?.changes);
      const billDiff = pickChangedFields(currentBill, payload.billing?.changes);

      const hasPropChange = propDiff.changedFields.length > 0;
      const hasBillChange = billDiff.changedFields.length > 0;

      if (!hasPropChange && !hasBillChange) {
        return {
          property: currentProp,
          billing: currentBill,
          auditLogId: null,
          noOp: true,
        };
      }

      let updatedProperty: any = currentProp;
      let updatedBilling: any = currentBill;

      if (hasPropChange && payload.property && currentProp) {
        const updateRes = await tx.dormitoryPropertyDefaults.updateMany({
          where: { dormitoryId, version: payload.property.expectedVersion },
          data: { ...propDiff.changedValues, version: { increment: 1 } },
        });
        if (updateRes.count === 0) {
          const freshProp = await tx.dormitoryPropertyDefaults.findUnique({ where: { dormitoryId } });
          const err: any = new AppError('ข้อมูลถูกแก้ไขโดยผู้อื่น กรุณาโหลดข้อมูลใหม่', 409, 'VERSION_CONFLICT');
          err.currentVersion = freshProp?.version || currentProp.version;
          throw err;
        }
        updatedProperty = await tx.dormitoryPropertyDefaults.findUnique({ where: { dormitoryId } });
      }

      if (hasBillChange && payload.billing && currentBill) {
        const updateRes = await tx.dormitoryBillingSettings.updateMany({
          where: { dormitoryId, version: payload.billing.expectedVersion },
          data: { ...billDiff.changedValues, version: { increment: 1 } },
        });
        if (updateRes.count === 0) {
          const freshBill = await tx.dormitoryBillingSettings.findUnique({ where: { dormitoryId } });
          const err: any = new AppError('ข้อมูลการคิดเงินถูกแก้ไขโดยผู้อื่น กรุณาโหลดข้อมูลใหม่', 409, 'VERSION_CONFLICT');
          err.currentVersion = freshBill?.version || currentBill.version;
          throw err;
        }
        updatedBilling = await tx.dormitoryBillingSettings.findUnique({ where: { dormitoryId } });
      }

      const beforeValues: Record<string, any> = {};
      const afterValues: Record<string, any> = {};
      if (hasPropChange) {
        beforeValues.property = currentProp ? { ...currentProp } : null;
        afterValues.property = updatedProperty ? { ...updatedProperty } : null;
      }
      if (hasBillChange) {
        beforeValues.billing = currentBill ? { ...currentBill } : null;
        afterValues.billing = updatedBilling ? { ...updatedBilling } : null;
      }

      const auditLog = await tx.auditLog.create({
        data: {
          dormitoryId,
          actorUserId,
          entityType: 'DORMITORY_DEFAULTS',
          entityId: dormitoryId,
          action: 'UPDATE_DORMITORY_DEFAULTS',
          beforeValues,
          afterValues,
          reason: `Updated dormitory defaults (property expected: ${payload.property?.expectedVersion ?? 'N/A'}, billing expected: ${payload.billing?.expectedVersion ?? 'N/A'})`,
          requestId: requestId || null,
        },
      });

      return {
        property: updatedProperty,
        billing: updatedBilling,
        auditLogId: auditLog.id,
        noOp: false,
      };
    });
  }

  /**
   * Bulk apply defaults propagation with advisory lock and idempotency key
   */
  public async applyDefaultPropagation(
    dormitoryId: string,
    payload: any,
    actorUserId: string,
    requestId?: string
  ) {
    const prisma = getPrismaClient();

    const scope = payload.scope;
    const scopeId = payload.scopeId;
    const changes = payload.changes;
    const expectedVersions = payload.expectedVersions;
    const expectedVersion = payload.expectedVersion;
    const idempotencyKey = payload.idempotencyKey;

    const canonicalizeJson = (obj: any): string => {
      if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
      if (Array.isArray(obj)) return '[' + obj.map(canonicalizeJson).join(',') + ']';
      const keys = Object.keys(obj).sort();
      return '{' + keys.map((k) => `${JSON.stringify(k)}:${canonicalizeJson(obj[k])}`).join(',') + '}';
    };

    const rawRequestHash = canonicalizeJson({
      dormitoryId,
      scope,
      scopeId: scopeId || null,
      changes,
      expectedVersions: scope === 'DORMITORY' ? expectedVersions : null,
      expectedVersion: scope === 'BUILDING' ? expectedVersion : null,
    });
    const requestHash = crypto.createHash('sha256').update(rawRequestHash).digest('hex');

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

    const result = await prisma.$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${dormitoryId}))`;

      // Recheck idempotency key inside transaction under advisory lock
      const inTxExistingKey = await tx.idempotencyKey.findFirst({
        where: {
          userId: actorUserId,
          operation: 'BULK_DEFAULT_APPLY',
          idempotencyKey,
        },
      });

      if (inTxExistingKey) {
        if (inTxExistingKey.requestHash !== requestHash) {
          throw new AppError(
            'Idempotency key ซ้ำแต่ข้อมูลไม่ตรงกับรายการเดิม',
            409,
            'IDEMPOTENCY_MISMATCH'
          );
        }
        return inTxExistingKey.responseBody;
      }

      let beforeProperty: any = null;
      let afterProperty: any = null;
      let beforeBilling: any = null;
      let afterBilling: any = null;
      let beforeBuilding: any = null;
      let afterBuilding: any = null;

      if (scope === 'DORMITORY') {
        if (changes.property && expectedVersions?.property) {
          const currentDefaults = await tx.dormitoryPropertyDefaults.findUnique({
            where: { dormitoryId },
          });

          if (!currentDefaults) {
            throw new AppError('ไม่พบข้อมูลการตั้งค่าเริ่มต้นของหอพัก', 404, 'DORMITORY_NOT_FOUND');
          }

          if (currentDefaults.version !== expectedVersions.property) {
            const err: any = new AppError('ข้อมูลถูกแก้ไขโดยผู้อื่น กรุณาโหลดข้อมูลใหม่', 409, 'VERSION_CONFLICT');
            err.currentVersion = currentDefaults.version;
            throw err;
          }

          beforeProperty = { ...currentDefaults };
        }

        if (changes.billing && expectedVersions?.billing) {
          const currentBilling = await tx.dormitoryBillingSettings.findUnique({
            where: { dormitoryId },
          });

          if (!currentBilling) {
            throw new AppError('ไม่พบข้อมูลการคิดเงินของหอพัก', 404, 'DORMITORY_NOT_FOUND');
          }

          if (currentBilling.version !== expectedVersions.billing) {
            const err: any = new AppError('ข้อมูลการคิดเงินถูกแก้ไขโดยผู้อื่น กรุณาโหลดข้อมูลใหม่', 409, 'VERSION_CONFLICT');
            err.currentVersion = currentBilling.version;
            throw err;
          }

          beforeBilling = { ...currentBilling };
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

        beforeBuilding = { ...currentBld };
      }

      // Compute authoritative PRE-MUTATION preview inside transaction BEFORE updating DB
      const preview = await this.previewDefaultPropagation(dormitoryId, payload, tx);

      const propDiff = scope === 'DORMITORY' && changes.property ? pickChangedFields(beforeProperty, changes.property) : { changedFields: [], changedValues: {} };
      const billDiff = scope === 'DORMITORY' && changes.billing ? pickChangedFields(beforeBilling, changes.billing) : { changedFields: [], changedValues: {} };
      const bldDiff = scope === 'BUILDING' ? pickChangedFields(beforeBuilding, changes) : { changedFields: [], changedValues: {} };

      const isScopeNoOp = scope === 'DORMITORY'
        ? (propDiff.changedFields.length === 0 && billDiff.changedFields.length === 0)
        : (bldDiff.changedFields.length === 0);

      if (isScopeNoOp) {
        const curProp = scope === 'DORMITORY' ? (beforeProperty || await tx.dormitoryPropertyDefaults.findUnique({ where: { dormitoryId } })) : null;
        const curBill = scope === 'DORMITORY' ? (beforeBilling || await tx.dormitoryBillingSettings.findUnique({ where: { dormitoryId } })) : null;
        const curBld = scope === 'BUILDING' && scopeId ? (beforeBuilding || await tx.building.findFirst({ where: { id: scopeId, dormitoryId } })) : null;

        const noOpPayload = {
          success: true,
          noOp: true,
          scope,
          scopeId: scopeId || null,
          scopeUpdates: {
            property: {
              updated: false,
              changedFields: [],
              oldVersion: curProp?.version,
              newVersion: curProp?.version,
            },
            billing: {
              updated: false,
              changedFields: [],
              oldVersion: curBill?.version,
              newVersion: curBill?.version,
            },
            building: {
              updated: false,
              changedFields: [],
              oldVersion: curBld?.version,
              newVersion: curBld?.version,
            },
          },
          appliedRoomCount: 0,
          appliedFieldChangeCount: 0,
          skippedRoomCount: preview.skippedRoomCount,
          skippedFieldChangeCount: preview.skippedFieldChangeCount,

          appliedRooms: 0,
          totalCandidateRooms: preview.candidateRoomCount,
          eligibleRooms: 0,

          versions: {
            property: curProp?.version ?? expectedVersions?.property,
            billing: curBill?.version ?? expectedVersions?.billing,
            building: curBld?.version ?? expectedVersion,
          },
          fieldEffects: preview.fieldEffects,
          auditLogId: null,
          appliedAt: new Date().toISOString(),
        };

        try {
          await tx.idempotencyKey.create({
            data: {
              userId: actorUserId,
              operation: 'BULK_DEFAULT_APPLY',
              idempotencyKey,
              requestHash,
              status: 'completed',
              responseStatus: 200,
              responseBody: noOpPayload,
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            },
          });
        } catch (err: any) {
          if (err?.code === 'P2002') {
            const reloadedKey = await tx.idempotencyKey.findFirst({
              where: {
                userId: actorUserId,
                operation: 'BULK_DEFAULT_APPLY',
                idempotencyKey,
              },
            });
            if (reloadedKey) {
              if (reloadedKey.requestHash !== requestHash) {
                throw new AppError('Idempotency key ซ้ำแต่ข้อมูลไม่ตรงกับรายการเดิม', 409, 'IDEMPOTENCY_MISMATCH');
              }
              return reloadedKey.responseBody;
            }
          }
          throw err;
        }

        return noOpPayload;
      }

      // Perform guarded updates ONLY for models that have effective scope changes
      if (scope === 'DORMITORY') {
        if (propDiff.changedFields.length > 0 && expectedVersions?.property) {
          const updateRes = await tx.dormitoryPropertyDefaults.updateMany({
            where: { dormitoryId, version: expectedVersions.property },
            data: { ...propDiff.changedValues, version: { increment: 1 } },
          });

          if (updateRes.count === 0) {
            const safeCurrent = await tx.dormitoryPropertyDefaults.findUnique({ where: { dormitoryId } });
            const err: any = new AppError('ข้อมูลถูกแก้ไขโดยผู้อื่น กรุณาโหลดข้อมูลใหม่', 409, 'VERSION_CONFLICT');
            err.currentVersion = safeCurrent?.version || 1;
            throw err;
          }

          afterProperty = await tx.dormitoryPropertyDefaults.findUnique({ where: { dormitoryId } });
        } else {
          afterProperty = beforeProperty;
        }

        if (billDiff.changedFields.length > 0 && expectedVersions?.billing) {
          const updateRes = await tx.dormitoryBillingSettings.updateMany({
            where: { dormitoryId, version: expectedVersions.billing },
            data: { ...billDiff.changedValues, version: { increment: 1 } },
          });

          if (updateRes.count === 0) {
            const safeCurrent = await tx.dormitoryBillingSettings.findUnique({ where: { dormitoryId } });
            const err: any = new AppError('ข้อมูลการคิดเงินถูกแก้ไขโดยผู้อื่น กรุณาโหลดข้อมูลใหม่', 409, 'VERSION_CONFLICT');
            err.currentVersion = safeCurrent?.version || 1;
            throw err;
          }

          afterBilling = await tx.dormitoryBillingSettings.findUnique({ where: { dormitoryId } });
        } else {
          afterBilling = beforeBilling;
        }
      } else if (scope === 'BUILDING' && scopeId) {
        if (bldDiff.changedFields.length > 0) {
          const updateRes = await tx.building.updateMany({
            where: { id: scopeId, dormitoryId, version: expectedVersion ?? beforeBuilding.version },
            data: { ...bldDiff.changedValues, version: { increment: 1 } },
          });

          if (updateRes.count === 0) {
            const safeCurrent = await tx.building.findFirst({ where: { id: scopeId, dormitoryId } });
            const err: any = new AppError('ข้อมูลอาคารถูกแก้ไขโดยผู้อื่น กรุณาโหลดข้อมูลใหม่', 409, 'VERSION_CONFLICT');
            err.currentVersion = safeCurrent?.version || 1;
            throw err;
          }

          afterBuilding = await tx.building.findFirst({ where: { id: scopeId, dormitoryId } });
        } else {
          afterBuilding = beforeBuilding;
        }
      }

      const beforeValues: Record<string, any> = {};
      const afterValues: Record<string, any> = {};
      if (scope === 'DORMITORY') {
        if (propDiff.changedFields.length > 0) {
          beforeValues.property = beforeProperty;
          afterValues.property = afterProperty;
        }
        if (billDiff.changedFields.length > 0) {
          beforeValues.billing = beforeBilling;
          afterValues.billing = afterBilling;
        }
      } else if (scope === 'BUILDING') {
        beforeValues.building = beforeBuilding;
        afterValues.building = afterBuilding;
      }

      const auditLog = await tx.auditLog.create({
        data: {
          dormitoryId,
          actorUserId,
          entityType: scope === 'BUILDING' ? 'BUILDING' : 'PROPERTY_DEFAULTS',
          entityId: scopeId || dormitoryId,
          action: 'BULK_DEFAULT_APPLY',
          beforeValues,
          afterValues,
          reason: `Applied bulk default propagation to ${scope}`,
          idempotencyKey,
          requestId: requestId || null,
        },
      });

      const responsePayload = {
        success: true,
        noOp: false,
        scope,
        scopeId: scopeId || null,
        scopeUpdates: {
          property: {
            updated: propDiff.changedFields.length > 0,
            changedFields: propDiff.changedFields,
            oldVersion: beforeProperty?.version,
            newVersion: afterProperty?.version,
          },
          billing: {
            updated: billDiff.changedFields.length > 0,
            changedFields: billDiff.changedFields,
            oldVersion: beforeBilling?.version,
            newVersion: afterBilling?.version,
          },
          building: {
            updated: scope === 'BUILDING' && bldDiff.changedFields.length > 0,
            changedFields: scope === 'BUILDING' ? bldDiff.changedFields : [],
            oldVersion: beforeBuilding?.version,
            newVersion: afterBuilding?.version,
          },
        },
        appliedRoomCount: preview.eligibleRoomCount,
        appliedFieldChangeCount: preview.eligibleFieldChangeCount,
        skippedRoomCount: preview.skippedRoomCount,
        skippedFieldChangeCount: preview.skippedFieldChangeCount,

        // Backwards compatibility alias fields:
        appliedRooms: preview.eligibleRoomCount,
        totalCandidateRooms: preview.candidateRoomCount,
        eligibleRooms: preview.eligibleRoomCount,

        versions: {
          property: afterProperty?.version ?? expectedVersions?.property,
          billing: afterBilling?.version ?? expectedVersions?.billing,
          building: afterBuilding?.version ?? expectedVersion,
        },
        fieldEffects: preview.fieldEffects,
        auditLogId: auditLog.id,
        appliedAt: new Date().toISOString(),
      };

      try {
        await tx.idempotencyKey.create({
          data: {
            userId: actorUserId,
            operation: 'BULK_DEFAULT_APPLY',
            idempotencyKey,
            requestHash,
            status: 'completed',
            responseStatus: 200,
            responseBody: responsePayload,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
        });
      } catch (err: any) {
        if (err?.code === 'P2002') {
          const reloadedKey = await tx.idempotencyKey.findFirst({
            where: {
              userId: actorUserId,
              operation: 'BULK_DEFAULT_APPLY',
              idempotencyKey,
            },
          });
          if (reloadedKey) {
            if (reloadedKey.requestHash !== requestHash) {
              throw new AppError('Idempotency key ซ้ำแต่ข้อมูลไม่ตรงกับรายการเดิม', 409, 'IDEMPOTENCY_MISMATCH');
            }
            return reloadedKey.responseBody;
          }
        }
        throw err;
      }

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

    const [allContracts, allProvisionals, allDailyStays] = await Promise.all([
      prisma.contract.findMany({
        where: {
          roomId: room.id,
          dormitoryId,
          status: { in: ['active', 'approved', 'expiring_soon', 'waiting_extension', 'checking_out'] },
          deletedAt: null,
        },
        include: { snapshot: true },
      }),
      prisma.provisionalRentalTerm.findMany({
        where: {
          roomId: room.id,
          dormitoryId,
          status: 'ACTIVE',
          deletedAt: null,
        },
      }),
      prisma.dailyStay.findMany({
        where: {
          roomId: room.id,
          dormitoryId,
          status: { in: ['ACTIVE', 'CHECKED_IN'] },
          deletedAt: null,
        },
      }),
    ]);

    const now = new Date();
    const { activeRentalSummary, activeContract } = resolveCurrentActiveRentalSummary(
      room.id,
      allContracts,
      allProvisionals,
      allDailyStays,
      now
    );

    const snapshotLocked = !!(activeContract && activeContract.snapshot);
    const activeContractSnapshotId = activeContract?.snapshot?.id || null;

    const rawOverrides = {
      monthlyRent: room.monthlyRent !== null && room.monthlyRent !== undefined ? String(room.monthlyRent) : null,
      termRent: room.termRent !== null && room.termRent !== undefined ? String(room.termRent) : null,
      dailyRent: room.dailyRent !== null && room.dailyRent !== undefined ? String(room.dailyRent) : null,
      termDeposit: room.termDeposit !== null && room.termDeposit !== undefined ? String(room.termDeposit) : null,
      monthlyDeposit: room.monthlyDeposit !== null && room.monthlyDeposit !== undefined ? String(room.monthlyDeposit) : null,
      dailyDeposit: room.dailyDeposit !== null && room.dailyDeposit !== undefined ? String(room.dailyDeposit) : null,
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
      termDeposit: effective.termDeposit.value,
      monthlyDeposit: effective.monthlyDeposit.value,
      dailyDeposit: effective.dailyDeposit.value,
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
      termDeposit: effective.termDeposit.source,
      monthlyDeposit: effective.monthlyDeposit.source,
      dailyDeposit: effective.dailyDeposit.source,
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
      currentTenantId: room.currentTenantId || activeContract?.tenantId || null,
      currentContractId: room.currentContractId || activeContract?.id || null,
      activeRentalSummary,
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
    const waterBillingTypeRes = resolveBldField(building.waterBillingType, billingSettings?.waterBillingType || 'per_unit', (v) => normalizeUtilityBillingMode(v));
    const elecBillingTypeRes = resolveBldField(building.electricityBillingType, billingSettings?.electricityBillingType || 'per_unit', (v) => normalizeUtilityBillingMode(v));
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

  /**
   * Batch builds server-authoritative Room responses to prevent N+1 query overhead.
   * Product Owner Amendment 5: Batch-loads Contract, Snapshot, Provisional, and Daily records.
   */
  public async buildAuthoritativeRoomsResponseBatch(
    dormitoryId: string,
    rooms: any[],
    txClient?: any
  ): Promise<any[]> {
    if (!rooms || rooms.length === 0) return [];

    const prisma = txClient || getPrismaClient();
    const roomIds = rooms.map((r) => r.id);
    const buildingIds = Array.from(new Set(rooms.map((r) => r.buildingId).filter(Boolean)));

    const [billingSettings, propertyDefaults, buildings, activeContracts, activeProvisionals, activeDailyStays] = await Promise.all([
      prisma.dormitoryBillingSettings.findUnique({ where: { dormitoryId } }),
      prisma.dormitoryPropertyDefaults.findUnique({ where: { dormitoryId } }),
      prisma.building.findMany({ where: { id: { in: buildingIds }, dormitoryId, deletedAt: null } }),
      prisma.contract.findMany({
        where: {
          dormitoryId,
          roomId: { in: roomIds },
          status: { in: ['active', 'approved', 'expiring_soon', 'waiting_extension', 'checking_out'] },
          deletedAt: null,
        },
        include: { snapshot: true },
      }),
      prisma.provisionalRentalTerm.findMany({
        where: {
          dormitoryId,
          roomId: { in: roomIds },
          status: 'ACTIVE',
          deletedAt: null,
        },
      }),
      prisma.dailyStay.findMany({
        where: {
          dormitoryId,
          roomId: { in: roomIds },
          status: { in: ['ACTIVE', 'RESERVED'] },
          deletedAt: null,
        },
      }),
    ]);

    const buildingMap = new Map(buildings.map((b: any) => [b.id, b]));
    const dormBillVer = billingSettings?.version || 1;
    const dormPropVer = propertyDefaults?.version || 1;

    const activeRentalMap = new Map<string, ActiveRentalSummary | null>();
    const activeContractMap = new Map<string, any>();

        const now = new Date();
    for (const roomId of roomIds) {
      const { activeRentalSummary, activeContract } = resolveCurrentActiveRentalSummary(
        roomId,
        activeContracts,
        activeProvisionals,
        activeDailyStays,
        now
      );
      if (activeContract) {
        activeContractMap.set(roomId, activeContract);
      }
      activeRentalMap.set(roomId, activeRentalSummary);
    }

    return rooms.map((room) => {
      const building: any = buildingMap.get(room.buildingId);
      const bldVer = building?.version || 1;
      const rmVer = room.version || 1;

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

      const monthlyRent = resolveField(room.monthlyRent, building?.monthlyRent, propertyDefaults?.defaultMonthlyRent || 0, dormPropVer);
      const termRent = resolveField(room.termRent, building?.termRent, propertyDefaults?.defaultTermRent || null, dormPropVer, (v) => (v !== null && v !== undefined ? Number(v) : null));
      const dailyRent = resolveField(room.dailyRent, building?.dailyRent, propertyDefaults?.defaultDailyRent || null, dormPropVer, (v) => (v !== null && v !== undefined ? Number(v) : null));

      const termDeposit = {
        value: room.termDeposit !== null && room.termDeposit !== undefined
          ? Number(room.termDeposit)
          : Number(propertyDefaults?.defaultDeposit || 0),
        source: room.termDeposit !== null && room.termDeposit !== undefined ? ('ROOM' as const) : ('DORMITORY' as const),
        sourceVersion: room.termDeposit !== null && room.termDeposit !== undefined ? rmVer : dormPropVer,
      };

      const monthlyDeposit = {
        value: room.monthlyDeposit !== null && room.monthlyDeposit !== undefined
          ? Number(room.monthlyDeposit)
          : Number(propertyDefaults?.defaultDeposit || 0),
        source: room.monthlyDeposit !== null && room.monthlyDeposit !== undefined ? ('ROOM' as const) : ('DORMITORY' as const),
        sourceVersion: room.monthlyDeposit !== null && room.monthlyDeposit !== undefined ? rmVer : dormPropVer,
      };

      const dailyDeposit = {
        value: room.dailyDeposit !== null && room.dailyDeposit !== undefined
          ? Number(room.dailyDeposit)
          : Number(propertyDefaults?.defaultDeposit || 0),
        source: room.dailyDeposit !== null && room.dailyDeposit !== undefined ? ('ROOM' as const) : ('DORMITORY' as const),
        sourceVersion: room.dailyDeposit !== null && room.dailyDeposit !== undefined ? rmVer : dormPropVer,
      };

      const depositAmount = {
        value: room.monthlyDeposit !== null && room.monthlyDeposit !== undefined
          ? Number(room.monthlyDeposit)
          : (room.depositInheritsBuildingDefault === false && room.depositAmount !== null && room.depositAmount !== undefined
              ? Number(room.depositAmount)
              : Number(building?.depositAmount ?? propertyDefaults?.defaultDeposit ?? 0)),
        source: 'ROOM' as const,
        sourceVersion: rmVer,
      };

      const advancePaymentAmount = resolveField(room.advancePaymentAmount, building?.advancePaymentAmount, propertyDefaults?.defaultAdvancePayment || 0, dormPropVer);
      const parkingFee = resolveField(room.parkingFee, building?.parkingFee, propertyDefaults?.defaultParkingFee || 0, dormPropVer);
      const waterRate = resolveField(room.waterRate, building?.waterRate, billingSettings?.waterRate || 0, dormBillVer);
      const electricityRate = resolveField(room.electricityRate, building?.electricityRate, billingSettings?.electricityRate || 0, dormBillVer);
      const commonFee = resolveField(room.commonFee, building?.commonFee, billingSettings?.commonFee || 0, dormBillVer);
      const internetFee = resolveField(room.internetFee, building?.internetFee, billingSettings?.internetFee || 0, dormBillVer);
      const waterBillingType = resolveField(room.waterBillingType, building?.waterBillingType, billingSettings?.waterBillingType || 'per_person', dormBillVer, String);
      const electricityBillingType = resolveField(room.electricityBillingType, building?.electricityBillingType, billingSettings?.electricityBillingType || 'per_unit', dormBillVer, String);
      const rentBillingType = resolveField(room.rentBillingType, building?.rentBillingType, billingSettings?.rentBillingType || 'monthly', dormBillVer, String);
      const maximumOccupants = resolveField(room.maximumOccupants, building?.maximumOccupants, propertyDefaults?.defaultMaxOccupants || 2, dormPropVer);
      const roomType = resolveField(room.roomType, building?.roomType, propertyDefaults?.defaultRoomType || 'standard', dormPropVer, String);

      const rawOverrides = {
        monthlyRent: room.monthlyRent !== null && room.monthlyRent !== undefined ? String(room.monthlyRent) : null,
        termRent: room.termRent !== null && room.termRent !== undefined ? String(room.termRent) : null,
        dailyRent: room.dailyRent !== null && room.dailyRent !== undefined ? String(room.dailyRent) : null,
        termDeposit: room.termDeposit !== null && room.termDeposit !== undefined ? String(room.termDeposit) : null,
        monthlyDeposit: room.monthlyDeposit !== null && room.monthlyDeposit !== undefined ? String(room.monthlyDeposit) : null,
        dailyDeposit: room.dailyDeposit !== null && room.dailyDeposit !== undefined ? String(room.dailyDeposit) : null,
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
        monthlyRent: monthlyRent.value,
        termRent: termRent.value,
        dailyRent: dailyRent.value,
        termDeposit: termDeposit.value,
        monthlyDeposit: monthlyDeposit.value,
        dailyDeposit: dailyDeposit.value,
        depositAmount: depositAmount.value,
        advancePaymentAmount: advancePaymentAmount.value,
        parkingFee: parkingFee.value,
        waterRate: waterRate.value,
        electricityRate: electricityRate.value,
        commonFee: commonFee.value,
        internetFee: internetFee.value,
        waterBillingType: waterBillingType.value,
        electricityBillingType: electricityBillingType.value,
        rentBillingType: rentBillingType.value,
        maximumOccupants: maximumOccupants.value,
        roomType: roomType.value,
      };

      const currentFieldSources = {
        monthlyRent: monthlyRent.source,
        termRent: termRent.source,
        dailyRent: dailyRent.source,
        termDeposit: termDeposit.source,
        monthlyDeposit: monthlyDeposit.source,
        dailyDeposit: dailyDeposit.source,
        depositAmount: depositAmount.source,
        advancePaymentAmount: advancePaymentAmount.source,
        parkingFee: parkingFee.source,
        waterRate: waterRate.source,
        electricityRate: electricityRate.source,
        commonFee: commonFee.source,
        internetFee: internetFee.source,
        waterBillingType: waterBillingType.source,
        electricityBillingType: electricityBillingType.source,
        rentBillingType: rentBillingType.source,
        maximumOccupants: maximumOccupants.source,
        roomType: roomType.source,
      };

      const activeContract = activeContractMap.get(room.id);
      const activeRentalSummary = activeRentalMap.get(room.id) || null;
      const snapshotLocked = !!(activeContract && activeContract.snapshot);
      const activeContractSnapshotId = activeContract?.snapshot?.id || null;

      const sourceVersions = {
        dormitoryBillingVersion: dormBillVer,
        dormitoryPropertyVersion: dormPropVer,
        buildingVersion: bldVer,
        roomVersion: rmVer,
      };

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
        currentSourceVersions: sourceVersions,
        sourceVersions,
        snapshotLocked,
        activeContractSnapshotId,
        contractSnapshot: null,
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
        currentTenantId: room.currentTenantId || activeContract?.tenantId || null,
        currentContractId: room.currentContractId || activeContract?.id || null,
        activeRentalSummary,
        createdAt: room.createdAt,
      };
    });
  }
}

export const defaultsService = new DefaultsService();
