/**
 * Card S4: Tenant Owner API Blocking & CSRF Enforcement Unit Tests
 * @license Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createBillingRouter } from '../../routes/billing.routes.js';
import { createPropertyRouter } from '../../routes/property.routes.js';
import { createContractRouter } from '../../routes/contract.routes.js';
import { moveOutRouter } from '../../routes/move-out.routes.js';
import { createContractRenewalRouter } from '../../routes/contract-renewal.routes.js';
import { createDormitoryRouter } from '../../routes/dormitory.routes.js';
import { createTenantPortalRouter } from '../../routes/tenant-portal.routes.js';

describe('Card S4: Tenant Owner API Blocking & CSRF Enforcement', () => {
  const DORM_A = '11111111-0000-4000-8000-000000000001';
  const TENANT_A = 'aaaaaaaa-1111-4000-8000-000000000001';
  const TENANT_C = 'cccccccc-3333-4000-8000-000000000003';
  const CONTRACT_A = 'ffffffff-6666-4000-8000-000000000006';
  const CONTRACT_C = 'ffffffff-7777-4000-8000-000000000007';
  const GRANT_A = '44444444-1111-4000-8000-000000000008';
  const FRIEND_A = '55555555-1111-4000-8000-000000000005';

  const parseCookiesMiddleware = (req: any, _res: any, next: any) => {
    req.cookies = req.cookies || {};
    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
      cookieHeader.split(';').forEach((c: string) => {
        const [k, v] = c.trim().split('=');
        if (k && v) req.cookies[k] = v;
      });
    }
    next();
  };

  const createTenantAuth = () => ({
    userId: `ag_user_${GRANT_A}`,
    dormitoryId: DORM_A,
    role: 'TENANT',
    sessionId: 'session-123',
    rawSessionId: 'session-123',
    session: { accessGrantId: GRANT_A, tokenVersion: 1 },
    user: { id: `ag_user_${GRANT_A}`, email: 'tenant@test.com' },
    memberships: [
      {
        dormitoryId: DORM_A,
        role: 'TENANT',
        roleCode: 'TENANT',
        status: 'active',
      },
    ],
  });

  const createMockAuthService = (roleCode: string = 'TENANT') => {
    const authData = {
      userId: roleCode === 'TENANT' ? `ag_user_${GRANT_A}` : 'owner-user-1',
      dormitoryId: DORM_A,
      role: roleCode,
      sessionId: 'session-123',
      rawSessionId: 'session-123',
      session: { accessGrantId: GRANT_A, tokenVersion: 1 },
      user: { id: roleCode === 'TENANT' ? `ag_user_${GRANT_A}` : 'owner-user-1' },
      memberships: [
        {
          dormitoryId: DORM_A,
          role: roleCode,
          roleCode: roleCode,
          status: 'active',
        },
      ],
    };

    return {
      requireAuth: () => (req: any, _res: any, next: any) => {
        req.auth = authData;
        next();
      },
      validateSession: vi.fn().mockResolvedValue(authData),
      verifyCsrf: (token: string, sessionId: string) => token === 'valid-csrf-token' && sessionId === 'session-123',
      verifyCsrfToken: (token: string, sessionId: string) => token === 'valid-csrf-token' && sessionId === 'session-123',
    };
  };

  beforeEach(async () => {
    vi.restoreAllMocks();
    const { getPrismaClient } = await import('../../db/prisma.js');
    const prisma = getPrismaClient();
    if (typeof (prisma as any).$transaction === 'function') {
      vi.spyOn(prisma, '$transaction').mockImplementation(async (cb: any) => {
        if (typeof cb === 'function') return cb(prisma);
        return cb;
      });
    }
  });

  describe('AC S4-1: Blocking TENANT from Owner APIs', () => {
    it('rejects TENANT calling GET /bills with 403', async () => {
      const app = express();
      app.use(express.json());
      app.use(parseCookiesMiddleware);
      const mockAuthService: any = createMockAuthService('TENANT');
      const mockBillingService: any = {
        getBills: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      };

      app.use((req: any, _res, next) => {
        req.auth = createTenantAuth();
        req.dormitoryContext = {
          dormitoryId: DORM_A,
          roleCode: 'TENANT',
          userId: req.auth.userId,
          permissions: [], // zero owner permissions
        };
        next();
      });
      app.use('/bills', createBillingRouter(mockAuthService, mockBillingService));

      const res = await request(app)
        .get('/bills')
        .set('Cookie', 'horplus_session=valid-session')
        .set('x-dormitory-id', DORM_A);

      expect(res.status).toBe(403);
      expect(mockBillingService.getBills).not.toHaveBeenCalled();
    });

    it('rejects TENANT calling GET /properties/rooms with 403', async () => {
      const app = express();
      app.use(express.json());
      app.use(parseCookiesMiddleware);
      const mockAuthService: any = createMockAuthService('TENANT');
      const mockBuildingService: any = {};
      const mockRoomService: any = {
        getRooms: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      };

      app.use((req: any, _res, next) => {
        req.auth = createTenantAuth();
        req.dormitoryContext = {
          dormitoryId: DORM_A,
          roleCode: 'TENANT',
          userId: req.auth.userId,
          permissions: [],
        };
        next();
      });
      app.use('/properties', createPropertyRouter(mockAuthService, mockBuildingService, mockRoomService));

      const res = await request(app)
        .get('/properties/rooms')
        .set('Cookie', 'horplus_session=valid-session')
        .set('x-dormitory-id', DORM_A);

      expect(res.status).toBe(403);
      expect(mockRoomService.getRooms).not.toHaveBeenCalled();
    });

    it('rejects TENANT calling GET /contracts with 403', async () => {
      const app = express();
      app.use(express.json());
      app.use(parseCookiesMiddleware);
      const mockAuthService: any = createMockAuthService('TENANT');
      const mockContractService: any = {
        getContracts: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      };

      app.use((req: any, _res, next) => {
        req.auth = createTenantAuth();
        req.dormitoryContext = {
          dormitoryId: DORM_A,
          roleCode: 'TENANT',
          userId: req.auth.userId,
          permissions: [],
        };
        next();
      });
      app.use('/contracts', createContractRouter(mockAuthService, mockContractService));

      const res = await request(app)
        .get('/contracts')
        .set('Cookie', 'horplus_session=valid-session')
        .set('x-dormitory-id', DORM_A);

      expect(res.status).toBe(403);
      expect(mockContractService.getContracts).not.toHaveBeenCalled();
    });

    it('rejects TENANT calling GET /tenant-move-out-requests with 403', async () => {
      const app = express();
      app.use(express.json());
      app.use(parseCookiesMiddleware);

      app.use((req: any, _res, next) => {
        req.auth = createTenantAuth();
        req.dormitoryContext = {
          dormitoryId: DORM_A,
          roleCode: 'TENANT',
          userId: req.auth.userId,
          permissions: [],
        };
        next();
      });
      app.use('/', moveOutRouter);

      const res = await request(app)
        .get('/tenant-move-out-requests')
        .set('Cookie', 'horplus_session=valid-session')
        .set('x-dormitory-id', DORM_A);

      expect(res.status).toBe(403);
    });

    it('rejects TENANT calling GET /contract-renewals/requests with 403', async () => {
      const app = express();
      app.use(express.json());
      app.use(parseCookiesMiddleware);
      const mockAuthService: any = createMockAuthService('TENANT');

      app.use((req: any, _res, next) => {
        req.auth = createTenantAuth();
        req.dormitoryContext = {
          dormitoryId: DORM_A,
          roleCode: 'TENANT',
          userId: req.auth.userId,
          permissions: [],
        };
        next();
      });
      app.use('/contract-renewals', createContractRenewalRouter(mockAuthService));

      const res = await request(app)
        .get('/contract-renewals/requests')
        .set('Cookie', 'horplus_session=valid-session')
        .set('x-dormitory-id', DORM_A);

      expect(res.status).toBe(403);
    });
  });

  describe('AC S4-2: Tenant Legitimate Operations', () => {
    it('allows Tenant to download their own contract PDF, but rejects accessing another tenant contract', async () => {
      const app = express();
      app.use(express.json());
      app.use(parseCookiesMiddleware);
      const mockAuthService: any = createMockAuthService('TENANT');
      const mockContractService: any = {
        getContractById: vi.fn().mockImplementation((id: string) => {
          if (id === CONTRACT_A) {
            return Promise.resolve({ id: CONTRACT_A, tenantId: TENANT_A, dormitoryId: DORM_A });
          }
          if (id === CONTRACT_C) {
            return Promise.resolve({ id: CONTRACT_C, tenantId: TENANT_C, dormitoryId: DORM_A });
          }
          return Promise.resolve(null);
        }),
        getContractPdf: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 test')),
      };

      const { getPrismaClient } = await import('../../db/prisma.js');
      const prisma = getPrismaClient();

      vi.spyOn(prisma.dormitoryAccessGrant, 'findUnique').mockResolvedValue({
        id: GRANT_A,
        status: 'ACTIVE',
        roleCode: 'TENANT',
        dormitoryId: DORM_A,
        lineFriendId: FRIEND_A,
        lineFriend: {
          id: FRIEND_A,
        },
      } as any);

      vi.spyOn(prisma.tenant, 'findFirst').mockResolvedValue({
        id: TENANT_A,
        dormitoryId: DORM_A,
        status: 'active',
        deletedAt: null,
        lineFriendId: FRIEND_A,
      } as any);

      vi.spyOn(prisma.tenant, 'findMany').mockResolvedValue([
        {
          id: TENANT_A,
          dormitoryId: DORM_A,
          status: 'active',
          deletedAt: null,
          lineFriendId: FRIEND_A,
        },
      ] as any);

      app.use((req: any, _res, next) => {
        req.auth = createTenantAuth();
        req.dormitoryContext = {
          dormitoryId: DORM_A,
          roleCode: 'TENANT',
          userId: req.auth.userId,
          permissions: [],
        };
        next();
      });
      app.use('/contracts', createContractRouter(mockAuthService, mockContractService));

      // 1. Download own contract PDF -> 200
      const ownRes = await request(app)
        .get(`/contracts/${CONTRACT_A}/pdf`)
        .set('Cookie', 'horplus_session=valid-session')
        .set('x-dormitory-id', DORM_A);

      expect(ownRes.status).toBe(200);
      expect(ownRes.headers['content-type']).toContain('application/pdf');

      // 2. Try download another tenant contract PDF -> 403
      const otherRes = await request(app)
        .get(`/contracts/${CONTRACT_C}/pdf`)
        .set('Cookie', 'horplus_session=valid-session')
        .set('x-dormitory-id', DORM_A);

      expect(otherRes.status).toBe(403);
    });

    it('allows active tenant in dormitory to view owner signature for contract', async () => {
      const app = express();
      app.use(express.json());
      app.use(parseCookiesMiddleware);
      const mockAuthService: any = createMockAuthService('TENANT');
      const mockDormitoryRepo: any = {};
      const mockBillingRepo: any = {};
      const mockSubRepo: any = {};
      const mockPlanRepo: any = {};
      const mockSensitiveFieldService: any = {};
      const mockMembershipRepo: any = {
        findByUserAndDormitory: vi.fn().mockResolvedValue({
          id: 'mem-1',
          dormitoryId: DORM_A,
          userId: `ag_user_${GRANT_A}`,
          roleCode: 'TENANT',
          status: 'active',
        }),
      };
      const mockRoleRepo: any = {};

      const { SignatureStorageService } = await import('../../services/signature-storage.service.js');
      vi.spyOn(SignatureStorageService.prototype, 'getLatestSignatureRecord').mockResolvedValue({
        id: 'sig-1',
        dormitoryId: DORM_A,
        objectKey: 'signatures/sig-1.png',
      } as any);

      vi.spyOn(SignatureStorageService.prototype, 'getSignatureStream').mockResolvedValue({
        pipe: (res: any) => {
          res.setHeader('Content-Type', 'image/png');
          res.send(Buffer.from('PNG_SIGNATURE_BYTES'));
        },
      } as any);

      app.use(
        '/dormitories',
        createDormitoryRouter(
          mockAuthService,
          mockDormitoryRepo,
          mockBillingRepo,
          mockSubRepo,
          mockPlanRepo,
          mockSensitiveFieldService,
          mockMembershipRepo,
          mockRoleRepo
        )
      );

      const res = await request(app)
        .get(`/dormitories/${DORM_A}/signature`)
        .set('Cookie', 'horplus_session=valid-session')
        .set('x-dormitory-id', DORM_A);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('image/png');
    });
  });

  describe('AC S4-3: Contract Renewal Scoping & Injection Rejection', () => {
    it('rejects request when tenant supplies another tenantId (TC)', async () => {
      const app = express();
      app.use(express.json());
      app.use(parseCookiesMiddleware);
      const mockAuthService: any = createMockAuthService('TENANT');

      const { getPrismaClient } = await import('../../db/prisma.js');
      const prisma = getPrismaClient();

      vi.spyOn(prisma.dormitoryAccessGrant, 'findUnique').mockResolvedValue({
        id: GRANT_A,
        status: 'ACTIVE',
        roleCode: 'TENANT',
        dormitoryId: DORM_A,
        lineFriendId: FRIEND_A,
        lineFriend: {
          id: FRIEND_A,
        },
      } as any);

      vi.spyOn(prisma.tenant, 'findFirst').mockResolvedValue({
        id: TENANT_A,
        dormitoryId: DORM_A,
        status: 'active',
        deletedAt: null,
        lineFriendId: FRIEND_A,
      } as any);

      vi.spyOn(prisma.tenant, 'findMany').mockResolvedValue([
        {
          id: TENANT_A,
          dormitoryId: DORM_A,
          status: 'active',
          deletedAt: null,
          lineFriendId: FRIEND_A,
        },
      ] as any);

      app.use((req: any, _res, next) => {
        req.auth = createTenantAuth();
        req.dormitoryContext = {
          dormitoryId: DORM_A,
          roleCode: 'TENANT',
          userId: req.auth.userId,
          permissions: [],
        };
        next();
      });
      app.use('/contract-renewals', createContractRenewalRouter(mockAuthService));

      const res = await request(app)
        .post('/contract-renewals/request')
        .set('Cookie', 'horplus_session=valid-session; horplus_csrf=valid-csrf-token')
        .set('x-dormitory-id', DORM_A)
        .set('x-csrf-token', 'valid-csrf-token')
        .send({
          tenantId: TENANT_C, // Attempting to renew for another tenant
          contractId: CONTRACT_A,
          requestedDurationMonths: 6,
        });

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('คุณไม่มีสิทธิ์ดำเนินการต่อสัญญาของผู้เช่ารายอื่น');
    });
  });

  describe('AC S4-4: Strict CSRF Enforcement on Tenant Mutations', () => {
    it('returns 403 CSRF_TOKEN_REQUIRED when mutating without x-csrf-token', async () => {
      const app = express();
      app.use(express.json());
      app.use(parseCookiesMiddleware);
      const mockAuthService: any = createMockAuthService('TENANT');

      app.use('/tenant-portal', createTenantPortalRouter(mockAuthService));

      const res = await request(app)
        .patch('/tenant-portal/profile')
        .set('Cookie', 'horplus_session=valid-session')
        .set('x-dormitory-id', DORM_A)
        .send({ petInformation: 'Cat' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CSRF_TOKEN_REQUIRED');
    });

    it('returns 403 CSRF_TOKEN_INVALID when mutating with bad x-csrf-token', async () => {
      const app = express();
      app.use(express.json());
      app.use(parseCookiesMiddleware);
      const mockAuthService: any = createMockAuthService('TENANT');

      app.use('/tenant-portal', createTenantPortalRouter(mockAuthService));

      const res = await request(app)
        .patch('/tenant-portal/profile')
        .set('Cookie', 'horplus_session=valid-session')
        .set('x-dormitory-id', DORM_A)
        .set('x-csrf-token', 'bad-token')
        .send({ petInformation: 'Cat' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CSRF_TOKEN_INVALID');
    });
  });
});
