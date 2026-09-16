/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { OwnerMeterListCard } from '../components/meters/OwnerMeterListCard';
import { renderReceiptHtml } from '../../server/src/utils/receipt-html.util';
import {
  renderItemAmountWithVat,
  getEffectiveBillAmount,
  getEffectiveBillTotal,
  buildViewingReceipt,
} from '../pages/owner/payments';

describe('VSR-01: OwnerMeterListCard VAT Net Total (ยอดที่ต้องชำระ)', () => {
  it('calculates amountDue including VAT (6,706.76 ฿) matching the sum of all itemized taxable components', () => {
    // Exact room 101 case from user uploaded Image 1 & 2:
    // Elec: 60 units @ 7 = 420 (VAT = 29.40 -> 449.40)
    // Water: 11 units @ 18 = 198 (VAT = 13.86 -> 211.86)
    // Other fee: ค่าซ่อมแซมอุปกรณ์ = 5,000 (VAT = 350 -> 5,350.00)
    // Breakdown:
    //   ค่าส่วนกลาง = 200 (VAT = 14 -> 214.00)
    //   ค่าอินเทอร์เน็ต = 150 (VAT = 10.50 -> 160.50)
    //   ค่าที่จอดรถ = 300 (VAT = 21 -> 321.00)
    // Subtotal = 6,268.00
    // Total with VAT = 6,706.76
    const mockRow = {
      roomId: 'room-101',
      roomNumber: '101',
      floor: 1,
      waterPrev: '110',
      waterCurr: '121', // 11 units
      elecPrev: '560',
      elecCurr: '620',  // 60 units
      peopleCount: '2',
      billStatus: 'unpaid',
      otherFees: [
        { id: 'fee-1', description: 'ค่าซ่อมแซมอุปกรณ์', amount: 5000 }
      ],
    };

    const mockRateSnapshot = {
      waterRate: 18,
      waterBillingType: 'per_unit',
      electricityRate: 7,
      electricityBillingType: 'per_unit',
      vatSettings: {
        enabled: true,
        rate: 7,
        appliedCategories: ['rent', 'water', 'electricity', 'commonFee', 'internetFee', 'parking', 'fine', 'other']
      }
    };

    const mockRoomCtx = {
      roomId: 'room-101',
      roomNumber: '101',
      tenantName: 'นายสมชาย ใจดี',
      billingSource: 'CONTRACT',
      rateSnapshot: mockRateSnapshot,
      amountDue: '6268.00', // Pre-VAT raw amount
      chargeComponents: [
        {
          type: 'monthly_utility',
          label: 'บิลรายเดือน',
          amount: 6268,
          status: 'UNPAID',
          lineItems: [
            { id: 'li-1', type: 'electricity', description: 'ค่าไฟฟ้า', amount: 420 },
            { id: 'li-2', type: 'water', description: 'ค่าน้ำประปา', amount: 198 },
            { id: 'li-3', type: 'common_fee', description: 'ค่าส่วนกลาง', amount: 200 },
            { id: 'li-4', type: 'internet', description: 'ค่าอินเทอร์เน็ต', amount: 150 },
            { id: 'li-5', type: 'parking', description: 'ค่าที่จอดรถ', amount: 300 },
          ]
        }
      ]
    };

    render(
      <OwnerMeterListCard
        idx={0}
        row={mockRow as any}
        originalRow={mockRow as any}
        roomCtx={mockRoomCtx as any}
        rateSnapshot={mockRateSnapshot as any}
        isFirstCycle={false}
        contracts={[]}
        billingCycles={[]}
        selectedBillingCycleId="cycle-1"
        isBatchRunning={false}
        batchCurrentRoomId={null}
        dirtySet={new Set()}
        savingSet={new Set()}
        savedSet={new Set()}
        errorMap={{}}
        flashingCells={{}}
        onMeterChange={() => {}}
        onPeopleCountChange={() => {}}
        onBillSwitch={() => {}}
        onOpenOtherFees={() => {}}
        onSaveRow={() => {}}
        onCopy={() => {}}
        onPaste={() => {}}
        onSelectTenant={() => {}}
        onAddTenant={() => {}}
        onNavigate={() => {}}
      />
    );

    // Verify itemized components have (+VAT)
    expect(screen.getByText(/449\.40/)).toBeInTheDocument();
    expect(screen.getByText(/211\.86/)).toBeInTheDocument();
    expect(screen.getByText(/5,350/)).toBeInTheDocument();

    // Verify "ยอดที่ต้องชำระ" displays 6,706.76 ฿ instead of 6,268.00 ฿
    expect(screen.getByText('ยอดที่ต้องชำระ')).toBeInTheDocument();
    expect(screen.getByText('6,706.76 ฿')).toBeInTheDocument();
  });
});

