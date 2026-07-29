import { Router, Request, Response } from 'express';
import { AuthenticationService } from '../services/auth.service.js';
import { createRequireSessionMiddleware } from '../middleware/require-session.js';

export function createUserRouter(authService: AuthenticationService): Router {
  const router = Router();
  const requireSession = createRequireSessionMiddleware(authService);

  // GET /api/v1/me
  router.get('/me', requireSession, async (req: Request, res: Response) => {
    const user = req.auth!.user;

    return res.status(200).json({
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          avatarUrl: user.avatarUrl,
          phone: user.phone,
          status: user.status,
          createdAt: user.createdAt,
        },
      },
    });
  });

  // GET /api/v1/me/memberships
  router.get('/me/memberships', requireSession, async (req: Request, res: Response) => {
    const memberships = req.auth!.memberships;

    return res.status(200).json({
      data: {
        memberships: memberships.map((m) => ({
          id: m.id,
          dormitoryId: m.dormitoryId,
          dormitoryName: m.dormitoryName || 'HorPlus Residence',
          roleCode: m.roleCode || 'OWNER',
          status: m.status,
          createdAt: m.createdAt,
        })),
      },
    });
  });

  return router;
}
