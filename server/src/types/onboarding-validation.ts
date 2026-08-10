import { z } from 'zod';

export const OnboardingDormitoryInputSchema = z.object({
  name: z.string().trim().min(1, 'กรุณาระบุชื่อหอพัก').max(255, 'ชื่อหอพักยาวเกินไป'),
  type: z.string().trim().optional().nullable().default('apartment'),
  genderPolicy: z.string().trim().optional().nullable().default('รวม'),
  addressLine1: z.string().trim().optional().nullable(),
  addressLine2: z.string().trim().optional().nullable(),
  subdistrict: z.string().trim().optional().nullable(),
  district: z.string().trim().optional().nullable(),
  province: z.string().trim().optional().nullable(),
  postalCode: z.string().trim().optional().nullable(),
  phone: z.string().trim().optional().nullable(),
  email: z.string().trim().email('อีเมลหอพักไม่ถูกต้อง').optional().nullable().or(z.literal('')),
  estimatedBuildingCount: z.coerce.number().int().min(1, 'จำนวนอาคารต้องอย่างน้อย 1').max(100).default(1),
  estimatedRoomCount: z.coerce.number().int().min(1, 'จำนวนห้องต้องอย่างน้อย 1').max(10000).default(10),
}).strict();

export const OnboardingBillingInputSchema = z.object({
  billingDay: z.coerce.number().int().min(1).max(28).default(25),
  dueDay: z.coerce.number().int().min(1).max(28).default(5),
  waterBillingType: z.enum(['per_unit', 'fixed_monthly', 'flat_rate', 'unit', 'flat']).default('per_unit'),
  waterRate: z.string().regex(/^\d+(\.\d{1,2})?$/, 'ค่าน้ำต้องเป็นตัวเลขจำนวนเงินที่ถูกต้อง').default('18.00'),
  electricityBillingType: z.enum(['per_unit', 'fixed_monthly', 'flat_rate', 'unit', 'flat']).default('per_unit'),
  electricityRate: z.string().regex(/^\d+(\.\d{1,2})?$/, 'ค่าไฟต้องเป็นตัวเลขจำนวนเงินที่ถูกต้อง').default('7.00'),
  commonFee: z.string().regex(/^\d+(\.\d{1,2})?$/, 'ค่าส่วนกลางต้องเป็นตัวเลขจำนวนเงินที่ถูกต้อง').default('0.00'),
  commonFeeMode: z.string().trim().optional().nullable().default('none'),
  internetFee: z.string().regex(/^\d+(\.\d{1,2})?$/, 'ค่าอินเทอร์เน็ตต้องเป็นตัวเลขจำนวนเงินที่ถูกต้อง').default('0.00'),
  internetFeeMode: z.string().trim().optional().nullable().default('none'),
  parkingRate: z.string().regex(/^\d+(\.\d{1,2})?$/, 'ค่าจอดรถต้องเป็นตัวเลขจำนวนเงินที่ถูกต้อง').optional().nullable().default('0.00'),
  parkingFeeMode: z.string().trim().optional().nullable().default('none'),
  gracePeriodDays: z.coerce.number().int().min(0).max(90).optional().nullable().default(0),
  advanceRentMonths: z.coerce.number().int().min(0).max(12).optional().nullable().default(1),
  lateFeeType: z.enum(['fixed', 'per_day', 'percentage', 'none']).default('none'),
  lateFeeValue: z.string().regex(/^\d+(\.\d{1,2})?$/, 'ค่าปรับต้องเป็นตัวเลขจำนวนเงินที่ถูกต้อง').default('0.00'),
  rentBillingType: z.enum(['monthly']).default('monthly'),
}).strict();

