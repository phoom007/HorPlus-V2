/**
 * TASK-009 Checkpoint 1I — Hermetic Pre-Merge Migration & Bootstrap Proof Suite
 *
 * Demonstrates:
 * 1. Immutable frozen SHA-256 migration checksum verification across all 4 TASK-009 migrations
 * 2. Shell-safe execution of canonical `docker/bootstrap-runtime-role.sh` via argument-array process execution
 * 3. Real authentication using special-character password (`SELECT current_user`)
 * 4. Existing-cluster bootstrap idempotency & unsafe-role fail-closed correction
 * 5. Self-contained temporary base audit worktree creation and cleanup (`2cbc3bd5c8e6626ed0ba79ee1a2b6b5049e43acf`)
 * 6. Real Wave-1G base to TASK-009 upgrade proof with data preservation & owner/manager origin migration
 * 7. Fresh final database deployment proof (13/13 migrations applied from scratch)
 * 8. Accepted-base differential schema drift proof (proves TASK-009 introduces ZERO new schema drift over base)
 * 9. Real database datamodel diff fault-injection proof (detects database drift with exit code 2 & column detection)
 * 10. Real database datamodel diff negative semantic proof (detects datamodel drift with exit code 2 & column detection)
 * 11. Resolver catalog, PUBLIC execute denial, and six-table RLS security posture preservation
 *
 * @license Apache-2.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { execSync, execFileSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';

const ADMIN_URL = process.env.DIRECT_URL || 'postgresql://horplus:password@127.0.0.1:5455/horplus_wave1d_fasttrack_test?schema=public';
const PGHOST = '127.0.0.1';
const PGPORT = '5455';
const PGUSER = 'horplus';
const PGPASSWORD = 'password';
const SERVER_DIR = path.resolve(__dirname, '../../../');
const ROOT_DIR = path.resolve(SERVER_DIR, '../');

export const EXPECTED_TASK009_MIGRATION_SHA256 = {
  '20260807120000_task009_staff_line_oa': 'b604e6dd09442f6e064db9ad9fda9122f8194ea3253243de6586d15be6f4781d',
  '20260807140000_task009_owner_origin_fix': '94065284b13c83f0b0506dc77ecc3dbcf10cdc34bc8d0bfb641744612a463333',
  '20260807160000_task009_checkpoint1b_wiring': '40c78079404bc5bc03ce8e93b116325bb4d461849c35e470e0cfb878bf08d0d5',
  '20260807180000_task009_runtime_role_rls_grants': '9b1ab9b83dff8927382f970bd9a48d4067c33fbbdda833968ff447e10e8085fa',
} as const;

export const TASK009_OWNED_TABLES = [
  'dormitory_line_friends',
  'dormitory_access_grants',
  'dormitory_line_configs',
  'line_webhook_event_receipts',
  'line_push_usage',
  'line_push_delivery_attempts',
];

export const TASK009_OWNED_FIELDS = [
  'membership_origin',
  'principal_type',
  'access_grant_id',
  'message_quota_monthly',
  'role_code',
  'status',
  'last_delivery_status',
  'last_delivery_attempt_at',
  'last_delivery_success_at',
  'last_delivery_error_code',
  'access_token_verified_at',
  'webhook_verified_at',
];

// Disposable database names for real isolation
const BASE_UPGRADE_DB = `task009_1i_base_upgrade_${Date.now()}`;
const FRESH_DEPLOY_DB = `task009_1i_fresh_deploy_${Date.now()}`;

const APP_ROLE = 'horplus_app';
const SPECIAL_PASSWORD = `test_p@ss'w0rd $pecial_${Date.now()}`;

let tempBaseWorktreeDir: string | null = null;
let baselineSchemaDriftOutput: string = '';

// Master connection to 'postgres' database
const masterPrisma = new PrismaClient({
  datasources: { db: { url: `postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/postgres?schema=public` } }
});

// Admin connection to main test DB
const mainAdminPrisma = new PrismaClient({
  datasources: { db: { url: ADMIN_URL } }
});

function dbUrl(dbName: string, user: string = PGUSER, pass: string = PGPASSWORD): string {
  return `postgresql://${user}:${pass}@${PGHOST}:${PGPORT}/${dbName}?schema=public`;
}

function runPrismaCommand(dbName: string, command: string, customSchemaPath?: string): string {
  const url = dbUrl(dbName);
  const env = {
    ...process.env,
    DATABASE_URL: url,
    DIRECT_URL: url,
  };
  const schemaArg = customSchemaPath ? `--schema="${customSchemaPath}"` : '';
  return execSync(`npx prisma ${command} ${schemaArg}`, {
    cwd: SERVER_DIR,
    env,
    encoding: 'utf-8',
    timeout: 60000,
  });
}

/**
 * Real database-vs-Prisma-datamodel diff runner with explicit exit code capture.
 * Uses shell-safe argument array via execFileSync with npx.cmd (or npx on Linux).
 * Targets --from-url <DATABASE_URL> --to-schema-datamodel schemaPath --exit-code.
 * Returns { exitCode, output }:
 *   0 = empty diff (schema matches datamodel)
 *   2 = non-empty diff (schema drift detected)
 */
