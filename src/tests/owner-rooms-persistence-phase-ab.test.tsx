// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OwnerRooms } from '../pages/owner/rooms';
import { ApiPropertyAdapter } from '../data/adapters/api';
import { Room, Building } from '../types';

describe('Owner Rooms — Phase A+B Persistence & OCC Suite', () => {
  beforeEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const mockBuildings: Building[] = [
    { id: 'bld-1', name: 'อาคาร A', floorsCount: 2, version: 1, createdAt: '2026-08-01', updatedAt: '2026-08-01' },
  ];

  const mockRooms: Room[] = [
    {
      id: 'rm-101',
      buildingId: 'bld-1',
      roomNumber: '101',
      floor: 1,
      status: 'vacant',
      rentCycle: 'monthly',
      monthlyRent: 4500,
      termRent: 18000,
      dailyRent: 500,
      depositAmount: 9000,
      maxOccupants: 2,
      initialWaterMeter: 100,
      initialElectricMeter: 1200,
      images: [],
      version: 1,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    },
    {
      id: 'rm-102',
      buildingId: 'bld-1',
      roomNumber: '102',
      floor: 1,
      status: 'occupied',
      currentTenantId: 'tenant-1',
      rentCycle: 'monthly',
      monthlyRent: 4500,
      depositAmount: 9000,
      maxOccupants: 2,
      initialWaterMeter: 100,
      initialElectricMeter: 1200,
      images: [],
      version: 1,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    },
  ];

  describe('1. CREATE ROOM Persistence', () => {
    it('calls ApiPropertyAdapter.createRoom with canonical payload and triggers onSaveRooms', async () => {
      const user = userEvent.setup();
      const onSaveRooms = vi.fn();
      const onAddLog = vi.fn();

      const createRoomSpy = vi.spyOn(ApiPropertyAdapter.prototype, 'createRoom').mockResolvedValue({
        success: true,
        data: {
          id: 'rm-901',
          buildingId: 'bld-1',
          roomNumber: '901',
          floor: 9,
          status: 'vacant',
          rentCycle: 'monthly',
          monthlyRent: 5000,
          depositAmount: 10000,
          maxOccupants: 2,
          initialWaterMeter: 100,
          initialElectricMeter: 1200,
          images: [],
          version: 1,
          createdAt: '2026-08-01',
          updatedAt: '2026-08-01',
        },
      });

      render(
        <OwnerRooms
          rooms={mockRooms}
          buildings={mockBuildings}
          onSaveRooms={onSaveRooms}
          onAddLog={onAddLog}
          onNavigate={() => {}}
        />
      );

      // Click "+ เพิ่มห้องพัก" button
      const addRoomBtn = screen.getByText(/เพิ่มห้องพัก/i);
      await user.click(addRoomBtn);

      // Fill in room number
      const roomNumberInput = screen.getByPlaceholderText('เช่น A101');
      await user.type(roomNumberInput, '901');

      // Submit form
      const saveBtn = screen.getByTestId('btn-save-room');
      await user.click(saveBtn);

      await waitFor(() => {
        expect(createRoomSpy).toHaveBeenCalledTimes(1);
      });

      const calledPayload = createRoomSpy.mock.calls[0][0];
      expect(calledPayload.roomNumber).toBe('901');
      expect(calledPayload.buildingId).toBe('bld-1');
      expect(onSaveRooms).toHaveBeenCalledTimes(1);
    });
  });

  describe('2. UPDATE ROOM Persistence & ExpectedVersion', () => {
    it('calls ApiPropertyAdapter.updateRoom with expectedVersion and editable changes', async () => {
      const user = userEvent.setup();
      const onSaveRooms = vi.fn();
      const onAddLog = vi.fn();

      const updateRoomSpy = vi.spyOn(ApiPropertyAdapter.prototype, 'updateRoom').mockResolvedValue({
        success: true,
        data: {
          ...mockRooms[0],
          monthlyRent: 5200,
          version: 2,
        },
      });

      render(
        <OwnerRooms
          rooms={mockRooms}
          buildings={mockBuildings}
          onSaveRooms={onSaveRooms}
          onAddLog={onAddLog}
          onNavigate={() => {}}
        />
      );

      // Click Edit on Room 101 in Grid view
      const editButtons = screen.getAllByTitle('แก้ไขรายละเอียดห้องพัก');
      await user.click(editButtons[0]);

      // Change monthly rent
      const rentInput = screen.getByPlaceholderText('เช่น 4500');
      await user.clear(rentInput);
      await user.type(rentInput, '5200');

      // Submit form
      const saveBtn = screen.getByTestId('btn-save-room');
      await user.click(saveBtn);

      await waitFor(() => {
        expect(updateRoomSpy).toHaveBeenCalledTimes(1);
      });

      expect(updateRoomSpy).toHaveBeenCalledWith(
        'rm-101',
        expect.objectContaining({
          roomNumber: '101',
          monthlyRent: '5200',
        }),
        1
      );
      expect(onSaveRooms).toHaveBeenCalledTimes(1);
    });
  });

  describe('3. OCC / Version Conflict UX on Room Update', () => {
    it('surfaces VersionConflictModal on 409 conflict and does not silently overwrite', async () => {
      const user = userEvent.setup();
      const onSaveRooms = vi.fn();

      vi.spyOn(ApiPropertyAdapter.prototype, 'updateRoom').mockResolvedValue({
        success: false,
        error: {
          code: 'CONFLICT',
          message: 'ข้อมูลห้องพักถูกแก้ไขโดยผู้อื่น กรุณาโหลดข้อมูลใหม่',
        },
      });

      render(
        <OwnerRooms
          rooms={mockRooms}
          buildings={mockBuildings}
          onSaveRooms={onSaveRooms}
          onAddLog={() => {}}
          onNavigate={() => {}}
        />
      );

      // Open Edit for Room 101
      const editButtons = screen.getAllByTitle('แก้ไขรายละเอียดห้องพัก');
      await user.click(editButtons[0]);

      const rentInput = screen.getByPlaceholderText('เช่น 4500');
      await user.clear(rentInput);
      await user.type(rentInput, '5500');

      const saveBtn = screen.getByTestId('btn-save-room');
      await user.click(saveBtn);

      // Verify conflict modal is shown
      await waitFor(() => {
        expect(screen.getByTestId('version-conflict-modal')).toBeDefined();
      });

      expect(screen.getByText(/ตรวจพบการแก้ไขข้อมูลซ้ำซ้อน/i)).toBeDefined();
      expect(screen.getByTestId('btn-reload-latest')).toBeDefined();
    });
  });

  describe('4. ARCHIVE / DELETE ROOM Persistence', () => {
    it('calls ApiPropertyAdapter.archiveRoom with expectedVersion on delete confirmation', async () => {
      const user = userEvent.setup();
      const onSaveRooms = vi.fn();
      const onAddLog = vi.fn();

      const archiveSpy = vi.spyOn(ApiPropertyAdapter.prototype, 'archiveRoom').mockResolvedValue({
        success: true,
        data: true,
      });

      render(
        <OwnerRooms
          rooms={mockRooms}
          buildings={mockBuildings}
          onSaveRooms={onSaveRooms}
          onAddLog={onAddLog}
          onNavigate={() => {}}
        />
      );

      // Open Edit modal for Room 101 (vacant)
      const editButtons = screen.getAllByTitle('แก้ไขรายละเอียดห้องพัก');
      await user.click(editButtons[0]);

      // Click Delete Room button in modal footer
      const deleteBtn = screen.getByTestId('btn-delete-room');
      await user.click(deleteBtn);

      // Confirm deletion in dialog
      const confirmDeleteBtn = screen.getByText('ลบห้องพักถาวร');
      await user.click(confirmDeleteBtn);

      await waitFor(() => {
        expect(archiveSpy).toHaveBeenCalledTimes(1);
      });

      expect(archiveSpy).toHaveBeenCalledWith('rm-101', 1);
      expect(onSaveRooms).toHaveBeenCalledTimes(1);
      expect(onAddLog).toHaveBeenCalledWith('ลบห้องพัก', expect.stringContaining('101'), 'Room', 'rm-101');
    });
  });

  describe('5. Maintenance Status Toggle with Persistence', () => {
    it('toggles room maintenance status with expectedVersion update in form', async () => {
      const user = userEvent.setup();
      const onSaveRooms = vi.fn();

      const updateRoomSpy = vi.spyOn(ApiPropertyAdapter.prototype, 'updateRoom').mockResolvedValue({
        success: true,
        data: {
          ...mockRooms[0],
          status: 'maintenance',
          version: 2,
        },
      });

      render(
        <OwnerRooms
          rooms={mockRooms}
          buildings={mockBuildings}
          onSaveRooms={onSaveRooms}
          onAddLog={() => {}}
          onNavigate={() => {}}
        />
      );

      // Click Edit on Room 101 (vacant)
      const editButtons = screen.getAllByTitle('แก้ไขรายละเอียดห้องพัก');
      await user.click(editButtons[0]);

      // Click ปิดปรับปรุง in room status selector
      const maintenanceBtn = screen.getByRole('button', { name: 'ปิดปรับปรุง' });
      await user.click(maintenanceBtn);

      // Save room
      const saveBtn = screen.getByTestId('btn-save-room');
      await user.click(saveBtn);

      await waitFor(() => {
        expect(updateRoomSpy).toHaveBeenCalledTimes(1);
      });

      expect(updateRoomSpy).toHaveBeenCalledWith(
        'rm-101',
        expect.objectContaining({
          status: 'maintenance',
        }),
        1
      );
      expect(onSaveRooms).toHaveBeenCalledTimes(1);
    });
  });
});