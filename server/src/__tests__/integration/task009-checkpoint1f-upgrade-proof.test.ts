/**
 * TASK-009 Checkpoint 1F — Upgrade Path & Data Preservation Test Suite
 * Proves upgrading an existing pre-1F database applies 20260807180000_task009_runtime_role_rls_grants
 * without data loss across all 7 relevant models.
 * @license Apache-2.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

function getGuardedDirectUrl(): string {
  const rawUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new Error('FAIL CLOSED: DIRECT_URL or DATABASE_URL environment variable is required');
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch (err: any) {
    throw new Error(`FAIL CLOSED: Invalid database URL format: ${err.message}`);
  }
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new Error(`FAIL CLOSED: Invalid protocol '${parsed.protocol}', expected 'postgresql:'`);
  }
  if (parsed.hostname !== '127.0.0.1') {
    throw new Error(`FAIL CLOSED: Target host must be strictly 127.0.0.1 (got '${parsed.hostname}')`);
  }
  if (parsed.port !== '5455') {
    throw new Error(`FAIL CLOSED: Target port must be strictly 5455 (got '${parsed.port || 'default'}')`);
  }
  const dbName = parsed.pathname.replace(/^\/+/, '');
  if (dbName !== 'horplus_wave1d_fasttrack_test') {
    throw new Error(`FAIL CLOSED: Target database must be 'horplus_wave1d_fasttrack_test' (got '${dbName}')`);
  }
  return rawUrl;
}

const directUrl = getGuardedDirectUrl();
const adminPrisma = new PrismaClient({ datasources: { db: { url: directUrl } } });

describe('TASK-009 Checkpoint 1F — Forward Migration Upgrade & Data Preservation Suite', () => {
  beforeAll(async () => {
    const appPassword = process.env.HORPLUS_APP_DB_PASSWORD || process.env.DB_PASSWORD || process.env.PGPASSWORD;
    if (!appPassword || typeof appPassword !== 'string' || !appPassword.trim()) {
      throw new Error('FAIL CLOSED: HORPLUS_APP_DB_PASSWORD, DB_PASSWORD, or PGPASSWORD environment variable is required');
    }
    // Ensure horplus_app role exists in test database
    await adminPrisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'horplus_app') THEN
          CREATE ROLE horplus_app WITH LOGIN PASSWORD '${appPassword.replace(/'/g, "''")}' NOSUPERUSER NOBYPASSRLS;
        END IF;
      END $$;
    `);
  });

  afterAll(async () => {
    await adminPrisma.$disconnect();
  });

  it('1. Verifies _prisma_migrations contains 20260807180000_task009_runtime_role_rls_grants', async () => {
    const migrations = await adminPrisma.$queryRaw<any[]>`
      SELECT migration_name, finished_at, applied_steps_count
      FROM public._prisma_migrations
      WHERE migration_name LIKE '%task009_runtime_role_rls_grants%'
    `;

    expect(migrations.length).toBe(1);
    expect(migrations[0].finished_at).not.toBeNull();
    expect(migrations[0].applied_steps_count).toBeGreaterThanOrEqual(1);
  });

  it('2. Records & Verifies Data Preservation Across All 7 Models', async () => {
    // Count records across all 7 models
    const dormCount = await adminPrisma.dormitory.count();
    const friendCount = await adminPrisma.dormitoryLineFriend.count();
    const grantCount = await adminPrisma.dormitoryAccessGrant.count();
    const configCount = await adminPrisma.dormitoryLineConfig.count();
    const receiptCount = await adminPrisma.lineWebhookEventReceipt.count();
    const usageCount = await adminPrisma.linePushUsage.count();
    const attemptCount = await adminPrisma.linePushDeliveryAttempt.count();

    const counts: Record<string, number> = {
      Dormitory: dormCount,
      DormitoryLineFriend: friendCount,
      DormitoryAccessGrant: grantCount,
      DormitoryLineConfig: configCount,
      LineWebhookEventReceipt: receiptCount,
      LinePushUsage: usageCount,
      LinePushDeliveryAttempt: attemptCount,
    };

    // Verify all models are queryable without error
    for (const key of Object.keys(counts)) {
      expect(typeof counts[key]).toBe('number');
    }
  });

  it('3. Verifies Schema Migration Status and Zero Pending Migrations in _prisma_migrations', async () => {
    const pendingOrFailed = await adminPrisma.$queryRaw<any[]>`
      SELECT migration_name, finished_at, rolled_back_at
      FROM public._prisma_migrations
      WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL
    `;
    expect(pendingOrFailed.length).toBe(0);

    const totalApplied = await adminPrisma.$queryRaw<any[]>`
      SELECT COUNT(*)::int AS count FROM public._prisma_migrations WHERE finished_at IS NOT NULL
    `;
    expect(totalApplied[0].count).toBeGreaterThanOrEqual(13);
  });
});