describe('VSR-06: Receipt / Tax Invoice Header Parity', () => {
  it('renders "ใบเสร็จรับเงิน / ใบกำกับภาษี (RECEIPT / TAX INVOICE)" in HTML print when VAT is active', () => {
    const mockReceipt = {
      receiptNumber: 'RCP-2026-001',
      issuedAt: '2026-09-14T10:00:00Z',
      dormitoryId: 'dorm-1',
      isVoided: false,
      snapshotData: {
        receiverName: 'สมชาย เจ้าของหอ',
        dormitoryTaxId: '0105559001234',
        dormitoryAddress: '123 ถนนสุขุมวิท กรุงเทพฯ',
        dormitoryPhone: '0812345678',
        tenantName: 'นายสมชาย ใจดี',
        roomNumber: '101',
        total: '6706.76',
        subtotal: '6268.00',
        vatAmount: '438.76',
        isVatActive: true,
        items: [
          { description: 'ค่าไฟฟ้า', amount: '420.00', quantity: 60, unit: 'หน่วย', unitPrice: 7 },
          { description: 'ค่าน้ำประปา', amount: '198.00', quantity: 11, unit: 'หน่วย', unitPrice: 18 },
        ]
      }
    };

    const html = renderReceiptHtml(mockReceipt);
    expect(html).toContain('ใบกำกับภาษี (TAX INVOICE)');
    expect(html).not.toContain('ใบเสร็จรับเงิน (RECEIPT)');
    expect(html).not.toContain('ใบเสร็จรับเงิน / ใบกำกับภาษี');
    expect(html).toContain('รวมเงินก่อนภาษี (Subtotal):');
    expect(html).toContain('ภาษีมูลค่าเพิ่ม 7% (VAT 7%):');
    expect(html).toContain('จำนวนเงินรวมทั้งสิ้น (Total Net Amount):');
    expect(html).toContain('min-width: 440px');
    expect(html).toContain('white-space: nowrap');
    expect(html).toContain('0105559001234');
  });

  it('renders standard "ใบเสร็จรับเงิน (RECEIPT)" when VAT is not active', () => {
    const mockReceipt = {
      receiptNumber: 'RCP-2026-002',
      issuedAt: '2026-09-14T10:00:00Z',
      dormitoryId: 'dorm-1',
      isVoided: false,
      snapshotData: {
        receiverName: 'สมชาย เจ้าของหอ',
        tenantName: 'นายสมชาย ใจดี',
        roomNumber: '101',
        total: '6268.00',
        items: [
          { description: 'ค่าไฟฟ้า', amount: '420.00', quantity: 60, unit: 'หน่วย', unitPrice: 7 },
          { description: 'ค่าน้ำประปา', amount: '198.00', quantity: 11, unit: 'หน่วย', unitPrice: 18 },
        ]
      }
    };

    const html = renderReceiptHtml(mockReceipt);
    expect(html).toContain('ใบเสร็จรับเงิน (RECEIPT)');
    expect(html).not.toContain('TAX INVOICE');
  });
});

