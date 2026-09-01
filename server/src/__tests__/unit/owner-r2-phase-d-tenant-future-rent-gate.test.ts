/**
 * @license Apache-2.0
 * Round 2 Phase D: Tenant Future Rent Visibility Gate Tests
 */
import { describe, it, expect } from 'vitest';

describe('Round 2 Phase D: Tenant Future Rent Visibility Gate', () => {
  // Pure filtering simulator reflecting getTenantBillWhere & checkBillOwnership logic
  function filterBillsForActor(
    bills: Array<{ id: string; billKind: string; billingCycle: { periodStart: Date } }>,
    actor: 'TENANT' | 'OWNER',
    asOfDate: Date
  ) {
    return bills.filter((bill) => {
      if (actor === 'OWNER') {
        return true;
      }
      // Tenant future rent visibility gate
      if (bill.billKind === 'RENT' && bill.billingCycle) {
        if (new Date(bill.billingCycle.periodStart) > asOfDate) {
          return false;
        }
      }
      return true;
    });
  }

  const octPeriodStart = new Date('2026-10-01T00:00:00+07:00');
  const sept30Night = new Date('2026-09-30T23:59:59+07:00');
  const oct01Midnight = new Date('2026-10-01T00:00:00+07:00');

  const testBills = [
    {
      id: 'oct-rent-bill',
      billKind: 'RENT',
      billingCycle: { periodStart: octPeriodStart },
    },
    {
      id: 'oct-utility-bill',
      billKind: 'MONTHLY_UTILITY',
      billingCycle: { periodStart: octPeriodStart },
    },
    {
      id: 'deposit-bill',
      billKind: 'DEPOSIT',
      billingCycle: { periodStart: octPeriodStart },
    },
  ];

  it('1. at 2026-09-30 23:59:59 +07:00, tenant cannot see October Rent Bill, but Owner can', () => {
    const tenantVisible = filterBillsForActor(testBills, 'TENANT', sept30Night);
    const ownerVisible = filterBillsForActor(testBills, 'OWNER', sept30Night);

    expect(tenantVisible.some((b) => b.id === 'oct-rent-bill')).toBe(false);
    expect(tenantVisible.some((b) => b.id === 'oct-utility-bill')).toBe(true);
    expect(tenantVisible.some((b) => b.id === 'deposit-bill')).toBe(true);

    expect(ownerVisible.some((b) => b.id === 'oct-rent-bill')).toBe(true);
    expect(ownerVisible.length).toBe(3);
  });

  it('2. at 2026-10-01 00:00:00 +07:00, tenant can see October Rent Bill', () => {
    const tenantVisible = filterBillsForActor(testBills, 'TENANT', oct01Midnight);
    const ownerVisible = filterBillsForActor(testBills, 'OWNER', oct01Midnight);

    expect(tenantVisible.some((b) => b.id === 'oct-rent-bill')).toBe(true);
    expect(tenantVisible.length).toBe(3);

    expect(ownerVisible.some((b) => b.id === 'oct-rent-bill')).toBe(true);
    expect(ownerVisible.length).toBe(3);
  });
});
