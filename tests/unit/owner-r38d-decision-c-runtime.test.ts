/**
 * @license Apache-2.0
 * OWNER R3.8d — Decision C Runtime & Financial Integrity Unit Tests
 */

import { describe, it, expect } from 'vitest';
import { resolveBillLateFeeEffectiveAsOfInTx } from '../../server/src/services/late-fee-reconciliation.service.js';
import { resolveTrustedPaymentEffectiveAt, PaymentVerificationService } from '../../server/src/services/payment-verification.service.js';
import { computeCanonicalAllocationPlan } from '../../server/src/utils/allocation.util.js';
import { Decimal } from 'decimal.js';

describe('OWNER R3.8d: Decision C Runtime & Financial Authority Unit Proofs', () => {
  const referenceTime = new Date('2026-08-15T10:00:00.000Z');

  // TEST 1: Manual UNVERIFIED partial payment does NOT freeze late fees
  it('1. Decision C: Manual UNVERIFIED partial payment does NOT freeze late fee accrual', () => {
    const bill = {
      status: 'PARTIALLY_PAID',
      outstandingAmount: '2500.00',
      Payment: [
        {
          id: 'pay-1',
          status: 'APPROVED',
          method: 'BANK_TRANSFER',
          paymentDate: new Date('2026-08-08T12:00:00.000Z'),
          verification: {
            status: 'UNVERIFIED',
            provider: 'NONE',
            claimedTransferAt: new Date('2026-08-04T12:00:00.000Z'), // Claimed transfer is UNTRUSTED
            verifiedTransferAt: null,
          },
        },
      ],
    };

    const effectiveAsOf = resolveBillLateFeeEffectiveAsOfInTx(bill, referenceTime);
    // Must NOT freeze at claimedTransferAt (2026-08-04) or paymentDate (2026-08-08)
    // Must return current referenceTime (2026-08-15)
    expect(effectiveAsOf?.toISOString()).toBe(referenceTime.toISOString());
  });

  // TEST 2: Cash partial payment freezes late fees at trusted server paymentDate
  it('2. Decision C: Cash partial payment freezes late fee accrual as of trusted cash paymentDate', () => {
    const cashDate = new Date('2026-08-10T14:30:00.000Z');
    const bill = {
      status: 'PARTIALLY_PAID',
      outstandingAmount: '1500.00',
      Payment: [
        {
          id: 'pay-cash',
          status: 'APPROVED',
          method: 'CASH',
          paymentDate: cashDate,
          verification: null,
        },
      ],
    };

    const effectiveAsOf = resolveBillLateFeeEffectiveAsOfInTx(bill, referenceTime);
    expect(effectiveAsOf?.toISOString()).toBe(cashDate.toISOString());
  });

  // TEST 3: Future VERIFIED provider freezes late fees at verifiedTransferAt
  it('3. Decision C: Future trusted verification adapter freezes late fees at verifiedTransferAt', () => {
    const verifiedTransferDate = new Date('2026-08-07T09:15:00.000Z');
    const bill = {
      status: 'PARTIALLY_PAID',
      outstandingAmount: '1000.00',
      Payment: [
        {
          id: 'pay-slipok',
          status: 'APPROVED',
          method: 'BANK_TRANSFER',
          paymentDate: new Date('2026-08-12T10:00:00.000Z'),
          verification: {
            status: 'VERIFIED',
            provider: 'SLIPOK',
            claimedTransferAt: new Date('2026-08-07T09:15:00.000Z'),
            verifiedTransferAt: verifiedTransferDate,
          },
        },
      ],
    };

    const effectiveAsOf = resolveBillLateFeeEffectiveAsOfInTx(bill, referenceTime);
    expect(effectiveAsOf?.toISOString()).toBe(verifiedTransferDate.toISOString());
  });

  // TEST 4: Fully Settled / PAID Bill is not eligible for late fee accrual
  it('4. PAID bill or zero outstanding returns null (not eligible for late fee accrual)', () => {
    const billPaid = {
      status: 'PAID',
      outstandingAmount: '0.00',
      Payment: [],
    };
    expect(resolveBillLateFeeEffectiveAsOfInTx(billPaid, referenceTime)).toBeNull();

    const billZeroOutstanding = {
      status: 'PARTIALLY_PAID',
      outstandingAmount: '0.00',
      Payment: [],
    };
    expect(resolveBillLateFeeEffectiveAsOfInTx(billZeroOutstanding, referenceTime)).toBeNull();
  });

  // TEST 5: Verification Service XOR Anchor Constraint Enforcement
  it('5. PaymentVerificationService recordVerificationInTx enforces XOR anchor constraint', async () => {
    const service = new PaymentVerificationService();
    const mockTx = {
      paymentEvidenceVerification: {
        create: async (args: any) => args.data,
      },
    };

    // Both missing -> throw
    await expect(
      service.recordVerificationInTx(mockTx, {
        dormitoryId: 'dorm-1',
        result: { provider: 'NONE', status: 'UNVERIFIED' },
      })
    ).rejects.toThrowError('Exactly one of paymentId or paymentGroupId must be provided');

    // Both present -> throw
    await expect(
      service.recordVerificationInTx(mockTx, {
        dormitoryId: 'dorm-1',
        paymentId: 'pay-1',
        paymentGroupId: 'group-1',
        result: { provider: 'NONE', status: 'UNVERIFIED' },
      })
    ).rejects.toThrowError('Exactly one of paymentId or paymentGroupId must be provided');

    // Exactly one present -> success
    const res = await service.recordVerificationInTx(mockTx, {
      dormitoryId: 'dorm-1',
      paymentGroupId: 'group-1',
      result: { provider: 'NONE', status: 'UNVERIFIED', claimedTransferAt: new Date('2026-08-28') },
    });
    expect(res.paymentGroupId).toBe('group-1');
    expect(res.paymentId).toBeNull();
  });

  // TEST 6: Strict Same-Tenant Scope Check
  it('6. Allocation Engine fails closed when targetTenantId is present and bill.tenantId does not match', () => {
    const eligibleBills = [
      {
        id: 'bill-1',
        dormitoryId: 'dorm-1',
        roomId: 'room-101',
        tenantId: null, // Null tenant
        billNumber: 'INV-1',
        billKind: 'MONTHLY_UTILITY',
        status: 'UNPAID',
        billingDate: '2026-08-01',
        totalAmount: '4000.00',
        paidAmount: '0.00',
        outstandingAmount: '4000.00',
      },
    ];

    expect(() =>
      computeCanonicalAllocationPlan({
        submitAmount: '4000.00',
        targetRoomId: 'room-101',
        targetTenantId: 'tenant-123',
        eligibleBills: eligibleBills as any,
      })
    ).toThrowError('ไม่พบบิลที่มียอดค้างชำระสำหรับห้องและผู้เช่าที่ระบุ');
  });

  // TEST 7: Multi-bill Allocation Exact Monetary Conservation
  it('7. Multi-Bill Allocation Plan produces exact mathematical conservation', () => {
    const eligibleBills = [
      {
        id: 'bill-july',
        dormitoryId: 'dorm-1',
        roomId: 'room-101',
        tenantId: 'tenant-1',
        billNumber: 'INV-JULY',
        billKind: 'MONTHLY_UTILITY',
        status: 'UNPAID',
        billingDate: '2026-07-25',
        totalAmount: '4000.00',
        paidAmount: '0.00',
        outstandingAmount: '4000.00',
        items: [{ id: 'it-july', type: 'rent', description: 'ค่าเช่า ก.ค.', amount: '4000.00' }],
      },
      {
        id: 'bill-aug',
        dormitoryId: 'dorm-1',
        roomId: 'room-101',
        tenantId: 'tenant-1',
        billNumber: 'INV-AUG',
        billKind: 'MONTHLY_UTILITY',
        status: 'UNPAID',
        billingDate: '2026-08-25',
        totalAmount: '5000.00',
        paidAmount: '0.00',
        outstandingAmount: '5000.00',
        items: [{ id: 'it-aug', type: 'rent', description: 'ค่าเช่า ส.ค.', amount: '5000.00' }],
      },
    ];

    const plan = computeCanonicalAllocationPlan({
      submitAmount: '6500.00',
      targetRoomId: 'room-101',
      targetTenantId: 'tenant-1',
      eligibleBills: eligibleBills as any,
    });

    expect(plan.totalAllocated.toString()).toBe('6500');
    expect(plan.affectedBills.length).toBe(2);
    expect(plan.affectedBills[0].newStatus).toBe('PAID');
    expect(plan.affectedBills[0].allocatedAmount.toString()).toBe('4000');
    expect(plan.affectedBills[1].newStatus).toBe('PARTIALLY_PAID');
    expect(plan.affectedBills[1].allocatedAmount.toString()).toBe('2500');
  });
});
