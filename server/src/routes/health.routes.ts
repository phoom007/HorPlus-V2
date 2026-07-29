import { Router, Request, Response } from 'express';
import { checkLiveness, checkReadiness, getMetrics } from '../services/health.service.js';

export const healthRouter = Router();

healthRouter.get('/liveness', async (_req: Request, res: Response) => {
  const status = await checkLiveness();
  res.status(200).json(status);
});

healthRouter.get('/readiness', async (_req: Request, res: Response) => {
  const { isReady, data } = await checkReadiness();
  const statusCode = isReady ? 200 : 503;
  res.status(statusCode).json(data);
});

healthRouter.get('/metrics', (_req: Request, res: Response) => {
  const metrics = getMetrics();
  res.status(200).json(metrics);
});
