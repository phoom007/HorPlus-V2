import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { getPrismaClient } from '../../db/prisma.js';
import { createApp } from '../../app.js';
import { BillingCycleService } from '../../services/billing-cycle.service.js';
import { PrismaBillingCycleRepository } from '../../db/repositories/billing-cycle.repository.js';
import { currentCycleResolverService } from '../../services/current-cycle-resolver.js';
import { PrismaSessionRepository } from '../../db/repositories/session.repository.js';
import { SessionTokenService } from '../../services/session-token.service.js';
import { CsrfService } from '../../services/csrf.service.js';
import { getEnv } from '../../config/env.js';
import { randomUUID } from 'crypto';

const prisma = getPrismaClient();

describe('LOCAL-07 Billing Cycle Historical Floor & Progressive Selectability Test Suite', () => {
  let app: any;
  let testUserId: string;
  let billingCycleService: BillingCycleService;
  let cycleRepo: PrismaBillingCycleRepository;

  async function createTestAuthSession(userId: string) {
    const env = getEnv();
    const sessionRepo = new PrismaSessionRepository(prisma);
    const sessionTokenService = new SessionTokenService(env.SESSION_ENCRYPTION_KEY);
    const csrfService = new CsrfService(env.CSRF_SIGNING_KEY);

    const sessionId = randomUUID();
    const sessionIdHash = SessionTokenService.hashSessionId(sessionId);
    const ttlSeconds = env.SESSION_TTL_SECONDS || 86400;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    await sessionRepo.createSession({
      userId,
      sessionIdHash,
      expiresAt,
      tokenVersion: 1,
    });

    const sessionToken = sessionTokenService.encryptToken(
      {
        sub: userId,
        sid: sessionId,
        type: 'session',
        version: 1,
      },
      ttlSeconds
    );

    const csrfToken = csrfService.generateCsrfToken(sessionId);

    return {
      sessionToken,
      csrfToken,
      cookies: [`horplus_session=${sessionToken}`, `horplus_csrf=${csrfToken}`],
    };
  }

  beforeAll(async () => {
    app = createApp();
    testUserId = randomUUID();
    cycleRepo = new PrismaBillingCycleRepository(prisma);
    billingCycleService = new BillingCycleService(cycleRepo);

    const email = `test-floor-${Date.now()}@example.com`;
    await prisma.user.create({
      data: {
        id: testUserId,
        email,
        emailNormalized: email.toLowerCase(),
        googleSubject: `google-floor-${Date.now()}`,
        name: 'Floor Test Admin',
        status: 'active',
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('CASE H1 & H2: Each dormitory derives its OWN historical floor from Dormitory.createdAt (Bangkok timezone)', async () => {
    const dormAId = randomUUID();
    const dormBId = randomUUID();

    // Dorm A registered July 15, 2026 Bangkok (2026-07-15T03:00:00Z)
    await prisma.dormitory.create({
      data: {
        id: dormAId,
        name: 'Dorm A (July Floor)',
        createdAt: new Date('2026-07-15T03:00:00.000Z'),
        status: 'active',
        billingSettings: {
          create: {
            billingDay: 25,
            dueDay: 5,
            waterBillingType: 'per_unit',
            waterRate: '18.00',
            electricityBillingType: 'per_unit',
            electricityRate: '7.00',
            commonFee: '200.00',
            commonFeeMode: 'fixed_per_room',
          },
        },
      },
    });

    // Create cycles 2026-07, 2026-08, 2026-09 for Dorm A
    for (const code of ['2026-07', '2026-08', '2026-09']) {
      await billingCycleService.createBillingCycle(dormAId, {
        cycleCode: code,
        name: code,
        periodStart: `${code}-01`,
        periodEnd: `${code}-28`,
        billingDate: `${code}-25`,
        dueDate: '2026-09-05',
      }, testUserId);
    }

    // Dorm B registered September 1, 2026 Bangkok (2026-09-01T00:00:00Z)
    await prisma.dormitory.create({
      data: {
        id: dormBId,
        name: 'Dorm B (Sept Floor)',
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        status: 'active',
        billingSettings: {
          create: {
            billingDay: 25,
            dueDay: 5,
            waterBillingType: 'per_unit',
            waterRate: '18.00',
            electricityBillingType: 'per_unit',
            electricityRate: '7.00',
            commonFee: '200.00',
            commonFeeMode: 'fixed_per_room',
          },
        },
      },
    });

    // Create cycles 2026-09, 2026-10 for Dorm B
    for (const code of ['2026-09', '2026-10']) {
      await billingCycleService.createBillingCycle(dormBId, {
        cycleCode: code,
        name: code,
        periodStart: `${code}-01`,
        periodEnd: `${code}-28`,
        billingDate: `${code}-25`,
        dueDate: '2026-10-05',
      }, testUserId);
    }

    const navA = await billingCycleService.getNavigationContext(dormAId);
    expect(navA.historicalFloorCycleCode).toBe('2026-07');
    expect(navA.selectableBillingCycles.map(c => c.cycleCode)).toContain('2026-07');
    expect(navA.selectableBillingCycles.map(c => c.cycleCode)).toContain('2026-08');
    expect(navA.selectableBillingCycles.map(c => c.cycleCode)).toContain('2026-09');

    const navB = await billingCycleService.getNavigationContext(dormBId);
    expect(navB.historicalFloorCycleCode).toBe('2026-09');
    expect(navB.selectableBillingCycles.map(c => c.cycleCode)).not.toContain('2026-07');
    expect(navB.selectableBillingCycles.map(c => c.cycleCode)).not.toContain('2026-08');
    expect(navB.selectableBillingCycles.map(c => c.cycleCode)).toContain('2026-09');
    expect(navB.selectableBillingCycles.map(c => c.cycleCode)).toContain('2026-10');
  });

  it('CASE H3 & H4: Historical cycles remain selectable forever as upper bound advances', async () => {
    const dormId = randomUUID();
    await prisma.dormitory.create({
      data: {
        id: dormId,
        name: 'Dorm Continuous History',
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        status: 'active',
        billingSettings: {
          create: {
            billingDay: 25,
            dueDay: 5,
            waterBillingType: 'per_unit',
            waterRate: '18.00',
            electricityBillingType: 'per_unit',
            electricityRate: '7.00',
            commonFee: '200.00',
            commonFeeMode: 'fixed_per_room',
          },
        },
      },
    });

    // Create July, August, September, October
    for (const code of ['2026-07', '2026-08', '2026-09', '2026-10']) {
      await billingCycleService.createBillingCycle(dormId, {
        cycleCode: code,
        name: code,
        periodStart: `${code}-01`,
        periodEnd: `${code}-28`,
        billingDate: `${code}-25`,
        dueDate: '2026-10-05',
      }, testUserId);
    }

    const nav1 = await billingCycleService.getNavigationContext(dormId);
    expect(nav1.historicalFloorCycleCode).toBe('2026-07');
    // Operational is 2026-08 (current date default), so opened upper bound is 2026-09
    expect(nav1.openedUpperBoundCycleCode).toBe('2026-09');
    expect(nav1.selectableBillingCycles.map(c => c.cycleCode)).toEqual(['2026-07', '2026-08', '2026-09']);

    // When November opens (opCode advances)
    await billingCycleService.createBillingCycle(dormId, {
      cycleCode: '2026-11',
      name: '2026-11',
      periodStart: '2026-11-01',
      periodEnd: '2026-11-28',
      billingDate: '2026-11-25',
      dueDate: '2026-12-05',
    }, testUserId);

    const bldg = await prisma.building.create({
      data: {
        dormitoryId: dormId,
        name: 'Building A',
      },
    });

    // Create room and issued bill in October to advance operational cycle to October
    const room = await prisma.room.create({
      data: {
        dormitoryId: dormId,
        buildingId: bldg.id,
        roomNumber: '101',
        normalizedRoomNumber: '101',
        roomType: 'standard',
        monthlyRent: '4500.00',
        status: 'occupied',
      },
    });
    const tenant = await prisma.tenant.create({
      data: {
        dormitoryId: dormId,
        tenantNumber: 'T-001',
        displayName: 'Tenant Oct',
        firstName: 'Tenant',
        lastName: 'Oct',
        phone: '0811111111',
        status: 'active',
      },
    });
    const octCycle = await prisma.billingCycle.findFirst({ where: { dormitoryId: dormId, cycleCode: '2026-10' } });
    await prisma.bill.create({
      data: {
        dormitoryId: dormId,
        billingCycleId: octCycle!.id,
        roomId: room.id,
        tenantId: tenant.id,
        billNumber: 'INV-202610-101',
        billKind: 'MONTHLY_UTILITY',
        billingDate: new Date('2026-10-25'),
        dueDate: new Date('2026-11-05'),
        subtotal: 1000,
        totalAmount: 1000,
        paidAmount: 0,
        outstandingAmount: 1000,
        status: 'unpaid',
      },
    });

    const op = await currentCycleResolverService.resolveOperationalBillingCycle(dormId);
    expect(op.cycleCode).toBe('2026-10');

    const nav2 = await billingCycleService.getNavigationContext(dormId);
    expect(nav2.historicalFloorCycleCode).toBe('2026-07');
    expect(nav2.openedUpperBoundCycleCode).toBe('2026-11');
    expect(nav2.selectableBillingCycles.map(c => c.cycleCode)).toEqual([
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
    ]);
  });

  it('CASE H5: Multi-year pagination-safe selectability test (Jan 2023 through Sept 2026, > 20 cycles)', async () => {
    const dormId = randomUUID();
    await prisma.dormitory.create({
      data: {
        id: dormId,
        name: 'Multi-Year Dorm 2023',
        createdAt: new Date('2023-01-01T00:00:00.000Z'),
        status: 'active',
        billingSettings: {
          create: {
            billingDay: 25,
            dueDay: 5,
            waterBillingType: 'per_unit',
            waterRate: '18.00',
            electricityBillingType: 'per_unit',
            electricityRate: '7.00',
            commonFee: '200.00',
            commonFeeMode: 'fixed_per_room',
          },
        },
      },
    });

    // Create 45 monthly cycles: 2023-01 through 2026-09 (opened upper bound)
    const allCodes: string[] = [];
    let y = 2023;
    let m = 1;
    while (y < 2026 || (y === 2026 && m <= 9)) {
      const code = `${y}-${String(m).padStart(2, '0')}`;
      allCodes.push(code);
      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
    }

    for (const code of allCodes) {
      await prisma.billingCycle.create({
        data: {
          dormitoryId: dormId,
          cycleCode: code,
          name: code,
          periodStart: new Date(`${code}-01T00:00:00.000Z`),
          periodEnd: new Date(`${code}-28T00:00:00.000Z`),
          billingDate: new Date(`${code}-25T00:00:00.000Z`),
          dueDate: new Date(`${code}-28T00:00:00.000Z`),
          status: 'draft',
        },
      });
    }

    let ownerRole = await prisma.role.findFirst({ where: { code: 'owner' } });
    if (!ownerRole) {
      ownerRole = await prisma.role.create({
        data: {
          code: 'owner',
          name: 'Owner',
          permissions: {},
          isSystem: true,
        },
      });
    }
    await prisma.dormitoryMember.create({
      data: {
        dormitoryId: dormId,
        userId: testUserId,
        roleId: ownerRole.id,
        status: 'active',
      },
    });

    const authSession = await createTestAuthSession(testUserId);
    const res = await request(app)
      .get('/api/v1/billing-cycles?pageSize=5&page=1')
      .set('Cookie', authSession.cookies)
      .set('x-csrf-token', authSession.csrfToken)
      .set('x-dormitory-id', dormId);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(5); // Paginated items is 5
    expect(res.body.pagination.total).toBe(allCodes.length);
    expect(res.body.historicalFloorCycleCode).toBe('2023-01');
    expect(res.body.selectableBillingCycles.length).toBe(allCodes.length);
    expect(res.body.selectableBillingCycles[0].cycleCode).toBe('2023-01');
    expect(res.body.selectableBillingCycles[res.body.selectableBillingCycles.length - 1].cycleCode).toBe('2026-09');
  });

  it('CASE H6: Historical continuity FAILS CLOSED if a middle month is missing in database', async () => {
    const dormId = randomUUID();
    await prisma.dormitory.create({
      data: {
        id: dormId,
        name: 'Incomplete History Dorm',
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        status: 'active',
        billingSettings: {
          create: {
            billingDay: 25,
            dueDay: 5,
            waterBillingType: 'per_unit',
            waterRate: '18.00',
            electricityBillingType: 'per_unit',
            electricityRate: '7.00',
            commonFee: '200.00',
            commonFeeMode: 'fixed_per_room',
          },
        },
      },
    });

    // Create 2026-07, 2026-08, 2026-10 (MISSING 2026-09)
    for (const code of ['2026-07', '2026-08', '2026-10']) {
      await prisma.billingCycle.create({
        data: {
          dormitoryId: dormId,
          cycleCode: code,
          name: code,
          periodStart: new Date(`${code}-01T00:00:00.000Z`),
          periodEnd: new Date(`${code}-28T00:00:00.000Z`),
          billingDate: new Date(`${code}-25T00:00:00.000Z`),
          dueDate: new Date(`${code}-28T00:00:00.000Z`),
          status: 'draft',
        },
      });
    }

    let threwErr: any = null;
    try {
      await billingCycleService.getNavigationContext(dormId);
    } catch (err: any) {
      threwErr = err;
    }

    expect(threwErr).not.toBeNull();
    expect(threwErr.code).toBe('BILLING_CYCLE_HISTORY_INCOMPLETE');
    expect(threwErr.details.missingCycleCodes).toContain('2026-09');
  });
});
