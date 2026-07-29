import { Router, Request, Response } from 'express';
import { AuthenticationService } from '../services/auth.service.js';
import { OccupancyService } from '../services/occupancy.service.js';
import { createRequireSessionMiddleware } from '../middleware/require-session.js';

export function createOccupancyRouter(
  authService: AuthenticationService,
  occupancyService: OccupancyService
): Router {
  const router = Router();
  const requireSession = createRequireSessionMiddleware(authService);

  const getDormitoryId = (req: Request): string => {
    return (req.headers['x-dormitory-id'] as string) || req.auth?.dormitoryId || 'dorm-001';
  };

  const handleServiceError = (res: Response, err: any, req: Request) => {
    const statusCode = err.statusCode || err.status || 500;
    res.status(statusCode).json({
      error: {
        code: err.code || 'OCCUPANCY_OPERATION_FAILED',
        message: err.message || 'เกิดข้อผิดพลาดในการดึงข้อมูลอัตราการเข้าพัก',
        fieldErrors: err.fieldErrors || null,
        requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
        timestamp: new Date().toISOString(),
      },
    });
  };

  // GET /api/v1/occupancy/summary
  router.get('/summary', requireSession, async (req: Request, res: Response) => {
    try {
      const dormId = getDormitoryId(req);
      const summary = await occupancyService.getOccupancySummary(dormId);
      res.json({ data: summary });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // GET /api/v1/occupancy/floor-plan
  router.get('/floor-plan', requireSession, async (req: Request, res: Response) => {
    try {
      const dormId = getDormitoryId(req);
      const buildingId = req.query.buildingId as string;
      const floorPlan = await occupancyService.getFloorPlanView(dormId, buildingId);
      res.json({ data: floorPlan });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  return router;
}
