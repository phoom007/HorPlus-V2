import { describe, it, expect, vi, beforeAll } from 'vitest';
import sharp from 'sharp';
import { Decimal } from 'decimal.js';
import {
  normalizeThaiName,
  isSmartRecipientNameMatch,
  SlipOkPaymentEvidenceVerifier,
} from '../../integrations/payment-verification/slipok-adapter';
import { PaymentService } from '../../services/payment.service';
import { AppError } from '../../errors/AppError';

describe('Card B3: SlipOK Verification and Manual Override Logic', () => {
  let sampleSlipBuffer: Buffer;

  beforeAll(async () => {
    // Generate valid dummy 200x200 JPEG to satisfy Sharp image verification
    sampleSlipBuffer = await sharp({
      create: {
        width: 200,
        height: 200,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .jpeg()
      .toBuffer();
  });

  describe('Smart Recipient Name Matching (AC B3-1 / PO Requirements)', () => {
    it('normalizes Thai prefixes, whitespaces, and punctuation properly', () => {
      expect(normalizeThaiName('นางสาว ภูวนาท ทานาลาด')).toBe('ภูวนาท ทานาลาด');
      expect(normalizeThaiName('น.ส. ภูวนาท ทานาลาด')).toBe('ภูวนาท ทานาลาด');
      expect(normalizeThaiName('นาย สมชาย ใจดี')).toBe('สมชาย ใจดี');
      expect(normalizeThaiName('นาง สมศรี มีสุข')).toBe('สมศรี มีสุข');
      expect(normalizeThaiName('MR. SOMCHAI JAIDEE')).toBe('somchai jaidee');
    });

    it('matches exact full name with different prefixes', () => {
      const match = isSmartRecipientNameMatch(
        'นางสาว ภูวนาท ทานาลาด',
        'น.ส.ภูวนาท ทานาลาด'
      );
      expect(match).toBe(true);
    });

    it('matches abbreviated Thai surnames on bank slips (e.g. ภูวนาท ท vs ภูวนาท ทานาลาด)', () => {
      // Slip has abbreviated surname "ภูวนาท ท"
      expect(
        isSmartRecipientNameMatch('ภูวนาท ท', 'นางสาว ภูวนาท ทานาลาด')
      ).toBe(true);

      // System has abbreviated or slip has full
      expect(
        isSmartRecipientNameMatch('นางสาว ภูวนาท ทานาลาด', 'ภูวนาท ท.')
      ).toBe(true);

      // First name match with initial of last name (including vowel-led surnames)
      expect(
        isSmartRecipientNameMatch('นาย สมชาย จ.', 'สมชาย ใจดี')
      ).toBe(true);
    });

    it('rejects completely different recipient names', () => {
      expect(
        isSmartRecipientNameMatch('สมชาย ใจดี', 'วิชัย รุ่งเรือง')
      ).toBe(false);

      expect(
        isSmartRecipientNameMatch('ภูวนาท ทานาลาด', 'กิตติศักดิ์ เจริญ')
      ).toBe(false);
    });
  });

  describe('SlipOK Provider Fallbacks (AC B3-1, B3-3, Fallback Rules)', () => {
    it('handles quota exhaustion by falling back to UNVERIFIED without crashing', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          code: 1009,
          message: 'Quota exceeded',
        }),
      });

      const verifier = new SlipOkPaymentEvidenceVerifier({
        branchId: 'test-branch',
        apiKey: 'test-key',
        fetchFn: mockFetch as any,
        prismaClient: {
          dormitoryBillingSettings: {
            findFirst: vi.fn().mockResolvedValue({
              promptPayAccountName: 'สมชาย ใจดี',
            }),
          },
          paymentEvidenceVerification: {
            findFirst: vi.fn().mockResolvedValue(null),
          },
        },
      });

      const result = await verifier.verify({
        dormitoryId: 'dorm-1',
        evidenceBuffer: sampleSlipBuffer,
        expectedAmount: new Decimal(3500),
      });

      expect(result.status).toBe('UNVERIFIED');
      expect(result.errorReason).toContain('โควตา');
    });

    it('handles SlipOK outage with ERROR status and Thai advice to re-attach', async () => {
      const mockFetch = vi.fn().mockRejectedValue(
        new Error('Network connection timeout')
      );

      const verifier = new SlipOkPaymentEvidenceVerifier({
        branchId: 'test-branch',
        apiKey: 'test-key',
        fetchFn: mockFetch as any,
        prismaClient: {
          dormitoryBillingSettings: {
            findFirst: vi.fn().mockResolvedValue({
              promptPayAccountName: 'สมชาย ใจดี',
            }),
          },
          paymentEvidenceVerification: {
            findFirst: vi.fn().mockResolvedValue(null),
          },
        },
      });

      const result = await verifier.verify({
        dormitoryId: 'dorm-1',
        evidenceBuffer: sampleSlipBuffer,
        expectedAmount: new Decimal(3500),
      });

      expect(result.status).toBe('ERROR');
      expect(result.errorReason).toContain('แนบสลิปใหม่อีกครั้ง');
    });

    it('detects amount discrepancy (discrepancy > 0) and rejects', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            transRef: 'TR12345678',
            amount: 3000, // Expected 3500
            receiver: {
              name: 'นาย สมชาย ใจดี',
            },
          },
        }),
      });

      const verifier = new SlipOkPaymentEvidenceVerifier({
        branchId: 'test-branch',
        apiKey: 'test-key',
        fetchFn: mockFetch as any,
        prismaClient: {
          dormitoryBillingSettings: {
            findFirst: vi.fn().mockResolvedValue({
              promptPayAccountName: 'สมชาย ใจดี',
            }),
          },
          paymentEvidenceVerification: {
            findFirst: vi.fn().mockResolvedValue(null),
          },
        },
      });

      const result = await verifier.verify({
        dormitoryId: 'dorm-1',
        evidenceBuffer: sampleSlipBuffer,
        expectedAmount: new Decimal(3500),
      });

      expect(result.status).toBe('REJECTED');
      expect(result.errorReason).toContain('AMOUNT_MISMATCH');
    });
  });

  describe('Duplicate Slip Prevention (AC B3-2)', () => {
    it('rejects duplicate slip if fileHash already exists in Payment table', async () => {
      const mockPrisma: any = {
        $transaction: vi.fn().mockImplementation(async (callback) => {
          return callback({
            $executeRaw: vi.fn().mockResolvedValue(1),
            paymentUploadIntent: {
              findUnique: vi.fn().mockResolvedValue({
                id: 'intent-1',
                sha256: 'sha256-existing-hash',
                objectKey: 'slips/test.jpg',
                status: 'UPLOADED',
                authenticatedUserId: 'user-1',
                tenantId: 'tenant-1',
                billId: 'bill-1',
                bill: { id: 'bill-1' },
                expiresAt: new Date(Date.now() + 60000),
              }),
            },
            bill: {
              findUnique: vi.fn().mockResolvedValue({
                id: 'bill-1',
                status: 'UNPAID',
                outstandingAmount: new Decimal(3500),
                totalAmount: new Decimal(3500),
                paidAmount: new Decimal(0),
                items: [],
              }),
            },
            payment: {
              findFirst: vi
                .fn()
                .mockResolvedValueOnce(null) // active payment check
                .mockResolvedValueOnce({
                  id: 'existing-payment-id',
                  fileHash: 'sha256-existing-hash',
                  status: 'APPROVED',
                }), // duplicate payment check
            },
            paymentEvidenceVerification: {
              findFirst: vi.fn().mockResolvedValue(null),
            },
          });
        }),
      };

      const paymentService = new PaymentService(mockPrisma);

      await expect(
        paymentService.submitSlip({
          intentId: 'intent-1',
          dormitoryId: 'dorm-1',
          tenantId: 'tenant-1',
          actorUserId: 'user-1',
          amount: 3500,
          paymentDate: new Date(),
        })
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 409,
          code: 'DUPLICATE_PAYMENT_EVIDENCE',
        })
      );
    });

    it('rejects duplicate slip if SlipOK transRef already exists in database', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            transRef: 'TR-EXISTING-REF',
            amount: 3500,
            receiver: {
              name: 'นาย สมชาย ใจดี',
            },
          },
        }),
      });

      const mockPrisma: any = {
        paymentEvidenceVerification: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'existing-verification-id',
            providerReference: 'TR-EXISTING-REF',
          }),
        },
        dormitoryBillingSettings: {
          findFirst: vi.fn().mockResolvedValue({
            promptPayAccountName: 'สมชาย ใจดี',
          }),
        },
      };

      const verifier = new SlipOkPaymentEvidenceVerifier({
        branchId: 'test-branch',
        apiKey: 'test-key',
        fetchFn: mockFetch as any,
        prismaClient: mockPrisma,
      });

      const result = await verifier.verify({
        dormitoryId: 'dorm-1',
        evidenceBuffer: sampleSlipBuffer,
        expectedAmount: new Decimal(3500),
      });

      expect(result.status).toBe('REJECTED');
      expect(result.errorReason).toContain('สลิปนี้เคยถูกส่งตรวจสอบไปแล้ว');
    });
  });

  describe('Mandatory Override Reason on Non-VERIFIED or REJECTED Payments (AC B3-4)', () => {
    it('requires overrideReason when approving REJECTED payment', async () => {
      const mockPrisma: any = {
        $transaction: vi.fn().mockImplementation(async (callback) => {
          const tx = {
            $executeRaw: vi.fn().mockResolvedValue(1),
            payment: {
              findUnique: vi.fn().mockResolvedValue({
                id: 'pay-rejected',
                dormitoryId: 'dorm-1',
                billId: 'bill-1',
                status: 'REJECTED',
                method: 'PROMPTPAY',
                rejectedReason: 'ยอดเงินไม่ตรง',
              }),
            },
            paymentEvidenceVerification: {
              findFirst: vi.fn().mockResolvedValue({
                id: 'ver-1',
                status: 'REJECTED',
              }),
            },
          };
          return callback(tx);
        }),
      };

      const paymentService = new PaymentService(mockPrisma);

      // Attempt approve without reason
      await expect(
        paymentService.approvePayment({
          paymentId: 'pay-rejected',
          dormitoryId: 'dorm-1',
          userId: 'owner-1',
        })
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 400,
          code: 'OVERRIDE_REASON_REQUIRED',
        })
      );

      // Attempt approve with empty/whitespace reason
      await expect(
        paymentService.approvePayment({
          paymentId: 'pay-rejected',
          dormitoryId: 'dorm-1',
          userId: 'owner-1',
          overrideReason: '   ',
        })
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 400,
          code: 'OVERRIDE_REASON_REQUIRED',
        })
      );
    });

    it('requires overrideReason when approving PENDING / UNVERIFIED payment', async () => {
      const mockPrisma: any = {
        $transaction: vi.fn().mockImplementation(async (callback) => {
          const tx = {
            $executeRaw: vi.fn().mockResolvedValue(1),
            payment: {
              findUnique: vi.fn().mockResolvedValue({
                id: 'pay-pending',
                dormitoryId: 'dorm-1',
                billId: 'bill-1',
                status: 'PENDING',
                method: 'PROMPTPAY',
              }),
            },
            paymentEvidenceVerification: {
              findFirst: vi.fn().mockResolvedValue({
                id: 'ver-1',
                status: 'UNVERIFIED',
              }),
            },
          };
          return callback(tx);
        }),
      };

      const paymentService = new PaymentService(mockPrisma);

      await expect(
        paymentService.approvePayment({
          paymentId: 'pay-pending',
          dormitoryId: 'dorm-1',
          userId: 'owner-1',
        })
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 400,
          code: 'OVERRIDE_REASON_REQUIRED',
        })
      );
    });
  });

  describe('Idempotency of Slip Approval (AC B3-5)', () => {
    it('returns existing payment and does not re-generate receipt if already approved', async () => {
      const mockPrisma: any = {
        $transaction: vi.fn().mockImplementation(async (callback) => {
          const tx = {
            $executeRaw: vi.fn().mockResolvedValue(1),
            payment: {
              findUnique: vi.fn().mockResolvedValue({
                id: 'pay-already-approved',
                dormitoryId: 'dorm-1',
                billId: 'bill-1',
                status: 'APPROVED',
                amount: 3500,
                method: 'PROMPTPAY',
              }),
            },
            receipt: {
              findFirst: vi.fn().mockResolvedValue({
                id: 'receipt-1',
                receiptNumber: 'RC-202609-001',
              }),
            },
          };
          return callback(tx);
        }),
      };

      const paymentService = new PaymentService(mockPrisma);

      const result = await paymentService.approvePayment({
        paymentId: 'pay-already-approved',
        dormitoryId: 'dorm-1',
        userId: 'owner-1',
      });
      expect(result.status).toBe('APPROVED');
    });
  });
});
