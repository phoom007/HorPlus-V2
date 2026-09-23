/**
 * @license Apache-2.0
 * Platform Billboard Carousel Routes
 * Persists and synchronizes 16:9 announcements across all client surfaces.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { getPrismaClient } from '../db/prisma.js';
import { AuthenticationService } from '../services/auth.service.js';
import { createRequireSessionMiddleware } from '../middleware/require-session.js';
import { createCsrfMiddleware } from '../middleware/csrf.js';
import { AppError } from '../types/index.js';

const createBillboardSchema = z.object({
  imageUrl: z.string().min(1, 'ต้องระบุรูปภาพ'),
  title: z.string().min(1, 'ต้องระบุหัวข้อ'),
  description: z.string().optional().default(''),
  tag: z.string().optional().default('ป้ายประชาสัมพันธ์'),
});

export const DEFAULT_BILLBOARD_ITEMS = [
  {
    imageUrl: '/billboards/1.jpg',
    title: 'หอพลัส+ เปิดทดลองฟรี 3 เดือน',
    description: 'ตรวจสลิปอัตโนมัติ แจ้งเตือน LINE ทำสัญญา ออกบิล แจ้งซ่อม ครอบคลุมครบวงจร',
    tag: 'ทดลองฟรี 3 เดือน',
    sortOrder: 1,
  },
  {
    imageUrl: '/billboards/2.jpg',
    title: 'ราคาแพ็กเกจ HORPLUS โปรโมชั่นประจำปี 2569',
    description: 'โปรโมชั่นพิเศษ PRO 1 เดือน 0 บาท และแพ็กเกจรายปีสุดคุ้มสำหรับเจ้าของหอพัก',
    tag: 'โปรโมชั่นปี 2569',
    sortOrder: 2,
  },
  {
    imageUrl: '/billboards/3.jpg',
    title: 'ระบบบริหารจัดการหอพักอัจฉริยะครบวงจร',
    description: 'ดูภาพรวมยอดค้างชำระ สถิติรายรับรอบปี และบริหารจัดการผู้เช่าได้ทุกอุปกรณ์',
    tag: 'ฟังก์ชันครบวงจร',
    sortOrder: 3,
  },
  {
    imageUrl: '/billboards/4.jpg',
    title: 'กรอกโค้ด "HORPLUS" ทดลอง PRO ฟรี 2 เดือน',
    description: 'รับสิทธิ์ใช้งานฟังก์ชัน PRO ฟรี 2 เดือนทันที จำกัด 100 สิทธิ์แรกเท่านั้น',
    tag: 'โค้ดพิเศษจำกัดสิทธิ์',
    sortOrder: 4,
  },
];

/**
 * Ensure default billboards exist in the database (Bootstrap utility)
 */
export async function ensureDefaultBillboards() {
  const prisma = getPrismaClient();
  const count = await prisma.platformBillboard.count({ where: { isActive: true } });
  if (count === 0) {
    for (const item of DEFAULT_BILLBOARD_ITEMS) {
      await prisma.platformBillboard.create({
        data: {
          ...item,
          isActive: true,
        },
      });
    }
  }
}

export function createBillboardRouter(authService?: AuthenticationService): Router {
  const router = Router();
  const prisma = getPrismaClient();

  const requireSession = authService ? createRequireSessionMiddleware(authService) : null;
  const csrfMiddleware = authService ? createCsrfMiddleware(authService) : null;

  const requireMutationAuth = async (req: Request, res: Response, next: NextFunction) => {
    if (!requireSession || !csrfMiddleware) {
      return res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'กรุณาเข้าสู่ระบบ' },
      });
    }

    return requireSession(req, res, () => {
      return csrfMiddleware(req, res, () => {
        // HorPlus platform billboards are global promotional announcements across all dormitories.
        // There is currently no platform admin role in the system.
        // As per audit SEC-06 and PO instructions, deny modification routes until platform role is introduced.
        return res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: 'ไม่มีสิทธิ์จัดการป้ายประชาสัมพันธ์ของแพลตฟอร์ม',
          },
        });
      });
    });
  };

  /**
   * GET /api/v1/billboard
   * Returns all active billboards (Strictly read-only, no write/delete side-effects)
   */
  router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const billboards = await prisma.platformBillboard.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      });

      if (billboards.length === 0) {
        return res.json({
          success: true,
          data: DEFAULT_BILLBOARD_ITEMS.map((b, idx) => ({
            id: `default-${idx + 1}`,
            imageUrl: b.imageUrl,
            title: b.title,
            description: b.description || '',
            tag: b.tag || 'ป้ายประชาสัมพันธ์',
          })),
        });
      }

      res.json({
        success: true,
        data: billboards.map((b) => ({
          id: b.id,
          imageUrl: b.imageUrl,
          title: b.title,
          description: b.description || '',
          tag: b.tag || 'ป้ายประชาสัมพันธ์',
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/v1/billboard
   * Add a new 16:9 billboard (Protected: requires session + CSRF + admin)
   */
  router.post('/', requireMutationAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = createBillboardSchema.parse(req.body);
      const maxSortOrder = await prisma.platformBillboard.aggregate({
        _max: { sortOrder: true },
      });
      const nextSortOrder = (maxSortOrder._max.sortOrder || 0) + 1;

      const created = await prisma.platformBillboard.create({
        data: {
          imageUrl: body.imageUrl,
          title: body.title,
          description: body.description,
          tag: body.tag,
          sortOrder: nextSortOrder,
          isActive: true,
        },
      });

      res.status(201).json({
        success: true,
        message: 'เพิ่มป้ายประชาสัมพันธ์สำเร็จ',
        data: {
          id: created.id,
          imageUrl: created.imageUrl,
          title: created.title,
          description: created.description || '',
          tag: created.tag || 'ป้ายประชาสัมพันธ์',
        },
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * DELETE /api/v1/billboard/:id
   * Delete a billboard (Protected: requires session + CSRF + admin)
   */
  router.delete('/:id', requireMutationAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const count = await prisma.platformBillboard.count({ where: { isActive: true } });
      if (count <= 1) {
        throw new AppError('จำเป็นต้องมีป้ายประชาสัมพันธ์อย่างน้อย 1 ป้าย', 400, 'MINIMUM_BILLBOARDS_REQUIRED');
      }

      await prisma.platformBillboard.delete({
        where: { id },
      });

      res.json({
        success: true,
        message: 'ลบป้ายประชาสัมพันธ์สำเร็จ',
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/v1/billboard/reset
   * Reset billboards to standard default items (Protected: requires session + CSRF + admin)
   */
  router.post('/reset', requireMutationAuth, async (_req: Request, res: Response, next: NextFunction) => {
    try {
      await prisma.platformBillboard.deleteMany({});
      for (const item of DEFAULT_BILLBOARD_ITEMS) {
        await prisma.platformBillboard.create({
          data: {
            ...item,
            isActive: true,
          },
        });
      }

      const refreshed = await prisma.platformBillboard.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      });

      res.json({
        success: true,
        message: 'รีเซ็ตเป็นป้ายประชาสัมพันธ์มาตรฐานเริ่มต้นแล้ว',
        data: refreshed.map((b) => ({
          id: b.id,
          imageUrl: b.imageUrl,
          title: b.title,
          description: b.description || '',
          tag: b.tag || 'ป้ายประชาสัมพันธ์',
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
