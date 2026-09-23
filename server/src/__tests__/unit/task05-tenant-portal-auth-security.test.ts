/**
 * Task 05: Tenant Portal Authentication & Session Isolation Unit Test Suite (SEC-11)
 * Validates removal of fallback session impersonation, strict active membership check,
 * and fail-closed 401 authentication.
 * @license Apache-2.0
 */

import express, { type Request, type Response } from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTenantPortalRouter } from '../../routes/tenant-portal.routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mock prisma for resolveTenantContext queries
vi.mock('../../db/prisma.js', () => {
  const mockTenant = {
    id: 'tenant-101',
    dormitoryId: 'dorm-001',
    name: 'สมชาย รักสงบ',
    phone: '0812345678',
    status: 'active',
    linkedUserId: '20000002-0000-4000-8000-000000000004',
    deletedAt: null,
    contracts: [
      {
        id: 'ctr-101',
        status: 'active',
        roomId: 'room-101',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        rentBillingType: 'monthly',
        rentAmount: 5000,
        depositAmount: 10000,
        advancePaymentAmount: 5000,
        contractNumber: 'CTR-2026-001',
        room: {
          id: 'room-101',
          roomNumber: '101',
          floor: 1,
          buildingId: 'b-1',
          building: { name: 'อาคาร A', termMonths: 5 },
        },
      },
    ],
    dormitory: {
      id: 'dorm-001',
      name: 'หอพักทดสอบ',
    },
    occupancies: [],
  };

  const defaultModelMock = {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn().mockResolvedValue(null),
    count: vi.fn().mockResolvedValue(0),
    update: vi.fn().mockResolvedValue({}),
    create: vi.fn().mockResolvedValue({}),
  };

  const explicitMocks = {
    $transaction: vi.fn(async (cb: any) => cb(mockPrisma)),
    $executeRaw: vi.fn().mockResolvedValue(1),
    tenant: {
      findMany: vi.fn().mockResolvedValue([mockTenant]),
      findFirst: vi.fn().mockResolvedValue(mockTenant),
      findUnique: vi.fn().mockResolvedValue(mockTenant),
      update: vi.fn().mockResolvedValue(mockTenant),
    },
    dormitory: {
      findUnique: vi.fn().mockResolvedValue({ id: 'dorm-001', name: 'หอพักทดสอบ' }),
    },
    room: {
      findUnique: vi.fn().mockResolvedValue({ id: 'room-101', roomNumber: '101', building: { name: 'อาคาร A' } }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    contract: {
      findMany: vi.fn().mockResolvedValue([mockTenant.contracts[0]]),
      findFirst: vi.fn().mockResolvedValue(mockTenant.contracts[0]),
      findUnique: vi.fn().mockResolvedValue(mockTenant.contracts[0]),
    },
    dormitoryPropertyDefaults: {
      findUnique: vi.fn().mockResolvedValue({ petPolicy: { allowed: 'none', allowedTypes: [] } }),
    },
    tenantCoOccupant: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    tenantVehicle: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    tenantEmergencyContact: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    dormitoryMember: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    dormitoryAccessGrant: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    tenantRegistrationRequest: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    bill: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  };

  const mockPrisma: any = new Proxy(explicitMocks, {
    get(target: any, prop: string | symbol) {
      if (prop in target) return target[prop];
      return defaultModelMock;
    },
  });

  return {
    getPrismaClient: () => mockPrisma,
    prisma: mockPrisma,
  };
});

describe('Task 05: Tenant Portal Authentication & Session Isolation (SEC-11)', () => {
  let app: express.Express;
  let mockAuthenticated = false;
  let mockUserMemberships: any[] = [];
  let mockUserId = '20000002-0000-4000-8000-000000000004';

  const mockAuthService: any = {
    requireAuth: () => (req: Request, res: Response, next: any) => {
      if (!mockAuthenticated) {
        return res.status(401).json({
          error: {
            code: 'SESSION_REQUIRED',
            message: 'กรุณาเข้าสู่ระบบก่อนใช้งาน',
          },
        });
      }

      req.auth = {
        userId: mockUserId,
        sessionId: 'sess-tenant-valid',
        tokenVersion: 1,
        user: {
          id: mockUserId,
          name: 'สมชาย รักสงบ',
          phone: '0812345678',
        } as any,
        session: {
          id: 'sess-tenant-valid',
          status: 'active',
        } as any,
        memberships: mockUserMemberships,
        dormitoryId: mockUserMemberships[0]?.dormitoryId || 'dorm-001',
      };
      next();
    },
    validateSession: vi.fn(),
    verifyCsrf: vi.fn().mockReturnValue(true),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticated = false;
    mockUserId = '20000002-0000-4000-8000-000000000004';
    mockUserMemberships = [
      {
        id: 'mem-tenant-1',
        dormitoryId: 'dorm-001',
        userId: mockUserId,
        roleCode: 'TENANT',
        role: { code: 'TENANT', name: 'ผู้เช่า' },
        status: 'active',
      },
    ];

    app = express();
    app.use(express.json());
    app.use('/api/v1/tenant-portal', createTenantPortalRouter(mockAuthService));
  });

  describe('1. Unauthenticated Requests (Fail-Closed 401)', () => {
    it('rejects unauthenticated request to /profile with HTTP 401 Unauthorized', async () => {
      mockAuthenticated = false;
      const res = await request(app).get('/api/v1/tenant-portal/profile');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('SESSION_REQUIRED');
      expect(res.body.error.message).toContain('กรุณาเข้าสู่ระบบก่อนใช้งาน');
    });

    it('rejects unauthenticated request to /bills with HTTP 401 Unauthorized', async () => {
      mockAuthenticated = false;
      const res = await request(app).get('/api/v1/tenant-portal/bills');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('SESSION_REQUIRED');
    });

    it('rejects unauthenticated request to /rooms with HTTP 401 Unauthorized', async () => {
      mockAuthenticated = false;
      const res = await request(app).get('/api/v1/tenant-portal/rooms');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('SESSION_REQUIRED');
    });
  });

  describe('2. Elimination of Header / Query Spoofing Vectors (SEC-11)', () => {
    it('does NOT synthesize a session when x-dormitory-id header is passed without auth', async () => {
      mockAuthenticated = false;
      const res = await request(app)
        .get('/api/v1/tenant-portal/profile')
        .set('x-dormitory-id', 'dorm-001');

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('SESSION_REQUIRED');
    });

    it('does NOT synthesize a session when ?dormitoryId= query param is passed without auth', async () => {
      mockAuthenticated = false;
      const res = await request(app).get('/api/v1/tenant-portal/profile?dormitoryId=dorm-001');

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('SESSION_REQUIRED');
    });

    it('does NOT bind or return tenant data when spoofed x-registration-id header is passed without auth', async () => {
      mockAuthenticated = false;
      const res = await request(app)
        .get('/api/v1/tenant-portal/profile')
        .set('x-registration-id', '11111111-2222-3333-4444-555555555555');

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('SESSION_REQUIRED');
    });
  });

  describe('3. Active Membership Enforcement', () => {
    it('rejects authenticated user with revoked membership with HTTP 403 Forbidden', async () => {
      mockAuthenticated = true;
      mockUserMemberships = [
        {
          id: 'mem-revoked-1',
          dormitoryId: 'dorm-001',
          userId: mockUserId,
          roleCode: 'TENANT',
          role: { code: 'TENANT', name: 'ผู้เช่า' },
          status: 'revoked', // Membership was revoked!
        },
      ];

      const res = await request(app).get('/api/v1/tenant-portal/profile');
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.message).toContain('คุณไม่มีสิทธิ์เข้าถึงพอร์ทัลผู้เช่า');
    });

    it('rejects authenticated user with suspended membership with HTTP 403 Forbidden', async () => {
      mockAuthenticated = true;
      mockUserMemberships = [
        {
          id: 'mem-suspended-1',
          dormitoryId: 'dorm-001',
          userId: mockUserId,
          roleCode: 'TENANT',
          role: { code: 'TENANT', name: 'ผู้เช่า' },
          status: 'suspended',
        },
      ];

      const res = await request(app).get('/api/v1/tenant-portal/profile');
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects authenticated STAFF member without a tenancy with HTTP 403 Forbidden', async () => {
      mockAuthenticated = true;
      const { getPrismaClient } = await import('../../db/prisma.js');
      const prisma = getPrismaClient() as any;
      prisma.tenant.findMany.mockResolvedValueOnce([]);

      mockUserMemberships = [
        {
          id: 'mem-staff-1',
          dormitoryId: 'dorm-001',
          userId: mockUserId,
          roleCode: 'STAFF',
          role: { code: 'STAFF', name: 'ช่าง/แม่บ้าน' },
          status: 'active',
        },
      ];

      const res = await request(app).get('/api/v1/tenant-portal/profile');
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.message).toContain('คุณไม่มีสิทธิ์เข้าถึงพอร์ทัลผู้เช่า');
    });
  });

  describe('4. Authenticated Active Tenant Success Path', () => {
    it('allows authenticated active Tenant to retrieve /profile with HTTP 200', async () => {
      mockAuthenticated = true;
      mockUserMemberships = [
        {
          id: 'mem-tenant-1',
          dormitoryId: 'dorm-001',
          userId: mockUserId,
          roleCode: 'TENANT',
          role: { code: 'TENANT', name: 'ผู้เช่า' },
          status: 'active',
        },
      ];

      const res = await request(app).get('/api/v1/tenant-portal/profile');
      expect(res.status).toBe(200);
      expect(res.body.id).toBe('tenant-101');
      expect(res.body.status).toBe('active');
    });

    it('allows authenticated active Tenant to retrieve /rooms with HTTP 200', async () => {
      mockAuthenticated = true;
      const res = await request(app).get('/api/v1/tenant-portal/rooms');
      expect(res.status).toBe(200);
      expect(res.body.rooms).toBeDefined();
      expect(res.body.rooms.length).toBeGreaterThan(0);
      expect(res.body.rooms[0].roomNumber).toBe('101');
    });
  });

  describe('5. Source Code Audit (SEC-11 & Clean Architecture)', () => {
    const routeFilePath = path.resolve(__dirname, '../../routes/tenant-portal.routes.ts');
    const routeSource = fs.readFileSync(routeFilePath, 'utf8');

    it('contains NO occurrences of hardcoded UUID "d99948ec-49d4-4629-9fea-567241e5049d"', () => {
      expect(routeSource).not.toContain('d99948ec-49d4-4629-9fea-567241e5049d');
    });

    it('contains NO fallback session synthesis via dormitoryAccessGrant.findFirst on missing auth', () => {
      expect(routeSource).not.toContain('Fallback candidate session for LINE / browser devices');
      expect(routeSource).not.toContain('fallbackDormId');
    });

    it('contains NO isTestEnv bypass flag in router auth middleware', () => {
      expect(routeSource).not.toContain('const isTestEnv = process.env.NODE_ENV');
    });
  });
});
