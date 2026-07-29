import { z } from 'zod';

export const CreateUploadIntentSchema = z.object({
  billId: z.string().min(1, 'Bill ID จำเป็นต้องระบุ'),
  fileName: z.string().min(1, 'ชื่อไฟล์จำเป็นต้องระบุ'),
  mimeType: z.string().refine(
    (val) => ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(val),
    'ประเภทไฟล์ต้องเป็น image/jpeg, image/png, image/webp หรือ application/pdf เท่านั้น'
  ),
  fileSize: z.number().int().positive().max(10 * 1024 * 1024, 'ขนาดไฟล์ต้องไม่เกิน 10MB'),
});

export const ConfirmEvidenceSchema = z.object({
  uploadIntentId: z.string().min(1, 'Upload Intent ID จำเป็นต้องระบุ'),
  sha256: z.string().length(64, 'ค่า SHA-256 ต้องมีความยาว 64 อักขระ'),
  transactionReference: z.string().optional(),
  qrPayloadHash: z.string().optional(),
});

export const CreateManualPaymentSchema = z.object({
  billId: z.string().min(1, 'Bill ID จำเป็นต้องระบุ'),
  method: z.enum(['cash', 'bank_transfer', 'promptpay', 'other'], {
    invalid_type_error: 'รูปแบบการชำระเงินไม่ถูกต้อง',
  }),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'จำนวนเงินไม่ถูกต้อง'),
  paidAt: z.string().optional(),
  receivedByUserId: z.string().optional(),
  evidenceId: z.string().optional(),
  transactionReference: z.string().optional(),
  note: z.string().optional(),
  approveImmediately: z.boolean().default(false),
});

export const ApprovePaymentSchema = z.object({
  version: z.number().int().optional(),
  note: z.string().optional(),
});

export const RejectPaymentSchema = z.object({
  reason: z.string().min(1, 'เหตุผลในการปฏิเสธจำเป็นต้องระบุ'),
  version: z.number().int().optional(),
});

export const CancelPaymentSchema = z.object({
  reason: z.string().min(1, 'เหตุผลในการยกเลิกจำเป็นต้องระบุ'),
  version: z.number().int().optional(),
});

export const VerifyPaymentSchema = z.object({
  provider: z.enum(['manual', 'mock', 'slipok']).default('manual'),
  evidenceId: z.string().optional(),
});

export const PaymentFilterSchema = z.object({
  billingCycleId: z.string().optional(),
  status: z.string().optional(),
  method: z.string().optional(),
  channel: z.string().optional(),
  buildingId: z.string().optional(),
  roomId: z.string().optional(),
  tenantId: z.string().optional(),
  billId: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.string().optional(),
});

export const ReceiptFilterSchema = z.object({
  billingCycleId: z.string().optional(),
  paymentMethod: z.string().optional(),
  buildingId: z.string().optional(),
  roomId: z.string().optional(),
  tenantId: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.string().optional(),
});
