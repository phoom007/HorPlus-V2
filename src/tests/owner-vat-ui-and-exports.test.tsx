import { describe, it, expect } from 'vitest';
import {
  calculateMeterRowPreview,
  RateSnapshotContext,
  RoomPreviewContext,
  TransientRowDraft
} from '../utils/meterBillingCalculator';
import { extractBillDetails, generateRawGridLines, build30ColWorksheet } from '../pages/owner/reports';
import ExcelJS from 'exceljs';

describe('Category-Strict VAT 7% in Meter Billing & Exports', () => {
  it('calculateMeterRowPreview: applies VAT strictly to enabled categories only', () => {
    const rates: RateSnapshotContext = {
      waterBillingType: 'per_unit',
      waterRate: '20.00',
      electricityBillingType: 'per_unit',
      electricityRate: '8.00',
      commonFeeMode: 'per_room',
      commonFee: '200.00',
      internetFeeMode: 'per_room',
      internetFee: '100.00',
      parkingFeeMode: 'free',
      parkingFee: '0.00',
      vatSettings: {
        enabled: true,
        rate: 7,
        appliedCategories: ['commonFee', 'internetFee'] // Only common & internet are taxable!
      }
    };

    const roomCtx: RoomPreviewContext = {
      roomId: 'room-101',
      roomNumber: '101',
      billingSource: 'CONTRACT',
      rentAmount: '3500.00'
    };

    const draft: TransientRowDraft = {
      waterPrev: '100',
      waterCurr: '110', // 10 units * 20 = 200.00 (NOT taxable)
      elecPrev: '200',
      elecCurr: '250',  // 50 units * 8 = 400.00 (NOT taxable)
      peopleCount: 1,
      overdueAmount: '0.00',
      otherFees: []
    };

    const result = calculateMeterRowPreview(roomCtx, rates, draft);

    expect(result.isValid).toBe(true);
    expect(result.waterAmount).toBe('200.00');
    expect(result.elecAmount).toBe('400.00');
    expect(result.commonAmount).toBe('200.00');
    expect(result.internetAmount).toBe('100.00');

    // Subtotal before VAT: water(200) + elec(400) + common(200) + internet(100) = 900.00
    // Taxable subtotal: common(200) + internet(100) = 300.00
    // VAT 7% on 300.00: 21.00
    // Net total: 900.00 + 21.00 = 921.00
    expect(result.subtotalAmount).toBe('900.00');
    expect(result.vatAmount).toBe('21.00');
    expect(result.isVatActive).toBe(true);
    expect(result.totalAmount).toBe('921.00');
  });

  it('calculateMeterRowPreview: leaves totalAmount unchanged when vatSettings.enabled is false', () => {
    const rates: RateSnapshotContext = {
      waterBillingType: 'per_unit',
      waterRate: '20.00',
      electricityBillingType: 'per_unit',
      electricityRate: '8.00',
      commonFeeMode: 'per_room',
      commonFee: '200.00',
      vatSettings: {
        enabled: false,
        rate: 7,
        appliedCategories: ['water', 'electricity', 'commonFee']
      }
    };

    const roomCtx: RoomPreviewContext = {
      roomId: 'room-102',
      roomNumber: '102',
      billingSource: 'CONTRACT',
      rentAmount: '3000.00'
    };

    const draft: TransientRowDraft = {
      waterPrev: '100',
      waterCurr: '105', // 5 * 20 = 100.00
      elecPrev: '200',
      elecCurr: '220',  // 20 * 8 = 160.00
      peopleCount: 1,
      overdueAmount: '0.00',
      otherFees: []
    };

    const result = calculateMeterRowPreview(roomCtx, rates, draft);

    expect(result.isValid).toBe(true);
    // Base: 100 + 160 + 200 = 460.00
    expect(result.subtotalAmount).toBe('460.00');
    expect(result.vatAmount).toBe('0.00');
    expect(result.isVatActive).toBe(false);
    expect(result.totalAmount).toBe('460.00');
  });

  it('calculateMeterRowPreview: calculates VAT on otherFees when other category is enabled', () => {
    const rates: RateSnapshotContext = {
      waterBillingType: 'fixed',
      waterRate: '100.00',
      electricityBillingType: 'fixed',
      electricityRate: '200.00',
      vatSettings: {
        enabled: true,
        rate: 7,
        appliedCategories: ['other'] // Only custom other fees are taxable!
      }
    };

    const roomCtx: RoomPreviewContext = {
      roomId: 'room-103',
      roomNumber: '103',
      billingSource: 'CONTRACT',
      rentAmount: '4000.00'
    };

    const draft: TransientRowDraft = {
      peopleCount: 1,
      overdueAmount: '0.00',
      otherFees: [
        { description: 'ค่าทำความสะอาด', amount: '300.00' }
      ]
    };

    const result = calculateMeterRowPreview(roomCtx, rates, draft);

    // water(100) + elec(200) + other(300) = 600.00
    // Taxable: 300.00
    // VAT 7% on 300: 21.00
    // Net: 621.00
    expect(result.subtotalAmount).toBe('600.00');
    expect(result.vatAmount).toBe('21.00');
    expect(result.totalAmount).toBe('621.00');
  });

  it('extractBillDetails: accurately extracts subtotalAmt, vatAmt, and netTotalAmt', () => {
    const mockBill = {
      id: 'bill-001',
      roomNumber: '201',
      rentAmount: '3500.00',
      waterAmount: '200.00',
      electricAmount: '400.00',
      subtotal: '4100.00',
      vatAmount: '42.00',
      totalAmount: '4142.00',
      paidAmount: '4142.00',
      status: 'paid',
      items: [
        { category: 'rent', amount: '3500.00' },
        { category: 'water', amount: '200.00', metadata: { vatAmount: '14.00' } },
        { category: 'electricity', amount: '400.00', metadata: { vatAmount: '28.00' } }
      ]
    };

    const details = extractBillDetails(mockBill);
    expect(details.subtotalAmt).toBe(4100);
    expect(details.vatAmt).toBe(42);
    expect(details.netTotalAmt).toBe(4142);
  });

  it('generateRawGridLines: includes dedicated VAT columns and sums correctly in CSV export', () => {
    const mockDetails = [
      {
        billId: 'b1',
        roomNumber: '101',
        buildingName: 'อาคาร A',
        floorStr: '1',
        tenantName: 'สมชาย',
        tenantPhone: '0812345678',
        peopleCount: 1,
        vehicleCount: 0,
        billNumber: 'INV-101',
        statusStr: 'ชำระแล้ว',
        paymentMethodStr: 'พร้อมเพย์',
        dueDateStr: '2026-09-05',
        paidDateStr: '2026-09-04',
        rentAmt: 3000,
        waterUnits: 10,
        waterAmt: 200,
        elecUnits: 50,
        elecAmt: 400,
        commonAmt: 100,
        internetAmt: 0,
        parkingAmt: 0,
        otherAmt: 0,
        otherDesc: '-',
        fineAmt: 0,
        discountAmt: 0,
        depositAmt: 0,
        subtotalAmt: 3700,
        vatAmt: 42,
        netTotalAmt: 3742,
        totalBilled: 3742,
        paidAmt: 3742,
        outstandingAmt: 0,
        notes: '-'
      },
      {
        billId: 'b2',
        roomNumber: '102',
        buildingName: 'อาคาร A',
        floorStr: '1',
        tenantName: 'สมหญิง',
        tenantPhone: '0898765432',
        peopleCount: 2,
        vehicleCount: 1,
        billNumber: 'INV-102',
        statusStr: 'ยังไม่ชำระ',
        paymentMethodStr: '-',
        dueDateStr: '2026-09-05',
        paidDateStr: '-',
        rentAmt: 3000,
        waterUnits: 5,
        waterAmt: 100,
        elecUnits: 25,
        elecAmt: 200,
        commonAmt: 100,
        internetAmt: 0,
        parkingAmt: 0,
        otherAmt: 0,
        otherDesc: '-',
        fineAmt: 0,
        discountAmt: 0,
        depositAmt: 0,
        subtotalAmt: 3400,
        vatAmt: 21,
        netTotalAmt: 3421,
        totalBilled: 3421,
        paidAmt: 0,
        outstandingAmt: 3421,
        notes: '-'
      }
    ];

    const grid = generateRawGridLines(mockDetails as any);

    // Headers check: must include statutory VAT columns
    expect(grid.headerLine).toContain('ยอดรวมก่อน VAT (บาท)');
    expect(grid.headerLine).toContain('ภาษีมูลค่าเพิ่ม 7% (บาท)');
    expect(grid.headerLine).toContain('ยอดรวมสุทธิ (บาท)');

    // Row 1 check
    expect(grid.dataRows[0]).toContain('3700.00');
    expect(grid.dataRows[0]).toContain('42.00');
    expect(grid.dataRows[0]).toContain('3742.00');

    // Total row check
    // Sum Subtotal: 3700 + 3400 = 7100.00
    // Sum VAT: 42 + 21 = 63.00
    // Sum Net Total: 3742 + 3421 = 7163.00
    expect(grid.totalRow).toContain('7100.00');
    expect(grid.totalRow).toContain('63.00');
    expect(grid.totalRow).toContain('7163.00');
  });

  it('build30ColWorksheet: creates 32 columns with dedicated VAT columns and valid Excel formulas', () => {
    const mockDetails = [
      {
        billId: 'b1',
        roomNumber: '101',
        buildingName: 'อาคาร A',
        floorStr: '1',
        tenantName: 'สมชาย',
        tenantPhone: '0812345678',
        peopleCount: 1,
        vehicleCount: 0,
        billNumber: 'INV-101',
        statusStr: 'ชำระแล้ว',
        paymentMethodStr: 'พร้อมเพย์',
        dueDateStr: '2026-09-05',
        paidDateStr: '2026-09-04',
        rentAmt: 3000,
        waterUnits: 10,
        waterAmt: 200,
        elecUnits: 50,
        elecAmt: 400,
        commonAmt: 100,
        internetAmt: 0,
        parkingAmt: 0,
        otherAmt: 0,
        otherDesc: '-',
        fineAmt: 0,
        discountAmt: 0,
        depositAmt: 0,
        subtotalAmt: 3700,
        vatAmt: 42,
        netTotalAmt: 3742,
        totalBilled: 3742,
        paidAmt: 3742,
        outstandingAmt: 0,
        notes: '-'
      }
    ];

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('ตารางบิลรายห้อง');
    build30ColWorksheet(ws, mockDetails as any);

    // 1. Headers check: 32 columns
    const headerRow = ws.getRow(1);
    expect(headerRow.cellCount).toBe(32);
    expect(headerRow.getCell(27).value).toBe('ยอดรวมก่อน VAT (บาท)');
    expect(headerRow.getCell(28).value).toBe('ภาษีมูลค่าเพิ่ม 7% (บาท)');
    expect(headerRow.getCell(29).value).toBe('ยอดรวมสุทธิ (บาท)');
    expect(headerRow.getCell(30).value).toBe('ยอดชำระแล้ว (บาท)');
    expect(headerRow.getCell(31).value).toBe('ยอดค้างชำระ (บาท)');
    expect(headerRow.getCell(32).value).toBe('หมายเหตุ');

    // 2. Data row formulas (Row 2)
    const dataRow = ws.getRow(2);
    const subtotalCell = dataRow.getCell(27).value as any;
    expect(subtotalCell.formula).toBe('N2+P2+R2+S2+T2+U2+V2+X2+Y2+Z2');
    expect(subtotalCell.result).toBe(3700);

    const vatCell = dataRow.getCell(28).value;
    expect(vatCell).toBe(42);

    const netTotalCell = dataRow.getCell(29).value as any;
    expect(netTotalCell.formula).toBe('AA2+AB2');
    expect(netTotalCell.result).toBe(3742);

    const paidCell = dataRow.getCell(30).value;
    expect(paidCell).toBe(3742);

    const outstandingCell = dataRow.getCell(31).value as any;
    expect(outstandingCell.formula).toBe('MAX(0, AC2-AD2)');
    expect(outstandingCell.result ?? 0).toBe(0);

    // 3. Total summary row (Row 3)
    const totalRow = ws.getRow(3);
    const totalSubtotalCell = totalRow.getCell(27).value as any;
    expect(totalSubtotalCell.formula).toBe('SUBTOTAL(9, AA2:AA2)');
    expect(totalSubtotalCell.result).toBe(3700);

    const totalVatCell = totalRow.getCell(28).value as any;
    expect(totalVatCell.formula).toBe('SUBTOTAL(9, AB2:AB2)');
    expect(totalVatCell.result).toBe(42);

    const totalNetCell = totalRow.getCell(29).value as any;
    expect(totalNetCell.formula).toBe('SUBTOTAL(9, AC2:AC2)');
    expect(totalNetCell.result).toBe(3742);

    const totalPaidCell = totalRow.getCell(30).value as any;
    expect(totalPaidCell.formula).toBe('SUBTOTAL(9, AD2:AD2)');
    expect(totalPaidCell.result).toBe(3742);

    const totalOutstandingCell = totalRow.getCell(31).value as any;
    expect(totalOutstandingCell.formula).toBe('SUBTOTAL(9, AE2:AE2)');
    expect(totalOutstandingCell.result ?? 0).toBe(0);
  });
});
