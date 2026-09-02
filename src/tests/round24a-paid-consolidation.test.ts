/**
 * @license Apache-2.0
 * Round 2.4A Paid Consolidation & Daily Summary Tests
 *
 * Tests:
 * F. Normal Contract Paid consolidation (same billingCycle + tenantId + roomId -> 1 summary card)
 * G. Daily same tenant + same room consolidation (same cycle + tenantId + roomId -> 1 summary card with child invoices preserved)
 * H. Daily null tenant remains separate (no fuzzy grouping by name/phone)
 * I. Daily different room remains separate
 */

import { describe, it, expect } from 'vitest';

describe('Round 2.4A Paid Consolidation & Daily Summary Logic', () => {
  // Helper implementing the canonical consolidation algorithm
  const consolidatePaidDailyInvoices = (
    invoices: any[],
    effectiveCycleId: string
  ) => {
    const map = new Map<string, {
      id: string;
      roomId: string;
      tenantId?: string | null;
      tenantName: string;
      totalAmount: number;
      invoices: any[];
    }>();

    invoices.forEach(inv => {
      const tenantId = inv.dailyStay?.tenantId;
      const roomId = inv.dailyStay?.roomId || '';
      // Canonical key: tenantId ? cycle_tenant_room : daily_invId
      const key = tenantId ? `${effectiveCycleId}_${tenantId}_${roomId}` : `daily_${inv.id}`;

      const tenantName = inv.dailyStay?.tenant?.displayName || inv.dailyStay?.applicantFullName || 'ผู้พักรายวัน';
      const totalAmt = Number(inv.totalAgreedAmount || 0);

      const existing = map.get(key);
      if (existing) {
        existing.totalAmount += totalAmt;
        existing.invoices.push(inv);
      } else {
        map.set(key, {
          id: key,
          roomId,
          tenantId,
          tenantName,
          totalAmount: totalAmt,
          invoices: [inv],
        });
      }
    });

    return Array.from(map.values());
  };

  const consolidateNormalPaidPayments = (
    payments: any[],
    effectiveCycleId: string
  ) => {
    const map = new Map<string, {
      id: string;
      roomId: string;
      tenantId: string;
      totalAmount: number;
      payments: any[];
    }>();

    payments.forEach(p => {
      const cycleId = p.bill?.billingCycleId || effectiveCycleId;
      const roomId = p.bill?.roomId || '';
      const tenantId = p.tenantId || p.bill?.tenantId || '';
      const key = `${cycleId}_${tenantId}_${roomId}`;
      const pAmt = Number(p.amount || 0);

      const existing = map.get(key);
      if (existing) {
        existing.totalAmount += pAmt;
        existing.payments.push(p);
      } else {
        map.set(key, {
          id: key,
          roomId,
          tenantId,
          totalAmount: pAmt,
          payments: [p],
        });
      }
    });

    return Array.from(map.values());
  };

  it('F. Normal Contract Paid consolidation: groups payments for same cycle + tenant + room into 1 card', () => {
    const payments = [
      {
        id: 'p-rent',
        amount: 3500,
        tenantId: 'tenant-1',
        bill: { billingCycleId: 'cycle-09', roomId: 'room-101' },
      },
      {
        id: 'p-utility',
        amount: 800,
        tenantId: 'tenant-1',
        bill: { billingCycleId: 'cycle-09', roomId: 'room-101' },
      },
      {
        id: 'p-other-tenant',
        amount: 4000,
        tenantId: 'tenant-2',
        bill: { billingCycleId: 'cycle-09', roomId: 'room-102' },
      },
    ];

    const groups = consolidateNormalPaidPayments(payments, 'cycle-09');
    expect(groups.length).toBe(2);

    const group101 = groups.find(g => g.roomId === 'room-101');
    expect(group101).toBeDefined();
    expect(group101?.totalAmount).toBe(4300);
    expect(group101?.payments.length).toBe(2);

    const group102 = groups.find(g => g.roomId === 'room-102');
    expect(group102).toBeDefined();
    expect(group102?.totalAmount).toBe(4000);
  });

  it('G. Daily Paid consolidation: groups multiple Daily stays for same tenant + room into 1 card and preserves both stays', () => {
    const dailyInvoices = [
      {
        id: 'inv-d1',
        invoiceNumber: 'INV-D-001',
        totalAgreedAmount: 700,
        dailyStay: {
          tenantId: 'tenant-vip-1',
          roomId: 'room-101',
          applicantFullName: 'คุณสมศักดิ์',
        },
      },
      {
        id: 'inv-d2',
        invoiceNumber: 'INV-D-002',
        totalAgreedAmount: 1400,
        dailyStay: {
          tenantId: 'tenant-vip-1',
          roomId: 'room-101',
          applicantFullName: 'คุณสมศักดิ์',
        },
      },
    ];

    const dailyGroups = consolidatePaidDailyInvoices(dailyInvoices, 'cycle-09');
    expect(dailyGroups.length).toBe(1);

    const g = dailyGroups[0];
    expect(g.roomId).toBe('room-101');
    expect(g.tenantId).toBe('tenant-vip-1');
    expect(g.totalAmount).toBe(2100);
    expect(g.invoices.length).toBe(2);
    expect(g.invoices[0].invoiceNumber).toBe('INV-D-001');
    expect(g.invoices[1].invoiceNumber).toBe('INV-D-002');
  });

  it('H. Daily null tenant: keeps invoices isolated without fuzzy grouping by applicantFullName', () => {
    const dailyInvoices = [
      {
        id: 'inv-d-guest1',
        invoiceNumber: 'INV-D-101',
        totalAgreedAmount: 600,
        dailyStay: {
          tenantId: null, // Walk-in guest
          roomId: 'room-101',
          applicantFullName: 'คุณวิชัย เดินทาง',
        },
      },
      {
        id: 'inv-d-guest2',
        invoiceNumber: 'INV-D-102',
        totalAgreedAmount: 600,
        dailyStay: {
          tenantId: null, // Another walk-in guest (or same name walk-in)
          roomId: 'room-101',
          applicantFullName: 'คุณวิชัย เดินทาง',
        },
      },
    ];

    const dailyGroups = consolidatePaidDailyInvoices(dailyInvoices, 'cycle-09');
    // Must NOT group walk-ins with null tenantId!
    expect(dailyGroups.length).toBe(2);
    expect(dailyGroups[0].id).toBe('daily_inv-d-guest1');
    expect(dailyGroups[1].id).toBe('daily_inv-d-guest2');
  });

  it('I. Daily different rooms: separates stays across different rooms even for same tenant', () => {
    const dailyInvoices = [
      {
        id: 'inv-d-r101',
        invoiceNumber: 'INV-D-201',
        totalAgreedAmount: 800,
        dailyStay: {
          tenantId: 'tenant-multi-room',
          roomId: 'room-101',
          applicantFullName: 'คุณสมปอง',
        },
      },
      {
        id: 'inv-d-r102',
        invoiceNumber: 'INV-D-202',
        totalAgreedAmount: 800,
        dailyStay: {
          tenantId: 'tenant-multi-room',
          roomId: 'room-102', // Different room
          applicantFullName: 'คุณสมปอง',
        },
      },
    ];

    const dailyGroups = consolidatePaidDailyInvoices(dailyInvoices, 'cycle-09');
    expect(dailyGroups.length).toBe(2);
  });
});
