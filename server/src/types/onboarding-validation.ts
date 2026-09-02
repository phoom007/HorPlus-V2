import { z } from 'zod';
import { normalizeRoomIdentifier } from '../utils/normalization.js';

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
  estimatedRoomCount: z.coerce.number().int().min(1, 'จำนวนห้องต้องอย่างน้อย 1').max(150, 'หนึ่งหอพักสามารถสร้างห้องได้สูงสุด 150 ห้อง').default(10),
  logoUrl: z.string().trim().optional().nullable(),
}).strict();

const normalizeMoneyField = (defaultVal = '0.00', msg = 'ต้องเป็นตัวเลขจำนวนเงินที่ถูกต้อง') =>
  z.union([z.string(), z.number(), z.null(), z.undefined()])
    .transform((val) => {
      if (val === null || val === undefined || val === '') return defaultVal;
      const str = String(val).replace(/,/g, '').trim();
      if (!str || isNaN(Number(str))) return defaultVal;
      if (/^\d+(\.\d{1,2})?$/.test(str)) return str;
      return Number(str).toFixed(2);
    })
    .pipe(z.string().regex(/^\d+(\.\d{1,2})?$/, msg));

export const OnboardingBillingInputSchema = z.object({
  billingDay: z.coerce.number().int().min(1).max(28).optional().nullable(),
  dueDay: z.coerce.number({ required_error: 'กรุณาระบุวันครบกำหนดชำระ (dueDay is required)', invalid_type_error: 'วันครบกำหนดชำระต้องเป็นตัวเลข' }).int().min(1, 'วันครบกำหนดชำระต้องอยู่ระหว่างวันที่ 1-28').max(28, 'วันครบกำหนดชำระต้องอยู่ระหว่างวันที่ 1-28'),
  waterBillingType: z.enum(['per_unit', 'fixed_monthly', 'flat_rate', 'unit', 'flat', 'per_person', 'person', 'room', 'per_room', 'tiered']).default('per_person'),
  waterRate: normalizeMoneyField('0.00', 'ค่าน้ำต้องเป็นตัวเลขจำนวนเงินที่ถูกต้อง').default('0.00'),
  waterTierRates: z.array(z.object({ upTo: z.string().nullable(), rate: z.string() })).nullable().optional(),
  electricityBillingType: z.enum(['per_unit', 'fixed_monthly', 'flat_rate', 'unit', 'flat', 'per_person', 'person', 'room', 'per_room', 'tiered']).default('per_unit'),
  electricityRate: normalizeMoneyField('0.00', 'ค่าไฟต้องเป็นตัวเลขจำนวนเงินที่ถูกต้อง').default('0.00'),
  electricityTierRates: z.array(z.object({ upTo: z.string().nullable(), rate: z.string() })).nullable().optional(),
  commonFee: normalizeMoneyField('0.00', 'ค่าส่วนกลางต้องเป็นตัวเลขจำนวนเงินที่ถูกต้อง').default('0.00'),
  commonFeeMode: z.string().trim().optional().nullable().default('per_room'),
  internetFee: normalizeMoneyField('0.00', 'ค่าอินเทอร์เน็ตต้องเป็นตัวเลขจำนวนเงินที่ถูกต้อง').default('0.00'),
  internetFeeMode: z.string().trim().optional().nullable().default('per_person'),
  parkingRate: normalizeMoneyField('0.00', 'ค่าจอดรถต้องเป็นตัวเลขจำนวนเงินที่ถูกต้อง').optional().nullable().default('0.00'),
  parkingFeeMode: z.string().trim().optional().nullable().default('per_room'),
  gracePeriodDays: z.coerce.number().int().min(0).max(90).optional().nullable().default(2).transform(() => 2),
  advanceRentMonths: z.coerce.number().int().min(0).max(12).optional().nullable().default(1),
  lateFeeType: z.enum(['fixed', 'fixed_once', 'per_day', 'percentage', 'none'])
    .default('none')
    .transform((val) => (val === 'fixed_once' ? 'fixed' : val)),
  lateFeeValue: normalizeMoneyField('0.00', 'ค่าปรับต้องเป็นตัวเลขจำนวนเงินที่ถูกต้อง').default('0.00'),
  rentBillingType: z.enum(['monthly']).default('monthly'),
  billingCycle: z.string().trim().optional().nullable(),
}).strict();

export const OnboardingPaymentInputSchema = z.object({
  cashAccepted: z.boolean().default(true),
  promptPayType: z.enum(['mobile_phone', 'national_id']).optional().nullable(),
  promptPayValue: z.string().trim().optional().nullable(),
  promptPayAccountName: z.string().trim().max(255).optional().nullable(),
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
  promptPayAccountName: z.string().trim().max(255).optional().nullable(),
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
  code: z.string().trim().max(100).transform(val => val ? val.toUpperCase() : val).optional().nullable(),
  floorCount: z.number().int().min(1, 'Minimum 1 floor').default(1),
  roomsPerFloor: z.number().int().min(0).optional().nullable(),
  numberingPattern: z.string().max(100).optional().nullable(),
  description: z.string().optional().nullable(),
}).strict();

