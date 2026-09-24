import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { CreateCoOccupantSchema } from '../../schemas/property-tenant-contract.schemas.js';

const { mockPrisma, mockNotificationService, mockBillingOrchestrationService } = vi.hoisted(() => {
  const mockNotificationService = {
    createInAppNotification: vi.fn().mockResolvedValue({ id: 'notif-1' }),
  };

  const mockBillingOrchestrationService = {
    addTenantCoOccupant: vi.fn(),
    removeTenantCoOccupant: vi.fn(),
  };

  const mockPrisma: any = {
    $transaction: vi.fn(async (cb: any) => cb(mockPrisma)),
    $executeRaw: vi.fn().mockResolvedValue(1),
    tenant: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    tenantVehicle: {
      updateMany: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    tenantCoOccupant: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    dormitoryPropertyDefaults: {
      findUnique: vi.fn().mockResolvedValue({ petPolicy: { allowed: 'all' } }),
    },
    dormitoryMember: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'mem-1',
          dormitoryId: 'dorm-1',
          userId: 'user-ta',
          status: 'active',
          role: { code: 'TENANT' },
        },
      ]),
    },
    contract: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'ctr-1',
        roomId: 'room-1',
        room: { roomNumber: '101' },
      }),
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'ctr-1',
          roomId: 'room-1',
          room: { roomNumber: '101' },
        },
      ]),
    },
    occupancy: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'occ-1',
        roomId: 'room-1',
        room: { roomNumber: '101' },
      }),
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'occ-1',
          roomId: 'room-1',
          room: { roomNumber: '101' },
        },
      ]),
    },
    dailyStay: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    dormitoryAccessGrant: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  };

  return { mockPrisma, mockNotificationService, mockBillingOrchestrationService };
});

vi.mock('../../db/prisma.js', () => ({
  getPrismaClient: () => mockPrisma,
}));

vi.mock('../../services/notification.service.js', () => ({
  NotificationService: vi.fn().mockImplementation(() => mockNotificationService),
}));

vi.mock('../../services/billing-orchestration.service.js', () => ({
  billingOrchestrationService: mockBillingOrchestrationService,
}));

// Import router factory after mocking dependencies
import { createTenantPortalRouter } from '../../routes/tenant-portal.routes.js';

