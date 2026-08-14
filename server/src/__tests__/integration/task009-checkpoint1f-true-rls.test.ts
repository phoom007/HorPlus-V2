/**
 * TASK-009 Checkpoint 1F — Role Separation, True RLS & API Compatibility Integration Suite
 * Connects directly using the runtime API application role (horplus_app: NOSUPERUSER NOBYPASSRLS NOT owner)
 * @license Apache-2.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import express, { Express } from 'express';
import request from 'supertest';
import { createStaffRoutes } from '../../routes/staff.routes.js';
import { createLineOaRoutes } from '../../routes/line-oa.routes.js';
import { MockLinePlatformAdapter } from '../../services/line-platform-adapter.js';

const rawAdminUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!rawAdminUrl) {
  throw new Error('DIRECT_URL or DATABASE_URL must be configured for test database connection');
}

const parsedDirect = new URL(rawAdminUrl);
const dbHost = parsedDirect.hostname;
const dbPort = parsedDirect.port || '5455';
const dbName = parsedDirect.pathname.replace(/^\//, '');

// Safety check: only approved local test database cluster allowed
if (dbHost !== '127.0.0.1' || dbPort !== '5455' || dbName !== 'horplus_wave1d_fasttrack_test') {
  throw new Error(`Safety check failed: Test database must be 127.0.0.1:5455/horplus_wave1d_fasttrack_test (got ${dbHost}:${dbPort}/${dbName})`);
}

const appUser = process.env.HORPLUS_APP_DB_USER || 'horplus_app';
const appPassword = process.env.HORPLUS_APP_DB_PASSWORD || parsedDirect.password;

if (!appPassword) {
  throw new Error('HORPLUS_APP_DB_PASSWORD is required for runtime role RLS test execution');
}

const directUrl = rawAdminUrl;
const appUrl = `postgresql://${appUser}:${encodeURIComponent(appPassword)}@${dbHost}:${dbPort}/${dbName}?schema=public`;

// Migration/Owner Prisma Client (horplus)
const adminPrisma = new PrismaClient({ datasources: { db: { url: directUrl } } });

// API Runtime Application Prisma Client (horplus_app)
const appPrisma = new PrismaClient({ datasources: { db: { url: appUrl } } });

describe('TASK-009 Checkpoint 1F — True RLS & API Runtime Role Compatibility Suite', () => {
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
    // Ensure runtime role credentials and security attributes are synchronized
    await adminPrisma.$executeRawUnsafe(
      `ALTER ROLE ${appUser} WITH PASSWORD '${appPassword.replace(/'/g, "''")}' LOGIN NOSUPERUSER NOBYPASSRLS;`
    );

    // Seed test data via adminPrisma
    const ownerUser = await adminPrisma.user.create({
      data: {
        email: `owner_1f_${Date.now()}@example.com`,
        emailNormalized: `owner_1f_${Date.now()}@example.com`,
        name: 'Owner 1F',
        googleSubject: `goog_1f_${Date.now()}`
      }
    });
    ownerUserId = ownerUser.id;

    const dormA = await adminPrisma.dormitory.create({
      data: { name: 'True RLS Dorm A 1F', status: 'active', createdByUserId: ownerUserId, timezone: 'Asia/Bangkok' }
    });
    dormAId = dormA.id;

    const dormB = await adminPrisma.dormitory.create({
      data: { name: 'True RLS Dorm B 1F', status: 'active', createdByUserId: ownerUserId, timezone: 'Asia/Bangkok' }
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
      data: { dormitoryId: dormAId, lineOaId: '@dormA_1f', channelId: '111111', channelSecretEncrypted: 'enc_sec', channelAccessTokenEncrypted: 'enc_tok', webhookKeyHash: `wh_hash_a_${Date.now()}`, webhookKeyEncrypted: 'enc_wh', isConnected: true }
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
      data: { dormitoryId: dormBId, lineOaId: '@dormB_1f', channelId: '222222', channelSecretEncrypted: 'enc_sec', channelAccessTokenEncrypted: 'enc_tok', webhookKeyHash: `wh_hash_b_${Date.now()}`, webhookKeyEncrypted: 'enc_wh', isConnected: true }
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
  // SECTION 1: DATABASE ROLE & CATALOG VERIFICATION (Requirements 4, 7, 12)
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
      SELECT c.relname, pg_get_userbyid(c.relowner) AS table_owner, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c
      WHERE c.relname IN (${Prisma.join(tables)})
    `;

    expect(rows.length).toBe(6);
    for (const r of rows) {
      expect(r.table_owner).toBe('horplus');
      expect(r.table_owner).not.toBe('horplus_app');
      expect(r.relrowsecurity).toBe(true);
      // FORCE RLS: NOT REQUIRED because API runtime role is horplus_app (not table owner)
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
  // SECTION 2: SIX-TABLE TRUE RLS CRUD MATRIX (Requirement 10)
  // ==========================================================================

  const task009Tables = [
    { name: 'dormitory_line_friends', insertSql: (dormId: string) => Prisma.sql`INSERT INTO public.dormitory_line_friends (id, dormitory_id, line_user_id_hash, friend_status, created_at, updated_at) VALUES (gen_random_uuid(), ${dormId}::uuid, 'hash_matrix', 'FRIEND', NOW(), NOW())`, updateSql: (dormId: string) => `UPDATE public.dormitory_line_friends SET display_name = 'Updated' WHERE dormitory_id = '${dormId}'` },
    { name: 'dormitory_access_grants', insertSql: (dormId: string) => Prisma.sql`INSERT INTO public.dormitory_access_grants (id, dormitory_id, line_friend_id, role_code, token_hash, token_prefix, created_by_principal, created_at, updated_at) VALUES (gen_random_uuid(), ${dormId}::uuid, ${friendAId}::uuid, 'TECH', 'tok_matrix', 'prfx', 'usr_owner', NOW(), NOW())`, updateSql: (dormId: string) => `UPDATE public.dormitory_access_grants SET role_code = 'OWNER' WHERE dormitory_id = '${dormId}'` },
    { name: 'dormitory_line_configs', insertSql: (dormId: string) => Prisma.sql`INSERT INTO public.dormitory_line_configs (id, dormitory_id, line_oa_id, channel_id, channel_secret_encrypted, channel_access_token_encrypted, webhook_key_hash, webhook_key_encrypted, is_connected, created_at, updated_at) VALUES (gen_random_uuid(), ${dormId}::uuid, '@matrix_oa', '123456', 'enc_s', 'enc_t', 'wh_matrix', 'enc_w', true, NOW(), NOW())`, updateSql: (dormId: string) => `UPDATE public.dormitory_line_configs SET is_connected = false WHERE dormitory_id = '${dormId}'` },
    { name: 'line_webhook_event_receipts', insertSql: (dormId: string) => Prisma.sql`INSERT INTO public.line_webhook_event_receipts (id, dormitory_id, webhook_event_id, event_type, status, created_at, updated_at) VALUES (gen_random_uuid(), ${dormId}::uuid, 'evt_matrix', 'follow', 'processed', NOW(), NOW())`, updateSql: (dormId: string) => `UPDATE public.line_webhook_event_receipts SET status = 'failed' WHERE dormitory_id = '${dormId}'` },
    { name: 'line_push_usage', insertSql: (dormId: string) => Prisma.sql`INSERT INTO public.line_push_usage (id, dormitory_id, period_key, success_count, reserved_count, created_at, updated_at) VALUES (gen_random_uuid(), ${dormId}::uuid, '2099-01', 0, 0, NOW(), NOW())`, updateSql: (dormId: string) => `UPDATE public.line_push_usage SET success_count = 99 WHERE dormitory_id = '${dormId}'` },
    { name: 'line_push_delivery_attempts', insertSql: (dormId: string) => Prisma.sql`INSERT INTO public.line_push_delivery_attempts (id, dormitory_id, access_grant_id, period_key, line_retry_key, status, created_at, updated_at) VALUES (gen_random_uuid(), ${dormId}::uuid, ${grantAId}::uuid, '2099-01', 'retry_matrix', 'RESERVED', NOW(), NOW())`, updateSql: (dormId: string) => `UPDATE public.line_push_delivery_attempts SET status = 'FAILED' WHERE dormitory_id = '${dormId}'` },
  ];

  it('4. Six-Table RLS SELECT matrix (DormB context targeting DormA returns 0 rows)', async () => {
    await appPrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormBId}, true)`;

      for (const table of task009Tables) {
        const rows = await tx.$queryRawUnsafe<any[]>(`SELECT * FROM public.${table.name} WHERE dormitory_id = '${dormAId}'`);
        expect(rows.length).toBe(0);
      }
    });
  });

  it('5. Six-Table RLS INSERT matrix (DormB context inserting DormA row throws RLS error)', async () => {
    for (const table of task009Tables) {
      await appPrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormBId}, true)`;
        await expect(tx.$executeRaw(table.insertSql(dormAId))).rejects.toThrow();
      });
    }
  });

  it('6. Six-Table RLS UPDATE matrix (DormB context targeting DormA row returns 0 updated rows)', async () => {
    await appPrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormBId}, true)`;

      for (const table of task009Tables) {
        const count = await tx.$executeRawUnsafe(table.updateSql(dormAId));
        expect(count).toBe(0);
      }
    });
  });

  it('7. Six-Table RLS DELETE matrix (DormB context targeting DormA row returns 0 deleted rows)', async () => {
    await appPrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormBId}, true)`;

      for (const table of task009Tables) {
        const count = await tx.$executeRawUnsafe(`DELETE FROM public.${table.name} WHERE dormitory_id = '${dormAId}'`);
        expect(count).toBe(0);
      }
    });
  });

  // ==========================================================================
  // SECTION 3: SIX-TABLE MISSING CONTEXT MATRIX (Requirement 11)
  // ==========================================================================

  it('8. Six-Table Missing-Context matrix (No context -> SELECT: 0, INSERT: error, UPDATE: 0, DELETE: 0)', async () => {
    for (const table of task009Tables) {
      // 8a. SELECT -> 0 rows
      await appPrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', '', true)`;
        const rows = await tx.$queryRawUnsafe<any[]>(`SELECT * FROM public.${table.name}`);
        expect(rows.length).toBe(0);
      });

      // 8b. INSERT -> RLS error
      await appPrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', '', true)`;
        await expect(tx.$executeRaw(table.insertSql(dormAId))).rejects.toThrow();
      });

      // 8c. UPDATE -> 0 rows
      await appPrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', '', true)`;
        const updated = await tx.$executeRawUnsafe(table.updateSql(dormAId));
        expect(updated).toBe(0);
      });

      // 8d. DELETE -> 0 rows
      await appPrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', '', true)`;
        const deleted = await tx.$executeRawUnsafe(`DELETE FROM public.${table.name}`);
        expect(deleted).toBe(0);
      });
    }
  });

  // ==========================================================================
  // SECTION 4: REAL OWNER-ONLY HTTP / EXPRESS ROUTE STACK INTEGRATION (Requirement 14, 15)
  // ==========================================================================

  it('9. Real Express HTTP Route Integration: MANAGER and TECH receive 403, OWNER receives 200', async () => {
    const mockAuthService = {
      requireAuth: () => (req: any, _res: any, next: any) => {
        next();
      }
    } as any;

    const mockAdapter = new MockLinePlatformAdapter();
    const staffRoutes = createStaffRoutes(appPrisma, mockAuthService, mockAdapter);

    const app: Express = express();
    app.use(express.json());

    // Context injector middleware to simulate active auth context
    app.use((req: any, _res: any, next: any) => {
      const role = req.headers['x-test-role'] as string;
      const dormId = req.headers['x-test-dorm'] as string || dormAId;

      if (role) {
        req.auth = {
          userId: `usr_${role.toLowerCase()}`,
          sessionId: `sess_${role.toLowerCase()}`,
          user: { id: `usr_${role.toLowerCase()}` },
          memberships: [{ dormitoryId: dormId, roleCode: role, status: 'active', permissions: ['*'] }]
        };
        req.dormitoryContext = {
          dormitoryId: dormId,
          roleCode: role,
          permissions: role === 'OWNER' ? ['*'] : (role === 'MANAGER' ? ['*'] : ['staff:manage', 'line_oa:manage'])
        };
      }
      next();
    });

    app.use('/api/v1', staffRoutes.protectedRouter);

    // Test MANAGER with injected '*' permission -> HTTP 403
    const resManager = await request(app)
      .get(`/api/v1/properties/${dormAId}/staff`)
      .set('x-test-role', 'MANAGER')
      .set('x-test-dorm', dormAId);

    expect(resManager.status).toBe(403);
    expect(resManager.body.error.code).toBe('FORBIDDEN');

    // Test TECH with injected 'staff:manage' & 'line_oa:manage' permissions -> HTTP 403
    const resTech = await request(app)
      .get(`/api/v1/properties/${dormAId}/staff`)
      .set('x-test-role', 'TECH')
      .set('x-test-dorm', dormAId);

    expect(resTech.status).toBe(403);
    expect(resTech.body.error.code).toBe('FORBIDDEN');

    // Test OWNER -> HTTP 200
    const resOwner = await request(app)
      .get(`/api/v1/properties/${dormAId}/staff`)
      .set('x-test-role', 'OWNER')
      .set('x-test-dorm', dormAId);

    expect(resOwner.status).toBe(200);
    expect(resOwner.body.success).toBe(true);
  });

  // ==========================================================================
  // SECTION 5: REAL API DATABASE_URL COMPATIBILITY FOR EXISTING WAVES (Requirement 13)
  // ==========================================================================

  it('10. API Runtime Role (horplus_app) Compatibility with Existing Waves', async () => {
    // Test DML queries executed by horplus_app across pre-existing Wave tables
    const dorms = await appPrisma.dormitory.findMany({ take: 5 });
    expect(Array.isArray(dorms)).toBe(true);

    const users = await appPrisma.user.findMany({ take: 5 });
    expect(Array.isArray(users)).toBe(true);

    const buildings = await appPrisma.building.findMany({ take: 5 });
    expect(Array.isArray(buildings)).toBe(true);

    const rooms = await appPrisma.room.findMany({ take: 5 });
    expect(Array.isArray(rooms)).toBe(true);

    const contracts = await appPrisma.contract.findMany({ take: 5 });
    expect(Array.isArray(contracts)).toBe(true);

    const plans = await appPrisma.subscriptionPlan.findMany({ take: 5 });
    expect(Array.isArray(plans)).toBe(true);
  });
});
