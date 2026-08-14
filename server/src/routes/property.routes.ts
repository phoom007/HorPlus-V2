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
import { AppError } from '../types/index.js';

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
    const context = (req as any).dormitoryContext;
    if (context?.dormitoryId) {
      return context.dormitoryId;
    }
    if ((req as any).auth?.dormitoryId) {
      return (req as any).auth.dormitoryId;
    }
    throw new AppError('Dormitory context not resolved.', 403, 'FORBIDDEN');
  };

  const verifyCsrf = (req: Request, res: Response): boolean => {
    const csrfHeader = req.headers['x-csrf-token'] as string | undefined;
    const csrfCookie = req.cookies?.['horplus_csrf'];
    const sessionId = req.auth?.sessionId;

    if (!csrfHeader || !sessionId || !authService.verifyCsrf(csrfHeader, sessionId) || (csrfCookie && csrfCookie !== csrfHeader)) {
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
    let statusCode = err.statusCode || err.status || 500;
    let errorCode = err.errorCode || err.code || 'PROPERTY_OPERATION_FAILED';
    let message = err.message || 'Operation failed';

    if (err.code === 'P2023' || (err.message && (err.message.includes('Malformed UUID') || err.message.includes('invalid input syntax for type uuid')))) {
      statusCode = 400;
      errorCode = 'INVALID_ID_FORMAT';
      message = 'รหัสระบุตัวตน (ID) ไม่ถูกต้องตามรูปแบบ UUID';
    }

    res.status(statusCode).json({
      error: {
        code: errorCode,
        message,
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
      const { defaultsService } = await import('../services/defaults.service.js');
      const enrichedItems = await Promise.all(
        result.items.map((b) => defaultsService.buildAuthoritativeBuildingResponse(dormId, b))
      );
      res.json({ data: enrichedItems, pagination: { total: result.total, page: query.page, pageSize: query.pageSize } });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // GET /api/v1/properties/buildings/:id
  router.get('/buildings/:id', async (req: Request, res: Response) => {
    try {
      const dormId = getDormitoryId(req);
      const building = await buildingService.getBuildingById(req.params.id, dormId);
      const { defaultsService } = await import('../services/defaults.service.js');
      const enriched = await defaultsService.buildAuthoritativeBuildingResponse(dormId, building);
      res.json({ data: enriched });
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

      const { expectedVersion, ...changes } = parsed.data;
      const building = await buildingService.updateBuilding({
        buildingId: req.params.id,
        dormitoryId: dormId,
        changes,
        expectedVersion,
        actorUserId: req.auth?.userId,
        requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
      });
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
      const { ArchiveBuildingSchema } = await import('../schemas/property-tenant-contract.schemas.js');
      const parsed = ArchiveBuildingSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'ต้องระบุ expectedVersion สำหรับการจัดเก็บอาคาร',
            fieldErrors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const building = await buildingService.archiveBuilding({
        buildingId: req.params.id,
        dormitoryId: dormId,
        expectedVersion: parsed.data.expectedVersion,
        actorUserId: req.auth?.userId,
        requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
      });
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
      const { defaultsService } = await import('../services/defaults.service.js');
      const enrichedItems = await Promise.all(
        result.items.map((room) => defaultsService.buildAuthoritativeRoomResponse(dormId, room))
      );
      res.json({ data: enrichedItems, pagination: { total: result.total, page: query.page, pageSize: query.pageSize } });
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
      const { defaultsService } = await import('../services/defaults.service.js');
      const enriched = await defaultsService.buildAuthoritativeRoomResponse(dormId, room);
      res.json({ data: enriched });
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

      const { expectedVersion, ...changes } = parsed.data;
      const room = await roomService.updateRoom({
        roomId: req.params.id,
        dormitoryId: dormId,
        changes,
        expectedVersion,
        actorUserId: req.auth?.userId,
        requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
      });
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
      const { ArchiveRoomSchema } = await import('../schemas/property-tenant-contract.schemas.js');
      const parsed = ArchiveRoomSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'ต้องระบุ expectedVersion สำหรับการจัดเก็บห้องพัก',
            fieldErrors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const room = await roomService.archiveRoom({
        roomId: req.params.id,
        dormitoryId: dormId,
        expectedVersion: parsed.data.expectedVersion,
        actorUserId: req.auth?.userId,
        requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
      });
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
      const { UpdateDormitoryDefaultsRequestSchema } = await import('../schemas/property-tenant-contract.schemas.js');
      const parsed = UpdateDormitoryDefaultsRequestSchema.safeParse(req.body);

      if (!parsed.success) {
        const hasUnrecognized = parsed.error.issues.some((i: any) => i.code === 'unrecognized_keys');
        const code = hasUnrecognized ? 'DEFAULT_FIELD_NOT_ALLOWED' : 'VALIDATION_ERROR';
        const message = hasUnrecognized
          ? 'มีฟิลด์ที่ไม่ได้รับอนุญาตในการตั้งค่าหอพัก'
          : 'ข้อมูลการตั้งค่าหอพักไม่ถูกต้อง';
        return res.status(400).json({
          error: {
            code,
            message,
            fieldErrors: parsed.error.flatten().fieldErrors,
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const { defaultsService } = await import('../services/defaults.service.js');
      const result = await defaultsService.updateDormitoryDefaults(
        dormId,
        parsed.data,
        req.auth?.userId || 'unknown-user',
        (req.headers['x-request-id'] as string) || undefined
      );

      res.json({ data: result });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // POST /api/v1/properties/defaults/preview
  router.post('/defaults/preview', async (req: Request, res: Response) => {
    try {
      const dormId = getDormitoryId(req);
      const { DefaultPropagationPreviewSchema } = await import('../schemas/property-tenant-contract.schemas.js');
      const parsed = DefaultPropagationPreviewSchema.safeParse(req.body);

      if (!parsed.success) {
        const hasUnrecognized = parsed.error.issues.some((i: any) => i.code === 'unrecognized_keys');
        const code = hasUnrecognized ? 'DEFAULT_FIELD_NOT_ALLOWED' : 'VALIDATION_ERROR';
        const message = hasUnrecognized
          ? 'ฟิลด์ข้อมูลการพรีวิวไม่ถูกต้องหรือมีฟิลด์ที่ไม่ได้รับอนุญาต'
          : 'ข้อมูลการแสดงตัวอย่างไม่ถูกต้อง';
        return res.status(400).json({
          error: {
            code,
            message,
            fieldErrors: parsed.error.flatten().fieldErrors,
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const { defaultsService } = await import('../services/defaults.service.js');
      const preview = await defaultsService.previewDefaultPropagation(dormId, parsed.data);

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
      const { DefaultPropagationApplySchema } = await import('../schemas/property-tenant-contract.schemas.js');
      const parsed = DefaultPropagationApplySchema.safeParse(req.body);

      if (!parsed.success) {
        const hasUnrecognized = parsed.error.issues.some((i: any) => i.code === 'unrecognized_keys');
        const code = hasUnrecognized ? 'DEFAULT_FIELD_NOT_ALLOWED' : 'VALIDATION_ERROR';
        const message = hasUnrecognized
          ? 'ข้อมูลการปรับปรุงข้อมูลแบบกลุ่มไม่ถูกต้องหรือมีฟิลด์ที่ไม่ได้รับอนุญาต'
          : 'ข้อมูลการส่งต่อค่าไม่ถูกต้อง';
        return res.status(400).json({
          error: {
            code,
            message,
            fieldErrors: parsed.error.flatten().fieldErrors,
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const { defaultsService } = await import('../services/defaults.service.js');
      const result = await defaultsService.applyDefaultPropagation(
        dormId,
        parsed.data,
        req.auth?.userId || 'unknown-user',
        (req.headers['x-request-id'] as string) || undefined
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

      const formattedSnapshot = {
        contractId: snapshot.contractId,
        snapshotId: snapshot.id,
        roomId: snapshot.roomId,
        buildingId: snapshot.buildingId,
        tenantId: snapshot.tenantId,
        exactRoomNumber: snapshot.exactRoomNumber,
        resolvedRent: String(snapshot.resolvedRent),
        resolvedDeposit: String(snapshot.resolvedDeposit),
        resolvedAdvancePayment: String(snapshot.resolvedAdvancePayment),
        resolvedWaterRate: String(snapshot.resolvedWaterRate),
        resolvedElectricityRate: String(snapshot.resolvedElectricityRate),
        resolvedCommonFee: String(snapshot.resolvedCommonFee),
        resolvedInternetFee: String(snapshot.resolvedInternetFee),
        resolvedParkingFee: String(snapshot.resolvedParkingFee),
        waterBillingType: snapshot.waterBillingType,
        electricityBillingType: snapshot.electricityBillingType,
        rentBillingType: snapshot.rentBillingType,
        sourceVersions: snapshot.sourceVersions,
        snapshotLockedAt: snapshot.lockedAt,
        lockedByUserId: snapshot.lockedByUserId,
        snapshotData: snapshot.snapshotData,
      };

      res.json({ data: formattedSnapshot });
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
      const { UpdateBuildingDefaultsSchema } = await import('../schemas/property-tenant-contract.schemas.js');
      const parsed = UpdateBuildingDefaultsSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'DEFAULT_FIELD_NOT_ALLOWED',
            message: 'ฟิลด์ข้อมูลการตั้งค่าอาคารไม่ถูกต้องหรือมีฟิลด์ที่ไม่ได้รับอนุญาต',
            fieldErrors: parsed.error.flatten().fieldErrors,
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const { expectedVersion, ...changes } = parsed.data;
      const updated = await buildingService.updateBuilding({
        buildingId: req.params.id,
        dormitoryId: dormId,
        changes,
        expectedVersion,
        actorUserId: req.auth?.userId,
        requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
      });
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
      const expectedVersion = req.body?.expectedVersion;
      if (!expectedVersion || typeof expectedVersion !== 'number') {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'ต้องระบุ expectedVersion สำหรับการล้างค่าคอนฟิก',
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const { validateClearOverrideField } = await import('../schemas/property-tenant-contract.schemas.js');
      if (!validateClearOverrideField(fieldName)) {
        return res.status(400).json({
          error: {
            code: 'DEFAULT_FIELD_NOT_ALLOWED',
            message: `ฟิลด์ "${fieldName}" ไม่ได้รับอนุญาตให้ล้างค่าหรือแก้ไข`,
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const clearChanges: Record<string, any> = {};
      clearChanges[fieldName] = null;
      const updated = await buildingService.updateBuilding({
        buildingId: req.params.id,
        dormitoryId: dormId,
        changes: clearChanges,
        expectedVersion,
        actorUserId: req.auth?.userId,
        requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
      });
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
      const { UpdateRoomDefaultsSchema } = await import('../schemas/property-tenant-contract.schemas.js');
      const parsed = UpdateRoomDefaultsSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'DEFAULT_FIELD_NOT_ALLOWED',
            message: 'ฟิลด์ข้อมูลการตั้งค่าห้องพักไม่ถูกต้องหรือมีฟิลด์ที่ไม่ได้รับอนุญาต',
            fieldErrors: parsed.error.flatten().fieldErrors,
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const { expectedVersion, ...changes } = parsed.data;
      const updated = await roomService.updateRoom({
        roomId: req.params.id,
        dormitoryId: dormId,
        changes,
        expectedVersion,
        actorUserId: req.auth?.userId,
        requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
      });
      if (!updated) {
        return res.status(404).json({ error: { code: 'ROOM_NOT_FOUND', message: 'ไม่พบข้อมูลห้องพัก' } });
      }
      const { defaultsService } = await import('../services/defaults.service.js');
      const effective = await defaultsService.resolveEffectiveRoomDefaults(dormId, updated.buildingId, updated.id);
      res.json({
        data: {
          roomId: updated.id,
          effectiveValues: effective,
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
      const expectedVersion = req.body?.expectedVersion;
      if (!expectedVersion || typeof expectedVersion !== 'number') {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'ต้องระบุ expectedVersion สำหรับการล้างค่าคอนฟิก',
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const { validateClearOverrideField } = await import('../schemas/property-tenant-contract.schemas.js');
      if (!validateClearOverrideField(fieldName)) {
        return res.status(400).json({
          error: {
            code: 'DEFAULT_FIELD_NOT_ALLOWED',
            message: `ฟิลด์ "${fieldName}" ไม่ได้รับอนุญาตให้ล้างค่าหรือแก้ไข`,
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const clearChanges: Record<string, any> = {};
      clearChanges[fieldName] = null;
      const updated = await roomService.updateRoom({
        roomId: req.params.id,
        dormitoryId: dormId,
        changes: clearChanges,
        expectedVersion,
        actorUserId: req.auth?.userId,
        requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
      });
      if (!updated) {
        return res.status(404).json({ error: { code: 'ROOM_NOT_FOUND', message: 'ไม่พบข้อมูลห้องพัก' } });
      }
      const { defaultsService } = await import('../services/defaults.service.js');
      const effective = await defaultsService.resolveEffectiveRoomDefaults(dormId, updated.buildingId, updated.id);
      res.json({
        data: {
          success: true,
          clearedField: fieldName,
          roomId: updated.id,
          effectiveValues: effective,
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
