import { Router, Request, Response } from 'express';
import { receiptService } from '../services/receipt.service.js';
import { AuthenticationService } from '../services/auth.service.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export function createReceiptRouter(authService: AuthenticationService) {
  const router = Router();
  const requireAuth = authService.requireAuth();

  // Helper to ensure tenant authorization
  const ensureTenant = async (req: Request, res: Response, dormitoryId: string) => {
    const auth = (req as any).auth;
    const membership = auth.memberships.find((m: any) => m.dormitoryId === dormitoryId && m.role === 'tenant');
    if (!membership) return null;
    const tenant = await prisma.tenant.findFirst({ where: { linkedUserId: auth.userId, dormitoryId } });
    return tenant;
  };

  // Helper to ensure owner/manager authorization
  const ensureOwnerOrManager = (req: Request, res: Response, dormitoryId: string) => {
    const auth = (req as any).auth;
    return auth.memberships.find((m: any) => m.dormitoryId === dormitoryId && (m.role === 'owner' || m.role === 'manager'));
  };

  router.get('/:receiptId', requireAuth, async (req, res) => {
    try {
      const auth = (req as any).auth;
      const receiptId = req.params.receiptId;
      const receiptRecord = await prisma.receipt.findUnique({ where: { id: receiptId } });
      
      if (!receiptRecord) return res.status(404).json({ error: 'Receipt not found' });
      
      const dormitoryId = receiptRecord.dormitoryId;

      // Check authorization
      const isOwner = ensureOwnerOrManager(req, res, dormitoryId);
      let authorized = false;
      
      if (isOwner) {
        authorized = true;
      } else {
        const tenant = await ensureTenant(req, res, dormitoryId);
        // Tenant can only view if the receipt belongs to their bill
        if (tenant) {
          const bill = await prisma.bill.findUnique({ where: { id: receiptRecord.billId } });
          if (bill && bill.tenantId === tenant.id) {
            authorized = true;
          }
        }
      }

      if (!authorized) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const receipt = await receiptService.getReceipt(dormitoryId, receiptId);
      res.json(receipt);
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  router.get('/:receiptId/print', requireAuth, async (req, res) => {
    try {
      const auth = (req as any).auth;
      const receiptId = req.params.receiptId;
      const receiptRecord = await prisma.receipt.findUnique({ where: { id: receiptId } });
      
      if (!receiptRecord) return res.status(404).send('Receipt not found');
      
      const dormitoryId = receiptRecord.dormitoryId;
      const isOwner = ensureOwnerOrManager(req, res, dormitoryId);
      let authorized = false;
      
      if (isOwner) {
        authorized = true;
      } else {
        const tenant = await ensureTenant(req, res, dormitoryId);
        if (tenant) {
          const bill = await prisma.bill.findUnique({ where: { id: receiptRecord.billId } });
          if (bill && bill.tenantId === tenant.id) {
            authorized = true;
          }
        }
      }

      if (!authorized) {
        return res.status(403).send('Forbidden');
      }

      const receipt = await receiptService.getReceipt(dormitoryId, receiptId);
      const bill = await prisma.bill.findUnique({ where: { id: receiptRecord.billId }, include: { tenant: true, room: true } });
      
      const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Receipt ${receipt.receiptNumber}</title>
  <style>
    @media print {
      @page { size: A4; margin: 20mm; }
      body { margin: 0; font-family: sans-serif; }
      .no-print { display: none; }
    }
    body { font-family: 'Sarabun', sans-serif; color: #333; max-width: 800px; margin: 40px auto; padding: 20px; border: 1px solid #eee; }
    .header { text-align: center; margin-bottom: 30px; }
    .header h1 { margin: 0; color: #4F46E5; }
    .meta { display: flex; justify-content: space-between; margin-bottom: 20px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
    th { background: #f9fafb; }
    .total { font-weight: bold; font-size: 1.2em; text-align: right; }
  </style>
</head>
<body>
  <div class="no-print" style="text-align: right; margin-bottom: 20px;"><button onclick="window.print()">Print Receipt</button></div>
  <div class="header">
    <h1>ใบเสร็จรับเงิน (Receipt)</h1>
    <p>เลขที่: ${receipt.receiptNumber}</p>
  </div>
  <div class="meta">
    <div>
      <p><strong>ผู้รับเงิน:</strong> หอพัก ${dormitoryId}</p>
      <p><strong>วันที่รับชำระ:</strong> ${new Date(receipt.paidAt).toLocaleDateString('th-TH')}</p>
    </div>
    <div>
      <p><strong>ผู้เช่า:</strong> ${bill?.tenant?.name || '-'}</p>
      <p><strong>ห้อง:</strong> ${bill?.room?.roomNumber || '-'}</p>
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th>รายการ</th>
        <th>จำนวนเงิน (บาท)</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>ค่าเช่าและบริการตามใบแจ้งหนี้ ${bill?.id || ''}</td>
        <td>${receipt.amount.toString()}</td>
      </tr>
    </tbody>
  </table>
  <div class="total">ยอดชำระสุทธิ: ${receipt.amount.toString()} บาท</div>
</body>
</html>
      `;
      res.send(html);
    } catch (err: any) {
      res.status(400).send(err.message);
    }
  });

  return router;
}
