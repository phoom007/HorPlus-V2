-- AlterTable: update column defaults for new rows in dormitory_billing_settings
ALTER TABLE "dormitory_billing_settings"
  ALTER COLUMN "water_billing_type" SET DEFAULT 'per_person',
  ALTER COLUMN "water_rate" SET DEFAULT 0.00,
  ALTER COLUMN "electricity_billing_type" SET DEFAULT 'per_unit',
  ALTER COLUMN "electricity_rate" SET DEFAULT 0.00,
  ALTER COLUMN "common_fee" SET DEFAULT 0.00,
  ALTER COLUMN "common_fee_mode" SET DEFAULT 'per_room',
  ALTER COLUMN "internet_fee" SET DEFAULT 0.00,
  ALTER COLUMN "internet_fee_mode" SET DEFAULT 'per_person',
  ALTER COLUMN "parking_rate" SET DEFAULT 0.00,
  ALTER COLUMN "parking_fee_mode" SET DEFAULT 'per_room',
  ALTER COLUMN "late_fee_type" SET DEFAULT 'none',
  ALTER COLUMN "late_fee_value" SET DEFAULT 0.00;

