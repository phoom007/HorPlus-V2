import { Router, Request, Response } from 'express';
import { receiptService } from '../services/receipt.service.js';
import { AuthenticationService } from '../services/auth.service.js';
import { getPrismaClient } from '../db/prisma.js';

const prisma = getPrismaClient();

export function createReceiptRouter(authService: AuthenticationService) {
  const router = Router();
  const requireAuth = authService.requireAuth();

  // Helper to ensure tenant authorization
  const ensureTenant = async (req: Request, res: Response, dormitoryId: string) => {
    const auth = (req as any).auth;
    const membership = auth?.memberships?.find((m: any) => 
      m.dormitoryId === dormitoryId && (
        m.role === 'tenant' || m.roleCode?.toLowerCase() === 'tenant' || m.roleId === 'role-tenant'
      )
    );
    if (!membership) return null;
    const tenant = await prisma.tenant.findFirst({ where: { linkedUserId: auth.userId, dormitoryId } });
    return tenant;
  };

  // Helper to ensure owner/manager authorization
  const ensureOwnerOrManager = (req: Request, res: Response, dormitoryId: string) => {
    const auth = (req as any).auth;
    return auth?.memberships?.find((m: any) => 
      m.dormitoryId === dormitoryId && (
        m.role === 'owner' || m.role === 'manager' ||
        m.roleCode?.toLowerCase() === 'owner' || m.roleCode?.toLowerCase() === 'manager' ||
        m.roleId === 'role-owner' || m.roleId === 'role-manager'
      )
    );
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
        if (tenant) {
          if (receiptRecord.billId) {
            const bill = await prisma.bill.findUnique({ where: { id: receiptRecord.billId } });
            if (bill) {
              const tenantContracts = await prisma.contract.findMany({ where: { tenantId: tenant.id }, select: { id: true } });
              const tenantContractIds = tenantContracts.map(c => c.id);
              if (bill.tenantId === tenant.id || (bill.contractId && tenantContractIds.includes(bill.contractId))) {
                authorized = true;
              }
            }
          } else if (receiptRecord.paymentGroupId) {
            const targets = await prisma.combinedPaymentGroupBillTarget.findMany({
              where: { paymentGroupId: receiptRecord.paymentGroupId },
              include: { bill: true },
            });
            if (targets.some(t => t.bill.tenantId === tenant.id)) {
              authorized = true;
            }
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

  const handleReceiptHtml = async (req: Request, res: Response) => {
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
          if (receiptRecord.billId) {
            const bill = await prisma.bill.findUnique({ where: { id: receiptRecord.billId } });
            if (bill) {
              const tenantContracts = await prisma.contract.findMany({ where: { tenantId: tenant.id }, select: { id: true } });
              const tenantContractIds = tenantContracts.map(c => c.id);
              if (bill.tenantId === tenant.id || (bill.contractId && tenantContractIds.includes(bill.contractId))) {
                authorized = true;
              }
            }
          } else if (receiptRecord.paymentGroupId) {
            const targets = await prisma.combinedPaymentGroupBillTarget.findMany({
              where: { paymentGroupId: receiptRecord.paymentGroupId },
              include: { bill: true },
            });
            if (targets.some(t => t.bill.tenantId === tenant.id)) {
              authorized = true;
            }
          }
        }
      }

      if (!authorized) {
        return res.status(403).send('Forbidden');
      }

      // 1. Authoritative Snapshot Data (no live joins)
      const data = (receiptRecord.snapshotData as any) || {};
      
      // 2. Strict HTML Escaping Helper
      const escapeHTML = (str: any) => {
        if (str === null || str === undefined) return '-';
        return String(str)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');
      };

      const items = (data.items && Array.isArray(data.items) && data.items.length > 0)
        ? data.items
        : [{ description: 'ยอดชำระตามใบเสร็จเดิม', amount: data.total || '0.00', quantity: 1 }];

      const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Receipt ${escapeHTML(receiptRecord.receiptNumber)}</title>
  <style>
    @media print {
      @page { size: A4; margin: 20mm; }
      body { margin: 0; font-family: sans-serif; }
      .no-print { display: none; }
    }
    body { font-family: 'Sarabun', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #1e293b; max-width: 800px; margin: 40px auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; }
    .header { text-align: center; margin-bottom: 24px; }
    .header h1 { margin: 0; color: #4338ca; font-size: 24px; }
    .header p { margin: 4px 0 0; color: #64748b; font-size: 14px; font-weight: bold; }
    .void-banner { color: #dc2626; background: #fee2e2; border: 1px solid #f87171; text-align: center; font-weight: bold; padding: 12px; margin-bottom: 20px; border-radius: 8px; }
    .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px; font-size: 13px; }
    .meta-card { background: #f8fafc; padding: 16px; border-radius: 8px; border: 1px solid #e2e8f0; }
    .meta-card p { margin: 4px 0; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13px; }
    th, td { border: 1px solid #e2e8f0; padding: 10px 12px; text-align: left; }
    th { background: #f1f5f9; color: #334155; }
    .num { text-align: right; }
    .totals-area { margin-top: 16px; display: flex; flex-direction: column; align-items: flex-end; font-size: 14px; }
    .total-row { display: flex; justify-content: space-between; width: 280px; padding: 4px 0; }
    .grand-total { font-weight: 900; font-size: 16px; color: #4338ca; border-top: 2px solid #cbd5e1; padding-top: 8px; margin-top: 4px; }
  </style>
</head>
<body>
  <div class="no-print" style="text-align: right; margin-bottom: 20px;">
    <button onclick="window.print()" style="padding: 8px 16px; background: #4f46e5; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">พิมพ์ใบเสร็จ (Print Receipt)</button>
  </div>
  ${receiptRecord.isVoided ? `<div class="void-banner">ยกเลิกแล้ว (VOIDED): ${escapeHTML(receiptRecord.voidReason || 'ไม่มีระบุเหตุผล')}</div>` : ''}
  <div class="header">
    <h1>ใบเสร็จรับเงิน (RECEIPT)</h1>
    <p>เลขที่ใบเสร็จ: ${escapeHTML(receiptRecord.receiptNumber)}</p>
  </div>
  <div class="meta-grid">
    <div class="meta-card">
      <p><strong>ผู้รับเงิน / หอพัก:</strong> ${escapeHTML(data.dormitoryName)}</p>
      <p><strong>เลขประจำตัวผู้เสียภาษี:</strong> ${escapeHTML(data.dormitoryTaxId)}</p>
      <p><strong>ที่อยู่:</strong> ${escapeHTML(data.dormitoryAddress)}</p>
      <p><strong>โทรศัพท์:</strong> ${escapeHTML(data.dormitoryPhone)}</p>
    </div>
    <div class="meta-card">
      <p><strong>ผู้เช่า:</strong> ${escapeHTML(data.tenantName)}</p>
      <p><strong>ห้องพัก:</strong> ${escapeHTML(data.roomNumber)}</p>
      <p><strong>อ้างอิงบิล:</strong> ${escapeHTML(data.billNumber)}</p>
      <p><strong>ช่องทางชำระเงิน:</strong> ${escapeHTML(data.paymentMethod)}</p>
      <p><strong>วันที่ออกใบเสร็จ:</strong> ${new Date(receiptRecord.issuedAt).toLocaleDateString('th-TH')}</p>
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th>ลำดับ</th>
        <th>รายการ</th>
        <th class="num">จำนวน</th>
        <th class="num">จำนวนเงิน (บาท)</th>
      </tr>
    </thead>
    <tbody>
      ${items.map((i: any, idx: number) => `
        <tr>
          <td>${idx + 1}</td>
          <td>${escapeHTML(i.description)}</td>
          <td class="num">${escapeHTML(i.quantity || 1)}</td>
          <td class="num">${escapeHTML(i.amount)}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>
  <div class="totals-area">
    <div class="total-row"><span>ยอดรวมก่อนส่วนลด:</span><span>${escapeHTML(data.subtotal || data.total)} ฿</span></div>
    <div class="total-row"><span>ส่วนลด:</span><span>${escapeHTML(data.discount || '0.00')} ฿</span></div>
    <div class="total-row grand-total"><span>ยอดชำระสุทธิ:</span><span>${escapeHTML(data.total)} ฿</span></div>
  </div>
</body>
</html>
      `;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (err: any) {
      res.status(400).send(err?.message || 'Error generating receipt HTML');
    }
  };

  router.get('/:receiptId/html', requireAuth, handleReceiptHtml);
  router.get('/:receiptId/print', requireAuth, handleReceiptHtml);

  return router;
}
