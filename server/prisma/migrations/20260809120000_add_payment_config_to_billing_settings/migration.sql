-- Add payment account configuration columns to dormitory_billing_settings
ALTER TABLE "dormitory_billing_settings" ADD COLUMN "cash_accepted" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "dormitory_billing_settings" ADD COLUMN "prompt_pay_type" VARCHAR(50);
ALTER TABLE "dormitory_billing_settings" ADD COLUMN "prompt_pay_value" VARCHAR(255);
ALTER TABLE "dormitory_billing_settings" ADD COLUMN "prompt_pay_value_encrypted" TEXT;
ALTER TABLE "dormitory_billing_settings" ADD COLUMN "bank_code" VARCHAR(50);
ALTER TABLE "dormitory_billing_settings" ADD COLUMN "bank_account_name" VARCHAR(255);
ALTER TABLE "dormitory_billing_settings" ADD COLUMN "bank_account_number" VARCHAR(100);
ALTER TABLE "dormitory_billing_settings" ADD COLUMN "bank_account_number_encrypted" TEXT;
