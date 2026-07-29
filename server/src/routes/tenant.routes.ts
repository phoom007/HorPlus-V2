import { Router, Request, Response } from 'express';
import { AuthenticationService } from '../services/auth.service.js';
import { TenantService } from '../services/tenant.service.js';
import { createRequireSessionMiddleware } from '../middleware/require-session.js';
import {
  CreateTenantSchema,
  UpdateTenantSchema,
  CreateCoOccupantSchema,
  CreateEmergencyContactSchema,
  CreateVehicleSchema,
} from '../schemas/property-tenant-contract.schemas.js';

export function createTenantRouter(
  authService: AuthenticationService,
  tenantService: TenantService
): Router {
  const router = Router();
  const requireSession = createRequireSessionMiddleware(authService);

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
    const statusCode = err.statusCode || err.status || 500;
    res.status(statusCode).json({
      error: {
        code: err.code || 'TENANT_OPERATION_FAILED',
        message: err.message || 'เกิดข้อผิดพลาดในการดำเนินการจัดการข้อมูลผู้เช่า',
        fieldErrors: err.fieldErrors || null,
        requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
        timestamp: new Date().toISOString(),
      },
    });
  };

  // GET /api/v1/tenants
  router.get('/', requireSession, async (req: Request, res: Response) => {
    try {
      const dormId = getDormitoryId(req);
      const query = {
        status: req.query.status as string,
        roomId: req.query.roomId as string,
        search: req.query.search as string,
        page: req.query.page ? Number(req.query.page) : 1,
        pageSize: req.query.pageSize ? Number(req.query.pageSize) : 20,
        sortBy: req.query.sortBy as string,
        sortDirection: req.query.sortDirection as 'asc' | 'desc',
      };
      const result = await tenantService.getTenants(dormId, query);
      res.json({ data: result.items, pagination: { total: result.total, page: query.page, pageSize: query.pageSize } });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // GET /api/v1/tenants/:id
  router.get('/:id', requireSession, async (req: Request, res: Response) => {
    try {
      const dormId = getDormitoryId(req);
      const tenantDetails = await tenantService.getTenantDetails(req.params.id, dormId);
      res.json({ data: tenantDetails });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // POST /api/v1/tenants
  router.post('/', requireSession, async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      const parsed = CreateTenantSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'ข้อมูลผู้เช่าไม่ถูกต้อง',
            fieldErrors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const tenant = await tenantService.createTenant(dormId, parsed.data, req.auth?.userId);
      res.status(201).json({ data: tenant });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // PUT /api/v1/tenants/:id
  router.put('/:id', requireSession, async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      const parsed = UpdateTenantSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'ข้อมูลผู้เช่าไม่ถูกต้อง',
            fieldErrors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const tenant = await tenantService.updateTenant(req.params.id, dormId, parsed.data, req.auth?.userId);
      res.json({ data: tenant });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // DELETE /api/v1/tenants/:id
  router.delete('/:id', requireSession, async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      const tenant = await tenantService.archiveTenant(req.params.id, dormId, req.auth?.userId);
      res.json({ data: { success: true, message: 'เก็บข้อมูลผู้เช่าเรียบร้อยแล้ว', tenant } });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // POST /api/v1/tenants/:id/co-occupants
  router.post('/:id/co-occupants', requireSession, async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      const parsed = CreateCoOccupantSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'ข้อมูลผู้พักร่วมไม่ถูกต้อง',
            fieldErrors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const coOccupant = await tenantService.addCoOccupant(dormId, req.params.id, parsed.data);
      res.status(201).json({ data: coOccupant });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // POST /api/v1/tenants/:id/emergency-contacts
  router.post('/:id/emergency-contacts', requireSession, async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      const parsed = CreateEmergencyContactSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'ข้อมูลผู้ติดต่อฉุกเฉินไม่ถูกต้อง',
            fieldErrors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const contact = await tenantService.addEmergencyContact(dormId, req.params.id, parsed.data);
      res.status(201).json({ data: contact });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // POST /api/v1/tenants/:id/vehicles
  router.post('/:id/vehicles', requireSession, async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      const parsed = CreateVehicleSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'ข้อมูลยานพาหนะไม่ถูกต้อง',
            fieldErrors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const vehicle = await tenantService.addVehicle(dormId, req.params.id, parsed.data);
      res.status(201).json({ data: vehicle });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  return router;
}
