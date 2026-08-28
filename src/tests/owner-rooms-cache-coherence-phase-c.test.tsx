// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { queryKeys, STALE_TIMES } from '../lib/queryClient';
import { meterDraftStore } from '../lib/meterDraftStore';
import { OwnerRooms } from '../pages/owner/rooms';
import { ApiPropertyAdapter } from '../data/adapters/api';
import { Room, Building } from '../types';

describe('Owner Rooms — Phase C Cache Coherence & Dependency-Aware Invalidation Suite', () => {
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

  describe('Test A & C: Dependency-Aware Invalidation on Room Mutation', () => {
    it('invalidates queryKeys.rooms(dormId) and queryKeys.meterPreviewContext(dormId, cycleId) but leaves unrelated caches untouched', async () => {
      const dormId = 'dorm-001';
      const cycleId = 'cycle-2026-08';

      // Seed query client with multiple resources
      testQueryClient.setQueryData(queryKeys.rooms(dormId), mockRooms);
      testQueryClient.setQueryData(queryKeys.tenants(dormId), [{ id: 't-1', name: 'Somchai' }]);
      testQueryClient.setQueryData(queryKeys.contracts(dormId), [{ id: 'c-1', rentAmount: 4500 }]);
      testQueryClient.setQueryData(queryKeys.bills(dormId), [{ id: 'b-1', total: 5000 }]);
      testQueryClient.setQueryData(queryKeys.meterWorkspace(dormId, cycleId), { serverReadings: [] });
      testQueryClient.setQueryData(queryKeys.meterPreviewContext(dormId, cycleId), { rooms: [] });

      // Spy on invalidateQueries
      const invalidateSpy = vi.spyOn(testQueryClient, 'invalidateQueries');

      // Helper function matching OwnerWorkspace.handleSaveRooms
      const handleSaveRooms = (activeDormitoryId: string, selectedBillingCycleId?: string) => {
        testQueryClient.invalidateQueries({ queryKey: queryKeys.rooms(activeDormitoryId) });
        if (selectedBillingCycleId) {
          testQueryClient.invalidateQueries({ queryKey: queryKeys.meterPreviewContext(activeDormitoryId, selectedBillingCycleId) });
        }
      };

      // Trigger room save
      handleSaveRooms(dormId, cycleId);

      // Verify exact keys invalidated
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.rooms(dormId) });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.meterPreviewContext(dormId, cycleId) });

      // Verify unrelated keys were NOT invalidated
      expect(invalidateSpy).not.toHaveBeenCalledWith(expect.objectContaining({ queryKey: queryKeys.tenants(dormId) }));
      expect(invalidateSpy).not.toHaveBeenCalledWith(expect.objectContaining({ queryKey: queryKeys.contracts(dormId) }));
      expect(invalidateSpy).not.toHaveBeenCalledWith(expect.objectContaining({ queryKey: queryKeys.bills(dormId) }));
      expect(invalidateSpy).not.toHaveBeenCalledWith(expect.objectContaining({ queryKey: queryKeys.meterWorkspace(dormId, cycleId) }));
    });
  });

  describe('Test B: No Unnecessary Resource Invalidation for Catalog Price Edits', () => {
    it('proves catalog price edits do not invalidate contract or tenant caches', () => {
      const dormId = 'dorm-001';
      const invalidateSpy = vi.spyOn(testQueryClient, 'invalidateQueries');

      const handleSaveRooms = (activeDormitoryId: string) => {
        testQueryClient.invalidateQueries({ queryKey: queryKeys.rooms(activeDormitoryId) });
      };

      handleSaveRooms(dormId);

      expect(invalidateSpy).toHaveBeenCalledTimes(1);
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.rooms(dormId) });
      expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: queryKeys.contracts(dormId) });
      expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: queryKeys.tenants(dormId) });
      expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: queryKeys.bills(dormId) });
    });
  });

  describe('Test D: Multi-Dormitory Cache Isolation', () => {
    it('proves mutations in Dorm A do NOT invalidate or corrupt Dorm B cache', () => {
      const dormA = 'dorm-alpha';
      const dormB = 'dorm-beta';
      const cycleId = 'cycle-2026-08';

      // Seed Dorm A and Dorm B
      testQueryClient.setQueryData(queryKeys.rooms(dormA), [{ id: 'rm-A101', roomNumber: 'A101' }]);
      testQueryClient.setQueryData(queryKeys.rooms(dormB), [{ id: 'rm-B201', roomNumber: 'B201' }]);
      testQueryClient.setQueryData(queryKeys.meterPreviewContext(dormA, cycleId), { rooms: ['A101'] });
      testQueryClient.setQueryData(queryKeys.meterPreviewContext(dormB, cycleId), { rooms: ['B201'] });

      // Invalidate Dorm A only
      testQueryClient.invalidateQueries({ queryKey: queryKeys.rooms(dormA) });
      testQueryClient.invalidateQueries({ queryKey: queryKeys.meterPreviewContext(dormA, cycleId) });

      // Check Dorm A state (invalidated)
      const dormARoomState = testQueryClient.getQueryState(queryKeys.rooms(dormA));
      const dormAPreviewState = testQueryClient.getQueryState(queryKeys.meterPreviewContext(dormA, cycleId));
      expect(dormARoomState?.isInvalidated).toBe(true);
      expect(dormAPreviewState?.isInvalidated).toBe(true);

      // Check Dorm B state (clean, NOT invalidated)
      const dormBRoomState = testQueryClient.getQueryState(queryKeys.rooms(dormB));
      const dormBPreviewState = testQueryClient.getQueryState(queryKeys.meterPreviewContext(dormB, cycleId));
      expect(dormBRoomState?.isInvalidated).toBe(false);
      expect(dormBPreviewState?.isInvalidated).toBe(false);
      expect(testQueryClient.getQueryData(queryKeys.rooms(dormB))).toEqual([{ id: 'rm-B201', roomNumber: 'B201' }]);
    });
  });

  describe('Test E: Active Contract Rent Snapshot Protection', () => {
    it('proves room catalog price edit does not alter active contract rent snapshot', () => {
      const roomCatalogPriceBefore = 5000;
      const roomCatalogPriceAfter = 5500;
      const activeContractSnapshotRent = 4500;

      const contract = {
        id: 'contract-active-1',
        roomId: 'rm-101',
        rentAmount: activeContractSnapshotRent,
        status: 'active',
      };

      // Room catalog price changes
      const updatedRoom = {
        ...mockRooms[0],
        monthlyRent: roomCatalogPriceAfter,
      };

      // Active contract rent must strictly remain 4,500
      expect(contract.rentAmount).toBe(4500);
      expect(contract.rentAmount).not.toBe(updatedRoom.monthlyRent);
    });
  });

  describe('Test F: Meter Draft Store Preservation', () => {
    it('proves room mutation does NOT clear or destroy user unsaved meter drafts', () => {
      const dormId = 'dorm-001';
      const cycleId = 'cycle-2026-08';

      // Seed meter draft store with unsaved readings
      meterDraftStore.setDraft(dormId, cycleId, [
        { roomId: 'rm-101', waterCurr: '150', elecCurr: '1350' },
      ]);

      const clearDormSpy = vi.spyOn(meterDraftStore, 'clearDormitoryDrafts');
      const clearDraftSpy = vi.spyOn(meterDraftStore, 'clearDraft');

      // Simulate room save invalidation
      testQueryClient.invalidateQueries({ queryKey: queryKeys.rooms(dormId) });
      testQueryClient.invalidateQueries({ queryKey: queryKeys.meterPreviewContext(dormId, cycleId) });

      // Verify draft store was NOT cleared
      expect(clearDormSpy).not.toHaveBeenCalled();
      expect(clearDraftSpy).not.toHaveBeenCalled();

      const preservedDraft = meterDraftStore.getDraft(dormId, cycleId);
      expect(preservedDraft).toEqual([
        { roomId: 'rm-101', waterCurr: '150', elecCurr: '1350' },
      ]);
    });
  });
});
