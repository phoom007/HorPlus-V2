/**
 * @license Apache-2.0
 * HORPLUS-V2 R3.7b — True Onboarding Operational Start Authority & Rolling Cycle Fail-Loud Regression
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getPrismaClient } from "../../db/prisma.js";
import { BillingCycleService } from "../../services/billing-cycle.service.js";
import { PrismaBillingCycleRepository } from "../../db/repositories/billing-cycle.repository.js";
import { PrismaDormitoryRepository } from "../../db/repositories/dormitory.repository.js";
import { randomUUID } from "crypto";

const prisma = getPrismaClient();

describe("R3.7b — True Onboarding Operational Start Authority & Rolling Cycle Invariants", () => {
  let billingCycleService: BillingCycleService;
  let dormRepo: PrismaDormitoryRepository;
  let cycleRepo: PrismaBillingCycleRepository;

  const testDormIds: string[] = [];
  const testUserIds: string[] = [];

  beforeAll(() => {
    dormRepo = new PrismaDormitoryRepository(prisma);
    cycleRepo = new PrismaBillingCycleRepository(prisma);
    billingCycleService = new BillingCycleService(cycleRepo, undefined, dormRepo);
  });

  afterAll(async () => {
    for (const dormId of testDormIds) {
      await prisma.roomOperationalStatusChange.deleteMany({ where: { dormitoryId: dormId } }).catch(() => {});
      await prisma.billingRateSnapshot.deleteMany({ where: { dormitoryId: dormId } }).catch(() => {});
      await prisma.billingCycle.deleteMany({ where: { dormitoryId: dormId } }).catch(() => {});
      await prisma.room.deleteMany({ where: { dormitoryId: dormId } }).catch(() => {});
      await prisma.building.deleteMany({ where: { dormitoryId: dormId } }).catch(() => {});
      await prisma.dormitoryBillingSettings.deleteMany({ where: { dormitoryId: dormId } }).catch(() => {});
      await prisma.onboardingDraft.deleteMany({ where: { provisionalDormitoryId: dormId } }).catch(() => {});
      await prisma.dormitory.delete({ where: { id: dormId } }).catch(() => {});
    }

    for (const userId of testUserIds) {
      await prisma.onboardingDraft.deleteMany({ where: { userId } }).catch(() => {});
      await prisma.session.deleteMany({ where: { userId } }).catch(() => {});
      await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    }
  });

  it("Part C — Cross-Month Onboarding: Provisional July (31 Jul 23:30), Finalized August (01 Aug) -> August first operational cycle, 0 July baselines", async () => {
    const ownerUserId = randomUUID();
    testUserIds.push(ownerUserId);
    await prisma.user.create({
      data: {
        id: ownerUserId,
        email: `cross_owner_${Date.now()}@test.local`,
        emailNormalized: `cross_owner_${Date.now()}@test.local`,
        name: "Cross Month Test Owner",
        googleSubject: `goog_cross_${Date.now()}`,
      },
    });

    const dormId = randomUUID();
    testDormIds.push(dormId);

    const provisionalCreatedAt = new Date("2026-07-31T16:30:00.000Z");
    await prisma.dormitory.create({
      data: {
        id: dormId,
        name: "หอพัก Cross Month Test",
        status: "active",
        createdAt: provisionalCreatedAt,
        updatedAt: new Date("2026-08-01T02:00:00.000Z"),
        createdByUserId: ownerUserId,
      },
    });

    const finalizedAt = new Date("2026-08-01T02:00:00.000Z");
    await prisma.onboardingDraft.create({
      data: {
        id: randomUUID(),
        userId: ownerUserId,
        provisionalDormitoryId: dormId,
        currentStep: "COMPLETED",
        finalizedAt,
        createdAt: provisionalCreatedAt,
        updatedAt: finalizedAt,
        expiresAt: new Date(Date.now() + 86400000),
        payload: {},
      },
    });

    await prisma.dormitoryBillingSettings.create({
      data: {
        dormitoryId: dormId,
        billingDay: 25,
        dueDay: 5,
        waterBillingType: "per_unit",
        waterRate: 18,
        electricityBillingType: "per_unit",
        electricityRate: 7,
      },
    });

    const building = await prisma.building.create({
      data: {
        id: randomUUID(),
        dormitoryId: dormId,
        name: "อาคาร A",
        floorCount: 2,
      },
    });

    for (let i = 1; i <= 4; i++) {
      await prisma.room.create({
        data: {
          id: randomUUID(),
          dormitoryId: dormId,
          buildingId: building.id,
          roomNumber: `10${i}`,
          normalizedRoomNumber: `10${i}`,
          floor: 1,
          roomType: "standard",
          status: "vacant",
          monthlyRent: 4500,
          depositAmount: 5000,
          termDeposit: 5000,
          monthlyDeposit: 5000,
          dailyDeposit: 5000,
        },
      });
    }

    const opStartAuth = await billingCycleService.resolveDormitoryOperationalStart(dormId);
    expect(opStartAuth.source).toBe("FINALIZED_DRAFT");
    expect(opStartAuth.operationalStartMonth).toBe("2026-08");

    const createdCycles = await billingCycleService.ensureRollingBillingCycles(dormId, ownerUserId);
    expect(createdCycles.length).toBeGreaterThanOrEqual(1);

    const julyCycle = await prisma.billingCycle.findFirst({
      where: { dormitoryId: dormId, cycleCode: "2026-07" },
    });
    expect(julyCycle).toBeNull();

    const augustCycle = await prisma.billingCycle.findFirst({
      where: { dormitoryId: dormId, cycleCode: "2026-08" },
    });
    expect(augustCycle).not.toBeNull();

    const julyBaselines = await prisma.roomOperationalStatusChange.count({
      where: {
        dormitoryId: dormId,
        effectiveBillingCycle: { cycleCode: "2026-07" },
      },
    });
    expect(julyBaselines).toBe(0);

    const augustBaselines = await prisma.roomOperationalStatusChange.findMany({
      where: {
        dormitoryId: dormId,
        effectiveBillingCycleId: augustCycle!.id,
      },
    });
    expect(augustBaselines.length).toBe(4);
    expect(augustBaselines.every((b) => b.status === "vacant")).toBe(true);

    const navCtx = await billingCycleService.getNavigationContext(dormId);
    expect(navCtx.historicalFloorCycleCode).toBe("2026-08");
  });

  it("Part D — Same-Month Onboarding: Provisional August, Finalized August -> August first operational cycle", async () => {
    const ownerUserId = randomUUID();
    testUserIds.push(ownerUserId);
    await prisma.user.create({
      data: {
        id: ownerUserId,
        email: `same_month_${Date.now()}@test.local`,
        emailNormalized: `same_month_${Date.now()}@test.local`,
        name: "Same Month Owner",
        googleSubject: `goog_same_${Date.now()}`,
      },
    });

    const dormId = randomUUID();
    testDormIds.push(dormId);

    const augDate = new Date("2026-08-10T05:00:00.000Z");
    await prisma.dormitory.create({
      data: {
        id: dormId,
        name: "หอพัก Same Month Test",
        status: "active",
        createdAt: augDate,
        updatedAt: augDate,
        createdByUserId: ownerUserId,
      },
    });

    await prisma.onboardingDraft.create({
      data: {
        id: randomUUID(),
        userId: ownerUserId,
        provisionalDormitoryId: dormId,
        currentStep: "COMPLETED",
        finalizedAt: augDate,
        createdAt: augDate,
        updatedAt: augDate,
        expiresAt: new Date(Date.now() + 86400000),
        payload: {},
      },
    });

    const opStartAuth = await billingCycleService.resolveDormitoryOperationalStart(dormId);
    expect(opStartAuth.source).toBe("FINALIZED_DRAFT");
    expect(opStartAuth.operationalStartMonth).toBe("2026-08");
  });

  it("Part E — Legacy Active Dormitory with Persisted Historical BillingCycles: Preserves historical floor without draft", async () => {
    const dormId = randomUUID();
    testDormIds.push(dormId);

    await prisma.dormitory.create({
      data: {
        id: dormId,
        name: "หอพัก Active Legacy Test",
        status: "active",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-08-01T00:00:00.000Z"),
      },
    });

    await prisma.billingCycle.create({
      data: {
        id: randomUUID(),
        dormitoryId: dormId,
        cycleCode: "2026-05",
        name: "2026-05",
        periodStart: new Date("2026-05-01T00:00:00.000Z"),
        periodEnd: new Date("2026-05-31T23:59:59.000Z"),
        billingDate: new Date("2026-05-25T00:00:00.000Z"),
        dueDate: new Date("2026-06-05T00:00:00.000Z"),
        status: "completed",
      },
    });

    const opStartAuth = await billingCycleService.resolveDormitoryOperationalStart(dormId);
    expect(opStartAuth.source).toBe("PERSISTED_BILLING_CYCLE");
    expect(opStartAuth.operationalStartMonth).toBe("2026-05");
  });

  it("Part F — Error Handling: ensureRollingBillingCycles propagates unexpected errors while tolerating benign duplicates", async () => {
    const dormId = randomUUID();
    testDormIds.push(dormId);

    await prisma.dormitory.create({
      data: {
        id: dormId,
        name: "หอพัก Invalid Settings Test",
        status: "active",
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
      },
    });

    await prisma.dormitoryBillingSettings.create({
      data: {
        dormitoryId: dormId,
        billingDay: 25,
        dueDay: 99,
      },
    });

    await expect(billingCycleService.ensureRollingBillingCycles(dormId)).rejects.toThrow(
      "DUE_DAY_REQUIRED"
    );
  });
});
