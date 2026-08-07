import { getPrismaClient } from '../db/prisma.js';
import {
  normalizeRoomNumber,
  validateRoomNumberInput,
} from '../utils/room-number.normalizer.js';

// Minimal Prisma client interface for reconciliation
export type ReconciliationPrismaClient = {
  room: {
    findMany: (args: any) => Promise<any[]>;
    update: (args: any) => Promise<any>;
  };
  $transaction: (fn: (tx: any) => Promise<any>) => Promise<any>;
};

export type ReconciliationRoom = {
  id: string;
  dormitoryId: string;
  buildingId: string;
  roomNumber: string;
  normalizedRoomNumber: string;
};

export type ReconciliationConflict = {
  dormitoryId: string;
  buildingId: string;
  roomId: string;
  exactRoomNumber: string;
  oldNormalizedValue: string;
  newNormalizedValue: string;
  conflictGroup: string;
};

export type ReconciliationResult = {
  success: boolean;
  scannedCount: number;
  updatedCount: number;
  conflicts: ReconciliationConflict[];
};

export async function reconcileRoomNormalization(
  prismaOrTx?: ReconciliationPrismaClient,
  targetDormitoryId?: string,
): Promise<ReconciliationResult> {
  // ── Safety guards ──
  const dbUrl = process.env.DATABASE_URL || '';
  const isLoopback = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');
  const isPort5455 = dbUrl.includes('5455');
  const hasForbiddenTerm = /pilot|prod|production|live|5432/i.test(dbUrl);

  if (!isLoopback || !isPort5455 || hasForbiddenTerm) {
    throw new Error(
      'Safety guard: reconciliation script can only run against loopback database on port 5455.',
    );
  }

  const prisma = prismaOrTx || getPrismaClient();

  // ── Read every non-deleted Room ──
  const whereClause: any = { deletedAt: null };
  if (targetDormitoryId) {
    whereClause.dormitoryId = targetDormitoryId;
  }

  const rooms: ReconciliationRoom[] = await prisma.room.findMany({
    where: whereClause,
    select: {
      id: true,
      dormitoryId: true,
      buildingId: true,
      roomNumber: true,
      normalizedRoomNumber: true,
    },
  });

  // ── Compute normalized values and build Dormitory-scoped conflict groups ──
  const normalizedMap = new Map<string, Array<ReconciliationRoom & { newNorm: string }>>();

  for (const r of rooms) {
    const newNorm = normalizeRoomNumber(r.roomNumber);
    const key = `${r.dormitoryId}::${newNorm}`;

    if (!normalizedMap.has(key)) {
      normalizedMap.set(key, []);
    }
    normalizedMap.get(key)!.push({ ...r, newNorm });
  }

  // ── Build all conflicts before any writes ──
  const conflicts: ReconciliationConflict[] = [];

  for (const [key, group] of normalizedMap.entries()) {
    if (group.length > 1) {
      for (const item of group) {
        conflicts.push({
          dormitoryId: item.dormitoryId,
          buildingId: item.buildingId,
          roomId: item.id,
          exactRoomNumber: item.roomNumber,
          oldNormalizedValue: item.normalizedRoomNumber || '',
          newNormalizedValue: item.newNorm,
          conflictGroup: key,
        });
      }
    }
  }

  // ── Abort without writes when conflicts exist ──
  if (conflicts.length > 0) {
    return {
      success: false,
      scannedCount: rooms.length,
      updatedCount: 0,
      conflicts,
    };
  }

  // ── Update changed normalized values transactionally ──
  let updatedCount = 0;

  const runUpdate = async (tx: any) => {
    for (const r of rooms) {
      const newNorm = normalizeRoomNumber(r.roomNumber);

      // Verify no blank normalized values
      if (!newNorm || newNorm.trim() === '') {
        throw new Error(
          `Room ${r.id} (roomNumber="${r.roomNumber}") would produce a blank normalizedRoomNumber. Aborting.`,
        );
      }

      if (r.normalizedRoomNumber !== newNorm) {
        await tx.room.update({
          where: { id: r.id },
          data: { normalizedRoomNumber: newNorm },
        });
        updatedCount++;
      }
    }

    // ── Post-update verification: no duplicate Dormitory + normalizedRoomNumber pairs ──
    const verifyWhere: any = { deletedAt: null };
    if (targetDormitoryId) {
      verifyWhere.dormitoryId = targetDormitoryId;
    }

    const postRooms = await tx.room.findMany({
      where: verifyWhere,
      select: { id: true, dormitoryId: true, normalizedRoomNumber: true },
    });

    const seen = new Set<string>();
    for (const pr of postRooms) {
      const dupKey = `${pr.dormitoryId}::${pr.normalizedRoomNumber}`;
      if (seen.has(dupKey)) {
        throw new Error(
          `Post-update duplicate detected: ${dupKey}. Rolling back all changes.`,
        );
      }
      seen.add(dupKey);
    }
  };

  // If prismaOrTx was provided, it may already be a transaction client
  if (prismaOrTx && typeof (prismaOrTx as any).$executeRaw === 'function') {
    // Already inside a transaction — run directly
    await runUpdate(prismaOrTx);
  } else {
    await prisma.$transaction(runUpdate);
  }

  return {
    success: true,
    scannedCount: rooms.length,
    updatedCount,
    conflicts: [],
  };
}

// ── CLI entry point ──
if (process.argv[1]?.endsWith('reconcile-room-normalization.ts') ||
    process.argv[1]?.endsWith('reconcile-room-normalization.js')) {
  const hasConfirmFlag = process.argv.includes('--confirm-reconcile');
  if (!hasConfirmFlag) {
    console.error('Error: Reconcile script requires --confirm-reconcile flag to execute.');
    process.exit(1);
  }

  reconcileRoomNormalization()
    .then((res) => {
      console.log('Room Normalization Reconciliation Result:', JSON.stringify(res, null, 2));
      process.exit(res.success ? 0 : 1);
    })
    .catch((err) => {
      console.error('Reconciliation error:', err);
      process.exit(1);
    });
}
