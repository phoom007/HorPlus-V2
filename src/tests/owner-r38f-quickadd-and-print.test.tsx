// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * OWNER R3.8f — QuickAdd Money Integrity & Receipt Print Verification Tests
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryClient';
import { QuickAddTenantModal } from '../components/QuickAddTenantModal';
import { PrintView, formatBillingUnit, formatBillingQuantity, formatBillingRate } from '../components/GlobalComponents';
import { formatItemDescription as canonicalFormatItemDescription } from '../types';
import { formatItemDescription as paymentsFormatItemDescription, PaymentsOwnerView } from '../pages/owner/payments';

describe('OWNER R3.8f — QuickAdd Money Type Integrity & Live Preview', () => {
  afterEach(() => {
    cleanup();
  });

  const mockContext = {
    roomId: 'room-101',
    roomNumber: '101',
    dormitoryId: 'dorm-100',
    dormitoryName: 'หอพักทดสอบ',
    effective: {
      monthlyRent: 5000,
      monthlyDeposit: 3000,
      termRent: 20000,
      termDeposit: 4000,
      dailyRent: 800,
      dailyDeposit: 1000,
    },
    building: {
      termMonths: 4,
      maxTermRentInstallments: 2,
    },
  };

  it('TERM Case 1: 20000 rent + 4000 deposit (UNPAID) across 2 installments calculates exact 24,000 agreement total and 14,000 first payment due', async () => {
    render(
      <QuickAddTenantModal
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        context={mockContext as any}
        defaultTab="TERM"
      />
    );

    const termTab = screen.getByTestId('tab-term');
    fireEvent.click(termTab);

    // Enter typed string values
    const rentInput = screen.getByPlaceholderText('ระบุค่าเช่ารายเทอม');
    fireEvent.change(rentInput, { target: { value: '20000' } });

    const depositInput = screen.getAllByRole('spinbutton')[2]; // term deposit input
    fireEvent.change(depositInput, { target: { value: '4000' } });

    // Select 2 installments
    const installmentSelect = screen.getByRole('combobox');
    fireEvent.change(installmentSelect, { target: { value: '2' } });

    // Verify Financial Breakdown using regex
    expect(screen.getAllByText(/20,000.00/).length).toBeGreaterThanOrEqual(1); // totalRent
    expect(screen.getAllByText(/4,000.00/).length).toBeGreaterThanOrEqual(1); // depAmount
    expect(screen.getAllByText(/24,000.00/).length).toBeGreaterThanOrEqual(1); // totalAgreed (NOT 200,004,000.00!)
    expect(screen.getAllByText(/0.00/).length).toBeGreaterThanOrEqual(1); // paidAmt

    // Installments
    expect(screen.getAllByText(/10,000.00/).length).toBeGreaterThanOrEqual(1); // งวดที่ 1
    // First payment due = 10,000 (rent inst 1) + 4,000 (deposit unpaid) = 14,000.00
    expect(screen.getByText(/14,000.00/)).toBeInTheDocument(); // NOT 100,004,000.00!
  });

  it('TERM Case 2: Deposit PAID sets paidAmt=4000, outstanding=20000, and first payment due=10000 (deposit not charged again)', async () => {
    render(
      <QuickAddTenantModal
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        context={mockContext as any}
        defaultTab="TERM"
      />
    );

    const termTab = screen.getByTestId('tab-term');
    fireEvent.click(termTab);

    const rentInput = screen.getByPlaceholderText('ระบุค่าเช่ารายเทอม');
    fireEvent.change(rentInput, { target: { value: '20000' } });

    const depositInput = screen.getAllByRole('spinbutton')[2];
    fireEvent.change(depositInput, { target: { value: '4000' } });

    const installmentSelect = screen.getByRole('combobox');
    fireEvent.change(installmentSelect, { target: { value: '2' } });

    // Toggle deposit status to PAID
    const paidBtn = screen.getByRole('button', { name: 'ชำระแล้ว' });
    fireEvent.click(paidBtn);

    // Verify
    expect(screen.getAllByText(/24,000.00/).length).toBeGreaterThanOrEqual(1); // totalAgreed
    expect(screen.getAllByText(/4,000.00/).length).toBeGreaterThanOrEqual(1); // paidAmt
    expect(screen.getAllByText(/20,000.00/).length).toBeGreaterThanOrEqual(1); // outstanding
    // First payment due should only be installment #1 (10,000.00)
    expect(screen.getAllByText(/10,000.00/).length).toBeGreaterThanOrEqual(1);
  });

  it('MONTHLY Regression: String typed inputs "5000" rent x "2" months + "3000" deposit calculates 10,000 rent and 13,000 agreement total', async () => {
    render(
      <QuickAddTenantModal
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        context={mockContext as any}
        defaultTab="MONTHLY"
      />
    );

    const monthlyTab = screen.getByTestId('tab-monthly');
    fireEvent.click(monthlyTab);

    const durationInput = screen.getAllByRole('spinbutton')[0];
    fireEvent.change(durationInput, { target: { value: '2' } });

    const rentInput = screen.getAllByRole('spinbutton')[1];
    fireEvent.change(rentInput, { target: { value: '5000' } });

    const depositInput = screen.getAllByRole('spinbutton')[2];
    fireEvent.change(depositInput, { target: { value: '3000' } });

    // Verify
    expect(screen.getAllByText(/10,000.00/).length).toBeGreaterThanOrEqual(1); // totalRent (5000 x 2)
    expect(screen.getAllByText(/3,000.00/).length).toBeGreaterThanOrEqual(1); // depAmount
    expect(screen.getAllByText(/13,000.00/).length).toBeGreaterThanOrEqual(1); // totalAgreed (NOT 100003000!)
  });

  it('DAILY Regression: String typed inputs "800" daily rate x 2 days + "1000" deposit calculates 1,600 rent and 2,600 agreement total', async () => {
    render(
      <QuickAddTenantModal
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        context={mockContext as any}
        defaultTab="DAILY"
      />
    );

    const dailyTab = screen.getByTestId('tab-daily');
    fireEvent.click(dailyTab);

    // Set checkout date to tomorrow to create a 2-day inclusive stay (today + tomorrow = 2 days)
    const dateInputs = screen.getAllByPlaceholderText('วว/ดด/ปปปป');
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
    const tomorrowThai = `${String(tomorrow.getDate()).padStart(2, '0')}/${String(tomorrow.getMonth() + 1).padStart(2, '0')}/${tomorrow.getFullYear() + 543}`;

    fireEvent.change(dateInputs[1], { target: { value: tomorrowThai } });
    fireEvent.blur(dateInputs[1]);

    const rateInput = screen.getAllByRole('spinbutton')[0];
    fireEvent.change(rateInput, { target: { value: '800' } });

    const depositInput = screen.getAllByRole('spinbutton')[1];
    fireEvent.change(depositInput, { target: { value: '1000' } });

    // Verify 2-day calculations
    expect(screen.getAllByText(/2 วัน/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/1,600.00/).length).toBeGreaterThanOrEqual(1); // totalRent (800 x 2 days)
    expect(screen.getAllByText(/1,000.00/).length).toBeGreaterThanOrEqual(1); // depAmount
    expect(screen.getAllByText(/2,600.00/).length).toBeGreaterThanOrEqual(1); // totalAgreed (1600 + 1000)
  });
});

