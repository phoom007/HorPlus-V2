import { z } from 'zod';

export const CreateBuildingSchema = z.object({
  name: z.string().min(1, 'ชื่ออาคารจำเป็นต้องระบุ').max(255),
  code: z.string().max(100).optional().nullable(),
  floorCount: z.number().int().min(1, 'จำนวนชั้นต้องมากกว่า 0').default(1),
  description: z.string().optional().nullable(),
  displayOrder: z.number().int().default(0),
  numberingPattern: z.string().optional().nullable(),
});

export const UpdateBuildingSchema = CreateBuildingSchema.partial().extend({
  expectedVersion: z.number().int().min(1, 'ต้องระบุ expectedVersion ที่ถูกต้อง'),
}).strict();

export const CreateRoomSchema = z.object({
  buildingId: z.string().min(1, 'ต้องระบุอาคาร'),
  roomNumber: z.string().min(1, 'เลขห้องจำเป็นต้องระบุ').max(100),
  floor: z.number().int().min(1, 'ชั้นต้องมากกว่า 0').default(1),
  roomType: z.string().default('standard'),
  rentCycle: z.enum(['monthly', 'term', 'daily']).default('monthly'),
  monthlyRent: z.string().regex(/^\d+(\.\d{1,2})?$/, 'จำนวนเงินไม่ถูกต้อง').default('0.00'),
  termRent: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().nullable(),
  dailyRent: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().nullable(),
  depositAmount: z.string().regex(/^\d+(\.\d{1,2})?$/).default('0.00'),
  parkingFee: z.string().regex(/^\d+(\.\d{1,2})?$/).default('0.00'),
  maximumOccupants: z.number().int().min(1).default(2),
  waterMeterNumber: z.string().optional().nullable(),
  electricityMeterNumber: z.string().optional().nullable(),
  initialWaterReading: z.string().regex(/^\d+(\.\d{1,2})?$/).default('0.00'),
  initialElectricityReading: z.string().regex(/^\d+(\.\d{1,2})?$/).default('0.00'),
  amenities: z.array(z.string()).optional(),
  images: z.array(z.string()).optional(),
  notes: z.string().optional().nullable(),
});

export const UpdateRoomSchema = CreateRoomSchema.partial().extend({
  expectedVersion: z.number().int().min(1, 'ต้องระบุ expectedVersion ที่ถูกต้อง'),
}).strict();

export const ArchiveBuildingSchema = z.object({
  expectedVersion: z.number().int().min(1, 'ต้องระบุ expectedVersion ที่ถูกต้อง'),
}).strict();

export const ArchiveRoomSchema = z.object({
  expectedVersion: z.number().int().min(1, 'ต้องระบุ expectedVersion ที่ถูกต้อง'),
}).strict();

export const ClearBuildingOverrideSchema = z.object({
  expectedVersion: z.number().int().min(1, 'ต้องระบุ expectedVersion ที่ถูกต้อง'),
}).strict();

export const ClearRoomOverrideSchema = z.object({
  expectedVersion: z.number().int().min(1, 'ต้องระบุ expectedVersion ที่ถูกต้อง'),
}).strict();

export const CreateTenantSchema = z.object({
  firstName: z.string().min(1, 'ชื่อจำเป็นต้องระบุ').max(255),
  lastName: z.string().max(255).optional().nullable(),
  displayName: z.string().max(255).optional(),
  phone: z.string().min(9, 'เบอร์โทรศัพท์ไม่ถูกต้อง').max(50),
  email: z.string().email('อีเมลไม่ถูกต้อง').optional().nullable(),
  nationalId: z.string().length(13, 'เลขบัตรประชาชนต้องมี 13 หลัก').optional().nullable(),
  dateOfBirth: z.string().optional().nullable(),
  gender: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  photoUrl: z.string().optional().nullable(),
  petInfo: z.any().optional(),
  notes: z.string().optional().nullable(),
});

export const UpdateTenantSchema = CreateTenantSchema.partial().extend({
  version: z.number().int().optional(),
});

export const CreateCoOccupantSchema = z.object({
  name: z.string().min(1, 'ชื่อผู้พักร่วมจำเป็นต้องระบุ').max(255),
  phone: z.string().optional().nullable(),
  relationship: z.string().optional().nullable(),
  nationalId: z.string().optional().nullable(),
  dateOfBirth: z.string().optional().nullable(),
});

