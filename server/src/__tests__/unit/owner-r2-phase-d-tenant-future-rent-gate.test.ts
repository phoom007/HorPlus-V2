/**
 * @license Apache-2.0
 * Round 2 Phase D: Tenant Future Rent Visibility Gate & Dashboard Current-Period Tests
 * Directly tests production helpers and services: isBillVisibleToTenant, getTenantRentCutoffDate, RoomBillingStateService
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isBillVisibleToTenant, getTenantRentCutoffDate } from '../../utils/tenant-visibility.util.js';
import { RoomBillingStateService } from '../../services/room-billing-state.service.js';
import * as prismaModule from '../../db/prisma.js';

describe('Round 2 Phase D: Tenant Future Rent Visibility Gate & Dashboard Authority', () => {
  const septPeriodStartUtc = new Date('2026-09-01T00:00:00.000Z');
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

  it('4. Real RoomBillingStateService: future October RENT does NOT override September bill before Oct 1, but becomes current bill on Oct 1', async () => {
    const roomBillingService = new RoomBillingStateService();

    // Database has two bills:
    // 1. Oct RENT generated early on Sep 15 (periodStart: Oct 1)
    // 2. Sep Utility generated on Sep 25 (periodStart: Sep 1, createdAt later than Oct RENT)
    const mockPrisma = {
      contract: {
        findMany: vi.fn().mockResolvedValue([{ id: 'ctr-1' }]),
      },
      bill: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'bill-sep-utility',
            billNumber: 'B-202609-UTILITY',
            tenantId: 'tenant-1',
            contractId: 'ctr-1',
            status: 'unpaid',
            outstandingAmount: '1200.00',
            totalAmount: '1200.00',
            dueDate: new Date('2026-10-05'),
            billKind: 'MONTHLY_UTILITY',
            billingDate: new Date('2026-09-25'),
            createdAt: new Date('2026-09-25T10:00:00Z'),
            billingCycle: { periodStart: septPeriodStartUtc },
          },
          {
            id: 'bill-oct-rent',
            billNumber: 'B-202610-RENT',
            tenantId: 'tenant-1',
            contractId: 'ctr-1',
            status: 'unpaid',
            outstandingAmount: '4500.00',
            totalAmount: '4500.00',
            dueDate: new Date('2026-10-05'),
            billKind: 'RENT',
            billingDate: new Date('2026-10-01'),
            createdAt: new Date('2026-09-15T10:00:00Z'),
            billingCycle: { periodStart: octPeriodStartUtc },
          },
        ]),
      },
    };

    vi.spyOn(prismaModule, 'getPrismaClient').mockReturnValue(mockPrisma as any);

    // At Sep 30 23:59:59 Bangkok time: October RENT is hidden; September Utility is the current bill
    const summaryBefore = await roomBillingService.getTenantRoomBillingState('dorm-1', 'room-1', 'tenant-1', sept30NightUtc);
    expect(summaryBefore.state).toBe('pending_payment');
    expect(summaryBefore.currentBillId).toBe('bill-sep-utility');
    expect(summaryBefore.billNumber).toBe('B-202609-UTILITY');
    expect(summaryBefore.outstandingAmount).toBe('1200.00');

    // At Oct 1 00:00:00 Bangkok time: October RENT is visible and is selected by periodStart authority (Oct 1 > Sep 1)
    const summaryAfter = await roomBillingService.getTenantRoomBillingState('dorm-1', 'room-1', 'tenant-1', oct01MidnightUtc);
    expect(summaryAfter.state).toBe('pending_payment');
    expect(summaryAfter.currentBillId).toBe('bill-oct-rent');
    expect(summaryAfter.billNumber).toBe('B-202610-RENT');
    expect(summaryAfter.outstandingAmount).toBe('4500.00');
  });
});
