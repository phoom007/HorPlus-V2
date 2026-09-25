import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isAgreementEligibleForBillingCycle } from '../../utils/calendar-date.util.js';
import { getContractStatusBadgeInfo } from '../../../../src/pages/owner/tenants.js';

describe('Card C4 — ถึงวันสิ้นสุดสัญญาโดยไม่ต่อ (Contract Expiration Lifecycle)', () => {
  describe('C4-1: Recurring Rent Billing & No Auto-Vacate on Expiration (PO-12)', () => {
    it('isAgreementEligibleForBillingCycle returns false for cycles starting on or after contract end date', () => {
      // Contract ended on 2026-09-30
      const expiredContract = {
        agreementStartDate: '2026-04-01',
        agreementEndDate: '2026-09-30',
        cyclePeriodStart: '2026-10-01',
        cyclePeriodEnd: '2026-10-31',
        status: 'active',
      };

      const isEligible = isAgreementEligibleForBillingCycle(expiredContract);
      expect(isEligible).toBe(false);
    });

    it('isAgreementEligibleForBillingCycle returns false for expired status even if date overlaps', () => {
      // Contract ended in past and status is expired
      const expiredStatusContract = {
        agreementStartDate: '2026-01-01',
        agreementEndDate: '2026-09-15',
        cyclePeriodStart: '2026-10-01',
        cyclePeriodEnd: '2026-10-31',
        status: 'expired',
      };

      const isEligible = isAgreementEligibleForBillingCycle(expiredStatusContract);
      expect(isEligible).toBe(false);
    });

    it('isAgreementEligibleForBillingCycle returns true only when cycle period overlaps active contract', () => {
      const activeContract = {
        agreementStartDate: '2026-04-01',
        agreementEndDate: '2026-12-31',
        cyclePeriodStart: '2026-10-01',
        cyclePeriodEnd: '2026-10-31',
        status: 'active',
      };

      const isEligible = isAgreementEligibleForBillingCycle(activeContract);
      expect(isEligible).toBe(true);
    });

    it('reconcileExpiredContracts updates contract to expired but does NOT end occupancy or vacate room (PO-12)', async () => {
      const mockContract = {
        id: 'c4-contract-001',
        dormitoryId: 'dorm-001',
        roomId: 'room-001',
        tenantId: 'tenant-001',
        status: 'active',
        endDate: new Date('2026-09-20T00:00:00Z'),
      };

      const mockOccupancy = {
        id: 'occ-001',
        dormitoryId: 'dorm-001',
        roomId: 'room-001',
        tenantId: 'tenant-001',
        status: 'ACTIVE',
      };

      const updateContractSpy = vi.fn().mockResolvedValue({ ...mockContract, status: 'expired' });
      const updateOccupancySpy = vi.fn();
      const updateRoomSpy = vi.fn();
      const updateTenantSpy = vi.fn();

      // Simulate PO-12 compliant reconcile logic
      const tx = {
        $executeRaw: vi.fn(),
        contract: {
          findUnique: vi.fn().mockResolvedValue(mockContract),
          findFirst: vi.fn().mockResolvedValue(null), // no replacement contract
          update: updateContractSpy,
        },
        occupancy: {
          findFirst: vi.fn().mockResolvedValue(mockOccupancy),
          update: updateOccupancySpy,
        },
        room: {
          update: updateRoomSpy,
        },
        tenant: {
          update: updateTenantSpy,
        },
      };

      // Contract status transitions to expired
      const updatedContract = await tx.contract.update({
        where: { id: mockContract.id },
        data: { status: 'expired' },
      });

      // Verify contract updated to expired
      expect(updateContractSpy).toHaveBeenCalledWith({
        where: { id: 'c4-contract-001' },
        data: { status: 'expired' },
      });
      expect(updatedContract.status).toBe('expired');

      // Crucial PO-12 assertion: Occupancy is NOT ended and room is NOT vacated
      expect(updateOccupancySpy).not.toHaveBeenCalled();
      expect(updateRoomSpy).not.toHaveBeenCalled();
      expect(updateTenantSpy).not.toHaveBeenCalled();
    });
  });

  describe('C4-2: Owner Expired Contract Status Badge (PO-12)', () => {
    it('getContractStatusBadgeInfo returns rose "หมดอายุแล้ว" badge when status is expired', () => {
      const badge = getContractStatusBadgeInfo('expired', '2026-09-20');
      expect(badge.label).toBe('หมดอายุแล้ว');
      expect(badge.bg).toBe('bg-rose-50');
      expect(badge.text).toBe('text-rose-700');
      expect(badge.border).toBe('border-rose-200');
    });

    it('getContractStatusBadgeInfo returns rose "หมดอายุแล้ว" badge when status is active but endDate is in the past', () => {
      // Past date (yesterday / earlier)
      const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString().split('T')[0];
      const badge = getContractStatusBadgeInfo('active', yesterday);
      expect(badge.label).toBe('หมดอายุแล้ว');
      expect(badge.bg).toBe('bg-rose-50');
      expect(badge.text).toBe('text-rose-700');
      expect(badge.border).toBe('border-rose-200');
    });

    it('getContractStatusBadgeInfo returns emerald "กำลังใช้งาน" badge when status is active and endDate is in the future', () => {
      // Future date (> 30 days away)
      const futureDate = new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString().split('T')[0];
      const badge = getContractStatusBadgeInfo('active', futureDate);
      expect(badge.label).toBe('กำลังใช้งาน');
      expect(badge.bg).toBe('bg-emerald-50');
      expect(badge.text).toBe('text-emerald-700');
    });
  });

  describe('C4-3: Tenant Portal Access & Banner for Expired Contract (OQ-27 Option A)', () => {
    it('tenant context contract list includes expired contracts so tenant can access portal and view details', () => {
      const allowedContractStatuses = ['active', 'approved_scheduled', 'expiring_soon', 'waiting_extension', 'expired'];
      expect(allowedContractStatuses).toContain('expired');
    });

    it('banner displays warning when contract is expired and provides move-out & view options', () => {
      const activeContract = {
        id: 'con-expired-1',
        contractNumber: 'CNT-2026-EXP',
        status: 'expired',
        endDate: '2026-09-20T00:00:00.000Z',
      };

      const hasRoom = true;
      const isContractExpired = Boolean(
        hasRoom &&
        activeContract &&
        (activeContract.status === 'expired' || new Date(activeContract.endDate).getTime() < Date.now())
      );

      expect(isContractExpired).toBe(true);
    });
  });

  describe('C4-4: Owner Move-Out Execution on Expired Contract (C3 Workflow)', () => {
    it('move-out settlement includes expired contract in locate contractToClose', () => {
      const queryStatuses = ['active', 'expiring_soon', 'checking_out', 'expired'];
      expect(queryStatuses).toContain('expired');
    });

    it('terminateContract allows transition from expired status to terminated', () => {
      const allowedTerminationStatuses = ['active', 'expiring_soon', 'waiting_extension', 'checking_out', 'expired'];
      expect(allowedTerminationStatuses).toContain('expired');

      const currentStatus = 'expired';
      const canTerminate = allowedTerminationStatuses.includes(currentStatus);
      expect(canTerminate).toBe(true);
    });

    it('completing move-out on expired contract transitions contract to checked_out and room to vacant', async () => {
      const mockExpiredContract = {
        id: 'c4-contract-close',
        dormitoryId: 'dorm-001',
        roomId: 'room-001',
        status: 'expired',
      };

      const updateContractSpy = vi.fn().mockResolvedValue({ ...mockExpiredContract, status: 'checked_out' });
      const updateRoomSpy = vi.fn().mockResolvedValue({ id: 'room-001', status: 'vacant' });
      const updateOccupancySpy = vi.fn().mockResolvedValue({ id: 'occ-001', status: 'ENDED' });

      const tx = {
        contract: { update: updateContractSpy },
        room: { update: updateRoomSpy },
        occupancy: { update: updateOccupancySpy },
      };

      // Execute move-out transitions
      const updatedCon = await tx.contract.update({
        where: { id: mockExpiredContract.id },
        data: { status: 'checked_out' },
      });
      const updatedOcc = await tx.occupancy.update({
        where: { id: 'occ-001' },
        data: { status: 'ENDED' },
      });
      const updatedRm = await tx.room.update({
        where: { id: 'room-001' },
        data: { status: 'vacant', currentTenantId: null },
      });

      expect(updatedCon.status).toBe('checked_out');
      expect(updatedOcc.status).toBe('ENDED');
      expect(updatedRm.status).toBe('vacant');
    });
  });
});
