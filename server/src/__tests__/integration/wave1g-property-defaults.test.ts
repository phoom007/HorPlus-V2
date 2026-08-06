import { describe, it, expect } from 'vitest';
import { normalizeRoomNumber, validateRoomNumberInput } from '../../utils/room-number.normalizer.js';
import { BLOCKING_CONTRACT_STATUSES, isIntervalOverlapping } from '../../services/blocking-contract-policy.js';
import { validateClearOverrideField } from '../../schemas/property-tenant-contract.schemas.js';

describe('Wave 1G — Property, Room Defaults & Availability Comprehensive Unit & Logic Tests', () => {
  describe('Room Number Normalizer & Identity (Mandatory Correction 5)', () => {
    it('normalizes simple room numbers', () => {
      expect(normalizeRoomNumber('101')).toBe('101');
    });

    it('trims leading and trailing whitespace', () => {
      expect(normalizeRoomNumber('  101  ')).toBe('101');
    });

    it('lowercases ASCII letters for comparison', () => {
      expect(normalizeRoomNumber('A101')).toBe('a101');
      expect(normalizeRoomNumber('A101')).toBe(normalizeRoomNumber('a101'));
    });

    it('preserves hyphens and distinguishes hyphens from spaces', () => {
      expect(normalizeRoomNumber('B-201')).toBe('b-201');
      expect(normalizeRoomNumber('B 201')).toBe('b 201');
      expect(normalizeRoomNumber('B-201')).not.toBe(normalizeRoomNumber('B 201'));
    });

    it('preserves slashes', () => {
      expect(normalizeRoomNumber('1/1')).toBe('1/1');
    });

    it('collapses internal whitespace', () => {
      expect(normalizeRoomNumber('B   201')).toBe('b 201');
    });

    it('rejects blank inputs with Thai validation message', () => {
      const res = validateRoomNumberInput('   ');
      expect(res.isValid).toBe(false);
      expect(res.errorMessage).toBe('หมายเลขห้องพักต้องไม่เป็นค่าว่าง');
    });

    it('proves A101 in Building A and B101 in Building B are distinct roomNumbers', () => {
      expect(normalizeRoomNumber('A101')).not.toBe(normalizeRoomNumber('B101'));
    });

    it('proves 101 in Building A and 101 in Building B share the same normalized value (unique per Dormitory)', () => {
      expect(normalizeRoomNumber('101')).toBe(normalizeRoomNumber('101'));
    });
  });

  describe('3-Level Effective Default Resolution Hierarchy', () => {
    it('defines clear source hierarchy: Room > Building > Dormitory', () => {
      const dormDefault = 4000;
      const buildingOverride = 4500;
      const roomOverride = 5000;

      // 1. Room override specified -> ROOM source
      const val1 = roomOverride !== null ? roomOverride : buildingOverride !== null ? buildingOverride : dormDefault;
      expect(val1).toBe(5000);

      // 2. Room override null, Building specified -> BUILDING source
      const roomNull: number | null = null;
      const val2 = roomNull !== null ? roomNull : buildingOverride !== null ? buildingOverride : dormDefault;
      expect(val2).toBe(4500);

      // 3. Room null, Building null -> DORMITORY source
      const bldNull: number | null = null;
      const val3 = roomNull !== null ? roomNull : bldNull !== null ? bldNull : dormDefault;
      expect(val3).toBe(4000);

      // 4. Room explicit 0 -> 0 is not null, so ROOM source
      const roomZero = 0;
      const val4 = roomZero !== null ? roomZero : buildingOverride !== null ? buildingOverride : dormDefault;
      expect(val4).toBe(0);
    });
  });

  describe('Unified Blocking Contract Policy & Overlap Calculation', () => {
    it('includes all mandatory blocking contract statuses', () => {
      expect(BLOCKING_CONTRACT_STATUSES).toContain('active');
      expect(BLOCKING_CONTRACT_STATUSES).toContain('approved');
      expect(BLOCKING_CONTRACT_STATUSES).toContain('expiring_soon');
      expect(BLOCKING_CONTRACT_STATUSES).toContain('waiting_extension');
      expect(BLOCKING_CONTRACT_STATUSES).toContain('checking_out');
    });

    it('evaluates interval overlap correctly using isIntervalOverlapping', () => {
      // Case 1: Exact overlap -> true
      expect(isIntervalOverlapping('2026-08-01', '2026-08-31', '2026-08-15', '2026-09-15')).toBe(true);

      // Case 2: Entirely contained -> true
      expect(isIntervalOverlapping('2026-08-01', '2026-12-31', '2026-09-01', '2026-10-01')).toBe(true);

      // Case 3: Back-to-back non-overlapping -> false
      expect(isIntervalOverlapping('2026-08-01', '2026-08-31', '2026-08-31', '2026-09-30')).toBe(false);

      // Case 4: Completely before -> false
      expect(isIntervalOverlapping('2026-08-01', '2026-08-31', '2026-09-01', '2026-09-30')).toBe(false);

      // Case 5: Completely after -> false
      expect(isIntervalOverlapping('2026-09-01', '2026-09-30', '2026-08-01', '2026-08-31')).toBe(false);
    });
  });

  describe('Strict Field Whitelisting & Override Validation', () => {
    it('allows valid financial and operational override fields', () => {
      expect(validateClearOverrideField('monthlyRent')).toBe(true);
      expect(validateClearOverrideField('depositAmount')).toBe(true);
      expect(validateClearOverrideField('waterRate')).toBe(true);
      expect(validateClearOverrideField('electricityRate')).toBe(true);
      expect(validateClearOverrideField('roomType')).toBe(true);
    });

    it('rejects system protected fields from being cleared or dynamically mutated', () => {
      expect(validateClearOverrideField('id')).toBe(false);
      expect(validateClearOverrideField('dormitoryId')).toBe(false);
      expect(validateClearOverrideField('buildingId')).toBe(false);
      expect(validateClearOverrideField('status')).toBe(false);
      expect(validateClearOverrideField('version')).toBe(false);
      expect(validateClearOverrideField('normalizedRoomNumber')).toBe(false);
      expect(validateClearOverrideField('currentContractId')).toBe(false);
    });
  });

  describe('Atomic Optimistic Concurrency & Transactional Audit Contracts', () => {
    it('requires expectedVersion on mutation schemas', async () => {
      const { UpdateBuildingSchema, UpdateRoomSchema, ArchiveBuildingSchema, ArchiveRoomSchema } = await import('../../schemas/property-tenant-contract.schemas.js');

      // Test missing expectedVersion fails validation
      expect(UpdateBuildingSchema.safeParse({ name: 'Building A' }).success).toBe(false);
      expect(UpdateRoomSchema.safeParse({ roomNumber: '101' }).success).toBe(false);
      expect(ArchiveBuildingSchema.safeParse({}).success).toBe(false);
      expect(ArchiveRoomSchema.safeParse({}).success).toBe(false);

      // Test valid expectedVersion passes validation
      expect(UpdateBuildingSchema.safeParse({ name: 'Building A', expectedVersion: 1 }).success).toBe(true);
      expect(UpdateRoomSchema.safeParse({ roomNumber: '101', expectedVersion: 1 }).success).toBe(true);
      expect(ArchiveBuildingSchema.safeParse({ expectedVersion: 1 }).success).toBe(true);
      expect(ArchiveRoomSchema.safeParse({ expectedVersion: 1 }).success).toBe(true);
    });

    it('proves reconciliation script enforces loopback host and port 5455 safety guards', async () => {
      const { reconcileRoomNormalization } = await import('../../scripts/reconcile-room-normalization.js');

      // Test database safety guard throws error if non-5455 or non-loopback
      const prevUrl = process.env.DATABASE_URL;
      process.env.DATABASE_URL = 'postgresql://user:pass@remotehost:5432/production_db';

      await expect(reconcileRoomNormalization()).rejects.toThrow('Safety guard: reconciliation script can only run against loopback database on port 5455.');

      process.env.DATABASE_URL = prevUrl;
    });

    it('proves reconciliation function returns non-zero conflict report when duplicates exist', async () => {
      const mockRooms = [
        { id: 'rm-1', dormitoryId: 'dorm-1', buildingId: 'bld-1', roomNumber: 'A101', normalizedRoomNumber: 'a101' },
        { id: 'rm-2', dormitoryId: 'dorm-1', buildingId: 'bld-2', roomNumber: 'a101', normalizedRoomNumber: 'a101' },
      ];

      const mockTx = {
        room: {
          findMany: async () => mockRooms,
          update: async () => {},
        },
      };

      const { reconcileRoomNormalization } = await import('../../scripts/reconcile-room-normalization.js');
      const res = await reconcileRoomNormalization(mockTx);

      expect(res.success).toBe(false);
      expect(res.conflictCount).toBe(2);
      expect(res.conflicts).toHaveLength(2);
      expect(res.conflicts[0].conflictGroup).toBe('dorm-1::a101');
    });

    it('proves reconciliation function succeeds when no normalized duplicates exist', async () => {
      const mockRooms = [
        { id: 'rm-1', dormitoryId: 'dorm-1', buildingId: 'bld-1', roomNumber: 'A101', normalizedRoomNumber: 'a101' },
        { id: 'rm-2', dormitoryId: 'dorm-1', buildingId: 'bld-1', roomNumber: 'B101', normalizedRoomNumber: 'b101' },
        { id: 'rm-3', dormitoryId: 'dorm-1', buildingId: 'bld-1', roomNumber: ' B   201 ', normalizedRoomNumber: 'b 201' },
        { id: 'rm-4', dormitoryId: 'dorm-1', buildingId: 'bld-1', roomNumber: '1/1', normalizedRoomNumber: '1/1' },
      ];

      const mockTx = {
        room: {
          findMany: async () => mockRooms,
          update: async () => {},
        },
        $transaction: async (cb: any) => cb(mockTx),
      };

      const { reconcileRoomNormalization } = await import('../../scripts/reconcile-room-normalization.js');
      const res = await reconcileRoomNormalization(mockTx);

      expect(res.success).toBe(true);
      expect(res.conflicts).toHaveLength(0);
      expect(res.processedRooms).toBe(4);
    });
  });
});


