import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { TenantHomeTab } from '../pages/tenant/tabs/TenantHomeTab';
import { Tenant } from '../types';

describe('TASK-017: Frontend Responsive & UAT Regression', () => {
  const baseTenant: Tenant = {
    id: 't-uat-1',
    dormitoryId: 'd-uat-1',
    name: 'Somchai Tester',
    phone: '0891234567',
    status: 'active',
  };

  const baseProps = {
    tenantRoom: { roomNumber: '101', dormitoryName: 'TheRiCH Ville' },
    hasRoom: true,
    financialLoading: false,
    financialError: null,
    activeUnpaidBill: null,
    totalNotificationsCount: 0,
    notices: [],
    announcements: [],
    onOpenRoomSwitcher: () => {},
    onOpenNotifications: () => {},
    onOpenInvoice: () => {},
    onOpenPayment: () => {},
    onOpenRepairs: () => {},
    onOpenUtilities: () => {},
    onOpenContract: () => {},
    onOpenMoveOut: () => {},
    onOpenRenewal: () => {},
    onGoToAnnouncements: () => {},
    onStartRegister: () => {},
    onRefresh: () => {},
  };

  it('renders tenant home tab without crashing and displays room number and dormitory name', () => {
    render(<TenantHomeTab {...baseProps} localTenant={baseTenant} />);
    expect(screen.getByText(/ห้อง 101/)).toBeDefined();
    expect(screen.getByText('TheRiCH Ville')).toBeDefined();
    expect(screen.getByText('คุณ Somchai Tester')).toBeDefined();
  });

  it('displays loading state in room button when financialLoading is true', () => {
    render(<TenantHomeTab {...baseProps} localTenant={baseTenant} financialLoading={true} />);
    expect(screen.getByText('กำลังโหลดข้อมูล...')).toBeDefined();
  });

  it('displays zero balance state when tenant has no unpaid bills', () => {
    render(<TenantHomeTab {...baseProps} localTenant={baseTenant} activeUnpaidBill={null} />);
    expect(screen.getByTestId('tenant-zero-balance-card')).toBeDefined();
    expect(screen.getByText('ไม่มีบิลค้างชำระในรอบนี้')).toBeDefined();
  });

  it('displays unpaid bill card and financialError safely when bill is present', () => {
    const unpaidBill: any = {
      id: 'bill-1',
      totalAmount: 4500,
      dueDate: '2026-10-05T00:00:00.000Z',
      payments: [],
    };

    render(
      <TenantHomeTab
        {...baseProps}
        localTenant={baseTenant}
        activeUnpaidBill={unpaidBill}
        financialError="ไม่สามารถโหลดข้อมูลการเงินได้ กรุณาลองใหม่อีกครั้ง"
      />
    );

    expect(screen.getByTestId('tenant-unpaid-card')).toBeDefined();
    expect(screen.getByText(/4,500.00/)).toBeDefined();
    expect(screen.getByText('ไม่สามารถโหลดข้อมูลการเงินได้ กรุณาลองใหม่อีกครั้ง')).toBeDefined();
  });
});
