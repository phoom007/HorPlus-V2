/**
 * Task 07 Unit Test Suite: CORS Hardening, Comprehensive CSRF, Rate Limiting & Trust Proxy (SEC-08, SEC-09, SEC-12)
 * @license Apache-2.0
 */

import express, { type Request, type Response } from 'express';
import request from 'supertest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import cors from 'cors';
import { createCsrfMiddleware } from '../../middleware/csrf.js';
import {
  createRateLimiterMiddleware,
  createSlipUploadRateLimiter,
  createTenantRegistrationRateLimiter,
  createLineWebhookRateLimiter,
  InMemoryRateLimiterStore,
  DistributedRateLimiterStore,
} from '../../middleware/rate-limiter.js';
import { AuthenticationService } from '../../services/auth.service.js';

describe('Task 07: Security Hardening (SEC-08, SEC-09, SEC-12)', () => {
  describe('SEC-08: CORS Hardening & Exact Origin Validation', () => {
    function buildCorsApp(nodeEnv: string, corsOrigins: string, publicOrigin?: string) {
      const app = express();
      const isProduction = nodeEnv === 'production';
      const corsList = corsOrigins.split(',').map((s) => s.trim());

      app.use(
        cors({
          origin: (origin, callback) => {
            if (!origin) return callback(null, true);
            const normalizedOrigin = origin.trim();

            if (corsList.includes(normalizedOrigin)) {
              return callback(null, true);
            }

            if (!isProduction && corsList.includes('*')) {
              return callback(null, true);
            }

            const publicCandidates = [publicOrigin].filter(Boolean) as string[];
            for (const candidate of publicCandidates) {
              try {
                const candidateUrl = new URL(candidate.trim());
                if (candidateUrl.origin === normalizedOrigin) {
                  return callback(null, true);
                }
              } catch {
                if (candidate.trim() === normalizedOrigin) {
                  return callback(null, true);
                }
              }
            }

            if (!isProduction) {
              if (
                normalizedOrigin.endsWith('.trycloudflare.com') ||
                /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(normalizedOrigin)
              ) {
                return callback(null, true);
              }
            }

            return callback(new Error(`CORS policy blocked access from origin: ${origin}`));
          },
          credentials: true,
        })
      );

      app.get('/test', (_req, res) => res.json({ ok: true }));

      // Custom error handler for CORS rejection
      app.use((err: any, _req: Request, res: Response, _next: any) => {
        if (err.message && err.message.includes('CORS policy blocked')) {
          return res.status(403).json({ error: 'CORS_BLOCKED', message: err.message });
        }
        res.status(500).json({ error: err.message });
      });

      return app;
    }

    it('should reject prefix-matching origin spoofing (e.g. app.hor-plus.com.evil.com)', async () => {
      const app = buildCorsApp('production', 'https://app.hor-plus.com', 'https://app.hor-plus.com');
      const res = await request(app)
        .get('/test')
        .set('Origin', 'https://app.hor-plus.com.evil.com');

      expect(res.status).toBe(403);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('should reject completely arbitrary origins in production', async () => {
      const app = buildCorsApp('production', 'https://app.hor-plus.com', 'https://app.hor-plus.com');
      const res = await request(app)
        .get('/test')
        .set('Origin', 'https://attacker.io');

      expect(res.status).toBe(403);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('should allow exact match for configured canonical origin in production', async () => {
      const app = buildCorsApp('production', 'https://app.hor-plus.com', 'https://app.hor-plus.com');
      const res = await request(app)
        .get('/test')
        .set('Origin', 'https://app.hor-plus.com');

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('https://app.hor-plus.com');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('should disallow trycloudflare tunnel in production unless explicitly in CORS_ORIGINS', async () => {
      const app = buildCorsApp('production', 'https://app.hor-plus.com', 'https://app.hor-plus.com');
      const res = await request(app)
        .get('/test')
        .set('Origin', 'https://random-tunnel.trycloudflare.com');

      expect(res.status).toBe(403);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('should allow trycloudflare tunnel in development mode', async () => {
      const app = buildCorsApp('development', 'https://app.hor-plus.com', 'https://app.hor-plus.com');
      const res = await request(app)
        .get('/test')
        .set('Origin', 'https://dev-tunnel.trycloudflare.com');

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('https://dev-tunnel.trycloudflare.com');
    });

    it('should disallow wildcard * with credentials in production', async () => {
      const app = buildCorsApp('production', '*', 'https://app.hor-plus.com');
      const res = await request(app)
        .get('/test')
        .set('Origin', 'https://unauthorized-origin.com');

      expect(res.status).toBe(403);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('SEC-12: Trust Proxy Hardening (1 hop)', () => {
    it('should compute req.ip from the immediate reverse proxy hop (1 hop)', async () => {
      const app = express();
      app.set('trust proxy', 1);

      app.get('/ip-check', (req, res) => {
        res.json({ ip: req.ip, ips: req.ips });
      });

      // Client sends spoofed X-Forwarded-For: client_spoofed, proxy1
      const res = await request(app)
        .get('/ip-check')
        .set('X-Forwarded-For', '1.1.1.1, 203.0.113.195');

      expect(res.status).toBe(200);
      // With trust proxy 1, Express trusts only the rightmost entry (203.0.113.195), ignoring 1.1.1.1
      expect(res.body.ip).toBe('203.0.113.195');
    });
  });

  describe('SEC-09: Comprehensive CSRF Protection', () => {
    let mockAuthService: AuthenticationService;

    beforeEach(() => {
      mockAuthService = {
        verifyCsrf: vi.fn((token: string, sessionId: string) => {
          return token === `valid-csrf-for-${sessionId}`;
        }),
        requireAuth: () => (req: Request, _res: Response, next: any) => {
          (req as any).auth = { sessionId: 'test-session-123', userId: 'user-1' };
          next();
        },
      } as unknown as AuthenticationService;
    });

    function buildCsrfProtectedApp() {
      const app = express();
      app.use(express.json());
      app.use((req: any, _res, next) => {
        req.auth = { sessionId: 'test-session-123', userId: 'user-1' };
        req.cookies = { horplus_csrf: 'valid-csrf-for-test-session-123' };
        next();
      });

      const csrfMiddleware = createCsrfMiddleware(mockAuthService);

      const protectedRouter = express.Router();
      protectedRouter.use(csrfMiddleware);

      protectedRouter.get('/safe-read', (_req, res) => res.json({ success: true }));
      protectedRouter.post('/mutate-data', (_req, res) => res.json({ success: true }));
      protectedRouter.put('/update-data', (_req, res) => res.json({ success: true }));
      protectedRouter.delete('/delete-data', (_req, res) => res.json({ success: true }));

      app.use('/api', protectedRouter);
      return app;
    }

    it('should allow safe methods (GET, HEAD, OPTIONS) without CSRF token', async () => {
      const app = buildCsrfProtectedApp();
      const res = await request(app).get('/api/safe-read');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should reject POST mutation when X-CSRF-Token is missing with HTTP 403', async () => {
      const app = buildCsrfProtectedApp();
      const res = await request(app)
        .post('/api/mutate-data')
        .send({ name: 'New Request' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CSRF_TOKEN_REQUIRED');
    });

    it('should reject PUT mutation when X-CSRF-Token is invalid with HTTP 403', async () => {
      const app = buildCsrfProtectedApp();
      const res = await request(app)
        .put('/api/update-data')
        .set('X-CSRF-Token', 'invalid-token-123')
        .send({ name: 'Updated' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CSRF_TOKEN_INVALID');
    });

    it('should accept mutation with valid X-CSRF-Token matching session', async () => {
      const app = buildCsrfProtectedApp();
      const res = await request(app)
        .post('/api/mutate-data')
        .set('X-CSRF-Token', 'valid-csrf-for-test-session-123')
        .send({ name: 'Valid' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('SEC-12: Rate Limiting Endpoints', () => {
    it('createTenantRegistrationRateLimiter should limit requests to 15 per window', async () => {
      const customStore = new DistributedRateLimiterStore();
      const limiter = createTenantRegistrationRateLimiter(customStore);

      const app = express();
      app.use(limiter);
      app.post('/register', (_req, res) => res.json({ ok: true }));

      // 15 requests should pass
      for (let i = 0; i < 15; i++) {
        const res = await request(app).post('/register');
        expect(res.status).toBe(200);
      }

      // 16th request should be blocked with 429
      const blockedRes = await request(app).post('/register');
      expect(blockedRes.status).toBe(429);
      expect(blockedRes.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(blockedRes.body.error.message).toContain('คำขอลงทะเบียนหรือยืนยันสิทธิ์ถี่เกินไป');
    });

    it('createLineWebhookRateLimiter should limit requests to 120 per minute', async () => {
      const customStore = new DistributedRateLimiterStore();
      const limiter = createLineWebhookRateLimiter(customStore);

      const app = express();
      app.use(limiter);
      app.post('/webhook', (_req, res) => res.json({ ok: true }));

      // Send 120 requests
      for (let i = 0; i < 120; i++) {
        const res = await request(app).post('/webhook');
        expect(res.status).toBe(200);
      }

      // 121st request should be rate-limited
      const blockedRes = await request(app).post('/webhook');
      expect(blockedRes.status).toBe(429);
      expect(blockedRes.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    });

    it('createSlipUploadRateLimiter should enforce 5-second mandatory cooldown between consecutive uploads', async () => {
      const customStore = new DistributedRateLimiterStore();
      const limiter = createSlipUploadRateLimiter(customStore);

      const app = express();
      app.use((req: any, _res, next) => {
        req.auth = { userId: 'tenant-user-1', dormitoryId: 'dorm-1' };
        next();
      });
      app.use(limiter);
      app.post('/slip/intent', (_req, res) => res.json({ ok: true }));

      // First upload: OK
      const res1 = await request(app).post('/slip/intent');
      expect(res1.status).toBe(200);

      // Immediate second upload: Blocked by 5-second cooldown
      const res2 = await request(app).post('/slip/intent');
      expect(res2.status).toBe(429);
      expect(res2.body.error.code).toBe('COOLDOWN_ACTIVE');
      expect(res2.body.error.message).toContain('กรุณารอ 5 วินาทีก่อนส่งตรวจสอบสลิปอีกครั้ง');
    });
  });
});
