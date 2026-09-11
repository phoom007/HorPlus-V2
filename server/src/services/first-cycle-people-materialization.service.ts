import { getPrismaClient } from '../db/prisma.js';
import { logger } from '../config/logger.js';

export interface MaterializeFirstCyclePeopleResult {
  dormitoryId: string;
  earliestCycleId?: string;
  createdCount: number;
}

/**
 * Dormitory-Scoped Authoritative First-Cycle PeopleCount Materializer (Owner Round 2.4E).
 *
 * Product Policy & Audit Rules:
 * 1. Default first operational BillingCycle peopleCount = 1 for applicable active rooms.
 * 2. Materialize idempotently ONLY when no explicit snapshot exists for the room in the first cycle.
 * 3. Never overwrite existing snapshots (including explicit 0, 1, 2, etc.).
 * 4. Strictly scoped per-dormitory — NO generic/unbounded DB mutation across all dormitories on server startup.
 */
export async function materializeFirstCyclePeopleSnapshots(
  dormitoryId: string,
  prismaClient?: any
): Promise<MaterializeFirstCyclePeopleResult> {
  if (!dormitoryId) {
    return { dormitoryId: '', createdCount: 0 };
  }

  const prisma = prismaClient || getPrismaClient();

  // 1. Find earliest / first HorPlus-managed billing cycle for this dormitory
  const earliestCycle = await prisma.billingCycle.findFirst({
    where: { dormitoryId },
    orderBy: { periodStart: 'asc' },
    select: { id: true, cycleCode: true },
  });

  if (!earliestCycle) {
    return { dormitoryId, createdCount: 0 };
  }

  // 2. Query active, non-archived, non-deleted rooms for this dormitory
  const activeRooms = await prisma.room.findMany({
    where: {
      dormitoryId,
      deletedAt: null,
      status: { not: 'archived' },
    },
    select: { id: true },
  });

  if (activeRooms.length === 0) {
    return { dormitoryId, earliestCycleId: earliestCycle.id, createdCount: 0 };
  }

  // 3. Query existing snapshots for the earliest cycle to strictly avoid overwriting any values
  const existingSnapshots = await prisma.roomBillingCycleSnapshot.findMany({
    where: {
      dormitoryId,
      billingCycleId: earliestCycle.id,
    },
    select: { roomId: true, peopleCount: true },
  });

  const existingRoomIds = new Set(existingSnapshots.map((s: { roomId: string }) => s.roomId));
  const unseededRooms = activeRooms.filter((r: { id: string }) => !existingRoomIds.has(r.id));

  if (unseededRooms.length === 0) {
    return { dormitoryId, earliestCycleId: earliestCycle.id, createdCount: 0 };
  }

  // 4. Concurrently safe idempotent insert with createMany and skipDuplicates: true
  const recordsToCreate = unseededRooms.map((r: { id: string }) => ({
    dormitoryId,
    billingCycleId: earliestCycle.id,
    roomId: r.id,
    peopleCount: 1,
    source: 'FIRST_CYCLE_DEFAULT',
    version: 1,
  }));

  const result = await prisma.roomBillingCycleSnapshot.createMany({
    data: recordsToCreate,
    skipDuplicates: true,
  });

  if (result.count > 0) {
    logger.info(
      { dormitoryId, earliestCycleId: earliestCycle.id, count: result.count },
      '[FirstCyclePeople] Materialized authoritative first-cycle peopleCount = 1 snapshots'
    );
  }

  return {
    dormitoryId,
    earliestCycleId: earliestCycle.id,
    createdCount: result.count,
  };
}
