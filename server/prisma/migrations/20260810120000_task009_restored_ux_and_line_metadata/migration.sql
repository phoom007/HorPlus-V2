-- AlterTable
ALTER TABLE "dormitories" ADD COLUMN "gender_policy" VARCHAR(50);

-- AlterTable
ALTER TABLE "dormitory_billing_settings" ADD COLUMN "common_fee_mode" VARCHAR(50) NOT NULL DEFAULT 'none',
ADD COLUMN "internet_fee_mode" VARCHAR(50) NOT NULL DEFAULT 'none',
ADD COLUMN "parking_fee_mode" VARCHAR(50) NOT NULL DEFAULT 'none',
ADD COLUMN "parking_rate" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
ADD COLUMN "grace_period_days" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "advance_rent_months" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "buildings" ADD COLUMN "room_prefix" VARCHAR(50),
ADD COLUMN "has_elevator" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "dormitory_line_configs" ADD COLUMN "bot_user_id" VARCHAR(100),
ADD COLUMN "bot_display_name" VARCHAR(255),
ADD COLUMN "bot_picture_url" TEXT,
ADD COLUMN "bot_premium_id" VARCHAR(100),
ADD COLUMN "bot_chat_mode" VARCHAR(50);
