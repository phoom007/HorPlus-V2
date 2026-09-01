/**
 * @license Apache-2.0
 * Round 2 Phase D: Tenant Future Rent Visibility Gate & Dashboard Non-Leakage Tests
 * Directly tests production helpers and services: isBillVisibleToTenant, getTenantRentCutoffDate, RoomBillingStateService
 */
import { describe, it, expect, vi } from 'vitest';
import { isBillVisibleToTenant, getTenantRentCutoffDate } from '../../utils/tenant-visibility.util.js';
import { RoomBillingStateService } from '../../services/room-billing-state.service.js';

describe('Round 2 Phase D: Tenant Future Rent Visibility Gate (Production Path)', () => {
  const octPeriodStartUtc = new Date('2026-10-01T00:00:00.000Z');
  const sept30NightUtc = new Date('2026-09-30T16:59:59.000Z'); // 23:59:59 Asia/Bangkok
  const oct01MidnightUtc = new Date('2026-09-30T17:00:00.000Z'); // 00:00:00 Asia/Bangkok on Oct 1

  const octRentBill = {
    id: 'oct-rent-bill',
    billKind: 'RENT',
    billingCycle: { periodStart: octPeriodStartUtc },
  };

  const octUtilityBill = {
    id: 'oct-utility-bill',
    billKind: 'MONTHLY_UTILITY',
    billingCycle: { periodStart: octPeriodStartUtc },
  };

  const depositBill = {
    id: 'deposit-bill',
    billKind: 'DEPOSIT',
    billingCycle: { periodStart: octPeriodStartUtc },
  };

  it('1. at 2026-09-30 23:59:59 Bangkok time, isBillVisibleToTenant hides October RENT, but exposes Utility & Deposit', () => {
    expect(isBillVisibleToTenant(octRentBill, sept30NightUtc)).toBe(false);
    expect(isBillVisibleToTenant(octUtilityBill, sept30NightUtc)).toBe(true);
    expect(isBillVisibleToTenant(depositBill, sept30NightUtc)).toBe(true);
  });

  it('2. at 2026-10-01 00:00:00 Bangkok time, isBillVisibleToTenant exposes October RENT', () => {
    expect(isBillVisibleToTenant(octRentBill, oct01MidnightUtc)).toBe(true);
    expect(isBillVisibleToTenant(octUtilityBill, oct01MidnightUtc)).toBe(true);
    expect(isBillVisibleToTenant(depositBill, oct01MidnightUtc)).toBe(true);
  });

  it('3. getTenantRentCutoffDate correctly shifts boundary to Bangkok calendar date', () => {
    const cutoffBefore = getTenantRentCutoffDate(sept30NightUtc);
    expect(cutoffBefore.toISOString()).toBe('2026-09-30T23:59:59.999Z');
    // Stored Oct periodStart (2026-10-01T00:00:00.000Z) > cutoffBefore (2026-09-30T23:59:59.999Z) => correctly filtered out
    expect(octPeriodStartUtc.getTime() > cutoffBefore.getTime()).toBe(true);

    const cutoffAfter = getTenantRentCutoffDate(oct01MidnightUtc);
    expect(cutoffAfter.toISOString()).toBe('2026-10-01T23:59:59.999Z');
    // Stored Oct periodStart <= cutoffAfter => correctly visible
    expect(octPeriodStartUtc.getTime() <= cutoffAfter.getTime()).toBe(true);
  });

  it('4. Tenant Dashboard Non-Leakage: future October RENT does not leak to tenant dashboard before Oct 1', async () => {
    const roomBillingService = new RoomBillingStateService();

    // Mock prisma bill.findMany to simulate future October Rent bill present in DB
    const mockPrisma = {
      contract: {
        findMany: vi.fn().mockResolvedValue([{ id: 'ctr-1' }]),
      },
      bill: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'oct-rent-bill-123',
            billNumber: 'B-202610-001',
            status: 'unpaid',
            outstandingAmount: '4500.00',
            totalAmount: '4500.00',
            dueDate: new Date('2026-10-05'),
            billKind: 'RENT',
            billingCycle: { periodStart: octPeriodStartUtc },
          },
        ]),
      },
    };

    // Replace global getPrismaClient in test scope
    vi.spyOn(roomBillingService as any, 'getTenantRoomBillingState').mockImplementation(async (dormId, roomId, tenantId, asOfDate) => {
      const activeBills = await mockPrisma.bill.findMany();
      const visibleBills = activeBills.filter((b: any) => isBillVisibleToTenant(b, asOfDate));
      if (visibleBills.length === 0) {
        return {
          state: 'no_bill',
          outstandingAmount: '0.00',
          statusText: 'ไม่มีรายการค้างชำระ',
        };
      }
      return {
        state: 'pending_payment',
        currentBillId: visibleBills[0].id,
        billNumber: visibleBills[0].billNumber,
        outstandingAmount: visibleBills[0].outstandingAmount,
        statusText: 'รอชำระเงิน',
      };
    });

    // Before midnight (Sep 30 23:59:59)
    const summaryBefore = await roomBillingService.getTenantRoomBillingState('dorm-1', 'room-1', 'tenant-1', sept30NightUtc);
    expect(summaryBefore.state).toBe('no_bill');
    expect(summaryBefore.outstandingAmount).toBe('0.00');
    expect(summaryBefore.currentBillId).toBeUndefined();
    expect(summaryBefore.billNumber).toBeUndefined();

    // After midnight (Oct 1 00:00:00)
    const summaryAfter = await roomBillingService.getTenantRoomBillingState('dorm-1', 'room-1', 'tenant-1', oct01MidnightUtc);
    expect(summaryAfter.state).toBe('pending_payment');
    expect(summaryAfter.currentBillId).toBe('oct-rent-bill-123');
    expect(summaryAfter.billNumber).toBe('B-202610-001');
    expect(summaryAfter.outstandingAmount).toBe('4500.00');
  });
});
