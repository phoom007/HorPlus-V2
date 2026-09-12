import fs from 'fs';
import path from 'path';
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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

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

  if (authService) {
    router.use(authService.requireAuth());
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

  // GET /api/v1/subscription/current
  router.get('/current', async (req: Request, res: Response, next: NextFunction) => {
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

      return res.json({
        data: {
          ...subscription,
          slipsChecked,
          roomCount
        }
      });
    } catch (err) {
      next(err);
    }
  });

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

  // POST /api/v1/subscription/payment/slip
  router.post('/payment/slip', upload.single('file'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const file = req.file;
      if (!file) {
        throw new AppError('กรุณาแนบไฟล์รูปภาพสลิปชำระเงิน', 400, 'SLIP_FILE_REQUIRED');
      }

      const context = (req as any).dormitoryContext || (await resolveAuthoritativeDormitoryContext(req));
      const dormitoryId = context.dormitoryId;
      const userId = context.userId;
      const prisma = getPrismaClient();

      const intentId = req.body.intentId || req.body.packageIntentId;
      const durationMonthsParam = parseInt(req.body.durationMonths || '1', 10);

      let expectedAmount: Prisma.Decimal;
      let durationMonths = durationMonthsParam;
      let targetPackageId: string;
      let intent: any = null;

      if (intentId) {
        intent = await prisma.subscriptionPackageIntent.findUnique({
          where: { id: intentId },
          include: { package: { include: { plan: true } } },
        });
        if (!intent || intent.status !== 'PENDING_PAYMENT') {
          throw new AppError('รายการสั่งซื้อไม่ถูกต้องหรือหมดอายุแล้ว กรุณาทำรายการใหม่อีกครั้ง', 400, 'INVALID_OR_EXPIRED_INTENT');
        }
        expectedAmount = intent.finalPayableAmount;
        durationMonths = intent.durationMonthsSnapshot;
        targetPackageId = intent.packageId;
      } else {
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

      // Verify slip through SlipOK-ready verifier
      const verification = await subscriptionSlipVerifier.verify({
        slipBuffer: file.buffer,
        originalFilename: file.originalname,
        mimeType: file.mimetype,
        expectedAmount,
        dormitoryId,
        userId,
        packageIntentId: intent?.id,
      });

      // Persist slip image to storage
      const storageDir = path.join(process.cwd(), 'uploads', 'private', 'slips', 'subscription');
      if (!fs.existsSync(storageDir)) {
        fs.mkdirSync(storageDir, { recursive: true });
      }
      const ext = file.mimetype === 'image/jpeg' ? '.jpg' : file.mimetype === 'image/webp' ? '.webp' : '.png';
      const filename = `sub-slip-${dormitoryId}-${Date.now()}-${verification.payloadHash.slice(0, 8)}${ext}`;
      const fullPath = path.join(storageDir, filename);
      fs.writeFileSync(fullPath, file.buffer);
      const relativePath = path.join('uploads', 'private', 'slips', 'subscription', filename).replace(/\\/g, '/');

      const now = new Date();
      const orderId = `HP-SUB-${Date.now().toString().slice(-6)}`;
      const receiptNumber = `RCP-SUB-${Date.now().toString().slice(-6)}`;

      const result = await prisma.$transaction(async (tx) => {
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
            actorId: userId,
          },
        });

        // Handle intent completion
        if (intent) {
          await tx.subscriptionPackageIntent.update({
            where: { id: intent.id },
            data: { status: 'COMPLETED' },
          });

          if (intent.coinApplied > 0) {
            await coinWalletService.debitWallet(
              userId,
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
                    redeemedBy: userId,
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
                  redeemedBy: userId,
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
            userId,
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

        // Record in PaymentEvidenceVerification for system-wide transRef deduplication (F-1)
        await tx.paymentEvidenceVerification.create({
          data: {
            dormitoryId,
            provider: verification.provider,
            status: 'VERIFIED',
            claimedTransferAt: verification.transferredAt,
            verifiedTransferAt: verification.transferredAt,
            verifiedAmount: expectedAmount,
            providerReference: verification.providerReference,
            payloadHash: verification.payloadHash,
            verifiedAt: now,
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
    }
  });

  return router;
}

