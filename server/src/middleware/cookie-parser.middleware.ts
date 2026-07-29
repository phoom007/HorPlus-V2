import { Request, Response, NextFunction } from 'express';

export function cookieParserMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const cookieHeader = req.headers.cookie;
  req.cookies = req.cookies || {};

  if (cookieHeader) {
    const pairs = cookieHeader.split(';');
    for (const pair of pairs) {
      const idx = pair.indexOf('=');
      if (idx > 0) {
        const key = pair.substring(0, idx).trim();
        const val = pair.substring(idx + 1).trim();
        try {
          req.cookies[key] = decodeURIComponent(val);
        } catch {
          req.cookies[key] = val;
        }
      }
    }
  }

  next();
}
