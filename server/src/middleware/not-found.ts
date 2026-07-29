import { Request, Response, NextFunction } from 'express';
import { NotFoundError } from '../types/index.js';

export function notFoundMiddleware(req: Request, res: Response, next: NextFunction): void {
  next(new NotFoundError());
}
