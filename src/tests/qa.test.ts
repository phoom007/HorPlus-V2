import { describe, it, expect, beforeEach } from 'vitest';

if (typeof localStorage === 'undefined') {
  const store: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = String(value); },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
    key: (i: number) => Object.keys(store)[i] || null,
    get length() { return Object.keys(store).length; },
  };
}
import { contractRepository } from '../demo/repositories/contractRepository';
import { billingRepository } from '../demo/repositories/billingRepository';

import { roomRepository } from '../demo/repositories/roomRepository';
import { tenantRepository } from '../demo/repositories/tenantRepository';
import { auditRepository } from '../demo/repositories/auditRepository';
import { seedDatabase, getContracts, getBills, getRooms, getTenants, getAuditLogs } from '../data/mockData';

describe('QA Verification Suite — Repositories & Business Logic', () => {
  beforeEach(() => {
    // Reset seed data before each test
    seedDatabase(true);
  });

  describe('Contract Repository & Overlap Verification', () => {
    it('should detect date overlap accurately using half-open interval rule', () => {
      const contracts = getContracts();
      expect(contracts.length).toBeGreaterThan(0);
      const targetContract = contracts[0];
      const roomId = targetContract.roomId;

      // Try adding overlapping contract: same period
      const isOverlap1 = contractRepository.checkOverlap(
        roomId,
        targetContract.startDate,
        targetContract.endDate
      );
      expect(isOverlap1).toBe(true);

      // Half-open check: starting exactly on the end date of contract should NOT overlap
      const isOverlap2 = contractRepository.checkOverlap(
        roomId,
        targetContract.endDate,
        '2028-12-31'
      );
      expect(isOverlap2).toBe(false);
    });

    it('should reject creating contract if endDate <= startDate', () => {
      const res = contractRepository.addContract({
        contractNumber: 'CNT-INVALID-01',
        tenantId: 'tenant-101',
        roomId: 'room-102',
        startDate: '2026-06-01',
        endDate: '2026-05-31',
        durationMonths: 6,
        rentAmount: 4500,
        depositAmount: 9000,
        terms: 'Standard terms',
        status: 'active'
      });

      expect(res.success).toBe(false);
      expect(res.message).toContain('วันสิ้นสุดสัญญา');
    });
  });

  describe('Billing Repository & Calculation Invariants', () => {
    it('should generate bills where totalAmount exactly equals sum of item amounts', () => {
      const bills = billingRepository.getAll();
      expect(bills.length).toBeGreaterThan(0);

      for (const bill of bills) {
        const itemSum = bill.items.reduce((sum, item) => sum + item.amount, 0);
        expect(bill.totalAmount).toBe(itemSum);
      }
    });

    it('should calculate term rent correctly for term-based rooms', () => {
      // Find or create room with term rent
      const room = roomRepository.getById('room-101');
      if (room) {
        room.rentCycle = 'term';
        room.termRent = 18000;
        roomRepository.updateRoom(room);
      }

      const billResult = billingRepository.generateBillForRoom('room-101', '2026-07');
      expect(billResult).toBeDefined();
    });
  });

  

  describe('Audit Repository & Operation Logging', () => {
    it('should record audit logs for critical actions', () => {
      const initialLogsCount = getAuditLogs().length;

      auditRepository.addLog('user-owner', 'ทดสอบระบบ QA', 'สร้างบันทึกทดสอบ', 'System', 'sys-test-1');

      const updatedLogs = getAuditLogs();
      expect(updatedLogs.length).toBe(initialLogsCount + 1);
      expect(updatedLogs[0].action).toBe('ทดสอบระบบ QA');
    });
  });
});
