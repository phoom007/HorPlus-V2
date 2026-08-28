// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryClient';
import { meterDraftStore } from '../lib/meterDraftStore';
import { invalidateRoomMutationCaches, RoomMutationImpact } from '../lib/roomMutationCache';
import { OwnerRooms } from '../pages/owner/rooms';
import { ApiPropertyAdapter } from '../data/adapters/api';
import { Room, Building } from '../types';

describe('Owner Rooms — Phase C.1 Precise Cache Invalidation Suite', () => {
  let testQueryClient: QueryClient;

  beforeEach(() => {
    cleanup();
    vi.restoreAllMocks();
    testQueryClient = new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 60_000,
          retry: false,
        },
      },
    });
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
  ];

  describe('Test 1: Price, Deposit, Status, and Refresh do NOT invalidate Preview Context', () => {
    it.each([
      { impact: { kind: 'update' as const, roomNumberChanged: false }, desc: 'update without roomNumber change (price/deposit/floor/capacity)' },
      { impact: { kind: 'status' as const }, desc: 'status toggle (vacant <-> maintenance)' },
      { impact: { kind: 'refresh' as const }, desc: 'OCC conflict refresh' },
    ])('proves $desc invalidates rooms but leaves all preview contexts and workspace untouched', ({ impact }) => {
      const dormId = 'dorm-A';
      const cycle1 = 'cycle-2026-08';
      const cycle2 = 'cycle-2026-09';

      // Seed queries
      testQueryClient.setQueryData(queryKeys.rooms(dormId), mockRooms);
      testQueryClient.setQueryData(queryKeys.meterPreviewContext(dormId, cycle1), { rooms: [{ roomId: 'rm-101', roomNumber: '101' }] });
      testQueryClient.setQueryData(queryKeys.meterPreviewContext(dormId, cycle2), { rooms: [{ roomId: 'rm-101', roomNumber: '101' }] });
      testQueryClient.setQueryData(queryKeys.meterWorkspace(dormId, cycle1), { serverReadings: [] });
      testQueryClient.setQueryData(queryKeys.tenants(dormId), [{ id: 't-1' }]);
      testQueryClient.setQueryData(queryKeys.contracts(dormId), [{ id: 'c-1' }]);
      testQueryClient.setQueryData(queryKeys.bills(dormId), [{ id: 'b-1' }]);

      // Call REAL production helper
      invalidateRoomMutationCaches(testQueryClient, dormId, impact);

      // Rooms must be invalidated
      expect(testQueryClient.getQueryState(queryKeys.rooms(dormId))?.isInvalidated).toBe(true);

      // Meter preview contexts must NOT be invalidated
      expect(testQueryClient.getQueryState(queryKeys.meterPreviewContext(dormId, cycle1))?.isInvalidated).toBe(false);
      expect(testQueryClient.getQueryState(queryKeys.meterPreviewContext(dormId, cycle2))?.isInvalidated).toBe(false);

      // Meter workspace and unrelated resources must NOT be invalidated
      expect(testQueryClient.getQueryState(queryKeys.meterWorkspace(dormId, cycle1))?.isInvalidated).toBe(false);
      expect(testQueryClient.getQueryState(queryKeys.tenants(dormId))?.isInvalidated).toBe(false);
      expect(testQueryClient.getQueryState(queryKeys.contracts(dormId))?.isInvalidated).toBe(false);
      expect(testQueryClient.getQueryState(queryKeys.bills(dormId))?.isInvalidated).toBe(false);
    });
  });

  describe('Test 2: Room Rename invalidates all preview cycles in the SAME dorm only', () => {
    it('invalidates rooms and all cached preview contexts for Dorm A, but leaves Dorm B and workspace untouched', () => {
      const dormA = 'dorm-A';
      const dormB = 'dorm-B';
      const cycle1 = 'cycle-2026-08';
      const cycle2 = 'cycle-2026-09';

      // Seed Dorm A
      testQueryClient.setQueryData(queryKeys.rooms(dormA), mockRooms);
      testQueryClient.setQueryData(queryKeys.meterPreviewContext(dormA, cycle1), { rooms: [{ roomId: 'rm-101', roomNumber: '101' }] });
      testQueryClient.setQueryData(queryKeys.meterPreviewContext(dormA, cycle2), { rooms: [{ roomId: 'rm-101', roomNumber: '101' }] });
      testQueryClient.setQueryData(queryKeys.meterWorkspace(dormA, cycle1), { serverReadings: [] });

      // Seed Dorm B
      testQueryClient.setQueryData(queryKeys.rooms(dormB), [{ id: 'rm-B201', roomNumber: '201' }]);
      testQueryClient.setQueryData(queryKeys.meterPreviewContext(dormB, cycle1), { rooms: [{ roomId: 'rm-B201', roomNumber: '201' }] });

      // Call REAL production helper for room rename in Dorm A
      invalidateRoomMutationCaches(testQueryClient, dormA, { kind: 'update', roomNumberChanged: true });

      // Dorm A rooms and ALL preview cycles must be invalidated
      expect(testQueryClient.getQueryState(queryKeys.rooms(dormA))?.isInvalidated).toBe(true);
      expect(testQueryClient.getQueryState(queryKeys.meterPreviewContext(dormA, cycle1))?.isInvalidated).toBe(true);
      expect(testQueryClient.getQueryState(queryKeys.meterPreviewContext(dormA, cycle2))?.isInvalidated).toBe(true);

      // Dorm A workspace must remain valid
      expect(testQueryClient.getQueryState(queryKeys.meterWorkspace(dormA, cycle1))?.isInvalidated).toBe(false);

      // Dorm B queries must remain completely clean
      expect(testQueryClient.getQueryState(queryKeys.rooms(dormB))?.isInvalidated).toBe(false);
      expect(testQueryClient.getQueryState(queryKeys.meterPreviewContext(dormB, cycle1))?.isInvalidated).toBe(false);
    });
  });

  describe('Test 3: Create and Archive invalidate rooms and all preview cycles in same dorm', () => {
    it.each([
      { impact: { kind: 'create' as const }, desc: 'create room' },
      { impact: { kind: 'archive' as const }, desc: 'archive room' },
    ])('proves $desc invalidates rooms and all cached preview contexts for that dormitory', ({ impact }) => {
      const dormId = 'dorm-A';
      const cycle1 = 'cycle-2026-08';
      const cycle2 = 'cycle-2026-09';

      testQueryClient.setQueryData(queryKeys.rooms(dormId), mockRooms);
      testQueryClient.setQueryData(queryKeys.meterPreviewContext(dormId, cycle1), { rooms: [] });
      testQueryClient.setQueryData(queryKeys.meterPreviewContext(dormId, cycle2), { rooms: [] });
      testQueryClient.setQueryData(queryKeys.meterWorkspace(dormId, cycle1), { serverReadings: [] });

      invalidateRoomMutationCaches(testQueryClient, dormId, impact);

      expect(testQueryClient.getQueryState(queryKeys.rooms(dormId))?.isInvalidated).toBe(true);
      expect(testQueryClient.getQueryState(queryKeys.meterPreviewContext(dormId, cycle1))?.isInvalidated).toBe(true);
      expect(testQueryClient.getQueryState(queryKeys.meterPreviewContext(dormId, cycle2))?.isInvalidated).toBe(true);
      expect(testQueryClient.getQueryState(queryKeys.meterWorkspace(dormId, cycle1))?.isInvalidated).toBe(false);
    });
  });

  describe('Test 4: OwnerRooms Component Mutation Metadata Bridge', () => {
    it('sends { kind: "create" } on successful room creation', async () => {
      const user = userEvent.setup();
      const onSaveRoomsSpy = vi.fn();
      vi.spyOn(ApiPropertyAdapter.prototype, 'createRoom').mockResolvedValue({
        success: true,
        data: { ...mockRooms[0], id: 'rm-901', roomNumber: '901' },
      });

      render(
        <OwnerRooms
          rooms={mockRooms}
          buildings={mockBuildings}
          onSaveRooms={onSaveRoomsSpy}
          onAddLog={vi.fn()}
          onNavigate={vi.fn()}
        />
      );

      await user.click(screen.getByText(/เพิ่มห้องพัก/i));
      await user.type(screen.getByPlaceholderText('เช่น A101'), '901');
      await user.click(screen.getByTestId('btn-save-room'));

      await waitFor(() => {
        expect(onSaveRoomsSpy).toHaveBeenCalledWith(
          mockRooms,
          expect.objectContaining({ kind: 'create' })
        );
      });
    });

    it('sends { kind: "update", roomNumberChanged: false } on price/deposit edit', async () => {
      const user = userEvent.setup();
      const onSaveRoomsSpy = vi.fn();
      vi.spyOn(ApiPropertyAdapter.prototype, 'updateRoom').mockResolvedValue({
        success: true,
        data: { ...mockRooms[0], monthlyRent: 5500 },
      });

      render(
        <OwnerRooms
          rooms={mockRooms}
          buildings={mockBuildings}
          initialRoomId="rm-101"
          onSaveRooms={onSaveRoomsSpy}
          onAddLog={vi.fn()}
          onNavigate={vi.fn()}
        />
      );

      const rentInput = screen.getByPlaceholderText('เช่น 4500');
      await user.clear(rentInput);
      await user.type(rentInput, '5500');
      await user.click(screen.getByTestId('btn-save-room'));

      await waitFor(() => {
        expect(onSaveRoomsSpy).toHaveBeenCalledWith(
          mockRooms,
          expect.objectContaining({ kind: 'update', roomNumberChanged: false })
        );
      });
    });

    it('sends { kind: "archive" } on room archive', async () => {
      const user = userEvent.setup();
      const onSaveRoomsSpy = vi.fn();
      vi.spyOn(ApiPropertyAdapter.prototype, 'archiveRoom').mockResolvedValue({
        success: true,
        data: true,
      });

      render(
        <OwnerRooms
          rooms={mockRooms}
          buildings={mockBuildings}
          initialRoomId="rm-101"
          onSaveRooms={onSaveRoomsSpy}
          onAddLog={vi.fn()}
          onNavigate={vi.fn()}
        />
      );

      const deleteBtn = screen.getByTestId('btn-delete-room');
      await user.click(deleteBtn);

      const allArchiveButtons = screen.getAllByRole('button', { name: 'จัดเก็บห้องพัก' });
      const confirmArchiveBtn = allArchiveButtons[allArchiveButtons.length - 1];
      await user.click(confirmArchiveBtn);

      await waitFor(() => {
        expect(onSaveRoomsSpy).toHaveBeenCalledWith(
          mockRooms,
          expect.objectContaining({ kind: 'archive' })
        );
      });
    });
  });

  describe('Test 5: OCC Conflict Reload Metadata', () => {
    it('passes { kind: "refresh" } on VersionConflictModal reload action', async () => {
      const user = userEvent.setup();
      const onSaveRoomsSpy = vi.fn();

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
          initialRoomId="rm-101"
          onSaveRooms={onSaveRoomsSpy}
          onAddLog={vi.fn()}
          onNavigate={vi.fn()}
        />
      );

      const rentInput = screen.getByPlaceholderText('เช่น 4500');
      await user.clear(rentInput);
      await user.type(rentInput, '5500');
      await user.click(screen.getByTestId('btn-save-room'));

      await waitFor(() => {
        expect(screen.getByTestId('version-conflict-modal')).toBeDefined();
      });

      const reloadBtn = screen.getByTestId('btn-reload-latest');
      await user.click(reloadBtn);

      expect(onSaveRoomsSpy).toHaveBeenCalledWith(
        mockRooms,
        expect.objectContaining({ kind: 'refresh' })
      );
    });
  });

  describe('Test 6: Invariant Verification & Draft Store Integrity', () => {
    it('proves invalidateRoomMutationCaches never clears or touches meterDraftStore', () => {
      const dormId = 'dorm-A';
      const cycleId = 'cycle-2026-08';

      meterDraftStore.setDraft(dormId, cycleId, [{ roomId: 'rm-101', waterCurr: '200' }]);

      const clearDormSpy = vi.spyOn(meterDraftStore, 'clearDormitoryDrafts');
      const clearDraftSpy = vi.spyOn(meterDraftStore, 'clearDraft');

      invalidateRoomMutationCaches(testQueryClient, dormId, { kind: 'create' });
      invalidateRoomMutationCaches(testQueryClient, dormId, { kind: 'update', roomNumberChanged: true });
      invalidateRoomMutationCaches(testQueryClient, dormId, { kind: 'archive' });

      expect(clearDormSpy).not.toHaveBeenCalled();
      expect(clearDraftSpy).not.toHaveBeenCalled();
      expect(meterDraftStore.getDraft(dormId, cycleId)).toEqual([{ roomId: 'rm-101', waterCurr: '200' }]);
    });
  });
});
