import { z } from 'zod';

export const CreateBillingCycleSchema = z.object({
  cycleCode: z.string().min(1, 'รหัสรอบบิลจำเป็นต้องระบุ').max(100),
  name: z.string().min(1, 'ชื่อรอบบิลจำเป็นต้องระบุ').max(255),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่เริ่มต้นต้องอยู่ในรูปแบบ YYYY-MM-DD'),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่สิ้นสุดต้องอยู่ในรูปแบบ YYYY-MM-DD'),
  billingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันออกบิลต้องอยู่ในรูปแบบ YYYY-MM-DD'),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันครบกำหนดชำระต้องอยู่ในรูปแบบ YYYY-MM-DD'),
  rateSnapshot: z
    .object({
      waterBillingType: z.string().optional(),
      waterRate: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
      electricityBillingType: z.string().optional(),
      electricityRate: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
      commonFee: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
      commonFeeMode: z.string().optional(),
      internetFee: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
      internetFeeMode: z.string().optional(),
      parkingFee: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
      parkingFeeMode: z.string().optional(),
      lateFeeType: z.string().optional(),
      lateFeeValue: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
      currency: z.string().default('THB').optional(),
    })
    .optional(),
});

export const UpdateBillingCycleSchema = CreateBillingCycleSchema.partial().extend({
  version: z.number().int().optional(),
});

export const CreateMeterDeviceSchema = z.object({
  roomId: z.string().min(1, 'Room ID จำเป็นต้องระบุ'),
  type: z.enum(['water', 'electricity']),
  meterNumber: z.string().min(1, 'หมายเลขอิเล็กทรอนิกส์/มิเตอร์จำเป็นต้องระบุ').max(100),
  initialReading: z.string().regex(/^\d+(\.\d{1,2})?$/).default('0.00'),
  installedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const UpdateMeterDeviceSchema = CreateMeterDeviceSchema.partial().extend({
  status: z.enum(['active', 'inactive', 'replaced']).optional(),
  version: z.number().int().optional(),
});

export const ReplaceMeterSchema = z.object({
  roomId: z.string().min(1, 'Room ID จำเป็นต้องระบุ'),
  meterType: z.enum(['water', 'electricity']),
  oldMeterFinalReading: z.string().regex(/^\d+(\.\d{1,2})?$/, 'ค่ามิเตอร์สายนอกเดิมไม่ถูกต้อง'),
  newMeterNumber: z.string().min(1, 'หมายเลขอิเล็กทรอนิกส์/มิเตอร์ใหม่จำเป็นต้องระบุ').max(100),
  newMeterInitialReading: z.string().regex(/^\d+(\.\d{1,2})?$/).default('0.00'),
  replacementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  reason: z.string().optional(),
});

export const MeterReadingItemSchema = z.object({
  roomId: z.string().min(1, 'Room ID จำเป็นต้องระบุ'),
  meterType: z.enum(['water', 'electricity']),
  meterDeviceId: z.string().optional(),
  previousReading: z.string().regex(/^\d+(\.\d{1,2})?$/),
  currentReading: z.string().regex(/^\d+(\.\d{1,2})?$/),
  readAt: z.string().optional(),
  notes: z.string().optional(),
});

export const BulkMeterReadingSchema = z.object({
  billingCycleId: z.string().min(1, 'Billing Cycle ID จำเป็นต้องระบุ'),
  readings: z.array(MeterReadingItemSchema).min(1, 'ต้องระบุรายการจดมิเตอร์อย่างน้อย 1 รายการ'),
});

export const UpdateMeterReadingSchema = z.object({
  currentReading: z.string().regex(/^\d+(\.\d{1,2})?$/),
  notes: z.string().optional(),
  version: z.number().int().optional(),
});

export const UpdateCyclePeopleCountSchema = z.object({
  billingCycleId: z.string().min(1, 'Billing Cycle ID จำเป็นต้องระบุ'),
  roomId: z.string().min(1, 'Room ID จำเป็นต้องระบุ'),
  peopleCount: z.number().int().min(1, 'จำนวนคนต้องมีอย่างน้อย 1 คน'),
});

export const CreateBillPreviewSchema = z.object({
  billingCycleId: z.string().min(1, 'Billing Cycle ID จำเป็นต้องระบุ'),
  roomIds: z.array(z.string()).optional(),
});

export const GenerateBillSchema = z.object({
  billingCycleId: z.string().min(1, 'Billing Cycle ID จำเป็นต้องระบุ'),
  contractId: z.string().min(1, 'Contract ID จำเป็นต้องระบุ'),
  roomId: z.string().min(1, 'Room ID จำเป็นต้องระบุ'),
  tenantId: z.string().min(1, 'Tenant ID จำเป็นต้องระบุ'),
  billingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  customItems: z
    .array(
      z.object({
        type: z.string().min(1),
        description: z.string().min(1),
        quantity: z.string().regex(/^\d+(\.\d{1,2})?$/).default('1.00'),
        unitPrice: z.string().regex(/^\d+(\.\d{1,2})?$/),
        amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
      })
    )
    .optional(),
  discountAmount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
});

export const BulkGenerateBillSchema = z.object({
  billingCycleId: z.string().min(1, 'Billing Cycle ID จำเป็นต้องระบุ'),
  roomIds: z.array(z.string()).optional(),
});

export const CancelBillSchema = z.object({
  reason: z.string().min(1, 'เหตุผลในการยกเลิกจำเป็นต้องระบุ'),
});
