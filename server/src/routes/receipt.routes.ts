import { Router } from 'express';
import { receiptService } from '../services/receipt.service.js';

export function createReceiptRouter() {
  const router = Router();

  router.get('/:receiptId', async (req, res) => {
    try {
      const dormitoryId = (req as any).dormitory?.id || (req.query.dormitoryId as string);
      if (!dormitoryId) return res.status(400).json({ error: 'Missing dormitoryId' });

      const receipt = await receiptService.getReceipt(dormitoryId, req.params.receiptId);
      res.json(receipt);
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  // Printing can just be served as a special view or we can let the frontend handle the HTML printing using the JSON data.
  // The prompt says "implement the printable HTML receipt as the primary MVP output". The frontend can fetch the receipt JSON and render an HTML print view.
  router.get('/:receiptId/print', async (req, res) => {
    try {
      const dormitoryId = (req as any).dormitory?.id || (req.query.dormitoryId as string);
      const receipt = await receiptService.getReceipt(dormitoryId, req.params.receiptId);
      res.json({ printUrl: `/tenant/receipt/${receipt.id}/print` }); // The frontend handles it
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  return router;
}
