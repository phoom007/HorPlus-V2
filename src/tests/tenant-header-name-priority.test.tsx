import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { TenantHomeTab } from '../pages/tenant/tabs/TenantHomeTab';
import { Tenant } from '../types';

describe('TenantHomeTab Header Name Priority', () => {
  const baseTenant: Tenant = {
    id: 't-123',
    dormitoryId: 'd-123',
    name: 'Phoom',
    phone: '0812345678',
    status: 'active',
  };

  const defaultProps = {
    tenantRoom: { roomNumber: 'A-101', dormitoryName: 'TheRiCH Apartment' },
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

  it('renders registered full name (firstName + lastName) instead of LINE name', () => {
    const tenantWithRealName: Tenant = {
      ...baseTenant,
      firstName: 'สมชาย',
      lastName: 'ใจดี',
      name: 'Phoom', // LINE name
    };

    render(<TenantHomeTab {...defaultProps} localTenant={tenantWithRealName} />);
    expect(screen.getByText('คุณ สมชาย ใจดี')).toBeDefined();
    expect(screen.queryByText('คุณ Phoom')).toBeNull();
  });

  it('renders "ยังไม่ได้ลงทะเบียน" when tenant has no room or status is unregistered', () => {
    const unregisteredTenant: Tenant = {
      ...baseTenant,
      name: 'Phoom',
      status: 'unregistered' as any,
    };

    render(
      <TenantHomeTab
        {...defaultProps}
        hasRoom={false}
        localTenant={unregisteredTenant}
      />
    );
    expect(screen.getByText('ยังไม่ได้ลงทะเบียน')).toBeDefined();
    expect(screen.queryByText('คุณ Phoom')).toBeNull();
  });

  it('renders custom prefix with registered full name', () => {
    const tenantWithPrefix: Tenant = {
      ...baseTenant,
      firstName: 'สมหญิง',
      lastName: 'รักสงบ',
      prefix: 'นางสาว',
    };

    render(<TenantHomeTab {...defaultProps} localTenant={tenantWithPrefix} />);
    expect(screen.getByText('นางสาว สมหญิง รักสงบ')).toBeDefined();
  });
});
