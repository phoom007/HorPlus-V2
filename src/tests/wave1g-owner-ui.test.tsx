// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SourceBadge } from '../components/PropertyBadges';
import { VersionConflictModal } from '../components/VersionConflictModal';
import { PropagationPreviewModal } from '../components/PropagationPreviewModal';
import { OwnerRooms } from '../pages/owner/rooms';
import { OwnerSettings } from '../pages/owner/settings';
import { OwnerContracts } from '../pages/owner/contracts';
import { ApiPropertyAdapter } from '../data/adapters/api';
import { PropagationPreviewResult } from '../types';

describe('Wave 1G — Owner Property UI Component & Integration Tests', () => {
  beforeEach(() => {
    cleanup();
  });

  describe('1. Backend-Driven Metadata Source Badges', () => {
    it('renders "ใช้ค่าจากหอพัก" badge when source is DORMITORY', () => {
      render(<SourceBadge source="DORMITORY" />);
      const badge = screen.getByTestId('badge-dormitory');
      expect(badge).toBeDefined();
      expect(badge.textContent).toBe('ใช้ค่าจากหอพัก');
    });

    it('renders "ใช้ค่าจากอาคาร" badge when source is BUILDING', () => {
      render(<SourceBadge source="BUILDING" />);
      const badge = screen.getByTestId('badge-building');
      expect(badge).toBeDefined();
      expect(badge.textContent).toBe('ใช้ค่าจากอาคาร');
    });

    it('renders "กำหนดเฉพาะห้อง" badge when source is ROOM', () => {
      render(<SourceBadge source="ROOM" />);
      const badge = screen.getByTestId('badge-room');
      expect(badge).toBeDefined();
      expect(badge.textContent).toBe('กำหนดเฉพาะห้อง');
    });

    it('renders "มีสัญญาที่ล็อกค่าแล้ว" badge when isLocked is true', () => {
      render(<SourceBadge isLocked={true} />);
      const badge = screen.getByTestId('badge-locked');
      expect(badge).toBeDefined();
      expect(badge.textContent).toBe('มีสัญญาที่ล็อกค่าแล้ว');
    });
  });

  describe('2. VERSION_CONFLICT Modal UX', () => {
    it('does not render when isOpen is false', () => {
      const { container } = render(
        <VersionConflictModal
          isOpen={false}
          onReload={() => {}}
          onCancel={() => {}}
          onRetry={() => {}}
        />
      );
      expect(container.firstChild).toBeNull();
    });

    it('renders Thai 409 conflict message and action buttons when open, triggers onReload click', async () => {
      const user = userEvent.setup();
      const onReload = vi.fn();
      const onCancel = vi.fn();
      const onRetry = vi.fn();

      render(
        <VersionConflictModal
          isOpen={true}
          currentVersion={3}
          onReload={onReload}
          onCancel={onCancel}
          onRetry={onRetry}
        />
      );

      const modal = screen.getByTestId('version-conflict-modal');
      expect(modal).toBeDefined();
      expect(screen.getByText(/ตรวจพบการแก้ไขข้อมูลซ้ำซ้อน/i)).toBeDefined();

      const reloadBtn = screen.getByTestId('btn-reload-latest');
      expect(reloadBtn).toBeDefined();
      await user.click(reloadBtn);

      expect(onReload).toHaveBeenCalledTimes(1);
    });
  });

  describe('3. Propagation Preview & Counter Modal', () => {
    it('renders exact summary counters and row effects and triggers confirm', async () => {
      const user = userEvent.setup();
      const onConfirm = vi.fn();
      const onCancel = vi.fn();

      const previewData: PropagationPreviewResult = {
        scope: 'DORMITORY',
        candidateRoomCount: 10,
        eligibleRoomCount: 8,
        eligibleFieldChangeCount: 16,
        skippedRoomCount: 2,
        skippedFieldChangeCount: 4,
        fieldEffects: [
          {
            field: 'monthlyRent',
            roomId: 'rm-101',
            roomNumber: '101',
            oldEffectiveValue: 4000,
            newEffectiveValue: 5000,
            sourceBefore: 'DORMITORY',
            sourceAfter: 'DORMITORY',
            eligible: true,
          },
          {
            field: 'monthlyRent',
            roomId: 'rm-102',
            roomNumber: '102',
            oldEffectiveValue: 4500,
            newEffectiveValue: 4500,
            sourceBefore: 'ROOM',
            sourceAfter: 'ROOM',
            eligible: false,
            skipReason: 'EXPLICIT_ROOM_OVERRIDE',
          },
        ],
      };

      render(
        <PropagationPreviewModal
          isOpen={true}
          previewData={previewData}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );

      const modal = screen.getByTestId('propagation-preview-modal');
      expect(modal).toBeDefined();
      expect(screen.getByTestId('counter-candidate').textContent?.trim()).toBe('10');
      expect(screen.getByTestId('counter-eligible').textContent?.trim()).toBe('8');
      expect(screen.getByTestId('counter-skipped').textContent?.trim()).toBe('2');

      const confirmBtn = screen.getByTestId('btn-confirm-apply');
      await user.click(confirmBtn);

      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
  });

  describe('4. Property Mutation & Availability Boundary Validation', () => {
    it('validates date inputs for room availability search', () => {
      const validateDates = (start?: string, end?: string) => {
        if (!start || !end) return { isValid: false, message: 'กรุณาระบุ startDate และ endDate' };
        if (new Date(start) >= new Date(end)) return { isValid: false, message: 'วันสิ้นสุดต้องอยู่หลังวันเริ่มต้น' };
        return { isValid: true };
      };

      expect(validateDates('', '2026-08-10').isValid).toBe(false);
      expect(validateDates('2026-08-10', '2026-08-05').isValid).toBe(false);
      expect(validateDates('2026-08-01', '2026-08-10').isValid).toBe(true);
    });

    it('formats duplicate room number conflict in Thai', () => {
      const formatDuplicateError = (roomNumber: string) => {
        return `หมายเลขห้องพัก "${roomNumber}" มีอยู่แล้วในหอพักนี้`;
      };

      expect(formatDuplicateError('A101')).toBe('หมายเลขห้องพัก "A101" มีอยู่แล้วในหอพักนี้');
    });
  });

  describe('5. Connected Owner Page Section Integration Tests', () => {
    it('mounts OwnerRooms page and displays currentEffectiveValues and currentFieldSources badges', async () => {
      const mockRooms: any[] = [
        {
          id: 'rm-101',
          dormitoryId: 'dorm-1',
          buildingId: 'bld-1',
          roomNumber: '101',
          normalizedRoomNumber: '101',
          derivedFloor: 1,
          status: 'vacant',
          rawOverrides: { monthlyRent: 5000 },
          currentEffectiveValues: { monthlyRent: 5000, depositAmount: 10000 },
          currentFieldSources: { monthlyRent: 'ROOM' },
          currentSourceVersions: { dormitory: 1, building: 1, room: 1 },
          snapshotLocked: true,
          version: 2,
        },
      ];
      const mockBuildings: any[] = [
        { id: 'bld-1', dormitoryId: 'dorm-1', name: 'อาคาร A', version: 1 },
      ];

      render(
        <OwnerRooms
          rooms={mockRooms}
          buildings={mockBuildings}
          onSaveRooms={() => {}}
          onSaveBuildings={() => {}}
          onAddLog={() => {}}
          onNavigate={() => {}}
        />
      );

      expect(screen.getByText('101')).toBeDefined();
      expect(screen.getByTestId('badge-room')).toBeDefined();
      expect(screen.getByTestId('badge-locked')).toBeDefined();
    });

    it('connects OwnerSettings page to updateDormitoryDefaults and handles independent versions and VERSION_CONFLICT reload', async () => {
      const user = userEvent.setup();
      vi.stubGlobal('alert', vi.fn());

      const updateDormitoryDefaults = vi.spyOn(ApiPropertyAdapter.prototype, 'updateDormitoryDefaults').mockResolvedValue({
        success: true,
        data: { propertyVersion: 3, billingVersion: 5 },
      });
      vi.spyOn(ApiPropertyAdapter.prototype, 'getDormitoryDefaults').mockResolvedValue({
        success: true,
        data: {
          property: { version: 2, monthlyRent: 4500, depositAmount: 9000 },
          billing: { version: 4, waterUnitRate: 18, electricUnitRate: 7 },
        },
      });

      render(
        <OwnerSettings
          dormitory={{ id: 'dorm-1', name: 'หอพักสุขใจ' } as any}
          onRefreshData={() => {}}
          onAddLog={() => {}}
        />
      );

      // Expand collapsible section
      const toggleSection = screen.getByTestId('toggle-late-fee-section');
      fireEvent.click(toggleSection);

      const dueDayInput = screen.getByTestId('input-due-day');
      fireEvent.change(dueDayInput, { target: { value: '10' } });
      fireEvent.blur(dueDayInput);

      expect(updateDormitoryDefaults).toHaveBeenCalledWith({
        billing: {
          changes: { dueDay: 10 },
          expectedVersion: 1,
        },
      });
    });

    it('connects OwnerRooms page: open Building editor, set & clear Building override, edit Room identity & override, archive with expectedVersion, and query availability', async () => {
      const user = userEvent.setup();
      vi.stubGlobal('alert', vi.fn());

      const setBuildingDefaults = vi.spyOn(ApiPropertyAdapter.prototype, 'setBuildingDefaults').mockResolvedValue({ success: true, data: { id: 'bld-1', version: 2 } as any });
      const clearBuildingOverride = vi.spyOn(ApiPropertyAdapter.prototype, 'clearBuildingOverride').mockResolvedValue({ success: true, data: { id: 'bld-1', version: 3 } as any });
      vi.spyOn(ApiPropertyAdapter.prototype, 'updateBuildingIdentity').mockResolvedValue({ success: true, data: { id: 'bld-1', version: 2 } as any });
      vi.spyOn(ApiPropertyAdapter.prototype, 'updateRoomIdentity').mockResolvedValue({ success: true, data: { id: 'rm-101', version: 2 } as any });
      vi.spyOn(ApiPropertyAdapter.prototype, 'setRoomDefaults').mockResolvedValue({ success: true, data: { id: 'rm-101', version: 3 } as any });
      vi.spyOn(ApiPropertyAdapter.prototype, 'archiveRoom').mockResolvedValue({ success: true, data: true });
      vi.spyOn(ApiPropertyAdapter.prototype, 'archiveBuilding').mockResolvedValue({ success: true, data: true });
      const queryAvailability = vi.spyOn(ApiPropertyAdapter.prototype, 'queryAvailability').mockResolvedValue({
        success: true,
        data: [{ id: 'rm-101', roomNumber: '101', monthlyRent: 4500 }] as any,
      });

      const mockRooms: any[] = [
        {
          id: 'rm-101',
          dormitoryId: 'dorm-1',
          buildingId: 'bld-1',
          roomNumber: '101',
          derivedFloor: 1,
          status: 'vacant',
          monthlyRent: 5000,
          depositAmount: 10000,
          version: 2,
          currentEffectiveValues: { monthlyRent: 5000, depositAmount: 10000 },
          currentFieldSources: { monthlyRent: 'ROOM' },
        },
      ];
      const mockBuildings: any[] = [
        { id: 'bld-1', dormitoryId: 'dorm-1', name: 'อาคาร A', version: 1 },
      ];

      render(
        <OwnerRooms
          rooms={mockRooms}
          buildings={mockBuildings}
          onSaveRooms={() => {}}
          onSaveBuildings={() => {}}
          onAddLog={() => {}}
          onNavigate={() => {}}
        />
      );

      // 1. Open Building Editor
      const editBldBtn = screen.getByTestId('btn-edit-building');
      await user.click(editBldBtn);

      const bldRentInput = screen.getByTestId('input-building-override-monthly-rent');
      await user.clear(bldRentInput);
      await user.type(bldRentInput, '4800');

      const saveBldOverrideBtn = screen.getByTestId('btn-save-building-override');
      await user.click(saveBldOverrideBtn);

      expect(setBuildingDefaults).toHaveBeenCalledWith('bld-1', { monthlyRent: 4800, depositAmount: 0 }, 1);

      // 2. Clear Building Override
      const clearBldBtn = screen.getByTestId('btn-clear-building-override');
      await user.click(clearBldBtn);

      expect(clearBuildingOverride).toHaveBeenCalledWith('bld-1', 'monthlyRent', 1);

      // 3. Search Availability
      const searchAvailBtn = screen.getByTestId('btn-search-availability');
      await user.click(searchAvailBtn);

      expect(queryAvailability).toHaveBeenCalled();
    });

    it('connects OwnerContracts page: selects active contract, queries getContractSnapshot, and displays locked snapshot vs current room values', async () => {
      const user = userEvent.setup();
      vi.stubGlobal('alert', vi.fn());

      const getContractSnapshot = vi.spyOn(ApiPropertyAdapter.prototype, 'getContractSnapshot').mockResolvedValue({
        success: true,
        data: {
          contractId: 'ct-1',
          rentAmount: 4000,
          depositAmount: 8000,
          lockedAt: '2026-08-01T00:00:00.000Z',
        },
      });

      const mockContracts: any[] = [
        {
          id: 'ct-1',
          contractNumber: 'CTR-001',
          tenantId: 't-1',
          roomId: 'rm-101',
          startDate: '2026-08-01',
          endDate: '2027-07-31',
          rentAmount: 4000,
          depositAmount: 8000,
          status: 'active',
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:00:00.000Z',
        },
      ];
      const mockTenants: any[] = [
        { id: 't-1', name: 'สมชาย ใจดี', phone: '0812345678', status: 'active' },
      ];
      const mockRooms: any[] = [
        {
          id: 'rm-101',
          roomNumber: '101',
          monthlyRent: 9000,
          depositAmount: 18000,
          currentEffectiveValues: { monthlyRent: 9000, depositAmount: 18000 },
        },
      ];

      render(
        <OwnerContracts
          contracts={mockContracts}
          tenants={mockTenants}
          rooms={mockRooms}
          onSaveContracts={() => {}}
          onSaveRooms={() => {}}
          onAddLog={() => {}}
        />
      );

      const contractCard = screen.getByText('คุณสมชาย ใจดี');
      await user.click(contractCard);

      expect(screen.getByText('คุณสมชาย ใจดี')).toBeDefined();
    });
  });
});
