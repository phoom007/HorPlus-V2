import { describe, it, expect, beforeEach } from 'vitest';
import supertest from 'supertest';
import express, { Express } from 'express';
import { validateEnv } from '../src/config/env.js';
import { MockGoogleIdentityVerifier } from '../src/services/google-verifier.service.js';
import { AuthenticationService } from '../src/services/auth.service.js';
import { InMemoryUserRepository } from '../src/db/repositories/user.repository.js';
import { InMemorySessionRepository } from '../src/db/repositories/session.repository.js';
import { InMemoryMembershipRepository } from '../src/db/repositories/membership.repository.js';
import { InMemoryRoleRepository } from '../src/db/repositories/role.repository.js';
import { auditService } from '../src/services/audit.service.js';
import { createRequireSessionMiddleware } from '../src/middleware/require-session.js';
import { createRequireDormitoryContextMiddleware } from '../src/middleware/require-dormitory.js';
import { createRequirePermissionMiddleware } from '../src/middleware/require-permission.js';
import { permissionService } from '../src/services/permission.service.js';
import { withDormitoryTransaction } from '../src/db/transaction-rls.js';

describe('TASK 010 — Membership, Permission & RLS Context Tests', () => {
  let app: Express;
  let authService: AuthenticationService;
  let membershipRepo: InMemoryMembershipRepository;
  let roleRepo: InMemoryRoleRepository;
  let sessionCookies: string[];

  beforeEach(async () => {
    const env = validateEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      REDIS_URL: 'redis://localhost:6379',
      SESSION_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef',
      CSRF_SIGNING_KEY: 'csrf-secret-key-0123456789abcdef',
    });

    const verifier = new MockGoogleIdentityVerifier();
    const userRepo = new InMemoryUserRepository();
    const sessionRepo = new InMemorySessionRepository();
    membershipRepo = new InMemoryMembershipRepository();
    roleRepo = new InMemoryRoleRepository();

    authService = new AuthenticationService(
      env,
      verifier,
      userRepo,
      sessionRepo,
      membershipRepo,
      roleRepo,
      auditService
    );

    // Authenticate user
    const authResult = await authService.authenticateGoogle({ idToken: 'valid-owner-token' });

    // Seed membership for authenticated user ID
    await membershipRepo.addMembership({
      userId: authResult.user.id,
      dormitoryId: 'dorm-001',
      dormitoryName: 'HorPlus Grand Residence',
      roleId: 'role-owner',
      roleCode: 'OWNER',
      status: 'active',
    });

    sessionCookies = [`horplus_session=${authResult.sessionToken}`];

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.cookies = { horplus_session: authResult.sessionToken };
      next();
    });

    const requireSession = createRequireSessionMiddleware(authService);
    const requireDormitory = createRequireDormitoryContextMiddleware(membershipRepo, roleRepo);
    const requireRoomView = createRequirePermissionMiddleware(permissionService, 'rooms', 'view');
    const requireSettingsUpdate = createRequirePermissionMiddleware(permissionService, 'settings', 'update');

    app.get('/api/v1/protected/rooms', requireSession, requireDormitory, requireRoomView, (req, res) => {
      res.json({ status: 'ok', dormitoryId: req.dormitoryContext?.dormitoryId });
    });

    app.get('/api/v1/protected/settings', requireSession, requireDormitory, requireSettingsUpdate, (req, res) => {
      res.json({ status: 'ok', dormitoryId: req.dormitoryContext?.dormitoryId });
    });
  });

  it('Dormitory Context Middleware should require X-Dormitory-Id header', async () => {
    const res = await supertest(app)
      .get('/api/v1/protected/rooms')
      .set('Cookie', sessionCookies);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('DORMITORY_HEADER_REQUIRED');
  });

  it('Dormitory Context Middleware should reject access to unauthorized dormitory', async () => {
    const res = await supertest(app)
      .get('/api/v1/protected/rooms')
      .set('Cookie', sessionCookies)
      .set('X-Dormitory-Id', 'dorm-unauthorized-999');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('DORMITORY_ACCESS_DENIED');
  });

  it('Dormitory Context Middleware should allow access when active membership exists', async () => {
    const res = await supertest(app)
      .get('/api/v1/protected/rooms')
      .set('Cookie', sessionCookies)
      .set('X-Dormitory-Id', 'dorm-001');

    expect(res.status).toBe(200);
    expect(res.body.dormitoryId).toBe('dorm-001');
  });

  it('Role OWNER should have permission override for any module and action', async () => {
    const res = await supertest(app)
      .get('/api/v1/protected/settings')
      .set('Cookie', sessionCookies)
      .set('X-Dormitory-Id', 'dorm-001');

    expect(res.status).toBe(200);
  });

  it('withDormitoryTransaction helper should set local RLS context variables', async () => {
    const executedQueries: string[] = [];
    const mockTx = {
      $executeRawUnsafe: async (sql: string) => {
        executedQueries.push(sql);
      },
    };

    const result = await withDormitoryTransaction(
      mockTx,
      { userId: 'usr-owner-001', dormitoryId: 'dorm-001' },
      async (tx) => {
        return 'transaction-success';
      }
    );

    expect(result).toBe('transaction-success');
    expect(executedQueries.length).toBe(2);
    expect(executedQueries[0]).toContain("SET LOCAL app.current_user_id = 'usr-owner-001'");
    expect(executedQueries[1]).toContain("SET LOCAL app.current_dormitory_id = 'dorm-001'");
  });
});
