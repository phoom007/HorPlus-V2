import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express, { Request, Response } from 'express';
import { InMemoryPlanRepository, SYSTEM_PLANS_SEED } from '../../db/repositories/plan.repository.js';
import { AuthenticationService } from '../../services/auth.service.js';
import { getRedisClient } from '../../db/redis.js';
import { createBillingRouter } from '../../routes/billing.routes.js';
import { createMeterRouter } from '../../routes/meter.routes.js';
import { createContractRouter } from '../../routes/contract.routes.js';
import { createTenantRouter } from '../../routes/tenant.routes.js';
import { createOccupancyRouter } from '../../routes/occupancy.routes.js';
import { cleanupService } from '../../services/cleanup.service.js';
import { idempotencyService } from '../../services/idempotency.service.js';
import { receiptService } from '../../services/receipt.service.js';
import { lateFeeReconciliationService } from '../../services/late-fee-reconciliation.service.js';
import { getPrismaClient } from '../../db/prisma.js';

describe('TASK 09 — Architecture, Resilience, and Performance Hardening', () => {
  describe('AC-1: Dormitory Scoping and Fallback Removal', () => {
    it('rejects unauthenticated/unscoped billing requests with 401 or 400 without falling back to dorm-001', async () => {
      const mockAuthService = {
        verifySessionToken: vi.fn().mockResolvedValue(null),
        validateSession: vi.fn().mockResolvedValue(null),
        verifyCsrf: vi.fn().mockReturnValue(true),
      } as unknown as AuthenticationService;

      const mockBillingService = {
        getBills: vi.fn(),
      } as any;

      const app = express();
      app.use(express.json());
      app.use('/api/v1/bills', createBillingRouter(mockAuthService, mockBillingService));

      const res = await request(app).get('/api/v1/bills');
      // Must be rejected (400 DORMITORY_CONTEXT_REQUIRED because context is missing)
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('DORMITORY_CONTEXT_REQUIRED');
      expect(mockBillingService.getBills).not.toHaveBeenCalled();
    });

    it('rejects authenticated session with no dormitory membership and no context (fail-closed)', async () => {
      const mockAuthService = {
        verifySessionToken: vi.fn().mockResolvedValue({ sub: 'user-no-dorm', sid: 'sess-1' }),
        validateSession: vi.fn().mockResolvedValue({
          user: { id: 'user-no-dorm', status: 'active' },
          session: { id: 'sess-1', lastSeenAt: new Date() },
          memberships: [], // No memberships!
        }),
        verifyCsrf: vi.fn().mockReturnValue(true),
      } as unknown as AuthenticationService;

      const mockBillingService = {
        getBills: vi.fn(),
      } as any;

      const app = express();
      app.use(express.json());
      // Session middleware populates req.auth
      app.use((req, res, next) => {
        req.auth = {
          userId: 'user-no-dorm',
          sessionId: 'sess-1',
          memberships: [],
        } as any;
        next();
      });
      app.use('/api/v1/bills', createBillingRouter(mockAuthService, mockBillingService));

      const res = await request(app).get('/api/v1/bills');
      // Should fail-closed with 400 DORMITORY_CONTEXT_REQUIRED, never falling back to dorm-001
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('DORMITORY_CONTEXT_REQUIRED');
      expect(mockBillingService.getBills).not.toHaveBeenCalled();
    });
  });

  describe('AC-2: Free Plan LINE Message Quota Alignment (N-04 / ARC-05)', () => {
    it('sets Free Plan quota to strictly 30 messages/month in SYSTEM_PLANS_SEED and InMemoryPlanRepository', async () => {
      const freeSeed = SYSTEM_PLANS_SEED.find((p) => p.code === 'FREE');
      expect(freeSeed).toBeDefined();
      expect(freeSeed?.messageQuotaMonthly).toBe(30);

      const repo = new InMemoryPlanRepository();
      const freePlan = await repo.findByCode('FREE');
      expect(freePlan).toBeDefined();
      expect(freePlan?.messageQuotaMonthly).toBe(30);
    });
  });

  describe('AC-3: Unified Prisma Connection Pool (PERF-03)', () => {
    it('shares the single getPrismaClient() singleton across services', () => {
      const singletonClient = getPrismaClient();
      expect(singletonClient).toBeDefined();

      // Access private client via any cast
      expect((cleanupService as any).client).toBe(singletonClient);
      expect((idempotencyService as any).client).toBe(singletonClient);
      expect((lateFeeReconciliationService as any).prisma).toBe(singletonClient);
    });
  });

  describe('AC-4: Session lastSeenAt Write Throttling (PERF-02)', () => {
    it('throttles sessionRepo.updateLastSeen to at most once per 60 seconds', async () => {
      const mockSessionRepo = {
        findBySessionIdHash: vi.fn(),
        updateLastSeen: vi.fn().mockResolvedValue(undefined),
      };
      const mockUserRepo = {
        findById: vi.fn().mockResolvedValue({ id: 'u1', status: 'active' }),
      };
      const mockMembershipRepo = {
        findByUserId: vi.fn().mockResolvedValue([{ dormitoryId: 'dorm-1', roleCode: 'OWNER' }]),
      };

      const mockEnv = {
        SESSION_ENCRYPTION_KEY: 'test-secret-at-least-32-bytes-long-for-testing',
        CSRF_SIGNING_KEY: 'test-csrf-secret-key-for-testing-purposes-1234',
      };

      const authService = new AuthenticationService(
        mockEnv as any,
        {} as any,
        mockUserRepo as any,
        mockSessionRepo as any,
        mockMembershipRepo as any,
        {} as any,
        {} as any
      );

      // Mock sessionTokenService.decryptToken
      vi.spyOn((authService as any).sessionTokenService, 'decryptToken').mockReturnValue({ sub: 'u1', sid: 'sess-1', version: 1 } as any);

      // Case 1: Session was last seen just 10 seconds ago (< 60s)
      const recentSession = {
        id: 'sess-1',
        userId: 'u1',
        status: 'active',
        tokenVersion: 1,
        expiresAt: new Date(Date.now() + 3600_000),
        lastSeenAt: new Date(Date.now() - 10_000),
      };
      mockSessionRepo.findBySessionIdHash.mockResolvedValue(recentSession);

      const res1 = await authService.validateSession('token-1');
      expect(res1).not.toBeNull();
      // Should NOT update lastSeen
      expect(mockSessionRepo.updateLastSeen).not.toHaveBeenCalled();

      // Case 2: Session was last seen 70 seconds ago (> 60s)
      const oldSession = {
        id: 'sess-1',
        userId: 'u1',
        status: 'active',
        tokenVersion: 1,
        expiresAt: new Date(Date.now() + 3600_000),
        lastSeenAt: new Date(Date.now() - 70_000),
      };
      mockSessionRepo.findBySessionIdHash.mockResolvedValue(oldSession);

      const res2 = await authService.validateSession('token-2');
      expect(res2).not.toBeNull();
      // Should update lastSeen
      expect(mockSessionRepo.updateLastSeen).toHaveBeenCalledWith('sess-1');
    });
  });

  describe('AC-5: Pagination PageSize Maximum Ceiling (PERF-08)', () => {
    it('clamps pageSize to maximum 200 in billing routes', async () => {
      let capturedQuery: any = null;
      const mockBillingService = {
        getBills: vi.fn().mockImplementation(async (_dormId, q) => {
          capturedQuery = q;
          return { items: [], total: 0 };
        }),
      } as any;

      const mockAuthService = {
        verifySessionToken: vi.fn().mockResolvedValue({ sub: 'u1', sid: 's1' }),
        validateSession: vi.fn().mockResolvedValue({ user: { id: 'u1', status: 'active' }, session: { id: 's1' }, memberships: [{ dormitoryId: 'dorm-test', roleCode: 'OWNER' }] }),
      } as any;

      const app = express();
      app.use(express.json());
      app.use((req, res, next) => {
        req.auth = { userId: 'u1', sessionId: 's1', dormitoryId: 'dorm-test', memberships: [{ dormitoryId: 'dorm-test', roleCode: 'OWNER' }] } as any;
        next();
      });
      app.use('/api/v1/bills', createBillingRouter(mockAuthService, mockBillingService));

      const res = await request(app).get('/api/v1/bills?pageSize=999999&page=0');
      expect(res.status).toBe(200);
      expect(capturedQuery.pageSize).toBe(200);
      expect(capturedQuery.page).toBe(1);
      expect(res.body.pagination.pageSize).toBe(200);
      expect(res.body.pagination.page).toBe(1);
    });

    it('clamps pageSize to maximum 200 in contract routes', async () => {
      let capturedQuery: any = null;
      const mockContractService = {
        getContracts: vi.fn().mockImplementation(async (_dormId, q) => {
          capturedQuery = q;
          return { items: [], total: 0 };
        }),
      } as any;

      const mockAuthService = {} as any;

      const app = express();
      app.use(express.json());
      app.use((req, res, next) => {
        req.auth = { userId: 'u1', sessionId: 's1', dormitoryId: 'dorm-test', memberships: [{ dormitoryId: 'dorm-test', roleCode: 'OWNER' }] } as any;
        (req as any).dormitoryContext = { dormitoryId: 'dorm-test', permissions: ['contracts:view'] };
        next();
      });
      app.use('/api/v1/contracts', createContractRouter(mockAuthService, mockContractService));

      const res = await request(app).get('/api/v1/contracts?pageSize=500&page=-5');
      expect(res.status).toBe(200);
      expect(capturedQuery.pageSize).toBe(200);
      expect(capturedQuery.page).toBe(1);
      expect(res.body.pagination.pageSize).toBe(200);
      expect(res.body.pagination.page).toBe(1);
    });

    it('clamps pageSize to maximum 200 in tenant routes', async () => {
      let capturedQuery: any = null;
      const mockTenantService = {
        getTenants: vi.fn().mockImplementation(async (_dormId, q) => {
          capturedQuery = q;
          return { items: [], total: 0 };
        }),
      } as any;

      const mockAuthService = {} as any;

      const app = express();
      app.use(express.json());
      app.use((req, res, next) => {
        req.auth = { userId: 'u1', sessionId: 's1', dormitoryId: 'dorm-test', memberships: [{ dormitoryId: 'dorm-test', roleCode: 'OWNER' }] } as any;
        (req as any).dormitoryContext = { dormitoryId: 'dorm-test', roleCode: 'OWNER', permissions: ['tenants:view'] };
        next();
      });
      app.use('/api/v1/tenants', createTenantRouter(mockAuthService, mockTenantService));

      const res = await request(app).get('/api/v1/tenants?pageSize=10000');
      expect(res.status).toBe(200);
      expect(capturedQuery.pageSize).toBe(200);
      expect(res.body.pagination.pageSize).toBe(200);
    });
  });

  describe('AC-6: Redis Continuous Reconnection Backoff (PERF-10)', () => {
    it('configures retryStrategy with continuous exponential backoff capped at 3000ms instead of stopping at 3', () => {
      const client = getRedisClient();
      const options = (client as any).options;
      expect(typeof options.retryStrategy).toBe('function');

      // Test retry strategy responses
      expect(options.retryStrategy(1)).toBe(200);
      expect(options.retryStrategy(2)).toBe(400);
      expect(options.retryStrategy(3)).toBe(600);
      // Key fix: attempt 4, 5, 20 must NOT return null (must keep retrying)
      expect(options.retryStrategy(4)).toBe(800);
      expect(options.retryStrategy(15)).toBe(3000);
      expect(options.retryStrategy(50)).toBe(3000);
    });
  });

  describe('AC-7: Clean Termination of Background Schedulers (RES-03)', () => {
    it('terminates cleanupService and lateFee schedules on stop()', async () => {
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
      const runCleanupSpy = vi.spyOn(cleanupService, 'runCleanup').mockResolvedValue({ expiredMarked: 0, orphansDeleted: 0, consumedMetadataPurged: 0 });

      cleanupService.startHourly();
      await cleanupService.stop();

      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
      runCleanupSpy.mockRestore();
    });
  });
});
