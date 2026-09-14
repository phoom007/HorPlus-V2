// @vitest-environment jsdom
/**
 * @license Apache-2.0
 * Staff Access Grants & User Management Test Suite (/owner/users)
 * Criteria: SAU-01 through SAU-08
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { OwnerUsers, adaptLineFriend } from '../pages/owner/users';
import { Task009ApiAdapter, LineFriend, StaffDataResponse } from '../data/adapters/task009';
import { consumeLineQuota, getConsumedLineQuota } from '../utils/lineQuota';

describe('Staff Access Grants & User Management Suite (/owner/users)', () => {
  const testDormId = 'dorm-test-uuid-1234';
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};
    const storageMock = {
      getItem: vi.fn((k: string) => mockStorage[k] || null),
      setItem: vi.fn((k: string, v: string) => { mockStorage[k] = String(v); }),
      removeItem: vi.fn((k: string) => { delete mockStorage[k]; }),
      clear: vi.fn(() => { mockStorage = {}; }),
      key: vi.fn(() => null),
      length: 0,
    };
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: storageMock,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'localStorage', {
      value: storageMock,
      writable: true,
      configurable: true,
    });
    sessionStorage.setItem('active_dormitory_selected_for_session', testDormId);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe('SAU-01: Build Integrity & Client Quota Utility', () => {
    it('consumeLineQuota correctly updates localStorage cache and dispatches DOM event', () => {
      const listener = vi.fn();
      window.addEventListener('line-quota-consumed', listener);

      consumeLineQuota('2026-09', 1);
      expect(getConsumedLineQuota('2026-09')).toBe(1);

      consumeLineQuota('2026-09', 2);
      expect(getConsumedLineQuota('2026-09')).toBe(3);

      expect(listener).toHaveBeenCalledTimes(2);
      window.removeEventListener('line-quota-consumed', listener);
    });
  });

  describe('SAU-02: Real LINE Friend Directory & Thai Empty State (F-01)', () => {
    it('adaptLineFriend normalizes backend LineFriend DTO into LineOAFriend format safely', () => {
      const backendFriend: LineFriend = {
        id: 'lf-01',
        displayName: 'Somchai Dev',
        pictureUrl: 'https://example.com/pic.jpg',
        friendStatus: 'FOLLOWING'
      };

      const adapted = adaptLineFriend(backendFriend);
      expect(adapted.id).toBe('lf-01');
      expect(adapted.name).toBe('Somchai Dev');
      expect(adapted.lineDisplayName).toBe('Somchai Dev');
      expect(adapted.avatarColor).toBe('bg-emerald-500');
      expect(adapted.status).toBe('เพื่อนใน LINE');
    });

    it('renders Thai empty state when dormitory has no LINE OA followers', async () => {
      vi.spyOn(Task009ApiAdapter, 'getLineFriends').mockResolvedValue({
        success: true,
        data: []
      });
      vi.spyOn(Task009ApiAdapter, 'getStaff').mockResolvedValue({
        success: true,
        data: {
          permanentOwners: [],
          accessGrants: [],
          slotUsage: { googleOwnersCount: 1, activeGrantsCount: 0, totalUsedSlots: 1, maxSlots: 10 }
        }
      });

      render(<OwnerUsers onAddLog={vi.fn()} dormitoryId={testDormId} />);

      // Open Friend Picker Modal
      const pickBtn = screen.getByText('แตะเพื่อเลือกรายชื่อเพื่อนใน LINE');
      fireEvent.click(pickBtn);

      await waitFor(() => {
        expect(screen.getByText('ยังไม่มีผู้ติดตามใน LINE OA ของหอพัก')).toBeDefined();
        expect(screen.getByText(/กรุณาให้ทีมงานหรือผู้เช่าเพิ่มเพื่อนผ่าน LINE OA/)).toBeDefined();
        expect(screen.getByText('ใช้ลิงก์เข้าโดยตรง (ไม่ผ่านไลน์)')).toBeDefined();
      });
    });
  });

  describe('SAU-03: Dual Grant Creation (LINE-Bound vs Direct Link) (F-02)', () => {
    it('creates a LINE-bound grant with selected friend and calls API with friendId', async () => {
      vi.spyOn(Task009ApiAdapter, 'getLineFriends').mockResolvedValue({
        success: true,
        data: [
          { id: 'friend-101', displayName: 'Manager Ton', friendStatus: 'FOLLOWING' }
        ]
      });
      vi.spyOn(Task009ApiAdapter, 'getStaff').mockResolvedValue({
        success: true,
        data: {
          permanentOwners: [],
          accessGrants: [],
          slotUsage: { googleOwnersCount: 1, activeGrantsCount: 0, totalUsedSlots: 1, maxSlots: 10 }
        }
      });

      const createSpy = vi.spyOn(Task009ApiAdapter, 'createAccessGrant').mockResolvedValue({
        success: true,
        data: {
          bearerUrl: 'https://app.horplus.com/staff-access#raw_token_xyz',
          grant: {
            id: 'grant-new-1',
            roleCode: 'MANAGER',
            lineFriendId: 'friend-101',
            status: 'ACTIVE'
          },
          pushed: true,
          deliveryStatus: 'delivered'
        }
      });

      const mockLog = vi.fn();
      render(<OwnerUsers onAddLog={mockLog} dormitoryId={testDormId} />);

      // Open friend picker and select friend
      fireEvent.click(screen.getByText('แตะเพื่อเลือกรายชื่อเพื่อนใน LINE'));
      await waitFor(() => {
        expect(screen.getByText('Manager Ton')).toBeDefined();
      });
      fireEvent.click(screen.getByText('Manager Ton'));

      // Role selector change to manager
      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: 'manager' } });

      // Click green LINE button
      const submitBtn = screen.getByText(/สร้างและส่งลิงก์ไปยัง LINE/);
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(createSpy).toHaveBeenCalledWith(testDormId, 'friend-101', 'MANAGER');
        expect(mockLog).toHaveBeenCalledWith(
          'ส่งลิงก์สิทธิ์ผ่าน LINE',
          expect.stringContaining('Manager Ton'),
          'LineNotification',
          'grant-new-1'
        );
      });
    });

    it('creates an unassigned Direct Link without selecting a LINE friend', async () => {
      vi.spyOn(Task009ApiAdapter, 'getLineFriends').mockResolvedValue({
        success: true,
        data: []
      });
      vi.spyOn(Task009ApiAdapter, 'getStaff').mockResolvedValue({
        success: true,
        data: {
          permanentOwners: [],
          accessGrants: [],
          slotUsage: { googleOwnersCount: 1, activeGrantsCount: 0, totalUsedSlots: 1, maxSlots: 10 }
        }
      });

      const createSpy = vi.spyOn(Task009ApiAdapter, 'createAccessGrant').mockResolvedValue({
        success: true,
        data: {
          bearerUrl: 'https://app.horplus.com/staff-access#direct_token_123',
          grant: {
            id: 'grant-direct-1',
            roleCode: 'STAFF',
            lineFriendId: null,
            status: 'ACTIVE'
          },
          pushed: false,
          deliveryStatus: null
        }
      });

      const writeTextMock = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, {
        clipboard: { writeText: writeTextMock }
      });

      const mockLog = vi.fn();
      render(<OwnerUsers onAddLog={mockLog} dormitoryId={testDormId} />);

      // Click Indigo button "สร้างลิงก์เข้าใช้ระบบ"
      const createBtn = screen.getByText('สร้างลิงก์เข้าใช้ระบบ');
      fireEvent.click(createBtn);

      await waitFor(() => {
        expect(createSpy).toHaveBeenCalledWith(testDormId, '', 'STAFF');
        expect(writeTextMock).toHaveBeenCalledWith(`${window.location.origin}/staff-access#direct_token_123`);
        expect(screen.getByText('สร้างและคัดลอกลิงก์เรียบร้อยแล้ว')).toBeDefined();
        expect(mockLog).toHaveBeenCalledWith(
          'สร้างลิงก์สิทธิ์นิติบุคคลด่วน',
          expect.stringContaining('grant-direct-1'),
          'TokenAccess',
          'grant-direct-1'
        );
      });
    });

    it('displays error toast with alert styling when API returns an error', async () => {
      vi.spyOn(Task009ApiAdapter, 'getLineFriends').mockResolvedValue({
        success: true,
        data: []
      });
      vi.spyOn(Task009ApiAdapter, 'getStaff').mockResolvedValue({
        success: true,
        data: {
          permanentOwners: [],
          accessGrants: [],
          slotUsage: { googleOwnersCount: 1, activeGrantsCount: 0, totalUsedSlots: 1, maxSlots: 10 }
        }
      });

      vi.spyOn(Task009ApiAdapter, 'createAccessGrant').mockResolvedValue({
        success: false,
        error: { message: 'ระบบไม่สามารถดำเนินการได้ กรุณาลองใหม่อีกครั้ง' }
      });

      render(<OwnerUsers onAddLog={vi.fn()} dormitoryId={testDormId} />);

      const createBtn = screen.getByText('สร้างลิงก์เข้าใช้ระบบ');
      fireEvent.click(createBtn);

      await waitFor(() => {
        expect(screen.getByText('ระบบไม่สามารถดำเนินการได้ กรุณาลองใหม่อีกครั้ง')).toBeDefined();
        const toastEl = screen.getByRole('status');
        expect(toastEl.className).toContain('text-rose-800');
      });
    });
  });

  describe('SAU-04 & SAU-05: Authoritative Staff Listing & Non-Expiring Lifecycle', () => {
    it('renders real access grants loaded from API with permanent active status', async () => {
      vi.spyOn(Task009ApiAdapter, 'getLineFriends').mockResolvedValue({ success: true, data: [] });
      vi.spyOn(Task009ApiAdapter, 'getStaff').mockResolvedValue({
        success: true,
        data: {
          permanentOwners: [],
          accessGrants: [
            {
              id: 'grant-live-1',
              type: 'ACCESS_GRANT',
              lineFriendId: 'f-1',
              displayName: 'Somchai Manager',
              roleCode: 'MANAGER',
              status: 'ACTIVE',
              isPermanent: false,
              canRevoke: true,
              canChangeRole: true
            } as any
          ],
          slotUsage: { googleOwnersCount: 1, activeGrantsCount: 1, totalUsedSlots: 2, maxSlots: 10 }
        }
      });

      render(<OwnerUsers onAddLog={vi.fn()} dormitoryId={testDormId} />);

      await waitFor(() => {
        expect(screen.getByText('Somchai Manager')).toBeDefined();
        expect(screen.getByText('ผู้จัดการ')).toBeDefined();
        expect(screen.getByText('ใช้งานได้')).toBeDefined();
      });
    });
  });

  describe('SAU-06: Secure Bearer Link Format (/staff-access#<token>)', () => {
    it('copies secure hash-fragment link format via Task009ApiAdapter.getCopyLink', async () => {
      vi.spyOn(Task009ApiAdapter, 'getLineFriends').mockResolvedValue({ success: true, data: [] });
      vi.spyOn(Task009ApiAdapter, 'getStaff').mockResolvedValue({
        success: true,
        data: {
          permanentOwners: [],
          accessGrants: [
            {
              id: 'grant-copy-test',
              type: 'ACCESS_GRANT',
              lineFriendId: 'friend-somkid',
              displayName: 'Technician Somkid',
              roleCode: 'STAFF',
              status: 'ACTIVE',
              isPermanent: false,
              canRevoke: true,
              canChangeRole: true
            } as any
          ],
          slotUsage: { googleOwnersCount: 1, activeGrantsCount: 1, totalUsedSlots: 2, maxSlots: 10 }
        }
      });

      const copySpy = vi.spyOn(Task009ApiAdapter, 'getCopyLink').mockResolvedValue({
        success: true,
        data: {
          bearerUrl: 'https://app.horplus.com/staff-access#raw_bearer_secret_999',
          grantId: 'grant-copy-test'
        }
      });

      // Mock navigator.clipboard
      const writeTextMock = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, {
        clipboard: { writeText: writeTextMock }
      });

      render(<OwnerUsers onAddLog={vi.fn()} dormitoryId={testDormId} />);

      await waitFor(() => {
        expect(screen.getByText('Technician Somkid')).toBeDefined();
      });

      // Click copy button
      const copyBtn = screen.getByTitle('คัดลอกลิงก์');
      fireEvent.click(copyBtn);

      await waitFor(() => {
        expect(copySpy).toHaveBeenCalledWith(testDormId, 'grant-copy-test');
        expect(writeTextMock).toHaveBeenCalledWith(`${window.location.origin}/staff-access#raw_bearer_secret_999`);
      });
    });
  });

  describe('SAU-07: Two-Step Revocation Security Flow', () => {
    it('opens 2-step confirmation and calls revokeAccessGrant on final step', async () => {
      vi.spyOn(Task009ApiAdapter, 'getLineFriends').mockResolvedValue({ success: true, data: [] });
      vi.spyOn(Task009ApiAdapter, 'getStaff').mockResolvedValue({
        success: true,
        data: {
          permanentOwners: [],
          accessGrants: [
            {
              id: 'grant-revoke-test',
              type: 'ACCESS_GRANT',
              lineFriendId: 'friend-old',
              displayName: 'Old Staff',
              roleCode: 'STAFF',
              status: 'ACTIVE',
              isPermanent: false,
              canRevoke: true,
              canChangeRole: true
            } as any
          ],
          slotUsage: { googleOwnersCount: 1, activeGrantsCount: 1, totalUsedSlots: 2, maxSlots: 10 }
        }
      });

      const revokeSpy = vi.spyOn(Task009ApiAdapter, 'revokeAccessGrant').mockResolvedValue({
        success: true,
        data: { id: 'grant-revoke-test', status: 'REVOKED' }
      });

      const mockLog = vi.fn();
      render(<OwnerUsers onAddLog={mockLog} dormitoryId={testDormId} />);

      await waitFor(() => {
        expect(screen.getByText('Old Staff')).toBeDefined();
      });

      // Click Trash icon in table
      const deleteBtn = screen.getByTitle('ยกเลิกลิงก์และเพิกถอนสิทธิ์');
      fireEvent.click(deleteBtn);

      // Step 1: Confirmation
      expect(screen.getByText('คุณแน่ใจหรือไม่ที่จะระงับสิทธิ์?')).toBeDefined();
      expect(screen.getByText('ขั้นตอนที่ 1 / 2: ยืนยันปิดลิงก์')).toBeDefined();
      expect(screen.getByText('ถัดไป')).toBeDefined();
      fireEvent.click(screen.getByText('ถัดไป'));

      // Step 2: Warning
      expect(screen.getByText(/เมื่อยืนยันแล้ว พนักงานทุกคนที่ใช้ลิงก์นี้อยู่จะหลุดออกจากระบบ/)).toBeDefined();
      const confirmFinalBtn = screen.getByText('ยืนยันและระงับสิทธิ์ถาวร');
      fireEvent.click(confirmFinalBtn);

      await waitFor(() => {
        expect(revokeSpy).toHaveBeenCalledWith(testDormId, 'grant-revoke-test');
        expect(mockLog).toHaveBeenCalledWith(
          'เพิกถอนลิงก์สิทธิ์นิติบุคคล',
          expect.stringContaining('grant-revoke-test'),
          'TokenAccess',
          'grant-revoke-test'
        );
      });
    });
  });

  describe('SAU-08: UI Layout & Policy Overview Cards Fidelity', () => {
    it('renders all 3 policy overview cards: Owner, Manager, and Staff', () => {
      render(<OwnerUsers onAddLog={vi.fn()} dormitoryId={testDormId} />);

      expect(screen.getByText('เจ้าของหอพัก')).toBeDefined();
      expect(screen.getByText('ผู้จัดการหอพัก')).toBeDefined();
      expect(screen.getByText('ช่าง / แม่บ้าน')).toBeDefined();

      expect(screen.getByText('เข้าถึงได้ทุกหน้าต่าง (11 หน้าต่างหลัก)')).toBeDefined();
      expect(screen.getByText('เข้าถึงได้ 9 หน้าต่างหลัก')).toBeDefined();
      expect(screen.getByText('เข้าถึงได้ 3 หน้าต่างหลัก')).toBeDefined();
    });
  });
});
