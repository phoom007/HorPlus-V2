/**
 * TASK-009 Comprehensive Delta Test Suite — Auth, Concurrency, RLS, Session & Profile Audits
 * @license Apache-2.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { AccessGrantService } from '../../services/access-grant.service.js';
import { LineOaService } from '../../services/line-oa.service.js';
import { LineFriendService } from '../../services/line-friend.service.js';
import { AuthenticationService } from '../../services/auth.service.js';
import { MockGoogleIdentityVerifier } from '../../services/google-verifier.service.js';
import { AuditService } from '../../services/audit.service.js';
import { PrismaUserRepository } from '../../db/repositories/user.repository.js';
import { PrismaSessionRepository } from '../../db/repositories/session.repository.js';
import { PrismaMembershipRepository } from '../../db/repositories/membership.repository.js';
import { PrismaRoleRepository } from '../../db/repositories/role.repository.js';
import { MockLinePlatformAdapter } from '../../services/line-platform-adapter.js';
import { hashToken } from '../../utils/crypto-encryption.js';
import { getEnv } from '../../config/env.js';

const databaseUrl = process.env.DATABASE_URL || 'postgresql://horplus:password@127.0.0.1:5455/horplus_wave1d_fasttrack_test?schema=public';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

describe('TASK-009 — Comprehensive Delta Verification Suite', () => {
  let grantService: AccessGrantService;
  let lineOaService: LineOaService;
  let friendService: LineFriendService;
  let authService: AuthenticationService;
  let mockAdapter: MockLinePlatformAdapter;

  let testDormitoryId: string;
  let testDormitoryBId: string;
  let testOwnerUserId: string;
  let testManagerUserId: string;
  let testTechUserId: string;

  let rOwnerId: string;
  let rManagerId: string;
  let rTechId: string;

  beforeAll(async () => {
    mockAdapter = new MockLinePlatformAdapter();
    grantService = new AccessGrantService(prisma, mockAdapter);
    lineOaService = new LineOaService(prisma, mockAdapter);
    friendService = new LineFriendService(prisma);

    const userRepo = new PrismaUserRepository(prisma);
    const sessionRepo = new PrismaSessionRepository(prisma);
    const membershipRepo = new PrismaMembershipRepository(prisma);
    const roleRepo = new PrismaRoleRepository(prisma);
    const mockVerifier = new MockGoogleIdentityVerifier();
    const auditService = new AuditService();

    authService = new AuthenticationService(
      getEnv(),
      mockVerifier,
      userRepo,
      sessionRepo,
      membershipRepo,
      roleRepo,
      auditService
    );

    // Force Row Level Security on table owners in test DB
    await prisma.$executeRawUnsafe(`ALTER TABLE "dormitory_line_friends" FORCE ROW LEVEL SECURITY;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "dormitory_access_grants" FORCE ROW LEVEL SECURITY;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "dormitory_line_configs" FORCE ROW LEVEL SECURITY;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "line_webhook_event_receipts" FORCE ROW LEVEL SECURITY;`);

    // Create Users
    const uOwner = await prisma.user.create({
      data: { email: `owner_${Date.now()}@example.com`, emailNormalized: `owner_${Date.now()}@example.com`, name: 'Google Owner', googleSubject: `goog_owner_${Date.now()}` }
    });
    testOwnerUserId = uOwner.id;

    const uManager = await prisma.user.create({
      data: { email: `manager_${Date.now()}@example.com`, emailNormalized: `manager_${Date.now()}@example.com`, name: 'Legacy Manager', googleSubject: `goog_mgr_${Date.now()}` }
    });
    testManagerUserId = uManager.id;

    const uTech = await prisma.user.create({
      data: { email: `tech_${Date.now()}@example.com`, emailNormalized: `tech_${Date.now()}@example.com`, name: 'Legacy Tech', googleSubject: `goog_tech_${Date.now()}` }
    });
    testTechUserId = uTech.id;

    // Create Dormitories
    const dormA = await prisma.dormitory.create({ data: { name: 'Dormitory Alpha RLS', createdByUserId: testOwnerUserId } });
    testDormitoryId = dormA.id;

    const dormB = await prisma.dormitory.create({ data: { name: 'Dormitory Beta RLS', createdByUserId: testOwnerUserId } });
    testDormitoryBId = dormB.id;

    // Get or Create Roles
    const getOrCreateRole = async (code: string, name: string, permissions: string[]) => {
      let r = await prisma.role.findFirst({ where: { code } });
      if (!r) { r = await prisma.role.create({ data: { code, name, permissions } }); }
      return r;
    };

    const rOwner = await getOrCreateRole('OWNER', 'Owner', ['*']);
    const rMgr = await getOrCreateRole('MANAGER', 'Manager', ['room:*', 'billing:*']);
    const rTch = await getOrCreateRole('TECH', 'Technician', ['meter:*']);

    rOwnerId = rOwner.id;
    rManagerId = rMgr.id;
    rTechId = rTch.id;

    // Create Mixed Legacy Memberships
    // 1. Google Owner (createdByUserId & OWNER role)
    await prisma.dormitoryMember.create({
      data: { dormitoryId: testDormitoryId, userId: testOwnerUserId, roleId: rOwnerId, status: 'active', membershipOrigin: 'GOOGLE_BOOTSTRAP' }
    });

    // 2. Legacy Manager
    await prisma.dormitoryMember.create({
      data: { dormitoryId: testDormitoryId, userId: testManagerUserId, roleId: rManagerId, status: 'active', membershipOrigin: 'LEGACY_MEMBER' }
    });

    // 3. Legacy Tech
    await prisma.dormitoryMember.create({
      data: { dormitoryId: testDormitoryId, userId: testTechUserId, roleId: rTechId, status: 'active', membershipOrigin: 'LEGACY_MEMBER' }
    });
  });

  afterAll(async () => {
    if (testDormitoryId) await prisma.dormitory.delete({ where: { id: testDormitoryId } }).catch(() => {});
    if (testDormitoryBId) await prisma.dormitory.delete({ where: { id: testDormitoryBId } }).catch(() => {});
    if (testOwnerUserId) await prisma.user.delete({ where: { id: testOwnerUserId } }).catch(() => {});
    if (testManagerUserId) await prisma.user.delete({ where: { id: testManagerUserId } }).catch(() => {});
    if (testTechUserId) await prisma.user.delete({ where: { id: testTechUserId } }).catch(() => {});
    await prisma.$disconnect();
  });

  it('1 & 2. Mixed Legacy Migration Upgrade & Slot Counting', async () => {
    const staff = await grantService.listDormitoryStaff(testDormitoryId);

    // Only Permanent Google Owner is in permanentOwners
    expect(staff.permanentOwners.length).toBe(1);
    expect(staff.permanentOwners[0].displayName).toBe('Google Owner');
    expect(staff.permanentOwners[0].label).toBe('เจ้าของหลัก');
    expect(staff.permanentOwners[0].isPermanent).toBe(true);

    // Legacy Manager & Tech are in legacyMembers
    expect(staff.legacyMembers.length).toBe(2);
    for (const member of staff.legacyMembers) {
      expect(member.isPermanent).toBe(false);
      expect(member.canRevoke).toBe(true);
    }

    // Slot usage strictly counts 1 Google Owner + 0 Access Grants = 1 total slot
    expect(staff.slotUsage.googleOwnersCount).toBe(1);
    expect(staff.slotUsage.activeGrantsCount).toBe(0);
    expect(staff.slotUsage.totalUsedSlots).toBe(1);
  });

  it('3 & 4. Canonical Session Cookie Redemption & Existing Session Role Mutation', async () => {
    const friend = await friendService.upsertFriendFromWebhook(testDormitoryId, 'U_SESSION_TEST_USER', 'Session User');
    const grantRes = await grantService.createAccessGrant(testDormitoryId, friend.id, 'MANAGER', `usr_${testOwnerUserId}`);

    // Redeem to get encrypted session tokens A and B
    const redeemA = await grantService.redeemAccessGrant(grantRes.rawToken);
    const redeemB = await grantService.redeemAccessGrant(grantRes.rawToken);

    expect(redeemA.sessionToken).toBeDefined();
    expect(redeemB.sessionToken).toBeDefined();

    // Validate Session A -> Initially MANAGER
    const valA1 = await authService.validateSession(redeemA.sessionToken);
    expect(valA1).not.toBeNull();
    expect(valA1?.memberships[0].roleCode).toBe('MANAGER');

    // Change Grant Role to TECH
    await grantService.changeGrantRole(testDormitoryId, grantRes.grant.id, 'TECH', `usr_${testOwnerUserId}`);

    // Validate SAME Session A and Session B -> Dynamic resolution returns TECH!
    const valA2 = await authService.validateSession(redeemA.sessionToken);
    const valB2 = await authService.validateSession(redeemB.sessionToken);
    expect(valA2?.memberships[0].roleCode).toBe('TECH');
    expect(valB2?.memberships[0].roleCode).toBe('TECH');

    // Change Grant Role to OWNER
    await grantService.changeGrantRole(testDormitoryId, grantRes.grant.id, 'OWNER', `usr_${testOwnerUserId}`);

    const valA3 = await authService.validateSession(redeemA.sessionToken);
    expect(valA3?.memberships[0].roleCode).toBe('OWNER');

    // Revoke Grant
    await grantService.revokeAccessGrant(testDormitoryId, grantRes.grant.id, `usr_${testOwnerUserId}`);

    // Validate Session A & B -> Immediately NULL (401)
    const valA4 = await authService.validateSession(redeemA.sessionToken);
    const valB4 = await authService.validateSession(redeemB.sessionToken);
    expect(valA4).toBeNull();
    expect(valB4).toBeNull();

    // Redeem original raw token -> Immediately rejected
    await expect(grantService.redeemAccessGrant(grantRes.rawToken)).rejects.toThrow('Access grant link has been revoked or is invalid');
  });

  it('5. Actual LINE User ID Passed to Push Adapter Spy', async () => {
    mockAdapter.pushCalls = [];
    const friend = await friendService.upsertFriendFromWebhook(testDormitoryId, 'U_RAW_LINE_ID_99', 'Raw Line User');
    const grantRes = await grantService.createAccessGrant(testDormitoryId, friend.id, 'TECH', `usr_${testOwnerUserId}`);

    expect(grantRes.pushed).toBe(true);
    expect(mockAdapter.pushCalls.length).toBe(1);
    // toLineUserId passed to pushMessage MUST be actual raw LINE ID, NOT internal UUID!
    expect(mockAdapter.pushCalls[0].toLineUserId).toBe('U_RAW_LINE_ID_99');
  });

  it('6. Fetch Real LINE Profile on Webhook Events', async () => {
    const configResult = await lineOaService.updateDormitoryLineConfig(testDormitoryBId, {
      lineOaId: '@dormB_profile_oa',
      channelId: '1657777777',
      channelSecret: 'secret_profile_key_12345',
      channelAccessToken: 'token_profile_access_key_12345'
    });

    const rawKey = configResult.webhookUrl!.split('/api/v1/line/webhook/')[1];
    const samplePayload = JSON.stringify({
      events: [
        {
          type: 'follow',
          webhookEventId: `evt_profile_${Date.now()}`,
          source: { userId: 'U_PROFILE_FETCH_1234' }
        }
      ]
    });
    const bodyBuffer = Buffer.from(samplePayload, 'utf8');

    const crypto = await import('crypto');
    const signature = crypto.createHmac('sha256', 'secret_profile_key_12345').update(bodyBuffer).digest('base64');

    await lineOaService.processWebhookEvent(rawKey, bodyBuffer, signature);

    const friend = await prisma.dormitoryLineFriend.findFirst({ where: { dormitoryId: testDormitoryBId } });
    expect(friend).toBeDefined();
    // Profile adapter fetched real displayName & pictureUrl
    expect(friend?.displayName).toBe('LINE User (1234)');
    expect(friend?.pictureUrl).toContain('https://profile.line-scdn.net/mock_1234.png');
  });

  it('8. Data CRUD Isolation Across Dormitories via PostgreSQL RLS', async () => {
    // Ensure non-superuser app role exists with full schema permissions
    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'horplus_app_user') THEN
          CREATE ROLE horplus_app_user NOLOGIN NOSUPERUSER NOBYPASSRLS;
        END IF;
      END $$;
    `);
    await prisma.$executeRawUnsafe(`GRANT ALL ON SCHEMA public TO horplus_app_user;`);
    await prisma.$executeRawUnsafe(`GRANT ALL ON ALL TABLES IN SCHEMA public TO horplus_app_user;`);
    await prisma.$executeRawUnsafe(`GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO horplus_app_user;`);
    await prisma.$executeRawUnsafe(`ALTER ROLE horplus_app_user SET search_path TO public;`);

    // Run SELECT query under horplus_app_user role
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET ROLE horplus_app_user`);
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${testDormitoryBId}, true)`;

      // SELECT Dorm A records under Dorm B context -> 0 rows
      const friendsInA = await tx.$queryRaw<any[]>`SELECT * FROM public.dormitory_line_friends WHERE dormitory_id = ${testDormitoryId}::uuid`;
      expect(friendsInA.length).toBe(0);
    });

    // Run INSERT under horplus_app_user role -> Expect RLS WITH CHECK rejection
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET ROLE horplus_app_user`);
        await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${testDormitoryBId}, true)`;
        await tx.$executeRaw`
          INSERT INTO public.dormitory_line_friends (id, dormitory_id, line_user_id_hash, line_user_id_encrypted, display_name, friend_status, created_at, updated_at)
          VALUES (gen_random_uuid(), ${testDormitoryId}::uuid, 'hash_test', 'enc_test', 'Hacker', 'FOLLOWING', NOW(), NOW())
        `;
      })
    ).rejects.toThrow();
  });

  it('9 & 10. SECURITY DEFINER Webhook Resolver & Concurrent Webhook Deduplication', async () => {
    const configResult = await lineOaService.updateDormitoryLineConfig(testDormitoryId, {
      lineOaId: '@dormA_sec_oa',
      channelId: '1657666666',
      channelSecret: 'secret_sec_key_12345',
      channelAccessToken: 'token_sec_access_key_12345'
    });

    const rawKey = configResult.webhookUrl!.split('/api/v1/line/webhook/')[1];
    const eventId = `evt_concurrent_${Date.now()}`;

    const samplePayload = JSON.stringify({
      events: [
        {
          type: 'message',
          webhookEventId: eventId,
          source: { userId: 'U_CONCURRENT_USER' }
        }
      ]
    });
    const bodyBuffer = Buffer.from(samplePayload, 'utf8');

    const crypto = await import('crypto');
    const signature = crypto.createHmac('sha256', 'secret_sec_key_12345').update(bodyBuffer).digest('base64');

    // Run 2 concurrent identical webhook deliveries
    const [res1, res2] = await Promise.all([
      lineOaService.processWebhookEvent(rawKey, bodyBuffer, signature),
      lineOaService.processWebhookEvent(rawKey, bodyBuffer, signature)
    ]);

    expect(res1.success).toBe(true);
    expect(res2.success).toBe(true);
    // Exactly 1 processed, 1 deduplicated replay without 500 error!
    expect(res1.processedCount + res2.processedCount).toBe(1);
    expect(res1.deduplicatedCount + res2.deduplicatedCount).toBe(1);
  });

  it('11. Safe LINE Friend DTO API (NO Hashes/Encrypted identity blobs)', async () => {
    const friends = await friendService.getFriendsByDormitory(testDormitoryId);
    expect(friends.length).toBeGreaterThan(0);

    const f = friends[0];
    expect(f.id).toBeDefined();
    expect(f.displayName).toBeDefined();
    expect(f.friendStatus).toBeDefined();

    // Verify secret fields are NOT exposed on DTO
    expect((f as any).lineUserIdHash).toBeUndefined();
    expect((f as any).lineUserIdEncrypted).toBeUndefined();
  });
});