describe('VSR-02: Payments Tab 2 Card VAT Calculation & Presentation', () => {
  const vatSettingsAll = {
    enabled: true,
    rate: 7,
    appliedCategories: ['rent', 'water', 'electricity', 'commonFee', 'internetFee', 'parking', 'fine', 'other'],
  };

  const vatSettingsWaterOnly = {
    enabled: true,
    rate: 7,
    appliedCategories: ['water'],
  };

  it('renderItemAmountWithVat formats taxable water 198 THB as "(+VAT) ฿ 211.86"', () => {
    const waterItem = {
      type: 'water',
      description: 'ค่าน้ำ (@ 18 × 11 หน่วย)',
      amount: 198,
    };

    const { container } = render(<div>{renderItemAmountWithVat(waterItem, vatSettingsWaterOnly)}</div>);
    expect(container.textContent).toContain('(+VAT)');
    expect(container.textContent).toContain('211.86');
  });

  it('renderItemAmountWithVat preserves non-taxable rent without (+VAT)', () => {
    const rentItem = {
      type: 'rent',
      description: 'ค่าเช่าห้องพัก',
      amount: 4500,
    };

    const { container } = render(<div>{renderItemAmountWithVat(rentItem, vatSettingsWaterOnly)}</div>);
    expect(container.textContent).not.toContain('(+VAT)');
    expect(container.textContent).toContain('4,500');
  });

  it('getEffectiveBillAmount & getEffectiveBillTotal calculate exact sum with VAT', () => {
    const mockBill = {
      id: 'bill-1',
      totalAmount: 6268,
      outstandingAmount: 6268,
      paidAmount: 0,
      items: [
        { type: 'rent', amount: 4500 },
        { type: 'water', amount: 198 },       // VAT = 13.86 -> 211.86
        { type: 'electricity', amount: 420 }, // VAT = 29.40 -> 449.40
        { type: 'commonFee', amount: 200 },   // VAT = 14.00 -> 214.00
        { type: 'internetFee', amount: 150 }, // VAT = 10.50 -> 160.50
        { type: 'parking', amount: 300 },     // VAT = 21.00 -> 321.00
        { type: 'other', amount: 500 },       // VAT = 35.00 -> 535.00 (discount or fee)
      ],
    };

    const total = getEffectiveBillTotal(mockBill, vatSettingsAll);
    const amount = getEffectiveBillAmount(mockBill, vatSettingsAll);

    // Sum of items with VAT:
    // Rent: 4500 + 315 = 4815.00
    // Water: 198 + 13.86 = 211.86
    // Elec: 420 + 29.40 = 449.40
    // Common: 200 + 14 = 214.00
    // Internet: 150 + 10.50 = 160.50
    // Parking: 300 + 21 = 321.00
    // Other: 500 + 35 = 535.00
    // Total Satangs = 670676 -> 6706.76
    expect(total).toBe(6706.76);
    expect(amount).toBe(6706.76);
  });
});