function runPrismaDiffDbVsDatamodel(
  dbUrlVal: string,
  schemaPath: string = 'prisma/schema.prisma'
): { exitCode: number; output: string } {
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  try {
    const output = execFileSync(
      npxCmd,
      [
        'prisma',
        'migrate',
        'diff',
        '--from-url',
        dbUrlVal,
        '--to-schema-datamodel',
        schemaPath,
        '--exit-code',
      ],
      {
        cwd: SERVER_DIR,
        encoding: 'utf-8',
        stdio: 'pipe',
        shell: true,
      }
    );
    return { exitCode: 0, output };
  } catch (err: any) {
    if (err.status !== undefined && err.status !== null) {
      return { exitCode: err.status, output: err.stdout || err.stderr || err.message || '' };
    }
    throw err;
  }
}

/**
 * Parse migrate diff output into normalized change blocks.
 */
function parseDiffBlocks(output: string): string[] {
  if (!output || !output.trim()) return [];
  return output
    .split(/\[\*\] Changed the /)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
}

/**
 * Extract TASK-009 owned drift entries from diff output.
 */
function findTask009OwnedDrift(output: string): string[] {
  const blocks = parseDiffBlocks(output);
  const matches: string[] = [];

  for (const block of blocks) {
    for (const table of TASK009_OWNED_TABLES) {
      if (block.startsWith(`\`${table}\` table`)) {
        matches.push(block);
      }
    }
    for (const field of TASK009_OWNED_FIELDS) {
      if (block.includes(`(${field})`) || block.includes(`\`${field}\``)) {
        matches.push(block);
      }
    }
  }
  return Array.from(new Set(matches));
}

/**
 * Identify new drift entries in final output that are NOT in baseline output.
 */
function findNewUnclassifiedDrift(finalOutput: string, baseOutput: string): string[] {
  const baseBlocks = new Set(parseDiffBlocks(baseOutput));
  const finalBlocks = parseDiffBlocks(finalOutput);
  return finalBlocks.filter((b) => !baseBlocks.has(b));
}

/**
 * Shell-safe argument-array process execution of docker/bootstrap-runtime-role.sh
 */
function runCanonicalBootstrapScript(dbName: string, appPass: string = PGPASSWORD, appRole: string = APP_ROLE): string {
  const scriptPath = path.join(ROOT_DIR, 'docker/bootstrap-runtime-role.sh');
  const scriptContent = fs.readFileSync(scriptPath, 'utf-8');
  const containerName = 'horplus_wave1d_fasttrack-db-1';

  return execFileSync(
    'docker',
    [
      'exec',
      '-i',
      '-e', `PGUSER=${PGUSER}`,
      '-e', `PGDATABASE=${dbName}`,
      '-e', `HORPLUS_APP_DB_USER=${appRole}`,
      '-e', `HORPLUS_APP_DB_PASSWORD=${appPass}`,
      containerName,
      'bash',
    ],
    {
      input: scriptContent,
      encoding: 'utf-8',
      timeout: 30000,
    }
  );
}

async function createDisposableDb(name: string): Promise<void> {
  await masterPrisma.$executeRawUnsafe(`CREATE DATABASE "${name}" OWNER "${PGUSER}"`);
}

async function dropDisposableDb(name: string): Promise<void> {
  try {
    await masterPrisma.$executeRawUnsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid()`
    );
    await masterPrisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}"`);
  } catch { /* ignore */ }
}

