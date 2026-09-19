/**
 * @license Apache-2.0
 * HorPlus Tenant Portal — Round 27: Tenant Invoice Items Formatting Parity Test Suite
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  formatTenantBillItemLabel,
  getTenantBillItemAmount,
  parseItemMetadata
} from '../pages/tenant/tenantHelpers';
import { TenantInvoiceView } from '../pages/tenant/views/TenantInvoiceView';
import { Bill } from '../types';

describe('Round 27: Tenant Invoice Items Formatting Parity with Owner Payments', () => {
  describe('Helper: formatTenantBillItemLabel', () => {
    it('formats taxable water with rate and units: ค่าน้ำ (@ 18 × 70 หน่วย) +VAT:', () => {
      const item = {
        type: 'water',
        description: 'ค่าน้ำ',
        unitPrice: 18,
        quantity: 70,
        unit: 'unit',
        amount: 1260,
        metadata: {
          isTaxable: true,
          vatRate: 7,
          vatAmount: 88.2,
          netAmount: 1348.2,
        },
      };
      expect(formatTenantBillItemLabel(item)).toBe('ค่าน้ำ (@ 18 × 70 หน่วย) +VAT:');
    });

    it('formats taxable electricity with rate and units: ค่าไฟฟ้า (@ 7 × 70 หน่วย) +VAT:', () => {
      const item = {
        type: 'electricity',
        description: 'ค่าไฟฟ้า',
        unitPrice: 7,
        quantity: 70,
        unit: 'unit',
        amount: 490,
        metadata: {
          isTaxable: true,
          vatRate: 7,
          vatAmount: 34.3,
          netAmount: 524.3,
        },
      };
      expect(formatTenantBillItemLabel(item)).toBe('ค่าไฟฟ้า (@ 7 × 70 หน่วย) +VAT:');
    });

    it('formats taxable common fee: ค่าส่วนกลาง (@ 200 × 1 ห้อง) +VAT:', () => {
      const item = {
        type: 'common',
        description: 'ค่าส่วนกลาง',
        unitPrice: 200,
        quantity: 1,
        unit: 'room',
        amount: 200,
        metadata: {
          isTaxable: true,
          vatRate: 7,
          vatAmount: 14,
          netAmount: 214,
        },
      };
      expect(formatTenantBillItemLabel(item)).toBe('ค่าส่วนกลาง (@ 200 × 1 ห้อง) +VAT:');
    });

    it('formats taxable internet: ค่าอินเทอร์เน็ต (@ 150 × 1 ห้อง) +VAT:', () => {
      const item = {
        type: 'internet',
        description: 'ค่าอินเทอร์เน็ต',
        unitPrice: 150,
        quantity: 1,
        unit: 'room',
        amount: 150,
        metadata: {
          isTaxable: true,
          vatRate: 7,
          vatAmount: 10.5,
          netAmount: 160.5,
        },
      };
      expect(formatTenantBillItemLabel(item)).toBe('ค่าอินเทอร์เน็ต (@ 150 × 1 ห้อง) +VAT:');
    });

    it('formats taxable parking: ค่าจอดรถ (@ 300 × 1 ห้อง) +VAT:', () => {
      const item = {
        type: 'parking',
        description: 'ค่าจอดรถ',
        unitPrice: 300,
        quantity: 1,
        unit: 'room',
        amount: 300,
        metadata: {
          isTaxable: true,
          vatRate: 7,
          vatAmount: 21,
          netAmount: 321,
        },
      };
      expect(formatTenantBillItemLabel(item)).toBe('ค่าจอดรถ (@ 300 × 1 ห้อง) +VAT:');
    });

    it('formats non-taxable rent with colon: ค่าเช่า (รายเดือน):', () => {
      const item = {
        type: 'rent',
        description: 'ค่าเช่าห้องพัก',
        unitPrice: 4500,
        quantity: 1,
        amount: 4500,
        metadata: {
          isTaxable: false,
        },
      };
      expect(formatTenantBillItemLabel(item)).toBe('ค่าเช่า (รายเดือน):');
    });

    it('formats non-taxable water with rate and units: ค่าน้ำ (@ 18 × 70 หน่วย):', () => {
      const item = {
        type: 'water',
        description: 'ค่าน้ำ',
        unitPrice: 18,
        quantity: 70,
        unit: 'unit',
        amount: 1260,
      };
      expect(formatTenantBillItemLabel(item)).toBe('ค่าน้ำ (@ 18 × 70 หน่วย):');
    });

    it('formats tiered water with VAT: ค่าน้ำ (70 หน่วย • ขั้นบันได) +VAT:', () => {
      const item = {
        type: 'water',
        description: 'ค่าน้ำ',
        amount: 1260,
        metadata: {
          mode: 'tiered',
          usageUnits: 70,
          isTaxable: true,
          vatAmount: 88.2,
          netAmount: 1348.2,
        },
      };
      expect(formatTenantBillItemLabel(item)).toBe('ค่าน้ำ (70 หน่วย • ขั้นบันได) +VAT:');
    });

    it('handles JSON string metadata gracefully (defensive check)', () => {
      const item = {
        type: 'water',
        description: 'ค่าน้ำ',
        unitPrice: 18,
        quantity: 70,
        unit: 'unit',
        amount: 1260,
        metadata: JSON.stringify({
          isTaxable: true,
          vatAmount: 88.2,
          netAmount: 1348.2,
        }),
      };
      expect(formatTenantBillItemLabel(item)).toBe('ค่าน้ำ (@ 18 × 70 หน่วย) +VAT:');
    });
  });

  describe('Helper: getTenantBillItemAmount', () => {
    it('returns netAmount when present in metadata', () => {
      const item = {
        amount: 1260,
        metadata: {
          isTaxable: true,
          netAmount: 1348.2,
        },
      };
      expect(getTenantBillItemAmount(item)).toBe(1348.2);
    });

    it('calculates amount + vatAmount when netAmount is absent', () => {
      const item = {
        amount: 1260,
        metadata: {
          isTaxable: true,
          vatAmount: 88.2,
        },
      };
      expect(getTenantBillItemAmount(item)).toBe(1348.2);
    });

    it('returns base amount when item is non-taxable', () => {
      const item = {
        amount: 4500,
        metadata: {
          isTaxable: false,
        },
      };
      expect(getTenantBillItemAmount(item)).toBe(4500);
    });
  });

  describe('Component: TenantInvoiceView Parity Rendering', () => {
    const mockBill: Bill = {
      id: 'bill-101',
      billNumber: 'INV-202609-101',
      cycleId: '2026-09',
      roomId: 'room-101',
      tenantId: 'tenant-01',
      totalAmount: 2568,
      dueDate: '2026-10-05',
      status: 'unpaid' as any,
      createdAt: '2026-09-19T00:00:00.000Z',
      updatedAt: '2026-09-19T00:00:00.000Z',
      items: [
        {
          id: 'item-1',
          type: 'water',
          description: 'ค่าน้ำ',
          unitPrice: 18,
          quantity: 70,
          unit: 'unit',
          amount: 1260,
          metadata: { isTaxable: true, vatAmount: 88.2, netAmount: 1348.2 },
        },
        {
          id: 'item-2',
          type: 'electricity',
          description: 'ค่าไฟฟ้า',
          unitPrice: 7,
          quantity: 70,
          unit: 'unit',
          amount: 490,
          metadata: { isTaxable: true, vatAmount: 34.3, netAmount: 524.3 },
        },
        {
          id: 'item-3',
          type: 'common',
          description: 'ค่าส่วนกลาง',
          unitPrice: 200,
          quantity: 1,
          unit: 'room',
          amount: 200,
          metadata: { isTaxable: true, vatAmount: 14, netAmount: 214 },
        },
        {
          id: 'item-4',
          type: 'internet',
          description: 'ค่าอินเทอร์เน็ต',
          unitPrice: 150,
          quantity: 1,
          unit: 'room',
          amount: 150,
          metadata: { isTaxable: true, vatAmount: 10.5, netAmount: 160.5 },
        },
        {
          id: 'item-5',
          type: 'parking',
          description: 'ค่าจอดรถ',
          unitPrice: 300,
          quantity: 1,
          unit: 'room',
          amount: 300,
          metadata: { isTaxable: true, vatAmount: 21, netAmount: 321 },
        },
      ],
    };

    it('renders single-line "@ rate × qty +VAT:" and net amounts in Current tab', () => {
      render(
        <TenantInvoiceView
          dormitoryName="หอพัก HorPlus UAT Comprehensive Manor"
          roomNumber="101"
          activeUnpaidBill={mockBill}
          tenantBills={[mockBill]}
          invoiceTab="current"
          setInvoiceTab={() => {}}
          onBack={() => {}}
          onGoToPayment={() => {}}
        />
      );

      // Verify each item's left column label with +VAT:
      expect(screen.getByText('ค่าน้ำ (@ 18 × 70 หน่วย) +VAT:')).toBeDefined();
      expect(screen.getByText('ค่าไฟฟ้า (@ 7 × 70 หน่วย) +VAT:')).toBeDefined();
      expect(screen.getByText('ค่าส่วนกลาง (@ 200 × 1 ห้อง) +VAT:')).toBeDefined();
      expect(screen.getByText('ค่าอินเทอร์เน็ต (@ 150 × 1 ห้อง) +VAT:')).toBeDefined();
      expect(screen.getByText('ค่าจอดรถ (@ 300 × 1 ห้อง) +VAT:')).toBeDefined();

      // Verify each item's right column net amount (with 2 decimals)
      expect(screen.getByText('฿ 1,348.20')).toBeDefined();
      expect(screen.getByText('฿ 524.30')).toBeDefined();
      expect(screen.getByText('฿ 214.00')).toBeDefined();
      expect(screen.getByText('฿ 160.50')).toBeDefined();
      expect(screen.getByText('฿ 321.00')).toBeDefined();

      // Verify total amount
      expect(screen.getAllByText('฿ 2,568.00').length).toBeGreaterThanOrEqual(1);
    });

    it('renders single-line format in History tab when expanded', () => {
      const paidBill: Bill = {
        ...mockBill,
        id: 'bill-paid-101',
        status: 'paid' as any,
      };

      render(
        <TenantInvoiceView
          dormitoryName="หอพัก HorPlus UAT Comprehensive Manor"
          roomNumber="101"
          activeUnpaidBill={null}
          tenantBills={[paidBill]}
          invoiceTab="history"
          setInvoiceTab={() => {}}
          onBack={() => {}}
          onGoToPayment={() => {}}
        />
      );

      // Click to expand the accordion item
      const toggleButton = screen.getByRole('button', { name: /รอบบิล/i });
      fireEvent.click(toggleButton);

      // Verify items render in History tab
      expect(screen.getByText('ค่าน้ำ (@ 18 × 70 หน่วย) +VAT:')).toBeDefined();
      expect(screen.getByText('฿ 1,348.20')).toBeDefined();
    });
  });
});