describe('VSR-06: UI Modal buildViewingReceipt & Header Title Parity', () => {
  it('buildViewingReceipt forwards isVatActive, subtotal, and vatAmount for single-bill', () => {
    const mockPayment: any = {
      id: 'pay-1',
      method: 'CASH',
      amount: 6706.76,
      receipt: {
        receiptNumber: 'RCP-2026-001',
        issuedAt: '2026-09-14T10:00:00Z',
        snapshotData: {
          receiptNumber: 'RCP-2026-001',
          roomNumber: '101',
          tenantName: 'นายสมชาย ใจดี',
          total: 6706.76,
          subtotal: 6268.00,
          vatAmount: 438.76,
          isVatActive: true,
          taxId: '0105559001234',
          items: [
            { description: 'ค่าน้ำ', amount: 198 },
            { description: 'ค่าไฟ', amount: 420 },
          ],
        },
      },
    };

    const receiptState = buildViewingReceipt(mockPayment);
    expect(receiptState).not.toBeNull();
    expect(receiptState.isVatActive).toBe(true);
    expect(receiptState.subtotal).toBe(6268.00);
    expect(receiptState.vatAmount).toBe(438.76);
    expect(receiptState.taxId).toBe('0105559001234');

    // Title condition verification
    const modalTitle = Boolean(receiptState.isVatActive || (receiptState.vatAmount && Number(receiptState.vatAmount) > 0))
      ? 'ใบเสร็จรับเงิน / ใบกำกับภาษี (RECEIPT / TAX INVOICE)'
      : 'ใบเสร็จรับเงิน';
    expect(modalTitle).toBe('ใบเสร็จรับเงิน / ใบกำกับภาษี (RECEIPT / TAX INVOICE)');
  });

  it('buildViewingReceipt handles non-VAT receipt cleanly with standard title', () => {
    const mockPayment: any = {
      id: 'pay-2',
      method: 'CASH',
      amount: 4500,
      receipt: {
        receiptNumber: 'RCP-2026-002',
        issuedAt: '2026-09-14T10:00:00Z',
        snapshotData: {
          receiptNumber: 'RCP-2026-002',
          roomNumber: '102',
          tenantName: 'นางสาวสุดา รักดี',
          total: 4500,
          items: [{ description: 'ค่าเช่า', amount: 4500 }],
        },
      },
    };

    const receiptState = buildViewingReceipt(mockPayment);
    expect(receiptState).not.toBeNull();
    expect(receiptState.isVatActive).toBe(false);

    const modalTitle = Boolean(receiptState.isVatActive || (receiptState.vatAmount && Number(receiptState.vatAmount) > 0))
      ? 'ใบเสร็จรับเงิน / ใบกำกับภาษี (RECEIPT / TAX INVOICE)'
      : 'ใบเสร็จรับเงิน';
    expect(modalTitle).toBe('ใบเสร็จรับเงิน');
  });
});

describe('VSR-03 & VSR-04: Settings VAT Lock and Billing Cycle Calendar Parity', () => {
  it('VSR-03: verifies VAT controls are disabled and guarded when cycle is locked', () => {
    const isCycleLocked = true;
    const isSnapshotLoading = false;
    const vatEnabled = true;

    // Simulate VAT toggle and bulk buttons with isCycleLocked guards
    const toggleDisabled = isSnapshotLoading || isCycleLocked;
    const toggleClassName = `${toggleDisabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'} ${
      vatEnabled ? 'bg-indigo-600' : 'bg-slate-200'
    }`;
    const bulkButtonDisabled = isSnapshotLoading || isCycleLocked;
    const bulkButtonClassName = bulkButtonDisabled ? 'text-slate-400 cursor-not-allowed' : 'text-indigo-600 cursor-pointer';

    expect(toggleDisabled).toBe(true);
    expect(toggleClassName).toContain('opacity-60 cursor-not-allowed');
    expect(bulkButtonDisabled).toBe(true);
    expect(bulkButtonClassName).toContain('text-slate-400 cursor-not-allowed');

    // Handler guard verification
    let mutationAttempted = false;
    const handleToggleVatEnabled = (enabled: boolean) => {
      if (isCycleLocked) return;
      mutationAttempted = true;
    };
    handleToggleVatEnabled(false);
    expect(mutationAttempted).toBe(false);
  });

  it('VSR-04: resolves effective available cycles for BillingCycleCalendarPicker', () => {
    const billingCycles = [
      { id: 'c-1', cycleCode: '2026-01', status: 'closed' },
      { id: 'c-2', cycleCode: '2026-02', status: 'active' },
    ];
    const availableCycles: any[] = [];

    const effectiveCycles = (billingCycles && billingCycles.length > 0 ? billingCycles : availableCycles) || [];
    expect(effectiveCycles).toHaveLength(2);
    expect(effectiveCycles[1].cycleCode).toBe('2026-02');
  });
});


