/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TenantApprovalModal } from '../components/TenantApprovalModal';
import { TenantRejectSheet, REJECT_REASON_OPTIONS } from '../components/TenantRejectSheet';
import { Room } from '../types';

describe('Tenant Approval & Reject Flow Suite (Dashboard & Tenants Parity)', () => {
  const mockRooms: Room[] = [
    {
      id: 'room-101',
      roomNumber: '101',
      floor: 1,
      buildingId: 'bld-1',
      status: 'vacant',
      monthlyRent: 5000,
      monthlyDeposit: 10000,
      depositAmount: 10000,
      dailyRent: 550,
      termRent: 22000,
      termDeposit: 5500,
      isVacant: true,
      price: 5000,
      amenities: [],
    } as any,
    {
      id: 'room-102',
      roomNumber: '102',
      floor: 1,
      buildingId: 'bld-1',
      status: 'vacant',
      monthlyRent: 5200,
      monthlyDeposit: 10400,
      depositAmount: 10400,
      dailyRent: 600,
      termRent: 23000,
      termDeposit: 5800,
      isVacant: true,
      price: 5200,
      amenities: [],
    } as any,
  ];

  const mockTenant = {
    id: 'reg-req-123',
    tenantName: 'นายวรกิจ ประเสริฐวงศ์',
    name: 'นายวรกิจ ประเสริฐวงศ์',
    phone: '082-345-6789',
    citizenId: '1-1003-99887-12-3',
    rentalType: 'MONTHLY',
    requestedRoomId: 'room-101',
    roomNumber: '101',
    monthlyRent: 5000,
    deposit: 10000,
    depositDeclaredStatus: 'UNPAID',
    moveInDate: '2026-10-01',
  };

  it('CRIT-REJECT-SHEET-RESPONSIVE-AND-CANCEL-01: TenantRejectSheet renders options, custom input when อื่นๆ, and returns on cancel', () => {
    const handleClose = vi.fn();
    const handleConfirm = vi.fn();

    const { rerender } = render(
      <TenantRejectSheet
        isOpen={true}
        onClose={handleClose}
        tenant={{ name: mockTenant.name, phone: mockTenant.phone, roomNumber: '101' }}
        onConfirm={handleConfirm}
      />
    );

    // Title & Tenant info
    expect(screen.getByText('ยืนยันการปฏิเสธคำขอเช่า')).toBeDefined();
    expect(screen.getByText(/ปฏิเสธคำของคุณ นายวรกิจ ประเสริฐวงศ์/i)).toBeDefined();
    expect(screen.getByText(/082-345-6789/i)).toBeDefined();

    // Select options
    const select = screen.getByTestId('reject-reason-select') as HTMLSelectElement;
    expect(select).toBeDefined();
    expect(select.value).toBe('ข้อมูลเอกสารไม่ครบถ้วน');

    // Change to 'อื่นๆ' -> custom reason input appears
    fireEvent.change(select, { target: { value: 'อื่นๆ' } });
    const customInput = screen.getByTestId('reject-custom-reason-input') as HTMLInputElement;
    expect(customInput).toBeDefined();

    fireEvent.change(customInput, { target: { value: 'เอกสารไม่ชัดเจน' } });

    // Click confirm -> calls onConfirm with custom reason
    const confirmBtn = screen.getByTestId('reject-sheet-confirm-btn');
    fireEvent.click(confirmBtn);
    expect(handleConfirm).toHaveBeenCalledWith('เอกสารไม่ชัดเจน');

    // Click cancel
    const cancelBtn = screen.getByTestId('reject-sheet-cancel-btn');
    fireEvent.click(cancelBtn);
    expect(handleClose).toHaveBeenCalled();
  });

  it('CRIT-APPROVAL-MODAL-BUTTON-LAYOUT-02: TenantApprovalModal renders [ยกเลิก] [ปฏิเสธคำขอ] [ยืนยันอนุมัติและรับผู้เช่าเข้าพัก]', () => {
    const handleClose = vi.fn();
    const handleApprove = vi.fn();
    const handleReject = vi.fn();

    render(
      <TenantApprovalModal
        isOpen={true}
        onClose={handleClose}
        tenant={mockTenant}
        rooms={mockRooms}
        onApprove={handleApprove}
        onReject={handleReject}
      />
    );

    // Modal Title
    expect(screen.getByRole('heading', { name: 'ยืนยันอนุมัติและรับผู้เช่าเข้าพัก' })).toBeDefined();

    // Tenant info & room options
    expect(screen.getByText(/นายวรกิจ ประเสริฐวงศ์/i)).toBeDefined();
    expect(screen.getAllByText(/1-1003-99887-12-3/i).length).toBeGreaterThan(0);

    // Buttons
    const cancelBtn = screen.getByTestId('modal-approval-cancel-btn');
    const rejectBtn = screen.getByTestId('modal-approval-reject-btn');
    const confirmBtn = screen.getByTestId('modal-approval-confirm-btn');

    expect(cancelBtn).toBeDefined();
    expect(rejectBtn).toBeDefined();
    expect(confirmBtn).toBeDefined();
    expect(rejectBtn.textContent).toContain('ปฏิเสธคำขอ');
    expect(confirmBtn.textContent).toContain('ยืนยันอนุมัติและรับผู้เช่าเข้าพัก');
  });

  it('CRIT-APPROVAL-MODAL-REJECT-FLOW-03: Clicking [ปฏิเสธคำขอ] in modal opens reject sheet, and cancelling returns to approval modal', async () => {
    const handleClose = vi.fn();
    const handleApprove = vi.fn();
    const handleReject = vi.fn();

    render(
      <TenantApprovalModal
        isOpen={true}
        onClose={handleClose}
        tenant={mockTenant}
        rooms={mockRooms}
        onApprove={handleApprove}
        onReject={handleReject}
      />
    );

    // Click [ปฏิเสธคำขอ]
    const rejectBtn = screen.getByTestId('modal-approval-reject-btn');
    fireEvent.click(rejectBtn);

    // Reject sheet opens
    expect(screen.getByText('ยืนยันการปฏิเสธคำขอเช่า')).toBeDefined();

    // Click cancel on reject sheet -> returns to approval modal without closing it
    const cancelRejectBtn = screen.getByTestId('reject-sheet-cancel-btn');
    fireEvent.click(cancelRejectBtn);

    await waitFor(() => {
      expect(screen.queryByText('ยืนยันการปฏิเสธคำขอเช่า')).toBeNull();
    });

    // Approval modal is still visible
    expect(screen.getByRole('heading', { name: 'ยืนยันอนุมัติและรับผู้เช่าเข้าพัก' })).toBeDefined();
    expect(handleClose).not.toHaveBeenCalled();
  });

  it('CRIT-APPROVAL-MODAL-CONFIRM-APPROVE-04: Clicking [ยืนยันอนุมัติและรับผู้เช่าเข้าพัก] calls onApprove with payload', () => {
    const handleClose = vi.fn();
    const handleApprove = vi.fn();
    const handleReject = vi.fn();

    render(
      <TenantApprovalModal
        isOpen={true}
        onClose={handleClose}
        tenant={mockTenant}
        rooms={mockRooms}
        onApprove={handleApprove}
        onReject={handleReject}
      />
    );

    const confirmBtn = screen.getByTestId('modal-approval-confirm-btn');
    fireEvent.click(confirmBtn);

    expect(handleApprove).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: 'room-101',
        rentalType: 'MONTHLY',
        rentAmount: 5000,
        depositAmount: 10000,
        depositDeclaredStatus: 'UNPAID',
      })
    );
  });

  it('CRIT-BOTTOM-SHEET-PARITY-05: TenantApprovalModal and TenantRejectSheet render Grab Handle and hidden sm:flex close button', () => {
    const handleClose = vi.fn();

    const { rerender } = render(
      <TenantApprovalModal
        isOpen={true}
        onClose={handleClose}
        tenant={mockTenant}
        rooms={mockRooms}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />
    );

    // Approval modal has grab handle
    const approvalGrabHandle = screen.getByTestId('approval-sheet-grab-handle');
    expect(approvalGrabHandle).toBeDefined();

    // Close button has hidden sm:flex (hidden on mobile)
    const approvalCloseBtn = screen.getByTestId('approval-modal-close-btn');
    expect(approvalCloseBtn.className).toContain('hidden sm:flex');

    // Drag down on grab handle > 80px calls onClose
    fireEvent.touchStart(approvalGrabHandle, { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(approvalGrabHandle, { touches: [{ clientY: 200 }] });
    fireEvent.touchEnd(approvalGrabHandle);
    expect(handleClose).toHaveBeenCalled();

    // Test TenantRejectSheet
    const handleCloseReject = vi.fn();
    rerender(
      <TenantRejectSheet
        isOpen={true}
        onClose={handleCloseReject}
        tenant={{ name: mockTenant.name, phone: mockTenant.phone, roomNumber: '101' }}
        onConfirm={vi.fn()}
      />
    );

    // Reject sheet has grab handle
    const rejectGrabHandle = screen.getByTestId('reject-sheet-grab-handle');
    expect(rejectGrabHandle).toBeDefined();

    // Close button has hidden sm:flex
    const rejectCloseBtn = screen.getByTestId('reject-sheet-close-btn');
    expect(rejectCloseBtn.className).toContain('hidden sm:flex');

    // Drag down on grab handle > 80px calls onClose
    fireEvent.touchStart(rejectGrabHandle, { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(rejectGrabHandle, { touches: [{ clientY: 200 }] });
    fireEvent.touchEnd(rejectGrabHandle);
    expect(handleCloseReject).toHaveBeenCalled();
  });
});