export const UpdateCoOccupantSchema = CreateCoOccupantSchema.partial();

export const CreateEmergencyContactSchema = z.object({
  name: z.string().min(1, 'ชื่อผู้ติดต่อฉุกเฉินจำเป็นต้องระบุ').max(255),
  phone: z.string().min(9, 'เบอร์โทรศัพท์ไม่ถูกต้อง').max(50),
  relationship: z.string().min(1, 'ความสัมพันธ์จำเป็นต้องระบุ').max(100),
  isPrimary: z.boolean().default(true),
});

export const UpdateEmergencyContactSchema = CreateEmergencyContactSchema.partial();

export const CreateVehicleSchema = z.object({
  type: z.enum(['car', 'motorcycle', 'none', 'other']).default('car'),
  brand: z.string().optional().nullable(),
  model: z.string().optional().nullable(),
  color: z.string().optional().nullable(),
  licensePlate: z.string().min(1, 'ทะเบียนรถจำเป็นต้องระบุ').max(100),
  province: z.string().optional().nullable(),
});

export const UpdateVehicleSchema = CreateVehicleSchema.partial();

export const CreateContractSchema = z.object({
  roomId: z.string().min(1, 'รูปแบบ Room ID ไม่ถูกต้อง'),
  tenantId: z.string().min(1, 'รูปแบบ Tenant ID ไม่ถูกต้อง'),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่ต้องเป็น YYYY-MM-DD'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่ต้องเป็น YYYY-MM-DD'),
  durationMonths: z.number().int().min(1).default(1),
  rentBillingType: z.string().default('monthly'),
  rentAmount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'จำนวนเงินไม่ถูกต้อง'),
  depositAmount: z.string().regex(/^\d+(\.\d{1,2})?$/).default('0.00'),
  advancePaymentAmount: z.string().regex(/^\d+(\.\d{1,2})?$/).default('0.00'),
  terms: z.string().optional().nullable(),
});

export const UpdateContractSchema = CreateContractSchema.partial().extend({
  version: z.number().int().optional(),
});

export const ActivateContractSchema = z.object({
  ownerSignature: z.string().optional().nullable(),
  tenantSignature: z.string().optional().nullable(),
});

export const ExtendContractSchema = z.object({
  newEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่ต้องเป็น YYYY-MM-DD'),
  additionalMonths: z.number().int().min(1).optional(),
  reason: z.string().optional(),
  version: z.number().int().optional(),
});

export const TerminateContractSchema = z.object({
  terminationEffectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่ต้องเป็น YYYY-MM-DD'),
  terminationReason: z.string().min(1, 'เหตุผลการยกเลิกจำเป็นต้องระบุ'),
  depositRefundAmount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  deductionAmount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  settlementNote: z.string().optional(),
  nextRoomStatus: z.enum(['vacant', 'maintenance']).default('vacant'),
  version: z.number().int().optional(),
});

export const UpdateDormitoryPropertyDefaultsSchema = z.object({
  defaultMonthlyRent: z.union([z.number(), z.string()]).optional(),
  defaultTermRent: z.union([z.number(), z.string()]).optional().nullable(),
  defaultDailyRent: z.union([z.number(), z.string()]).optional().nullable(),
  defaultDeposit: z.union([z.number(), z.string()]).optional(),
  defaultAdvancePayment: z.union([z.number(), z.string()]).optional(),
  defaultParkingFee: z.union([z.number(), z.string()]).optional(),
  defaultMaxOccupants: z.number().int().min(1).optional(),
  defaultRoomType: z.string().optional(),
  defaultTerms: z.string().optional().nullable(),
  expectedVersion: z.number().int().min(1, 'ต้องระบุ expectedVersion ที่ถูกต้อง'),
}).strict();

export const UpdateDormitoryBillingDefaultsSchema = z.object({
  waterRate: z.union([z.number(), z.string()]).optional(),
  electricityRate: z.union([z.number(), z.string()]).optional(),
  commonFee: z.union([z.number(), z.string()]).optional(),
  internetFee: z.union([z.number(), z.string()]).optional(),
  waterBillingType: z.string().optional(),
  electricityBillingType: z.string().optional(),
  rentBillingType: z.string().optional(),
  expectedVersion: z.number().int().min(1, 'ต้องระบุ expectedVersion ที่ถูกต้อง'),
}).strict();

