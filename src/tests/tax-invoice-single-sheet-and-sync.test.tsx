import { describe, it, expect } from 'vitest';
import { renderReceiptHtml } from '../../server/src/utils/receipt-html.util.js';
import { resolveOwnerMeterDisplayStatus } from '../pages/owner/meters';
import { extractBillDetails, generateRawGridLines } from '../pages/owner/reports';
import { calculateOwnerReports } from '../../server/src/utils/report-calculations.js';

describe('SPEC-TIS-01: Single-Sheet Tax Invoice, Meter Sync, Itemized VAT & Reports', () => {
  describe('TIS-01: Single-Sheet Document Generation', () => {
    it('renders exactly 1 single sheet titled "ใบกำกับภาษี (TAX INVOICE)" when VAT is active', () => {
      const receipt = {
        receiptNumber: 'RC-202609-101-0001',
        issuedAt: '2026-09-15T10:00:00Z',
        dormitoryId: 'dorm-01',
        snapshotData: {
          receiverName: 'สมชาย เจ้าของหอ',
          dormitoryTaxId: '0105559001234',
          tenantName: 'สมศักดิ์ ผู้เช่า',
          roomNumber: '101',
          total: '4815.00',
          subtotal: '4500.00',
          vatAmount: '315.00',
          isVatActive: true,
          items: [
            { type: 'rent', description: 'ค่าเช่าห้องพัก', amount: '4500.00', quantity: 1, unit: 'เดือน', unitPrice: '4500.00' }
          ]
        }
      };

      const html = renderReceiptHtml(receipt as any);
      expect(html).toContain('ใบกำกับภาษี (TAX INVOICE)');
      expect(html).not.toContain('ใบเสร็จรับเงิน (RECEIPT)');
      expect(html).not.toContain('ใบเสร็จรับเงิน / ใบกำกับภาษี');
      expect(html).toContain('<title>Tax Invoice RC-202609-101-0001</title>');
    });

    it('renders exactly 1 single sheet titled "ใบเสร็จรับเงิน (RECEIPT)" when VAT is not active', () => {
      const receipt = {
        receiptNumber: 'RC-202609-102-0002',
        issuedAt: '2026-09-15T10:00:00Z',
        dormitoryId: 'dorm-01',
        snapshotData: {
          receiverName: 'สมชาย เจ้าของหอ',
          tenantName: 'สมหญิง ผู้เช่า',
          roomNumber: '102',
          total: '4500.00',
          items: [
            { type: 'rent', description: 'ค่าเช่าห้องพัก', amount: '4500.00', quantity: 1, unit: 'เดือน', unitPrice: '4500.00' }
          ]
        }
      };

      const html = renderReceiptHtml(receipt as any);
      expect(html).toContain('ใบเสร็จรับเงิน (RECEIPT)');
      expect(html).not.toContain('TAX INVOICE');
      expect(html).toContain('<title>Receipt RC-202609-102-0002</title>');
    });
  });

  describe('TIS-02: Meter Status Synchronization', () => {
    it('returns label: "ชำระแล้ว" and tone: "success" when isMuPaid is true even if isOverallPaid was false', () => {
      const status = resolveOwnerMeterDisplayStatus({
        billingSource: 'CONTRACT',
        isMuIssued: true,
        isMuPaid: true,
        isOverallPaid: false,
        hasValidationError: false,
      });

      expect(status.label).toBe('ชำระแล้ว');
      expect(status.tone).toBe('success');
      expect(status.isMonthlyUtilityPaid).toBe(true);
      expect(status.statusKey).toBe('PAID');
    });

    it('returns label: "รอชำระ" and tone: "warning" when isMuIssued is true and isMuPaid is false', () => {
      const status = resolveOwnerMeterDisplayStatus({
        billingSource: 'CONTRACT',
        isMuIssued: true,
        isMuPaid: false,
        isOverallPaid: false,
        hasValidationError: false,
      });

      expect(status.label).toBe('รอชำระ');
      expect(status.tone).toBe('warning');
      expect(status.isMonthlyUtilityPaid).toBe(false);
      expect(status.statusKey).toBe('UNPAID');
    });
  });

  describe('TIS-03: Itemized (+VAT) and Calculated Amounts', () => {
    it('appends (+VAT) to taxable item and includes VAT in item amount', () => {
      const receipt = {
        receiptNumber: 'RC-202609-103-0003',
        issuedAt: '2026-09-15T10:00:00Z',
        dormitoryId: 'dorm-01',
        snapshotData: {
          receiverName: 'สมชาย เจ้าของหอ',
          dormitoryTaxId: '0105559001234',
          tenantName: 'สมหมาย',
          roomNumber: '103',
          total: '4815.00',
          subtotal: '4500.00',
          vatAmount: '315.00',
          isVatActive: true,
          items: [
            {
              type: 'rent',
              description: 'ค่าเช่าห้องพัก',
              amount: '4500.00',
              quantity: 1,
              unit: 'เดือน',
              unitPrice: '4500.00',
              metadata: { isTaxable: true, netAmount: '4815.00', vatAmount: '315.00' }
            }
          ]
        }
      };

      const html = renderReceiptHtml(receipt as any);
      expect(html).toContain('ค่าเช่าห้องพัก (+VAT)');
      expect(html).toContain('4815.00');
      expect(html).toContain('รวมเงินก่อนภาษี (Subtotal):');
      expect(html).toContain('ภาษีมูลค่าเพิ่ม 7% (VAT 7%):');
      expect(html).toContain('จำนวนเงินรวมทั้งสิ้น (Total Net Amount):');
    });
  });

  describe('TIS-04: Reports & Export VAT Calculation', () => {
    it('extractBillDetails calculates VAT correctly with fallback when isVatActive is true', () => {
      const bill = {
        id: 'bill-1',
        billNumber: 'B-001',
        roomId: 'room-1',
        roomNumber: '101',
        totalAmount: '4815.00',
        subtotal: '4500.00',
        vatAmount: '315.00',
        isVatActive: true,
        items: [
          { type: 'rent', description: 'ค่าเช่าห้องพัก', amount: '4500.00', metadata: { isTaxable: true } }
        ]
      };

      const details = extractBillDetails(bill as any);
      expect(details.vatAmt).toBe(315);
      expect(details.subtotalAmt).toBe(4500);
      expect(details.netTotalAmt).toBe(4815);
    });

    it('generateRawGridLines includes subtotal, vat, and net total columns in raw CSV', () => {
      const details = [
        {
          buildingName: 'อาคาร A',
          floorStr: '1',
          roomNumber: '101',
          tenantName: 'สมชาย',
          tenantPhone: '0812345678',
          peopleCount: 1,
          vehicleCount: 0,
          billNumber: 'B-001',
          statusStr: 'ชำระแล้ว',
          paymentMethodStr: 'พร้อมเพย์',
          dueDateStr: '05/09/2026',
          paidDateStr: '03/09/2026',
          rentAmt: 4500,
          waterUnits: 0,
          waterAmt: 0,
          elecUnits: 0,
          elecAmt: 0,
          commonAmt: 0,
          internetAmt: 0,
          parkingAmt: 0,
          otherAmt: 0,
          otherDesc: '-',
          fineAmt: 0,
          discountAmt: 0,
          depositAmt: 0,
          subtotalAmt: 4500,
          vatAmt: 315,
          netTotalAmt: 4815,
          paidAmt: 4815,
          outstandingAmt: 0,
        }
      ];

      const grid = generateRawGridLines(details as any);
      expect(grid.headerLine).toContain('ยอดรวมก่อน VAT (บาท)');
      expect(grid.headerLine).toContain('ภาษีมูลค่าเพิ่ม 7% (บาท)');
      expect(grid.headerLine).toContain('ยอดรวมสุทธิ (บาท)');
      expect(grid.dataRows[0]).toContain('4500.00');
      expect(grid.dataRows[0]).toContain('315.00');
      expect(grid.dataRows[0]).toContain('4815.00');
    });

    it('calculateOwnerReports computes exactVatTotal and vatTotal', () => {
      const result = calculateOwnerReports({
        bills: [
          {
            id: 'b1',
            status: 'PAID',
            totalAmount: '4815.00',
            subtotal: '4500.00',
            vatAmount: '315.00',
            cycleCode: '2026-09',
            items: [{ type: 'rent', amount: '4500.00' }]
          } as any
        ],
        rooms: [{ id: 'r1', roomNumber: '101' } as any],
        selectedBuilding: 'all',
        selectedCycleCode: '2026-09',
        selectedYear: '2026'
      });

      expect(result.exactVatTotal).toBe('315.00');
      expect(result.vatTotal).toBe(315);
      expect(result.exactTotalBilledThisMonth).toBe('4815.00');
    });
  });

  describe('TIS-05: Total Net Amount Anti-Wrapping', () => {
    it('guarantees min-width: 440px and white-space: nowrap in .total-row', () => {
      const receipt = {
        receiptNumber: 'RC-202609-105-0005',
        issuedAt: '2026-09-15T10:00:00Z',
        dormitoryId: 'dorm-01',
        snapshotData: {
          receiverName: 'สมชาย เจ้าของหอ',
          dormitoryTaxId: '0105559001234',
          tenantName: 'สมปอง',
          roomNumber: '105',
          total: '10302.10',
          subtotal: '9628.13',
          vatAmount: '673.97',
          isVatActive: true,
          items: [{ type: 'rent', description: 'ค่าเช่าห้องพัก', amount: '9628.13', quantity: 1 }]
        }
      };

      const html = renderReceiptHtml(receipt as any);
      expect(html).toContain('min-width: 440px');
      expect(html).toContain('width: 440px');
      expect(html).toContain('.total-row span:first-child { white-space: nowrap; }');
      expect(html).toContain('จำนวนเงินรวมทั้งสิ้น (Total Net Amount):');
    });
  });
});
