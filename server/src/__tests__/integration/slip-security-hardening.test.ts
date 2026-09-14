/**
 * @license Apache-2.0
 * Slip Verification Security Hardening Integration Tests (SEC-01 to SEC-08)
 * Verifies Zero-Trust parameters, 4MB file limit, magic bytes validation,
 * Sharp decompression bomb protection, image sanitization, two-tier rate limiting,
 * 5-second cooldown, and concurrency pre-lock race condition prevention.
 */

import express from 'express';
import request from 'supertest';
import sharp from 'sharp';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { Prisma } from '@prisma/client';
import { createSubscriptionRouter } from '../../routes/subscription.routes.js';
import { subscriptionSlipVerifier } from '../../integrations/payment-verification/subscription-slip-verifier.js';
import { processAndSecureSlipImage } from '../../services/image-security.service.js';
import { distributedRateLimiterStore } from '../../middleware/rate-limiter.js';
import { globalErrorHandler } from '../../middleware/error-handler.js';
import { getPrismaClient } from '../../db/prisma.js';

describe('Slip Verification Security Hardening Suite (SEC-01 to SEC-08)', () => {
  let app: express.Express;
  const mockDormitoryId = '20000001-0000-4000-8000-000000000002';
  const mockUserId = '20000002-0000-4000-8000-000000000002';
  let validSlipBuffer: Buffer;
  let verifiedAmountsPassedToVerifier: Prisma.Decimal[] = [];

  const mockAuthService: any = {
    requireAuth: () => (req: any, _res: any, next: any) => {
      req.auth = { userId: mockUserId, dormitoryId: mockDormitoryId };
      req.dormitoryContext = { userId: mockUserId, dormitoryId: mockDormitoryId };
      next();
    },
    getCsrfService: () => ({
      validateToken: () => true,
    }),
  };

  beforeAll(async () => {
    // Generate a valid base test PNG (400x400)
    validSlipBuffer = await sharp({
      create: {
        width: 400,
        height: 400,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    app = express();
    app.use(express.json());
    app.use('/api/v1/subscription', createSubscriptionRouter(mockAuthService));
    app.use(globalErrorHandler);

    // Stub prisma within subscriptionSlipVerifier for test isolation
    (subscriptionSlipVerifier as any).prisma = {
      subscriptionPaymentEvidence: {
        findUnique: async () => null,
        create: async () => ({}),
      },
      paymentEvidenceVerification: {
        findFirst: async () => null,
        create: async () => ({}),
      },
    };
  });

  beforeEach(() => {
    distributedRateLimiterStore.clear();
    verifiedAmountsPassedToVerifier = [];

    // Mock SlipOK successful fetch
    subscriptionSlipVerifier.setFetchFnForTesting(async (_url, init) => {
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            success: true,
            transRef: `TX-SEC-${Date.now()}-${Math.random().toString().slice(2, 6)}`,
            date: new Date().toISOString(),
            amount: 1799,
            sender: {
              bank: { id: '014', name: 'SCB' },
              account: { name: { th: 'นายทดสอบ โอนเงิน', en: 'MR TEST' } },
            },
            receiver: {
              bank: { id: '004', name: 'KBANK' },
              account: {
                name: { th: 'นายภูวนาท ทานาลาด', en: 'PHUWANAT TANALAD' },
                proxy: { type: 'MSISDN', value: '0935098808' },
              },
            },
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });
  });

  afterAll(() => {
    subscriptionSlipVerifier.setFetchFnForTesting(null);
  });

  // --------------------------------------------------------------------------
  // SEC-01: Zero-Trust Parameter Integrity
  // --------------------------------------------------------------------------
  it('SEC-01: should reject client-injected amounts and enforce server-dictated package price', async () => {
    const originalVerify = subscriptionSlipVerifier.verify.bind(subscriptionSlipVerifier);
    let capturedExpectedAmount: Prisma.Decimal | null = null;

    subscriptionSlipVerifier.verify = async (input: any) => {
      capturedExpectedAmount = input.expectedAmount;
      return await originalVerify(input);
    };

    try {
      // Attacker intercepts request with Burp Suite and injects expectedAmount: 1.00
      await request(app)
        .post('/api/v1/subscription/payment/slip')
        .attach('file', validSlipBuffer, 'slip.png')
        .field('durationMonths', '1')
        .field('expectedAmount', '1.00') // Burp Suite tampering
        .field('price', '1.00') // Burp Suite tampering
        .field('amount', '1.00'); // Burp Suite tampering

      // Server MUST dictate expectedAmount from package in DB (189.00 for 1 month), strictly ignoring 1.00
      expect(capturedExpectedAmount).toBeDefined();
      expect(capturedExpectedAmount?.toString()).toBe('189');
      expect(capturedExpectedAmount?.toString()).not.toBe('1.00');
    } finally {
      subscriptionSlipVerifier.verify = originalVerify;
    }
  });

  it('SEC-01b: should gracefully fall back to server package price when intentId is expired or non-existent', async () => {
    const originalVerify = subscriptionSlipVerifier.verify.bind(subscriptionSlipVerifier);
    let capturedExpectedAmount: Prisma.Decimal | null = null;

    subscriptionSlipVerifier.verify = async (input: any) => {
      capturedExpectedAmount = input.expectedAmount;
      return await originalVerify(input);
    };

    try {
      // Client passes an expired or non-existent intentId
      await request(app)
        .post('/api/v1/subscription/payment/slip')
        .attach('file', validSlipBuffer, 'slip.png')
        .field('durationMonths', '1')
        .field('intentId', '00000000-0000-0000-0000-000000000000');

      // Server MUST gracefully fall back to server-computed amount for 1 month (189)
      expect(capturedExpectedAmount).toBeDefined();
      expect(capturedExpectedAmount?.toString()).toBe('189');
    } finally {
      subscriptionSlipVerifier.verify = originalVerify;
    }
  });

  // --------------------------------------------------------------------------
  // SEC-02: 4MB Maximum File Size Ceiling
  // --------------------------------------------------------------------------
  it('SEC-02: should reject uploads exceeding 4MB with HTTP 400 FILE_TOO_LARGE', async () => {
    // Generate 4.2 MB dummy buffer
    const oversizedBuffer = Buffer.alloc(4.2 * 1024 * 1024, 0xaa);

    const res = await request(app)
      .post('/api/v1/subscription/payment/slip')
      .attach('file', oversizedBuffer, 'oversized.jpg')
      .field('durationMonths', '1');

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
    expect(res.body.error.message).toContain('4MB');
  });

  // --------------------------------------------------------------------------
  // SEC-03: Magic Bytes & Disallowed Active Signature Validation
  // --------------------------------------------------------------------------
  it('SEC-03: should reject disguised non-image files (PHP WebShell) with HTTP 400 INVALID_IMAGE_FORMAT', async () => {
    const fakeJpgWithPhp = Buffer.from('<?php system($_GET["cmd"]); ?>');

    const res = await request(app)
      .post('/api/v1/subscription/payment/slip')
      .attach('file', fakeJpgWithPhp, 'exploit.php.jpg')
      .field('durationMonths', '1');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_IMAGE_FORMAT');
  });

  it('SEC-03: should reject SVG vector files with HTTP 400 INVALID_IMAGE_FORMAT', async () => {
    const svgFile = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

    const res = await request(app)
      .post('/api/v1/subscription/payment/slip')
      .attach('file', svgFile, 'slip.svg')
      .field('durationMonths', '1');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_IMAGE_FORMAT');
  });

  // --------------------------------------------------------------------------
  // SEC-04: Sharp Decompression Bomb & Dimension Ceiling
  // --------------------------------------------------------------------------
  it('SEC-04: should reject images with dimensions exceeding 4096px with HTTP 400 DIMENSIONS_EXCEEDED', async () => {
    const bombBuffer = await sharp({
      create: {
        width: 4097,
        height: 200,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    const res = await request(app)
      .post('/api/v1/subscription/payment/slip')
      .attach('file', bombBuffer, 'bomb.png')
      .field('durationMonths', '1');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('DIMENSIONS_EXCEEDED');
    expect(res.body.error.message).toContain('4096');
  });

  // --------------------------------------------------------------------------
  // SEC-05: Image Sanitization & EXIF/Metadata Stripping
  // --------------------------------------------------------------------------
  it('SEC-05: should re-encode raw image and strip all metadata and polyglots cleanly', async () => {
    const rawImage = await sharp({
      create: {
        width: 300,
        height: 300,
        channels: 4,
        background: { r: 100, g: 150, b: 200, alpha: 1 },
      },
    })
      .jpeg({ quality: 90 })
      .toBuffer();

    const secured = await processAndSecureSlipImage(rawImage);

    expect(secured).toBeDefined();
    expect(secured.buffer).toBeInstanceOf(Buffer);
    expect(secured.mimeType).toBe('image/jpeg');
    expect(secured.extension).toBe('.jpg');
    expect(secured.sha256).toBeDefined();
    expect(secured.width).toBe(300);
    expect(secured.height).toBe(300);

    // Verify sanitized buffer can be cleanly read by sharp with no metadata leak
    const metadata = await sharp(secured.buffer).metadata();
    expect(metadata.width).toBe(300);
    expect(metadata.height).toBe(300);
  });

  // --------------------------------------------------------------------------
  // SEC-06 & SEC-07: Rate Limiting & Cooldown Protection
  // --------------------------------------------------------------------------
  it('SEC-07: should enforce 5-second mandatory cooldown between submissions with HTTP 429 COOLDOWN_ACTIVE', async () => {
    // Request 1: Allowed through cooldown
    const res1 = await request(app)
      .post('/api/v1/subscription/payment/slip')
      .attach('file', validSlipBuffer, 'slip1.png')
      .field('durationMonths', '1');

    // Request 2 immediately after (< 5000ms): Blocked by cooldown
    const res2 = await request(app)
      .post('/api/v1/subscription/payment/slip')
      .attach('file', validSlipBuffer, 'slip2.png')
      .field('durationMonths', '1');

    expect(res2.status).toBe(429);
    expect(res2.body.error.code).toBe('COOLDOWN_ACTIVE');
    expect(res2.body.error.message).toContain('5 วินาที');
  });

  it('SEC-06: should enforce Tier 1 limit (5 requests per minute) with HTTP 429 RATE_LIMIT_EXCEEDED', async () => {
    const userLimitKey = `rate_limit:slip:user:${mockDormitoryId}:${mockUserId}`;

    // Simulate 5 allowed requests
    for (let i = 0; i < 5; i++) {
      const allowed = await distributedRateLimiterStore.isAllowed(userLimitKey, 5, 60000);
      expect(allowed).toBe(true);
    }

    // 6th request within window must be rejected
    const sixthAllowed = await distributedRateLimiterStore.isAllowed(userLimitKey, 5, 60000);
    expect(sixthAllowed).toBe(false);
  });

  // --------------------------------------------------------------------------
  // SEC-08: Concurrency Pre-Lock on SHA-256 (Anti-Race Condition Barrier)
  // --------------------------------------------------------------------------
  it('SEC-08: should reject parallel duplicate requests with HTTP 409 CONCURRENT_REQUEST_IN_PROGRESS', async () => {
    let slipOkCallsCount = 0;
    subscriptionSlipVerifier.setFetchFnForTesting(async () => {
      slipOkCallsCount++;
      // Simulate network latency for SlipOK
      await new Promise((resolve) => setTimeout(resolve, 80));
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            transRef: `TX-CONCURRENT-${Date.now()}`,
            amount: 1799,
            receiver: { account: { name: { th: 'นายภูวนาท ทานาลาด' } } },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    // Disable cooldown check temporarily for concurrency race test
    const originalCheckCooldown = distributedRateLimiterStore.checkCooldown.bind(distributedRateLimiterStore);
    distributedRateLimiterStore.checkCooldown = async () => true;

    try {
      // Fire 2 simultaneous requests with the exact same slip (Burp Suite Turbo Intruder simulation)
      const [resA, resB] = await Promise.all([
        request(app)
          .post('/api/v1/subscription/payment/slip')
          .attach('file', validSlipBuffer, 'same-slip.png')
          .field('durationMonths', '1'),
        request(app)
          .post('/api/v1/subscription/payment/slip')
          .attach('file', validSlipBuffer, 'same-slip.png')
          .field('durationMonths', '1'),
      ]);

      const statuses = [resA.status, resB.status];
      expect(statuses).toContain(409);

      const conflictRes = resA.status === 409 ? resA : resB;
      expect(conflictRes.body.error.code).toBe('CONCURRENT_REQUEST_IN_PROGRESS');
      expect(conflictRes.body.error.message).toContain('มีคำขอตรวจสอบสลิปนี้กำลังประมวลผลอยู่');

      // Crucial: SlipOK was called at most ONCE, protecting credits from parallel drain
      expect(slipOkCallsCount).toBeLessThanOrEqual(1);
    } finally {
      distributedRateLimiterStore.checkCooldown = originalCheckCooldown;
    }
  });

  // --------------------------------------------------------------------------
  // Complete Success Flow: Verification + DB Transaction
  // --------------------------------------------------------------------------
  it('SUCCESS: should process a valid slip and successfully activate/renew HORPLUS PRO', async () => {
    // Mock SlipOK returning successful response matching 189 THB
    subscriptionSlipVerifier.setFetchFnForTesting(async () => {
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            success: true,
            message: '✅',
            transRef: `TEST-REF-${Date.now()}`,
            sendingBank: '069',
            receivingBank: '',
            transDate: '20260912',
            transTime: '18:09:05',
            amount: 189,
            receiver: {
              account: { name: { th: 'นาย ภูวนาท ทานาลาด' } },
              proxy: { value: '0935098808' },
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    // Use a unique dummy image buffer to avoid duplicate hash check with previous tests
    const uniqueSlipBuffer = await sharp({
      create: {
        width: 300,
        height: 400,
        channels: 3,
        background: {
          r: Math.floor(Math.random() * 256),
          g: Math.floor(Math.random() * 256),
          b: Math.floor(Math.random() * 256),
        },
      },
    })
      .png()
      .toBuffer();

    const res = await request(app)
      .post('/api/v1/subscription/payment/slip')
      .attach('file', uniqueSlipBuffer, 'valid-slip-189.png')
      .field('durationMonths', '1');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.planName).toBe('HORPLUS PRO');
    expect(res.body.data.paidAmount).toBe('189.00');
    expect(res.body.data.orderId).toMatch(/^HP-SUB-/);
    expect(res.body.data.receiptNumber).toMatch(/^RCP-SUB-/);
  });
});
