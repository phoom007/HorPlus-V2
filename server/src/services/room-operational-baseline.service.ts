import { getPrismaClient } from '../db/prisma.js';
import { currentCycleResolverService } from './current-cycle-resolver.js';
import { logger } from '../config/logger.js';

export interface BackfillBaselineResult {
  processedDormitories: number;
  processedRooms: number;
  createdBaselines: number;
}

/**
 * Idempotent One-Time Room Operational Status Baseline Seeder (R3.2b).
 *
 * Rules:
 * 1. Establishes an initial baseline row ONLY for Rooms that have NO status history at all.
 * 2. If a room already has any RoomOperationalStatusChange, it is SKIPPED (no synthetic monthly rows).
 * 3. Uses canonical operational cycle resolved via currentCycleResolverService.resolveOperationalBillingCycle().
 * 4. Uses createMany with skipDuplicates: true for concurrency/idempotency safety.
 * 5. Pre-onboarding dormitories without a BillingCycle are skipped safely.
 */
export async function backfillRoomOperationalStatusBaseline(
  targetDormitoryId?: string,
  prismaClient?: any
): Promise<BackfillBaselineResult> {
  const prisma = prismaClient || getPrismaClient();

  const dormWhere: any = {};
  if (targetDormitoryId) {
    dormWhere.id = targetDormitoryId;
  }

  const dormitories = await prisma.dormitory.findMany({
    where: dormWhere,
    select: { id: true, name: true },
  });

  let processedDormitories = 0;
  let processedRooms = 0;
  let createdBaselines = 0;

  for (const dorm of dormitories) {
    processedDormitories++;
    const operational = await currentCycleResolverService.resolveOperationalBillingCycle(dorm.id, prisma);
    if (!operational || !operational.billingCycleId) {
      // Pre-onboarding or no operational cycle yet -> skip safely
      continue;
    }

    // One-Time Rule: Query ONLY rooms that have NO status history at all
    const roomsWithoutHistory = await prisma.room.findMany({
      where: {
        dormitoryId: dorm.id,
        deletedAt: null,
        operationalStatusChanges: {
          none: {},
        },
      },
      select: { id: true, status: true },
    });

    processedRooms += roomsWithoutHistory.length;

    if (roomsWithoutHistory.length > 0) {
      const recordsToCreate = roomsWithoutHistory.map((room: { id: string; status: string }) => ({
        dormitoryId: dorm.id,
        roomId: room.id,
        effectiveBillingCycleId: operational.billingCycleId as string,
        status: room.status || 'vacant',
        version: 1,
      }));

      // createMany with skipDuplicates ensures concurrency safety without throwing P2002
      const createRes = await prisma.roomOperationalStatusChange.createMany({
        data: recordsToCreate,
        skipDuplicates: true,
      });

      createdBaselines += createRes.count;
    }
  }

  if (createdBaselines > 0) {
    logger.info({ processedDormitories, processedRooms, createdBaselines }, '[Baseline] Established one-time operational status baseline for existing rooms');
  }

  return { processedDormitories, processedRooms, createdBaselines };
}
