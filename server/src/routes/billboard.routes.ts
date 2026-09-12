/**
 * @license Apache-2.0
 * Platform Billboard Carousel Routes
 * Persists and synchronizes 16:9 announcements across all client surfaces.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { getPrismaClient } from '../db/prisma.js';
import { AppError } from '../types/index.js';

const createBillboardSchema = z.object({
  imageUrl: z.string().min(1, 'ต้องระบุรูปภาพ'),
  title: z.string().min(1, 'ต้องระบุหัวข้อ'),
  description: z.string().optional().default(''),
  tag: z.string().optional().default('ป้ายประชาสัมพันธ์'),
});

const DEFAULT_BILLBOARD_ITEMS = [
  {
    imageUrl: 'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=1600&auto=format&fit=crop&q=80',
    title: 'ระบบบริหารจัดการหอพัก HORPLUS ครบวงจร',
    description: 'จัดการห้องพัก ออกบิลค่าน้ำค่าไฟ และส่งแจ้งเตือนผู้เช่าผ่าน LINE อัตโนมัติ สะดวกรวดเร็ว',
    tag: 'ป้ายประชาสัมพันธ์',
    sortOrder: 1,
  },
  {
    imageUrl: 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=1600&auto=format&fit=crop&q=80',
    title: 'แพ็กเกจ HORPLUS PRO 12 เดือน เพียง ฿1,799',
    description: 'เฉลี่ยเพียง ฿150 ต่อเดือน รองรับได้ถึง 150 ห้องพัก พร้อมโควตา LINE 300 ข้อความต่อเดือน',
    tag: 'โปรโมชั่นสุดคุ้ม',
    sortOrder: 2,
  },
  {
    imageUrl: 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=1600&auto=format&fit=crop&q=80',
    title: 'ตรวจสลิปโอนเงินอัตโนมัติ แม่นยำ รวดเร็ว',
    description: 'ลดภาระงานตรวจสอบสลิป หมดปัญหาสลิปปลอมหรือสลิปใช้ซ้ำ ด้วยเทคโนโลยีตรวจสอบระดับสากล',
    tag: 'ฟีเจอร์เด่น',
    sortOrder: 3,
  },
  {
    imageUrl: 'https://images.unsplash.com/photo-1582407947304-fd86f028f716?w=1600&auto=format&fit=crop&q=80',
    title: 'ชวนเพื่อนเจ้าของหอพัก รับเหรียญส่วนลดทันที',
    description: 'แชร์รหัสแนะนำเพื่อน เมื่อเพื่อนสมัครใช้งาน รับเหรียญสะสมใช้เป็นส่วนลดค่าบริการได้เลย',
    tag: 'สิทธิพิเศษ',
    sortOrder: 4,
  },
];

export function createBillboardRouter(): Router {
  const router = Router();
  const prisma = getPrismaClient();

  /**
   * Ensure default billboards exist
   */
  async function ensureDefaultBillboards() {
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

  /**
   * GET /api/v1/billboard
   * Returns all active billboards
   */
  router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      await ensureDefaultBillboards();
      const billboards = await prisma.platformBillboard.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      });

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
   * Add a new 16:9 billboard
   */
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
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
   * Delete a billboard (enforcing at least 1 remains)
   */
  router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
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
   * Reset billboards to standard default items
   */
  router.post('/reset', async (_req: Request, res: Response, next: NextFunction) => {
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
