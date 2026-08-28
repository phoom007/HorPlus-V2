import { getPrismaClient } from '../db/prisma.js';
import { currentCycleResolverService } from './current-cycle-resolver.js';
import { logger } from '../config/logger.js';

export interface BackfillBaselineResult {
  processedDormitories: number;
  processedRooms: number;
  createdBaselines: number;
}

/**
 * Idempotent Room Operational Status Baseline Seeder (R3.2a).
 * Establishes exactly one baseline row per existing Room at the canonical operational cycle
 * resolved via currentCycleResolverService.resolveOperationalBillingCycle().
 * Does NOT copy rows retroactively to older historical cycles.
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
      continue;
    }

    const rooms = await prisma.room.findMany({
      where: { dormitoryId: dorm.id, deletedAt: null },
      select: { id: true, status: true },
    });

    for (const room of rooms) {
      processedRooms++;
      const existingBaseline = await prisma.roomOperationalStatusChange.findUnique({
        where: {
          dormitory_room_effective_cycle_unique: {
            dormitoryId: dorm.id,
            roomId: room.id,
            effectiveBillingCycleId: operational.billingCycleId,
          },
        },
      });

      if (!existingBaseline) {
        await prisma.roomOperationalStatusChange.create({
          data: {
            dormitoryId: dorm.id,
            roomId: room.id,
            effectiveBillingCycleId: operational.billingCycleId,
            status: room.status || 'vacant',
            version: 1,
          },
        });
        createdBaselines++;
      }
    }
  }

  if (createdBaselines > 0) {
    logger.info({ processedDormitories, processedRooms, createdBaselines }, '[Baseline] Established operational status baseline for existing rooms');
  }

  return { processedDormitories, processedRooms, createdBaselines };
}
