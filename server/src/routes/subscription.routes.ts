import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import multer from 'multer';
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { getPrismaClient } from '../db/prisma.js';
import { subscriptionEntitlementService, addCalendarMonths } from '../services/subscription-entitlement.service.js';
import { subscriptionSlipVerifier } from '../integrations/payment-verification/subscription-slip-verifier.js';
import { coinWalletService } from '../services/coin-wallet.service.js';
import { createCsrfMiddleware } from '../middleware/csrf.js';
import { resolveAuthoritativeDormitoryContext } from '../middleware/dormitory-context.js';
import { AuthenticationService } from '../services/auth.service.js';
import { AppError } from '../types/index.js';
import { createSlipUploadRateLimiter, distributedRateLimiterStore } from '../middleware/rate-limiter.js';
import { processAndSecureSlipImage } from '../services/image-security.service.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 }, // 4MB maximum
});

const handleUploadSingle = (req: Request, res: Response, next: NextFunction) => {
  upload.single('file')(req, res, (err: any) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          error: {
            code: 'FILE_TOO_LARGE',
            message: 'ขนาดไฟล์รูปภาพสลิปเกินขีดจำกัดสูงสุด 4MB',
            fieldErrors: null,
            requestId: (req.headers['x-request-id'] as string) || (req as any).id || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }
      return res.status(400).json({
        error: {
          code: 'INVALID_FILE_FIELD',
          message: 'เกิดข้อผิดพลาดในการอัปโหลดไฟล์สลิป',
          fieldErrors: null,
          requestId: (req.headers['x-request-id'] as string) || (req as any).id || 'req-unknown',
          timestamp: new Date().toISOString(),
        },
      });
    }
    next(err);
  });
};

function formatThaiDate(d: Date): string {
  const thaiMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  return `${d.getDate()} ${thaiMonths[d.getMonth()]} ${d.getFullYear() + 543}`;
}

const promoRedeemSchema = z.object({
  code: z.string().min(1, 'Promo code is required'),
});

