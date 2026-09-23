import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { Request, Response } from 'express';
import request from 'supertest';
import { validateEnv, INSECURE_DEFAULT_SECRETS } from '../../config/env.js';
import { getMasterKeyString, DEFAULT_INSECURE_MASTER_KEY } from '../../utils/crypto-encryption.js';
import { sanitizeRedirectUrl, createAuthRouter } from '../../routes/auth.routes.js';
import { createBillboardRouter, DEFAULT_BILLBOARD_ITEMS } from '../../routes/billboard.routes.js';

describe('Task 03 - Secrets & Backdoors Security Suite', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('AC-1: Production Secret Validation & Fail-Fast (SEC-03)', () => {
    const validProdBase = {
      NODE_ENV: 'production',
      PORT: '3000',
      DATABASE_URL: 'postgresql://prod_user:secret_pass@db.prod:5432/horplus?schema=public',
      REDIS_URL: 'redis://redis.prod:6379',
      CORS_ORIGINS: 'https://app.hor-plus.com',
      SESSION_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef-custom-strong-session-key',
      CSRF_SIGNING_KEY: 'custom-strong-csrf-key-16bytes',
      FIELD_ENCRYPTION_KEY: 'fedcba9876543210fedcba9876543210-custom-strong-field-key',
      APP_ENCRYPTION_KEY: 'custom-master-app-encryption-key-32bytes-long',
    };

    it('passes production validation when all secrets are strong, custom, and valid', () => {
      const config = validateEnv(validProdBase);
      expect(config.NODE_ENV).toBe('production');
      expect(config.SESSION_ENCRYPTION_KEY).toBe(validProdBase.SESSION_ENCRYPTION_KEY);
      expect(config.CSRF_SIGNING_KEY).toBe(validProdBase.CSRF_SIGNING_KEY);
      expect(config.FIELD_ENCRYPTION_KEY).toBe(validProdBase.FIELD_ENCRYPTION_KEY);
      expect(config.APP_ENCRYPTION_KEY).toBe(validProdBase.APP_ENCRYPTION_KEY);
    });

    it('fails in production if SESSION_ENCRYPTION_KEY uses the default insecure key', () => {
      expect(() =>
        validateEnv({
          ...validProdBase,
          SESSION_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef',
        })
      ).toThrowError(/SESSION_ENCRYPTION_KEY must not use default or weak value/);
    });

    it('fails in production if SESSION_ENCRYPTION_KEY is shorter than 32 characters', () => {
      expect(() =>
        validateEnv({
          ...validProdBase,
          SESSION_ENCRYPTION_KEY: 'short-key',
        })
      ).toThrowError(/SESSION_ENCRYPTION_KEY must be at least 32 characters/);
    });

    it('fails in production if CSRF_SIGNING_KEY uses the default insecure key', () => {
      expect(() =>
        validateEnv({
          ...validProdBase,
          CSRF_SIGNING_KEY: 'csrf-secret-key-0123456789abcdef',
        })
      ).toThrowError(/CSRF_SIGNING_KEY must not use default or weak value/);
    });

    it('fails in production if CSRF_SIGNING_KEY is shorter than 16 characters', () => {
      expect(() =>
        validateEnv({
          ...validProdBase,
          CSRF_SIGNING_KEY: 'short',
        })
      ).toThrowError(/CSRF_SIGNING_KEY.*at least 16 character/i);
    });

    it('fails in production if FIELD_ENCRYPTION_KEY uses the default insecure key', () => {
      expect(() =>
        validateEnv({
          ...validProdBase,
          FIELD_ENCRYPTION_KEY: 'fedcba9876543210fedcba9876543210',
        })
      ).toThrowError(/FIELD_ENCRYPTION_KEY must not use default or weak value/);
    });

    it('fails in production if FIELD_ENCRYPTION_KEY is shorter than 32 characters', () => {
      expect(() =>
        validateEnv({
          ...validProdBase,
          FIELD_ENCRYPTION_KEY: 'short-field-key',
        })
      ).toThrowError(/FIELD_ENCRYPTION_KEY must be at least 32 characters/);
    });

    it('fails in production if APP_ENCRYPTION_KEY and LINE_ENCRYPTION_KEY are missing', () => {
      const withoutMaster = { ...validProdBase };
      delete (withoutMaster as any).APP_ENCRYPTION_KEY;
      delete (withoutMaster as any).LINE_ENCRYPTION_KEY;

      expect(() => validateEnv(withoutMaster)).toThrowError(
        /APP_ENCRYPTION_KEY or LINE_ENCRYPTION_KEY must be provided and must not use default or weak value/
      );
    });

    it('fails in production if master encryption key uses default insecure value', () => {
      expect(() =>
        validateEnv({
          ...validProdBase,
          APP_ENCRYPTION_KEY: 'horplus-default-secure-32byte-master-key-2026',
        })
      ).toThrowError(/APP_ENCRYPTION_KEY or LINE_ENCRYPTION_KEY must be provided and must not use default or weak value/);
    });

    it('allows default keys in development and test environments for developer convenience', () => {
      const devConfig = validateEnv({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://dev:dev@localhost:5432/horplus',
      });
      expect(devConfig.NODE_ENV).toBe('development');
      expect(devConfig.SESSION_ENCRYPTION_KEY).toBe('0123456789abcdef0123456789abcdef');

      const testConfig = validateEnv({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://test:test@localhost:5432/horplus_test',
      });
      expect(testConfig.NODE_ENV).toBe('test');
    });
  });

  describe('AC-2: Master Key Fail-Fast in crypto-encryption (SEC-03)', () => {
    it('throws in production when APP_ENCRYPTION_KEY is not configured or uses default', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.APP_ENCRYPTION_KEY;
      delete process.env.LINE_ENCRYPTION_KEY;

      expect(() => getMasterKeyString()).toThrowError(
        /Production security violation: APP_ENCRYPTION_KEY or LINE_ENCRYPTION_KEY must not use default or weak value/
      );

      process.env.APP_ENCRYPTION_KEY = DEFAULT_INSECURE_MASTER_KEY;
      expect(() => getMasterKeyString()).toThrowError(
        /Production security violation: APP_ENCRYPTION_KEY or LINE_ENCRYPTION_KEY must not use default or weak value/
      );
    });

    it('returns custom strong key in production without error', () => {
      process.env.NODE_ENV = 'production';
      process.env.APP_ENCRYPTION_KEY = 'a-super-secret-production-master-key-with-32-chars!';

      expect(getMasterKeyString()).toBe('a-super-secret-production-master-key-with-32-chars!');
    });

    it('returns default fallback key in development/test without error', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.APP_ENCRYPTION_KEY;
      delete process.env.LINE_ENCRYPTION_KEY;

      expect(getMasterKeyString()).toBe(DEFAULT_INSECURE_MASTER_KEY);
    });
  });

  describe('AC-3: Dev Login & Test Login Protection in Production (SEC-05)', () => {
    let app: express.Express;
    const mockAuthService: any = {
      getSessionTokenService: () => ({
        encryptToken: () => 'mock-session-token',
      }),
      getCsrfService: () => ({
        generateCsrfToken: () => 'mock-csrf-token',
      }),
      authenticateTestUser: vi.fn().mockResolvedValue({
        sessionToken: 'mock-session-token',
        csrfToken: 'mock-csrf-token',
        user: { id: 'mock-user-id', email: 'test@example.com' },
        memberships: [],
      }),
    };

    beforeEach(() => {
      app = express();
      app.use(express.json());
      // Mount router
      app.use('/api/v1/auth', createAuthRouter(mockAuthService));
    });

    it('disables /dev-login and /dev-tenant-login in production mode (returns 404)', async () => {
      process.env.NODE_ENV = 'production';
      const prodApp = express();
      prodApp.use(express.json());
      prodApp.use('/api/v1/auth', createAuthRouter(mockAuthService));

      const devLoginRes = await request(prodApp).get('/api/v1/auth/dev-login');
      expect(devLoginRes.status).toBe(404);

      const devTenantLoginRes = await request(prodApp).get('/api/v1/auth/dev-tenant-login');
      expect(devTenantLoginRes.status).toBe(404);
    });

    it('disables /e2e-login when not in test mode (returns 404)', async () => {
      process.env.NODE_ENV = 'production';
      const prodApp = express();
      prodApp.use(express.json());
      prodApp.use('/api/v1/auth', createAuthRouter(mockAuthService));

      const e2eRes = await request(prodApp)
        .post('/api/v1/auth/e2e-login')
        .send({ userId: '10000000-0000-4000-8000-000000000001' });

      expect(e2eRes.status).toBe(404);
    });
  });

  describe('AC-4: Backdoor Removal Verification (SEC-05)', () => {
    it('/owner-direct-entry route is removed and returns 404 Not Found', async () => {
      const app = express();
      app.use(express.json());
      const mockAuthService: any = {};
      app.use('/api/v1/auth', createAuthRouter(mockAuthService));

      const res = await request(app).get('/api/v1/auth/owner-direct-entry?grantId=423b38a0-596a-49aa-86ee-162f548411d0');
      expect(res.status).toBe(404);
    });
  });

  describe('AC-5: Open Redirect Sanitization (SEC-05)', () => {
    const fallback = 'http://127.0.0.1:5173/owner/home';

    it('allows safe relative application paths starting with /', () => {
      expect(sanitizeRedirectUrl('/owner/home', fallback)).toBe('/owner/home');
      expect(sanitizeRedirectUrl('/tenant/dashboard', fallback)).toBe('/tenant/dashboard');
      expect(sanitizeRedirectUrl('/settings?tab=profile', fallback)).toBe('/settings?tab=profile');
      expect(sanitizeRedirectUrl('/', fallback)).toBe('/');
    });

    it('rejects external absolute URLs and returns fallback', () => {
      expect(sanitizeRedirectUrl('https://evil.com', fallback)).toBe(fallback);
      expect(sanitizeRedirectUrl('http://attacker.com/steal-creds', fallback)).toBe(fallback);
      expect(sanitizeRedirectUrl('ftp://evil.com', fallback)).toBe(fallback);
    });

    it('rejects protocol-relative URLs (//) and backslash traversal', () => {
      expect(sanitizeRedirectUrl('//evil.com', fallback)).toBe(fallback);
      expect(sanitizeRedirectUrl('/\\evil.com', fallback)).toBe(fallback);
      expect(sanitizeRedirectUrl('///evil.com', fallback)).toBe(fallback);
    });

    it('rejects javascript: and data: pseudo-protocols', () => {
      expect(sanitizeRedirectUrl('javascript:alert(1)', fallback)).toBe(fallback);
      expect(sanitizeRedirectUrl('data:text/html,<script>alert(1)</script>', fallback)).toBe(fallback);
    });

    it('rejects invalid or empty inputs and returns fallback', () => {
      expect(sanitizeRedirectUrl('', fallback)).toBe(fallback);
      expect(sanitizeRedirectUrl(null, fallback)).toBe(fallback);
      expect(sanitizeRedirectUrl(undefined, fallback)).toBe(fallback);
      expect(sanitizeRedirectUrl('   ', fallback)).toBe(fallback);
    });
  });

  describe('AC-6 & AC-7: Billboard Mutation Security & Read-Only GET (SEC-06)', () => {
    let app: express.Express;
    const mockAuthService: any = {
      getSessionTokenService: () => ({
        decryptToken: vi.fn(),
      }),
      getSessionRepository: () => ({
        findSessionById: vi.fn(),
      }),
      getCsrfService: () => ({
        validateCsrfToken: vi.fn(),
      }),
    };

    beforeEach(() => {
      app = express();
      app.use(express.json());
      app.use('/api/v1/billboard', createBillboardRouter(mockAuthService));
    });

    it('AC-6: rejects unauthenticated mutation POST / with 401 Unauthorized', async () => {
      const res = await request(app)
        .post('/api/v1/billboard')
        .send({
          imageUrl: '/billboards/test.jpg',
          title: 'Malicious Advertisement',
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
    });

    it('AC-6: rejects unauthenticated DELETE /:id with 401 Unauthorized', async () => {
      const res = await request(app).delete('/api/v1/billboard/test-id-123');
      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
    });

    it('AC-6: rejects unauthenticated POST /reset with 401 Unauthorized', async () => {
      const res = await request(app).post('/api/v1/billboard/reset');
      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
    });

    it('AC-7: GET / returns active promotional items without write side-effects', async () => {
      const res = await request(app).get('/api/v1/billboard');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0].title).toBeDefined();
      expect(res.body.data[0].imageUrl).toBeDefined();
    });
  });
});
