import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  setActiveAppOrigin,
  getActiveAppOrigin,
  resetActiveAppOriginForTest,
  getPublicAppOrigin,
  LineOaService
} from '../../services/line-oa.service.js';
import { HttpLinePlatformAdapter, MockLinePlatformAdapter } from '../../services/line-platform-adapter.js';
import { PrismaBillRepository } from '../../db/repositories/bill.repository.js';
import { InMemoryRateLimiterStore } from '../../middleware/rate-limiter.js';
import { LocalStorageProvider } from '../../services/local-storage.service.js';
import { encryptText, createLineSignature } from '../../utils/crypto-encryption.js';

describe('TASK 10 — Webhook Security, Transaction Isolation, Concurrency & Storage Hardening', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetActiveAppOriginForTest();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetActiveAppOriginForTest();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // AC-1: SEC-04 LINE Webhook Origin Security & Precedence
  // =========================================================================
  describe('AC-1: SEC-04 LINE Webhook Origin Security', () => {
    it('in production, configured PUBLIC_APP_ORIGIN takes absolute priority and cannot be overwritten by setActiveAppOrigin', () => {
      process.env.NODE_ENV = 'production';
      process.env.PUBLIC_APP_ORIGIN = 'https://app.hor-plus.com';

      // Attempt to set a dynamic/spoofed origin from request headers
      setActiveAppOrigin('https://attacker-controlled-tunnel.trycloudflare.com');

      // The active dynamic origin must NOT override configured production origin
      const publicOrigin = getPublicAppOrigin();
      expect(publicOrigin).toBe('https://app.hor-plus.com');
    });

    it('in development/staging, allows setting dynamic origin after verification', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.PUBLIC_APP_ORIGIN;

      setActiveAppOrigin('https://verified-tunnel.trycloudflare.com');
      expect(getActiveAppOrigin()).toBe('https://verified-tunnel.trycloudflare.com');
      expect(getPublicAppOrigin()).toBe('https://verified-tunnel.trycloudflare.com');
    });

    it('processWebhookEvent rejects invalid HMAC signature without activating spoofed origin', async () => {
      const secret = 'valid-secret-123';
      const mockPrisma: any = {
        $queryRaw: vi.fn().mockResolvedValue([
          { config_id: 'cfg-1', dormitory_id: 'dorm-101' }
        ]),
        dormitoryLineConfig: {
          findUnique: vi.fn().mockResolvedValue({
            channelSecretEncrypted: encryptText(secret),
            channelAccessTokenEncrypted: encryptText('access-token-123'),
            accessTokenVerifiedAt: new Date(),
            webhookEndpointSetAt: new Date(),
            isConnected: true,
            webhookVerifiedAt: new Date(),
            id: 'cfg-1'
          })
        }
      };

      const lineOaService = new LineOaService(mockPrisma);

      // Attempt to call with spoofed origin and invalid signature
      await expect(
        lineOaService.processWebhookEvent(
          'valid-opaque-key',
          Buffer.from(JSON.stringify({ events: [] })),
          'invalid-fake-hmac-signature',
          'https://attacker-origin.example.com'
        )
      ).rejects.toThrow('Invalid x-line-signature header');

      // Spoofed origin must NOT be active
      expect(getActiveAppOrigin()).toBeNull();
    });
  });

  // =========================================================================
  // AC-2: PERF-04 LINE Webhook Transaction Isolation
  // =========================================================================
  describe('AC-2: PERF-04 LINE Webhook Profile Fetch Outside Transaction', () => {
    it('pre-fetches external LINE profiles outside prisma.$transaction block', async () => {
      const secret = 'valid-secret-456';
      const bodyBuffer = Buffer.from(JSON.stringify({
        events: [
          {
            type: 'message',
            webhookEventId: 'evt-001',
            timestamp: Date.now(),
            source: { userId: 'line-user-123' },
            message: { type: 'text', text: 'สวัสดี' }
          }
        ]
      }));
      const signature = createLineSignature(bodyBuffer, secret);

      const mockAdapter = new MockLinePlatformAdapter();
      const getProfileSpy = vi.spyOn(mockAdapter, 'getProfile').mockResolvedValue({
        displayName: 'Test Tenant',
        pictureUrl: 'https://example.com/pic.jpg'
      });

      let profileCalledInsideTx = false;
      const mockPrisma: any = {
        $queryRaw: vi.fn().mockResolvedValue([
          { config_id: 'cfg-1', dormitory_id: 'dorm-101' }
        ]),
        dormitoryLineConfig: {
          findUnique: vi.fn().mockResolvedValue({
            channelSecretEncrypted: encryptText(secret),
            channelAccessTokenEncrypted: encryptText('token-123'),
            accessTokenVerifiedAt: new Date(),
            webhookEndpointSetAt: new Date(),
            isConnected: true,
            webhookVerifiedAt: new Date(),
            id: 'cfg-1'
          }),
          update: vi.fn().mockResolvedValue({})
        },
        $transaction: vi.fn().mockImplementation(async (callback) => {
          // If getProfile had not been called yet when $transaction started, it would be called inside tx
          if (getProfileSpy.mock.calls.length === 0) {
            profileCalledInsideTx = true;
          }
          const mockTx: any = {
            $executeRaw: vi.fn().mockResolvedValue(1),
            dormitoryLineConfig: { update: vi.fn().mockResolvedValue({}) },
            lineWebhookEventReceipt: {
              create: vi.fn().mockResolvedValue({ id: 'rec-1' }),
              update: vi.fn().mockResolvedValue({ id: 'rec-1' })
            },
            dormitory: { findUnique: vi.fn().mockResolvedValue({ name: 'Dorm Name' }) },
            dormitoryAccessGrant: { findFirst: vi.fn().mockResolvedValue(null) },
            dormitoryMember: { findFirst: vi.fn().mockResolvedValue(null) },
            dormitoryLineFriend: {
              findUnique: vi.fn().mockResolvedValue(null),
              create: vi.fn().mockResolvedValue({ id: 'fr-1' }),
              update: vi.fn().mockResolvedValue({ id: 'fr-1' })
            },
            friend: { upsert: vi.fn().mockResolvedValue({ id: 'fr-1' }) }
          };
          return await callback(mockTx);
        })
      };

      const lineOaService = new LineOaService(mockPrisma, mockAdapter);

      await lineOaService.processWebhookEvent('valid-key', bodyBuffer, signature);

      // Verify that getProfile was called outside the transaction
      expect(getProfileSpy).toHaveBeenCalledWith('line-user-123', 'token-123');
      expect(profileCalledInsideTx).toBe(false);
    });
  });

  // =========================================================================
  // AC-3: PERF-04 LINE Adapter Outbound Fetch Timeout
  // =========================================================================
  describe('AC-3: PERF-04 LINE Platform Adapter Outbound Fetch Timeout', () => {
    it('HttpLinePlatformAdapter passes AbortSignal.timeout to outbound fetch calls', async () => {
      const adapter = new HttpLinePlatformAdapter('https://mock-api.line.me');

      let capturedSignal: AbortSignal | undefined;
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        capturedSignal = init?.signal as AbortSignal;
        return new Response(JSON.stringify({ userId: 'u1', basicId: '@bot' }), { status: 200 });
      });

      const result = await adapter.verifyAccessToken('test-token');
      expect(result.verified).toBe(true);
      expect(fetchSpy).toHaveBeenCalled();
      expect(capturedSignal).toBeDefined();
    });

    it('HttpLinePlatformAdapter handles network timeout error cleanly without unhandled rejection', async () => {
      const adapter = new HttpLinePlatformAdapter('https://mock-api.line.me');

      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new DOMException('The operation was aborted', 'AbortError'));

      const result = await adapter.verifyAccessToken('test-token');
      expect(result.verified).toBe(false);

      const profile = await adapter.getProfile('line-user-1', 'test-token');
      expect(profile).toBeNull();
    });
  });

  // =========================================================================
  // AC-4: PERF-13 Atomic Optimistic Locking in Bill Repository
  // =========================================================================
  describe('AC-4: PERF-13 Atomic Optimistic Locking in Bill Repository', () => {
    const validBillUuid = '11111111-1111-4111-8111-111111111111';

    it('updates bill atomically when expectedVersion matches', async () => {
      const mockPrisma: any = {
        bill: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findFirst: vi.fn().mockResolvedValue({
            id: validBillUuid,
            dormitoryId: 'dorm-001',
            status: 'PAID',
            version: 2,
            fineAmount: 0,
            discountAmount: 0,
            totalAmount: 5000,
            paidAmount: 5000,
            outstandingAmount: 0,
            billingDate: new Date(),
            dueDate: new Date(),
            generatedAt: new Date(),
            items: [],
            Payment: []
          })
        }
      };

      const billRepo = new PrismaBillRepository(mockPrisma);
      const updated = await billRepo.update(validBillUuid, 'dorm-001', { status: 'PAID' as any }, 1);

      expect(mockPrisma.bill.updateMany).toHaveBeenCalledWith({
        where: { id: validBillUuid, dormitoryId: 'dorm-001', version: 1 },
        data: expect.objectContaining({
          status: 'PAID',
          version: { increment: 1 }
        })
      });
      expect(updated).toBeDefined();
      expect(updated?.version).toBe(2);
    });

    it('throws RESOURCE_VERSION_CONFLICT atomically when expectedVersion does not match', async () => {
      const mockPrisma: any = {
        bill: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          findFirst: vi.fn().mockResolvedValue({
            id: validBillUuid,
            dormitoryId: 'dorm-001',
            version: 2,
            fineAmount: 0,
            discountAmount: 0,
            totalAmount: 5000,
            paidAmount: 5000,
            outstandingAmount: 0,
            billingDate: new Date(),
            dueDate: new Date(),
            generatedAt: new Date(),
            items: [],
            Payment: []
          })
        }
      };

      const billRepo = new PrismaBillRepository(mockPrisma);
      await expect(
        billRepo.update(validBillUuid, 'dorm-001', { status: 'PAID' as any }, 1)
      ).rejects.toThrow('RESOURCE_VERSION_CONFLICT');
    });

    it('returns null if bill does not exist when expectedVersion is provided', async () => {
      const mockPrisma: any = {
        bill: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          findFirst: vi.fn().mockResolvedValue(null)
        }
      };

      const billRepo = new PrismaBillRepository(mockPrisma);
      const result = await billRepo.update(validBillUuid, 'dorm-001', { status: 'PAID' as any }, 1);
      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // AC-5: RES-04 Rate Limiter Memory Leak Prevention & Pruning
  // =========================================================================
  describe('AC-5: RES-04 InMemoryRateLimiterStore Expiration Pruning', () => {
    it('prunes expired entries across hits, cooldowns, and locks', () => {
      const store = new InMemoryRateLimiterStore();

      store.isAllowed('ip:1.1.1.1', 10, 100);
      store.checkCooldown('user:101', 100);
      store.acquireLock('lock:res:1', 'val-1', 1);

      let sizes = store.getStoreSizes();
      expect(sizes.hits).toBe(1);
      expect(sizes.cooldowns).toBe(1);
      expect(sizes.locks).toBe(1);

      const futureTime = Date.now() + 200;
      store.pruneExpired(futureTime);

      sizes = store.getStoreSizes();
      expect(sizes.hits).toBe(0);
      expect(sizes.cooldowns).toBe(0);
      expect(sizes.locks).toBe(1);

      store.pruneExpired(Date.now() + 1500);
      sizes = store.getStoreSizes();
      expect(sizes.locks).toBe(0);
    });

    it('automatically prunes during regular access when map size grows', () => {
      const store = new InMemoryRateLimiterStore();

      for (let i = 0; i < 120; i++) {
        (store as any).hits.set(`old-key-${i}`, { count: 1, resetTime: Date.now() - 1000 });
      }

      expect(store.getStoreSizes().hits).toBe(120);

      store.isAllowed('new-key', 5, 60000);

      const sizes = store.getStoreSizes();
      expect(sizes.hits).toBe(1);
    });
  });

  // =========================================================================
  // AC-6: ARC-06 Storage Provider Boundary Hardening
  // =========================================================================
  describe('AC-6: ARC-06 LocalStorageProvider Path Traversal & Safety', () => {
    const storage = new LocalStorageProvider();

    it('rejects path traversal attempts with directory traversal errors', () => {
      expect(() => storage.resolveSafePath('../../etc/passwd')).toThrow('PATH_TRAVERSAL_DETECTED');
      expect(() => storage.resolveSafePath('foo/../bar')).toThrow('PATH_TRAVERSAL_DETECTED');
      expect(() => storage.resolveSafePath('foo/..\\bar')).toThrow('PATH_TRAVERSAL_DETECTED');
      expect(() => storage.resolveSafePath('foo/%2e%2e/bar')).toThrow('PATH_TRAVERSAL_DETECTED');
      expect(() => storage.resolveSafePath('foo\0bar')).toThrow('INVALID_OBJECT_KEY');
    });

    it('rejects absolute paths', () => {
      expect(() => storage.resolveSafePath('/etc/passwd')).toThrow('ABSOLUTE_PATH_REJECTED');
      expect(() => storage.resolveSafePath('C:\\Windows\\system32')).toThrow('ABSOLUTE_PATH_REJECTED');
    });

    it('resolves valid relative object keys safely', () => {
      const safePath = storage.resolveSafePath('payments/dorm-001/bill-001/slip-123.jpg');
      expect(safePath).toContain('slip-123.jpg');
      expect(safePath).not.toContain('..');
    });
  });
});