describe('Card P1 — Tenant Profile, Co-Occupants & Notifications', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();

    app = express();
    app.use(express.json());

    // Inject mock session
    const TA_USER_ID = '11111111-1111-4111-8111-111111111111';
    app.use((req, _res, next) => {
      req.auth = {
        userId: TA_USER_ID,
        sessionId: 'sess-ta',
        memberships: [
          {
            id: 'mem-1',
            dormitoryId: 'dorm-1',
            userId: TA_USER_ID,
            status: 'active',
            role: { code: 'TENANT' },
          },
        ],
      } as any;
      req.headers['x-csrf-token'] = 'csrf-token-123';
      req.cookies = { horplus_csrf: 'csrf-token-123' };
      next();
    });

    const mockAuthService: any = {
      requireAuth: () => (req: any, _res: any, next: any) => next(),
      verifyCsrf: () => true,
    };

    app.use('/api/v1/tenant-portal', createTenantPortalRouter(mockAuthService));

    const taTenant = {
      id: 'tenant-ta-id',
      dormitoryId: 'dorm-1',
      linkedUserId: TA_USER_ID,
      displayName: 'สมชาย ใจดี (TA)',
      firstName: 'สมชาย',
      lastName: 'ใจดี',
      phone: '0812345678',
      petInfo: null,
      emergencyContact: { name: 'คุณแม่', relationship: 'มารดา', phone: '0899999999' },
    };

    mockPrisma.tenant.findMany.mockResolvedValue([taTenant]);
    mockPrisma.tenant.findFirst.mockResolvedValue(taTenant);
    mockPrisma.tenant.findUnique.mockResolvedValue(taTenant);
  });

  describe('1. Phone Format Validation (CreateCoOccupantSchema - AC P1-5)', () => {
    it('accepts valid 9-10 digit Thai phone numbers', () => {
      const validCases = [
        { name: 'น้องเอ', phone: '0812345678' },
        { name: 'น้องบี', phone: '021234567' },
        { name: 'น้องซี', phone: '081-234-5678' },
        { name: 'น้องดี', phone: null },
        { name: 'น้องอี', phone: undefined },
      ];

      for (const c of validCases) {
        const res = CreateCoOccupantSchema.safeParse(c);
        expect(res.success, `Expected valid phone ${c.phone}`).toBe(true);
      }
    });

    it('rejects invalid phone numbers with clear Thai error message', () => {
      const invalidCases = [
        { name: 'น้องเอ', phone: '12345' },
        { name: 'น้องบี', phone: '08123' },
        { name: 'น้องซี', phone: 'abcdefghij' },
        { name: 'น้องดี', phone: '1234567890' }, // does not start with 0
        { name: 'น้องอี', phone: '0812345678901' }, // 13 digits
      ];

      for (const c of invalidCases) {
        const res = CreateCoOccupantSchema.safeParse(c);
        expect(res.success, `Expected invalid phone ${c.phone}`).toBe(false);
        if (!res.success) {
          const phoneErr = res.error.issues.find((i) => i.path.includes('phone'));
          expect(phoneErr?.message).toBe('เบอร์โทรศัพท์ต้องเป็นตัวเลข 9-10 หลัก (ขึ้นต้นด้วย 0)');
        }
      }
    });
  });

  describe('2. PATCH /profile (AC P1-1, P1-2, P1-4, P1-6)', () => {
    it('updates vehicles and pets and creates staff in-app notification (P1-2)', async () => {
      mockPrisma.tenantVehicle.findMany.mockResolvedValue([
        {
          id: 'veh-1',
          type: 'car',
          licensePlate: '1กข-9999',
          brand: 'Toyota',
          model: 'Yaris',
          color: 'White',
        },
      ]);

      const res = await request(app)
        .patch('/api/v1/tenant-portal/profile')
        .send({
          vehicles: [
            {
              type: 'car',
              licensePlate: '1กข-9999',
              brand: 'Toyota',
              model: 'Yaris',
              color: 'White',
            },
          ],
          pets: [
            {
              type: 'cat',
              name: 'มิมี่',
            },
          ],
        });

      expect(res.status).toBe(200);
      expect(mockPrisma.tenant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'tenant-ta-id' },
          data: expect.objectContaining({
            petInfo: expect.objectContaining({
              hasPet: true,
            }),
          }),
        })
      );

      // Verify staff in-app notification was triggered
      expect(mockNotificationService.createInAppNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          dormitoryId: 'dorm-1',
          targetType: 'staff',
          category: 'TENANT_PROFILE_UPDATED',
          title: 'ผู้เช่าอัปเดตข้อมูล',
          metadata: expect.objectContaining({ tenantId: 'tenant-ta-id' }),
        })
      );
    });

    it('rejects cross-tenant profile updates with 403 Forbidden (P1-6)', async () => {
      const res = await request(app)
        .patch('/api/v1/tenant-portal/profile')
        .send({
          tenantId: 'tenant-tc-id', // Attacker trying to modify TC's profile
          vehicles: [{ type: 'car', licensePlate: '9999' }],
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(mockPrisma.tenant.update).not.toHaveBeenCalled();
    });

    it('ignores attempts to edit emergency contact, room, or rent (P1-1, P1-4)', async () => {
      mockPrisma.tenantVehicle.findMany.mockResolvedValue([]);

      const res = await request(app)
        .patch('/api/v1/tenant-portal/profile')
        .send({
          emergencyContact: { name: 'Hacker', phone: '0800000000', relationship: 'Friend' },
          roomNumber: '999',
          rentAmount: '100',
          monthlyRent: '100',
        });

      expect(res.status).toBe(200);
      // Ensure tenant.update was not called with emergencyContact, roomNumber, or rentAmount
      if (mockPrisma.tenant.update.mock.calls.length > 0) {
        const updateCallData = mockPrisma.tenant.update.mock.calls[0][0].data;
        expect(updateCallData.emergencyContact).toBeUndefined();
        expect(updateCallData.roomNumber).toBeUndefined();
        expect(updateCallData.rentAmount).toBeUndefined();
        expect(updateCallData.monthlyRent).toBeUndefined();
      }
    });
  });

  describe('3. /co-occupants (AC P1-3, P1-5, P1-6)', () => {
    it('adds co-occupant, returns 201, and notifies staff (P1-3)', async () => {
      mockBillingOrchestrationService.addTenantCoOccupant.mockResolvedValue({
        coOccupant: {
          id: 'co-123',
          name: 'นายสมศักดิ์ ผู้พักร่วม',
          phone: '0891234567',
          relationship: 'เพื่อน',
          createdAt: new Date('2026-09-24T10:00:00Z'),
        },
        peopleCount: 2,
        prevPeopleCount: 1,
        recalculation: null,
      });

      const res = await request(app)
        .post('/api/v1/tenant-portal/co-occupants')
        .send({
          name: 'นายสมศักดิ์ ผู้พักร่วม',
          phone: '0891234567',
          relationship: 'เพื่อน',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe('นายสมศักดิ์ ผู้พักร่วม');
      expect(mockBillingOrchestrationService.addTenantCoOccupant).toHaveBeenCalledWith(
        'dorm-1',
        'tenant-ta-id',
        expect.objectContaining({ name: 'นายสมศักดิ์ ผู้พักร่วม' }),
        expect.anything()
      );

      // Verify staff notification
      expect(mockNotificationService.createInAppNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          dormitoryId: 'dorm-1',
          targetType: 'staff',
          category: 'TENANT_CO_OCCUPANT_UPDATED',
          body: expect.stringContaining('เพิ่มผู้พักร่วม: นายสมศักดิ์ ผู้พักร่วม'),
        })
      );
    });

    it('rejects cross-tenant co-occupant addition with 403 Forbidden (P1-6)', async () => {
      const res = await request(app)
        .post('/api/v1/tenant-portal/co-occupants')
        .send({
          tenantId: 'tenant-tc-id', // Cross-tenant target
          name: 'นายผู้บุกรุก',
          phone: '0891234567',
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(mockBillingOrchestrationService.addTenantCoOccupant).not.toHaveBeenCalled();
    });

    it('rejects invalid phone number with 400 and validation error (P1-5)', async () => {
      const res = await request(app)
        .post('/api/v1/tenant-portal/co-occupants')
        .send({
          name: 'นายผิดเบอร์',
          phone: '12345', // Invalid phone
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.fieldErrors[0].message).toBe('เบอร์โทรศัพท์ต้องเป็นตัวเลข 9-10 หลัก (ขึ้นต้นด้วย 0)');
      expect(mockBillingOrchestrationService.addTenantCoOccupant).not.toHaveBeenCalled();
    });

    it('removes co-occupant, returns 200, and notifies staff (P1-3)', async () => {
      mockPrisma.tenantCoOccupant.findFirst.mockResolvedValue({
        id: 'co-123',
        tenantId: 'tenant-ta-id',
        dormitoryId: 'dorm-1',
        name: 'นายสมศักดิ์ ผู้พักร่วม',
      });

      mockBillingOrchestrationService.removeTenantCoOccupant.mockResolvedValue({
        removedId: 'co-123',
        peopleCount: 1,
        prevPeopleCount: 2,
        recalculation: null,
      });

      const res = await request(app).delete('/api/v1/tenant-portal/co-occupants/co-123');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockBillingOrchestrationService.removeTenantCoOccupant).toHaveBeenCalledWith(
        'dorm-1',
        'tenant-ta-id',
        'co-123',
        expect.anything()
      );

      // Verify staff notification
      expect(mockNotificationService.createInAppNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          dormitoryId: 'dorm-1',
          targetType: 'staff',
          category: 'TENANT_CO_OCCUPANT_UPDATED',
          body: expect.stringContaining('ลบผู้พักร่วม: นายสมศักดิ์ ผู้พักร่วม'),
        })
      );
    });

    it('rejects deleting co-occupant belonging to another tenant with 404 (P1-6)', async () => {
      // Co-occupant belongs to TC, not TA
      mockPrisma.tenantCoOccupant.findFirst.mockResolvedValue(null);

      const res = await request(app).delete('/api/v1/tenant-portal/co-occupants/co-belonging-to-tc');

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('CO_OCCUPANT_NOT_FOUND');
      expect(mockBillingOrchestrationService.removeTenantCoOccupant).not.toHaveBeenCalled();
    });
  });
});
