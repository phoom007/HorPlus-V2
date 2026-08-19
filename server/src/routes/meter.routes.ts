import { Router, Request, Response } from 'express';
import { AuthenticationService } from '../services/auth.service.js';
import { MeterService } from '../services/meter.service.js';
import { createRequireSessionMiddleware } from '../middleware/require-session.js';
import { requireDormitoryPermission } from '../middleware/permission.js';
import { requireDormitoryWriteEntitlement } from '../middleware/entitlement.js';
import { BillingService } from '../services/billing.service.js';
import { provisionalRentalTermService } from '../services/provisional-rental-term.service.js';
import {
  CreateMeterDeviceSchema,
  ReplaceMeterSchema,
  BulkMeterReadingSchema,
  UpdateMeterReadingSchema,
  UpdateCyclePeopleCountSchema,
  BulkSaveMeterWorkspaceSchema,
  ToggleRoomBillSwitchSchema,
  CreateProvisionalRentalTermSchema,
} from '../schemas/billing-meter.schemas.js';
import { billingOrchestrationService } from '../services/billing-orchestration.service.js';
import { getPrismaClient } from '../db/prisma.js';

export function createMeterRouter(
  authService: AuthenticationService,
  meterService: MeterService,
  billingService?: BillingService
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

  // PUT /api/v1/meters/cycle-people-count
  router.put('/cycle-people-count', mutationGuard('meter:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      const parsed = UpdateCyclePeopleCountSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'ข้อมูลจำนวนคนไม่ถูกต้อง',
            fieldErrors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const result = await billingOrchestrationService.correctMeterCyclePeopleCount(
        dormId,
        parsed.data.billingCycleId,
        parsed.data.roomId,
        parsed.data.peopleCount,
        req.auth?.userId
      );

      res.json({ success: true, data: result });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // GET /api/v1/meters/cycle-people-count
  router.get('/cycle-people-count', async (req: Request, res: Response) => {
    try {
      const dormId = getDormitoryId(req);
      const billingCycleId = req.query.billingCycleId as string;
      if (!billingCycleId) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Billing Cycle ID จำเป็นต้องระบุ',
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
          },
        });
      }

      const prisma = getPrismaClient();
      const snapshots = await prisma.roomBillingCycleSnapshot.findMany({
        where: {
          dormitoryId: dormId,
          billingCycleId,
        },
      });

      res.json({ data: snapshots });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // GET /api/v1/meters/workspace/pull-previous
  router.get('/workspace/pull-previous', async (req: Request, res: Response) => {
    try {
      const dormId = getDormitoryId(req);
      const billingCycleId = req.query.billingCycleId as string;
      if (!billingCycleId) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Billing Cycle ID จำเป็นต้องระบุ',
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
          },
        });
      }

      const result = await meterService.pullPreviousWorkspaceData(dormId, billingCycleId);
      res.json({ success: true, data: result });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // GET /api/v1/meters/workspace/household-counts
  router.get('/workspace/household-counts', async (req: Request, res: Response) => {
    try {
      const dormId = getDormitoryId(req);
      const billingCycleId = req.query.billingCycleId as string;
      if (!billingCycleId) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Billing Cycle ID จำเป็นต้องระบุ',
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
          },
        });
      }

      const result = await meterService.getHouseholdCountsByCycle(dormId, billingCycleId);
      res.json({ success: true, data: result });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // GET /api/v1/meters/workspace/preview-context
  router.get('/workspace/preview-context', async (req: Request, res: Response) => {
    try {
      const dormId = getDormitoryId(req);
      const billingCycleId = req.query.billingCycleId as string;
      if (!billingCycleId) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Billing Cycle ID จำเป็นต้องระบุ',
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
          },
        });
      }

      const result = await meterService.getMeterBillingPreviewContext(dormId, billingCycleId);
      res.json({ success: true, data: result });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // POST /api/v1/meters/workspace/bulk
  router.post('/workspace/bulk', mutationGuard('meter:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      const parsed = BulkSaveMeterWorkspaceSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'ข้อมูลตารางมิเตอร์ไม่ถูกต้อง',
            fieldErrors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const result = await meterService.saveBulkMeterWorkspace(dormId, parsed.data, req.auth?.userId);
      res.json({ success: true, savedCount: result.savedCount, savedRows: result.savedRows });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // POST /api/v1/meters/switch
  router.post('/switch', mutationGuard('meter:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      const parsed = ToggleRoomBillSwitchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'ข้อมูลการเปิดปิดสถานะบิลไม่ถูกต้อง',
            fieldErrors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const result = await meterService.toggleRoomBillSwitch(
        dormId,
        parsed.data,
        req.auth?.userId,
        billingService
      );
      res.json({ success: true, ...result });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // POST /api/v1/meters/provisional-terms
  router.post('/provisional-terms', mutationGuard('meter:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      const parsed = CreateProvisionalRentalTermSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'ข้อมูลการสร้างผู้เช่าชั่วคราวไม่ถูกต้อง',
            fieldErrors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const result = await provisionalRentalTermService.createProvisionalTenantAndTerm(
        dormId,
        parsed.data,
        req.auth?.userId
      );
      res.status(201).json({ success: true, data: result });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  return router;
}