describe('OWNER R3.8f — Receipt Print Proof & DOM Cloning', () => {
  afterEach(() => {
    cleanup();
  });

  it('PrintView clones receipt DOM cleanly into top-level #horplus-print-root with visibility and style rules', () => {
    const originalPrint = window.print;
    window.print = vi.fn();

    render(
      <PrintView title="พิมพ์ใบเสร็จ">
        <div data-testid="test-receipt-content">
          <h4>หอพักฮอร์สมาร์ท (HorPlus)</h4>
          <p>เลขที่: RCP-202607-B101</p>
          <table>
            <tbody>
              <tr>
                <td>ค่าเช่าห้องพัก B101</td>
                <td>฿5,500.00</td>
              </tr>
              <tr>
                <td>ค่าน้ำ</td>
                <td>฿300.00</td>
              </tr>
              <tr>
                <td>ค่าไฟฟ้า</td>
                <td>฿800.00</td>
              </tr>
              <tr>
                <td>ค่าส่วนกลาง</td>
                <td>฿200.00</td>
              </tr>
              <tr>
                <td>ค่าที่จอดรถ</td>
                <td>฿300.00</td>
              </tr>
              <tr>
                <td>รวมชำระสุทธิ:</td>
                <td>฿7,100.00</td>
              </tr>
            </tbody>
          </table>
        </div>
      </PrintView>
    );

    const printButton = screen.getByRole('button', { name: /พิมพ์ใบเสร็จ/i });
    fireEvent.click(printButton);

    // Verify cloned root was created on document.body
    const printRoot = document.getElementById('horplus-print-root');
    expect(printRoot).not.toBeNull();
    expect(printRoot?.className).toContain('printable-area');
    expect(printRoot?.parentElement).toBe(document.body);
    expect(printRoot?.textContent).toContain('หอพักฮอร์สมาร์ท (HorPlus)');
    expect(printRoot?.textContent).toContain('RCP-202607-B101');
    expect(printRoot?.textContent).toContain('ค่าเช่าห้องพัก B101');
    expect(printRoot?.textContent).toContain('฿5,500.00');
    expect(printRoot?.textContent).toContain('฿300.00');
    expect(printRoot?.textContent).toContain('฿800.00');
    expect(printRoot?.textContent).toContain('฿200.00');
    expect(printRoot?.textContent).toContain('฿7,100.00');

    // Verify injected style sets visibility: visible and isolates print root
    const printStyle = document.getElementById('horplus-print-style');
    expect(printStyle).not.toBeNull();
    expect(printStyle?.innerHTML).toContain('body > *:not(#horplus-print-root)');
    expect(printStyle?.innerHTML).toContain('display: none !important');
    expect(printStyle?.innerHTML).toContain('#horplus-print-root,');
    expect(printStyle?.innerHTML).toContain('visibility: visible !important');
    expect(printStyle?.innerHTML).toContain('size: A4 portrait');

    // Clean up
    window.dispatchEvent(new Event('afterprint'));
    window.print = originalPrint;
  });

  it('R3.8fR5 Print Lifecycle: supports cancellation, re-triggering without stale data, and clean afterprint removal', () => {
    const originalPrint = window.print;
    window.print = vi.fn();

    const { rerender } = render(
      <PrintView title="พิมพ์ใบเสร็จ">
        <div data-testid="room302-receipt-a">
          <h4>ใบเสร็จรับเงิน</h4>
          <p>เลขที่: RC-202608-302-0001</p>
          <p>ห้อง: 302</p>
          <p>รวมชำระสุทธิ: ฿6,500.00</p>
        </div>
      </PrintView>
    );

    const printButton = screen.getByRole('button', { name: /พิมพ์ใบเสร็จ/i });
    fireEvent.click(printButton);

    // Verify first receipt content
    let printRoot = document.getElementById('horplus-print-root');
    expect(printRoot).not.toBeNull();
    expect(printRoot?.textContent).toContain('RC-202608-302-0001');
    expect(printRoot?.textContent).toContain('฿6,500.00');

    // User cancels print preview (or re-triggers another print with Receipt B without afterprint)
    rerender(
      <PrintView title="พิมพ์ใบเสร็จ">
        <div data-testid="room101-receipt-b">
          <h4>ใบเสร็จรับเงิน</h4>
          <p>เลขที่: RC-202608-101-0005</p>
          <p>ห้อง: 101</p>
          <p>รวมชำระสุทธิ: ฿1,286.00</p>
        </div>
      </PrintView>
    );

    const printButtonB = screen.getByRole('button', { name: /พิมพ์ใบเสร็จ/i });
    fireEvent.click(printButtonB);

    // Verify second receipt content replaced first immediately (no stale data, exactly 1 print root)
    const allRoots = document.querySelectorAll('#horplus-print-root');
    expect(allRoots.length).toBe(1);
    printRoot = document.getElementById('horplus-print-root');
    expect(printRoot?.textContent).toContain('RC-202608-101-0005');
    expect(printRoot?.textContent).toContain('฿1,286.00');
    expect(printRoot?.textContent).not.toContain('RC-202608-302-0001');

    // Dispatch afterprint event
    window.dispatchEvent(new Event('afterprint'));

    // Verify print root is removed cleanly
    printRoot = document.getElementById('horplus-print-root');
    expect(printRoot).toBeNull();
    const printStyle = document.getElementById('horplus-print-style');
    expect(printStyle).toBeNull();

    window.print = originalPrint;
  });
});