export const OnboardingPaymentInputSchema = z.object({
  cashAccepted: z.boolean().default(true),
  promptPayType: z.enum(['mobile_phone', 'national_id']).optional().nullable(),
  promptPayValue: z.string().trim().optional().nullable(),
  bankCode: z.string().trim().optional().nullable(),
  bankAccountName: z.string().trim().optional().nullable(),
  bankAccountNumber: z.string().trim().optional().nullable(),
}).strict().superRefine((data, ctx) => {
  const type = data.promptPayType;
  const rawVal = data.promptPayValue ? data.promptPayValue.replace(/\D/g, '') : '';

  if (!type && data.promptPayValue && data.promptPayValue.trim() !== '') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['promptPayType'],
      message: 'กรุณาระบุประเภทพร้อมเพย์เมื่อมีการกรอกหมายเลขพร้อมเพย์',
    });
  }

  if (type) {
    if (!rawVal || rawVal === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['promptPayValue'],
        message: 'กรุณาระบุหมายเลขพร้อมเพย์เมื่อเลือกประเภทพร้อมเพย์',
      });
    } else if (!data.promptPayValue?.includes('X')) {
      if (type === 'mobile_phone') {
        if (rawVal.length !== 10 || !/^0\d{9}$/.test(rawVal)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['promptPayValue'],
            message: 'พร้อมเพย์ประเภทเบอร์โทรศัพท์ต้องเป็นตัวเลข 10 หลัก (เช่น 0812345678)',
          });
        }
      } else if (type === 'national_id') {
        if (rawVal.length !== 13 || !/^\d{13}$/.test(rawVal)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['promptPayValue'],
            message: 'พร้อมเพย์ประเภทบัตรประชาชนต้องเป็นตัวเลข 13 หลัก',
          });
        }
      }
    }
  }

  if (data.bankAccountNumber && data.bankAccountNumber.trim() !== '' && !data.bankAccountNumber.includes('X')) {
    const cleanBankAcc = data.bankAccountNumber.replace(/\D/g, '');
    if (cleanBankAcc.length < 8 || cleanBankAcc.length > 15) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['bankAccountNumber'],
        message: 'เลขที่บัญชีธนาคารต้องเป็นตัวเลข 8-15 หลัก',
      });
    }
  }
});

export const PaymentSettingsPatchInputSchema = z.object({
  cashAccepted: z.boolean().optional(),
  promptPayType: z.enum(['mobile_phone', 'national_id']).optional().nullable(),
  promptPayValue: z.string().trim().optional().nullable(),
  bankCode: z.string().trim().optional().nullable(),
  bankAccountName: z.string().trim().optional().nullable(),
  bankAccountNumber: z.string().trim().optional().nullable(),
}).strict().superRefine((data, ctx) => {
  // Reject any input containing masked 'X' characters
  if (data.promptPayValue && data.promptPayValue.includes('X')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['promptPayValue'],
      message: 'ไม่สามารถส่งค่าที่ซ่อน (X) เพื่อแก้ไขข้อมูลได้',
    });
  }

  if (data.bankAccountNumber && data.bankAccountNumber.includes('X')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['bankAccountNumber'],
      message: 'ไม่สามารถส่งค่าที่ซ่อน (X) เพื่อแก้ไขข้อมูลได้',
    });
  }

  const type = data.promptPayType;
  const pVal = data.promptPayValue;

  if (pVal !== undefined && pVal !== null && pVal.trim() !== '') {
    if (!type) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['promptPayType'],
        message: 'กรุณาระบุประเภทพร้อมเพย์เมื่อมีการกรอกหมายเลขพร้อมเพย์',
      });
    }
  }

  if (type !== undefined && type !== null) {
    if (pVal === undefined || pVal === null || pVal.trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['promptPayValue'],
        message: 'กรุณาระบุหมายเลขพร้อมเพย์เมื่อเลือกประเภทพร้อมเพย์',
      });
    }
  }

  if (type && pVal && !pVal.includes('X')) {
    const rawVal = pVal.replace(/\D/g, '');
    if (type === 'mobile_phone') {
      if (rawVal.length !== 10 || !/^0\d{9}$/.test(rawVal)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['promptPayValue'],
          message: 'พร้อมเพย์ประเภทเบอร์โทรศัพท์ต้องเป็นตัวเลข 10 หลัก (เช่น 0812345678)',
        });
      }
    } else if (type === 'national_id') {
      if (rawVal.length !== 13 || !/^\d{13}$/.test(rawVal)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['promptPayValue'],
          message: 'พร้อมเพย์ประเภทบัตรประชาชนต้องเป็นตัวเลข 13 หลัก',
        });
      }
    }
  }

  if (data.bankAccountNumber && data.bankAccountNumber.trim() !== '' && !data.bankAccountNumber.includes('X')) {
    const cleanBankAcc = data.bankAccountNumber.replace(/\D/g, '');
    if (cleanBankAcc.length < 8 || cleanBankAcc.length > 15) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['bankAccountNumber'],
        message: 'เลขที่บัญชีธนาคารต้องเป็นตัวเลข 8-15 หลัก',
      });
    }
  }
});

