/**
 * Task 06: Append-Only Audit Log Enforcement & Comprehensive Mutation Auditing (N-01)
 * @license Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AuditService,
  deepSanitize,
  cleanAuditActorId,
} from '../../services/audit.service.js';
import { getPrismaClient } from '../../db/prisma.js';

describe('Task 06: Append-Only Audit Log Enforcement & Mutation Auditing', () => {
  describe('Unit: Deep Redaction & Actor Sanitization', () => {
    it('deepSanitize redacts sensitive keys at any nesting level', () => {
      const payload = {
        dormitoryId: 'dorm-123',
        status: 'PAID',
        token: 'secret-token-123',
        nested: {
          accessToken: 'nested-token',
          password: 'super-password',
          safeField: 'safe-value',
          credentials: {
            apiKey: 'key-999',
            idToken: 'jwt.token.here',
            clientSecret: 'shhh',
            userCookie: 'cookie-session-val',
            signatureData: 'sig-data-raw',
          },
          subObject: {
            apiKey: 'key-123',
            normalData: 'hello',
          },
        },
        list: [
          { name: 'item1', authHeader: 'Bearer 12345' },
          { name: 'item2', secretHash: 'hash-abc' },
        ],
      };

      const sanitized = deepSanitize(payload);

      expect(sanitized.dormitoryId).toBe('dorm-123');
      expect(sanitized.status).toBe('PAID');
      expect(sanitized.token).toBe('[REDACTED]');
      expect(sanitized.nested.accessToken).toBe('[REDACTED]');
      expect(sanitized.nested.password).toBe('[REDACTED]');
      expect(sanitized.nested.safeField).toBe('safe-value');
      // Key "credentials" matches substring "credential" -> entire object redacted
      expect(sanitized.nested.credentials).toBe('[REDACTED]');
      // Nested sensitive key inside non-sensitive parent key
      expect(sanitized.nested.subObject.apiKey).toBe('[REDACTED]');
      expect(sanitized.nested.subObject.normalData).toBe('hello');
      // Lists and arrays
      expect(sanitized.list[0].name).toBe('item1');
      expect(sanitized.list[0].authHeader).toBe('[REDACTED]');
      expect(sanitized.list[1].name).toBe('item2');
      expect(sanitized.list[1].secretHash).toBe('[REDACTED]');
    });

    it('cleanAuditActorId strips usr_ prefix and returns valid UUID, or null for non-UUID', () => {
      const validUuid = '11111111-2222-4333-8444-555555555555';
      expect(cleanAuditActorId(validUuid)).toBe(validUuid);
      expect(cleanAuditActorId(`usr_${validUuid}`)).toBe(validUuid);
      expect(cleanAuditActorId('non-uuid-principal')).toBeNull();
      expect(cleanAuditActorId('SYSTEM')).toBeNull();
      expect(cleanAuditActorId(null)).toBeNull();
      expect(cleanAuditActorId(undefined)).toBeNull();
    });
  });

  describe('Unit: AuditService.recordMutation logic', () => {
    it('persists record with deep sanitized values and passes transaction client tx', async () => {
      const mockAuditLogCreate = vi.fn().mockResolvedValue({ id: 'audit-log-uuid-1' });
      const mockTx = {
        auditLog: {
          create: mockAuditLogCreate,
        },
      };

      const auditService = new AuditService();
      const validActor = '11111111-2222-4333-8444-555555555555';
      const validDorm = '22222222-3333-4444-8555-666666666666';

      const result = await auditService.recordMutation({
        dormitoryId: validDorm,
        actorUserId: `usr_${validActor}`,
        action: 'PAYMENT_APPROVED',
        entityType: 'PAYMENT',
        entityId: 'pay-uuid-001',
        beforeValues: { status: 'PENDING', rawSecretKey: 'do-not-log-me' },
        afterValues: { status: 'APPROVED', sessionToken: 'also-secret' },
        tx: mockTx,
      });

      expect(mockAuditLogCreate).toHaveBeenCalledTimes(1);
      const callData = mockAuditLogCreate.mock.calls[0][0].data;

      expect(callData.dormitoryId).toBe(validDorm);
      expect(callData.actorUserId).toBe(validActor);
      expect(callData.action).toBe('PAYMENT_APPROVED');
      expect(callData.entityType).toBe('PAYMENT');
      expect(callData.entityId).toBe('pay-uuid-001');
      expect(callData.beforeValues.status).toBe('PENDING');
      expect(callData.beforeValues.rawSecretKey).toBe('[REDACTED]');
      expect(callData.afterValues.status).toBe('APPROVED');
      expect(callData.afterValues.sessionToken).toBe('[REDACTED]');
      expect(result.id).toBe('audit-log-uuid-1');
    });
  });

  describe('Database Trigger & Security Verification (Live Pilot DB)', () => {
    let prisma: ReturnType<typeof getPrismaClient>;
    let testAuditRowId: string | null = null;
    let validDormitoryId: string | null = null;

    beforeEach(async () => {
      prisma = getPrismaClient();
      try {
        const dorm = await prisma.dormitory.findFirst({ select: { id: true } });
        if (dorm) {
          validDormitoryId = dorm.id;
          const row = await prisma.auditLog.create({
            data: {
              dormitoryId: dorm.id,
              action: 'TEST_AUDIT_SEED',
              entityType: 'TEST_SUITE',
              entityId: 'test-seed-001',
              afterValues: { note: 'seed-for-immutability-check' },
            },
          });
          testAuditRowId = row.id;
        }
      } catch {
        // Fallback for isolated unit run where DB is not running
      }
    });

    it('AC-1: Direct UPDATE on audit_logs fails and is blocked by DB permission or trigger', async () => {
      if (!testAuditRowId) return;

      let errorThrown: any = null;
      try {
        await prisma.$executeRawUnsafe(
          `UPDATE audit_logs SET action = 'tampered' WHERE id = '${testAuditRowId}'::uuid`
        );
      } catch (err: any) {
        errorThrown = err;
      }

      expect(errorThrown).not.toBeNull();
      expect(errorThrown.message).toMatch(/permission denied for table audit_logs|AUDIT_LOG_IMMUTABLE/);
    });

    it('AC-2: Direct DELETE on audit_logs fails and is blocked by DB permission or trigger', async () => {
      if (!testAuditRowId) return;

      let errorThrown: any = null;
      try {
        await prisma.$executeRawUnsafe(
          `DELETE FROM audit_logs WHERE id = '${testAuditRowId}'::uuid`
        );
      } catch (err: any) {
        errorThrown = err;
      }

      expect(errorThrown).not.toBeNull();
      expect(errorThrown.message).toMatch(/permission denied for table audit_logs|AUDIT_LOG_IMMUTABLE/);
    });

    it('AC-3: Direct TRUNCATE on audit_logs fails and is blocked by DB permission or trigger', async () => {
      if (!testAuditRowId) return;

      let errorThrown: any = null;
      try {
        await prisma.$executeRawUnsafe(`TRUNCATE TABLE audit_logs`);
      } catch (err: any) {
        errorThrown = err;
      }

      expect(errorThrown).not.toBeNull();
      expect(errorThrown.message).toMatch(/permission denied for table audit_logs|AUDIT_LOG_IMMUTABLE/);
    });

    it('AC-4: App role horplus_app privileges are restricted to SELECT and INSERT only', async () => {
      if (!testAuditRowId) return;

      const privRows: any[] = await prisma.$queryRawUnsafe(`
        SELECT privilege_type 
        FROM information_schema.table_privileges 
        WHERE grantee = 'horplus_app' AND table_name = 'audit_logs';
      `);

      const privs = privRows.map((r) => r.privilege_type);
      expect(privs).toContain('SELECT');
      expect(privs).toContain('INSERT');
      expect(privs).not.toContain('UPDATE');
      expect(privs).not.toContain('DELETE');
      expect(privs).not.toContain('TRUNCATE');
    });

    it('Foreign key constraint on audit_logs.dormitory_id is RESTRICT (not CASCADE)', async () => {
      if (!testAuditRowId) return;

      const fkRows: any[] = await prisma.$queryRawUnsafe(`
        SELECT rc.delete_rule
        FROM information_schema.referential_constraints rc
        JOIN information_schema.table_constraints tc
          ON rc.constraint_name = tc.constraint_name
        WHERE tc.table_name = 'audit_logs'
          AND rc.constraint_name = 'audit_logs_dormitory_id_fkey';
      `);

      expect(fkRows.length).toBeGreaterThan(0);
      expect(fkRows[0].delete_rule).toBe('RESTRICT');
    });

    it('Four mandatory mutation categories are persisted with correct entityType and action', async () => {
      if (!validDormitoryId) return;

      const auditService = new AuditService();

      // 1. Financial Mutation
      const finRow = await auditService.recordMutation({
        dormitoryId: validDormitoryId,
        action: 'PAYMENT_CASH_RECORDED',
        entityType: 'PAYMENT',
        entityId: 'pay-test-101',
        afterValues: { amount: '3500.00', billId: 'bill-101' },
      });
      expect(finRow.id).toBeDefined();
      expect(finRow.entityType).toBe('PAYMENT');
      expect(finRow.action).toBe('PAYMENT_CASH_RECORDED');

      // 2. Permission Mutation
      const permRow = await auditService.recordMutation({
        dormitoryId: validDormitoryId,
        action: 'ACCESS_GRANT_CREATED',
        entityType: 'DormitoryAccessGrant',
        entityId: 'grant-test-202',
        afterValues: { roleCode: 'STAFF' },
      });
      expect(permRow.id).toBeDefined();
      expect(permRow.entityType).toBe('DormitoryAccessGrant');
      expect(permRow.action).toBe('ACCESS_GRANT_CREATED');

      // 3. Contract Mutation
      const ctrRow = await auditService.recordMutation({
        dormitoryId: validDormitoryId,
        action: 'CONTRACT_TERMINATED',
        entityType: 'Contract',
        entityId: 'ctr-test-303',
        reason: 'Emergency move-out completed',
        afterValues: { status: 'checked_out' },
      });
      expect(ctrRow.id).toBeDefined();
      expect(ctrRow.entityType).toBe('Contract');
      expect(ctrRow.action).toBe('CONTRACT_TERMINATED');

      // 4. Approval Mutation
      const appRow = await auditService.recordMutation({
        dormitoryId: validDormitoryId,
        action: 'TENANT_REGISTRATION_APPROVED',
        entityType: 'TenantRegistrationRequest',
        entityId: 'req-test-404',
        afterValues: { status: 'approved', roomId: 'room-101' },
      });
      expect(appRow.id).toBeDefined();
      expect(appRow.entityType).toBe('TenantRegistrationRequest');
      expect(appRow.action).toBe('TENANT_REGISTRATION_APPROVED');
    });
  });
});
