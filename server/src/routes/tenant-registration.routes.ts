import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { AuthenticationService } from '../services/auth.service.js';
import { TenantRegistrationService } from '../services/tenant-registration.service.js';
import { tenantRegistrationInviteService } from '../services/tenant-registration-invite.service.js';
import { getPrismaClient } from '../db/prisma.js';
import { createRequireSessionMiddleware } from '../middleware/require-session.js';
import { requireDormitoryPermission, resolveDormitoryContextMiddleware } from '../middleware/permission.js';
import { requireDormitoryWriteEntitlement } from '../middleware/entitlement.js';
import { ApproveRegistrationSchema } from '../schemas/property-tenant-contract.schemas.js';

export function createTenantRegistrationRouter(
  authService: AuthenticationService,
  registrationService: TenantRegistrationService
): Router {
  const router = Router();
  const requireSession = createRequireSessionMiddleware(authService);

  const getAuthoritativeDormitoryId = (req: Request): string => {
    const dormId = (req as any).dormitoryContext?.dormitoryId || req.auth?.dormitoryId;
    if (!dormId) {
      const err = new Error('DORMITORY_ID_REQUIRED');
      (err as any).statusCode = 400;
      (err as any).code = 'DORMITORY_ID_REQUIRED';
      throw err;
    }
    return dormId;
  };

  const getPublicDormitoryId = (req: Request): string => {
    const dormId = (req.body?.dormitoryId as string) || (req.headers['x-dormitory-id'] as string) || (req.query?.dormitoryId as string);
    if (!dormId) {
      const err = new Error('DORMITORY_ID_REQUIRED');
      (err as any).statusCode = 400;
      (err as any).code = 'DORMITORY_ID_REQUIRED';
      throw err;
    }
    return dormId;
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
        code: err.code || 'REGISTRATION_OPERATION_FAILED',
        message: err.message || 'เกิดข้อผิดพลาดในการดำเนินการจัดการคำขอลงทะเบียน',
        activeTenantName: err.activeTenantName || null,
        activeRoomNumber: err.activeRoomNumber || null,
        hasFutureRenewal: err.hasFutureRenewal || false,
        futureTenantName: err.futureTenantName || null,
        futureStartDate: err.futureStartDate || null,
        fieldErrors: err.fieldErrors || null,
        requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
        timestamp: new Date().toISOString(),
      },
    });
  };

  // 1. PUBLIC ENDPOINTS
  // GET /api/v1/tenant-registrations/public-policy
  router.get('/public-policy', async (req: Request, res: Response) => {
    try {
      const dormId = getPublicDormitoryId(req);
      const policy = await registrationService.getPublicDormitoryPolicy(dormId);
      res.json({ data: policy });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // GET /api/v1/tenant-registrations/invite-context?t=<token>
  router.get('/invite-context', async (req: Request, res: Response) => {
    try {
      const rawToken = (req.query.t || req.query.token) as string;
      if (!rawToken || typeof rawToken !== 'string' || !rawToken.trim()) {
        return res.status(400).json({
          error: {
            code: 'TENANT_REGISTRATION_INVITE_INVALID',
            message: 'กรุณาระบุ token สำหรับการลงทะเบียน',
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const invite = await tenantRegistrationInviteService.resolveInvite(rawToken.trim());
      const policy = await registrationService.getPublicDormitoryPolicy(invite.dormitoryId);
      const rooms = await registrationService.getPublicRooms(invite.dormitoryId);

      res.json({
        data: {
          dormitoryId: invite.dormitoryId,
          dormitoryName: invite.dormitoryName,
          lineDisplayName: invite.lineDisplayName,
          linePictureUrl: invite.linePictureUrl,
          expiresAt: invite.expiresAt,
          policy,
          rooms,
        },
      });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // GET /api/v1/tenant-registrations/public-rooms
  router.get('/public-rooms', async (req: Request, res: Response) => {
    try {
      let dormId = '';
      const rawToken = (req.query.t || req.query.token) as string;
      if (rawToken && typeof rawToken === 'string' && rawToken.trim()) {
        const invite = await tenantRegistrationInviteService.resolveInvite(rawToken.trim());
        dormId = invite.dormitoryId;
      } else {
        dormId = getPublicDormitoryId(req);
      }
      const rooms = await registrationService.getPublicRooms(dormId);
      res.json({ data: rooms });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // POST /api/v1/tenant-registrations/verify-claim
  const VerifyClaimSchema = z.object({
    dormitoryId: z.string().uuid().optional(),
    inviteToken: z.string().optional(),
    roomId: z.string().min(1, 'กรุณาระบุห้องพัก'),
    claimInput: z.string().trim().min(1, 'กรุณากรอกชื่อ-นามสกุล หรือ เบอร์โทรศัพท์'),
  });

  router.post('/verify-claim', async (req: Request, res: Response) => {
    try {
      const parsed = VerifyClaimSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: parsed.error.issues[0]?.message || 'ข้อมูลไม่ถูกต้อง',
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }
      let dormId = parsed.data.dormitoryId;
      if (parsed.data.inviteToken) {
        const invite = await tenantRegistrationInviteService.resolveInvite(parsed.data.inviteToken.trim());
        dormId = invite.dormitoryId;
      }
      if (!dormId) {
        dormId = getPublicDormitoryId(req);
      }
      const rawIp = req.ip || (req.headers['x-forwarded-for'] as string) || 'actor-ip';
      const actorKey = rawIp.split(',')[0].trim();
      const result = await registrationService.verifyTenantClaim({
        dormitoryId: dormId,
        roomId: parsed.data.roomId,
        claimInput: parsed.data.claimInput,
        actorId: actorKey,
      });
      res.json({ data: result });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // POST /api/v1/tenant-registrations/complete-claim
  const CompleteClaimSchema = z.object({
    dormitoryId: z.string().uuid().optional(),
    inviteToken: z.string().optional(),
    roomId: z.string().min(1, 'กรุณาระบุห้องพัก'),
    tenantId: z.string().uuid('รหัสผู้เช่าไม่ถูกต้อง'),
    signatureBase64: z.string().min(1, 'กรุณาเซ็นชื่อยืนยันการรับสิทธิ์'),
    displayName: z.string().optional(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    phone: z.string().optional(),
    citizenId: z.string().optional(),
    birthDate: z.string().optional(),
    address: z.string().optional(),
    idCardImageUrl: z.string().optional(),
    emergencyContact: z.object({
      name: z.string(),
      relationship: z.string(),
      phone: z.string(),
    }).optional(),
    vehicle: z.object({
      type: z.string(),
      licensePlate: z.string(),
      brand: z.string().optional(),
    }).optional(),
    vehicles: z.array(z.object({
      type: z.string(),
      licensePlate: z.string(),
      brand: z.string().optional(),
    })).optional(),
    coOccupants: z.array(z.object({
      name: z.string(),
      phone: z.string().optional(),
      citizenId: z.string().optional(),
    })).optional(),
    pet: z.object({
      hasPet: z.boolean(),
      type: z.string().optional(),
      name: z.string().optional(),
      count: z.number().optional(),
    }).optional(),
    lineFollowerId: z.string().optional(),
  });

  router.post('/complete-claim', async (req: Request, res: Response) => {
    try {
      const parsed = CompleteClaimSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: parsed.error.issues[0]?.message || 'ข้อมูลไม่ถูกต้อง',
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }
      let dormId = parsed.data.dormitoryId;
      let lineFriendId = parsed.data.lineFollowerId;
      if (parsed.data.inviteToken) {
        const invite = await tenantRegistrationInviteService.resolveInvite(parsed.data.inviteToken.trim());
        dormId = invite.dormitoryId;
        lineFriendId = lineFriendId || invite.lineFriendId;
      }
      if (!dormId) {
        dormId = getPublicDormitoryId(req);
      }
      const resolvedVehicle = parsed.data.vehicle || (parsed.data.vehicles && parsed.data.vehicles[0]) || undefined;
      const result = await registrationService.completeTenantClaim({
        dormitoryId: dormId,
        roomId: parsed.data.roomId,
        tenantId: parsed.data.tenantId,
        signatureBase64: parsed.data.signatureBase64,
        displayName: parsed.data.displayName,
        firstName: parsed.data.firstName,
        lastName: parsed.data.lastName,
        phone: parsed.data.phone,
        citizenId: parsed.data.citizenId,
        birthDate: parsed.data.birthDate,
        address: parsed.data.address,
        idCardImageUrl: parsed.data.idCardImageUrl,
        emergencyContact: parsed.data.emergencyContact,
        vehicle: resolvedVehicle,
        coOccupants: parsed.data.coOccupants,
        pet: parsed.data.pet,
        inviteToken: parsed.data.inviteToken,
      });
      res.status(200).json({ data: result });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // POST /api/v1/tenant-registrations
  const CreateTenantRegistrationSchema = z.object({
    dormitoryId: z.string().uuid().optional(),
    inviteToken: z.string().optional(),
    requestedRoomId: z.string().min(1, 'กรุณาระบุห้องพักที่ต้องการสมัคร'),
    firstName: z.string().trim().min(1, 'กรุณาระบุชื่อจริง'),
    lastName: z.string().trim().min(1, 'กรุณาระบุนามสกุล'),
    phone: z.string().trim().min(1, 'กรุณาระบุเบอร์โทรศัพท์'),
    note: z.string().optional().nullable(),
    agreedTerms: z.literal(true, {
      errorMap: () => ({ message: 'กรุณายอมรับกฎระเบียบและเงื่อนไขของหอพักก่อนส่งคำขอลงทะเบียน' }),
    }),
    signatureBase64: z.string().min(1, 'กรุณาเซ็นชื่อก่อนส่งคำขอลงทะเบียน'),
    expectedPolicyVersion: z.number().int().min(1, 'กรุณาระบุเวอร์ชันของกฎระเบียบที่ถูกต้อง'),
    rentalPlan: z.enum(['monthly', 'term', 'daily']).optional(),
    proposedRent: z.union([z.number(), z.string()]).optional(),
    proposedDeposit: z.union([z.number(), z.string()]).optional(),
    durationMonths: z.number().optional(),
    startDate: z.string().optional(),
    citizenId: z.string().optional(),
    birthDate: z.string().optional(),
    address: z.string().optional(),
    idCardImageUrl: z.string().optional(),
    emergencyContact: z.object({
      name: z.string(),
      relationship: z.string(),
      phone: z.string(),
    }).optional(),
    coOccupants: z.array(z.object({
      name: z.string(),
      phone: z.string().optional(),
      citizenId: z.string().optional(),
    })).optional(),
    vehicle: z.object({
      type: z.string(),
      licensePlate: z.string(),
      brand: z.string().optional(),
    }).optional(),
    pet: z.object({
      hasPet: z.boolean(),
      type: z.string().optional(),
      name: z.string().optional(),
      count: z.number().optional(),
    }).optional(),
  });

  router.post('/', async (req: Request, res: Response) => {
    try {
      const parseResult = CreateTenantRegistrationSchema.safeParse(req.body);
      if (!parseResult.success) {
        const firstIssue = parseResult.error.issues[0];
        const isTerms = firstIssue.path.includes('agreedTerms');
        const isSig = firstIssue.path.includes('signatureBase64');
        const isVersion = firstIssue.path.includes('expectedPolicyVersion');
        const code = isTerms
          ? 'TERMS_NOT_ACCEPTED'
          : isSig
          ? 'SIGNATURE_REQUIRED'
          : isVersion
          ? 'INVALID_POLICY_VERSION'
          : 'VALIDATION_ERROR';

        return res.status(400).json({
          error: {
            code,
            message: firstIssue.message || 'ข้อมูลที่ส่งมาไม่ถูกต้อง',
            fieldErrors: parseResult.error.flatten().fieldErrors,
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const validData = parseResult.data;
      let dormId = '';
      if (!validData.inviteToken) {
        dormId = getPublicDormitoryId(req);
      }
      const newReq = await registrationService.createRequest(dormId, {
        dormitoryId: dormId || undefined,
        inviteToken: validData.inviteToken || undefined,
        requestedRoomId: validData.requestedRoomId,
        firstName: validData.firstName,
        lastName: validData.lastName,
        phone: validData.phone,
        note: validData.note || undefined,
        agreedTerms: validData.agreedTerms,
        signatureBase64: validData.signatureBase64,
        expectedPolicyVersion: validData.expectedPolicyVersion,
        rentalPlan: validData.rentalPlan,
        proposedRent: validData.proposedRent,
        proposedDeposit: validData.proposedDeposit,
        durationMonths: validData.durationMonths,
        startDate: validData.startDate,
        citizenId: validData.citizenId,
        birthDate: validData.birthDate,
        address: validData.address,
        idCardImageUrl: validData.idCardImageUrl,
        emergencyContact: validData.emergencyContact,
        coOccupants: validData.coOccupants,
        vehicle: validData.vehicle,
        pet: validData.pet,
      });
      res.status(201).json({ data: newReq });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // POST /api/v1/tenant-registrations/:id/resubmit (Public resubmit for rejected/revised requests)
  router.post('/:id/resubmit', async (req: Request, res: Response) => {
    try {
      const parseResult = CreateTenantRegistrationSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: parseResult.error.issues[0]?.message || 'ข้อมูลไม่ถูกต้อง',
            fieldErrors: parseResult.error.flatten().fieldErrors,
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }
      let dormId = parseResult.data.dormitoryId;
      if (!dormId) {
        dormId = getPublicDormitoryId(req);
      }
      const result = await registrationService.resubmitRequest(req.params.id, dormId, parseResult.data);
      res.json({ data: result });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // POST /api/v1/tenant-registrations/:id/confirm-signature (Public tenant final review & signature confirmation)
  const ConfirmSignatureSchema = z.object({
    signatureBase64: z.string().min(1, 'กรุณาเซ็นชื่อก่อนยืนยันสัญญา'),
    dormitoryId: z.string().uuid().optional(),
  });

  router.post('/:id/confirm-signature', async (req: Request, res: Response) => {
    try {
      const parsed = ConfirmSignatureSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: parsed.error.issues[0]?.message || 'ข้อมูลไม่ถูกต้อง',
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }
      let dormId = parsed.data.dormitoryId;
      if (!dormId) {
        dormId = getPublicDormitoryId(req);
      }
      const result = await registrationService.confirmApprovedRegistration(
        req.params.id,
        dormId,
        { signatureBase64: parsed.data.signatureBase64 }
      );
      res.json({ data: result });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // 2. PROTECTED PRIVATE ENDPOINTS
  const privateRouter = Router();
  privateRouter.use(requireSession);
  privateRouter.use(resolveDormitoryContextMiddleware);

  const mutationGuard = (permission: string) => [
    requireDormitoryPermission(permission),
    requireDormitoryWriteEntitlement,
  ];

  // GET /api/v1/tenant-registrations
  privateRouter.get('/', requireDormitoryPermission('tenant:read'), async (req: Request, res: Response) => {
    try {
      const dormId = getAuthoritativeDormitoryId(req);
      const requests = await registrationService.listRequests(dormId);
      res.json({ data: requests });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // GET /api/v1/tenant-registrations/:id
  privateRouter.get('/:id', requireDormitoryPermission('tenant:read'), async (req: Request, res: Response) => {
    try {
      const dormId = getAuthoritativeDormitoryId(req);
      const request = await registrationService.getRequestById(req.params.id, dormId);
      res.json({ data: request });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // GET /api/v1/tenant-registrations/:id/replacement-warning
  privateRouter.get('/:id/replacement-warning', requireDormitoryPermission('tenant:read'), async (req: Request, res: Response) => {
    try {
      const dormId = getAuthoritativeDormitoryId(req);
      const details = await registrationService.getReplacementWarningDetails(dormId, req.params.id);
      res.json({ data: details });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // PATCH /api/v1/tenant-registrations/:id
  privateRouter.patch('/:id', ...mutationGuard('tenant:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getAuthoritativeDormitoryId(req);
      const { requestedRoomId } = req.body || {};
      if (!requestedRoomId) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'กรุณาระบุรหัสห้องพักใหม่',
            fieldErrors: null,
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }
      const updated = await registrationService.updateRequestRoom(req.params.id, dormId, requestedRoomId, req.auth?.userId);
      res.json({ data: updated });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // POST /api/v1/tenant-registrations/:id/approve
  privateRouter.post('/:id/approve', ...mutationGuard('tenant:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getAuthoritativeDormitoryId(req);
      const parsed = ApproveRegistrationSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'ข้อมูลการอนุมัติคำขอลงทะเบียนไม่ถูกต้อง',
            fieldErrors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }
      const approvePayload = {
        ...parsed.data,
        requireTenantConfirmation: parsed.data.requireTenantConfirmation !== false,
      };
      const result = await registrationService.approveRequest(req.params.id, dormId, approvePayload, req.auth?.userId);
      res.json({ data: result });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // POST /api/v1/tenant-registrations/:id/reject
  privateRouter.post('/:id/reject', ...mutationGuard('tenant:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getAuthoritativeDormitoryId(req);
      const result = await registrationService.rejectRequest(req.params.id, dormId, req.body?.reason, req.auth?.userId);
      res.json({ data: result });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  router.use('/', privateRouter);

  return router;
}
