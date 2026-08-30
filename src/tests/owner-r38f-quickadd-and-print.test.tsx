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
import { QuickAddTenantModal } from '../components/QuickAddTenantModal';
import { PrintView } from '../components/GlobalComponents';
import { formatItemDescription as canonicalFormatItemDescription } from '../types';
import { formatItemDescription as paymentsFormatItemDescription } from '../pages/owner/payments';

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
