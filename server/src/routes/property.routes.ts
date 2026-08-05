import { Router, Request, Response } from 'express';
import { AuthenticationService } from '../services/auth.service.js';
import { BuildingService } from '../services/building.service.js';
import { RoomService } from '../services/room.service.js';
import { createRequireSessionMiddleware } from '../middleware/require-session.js';
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
  router.get('/buildings', requireSession, async (req: Request, res: Response) => {
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
  router.get('/buildings/:id', requireSession, async (req: Request, res: Response) => {
    try {
      const dormId = getDormitoryId(req);
      const building = await buildingService.getBuildingById(req.params.id, dormId);
      res.json({ data: building });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // POST /api/v1/properties/buildings
  router.post('/buildings', requireSession, async (req: Request, res: Response) => {
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
  router.put('/buildings/:id', requireSession, async (req: Request, res: Response) => {
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
  router.delete('/buildings/:id', requireSession, async (req: Request, res: Response) => {
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
  router.get('/rooms/available', requireSession, async (req: Request, res: Response) => {
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

      const availableRooms = await roomService.getAvailableRooms(
        dormId,
        startDate as string,
        endDate as string,
        buildingId as string
      );
      res.json({ data: availableRooms });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // GET /api/v1/properties/rooms
  router.get('/rooms', requireSession, async (req: Request, res: Response) => {
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

  // GET /api/v1/properties/rooms/:id
  router.get('/rooms/:id', requireSession, async (req: Request, res: Response) => {
    try {
      const dormId = getDormitoryId(req);
      const room = await roomService.getRoomById(req.params.id, dormId);
      res.json({ data: room });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // POST /api/v1/properties/rooms
  router.post('/rooms', requireSession, async (req: Request, res: Response) => {
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
  router.put('/rooms/:id', requireSession, async (req: Request, res: Response) => {
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
  router.delete('/rooms/:id', requireSession, async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      const room = await roomService.archiveRoom(req.params.id, dormId, req.auth?.userId);
      res.json({ data: { success: true, message: 'เก็บข้อมูลห้องพักเรียบร้อยแล้ว', room } });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  return router;
}
