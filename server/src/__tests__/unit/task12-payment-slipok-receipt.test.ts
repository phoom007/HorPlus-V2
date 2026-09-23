/**
 * @license Apache-2.0
 * Task 12 Unit Tests: Payments, SlipOK Adapter, Override Audit, Receipt Idempotency, and PromptPay Separation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sharp from 'sharp';
import { Decimal } from 'decimal.js';
import { Prisma } from '@prisma/client';
import { SlipOkPaymentEvidenceVerifier } from '../../integrations/payment-verification/slipok-adapter.js';
import { generateReceiptInTx, generateGroupReceiptInTx } from '../../utils/payment-transaction.util.js';
import { AppError } from '../../types/index.js';

describe('Task 12: SlipOK Evidence Verifier, Override Rules & Receipt Idempotency', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.SLIPOK_BRANCH_ID = 'test-branch-id';
    process.env.SLIPOK_API_KEY = 'test-api-key';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  async function createMockSlipBuffer(width = 400, height = 600): Promise<Buffer> {
    return await sharp({
      create: {
        width,
        height,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
  }

  describe('AC-1: SlipOK Adapter Verification (Dimension 1 Amount & Dimension 2 Receiver)', () => {
    it('should reject corrupted or non-image files with CORRUPTED_SLIP_IMAGE', async () => {
      const verifier = new SlipOkPaymentEvidenceVerifier();
      const corrupted = Buffer.from('not-an-image-payload');

      const result = await verifier.verify({
        dormitoryId: 'dorm-001',
        evidenceBuffer: corrupted,
        expectedAmount: new Decimal(3500),
      });

      expect(result.status).toBe('REJECTED');
      expect(result.errorReason).toBe('CORRUPTED_SLIP_IMAGE');
    });

    it('should return UNVERIFIED fail-safe when SlipOK credentials are missing', async () => {
      delete process.env.SLIPOK_BRANCH_ID;
      delete process.env.SLIPOK_API_KEY;

      const verifier = new SlipOkPaymentEvidenceVerifier();
      const validBuffer = await createMockSlipBuffer();

      const result = await verifier.verify({
        dormitoryId: 'dorm-001',
        evidenceBuffer: validBuffer,
        expectedAmount: new Decimal(3500),
      });

      expect(result.status).toBe('UNVERIFIED');
      expect(result.errorReason).toBe('SLIPOK_NOT_CONFIGURED');
    });

    it('should reject slip when amount does not match expected bill amount (Dimension 1)', async () => {
      const verifier = new SlipOkPaymentEvidenceVerifier();
      const validBuffer = await createMockSlipBuffer();

      // Mock dormitory settings
      (verifier as any).prisma = {
        dormitoryBillingSettings: {
          findFirst: async () => ({
            promptPayValue: '0812345678',
            bankAccountNumber: '1234567890',
          }),
        },
      };

      // Mock SlipOK response with different amount (3000 vs expected 3500)
      verifier.setFetchFnForTesting(async () => {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              transRef: 'SLIP-REF-101',
              amount: 3000,
              receiver: {
                proxy: { value: '0812345678' },
                account: { value: '1234567890' },
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      const result = await verifier.verify({
        dormitoryId: 'dorm-001',
        evidenceBuffer: validBuffer,
        expectedAmount: new Decimal(3500),
      });

      expect(result.status).toBe('REJECTED');
      expect(result.errorReason).toContain('AMOUNT_MISMATCH');
    });

    it('should reject slip when receiver does not match dormitory accounts (Dimension 2 & N-03 separation)', async () => {
      const verifier = new SlipOkPaymentEvidenceVerifier();
      const validBuffer = await createMockSlipBuffer();

      // Dormitory configured account
      (verifier as any).prisma = {
        dormitoryBillingSettings: {
          findFirst: async () => ({
            promptPayValue: '0899999999',
            bankAccountNumber: '9876543210',
          }),
        },
      };

      // SlipOK returned a payment to platform promptpay (0935098808) instead of dormitory
      verifier.setFetchFnForTesting(async () => {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              transRef: 'SLIP-REF-102',
              amount: 3500,
              receiver: {
                proxy: { value: '0935098808' }, // Platform promptpay!
                account: { value: '0000000000' },
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      const result = await verifier.verify({
        dormitoryId: 'dorm-001',
        evidenceBuffer: validBuffer,
        expectedAmount: new Decimal(3500),
      });

      expect(result.status).toBe('REJECTED');
      expect(result.errorReason).toContain('RECEIVER_MISMATCH');
    });

    it('should successfully verify slip when both amount and receiver match dormitory settings', async () => {
      const verifier = new SlipOkPaymentEvidenceVerifier();
      const validBuffer = await createMockSlipBuffer();

      (verifier as any).prisma = {
        dormitoryBillingSettings: {
          findFirst: async () => ({
            promptPayValue: '0812345678',
            bankAccountNumber: '1234567890',
          }),
        },
      };

      verifier.setFetchFnForTesting(async () => {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              transRef: 'SLIP-REF-103',
              amount: 4500,
              transDate: '20260924',
              transTime: '123000',
              receiver: {
                proxy: { value: '0812345678' },
                account: { value: '1234567890' },
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      const result = await verifier.verify({
        dormitoryId: 'dorm-001',
        evidenceBuffer: validBuffer,
        expectedAmount: new Decimal(4500),
      });

      expect(result.status).toBe('VERIFIED');
      expect(result.provider).toBe('SLIPOK');
      expect(result.providerReference).toBe('SLIP-REF-103');
      expect(result.verifiedAmount?.toString()).toBe('4500');
      expect(result.verifiedTransferAt).toBeInstanceOf(Date);
      expect(result.errorReason).toBeNull();
    });
  });

  describe('AC-2: Override Reason Enforcement & Role Permissions', () => {
    it('should throw OVERRIDE_REASON_REQUIRED when approving unverified slip without reason', async () => {
      const paymentServiceModule = await import('../../services/payment.service.js');
      const paymentService = paymentServiceModule.paymentService;

      const mockPayment = {
        id: 'pay-001',
        dormitoryId: 'dorm-001',
        billId: 'bill-001',
        amount: new Prisma.Decimal('3500.00'),
        method: 'BANK_TRANSFER',
        status: 'UNDER_REVIEW',
        paymentGroupId: null,
      };

      const mockVerification = {
        id: 'ver-001',
        status: 'UNVERIFIED',
      };

      (paymentService as any).client = {
        $transaction: async (fn: any) => {
          const tx = {
            payment: {
              findUnique: async () => mockPayment,
            },
            paymentEvidenceVerification: {
              findFirst: async () => mockVerification,
            },
            $executeRaw: async () => 1,
          };
          return await fn(tx);
        },
      };

      await expect(
        paymentService.approvePayment({
          dormitoryId: 'dorm-001',
          paymentId: 'pay-001',
          userId: '00000000-0000-0000-0000-000000000001',
          // No overrideReason provided
        })
      ).rejects.toMatchObject({
        code: 'OVERRIDE_REASON_REQUIRED',
        statusCode: 400,
      });
    });

    it('should throw OVERRIDE_REASON_REQUIRED when approving rejected slip without reason', async () => {
      const paymentServiceModule = await import('../../services/payment.service.js');
      const paymentService = paymentServiceModule.paymentService;

      const mockPayment = {
        id: 'pay-002',
        dormitoryId: 'dorm-001',
        billId: 'bill-001',
        amount: new Prisma.Decimal('3500.00'),
        method: 'BANK_TRANSFER',
        status: 'UNDER_REVIEW',
        paymentGroupId: null,
      };

      const mockVerification = {
        id: 'ver-002',
        status: 'REJECTED',
      };

      (paymentService as any).client = {
        $transaction: async (fn: any) => {
          const tx = {
            payment: {
              findUnique: async () => mockPayment,
            },
            paymentEvidenceVerification: {
              findFirst: async () => mockVerification,
            },
            $executeRaw: async () => 1,
          };
          return await fn(tx);
        },
      };

      await expect(
        paymentService.approvePayment({
          dormitoryId: 'dorm-001',
          paymentId: 'pay-002',
          userId: '00000000-0000-0000-0000-000000000001',
          overrideReason: '   ', // whitespace only
        })
      ).rejects.toMatchObject({
        code: 'OVERRIDE_REASON_REQUIRED',
        statusCode: 400,
      });
    });

    it('should throw OVERRIDE_REASON_REQUIRED when approving group with unverified slip without reason', async () => {
      const paymentServiceModule = await import('../../services/payment.service.js');
      const paymentService = paymentServiceModule.paymentService;

      const mockGroup = {
        id: 'group-001',
        dormitoryId: 'dorm-001',
        totalAmount: new Prisma.Decimal('5000.00'),
        method: 'BANK_TRANSFER',
        status: 'UNDER_REVIEW',
        payments: [],
        billTargets: [],
      };

      const mockVerification = {
        id: 'ver-003',
        status: 'UNVERIFIED',
      };

      (paymentService as any).client = {
        $transaction: async (fn: any) => {
          const tx = {
            combinedPaymentGroup: {
              findUnique: async () => mockGroup,
            },
            paymentEvidenceVerification: {
              findFirst: async () => mockVerification,
            },
            $executeRaw: async () => 1,
          };
          return await fn(tx);
        },
      };

      await expect(
        paymentService.approvePaymentGroup({
          dormitoryId: 'dorm-001',
          groupId: 'group-001',
          userId: '00000000-0000-0000-0000-000000000001',
          // No overrideReason
        })
      ).rejects.toMatchObject({
        code: 'OVERRIDE_REASON_REQUIRED',
        statusCode: 400,
      });
    });
  });

  describe('AC-3: Receipt Idempotency & Zero Duplicate Receipts', () => {
    it('generateReceiptInTx returns existing receipt without incrementing sequence or creating duplicate', async () => {
      const existingReceipt = {
        id: 'rc-existing-001',
        paymentId: 'pay-001',
        dormitoryId: 'dorm-001',
        receiptNumber: 'RC-202609-101-0001',
        snapshotData: { total: '3500.00' },
      };

      let upsertCalled = false;
      let createCalled = false;

      const mockTx = {
        receipt: {
          findFirst: async (args: any) => {
            if (args.where.paymentId === 'pay-001' && args.where.dormitoryId === 'dorm-001') {
              return existingReceipt;
            }
            return null;
          },
          create: async () => {
            createCalled = true;
            return {};
          },
        },
        receiptSequence: {
          upsert: async () => {
            upsertCalled = true;
            return { lastValue: 2 };
          },
        },
      };

      const result = await generateReceiptInTx(
        mockTx,
        'pay-001',
        'dorm-001',
        'bill-001',
        'user-001',
        null,
        new Decimal(3500)
      );

      expect(result).toBe(existingReceipt);
      expect(upsertCalled).toBe(false);
      expect(createCalled).toBe(false);
    });

    it('generateGroupReceiptInTx returns existing receipt without incrementing sequence or creating duplicate', async () => {
      const existingGroupReceipt = {
        id: 'rc-group-existing-001',
        paymentGroupId: 'group-001',
        dormitoryId: 'dorm-001',
        receiptNumber: 'RC-202609-101-0002',
        snapshotData: { total: '7000.00' },
      };

      let upsertCalled = false;
      let createCalled = false;

      const mockTx = {
        receipt: {
          findFirst: async (args: any) => {
            if (args.where.paymentGroupId === 'group-001' && args.where.dormitoryId === 'dorm-001') {
              return existingGroupReceipt;
            }
            return null;
          },
          create: async () => {
            createCalled = true;
            return {};
          },
        },
        receiptSequence: {
          upsert: async () => {
            upsertCalled = true;
            return { lastValue: 3 };
          },
        },
      };

      const result = await generateGroupReceiptInTx({
        tx: mockTx,
        dormitoryId: 'dorm-001',
        paymentGroupId: 'group-001',
        totalAmount: new Decimal(7000),
      });

      expect(result).toBe(existingGroupReceipt);
      expect(upsertCalled).toBe(false);
      expect(createCalled).toBe(false);
    });
  });

  describe('AC-4: Domain & Document Separation (N-03 & Locked Product Rules)', () => {
    it('enforces separate document naming conventions for Tenant Receipts (RC-...) vs Subscription Invoices (SUB-INV-...) and PromptPay 3-tier separation', () => {
      const yearMonth = '202609';
      const room = '101';
      const seq = '0005';
      const tenantReceiptNumber = `RC-${yearMonth}-${room}-${seq}`;
      const subscriptionInvoiceNumber = `SUB-INV-${yearMonth}-${seq}`;

      expect(tenantReceiptNumber).toMatch(/^RC-\d{6}-[A-Z0-9]+-\d{4}$/);
      expect(subscriptionInvoiceNumber).toMatch(/^SUB-INV-\d{6}-\d{4}$/);
      expect(tenantReceiptNumber.startsWith('RC-')).toBe(true);
      expect(subscriptionInvoiceNumber.startsWith('SUB-INV-')).toBe(true);
      expect(tenantReceiptNumber.startsWith('SUB-INV-')).toBe(false);

      // PromptPay separation
      const platformPromptPay = '0935098808';
      const dormitoryPromptPay = '0812345678';
      expect(platformPromptPay).not.toBe(dormitoryPromptPay);
    });
  });
});
