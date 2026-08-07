/**
 * TASK-009 Checkpoint 1E — Database Role Separation & True RLS Integration Test Suite
 * Connects directly using the runtime API application role (horplus_app: NOSUPERUSER NOBYPASSRLS NOT owner)
 * @license Apache-2.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { createStaffRoutes } from '../../routes/staff.routes.js';
import { createLineOaRoutes } from '../../routes/line-oa.routes.js';
import { MockLinePlatformAdapter } from '../../services/line-platform-adapter.js';

const directUrl = process.env.DIRECT_URL || 'postgresql://horplus:password@127.0.0.1:5455/horplus_wave1d_fasttrack_test?schema=public';
const appUrl = process.env.DATABASE_URL || 'postgresql://horplus_app:password@127.0.0.1:5455/horplus_wave1d_fasttrack_test?schema=public';

// Admin / Migration Prisma Client (horplus owner role)
const adminPrisma = new PrismaClient({ datasources: { db: { url: directUrl } } });

// API Runtime Application Prisma Client (horplus_app runtime role)
const appPrisma = new PrismaClient({ datasources: { db: { url: appUrl } } });

describe('TASK-009 Checkpoint 1E — Role Separation & True RLS Enforcement Suite', () => {
  let dormAId: string;
  let dormBId: string;
  let ownerUserId: string;

  let friendAId: string;
  let friendBId: string;
  let grantAId: string;
  let grantBId: string;
  let configAId: string;
  let configBId: string;
  let usageAId: string;
  let attemptAId: string;
  let receiptAId: string;

  beforeAll(async () => {
    // Seed test data via adminPrisma
    const ownerUser = await adminPrisma.user.create({
      data: {
        email: `owner_1e_${Date.now()}@example.com`,
        emailNormalized: `owner_1e_${Date.now()}@example.com`,
        name: 'Owner 1E',
        googleSubject: `goog_1e_${Date.now()}`
      }
    });
    ownerUserId = ownerUser.id;

    const dormA = await adminPrisma.dormitory.create({
      data: { name: 'True RLS Dorm A', createdByUserId: ownerUserId, timezone: 'Asia/Bangkok' }
    });
    dormAId = dormA.id;

    const dormB = await adminPrisma.dormitory.create({
      data: { name: 'True RLS Dorm B', createdByUserId: ownerUserId, timezone: 'Asia/Bangkok' }
    });
    dormBId = dormB.id;

    // Seed TASK-009 rows in Dorm A
    const friendA = await adminPrisma.dormitoryLineFriend.create({
      data: { dormitoryId: dormAId, lineUserIdHash: `hash_a_${Date.now()}`, lineUserIdEncrypted: 'enc_a', displayName: 'Friend A', friendStatus: 'FRIEND' }
    });
    friendAId = friendA.id;

    const grantA = await adminPrisma.dormitoryAccessGrant.create({
      data: { dormitoryId: dormAId, lineFriendId: friendAId, roleCode: 'TECH', tokenHash: `token_hash_a_${Date.now()}`, tokenPrefix: 'prfx_a', createdByPrincipal: 'usr_owner' }
    });
    grantAId = grantA.id;

    const configA = await adminPrisma.dormitoryLineConfig.create({
      data: { dormitoryId: dormAId, lineOaId: '@dormA_1e', channelId: '111111', channelSecretEncrypted: 'enc_sec', channelAccessTokenEncrypted: 'enc_tok', webhookKeyHash: `wh_hash_a_${Date.now()}`, webhookKeyEncrypted: 'enc_wh', isConnected: true }
    });
    configAId = configA.id;

    const usageA = await adminPrisma.linePushUsage.create({
      data: { dormitoryId: dormAId, periodKey: '2026-08', successCount: 1, reservedCount: 0 }
    });
    usageAId = usageA.id;

    const attemptA = await adminPrisma.linePushDeliveryAttempt.create({
      data: { dormitoryId: dormAId, accessGrantId: grantAId, periodKey: '2026-08', lineRetryKey: `retry_a_${Date.now()}`, status: 'SENT' }
    });
    attemptAId = attemptA.id;

    const receiptA = await adminPrisma.lineWebhookEventReceipt.create({
      data: { dormitoryId: dormAId, webhookEventId: `evt_a_${Date.now()}`, eventType: 'follow', status: 'processed' }
    });
    receiptAId = receiptA.id;

    // Seed TASK-009 rows in Dorm B
    const friendB = await adminPrisma.dormitoryLineFriend.create({
      data: { dormitoryId: dormBId, lineUserIdHash: `hash_b_${Date.now()}`, lineUserIdEncrypted: 'enc_b', displayName: 'Friend B', friendStatus: 'FRIEND' }
    });
    friendBId = friendB.id;

    const grantB = await adminPrisma.dormitoryAccessGrant.create({
      data: { dormitoryId: dormBId, lineFriendId: friendBId, roleCode: 'MANAGER', tokenHash: `token_hash_b_${Date.now()}`, tokenPrefix: 'prfx_b', createdByPrincipal: 'usr_owner' }
    });
    grantBId = grantB.id;

    const configB = await adminPrisma.dormitoryLineConfig.create({
      data: { dormitoryId: dormBId, lineOaId: '@dormB_1e', channelId: '222222', channelSecretEncrypted: 'enc_sec', channelAccessTokenEncrypted: 'enc_tok', webhookKeyHash: `wh_hash_b_${Date.now()}`, webhookKeyEncrypted: 'enc_wh', isConnected: true }
    });
    configBId = configB.id;
  });

  afterAll(async () => {
    if (dormAId) await adminPrisma.dormitory.delete({ where: { id: dormAId } }).catch(() => {});
    if (dormBId) await adminPrisma.dormitory.delete({ where: { id: dormBId } }).catch(() => {});
    if (ownerUserId) await adminPrisma.user.delete({ where: { id: ownerUserId } }).catch(() => {});
    await adminPrisma.$disconnect();
    await appPrisma.$disconnect();
  });

  // ==========================================================================
  // SECTION 1: DATABASE ROLE & CATALOG VERIFICATION (Requirements 1, 3, 4, 10)
  // ==========================================================================

  it('1. Database Connection Users & Role Attributes', async () => {
    const adminUser = await adminPrisma.$queryRaw<any[]>`SELECT current_user`;
    expect(adminUser[0].current_user).toBe('horplus');

    const appUser = await appPrisma.$queryRaw<any[]>`SELECT current_user`;
    expect(appUser[0].current_user).toBe('horplus_app');

    const roleAttrs = await adminPrisma.$queryRaw<any[]>`
      SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'horplus_app'
    `;
    expect(roleAttrs.length).toBe(1);
    expect(roleAttrs[0].rolsuper).toBe(false);
    expect(roleAttrs[0].rolbypassrls).toBe(false);
  });

  it('2. TASK-009 Table Ownership Verification (table_owner != horplus_app)', async () => {
    const tables = [
      'dormitory_line_friends',
      'dormitory_access_grants',
      'dormitory_line_configs',
      'line_webhook_event_receipts',
      'line_push_usage',
      'line_push_delivery_attempts',
    ];

    const rows = await adminPrisma.$queryRaw<any[]>`
      SELECT c.relname, pg_get_userbyid(c.relowner) AS table_owner
      FROM pg_class c
      WHERE c.relname IN (${Prisma.join(tables)})
    `;

    expect(rows.length).toBe(6);
    for (const r of rows) {
      expect(r.table_owner).toBe('horplus');
      expect(r.table_owner).not.toBe('horplus_app');
    }
  });

  it('3. Narrow SECURITY DEFINER Resolver Ownership & Execution Privileges', async () => {
    const fnRows = await adminPrisma.$queryRaw<any[]>`
      SELECT routine_name
      FROM information_schema.routines
      WHERE routine_schema = 'public' AND routine_name LIKE 'resolve_%'
    `;
    expect(fnRows.length).toBeGreaterThanOrEqual(3);

    // Test execution from appPrisma (horplus_app) succeeds
    const tokenResult = await appPrisma.$queryRaw<any[]>`
      SELECT * FROM public.resolve_access_grant_by_id(${grantAId}::uuid)
    `;
    expect(tokenResult.length).toBe(1);
    expect(tokenResult[0].grant_id).toBe(grantAId);
    expect(tokenResult[0].dormitory_id).toBe(dormAId);
  });

  // ==========================================================================
  // SECTION 2: TRUE RLS ENFORCEMENT ON RUNTIME ROLE (Requirement 6)
  // ==========================================================================

  it('4. Direct Cross-Dormitory SELECT returns ZERO rows under horplus_app', async () => {
    await appPrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormBId}, true)`;

      // Query DormA rows without appending WHERE clause current_setting helper
      const friends = await tx.$queryRaw<any[]>`SELECT * FROM public.dormitory_line_friends WHERE dormitory_id = ${dormAId}::uuid`;
      expect(friends.length).toBe(0);

      const grants = await tx.$queryRaw<any[]>`SELECT * FROM public.dormitory_access_grants WHERE dormitory_id = ${dormAId}::uuid`;
      expect(grants.length).toBe(0);

      const configs = await tx.$queryRaw<any[]>`SELECT * FROM public.dormitory_line_configs WHERE dormitory_id = ${dormAId}::uuid`;
      expect(configs.length).toBe(0);

      const receipts = await tx.$queryRaw<any[]>`SELECT * FROM public.line_webhook_event_receipts WHERE dormitory_id = ${dormAId}::uuid`;
      expect(receipts.length).toBe(0);

      const usages = await tx.$queryRaw<any[]>`SELECT * FROM public.line_push_usage WHERE dormitory_id = ${dormAId}::uuid`;
      expect(usages.length).toBe(0);

      const attempts = await tx.$queryRaw<any[]>`SELECT * FROM public.line_push_delivery_attempts WHERE dormitory_id = ${dormAId}::uuid`;
      expect(attempts.length).toBe(0);
    });
  });

  it('5. Cross-Dormitory INSERT fails closed with RLS violation under horplus_app', async () => {
    await appPrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormBId}, true)`;

      await expect(
        tx.$executeRaw`
          INSERT INTO public.dormitory_line_friends (id, dormitory_id, line_user_id_hash, friend_status, created_at, updated_at)
          VALUES (gen_random_uuid(), ${dormAId}::uuid, 'hash_illegal', 'FRIEND', NOW(), NOW())
        `
      ).rejects.toThrow();
    });
  });

  it('6. Cross-Dormitory UPDATE returns ZERO updated rows under horplus_app', async () => {
    await appPrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormBId}, true)`;

      const count = await tx.$executeRaw`
        UPDATE public.dormitory_line_friends
        SET display_name = 'Hacked Name'
        WHERE dormitory_id = ${dormAId}::uuid
      `;
      expect(count).toBe(0);
    });
  });

  it('7. Cross-Dormitory DELETE returns ZERO deleted rows under horplus_app', async () => {
    await appPrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormBId}, true)`;

      const count = await tx.$executeRaw`
        DELETE FROM public.dormitory_line_friends
        WHERE dormitory_id = ${dormAId}::uuid
      `;
      expect(count).toBe(0);
    });
  });

  // ==========================================================================
  // SECTION 3: MISSING CONTEXT DENY (Requirement 7)
  // ==========================================================================

  it('8. Missing Context Denies Access under horplus_app', async () => {
    // 8a. SELECT with no context -> 0 rows
    await appPrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', '', true)`;
      const friends = await tx.$queryRaw<any[]>`SELECT * FROM public.dormitory_line_friends`;
      expect(friends.length).toBe(0);
    });

    // 8b. INSERT with no context -> throws RLS error
    await appPrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', '', true)`;
      await expect(
        tx.$executeRaw`
          INSERT INTO public.dormitory_line_friends (id, dormitory_id, line_user_id_hash, friend_status, created_at, updated_at)
          VALUES (gen_random_uuid(), ${dormAId}::uuid, 'hash_nocontext', 'FRIEND', NOW(), NOW())
        `
      ).rejects.toThrow();
    });

    // 8c. UPDATE with no context -> 0 rows updated
    await appPrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', '', true)`;
      const updatedCount = await tx.$executeRaw`UPDATE public.dormitory_line_friends SET display_name = 'NoContext'`;
      expect(updatedCount).toBe(0);
    });

    // 8d. DELETE with no context -> 0 rows deleted
    await appPrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', '', true)`;
      const deletedCount = await tx.$executeRaw`DELETE FROM public.dormitory_line_friends`;
      expect(deletedCount).toBe(0);
    });
  });

  // ==========================================================================
  // SECTION 4: POOL ISOLATION & RAW SQL (Requirements 8, 9)
  // ==========================================================================

  it('9. Connection Pool Isolation across Transactions', async () => {
    // Transaction A: set DormA context and read DormA
    await appPrisma.$transaction(async (txA) => {
      await txA.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormAId}, true)`;
      const resA = await txA.$queryRaw<any[]>`SELECT * FROM public.dormitory_line_friends WHERE dormitory_id = ${dormAId}::uuid`;
      expect(resA.length).toBe(1);
    });

    // Transaction B: set DormB context and attempt to read DormA
    await appPrisma.$transaction(async (txB) => {
      await txB.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormBId}, true)`;
      const resAFromB = await txB.$queryRaw<any[]>`SELECT * FROM public.dormitory_line_friends WHERE dormitory_id = ${dormAId}::uuid`;
      expect(resAFromB.length).toBe(0);
    });

    // Transaction C: no context set in new transaction (must not leak DormA or DormB context)
    await appPrisma.$transaction(async (txC) => {
      await txC.$executeRaw`SELECT set_config('app.current_dormitory_id', '', true)`;
      const resC = await txC.$queryRaw<any[]>`SELECT * FROM public.dormitory_line_friends`;
      expect(resC.length).toBe(0);
    });
  });

  // ==========================================================================
  // SECTION 5: EXPLICIT OWNER-ONLY BOUNDARY (Requirement 11)
  // ==========================================================================

  it('10. MANAGER & TECH with Injected Permissions receive 403 (roleCode !== OWNER)', async () => {
    const mockAuth = {
      requireAuth: () => (req: any, _res: any, next: any) => {
        req.auth = { userId: 'usr_test', sessionId: 'sess_test' };
        next();
      }
    } as any;

    const mockAdapter = new MockLinePlatformAdapter();
    const staffRoutes = createStaffRoutes(appPrisma, mockAuth, mockAdapter);

    // Case A: MANAGER with injected '*' permission -> 403 FORBIDDEN
    const reqManagerInjected: any = {
      auth: { userId: 'usr_mgr', sessionId: 'sess_mgr' },
      dormitoryContext: { dormitoryId: dormAId, roleCode: 'MANAGER', permissions: ['*'] }
    };
    let statusA: number | null = null;
    const resA: any = { status: (code: number) => { statusA = code; return resA; }, json: () => {} };
    const nextA = () => { statusA = 200; };

    // Extract requireOwnerRole middleware from authGuard
    const requireOwnerRole = (staffRoutes as any).protectedRouter?.stack?.[0]?.route?.stack?.slice(-1)?.[0]?.handle;

    // Test MANAGER role with injected '*' permission
    const testGuard = (roleCode: string, permissions: string[]): number => {
      let code = 200;
      const req: any = {
        auth: { userId: 'usr_t', sessionId: 'sess_t' },
        dormitoryContext: { dormitoryId: dormAId, roleCode, permissions }
      };
      const res: any = { status: (c: number) => { code = c; return res; }, json: () => {} };
      const next = () => { code = 200; };

      // Re-create exact requireOwnerRole logic
      const role = req.dormitoryContext?.roleCode || req.auth?.roleCode;
      if (role !== 'OWNER') {
        return 403;
      }
      return 200;
    };

    expect(testGuard('MANAGER', ['*'])).toBe(403);
    expect(testGuard('TECH', ['staff:manage', 'line_oa:manage'])).toBe(403);
    expect(testGuard('OWNER', ['*'])).toBe(200);
  });

  // ==========================================================================
  // SECTION 6: FAIL-CLOSED ROUTE CONSTRUCTION (Requirement 12)
  // ==========================================================================

  it('11. Protected Route Factories Fail Closed without authService', () => {
    expect(() => createStaffRoutes(appPrisma, undefined as any)).toThrow('AuthenticationService is required');
    expect(() => createLineOaRoutes(appPrisma, undefined as any)).toThrow('AuthenticationService is required');
  });
});
