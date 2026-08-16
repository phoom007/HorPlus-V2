import { describe, it, expect, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../src/db/prisma.js';
import { outboxService } from '../src/services/outbox.service.js';
import { PrismaNotificationRepository } from '../src/db/repositories/prisma-notification.repository.js';
import crypto from 'crypto';

const prisma = getPrismaClient();
const adminPrisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } },
});

describe('LOCAL-03: Local Notification Outbox & Operations Polish', () => {
  let testDormitoryId: string;
  let testOwnerUserId: string;
  let testManagerUserId: string;
  let testTenantId: string;

  beforeEach(async () => {
    // Delete table rows in foreign-key dependency order for clean test slate
    const tablesToClean = [
      'referral_attributions', 'user_referral_codes', 'coin_ledger_entries', 'coin_wallets',
      'account_benefit_claims', 'promo_redemptions', 'subscription_status_histories',
      'dormitory_subscriptions', 'payment_upload_intents', 'local_notification_outbox',
      'staff_notices', 'tenant_notices', 'contract_settlement_items', 'contract_settlements',
      'tenant_renewal_requests', 'tenant_move_out_requests', 'bill_items', 'receipts',
      'receipt_sequences', 'payment_status_histories', 'payments', 'bill_status_histories',
      'bills', 'room_next_cycle_corrections', 'room_billing_cycle_snapshots',
      'billing_rate_snapshots', 'billing_cycles', 'meter_replacements', 'meter_readings',
      'meter_devices', 'contract_snapshots', 'contract_status_histories', 'contracts',
      'occupancies', 'tenant_vehicles', 'tenant_emergency_contacts', 'tenant_co_occupants',
      'tenant_registration_requests', 'tenants', 'rooms', 'buildings', 'dormitory_members',
      'dormitory_access_grants', 'dormitory_line_friends', 'dormitory_line_configs',
      'line_webhook_event_receipts', 'line_push_delivery_attempts', 'line_push_usage',
      'owner_signatures', 'dormitory_billing_settings', 'dormitory_property_defaults',
      'onboarding_drafts', 'audit_logs', 'subscription_package_intents', 'dormitories',
      'sessions', 'users'
    ];
    for (const tbl of tablesToClean) {
      await prisma.$executeRawUnsafe(`DELETE FROM "${tbl}";`);
    }

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
    await prisma.tenant.create({
      data: {
        id: otherTenantId,
        dormitoryId: testDormitoryId,
        tenantNumber: `TNT-OTHER-${Date.now()}`,
        firstName: 'Other',
        lastName: 'Tenant',
        displayName: 'Other Tenant',
        phone: '0899999999',
        status: 'active',
      },
    });

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

  // 11. TRUE Concurrent Dispatcher Exactly-One-Delivery
  it('should deliver exactly one notice when two concurrent dispatchers process the same pending event', async () => {
    const aggregateId = crypto.randomUUID();

    await prisma.$transaction(async (tx) => {
      await outboxService.createOutboxEvent(tx, {
        dormitoryId: testDormitoryId,
        eventType: 'CONCURRENCY_TEST',
        aggregateType: 'TEST',
        aggregateId,
        recipientType: 'TENANT',
        recipientId: testTenantId,
        title: 'Concurrent Dispatch Test',
        body: 'Body',
      });
    });

    // Run 2 dispatchers concurrently
    const [res1, res2] = await Promise.allSettled([
      outboxService.processPendingOutboxEvents(),
      outboxService.processPendingOutboxEvents(),
    ]);

    expect(res1.status).toBe('fulfilled');
    expect(res2.status).toBe('fulfilled');

    const notices = await prisma.tenantNotice.findMany({
      where: { dormitoryId: testDormitoryId, tenantId: testTenantId },
    });

    expect(notices.length).toBe(1); // EXACTLY ONE notice delivered!
  });

  // 12. Tenant Destination Database Uniqueness
  it('should enforce database-level unique constraint on TenantNotice.sourceOutboxId', async () => {
    const outboxId = crypto.randomUUID();

    await prisma.tenantNotice.create({
      data: {
        dormitoryId: testDormitoryId,
        tenantId: testTenantId,
        title: 'First Notice',
        message: 'Message 1',
        sourceOutboxId: outboxId,
      },
    });

    await expect(
      prisma.tenantNotice.create({
        data: {
          dormitoryId: testDormitoryId,
          tenantId: testTenantId,
          title: 'Duplicate Notice',
          message: 'Message 2',
          sourceOutboxId: outboxId,
        },
      })
    ).rejects.toThrow();
  });

  // 13. Staff Notice Per-User Dismissal Isolation
  it('should dismiss staff notice for the authenticated user only without affecting other staff members', async () => {
    const repo = new PrismaNotificationRepository();

    const aggregateId = crypto.randomUUID();
    await prisma.$transaction(async (tx) => {
      await outboxService.createOutboxEvent(tx, {
        dormitoryId: testDormitoryId,
        eventType: 'DISMISSAL_TEST',
        aggregateType: 'TEST',
        aggregateId,
        recipientType: 'STAFF',
        recipientRoleCode: 'OWNER,MANAGER',
        title: 'Dismissal Isolation Test',
        body: 'Testing dismissal isolation',
      });
    });

    await outboxService.processPendingOutboxEvents();

    const ownerNoticesBefore = await repo.listForStaff(testDormitoryId, testOwnerUserId);
    const managerNoticesBefore = await repo.listForStaff(testDormitoryId, testManagerUserId);

    expect(ownerNoticesBefore.length).toBe(1);
    expect(managerNoticesBefore.length).toBe(1);

    // Owner dismisses their notice
    const dismissed = await repo.dismissStaffNotice(testDormitoryId, ownerNoticesBefore[0].id, testOwnerUserId);
    expect(dismissed).toBe(true);

    const ownerNoticesAfter = await repo.listForStaff(testDormitoryId, testOwnerUserId);
    const managerNoticesAfter = await repo.listForStaff(testDormitoryId, testManagerUserId);

    expect(ownerNoticesAfter.length).toBe(0); // Dismissed from Owner list!
    expect(managerNoticesAfter.length).toBe(1); // Remains visible in Manager list!
  });

  // 14. Malformed Outbox Event Fail-Safe
  it('should mark malformed event as FAILED without blocking valid outbox events', async () => {
    // Insert malformed outbox event with empty body
    const malformed = await prisma.localNotificationOutbox.create({
      data: {
        dormitoryId: testDormitoryId,
        eventType: 'MALFORMED',
        aggregateType: 'TEST',
        aggregateId: crypto.randomUUID(),
        recipientType: 'TENANT',
        recipientId: testTenantId,
        title: '',
        body: '',
        status: 'PENDING',
        idempotencyKey: `malformed-${Date.now()}`,
      },
    });

    // Insert valid event
    const validAggregateId = crypto.randomUUID();
    await prisma.$transaction(async (tx) => {
      await outboxService.createOutboxEvent(tx, {
        dormitoryId: testDormitoryId,
        eventType: 'VALID_EVENT',
        aggregateType: 'TEST',
        aggregateId: validAggregateId,
        recipientType: 'TENANT',
        recipientId: testTenantId,
        title: 'Valid Event Title',
        body: 'Valid Event Body',
      });
    });

    await outboxService.processPendingOutboxEvents();

    const updatedMalformed = await prisma.localNotificationOutbox.findUnique({
      where: { id: malformed.id },
    });
    expect(updatedMalformed?.status).toBe('FAILED');

    const validNotice = await prisma.tenantNotice.findFirst({
      where: { dormitoryId: testDormitoryId, title: 'Valid Event Title' },
    });
    expect(validNotice).not.toBeNull();
  });

  // 15. Staff Delivery Atomicity & Rollback Integrity
  it('should roll back all staff deliveries and keep event recoverable when one recipient delivery fails', async () => {
    let outboxId = '';
    const aggregateId = crypto.randomUUID();

    // Create STAFF outbox event targeting both OWNER and MANAGER
    await prisma.$transaction(async (tx) => {
      const event = await outboxService.createOutboxEvent(tx, {
        dormitoryId: testDormitoryId,
        eventType: 'ATOMICITY_TEST',
        aggregateType: 'TEST',
        aggregateId,
        recipientType: 'STAFF',
        recipientRoleCode: 'OWNER,MANAGER',
        title: 'Atomic Staff Notice',
        body: 'Must roll back atomically if one recipient fails',
      });
      outboxId = event.id;
    });

    try {
      // Inject deterministic failure only for the Manager recipient on staff_notices
      await adminPrisma.$executeRawUnsafe(`
        CREATE OR REPLACE FUNCTION test_fail_second_staff_recipient() RETURNS trigger AS $$
        BEGIN
          IF NEW.user_id = '${testManagerUserId}' THEN
            RAISE EXCEPTION 'INDUCED_DELIVERY_FAILURE_FOR_MANAGER';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `);

      await adminPrisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS trg_test_fail_second_staff ON staff_notices;');
      await adminPrisma.$executeRawUnsafe(`
        CREATE TRIGGER trg_test_fail_second_staff
          BEFORE INSERT OR UPDATE ON staff_notices
          FOR EACH ROW
          EXECUTE FUNCTION test_fail_second_staff_recipient();
      `);

      // Run dispatcher — should fail during Manager upsert and abort the transaction
      await outboxService.processPendingOutboxEvents();

      // Assert zero partial staff notifications committed (Owner insertion rolled back)
      const noticesAfterFailure = await prisma.staffNotification.findMany({
        where: { sourceOutboxId: outboxId },
      });
      expect(noticesAfterFailure.length).toBe(0);

      // Assert outbox event was NOT marked PROCESSED (remains PENDING and recoverable)
      const outboxAfterFailure = await prisma.localNotificationOutbox.findUnique({
        where: { id: outboxId },
      });
      expect(outboxAfterFailure?.status).toBe('PENDING');
      expect(outboxAfterFailure?.processedAt).toBeNull();
    } finally {
      // Clean up the temporary test trigger
      await adminPrisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS trg_test_fail_second_staff ON staff_notices;');
      await adminPrisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_fail_second_staff_recipient();');
    }

    // Now re-run dispatcher after removing induced failure
    const retryResult = await outboxService.processPendingOutboxEvents();
    expect(retryResult.processedCount).toBeGreaterThanOrEqual(1);

    // Assert both intended recipients received exactly one notification with no duplicates
    const finalNotices = await prisma.staffNotification.findMany({
      where: { sourceOutboxId: outboxId },
    });
    expect(finalNotices.length).toBe(2);

    const ownerNotice = finalNotices.find((n) => n.userId === testOwnerUserId);
    const managerNotice = finalNotices.find((n) => n.userId === testManagerUserId);
    expect(ownerNotice).toBeDefined();
    expect(managerNotice).toBeDefined();

    // Assert outbox event is now PROCESSED with processedAt timestamp
    const finalOutbox = await prisma.localNotificationOutbox.findUnique({
      where: { id: outboxId },
    });
    expect(finalOutbox?.status).toBe('PROCESSED');
    expect(finalOutbox?.processedAt).not.toBeNull();
  });

  // 16. Zero Active Recipients Explicit Policy
  it('should mark STAFF event as FAILED with NO_ACTIVE_RECIPIENTS when no active members exist', async () => {
    // Suspend all dormitory members for this dormitory
    await prisma.dormitoryMember.updateMany({
      where: { dormitoryId: testDormitoryId },
      data: { status: 'suspended' },
    });

    let outboxId = '';
    const aggregateId = crypto.randomUUID();

    await prisma.$transaction(async (tx) => {
      const event = await outboxService.createOutboxEvent(tx, {
        dormitoryId: testDormitoryId,
        eventType: 'ZERO_RECIPIENT_TEST',
        aggregateType: 'TEST',
        aggregateId,
        recipientType: 'STAFF',
        recipientRoleCode: 'OWNER,MANAGER',
        title: 'Zero Recipient Notice',
        body: 'Should fail with NO_ACTIVE_RECIPIENTS',
      });
      outboxId = event.id;
    });

    const result = await outboxService.processPendingOutboxEvents();
    expect(result.failedCount).toBeGreaterThanOrEqual(1);

    const outbox = await prisma.localNotificationOutbox.findUnique({
      where: { id: outboxId },
    });
    expect(outbox?.status).toBe('FAILED');
    expect(outbox?.lastError).toBe('NO_ACTIVE_RECIPIENTS');
    expect(outbox?.processedAt).toBeNull();

    // Zero staff notifications created
    const notices = await prisma.staffNotification.findMany({
      where: { sourceOutboxId: outboxId },
    });
    expect(notices.length).toBe(0);
  });

  // 17. Structural Validation: TENANT event with recipientId = null -> FAILED
  it('should mark TENANT event with null recipientId as FAILED and create no TenantNotice', async () => {
    let outboxId = '';
    const aggregateId = crypto.randomUUID();

    const event = await prisma.localNotificationOutbox.create({
      data: {
        dormitoryId: testDormitoryId,
        eventType: 'TENANT_STRUCTURAL_NULL_RECIPIENT',
        aggregateType: 'TEST',
        aggregateId,
        recipientType: 'TENANT',
        recipientId: null,
        title: 'Missing Recipient Test',
        body: 'Recipient is null',
        status: 'PENDING',
        idempotencyKey: `null-recipient-${Date.now()}`,
      },
    });
    outboxId = event.id;

    const result = await outboxService.processPendingOutboxEvents();
    expect(result.failedCount).toBeGreaterThanOrEqual(1);

    const outbox = await prisma.localNotificationOutbox.findUnique({
      where: { id: outboxId },
    });
    expect(outbox?.status).toBe('FAILED');
    expect(outbox?.lastError).toBe('MISSING_TENANT_RECIPIENT');
    expect(outbox?.processedAt).toBeNull();

    // Zero TenantNotice records created
    const notices = await prisma.tenantNotice.findMany({
      where: { sourceOutboxId: outboxId },
    });
    expect(notices.length).toBe(0);
  });

  // 18. Structural Validation: TENANT event with malformed recipient UUID -> FAILED
  it('should mark TENANT event with malformed recipient UUID as FAILED', async () => {
    let outboxId = '';
    const aggregateId = crypto.randomUUID();

    const event = await prisma.localNotificationOutbox.create({
      data: {
        dormitoryId: testDormitoryId,
        eventType: 'TENANT_STRUCTURAL_MALFORMED_UUID',
        aggregateType: 'TEST',
        aggregateId,
        recipientType: 'TENANT',
        recipientId: 'not-a-valid-uuid-string',
        title: 'Malformed Recipient Test',
        body: 'Recipient is not a valid UUID',
        status: 'PENDING',
        idempotencyKey: `malformed-uuid-${Date.now()}`,
      },
    });
    outboxId = event.id;

    const result = await outboxService.processPendingOutboxEvents();
    expect(result.failedCount).toBeGreaterThanOrEqual(1);

    const outbox = await prisma.localNotificationOutbox.findUnique({
      where: { id: outboxId },
    });
    expect(outbox?.status).toBe('FAILED');
    expect(outbox?.lastError).toBe('INVALID_TENANT_RECIPIENT');
    expect(outbox?.processedAt).toBeNull();

    // Zero TenantNotice records created
    const notices = await prisma.tenantNotice.findMany({
      where: { sourceOutboxId: outboxId },
    });
    expect(notices.length).toBe(0);
  });

  // 19. Structural Validation: TENANT event points to tenant from another dorm -> FAILED (No leakage)
  it('should mark TENANT event as FAILED when tenant belongs to another dormitory (cross-dorm isolation)', async () => {
    const otherDormitoryId = crypto.randomUUID();
    const otherTenantId = crypto.randomUUID();

    // Create another dormitory and a tenant belonging to that dormitory
    await prisma.dormitory.create({
      data: {
        id: otherDormitoryId,
        name: 'Other Foreign Dormitory',
        code: `DORM-FOREIGN-${Date.now()}`,
        status: 'active',
        createdByUserId: testOwnerUserId,
      },
    });

    await prisma.tenant.create({
      data: {
        id: otherTenantId,
        dormitoryId: otherDormitoryId,
        tenantNumber: `TNT-FOR-${Date.now()}`,
        firstName: 'Foreign',
        lastName: 'Tenant',
        displayName: 'Foreign Tenant',
        phone: '0899999999',
        status: 'active',
      },
    });

    let outboxId = '';
    const aggregateId = crypto.randomUUID();

    // Outbox event has dormitoryId = testDormitoryId, but recipientId = otherTenantId
    const event = await prisma.localNotificationOutbox.create({
      data: {
        dormitoryId: testDormitoryId,
        eventType: 'TENANT_CROSS_DORM_MISMATCH',
        aggregateType: 'TEST',
        aggregateId,
        recipientType: 'TENANT',
        recipientId: otherTenantId,
        title: 'Cross Dorm Mismatch Notice',
        body: 'Tenant belongs to other dorm',
        status: 'PENDING',
        idempotencyKey: `cross-dorm-${Date.now()}`,
      },
    });
    outboxId = event.id;

    const result = await outboxService.processPendingOutboxEvents();
    expect(result.failedCount).toBeGreaterThanOrEqual(1);

    const outbox = await prisma.localNotificationOutbox.findUnique({
      where: { id: outboxId },
    });
    expect(outbox?.status).toBe('FAILED');
    expect(outbox?.lastError).toBe('RECIPIENT_DORMITORY_MISMATCH');
    expect(outbox?.processedAt).toBeNull();

    // Zero TenantNotice records created anywhere
    const notices = await prisma.tenantNotice.findMany({
      where: { sourceOutboxId: outboxId },
    });
    expect(notices.length).toBe(0);
  });

  // 20. Structural Validation: Unknown recipientType -> FAILED
  it('should mark event with unknown recipientType as FAILED without creating notices', async () => {
    let outboxId = '';
    const aggregateId = crypto.randomUUID();

    const event = await prisma.localNotificationOutbox.create({
      data: {
        dormitoryId: testDormitoryId,
        eventType: 'UNKNOWN_RECIPIENT_TYPE_TEST',
        aggregateType: 'TEST',
        aggregateId,
        recipientType: 'UNKNOWN_TYPE_INVALID',
        recipientId: testTenantId,
        title: 'Invalid Recipient Type Notice',
        body: 'Recipient type is invalid',
        status: 'PENDING',
        idempotencyKey: `invalid-recipient-type-${Date.now()}`,
      },
    });
    outboxId = event.id;

    const result = await outboxService.processPendingOutboxEvents();
    expect(result.failedCount).toBeGreaterThanOrEqual(1);

    const outbox = await prisma.localNotificationOutbox.findUnique({
      where: { id: outboxId },
    });
    expect(outbox?.status).toBe('FAILED');
    expect(outbox?.lastError).toBe('INVALID_RECIPIENT_TYPE');
    expect(outbox?.processedAt).toBeNull();

    const tenantNotices = await prisma.tenantNotice.findMany({
      where: { sourceOutboxId: outboxId },
    });
    expect(tenantNotices.length).toBe(0);

    const staffNotices = await prisma.staffNotification.findMany({
      where: { sourceOutboxId: outboxId },
    });
    expect(staffNotices.length).toBe(0);
  });

  // 21. Structural Validation: Valid TENANT event remains PROCESSED exactly once
  it('should process valid TENANT event exactly once with idempotency guarantee', async () => {
    let outboxId = '';
    const aggregateId = crypto.randomUUID();

    await prisma.$transaction(async (tx) => {
      const event = await outboxService.createOutboxEvent(tx, {
        dormitoryId: testDormitoryId,
        eventType: 'VALID_TENANT_NOTICE',
        aggregateType: 'TEST',
        aggregateId,
        recipientType: 'TENANT',
        recipientId: testTenantId,
        title: 'Valid Tenant Notice',
        body: 'Legitimate notice for valid tenant',
      });
      outboxId = event.id;
    });

    // First run
    const result1 = await outboxService.processPendingOutboxEvents();
    expect(result1.processedCount).toBeGreaterThanOrEqual(1);

    const outbox = await prisma.localNotificationOutbox.findUnique({
      where: { id: outboxId },
    });
    expect(outbox?.status).toBe('PROCESSED');
    expect(outbox?.lastError).toBeNull();
    expect(outbox?.processedAt).not.toBeNull();

    const notices1 = await prisma.tenantNotice.findMany({
      where: { sourceOutboxId: outboxId },
    });
    expect(notices1.length).toBe(1);
    expect(notices1[0].tenantId).toBe(testTenantId);
    expect(notices1[0].dormitoryId).toBe(testDormitoryId);
    expect(notices1[0].title).toBe('Valid Tenant Notice');

    // Second run: idempotency
    const result2 = await outboxService.processPendingOutboxEvents();
    expect(result2.processedCount).toBe(0);

    const notices2 = await prisma.tenantNotice.findMany({
      where: { sourceOutboxId: outboxId },
    });
    expect(notices2.length).toBe(1);
  });
});