export function createSubscriptionRouter(authService?: AuthenticationService): Router {
  const router = Router();
  const csrfMiddleware = authService
    ? createCsrfMiddleware(authService)
    : (_req: Request, _res: Response, next: NextFunction) => next();
  const slipUploadRateLimiter = createSlipUploadRateLimiter();

  const requireOwnerRole = async (req: Request, res: Response, next: NextFunction) => {
    try {
      let context = (req as any).dormitoryContext;
      if (!context) {
        try {
          context = await resolveAuthoritativeDormitoryContext(req);
          (req as any).dormitoryContext = context;
        } catch {
          // Fall back to req.auth if context resolution throws
        }
      }
      const rawRole =
        context?.roleCode ||
        (req as any).auth?.roleCode ||
        (req as any).auth?.role ||
        (req as any).auth?.memberships?.[0]?.roleCode;

      const roleCode = String(rawRole || (context?.dormitoryId ? 'OWNER' : '')).toUpperCase();

      if (roleCode && roleCode !== 'OWNER') {
        return res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: 'เมนูต่ออายุและการจัดการแพ็กเกจ อนุญาตเฉพาะเจ้าของหอพักเท่านั้น (OWNER role required)',
            fieldErrors: null,
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }
      next();
    } catch (err) {
      next(err);
    }
  };

  if (authService) {
    router.use(authService.requireAuth());
    router.use(requireOwnerRole);
  }

  // GET /api/v1/subscription/config/payment
  router.get('/config/payment', async (_req: Request, res: Response) => {
    return res.json({
      success: true,
      data: {
        promptPayId: process.env.HORPLUS_PROMPTPAY_ID || '0935098808',
        accountName: process.env.HORPLUS_PROMPTPAY_NAME || 'นายภูวนาท ทานาลาด',
      },
    });
  });

  // GET /api/v1/subscription/current and /api/v1/subscription/my-plan
  const handleCurrentSubscription = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const context = (req as any).dormitoryContext || (await resolveAuthoritativeDormitoryContext(req));
      const prisma = getPrismaClient();

      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

      let slipsChecked = 0;
      try {
        slipsChecked = await prisma.paymentEvidenceVerification.count({
          where: {
            dormitoryId: context.dormitoryId,
            status: 'VERIFIED',
            createdAt: { gte: startOfMonth, lte: endOfMonth }
          }
        });
      } catch {
        slipsChecked = 0;
      }

      let roomCount = 0;
      try {
        roomCount = await prisma.room.count({
          where: {
            dormitoryId: context.dormitoryId,
            deletedAt: null,
            status: { not: 'archived' }
          }
        });
      } catch {
        roomCount = 0;
      }

      let subscription: any = null;
      try {
        subscription = await subscriptionEntitlementService.getCurrentSubscription(context.dormitoryId);
      } catch {
        subscription = {
          dormitoryId: context.dormitoryId,
          plan: { code: 'FREE', name: 'HorPlus Free', type: 'FREE', roomLimit: 10 },
          status: 'ACTIVE',
          expiresAt: null
        };
      }

      let isTrialEligible = false;
      const rawUserId = (req as any).auth?.userId || (req as any).user?.id || context.userId;
      if (rawUserId) {
        try {
          const cleanUserId = rawUserId.replace(/^ag_user_|^ag_/, '');
          let claimUserId: string | null = null;
          if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanUserId)) {
            claimUserId = cleanUserId;
          } else {
            const dorm = await prisma.dormitory.findUnique({
              where: { id: context.dormitoryId },
              select: { createdByUserId: true },
            });
            claimUserId = dorm?.createdByUserId || null;
          }

          if (claimUserId) {
            const existingClaim = await prisma.accountBenefitClaim.findFirst({
              where: {
                userId: claimUserId,
                benefitKey: 'INITIAL_TRIAL_V1',
              },
            });
            const hasDormUsedTrial = Boolean(subscription?.trialStartedAt);
            isTrialEligible = !existingClaim && !hasDormUsedTrial;
          }
        } catch {
          isTrialEligible = false;
        }
      }

      return res.json({
        data: {
          ...subscription,
          slipsChecked,
          roomCount,
          isTrialEligible
        }
      });
    } catch (err) {
      next(err);
    }
  };

  router.get('/current', handleCurrentSubscription);
  router.get('/my-plan', handleCurrentSubscription);

  // GET /api/v1/subscription/entitlements
  router.get('/entitlements', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const context = (req as any).dormitoryContext || (await resolveAuthoritativeDormitoryContext(req));
      const prisma = getPrismaClient();

      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

      let slipsChecked = 0;
      try {
        slipsChecked = await prisma.paymentEvidenceVerification.count({
          where: {
            dormitoryId: context.dormitoryId,
            status: 'VERIFIED',
            createdAt: { gte: startOfMonth, lte: endOfMonth }
          }
        });
      } catch {
        slipsChecked = 0;
      }

      const entitlements = await subscriptionEntitlementService.getEffectiveEntitlements(context.dormitoryId);
      const availablePackages = await subscriptionEntitlementService.getAvailablePackages();

      return res.json({
        data: {
          ...entitlements,
          slipsChecked,
          availablePackages,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/subscription/plans
  router.get('/plans', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const availablePackages = await subscriptionEntitlementService.getAvailablePackages();
      return res.json({ data: availablePackages });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/subscription/promo/redeem
  router.post('/promo/redeem', csrfMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const context = (req as any).dormitoryContext || (await resolveAuthoritativeDormitoryContext(req));

      const isOwner = context.roleCode === 'OWNER';
      const isManager = context.roleCode === 'MANAGER';
      const hasPromoPermission = (context.permissions || []).some((p: string) =>
        ['*', 'subscription:write', 'subscription:*', 'promo:redeem'].includes(p)
      );

      if (!isOwner && (!isManager || !hasPromoPermission)) {
        throw new AppError('Only dormitory Owners or Managers with promo permissions can redeem promo codes.', 403, 'FORBIDDEN');
      }

      const idempotencyKey = (req.headers['x-idempotency-key'] as string) || (req.headers['idempotency-key'] as string);
      if (!idempotencyKey) {
        throw new AppError('X-Idempotency-Key header is required for promo code redemption.', 400, 'IDEMPOTENCY_KEY_REQUIRED');
      }

      const parsed = promoRedeemSchema.parse(req.body);
      const result = await subscriptionEntitlementService.redeemPromoCode({
        dormitoryId: context.dormitoryId,
        code: parsed.code,
        userId: context.userId,
        idempotencyKey,
      });

      return res.status(result.status).json(result.body);
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/payment/slip',
    slipUploadRateLimiter,
    handleUploadSingle,
    async (req: Request, res: Response, next: NextFunction) => {
      const requestId = (req.headers['x-request-id'] as string) || (req as any).id || `req-slip-${Date.now()}`;
      let lockKey: string | null = null;

      try {
        const context = (req as any).dormitoryContext || (await resolveAuthoritativeDormitoryContext(req));
        const isStaff = context.roleCode === 'STAFF';
        if (isStaff || (context.roleCode && !['OWNER', 'MANAGER'].includes(context.roleCode))) {
          throw new AppError('Only dormitory Owners or Managers can upload subscription payment slips.', 403, 'FORBIDDEN');
        }

        const file = req.file;
        if (!file) {
          throw new AppError('กรุณาแนบไฟล์รูปภาพสลิปชำระเงิน', 400, 'SLIP_FILE_REQUIRED');
        }

        // Step A: Immediate Raw SHA-256 Hash & Concurrency Pre-Lock (Anti-Race Condition before Sharp)
        const rawHash = crypto.createHash('sha256').update(file.buffer).digest('hex');
        lockKey = `lock:slip:${rawHash}`;
        const lockAcquired = await distributedRateLimiterStore.acquireLock(lockKey, requestId, 30);
        if (!lockAcquired) {
          return res.status(409).json({
            error: {
              code: 'CONCURRENT_REQUEST_IN_PROGRESS',
              message: 'มีคำขอตรวจสอบสลิปนี้กำลังประมวลผลอยู่ กรุณารอสักครู่ (CONCURRENT_REQUEST_IN_PROGRESS)',
              fieldErrors: null,
              requestId,
              timestamp: new Date().toISOString(),
            },
          });
        }

        // Step B: Sanitize Image (Magic bytes validation, Decompression bomb protection, EXIF/comment stripping)
        const secured = await processAndSecureSlipImage(file.buffer);

        const dormitoryId = context.dormitoryId;
        const userId = context.userId;
        const prisma = getPrismaClient();

        // Step C: Zero-Trust Server Amount Computation
        // Ignore any client body overrides (expectedAmount, price, amount)
        const intentId = req.body.intentId || req.body.packageIntentId;
        const durationMonthsParam = parseInt(req.body.durationMonths || '1', 10);

        let expectedAmount: Prisma.Decimal = new Prisma.Decimal(0);
        let durationMonths = durationMonthsParam;
        let targetPackageId: string = '';
        let intent: any = null;

        if (intentId) {
          intent = await prisma.subscriptionPackageIntent.findUnique({
            where: { id: intentId },
            include: { package: { include: { plan: true } } },
          });

          if (intent && intent.dormitoryId === dormitoryId && intent.status === 'PENDING_PAYMENT') {
            expectedAmount = intent.finalPayableAmount;
            durationMonths = intent.durationMonthsSnapshot;
            targetPackageId = intent.packageId;
          } else {
            // Provided intent is expired, succeeded, or from another dorm; look for an active pending intent
            const activeIntent = await prisma.subscriptionPackageIntent.findFirst({
              where: {
                dormitoryId,
                durationMonthsSnapshot: durationMonthsParam,
                status: 'PENDING_PAYMENT',
              },
              orderBy: { createdAt: 'desc' },
              include: { package: { include: { plan: true } } },
            });

            if (activeIntent) {
              intent = activeIntent;
              expectedAmount = intent.finalPayableAmount;
              durationMonths = intent.durationMonthsSnapshot;
              targetPackageId = intent.packageId;
            } else {
              // Intent is stale/expired and no active pending intent found; fall back to server package computation
              intent = null;
            }
          }
        }

        if (!intent) {
          const pkg = await prisma.subscriptionPackage.findFirst({
            where: { durationMonths: durationMonthsParam, enabled: true },
          });
          if (!pkg || !pkg.price) {
            throw new AppError('ไม่พบข้อมูลแพ็กเกจสำหรับระยะเวลานี้', 400, 'PACKAGE_NOT_FOUND');
          }
          targetPackageId = pkg.id;

          const promoCodeParam = req.body.promoCode ? String(req.body.promoCode).trim().toUpperCase() : null;
          if (promoCodeParam) {
            const promo = await prisma.promoCode.findFirst({
              where: { normalizedCode: promoCodeParam, enabled: true },
            });
            if (promo && promo.benefitType === 'PERCENT_DISCOUNT') {
              const discountPercent = Number(promo.benefitValue || 10);
              const rawPrice = Number(pkg.price);
              const discountAmount = (rawPrice * discountPercent) / 100;
              expectedAmount = new Prisma.Decimal(Math.max(0, rawPrice - discountAmount).toFixed(2));
            } else {
              expectedAmount = pkg.price;
            }
          } else {
            expectedAmount = pkg.price;
          }
        }

        // Step D: Verify slip through SlipOK-ready verifier using sanitized buffer
        const verification = await subscriptionSlipVerifier.verify({
          slipBuffer: secured.buffer,
          originalFilename: file.originalname,
          mimeType: secured.mimeType,
          expectedAmount,
          dormitoryId,
          userId,
          packageIntentId: intent?.id,
        });

        // Step E: Persist sanitized slip image to storage
        const storageDir = path.join(process.cwd(), 'uploads', 'private', 'slips', 'subscription');
        if (!fs.existsSync(storageDir)) {
          fs.mkdirSync(storageDir, { recursive: true });
        }
        const filename = `sub-slip-${dormitoryId}-${Date.now()}-${verification.payloadHash.slice(0, 8)}${secured.extension}`;
        const fullPath = path.join(storageDir, filename);
        fs.writeFileSync(fullPath, secured.buffer);
        const relativePath = path.join('uploads', 'private', 'slips', 'subscription', filename).replace(/\\/g, '/');

      const now = new Date();
      const orderId = `HP-SUB-${Date.now().toString().slice(-6)}`;
      const receiptNumber = `RCP-SUB-${Date.now().toString().slice(-6)}`;

      const result = await prisma.$transaction(async (tx) => {
        const dorm = await tx.dormitory.findUnique({
          where: { id: dormitoryId },
          select: { id: true, createdByUserId: true },
        });

        const isDirectAccess = userId.startsWith('ag_user_') || userId.startsWith('ag_');
        const cleanUserId = userId.replace(/^ag_user_|^ag_/, '');
        const isPureActorUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanUserId);

        let validActorId: string | null = null;
        if (isPureActorUuid) {
          const userExists = await tx.user.findUnique({ where: { id: cleanUserId }, select: { id: true } });
          if (userExists) {
            validActorId = cleanUserId;
          }
        }

        const authoritativeRedeemedBy = (isDirectAccess && dorm?.createdByUserId)
          ? dorm.createdByUserId
          : (validActorId || dorm?.createdByUserId || (intent?.userId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(intent.userId) ? intent.userId : '00000000-0000-4000-8000-000000000001'));

        const validPaymentEvidenceUserId = isPureActorUuid
          ? cleanUserId
          : (dorm?.createdByUserId || (intent?.userId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(intent.userId) ? intent.userId : '00000000-0000-4000-8000-000000000001'));

        const proPlan = await tx.subscriptionPlan.findUniqueOrThrow({ where: { code: 'PAID' } });

        const currentSub = await tx.dormitorySubscription.findUnique({
          where: { dormitoryId },
          include: { plan: true },
        });

        const isCurrentlyPro = currentSub && currentSub.plan?.code === 'PAID' && currentSub.expiresAt && currentSub.expiresAt > now;
        const previousExpiresAt = isCurrentlyPro ? currentSub.expiresAt : now;
        const previousDaysLeft = isCurrentlyPro
          ? Math.max(0, Math.ceil((currentSub.expiresAt.getTime() - now.getTime()) / 86400000))
          : 0;

        const newExpiresAt = addCalendarMonths(previousExpiresAt, durationMonths);
        const newDaysLeft = Math.max(0, Math.ceil((newExpiresAt.getTime() - now.getTime()) / 86400000));
        const daysAdded = newDaysLeft - previousDaysLeft;

        // Upsert subscription
        const updatedSub = await tx.dormitorySubscription.upsert({
          where: { dormitoryId },
          create: {
            dormitoryId,
            planId: proPlan.id,
            status: 'ACTIVE',
            startedAt: now,
            expiresAt: newExpiresAt,
          },
          update: {
            planId: proPlan.id,
            status: 'ACTIVE',
            expiresAt: newExpiresAt,
            updatedAt: now,
          },
        });

        // Record history
        await tx.subscriptionStatusHistory.create({
          data: {
            subscriptionId: updatedSub.id,
            dormitoryId,
            previousPlanId: currentSub?.planId || null,
            newPlanId: proPlan.id,
            previousStatus: currentSub?.status || null,
            newStatus: 'ACTIVE',
            reason: 'SUBSCRIPTION_PAYMENT_VERIFIED',
            actorId: validActorId,
          },
        });

        // Handle intent completion
        if (intent) {
          await tx.subscriptionPackageIntent.update({
            where: { id: intent.id },
            data: { status: 'COMPLETED' },
          });

          if (intent.coinApplied > 0) {
            const coinDebitUserId = intent.userId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(intent.userId)
              ? intent.userId
              : (dorm?.createdByUserId || userId);
            await coinWalletService.debitWallet(
              coinDebitUserId,
              intent.coinApplied,
              'SUBSCRIPTION_DEBIT',
              'SUBSCRIPTION_PACKAGE_INTENT',
              intent.id,
              `ชำระค่าแพ็กเกจ HorPlus PRO (${durationMonths} เดือน)`,
              `sub-slip-coin-${intent.id}`,
              tx
            );
          }

          if (intent.promoCodeSnapshot) {
            const promo = await tx.promoCode.findFirst({
              where: { normalizedCode: intent.promoCodeSnapshot.toUpperCase() },
            });
            if (promo) {
              const existingRedemption = await tx.promoRedemption.findFirst({
                where: {
                  promoCodeId: promo.id,
                  dormitoryId,
                },
              });
              if (!existingRedemption) {
                await tx.promoCode.update({
                  where: { id: promo.id },
                  data: { currentRedemptionsCount: { increment: 1 } },
                });
                await tx.promoRedemption.create({
                  data: {
                    promoCodeId: promo.id,
                    dormitoryId,
                    subscriptionId: updatedSub.id,
                    redeemedBy: authoritativeRedeemedBy,
                    previousExpiresAt,
                    newExpiresAt,
                  },
                });
              } else {
                await tx.promoRedemption.update({
                  where: { id: existingRedemption.id },
                  data: {
                    subscriptionId: updatedSub.id,
                    previousExpiresAt,
                    newExpiresAt,
                  },
                });
              }
            }
          }
        } else if (req.body.promoCode) {
          const directCode = String(req.body.promoCode).trim().toUpperCase();
          const promo = await tx.promoCode.findFirst({
            where: { normalizedCode: directCode, enabled: true },
          });
          if (promo) {
            const existingRedemption = await tx.promoRedemption.findFirst({
              where: {
                promoCodeId: promo.id,
                dormitoryId,
              },
            });
            if (!existingRedemption) {
              await tx.promoCode.update({
                where: { id: promo.id },
                data: { currentRedemptionsCount: { increment: 1 } },
              });
              await tx.promoRedemption.create({
                data: {
                  promoCodeId: promo.id,
                  dormitoryId,
                  subscriptionId: updatedSub.id,
                  redeemedBy: authoritativeRedeemedBy,
                  previousExpiresAt,
                  newExpiresAt,
                },
              });
            } else {
              await tx.promoRedemption.update({
                where: { id: existingRedemption.id },
                data: {
                  subscriptionId: updatedSub.id,
                  previousExpiresAt,
                  newExpiresAt,
                },
              });
            }
          }
        }

        // Record Payment Evidence
        await tx.subscriptionPaymentEvidence.create({
          data: {
            dormitoryId,
            userId: validPaymentEvidenceUserId,
            packageIntentId: intent?.id || null,
            packageId: targetPackageId,
            amount: expectedAmount,
            durationMonths,
            daysAdded,
            slipObjectKey: relativePath,
            payloadHash: verification.payloadHash,
            verificationStatus: 'VERIFIED',
            verifierProvider: verification.provider,
            receiptNumber,
          },
        });

        return {
          orderId,
          receiptNumber,
          planName: 'HORPLUS PRO',
          durationMonths,
          daysAdded,
          previousDaysLeft,
          newDaysLeft,
          previousExpiryDate: formatThaiDate(previousExpiresAt),
          newExpiryDate: formatThaiDate(newExpiresAt),
          paidAmount: expectedAmount.toFixed(2),
          paidAt: now.toISOString(),
        };
      });

      return res.json({
        success: true,
        message: 'ชำระเงินและเปิดใช้งานแพ็กเกจ HORPLUS PRO สำเร็จ',
        data: result,
      });
    } catch (err) {
      next(err);
    } finally {
      if (lockKey) {
        await distributedRateLimiterStore.releaseLock(lockKey, requestId);
      }
    }
  });

  return router;
}

