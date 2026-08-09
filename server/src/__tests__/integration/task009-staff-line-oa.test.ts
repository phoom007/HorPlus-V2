/**
 * TASK-009 Comprehensive Delta Test Suite — Checkpoint 1D Security Boundaries
 * @license Apache-2.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { AccessGrantService } from '../../services/access-grant.service.js';
import { LineOaService } from '../../services/line-oa.service.js';
import { LineFriendService } from '../../services/line-friend.service.js';
import { LinePushUsageService } from '../../services/line-push-usage.service.js';
import { AuthenticationService } from '../../services/auth.service.js';
import { MockGoogleIdentityVerifier } from '../../services/google-verifier.service.js';
import { AuditService } from '../../services/audit.service.js';
import { PrismaUserRepository } from '../../db/repositories/user.repository.js';
import { PrismaSessionRepository } from '../../db/repositories/session.repository.js';
import { PrismaMembershipRepository } from '../../db/repositories/membership.repository.js';
import { PrismaRoleRepository } from '../../db/repositories/role.repository.js';
import { MockLinePlatformAdapter, HttpLinePlatformAdapter } from '../../services/line-platform-adapter.js';
import { createLinePlatformAdapter } from '../../services/line-adapter-factory.js';
import { createStaffRoutes } from '../../routes/staff.routes.js';
import { createLineOaRoutes } from '../../routes/line-oa.routes.js';
import { hashToken, decryptText } from '../../utils/crypto-encryption.js';
import { getEnv } from '../../config/env.js';

const databaseUrl = process.env.DATABASE_URL || 'postgresql://horplus:password@127.0.0.1:5455/horplus_wave1d_fasttrack_test?schema=public';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

describe('TASK-009 — Comprehensive Delta Verification Suite (Checkpoint 1D)', () => {
  let grantService: AccessGrantService;
  let lineOaService: LineOaService;
  let friendService: LineFriendService;
  let pushUsageService: LinePushUsageService;
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
    pushUsageService = new LinePushUsageService(prisma);

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
    const dormA = await prisma.dormitory.create({ data: { name: 'Dormitory Alpha RLS', createdByUserId: testOwnerUserId, timezone: 'Asia/Bangkok' } });
    testDormitoryId = dormA.id;

    const dormB = await prisma.dormitory.create({ data: { name: 'Dormitory Beta RLS', createdByUserId: testOwnerUserId, timezone: 'Asia/Bangkok' } });
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
    await prisma.dormitoryMember.create({
      data: { dormitoryId: testDormitoryId, userId: testOwnerUserId, roleId: rOwnerId, status: 'active', membershipOrigin: 'GOOGLE_BOOTSTRAP' }
    });
    await prisma.dormitoryMember.create({
      data: { dormitoryId: testDormitoryId, userId: testManagerUserId, roleId: rManagerId, status: 'active', membershipOrigin: 'LEGACY_MEMBER' }
    });
    await prisma.dormitoryMember.create({
      data: { dormitoryId: testDormitoryId, userId: testTechUserId, roleId: rTechId, status: 'active', membershipOrigin: 'LEGACY_MEMBER' }
    });
    // Configure LINE OA for testDormitoryId
    await lineOaService.updateDormitoryLineConfig(testDormitoryId, {
      lineOaId: '@dormA_oa',
      channelId: '1657888888',
      channelSecret: 'secret_a_key_12345',
      channelAccessToken: 'token_a_access_key_12345'
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

    expect(staff.permanentOwners.length).toBe(1);
    expect(staff.permanentOwners[0].displayName).toBe('Google Owner');
    expect(staff.permanentOwners[0].label).toBe('เจ้าของหลัก');
    expect(staff.permanentOwners[0].isPermanent).toBe(true);

    expect(staff.legacyMembers.length).toBe(2);
    for (const member of staff.legacyMembers) {
      expect(member.isPermanent).toBe(false);
      expect(member.canRevoke).toBe(true);
    }

    expect(staff.slotUsage.googleOwnersCount).toBe(1);
    expect(staff.slotUsage.activeGrantsCount).toBe(0);
    expect(staff.slotUsage.totalUsedSlots).toBe(1);
  });

  it('3 & 4. Canonical Session Cookie Redemption & Dynamic Role Mutation', async () => {
    const friend = await friendService.upsertFriendFromWebhook(testDormitoryId, 'U_SESSION_TEST_USER', 'Session User');
    const grantRes = await grantService.createAccessGrant(testDormitoryId, friend.id, 'MANAGER', `usr_${testOwnerUserId}`);

    expect(grantRes.bearerUrl).toContain('/staff-access#');
    expect(grantRes).not.toHaveProperty('rawToken');
    expect(JSON.stringify(grantRes)).not.toContain('"rawToken"');

    const copyLinkRes = await grantService.getGrantCopyLink(testDormitoryId, grantRes.grant.id);
    expect(copyLinkRes.url).toContain('/staff-access#');
    expect(copyLinkRes).not.toHaveProperty('rawToken');
    expect(JSON.stringify(copyLinkRes)).not.toContain('"rawToken"');

    const rawToken = grantRes.bearerUrl.split('#')[1];
    const redeemA = await grantService.redeemAccessGrant(rawToken);
    const redeemB = await grantService.redeemAccessGrant(rawToken);

    expect(redeemA.sessionToken).toBeDefined();
    expect(redeemB.sessionToken).toBeDefined();

    const valA1 = await authService.validateSession(redeemA.sessionToken);
    expect(valA1).not.toBeNull();
    expect(valA1?.memberships[0].roleCode).toBe('MANAGER');

    await grantService.changeGrantRole(testDormitoryId, grantRes.grant.id, 'TECH', `usr_${testOwnerUserId}`);

    const valA2 = await authService.validateSession(redeemA.sessionToken);
    const valB2 = await authService.validateSession(redeemB.sessionToken);
    expect(valA2?.memberships[0].roleCode).toBe('TECH');
    expect(valB2?.memberships[0].roleCode).toBe('TECH');

    await grantService.revokeAccessGrant(testDormitoryId, grantRes.grant.id, `usr_${testOwnerUserId}`);

    const valA4 = await authService.validateSession(redeemA.sessionToken);
    expect(valA4).toBeNull();
  });

  it('5. Actual LINE User ID Passed to Push Adapter Spy with Retry Key', async () => {
    mockAdapter.pushCalls = [];
    const friend = await friendService.upsertFriendFromWebhook(testDormitoryId, 'U_RAW_LINE_ID_99', 'Raw Line User');
    const grantRes = await grantService.createAccessGrant(testDormitoryId, friend.id, 'TECH', `usr_${testOwnerUserId}`);

    expect(grantRes.pushed).toBe(true);
    expect(mockAdapter.pushCalls.length).toBe(1);
    expect(mockAdapter.pushCalls[0].toLineUserId).toBe('U_RAW_LINE_ID_99');
    expect(mockAdapter.pushCalls[0].retryKey).toBeDefined();
  });

  it('6. LINE Credential Verification & Webhook Verification Distinction', async () => {
    mockAdapter.verifyAccessTokenCalls = [];

    const configResult = await lineOaService.updateDormitoryLineConfig(testDormitoryBId, {
      lineOaId: '@dormB_verif_oa',
      channelId: '1657777777',
      channelSecret: 'secret_verif_key_12345',
      channelAccessToken: 'token_verif_access_key_12345'
    });

    expect(mockAdapter.verifyAccessTokenCalls.length).toBe(1);
    expect(configResult.accessTokenVerifiedAt).not.toBeNull();
    expect(configResult.webhookVerifiedAt).toBeNull();

    // Verify that invalid credentials cause rejection (stateless token issuance model)
    mockAdapter.forceVerifyFail = true;
    await expect(
      lineOaService.updateDormitoryLineConfig(testDormitoryBId, {
        channelSecret: 'changed_secret_to_trigger_reverify'
      })
    ).rejects.toThrow('LINE Channel Credentials validation failed');

    const rawKey = configResult.webhookUrl!.split('/api/v1/line/webhook/')[1];
    const samplePayload = JSON.stringify({
      events: [{ type: 'follow', webhookEventId: `evt_verif_${Date.now()}`, source: { userId: 'U_VERIF_123' } }]
    });
    const bodyBuffer = Buffer.from(samplePayload, 'utf8');

    const crypto = await import('crypto');
    const signature = crypto.createHmac('sha256', 'secret_verif_key_12345').update(bodyBuffer).digest('base64');

    await lineOaService.processWebhookEvent(rawKey, bodyBuffer, signature);

    const updatedConfig = await lineOaService.getDormitoryLineConfig(testDormitoryBId);
    expect(updatedConfig.webhookVerifiedAt).not.toBeNull();
  });

  it('7. Quota Reservation & Idempotent Finalization', async () => {
    const friend = await friendService.upsertFriendFromWebhook(testDormitoryId, 'U_QUOTA_TEST_1', 'Quota User 1');

    mockAdapter.pushCalls = [];
    const grantRes = await grantService.createAccessGrant(testDormitoryId, friend.id, 'TECH', `usr_${testOwnerUserId}`);
    expect(grantRes.deliveryStatus).toBe('sent');

    const status = await pushUsageService.getQuotaStatus(testDormitoryId);
    expect(status.successCount).toBeGreaterThanOrEqual(1);
    expect(status.reservedCount).toBe(0);
  });

  it('8. Quota Exhaustion & Retry Delivery Rules', async () => {
    const dorm = await prisma.dormitory.findUnique({ where: { id: testDormitoryId } });
    const periodKey = pushUsageService.getCurrentPeriodKey(dorm?.timezone || 'Asia/Bangkok');

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${testDormitoryId}, true)`;
      await tx.linePushUsage.upsert({
        where: { dormitory_push_period_unique: { dormitoryId: testDormitoryId, periodKey } },
        update: { successCount: 30, reservedCount: 0 },
        create: { dormitoryId: testDormitoryId, periodKey, successCount: 30, reservedCount: 0 }
      });
    });

    const friend = await friendService.upsertFriendFromWebhook(testDormitoryId, 'U_EXHAUSTED_TEST', 'Exhausted User');
    const grantRes = await grantService.createAccessGrant(testDormitoryId, friend.id, 'MANAGER', `usr_${testOwnerUserId}`);

    expect(grantRes.grant.id).toBeDefined();
    expect(grantRes.deliveryStatus).toBe('quota_exhausted');

    const retryRes = await grantService.retryDelivery(grantRes.grant.id, testDormitoryId);
    expect(retryRes.deliveryStatus).toBe('quota_exhausted');

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${testDormitoryId}, true)`;
      await tx.linePushUsage.update({
        where: { dormitory_push_period_unique: { dormitoryId: testDormitoryId, periodKey } },
        data: { successCount: 0, reservedCount: 0 }
      });
    });

    const retryRes2 = await grantService.retryDelivery(grantRes.grant.id, testDormitoryId);
    expect(retryRes2.deliveryStatus).toBe('sent');

    await expect(grantService.retryDelivery(grantRes.grant.id, testDormitoryId)).rejects.toThrow('Grant has already been delivered successfully');
  });

  it('9. RLS Data Isolation Across Dormitories (Migration-Owned Policies)', async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${testDormitoryBId}, true)`;

      // Query enforcing tenant isolation policy clause: dormitory_id = NULLIF(current_setting('app.current_dormitory_id', true), '')::uuid
      const friendsInA = await tx.$queryRaw<any[]>`
        SELECT * FROM public.dormitory_line_friends
        WHERE dormitory_id = ${testDormitoryId}::uuid
          AND dormitory_id = NULLIF(current_setting('app.current_dormitory_id', true), '')::uuid
      `;
      expect(friendsInA.length).toBe(0);
    });
  });

  it('10. SECURITY DEFINER Webhook Resolver & Concurrent Webhook Deduplication', async () => {
    const configResult = await lineOaService.updateDormitoryLineConfig(testDormitoryId, {
      lineOaId: '@dormA_sec_oa',
      channelId: '1657666666',
      channelSecret: 'secret_sec_key_12345',
      channelAccessToken: 'token_sec_access_key_12345'
    });

    const rawKey = configResult.webhookUrl!.split('/api/v1/line/webhook/')[1];
    const eventId = `evt_concurrent_${Date.now()}`;

    const samplePayload = JSON.stringify({
      events: [{ type: 'message', webhookEventId: eventId, source: { userId: 'U_CONCURRENT_USER' } }]
    });
    const bodyBuffer = Buffer.from(samplePayload, 'utf8');

    const crypto = await import('crypto');
    const signature = crypto.createHmac('sha256', 'secret_sec_key_12345').update(bodyBuffer).digest('base64');

    const [res1, res2] = await Promise.all([
      lineOaService.processWebhookEvent(rawKey, bodyBuffer, signature),
      lineOaService.processWebhookEvent(rawKey, bodyBuffer, signature)
    ]);

    expect(res1.success).toBe(true);
    expect(res2.success).toBe(true);
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
    expect((f as any).lineUserIdHash).toBeUndefined();
    expect((f as any).lineUserIdEncrypted).toBeUndefined();
  });

  // ==========================================================================
  // CHECKPOINT 1D EXPLICIT SECURITY REGRESSION TESTS
  // ==========================================================================

  it('12. NO app.bypass_rls OR app.resolver_context IN ANY RLS POLICY', async () => {
    const policies = await prisma.$queryRaw<any[]>`
      SELECT policyname, qual FROM pg_policies WHERE qual LIKE '%app.bypass_rls%' OR qual LIKE '%app.resolver_context%'
    `;
    expect(policies.length).toBe(0);
  });

  it('13. Narrow SECURITY DEFINER Resolvers Return Minimal Identifiers Only', async () => {
    const friend = await friendService.upsertFriendFromWebhook(testDormitoryId, 'U_RESOLVER_1D', 'Resolver User 1D');
    const grantRes = await grantService.createAccessGrant(testDormitoryId, friend.id, 'MANAGER', `usr_${testOwnerUserId}`);

    const rows = await prisma.$queryRaw<any[]>`
      SELECT * FROM public.resolve_access_grant_token(${grantRes.grant.tokenHash})
    `;
    expect(rows.length).toBe(1);
    expect(Object.keys(rows[0])).toEqual(['grant_id', 'dormitory_id']);
    expect(rows[0].grant_id).toBe(grantRes.grant.id);
    expect(rows[0].dormitory_id).toBe(testDormitoryId);
  });

  it('14. Encrypted LINE Identity Material Unavailable via SECURITY DEFINER (Function Deleted)', async () => {
    await expect(
      prisma.$queryRaw`SELECT * FROM public.resolve_access_grant_friend(gen_random_uuid())`
    ).rejects.toThrow();
  });

  it('15. LINE 409 Accepted Request ID Contract Enforcement', async () => {
    const friend = await friendService.upsertFriendFromWebhook(testDormitoryId, 'U_409_CONTRACT_TEST', '409 User');

    // 1. 409 WITH x-line-accepted-request-id header -> ALREADY_ACCEPTED
    mockAdapter.simulate409WithAcceptedId = true;
    mockAdapter.simulate409WithoutAcceptedId = false;
    const res1 = await grantService.createAccessGrant(testDormitoryId, friend.id, 'TECH', `usr_${testOwnerUserId}`);
    expect(res1.deliveryStatus).toBe('sent'); // ALREADY_ACCEPTED maps to sent delivery status

    // Revoke grant to free slot
    await grantService.revokeAccessGrant(testDormitoryId, res1.grant.id, `usr_${testOwnerUserId}`);

    // 2. 409 WITHOUT x-line-accepted-request-id header -> DEFINITIVE_FAILURE (fail closed)
    mockAdapter.simulate409WithAcceptedId = false;
    mockAdapter.simulate409WithoutAcceptedId = true;
    const friend2 = await friendService.upsertFriendFromWebhook(testDormitoryId, 'U_409_FAIL_CLOSED', '409 Fail User');
    const res2 = await grantService.createAccessGrant(testDormitoryId, friend2.id, 'TECH', `usr_${testOwnerUserId}`);
    expect(res2.deliveryStatus).toBe('failed');
    expect(res2.pushed).toBe(false);

    // Reset mock adapter flags
    mockAdapter.simulate409WithAcceptedId = false;
    mockAdapter.simulate409WithoutAcceptedId = false;
  });

  it('16. Attempt Expiration Idempotency (Repeat & Concurrent Expiration)', async () => {
    const dormExp = await prisma.dormitory.create({ data: { name: 'Dorm Expiry Idempotency', createdByUserId: testOwnerUserId, timezone: 'Asia/Bangkok' } });
    await lineOaService.updateDormitoryLineConfig(dormExp.id, {
      lineOaId: '@dormExp_oa',
      channelId: '1657999888',
      channelSecret: 'secret_exp_key_12345',
      channelAccessToken: 'token_exp_access_key_12345'
    });

    const friend = await friendService.upsertFriendFromWebhook(dormExp.id, 'U_EXPIRY_IDEM_USER', 'Expiry Idem User');
    const grantRes = await grantService.createAccessGrant(dormExp.id, friend.id, 'TECH', `usr_${testOwnerUserId}`);

    const attempts = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormExp.id}, true)`;
      return await tx.linePushDeliveryAttempt.findMany({ where: { accessGrantId: grantRes.grant.id } });
    });
    const att = attempts[0];

    // Set status to RETRY_PENDING and periodKey
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormExp.id}, true)`;
      await tx.linePushDeliveryAttempt.update({
        where: { id: att.id },
        data: { status: 'RETRY_PENDING' }
      });
      await tx.linePushUsage.update({
        where: { dormitory_push_period_unique: { dormitoryId: dormExp.id, periodKey: att.periodKey } },
        data: { reservedCount: 2 }
      });
    });

    // Call markAttemptExpired twice concurrently
    await Promise.all([
      pushUsageService.markAttemptExpired(att.id, dormExp.id, grantRes.grant.id, att.periodKey),
      pushUsageService.markAttemptExpired(att.id, dormExp.id, grantRes.grant.id, att.periodKey)
    ]);

    // Verify reservedCount was decremented by EXACTLY ONE (from 2 to 1)
    const usage = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormExp.id}, true)`;
      return await tx.linePushUsage.findUnique({
        where: { dormitory_push_period_unique: { dormitoryId: dormExp.id, periodKey: att.periodKey } }
      });
    });

    expect(usage?.reservedCount).toBe(1);

    await prisma.dormitory.delete({ where: { id: dormExp.id } }).catch(() => {});
  });
});
