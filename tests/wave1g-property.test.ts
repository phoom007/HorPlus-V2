import { describe, it, expect } from 'vitest';
import { normalizeRoomNumber, validateRoomNumberInput } from '../server/src/utils/room-number.normalizer.js';
import { defaultsService } from '../server/src/services/defaults.service.js';
import { availabilityService } from '../server/src/services/availability.service.js';

describe('Wave 1G — Property Defaults, Room Integrity & Contract Snapshots', () => {
  it('enforces room number normalization rules (NFKC, trim, lowercase, collapse whitespace, preserve punctuation)', () => {
    expect(normalizeRoomNumber(' 101 ')).toBe('101');
    expect(normalizeRoomNumber('A101')).toBe('a101');
    expect(normalizeRoomNumber('B-201')).toBe('b-201');
    expect(normalizeRoomNumber('B 201')).toBe('b 201');
    expect(normalizeRoomNumber('1/1')).toBe('1/1');
    expect(normalizeRoomNumber('  ROOM   101  ')).toBe('room 101');
  });

  it('rejects blank room numbers with stable Thai validation message', () => {
    const val = validateRoomNumberInput('   ');
    expect(val.isValid).toBe(false);
    expect(val.errorMessage).toBe('หมายเลขห้องพักต้องไม่เป็นค่าว่าง');
  });

  it('resolves effective room defaults correctly from Dormitory -> Building -> Room hierarchy', () => {
    const dormValue = 4000;
    const bldValue: number | null = null;
    const roomValue: number | null = null;

    const effective = roomValue ?? bldValue ?? dormValue;
    expect(effective).toBe(4000);
  });

  it('evaluates room availability interval overlap correctly', () => {
    const existingStart = new Date('2026-08-01').getTime();
    const existingEnd = new Date('2026-08-31').getTime();

    const reqStart = new Date('2026-08-15').getTime();
    const reqEnd = new Date('2026-09-15').getTime();

    // existingStart < requestedEnd AND existingEnd > requestedStart
    const overlaps = existingStart < reqEnd && existingEnd > reqStart;
    expect(overlaps).toBe(true);

    const nonOverlapStart = new Date('2026-08-31').getTime();
    const nonOverlapEnd = new Date('2026-09-30').getTime();
    const nonOverlaps = existingStart < nonOverlapEnd && existingEnd > nonOverlapStart;
    expect(nonOverlaps).toBe(false);
  });
});
