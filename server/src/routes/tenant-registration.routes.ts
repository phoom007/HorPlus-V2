import { Router, Request, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { logger } from '../config/logger.js';
import { AuthenticationService } from '../services/auth.service.js';
import { TenantRegistrationService } from '../services/tenant-registration.service.js';
import { tenantRegistrationInviteService } from '../services/tenant-registration-invite.service.js';
import { getPrismaClient } from '../db/prisma.js';
import { createRequireSessionMiddleware } from '../middleware/require-session.js';
import { requireDormitoryPermission, resolveDormitoryContextMiddleware } from '../middleware/permission.js';
import { requireDormitoryWriteEntitlement } from '../middleware/entitlement.js';
import { ApproveRegistrationSchema } from '../schemas/property-tenant-contract.schemas.js';
import { SignatureStorageService } from '../services/signature-storage.service.js';
import { SessionTokenService } from '../services/session-token.service.js';
import { getEnv } from '../config/env.js';
import { createTenantRegistrationRateLimiter } from '../middleware/rate-limiter.js';

export function createTenantRegistrationRouter(
  authService: AuthenticationService,
  registrationService: TenantRegistrationService
): Router {
  const router = Router();
  const requireSession = createRequireSessionMiddleware(authService);
  const registrationRateLimiter = createTenantRegistrationRateLimiter();

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
    let sessionId = req.auth?.sessionId;
    if (!sessionId && req.cookies?.horplus_session) {
      try {
        const env = getEnv();
        const tokenService = new SessionTokenService(env.SESSION_ENCRYPTION_KEY);
        const payload = tokenService.decryptToken(req.cookies.horplus_session);
        if (payload?.sid) {
          sessionId = payload.sid;
        }
      } catch {}
    }

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

  router.post('/verify-claim', registrationRateLimiter, async (req: Request, res: Response) => {
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
    claimVerificationToken: z.string().min(1, 'ต้องระบุรหัสยืนยันการรับสิทธิ์ (claimVerificationToken)'),
    signatureBase64: z.string().min(1, 'กรุณาเซ็นชื่อยืนยันการรับสิทธิ์'),
    displayName: z.string().optional(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    phone: z.string().optional(),
    citizenId: z.string().optional(),
    birthDate: z.string().optional(),
    address: z.string().optional(),
    idCardImageUrl: z.string().optional(),
    depositSlipImageUrl: z.string().optional(),
    depositDeclaredStatus: z.string().optional(),
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

  router.post('/complete-claim', registrationRateLimiter, async (req: Request, res: Response) => {
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
      let actorUserId: string | undefined = req.auth?.userId || req.user?.id;
      if (!actorUserId && req.cookies?.horplus_session) {
        try {
          const env = getEnv();
          const tokenService = new SessionTokenService(env.SESSION_ENCRYPTION_KEY);
          const payload = tokenService.decryptToken(req.cookies.horplus_session);
          if (payload?.sub) {
            actorUserId = payload.sub;
          }
        } catch {}
      }

      // AC-5: Check CSRF if request carries a cookie session
      if (req.cookies?.horplus_session || req.auth?.sessionId) {
        if (!verifyCsrf(req, res)) return;
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
        depositSlipImageUrl: parsed.data.depositSlipImageUrl,
        emergencyContact: parsed.data.emergencyContact,
        vehicle: resolvedVehicle,
        coOccupants: parsed.data.coOccupants,
        pet: parsed.data.pet,
        inviteToken: parsed.data.inviteToken,
        actorUserId,
        claimVerificationToken: parsed.data.claimVerificationToken,
      });
      res.status(200).json({ data: result });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // POST /api/v1/tenant-registrations
  const CreateTenantRegistrationSchema = z.object({
    dormitoryId: z.string().optional(),
    inviteToken: z.string().optional(),
    requestedRoomId: z.string().min(1, 'กรุณาระบุห้องพักที่ต้องการสมัคร'),
    prefix: z.string().optional(),
    customPrefix: z.string().optional(),
    firstName: z.string().trim().min(1, 'กรุณาระบุชื่อจริง'),
    lastName: z.string().trim().optional().default(''),
    phone: z.string().trim().min(1, 'กรุณาระบุเบอร์โทรศัพท์'),
    email: z.string().optional().nullable(),
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
    endDate: z.string().optional(),
    dailyRateAmount: z.union([z.number(), z.string()]).optional(),
    depositAmount: z.union([z.number(), z.string()]).optional(),
    terms: z.string().optional().nullable(),
    citizenId: z.string().optional(),
    birthDate: z.string().optional(),
    address: z.string().optional(),
    idCardImageUrl: z.string().optional(),
    depositSlipImageUrl: z.string().optional(),
    depositDeclaredStatus: z.string().optional(),
    isInstallmentRequested: z.boolean().optional(),
    selectedInstallmentPlan: z.string().optional().nullable(),
    installments: z.array(z.any()).optional(),
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
    vehicles: z.array(z.any()).optional(),
    pet: z.object({
      hasPet: z.boolean(),
      type: z.string().optional(),
      name: z.string().optional(),
      count: z.number().optional(),
    }).optional(),
    pets: z.array(z.any()).optional(),
    lineFollowerId: z.string().optional(),
    lineDisplayName: z.string().optional(),
  });

  const resolveLineContextFromSession = async (req: Request): Promise<{ lineFriendId?: string; lineDisplayName?: string; dormitoryId?: string }> => {
    let authAccessGrantId = (req as any).auth?.session?.accessGrantId ||
      ((req as any).auth?.userId?.startsWith('ag_user_') ? (req as any).auth.userId.replace('ag_user_', '') :
       ((req as any).auth?.userId?.startsWith('ag_') ? (req as any).auth.userId.replace('ag_', '') : null));
    let actorUserId: string | undefined = (req as any).auth?.userId || (req as any).user?.id;

    if (!authAccessGrantId && !actorUserId && req.cookies?.horplus_session) {
      try {
        const env = getEnv();
        const tokenService = new SessionTokenService(env.SESSION_ENCRYPTION_KEY);
        const payload = tokenService.decryptToken(req.cookies.horplus_session);
        if (payload?.sub) {
          actorUserId = payload.sub;
          if (payload.sub.startsWith('ag_user_')) {
            authAccessGrantId = payload.sub.replace('ag_user_', '');
          } else if (payload.sub.startsWith('ag_')) {
            authAccessGrantId = payload.sub.replace('ag_', '');
          }
        }
      } catch {}
    }

    const prisma = getPrismaClient();
    if (authAccessGrantId) {
      let targetDormId = (req.body?.dormitoryId as string) || (req.headers['x-dormitory-id'] as string) || req.cookies?.['active_dormitory_id'];
      if (!targetDormId) {
        const rows = await prisma.$queryRaw<any[]>`
          SELECT dormitory_id FROM public.resolve_access_grant_by_id(${authAccessGrantId}::uuid)
        `.catch(() => []);
        if (rows && rows.length > 0) {
          targetDormId = rows[0].dormitory_id;
        }
      }
      if (targetDormId) {
        const grant = await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${targetDormId}, true)`;
          return await tx.dormitoryAccessGrant.findUnique({
            where: { id: authAccessGrantId },
            include: { lineFriend: true },
          });
        }).catch(() => null);
        if (grant) {
          return {
            lineFriendId: grant.lineFriendId || undefined,
            lineDisplayName: grant.lineFriend?.displayName || undefined,
            dormitoryId: grant.dormitoryId || undefined,
          };
        }
      }
    }

    if (actorUserId && /^[0-9a-fA-F-]{36}$/.test(actorUserId)) {
      const user = await prisma.user.findUnique({
        where: { id: actorUserId },
        select: { name: true },
      });
      if (user?.name) {
        return { lineDisplayName: user.name };
      }
    }

    return {};
  };

  router.post('/', registrationRateLimiter, async (req: Request, res: Response) => {
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

      const lineCtx = await resolveLineContextFromSession(req);
      if (!dormId && lineCtx.dormitoryId) {
        dormId = lineCtx.dormitoryId;
      }

      const newReq = await registrationService.createRequest(dormId, {
        dormitoryId: dormId || undefined,
        inviteToken: validData.inviteToken || undefined,
        lineFollowerId: lineCtx.lineFriendId || undefined,
        lineDisplayName: lineCtx.lineDisplayName || validData.lineDisplayName,
        requestedRoomId: validData.requestedRoomId,
        prefix: validData.prefix,
        customPrefix: validData.customPrefix,
        firstName: validData.firstName,
        lastName: validData.lastName,
        phone: validData.phone,
        email: validData.email,
        note: validData.note || undefined,
        agreedTerms: validData.agreedTerms,
        signatureBase64: validData.signatureBase64,
        expectedPolicyVersion: validData.expectedPolicyVersion,
        rentalPlan: validData.rentalPlan,
        proposedRent: validData.proposedRent,
        proposedDeposit: validData.proposedDeposit,
        durationMonths: validData.durationMonths,
        startDate: validData.startDate,
        endDate: validData.endDate,
        dailyRateAmount: validData.dailyRateAmount,
        depositAmount: validData.depositAmount,
        terms: validData.terms,
        citizenId: validData.citizenId,
        birthDate: validData.birthDate,
        address: validData.address,
        idCardImageUrl: validData.idCardImageUrl,
        depositSlipImageUrl: validData.depositSlipImageUrl,
        depositDeclaredStatus: validData.depositDeclaredStatus,
        isInstallmentRequested: validData.isInstallmentRequested,
        selectedInstallmentPlan: validData.selectedInstallmentPlan,
        installments: validData.installments,
        emergencyContact: validData.emergencyContact,
        coOccupants: validData.coOccupants,
        vehicle: validData.vehicle,
        vehicles: validData.vehicles,
        pet: validData.pet,
        pets: validData.pets,
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
      const lineCtx = await resolveLineContextFromSession(req);
      if (!dormId && lineCtx.dormitoryId) {
        dormId = lineCtx.dormitoryId;
      }
      const result = await registrationService.resubmitRequest(req.params.id, dormId, {
        ...parseResult.data,
        lineFollowerId: lineCtx.lineFriendId || undefined,
        lineDisplayName: lineCtx.lineDisplayName || parseResult.data.lineDisplayName,
      });
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
            code: 'INVALID_FILE_FIELD',
            message: 'การอัปโหลดไฟล์ไม่ถูกต้องตามรูปแบบที่กำหนด',
            fieldErrors: null,
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }
      return res.status(500).json({
        error: {
          code: 'REGISTRATION_OPERATION_FAILED',
          message: 'เกิดข้อผิดพลาดในการดำเนินการ กรุณาลองใหม่อีกครั้ง',
          requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
          timestamp: new Date().toISOString(),
        },
      });
    });
  };

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
  privateRouter.get('/:id', async (req: Request, res: Response, next) => {
    // Applicants need their own snapshot to correct a rejected registration.
    // A tenant role never grants access to the dormitory's other applications.
    if ((req as any).dormitoryContext?.roleCode !== 'TENANT') {
      return requireDormitoryPermission('tenant:read')(req, res, next);
    }
    try {
      const dormId = getAuthoritativeDormitoryId(req);
      const grantId = req.auth?.session?.accessGrantId;
      const ownsRequest = grantId && await getPrismaClient().$transaction(async tx => {
        await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormId}, true)`;
        const grant = await tx.dormitoryAccessGrant.findFirst({
          where: { id: grantId, dormitoryId: dormId, roleCode: 'TENANT', status: 'ACTIVE' },
          select: { lineFriendId: true },
        });
        if (!grant?.lineFriendId) return false;
        return Boolean(await tx.tenantRegistrationRequest.findFirst({
          where: { id: req.params.id, dormitoryId: dormId, lineFollowerId: grant.lineFriendId },
          select: { id: true },
        }));
      });
      if (!ownsRequest) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'ไม่สามารถเข้าถึงคำขอลงทะเบียนนี้ได้' } });
      next();
    } catch (err) {
      handleServiceError(res, err, req);
    }
  }, async (req: Request, res: Response) => {
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
        requireTenantConfirmation: parsed.data.requireTenantConfirmation,
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

  // POST /api/v1/tenant-registrations/:id/reassign-room
  privateRouter.post('/:id/reassign-room', ...mutationGuard('tenant:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getAuthoritativeDormitoryId(req);
      const targetRoomId = req.body?.targetRoomId;
      if (!targetRoomId) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'กรุณาระบุ targetRoomId',
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }
      const result = await registrationService.reassignRequestRoom(req.params.id, dormId, targetRoomId, req.auth?.userId);
      res.json({ data: result });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // GET /api/v1/tenant-registrations/:id/contract-pdf
  privateRouter.get('/:id/contract-pdf', requireDormitoryPermission('tenant:read'), async (req: Request, res: Response) => {
    try {
      const dormId = getAuthoritativeDormitoryId(req);
      const { buffer, filename } = await registrationService.getRegistrationContractPdf(
        dormId,
        req.params.id,
        {
          roomId: typeof req.query.roomId === 'string' ? req.query.roomId : undefined,
          startDate: typeof req.query.startDate === 'string' ? req.query.startDate : undefined,
          endDate: typeof req.query.endDate === 'string' ? req.query.endDate : undefined,
          rentAmount: typeof req.query.rentAmount === 'string' ? req.query.rentAmount : undefined,
          depositAmount: typeof req.query.depositAmount === 'string' ? req.query.depositAmount : undefined,
        }
      );
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
      return res.send(buffer);
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // GET /api/v1/tenant-registrations/:id/identity-document
  privateRouter.get('/:id/identity-document', requireDormitoryPermission('tenant:read'), async (req: Request, res: Response) => {
    try {
      const dormId = getAuthoritativeDormitoryId(req);
      const doc = await registrationService.getRegistrationIdentityDocument(dormId, req.params.id);
      res.setHeader('Content-Type', doc.mimeType);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Content-Disposition', `inline; filename="${doc.filename}"`);
      return res.send(doc.fileBuffer);
    } catch (err: any) {
      if (err?.code === 'IDENTITY_DOCUMENT_NOT_FOUND' || err?.code === 'FILE_NOT_FOUND') {
        return res.status(404).json({
          error: {
            code: 'IDENTITY_DOCUMENT_NOT_FOUND',
            message: err.message || 'ไม่พบไฟล์เอกสารสำเนาบัตรประชาชน',
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }
      handleServiceError(res, err, req);
    }
  });

  // POST /api/v1/tenant-registrations/:id/identity-document
  privateRouter.post('/:id/identity-document', ...mutationGuard('tenant:write'), handleUploadSingle, async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getAuthoritativeDormitoryId(req);
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
      const result = await registrationService.saveRegistrationIdentityDocument(
        dormId,
        req.params.id,
        file.buffer,
        req.auth?.userId
      );
      res.status(200).json({
        data: result,
        message: 'อัปโหลดและประมวลผลสำเนาบัตรประชาชนคำขอลงทะเบียนเรียบร้อยแล้ว',
      });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // GET /api/v1/tenant-registrations/:id/tenant-signature
  privateRouter.get('/:id/tenant-signature', requireDormitoryPermission('tenant:read'), async (req: Request, res: Response) => {
    try {
      const dormId = getAuthoritativeDormitoryId(req);
      const { id } = req.params;
      const prisma = getPrismaClient();
      const reg = await prisma.tenantRegistrationRequest.findFirst({
        where: {
          dormitoryId: dormId,
          OR: [
            { id },
            { approvedTenantId: id },
          ],
        },
      });
      if (!reg || !reg.tenantSignatureObjectKey) {
        return res.status(404).json({ error: { message: 'Tenant signature not found' } });
      }
      const signatureService = new SignatureStorageService(prisma);
      const stream = await signatureService.getSignatureStream(reg.tenantSignatureObjectKey);
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      stream.pipe(res);
    } catch (err: any) {
      const statusCode = err.statusCode || (err.code === 'SIGNATURE_NOT_FOUND' ? 404 : 500);
      res.status(statusCode).json({
        error: {
          code: err.code || 'SIGNATURE_STREAM_FAILED',
          message: err.message || 'เกิดข้อผิดพลาดขณะเรียกลายเซ็นผู้เช่า',
        },
      });
    }
  });

  router.use('/', privateRouter);

  return router;
}
