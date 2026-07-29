import { z } from 'zod';

export const OnboardingDormitoryInputSchema = z.object({
  name: z.string().trim().min(1, 'กรุณาระบุชื่อหอพัก').max(255, 'ชื่อหอพักยาวเกินไป'),
  type: z.string().trim().optional().default('apartment'),
  addressLine1: z.string().trim().optional(),
  addressLine2: z.string().trim().optional(),
  subdistrict: z.string().trim().optional(),
  district: z.string().trim().optional(),
  province: z.string().trim().optional(),
  postalCode: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  email: z.string().trim().email('อีเมลหอพักไม่ถูกต้อง').optional().or(z.literal('')),
  estimatedBuildingCount: z.coerce.number().int().min(1, 'จำนวนอาคารต้องอย่างน้อย 1').max(100).default(1),
  estimatedRoomCount: z.coerce.number().int().min(1, 'จำนวนห้องต้องอย่างน้อย 1').max(10000).default(10),
}).strict();

export const OnboardingBillingInputSchema = z.object({
  billingDay: z.coerce.number().int().min(1).max(28).default(25),
  dueDay: z.coerce.number().int().min(1).max(28).default(5),
  waterBillingType: z.enum(['per_unit', 'fixed_monthly', 'flat_rate']).default('per_unit'),
  waterRate: z.string().regex(/^\d+(\.\d{1,2})?$/, 'ค่าน้ำต้องเป็นตัวเลขจำนวนเงินที่ถูกต้อง').default('18.00'),
  electricityBillingType: z.enum(['per_unit', 'fixed_monthly', 'flat_rate']).default('per_unit'),
  electricityRate: z.string().regex(/^\d+(\.\d{1,2})?$/, 'ค่าไฟต้องเป็นตัวเลขจำนวนเงินที่ถูกต้อง').default('7.00'),
  commonFee: z.string().regex(/^\d+(\.\d{1,2})?$/, 'ค่าส่วนกลางต้องเป็นตัวเลขจำนวนเงินที่ถูกต้อง').default('0.00'),
  internetFee: z.string().regex(/^\d+(\.\d{1,2})?$/, 'ค่าอินเทอร์เน็ตต้องเป็นตัวเลขจำนวนเงินที่ถูกต้อง').default('0.00'),
  lateFeeType: z.enum(['fixed', 'per_day', 'percentage']).default('fixed'),
  lateFeeValue: z.string().regex(/^\d+(\.\d{1,2})?$/, 'ค่าปรับต้องเป็นตัวเลขจำนวนเงินที่ถูกต้อง').default('50.00'),
  rentBillingType: z.enum(['monthly']).default('monthly'),
}).strict();

export const OnboardingPaymentInputSchema = z.object({
  cashAccepted: z.boolean().default(true),
  promptPayType: z.enum(['mobile_phone', 'national_id', 'e_wallet']).optional().nullable(),
  promptPayValue: z.string().trim().optional().nullable(),
  bankCode: z.string().trim().optional().nullable(),
  bankAccountName: z.string().trim().optional().nullable(),
  bankAccountNumber: z.string().trim().optional().nullable(),
}).strict();

export const CompleteOnboardingInputSchema = z.object({
  dormitory: OnboardingDormitoryInputSchema,
  billing: OnboardingBillingInputSchema.optional(),
  payment: OnboardingPaymentInputSchema.optional(),
  planCode: z.string().trim().min(1, 'กรุณาเลือกแพ็กเกจ'),
  promoCode: z.string().trim().optional(),
}).strict();

export const OnboardingDraftInputSchema = z.object({
  currentStep: z.string().trim().min(1, 'กรุณาระบุขั้นตอนปัจจุบัน').default('dormitory'),
  payload: z.record(z.string(), z.any()).default({}),
}).strict();

export const ValidatePromoInputSchema = z.object({
  code: z.string().trim().min(1, 'กรุณากรอกรหัสโปรโมชัน'),
  planCode: z.string().trim().optional(),
}).strict();

export const UpdateDormitoryInputSchema = z.object({
  name: z.string().trim().min(1, 'กรุณาระบุชื่อหอพัก').max(255).optional(),
  type: z.string().trim().optional(),
  addressLine1: z.string().trim().optional(),
  addressLine2: z.string().trim().optional(),
  subdistrict: z.string().trim().optional(),
  district: z.string().trim().optional(),
  province: z.string().trim().optional(),
  postalCode: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  email: z.string().trim().email().optional().or(z.literal('')),
}).strict();

export type CompleteOnboardingInput = z.infer<typeof CompleteOnboardingInputSchema>;
