import { Router, Request, Response } from 'express';
import { AuthenticationService } from '../services/auth.service.js';
import { MeterService } from '../services/meter.service.js';
import { createRequireSessionMiddleware } from '../middleware/require-session.js';
import { requireDormitoryPermission } from '../middleware/permission.js';
import { requireDormitoryWriteEntitlement } from '../middleware/entitlement.js';
import {
  CreateMeterDeviceSchema,
  ReplaceMeterSchema,
  BulkMeterReadingSchema,
  UpdateMeterReadingSchema,
} from '../schemas/billing-meter.schemas.js';

export function createMeterRouter(
  authService: AuthenticationService,
  meterService: MeterService
): Router {
  const router = Router();
  const requireSession = createRequireSessionMiddleware(authService);

  const mutationGuard = (permission: string) => [
    requireDormitoryPermission(permission),
    requireDormitoryWriteEntitlement,
  ];

  const getDormitoryId = (req: Request): string => {
    return (req.headers['x-dormitory-id'] as string) || req.auth?.dormitoryId || 'dorm-001';
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
    console.error('METER SERVICE ERROR:', err);
    const statusCode = err.statusCode || err.status || 500;
    res.status(statusCode).json({
      error: {
        code: err.code || 'METER_OPERATION_FAILED',
        message: err.message || 'เกิดข้อผิดพลาดในการจัดการมิเตอร์และค่าน้ำค่าไฟ',
        fieldErrors: err.fieldErrors || null,
        requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
        timestamp: new Date().toISOString(),
      },
    });
  };

  // POST /api/v1/meters/devices
  router.post('/devices', mutationGuard('meter:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      const parsed = CreateMeterDeviceSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'ข้อมูลมิเตอร์ไม่ถูกต้อง',
            fieldErrors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }
      const device = await meterService.createMeterDevice(dormId, parsed.data, req.auth?.userId);
      res.status(201).json({ data: device });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // GET /api/v1/meters/devices/room/:roomId
  router.get('/devices/room/:roomId', async (req: Request, res: Response) => {
    try {
      const dormId = getDormitoryId(req);
      const devices = await meterService.getMeterDevicesByRoom(dormId, req.params.roomId);
      res.json({ data: devices });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // POST /api/v1/meters/replace
  router.post('/replace', mutationGuard('meter:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      const parsed = ReplaceMeterSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'ข้อมูลการเปลี่ยนมิเตอร์ไม่ถูกต้อง',
            fieldErrors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }
      const result = await meterService.replaceMeterDevice(dormId, parsed.data, req.auth?.userId);
      res.json({ data: result });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // POST /api/v1/meters/readings/bulk
  router.post('/readings/bulk', mutationGuard('meter:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      const parsed = BulkMeterReadingSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'ข้อมูลบันทึกมิเตอร์ไม่ถูกต้อง',
            fieldErrors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }
      const readings = await meterService.submitBulkReadings(dormId, parsed.data, req.auth?.userId);
      res.json({ data: readings, count: readings.length });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // GET /api/v1/meters/readings
  router.get('/readings', async (req: Request, res: Response) => {
    try {
      const dormId = getDormitoryId(req);
      const query = {
        billingCycleId: req.query.billingCycleId as string,
        roomId: req.query.roomId as string,
        meterType: req.query.meterType as string,
        status: req.query.status as string,
        page: req.query.page ? Number(req.query.page) : 1,
        pageSize: req.query.pageSize ? Number(req.query.pageSize) : 50,
      };
      const result = await meterService.getMeterReadings(dormId, query);
      res.json({
        data: result.items,
        pagination: { total: result.total, page: query.page, pageSize: query.pageSize },
      });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // PUT /api/v1/meters/readings/:id
  router.put('/readings/:id', mutationGuard('meter:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      const parsed = UpdateMeterReadingSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'ข้อมูลการแก้ไขค่ามิเตอร์ไม่ถูกต้อง',
            fieldErrors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const reading = await meterService.updateMeterReading(
        req.params.id,
        dormId,
        parsed.data.currentReading,
        parsed.data.notes,
        parsed.data.version,
        req.auth?.userId
      );
      res.json({ data: reading });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  return router;
}