export const UpdateBuildingDefaultsSchema = z.object({
  monthlyRent: z.union([z.number(), z.string()]).optional().nullable(),
  termRent: z.union([z.number(), z.string()]).optional().nullable(),
  dailyRent: z.union([z.number(), z.string()]).optional().nullable(),
  depositAmount: z.union([z.number(), z.string()]).optional().nullable(),
  advancePaymentAmount: z.union([z.number(), z.string()]).optional().nullable(),
  waterRate: z.union([z.number(), z.string()]).optional().nullable(),
  electricityRate: z.union([z.number(), z.string()]).optional().nullable(),
  commonFee: z.union([z.number(), z.string()]).optional().nullable(),
  internetFee: z.union([z.number(), z.string()]).optional().nullable(),
  parkingFee: z.union([z.number(), z.string()]).optional().nullable(),
  waterBillingType: z.string().optional().nullable(),
  electricityBillingType: z.string().optional().nullable(),
  rentBillingType: z.string().optional().nullable(),
  maximumOccupants: z.number().int().optional().nullable(),
  roomType: z.string().optional().nullable(),
  expectedVersion: z.number().int().min(1, 'ต้องระบุ expectedVersion ที่ถูกต้อง'),
}).strict();

export const UpdateRoomDefaultsSchema = z.object({
  monthlyRent: z.union([z.number(), z.string()]).optional().nullable(),
  termRent: z.union([z.number(), z.string()]).optional().nullable(),
  dailyRent: z.union([z.number(), z.string()]).optional().nullable(),
  depositAmount: z.union([z.number(), z.string()]).optional().nullable(),
  advancePaymentAmount: z.union([z.number(), z.string()]).optional().nullable(),
  waterRate: z.union([z.number(), z.string()]).optional().nullable(),
  electricityRate: z.union([z.number(), z.string()]).optional().nullable(),
  commonFee: z.union([z.number(), z.string()]).optional().nullable(),
  internetFee: z.union([z.number(), z.string()]).optional().nullable(),
  parkingFee: z.union([z.number(), z.string()]).optional().nullable(),
  waterBillingType: z.string().optional().nullable(),
  electricityBillingType: z.string().optional().nullable(),
  rentBillingType: z.string().optional().nullable(),
  maximumOccupants: z.number().int().optional().nullable(),
  roomType: z.string().optional().nullable(),
  expectedVersion: z.number().int().min(1, 'ต้องระบุ expectedVersion ที่ถูกต้อง'),
}).strict();

export const DefaultPropagationPreviewSchema = z.object({
  scope: z.enum(['DORMITORY', 'BUILDING']),
  scopeId: z.string().optional(),
  changes: z.record(z.any()).optional(),
}).strict();

export const DefaultPropagationApplySchema = z.object({
  scope: z.enum(['DORMITORY', 'BUILDING']),
  scopeId: z.string().optional(),
  changes: z.record(z.any()),
  expectedVersion: z.number().int().min(1, 'ต้องระบุ expectedVersion ที่ถูกต้อง'),
  idempotencyKey: z.string().min(1, 'ต้องระบุ Idempotency Key'),
}).strict();

export const AvailabilityQuerySchema = z.object({
  startDate: z.string(),
  endDate: z.string(),
  buildingId: z.string().optional(),
  roomId: z.string().optional(),
}).strict();

export const ALLOWED_OVERRIDE_FIELDS = [
  'monthlyRent',
  'termRent',
  'dailyRent',
  'depositAmount',
  'advancePaymentAmount',
  'waterRate',
  'electricityRate',
  'commonFee',
  'internetFee',
  'parkingFee',
  'waterBillingType',
  'electricityBillingType',
  'rentBillingType',
  'maximumOccupants',
  'roomType',
] as const;

export const PROTECTED_SYSTEM_FIELDS = [
  'id',
  'dormitoryId',
  'buildingId',
  'status',
  'version',
  'deletedAt',
  'currentTenantId',
  'currentContractId',
  'createdAt',
  'updatedAt',
  'normalizedRoomNumber',
] as const;

export function validateClearOverrideField(field: string): boolean {
  return ALLOWED_OVERRIDE_FIELDS.includes(field as any) && !PROTECTED_SYSTEM_FIELDS.includes(field as any);
}