describe('OWNER R3.8fR5-B — Internet Terminology Normalization (ค่าอินเทอร์เน็ต)', () => {
  afterEach(() => {
    cleanup();
  });

  it('normalizes legacy and variant internet fee descriptions to canonical "ค่าอินเทอร์เน็ต"', () => {
    // Canonical formatItemDescription
    expect(canonicalFormatItemDescription('ค่าบริการอินเทอร์เน็ตความเร็วสูง')).toBe('ค่าอินเทอร์เน็ต');
    expect(canonicalFormatItemDescription('ค่าบริการอินเทอร์เน็ต')).toBe('ค่าอินเทอร์เน็ต');
    expect(canonicalFormatItemDescription('ค่าอินเทอร์เน็ต')).toBe('ค่าอินเทอร์เน็ต');
    expect(canonicalFormatItemDescription('ค่าบริการอินเทอร์เน็ต (3 คน)')).toBe('ค่าอินเทอร์เน็ต (3 คน)');
    expect(canonicalFormatItemDescription('ค่าอินเทอร์เน็ต (2 คน)')).toBe('ค่าอินเทอร์เน็ต (2 คน)');
    expect(canonicalFormatItemDescription('อินเตอร์เน็ต')).toBe('ค่าอินเทอร์เน็ต');

    // Payments formatItemDescription
    expect(paymentsFormatItemDescription('ค่าบริการอินเทอร์เน็ตความเร็วสูง')).toBe('ค่าอินเทอร์เน็ต');
    expect(paymentsFormatItemDescription('ค่าบริการอินเทอร์เน็ต')).toBe('ค่าอินเทอร์เน็ต');
    expect(paymentsFormatItemDescription('ค่าอินเทอร์เน็ต')).toBe('ค่าอินเทอร์เน็ต');
    expect(paymentsFormatItemDescription('ค่าบริการอินเทอร์เน็ต (3 คน)')).toBe('ค่าอินเทอร์เน็ต (3 คน)');
    expect(paymentsFormatItemDescription('ค่าอินเทอร์เน็ต (2 คน)')).toBe('ค่าอินเทอร์เน็ต (2 คน)');
    expect(paymentsFormatItemDescription('อินเตอร์เน็ต')).toBe('ค่าอินเทอร์เน็ต');
  });

  it('renders "ค่าอินเทอร์เน็ต" on printed receipt without old "ค่าบริการอินเทอร์เน็ตความเร็วสูง"', () => {
    const originalPrint = window.print;
    window.print = vi.fn();

    render(
      <PrintView title="พิมพ์ใบเสร็จ">
        <div data-testid="receipt-with-internet">
          <h4>ใบเสร็จรับเงิน</h4>
          <p>เลขที่: RC-202608-101-0001</p>
          <p>ห้อง: 101</p>
          <table>
            <tbody>
              <tr>
                <td>{paymentsFormatItemDescription('ค่าบริการอินเทอร์เน็ตความเร็วสูง')}</td>
                <td>฿150.00</td>
              </tr>
            </tbody>
          </table>
          <p>รวมชำระสุทธิ: ฿150.00</p>
        </div>
      </PrintView>
    );

    const printButton = screen.getByRole('button', { name: /พิมพ์ใบเสร็จ/i });
    fireEvent.click(printButton);

    const printRoot = document.getElementById('horplus-print-root');
    expect(printRoot).not.toBeNull();
    expect(printRoot?.textContent).toContain('ค่าอินเทอร์เน็ต');
    expect(printRoot?.textContent).not.toContain('ค่าบริการอินเทอร์เน็ตความเร็วสูง');
    expect(printRoot?.textContent).toContain('฿150.00');

    window.dispatchEvent(new Event('afterprint'));
    window.print = originalPrint;
  });
});

