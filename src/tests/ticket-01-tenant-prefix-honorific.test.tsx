import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { TenantHomeTab } from '../pages/tenant/tabs/TenantHomeTab';
import { TenantProfileTab } from '../pages/tenant/tabs/TenantProfileTab';
import { toTenantApiDTO } from '../../server/src/mappers/tenant-api.mapper';
import { Tenant } from '../types';

describe('Ticket 01: Tenant Title Prefix and Honorific Preservation', () => {
  const baseTenant: Tenant = {
    id: 't-123',
    dormitoryId: 'd-123',
    name: 'ภพสดนพนน',
    phone: '0812345678',
    status: 'active',
  };

  const homeTabProps = {
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

  const profileTabProps = {
    tenantRoom: { roomNumber: 'A-101', buildingName: 'A', dormitoryName: 'TheRiCH Apartment' },
    hasRoom: true,
    isEditingInfo: false,
    setIsEditingInfo: () => {},
    vehicles: [],
    coOccupants: [],
    onSaveProfile: async () => {},
    onOpenMoveOutModal: () => {},
  };

  describe('Backend toTenantApiDTO Seam', () => {
    it('preserves prefix and displayName when prefix is provided', () => {
      const raw = {
        id: 't-01',
        dormitoryId: 'd-01',
        tenantNumber: 'TNT-001',
        firstName: 'ภพสดนพนน',
        lastName: '-',
        displayName: 'นาย ภพสดนพนน',
        prefix: 'นาย',
        acceptanceSnapshot: {
          prefix: 'นาย',
        },
      };

      const dto = toTenantApiDTO(raw);
      expect(dto).toBeDefined();
      expect(dto?.prefix).toBe('นาย');
      expect(dto?.displayName).toBe('นาย ภพสดนพนน');
    });

    it('derives prefix from snapshot or displayName if prefix is not on top-level raw', () => {
      const raw = {
        id: 't-02',
        dormitoryId: 'd-01',
        tenantNumber: 'TNT-002',
        firstName: 'สมหญิง',
        lastName: 'รักดี',
        displayName: 'นางสาว สมหญิง รักดี',
      };

      const dto = toTenantApiDTO(raw);
      expect(dto).toBeDefined();
      expect(dto?.displayName).toBe('นางสาว สมหญิง รักดี');
      expect(dto?.prefix).toBe('นางสาว');
    });
  });

  describe('Frontend TenantProfileTab Seam', () => {
    it('renders registered title "นาย ภพสดนพนน" and does NOT prepend "คุณ"', () => {
      const tenant: Tenant = {
        ...baseTenant,
        firstName: 'ภพสดนพนน',
        lastName: '-',
        displayName: 'นาย ภพสดนพนน',
        name: 'นาย ภพสดนพนน',
        prefix: 'นาย' as any,
      };

      render(<TenantProfileTab {...profileTabProps} localTenant={tenant} />);

      // Must display the title "นาย ภพสดนพนน"
      expect(screen.getByText('นาย ภพสดนพนน')).toBeDefined();

      // Must NOT display "คุณภพสดนพนน" or "คุณนาย ภพสดนพนน"
      expect(screen.queryByText('คุณภพสดนพนน')).toBeNull();
      expect(screen.queryByText('คุณนาย ภพสดนพนน')).toBeNull();
      expect(screen.queryByText('คุณ นาย ภพสดนพนน')).toBeNull();
    });

    it('renders custom prefix like "ด.ช. เด็กดี" without "คุณ"', () => {
      const tenant: Tenant = {
        ...baseTenant,
        firstName: 'เด็กดี',
        lastName: 'เรียนเก่ง',
        displayName: 'ด.ช. เด็กดี เรียนเก่ง',
        name: 'ด.ช. เด็กดี เรียนเก่ง',
        prefix: 'ด.ช.' as any,
      };

      render(<TenantProfileTab {...profileTabProps} localTenant={tenant} />);
      expect(screen.getByText('ด.ช. เด็กดี เรียนเก่ง')).toBeDefined();
      expect(screen.queryByText(/คุณ.*เด็กดี/)).toBeNull();
    });
  });

  describe('Frontend TenantHomeTab Seam', () => {
    it('renders registered title "นาย ภพสดนพนน" in greeting without forced "คุณ"', () => {
      const tenant: Tenant = {
        ...baseTenant,
        firstName: 'ภพสดนพนน',
        lastName: '-',
        displayName: 'นาย ภพสดนพนน',
        name: 'ภพสดนพนน',
        prefix: 'นาย' as any,
      };

      render(<TenantHomeTab {...homeTabProps} localTenant={tenant} />);
      expect(screen.getByText('นาย ภพสดนพนน')).toBeDefined();
      expect(screen.queryByText('คุณ ภพสดนพนน')).toBeNull();
      expect(screen.queryByText('คุณภพสดนพนน')).toBeNull();
    });
  });
});
