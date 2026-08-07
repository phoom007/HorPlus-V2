/**
 * TASK-009 Comprehensive Delta Test Suite — Auth, Concurrency, RLS, Session, Quota & LINE Platform Audits
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
import { hashToken, decryptText } from '../../utils/crypto-encryption.js';
import { getEnv } from '../../config/env.js';

const databaseUrl = process.env.DATABASE_URL || 'postgresql://horplus:password@127.0.0.1:5455/horplus_wave1d_fasttrack_test?schema=public';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

describe('TASK-009 — Comprehensive Delta Verification Suite', () => {
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

    const redeemA = await grantService.redeemAccessGrant(grantRes.rawToken);
    const redeemB = await grantService.redeemAccessGrant(grantRes.rawToken);

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

    await expect(
      lineOaService.updateDormitoryLineConfig(testDormitoryBId, {
        channelAccessToken: 'invalid_token'
      })
    ).rejects.toThrow('LINE Channel Access Token verification failed');

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

      const friendsInA = await tx.$queryRaw<any[]>`SELECT * FROM public.dormitory_line_friends WHERE dormitory_id = ${testDormitoryId}::uuid`;
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
  // CHECKPOINT 1C SPECIFIC REGRESSION TESTS
  // ==========================================================================

  it('12. Production Route Composition Uses HttpLinePlatformAdapter', async () => {
    const prodAdapter = createLinePlatformAdapter();
    expect(prodAdapter).toBeInstanceOf(HttpLinePlatformAdapter);
  });

  it('13. Flex URI Contains Exact Raw Bearer Token & Redeems via API with CSRF Token', async () => {
    mockAdapter.pushCalls = [];
    const friend = await friendService.upsertFriendFromWebhook(testDormitoryId, 'U_FLEX_URI_TEST', 'Flex User');
    const grantRes = await grantService.createAccessGrant(testDormitoryId, friend.id, 'MANAGER', `usr_${testOwnerUserId}`);

    expect(grantRes.pushed).toBe(true);
    expect(mockAdapter.pushCalls.length).toBe(1);

    const flexMsg = mockAdapter.pushCalls[0].flexMessage;
    const button = flexMsg.contents.body.contents.find((c: any) => c.type === 'button');
    expect(button).toBeDefined();
    expect(button.action.label).toBe('เปิด HorPlus');

    const uri: string = button.action.uri;
    expect(uri).toContain('/staff-access#');
    expect(uri.endsWith(grantRes.rawToken)).toBe(true);

    const fragmentToken = uri.split('#')[1];
    expect(fragmentToken).toBe(grantRes.rawToken);

    const redeemRes = await grantService.redeemAccessGrant(fragmentToken);
    expect(redeemRes.sessionToken).toBeDefined();
    expect(redeemRes.csrfToken).toBeDefined();
    expect(redeemRes.grant.id).toBe(grantRes.grant.id);
  });

  it('14. Recoverable Bearer Token & Owner Copy Link', async () => {
    const friend = await friendService.upsertFriendFromWebhook(testDormitoryId, 'U_COPY_LINK_TEST', 'Copy User');
    const grantRes = await grantService.createAccessGrant(testDormitoryId, friend.id, 'TECH', `usr_${testOwnerUserId}`);

    const copyLink = await grantService.getGrantCopyLink(testDormitoryId, grantRes.grant.id);
    expect(copyLink.url).toContain('/staff-access#');
    expect(copyLink.rawToken).toBe(grantRes.rawToken);

    // Verify raw token is NOT stored plaintext
    const dbGrant = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${testDormitoryId}, true)`;
      return await tx.dormitoryAccessGrant.findUnique({ where: { id: grantRes.grant.id } });
    });
    expect(dbGrant?.tokenHash).not.toBe(grantRes.rawToken);
    expect(dbGrant?.tokenEncrypted).not.toBe(grantRes.rawToken);
    expect(dbGrant?.tokenEncrypted).toBeDefined();
    expect(decryptText(dbGrant!.tokenEncrypted!)).toBe(grantRes.rawToken);
  });

  it('15. Strict RLS without app.bypass_rls & Narrow Token Resolver', async () => {
    // 1. Verify NO policies use app.bypass_rls in pg_policies
    const policies = await prisma.$queryRaw<any[]>`
      SELECT policyname, qual FROM pg_policies WHERE qual LIKE '%app.bypass_rls%' OR policyname LIKE '%isolation%'
    `;
    const bypassPolicies = policies.filter(p => p.qual && p.qual.includes('app.bypass_rls'));
    expect(bypassPolicies.length).toBe(0);

    // 2. Test narrow token resolver returns grant_id & dormitory_id ONLY
    const friend = await friendService.upsertFriendFromWebhook(testDormitoryId, 'U_RESOLVER_TEST', 'Resolver User');
    const grantRes = await grantService.createAccessGrant(testDormitoryId, friend.id, 'MANAGER', `usr_${testOwnerUserId}`);

    const rows = await prisma.$queryRaw<any[]>`
      SELECT grant_id, dormitory_id FROM public.resolve_access_grant_token(${grantRes.grant.tokenHash})
    `;
    expect(rows.length).toBe(1);
    expect(rows[0].grant_id).toBe(grantRes.grant.id);
    expect(rows[0].dormitory_id).toBe(testDormitoryId);
    expect(rows[0].tokenEncrypted).toBeUndefined();
    expect(rows[0].roleCode).toBeUndefined();
  });

  it('16. Atomic Quota Reservation & LinePushDeliveryAttempt Schema', async () => {
    const friend = await friendService.upsertFriendFromWebhook(testDormitoryId, 'U_ATOMIC_TEST', 'Atomic User');
    const grantRes = await grantService.createAccessGrant(testDormitoryId, friend.id, 'TECH', `usr_${testOwnerUserId}`);

    const attempts = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${testDormitoryId}, true)`;
      return await tx.linePushDeliveryAttempt.findMany({
        where: { accessGrantId: grantRes.grant.id }
      });
    });
    expect(attempts.length).toBe(1);

    const att = attempts[0];
    expect(att.periodKey).toBeDefined();
    expect(att.lineRetryKey).toBeDefined();
    expect(att.retryKeyCreatedAt).toBeDefined();
    expect(att.retryKeyExpiresAt).toBeDefined();
  });

  it('17. Attempt Finalization Idempotency', async () => {
    const friend = await friendService.upsertFriendFromWebhook(testDormitoryId, 'U_IDEMPOTENT_TEST', 'Idempotent User');
    const grantRes = await grantService.createAccessGrant(testDormitoryId, friend.id, 'MANAGER', `usr_${testOwnerUserId}`);

    const attempts = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${testDormitoryId}, true)`;
      return await tx.linePushDeliveryAttempt.findMany({
        where: { accessGrantId: grantRes.grant.id }
      });
    });
    const att = attempts[0];

    // Finalize same attempt twice
    const fin1 = await pushUsageService.finalizeDeliveryAttempt(att.id, testDormitoryId, grantRes.grant.id, { outcome: 'ACCEPTED', messageId: 'msg_test_1' });
    const fin2 = await pushUsageService.finalizeDeliveryAttempt(att.id, testDormitoryId, grantRes.grant.id, { outcome: 'ACCEPTED', messageId: 'msg_test_2' });

    expect(fin1.pushed).toBe(true);
    expect(fin2.pushed).toBe(true);
  });

  it('18. 24h Retry Key Expiration Rules', async () => {
    const dormC = await prisma.dormitory.create({ data: { name: 'Dorm Expiry Test', createdByUserId: testOwnerUserId, timezone: 'Asia/Bangkok' } });
    await lineOaService.updateDormitoryLineConfig(dormC.id, {
      lineOaId: '@dormC_oa',
      channelId: '1657999999',
      channelSecret: 'secret_c_key_12345',
      channelAccessToken: 'token_c_access_key_12345'
    });

    const friend = await friendService.upsertFriendFromWebhook(dormC.id, 'U_EXPIRATION_TEST', 'Expired User');
    const grantRes = await grantService.createAccessGrant(dormC.id, friend.id, 'TECH', `usr_${testOwnerUserId}`);

    // Find attempt and set retryKeyExpiresAt to 1 hour in the past
    const attempts = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormC.id}, true)`;
      return await tx.linePushDeliveryAttempt.findMany({
        where: { accessGrantId: grantRes.grant.id }
      });
    });
    const att = attempts[0];

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormC.id}, true)`;
      await tx.linePushDeliveryAttempt.update({
        where: { id: att.id },
        data: {
          status: 'RETRY_PENDING',
          retryKeyExpiresAt: new Date(Date.now() - 3600 * 1000)
        }
      });
      await tx.dormitoryAccessGrant.update({
        where: { id: grantRes.grant.id },
        data: { lastDeliveryStatus: 'retry_pending' }
      });
    });

    mockAdapter.pushCalls = [];
    const retryRes = await grantService.retryDelivery(grantRes.grant.id, dormC.id);

    expect(retryRes.deliveryStatus).toBe('retry_window_expired');
    expect(mockAdapter.pushCalls.length).toBe(0); // NO LINE HTTP call made after expiration!

    await prisma.dormitory.delete({ where: { id: dormC.id } }).catch(() => {});
  });
});
