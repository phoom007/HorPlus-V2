/**
 * @license Apache-2.0
 * Subscription Slip Verifier & Promo Code Unit Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import sharp from 'sharp';
import { Prisma } from '@prisma/client';
import { subscriptionSlipVerifier } from '../../integrations/payment-verification/subscription-slip-verifier.js';
import { promoService } from '../../services/promo.service.js';
import { CANONICAL_SUBSCRIPTION_CATALOG } from '../../config/subscription-catalog.js';

describe('Subscription Slip Verifier & Promo Code Tests', () => {
  beforeEach(() => {
    // Stub Prisma duplicate checks so unit tests run cleanly without live DB dependency
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

  it('should have locked catalog with only HORPLUS and HNY2027 promo codes', () => {
    const promoCodes = CANONICAL_SUBSCRIPTION_CATALOG.promoCodes || [];
    const codes = promoCodes.map((p) => p.code);
    expect(codes).toContain('HORPLUS');
    expect(codes).toContain('HNY2027');
    expect(codes).not.toContain('START30');

    const hny = promoCodes.find((p) => p.code === 'HNY2027');
    expect(hny).toBeDefined();
    expect(hny?.benefitType).toBe('PERCENT_DISCOUNT');
    expect(hny?.benefitValue).toBe(10);
    expect(hny?.globalMaxRedemptions).toBe(50);
  });

  it('should reject invalid or non-image slip buffers', async () => {
    const invalidBuffer = Buffer.from('not-an-image');
    await expect(
      subscriptionSlipVerifier.verify({
        slipBuffer: invalidBuffer,
        expectedAmount: new Prisma.Decimal(1799),
        dormitoryId: '00000000-0000-0000-0000-000000000001',
        userId: '00000000-0000-0000-0000-000000000002',
      })
    ).rejects.toThrow('ไฟล์รูปภาพสลิปไม่ถูกต้องหรือเสียหาย');
  });

  it('should successfully verify slip through SlipOK mock when 3 dimensions pass', async () => {
    const validPngBuffer = await sharp({
      create: {
        width: 400,
        height: 600,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    // Mock SlipOK successful response
    const mockSuccessResponse = {
      success: true,
      data: {
        success: true,
        transRef: `TX-TEST-${Date.now()}`,
        date: '2026-09-12T13:00:00+07:00',
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
    };

    subscriptionSlipVerifier.setFetchFnForTesting(async () => {
      return new Response(JSON.stringify(mockSuccessResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const result = await subscriptionSlipVerifier.verify({
      slipBuffer: validPngBuffer,
      expectedAmount: new Prisma.Decimal(1799),
      dormitoryId: '00000000-0000-0000-0000-000000000001',
      userId: '00000000-0000-0000-0000-000000000002',
    });

    expect(result.success).toBe(true);
    expect(result.provider).toBe('SLIPOK');
    expect(result.payloadHash).toBeDefined();
    expect(result.payloadHash.length).toBe(64);
    expect(result.verifiedAmount.equals(new Prisma.Decimal(1799))).toBe(true);
    expect(result.providerReference).toBe(mockSuccessResponse.data.transRef);
  });

  it('should reject when SlipOK reports amount mismatch (Dimension 1)', async () => {
    const validPngBuffer = await sharp({
      create: {
        width: 400,
        height: 600,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    const mockAmountMismatchResponse = {
      success: true,
      data: {
        transRef: `TX-MISMATCH-${Date.now()}`,
        amount: 100, // Transferred 100 but expected 1799
        receiver: {
          account: {
            proxy: { type: 'MSISDN', value: '0935098808' },
          },
        },
      },
    };

    subscriptionSlipVerifier.setFetchFnForTesting(async () => {
      return new Response(JSON.stringify(mockAmountMismatchResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    await expect(
      subscriptionSlipVerifier.verify({
        slipBuffer: validPngBuffer,
        expectedAmount: new Prisma.Decimal(1799),
        dormitoryId: '00000000-0000-0000-0000-000000000001',
        userId: '00000000-0000-0000-0000-000000000002',
      })
    ).rejects.toThrow('ยอดเงินในสลิป (฿100) ไม่ตรงกับยอดแพ็กเกจที่ต้องชำระ (฿1,799)');
  });

  it('should reject when SlipOK reports receiver mismatch (Dimension 2)', async () => {
    const validPngBuffer = await sharp({
      create: {
        width: 400,
        height: 600,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    const mockReceiverMismatchResponse = {
      success: true,
      data: {
        transRef: `TX-OTHER-RECEIVER-${Date.now()}`,
        amount: 1799,
        receiver: {
          account: {
            name: { th: 'ร้านกาแฟ อร่อยดี', en: 'COFFEE SHOP' },
            proxy: { type: 'MSISDN', value: '0812345678' }, // Other promptpay
          },
        },
      },
    };

    subscriptionSlipVerifier.setFetchFnForTesting(async () => {
      return new Response(JSON.stringify(mockReceiverMismatchResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    await expect(
      subscriptionSlipVerifier.verify({
        slipBuffer: validPngBuffer,
        expectedAmount: new Prisma.Decimal(1799),
        dormitoryId: '00000000-0000-0000-0000-000000000001',
        userId: '00000000-0000-0000-0000-000000000002',
      })
    ).rejects.toThrow('บัญชีผู้รับเงินในสลิปไม่ตรงกับบัญชีของระบบ HorPlus');
  });

  it('should map SlipOK error codes correctly (e.g. 1004 QR not found)', async () => {
    const validPngBuffer = await sharp({
      create: {
        width: 400,
        height: 600,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    const mockQrNotFoundResponse = {
      success: false,
      code: 1004,
      message: 'QR code not found',
    };

    subscriptionSlipVerifier.setFetchFnForTesting(async () => {
      return new Response(JSON.stringify(mockQrNotFoundResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    await expect(
      subscriptionSlipVerifier.verify({
        slipBuffer: validPngBuffer,
        expectedAmount: new Prisma.Decimal(1799),
        dormitoryId: '00000000-0000-0000-0000-000000000001',
        userId: '00000000-0000-0000-0000-000000000002',
      })
    ).rejects.toThrow('ไม่พบ QR Code ในภาพสลิป หรือรูปภาพสลิปไม่ชัดเจน กรุณาแนบภาพสลิปใหม่ (QR_NOT_FOUND)');

    // Reset fetch fn
    subscriptionSlipVerifier.setFetchFnForTesting(null);
  });

  it('should reject duplicate slip when payload SHA-256 hash already exists', async () => {
    const validPngBuffer = await sharp({
      create: {
        width: 400,
        height: 600,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    // Mock existing evidence in DB
    (subscriptionSlipVerifier as any).prisma.subscriptionPaymentEvidence.findUnique = async () => ({
      id: 'existing-sub-evidence-id',
    });

    await expect(
      subscriptionSlipVerifier.verify({
        slipBuffer: validPngBuffer,
        expectedAmount: new Prisma.Decimal(1799),
        dormitoryId: '00000000-0000-0000-0000-000000000001',
        userId: '00000000-0000-0000-0000-000000000002',
      })
    ).rejects.toThrow('สลิปนี้เคยถูกใช้งานไปแล้วในระบบ (สลิปซ้ำ / DUPLICATE_SUBSCRIPTION_SLIP)');
  });

  it('should reject duplicate slip when bank transRef already exists in database', async () => {
    const validPngBuffer = await sharp({
      create: {
        width: 400,
        height: 600,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    const mockDuplicateTransRefResponse = {
      success: true,
      data: {
        transRef: 'TX-ALREADY-USED-12345',
        amount: 1799,
        receiver: {
          account: {
            name: { th: 'นายภูวนาท ทานาลาด', en: 'PHUWANAT' },
            proxy: { type: 'MSISDN', value: '0935098808' },
          },
        },
      },
    };

    subscriptionSlipVerifier.setFetchFnForTesting(async () => {
      return new Response(JSON.stringify(mockDuplicateTransRefResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    // Mock transRef already exists in PaymentEvidenceVerification
    (subscriptionSlipVerifier as any).prisma.paymentEvidenceVerification.findFirst = async (args: any) => {
      if (args?.where?.providerReference === 'TX-ALREADY-USED-12345') {
        return {
          id: 'existing-verification-id',
          providerReference: 'TX-ALREADY-USED-12345',
        };
      }
      return null;
    };

    await expect(
      subscriptionSlipVerifier.verify({
        slipBuffer: validPngBuffer,
        expectedAmount: new Prisma.Decimal(1799),
        dormitoryId: '00000000-0000-0000-0000-000000000001',
        userId: '00000000-0000-0000-0000-000000000002',
      })
    ).rejects.toThrow('สลิปนี้เคยถูกใช้งานไปแล้วในระบบ (รหัสอ้างอิงธุรกรรมธนาคาร TX-ALREADY-USED-12345 ซ้ำ)');

    subscriptionSlipVerifier.setFetchFnForTesting(null);
  });
});


