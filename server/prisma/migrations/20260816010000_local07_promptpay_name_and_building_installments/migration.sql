-- AlterTable dormitory_billing_settings
ALTER TABLE "dormitory_billing_settings" ADD COLUMN IF NOT EXISTS "prompt_pay_account_name" VARCHAR(255);

-- AlterTable buildings
ALTER TABLE "buildings" ADD COLUMN IF NOT EXISTS "max_term_rent_installments" INTEGER NOT NULL DEFAULT 1;
