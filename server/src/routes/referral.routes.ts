/**
 * Referral & Coin Wallet API Routes (LOCAL-07 Master)
 * @license Apache-2.0
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { referralService } from '../services/referral.service.js';
import { coinWalletService } from '../services/coin-wallet.service.js';
import { AuthenticationService } from '../services/auth.service.js';
import { createRequireSessionMiddleware } from '../middleware/require-session.js';

const validateReferralSchema = z.object({
  code: z.string().min(6).max(6),
});

export function createReferralRouter(authService: AuthenticationService): Router {
  const router = Router();
  const requireSession = createRequireSessionMiddleware(authService);

  /**
   * GET /api/v1/referral/me
   * Get authenticated user's own referral code, share link, and usage count
   */
  router.get('/me', requireSession, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.auth!.userId;
      const data = await referralService.getOrCreateUserReferralCode(userId);
      res.json({
        success: true,
        data,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/v1/referral/validate
   * Validate and bind an inviter's referral code to current authenticated user
   */
  router.post('/validate', requireSession, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.auth!.userId;
      const { code } = validateReferralSchema.parse(req.body);
      const result = await referralService.validateAndBindReferral(userId, code);
      res.json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/v1/referral/wallet
   * Get authenticated user's coin wallet balance and recent ledger history
   */
  router.get('/wallet', requireSession, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.auth!.userId;
      const balance = await coinWalletService.getBalance(userId);
      const ledger = await coinWalletService.getLedgerEntries(userId, 20);

      // Also check for pending provisional referral coin
      const attribution = await referralService.getAttributionForUser(userId);
      const provisionalCoin = attribution && attribution.status === 'PENDING' ? attribution.provisionalCoinGranted : 0;

      res.json({
        success: true,
        data: {
          balance,
          provisionalCoin,
          totalAvailableCoin: balance + provisionalCoin,
          ledger,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export default createReferralRouter;
