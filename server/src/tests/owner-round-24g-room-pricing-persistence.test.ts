import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPrismaClient } from '../db/prisma.js';
import { RoomService } from '../services/room.service.js';
import { PrismaRoomRepository } from '../db/repositories/room.repository.js';
import { PrismaDormitoryRepository } from '../db/repositories/dormitory.repository.js';
import { PrismaBuildingRepository } from '../db/repositories/building.repository.js';
import { PrismaMembershipRepository } from '../db/repositories/membership.repository.js';

describe('Owner Round 2.4G: Room Pricing Persistence & Zero-Fidelity Integration', () => {
  const prisma = getPrismaClient();
  let roomService: RoomService;
  let testDormId: string;
  let testBuildingId: string;
  let testUserId: string;

  beforeAll(async () => {
    roomService = new RoomService(
      new PrismaRoomRepository(prisma),
      new PrismaDormitoryRepository(prisma),
      new PrismaBuildingRepository(prisma),
      new PrismaMembershipRepository(prisma)
    );

    // 1. Create Test User
    const user = await prisma.user.create({
      data: {
        googleSubject: `sub-room-price-${Date.now()}`,
        email: `room-price-${Date.now()}@example.com`,
        emailNormalized: `room-price-${Date.now()}@example.com`.toLowerCase(),
        name: 'Room Pricing Tester',
        status: 'active',
      },
    });
    testUserId = user.id;

    // 2. Create Active Dormitory
    const dorm = await prisma.dormitory.create({
      data: {
        name: `Dorm Room Price Test ${Date.now()}`,
        status: 'active',
        createdByUserId: testUserId,
      },
    });
    testDormId = dorm.id;

    // 3. Create Building with explicit independent deposits
    const building = await prisma.building.create({
      data: {
        dormitoryId: testDormId,
        name: 'Building Zero Test',
        monthlyDeposit: '0.00',
        termDeposit: '10000.00',
        dailyDeposit: '1000.00',
        depositAmount: '0.00',
      },
    });
    testBuildingId = building.id;
  });

  afterAll(async () => {
    try {
      if (testDormId) {
        await prisma.room.deleteMany({ where: { dormitoryId: testDormId } }).catch(() => {});
        await prisma.building.deleteMany({ where: { dormitoryId: testDormId } }).catch(() => {});
        await prisma.dormitory.delete({ where: { id: testDormId } }).catch(() => {});
      }
      if (testUserId) {
        await prisma.user.delete({ where: { id: testUserId } }).catch(() => {});
      }
    } catch {}
  });

  it('proves explicit monthly rent 0 -> save succeeds -> reload returns 0', async () => {
    const created = await roomService.createRoom(
      testDormId,
      {
        buildingId: testBuildingId,
        roomNumber: '101-ZERO',
        monthlyRent: '0',
        dailyRent: '0',
        termRent: '0',
        monthlyDeposit: '0',
        termDeposit: '0',
        dailyDeposit: '0',
      },
      testUserId
    );

    expect(created).toBeDefined();
    expect(Number(created.monthlyRent)).toBe(0);

    // Direct database reload
    const reloaded = await prisma.room.findUnique({
      where: { id: created.id },
    });

    expect(reloaded).not.toBeNull();
    expect(Number(reloaded!.monthlyRent)).toBe(0);
    expect(Number(reloaded!.termRent)).toBe(0);
    expect(Number(reloaded!.dailyRent)).toBe(0);
  });

  it('proves missing monthly rent -> remains unconfigured/null, never artificial 0', async () => {
    const created = await roomService.createRoom(
      testDormId,
      {
        buildingId: testBuildingId,
        roomNumber: '102-NULL',
        monthlyRent: '',
        dailyRent: null as any,
        termRent: undefined as any,
        monthlyDeposit: '5000',
        termDeposit: '5000',
        dailyDeposit: '500',
      },
      testUserId
    );

    expect(created).toBeDefined();
    expect(created.monthlyRent).toBeNull();
    expect(created.dailyRent).toBeNull();
    expect(created.termRent).toBeNull();

    // Direct database reload
    const reloaded = await prisma.room.findUnique({
      where: { id: created.id },
    });

    expect(reloaded).not.toBeNull();
    expect(reloaded!.monthlyRent).toBeNull();
    expect(reloaded!.dailyRent).toBeNull();
    expect(reloaded!.termRent).toBeNull();
  });
});