export const OnboardingBuildingInputSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1, 'กรุณาระบุชื่ออาคาร').max(255),
  code: z.string().trim().max(100).transform(val => val ? val.toUpperCase() : val).optional().nullable(),
  floorsCount: z.coerce.number().int().min(1, 'จำนวนชั้นต้องอย่างน้อย 1').max(200).default(1),
  roomsPerFloor: z.coerce.number().int().min(0).optional().nullable(),
  roomPrefix: z.string().trim().max(100).transform(val => val ? val.toUpperCase() : val).optional().nullable(),
  hasElevator: z.boolean().optional().nullable().default(false),
  numberingPattern: z.string().max(100).optional().nullable(),
  formatPattern: z.string().max(100).optional().nullable(),
  description: z.string().trim().optional().nullable(),
  monthlyRent: z.coerce.number().min(0).optional().nullable().default(0),
  dailyRent: z.coerce.number().min(0).optional().nullable(),
  termRent: z.coerce.number().min(0).optional().nullable(),
  termMonths: z.coerce.number().int().min(1).optional().nullable().default(4),
  maxInstallmentMonths: z.coerce.number().int().min(1).max(12).default(2),
  maximumOccupants: z.coerce.number().int().min(1).optional().nullable().default(2),
  depositAmount: z.coerce.number().min(0).optional().nullable(),
  securityDeposit: z.coerce.number().min(0).optional().nullable(),
  termDeposit: z.coerce.number().min(0).optional().nullable(),
  monthlyDeposit: z.coerce.number().min(0).optional().nullable(),
  dailyDeposit: z.coerce.number().min(0).optional().nullable(),
}).strict();

export const OnboardingRoomInputSchema = z.object({
  buildingId: z.string().trim().min(1, 'ต้องระบุอาคาร'),
  roomNumber: z.string().trim().min(1, 'กรุณาระบุหมายเลขห้อง').max(100),
  floor: z.coerce.number().int().min(0).default(1),
  monthlyRent: z.coerce.number().min(0).default(0),
  dailyRent: z.coerce.number().min(0).optional().nullable(),
  termRent: z.coerce.number().min(0).optional().nullable(),
  termMonths: z.coerce.number().int().min(1).optional().nullable().default(4),
  depositAmount: z.coerce.number().min(0).optional().nullable(),
  securityDeposit: z.coerce.number().min(0).optional().nullable(),
  termDeposit: z.coerce.number().min(0).optional().nullable(),
  monthlyDeposit: z.coerce.number().min(0).optional().nullable(),
  dailyDeposit: z.coerce.number().min(0).optional().nullable(),
  depositInheritsBuildingDefault: z.boolean().optional().default(true),
  parkingFee: z.coerce.number().min(0).default(0),
  maximumOccupants: z.coerce.number().int().min(1).optional().nullable().default(2),
  // LOCKED POLICY: All new rooms begin with meter baseline = 0. Real meter readings are entered in Meter Workspace.
  initialWaterReading: z.coerce.number().refine(val => val === 0, { message: 'ค่ามิเตอร์เริ่มต้นสำหรับห้องใหม่ต้องเป็น 0 (initial meter reading must be 0)' }).optional().default(0),
  initialElectricityReading: z.coerce.number().refine(val => val === 0, { message: 'ค่ามิเตอร์เริ่มต้นสำหรับห้องใหม่ต้องเป็น 0 (initial meter reading must be 0)' }).optional().default(0),
  status: z.enum(['vacant', 'occupied', 'reserved', 'maintenance']).default('vacant'),
}).strict();

export const CompleteOnboardingInputSchema = z.object({
  dormitory: OnboardingDormitoryInputSchema,
  billing: OnboardingBillingInputSchema,
  payment: OnboardingPaymentInputSchema.optional(),
  buildings: z.array(OnboardingBuildingInputSchema).optional(),
  rooms: z.array(OnboardingRoomInputSchema).max(150, 'หนึ่งหอพักสามารถสร้างห้องได้สูงสุด 150 ห้อง').optional(),
  planCode: z.string().trim().min(1, 'กรุณาเลือกแพ็กเกจ'),
  packageId: z.string().trim().optional(),
  packageIntentId: z.string({ required_error: 'กรุณาระบุรหัสรายการคำสั่งซื้อแพ็กเกจ (packageIntentId is required)' }).uuid({ message: 'รูปแบบ packageIntentId ไม่ถูกต้อง' }),
  promoCode: z.string().trim().optional(),
  referralCode: z.string().trim().optional(),
  coinApplied: z.coerce.number().int().min(0).optional(),
  idempotencyKey: z.string().optional(),
  marketingSource: z.string().optional(),
  termsAccepted: z.boolean().optional(),
  rules: z.string().optional(),
  defaultTerms: z.string().optional(),
  petPolicy: z.object({
    allowed: z.string(),
    allowedTypes: z.array(z.enum(['dog', 'cat', 'small_pet', 'other'])).optional(),
  }).optional(),
  signatureSaved: z.boolean().optional(),
  signatureObjectKey: z.string().optional(),
  ownerSignatureUrl: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.rooms && data.rooms.length > 0) {
    const seen = new Set<string>();
    for (let i = 0; i < data.rooms.length; i++) {
      const r = data.rooms[i];
      const norm = normalizeRoomIdentifier(r.roomNumber);
      if (norm) {
        if (seen.has(norm)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['rooms', i, 'roomNumber'],
            message: `เลขห้อง "${r.roomNumber}" ซ้ำกับอาคารอื่น กรุณาเปลี่ยนเลขห้องหรือเลือกรูปแบบเลขห้องอื่น`,
          });
        }
        seen.add(norm);
      }
    }
  }
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
