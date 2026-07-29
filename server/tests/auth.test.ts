import { describe, it, expect, beforeEach } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../src/app.js';
import { validateEnv } from '../src/config/env.js';
import { MockGoogleIdentityVerifier } from '../src/services/google-verifier.service.js';
import { AuthenticationService } from '../src/services/auth.service.js';
import { InMemoryUserRepository } from '../src/db/repositories/user.repository.js';
import { InMemorySessionRepository } from '../src/db/repositories/session.repository.js';
import { InMemoryMembershipRepository } from '../src/db/repositories/membership.repository.js';
import { InMemoryRoleRepository } from '../src/db/repositories/role.repository.js';
import { auditService } from '../src/services/audit.service.js';

describe('TASK 010 — Authentication REST API Endpoints', () => {
  let app: any;
  let authService: AuthenticationService;
  let verifier: MockGoogleIdentityVerifier;

  beforeEach(() => {
    const env = validateEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      REDIS_URL: 'redis://localhost:6379',
      SESSION_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef',
      CSRF_SIGNING_KEY: 'csrf-secret-key-0123456789abcdef',
    });

    verifier = new MockGoogleIdentityVerifier();
    const userRepo = new InMemoryUserRepository();
    const sessionRepo = new InMemorySessionRepository();
    const membershipRepo = new InMemoryMembershipRepository();
    const roleRepo = new InMemoryRoleRepository();

    authService = new AuthenticationService(
      env,
      verifier,
      userRepo,
      sessionRepo,
      membershipRepo,
      roleRepo,
      auditService
    );

    app = createApp(authService);
  });

  it('POST /api/v1/auth/google should authenticate valid google ID token and set HttpOnly session cookie', async () => {
    const res = await supertest(app)
      .post('/api/v1/auth/google')
      .send({ idToken: 'valid-owner-token', intent: 'owner' });

    expect(res.status).toBe(200);
    expect(res.body.data.user).toBeDefined();
    expect(res.body.data.user.email).toBe('owner@horplus-demo.com');
    expect(res.body.data.csrfToken).toBeDefined();

    // Verify Set-Cookie headers
    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();

    const sessionCookie = cookies.find((c: string) => c.startsWith('horplus_session='));
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toContain('HttpOnly');

    const csrfCookie = cookies.find((c: string) => c.startsWith('horplus_csrf='));
    expect(csrfCookie).toBeDefined();
  });

  it('GET /api/v1/auth/session should return 401 when session cookie is missing', async () => {
    const res = await supertest(app).get('/api/v1/auth/session');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SESSION_REQUIRED');
  });

  it('GET /api/v1/auth/session should return active session details when cookie is valid', async () => {
    const loginRes = await supertest(app)
      .post('/api/v1/auth/google')
      .send({ idToken: 'valid-owner-token', intent: 'owner' });

    const cookies = loginRes.headers['set-cookie'];

    const sessionRes = await supertest(app)
      .get('/api/v1/auth/session')
      .set('Cookie', cookies);

    expect(sessionRes.status).toBe(200);
    expect(sessionRes.body.data.authenticated).toBe(true);
    expect(sessionRes.body.data.user.email).toBe('owner@horplus-demo.com');
  });

  it('POST /api/v1/auth/logout should revoke session and clear cookies', async () => {
    const loginRes = await supertest(app)
      .post('/api/v1/auth/google')
      .send({ idToken: 'valid-owner-token', intent: 'owner' });

    const cookies = loginRes.headers['set-cookie'];
    const csrfToken = loginRes.body.data.csrfToken;

    const logoutRes = await supertest(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrfToken);

    expect(logoutRes.status).toBe(200);

    // Verify subsequent session request is unauthorized
    const sessionRes = await supertest(app)
      .get('/api/v1/auth/session')
      .set('Cookie', cookies);

    expect(sessionRes.status).toBe(401);
  });

  it('POST /api/v1/auth/logout-all should revoke all sessions for the user', async () => {
    const loginRes1 = await supertest(app)
      .post('/api/v1/auth/google')
      .send({ idToken: 'valid-owner-token', intent: 'owner' });

    const loginRes2 = await supertest(app)
      .post('/api/v1/auth/google')
      .send({ idToken: 'valid-owner-token', intent: 'owner' });

    const cookies2 = loginRes2.headers['set-cookie'];
    const csrfToken2 = loginRes2.body.data.csrfToken;

    const logoutAllRes = await supertest(app)
      .post('/api/v1/auth/logout-all')
      .set('Cookie', cookies2)
      .set('X-CSRF-Token', csrfToken2);

    expect(logoutAllRes.status).toBe(200);
    expect(logoutAllRes.body.data.revokedCount).toBeGreaterThanOrEqual(1);

    const sessionRes1 = await supertest(app)
      .get('/api/v1/auth/session')
      .set('Cookie', loginRes1.headers['set-cookie']);

    expect(sessionRes1.status).toBe(401);
  });
});
