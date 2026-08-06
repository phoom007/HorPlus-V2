import { Router, Request, Response } from 'express';
import { AuthenticationService } from '../services/auth.service.js';
import { BuildingService } from '../services/building.service.js';
import { RoomService } from '../services/room.service.js';
import { createRequireSessionMiddleware } from '../middleware/require-session.js';
import { requireDormitoryPermission } from '../middleware/permission.js';
import { requireDormitoryWriteEntitlement } from '../middleware/entitlement.js';
import {
  CreateBuildingSchema,
  UpdateBuildingSchema,
  CreateRoomSchema,
  UpdateRoomSchema,
} from '../schemas/property-tenant-contract.schemas.js';

import { resolveAuthoritativeDormitoryContext } from '../middleware/dormitory-context.js';

export function createPropertyRouter(
  authService: AuthenticationService,
  buildingService: BuildingService,
  roomService: RoomService
): Router {
  const router = Router();
  const requireSession = createRequireSessionMiddleware(authService);

  const mutationGuard = (permission: string) => [
    requireDormitoryPermission(permission),
    requireDormitoryWriteEntitlement,
  ];

  const getDormitoryId = (req: Request): string => {
    const context = resolveAuthoritativeDormitoryContext(req);
    return context.dormitoryId;
  };

  const verifyCsrf = (req: Request, res: Response): boolean => {
    const csrfToken = (req.headers['x-csrf-token'] as string) || req.cookies?.['horplus_csrf'];
    const sessionId = req.auth?.sessionId;
    if (!sessionId || !authService.verifyCsrf(csrfToken, sessionId)) {
      res.status(403).json({
        error: {
          code: 'CSRF_INVALID',
          message: 'CSRF Token ไม่ถูกต้องหรือหมดอายุแล้ว',
          fieldErrors: null,
          requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
          timestamp: new Date().toISOString(),
        },
      });
      return false;
    }
    return true;
  };

  const handleServiceError = (res: Response, err: any, req: Request) => {
    console.error('PROPERTY SERVICE ERROR:', err);
    const statusCode = err.statusCode || err.status || 500;
    res.status(statusCode).json({
      error: {
        code: err.errorCode || err.code || 'PROPERTY_OPERATION_FAILED',
        message: err.message || 'Operation failed',
        fieldErrors: err.fieldErrors || null,
        requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
        timestamp: new Date().toISOString(),
      },
    });
  };

  // --- BUILDINGS ---

  // GET /api/v1/properties/buildings
  router.get('/buildings', async (req: Request, res: Response) => {
    try {
      const dormId = getDormitoryId(req);
      const query = {
        status: req.query.status as string,
        search: req.query.search as string,
        page: req.query.page ? Number(req.query.page) : 1,
        pageSize: req.query.pageSize ? Number(req.query.pageSize) : 20,
        sortBy: req.query.sortBy as string,
        sortDirection: req.query.sortDirection as 'asc' | 'desc',
      };
      const result = await buildingService.getBuildings(dormId, query);
      res.json({ data: result.items, pagination: { total: result.total, page: query.page, pageSize: query.pageSize } });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // GET /api/v1/properties/buildings/:id
  router.get('/buildings/:id', async (req: Request, res: Response) => {
    try {
      const dormId = getDormitoryId(req);
      const building = await buildingService.getBuildingById(req.params.id, dormId);
      res.json({ data: building });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // POST /api/v1/properties/buildings
  router.post('/buildings', mutationGuard('building:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      const parsed = CreateBuildingSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'ข้อมูลการสร้างอาคารไม่ถูกต้อง',
            fieldErrors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }
      const building = await buildingService.createBuilding(dormId, parsed.data, req.auth?.userId);
      res.status(201).json({ data: building });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // PUT /api/v1/properties/buildings/:id
  router.put('/buildings/:id', mutationGuard('building:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      const parsed = UpdateBuildingSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'ข้อมูลการแก้ไขอาคารไม่ถูกต้อง',
            fieldErrors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const building = await buildingService.updateBuilding(req.params.id, dormId, parsed.data, req.auth?.userId);
      res.json({ data: building });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // DELETE /api/v1/properties/buildings/:id
  router.delete('/buildings/:id', mutationGuard('building:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      const building = await buildingService.archiveBuilding(req.params.id, dormId, req.auth?.userId);
      res.json({ data: { success: true, message: 'เก็บข้อมูลอาคารเรียบร้อยแล้ว', building } });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // --- ROOMS ---

  // GET /api/v1/properties/rooms/available
  router.get('/rooms/available', async (req: Request, res: Response) => {
    try {
      const dormId = getDormitoryId(req);
      const { startDate, endDate, buildingId } = req.query;
      if (!startDate || !endDate) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'กรุณาระบุ startDate และ endDate',
            fieldErrors: null,
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const { availabilityService } = await import('../services/availability.service.js');
      const availableRooms = await availabilityService.getAvailableRooms({
        dormitoryId: dormId,
        startDate: startDate as string,
        endDate: endDate as string,
        buildingId: buildingId as string,
      });

      res.json({ data: availableRooms });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // GET /api/v1/properties/rooms
  router.get('/rooms', async (req: Request, res: Response) => {
    try {
      const dormId = getDormitoryId(req);
      const query = {
        buildingId: req.query.buildingId as string,
        floor: req.query.floor ? Number(req.query.floor) : undefined,
        status: req.query.status as string,
        roomType: req.query.roomType as string,
        search: req.query.search as string,
        page: req.query.page ? Number(req.query.page) : 1,
        pageSize: req.query.pageSize ? Number(req.query.pageSize) : 50,
        sortBy: req.query.sortBy as string,
        sortDirection: req.query.sortDirection as 'asc' | 'desc',
      };
      const result = await roomService.getRooms(dormId, query);
      res.json({ data: result.items, pagination: { total: result.total, page: query.page, pageSize: query.pageSize } });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // GET /api/v1/properties/rooms/:id/effective-defaults
  router.get('/rooms/:id/effective-defaults', async (req: Request, res: Response) => {
    try {
      const dormId = getDormitoryId(req);
      const room = await roomService.getRoomById(req.params.id, dormId);
      const { defaultsService } = await import('../services/defaults.service.js');
      const effective = await defaultsService.resolveEffectiveRoomDefaults(
        dormId,
        room.buildingId,
        req.params.id
      );
      res.json({ data: effective });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // GET /api/v1/properties/rooms/:id
  router.get('/rooms/:id', async (req: Request, res: Response) => {
    try {
      const dormId = getDormitoryId(req);
      const room = await roomService.getRoomById(req.params.id, dormId);
      res.json({ data: room });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // POST /api/v1/properties/rooms
  router.post('/rooms', mutationGuard('room:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      const parsed = CreateRoomSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'ข้อมูลการสร้างห้องพักไม่ถูกต้อง',
            fieldErrors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }
      const room = await roomService.createRoom(dormId, parsed.data as any, req.auth?.userId);
      res.status(201).json({ data: room });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // PUT /api/v1/properties/rooms/:id
  router.put('/rooms/:id', mutationGuard('room:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      const parsed = UpdateRoomSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'ข้อมูลการแก้ไขห้องพักไม่ถูกต้อง',
            fieldErrors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const { version, ...updatePayload } = parsed.data;
      const room = await roomService.updateRoom(req.params.id, updatePayload, dormId, req.auth?.userId);
      res.json({ data: room });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // DELETE /api/v1/properties/rooms/:id
  router.delete('/rooms/:id', mutationGuard('room:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      const room = await roomService.archiveRoom(req.params.id, dormId, req.auth?.userId);
      res.json({ data: { success: true, message: 'เก็บข้อมูลห้องพักเรียบร้อยแล้ว', room } });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // --- DORMITORY DEFAULTS & PROPAGATION ---

  // GET /api/v1/properties/dormitory/defaults
  router.get('/dormitory/defaults', async (req: Request, res: Response) => {
    try {
      const dormId = getDormitoryId(req);
      const { getPrismaClient } = await import('../db/prisma.js');
      const prisma = getPrismaClient();

      const billing = await prisma.dormitoryBillingSettings.findUnique({ where: { dormitoryId: dormId } });
      const property = await prisma.dormitoryPropertyDefaults.findUnique({ where: { dormitoryId: dormId } });

      res.json({ data: { billing, property } });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // PUT /api/v1/properties/dormitory/defaults
  router.put('/dormitory/defaults', mutationGuard('settings:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      const { getPrismaClient } = await import('../db/prisma.js');
      const prisma = getPrismaClient();

      const { billing, property, expectedVersion } = req.body;

      const result = await prisma.$transaction(async (tx: any) => {
        let updatedProperty = null;
        let updatedBilling = null;

        if (property) {
          const currentProp = await tx.dormitoryPropertyDefaults.findUnique({ where: { dormitoryId: dormId } });
          if (expectedVersion !== undefined && currentProp && currentProp.version !== expectedVersion) {
            const err: any = new Error('ข้อมูลถูกแก้ไขโดยผู้อื่น กรุณาโหลดข้อมูลใหม่');
            err.code = 'VERSION_CONFLICT';
            err.statusCode = 409;
            throw err;
          }

          updatedProperty = await tx.dormitoryPropertyDefaults.upsert({
            where: { dormitoryId: dormId },
            create: { dormitoryId: dormId, ...property },
            update: { ...property, version: { increment: 1 } },
          });
        }

        if (billing) {
          updatedBilling = await tx.dormitoryBillingSettings.upsert({
            where: { dormitoryId: dormId },
            create: { dormitoryId: dormId, ...billing },
            update: { ...billing, version: { increment: 1 } },
          });
        }

        return { billing: updatedBilling, property: updatedProperty };
      });

      res.json({ data: result });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // POST /api/v1/properties/defaults/preview
  router.post('/defaults/preview', async (req: Request, res: Response) => {
    try {
      const dormId = getDormitoryId(req);
      const { scope, scopeId } = req.body;
      const { defaultsService } = await import('../services/defaults.service.js');

      const preview = await defaultsService.previewDefaultPropagation(
        dormId,
        scope || 'DORMITORY',
        scopeId
      );

      res.json({ data: preview });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // POST /api/v1/properties/defaults/apply
  router.post('/defaults/apply', mutationGuard('settings:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      const { scope, scopeId, changes, idempotencyKey } = req.body;

      if (!idempotencyKey) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'ต้องระบุ idempotencyKey สำหรับการปรับปรุงข้อมูลแบบกลุ่ม',
            fieldErrors: null,
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const { defaultsService } = await import('../services/defaults.service.js');
      const result = await defaultsService.applyDefaultPropagation(
        dormId,
        scope || 'DORMITORY',
        scopeId,
        changes || {},
        idempotencyKey,
        req.auth?.userId || 'unknown-user'
      );

      res.json({ data: result });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // GET /api/v1/properties/contracts/:id/snapshot
  router.get('/contracts/:id/snapshot', async (req: Request, res: Response) => {
    try {
      const dormId = getDormitoryId(req);
      const { getPrismaClient } = await import('../db/prisma.js');
      const prisma = getPrismaClient();

      const snapshot = await prisma.contractSnapshot.findFirst({
        where: { contractId: req.params.id, dormitoryId: dormId },
      });

      if (!snapshot) {
        return res.status(404).json({
          error: {
            code: 'SNAPSHOT_NOT_FOUND',
            message: 'ไม่พบข้อมูล Snapshot ของสัญญาที่ระบุ',
            fieldErrors: null,
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }

      res.json({ data: snapshot });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // GET /api/v1/properties/buildings/:id/defaults
  router.get('/buildings/:id/defaults', async (req: Request, res: Response) => {
    try {
      const dormId = getDormitoryId(req);
      const building = await buildingService.getBuildingById(req.params.id, dormId);
      res.json({
        data: {
          buildingId: building.id,
          name: (building as any).name,
          overrides: {
            monthlyRent: (building as any).monthlyRent,
            termRent: (building as any).termRent,
            dailyRent: (building as any).dailyRent,
            depositAmount: (building as any).depositAmount,
            advancePaymentAmount: (building as any).advancePaymentAmount,
            waterRate: (building as any).waterRate,
            electricityRate: (building as any).electricityRate,
            commonFee: (building as any).commonFee,
            internetFee: (building as any).internetFee,
            parkingFee: (building as any).parkingFee,
            waterBillingType: (building as any).waterBillingType,
            electricityBillingType: (building as any).electricityBillingType,
            rentBillingType: (building as any).rentBillingType,
            maximumOccupants: (building as any).maximumOccupants,
            roomType: (building as any).roomType,
          },
          version: (building as any).version || 1,
          updatedAt: (building as any).updatedAt,
        },
      });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // PUT /api/v1/properties/buildings/:id/defaults
  router.put('/buildings/:id/defaults', mutationGuard('building:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      const updated = await buildingService.updateBuilding(req.params.id, dormId, req.body, req.auth?.userId);
      if (!updated) {
        return res.status(404).json({ error: { code: 'BUILDING_NOT_FOUND', message: 'ไม่พบข้อมูลอาคาร' } });
      }
      res.json({
        data: {
          buildingId: updated.id,
          effectiveValues: updated,
          version: (updated as any).version,
          updatedAt: (updated as any).updatedAt,
        },
      });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // DELETE /api/v1/properties/buildings/:id/defaults/:field
  router.delete('/buildings/:id/defaults/:field', mutationGuard('building:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      const fieldName = req.params.field;
      const clearPayload: Record<string, null> = {};
      clearPayload[fieldName] = null;
      const updated = await buildingService.updateBuilding(req.params.id, dormId, clearPayload as any, req.auth?.userId);
      if (!updated) {
        return res.status(404).json({ error: { code: 'BUILDING_NOT_FOUND', message: 'ไม่พบข้อมูลอาคาร' } });
      }
      res.json({
        data: {
          success: true,
          clearedField: fieldName,
          buildingId: updated.id,
          version: (updated as any).version,
          updatedAt: (updated as any).updatedAt,
        },
      });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // PUT /api/v1/properties/rooms/:id/defaults
  router.put('/rooms/:id/defaults', mutationGuard('room:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      const updated = await roomService.updateRoom(req.params.id, req.body, dormId, req.auth?.userId);
      if (!updated) {
        return res.status(404).json({ error: { code: 'ROOM_NOT_FOUND', message: 'ไม่พบข้อมูลห้องพัก' } });
      }
      res.json({
        data: {
          roomId: updated.id,
          effectiveValues: updated,
          version: (updated as any).version,
          updatedAt: (updated as any).updatedAt,
        },
      });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // DELETE /api/v1/properties/rooms/:id/defaults/:field
  router.delete('/rooms/:id/defaults/:field', mutationGuard('room:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      const fieldName = req.params.field;
      const clearPayload: Record<string, null> = {};
      clearPayload[fieldName] = null;
      const updated = await roomService.updateRoom(req.params.id, clearPayload, dormId, req.auth?.userId);
      if (!updated) {
        return res.status(404).json({ error: { code: 'ROOM_NOT_FOUND', message: 'ไม่พบข้อมูลห้องพัก' } });
      }
      res.json({
        data: {
          success: true,
          clearedField: fieldName,
          roomId: updated.id,
          version: (updated as any).version,
          updatedAt: (updated as any).updatedAt,
        },
      });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  return router;
}
