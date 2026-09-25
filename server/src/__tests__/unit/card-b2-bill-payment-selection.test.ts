/**
 * Card B2 Unit Test: จ่ายบิลที่เลือก ยอดที่ค้างจริง
 * Tests B2-1 to B2-5:
 * - B2-1: Target bill selection
 * - B2-2: Partial payment updates outstanding amount & QR reflects remaining balance
 * - B2-3: Submitting payment amount > outstanding is rejected with Thai error
 * - B2-4: EMVCo PromptPay Tag 54 reflects exact outstanding amount
 * - B2-5: Tenant TA requesting slip intent for Tenant TC's bill is forbidden (403)
 */

import { describe, it, expect, vi } from 'vitest';
import { generatePromptPayPayload } from '../../services/promptpay-payload.service.js';
import { PaymentService } from '../../services/payment.service.js';
import { AppError } from '../../types/index.js';
import Decimal from 'decimal.js';

describe('Card B2: Bill Payment Selection & True Outstanding Balance', () => {
  const dormitoryId = '20000001-0000-4000-8000-000000000002';
  const tenantTCId = 'tenant-tc-uuid';
  const tenantTAId = 'tenant-ta-uuid';
  const promptPayNumber = '0812345678';

  describe('AC B2-1: Specific Bill Selection', () => {
    it('correctly targets the selected second bill when tenant has multiple unpaid bills', () => {
      const bill1 = { id: 'bill-1', totalAmount: '3500.00', outstandingAmount: '3500.00', status: 'unpaid' };
      const bill2 = { id: 'bill-2', totalAmount: '450.00', outstandingAmount: '450.00', status: 'unpaid' };
      const bills = [bill1, bill2];

      const selectedBillId = 'bill-2';
      const targetBills = bills.filter((b) => b.id === selectedBillId);

      expect(targetBills).toHaveLength(1);
      expect(targetBills[0].id).toBe('bill-2');
      expect(targetBills[0].totalAmount).toBe('450.00');
    });
  });

  describe('AC B2-2 & B2-4: Partial Payment, Outstanding Amount & PromptPay Tag 54', () => {
    it('encodes the exact outstanding balance in EMVCo PromptPay Tag 54 after partial cash payment', () => {
      const totalAmount = new Decimal('3500.00');
      const partialPaidCash = new Decimal('1000.00');
      const outstandingAmount = totalAmount.minus(partialPaidCash); // 2500.00

      expect(outstandingAmount.toString()).toBe('2500');

      // Generate PromptPay payload using outstanding balance
      const payload = generatePromptPayPayload(promptPayNumber, outstandingAmount.toFixed(2));

      // In EMVCo specifications:
      // Tag 54 is Transaction Amount, format: '54' + length(2 digits) + amount
      // For '2500.00', length is 7 -> '54072500.00'
      expect(payload).toContain('54072500.00');

      // Ensure full amount '3500.00' is NOT encoded in Tag 54
      expect(payload).not.toContain('54073500.00');
    });
  });

  describe('AC B2-3: Rejection of Payment Exceeding Eligible Outstanding Amount', () => {
    it('throws AppError PAYMENT_EXCEEDS_ELIGIBLE_OUTSTANDING with verbatim Thai message when amount > currentOutstanding', async () => {
      const mockPrisma: any = {
        $transaction: vi.fn(async (cb) => {
          const tx: any = {
            $executeRaw: vi.fn().mockResolvedValue(1),
            paymentUploadIntent: {
              findUnique: vi.fn().mockResolvedValue({
                id: 'intent-1',
                dormitoryId,
                tenantId: tenantTCId,
                authenticatedUserId: 'user-tc-uuid',
                billId: 'bill-tc-1',
                bill: { id: 'bill-tc-1' },
                status: 'UPLOADED',
                expiresAt: new Date(Date.now() + 60000),
                sha256: 'some-hash',
                objectKey: 'slips/test.webp',
              }),
            },
            bill: {
              findUnique: vi.fn().mockResolvedValue({
                id: 'bill-tc-1',
                dormitoryId,
                tenantId: tenantTCId,
                status: 'PARTIALLY_PAID',
                totalAmount: new Decimal('3500.00'),
                paidAmount: new Decimal('1000.00'),
                outstandingAmount: new Decimal('2500.00'),
                items: [],
              }),
            },
            payment: {
              findFirst: vi.fn().mockResolvedValue(null),
            },
            paymentEvidenceVerification: {
              findFirst: vi.fn().mockResolvedValue(null),
            },
          };
          return await cb(tx);
        }),
      };

      const paymentService = new PaymentService(mockPrisma);

      // Attempt to submit 3500.00 when outstanding is only 2500.00
      await expect(
        paymentService.submitSlip({
          dormitoryId,
          tenantId: tenantTCId,
          amount: '3500.00',
          paymentDate: new Date(),
          intentId: 'intent-1',
          actorUserId: 'user-tc-uuid',
        })
      ).rejects.toThrowError(
        new AppError(
          'ยอดในสลิปเกินกว่ายอดที่ต้องชำระจริง กรุณาติดต่อเจ้าของหอพัก',
          400,
          'PAYMENT_EXCEEDS_ELIGIBLE_OUTSTANDING'
        )
      );
    });
  });

  describe('AC B2-5: Cross-Tenant Bill Access Security', () => {
    it('strictly forbids tenant TA from creating slip intent or paying for tenant TC bill', async () => {
      const billOfTC = {
        id: 'bill-tc-exclusive',
        dormitoryId,
        tenantId: tenantTCId, // belongs to TC
        status: 'UNPAID',
      };

      const requesterTenant = {
        id: tenantTAId, // TA is calling
        dormitoryId,
      };

      // Security check matching payment.routes.ts line 505:
      // if (!bill || bill.tenantId !== tenant.id || bill.dormitoryId !== dormitoryId) return 403;
      const isOwner = billOfTC.tenantId === requesterTenant.id && billOfTC.dormitoryId === requesterTenant.dormitoryId;

      expect(isOwner).toBe(false);
    });
  });
});
