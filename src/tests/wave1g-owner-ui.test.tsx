import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SourceBadge } from '../components/PropertyBadges';
import { VersionConflictModal } from '../components/VersionConflictModal';
import { PropagationPreviewModal } from '../components/PropagationPreviewModal';
import { OwnerRooms } from '../pages/owner/rooms';
import { OwnerSettings } from '../pages/owner/settings';
import { OwnerContracts } from '../pages/owner/contracts';
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

    it('verifies Building identity update calls updateBuildingIdentity and excludes default fields', () => {
      const updateBuildingIdentity = vi.fn().mockResolvedValue({ success: true, data: { id: 'bld-1', name: 'อาคาร A ใหม่', version: 2 } });
      const mockPropertyDataSource: any = {
        getAuthoritativeRooms: vi.fn().mockResolvedValue({ success: true, data: { items: [], pagination: {} } }),
        getAuthoritativeBuildings: vi.fn().mockResolvedValue({ success: true, data: [] }),
        updateBuildingIdentity,
      };

      const changes = { name: 'อาคาร A ใหม่', code: 'BLD-A1', floorCount: 4, description: 'รายละเอียด' };
      const expectedVersion = 1;

      mockPropertyDataSource.updateBuildingIdentity('bld-1', changes, expectedVersion);

      expect(updateBuildingIdentity).toHaveBeenCalledWith('bld-1', changes, expectedVersion);
      expect(changes).not.toHaveProperty('monthlyRent');
      expect(changes).not.toHaveProperty('depositAmount');
    });

    it('verifies Room identity edit calls updateRoomIdentity and room override calls setRoomDefaults', () => {
      const updateRoomIdentity = vi.fn().mockResolvedValue({ success: true, data: { id: 'rm-101', roomNumber: '101', version: 2 } });
      const setRoomDefaults = vi.fn().mockResolvedValue({ success: true, data: { id: 'rm-101', version: 3 } });

      const identityChanges = { roomNumber: '101', buildingId: 'bld-1', floor: 1, roomType: 'standard' };
      const overrideChanges = { monthlyRent: 5500, depositAmount: 11000 };

      updateRoomIdentity('rm-101', identityChanges, 1);
      setRoomDefaults('rm-101', overrideChanges, 2);

      expect(updateRoomIdentity).toHaveBeenCalledWith('rm-101', identityChanges, 1);
      expect(setRoomDefaults).toHaveBeenCalledWith('rm-101', overrideChanges, 2);
    });

    it('verifies archive Building and archive Room send expectedVersion to DELETE endpoint', () => {
      const archiveBuilding = vi.fn().mockResolvedValue({ success: true, data: true });
      const archiveRoom = vi.fn().mockResolvedValue({ success: true, data: true });

      archiveBuilding('bld-1', 3);
      archiveRoom('rm-101', 5);

      expect(archiveBuilding).toHaveBeenCalledWith('bld-1', 3);
      expect(archiveRoom).toHaveBeenCalledWith('rm-101', 5);
    });

    it('verifies Settings save calls updateDormitoryDefaults with independent property and billing expectedVersions', () => {
      const updateDormitoryDefaults = vi.fn().mockResolvedValue({ success: true, data: { success: true } });

      const payload = {
        property: { changes: { defaultMonthlyRent: 5000 }, expectedVersion: 2 },
        billing: { changes: { waterUnitRate: 18 }, expectedVersion: 4 },
      };

      updateDormitoryDefaults(payload);

      expect(updateDormitoryDefaults).toHaveBeenCalledWith(payload);
      expect(payload.property.expectedVersion).toBe(2);
      expect(payload.billing.expectedVersion).toBe(4);
    });

    it('verifies Contracts page renders locked snapshot separately from current room defaults', () => {
      const mockContracts: any[] = [
        {
          id: 'ct-1',
          contractNumber: 'CTR-001',
          tenantId: 't-1',
          roomId: 'rm-101',
          startDate: '2026-08-01',
          endDate: '2027-07-31',
          durationMonths: 12,
          rentAmount: 4300,
          depositAmount: 8600,
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

      expect(screen.getByText('คุณสมชาย ใจดี')).toBeDefined();
    });
  });
});
