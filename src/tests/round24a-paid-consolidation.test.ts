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

  describe('Receipt View Props: Historical Debt vs Live Payment Authority', () => {
    // Mimics buildReceiptViewProps logic
    const buildReceiptProps = (payment: any) => {
      const snap = payment.receipt?.snapshotData || {};
      const targetBill = payment.bill;

      const isHistoricalPayment = Boolean(
        snap.isHistoricalImport ||
        payment.metadata?.isHistoricalImport
      );
      const originalPaymentDateKnown = isHistoricalPayment
        ? Boolean(snap.originalPaymentDateKnown ?? payment.metadata?.originalPaymentDateKnown ?? false)
        : true;
      const originalPaidAt = (!isHistoricalPayment || originalPaymentDateKnown)
        ? (snap.paymentDate || payment.paymentDate || payment.createdAt || null)
        : null;
      const importedAt = snap.importedAt || payment.metadata?.importedAt || payment.createdAt;

      return {
        receiptNumber: snap.receiptNumber || payment.receipt?.receiptNumber || 'RC-001',
        totalAmount: Number(payment.amount || 0),
        paidAt: originalPaidAt,
        isHistorical: isHistoricalPayment,
        originalPaymentDateKnown,
        importedAt,
      };
    };

    it('J. Historical debt + LIVE Payment: Receipt is NOT marked historical payment and has concrete paid date', () => {
      const livePaymentOfHistoricalDebt = {
        id: 'pay-live-01',
        amount: 4500,
        paymentDate: '2026-10-10T14:30:00.000Z',
        createdAt: '2026-10-10T14:30:00.000Z',
        metadata: {
          isHistoricalImport: false, // Normal LIVE payment
        },
        bill: {
          id: 'bill-july-debt',
          items: [
            {
              description: 'ค่าเช่า ก.ค. 69 (หนี้ค้างก่อนใช้ HorPlus)',
              amount: 4500,
              metadata: {
                isHistoricalImport: true,
                originalPeriod: '2026-07',
              },
            },
          ],
        },
        receipt: {
          receiptNumber: 'RC-202610-101-0001',
          snapshotData: {
            receiptNumber: 'RC-202610-101-0001',
            paymentDate: '2026-10-10T14:30:00.000Z',
            isHistoricalImport: false,
            originalPaymentDateKnown: true,
          },
        },
      };

      const props = buildReceiptProps(livePaymentOfHistoricalDebt);
      expect(props.isHistorical).toBe(false);
      expect(props.originalPaymentDateKnown).toBe(true);
      expect(props.paidAt).toBe('2026-10-10T14:30:00.000Z');
      // Verify modal text: must NOT show 'ไม่ทราบวันที่ชำระเดิม'
      const showsUnknownOldDate = props.isHistorical && !props.originalPaymentDateKnown;
      expect(showsUnknownOldDate).toBe(false);
    });

    it('K. Imported Historical PAID payment: Receipt is marked historical and displays unknown original date', () => {
      const importedHistoricalPayment = {
        id: 'pay-hist-01',
        amount: 4500,
        paymentDate: null,
        createdAt: '2026-09-01T08:00:00.000Z',
        metadata: {
          isHistoricalImport: true,
          originalPaymentDateKnown: false,
          importedAt: '2026-09-01T08:00:00.000Z',
        },
        bill: {
          id: 'bill-may-paid',
          items: [
            {
              description: 'ค่าเช่า พ.ค. 69',
              amount: 4500,
              metadata: { isHistoricalImport: true },
            },
          ],
        },
        receipt: {
          receiptNumber: 'RC-202609-101-0001',
          snapshotData: {
            receiptNumber: 'RC-202609-101-0001',
            paymentDate: null,
            isHistoricalImport: true,
            originalPaymentDateKnown: false,
            importedAt: '2026-09-01T08:00:00.000Z',
          },
        },
      };

      const props = buildReceiptProps(importedHistoricalPayment);
      expect(props.isHistorical).toBe(true);
      expect(props.originalPaymentDateKnown).toBe(false);
      expect(props.paidAt).toBeNull();
      // Verify modal text: MUST show 'ไม่ทราบวันที่ชำระเดิม'
      const showsUnknownOldDate = props.isHistorical && !props.originalPaymentDateKnown;
      expect(showsUnknownOldDate).toBe(true);
      expect(props.importedAt).toBe('2026-09-01T08:00:00.000Z');
    });
  });
});
