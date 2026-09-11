/**
 * @license Apache-2.0
 * Round 2 Phase B: Settled Other-Fee Immutability & Status Recalculation Tests
 * Directly tests the production engine: syncDailyStayOtherFeesInTx
 */
import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { syncDailyStayOtherFeesInTx } from '../../utils/daily-other-fee-sync.util.js';

describe('Round 2 Phase B: Settled Daily Other-Fee Immutability (Production Path)', () => {
  function createMockClient(initialItems: any[]) {
    let items = [...initialItems];
    let updatedInvoice: any = null;

    return {
      client: {
        dailyStayInvoiceItem: {
          findMany: vi.fn().mockImplementation(async ({ where }) => {
            return items.filter((i) => i.invoiceId === where.invoiceId);
          }),
          deleteMany: vi.fn().mockImplementation(async ({ where }) => {
            items = items.filter((i) => !(i.invoiceId === where.invoiceId && i.itemType === where.itemType && i.status === where.status));
            return { count: 1 };
          }),
          createMany: vi.fn().mockImplementation(async ({ data }) => {
            const created = data.map((d: any, idx: number) => ({ id: `new-item-${idx + 1}`, ...d }));
            items.push(...created);
            return { count: created.length };
          }),
        },
        dailyStayInvoice: {
          update: vi.fn().mockImplementation(async ({ where, data }) => {
            updatedInvoice = { id: where.id, ...data };
            return updatedInvoice;
          }),
        },
      },
      getItems: () => items,
      getUpdatedInvoice: () => updatedInvoice,
    };
  }

  it('A. fully PAID invoice: editing settled fee from 50 to 80 is BLOCKED (409)', async () => {
    const mock = createMockClient([
      { id: '1', invoiceId: 'inv-1', itemType: 'DAILY_RENT', description: 'ค่าเช่ารายวัน', amount: new Prisma.Decimal('500.00'), status: 'SETTLED' },
      { id: '2', invoiceId: 'inv-1', itemType: 'OTHER_FEE', description: 'ค่าล้างแอร์', amount: new Prisma.Decimal('50.00'), status: 'SETTLED' },
    ]);

    await expect(
      syncDailyStayOtherFeesInTx(mock.client, 'inv-1', 'PAID', [{ description: 'ค่าล้างแอร์', amount: '80.00' }])
    ).rejects.toThrowError(/ไม่สามารถแก้ไขรายการค่าใช้จ่าย "ค่าล้างแอร์" ที่ชำระเงินแล้วได้/);
  });

  it('B. fully PAID invoice: deleting settled fee is BLOCKED (409)', async () => {
    const mock = createMockClient([
      { id: '1', invoiceId: 'inv-1', itemType: 'DAILY_RENT', description: 'ค่าเช่ารายวัน', amount: new Prisma.Decimal('500.00'), status: 'SETTLED' },
      { id: '2', invoiceId: 'inv-1', itemType: 'OTHER_FEE', description: 'ค่าล้างแอร์', amount: new Prisma.Decimal('50.00'), status: 'SETTLED' },
    ]);

    await expect(
      syncDailyStayOtherFeesInTx(mock.client, 'inv-1', 'PAID', [])
    ).rejects.toThrowError(/ไม่สามารถลบรายการค่าใช้จ่าย "ค่าล้างแอร์" ที่ชำระเงินแล้วได้/);
  });

  it('C. fully PAID invoice: saving unchanged fee is PASS and idempotent', async () => {
    const mock = createMockClient([
      { id: '1', invoiceId: 'inv-1', itemType: 'DAILY_RENT', description: 'ค่าเช่ารายวัน', amount: new Prisma.Decimal('500.00'), status: 'SETTLED' },
      { id: '2', invoiceId: 'inv-1', itemType: 'OTHER_FEE', description: 'ค่าล้างแอร์', amount: new Prisma.Decimal('50.00'), status: 'SETTLED' },
    ]);

    const result = await syncDailyStayOtherFeesInTx(mock.client, 'inv-1', 'PAID', [{ description: 'ค่าล้างแอร์', amount: '50.00' }]);
    expect(result.status).toBe('PAID');
    expect(result.totalAgreed.toFixed(2)).toBe('550.00');
    expect(result.outstanding.toFixed(2)).toBe('0.00');
    expect(mock.getItems().length).toBe(2);
  });

  it('D. fully PAID invoice: adding new distinct fee updates status to PARTIALLY_PAID and outstanding to 30', async () => {
    const mock = createMockClient([
      { id: '1', invoiceId: 'inv-1', itemType: 'DAILY_RENT', description: 'ค่าเช่ารายวัน', amount: new Prisma.Decimal('500.00'), status: 'SETTLED' },
      { id: '2', invoiceId: 'inv-1', itemType: 'OTHER_FEE', description: 'ค่าล้างแอร์', amount: new Prisma.Decimal('50.00'), status: 'SETTLED' },
    ]);

    const result = await syncDailyStayOtherFeesInTx(mock.client, 'inv-1', 'PAID', [
      { description: 'ค่าล้างแอร์', amount: '50.00' },
      { description: 'ค่ากุญแจเพิ่ม', amount: '30.00' },
    ]);

    expect(result.status).toBe('PARTIALLY_PAID');
    expect(result.totalAgreed.toFixed(2)).toBe('580.00');
    expect(result.totalPaid.toFixed(2)).toBe('550.00');
    expect(result.outstanding.toFixed(2)).toBe('30.00');
    expect(mock.getItems().filter((i) => i.itemType === 'OTHER_FEE').length).toBe(2);
    expect(mock.getItems().find((i) => i.description === 'ค่ากุญแจเพิ่ม')?.status).toBe('OUTSTANDING');
  });

  it('E. unpaid invoice: editing other fee from 50 to 80 updates total cleanly to 580', async () => {
    const mock = createMockClient([
      { id: '1', invoiceId: 'inv-1', itemType: 'DAILY_RENT', description: 'ค่าเช่ารายวัน', amount: new Prisma.Decimal('500.00'), status: 'OUTSTANDING' },
      { id: '2', invoiceId: 'inv-1', itemType: 'OTHER_FEE', description: 'ค่าล้างแอร์', amount: new Prisma.Decimal('50.00'), status: 'OUTSTANDING' },
    ]);

    const result = await syncDailyStayOtherFeesInTx(mock.client, 'inv-1', 'ISSUED', [{ description: 'ค่าล้างแอร์', amount: '80.00' }]);

    expect(result.status).toBe('ISSUED');
    expect(result.totalAgreed.toFixed(2)).toBe('580.00');
    expect(result.outstanding.toFixed(2)).toBe('580.00');
    expect(mock.getItems().filter((i) => i.itemType === 'OTHER_FEE').length).toBe(1);
    expect(mock.getItems().find((i) => i.description === 'ค่าล้างแอร์')?.amount.toString()).toBe('80');
  });
});
