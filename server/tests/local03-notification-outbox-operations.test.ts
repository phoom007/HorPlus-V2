import { describe, it, expect, beforeEach } from 'vitest';
import { getPrismaClient } from '../src/db/prisma.js';
import { outboxService } from '../src/services/outbox.service.js';
import { PrismaNotificationRepository } from '../src/db/repositories/prisma-notification.repository.js';
import crypto from 'crypto';

const prisma = getPrismaClient();

describe('LOCAL-03: Local Notification Outbox & Operations Polish', () => {
  let testDormitoryId: string;
  let testOwnerUserId: string;
  let testManagerUserId: string;
  let testTenantId: string;

  beforeEach(async () => {
    // Truncate tables for clean test slate
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE local_notification_outbox, staff_notices, tenant_notices, contract_settlement_items, contract_settlements, tenant_renewal_requests, occupancies, bill_items, receipts, payment_status_histories, payments, bills, contract_snapshots, contracts, tenant_registration_requests, tenants, rooms, buildings, dormitory_members, dormitories, users CASCADE;'
    );

    testDormitoryId = crypto.randomUUID();
    testOwnerUserId = crypto.randomUUID();
    testManagerUserId = crypto.randomUUID();
    testTenantId = crypto.randomUUID();

    const ownerEmail = `owner-${Date.now()}@example.com`;
    const managerEmail = `manager-${Date.now()}@example.com`;

    // Create Users in PostgreSQL for foreign key constraints
    await prisma.user.create({
      data: {
        id: testOwnerUserId,
        googleSubject: `sub-${testOwnerUserId}`,
        email: ownerEmail,
        emailNormalized: ownerEmail.toLowerCase(),
        name: 'Test Owner',
      },
    });

    await prisma.user.create({
      data: {
        id: testManagerUserId,
        googleSubject: `sub-${testManagerUserId}`,
        email: managerEmail,
        emailNormalized: managerEmail.toLowerCase(),
        name: 'Test Manager',
      },
    });

    // Create Dormitory
    await prisma.dormitory.create({
      data: {
        id: testDormitoryId,
        name: 'Test Dormitory LOCAL-03',
        code: `DORM-${Date.now()}`,
        status: 'active',
        createdByUserId: testOwnerUserId,
      },
    });

    // Create Roles if not existing
    let ownerRole = await prisma.role.findFirst({ where: { code: 'OWNER' } });
    if (!ownerRole) {
      ownerRole = await prisma.role.create({
        data: { name: 'Owner', code: 'OWNER', isSystem: true, permissions: ['*'] },
      });
    }

    let managerRole = await prisma.role.findFirst({ where: { code: 'MANAGER' } });
    if (!managerRole) {
      managerRole = await prisma.role.create({
        data: { name: 'Manager', code: 'MANAGER', isSystem: true, permissions: ['tenant:*'] },
      });
    }

    // Create Dormitory Members (Owner & Manager)
    await prisma.dormitoryMember.create({
      data: {
        dormitoryId: testDormitoryId,
        userId: testOwnerUserId,
        roleId: ownerRole.id,
        status: 'active',
      },
    });

    await prisma.dormitoryMember.create({
      data: {
        dormitoryId: testDormitoryId,
        userId: testManagerUserId,
        roleId: managerRole.id,
        status: 'active',
      },
    });

    // Create Room & Tenant
    await prisma.building.create({
      data: {
        id: crypto.randomUUID(),
        dormitoryId: testDormitoryId,
        name: 'Building A',
      },
    });

    await prisma.tenant.create({
      data: {
        id: testTenantId,
        dormitoryId: testDormitoryId,
        tenantNumber: `TNT-${Date.now()}`,
        firstName: 'Test',
        lastName: 'Tenant',
        displayName: 'Test Tenant',
        phone: '0812345678',
        status: 'active',
      },
    });
  });

  // 1. Transactional Atomicity & Outbox Event Persistence
  it('should write outbox event atomically inside PostgreSQL transaction', async () => {
    const aggregateId = crypto.randomUUID();

    await prisma.$transaction(async (tx) => {
      await outboxService.createOutboxEvent(tx, {
        dormitoryId: testDormitoryId,
        eventType: 'FORCED_TERMINATION',
        aggregateType: 'CONTRACT',
        aggregateId,
        recipientType: 'TENANT',
        recipientId: testTenantId,
        title: 'Atomic Test Notice',
        body: 'Testing atomic transaction outbox creation',
      });
    });

    const events = await prisma.localNotificationOutbox.findMany({
      where: { dormitoryId: testDormitoryId, aggregateId },
    });

    expect(events.length).toBe(1);
    expect(events[0].status).toBe('PENDING');
    expect(events[0].eventType).toBe('FORCED_TERMINATION');
  });

  // 2. Transaction Rollback Isolation
  it('should leave zero orphan outbox events when transaction rolls back', async () => {
    const aggregateId = crypto.randomUUID();

    await expect(
      prisma.$transaction(async (tx) => {
        await outboxService.createOutboxEvent(tx, {
          dormitoryId: testDormitoryId,
          eventType: 'FORCED_TERMINATION',
          aggregateType: 'CONTRACT',
          aggregateId,
          recipientType: 'TENANT',
          recipientId: testTenantId,
          title: 'Rollback Test',
          body: 'This transaction will roll back',
        });
        throw new Error('INTENTIONAL_ROLLBACK');
      })
    ).rejects.toThrow('INTENTIONAL_ROLLBACK');

    const events = await prisma.localNotificationOutbox.findMany({
      where: { dormitoryId: testDormitoryId, aggregateId },
    });

    expect(events.length).toBe(0);
  });

  // 3. Dispatcher Processing & Tenant Delivery
  it('should process pending tenant outbox event into persistent TenantNotice', async () => {
    const aggregateId = crypto.randomUUID();

    await prisma.$transaction(async (tx) => {
      await outboxService.createOutboxEvent(tx, {
        dormitoryId: testDormitoryId,
        eventType: 'RENEWAL_APPROVED',
        aggregateType: 'TENANT_RENEWAL',
        aggregateId,
        recipientType: 'TENANT',
        recipientId: testTenantId,
        title: 'Renewal Approved',
        body: 'Your contract renewal was approved',
      });
    });

    const result = await outboxService.processPendingOutboxEvents();
    expect(result.processedCount).toBeGreaterThanOrEqual(1);

    const notices = await prisma.tenantNotice.findMany({
      where: { dormitoryId: testDormitoryId, tenantId: testTenantId },
    });

    expect(notices.length).toBe(1);
    expect(notices[0].title).toBe('Renewal Approved');
    expect(notices[0].isRead).toBe(false);
  });

  // 4. Staff Per-User Materialization & Isolation
  it('should materialize separate StaffNotification records for each active staff user', async () => {
    const aggregateId = crypto.randomUUID();

    await prisma.$transaction(async (tx) => {
      await outboxService.createOutboxEvent(tx, {
        dormitoryId: testDormitoryId,
        eventType: 'TENANT_REGISTRATION_SUBMITTED',
        aggregateType: 'TENANT_REGISTRATION',
        aggregateId,
        recipientType: 'STAFF',
        recipientRoleCode: 'OWNER,MANAGER',
        title: 'New Registration Submitted',
        body: 'A new registration request requires approval',
      });
    });

    await outboxService.processPendingOutboxEvents();

    const staffNotices = await prisma.staffNotification.findMany({
      where: { dormitoryId: testDormitoryId },
    });

    expect(staffNotices.length).toBe(2); // One for Owner, one for Manager!

    const ownerNotice = staffNotices.find((n) => n.userId === testOwnerUserId);
    const managerNotice = staffNotices.find((n) => n.userId === testManagerUserId);

    expect(ownerNotice).toBeDefined();
    expect(managerNotice).toBeDefined();
    expect(ownerNotice?.isRead).toBe(false);
    expect(managerNotice?.isRead).toBe(false);
  });

  // 5. Staff Per-User Read Isolation
  it('should isolate read state between different staff users', async () => {
    const repo = new PrismaNotificationRepository();

    const aggregateId = crypto.randomUUID();
    await prisma.$transaction(async (tx) => {
      await outboxService.createOutboxEvent(tx, {
        dormitoryId: testDormitoryId,
        eventType: 'TEST_ISOLATION',
        aggregateType: 'TEST',
        aggregateId,
        recipientType: 'STAFF',
        recipientRoleCode: 'OWNER,MANAGER',
        title: 'Read Isolation Test',
        body: 'Testing read state isolation between users',
      });
    });

    await outboxService.processPendingOutboxEvents();

    const ownerNoticesBefore = await repo.listForStaff(testDormitoryId, testOwnerUserId);
    const managerNoticesBefore = await repo.listForStaff(testDormitoryId, testManagerUserId);

    expect(ownerNoticesBefore[0].isRead).toBe(false);
    expect(managerNoticesBefore[0].isRead).toBe(false);

    // Owner marks their notice as read
    await repo.markAsRead(testDormitoryId, ownerNoticesBefore[0].id, testOwnerUserId);

    const ownerNoticesAfter = await repo.listForStaff(testDormitoryId, testOwnerUserId);
    const managerNoticesAfter = await repo.listForStaff(testDormitoryId, testManagerUserId);

    expect(ownerNoticesAfter[0].isRead).toBe(true);
    expect(managerNoticesAfter[0].isRead).toBe(false); // Manager's notice remains unread!
  });

  // 6. Replay & Crash Idempotency
  it('should not duplicate notices on outbox replay or crash window recovery', async () => {
    const aggregateId = crypto.randomUUID();
    let outboxId = '';

    await prisma.$transaction(async (tx) => {
      const event = await outboxService.createOutboxEvent(tx, {
        dormitoryId: testDormitoryId,
        eventType: 'REPLAY_TEST',
        aggregateType: 'TEST',
        aggregateId,
        recipientType: 'TENANT',
        recipientId: testTenantId,
        title: 'Replay Test Title',
        body: 'Replay test body',
      });
      outboxId = event.id;
    });

    // First dispatch
    await outboxService.processPendingOutboxEvents();

    // Force outbox event back to PENDING to simulate crash before status update
    await prisma.localNotificationOutbox.update({
      where: { id: outboxId },
      data: { status: 'PENDING' },
    });

    // Second dispatch (replay)
    await outboxService.processPendingOutboxEvents();

    const tenantNotices = await prisma.tenantNotice.findMany({
      where: { dormitoryId: testDormitoryId, tenantId: testTenantId, sourceOutboxId: outboxId },
    });

    expect(tenantNotices.length).toBe(1); // EXACTLY ONE notice delivered!
  });

  // 7. Revoked Staff Membership Non-Recipient Invariant
  it('should not deliver outbox events to revoked/suspended staff members', async () => {
    // Revoke Manager membership
    await prisma.dormitoryMember.updateMany({
      where: { dormitoryId: testDormitoryId, userId: testManagerUserId },
      data: { status: 'suspended' },
    });

    const aggregateId = crypto.randomUUID();
    await prisma.$transaction(async (tx) => {
      await outboxService.createOutboxEvent(tx, {
        dormitoryId: testDormitoryId,
        eventType: 'REVOKED_MEMBER_TEST',
        aggregateType: 'TEST',
        aggregateId,
        recipientType: 'STAFF',
        recipientRoleCode: 'OWNER,MANAGER',
        title: 'Revoked Member Test',
        body: 'Should not reach suspended member',
      });
    });

    await outboxService.processPendingOutboxEvents();

    const managerNotices = await prisma.staffNotification.findMany({
      where: { dormitoryId: testDormitoryId, userId: testManagerUserId },
    });

    expect(managerNotices.length).toBe(0); // Suspended member receives NO notice!
  });

  // 8. Cross-User & Cross-Tenant Spoof Rejection
  it('should reject marking another user or tenant notice as read', async () => {
    const repo = new PrismaNotificationRepository();

    const otherTenantId = crypto.randomUUID();
    const notice = await prisma.tenantNotice.create({
      data: {
        dormitoryId: testDormitoryId,
        tenantId: otherTenantId,
        title: 'Other Tenant Notice',
        message: 'Belongs to other tenant',
      },
    });

    // Test tenant tries to mark other tenant's notice as read
    const result = await repo.markAsRead(testDormitoryId, notice.id, undefined, testTenantId);
    expect(result).toBeNull(); // Non-enumerating null!
  });

  // 9. Data Minimization & Secret Sanitization
  it('should sanitize sensitive secrets and tokens from outbox payload', async () => {
    const aggregateId = crypto.randomUUID();

    await prisma.$transaction(async (tx) => {
      await outboxService.createOutboxEvent(tx, {
        dormitoryId: testDormitoryId,
        eventType: 'SENSITIVE_TEST',
        aggregateType: 'TEST',
        aggregateId,
        recipientType: 'STAFF',
        recipientRoleCode: 'OWNER',
        title: 'Secret Sanitization Test',
        body: 'Body',
        payload: {
          safeField: 'Hello',
          password: 'super-secret-password',
          channelAccessToken: 'line-access-token-12345',
          csrfSecret: 'csrf-secret-999',
        },
      });
    });

    const event = await prisma.localNotificationOutbox.findFirst({
      where: { dormitoryId: testDormitoryId, aggregateId },
    });

    const payload = event?.payload as any;
    expect(payload.safeField).toBe('Hello');
    expect(payload.password).toBeUndefined();
    expect(payload.channelAccessToken).toBeUndefined();
    expect(payload.csrfSecret).toBeUndefined();
  });

  // 10. Legacy LOCAL-02 Historical TenantNotice Compatibility
  it('should list and mark read historical TenantNotice rows where sourceOutboxId is null', async () => {
    const repo = new PrismaNotificationRepository();

    const legacyNotice = await prisma.tenantNotice.create({
      data: {
        dormitoryId: testDormitoryId,
        tenantId: testTenantId,
        title: 'Historical LOCAL-02 Notice',
        message: 'Legacy notice without outbox reference',
        type: 'FORCED_TERMINATION',
        sourceOutboxId: null,
      },
    });

    const list = await repo.listForTenant(testDormitoryId, testTenantId);
    expect(list.some((n) => n.id === legacyNotice.id)).toBe(true);

    const marked = await repo.markAsRead(testDormitoryId, legacyNotice.id, undefined, testTenantId);
    expect(marked).not.toBeNull();
    expect(marked?.isRead).toBe(true);
  });
});