function computeFileSha256(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

describe('TASK-009 Checkpoint 1I — Hermetic Pre-Merge Migration & Bootstrap Proof', () => {
  beforeAll(async () => {
    // Self-contained temporary base audit worktree setup
    tempBaseWorktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'horplus_base_audit_'));
    execSync(`git worktree add --detach "${tempBaseWorktreeDir}" 2cbc3bd5c8e6626ed0ba79ee1a2b6b5049e43acf`, {
      cwd: ROOT_DIR,
      encoding: 'utf-8',
    });

    const baseHead = execSync(`git -C "${tempBaseWorktreeDir}" rev-parse HEAD`, { encoding: 'utf-8' }).trim();
    expect(baseHead).toBe('2cbc3bd5c8e6626ed0ba79ee1a2b6b5049e43acf');
  });

  afterAll(async () => {
    await dropDisposableDb(BASE_UPGRADE_DB);
    await dropDisposableDb(FRESH_DEPLOY_DB);

    // Clean up temporary base audit worktree
    if (tempBaseWorktreeDir && fs.existsSync(tempBaseWorktreeDir)) {
      try {
        execSync(`git worktree remove --force "${tempBaseWorktreeDir}"`, { cwd: ROOT_DIR });
        execSync(`git worktree prune`, { cwd: ROOT_DIR });
      } catch { /* ignore */ }
    }

    await masterPrisma.$disconnect();
    await mainAdminPrisma.$disconnect();
  });

  // =========================================================================
  // SECTION 0: Source-Level Target & Regression Proof
  // =========================================================================
  describe('Source-Level Target & Regression Proof', () => {
    it('0. Source code assertion: proves test file does NOT contain forbidden datasource option and DOES contain --to-schema-datamodel', () => {
      const fileContent = fs.readFileSync(__filename, 'utf-8');
      const forbiddenStr = ['--', 'to', 'schema', 'datasource'].join('-');
      expect(fileContent).not.toContain(forbiddenStr);
      expect(fileContent).toContain('--to-schema-datamodel');
    });

    it('0.1 Schema regression proof: proves DormitoryAccessGrant roleCode and status are declared as @db.VarChar(50)', () => {
      const schemaContent = fs.readFileSync(path.join(SERVER_DIR, 'prisma/schema.prisma'), 'utf-8');
      expect(schemaContent).toMatch(/model DormitoryAccessGrant\s*\{[\s\S]*?roleCode\s+String\s+@map\("role_code"\)\s+@db\.VarChar\(50\)/);
      expect(schemaContent).toMatch(/model DormitoryAccessGrant\s*\{[\s\S]*?status\s+String\s+@default\("ACTIVE"\)\s+@db\.VarChar\(50\)/);
    });
  });

  // =========================================================================
  // SECTION 1: Migration Checksum Truthfulness & Immutable Constants (§3, §4)
  // =========================================================================
  describe('Migration File Checksum Truthfulness & Frozen Constants', () => {
    it('1. Computes exact SHA-256 for all TASK-009 checked-in migration files and matches frozen constants', () => {
      for (const [mName, expectedHash] of Object.entries(EXPECTED_TASK009_MIGRATION_SHA256)) {
        const filePath = path.join(SERVER_DIR, `prisma/migrations/${mName}/migration.sql`);
        expect(fs.existsSync(filePath)).toBe(true);
        const computedHash = computeFileSha256(filePath);
        expect(computedHash).toBe(expectedHash);
      }
    });

    it('2. Main test DB stored migration checksums match frozen expected SHA-256 constants', async () => {
      const storedMigrations = await mainAdminPrisma.$queryRaw<any[]>`
        SELECT migration_name, checksum, finished_at, rolled_back_at
        FROM _prisma_migrations
        WHERE migration_name IN (
          '20260807120000_task009_staff_line_oa',
          '20260807140000_task009_owner_origin_fix',
          '20260807160000_task009_checkpoint1b_wiring',
          '20260807180000_task009_runtime_role_rls_grants'
        )
        ORDER BY started_at
      `;

      expect(storedMigrations.length).toBe(4);
      for (const row of storedMigrations) {
        const expectedSha256 = (EXPECTED_TASK009_MIGRATION_SHA256 as any)[row.migration_name];
        expect(row.finished_at).not.toBeNull();
        expect(row.rolled_back_at).toBeNull();
        expect(row.checksum).toBe(expectedSha256);
      }
    });
  });

  // =========================================================================
  // SECTION 2: Shell-Safe Canonical Bootstrap Execution & Authentication (§6)
  // =========================================================================
  describe('Canonical Runtime-Role Bootstrap Execution & Authentication', () => {
    it('3. Executes canonical bootstrap script with shell-safe argument array & special-character password', async () => {
      const specRole = 'horplus_app_spec_test';
      try {
        const output = runCanonicalBootstrapScript('horplus_wave1d_fasttrack_test', SPECIAL_PASSWORD, specRole);
        expect(output).toContain(`Runtime role '${specRole}' bootstrap complete.`);

        // Connection authenticated as horplus_app_spec_test with SPECIAL_PASSWORD
        const specialRuntimeUrl = `postgresql://${specRole}:${encodeURIComponent(SPECIAL_PASSWORD)}@${PGHOST}:${PGPORT}/horplus_wave1d_fasttrack_test?schema=public`;
        const testRuntimePrisma = new PrismaClient({
          datasources: { db: { url: specialRuntimeUrl } }
        });

        try {
          const userRes = await testRuntimePrisma.$queryRaw<any[]>`SELECT current_user AS cu`;
          expect(userRes[0].cu).toBe(specRole);
        } finally {
          await testRuntimePrisma.$disconnect();
        }
      } finally {
        try {
          await mainAdminPrisma.$executeRawUnsafe(`DROP ROLE IF EXISTS "${specRole}"`);
        } catch { /* ignore */ }
      }
    });

    it('4. Bootstrap is idempotent (second execution succeeds and preserves security posture)', async () => {
      const output = runCanonicalBootstrapScript('horplus_wave1d_fasttrack_test', 'password');
      expect(output).toContain('bootstrap complete');

      const roles = await mainAdminPrisma.$queryRaw<any[]>`
        SELECT rolname, rolcanlogin, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
        FROM pg_roles WHERE rolname = ${APP_ROLE}
      `;
      expect(roles.length).toBe(1);
      expect(roles[0].rolcanlogin).toBe(true);
      expect(roles[0].rolsuper).toBe(false);
      expect(roles[0].rolbypassrls).toBe(false);
      expect(roles[0].rolcreatedb).toBe(false);
      expect(roles[0].rolcreaterole).toBe(false);
    });

    it('5. Bootstrap unsafe-role correction proof (elevated privileges are corrected to NOBYPASSRLS)', async () => {
      try {
        await mainAdminPrisma.$executeRawUnsafe(`ALTER ROLE horplus_app BYPASSRLS`);
      } catch { /* ignore if non-superuser */ }

      runCanonicalBootstrapScript('horplus_wave1d_fasttrack_test', 'password');

      const roles = await mainAdminPrisma.$queryRaw<any[]>`
        SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = ${APP_ROLE}
      `;
      expect(roles[0].rolbypassrls).toBe(false);
      expect(roles[0].rolsuper).toBe(false);
    });

    it('6. Docker entrypoint init-db wrapper delegates directly to canonical bootstrap script', () => {
      const initDbPath = path.join(ROOT_DIR, 'docker/init-db.sh');
      const content = fs.readFileSync(initDbPath, 'utf-8');
      expect(content).toContain('bootstrap-runtime-role.sh');
      expect(content).not.toContain('FATAL: HORPLUS_APP_DB_PASSWORD not set');
    });
  });

  // =========================================================================
  // SECTION 3: Real Wave-1G Base Database Upgrade & Differential Schema Proof (§1, §7, §8)
  // =========================================================================
  describe('Real Wave-1G Base Database Upgrade & Differential Schema Proof', () => {
    let beforeCounts: Record<string, number> = {};
    const seededOwnerUserId = crypto.randomUUID();
    const seededManagerUserId = crypto.randomUUID();
    const seededDormId = crypto.randomUUID();
    const seededBuildingId = crypto.randomUUID();
    const seededRoomId = crypto.randomUUID();

    beforeAll(async () => {
      await createDisposableDb(BASE_UPGRADE_DB);
    });

    it('6. Applies ONLY base Wave-1G migrations (2cbc3bd) from temporary self-contained base worktree & records baseline schema drift', () => {
      expect(tempBaseWorktreeDir).not.toBeNull();
      expect(fs.existsSync(tempBaseWorktreeDir!)).toBe(true);

      const baseSchemaPath = path.join(tempBaseWorktreeDir!, 'server/prisma/schema.prisma');
      expect(fs.existsSync(baseSchemaPath)).toBe(true);

      const output = runPrismaCommand(BASE_UPGRADE_DB, 'migrate deploy', baseSchemaPath);
      expect(output).toContain('migration');

      // Record BASELINE_SCHEMA_DRIFT
      const baseDiffRes = runPrismaDiffDbVsDatamodel(dbUrl(BASE_UPGRADE_DB), baseSchemaPath);
      baselineSchemaDriftOutput = baseDiffRes.output;

      const client = new PrismaClient({ datasources: { db: { url: dbUrl(BASE_UPGRADE_DB) } } });
      return client.$queryRaw<any[]>`SELECT migration_name FROM _prisma_migrations ORDER BY started_at`
        .then((rows) => {
          expect(rows.length).toBe(9);
          expect(rows[rows.length - 1].migration_name).toBe('20260806110000_wave1g_corrective_fk_and_indexes');
        })
        .finally(() => client.$disconnect());
    }, 60000);

    it('7. Seeds representative pre-TASK009 Wave-1G data (Owner, Manager, Free/Paid Plans, Subscription) BEFORE upgrade', async () => {
      const client = new PrismaClient({ datasources: { db: { url: dbUrl(BASE_UPGRADE_DB) } } });
      try {
        // 1. Seed Owner User & Manager User
        const ownerUser = await client.user.create({
          data: { id: seededOwnerUserId, email: `owner_1i_${Date.now()}@test.com`, emailNormalized: `owner_1i_${Date.now()}@test.com`, name: 'Owner User', googleSubject: `goog_owner_${Date.now()}` }
        });
        const managerUser = await client.user.create({
          data: { id: seededManagerUserId, email: `manager_1i_${Date.now()}@test.com`, emailNormalized: `manager_1i_${Date.now()}@test.com`, name: 'Manager User', googleSubject: `goog_manager_${Date.now()}` }
        });

        // 2. Seed Dormitory
        const dorm = await client.dormitory.create({
          data: { id: seededDormId, name: 'Upgrade Test Dorm 1I', createdByUserId: ownerUser.id, timezone: 'Asia/Bangkok' }
        });

        // 3. Resolve Roles
        let ownerRole = await client.role.findFirst({ where: { code: 'OWNER' } });
        if (!ownerRole) {
          const roleRows = await client.$queryRaw<any[]>`
            INSERT INTO "roles" ("id", "code", "name", "permissions", "is_system", "created_at", "updated_at")
            VALUES (gen_random_uuid(), 'OWNER', 'Owner', '[]'::json, true, NOW(), NOW()) RETURNING "id"
          `;
          ownerRole = { id: roleRows[0].id } as any;
        }

        let managerRole = await client.role.findFirst({ where: { code: 'MANAGER' } });
        if (!managerRole) {
          const roleRows = await client.$queryRaw<any[]>`
            INSERT INTO "roles" ("id", "code", "name", "permissions", "is_system", "created_at", "updated_at")
            VALUES (gen_random_uuid(), 'MANAGER', 'Manager', '[]'::json, true, NOW(), NOW()) RETURNING "id"
          `;
          managerRole = { id: roleRows[0].id } as any;
        }

        // Insert pre-TASK009 members via raw SQL (before membership_origin column exists)
        await client.$executeRawUnsafe(`
          INSERT INTO "dormitory_members" ("id", "dormitory_id", "user_id", "role_id", "status", "created_at", "updated_at")
          VALUES
            (gen_random_uuid(), '${dorm.id}'::uuid, '${ownerUser.id}'::uuid, '${ownerRole!.id}'::uuid, 'active', NOW(), NOW()),
            (gen_random_uuid(), '${dorm.id}'::uuid, '${managerUser.id}'::uuid, '${managerRole!.id}'::uuid, 'active', NOW(), NOW())
        `);

        // 4. Seed Building & Room
        const building = await client.building.create({
          data: { id: seededBuildingId, dormitoryId: dorm.id, name: 'Building A', displayOrder: 1 }
        });
        await client.room.create({
          data: { id: seededRoomId, dormitoryId: dorm.id, buildingId: building.id, roomNumber: '101', normalizedRoomNumber: '101', roomType: 'STANDARD', monthlyRent: 5000 }
        });

        // 5. Seed Subscription Plans (FREE and PAID) & DormitorySubscription via raw SQL (before message_quota_monthly column exists)
        let freePlanRows = await client.$queryRaw<any[]>`SELECT id FROM subscription_plans WHERE type = 'FREE'`;
        let freePlanId: string;
        if (!freePlanRows || freePlanRows.length === 0) {
          const inserted = await client.$queryRaw<any[]>`
            INSERT INTO "subscription_plans" ("id", "code", "name", "type", "room_limit", "enabled", "created_at", "updated_at")
            VALUES (gen_random_uuid(), 'FREE', 'Free Plan', 'FREE'::"SubscriptionPlanType", 30, true, NOW(), NOW()) RETURNING "id"
          `;
          freePlanId = inserted[0].id;
        } else {
          freePlanId = freePlanRows[0].id;
        }

        let paidPlanRows = await client.$queryRaw<any[]>`SELECT id FROM subscription_plans WHERE type = 'PAID'`;
        let paidPlanId: string;
        if (!paidPlanRows || paidPlanRows.length === 0) {
          const inserted = await client.$queryRaw<any[]>`
            INSERT INTO "subscription_plans" ("id", "code", "name", "type", "room_limit", "enabled", "created_at", "updated_at")
            VALUES (gen_random_uuid(), 'PAID', 'Paid Plan', 'PAID'::"SubscriptionPlanType", 300, true, NOW(), NOW()) RETURNING "id"
          `;
          paidPlanId = inserted[0].id;
        } else {
          paidPlanId = paidPlanRows[0].id;
        }

        await client.$executeRawUnsafe(`
          INSERT INTO "dormitory_subscriptions" ("id", "dormitory_id", "plan_id", "status", "expires_at", "created_at", "updated_at")
          VALUES (gen_random_uuid(), '${dorm.id}'::uuid, '${paidPlanId}'::uuid, 'ACTIVE'::"DormitorySubscriptionStatus", NOW() + INTERVAL '30 days', NOW(), NOW())
        `);

        // Record BEFORE counts
        beforeCounts = {
          User: await client.user.count(),
          Dormitory: await client.dormitory.count(),
          DormitoryMember: await client.dormitoryMember.count(),
          Building: await client.building.count(),
          Room: await client.room.count(),
          SubscriptionPlan: await client.subscriptionPlan.count(),
          DormitorySubscription: await client.dormitorySubscription.count(),
        };

        expect(beforeCounts.User).toBeGreaterThanOrEqual(2);
        expect(beforeCounts.Dormitory).toBeGreaterThanOrEqual(1);
        expect(beforeCounts.DormitoryMember).toBeGreaterThanOrEqual(2);
        expect(beforeCounts.Building).toBeGreaterThanOrEqual(1);
        expect(beforeCounts.Room).toBeGreaterThanOrEqual(1);
        expect(beforeCounts.SubscriptionPlan).toBeGreaterThanOrEqual(2);
        expect(beforeCounts.DormitorySubscription).toBeGreaterThanOrEqual(1);

        // Verify zero TASK-009 migrations exist
        const migrationCount = await client.$queryRaw<any[]>`SELECT COUNT(*)::int AS count FROM _prisma_migrations`;
        expect(parseInt(migrationCount[0].count)).toBe(9);
      } finally {
        await client.$disconnect();
      }
    });

    it('8. Runs bootstrap script and deploys feature-branch TASK-009 migrations over base database', () => {
      runCanonicalBootstrapScript(BASE_UPGRADE_DB, 'password');

      const output = runPrismaCommand(BASE_UPGRADE_DB, 'migrate deploy');
      expect(output).toContain('The following migration(s) have been applied');

      const client = new PrismaClient({ datasources: { db: { url: dbUrl(BASE_UPGRADE_DB) } } });
      return client.$queryRaw<any[]>`SELECT migration_name, checksum FROM _prisma_migrations ORDER BY started_at`
        .then((rows) => {
          expect(rows.length).toBe(13);
          const task009Rows = rows.slice(9);
          expect(task009Rows.length).toBe(4);
          for (const row of task009Rows) {
            const expectedSha256 = (EXPECTED_TASK009_MIGRATION_SHA256 as any)[row.migration_name];
            expect(row.checksum).toBe(expectedSha256);
          }
        })
        .finally(() => client.$disconnect());
    }, 60000);

    it('9. Verifies exact migration semantics, quota backfill, owner/manager origins & ZERO TASK-009 schema drift AFTER upgrade', async () => {
      const client = new PrismaClient({ datasources: { db: { url: dbUrl(BASE_UPGRADE_DB) } } });
      try {
        // 1. Assert row counts preserved
        const afterCounts: Record<string, number> = {
          User: await client.user.count(),
          Dormitory: await client.dormitory.count(),
          DormitoryMember: await client.dormitoryMember.count(),
          Building: await client.building.count(),
          Room: await client.room.count(),
          SubscriptionPlan: await client.subscriptionPlan.count(),
          DormitorySubscription: await client.dormitorySubscription.count(),
        };

        for (const key of Object.keys(beforeCounts)) {
          expect(afterCounts[key]).toBe(beforeCounts[key]);
        }

        // 2. Assert OWNER membership origin backfilled to GOOGLE_BOOTSTRAP
        const ownerMember = await client.dormitoryMember.findFirst({
          where: { dormitoryId: seededDormId, userId: seededOwnerUserId }
        });
        expect(ownerMember?.membershipOrigin).toBe('GOOGLE_BOOTSTRAP');

        // 3. Assert MANAGER membership origin backfilled to LEGACY_MEMBER (not GOOGLE_BOOTSTRAP)
        const managerMember = await client.dormitoryMember.findFirst({
          where: { dormitoryId: seededDormId, userId: seededManagerUserId }
        });
        expect(managerMember?.membershipOrigin).toBe('LEGACY_MEMBER');

        // 4. Assert quota backfill: FREE = 30, PAID = 300
        const freePlan = await client.subscriptionPlan.findFirst({ where: { type: 'FREE' } });
        const paidPlan = await client.subscriptionPlan.findFirst({ where: { type: 'PAID' } });

        expect(freePlan?.messageQuotaMonthly).toBe(30);
        expect(paidPlan?.messageQuotaMonthly).toBe(300);

        // 5. Assert Wave 1F DormitorySubscription preserved
        const sub = await client.dormitorySubscription.findFirst({ where: { dormitoryId: seededDormId } });
        expect(sub?.status).toBe('ACTIVE');

        // 6. Differential schema drift assertions
        const finalDiffRes = runPrismaDiffDbVsDatamodel(dbUrl(BASE_UPGRADE_DB));

        // 6A. Assert ZERO TASK-009 owned drift entries
        const task009OwnedDrift = findTask009OwnedDrift(finalDiffRes.output);
        expect(task009OwnedDrift).toEqual([]);

        // 6B. Assert ZERO new unclassified drift entries over baseline
        const newUnclassifiedDrift = findNewUnclassifiedDrift(finalDiffRes.output, baselineSchemaDriftOutput);
        expect(newUnclassifiedDrift).toEqual([]);
      } finally {
        await client.$disconnect();
      }
    });
  });

  // =========================================================================
  // SECTION 4: Fresh Final Database Deployment & Differential Schema Drift Proof (§1, §2, §3, §4, §5, §11)
  // =========================================================================
  describe('Fresh Final Database Deployment & Differential Schema Drift Proof', () => {
    beforeAll(async () => {
      await createDisposableDb(FRESH_DEPLOY_DB);
      runCanonicalBootstrapScript(FRESH_DEPLOY_DB, 'password');
    });

    it('10. Fresh migrate deploy applies all 13 migrations from zero', () => {
      const output = runPrismaCommand(FRESH_DEPLOY_DB, 'migrate deploy');
      expect(output).toContain('13 migrations');
    }, 60000);

    it('11. Second deploy returns zero pending migrations', () => {
      const output = runPrismaCommand(FRESH_DEPLOY_DB, 'migrate deploy');
      expect(output).toContain('No pending migrations');
    }, 60000);

    it('12. Migration status is up to date with zero warnings', () => {
      const output = runPrismaCommand(FRESH_DEPLOY_DB, 'migrate status');
      expect(output).toContain('Database schema is up to date');
      expect(output).not.toContain('modified since they were applied');
    }, 60000);

    it('13.1 Disposable fault-injection proof: proves actual DB-vs-datamodel diff detects database schema drift with exit code 2 & column detection', async () => {
      const driftDbName = `task009_1i_drift_probe_${Date.now()}`;
      await createDisposableDb(driftDbName);
      try {
        runCanonicalBootstrapScript(driftDbName, 'password');
        runPrismaCommand(driftDbName, 'migrate deploy');

        const client = new PrismaClient({ datasources: { db: { url: dbUrl(driftDbName) } } });
        try {
          // Inject schema drift by altering a table in the database
          await client.$executeRawUnsafe(`ALTER TABLE "dormitory_line_friends" ADD COLUMN "task009_drift_probe" TEXT`);
        } finally {
          await client.$disconnect();
        }

        // Run diff against drift-injected database -> must exit with code 2 and identify task009_drift_probe
        const diffRes = runPrismaDiffDbVsDatamodel(dbUrl(driftDbName));
        expect(diffRes.exitCode).toBe(2);
        expect(diffRes.output).toContain('task009_drift_probe');

        const task009Drift = findTask009OwnedDrift(diffRes.output);
        expect(task009Drift.length).toBeGreaterThan(0);
      } finally {
        await dropDisposableDb(driftDbName);
      }
    }, 60000);

    it('13.2 Fresh untouched final DB vs datamodel diff produces ZERO TASK-009 schema drift and ZERO new unclassified drift', () => {
      const diffRes = runPrismaDiffDbVsDatamodel(dbUrl(FRESH_DEPLOY_DB));

      // 1. Assert ZERO TASK-009 owned drift
      const task009OwnedDrift = findTask009OwnedDrift(diffRes.output);
      expect(task009OwnedDrift).toEqual([]);

      // 2. Assert ZERO new unclassified drift over baseline
      const newUnclassifiedDrift = findNewUnclassifiedDrift(diffRes.output, baselineSchemaDriftOutput);
      expect(newUnclassifiedDrift).toEqual([]);
    }, 60000);

    it('13.3 Negative datamodel-semantic proof: proves actual DB-vs-datamodel diff detects datamodel drift with exit code 2 & column detection', () => {
      const tempSchemaPath = path.join(SERVER_DIR, 'prisma/schema.temp.prisma');
      try {
        const originalSchema = fs.readFileSync(path.join(SERVER_DIR, 'prisma/schema.prisma'), 'utf-8');
        const modifiedSchema = originalSchema.replace(
          'model DormitoryLineFriend {',
          'model DormitoryLineFriend {\n  tempDatamodelDriftProbe String? @map("temp_datamodel_drift_probe")'
        );
        fs.writeFileSync(tempSchemaPath, modifiedSchema, 'utf-8');

        const diffRes = runPrismaDiffDbVsDatamodel(dbUrl(FRESH_DEPLOY_DB), 'prisma/schema.temp.prisma');
        expect(diffRes.exitCode).toBe(2);
        expect(diffRes.output).toContain('temp_datamodel_drift_probe');

        const newDrift = findNewUnclassifiedDrift(diffRes.output, baselineSchemaDriftOutput);
        expect(newDrift.some((b) => b.includes('temp_datamodel_drift_probe'))).toBe(true);
      } finally {
        if (fs.existsSync(tempSchemaPath)) {
          fs.unlinkSync(tempSchemaPath);
        }
      }
    }, 60000);

    it('14. All 13 migrations in fresh DB have valid finished_at and matching frozen checksum constants', async () => {
      const client = new PrismaClient({ datasources: { db: { url: dbUrl(FRESH_DEPLOY_DB) } } });
      try {
        const rows = await client.$queryRaw<any[]>`
          SELECT migration_name, checksum, finished_at, rolled_back_at
          FROM _prisma_migrations ORDER BY started_at
        `;
        expect(rows.length).toBe(13);
        for (const row of rows) {
          expect(row.finished_at).not.toBeNull();
          expect(row.rolled_back_at).toBeNull();

          const expectedSha256 = (EXPECTED_TASK009_MIGRATION_SHA256 as any)[row.migration_name];
          if (expectedSha256) {
            expect(row.checksum).toBe(expectedSha256);
          }
        }
      } finally {
        await client.$disconnect();
      }
    });
  });

  // =========================================================================
  // SECTION 5: Resolver Catalog & RLS Security Posture (§4, §9, §10, §12)
  // =========================================================================
  describe('Resolver Catalog & Six-Table RLS Posture', () => {
    it('15. RLS Catalog Proof: All six TASK-009 tables have relrowsecurity=true, relforcerowsecurity=false, owned by horplus (FORCE RLS: false / NOT REQUIRED because horplus_app is non-owner and NOBYPASSRLS)', async () => {
      const tables = await mainAdminPrisma.$queryRaw<any[]>`
        SELECT c.relname AS tablename,
               pg_get_userbyid(c.relowner) AS owner,
               c.relrowsecurity AS rowsecurity,
               c.relforcerowsecurity AS forcerowsecurity
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname IN (
            'dormitory_line_friends', 'dormitory_access_grants',
            'dormitory_line_configs', 'line_webhook_event_receipts',
            'line_push_usage', 'line_push_delivery_attempts'
          )
      `;
      expect(tables.length).toBe(6);
      for (const t of tables) {
        expect(t.owner).toBe('horplus');
        expect(t.owner).not.toBe('horplus_app');
        expect(t.rowsecurity).toBe(true);
        expect(t.forcerowsecurity).toBe(false);
      }

      // Verify horplus_app role attributes
      const appRoleAttrs = await mainAdminPrisma.$queryRaw<any[]>`
        SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'horplus_app'
      `;
      expect(appRoleAttrs[0].rolsuper).toBe(false);
      expect(appRoleAttrs[0].rolbypassrls).toBe(false);
    });

    it('16. Resolver Privilege Proof: Owned by horplus, SECURITY DEFINER, PUBLIC EXECUTE denied, horplus_app EXECUTE granted', async () => {
      const resolvers = await mainAdminPrisma.$queryRaw<any[]>`
        SELECT p.proname AS func_name,
               pg_get_userbyid(p.proowner) AS owner,
               p.prosecdef AS is_security_definer,
               pg_catalog.has_function_privilege('public', p.oid, 'EXECUTE') AS public_can_execute,
               pg_catalog.has_function_privilege('horplus_app', p.oid, 'EXECUTE') AS app_can_execute
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public'
          AND p.proname IN ('resolve_line_webhook_config', 'resolve_access_grant_token', 'resolve_access_grant_by_id')
      `;
      expect(resolvers.length).toBe(3);
      for (const r of resolvers) {
        expect(r.owner).toBe('horplus');
        expect(r.is_security_definer).toBe(true);
        expect(r.public_can_execute).toBe(false);
        expect(r.app_can_execute).toBe(true);
      }
    });
  });
});
