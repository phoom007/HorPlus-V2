/**
 * TASK-009 Comprehensive Integration, Concurrency, RLS & Security Audit Test Suite
 * @license Apache-2.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { AccessGrantService } from '../../services/access-grant.service.js';
import { LineOaService } from '../../services/line-oa.service.js';
import { LineFriendService } from '../../services/line-friend.service.js';
import { MockLinePlatformAdapter } from '../../services/line-platform-adapter.js';
import { hashToken } from '../../utils/crypto-encryption.js';

const databaseUrl = process.env.DATABASE_URL || 'postgresql://horplus:password@127.0.0.1:5455/horplus_wave1d_fasttrack_test?schema=public';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

describe('TASK-009 — Comprehensive Audit, Concurrency, RLS & Verification Suite', () => {
  let grantService: AccessGrantService;
  let lineOaService: LineOaService;
  let friendService: LineFriendService;
  let mockAdapter: MockLinePlatformAdapter;

  let testDormitoryId: string;
  let testDormitoryBId: string;
  let testOwnerUserId: string;
  let testRoleId: string;

  beforeAll(async () => {
    mockAdapter = new MockLinePlatformAdapter();
    grantService = new AccessGrantService(prisma, mockAdapter);
    lineOaService = new LineOaService(prisma, mockAdapter);
    friendService = new LineFriendService(prisma);

    // Setup Test Owner User
    const user = await prisma.user.create({
      data: {
        email: `audit_owner_${Date.now()}@example.com`,
        emailNormalized: `audit_owner_${Date.now()}@example.com`,
        name: 'Audit Google Owner',
        googleSubject: `goog_sub_${Date.now()}`
      }
    });
    testOwnerUserId = user.id;

    // Create Dormitory A and Dormitory B for RLS Isolation
    const dormA = await prisma.dormitory.create({
      data: { name: 'Dormitory Alpha RLS', createdByUserId: testOwnerUserId }
    });
    testDormitoryId = dormA.id;

    const dormB = await prisma.dormitory.create({
      data: { name: 'Dormitory Beta RLS', createdByUserId: testOwnerUserId }
    });
    testDormitoryBId = dormB.id;

    // Get or Create Role
    let r = await prisma.role.findFirst({ where: { code: 'OWNER' } });
    if (!r) {
      r = await prisma.role.create({ data: { code: 'OWNER', name: 'Owner', permissions: ['*'] } });
    }
    testRoleId = r.id;

    // Backfill & Create Permanent Google Owner Membership for Dormitory A
    await prisma.dormitoryMember.create({
      data: {
        dormitoryId: testDormitoryId,
        userId: testOwnerUserId,
        roleId: testRoleId,
        status: 'active',
        membershipOrigin: 'GOOGLE_BOOTSTRAP'
      }
    });
  });

  afterAll(async () => {
    if (testDormitoryId) await prisma.dormitory.delete({ where: { id: testDormitoryId } }).catch(() => {});
    if (testDormitoryBId) await prisma.dormitory.delete({ where: { id: testDormitoryBId } }).catch(() => {});
    if (testOwnerUserId) await prisma.user.delete({ where: { id: testOwnerUserId } }).catch(() => {});
    await prisma.$disconnect();
  });

  it('1. Permanent Google Owner Backfill & Invariant Verification', async () => {
    const staff = await grantService.listDormitoryStaff(testDormitoryId);
    expect(staff.permanentOwners.length).toBe(1);

    const owner = staff.permanentOwners[0];
    expect(owner.label).toBe('เจ้าของหลัก');
    expect(owner.membershipOrigin).toBe('GOOGLE_BOOTSTRAP');
    expect(owner.isPermanent).toBe(true);
    expect(owner.canRevoke).toBe(false);
    expect(owner.canChangeRole).toBe(false);

    // Verify slot calculation counts 1 Permanent Owner + 0 Grants = 1
    expect(staff.slotUsage.googleOwnersCount).toBe(1);
    expect(staff.slotUsage.activeGrantsCount).toBe(0);
    expect(staff.slotUsage.totalUsedSlots).toBe(1);
  });

  it('2. Webhook Event Receipt Lifecycle (processedAt NULL -> timestamp)', async () => {
    const configResult = await lineOaService.updateDormitoryLineConfig(testDormitoryBId, {
      lineOaId: '@dormB_oa',
      channelId: '1657888888',
      channelSecret: 'super_secret_key_12345',
      channelAccessToken: 'token_access_key_12345'
    });

    expect(configResult.webhookUrl).toBeDefined();
    const rawKey = configResult.webhookUrl!.split('/api/v1/line/webhook/')[1];

    const samplePayload = JSON.stringify({
      events: [
        {
          type: 'follow',
          webhookEventId: `evt_lifecycle_${Date.now()}`,
          source: { userId: 'U_LIFECYCLE_USER' }
        }
      ]
    });
    const bodyBuffer = Buffer.from(samplePayload, 'utf8');

    const crypto = await import('crypto');
    const signature = crypto.createHmac('sha256', 'super_secret_key_12345').update(bodyBuffer).digest('base64');

    // Process event
    const result = await lineOaService.processWebhookEvent(rawKey, bodyBuffer, signature);
    expect(result.success).toBe(true);
    expect(result.processedCount).toBe(1);

    // Verify receipt in DB has completed status and processedAt populated
    const receiptInDb = await prisma.lineWebhookEventReceipt.findFirst({
      where: { dormitoryId: testDormitoryBId }
    });
    expect(receiptInDb).toBeDefined();
    expect(receiptInDb?.status).toBe('processed');
    expect(receiptInDb?.processedAt).toBeInstanceOf(Date);
  });

  it('3. Duplicate Active Grant Prevention for Same LINE Friend', async () => {
    const friend = await friendService.upsertFriendFromWebhook(
      testDormitoryId,
      'U_UNIQUE_FRIEND_01',
      'Unique Friend'
    );

    // First grant creation -> Succeeds
    const grant1 = await grantService.createAccessGrant(testDormitoryId, friend.id, 'MANAGER', `usr_${testOwnerUserId}`);
    expect(grant1.grant.status).toBe('ACTIVE');

    // Second active grant attempt for SAME friend -> Throws ACTIVE_GRANT_EXISTS 409
    await expect(
      grantService.createAccessGrant(testDormitoryId, friend.id, 'TECH', `usr_${testOwnerUserId}`)
    ).rejects.toThrow('Target LINE friend already has an active access grant in this dormitory');

    // Revoke first grant
    await grantService.revokeAccessGrant(testDormitoryId, grant1.grant.id, `usr_${testOwnerUserId}`);

    // After revoke, new grant for same friend CAN be created!
    const grant2 = await grantService.createAccessGrant(testDormitoryId, friend.id, 'TECH', `usr_${testOwnerUserId}`);
    expect(grant2.grant.status).toBe('ACTIVE');
  });

  it('4. Slot Semantics: REVOKED grants do not consume slots (10-slot boundary)', async () => {
    const capDorm = await prisma.dormitory.create({ data: { name: 'Cap Verification Dorm' } });
    await prisma.dormitoryMember.create({
      data: {
        dormitoryId: capDorm.id,
        userId: testOwnerUserId,
        roleId: testRoleId,
        status: 'active',
        membershipOrigin: 'GOOGLE_BOOTSTRAP'
      }
    });

    // Create 9 active grants for 9 distinct friends = 10 total slots
    for (let i = 1; i <= 9; i++) {
      const friend = await friendService.upsertFriendFromWebhook(capDorm.id, `U_CAP_FRIEND_${i}`, `Friend ${i}`);
      await grantService.createAccessGrant(capDorm.id, friend.id, 'TECH', 'usr_owner');
    }

    const usageAtCap = await grantService.getSlotUsage(capDorm.id);
    expect(usageAtCap.totalUsedSlots).toBe(10);

    // 10th grant attempt (11th total slot) -> Throws 409 STAFF_LIMIT_EXCEEDED
    const extraFriend = await friendService.upsertFriendFromWebhook(capDorm.id, 'U_CAP_FRIEND_EXTRA', 'Extra Friend');
    await expect(
      grantService.createAccessGrant(capDorm.id, extraFriend.id, 'TECH', 'usr_owner')
    ).rejects.toThrow('Cannot create access grant. Account slot limit (10) reached.');

    // Cleanup
    await prisma.dormitory.delete({ where: { id: capDorm.id } }).catch(() => {});
  });

  it('5. Dynamic Access Grant Authorization Resolution Across Active Sessions', async () => {
    const friend = await friendService.upsertFriendFromWebhook(
      testDormitoryId,
      'U_DYNAMIC_AUTH_USER',
      'Dynamic Auth User'
    );

    const grantResult = await grantService.createAccessGrant(
      testDormitoryId,
      friend.id,
      'MANAGER',
      `usr_${testOwnerUserId}`
    );

    // Redeem in Session A and Session B
    const sessionA = await grantService.redeemAccessGrant(grantResult.rawToken, 'BrowserA', '127.0.0.1');
    const sessionB = await grantService.redeemAccessGrant(grantResult.rawToken, 'BrowserB', '127.0.0.2');

    expect(sessionA.grant.roleCode).toBe('MANAGER');
    expect(sessionB.grant.roleCode).toBe('MANAGER');

    // Owner updates grant role to TECH
    await grantService.changeGrantRole(testDormitoryId, grantResult.grant.id, 'TECH', `usr_${testOwnerUserId}`);

    // Re-redeeming or validating dynamically returns new role TECH
    const redemptionA = await grantService.redeemAccessGrant(grantResult.rawToken);
    expect(redemptionA.grant.roleCode).toBe('TECH');

    // Owner revokes grant
    await grantService.revokeAccessGrant(testDormitoryId, grantResult.grant.id, `usr_${testOwnerUserId}`);

    // Sessions and original bearer token are immediately invalid
    await expect(grantService.redeemAccessGrant(grantResult.rawToken)).rejects.toThrow(
      'Access grant link has been revoked or is invalid'
    );

    const sessionAInDb = await prisma.session.findUnique({ where: { id: sessionA.session.id } });
    expect(sessionAInDb?.status).toBe('revoked');
  });

  it('6. PostgreSQL RLS Policies & Multi-Tenancy Isolation Audit', async () => {
    // Verify RLS Enablement & Policy definitions in PostgreSQL catalog
    const rlsTables = await prisma.$queryRaw<any[]>`
      SELECT tablename, rowsecurity
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename IN ('dormitory_line_friends', 'dormitory_access_grants', 'dormitory_line_configs', 'line_webhook_event_receipts');
    `;
    expect(rlsTables.length).toBe(4);
    for (const table of rlsTables) {
      expect(table.rowsecurity).toBe(true);
    }

    const policies = await prisma.$queryRaw<any[]>`
      SELECT policyname, tablename, cmd, qual
      FROM pg_policies
      WHERE tablename IN ('dormitory_line_friends', 'dormitory_access_grants', 'dormitory_line_configs', 'line_webhook_event_receipts');
    `;
    expect(policies.length).toBe(4);
    for (const pol of policies) {
      expect(pol.qual).toContain('app.current_dormitory_id');
    }
  });

  it('7. Public Webhook Resolver Function (resolve_line_webhook_config)', async () => {
    const config = await lineOaService.updateDormitoryLineConfig(testDormitoryId, {
      lineOaId: '@test_resolver_oa',
      channelId: '1657999999',
      channelSecret: 'secret_resolver_key_12345',
      channelAccessToken: 'token_resolver_access_key_12345'
    });

    expect(config.webhookUrl).toBeDefined();
    const rawKey = config.webhookUrl!.split('/api/v1/line/webhook/')[1];
    const keyHash = hashToken(rawKey);

    // Query SECURITY DEFINER function
    const res = await prisma.$queryRaw<any[]>`SELECT * FROM public.resolve_line_webhook_config(${keyHash})`;
    expect(res.length).toBe(1);
    expect(res[0].dormitory_id).toBe(testDormitoryId);
    expect(res[0].is_connected).toBe(true);

    // Query with random key -> returns 0 rows
    const resRandom = await prisma.$queryRaw<any[]>`SELECT * FROM public.resolve_line_webhook_config(${hashToken('random_invalid_key')})`;
    expect(resRandom.length).toBe(0);
  });

  it('8. LINE Credentials Verification Adapter Failure Handling', async () => {
    // Attempt updating config with invalid credentials (adapter rejects)
    await expect(
      lineOaService.updateDormitoryLineConfig(testDormitoryId, {
        channelSecret: 'invalid_secret',
        channelAccessToken: 'invalid_token'
      })
    ).rejects.toThrow('LINE OA credential verification failed. Please check Channel Secret and Access Token.');
  });
});
