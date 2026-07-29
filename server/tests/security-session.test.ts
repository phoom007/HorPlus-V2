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
import { SessionTokenService } from '../src/services/session-token.service.js';
import { CsrfService } from '../src/services/csrf.service.js';

describe('TASK 010 — Security & Session Cryptography Tests', () => {
  let app: any;
  let authService: AuthenticationService;
  let sessionTokenService: SessionTokenService;
  let csrfService: CsrfService;

  beforeEach(() => {
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

    sessionTokenService = new SessionTokenService(env.SESSION_ENCRYPTION_KEY);
    csrfService = new CsrfService(env.CSRF_SIGNING_KEY);

    app = createApp(authService);
  });

  it('SessionTokenService should encrypt and decrypt token payloads correctly', () => {
    const encrypted = sessionTokenService.encryptToken(
      { sub: 'usr-123', sid: 'sid-456', type: 'session', version: 1 },
      3600
    );

    expect(encrypted).toBeDefined();
    expect(encrypted.split('.').length).toBe(3);

    const decrypted = sessionTokenService.decryptToken(encrypted);
    expect(decrypted).not.toBeNull();
    expect(decrypted?.sub).toBe('usr-123');
    expect(decrypted?.sid).toBe('sid-456');
  });

  it('SessionTokenService should reject tampered tokens', () => {
    const encrypted = sessionTokenService.encryptToken(
      { sub: 'usr-123', sid: 'sid-456', type: 'session', version: 1 },
      3600
    );

    const tampered = encrypted.substring(0, encrypted.length - 4) + 'AAAA';
    const decrypted = sessionTokenService.decryptToken(tampered);
    expect(decrypted).toBeNull();
  });

  it('CsrfService should generate and verify signed tokens', () => {
    const token = csrfService.generateCsrfToken('sid-456');
    expect(token).toBeDefined();

    const valid = csrfService.verifyCsrfToken(token, 'sid-456');
    expect(valid).toBe(true);

    const wrongSession = csrfService.verifyCsrfToken(token, 'sid-789');
    expect(wrongSession).toBe(false);
  });

  it('CSRF Middleware should block POST request if X-CSRF-Token is missing', async () => {
    const loginRes = await supertest(app)
      .post('/api/v1/auth/google')
      .send({ idToken: 'valid-owner-token', intent: 'owner' });

    const cookies = loginRes.headers['set-cookie'];

    const logoutRes = await supertest(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', cookies); // Missing X-CSRF-Token header

    expect(logoutRes.status).toBe(403);
    expect(logoutRes.body.error.code).toBe('CSRF_TOKEN_REQUIRED');
  });

  it('Google Auth should reject expired or unverified email tokens', async () => {
    const expiredRes = await supertest(app)
      .post('/api/v1/auth/google')
      .send({ idToken: 'expired-token', intent: 'owner' });

    expect(expiredRes.status).toBe(500); // Caught by global error handler

    const unverifiedRes = await supertest(app)
      .post('/api/v1/auth/google')
      .send({ idToken: 'unverified-email-token', intent: 'owner' });

    expect(unverifiedRes.status).toBe(500);
  });
});
