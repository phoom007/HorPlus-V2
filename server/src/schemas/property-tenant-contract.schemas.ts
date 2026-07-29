import { z } from 'zod';

export const CreateBuildingSchema = z.object({
  name: z.string().min(1, 'ชื่ออาคารจำเป็นต้องระบุ').max(255),
  code: z.string().max(100).optional().nullable(),
  floorCount: z.number().int().min(1, 'จำนวนชั้นต้องมากกว่า 0').default(1),
  description: z.string().optional().nullable(),
  displayOrder: z.number().int().default(0),
});

export const UpdateBuildingSchema = CreateBuildingSchema.partial();

export const CreateRoomSchema = z.object({
  buildingId: z.string().min(1).optional().nullable(),
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
  version: z.number().int().optional(),
});

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