describe('OWNER R3.8fR5-C — Itemized Receipts & Thai Billing Units', () => {
  afterEach(() => {
    cleanup();
  });

  it('formatBillingUnit maps internal identifiers to canonical Thai billing units', () => {
    expect(formatBillingUnit('unit')).toBe('หน่วย');
    expect(formatBillingUnit('person')).toBe('คน');
    expect(formatBillingUnit('room')).toBe('ห้อง');
    expect(formatBillingUnit('charge')).toBe('รายการ');
    expect(formatBillingUnit('vehicle')).toBe('คัน');
    expect(formatBillingUnit('month')).toBe('เดือน');
    expect(formatBillingUnit('day')).toBe('วัน');
    expect(formatBillingUnit('installment')).toBe('งวด');
    expect(formatBillingUnit('bill')).toBe('บิล');
    // Pre-localized Thai strings
    expect(formatBillingUnit('หน่วย')).toBe('หน่วย');
    expect(formatBillingUnit('คน')).toBe('คน');
    expect(formatBillingUnit('ห้อง')).toBe('ห้อง');
    expect(formatBillingUnit('รายการ')).toBe('รายการ');
    expect(formatBillingUnit('คัน')).toBe('คัน');
    expect(formatBillingUnit(null)).toBe('');
    expect(formatBillingUnit(undefined)).toBe('');
  });

  it('formatBillingQuantity drops redundant .00 and preserves meaningful decimals with Thai units', () => {
    expect(formatBillingQuantity(1, 'unit')).toBe('1 หน่วย');
    expect(formatBillingQuantity('1.00', 'unit')).toBe('1 หน่วย');
    expect(formatBillingQuantity(0, 'unit')).toBe('0 หน่วย');
    expect(formatBillingQuantity('0.00', 'unit')).toBe('0 หน่วย');
    expect(formatBillingQuantity('1.00', 'room')).toBe('1 ห้อง');
    expect(formatBillingQuantity(2, 'person')).toBe('2 คน');
    expect(formatBillingQuantity('1.00', 'charge')).toBe('1 รายการ');
    expect(formatBillingQuantity(1.5, 'unit')).toBe('1.5 หน่วย');
    expect(formatBillingQuantity(0.75, 'unit')).toBe('0.75 หน่วย');
    expect(formatBillingQuantity(null)).toBe('-');
    expect(formatBillingQuantity(undefined)).toBe('-');
    expect(formatBillingQuantity('')).toBe('-');
  });

  it('formatBillingRate formats 2-decimal rates with "บาท/<หน่วย>" suffix', () => {
    expect(formatBillingRate(18, 'unit')).toBe('18.00 บาท/หน่วย');
    expect(formatBillingRate('18.00', 'unit')).toBe('18.00 บาท/หน่วย');
    expect(formatBillingRate(200, 'room')).toBe('200.00 บาท/ห้อง');
    expect(formatBillingRate(100, 'person')).toBe('100.00 บาท/คน');
    expect(formatBillingRate(150, 'charge')).toBe('150.00 บาท/รายการ');
    expect(formatBillingRate(250, 'vehicle')).toBe('250.00 บาท/คัน');
    expect(formatBillingRate(5000, 'month')).toBe('5,000.00 บาท/เดือน');
    expect(formatBillingRate(800, 'day')).toBe('800.00 บาท/วัน');
    expect(formatBillingRate(null)).toBe('-');
    expect(formatBillingRate(undefined)).toBe('-');
    expect(formatBillingRate('')).toBe('-');
  });

  it('renders single-bill itemized receipt in PrintView with complete item lines, quantities, rates, and totals', () => {
    const originalPrint = window.print;
    window.print = vi.fn();

    render(
      <PrintView title="พิมพ์ใบเสร็จ">
        <div data-testid="single-itemized-receipt">
          <h4>ใบเสร็จรับเงิน</h4>
          <p>เลขที่: RC-202608-101-0001</p>
          <p>ห้อง: 101</p>
          <p>รอบบิล สิงหาคม 2569</p>
          <table>
            <thead>
              <tr>
                <th>รายการ</th>
                <th>จำนวน</th>
                <th>ราคา/หน่วย</th>
                <th>จำนวนเงิน</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{canonicalFormatItemDescription('ค่าน้ำ (10 หน่วย)')}</td>
                <td>{formatBillingQuantity(10, 'unit')}</td>
                <td>{formatBillingRate(18, 'unit')}</td>
                <td>฿180.00</td>
              </tr>
              <tr>
                <td>{canonicalFormatItemDescription('ค่าไฟฟ้า (100 หน่วย)')}</td>
                <td>{formatBillingQuantity(100, 'unit')}</td>
                <td>{formatBillingRate(8, 'unit')}</td>
                <td>฿800.00</td>
              </tr>
              <tr>
                <td>{canonicalFormatItemDescription('ค่าส่วนกลาง')}</td>
                <td>{formatBillingQuantity(1, 'room')}</td>
                <td>{formatBillingRate(200, 'room')}</td>
                <td>฿200.00</td>
              </tr>
              <tr>
                <td>{canonicalFormatItemDescription('ค่าบริการอินเทอร์เน็ตความเร็วสูง')}</td>
                <td>{formatBillingQuantity(1, 'room')}</td>
                <td>{formatBillingRate(150, 'room')}</td>
                <td>฿150.00</td>
              </tr>
              <tr>
                <td colSpan={3}>รวมรับสุทธิ:</td>
                <td>฿1,330.00</td>
              </tr>
            </tbody>
          </table>
        </div>
      </PrintView>
    );

    const printButton = screen.getByRole('button', { name: /พิมพ์ใบเสร็จ/i });
    fireEvent.click(printButton);

    const printRoot = document.getElementById('horplus-print-root');
    expect(printRoot).not.toBeNull();
    // Verify item lines
    expect(printRoot?.textContent).toContain('ค่าน้ำ (10 หน่วย)');
    expect(printRoot?.textContent).toContain('10 หน่วย');
    expect(printRoot?.textContent).toContain('18.00 บาท/หน่วย');
    expect(printRoot?.textContent).toContain('฿180.00');

    expect(printRoot?.textContent).toContain('ค่าไฟ (100 หน่วย)');
    expect(printRoot?.textContent).toContain('100 หน่วย');
    expect(printRoot?.textContent).toContain('8.00 บาท/หน่วย');
    expect(printRoot?.textContent).toContain('฿800.00');

    expect(printRoot?.textContent).toContain('ค่าส่วนกลาง');
    expect(printRoot?.textContent).toContain('1 ห้อง');
    expect(printRoot?.textContent).toContain('200.00 บาท/ห้อง');
    expect(printRoot?.textContent).toContain('฿200.00');

    expect(printRoot?.textContent).toContain('ค่าอินเทอร์เน็ต');
    expect(printRoot?.textContent).not.toContain('ค่าบริการอินเทอร์เน็ตความเร็วสูง');
    expect(printRoot?.textContent).toContain('150.00 บาท/ห้อง');
    expect(printRoot?.textContent).toContain('฿150.00');

    expect(printRoot?.textContent).toContain('รวมรับสุทธิ:');
    expect(printRoot?.textContent).toContain('฿1,330.00');

    window.dispatchEvent(new Event('afterprint'));
    window.print = originalPrint;
  });

  it('renders multi-bill grouped receipt with distinct cycles and allocations instead of opaque bill references', () => {
    const originalPrint = window.print;
    window.print = vi.fn();

    render(
      <PrintView title="พิมพ์ใบเสร็จ">
        <div data-testid="multi-grouped-receipt">
          <h4>ใบเสร็จรับเงิน</h4>
          <p>เลขที่: RC-202608-302-0001</p>
          <p>ห้อง: 302</p>

          {/* Group 1: July 2026 */}
          <div>
            <h5>รอบบิล กรกฎาคม 2569</h5>
            <p>เลขที่บิล: INV-202607-009</p>
            <table>
              <tbody>
                <tr>
                  <td>ค่าเช่าห้องพัก 302</td>
                  <td>{formatBillingQuantity(1, 'room')}</td>
                  <td>{formatBillingRate(3500, 'room')}</td>
                  <td>฿3,500.00</td>
                </tr>
                <tr>
                  <td>ค่าส่วนกลาง</td>
                  <td>{formatBillingQuantity(1, 'room')}</td>
                  <td>{formatBillingRate(500, 'room')}</td>
                  <td>฿500.00</td>
                </tr>
                <tr>
                  <td colSpan={3}>ยอดบิล:</td>
                  <td>฿4,000.00</td>
                </tr>
                <tr>
                  <td colSpan={3}>ยอดรับชำระสำหรับรอบบิลนี้:</td>
                  <td>฿4,000.00</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Group 2: August 2026 */}
          <div>
            <h5>รอบบิล สิงหาคม 2569</h5>
            <p>เลขที่บิล: INV-202608-302-R</p>
            <table>
              <tbody>
                <tr>
                  <td>ค่าเช่าห้องพัก 302 (มัดจำล่วงหน้า)</td>
                  <td>{formatBillingQuantity(1, 'room')}</td>
                  <td>{formatBillingRate(2500, 'room')}</td>
                  <td>฿2,500.00</td>
                </tr>
                <tr>
                  <td colSpan={3}>ยอดบิล:</td>
                  <td>฿2,500.00</td>
                </tr>
                <tr>
                  <td colSpan={3}>ยอดรับชำระสำหรับรอบบิลนี้:</td>
                  <td>฿2,500.00</td>
                </tr>
              </tbody>
            </table>
          </div>

          <p>รวมรับสุทธิ: ฿6,500.00</p>
        </div>
      </PrintView>
    );

    const printButton = screen.getByRole('button', { name: /พิมพ์ใบเสร็จ/i });
    fireEvent.click(printButton);

    const printRoot = document.getElementById('horplus-print-root');
    expect(printRoot).not.toBeNull();
    // Verify July items
    expect(printRoot?.textContent).toContain('รอบบิล กรกฎาคม 2569');
    expect(printRoot?.textContent).toContain('INV-202607-009');
    expect(printRoot?.textContent).toContain('ค่าเช่าห้องพัก 302');
    expect(printRoot?.textContent).toContain('3,500.00 บาท/ห้อง');
    expect(printRoot?.textContent).toContain('฿3,500.00');

    // Verify August items
    expect(printRoot?.textContent).toContain('รอบบิล สิงหาคม 2569');
    expect(printRoot?.textContent).toContain('INV-202608-302-R');
    expect(printRoot?.textContent).toContain('ค่าเช่าห้องพัก 302 (มัดจำล่วงหน้า)');
    expect(printRoot?.textContent).toContain('2,500.00 บาท/ห้อง');
    expect(printRoot?.textContent).toContain('฿2,500.00');

    // Verify Total
    expect(printRoot?.textContent).toContain('รวมรับสุทธิ:');
    expect(printRoot?.textContent).toContain('฿6,500.00');

    window.dispatchEvent(new Event('afterprint'));
    window.print = originalPrint;
  });

  it('renders partial payment receipt displaying full bill items and explicit received allocation without fake proration', () => {
    const originalPrint = window.print;
    window.print = vi.fn();

    render(
      <PrintView title="พิมพ์ใบเสร็จ">
        <div data-testid="partial-payment-receipt">
          <h4>ใบเสร็จรับเงิน</h4>
          <p>เลขที่: RC-202608-104-0001</p>
          <p>ห้อง: 104</p>
          <p>รอบบิล สิงหาคม 2569</p>
          <table>
            <tbody>
              <tr>
                <td>ค่าเช่าห้องพัก 104</td>
                <td>{formatBillingQuantity(1, 'room')}</td>
                <td>{formatBillingRate(3500, 'room')}</td>
                <td>฿3,500.00</td>
              </tr>
              <tr>
                <td>ค่าส่วนกลาง</td>
                <td>{formatBillingQuantity(1, 'room')}</td>
                <td>{formatBillingRate(500, 'room')}</td>
                <td>฿500.00</td>
              </tr>
              <tr>
                <td colSpan={3}>ยอดบิล:</td>
                <td>฿4,000.00</td>
              </tr>
              <tr>
                <td colSpan={3}>ยอดรับชำระในใบเสร็จนี้:</td>
                <td>฿2,000.00</td>
              </tr>
              <tr>
                <td colSpan={3}>รวมรับสุทธิ:</td>
                <td>฿2,000.00</td>
              </tr>
            </tbody>
          </table>
        </div>
      </PrintView>
    );

    const printButton = screen.getByRole('button', { name: /พิมพ์ใบเสร็จ/i });
    fireEvent.click(printButton);

    const printRoot = document.getElementById('horplus-print-root');
    expect(printRoot).not.toBeNull();
    expect(printRoot?.textContent).toContain('ค่าเช่าห้องพัก 104');
    expect(printRoot?.textContent).toContain('ยอดบิล:');
    expect(printRoot?.textContent).toContain('฿4,000.00');
    expect(printRoot?.textContent).toContain('ยอดรับชำระในใบเสร็จนี้:');
    expect(printRoot?.textContent).toContain('฿2,000.00');
    expect(printRoot?.textContent).toContain('รวมรับสุทธิ:');
    expect(printRoot?.textContent).toContain('฿2,000.00');

    window.dispatchEvent(new Event('afterprint'));
    window.print = originalPrint;
  });

  it('PaymentsOwnerView opens itemized receipt modal for single bill and multi-bill groups with localized units', async () => {
    const originalPrint = window.print;
    window.print = vi.fn();

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const mockDormitoryId = 'dorm-itemized-test';
    const mockCycle = { id: 'cycle-aug-2026', cycleCode: '2026-08' };

    const mockPayments = [
      {
        id: 'pay-single-1',
        dormitoryId: mockDormitoryId,
        billId: 'bill-101',
        method: 'CASH',
        amount: 1330,
        status: 'APPROVED',
        paymentDate: '2026-08-28T10:00:00Z',
        createdAt: '2026-08-28T10:00:00Z',
        bill: {
          id: 'bill-101',
          billNumber: 'INV-202608-101',
          billingCycleId: 'cycle-aug-2026',
          roomId: 'room-101',
          tenantId: 'tenant-101',
          totalAmount: 1330,
          paidAmount: 1330,
          outstandingAmount: 0,
          status: 'PAID',
          items: [
            { id: 'it-1', description: 'ค่าน้ำ (10 หน่วย)', amount: 180, quantity: '10.00', unitPrice: '18.00', unit: 'unit' },
            { id: 'it-2', description: 'ค่าไฟ (100 หน่วย)', amount: 800, quantity: '100.00', unitPrice: '8.00', unit: 'unit' },
            { id: 'it-3', description: 'ค่าส่วนกลาง', amount: 200, quantity: '1.00', unitPrice: '200.00', unit: 'room' },
            { id: 'it-4', description: 'ค่าบริการอินเทอร์เน็ตความเร็วสูง', amount: 150, quantity: '1.00', unitPrice: '150.00', unit: 'room' },
          ],
        },
        receipt: {
          id: 'rc-1',
          receiptNumber: 'RC-202608-101-0001',
          totalAmount: 1330,
          issuedAt: '2026-08-28T10:00:00Z',
        },
      },
      {
        id: 'pay-group-1',
        dormitoryId: mockDormitoryId,
        billId: 'bill-302-jul',
        paymentGroupId: 'group-302',
        method: 'BANK_TRANSFER',
        amount: 4000,
        status: 'APPROVED',
        paymentDate: '2026-08-29T10:00:00Z',
        createdAt: '2026-08-29T10:00:00Z',
        bill: {
          id: 'bill-302-jul',
          billNumber: 'INV-202607-009',
          billingCycleId: 'cycle-jul-2026',
          roomId: 'room-302',
          tenantId: 'tenant-302',
          totalAmount: 4000,
          items: [
            { id: 'it-jul-1', description: 'ค่าเช่าห้องพัก 302', amount: 3500, quantity: '1.00', unitPrice: '3500.00', unit: 'room' },
            { id: 'it-jul-2', description: 'ค่าส่วนกลาง', amount: 500, quantity: '1.00', unitPrice: '500.00', unit: 'room' },
          ],
        },
        paymentGroup: {
          id: 'group-302',
          status: 'APPROVED',
          totalAmount: 6500,
          receipts: [
            {
              id: 'rc-group-1',
              receiptNumber: 'RC-202608-302-0001',
              totalAmount: 6500,
              issuedAt: '2026-08-29T10:00:00Z',
            },
          ],
          billTargets: [
            {
              billId: 'bill-302-jul',
              bill: {
                id: 'bill-302-jul',
                billNumber: 'INV-202607-009',
                billingCycleId: 'cycle-jul-2026',
                totalAmount: 4000,
                items: [
                  { id: 'it-jul-1', description: 'ค่าเช่าห้องพัก 302', amount: 3500, quantity: '1.00', unitPrice: '3500.00', unit: 'room' },
                  { id: 'it-jul-2', description: 'ค่าส่วนกลาง', amount: 500, quantity: '1.00', unitPrice: '500.00', unit: 'room' },
                ],
              },
            },
            {
              billId: 'bill-302-aug',
              bill: {
                id: 'bill-302-aug',
                billNumber: 'INV-202608-302-R',
                billingCycleId: 'cycle-aug-2026',
                totalAmount: 2500,
                items: [
                  { id: 'it-aug-1', description: 'ค่าเช่าห้องพัก 302 (มัดจำล่วงหน้า)', amount: 2500, quantity: '1.00', unitPrice: '2500.00', unit: 'room' },
                ],
              },
            },
          ],
          allocations: [
            { id: 'al-1', billId: 'bill-302-jul', allocatedAmount: 4000 },
            { id: 'al-2', billId: 'bill-302-aug', allocatedAmount: 2500 },
          ],
        },
      },
    ];

    queryClient.setQueryData(queryKeys.payments(mockDormitoryId), mockPayments);

    render(
      <QueryClientProvider client={queryClient}>
        <PaymentsOwnerView
          dormitoryId={mockDormitoryId}
          selectedCycleCode="2026-08"
          billingCycles={[
            { id: 'cycle-jul-2026', cycleCode: '2026-07' },
            { id: 'cycle-aug-2026', cycleCode: '2026-08' },
          ]}
          rooms={[
            { id: 'room-101', roomNumber: '101', floor: 1, status: 'occupied', monthlyRent: 4500 } as any,
            { id: 'room-302', roomNumber: '302', floor: 3, status: 'occupied', monthlyRent: 3500 } as any,
          ]}
          tenants={[
            { id: 'tenant-101', displayName: 'สมชาย สบายดี', roomId: 'room-101' } as any,
            { id: 'tenant-302', displayName: 'สมหญิง จริงใจ', roomId: 'room-302' } as any,
          ]}
          bills={[]}
          onAddLog={vi.fn()}
        />
      </QueryClientProvider>
    );

    // Switch to paid tab (ชำระแล้ว)
    const paidTab = screen.getByRole('button', { name: /ชำระแล้ว/i });
    fireEvent.click(paidTab);

    // Click "ใบเสร็จรับเงิน" for Room 101
    const receiptButtons = screen.getAllByRole('button', { name: /ใบเสร็จรับเงิน/i });
    expect(receiptButtons.length).toBeGreaterThanOrEqual(1);

    // Click first receipt button (Room 101 single bill)
    fireEvent.click(receiptButtons[0]);

    // Verify modal is open and has itemized lines with Thai units
    expect(screen.getByText('RC-202608-101-0001', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('10 หน่วย')).toBeInTheDocument();
    expect(screen.getByText('18.00 บาท/หน่วย')).toBeInTheDocument();
    expect(screen.getByText('100 หน่วย')).toBeInTheDocument();
    expect(screen.getByText('8.00 บาท/หน่วย')).toBeInTheDocument();
    expect(screen.getByText('ค่าอินเทอร์เน็ต')).toBeInTheDocument();
    expect(screen.queryByText('ค่าบริการอินเทอร์เน็ตความเร็วสูง')).toBeNull();

    // Close receipt modal
    const closeButtons = screen.getAllByRole('button');
    const closeBtn = closeButtons.find(b => b.querySelector('svg.lucide-x') || b.textContent?.includes('✕'));
    if (closeBtn) fireEvent.click(closeBtn);

    window.print = originalPrint;
  });
});
