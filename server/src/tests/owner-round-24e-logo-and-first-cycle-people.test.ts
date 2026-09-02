import { describe, it, expect, vi } from 'vitest';
import { validateImageMagicBytes } from '../services/dormitory-logo.service.js';
import { materializeFirstCyclePeopleSnapshots } from '../services/first-cycle-people-materialization.service.js';

describe('Owner Round 2.4E: Dormitory Logo Magic Byte Binary Verification', () => {
  it('accepts valid PNG magic bytes (89 50 4E 47 0D 0A 1A 0A)', () => {
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
    const res = validateImageMagicBytes(pngHeader);
    expect(res.mimeType).toBe('image/png');
    expect(res.extension).toBe('png');
  });

  it('accepts valid JPEG magic bytes (FF D8 FF)', () => {
    const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
    const res = validateImageMagicBytes(jpegHeader);
    expect(res.mimeType).toBe('image/jpeg');
    expect(res.extension).toBe('jpg');
  });

  it('accepts valid WebP magic bytes (RIFF....WEBP)', () => {
    const webpHeader = Buffer.from([
      0x52, 0x49, 0x46, 0x46, // RIFF
      0x24, 0x00, 0x00, 0x00, // size
      0x57, 0x45, 0x42, 0x50, // WEBP
    ]);
    const res = validateImageMagicBytes(webpHeader);
    expect(res.mimeType).toBe('image/webp');
    expect(res.extension).toBe('webp');
  });

  it('AUTHORITATIVE AUDIT RULE: Rejects SVG files', () => {
    const svgHeader = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(() => validateImageMagicBytes(svgHeader)).toThrowError(/รองรับเฉพาะไฟล์รูปภาพประเภท PNG, JPG และ WebP/);
  });

  it('AUTHORITATIVE AUDIT RULE: Rejects scripts and executables', () => {
    const scriptHeader = Buffer.from('#!/bin/bash\necho malicious');
    expect(() => validateImageMagicBytes(scriptHeader)).toThrowError(/รองรับเฉพาะไฟล์รูปภาพประเภท PNG, JPG และ WebP/);

    const exeHeader = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00]); // MZ header
    expect(() => validateImageMagicBytes(exeHeader)).toThrowError(/รองรับเฉพาะไฟล์รูปภาพประเภท PNG, JPG และ WebP/);
  });

  it('rejects truncated or empty buffers', () => {
    expect(() => validateImageMagicBytes(Buffer.from([]))).toThrow();
    expect(() => validateImageMagicBytes(Buffer.from([0x89, 0x50]))).toThrow();
  });
});

describe('Owner Round 2.4E: Authoritative First-Cycle People Materialization', () => {
  it('materializes peopleCount = 1 snapshots for active rooms without snapshots in the earliest cycle', async () => {
    const mockPrisma = {
      billingCycle: {
        findFirst: vi.fn().mockResolvedValue({ id: 'cycle-earliest-1', cycleCode: '2026-06' }),
      },
      room: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'room-1' },
          { id: 'room-2' },
          { id: 'room-3' },
        ]),
      },
      roomBillingCycleSnapshot: {
        findMany: vi.fn().mockResolvedValue([
          { roomId: 'room-1', peopleCount: 2 }, // already has explicit snapshot
        ]),
        createMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
    };

    const result = await materializeFirstCyclePeopleSnapshots('dorm-test-1', mockPrisma);

    expect(result.dormitoryId).toBe('dorm-test-1');
    expect(result.earliestCycleId).toBe('cycle-earliest-1');
    expect(result.createdCount).toBe(2);

    expect(mockPrisma.roomBillingCycleSnapshot.createMany).toHaveBeenCalledWith({
      data: [
        {
          dormitoryId: 'dorm-test-1',
          billingCycleId: 'cycle-earliest-1',
          roomId: 'room-2',
          peopleCount: 1,
          source: 'FIRST_CYCLE_DEFAULT',
          version: 1,
        },
        {
          dormitoryId: 'dorm-test-1',
          billingCycleId: 'cycle-earliest-1',
          roomId: 'room-3',
          peopleCount: 1,
          source: 'FIRST_CYCLE_DEFAULT',
          version: 1,
        },
      ],
      skipDuplicates: true,
    });
  });

  it('AUTHORITATIVE AUDIT RULE: Never overwrites existing snapshots (including explicit 0)', async () => {
    const mockPrisma = {
      billingCycle: {
        findFirst: vi.fn().mockResolvedValue({ id: 'cycle-earliest-1', cycleCode: '2026-06' }),
      },
      room: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'room-1' },
        ]),
      },
      roomBillingCycleSnapshot: {
        findMany: vi.fn().mockResolvedValue([
          { roomId: 'room-1', peopleCount: 0 }, // explicit 0 must not be overwritten
        ]),
        createMany: vi.fn(),
      },
    };

    const result = await materializeFirstCyclePeopleSnapshots('dorm-test-1', mockPrisma);

    expect(result.createdCount).toBe(0);
    expect(mockPrisma.roomBillingCycleSnapshot.createMany).not.toHaveBeenCalled();
  });

  it('is strictly idempotent and returns 0 created when all rooms already have snapshots', async () => {
    const mockPrisma = {
      billingCycle: {
        findFirst: vi.fn().mockResolvedValue({ id: 'cycle-earliest-1', cycleCode: '2026-06' }),
      },
      room: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'room-1' },
          { id: 'room-2' },
        ]),
      },
      roomBillingCycleSnapshot: {
        findMany: vi.fn().mockResolvedValue([
          { roomId: 'room-1', peopleCount: 1 },
          { roomId: 'room-2', peopleCount: 1 },
        ]),
        createMany: vi.fn(),
      },
    };

    const result = await materializeFirstCyclePeopleSnapshots('dorm-test-1', mockPrisma);

    expect(result.createdCount).toBe(0);
    expect(mockPrisma.roomBillingCycleSnapshot.createMany).not.toHaveBeenCalled();
  });
});
