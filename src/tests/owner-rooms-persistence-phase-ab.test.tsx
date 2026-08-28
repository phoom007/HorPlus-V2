// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OwnerRooms } from '../pages/owner/rooms';
import { ApiPropertyAdapter } from '../data/adapters/api';
import * as DataProviderModule from '../data/dataProvider';
import * as HttpClientModule from '../data/httpClient';
import { Room, Building } from '../types';

describe('Owner Rooms — Phase AB.1 Correctness & Persistence Suite', () => {
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

  describe('1. CREATE ROOM Persistence & Canonical Deposit', () => {
    it('calls ApiPropertyAdapter.createRoom with single canonical depositAmount and status', async () => {
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
          status: 'maintenance',
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

      // Select maintenance status
      const maintenanceBtn = screen.getByRole('button', { name: 'ปิดปรับปรุง' });
      await user.click(maintenanceBtn);

      // Fill canonical deposit
      const depositInput = screen.getByPlaceholderText('เช่น 9000');
      await user.clear(depositInput);
      await user.type(depositInput, '10000');

      // Submit form
      const saveBtn = screen.getByTestId('btn-save-room');
      await user.click(saveBtn);

      await waitFor(() => {
        expect(createRoomSpy).toHaveBeenCalledTimes(1);
      });

      const calledPayload = createRoomSpy.mock.calls[0][0];
      expect(calledPayload.roomNumber).toBe('901');
      expect(calledPayload.buildingId).toBe('bld-1');
      expect(calledPayload.status).toBe('maintenance');
      expect(calledPayload.depositAmount).toBe('10000');
      expect(onSaveRooms).toHaveBeenCalledTimes(1);
    });
  });

  describe('2. UPDATE ROOM Persistence & ExpectedVersion', () => {
    it('calls ApiPropertyAdapter.updateRoom with expectedVersion and editable canonical deposit', async () => {
      const user = userEvent.setup();
      const onSaveRooms = vi.fn();
      const onAddLog = vi.fn();

      const updateRoomSpy = vi.spyOn(ApiPropertyAdapter.prototype, 'updateRoom').mockResolvedValue({
        success: true,
        data: {
          ...mockRooms[0],
          depositAmount: 12000,
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

      // Switch to Grid view
      const gridBtn = screen.getByTitle('ตารางการ์ด (Grid)');
      await user.click(gridBtn);

      // Click Edit on Room 101 in Grid view
      const editButtons = screen.getAllByTitle('แก้ไขรายละเอียดห้องพัก');
      await user.click(editButtons[0]);

      // Change single canonical deposit
      const depositInput = screen.getByPlaceholderText('เช่น 9000');
      await user.clear(depositInput);
      await user.type(depositInput, '12000');

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
          depositAmount: '12000',
        }),
        1
      );
      expect(onSaveRooms).toHaveBeenCalledTimes(1);
    });
  });

  describe('3. OCC / Version Conflict UX & No Fabricated Version', () => {
    it('surfaces VersionConflictModal without fabricated version on 409 conflict and reloads on reload action', async () => {
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

      // Switch to Grid view
      const gridBtn = screen.getByTitle('ตารางการ์ด (Grid)');
      await user.click(gridBtn);

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

      // Click reload latest
      const reloadBtn = screen.getByTestId('btn-reload-latest');
      await user.click(reloadBtn);

      expect(onSaveRooms).toHaveBeenCalledTimes(1);
    });
  });

  describe('4. ARCHIVE ROOM Persistence & Terminology', () => {
    it('uses archive terminology (จัดเก็บห้องพัก) and calls ApiPropertyAdapter.archiveRoom with expectedVersion', async () => {
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

      // Switch to Grid view
      const gridBtn = screen.getByTitle('ตารางการ์ด (Grid)');
      await user.click(gridBtn);

      // Open Edit modal for Room 101 (vacant)
      const editButtons = screen.getAllByTitle('แก้ไขรายละเอียดห้องพัก');
      await user.click(editButtons[0]);

      // Click Archive Room button in modal footer
      const deleteBtn = screen.getByTestId('btn-delete-room');
      expect(deleteBtn.textContent).toContain('จัดเก็บห้องพัก');
      await user.click(deleteBtn);

      // Confirm archive in dialog
      const allArchiveButtons = screen.getAllByRole('button', { name: 'จัดเก็บห้องพัก' });
      // The second button is the one inside ConfirmDialog
      const confirmArchiveBtn = allArchiveButtons[allArchiveButtons.length - 1];
      await user.click(confirmArchiveBtn);

      await waitFor(() => {
        expect(archiveSpy).toHaveBeenCalledTimes(1);
      });

      expect(archiveSpy).toHaveBeenCalledWith('rm-101', 1);
      expect(onSaveRooms).toHaveBeenCalledTimes(1);
      expect(onAddLog).toHaveBeenCalledWith('จัดเก็บห้องพัก', expect.stringContaining('101'), 'Room', 'rm-101');
    });
  });

  describe('5. Fail-Closed Resilience when PropertyDataSource is Unavailable', () => {
    it('fails closed and surfaces error without fake save when properties API is unavailable', async () => {
      const user = userEvent.setup();
      const onSaveRooms = vi.fn();

      const mockProvider: any = {
        properties: undefined,
        rooms: {
          updateRoom: vi.fn(),
        },
      };
      vi.spyOn(DataProviderModule, 'getDataProvider').mockReturnValue(mockProvider);

      render(
        <OwnerRooms
          rooms={mockRooms}
          buildings={mockBuildings}
          onSaveRooms={onSaveRooms}
          onAddLog={() => {}}
          onNavigate={() => {}}
        />
      );

      // Switch to Grid view
      const gridBtn = screen.getByTitle('ตารางการ์ด (Grid)');
      await user.click(gridBtn);

      // Open Edit for Room 101
      const editButtons = screen.getAllByTitle('แก้ไขรายละเอียดห้องพัก');
      await user.click(editButtons[0]);

      // Make a change so form is modified
      const rentInput = screen.getByPlaceholderText('เช่น 4500');
      await user.clear(rentInput);
      await user.type(rentInput, '5500');

      const saveBtn = screen.getByTestId('btn-save-room');
      await user.click(saveBtn);

      await waitFor(() => {
        expect(screen.getByText(/PropertyDataSource unavailable/i)).toBeDefined();
      });

      expect(onSaveRooms).not.toHaveBeenCalled();
      expect(mockProvider.rooms.updateRoom).not.toHaveBeenCalled();
    });
  });

  describe('6. Real ApiPropertyAdapter HTTP Boundary Tests', () => {
    it('formats createRoom request payload correctly for POST /properties/rooms', async () => {
      const httpSpy = vi.spyOn(HttpClientModule, 'httpRequest').mockResolvedValue({
        id: 'rm-created',
        roomNumber: '301',
        buildingId: 'bld-1',
        depositAmount: 9000,
        monthlyRent: 4500,
        version: 1,
      });

      const adapter = new ApiPropertyAdapter();
      const res = await adapter.createRoom({
        buildingId: 'bld-1',
        roomNumber: '301',
        floor: 3,
        status: 'maintenance',
        monthlyRent: 4500,
        depositAmount: 9000,
      });

      expect(res.success).toBe(true);
      expect(httpSpy).toHaveBeenCalledWith(
        'POST',
        '/properties/rooms',
        expect.objectContaining({
          buildingId: 'bld-1',
          roomNumber: '301',
          floor: 3,
          status: 'maintenance',
          monthlyRent: '4500',
          depositAmount: '9000',
        })
      );
    });

    it('formats updateRoom request payload correctly for PUT /properties/rooms/:id with expectedVersion', async () => {
      const httpSpy = vi.spyOn(HttpClientModule, 'httpRequest').mockResolvedValue({
        id: 'rm-101',
        roomNumber: '101',
        monthlyRent: 4800,
        version: 2,
      });

      const adapter = new ApiPropertyAdapter();
      const res = await adapter.updateRoom('rm-101', {
        monthlyRent: 4800,
        depositAmount: 9500,
      }, 1);

      expect(res.success).toBe(true);
      expect(httpSpy).toHaveBeenCalledWith(
        'PUT',
        '/properties/rooms/rm-101',
        expect.objectContaining({
          monthlyRent: '4800',
          depositAmount: '9500',
          expectedVersion: 1,
        })
      );
    });

    it('formats archiveRoom request payload correctly for DELETE /properties/rooms/:id with expectedVersion', async () => {
      const httpSpy = vi.spyOn(HttpClientModule, 'httpRequest').mockResolvedValue({
        success: true,
      });

      const adapter = new ApiPropertyAdapter();
      const res = await adapter.archiveRoom('rm-101', 2);

      expect(res.success).toBe(true);
      expect(httpSpy).toHaveBeenCalledWith(
        'DELETE',
        '/properties/rooms/rm-101',
        { expectedVersion: 2 }
      );
    });
  });
});