export const PaymentSettingsInputSchema = PaymentSettingsPatchInputSchema;

export const BuildingSchema = z.object({
  name: z.string().min(1, 'Building name is required').max(255),
  code: z.string().max(100).optional().nullable(),
  floorCount: z.number().int().min(1, 'Minimum 1 floor').default(1),
  roomsPerFloor: z.number().int().min(0).optional().nullable(),
  numberingPattern: z.string().max(100).optional().nullable(),
  description: z.string().optional().nullable(),
}).strict();

export const OnboardingBuildingInputSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1, 'กรุณาระบุชื่ออาคาร').max(255),
  code: z.string().max(100).optional().nullable(),
  floorsCount: z.coerce.number().int().min(1, 'จำนวนชั้นต้องอย่างน้อย 1').max(200).default(1),
  roomsPerFloor: z.coerce.number().int().min(0).optional().nullable(),
  roomPrefix: z.string().trim().optional().nullable(),
  hasElevator: z.boolean().optional().nullable().default(false),
  numberingPattern: z.string().max(100).optional().nullable(),
  formatPattern: z.string().max(100).optional().nullable(),
  description: z.string().trim().optional().nullable(),
  monthlyRent: z.coerce.number().min(0).optional().nullable(),
  dailyRent: z.coerce.number().min(0).optional().nullable(),
  termRent: z.coerce.number().min(0).optional().nullable(),
  termMonths: z.coerce.number().int().min(1).optional().nullable(),
  maximumOccupants: z.coerce.number().int().min(1).optional().nullable(),
  depositAmount: z.coerce.number().min(0).optional().nullable(),
  securityDeposit: z.coerce.number().min(0).optional().nullable(),
}).strict();

export const OnboardingRoomInputSchema = z.object({
  buildingId: z.string().trim().min(1, 'ต้องระบุอาคาร'),
  roomNumber: z.string().trim().min(1, 'กรุณาระบุหมายเลขห้อง').max(100),
  floor: z.coerce.number().int().min(0).default(1),
  monthlyRent: z.coerce.number().min(0).default(0),
  dailyRent: z.coerce.number().min(0).optional().nullable(),
  termRent: z.coerce.number().min(0).optional().nullable(),
  termMonths: z.coerce.number().int().min(1).optional().nullable(),
  depositAmount: z.coerce.number().min(0).default(0),
  parkingFee: z.coerce.number().min(0).default(0),
  maximumOccupants: z.coerce.number().int().min(1).optional().nullable().default(2),
  initialWaterReading: z.coerce.number().min(0).default(0),
  initialElectricityReading: z.coerce.number().min(0).default(0),
  status: z.enum(['vacant', 'occupied', 'reserved', 'maintenance']).default('vacant'),
}).strict();

export const CompleteOnboardingInputSchema = z.object({
  dormitory: OnboardingDormitoryInputSchema,
  billing: OnboardingBillingInputSchema.optional(),
  payment: OnboardingPaymentInputSchema.optional(),
  buildings: z.array(OnboardingBuildingInputSchema).optional(),
  rooms: z.array(OnboardingRoomInputSchema).optional(),
  planCode: z.string().trim().min(1, 'กรุณาเลือกแพ็กเกจ'),
  promoCode: z.string().trim().optional(),
  idempotencyKey: z.string().optional(),
  marketingSource: z.string().optional(),
  termsAccepted: z.boolean().optional(),
});

export const OnboardingDraftInputSchema = z.object({
  currentStep: z.string().trim().min(1, 'กรุณาระบุขั้นตอนปัจจุบัน').default('dormitory'),
  payload: z.record(z.string(), z.any()).default({}),
  provisionalDormitoryId: z.string().trim().optional().nullable(),
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
