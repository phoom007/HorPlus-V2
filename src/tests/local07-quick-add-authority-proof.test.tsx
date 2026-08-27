// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QuickAddTenantModal } from '../components/QuickAddTenantModal';
import { formatBaht } from '../components/GlobalComponents';
import { calculateInstallmentSchedule as calculateFrontendSchedule } from '../utils/installmentCalculator';
import { calculateInstallmentSchedule as calculateBackendSchedule } from '../../server/src/utils/installment-calculator.util.js';
import { QuickAddRoomContext } from '../types';

describe('LOCAL-07: Frontend Quick Add UI Authority & Installment Parity Proof', () => {
  beforeEach(() => {
    cleanup();
  });

  afterEach(() => {
    cleanup();
  });

  const mockRegisteredRoom101Context: QuickAddRoomContext = {
    roomId: 'room-101-uuid',
    dormitoryId: 'dorm-registered-uuid',
    roomNumber: '101',
    buildingId: 'bld-a-uuid',
    effective: {
      monthlyRent: 3500,
      termRent: 12000,
      dailyRent: 550,
      depositAmount: 3500,
    },
    building: {
      id: 'bld-a-uuid',
      name: 'อาคาร A',
      termMonths: 4,
      maxTermRentInstallments: 3,
    },
  };

  const mockRoom102OverriddenContext: QuickAddRoomContext = {
    roomId: 'room-102-uuid',
    dormitoryId: 'dorm-registered-uuid',
    roomNumber: '102',
    buildingId: 'bld-a-uuid',
    effective: {
      monthlyRent: 3500,
      termRent: 13500,
      dailyRent: 650,
      depositAmount: 3500,
    },
    building: {
      id: 'bld-a-uuid',
      name: 'อาคาร A',
      termMonths: 4,
      maxTermRentInstallments: 3,
    },
  };

  it('proves TERM tab displays 12,000, initializes installment dropdown to 3 (from building.maxTermRentInstallments), and renders exact 4,000.00 live breakdown', () => {
    render(
      <QuickAddTenantModal
        isOpen={true}
        onClose={vi.fn()}
        context={mockRegisteredRoom101Context}
        onSuccess={vi.fn()}
      />
    );

    // 1. Initial active tab is TERM
    fireEvent.click(screen.getByRole('button', { name: /รายเทอม/ }));

    // 2. Visible initial term rent input is 12,000
    const termRentInput = screen.getByDisplayValue('12000') as HTMLInputElement;
    expect(termRentInput).toBeDefined();

    // 3. Installment select dropdown initializes to 3
    const installmentSelect = screen.getByDisplayValue('3 งวด') as HTMLSelectElement;
    expect(installmentSelect).toBeDefined();
    expect(installmentSelect.value).toBe('3');

    // 4. Live Installment Breakdown Preview
    expect(screen.getByText('ค่าเช่ารายเทอมทั้งหมด:')).toBeDefined();
    expect(screen.getByText(/12,000\.00/)).toBeDefined();
    expect(screen.getByText('ตารางแบ่งชำระรายงวด (3 งวด):')).toBeDefined();
    expect(screen.getByText('งวดที่ 1:')).toBeDefined();
    expect(screen.getByText('งวดที่ 2:')).toBeDefined();
    expect(screen.getByText('งวดที่ 3:')).toBeDefined();
    const fourThousandAmounts = screen.getAllByText('฿4,000.00');
    expect(fourThousandAmounts.length).toBe(3);
  });

  it('proves MONTHLY tab displays 3500 and DAILY tab displays 550 for Room 101', () => {
    render(
      <QuickAddTenantModal
        isOpen={true}
        onClose={vi.fn()}
        context={mockRegisteredRoom101Context}
        onSuccess={vi.fn()}
      />
    );

    // MONTHLY tab
    fireEvent.click(screen.getByRole('button', { name: 'รายเดือน' }));
    const monthlyInput = screen.getByDisplayValue('3500') as HTMLInputElement;
    expect(monthlyInput).toBeDefined();

    // DAILY tab
    fireEvent.click(screen.getByRole('button', { name: 'รายวัน' }));
    const dailyInput = screen.getByDisplayValue('550') as HTMLInputElement;
    expect(dailyInput).toBeDefined();
  });

  it('proves opening Room 102 context displays overridden values 13,500 and 650 without stale cache bleed', () => {
    const { rerender } = render(
      <QuickAddTenantModal
        isOpen={true}
        onClose={vi.fn()}
        context={mockRegisteredRoom101Context}
        onSuccess={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /รายเทอม/ }));
    expect(screen.getByDisplayValue('12000')).toBeDefined();

    // Rerender with Room 102 context
    rerender(
      <QuickAddTenantModal
        isOpen={true}
        onClose={vi.fn()}
        context={mockRoom102OverriddenContext}
        onSuccess={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /รายเทอม/ }));
    // TERM tab shows 13,500
    expect(screen.getByDisplayValue('13500')).toBeDefined();
    const fourThousandFiveHundred = screen.getAllByText('฿4,500.00');
    expect(fourThousandFiveHundred.length).toBe(3);

    // DAILY tab shows 650
    fireEvent.click(screen.getByRole('button', { name: 'รายวัน' }));
    expect(screen.getByDisplayValue('650')).toBeDefined();
  });

  it('proves exact 100% mathematical and string parity between frontend and backend installment calculators', () => {
    const testCases = [
      { rent: 12000, installments: 3 },
      { rent: 10000, installments: 3 },
      { rent: 18000, installments: 2 },
      { rent: 20000, installments: 4 },
      { rent: 15750.50, installments: 3 },
      { rent: 100, installments: 3 },
      { rent: 0, installments: 2 },
      { rent: 5000, installments: 1 },
    ];

    for (const tc of testCases) {
      const fe = calculateFrontendSchedule(tc.rent, tc.installments);
      const be = calculateBackendSchedule(tc.rent, tc.installments);

      expect(fe.length).toBe(be.length);
      for (let i = 0; i < fe.length; i++) {
        expect(fe[i].installmentNo).toBe(be[i].installmentNo);
        expect(fe[i].amount).toBe(be[i].amount);
        expect(fe[i].amountSatang).toBe(be[i].amountSatang);
      }

      // Invariant: sum of satang equals total satang
      const totalExpectedSatang = Math.round(Number(tc.rent) * 100);
      const feSum = fe.reduce((acc, curr) => acc + curr.amountSatang, 0);
      const beSum = be.reduce((acc, curr) => acc + curr.amountSatang, 0);
      if (totalExpectedSatang > 0) {
        expect(feSum).toBe(totalExpectedSatang);
        expect(beSum).toBe(totalExpectedSatang);
      }
    }
  });

  it('proves exactly ONE quick-add-error-box is rendered on validation error and its DOM position is after form fields and before footer buttons', async () => {
    const { container } = render(
      <QuickAddTenantModal
        isOpen={true}
        onClose={vi.fn()}
        context={mockRegisteredRoom101Context}
        onSuccess={vi.fn()}
      />
    );

    // Switch to TERM tab to render rental form
    fireEvent.click(screen.getByRole('button', { name: /รายเทอม/ }));

    const formElement = container.querySelector('form')!;
    expect(formElement).not.toBeNull();

    // Trigger form submit without entering required full name to trigger validation error
    fireEvent.submit(formElement);

    // 1. Assert exactly ONE error box exists in the entire DOM
    await waitFor(() => {
      const errorBoxes = container.querySelectorAll('[data-testid="quick-add-error-box"]');
      expect(errorBoxes.length).toBe(1);
    });
    expect(screen.getByText('กรุณากรอกชื่อ-นามสกุล')).toBeDefined();

    // 2. Assert DOM ordering: form input fields -> error box -> footer buttons
    const submitBtn = screen.getByRole('button', { name: /ยืนยันเพิ่มผู้เช่า/ });
    const formChildren = Array.from(formElement.children);
    const errorBoxElement = container.querySelector('[data-testid="quick-add-error-box"]')!;
    const footerElement = submitBtn.closest('div.pt-3')!;

    const errorIndex = formChildren.indexOf(errorBoxElement);
    const footerIndex = formChildren.indexOf(footerElement);

    expect(errorIndex).toBeGreaterThan(0); // Appears after input field sections
    expect(errorIndex).toBeLessThan(footerIndex); // Appears before footer action buttons
  });
});
