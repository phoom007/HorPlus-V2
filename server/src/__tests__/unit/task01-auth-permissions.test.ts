/**
 * Task 01: Core Roles, Permissions & PDF Document Access Control Unit Test Suite
 * @license Apache-2.0
 */

import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSubscriptionRouter } from '../../routes/subscription.routes.js';
import { createContractRouter } from '../../routes/contract.routes.js';
import { createMaintenanceRouter } from '../../routes/maintenance.routes.js';
import { moveOutRouter } from '../../routes/move-out.routes.js';

describe('Task 01: Core Roles, Permissions & Document Access Control', () => {
  const mockDormitoryId = '20000001-0000-4000-8000-000000000002';
  const otherDormitoryId = '20000001-0000-4000-8000-000000000003';
  const mockOwnerUserId = '20000002-0000-4000-8000-000000000001';
  const mockManagerUserId = '20000002-0000-4000-8000-000000000002';
  const mockStaffUserId = '20000002-0000-4000-8000-000000000003';
  const mockTenantUserId = '20000002-0000-4000-8000-000000000004';
  const mockOtherTenantUserId = '20000002-0000-4000-8000-000000000005';

  const mockContractId = 'ctr-101';
  const mockTenantId = 'tenant-101';

  let currentRole: string = 'OWNER';
  let currentUserId: string = mockOwnerUserId;

  const mockAuthService: any = {
    requireAuth: () => (req: any, _res: any, next: any) => {
      req.auth = {
        userId: currentUserId,
        sessionId: 'sess-test',
        roleCode: currentRole,
        role: currentRole.toLowerCase(),
        dormitoryId: mockDormitoryId,
        memberships: [
          {
            id: `mem-${currentRole.toLowerCase()}`,
            dormitoryId: mockDormitoryId,
            roleCode: currentRole,
            status: 'active',
          },
        ],
      };
      req.dormitoryContext = {
        dormitoryId: mockDormitoryId,
        roleCode: currentRole,
        userId: currentUserId,
        permissions:
          currentRole === 'OWNER'
            ? ['*']
            : currentRole === 'MANAGER'
            ? ['contracts:view', 'maintenance:write', 'maintenance:update', 'maintenance:close']
            : currentRole === 'STAFF'
            ? ['maintenance:view', 'maintenance:update', 'maintenance:close']
            : [],
      };
      next();
    },
    verifyCsrf: () => true,
  };

  const mockContractService: any = {
    getContractById: vi.fn(async (id: string, dormId: string) => {
      if (id === mockContractId && dormId === mockDormitoryId) {
        return {
          id: mockContractId,
          dormitoryId: mockDormitoryId,
          tenantId: mockTenantId,
          status: 'ACTIVE',
        };
      }
      return null;
    }),
    getContractPdf: vi.fn(async () => Buffer.from('%PDF-1.4 mock pdf content')),
    getContracts: vi.fn(async () => ({ items: [], total: 0 })),
  };

  const mockMaintenanceService: any = {
    updateStatus: vi.fn(async (input: any) => ({
      id: input.requestId,
      status: input.status,
      actorType: input.actorType,
      actorRoleCode: input.actorRoleCode,
    })),
  };

  const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      // Setup mock header
      req.headers['x-dormitory-id'] = mockDormitoryId;
      req.headers['x-csrf-token'] = 'csrf-valid';
      next();
    });

    app.use('/api/v1/subscription', createSubscriptionRouter(mockAuthService));
    app.use('/api/v1/contracts', mockAuthService.requireAuth(), createContractRouter(mockAuthService, mockContractService));
    app.use('/api/v1/maintenance-requests', mockAuthService.requireAuth(), createMaintenanceRouter(mockMaintenanceService));
    app.use('/api/v1', mockAuthService.requireAuth(), moveOutRouter);

    return app;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    currentRole = 'OWNER';
    currentUserId = mockOwnerUserId;
  });

  describe('1. Subscription Renewal Menu & Backend Role Isolation', () => {
    it('allows Owner to access /api/v1/subscription/config/payment', async () => {
      currentRole = 'OWNER';
      currentUserId = mockOwnerUserId;
      const app = buildApp();

      const res = await request(app).get('/api/v1/subscription/config/payment');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.promptPayId).toBeDefined();
    });

    it('denies Manager from accessing /api/v1/subscription/config/payment with 403 Forbidden', async () => {
      currentRole = 'MANAGER';
      currentUserId = mockManagerUserId;
      const app = buildApp();

      const res = await request(app).get('/api/v1/subscription/config/payment');
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('denies Staff from accessing /api/v1/subscription/config/payment with 403 Forbidden', async () => {
      currentRole = 'STAFF';
      currentUserId = mockStaffUserId;
      const app = buildApp();

      const res = await request(app).get('/api/v1/subscription/config/payment');
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('denies Tenant from accessing /api/v1/subscription/config/payment with 403 Forbidden', async () => {
      currentRole = 'TENANT';
      currentUserId = mockTenantUserId;
      const app = buildApp();

      const res = await request(app).get('/api/v1/subscription/config/payment');
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('2. Contract PDF Document Access Control', () => {
    it('allows Owner to download contract PDF via GET /api/v1/contracts/:id/pdf', async () => {
      currentRole = 'OWNER';
      currentUserId = mockOwnerUserId;
      const app = buildApp();

      const res = await request(app).get(`/api/v1/contracts/${mockContractId}/pdf`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(mockContractService.getContractPdf).toHaveBeenCalledWith(mockContractId, mockDormitoryId);
    });

    it('allows Manager to download contract PDF via GET /api/v1/contracts/:id/pdf', async () => {
      currentRole = 'MANAGER';
      currentUserId = mockManagerUserId;
      const app = buildApp();

      const res = await request(app).get(`/api/v1/contracts/${mockContractId}/pdf`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(mockContractService.getContractPdf).toHaveBeenCalledWith(mockContractId, mockDormitoryId);
    });

    it('strictly denies Staff from downloading contract PDF via GET /api/v1/contracts/:id/pdf with 403 Forbidden', async () => {
      currentRole = 'STAFF';
      currentUserId = mockStaffUserId;
      const app = buildApp();

      const res = await request(app).get(`/api/v1/contracts/${mockContractId}/pdf`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(mockContractService.getContractPdf).not.toHaveBeenCalled();
    });

    it('denies Staff from listing contracts via GET /api/v1/contracts with 403 Forbidden', async () => {
      currentRole = 'STAFF';
      currentUserId = mockStaffUserId;
      const app = buildApp();

      const res = await request(app).get('/api/v1/contracts');
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('3. Staff Maintenance Repair Closure (SEC-10)', () => {
    it('allows Staff to close a maintenance request directly', async () => {
      currentRole = 'STAFF';
      currentUserId = mockStaffUserId;
      const app = buildApp();

      const res = await request(app)
        .post('/api/v1/maintenance-requests/req-001/close')
        .send({ note: 'ซ่อมแซมเรียบร้อย ปิดงาน' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('closed');
      expect(res.body.actorType).toBe('staff');
      expect(mockMaintenanceService.updateStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'closed',
          actorType: 'staff',
        })
      );
    });
  });
});
