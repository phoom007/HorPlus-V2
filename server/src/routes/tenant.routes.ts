import { Router, Request, Response } from 'express';
import multer from 'multer';
import { AuthenticationService } from '../services/auth.service.js';
import { TenantService } from '../services/tenant.service.js';
import { createRequireSessionMiddleware } from '../middleware/require-session.js';
import { requireDormitoryPermission } from '../middleware/permission.js';
import { requireDormitoryWriteEntitlement } from '../middleware/entitlement.js';
import { LocalStorageProvider } from '../services/local-storage.service.js';
import {
  CreateTenantSchema,
  UpdateTenantSchema,
  CreateCoOccupantSchema,
  CreateEmergencyContactSchema,
  UpdateEmergencyContactSchema,
  CreateVehicleSchema,
  UpdateVehicleSchema,
} from '../schemas/property-tenant-contract.schemas.js';
import { billingOrchestrationService } from '../services/billing-orchestration.service.js';
import {
  toTenantApiDTO,
  toCoOccupantApiDTO,
  toTenantDetailsApiDTO,
  toEmergencyContactApiDTO,
  toVehicleApiDTO,
} from '../mappers/tenant-api.mapper.js';

export function createTenantRouter(
  authService: AuthenticationService,
  tenantService: TenantService
): Router {
  const router = Router();
  const requireSession = createRequireSessionMiddleware(authService);

  const uploadSingle = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 5 * 1024 * 1024,
      files: 1,
    },
  }).single('file');

  const handleUploadSingle = (req: Request, res: Response, next: any) => {
    uploadSingle(req, res, (err: any) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            error: {
              code: 'FILE_TOO_LARGE',
              message: 'ขนาดไฟล์เกินขีดจำกัดที่กำหนด (สูงสุด 5MB)',
              fieldErrors: null,
              requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
              timestamp: new Date().toISOString(),
            },
          });
        }
        if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
          return res.status(400).json({
            error: {
              code: 'INVALID_FILE_FIELD',
              message: 'ต้องระบุไฟล์เพียงไฟล์เดียวในฟิลด์ "file"',
              fieldErrors: null,
              requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
              timestamp: new Date().toISOString(),
            },
          });
        }
        return res.status(400).json({
          error: {
            code: 'UPLOAD_ERROR',
            message: 'การอัปโหลดไฟล์ไม่ถูกต้อง: ' + err.message,
            fieldErrors: null,
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }
      return res.status(400).json({
        error: {
          code: 'UPLOAD_ERROR',
          message: err.message || 'การอัปโหลดไฟล์ล้มเหลว',
          fieldErrors: null,
          requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
          timestamp: new Date().toISOString(),
        },
      });
    });
  };

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
  router.get('/', async (req: Request, res: Response) => {
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
      res.json({ data: result.items.map(toTenantApiDTO), pagination: { total: result.total, page: query.page, pageSize: query.pageSize } });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  const localStorageProvider = new LocalStorageProvider();

  // GET /api/v1/tenants/:id
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const dormId = getDormitoryId(req);
      const tenantDetails = await tenantService.getTenantDetails(req.params.id, dormId);
      res.json({ data: toTenantDetailsApiDTO(tenantDetails) });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // GET /api/v1/tenants/:id/identity-document
  router.get(
    '/:id/identity-document',
    requireSession,
    requireDormitoryPermission('tenant:document:read'),
    async (req: Request, res: Response) => {
      try {
        const dormId = getDormitoryId(req);
        const tenant = await tenantService.getTenantById(req.params.id, dormId);
        if (!tenant || tenant.dormitoryId !== dormId) {
          return res.status(404).json({
            error: {
              code: 'TENANT_NOT_FOUND',
              message: 'ไม่พบข้อมูลผู้เช่า',
              requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
              timestamp: new Date().toISOString(),
            },
          });
        }

        if (!tenant.idCardObjectKey) {
          return res.status(404).json({
            error: {
              code: 'IDENTITY_DOCUMENT_NOT_FOUND',
              message: 'ผู้เช่ารายนี้ยังไม่ได้อัปโหลดเอกสารสำเนาบัตรประชาชน',
              requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
              timestamp: new Date().toISOString(),
            },
          });
        }

        const fileBuffer = await localStorageProvider.getFile(tenant.idCardObjectKey);
        res.setHeader('Content-Type', tenant.idCardMimeType || 'image/webp');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Content-Disposition', 'inline; filename="tenant-id-document.webp"');

        return res.send(fileBuffer);
      } catch (err: any) {
        if (err?.code === 'FILE_NOT_FOUND' || err?.message?.includes('not found')) {
          return res.status(404).json({
            error: {
              code: 'IDENTITY_DOCUMENT_NOT_FOUND',
              message: 'ไม่พบไฟล์เอกสารสำเนาบัตรประชาชน',
              requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
              timestamp: new Date().toISOString(),
            },
          });
        }
        handleServiceError(res, err, req);
      }
    }
  );

  // POST /api/v1/tenants
  router.post('/', mutationGuard('tenant:write'), async (req: Request, res: Response) => {
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
      const tenant = await tenantService.createTenant(dormId, parsed.data as any, req.auth?.userId);
      res.status(201).json({ data: toTenantApiDTO(tenant) });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // PUT /api/v1/tenants/:id
  router.put('/:id', mutationGuard('tenant:write'), async (req: Request, res: Response) => {
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
      const tenant = await tenantService.updateTenant(req.params.id, dormId, parsed.data as any, req.auth?.userId);
      res.json({ data: toTenantApiDTO(tenant) });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // DELETE /api/v1/tenants/:id
  router.delete('/:id', mutationGuard('tenant:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      const tenant = await tenantService.archiveTenant(req.params.id, dormId, req.auth?.userId);
      res.json({ data: { success: true, message: 'เก็บข้อมูลผู้เช่าเรียบร้อยแล้ว', tenant: toTenantApiDTO(tenant) } });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // POST /api/v1/tenants/:id/co-occupants
  router.post('/:id/co-occupants', mutationGuard('tenant:write'), async (req: Request, res: Response) => {
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
      const result = await billingOrchestrationService.addTenantCoOccupant(
        dormId,
        req.params.id,
        parsed.data,
        { userId: req.auth?.userId, isTenant: false }
      );
      res.status(201).json({ data: toCoOccupantApiDTO(result.coOccupant), peopleCount: result.peopleCount, recalculation: result.recalculation });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // PUT /api/v1/tenants/:id/co-occupants/:coOccupantId
  router.put('/:id/co-occupants/:coOccupantId', mutationGuard('tenant:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      const coOccupant = await tenantService.updateCoOccupant(
        dormId,
        req.params.id,
        req.params.coOccupantId,
        req.body,
        req.auth?.userId
      );
      res.json({ data: toCoOccupantApiDTO(coOccupant) });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // DELETE /api/v1/tenants/:id/co-occupants/:coOccupantId
  router.delete('/:id/co-occupants/:coOccupantId', mutationGuard('tenant:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      const result = await billingOrchestrationService.removeTenantCoOccupant(
        dormId,
        req.params.id,
        req.params.coOccupantId,
        { userId: req.auth?.userId, isTenant: false }
      );
      res.json({ data: { success: true, removedId: result.removedId, peopleCount: result.peopleCount, recalculation: result.recalculation } });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // POST /api/v1/tenants/:id/emergency-contacts
  router.post('/:id/emergency-contacts', mutationGuard('tenant:write'), async (req: Request, res: Response) => {
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
      res.status(201).json({ data: toEmergencyContactApiDTO(contact) });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // PUT /api/v1/tenants/:id/emergency-contacts/:contactId
  router.put('/:id/emergency-contacts/:contactId', mutationGuard('tenant:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      const parsed = UpdateEmergencyContactSchema.safeParse(req.body);
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

      const contact = await tenantService.updateEmergencyContact(dormId, req.params.id, req.params.contactId, parsed.data);
      res.json({ data: toEmergencyContactApiDTO(contact) });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // DELETE /api/v1/tenants/:id/emergency-contacts/:contactId
  router.delete('/:id/emergency-contacts/:contactId', mutationGuard('tenant:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      await tenantService.deleteEmergencyContact(dormId, req.params.id, req.params.contactId);
      res.json({ data: { success: true, message: 'ลบข้อมูลผู้ติดต่อฉุกเฉินเรียบร้อยแล้ว' } });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // POST /api/v1/tenants/:id/vehicles
  router.post('/:id/vehicles', mutationGuard('tenant:write'), async (req: Request, res: Response) => {
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
      res.status(201).json({ data: toVehicleApiDTO(vehicle) });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // PUT /api/v1/tenants/:id/vehicles/:vehicleId
  router.put('/:id/vehicles/:vehicleId', mutationGuard('tenant:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      const parsed = UpdateVehicleSchema.safeParse(req.body);
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

      const vehicle = await tenantService.updateVehicle(dormId, req.params.id, req.params.vehicleId, parsed.data);
      res.json({ data: toVehicleApiDTO(vehicle) });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // DELETE /api/v1/tenants/:id/vehicles/:vehicleId
  router.delete('/:id/vehicles/:vehicleId', mutationGuard('tenant:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      await tenantService.deleteVehicle(dormId, req.params.id, req.params.vehicleId);
      res.json({ data: { success: true, message: 'ลบข้อมูลยานพาหนะเรียบร้อยแล้ว' } });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // POST /api/v1/tenants/:id/identity-document
  router.post(
    '/:id/identity-document',
    mutationGuard('tenant:write'),
    handleUploadSingle,
    async (req: Request, res: Response) => {
      if (!verifyCsrf(req, res)) return;
      try {
        const dormId = getDormitoryId(req);
        const file = req.file;
        if (!file || !file.buffer) {
          return res.status(400).json({
            error: {
              code: 'NO_FILE_UPLOADED',
              message: 'กรุณาเลือกไฟล์เอกสารสำเนาบัตรประชาชนในฟิลด์ "file"',
              fieldErrors: null,
              requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
              timestamp: new Date().toISOString(),
            },
          });
        }

        const result = await tenantService.updateTenantIdentityDocument(
          dormId,
          req.params.id,
          file.buffer,
          req.auth?.userId
        );

        res.status(200).json({
          data: {
            tenantId: result.tenantId,
            hasIdentityDocument: true,
            idCardUploadedAt: result.idCardUploadedAt,
            idCardSha256: result.idCardSha256,
            idCardMimeType: result.idCardMimeType,
            idCardByteSize: result.idCardByteSize,
          },
          message: 'อัปโหลดและประมวลผลสำเนาบัตรประชาชนเรียบร้อยแล้ว',
        });
      } catch (err) {
        handleServiceError(res, err, req);
      }
    }
  );

  return router;
}
