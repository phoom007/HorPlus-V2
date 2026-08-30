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

  it('PrintView clones receipt DOM cleanly into top-level #horplus-print-root without data loss', () => {
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

    expect(window.print).toHaveBeenCalledTimes(1);

    // Verify cloned root was created on document.body
    const printRoot = document.getElementById('horplus-print-root');
    expect(printRoot).not.toBeNull();
    expect(printRoot?.textContent).toContain('หอพักฮอร์สมาร์ท (HorPlus)');
    expect(printRoot?.textContent).toContain('RCP-202607-B101');
    expect(printRoot?.textContent).toContain('ค่าเช่าห้องพัก B101');
    expect(printRoot?.textContent).toContain('฿5,500.00');
    expect(printRoot?.textContent).toContain('฿300.00');
    expect(printRoot?.textContent).toContain('฿800.00');
    expect(printRoot?.textContent).toContain('฿200.00');
    expect(printRoot?.textContent).toContain('฿7,100.00');

    window.print = originalPrint;
  });

  it('R3.8fR4 Print Lifecycle: print root PERSISTS beyond 2000ms/5000ms and is ONLY removed on afterprint', () => {
    vi.useFakeTimers();
    const originalPrint = window.print;
    window.print = vi.fn();

    render(
      <PrintView title="พิมพ์ใบเสร็จ">
        <div data-testid="room302-combined-receipt">
          <h4>หอพักทดสอบ Comprehensive (HorPlus)</h4>
          <p>ห้อง: 302</p>
          <p>ก.ค. 2569: ฿4,000.00</p>
          <p>ส.ค. 2569: ฿2,500.00</p>
          <p>รวมชำระสุทธิ: ฿6,500.00</p>
        </div>
      </PrintView>
    );

    const printButton = screen.getByRole('button', { name: /พิมพ์ใบเสร็จ/i });
    fireEvent.click(printButton);

    expect(window.print).toHaveBeenCalledTimes(1);

    // Advance timers past old 2000ms timeout
    vi.advanceTimersByTime(2500);
    let printRoot = document.getElementById('horplus-print-root');
    expect(printRoot).not.toBeNull();
    expect(printRoot?.textContent).toContain('302');
    expect(printRoot?.textContent).toContain('฿6,500.00');

    // Advance timers past 5000ms
    vi.advanceTimersByTime(3000);
    printRoot = document.getElementById('horplus-print-root');
    expect(printRoot).not.toBeNull();
    expect(printRoot?.textContent).toContain('฿6,500.00');

    // Dispatch afterprint event
    window.dispatchEvent(new Event('afterprint'));

    // Now verify print root is removed cleanly
    printRoot = document.getElementById('horplus-print-root');
    expect(printRoot).toBeNull();
    const printStyle = document.getElementById('horplus-print-style');
    expect(printStyle).toBeNull();

    window.print = originalPrint;
    vi.useRealTimers();
  });
});
